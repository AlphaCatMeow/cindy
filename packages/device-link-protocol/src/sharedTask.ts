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
/** Matches auth-server's device claim contract; never use for internal IDs. */
export function sharedTaskDeviceId(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) throw new Error('Invalid sharedTask device identifier');
  return value;
}
function encodeDeviceId(value: string): string {
  const deviceId = sharedTaskDeviceId(value);
  // Preserve the existing encoding for normal IDs. JSON quotes distinguish the
  // extended domain and preserve every UTF-16 code unit, including surrogates.
  const encoded = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(deviceId) ? deviceId : JSON.stringify(deviceId);
  return encodeURIComponent(encoded).replaceAll('~', '%7E');
}
export function sharedTaskHostPeer(sharedTaskId: string): string {
  return `${SHARED_TASK_PEER_PREFIX}${encodeURIComponent(identifier(sharedTaskId))}~host`;
}
export function sharedTaskGuestPeer(sharedTaskId: string, memberId: string, deviceId: string): string {
  return `${SHARED_TASK_PEER_PREFIX}${encodeURIComponent(identifier(sharedTaskId))}~guest~${encodeURIComponent(identifier(memberId))}~${encodeDeviceId(deviceId)}`;
}
export function isSharedTaskPeer(value: unknown): value is `shared-task~${string}` {
  return typeof value === 'string' && value.startsWith(SHARED_TASK_PEER_PREFIX);
}
/** Malformed reserved peers must be rejected, never retried as legacy device IDs. */
export function parseSharedTaskPeer(value: unknown): SharedTaskPeer | null {
  if (!isSharedTaskPeer(value) || value.length > 2048) return null;
  try {
    const parts = value.split('~');
    const sharedTaskId = identifier(decodeURIComponent(parts[1] ?? ''));
    if (parts.length === 3 && parts[2] === 'host' && sharedTaskHostPeer(sharedTaskId) === value) return { sharedTaskId, role: 'host' };
    if (parts.length !== 5 || parts[2] !== 'guest') return null;
    const memberId = identifier(decodeURIComponent(parts[3]));
    const decodedDeviceId = decodeURIComponent(parts[4]);
    const deviceId = sharedTaskDeviceId(decodedDeviceId.startsWith('"') ? JSON.parse(decodedDeviceId) : decodedDeviceId);
    return sharedTaskGuestPeer(sharedTaskId, memberId, deviceId) === value ? { sharedTaskId, role: 'guest', memberId, deviceId } : null;
  } catch { return null; }
}
