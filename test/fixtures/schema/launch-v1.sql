-- The first VooSquare schema (db.js SCHEMA at launch, before any guarded ADD COLUMN). Used by test/safety.js.
-- Never edit.
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
