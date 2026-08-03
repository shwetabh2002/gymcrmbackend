import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UsersService } from '../../users/users.service';
import { AccountStatus } from '../../common/enums/account-status.enum';
import { getEffectivePermissions } from '../../common/constants/permissions';
import { Role } from '../../common/enums/role.enum';
import { Company, CompanyDocument } from '../../companies/schemas/company.schema';
import {
  Location,
  LocationDocument,
} from '../../locations/schemas/location.schema';

export interface JwtPayload {
  sub: string;
  email: string | null;
  role: string;
  name: string;
  companyId?: string | null;
  locationId?: string | null;
}

@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
    @InjectModel(Company.name)
    private companyModel: Model<CompanyDocument>,
    @InjectModel(Location.name)
    private locationModel: Model<LocationDocument>,
  ) {
    const accessSecret = configService.get<string>('JWT_ACCESS_SECRET');
    if (!accessSecret) {
      throw new Error('JWT_ACCESS_SECRET is not configured');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: accessSecret,
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.accountStatus === AccountStatus.INACTIVE) {
      throw new UnauthorizedException('Account is inactive');
    }

    const permissions = getEffectivePermissions(
      user.role,
      user.customPermissions,
    );

    let companyId: string | null = null;
    if (user.role === Role.SUPER_ADMIN) {
      companyId = user.activeCompanyId
        ? user.activeCompanyId.toString()
        : null;
    } else if (user.companyId) {
      companyId = user.companyId.toString();
    }

    let companyName: string | null = null;
    if (companyId) {
      const company = await this.companyModel.findById(companyId).exec();
      companyName = company?.name ?? null;
    }

    let locationId: string | null = null;
    let locationName: string | null = null;
    if (user.activeLocationId) {
      const loc = await this.locationModel
        .findById(user.activeLocationId)
        .exec();
      if (loc) {
        locationId = loc._id.toString();
        locationName = loc.name;
      }
    }

    return {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      name: user.name,
      userType: user.userType,
      permissions,
      companyId,
      companyName,
      locationId,
      locationName,
    };
  }
}
