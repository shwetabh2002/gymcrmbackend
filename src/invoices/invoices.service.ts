import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
} from './tax.util';

type LocScope = { locationId?: string };

const LOCATION_POPULATE = {
  path: 'locationId',
  select:
    'name code address city phone status invoiceLayout invoiceShowLogo invoiceShowStamp invoiceShowGstin invoiceShowAddress invoiceShowContact',
};

@Injectable()
export class InvoicesService {
  constructor(
    @InjectModel(Invoice.name) private invoiceModel: Model<InvoiceDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Payment.name) private paymentModel: Model<PaymentDocument>,
    @InjectModel(GymSettings.name)
    private gymSettingsModel: Model<GymSettingsDocument>,
    private countersService: CountersService,
    private activityLogsService: ActivityLogsService,
  ) {}

  private applyInvoicePopulates(query: any) {
    return query
      .populate(LOCATION_POPULATE)
      .populate('subscriptionId')
      .populate('memberId', '-password -refreshToken')
      .populate('paymentId')
      .populate('generatedBy', '-password -refreshToken');
  }

  private async resolveCompanyTax(companyId: string) {
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
    return { taxPercentage, taxMode };
  }

  async create(
    companyId: string,
    createDto: CreateInvoiceDto,
    generatedById: string,
    actor?: ActivityActor,
    writeLocationId?: string,
  ): Promise<InvoiceDocument> {
    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: createDto.subscriptionId, companyId })
      .exec();
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${createDto.subscriptionId} not found`,
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

    let paymentLocationId: string | null = null;
    if (createDto.paymentId) {
      const payment = await this.paymentModel
        .findOne({ _id: createDto.paymentId, companyId })
        .exec();
      if (!payment) {
        throw new NotFoundException(
          `Payment with ID ${createDto.paymentId} not found`,
        );
      }
      paymentLocationId = payment.locationId
        ? String(payment.locationId)
        : null;
    }

    const locationId =
      (subscription.locationId
        ? String(subscription.locationId)
        : null) ||
      paymentLocationId ||
      writeLocationId;
    if (!locationId) {
      throw new BadRequestException(
        'locationId required — select a location or ensure subscription has one',
      );
    }

    const itemsTotal = createDto.items.reduce(
      (sum, item) => sum + item.amount,
      0,
    );
    const companyTax = await this.resolveCompanyTax(companyId);
    const taxPercentage =
      createDto.taxPercentage !== undefined && createDto.taxPercentage !== null
        ? createDto.taxPercentage
        : companyTax.taxPercentage;
    const breakdown = computeTaxBreakdown(
      itemsTotal,
      taxPercentage,
      companyTax.taxMode,
    );

    // Line items store taxable value so PDF lines match subtotal
    const items =
      breakdown.taxMode === 'included' && breakdown.totalAmount > 0
        ? createDto.items.map((it) => ({
            ...it,
            amount:
              Math.round(
                ((it.amount / itemsTotal) * breakdown.subtotal +
                  Number.EPSILON) *
                  100,
              ) / 100,
          }))
        : createDto.items;

    let saved: InvoiceDocument | null = null;
    let invoiceNumber = '';
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      invoiceNumber = await this.countersService.nextInvoiceNumber(companyId);
      try {
        const invoice = new this.invoiceModel({
          ...createDto,
          items,
          companyId,
          locationId,
          invoiceNumber,
          subtotal: breakdown.subtotal,
          taxPercentage: breakdown.taxPercentage,
          taxAmount: breakdown.taxAmount,
          taxMode: breakdown.taxMode,
          totalAmount: breakdown.totalAmount,
          generatedBy: generatedById,
        });
        saved = await invoice.save();
        break;
      } catch (err: any) {
        lastErr = err;
        const isDup =
          err?.code === 11000 ||
          String(err?.message || '').includes('E11000') ||
          String(err?.message || '').includes('duplicate key');
        if (!isDup) throw err;
      }
    }
    if (!saved) throw lastErr;

    if (actor || generatedById) {
      await this.activityLogsService.log({
        companyId,
        locationId,
        actor: actor || {
          userId: generatedById,
          name: 'Unknown',
        },
        action: 'INVOICE_CREATE',
        entityType: 'invoice',
        entityId: String(saved._id),
        summary: `${actor?.name || 'Someone'} created invoice ${invoiceNumber} for ${member.name} (₹${breakdown.totalAmount})`,
        metadata: {
          invoiceNumber,
          totalAmount: breakdown.totalAmount,
          memberId: createDto.memberId,
        },
      });
    }

    return this.applyInvoicePopulates(
      this.invoiceModel.findOne({ _id: saved._id, companyId }),
    ).exec() as Promise<InvoiceDocument>;
  }

  async findAll(
    companyId: string,
    locScope: LocScope = {},
  ): Promise<InvoiceDocument[]> {
    return this.applyInvoicePopulates(
      this.invoiceModel
        .find({ companyId, deletedAt: null, ...locScope })
        .sort({ createdAt: -1 }),
    ).exec();
  }

  async findById(
    companyId: string,
    id: string,
    locScope: LocScope = {},
  ): Promise<InvoiceDocument> {
    const invoice = await this.applyInvoicePopulates(
      this.invoiceModel.findOne({
        _id: id,
        companyId,
        deletedAt: null,
        ...locScope,
      }),
    ).exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return invoice;
  }

  async findByMemberId(
    companyId: string,
    memberId: string,
    locScope: LocScope = {},
  ): Promise<InvoiceDocument[]> {
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

    return this.applyInvoicePopulates(
      this.invoiceModel
        .find({
          companyId,
          memberId: memberId as any,
          deletedAt: null,
          ...locScope,
        })
        .sort({ createdAt: -1 }),
    ).exec();
  }

  async findBySubscriptionId(
    companyId: string,
    subscriptionId: string,
    locScope: LocScope = {},
  ): Promise<InvoiceDocument[]> {
    const subscription = await this.memberSubscriptionModel
      .findOne({ _id: subscriptionId, companyId, ...locScope })
      .exec();
    if (!subscription) {
      throw new NotFoundException(
        `Subscription with ID ${subscriptionId} not found`,
      );
    }

    return this.applyInvoicePopulates(
      this.invoiceModel
        .find({
          companyId,
          subscriptionId: subscriptionId as any,
          deletedAt: null,
          ...locScope,
        })
        .sort({ createdAt: -1 }),
    ).exec();
  }

  async update(
    companyId: string,
    id: string,
    updateDto: UpdateInvoiceDto,
    locScope: LocScope = {},
  ): Promise<InvoiceDocument> {
    const invoice = await this.invoiceModel
      .findOne({ _id: id, companyId, deletedAt: null, ...locScope })
      .exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    const { companyId: _ignore, locationId: _loc, ...rest } = updateDto as any;
    let updateData: any = { ...rest };
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

    const updatedInvoice = await this.applyInvoicePopulates(
      this.invoiceModel.findOneAndUpdate(
        { _id: id, companyId },
        updateData,
        { returnDocument: 'after' },
      ),
    ).exec();

    if (!updatedInvoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return updatedInvoice as InvoiceDocument;
  }

  async delete(
    companyId: string,
    id: string,
    locScope: LocScope = {},
  ): Promise<void> {
    const invoice = await this.invoiceModel
      .findOne({ _id: id, companyId, deletedAt: null, ...locScope })
      .exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    invoice.deletedAt = new Date();
    await invoice.save();
  }
}
