'use strict';
/*
 * 013 Safety tools for community rooms (Apple guideline 1.2, Google Play user-generated content policy):
 *  - message_reports: a member reports someone else's message (one open report per member per message). The team
 *    removes the message, dismisses the report or bans the author from Admin → Community → Reports. Rows are never deleted;
 *    status moves open → actioned | dismissed, with who handled it and when.
 *  - messages.hidden: 1 while a message that 3 different members reported waits for review (hidden from everyone but the
 *    team). Dismissing the reports sets it back to 0.
 *  - member_blocks: a member blocks another member; the blocked member's messages are hidden for the blocker only.
 * See src/ugc.js.
 * NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db, h) {
    db.exec(`CREATE TABLE IF NOT EXISTS message_reports(
      id INTEGER PRIMARY KEY, message_id INTEGER NOT NULL, room_id INTEGER, author_id INTEGER, reporter_id INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT 'other', note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at INTEGER,
      handled_by INTEGER, handled_at INTEGER, action TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS ix_message_reports_status ON message_reports(status, message_id);
    CREATE INDEX IF NOT EXISTS ix_message_reports_reporter ON message_reports(reporter_id, message_id);
    CREATE TABLE IF NOT EXISTS member_blocks(
      blocker_id INTEGER NOT NULL, blocked_id INTEGER NOT NULL, created_at INTEGER, PRIMARY KEY(blocker_id, blocked_id)
    );
    CREATE INDEX IF NOT EXISTS ix_member_blocks_blocked ON member_blocks(blocked_id);`);
    h.addColumn('messages', 'hidden', 'INTEGER DEFAULT 0');
  },
};
