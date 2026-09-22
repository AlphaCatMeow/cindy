// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RemoteResource } from '@cindy/device-link';

const h = vi.hoisted(() => ({
  drawer: {} as any, accounts: {} as any, profile: {} as any,
  dismiss: vi.fn(), push: vi.fn(), chooseMode: vi.fn(),
  auth: { accountGeneration: 1, user: null, logout: vi.fn(), beginAddAccount: vi.fn() },
}));
vi.mock('react-native', () => ({
  Keyboard: { dismiss: h.dismiss }, Alert: { alert: vi.fn() },
  View: ({ children, testID }: any) => createElement('div', { 'data-testid': testID }, children),
  Pressable: ({ children, onPress, testID }: any) => createElement('button', { onClick: onPress, 'data-testid': testID }, children),
  StyleSheet: { create: (s: unknown) => s },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s, i18n: { language: 'en' } }) }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => h.auth }));
vi.mock('@/components/AppText', () => ({ Text: 'span' }));
vi.mock('@/components/RemoteCompanionAvatar', () => ({ RemoteCompanionAvatar: () => null }));
vi.mock('@/theme', async () => {
  const tokens = await import('@/theme/tokens');
  return { ...tokens, useTheme: () => ({ colors: tokens.lightColors }), useThemedStyles: (fn: any) => fn(tokens.lightColors) };
});
vi.mock('lucide-react-native', () => ({ ChevronDown: () => null, PanelLeft: () => null, Settings2: () => null }));
vi.mock('@/session/HomeHeaderGlassButton', () => ({ HomeHeaderGlassButton: ({ onPress, testID, children }: any) =>
  createElement('button', { onClick: onPress, 'data-testid': testID }, children) }));
vi.mock('@/session/TeammatePicker', () => ({ TeammatePicker: () => null }));
vi.mock('@/session/CompanionProfileSheet', () => ({ CompanionCreateSheet: () => null,
  CompanionProfileSheet: (props: unknown) => { h.profile = props; return null; } }));
vi.mock('@/session/CompanionAutomationSheet', () => ({ CompanionAutomationSheet: () => null }));
vi.mock('@/session/useTeammateNavigation', () => ({ useTeammateNavigation: () => ({ chooseMode: h.chooseMode }) }));
vi.mock('@/utils/useGuardedPush', () => ({ useGuardedPush: () => h.push }));
vi.mock('@/device-link/remoteStatus', () => ({ formatRemoteError: String }));
vi.mock('@/session/remoteSessionStore', () => ({ remoteSessionStore: {
  subscribe: () => () => {}, getSessions: () => [], isSessionRunning: () => false,
} }));
vi.mock('@/session/AccountSwitcherSheet', () => ({ AccountSwitcherSheet: (props: unknown) => { h.accounts = props; return null; } }));
vi.mock('@/session/HomeChromeDrawer', () => ({ HomeChromeDrawer: (props: any) => {
  h.drawer = props;
  return createElement('div', { 'data-drawer': true, 'data-open': props.open });
} }));
import { CompanionHeader } from '@/session/CompanionHeader';
import { CompanionNavigationDrawer } from '@/session/CompanionNavigationDrawer';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root; let host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks(); h.auth.accountGeneration = 1;
  h.drawer = {}; h.accounts = {}; h.profile = {};
  host = document.createElement('div'); root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));

it('opens navigation through the page owner without mounting an overlay inside the clipped header', async () => {
  const onOpenNavigation = vi.fn(), onSearch = vi.fn();
  const resource = { ref: { kind: 'bot', collectionId: 'bots', id: 'bot' }, display: { title: 'Cindy' } } as RemoteResource;
  await act(async () => root.render(<CompanionHeader resource={resource} deviceId="pc" deviceName="PC" online
    onOpenNavigation={onOpenNavigation} onSearch={onSearch} />));
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="companion.navigation"]')!.click());
  expect(h.dismiss).toHaveBeenCalledOnce();
  expect(onOpenNavigation).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-drawer]')).toBeNull();
  // Profile/search remain the existing sheet flow, independent of drawer ownership.
  await act(async () => host.querySelector<HTMLButtonElement>('[data-testid="companion.settings"]')!.click());
  expect(h.profile.visible).toBe(true);
  await act(async () => h.profile.onOpenSearch());
  expect(onSearch).not.toHaveBeenCalled();
  await act(async () => h.profile.onClosed());
  expect(onSearch).toHaveBeenCalledOnce();
});

it.each([
  ['onOpenSettings', '/settings'], ['onOpenDevices', '/devices/manage'],
])('preserves %s navigation after the full-screen drawer finishes closing', async (action, route) => {
  const onClose = vi.fn();
  await act(async () => root.render(<CompanionNavigationDrawer open onClose={onClose} onSearch={() => {}} />));
  await act(async () => h.drawer[action]());
  expect(onClose).toHaveBeenCalledOnce(); expect(h.push).not.toHaveBeenCalled();
  await act(async () => h.drawer.onClosed());
  expect(h.push).toHaveBeenCalledExactlyOnceWith(route);
  await act(async () => h.drawer.onClosed());
  expect(h.push).toHaveBeenCalledTimes(1);
});

it('preserves search, mode switching, account switching and logout actions', async () => {
  const onSearch = vi.fn();
  await act(async () => root.render(<CompanionNavigationDrawer open onClose={() => {}} onSearch={onSearch} />));
  await act(async () => h.drawer.onOpenSearch()); expect(onSearch).not.toHaveBeenCalled();
  await act(async () => h.drawer.onClosed()); expect(onSearch).toHaveBeenCalledOnce();
  await act(async () => h.drawer.onModeChange('tasks')); expect(h.chooseMode).not.toHaveBeenCalled();
  await act(async () => h.drawer.onClosed()); expect(h.chooseMode).toHaveBeenCalledWith('tasks');
  await act(async () => { h.drawer.onOpenAccounts(); h.drawer.onClosed(); }); expect(h.accounts.visible).toBe(true);
  h.auth.logout.mockResolvedValue(undefined);
  await act(async () => h.drawer.onLogout()); expect(h.auth.logout).toHaveBeenCalledOnce();
});

it.each(['account', 'companion'])('drops a queued navigation action when the %s scope changes', async (change) => {
  const render = (scope: string) => act(async () => root.render(<CompanionNavigationDrawer key={scope} open onClose={() => {}} onSearch={() => {}} />));
  await render('old');
  await act(async () => h.drawer.onOpenSettings());
  const staleFinish = h.drawer.onClosed;
  if (change === 'account') h.auth.accountGeneration++;
  await render('new');
  await act(async () => staleFinish());
  expect(h.push).not.toHaveBeenCalled();
});
