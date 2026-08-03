import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LocationsService } from './locations.service';
import { LocationsController } from './locations.controller';
import { Location, LocationSchema } from './schemas/location.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Location.name, schema: LocationSchema },
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule,
  ],
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService, MongooseModule],
})
export class LocationsModule {}
