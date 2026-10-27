'use strict';
/*
 * Versioned database migrations. Read docs/CHANGING-SAFELY.md before you add one.
 *
 * What happens to the database on every start:
 *  1. src/db.js opens the file and calls preflight() BEFORE any CREATE or ALTER runs. On an existing database, when a
 *     migration is pending (or, in production, the code changed since the last good start) a consistent copy is written
 *     to <backups>/pre-migrate-v<N>-<time>.db. The newest PRE_MIGRATE_KEEP (default 3) are kept. If the copy cannot be
 *     made and a migration is pending, the app refuses to start (set MIGRATE_WITHOUT_BACKUP=1 to override, once).
 *  2. The modules create their baseline tables when they load (CREATE TABLE IF NOT EXISTS and guarded ADD COLUMN in
 *     db.js, features.js, school.js, voice.js, aff/core.js). That is migration 1, "baseline". Do not add new guarded
 *     statements there: put every new change in a numbered file in src/migrations.
 *  3. server.js calls runOrExit() once every module is loaded: each file in src/migrations that is not yet recorded in
 *     schema_migrations runs once, in version order, inside its own transaction together with its schema_migrations
 *     row. If it throws, that transaction is rolled back, the reason is logged, and the app refuses to start (exit 1),
 *     so a half-upgraded database is never served. The previous release still runs on it (nothing was changed).
 *
 * Policy: additive only. Add tables, columns (with a DEFAULT), indexes and backfills. Never DROP or RENAME in the release
 * that stops using something: expand (add the new, write both) → migrate (backfill) → contract (a later release stops
 * reading the old; the old column just stays). Never edit a migration that has shipped: test/safety.js checks the
 * checksums in test/fixtures/migrations.lock.json. A database that is AHEAD of the code (after a rollback) is fine.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

const DIR = path.join(__dirname, 'migrations');
const FILE_RE = /^(\d{3,})-([a-z0-9][a-z0-9-]*)\.js$/;
const PRE_RE = /^pre-migrate-v\d+-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.db$/;
const keepPre = () => Math.min(20, Math.max(1, Math.floor(Number(process.env.PRE_MIGRATE_KEEP) || 3)));

/** Shared state, read by /healthz and Admin → Backups. */
const state = { fresh: false, pending_at_boot: [], applied_now: [], backup: null, backup_error: '', ahead: 0, version: 0, expected: 0, checked: false };

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const stamp = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').replace(/^(\d{4})(\d{2})(\d{2})(\d{6})\.(\d{3})Z$/, '$1-$2-$3-$4-$5');

/** Every migration file, in version order: { version, name, file, checksum, up }. */
function list() {
  const dirs = [DIR];
  // Tests only: an extra folder (for example a migration that fails on purpose).
  if (process.env.NODE_ENV === 'test' && process.env.MIGRATIONS_EXTRA_DIR) dirs.push(process.env.MIGRATIONS_EXTRA_DIR);
  const out = [];
  for (const dir of dirs) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      const m = FILE_RE.exec(n);
      if (!m) continue;
      const file = path.join(dir, n);
      const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      const mod = require(file);
      if (typeof mod.up !== 'function') throw new Error(`Migration ${n} has no up(db) function.`);
      out.push({ version: Number(m[1]), name: m[2], file: n, checksum: sha(src).slice(0, 16), up: mod.up });
    }
  }
  out.sort((a, b) => a.version - b.version);
  for (let i = 1; i < out.length; i++) if (out[i].version === out[i - 1].version) throw new Error(`Two migrations use number ${out[i].version}: ${out[i - 1].file} and ${out[i].file}.`);
  return out;
}

/** A fingerprint of the server code (every .js under src, server.js, package.json). Content files are not included. */
function codeHash() {
  const root = path.join(__dirname, '..');
  const files = [path.join(root, 'server.js'), path.join(root, 'package.json')];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.js')) files.push(f); } };
  walk(__dirname);
  const h = crypto.createHash('sha256');
  for (const f of files.sort()) { h.update(path.relative(root, f)); try { h.update(fs.readFileSync(f)); } catch { /* gone */ } }
  return h.digest('hex').slice(0, 16);
}

const backupOnDeploy = () => (process.env.BACKUP_ON_DEPLOY === '1' ? true : process.env.BACKUP_ON_DEPLOY === '0' ? false : config.prod);
const tableNames = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
function meta(db, key) { try { const r = db.prepare('SELECT value FROM schema_meta WHERE key=?').get(key); return r ? r.value : ''; } catch { return ''; } }
function setMeta(db, key, value) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_meta(key TEXT PRIMARY KEY, value TEXT)');
  db.prepare('INSERT INTO schema_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

/** Pre-migration copies on disk, newest first. */
function preBackups() {
  let names = [];
  try { names = fs.readdirSync(config.backupsDir).filter((n) => PRE_RE.test(n)); } catch { return []; }
  return names.map((name) => { try { const st = fs.statSync(path.join(config.backupsDir, name)); return { name, kind: 'pre-migrate', bytes: st.size, created_at: Math.floor(st.mtimeMs) }; } catch { return null; } })
    .filter(Boolean).sort((a, b) => b.created_at - a.created_at || (a.name < b.name ? 1 : -1));
}
function rotatePre() { for (const b of preBackups().slice(keepPre())) { try { fs.unlinkSync(path.join(config.backupsDir, b.name)); } catch { /* gone */ } } }

/** Enough free space for one more copy of the database (plus 20 MB to spare)? Unknown counts as yes. */
function roomFor(dbFile) {
  try {
    let size = 0;
    for (const f of [dbFile, dbFile + '-wal']) { try { size += fs.statSync(f).size; } catch { /* none */ } }
    const s = fs.statfsSync(config.backupsDir);
    return Number(s.bavail) * Number(s.bsize) > size * 1.1 + 20 * 1024 * 1024;
  } catch { return true; }
}

/**
 * Called by db.js right after the file is opened, before any schema statement. Takes the pre-migration copy when needed.
 * Throws (and the app does not start) only when a migration is pending and the copy failed.
 */
function preflight(db, dbFile = config.dbPath) {
  const tables = tableNames(db);
  state.fresh = !tables.includes('users');
  if (state.fresh) return state;
  const all = list();
  const applied = new Set(tables.includes('schema_migrations') ? db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version) : []);
  const pending = all.filter((m) => !applied.has(m.version));
  state.pending_at_boot = pending.map((m) => m.version);
  const hash = codeHash();
  const changed = backupOnDeploy() && meta(db, 'boot_code_hash') !== hash;
  if (!pending.length && !changed) return state;
  const target = all.length ? all[all.length - 1].version : 0;
  const key = `${target}:${hash}`;
  // A start that failed and is retried (Railway restarts it) does not make the same copy again: the last copy is reused
  // when it was made for this same code and target, and no start has succeeded since (so the data is unchanged).
  try {
    const last = JSON.parse(meta(db, 'last_premigrate') || 'null');
    const okSince = Number(meta(db, 'boot_ok_at')) || 0;
    if (last && last.key === key && okSince < last.at && fs.existsSync(path.join(config.backupsDir, last.name))) { state.backup = { ...last, reused: true }; return state; }
  } catch { /* none */ }
  const why = pending.length ? `${pending.length} database ${pending.length === 1 ? 'change' : 'changes'} to apply (${pending.map((m) => m.version + '-' + m.name).join(', ')})` : 'new code version';
  try {
    fs.mkdirSync(config.backupsDir, { recursive: true });
    if (!roomFor(dbFile)) throw new Error(`not enough free disk space in ${config.backupsDir} for a copy of the database`);
    const name = `pre-migrate-v${target}-${stamp(Date.now())}.db`;
    const file = path.join(config.backupsDir, name);
    const t0 = Date.now();
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const bytes = fs.statSync(file).size;
    state.backup = { key, name, bytes, at: Date.now(), ms: Date.now() - t0, why };
    setMeta(db, 'last_premigrate', JSON.stringify(state.backup));
    rotatePre();
    console.log(`[migrate] safety copy before the update: ${file} (${bytes} bytes, ${state.backup.ms} ms) — ${why}`);
  } catch (e) {
    state.backup_error = e.message;
    if (pending.length && process.env.MIGRATE_WITHOUT_BACKUP !== '1') {
      const err = new Error(`Could not make the safety copy before changing the database (${e.message}). Nothing was changed. Free some space on the volume, or set MIGRATE_WITHOUT_BACKUP=1 for one start if you have another backup.`);
      err.code = 'PREMIGRATE_BACKUP_FAILED';
      throw err;
    }
    console.error(`[migrate] WARNING: safety copy before the update failed: ${e.message}`);
  }
  return state;
}

/** Small helpers handed to every migration's up(db, h). */
const helpers = (db) => ({
  hasTable: (t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t),
  hasColumn: (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c),
  /** ADD COLUMN only when missing (a column may already exist on a database that ran older guarded code). */
  addColumn(t, c, decl) { if (!this.hasColumn(t, c)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${decl}`); },
});

/** Apply every pending migration. Throws (after rolling back the failed one) so the caller can refuse to start. */
function run(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT DEFAULT '', applied_at INTEGER NOT NULL, ms INTEGER DEFAULT 0
  )`);
  const all = list();
  const done = new Map(db.prepare('SELECT * FROM schema_migrations').all().map((r) => [r.version, r]));
  const h = helpers(db);
  state.applied_now = [];
  for (const m of all) {
    const row = done.get(m.version);
    if (row) {
      if (row.checksum && row.checksum !== m.checksum) console.warn(`[migrate] WARNING: ${m.file} changed after it ran (it will not run again). Never edit a shipped migration: add a new one.`);
      continue;
    }
    const t0 = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      m.up(db, h);
      db.prepare('INSERT INTO schema_migrations(version,name,checksum,applied_at,ms) VALUES(?,?,?,?,?)').run(m.version, m.name, m.checksum, Date.now(), Date.now() - t0);
      db.exec('COMMIT');
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      const err = new Error(`Migration ${m.file} failed and was rolled back, so the database is exactly as before: ${e.message}`);
      err.code = 'MIGRATION_FAILED'; err.migration = m.file; err.cause = e;
      throw err;
    }
    state.applied_now.push({ version: m.version, name: m.name, ms: Date.now() - t0 });
    console.log(`[migrate] applied ${m.file} (${Date.now() - t0} ms)`);
  }
  const max = db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get().v;
  state.expected = all.length ? all[all.length - 1].version : 0;
  state.version = max;
  state.ahead = max > state.expected ? max : 0;
  if (state.ahead) console.warn(`[migrate] The database is at version ${max}, newer than this code (${state.expected}). That is expected after a rollback: migrations only add, so this release runs fine on it.`);
  setMeta(db, 'boot_code_hash', codeHash());
  setMeta(db, 'boot_ok_at', Date.now());
  try {
    const ins = db.prepare('INSERT INTO audit(user_id,action,detail,created_at) VALUES(NULL,?,?,?)');
    if (state.backup && !state.backup.reused) ins.run('backup.pre_migrate', `${state.backup.name} (${state.backup.bytes} bytes): ${state.backup.why}`.slice(0, 500), Date.now());
    for (const a of state.applied_now) ins.run('db.migrate', `${a.version}-${a.name} (${a.ms} ms)`, Date.now());
  } catch { /* audit is best effort */ }
  state.checked = true;
  return state;
}

/** server.js: apply or refuse to start. Railway then shows the failed deploy; roll back to the last green one. */
function runOrExit(db) {
  try { return run(db); } catch (e) { fatal(e); }
}
function fatal(e) {
  console.error('\n================ VooSquare did NOT start ================');
  console.error(e.message);
  if (e.cause && e.cause.stack) console.error(e.cause.stack);
  console.error('Members\' data is safe: nothing was half-applied. Fix the migration and deploy again, or roll back to the previous deployment in Railway.');
  console.error('Guide: docs/CHANGING-SAFELY.md, "What to do if something breaks".');
  console.error('=========================================================\n');
  process.exit(1);
}

/** For /healthz and Admin → Backups. */
function status(db) {
  let version = 0; let applied = [];
  try {
    version = db.prepare('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').get().v;
    applied = db.prepare('SELECT version, name, applied_at, ms FROM schema_migrations ORDER BY version DESC LIMIT 20').all().map((r) => ({ ...r }));
  } catch { /* not yet */ }
  const expected = state.expected || (list().slice(-1)[0] || { version: 0 }).version;
  return { version, expected, ok: version >= expected, applied, backup: state.backup, backup_error: state.backup_error, pre_backups: preBackups(), keep: keepPre() };
}

module.exports = { preflight, run, runOrExit, fatal, status, list, codeHash, preBackups, rotatePre, PRE_RE, state };
