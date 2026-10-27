'use strict';
/* Production-safety checks (docs/CHANGING-SAFELY.md): versioned migrations (fresh and old databases end up with the same
 * schema, booting twice changes nothing, a failing migration is rolled back and the app refuses to start), the automatic
 * copy before an update, grandfathered prices, school progress surviving content edits, renames and removals, the
 * recycle bin, rollout flags, the frozen /api/v1 shapes and the "money is never hard-deleted" rule.
 * Called last from test/smoke.js with its helpers. Old-database boots run on their own servers and temporary files. */
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures');

module.exports = async function safety({ BASE, Client, check, owner, DB, BACKUPS, SCHOOL_EXTRA, PORT }) {
  const { DatabaseSync } = require('node:sqlite');
  const { list: migrationList } = require('../src/migrate');
  const MIGS = migrationList();
  const LATEST = MIGS[MIGS.length - 1].version;
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), `voosquare-safety-${process.pid}-`));
  const xf = () => ({ 'x-forwarded-for': `10.99.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (email, name) => { const c = new Client(); const s = await c.post('/api/auth/start', { email, name }, xf()); await c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf()); return c; };
  const DAY = 86400_000;
  let portN = 0;

  /* Boot a server on `file` until it is healthy (or exits). Returns its log, exit code and /healthz body. */
  async function boot(file, env = {}) {
    const port = PORT + 900 + (portN++ % 90);
    const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port), DATABASE_PATH: file, BACKUPS_DIR: path.join(TMP, 'bk-' + path.basename(file)), UPLOADS_DIR: path.join(TMP, 'up'), VOICE_DIR: path.join(TMP, 'voice'), OWNER_EMAIL: 'owner@test.dev', NODE_ENV: 'test', EMAIL_PROVIDER: '', SCHOOL_EXTRA_DIR: '', ...env },
    });
    let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
    let code = null; const exited = new Promise((r) => srv.once('exit', (c) => { code = c; r(); }));
    let health = null;
    for (let i = 0; i < 150 && code === null; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { 'x-health-key': process.env.HEALTH_KEY || '' } }); health = await r.json(); if (r.ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (code === null) { srv.kill('SIGTERM'); await exited; return { ok: true, log, health, code }; }
    return { ok: false, log, health, code };
  }
  const backupsOf = (file) => { try { return fs.readdirSync(path.join(TMP, 'bk-' + path.basename(file))).filter((n) => n.startsWith('pre-migrate-')).sort(); } catch { return []; } };
  /* The schema as a comparable object: every table's columns (name, type, not null, default, pk) and every index. */
  function schemaOf(file) {
    const db = new DatabaseSync(file);
    const out = {};
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
      out[t.name] = db.prepare(`PRAGMA table_info(${t.name})`).all().map((c) => `${c.name} ${c.type} ${c.notnull} ${c.dflt_value} ${c.pk}`).sort();
    }
    out['(indexes)'] = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name").all().map((r) => `${r.tbl_name}.${r.name}`);
    db.close();
    return out;
  }
  const diff = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => ({ k, only_a: (a[k] || []).filter((x) => !(b[k] || []).includes(x)), only_b: (b[k] || []).filter((x) => !(a[k] || []).includes(x)) }));
  const fromSql = (name, sqlFile) => { const f = path.join(TMP, name); const db = new DatabaseSync(f); db.exec(fs.readFileSync(path.join(FIX, 'schema', sqlFile), 'utf8')); db.close(); return f; };

  console.log('Safety: migrations');
  {
    const h = await (await fetch(BASE + '/healthz', { headers: { 'x-health-key': process.env.HEALTH_KEY || '' } })).json();
    check('healthz: database answers and every migration is applied', h.ok === true && h.db === 'ok' && h.schema.version === LATEST && h.schema.expected === LATEST && typeof h.time === 'number', h);
    const sql = new DatabaseSync(DB);
    const rows = sql.prepare('SELECT * FROM schema_migrations ORDER BY version').all();
    sql.close();
    check('migrations: every file recorded once, with its checksum', rows.length === MIGS.length && rows.every((r, i) => r.version === MIGS[i].version && r.checksum === MIGS[i].checksum), rows);
    check('migrations: numbered 1, 2, 3... with no gaps', MIGS.every((m, i) => m.version === i + 1), MIGS.map((m) => m.file));
    const lock = JSON.parse(fs.readFileSync(path.join(FIX, 'migrations.lock.json'), 'utf8'));
    const unlocked = MIGS.filter((m) => !lock[String(m.version).padStart(3, '0') + '-' + m.name]).map((m) => m.file);
    const edited = MIGS.filter((m) => { const k = lock[String(m.version).padStart(3, '0') + '-' + m.name]; return k && k !== m.checksum; }).map((m) => m.file);
    check('migrations: every migration is locked (run `npm run lock-migrations` once after adding one)', !unlocked.length, unlocked);
    check('migrations: no shipped migration was edited (add a new one instead)', !edited.length, edited);
    const destructive = MIGS.filter((m) => {
      const code = fs.readFileSync(path.join(ROOT, 'src', 'migrations', m.file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return /\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bRENAME\s+(TO|COLUMN)\b|\bDELETE\s+FROM\b/i.test(code);
    }).map((m) => m.file);
    check('migrations: additive only (no DROP, RENAME or DELETE in any migration)', !destructive.length, destructive);
  }

  console.log('Safety: old databases upgrade to the same schema as a fresh one');
  {
    const fresh = path.join(TMP, 'fresh.db');
    const b0 = await boot(fresh);
    check('fresh database boots healthy', b0.ok && b0.health && b0.health.schema.version === LATEST, b0.log.slice(-800));
    check('fresh database: no copy is made (nothing to protect)', backupsOf(fresh).length === 0);
    const want = schemaOf(fresh);

    // The release before versioned migrations, with members, money and progress in it.
    const old = fromSql('old.db', '2026-10-04-before-migrations.sql');
    {
      const db = new DatabaseSync(old);
      const t = Date.now();
      db.exec(`INSERT INTO settings(key,value) VALUES('premium','{"enabled":true,"price_usd":25,"period_days":30,"features":["All rooms"]}')`);
      db.prepare("INSERT INTO users(id,voo_id,email,name,premium_until,created_at) VALUES(901,'VOO-OLD1','old1@test.dev','Old One',?,?)").run(t + 20 * DAY, t - 90 * DAY);
      db.prepare("INSERT INTO users(id,voo_id,email,name,premium_until,created_at) VALUES(902,'VOO-OLD2','old2@test.dev','Old Two',?,?)").run(t - 60 * DAY, t - 90 * DAY);
      db.prepare("INSERT INTO orders(ref,user_id,item_type,item_name,amount_usd,currency,amount,status,created_at,paid_at) VALUES('VS-OLD1',901,'premium','VooSquare Premium',19,'USD',19,'paid',?,?)").run(t - 10 * DAY, t - 10 * DAY);
      db.prepare("INSERT INTO orders(ref,user_id,item_type,item_name,amount_usd,currency,amount,status,created_at,paid_at) VALUES('VS-OLD2',902,'premium','VooSquare Premium',15,'USD',15,'paid',?,?)").run(t - 90 * DAY, t - 90 * DAY);
      db.prepare("INSERT INTO school_progress(user_id,lesson_id,best_score,total,attempts,passed_at) VALUES(901,7,5,5,1,?)").run(t - DAY);
      db.prepare("INSERT INTO school_certificates(user_id,school_id,code,name,issued_at) VALUES(901,1,'OLDCERT1','Old One',?)").run(t - DAY);
      db.close();
    }
    // Three older safety copies already on disk: only the newest PRE_MIGRATE_KEEP (2 here) are kept after the next one.
    const bkDir = path.join(TMP, 'bk-old.db'); fs.mkdirSync(bkDir, { recursive: true });
    ['2026-01-01-000000-000', '2026-02-01-000000-000', '2026-03-01-000000-000'].forEach((s, i) => { const f = path.join(bkDir, `pre-migrate-v1-${s}.db`); fs.writeFileSync(f, 'x'); const tt = new Date(2026, i, 1); fs.utimesSync(f, tt, tt); });
    const b1 = await boot(old, { PRE_MIGRATE_KEEP: '2' });
    check('old database (before migrations) boots healthy', b1.ok && b1.health && b1.health.schema.version === LATEST, b1.log.slice(-1200));
    check('old database: schema now identical to a fresh one', !diff(want, schemaOf(old)).length, diff(want, schemaOf(old)));
    const copies = backupsOf(old);
    check('old database: a safety copy was made before the change, older copies trimmed to PRE_MIGRATE_KEEP', copies.length === 2 && copies.includes('pre-migrate-v1-2026-03-01-000000-000.db') && copies.some((n) => n.startsWith(`pre-migrate-v${LATEST}-`)) && /safety copy before the update/.test(b1.log), [copies, b1.log.slice(0, 600)]);
    const copyFile = path.join(bkDir, copies.find((n) => n.startsWith(`pre-migrate-v${LATEST}-`)));
    {
      const c = new DatabaseSync(copyFile);
      const hasMig = !!c.prepare("SELECT 1 FROM sqlite_master WHERE name='schema_migrations'").get();
      const u = c.prepare('SELECT email FROM users WHERE id=901').get();
      c.close();
      check('safety copy holds the data exactly as before the upgrade', !hasMig && u && u.email === 'old1@test.dev');
    }
    {
      const db = new DatabaseSync(old);
      const users = db.prepare('SELECT COUNT(*) n FROM users WHERE id IN (901,902)').get().n;
      const orders = db.prepare("SELECT COUNT(*) n FROM orders WHERE ref IN ('VS-OLD1','VS-OLD2')").get().n;
      const prog = db.prepare('SELECT passed_at FROM school_progress WHERE user_id=901 AND lesson_id=7').get();
      const cert = db.prepare("SELECT revoked_at FROM school_certificates WHERE code='OLDCERT1'").get();
      const locks = db.prepare('SELECT user_id, price_usd, period_days FROM price_locks ORDER BY user_id').all();
      const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((r) => r.version);
      const audit = db.prepare("SELECT action FROM audit WHERE action IN ('backup.pre_migrate','db.migrate')").all().map((r) => r.action);
      db.close();
      check('old database: members, orders, progress and certificates all kept', users === 2 && orders === 2 && prog && prog.passed_at && cert && cert.revoked_at === 0);
      check('old database: active Premium member is grandfathered at what they paid; lapsed member is not', locks.length === 1 && locks[0].user_id === 901 && locks[0].price_usd === 19 && locks[0].period_days === 30, locks);
      check('old database: every migration recorded, and the upgrade is in the audit log', applied.join() === MIGS.map((m) => m.version).join() && audit.includes('backup.pre_migrate') && audit.filter((a) => a === 'db.migrate').length === MIGS.length, [applied, audit]);
    }

    // Boot twice: nothing runs again, no new copy, same schema.
    const before = schemaOf(old);
    const at0 = (() => { const db = new DatabaseSync(old); const r = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all().map((x) => ({ ...x })); db.close(); return r; })();
    const b2 = await boot(old);
    const at1 = (() => { const db = new DatabaseSync(old); const r = db.prepare('SELECT version, applied_at FROM schema_migrations ORDER BY version').all().map((x) => ({ ...x })); db.close(); return r; })();
    check('boot twice: healthy, no migration runs again, no new copy, schema unchanged', b2.ok && JSON.stringify(at0) === JSON.stringify(at1) && backupsOf(old).length === 2 && !diff(before, schemaOf(old)).length && !/applied 0/.test(b2.log), b2.log.slice(-600));

    // The very first schema (launch) upgrades too.
    const v1 = fromSql('launch.db', 'launch-v1.sql');
    { const db = new DatabaseSync(v1); db.prepare("INSERT INTO users(voo_id,email,name,created_at) VALUES('VOO-V1','v1@test.dev','Launch Member',?)").run(Date.now()); db.close(); }
    const b3 = await boot(v1);
    check('launch-day database boots healthy and matches a fresh schema', b3.ok && !diff(want, schemaOf(v1)).length, b3.ok ? diff(want, schemaOf(v1)) : b3.log.slice(-1200));
    { const db = new DatabaseSync(v1); const u = db.prepare("SELECT name FROM users WHERE voo_id='VOO-V1'").get(); db.close(); check('launch-day database: its member is still there', u && u.name === 'Launch Member'); }

    // Production: a copy before every new code version (BACKUP_ON_DEPLOY), once per version.
    const n0 = backupsOf(old).length;
    const d1 = await boot(old, { BACKUP_ON_DEPLOY: '1', PRE_MIGRATE_KEEP: '5' });
    const n1 = backupsOf(old).length;
    { const db = new DatabaseSync(old); db.prepare("UPDATE schema_meta SET value='an-older-release' WHERE key='boot_code_hash'").run(); db.close(); }
    const d2 = await boot(old, { BACKUP_ON_DEPLOY: '1', PRE_MIGRATE_KEEP: '5' });
    const n2 = backupsOf(old).length;
    const d3 = await boot(old, { BACKUP_ON_DEPLOY: '1', PRE_MIGRATE_KEEP: '5' });
    check('deploy copies: none for the same code, one when the code changed, not repeated', d1.ok && d2.ok && d3.ok && n1 === n0 && n2 === n0 + 1 && backupsOf(old).length === n2 && /new code version/.test(d2.log), [n0, n1, n2, backupsOf(old).length]);

    // A failing migration: rolled back, the app refuses to start, the retry does not copy again, the old code still runs.
    const bad = path.join(TMP, 'bad-migrations'); fs.mkdirSync(bad, { recursive: true });
    fs.writeFileSync(path.join(bad, '9999-explode.js'), "module.exports = { up(db) { db.exec('CREATE TABLE explode_probe(id INTEGER)'); db.exec('ALTER TABLE users ADD COLUMN explode_col TEXT'); db.exec(\"UPDATE users SET name='BROKEN'\"); throw new Error('boom on purpose'); } };\n");
    const nb = backupsOf(old).length;
    const f1 = await boot(old, { MIGRATIONS_EXTRA_DIR: bad, PRE_MIGRATE_KEEP: '10' });
    const f2 = await boot(old, { MIGRATIONS_EXTRA_DIR: bad, PRE_MIGRATE_KEEP: '10' });
    {
      const db = new DatabaseSync(old);
      const probe = db.prepare("SELECT 1 FROM sqlite_master WHERE name='explode_probe'").get();
      const col = db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'explode_col');
      const broken = db.prepare("SELECT COUNT(*) n FROM users WHERE name='BROKEN'").get().n;
      const row = db.prepare('SELECT 1 FROM schema_migrations WHERE version=9999').get();
      db.close();
      check('failing migration: the app refuses to start with a clear message (exit 1)', !f1.ok && f1.code === 1 && /did NOT start/.test(f1.log) && /9999-explode\.js failed and was rolled back/.test(f1.log) && /boom on purpose/.test(f1.log), f1.log.slice(-800));
      check('failing migration: everything it did is rolled back (table, column, data)', !probe && !col && broken === 0 && !row);
      check('failing migration: one safety copy, not one per retry', backupsOf(old).length === nb + 1 && !f2.ok, [nb, backupsOf(old)]);
    }
    const r1 = await boot(old);
    check('after a failed deploy, the previous code still runs on the same database', r1.ok && r1.health.schema.version === LATEST);
    // Rollback: the database is ahead of the code (a newer release ran migration 9998). The older code runs fine.
    { const db = new DatabaseSync(old); db.prepare("INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(9998,'from-a-newer-release','',?)").run(Date.now()); db.close(); }
    const r2 = await boot(old);
    check('rollback: a database ahead of the code still boots healthy (migrations only add)', r2.ok && /newer than this code/.test(r2.log), r2.log.slice(-600));

    // RESTORE_FROM: put a copy back on start, saving the current database first; never twice; bad names change nothing.
    const first = copies.find((n) => n.startsWith(`pre-migrate-v${LATEST}-`));
    const addUser = (id, name) => { const db = new DatabaseSync(old); db.prepare("INSERT INTO users(id,voo_id,email,name,created_at) VALUES(?,?,?,?,?)").run(id, 'VOO-' + id, `u${id}@test.dev`, name, Date.now()); db.close(); };
    const names = () => { const db = new DatabaseSync(old); const r = db.prepare('SELECT name FROM users WHERE id>=901').all().map((x) => x.name); db.close(); return r; };
    addUser(903, 'After the copy');
    const bn = await boot(old, { RESTORE_FROM: 'nope.db' });
    check('restore: an unknown file name stops the start and changes nothing', !bn.ok && bn.code === 1 && /does not exist/.test(bn.log) && names().includes('After the copy'));
    const rs1 = await boot(old, { RESTORE_FROM: first });
    const preRestore = fs.readdirSync(bkDir).filter((n) => n.startsWith('pre-restore-'));
    check('restore: the copy is back (later rows gone), migrations applied again, healthy', rs1.ok && /\[restore\] restored/.test(rs1.log) && !names().includes('After the copy') && names().includes('Old One') && rs1.health.schema.version === LATEST, [names(), rs1.log.slice(-500)]);
    { const c = new DatabaseSync(path.join(bkDir, preRestore[0])); const had = c.prepare('SELECT name FROM users WHERE id=903').get(); c.close(); check('restore: the database before the restore was saved first (nothing lost)', preRestore.length === 1 && had && had.name === 'After the copy'); }
    addUser(904, 'After the restore');
    const rs2 = await boot(old, { RESTORE_FROM: first });
    check('restore: a forgotten RESTORE_FROM does not restore again', rs2.ok && /already restored/.test(rs2.log) && names().includes('After the restore'));
    const lst = (await owner.get('/api/admin/backups')).data; // main server: lists its own folder (kinds are recognised by name)
    check('restore: Admin → Backups still answers', !!lst.schema);
  }

  console.log('Safety: Admin → Backups shows the copies made before an update');
  {
    const name = 'pre-migrate-v1-2026-01-02-030405-006.db';
    fs.mkdirSync(BACKUPS, { recursive: true });
    { const live = new DatabaseSync(DB); live.exec(`VACUUM INTO '${path.join(BACKUPS, name).replace(/'/g, "''")}'`); live.close(); }
    const keepWas = (await owner.get('/api/admin/backups')).data.settings;
    await owner.put('/api/admin/backups/settings', { auto: keepWas.auto, keep: 1 });
    const d = (await owner.get('/api/admin/backups')).data;
    check('backups page lists it as made before an update, and the daily rotation leaves it alone', d.backups.some((b) => b.name === name && b.kind === 'pre-migrate') && d.schema && d.schema.version === LATEST && d.schema.ok === true, d.backups);
    // A second owner (downloads are rate limited per person, and the admin tests already used the first owner's).
    const own2 = await login('safety-owner@test.dev', 'Second Owner');
    await owner.post('/api/admin/team', { email: 'safety-owner@test.dev', perms: ['*'] });
    const dl = await fetch(BASE + '/api/admin/backups/file/' + name, { headers: { cookie: own2.cookie } });
    check('it can be downloaded', dl.status === 200 && (await dl.arrayBuffer()).byteLength > 1000, dl.status);
    const evil = await own2.get('/api/admin/backups/file/' + encodeURIComponent('pre-migrate-v1-../../x.db'));
    check('names outside the patterns are refused', evil.status === 404, evil.status);
    await owner.put('/api/admin/backups/settings', keepWas);
  }

  console.log('Safety: grandfathered prices');
  {
    const premWas = (await owner.get('/api/admin/settings/premium')).data.value || {};
    const setPrem = (v) => owner.put('/api/admin/settings/premium', { value: { ...premWas, enabled: true, features: ['Every room'], ...v } });
    await setPrem({ price_usd: 20, period_days: 30 });
    const pm = (await owner.post('/api/admin/payment-methods', { type: 'manual', name: 'Safety bank', currency: 'USD', rate: 1, enabled: true, config: { instructions: 'Pay to the safety account', details: [{ label: 'Bank', value: 'Test' }] } })).data.method;
    const buy = async (c, body) => { const r = await c.post('/api/billing/checkout', { method_id: pm.id, ...body }); return r.data && r.data.order; };
    const approve = (o) => owner.post(`/api/admin/orders/${o.id}/approve`);
    const sql = new DatabaseSync(DB);
    const orderRow = (ref) => sql.prepare('SELECT * FROM orders WHERE ref=?').get(ref);
    const userRow = (c) => c.get('/api/me').then((r) => sql.prepare('SELECT * FROM users WHERE id=?').get(r.data.user.id));

    const early = await login('gf-early@test.dev', 'Early Bird');
    const o1 = await buy(early, { item: 'premium' });
    const row1 = orderRow(o1.ref);
    check('order keeps what was sold: price, period and terms', o1.amount_usd === 20 && row1.period_days === 30 && JSON.parse(row1.terms).price_usd === 20 && JSON.parse(row1.terms).features[0] === 'Every room', row1);
    // The team shortens the period before the transfer is approved: the member still gets the 30 days they bought.
    await setPrem({ price_usd: 20, period_days: 7 });
    const u0 = await userRow(early);
    await approve(o1);
    const u1 = await userRow(early);
    check('approval later still grants the period on the order (30 days, not the new 7)', Math.round((u1.premium_until - Math.max(Date.now(), u0.premium_until || 0)) / DAY) === 30, (u1.premium_until - Date.now()) / DAY);
    const lock = sql.prepare("SELECT * FROM price_locks WHERE user_id=? AND item_type='premium'").get(u1.id);
    check('paid order locks the member’s price and period', lock && lock.price_usd === 20 && lock.period_days === 30, lock);

    await setPrem({ price_usd: 35, period_days: 30 });
    const q = (await early.get('/api/billing/methods')).data.prices.premium;
    check('price rise: an existing member sees their kept price', q && q.locked === true && q.usd === 20 && q.days === 30 && q.list_usd === 35, q);
    const o2 = await buy(early, { item: 'premium' });
    check('price rise: an existing member renews at their kept price', o2 && o2.amount_usd === 20 && JSON.parse(orderRow(o2.ref).terms).locked === true, o2);
    const late = await login('gf-late@test.dev', 'New Comer');
    const ql = (await late.get('/api/billing/methods')).data.prices.premium;
    const o3 = await buy(late, { item: 'premium' });
    check('price rise: a new member pays the new price', ql && ql.locked === false && ql.usd === 35 && o3 && o3.amount_usd === 35, [ql, o3]);
    await setPrem({ price_usd: 15, period_days: 30 });
    check('price cut: everyone gets the lower price, kept members included', (await early.get('/api/billing/methods')).data.prices.premium.usd === 15 && (await late.get('/api/billing/methods')).data.prices.premium.usd === 15);
    await setPrem({ price_usd: 35, period_days: 30 });
    sql.prepare('UPDATE users SET premium_until=? WHERE id=?').run(Date.now() - 8 * DAY, u1.id);
    check('lapsed past the 7-day grace: back to today’s price', (await early.get('/api/billing/methods')).data.prices.premium.usd === 35);
    sql.prepare('UPDATE users SET premium_until=? WHERE id=?').run(Date.now() - 6 * DAY, u1.id);
    check('lapsed inside the grace period: still the kept price', (await early.get('/api/billing/methods')).data.prices.premium.usd === 20);
    const gf = await owner.put('/api/admin/settings/grandfathering', { value: { enabled: false } });
    check('owner can switch grandfathering off (everyone pays today’s price), and back on', gf.status === 200 && gf.data && (await early.get('/api/billing/methods')).data.prices.premium.usd === 35, gf.data);
    await owner.put('/api/admin/settings/grandfathering', { value: { enabled: true, grace_days: 7 } });
    check('grandfathering back on: kept price again', (await early.get('/api/billing/methods')).data.prices.premium.usd === 20);

    // Paid rooms work the same way.
    const room = (await owner.post('/api/admin/rooms', { name: 'Safety Lounge', access: 'paid', price_usd: 10, period_days: 30 })).data.room;
    const or1 = await buy(early, { item: 'room', room_id: room.id });
    await approve(or1);
    await owner.post('/api/admin/rooms', { ...room, id: room.id, price_usd: 15 });
    const rq = (await early.get('/api/billing/methods')).data.prices.rooms[room.id];
    const or2 = await buy(late, { item: 'room', room_id: room.id });
    check('paid room price rise: the member keeps $10, a new member pays $15', rq && rq.usd === 10 && rq.locked && or2 && or2.amount_usd === 15, [rq, or2]);
    sql.close();
    await owner.put('/api/admin/settings/premium', { value: premWas });
    await owner.post('/api/admin/payment-methods', { ...pm, enabled: false });
  }

  console.log('Safety: school progress survives content edits, renames and removals');
  {
    const dir = path.join(SCHOOL_EXTRA, 'safety');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'school.json'), JSON.stringify({ slug: 'safety', title: 'Safety school', subtitle: 'Test fixture', level: 'Test', sort: 99, cert_title: 'Safety', track: 'extra' }));
    const base = JSON.parse(fs.readFileSync(path.join(FIX, 'school', 'lab', '01-every-slide.json'), 'utf8'));
    const lessonA = { ...base.lessons[0], slug: 'keep-me', title: 'Keep me' };
    const lessonB = { ...base.lessons[0], slug: 'second-one', title: 'Second one' };
    const writeMod = (over) => fs.writeFileSync(path.join(dir, '01-safe.json'), JSON.stringify({ school: 'safety', order: 1, slug: 'safe-module', title: 'Safe module', summary: 'x', exam: base.exam, lessons: [lessonA, lessonB], ...over }));
    const reload = async () => (await owner.post('/api/admin/school/reload')).data;
    writeMod({});
    await reload();
    const sql = new DatabaseSync(DB);
    const secret = JSON.parse(sql.prepare("SELECT value FROM settings WHERE key='app_secret'").get().value);
    const optId = (key, text) => crypto.createHmac('sha256', String(secret)).update('school-opt|' + key + '|' + String(text)).digest('hex').slice(0, 12);
    const right = (key) => { const m = /^L(\d+)\.(\d+)$/.exec(key); const q = JSON.parse(sql.prepare('SELECT quiz FROM school_lessons WHERE id=?').get(Number(m[1])).quiz)[Number(m[2])]; return optId(key, q.options[q.answer]); };
    const school = sql.prepare("SELECT id FROM school_schools WHERE slug='safety'").get();
    const mod = sql.prepare("SELECT id FROM school_modules WHERE school_id=? AND slug='safe-module'").get(school.id);
    const idOf = (slug) => (sql.prepare('SELECT id FROM school_lessons WHERE module_id=? AND slug=?').get(mod.id, slug) || {}).id;
    const idA = idOf('keep-me'); const idB = idOf('second-one');
    const stu = await login('safety-student@test.dev', 'Sade Student');
    const stuId = (await stu.get('/api/me')).data.user.id;
    await owner.post(`/api/admin/school/members/${stuId}/grant`, { action: 'open_school', school_id: school.id });
    await stu.post('/api/school/schools/safety/enroll');
    for (const id of [idA, idB]) { const l = (await stu.get('/api/school/lessons/' + id)).data.lesson; await stu.post(`/api/school/lessons/${id}/quiz`, { answers: Object.fromEntries(l.quiz.map((x) => [x.id, right(x.id)])) }); }
    const status = async (id) => ((await stu.get('/api/school/modules/' + mod.id)).data.module.lessons.find((x) => x.id === id) || {}).status;
    check('school setup: both lessons passed', (await status(idA)) === 'done' && (await status(idB)) === 'done', [await status(idA), await status(idB)]);

    lessonA.title = 'Keep me (rewritten)'; lessonA.steps = [...lessonA.steps.slice(1), lessonA.steps[0]];
    writeMod({});
    await reload();
    check('content edit: lesson updated in place, progress kept', idOf('keep-me') === idA && (await status(idA)) === 'done' && sql.prepare('SELECT title FROM school_lessons WHERE id=?').get(idA).title === 'Keep me (rewritten)');

    writeMod({ lessons: [{ ...lessonA, slug: 'kept-and-renamed', was: ['keep-me'] }, lessonB] });
    await reload();
    check('rename with "was": same lesson, same id, progress kept', idOf('kept-and-renamed') === idA && !idOf('keep-me') && (await status(idA)) === 'done');

    writeMod({ lessons: [{ ...lessonA, slug: 'kept-and-renamed', was: ['keep-me'] }] });
    await reload();
    const hidden = sql.prepare('SELECT published FROM school_lessons WHERE id=?').get(idB);
    const progB = sql.prepare('SELECT passed_at FROM school_progress WHERE user_id=? AND lesson_id=?').get(stuId, idB);
    check('lesson removed from the file: retired (hidden), its row and the progress kept', hidden && hidden.published === 0 && progB && progB.passed_at > 0);
    writeMod({ slug: 'safe-module-2', was: ['safe-module'], lessons: [{ ...lessonA, slug: 'kept-and-renamed', was: ['keep-me'] }, lessonB] });
    await reload();
    const mod2 = sql.prepare("SELECT id FROM school_modules WHERE school_id=? AND slug='safe-module-2'").get(school.id);
    check('module renamed with "was" and the lesson brought back: same ids, progress back', mod2 && mod2.id === mod.id && (await status(idB)) === 'done' && (await status(idA)) === 'done');
    sql.close();
    fs.rmSync(dir, { recursive: true, force: true });
    await reload();
  }

  console.log('Safety: recycle bin and money records');
  {
    const course = (await owner.post('/api/admin/courses', { title: 'Safety course' })).data.course;
    const lesson = (await owner.post('/api/admin/lessons', { course_id: course.id, title: 'Safety lesson', steps: [] })).data.lesson;
    const sql = new DatabaseSync(DB);
    sql.prepare('INSERT INTO progress(user_id,lesson_id,done_at) VALUES(?,?,?)').run(1, lesson.id, Date.now());
    await owner.del('/api/admin/lessons/' + lesson.id);
    const bin = sql.prepare("SELECT * FROM deleted_rows WHERE reason='lesson.delete' ORDER BY id DESC LIMIT 2").all();
    check('deleting a lesson puts the lesson and members’ progress in the recycle bin (one batch)', bin.length === 2 && bin[0].batch && bin[0].batch === bin[1].batch && !sql.prepare('SELECT 1 FROM lessons WHERE id=?').get(lesson.id), bin);
    const rs = await owner.post('/api/admin/recycle-bin/restore', { batch: bin[0].batch });
    check('restore brings both back', rs.status === 200 && rs.data.restored === 2 && sql.prepare('SELECT 1 FROM lessons WHERE id=?').get(lesson.id) && sql.prepare('SELECT 1 FROM progress WHERE lesson_id=?').get(lesson.id), rs.data);
    const member = await login('bin-member@test.dev', 'Bin Member');
    check('recycle bin is owner only', (await member.get('/api/admin/recycle-bin')).status === 403 && (await owner.get('/api/admin/recycle-bin')).data.rows.length >= 0);
    await owner.del('/api/admin/courses/' + course.id);
    check('deleting a course goes to the bin too', sql.prepare("SELECT COUNT(*) n FROM deleted_rows WHERE reason='course.delete'").get().n === 3);
    const post = (await owner.post('/api/admin/posts', { title: 'Safety post', body: 'Hello' })).data.post;
    await owner.del('/api/admin/posts/' + post.id);
    check('deleting a blog post goes to the bin', !!sql.prepare("SELECT 1 FROM deleted_rows WHERE table_name='posts' AND row_id=?").get(String(post.id)));
    // Owner "reset content": old Academy content goes to the bin, progress follows each lesson that still exists.
    const pick = sql.prepare('SELECT l.id, l.title, c.slug FROM lessons l JOIN courses c ON c.id=l.course_id ORDER BY l.id DESC LIMIT 1').get();
    sql.prepare('INSERT OR IGNORE INTO progress(user_id,lesson_id,done_at) VALUES(?,?,?)').run(4242, pick.id, 1234567);
    const nLessons = sql.prepare('SELECT COUNT(*) n FROM lessons').get().n;
    check('reset content needs RESET', (await owner.post('/api/admin/reseed-content', {})).status === 400);
    const rr = await owner.post('/api/admin/reseed-content', { confirm: 'RESET' });
    const moved = sql.prepare('SELECT l.id FROM progress p JOIN lessons l ON l.id=p.lesson_id JOIN courses c ON c.id=l.course_id WHERE p.user_id=4242 AND c.slug=? AND l.title=? AND p.done_at=1234567').get(pick.slug, pick.title);
    const binned = sql.prepare("SELECT COUNT(*) n FROM deleted_rows WHERE reason='content.reseed' AND table_name='lessons'").get().n;
    check('reset content: old content in the bin, progress carried to the same lesson', rr.status === 200 && moved && binned === nLessons && sql.prepare('SELECT COUNT(*) n FROM progress WHERE user_id=4242').get().n === 1, { moved, binned, nLessons });
    sql.close();

    // Money and achievements are never hard-deleted anywhere in the code (they are voided, refunded or revoked instead).
    const KEEP = ['orders', 'payouts', 'price_locks', 'school_certificates', 'audit', 'schema_migrations', 'events', 'aff_commissions', 'aff_conversions', 'aff_payouts', 'aff_clawbacks', 'aff_audit', 'aff_receipts'];
    const hits = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.js')) { const s = fs.readFileSync(f, 'utf8'); for (const t of KEEP) if (new RegExp(`DELETE\\s+FROM\\s+${t}\\b`, 'i').test(s)) hits.push(`${path.relative(ROOT, f)}: ${t}`); } } };
    walk(path.join(ROOT, 'src'));
    check('no code hard-deletes orders, payouts, ledgers, certificates or the audit log', !hits.length, hits);
  }

  console.log('Safety: rollout flags');
  {
    const member = await login('flag-member@test.dev', 'Flag Member');
    const fl = (c) => c.get('/api/me').then((r) => r.data.flags || {});
    check('a new flag starts off for everyone', (await fl(member))['test-flag'] === false && (await fl(owner))['test-flag'] === false);
    check('members cannot change flags', (await member.put('/api/admin/flags', { key: 'test-flag', mode: 'on' })).status === 403);
    await owner.put('/api/admin/flags', { key: 'test-flag', mode: 'staff' });
    check('staff mode: the team sees it, members do not', (await fl(owner))['test-flag'] === true && (await fl(member))['test-flag'] === false);
    await owner.put('/api/admin/flags', { key: 'test-flag', mode: 'percent', percent: 100 });
    const p100 = (await fl(member))['test-flag'];
    await owner.put('/api/admin/flags', { key: 'test-flag', mode: 'percent', percent: 0 });
    check('percent mode: 100% reaches members, 0% only the team', p100 === true && (await fl(member))['test-flag'] === false && (await fl(owner))['test-flag'] === true);
    await owner.put('/api/admin/flags', { key: 'test-flag', mode: 'on' });
    check('on: everyone', (await fl(member))['test-flag'] === true);
    check('unknown flags are refused', (await owner.put('/api/admin/flags', { key: 'nope', mode: 'on' })).status === 404);
    await owner.put('/api/admin/flags', { key: 'test-flag', mode: 'off' });
  }

  console.log('Safety: /api/v1 contract (frozen shapes)');
  {
    const shapes = JSON.parse(fs.readFileSync(path.join(FIX, 'api-v1-shapes.json'), 'utf8'));
    const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
    const missing = (obj, shape, where) => Object.entries(shape).flatMap(([k, t]) => {
      if (k.startsWith('$')) return [];
      if (!obj || !(k in obj)) return [`${where}.${k} is missing`];
      if (typeof t === 'object') return typeOf(obj[k]) === 'array' ? (obj[k].length ? missing(obj[k][0], t, `${where}.${k}[0]`) : []) : missing(obj[k], t, `${where}.${k}`);
      return t.split('|').includes(typeOf(obj[k])) ? [] : [`${where}.${k} is ${typeOf(obj[k])}, the contract says ${t}`];
    });
    const prod = (await owner.get('/api/admin/products')).data.products[0];
    const key = (await owner.get('/api/admin/products/' + prod.id)).data.product.api_key;
    const api = async (method, p, body) => { const r = await fetch(BASE + p, { method, headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
    const me = (await owner.get('/api/me')).data.user;
    const ev = await api('POST', '/api/v1/events', { events: [{ event_id: 'shape-' + Date.now(), voo_id: me.voo_id, type: 'login', label: 'Shape check', value_usd: 0, a_field_from_the_future: { x: 1 } }], another_unknown: true });
    check('v1 events: unknown fields are ignored, response keeps its shape', ev.status === 200 && !missing(ev.data, shapes['POST /api/v1/events'], 'events').length, [ev.status, missing(ev.data, shapes['POST /api/v1/events'], 'events')]);
    const us = await api('GET', '/api/v1/users/' + me.voo_id);
    check('v1 users: response keeps its shape', us.status === 200 && !missing(us.data, shapes['GET /api/v1/users/:voo_id'], 'user').length, missing(us.data, shapes['GET /api/v1/users/:voo_id'], 'user'));
    const sm = await api('POST', '/api/v1/support/messages', { email: 'shape@test.dev', name: 'Shape', body: 'Contract check', subject: 'Shape', unknown_new_field: 1 });
    check('v1 support message: response keeps its shape', sm.status === 200 && !missing(sm.data, shapes['POST /api/v1/support/messages'], 'support').length, sm.data);
    const th = await api('GET', `/api/v1/support/tickets/${sm.data.ticket_id}/messages`);
    check('v1 support thread: response keeps its shape', th.status === 200 && !missing(th.data, shapes['GET /api/v1/support/tickets/:id/messages'], 'thread').length, missing(th.data, shapes['GET /api/v1/support/tickets/:id/messages'], 'thread'));
    const no = await fetch(BASE + '/api/v1/users/' + me.voo_id);
    const noBody = await no.json();
    check('v1 errors keep their shape (401 { error })', no.status === 401 && !missing(noBody, shapes['error'], 'error').length);
  }

  fs.rmSync(TMP, { recursive: true, force: true });
};
