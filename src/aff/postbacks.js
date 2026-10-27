'use strict';
/*
 * Server postbacks to an affiliate's tracker (Keitaro, Binom, RedTrack, Voluum or their own).
 *  - Per affiliate, optionally limited to products. Events: click (off by default), registration (alias signup),
 *    first_payment (alias ftd), payment, repeat_payment, qualified, cpa_pending, cpa_approved, cpa_declined, refund,
 *    chargeback, tier_change.
 *  - Macros in the URL (and the POST body): {click_id} {sub1}..{sub5} {event} {payout} {commission} {amount} {sale_amount}
 *    {currency} {offer} {offer_id} {product} {plan} {transaction_id} {conversion_id} {timestamp} {country} {device}
 *    {customer_ref} {payout_type} {status} {tier} {affiliate_id} {decline_reason}. Values are URL-encoded. No PII ever.
 *  - GET or POST (JSON body with the same fields). Optional HMAC: X-VooSquare-Signature: sha256=<hex of timestamp.body>
 *    with X-VooSquare-Timestamp, keyed with the postback's secret.
 *  - Delivery through src/netguard.js (public https hosts only, no redirects, 5 s timeout, capped reply). A 2xx is
 *    success; otherwise retries after 5 min, 30 min, 2 h, 6 h and 15 h (about 24 hours), then the delivery is dead.
 */
const crypto = require('node:crypto');
const D = require('../db');
const C = require('./core');
const NG = require('../netguard');
const { now, rid } = require('../util');

const EVENTS = ['click', 'registration', 'first_payment', 'payment', 'repeat_payment', 'qualified', 'cpa_pending', 'cpa_approved', 'cpa_declined', 'refund', 'chargeback', 'tier_change'];
const ALIAS = { signup: 'registration', ftd: 'first_payment', sale: 'payment' };
const RETRY_MIN = [5, 30, 120, 360, 900];
const TIMEOUT_MS = 5000;
const MACROS = ['click_id', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'event', 'payout', 'commission', 'amount', 'sale_amount', 'currency', 'offer', 'offer_id', 'product', 'plan',
  'transaction_id', 'conversion_id', 'timestamp', 'country', 'device', 'customer_ref', 'payout_type', 'status', 'tier', 'affiliate_id', 'decline_reason'];

const normEvent = (e) => { e = String(e || '').toLowerCase(); return ALIAS[e] || e; };
function cleanEvents(list) { return [...new Set((Array.isArray(list) ? list : []).map(normEvent).filter((e) => EVENTS.includes(e)))]; }
/** Validate a postback URL an affiliate typed. Returns '' when fine. */
function urlProblem(u) {
  const p = NG.urlProblem(u);
  if (p) return 'The URL ' + p + '.';
  if (/[\s<>"'`\\]/.test(u)) return 'The URL has characters that are not allowed.';
  if (String(u).length > 1000) return 'The URL is too long.';
  return '';
}

/** Macro values for one event. Never includes the customer's name, email, IP or anything personal. */
function varsFor(a, event, conv, extra = {}) {
  const attr = conv && conv.customer_user_id ? D.get('SELECT * FROM aff_attributions WHERE customer_user_id=?', conv.customer_user_id) : null;
  const click = attr && attr.click_id ? D.get('SELECT ext_click_id, device FROM aff_clicks WHERE id=?', attr.click_id) : null;
  const com = extra.commission_cents !== undefined ? extra.commission_cents : conv ? D.get("SELECT COALESCE(SUM(amount_cents),0) s FROM aff_commissions WHERE conversion_id=? AND type<>'clawback'", conv.id).s : 0;
  const cust = conv && conv.customer_user_id ? D.get('SELECT model FROM aff_customers WHERE user_id=?', conv.customer_user_id) : null;
  const money = (c) => (Math.round(c) / 100).toFixed(2);
  const T = C.tiers();
  return {
    click_id: (attr && attr.ext_click_id) || (click && click.ext_click_id) || '', sub1: attr ? attr.sub1 : '', sub2: attr ? attr.sub2 : '', sub3: attr ? attr.sub3 : '', sub4: attr ? attr.sub4 : '', sub5: attr ? attr.sub5 : '',
    event, payout: money(com), commission: money(com), amount: money(conv ? conv.amount_cents : 0), sale_amount: money(conv ? conv.amount_cents : 0), currency: 'USD',
    offer: conv ? conv.product_key : '', offer_id: conv ? conv.product_key : '', product: conv ? conv.product_key : '', plan: conv ? conv.plan : '',
    transaction_id: conv ? `VS${conv.id}` : '', conversion_id: conv ? `VS${conv.id}` : '', timestamp: String(Math.floor((conv ? conv.occurred_at || now() : now()) / 1000)),
    country: (conv && conv.country) || (attr && attr.country) || '', device: (attr && attr.device) || (click && click.device) || '', customer_ref: attr ? attr.cust_ref : '',
    payout_type: event.startsWith('cpa') ? (cust && cust.model === 'hybrid' ? 'hybrid' : 'cpa') : 'revshare',
    status: { cpa_approved: 'approved', cpa_declined: 'declined', cpa_pending: 'pending', refund: 'reversed', chargeback: 'reversed' }[event] || (conv ? conv.status : ''),
    tier: T[C.effectiveTier(a)].name, affiliate_id: `AF-${a.id}`, decline_reason: '', ...Object.fromEntries(Object.entries(extra).filter(([k]) => MACROS.includes(k)).map(([k, v]) => [k, String(v)])),
  };
}
function fill(url, vars) {
  return String(url).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? encodeURIComponent(vars[k] ?? '') : m));
}

/** Queue deliveries of `event` to every matching postback of the affiliate. Idempotent per (postback, event, conversion). */
function enqueue(a, event, conv, extra = {}) {
  event = normEvent(event);
  const list = D.all('SELECT * FROM aff_postbacks WHERE affiliate_id=? AND active=1', a.id);
  if (!list.length) return 0;
  let n = 0;
  for (const pb of list) {
    const evs = C.json(pb.events, []);
    if (!evs.includes(event)) continue;
    const prods = C.json(pb.products, []);
    const pk = conv ? conv.product_key : extra.product; // a click has no conversion: its product comes in extra
    if (prods.length && pk && !prods.includes(pk)) continue;
    const vars = varsFor(a, event, conv, extra);
    const key = `${event}:${conv ? conv.id : rid(6)}`;
    const r = D.run(`INSERT OR IGNORE INTO aff_postback_deliveries(postback_id,affiliate_id,event,event_key,conversion_id,url,method,body,status,next_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,'pending',?,?,?)`, pb.id, a.id, event, key, conv ? conv.id : null, fill(pb.url, vars), pb.method, pb.method === 'POST' ? JSON.stringify(vars) : '', now(), now(), now());
    if (r.changes) n++;
  }
  if (n) setImmediate(() => { work().catch((e) => console.error('[aff postbacks]', e.message)); });
  return n;
}

async function send(pb, d) {
  const t0 = Date.now();
  const headers = { 'User-Agent': 'VooSquare-Postback/1.0' };
  const body = d.method === 'POST' ? d.body : null;
  if (body) headers['Content-Type'] = 'application/json';
  if (pb && pb.secret) {
    const ts = String(Math.floor(Date.now() / 1000));
    headers['X-VooSquare-Timestamp'] = ts;
    headers['X-VooSquare-Signature'] = 'sha256=' + crypto.createHmac('sha256', pb.secret).update(`${ts}.${body || d.url}`).digest('hex');
  }
  try {
    const r = await NG.guardedJson(d.url, { method: d.method, headers, body, timeoutMs: TIMEOUT_MS, maxBytes: 16 * 1024 });
    return { ok: r.ok, code: r.status, ms: Date.now() - t0, error: r.ok ? '' : r.redirect ? 'Redirects are not followed.' : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, code: 0, ms: Date.now() - t0, error: e.message || 'Could not reach the server.' };
  }
}
let working = false; let again = false;
/** Send due deliveries. at: the clock to use (tests move it forward to see retries). */
async function work(at = now()) {
  if (working) { again = true; return 0; }
  working = true;
  let n = 0;
  try {
    const due = D.all("SELECT * FROM aff_postback_deliveries WHERE status IN ('pending','retry') AND next_at<=? ORDER BY next_at LIMIT 100", at);
    for (const d of due) {
      if (!D.run("UPDATE aff_postback_deliveries SET status='sending', updated_at=? WHERE id=? AND status IN ('pending','retry')", now(), d.id).changes) continue;
      const pb = D.get('SELECT * FROM aff_postbacks WHERE id=?', d.postback_id);
      const r = await send(pb, d);
      const attempts = d.attempts + 1;
      if (r.ok) D.run("UPDATE aff_postback_deliveries SET status='sent', response_code=?, response_ms=?, attempts=?, last_error='', updated_at=? WHERE id=?", r.code, r.ms, attempts, now(), d.id);
      else {
        const next = RETRY_MIN[attempts - 1];
        D.run('UPDATE aff_postback_deliveries SET status=?, response_code=?, response_ms=?, attempts=?, last_error=?, next_at=?, updated_at=? WHERE id=?',
          next !== undefined ? 'retry' : 'dead', r.code, r.ms, attempts, String(r.error).slice(0, 300), next !== undefined ? at + next * 60_000 : null, now(), d.id);
      }
      n++;
    }
  } finally {
    working = false;
    if (again) { again = false; setImmediate(() => { work().catch((e) => console.error('[aff postbacks]', e.message)); }); }
  }
  return n;
}
/** Send a test event now and return the result (never retried). */
async function test(a, pb, event = 'first_payment') {
  event = normEvent(event) || 'first_payment';
  const vars = { ...varsFor(a, event, null), click_id: 'TEST_CLICK', sub1: 'test_sub1', customer_ref: 'C-TEST01', amount: '99.00', sale_amount: '99.00', payout: '24.75', commission: '24.75', offer: 'joinvoo', offer_id: 'joinvoo', product: 'joinvoo', plan: 'Pro', transaction_id: 'VSTEST', conversion_id: 'VSTEST', country: 'NG', device: 'mobile', status: 'test' };
  const d = { url: fill(pb.url, vars), method: pb.method, body: pb.method === 'POST' ? JSON.stringify(vars) : '' };
  const r = await send(pb, d);
  D.insert('aff_postback_deliveries', { postback_id: pb.id, affiliate_id: a.id, event, event_key: 'test:' + rid(8), url: d.url, method: d.method, body: d.body, status: r.ok ? 'sent' : 'dead', response_code: r.code, response_ms: r.ms, attempts: 1, last_error: r.error || '', test: 1, created_at: now(), updated_at: now() });
  return r;
}
/** Resend one logged delivery (affiliate "Resend" button). */
function resend(d) {
  D.run("UPDATE aff_postback_deliveries SET status='pending', next_at=?, updated_at=? WHERE id=?", now(), now(), d.id);
  setImmediate(() => { work().catch(() => {}); });
}
const view = (pb) => ({ id: pb.id, name: pb.name, url: pb.url, method: pb.method, events: C.json(pb.events, []), products: C.json(pb.products, []), active: !!pb.active, signed: !!pb.secret, created_at: pb.created_at, updated_at: pb.updated_at });
const deliveryView = (d) => ({ id: d.id, postback_id: d.postback_id, event: d.event, url: d.url, method: d.method, status: d.status, response_code: d.response_code, response_ms: d.response_ms, attempts: d.attempts, next_at: d.next_at, error: d.last_error, test: !!d.test, created_at: d.created_at, updated_at: d.updated_at });

module.exports = { EVENTS, ALIAS, MACROS, RETRY_MIN, normEvent, cleanEvents, urlProblem, varsFor, fill, enqueue, work, test, resend, view, deliveryView };
