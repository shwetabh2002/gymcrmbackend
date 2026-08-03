import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
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
import { Role } from '../common/enums/role.enum';
import { CountersService } from '../counters/counters.service';
import {
  ActivityLogsService,
  ActivityActor,
} from '../activity-logs/activity-logs.service';
import {
  GymSettings,
  GymSettingsDocument,
} from '../gym-settings/schemas/gym-settings.schema';
import {
  computeTaxBreakdown,
  DEFAULT_INVOICE_TAX_MODE,
  DEFAULT_INVOICE_TAX_PERCENTAGE,
  isInvoiceTaxMode,
} from '../invoices/tax.util';
import { StorageService } from '../storage/storage.service';
import { PaymentMode } from '../common/enums/payment-mode.enum';

type LocScope = { locationId?: string };

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    @InjectModel(GymSettings.name)
    private gymSettingsModel: Model<GymSettingsDocument>,
    @Inject(forwardRef(() => MemberSubscriptionsService))
    private memberSubscriptionsService: MemberSubscriptionsService,
    private countersService: CountersService,
    private activityLogsService: ActivityLogsService,
    private storageService: StorageService,
  ) {}

  async create(
    companyId: string,
    createDto: CreatePaymentDto,
    receivedById: string,
    actor?: ActivityActor,
    writeLocationId?: string,
  ): Promise<PaymentDocument> {
    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: createDto.subscriptionId, companyId })
      .exec();
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${createDto.subscriptionId} not found`,
      );
    }

    const locationId =
      (subscription.locationId
        ? String(subscription.locationId)
        : null) || writeLocationId;
    if (!locationId) {
      throw new BadRequestException(
        'locationId required — select a location or ensure subscription has one',
      );
    }

    const member = await this.userModel
      .findOne({
        _id: createDto.memberId,
        companyId,
        userType: UserType.MEMBER,
      })
      .exec();
    if (!member) {
      throw new NotFoundException(
        `Member with ID ${createDto.memberId} not found`,
      );
    }

    const receivedBy = await this.userModel.findById(receivedById).exec();
    if (!receivedBy) {
      throw new NotFoundException(
        `User with ID ${receivedById} not found`,
      );
    }
    const sameCompany =
      receivedBy.companyId &&
      receivedBy.companyId.toString() === companyId;
    const isPlatformSuper = receivedBy.role === Role.SUPER_ADMIN;
    if (!sameCompany && !isPlatformSuper) {
      throw new NotFoundException(
        `User with ID ${receivedById} not found`,
      );
    }

    const payment = new this.paymentModel({
      ...createDto,
      companyId,
      locationId,
      receivedBy: receivedById,
    });

    const savedPayment = await payment.save();

    try {
      await this.memberSubscriptionsService.applyPaymentDelta(
        companyId,
        createDto.subscriptionId,
        createDto.amount,
      );
    } catch (err) {
      // Don't leave a ledger row that never applied to the subscription
      await this.paymentModel
        .deleteOne({ _id: savedPayment._id, companyId })
        .exec();
      throw err;
    }

    // Invoice failures are logged inside generateInvoiceForPayment (non-fatal)
    await this.generateInvoiceForPayment(
      companyId,
      locationId,
      savedPayment,
      subscription,
      receivedById,
    );

    const actorName = actor?.name || receivedBy.name;
    try {
      await this.activityLogsService.log({
        companyId,
        locationId,
        actor: {
          userId: receivedById,
          name: actorName,
        },
        action: 'PAYMENT_CREATE',
        entityType: 'payment',
        entityId: String(savedPayment._id),
        summary: `${actorName} recorded ₹${createDto.amount} from ${member.name}`,
        metadata: {
          amount: createDto.amount,
          paymentMode: createDto.paymentMode,
          memberId: createDto.memberId,
          subscriptionId: createDto.subscriptionId,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Payment ${savedPayment._id} saved but activity log failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
    }

    return savedPayment;
  }

  async findByProviderRef(companyId: string, providerRef: string) {
    if (!providerRef) return null;
    return this.paymentModel
      .findOne({ companyId, providerRef, deletedAt: null })
      .exec();
  }

  /**
   * Ledger write from Razorpay checkout / autopay webhook.
   * Skips staff "receivedBy" company checks for system charges by using staff id when available.
   */
  async createFromProvider(input: {
    companyId: string;
    locationId: string;
    memberId: string;
    subscriptionId: string;
    amount: number;
    paymentMode: PaymentMode;
    paymentDate: string;
    providerRef: string;
    source: string;
    receivedById: string;
    notes?: string;
  }): Promise<PaymentDocument> {
    const existing = await this.findByProviderRef(
      input.companyId,
      input.providerRef,
    );
    if (existing) return existing;

    return this.create(
      input.companyId,
      {
        memberId: input.memberId,
        subscriptionId: input.subscriptionId,
        amount: input.amount,
        paymentMode: input.paymentMode,
        paymentDate: input.paymentDate,
        transactionId: input.providerRef,
        notes: input.notes,
      },
      input.receivedById,
      undefined,
      input.locationId,
    ).then(async (payment) => {
      await this.paymentModel
        .updateOne(
          { _id: payment._id },
          { providerRef: input.providerRef, source: input.source },
        )
        .exec();
      payment.providerRef = input.providerRef;
      payment.source = input.source;
      return payment;
    });
  }

  /**
   * For legacy payments created outside PaymentsService (e.g. old member-create path).
   * Idempotent — skips if an invoice already exists for the payment.
   */
  async ensureInvoiceForPayment(
    companyId: string,
    paymentId: string,
  ): Promise<{ created: boolean; invoiceId?: string }> {
    const payment = await this.paymentModel
      .findOne({ _id: paymentId, companyId, deletedAt: null })
      .exec();
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }
    const existing = await this.invoiceModel
      .findOne({ companyId, paymentId: payment._id as any, deletedAt: null })
      .exec();
    if (existing) {
      return { created: false, invoiceId: String(existing._id) };
    }
    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: payment.subscriptionId, companyId })
      .exec();
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${payment.subscriptionId} not found`,
      );
    }
    const locationId = payment.locationId
      ? String(payment.locationId)
      : subscription.locationId
        ? String(subscription.locationId)
        : null;
    if (!locationId) {
      throw new BadRequestException('Payment has no locationId');
    }
    await this.generateInvoiceForPayment(
      companyId,
      locationId,
      payment,
      subscription,
      String(payment.receivedBy),
    );
    const invoice = await this.invoiceModel
      .findOne({ companyId, paymentId: payment._id as any, deletedAt: null })
      .exec();
    return { created: !!invoice, invoiceId: invoice ? String(invoice._id) : undefined };
  }

  private async generateInvoiceForPayment(
    companyId: string,
    locationId: string,
    payment: PaymentDocument,
    subscription: MemberSubscriptionDocument,
    generatedById: string,
  ): Promise<void> {
    try {
      const existing = await this.invoiceModel
        .findOne({
          companyId,
          paymentId: payment._id as any,
          deletedAt: null,
        })
        .exec();
      if (existing) return;

      const subscriptionWithPlan = await this.memberSubscriptionModel
        .findOne({ _id: subscription._id, companyId })
        .populate('planId')
        .exec();

      const planName =
        (subscriptionWithPlan as any).planId?.name || 'Membership';

      const settings = await this.gymSettingsModel
        .findOne({ companyId })
        .lean()
        .exec();
      const taxPercentage =
        typeof (settings as any)?.invoiceTaxPercentage === 'number'
          ? (settings as any).invoiceTaxPercentage
          : DEFAULT_INVOICE_TAX_PERCENTAGE;
      const taxMode = isInvoiceTaxMode((settings as any)?.invoiceTaxMode)
        ? (settings as any).invoiceTaxMode
        : DEFAULT_INVOICE_TAX_MODE;

      const breakdown = computeTaxBreakdown(
        payment.amount,
        taxPercentage,
        taxMode,
      );

      const items = [
        {
          description: `${planName} - Payment`,
          amount: breakdown.subtotal,
        },
      ];

      // Retry on rare invoiceNumber collisions (stale counters / concurrent creates)
      let lastError: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        const invoiceNumber =
          await this.countersService.nextInvoiceNumber(companyId);
        try {
          const invoice = new this.invoiceModel({
            companyId,
            locationId,
            invoiceNumber,
            memberId: payment.memberId,
            subscriptionId: payment.subscriptionId,
            items,
            subtotal: breakdown.subtotal,
            taxPercentage: breakdown.taxPercentage,
            taxAmount: breakdown.taxAmount,
            taxMode: breakdown.taxMode,
            totalAmount: breakdown.totalAmount,
            invoiceDate: payment.paymentDate,
            dueDate: payment.paymentDate,
            paymentId: payment._id,
            generatedBy: generatedById,
            notes: `Auto-generated invoice for payment ${payment.transactionId || payment._id} (GST ${breakdown.taxMode})`,
          });
          await invoice.save();
          return;
        } catch (err: any) {
          lastError = err;
          const isDup =
            err?.code === 11000 ||
            err?.message?.includes?.('E11000') ||
            err?.message?.includes?.('duplicate key');
          if (!isDup) throw err;
        }
      }
      throw lastError;
    } catch (error) {
      this.logger.error(
        `MANUAL ACTION REQUIRED: payment ${payment._id} (member ${payment.memberId}, ` +
          `subscription ${payment.subscriptionId}, amount ${payment.amount}) was saved ` +
          `but its invoice could not be generated.`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async findAll(
    companyId: string,
    locScope: LocScope = {},
  ): Promise<PaymentDocument[]> {
    return this.paymentModel
      .find({ companyId, deletedAt: null, ...locScope })
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findById(
    companyId: string,
    id: string,
    locScope: LocScope = {},
  ): Promise<PaymentDocument> {
    const payment = await this.paymentModel
      .findOne({ _id: id, companyId, deletedAt: null, ...locScope })
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .exec();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    return payment;
  }

  async findByMemberId(
    companyId: string,
    memberId: string,
    locScope: LocScope = {},
  ): Promise<PaymentDocument[]> {
    const member = await this.userModel
      .findOne({
        _id: memberId,
        companyId,
        userType: UserType.MEMBER,
        ...locScope,
      })
      .exec();
    if (!member) {
      throw new NotFoundException(`Member with ID ${memberId} not found`);
    }

    return this.paymentModel
      .find({
        companyId,
        memberId: memberId as any,
        deletedAt: null,
        ...locScope,
      })
      .populate('subscriptionId')
      .populate('receivedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async findBySubscriptionId(
    companyId: string,
    subscriptionId: string,
    locScope: LocScope = {},
  ): Promise<PaymentDocument[]> {
    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: subscriptionId, companyId, ...locScope })
      .exec();
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${subscriptionId} not found`,
      );
    }

    return this.paymentModel
      .find({
        companyId,
        subscriptionId: subscriptionId as any,
        deletedAt: null,
        ...locScope,
      })
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }

  async update(
    companyId: string,
    id: string,
    updateDto: UpdatePaymentDto,
    actor?: ActivityActor,
    locScope: LocScope = {},
  ): Promise<PaymentDocument> {
    const payment = await this.paymentModel
      .findOne({ _id: id, companyId, deletedAt: null, ...locScope })
      .exec();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    const {
      companyId: _ignore,
      locationId: _loc,
      memberId: _member,
      subscriptionId: _sub,
      ...rest
    } = updateDto as any;

    const safeUpdate: Record<string, unknown> = { ...rest };

    if (typeof safeUpdate.amount === 'number') {
      const nextAmount = Number(safeUpdate.amount);
      if (!(nextAmount > 0)) {
        throw new BadRequestException('Amount must be greater than 0');
      }
      const delta = nextAmount - payment.amount;
      if (delta !== 0) {
        const subscription = await this.memberSubscriptionModel
          .findOne({ _id: payment.subscriptionId, companyId })
          .populate('planId')
          .exec();
        if (!subscription) {
          throw new NotFoundException(
            `Subscription with ID ${payment.subscriptionId} not found`,
          );
        }
        if (delta > 0 && delta > subscription.pendingAmount) {
          throw new BadRequestException(
            `Amount increase cannot exceed pending ₹${subscription.pendingAmount}`,
          );
        }
        await this.memberSubscriptionsService.applyPaymentDelta(
          companyId,
          String(payment.subscriptionId),
          delta,
        );

        const settings = await this.gymSettingsModel
          .findOne({ companyId })
          .lean()
          .exec();
        const taxPercentage =
          typeof (settings as any)?.invoiceTaxPercentage === 'number'
            ? (settings as any).invoiceTaxPercentage
            : DEFAULT_INVOICE_TAX_PERCENTAGE;
        const taxMode = isInvoiceTaxMode((settings as any)?.invoiceTaxMode)
          ? (settings as any).invoiceTaxMode
          : DEFAULT_INVOICE_TAX_MODE;
        const breakdown = computeTaxBreakdown(
          nextAmount,
          taxPercentage,
          taxMode,
        );
        const planName = (subscription as any).planId?.name || 'Membership';
        await this.invoiceModel
          .updateMany(
            { companyId, paymentId: payment._id as any, deletedAt: null },
            {
              $set: {
                subtotal: breakdown.subtotal,
                taxPercentage: breakdown.taxPercentage,
                taxAmount: breakdown.taxAmount,
                taxMode: breakdown.taxMode,
                totalAmount: breakdown.totalAmount,
                items: [
                  {
                    description: `${planName} - Payment`,
                    amount: breakdown.subtotal,
                  },
                ],
              },
            },
          )
          .exec();
      }
    }

    const updatedPayment = await this.paymentModel
      .findOneAndUpdate({ _id: id, companyId }, safeUpdate, {
        returnDocument: 'after',
      })
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('receivedBy', '-password -refreshToken')
      .exec();

    if (!updatedPayment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    if (actor) {
      await this.activityLogsService.log({
        companyId,
        locationId: updatedPayment.locationId
          ? String(updatedPayment.locationId)
          : null,
        actor,
        action: 'PAYMENT_UPDATE',
        entityType: 'payment',
        entityId: id,
        summary: `${actor.name} updated payment ₹${updatedPayment.amount}`,
      });
    }

    return updatedPayment as PaymentDocument;
  }

  /**
   * Void a payment (P0-12): soft-delete it, reverse its effect on the
   * subscription's running totals, and void any invoice generated from it.
   * Financial records are never hard-deleted.
   */
  async delete(
    companyId: string,
    id: string,
    actor?: ActivityActor,
    locScope: LocScope = {},
  ): Promise<void> {
    const payment = await this.paymentModel
      .findOne({ _id: id, companyId, deletedAt: null, ...locScope })
      .populate('memberId', 'name')
      .exec();

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    await this.memberSubscriptionsService.applyPaymentDelta(
      companyId,
      payment.subscriptionId.toString(),
      -payment.amount,
    );

    await this.invoiceModel
      .updateMany(
        { companyId, paymentId: payment._id as any, deletedAt: null },
        { deletedAt: new Date() },
      )
      .exec();

    payment.deletedAt = new Date();
    await payment.save();

    if (actor) {
      const memberName = (payment as any).memberId?.name || 'member';
      await this.activityLogsService.log({
        companyId,
        locationId: payment.locationId ? String(payment.locationId) : null,
        actor,
        action: 'PAYMENT_VOID',
        entityType: 'payment',
        entityId: id,
        summary: `${actor.name} voided ₹${payment.amount} payment for ${memberName}`,
        metadata: { amount: payment.amount },
      });
    }
  }

  /** Optional payment screenshot — path: companies/{cid}/payments/{paymentId}/… */
  async uploadProof(
    companyId: string,
    id: string,
    file: Express.Multer.File,
    locScope: LocScope = {},
  ) {
    const payment = await this.paymentModel
      .findOne({ _id: id, companyId, deletedAt: null, ...locScope })
      .exec();
    if (!payment) {
      throw new NotFoundException(`Payment with ID ${id} not found`);
    }

    const valid = this.storageService.assertValidImageFile(file);
    const uploaded = await this.storageService.uploadCompanyAsset({
      companyId,
      folder: 'payments',
      entityId: id,
      buffer: valid.buffer,
      mimeType: valid.mimetype,
      originalName: valid.originalname,
    });

    payment.proofUrl = uploaded.url;
    await payment.save();
    return this.findById(companyId, id, locScope);
  }
}
