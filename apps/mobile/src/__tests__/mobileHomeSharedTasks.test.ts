import { describe, expect, it } from 'vitest';
import { sharedTaskHostPeer } from '@cindy/device-link';
import { buildMobileHomePresentation, type MobileHomeSessionLike } from '@/session/mobileHome';
import { buildHomeScopeMenuItems, buildHomeScopePullDownActions } from '@/session/homeChromeMenus';

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
