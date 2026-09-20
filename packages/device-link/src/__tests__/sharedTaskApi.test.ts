import { describe, expect, it, vi } from 'vitest';
import { createSharedTaskApi, SharedTaskScopeChangedError } from '../sharedTaskApi.js';

const snapshot = () => ({
  sharedTaskId: 'sharedTask', sessionId: 'session', ownerAccountId: 'owner', hostDeviceId: 'desktop',
  revision: 2, status: 'active', title: 'Task', guests: [{
    memberId: 'member', accountId: 'guest', deviceIds: ['phone'], version: 1, displayName: 'Guest', joinedAt: 1,
  }],
});
function setup() {
  let generation = 1;
  const request = vi.fn<(path: string, options: unknown) => Promise<unknown>>();
  const api = createSharedTaskApi({ request, captureScope: () => {
    const captured = generation;
    return { isCurrent: () => captured === generation };
  } });
  return { api, request, changeAccountOrRegion: () => { generation++; } };
}

it('reads extended host device IDs in the shared task list', async () => {
  const { api, request } = setup();
  request.mockResolvedValue({ sharedTasks: [{ ...snapshot(), hostDeviceId: ' 主机~1 ' }] });
  await expect(api.list()).resolves.toEqual([expect.objectContaining({ hostDeviceId: ' 主机~1 ' })]);
});
describe('sharedTask management client', () => {
  it('observes a late create ID for host cleanup but never returns stale UI success', async () => {
    const { api, request, changeAccountOrRegion } = setup();
    const observed = vi.fn();
    request.mockImplementation(async () => { changeAccountOrRegion(); return { sharedTaskId: 'sharedTask', revision: 1 }; });
    await expect(api.create('session', 'Task', observed)).rejects.toBeInstanceOf(SharedTaskScopeChangedError);
    expect(observed).toHaveBeenCalledExactlyOnceWith('sharedTask');
  });
  it('does not pass malformed create IDs to cleanup', async () => {
    const { api, request } = setup();
    const observed = vi.fn();
    request.mockResolvedValue({ sharedTaskId: '../bad', revision: 1 });
    await expect(api.create('session', 'Task', observed)).rejects.toThrow('identifier');
    expect(observed).not.toHaveBeenCalled();
  });
  it('projects the server snapshot separately from display labels', async () => {
    const { api, request } = setup();
    const input = snapshot();
    request.mockResolvedValue(input);
    const detail = await api.get('sharedTask');
    expect(detail.guests[0]).not.toHaveProperty('displayName');
    expect(detail.memberLabels).toEqual([{ memberId: 'member', displayName: 'Guest', joinedAt: 1 }]);
    input.guests[0].deviceIds.push('another');
    expect(detail.guests[0].deviceIds).toEqual(['phone']);
    expect(request).toHaveBeenCalledWith('/api/device-link/shared-tasks/sharedTask', expect.objectContaining({ method: 'GET' }));
  });
  it('keeps invitation credentials in POST bodies instead of URL paths', async () => {
    const { api, request } = setup();
    const invitation = 'x'.repeat(43);
    request.mockResolvedValue({ sharedTaskId: 'sharedTask', memberId: 'member', status: 'joined', created: true });
    await api.join(invitation, 'Guest');
    expect(request).toHaveBeenCalledWith('/api/device-link/shared-tasks/join', expect.objectContaining({ method: 'POST', body: { invitation, displayName: 'Guest' } }));
    expect(request.mock.calls[0][0]).not.toContain(invitation);
  });
  it('rejects late authority replies after account or region changes', async () => {
    const { api, request, changeAccountOrRegion } = setup();
    request.mockImplementation(async () => { changeAccountOrRegion(); return snapshot(); });
    await expect(api.get('sharedTask')).rejects.toBeInstanceOf(SharedTaskScopeChangedError);
  });
  it('does not submit operations for an already invalid scope', async () => {
    const request = vi.fn();
    const api = createSharedTaskApi({ request, captureScope: () => ({ isCurrent: () => false }) });
    await expect(api.close('sharedTask')).rejects.toBeInstanceOf(SharedTaskScopeChangedError);
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects responses for another sharedTask or member', async () => {
    const { api, request } = setup();
    request.mockResolvedValue({ ...snapshot(), sharedTaskId: 'other-sharedTask' });
    await expect(api.get('sharedTask')).rejects.toThrow('scope mismatch');
    request.mockResolvedValue({ memberId: 'other-member', status: 'removed' });
    await expect(api.remove('sharedTask', 'member')).rejects.toThrow('scope mismatch');
  });
  it('validates decisions, identifier paths, and malformed snapshots', async () => {
    const { api, request } = setup();
    await expect(api.close('../devices')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    request.mockResolvedValue({ ...snapshot(), guests: [{ ...snapshot().guests[0], accountId: 'owner' }] });
    await expect(api.get('sharedTask')).rejects.toThrow();
  });
  it('preserves server errors instead of silently accepting failed revocations', async () => {
    const { api, request } = setup();
    const error = new Error('Service unavailable');
    request.mockRejectedValue(error);
    await expect(api.remove('sharedTask', 'member')).rejects.toBe(error);
    await expect(api.close('sharedTask')).rejects.toBe(error);
  });
  it('validates list bounds', async () => {
    const { api, request } = setup();
    request.mockResolvedValue({ sharedTasks: [snapshot(), snapshot()] });
    await expect(api.list()).rejects.toThrow('Duplicate');
  });
});
