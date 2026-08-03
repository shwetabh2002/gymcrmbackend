import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { Role } from '../common/enums/role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { getEffectivePermissions } from '../common/constants/permissions';
import { Company, CompanyDocument } from '../companies/schemas/company.schema';
import {
  Location,
  LocationDocument,
} from '../locations/schemas/location.schema';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel(Company.name)
    private companyModel: Model<CompanyDocument>,
    @InjectModel(Location.name)
    private locationModel: Model<LocationDocument>,
  ) {}

  async adminLogin(loginDto: LoginDto) {
    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const staffRoles = [
      Role.SUPER_ADMIN,
      Role.ADMIN,
      Role.MANAGER,
      Role.STAFF,
      Role.TRAINER,
      Role.SALES,
    ];

    if (!staffRoles.includes(user.role)) {
      throw new UnauthorizedException(
        'Access denied. Staff login privileges required',
      );
    }

    if (user.accountStatus === AccountStatus.INACTIVE) {
      throw new UnauthorizedException('Account is inactive. Contact admin.');
    }

    const isPasswordValid = await bcrypt.compare(
      loginDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.loginAsUser(user);
  }

  async loginAsUser(user: any) {
    const tokens = await this.generateTokens(user);
    const permissions = getEffectivePermissions(
      user.role,
      user.customPermissions,
    );

    const hashedRefreshToken = await bcrypt.hash(tokens.refreshToken, 10);
    await this.usersService.updateRefreshToken(
      user._id.toString(),
      hashedRefreshToken,
    );

    const company = await this.resolveCompanyContext(user);
    const location = await this.resolveLocationContext(user);

    return {
      user: {
        userId: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        userType: user.userType,
        permissions,
        customPermissions: user.customPermissions ?? null,
        companyId: company.companyId,
        companyName: company.companyName,
        locationId: location.locationId,
        locationName: location.locationName,
      },
      tokens,
    };
  }

  private async resolveCompanyContext(user: any): Promise<{
    companyId: string | null;
    companyName: string | null;
  }> {
    let companyId: string | null = null;

    if (user.role === Role.SUPER_ADMIN) {
      companyId = user.activeCompanyId
        ? user.activeCompanyId.toString()
        : null;
    } else if (user.companyId) {
      companyId = user.companyId.toString();
    }

    if (!companyId) {
      return { companyId: null, companyName: null };
    }

    const company = await this.companyModel.findById(companyId).exec();
    return {
      companyId,
      companyName: company?.name ?? null,
    };
  }

  private async resolveLocationContext(user: any): Promise<{
    locationId: string | null;
    locationName: string | null;
  }> {
    if (!user.activeLocationId) {
      return { locationId: null, locationName: null };
    }
    const loc = await this.locationModel
      .findById(user.activeLocationId)
      .exec();
    if (!loc) {
      return { locationId: null, locationName: null };
    }
    return {
      locationId: loc._id.toString(),
      locationName: loc.name,
    };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.usersService.findById(userId);

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access denied');
    }

    const refreshTokenMatches = await bcrypt.compare(
      refreshToken,
      user.refreshToken,
    );

    if (!refreshTokenMatches) {
      throw new UnauthorizedException('Access denied');
    }

    const tokens = await this.generateTokens(user);

    const hashedRefreshToken = await bcrypt.hash(tokens.refreshToken, 10);
    await this.usersService.updateRefreshToken(
      user._id.toString(),
      hashedRefreshToken,
    );

    return tokens;
  }

  async logout(userId: string) {
    await this.usersService.updateRefreshToken(userId, null);
    return { message: 'Logged out successfully' };
  }

  private async generateTokens(user: any) {
    const userId = user._id ? user._id.toString() : user.id;

    let companyId: string | null = null;
    if (user.role === Role.SUPER_ADMIN) {
      companyId = user.activeCompanyId
        ? user.activeCompanyId.toString()
        : null;
    } else if (user.companyId) {
      companyId = user.companyId.toString();
    }

    const locationId = user.activeLocationId
      ? user.activeLocationId.toString()
      : null;

    const payload = {
      sub: userId,
      email: user.email,
      role: user.role,
      name: user.name,
      companyId,
      locationId,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.get('JWT_ACCESS_EXPIRATION'),
      }),
      this.jwtService.signAsync(
        { sub: userId, email: user.email },
        {
          secret: this.configService.get('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get('JWT_REFRESH_EXPIRATION'),
        },
      ),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }
}
