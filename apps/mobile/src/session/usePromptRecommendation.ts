import { useCallback, useEffect, useRef, useState } from 'react';
import type { MobileAgentKind, MobileMakerTransport } from '@/device-link/mobileMakerTransport';

// Runtime-only consumption survives page remounts; owner/device/task are all part of the key.
const consumedRevisions = new Map<string, number>();

export function usePromptRecommendation({ ownerId, deviceId, sessionId, agentKind, revision, running, maker }: {
  ownerId?: string;
  deviceId: string;
  sessionId: string;
  agentKind: MobileAgentKind | null;
  revision?: number | null;
  running: boolean;
  maker: Pick<MobileMakerTransport, 'predictNextPrompt'>;
}) {
  const scope = JSON.stringify([ownerId, deviceId, sessionId]);
  const [result, setResult] = useState<{ scope: string; revision: number; prompt: string } | null>(null);
  // The transport is recreated when the device-link context refreshes. Keep the
  // latest callable without treating that refresh as a new recommendation run.
  const makerRef = useRef(maker);
  makerRef.current = maker;
  const request = useRef<{ scope: string; revision: number; cacheOnly: boolean } | null>(null);
  const observed = useRef({
    scope,
    running: false,
    sawRunning: false,
    revisionAtStart: 0,
    lastRevision: null as number | null,
  });
  const current = useRef({ scope, revision, running });
  current.current = { scope, revision, running };
  const dismiss = useCallback(() => {
    if (revision) consumedRevisions.set(scope, revision);
    setResult(null);
  }, [scope, revision]);

  useEffect(() => {
    if (observed.current.scope !== scope) {
      observed.current = {
        scope,
        running: false,
        sawRunning: false,
        revisionAtStart: 0,
        lastRevision: null,
      };
      request.current = null;
      setResult(null);
    }
    const run = observed.current;
    // A sessions patch can deliver the new completion revision without a
    // visible running edge (for example while the phone is reconnecting).
    // Remember the latest revision so that a strictly newer completion still
    // starts a live prediction instead of being treated as history.
    const revisionAdvanced = revision != null
      && run.lastRevision != null
      && revision > run.lastRevision;
    if (revision != null) run.lastRevision = revision;
    if (running) {
      if (!run.running) {
        // A fresh running edge starts a new completion generation. A dismissal
        // from the previous generation must not suppress this one.
        consumedRevisions.delete(scope);
        run.sawRunning = true;
        run.revisionAtStart = revision ?? 0;
        request.current = null;
        setResult(null);
      }
      run.running = true;
      return;
    }
    run.running = false;
    if (!deviceId || !sessionId || !agentKind || !revision || consumedRevisions.get(scope) === revision) return;
    // Historical navigation only reuses a host result; it never starts a paid prediction.
    // An ended patch may arrive after stopped, so keep the observed run until then.
    const cacheOnly = (!run.sawRunning && !revisionAdvanced)
      || (run.sawRunning && revision <= run.revisionAtStart);
    if (request.current?.scope === scope && request.current.revision === revision
      && request.current.cacheOnly === cacheOnly) return;
    request.current = { scope, revision, cacheOnly };
    let cancelled = false;
    const timer = setTimeout(() => {
      void makerRef.current.predictNextPrompt({ sessionId, agentKind, turnGen: 0, completionRevision: revision, cacheOnly })
        .then(({ prompt }) => {
          const latest = current.current;
          if (!cancelled && latest.scope === scope && latest.revision === revision && !latest.running
            && consumedRevisions.get(scope) !== revision && prompt) {
            setResult({ scope, revision, prompt });
          }
        }).catch(() => { /* Old hosts and unavailable predictions remain silent. */ });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scope, deviceId, sessionId, agentKind, revision, running]);

  return {
    prompt: !running && result?.scope === scope && result.revision === revision
      && consumedRevisions.get(scope) !== revision ? result.prompt : null,
    dismiss,
  };
}
