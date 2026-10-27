'use strict';
/* Delete my account (App Store 5.1.1(v), Google Play) and the phone app's user agent (App Store 3.1.1).
 * Called from test/smoke.js with its helpers. src/account.js, public/js/app-pages.js, public/js/shared.js. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = async function accountDelete({ BASE, Client, check, owner, DB }) {
  const { DatabaseSync } = require('node:sqlite');
  const sql = (fn) => { const s = new DatabaseSync(DB); try { return fn(s); } finally { s.close(); } };
  const xf = () => ({ 'x-forwarded-for': `10.91.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (c, email, name) => { const s = await c.post('/api/auth/start', { email, name }, xf()); return c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf()); };

  console.log('Delete my account');
  {
    const email = 'leaving@test.dev';
    const mem = new Client();
    const first = (await login(mem, email, 'Leaving Member')).data.user;
    const uid = first.id;
    const other = new Client(); await login(other, 'staying@test.dev', 'Staying Member');

    // Their footprint: a community message, a paid order with its price lock, Academy progress and a certificate.
    const room = (await mem.get('/api/rooms')).data.rooms.find((r) => r.access === 'free' && r.unlocked && !r.read_only);
    const msg = (await mem.post(`/api/rooms/${room.id}/messages`, { body: 'Thanks everyone, great room' })).data.message;
    const certCode = 'DEL-TEST-' + uid;
    sql((s) => {
      s.prepare("INSERT INTO orders(ref,user_id,item_type,item_id,item_name,amount_usd,currency,amount,status,created_at,paid_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run('DELTEST' + uid, uid, 'premium', 0, 'VooSquare Premium', 20, 'USD', 20, 'paid', Date.now(), Date.now());
      s.prepare('INSERT OR REPLACE INTO price_locks(user_id,item_type,item_id,price_usd,period_days,item_name,features,locked_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(uid, 'premium', 0, 20, 30, 'VooSquare Premium', '[]', Date.now(), Date.now());
      const lesson = s.prepare('SELECT id FROM school_lessons ORDER BY id LIMIT 1').get();
      const school = s.prepare('SELECT id FROM school_schools ORDER BY id LIMIT 1').get();
      s.prepare('INSERT OR IGNORE INTO school_enrollments(user_id,school_id,started_at) VALUES(?,?,?)').run(uid, school.id, Date.now());
      s.prepare('INSERT OR IGNORE INTO school_progress(user_id,lesson_id,best_score,total,attempts,passed_at,last_at) VALUES(?,?,?,?,?,?,?)').run(uid, lesson.id, 3, 3, 1, Date.now(), Date.now());
      s.prepare("INSERT INTO school_certificates(user_id,school_id,code,name,title,issued_at,revoked_at) VALUES(?,?,?,?,?,?,0)").run(uid, school.id, certCode, 'Leaving Member', 'Certificate', Date.now());
    });
    const oldCookie = mem.cookie;

    // Guards: the x-vs header, the typed confirmation, owners and team members.
    const noCsrf = await fetch(BASE + '/api/me/delete', { method: 'POST', headers: { cookie: oldCookie, 'content-type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE' }) });
    check('delete account: needs the x-vs header', noCsrf.status === 403);
    check('delete account: needs a signed-in member', (await new Client().post('/api/me/delete', { confirm: 'DELETE' })).status === 401);
    check('delete account: a wrong confirmation is refused', (await mem.post('/api/me/delete', { confirm: 'delete me' })).status === 400 && (await mem.post('/api/me/delete', {})).status === 400);
    const ownDel = await owner.post('/api/me/delete', { confirm: 'DELETE' });
    check('delete account: the owner is refused with a clear message', ownDel.status === 403 && /owner/i.test(ownDel.data.error) && (await owner.get('/api/me/home')).status === 200);
    const staff = new Client(); const st = (await login(staff, 'del-staff@test.dev', 'Staff Person')).data.user;
    sql((s) => s.prepare(`UPDATE users SET perms='["support"]' WHERE id=?`).run(st.id));
    const stDel = await staff.post('/api/me/delete', { confirm: 'DELETE' });
    check('delete account: a team member is refused until removed from the team', stDel.status === 403 && /team/i.test(stDel.data.error) && (await staff.get('/api/me/delete')).data.can_delete === false, stDel);
    check('delete account: a member can delete (status check)', (await mem.get('/api/me/delete')).data.can_delete === true);

    const res = await mem.post('/api/me/delete', { confirm: 'DELETE' });
    check('delete account: a member deletes their own account', res.status === 200 && res.data.ok === true, res.data);
    const old = new Client(); old.cookie = oldCookie;
    check('delete account: the old session is dead (401)', (await old.get('/api/me/home')).status === 401 && !(await old.get('/api/me')).data.user);
    const row = sql((s) => s.prepare('SELECT * FROM users WHERE id=?').get(uid));
    check('delete account: personal data erased on the kept row', row && row.name === 'Deleted member' && row.email === `deleted-${uid}@deleted.invalid` && row.bio === '' && row.country === '' && row.avatar === '{}' && row.deleted_at > 0 && row.banned === 0, row);
    const left = sql((s) => ({
      sessions: s.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get(uid).n,
      queued: s.prepare("SELECT COUNT(*) n FROM email_queue WHERE (user_id=? OR to_email=?) AND status='queued'").get(uid, email).n,
      orders: s.prepare('SELECT COUNT(*) n FROM orders WHERE user_id=? AND status=?').get(uid, 'paid').n,
      locks: s.prepare('SELECT COUNT(*) n FROM price_locks WHERE user_id=?').get(uid).n,
      progress: s.prepare('SELECT COUNT(*) n FROM school_progress WHERE user_id=?').get(uid).n,
      enrol: s.prepare('SELECT COUNT(*) n FROM school_enrollments WHERE user_id=?').get(uid).n,
      cert: s.prepare('SELECT * FROM school_certificates WHERE code=?').get(certCode),
      msg: s.prepare('SELECT * FROM messages WHERE id=?').get(msg.id),
      audit: s.prepare("SELECT * FROM audit WHERE action='account.delete' AND user_id=?").get(uid),
    }));
    check('delete account: sessions and queued emails are gone', left.sessions === 0 && left.queued === 0, left);
    check('delete account: orders, payments and price locks are kept', left.orders === 1 && left.locks === 1, left);
    check('delete account: Academy progress and enrolments removed', left.progress === 0 && left.enrol === 0, left);
    check('delete account: the certificate is revoked, never deleted', left.cert && left.cert.revoked_at > 0 && left.cert.name === 'Deleted member', left.cert);
    check('delete account: an audit entry is written', !!left.audit && /orders and payments kept/.test(left.audit.detail));
    const msgs = (await other.get(`/api/rooms/${room.id}/messages`)).data.messages;
    const theirs = msgs.find((m) => m.id === msg.id);
    check('delete account: their message stays and shows "Deleted member"', left.msg && !left.msg.deleted && theirs && theirs.body === 'Thanks everyone, great room' && theirs.user && theirs.user.name === 'Deleted member', theirs);
    check('delete account: their member profile is gone', (await other.get('/api/members/' + uid)).status === 404);

    // The old email: the old account can never sign in again, and a new sign-up is a brand-new account.
    const again = new Client();
    const v = await login(again, email, 'Back Again');
    check('delete account: the same email signs up as a NEW account', v.status === 200 && v.data.isNew === true && v.data.user.id !== uid && v.data.user.email === email, v.data);
    check('delete account: the new account has none of the old data', (await again.get('/api/me/orders')).data.orders.length === 0);
    const dead = new Client(); const ds = await dead.post('/api/auth/start', { email: `deleted-${uid}@deleted.invalid` }, xf());
    const dv = ds.data.dev_code ? await dead.post('/api/auth/verify', { email: `deleted-${uid}@deleted.invalid`, code: ds.data.dev_code }, xf()) : { status: 403 };
    check('delete account: the anonymised address cannot sign in to the old account', dv.status === 403 && !dead.cookie, dv.data);

    // Admin: shows as Deleted, no crash.
    const ad = await owner.get('/api/admin/customers/' + uid);
    check('delete account: admin customer shows Deleted', ad.status === 200 && ad.data.customer.deleted === true && ad.data.customer.name === 'Deleted member' && ad.data.orders.length === 1, ad.data.customer);
    const list = await owner.get('/api/admin/customers?q=deleted-' + uid);
    check('delete account: admin customer list still loads', list.status === 200);
  }

  console.log('Delete my account: the public page');
  for (const p of ['/delete-account', '/account/delete', '/delete-account?site=academy']) {
    const r = await fetch(BASE + p); const t = await r.text();
    check(`GET ${p} → 200 with the steps`, r.status === 200 && /Delete your account/.test(t) && /Profile/.test(t) && /DELETE/.test(t) && /mailto:/.test(t) && /#profile\/delete/.test(decodeURIComponent(t)));
  }
  {
    const t = await (await fetch(BASE + '/delete-account?site=academy')).text();
    check('the academy host page sends members to /learn', /\/learn#profile\/delete/.test(decodeURIComponent(t)) && /Square<\/span> Academy<\/b>/.test(t));
  }

  console.log('Phone app: user agent');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'shared.js'), 'utf8');
    const m = /function nativeApp\(ua\) \{[\s\S]*?\n {2}\}/.exec(src);
    let fn = null; try { fn = m && vm.runInNewContext(`(${m[0]})`); } catch { fn = null; }
    const base = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
    const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check('app detection: iPhone app', !!fn && eq(fn(base + ' VooSquareApp/1.0 (ios)'), { app: true, platform: 'ios' }));
    check('app detection: Android app (any version)', !!fn && eq(fn('Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile Safari/537.36 VooSquareApp/1.2.3 (android)'), { app: true, platform: 'android' }));
    check('app detection: a normal browser is not the app', !!fn && eq(fn(base), { app: false, platform: '' }) && eq(fn(''), { app: false, platform: '' }) && eq(fn(undefined), { app: false, platform: '' }));
    const ua = (u) => ({ 'user-agent': u });
    const a = await (await fetch(BASE + '/app', { headers: ua(base) })).text();
    const b = await (await fetch(BASE + '/app', { headers: ua(base + ' VooSquareApp/1.0 (ios)') })).text();
    const s1 = await (await fetch(BASE + '/api/site', { headers: ua(base) })).json();
    const s2 = await (await fetch(BASE + '/api/site', { headers: ua(base + ' VooSquareApp/1.0 (ios)') })).json();
    check('server answers the same for the app and a browser (the app only changes the page in the browser)', a === b && JSON.stringify(s1.premium) === JSON.stringify(s2.premium));
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'shared.css'), 'utf8');
    const billing = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-billing.js'), 'utf8');
    const core = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app-core.js'), 'utf8');
    check('phone apps (iPhone and Android): Premium buy buttons and prices are hidden, checkout refuses', /html\.is-app a\.btn\[href="#premium"\]/.test(css) && /html\.is-app \.upsell-a/.test(css) && /const NO_SALES = !!\(VS\.native && VS\.native\.app\)/.test(core) && /if \(A\.NO_SALES\)[\s\S]{0,40}A\.modal/.test(billing) && /if \(A\.NO_SALES\) return premiumNoSales/.test(billing));
  }
};
