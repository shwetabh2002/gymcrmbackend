import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Location,
  LocationDocument,
  LocationStatus,
} from './schemas/location.schema';
import { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Role } from '../common/enums/role.enum';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class LocationsService {
  constructor(
    @InjectModel(Location.name)
    private locationModel: Model<LocationDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    private authService: AuthService,
  ) {}

  private toClient(loc: any) {
    return {
      id: String(loc._id),
      companyId: String(loc.companyId),
      name: loc.name,
      code: loc.code,
      address: loc.address ?? null,
      city: loc.city ?? null,
      phone: loc.phone ?? null,
      status: loc.status,
      isDefault: !!loc.isDefault,
      invoiceLayout: loc.invoiceLayout ?? null,
      invoiceShowLogo: loc.invoiceShowLogo ?? null,
      invoiceShowStamp: loc.invoiceShowStamp ?? null,
      invoiceShowGstin: loc.invoiceShowGstin ?? null,
      invoiceShowAddress: loc.invoiceShowAddress ?? null,
      invoiceShowContact: loc.invoiceShowContact ?? null,
      createdAt: loc.createdAt,
      updatedAt: loc.updatedAt,
    };
  }

  private codeify(name: string): string {
    return (
      name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 24) || 'main'
    );
  }

  private async uniqueCode(companyId: string, base: string): Promise<string> {
    let code = this.codeify(base);
    let n = 0;
    while (await this.locationModel.exists({ companyId, code })) {
      n += 1;
      code = `${this.codeify(base)}-${n}`.slice(0, 24);
    }
    return code;
  }

  /** Used by company signup / onboard */
  async createDefault(
    companyId: string,
    opts: { name?: string; city?: string; phone?: string } = {},
  ) {
    const name = (opts.name || opts.city || 'Main Branch').trim();
    const code = await this.uniqueCode(companyId, name);
    const loc = await this.locationModel.create({
      companyId: new Types.ObjectId(companyId),
      name,
      code,
      city: opts.city?.trim() || null,
      phone: opts.phone?.trim() || null,
      address: null,
      status: LocationStatus.ACTIVE,
      isDefault: true,
    });
    return this.toClient(loc);
  }

  async create(companyId: string, dto: CreateLocationDto) {
    const name = dto.name.trim();
    const code = await this.uniqueCode(
      companyId,
      dto.code?.trim() || name,
    );

    if (dto.isDefault) {
      await this.locationModel
        .updateMany({ companyId }, { $set: { isDefault: false } })
        .exec();
    }

    const count = await this.locationModel.countDocuments({ companyId }).exec();
    const loc = await this.locationModel.create({
      companyId: new Types.ObjectId(companyId),
      name,
      code,
      address: dto.address?.trim() || null,
      city: dto.city?.trim() || null,
      phone: dto.phone?.trim() || null,
      status: LocationStatus.ACTIVE,
      isDefault: dto.isDefault ?? count === 0,
      invoiceLayout: dto.invoiceLayout || null,
      invoiceShowLogo: dto.invoiceShowLogo ?? null,
      invoiceShowStamp: dto.invoiceShowStamp ?? null,
      invoiceShowGstin: dto.invoiceShowGstin ?? null,
      invoiceShowAddress: dto.invoiceShowAddress ?? null,
      invoiceShowContact: dto.invoiceShowContact ?? null,
    });

    return this.toClient(loc);
  }

  async findAll(companyId: string) {
    const rows = await this.locationModel
      .find({ companyId })
      .sort({ isDefault: -1, name: 1 })
      .lean()
      .exec();
    return rows.map((r) => this.toClient(r));
  }

  async findById(companyId: string, id: string) {
    const loc = await this.locationModel
      .findOne({ _id: id, companyId })
      .lean()
      .exec();
    if (!loc) throw new NotFoundException('Location not found');
    return this.toClient(loc);
  }

  async update(companyId: string, id: string, dto: UpdateLocationDto) {
    const loc = await this.locationModel.findOne({ _id: id, companyId }).exec();
    if (!loc) throw new NotFoundException('Location not found');

    if (dto.name !== undefined) loc.name = dto.name.trim();
    if (dto.address !== undefined) loc.address = dto.address?.trim() || null;
    if (dto.city !== undefined) loc.city = dto.city?.trim() || null;
    if (dto.phone !== undefined) loc.phone = dto.phone?.trim() || null;
    if (dto.status !== undefined) loc.status = dto.status;

    if (dto.invoiceLayout !== undefined) {
      loc.invoiceLayout = dto.invoiceLayout || null;
    }
    if (dto.invoiceShowLogo !== undefined) {
      loc.invoiceShowLogo = dto.invoiceShowLogo;
    }
    if (dto.invoiceShowStamp !== undefined) {
      loc.invoiceShowStamp = dto.invoiceShowStamp;
    }
    if (dto.invoiceShowGstin !== undefined) {
      loc.invoiceShowGstin = dto.invoiceShowGstin;
    }
    if (dto.invoiceShowAddress !== undefined) {
      loc.invoiceShowAddress = dto.invoiceShowAddress;
    }
    if (dto.invoiceShowContact !== undefined) {
      loc.invoiceShowContact = dto.invoiceShowContact;
    }

    if (dto.isDefault === true) {
      await this.locationModel
        .updateMany({ companyId }, { $set: { isDefault: false } })
        .exec();
      loc.isDefault = true;
    }

    await loc.save();
    return this.toClient(loc);
  }

  async delete(companyId: string, id: string) {
    const loc = await this.locationModel.findOne({ _id: id, companyId }).exec();
    if (!loc) throw new NotFoundException('Location not found');

    const total = await this.locationModel.countDocuments({ companyId }).exec();
    if (total <= 1) {
      throw new BadRequestException('Cannot delete the only location');
    }

    const memberCount = await this.userModel
      .countDocuments({ companyId, locationId: id })
      .exec();
    if (memberCount > 0) {
      throw new ConflictException(
        `Location has ${memberCount} members — move them first`,
      );
    }

    const wasDefault = loc.isDefault;
    await loc.deleteOne();

    if (wasDefault) {
      const next = await this.locationModel
        .findOne({ companyId })
        .sort({ createdAt: 1 })
        .exec();
      if (next) {
        next.isDefault = true;
        await next.save();
      }
    }

    // Clear activeLocationId for users pointing here
    await this.userModel
      .updateMany(
        { companyId, activeLocationId: id },
        { $set: { activeLocationId: null } },
      )
      .exec();

    return { message: 'Location deleted' };
  }

  async selectLocation(userId: string, companyId: string, locationId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    const loc = await this.locationModel
      .findOne({ _id: locationId, companyId, status: LocationStatus.ACTIVE })
      .exec();
    if (!loc) throw new NotFoundException('Location not found');

    // Ensure user belongs to this company (or SUPER_ADMIN viewing it)
    if (user.role !== Role.SUPER_ADMIN) {
      if (!user.companyId || user.companyId.toString() !== companyId) {
        throw new ForbiddenException('Not allowed for this company');
      }
    }

    user.activeLocationId = loc._id as any;
    await user.save();
    return this.authService.loginAsUser(user);
  }

  async clearActiveLocation(userId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');
    user.activeLocationId = null;
    await user.save();
    return this.authService.loginAsUser(user);
  }

  async assertBelongsToCompany(companyId: string, locationId: string) {
    const loc = await this.locationModel
      .findOne({ _id: locationId, companyId })
      .exec();
    if (!loc) {
      throw new BadRequestException('Invalid locationId for this company');
    }
    if (loc.status !== LocationStatus.ACTIVE) {
      throw new BadRequestException('Location is inactive');
    }
    return loc;
  }
}
