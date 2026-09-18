import type { StartSkillLearningParams } from '@cindy/mcps';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';

import { visibleMessageTextForConversationSearch } from '../localDb/conversationSearch.pure.js';
import {
  isDbClientNotReadyError,
  tryGetDbClient,
} from '../localDb/client/current.js';
import { messages, sessions } from '../localDb/schema.js';

export type LearnInvocationGrantResult =
  | { ok: true }
  | {
      ok: false;
      errorCode: 'HOST_NOT_READY' | 'INTERNAL' | 'USER_REQUEST_REQUIRED';
      message: string;
    };

interface LatestUserInvocation {
  messageId: string;
  text: string;
}

type ReadLatestUserInvocation = (
  sessionId: string,
) => Promise<LatestUserInvocation | null>;

const messageRowid = sql<number>`"messages"."rowid"`;
const MAX_CONSUMED_INVOCATIONS = 2_048;

function normalizeInput(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function parseDirectLearnInvocation(
  text: string,
): Omit<StartSkillLearningParams, 'callerSessionId'> | null {
  const command = /^\/(?:skill:)?learn(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!command) return null;

  const arg = (command[1] ?? '').trim();
  const hubMatch = /^hub:(?:(market|team):)?([a-z0-9][a-z0-9-]*)\s*/.exec(arg);
  if (hubMatch) {
    return {
      input: arg.slice(hubMatch[0].length).trim(),
      sourceKind: 'hub',
      hubSlug: hubMatch[2],
      hubCatalogScope: (hubMatch[1] as 'market' | 'team' | undefined) ?? 'market',
    };
  }
  return {
    input: arg,
    sourceKind: arg ? 'freetext' : 'session',
  };
}

function matchesInvocation(
  invocation: Omit<StartSkillLearningParams, 'callerSessionId'>,
  request: StartSkillLearningParams,
): boolean {
  if (invocation.sourceKind !== request.sourceKind) return false;
  if (normalizeInput(invocation.input) !== normalizeInput(request.input)) return false;
  if (invocation.sourceKind !== 'hub') {
    return request.hubSlug === undefined && request.hubCatalogScope === undefined;
  }
  return invocation.hubSlug === request.hubSlug
    && invocation.hubCatalogScope === (request.hubCatalogScope ?? 'market');
}

export function createLearnInvocationGrantConsumer(
  readLatestUserInvocation: ReadLatestUserInvocation,
): (request: StartSkillLearningParams) => Promise<LearnInvocationGrantResult> {
  const consumed = new Set<string>();
  const consumptionOrder: string[] = [];

  return async (request) => {
    let latest: LatestUserInvocation | null;
    try {
      latest = await readLatestUserInvocation(request.callerSessionId);
    } catch (error) {
      return {
        ok: false,
        errorCode: isDbClientNotReadyError(error) ? 'HOST_NOT_READY' : 'INTERNAL',
        message: 'Cindy could not verify the current /learn request.',
      };
    }
    const invocation = latest ? parseDirectLearnInvocation(latest.text) : null;
    if (!latest || !invocation || !matchesInvocation(invocation, request)) {
      return {
        ok: false,
        errorCode: 'USER_REQUEST_REQUIRED',
        message: 'Start Learn by invoking /learn directly in the current task.',
      };
    }
    const consumptionKey = `${request.callerSessionId}\0${latest.messageId}`;
    if (consumed.has(consumptionKey)) {
      return {
        ok: false,
        errorCode: 'USER_REQUEST_REQUIRED',
        message: 'This /learn request has already been used.',
      };
    }

    consumed.add(consumptionKey);
    consumptionOrder.push(consumptionKey);
    if (consumptionOrder.length > MAX_CONSUMED_INVOCATIONS) {
      consumed.delete(consumptionOrder.shift()!);
    }
    return { ok: true };
  };
}

async function readLatestUserInvocation(
  sessionId: string,
): Promise<LatestUserInvocation | null> {
  const dbClient = tryGetDbClient();
  if (!dbClient) {
    throw Object.assign(new Error('DbClient not ready'), { code: 'HOST_NOT_READY' });
  }
  const [row] = await dbClient.drizzle
    .select({ id: messages.id, content: messages.content })
    .from(messages)
    .innerJoin(sessions, eq(messages.sessionId, sessions.id))
    .where(
      and(
        eq(messages.sessionId, sessionId),
        eq(messages.role, 'user'),
        isNull(messages.rewindAt),
        sql`(${messages.agentMeta} IS NULL OR CASE WHEN json_valid(${messages.agentMeta}) THEN json_extract(${messages.agentMeta}, '$.autoResume') END IS NOT 1)`,
        or(isNull(sessions.clearedAt), gt(messages.createdAt, sessions.clearedAt)),
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messageRowid))
    .limit(1);
  if (!row) return null;
  return {
    messageId: row.id,
    text: visibleMessageTextForConversationSearch('user', row.content),
  };
}

export const consumeLearnInvocationGrant = createLearnInvocationGrantConsumer(
  readLatestUserInvocation,
);
