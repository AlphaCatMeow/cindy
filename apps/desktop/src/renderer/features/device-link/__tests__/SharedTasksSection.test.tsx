import { sharedTaskHostPeer } from '@cindy/device-link';
// @vitest-environment jsdom
import { render, screen, fireEvent, createEvent, cleanup, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SharedTasksSection } from '../SharedTasksSection';
import { setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';
import type { Session } from '@/lib/ccAgent.types';
const state = vi.hoisted(() => ({ sessions: [] as Session[], account: vi.fn(), openLink: vi.fn(), pin: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, args?: { count?: number }) => key + (args?.count === undefined ? '' : ':' + args.count) }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ dataOwnerId: 'guest', isAuthenticated: true }) }));
vi.mock('../JoinSharedTaskDialog', () => ({ JoinSharedTaskDialog: () => null }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn() } }));
vi.mock('../remoteProjectsStore', () => ({
  useRemoteProjectSessions: () => state.sessions, isRemoteDeviceMarkedDisconnected: () => false,
  remoteProjectsStore: { pinSessionOrigin: state.pin },
}));
const guestTask = { id: 'joined-1', title: 'Joined task', deviceLinkDeviceId: sharedTaskHostPeer('share-1', 'desktop') } as Session;
beforeEach(() => {
  vi.clearAllMocks(); setDataOwnerGeneration('guest');
  state.sessions = [guestTask, { id: 'own-device-task', title: 'Own device task', deviceLinkDeviceId: 'my-computer' } as Session];
  state.account.mockResolvedValue([]);
  Object.assign(window, { electronAPI: { sharedTask: { account: state.account }, deviceLink: { openLink: state.openLink } } });
});
afterEach(cleanup);
it.each(['owned', 'joined'] as const)('suppresses context menus within the %s group without changing left-click actions or sidebar blank space', async (role) => {
  if (role === 'owned') {
    state.sessions = [];
    state.account.mockResolvedValue([{ sharedTaskId: 'owned-1', sessionId: 'host-task', local: true, title: 'Hosted task' }]);
  }
  const organize = vi.fn();
  const select = vi.fn();
  render(<div onContextMenu={organize}>
    <SharedTasksSection onSelect={select} />
    <div data-testid="sidebar-blank" />
  </div>);
  const heading = await screen.findByRole('button', { name: `sharedTask.${role}Section` });
  const title = role === 'owned' ? 'Hosted task' : 'Joined task';
  for (const target of [heading, screen.getByText(title), screen.getByRole('region')]) {
    const event = createEvent.contextMenu(target);
    fireEvent(target, event);
    expect(event.defaultPrevented).toBe(true);
  }
  expect(organize).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  expect(state.openLink).not.toHaveBeenCalled();
  expect(heading.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(heading);
  expect(screen.queryByText(title)).toBeNull();
  fireEvent.click(heading);
  fireEvent.click(screen.getByText(title));
  expect(select).toHaveBeenCalledWith(role === 'owned' ? 'host-task' : 'joined-1');
  fireEvent.contextMenu(screen.getByTestId('sidebar-blank'));
  expect(organize).toHaveBeenCalledTimes(1);
});
it('suppresses context menus on role tabs and both task lists without switching or opening tasks', async () => {
  state.account.mockResolvedValue([{ sharedTaskId: 'owned-1', sessionId: 'host-task', local: true, title: 'Hosted task' }]);
  const organize = vi.fn();
  const select = vi.fn();
  render(<div onContextMenu={organize}><SharedTasksSection onSelect={select} /></div>);
  await screen.findByRole('tablist');
  for (const role of ['owned', 'joined']) {
    const tab = screen.getByRole('tab', { name: `sharedTask.${role}Tab` });
    const selected = tab.getAttribute('aria-selected');
    const event = createEvent.contextMenu(tab);
    fireEvent(tab, event);
    expect(event.defaultPrevented).toBe(true);
    expect(tab.getAttribute('aria-selected')).toBe(selected);
    fireEvent.click(tab);
    const row = screen.getByText(role === 'owned' ? 'Hosted task' : 'Joined task');
    const rowEvent = createEvent.contextMenu(row);
    fireEvent(row, rowEvent);
    expect(rowEvent.defaultPrevented).toBe(true);
  }
  expect(organize).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();
  expect(state.openLink).not.toHaveBeenCalled();
});
it('shows only joined tasks independently of the machine filter and does not reopen the active task', async () => {
  const select = vi.fn();
  render(<SharedTasksSection activeSessionId="joined-1" onSelect={select} />);
  await act(async () => {});
  expect(screen.getByText('sharedTask.joinedSection')).toBeTruthy();
  expect(screen.queryByText('Own device task')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Joined task/ }));
  expect(select).not.toHaveBeenCalled();
  expect(state.openLink).not.toHaveBeenCalled();
});
it('navigates directly from a joined task without opening a new link', async () => {
  const select = vi.fn();
  render(<SharedTasksSection activeSessionId="another" onSelect={select} />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: /Joined task/ }));
  expect(select).toHaveBeenCalledWith('joined-1');
  expect(state.openLink).not.toHaveBeenCalled();
});
it('shows the owned group alone for a host, with local task navigation', async () => {
  state.sessions=[]; state.account.mockResolvedValue([{ sharedTaskId: 'owned-1', sessionId: 'host-task', local: true, title: 'Hosted task' }]);
  const select=vi.fn(); render(<SharedTasksSection onSelect={select} />);
  await screen.findByText('sharedTask.ownedSection');
  expect(screen.queryByRole('tablist')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Hosted task/ }));
  expect(select).toHaveBeenCalledWith('host-task');
  expect(state.openLink).not.toHaveBeenCalled();
});
it('switches roles with a segmented control, then falls back when sharing ends', async () => {
  state.account.mockResolvedValue([{ sharedTaskId: 'owned-1', sessionId: 'host-task', local: true, title: 'Hosted task' }]);
  const { rerender } = render(<SharedTasksSection onSelect={vi.fn()} />);
  await screen.findByRole('tablist');
  fireEvent.click(screen.getByRole('tab', { name: 'sharedTask.ownedTab' }));
  expect(screen.getByRole('tab', { name: 'sharedTask.joinedTab' })).toBeTruthy();
  expect(screen.getByText('Hosted task')).toBeTruthy();
  expect(screen.queryByText('Joined task')).toBeNull();
  state.account.mockResolvedValue([]);
  window.dispatchEvent(new Event('cindy:shared-task-owned-changed'));
  await waitFor(() => expect(screen.queryByRole('tablist')).toBeNull());
  expect(screen.getByText('Joined task')).toBeTruthy();
  state.sessions = [];
  rerender(<SharedTasksSection onSelect={vi.fn()} />);
  expect(screen.queryByRole('region')).toBeNull();
});
it('keeps the sidebar empty until sharing starts and hides it when the last owned share closes', async () => {
  state.sessions = [];
  render(<SharedTasksSection onSelect={vi.fn()} />);
  await act(async () => {});
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  state.account.mockResolvedValue([{ sharedTaskId: 'owned-1', sessionId: 'host-task', local: true, title: 'Hosted task' }]);
  window.dispatchEvent(new Event('cindy:shared-task-owned-changed'));
  expect(await screen.findByRole('button', { name: 'sharedTask.ownedSection' })).toBeTruthy();
  state.account.mockResolvedValue([]);
  window.dispatchEvent(new Event('cindy:shared-task-owned-changed'));
  await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
});
it('does not register a remote origin or navigate after an account change during opening', async () => {
  state.sessions=[]; state.account.mockResolvedValue([{ sharedTaskId: 'owned-1', sessionId: 'host-task', hostDeviceId: 'other-pc', local: false, title: 'Hosted task' }]);
  let finish!: () => void; state.openLink.mockImplementation(() => new Promise<void>(resolve => { finish=resolve; }));
  const select=vi.fn(); render(<SharedTasksSection onSelect={select} />);
  fireEvent.click(await screen.findByRole('button', { name: /Hosted task/ }));
  await act(async () => { setDataOwnerGeneration('new-account'); finish(); });
  expect(state.pin).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});
