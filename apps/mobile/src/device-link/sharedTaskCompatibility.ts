/** Transport codes and anchored serialized host IPC codes, never arbitrary text. */
export function sharedTaskErrorKey(error: unknown) {
  let code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (code === undefined || code === 'IPC_ERROR') {
    const message = error instanceof Error ? error.message : '';
    code = /^(?:Error invoking remote method '[^']+': Error: )?\[([A-Z0-9_]+)\]/.exec(message)?.[1];
  }
  if (code === 'SHARED_TASK_HOST_LIMIT') return 'sharedTask.hostLimit';
  if (code === 'SHARED_TASK_JOIN_LIMIT') return 'sharedTask.joinLimit';
  if (code === 'SHARED_TASK_GUEST_LIMIT') return 'sharedTask.guestLimit';
  return code === 'CHANNEL_NOT_ALLOWED' || code === 'DEVICE_LINK_CHANNEL_NOT_ALLOWED'
    || code === 'VERSION_MISMATCH' || code === 'DEVICE_LINK_VERSION_MISMATCH'
    || code === 'UNSUPPORTED_CAPABILITY' ? 'sharedTask.upgrade' : 'sharedTask.retry';
}
