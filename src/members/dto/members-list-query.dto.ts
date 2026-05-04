import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class MembersListQueryDto extends PaginationQueryDto {
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

