/**
 * Task-scoped logical peers multiplexed over the existing reliable device link.
 * A sharedTask peer is NOT a physical device identifier or an authorization grant.
 * Relay and both endpoints must negotiate this capability before using it.
 */
export const SHARED_TASK_RELAY_CAPABILITY = 'shared-task-v1';
export const SHARED_TASK_PEER_PREFIX = 'shared-task~';
export type SharedTaskPeer =
  | { sharedTaskId: string; role: 'host' }
  | { sharedTaskId: string; role: 'guest'; memberId: string; deviceId: string };

function identifier(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) throw new Error('Invalid sharedTask peer identifier');
  return value;
}
export function sharedTaskHostPeer(sharedTaskId: string): string {
  return `${SHARED_TASK_PEER_PREFIX}${encodeURIComponent(identifier(sharedTaskId))}~host`;
}
export function sharedTaskGuestPeer(sharedTaskId: string, memberId: string, deviceId: string): string {
  return `${SHARED_TASK_PEER_PREFIX}${encodeURIComponent(identifier(sharedTaskId))}~guest~${encodeURIComponent(identifier(memberId))}~${encodeURIComponent(identifier(deviceId))}`;
}
export function isSharedTaskPeer(value: unknown): value is `shared-task~${string}` {
  return typeof value === 'string' && value.startsWith(SHARED_TASK_PEER_PREFIX);
}
/** Malformed reserved peers must be rejected, never retried as legacy device IDs. */
export function parseSharedTaskPeer(value: unknown): SharedTaskPeer | null {
  if (!isSharedTaskPeer(value) || value.length > 1600) return null;
  try {
    const parts = value.split('~');
    const sharedTaskId = identifier(decodeURIComponent(parts[1] ?? ''));
    if (parts.length === 3 && parts[2] === 'host' && sharedTaskHostPeer(sharedTaskId) === value) return { sharedTaskId, role: 'host' };
    if (parts.length !== 5 || parts[2] !== 'guest') return null;
    const memberId = identifier(decodeURIComponent(parts[3]));
    const deviceId = identifier(decodeURIComponent(parts[4]));
    return sharedTaskGuestPeer(sharedTaskId, memberId, deviceId) === value ? { sharedTaskId, role: 'guest', memberId, deviceId } : null;
  } catch { return null; }
}
