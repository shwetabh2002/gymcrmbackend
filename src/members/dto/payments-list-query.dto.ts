import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { DateRangeQueryDto } from '../../common/dto/date-range-query.dto';
import { IntersectionType } from '@nestjs/mapped-types';

export class PaymentsListQueryDto extends IntersectionType(
  PaginationQueryDto,
  DateRangeQueryDto,
) {}
