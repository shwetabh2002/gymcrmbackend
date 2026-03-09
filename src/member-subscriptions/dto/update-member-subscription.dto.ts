import { IsEnum, IsOptional } from 'class-validator';
import { SubscriptionStatus } from '../../common/enums/subscription-status.enum';

export class UpdateMemberSubscriptionDto {
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  subscriptionStatus?: SubscriptionStatus;
}
