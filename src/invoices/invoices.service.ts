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
import { CompanyContextService } from '../common/company-context/company-context.service';
import {
  PaginationQueryDto,
  UNPAGED_SAFETY_LIMIT,
  buildResult,
  isPaged,
  resolvePaging,
  searchRegex,
} from '../common/pagination/pagination';

type LocScope = { locationId?: string };

/** Works whether the ref is an ObjectId or an already-populated document. */
function toObjectIdString(ref: unknown): string | null {
  if (!ref) return null;
  if (typeof ref === 'string') return ref;
  const id = (ref as { _id?: unknown })._id ?? ref;
  return id ? String(id) : null;
}

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
    private companyContext: CompanyContextService,
  ) {}

  private applyInvoicePopulates(query: any) {
    return (
      query
        .populate(LOCATION_POPULATE)
        // Nested plan: the invoice shows what was bought and for how long, not
        // just a plan id.
        .populate({
          path: 'subscriptionId',
          populate: { path: 'planId', select: 'name duration durationType' },
        })
        .populate('memberId', '-password -refreshToken')
        .populate('paymentId')
        .populate('generatedBy', '-password -refreshToken')
    );
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
      (subscription.locationId ? String(subscription.locationId) : null) ||
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
    const snapPct = (subscription as any).taxPercentage;
    const snapMode = (subscription as any).taxMode;
    const taxPercentage =
      createDto.taxPercentage !== undefined && createDto.taxPercentage !== null
        ? createDto.taxPercentage
        : typeof snapPct === 'number'
          ? snapPct
          : companyTax.taxPercentage;
    const taxMode = isInvoiceTaxMode(createDto.taxMode)
      ? createDto.taxMode
      : isInvoiceTaxMode(snapMode)
        ? snapMode
        : companyTax.taxMode;
    const breakdown = computeTaxBreakdown(
      itemsTotal,
      taxPercentage,
      taxMode,
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
        summary: `${actor?.name || 'Someone'} created invoice ${invoiceNumber} for ${member.name} (${await this.companyContext.formatMoney(
          companyId,
          breakdown.totalAmount,
        )})`,
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

  /** List populate — enough for the table; skip payment/generatedBy. */
  private applyInvoiceListPopulates(query: any) {
    return query
      .populate('memberId', 'name phone email idNo')
      .populate({
        path: 'subscriptionId',
        select: 'planPrice paymentStatus startDate expiryDate',
        populate: { path: 'planId', select: 'name' },
      })
      .populate({
        path: 'locationId',
        select: 'name code',
      });
  }

  async findAll(
    companyId: string,
    locScope: LocScope = {},
    query?: PaginationQueryDto & { taxMode?: string },
  ) {
    const filter: Record<string, unknown> = {
      companyId,
      deletedAt: null,
      ...locScope,
    };
    if (query?.taxMode === 'included' || query?.taxMode === 'excluded') {
      filter.taxMode = query.taxMode;
    }
    const term = searchRegex(query?.search);
    if (term) {
      // Match invoice number directly; member name via id lookup.
      const members = await this.userModel
        .find({
          companyId,
          userType: UserType.MEMBER,
          $or: [{ name: term }, { phone: term }],
        })
        .select('_id')
        .limit(200)
        .lean()
        .exec();
      const memberIds = members.map((m) => m._id);
      filter.$or = [
        { invoiceNumber: term },
        ...(memberIds.length ? [{ memberId: { $in: memberIds } }] : []),
      ];
    }

    const listQuery = () =>
      this.applyInvoiceListPopulates(
        this.invoiceModel.find(filter).sort({ createdAt: -1 }),
      );

    if (!isPaged(query)) {
      return listQuery().limit(UNPAGED_SAFETY_LIMIT).exec();
    }

    const { skip, limit } = resolvePaging(query);
    const [total, items] = await Promise.all([
      this.invoiceModel.countDocuments(filter).exec(),
      listQuery().skip(skip).limit(limit).exec(),
    ]);
    return buildResult(items, total, query);
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
    actor?: ActivityActor,
  ): Promise<InvoiceDocument> {
    const invoice = await this.invoiceModel
      .findOne({ _id: id, companyId, deletedAt: null, ...locScope })
      .exec();

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    /**
     * An invoice raised from a payment must keep saying what was actually
     * collected. Wording and dates can be corrected; money cannot — void the
     * payment and record the correct one, which reverses this invoice too.
     */
    const boundToPayment = !!invoice.paymentId;

    const updateData: Record<string, unknown> = {};
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;
    if (updateDto.invoiceDate !== undefined) {
      updateData.invoiceDate = new Date(updateDto.invoiceDate);
    }
    if (updateDto.dueDate !== undefined) {
      updateData.dueDate = new Date(updateDto.dueDate);
    }

    if (boundToPayment) {
      const amountChanged = updateDto.items?.some(
        (item, index) =>
          item.amount !== undefined &&
          Math.abs(item.amount - (invoice.items[index]?.amount ?? 0)) > 0.001,
      );
      // Amounts stay locked to the payment; tax mode / rate may be corrected.
      if (amountChanged) {
        throw new BadRequestException(
          'This invoice follows its payment, so line amounts cannot be edited here. ' +
            'Void the payment and record the correct one — the invoice is reissued with it. ' +
            'You can still switch GST included ↔ excluded.',
        );
      }
      if (updateDto.items) {
        updateData.items = updateDto.items.map((item, index) => ({
          description: item.description,
          amount: invoice.items[index]?.amount ?? 0,
        }));
      }
      if (
        updateDto.taxMode !== undefined ||
        updateDto.taxPercentage !== undefined
      ) {
        const payment = await this.paymentModel
          .findOne({ _id: invoice.paymentId, companyId })
          .exec();
        if (!payment) {
          throw new BadRequestException(
            'Linked payment missing — cannot recalculate tax',
          );
        }
        const taxPercentage =
          updateDto.taxPercentage !== undefined
            ? updateDto.taxPercentage
            : invoice.taxPercentage;
        const taxMode = isInvoiceTaxMode(updateDto.taxMode)
          ? updateDto.taxMode
          : isInvoiceTaxMode(invoice.taxMode)
            ? invoice.taxMode
            : DEFAULT_INVOICE_TAX_MODE;
        const breakdown = computeTaxBreakdown(
          payment.amount,
          taxPercentage,
          taxMode,
        );
        const desc =
          invoice.items[0]?.description || 'Membership - Payment';
        updateData.subtotal = breakdown.subtotal;
        updateData.taxPercentage = breakdown.taxPercentage;
        updateData.taxAmount = breakdown.taxAmount;
        updateData.taxMode = breakdown.taxMode;
        updateData.totalAmount = breakdown.totalAmount;
        updateData.items = [{ description: desc, amount: breakdown.subtotal }];
      }
    } else if (
      updateDto.items ||
      updateDto.taxPercentage !== undefined ||
      updateDto.taxMode !== undefined
    ) {
      const items = (updateDto.items || invoice.items).map((item: any) => ({
        description: item.description,
        amount: Number(item.amount) || 0,
      }));
      const taxPercentage =
        updateDto.taxPercentage !== undefined
          ? updateDto.taxPercentage
          : invoice.taxPercentage;
      const taxMode = isInvoiceTaxMode(updateDto.taxMode)
        ? updateDto.taxMode
        : isInvoiceTaxMode(invoice.taxMode)
          ? invoice.taxMode
          : DEFAULT_INVOICE_TAX_MODE;

      const gross = items.reduce((sum, item) => sum + item.amount, 0);
      // For standalone edits: if switching mode, treat current total as the
      // configured price so included↔excluded flips correctly.
      const priceConfigured =
        updateDto.taxMode !== undefined && updateDto.items === undefined
          ? invoice.taxMode === 'included'
            ? invoice.totalAmount
            : invoice.subtotal
          : gross;
      const breakdown = computeTaxBreakdown(
        updateDto.items ? gross : priceConfigured,
        taxPercentage,
        taxMode,
      );

      updateData.items = items.map((item, _i, arr) => ({
        description: item.description,
        amount:
          arr.length === 1
            ? breakdown.subtotal
            : Math.round(
                ((item.amount / Math.max(1, gross)) * breakdown.subtotal +
                  Number.EPSILON) *
                  100,
              ) / 100,
      }));
      updateData.subtotal = breakdown.subtotal;
      updateData.taxPercentage = breakdown.taxPercentage;
      updateData.taxAmount = breakdown.taxAmount;
      updateData.taxMode = breakdown.taxMode;
      updateData.totalAmount = breakdown.totalAmount;
    }

    if (!Object.keys(updateData).length) {
      return this.findById(companyId, id, locScope);
    }

    const updatedInvoice = await this.applyInvoicePopulates(
      this.invoiceModel.findOneAndUpdate({ _id: id, companyId }, updateData, {
        returnDocument: 'after',
      }),
    ).exec();

    if (!updatedInvoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    if (actor) {
      // Corrections on a financial document always leave a trail.
      await this.activityLogsService
        .log({
          companyId,
          // locationId is populated on this query, so read the id off the
          // populated document rather than stringifying the object.
          locationId: toObjectIdString(updatedInvoice.locationId),
          actor,
          action: 'INVOICE_UPDATE',
          entityType: 'invoice',
          entityId: id,
          summary: `${actor.name} corrected invoice ${invoice.invoiceNumber}`,
          metadata: { changed: Object.keys(updateData) },
        })
        .catch(() => undefined);
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
