/**
 * Rate limits in one place, so tightening a public endpoint is a one-line edit
 * instead of hunting for inline @Throttle decorators.
 */
import { MINUTE_MS } from './time.constants';

/** Applied to every route by the global ThrottlerGuard. */
export const GLOBAL_THROTTLE = { ttl: MINUTE_MS, limit: 100 } as const;

/** Credential stuffing surface — deliberately much tighter. */
export const LOGIN_THROTTLE = { ttl: MINUTE_MS, limit: 5 } as const;

/** Public self-signup creates a tenant, so keep it slow. */
export const SIGNUP_THROTTLE = { ttl: MINUTE_MS, limit: 3 } as const;
