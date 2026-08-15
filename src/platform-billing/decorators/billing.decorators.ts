import { SetMetadata } from '@nestjs/common';
import { PlatformFeature } from '../../config/platform-billing.config';

export const BILLING_EXEMPT_KEY = 'billing:exempt';

/**
 * Skips the subscription check.
 *
 * Needed on auth and on the billing screens themselves — a gym whose trial has
 * lapsed must still be able to sign in and pay, or the gate would lock out the
 * very people trying to become customers.
 */
export const BillingExempt = () => SetMetadata(BILLING_EXEMPT_KEY, true);

export const REQUIRED_FEATURE_KEY = 'billing:feature';

/** Restricts a route to plans that include the given capability. */
export const RequiresFeature = (feature: PlatformFeature) =>
  SetMetadata(REQUIRED_FEATURE_KEY, feature);
