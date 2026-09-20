import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSharedTaskJournal } from '../sharedTasks.js';
import type { SharedTaskSnapshot } from '@cindy/device-link';

const snapshot = (revision = 1): SharedTaskSnapshot => ({
  sharedTaskId: 'sharedTask', sessionId: 'session', ownerAccountId: 'owner', hostDeviceId: 'desktop',
  revision, status: 'active', guests: [{ memberId: 'member', accountId: 'guest', version: 1, deviceIds: ['phone'] }],
});
let db: Database.Database;
let journal: ReturnType<typeof createSharedTaskJournal>;
beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('session'), ('other-session')");
  db.exec(readFileSync(resolve(process.cwd(), 'drizzle/0114_shared_task_events.sql'), 'utf8'));
  journal = createSharedTaskJournal({
    async exec(sql, params = []) { return db.prepare(sql).run(...params); },
    async query<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...params) as T[]; },
  });
});
afterEach(() => db.close());

it('moves development-era records and author metadata without rewriting message content', async () => {
  db.exec(`
    CREATE TABLE session_meeting_events (id INTEGER PRIMARY KEY, meeting_id TEXT, session_id TEXT,
      revision INTEGER, kind TEXT, terminal INTEGER, snapshot TEXT, recorded_at INTEGER);
    CREATE TABLE messages (agent_meta TEXT, content TEXT);
    CREATE TABLE agent_input_queue_snapshots (payload TEXT);
  `);
  const legacy = { ...snapshot(), meetingId: 'legacy-share', sharedTaskId: undefined };
  db.prepare("INSERT INTO session_meeting_events VALUES (1, 'legacy-share', 'session', 1, 'authority', 0, ?, 123)")
    .run(JSON.stringify(legacy));
  const author = { meetingId: 'legacy-share', sessionId: 'session', memberId: 'member', accountId: 'guest', displayName: 'Guest' };
  const content = 'User text: meetingId and meetingAuthor must stay verbatim';
  db.prepare('INSERT INTO messages VALUES (?, ?)').run(JSON.stringify({ meetingAuthor: author, uuid: 'message' }), content);
  db.prepare('INSERT INTO messages VALUES (?, ?)').run('invalid legacy JSON', content);
  db.prepare('INSERT INTO agent_input_queue_snapshots VALUES (?)').run(JSON.stringify([{ meetingAuthor: author, text: content }]));
  const { run } = createRequire(import.meta.url)(resolve(process.cwd(), 'drizzle/scripts/0114_shared_task_events.ts'));
  run(db);
  run(db);
  expect(await journal.latest()).toMatchObject([{ sharedTaskId: 'legacy-share', snapshot: { sharedTaskId: 'legacy-share' } }]);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'session_meeting_events'").get()).toBeUndefined();
  const message = db.prepare('SELECT * FROM messages LIMIT 1').get() as { agent_meta: string; content: string };
  expect(message.content).toBe(content);
  expect(JSON.parse(message.agent_meta)).toEqual({ uuid: 'message', sharedTaskAuthor: { ...author, meetingId: undefined, sharedTaskId: 'legacy-share' } });
  const queue = db.prepare('SELECT payload FROM agent_input_queue_snapshots').get() as { payload: string };
  expect(JSON.parse(queue.payload)[0]).toMatchObject({ text: content, sharedTaskAuthor: { sharedTaskId: 'legacy-share' } });
  expect(db.prepare('SELECT agent_meta FROM messages WHERE rowid = 2').get()).toEqual({ agent_meta: 'invalid legacy JSON' });
});
describe('sharedTask authority journal', () => {
  it('retains membership changes and reads only the latest authority', async () => {
    expect(await journal.recordAuthority(snapshot())).toBe(true);
    expect(await journal.recordAuthority({ ...snapshot(2), guests: [] })).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM shared_task_events').get()).toEqual({ n: 2 });
    expect(await journal.latest()).toMatchObject([{ snapshot: { revision: 2, guests: [] }, terminal: false }]);
  });
  it('ignores stale and duplicate revisions without losing audit history', async () => {
    await journal.recordAuthority(snapshot(2));
    expect(await journal.recordAuthority(snapshot())).toBe(false);
    expect(await journal.recordAuthority(snapshot(2))).toBe(false);
    expect(await journal.latest()).toMatchObject([{ snapshot: { revision: 2 } }]);
  });
  it('does not let another task reuse a sharedTask identity', async () => {
    await journal.recordAuthority(snapshot());
    expect(await journal.recordAuthority({ ...snapshot(2), sessionId: 'other-session' })).toBe(false);
    await journal.close({ ...snapshot(), sessionId: 'other-session' });
    expect(await journal.latest()).toMatchObject([{ sessionId: 'session', terminal: false }]);
  });
  it.each(['local', 'server'])('keeps a %s closure terminal when late replies arrive', async (source) => {
    await journal.recordAuthority(snapshot());
    if (source === 'local') { await journal.close(snapshot()); await journal.close(snapshot()); }
    else await journal.recordAuthority({ ...snapshot(2), status: 'closed' });
    expect(await journal.recordAuthority(snapshot(20))).toBe(false);
    expect(await journal.latest()).toMatchObject([{ terminal: true }]);
  });
  it('allows a fresh sharedTask for the same task after closing the previous one', async () => {
    await journal.close(snapshot());
    expect(await journal.recordAuthority({ ...snapshot(), sharedTaskId: 'new-sharedTask' })).toBe(true);
    expect(await journal.latest()).toHaveLength(2);
  });
  it('cascades journal deletion only with its owning task', async () => {
    await journal.recordAuthority(snapshot());
    db.prepare("DELETE FROM sessions WHERE id = 'other-session'").run();
    expect(await journal.latest()).toHaveLength(1);
    db.prepare("DELETE FROM sessions WHERE id = 'session'").run();
    expect(await journal.latest()).toEqual([]);
  });
});
