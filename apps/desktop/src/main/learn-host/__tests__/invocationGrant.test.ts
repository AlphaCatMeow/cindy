import { describe, expect, it, vi } from 'vitest';

import {
  createLearnInvocationGrantConsumer,
  parseDirectLearnInvocation,
} from '../invocationGrant.js';

describe('Learn invocation grant', () => {
  const createPersistentConsumer = (
    readLatest: () => Promise<{ messageId: string; text: string }>,
    consumed = new Set<string>(),
  ) => createLearnInvocationGrantConsumer(
    readLatest,
    async (sessionId, messageId) => {
      const key = `${sessionId}\0${messageId}`;
      if (consumed.has(key)) return false;
      consumed.add(key);
      return true;
    },
  );

  it.each([
    ['/learn', { input: '', sourceKind: 'session' }],
    ['/Learn', { input: '', sourceKind: 'session' }],
    ['/learn release flow', { input: 'release flow', sourceKind: 'freetext' }],
    ['/LEARN Preserve Release Case', { input: 'Preserve Release Case', sourceKind: 'freetext' }],
    [
      '/skill:learn hub:team:release-notes keep checks',
      {
        input: 'keep checks',
        sourceKind: 'hub',
        hubSlug: 'release-notes',
        hubCatalogScope: 'team',
      },
    ],
    [
      '/SKILL:LEARN hub:market:release-notes keep checks',
      {
        input: 'keep checks',
        sourceKind: 'hub',
        hubSlug: 'release-notes',
        hubCatalogScope: 'market',
      },
    ],
  ])('parses direct Learn invocation %s', (text, expected) => {
    expect(parseDirectLearnInvocation(text)).toEqual(expected);
  });

  it.each([
    '/learner',
    '/learning release flow',
    '/skill:learner release flow',
    'please inspect /Learn docs',
  ])('rejects text that is not a direct Learn invocation: %s', (text) => {
    expect(parseDirectLearnInvocation(text)).toBeNull();
  });

  it('rejects ordinary messages and mismatched tool arguments without consuming the grant', async () => {
    const readLatest = vi.fn(async () => ({
      messageId: 'message-1',
      text: '/learn hub:market:release-notes keep   checks',
    }));
    const consume = createPersistentConsumer(readLatest);

    await expect(consume({
      callerSessionId: 'session-1',
      input: 'different request',
      sourceKind: 'freetext',
    })).resolves.toMatchObject({ ok: false, errorCode: 'USER_REQUEST_REQUIRED' });
    await expect(consume({
      callerSessionId: 'session-1',
      input: 'keep checks',
      sourceKind: 'hub',
      hubSlug: 'release-notes',
      hubCatalogScope: 'market',
    })).resolves.toEqual({ ok: true });

    readLatest.mockResolvedValue({ messageId: 'message-2', text: 'please inspect /learn docs' });
    await expect(consume({
      callerSessionId: 'session-1',
      input: '',
      sourceKind: 'session',
    })).resolves.toMatchObject({ ok: false, errorCode: 'USER_REQUEST_REQUIRED' });
  });

  it('consumes each persisted user invocation only once', async () => {
    const consume = createPersistentConsumer(async () => ({
      messageId: 'message-1',
      text: '/Learn release flow',
    }));
    const request = {
      callerSessionId: 'session-1',
      input: 'release flow',
      sourceKind: 'freetext' as const,
    };

    await expect(consume(request)).resolves.toEqual({ ok: true });
    await expect(consume(request)).resolves.toMatchObject({
      ok: false,
      errorCode: 'USER_REQUEST_REQUIRED',
    });
  });

  it('rejects a persisted invocation after the consumer is recreated', async () => {
    const consumed = new Set<string>();
    const readLatest = async () => ({
      messageId: 'message-1',
      text: '/learn release flow',
    });
    const request = {
      callerSessionId: 'session-1',
      input: 'release flow',
      sourceKind: 'freetext' as const,
    };

    await expect(createPersistentConsumer(readLatest, consumed)(request)).resolves.toEqual({
      ok: true,
    });
    await expect(createPersistentConsumer(readLatest, consumed)(request)).resolves.toMatchObject({
      ok: false,
      errorCode: 'USER_REQUEST_REQUIRED',
    });
  });
});
