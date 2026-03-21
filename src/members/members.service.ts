import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { RegisterMemberDto } from './dto/register-member.dto';
import { UserType } from '../common/enums/user-type.enum';
import { MemberStatus } from '../common/enums/member-status.enum';
import { Role } from '../common/enums/role.enum';
import {
  MemberPayment,
  MemberPaymentDocument,
} from './schemas/member-payment.schema';
import { MembersImportService } from './members-import.service';

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(MemberPayment.name)
    private memberPaymentModel: Model<MemberPaymentDocument>,
    private membersImportService: MembersImportService,
  ) {}

  async create(createDto: CreateMemberDto): Promise<UserDocument> {
    // Check if email already exists
    const existingUser = await this.userModel.findOne({ email: createDto.email }).exec();
    if (existingUser) {
      throw new ConflictException(`Email ${createDto.email} is already in use`);
    }

    // Create member with dummy password (members don't login)
    const member = new this.userModel({
      ...createDto,
      userType: UserType.MEMBER,
      role: Role.USER,
      password: 'N/A', // Members don't login, so password is not used
      memberStatus: createDto.memberStatus || MemberStatus.ACTIVE,
    });

    return member.save();
  }

  async findAll(): Promise<any[]> {
    const members = await this.userModel
      .find({ userType: UserType.MEMBER })
      .select('-password -refreshToken')
      .sort({ createdAt: -1 }) // Sort by newest first
      .populate({
        path: 'currentSubscriptionId',
        strictPopulate: false,
        populate: { path: 'planId', strictPopulate: false },
      })
      .exec();

    // Enrich with payment summary for members from simplified flow
    return Promise.all(
      members.map(async (member) => {
        // Only add payment summary for simplified flow members (those with membershipMonths)
        if (member.membershipMonths) {
          const payments = await this.memberPaymentModel
            .find({ memberId: member._id } as any)
            .exec();

          const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
          const totalReceived = payments.reduce((sum, p) => sum + (p.received || 0), 0);
          const totalPending = Math.max(0, totalAmount - totalReceived);
          const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;

          return {
            ...member.toObject(),
            paymentSummary: {
              totalReceived,
              totalPending,
              hasPendingBalance: totalPending > 0,
              lastPaymentDate: lastPayment?.paymentDate || null,
              lastPaymentAmount: lastPayment?.received || 0,
              paymentCount: payments.length,
            },
          };
        }
        return member.toObject();
      }),
    );
  }

  async findById(id: string): Promise<any> {
    const member = await this.userModel
      .findOne({ _id: id, userType: UserType.MEMBER })
      .select('-password -refreshToken')
      .populate({
        path: 'currentSubscriptionId',
        strictPopulate: false,
        populate: { path: 'planId', strictPopulate: false },
      })
      .exec();

    if (!member) {
      throw new NotFoundException(`Member with ID ${id} not found`);
    }

    // Add payment summary for simplified flow members
    if (member.membershipMonths) {
      const payments = await this.memberPaymentModel
        .find({ memberId: member._id } as any)
        .exec();

      const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const totalReceived = payments.reduce((sum, p) => sum + (p.received || 0), 0);
      const totalPending = Math.max(0, totalAmount - totalReceived);
      const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;

      return {
        ...member.toObject(),
        paymentSummary: {
          totalReceived,
          totalPending,
          hasPendingBalance: totalPending > 0,
          lastPaymentDate: lastPayment?.paymentDate || null,
          lastPaymentAmount: lastPayment?.received || 0,
          paymentCount: payments.length,
        },
      };
    }

    return member;
  }

  async update(id: string, updateDto: UpdateMemberDto): Promise<UserDocument> {
    // If email is being updated, check for conflicts
    if (updateDto.email) {
      const existingUser = await this.userModel
        .findOne({ email: updateDto.email, _id: { $ne: id } })
        .exec();

      if (existingUser) {
        throw new ConflictException(`Email ${updateDto.email} is already in use`);
      }
    }

    const member = await this.userModel
      .findOneAndUpdate(
        { _id: id, userType: UserType.MEMBER },
        updateDto,
        { new: true },
      )
      .select('-password -refreshToken')
      .populate({
        path: 'currentSubscriptionId',
        strictPopulate: false,
        populate: { path: 'planId', strictPopulate: false },
      })
      .exec();

    if (!member) {
      throw new NotFoundException(`Member with ID ${id} not found`);
    }

    return member;
  }

  async delete(id: string): Promise<void> {
    const result = await this.userModel
      .findOneAndDelete({ _id: id, userType: UserType.MEMBER })
      .exec();

    if (!result) {
      throw new NotFoundException(`Member with ID ${id} not found`);
    }
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email, userType: UserType.MEMBER })
      .select('-password -refreshToken')
      .exec();
  }

  /**
   * Register a new member with membership and payment details (simplified flow)
   */
  async register(registerDto: RegisterMemberDto): Promise<{
    member: UserDocument;
    payment: MemberPaymentDocument;
  }> {
    // Generate email from contact number if not provided
    const email = `member${registerDto.contactNumber}@gym.com`;

    // Check if contact number already exists
    const existingMember = await this.userModel
      .findOne({ phone: registerDto.contactNumber, userType: UserType.MEMBER })
      .exec();

    if (existingMember) {
      throw new ConflictException(
        `Member with contact number ${registerDto.contactNumber} already exists`,
      );
    }

    // Calculate pending amount if not provided
    const pending =
      registerDto.pending !== undefined
        ? registerDto.pending
        : registerDto.amount - registerDto.received;

    // Create member with all details
    const member = new this.userModel({
      // Basic details
      name: registerDto.name,
      email: email,
      phone: registerDto.contactNumber,
      address: registerDto.address,
      emergencyContact: registerDto.emergencyContact,
      userType: UserType.MEMBER,
      role: Role.USER,
      password: 'N/A', // Members don't login
      memberStatus: registerDto.memberStatus || MemberStatus.ACTIVE,

      // New simplified flow fields
      idNo: registerDto.idNo,
      dob: registerDto.dob ? new Date(registerDto.dob) : null,
      instagramHandle: registerDto.instagramHandle,
      salesPerson: registerDto.salesPerson,
      trainer: registerDto.trainer,
      trainingType: registerDto.trainingType,
      memberType: registerDto.memberType,

      // Membership details (legacy fields - kept for backward compatibility)
      membershipMonths: registerDto.membershipMonths,
      startingDate: new Date(registerDto.startingDate),
      expiryDate: new Date(registerDto.expiryDate),
      membershipAmount: registerDto.amount,

      // NEW: Create first membership in memberships array
      memberships: [{
        startDate: new Date(registerDto.startingDate),
        expiryDate: new Date(registerDto.expiryDate),
        months: registerDto.membershipMonths,
        totalAmount: registerDto.amount,
        amountPaid: registerDto.received,
        pendingAmount: pending,
        status: 'ACTIVE',
        package: `${registerDto.membershipMonths} MONTH`,
        trainingType: registerDto.trainingType,
        trainer: registerDto.trainer,
        salesPerson: registerDto.salesPerson,
        memberType: registerDto.memberType,
      }],
    });

    const savedMember = await member.save();

    // Create payment/invoice record linked to the first membership
    const payment = new this.memberPaymentModel({
      memberId: savedMember._id,
      membershipId: savedMember.memberships[0]._id, // Link to first membership
      amount: registerDto.amount,
      received: registerDto.received,
      pending: pending,
      mop: registerDto.mop,
      paymentDate: new Date(registerDto.date),
      transactionId: registerDto.transactionId,
      notes: `Initial payment for ${registerDto.membershipMonths} months membership`,
    });

    const savedPayment = await payment.save();

    return {
      member: savedMember,
      payment: savedPayment,
    };
  }

  /**
   * Get all payments for a specific member
   */
  async getMemberPayments(memberId: string): Promise<MemberPaymentDocument[]> {
    const member = await this.userModel
      .findOne({ _id: memberId, userType: UserType.MEMBER })
      .exec();

    if (!member) {
      throw new NotFoundException(`Member with ID ${memberId} not found`);
    }

    return this.memberPaymentModel
      .find({ memberId: memberId as any })
      .sort({ paymentDate: -1, createdAt: -1 })
      .exec();
  }

  /**
   * Create a new payment for an existing member
   * If renewalMonths is provided, extends the membership
   */
  async createPayment(createPaymentDto: {
    memberId: string;
    amount: number;
    received: number;
    pending?: number;
    mop: string;
    paymentDate: string;
    transactionId?: string;
    notes?: string;
    renewalMonths?: number;
    newExpiryDate?: string;
  }): Promise<{ payment: MemberPaymentDocument; member: UserDocument }> {
    // Validate member exists
    const member = await this.userModel
      .findOne({ _id: createPaymentDto.memberId, userType: UserType.MEMBER })
      .exec();

    if (!member) {
      throw new NotFoundException(
        `Member with ID ${createPaymentDto.memberId} not found`,
      );
    }

    // Find active membership
    const activeMembership = member.memberships?.find(m => m.status === 'ACTIVE');

    if (!activeMembership && !createPaymentDto.renewalMonths) {
      throw new NotFoundException(
        `No active membership found for member ${createPaymentDto.memberId}. Please provide renewalMonths to create a new membership.`,
      );
    }

    // Auto-calculate pending if not provided
    const pending =
      createPaymentDto.pending !== undefined
        ? createPaymentDto.pending
        : createPaymentDto.amount - createPaymentDto.received;

    // If this payment has received amount but zero amount (clearing old pending),
    // apply the received amount to old pending payments AND update their memberships
    let remainingToApply = createPaymentDto.received;

    if (createPaymentDto.amount === 0 && createPaymentDto.received > 0) {
      // This is a payment to clear old pending balances
      // Find all payments with pending amounts for this member
      const oldPayments = await this.memberPaymentModel
        .find({
          memberId: createPaymentDto.memberId as any,
          pending: { $gt: 0 }
        })
        .sort({ paymentDate: 1 }) // Oldest first
        .exec();

      // Apply received amount to old pending payments
      for (const oldPayment of oldPayments) {
        if (remainingToApply <= 0) break;

        const amountToClear = Math.min(oldPayment.pending, remainingToApply);

        oldPayment.received += amountToClear;
        oldPayment.pending -= amountToClear;

        await oldPayment.save();

        // Update the linked membership's amountPaid and pendingAmount
        if (oldPayment.membershipId) {
          const membershipToUpdate = member.memberships?.find(
            m => m._id.toString() === oldPayment.membershipId?.toString()
          );

          if (membershipToUpdate) {
            membershipToUpdate.amountPaid += amountToClear;
            membershipToUpdate.pendingAmount -= amountToClear;
            membershipToUpdate.pendingAmount = Math.max(0, membershipToUpdate.pendingAmount);
          }
        }

        remainingToApply -= amountToClear;
      }

      // Save member with updated memberships
      await member.save();
    }

    // Create new payment record linked to active membership
    const payment = new this.memberPaymentModel({
      memberId: createPaymentDto.memberId,
      membershipId: activeMembership?._id || null,
      amount: createPaymentDto.amount,
      received: createPaymentDto.received,
      pending: pending,
      mop: createPaymentDto.mop,
      paymentDate: new Date(createPaymentDto.paymentDate),
      transactionId: createPaymentDto.transactionId,
      notes: createPaymentDto.notes || 'Additional payment',
    });

    const savedPayment = await payment.save();

    // Update active membership's amountPaid and pendingAmount
    if (activeMembership && createPaymentDto.amount > 0) {
      activeMembership.amountPaid += createPaymentDto.received;
      activeMembership.pendingAmount -= createPaymentDto.received;
      activeMembership.pendingAmount = Math.max(0, activeMembership.pendingAmount);

      await member.save();
    }

    // Handle membership renewal - mark old as EXPIRED and create new ACTIVE membership
    if (createPaymentDto.renewalMonths || createPaymentDto.newExpiryDate) {
      // Mark current active membership as EXPIRED
      if (activeMembership) {
        activeMembership.status = 'EXPIRED';
      }

      // Calculate new membership dates
      const currentExpiry = activeMembership?.expiryDate
        ? new Date(activeMembership.expiryDate)
        : new Date();

      let newExpiryDate: Date;
      if (createPaymentDto.newExpiryDate) {
        newExpiryDate = new Date(createPaymentDto.newExpiryDate);
      } else if (createPaymentDto.renewalMonths) {
        newExpiryDate = new Date(currentExpiry);
        newExpiryDate.setMonth(newExpiryDate.getMonth() + createPaymentDto.renewalMonths);
      } else {
        newExpiryDate = currentExpiry;
      }

      const newStartDate = new Date(currentExpiry);
      newStartDate.setDate(newStartDate.getDate() + 1); // Start day after old membership expires

      // Create new membership
      const newMembership = {
        startDate: newStartDate,
        expiryDate: newExpiryDate,
        months: createPaymentDto.renewalMonths || 0,
        totalAmount: createPaymentDto.amount,
        amountPaid: createPaymentDto.received,
        pendingAmount: createPaymentDto.amount - createPaymentDto.received,
        status: 'ACTIVE',
        package: createPaymentDto.renewalMonths ? `${createPaymentDto.renewalMonths} MONTH` : null,
        trainingType: activeMembership?.trainingType || null,
        trainer: activeMembership?.trainer || null,
        salesPerson: activeMembership?.salesPerson || null,
        memberType: 'Renewal',
      };

      member.memberships.push(newMembership as any);

      // Update legacy fields for backward compatibility
      member.expiryDate = newExpiryDate;
      member.startingDate = newStartDate;
      member.membershipMonths = (member.membershipMonths || 0) + (createPaymentDto.renewalMonths || 0);
      member.membershipAmount = (member.membershipAmount || 0) + createPaymentDto.amount;

      await member.save();

      // Update saved payment to link to new membership
      savedPayment.membershipId = member.memberships[member.memberships.length - 1]._id;
      await savedPayment.save();

      // Fetch updated member
      const updatedMember = await this.userModel
        .findById(createPaymentDto.memberId)
        .select('-password -refreshToken')
        .exec();

      return {
        payment: savedPayment,
        member: updatedMember!,
      };
    }

    return {
      payment: savedPayment,
      member: member,
    };
  }

  /**
   * Get all registered members (with embedded membership details)
   * Supports pagination and search
   */
  async findAllRegistered(query?: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = query?.page || 1;
    const limit = query?.limit || 10;
    const skip = (page - 1) * limit;
    const sortOrder = query?.sortOrder === 'asc' ? 1 : -1;
    const sortBy = query?.sortBy || 'createdAt';

    // Build filter
    const filter: any = {
      userType: UserType.MEMBER,
      membershipMonths: { $ne: null }, // Only members from simplified flow
    };

    // Add search filter
    if (query?.search) {
      filter.$or = [
        { name: { $regex: query.search, $options: 'i' } },
        { email: { $regex: query.search, $options: 'i' } },
        { phone: { $regex: query.search, $options: 'i' } },
        { idNo: { $regex: query.search, $options: 'i' } },
      ];
    }

    // Get total count for pagination metadata
    const total = await this.userModel.countDocuments(filter).exec();

    // Get paginated results
    const members = await this.userModel
      .find(filter)
      .select('-password -refreshToken')
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .exec();

    // Enrich with payment summary for each member
    const data = await Promise.all(
      members.map(async (member) => {
        // Get payment summary for this member
        const payments = await this.memberPaymentModel
          .find({ memberId: member._id } as any)
          .exec();

        const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
        const totalReceived = payments.reduce((sum, p) => sum + (p.received || 0), 0);
        const totalPending = Math.max(0, totalAmount - totalReceived);
        const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;

        return {
          ...member.toObject(),
          paymentSummary: {
            totalReceived,
            totalPending,
            hasPendingBalance: totalPending > 0,
            lastPaymentDate: lastPayment?.paymentDate || null,
            lastPaymentAmount: lastPayment?.received || 0,
            paymentCount: payments.length,
          },
        };
      }),
    );

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Get all payments from simplified flow
   * Supports pagination and search
   */
  async getAllPayments(query?: {
    page?: number;
    limit?: number;
    search?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }) {
    const page = query?.page || 1;
    const limit = query?.limit || 10;
    const skip = (page - 1) * limit;
    const sortOrder = query?.sortOrder === 'asc' ? 1 : -1;
    const sortBy = query?.sortBy || 'paymentDate';

    // Build filter
    const filter: any = {};

    // Add search filter (search in populated member fields)
    let memberIds: any[] = [];
    if (query?.search) {
      const members = await this.userModel
        .find({
          userType: UserType.MEMBER,
          $or: [
            { name: { $regex: query.search, $options: 'i' } },
            { email: { $regex: query.search, $options: 'i' } },
            { phone: { $regex: query.search, $options: 'i' } },
          ],
        })
        .select('_id')
        .exec();
      memberIds = members.map((m) => m._id);

      if (memberIds.length > 0) {
        filter.memberId = { $in: memberIds };
      } else {
        // If search found no members, also check transaction ID
        filter.$or = [
          { transactionId: { $regex: query.search, $options: 'i' } },
          { notes: { $regex: query.search, $options: 'i' } },
        ];
      }
    }

    // Get total count for pagination metadata
    const total = await this.memberPaymentModel.countDocuments(filter).exec();

    // Get paginated results
    const data = await this.memberPaymentModel
      .find(filter)
      .populate('memberId', 'name email phone')
      .sort({ [sortBy]: sortOrder, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page < Math.ceil(total / limit),
        hasPrevPage: page > 1,
      },
    };
  }

  /**
   * Import members from Excel file
   */
  async importFromExcel(buffer: Buffer): Promise<{
    success: number;
    failed: number;
    errors: Array<{ row: number; name: string; error: string }>;
    imported: Array<{ member: UserDocument; payment: MemberPaymentDocument }>;
  }> {
    // Parse Excel file
    const members = this.membersImportService.parseExcelFile(buffer);

    const results = {
      success: 0,
      failed: 0,
      errors: [] as Array<{ row: number; name: string; error: string }>,
      imported: [] as Array<{
        member: UserDocument;
        payment: MemberPaymentDocument;
      }>,
    };

    // Process each member
    for (let i = 0; i < members.length; i++) {
      const memberData = members[i];
      const rowNumber = i + 2; // Excel row number (1-indexed + header)

      try {
        // Check if member already exists by phone number
        const existing = await this.userModel
          .findOne({
            phone: memberData.contactNumber,
            userType: UserType.MEMBER,
          })
          .exec();

        if (existing) {
          results.errors.push({
            row: rowNumber,
            name: memberData.name,
            error: `Member with phone ${memberData.contactNumber} already exists`,
          });
          results.failed++;
          continue;
        }

        // Extract membership months from package
        const membershipMonths =
          this.membersImportService.extractMonthsFromPackage(
            memberData.package,
          );

        // Generate email from contact number
        const email = `member${memberData.contactNumber}@gym.com`;

        // Create member with memberships array
        const member = new this.userModel({
          name: memberData.name,
          email: email,
          phone: memberData.contactNumber,
          userType: UserType.MEMBER,
          role: Role.USER,
          password: 'N/A',
          memberStatus: MemberStatus.ACTIVE,
          idNo: memberData.idNo,
          dob: memberData.dob ? new Date(memberData.dob) : null,
          instagramHandle: memberData.instagramHandle,
          salesPerson: memberData.salesPerson,
          trainer: memberData.trainer,
          trainingType: memberData.trainingType,
          memberType: memberData.memberType,
          membershipMonths: membershipMonths,
          startingDate: new Date(memberData.startingDate),
          expiryDate: new Date(memberData.expiryDate),
          membershipAmount: memberData.amount,
          memberships: [{
            startDate: new Date(memberData.startingDate),
            expiryDate: new Date(memberData.expiryDate),
            months: membershipMonths,
            totalAmount: memberData.amount,
            amountPaid: memberData.received,
            pendingAmount: memberData.pending,
            status: 'ACTIVE',
            package: memberData.package,
            trainingType: memberData.trainingType,
            trainer: memberData.trainer,
            salesPerson: memberData.salesPerson,
            memberType: memberData.memberType,
          }],
        });

        const savedMember = await member.save();

        // Get the created membership ID
        const membershipId = savedMember.memberships[0]._id;

        // Create payment record linked to the membership
        const payment = new this.memberPaymentModel({
          memberId: savedMember._id,
          membershipId: membershipId,
          amount: memberData.amount,
          received: memberData.received,
          pending: memberData.pending,
          mop: memberData.mop,
          paymentDate: new Date(memberData.date),
          transactionId: undefined,
          notes: `Imported from Excel - ${memberData.package}`,
        });

        const savedPayment = await payment.save();

        results.imported.push({
          member: savedMember,
          payment: savedPayment,
        });
        results.success++;
      } catch (error) {
        results.errors.push({
          row: rowNumber,
          name: memberData.name,
          error: error.message,
        });
        results.failed++;
      }
    }

    return results;
  }
}
