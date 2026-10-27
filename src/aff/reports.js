'use strict';
/*
 * Affiliate reporting: KPI tiles, grouped reports (day/week/month/product/sub1..sub5/country/device/source), conversion log,
 * customers (pseudonymous references only), cohorts and repeat-purchase stats, refunds, CPA tab, top sub IDs, earnings
 * series and the admin overview. Days and months are cut in the reporting time zone (Africa/Lagos by default).
 */
const D = require('../db');
const C = require('./core');
const E = require('./engine');
const { now } = require('../util');

const DAY = C.DAY;
/*
 * Commission in reports, KPI tiles and the admin overview (money audit MN-5, MN-6): grouped by the date it belongs to
 * (earned_at: the payment date for RevShare, the approval date for CPA, the reversal date for clawbacks; migration 007),
 * not by when the row was written, so a late-reported payment lands in its payment month like revenue and qualification.
 * Only earned amounts count: available, paid, on hold and waiting for activation (what the balance calls lifetime). CPA
 * still in review is not earned yet (shown separately); declined and reversed lines never count.
 */
const EARNED = "('available','paid','hold','pending_activation')";
const EAT = 'COALESCE(earned_at, created_at)';
/* "Commission" everywhere in reporting (affiliate KPIs, reports and reports.csv, the dashboard chart, admin Commission MTD,
 * affiliates.csv and the admin overview) means commission earned from customers, WITHOUT manual balance adjustments
 * (back office → Adjustments: type 'adjustment', or a negative one stored as a clawback with an 'adj:' key). Adjustments
 * are money the team moved by hand, not performance, so every surface shows them as their own figure ("Adjustments",
 * adjustments_cents / adjustments_mtd_cents / adjustments_usd / adjustments_mtd_usd) next to commission (QA-7, SV-1).
 * Balances, ledgers, statements and payouts are not reports and keep them. */
const MANUAL_ADJ = "(type='adjustment' OR COALESCE(uniq_key,'') LIKE 'adj:%')";
const MANUAL_ADJ_M = "(m.type='adjustment' OR COALESCE(m.uniq_key,'') LIKE 'adj:%')";
const EVENT_LABEL = { registration: 'Sign-up', first_payment: 'First payment', repeat_payment: 'Payment', qualified: 'Qualified FTD', cpa: 'CPA', refund: 'Refund', refund_final: 'Refund by the tool (commission final)', chargeback: 'Chargeback', plan_started: 'Plan started', plan_renewed: 'Plan renewed', wallet_topup: 'Wallet top-up' };

/* ------------------------------------------------------------------ ranges */
function range(q = {}, at = now()) {
  const day0 = C.dayStartAt(at);
  const parseDay = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? C.dayStartAt(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null; };
  if (q.from || q.to) {
    const from = parseDay(q.from) ?? day0 - 29 * DAY; const to = (parseDay(q.to) ?? day0) + DAY;
    if (to <= from || to - from > 800 * DAY) C.fail(400, 'Choose a range of up to 800 days.');
    return { from, to: Math.min(to, at + 1), key: 'custom' };
  }
  const p = q.period || q.range || '30d';
  const mk = C.monthKey(at);
  switch (p) {
    case 'today': return { from: day0, to: at + 1, key: p, prev: { from: day0 - DAY, to: at + 1 - DAY } };
    case 'yesterday': return { from: day0 - DAY, to: day0, key: p, prev: { from: day0 - 2 * DAY, to: day0 - DAY } };
    case 'month': { const ms = C.monthStartOf(mk); const pm = C.monthStartOf(C.addMonths(mk, -1)); return { from: ms, to: at + 1, key: p, prev: { from: pm, to: pm + (at + 1 - ms) } }; }
    case 'last': { const [f, t] = C.monthRange(C.addMonths(mk, -1)); const [pf, pt] = C.monthRange(C.addMonths(mk, -2)); return { from: f, to: t, key: p, prev: { from: pf, to: pt } }; }
    case '7d': return { from: day0 - 6 * DAY, to: at + 1, key: p, prev: { from: day0 - 13 * DAY, to: day0 - 6 * DAY } };
    case '90d': return { from: day0 - 89 * DAY, to: at + 1, key: p, prev: { from: day0 - 179 * DAY, to: day0 - 89 * DAY } };
    case 'all': return { from: 0, to: at + 1, key: p };
    default: return { from: day0 - 29 * DAY, to: at + 1, key: '30d', prev: { from: day0 - 59 * DAY, to: day0 - 29 * DAY } };
  }
}

/* ------------------------------------------------------------------ KPIs */
function totals(affId, from, to) {
  const one = (sql, ...a) => D.get(sql, ...a);
  const clicks = one('SELECT COUNT(*) n, COUNT(DISTINCT ip_hash || ua_hash) u FROM aff_clicks WHERE affiliate_id=? AND created_at>=? AND created_at<?', affId, from, to);
  const signups = one('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>=? AND locked_at<?', affId, from, to).n;
  const paying = one('SELECT COUNT(*) n FROM aff_customers WHERE affiliate_id=? AND first_payment_at>=? AND first_payment_at<?', affId, from, to).n;
  const qualified = E.qualifiedCount(affId, from, to);
  const rev = one("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(*) n FROM aff_conversions WHERE affiliate_id=? AND event_type IN ('first_payment','repeat_payment') AND occurred_at>=? AND occurred_at<?", affId, from, to);
  const back = one("SELECT COALESCE(SUM(amount_cents),0) s, COUNT(CASE WHEN event_type='refund' THEN 1 END) r, COUNT(CASE WHEN event_type='chargeback' THEN 1 END) c FROM aff_conversions WHERE affiliate_id=? AND event_type IN ('refund','chargeback') AND occurred_at>=? AND occurred_at<?", affId, from, to);
  const comAll = one(`SELECT COALESCE(SUM(CASE WHEN ${MANUAL_ADJ} THEN 0 ELSE amount_cents END),0) s, COALESCE(SUM(CASE WHEN ${MANUAL_ADJ} THEN amount_cents ELSE 0 END),0) a FROM aff_commissions WHERE affiliate_id=? AND ${EAT}>=? AND ${EAT}<? AND status IN ${EARNED}`, affId, from, to);
  const com = comAll.s;
  const rr = E.refundRate(affId, from, to);
  return {
    clicks: clicks.n, unique_clicks: clicks.u, signups, paying, qualified, payments: rev.n, revenue_cents: rev.s - back.s, gross_revenue_cents: rev.s, refunds: back.r, chargebacks: back.c,
    commission_cents: com, adjustments_cents: comAll.a, signup_rate: clicks.n ? Math.round((10000 * signups) / clicks.n) / 100 : 0, epc_cents: clicks.n ? Math.round(com / clicks.n) : 0, refund_rate: rr.rate_bp / 100,
  };
}
function kpis(affId, period = 'today', at = now()) {
  const r = range({ period }, at);
  const cur = totals(affId, r.from, r.to);
  if (!r.prev) return { ...cur, period: r.key, from: r.from, to: r.to };
  const prev = totals(affId, r.prev.from, r.prev.to);
  const change = {};
  for (const k of ['clicks', 'signups', 'paying', 'qualified', 'revenue_cents', 'commission_cents', 'epc_cents']) change[k] = prev[k] ? Math.round((1000 * (cur[k] - prev[k])) / Math.abs(prev[k])) / 10 : null;
  return { ...cur, period: r.key, from: r.from, to: r.to, previous: prev, change };
}

/* ------------------------------------------------------------------ grouped report */
const SOURCE = [[/facebook|fb\.|instagram|messenger|meta/i, 'Meta'], [/tiktok/i, 'TikTok'], [/t\.me|telegram/i, 'Telegram'], [/youtube|youtu\.be/i, 'YouTube'], [/google/i, 'Google'], [/snapchat/i, 'Snapchat'], [/twitter|x\.com|t\.co/i, 'X'], [/whatsapp|wa\.me/i, 'WhatsApp']];
const sourceOf = (ref) => { if (!ref) return 'Direct or app'; for (const [re, n] of SOURCE) if (re.test(ref)) return n; return ref; };
const GROUPS = ['day', 'week', 'month', 'product', 'sub1', 'sub2', 'sub3', 'sub4', 'sub5', 'country', 'device', 'source'];
function report(affId, q = {}, at = now()) {
  const r = range(q, at);
  const group = GROUPS.includes(q.group) ? q.group : 'day';
  const f = { product: q.product ? String(q.product) : '', country: q.country ? String(q.country).toUpperCase() : '', device: q.device ? String(q.device) : '' };
  for (let i = 1; i <= 5; i++) if (q['sub' + i]) f['sub' + i] = String(q['sub' + i]);
  // Time buckets by local day edges.
  const edges = []; const labels = [];
  if (['day', 'week', 'month'].includes(group)) {
    let t = C.dayStartAt(r.from); let guard = 0;
    while (t < r.to && guard++ < 1000) {
      const key = C.dayKey(t + 3 * C.HOUR);
      let next;
      if (group === 'day') next = C.dayStartAt(t + DAY + 3 * C.HOUR);
      else if (group === 'week') { const wd = (new Date(Date.parse(key + 'T12:00:00Z')).getUTCDay() + 6) % 7; next = C.dayStartAt(t + (7 - wd) * DAY + 3 * C.HOUR); }
      else next = C.monthStartOf(C.addMonths(key.slice(0, 7), 1));
      edges.push(t); labels.push(group === 'month' ? key.slice(0, 7) : key); t = next;
    }
    edges.push(t);
  }
  const bucket = (t) => { if (!edges.length) return null; if (t < edges[0] || t >= edges[edges.length - 1]) return null; let lo = 0; let hi = edges.length - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (edges[mid] <= t) lo = mid; else hi = mid - 1; } return labels[lo]; };
  const keyOf = (row) => (edges.length ? bucket(row.t) : group === 'product' ? row.product_key || 'other' : group === 'source' ? sourceOf(row.referrer) : row[group] || '(none)');
  const pass = (row) => (!f.product || row.product_key === f.product) && (!f.country || row.country === f.country) && (!f.device || row.device === f.device) && [1, 2, 3, 4, 5].every((i) => !f['sub' + i] || row['sub' + i] === f['sub' + i]);
  const acc = new Map();
  const blank = (k) => ({ key: k, clicks: 0, unique: new Set(), signups: 0, paying: 0, qualified: 0, revenue_cents: 0, commission_cents: 0, adjustments_cents: 0, refunds: 0, chargebacks: 0 });
  const add = (row, field, v = 1) => { if (!pass(row)) return; const k = keyOf(row); if (k === null) return; const o = acc.get(k) || blank(k); if (field === 'unique') o.unique.add(v); else o[field] += v; acc.set(k, o); };
  const SUBS = 'sub1, sub2, sub3, sub4, sub5';
  for (const x of D.all(`SELECT created_at t, product_key, ${SUBS}, country, device, referrer, ip_hash || ua_hash u FROM aff_clicks WHERE affiliate_id=? AND created_at>=? AND created_at<?`, affId, r.from, r.to)) { add(x, 'clicks'); add(x, 'unique', x.u); }
  const ATTR = `t.sub1, t.sub2, t.sub3, t.sub4, t.sub5, t.country, t.device, k.referrer`;
  for (const x of D.all(`SELECT t.locked_at t, COALESCE(k.product_key,'') product_key, ${ATTR} FROM aff_attributions t LEFT JOIN aff_clicks k ON k.id=t.click_id WHERE t.affiliate_id=? AND t.locked_at>=? AND t.locked_at<?`, affId, r.from, r.to)) add(x, 'signups');
  for (const x of D.all(`SELECT c.first_payment_at t, c.first_product product_key, ${ATTR} FROM aff_customers c JOIN aff_attributions t ON t.customer_user_id=c.user_id LEFT JOIN aff_clicks k ON k.id=t.click_id WHERE c.affiliate_id=? AND c.first_payment_at>=? AND c.first_payment_at<?`, affId, r.from, r.to)) add(x, 'paying');
  for (const x of D.all(`SELECT c.qualified_at t, c.first_product product_key, ${ATTR} FROM aff_customers c JOIN aff_attributions t ON t.customer_user_id=c.user_id LEFT JOIN aff_clicks k ON k.id=t.click_id WHERE c.affiliate_id=? AND t.blocked='' AND c.qualified_at>=? AND c.qualified_at<?`, affId, r.from, r.to)) add(x, 'qualified');
  for (const x of D.all(`SELECT v.occurred_at t, v.product_key, v.event_type, v.amount_cents a, ${ATTR} FROM aff_conversions v JOIN aff_attributions t ON t.customer_user_id=v.customer_user_id LEFT JOIN aff_clicks k ON k.id=t.click_id WHERE v.affiliate_id=? AND v.event_type IN ('first_payment','repeat_payment','refund','chargeback') AND v.occurred_at>=? AND v.occurred_at<?`, affId, r.from, r.to)) {
    if (x.event_type === 'refund' || x.event_type === 'chargeback') { add(x, 'revenue_cents', -x.a); add(x, x.event_type === 'refund' ? 'refunds' : 'chargebacks'); } else add(x, 'revenue_cents', x.a);
  }
  for (const x of D.all(`SELECT COALESCE(m.earned_at, m.created_at) t, m.product_key, m.amount_cents a, ${ATTR} FROM aff_commissions m LEFT JOIN aff_attributions t ON t.customer_user_id=m.customer_user_id LEFT JOIN aff_clicks k ON k.id=t.click_id WHERE m.affiliate_id=? AND COALESCE(m.earned_at, m.created_at)>=? AND COALESCE(m.earned_at, m.created_at)<? AND m.status IN ${EARNED} AND NOT ${MANUAL_ADJ_M}`, affId, r.from, r.to)) add(x, 'commission_cents', x.a);
  // Manual adjustments are not tied to a product, sub ID, country or device: by date they land in their day/week/month row;
  // grouped any other way (or filtered) they appear in the total only, never inside a product or sub ID row.
  const filtered = Object.values(f).some(Boolean);
  let adjTotal = 0;
  if (!filtered) {
    for (const x of D.all(`SELECT ${EAT} t, amount_cents a FROM aff_commissions WHERE affiliate_id=? AND ${MANUAL_ADJ} AND ${EAT}>=? AND ${EAT}<? AND status IN ${EARNED}`, affId, r.from, r.to)) {
      adjTotal += x.a;
      if (edges.length) { const k = bucket(x.t); if (k !== null) { const o = acc.get(k) || blank(k); o.adjustments_cents += x.a; acc.set(k, o); } }
    }
  }
  const order = edges.length ? labels : null;
  const rows = (order ? order.map((k) => acc.get(k) || blank(k)) : [...acc.values()].sort((a, b) => b.commission_cents - a.commission_cents || b.clicks - a.clicks))
    .map((o) => ({
      key: o.key, clicks: o.clicks, unique_clicks: o.unique.size, signups: o.signups, signup_rate: o.clicks ? Math.round((10000 * o.signups) / o.clicks) / 100 : 0, new_paying: o.paying, qualified: o.qualified,
      revenue_cents: o.revenue_cents, commission_cents: o.commission_cents, adjustments_cents: o.adjustments_cents, refunds: o.refunds, chargebacks: o.chargebacks, refund_rate: o.paying ? Math.round((10000 * (o.refunds + o.chargebacks)) / o.paying) / 100 : 0,
      epc_cents: o.clicks ? Math.round(o.commission_cents / o.clicks) : 0,
    }));
  const SUMK = ['clicks', 'unique_clicks', 'signups', 'new_paying', 'qualified', 'revenue_cents', 'commission_cents', 'refunds', 'chargebacks'];
  const sum = rows.reduce((s, x) => { for (const k of SUMK) s[k] += x[k]; return s; }, Object.fromEntries(SUMK.map((k) => [k, 0])));
  sum.adjustments_cents = adjTotal;
  sum.signup_rate = sum.clicks ? Math.round((10000 * sum.signups) / sum.clicks) / 100 : 0; sum.epc_cents = sum.clicks ? Math.round(sum.commission_cents / sum.clicks) : 0;
  return { group, from: r.from, to: r.to, filters: f, rows, total: sum };
}
function reportCsv(affId, q, at) {
  const r = report(affId, q, at);
  const cols = ['key', 'clicks', 'unique_clicks', 'signups', 'signup_rate', 'new_paying', 'qualified', 'revenue_usd', 'commission_usd', 'adjustments_usd', 'refunds', 'chargebacks', 'refund_rate', 'epc_usd'];
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const line = (x) => [x.key, x.clicks, x.unique_clicks, x.signups, x.signup_rate, x.new_paying, x.qualified, C.usd(x.revenue_cents).toFixed(2), C.usd(x.commission_cents).toFixed(2), C.usd(x.adjustments_cents || 0).toFixed(2), x.refunds, x.chargebacks, x.refund_rate, C.usd(x.epc_cents).toFixed(2)].map(cell).join(',');
  return [[r.group, ...cols.slice(1)].join(','), ...r.rows.map(line), line({ ...r.total, key: 'Total', refund_rate: '' })].join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------------ lists */
function conversions(affId, q = {}, at = now()) {
  const r = range({ period: q.period || '90d', from: q.from, to: q.to }, at);
  const where = ['v.affiliate_id=?', 'v.occurred_at>=?', 'v.occurred_at<?']; const args = [affId, r.from, r.to];
  if (q.event) { where.push('v.event_type=?'); args.push(String(q.event)); }
  if (q.status) { where.push('v.status=?'); args.push(String(q.status)); }
  if (q.product) { where.push('v.product_key=?'); args.push(String(q.product)); }
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100)); const offset = Math.max(0, Number(q.offset) || 0);
  const rows = D.all(`SELECT v.*, t.cust_ref, t.sub1, t.sub2, t.sub3, t.sub4, t.sub5, t.device, t.country attr_country,
    (SELECT COALESCE(SUM(m.amount_cents),0) FROM aff_commissions m WHERE m.conversion_id=v.id AND m.status NOT IN ('declined','reversed')) com,
    (SELECT decline_reason FROM aff_cpa_reviews w WHERE w.conversion_id=v.id) reason
    FROM aff_conversions v LEFT JOIN aff_attributions t ON t.customer_user_id=v.customer_user_id WHERE ${where.join(' AND ')} ORDER BY v.occurred_at DESC, v.id DESC LIMIT ? OFFSET ?`, ...args, limit, offset);
  const total = D.get(`SELECT COUNT(*) n FROM aff_conversions v WHERE ${where.join(' AND ')}`, ...args).n;
  return {
    total, conversions: rows.map((v) => ({
      id: 'CV-' + v.id, conversion_id: v.id, at: v.occurred_at, product_key: v.product_key, plan: v.plan, event: v.event_type, event_label: EVENT_LABEL[v.event_type] || v.event_type,
      amount_cents: ['registration', 'qualified'].includes(v.event_type) ? 0 : v.amount_cents, status: v.status, commission_cents: v.event_type === 'refund' || v.event_type === 'chargeback' ? -(v.reversed_cents || 0) : v.com,
      reason: v.reason || '', reason_text: v.reason ? E.DECLINE[v.reason] || '' : '', customer_ref: v.cust_ref || '', sub1: v.sub1 || '', sub2: v.sub2 || '', country: v.country || v.attr_country || '', device: v.device || '',
    })),
  };
}
function customers(affId, q = {}) {
  const limit = Math.min(500, Math.max(1, Number(q.limit) || 100)); const offset = Math.max(0, Number(q.offset) || 0);
  const rows = D.all(`SELECT t.*, c.first_payment_at, c.first_product, c.first_plan, c.payments, c.total_cents, c.refunded_cents, c.refunds, c.chargebacks, c.qualified_at, c.model, c.last_payment_at,
    (SELECT COALESCE(SUM(m.amount_cents),0) FROM aff_commissions m WHERE m.customer_user_id=t.customer_user_id AND m.affiliate_id=t.affiliate_id AND m.status NOT IN ('declined','reversed')) com,
    (SELECT GROUP_CONCAT(DISTINCT v.product_key) FROM aff_conversions v WHERE v.customer_user_id=t.customer_user_id AND v.event_type IN ('first_payment','repeat_payment')) prods, u.banned
    FROM aff_attributions t LEFT JOIN aff_customers c ON c.user_id=t.customer_user_id JOIN users u ON u.id=t.customer_user_id WHERE t.affiliate_id=? ${q.paying ? 'AND c.first_payment_at IS NOT NULL' : ''}
    ORDER BY COALESCE(c.last_payment_at, t.locked_at) DESC LIMIT ? OFFSET ?`, affId, limit, offset);
  const total = D.get(`SELECT COUNT(*) n FROM aff_attributions t LEFT JOIN aff_customers c ON c.user_id=t.customer_user_id WHERE t.affiliate_id=? ${q.paying ? 'AND c.first_payment_at IS NOT NULL' : ''}`, affId).n;
  return {
    total, customers: rows.map((r) => ({
      customer_ref: r.cust_ref, country: r.country, signed_up_at: r.locked_at, acquired_at: r.first_payment_at || null, products: r.prods ? r.prods.split(',') : [], plan: r.first_plan || '',
      payments: r.payments || 0, net_paid_cents: (r.total_cents || 0) - (r.refunded_cents || 0), commission_cents: r.com, qualified_at: r.qualified_at || null, model: r.model || '',
      status: r.blocked ? 'excluded' : r.banned ? 'excluded' : r.chargebacks ? 'charged_back' : r.refunds && r.refunded_cents >= r.total_cents ? 'refunded' : r.qualified_at ? 'qualified' : r.first_payment_at ? 'paying' : 'signed_up',
      method: r.method, sub1: r.sub1,
    })),
  };
}
function cohorts(affId, at = now(), months = 6) {
  const out = [];
  const M = C.monthKey(at);
  for (let i = months - 1; i >= 0; i--) {
    const key = C.addMonths(M, -i); const [from, to] = C.monthRange(key);
    const ids = D.all('SELECT user_id FROM aff_customers WHERE affiliate_id=? AND first_payment_at>=? AND first_payment_at<?', affId, from, to).map((r) => r.user_id);
    const rev = [];
    for (let j = 0; j <= i; j++) {
      const [f2, t2] = C.monthRange(C.addMonths(key, j));
      if (!ids.length) { rev.push(0); continue; }
      const ph = ids.map(() => '?').join(',');
      const s = D.get(`SELECT COALESCE(SUM(CASE WHEN event_type IN ('refund','chargeback') THEN -amount_cents ELSE amount_cents END),0) s FROM aff_conversions WHERE customer_user_id IN (${ph}) AND event_type IN ('first_payment','repeat_payment','refund','chargeback') AND occurred_at>=? AND occurred_at<?`, ...ids, f2, t2).s;
      rev.push(s);
    }
    out.push({ month: key, customers: ids.length, revenue_cents: rev });
  }
  return out;
}
function repeatStats(affId) {
  const r = D.get('SELECT COUNT(*) n, COALESCE(SUM(payments),0) p, COUNT(CASE WHEN payments>=2 THEN 1 END) rebill, COALESCE(SUM(total_cents-refunded_cents),0) net FROM aff_customers WHERE affiliate_id=? AND first_payment_at IS NOT NULL', affId);
  return {
    paying_customers: r.n, payments: r.p, repeat_payments: Math.max(0, r.p - r.n), payments_per_customer: r.n ? Math.round((100 * r.p) / r.n) / 100 : 0,
    rebill_rate: r.n ? Math.round((10000 * r.rebill) / r.n) / 100 : 0, revenue_per_customer_cents: r.n ? Math.round(r.net / r.n) : 0,
  };
}
function refunds(affId, limit = 50) {
  return D.all(`SELECT v.*, t.cust_ref FROM aff_conversions v LEFT JOIN aff_attributions t ON t.customer_user_id=v.customer_user_id WHERE v.affiliate_id=? AND v.event_type IN ('refund','chargeback') ORDER BY v.occurred_at DESC LIMIT ?`, affId, limit)
    .map((v) => ({ at: v.occurred_at, customer_ref: v.cust_ref || '', product_key: v.product_key, type: v.event_type === 'refund' ? 'Refund' : 'Chargeback', amount_cents: v.amount_cents, reversed_cents: -(v.reversed_cents || 0), status: v.reversed_cents ? 'Reversed' : 'No change' }));
}
function cpa(affId, at = now()) {
  const [ms, me] = C.monthRange(C.monthKey(at));
  const rows = D.all(`SELECT w.*, t.cust_ref, m.hold_until, m.status com_status, c.qualified_at FROM aff_cpa_reviews w LEFT JOIN aff_attributions t ON t.customer_user_id=w.customer_user_id LEFT JOIN aff_commissions m ON m.id=w.commission_id LEFT JOIN aff_customers c ON c.user_id=w.customer_user_id
    WHERE w.affiliate_id=? ORDER BY w.id DESC LIMIT 200`, affId);
  const st = D.get(`SELECT COUNT(CASE WHEN status='approved' AND decided_at>=? AND decided_at<? THEN 1 END) approved, COUNT(CASE WHEN status='pending' THEN 1 END) review,
    COUNT(CASE WHEN status='declined' AND decided_at>=? AND decided_at<? THEN 1 END) declined, COALESCE(SUM(CASE WHEN status='approved' AND decided_at>=? AND decided_at<? THEN amount_cents END),0) earned FROM aff_cpa_reviews WHERE affiliate_id=?`, ms, me, ms, me, ms, me, affId);
  return {
    stats: { approved_month: st.approved, in_review: st.review, declined_month: st.declined, cpa_earned_month_cents: st.earned },
    deals: D.all("SELECT * FROM aff_deals WHERE affiliate_id=? AND status IN ('active','paused') AND model IN ('cpa','hybrid') ORDER BY id DESC", affId).map(dealView),
    conversions: rows.map((w) => ({ id: 'CV-' + w.conversion_id, product_key: w.product_key, plan: w.plan, amount_cents: w.amount_cents, model: w.model, status: w.status === 'pending' ? 'in_review' : w.status,
      reason: w.decline_reason, reason_text: w.decline_reason ? E.DECLINE[w.decline_reason] : '', note: w.status === 'declined' ? w.note : '', customer_ref: w.cust_ref || '', qualified_at: w.qualified_at, decided_at: w.decided_at, hold_until: w.status === 'approved' ? w.hold_until : null })),
  };
}
function dealView(d) {
  const pending = D.get('SELECT * FROM aff_offer_changes WHERE deal_id=? AND applied_at IS NULL ORDER BY effective_at LIMIT 1', d.id);
  return { id: d.id, product_key: d.product_key, plan: d.plan, model: d.model, cpa_cents: d.cpa_cents, rate_bp: d.rate_bp, monthly_cap: d.monthly_cap, traffic: C.json(d.traffic, []), geos: C.json(d.geos, []), starts_at: d.starts_at, ends_at: d.ends_at || null, status: d.status,
    scheduled: pending ? { field: pending.field, from: pending.old_value, to: pending.new_value, effective_at: pending.effective_at } : null,
    special: !!d.special || (d.model === 'revshare' && d.rate_bp > C.HARD_CAP_BP), duration: d.duration || (d.model === 'revshare' ? (d.ends_at ? 'until' : 'forever') : ''), all_products: d.product_key === '*' };
}
function topSubs(affId, at = now(), limit = 10) {
  const r = report(affId, { period: 'month', group: 'sub1' }, at);
  return r.rows.filter((x) => x.key !== '(none)').slice(0, limit);
}
/** Daily series for charts. commission_cents never includes manual adjustments; adjustments_cents carries them. */
function series(affId, days = 30, at = now()) {
  const r = report(affId, { from: C.dayKey(at - (days - 1) * DAY), to: C.dayKey(at), group: 'day' }, at);
  return r.rows.map((x) => ({ day: x.key, clicks: x.clicks, signups: x.signups, qualified: x.qualified, revenue_cents: x.revenue_cents, commission_cents: x.commission_cents, adjustments_cents: x.adjustments_cents }));
}
function byProduct(affId, q = {}, at = now()) { return report(affId, { ...q, group: 'product' }, at).rows; }

/* ------------------------------------------------------------------ admin */
/** Monthly figures per affiliate (for lists): qualified MTD, commission MTD, refund rate (2 months). */
function affiliateMonth(affId, at = now()) {
  const [ms] = C.monthRange(C.monthKey(at));
  const me = C.monthRange(C.monthKey(at))[1];
  const sum = (extra) => D.get(`SELECT COALESCE(SUM(amount_cents),0) s FROM aff_commissions WHERE affiliate_id=? AND ${EAT}>=? AND ${EAT}<? AND status IN ${EARNED} AND ${extra}`, affId, ms, me).s;
  const com = sum(`NOT ${MANUAL_ADJ}`); const adj = sum(MANUAL_ADJ);
  const rr = E.refundRate(affId, C.monthStartOf(C.addMonths(C.monthKey(at), -1)), at + 1);
  return { qualified_mtd: E.qualifiedCount(affId, ms, at + 1), commission_mtd_cents: com, adjustments_mtd_cents: adj, refund_rate: rr.rate_bp / 100 };
}
function overview(at = now()) {
  const M = C.monthKey(at); const [ms] = C.monthRange(M); const [pms] = C.monthRange(C.addMonths(M, -1));
  const sla = C.settings().approval_sla_days * DAY;
  const cnt = (sql, ...a) => D.get(sql, ...a).n;
  const revenue = (from, to) => D.get("SELECT COALESCE(SUM(CASE WHEN event_type IN ('refund','chargeback') THEN -amount_cents ELSE amount_cents END),0) s FROM aff_conversions WHERE event_type IN ('first_payment','repeat_payment','refund','chargeback') AND occurred_at>=? AND occurred_at<?", from, to).s;
  // Revenue this month: every payment dated in this Lagos month, also one a tool dated a few minutes ahead (allowed clock
  // skew), like revenue analytics (one payment date everywhere, MN-10).
  const rev = revenue(ms, C.monthRange(M)[1]); const prevRev = revenue(pms, pms + (at + 1 - ms));
  const comAll = D.get(`SELECT COALESCE(SUM(CASE WHEN ${MANUAL_ADJ} THEN 0 ELSE amount_cents END),0) s, COALESCE(SUM(CASE WHEN ${MANUAL_ADJ} THEN amount_cents ELSE 0 END),0) a FROM aff_commissions WHERE ${EAT}>=? AND ${EAT}<? AND status IN ${EARNED}`, ms, C.monthRange(M)[1]);
  const com = comAll.s;
  const due = D.get("SELECT COUNT(*) n, COALESCE(SUM(amount_cents),0) s, COUNT(CASE WHEN amount_cents>? THEN 1 END) big FROM aff_payouts WHERE status IN ('requested','approved','processing')", C.settings().payouts.four_eyes_cents);
  const oldest = D.get("SELECT MIN(created_at) t FROM aff_cpa_reviews WHERE status='pending'").t;
  const T = C.tiers();
  const byTier = T.map((t) => ({ tier: t.name, rate_bp: t.rate_bp, count: 0 }));
  for (const a of D.all("SELECT * FROM aff_affiliates WHERE status='approved'").map(C.hydrate)) byTier[C.effectiveTier(a, at)].count++;
  const days = [];
  for (let i = 29; i >= 0; i--) { const f = C.dayStartAt(at - i * DAY); days.push({ day: C.dayKey(f + 3 * C.HOUR), revenue_cents: revenue(f, f + DAY) }); }
  const top = D.all(`SELECT a.id, COUNT(c.user_id) q FROM aff_affiliates a LEFT JOIN aff_customers c ON c.affiliate_id=a.id AND c.qualified_at>=? WHERE a.status='approved' GROUP BY a.id ORDER BY q DESC LIMIT 6`, ms);
  return {
    active: cnt("SELECT COUNT(*) n FROM aff_affiliates WHERE status='approved'"), new_this_month: cnt("SELECT COUNT(*) n FROM aff_affiliates WHERE status='approved' AND approved_at>=?", ms),
    paused: cnt("SELECT COUNT(*) n FROM aff_affiliates WHERE status='suspended'"), closed: cnt("SELECT COUNT(*) n FROM aff_affiliates WHERE status='closed'"),
    pending: cnt("SELECT COUNT(*) n FROM aff_affiliates WHERE status='pending' AND applied_at IS NOT NULL"), overdue: cnt("SELECT COUNT(*) n FROM aff_affiliates WHERE status='pending' AND applied_at IS NOT NULL AND applied_at<?", at - sla),
    cpa_in_review: cnt("SELECT COUNT(*) n FROM aff_cpa_reviews WHERE status='pending'"), cpa_oldest_at: oldest || null,
    revenue_mtd_cents: rev, revenue_change_pct: prevRev ? Math.round((1000 * (rev - prevRev)) / Math.abs(prevRev)) / 10 : null, commission_mtd_cents: com, adjustments_mtd_cents: comAll.a, commission_share_pct: rev ? Math.round((1000 * com) / rev) / 10 : 0,
    payouts_due: { count: due.n, amount_cents: due.s, four_eyes: due.big }, by_tier: byTier, revenue_series: days, top: top.map((r) => r.id),
  };
}

module.exports = { EARNED, range, totals, kpis, report, reportCsv, conversions, customers, cohorts, repeatStats, refunds, cpa, dealView, topSubs, series, byProduct, affiliateMonth, overview, EVENT_LABEL, GROUPS, sourceOf };
