'use strict';
/*
 * "Demo tool": a small sister tool that uses Voo Connect end to end. Copy the parts you need into your tool.
 * Plain node:http, no dependencies. Every route that talks to VooSquare is marked with  ← Voo Connect.
 *
 *   VOO_BASE=https://voosquare.com VOO_CLIENT_ID=vsc_... VOO_CLIENT_SECRET=vss_... VOO_API_KEY=vsk_... \
 *   PUBLIC_URL=http://localhost:3001 PORT=3001 node sdk/voo-connect/example-tool/server.js
 *
 * In VooSquare (Admin → Products → Add product "Demo tool"): URL = PUBLIC_URL, SSO on, Redirect URIs =
 *   PUBLIC_URL/auth/voosquare/callback   and   PUBLIC_URL/   (the second one is where logout comes back),
 * Summary URL = PUBLIC_URL/api/voosquare/summary, Support webhook = PUBLIC_URL/hooks/voosquare/support.
 *
 * What it shows:
 *   /                          landing page: keeps ?ref=&vclick=&coupon= (middleware + browser snippet), "Start free"
 *   /auth/voosquare            starts "Continue with VooSquare" (?signup=1 for Start free, ?return_to=/dashboard)
 *   /auth/voosquare/callback   finishes login, creates the local user by voo_id, starts the session
 *   /dashboard                 plan, wallet, buttons that send the money events
 *   POST /billing/subscribe    plan payment → plan_started or plan_renewed + spend
 *   POST /billing/topup        wallet top-up → wallet_topup (not commissionable)
 *   POST /billing/use          use credits (added up per customer per day)
 *   POST /billing/close-day    sends one spend per customer per day for the credits used (run it from a daily job)
 *   POST /admin/refund         refund a payment → refund (never reverses commission)
 *   POST /admin/chargeback     a card dispute → chargeback (reverses commission)
 *   POST /support              forwards a message to the one VooSquare inbox
 *   GET  /api/voosquare/summary       VooSquare calls this for the member's dashboard card
 *   POST /hooks/voosquare/support     VooSquare posts staff replies here
 *   GET  /logout               clears the session, then logs out of VooSquare and comes back
 *
 * Admin routes need the header x-demo-admin: DEMO_ADMIN_TOKEN (printed at start when not set).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createVooConnect, VooError, parseCookies, cookieString, appendCookie, readBody } = require('..');

const PORT = Number(process.env.PORT) || 3001;
const PUBLIC_URL = String(process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const DATA_DIR = process.env.DEMO_DATA_DIR || '';
const ADMIN_TOKEN = process.env.DEMO_ADMIN_TOKEN || crypto.randomBytes(12).toString('hex');
const TOOL = process.env.DEMO_TOOL_NAME || 'Demo tool';

/* ---------------------------------------------------------------- Voo Connect, set up once ← Voo Connect */
const voo = createVooConnect({
  base: process.env.VOO_BASE, // public VooSquare address
  serverBase: process.env.VOO_SERVER_BASE, // optional private address for server-to-server calls
  clientId: process.env.VOO_CLIENT_ID,
  clientSecret: process.env.VOO_CLIENT_SECRET,
  apiKey: process.env.VOO_API_KEY,
  redirectUri: `${PUBLIC_URL}/auth/voosquare/callback`,
  eventPrefix: process.env.DEMO_EVENT_PREFIX || 'demo', // event ids look like demo_pay_1
  affiliate: process.env.DEMO_AFFILIATE !== 'off', // Affleego: off
  outboxFile: DATA_DIR ? path.join(DATA_DIR, 'voo-outbox.json') : undefined, // events survive restarts
  backoffMs: Number(process.env.VOO_BACKOFF_MS) || 1000,
  toolName: TOOL,
  onRejected: (ev, error) => console.warn(`[demo] VooSquare refused ${ev.event_id}: ${error}`),
  onError: (err) => console.warn(`[demo] events: ${err.message}`),
});
voo.events.start(Number(process.env.VOO_FLUSH_MS) || 5000); // background sender

/* ---------------------------------------------------------------- the tool's own data (a JSON file for the demo) */
const STATE_FILE = DATA_DIR ? path.join(DATA_DIR, 'demo-state.json') : '';
const db = (() => {
  try { if (STATE_FILE) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* first start */ }
  return { users: {}, sessions: {}, payments: [], usage: {}, replies: [], seq: 0 };
})();
const save = () => { if (STATE_FILE) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(db, null, 1)); } };
const PLANS = { Starter: 30, Pro: 99 };

/* ---------------------------------------------------------------- tiny helpers */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const secure = PUBLIC_URL.startsWith('https://');
function send(res, status, body, type = 'text/html; charset=utf-8') { res.statusCode = status; res.setHeader('Content-Type', type); res.setHeader('Cache-Control', 'no-store'); res.end(body); }
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
const go = (res, to) => { res.statusCode = 302; res.setHeader('Location', to); res.end(); };
function sessionOf(req) { const sid = parseCookies(req.headers.cookie).demo_sess; return sid && db.sessions[sid] ? { sid, ...db.sessions[sid], user: db.users[db.sessions[sid].voo_id] } : null; }
async function form(req) {
  const raw = await readBody(req);
  if (String(req.headers['content-type'] || '').includes('application/json')) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}
const isAdmin = (req) => { const t = String(req.headers['x-demo-admin'] || ''); return t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN)); };
const today = () => new Date().toISOString().slice(0, 10);

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(TOOL)}</title>
<style>
:root{--bg:#0B1220;--card:#121B2E;--line:#22304D;--txt:#E8EEF9;--mute:#93A3C0;--acc:#00A86B}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--txt)}
main{max-width:720px;margin:0 auto;padding:40px 16px}h1{font-size:34px;letter-spacing:-.02em;margin:0 0 8px}p{color:var(--mute)}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:20px;margin:16px 0}
.btn{display:inline-block;background:var(--acc);color:#fff;border:0;border-radius:999px;padding:12px 20px;font-weight:700;text-decoration:none;cursor:pointer;font-size:15px}
.btn.ghost{background:transparent;border:1px solid var(--line);color:var(--txt)}form{display:inline}input{background:#0B1220;color:var(--txt);border:1px solid var(--line);border-radius:10px;padding:10px;width:100%;margin:6px 0}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}footer{margin-top:40px;font-size:13px;color:var(--mute)}footer a{color:var(--mute)}
</style></head><body><main>${body}<footer>Part of <a href="${esc(voo.base)}/app">VooSquare</a></footer></main>
<script src="/voo-connect-browser.js" defer></script></body></html>`;
}

/* ---------------------------------------------------------------- money: every payment is its own event ← Voo Connect */
function recordPayment(user, { kind, plan, usd, label }) {
  const pay = { id: ++db.seq, voo_id: user.voo_id, kind, plan: plan || '', usd, at: new Date().toISOString(), status: 'paid' };
  db.payments.push(pay);
  const eventId = voo.events.id('pay', pay.id); // stable: payment 7 is always demo_pay_7, so retries never count twice
  pay.event_id = eventId;
  if (kind === 'wallet_topup') {
    voo.events.walletTopup({ eventId, vooId: user.voo_id, valueUsd: usd, label: label || `Credit pack $${usd}`, occurredAt: pay.at });
    user.wallet = Math.round(((user.wallet || 0) + usd) * 100) / 100;
  } else {
    if (kind === 'plan') {
      const first = !user.plan;
      // Plan sync (not commissionable): plan name and price for the affiliate Offers page.
      (first ? voo.events.planStarted : voo.events.planRenewed).call(voo.events, { eventId: voo.events.id(first ? 'plan' : 'renew', pay.id), vooId: user.voo_id, plan, valueUsd: usd, label: `${TOOL} ${plan}`, occurredAt: pay.at });
      user.plan = plan;
    }
    // The money itself (commissionable).
    voo.events.spend({ eventId, vooId: user.voo_id, plan, valueUsd: usd, label: label || `${TOOL} ${plan}, monthly`, country: user.country || undefined, occurredAt: pay.at,
      signals: { payment_fingerprint: voo.hashSignal(`demo-card-${user.voo_id}`) } });
  }
  save();
  return pay;
}

/* ---------------------------------------------------------------- routes */
const capture = voo.captureAttribution(); // ← Voo Connect: keep ref / vclick / coupon from landing URLs
const summary = voo.summaryHandler((vooId, period) => { // ← Voo Connect: VooSquare's dashboard card
  const u = db.users[vooId];
  if (!u) return null; // → {"linked": false}
  const paid = db.payments.filter((p) => p.voo_id === vooId && p.kind !== 'wallet_topup' && p.status === 'paid');
  return { status: u.plan ? 'active' : 'trial', metrics: [
    { key: 'payments', label: 'Payments', value: paid.length, unit: 'count' },
    { key: 'wallet_usd', label: 'Wallet', value: u.wallet || 0, unit: 'usd' },
  ], open_url: `${PUBLIC_URL}/dashboard`, period };
});
const supportHook = voo.supportWebhook((reply) => { db.replies.push(reply); save(); }); // ← Voo Connect: staff replies

async function route(req, res) {
  const url = new URL(req.url, PUBLIC_URL);
  const p = url.pathname;
  const s = sessionOf(req);

  if (req.method === 'GET' && p === '/voo-connect-browser.js') {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return send(res, 200, fs.readFileSync(path.join(__dirname, '..', 'voo-connect-browser.js')), 'application/javascript; charset=utf-8');
  }
  if (req.method === 'GET' && p === '/') {
    capture(req, res);
    return send(res, 200, layout('Welcome', `<h1>${esc(TOOL)}</h1><p>The demo sister tool. One VooSquare account for every Zedapex tool.</p>
      <div class="card row">${s ? `<a class="btn" href="/dashboard">Open dashboard</a>` : `<a class="btn" data-voo-start href="/auth/voosquare?signup=1&amp;return_to=/dashboard">Start free</a>
      <a class="btn ghost" href="/auth/voosquare?return_to=/dashboard">Log in</a>`}</div>`));
  }
  if (req.method === 'GET' && p === '/auth/voosquare') return voo.startLogin(req, res); // ← Voo Connect
  if (req.method === 'GET' && p === '/auth/voosquare/callback') { // ← Voo Connect
    let r;
    try { r = await voo.handleCallback(req, res); } catch (e) {
      const restart = e instanceof VooError && /^state_|access_denied/.test(e.code);
      return send(res, 400, layout('Login', `<h1>Login did not finish</h1><p>${esc(e.message)}</p><a class="btn" href="/auth/voosquare?return_to=/dashboard">${restart ? 'Try again' : 'Back'}</a>`));
    }
    // Find or create the local user by voo_id (never by email). Save country and voo_ref once.
    const u = db.users[r.user.voo_id] || (db.users[r.user.voo_id] = { voo_id: r.user.voo_id, referred_by: r.user.voo_ref || '', created_at: Date.now(), wallet: 0, plan: '' });
    Object.assign(u, { email: r.user.email, name: r.user.name, country: r.user.country });
    const sid = crypto.randomBytes(24).toString('base64url');
    db.sessions[sid] = { voo_id: u.voo_id, csrf: crypto.randomBytes(16).toString('hex'), at: Date.now() };
    save();
    appendCookie(res, cookieString('demo_sess', sid, { maxAge: 30 * 86400, httpOnly: true, secure }));
    return go(res, r.returnTo);
  }
  if (req.method === 'GET' && p === '/logout') {
    if (s) { delete db.sessions[s.sid]; save(); }
    appendCookie(res, cookieString('demo_sess', '', { maxAge: 0, httpOnly: true, secure }));
    return go(res, voo.logoutUrl(`${PUBLIC_URL}/`)); // ← Voo Connect: log out of VooSquare too, come back home
  }
  if (req.method === 'GET' && p === '/api/voosquare/summary') return summary(req, res);
  if (req.method === 'POST' && p === '/hooks/voosquare/support') return supportHook(req, res);

  if (req.method === 'GET' && p === '/dashboard') {
    if (!s || !s.user) return go(res, '/auth/voosquare?return_to=/dashboard');
    const u = s.user; const used = (db.usage[u.voo_id] || {})[today()] || 0;
    const btn = (action, label, fields = '') => `<form method="post" action="${action}"><input type="hidden" name="csrf" value="${s.csrf}">${fields}<button class="btn ghost">${esc(label)}</button></form>`;
    return send(res, 200, layout('Dashboard', `<h1>Hi ${esc(u.name || 'there')}</h1><p>Voo ID <b>${esc(u.voo_id)}</b> · ${esc(u.country || 'country not set')}</p>
      <div class="card"><b>Plan:</b> ${esc(u.plan || 'Free')}<div class="row" style="margin-top:12px">${btn('/billing/subscribe', 'Pay Starter $30', '<input type="hidden" name="plan" value="Starter">')}${btn('/billing/subscribe', 'Pay Pro $99', '<input type="hidden" name="plan" value="Pro">')}</div></div>
      <div class="card"><b>Wallet:</b> $${(u.wallet || 0).toFixed(2)} · used today $${used.toFixed(2)}<div class="row" style="margin-top:12px">${btn('/billing/topup', 'Top up $50', '<input type="hidden" name="usd" value="50">')}${btn('/billing/use', 'Use $5 of credits', '<input type="hidden" name="usd" value="5">')}</div></div>
      <div class="card"><b>Need help?</b><form method="post" action="/support" style="display:block"><input type="hidden" name="csrf" value="${s.csrf}"><input name="body" placeholder="Write to the team"><button class="btn">Send</button></form></div>
      <a class="btn ghost" href="/logout">Log out</a>`));
  }

  /* ---- logged-in POSTs (CSRF token from the session) ---- */
  if (req.method === 'POST' && ['/billing/subscribe', '/billing/topup', '/billing/use', '/support'].includes(p)) {
    if (!s || !s.user) return json(res, 401, { error: 'Log in first.' });
    const b = await form(req);
    if (!b.csrf || b.csrf !== s.csrf) return json(res, 403, { error: 'Bad form token. Reload the page.' });
    const u = s.user;
    if (p === '/billing/subscribe') {
      const plan = PLANS[b.plan] ? b.plan : 'Starter';
      // A real tool calls its payment provider (for example Gatevoo) here and records the payment when it is confirmed.
      return json(res, 200, { payment: recordPayment(u, { kind: 'plan', plan, usd: PLANS[plan] }) });
    }
    if (p === '/billing/topup') {
      const usd = Math.max(1, Math.min(10_000, Number(b.usd) || 0));
      return json(res, 200, { payment: recordPayment(u, { kind: 'wallet_topup', usd }) });
    }
    if (p === '/billing/use') {
      const usd = Math.round(Math.max(0, Math.min(u.wallet || 0, Number(b.usd) || 0)) * 100) / 100;
      if (!usd) return json(res, 400, { error: 'Not enough credits.' });
      u.wallet = Math.round((u.wallet - usd) * 100) / 100;
      const day = (db.usage[u.voo_id] ||= {});
      day[today()] = Math.round(((day[today()] || 0) + usd) * 100) / 100; // added up; sent as one spend per day
      save();
      return json(res, 200, { wallet: u.wallet, used_today: day[today()] });
    }
    if (p === '/support') { // ← Voo Connect: one inbox for every product
      const r = await voo.support.send({ email: u.email, name: u.name, subject: `${TOOL} question`, body: String(b.body || '').slice(0, 4000), externalRef: `demo-${u.voo_id}`, vooId: u.voo_id });
      return json(res, 200, r);
    }
  }

  /* ---- jobs and back office (header x-demo-admin) ---- */
  if (p.startsWith('/admin/') || p === '/billing/close-day') {
    if (!isAdmin(req)) return json(res, 401, { error: 'x-demo-admin header missing or wrong.' });
    const b = req.method === 'POST' ? await form(req) : {};
    if (p === '/billing/close-day') {
      // One consumption spend per customer per day, id demo_use_<date>_<voo_id>: re-running the job never double counts.
      const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : today();
      let n = 0;
      for (const [vooId, days] of Object.entries(db.usage)) {
        if (!(days[date] > 0)) continue;
        const endOfDay = Date.parse(`${date}T23:59:00Z`);
        voo.events.spend({ eventId: voo.events.id('use', date, vooId), vooId, valueUsd: days[date], label: 'Credits used', occurredAt: Math.min(endOfDay, Date.now()) });
        n++;
      }
      return json(res, 200, { customers: n });
    }
    const pay = db.payments.find((x) => x.id === Number(b.payment_id));
    if ((p === '/admin/refund' || p === '/admin/chargeback') && !pay) return json(res, 404, { error: 'Payment not found.' });
    if (p === '/admin/refund') {
      // Logged by VooSquare as "Refund by the tool (commission final)": never reverses affiliate commission.
      pay.status = 'refunded'; save();
      const ev = voo.events.refund({ eventId: voo.events.id('rf', pay.id), vooId: pay.voo_id, valueUsd: pay.usd, plan: pay.plan || undefined, originalEventId: pay.event_id, label: 'Refund' });
      return json(res, 200, { event: ev });
    }
    if (p === '/admin/chargeback') {
      // A card dispute: reverses the commission on that payment.
      pay.status = 'chargeback'; save();
      const ev = voo.events.chargeback({ eventId: voo.events.id('cb', pay.id), vooId: pay.voo_id, valueUsd: pay.usd, originalEventId: pay.event_id, label: 'Card dispute' });
      return json(res, 200, { event: ev });
    }
    if (p === '/admin/flush') return json(res, 200, await voo.events.drain({ timeoutMs: Number(b.timeout_ms) || 10_000 }));
    if (p === '/admin/state') return json(res, 200, { users: db.users, payments: db.payments, replies: db.replies, pending: voo.events.pending(), failed: voo.events.failures(), stats: voo.events.stats });
    return json(res, 404, { error: 'Not found' });
  }
  return send(res, 404, layout('Not found', '<h1>Not found</h1><a class="btn" href="/">Home</a>'));
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error('[demo]', e);
    if (!res.headersSent) json(res, e instanceof VooError && e.status ? 502 : 500, { error: e instanceof VooError ? e.message : 'Something went wrong.' });
  });
});
server.listen(PORT, () => {
  console.log(`[demo] ${TOOL} on ${PUBLIC_URL} (port ${PORT}), VooSquare ${voo.base}`);
  if (!process.env.DEMO_ADMIN_TOKEN) console.log(`[demo] admin token: ${ADMIN_TOKEN}`);
});
async function shutdown() { // send what is queued before stopping ← Voo Connect
  voo.events.stop();
  server.close();
  try { await voo.events.drain({ timeoutMs: 5000 }); } catch { /* best effort; the outbox file keeps the rest */ }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
module.exports = { server, voo, db };
