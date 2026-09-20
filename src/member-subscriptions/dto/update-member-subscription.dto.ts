import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { SubscriptionStatus } from '../../common/enums/subscription-status.enum';

export class UpdateMemberSubscriptionDto {
  @IsEnum(SubscriptionStatus)
  @IsOptional()
  subscriptionStatus?: SubscriptionStatus;

  /** Member promised to pay remaining balance by this date. */
  @IsDateString()
  @IsOptional()
  dueReminderDate?: string | null;
}
