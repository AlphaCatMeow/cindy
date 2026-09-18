// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { usePromptRecommendation } from '@/session/usePromptRecommendation';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let props: Parameters<typeof usePromptRecommendation>[0];
let value: ReturnType<typeof usePromptRecommendation>;
let request: ReturnType<typeof vi.fn>;
let sequence = 0;
function Probe() { value = usePromptRecommendation(props); return null; }
async function render(patch: Partial<typeof props> = {}) {
  props = { ...props, ...patch };
  await act(async () => root.render(createElement(Probe)));
}
async function advance() { await act(async () => vi.advanceTimersByTimeAsync(500)); }
beforeEach(() => {
  vi.useFakeTimers();
  request = vi.fn().mockResolvedValue({ prompt: 'Suggested next step' });
  props = { ownerId: 'owner', deviceId: 'host', sessionId: `task-${++sequence}`, agentKind: 'codex',
    revision: 10, running: false, maker: { predictNextPrompt: request } };
  root = createRoot(document.createElement('div'));
});
afterEach(async () => { await act(async () => root.unmount()); vi.useRealTimers(); });

it('historical navigation only requests a cached host result', async () => {
  await render(); await advance();
  expect(request).toHaveBeenCalledWith(expect.objectContaining({ cacheOnly: true, completionRevision: 10 }));
  expect(value.prompt).toBe('Suggested next step');
});

it('waits for the new completion revision even when stopped arrives first', async () => {
  await render({ running: true }); await advance();
  expect(request).not.toHaveBeenCalled();
  await render({ running: false }); await advance();
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ cacheOnly: true }));
  await render({ revision: 20 }); await advance();
  expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ cacheOnly: false, completionRevision: 20 }));
});

it('dismissal or sending rejects late results and survives a page remount', async () => {
  let resolve!: (result: { prompt: string }) => void;
  request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await render(); await advance();
  await act(async () => value.dismiss());
  await act(async () => resolve({ prompt: 'Late suggestion' }));
  expect(value.prompt).toBeNull();
  await act(async () => root.render(null));
  await render(); await advance();
  expect(value.prompt).toBeNull();
  expect(request).toHaveBeenCalledTimes(1);
  await render({ running: true });
  await render({ running: false, revision: 30 }); await advance();
  expect(value.prompt).toBe('Suggested next step');
});

it('does not show a previous task result while changing task or running again', async () => {
  await render(); await advance();
  expect(value.prompt).toBeTruthy();
  await render({ sessionId: `${props.sessionId}-other` });
  expect(value.prompt).toBeNull();
  await advance();
  await render({ running: true });
  expect(value.prompt).toBeNull();
});

it('owner and device changes cannot reuse a dismissed revision or an old promise', async () => {
  let resolve!: (result: { prompt: string }) => void;
  request.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  await render(); await advance();
  await render({ ownerId: 'other', deviceId: 'other-host' });
  await act(async () => resolve({ prompt: 'Wrong owner' }));
  expect(value.prompt).toBeNull();
  await advance();
  expect(value.prompt).toBe('Suggested next step');
});

it('old hosts without the channel fail silently', async () => {
  request.mockRejectedValue(new Error('CHANNEL_NOT_ALLOWED'));
  await render(); await advance();
  expect(value.prompt).toBeNull();
});
