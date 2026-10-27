'use strict';
/* Community safety for the app stores (Apple 1.2, Google Play UGC): report a message, auto-hide after 3 reporters, the
 * admin Reports queue (remove, dismiss, ban) with audit lines, blocking members (server-side filtering, live updates),
 * and the App review sign-in (admin setting and REVIEW_LOGIN_* env). Called from test/smoke.js with its helpers.
 * src/ugc.js, src/routes/app.js, src/migrations/013-ugc-reports-and-blocks.js. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function ugcSafety({ BASE, Client, check, owner, DB }) {
  const { DatabaseSync } = require('node:sqlite');
  const sql = (fn) => { const s = new DatabaseSync(DB); try { return fn(s); } finally { s.close(); } };
  const xf = () => ({ 'x-forwarded-for': `10.93.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (c, email, name) => { const s = await c.post('/api/auth/start', { email, name }, xf()); return (await c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf())).data.user; };
  const member = async (email, name) => { const c = new Client(); c.user = await login(c, email, name); return c; };
  const audits = (action) => sql((s) => s.prepare('SELECT * FROM audit WHERE action=? ORDER BY id').all(action).map((r) => ({ ...r })));
  const msgsFor = async (c, roomId) => (await c.get(`/api/rooms/${roomId}/messages`)).data.messages;
  const find = (list, id) => (list || []).find((m) => m.id === id);

  console.log('Report a message');
  const author = await member('ugc-author@test.dev', 'Uche Author');
  const r1 = await member('ugc-r1@test.dev', 'Ruth One');
  const r2 = await member('ugc-r2@test.dev', 'Rex Two');
  const r3 = await member('ugc-r3@test.dev', 'Rita Three');
  const other = await member('ugc-other@test.dev', 'Olu Other');
  const mod = await member('ugc-mod@test.dev', 'Mona Mod');
  const agent = await member('ugc-agent@test.dev', 'Ayo Agent');
  sql((s) => { s.prepare(`UPDATE users SET perms='["community"]', role_title='Moderator' WHERE id=?`).run(mod.user.id); s.prepare(`UPDATE users SET perms='["support"]' WHERE id=?`).run(agent.user.id); });
  const room = (await author.get('/api/rooms')).data.rooms.find((x) => x.access === 'free' && x.unlocked && x.can_post && !x.slow_secs);
  const post = async (c, body) => (await c.post(`/api/rooms/${room.id}/messages`, { body }, xf())).data.message;
  const m1 = await post(author, 'Cheap followers here, DM me now');

  check('report: needs a signed-in member (401)', (await new Client().post(`/api/messages/${m1.id}/report`, { reason: 'spam' })).status === 401);
  const noCsrf = await fetch(`${BASE}/api/messages/${m1.id}/report`, { method: 'POST', headers: { cookie: r1.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'spam' }) });
  check('report: needs the x-vs header (403)', noCsrf.status === 403);
  const own = await author.post(`/api/messages/${m1.id}/report`, { reason: 'spam' });
  check('report: your own message is refused', own.status === 400 && /own message/i.test(own.data.error), own.data);
  check('report: a reason from the list is required', (await r1.post(`/api/messages/${m1.id}/report`, { reason: 'boring' })).status === 400);
  check('report: unknown message is 404', (await r1.post('/api/messages/99999999/report', { reason: 'spam' })).status === 404);
  const rep1 = await r1.post(`/api/messages/${m1.id}/report`, { reason: 'spam', note: 'x'.repeat(700) });
  check('report: a member reports someone else\'s message', rep1.status === 200 && rep1.data.ok === true && rep1.data.already === false, rep1.data);
  check('report: the note is kept to 500 characters', sql((s) => s.prepare('SELECT note FROM message_reports WHERE message_id=? AND reporter_id=?').get(m1.id, r1.user.id).note.length) === 500);
  const again = await r1.post(`/api/messages/${m1.id}/report`, { reason: 'harassment' });
  check('report: reporting twice says "already reported" and adds nothing', again.status === 200 && again.data.already === true && /already reported/i.test(again.data.message) && sql((s) => s.prepare('SELECT COUNT(*) n FROM message_reports WHERE message_id=?').get(m1.id).n) === 1, again.data);
  const seenR1 = find(await msgsFor(r1, room.id), m1.id);
  check('report: hidden for the reporter at once (body and photo removed)', seenR1 && seenR1.hidden === 'reported' && seenR1.body === '' && !seenR1.attachment, seenR1);
  check('report: one report does not hide it from others', find(await msgsFor(other, room.id), m1.id).body === 'Cheap followers here, DM me now');

  await r2.post(`/api/messages/${m1.id}/report`, { reason: 'spam' });
  check('report: two reporters, still visible to others', !find(await msgsFor(other, room.id), m1.id).hidden);
  await r3.post(`/api/messages/${m1.id}/report`, { reason: 'illegal', note: 'Selling fake accounts' });
  const forOther = find(await msgsFor(other, room.id), m1.id);
  check('report: 3 different members hide it from everyone else', forOther && forOther.hidden === 'review' && forOther.body === '' && sql((s) => s.prepare('SELECT hidden FROM messages WHERE id=?').get(m1.id).hidden) === 1, forOther);
  const forMod = find(await msgsFor(mod, room.id), m1.id);
  const forOwner = find(await msgsFor(owner, room.id), m1.id);
  check('report: the team still sees it, marked in review', forMod && !forMod.hidden && forMod.in_review === true && forMod.body.startsWith('Cheap') && forOwner && forOwner.in_review === true, forMod);
  check('report: the author sees it is hidden for review too', find(await msgsFor(author, room.id), m1.id).hidden === 'review');
  check('report: a hidden message is not the room preview for others', (((await other.get('/api/rooms')).data.rooms.find((x) => x.id === room.id) || {}).last || {}).body !== 'Cheap followers here, DM me now');

  console.log('Admin: Reports');
  check('reports: members cannot see them (403)', (await other.get('/api/admin/reports')).status === 403);
  check('reports: a team member without the community permission cannot (403)', (await agent.get('/api/admin/reports')).status === 403);
  const list = await mod.get('/api/admin/reports');
  const g = (list.data.groups || []).find((x) => x.message_id === m1.id);
  check('reports: the queue groups reports by message (text, author, room, reasons, count)', list.status === 200 && g && g.count === 3 && g.message.body.startsWith('Cheap') && g.message.hidden === true && g.author.id === author.user.id && g.room.id === room.id && g.reasons[0].reason === 'spam' && g.reasons[0].n === 2 && g.reports.some((r) => r.note === 'Selling fake accounts'), g);
  check('reports: the open count for the nav badge', (await owner.get('/api/admin/reports?count=1')).data.open >= 1);
  const dis = await mod.post(`/api/admin/reports/${m1.id}/dismiss`);
  check('reports: dismiss closes the reports and shows the message again', dis.status === 200 && sql((s) => s.prepare('SELECT hidden FROM messages WHERE id=?').get(m1.id).hidden) === 0 && sql((s) => s.prepare("SELECT COUNT(*) n FROM message_reports WHERE message_id=? AND status='dismissed' AND handled_by=?").get(m1.id, mod.user.id).n) === 3 && !find(await msgsFor(other, room.id), m1.id).hidden);
  check('reports: a reporter keeps it hidden for themselves after a dismissal', find(await msgsFor(r1, room.id), m1.id).hidden === 'reported');
  check('reports: dismiss writes an audit line', audits('report.dismiss').some((a) => a.user_id === mod.user.id && a.detail.includes('#' + m1.id)));
  check('reports: handling twice says it was already handled (409)', (await mod.post(`/api/admin/reports/${m1.id}/dismiss`)).status === 409);
  check('reports: handled ones are listed under Handled', ((await mod.get('/api/admin/reports?status=handled')).data.groups || []).some((x) => x.message_id === m1.id && x.action === 'dismissed'));
  check('reports: members cannot dismiss (403)', (await other.post(`/api/admin/reports/${m1.id}/dismiss`)).status === 403);

  const m2 = await post(author, 'Another rude message');
  await r1.post(`/api/messages/${m2.id}/report`, { reason: 'harassment' });
  check('reports: members cannot remove (403)', (await other.post(`/api/admin/reports/${m2.id}/remove`)).status === 403);
  const rm = await mod.post(`/api/admin/reports/${m2.id}/remove`);
  check('reports: remove deletes the message for everyone and closes the reports', rm.status === 200 && sql((s) => s.prepare('SELECT deleted FROM messages WHERE id=?').get(m2.id).deleted) === 1 && find(await msgsFor(other, room.id), m2.id).deleted === true && sql((s) => s.prepare("SELECT action FROM message_reports WHERE message_id=?").get(m2.id).action) === 'removed');
  check('reports: remove writes an audit line', audits('report.remove').some((a) => a.detail.includes('#' + m2.id)));

  const bad = await member('ugc-bad@test.dev', 'Bayo Bad');
  const m3 = await post(bad, 'Scam link http://example.test');
  await r2.post(`/api/messages/${m3.id}/report`, { reason: 'spam' });
  const ban = await owner.post(`/api/admin/reports/${m3.id}/ban`);
  const badRow = sql((s) => s.prepare('SELECT banned FROM users WHERE id=?').get(bad.user.id));
  check('reports: ban the author (banned, signed out, message removed)', ban.status === 200 && badRow.banned === 1 && (await bad.get('/api/me/home')).status === 401 && sql((s) => s.prepare('SELECT deleted FROM messages WHERE id=?').get(m3.id).deleted) === 1, ban.data);
  check('reports: ban writes an audit line', audits('report.ban').some((a) => a.detail.includes('ugc-bad@test.dev')));
  const ms = await post(mod, 'Welcome everyone, read the rules');
  for (const c of [r1, r2, r3]) await c.post(`/api/messages/${ms.id}/report`, { reason: 'other' });
  check('reports: a team member\'s message is never auto-hidden', !find(await msgsFor(other, room.id), ms.id).hidden);
  const banStaff = await owner.post(`/api/admin/reports/${ms.id}/ban`);
  check('reports: a team member cannot be banned from Reports', banStaff.status === 400 && /team/i.test(banStaff.data.error));
  await owner.post(`/api/admin/reports/${ms.id}/dismiss`);

  // Report rate limit: 20 an hour per member.
  {
    const spam = await member('ugc-limit@test.dev', 'Lim It');
    const many = sql((s) => Array.from({ length: 21 }, (_, i) => ({ id: Number(s.prepare('INSERT INTO messages(room_id,user_id,body,created_at) VALUES(?,?,?,?)').run(room.id, author.user.id, 'msg ' + i, Date.now()).lastInsertRowid) })));
    let last = null;
    for (const x of many) last = await spam.post(`/api/messages/${x.id}/report`, { reason: 'spam' });
    check('report: rate limited (20 an hour per member)', last.status === 429);
  }

  console.log('Block a member');
  const mb = await post(author, 'Message from the author to block');
  check('block: needs a signed-in member', (await new Client().post('/api/blocks', { user_id: author.user.id })).status === 401);
  const self = await r1.post('/api/blocks', { user_id: r1.user.id });
  check('block: cannot block yourself', self.status === 400 && /yourself/i.test(self.data.error));
  const st1 = await r1.post('/api/blocks', { user_id: owner.user ? owner.user.id : sql((s) => s.prepare("SELECT id FROM users WHERE email='owner@test.dev'").get().id) });
  const st2 = await r1.post('/api/blocks', { user_id: mod.user.id });
  check('block: cannot block the team (owner or moderator)', st1.status === 400 && st2.status === 400 && /team/i.test(st2.data.error), [st1.data, st2.data]);
  check('block: unknown member is 404', (await r1.post('/api/blocks', { user_id: 99999999 })).status === 404);
  const bl = await r1.post('/api/blocks', { user_id: author.user.id });
  check('block: a member blocks another member', bl.status === 200 && bl.data.blocked.id === author.user.id);
  check('block: blocking twice is fine', (await r1.post('/api/blocks', { user_id: author.user.id })).status === 200 && sql((s) => s.prepare('SELECT COUNT(*) n FROM member_blocks WHERE blocker_id=?').get(r1.user.id).n) === 1);
  const r1msgs = await msgsFor(r1, room.id);
  check('block: GET messages leaves out the blocked member for the blocker (server side)', !r1msgs.some((x) => x.user.id === author.user.id) && r1msgs.length > 0);
  check('block: others still see their messages', !!find(await msgsFor(r2, room.id), mb.id));
  check('block: the member card says blocked', (await r1.get('/api/members/' + author.user.id)).data.member.blocked === true && (await r2.get('/api/members/' + author.user.id)).data.member.blocked === false);
  const lst = await r1.get('/api/blocks');
  check('block: the blocked list shows them', lst.status === 200 && lst.data.blocks.length === 1 && lst.data.blocks[0].id === author.user.id && lst.data.blocks[0].blocked_at > 0);
  check('block: the room preview skips the blocked member', (((await r1.get('/api/rooms')).data.rooms.find((x) => x.id === room.id) || {}).last || {}).user_id !== author.user.id);
  // Live updates: a new message from the blocked member never reaches the blocker's stream.
  {
    const open = async (c) => {
      const ctl = new AbortController();
      const res = await fetch(`${BASE}/api/stream?ch=room:${room.id}`, { headers: { cookie: c.cookie }, signal: ctl.signal });
      const st = { text: '', close: () => ctl.abort() };
      const reader = res.body.getReader(); const dec = new TextDecoder();
      (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; st.text += dec.decode(value, { stream: true }); } } catch { /* closed */ } })();
      for (let i = 0; i < 50 && !st.text.includes('event: ready'); i++) await sleep(40);
      return st;
    };
    const s1 = await open(r1); const s2 = await open(r2);
    const live = await post(author, 'Live from the blocked author');
    for (let i = 0; i < 50 && !s2.text.includes(live.body); i++) await sleep(40);
    await sleep(150);
    check('block: live updates skip the blocker, reach everyone else', s2.text.includes('Live from the blocked author') && !s1.text.includes('Live from the blocked author'));
    s1.close(); s2.close();
  }
  const ub = await r1.del('/api/blocks/' + author.user.id);
  check('block: unblock restores their messages', ub.status === 200 && !!find(await msgsFor(r1, room.id), mb.id) && (await r1.get('/api/blocks')).data.blocks.length === 0);

  console.log('App review sign-in');
  const REV = 'app-review@test.dev';
  const verify = (c, email, code) => c.post('/api/auth/verify', { email, code }, xf());
  check('review: off by default', (await owner.get('/api/admin/review-login')).data.review.enabled === false);
  check('review: off → a fixed code is refused', (await verify(new Client(), REV, '246810')).status === 400);
  check('review: only an owner can see or change it', (await mod.get('/api/admin/review-login')).status === 403 && (await mod.put('/api/admin/review-login', { enabled: true, email: REV, code: '246810' })).status === 403 && (await other.get('/api/admin/review-login')).status === 403);
  const ownerSave = await owner.put('/api/admin/review-login', { enabled: true, email: 'owner@test.dev', code: '246810' });
  const staffSave = await owner.put('/api/admin/review-login', { enabled: true, email: 'ugc-mod@test.dev', code: '246810' });
  check('review: the owner\'s or a team member\'s email is refused at save', ownerSave.status === 400 && staffSave.status === 400 && /team member/i.test(staffSave.data.error), [ownerSave.data, staffSave.data]);
  check('review: the code must be 6 digits', (await owner.put('/api/admin/review-login', { enabled: true, email: REV, code: '12ab' })).status === 400 && (await owner.put('/api/admin/review-login', { enabled: true, email: REV })).status === 400);
  const saved = await owner.put('/api/admin/review-login', { enabled: true, email: REV, code: '246810' });
  check('review: saved, and the code is never sent back', saved.status === 200 && saved.data.review.enabled === true && saved.data.review.has_code === true && !JSON.stringify(saved.data).includes('246810') && !JSON.stringify((await owner.get('/api/admin/review-login')).data).includes('246810'));
  check('review: the code is stored hashed', !sql((s) => s.prepare("SELECT value FROM settings WHERE key='review_login'").get().value).includes('246810'));
  const ra = audits('settings.review_login');
  check('review: changes are audited (never with the code)', ra.length >= 1 && ra[ra.length - 1].detail.includes(REV) && !ra.some((a) => a.detail.includes('246810')));
  check('review: a wrong code is refused', (await verify(new Client(), REV, '111111')).status === 400);
  check('review: the fixed code does not work for other emails', (await verify(new Client(), 'someone-else@test.dev', '246810')).status === 400);
  const rc = new Client();
  const rv = await verify(rc, REV, '246810');
  check('review: that email + code signs in and creates a free member named App Review', rv.status === 200 && rv.data.isNew === true && rv.data.user.name === 'App Review' && rv.data.user.perms.length === 0 && !rv.data.user.premium && (await rc.get('/api/me/home')).status === 200, rv.data);
  check('review: it works again (fixed, not one-time)', (await verify(new Client(), REV, '246810')).status === 200);
  {
    const c = new Client(); const s = await c.post('/api/auth/start', { email: REV }, xf());
    check('review: normal email codes still work for it', (await verify(c, REV, s.data.dev_code)).status === 200);
  }
  check('review: keeping the saved code when only switching it off and on', (await owner.put('/api/admin/review-login', { enabled: true, email: REV })).status === 200 && (await verify(new Client(), REV, '246810')).status === 200);
  check('review: a new email needs the code typed again', (await owner.put('/api/admin/review-login', { enabled: true, email: 'app-review2@test.dev' })).status === 400);
  // The account later joins the team: the fixed code stops working for it.
  sql((s) => s.prepare(`UPDATE users SET perms='["support"]' WHERE email=?`).run(REV));
  check('review: never for a team member, even if saved earlier', (await verify(new Client(), REV, '246810')).status === 400);
  sql((s) => s.prepare(`UPDATE users SET perms='[]' WHERE email=?`).run(REV));
  await owner.put('/api/admin/review-login', { enabled: false, email: REV });
  check('review: switched off → the fixed code is refused again', (await verify(new Client(), REV, '246810')).status === 400);

  // REVIEW_LOGIN_EMAIL / REVIEW_LOGIN_CODE: their own server and database (env wins over the admin setting).
  {
    const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
    const port = await freePort();
    const dir = path.join(os.tmpdir(), `voosquare-ugc-env-${process.pid}`);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
      cwd: path.join(__dirname, '..'), stdio: 'ignore',
      env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(dir, 'vs.db'), UPLOADS_DIR: path.join(dir, 'up'), BACKUPS_DIR: path.join(dir, 'bk'), VOICE_DIR: path.join(dir, 'voice'), SCHOOL_EXTRA_DIR: '', OWNER_EMAIL: 'boss@env.test', NODE_ENV: 'test', EMAIL_PROVIDER: '', AFF_JOBS: 'off', BASE_URL: '', RAILWAY_ENVIRONMENT: '', RAILWAY_PUBLIC_DOMAIN: '', REVIEW_LOGIN_EMAIL: 'Reviewer@Env.test', REVIEW_LOGIN_CODE: '135790' },
    });
    const base = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 150 && !up; i++) { try { up = (await fetch(base + '/healthz')).ok; } catch { /* starting */ } if (!up) await sleep(100); }
    const vf = (email, code) => fetch(base + '/api/auth/verify', { method: 'POST', headers: { 'x-vs': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email, code }) });
    const ok = up ? await vf('reviewer@env.test', '135790') : null;
    const okBody = ok ? await ok.json() : {};
    const wrong = up ? (await vf('reviewer@env.test', '135791')).status : 0;
    const otherEmail = up ? (await vf('nobody@env.test', '135790')).status : 0;
    check('review env: REVIEW_LOGIN_EMAIL + REVIEW_LOGIN_CODE sign in (no admin setting needed)', up && ok.status === 200 && okBody.user && okBody.user.name === 'App Review' && okBody.user.perms.length === 0, okBody);
    check('review env: wrong code and other emails are refused', wrong === 400 && otherEmail === 400, [wrong, otherEmail]);
    srv.kill('SIGTERM');
    await new Promise((r) => srv.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
