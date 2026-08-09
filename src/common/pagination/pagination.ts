import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Server-side paging for list endpoints.
 *
 * Every list used to return an entire company's rows with full populates. That
 * is fine for a gym with 40 members and fatal for one with 40,000: the query,
 * the JSON and the browser all grow without limit.
 *
 * Compatibility: when no paging parameter is sent the endpoint still answers
 * with a plain array, so existing callers keep working. Pass `limit` (or `page`)
 * to get a `PaginatedResult` envelope instead.
 */
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * Ceiling for an unpaged request. Nothing legitimate needs more in one response;
 * crossing it is logged so the caller can be moved to paging rather than
 * silently receiving a truncated list.
 */
export const UNPAGED_SAFETY_LIMIT = 1_000;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  /** Free-text filter; each service decides which fields it covers. */
  @IsOptional()
  @IsString()
  search?: string;
}

/**
 * Members list filters. Kept beside the paging DTO because they are applied in
 * the same query — filtering in the browser only works while the whole list
 * fits in the browser.
 */
export class MemberListQueryDto extends PaginationQueryDto {
  /** ACTIVE | INACTIVE | SUSPENDED */
  @IsOptional()
  @IsString()
  status?: string;

  /** GT | PT | OTHER */
  @IsOptional()
  @IsString()
  trainingType?: string;
}

/** Payments list filters. */
export class PaymentListQueryDto extends PaginationQueryDto {
  /** CASH | ONLINE, or a legacy value on historical rows */
  @IsOptional()
  @IsString()
  mode?: string;
}

/** Subscriptions list filters. */
export class SubscriptionListQueryDto extends PaginationQueryDto {
  /** ACTIVE | EXPIRING_SOON | EXPIRED | CANCELLED */
  @IsOptional()
  @IsString()
  status?: string;
}

export type PaginatedResult<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

export function isPaged(query?: PaginationQueryDto): boolean {
  return !!(query && (query.page !== undefined || query.limit !== undefined));
}

/** Normalised skip/limit for a query, whether or not the caller asked to page. */
export function resolvePaging(query?: PaginationQueryDto): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, Number(query?.page) || 1);
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(query?.limit) || DEFAULT_PAGE_SIZE),
  );
  return { page, limit, skip: (page - 1) * limit };
}

export function buildResult<T>(
  items: T[],
  total: number,
  query?: PaginationQueryDto,
): PaginatedResult<T> {
  const { page, limit } = resolvePaging(query);
  return {
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

/** Case-insensitive contains, escaped so user input cannot inject a pattern. */
export function searchRegex(term?: string): RegExp | null {
  const trimmed = (term || '').trim();
  if (!trimmed) return null;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped, 'i');
}
