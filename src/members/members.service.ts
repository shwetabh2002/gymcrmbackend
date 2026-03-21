import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
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

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(MemberPayment.name)
    private memberPaymentModel: Model<MemberPaymentDocument>,
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

  async findAll(): Promise<UserDocument[]> {
    return this.userModel
      .find({ userType: UserType.MEMBER })
      .select('-password -refreshToken')
      .populate({
        path: 'currentSubscriptionId',
        strictPopulate: false,
        populate: { path: 'planId', strictPopulate: false },
      })
      .exec();
  }

  async findById(id: string): Promise<UserDocument> {
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

      // Membership details
      membershipMonths: registerDto.membershipMonths,
      startingDate: new Date(registerDto.startingDate),
      expiryDate: new Date(registerDto.expiryDate),
      membershipAmount: registerDto.amount,
    });

    const savedMember = await member.save();

    // Create payment/invoice record
    const payment = new this.memberPaymentModel({
      memberId: savedMember._id,
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
   * Get all registered members (with embedded membership details)
   */
  async findAllRegistered(): Promise<UserDocument[]> {
    return this.userModel
      .find({
        userType: UserType.MEMBER,
        membershipMonths: { $ne: null }, // Only members from simplified flow
      })
      .select('-password -refreshToken')
      .sort({ createdAt: -1 })
      .exec();
  }
}
