import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PlatformBillingService } from '../platform-billing.service';
import { Role } from '../../common/enums/role.enum';
import {
  BILLING_EXEMPT_KEY,
  REQUIRED_FEATURE_KEY,
} from '../decorators/billing.decorators';
import { PlatformFeature } from '../../config/platform-billing.config';

/** Methods that only read. A gym out of subscription can still see its data. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Enforces the platform subscription.
 *
 * Two jobs:
 *   1. When a trial has expired or dunning gave up, block writes but keep reads
 *      working — the gym can log in, look at everything and export. Locking
 *      people out of their own records to collect a fee is not something to
 *      build.
 *   2. Refuse features the gym's plan does not include.
 *
 * SUPER_ADMIN and anything marked @BillingExempt (auth, the billing screens
 * themselves) always pass, or a lapsed gym could never pay to recover.
 */
@Injectable()
export class SubscriptionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private billing: PlatformBillingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const exempt = this.reflector.getAllAndOverride<boolean>(
      BILLING_EXEMPT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (exempt) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) return true; // unauthenticated routes are someone else's problem

    // Platform staff are never gated by a tenant's billing.
    if (user.role === Role.SUPER_ADMIN) return true;

    const companyId = user.companyId;
    if (!companyId) return true;

    const requiredFeature = this.reflector.getAllAndOverride<PlatformFeature>(
      REQUIRED_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    const snapshot = await this.billing.snapshot(String(companyId));

    if (requiredFeature && !snapshot.features.includes(requiredFeature)) {
      throw new ForbiddenException({
        message: `Your ${snapshot.planName} plan does not include this. Upgrade in Settings → Subscription.`,
        reason: 'FEATURE_NOT_IN_PLAN',
        feature: requiredFeature,
        planCode: snapshot.planCode,
      });
    }

    if (READ_METHODS.has(request.method)) return true;

    if (!snapshot.canWrite) {
      throw new ForbiddenException({
        message:
          snapshot.status === 'CANCELLED'
            ? 'This subscription is cancelled. Your data is safe and still readable — resubscribe in Settings → Subscription to add members again.'
            : 'Your trial has ended. Your data is safe and still readable — pick a plan in Settings → Subscription to continue.',
        reason: 'SUBSCRIPTION_INACTIVE',
        status: snapshot.status,
      });
    }

    return true;
  }
}
