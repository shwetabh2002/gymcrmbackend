import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { requireCompanyId } from './tenant.util';

/** Injects validated companyId from JWT user */
export const CompanyId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    return requireCompanyId(request.user);
  },
);
