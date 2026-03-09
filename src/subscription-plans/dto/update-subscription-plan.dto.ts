import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { DurationType } from '../../common/enums/duration-type.enum';
import { PlanStatus } from '../../common/enums/plan-status.enum';

export class UpdateSubscriptionPlanDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @Min(1)
  @IsOptional()
  duration?: number;

  @IsEnum(DurationType)
  @IsOptional()
  durationType?: DurationType;

  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(PlanStatus)
  @IsOptional()
  status?: PlanStatus;
}
