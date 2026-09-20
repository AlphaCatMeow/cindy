import { describe, expect, it } from 'vitest';
import { sharedTaskErrorKey } from '../sharedTaskCompatibility';

describe('shared-task compatibility errors', () => {
  it.each([['SHARED_TASK_HOST_LIMIT', 'sharedTask.hostLimit'], ['SHARED_TASK_JOIN_LIMIT', 'sharedTask.joinLimit'],
    ['SHARED_TASK_GUEST_LIMIT', 'sharedTask.guestLimit']])('explains %s without suggesting retry', (code, key) => {
    expect(sharedTaskErrorKey(Object.assign(new Error('limit'), { code }))).toBe(key);
    expect(sharedTaskErrorKey(new Error('[' + code + '] limit'))).toBe(key);
  });
  it.each(['DEVICE_LINK_CHANNEL_NOT_ALLOWED', 'DEVICE_LINK_VERSION_MISMATCH', 'UNSUPPORTED_CAPABILITY'])(
    'recognizes serialized and structured %s', (code) => {
      expect(sharedTaskErrorKey(Object.assign(new Error('unsupported'), { code }))).toBe('sharedTask.upgrade');
      expect(sharedTaskErrorKey(new Error(`Error invoking remote method 'device-link:invoke': Error: [${code}] unsupported`))).toBe('sharedTask.upgrade');
    });
  it.each(['DEVICE_LINK_NOT_CONNECTED', 'DEVICE_LINK_TIMEOUT', 'DEVICE_LINK_ACCESS_REVOKED', 'NOT_FOUND'])(
    'does not turn %s into an upgrade requirement', (code) => {
      expect(sharedTaskErrorKey(new Error(`[${code}] DEVICE_LINK_CHANNEL_NOT_ALLOWED`))).toBe('sharedTask.retry');
    });
});
