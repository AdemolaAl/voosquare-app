'use strict';
/*
 * Recycle bin (table deleted_rows, migration 003). When the team deletes something in the admin, a full copy of every
 * row goes into the bin first, in the same transaction, so a slip of the mouse never loses a post, a course or a
 * member's progress. Restore puts a whole batch back (all or nothing). Money records are never deleted at all:
 * orders, payouts, referral and affiliate ledgers and certificates have no delete path (see docs/CHANGING-SAFELY.md).
 */
const D = require('./db');
const { now, rid, fail, json } = require('./util');

const NAME = /^[a-z_]+$/;

/**
 * Copy the rows of `table` matching `where` into the bin, then delete them. Returns the number of rows.
 * Use inside D.tx() when several tables go together, and give them one `batch` so they can be restored together.
 */
function remove(table, where, args = [], { by = null, reason = '', batch = '' } = {}) {
  if (!NAME.test(table)) throw new Error('bad table name');
  const rows = D.all(`SELECT * FROM ${table} WHERE ${where}`, ...args);
  if (!rows.length) return 0;
  const t = now();
  for (const r of rows) D.insert('deleted_rows', { table_name: table, row_id: String(r.id ?? ''), data: JSON.stringify(r), reason: String(reason).slice(0, 200), batch, deleted_by: by, deleted_at: t });
  D.run(`DELETE FROM ${table} WHERE ${where}`, ...args);
  return rows.length;
}
const newBatch = () => 'b_' + rid(10).replace(/[^\w]/g, 'x');

function list({ table = '', limit = 100 } = {}) {
  const rows = table ? D.all('SELECT * FROM deleted_rows WHERE table_name=? ORDER BY id DESC LIMIT ?', table, limit) : D.all('SELECT * FROM deleted_rows ORDER BY id DESC LIMIT ?', limit);
  return rows.map((r) => ({ ...r, data: json(r.data, {}) }));
}

/** Put a batch (or one bin row id) back. All or nothing: a row whose id is taken again stops the restore. */
function restore(batchOrId) {
  const rows = typeof batchOrId === 'number' ? D.all('SELECT * FROM deleted_rows WHERE id=?', batchOrId) : D.all('SELECT * FROM deleted_rows WHERE batch=? ORDER BY id', String(batchOrId));
  if (!rows.length) fail(404, 'Nothing in the recycle bin with that id.');
  D.tx(() => {
    for (const r of rows) {
      if (!NAME.test(r.table_name)) fail(400, 'Bad table in the bin.');
      const cols = new Set(D.all(`PRAGMA table_info(${r.table_name})`).map((c) => c.name));
      const data = json(r.data, {});
      const keys = Object.keys(data).filter((k) => cols.has(k)); // columns added since the delete take their default
      try { D.run(`INSERT INTO ${r.table_name}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => data[k])); } catch (e) { fail(409, `Could not restore ${r.table_name} #${r.row_id}: ${e.message}. Nothing was restored.`); }
      D.run('DELETE FROM deleted_rows WHERE id=?', r.id);
    }
  });
  return rows.length;
}

module.exports = { remove, newBatch, list, restore };
