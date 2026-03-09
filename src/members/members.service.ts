import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateMemberDto } from './dto/create-member.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { UserType } from '../common/enums/user-type.enum';
import { MemberStatus } from '../common/enums/member-status.enum';
import { Role } from '../common/enums/role.enum';

@Injectable()
export class MembersService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
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
      .exec();
  }

  async findById(id: string): Promise<UserDocument> {
    const member = await this.userModel
      .findOne({ _id: id, userType: UserType.MEMBER })
      .select('-password -refreshToken')
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
}
