import { describe, expect, it } from 'vitest';
import { sharedTaskHostPeer } from '@cindy/device-link';
import { buildMobileHomePresentation, type MobileHomeSessionLike } from '@/session/mobileHome';
import { buildHomeScopeMenuItems, buildHomeScopePullDownActions } from '@/session/homeChromeMenus';
import { splitSharedHomeGroup } from '@/session/sharedHomeGroup';

const peer = sharedTaskHostPeer('shared', 'host');
function session(id: string, deviceId: string, name: string): MobileHomeSessionLike {
  return {
    id, title: name, status: 'active', workspaceKind: 'dialogue', workingDir: '',
    agentKind: 'cc', model: 'claude',
    createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z',
    deviceLinkDeviceId: deviceId, deviceLinkDeviceName: name,
  };
}

describe('shared tasks in the mobile Home', () => {
  it.each([undefined, peer])('keeps shared rows but excludes task peers from device scopes (selection %s)', (selectedDeviceId) => {
    const home = buildMobileHomePresentation({
      selectedDeviceId,
      devices: [{ deviceId: 'desktop', name: 'My computer', canOpen: true }],
      sessions: [session('local', 'desktop', 'My computer'), session('joined', peer, 'Shared review')],
    });
    expect(home.selectedDeviceId).toBeNull();
    expect(home.chats.map(item => item.session.id).sort()).toEqual(['joined', 'local']);
    expect((home.chats.find(item => item.session.id === 'joined')?.session as MobileHomeSessionLike).deviceLinkDeviceId).toBe(peer);
    expect(home.deviceFilters.map(item => item.deviceId)).toEqual([null, 'desktop']);
    expect(buildHomeScopeMenuItems(home.deviceFilters, 'All').map(item => item.label)).toEqual(['✓ All', 'My computer']);
    expect(buildHomeScopePullDownActions(home.deviceFilters, 'All').map(item => item.title)).toEqual(['All', 'My computer']);
  });

  it('offers only All when the account has joined tasks but no browsable computer', () => {
    const home = buildMobileHomePresentation({ sessions: [session('joined', peer, 'Shared review')] });
    expect(home.chats).toHaveLength(1);
    expect(home.deviceFilters.map(item => item.deviceId)).toEqual([null]);
    expect(home.primaryDevice).toBeNull();
    expect(buildHomeScopeMenuItems(home.deviceFilters, 'All')).toHaveLength(1);
    expect(buildHomeScopePullDownActions(home.deviceFilters, 'All')).toHaveLength(1);
  });

  it('retains real device selection even when its ID resembles a shared peer prefix', () => {
    const deviceId = 'shared-task~real-device';
    const home = buildMobileHomePresentation({
      selectedDeviceId: deviceId,
      devices: [{ deviceId, name: 'My computer', canOpen: true }],
      sessions: [session('local', deviceId, 'My computer'), session('joined', peer, 'Shared review')],
    });
    expect(home.selectedDeviceId).toBe(deviceId);
    expect(home.chats.map(item => item.session.id)).toEqual(['local']);
    expect(home.deviceFilters.map(item => item.deviceId)).toEqual([null, deviceId]);
  });
});

describe('shared Home group', () => {
  const own = { sharedTaskId: 'mine', sessionId: 'owner-task', hostDeviceId: 'desktop', ownerAccountId: 'owner', title: 'My share', revision: 1 };
  const split = (sessions: MobileHomeSessionLike[], owned = [own], searchQuery = '', statusFilter: 'active' | 'archived' | 'all' = 'active', selectedDeviceId?: string) => {
    const home = buildMobileHomePresentation({ sessions, searchQuery, statusFilter, selectedDeviceId, devices: [
      { deviceId: 'desktop', name: 'Desktop', canOpen: true },
      { deviceId: 'other', name: 'Other', canOpen: true },
    ] });
    return splitSharedHomeGroup(home, owned, { sessions, searchQuery, statusFilter });
  };

  it('groups joined and owned tasks, retaining ordinary tasks without duplicates', () => {
    const result = split([session('joined', peer, 'Joined'), session('owner-task', 'desktop', 'My share'), session('normal', 'desktop', 'Normal')]);
    expect(result.rows.map(row => row.item?.session.id).sort()).toEqual(['joined', 'owner-task']);
    expect(result.home.chats.map(item => item.session.id)).toEqual(['normal']);
    expect((result.rows.find(row => row.item?.session.id === 'joined')?.item?.session as MobileHomeSessionLike).deviceLinkDeviceId).toBe(peer);
  });

  it('keeps account-discovered owner tasks visible before their device is controllable', () => {
    expect(split([]).rows).toEqual([{ key: 'shared:mine', task: own }]);
    expect(split([], []).rows).toEqual([]);
  });

  it('moves pinned and project shared tasks into the same group', () => {
    const result = split([
      { ...session('joined', peer, 'Joined'), pinnedAt: '2026-09-21T00:00:00.000Z' },
      { ...session('owner-task', 'desktop', 'My share'), workspaceKind: 'project', workingDir: '/repo' },
      { ...session('normal', 'desktop', 'Normal'), workspaceKind: 'project', workingDir: '/repo' },
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.home.pinned).toEqual([]);
    expect(result.home.projects[0].sessions.map(item => item.session.id)).toEqual(['normal']);
    expect(result.home.projects[0].sessionCount).toBe(1);
  });

  it('does not reintroduce hydrated owner tasks hidden by search or status', () => {
    const sessions = [session('owner-task', 'desktop', 'My share')];
    expect(split(sessions, [own], 'unmatched').rows).toEqual([]);
    expect(split(sessions, [own], '', 'archived').rows).toEqual([]);
  });

  it('applies search, device and archive filters to discovery-only rows', () => {
    expect(split([], [own], 'SHARE').rows).toHaveLength(1);
    expect(split([], [own], 'unmatched').rows).toEqual([]);
    expect(split([], [own], '', 'archived').rows).toEqual([]);
    expect(split([], [own], '', 'active', 'other').rows).toEqual([]);
    expect(split([], [own], '', 'active', 'desktop').rows).toHaveLength(1);
  });

  it('does not merge a same-ID task on a different host', () => {
    const result = split([session('owner-task', 'other', 'Unrelated')]);
    expect(result.rows).toEqual([{ key: 'shared:mine', task: own }]);
    expect(result.home.chats[0].title).toBe('Unrelated');
  });

  it('returns a no-longer-shared owner task to the ordinary list', () => {
    const result = split([session('owner-task', 'desktop', 'My share')], []);
    expect(result.rows).toEqual([]);
    expect(result.home.chats).toHaveLength(1);
  });
});
