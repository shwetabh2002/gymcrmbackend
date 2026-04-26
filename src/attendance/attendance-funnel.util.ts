import { randomBytes } from 'crypto';

/** 8 hex chars to grep logs: `[AttendanceFunnel a1b2c3d4]`. */
export function newFunnelId(): string {
  return randomBytes(4).toString('hex');
}

export function formatFunnel(id: string | undefined, msg: string): string {
  return id
    ? `[AttendanceFunnel ${id}] ${msg}`
    : `[AttendanceFunnel] ${msg}`;
}
