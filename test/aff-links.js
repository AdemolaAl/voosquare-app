'use strict';
/*
 * Affiliate links end to end: click → landing → cookie → sign-up → attribution → purchase → commission, for every link
 * type (main /a/<code>, affiliate host /go/<code>, every product deep link, smartlink, saved link, coupon), the tool
 * sign-up through "Continue with VooSquare" (OAuth, ref/vclick hand-off), VooSquare orders and tool spend events, and the
 * postbacks with their macros. Runs its own server with BASE_URL on a real-looking domain (voosquare.test) and a cookie
 * jar that honours Domain=, so the root-domain cookie set on affiliate.voosquare.test is proven readable on voosquare.test.
 *   Standalone: node test/aff-links.js        From npm test: called by test/smoke.js with its check().
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/** A browser-like cookie jar: Domain= cookies go to the domain and its subdomains, host-only cookies to their host only. */
class Jar {
  constructor() { this.c = []; }
  set(host, header) {
    const parts = header.split(';').map((s) => s.trim());
    const [kv, ...attrs] = parts; const i = kv.indexOf('='); const name = kv.slice(0, i); const value = kv.slice(i + 1);
    const at = Object.fromEntries(attrs.map((a) => { const j = a.indexOf('='); return j < 0 ? [a.toLowerCase(), true] : [a.slice(0, j).toLowerCase(), a.slice(j + 1)]; }));
    const domain = at.domain ? String(at.domain).replace(/^\./, '').toLowerCase() : host;
    const hostOnly = !at.domain;
    this.c = this.c.filter((x) => !(x.name === name && x.domain === domain && x.hostOnly === hostOnly));
    if (value !== '' && at['max-age'] !== '0') this.c.push({ name, value, domain, hostOnly, raw: header });
  }
  header(host) { return this.c.filter((x) => (x.hostOnly ? x.domain === host : host === x.domain || host.endsWith('.' + x.domain))).map((x) => `${x.name}=${x.value}`).join('; '); }
  get(name, host) { return this.c.find((x) => x.name === name && (!host || (x.hostOnly ? x.domain === host : host === x.domain || host.endsWith('.' + x.domain)))); }
  clear(domain) { this.c = this.c.filter((x) => x.domain !== domain); }
}

module.exports = async function affLinks({ check }) {
  const { DatabaseSync } = require('node:sqlite');
  const PORT = 5900 + Math.floor(Math.random() * 400);
  const ROOT = 'voosquare.test'; const MAIN = `${ROOT}:${PORT}`; const AFFH = `affiliate.${ROOT}:${PORT}`;
  const DB = path.join(os.tmpdir(), `voosquare-afflinks-${process.pid}.db`);
  const DIR = path.join(os.tmpdir(), `voosquare-afflinks-${process.pid}`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  // The affiliate's tracker (postbacks).
  const hits = [];
  const rcv = http.createServer((req, res) => { hits.push(req.url); res.writeHead(200); res.end('ok'); });
  await new Promise((r) => rcv.listen(0, '127.0.0.1', r));
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BASE_URL: `http://${MAIN}`, DATABASE_PATH: DB, UPLOADS_DIR: path.join(DIR, 'uploads'), BACKUPS_DIR: path.join(DIR, 'backups'), OWNER_EMAIL: 'owner@links.test', NODE_ENV: 'test', EMAIL_PROVIDER: '', AFF_JOBS: 'off', AFFILIATE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) break; } catch { /* wait */ } await sleep(100); }
  const sql = new DatabaseSync(DB); sql.exec('PRAGMA busy_timeout=5000');
  const q1 = (s, ...a) => sql.prepare(s).get(...a);
  const run = (s, ...a) => sql.prepare(s).run(...a);

  let ipn = 0;
  /** One visitor: a cookie jar, an IP and a user agent; requests go to 127.0.0.1 with the Host header of the URL. */
  class Visitor {
    constructor() { this.jar = new Jar(); this.ip = `10.61.${Math.floor(++ipn / 250)}.${ipn % 250 + 1}`; }
    req(method, url, body) {
      const u = new URL(url.startsWith('http') ? url : `http://${MAIN}${url}`);
      const host = u.hostname;
      const headers = { host: u.host, 'user-agent': UA, 'x-forwarded-for': this.ip, 'x-vs': '1' };
      const ck = this.jar.header(host); if (ck) headers.cookie = ck;
      let payload; if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
      return new Promise((resolve, reject) => {
        const r = http.request({ host: '127.0.0.1', port: PORT, method, path: u.pathname + u.search, headers }, (res) => {
          for (const c of [].concat(res.headers['set-cookie'] || [])) this.jar.set(host, c);
          let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => { let data; try { data = JSON.parse(t); } catch { data = t; } resolve({ status: res.statusCode, data, location: res.headers.location || '', cookies: [].concat(res.headers['set-cookie'] || []) }); });
        });
        r.on('error', reject); if (payload) r.write(payload); r.end();
      });
    }
    get(u) { return this.req('GET', u); }
    post(u, b = {}) { return this.req('POST', u, b); }
    put(u, b = {}) { return this.req('PUT', u, b); }
    async signup(email, name, { host = MAIN, coupon } = {}) {
      const s = await this.post(`http://${host}/api/auth/start`, { email, name, coupon });
      const v = await this.post(`http://${host}/api/auth/verify`, { email, code: s.data.dev_code, coupon });
      this.user = v.data && v.data.user; return v;
    }
  }
  const attr = (email) => q1('SELECT t.*, f.code FROM aff_attributions t JOIN aff_affiliates f ON f.id=t.affiliate_id JOIN users u ON u.id=t.customer_user_id WHERE u.email=?', email);
  const ev = async (slug, events) => (await fetch(`http://127.0.0.1:${PORT}/api/v1/events`, { method: 'POST', headers: { authorization: 'Bearer ' + q1('SELECT api_key FROM products WHERE slug=?', slug).api_key, 'content-type': 'application/json' }, body: JSON.stringify({ events }) })).json();
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(40); } return fn(); };

  try {
    console.log('Affiliate links: setup');
    const owner = new Visitor(); await owner.signup('owner@links.test', 'Owner');
    for (const slug of ['spyvoo', 'joinvoo', 'vooads', 'replyvoo', 'castvoo', 'landvoo', 'gatevoo']) run('UPDATE products SET url=?, sso=1, redirect_uris=? WHERE slug=?', `https://${slug}.example`, JSON.stringify([`https://${slug}.example/cb`]), slug);
    const mkAff = async (email, name) => {
      const v = new Visitor(); await v.signup(email, name); await v.post('/api/aff/account');
      await v.put('/api/aff/application/1', { display_name: name, country: 'NG', telegram: '@' + name.toLowerCase() + '_tg', kind: 'individual' });
      await v.put('/api/aff/application/2', { sources: ['Meta ads'], geos: ['NG'], volume: '$10k–$50k', products: ['joinvoo'] });
      await v.put('/api/aff/application/3', { years: '3–5', plan: 'Meta ads to the tools for Nigerian media buyers, plus a Telegram channel with reviews.', links: ['https://t.me/x'] });
      const a = (await v.put('/api/aff/application/4', { accept_terms: true, no_income_claims: true, adult: true, usdt: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' })).data.account;
      await owner.post(`/api/admin/aff/applications/${a.id}/approve`);
      run('UPDATE aff_affiliates SET activated_at=? WHERE id=?', Date.now() - 86400_000, a.id); // past the 5-customer activation: earnings are instant
      v.aff = a; return v;
    };
    const A = await mkAff('ama@links.test', 'Ama'); const B = await mkAff('bode@links.test', 'Bode');
    const pb = await B.post('/api/aff/postbacks', { name: 'Tracker', url: `http://127.0.0.1:${rcv.address().port}/pb?cid={click_id}&e={event}&p={payout}&amt={amount}&s1={sub1}&prod={product}&ref={customer_ref}`, events: ['click', 'registration', 'first_payment'] });
    check('links: a postback to the local tracker is saved (test mode allows private hosts)', pb.status === 200, pb.data);

    /* ---------------- every product deep link lands on the right place ---------------- */
    console.log('Affiliate links: deep links, cookie, open redirect');
    const L = (await A.get('/api/aff/links')).data;
    const keys = L.deep_links.map((d) => d.product_key);
    check('links: deep links for VooSquare Premium, paid rooms and every live tool; no Affleego, no Gatevoo while off', ['premium', 'room', 'spyvoo', 'joinvoo', 'vooads', 'replyvoo', 'castvoo', 'landvoo'].every((k) => keys.includes(k)) && !keys.includes('affleego') && !keys.includes('gatevoo') && !keys.includes('inner-circle'), keys);
    const expectHost = { premium: `${MAIN}/premium`, room: `${MAIN}/community` };
    for (const d of L.deep_links) {
      const v = new Visitor(); const r = await v.get(d.url);
      const loc = new URL(r.location); const want = expectHost[d.product_key] || `${d.product_key}.example/`;
      const ck = v.jar.get('vs_aff');
      check(`links: ${d.product_key} link → ${want} with ref and vclick; vs_aff on .${ROOT}`, r.status === 302 && (loc.host + loc.pathname).startsWith(want) && loc.searchParams.get('ref') === A.aff.code && loc.searchParams.get('vclick') === (ck && ck.value) && /Domain=\.voosquare\.test/.test(ck.raw) && /HttpOnly/.test(ck.raw) && /SameSite=Lax/.test(ck.raw), { loc: r.location, ck: ck && ck.raw });
    }
    const home = await new Visitor().get(`/a/${A.aff.code}`);
    check('links: the main link lands on the VooSquare home page', new URL(home.location).pathname === '/' && new URL(home.location).host === MAIN, home.location);
    const smart = await new Visitor().get(L.smartlink);
    check('links: the smartlink lands on VooSquare and is recorded as a smartlink click', new URL(smart.location).host === MAIN && !!q1("SELECT 1 FROM aff_clicks WHERE kind='smart' AND affiliate_id=?", A.aff.id), smart.location);
    const afl = await new Visitor().get(`/a/${A.aff.code}?p=affleego`);
    check('links: an old Affleego link lands on VooSquare (never affleego.com)', new URL(afl.location).host === MAIN && !afl.location.includes('affleego'), afl.location);
    check('links: the link builder refuses Affleego', (await A.get('/api/aff/links/build?product=affleego')).status === 400);
    for (const bad of ['https://evil.example/x', '//evil.example/x', `http://${ROOT}.evil.example/x`, 'javascript:alert(1)', `https://user:pw@spyvoo.example/`]) {
      const r = await new Visitor().get(`/a/${A.aff.code}?p=spyvoo&url=${encodeURIComponent(bad)}`);
      check(`links: no open redirect (${bad})`, new URL(r.location).host === 'spyvoo.example', r.location);
    }
    const deep = await new Visitor().get(`/a/${A.aff.code}?p=spyvoo&url=${encodeURIComponent('https://spyvoo.example/pricing')}`);
    check('links: an approved deep link keeps its path', deep.location.startsWith('https://spyvoo.example/pricing?ref='), deep.location);
    const bot = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: `/a/${A.aff.code}?p=joinvoo`, headers: { host: MAIN, 'user-agent': 'facebookexternalhit/1.1' } }, (res) => { res.resume(); resolve(res); }));
    check('links: link-preview bots are redirected without a cookie', bot.statusCode === 302 && !(bot.headers['set-cookie'] || []).some((c) => c.startsWith('vs_aff=')));
    const mac = new Visitor(); await mac.get(`/a/${A.aff.code}?p=premium&click_id={clickid}&sub1={campaign}&sub2=ok`);
    const macRow = q1('SELECT ext_click_id, sub1, sub2 FROM aff_clicks WHERE uid=?', mac.jar.get('vs_aff').value);
    check('links: an unreplaced {macro} is stored empty, not as the literal word', macRow.ext_click_id === '' && macRow.sub1 === '' && macRow.sub2 === 'ok', macRow);

    /* ---------------- affiliate host → main site sign-up → Premium order ---------------- */
    console.log('Affiliate links: affiliate host, main-site sign-up, VooSquare orders');
    const v1 = new Visitor();
    const go = await v1.get(`http://${AFFH}/go/${A.aff.code}?p=premium&sub1=tt_ke&click_id=K1`);
    check('links: /go/<code> on affiliate.* redirects to voosquare /premium and sets the cookie on the root domain', go.location.startsWith(`http://${MAIN}/premium?`) && !!v1.jar.get('vs_aff', ROOT), go.location);
    await v1.signup('prem.buyer@gmail.com', 'Prem Buyer');
    const at1 = attr('prem.buyer@gmail.com');
    check('links: sign-up on voosquare.* reads the cookie set on affiliate.* (link, sub1, click_id kept)', at1 && at1.code === A.aff.code && at1.method === 'link' && at1.sub1 === 'tt_ke' && at1.ext_click_id === 'K1', at1);
    check('links: after sign-up the click and referral cookies are cleared on the root domain', !v1.jar.get('vs_aff') && !v1.jar.get('vs_ref'), v1.jar.c.map((x) => x.name + '@' + x.domain));
    const pm = run("INSERT INTO payment_methods(type,name,currency,rate,enabled,config) VALUES('manual','Bank (links test)','USD',1,1,'{}')").lastInsertRowid;
    const co = await v1.post('/api/billing/checkout', { item: 'premium', method_id: pm });
    const oid = q1('SELECT id FROM orders WHERE ref=?', co.data.order.ref).id;
    await owner.post(`/api/admin/orders/${oid}/approve`);
    const pc = q1('SELECT * FROM aff_commissions WHERE uniq_key=?', 'rs:order:' + oid);
    check('links: Premium order (checkout, manual approve) → RevShare available at once', pc && pc.affiliate_id === A.aff.id && pc.product_key === 'premium' && pc.status === 'available' && pc.amount_cents > 0, pc);
    const room = run("INSERT INTO rooms(slug,name,topic,description,icon,color,access,price_usd,period_days,sort,created_at) VALUES('links-paid','Links Paid Room','Premium','Paid room for tests','diamond','#00774B','paid',15,30,99,?)", Date.now()).lastInsertRowid;
    const v2 = new Visitor(); await v2.get(`/a/${A.aff.code}?p=room`); await v2.signup('room.buyer@gmail.com', 'Room Buyer');
    const co2 = await v2.post('/api/billing/checkout', { item: 'room', room_id: room, method_id: pm });
    const oid2 = co2.data.order ? q1('SELECT id FROM orders WHERE ref=?', co2.data.order.ref).id : 0;
    if (oid2) await owner.post(`/api/admin/orders/${oid2}/approve`);
    const rc = oid2 && q1('SELECT * FROM aff_commissions WHERE uniq_key=?', 'rs:order:' + oid2);
    check('links: paid room order → RevShare on product "room"', rc && rc.affiliate_id === A.aff.id && rc.product_key === 'room' && rc.status === 'available', { co2: co2.data, rc });

    /* ---------------- tool sign-up through Voo ID OAuth ---------------- */
    console.log('Affiliate links: tool sign-up through Continue with VooSquare');
    const jv = q1("SELECT client_id, client_secret FROM products WHERE slug='joinvoo'");
    /** The tool: lands with ref/vclick, sends Start free to /oauth/authorize with them, gets the code, exchanges it. */
    async function toolSignup(v, landing, email, { passThrough = true, dropCookie = false } = {}) {
      const lu = new URL(landing);
      if (dropCookie) v.jar.clear(ROOT);
      const auth = new URL(`http://${MAIN}/oauth/authorize`);
      for (const [k, val] of Object.entries({ client_id: jv.client_id, redirect_uri: 'https://joinvoo.example/cb', state: 's1', prompt: 'signup' })) auth.searchParams.set(k, val);
      if (passThrough) for (const k of ['ref', 'vclick', 'coupon']) if (lu.searchParams.get(k)) auth.searchParams.set(k, lu.searchParams.get(k));
      const a1 = await v.get(auth.toString());
      const toLogin = a1.location.startsWith('/login?product=joinvoo&mode=signup');
      await v.signup(email, 'Tool Customer');
      const a2 = await v.get(auth.toString());
      const code = new URL(a2.location).searchParams.get('code');
      const tok = await (await fetch(`http://127.0.0.1:${PORT}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code, client_id: jv.client_id, client_secret: jv.client_secret, redirect_uri: 'https://joinvoo.example/cb' }) })).json();
      return { toLogin, back: a2.location.startsWith('https://joinvoo.example/cb?code='), claims: tok.user || {} };
    }
    const t1 = new Visitor();
    const c1 = await t1.get(`/a/${B.aff.code}?p=joinvoo&sub1=fb_ng&sub2=adset7&click_id=CLK-42`);
    const tool1 = await toolSignup(t1, c1.location, 'tool.buyer@gmail.com');
    const at2 = attr('tool.buyer@gmail.com');
    check('links: tool Start free → /oauth/authorize → VooSquare sign-up (product-branded) → back to the tool with a code', tool1.toLogin && tool1.back && !!tool1.claims.voo_id, tool1);
    check('links: the tool sign-up is attributed to the clicked affiliate (link, subs, external click id)', at2 && at2.code === B.aff.code && at2.method === 'link' && at2.sub1 === 'fb_ng' && at2.sub2 === 'adset7' && at2.ext_click_id === 'CLK-42', at2);
    await ev('joinvoo', [{ event_id: 'links_jv_1', voo_id: tool1.claims.voo_id, type: 'spend', value_usd: 99, plan: 'Pro' }]);
    const tc = q1("SELECT * FROM aff_commissions WHERE customer_user_id=(SELECT id FROM users WHERE voo_id=?) AND type='revshare'", tool1.claims.voo_id);
    check('links: tool spend → RevShare available at once (20% of $99)', tc && tc.affiliate_id === B.aff.id && tc.amount_cents === 1980 && tc.status === 'available', tc);
    const clickHit = await until(() => hits.find((h) => h.includes('e=click') && h.includes('cid=CLK-42')));
    const regHit = await until(() => hits.find((h) => h.includes('e=registration')));
    const payHit = await until(() => hits.find((h) => h.includes('e=first_payment')));
    check('links: click postback fires with the click id and sub1', clickHit && clickHit.includes('s1=fb_ng') && clickHit.includes('prod=joinvoo'), clickHit);
    check('links: registration postback with click id, sub1 and customer ref', regHit && regHit.includes('cid=CLK-42') && regHit.includes('s1=fb_ng') && /ref=C-[A-Z2-9]{6}/.test(regHit), regHit);
    check('links: first_payment postback with payout, amount and product', payHit && payHit.includes('p=19.80') && payHit.includes('amt=99.00') && payHit.includes('prod=joinvoo') && payHit.includes('cid=CLK-42'), payHit);
    check('links: no postback leaves a {macro} unfilled', !hits.some((h) => /\{\w+\}|%7B/.test(h)), hits);

    // The cookie is gone (other browser, in-app browser): the tool's vclick hand-off still attributes the click.
    const t2 = new Visitor(); const c2 = await t2.get(`/a/${A.aff.code}?p=joinvoo&sub1=handoff`);
    await toolSignup(t2, c2.location, 'handoff.buyer@gmail.com', { dropCookie: true });
    const at3 = attr('handoff.buyer@gmail.com');
    check('links: cookie lost: vclick passed by the tool to /oauth/authorize attributes the click', at3 && at3.code === A.aff.code && at3.method === 'link' && at3.sub1 === 'handoff', at3);
    // An older click cookie (affiliate A) and a newer click handed back by the tool (affiliate B): last click wins.
    const t3 = new Visitor(); await t3.get(`/a/${A.aff.code}?p=joinvoo`);
    await sleep(5);
    const other = new Visitor(); const c3 = await other.get(`/a/${B.aff.code}?p=joinvoo&sub1=newer`); // clicked in another browser
    await toolSignup(t3, c3.location, 'lastclick.buyer@gmail.com');
    const at4 = attr('lastclick.buyer@gmail.com');
    check('links: a newer click handed back by the tool beats an older cookie (last click wins)', at4 && at4.code === B.aff.code && at4.sub1 === 'newer', at4);
    // The tool passes nothing back, same browser: the root-domain cookie is read at /oauth/authorize.
    const t4 = new Visitor(); const c4 = await t4.get(`/a/${A.aff.code}?p=joinvoo`);
    await toolSignup(t4, c4.location, 'nopass.buyer@gmail.com', { passThrough: false });
    check('links: a tool that drops ref/vclick still gets attribution in the same browser (root-domain cookie)', (attr('nopass.buyer@gmail.com') || {}).code === A.aff.code);

    /* ---------------- rules: coupon > last click > referral code; lifetime lock; existing Voo ID ---------------- */
    console.log('Affiliate links: attribution order, lifetime lock, existing Voo ID');
    await owner.post('/api/admin/aff/coupons', { affiliate_id: B.aff.id, code: 'BODE10', discount_pct: 10 });
    const r1 = new Visitor(); await r1.get(`/a/${A.aff.code}?p=premium`); await r1.signup('coupon.first@gmail.com', 'Coupon First', { coupon: 'BODE10' });
    check('links: a coupon typed at sign-up beats the last click', (attr('coupon.first@gmail.com') || {}).method === 'coupon' && attr('coupon.first@gmail.com').code === B.aff.code);
    const r2 = new Visitor(); await r2.get(`/a/${A.aff.code}?p=premium`);
    run('UPDATE aff_clicks SET created_at=? WHERE uid=?', Date.now() - 61 * 86400_000, r2.jar.get('vs_aff').value);
    await r2.signup('expired.click@gmail.com', 'Expired Click');
    const at5 = attr('expired.click@gmail.com');
    check('links: a click older than 60 days falls back to the referral code', at5 && at5.code === A.aff.code && at5.method === 'ref_link' && !at5.click_id, at5);
    const lock = new Visitor(); await lock.get(`/a/${B.aff.code}?p=joinvoo`); // the tool customer of B clicks A later and logs in again
    await lock.get(`/a/${A.aff.code}?p=joinvoo`); await lock.signup('tool.buyer@gmail.com', 'Tool Customer');
    await ev('joinvoo', [{ event_id: 'links_jv_2', voo_id: tool1.claims.voo_id, type: 'spend', value_usd: 50, plan: 'Pro' }]);
    check('links: lifetime lock: a later click by another affiliate does not move the customer or the commission', attr('tool.buyer@gmail.com').code === B.aff.code && q1("SELECT affiliate_id FROM aff_commissions WHERE uniq_key LIKE 'rs:event:%' ORDER BY id DESC LIMIT 1").affiliate_id === B.aff.id);
    const ex = new Visitor(); await ex.signup('existing.member@gmail.com', 'Existing Member');
    run('UPDATE users SET created_at=? WHERE email=?', Date.now() - 90 * 86400_000, 'existing.member@gmail.com');
    const ex2 = new Visitor(); const cx = await ex2.get(`/a/${A.aff.code}?p=joinvoo`); await toolSignup(ex2, cx.location, 'existing.member@gmail.com');
    const exu = q1('SELECT * FROM users WHERE email=?', 'existing.member@gmail.com');
    await ev('joinvoo', [{ event_id: 'links_jv_ex', voo_id: exu.voo_id, type: 'spend', value_usd: 99 }]);
    check('links: a Voo ID that existed before the click is never attributed and earns nothing', !attr('existing.member@gmail.com') && !q1('SELECT 1 FROM aff_commissions WHERE customer_user_id=?', exu.id));

    /* ---------------- refunds, chargebacks, sub-affiliate recruit link ---------------- */
    console.log('Affiliate links: refund, chargeback, recruitment link');
    await ev('joinvoo', [{ event_id: 'links_rf', voo_id: tool1.claims.voo_id, type: 'refund', value_usd: 99, original_event_id: 'links_jv_1', plan: 'Pro' }]);
    check('links: a tool refund never claws back (used credits are final)', !q1("SELECT 1 FROM aff_commissions WHERE type='clawback' AND customer_user_id=(SELECT id FROM users WHERE voo_id=?)", tool1.claims.voo_id));
    await ev('joinvoo', [{ event_id: 'links_cb', voo_id: tool1.claims.voo_id, type: 'chargeback', value_usd: 50, original_event_id: 'links_jv_2' }]);
    check('links: a chargeback claws back that payment', !!q1("SELECT 1 FROM aff_commissions WHERE type='clawback' AND amount_cents=-1000 AND customer_user_id=(SELECT id FROM users WHERE voo_id=?)", tool1.claims.voo_id));
    const rec = new Visitor(); const rl = await rec.get(`/a/${A.aff.code}?join=1`);
    check('links: the recruitment link lands on the affiliate join page with the parent cookie on the root domain', rl.location === `http://${MAIN}/affiliates#/join` && /Domain=\.voosquare\.test/.test((rec.jar.get('vs_aff_parent') || {}).raw || ''), rl.location);
    await rec.signup('new.sub@gmail.com', 'New Sub', { host: AFFH });
    const sub = (await rec.post(`http://${AFFH}/api/aff/account`)).data.account;
    check('links: an affiliate account created on affiliate.* gets the recruiting parent', sub && sub.sub && sub.sub.parent && sub.sub.parent.ref === `AF-${A.aff.id}`, sub && sub.sub);
    check('links: the affiliate.* session cookie is host-only', !!rec.jar.get('vs_sess', 'affiliate.voosquare.test') && !rec.jar.get('vs_sess', ROOT));
  } finally {
    srv.kill('SIGTERM'); rcv.close(); try { sql.close(); } catch { /* ignore */ }
    await sleep(300);
    for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* ignore */ }
    if (/\bError\b/.test(log) && process.env.AFF_LINKS_LOG) console.log(log.slice(-3000));
  }
};

if (require.main === module) {
  let passed = 0; let failed = 0;
  const check = (name, ok, extra) => { if (ok) { passed++; } else { failed++; console.log(`  FAIL ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
  module.exports({ check }).then(() => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }, (e) => { console.error(e); process.exit(1); });
}
