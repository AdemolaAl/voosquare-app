'use strict';
/* Platform QA regressions (2026-10-05): the sister-tool surface and money paths found in the all-round test.
 *  - Events API never drops events silently (over 100 in one call, or no type): they come back in `rejected`.
 *  - "Continue with VooSquare": a wildcard redirect URI (https://tool.com*) never matches another host.
 *  - Tool summary URLs go through the SSRF guard (no redirects followed, no credentials in the address).
 *  - A refunded or charged-back order is never granted again by a replayed webhook, Approve or Reject.
 *  - /pricing serves the website; unknown /api/* paths answer JSON { error } (API_VERSIONING rule 5).
 * Called from test/smoke.js with its helpers. Uses its own product, payment method and mock servers. */
const http = require('node:http');
const crypto = require('node:crypto');

module.exports = async function platformQa({ BASE, Client, check, owner }) {
  console.log('Platform QA: sister tools, money paths, routing');
  const hits = [];
  const inv = {};
  const mock = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      hits.push(req.url);
      if (req.url.startsWith('/sum/redirect')) { res.writeHead(302, { location: '/sum/target' }); return res.end(); }
      if (req.url.startsWith('/sum/ok')) return send(200, { linked: true, status: 'active', metrics: [{ key: 'joins', label: 'Real joins', value: 7, unit: 'count' }], open_url: 'https://tool.test/dashboard' });
      if (req.headers.authorization !== 'Bearer gk_qa') return send(401, { error: 'bad key' });
      if (req.method === 'POST' && req.url === '/api/v1/invoices') {
        const b = JSON.parse(raw); const id = 'inv_qa' + (Object.keys(inv).length + 1);
        inv[id] = { id, order_id: b.order_id, status: 'pending', paid_amount: 0 };
        return send(200, { id, checkout_url: 'https://pay.gatevoo.test/' + id, status: 'pending' });
      }
      const m = /^\/api\/v1\/invoices\/([\w-]+)$/.exec(req.url);
      if (m && inv[m[1]]) return send(200, inv[m[1]]);
      return send(404, { error: 'not found' });
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  const mbase = `http://127.0.0.1:${mock.address().port}`;
  try {
    const member = new Client();
    const v = await member.login('platform-qa@test.dev', 'Platform QA');
    const vooId = v.data.user.voo_id;
    const tool = (await owner.post('/api/admin/products', { name: 'QA Tool', slug: 'qa-tool', url: 'https://qatool.test', sso: 1, redirect_uris: ['https://qatool.test*'] })).data.product;
    const key = { authorization: 'Bearer ' + tool.api_key };

    // Events: nothing is dropped without a word.
    const many = Array.from({ length: 130 }, (_, i) => ({ event_id: 'qa_bulk_' + i, voo_id: vooId, type: 'join' }));
    const ev = await new Client().post('/api/v1/events', { events: many }, key);
    check('events: over 100 in one call are listed in `rejected` (stored 100, rejected 30), not dropped silently',
      ev.status === 200 && ev.data.stored === 100 && Array.isArray(ev.data.rejected) && ev.data.rejected.length === 30 && ev.data.rejected[0].event_id === 'qa_bulk_100', ev.data);
    const again = await new Client().post('/api/v1/events', { events: many.slice(100) }, key);
    check('events: the rejected ones are accepted when sent again', again.data.stored === 30 && !again.data.rejected, again.data);
    const nt = await new Client().post('/api/v1/events', { events: [{ event_id: 'qa_notype', voo_id: vooId }, { event_id: 'qa_ok', voo_id: vooId, type: 'join' }] }, key);
    check('events: an event with no type is reported in `rejected`', nt.data.stored === 1 && nt.data.rejected && nt.data.rejected.length === 1 && nt.data.rejected[0].event_id === 'qa_notype', nt.data);
    const empty = await new Client().post('/api/v1/events', { events: [] }, key);
    check('events: an empty batch still answers { ok, stored: 0 } with no rejected key', empty.data.ok === true && empty.data.stored === 0 && !('rejected' in empty.data), empty.data);

    // OAuth: a wildcard redirect URI is a prefix on the same host only.
    const auth = (uri) => member.get(`/oauth/authorize?client_id=${tool.client_id}&redirect_uri=${encodeURIComponent(uri)}&state=s`);
    const evil = await auth('https://qatool.test.evil.example/cb');
    check('oauth: wildcard redirect https://tool* cannot send the code to another host', evil.status === 400, { status: evil.status, location: evil.headers.get('location') });
    const good = await auth('https://qatool.test/auth/voosquare/callback');
    check('oauth: wildcard redirect still matches its own host', good.status === 302 && good.headers.get('location').startsWith('https://qatool.test/auth/voosquare/callback?code='), good.headers.get('location'));

    // Summary URL: through the SSRF guard.
    check('summary URL with a username/password is refused on save', (await owner.post('/api/admin/products', { ...tool, id: tool.id, summary_url: 'https://user:pw@qatool.test/s' })).status === 400);
    await owner.post('/api/admin/products', { ...tool, id: tool.id, summary_url: mbase + '/sum/ok' });
    const home = await member.get('/api/me/home');
    const t1 = home.data.tools.find((x) => x.slug === 'qa-tool');
    check('summary URL: tool numbers reach the member dashboard', t1 && t1.summary && t1.summary.metrics[0].value === 7, t1 && t1.summary);
    const other = new Client(); await other.login('platform-qa2@test.dev');
    await owner.post('/api/admin/products', { ...tool, id: tool.id, summary_url: mbase + '/sum/redirect' });
    hits.length = 0;
    await other.get('/api/me/home');
    check('summary URL: redirects are not followed (SSRF guard)', hits.some((h) => h.startsWith('/sum/redirect')) && !hits.includes('/sum/target'), hits);
    await owner.post('/api/admin/products', { ...tool, id: tool.id, summary_url: '' });

    // Refunded orders stay refunded.
    const gm = (await owner.post('/api/admin/payment-methods', { type: 'gatevoo', name: 'Gatevoo QA', enabled: true, config: { api_base: mbase, api_key: 'gk_qa', webhook_secret: 'whsec_qa', assets: ['USDT_TRC20'] } })).data.method;
    const buyer = new Client(); await buyer.login('platform-qa-buyer@test.dev');
    const co = await buyer.post('/api/billing/checkout', { item: 'premium', method_id: gm.id });
    const ref = co.data.order.ref; const invId = Object.keys(inv).find((k) => inv[k].order_id === ref);
    inv[invId].status = 'paid'; inv[invId].paid_amount = co.data.order.amount_usd;
    const hook = () => { const raw = JSON.stringify({ type: 'invoice.paid', invoice: { id: invId, order_id: ref, status: 'paid', paid_amount: inv[invId].paid_amount } }); return fetch(`${BASE}/api/billing/webhook/${gm.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gatevoo-signature': crypto.createHmac('sha256', 'whsec_qa').update(raw).digest('hex') }, body: raw }).then((r) => r.json()); };
    const paid = await hook();
    const order = (await owner.get('/api/admin/orders?status=paid')).data.orders.find((o) => o.ref === ref);
    check('refund setup: Gatevoo order paid', paid.paid === true && !!order, paid);
    const until1 = (await buyer.get('/api/me')).data.user.premium_until;
    const rf = await owner.post(`/api/admin/aff/orders/${order.id}/refund`, { kind: 'refund', reason: 'QA' });
    check('refund setup: order refunded by the team', rf.status === 200 && rf.data.order.status === 'refunded', rf.data);
    const replay = await hook();
    const st1 = (await buyer.get('/api/me/orders')).data.orders.find((o) => o.ref === ref);
    check('a replayed Gatevoo webhook does not turn a refunded order back into paid', replay.ok === true && replay.paid !== true && st1.status === 'refunded' && (await buyer.get('/api/me')).data.user.premium_until === until1, { replay, status: st1.status });
    const ap = await owner.post(`/api/admin/orders/${order.id}/approve`);
    check('Approve on a refunded order answers 409', ap.status === 409, ap.data);
    await owner.post(`/api/admin/orders/${order.id}/reject`, { reason: 'x' });
    check('Reject does not overwrite a refunded order', (await buyer.get('/api/me/orders')).data.orders.find((o) => o.ref === ref).status === 'refunded');
    await owner.post('/api/admin/payment-methods', { ...gm, id: gm.id, type: 'gatevoo', enabled: false, config: {} });

    // Affiliate cookie domain: never a public suffix (browsers drop the cookie, and the root also approves deep-link hosts).
    {
      const { spawnSync } = require('node:child_process');
      const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-cookiedom-'));
      const out = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', `
        const hosts = ['https://voosquare.com', 'https://affiliate.voosquare.com', 'https://voosquare-production.up.railway.app', 'https://voosquare.vercel.app', 'https://voosquare.onrender.com', 'https://voosquare.com.ng', 'https://www.voosquare.co.uk', 'http://localhost:3000'];
        const res = {};
        for (const h of hosts) { process.env.BASE_URL = h; for (const k of Object.keys(require.cache)) if (k.includes('/src/')) delete require.cache[k]; res[h] = require('./src/aff/tracking').cookieDomain(); }
        console.log(JSON.stringify(res));`], { cwd: path.join(__dirname, '..'), env: { ...process.env, DATABASE_PATH: path.join(dir, 'c.db'), BACKUPS_DIR: path.join(dir, 'bk'), NODE_ENV: 'test' }, encoding: 'utf8' });
      fs.rmSync(dir, { recursive: true, force: true });
      let d = {}; try { d = JSON.parse(out.stdout.trim().split('\n').pop()); } catch { d = { err: out.stderr.slice(-300) }; }
      check('affiliate cookie domain: parent domain on a custom domain, full host on shared platforms and country second levels, none on localhost',
        d['https://voosquare.com'] === 'voosquare.com' && d['https://affiliate.voosquare.com'] === 'voosquare.com' && d['https://voosquare-production.up.railway.app'] === 'voosquare-production.up.railway.app'
        && d['https://voosquare.vercel.app'] === 'voosquare.vercel.app' && d['https://voosquare.onrender.com'] === 'voosquare.onrender.com' && d['https://voosquare.com.ng'] === 'voosquare.com.ng'
        && d['https://www.voosquare.co.uk'] === 'voosquare.co.uk' && d['http://localhost:3000'] === '', d);
    }

    // Routing.
    const pr = await fetch(BASE + '/pricing');
    check('/pricing serves the website (the site links scroll to Pricing)', pr.status === 200 && /text\/html/.test(pr.headers.get('content-type')));
    const nf = await fetch(BASE + '/api/v1/not-a-route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const nfb = await nf.json().catch(() => null);
    check('unknown /api/* paths answer JSON 404 { error } (GET and POST)', nf.status === 404 && nfb && typeof nfb.error === 'string' && (await fetch(BASE + '/api/nope')).headers.get('content-type').includes('application/json'), { status: nf.status, nfb });
  } finally {
    mock.close();
  }
};
