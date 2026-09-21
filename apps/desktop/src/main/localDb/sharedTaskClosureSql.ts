/** Atomic, profile-local handoff of task closure to whichever process owns relay.
 * Reused inside replacement transactions so rollback also preserves sharing. */
export const CLOSE_SHARED_TASKS_FOR_SESSION_SQL = `
  INSERT INTO shared_task_events (shared_task_id, session_id, revision, kind, terminal, snapshot, recorded_at)
  SELECT DISTINCT shared_task_id, session_id, 0, 'local-close', 1, NULL, ?
  FROM shared_task_events WHERE session_id = ?
  ON CONFLICT (shared_task_id, kind, revision) DO NOTHING
`;
