'use strict';
/*
 * Referral earnings and payouts.
 *
 * Commission source: what the people a member referred (users.referred_by = member) spend, from two places, counted
 * exactly like revenue (src/revenue.js):
 *  - VooSquare sales: orders with status 'paid' (Premium and paid rooms), amount_usd > 0, at paid_at.
 *    Pending, in-review, failed, refunded and cancelled orders never count, so a refunded order drops out of earnings.
 *  - Tool spend: `spend` events with 0 < value_usd <= MAX_VALUE, settling from received_at (when VooSquare got the event,
 *    so a tool cannot backdate it past the settling period; older rows fall back to created_at). Events sent with the
 *    hub product's own key are ignored so VooSquare sales are never counted twice.
 *    Affleego spend never earns referral commission (owner decision 2026-10-05: "No commission for that. Remove it from
 *    anything commission."). Affleego operates separately: NO_COMMISSION below (same list as the affiliate program).
 *
 * Banned members: spend by a referred member who is banned does not count while the ban lasts (pending and settled
 * earnings both drop, and they stop counting as a paying referral). If that takes settled earnings below what was
 * already paid, the difference shows as owed (see ledger). Unbanning restores it. Erasing a member (src/features.js)
 * also bans them, so their spend stays excluded; a deleted user row simply drops out.
 *
 * Rate: the member's CURRENT tier (by number of paying referrals) applies to all their earnings, past and future.
 * Settlement: each earning is "pending" for settle_days after its payment date, then "available".
 * Balance: available = settled earnings - (paid payouts + open payouts). Rejected and cancelled payouts give the money back.
 * Money maths is exact: integer micro-dollars summed as BigInt, rounded down to cents only at the end.
 *
 * VooSquare never holds or moves the money. The Zedapex team pays from outside (own wallet or bank) and marks the
 * payout paid with a transaction hash or bank reference. One open request per member (unique index in db.js).
 */
const crypto = require('node:crypto');
const D = require('./db');
const REV = require('./revenue');
const { now, clean, fail, json } = require('./util');

const DAY = 86400_000;
const OPEN = ['requested', 'processing'];
const STATUSES = ['requested', 'processing', 'paid', 'rejected', 'cancelled'];
const DEFAULT_TERMS = 'Earnings stay pending for the settling period after each payment, so refunds and chargebacks can clear. When your available balance reaches the minimum, request a payout. The Zedapex team checks each request, sends the money to the payout details you saved and marks it paid with the transaction reference. Check your details carefully: payments sent to the details you saved cannot be recalled. Network or bank fees may apply. Self-referrals and fake accounts are removed and their earnings cancelled. Spend by a referred account that is banned does not count while the ban lasts, and if it was already paid out, it is taken from your next earnings.';

const cents = (usd) => Math.round((Number(usd) || 0) * 100);
const usd = (c) => Math.round(c) / 100;
const micro = (v) => Math.round((Number(v) || 0) * 1e6);

/* ---------------- settings ---------------- */
function settings() {
  const s = D.getSetting('referrals', {}) || {};
  const tiers = (Array.isArray(s.tiers) ? s.tiers : [])
    .map((t) => ({ min: Math.max(0, Math.floor(Number(t && t.min) || 0)), rate: Math.max(0, Math.min(100, Number(t && t.rate) || 0)) }))
    .filter((t) => t.rate > 0).sort((a, b) => a.min - b.min);
  const num = (v, def) => (v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? def : Number(v));
  return {
    tiers,
    min_withdraw: Math.max(0, num(s.min_withdraw, 300)),
    settle_days: Math.max(0, Math.min(365, Math.floor(num(s.settle_days, 30)))),
    terms: typeof s.terms === 'string' && s.terms.trim() ? s.terms : DEFAULT_TERMS,
  };
}
/** Clean the `referrals` setting before it is saved from the admin. */
function cleanSetting(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) fail(400, 'Send the referral tiers and payout rules.');
  const tiers = (Array.isArray(v.tiers) ? v.tiers : []).slice(0, 12)
    .map((t) => ({ min: Math.max(0, Math.floor(Number(t && t.min) || 0)), rate: Math.round(Math.max(0, Math.min(100, Number(t && t.rate) || 0)) * 100) / 100 }))
    .filter((t) => t.rate > 0).sort((a, b) => a.min - b.min);
  const min = Number(v.min_withdraw);
  if (!Number.isFinite(min) || min < 0 || min > 1e6) fail(400, 'Set the minimum payout between $0 and $1,000,000.');
  const days = Number(v.settle_days);
  if (!Number.isFinite(days) || days < 0 || days > 365) fail(400, 'Set the settling period between 0 and 365 days.');
  return { tiers, min_withdraw: Math.round(min * 100) / 100, settle_days: Math.floor(days), terms: clean(v.terms, 2000) };
}

/** The tier for a number of paying referrals. With none yet, the first tier (so the member sees what they will earn). */
function tierFor(tiers, paying) {
  const cur = [...tiers].reverse().find((t) => paying >= t.min);
  return cur || tiers[0] || { min: 0, rate: 0 };
}

/* ---------------- payout methods ---------------- */
const METHOD_LABEL = { usdt_trc20: 'USDT (TRC20)', bank: 'Bank transfer', mobile_money: 'Mobile money' };
const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** A real TRON address: Base58Check, 25 bytes, version 0x41, double-SHA256 checksum. Catches a mistyped character. */
function tronOk(a) {
  if (!TRON.test(a)) return false;
  let n = 0n;
  for (const ch of a) n = n * 58n + BigInt(B58.indexOf(ch));
  let hex = n.toString(16); if (hex.length % 2) hex = '0' + hex;
  const b = Buffer.from(hex, 'hex');
  if (b.length !== 25 || b[0] !== 0x41) return false;
  const sha = (x) => crypto.createHash('sha256').update(x).digest();
  return sha(sha(b.subarray(0, 21))).subarray(0, 4).equals(b.subarray(21));
}
const last4 = (s) => String(s || '').replace(/\s+/g, '').slice(-4);

/** Validate what a member typed. Returns the cleaned details or throws a 400 with a plain message. */
function cleanMethod(b) {
  const type = String((b && b.type) || '');
  if (!METHOD_LABEL[type]) fail(400, 'Choose USDT (TRC20), bank transfer or mobile money.');
  const country = clean(b.country, 2).toUpperCase();
  const need = (v, min, max, msg) => { v = clean(v, max); if (v.length < min) fail(400, msg); return v; };
  if (type === 'usdt_trc20') {
    const address = String(b.address || '').trim();
    if (!TRON.test(address)) fail(400, 'That is not a TRC20 address. It starts with T and has 34 letters and numbers.');
    if (!tronOk(address)) fail(400, 'That TRC20 address has a typo: its check digits do not match. Copy it again from your wallet.');
    return { type, details: { address } };
  }
  if (!/^[A-Z]{2}$/.test(country)) fail(400, 'Choose the country of the account.');
  if (type === 'bank') {
    const bank_name = need(b.bank_name, 2, 80, 'Add the bank name.');
    const account_number = String(b.account_number || '').replace(/[\s-]+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{6,34}$/.test(account_number)) fail(400, 'Check the account number: 6 to 34 letters and numbers, no symbols.');
    const account_name = need(b.account_name, 2, 80, 'Add the name on the account.');
    return { type, details: { bank_name, account_number, account_name, country } };
  }
  const provider = need(b.provider, 2, 40, 'Add the mobile money provider, for example M-Pesa or MTN MoMo.');
  const number = String(b.number || '').replace(/[\s().-]+/g, '');
  if (!/^\+?\d{7,15}$/.test(number)) fail(400, 'Check the phone number: 7 to 15 digits, with the country code.');
  const name = need(b.name, 2, 80, 'Add the name registered on the wallet.');
  return { type, details: { provider, number, name, country } };
}
/** Short, masked line for lists: "USDT (TRC20) · TXyz…9fQa". */
function methodSummary(type, d) {
  d = d || {};
  if (type === 'usdt_trc20') { const a = String(d.address || ''); return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a; }
  if (type === 'bank') return `${d.bank_name || 'Bank'} ••••${last4(d.account_number)}`;
  if (type === 'mobile_money') return `${d.provider || 'Wallet'} ••••${last4(d.number)}`;
  return '';
}
/** A method for display. `reveal` adds the full details (the owner of the method, or finance staff paying it). */
function methodView(type, details, reveal) {
  if (!type) return null;
  const d = typeof details === 'string' ? json(details, {}) : (details || {});
  return { type, label: METHOD_LABEL[type] || type, summary: methodSummary(type, d), country: d.country || '', details: reveal ? d : undefined };
}
function getMethod(userId, reveal = true) {
  const m = D.get('SELECT * FROM payout_methods WHERE user_id=?', userId);
  return m ? { ...methodView(m.type, m.details, reveal), updated_at: m.updated_at } : null;
}

/* ---------------- ledger ---------------- */
/** Products that never pay any commission (member referrals or affiliates). Kept in step with src/aff/core.js NOT_IN_PROGRAM. */
const NO_COMMISSION = ['affleego'];
function hubIds() { return D.all('SELECT id FROM products WHERE hub=1').map((r) => r.id); }

/** Every commissionable payment by the members `ids` referred, oldest first. */
function earningRows(ids) {
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const hubs = hubIds();
  const hubSql = hubs.length ? ` AND e.product_id NOT IN (${hubs.map(() => '?').join(',')})` : '';
  // t is the payment date, the same one revenue analytics and the affiliate engine use (events.created_at = the tool's
  // occurred_at as clamped by the Events API; money audit MN-7, MN-10). It decides which program pays a payment (before an
  // affiliate approval: member rules). s is when settling starts: when VooSquare received the event (received_at, which a
  // tool cannot backdate), or the payment date when that is later (allowed clock skew).
  const ev = D.all(`SELECT e.user_id, e.value_usd v, e.created_at t, MAX(e.created_at, COALESCE(e.received_at, e.created_at)) s, p.slug, p.name, p.icon, p.color FROM events e LEFT JOIN products p ON p.id=e.product_id
    WHERE e.type='spend' AND e.value_usd>0 AND e.value_usd<=${REV.MAX_VALUE} AND e.user_id IN (${ph})${hubSql}
    AND COALESCE(p.slug,'') NOT IN (${NO_COMMISSION.map(() => '?').join(',')})`, ...ids, ...hubs, ...NO_COMMISSION);
  const od = D.all(`SELECT user_id, amount_usd v, COALESCE(paid_at, created_at) t, item_type FROM orders WHERE status='paid' AND amount_usd>0 AND user_id IN (${ph})`, ...ids);
  const hub = D.get('SELECT slug, name, icon, color FROM products WHERE hub=1 ORDER BY id LIMIT 1') || { slug: 'voosquare', name: 'VooSquare', icon: 'voosquare', color: '#00A86B' };
  return [
    ...ev.filter((e) => Number.isFinite(e.v)).map((e) => ({ user_id: e.user_id, m: micro(e.v), t: e.t, s: e.s, key: e.slug || 'tool', name: e.name || 'Tool', icon: e.icon || '', color: e.color || '' })),
    ...od.map((o) => ({ user_id: o.user_id, m: micro(o.v), t: o.t, s: o.t, key: 'voosquare', name: hub.name, icon: hub.icon, color: hub.color, kind: o.item_type })),
  ].sort((a, b) => a.t - b.t);
}

/** The full earnings picture for one referrer. */
function ledger(userId, at = now()) {
  const cfg = settings();
  // SELECT * so optional columns (erased_at, added by src/features.js) are read when present.
  const referred = D.all('SELECT * FROM users WHERE referred_by=? ORDER BY id DESC', userId);
  // Banned referred members never earn their referrer anything while the ban lasts (see the header comment).
  // One ledger, no double commission: once the member is an approved affiliate, payments from the approval date on are paid by
  // the affiliate program (src/aff) instead. Earnings before that date stay on member rules.
  let affFrom = Infinity;
  try { const af = D.get("SELECT approved_at FROM aff_affiliates WHERE user_id=? AND status IN ('approved','suspended','closed') AND approved_at IS NOT NULL", userId); if (af) affFrom = af.approved_at; } catch { /* affiliate tables not created yet */ }
  const rows = earningRows(referred.filter((r) => !r.banned).map((r) => r.id)).filter((r) => r.t < affFrom);
  const bannedIds = referred.filter((r) => r.banned).map((r) => r.id);
  const exSpend = new Map();
  for (const r of earningRows(bannedIds)) exSpend.set(r.user_id, (exSpend.get(r.user_id) || 0) + r.m);
  const excluded = referred.filter((r) => r.banned).map((r) => ({ id: r.id, name: r.name, email: r.email, reason: r.erased_at ? 'erased' : 'banned', spend_usd: Math.round((exSpend.get(r.id) || 0) / 1e4) / 100 }));
  const payingIds = new Set(rows.map((r) => r.user_id));
  const paying = payingIds.size;
  const tier = tierFor(cfg.tiers, paying);
  const rate = paying ? tier.rate : 0;
  const settleMs = cfg.settle_days * DAY;
  // Amounts are whole micro-dollars (sub-cent tool spend such as $0.004 counts, like in revenue). Commission is summed
  // exactly as BigInt in micro-dollars x (rate% x 100), i.e. units of 1e-8 USD (1e-6 cent), and rounded down to cents
  // only at the end, so many small payments and huge values never drift.
  const R = BigInt(Math.round(rate * 100));
  const toC = (x) => Number(x / 100000000n);
  const mUsd = (m) => Math.round(Number(m) / 1e4) / 100;
  let spendM = 0n; let lifeX = 0n; let settledX = 0n; let next = null; const waiting = [];
  const perUser = new Map(); const perProduct = new Map();
  for (const r of rows) {
    const m = BigInt(r.m); const e = m * R;
    spendM += m; lifeX += e;
    const settles = (r.s || r.t) + settleMs;
    if (settles <= at) settledX += e;
    else if (e > 0n) waiting.push([settles, e]);
    perUser.set(r.user_id, (perUser.get(r.user_id) || 0n) + e);
    const p = perProduct.get(r.key) || { key: r.key, name: r.name, icon: r.icon, color: r.color, spend: 0n, earned: 0n, count: 0 };
    p.spend += m; p.earned += e; p.count++;
    perProduct.set(r.key, p);
  }
  const lifeC = toC(lifeX); const settledC = toC(settledX);
  // Next settle: everything that settles on the same calendar day (reporting time zone) as the earliest pending earning.
  if (waiting.length) {
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: REV.reportingTz() });
    const first = waiting.reduce((m, w) => (w[0] < m ? w[0] : m), Infinity);
    const k = fmt.format(first);
    next = { at: first, x: waiting.filter((w) => w[0] - first < 2 * DAY && fmt.format(w[0]) === k).reduce((a, w) => a + w[1], 0n) };
  }
  const sums = D.all("SELECT status, COALESCE(SUM(amount_usd),0) s, COUNT(*) n FROM payouts WHERE user_id=? GROUP BY status", userId);
  const sumOf = (list) => sums.filter((x) => list.includes(x.status)).reduce((a, x) => a + cents(x.s), 0);
  const paidC = sumOf(['paid']); const openC = sumOf(OPEN);
  const availC = Math.max(0, settledC - paidC - openC);
  // Paid or requested beyond what is settled now (a refund or a lower tier after a payout): new earnings repay this first.
  const owedC = Math.max(0, paidC + openC - settledC);
  const nextTier = cfg.tiers.find((t) => t.min > paying) || null;
  return {
    cfg, tier: { min: tier.min, rate: tier.rate }, rate, paying, referred, payingIds, excluded,
    next_tier: nextTier ? { min: nextTier.min, rate: nextTier.rate, need: nextTier.min - paying } : null,
    spend_usd: mUsd(spendM),
    balance: { lifetime: usd(lifeC), pending: usd(lifeC - settledC), settled: usd(settledC), available: usd(availC), paid: usd(paidC), open: usd(openC), owed: usd(owedC) },
    next_settle: next && toC(next.x) > 0 ? { at: next.at, amount: usd(toC(next.x)) } : null,
    per_user: new Map([...perUser].map(([k, x]) => [k, usd(toC(x))])),
    by_product: [...perProduct.values()].sort((a, b) => (b.earned > a.earned ? 1 : b.earned < a.earned ? -1 : b.spend > a.spend ? 1 : b.spend < a.spend ? -1 : 0)).map((p) => ({ ...p, spend: mUsd(p.spend), earned: usd(toC(p.earned)) })),
  };
}

/* ---------------- payouts ---------------- */
function payoutView(p, { reveal = false } = {}) {
  const m = json(p.method, {});
  return {
    id: p.id, amount_usd: p.amount_usd, status: p.status, reference: p.reference || '', note: p.note || '', rate: p.rate,
    requested_at: p.requested_at, decided_at: p.decided_at || null, paid_at: p.paid_at || null,
    method: methodView(m.type, m.details, reveal),
  };
}
const openPayout = (userId) => D.get(`SELECT * FROM payouts WHERE user_id=? AND status IN ('requested','processing') ORDER BY id DESC LIMIT 1`, userId);

/** What a member sees on their Referrals page (and GET /api/me/referrals). */
function memberStats(u, baseUrl) {
  const L = ledger(u.id);
  const open = openPayout(u.id);
  const method = getMethod(u.id, true);
  const avail = L.balance.available;
  const min = L.cfg.min_withdraw;
  return {
    code: u.ref_code, link: `${baseUrl}/r/${u.ref_code}`, referred: L.referred.length, paying: L.paying,
    rate: L.tier.rate, tier: L.tier, tiers: L.cfg.tiers, next_tier: L.next_tier,
    spend_usd: L.spend_usd, earned_usd: L.balance.lifetime, balance: L.balance, next_settle: L.next_settle,
    min_withdraw: min, settle_days: L.cfg.settle_days, terms: L.cfg.terms,
    // New settled earnings still needed: any amount owed (see ledger) first, then up to the minimum.
    to_go: Math.max(0, usd(cents(min) + cents(L.balance.owed) - cents(avail))),
    can_request: !open && avail > 0 && avail >= min,
    method, open_payout: open ? payoutView(open) : null,
    payouts: D.all('SELECT * FROM payouts WHERE user_id=? ORDER BY requested_at DESC, id DESC LIMIT 30', u.id).map((p) => payoutView(p)),
    // Totals only: no emails and no per-product amounts for the people a member referred.
    people: L.referred.slice(0, 60).map((r) => ({ name: r.name, avatar: json(r.avatar, {}), premium: (r.premium_until || 0) > now(), paying: L.payingIds.has(r.id), joined: r.created_at, earned_usd: L.per_user.get(r.id) || 0, ...(r.banned ? { excluded: true } : {}) })),
  };
}

/** Create a payout request for the full available balance. Throws on any rule. Returns the new payout row. */
function request(u) {
  return D.tx(() => {
    if (openPayout(u.id)) fail(409, 'You already have a payout request open. Wait for it to be paid, or cancel it first.');
    const m = D.get('SELECT * FROM payout_methods WHERE user_id=?', u.id);
    if (!m) fail(400, 'Add your payout details first.');
    const L = ledger(u.id);
    const avail = L.balance.available;
    if (!(avail > 0) || avail < L.cfg.min_withdraw) fail(400, `You can request a payout once your available balance reaches $${L.cfg.min_withdraw.toLocaleString('en-US')}.`);
    let id;
    try {
      id = D.insert('payouts', { user_id: u.id, amount_usd: avail, method: JSON.stringify({ type: m.type, details: json(m.details, {}) }), status: 'requested', rate: L.tier.rate, requested_at: now() }).id;
    } catch (e) {
      if (/UNIQUE/i.test(String(e.message))) fail(409, 'You already have a payout request open.');
      throw e;
    }
    return D.get('SELECT * FROM payouts WHERE id=?', id);
  });
}

module.exports = {
  NO_COMMISSION,
  DEFAULT_TERMS, METHOD_LABEL, OPEN, STATUSES, settings, cleanSetting, tierFor, cleanMethod, methodSummary, methodView, getMethod,
  ledger, memberStats, payoutView, openPayout, request, cents, usd, tronOk,
};
