import type { ActivityActor } from '../../activity-logs/activity-logs.service';

/** Build a consistent audit actor from the JWT request user. */
export function actorFromRequest(user: any): ActivityActor | undefined {
  if (!user?.userId) return undefined;
  return {
    userId: String(user.userId),
    name: user.name || user.email || 'User',
    email: user.email || null,
    role: user.role || null,
  };
}
