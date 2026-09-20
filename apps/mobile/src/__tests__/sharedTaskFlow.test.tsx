// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sharedTaskHostPeer } from '@cindy/device-link';
import { setMobileAuthOwner } from '@/auth/authOwnerGeneration';
import { ApiError } from '@/api/client';
import { Platform } from 'react-native';
import SharedSessionScreen from '../../app/shared-session';

const h = vi.hoisted(() => ({
  params: {} as { sessionId?: string; deviceId?: string }, generation: 1,
  router: { replace: vi.fn() }, alert: vi.fn(), revoked: vi.fn(),
  link: { sharedTaskAvailable: true, invoke: vi.fn(), openLink: vi.fn(), closeLink: vi.fn(), readDeviceList: vi.fn() },
  api: { list: vi.fn(), get: vi.fn(), join: vi.fn(), leave: vi.fn(), close: vi.fn() },
  store: { getSessions: () => [], removeDevice: vi.fn(), setDeviceSessions: vi.fn() },
  t: (key: string, options?: { title?: string }) => options?.title ? key + ':' + options.title : key,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: h.t }) }));
vi.mock('@/i18n', () => ({ i18n: { t: (key: string) => key } }));
vi.mock('lucide-react-native', () => ({ Check: () => null, Laptop: () => null, Link: () => null, Users: () => null, Clock: () => null, FileText: () => null, Square: () => null, X: () => null }));
vi.mock('@/device-link/accessRevoked', () => ({ markDeviceAccessRevoked: h.revoked }));
vi.mock('expo-router', async () => {
  const { useEffect } = await import('react');
  return { Stack: { Screen: () => null }, useLocalSearchParams: () => h.params, useRouter: () => h.router, useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ isAuthenticated: true, accountGeneration: h.generation }) }));
vi.mock('@/device-link/DeviceLinkContext', () => ({ useDeviceLink: () => h.link }));
vi.mock('@/device-link/useSharedTaskApi', () => ({ useSharedTaskApi: () => h.api }));
vi.mock('@/session/remoteSessionStore', () => ({ remoteSessionStore: h.store }));
vi.mock('@/session/messageActions', () => ({ writeClipboardText: vi.fn() }));
// Workflow/authorization tests; platform dialog rendering has separate coverage.
vi.mock('@/session/useSharedTaskConfirmation', async () => {
  const { showConfirm } = await import('@/platform/chrome/showActionMenu');
  return { useSharedTaskConfirmation: () => ({ confirm: showConfirm, dialog: null }) };
});
vi.mock('@/utils/backGuard', () => ({ goBackGuarded: vi.fn() }));
vi.mock('xdt-ios-action-sheet', () => ({ iosBottomActionSheetAvailable: false, showIosBottomActionSheet: vi.fn() }));
vi.mock('react-native', () => ({
  ActionSheetIOS: {},
  Alert: { alert: h.alert }, AppState: { currentState: 'active' }, Keyboard: { dismiss: vi.fn() },
  Platform: { OS: 'android' },
  AccessibilityInfo: { setAccessibilityFocus: vi.fn() }, findNodeHandle: () => null,
  View: ({ children, testID, accessibilityElementsHidden }: { children?: ReactNode; testID?: string; accessibilityElementsHidden?: boolean }) => createElement('div', { 'data-testid': testID, hidden: accessibilityElementsHidden }, children),
  KeyboardAvoidingView: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  Pressable: ({ children, onPress, accessibilityLabel }: { children?: ReactNode; onPress(): void; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
  ScrollView: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  StyleSheet: { create: (value: unknown) => value },
}));
vi.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: { children?: ReactNode }) => children }));
vi.mock('@/components/AppText', () => ({
  Text: ({ children }: { children?: ReactNode }) => createElement('span', null, children),
  TextInput: ({ accessibilityLabel, multiline, maxLength, value, onChangeText }: { accessibilityLabel: string; multiline?: boolean; maxLength?: number; value: string; onChangeText(value: string): void }) => createElement(multiline ? 'textarea' : 'input', { 'aria-label': accessibilityLabel, maxLength, value, onInput: (e: { currentTarget: HTMLInputElement }) => onChangeText(e.currentTarget.value), onChange: () => {} }),
}));
vi.mock('@/components/MobilePrimitives', () => ({
  MainWindowActionButton: ({ action }: { action: { label: string; disabled?: boolean; busy?: boolean; onPress(): void } }) => createElement('button', { disabled: action.disabled || action.busy, onClick: action.onPress }, action.label),
  MainWindowRowButton: ({ children, onPress, accessibilityLabel }: { children?: ReactNode; onPress(): void; accessibilityLabel?: string }) => createElement('button', { onClick: onPress, 'aria-label': accessibilityLabel }, children),
  MainWindowOptionButton: ({ label, onPress }: { label: string; onPress(): void }) => createElement('button', { onClick: onPress }, label),
}));
vi.mock('@/platform/chrome/SimpleStackHeader', () => ({ SimpleStackHeader: ({ title, onBack }: { title: string; onBack(): void }) => createElement('header', null, title, createElement('button', { onClick: onBack }, 'back')), simpleScreenSafeAreaEdges: () => [] }));
vi.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) }));
let element: HTMLDivElement;
let root: Root;
const detail = { sharedTaskId: 'shared', sessionId: 'task', status: 'active', title: 'Design review', memberLabels: [{ memberId: 'member', displayName: 'Guest' }] };
const owned = (id: string) => ({ sharedTaskId: id, sessionId: 'task', title: id, ownerAccountId: 'owner', hostDeviceId: 'host' });
async function render() { await act(async () => root.render(createElement(SharedSessionScreen))); }
async function click(label: string) {
  const button = [...element.querySelectorAll('button')].find((button) => button.textContent === label || button.getAttribute('aria-label') === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}
async function fill(label: string, value: string) {
  const input = element.querySelector('[aria-label="' + label + '"]') as HTMLInputElement;
  await act(async () => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); });
}
const confirmation = () => h.alert.mock.lastCall![2] as { style: string; onPress(): void }[];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.resetAllMocks(); h.params = {}; h.generation = 1;
  Platform.OS = 'android';
  setMobileAuthOwner('owner'); h.link.sharedTaskAvailable = true;
  h.api.list.mockResolvedValue([]); h.api.get.mockResolvedValue(detail);
  h.api.join.mockResolvedValue({ sharedTaskId: 'shared' });
  h.link.invoke.mockResolvedValue({ available: true, detail: null });
  h.link.readDeviceList.mockResolvedValue({ devices: [{ deviceId: 'host', name: 'Test computer' }] });
  element = document.createElement('div'); root = createRoot(element);
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });
it('uses a multiline invitation and stops at the joined screen before opening the task', async () => {
  await render();
  expect(element.querySelector('textarea')).not.toBeNull();
  expect(element.querySelector('input')?.maxLength).toBe(32);
  await fill('sharedTask.invitation', 'a'.repeat(43)); await fill('sharedTask.joinNickname', ' Guest ');
  await click('sharedTask.join');
  expect(h.api.join).toHaveBeenCalledWith('a'.repeat(43), 'Guest');
  expect(element.textContent).toContain('sharedTask.joinedTitle:Design review');
  expect(element.querySelector('textarea')).toBeNull();
  expect(h.link.openLink).not.toHaveBeenCalled();
  h.link.invoke.mockResolvedValue({ id: 'task' });
  await click('sharedTask.enterTask');
  expect(h.link.invoke).toHaveBeenCalledWith(sharedTaskHostPeer('shared'), 'local-db:sessions:get', ['task']);
  expect(h.router.replace).toHaveBeenCalledWith(expect.objectContaining({ pathname: '/sessions/[sessionId]' }));
});
it.each(['ios', 'android'] as const)('%s preserves the page on cancel and rejects an old account confirmation', async (platform) => {
  Platform.OS = platform;
  h.params = { sessionId: 'task', deviceId: sharedTaskHostPeer('shared') }; await render();
  const originalPage = element.innerHTML;
  await click('sharedTask.leave');
  expect(h.alert).toHaveBeenCalledTimes(1);
  expect(element.innerHTML).toBe(originalPage);
  await click('sharedTask.leave');
  expect(h.alert).toHaveBeenCalledTimes(1);
  await act(async () => confirmation()[0].onPress());
  expect(element.innerHTML).toBe(originalPage);
  expect(h.api.leave).not.toHaveBeenCalled();
  await click('sharedTask.leave');
  expect(confirmation()[0].style).toBe('cancel');
  expect(h.api.leave).not.toHaveBeenCalled();
  const old = confirmation()[1]; setMobileAuthOwner('other');
  await act(async () => old.onPress!()); expect(h.api.leave).not.toHaveBeenCalled();
  setMobileAuthOwner('owner'); await click('sharedTask.leave');
  await act(async () => confirmation()[1].onPress!());
  expect(h.api.leave).toHaveBeenCalledWith('shared');
  expect(h.router.replace).toHaveBeenCalledWith('/devices');
});
it('replaces stale guest state only for confirmed membership loss and can join again', async () => {
  h.api.list.mockResolvedValue([{ ...owned('shared'), ownerAccountId: 'someone' }]);
  await render(); await click('shared');
  expect(element.textContent).toContain('sharedTask.joinedTitle');
  await click('sharedTask.leave');
  const oldConfirm = confirmation()[1];
  h.api.get.mockRejectedValue(new ApiError('NETWORK_ERROR', 0, 'offline'));
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.textContent).not.toContain('sharedTask.ended'); expect(h.link.closeLink).not.toHaveBeenCalled();
  h.api.get.mockRejectedValue(new ApiError('NOT_FOUND', 404, 'gone'));
  await act(async () => vi.advanceTimersByTimeAsync(5_000));
  expect(element.textContent).toContain('sharedTask.ended');
  expect(element.textContent).not.toContain('sharedTask.leave');
  expect(h.revoked).toHaveBeenCalledWith(sharedTaskHostPeer('shared'));
  await act(async () => oldConfirm.onPress());
  expect(h.api.leave).not.toHaveBeenCalled();
  await click('sharedTask.rejoin'); expect(element.querySelector('textarea')).not.toBeNull();
});
it('closes only the confirmed owned tasks and retains failures for retry', async () => {
  h.params = { sessionId: 'task', deviceId: 'host' };
  h.api.list.mockResolvedValue([owned('one'), owned('two'), { ...owned('foreign'), ownerAccountId: 'other' }]);
  await render(); await click('sharedTask.tabOwned'); await click('sharedTask.closeAll');
  expect(h.alert.mock.lastCall![3].cancelable).toBe(true);
  await act(async () => h.alert.mock.lastCall![3].onDismiss());
  expect(h.api.close).not.toHaveBeenCalled();
  expect(element.querySelector('header')?.textContent).toContain('sharedTask.ownedTitle');
  await click('sharedTask.closeAll');
  expect(h.api.close).not.toHaveBeenCalled();
  expect(h.alert.mock.lastCall![1]).toContain('Test computer');
  h.api.close.mockImplementation((id: string) => id === 'two' ? Promise.reject(new Error('offline')) : Promise.resolve());
  h.api.list.mockResolvedValue([owned('two')]);
  await act(async () => confirmation()[1].onPress!());
  expect(h.api.close.mock.calls.map(([id]) => id)).toEqual(['one', 'two']);
  expect(element.textContent).toContain('sharedTask.closeFailedToast');
  expect(element.textContent).toContain('two'); expect(element.textContent).not.toContain('one');
});
it('guards current-task close and member removal behind separate confirmations', async () => {
  h.params = { sessionId: 'task', deviceId: 'host' }; h.link.invoke.mockResolvedValue({ available: true, detail });
  await render(); await click('sharedTask.removeShort');
  expect(h.link.invoke).not.toHaveBeenCalledWith('host', 'maker:shared-task', [expect.objectContaining({ action: 'remove' })]);
  await act(async () => confirmation()[1].onPress!());
  expect(h.link.invoke).toHaveBeenCalledWith('host', 'maker:shared-task', [{ action: 'remove', sharedTaskId: 'shared', memberId: 'member' }]);
  await click('sharedTask.closeCurrent');
  await act(async () => confirmation()[1].onPress!());
  expect(h.link.invoke).toHaveBeenCalledWith('host', 'maker:shared-task', [{ action: 'close', sharedTaskId: 'shared' }]);
});
it('ignores an old poll after switching away from and back to the current task', async () => {
  h.params = { sessionId: 'task', deviceId: 'host' };
  let finishOld!: (value: unknown) => void;
  h.link.invoke.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  await render();
  await click('sharedTask.tabOwned');
  h.link.invoke.mockResolvedValue({ available: true, detail });
  await click('sharedTask.tabCurrent');
  expect(element.textContent).toContain('Design review');
  await act(async () => finishOld({ available: true, detail: null }));
  expect(element.textContent).toContain('Design review');
  expect(element.textContent).toContain('sharedTask.closeCurrent');
});
