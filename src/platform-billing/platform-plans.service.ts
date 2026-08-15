import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PlatformPlan,
  PlatformPlanDocument,
} from './schemas/platform-plan.schema';
import {
  BillingInterval,
  PlatformFeature,
  SEED_PLATFORM_PLANS,
  YEARLY_MONTHS_CHARGED,
  computePeriodAmount,
} from '../config/platform-billing.config';

/**
 * The plans table: what the platform sells.
 *
 * Rows, not constants — pricing and feature bundles change far more often than
 * code deploys, and a gym must keep the terms it signed up to even after the
 * public price moves.
 */
@Injectable()
export class PlatformPlansService implements OnModuleInit {
  private readonly logger = new Logger(PlatformPlansService.name);

  constructor(
    @InjectModel(PlatformPlan.name)
    private planModel: Model<PlatformPlanDocument>,
  ) {}

  /** A fresh install has nothing to sell — seed once, never overwrite. */
  async onModuleInit() {
    const existing = await this.planModel.countDocuments().exec();
    if (existing > 0) return;

    await this.planModel.insertMany(
      SEED_PLATFORM_PLANS.map((plan) => ({
        ...plan,
        features: [...plan.features],
      })),
    );
    this.logger.log(
      `Seeded ${SEED_PLATFORM_PLANS.length} platform plans (edit them in the plans table, not in code)`,
    );
  }

  /** Plans a gym may pick from. */
  async listPublic() {
    const plans = await this.planModel
      .find({ isActive: true, isPublic: true })
      .sort({ sortOrder: 1 })
      .lean()
      .exec();
    return plans.map((p) => this.toClient(p));
  }

  /** Everything, including archived — SUPER_ADMIN view. */
  async listAll() {
    const plans = await this.planModel.find().sort({ sortOrder: 1 }).lean().exec();
    return plans.map((p) => this.toClient(p));
  }

  async findByCode(code: string): Promise<PlatformPlanDocument> {
    const plan = await this.planModel
      .findOne({ code: (code || '').toUpperCase().trim() })
      .exec();
    if (!plan) throw new NotFoundException(`Plan ${code} not found`);
    if (!plan.isActive) {
      throw new BadRequestException(`Plan ${code} is no longer available`);
    }
    return plan;
  }

  async findById(id: string): Promise<PlatformPlanDocument | null> {
    return this.planModel.findById(id).exec();
  }

  async create(input: Partial<PlatformPlan>) {
    const code = (input.code || '').toUpperCase().trim();
    if (!code) throw new BadRequestException('code is required');
    const clash = await this.planModel.exists({ code });
    if (clash) throw new BadRequestException(`Plan ${code} already exists`);
    const created = await this.planModel.create({ ...input, code });
    return this.toClient(created.toObject());
  }

  async update(id: string, input: Partial<PlatformPlan>) {
    // The code is what subscriptions reference; renaming it would orphan them.
    const { code: _code, ...rest } = input as any;
    const plan = await this.planModel
      .findByIdAndUpdate(id, rest, { returnDocument: 'after' })
      .lean()
      .exec();
    if (!plan) throw new NotFoundException('Plan not found');
    return this.toClient(plan);
  }

  /**
   * Plans are archived, never deleted: subscriptions point at them, and a
   * deleted plan would make old invoices unexplainable.
   */
  async archive(id: string) {
    const plan = await this.planModel
      .findByIdAndUpdate(
        id,
        { isActive: false, isPublic: false },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    if (!plan) throw new NotFoundException('Plan not found');
    return this.toClient(plan);
  }

  private toClient(plan: any) {
    const monthly = plan.pricePerBranch;
    return {
      id: String(plan._id),
      code: plan.code,
      name: plan.name,
      description: plan.description ?? null,
      pricePerBranch: monthly,
      interval: plan.interval as BillingInterval,
      currency: plan.currency,
      trialDays: plan.trialDays,
      features: (plan.features || []) as PlatformFeature[],
      maxBranches: plan.maxBranches ?? null,
      maxMembers: plan.maxMembers ?? null,
      isPublic: plan.isPublic !== false,
      isActive: plan.isActive !== false,
      isRecommended: plan.isRecommended === true,
      sortOrder: plan.sortOrder ?? 0,
      /** What one branch costs on each cycle — shown on the pricing table. */
      pricing: {
        monthlyPerBranch: monthly,
        yearlyPerBranch: computePeriodAmount({
          pricePerBranch: monthly,
          branches: 1,
          interval: 'YEARLY',
        }),
        yearlyMonthsCharged: YEARLY_MONTHS_CHARGED,
        yearlySavingMonths: 12 - YEARLY_MONTHS_CHARGED,
      },
    };
  }
}
