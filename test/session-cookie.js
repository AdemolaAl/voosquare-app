'use strict';
/*
 * The sign-in cookie name. Over https it is `__Host-vs_sess` (Secure, Path=/, no Domain, HttpOnly, SameSite=Lax), so a
 * sister tool on another *.voosquare.com subdomain can never plant one VooSquare would read; a plain `vs_sess` is never
 * trusted there and is cleared when seen. Over http (dev, tests) the name stays `vs_sess`. Also: the 1-hour coupon
 * cookie is cleared at sign-up in both forms (host-only and root domain).
 * Runs its own server with BASE_URL=https://voosquare.test (requests go to it over plain http with a Host header).
 *   Standalone: node test/session-cookie.js        From npm test: called by test/smoke.js with { BASE, check }.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const free = (port) => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(port, '127.0.0.1', () => s.close(() => res(true))); });
const attrs = (c) => c.split(';').slice(1).map((s) => s.trim().toLowerCase());

module.exports = async function sessionCookie({ BASE, check }) {
  let PORT = 0;
  for (let p = 4771; p <= 4779 && !PORT; p++) if (await free(p)) PORT = p;
  if (!PORT) PORT = 4779;
  const ROOT = 'voosquare.test'; const MAIN = ROOT; const AFFH = `affiliate.${ROOT}`;
  const DIR = path.join(os.tmpdir(), `voosquare-cookie-${process.pid}`);
  const DB = path.join(DIR, 'cookie.db');
  fs.rmSync(DIR, { recursive: true, force: true }); fs.mkdirSync(DIR, { recursive: true });
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), BASE_URL: `https://${MAIN}`, DATABASE_PATH: DB, UPLOADS_DIR: path.join(DIR, 'uploads'), BACKUPS_DIR: path.join(DIR, 'backups'), OWNER_EMAIL: 'owner@cookie.test', NODE_ENV: 'test', EMAIL_PROVIDER: '', AFF_JOBS: 'off', AFFILIATE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) break; } catch { /* wait */ } await sleep(100); }

  let ipn = 0;
  /** Requests to the https-configured server over plain http, with the given Host and Cookie header. */
  function req(method, host, p, { cookie = '', body } = {}) {
    const headers = { host, 'x-vs': '1', 'x-forwarded-for': `10.77.0.${++ipn % 250 + 1}`, 'x-forwarded-proto': 'https' };
    if (cookie) headers.cookie = cookie;
    let payload; if (body !== undefined) { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(payload); }
    return new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers }, (res) => {
        let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => { let data; try { data = JSON.parse(t); } catch { data = t; } resolve({ status: res.statusCode, data, cookies: [].concat(res.headers['set-cookie'] || []) }); });
      });
      r.on('error', reject); if (payload) r.write(payload); r.end();
    });
  }
  const find = (cookies, name, pred = () => true) => cookies.find((c) => c.startsWith(name + '=') && pred(c));
  const tokenOf = (c) => decodeURIComponent((c || '').split(';')[0].split('=').slice(1).join('='));
  async function signin(host, email, { cookie = '' } = {}) {
    const s = await req('POST', host, '/api/auth/start', { body: { email, name: 'Cookie Tester' }, cookie });
    return req('POST', host, '/api/auth/verify', { body: { email, code: s.data.dev_code }, cookie });
  }

  try {
    console.log('Session cookie');
    /* Production (https): name and attributes. */
    const v = await signin(MAIN, 'member@cookie.test');
    const sc = find(v.cookies, '__Host-vs_sess');
    const a = sc ? attrs(sc) : [];
    check('cookie: over https the session cookie is __Host-vs_sess', v.status === 200 && !!sc && !find(v.cookies, 'vs_sess'), v.cookies);
    check('cookie: __Host-vs_sess is Secure, Path=/, HttpOnly, SameSite=Lax and has no Domain',
      a.includes('secure') && a.includes('path=/') && a.includes('httponly') && a.includes('samesite=lax') && !a.some((x) => x.startsWith('domain=')), sc);
    const token = tokenOf(sc);
    const me = await req('GET', MAIN, '/api/me', { cookie: `__Host-vs_sess=${encodeURIComponent(token)}` });
    check('cookie: __Host-vs_sess signs the member in', me.data.user && me.data.user.email === 'member@cookie.test', me.data);

    /* A plain vs_sess (what a sibling subdomain could plant), even with a valid token, is ignored and cleared. */
    const planted = await req('GET', MAIN, '/api/me', { cookie: `vs_sess=${encodeURIComponent(token)}` });
    check('cookie: over https a planted vs_sess with a valid token does not sign in', planted.status === 200 && planted.data.user === null, planted.data);
    const clrHost = find(planted.cookies, 'vs_sess', (c) => /max-age=0/i.test(c) && !/domain=/i.test(c));
    const clrRoot = find(planted.cookies, 'vs_sess', (c) => /max-age=0/i.test(c) && new RegExp(`domain=\\.${ROOT.replace('.', '\\.')}`, 'i').test(c));
    check('cookie: the planted vs_sess is cleared host-only and on the root domain', !!clrHost && !!clrRoot, planted.cookies);
    const mixed = await req('GET', MAIN, '/api/me', { cookie: `vs_sess=${encodeURIComponent(token)}; __Host-vs_sess=nope` });
    check('cookie: a planted vs_sess never stands in for a bad __Host-vs_sess', mixed.data.user === null, mixed.data);
    const both = await req('GET', MAIN, '/api/me', { cookie: `vs_sess=junk; __Host-vs_sess=${encodeURIComponent(token)}` });
    check('cookie: the real __Host-vs_sess still works beside a planted vs_sess (which is cleared)', both.data.user && both.data.user.email === 'member@cookie.test' && !!find(both.cookies, 'vs_sess', (c) => /max-age=0/i.test(c)), both);
    // A planted vs_sess cannot be logged out either: logout reads only __Host-vs_sess.
    const lo0 = await req('POST', MAIN, '/api/auth/logout', { cookie: `vs_sess=${encodeURIComponent(token)}` });
    const still = await req('GET', MAIN, '/api/me', { cookie: `__Host-vs_sess=${encodeURIComponent(token)}` });
    check('cookie: logout with only a planted vs_sess does not end the real session', lo0.status === 200 && still.data.user && still.data.user.email === 'member@cookie.test', still.data);
    const lo = await req('POST', MAIN, '/api/auth/logout', { cookie: `__Host-vs_sess=${encodeURIComponent(token)}` });
    const loC = find(lo.cookies, '__Host-vs_sess');
    const after = await req('GET', MAIN, '/api/me', { cookie: `__Host-vs_sess=${encodeURIComponent(token)}` });
    check('cookie: logout clears __Host-vs_sess (Secure, Path=/, no Domain) and ends the session',
      !!loC && /max-age=0/i.test(loC) && attrs(loC).includes('secure') && attrs(loC).includes('path=/') && !/domain=/i.test(loC) && after.data.user === null, [loC, after.data]);

    /* The affiliate host signs in on its own host-only __Host- cookie. */
    const av = await signin(AFFH, 'aff@cookie.test');
    const ac = find(av.cookies, '__Host-vs_sess');
    check('cookie: on affiliate.* the session is a host-only __Host-vs_sess', av.status === 200 && !!ac && !/domain=/i.test(ac) && attrs(ac).includes('secure'), av.cookies);
    const ame = await req('GET', AFFH, '/api/me', { cookie: `__Host-vs_sess=${encodeURIComponent(tokenOf(ac))}` });
    check('cookie: the affiliate.* session works with the new name', ame.data.user && ame.data.user.email === 'aff@cookie.test', ame.data);
    const aplant = await req('GET', AFFH, '/api/me', { cookie: `vs_sess=${encodeURIComponent(tokenOf(ac))}` });
    check('cookie: on affiliate.* a plain vs_sess is ignored too', aplant.data.user === null, aplant.data);

    /* The 1-hour coupon cookie is cleared at sign-up, host-only and on the root domain; a returning member keeps it. */
    const cv = await signin(MAIN, 'coupon@cookie.test', { cookie: 'vs_coupon=SAVE10' });
    const cHost = find(cv.cookies, 'vs_coupon', (c) => /max-age=0/i.test(c) && !/domain=/i.test(c));
    const cRoot = find(cv.cookies, 'vs_coupon', (c) => /max-age=0/i.test(c) && /domain=\.voosquare\.test/i.test(c));
    check('cookie: sign-up clears the coupon cookie host-only and on the root domain', cv.status === 200 && cv.data.isNew && !!cHost && !!cRoot, cv.cookies);
    const cv2 = await signin(MAIN, 'coupon@cookie.test', { cookie: 'vs_coupon=SAVE10' });
    check('cookie: a returning member signing in keeps the coupon cookie for checkout', cv2.status === 200 && !cv2.data.isNew && !find(cv2.cookies, 'vs_coupon'), cv2.cookies);

    /* Dev / test over http: unchanged (vs_sess, no Secure, still host-only). */
    if (BASE) {
      const email = 'devcookie@test.dev';
      const s = await (await fetch(BASE + '/api/auth/start', { method: 'POST', headers: { 'x-vs': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email }) })).json();
      const r = await fetch(BASE + '/api/auth/verify', { method: 'POST', headers: { 'x-vs': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email, code: s.dev_code }) });
      const dc = find(r.headers.getSetCookie(), 'vs_sess');
      const da = dc ? attrs(dc) : [];
      check('cookie: over http the session cookie is still vs_sess (no Secure, no Domain, HttpOnly, Path=/)', !!dc && !find(r.headers.getSetCookie(), '__Host-vs_sess') && !da.includes('secure') && !da.some((x) => x.startsWith('domain=')) && da.includes('httponly') && da.includes('path=/'), r.headers.getSetCookie());
      const dme = await (await fetch(BASE + '/api/me', { headers: { cookie: dc.split(';')[0] } })).json();
      check('cookie: over http vs_sess signs in and is not cleared', dme.user && dme.user.email === email, dme);
    }
  } catch (e) {
    check('session cookie tests ran without crashing', false, e.stack);
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => { srv.once('exit', r); setTimeout(r, 2000); });
    fs.rmSync(DIR, { recursive: true, force: true });
    if (/Error/.test(log) && process.env.VS_DEBUG) console.log(log.slice(-3000));
  }
};

if (require.main === module) {
  let passed = 0; let failed = 0;
  const check = (name, ok, extra) => { if (ok) { passed++; console.log('  ok  ' + name); } else { failed++; console.log('  FAIL ' + name, extra === undefined ? '' : JSON.stringify(extra).slice(0, 600)); } };
  module.exports({ BASE: '', check }).then(() => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); });
}
