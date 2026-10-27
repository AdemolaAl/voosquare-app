'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');
const { json, rid } = require('./util');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
/* RESTORE_FROM=<backup file name>: put that copy back before opening (the current database is saved first). src/restore.js */
require('./restore').maybeRestore();
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');

/* Safety copy BEFORE anything below touches the schema: an existing database with a pending migration (or, in
 * production, new code) is copied to <backups>/pre-migrate-v<N>-<time>.db first. See src/migrate.js. */
try { require('./migrate').preflight(db, config.dbPath); } catch (e) { require('./migrate').fatal(e); }

/* BASELINE SCHEMA (migration 001). Do not add tables or columns here any more: every change after the baseline is a
 * numbered file in src/migrations (docs/CHANGING-SAFELY.md). These statements stay because fresh databases need them. */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, voo_id TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '', handle TEXT UNIQUE, country TEXT DEFAULT '', avatar TEXT DEFAULT '{}', bio TEXT DEFAULT '',
  role_title TEXT DEFAULT '', perms TEXT DEFAULT '[]', support_scope TEXT DEFAULT '[]',
  premium_until INTEGER DEFAULT 0, premium_notice INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0, muted_until INTEGER DEFAULT 0,
  ref_code TEXT UNIQUE, referred_by INTEGER, signup_product INTEGER,
  marketing INTEGER DEFAULT 1, onboarded INTEGER DEFAULT 0, xp INTEGER DEFAULT 0,
  created_at INTEGER, last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS login_codes(
  email TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, attempts INTEGER DEFAULT 0,
  name TEXT, ref TEXT, product_id INTEGER, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER, expires INTEGER);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, stage TEXT DEFAULT '', status TEXT DEFAULT 'live',
  tagline TEXT DEFAULT '', description TEXT DEFAULT '', url TEXT DEFAULT '', icon TEXT DEFAULT '', color TEXT DEFAULT '#00A86B',
  tint TEXT DEFAULT '#E7F8F0', offer TEXT DEFAULT '', sort INTEGER DEFAULT 0, visible INTEGER DEFAULT 1, hub INTEGER DEFAULT 0,
  external INTEGER DEFAULT 0, sso INTEGER DEFAULT 0, client_id TEXT UNIQUE, client_secret TEXT, api_key TEXT UNIQUE,
  redirect_uris TEXT DEFAULT '[]', summary_url TEXT DEFAULT '', support_webhook TEXT DEFAULT '', support_greeting TEXT DEFAULT '',
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS rooms(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, topic TEXT DEFAULT 'General', description TEXT DEFAULT '',
  icon TEXT DEFAULT 'chat', color TEXT DEFAULT '#00A86B', access TEXT DEFAULT 'free', price_usd REAL DEFAULT 0,
  period_days INTEGER DEFAULT 30, read_only INTEGER DEFAULT 0, slow_secs INTEGER DEFAULT 0, sort INTEGER DEFAULT 0,
  archived INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS room_access(user_id INTEGER, room_id INTEGER, until INTEGER, PRIMARY KEY(user_id, room_id));
CREATE TABLE IF NOT EXISTS room_reads(user_id INTEGER, room_id INTEGER, last_id INTEGER, PRIMARY KEY(user_id, room_id));
CREATE TABLE IF NOT EXISTS messages(
  id INTEGER PRIMARY KEY, room_id INTEGER, user_id INTEGER, body TEXT, reply_to INTEGER,
  pinned INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_messages_room ON messages(room_id, id);
CREATE TABLE IF NOT EXISTS reactions(message_id INTEGER, user_id INTEGER, emoji TEXT, PRIMARY KEY(message_id, user_id, emoji));

CREATE TABLE IF NOT EXISTS courses(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT, track TEXT DEFAULT 'Foundations', level TEXT DEFAULT 'Beginner',
  author_key TEXT DEFAULT 'team', author_name TEXT DEFAULT 'Zedapex team', author_role TEXT DEFAULT 'Media buyers',
  description TEXT DEFAULT '', grad TEXT DEFAULT '', mark TEXT DEFAULT '', premium INTEGER DEFAULT 0,
  sort INTEGER DEFAULT 0, published INTEGER DEFAULT 1, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS lessons(
  id INTEGER PRIMARY KEY, course_id INTEGER, idx INTEGER DEFAULT 0, title TEXT, minutes INTEGER DEFAULT 5,
  premium INTEGER DEFAULT 0, steps TEXT DEFAULT '[]', takeaways TEXT DEFAULT '[]', action TEXT DEFAULT '',
  quiz TEXT DEFAULT 'null', published INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_lessons_course ON lessons(course_id, idx);
CREATE TABLE IF NOT EXISTS progress(user_id INTEGER, lesson_id INTEGER, done_at INTEGER, PRIMARY KEY(user_id, lesson_id));

CREATE TABLE IF NOT EXISTS posts(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT, category TEXT DEFAULT 'Playbook',
  author_key TEXT DEFAULT 'team', author_name TEXT DEFAULT 'Zedapex team', author_role TEXT DEFAULT '',
  excerpt TEXT DEFAULT '', minutes INTEGER DEFAULT 4, grad TEXT DEFAULT '', mark TEXT DEFAULT '', body TEXT DEFAULT '[]',
  premium INTEGER DEFAULT 0, published INTEGER DEFAULT 1, featured INTEGER DEFAULT 0, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS tickets(
  id INTEGER PRIMARY KEY, product_id INTEGER, user_id INTEGER, visitor_token TEXT, email TEXT DEFAULT '', name TEXT DEFAULT '',
  subject TEXT DEFAULT '', status TEXT DEFAULT 'open', priority TEXT DEFAULT 'normal', assignee_id INTEGER,
  channel TEXT DEFAULT 'voosquare', external_ref TEXT DEFAULT '', page_url TEXT DEFAULT '',
  staff_unread INTEGER DEFAULT 1, customer_unread INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_tickets_status ON tickets(status, updated_at);
CREATE INDEX IF NOT EXISTS ix_tickets_visitor ON tickets(visitor_token);
CREATE TABLE IF NOT EXISTS ticket_messages(
  id INTEGER PRIMARY KEY, ticket_id INTEGER, author_type TEXT, author_id INTEGER, body TEXT, internal INTEGER DEFAULT 0, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_tmsg_ticket ON ticket_messages(ticket_id, id);
CREATE TABLE IF NOT EXISTS canned(id INTEGER PRIMARY KEY, title TEXT, body TEXT, product_id INTEGER);

CREATE TABLE IF NOT EXISTS payment_methods(
  id INTEGER PRIMARY KEY, type TEXT, name TEXT, currency TEXT DEFAULT 'USD', rate REAL DEFAULT 1,
  config TEXT DEFAULT '{}', enabled INTEGER DEFAULT 0, sort INTEGER DEFAULT 0, note TEXT DEFAULT '', countries TEXT DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, ref TEXT UNIQUE, user_id INTEGER, item_type TEXT, item_id INTEGER, item_name TEXT,
  amount_usd REAL, currency TEXT, amount REAL, method_id INTEGER, status TEXT DEFAULT 'pending',
  provider_ref TEXT DEFAULT '', proof TEXT DEFAULT '', note TEXT DEFAULT '', created_at INTEGER, paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_orders_user ON orders(user_id);

CREATE TABLE IF NOT EXISTS email_templates(
  key TEXT PRIMARY KEY, name TEXT, subject TEXT, preheader TEXT DEFAULT '', html TEXT, text TEXT DEFAULT '',
  marketing INTEGER DEFAULT 0, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS email_sequence(key TEXT PRIMARY KEY, delay_hours REAL, enabled INTEGER DEFAULT 1, sort INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS email_queue(
  id INTEGER PRIMARY KEY, user_id INTEGER, to_email TEXT, template TEXT, vars TEXT DEFAULT '{}',
  send_at INTEGER, sent_at INTEGER, status TEXT DEFAULT 'queued', attempts INTEGER DEFAULT 0, error TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_queue_due ON email_queue(status, send_at);

CREATE TABLE IF NOT EXISTS events(
  id INTEGER PRIMARY KEY, product_id INTEGER, user_id INTEGER, ext_id TEXT, type TEXT, label TEXT DEFAULT '',
  value_usd REAL DEFAULT 0, created_at INTEGER, UNIQUE(product_id, ext_id)
);
CREATE INDEX IF NOT EXISTS ix_events_user ON events(user_id, id);
CREATE TABLE IF NOT EXISTS sso_codes(code_hash TEXT PRIMARY KEY, user_id INTEGER, product_id INTEGER, redirect_uri TEXT, expires INTEGER);
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT, detail TEXT DEFAULT '', created_at INTEGER);

CREATE TABLE IF NOT EXISTS uploads(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, sha TEXT, mime TEXT, bytes INTEGER, w INTEGER, h INTEGER,
  thumb INTEGER DEFAULT 0, purpose TEXT DEFAULT 'chat', attached_to TEXT DEFAULT '', created_at INTEGER,
  deleted INTEGER DEFAULT 0, purged INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_uploads_user ON uploads(user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_uploads_clean ON uploads(attached_to, created_at);
`;
db.exec(SCHEMA);

/* Columns added after launch. ADD COLUMN only runs when the column is missing, so existing databases migrate in place. */
function addColumn(table, column, decl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
}
addColumn('messages', 'upload_id', 'TEXT');
addColumn('ticket_messages', 'upload_id', 'TEXT');
addColumn('rooms', 'images', 'INTEGER DEFAULT 1');
addColumn('orders', 'proof_upload', "TEXT DEFAULT ''");
/* Invite-only paid rooms: members apply, the team approves, then they pay. */
addColumn('rooms', 'approval_required', 'INTEGER DEFAULT 0');
addColumn('rooms', 'seats', 'INTEGER DEFAULT 0');
addColumn('rooms', 'apply_questions', "TEXT DEFAULT '[]'");
/* Room pictures: a square picture and a wide cover, uploaded by the team. Empty means the house artwork (or the icon). */
addColumn('rooms', 'image_upload', "TEXT DEFAULT ''");
addColumn('rooms', 'cover_upload', "TEXT DEFAULT ''");
db.exec(`CREATE TABLE IF NOT EXISTS room_applications(
  id INTEGER PRIMARY KEY, room_id INTEGER NOT NULL, user_id INTEGER NOT NULL, answers TEXT DEFAULT '[]',
  status TEXT DEFAULT 'pending', note_to_member TEXT DEFAULT '', decided_by INTEGER, decided_at INTEGER,
  created_at INTEGER, approved_until INTEGER DEFAULT 0, seat_override INTEGER DEFAULT 0, paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_apps_room ON room_applications(room_id, status);
CREATE INDEX IF NOT EXISTS ix_apps_user ON room_applications(user_id, room_id);`);
/* Free tools: Premium members save calculator scenarios. */
db.exec(`CREATE TABLE IF NOT EXISTS tool_saves(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, tool TEXT NOT NULL, name TEXT DEFAULT '', data TEXT DEFAULT '{}', created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_tool_saves_user ON tool_saves(user_id, tool, id);`);
/* Events API: when VooSquare received each event. created_at is the tool's occurred_at (clamped so it is never in the
 * future); received_at cannot be backdated, so the referral settling clock runs from it. Existing rows: received_at is
 * their created_at, and any future occurred_at is clamped to now (once, when the column is added). */
{
  const cols = db.prepare('PRAGMA table_info(events)').all().map((c) => c.name);
  if (!cols.includes('received_at')) {
    db.exec('ALTER TABLE events ADD COLUMN received_at INTEGER');
    const t = Date.now();
    db.prepare('UPDATE events SET created_at=? WHERE created_at>?').run(t, t);
    db.exec('UPDATE events SET received_at=created_at WHERE received_at IS NULL');
  }
}
/* Revenue reports: paid orders by time, spend events by time, both per member. */
db.exec(`CREATE INDEX IF NOT EXISTS ix_orders_paid ON orders(status, paid_at);
CREATE INDEX IF NOT EXISTS ix_events_type_time ON events(type, created_at);
CREATE INDEX IF NOT EXISTS ix_events_user_type ON events(user_id, type);`);

/* Referral payouts. VooSquare only keeps the record: the Zedapex team pays from its own wallet or bank and marks it paid.
 * One payout method per member. At most one open request (requested or processing) per member, enforced by the index. */
db.exec(`CREATE TABLE IF NOT EXISTS payout_methods(
  user_id INTEGER PRIMARY KEY, type TEXT NOT NULL, details TEXT DEFAULT '{}', updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS payouts(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount_usd REAL NOT NULL, method TEXT DEFAULT '{}',
  status TEXT DEFAULT 'requested', reference TEXT DEFAULT '', note TEXT DEFAULT '', rate REAL DEFAULT 0,
  requested_at INTEGER, decided_by INTEGER, decided_at INTEGER, paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_payouts_user ON payouts(user_id, id);
CREATE INDEX IF NOT EXISTS ix_payouts_status ON payouts(status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_payouts_open ON payouts(user_id) WHERE status IN ('requested','processing');
CREATE INDEX IF NOT EXISTS ix_users_referred ON users(referred_by);`);

const cache = new Map();
const stmt = (sql) => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
const norm = (args) => args.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v !== null && typeof v === 'object') ? JSON.stringify(v) : v));
const all = (sql, ...p) => stmt(sql).all(...norm(p)).map((r) => ({ ...r }));
const get = (sql, ...p) => { const r = stmt(sql).get(...norm(p)); return r ? { ...r } : null; };
const run = (sql, ...p) => { const r = stmt(sql).run(...norm(p)); return { changes: Number(r.changes), id: Number(r.lastInsertRowid) }; };
function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Insert an object into a table. Objects/arrays are stored as JSON. */
function insert(table, obj) {
  const keys = Object.keys(obj);
  return run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`, ...keys.map((k) => obj[k]));
}
/** Update only the allowed fields that are present on obj. */
function update(table, id, obj, allowed) {
  const keys = Object.keys(obj).filter((k) => allowed.includes(k) && obj[k] !== undefined);
  if (!keys.length) return { changes: 0 };
  return run(`UPDATE ${table} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`, ...keys.map((k) => obj[k]), id);
}

function getSetting(key, def) { const r = get('SELECT value FROM settings WHERE key=?', key); return r ? json(r.value, def) : def; }
function setSetting(key, value) { run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }

/* App secret: env wins, otherwise generate once and keep it in the database. */
let secret = config.appSecret;
if (!secret) {
  secret = getSetting('app_secret', '');
  if (!secret) { secret = rid(32); setSetting('app_secret', secret); }
}

module.exports = { db, all, get, run, tx, insert, update, getSetting, setSetting, secret: () => secret };
