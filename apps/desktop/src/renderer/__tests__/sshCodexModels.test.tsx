// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSshCodexProviders } from '@/hooks/useSshCodexProviders';
import { loadSshSessionModelSelection } from '@/features/cc-agent/sshSessionModelSelection';
import { sshNativeCodexProvider, sshModel } from '@/features/cc-agent/__tests__/sshModelFixtures';
import { setDataOwnerGeneration } from '@/contexts/dataOwnerGeneration';

const list = vi.fn();
let statusChanged: (snapshot: RemoteHostSnapshot) => void;
beforeEach(() => {
  setDataOwnerGeneration('owner', 1);
  list.mockReset();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { remoteSsh: {
    listCodexModels: list,
    onStatusChanged: (callback: typeof statusChanged) => { statusChanged = callback; return vi.fn(); },
  } } });
});
afterEach(cleanup);
const providers = (model: string) => [sshNativeCodexProvider([sshModel(model)])];

describe('SSH Codex model discovery', () => {
  it('keeps the catalog on repeated ready snapshots and reloads once on reconnect', async () => {
    list.mockResolvedValue(providers('remote-model'));
    const view = renderHook(() => useSshCodexProviders('a'));
    const status = (value: string) => statusChanged({ config: { id: 'a' }, status: value } as RemoteHostSnapshot);
    act(() => { status('ready'); status('ready'); });
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
    const catalog = view.result.current.providers;
    act(() => { status('ready'); status('ready'); });
    expect(list).toHaveBeenCalledTimes(1);
    expect(view.result.current.providers).toBe(catalog);
    expect(view.result.current.status).toBe('ready');
    act(() => { status('disconnected'); status('connecting'); status('ready'); status('ready'); });
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
    expect(list).toHaveBeenCalledTimes(2);
    act(() => view.result.current.refresh());
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
  });
  it('ignores late results from a previous host and invalidates on disconnect', async () => {
    let finish!: (value: ReturnType<typeof providers>) => void;
    list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(providers('host-b'));
    const view = renderHook(({ hostId }) => useSshCodexProviders(hostId), { initialProps: { hostId: 'a' } });
    view.rerender({ hostId: 'b' });
    await waitFor(() => expect(view.result.current.providers[0]?.models.codex?.[0].id).toBe('host-b'));
    await act(async () => { finish(providers('host-a')); });
    expect(view.result.current.providers[0].models.codex?.[0].id).toBe('host-b');
    act(() => statusChanged({ config: { id: 'b' }, status: 'disconnected' } as RemoteHostSnapshot));
    expect(view.result.current.status).toBe('error');
    expect(view.result.current.providers).toEqual([]);
    act(() => statusChanged({ config: { id: 'b' }, status: 'ready' } as RemoteHostSnapshot));
    await waitFor(() => expect(view.result.current.status).toBe('ready'));
  });
  it('drops a previous account response and allows explicit retry after a read failure', async () => {
    let finish!: (value: ReturnType<typeof providers>) => void;
    list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(providers('new'));
    const view = renderHook(() => useSshCodexProviders('a'));
    setDataOwnerGeneration('other', 2);
    view.rerender();
    await waitFor(() => expect(view.result.current.status).toBe('error'));
    await act(async () => finish(providers('old')));
    expect(view.result.current.providers).toEqual([]);
    act(() => view.result.current.refresh());
    await waitFor(() => expect(view.result.current.providers[0]?.models.codex?.[0].id).toBe('new'));
  });
  it('creates with the host default even if the controller has only a gateway or a failed catalog', async () => {
    list.mockResolvedValue(providers('remote-native'));
    const selection = await loadSshSessionModelSelection('builder', {
      providers: [], loading: false, loadFailed: true, agentKind: 'codex',
      preferred: { model: 'codex/local-model', providerId: 'xd', effort: 'medium', fastMode: true },
    });
    expect(list).toHaveBeenCalledWith('builder');
    expect(selection).toEqual({ ok: true, model: 'remote-native', providerId: 'openai', effort: 'high', fastMode: false });
  });
  it('fails creation without falling back to local models', async () => {
    list.mockRejectedValue(new Error('remote unavailable'));
    expect(await loadSshSessionModelSelection('builder', {
      providers: providers('controller-native'), loading: false, loadFailed: false, agentKind: 'codex',
      preferred: { model: 'controller-native', effort: 'low', fastMode: false },
    })).toEqual({ ok: false, reason: 'catalog-error' });
  });
});
