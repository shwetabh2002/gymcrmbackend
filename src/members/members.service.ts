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
import { Employee, EmployeeDocument } from '../employees/schemas/employee.schema';
import { EmployeeType } from '../common/enums/employee-type.enum';
import { EmployeeStatus } from '../common/enums/employee-status.enum';
import {
  isMonthDayTodayOrTomorrow,
  todayOrTomorrowOrder,
} from '../common/utils/upcoming-celebration.util';

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(MemberPayment.name)
    private memberPaymentModel: Model<MemberPaymentDocument>,
    @InjectModel(Employee.name)
    private employeeModel: Model<EmployeeDocument>,
    private membersImportService: MembersImportService,
  ) {}

  async create(createDto: CreateMemberDto): Promise<UserDocument> {
    // Check if email already exists
    const existingUser = await this.userModel.findOne({ email: createDto.email }).exec();
    if (existingUser) {
      throw new ConflictException(`Email ${createDto.email} is already in use`);
    }

    // Auto-generate idNo if not provided (format: DLF-641, DLF-642, etc.)
    let idNo = createDto.idNo;
    if (!idNo) {
      // Find the last member with an idNo matching DLF- pattern
      const lastMember = await this.userModel
        .findOne({
          userType: UserType.MEMBER,
          idNo: { $exists: true, $ne: null, $regex: /^DLF-/ }
        })
        .sort({ createdAt: -1 })
        .exec();

      if (lastMember && lastMember.idNo) {
        // Parse the last idNo and increment (e.g., "DLF-641" -> 641 -> 642 -> "DLF-642")
        const match = lastMember.idNo.match(/^DLF-(\d+)$/);
        if (match) {
          const lastIdNum = parseInt(match[1], 10);
          idNo = `DLF-${lastIdNum + 1}`;
        } else {
          idNo = 'DLF-641'; // Start from DLF-641 if last idNo doesn't match pattern
        }
      } else {
        idNo = 'DLF-641'; // Start from DLF-641 if no members exist
      }
    }

    // Create member with dummy password (members don't login)
    const member = new this.userModel({
      ...createDto,
      idNo,
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
    // Use provided email or generate from contact number
    const email = registerDto.email || `member${registerDto.contactNumber}@gym.com`;

    // Check if contact number already exists
    const existingMember = await this.userModel
      .findOne({ phone: registerDto.contactNumber, userType: UserType.MEMBER })
      .exec();

    if (existingMember) {
      throw new ConflictException(
        `Member with contact number ${registerDto.contactNumber} already exists`,
      );
    }

    // Calculate discounted amount if discount is provided
    const discount = registerDto.discount || 0;
    const discountAmount = Math.round((registerDto.amount * discount / 100) * 100) / 100;
    const finalAmount = Math.round((registerDto.amount - discountAmount) * 100) / 100;

    // Calculate pending amount if not provided (using discounted finalAmount)
    const pending =
      registerDto.pending !== undefined
        ? registerDto.pending
        : Math.max(0, finalAmount - registerDto.received);

    // Auto-generate idNo if not provided (format: DLF-641, DLF-642, etc.)
    let idNo = registerDto.idNo;
    if (!idNo) {
      // Find the last member with an idNo matching DLF- pattern
      const lastMember = await this.userModel
        .findOne({
          userType: UserType.MEMBER,
          idNo: { $exists: true, $ne: null, $regex: /^DLF-/ }
        })
        .sort({ createdAt: -1 })
        .exec();

      if (lastMember && lastMember.idNo) {
        // Parse the last idNo and increment (e.g., "DLF-641" -> 641 -> 642 -> "DLF-642")
        const match = lastMember.idNo.match(/^DLF-(\d+)$/);
        if (match) {
          const lastIdNum = parseInt(match[1], 10);
          idNo = `DLF-${lastIdNum + 1}`;
        } else {
          idNo = 'DLF-641'; // Start from DLF-641 if last idNo doesn't match pattern
        }
      } else {
        idNo = 'DLF-641'; // Start from DLF-641 if no members exist
      }
    }

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
      idNo: idNo,
      dob: registerDto.dob ? new Date(registerDto.dob) : null,
      anniversaryDate: registerDto.anniversaryDate ? new Date(registerDto.anniversaryDate) : null,
      instagramHandle: registerDto.instagramHandle,
      salesPerson: registerDto.salesPerson,
      trainer: registerDto.trainer,
      trainingType: registerDto.trainingType,
      memberType: registerDto.memberType,
      discount: registerDto.discount || 0,
      discountApprovedBy: registerDto.discountApprovedBy,

      // Membership details (legacy fields - kept for backward compatibility)
      membershipMonths: registerDto.membershipMonths,
      startingDate: new Date(registerDto.startingDate),
      expiryDate: new Date(registerDto.expiryDate),
      membershipAmount: finalAmount, // Use discounted amount
      amount: registerDto.amount, // Store original amount for reference

      // NEW: Create first membership in memberships array
      memberships: [{
        startDate: new Date(registerDto.startingDate),
        expiryDate: new Date(registerDto.expiryDate),
        months: registerDto.membershipMonths,
        totalAmount: finalAmount, // Use discounted amount
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
      amount: finalAmount, // Use discounted amount
      received: registerDto.received,
      pending: pending,
      mop: registerDto.mop,
      paymentDate: new Date(registerDto.date),
      transactionId: registerDto.transactionId,
      notes: discount > 0
        ? `Initial payment for ${registerDto.membershipMonths} months membership (${discount}% discount applied)`
        : `Initial payment for ${registerDto.membershipMonths} months membership`,
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
      .populate('memberId', 'name email phone discount discountApprovedBy membershipPlan membershipMonths instagramHandle amount')
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

        // Validate salesPerson if provided
        if (memberData.salesPerson) {
          const salesEmployee = await this.employeeModel
            .findOne({
              name: memberData.salesPerson,
              employeeType: EmployeeType.SALES,
              status: EmployeeStatus.ACTIVE,
            })
            .exec();

          if (!salesEmployee) {
            results.errors.push({
              row: rowNumber,
              name: memberData.name,
              error: `Sales person "${memberData.salesPerson}" not found or not active`,
            });
            results.failed++;
            continue;
          }
        }

        // Validate trainer if provided
        if (memberData.trainer) {
          const trainerEmployee = await this.employeeModel
            .findOne({
              name: memberData.trainer,
              employeeType: EmployeeType.TRAINER,
              status: EmployeeStatus.ACTIVE,
            })
            .exec();

          if (!trainerEmployee) {
            results.errors.push({
              row: rowNumber,
              name: memberData.name,
              error: `Trainer "${memberData.trainer}" not found or not active`,
            });
            results.failed++;
            continue;
          }
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

  /**
   * Active members with birthday today or tomorrow (same calendar logic as employees).
   */
  async getUpcomingBirthdays(): Promise<UserDocument[]> {
    const ref = new Date();
    const members = await this.userModel
      .find({
        userType: UserType.MEMBER,
        memberStatus: MemberStatus.ACTIVE,
        dob: { $exists: true, $ne: null },
      })
      .exec();

    return members
      .filter((m) => {
        if (!m.dob) return false;
        const dobDate = new Date(m.dob);
        return isMonthDayTodayOrTomorrow(
          dobDate.getMonth() + 1,
          dobDate.getDate(),
          ref,
        );
      })
      .sort((a, b) => {
        const da = new Date(a.dob!);
        const db = new Date(b.dob!);
        const oa = todayOrTomorrowOrder(da.getMonth() + 1, da.getDate(), ref);
        const ob = todayOrTomorrowOrder(db.getMonth() + 1, db.getDate(), ref);
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      });
  }

  /**
   * Active members with anniversary today or tomorrow (no isMarried flag on users).
   */
  async getUpcomingAnniversaries(): Promise<UserDocument[]> {
    const ref = new Date();
    const members = await this.userModel
      .find({
        userType: UserType.MEMBER,
        memberStatus: MemberStatus.ACTIVE,
        anniversaryDate: { $exists: true, $ne: null },
      })
      .exec();

    return members
      .filter((m) => {
        if (!m.anniversaryDate) return false;
        const annDate = new Date(m.anniversaryDate);
        return isMonthDayTodayOrTomorrow(
          annDate.getMonth() + 1,
          annDate.getDate(),
          ref,
        );
      })
      .sort((a, b) => {
        const da = new Date(a.anniversaryDate!);
        const db = new Date(b.anniversaryDate!);
        const oa = todayOrTomorrowOrder(da.getMonth() + 1, da.getDate(), ref);
        const ob = todayOrTomorrowOrder(db.getMonth() + 1, db.getDate(), ref);
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      });
  }
}
