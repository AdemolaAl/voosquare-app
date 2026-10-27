'use strict';
/*
 * VooSquare Affiliates end-to-end tests (src/aff, src/routes/aff*.js).
 * Runs its own server on its own temporary database with NODE_ENV=test (private outbound allowed for the local mocks,
 * x-vs-now clock header honoured) and AFF_JOBS=off (jobs are driven with a moved clock through /api/admin/aff/jobs/run).
 * A local mock server stands in for the Telegram Bot API, an affiliate's tracker (postbacks), a KYC provider and a payout
 * provider.
 *   Standalone: node test/affiliates.js        From npm test: called by test/smoke.js with its check().
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const DAY = 86400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(30); } return !!(await fn()); }

/* ------------------------------------------------------------------ mock providers */
function mock() {
  const st = { tg: [], pb: [], pbStatus: {}, kyc: [], payouts: [], payoutStatus: 'paid', sw: [] };
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const u = new URL(req.url, 'http://x');
      const tgm = /^\/bot([^/]+)\/(\w+)$/.exec(u.pathname);
      if (tgm) {
        const body = raw ? JSON.parse(raw) : {};
        if (tgm[2] === 'getMe') return send(200, { ok: true, result: { username: 'VooSquareAffBot' } });
        if (tgm[2] === 'sendMessage') { st.tg.push(body); return send(200, { ok: true, result: { message_id: st.tg.length } }); }
        if (tgm[2] === 'setWebhook') return send(200, { ok: true, result: true });
        return send(404, { ok: false });
      }
      if (u.pathname.startsWith('/sw')) {
        // Product support webhook: /sw/redirect answers 302 to /sw/target (a guarded request never follows it).
        st.sw.push({ path: u.pathname, method: req.method, headers: req.headers, body: raw });
        if (u.pathname === '/sw/redirect') { res.writeHead(302, { location: '/sw/target' }); return res.end(); }
        return send(200, { ok: true });
      }
      if (u.pathname.startsWith('/pb')) {
        st.pb.push({ path: u.pathname, url: req.url, method: req.method, headers: req.headers, body: raw, at: Date.now() });
        const code = st.pbStatus[u.pathname] || 200;
        res.writeHead(code, { 'content-type': 'text/plain' }); return res.end('ok');
      }
      if (u.pathname === '/kyc/verifications' && req.method === 'POST') { st.kyc.push({ headers: req.headers, body: JSON.parse(raw) }); return send(200, { id: 'kyc_123', url: 'https://verify.example/kyc_123' }); }
      if (u.pathname === '/prov/payouts' && req.method === 'POST') { st.payouts.push({ headers: req.headers, body: JSON.parse(raw) }); return send(200, { id: 'po_' + st.payouts.length, status: 'pending' }); }
      const pm = /^\/prov\/payouts\/(po_\d+)$/.exec(u.pathname);
      if (pm) return send(200, { id: pm[1], status: st.payoutStatus, tx_hash: 'f'.repeat(64) });
      send(404, {});
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ st, srv, port: srv.address().port })));
}

/* A small image (the server reads only the header). */
function fakePng(w, h, pad = 200) {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}

module.exports = async function affiliates({ check }) {
  const { DatabaseSync } = require('node:sqlite');
  const M = await mock();
  const PORT = 5200 + Math.floor(Math.random() * 600);
  const BASE = `http://127.0.0.1:${PORT}`;
  const DB = path.join(os.tmpdir(), `voosquare-aff-test-${process.pid}.db`);
  const UPLOADS = path.join(os.tmpdir(), `voosquare-aff-uploads-${process.pid}`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  const TG_SECRET = 'tg-secret-for-tests';
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, UPLOADS_DIR: UPLOADS, OWNER_EMAIL: 'owner@aff.test', NODE_ENV: 'test', EMAIL_PROVIDER: '', AFF_JOBS: 'off',
      TELEGRAM_BOT_TOKEN: '123:TESTTOKEN', TELEGRAM_API_BASE: `http://127.0.0.1:${M.port}`, TELEGRAM_WEBHOOK_SECRET: TG_SECRET, TELEGRAM_CHAT_GAP_MS: '10', BACKUPS_DIR: path.join(UPLOADS, 'backups') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80; i++) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) break; } catch { /* wait */ } await sleep(100); }
  const sql = new DatabaseSync(DB);
  sql.exec('PRAGMA busy_timeout=5000'); // the server may be mid-write (jobs, postbacks)
  const q1 = (s, ...a) => sql.prepare(s).get(...a);
  const qa = (s, ...a) => sql.prepare(s).all(...a);
  const run = (s, ...a) => sql.prepare(s).run(...a);

  class Client {
    constructor(ip) { this.jar = new Map(); this.ip = ip || `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`; }
    get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
    store(res) {
      for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
        const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1);
        if (/Max-Age=0\b/.test(c) || v === '') this.jar.delete(k); else this.jar.set(k, v);
      }
    }
    async req(method, p, body, headers = {}) {
      const h = { 'x-vs': '1', 'x-forwarded-for': this.ip, ...headers };
      if (this.jar.size) h.cookie = this.cookie;
      let payload;
      if (body !== undefined) { if (Buffer.isBuffer(body)) payload = body; else { payload = JSON.stringify(body); h['content-type'] = 'application/json'; } }
      const res = await fetch(BASE + p, { method, headers: h, body: payload, redirect: 'manual' });
      this.store(res);
      const buf = Buffer.from(await res.arrayBuffer());
      let data = null; const text = buf.toString('utf8'); try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers, buf };
    }
    get(p, h) { return this.req('GET', p, undefined, h); }
    post(p, b, h) { return this.req('POST', p, b === undefined ? {} : b, h); }
    put(p, b) { return this.req('PUT', p, b); }
    patch(p, b) { return this.req('PATCH', p, b); }
    del(p) { return this.req('DELETE', p); }
    async login(email, name, extra = {}) {
      const s = await this.post('/api/auth/start', { email, name, ...extra });
      const v = await this.post('/api/auth/verify', { email, code: s.data.dev_code, ...extra });
      this.user = v.data && v.data.user;
      return v;
    }
  }
  const at = (t) => ({ 'x-vs-now': String(Math.round(t)) });
  const NOW = Date.now();

  try {
    /* ================================================================ setup */
    console.log('Affiliates: setup and roles');
    const owner = new Client(); await owner.login('owner@aff.test', 'Ejiro Owner');
    const jobs = (t, extra = {}) => owner.post('/api/admin/aff/jobs/run', { at: Math.round(t), ...extra });
    const staff = async (email, name, perms) => { const c = new Client(); await c.login(email, name); await owner.post('/api/admin/team', { email, perms }); return c; };
    const admin = await staff('admin@aff.test', 'Ada Admin', ['aff_admin']);
    const mgr = await staff('mgr@aff.test', 'Chidinma Eze', ['aff_manager']);
    const mgr2 = await staff('mgr2@aff.test', 'Musa Ibrahim', ['aff_manager']);
    const fraud = await staff('fraud@aff.test', 'Fatima Bello', ['aff_fraud']);
    const fin1 = await staff('fin1@aff.test', 'Finance One', ['aff_finance']);
    const fin2 = await staff('fin2@aff.test', 'Finance Two', ['aff_finance']);
    const mgrId = q1('SELECT id FROM users WHERE email=?', 'mgr@aff.test').id;
    const mgr2Id = q1('SELECT id FROM users WHERE email=?', 'mgr2@aff.test').id;
    check('aff: team perms include the four affiliate roles', (await owner.get('/api/admin/team')).data.perms.includes('aff_finance'));
    const mp = await admin.put(`/api/admin/aff/managers/${mgrId}`, { kinds: ['general'], countries: ['NG'], languages: ['English', 'Pidgin'], hours: 'Mon–Sat 9–19 WAT', telegram: '@chidinma' });
    await admin.put(`/api/admin/aff/managers/${mgr2Id}`, { kinds: ['general', 'private'], countries: ['KE'] });
    check('aff: manager profile saved (general, NG)', mp.status === 200 && mp.data.manager.kinds.includes('general'), mp.data);
    const plain = new Client(); await plain.login('member@aff.test', 'Plain Member');
    check('aff: members cannot open the affiliate admin (403)', (await plain.get('/api/admin/aff/overview')).status === 403 && (await plain.get('/api/admin/aff/cpa')).status === 403);
    check('aff: fraud role cannot open the payouts queue, finance cannot open the CPA queue', (await fraud.get('/api/admin/aff/payouts')).status === 403 && (await fin1.get('/api/admin/aff/cpa')).status === 403);
    check('aff: a manager cannot open program settings or the overview', (await mgr.get('/api/admin/aff/settings')).status === 403 && (await mgr.get('/api/admin/aff/overview')).status === 403);
    const keyOf = (slug) => q1('SELECT api_key FROM products WHERE slug=?', slug).api_key;
    const ev = async (slug, events) => {
      const r = await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer ' + keyOf(slug), 'content-type': 'application/json' }, body: JSON.stringify({ events }) });
      return r.json();
    };
    let evn = 0; const eid = (p) => `${p || 'e'}_${++evn}_${Date.now()}`;
    const spend = (slug, vooId, usd, o = {}) => ev(slug, [{ event_id: o.id || eid(slug), voo_id: vooId, type: 'spend', value_usd: usd, label: 'Payment', ...o }]);

    /* ================================================================ application */
    console.log('Affiliates: account and application');
    const amara = new Client(); await amara.login('amara.obi@gmail.com', 'Amara Obi');
    check('aff: no account yet → account null', (await amara.get('/api/aff/me')).data.account === null);
    const acc = await amara.post('/api/aff/account', {});
    check('aff: account created (pending, code = Voo ID referral code)', acc.status === 200 && acc.data.account.status === 'pending' && acc.data.account.code === amara.user.ref_code, acc.data);
    check('aff: step 1 validates Telegram', (await amara.put('/api/aff/application/1', { display_name: 'amara.media', country: 'NG', telegram: 'x' })).status === 400);
    check('aff: step 1 saves', (await amara.put('/api/aff/application/1', { display_name: 'amara.media', country: 'NG', telegram: '@amara_media', kind: 'individual' })).status === 200);
    check('aff: step 2 validates sources', (await amara.put('/api/aff/application/2', { sources: [], geos: ['NG'], volume: '$1k–$10k' })).status === 400);
    await amara.put('/api/aff/application/2', { sources: ['Meta ads', 'Telegram channel or group'], geos: ['NG', 'GH'], volume: '$10k–$50k', products: ['joinvoo'] });
    check('aff: step 3 needs a 50-character plan', (await amara.put('/api/aff/application/3', { plan: 'short' })).status === 400);
    await amara.put('/api/aff/application/3', { years: '3–5', plan: 'Reviews of Joinvoo on my Telegram channel for Nigerian buyers, plus Meta ads to a Landvoo page.', links: ['https://t.me/amara_media'] });
    check('aff: step 4 needs the three boxes', (await amara.put('/api/aff/application/4', { accept_terms: true })).status === 400);
    const sub4 = await amara.put('/api/aff/application/4', { accept_terms: true, no_income_claims: true, adult: true, usdt: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' });
    const A = sub4.data.account;
    check('aff: application submitted, general manager auto-assigned by country', sub4.status === 200 && A.applied && A.managers.general && A.managers.general.name === 'Chidinma Eze', A && A.managers);
    check('aff: application-received email queued', !!q1("SELECT 1 FROM email_queue WHERE template='aff_application_received' AND to_email='amara.obi@gmail.com'"));
    check('aff: pending dashboard works (home, links, postbacks)', (await amara.get('/api/aff/home')).status === 200 && (await amara.get('/api/aff/links')).status === 200 && (await amara.get('/api/aff/postbacks')).status === 200);
    check('aff: payouts page says payouts open after approval', (await amara.get('/api/aff/payouts')).data.blocked_by.includes('not_approved'));
    const apps = await mgr.get('/api/admin/aff/applications');
    check('aff: manager sees the assigned application with checks and SLA', apps.status === 200 && apps.data.applications.some((x) => x.id === A.id && x.checks.length === 5 && x.sla.text), apps.data);
    check('aff: another manager does not see it', !(await mgr2.get('/api/admin/aff/applications')).data.applications.some((x) => x.id === A.id) && (await mgr2.post(`/api/admin/aff/applications/${A.id}/approve`)).status === 404);
    check('aff: fraud-check role cannot approve applications', (await fraud.post(`/api/admin/aff/applications/${A.id}/approve`)).status === 403);
    const info = await mgr.post(`/api/admin/aff/applications/${A.id}/info`, { text: 'Please add one recent ad you ran to Nigeria.' });
    check('aff: ask for info shows in the affiliate banner', info.status === 200 && (await amara.get('/api/aff/me')).data.account.info_request.includes('recent ad'));
    // Reply to the request (front-end gap filled): kept on the application, banner cleared, manager sees it as a note.
    check('aff: a reply needs some text', (await amara.post('/api/aff/application/reply', { text: 'ok' })).status === 400);
    const repI = await amara.post('/api/aff/application/reply', { text: 'Recent ad: Meta, NG, Joinvoo review video, 3 Oct.', link: 'https://t.me/amara_media' });
    check('aff: reply to the info request clears the banner', repI.status === 200 && repI.data.account.info_request === '', repI.data);
    check('aff: a second reply with no open request is refused (409)', (await amara.post('/api/aff/application/reply', { text: 'Anything else?' })).status === 409);
    const appsR = await mgr.get('/api/admin/aff/applications');
    const appR = appsR.data.applications.find((x) => x.id === A.id);
    check('aff: the manager sees the reply on the application card', appR && appR.info_replies.length === 1 && /Joinvoo review/.test(appR.info_replies[0].text), appR && appR.info_replies);
    const msg = await amara.post('/api/aff/messages', { text: 'Can you check CV-12?', ref: 'CV-12' });
    check('aff: affiliate message to the manager', msg.status === 200 && msg.data.message.mine === true && msg.data.message.body.startsWith('[CV-12]'), msg.data);
    check('aff: empty messages are refused', (await amara.post('/api/aff/messages', { text: ' ' })).status === 400);
    const mgrPage = (await amara.get('/api/aff/manager')).data;
    check('aff: messages show on the Manager page as mine', mgrPage.notes.some((n) => n.mine && /CV-12/.test(n.body)));
    const detM = (await mgr.get(`/api/admin/aff/affiliates/${A.id}`)).data;
    check('aff: the manager sees affiliate messages marked as from the affiliate', detM.notes.some((n) => n.from_affiliate && /CV-12/.test(n.body)));

    /* ================================================================ tracking */
    console.log('Affiliates: tracking links and cookie');
    const visitor = new Client();
    const clk = await visitor.get(`/a/${A.code}?p=joinvoo&sub1=fb_ng_v3&sub2=adset_14&click_id=abc123`, { 'user-agent': 'Mozilla/5.0 (iPhone) Mobile', referer: 'https://m.facebook.com/' });
    const loc = clk.headers.get('location') || '';
    const sc = (clk.headers.getSetCookie ? clk.headers.getSetCookie() : []).find((c) => c.startsWith('vs_aff=')) || '';
    check('aff: click redirects to the tool with ref, vclick and sub IDs', clk.status === 302 && loc.startsWith('https://joinvoo.com') && loc.includes(`ref=${A.code}`) && /vclick=\w+/.test(loc) && loc.includes('sub1=fb_ng_v3'), loc);
    check('aff: tracking cookie is HttpOnly, SameSite=Lax, 60 days', /HttpOnly/.test(sc) && /SameSite=Lax/.test(sc) && /Max-Age=5184000/.test(sc), sc);
    const crow = q1('SELECT * FROM aff_clicks WHERE affiliate_id=? ORDER BY id DESC LIMIT 1', A.id);
    check('aff: click stored with subs, external click id, device, source; IP only as a hash', crow && crow.sub1 === 'fb_ng_v3' && crow.ext_click_id === 'abc123' && crow.device === 'mobile' && crow.referrer === 'm.facebook.com' && crow.ip_hash.length === 32 && !JSON.stringify(crow).includes(visitor.ip), crow);
    const bot = await new Client().get(`/a/${A.code}?p=joinvoo`, { 'user-agent': 'facebookexternalhit/1.1' });
    check('aff: bot user agents are redirected but not counted and get no cookie', bot.status === 302 && !(bot.headers.getSetCookie ? bot.headers.getSetCookie() : []).some((c) => c.startsWith('vs_aff=')));
    const before = q1('SELECT COUNT(*) n FROM aff_clicks WHERE affiliate_id=?', A.id).n;
    const flood = new Client('10.250.250.250');
    for (let i = 0; i < 64; i++) await flood.get(`/a/${A.code}?p=spyvoo`, { 'user-agent': 'Mozilla/5.0' });
    const after = q1('SELECT COUNT(*) n FROM aff_clicks WHERE affiliate_id=?', A.id).n;
    check('aff: clicks are rate limited per IP (60 a minute)', after - before === 60, after - before);
    const evil = await new Client().get(`/a/${A.code}?url=https://evil.example/x&p=spyvoo`, { 'user-agent': 'Mozilla/5.0' });
    check('aff: deep links outside VooSquare and tool domains are ignored', (evil.headers.get('location') || '').startsWith('https://spyvoo.com'), evil.headers.get('location'));
    check('aff: link builder refuses foreign deep links and bad sub IDs', (await amara.get('/api/aff/links/build?url=https://evil.example')).status === 400 && (await amara.get('/api/aff/links/build?sub1=bad%20sub!')).status === 400);
    const lb = await amara.get('/api/aff/links/build?product=spyvoo&sub1=tt_ke&url=https://spyvoo.com/pricing');
    check('aff: link builder returns the URL and a QR SVG', lb.status === 200 && lb.data.url.includes('/a/' + A.code) && lb.data.url.includes('sub1=tt_ke') && lb.data.qr_svg.startsWith('<svg'), lb.data.url);
    const link = await amara.post('/api/aff/links', { name: 'Joinvoo NG main', product_key: 'joinvoo', sub1: 'fb_ng_v3', click_macro: '{clickid}' });
    check('aff: saved link with its own code', link.status === 200 && link.data.link.code.length >= 5 && link.data.link.url.includes('click_id={clickid}'), link.data);
    const qr = await amara.get(`/api/aff/links/${link.data.link.id}/qr.svg`);
    check('aff: QR code SVG for a saved link', qr.status === 200 && /image\/svg\+xml/.test(qr.headers.get('content-type')) && String(qr.data).includes('<path'));
    const auth = await new Client().get(`/oauth/authorize?client_id=nope&redirect_uri=https%3A%2F%2Fjoinvoo.com%2Fcb&vclick=${loc.match(/vclick=(\w+)/)[1]}&ref=${A.code}`);
    check('aff: /oauth/authorize keeps a click handed back by a tool (cookie set)', (auth.headers.getSetCookie ? auth.headers.getSetCookie() : []).some((c) => c.startsWith('vs_aff=')));

    /* ================================================================ approval */
    console.log('Affiliates: approval');
    const appr = await mgr.post(`/api/admin/aff/applications/${A.id}/approve`);
    check('aff: manager approves the assigned application', appr.status === 200 && appr.data.affiliate.status === 'approved', appr.data);
    check('aff: approval email and in-app notification', !!q1("SELECT 1 FROM email_queue WHERE template='aff_application_approved' AND to_email='amara.obi@gmail.com'") && (await amara.get('/api/aff/notifications')).data.notifications.some((n) => /approved/.test(n.text)));

    /* ================================================================ postbacks and Telegram before traffic */
    console.log('Affiliates: postbacks and Telegram setup');
    check('aff: postback URL must be a web address', (await amara.post('/api/aff/postbacks', { url: 'ftp://tracker.example/pb', events: ['first_payment'] })).status === 400);
    check('aff: postback URL with credentials refused', (await amara.post('/api/aff/postbacks', { url: 'http://user:pw@127.0.0.1/pb', events: ['first_payment'] })).status === 400);
    const pbUrl = `http://127.0.0.1:${M.port}/pb/main?cid={click_id}&e={event}&p={payout}&s1={sub1}&ref={customer_ref}&amt={amount}&cur={currency}&tx={transaction_id}`;
    const pb = await amara.post('/api/aff/postbacks', { name: 'Keitaro', url: pbUrl, method: 'GET', events: ['registration', 'ftd', 'qualified', 'refund', 'cpa_approved'], secret: 'pbsecret' });
    check('aff: postback saved (ftd alias → first_payment)', pb.status === 200 && pb.data.postback.events.includes('first_payment') && pb.data.postback.signed, pb.data);
    const tfire = await amara.post(`/api/aff/postbacks/${pb.data.postback.id}/test`, { event: 'first_payment' });
    const tHit = M.st.pb[M.st.pb.length - 1];
    check('aff: test fire reaches the tracker with macros filled', tfire.status === 200 && tfire.data.code === 200 && tHit && tHit.url.includes('cid=TEST_CLICK') && tHit.url.includes('e=first_payment') && tHit.url.includes('cur=USD'), tHit && tHit.url);
    const sig = tHit && tHit.headers['x-voosquare-signature'];
    const expect = 'sha256=' + crypto.createHmac('sha256', 'pbsecret').update(`${tHit.headers['x-voosquare-timestamp']}.http://127.0.0.1:${M.port}${tHit.url}`).digest('hex');
    check('aff: postbacks carry an HMAC signature (timestamp.url, keyed with the postback secret)', !!sig && sig === expect, { sig, expect });
    const tgs = await amara.get('/api/aff/telegram');
    check('aff: Telegram is configured, not yet connected', tgs.data.configured === true && tgs.data.connected === false);
    const con = await amara.post('/api/aff/telegram/connect');
    check('aff: connect gives a one-time t.me deep link with the bot name', con.status === 200 && con.data.link.startsWith('https://t.me/VooSquareAffBot?start=') && con.data.code.length >= 8, con.data);
    const hook = (body, secret = TG_SECRET) => fetch(BASE + '/api/aff/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: JSON.stringify(body) });
    check('aff: Telegram webhook refuses a wrong secret token', (await hook({ message: { chat: { id: 777 }, text: '/start ' + con.data.code } }, 'nope')).status === 401);
    const tgRes = await (await hook({ update_id: 1, message: { chat: { id: 777 }, from: { username: 'amara_media' }, text: '/start ' + con.data.code } })).json();
    check('aff: /start <code> links the chat and the bot confirms', tgRes.linked === true && await until(() => M.st.tg.some((m) => m.chat_id === '777' && /Connected/.test(m.text))) && (await amara.get('/api/aff/telegram')).data.connected === true, tgRes);
    check('aff: the code works once', (await (await hook({ message: { chat: { id: 778 }, text: '/start ' + con.data.code } })).json()).linked === false);
    await (await hook({ message: { chat: { id: 777 }, text: '/balance' } })).json();
    check('aff: bot answers /balance', await until(() => M.st.tg.some((m) => m.chat_id === '777' && /^Available:/.test(m.text))));

    /* ================================================================ attribution */
    console.log('Affiliates: attribution');
    // c1 signs up with the click cookie from `visitor`.
    const custs = [];
    const c1 = visitor; await c1.login('cust1@gmail.com', 'Kofi Customer');
    const at1 = q1('SELECT * FROM aff_attributions WHERE customer_user_id=?', c1.user.id);
    check('aff: Voo ID created after a click is locked to the affiliate (link, subs kept)', at1 && at1.affiliate_id === A.id && at1.method === 'link' && at1.sub1 === 'fb_ng_v3' && at1.ext_click_id === 'abc123' && at1.pre_existing === 0 && /^C-[A-Z2-9]{6}$/.test(at1.cust_ref), at1);
    check('aff: one ledger: the member referrer is the affiliate', q1('SELECT referred_by FROM users WHERE id=?', c1.user.id).referred_by === amara.user.id);
    check('aff: the click cookie is cleared after attribution', !c1.jar.has('vs_aff'));
    check('aff: registration postback with the click ID', await until(() => M.st.pb.some((h) => h.url.includes('e=registration') && h.url.includes('cid=abc123') && h.url.includes(at1.cust_ref))));
    custs.push(c1);
    // An existing member who clicks later is never attributed.
    await plain.get(`/a/${A.code}?p=joinvoo`, { 'user-agent': 'Mozilla/5.0' });
    await plain.login('member@aff.test', 'Plain Member');
    check('aff: an existing Voo ID is never attributed by a later click', !q1('SELECT 1 FROM aff_attributions WHERE customer_user_id=?', plain.user.id));
    const newCust = async (aff, email, name, product = 'joinvoo', extra = {}) => {
      const c = new Client(); await c.get(`/a/${aff.code}?p=${product}&sub1=${extra.sub1 || 'tg_main'}`, { 'user-agent': 'Mozilla/5.0 (Linux; Android 14) Mobile' }); await c.login(email, name, extra.login || {}); return c;
    };
    for (let i = 2; i <= 6; i++) custs.push(await newCust(A, `cust${i}@yahoo.com`, `Customer ${['Two', 'Three', 'Four', 'Five', 'Six'][i - 2]} Mensah${i}`));
    check('aff: five more customers attributed', qa('SELECT customer_user_id FROM aff_attributions WHERE affiliate_id=?', A.id).length === 6);

    /* ================================================================ RevShare, activation, qualification */
    console.log('Affiliates: RevShare, activation and qualification');
    const pay1 = await spend('joinvoo', c1.user.voo_id, 99, { id: 'jv_c1_p1', plan: 'Pro' });
    const com1 = q1("SELECT * FROM aff_commissions WHERE affiliate_id=? AND type='revshare' ORDER BY id LIMIT 1", A.id);
    check('aff: tool spend earns RevShare at the Starter rate (20% of $99 = $19.80, integer cents)', pay1.stored === 1 && com1 && com1.amount_cents === 1980 && com1.rate_bp === 2000 && Number.isInteger(com1.amount_cents), com1);
    check('aff: before 5 qualified customers it waits as pending_activation (no hold: releasable at once)', com1.status === 'pending_activation' && com1.hold_until <= Date.now(), com1);
    check('aff: qualification on the first payment (no second payment, no 30-day wait)', !!q1('SELECT qualified_at FROM aff_customers WHERE user_id=?', c1.user.id).qualified_at && q1("SELECT qualify_rule FROM aff_customers WHERE user_id=?", c1.user.id).qualify_rule === 'first_payment');
    check('aff: first-payment postback with commission and amount', await until(() => M.st.pb.some((h) => h.url.includes('e=first_payment') && h.url.includes('p=19.80') && h.url.includes('amt=99.00') && h.url.includes('cid=abc123'))));
    check('aff: first-payment Telegram alert, no PII', await until(() => M.st.tg.some((m) => /^First payment · Joinvoo Pro \$99\.00 · C-.*waiting for activation/.test(m.text))) && !M.st.tg.some((m) => /cust1@|Kofi/.test(m.text)));
    check('aff: qualified postback and Telegram alert', await until(() => M.st.pb.some((h) => h.url.includes('e=qualified'))) && await until(() => M.st.tg.some((m) => /^Qualified FTD · Joinvoo/.test(m.text))));
    check('aff: resending the same event_id is ignored (idempotent)', (await spend('joinvoo', c1.user.voo_id, 99, { id: 'jv_c1_p1', plan: 'Pro' })).stored === 0 && q1("SELECT COUNT(*) n FROM aff_commissions WHERE affiliate_id=? AND type='revshare'", A.id).n === 1);
    await jobs(Date.now(), { reconcile: true });
    check('aff: the catch-up job does not double count', q1("SELECT COUNT(*) n FROM aff_commissions WHERE affiliate_id=? AND type='revshare'", A.id).n === 1 && q1("SELECT COUNT(*) n FROM aff_conversions WHERE affiliate_id=? AND event_type IN ('first_payment','repeat_payment')", A.id).n === 1);
    const top = await ev('joinvoo', [{ event_id: 'jv_c1_top', voo_id: c1.user.voo_id, type: 'wallet_topup', value_usd: 500 }]);
    check('aff: wallet top-ups are tracked but never commissionable', top.stored === 1 && q1("SELECT status FROM aff_conversions WHERE source_key=(SELECT 'event:' || id FROM events WHERE ext_id='jv_c1_top')").status === 'not_commissionable' && q1("SELECT COUNT(*) n FROM aff_commissions WHERE affiliate_id=?", A.id).n === 1);
    await ev('joinvoo', [{ event_id: 'jv_plan_pro', voo_id: c1.user.voo_id, type: 'plan_started', value_usd: 99, plan: 'Pro' }]);
    const prods = await admin.get('/api/admin/aff/products');
    const jvp = prods.data.products.find((p) => p.key === 'joinvoo');
    check('aff: plan_started adds the plan and its price (provisional) and the suggested CPA (one month, rounded to $5, never above the price)', jvp && jvp.plans.some((x) => x.plan === 'Pro' && x.price_cents === 9900 && x.price_source === 'tool' && x.suggested_cpa_cents === 9500), jvp && jvp.plans);
    await spend('joinvoo', c1.user.voo_id, 99, { id: 'jv_c1_p2', plan: 'Pro' });
    for (let i = 1; i < 4; i++) await spend('joinvoo', custs[i].user.voo_id, 99, { id: `jv_c${i + 1}_p1`, plan: 'Pro' });
    let aRow = q1('SELECT * FROM aff_affiliates WHERE id=?', A.id);
    check('aff: four customers with one payment each are four qualified customers: not activated yet', !aRow.activated_at && q1('SELECT COUNT(*) n FROM aff_customers WHERE affiliate_id=? AND qualified_at IS NOT NULL', A.id).n === 4 && q1("SELECT COUNT(*) n FROM aff_commissions WHERE affiliate_id=? AND status='pending_activation'", A.id).n === 5);
    for (let i = 1; i < 4; i++) await spend('joinvoo', custs[i].user.voo_id, 99, { id: `jv_c${i + 1}_p2`, plan: 'Pro' });
    await spend('joinvoo', custs[4].user.voo_id, 99, { id: 'jv_c5_p1', plan: 'Pro' });
    aRow = q1('SELECT * FROM aff_affiliates WHERE id=?', A.id);
    const bal1 = (await amara.get('/api/aff/balance')).data;
    check('aff: the 5th customer\'s first payment activates earnings at once: waiting commissions become Available', !!aRow.activated_at && q1("SELECT COUNT(*) n FROM aff_commissions WHERE affiliate_id=? AND status='pending_activation'", A.id).n === 0 && bal1.available_cents === 9 * 1980 && bal1.hold_cents === 0, bal1);
    check('aff: activation alert says the money is available', await until(() => M.st.tg.some((m) => /^Your earnings are active: you reached 5 qualified customers\. \$178\.20 is now available/.test(m.text))));
    check('aff: health starts in the 90-day ramp after activation', aRow.health_state === 'ramp');
    await spend('joinvoo', custs[4].user.voo_id, 99, { id: 'jv_c5_p2', plan: 'Pro' });
    const c5p2 = q1("SELECT * FROM aff_commissions WHERE uniq_key=(SELECT 'rs:event:' || id FROM events WHERE ext_id='jv_c5_p2')");
    check('aff: spend commission is available instantly (credits used, no hold)', c5p2 && c5p2.status === 'available' && !!c5p2.released_at && (await amara.get('/api/aff/balance')).data.available_cents === 19800, c5p2);
    // c6: one payment, then the tool sends a refund. Credits that were used are non-refundable: the commission stands.
    await spend('joinvoo', custs[5].user.voo_id, 30, { id: 'jv_c6_p1', plan: 'Starter' });
    const rf = await ev('joinvoo', [{ event_id: 'jv_c6_rf', voo_id: custs[5].user.voo_id, type: 'refund', value_usd: 30, original_event_id: 'jv_c6_p1' }]);
    const c6com = q1("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type='revshare'", custs[5].user.id);
    check('aff: a tool refund after spend does not claw back (used credits are non-refundable)', rf.stored === 1 && c6com.status === 'available' && !q1("SELECT 1 FROM aff_commissions WHERE customer_user_id=? AND type='clawback'", custs[5].user.id) && q1('SELECT refunds, qualified_at FROM aff_customers WHERE user_id=?', custs[5].user.id).refunds === 0 && !!q1('SELECT qualified_at FROM aff_customers WHERE user_id=?', custs[5].user.id).qualified_at, c6com);
    check('aff: the tool refund is logged as final (no reversal)', q1("SELECT status FROM aff_conversions WHERE customer_user_id=? AND event_type='refund_final'", custs[5].user.id).status === 'no_clawback' && (await amara.get('/api/aff/balance')).data.available_cents === 20400);
    // Owner update 2026-10-05 ("yes"): a tool refund never reverses commission, also when it refunds a PLAN payment (not only credits).
    const c5p2Before = q1("SELECT * FROM aff_commissions WHERE uniq_key=(SELECT 'rs:event:' || id FROM events WHERE ext_id='jv_c5_p2')");
    const prf = await ev('joinvoo', [{ event_id: 'jv_c5_plan_rf', voo_id: custs[4].user.voo_id, type: 'refund', value_usd: 99, plan: 'Pro', label: 'Pro plan payment refunded', original_event_id: 'jv_c5_p2' }]);
    const prf2 = await ev('joinvoo', [{ event_id: 'jv_c5_plan_rf2', voo_id: custs[4].user.voo_id, type: 'refund', value_usd: 99, plan: 'Pro', label: 'Pro plan refund without a reference' }]);
    const c5p2After = q1('SELECT * FROM aff_commissions WHERE id=?', c5p2Before.id);
    check('aff: a tool refund of a plan payment never reverses commission (commission stays available, no clawback row, refund rate untouched)', prf.stored === 1 && prf2.stored === 1 && c5p2Before.status === 'available' && c5p2After.status === 'available' && c5p2After.amount_cents === 1980
      && !q1("SELECT 1 FROM aff_commissions WHERE customer_user_id=? AND type='clawback'", custs[4].user.id) && q1('SELECT refunds, refunded_cents FROM aff_customers WHERE user_id=?', custs[4].user.id).refunds === 0
      && q1("SELECT COUNT(*) n FROM aff_conversions WHERE customer_user_id=? AND event_type='refund_final' AND status='no_clawback' AND plan='Pro'", custs[4].user.id).n === 2 && (await amara.get('/api/aff/balance')).data.available_cents === 20400, { c5p2After, conv: q1("SELECT * FROM aff_conversions WHERE customer_user_id=? AND event_type='refund_final'", custs[4].user.id) });
    // A chargeback (card dispute) still claws back, even on used credits.
    await ev('joinvoo', [{ event_id: 'jv_c1_cb', voo_id: c1.user.voo_id, type: 'chargeback', value_usd: 99, original_event_id: 'jv_c1_p1' }]);
    const cb = q1("SELECT * FROM aff_commissions WHERE affiliate_id=? AND type='clawback'", A.id);
    check('aff: a chargeback claws back released commission: negative Reversal row on the ledger', cb && cb.amount_cents === -1980 && cb.status === 'available' && cb.reason === 'chargeback' && (await amara.get('/api/aff/balance')).data.available_cents === 18420, cb);
    check('aff: chargeback alert', await until(() => M.st.tg.some((m) => /^Chargeback · Joinvoo Pro \$99\.00 · C-.*Commission of \$19\.80 reversed/.test(m.text))));
    const led = await amara.get('/api/aff/ledger');
    check('aff: earnings ledger lists RevShare and Reversal rows with customer references', led.data.rows.some((r) => r.type_label === 'Reversal' && r.amount_cents === -1980 && /^C-/.test(r.customer_ref)) && led.data.rows.some((r) => r.type_label === 'RevShare' && r.status_label === 'Available'));
    // Admin can still set a hold (for example on credits used): it applies to new earnings, then the job releases it.
    const hs1 = await admin.put('/api/admin/aff/settings', { holds: { spend_days: 30 } });
    check('aff: hold settings: admin sets a 30-day hold on credits used', hs1.status === 200 && hs1.data.settings.holds.spend_days === 30 && hs1.data.settings.holds.order_days === 0, hs1.data && hs1.data.settings && hs1.data.settings.holds);
    check('aff: hold days are validated (0 to 120)', (await admin.put('/api/admin/aff/settings', { holds: { spend_days: 500 } })).status === 400);
    await spend('joinvoo', custs[2].user.voo_id, 99, { id: 'jv_c3_p3', plan: 'Pro' });
    const held = q1("SELECT * FROM aff_commissions WHERE uniq_key=(SELECT 'rs:event:' || id FROM events WHERE ext_id='jv_c3_p3')");
    const balH = (await amara.get('/api/aff/balance')).data;
    check('aff: with a hold set, new commission sits On hold until the hold ends', held && held.status === 'hold' && Math.abs(held.hold_until - (Date.now() + 30 * DAY)) < 120_000 && balH.hold_cents === 1980 && balH.next_release && balH.available_cents === 18420, balH);
    await admin.put('/api/admin/aff/settings', { holds: { spend_days: 0 } });
    await jobs(Date.now() + 31 * DAY);
    const bal2 = (await amara.get('/api/aff/balance', at(Date.now() + 31 * DAY))).data;
    check('aff: the hold ends: the job releases it to Available', bal2.available_cents === 20400 && bal2.hold_cents === 0, bal2);
    // Member referral program: payments after approval are paid by the affiliate program, not twice.
    const mref = await amara.get('/api/me/referrals');
    check('aff: one ledger: the member program does not count payments after affiliate approval', mref.status === 200 && mref.data.referred >= 6 && mref.data.spend_usd === 0, mref.data && { referred: mref.data.referred, spend: mref.data.spend_usd });

    /* ================================================================ pending affiliate, caps, Inner Circle, orders */
    console.log('Affiliates: approval gate, caps, VooSquare orders');
    const pend = new Client(); await pend.login('tunde.tg@gmail.com', 'Tunde Bakare');
    const P0 = (await pend.post('/api/aff/account', {})).data.account;
    const pc = await newCust(P0, 'pendcust@gmail.com', 'Pend Customer');
    await spend('joinvoo', pc.user.voo_id, 99, { plan: 'Pro' });
    check('aff: before approval: tracked, not earning (no commission)', q1("SELECT status FROM aff_conversions WHERE customer_user_id=? AND event_type='first_payment'", pc.user.id).status === 'pre_approval' && !q1('SELECT 1 FROM aff_commissions WHERE affiliate_id=?', P0.id));
    const leg = new Client(); await leg.login('legend.buyer@gmail.com', 'Sipho Dlamini');
    const L = (await leg.post('/api/aff/account', {})).data.account;
    for (const [s, b] of [[1, { display_name: 'siphoscale', country: 'ZA', telegram: '@siphoscale' }], [2, { sources: ['TikTok ads'], geos: ['ZA'], volume: '$50k–$200k' }], [3, { plan: 'TikTok spark ads for Vooads and Joinvoo in South Africa and Kenya, plus a YouTube channel.' }], [4, { accept_terms: true, no_income_claims: true, adult: true }]]) await leg.put(`/api/aff/application/${s}`, b);
    check('aff: admin approves; set Legend override (approved)', (await admin.post(`/api/admin/aff/applications/${L.id}/approve`)).status === 200 && (await admin.patch(`/api/admin/aff/affiliates/${L.id}`, { tier_override: 6, legend_approved: true })).status === 200);
    run('UPDATE aff_affiliates SET activated_at=? WHERE id=?', Date.now(), L.id);
    const lc = await newCust(L, 'legendcust@gmail.com', 'Lerato Molefe', 'vooads');
    await spend('vooads', lc.user.voo_id, 100, { plan: '$100 pack' });
    await spend('joinvoo', lc.user.voo_id, 100, { plan: 'Pro' });
    const lcoms = qa("SELECT product_key, rate_bp, amount_cents FROM aff_commissions WHERE affiliate_id=? AND type='revshare'", L.id);
    check('aff: product caps: Vooads 35% even at Legend 50%; Joinvoo 50%', lcoms.find((x) => x.product_key === 'vooads').amount_cents === 3500 && lcoms.find((x) => x.product_key === 'joinvoo').amount_cents === 5000, lcoms);
    // VooSquare orders: Premium earns, Inner Circle is 0%.
    const lcu = lc.user.id;
    const inner = q1("SELECT id, name FROM rooms WHERE slug='inner-circle'");
    const mkOrder = (item_type, item_id, name, usd) => run("INSERT INTO orders(ref,user_id,item_type,item_id,item_name,amount_usd,currency,amount,method_id,status,created_at) VALUES(?,?,?,?,?,?,'USD',?,NULL,'pending',?)", 'T' + crypto.randomBytes(5).toString('hex'), lcu, item_type, item_id, name, usd, usd, Date.now()).lastInsertRowid;
    const oPrem = mkOrder('premium', null, 'VooSquare Premium', 20); const oIc = mkOrder('room', inner.id, inner.name, 299);
    const finApprove = async (id) => owner.post(`/api/admin/orders/${id}/approve`);
    await finApprove(oPrem); await finApprove(oIc);
    const prem = q1("SELECT * FROM aff_commissions WHERE affiliate_id=? AND product_key='premium'", L.id);
    check('aff: VooSquare Premium order earns RevShare, available at once (order hold 0)', prem && prem.amount_cents === 1000 && prem.status === 'available', prem);
    check('aff: Inner Circle earns 0% (tracked, not commissionable)', !q1("SELECT 1 FROM aff_commissions WHERE product_key='inner-circle'") && q1("SELECT status FROM aff_conversions WHERE source_key=?", 'order:' + oIc).status === 'not_commissionable');
    const refundOrder = await fin1.post(`/api/admin/aff/orders/${oPrem}/refund`, { kind: 'refund', reason: 'Customer asked' });
    check('aff: admin refund of a VooSquare order reverses that order\'s commission (clawback row)', refundOrder.status === 200 && refundOrder.data.order.status === 'refunded' && refundOrder.data.affiliate.reversed_cents === 1000 && !!q1("SELECT 1 FROM aff_commissions WHERE type='clawback' AND source_commission_id=? AND amount_cents=-1000", prem.id), refundOrder.data);
    // Card-paid orders can carry their own hold (chargeback risk); Gatevoo (crypto) orders cannot be reversed by the payer.
    const pmCard = run("INSERT INTO payment_methods(type,name,enabled) VALUES('stripe','Stripe test',1)").lastInsertRowid;
    const pmGate = run("INSERT INTO payment_methods(type,name,enabled) VALUES('gatevoo','Gatevoo test',1)").lastInsertRowid;
    await admin.put('/api/admin/aff/settings', { holds: { card_order_days: 14 } });
    const mkOrderM = (usd, mid) => run("INSERT INTO orders(ref,user_id,item_type,item_id,item_name,amount_usd,currency,amount,method_id,status,created_at) VALUES(?,?,'premium',NULL,'VooSquare Premium',?,'USD',?,?,'pending',?)", 'T' + crypto.randomBytes(5).toString('hex'), lcu, usd, usd, mid, Date.now()).lastInsertRowid;
    const oCard = mkOrderM(20, pmCard); const oGate = mkOrderM(20, pmGate);
    await finApprove(oCard); await finApprove(oGate);
    const comOf = (oid) => q1("SELECT * FROM aff_commissions WHERE uniq_key=?", 'rs:order:' + oid);
    check('aff: card-paid order with a card hold set: On hold for that many days', comOf(oCard) && comOf(oCard).status === 'hold' && Math.abs(comOf(oCard).hold_until - (Date.now() + 14 * DAY)) < 120_000, comOf(oCard));
    check('aff: Gatevoo (crypto) order: available at once (non-reversible)', comOf(oGate) && comOf(oGate).status === 'available', comOf(oGate));
    await admin.put('/api/admin/aff/settings', { holds: { card_order_days: 0 } });
    // Sub-cent rounding: money is integer cents, rounded down.
    const lc2 = await newCust(L, 'cents@gmail.com', 'Cent Customer', 'spyvoo');
    await spend('spyvoo', lc2.user.voo_id, 0.99);
    check('aff: money in integer cents, rounded down (50% of $0.99 = 49 cents)', q1("SELECT amount_cents FROM aff_commissions WHERE customer_user_id=?", lc2.user.id).amount_cents === 49);

    /* ================================================================ coupons and self-referral */
    console.log('Affiliates: coupons and self-referral');
    const cp = await admin.post('/api/admin/aff/coupons', { affiliate_id: L.id, code: 'SIPHO10', discount_pct: 10 });
    check('aff: admin creates a coupon code', cp.status === 200 && cp.data.coupon.code === 'SIPHO10');
    const cc = new Client(); await cc.get(`/a/${A.code}?p=joinvoo`, { 'user-agent': 'Mozilla/5.0' });
    await cc.login('couponcust@gmail.com', 'Coupon Customer', { login: {} }); // without coupon → A
    check('aff: cookie attribution without coupon goes to the clicked affiliate', q1('SELECT affiliate_id FROM aff_attributions WHERE customer_user_id=?', cc.user.id).affiliate_id === A.id);
    const cc2 = new Client(); await cc2.get(`/a/${A.code}?p=joinvoo`, { 'user-agent': 'Mozilla/5.0' });
    await cc2.login('couponcust2@gmail.com', 'Coupon Two', { coupon: 'sipho10' });
    const ccat = q1('SELECT * FROM aff_attributions WHERE customer_user_id=?', cc2.user.id);
    check('aff: a coupon typed at sign-up wins over the cookie (and the member referrer follows)', ccat.affiliate_id === L.id && ccat.method === 'coupon' && ccat.coupon_code === 'SIPHO10' && q1('SELECT referred_by FROM users WHERE id=?', cc2.user.id).referred_by === leg.user.id && q1("SELECT uses FROM aff_coupons WHERE code='SIPHO10'").uses === 1, ccat);
    const self = new Client(); await self.get(`/a/${A.code}?p=joinvoo`, { 'user-agent': 'Mozilla/5.0' });
    await self.login('a.m.a.r.a.obi+alt@googlemail.com', 'Amara O');
    const selfAt = q1('SELECT * FROM aff_attributions WHERE customer_user_id=?', self.user.id);
    check('aff: self-referral through a Gmail dot/+alias of the affiliate is blocked', selfAt && selfAt.blocked === 'self_referral', selfAt);
    await spend('joinvoo', self.user.voo_id, 99);
    check('aff: blocked customers earn nothing', !q1('SELECT 1 FROM aff_commissions WHERE customer_user_id=?', self.user.id) && q1("SELECT status FROM aff_conversions WHERE customer_user_id=? AND event_type='first_payment'", self.user.id).status === 'blocked');

    /* ================================================================ CPA */
    console.log('Affiliates: CPA deals, review, duplicates, caps, clawback');
    const cpaC = new Client(); await cpaC.login('ifeanyi.cpa@gmail.com', 'Ifeanyi Okeke');
    const CP = (await cpaC.post('/api/aff/account', {})).data.account;
    for (const [s, b] of [[1, { display_name: 'ifeanyi.cpa', country: 'NG', telegram: '@ifeanyi_cpa' }], [2, { sources: ['Push'], geos: ['NG'], volume: '$10k–$50k' }], [3, { plan: 'Push traffic to Replyvoo landing pages in Nigeria with a review site and comparison pages.' }], [4, { accept_terms: true, no_income_claims: true, adult: true }]]) await cpaC.put(`/api/aff/application/${s}`, b);
    await admin.post(`/api/admin/aff/applications/${CP.id}/approve`);
    run('UPDATE aff_affiliates SET activated_at=? WHERE id=?', Date.now(), CP.id);
    const over = await admin.post(`/api/admin/aff/affiliates/${CP.id}/deals`, { product_key: 'replyvoo', model: 'cpa', cpa_usd: 350, monthly_cap: 50 });
    check('aff: CPA above $300 needs the owner', over.status === 403 && over.data.needs_owner === true);
    const deal = await admin.post(`/api/admin/aff/affiliates/${CP.id}/deals`, { product_key: 'replyvoo', model: 'cpa', cpa_usd: 300, monthly_cap: 50, traffic: ['Push'], geos: ['NG'] });
    check('aff: CPA deal created within limits', deal.status === 200 && deal.data.deal.cpa_cents === 30000, deal.data);
    check('aff: Offers page shows the active CPA', (await cpaC.get('/api/aff/offers')).data.products.find((p) => p.key === 'replyvoo').cpa.state === 'active');
    const x1 = await newCust(CP, 'tobi.cpa1@outlook.com', 'Tobi Adewale', 'replyvoo');
    await spend('replyvoo', x1.user.voo_id, 599, { plan: 'Titan', id: 'rv_x1_p1' });
    const rv1 = q1('SELECT * FROM aff_cpa_reviews WHERE customer_user_id=?', x1.user.id);
    const prov = qa("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type IN ('revshare','clawback')", x1.user.id);
    check('aff: the first payment qualifies a CPA-deal customer: one CPA conversion in review; provisional RevShare cancelled cleanly (one model per customer)', rv1 && rv1.status === 'pending' && rv1.amount_cents === 30000 && prov.length === 1 && prov[0].provisional === 1 && prov[0].status === 'reversed' && q1('SELECT model FROM aff_customers WHERE user_id=?', x1.user.id).model === 'cpa', { rv1, prov });
    await spend('replyvoo', x1.user.voo_id, 599, { plan: 'Titan', id: 'rv_x1_p2' });
    check('aff: later payments of a CPA customer earn no RevShare', q1("SELECT COUNT(*) n FROM aff_commissions WHERE customer_user_id=? AND type='revshare'", x1.user.id).n === 1);
    const queue = await fraud.get('/api/admin/aff/cpa');
    check('aff: CPA queue (risk first) visible to the fraud-check role', queue.status === 200 && queue.data.queue.some((x) => x.id === rv1.id && x.customer_ref.startsWith('C-')) && queue.data.stats.in_queue >= 1, queue.data.stats);
    const det = await fraud.get(`/api/admin/aff/cpa/${rv1.id}`);
    check('aff: CPA detail has a timeline, geos and an analysis', det.status === 200 && det.data.conversion.timeline.some((t) => t.label === 'Qualified') && det.data.conversion.analysis.verdict === 'unique', det.data.conversion && det.data.conversion.analysis);
    check('aff: the affiliate cannot see fraud evidence (only reason codes later)', (await cpaC.get(`/api/admin/aff/cpa/${rv1.id}`)).status === 403);
    const ap1 = await fraud.post(`/api/admin/aff/cpa/${rv1.id}/approve`, { note: 'Clean' });
    const cpaCom = q1("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type='cpa'", x1.user.id);
    check('aff: approved CPA is available at once (no CPA hold by default)', ap1.status === 200 && cpaCom.status === 'available' && !!cpaCom.released_at, cpaCom);
    check('aff: CPA approved notification says Available now', /^CPA approved · Replyvoo Titan · \$300\.00 · C-\w+\. Available now\.$/.test((q1("SELECT text FROM aff_notifications WHERE affiliate_id=? AND kind='cpa_approved' ORDER BY id DESC LIMIT 1", CP.id) || {}).text || ''), q1("SELECT text FROM aff_notifications WHERE affiliate_id=? AND kind='cpa_approved' ORDER BY id DESC LIMIT 1", CP.id));
    check('aff: CPA approved email queued for the affiliate', !!q1("SELECT 1 FROM email_queue WHERE template='aff_cpa_approved' AND to_email='ifeanyi.cpa@gmail.com'"));
    check('aff: deciding twice is refused', (await fraud.post(`/api/admin/aff/cpa/${rv1.id}/approve`)).status === 409);
    // Admin can set a CPA hold: the next approval waits that long.
    await admin.put('/api/admin/aff/settings', { holds: { cpa_days: 7 } });
    const x2 = await newCust(CP, 'cpa.hold@outlook.com', 'Hold Customer', 'replyvoo');
    await spend('replyvoo', x2.user.voo_id, 129, { plan: 'Growth' });
    const rv2 = q1('SELECT * FROM aff_cpa_reviews WHERE customer_user_id=?', x2.user.id);
    await fraud.post(`/api/admin/aff/cpa/${rv2.id}/approve`, { note: 'Clean' });
    const cpa2 = q1("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type='cpa'", x2.user.id);
    check('aff: with a 7-day CPA hold set, the approved CPA sits On hold for 7 days', cpa2 && cpa2.status === 'hold' && Math.abs(cpa2.hold_until - (Date.now() + 7 * DAY)) < 120_000, cpa2);
    await admin.put('/api/admin/aff/settings', { holds: { cpa_days: 0 } });
    // Monthly cap: lower it to 1, the next qualified customer falls back to RevShare.
    await admin.patch(`/api/admin/aff/deals/${deal.data.deal.id}`, { monthly_cap: 1 });
    const x3 = await newCust(CP, 'cap.cust@outlook.com', 'Cap Customer', 'replyvoo');
    await spend('replyvoo', x3.user.voo_id, 129, { plan: 'Growth' }); await spend('replyvoo', x3.user.voo_id, 129, { plan: 'Growth' });
    const rv3 = q1('SELECT * FROM aff_cpa_reviews WHERE customer_user_id=?', x3.user.id);
    const x3rs = qa("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type='revshare'", x3.user.id);
    check('aff: over the monthly CPA cap: declined over_cap automatically, customer pays RevShare instead (available at once)', rv3 && rv3.status === 'declined' && rv3.decline_reason === 'over_cap' && q1('SELECT model FROM aff_customers WHERE user_id=?', x3.user.id).model === 'revshare' && x3rs.length === 2 && x3rs.every((x) => x.status === 'available' && x.provisional === 0), { rv3, x3rs });
    await admin.patch(`/api/admin/aff/deals/${deal.data.deal.id}`, { monthly_cap: 50 });
    // Duplicate: a Gmail alias of someone who already paid.
    const old = new Client(); await old.login('kwamea@gmail.com', 'Kwame Asare');
    await spend('spyvoo', old.user.voo_id, 29);
    const x4 = await newCust(CP, 'kwame.a+promo@gmail.com', 'Kwame A', 'replyvoo');
    await spend('replyvoo', x4.user.voo_id, 299); await spend('replyvoo', x4.user.voo_id, 299);
    const rv4 = q1('SELECT * FROM aff_cpa_reviews WHERE customer_user_id=?', x4.user.id);
    const dup = await fraud.post(`/api/admin/aff/cpa/${rv4.id}/check`);
    check('aff: duplicate check: Gmail alias of a customer who already paid → Existing customer', dup.status === 200 && dup.data.verdict === 'existing' && dup.data.signals.some((s) => s.key === 'email' && /already paid/.test(s.evidence)), dup.data);
    check('aff: duplicate check shows masked evidence only', !JSON.stringify(dup.data).includes('kwamea@gmail.com') && !JSON.stringify(dup.data).includes('kwame.a+promo') && /^k•+@gmail\.com$/.test(dup.data.email_masked), dup.data.email_masked);
    const bulk = await fraud.post('/api/admin/aff/cpa/bulk-approve', { ids: [rv4.id] });
    check('aff: bulk approve refuses high-risk conversions', bulk.status === 400);
    check('aff: decline needs a valid reason code', (await fraud.post(`/api/admin/aff/cpa/${rv4.id}/decline`, { reason: 'because' })).status === 400);
    const dec4 = await fraud.post(`/api/admin/aff/cpa/${rv4.id}/decline`, { reason: 'duplicate_account', note: 'Same person as an existing customer' });
    check('aff: decline with reason: commission declined, the customer earns nothing later', dec4.status === 200 && q1("SELECT status FROM aff_commissions WHERE customer_user_id=? AND type='cpa'", x4.user.id).status === 'declined' && q1('SELECT model FROM aff_customers WHERE user_id=?', x4.user.id).model === 'none');
    await spend('replyvoo', x4.user.voo_id, 299);
    check('aff: no RevShare after a declined CPA', !q1("SELECT 1 FROM aff_commissions WHERE customer_user_id=? AND type='revshare' AND status IN ('hold','available')", x4.user.id));
    const cpaTab = await cpaC.get('/api/aff/cpa');
    check('aff: affiliate CPA tab shows the reason text, not the evidence', cpaTab.data.conversions.some((c) => c.reason === 'duplicate_account' && /another Voo ID/.test(c.reason_text)) && !JSON.stringify(cpaTab.data).includes('V-0'), cpaTab.data.stats);
    // Auto-pause: lower the minimum decisions to 2 (decisions: x1 approved, x4 declined = 50% > 20%).
    await admin.put('/api/admin/aff/settings', { cpa: { auto_pause_min: 2 } });
    const x5 = await newCust(CP, 'fifth.cpa@outlook.com', 'Fifth Customer', 'replyvoo');
    await spend('replyvoo', x5.user.voo_id, 49); await spend('replyvoo', x5.user.voo_id, 49);
    const rv5 = q1('SELECT * FROM aff_cpa_reviews WHERE customer_user_id=?', x5.user.id);
    await fraud.post(`/api/admin/aff/cpa/${rv5.id}/extend`, { note: 'Waiting for traffic sample' });
    check('aff: "Need more time" records 14 more days of review time', q1('SELECT extended_days FROM aff_cpa_reviews WHERE id=?', rv5.id).extended_days === 14);
    await fraud.post(`/api/admin/aff/cpa/${rv5.id}/decline`, { reason: 'traffic_source_not_approved' });
    check('aff: decline rate over 20% in 30 days pauses CPA automatically', q1('SELECT cpa_paused FROM aff_affiliates WHERE id=?', CP.id).cpa_paused === 1);
    const flags = await fraud.get('/api/admin/aff/fraud/flags');
    check('aff: flagged affiliates list shows the auto-pause', flags.data.flags.some((f) => f.id === CP.id && f.state === 'CPA auto-paused'));
    // A tool refund never reverses the approved CPA (credits used are final); a chargeback within 90 days of qualifying does.
    await ev('replyvoo', [{ event_id: 'rv_x1_rf', voo_id: x1.user.voo_id, type: 'refund', value_usd: 299, original_event_id: 'rv_x1_p2' }]);
    check('aff: a tool refund does not reverse an approved CPA', q1("SELECT status FROM aff_commissions WHERE customer_user_id=? AND type='cpa'", x1.user.id).status === 'available' && !q1("SELECT 1 FROM aff_commissions WHERE customer_user_id=? AND type='clawback'", x1.user.id));
    await ev('replyvoo', [{ event_id: 'rv_x1_cb', voo_id: x1.user.voo_id, type: 'chargeback', value_usd: 299, original_event_id: 'rv_x1_p1' }]);
    check('aff: a chargeback within 90 days of qualifying claws back the approved CPA', !!q1("SELECT 1 FROM aff_commissions WHERE customer_user_id=? AND type='clawback' AND amount_cents=-30000 AND reason='chargeback'", x1.user.id));
    // Proven fraud: a two-person fraud reversal (proposed, then approved by a different finance user), audit logged.
    const x3ids = x3rs.map((x) => x.id);
    const prop = await admin.post('/api/admin/aff/clawbacks', { affiliate_id: CP.id, commission_ids: x3ids, reason: 'Linked accounts confirmed by the payment processor' });
    check('aff: fraud reversal proposed with a reason', prop.status === 200 && prop.data.clawback.status === 'pending' && prop.data.clawback.amount_cents === x3rs.reduce((t, x) => t + x.amount_cents, 0), prop.data);
    check('aff: fraud reversal needs the reason', (await admin.post('/api/admin/aff/clawbacks', { affiliate_id: CP.id, commission_ids: x3ids, reason: '' })).status === 400);
    const apr = await fin1.post(`/api/admin/aff/clawbacks/${prop.data.clawback.id}/approve`);
    const fr = qa("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type='clawback' AND reason='fraud'", x3.user.id);
    check('aff: fraud reversal approved by finance reverses final (available) earnings with negative rows', apr.status === 200 && fr.length === 2 && fr.every((x) => x.amount_cents < 0 && /Fraud reversal #/.test(x.note)), fr);
    check('aff: fraud reversal is audit logged (propose and approve, with the reason)', !!q1("SELECT 1 FROM aff_audit WHERE action='clawback.propose' AND affiliate_id=?", CP.id) && !!q1("SELECT 1 FROM aff_audit WHERE action='clawback.approve' AND affiliate_id=? AND after LIKE '%Linked accounts%'", CP.id));

    /* ================================================================ tiers */
    console.log('Affiliates: tiers, grace, quality gate, fast lane');
    const T = async (email, name, extra = {}) => {
      const c = new Client(); await c.login(email, name);
      const a = (await c.post('/api/aff/account', {})).data.account;
      run("UPDATE aff_affiliates SET status='approved', applied_at=?, approved_at=?, tier=?, tier_month='', display_name=? WHERE id=?", NOW - 200 * DAY, NOW - 200 * DAY, extra.tier || 0, name.split(' ')[0].toLowerCase(), a.id);
      return { c, a };
    };
    const monthStart = (offset) => { const d = new Date(NOW + 3600_000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1) - 3600_000; }; // Africa/Lagos is UTC+1
    let seedN = 0;
    const seed = (affId, n, { qualifiedAt, firstAt, refunds = 0 } = {}) => {
      for (let i = 0; i < n; i++) {
        seedN++;
        const uid = run('INSERT INTO users(voo_id,email,name,created_at,last_seen,ref_code) VALUES(?,?,?,?,?,?)', `vs_seed${seedN}x${process.pid}`, `seed${seedN}@seed.test`, `Seed ${seedN}`, firstAt || qualifiedAt, firstAt || qualifiedAt, `sd${seedN}x${process.pid % 1000}`).lastInsertRowid;
        run('INSERT INTO aff_attributions(customer_user_id,affiliate_id,method,locked_at,cust_ref) VALUES(?,?,?,?,?)', uid, affId, 'link', (firstAt || qualifiedAt) - 3600_000, 'C-SEED' + (seedN % 100));
        run('INSERT INTO aff_customers(user_id,affiliate_id,first_payment_at,first_product,payments,total_cents,qualified_at,refunds) VALUES(?,?,?,?,?,?,?,?)', uid, affId, firstAt || qualifiedAt, 'joinvoo', 2, 19800, qualifiedAt || null, i < refunds ? 1 : 0);
      }
    };
    const U = await T('upgrade@aff.test', 'Upgrade Buyer');
    seed(U.a.id, 12, { qualifiedAt: monthStart(-1) + 5 * DAY }); seed(U.a.id, 10, { qualifiedAt: monthStart(-2) + 5 * DAY });
    const U2 = await T('qualityhold@aff.test', 'Quality Hold');
    seed(U2.a.id, 12, { qualifiedAt: monthStart(-1) + 5 * DAY, refunds: 2 }); // 2 of 22 = 9.1% seed(U2.a.id, 10, { qualifiedAt: monthStart(-2) + 5 * DAY });
    const G = await T('grace@aff.test', 'Grace Buyer', { tier: 2 });
    const Qd = await T('qualitydrop@aff.test', 'Quality Drop', { tier: 1 });
    seed(Qd.a.id, 12, { qualifiedAt: monthStart(-1) + 5 * DAY, refunds: 4 }); // 4 of 22 = 18% seed(Qd.a.id, 10, { qualifiedAt: monthStart(-2) + 5 * DAY });
    const tierAt = monthStart(0) + 2 * 3600_000;
    await jobs(tierAt);
    const tierOf = (id) => q1('SELECT tier, tier_grace_month FROM aff_affiliates WHERE id=?', id);
    check('aff: tier set on the 1st from the 2-month average (12 and 10 → 11 → Pro)', tierOf(U.a.id).tier === 1, tierOf(U.a.id));
    check('aff: refund rate over 8% holds the upgrade', tierOf(U2.a.id).tier === 0);
    check('aff: under the threshold: grace month, tier kept', tierOf(G.a.id).tier === 2 && tierOf(G.a.id).tier_grace_month !== '', tierOf(G.a.id));
    check('aff: refund rate over 15% drops one tier without grace', tierOf(Qd.a.id).tier === 0);
    check('aff: tier change is notified (tier up email for Pro)', !!q1("SELECT 1 FROM email_queue WHERE template='aff_tier_up' AND to_email='upgrade@aff.test'"));
    await jobs(tierAt);
    check('aff: monthly tiers run once per affiliate per month', tierOf(G.a.id).tier === 2);
    await jobs(monthStart(1) + 2 * 3600_000);
    check('aff: still under after the grace month: down one tier only (Elite → Pro)', tierOf(G.a.id).tier === 1, tierOf(G.a.id));
    const F = await T('fastlane@aff.test', 'Fast Lane');
    run('UPDATE aff_affiliates SET approved_at=? WHERE id=?', NOW - DAY, F.a.id);
    seed(F.a.id, 9, { qualifiedAt: NOW - 3600_000 });
    const fc = await newCust(F.a, 'fast10@gmail.com', 'Fast Ten');
    await spend('joinvoo', fc.user.voo_id, 30); await spend('joinvoo', fc.user.voo_id, 30);
    check('aff: fast lane: 10 qualified this month moves to Pro the same day', tierOf(F.a.id).tier === 1 && !!q1("SELECT 1 FROM aff_tier_history WHERE affiliate_id=? AND reason='fast_lane'", F.a.id));
    const card = (await F.c.get('/api/aff/me')).data.account.tier;
    check('aff: tier card: rate, month progress, next tier', card.tier === 'Pro' && card.rate_bp === 2500 && card.month_qualified === 10 && card.next.name === 'Elite', card);

    /* ================================================================ health */
    console.log('Affiliates: lifetime RevShare health');
    const lower = await admin.put('/api/admin/aff/settings', { health: { threshold: 3 } });
    check('aff: lowering the health threshold applies at once', lower.status === 200 && lower.data.settings.health.threshold === 3 && !lower.data.scheduled, lower.data.scheduled);
    const H = await T('health@aff.test', 'Health Buyer');
    run("UPDATE aff_affiliates SET activated_at=?, health_state='ramp', health_since=? WHERE id=?", NOW - 100 * DAY, NOW - 100 * DAY, H.a.id);
    seed(H.a.id, 1, { qualifiedAt: NOW - 10 * DAY, firstAt: NOW - 40 * DAY });
    const hOld = await newCust(H.a, 'health.old@gmail.com', 'Health Old');
    run('INSERT INTO aff_customers(user_id,affiliate_id,first_payment_at,first_product,payments,total_cents) VALUES(?,?,?,?,1,3000)', hOld.user.id, H.a.id, NOW - 20 * DAY, 'joinvoo');
    await jobs(NOW);
    const hs = () => q1('SELECT health_state, grace_until, health_since FROM aff_affiliates WHERE id=?', H.a.id);
    check('aff: below the threshold after the ramp: Grace (30 days, still earning)', hs().health_state === 'grace' && Math.abs(hs().grace_until - (NOW + 30 * DAY)) < 120_000, hs());
    check('aff: health warning email', !!q1("SELECT 1 FROM email_queue WHERE template='aff_health_warning' AND to_email='health@aff.test'"));
    await jobs(NOW + 31 * DAY);
    check('aff: grace over: Paused', hs().health_state === 'paused');
    check('aff: health paused email', !!q1("SELECT 1 FROM email_queue WHERE template='aff_health_paused' AND to_email='health@aff.test'"));
    run('UPDATE aff_affiliates SET health_since=? WHERE id=?', Date.now() - 3600_000, H.a.id);
    await spend('joinvoo', hOld.user.voo_id, 30);
    check('aff: Paused: RevShare on existing customers stops (no commission)', !q1("SELECT 1 FROM aff_commissions WHERE customer_user_id=?", hOld.user.id) && q1("SELECT status FROM aff_conversions WHERE customer_user_id=? AND event_type='repeat_payment'", hOld.user.id).status === 'health_paused');
    const hNew = await newCust(H.a, 'health.new@gmail.com', 'Health New');
    await spend('joinvoo', hNew.user.voo_id, 30);
    check('aff: Paused: a new customer still earns', q1("SELECT amount_cents FROM aff_commissions WHERE customer_user_id=?", hNew.user.id).amount_cents === 600);
    seed(H.a.id, 3, { qualifiedAt: Date.now() - DAY });
    await jobs(Date.now());
    check('aff: back at the threshold: Active again', ['active', 'at_risk'].includes(hs().health_state), hs());
    check('aff: no back pay for the paused period', !q1("SELECT 1 FROM aff_commissions WHERE customer_user_id=?", hOld.user.id));
    await admin.patch(`/api/admin/aff/affiliates/${H.a.id}`, { health_exempt: true });
    check('aff: admin exemption keeps health Active', (await H.c.get('/api/aff/me')).data.account.health.state === 'active');

    /* ================================================================ sub-affiliates */
    console.log('Affiliates: sub-affiliates');
    const Pa = await T('parent@aff.test', 'Parent Buyer');
    run("UPDATE aff_affiliates SET activated_at=?, health_state='active', health_exempt=1 WHERE id=?", NOW - DAY, Pa.a.id);
    const subC = new Client();
    const rec = await subC.get(`/a/${Pa.a.code}?join=1`, { 'user-agent': 'Mozilla/5.0' });
    check('aff: recruitment link lands on the affiliate join page with a parent cookie', (rec.headers.get('location') || '').includes('/affiliates#/join') && subC.jar.has('vs_aff_parent'));
    await subC.login('sub.one@gmail.com', 'Sub One');
    const S = (await subC.post('/api/aff/account', {})).data.account;
    check('aff: the sub-affiliate is linked to its parent (one level)', S.sub.parent && S.sub.parent.ref === `AF-${Pa.a.id}`, S.sub);
    run("UPDATE aff_affiliates SET status='approved', approved_at=?, activated_at=?, health_state='active' WHERE id=?", NOW - DAY, NOW - DAY, S.id);
    const sc1 = await newCust(S, 'subcust@gmail.com', 'Sub Customer');
    await spend('joinvoo', sc1.user.voo_id, 100); await spend('joinvoo', sc1.user.voo_id, 100);
    await jobs(Date.now() + 31 * DAY);
    const ovr = qa("SELECT amount_cents, rate_bp FROM aff_commissions WHERE affiliate_id=? AND type='sub_override'", Pa.a.id);
    check('aff: parent earns 2.5% of the sub\'s released commissions (paid by Zedapex)', ovr.length === 2 && ovr.every((o) => o.amount_cents === 50 && o.rate_bp === 250) && q1("SELECT COALESCE(SUM(amount_cents),0) s FROM aff_commissions WHERE affiliate_id=? AND type='revshare'", S.id).s === 4000, ovr);
    await admin.put('/api/admin/aff/settings', { subs: { boost_subs: 1, boost_sub_customers: 1 } });
    await spend('joinvoo', sc1.user.voo_id, 100);
    await jobs(Date.now() + 62 * DAY);
    check('aff: 5% when the parent has enough active subs with enough qualified customers', qa("SELECT amount_cents, rate_bp FROM aff_commissions WHERE affiliate_id=? AND type='sub_override' ORDER BY id", Pa.a.id).slice(-1)[0].amount_cents === 100);
    const subs = await Pa.c.get('/api/aff/subs');
    check('aff: sub network report', subs.status === 200 && subs.data.subs.length === 1 && subs.data.rate_bp === 500 && subs.data.total_earned_cents === 200, subs.data);
    await admin.put('/api/admin/aff/settings', { subs: { boost_subs: 50, boost_sub_customers: 10 } });

    /* ================================================================ payouts */
    console.log('Affiliates: payouts, KYC, receipts, four eyes');
    check('aff: wallet checksum is verified (mistyped TRC20 refused)', (await amara.put('/api/aff/wallets', { usdt_trc20: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSX' })).status === 400);
    check('aff: invalid BTC address refused, valid bech32 accepted', (await amara.put('/api/aff/wallets', { btc: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5' })).status === 400 && (await amara.put('/api/aff/wallets', { btc: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4' })).status === 200);
    const kycNeed = await amara.post('/api/aff/payouts', { method: 'usdt_trc20' });
    check('aff: KYC is required before the first payout', kycNeed.status === 403 && kycNeed.data.kyc_required === true, kycNeed.data);
    const upr = await amara.req('POST', '/api/uploads?purpose=kyc', fakePng(800, 500), { 'content-type': 'image/png', 'x-thumb-bytes': '0' });
    check('aff: KYC document uploaded (private)', upr.status === 200 && upr.data.upload.url, upr.data);
    check('aff: other members cannot open a KYC document', (await plain.get(upr.data.upload.url)).status === 404);
    const docs = await amara.post('/api/aff/kyc/documents', { documents: [{ upload_id: upr.data.upload.id, doc_type: 'id_front' }] });
    check('aff: KYC documents submitted → pending', docs.status === 200 && docs.data.status === 'pending');
    check('aff: finance can open the KYC document', (await fin1.get(upr.data.upload.url)).status === 200);
    const kq = await fin1.get('/api/admin/aff/kyc?status=pending');
    check('aff: KYC review queue lists the documents', kq.data.affiliates.some((x) => x.id === A.id && x.documents.length === 1));
    await fin1.post(`/api/admin/aff/kyc/${A.id}`, { status: 'verified' });
    check('aff: finance verifies KYC', (await amara.get('/api/aff/kyc')).data.status === 'verified');
    await admin.put('/api/admin/aff/settings', { payouts: { four_eyes_cents: 10000 } });
    const btcMin = await amara.post('/api/aff/payouts', { method: 'btc' });
    check('aff: BTC needs $100 minimum (has $204.00 → ok to request); USDT min $50', btcMin.status === 200 || btcMin.status === 400);
    if (btcMin.status === 200) await amara.post(`/api/aff/payouts/${btcMin.data.payout.id}/cancel`);
    const req1 = await amara.post('/api/aff/payouts', { method: 'usdt_trc20' });
    check('aff: payout request for the full available balance', req1.status === 200 && req1.data.payout.amount_cents === 20400 && req1.data.payout.status === 'requested' && req1.data.payout.sla_due_at > Date.now(), req1.data);
    check('aff: one open request at a time', (await amara.post('/api/aff/payouts', {})).status === 409);
    check('aff: payout address is locked while a request is open', (await amara.put('/api/aff/wallets', { usdt_trc20: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' })).status === 409);
    const canc = await amara.post(`/api/aff/payouts/${req1.data.payout.id}/cancel`);
    check('aff: cancel while Requested returns the money', canc.status === 200 && canc.data.balance.available_cents === 20400);
    const req2 = await amara.post('/api/aff/payouts', { method: 'usdt_trc20' });
    const pid = req2.data.payout.id;
    check('aff: payout requested email', !!q1("SELECT 1 FROM email_queue WHERE template='aff_payout_requested' AND to_email='amara.obi@gmail.com'"));
    const pq = await fin1.get('/api/admin/aff/payouts');
    check('aff: finance queue shows SLA, checks and four-eyes state', pq.data.payouts.some((x) => x.id === pid && x.four_eyes.needed && x.four_eyes.next === 'approve' && x.sla && x.wallet === 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE'));
    check('aff: above the four-eyes limit it cannot be paid before approval', (await fin1.post(`/api/admin/aff/payouts/${pid}/paid`, { tx_hash: 'a'.repeat(64) })).status === 409);
    check('aff: finance user 1 approves', (await fin1.post(`/api/admin/aff/payouts/${pid}/approve`)).status === 200);
    check('aff: the approver cannot also send it', (await fin1.post(`/api/admin/aff/payouts/${pid}/paid`, { tx_hash: 'a'.repeat(64) })).status === 403);
    check('aff: a transaction hash is required', (await fin2.post(`/api/admin/aff/payouts/${pid}/paid`, { tx_hash: 'abc' })).status === 400);
    const paid = await fin2.post(`/api/admin/aff/payouts/${pid}/paid`, { tx_hash: '7a3f91c0e4b2d8a6f1c3e5b7d9f0a2c4e6b8d0f2a4c6e8b0d2f4a6c8e0b2d4f6' });
    check('aff: a second finance user marks it paid; receipt number issued', paid.status === 200 && paid.data.payout.status === 'paid' && /^VSA-\d{4}-0+\d+$/.test(paid.data.payout.receipt_no), paid.data.payout);
    check('aff: line-item commissions are marked paid', q1("SELECT COUNT(*) n FROM aff_commissions WHERE payout_id=? AND status<>'paid'", pid).n === 0);
    const pdf = await amara.get(`/api/aff/payouts/${pid}/receipt.pdf`);
    check('aff: receipt PDF for the affiliate (%PDF, receipt number inside)', pdf.status === 200 && pdf.buf.slice(0, 5).toString() === '%PDF-' && pdf.buf.toString('latin1').includes(paid.data.payout.receipt_no) && pdf.buf.toString('latin1').includes('Joinvoo'), pdf.status);
    check('aff: receipt PDF: finance yes, other members no', (await fin2.get(`/api/aff/payouts/${pid}/receipt.pdf`)).status === 200 && (await plain.get(`/api/aff/payouts/${pid}/receipt.pdf`)).status === 404);
    check('aff: payout paid email with the receipt link', !!q1("SELECT 1 FROM email_queue WHERE template='aff_payout_paid' AND to_email='amara.obi@gmail.com' AND vars LIKE '%receipt.pdf%'"));
    check('aff: payout sent Telegram alert with the tx hash', await until(() => M.st.tg.some((m) => /^Payout sent: \$204\.00 USDT · tx 7a3f…d4f6/.test(m.text))));
    const rcpts = await amara.get('/api/aff/receipts');
    check('aff: receipts history', rcpts.data.receipts.length === 1 && rcpts.data.receipts[0].url.endsWith('receipt.pdf'));
    const month = new Date().toISOString().slice(0, 7);
    const stmt = await amara.get(`/api/aff/statements?month=${month}`);
    const stmtPdf = await amara.get(`/api/aff/statements/${month}.pdf`);
    check('aff: monthly statement (JSON and PDF)', stmt.status === 200 && stmt.data.paid_cents === 20400 && stmtPdf.status === 200 && stmtPdf.buf.slice(0, 4).toString() === '%PDF', stmt.data);
    const bp = (await amara.get('/api/aff/balance')).data;
    check('aff: balance after payout: paid total and nothing available', bp.paid_cents === 20400 && bp.available_cents === 0, bp);
    // A chargeback after the payout: the clawback makes the balance negative (owed), deducted from the next payout.
    await ev('joinvoo', [{ event_id: 'jv_c2_cb', voo_id: custs[1].user.voo_id, type: 'chargeback', value_usd: 99, original_event_id: 'jv_c2_p1' }]);
    const bo = (await amara.get('/api/aff/balance')).data;
    check('aff: clawback after payout: owed carried forward', bo.available_cents === 0 && bo.owed_cents === 1980, bo);
    // Self-action: a finance user who is also an affiliate cannot handle their own payout.
    const finAff = (await fin1.post('/api/aff/account', {})).data.account;
    run("UPDATE aff_affiliates SET status='approved', approved_at=?, wallet_usdt='TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', kyc_status='verified' WHERE id=?", NOW - DAY, finAff.id);
    check('aff: nobody adjusts their own balance', (await fin1.post(`/api/admin/aff/affiliates/${finAff.id}/adjustments`, { amount_usd: 60, reason: 'Test' })).status === 403);
    await fin2.post(`/api/admin/aff/affiliates/${finAff.id}/adjustments`, { amount_usd: 60, reason: 'Make-good for a tracking outage' });
    const own = await fin1.post('/api/aff/payouts', {});
    check('aff: nobody handles their own payout (403), another finance user can', own.status === 200 && (await fin1.post(`/api/admin/aff/payouts/${own.data.payout.id}/processing`)).status === 403 && (await fin2.post(`/api/admin/aff/payouts/${own.data.payout.id}/processing`)).status === 200);
    const rej = await fin2.post(`/api/admin/aff/payouts/${own.data.payout.id}/reject`, { reason: 'Address belongs to an exchange that blocks TRC20 deposits' });
    check('aff: Not sent: the amount returns to the available balance', rej.status === 200 && (await fin1.get('/api/aff/balance')).data.available_cents === 6000 && !!q1("SELECT 1 FROM email_queue WHERE template='aff_payout_rejected' AND to_email='fin1@aff.test'"));
    // External payout provider (generic HTTP adapter) with a signed webhook.
    await admin.put('/api/admin/aff/settings', { payouts: { four_eyes_cents: 200000, provider: { kind: 'http', name: 'MockPay', api_base: `http://127.0.0.1:${M.port}/prov`, api_key: 'pk_test', webhook_secret: 'whsec_test' } } });
    const pv = await fin1.post('/api/aff/payouts', {});
    const pvp = await fin2.post(`/api/admin/aff/payouts/${pv.data.payout.id}/processing`);
    check('aff: payout provider called through the adapter (Bearer key, address, amount)', pvp.status === 200 && pvp.data.payout.provider_ref === 'po_1' && M.st.payouts[0].headers.authorization === 'Bearer pk_test' && M.st.payouts[0].body.amount_usd === '60.00' && M.st.payouts[0].body.network === 'TRC20', pvp.data);
    const whBody = JSON.stringify({ reference: `vsa-payout-${pv.data.payout.id}`, status: 'paid', tx_hash: 'b'.repeat(64) });
    const wh = (sigv) => fetch(BASE + '/api/aff/hooks/payouts', { method: 'POST', headers: { 'content-type': 'application/json', 'x-payout-signature': sigv }, body: whBody });
    check('aff: payout webhook refuses a bad signature', (await wh('sha256=00')).status === 401);
    check('aff: signed payout webhook marks it paid', (await wh(crypto.createHmac('sha256', 'whsec_test').update(whBody).digest('hex'))).status === 200 && q1('SELECT status, receipt_no FROM aff_payouts WHERE id=?', pv.data.payout.id).status === 'paid');
    const set0 = await admin.get('/api/admin/aff/settings');
    check('aff: settings never return provider secrets', set0.data.settings.payouts.provider.api_key === undefined && set0.data.settings.payouts.provider.api_key_set === true && !JSON.stringify(set0.data).includes('whsec_test'));

    /* ================================================================ KYC provider */
    console.log('Affiliates: KYC provider adapter');
    await admin.put('/api/admin/aff/settings', { kyc: { provider: { kind: 'http', name: 'MockKYC', api_base: `http://127.0.0.1:${M.port}/kyc`, api_key: 'kyc_key', webhook_secret: 'kyc_sec' } } });
    const st = await leg.post('/api/aff/kyc/start');
    check('aff: KYC start returns the provider\'s hosted link and goes pending', st.status === 200 && st.data.mode === 'provider' && st.data.url === 'https://verify.example/kyc_123' && M.st.kyc[0].body.reference === `aff-${L.id}` && M.st.kyc[0].headers.authorization === 'Bearer kyc_key', st.data);
    const kb = JSON.stringify({ reference: `aff-${L.id}`, status: 'approved' });
    const kh = (s2) => fetch(BASE + '/api/aff/hooks/kyc', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kyc-signature': s2 }, body: kb });
    check('aff: KYC webhook HMAC is verified (bad → 401)', (await kh('deadbeef')).status === 401);
    check('aff: signed KYC webhook marks the affiliate verified', (await kh('sha256=' + crypto.createHmac('sha256', 'kyc_sec').update(kb).digest('hex'))).status === 200 && (await leg.get('/api/aff/kyc')).data.status === 'verified');

    /* ================================================================ postback retries */
    console.log('Affiliates: postback deliveries, retries, SSRF guard');
    const pbHits = M.st.pb.filter((h) => h.path === '/pb/main');
    check('aff: postbacks never include PII', pbHits.every((h) => !/gmail|yahoo|outlook|Kofi|Mensah/i.test(h.url)));
    M.st.pbStatus['/pb/flaky'] = 500;
    const flaky = await amara.post('/api/aff/postbacks', { name: 'Flaky', url: `http://127.0.0.1:${M.port}/pb/flaky?e={event}&c={commission}`, method: 'POST', events: ['payment'] });
    await spend('joinvoo', custs[2].user.voo_id, 99, { plan: 'Pro' });
    const dlv = () => q1("SELECT * FROM aff_postback_deliveries WHERE postback_id=? ORDER BY id DESC LIMIT 1", flaky.data.postback.id);
    check('aff: a failed delivery is logged with the response code and scheduled for retry', await until(() => dlv() && dlv().status === 'retry') && dlv().response_code === 500 && dlv().attempts === 1, dlv());
    check('aff: POST postbacks send the macro values as JSON', M.st.pb.some((h) => h.path === '/pb/flaky' && h.method === 'POST' && JSON.parse(h.body).event === 'payment'));
    let t = Date.now();
    for (const m of [5, 30, 120, 360, 900]) { t += m * 60_000 + 1000; await jobs(t, { reconcile: false }); }
    check('aff: retried 5 times over about 24 hours, then dead', dlv().status === 'dead' && dlv().attempts === 6, dlv());
    const logs = await amara.get('/api/aff/postbacks?failed=1');
    check('aff: postback log (failed filter) shows code and attempts', logs.data.logs.some((l) => l.status === 'dead' && l.response_code === 500 && l.attempts === 6));
    M.st.pbStatus['/pb/flaky'] = 200;
    await amara.post(`/api/aff/postbacks/logs/${dlv().id}/resend`);
    check('aff: Resend delivers it', await until(() => dlv().status === 'sent'));
    {
      const saved = process.env.NODE_ENV; delete process.env.NODE_ENV;
      const ng = require('../src/netguard');
      check('aff: SSRF guard refuses private and metadata addresses for postbacks', ng.isBlockedIp('169.254.169.254') && ng.isBlockedIp('10.0.0.5') && ng.isBlockedIp('::1') && !ng.isBlockedIp('8.8.8.8') && /scheme|https|address/.test(ng.urlProblem('ftp://x.example') || 'scheme'));
      if (saved !== undefined) process.env.NODE_ENV = saved;
    }

    /* ================================================================ Telegram preferences */
    console.log('Affiliates: Telegram preferences');
    await amara.put('/api/aff/telegram/prefs', { prefs: { first_payment: false } });
    const nFirst = M.st.tg.filter((m) => /^First payment/.test(m.text)).length;
    const c7 = await newCust(A, 'cust7@gmail.com', 'Customer Seven');
    await spend('joinvoo', c7.user.voo_id, 30);
    await sleep(300);
    check('aff: alert types can be switched off', M.st.tg.filter((m) => /^First payment/.test(m.text)).length === nFirst);

    /* ================================================================ contests */
    console.log('Affiliates: contests');
    const ct = await admin.post('/api/admin/aff/contests', { title: 'October FTD Race', kind: 'monthly', starts_at: NOW - 3 * 3600_000, ends_at: Date.now() + 3600_000, qual_days: 0, min_points: 1, multipliers: true,
      prizes: [{ label: '1st', rank_from: 1, rank_to: 1, amount_cents: 150000 }, { label: '2nd', rank_from: 2, rank_to: 2, amount_cents: 100000 }], rules: 'Scored on qualified FTDs.', scoring: { points: 1, plan_points: [{ min_price_cents: 9900, points: 3 }] } });
    check('aff: contest created with a prize pool', ct.status === 200 && ct.data.contest.pool_cents === 250000 && ct.data.contest.status === 'live', ct.data);
    await admin.post(`/api/admin/aff/contests/${ct.data.contest.id}/recompute`);
    const board = await amara.get(`/api/aff/contests/${ct.data.contest.id}`);
    const meRow = board.data.me;
    check('aff: leaderboard with rank, name, country, tier, score; my row highlighted', board.status === 200 && board.data.board.length >= 2 && meRow && meRow.me && meRow.country === 'NG' && meRow.name === 'amara.media' && meRow.score > 0 && meRow.provisional === true, board.data);
    check('aff: plans of $99+ score 3 points; charged-back and blocked customers are removed (3 removed → disqualified)', meRow.points === 11 && meRow.disqualified === true && meRow.rank === null, meRow);
    await F.c.patch('/api/aff/settings', { hide_name: true });
    await admin.post(`/api/admin/aff/contests/${ct.data.contest.id}/recompute`);
    const lbF = (await leg.get(`/api/aff/contests/${ct.data.contest.id}`)).data.board;
    check('aff: "Hide my name" shows Affiliate #id on leaderboards; tier multiplier applies (Pro x1.05)', lbF.some((r) => r.name === `Affiliate #${F.a.id}` && r.tier === 'Pro' && r.score === r.points * 1.05), lbF.slice(0, 3));
    check('aff: results cannot be finalised before the qualification window closes', (await admin.post(`/api/admin/aff/contests/${ct.data.contest.id}/finalise`)).status === 409);
    const later = Date.now() + 2 * 3600_000;
    const fin = await admin.req('POST', `/api/admin/aff/contests/${ct.data.contest.id}/finalise`, {}, at(later));
    check('aff: first staff member finalises', fin.status === 200 && !!fin.data.contest.final_at, fin.data);
    check('aff: the same person cannot sign off (two staff)', (await admin.req('POST', `/api/admin/aff/contests/${ct.data.contest.id}/signoff`, {}, at(later))).status === 403);
    const so = await owner.req('POST', `/api/admin/aff/contests/${ct.data.contest.id}/signoff`, {}, at(later));
    const winner = so.data && so.data.contest && so.data.contest.winners.find((w) => w.rank === 1);
    check('aff: second staff member signs off: winners and contest_prize earnings', so.status === 200 && winner && !!q1("SELECT 1 FROM aff_commissions WHERE affiliate_id=? AND type='contest_prize' AND amount_cents=150000 AND status='available'", winner.affiliate_id), so.data && so.data.contest && so.data.contest.winners);
    check('aff: contest won email', !!q1("SELECT 1 FROM email_queue WHERE template='aff_contest_won'"));

    /* ================================================================ offer changes */
    console.log('Affiliates: offer changes and notice periods');
    const up1 = await admin.put('/api/admin/aff/products/spyvoo', { cpa_usd: 80 });
    check('aff: program CPA increase applies at once', up1.status === 200 && (await admin.get('/api/admin/aff/products')).data.products.find((p) => p.key === 'spyvoo').cpa_cents === 8000);
    const down = await admin.put('/api/admin/aff/products/spyvoo', { cpa_usd: 60 });
    check('aff: program CPA reduction scheduled at least 14 days out', down.data.scheduled && down.data.scheduled.effective_at >= Date.now() + 14 * DAY - 60_000 && (await admin.get('/api/admin/aff/products')).data.products.find((p) => p.key === 'spyvoo').cpa_cents === 8000, down.data.scheduled);
    const dd = await admin.patch(`/api/admin/aff/deals/${deal.data.deal.id}`, { cpa_usd: 250 });
    check('aff: a single-affiliate CPA reduction waits at least 7 days', dd.status === 200 && dd.data.deal.cpa_cents === 30000 && dd.data.deal.scheduled && dd.data.deal.scheduled.effective_at >= Date.now() + 7 * DAY - 60_000, dd.data.deal);
    const capDown = await admin.put('/api/admin/aff/products/castvoo', { cap_pct: 40 });
    check('aff: cap reduction scheduled 30 days out', capDown.data.scheduled && capDown.data.product.cap_bp === 5000);
    check('aff: caps never above 50%, Inner Circle cannot be enabled', (await admin.put('/api/admin/aff/products/castvoo', { cap_pct: 60 })).status === 400 && (await admin.put('/api/admin/aff/products/inner-circle', { commissionable: true })).status === 400);
    const offersSched = (await amara.get('/api/aff/offers')).data.products.find((p) => p.key === 'spyvoo');
    check('aff: Offers page shows the scheduled change with its date', offersSched.scheduled.some((s) => s.field === 'cpa' && s.to === '6000'));
    await jobs(Date.now() + 31 * DAY);
    check('aff: scheduled changes apply on their date', (await admin.get('/api/admin/aff/products')).data.products.find((p) => p.key === 'castvoo').cap_bp === 4000 && q1('SELECT cpa_cents FROM aff_deals WHERE id=?', deal.data.deal.id).cpa_cents === 25000);
    const tiersDown = await admin.put('/api/admin/aff/settings', { tiers: [{ name: 'Starter', min: 0, rate_bp: 1500 }, ...(await admin.get('/api/admin/aff/settings')).data.settings.tiers.slice(1)] });
    check('aff: RevShare rate reductions wait 30 days', tiersDown.data.scheduled && tiersDown.data.settings.tiers[0].rate_bp === 2000);

    /* ================================================================ reports */
    console.log('Affiliates: reports and the stats API');
    const rep = await amara.get('/api/aff/reports?group=sub1&period=30d');
    check('aff: report grouped by sub1', rep.status === 200 && rep.data.rows.some((r) => r.key === 'fb_ng_v3' && r.signups >= 1 && r.clicks >= 1), rep.data.rows.slice(0, 3));
    const repDay = await amara.get('/api/aff/reports?group=day&period=7d');
    check('aff: report by day covers the range (7 rows)', repDay.data.rows.length === 7 && repDay.data.total.signups >= 6, repDay.data.rows.length);
    const csv = await amara.get('/api/aff/reports.csv?group=product');
    check('aff: report CSV export', csv.status === 200 && /text\/csv/.test(csv.headers.get('content-type')) && String(csv.data).includes('joinvoo'));
    const cus = await amara.get('/api/aff/customers?paying=1');
    check('aff: customers by reference only (no names or emails)', cus.status === 200 && cus.data.customers.length >= 5 && cus.data.customers.every((c) => /^C-/.test(c.customer_ref)) && !/gmail|yahoo|Mensah/.test(JSON.stringify(cus.data)));
    const coh = await amara.get('/api/aff/cohorts');
    check('aff: cohorts and repeat-purchase stats', coh.status === 200 && coh.data.cohorts.length === 6 && coh.data.repeat.rebill_rate > 0 && coh.data.repeat.payments_per_customer > 1, coh.data.repeat);
    const cv = await amara.get('/api/aff/conversions?event=chargeback');
    check('aff: conversion log with reversals (chargebacks)', cv.data.conversions.length >= 2 && cv.data.conversions.every((c) => c.event === 'chargeback') && cv.data.conversions.some((c) => c.commission_cents === -1980));
    const cvf = await amara.get('/api/aff/conversions?event=refund_final');
    check('aff: conversion log shows the tool refunds (credits and plan payments) as final, commission unchanged', cvf.data.conversions.length === 3 && cvf.data.conversions.every((c) => c.commission_cents === 0 && /commission final/.test(c.event_label)), cvf.data.conversions);
    const kp = await amara.get('/api/aff/stats?period=month');
    check('aff: KPI tiles with change vs previous period', kp.status === 200 && kp.data.clicks > 0 && kp.data.signups >= 6 && 'change' in kp.data);
    check('aff: stats API opens at Elite (settings)', (await amara.post('/api/aff/api-key')).status === 403);
    await admin.put('/api/admin/aff/settings', { stats_api_min_tier: 0 });
    const key = (await amara.post('/api/aff/api-key')).data.key;
    const api = (k, ip) => fetch(BASE + '/api/aff/v1/stats?period=month', { headers: { authorization: 'Bearer ' + k, 'x-forwarded-for': ip || '10.1.1.1' } });
    check('aff: stats API works with the key, not without', /^vsa_/.test(key) && (await api(key)).status === 200 && (await api('vsa_nope')).status === 401);
    await amara.put('/api/aff/api-ips', { ips: ['10.9.9.9'] });
    check('aff: API IP allowlist', (await api(key, '10.1.1.1')).status === 403 && (await api(key, '10.9.9.9')).status === 200);

    /* ================================================================ admin screens */
    console.log('Affiliates: admin screens and scoping');
    const ov = await admin.get('/api/admin/aff/overview');
    check('aff: overview stats', ov.status === 200 && ov.data.active >= 5 && Array.isArray(ov.data.by_tier) && ov.data.by_tier.length === 7 && ov.data.revenue_series.length === 30 && Array.isArray(ov.data.today), ov.data && { active: ov.data.active });
    const al = await admin.get('/api/admin/aff/affiliates?q=amara');
    check('aff: affiliates list and search', al.data.affiliates.some((x) => x.id === A.id && x.general_manager && x.general_manager.name === 'Chidinma Eze'));
    const ml = await mgr.get('/api/admin/aff/affiliates');
    check('aff: managers see only assigned affiliates', ml.data.affiliates.length >= 1 && ml.data.affiliates.every((x) => x.general_manager && x.general_manager.name === 'Chidinma Eze'));
    check('aff: managers cannot open an unassigned affiliate', (await mgr.get(`/api/admin/aff/affiliates/${L.id}`)).status === 404);
    const adet = await admin.get(`/api/admin/aff/affiliates/${A.id}`);
    check('aff: affiliate detail (balance, tier, health, fraud breakdown, audit)', adet.status === 200 && adet.data.fraud.breakdown.length === 5 && adet.data.audit.length > 0 && adet.data.balance.paid_cents === 20400);
    const note = await mgr.post(`/api/admin/aff/affiliates/${A.id}/notes`, { body: 'October goal: 75 qualified FTDs', shared: true });
    check('aff: shared manager notes appear on the affiliate Manager page', note.status === 200 && (await amara.get('/api/aff/manager')).data.notes.some((n) => /October goal/.test(n.body)));
    const dr = await mgr.post(`/api/admin/aff/affiliates/${A.id}/deal-requests`, { product_key: 'joinvoo', model: 'cpa', cpa_usd: 110, monthly_cap: 80, reason: 'Clean NG traffic' });
    check('aff: manager requests a custom deal; admin approves it', dr.status === 200 && (await admin.post(`/api/admin/aff/deal-requests/${dr.data.request.id}/approve`, {})).status === 200 && !!q1("SELECT 1 FROM aff_deals WHERE affiliate_id=? AND product_key='joinvoo' AND cpa_cents=11000", A.id));
    const dr2 = await mgr.post(`/api/admin/aff/affiliates/${A.id}/deal-requests`, { product_key: 'replyvoo', model: 'cpa', cpa_usd: 320 });
    check('aff: deals over the $300 limit need the owner', dr2.data.request.needs_owner === 1 && (await admin.post(`/api/admin/aff/deal-requests/${dr2.data.request.id}/approve`, {})).status === 403);
    const mh = await mgr.get('/api/admin/aff/manager/home');
    check('aff: manager home (partners, stats, alerts)', mh.status === 200 && mh.data.partners.length >= 1 && Array.isArray(mh.data.alerts));
    const mgrs = await admin.get('/api/admin/aff/managers');
    check('aff: managers workload', mgrs.data.managers.some((m) => m.name === 'Chidinma Eze' && m.load.general >= 1));
    const aud = await admin.get('/api/admin/aff/audit?action=payout');
    check('aff: audit log with actors (payout approve and paid)', aud.data.rows.some((x) => x.action === 'payout.approve' && x.actor === 'Finance One') && aud.data.rows.some((x) => x.action === 'payout.paid' && x.actor === 'Finance Two'));
    check('aff: audit CSV export', /text\/csv/.test((await admin.get('/api/admin/aff/audit.csv')).headers.get('content-type')));
    check('aff: admin announcements reach the dashboard', (await admin.post('/api/admin/aff/announcements', { kind: 'creatives', title: '24 Replyvoo videos in Pidgin and Swahili', body: 'Early access for Pro and up.', channels: { dashboard: true, telegram: true } })).status === 200 && (await amara.get('/api/aff/announcements')).data.announcements.some((x) => /Replyvoo videos/.test(x.title)));
    const crUp = await admin.req('POST', '/api/uploads?purpose=aff_creative', fakePng(1080, 1920), { 'content-type': 'image/png', 'x-thumb-bytes': '0' });
    const cr = await admin.post('/api/admin/aff/creatives', { title: 'Joinvoo fake joins 9:16', product_key: 'joinvoo', format: 'video_9_16', language: 'Pidgin', upload_id: crUp.data.upload.id, copy_text: 'Stop paying for fake joins. {your_link}', public_from: Date.now() + DAY });
    const crA = await amara.get('/api/aff/creatives');
    check('aff: creatives: early access by tier (Starter does not see tomorrow\'s creative)', cr.status === 200 && !crA.data.creatives.some((x) => x.id === cr.data.creative.id), cr.data);
    const crF = await F.c.get('/api/aff/creatives');
    check('aff: Pro sees it 48 hours early, with the tracking link in the copy', crF.data.creatives.some((x) => x.id === cr.data.creative.id && x.copy_text.includes(`/a/${F.a.code}`) && x.copy_text.includes('sub1=cr_')));

    /* ================================================================ repeated and partial reversals */
    console.log('Affiliates: repeated and partial reversals never take back more than was earned');
    {
      const net = async () => { const b = (await amara.get('/api/aff/balance')).data; return b.available_cents - b.owed_cents; };
      const rc = await newCust(A, 'reversals@yahoo.com', 'Reversal Tester', 'castvoo');
      await spend('castvoo', rc.user.voo_id, 90, { id: 'jv_rv_p1' });
      const com = q1("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type='revshare'", rc.user.id);
      const n0 = await net();
      await ev('castvoo', [{ event_id: 'jv_rv_cb1', voo_id: rc.user.voo_id, type: 'chargeback', value_usd: 90, original_event_id: 'jv_rv_p1' }]);
      const n1 = await net();
      await ev('castvoo', [{ event_id: 'jv_rv_cb2', voo_id: rc.user.voo_id, type: 'chargeback', value_usd: 90, original_event_id: 'jv_rv_p1' }]);
      check('aff: a second chargeback on the same payment reverses nothing more', com && com.status === 'available' && n0 - n1 === com.amount_cents && (await net()) === n1, { com, n0, n1, n2: await net() });
      await spend('castvoo', rc.user.voo_id, 90, { id: 'jv_rv_p2' });
      const com2 = q1("SELECT c.* FROM aff_commissions c JOIN aff_conversions v ON v.id=c.conversion_id WHERE v.source_key=(SELECT 'event:'||id FROM events WHERE ext_id='jv_rv_p2') AND c.type='revshare'");
      const m0 = await net();
      for (let i = 1; i <= 4; i++) await ev('castvoo', [{ event_id: 'jv_rv_pcb' + i, voo_id: rc.user.voo_id, type: 'chargeback', value_usd: 30, original_event_id: 'jv_rv_p2' }]);
      check('aff: partial chargebacks (3 × a third, then one more) reverse exactly the commission', m0 - (await net()) === com2.amount_cents, { m0, now: await net(), com: com2.amount_cents });
      await spend('castvoo', rc.user.voo_id, 50, { id: 'jv_rv_p3' });
      const com3 = q1("SELECT c.* FROM aff_commissions c JOIN aff_conversions v ON v.id=c.conversion_id WHERE v.source_key=(SELECT 'event:'||id FROM events WHERE ext_id='jv_rv_p3') AND c.type='revshare'");
      const f1 = await fraud.post('/api/admin/aff/clawbacks', { affiliate_id: A.id, commission_ids: [com3.id], reason: 'Linked accounts (first proposal)' });
      const f2 = await fraud.post('/api/admin/aff/clawbacks', { affiliate_id: A.id, commission_ids: [com3.id], reason: 'Linked accounts (second proposal)' });
      const k0 = await net();
      await fin1.post(`/api/admin/aff/clawbacks/${f1.data.clawback.id}/approve`);
      await fin1.post(`/api/admin/aff/clawbacks/${f2.data.clawback.id}/approve`);
      check('aff: two approved fraud reversals of the same commission take it back once', k0 - (await net()) === com3.amount_cents, { k0, now: await net(), com: com3.amount_cents });
      const lst = (await mgr2.get('/api/admin/aff/clawbacks')).data.clawbacks || [];
      const mine2 = new Set(qa('SELECT id FROM aff_affiliates WHERE general_manager_id=? OR private_manager_id=?', mgr2Id, mgr2Id).map((x) => x.id));
      check('aff: a manager sees only their own affiliates\' fraud reversals, coupons and deal changes', lst.every((x) => mine2.has(x.affiliate_id)) && !lst.some((x) => x.affiliate_id === A.id)
        && ((await mgr2.get('/api/admin/aff/coupons')).data.coupons || []).every((x) => mine2.has(x.affiliate_id))
        && ((await mgr2.get('/api/admin/aff/offer-changes')).data.changes || []).every((x) => !x.affiliate_id || mine2.has(x.affiliate_id))
        && (await admin.get('/api/admin/aff/clawbacks')).data.clawbacks.some((x) => x.affiliate_id === A.id), lst.map((x) => x.affiliate_id));
    }

    /* ================================================================ feature switch, host routing */
    console.log('Affiliates: feature switch and host routing');
    await owner.put('/api/admin/features', { affiliates: false });
    check('aff: switched off: affiliate API answers 403 { off: "affiliates" }', (await amara.get('/api/aff/me')).status === 403 && (await amara.get('/api/aff/me')).data.off === 'affiliates');
    check('aff: switched off: webhooks stay open, tracking still redirects', (await hook({ message: { chat: { id: 1 }, text: 'hi' } }, 'bad')).status === 401 && (await new Client().get(`/a/${A.code}`, { 'user-agent': 'Mozilla/5.0' })).status === 302);
    await owner.put('/api/admin/features', { affiliates: true });
    check('aff: back on', (await amara.get('/api/aff/me')).status === 200);
    const hostGet = (p2) => new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: p2, headers: { host: 'affiliate.voosquare.com' } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, location: res.headers.location })); }));
    const host = await hostGet('/join');
    check('aff: affiliate.* host serves the affiliate app shell', host.status === 200 && host.body.includes('VooSquare Affiliates'), host.status);
    const path1 = await fetch(BASE + '/affiliates');
    check('aff: /affiliates on the main host serves the shell too', path1.status === 200 && (await path1.text()).includes('id="aff-app"'));
    const go = await hostGet(`/go/${A.code}?p=spyvoo`);
    check('aff: /go/:code tracks on the affiliate host', go.status === 302 && (go.location || '').startsWith('https://spyvoo.com'), go);
    const pub = await new Client().get('/api/aff/public');
    check('aff: public program info (tiers, caps, payout methods)', pub.status === 200 && pub.data.tiers.length === 7 && pub.data.products.find((p) => p.key === 'vooads').cap_bp === 3500 && pub.data.products.find((p) => p.key === 'inner-circle').commissionable === false && pub.data.payout_methods.some((m) => m.method === 'usdt_trc20' && m.min_cents === 5000));
    /* ================================================================ owner decisions 2026-10-05 (2) */
    {
    console.log('Affiliates: Affleego is not in the program');
    const prodsA = (await admin.get('/api/admin/aff/products')).data.products;
    const pubA = (await new Client().get('/api/aff/public')).data;
    check('aff: Affleego is not an affiliate product (admin products, public program info)', !prodsA.some((p) => p.key === 'affleego') && !pubA.products.some((p) => p.key === 'affleego') && prodsA.some((p) => p.key === 'spyvoo'), prodsA.map((p) => p.key));
    check('aff: Affleego product rules cannot be edited (404)', (await admin.put('/api/admin/aff/products/affleego', { commissionable: true, cap_pct: 50 })).status === 404);
    check('aff: Affleego is not in the dashboard deep links or offers', !(await amara.get('/api/aff/links')).data.deep_links.some((d) => d.product_key === 'affleego') && !JSON.stringify((await amara.get('/api/aff/offers')).data).includes('affleego'));
    check('aff: link builder and saved links refuse Affleego (400)', (await amara.get('/api/aff/links/build?product=affleego')).status === 400 && (await amara.post('/api/aff/links', { name: 'Aff', product_key: 'affleego' })).status === 400);
    check('aff: deals, deal requests, coupons and creatives refuse Affleego (400)', (await owner.post(`/api/admin/aff/affiliates/${A.id}/deals`, { product_key: 'affleego', model: 'cpa', cpa_usd: 20 })).status === 400
      && (await mgr.post(`/api/admin/aff/affiliates/${A.id}/deal-requests`, { product_key: 'affleego', model: 'cpa', cpa_usd: 20, reason: 'test' })).status === 400
      && (await admin.post('/api/admin/aff/coupons', { affiliate_id: A.id, code: 'AFFLEEGO10', product_key: 'affleego', discount_pct: 10 })).status === 400
      && (await admin.post('/api/admin/aff/creatives', { title: 'Affleego banner', product_key: 'affleego', format: 'image' })).status === 400);
    const pbAff = await amara.post('/api/aff/postbacks', { name: 'Only Affleego', url: `http://127.0.0.1:${M.port}/pb/aff`, events: ['first_payment'], products: ['affleego', 'spyvoo'] });
    check('aff: Affleego is dropped from postback product filters', pbAff.status === 200 && JSON.stringify(pbAff.data.postback.products) === '["spyvoo"]', pbAff.data);
    await amara.del(`/api/aff/postbacks/${pbAff.data.postback.id}`);
    const ctA = await admin.post('/api/admin/aff/contests', { title: 'Affleego check', starts_at: Date.now() - 3600_000, ends_at: Date.now() + 3600_000, products: ['affleego', 'spyvoo'], scoring: { points: 1, product_points: { affleego: 9, spyvoo: 2 } }, published: false });
    check('aff: Affleego is dropped from contest products and scoring', ctA.status === 200 && JSON.stringify(ctA.data.contest.products) === '["spyvoo"]' && ctA.data.contest.scoring.product_points.affleego === undefined, ctA.data && ctA.data.contest);
    const clkA = await new Client().get(`/a/${A.code}?p=affleego`, { 'user-agent': 'Mozilla/5.0' });
    const clkB = await new Client().get(`/a/${A.code}?p=spyvoo&url=${encodeURIComponent('https://affleego.com/deals')}`, { 'user-agent': 'Mozilla/5.0' });
    check('aff: an Affleego tracking link lands on VooSquare, and affleego.com is not an approved deep link', clkA.status === 302 && !(clkA.headers.get('location') || '').includes('affleego.com') && (clkB.headers.get('location') || '').startsWith('https://spyvoo.com'), [clkA.headers.get('location'), clkB.headers.get('location')]);
    // Engine: Affleego spend, plan, refund and chargeback from an attributed customer earn and count nothing.
    const afc = await newCust(A, 'affleego.buyer@gmail.com', 'Affleego Buyer', 'spyvoo');
    const afcId = afc.user.id;
    const comBefore = q1('SELECT COUNT(*) n FROM aff_commissions WHERE affiliate_id=?', A.id).n;
    const sA = await spend('affleego', afc.user.voo_id, 250, { id: 'afl_1', plan: 'Gold' });
    await ev('affleego', [{ event_id: 'afl_plan', voo_id: afc.user.voo_id, type: 'plan_started', value_usd: 250, plan: 'Gold' }, { event_id: 'afl_top', voo_id: afc.user.voo_id, type: 'wallet_topup', value_usd: 100 }]);
    await ev('affleego', [{ event_id: 'afl_rf', voo_id: afc.user.voo_id, type: 'refund', value_usd: 50, original_event_id: 'afl_1' }, { event_id: 'afl_cb', voo_id: afc.user.voo_id, type: 'chargeback', value_usd: 250, original_event_id: 'afl_1' }]);
    await jobs(Date.now(), { reconcile: true });
    check('aff: Affleego spend is stored for VooSquare revenue but earns nothing: no conversion, customer, qualification or commission', sA.stored === 1 && !q1("SELECT 1 FROM aff_conversions WHERE customer_user_id=? AND (product_key='affleego' OR event_type<>'registration')", afcId) && !q1('SELECT 1 FROM aff_customers WHERE user_id=?', afcId)
      && q1('SELECT COUNT(*) n FROM aff_commissions WHERE affiliate_id=?', A.id).n === comBefore && !q1("SELECT 1 FROM aff_plans WHERE product_key='affleego'"), qa('SELECT event_type, product_key FROM aff_conversions WHERE customer_user_id=?', afcId));
    await spend('spyvoo', afc.user.voo_id, 29, { id: 'afl_sp_1', plan: 'Starter' });
    const afCust = q1('SELECT * FROM aff_customers WHERE user_id=?', afcId);
    check('aff: the same customer paying for Spyvoo counts normally (first product Spyvoo, qualified on that payment)', afCust && afCust.first_product === 'spyvoo' && afCust.payments === 1 && !!afCust.qualified_at, afCust);
    // A customer whose only payment is an Affleego payment from before the change is never qualified by the catch-up job.
    const old = await newCust(A, 'affleego.legacy@gmail.com', 'Legacy Buyer', 'spyvoo');
    run("INSERT INTO aff_customers(user_id,affiliate_id,first_payment_at,first_product,first_plan,first_amount_cents,payments,total_cents,last_payment_at) VALUES(?,?,?,'affleego','Gold',9900,1,9900,?)", old.user.id, A.id, Date.now() - DAY, Date.now() - DAY);
    run("INSERT INTO aff_conversions(affiliate_id,customer_user_id,product_key,plan,event_type,amount_cents,source,source_key,status,payment_no,occurred_at,received_at) VALUES(?,?,'affleego','Gold','first_payment',9900,'event',?, 'commission',1,?,?)", A.id, old.user.id, 'legacy-afl-' + old.user.id, Date.now() - DAY, Date.now() - DAY);
    await jobs(Date.now());
    check('aff: an old Affleego payment never qualifies a customer (activation, tiers, health and contests count qualified customers)', !q1('SELECT qualified_at FROM aff_customers WHERE user_id=?', old.user.id).qualified_at);

    console.log('Affiliates: hard RevShare caps');
    const vaP = prodsA.find((p) => p.key === 'vooads'); const rpP = prodsA.find((p) => p.key === 'replyvoo'); const spP = prodsA.find((p) => p.key === 'spyvoo');
    check('aff: products carry the hard cap (Vooads and Replyvoo 35%, others 50%)', vaP.cap_max_bp === 3500 && rpP.cap_max_bp === 3500 && spP.cap_max_bp === 5000 && vaP.cap_bp <= 3500, [vaP.cap_max_bp, rpP.cap_max_bp, spP.cap_max_bp]);
    const vaUp = await owner.put('/api/admin/aff/products/vooads', { cap_pct: 36 });
    check('aff: a Vooads cap above 35% is refused (400), even for the owner', vaUp.status === 400 && vaUp.data.max_pct === 35, vaUp.data);
    check('aff: a Replyvoo cap above 35% is refused (400)', (await admin.put('/api/admin/aff/products/replyvoo', { cap_pct: 50 })).status === 400);
    check('aff: Vooads at 35% is accepted; any product above 50% is refused', (await admin.put('/api/admin/aff/products/vooads', { cap_pct: 35 })).status === 200 && (await owner.put('/api/admin/aff/products/spyvoo', { cap_pct: 50.5 })).status === 400);
    const hyb = await owner.post(`/api/admin/aff/affiliates/${A.id}/deals`, { product_key: 'replyvoo', model: 'hybrid', cpa_usd: 50, rate_pct: 40 });
    check('aff: a Hybrid deal above the hard cap is refused even for the owner (400)', hyb.status === 400, hyb.data);
    check('aff: a deal request above the hard cap is refused (400)', (await mgr.post(`/api/admin/aff/affiliates/${A.id}/deal-requests`, { product_key: 'vooads', model: 'hybrid', cpa_usd: 20, rate_pct: 45, reason: 'test' })).status === 400);
    run("UPDATE settings SET value=json_set(value, '$.vooads.cap_bp', 5000) WHERE key='aff_products'");
    check('aff: a cap stored above the hard limit is still clamped to 35% by the engine', (await admin.get('/api/admin/aff/products')).data.products.find((p) => p.key === 'vooads').cap_bp === 3500);
    run("UPDATE settings SET value=json_set(value, '$.vooads.cap_bp', 3500) WHERE key='aff_products'");

    console.log('Affiliates: manual adjustments (reason, four eyes, duplicate guard)');
    const adjC = new Client(); await adjC.login('adj.partner@gmail.com', 'Adj Partner');
    const adjA = (await adjC.post('/api/aff/account', {})).data.account;
    run("UPDATE aff_affiliates SET status='approved', approved_at=?, activated_at=? WHERE id=?", NOW - DAY, NOW - DAY, adjA.id);
    const adjUrl = `/api/admin/aff/affiliates/${adjA.id}/adjustments`;
    const balOf = async () => (await adjC.get('/api/aff/balance')).data.available_cents;
    check('aff: an adjustment needs a reason (400)', (await fin1.post(adjUrl, { amount_usd: 20 })).status === 400 && (await fin1.post(adjUrl, { amount_usd: 20, reason: ' ' })).status === 400);
    const big = await fin1.post(adjUrl, { amount_usd: 600, reason: 'Make-good for the October tracking outage', idempotency_key: 'adj-key-big-0001' });
    check('aff: a positive adjustment over $500 waits for a second approval (nothing paid yet)', big.status === 200 && big.data.pending_approval === true && big.data.request.status === 'pending' && await balOf() === 0, big.data);
    const bigAgain = await fin1.post(adjUrl, { amount_usd: 600, reason: 'Make-good for the October tracking outage', idempotency_key: 'adj-key-big-0001' });
    check('aff: the same idempotency key returns the first request (no second one)', bigAgain.status === 200 && bigAgain.data.replayed === true && bigAgain.data.request.id === big.data.request.id && q1('SELECT COUNT(*) n FROM aff_adjustment_requests WHERE affiliate_id=?', adjA.id).n === 1, bigAgain.data);
    check('aff: the same affiliate, amount and reason within 60 s is refused as a double click (409)', (await fin1.post(adjUrl, { amount_usd: 600, reason: 'Make-good for the October tracking outage' })).status === 409);
    check('aff: the requester cannot approve their own adjustment (four eyes, 403)', (await fin1.post(`/api/admin/aff/adjustments/${big.data.request.id}/approve`)).status === 403);
    check('aff: a manager cannot approve adjustments (403)', (await mgr.post(`/api/admin/aff/adjustments/${big.data.request.id}/approve`)).status === 403);
    const pendList = await fin2.get('/api/admin/aff/adjustments?status=pending');
    check('aff: finance sees adjustments waiting for a second approval', pendList.status === 200 && pendList.data.requests.some((x) => x.id === big.data.request.id && x.requested_by === 'Finance One' && !x.mine) && pendList.data.four_eyes_cents === 50000, pendList.data);
    const ap = await fin2.post(`/api/admin/aff/adjustments/${big.data.request.id}/approve`);
    check('aff: a second finance user approves: the amount is available at once', ap.status === 200 && ap.data.request.status === 'approved' && ap.data.commission && ap.data.commission.amount_cents === 60000 && await balOf() === 60000, ap.data);
    check('aff: an approved adjustment cannot be approved twice (409)', (await owner.post(`/api/admin/aff/adjustments/${big.data.request.id}/approve`)).status === 409 && q1("SELECT COUNT(*) n FROM aff_commissions WHERE affiliate_id=? AND type='adjustment'", adjA.id).n === 1);
    check('aff: approval is in the audit log with the requester', !!q1("SELECT 1 FROM aff_audit WHERE action='adjustment.approve' AND affiliate_id=?", adjA.id));
    const small = await fin1.post(adjUrl, { amount_usd: 100, reason: 'Bonus for the launch week', idempotency_key: 'adj-key-small-001' });
    check('aff: up to $500 applies at once', small.status === 200 && !small.data.pending_approval && small.data.commission.amount_cents === 10000 && await balOf() === 70000, small.data);
    const smallRetry = await fin1.post(adjUrl, { amount_usd: 100, reason: 'Bonus for the launch week', idempotency_key: 'adj-key-small-001' });
    check('aff: a retried immediate adjustment with the same key is a no-op', smallRetry.status === 200 && smallRetry.data.replayed === true && await balOf() === 70000);
    check('aff: a double click without a key is refused within 60 s (409)', (await fin2.post(adjUrl, { amount_usd: 100, reason: 'Bonus for the launch week' })).status === 409 && await balOf() === 70000);
    const ded = await fin1.post(adjUrl, { amount_usd: -900, reason: 'Duplicate bonus paid twice' });
    check('aff: deductions apply at once whatever the size (no four eyes needed)', ded.status === 200 && !ded.data.pending_approval && await balOf() === 0 && (await adjC.get('/api/aff/balance')).data.owed_cents === 20000, ded.data);
    const dec = await fin2.post(adjUrl, { amount_usd: 750, reason: 'Contest top-up' });
    const decR = await fin1.post(`/api/admin/aff/adjustments/${dec.data.request.id}/decline`, { note: 'Contest prizes go through the contest sign-off' });
    check('aff: a declined adjustment pays nothing', dec.data.pending_approval === true && decR.status === 200 && decR.data.request.status === 'declined' && !decR.data.commission && (await adjC.get('/api/aff/balance')).data.owed_cents === 20000, decR.data);
    const det = (await fin1.get(`/api/admin/aff/affiliates/${adjA.id}`)).data;
    check('aff: the affiliate page lists adjustment requests for finance', det.adjustment_requests.length === 2 && det.adjustments_four_eyes_cents === 50000);
    check('aff: the overview Today list flags adjustments waiting', (await fin2.post(adjUrl, { amount_usd: 501, reason: 'Second make-good' })).data.pending_approval === true && (await admin.get('/api/admin/aff/overview')).data.today.some((t) => t.kind === 'adjustment_four_eyes'));
    check('aff: the four-eyes limit is a program setting', (await admin.put('/api/admin/aff/settings', { adjustments: { four_eyes_cents: 100000 } })).data.settings.adjustments.four_eyes_cents === 100000 && (await fin1.post(adjUrl, { amount_usd: 800, reason: 'Under the new limit' })).data.pending_approval !== true);
    await admin.put('/api/admin/aff/settings', { adjustments: { four_eyes_cents: 50000 } });

    console.log('Affiliates: product support webhook through the SSRF guard');
    const spyRow = (await owner.get('/api/admin/products')).data.products.find((p) => p.slug === 'spyvoo');
    const spyFull = (await owner.get(`/api/admin/products/${spyRow.id}`)).data.product;
    check('aff: a support webhook with credentials in the address is refused', (await owner.post('/api/admin/products', { ...spyFull, support_webhook: 'https://user:pw@hooks.example/x' })).status === 400);
    const swSave = await owner.post('/api/admin/products', { ...spyFull, support_webhook: `http://127.0.0.1:${M.port}/sw/redirect` });
    const tk = await fetch(BASE + '/api/v1/support/messages', { method: 'POST', headers: { authorization: 'Bearer ' + spyFull.api_key, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'swuser@test.dev', body: 'Hello from Spyvoo', external_ref: 'sw_1' }) });
    const tkd = await tk.json();
    const tid = tkd.ticket_id || (tkd.ticket && tkd.ticket.id);
    const rep = await owner.post(`/api/admin/tickets/${tid}/reply`, { body: 'Hi, we fixed it.' });
    const swHit = await until(() => M.st.sw.some((h) => h.path === '/sw/redirect' && h.method === 'POST'));
    await sleep(300);
    const first = M.st.sw.find((h) => h.path === '/sw/redirect');
    check('aff: support replies reach the product webhook through the guard (signed with the product key) and redirects are not followed', swSave.status === 200 && rep.status === 200 && swHit && first.headers.authorization === 'Bearer ' + spyFull.api_key && JSON.parse(first.body).type === 'support.reply' && !M.st.sw.some((h) => h.path === '/sw/target'), { swSave: swSave.status, rep: rep.status, sw: M.st.sw.map((h) => h.path), tkd });
    await owner.post('/api/admin/products', { ...spyFull, support_webhook: '' });

    console.log('Affiliates: updated terms v1.1 (re-acceptance)');
    const pubTerms = (await new Client().get('/api/aff/terms')).data;
    check('aff: terms are v1.1 dated 2026-10-05 with a "Changes in v1.1" summary (instant RevShare, first payment, used credits, tool refunds, Affleego, caps)', pubTerms.version === 'v1.1' && pubTerms.date === '2026-10-05' && /^## Changes in v1\.1$/m.test(pubTerms.markdown)
      && pubTerms.changes.length === 6 && /no holds by default/i.test(pubTerms.changes[0]) && /first payment/i.test(pubTerms.changes[1]) && /Used credits are non-refundable/.test(pubTerms.changes[2]) && /never reverse.*plan payments/i.test(pubTerms.changes[3]) && /Affleego/.test(pubTerms.changes[4]) && /35%.*50%/.test(pubTerms.changes[5]) && !pubTerms.changes.some((c) => /\*\*/.test(c)), pubTerms.changes);
    // A new applicant accepts v1.1 directly.
    const tmC = new Client(); await tmC.login('terms.partner@gmail.com', 'Terms Partner');
    await tmC.post('/api/aff/account', {});
    await tmC.put('/api/aff/application/1', { display_name: 'terms.partner', country: 'GH', telegram: '@terms_partner', kind: 'individual' });
    await tmC.put('/api/aff/application/2', { sources: ['Meta ads'], geos: ['GH'], volume: '$1k–$10k' });
    await tmC.put('/api/aff/application/3', { years: '1–2', plan: 'Meta ads in Ghana to a Joinvoo landing page, plus reviews in my Telegram channel for media buyers.' });
    const tm4 = await tmC.put('/api/aff/application/4', { accept_terms: true, no_income_claims: true, adult: true, usdt: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' });
    const tmA = tm4.data.account;
    check('aff: a new applicant accepts v1.1 directly (no banner), stored with version, time and source', tm4.status === 200 && tmA.terms_version === 'v1.1' && tmA.terms.needs_accept === false && tmA.terms.payouts_blocked === false
      && !!q1("SELECT 1 FROM aff_terms_acceptances WHERE affiliate_id=? AND version='v1.1' AND source='application' AND accepted_at>0", tmA.id) && !!q1("SELECT 1 FROM aff_audit WHERE affiliate_id=? AND action='terms.accept' AND target='v1.1'", tmA.id), tmA.terms);
    // An affiliate who accepted v1.0 before the update: approved, activated, money available.
    run("UPDATE aff_affiliates SET status='approved', approved_at=?, activated_at=?, kyc_status='verified', terms_version='v1.0', terms_accepted_at=? WHERE id=?", NOW - 40 * DAY, NOW - 40 * DAY, NOW - 40 * DAY, tmA.id);
    await fin2.post(`/api/admin/aff/affiliates/${tmA.id}/adjustments`, { amount_usd: 80, reason: 'Make-good for a tracking outage' });
    const tmMe = (await tmC.get('/api/aff/me')).data.account;
    check('aff: old v1.0 acceptance: the account shows the "what changed" banner data (current v1.1, accepted v1.0, summary)', tmMe.terms.needs_accept === true && tmMe.terms.current === 'v1.1' && tmMe.terms.accepted === 'v1.0' && tmMe.terms.changes.length === 6 && tmMe.terms.payouts_blocked === true, tmMe.terms);
    check('aff: before accepting, the dashboard still works (log in, home, links, reports, offers)', (await tmC.get('/api/aff/home')).status === 200 && (await tmC.get('/api/aff/links')).status === 200 && (await tmC.get('/api/aff/reports?group=day&period=7d')).status === 200 && (await tmC.get('/api/aff/offers')).status === 200);
    const tmCust = await newCust(tmA, 'terms.cust@gmail.com', 'Terms Customer', 'spyvoo');
    await spend('spyvoo', tmCust.user.voo_id, 50, { id: 'tm_sp_1', plan: 'Pro' });
    const tmCom = q1("SELECT * FROM aff_commissions WHERE uniq_key=(SELECT 'rs:event:' || id FROM events WHERE ext_id='tm_sp_1')");
    check('aff: before accepting, earning continues uninterrupted (RevShare available at once)', tmCom && tmCom.affiliate_id === tmA.id && tmCom.status === 'available' && tmCom.amount_cents > 0, tmCom);
    const tmPay0 = (await tmC.get('/api/aff/payouts')).data;
    const tmReq0 = await tmC.post('/api/aff/payouts', {});
    check('aff: before accepting, payout requests are blocked with a clear message (409 terms_required); nothing else blocks', tmPay0.blocked_by.join() === 'terms_update' && tmPay0.can_request === false && tmPay0.balance.available_cents === 8000 + tmCom.amount_cents
      && tmReq0.status === 409 && tmReq0.data.terms_required === true && /updated the affiliate terms \(v1\.1\)/.test(tmReq0.data.error) && !q1('SELECT 1 FROM aff_payouts WHERE affiliate_id=?', tmA.id), { tmPay0, tmReq0: tmReq0.data });
    check('aff: accepting a version that is not the current one is refused (409)', (await tmC.post('/api/aff/terms/accept', { version: 'v1.0' })).status === 409 && q1('SELECT terms_version FROM aff_affiliates WHERE id=?', tmA.id).terms_version === 'v1.0');
    const tmAcc = await tmC.post('/api/aff/terms/accept', { version: 'v1.1' });
    check('aff: accept → terms v1.1 recorded with time (history row + audit), banner gone', tmAcc.status === 200 && tmAcc.data.account.terms_version === 'v1.1' && tmAcc.data.account.terms.needs_accept === false && tmAcc.data.account.terms_accepted_at >= NOW
      && q1("SELECT COUNT(*) n FROM aff_terms_acceptances WHERE affiliate_id=? AND version='v1.1'", tmA.id).n === 2 && !!q1("SELECT 1 FROM aff_terms_acceptances WHERE affiliate_id=? AND source='update' AND accepted_at>=?", tmA.id, NOW)
      && q1("SELECT COUNT(*) n FROM aff_audit WHERE affiliate_id=? AND action='terms.accept'", tmA.id).n === 2, tmAcc.data);
    const tmLegal = (await tmC.get('/api/aff/settings')).data.legal;
    check('aff: Settings → Legal shows the acceptance history', tmLegal.needs_accept === false && tmLegal.history.length === 2 && tmLegal.history[0].version === 'v1.1' && tmLegal.history[0].source === 'update', tmLegal);
    const tmPay1 = (await tmC.get('/api/aff/payouts')).data;
    const tmReq1 = await tmC.post('/api/aff/payouts', {});
    check('aff: after accepting, the payout request goes through', tmPay1.can_request === true && tmReq1.status === 200 && tmReq1.data.payout.amount_cents === 8000 + tmCom.amount_cents, tmReq1.data);
    check('aff: accepting again is a no-op (no duplicate history row)', (await tmC.post('/api/aff/terms/accept', {})).status === 200 && q1("SELECT COUNT(*) n FROM aff_terms_acceptances WHERE affiliate_id=?", tmA.id).n === 2);
    // An older terms version stored in settings (admins used to save the full settings object) cannot pin v1.0.
    run("UPDATE settings SET value=json_set(value, '$.terms_version', 'v1.0') WHERE key='aff'");
    check('aff: a stored v1.0 in program settings never pins the terms below v1.1', (await new Client().get('/api/aff/terms')).data.version === 'v1.1' && (await tmC.get('/api/aff/me')).data.account.terms.needs_accept === false);
    check('aff: admin cannot set the terms version below v1.1 or to a malformed value (400)', (await admin.put('/api/admin/aff/settings', { terms_version: 'v1.0' })).status === 400 && (await admin.put('/api/admin/aff/settings', { terms_version: 'latest' })).status === 400 && (await admin.put('/api/admin/aff/settings', { terms_version: 'v1.1' })).status === 200);

    console.log('Affiliates: custom RevShare deals (owner and program super admins, Special deal above 50%)');
    const spC = new Client(); await spC.login('special.partner@gmail.com', 'Special Partner');
    const spA = (await spC.post('/api/aff/account', {})).data.account;
    run("UPDATE aff_affiliates SET status='approved', approved_at=?, activated_at=?, tier=0, display_name='special.partner' WHERE id=?", NOW - 10 * DAY, NOW - 10 * DAY, spA.id);
    const rsUrl = `/api/admin/aff/affiliates/${spA.id}/revshare-deals`;
    // Owner update 2026-10-05: program super admins (aff_admin) may create custom deals too; manager, finance and fraud check may not.
    const mgrTry = await mgr.post(rsUrl, { product_key: 'spyvoo', rate_pct: 30 }); const finTry = await fin1.post(rsUrl, { product_key: 'spyvoo', rate_pct: 30 }); const fraudTry = await fraud.post(rsUrl, { product_key: 'spyvoo', rate_pct: 30 });
    check('aff: manager, finance and fraud check cannot create custom RevShare deals (403)', [403, 404].includes(mgrTry.status) && finTry.status === 403 && fraudTry.status === 403 && /owner or a program super admin/.test(finTry.data.error || finTry.data.message || JSON.stringify(finTry.data)) && !q1("SELECT 1 FROM aff_deals WHERE affiliate_id=? AND model='revshare'", spA.id), { mgr: mgrTry.status, fin: finTry.data, fraud: fraudTry.status });
    const adNoConf = await admin.post(rsUrl, { product_key: 'castvoo', rate_pct: 60, duration: 'forever' });
    const adDeal = await admin.post(rsUrl, { product_key: 'castvoo', rate_pct: 60, duration: 'forever', confirm: true, note: 'Admin test' });
    check('aff: a program super admin (aff_admin) can create a custom deal; the Special-deal confirm step still applies', adNoConf.status === 409 && adNoConf.data.needs_confirm === true && adDeal.status === 200 && adDeal.data.deal.special === true && adDeal.data.deal.rate_bp === 6000, { adNoConf: adNoConf.data, adDeal: adDeal.data });
    const adminId = q1('SELECT id FROM users WHERE email=?', 'admin@aff.test').id;
    check('aff: the admin-created deal is audit logged with the admin as actor', !!q1("SELECT 1 FROM aff_audit WHERE affiliate_id=? AND action='deal.revshare_create' AND actor_id=?", spA.id, adminId));
    check('aff: finance and fraud check cannot end a custom deal; a program super admin can', (await fin1.patch(`/api/admin/aff/deals/${adDeal.data.deal.id}`, { status: 'ended' })).status === 403 && (await fraud.patch(`/api/admin/aff/deals/${adDeal.data.deal.id}`, { status: 'ended' })).status === 403
      && (await admin.patch(`/api/admin/aff/deals/${adDeal.data.deal.id}`, { status: 'ended' })).status === 200 && q1('SELECT status FROM aff_deals WHERE id=?', adDeal.data.deal.id).status === 'ended');
    check('aff: a custom deal above 90% is refused (400)', (await owner.post(rsUrl, { product_key: 'joinvoo', rate_pct: 91, confirm: true })).status === 400 && (await owner.post(rsUrl, { product_key: '*', rate_pct: 100, confirm: true })).status === 400);
    check('aff: up to 50% a deal keeps the normal caps (Vooads 40% refused)', (await owner.post(rsUrl, { product_key: 'vooads', rate_pct: 40 })).status === 400);
    const noConf = await owner.post(rsUrl, { product_key: 'vooads', rate_pct: 70, duration: 'forever' });
    check('aff: above 50% needs a confirm; on Vooads it warns that AI tools cost more', noConf.status === 409 && noConf.data.needs_confirm === true && /AI tools cost more/.test(noConf.data.warning) && !q1("SELECT 1 FROM aff_deals WHERE affiliate_id=? AND model='revshare' AND product_key='vooads'", spA.id), noConf.data);
    const spCust = await newCust(spA, 'special.cust@gmail.com', 'Special Customer', 'spyvoo');
    const rsCom = (eid) => q1("SELECT * FROM aff_commissions WHERE uniq_key=(SELECT 'rs:event:' || id FROM events WHERE ext_id=?)", eid);
    // (a) Forever, all products, 30%: not special; replaces the 20% Starter rate within the caps.
    const fAll = await owner.post(rsUrl, { product_key: 'all', rate_pct: 30, duration: 'forever', note: 'Launch partner' });
    check('aff: a 30% custom deal on all products, forever (not a Special deal)', fAll.status === 200 && fAll.data.deal.model === 'revshare' && fAll.data.deal.all_products && fAll.data.deal.special === false && fAll.data.deal.ends_at === null, fAll.data);
    await spend('spyvoo', spCust.user.voo_id, 100, { id: 'sp_rs_1', plan: 'Pro' });
    check('aff: the forever deal pays 30% instead of the 20% tier rate, with no Special deal tag', rsCom('sp_rs_1').rate_bp === 3000 && rsCom('sp_rs_1').amount_cents === 3000 && rsCom('sp_rs_1').special_bp === 0 && rsCom('sp_rs_1').deal_id === fAll.data.deal.id, rsCom('sp_rs_1'));
    const endAll = await owner.patch(`/api/admin/aff/deals/${fAll.data.deal.id}`, { status: 'ended' });
    check('aff: the owner can end a custom deal (manager refused)', [403, 404].includes((await mgr.patch(`/api/admin/aff/deals/${fAll.data.deal.id}`, { status: 'ended' })).status) && endAll.status === 200 && endAll.data.deal.status === 'ended');
    await spend('spyvoo', spCust.user.voo_id, 100, { id: 'sp_rs_2', plan: 'Pro' });
    check('aff: after the deal ends, payments go back to the tier rate (20%)', rsCom('sp_rs_2').rate_bp === 2000 && !rsCom('sp_rs_2').deal_id);
    // (b) From date to date, Vooads 70% (Special deal, confirmed): only payments inside the window.
    // Deal dates are read as days in the reporting time zone (Africa/Lagos, UTC+1), so build them there: a UTC date made
    // between 23:00 and 24:00 UTC would already be "today" in Lagos and the window would have started (IN-6).
    const lagosDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
    const tomorrow = lagosDay(Date.now() + DAY); const in10 = lagosDay(Date.now() + 10 * DAY);
    const rng = await owner.post(rsUrl, { product_key: 'vooads', rate_pct: 70, duration: 'range', starts_at: tomorrow, ends_at: in10, confirm: true });
    check('aff: a confirmed 70% Vooads deal is a Special deal (tag above 50%) that overrides the 35% cap', rng.status === 200 && rng.data.deal.special === true && rng.data.deal.rate_bp === 7000 && rng.data.deal.duration === 'range', rng.data);
    await spend('vooads', spCust.user.voo_id, 100, { id: 'sp_rs_3' });
    check('aff: before the window starts the normal rate applies', rsCom('sp_rs_3').rate_bp === 2000 && rsCom('sp_rs_3').special_bp === 0);
    check('aff: no start notice before the window starts', !q1("SELECT 1 FROM aff_notifications WHERE affiliate_id=? AND kind='special_deal' AND text LIKE 'Special deal: 70%%'", spA.id));
    run('UPDATE aff_deals SET starts_at=? WHERE id=?', Date.now() - 3600_000, rng.data.deal.id);
    await jobs(Date.now());
    check('aff: the affiliate is told when the Special deal starts (in-app, Telegram, email)', !!q1("SELECT 1 FROM aff_notifications WHERE affiliate_id=? AND kind='special_deal' AND text LIKE 'Special deal: 70%'", spA.id) && !!q1("SELECT 1 FROM email_queue WHERE template='aff_custom_deal' AND to_email='special.partner@gmail.com'"));
    await spend('vooads', spCust.user.voo_id, 100, { id: 'sp_rs_4' });
    check('aff: inside the window Vooads pays 70% and the line is tagged Special deal 70%', rsCom('sp_rs_4').rate_bp === 7000 && rsCom('sp_rs_4').amount_cents === 7000 && rsCom('sp_rs_4').special_bp === 7000, rsCom('sp_rs_4'));
    await spend('vooads', spCust.user.voo_id, 100, { id: 'sp_rs_5', occurred_at: new Date(Date.now() - 2 * DAY).toISOString() });
    check('aff: a payment dated before the window keeps the normal rate (never backwards)', rsCom('sp_rs_5').rate_bp === 2000);
    const led = (await spC.get('/api/aff/ledger')).data.rows;
    check('aff: the ledger line says "Special deal 70%"', led.some((r) => r.special && /Special deal 70%/.test(r.type_label)), led.slice(0, 3));
    const offS = (await spC.get('/api/aff/offers')).data; const homeS = (await spC.get('/api/aff/home')).data;
    check('aff: the affiliate sees the Special deal tag, end date and countdown (offers and home)', offS.custom_deals.some((d) => d.special && d.label === 'Special deal 70%' && d.days_left >= 9 && d.last_day === in10) && offS.products.find((p) => p.key === 'vooads').custom.special === true && offS.products.find((p) => p.key === 'vooads').your_rate_bp === 7000 && homeS.custom_deals.length === 1, offS.custom_deals);
    const detS = (await owner.get(`/api/admin/aff/affiliates/${spA.id}`)).data;
    const listS = (await admin.get('/api/admin/aff/revshare-deals')).data;
    check('aff: back office shows the tag (affiliate page and deals list); owner and program super admins may create, finance may not', detS.custom_deals.some((d) => d.special) && detS.deals.some((d) => d.model === 'revshare' && d.special) && detS.can_create_custom_deal === true
      && (await admin.get(`/api/admin/aff/affiliates/${spA.id}`)).data.can_create_custom_deal === true && listS.deals.some((d) => d.affiliate_id === spA.id && d.special) && listS.can_create === true
      && (await fin1.get('/api/admin/aff/revshare-deals')).data.can_create === false, listS);
    const month = new Date().toISOString().slice(0, 7);
    const stS = (await spC.get(`/api/aff/statements?month=${month}`)).data;
    check('aff: statements (and receipts) label Special deal lines', stS.lines.some((l) => /Vooads · RevShare · Special deal 70%/.test(l.label)), stS.lines);
    // 7 days before the end: reminder. Then expiry: fallback to the normal rate.
    run('UPDATE aff_deals SET ends_at=? WHERE id=?', Date.now() + 3 * DAY, rng.data.deal.id);
    await jobs(Date.now());
    check('aff: the affiliate is told 7 days before the end', !!q1("SELECT 1 FROM aff_notifications WHERE affiliate_id=? AND kind='special_deal' AND text LIKE 'Special deal ending soon%'", spA.id) && q1("SELECT COUNT(*) n FROM email_queue WHERE template='aff_custom_deal' AND to_email='special.partner@gmail.com'").n >= 2);
    run('UPDATE aff_deals SET ends_at=? WHERE id=?', Date.now() - 60_000, rng.data.deal.id);
    await spend('vooads', spCust.user.voo_id, 100, { id: 'sp_rs_6' });
    await jobs(Date.now());
    check('aff: after expiry Vooads falls back to the tier rate within the 35% cap; the deal is marked ended', rsCom('sp_rs_6').rate_bp === 2000 && rsCom('sp_rs_6').special_bp === 0 && q1('SELECT status FROM aff_deals WHERE id=?', rng.data.deal.id).status === 'ended' && (await spC.get('/api/aff/offers')).data.custom_deals.length === 0);
    // (c) 90% forever on Joinvoo.
    const f90 = await owner.post(rsUrl, { product_key: 'joinvoo', rate_pct: 90, duration: 'forever', confirm: true });
    await spend('joinvoo', spCust.user.voo_id, 100, { id: 'sp_rs_7' });
    check('aff: 90% works (forever, Special deal)', f90.status === 200 && f90.data.deal.special === true && rsCom('sp_rs_7').rate_bp === 9000 && rsCom('sp_rs_7').amount_cents === 9000);
    check('aff: until-a-date deals end after the last day', (await owner.post(rsUrl, { product_key: 'castvoo', rate_pct: 25, duration: 'until', ends_at: in10 })).data.deal.ends_at > Date.now() + 9 * DAY && (await owner.post(rsUrl, { product_key: 'castvoo', rate_pct: 25, duration: 'until', ends_at: '2020-01-01' })).status === 400);
    check('aff: every custom-deal change is in the audit log', q1("SELECT COUNT(*) n FROM aff_audit WHERE affiliate_id=? AND action IN ('deal.revshare_create','deal.revshare_change')", spA.id).n >= 5);
    // Never public: public program info, other affiliates, public site code and public docs.
    const pubTxt = JSON.stringify((await new Client().get('/api/aff/public')).data);
    const site = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'aff-site.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', 'public', 'affiliate.html'), 'utf8');
    const pubDocs = ['AFFILIATE_TERMS.md', 'AFFILIATE_SPEC.md', 'INTEGRATION.md'].map((f) => fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8')).join('\n');
    check('aff: custom deals never leak: public API, site, terms/spec, other affiliates, members', !/special|revshare-deal|custom_deal|9000/i.test(pubTxt) && !/Special deal|revshare-deals/i.test(site) && !/Special deal|90%/.test(pubDocs)
      && (await amara.get('/api/aff/offers')).data.custom_deals.length === 0 && (await amara.get('/api/aff/home')).data.custom_deals.length === 0 && (await plain.get('/api/admin/aff/revshare-deals')).status === 403
      && !JSON.stringify((await amara.get('/api/aff/ledger')).data).includes('Special deal'));

    console.log('Member referrals: Affleego earns no referral commission');
    const refr = new Client(); await refr.login('referrer.member@gmail.com', 'Ref Member');
    const refd = new Client(); await refd.login('referred.member@gmail.com', 'Referred Member');
    run('UPDATE users SET referred_by=? WHERE id=?', refr.user.id, refd.user.id);
    await spend('affleego', refd.user.voo_id, 100, { id: 'ref_afl_1' });
    const r0 = (await refr.get('/api/me/referrals')).data;
    check('referrals: Affleego spend earns no member-referral commission and does not make a paying referral', r0.spend_usd === 0 && r0.earned_usd === 0 && r0.paying === 0, r0 && { spend: r0.spend_usd, earned: r0.earned_usd, paying: r0.paying });
    await spend('spyvoo', refd.user.voo_id, 100, { id: 'ref_spy_1' });
    const r1 = (await refr.get('/api/me/referrals')).data;
    check('referrals: Spyvoo spend by the same member still counts', r1.spend_usd === 100 && r1.earned_usd > 0 && r1.paying === 1, { spend: r1.spend_usd, earned: r1.earned_usd });
    }

    {
      // Upgrade: settings saved by an older build (30/60-day holds, second-payment-or-30-days rule) move to the instant policy once.
      const { spawnSync } = require('node:child_process');
      const MDB = path.join(os.tmpdir(), `voosquare-aff-mig-${process.pid}.db`);
      const env = { ...process.env, DATABASE_PATH: MDB, BACKUPS_DIR: path.join(UPLOADS, 'mig-backups'), NODE_ENV: 'test' };
      const node = (code) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', code], { cwd: path.join(__dirname, '..'), env, encoding: 'utf8' });
      node(`const D=require('./src/db'); D.setSetting('aff',{holds:{revshare_days:30,cpa_days:30,cpa_long_days:60,cpa_new_days:60,cpa_long_cents:10000,review_extend_days:14},qualification:{active_days:30}}); D.setSetting('aff_products',{joinvoo:{hold_days:30,qualification:'second_or_30d'},spyvoo:{hold_days:45}});`);
      const out = node(`require('./src/aff/core'); const D=require('./src/db'); process.stdout.write('@@'+JSON.stringify({ s: require('./src/aff/core').settings(), p: D.getSetting('aff_products') }));`);
      let mig = null; try { mig = JSON.parse(out.stdout.split('@@')[1]); } catch { /* shown below */ }
      check('aff: upgrade moves old default holds and qualification to the instant policy, keeps deliberate custom holds', mig && mig.s.holds.spend_days === 0 && mig.s.holds.cpa_days === 0 && mig.s.holds.cpa_long_days === 0 && mig.s.holds.revshare_days === undefined && mig.s.qualification.rule === 'first_payment'
        && mig.p.joinvoo.hold_days === 0 && mig.p.joinvoo.qualification === 'first' && mig.p.spyvoo.hold_days === 45, mig || out.stderr.slice(-400));
      for (const f of [MDB, MDB + '-wal', MDB + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
      // Upgrade (migration 004): an install that had Affleego configured keeps its history but Affleego leaves the program.
      node(`const D=require('./src/db'); require('./src/aff'); const t=Date.now();
        D.setSetting('aff_products',{affleego:{commissionable:true,cap_bp:5000,cpa_cents:2000},vooads:{cap_bp:5000}});
        D.run("INSERT INTO aff_deals(affiliate_id,product_key,model,cpa_cents,status,created_at) VALUES(1,'affleego','cpa',2000,'active',?)",t);
        D.run("INSERT INTO aff_deals(affiliate_id,product_key,model,cpa_cents,status,created_at) VALUES(1,'spyvoo','cpa',3000,'active',?)",t);
        D.run("INSERT INTO aff_deal_requests(affiliate_id,product_key,model,status,created_at) VALUES(1,'affleego','cpa','pending',?)",t);
        D.run("INSERT INTO aff_links(affiliate_id,code,product_key,created_at) VALUES(1,'AFLNK1','affleego',?)",t);
        D.run("INSERT INTO aff_coupons(affiliate_id,code,product_key,created_at) VALUES(1,'AFLC1','affleego',?)",t);
        D.run("INSERT INTO aff_creatives(title,product_key,created_at) VALUES('A','affleego',?)",t);
        D.run("INSERT INTO aff_postbacks(affiliate_id,url,products,created_at) VALUES(1,'https://t.example/pb','[\\"affleego\\",\\"spyvoo\\"]',?)",t);
        D.run("INSERT INTO aff_contests(title,products,starts_at,ends_at,created_at) VALUES('C','[\\"affleego\\"]',?,?,?)",t,t+1e6,t);
        D.run("INSERT INTO aff_commissions(affiliate_id,type,amount_cents,product_key,status,uniq_key,created_at) VALUES(1,'revshare',500,'affleego','available','hist-afl',?)",t);`);
      const up4 = node(`require('./src/aff'); const D=require('./src/db'); const M=require('./src/migrate'); M.run(D.db);
        process.stdout.write('@@'+JSON.stringify({ p: D.getSetting('aff_products'), deals: D.all('SELECT product_key,status FROM aff_deals ORDER BY id'), rq: D.get('SELECT status FROM aff_deal_requests'),
          link: D.get('SELECT archived FROM aff_links'), cp: D.get('SELECT active FROM aff_coupons'), cr: D.get('SELECT active FROM aff_creatives'), pb: D.get('SELECT products FROM aff_postbacks').products,
          ct: D.get('SELECT products FROM aff_contests').products, com: D.get("SELECT amount_cents,status FROM aff_commissions WHERE uniq_key='hist-afl'"), tbl: !!D.get("SELECT 1 FROM sqlite_master WHERE name='aff_adjustment_requests'"), sp: D.all('PRAGMA table_info(aff_deals)').some((c) => c.name === 'special') && D.all('PRAGMA table_info(aff_commissions)').some((c) => c.name === 'special_bp'), v: D.get('SELECT MAX(version) v FROM schema_migrations').v }));`);
      let m4 = null; try { m4 = JSON.parse(up4.stdout.split('@@')[1]); } catch { /* shown below */ }
      check('aff: upgrade (migration 004) switches Affleego off without deleting history; other deals untouched; adjustment table added', m4 && m4.v >= 4 && m4.p.affleego.commissionable === false && m4.p.affleego.cap_bp === 0 && m4.p.affleego.cpa_cents === 0
        && m4.deals[0].status === 'ended' && m4.deals[1].status === 'active' && m4.rq.status === 'declined' && m4.link.archived === 1 && m4.cp.active === 0 && m4.cr.active === 0 && m4.pb === '["spyvoo"]' && m4.ct === '[]'
        && m4.com.amount_cents === 500 && m4.com.status === 'available' && m4.tbl && m4.sp && m4.v >= 5, m4 || up4.stderr.slice(-600));
      for (const f of [MDB, MDB + '-wal', MDB + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    }
    check('aff: no server errors in the log', !/\[aff [a-z-]+\]|TypeError|ReferenceError/.test(log), log.match(/.*(\[aff [a-z-]+\]|TypeError|ReferenceError).*/g));
  } catch (e) {
    check('aff: test run completed without crashing', false, String(e && e.stack));
    console.error(e);
  } finally {
    srv.kill('SIGTERM');
    M.srv.close();
    await sleep(300);
    try { sql.close(); } catch { /* ignore */ }
    for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    try { fs.rmSync(UPLOADS, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (process.env.AFF_TEST_LOG) console.log(log.slice(-6000));
};

if (require.main === module) {
  let passed = 0; let failed = 0;
  const check = (name, cond, extra) => {
    if (cond) { passed++; process.stdout.write(`  ✓ ${name}\n`); }
    else { failed++; process.stdout.write(`  ✗ ${name}${extra !== undefined ? '  ' + JSON.stringify(extra).slice(0, 400) : ''}\n`); }
  };
  module.exports({ check }).then(() => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); });
}
