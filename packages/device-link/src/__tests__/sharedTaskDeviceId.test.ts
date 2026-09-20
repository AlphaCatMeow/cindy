import { describe, expect, it } from 'vitest';
import { sharedTaskDeviceId, sharedTaskGuestPeer, parseSharedTaskPeer } from '@cindy/device-link-protocol/protocol';

// Keep identical fixtures in both repositories' device-link tests.
describe('shared task device claim encoding', () => {
  it.each(['phone:1', '_legacy', ' device ', '设备/手机', 'phone~1', '%3A', '"quoted"', '\ud800', '\u0000'.repeat(128), 'x'.repeat(128)])('round-trips the auth device domain: %j', deviceId => {
    expect(sharedTaskDeviceId(deviceId)).toBe(deviceId);
    const peer = sharedTaskGuestPeer('t' + ':'.repeat(127), 'm' + ':'.repeat(127), deviceId);
    expect(peer.length).toBeLessThanOrEqual(2048);
    expect(peer.split('~')).toHaveLength(5);
    expect(parseSharedTaskPeer(peer)).toEqual({ sharedTaskId: 't' + ':'.repeat(127), role: 'guest', memberId: 'm' + ':'.repeat(127), deviceId });
  });
  it('preserves old peer encoding and rejects noncanonical aliases', () => {
    expect(sharedTaskGuestPeer('task', 'member', 'phone:1')).toBe('shared-task~task~guest~member~phone%3A1');
    expect(parseSharedTaskPeer('shared-task~task~guest~member~%22phone%3A1%22')).toBeNull();
    expect(parseSharedTaskPeer('shared-task~task~guest~member~%22phone~1%22')).toBeNull();
    expect(parseSharedTaskPeer('shared-task~task~guest~member~%5B1%5D')).toBeNull();
  });
  it.each(['', 'x'.repeat(129), null, 1])('rejects an invalid device claim: %j', value => {
    expect(() => sharedTaskDeviceId(value)).toThrow();
  });
});
