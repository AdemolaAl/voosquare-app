'use strict';
const config = require('./config');
const D = require('./db');
const mailer = require('./mailer');
const apps = require('./applications');
const up = require('./uploads');
const { guardedJson, urlProblem } = require('./netguard');
const { now, rid, hmac, safeEq, fail, json, fetchJson, mask, publish, clean } = require('./util');

/**
 * Payment method types. Each has the config fields admin can fill in.
 * Secret fields are masked when read back by the admin.
 *  redirect: the member is sent to a hosted checkout page
 *  webhook:  the provider can call /api/billing/webhook/<method id>
 *  test:     admin can run "Test connection"
 */
const TYPES = {
  paystack: { label: 'Paystack', desc: 'Cards, bank and USSD in Nigeria, Ghana, Kenya and South Africa.', fields: ['secret_key'], secrets: ['secret_key'], redirect: true, webhook: true },
  flutterwave: { label: 'Flutterwave', desc: 'Cards and mobile money across Africa.', fields: ['secret_key', 'webhook_hash'], secrets: ['secret_key', 'webhook_hash'], redirect: true, webhook: true },
  stripe: { label: 'Stripe (cards)', desc: 'Cards worldwide.', fields: ['secret_key', 'webhook_secret'], secrets: ['secret_key', 'webhook_secret'], redirect: true, webhook: true },
  gatevoo: { label: 'Gatevoo (USDT and Bitcoin)', desc: 'Zedapex checkout. USDT TRC20 and Bitcoin, straight to your wallet. Confirms on its own.', fields: ['api_base', 'api_key', 'webhook_secret', 'assets'], secrets: ['api_key', 'webhook_secret'], redirect: true, webhook: true, test: true },
  crypto: { label: 'Crypto wallet', desc: 'Show a wallet address. The member pastes the transaction hash and your team approves.', fields: ['network', 'address', 'instructions', 'proof_mode'], secrets: [], redirect: false },
  manual: { label: 'Custom manual (any method)', desc: 'Bank transfer, mobile money or anything else. You set the details and approve each payment.', fields: ['instructions', 'details', 'proof_mode', 'icon'], secrets: [], redirect: false },
  custom: { label: 'Custom API (any provider)', desc: 'Any payment provider with an API that returns a checkout link.', fields: ['create_url', 'auth_header', 'body_template', 'amount_mode', 'minor_units', 'url_field', 'id_field', 'verify_url', 'status_field', 'paid_value', 'webhook_secret'], secrets: ['auth_header', 'webhook_secret'], redirect: true, webhook: true, test: true },
};
const GATEVOO_ASSETS = ['USDT_TRC20', 'BTC'];
const PROOF_MODES = ['either', 'text', 'image', 'both'];
const MAX_DETAILS = 6;

/** Normalise what an admin saved for a method (types, limits, safe URLs). */
function normalizeConfig(type, c) {
  const out = { ...c };
  if (type === 'manual' || type === 'crypto') out.proof_mode = PROOF_MODES.includes(out.proof_mode) ? out.proof_mode : 'either';
  if (type === 'manual') {
    out.details = (Array.isArray(out.details) ? out.details : []).map((d) => ({ label: clean(d && d.label, 40), value: clean(d && d.value, 200) })).filter((d) => d.label || d.value).slice(0, MAX_DETAILS);
    out.icon = /^[a-z0-9-]{1,20}$/.test(String(out.icon || '')) ? out.icon : '';
    out.instructions = clean(out.instructions, 2000);
  }
  if (type === 'crypto') out.instructions = clean(out.instructions, 2000);
  if (type === 'gatevoo') {
    out.api_base = String(out.api_base || 'https://gatevoo.com').trim().replace(/\/+$/, '') || 'https://gatevoo.com';
    const a = Array.isArray(out.assets) ? out.assets : String(out.assets || '').split(',');
    out.assets = a.map((x) => String(x).trim()).filter((x) => GATEVOO_ASSETS.includes(x));
    if (!out.assets.length) out.assets = [...GATEVOO_ASSETS];
  }
  if (type === 'custom') {
    out.amount_mode = out.amount_mode === 'usd' ? 'usd' : 'local';
    out.minor_units = out.minor_units === true || out.minor_units === 'true' || out.minor_units === 1 || out.minor_units === '1';
  }
  return out;
}

/** Problems an admin should fix before switching a method on (empty list = fine). */
function configProblems(type, c) {
  const p = [];
  if (type === 'gatevoo') {
    const bad = urlProblem(c.api_base); if (bad) p.push('Gatevoo address ' + bad + '.');
    if (!c.api_key) p.push('Add the Gatevoo API key.');
    if (!c.webhook_secret) p.push('Add the webhook secret, or paid invoices cannot unlock access on their own.');
  }
  if (type === 'custom') {
    const bad = urlProblem(c.create_url); if (bad) p.push('Create checkout URL ' + bad + '.');
    if (c.verify_url) { const b2 = urlProblem(c.verify_url); if (b2) p.push('Verify URL ' + b2 + '.'); }
    if (c.body_template) { try { renderTemplate(c.body_template, { amount: 1, currency: 'USD', order_id: 'VS-TEST', email: 'a@b.co', return_url: 'https://x', webhook_url: 'https://x', name: 'A', description: 'D', amount_usd: 1 }); } catch { p.push('The body template is not valid JSON.'); } }
    if (!c.verify_url && !c.webhook_secret) p.push('Add a verify URL or a webhook secret so paid orders can be confirmed.');
  }
  if (type === 'crypto' && !c.address) p.push('Add the wallet address.');
  if (['paystack', 'flutterwave', 'stripe'].includes(type) && !c.secret_key) p.push('Add the secret key.');
  return p;
}

function publicMethod(m) {
  const c = json(m.config, {});
  return {
    id: m.id, type: m.type, name: m.name, currency: m.currency, rate: m.rate, note: m.note,
    countries: json(m.countries, []), redirect: !!TYPES[m.type]?.redirect,
    network: m.type === 'crypto' ? c.network || '' : undefined,
    assets: m.type === 'gatevoo' ? (c.assets || GATEVOO_ASSETS) : undefined,
    icon: m.type === 'manual' ? c.icon || '' : undefined,
    details: m.type === 'manual' ? (c.details || []) : undefined,
    proof_mode: m.type === 'manual' || m.type === 'crypto' ? c.proof_mode || 'either' : undefined,
  };
}

function adminMethod(m) {
  const c = json(m.config, {});
  const secrets = TYPES[m.type]?.secrets || [];
  const masked = {};
  for (const [k, v] of Object.entries(c)) masked[k] = secrets.includes(k) ? mask(v) : v;
  const orders = D.get('SELECT COUNT(*) n FROM orders WHERE method_id=?', m.id).n;
  return { ...m, config: masked, countries: json(m.countries, []), webhook_url: `${config.baseUrl}/api/billing/webhook/${m.id}`, orders, problems: configProblems(m.type, c) };
}

/** Merge admin edits; masked values (••••1234) keep the stored secret. */
function mergeConfig(oldConfig, incoming) {
  const out = { ...json(oldConfig, {}) };
  for (const [k, v] of Object.entries(incoming || {})) {
    if (typeof v === 'string' && v.startsWith('••••')) continue;
    out[k] = typeof v === 'string' ? v.trim() : v;
  }
  return out;
}

/* ---------------- grandfathering (migration 002, docs/CHANGING-SAFELY.md "Change a price safely") ----------------
 * A member who is already paying keeps the price and period of their last paid order (table price_locks) while their
 * access is active, plus a grace period (setting `grandfathering`: { enabled: true, grace_days: 7 }). New members, and
 * members who let it lapse past the grace period, pay today's price. If today's terms are as good or better (same or
 * lower price AND same or longer period), today's terms win, so a price cut reaches everyone. */
function grandfathering() {
  const g = D.getSetting('grandfathering', {}) || {};
  return { enabled: g.enabled !== false, grace_days: Math.max(0, Math.min(365, Number(g.grace_days ?? 7) || 0)) };
}
function activeLock(user, itemType, itemId) {
  if (!user || !user.id) return null;
  const g = grandfathering();
  if (!g.enabled) return null;
  const lock = D.get('SELECT * FROM price_locks WHERE user_id=? AND item_type=? AND item_id=?', user.id, itemType, itemType === 'room' ? Number(itemId) || 0 : 0);
  if (!lock) return null;
  const until = itemType === 'premium'
    ? (D.get('SELECT premium_until FROM users WHERE id=?', user.id) || {}).premium_until || 0
    : (D.get('SELECT until FROM room_access WHERE user_id=? AND room_id=?', user.id, Number(itemId)) || {}).until || 0;
  return until + g.grace_days * 86400_000 > now() ? lock : null;
}
const daysValue = (d) => (Number(d) > 0 ? Number(d) : Infinity); // 0 days = lifetime

/** Today's price for an item, or the member's kept price when they are grandfathered. */
function priceFor(itemType, itemId, user = null) {
  let list;
  if (itemType === 'premium') {
    const p = D.getSetting('premium', {});
    if (!p.enabled) fail(400, 'Premium is not on sale right now.');
    list = { usd: Number(p.price_usd) || 20, name: p.name || 'VooSquare Premium', days: Number(p.period_days) || 30, features: Array.isArray(p.features) ? p.features : [] };
  } else if (itemType === 'room') {
    const r = D.get('SELECT * FROM rooms WHERE id=? AND archived=0', itemId);
    if (!r || r.access !== 'paid') fail(404, 'That room is not for sale.');
    list = { usd: Number(r.price_usd) || 0, name: r.name, days: Number(r.period_days) || 0, features: [] };
  } else fail(400, 'Unknown item.');
  const lock = activeLock(user, itemType, itemId);
  const todayAsGood = lock && list.usd <= lock.price_usd && daysValue(list.days) >= daysValue(lock.period_days);
  if (!lock || todayAsGood) return { ...list, locked: false, list_usd: list.usd };
  return { usd: lock.price_usd, name: list.name, days: Number(lock.period_days) || 0, features: json(lock.features, list.features), locked: true, list_usd: list.usd, list_days: list.days, locked_at: lock.locked_at };
}
/** priceFor without throwing (for showing prices). */
function quote(user, itemType, itemId) { try { return priceFor(itemType, itemId, user); } catch { return null; } }
/** The member's kept room prices, by room id (for the checkout screen). */
function roomQuotes(user) {
  const out = {};
  for (const l of D.all("SELECT item_id FROM price_locks WHERE user_id=? AND item_type='room'", user.id)) { const q = quote(user, 'room', l.item_id); if (q && q.locked) out[l.item_id] = q; }
  return out;
}
/** After a paid order: the member keeps these terms (what they were sold) until their access lapses. */
function lockTerms(order, days) {
  const terms = json(order.terms, {}) || {};
  const price = Number.isFinite(Number(terms.price_usd)) && terms.price_usd !== '' && terms.price_usd !== null ? Number(terms.price_usd) : Number(order.amount_usd) || 0;
  if (price <= 0) return;
  D.run(`INSERT INTO price_locks(user_id,item_type,item_id,price_usd,period_days,item_name,features,order_id,locked_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id,item_type,item_id) DO UPDATE SET price_usd=excluded.price_usd, period_days=excluded.period_days, item_name=excluded.item_name,
    features=excluded.features, order_id=excluded.order_id, updated_at=excluded.updated_at`,
  order.user_id, order.item_type, order.item_type === 'room' ? Number(order.item_id) || 0 : 0, price, Number(days) || 0, order.item_name || '', JSON.stringify(terms.features || []), order.id, now(), now());
}

const round2 = (n) => Math.round(n * 100) / 100;
const pick = (obj, dotted) => String(dotted || '').split('.').filter(Boolean).reduce((o, k) => (o == null ? undefined : o[k]), obj);
const webhookUrl = (m) => `${config.baseUrl}/api/billing/webhook/${m.id}`;

function authHeaders(c) {
  const headers = {};
  if (c.auth_header && c.auth_header.includes(':')) { const i = c.auth_header.indexOf(':'); headers[c.auth_header.slice(0, i).trim()] = c.auth_header.slice(i + 1).trim(); }
  return headers;
}

/** Fill {{placeholders}} in a JSON body template. Values are JSON-escaped, so "{{email}}" and {{amount}} both work. */
function renderTemplate(tpl, vars) {
  const out = String(tpl).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, k) => (k in vars ? JSON.stringify(vars[k] ?? '').replace(/^"|"$/g, '') : ''));
  return JSON.parse(out);
}

/** What the member sees to pay by hand (crypto wallet or custom manual). */
function payInstructions(m, amount, currency) {
  const c = json(m.config, {});
  if (m.type === 'crypto') return { kind: 'crypto', network: c.network || '', address: c.address || '', amount, currency, instructions: c.instructions || '', proof_mode: c.proof_mode || 'either' };
  if (m.type === 'manual') return { kind: 'manual', name: m.name, icon: c.icon || '', amount, currency, instructions: c.instructions || '', details: c.details || [], proof_mode: c.proof_mode || 'either' };
  return null;
}

async function gatevooCall(c, method, p, body, idempotencyKey) {
  return guardedJson(c.api_base.replace(/\/+$/, '') + p, {
    method, headers: { Authorization: 'Bearer ' + c.api_key, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
}

/*
 * Unpaid orders. A transfer or crypto order (no provider checkout) waits for the member to send money and add proof.
 * Opening checkout again for the same item and method reuses that open order instead of making a new one, the member can
 * cancel it, and one left unpaid for `pending_expire_days` (Settings key 'billing', default 7) turns 'expired'. Nothing
 * is deleted: an expired or cancelled order can still be approved if the money arrives later.
 */
const MANUAL_TYPES = ['manual', 'crypto'];
const DAY_MS = 86400_000;
function billingSettings() {
  const v = D.getSetting('billing', {}) || {};
  const d = Math.floor(Number(v.pending_expire_days));
  return { pending_expire_days: Number.isFinite(d) && d >= 1 ? Math.min(90, d) : 7 };
}
function cleanBillingSetting(v) {
  const d = Math.floor(Number(v && v.pending_expire_days));
  if (!Number.isFinite(d) || d < 1 || d > 90) fail(400, 'Choose between 1 and 90 days.');
  return { pending_expire_days: d };
}
/** Turn unpaid transfer and crypto orders older than the setting into 'expired'. Returns how many changed. */
function expireStale(at = now()) {
  const days = billingSettings().pending_expire_days;
  return D.run(`UPDATE orders SET status='expired', note=? WHERE status='pending' AND created_at<? AND method_id IN (SELECT id FROM payment_methods WHERE type IN (${MANUAL_TYPES.map(() => '?').join(',')}))`,
    `Not paid within ${days} ${days === 1 ? 'day' : 'days'}`, at - days * DAY_MS, ...MANUAL_TYPES).changes;
}
/** The member cancels an order they have not paid (status 'pending' only). */
function cancelOrder(user, ref) {
  const o = D.get('SELECT * FROM orders WHERE ref=? AND user_id=?', String(ref), user.id);
  if (!o) fail(404, 'Order not found.');
  if (o.status !== 'pending') fail(409, o.status === 'review' ? 'We are already checking the payment for this order. Message support if something is wrong.' : `This order is ${o.status} and cannot be cancelled.`);
  D.run("UPDATE orders SET status='cancelled', note='Cancelled by the member' WHERE id=? AND status='pending'", o.id);
  return D.get('SELECT * FROM orders WHERE id=?', o.id);
}

async function createCheckout(user, { item, room_id, method_id }) {
  const m = D.get('SELECT * FROM payment_methods WHERE id=? AND enabled=1', method_id);
  if (!m) fail(400, 'Choose a payment method.');
  const price = priceFor(item, room_id, user);
  if (price.usd <= 0) fail(400, 'This item has no price set.');
  // Invite-only rooms: approved members (or current members renewing) only.
  if (item === 'room') apps.assertCanBuy(user, D.get('SELECT * FROM rooms WHERE id=?', Number(room_id)));
  const rate = Number(m.rate) || 1;
  const amount = rate < 0.01 ? Math.round(price.usd * rate * 1e8) / 1e8 : round2(price.usd * rate);
  if (MANUAL_TYPES.includes(m.type)) {
    // Same item, same method, same price and amount, not paid yet: carry on with that order.
    expireStale();
    const open = D.get("SELECT * FROM orders WHERE user_id=? AND item_type=? AND IFNULL(item_id,0)=? AND method_id=? AND status='pending' AND amount_usd=? AND amount=? AND currency=? ORDER BY id DESC LIMIT 1",
      user.id, item, item === 'room' ? Number(room_id) : 0, m.id, price.usd, amount, m.currency);
    if (open && (m.type !== 'crypto' || json(m.config, {}).address)) return { order: publicOrder(open), method: publicMethod(m), pay: payInstructions(m, open.amount, open.currency), reused: true };
  }
  const ref = 'VS-' + rid(6).toUpperCase().replace(/[^A-Z0-9]/g, 'X');
  const o = D.insert('orders', {
    ref, user_id: user.id, item_type: item, item_id: item === 'room' ? Number(room_id) : null, item_name: price.name,
    amount_usd: price.usd, currency: m.currency, amount, method_id: m.id, status: 'pending', created_at: now(),
    // What was sold, frozen on the order: later price or period changes never change it (grandfathering).
    period_days: price.days, terms: JSON.stringify({ price_usd: price.usd, period_days: price.days, name: price.name, features: price.features || [], locked: !!price.locked, list_usd: price.list_usd }),
  });
  const order = D.get('SELECT * FROM orders WHERE id=?', o.id);
  const c = json(m.config, {});
  const returnUrl = `${config.baseUrl}/app#billing-return:${ref}`;
  const cancelUrl = `${config.baseUrl}/app#premium`;
  const result = { order: publicOrder(order), method: publicMethod(m) };

  try {
    if (m.type === 'paystack') {
      const r = await fetchJson('https://api.paystack.co/transaction/initialize', {
        method: 'POST', headers: { Authorization: 'Bearer ' + c.secret_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, amount: Math.round(amount * 100), currency: m.currency, reference: ref, callback_url: returnUrl, metadata: { order_ref: ref } }),
      });
      if (!r.ok || !r.data?.data?.authorization_url) throw new Error(r.data?.message || 'Paystack did not return a checkout link');
      result.redirect_url = r.data.data.authorization_url;
    } else if (m.type === 'flutterwave') {
      const r = await fetchJson('https://api.flutterwave.com/v3/payments', {
        method: 'POST', headers: { Authorization: 'Bearer ' + c.secret_key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tx_ref: ref, amount, currency: m.currency, redirect_url: returnUrl, customer: { email: user.email, name: user.name }, customizations: { title: 'VooSquare', description: price.name } }),
      });
      if (!r.ok || !r.data?.data?.link) throw new Error(r.data?.message || 'Flutterwave did not return a checkout link');
      result.redirect_url = r.data.data.link;
    } else if (m.type === 'stripe') {
      const form = new URLSearchParams({
        mode: 'payment', success_url: returnUrl, cancel_url: cancelUrl, client_reference_id: ref, customer_email: user.email,
        'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': m.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)), 'line_items[0][price_data][product_data][name]': price.name,
        'metadata[order_ref]': ref,
      });
      const r = await fetchJson('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + c.secret_key, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': 'vs-order-' + ref }, body: form,
      });
      if (!r.ok || !r.data?.url) throw new Error(r.data?.error?.message || 'Stripe did not return a checkout link');
      D.run('UPDATE orders SET provider_ref=? WHERE id=?', r.data.id, order.id);
      result.redirect_url = r.data.url;
    } else if (m.type === 'gatevoo') {
      if (!c.api_key) throw new Error('Gatevoo is not connected yet');
      const r = await gatevooCall(c, 'POST', '/api/v1/invoices', {
        amount_usd: price.usd, order_id: ref, description: price.name, customer_email: user.email,
        success_url: returnUrl, cancel_url: cancelUrl, webhook_url: webhookUrl(m), assets: c.assets && c.assets.length ? c.assets : GATEVOO_ASSETS,
      }, 'vs-order-' + ref); // one invoice per order, even if the call is retried
      const link = String(r.data?.checkout_url || '');
      if (!r.ok || !r.data?.id || !(/^https:\/\//.test(link) || (!config.prod && /^http:\/\//.test(link)))) throw new Error('Gatevoo did not return a checkout link');
      D.run('UPDATE orders SET provider_ref=? WHERE id=?', String(r.data.id).slice(0, 120), order.id);
      result.redirect_url = link;
    } else if (m.type === 'custom') {
      const usdMode = c.amount_mode === 'usd';
      let amt = usdMode ? price.usd : amount;
      if (c.minor_units) amt = Math.round(amt * 100);
      const vars = { amount: amt, currency: usdMode ? 'USD' : m.currency, order_id: ref, email: user.email, name: user.name, description: price.name, amount_usd: price.usd, return_url: returnUrl, webhook_url: webhookUrl(m) };
      const body = c.body_template ? renderTemplate(c.body_template, vars)
        : { order_ref: ref, amount: amt, currency: vars.currency, amount_usd: price.usd, email: user.email, name: user.name, description: price.name, return_url: returnUrl, webhook_url: webhookUrl(m) };
      const r = await guardedJson(c.create_url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'vs-order-' + ref, ...authHeaders(c) }, body: JSON.stringify(body) });
      const url = pick(r.data, c.url_field || 'url');
      if (!r.ok || !url || !/^https?:\/\//i.test(String(url))) throw new Error('The custom payment API did not return a checkout link');
      const pref = c.id_field ? pick(r.data, c.id_field) : null;
      if (pref != null && pref !== '') D.run('UPDATE orders SET provider_ref=? WHERE id=?', String(pref).slice(0, 120), order.id);
      result.redirect_url = String(url);
    } else if (m.type === 'crypto') {
      result.pay = payInstructions(m, amount, m.currency);
      if (!c.address) throw new Error('This crypto method has no wallet address yet');
    } else if (m.type === 'manual') {
      result.pay = payInstructions(m, amount, m.currency);
    } else throw new Error('Unknown payment method type');
  } catch (e) {
    D.run("UPDATE orders SET status='failed',note=? WHERE id=?", String(e.message).slice(0, 300), order.id);
    fail(502, 'Payment could not start: ' + e.message);
  }
  return result;
}

function publicOrder(o) {
  return { id: o.id, ref: o.ref, item_type: o.item_type, item_id: o.item_id, item_name: o.item_name, amount_usd: o.amount_usd, currency: o.currency, amount: o.amount, status: o.status, created_at: o.created_at, paid_at: o.paid_at };
}

/** Ask Gatevoo for the invoice and decide whether it pays this order in full. */
async function gatevooPaid(c, order, invoiceId) {
  const id = invoiceId || order.provider_ref;
  if (!id || !c.api_key) return false;
  const r = await gatevooCall(c, 'GET', '/api/v1/invoices/' + encodeURIComponent(id));
  const inv = r.data || {};
  if (!r.ok || String(inv.id) !== String(id)) return false;
  if (inv.order_id && inv.order_id !== order.ref) return false;
  return inv.status === 'paid' && Number(inv.paid_amount) + 0.005 >= Number(order.amount_usd);
}

/** Ask the provider whether an order is paid. Returns true/false. */
async function verifyWithProvider(order) {
  const m = D.get('SELECT * FROM payment_methods WHERE id=?', order.method_id);
  if (!m) return false;
  const c = json(m.config, {});
  if (m.type === 'paystack') {
    const r = await fetchJson('https://api.paystack.co/transaction/verify/' + encodeURIComponent(order.ref), { headers: { Authorization: 'Bearer ' + c.secret_key } });
    const d = r.data?.data;
    return !!(r.ok && d && d.status === 'success' && d.amount >= Math.round(order.amount * 100) && String(d.currency).toUpperCase() === order.currency.toUpperCase());
  }
  if (m.type === 'flutterwave') {
    const r = await fetchJson('https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=' + encodeURIComponent(order.ref), { headers: { Authorization: 'Bearer ' + c.secret_key } });
    const d = r.data?.data;
    return !!(r.ok && d && d.status === 'successful' && Number(d.amount) >= order.amount && String(d.currency).toUpperCase() === order.currency.toUpperCase());
  }
  if (m.type === 'stripe') {
    if (!order.provider_ref) return false;
    const r = await fetchJson('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(order.provider_ref), { headers: { Authorization: 'Bearer ' + c.secret_key } });
    return !!(r.ok && r.data?.payment_status === 'paid');
  }
  if (m.type === 'gatevoo') return gatevooPaid(c, order);
  if (m.type === 'custom' && c.verify_url) {
    let u = c.verify_url;
    if (/\{\{\s*(order_id|provider_ref)\s*\}\}/.test(u)) u = u.replace(/\{\{\s*order_id\s*\}\}/g, encodeURIComponent(order.ref)).replace(/\{\{\s*provider_ref\s*\}\}/g, encodeURIComponent(order.provider_ref || ''));
    else u += (u.includes('?') ? '&' : '?') + 'order_ref=' + encodeURIComponent(order.ref);
    const r = await guardedJson(u, { headers: authHeaders(c) });
    return !!(r.ok && String(pick(r.data, c.status_field || 'status')) === String(c.paid_value || 'paid'));
  }
  return false;
}

/** Mark paid and grant access. Safe to call twice. */
function fulfill(orderId, by = 'system') {
  const order = D.get('SELECT * FROM orders WHERE id=?', orderId);
  // Refunded or charged-back orders stay that way: a replayed or late webhook (or a stale Approve) must not grant access again.
  if (!order || order.status === 'paid' || order.status === 'refunded' || order.status === 'chargeback') return order;
  const user = D.get('SELECT * FROM users WHERE id=?', order.user_id);
  if (!user) return order;
  let changed = false;
  D.tx(() => {
    // Only the call that flips the status grants access (two webhooks at once must not add 60 days).
    if (!D.run("UPDATE orders SET status='paid',paid_at=? WHERE id=? AND status NOT IN ('paid','refunded','chargeback')", now(), order.id).changes) return;
    changed = true;
    if (order.item_type === 'premium') {
      // The period sold on the order (orders before migration 002 have none: today's period).
      const days = order.period_days != null ? Number(order.period_days) || 30 : Number(D.getSetting('premium', {}).period_days) || 30;
      const until = Math.max(now(), user.premium_until || 0) + days * 86400_000;
      D.run('UPDATE users SET premium_until=? WHERE id=?', until, user.id);
      mailer.queue(user, (user.premium_until || 0) > now() ? 'premium_receipt' : 'premium_welcome', { until: require('./revenue').dateString(until), item: order.item_name, amount: `${order.amount} ${order.currency}`, ref: order.ref });
      if ((user.premium_until || 0) <= now()) mailer.queue(user, 'premium_receipt', { until: require('./revenue').dateString(until), item: order.item_name, amount: `${order.amount} ${order.currency}`, ref: order.ref });
    } else if (order.item_type === 'room') {
      const room = D.get('SELECT * FROM rooms WHERE id=?', order.item_id);
      const days = order.period_days != null ? Number(order.period_days) || 0 : room ? Number(room.period_days) || 0 : 0;
      const current = D.get('SELECT until FROM room_access WHERE user_id=? AND room_id=?', user.id, order.item_id);
      const until = days ? Math.max(now(), current?.until || 0) + days * 86400_000 : 9e15;
      D.run('INSERT INTO room_access(user_id,room_id,until) VALUES(?,?,?) ON CONFLICT(user_id,room_id) DO UPDATE SET until=excluded.until', user.id, order.item_id, until);
      apps.markPaid(user.id, order.item_id);
      mailer.queue(user, 'room_access', { room: order.item_name, until: days ? require('./revenue').dateString(until) : 'lifetime', amount: `${order.amount} ${order.currency}`, ref: order.ref });
    }
    if (order.item_type === 'premium' || order.item_type === 'room') lockTerms(order, order.period_days != null ? order.period_days : (order.item_type === 'premium' ? Number(D.getSetting('premium', {}).period_days) || 30 : Number((D.get('SELECT period_days FROM rooms WHERE id=?', order.item_id) || {}).period_days) || 0));
    D.insert('audit', { user_id: null, action: 'order.paid', detail: `${order.ref} ${order.item_name} by ${by}`, created_at: now() });
  });
  if (changed) {
    publish('user:' + user.id, 'order', { ref: order.ref, status: 'paid' });
    publish('staff', 'order', { ref: order.ref, status: 'paid' });
    require('./aff').onOrderPaid(order.id); // affiliate commission on VooSquare sales (Inner Circle is 0%)
  }
  return D.get('SELECT * FROM orders WHERE id=?', order.id);
}

/** Webhook handler: verifies the signature for the method, then fulfills. */
async function webhook(methodId, headers, raw) {
  const m = D.get('SELECT * FROM payment_methods WHERE id=?', methodId);
  if (!m) fail(404, 'Unknown method');
  const c = json(m.config, {});
  const body = json(raw.toString('utf8'), {});
  let ref = null;
  let trusted = false;
  let invoiceId = null;
  if (m.type === 'paystack') {
    if (!c.secret_key || !safeEq(headers['x-paystack-signature'], hmac(c.secret_key, raw, 'sha512'))) fail(401, 'Bad signature');
    if (body.event === 'charge.success') ref = body.data?.reference;
  } else if (m.type === 'flutterwave') {
    if (!c.webhook_hash || !safeEq(headers['verif-hash'], c.webhook_hash)) fail(401, 'Bad signature');
    ref = body.data?.tx_ref || body.txRef;
  } else if (m.type === 'stripe') {
    const sig = String(headers['stripe-signature'] || '');
    const t = /t=(\d+)/.exec(sig)?.[1];
    const v1s = [...sig.matchAll(/v1=([a-f0-9]+)/g)].map((x) => x[1]);
    const expected = t && c.webhook_secret ? hmac(c.webhook_secret, `${t}.${raw.toString('utf8')}`) : '';
    if (!t || !expected || !v1s.some((v) => safeEq(v, expected)) || Math.abs(Date.now() / 1000 - Number(t)) > 600) fail(401, 'Bad signature');
    if (body.type === 'checkout.session.completed') { ref = body.data?.object?.client_reference_id; trusted = body.data?.object?.payment_status === 'paid'; }
  } else if (m.type === 'gatevoo') {
    // Signature first (refused when no secret is saved), then we never trust the body: the invoice is fetched again from Gatevoo.
    const sig = String(headers['x-gatevoo-signature'] || '').trim().toLowerCase();
    if (!c.webhook_secret || !safeEq(sig, hmac(c.webhook_secret, raw))) fail(401, 'Bad signature');
    if (body.type === 'invoice.paid' && body.invoice) { ref = body.invoice.order_id; invoiceId = body.invoice.id ? String(body.invoice.id) : null; }
  } else if (m.type === 'custom') {
    if (!c.webhook_secret || !safeEq(headers['x-signature'], hmac(c.webhook_secret, raw))) fail(401, 'Bad signature');
    if (String(body.status) === String(c.paid_value || 'paid')) { ref = body.order_ref; trusted = !c.verify_url; }
  } else fail(400, 'This method has no webhook');
  if (!ref) return { ok: true, ignored: true };
  const order = D.get('SELECT * FROM orders WHERE ref=? AND method_id=?', String(ref), m.id);
  if (!order) return { ok: true, unknown: true };
  if (order.status === 'paid') return { ok: true, already: true };
  if (order.status === 'refunded' || order.status === 'chargeback') return { ok: true, ignored: true };
  if (m.type === 'gatevoo') {
    if (order.provider_ref && invoiceId && invoiceId !== order.provider_ref) return { ok: true, ignored: true };
    if (await gatevooPaid(c, order, order.provider_ref || invoiceId)) {
      if (!order.provider_ref && invoiceId) D.run('UPDATE orders SET provider_ref=? WHERE id=?', invoiceId, order.id);
      fulfill(order.id, 'gatevoo webhook');
      return { ok: true, paid: true };
    }
    return { ok: true, paid: false };
  }
  if (trusted || await verifyWithProvider(order)) fulfill(order.id, m.type + ' webhook');
  return { ok: true };
}

/** "Test connection" in the admin: config problems first, then one harmless call. Never returns secrets. */
async function testConnection(type, c) {
  const problems = configProblems(type, c);
  const out = { ok: false, problems, checks: [] };
  try {
    if (type === 'gatevoo') {
      if (urlProblem(c.api_base) || !c.api_key) return out;
      const r = await gatevooCall(c, 'GET', '/api/v1/me');
      if (r.ok) out.checks.push(`Connected to Gatevoo${r.data && r.data.merchant && r.data.merchant.name ? ' as ' + clean(r.data.merchant.name, 60) : ''}.`);
      else if (r.status === 401 || r.status === 403) out.problems.push('Gatevoo refused the API key.');
      else out.problems.push(`Gatevoo answered with HTTP ${r.status}. Its API may not be live yet.`);
    } else if (type === 'custom') {
      if (urlProblem(c.create_url)) return out;
      if (c.verify_url && !urlProblem(c.verify_url)) {
        let u = c.verify_url.replace(/\{\{\s*(order_id|provider_ref)\s*\}\}/g, 'VS-TEST');
        if (u === c.verify_url) u += (u.includes('?') ? '&' : '?') + 'order_ref=VS-TEST';
        const r = await guardedJson(u, { headers: authHeaders(c) });
        out.checks.push(`Verify URL answered with HTTP ${r.status}${r.status === 401 || r.status === 403 ? ' (check the auth header)' : ''}.`);
        if (r.status === 401 || r.status === 403) out.problems.push('The provider refused the auth header.');
      } else {
        // No harmless endpoint to call: check the address resolves to a public host. 405/404 still proves it is reachable.
        const r = await guardedJson(c.create_url, { method: 'GET', headers: authHeaders(c), timeoutMs: 6000 });
        out.checks.push(`The checkout address is reachable (HTTP ${r.status}).`);
      }
    } else {
      out.checks.push('Nothing to call for this type. The settings look complete.');
    }
  } catch (e) {
    out.problems.push(e.message || 'Could not reach the provider.');
  }
  out.ok = !out.problems.length;
  return out;
}

/** Proof from the member for a manual or crypto order: text reference and/or a screenshot, as the method requires. */
function submitProof(user, order, { proof, upload_id }) {
  const m = D.get('SELECT * FROM payment_methods WHERE id=?', order.method_id);
  const mode = (m && json(m.config, {}).proof_mode) || 'either';
  const text = clean(proof, 300);
  const hasText = text.length >= 4;
  const hasImg = !!upload_id;
  if (mode === 'text' && !hasText) fail(400, 'Paste your transaction hash or transfer reference.');
  if (mode === 'image' && !hasImg) fail(400, 'Add a screenshot of your payment.');
  if (mode === 'both' && (!hasText || !hasImg)) fail(400, 'Add your transfer reference and a screenshot of the payment.');
  if (!hasText && !hasImg) fail(400, 'Paste your transaction hash or transfer reference, or add a screenshot.');
  D.tx(() => {
    if (hasImg) { up.claim(upload_id, user, ['proof'], 'order:' + order.id); if (order.proof_upload) up.softDelete(order.proof_upload); }
    D.run("UPDATE orders SET status='review', proof=?, proof_upload=? WHERE id=?", text, hasImg ? String(upload_id) : (order.proof_upload || ''), order.id);
  });
}

module.exports = { MANUAL_TYPES, billingSettings, cleanBillingSetting, expireStale, cancelOrder, TYPES, GATEVOO_ASSETS, publicMethod, adminMethod, mergeConfig, normalizeConfig, configProblems, createCheckout, verifyWithProvider, fulfill, webhook, publicOrder, priceFor, quote, roomQuotes, grandfathering, payInstructions, testConnection, submitProof, renderTemplate };
