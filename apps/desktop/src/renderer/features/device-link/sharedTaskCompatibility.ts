import { extractIpcError } from '@/utils/ipcError';

/** Only explicit capability failures imply an upgrade; offline is retryable. */
export function sharedTaskErrorKey(error: unknown) {
  const code = extractIpcError(error)?.code;
  if (code === 'SHARED_TASK_HOST_LIMIT') return 'sharedTask.hostLimit';
  if (code === 'SHARED_TASK_JOIN_LIMIT') return 'sharedTask.joinLimit';
  if (code === 'SHARED_TASK_GUEST_LIMIT') return 'sharedTask.guestLimit';
  return code === 'DEVICE_LINK_CHANNEL_NOT_ALLOWED' || code === 'DEVICE_LINK_VERSION_MISMATCH'
    || code === 'UNSUPPORTED_CAPABILITY' ? 'sharedTask.upgrade' : 'sharedTask.retry';
}
