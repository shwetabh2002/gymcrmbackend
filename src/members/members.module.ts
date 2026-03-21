import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { MembersService } from './members.service';
import { MembersController } from './members.controller';
import { MembersImportService } from './members-import.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  MemberPayment,
  MemberPaymentSchema,
} from './schemas/member-payment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: MemberPayment.name, schema: MemberPaymentSchema },
    ]),
  ],
  providers: [MembersService, MembersImportService],
  controllers: [MembersController],
  exports: [MembersService],
})
export class MembersModule {}
