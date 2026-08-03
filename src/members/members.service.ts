import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UserType } from '../common/enums/user-type.enum';
import { MemberStatus } from '../common/enums/member-status.enum';
import { Role } from '../common/enums/role.enum';
import { CountersService } from '../counters/counters.service';
import { GymSettingsService } from '../gym-settings/gym-settings.service';
import {
  MemberSubscription,
  MemberSubscriptionDocument,
} from '../member-subscriptions/schemas/member-subscription.schema';
import {
  SubscriptionPlan,
  SubscriptionPlanDocument,
} from '../subscription-plans/schemas/subscription-plan.schema';
import { SubscriptionStatus } from '../common/enums/subscription-status.enum';
import { PaymentStatus } from '../common/enums/payment-status.enum';
import { PaymentMode } from '../common/enums/payment-mode.enum';
import {
  ActivityLogsService,
  ActivityActor,
} from '../activity-logs/activity-logs.service';
import { LocationsService } from '../locations/locations.service';
import { StorageService } from '../storage/storage.service';
import { PaymentsService } from '../payments/payments.service';

type LocScope = { locationId?: string };

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(MemberSubscription.name)
    private memberSubscriptionModel: Model<MemberSubscriptionDocument>,
    @InjectModel(SubscriptionPlan.name)
    private subscriptionPlanModel: Model<SubscriptionPlanDocument>,
    private countersService: CountersService,
    private gymSettingsService: GymSettingsService,
    private activityLogsService: ActivityLogsService,
    private locationsService: LocationsService,
    private storageService: StorageService,
    @Inject(forwardRef(() => PaymentsService))
    private paymentsService: PaymentsService,
  ) {}

  async create(
    companyId: string,
    locationId: string,
    createDto: CreateMemberDto,
    receivedById?: string,
    actor?: ActivityActor,
  ) {
    await this.locationsService.assertBelongsToCompany(companyId, locationId);

    const phone = createDto.phone?.trim();
    if (!phone) throw new BadRequestException('Phone is required');

    // No synthetic @members.local — leave email empty when not provided
    const emailRaw = createDto.email?.trim().toLowerCase();
    const email = emailRaw || null;

    const phoneClash = await this.userModel
      .findOne({
        companyId,
        userType: UserType.MEMBER,
        phone,
      })
      .exec();
    if (phoneClash) {
      throw new ConflictException(
        `Phone ${phone} is already registered for a member`,
      );
    }

    if (email) {
      const existingUser = await this.userModel
        .findOne({ email, companyId })
        .exec();
      if (existingUser) {
        throw new ConflictException(`Email ${email} is already in use`);
      }

      // Staff login emails are global — block member email stealing a staff identity
      const staffClash = await this.userModel
        .findOne({
          email,
          userType: { $in: [UserType.ADMIN, UserType.EMPLOYEE] },
        })
        .exec();
      if (staffClash) {
        throw new ConflictException(`Email ${email} is already registered`);
      }
    }

    const settings = await this.gymSettingsService.get(companyId);
    const idNo = await this.countersService.nextMemberId(
      settings.memberIdPrefix || 'GYM',
      companyId,
    );

    const member = new this.userModel({
      name: createDto.name,
      email,
      phone,
      address: createDto.address ?? null,
      emergencyContact: createDto.emergencyContact ?? null,
      memberStatus: createDto.memberStatus || MemberStatus.ACTIVE,
      registrationDate: createDto.registrationDate
        ? new Date(createDto.registrationDate)
        : new Date(),
      dob: createDto.dob ? new Date(createDto.dob) : null,
      instagramHandle: createDto.instagramHandle ?? null,
      trainingType: createDto.trainingType ?? null,
      trainerId: createDto.trainerId ?? null,
      salesPersonId: createDto.salesPersonId ?? null,
      photoUrl: createDto.photoUrl?.trim() || null,
      idNo,
      userType: UserType.MEMBER,
      role: Role.USER,
      password: 'N/A',
      companyId,
      locationId,
    });

    const saved = await member.save();

    try {
      let initialPaymentId: string | null = null;
      if (createDto.planId) {
        initialPaymentId = await this.createSubscriptionForMember(
          companyId,
          locationId,
          saved,
          createDto,
          receivedById,
        );
      }

      if (actor) {
        try {
          await this.activityLogsService.log({
            companyId,
            locationId,
            actor,
            action: 'MEMBER_CREATE',
            entityType: 'member',
            entityId: String(saved._id),
            summary: `${actor.name} added member ${saved.name}${saved.idNo ? ` (${saved.idNo})` : ''}`,
            metadata: { planId: createDto.planId, phone: saved.phone },
          });
        } catch {
          // non-fatal
        }
      }

      const client = await this.findById(companyId, String(saved._id));
      return { ...client, initialPaymentId };
    } catch (err) {
      // Don't leave orphan member / sub / payment if later steps fail
      const memberOid = saved._id;
      const companyOid = new Types.ObjectId(companyId);
      await this.memberSubscriptionModel.db.collection('payments').deleteMany({
        memberId: memberOid,
        companyId: companyOid,
      });
      await this.memberSubscriptionModel.db.collection('invoices').deleteMany({
        memberId: memberOid,
        companyId: companyOid,
      });
      await this.memberSubscriptionModel
        .deleteMany({ memberId: memberOid as any, companyId: companyId as any })
        .exec();
      await this.userModel.deleteOne({ _id: saved._id, companyId }).exec();
      throw err;
    }
  }

  private async createSubscriptionForMember(
    companyId: string,
    locationId: string,
    member: UserDocument,
    createDto: CreateMemberDto,
    receivedById?: string,
  ): Promise<string | null> {
    const plan = await this.subscriptionPlanModel
      .findOne({ _id: createDto.planId, companyId })
      .exec();
    if (!plan) {
      throw new NotFoundException(
        `Subscription plan with ID ${createDto.planId} not found`,
      );
    }

    const startDate = new Date(
      createDto.startingDate || new Date().toISOString().slice(0, 10),
    );
    let expiryDate: Date;
    if (createDto.expiryDate) {
      expiryDate = new Date(createDto.expiryDate);
    } else {
      expiryDate = new Date(startDate);
      switch (plan.durationType) {
        case 'DAYS':
          expiryDate.setDate(expiryDate.getDate() + plan.duration);
          break;
        case 'MONTHS':
          expiryDate.setMonth(expiryDate.getMonth() + plan.duration);
          break;
        case 'YEARS':
          expiryDate.setFullYear(expiryDate.getFullYear() + plan.duration);
          break;
      }
    }

    const received = createDto.received ?? 0;
    const planPrice = createDto.amount ?? plan.price;
    if (received < 0) {
      throw new BadRequestException('Received amount cannot be negative');
    }
    if (received > planPrice) {
      throw new BadRequestException(
        `Received amount cannot exceed plan price ₹${planPrice}`,
      );
    }

    // Start unpaid; PaymentsService updates totals + generates invoice
    const subscription = new this.memberSubscriptionModel({
      companyId,
      locationId,
      memberId: member._id,
      planId: plan._id,
      startDate,
      expiryDate,
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      planPrice,
      totalPaid: 0,
      pendingAmount: planPrice,
      paymentStatus: PaymentStatus.UNPAID,
    });
    const savedSubscription = await subscription.save();

    await this.userModel
      .findOneAndUpdate(
        { _id: member._id, companyId },
        { currentSubscriptionId: savedSubscription._id },
      )
      .exec();

    if (received > 0) {
      if (!receivedById) {
        throw new BadRequestException(
          'Cannot record initial payment without a staff user',
        );
      }
      const payment = await this.paymentsService.create(
        companyId,
        {
          memberId: String(member._id),
          subscriptionId: String(savedSubscription._id),
          amount: received,
          paymentMode: createDto.paymentMode || PaymentMode.CASH,
          paymentDate: (
            createDto.startingDate || new Date().toISOString().slice(0, 10)
          ).slice(0, 10),
          notes: 'Initial payment on member create',
        },
        receivedById,
        undefined,
        locationId,
      );
      return String(payment._id);
    }
    return null;
  }

  async findAll(companyId: string, locScope: LocScope = {}) {
    const members = await this.userModel
      .find({ companyId, userType: UserType.MEMBER, ...locScope })
      .select('-password -refreshToken')
      .populate({
        path: 'currentSubscriptionId',
        strictPopulate: false,
        populate: { path: 'planId', strictPopulate: false },
      })
      .populate({ path: 'trainerId', strictPopulate: false })
      .populate({ path: 'salesPersonId', strictPopulate: false })
      .sort({ createdAt: -1 })
      .exec();

    return members.map((m) => this.toClientMember(m));
  }

  async findById(companyId: string, id: string, locScope: LocScope = {}) {
    const member = await this.userModel
      .findOne({
        _id: id,
        companyId,
        userType: UserType.MEMBER,
        ...locScope,
      })
      .select('-password -refreshToken')
      .populate({
        path: 'currentSubscriptionId',
        strictPopulate: false,
        populate: { path: 'planId', strictPopulate: false },
      })
      .populate({ path: 'trainerId', strictPopulate: false })
      .populate({ path: 'salesPersonId', strictPopulate: false })
      .exec();

    if (!member) {
      throw new NotFoundException(`Member with ID ${id} not found`);
    }

    return this.toClientMember(member);
  }

  async update(
    companyId: string,
    id: string,
    updateDto: UpdateMemberDto,
    actor?: ActivityActor,
    locScope: LocScope = {},
  ) {
    if (updateDto.email !== undefined) {
      const emailRaw = updateDto.email?.trim().toLowerCase();
      const email = emailRaw || null;
      if (email) {
        const existingUser = await this.userModel
          .findOne({ email, companyId, _id: { $ne: id } })
          .exec();
        if (existingUser) {
          throw new ConflictException(`Email ${email} is already in use`);
        }
      }
      (updateDto as { email?: string | null }).email = email as any;
    }

    const patch: Record<string, unknown> = { ...updateDto };
    if ((updateDto as any).phone) {
      const phone = String((updateDto as any).phone).trim();
      const phoneClash = await this.userModel
        .findOne({
          companyId,
          userType: UserType.MEMBER,
          phone,
          _id: { $ne: id },
        })
        .exec();
      if (phoneClash) {
        throw new ConflictException(
          `Phone ${phone} is already registered for a member`,
        );
      }
      patch.phone = phone;
    }
    if ((updateDto as any).registrationDate) {
      patch.registrationDate = new Date((updateDto as any).registrationDate);
    }
    if ((updateDto as any).dob) patch.dob = new Date((updateDto as any).dob);
    if (updateDto.photoUrl !== undefined) {
      patch.photoUrl = updateDto.photoUrl?.trim() || null;
    }

    // Strip subscription-only fields from user update
    delete patch.planId;
    delete patch.startingDate;
    delete patch.expiryDate;
    delete patch.amount;
    delete patch.received;
    delete patch.paymentMode;
    delete patch.companyId;
    delete patch.locationId;

    const member = await this.userModel
      .findOneAndUpdate(
        { _id: id, companyId, userType: UserType.MEMBER, ...locScope },
        patch,
        { returnDocument: 'after' },
      )
      .select('-password -refreshToken')
      .populate({
        path: 'currentSubscriptionId',
        strictPopulate: false,
        populate: { path: 'planId', strictPopulate: false },
      })
      .populate({ path: 'trainerId', strictPopulate: false })
      .populate({ path: 'salesPersonId', strictPopulate: false })
      .exec();

    if (!member) {
      throw new NotFoundException(`Member with ID ${id} not found`);
    }

    if (actor) {
      await this.activityLogsService.log({
        companyId,
        locationId: member.locationId ? String(member.locationId) : null,
        actor,
        action: 'MEMBER_UPDATE',
        entityType: 'member',
        entityId: id,
        summary: `${actor.name} updated member ${member.name}`,
      });
    }

    return this.toClientMember(member);
  }

  async delete(
    companyId: string,
    id: string,
    actor?: ActivityActor,
    locScope: LocScope = {},
  ): Promise<void> {
    const result = await this.userModel
      .findOneAndDelete({
        _id: id,
        companyId,
        userType: UserType.MEMBER,
        ...locScope,
      })
      .exec();

    if (!result) {
      throw new NotFoundException(`Member with ID ${id} not found`);
    }

    if (actor) {
      await this.activityLogsService.log({
        companyId,
        locationId: result.locationId ? String(result.locationId) : null,
        actor,
        action: 'MEMBER_DELETE',
        entityType: 'member',
        entityId: id,
        summary: `${actor.name} deleted member ${result.name}`,
      });
    }
  }

  async uploadPhoto(
    companyId: string,
    id: string,
    file: Express.Multer.File,
    locScope: LocScope = {},
  ) {
    const member = await this.userModel
      .findOne({
        _id: id,
        companyId,
        userType: UserType.MEMBER,
        ...locScope,
      })
      .exec();
    if (!member) {
      throw new NotFoundException(`Member with ID ${id} not found`);
    }

    const valid = this.storageService.assertValidImageFile(file);
    const uploaded = await this.storageService.uploadCompanyAsset({
      companyId,
      folder: 'members',
      entityId: id,
      buffer: valid.buffer,
      mimeType: valid.mimetype,
      originalName: valid.originalname,
    });

    member.photoUrl = uploaded.url;
    await member.save();
    return this.findById(companyId, id, locScope);
  }

  async findByEmail(
    companyId: string,
    email: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email, companyId, userType: UserType.MEMBER })
      .select('-password -refreshToken')
      .exec();
  }

  /** Shape response for frontend CRM table/modal */
  private toClientMember(member: any) {
    const sub = member.currentSubscriptionId;
    const plan = sub?.planId;
    const trainer = member.trainerId;
    const sales = member.salesPersonId;

    return {
      _id: String(member._id),
      idNo: member.idNo ?? null,
      name: member.name,
      email: member.email ?? null,
      phone: member.phone,
      contactNumber: member.phone,
      address: member.address,
      emergencyContact: member.emergencyContact,
      memberStatus: member.memberStatus,
      registrationDate: member.registrationDate,
      date: member.registrationDate,
      dob: member.dob,
      instagramHandle: member.instagramHandle,
      photoUrl: member.photoUrl ?? null,
      trainingType: member.trainingType,
      locationId: member.locationId ? String(member.locationId) : null,
      trainerId: trainer?._id ? String(trainer._id) : member.trainerId,
      salesPersonId: sales?._id ? String(sales._id) : member.salesPersonId,
      trainer: trainer?.name ?? null,
      salesPerson: sales?.name ?? null,
      currentSubscriptionId: sub?._id ? String(sub._id) : null,
      membershipPlan: plan?.name ?? null,
      planId: plan?._id ? String(plan._id) : null,
      amount: sub?.planPrice ?? null,
      received: sub?.totalPaid ?? null,
      pending: sub?.pendingAmount ?? null,
      mop: null,
      startingDate: sub?.startDate ?? null,
      expiryDate: sub?.expiryDate ?? null,
      paymentStatus: sub?.paymentStatus ?? null,
      createdAt: member.createdAt,
      updatedAt: member.updatedAt,
    };
  }
}
