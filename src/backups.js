'use strict';
/*
 * Database backups (owner only). The whole database is one SQLite file, so a backup is a consistent copy made with
 * VACUUM INTO while the app keeps running (WAL contents included).
 *  - Download now: a fresh copy is written to a temporary file, streamed to the browser, then deleted.
 *  - Daily: one automatic copy a day in <data dir>/backups (BACKUPS_DIR to change it), keeping the newest N (default 7).
 *  - Restore is never done from the web: see README "Backups".
 * Images people share live in UPLOADS_DIR on the same volume; they are not inside the database file.
 */
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const D = require('./db');
const A = require('./auth');
const { now, fail, limit, rid } = require('./util');

const DIR = config.backupsDir;
const NAME_RE = /^voosquare-(auto|manual)-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.db$/;
const DEFAULTS = { auto: true, keep: 7 };
let lastError = '';

function settings() {
  const v = D.getSetting('backups', {}) || {};
  return { auto: v.auto !== false, keep: Math.min(30, Math.max(1, Math.floor(Number(v.keep) || DEFAULTS.keep))) };
}
const stamp = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').replace(/^(\d{4})(\d{2})(\d{2})(\d{6})\.(\d{3})Z$/, '$1-$2-$3-$4-$5');

/** "2026-10-05-0736" in the reporting time zone (Settings → General), so a downloaded file's name matches the time the
 *  admin shows. Copies kept on the server keep their UTC names (stamp above). */
function localStamp(t) {
  let tz = 'Africa/Lagos'; try { tz = require('./revenue').reportingTz(); } catch { /* default */ }
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}`;
  } catch { return stamp(t).slice(0, 15); }
}
/** Write a consistent copy of the live database to `file` (which must not exist yet). */
function snapshot(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  D.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
}

/** Daily and hand-made copies (rotated by the `keep` setting). */
function own() {
  let names = [];
  try { names = fs.readdirSync(DIR).filter((n) => NAME_RE.test(n)); } catch { return []; }
  return names.map((name) => {
    let st; try { st = fs.statSync(path.join(DIR, name)); } catch { return null; }
    return { name, kind: NAME_RE.exec(name)[1], bytes: st.size, created_at: Math.floor(st.mtimeMs) };
  }).filter(Boolean).sort((a, b) => b.created_at - a.created_at || (a.name < b.name ? 1 : -1));
}
/** Every copy on the server, newest first: daily, by hand, and the automatic ones made before an update (kind
 * 'pre-migrate', src/migrate.js, kept separately: the newest PRE_MIGRATE_KEEP of them, default 3). */
function list() {
  return [...own(), ...require('./migrate').preBackups(), ...require('./restore').preRestoreBackups()].sort((a, b) => b.created_at - a.created_at || (a.name < b.name ? 1 : -1));
}

/** Keep the newest `keep` copies (automatic and manual together). Copies made before an update are not counted here. */
function rotate() {
  const { keep } = settings();
  const all = own();
  for (const b of all.slice(keep)) { try { fs.unlinkSync(path.join(DIR, b.name)); } catch { /* already gone */ } }
}

function create(kind = 'manual') {
  const name = `voosquare-${kind}-${stamp(now())}.db`;
  const file = path.join(DIR, name);
  snapshot(file);
  rotate();
  const st = fs.statSync(file);
  return { name, kind, bytes: st.size, created_at: Math.floor(st.mtimeMs) };
}

const lastAuto = () => own().find((b) => b.kind === 'auto') || null;
function due() {
  if (!settings().auto) return false;
  const l = lastAuto();
  return !l || l.created_at < now() - 23.5 * 3600_000;
}
function tick() {
  try {
    if (!due()) return null;
    const b = create('auto');
    lastError = '';
    D.insert('audit', { user_id: null, action: 'backup.auto', detail: `${b.name} (${b.bytes} bytes)`, created_at: now() });
    return b;
  } catch (e) {
    lastError = e.message;
    console.error('[backups] daily backup failed:', e.message);
    return null;
  }
}
/** Daily schedule: check shortly after boot, then every hour. Tests only schedule when BACKUPS_DIR is set. */
function start() {
  if (process.env.NODE_ENV === 'test' && !process.env.BACKUPS_DIR) return;
  setTimeout(tick, process.env.NODE_ENV === 'test' ? 1500 : 60_000).unref();
  setInterval(tick, 3600_000).unref();
}

/* Size of the uploads folder, walked in the background and cached for five minutes. */
let upCache = { at: 0, bytes: 0, files: 0, busy: false };
async function uploadsSize() {
  if (upCache.busy || upCache.at > now() - 5 * 60_000) return upCache;
  upCache.busy = true;
  let bytes = 0, files = 0;
  const walk = async (dir) => {
    let ents; try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) await walk(f);
      else if (e.isFile()) { try { bytes += (await fs.promises.stat(f)).size; files++; } catch { /* gone */ } }
    }
  };
  try { await walk(config.uploadsDir); } finally { upCache = { at: now(), bytes, files, busy: false }; }
  return upCache;
}

function dbBytes() {
  let n = 0;
  for (const f of [config.dbPath, config.dbPath + '-wal']) { try { n += fs.statSync(f).size; } catch { /* none */ } }
  return n;
}

function sendFile(ctx, file, downloadName, removeAfter) {
  const st = fs.statSync(file);
  ctx.handled = true;
  ctx.res.writeHead(200, {
    'Content-Type': 'application/vnd.sqlite3', 'Content-Length': st.size, 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${downloadName}"`, 'X-Content-Type-Options': 'nosniff',
  });
  const rs = fs.createReadStream(file);
  const done = () => { if (removeAfter) fs.unlink(file, () => {}); };
  rs.on('error', () => { try { ctx.res.destroy(); } catch { /* ignore */ } done(); });
  ctx.res.on('close', done);
  rs.pipe(ctx.res);
}

function requireOwner(ctx) {
  const me = A.requireStaff(ctx);
  if (!A.isOwner(me)) fail(403, 'Only an owner can see and download backups.');
  return me;
}

function routes(r) {
  r.get('/api/admin/backups', async (ctx) => {
    requireOwner(ctx);
    const up = await uploadsSize();
    const l = lastAuto();
    return {
      backups: list(), settings: settings(), dir: DIR, last_auto: l ? l.created_at : 0,
      next_auto: settings().auto ? (l ? l.created_at + 24 * 3600_000 : now()) : 0, last_error: lastError,
      db_bytes: dbBytes(), uploads_bytes: up.bytes, uploads_files: up.files, uploads_dir: config.uploadsDir,
      schema: require('./migrate').status(D.db), // database version, migrations applied, the copy made before the last update
    };
  });
  r.put('/api/admin/backups/settings', async (ctx) => {
    const me = requireOwner(ctx);
    const b = await ctx.json();
    const v = { auto: b.auto !== false, keep: Math.min(30, Math.max(1, Math.floor(Number(b.keep) || DEFAULTS.keep))) };
    D.setSetting('backups', v);
    rotate();
    D.insert('audit', { user_id: me.id, action: 'backup.settings', detail: `daily ${v.auto ? 'on' : 'off'}, keep ${v.keep}`, created_at: now() });
    return { settings: settings(), backups: list() };
  });
  r.post('/api/admin/backups/run', (ctx) => {
    const me = requireOwner(ctx);
    limit('backup-run:' + me.id, 6, 10 * 60_000);
    const b = create('manual');
    D.insert('audit', { user_id: me.id, action: 'backup.run', detail: `${b.name} (${b.bytes} bytes)`, created_at: now() });
    return { backup: b, backups: list() };
  });
  /* A fresh copy, straight to the browser. The temporary file is deleted once sent. */
  r.get('/api/admin/backups/download', (ctx) => {
    const me = requireOwner(ctx);
    limit('backup-dl:' + me.id, 6, 10 * 60_000);
    const tmp = path.join(DIR, `.tmp-${rid(8).replace(/[^\w]/g, 'x')}.db`);
    snapshot(tmp);
    D.insert('audit', { user_id: me.id, action: 'backup.download', detail: 'fresh copy', created_at: now() });
    sendFile(ctx, tmp, `voosquare-${localStamp(now())}.db`, true);
  });
  /* Recycle bin (src/trash.js): what the team deleted in the admin, and putting a batch back. Owner only. */
  r.get('/api/admin/recycle-bin', (ctx) => {
    requireOwner(ctx);
    const rows = require('./trash').list({ table: String(ctx.query.table || '').replace(/[^a-z_]/g, ''), limit: 200 });
    const names = {};
    for (const id of new Set(rows.map((x) => x.deleted_by).filter(Boolean))) names[id] = (D.get('SELECT name FROM users WHERE id=?', id) || {}).name || '';
    return { rows: rows.map((x) => ({ ...x, deleted_by_name: names[x.deleted_by] || '' })) };
  });
  r.post('/api/admin/recycle-bin/restore', async (ctx) => {
    const me = requireOwner(ctx);
    const b = await ctx.json();
    const key = b.batch ? String(b.batch) : Number(b.id) || 0;
    const n = require('./trash').restore(key);
    D.insert('audit', { user_id: me.id, action: 'recycle_bin.restore', detail: `${key}: ${n} row(s)`, created_at: now() });
    return { ok: true, restored: n };
  });
  r.get('/api/admin/backups/file/:name', (ctx) => {
    const me = requireOwner(ctx);
    limit('backup-dl:' + me.id, 6, 10 * 60_000);
    const name = String(ctx.params.name || '');
    if (!(NAME_RE.test(name) || require('./migrate').PRE_RE.test(name) || require('./restore').PRE_RESTORE_RE.test(name)) || !fs.existsSync(path.join(DIR, name))) fail(404, 'Backup not found.');
    D.insert('audit', { user_id: me.id, action: 'backup.download', detail: name, created_at: now() });
    sendFile(ctx, path.join(DIR, name), name, false);
  });
}

/* Leftover temporary copies (a download cut off mid-way) are removed at boot. */
try { for (const n of fs.readdirSync(DIR)) if (n.startsWith('.tmp-')) fs.unlinkSync(path.join(DIR, n)); } catch { /* no folder yet */ }

module.exports = { routes, start, tick, create, list, rotate, settings, lastAuto, snapshot, DIR, uploadsSize };
