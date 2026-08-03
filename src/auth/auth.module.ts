import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { UsersModule } from '../users/users.module';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { Company, CompanySchema } from '../companies/schemas/company.schema';
import {
  Location,
  LocationSchema,
} from '../locations/schemas/location.schema';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.register({}),
    MongooseModule.forFeature([
      { name: Company.name, schema: CompanySchema },
      { name: Location.name, schema: LocationSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAccessStrategy, JwtRefreshStrategy],
  exports: [AuthService],
})
export class AuthModule {}
