// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sharedTaskHostPeer, type SharedTaskDetail } from '@cindy/device-link';
import { SharedTaskButton } from '../SharedTaskButton';
import { setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import type { Session } from '@/lib/ccAgent.types';
import { toast } from '@/lib/toast';
const state = vi.hoisted(() => ({ invoke: vi.fn(), host: vi.fn(), account: vi.fn(), t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: state.t }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ dataOwnerId: 'owner' }) }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
let container: HTMLDivElement;
let root: Root;
const ownerSession = { id: 'session-1' } as Session;
const detail = {
  sharedTaskId: 'st1', sessionId: 'session-1', ownerAccountId: 'owner', hostDeviceId: 'device-a',
  revision: 1, status: 'active', guests: [], memberLabels: [], title: 'Task A',
} as unknown as SharedTaskDetail;
async function openWindow(session: Session) {
  await act(async () => root.render(createElement(SharedTaskButton, { session })));
  const trigger = [...container.querySelectorAll('button')][0];
  await act(async () => { fireEvent.click(trigger); });
  return document.body;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks(); setDataOwnerGeneration('owner');
  Object.assign(window, { electronAPI: {
    deviceLink: { invoke: state.invoke },
    sharedTask: { host: state.host, account: state.account },
  } });
  state.host.mockResolvedValue({ available: true, detail });
  state.account.mockResolvedValue([]);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});
it('renders an upgrade instruction when an old host rejects the new channel', async () => {
  state.host.mockRejectedValue(new Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] unsupported'));
  const body = await openWindow(ownerSession);
  await waitFor(() => expect(body.textContent).toContain('sharedTask.upgrade'));
  expect(body.textContent).not.toContain('sharedTask.open');
});
it('does not mislabel a timeout as an old host', async () => {
  state.host.mockRejectedValue(new Error('[DEVICE_LINK_TIMEOUT] timeout'));
  const body = await openWindow(ownerSession);
  await waitFor(() => expect(body.textContent).toContain('sharedTask.sharing'));
  expect(body.textContent).not.toContain('sharedTask.upgrade');
});
it('distinguishes a local clipboard failure from a shared-task request failure', async () => {
  const copy = vi.fn().mockRejectedValue(new DOMException('Document is not focused.', 'NotAllowedError'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  state.host.mockImplementation((command: { action: string }) => command.action === 'invite'
    ? Promise.resolve({ invitation: 'test-invitation' }) : Promise.resolve({ available: true, detail }));
  const body = await openWindow(ownerSession);
  fireEvent.click(within(body).getByRole('button', { name: 'sharedTask.invite' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('sharedTask.invitationCopyFailed'));
  expect(toast.error).not.toHaveBeenCalledWith('sharedTask.retry');
  expect(toast.success).not.toHaveBeenCalled();
  copy.mockResolvedValue(undefined);
  await waitFor(() => expect(within(body).getByRole('button', { name: 'sharedTask.invite' }).hasAttribute('disabled')).toBe(false));
  fireEvent.click(within(body).getByRole('button', { name: 'sharedTask.invite' }));
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('sharedTask.invitationCopied'));
});

it('keeps invitation request failures distinct and does not attempt to copy', async () => {
  const copy = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  state.host.mockImplementation((command: { action: string }) => command.action === 'invite'
    ? Promise.reject(new Error('[DEVICE_LINK_TIMEOUT] timed out')) : Promise.resolve({ available: true, detail }));
  const body = await openWindow(ownerSession);
  fireEvent.click(within(body).getByRole('button', { name: 'sharedTask.invite' }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('sharedTask.requestTimedOut'));
  expect(copy).not.toHaveBeenCalled();
});
it('ignores a late unsupported response after the data owner changes', async () => {
  let reject!: (error: unknown) => void;
  state.host.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
  const body = await openWindow(ownerSession);
  setDataOwnerGeneration('other');
  await act(async () => reject(new Error('[DEVICE_LINK_CHANNEL_NOT_ALLOWED] unsupported')));
  expect(body.textContent).not.toContain('sharedTask.upgrade');
});
it('lists owned shares and routes close-all through the account command', async () => {
  state.account.mockImplementation((command: { action: string }) => {
    if (command.action === 'owned') {
      return Promise.resolve([
        { sharedTaskId: 'st1', sessionId: 'session-1', ownerAccountId: 'owner', hostDeviceId: 'device-a', title: 'Task A', revision: 1, local: true },
        { sharedTaskId: 'st9', sessionId: 'session-9', ownerAccountId: 'owner', hostDeviceId: 'device-b', title: 'Task B', revision: 1, local: false },
      ]);
    }
    if (command.action === 'close') return Promise.resolve({ closed: ['st1', 'st9'], failed: [] });
    return Promise.resolve(detail);
  });
  const body = await openWindow(ownerSession);
  await waitFor(() => expect(body.textContent).toContain('sharedTask.tabOwned'));
  await act(async () => { fireEvent.click([...body.querySelectorAll('button')].find((b) => b.textContent?.startsWith('sharedTask.tabOwned'))!); });
  await waitFor(() => expect(body.textContent).toContain('sharedTask.ownedIntro'));
  expect(body.textContent).toContain('Task A');
  expect(body.textContent).toContain('sharedTask.thisDevice');
  expect(body.textContent).toContain('Task B');
  await act(async () => { fireEvent.click([...body.querySelectorAll('button')].find((b) => b.textContent?.startsWith('sharedTask.closeAll'))!); });
  await waitFor(() => expect(body.textContent).toContain('sharedTask.closeAllTitle'));
  const confirmation = within(body).getByRole('alertdialog');
  expect(confirmation.contains(document.activeElement)).toBe(true);
  expect(document.activeElement?.textContent).toBe('sharedTask.closeAllKeep');
  expect(within(confirmation).getAllByRole('button').map((button) => button.textContent)).toEqual([
    'sharedTask.closeAllKeep', 'sharedTask.closeAllAction',
  ]);
  expect(body.textContent).toContain('Task B');
  await act(async () => { fireEvent.click([...body.querySelectorAll('button')].find((b) => b.textContent?.startsWith('sharedTask.closeAllAction'))!); });
  await waitFor(() => expect(state.account).toHaveBeenCalledWith({ action: 'close', all: true }));
});
it('keeps the member screen behind a named removal confirmation and cancels without removing', async () => {
  state.host.mockResolvedValue({ available: true, detail: { ...detail,
    guests: [{ memberId: 'guest-1', accountId: 'guest-account' }],
    memberLabels: [{ memberId: 'guest-1', displayName: 'Guest Name' }],
  } });
  const body = await openWindow(ownerSession);
  expect(body.textContent).toContain('Guest Name');
  expect(body.textContent).toContain('sharedTask.roleGuest');
  expect(body.textContent).toContain('sharedTask.inviteBoxTitle');
  fireEvent.click(within(body).getByRole('button', { name: 'sharedTask.removeShort' }));
  const dialog = within(body).getByRole('alertdialog');
  expect(dialog.textContent).toContain('sharedTask.removeNamedTitle');
  fireEvent.click(within(dialog).getByRole('button', { name: 'sharedTask.removeKeep' }));
  await waitFor(() => expect(within(body).queryByRole('alertdialog')).toBeNull());
  expect(state.host.mock.calls.every(([command]) => command.action === 'state')).toBe(true);
});
it('does not route another local task management button to the current task', async () => {
  state.account.mockResolvedValue([{ ...detail, sessionId: 'other-session', sharedTaskId: 'other-share', title: 'Other Task', local: true }]);
  const body = await openWindow(ownerSession);
  fireEvent.click(within(body).getByRole('button', { name: /sharedTask.tabOwned/ }));
  await waitFor(() => expect(body.textContent).toContain('Other Task'));
  expect(within(body).queryByRole('button', { name: 'sharedTask.manage' })).toBeNull();
});
it('shows the host-offline ending for a guest whose share closed', async () => {
  state.account.mockImplementation((command: { action: string }) => command.action === 'get'
    ? Promise.resolve({ ...detail, status: 'closed' })
    : Promise.resolve([]));
  const body = await openWindow({ id: 'session-1', deviceLinkDeviceId: sharedTaskHostPeer('st1', 'desktop') } as Session);
  await waitFor(() => expect(body.textContent).toContain('sharedTask.hostOfflineTitle'));
  expect(body.textContent).toContain('sharedTask.hostOfflineBody');
  expect(body.textContent).not.toContain('sharedTask.leave');
});
