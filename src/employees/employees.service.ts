import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from '../users/schemas/user.schema';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeeType } from '../common/enums/employee-type.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { Role } from '../common/enums/role.enum';
import { UserType } from '../common/enums/user-type.enum';
import {
  defaultPermissionsForRole,
  getEffectivePermissions,
  normalizePermissions,
} from '../common/constants/permissions';
import { Permission } from '../common/enums/permission.enum';
import {
  ActivityLogsService,
  ActivityActor,
} from '../activity-logs/activity-logs.service';
import { StorageService } from '../storage/storage.service';

type LocScope = { locationId?: string };

const EMPLOYEE_ROLES = [Role.STAFF, Role.TRAINER, Role.SALES];

@Injectable()
export class EmployeesService {
  constructor(
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private activityLogsService: ActivityLogsService,
    private storageService: StorageService,
  ) {}

  private typeToRole(type: EmployeeType): Role {
    if (type === EmployeeType.TRAINER) return Role.TRAINER;
    if (type === EmployeeType.SALES) return Role.SALES;
    return Role.STAFF;
  }

  private roleToType(role: Role): EmployeeType {
    if (role === Role.TRAINER) return EmployeeType.TRAINER;
    if (role === Role.SALES) return EmployeeType.SALES;
    return EmployeeType.STAFF;
  }

  private sanitizePermissions(
    list?: Permission[] | string[] | null,
  ): Permission[] {
    return normalizePermissions(list);
  }

  private toClient(user: UserDocument) {
    const custom = user.customPermissions ?? null;
    const roleDefaults = defaultPermissionsForRole(user.role);
    const effective = getEffectivePermissions(user.role, custom);

    return {
      _id: String(user._id),
      name: user.name,
      email: user.email,
      phone: user.phone,
      photoUrl: user.photoUrl ?? null,
      type: this.roleToType(user.role),
      role: user.role,
      status: user.accountStatus || AccountStatus.ACTIVE,
      notes: user.notes,
      userType: user.userType,
      locationId: user.locationId ? String(user.locationId) : null,
      customPermissions: custom,
      roleDefaults,
      permissions: effective,
      isCustomAccess: custom != null,
      createdAt: (user as any).createdAt,
      updatedAt: (user as any).updatedAt,
    };
  }

  async create(
    companyId: string,
    dto: CreateEmployeeDto,
    actor?: ActivityActor,
  ) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email }).exec();
    if (existing) {
      throw new ConflictException(`Email ${email} is already in use`);
    }

    const hashed = await bcrypt.hash(dto.password, 10);
    const perms = this.sanitizePermissions(
      dto.customPermissions ?? [Permission.DASHBOARD],
    );

    const user = new this.userModel({
      name: dto.name.trim(),
      email,
      password: hashed,
      phone: dto.phone?.trim() || null,
      notes: dto.notes?.trim() || null,
      role: this.typeToRole(dto.type),
      userType: UserType.EMPLOYEE,
      accountStatus: dto.status || AccountStatus.ACTIVE,
      companyId,
      locationId: dto.locationId?.trim() || null,
      customPermissions: perms,
    });

    const saved = await user.save();
    const client = this.toClient(saved);

    if (actor) {
      await this.activityLogsService.log({
        companyId,
        locationId: client.locationId,
        actor,
        action: 'EMPLOYEE_CREATE',
        entityType: 'employee',
        entityId: client._id,
        summary: `${actor.name} added employee ${client.name} (${client.type})`,
      });
    }

    return client;
  }

  async findAll(
    companyId: string,
    type?: EmployeeType,
    status?: AccountStatus,
    locScope: LocScope = {},
  ) {
    const filter: Record<string, unknown> = {
      companyId,
      userType: UserType.EMPLOYEE,
      role: { $in: EMPLOYEE_ROLES },
      ...locScope,
    };

    if (type === EmployeeType.TRAINER) filter.role = Role.TRAINER;
    else if (type === EmployeeType.SALES) filter.role = Role.SALES;
    else if (type === EmployeeType.STAFF) filter.role = Role.STAFF;
    if (status) filter.accountStatus = status;

    const users = await this.userModel
      .find(filter)
      .select('-password -refreshToken')
      .sort({ name: 1 })
      .exec();

    return users.map((u) => this.toClient(u));
  }

  async findById(companyId: string, id: string, locScope: LocScope = {}) {
    const user = await this.userModel
      .findOne({
        _id: id,
        companyId,
        userType: UserType.EMPLOYEE,
        role: { $in: EMPLOYEE_ROLES },
        ...locScope,
      })
      .select('-password -refreshToken')
      .exec();

    if (!user) throw new NotFoundException('Employee not found');
    return this.toClient(user);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateEmployeeDto,
    actor?: ActivityActor,
    locScope: LocScope = {},
  ) {
    const user = await this.userModel
      .findOne({
        _id: id,
        companyId,
        userType: UserType.EMPLOYEE,
        role: { $in: EMPLOYEE_ROLES },
        ...locScope,
      })
      .exec();

    if (!user) throw new NotFoundException('Employee not found');

    if (dto.email && dto.email.trim().toLowerCase() !== user.email) {
      const email = dto.email.trim().toLowerCase();
      const clash = await this.userModel
        .findOne({ email, _id: { $ne: id } })
        .exec();
      if (clash) throw new ConflictException(`Email ${email} is already in use`);
      user.email = email;
    }

    if (dto.name !== undefined) user.name = dto.name.trim();
    if (dto.phone !== undefined) user.phone = dto.phone?.trim() || null;
    if (dto.notes !== undefined) user.notes = dto.notes?.trim() || null;
    if (dto.status !== undefined) user.accountStatus = dto.status;
    if (dto.locationId !== undefined) {
      user.locationId = (dto.locationId?.trim() || null) as any;
    }
    // Role is a label only — do not wipe permissions when type changes
    if (dto.type !== undefined) {
      user.role = this.typeToRole(dto.type);
    }

    if (dto.useRoleDefaults) {
      user.customPermissions = null;
    } else if (dto.customPermissions !== undefined) {
      user.customPermissions = this.sanitizePermissions(dto.customPermissions);
    }

    if (dto.password) {
      if (dto.password.length < 6) {
        throw new BadRequestException('Password must be at least 6 characters');
      }
      user.password = await bcrypt.hash(dto.password, 10);
    }

    const saved = await user.save();
    const client = this.toClient(saved);

    if (actor) {
      const accessChanged =
        dto.customPermissions !== undefined || dto.useRoleDefaults;
      await this.activityLogsService.log({
        companyId,
        locationId: client.locationId,
        actor,
        action: accessChanged ? 'EMPLOYEE_ACCESS_UPDATE' : 'EMPLOYEE_UPDATE',
        entityType: 'employee',
        entityId: id,
        summary: accessChanged
          ? `${actor.name} updated access for ${client.name}`
          : `${actor.name} updated employee ${client.name}`,
      });
    }

    return client;
  }

  async delete(
    companyId: string,
    id: string,
    actor?: ActivityActor,
    locScope: LocScope = {},
  ) {
    const user = await this.userModel
      .findOneAndDelete({
        _id: id,
        companyId,
        userType: UserType.EMPLOYEE,
        role: { $in: EMPLOYEE_ROLES },
        ...locScope,
      })
      .exec();

    if (!user) throw new NotFoundException('Employee not found');

    if (actor) {
      await this.activityLogsService.log({
        companyId,
        locationId: user.locationId ? String(user.locationId) : null,
        actor,
        action: 'EMPLOYEE_DELETE',
        entityType: 'employee',
        entityId: id,
        summary: `${actor.name} removed employee ${user.name}`,
      });
    }

    return { message: 'Employee deleted' };
  }

  /** Optional photo — skip when no file; path: companies/{cid}/employees/{id}/… */
  async uploadPhoto(
    companyId: string,
    id: string,
    file: Express.Multer.File,
    locScope: LocScope = {},
  ) {
    const user = await this.userModel
      .findOne({
        _id: id,
        companyId,
        userType: UserType.EMPLOYEE,
        role: { $in: EMPLOYEE_ROLES },
        ...locScope,
      })
      .exec();
    if (!user) throw new NotFoundException('Employee not found');

    const valid = this.storageService.assertValidImageFile(file);
    const uploaded = await this.storageService.uploadCompanyAsset({
      companyId,
      folder: 'employees',
      entityId: id,
      buffer: valid.buffer,
      mimeType: valid.mimetype,
      originalName: valid.originalname,
    });

    user.photoUrl = uploaded.url;
    await user.save();
    return this.toClient(user);
  }
}
