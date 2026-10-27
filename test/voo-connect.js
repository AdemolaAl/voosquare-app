'use strict';
/*
 * Voo Connect conformance (sdk/voo-connect). Boots VooSquare and the example sister tool ("Demo tool",
 * sdk/voo-connect/example-tool) on local ports and proves the kit connects a tool exactly as docs/INTEGRATION.md says:
 *   affiliate link → tool landing (ref / vclick kept in the tool's first-party cookie) → "Start free" → Voo ID sign-up with
 *   prompt=signup and the ref / vclick hand-off (VooSquare's own cookie deliberately lost) → attribution → plan payment
 *   (spend + plan_started) → commission → wallet top-up (no commission) → daily credit use (spend, idempotent) → refund (no
 *   clawback) → chargeback (clawback) → support message and the staff-reply webhook → summary card → logout everywhere;
 * plus the kit on its own: id_token checks, state and return_to checks, event validation, batching with resend of
 * `rejected`, retries with backoff through a flaky proxy (including a lost response), outbox file, webhook helpers, the
 * browser snippet, the ESM entry, and the check.js CLI (pass and fail).
 * Ports: the first free ones in 4785–4789. Files: <tmp>/claude-0/vconnect/run-<pid> (removed at the end).
 *   Standalone: node test/voo-connect.js        From npm test: called by test/smoke.js with its check().
 */
const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const vm = require('node:vm');
const crypto = require('node:crypto');

const SDK = path.join(__dirname, '..', 'sdk', 'voo-connect');
const K = require(SDK);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** A browser-like cookie jar keyed by host name (browsers ignore ports), honouring Max-Age=0 and Domain=. */
class Jar {
  constructor() { this.c = []; }
  set(host, header) {
    const [kv, ...attrs] = header.split(';').map((s) => s.trim());
    const i = kv.indexOf('='); const name = kv.slice(0, i); const value = kv.slice(i + 1);
    const at = Object.fromEntries(attrs.map((a) => { const j = a.indexOf('='); return j < 0 ? [a.toLowerCase(), true] : [a.slice(0, j).toLowerCase(), a.slice(j + 1)]; }));
    const domain = at.domain ? String(at.domain).replace(/^\./, '').toLowerCase() : host;
    const hostOnly = !at.domain;
    this.c = this.c.filter((x) => !(x.name === name && x.domain === domain && x.hostOnly === hostOnly));
    if (value !== '' && at['max-age'] !== '0') this.c.push({ name, value, domain, hostOnly, raw: header });
  }
  match(x, host) { return x.hostOnly ? x.domain === host : host === x.domain || host.endsWith('.' + x.domain); }
  header(host) { return this.c.filter((x) => this.match(x, host)).map((x) => `${x.name}=${x.value}`).join('; '); }
  get(name, host) { return this.c.find((x) => x.name === name && (!host || this.match(x, host))); }
  clear(host) { this.c = this.c.filter((x) => x.domain !== host); }
}
let ipn = 0;
/** One browser: cookie jar, IP, user agent. Connects to 127.0.0.1:<port> with the Host header of the URL. */
class Browser {
  constructor() { this.jar = new Jar(); this.ip = `10.77.${Math.floor(++ipn / 250)}.${(ipn % 250) + 1}`; }
  req(method, url, { body, form, headers = {} } = {}) {
    const u = new URL(url);
    const h = { host: u.host, 'user-agent': UA, 'x-forwarded-for': this.ip, 'x-vs': '1', ...headers };
    const ck = this.jar.header(u.hostname); if (ck) h.cookie = ck;
    let payload;
    if (form) { payload = new URLSearchParams(form).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
    else if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    if (payload) h['content-length'] = Buffer.byteLength(payload);
    return new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: Number(u.port), method, path: u.pathname + u.search, headers: h }, (res) => {
        const set = [].concat(res.headers['set-cookie'] || []);
        for (const c of set) this.jar.set(u.hostname, c);
        let t = ''; res.on('data', (d) => { t += d; });
        res.on('end', () => { let data; try { data = JSON.parse(t); } catch { data = t; } resolve({ status: res.statusCode, data, location: res.headers.location || '', cookies: set, headers: res.headers }); });
      });
      r.on('error', reject); if (payload) r.write(payload); r.end();
    });
  }
  get(u, o) { return this.req('GET', u, o); }
  post(u, o) { return this.req('POST', u, o); }
}
const portFree = (port) => new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(port, '0.0.0.0', () => s.close(() => resolve(true))); });
async function waitHttp(url, ms = 10_000) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(url); if (r.status < 500) return true; } catch { /* booting */ } await sleep(80); } return false; }
function runCli(args, env = {}) {
  return new Promise((resolve) => execFile(process.execPath, [path.join(SDK, 'check.js'), ...args], { env: { ...process.env, VOO_BASE: '', VOO_CLIENT_ID: '', VOO_CLIENT_SECRET: '', VOO_API_KEY: '', VOO_REDIRECT_URI: '', ...env }, timeout: 30_000 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout) + String(stderr) })));
}
const jwt = (payload, secret, head = { alg: 'HS256', typ: 'JWT' }) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const h = b(head); const p = b(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', secret).update(`${h}.${p}`).digest('base64url')}`;
};
/** Minimal req/res pair for calling kit handlers directly. */
function fakeReqRes(url, { cookie = '', headers = {}, body } = {}) {
  const req = Object.assign(new (require('node:stream').PassThrough)(), { url, method: body === undefined ? 'GET' : 'POST', headers: { cookie, ...headers } });
  if (body !== undefined) req.end(typeof body === 'string' ? body : JSON.stringify(body)); else req.end();
  const res = { headers: {}, statusCode: 200, body: '', setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, getHeader(k) { return this.headers[k.toLowerCase()]; }, end(b) { this.body = b === undefined ? '' : String(b); this.ended = true; } };
  return { req, res };
}

module.exports = async function vooConnect({ check }) {
  const { DatabaseSync } = require('node:sqlite');
  const pool = [];
  for (let p = 4785; p <= 4789; p++) if (await portFree(p)) pool.push(p);
  if (pool.length < 3) { check('voo-connect: three free ports in 4785–4789', false, { free: pool }); return; }
  const [VS_PORT, TOOL_PORT, FLAKY_PORT] = pool;
  const VS = `http://127.0.0.1:${VS_PORT}`; const TOOL = `http://localhost:${TOOL_PORT}`;
  const CB = `${TOOL}/auth/voosquare/callback`;
  const ROOT = process.env.VOO_CONNECT_TMP || path.join(os.tmpdir(), 'claude-0', 'vconnect');
  const RUN = path.join(ROOT, `run-${process.pid}`);
  fs.rmSync(RUN, { recursive: true, force: true }); fs.mkdirSync(RUN, { recursive: true });
  const DB = path.join(RUN, 'voosquare.db');
  const ADMIN = crypto.randomBytes(12).toString('hex');
  const procs = []; let vsLog = ''; let toolLog = ''; let flaky = null; let sql = null;

  try {
    console.log('Voo Connect: boot VooSquare, register "Demo tool" in Admin → Products');
    const vs = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(VS_PORT), BASE_URL: VS, DATABASE_PATH: DB, UPLOADS_DIR: path.join(RUN, 'uploads'), BACKUPS_DIR: path.join(RUN, 'backups'), VOICE_DIR: path.join(RUN, 'voice'), OWNER_EMAIL: 'owner@vconnect.test', NODE_ENV: 'test', EMAIL_PROVIDER: '', AFF_JOBS: 'off', AFFILIATE_URL: '', SCHOOL_EXTRA_DIR: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(vs); vs.stdout.on('data', (d) => { vsLog += d; }); vs.stderr.on('data', (d) => { vsLog += d; });
    check('voo-connect: VooSquare boots on its port', await waitHttp(`${VS}/healthz`), vsLog.slice(-400));
    sql = new DatabaseSync(DB); sql.exec('PRAGMA busy_timeout=5000');
    const q1 = (s, ...a) => sql.prepare(s).get(...a);
    const qa = (s, ...a) => sql.prepare(s).all(...a);
    const until = async (fn, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(40); } return fn(); };
    const signup = async (b, email, name, product) => {
      const s = await b.post(`${VS}/api/auth/start`, { body: { email, name, product } });
      const v = await b.post(`${VS}/api/auth/verify`, { body: { email, code: s.data.dev_code } });
      return v.data && v.data.user;
    };

    const owner = new Browser(); const ownerUser = await signup(owner, 'owner@vconnect.test', 'Owner');
    const saved = await owner.post(`${VS}/api/admin/products`, { body: { name: 'Demo tool', slug: 'demo-tool', url: TOOL, sso: true, status: 'live', visible: 1, tagline: 'Conformance tool',
      redirect_uris: [CB, `${TOOL}/`], summary_url: `${TOOL}/api/voosquare/summary`, support_webhook: `${TOOL}/hooks/voosquare/support` } });
    const prod = saved.data && saved.data.product;
    check('voo-connect: Admin → Products saves the tool with SSO, exact redirect URIs and credentials', saved.status === 200 && prod && prod.sso === 1 && /^vsc_/.test(prod.client_id) && /^vss_/.test(prod.client_secret) && /^vsk_/.test(prod.api_key) && prod.redirect_uris.length === 2, saved.data);
    const CRED = { clientId: prod.client_id, clientSecret: prod.client_secret, apiKey: prod.api_key };

    // An approved affiliate (activation passed, so earnings show at once).
    const aff = new Browser(); await signup(aff, 'ama@vconnect.test', 'Ama');
    await aff.post(`${VS}/api/aff/account`, { body: {} });
    await aff.req('PUT', `${VS}/api/aff/application/1`, { body: { display_name: 'Ama', country: 'NG', telegram: '@ama_vc', kind: 'individual' } });
    await aff.req('PUT', `${VS}/api/aff/application/2`, { body: { sources: ['Meta ads'], geos: ['NG'], volume: '$10k–$50k', products: ['joinvoo'] } });
    await aff.req('PUT', `${VS}/api/aff/application/3`, { body: { years: '3–5', plan: 'Meta ads to the tools for Nigerian media buyers, plus a Telegram channel with reviews.', links: ['https://t.me/x'] } });
    const acct = (await aff.req('PUT', `${VS}/api/aff/application/4`, { body: { accept_terms: true, no_income_claims: true, adult: true, usdt: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' } })).data.account;
    const appr = await owner.post(`${VS}/api/admin/aff/applications/${acct.id}/approve`, { body: {} });
    sql.prepare('UPDATE aff_affiliates SET activated_at=? WHERE id=?').run(Date.now() - 86400_000, acct.id);
    const affRow = q1('SELECT * FROM aff_affiliates WHERE id=?', acct.id);
    check('voo-connect: test affiliate approved', appr.status === 200 && affRow.status === 'approved', appr.data);

    console.log('Voo Connect: boot the example tool');
    const tool = spawn(process.execPath, [path.join(SDK, 'example-tool', 'server.js')], {
      env: { ...process.env, PORT: String(TOOL_PORT), PUBLIC_URL: TOOL, VOO_BASE: VS, VOO_CLIENT_ID: CRED.clientId, VOO_CLIENT_SECRET: CRED.clientSecret, VOO_API_KEY: CRED.apiKey, DEMO_DATA_DIR: path.join(RUN, 'demo'), DEMO_ADMIN_TOKEN: ADMIN, VOO_FLUSH_MS: '60', VOO_BACKOFF_MS: '40', NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    procs.push(tool); tool.stdout.on('data', (d) => { toolLog += d; }); tool.stderr.on('data', (d) => { toolLog += d; });
    check('voo-connect: example tool boots', await waitHttp(`http://127.0.0.1:${TOOL_PORT}/`), toolLog.slice(-400));
    const adminH = { 'x-demo-admin': ADMIN };
    const toolAdmin = new Browser();
    const toolState = async () => (await toolAdmin.get(`${TOOL}/admin/state`, { headers: adminH })).data;

    /* ================= check.js, the developer's self-test ================= */
    console.log('Voo Connect: check.js self-test CLI');
    const okRun = await runCli(['--base', VS, '--client-id', CRED.clientId, '--client-secret', CRED.clientSecret, '--api-key', CRED.apiKey, '--redirect-uri', CB, '--logout-uri', `${TOOL}/`, '--summary-url', `${TOOL}/api/voosquare/summary`]);
    check('check.js: correct settings → exit 0, every line PASS (reachable, clock, client ID, SSO, redirect, secret, events, support, logout, summary)', okRun.code === 0 && /0 failed/.test(okRun.out)
      && ['VooSquare is reachable', 'Clock in sync', 'Client ID is known', 'SSO) is switched on', `Redirect URI registered: ${CB}`, 'Client secret is valid', 'Events endpoint reachable', 'Support API reachable', `Logout comes back to ${TOOL}/`, 'Summary URL answers an unknown Voo ID', 'Summary URL refuses calls without the API key'].every((s) => okRun.out.includes(s)), okRun.out);
    check('check.js: prompt=signup opens the sign-up view', okRun.out.includes('opens the sign-up view'), okRun.out);
    const badRun = await runCli(['--base', VS, '--client-id', CRED.clientId, '--client-secret', 'vss_wrong', '--api-key', 'vsk_wrong', '--redirect-uri', `${TOOL}/not-registered`, '--logout-uri', 'https://elsewhere.example/']); // another site: any page on the tool's own site is allowed since IN-1
    check('check.js: wrong secret, wrong key, unregistered redirect and logout URI → exit 1 with a FAIL line each', badRun.code === 1
      && /FAIL {2}Client secret is valid/.test(badRun.out) && /FAIL {2}Events endpoint reachable, API key valid/.test(badRun.out) && badRun.out.includes(`FAIL  Redirect URI registered: ${TOOL}/not-registered`) && badRun.out.includes('FAIL  Logout comes back to https://elsewhere.example/'), badRun.out);
    const unknownRun = await runCli(['--json'], { VOO_BASE: VS, VOO_CLIENT_ID: 'vsc_nope', VOO_CLIENT_SECRET: 'x', VOO_API_KEY: CRED.apiKey, VOO_REDIRECT_URI: CB, VOO_TEST_VOO_ID: ownerUser.voo_id });
    let uj = null; try { uj = JSON.parse(unknownRun.out); } catch { /* not json */ }
    check('check.js: env vars instead of flags, --json output, unknown client ID named', unknownRun.code === 1 && uj && uj.ok === false && uj.results.some((r) => r.status === 'fail' && /Client ID is known/.test(r.name)), unknownRun.out.slice(0, 600));
    check('check.js: --voo-id proves the API key belongs to another product than the client ID', uj && uj.results.some((r) => r.status === 'fail' && /same product/.test(r.name)), uj && uj.results);
    const sameRun = await runCli(['--json', '--voo-id', ownerUser.voo_id], { VOO_BASE: VS, VOO_CLIENT_ID: CRED.clientId, VOO_CLIENT_SECRET: CRED.clientSecret, VOO_API_KEY: CRED.apiKey, VOO_REDIRECT_URI: CB });
    let sj = null; try { sj = JSON.parse(sameRun.out); } catch { /* not json */ }
    check('check.js: --voo-id with the right key → API key and client ID belong to the same product', sameRun.code === 0 && sj && sj.results.some((r) => r.status === 'pass' && /same product/.test(r.name)), sameRun.out.slice(0, 600));
    const ssoOff = await owner.post(`${VS}/api/admin/products`, { body: { id: prod.id, name: 'Demo tool', url: TOOL, sso: false, status: 'live', visible: 1, redirect_uris: [CB, `${TOOL}/`], summary_url: `${TOOL}/api/voosquare/summary`, support_webhook: `${TOOL}/hooks/voosquare/support` } });
    const offRun = await runCli(['--base', VS, '--client-id', CRED.clientId, '--client-secret', CRED.clientSecret, '--api-key', CRED.apiKey, '--redirect-uri', CB]);
    await owner.post(`${VS}/api/admin/products`, { body: { id: prod.id, name: 'Demo tool', url: TOOL, sso: true, status: 'live', visible: 1, redirect_uris: [CB, `${TOOL}/`], summary_url: `${TOOL}/api/voosquare/summary`, support_webhook: `${TOOL}/hooks/voosquare/support` } });
    check('check.js: SSO switched off in the admin → FAIL with the fix', ssoOff.status === 200 && offRun.code === 1 && /FAIL {2}VooSquare login \(SSO\) is switched on/.test(offRun.out), offRun.out);

    /* ================= the customer journey through the example tool ================= */
    console.log('Voo Connect: affiliate link → tool landing → Start free → Voo ID sign-up → attribution');
    const buyer = new Browser();
    const click = await buyer.get(`${VS}/a/${affRow.code}?p=demo-tool&sub1=fb_ng&click_id=CLK-VC1`);
    const land = click.location ? new URL(click.location) : null;
    check('journey: the affiliate link lands on the tool with ref and vclick', click.status === 302 && land && land.host === `localhost:${TOOL_PORT}` && land.searchParams.get('ref') === affRow.code && !!land.searchParams.get('vclick'), click.location);
    const vclick = land && land.searchParams.get('vclick');
    const page = await buyer.get(land.toString());
    const attrCk = buyer.jar.get('voo_attr', 'localhost');
    const kept = attrCk ? K.decodeAttribution(decodeURIComponent(attrCk.value)) : {};
    check('journey: the tool keeps ref and vclick in its own first-party cookie voo_attr (60 days, SameSite=Lax)', page.status === 200 && kept.ref === affRow.code && kept.vclick === vclick && /Max-Age=5184000/.test(attrCk.raw) && /SameSite=Lax/.test(attrCk.raw), attrCk && attrCk.raw);
    check('journey: the landing page has Start free (prompt=signup) and the browser snippet', typeof page.data === 'string' && page.data.includes('/auth/voosquare?signup=1') && page.data.includes('/voo-connect-browser.js'));
    // HV-1 (Vooads H1): the tool carries ?ref= alone onto its own links; the next page must not wipe the kept vclick.
    const inner = await buyer.get(`${TOOL}/?ref=${affRow.code}`);
    const keptAfter = K.decodeAttribution(decodeURIComponent((buyer.jar.get('voo_attr', 'localhost') || { value: '' }).value));
    check('journey: a later page with only ?ref= of the same affiliate keeps the vclick (and its click time)', inner.status === 200 && keptAfter.ref === affRow.code && keptAfter.vclick === vclick && keptAfter.t === kept.t, keptAfter);
    const snippet = await buyer.get(`${TOOL}/voo-connect-browser.js`);
    check('journey: the tool serves voo-connect-browser.js', snippet.status === 200 && String(snippet.data).includes('w.VooConnect = {'));
    // In-app browsers and other domains lose VooSquare's own click cookie: only the kit's hand-off can attribute now.
    buyer.jar.clear('127.0.0.1');
    const start = await buyer.get(`${TOOL}/auth/voosquare?signup=1&return_to=/dashboard`);
    const az = start.location ? new URL(start.location) : null;
    const stCk = buyer.jar.get('voo_state', 'localhost');
    check('journey: Start free → /oauth/authorize with client_id, exact redirect_uri, state, prompt=signup, ref and vclick', start.status === 302 && az && az.origin === VS && az.pathname === '/oauth/authorize' && az.searchParams.get('client_id') === CRED.clientId
      && az.searchParams.get('redirect_uri') === CB && (az.searchParams.get('state') || '').length >= 20 && az.searchParams.get('prompt') === 'signup' && az.searchParams.get('ref') === affRow.code && az.searchParams.get('vclick') === vclick, start.location);
    check('journey: the login state is kept in a signed HttpOnly cookie for 10 minutes', !!stCk && /HttpOnly/.test(stCk.raw) && /Max-Age=600/.test(stCk.raw), stCk && stCk.raw);
    const a1 = await buyer.get(az.toString());
    check('journey: VooSquare opens its sign-up view branded for the tool (mode=signup)', a1.status === 302 && a1.location.startsWith('/login?product=demo-tool&mode=signup&next='), a1.location);
    const next = new URLSearchParams(a1.location.split('?')[1]).get('next');
    const member = await signup(buyer, 'buyer@vconnect.test', 'Bola Buyer', 'demo-tool');
    const a2 = await buyer.get(VS + next);
    const back = a2.location ? new URL(a2.location) : null;
    check('journey: after sign-up VooSquare returns to the tool callback with a code and the same state', a2.status === 302 && back && back.origin + back.pathname === CB && !!back.searchParams.get('code') && back.searchParams.get('state') === az.searchParams.get('state'), a2.location);
    const cb = await buyer.get(back.toString());
    check('journey: the callback verifies, starts the tool session and goes to return_to', cb.status === 302 && cb.location === '/dashboard' && !!buyer.jar.get('demo_sess', 'localhost'), { status: cb.status, loc: cb.location, body: String(cb.data).slice(0, 200) });
    check('journey: the hand-off cookie and the state cookie are cleared after login', !buyer.jar.get('voo_attr', 'localhost') && !buyer.jar.get('voo_state', 'localhost'), buyer.jar.c.map((x) => x.name));
    const dash = await buyer.get(`${TOOL}/dashboard`);
    const csrf = (/name="csrf" value="([a-f0-9]+)"/.exec(String(dash.data)) || [])[1];
    check('journey: the dashboard shows the Voo ID', dash.status === 200 && String(dash.data).includes(member.voo_id) && !!csrf);
    const at = q1('SELECT t.*, f.code FROM aff_attributions t JOIN aff_affiliates f ON f.id=t.affiliate_id WHERE t.customer_user_id=(SELECT id FROM users WHERE voo_id=?)', member.voo_id);
    check('journey: attribution recorded from the vclick hand-off (affiliate, link, sub1, external click id)', at && at.code === affRow.code && at.method === 'link' && at.sub1 === 'fb_ng' && at.ext_click_id === 'CLK-VC1', at);
    let st = await toolState();
    const local = st.users[member.voo_id];
    check('journey: the tool created its user by voo_id and saved country and voo_ref (the affiliate is the referrer)', local && local.email === 'buyer@vconnect.test' && local.referred_by === q1('SELECT ref_code FROM users WHERE id=?', affRow.user_id).ref_code, local);

    console.log('Voo Connect: money events → commission, refund, chargeback');
    const evRow = (ext) => q1('SELECT * FROM events WHERE product_id=? AND ext_id=?', prod.id, ext);
    const custId = q1('SELECT id FROM users WHERE voo_id=?', member.voo_id).id;
    const coms = () => qa('SELECT * FROM aff_commissions WHERE customer_user_id=? ORDER BY id', custId);
    const pay1 = await buyer.post(`${TOOL}/billing/subscribe`, { form: { plan: 'Pro', csrf } });
    check('money: a logged-in POST without the form token is refused (CSRF)', (await buyer.post(`${TOOL}/billing/subscribe`, { form: { plan: 'Pro' } })).status === 403);
    await until(() => evRow('demo_pay_1') && evRow('demo_plan_1'));
    const sp = evRow('demo_pay_1');
    check('money: plan payment → spend (stable event_id demo_pay_1, $99, plan Pro) and plan_started', pay1.status === 200 && sp && sp.type === 'spend' && sp.value_usd === 99 && sp.plan === 'Pro' && evRow('demo_plan_1').type === 'plan_started', { pay1: pay1.data, sp });
    const rs = await until(() => coms().find((c) => c.type === 'revshare'));
    check('money: spend → RevShare commission available at once (20% of $99)', rs && rs.affiliate_id === acct.id && rs.amount_cents === 1980 && rs.status === 'available' && rs.product_key === 'demo-tool', coms());
    check('money: plan_started adds a new plan to the catalogue as provisional (price from the tool, waiting for an admin)', !!q1("SELECT 1 FROM aff_plans WHERE product_key='demo-tool' AND plan='Pro' AND price_cents=9900 AND price_source='tool' AND reported_cents=9900"));
    // HJ-2: one customer's plan event (a discount, a custom deal, a yearly price) never changes the catalogue price.
    const postEv = async (events) => (await fetch(`${VS}/api/v1/events`, { method: 'POST', headers: { authorization: 'Bearer ' + CRED.apiKey, 'content-type': 'application/json' }, body: JSON.stringify({ events }) })).json();
    const planRow = (pl) => q1("SELECT * FROM aff_plans WHERE product_key='demo-tool' AND plan=?", pl);
    const disc = await postEv([{ event_id: 'demo_x_renew_disc', voo_id: ownerUser.voo_id, type: 'plan_renewed', plan: 'Pro', value_usd: 79 }]);
    check('plans: a plan event with another amount keeps the catalogue price, records the paid amount and flags a mismatch', disc.stored === 1 && planRow('Pro').price_cents === 9900 && planRow('Pro').reported_cents === 7900 && planRow('Pro').mismatch_count === 1 && !!planRow('Pro').mismatch_at, planRow('Pro'));
    const adm = (await owner.get(`${VS}/api/admin/aff/products`)).data.products.find((x) => x.key === 'demo-tool');
    const admPro = adm && adm.plans.find((x) => x.plan === 'Pro');
    check('plans: the back office lists the plan as needing review (provisional, 1 different amount, last paid $79)', admPro && admPro.needs_review === true && admPro.confirmed === false && admPro.mismatch_count === 1 && admPro.reported_cents === 7900 && adm.plans_to_review === 1, adm && adm.plans);
    const conf = await owner.req('PUT', `${VS}/api/admin/aff/products/demo-tool/plans`, { body: { plan: 'Pro', price_usd: 99 } });
    check('plans: an admin confirms the price → admin-owned, mismatch cleared, audited', conf.status === 200 && planRow('Pro').price_source === 'admin' && planRow('Pro').mismatch_count === 0 && !planRow('Pro').mismatch_at && planRow('Pro').confirmed_by === q1("SELECT id FROM users WHERE email='owner@vconnect.test'").id && !!q1("SELECT 1 FROM aff_audit WHERE action='plan.price' AND target='demo-tool:Pro'"), conf.data);
    await postEv([{ event_id: 'demo_x_plan_cheap', voo_id: ownerUser.voo_id, type: 'plan_started', plan: 'Pro', value_usd: 49 }]);
    check('plans: a later plan event never overwrites an admin price (still $99, flagged again)', planRow('Pro').price_cents === 9900 && planRow('Pro').price_source === 'admin' && planRow('Pro').mismatch_count === 1 && planRow('Pro').reported_cents === 4900, planRow('Pro'));
    const notAdmin = await buyer.req('PUT', `${VS}/api/admin/aff/products/demo-tool/plans`, { body: { plan: 'Pro', price_usd: 1 } });
    check('plans: only a program admin can set a catalogue price', notAdmin.status === 403 && planRow('Pro').price_cents === 9900, notAdmin.status);
    await owner.req('PUT', `${VS}/api/admin/aff/products/demo-tool/plans`, { body: { plan: 'Business', price_usd: 299 } });
    await owner.req('PUT', `${VS}/api/admin/aff/products/demo-tool/plans`, { body: { plan: 'Titan', price_usd: 599 } });
    const sug = (await owner.get(`${VS}/api/admin/aff/products`)).data.products.find((x) => x.key === 'demo-tool').plans;
    const sugOf = (pl) => (sug.find((x) => x.plan === pl) || {}).suggested_cpa_cents;
    check('plans: suggested CPA never pays more than the plan price ($99 → $95, $299 → $295) and stops at the $300 program maximum ($599 → $300)', sugOf('Pro') === 9500 && sugOf('Business') === 29500 && sugOf('Titan') === 30000, sug);
    const rmPlan = await owner.req('DELETE', `${VS}/api/admin/aff/products/demo-tool/plans?plan=Titan`);
    check('plans: an admin can remove a plan name from the catalogue', rmPlan.status === 200 && !planRow('Titan'), rmPlan.data);
    await owner.req('DELETE', `${VS}/api/admin/aff/products/demo-tool/plans?plan=Business`);
    await buyer.post(`${TOOL}/billing/topup`, { form: { usd: '50', csrf } });
    await until(() => evRow('demo_pay_2'));
    await sleep(150);
    check('money: wallet top-up → wallet_topup, no commission', evRow('demo_pay_2') && evRow('demo_pay_2').type === 'wallet_topup' && coms().length === 1, coms());
    await buyer.post(`${TOOL}/billing/use`, { form: { usd: '5', csrf } });
    await buyer.post(`${TOOL}/billing/use`, { form: { usd: '5', csrf } });
    const day = new Date().toISOString().slice(0, 10);
    const close1 = await toolAdmin.post(`${TOOL}/billing/close-day`, { headers: adminH, form: {} });
    const useId = `demo_use_${day}_${member.voo_id}`;
    await until(() => evRow(useId));
    await until(() => coms().length === 2);
    await toolAdmin.post(`${TOOL}/billing/close-day`, { headers: adminH, form: {} }); // the daily job runs twice
    await toolAdmin.post(`${TOOL}/admin/flush`, { headers: adminH, form: {} });
    check('money: credits used → one spend per customer per day ($10), commissionable; re-running the job never double counts', close1.data.customers === 1 && evRow(useId) && evRow(useId).value_usd === 10
      && qa('SELECT id FROM events WHERE ext_id=?', useId).length === 1 && coms().filter((c) => c.type === 'revshare').length === 2 && coms()[1].amount_cents === 200, coms());

    // VooSquare's dashboard card: VooSquare calls the tool's summary URL with the API key.
    const home = await buyer.get(`${VS}/api/me/home`);
    const card = home.data && home.data.tools && home.data.tools.find((t) => t.slug === 'demo-tool');
    check('summary: the member\'s VooSquare home shows the tool card from the summary URL (and the launch link)', card && card.summary && card.summary.status === 'active' && card.summary.metrics.find((m) => m.key === 'payments').value === 1 && card.launch_url === `${TOOL}/auth/voosquare?return_to=/dashboard`, card);

    // HR-2: the launcher opens the product's configured launch path (default /dashboard).
    const prodBody = { id: prod.id, name: 'Demo tool', url: TOOL, sso: true, status: 'live', visible: 1, redirect_uris: [CB, `${TOOL}/`], summary_url: `${TOOL}/api/voosquare/summary`, support_webhook: `${TOOL}/hooks/voosquare/support` };
    const lp1 = await owner.post(`${VS}/api/admin/products`, { body: { ...prodBody, launch_path: '/app' } });
    const card2 = (await buyer.get(`${VS}/api/me/home`)).data.tools.find((t) => t.slug === 'demo-tool');
    const lpBad = await owner.post(`${VS}/api/admin/products`, { body: { ...prodBody, launch_path: '//evil.example/x' } });
    const lpKept = q1('SELECT launch_path FROM products WHERE id=?', prod.id).launch_path;
    const lp2 = await owner.post(`${VS}/api/admin/products`, { body: { ...prodBody, launch_path: '/app/inbox?tab=new' } });
    const card3 = (await buyer.get(`${VS}/api/me/home`)).data.tools.find((t) => t.slug === 'demo-tool');
    await owner.post(`${VS}/api/admin/products`, { body: { ...prodBody, launch_path: '' } });
    const card4 = (await buyer.get(`${VS}/api/me/home`)).data.tools.find((t) => t.slug === 'demo-tool');
    check('launch: the launcher uses the product launch path (/app), refuses an off-site path, encodes a query, and falls back to /dashboard', lp1.status === 200 && lp1.data.product.launch_path === '/app' && card2.launch_url === `${TOOL}/auth/voosquare?return_to=/app`
      && lpBad.status === 400 && lpKept === '/app' && lp2.status === 200 && card3.launch_url === `${TOOL}/auth/voosquare?return_to=/app/inbox%3Ftab%3Dnew` && new URL(card3.launch_url).searchParams.get('return_to') === '/app/inbox?tab=new'
      && card4.launch_url === `${TOOL}/auth/voosquare?return_to=/dashboard`, { lp1: lp1.data && lp1.data.product && lp1.data.product.launch_path, card2: card2.launch_url, lpBad: lpBad.status, card3: card3.launch_url, card4: card4.launch_url });

    await toolAdmin.post(`${TOOL}/admin/refund`, { headers: adminH, form: { payment_id: '1' } });
    await until(() => evRow('demo_rf_1'));
    await sleep(150);
    check('money: refund (original_event_id = demo_pay_1, plan Pro) → logged, no clawback, commission stays available', evRow('demo_rf_1').type === 'refund' && evRow('demo_rf_1').ref_event === 'demo_pay_1' && !coms().some((c) => c.type === 'clawback') && coms()[0].status === 'available', coms());
    await buyer.post(`${TOOL}/billing/subscribe`, { form: { plan: 'Pro', csrf } });
    await until(() => evRow('demo_pay_3') && evRow('demo_renew_3'));
    check('money: a second plan payment → spend + plan_renewed', evRow('demo_pay_3').type === 'spend' && evRow('demo_renew_3').type === 'plan_renewed');
    await until(() => coms().filter((c) => c.type === 'revshare').length === 3);
    await toolAdmin.post(`${TOOL}/admin/chargeback`, { headers: adminH, form: { payment_id: '3' } });
    const claw = await until(() => coms().find((c) => c.type === 'clawback'));
    check('money: chargeback (original_event_id = demo_pay_3) → clawback of that payment\'s commission (-$19.80)', evRow('demo_cb_3') && evRow('demo_cb_3').type === 'chargeback' && claw && claw.amount_cents === -1980 && claw.affiliate_id === acct.id, coms());
    st = await toolState();
    check('money: the tool\'s outbox is empty and nothing was refused', st.pending.length === 0 && st.failed.length === 0, { pending: st.pending, failed: st.failed });

    // HS-1: a refund or chargeback that points at a payment VooSquare never received is refused with a reason.
    const ghost = await postEv([
      { event_id: 'demo_x_rf_ghost', voo_id: ownerUser.voo_id, type: 'refund', value_usd: 5, original_event_id: 'demo_pay_never_sent' },
      { event_id: 'demo_x_cb_ghost', voo_id: 'vs_nope', type: 'chargeback', value_usd: 5, original_event_id: 'demo_pay_never_sent' },
      { event_id: 'demo_x_rf_of_rf', voo_id: ownerUser.voo_id, type: 'refund', value_usd: 5, original_event_id: 'demo_rf_1' },
    ]);
    const ghostIds = (ghost.rejected || []).map((r) => r.event_id);
    check('events: refund / chargeback whose original_event_id VooSquare never received (or that points at another refund) → rejected with a reason, not stored', ghost.stored === 0 && ghostIds.join(',') === 'demo_x_rf_ghost,demo_x_cb_ghost,demo_x_rf_of_rf'
      && ghost.rejected.every((r) => /original event not found/.test(r.error) && !/send (this|it) (one )?again|resend|try again|retry|later/i.test(r.error)) && !evRow('demo_x_rf_ghost') && !evRow('demo_x_cb_ghost'), ghost);
    const paired = await postEv([
      { event_id: 'demo_x_pay_9', voo_id: ownerUser.voo_id, type: 'spend', value_usd: 9, plan: 'Pro' },
      { event_id: 'demo_x_rf_9', voo_id: ownerUser.voo_id, type: 'refund', value_usd: 9, original_event_id: 'demo_x_pay_9' },
      { event_id: 'demo_x_rf_credits', voo_id: ownerUser.voo_id, type: 'refund', value_usd: 3, label: 'Unused credits returned' },
    ]);
    const again = await postEv([{ event_id: 'demo_x_rf_9', voo_id: ownerUser.voo_id, type: 'refund', value_usd: 9, original_event_id: 'demo_x_pay_9' }]);
    check('events: a refund of a payment sent earlier in the same call is stored; a refund without original_event_id (unused credits) is still stored; a resend is a quiet duplicate', paired.stored === 3 && !paired.rejected && again.stored === 0 && !again.rejected, { paired, again });
    // HC-3: rejected[].event_id echoes the id exactly as sent, so a tool can match it to its queue.
    const longExt = 'demo_' + 'L'.repeat(240);
    const echo = await postEv([{ event_id: longExt, voo_id: ownerUser.voo_id, type: 'spend', value_usd: 1 }, { event_id: 'demo_' + 'T'.repeat(120) }]);
    check('events: rejected entries echo the original event_id in full (over-long id, missing type)', echo.stored === 0 && echo.rejected.length === 2 && echo.rejected[0].event_id === longExt && /longer than 80/.test(echo.rejected[0].error) && echo.rejected[1].event_id === 'demo_' + 'T'.repeat(120), echo.rejected && echo.rejected.map((r) => [r.event_id.length, r.error]));

    console.log('Voo Connect: support API and the staff-reply webhook');
    const sup = await buyer.post(`${TOOL}/support`, { form: { body: 'My pixel does not fire', csrf } });
    const tid = sup.data && sup.data.ticket_id;
    const tk = tid && q1('SELECT * FROM tickets WHERE id=?', tid);
    check('support: the tool forwards a message into the VooSquare inbox (product, voo_id user, external_ref)', sup.status === 200 && tk && tk.product_id === prod.id && tk.user_id === custId && tk.external_ref === `demo-${member.voo_id}`, sup.data);
    await owner.post(`${VS}/api/admin/tickets/${tid}/reply`, { body: { body: 'Check the pixel ID in settings.' } });
    let got = null;
    for (let i = 0; i < 80 && !got; i++) { got = (await toolState()).replies.find((x) => x.ticket_id === tid) || null; if (!got) await sleep(60); }
    check('support: the staff reply reaches the tool webhook (Bearer API key checked by the kit)', got && got.type === 'support.reply' && got.body === 'Check the pixel ID in settings.' && got.external_ref === `demo-${member.voo_id}`, got);

    console.log('Voo Connect: logout everywhere');
    const lo = await buyer.get(`${TOOL}/logout`);
    const lou = lo.location ? new URL(lo.location) : null;
    check('logout: the tool clears its session and sends the browser to VooSquare /oauth/logout with its home page', lo.status === 302 && lou && lou.origin === VS && lou.pathname === '/oauth/logout' && lou.searchParams.get('redirect_uri') === `${TOOL}/` && !buyer.jar.get('demo_sess', 'localhost'), lo.location);
    const lo2 = await buyer.get(lo.location);
    check('logout: VooSquare ends its session and comes back to the tool home page', lo2.status === 302 && lo2.location === `${TOOL}/` && !(await buyer.get(`${VS}/api/me`)).data.user, lo2.location);
    check('logout: the tool dashboard asks to log in again', (await buyer.get(`${TOOL}/dashboard`)).location === '/auth/voosquare?return_to=/dashboard');

    /* ================= the kit on its own ================= */
    console.log('Voo Connect: kit login helpers (id_token, state, return_to)');
    const kit = K.createVooConnect({ base: VS, ...CRED, redirectUri: CB, eventPrefix: 'vc', backoffMs: 20, onError: () => {}, onRejected: () => {} });
    const u1 = new URL(kit.authorizeUrl({ state: 'abc', prompt: 'signup', ref: affRow.code, vclick: 'AbCdEf12', coupon: 'bad coupon!' }));
    check('kit: authorizeUrl carries client_id, redirect_uri, state, prompt=signup, ref, vclick; drops an invalid coupon', u1.searchParams.get('prompt') === 'signup' && u1.searchParams.get('ref') === affRow.code && u1.searchParams.get('vclick') === 'AbCdEf12' && !u1.searchParams.has('coupon') && u1.searchParams.get('redirect_uri') === CB);
    let threw = null; try { kit.authorizeUrl({}); } catch (e) { threw = e; }
    check('kit: authorizeUrl refuses to build a URL without state', threw && threw.code === 'config');
    const affleego = K.createVooConnect({ base: VS, ...CRED, redirectUri: CB, affiliate: false });
    check('kit: affiliate: false (Affleego) never passes ref / vclick / coupon', !new URL(affleego.authorizeUrl({ state: 's', ref: affRow.code, vclick: 'AbCdEf12' })).searchParams.has('ref'));
    check('kit: logoutUrl', kit.logoutUrl(`${TOOL}/`) === `${VS}/oauth/logout?redirect_uri=${encodeURIComponent(`${TOOL}/`)}`);
    // A real code for the owner (logged in on VooSquare): authorize answers at once with a code.
    const oa = await owner.get(kit.authorizeUrl({ state: 'own1' }));
    const code = new URL(oa.location).searchParams.get('code');
    const tok = await kit.exchangeCode(code);
    const claims = kit.verifyIdToken(tok.id_token);
    check('kit: exchangeCode + verifyIdToken on a real VooSquare id_token (aud, iss, exp)', claims.voo_id === ownerUser.voo_id && claims.aud === CRED.clientId && claims.iss === VS, claims);
    const ui = await kit.userinfo(tok.access_token);
    check('kit: userinfo with the access token', ui.voo_id === ownerUser.voo_id && ui.email === 'owner@vconnect.test', ui);
    const ug = await kit.users.get(ownerUser.voo_id);
    check('kit: users.get with the API key (aud = this tool)', ug.voo_id === ownerUser.voo_id && ug.aud === CRED.clientId);
    let reuse = null; try { await kit.exchangeCode(code); } catch (e) { reuse = e; }
    check('kit: a code is single use → VooError invalid_grant (status 400)', reuse && reuse.code === 'invalid_grant' && reuse.status === 400, reuse && reuse.message);
    const badKit = K.createVooConnect({ base: VS, clientId: CRED.clientId, clientSecret: 'vss_wrong', redirectUri: CB });
    let bad = null; try { await badKit.exchangeCode('x'); } catch (e) { bad = e; }
    check('kit: wrong client secret → VooError invalid_client (401)', bad && bad.code === 'invalid_client' && bad.status === 401);
    const nowS = Math.floor(Date.now() / 1000);
    const base = { sub: 'vs_x', voo_id: 'vs_x', aud: CRED.clientId, iss: VS, iat: nowS, exp: nowS + 3600 };
    const idErr = (t, k = kit) => { try { k.verifyIdToken(t); return null; } catch (e) { return e.code; } };
    const [hh, pp, ss] = tok.id_token.split('.');
    const forged = `${hh}.${Buffer.from(JSON.stringify({ ...claims, voo_id: 'vs_evil', sub: 'vs_evil' })).toString('base64url')}.${ss}`;
    check('kit: verifyIdToken refuses a changed payload, another secret, another aud, another iss, an expired token, alg none', idErr(forged) === 'invalid_id_token' && idErr(tok.id_token, badKit) === 'invalid_id_token'
      && idErr(jwt({ ...base, aud: 'vsc_other' }, CRED.clientSecret)) === 'invalid_id_token' && idErr(jwt({ ...base, iss: 'https://evil.example' }, CRED.clientSecret)) === 'invalid_id_token'
      && idErr(jwt({ ...base, exp: nowS - 3600, iat: nowS - 7200 }, CRED.clientSecret)) === 'invalid_id_token' && idErr(`${Buffer.from('{"alg":"none"}').toString('base64url')}.${pp}.`) === 'invalid_id_token' && idErr(jwt(base, CRED.clientSecret)) === null);
    // startLogin / handleCallback with crafted requests.
    const s1 = fakeReqRes('/auth/voosquare?return_to=//evil.example/x&signup=1');
    kit.startLogin(s1.req, s1.res);
    const stateCookie = [].concat(s1.res.headers['set-cookie']).find((c) => c.startsWith('voo_state='));
    const stVal = decodeURIComponent(stateCookie.split(';')[0].slice('voo_state='.length));
    const stObj = JSON.parse(Buffer.from(stVal.split('.')[0], 'base64url').toString());
    check('kit: startLogin never keeps an off-site return_to (//evil.example → /dashboard)', s1.res.statusCode === 302 && stObj.r === '/dashboard' && new URL(s1.res.headers.location).searchParams.get('prompt') === 'signup', stObj);
    const cbErr = async (url, cookie) => { const f = fakeReqRes(url, { cookie }); try { await kit.handleCallback(f.req, f.res); return null; } catch (e) { return e.code; } };
    check('kit: handleCallback refuses a missing state cookie, a wrong state, a tampered state cookie, and an error answer', await cbErr('/cb?code=x&state=y', '') === 'state_missing'
      && await cbErr(`/cb?code=x&state=wrong`, `voo_state=${encodeURIComponent(stVal)}`) === 'state_mismatch'
      && await cbErr(`/cb?code=x&state=${stObj.s}`, `voo_state=${encodeURIComponent(stVal.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))}`) === 'state_missing'
      && await cbErr(`/cb?error=access_denied&state=${stObj.s}`, `voo_state=${encodeURIComponent(stVal)}`) === 'access_denied');
    check('kit: safeReturnTo keeps local paths only', K.safeReturnTo('/a?b=1') === '/a?b=1' && K.safeReturnTo('https://evil.example') === '/' && K.safeReturnTo('/\\evil.example') === '/' && K.safeReturnTo('//x') === '/');

    console.log('Voo Connect: attribution middleware (last click wins)');
    const mw = kit.captureAttribution();
    const runMw = (url, cookie = '', k = mw) => { const f = fakeReqRes(url, { cookie }); let nexted = false; k(f.req, f.res, () => { nexted = true; }); const c = [].concat(f.res.headers['set-cookie'] || []).find((x) => x.startsWith('voo_attr=')); return { nexted, cookie: c, kept: c ? K.decodeAttribution(decodeURIComponent(c.split(';')[0].slice(9))) : null }; };
    const m1 = runMw('/?ref=amaref&vclick=Click0001&sub1=x');
    const old = `voo_attr=${encodeURIComponent(K.encodeAttribution({ ref: 'oldref', vclick: 'OldClick01', coupon: 'OLD10', t: 1 }))}`;
    const m2 = runMw('/?ref=newref&vclick=Click0002', old);
    const m3 = runMw('/pricing?coupon=NEW20', old);
    const m4 = runMw('/?ref=<script>&vclick=a');
    check('kit: middleware keeps ref+vclick and calls next()', m1.nexted && m1.kept.ref === 'amaref' && m1.kept.vclick === 'Click0001' && !/HttpOnly/.test(m1.cookie), m1);
    check('kit: a newer click replaces the older one entirely (its coupon does not ride along)', m2.kept.ref === 'newref' && m2.kept.vclick === 'Click0002' && !m2.kept.coupon, m2.kept);
    check('kit: a coupon-only URL keeps the click and adds the coupon', m3.kept.ref === 'oldref' && m3.kept.vclick === 'OldClick01' && m3.kept.coupon === 'NEW20', m3.kept);
    check('kit: invalid values are dropped, no cookie written', m4.nexted && !m4.cookie);
    const kept1 = `voo_attr=${encodeURIComponent(K.encodeAttribution({ ref: 'oldref', vclick: 'OldClick01', coupon: 'OLD10', t: 7 }))}`;
    const m5 = runMw('/pricing?ref=OLDREF', kept1);
    const m6 = runMw('/pricing?ref=otherref', kept1);
    const m7 = runMw('/pricing?ref=oldref&coupon=NEW20', kept1);
    check('kit: ?ref= alone of the same affiliate keeps the kept vclick, coupon and click time (Vooads H1)', m5.kept.ref === 'oldref' && m5.kept.vclick === 'OldClick01' && m5.kept.coupon === 'OLD10' && m5.kept.t === 7, m5.kept);
    check('kit: ?ref= of another affiliate is a new click: the old vclick and coupon are dropped (last click wins)', m6.kept.ref === 'otherref' && !m6.kept.vclick && !m6.kept.coupon, m6.kept);
    check('kit: ?ref= of the same affiliate with a coupon keeps the vclick and takes the new coupon', m7.kept.vclick === 'OldClick01' && m7.kept.coupon === 'NEW20', m7.kept);
    const s3 = fakeReqRes('/auth/voosquare?ref=oldref&signup=1', { cookie: kept1 });
    kit.startLogin(s3.req, s3.res);
    const az3 = new URL(s3.res.headers.location);
    check('kit: startLogin from a link with only ?ref= still sends the kept vclick to /oauth/authorize', az3.searchParams.get('ref') === 'oldref' && az3.searchParams.get('vclick') === 'OldClick01', az3.toString());
    check('kit: MONEY_TYPES matches VooSquare\'s money events (plan_started / plan_renewed included)', ['spend', 'refund', 'chargeback', 'wallet_topup', 'plan_started', 'plan_renewed'].every((t) => K.MONEY_TYPES.includes(t)) && K.MONEY_TYPES.length === 6);
    check('kit: affiliate: false writes nothing', !runMw('/?ref=amaref&vclick=Click0001', '', affleego.captureAttribution()).cookie);
    const s2 = fakeReqRes('/auth/voosquare', { cookie: old });
    kit.startLogin(s2.req, s2.res);
    const az2 = new URL(s2.res.headers.location);
    check('kit: startLogin replays the kept click from the cookie; no prompt without ?signup=1', az2.searchParams.get('ref') === 'oldref' && az2.searchParams.get('vclick') === 'OldClick01' && az2.searchParams.get('coupon') === 'OLD10' && !az2.searchParams.has('prompt'));

    console.log('Voo Connect: events client (validation, batching, resend of rejected, retries, outbox)');
    const inv = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
    const ev = kit.events;
    check('kit: events refuse negative money, a chargeback without original_event_id, an email in the label, personal data fields, raw signals, long ids, spend without voo_id or below 1 cent',
      inv(() => ev.spend({ eventId: 'x1', vooId: 'vs_a', valueUsd: -5 })) === 'invalid_event' && inv(() => ev.chargeback({ eventId: 'x2', vooId: 'vs_a', valueUsd: 5 })) === 'invalid_event'
      && inv(() => ev.spend({ eventId: 'x3', vooId: 'vs_a', valueUsd: 5, label: 'from ada@b.com' })) === 'invalid_event' && inv(() => ev.track({ event_id: 'x4', type: 'lead', email: 'a@b.com' })) === 'invalid_event'
      && inv(() => ev.spend({ eventId: 'x5', vooId: 'vs_a', valueUsd: 5, signals: { phone_hash: '+2348012345678' } })) === 'invalid_event' && inv(() => ev.track({ event_id: 'x'.repeat(81), type: 'lead' })) === 'invalid_event'
      && inv(() => ev.spend({ eventId: 'x6', valueUsd: 5 })) === 'invalid_event' && inv(() => ev.spend({ eventId: 'x7', vooId: 'vs_a', valueUsd: 0.004 })) === 'invalid_event'
      && inv(() => ev.planStarted({ eventId: 'x8', vooId: 'vs_a', valueUsd: 9 })) === 'invalid_event' && inv(() => ev.track({ event_id: 'x9', type: 'lead', occurred_at: Date.now() - 401 * 86400_000 })) === 'invalid_event' && ev.pending().length === 0);
    const longId = ev.id('use', '2026-10-05', 'vs_' + 'a'.repeat(90));
    check('kit: events.id is stable, prefixed and at most 80 characters', ev.id('pay', 7) === 'vc_pay_7' && longId.length <= 80 && longId === ev.id('use', '2026-10-05', 'vs_' + 'a'.repeat(90)) && ev.id('use', new Date('2026-10-05T10:00:00Z'), 'vs_a') === 'vc_use_2026-10-05_vs_a');
    const n = ev.spend({ eventId: 'vc_cents', vooId: member.voo_id, valueUsd: 12.345, plan: 'Pro', country: 'ng', signals: { payment_fingerprint: kit.hashSignal('4242'), payment_country: 'ng' } });
    check('kit: spend is normalised (cents, ISO time, country upper case, hashed signal)', n.value_usd === 12.35 && /Z$/.test(n.occurred_at) && n.country === 'NG' && /^[a-f0-9]{64}$/.test(n.signals.payment_fingerprint) && n.signals.payment_country === 'NG', n);
    ev.spend({ eventId: 'vc_cents', vooId: member.voo_id, valueUsd: 99 });
    check('kit: the same event_id queued twice is sent once', ev.pending().filter((x) => x.event_id === 'vc_cents').length === 1);
    await ev.drain({ timeoutMs: 5000 });
    check('kit: drain sends the queue', !!evRow('vc_cents') && evRow('vc_cents').value_usd === 12.35 && ev.pending().length === 0);

    // Resend of `rejected`: an oversized call (test hook) makes VooSquare reject events past the 100th "send this one again".
    const big = K.createVooConnect({ base: VS, ...CRED, redirectUri: CB, _unsafeBatchSize: 105, onError: () => {} });
    for (let i = 0; i < 105; i++) big.events.activity('join', { eventId: `vc_bulk_${String(i).padStart(3, '0')}`, vooId: member.voo_id, label: 'Join from Video 3' });
    const fr = await big.events.flush();
    const bulk = q1("SELECT COUNT(*) n FROM events WHERE product_id=? AND ext_id LIKE 'vc_bulk_%'", prod.id).n;
    check('kit: events VooSquare lists in `rejected` with "send again" are resent in the next call (105 → 100 + 5, all stored once)', fr.calls === 2 && fr.resent === 5 && fr.stored === 105 && bulk === 105 && big.events.pending().length === 0, { fr, bulk });
    const norm = K.createVooConnect({ base: VS, ...CRED, redirectUri: CB, onError: () => {} });
    for (let i = 0; i < 230; i++) norm.events.activity('lead', { eventId: `vc_batch_${i}`, vooId: member.voo_id });
    const nb = await norm.events.flush();
    check('kit: 230 events go out in calls of at most 100 (3 calls), nothing rejected', nb.calls === 3 && nb.stored === 230 && nb.resent === 0 && q1("SELECT COUNT(*) n FROM events WHERE ext_id LIKE 'vc_batch_%'").n === 230, nb);
    // A refusal for good (simulated: an event older than 400 days slipped past the kit) is reported, never retried forever.
    const refused = [];
    const perm = K.createVooConnect({ base: VS, ...CRED, redirectUri: CB, onError: () => {}, onRejected: (e, err) => refused.push([e.event_id, err]) });
    perm.events.queue.push({ event: { event_id: 'vc_ancient', voo_id: member.voo_id, type: 'lead', occurred_at: new Date(Date.now() - 500 * 86400_000).toISOString() }, attempts: 0, next: 0 });
    perm.events.activity('lead', { eventId: 'vc_fresh', vooId: member.voo_id });
    const pr = await perm.events.flush();
    check('kit: a permanent rejection goes to onRejected and failures(), the rest is stored, the queue empties', pr.rejected.length === 1 && refused[0][0] === 'vc_ancient' && /400 days/.test(refused[0][1]) && perm.events.failures().length === 1 && perm.events.pending().length === 0 && !!evRow('vc_fresh') && !evRow('vc_ancient'), { pr, refused });

    // Retries with backoff through a flaky proxy in front of VooSquare.
    const fl = { mode: [], calls: 0 };
    flaky = http.createServer((req, res) => {
      const chunks = []; req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        fl.calls++;
        const m = fl.mode.shift() || 'pass';
        if (m === '503') { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":"busy"}'); }
        if (m === '429') { res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' }); return res.end('{"error":"Slow down"}'); }
        const up = http.request({ host: '127.0.0.1', port: VS_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${VS_PORT}` } }, (r2) => {
          const out = []; r2.on('data', (c) => out.push(c));
          r2.on('end', () => {
            if (m === 'lost') { res.writeHead(502); return res.end(); } // VooSquare stored it, the answer never arrived
            res.writeHead(r2.statusCode, r2.headers); res.end(Buffer.concat(out));
          });
        });
        up.on('error', () => { res.writeHead(502); res.end(); });
        up.end(Buffer.concat(chunks));
      });
    });
    await new Promise((r) => flaky.listen(FLAKY_PORT, '127.0.0.1', r));
    const errs = [];
    const viaProxy = K.createVooConnect({ base: VS, serverBase: `http://127.0.0.1:${FLAKY_PORT}`, ...CRED, redirectUri: CB, backoffMs: 25, onError: (e) => errs.push(e.status || e.code) });
    fl.mode = ['503', '503', '429', 'pass'];
    viaProxy.events.spend({ eventId: 'vc_retry_1', vooId: member.voo_id, valueUsd: 7, plan: 'Starter' });
    const t0 = Date.now();
    const dr = await viaProxy.events.drain({ timeoutMs: 8000 });
    check('kit: 503, 503, 429 (Retry-After 1 s) then success → retried with backoff, stored once', dr.pending === 0 && fl.calls === 4 && errs.join(',') === '503,503,429' && Date.now() - t0 >= 1000 && qa('SELECT id FROM events WHERE ext_id=?', 'vc_retry_1').length === 1 && viaProxy.events.stats.retries === 3, { dr, calls: fl.calls, errs, ms: Date.now() - t0 });
    fl.calls = 0; fl.mode = ['lost', 'pass'];
    viaProxy.events.spend({ eventId: 'vc_lost_1', vooId: member.voo_id, valueUsd: 3 });
    await viaProxy.events.drain({ timeoutMs: 5000 });
    check('kit: a lost answer (VooSquare stored it, the tool saw 502) is retried and still counted once (stable event_id)', fl.calls === 2 && qa('SELECT id FROM events WHERE ext_id=?', 'vc_lost_1').length === 1 && coms().filter((c) => c.uniq_key && c.uniq_key.startsWith('rs:event:')).length === coms().filter((c) => c.type === 'revshare').length, fl);
    const unauth = []; const wrongKey = K.createVooConnect({ base: VS, ...CRED, apiKey: 'vsk_wrong', redirectUri: CB, onError: (e) => unauth.push(e.code) });
    wrongKey.events.activity('lead', { eventId: 'vc_unauth', vooId: member.voo_id });
    await wrongKey.events.flush();
    check('kit: a wrong API key (401) is reported clearly and the events are kept, not dropped', unauth[0] === 'unauthorized' && wrongKey.events.pending().length === 1);

    const outbox = path.join(RUN, 'outbox.json');
    const k1 = K.createVooConnect({ base: VS, serverBase: 'http://127.0.0.1:9', ...CRED, redirectUri: CB, outboxFile: outbox, onError: () => {} });
    k1.events.spend({ eventId: 'vc_outbox_1', vooId: member.voo_id, valueUsd: 4 });
    await k1.events.flush(); // VooSquare unreachable: kept on disk
    const k2 = K.createVooConnect({ base: VS, ...CRED, redirectUri: CB, outboxFile: outbox, onError: () => {} });
    const kept2 = k2.events.pending().map((x) => x.event_id);
    await k2.events.drain({ timeoutMs: 5000 });
    check('kit: outboxFile keeps events across a restart, then sends them', kept2.includes('vc_outbox_1') && !!evRow('vc_outbox_1') && JSON.parse(fs.readFileSync(outbox, 'utf8')).length === 0, kept2);

    console.log('Voo Connect: support client, webhook helpers, summary handler');
    const sm = await kit.support.send({ email: 'lead@vconnect.test', name: 'Lead', subject: 'Question', body: 'Hello from the kit', externalRef: 'kit-thread-1' });
    const th = await kit.support.thread(sm.ticket_id);
    check('kit: support.send and support.thread', sm.ok && sm.ticket_id > 0 && th.ticket.id === sm.ticket_id && th.messages[0].body === 'Hello from the kit');
    const fromVs = fakeReqRes('/hook', { headers: { authorization: `Bearer ${CRED.apiKey}` } });
    const notVs = fakeReqRes('/hook', { headers: { authorization: 'Bearer vsk_guess' } });
    check('kit: isFromVooSquare checks the Bearer API key', kit.isFromVooSquare(fromVs.req) && !kit.isFromVooSquare(notVs.req) && !kit.isFromVooSquare(fakeReqRes('/hook').req));
    const raw = JSON.stringify({ type: 'invoice.paid', invoice: { id: 'inv_1', order_id: 'X', status: 'paid' } });
    const sig = K.signHmac(raw, 'whsec_1');
    check('kit: verifyHmac / verifyGatevooSignature (exact raw body, constant time)', K.verifyGatevooSignature(raw, sig, 'whsec_1') && K.verifyHmac(raw, 'sha256=' + sig, 'whsec_1') && !K.verifyHmac(raw + ' ', sig, 'whsec_1') && !K.verifyHmac(raw, sig, 'other') && !K.verifyHmac(raw, '', 'whsec_1'));
    const hookCalls = [];
    const hook = kit.supportWebhook((r) => hookCalls.push(r));
    const h1 = fakeReqRes('/hook', { headers: { authorization: `Bearer ${CRED.apiKey}` }, body: { type: 'support.reply', ticket_id: 9, body: 'hi' } });
    await hook(h1.req, h1.res);
    const h2 = fakeReqRes('/hook', { headers: { authorization: 'Bearer nope' }, body: { type: 'support.reply', ticket_id: 9, body: 'hi' } });
    await hook(h2.req, h2.res);
    check('kit: supportWebhook accepts VooSquare (200) and refuses others (401)', h1.res.statusCode === 200 && h2.res.statusCode === 401 && hookCalls.length === 1 && hookCalls[0].ticket_id === 9);
    const slow = kit.summaryHandler(() => sleep(300).then(() => ({ metrics: [] })), { timeoutMs: 50 });
    const sh = fakeReqRes('/s?voo_id=vs_1', { headers: { authorization: `Bearer ${CRED.apiKey}` } });
    await slow(sh.req, sh.res);
    check('kit: summaryHandler answers in time even when the tool is slow (504, VooSquare shows no card)', sh.res.statusCode === 504);

    console.log('Voo Connect: browser snippet, ESM entry, types');
    const code2 = fs.readFileSync(path.join(SDK, 'voo-connect-browser.js'), 'utf8');
    const browserRun = (search, { cookie = '', session = {}, attrs = {} } = {}) => {
      let jar = cookie; const writes = [];
      const anchors = ['/auth/voosquare?signup=1&return_to=/dashboard', 'https://other.example/pricing', '/auth/voosquare?ref=keepme#top', `${VS}/oauth/authorize?client_id=x`].map((href) => ({ href, tagName: 'A', getAttribute: function () { return this.href; }, setAttribute: function (_k, v) { this.href = v; } }));
      const store = { ...session };
      const win = { location: { search, protocol: 'https:' }, sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } } };
      const doc = { readyState: 'complete', currentScript: { getAttribute: (k) => (k in attrs ? attrs[k] : null) }, addEventListener() {},
        get cookie() { return jar; }, set cookie(v) { writes.push(v); jar = v.split(';')[0]; },
        querySelectorAll: () => anchors.filter((a) => a.href.includes('/auth/voosquare') || a.href.includes('/oauth/authorize')) };
      vm.runInNewContext(code2, { window: win, document: doc });
      return { api: win.VooConnect, anchors, writes, store, jar };
    };
    const b1 = browserRun(`?ref=${affRow.code}&vclick=AbCdEf12&utm_source=fb`, { attrs: { 'data-domain': '.demotool.example' } });
    check('browser: keeps ref and vclick in sessionStorage and a 60-day cookie (Domain, Secure on https, SameSite=Lax)', b1.api.params().ref === affRow.code && b1.api.params().vclick === 'AbCdEf12' && /voo_attr=/.test(b1.writes[0]) && /Max-Age=5184000/.test(b1.writes[0]) && /Domain=\.demotool\.example/.test(b1.writes[0]) && /Secure/.test(b1.writes[0]) && /SameSite=Lax/.test(b1.writes[0]) && !!b1.store.voo_attr, b1.writes);
    check('browser: decorates Start free and authorize links, never other sites, never overwrites a ref already there, keeps #hash', b1.anchors[0].href === `/auth/voosquare?signup=1&return_to=/dashboard&ref=${affRow.code}&vclick=AbCdEf12` && b1.anchors[1].href === 'https://other.example/pricing'
      && b1.anchors[2].href === '/auth/voosquare?ref=keepme&vclick=AbCdEf12#top' && b1.anchors[3].href.endsWith(`client_id=x&ref=${affRow.code}&vclick=AbCdEf12`), b1.anchors.map((a) => a.href));
    const b2 = browserRun('?page=2', { cookie: b1.jar });
    check('browser: on a later page (no params) the cookie still decorates the links (shared with the server middleware)', b2.api.params().vclick === 'AbCdEf12' && b2.anchors[0].href.includes('vclick=AbCdEf12') && b2.writes.length === 0 && K.decodeAttribution(decodeURIComponent(b1.jar.slice(9))).vclick === 'AbCdEf12');
    const b3 = browserRun('?coupon=SAVE10', { cookie: b1.jar });
    const b4 = browserRun('?ref=otherref&vclick=NewClick99', { cookie: b1.jar });
    check('browser: coupon-only adds the coupon to the kept click; a new click replaces the old one', b3.api.params().coupon === 'SAVE10' && b3.api.params().vclick === 'AbCdEf12' && b4.api.params().ref === 'otherref' && b4.api.params().vclick === 'NewClick99' && !b4.api.params().coupon);
    const b6 = browserRun(`?ref=${affRow.code.toUpperCase()}`, { cookie: b1.jar });
    const b7 = browserRun('?ref=otherref', { cookie: b1.jar });
    check('browser: ?ref= alone of the same affiliate keeps the vclick; ?ref= of another affiliate replaces the click', b6.api.params().vclick === 'AbCdEf12' && b6.api.params().ref === affRow.code && b7.api.params().ref === 'otherref' && !b7.api.params().vclick, [b6.api.params(), b7.api.params()]);
    const b5 = browserRun(`?ref=${affRow.code}&vclick=AbCdEf12`, { attrs: { 'data-off': '' } });
    check('browser: data-off (Affleego) stores and decorates nothing', b5.writes.length === 0 && b5.anchors[0].href === '/auth/voosquare?signup=1&return_to=/dashboard');
    const esm = await import(require('node:url').pathToFileURL(path.join(SDK, 'index.mjs')).href);
    check('kit: ESM entry exports the same API as CommonJS', esm.createVooConnect === K.createVooConnect && esm.default === K && typeof esm.verifyGatevooSignature === 'function');
    const dts = fs.readFileSync(path.join(SDK, 'index.d.ts'), 'utf8');
    const pkg = JSON.parse(fs.readFileSync(path.join(SDK, 'package.json'), 'utf8'));
    check('kit: TypeScript types and package exports (import, require, types, browser)', /createVooConnect\(options\?: VooConnectOptions\): VooConnect/.test(dts) && pkg.exports['.'].import === './index.mjs' && pkg.exports['.'].require === './index.js' && pkg.exports['.'].types === './index.d.ts' && pkg.engines.node === '>=18' && !pkg.dependencies);
    const sdkSrc = ['index.js', 'check.js', 'voo-connect-browser.js', 'example-tool/server.js'].map((f) => fs.readFileSync(path.join(SDK, f), 'utf8')).join('\n');
    check('kit: zero dependencies (only node: built-ins and its own files)', !/require\(['"](?!node:|\.\.?[/'"])/.test(sdkSrc) && !/from ['"](?!node:|\.)/.test(sdkSrc));
  } catch (e) {
    check('voo-connect: conformance run finished without crashing', false, { error: String(e && e.stack || e).slice(0, 800), vs: vsLog.slice(-600), tool: toolLog.slice(-600) });
  } finally {
    if (flaky) flaky.close();
    for (const p of procs.reverse()) { try { p.kill('SIGTERM'); } catch { /* gone */ } }
    await Promise.all(procs.map((p) => (p.exitCode !== null ? null : new Promise((r) => { const t = setTimeout(r, 3000); p.once('exit', () => { clearTimeout(t); r(); }); }))));
    try { if (sql) sql.close(); } catch { /* ignore */ }
    fs.rmSync(RUN, { recursive: true, force: true });
    if (process.env.VOO_CONNECT_LOG) console.log(vsLog.slice(-3000), toolLog.slice(-3000));
  }
};

if (require.main === module) {
  let passed = 0; let failed = 0;
  const check = (name, ok, extra) => { if (ok) { passed++; process.stdout.write(`  ✓ ${name}\n`); } else { failed++; console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 900) : ''); } };
  module.exports({ check }).then(() => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); }, (e) => { console.error(e); process.exit(1); });
}
