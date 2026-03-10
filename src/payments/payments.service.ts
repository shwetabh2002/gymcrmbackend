import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Invoice, InvoiceDocument } from '../invoices/schemas/invoice.schema';
import { UserType } from '../common/enums/user-type.enum';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
  ) {}

  async create(
    createDto: CreatePaymentDto,
    receivedById: string,
  ): Promise<PaymentDocument> {
    // Verify subscription exists
    const subscription = await this.memberSubscriptionModel
      .findById(createDto.subscriptionId)
      .exec();
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${createDto.subscriptionId} not found`,
      );
    }

    // Verify member exists
    const member = await this.userModel
      .findOne({ _id: createDto.memberId, userType: UserType.MEMBER })
      .exec();
    if (!member) {
      throw new NotFoundException(
        `Member with ID ${createDto.memberId} not found`,
      );
    }

    // Verify receivedBy user exists
    const receivedBy = await this.userModel.findById(receivedById).exec();
    if (!receivedBy) {
      throw new NotFoundException(
        `User with ID ${receivedById} not found`,
      );
    }

    // Create payment record
    const payment = new this.paymentModel({
      ...createDto,
      receivedBy: receivedById,
    });

    const savedPayment = await payment.save();

    // Update subscription payment details
    const newTotalPaid = subscription.totalPaid + createDto.amount;
    const newPendingAmount = subscription.planPrice - newTotalPaid;

    let newPaymentStatus = subscription.paymentStatus;
    if (newPendingAmount <= 0) {
      newPaymentStatus = 'FULLY_PAID' as any;
    } else if (newTotalPaid > 0) {
      newPaymentStatus = 'PARTIALLY_PAID' as any;
    }

    await this.memberSubscriptionModel
      .findByIdAndUpdate(createDto.subscriptionId, {
        totalPaid: newTotalPaid,
        pendingAmount: Math.max(0, newPendingAmount),
        paymentStatus: newPaymentStatus,
      })
      .exec();

    // Auto-generate invoice for this payment
    await this.generateInvoiceForPayment(
      savedPayment,
      subscription,
      receivedById,
    );

    return savedPayment;
  }

  private async generateInvoiceForPayment(
    payment: PaymentDocument,
    subscription: MemberSubscriptionDocument,
    generatedById: string,
  ): Promise<void> {
    try {
      // Generate invoice number (format: INV-YYYYMMDD-XXXX)
      const date = new Date();
      const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
      const count = await this.invoiceModel.countDocuments();
      const invoiceNumber = `INV-${dateStr}-${String(count + 1).padStart(4, '0')}`;

      // Get subscription plan details
      const subscriptionWithPlan = await this.memberSubscriptionModel
        .findById(subscription._id)
        .populate('planId')
        .exec();

      const planName = (subscriptionWithPlan as any).planId?.name || 'Membership';

      // Create invoice items
      const items = [
        {
          description: `${planName} - Payment`,
          amount: payment.amount,
        },
      ];

      const subtotal = payment.amount;
      const taxPercentage = 0; // No tax by default
      const taxAmount = 0;
      const totalAmount = subtotal;

      // Create invoice
      const invoice = new this.invoiceModel({
        invoiceNumber,
        memberId: payment.memberId,
        subscriptionId: payment.subscriptionId,
        items,
        subtotal,
        taxPercentage,
        taxAmount,
        totalAmount,
        invoiceDate: payment.paymentDate,
        dueDate: payment.paymentDate, // Due date same as payment date since already paid
        paymentId: payment._id,
        generatedBy: generatedById,
        notes: `Auto-generated invoice for payment ${payment.transactionId || payment._id}`,
      });

      await invoice.save();
    } catch (error) {
      // Log error but don't fail the payment creation
      console.error('Failed to auto-generate invoice:', error);
    }
  }

  async findAll(): Promise<PaymentDocument[]> {
    return this.paymentModel
      .find()
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<PaymentDocument> {
    const payment = await this.paymentModel
      .findById(id)
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .exec();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    return payment;
  }

  async findByMemberId(memberId: string): Promise<PaymentDocument[]> {
    // Verify member exists
    const member = await this.userModel
      .findOne({ _id: memberId, userType: UserType.MEMBER })
      .exec();
    if (!member) {
      throw new NotFoundException(`Member with ID ${memberId} not found`);
    }

    return this.paymentModel
      .find({ memberId: memberId as any })
      .populate('subscriptionId')
      .populate('receivedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findBySubscriptionId(
    subscriptionId: string,
  ): Promise<PaymentDocument[]> {
    // Verify subscription exists
    const subscription = await this.memberSubscriptionModel
      .findById(subscriptionId)
      .exec();
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${subscriptionId} not found`,
      );
    }

    return this.paymentModel
      .find({ subscriptionId: subscriptionId as any })
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    id: string,
    updateDto: UpdatePaymentDto,
  ): Promise<PaymentDocument> {
    const payment = await this.paymentModel.findById(id).exec();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    const updatedPayment = await this.paymentModel
      .findByIdAndUpdate(id, updateDto, { new: true })
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .exec();

    if (!updatedPayment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    return updatedPayment as PaymentDocument;
  }

  async delete(id: string): Promise<void> {
    const payment = await this.paymentModel.findById(id).exec();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    await this.paymentModel.findByIdAndDelete(id).exec();
  }
}
