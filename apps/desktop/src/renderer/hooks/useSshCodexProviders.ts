import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProviderView } from '@cindy/model-providers';
import { getDataOwnerGeneration, isDataOwnerGenerationCurrent } from '@/contexts/dataOwnerGeneration';

const EMPTY: ProviderView[] = [];
export function useSshCodexProviders(hostId?: string | null) {
  const owner = getDataOwnerGeneration();
  const key = JSON.stringify([hostId, owner.dataOwnerId, owner.generation]);
  const sequence = useRef(0);
  const [state, setState] = useState<{ key: string; providers: ProviderView[]; status: 'loading' | 'error' | 'ready' }>({
    key: '', providers: EMPTY, status: 'loading',
  });
  const refresh = useCallback(() => {
    if (!hostId) return;
    const request = ++sequence.current;
    const requestOwner = getDataOwnerGeneration();
    setState({ key, providers: EMPTY, status: 'loading' });
    void window.electronAPI.remoteSsh.listCodexModels(hostId).then((providers) => {
      if (sequence.current === request && isDataOwnerGenerationCurrent(requestOwner)) {
        setState({ key, providers, status: 'ready' });
      }
    }).catch(() => {
      if (sequence.current === request && isDataOwnerGenerationCurrent(requestOwner)) {
        setState({ key, providers: EMPTY, status: 'error' });
      }
    });
  }, [hostId, key]);
  useEffect(() => {
    if (!hostId) return;
    refresh();
    // Initial discovery already covers an existing ready connection. Status
    // snapshots also carry preference/proxy changes; only reconnects reload it.
    let wasReady = true;
    const stop = window.electronAPI.remoteSsh.onStatusChanged((snapshot) => {
      if (snapshot.config.id !== hostId) return;
      if (snapshot.status === 'ready') {
        if (!wasReady) refresh();
        wasReady = true;
      }
      else {
        wasReady = false;
        ++sequence.current;
        setState({ key, providers: EMPTY, status: 'error' });
      }
    });
    return () => { ++sequence.current; stop(); };
  }, [hostId, key, refresh]);
  return {
    providers: state.key === key ? state.providers : EMPTY,
    status: state.key === key ? state.status : 'loading' as const,
    refresh,
  };
}
