import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentDto } from './dto/update-payment.dto';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { MemberSubscriptionsService } from '../member-subscriptions/member-subscriptions.service';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Invoice, InvoiceDocument } from '../invoices/schemas/invoice.schema';
import { UserType } from '../common/enums/user-type.enum';
import { CountersService } from '../counters/counters.service';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    private memberSubscriptionsService: MemberSubscriptionsService,
    private countersService: CountersService,
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

    // Atomically apply the payment to the subscription's running totals (P0-9).
    await this.memberSubscriptionsService.applyPaymentDelta(
      createDto.subscriptionId,
      createDto.amount,
    );

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
      // Generate a collision-free invoice number via the atomic counter (P0-8).
      const invoiceNumber = await this.countersService.nextInvoiceNumber();

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
      // The payment is already recorded; surface this loudly and actionably
      // instead of swallowing it (P0-10). An invoice is now missing for a real
      // payment and must be generated manually (or re-run once fixed).
      this.logger.error(
        `MANUAL ACTION REQUIRED: payment ${payment._id} (member ${payment.memberId}, ` +
          `subscription ${payment.subscriptionId}, amount ${payment.amount}) was saved ` +
          `but its invoice could not be generated.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async findAll(): Promise<PaymentDocument[]> {
    return this.paymentModel
      .find({ deletedAt: null })
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<PaymentDocument> {
    const payment = await this.paymentModel
      .findOne({ _id: id, deletedAt: null })
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
      .find({ memberId: memberId as any, deletedAt: null })
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
      .find({ subscriptionId: subscriptionId as any, deletedAt: null })
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    id: string,
    updateDto: UpdatePaymentDto,
  ): Promise<PaymentDocument> {
    const payment = await this.paymentModel
      .findOne({ _id: id, deletedAt: null })
      .exec();

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

  /**
   * Void a payment (P0-12): soft-delete it, reverse its effect on the
   * subscription's running totals, and void any invoice generated from it.
   * Financial records are never hard-deleted.
   */
  async delete(id: string): Promise<void> {
    const payment = await this.paymentModel
      .findOne({ _id: id, deletedAt: null })
      .exec();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    // Reverse the amount from the subscription's totals.
    await this.memberSubscriptionsService.applyPaymentDelta(
      payment.subscriptionId.toString(),
      -payment.amount,
    );

    // Void any invoice(s) auto-generated from this payment.
    await this.invoiceModel
      .updateMany(
        { paymentId: payment._id as any, deletedAt: null },
        { deletedAt: new Date() },
      )
      .exec();

    payment.deletedAt = new Date();
    await payment.save();
  }
}
