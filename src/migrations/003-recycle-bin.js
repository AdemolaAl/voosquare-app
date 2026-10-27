'use strict';
/*
 * 003 recycle bin. Before the admin deletes something (a post, a course, a lesson and its members' progress, a canned
 * reply, a What's new note, a school partner...), a full copy of the row(s) goes into deleted_rows. Nothing a member
 * earned or paid for is ever lost to a click. See src/trash.js. NEVER EDIT THIS FILE after it has shipped.
 */
module.exports = {
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS deleted_rows(
      id INTEGER PRIMARY KEY, table_name TEXT NOT NULL, row_id TEXT DEFAULT '', data TEXT NOT NULL, reason TEXT DEFAULT '',
      batch TEXT DEFAULT '', deleted_by INTEGER, deleted_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_deleted_rows_table ON deleted_rows(table_name, deleted_at);
    CREATE INDEX IF NOT EXISTS ix_deleted_rows_batch ON deleted_rows(batch);`);
  },
};
