import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Payment, PaymentDocument } from '../payments/schemas/payment.schema';
import { UserType } from '../common/enums/user-type.enum';
import { CountersService } from '../counters/counters.service';

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    private countersService: CountersService,
  ) {}

  async create(
    createDto: CreateInvoiceDto,
    generatedById: string,
  ): Promise<InvoiceDocument> {
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

    // Verify payment if provided
    if (createDto.paymentId) {
      const payment = await this.paymentModel
        .findById(createDto.paymentId)
        .exec();
      if (!payment) {
        throw new NotFoundException(
          `Payment with ID ${createDto.paymentId} not found`,
        );
      }
    }

    // Calculate totals
    const subtotal = createDto.items.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const taxPercentage = createDto.taxPercentage || 0;
    const taxAmount = (subtotal * taxPercentage) / 100;
    const totalAmount = subtotal + taxAmount;

    // Generate a collision-free invoice number via the atomic counter (P0-8).
    const invoiceNumber = await this.countersService.nextInvoiceNumber();

    // Create invoice
    const invoice = new this.invoiceModel({
      ...createDto,
      invoiceNumber,
      subtotal,
      taxAmount,
      totalAmount,
      generatedBy: generatedById,
    });

    return invoice.save();
  }

  async findAll(): Promise<InvoiceDocument[]> {
    return this.invoiceModel
      .find({ deletedAt: null })
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('paymentId')
      .populate('generatedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(id: string): Promise<InvoiceDocument> {
    const invoice = await this.invoiceModel
      .findOne({ _id: id, deletedAt: null })
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('paymentId')
      .populate('generatedBy', '-password -refreshToken')
      .exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return invoice;
  }

  async findByMemberId(memberId: string): Promise<InvoiceDocument[]> {
    // Verify member exists
    const member = await this.userModel
      .findOne({ _id: memberId, userType: UserType.MEMBER })
      .exec();
    if (!member) {
      throw new NotFoundException(`Member with ID ${memberId} not found`);
    }

    return this.invoiceModel
      .find({ memberId: memberId as any, deletedAt: null })
      .populate('subscriptionId')
      .populate('paymentId')
      .populate('generatedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findBySubscriptionId(
    subscriptionId: string,
  ): Promise<InvoiceDocument[]> {
    // Verify subscription exists
    const subscription = await this.memberSubscriptionModel
      .findById(subscriptionId)
      .exec();
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${subscriptionId} not found`,
      );
    }

    return this.invoiceModel
      .find({ subscriptionId: subscriptionId as any, deletedAt: null })
      .populate('memberId', '-password -refreshToken')
      .populate('paymentId')
      .populate('generatedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    id: string,
    updateDto: UpdateInvoiceDto,
  ): Promise<InvoiceDocument> {
    const invoice = await this.invoiceModel
      .findOne({ _id: id, deletedAt: null })
      .exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    // Recalculate totals if items or tax percentage changed
    let updateData: any = { ...updateDto };
    if (updateDto.items || updateDto.taxPercentage !== undefined) {
      const items = updateDto.items || invoice.items;
      const taxPercentage =
        updateDto.taxPercentage !== undefined
          ? updateDto.taxPercentage
          : invoice.taxPercentage;

      const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
      const taxAmount = (subtotal * taxPercentage) / 100;
      const totalAmount = subtotal + taxAmount;

      updateData = {
        ...updateData,
        subtotal,
        taxAmount,
        totalAmount,
      };
    }

    const updatedInvoice = await this.invoiceModel
      .findByIdAndUpdate(id, updateData, { new: true })
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('paymentId')
      .populate('generatedBy', '-password -refreshToken')
      .exec();

    if (!updatedInvoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return updatedInvoice as InvoiceDocument;
  }

  // Soft-delete (P0-12): financial records are voided, never hard-deleted.
  async delete(id: string): Promise<void> {
    const invoice = await this.invoiceModel
      .findOne({ _id: id, deletedAt: null })
      .exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    invoice.deletedAt = new Date();
    await invoice.save();
  }
}
