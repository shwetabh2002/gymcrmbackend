import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import {
  Company,
  CompanyDocument,
  CompanySource,
  CompanyStatus,
} from './schemas/company.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { SelfSignupDto } from './dto/self-signup.dto';
import { ManualOnboardDto } from './dto/manual-onboard.dto';
import { Role } from '../common/enums/role.enum';
import { UserType } from '../common/enums/user-type.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import {
  GymSettings,
  GymSettingsDocument,
} from '../gym-settings/schemas/gym-settings.schema';
import { AuthService } from '../auth/auth.service';
import { LocationsService } from '../locations/locations.service';
import { EmailService } from '../email/email.service';
import { ConfigService } from '@nestjs/config';
import {
  getCountry,
  normalizeCountryCode,
} from '../config/countries.config';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectModel(Company.name)
    private companyModel: Model<CompanyDocument>,
    @InjectModel(User.name)
    private userModel: Model<UserDocument>,
    @InjectModel(GymSettings.name)
    private gymSettingsModel: Model<GymSettingsDocument>,
    private authService: AuthService,
    private locationsService: LocationsService,
    private emailService: EmailService,
    private config: ConfigService,
  ) {}

  private slugify(name: string): string {
    const base = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    return base || 'gym';
  }

  private async uniqueSlug(name: string): Promise<string> {
    let slug = this.slugify(name);
    let n = 0;
    while (await this.companyModel.exists({ slug })) {
      n += 1;
      slug = `${this.slugify(name)}-${n}`;
    }
    return slug;
  }

  private async createCompanyWithAdmin(
    dto: SelfSignupDto | ManualOnboardDto,
    source: CompanySource,
    status: CompanyStatus,
  ) {
    const email = dto.adminEmail.trim().toLowerCase();
    const existing = await this.userModel.findOne({ email }).exec();
    if (existing) {
      throw new ConflictException(
        'This email is already registered. Try logging in or use a different email.',
      );
    }

    const slug = await this.uniqueSlug(dto.gymName);
    const prefix = (dto.memberIdPrefix || 'GYM').trim().toUpperCase();
    const countryCode = normalizeCountryCode(
      (dto as SelfSignupDto).countryCode,
    );

    const company = await this.companyModel.create({
      name: dto.gymName.trim(),
      slug,
      phone: dto.phone?.trim() || null,
      city: dto.city?.trim() || null,
      countryCode,
      memberIdPrefix: prefix,
      source,
      status,
      ownerUserId: null,
    });

    const hashed = await bcrypt.hash(dto.adminPassword, 10);
    const admin = await this.userModel.create({
      name: dto.adminName.trim(),
      email,
      password: hashed,
      role: Role.ADMIN,
      userType: UserType.ADMIN,
      accountStatus: AccountStatus.ACTIVE,
      companyId: company._id,
      activeCompanyId: null,
    });

    company.ownerUserId = admin._id as any;
    await company.save();

    await this.gymSettingsModel.findOneAndUpdate(
      { companyId: company._id },
      {
        companyId: company._id,
        memberIdPrefix: prefix,
        gymName: company.name,
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    );

    const location = await this.locationsService.createDefault(
      String(company._id),
      {
        name: dto.city?.trim() || 'Main Branch',
        city: dto.city?.trim(),
        phone: dto.phone?.trim(),
      },
    );

    return { company, admin, location };
  }

  /** Fire-and-forget welcome mail — never blocks signup on mail failure */
  private notifyWelcomeCredentials(
    dto: SelfSignupDto | ManualOnboardDto,
    gymName: string,
  ) {
    const loginUrl =
      this.config.get<string>('CRM_PUBLIC_URL') ||
      this.config.get<string>('FRONTEND_URL') ||
      'http://localhost:3000';
    const loginPage = `${loginUrl.replace(/\/$/, '')}/login`;

    void this.emailService
      .sendWelcomeSignup({
        to: dto.adminEmail.trim().toLowerCase(),
        adminName: dto.adminName.trim(),
        gymName,
        email: dto.adminEmail.trim().toLowerCase(),
        password: dto.adminPassword,
        loginUrl: loginPage,
      })
      .catch(() => undefined);
  }

  /** Public self-signup → creates company + gym ADMIN + returns login tokens */
  async selfSignup(dto: SelfSignupDto) {
    const { company, admin, location } = await this.createCompanyWithAdmin(
      dto,
      CompanySource.SELF,
      CompanyStatus.TRIAL,
    );

    this.notifyWelcomeCredentials(dto, company.name);

    const session = await this.authService.loginAsUser(admin);

    return {
      company: {
        id: String(company._id),
        name: company.name,
        slug: company.slug,
        status: company.status,
      },
      location,
      ...session,
    };
  }

  /** SUPER_ADMIN creates a gym + admin (no auto-login as that admin) */
  async manualOnboard(dto: ManualOnboardDto) {
    const { company, admin, location } = await this.createCompanyWithAdmin(
      dto,
      CompanySource.MANUAL,
      CompanyStatus.ACTIVE,
    );

    this.notifyWelcomeCredentials(dto, company.name);

    return {
      company: {
        id: String(company._id),
        name: company.name,
        slug: company.slug,
        status: company.status,
        source: company.source,
      },
      location,
      admin: {
        userId: String(admin._id),
        email: admin.email,
        name: admin.name,
        role: admin.role,
      },
    };
  }

  async findAll() {
    const companies = await this.companyModel
      .find()
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return companies.map((c: any) => {
      const country = getCountry(c.countryCode);
      return {
        id: String(c._id),
        name: c.name,
        slug: c.slug,
        status: c.status,
        source: c.source,
        phone: c.phone,
        city: c.city,
        countryCode: country.code,
        countryName: country.name,
        currency: country.currency,
        memberIdPrefix: c.memberIdPrefix,
        ownerUserId: c.ownerUserId ? String(c.ownerUserId) : null,
        createdAt: c.createdAt,
      };
    });
  }

  async findById(id: string) {
    const c = await this.companyModel.findById(id).lean().exec();
    if (!c) throw new NotFoundException('Company not found');
    const country = getCountry((c as any).countryCode);
    return {
      id: String(c._id),
      name: c.name,
      slug: c.slug,
      status: c.status,
      source: c.source,
      phone: c.phone,
      city: c.city,
      countryCode: country.code,
      countryName: country.name,
      currency: country.currency,
      memberIdPrefix: c.memberIdPrefix,
      ownerUserId: c.ownerUserId ? String(c.ownerUserId) : null,
      createdAt: (c as any).createdAt,
    };
  }

  async updateCountry(companyId: string, countryCode: string) {
    const code = normalizeCountryCode(countryCode);
    const company = await this.companyModel
      .findByIdAndUpdate(companyId, { countryCode: code }, {
        returnDocument: 'after',
      })
      .exec();
    if (!company) throw new NotFoundException('Company not found');
    return this.findById(companyId);
  }

  /**
   * SUPER_ADMIN switches which gym they are viewing.
   * Re-issues tokens with that companyId as active context.
   */
  async selectCompany(superAdminUserId: string, companyId: string) {
    const user = await this.userModel.findById(superAdminUserId).exec();
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can switch companies');
    }

    const company = await this.companyModel.findById(companyId).exec();
    if (!company) throw new NotFoundException('Company not found');
    if (company.status === CompanyStatus.SUSPENDED) {
      throw new BadRequestException('Company is suspended');
    }

    user.activeCompanyId = company._id as any;
    user.activeLocationId = null; // all locations until they pick one
    await user.save();

    return this.authService.loginAsUser(user);
  }

  async clearActiveCompany(superAdminUserId: string) {
    const user = await this.userModel.findById(superAdminUserId).exec();
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== Role.SUPER_ADMIN) {
      throw new ForbiddenException('Only SUPER_ADMIN can clear company context');
    }
    user.activeCompanyId = null;
    user.activeLocationId = null;
    await user.save();
    return this.authService.loginAsUser(user);
  }
}
