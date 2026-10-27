'use strict';
/*
 * 010 One-tap sign-in between VooSquare and VooSquare Academy (voosquareacademy.com), src/academy.js.
 *  - auth_handoffs: one row per single-use switch link. Only the SHA-256 of the random token is stored, with the member,
 *    the site it opens ('voosquare' | 'academy'), the hash of the session that asked for it (the switch dies with that
 *    session: log out, "log out everywhere" and a ban all end it), a 60-second expiry and when it was used.
 * Additive only. NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db) {
    db.exec(`CREATE TABLE IF NOT EXISTS auth_handoffs(
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, target TEXT NOT NULL, session_hash TEXT DEFAULT '',
      next TEXT DEFAULT '', created_at INTEGER, expires INTEGER, used_at INTEGER DEFAULT 0, ip TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS ix_auth_handoffs_user ON auth_handoffs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS ix_auth_handoffs_expires ON auth_handoffs(expires);`);
  },
};
