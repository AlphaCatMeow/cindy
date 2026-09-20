function run(db) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get("table", "session_meeting_events")) {
    db.exec("INSERT INTO shared_task_events (id, shared_task_id, session_id, revision, kind, terminal, snapshot, recorded_at) SELECT id, meeting_id, session_id, revision, kind, terminal, snapshot, recorded_at FROM session_meeting_events");
    db.exec("DROP TABLE session_meeting_events");
  }
  function renameId(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (Object.prototype.hasOwnProperty.call(value, "meetingId")) {
      value.sharedTaskId = value.meetingId;
      delete value.meetingId;
    }
  }
  function renameAuthor(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (Object.prototype.hasOwnProperty.call(value, "meetingAuthor")) {
      value.sharedTaskAuthor = value.meetingAuthor;
      renameId(value.sharedTaskAuthor);
      delete value.meetingAuthor;
    }
  }
  function updateJson(table, column, change) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?").get("table", table)) return;
    const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
    for (const row of db.prepare(`SELECT rowid AS rid, ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL`).all()) {
      let value;
      try { value = JSON.parse(row.value); } catch { continue; }
      const before = JSON.stringify(value);
      change(value);
      const after = JSON.stringify(value);
      if (after !== before) update.run(after, row.rid);
    }
  }
  updateJson("shared_task_events", "snapshot", renameId);
  updateJson("messages", "agent_meta", renameAuthor);
  updateJson("agent_input_queue_snapshots", "payload", (items) => {
    if (Array.isArray(items)) items.forEach(renameAuthor);
  });
}
module.exports = { run };
