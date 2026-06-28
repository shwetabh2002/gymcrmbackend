import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';
import { IntersectionType } from '@nestjs/mapped-types';

export class MembersListQueryDto extends IntersectionType(
  PaginationQueryDto,
  DateRangeQueryDto,
) {
  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'ACTIVE', 'INACTIVE', 'EXPIRED'])
  status?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'New', 'Old', 'Renewal'])
  type?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'PT', 'GT', 'OTHER'])
  training?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ALL', 'HAS_PENDING', 'FULLY_PAID'])
  pending?: string;

  @IsOptional()
  @IsString()
  pendingByDate?: string;
}

