'use strict';
/*
 * Revenue reporting. Two sources, reported in USD:
 *  - VooSquare sales: orders with status 'paid' (Premium and paid rooms), at paid_at, amount_usd.
 *    Pending, in-review, failed, refunded and cancelled orders never count.
 *  - Tool revenue: `spend` events a Zedapex tool reports through the Events API (value_usd > 0), at occurred_at
 *    (stored in events.created_at), per product. Labelled "Reported by tool". Other event types are ignored.
 *    Events from the hub product itself are ignored so VooSquare sales are never counted twice.
 * Days, weeks (Monday start) and months are cut in the reporting time zone (setting `reporting_tz`, default Africa/Lagos).
 * Rows are fetched by UTC bounds and grouped in JS with binary search over the bucket edges: fast up to ~500k rows.
 */
const D = require('./db');
const { fail, json, now } = require('./util');

const DAY = 86400_000;
const DEFAULT_TZ = 'Africa/Lagos';
const MAX_DAYS = 366 * 3; // three years
const MAX_DAY_BUCKETS = 400;
/* Spend events above this (or Infinity, stored before the Events API checked) are ignored as bad data. */
const MAX_VALUE = 1e9;
const GROUPS = ['day', 'week', 'month'];

/* Chart colours per product, validated as one categorical palette (adjacent pairs, light surface) in this stack order.
 * Close to each brand; yellow/black brands are stepped so they read as colour and stay apart. Other products fold into "Other tools". */
const CHART = [
  ['voosquare', '#00A86B'], ['joinvoo', '#5B3FE8'], ['vooads', '#EE5A2F'], ['castvoo', '#2449D8'],
  ['replyvoo', '#B88A00'], ['landvoo', '#E8458B'], ['affleego', '#D9A400'], ['gatevoo', '#00897B'],
  // Spyvoo's brand blue sits too close to Castvoo and Joinvoo in a chart, so it charts in a lighter azure from the same family.
  ['spyvoo', '#2A93E2'],
];
const CHART_COLOR = Object.fromEntries(CHART);
const ALIAS = { advoo: 'vooads', adsvoo: 'vooads' };
const OTHER_COLOR = '#8A9A93';
const chartKey = (slug) => ALIAS[slug] || slug;

/* ---------------- time zone ---------------- */
function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0); return true; } catch { return false; }
}
function reportingTz() {
  const tz = D.getSetting('reporting_tz', DEFAULT_TZ);
  return validTz(tz) ? tz : DEFAULT_TZ;
}
const fmtCache = new Map();
function partsFmt(tz) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    fmtCache.set(tz, f);
  }
  return f;
}
function parts(ms, tz) {
  const p = {};
  for (const x of partsFmt(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
/** Offset of tz from UTC at instant ms (local - utc), in ms. */
function offsetMs(ms, tz) {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
/* Civil days: integer day numbers (days since 1970-01-01), independent of any time zone. */
const civil = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY);
const ymd = (day) => { const t = new Date(day * DAY); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; };
const dayStr = (day) => new Date(day * DAY).toISOString().slice(0, 10);
function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const day = civil(+m[1], +m[2], +m[3]);
  return dayStr(day) === m[0] ? day : null; // rejects 2026-02-31
}
/** UTC instant of local midnight starting civil day `day` in tz. */
function dayStart(day, tz) {
  const { y, m, d } = ymd(day);
  const guess = Date.UTC(y, m - 1, d);
  const o1 = offsetMs(guess, tz);
  let t = guess - o1;
  const o2 = offsetMs(t, tz);
  if (o2 !== o1) t = guess - o2;
  return t;
}
const localDay = (ms, tz) => { const p = parts(ms, tz); return civil(p.y, p.m, p.d); };
const todayIn = (tz) => localDay(now(), tz);
const mondayOf = (day) => day - ((new Date(day * DAY).getUTCDay() + 6) % 7);
const monthStartOf = (day) => { const { y, m } = ymd(day); return civil(y, m, 1); };
const nextMonth = (day) => { const { y, m } = ymd(day); return m === 12 ? civil(y + 1, 1, 1) : civil(y, m + 1, 1); };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function label(day, group) {
  const { y, m, d } = ymd(day);
  return group === 'month' ? `${MON[m - 1]} ${y}` : `${d} ${MON[m - 1]}`;
}

/** Buckets covering [fromDay, toDay] inclusive. Each: { key, from_day, to_day (inclusive) }. First/last week or month is clipped to the range. */
function bucketDays(fromDay, toDay, group) {
  const out = [];
  let cur = fromDay;
  while (cur <= toDay) {
    let start; let next;
    if (group === 'day') { start = cur; next = cur + 1; }
    else if (group === 'week') { start = mondayOf(cur); next = start + 7; }
    else { start = monthStartOf(cur); next = nextMonth(cur); }
    const end = Math.min(next - 1, toDay);
    out.push({ key: group === 'month' ? dayStr(start).slice(0, 7) : dayStr(start), from_day: cur, to_day: end, label: label(group === 'month' ? start : cur, group) });
    cur = end + 1;
  }
  return out;
}

/** Index of the bucket containing t given sorted edges (length n+1), or -1. */
function findBucket(edges, t) {
  if (t < edges[0] || t >= edges[edges.length - 1]) return -1;
  let lo = 0; let hi = edges.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (edges[mid] <= t) lo = mid; else hi = mid - 1; }
  return lo;
}

/* ---------------- products ---------------- */
/** Every product revenue can be reported under, in chart (stack) order. Products outside the palette share the "Other tools" colour. */
function productKeys() {
  const rows = D.all('SELECT id, slug, name, icon, color, status, hub, visible, sort FROM products ORDER BY hub DESC, sort, id');
  const hub = rows.find((p) => p.hub) || { id: 0, slug: 'voosquare', name: 'VooSquare', icon: 'voosquare', color: '#00A86B', status: 'live' };
  const tools = rows.filter((p) => !p.hub);
  const rank = (p) => { const i = CHART.findIndex(([k]) => k === chartKey(p.slug)); return i < 0 ? 100 + (p.sort || 0) : i; };
  tools.sort((a, b) => rank(a) - rank(b) || a.id - b.id);
  const meta = (p, key) => ({ key, id: p.id, name: p.name, icon: p.icon, color: p.color, status: p.status, visible: p.visible !== 0, chart: CHART_COLOR[chartKey(key)] || OTHER_COLOR, other: !CHART_COLOR[chartKey(key)] });
  return { hub, list: [meta(hub, 'voosquare'), ...tools.map((p) => meta(p, p.slug))], byId: new Map(tools.map((p) => [p.id, p.slug])) };
}

/* ---------------- money helpers ---------------- */
const r2 = (n) => Math.round(n * 100) / 100;
const moneyPerm = (A, u) => A.can(u, 'payments') || A.can(u, 'settings');
function maskEmail(e) {
  e = String(e || '');
  const at = e.indexOf('@');
  if (at < 1) return e ? '•••' : '';
  return e.slice(0, Math.min(2, at)) + '•••' + e.slice(at);
}

/* ---------------- query parsing ---------------- */
/** Named ranges resolved against today in the reporting time zone. 'all' is resolved by the caller (needs the first sale). */
function presetDays(key, today) {
  const { y, m } = ymd(today);
  switch (key) {
    case 'today': return [today, today];
    case 'yesterday': return [today - 1, today - 1];
    case '7d': return [today - 6, today];
    case '30d': return [today - 29, today];
    case '90d': return [today - 89, today];
    case 'month': return [civil(y, m, 1), today];
    case 'lastmonth': return [m === 1 ? civil(y - 1, 12, 1) : civil(y, m - 1, 1), civil(y, m, 1) - 1];
    case 'year': return [civil(y, 1, 1), today];
    case '12m': return [m === 12 ? civil(y, 1, 1) : civil(y - 1, m + 1, 1), today];
    default: return null;
  }
}
function autoGroup(days) { return days <= 45 ? 'day' : days <= 200 ? 'week' : 'month'; }
/** Read from/to/group from a query. Defaults: last 30 days ending today, a group that suits the length. */
function parseRange(q, tz, { defaultDays = 30, firstDay = null } = {}) {
  const today = todayIn(tz);
  const preset = !q.from && !q.to ? presetDays(q.range, today) : null;
  let toDay = preset ? preset[1] : q.to ? parseDay(q.to) : today;
  let fromDay = preset ? preset[0] : q.from ? parseDay(q.from) : null;
  if (toDay === null) fail(400, 'The end date must look like 2026-10-04.');
  if (q.from && fromDay === null) fail(400, 'The start date must look like 2026-10-01.');
  if (fromDay === null) fromDay = q.range === 'all' && firstDay !== null ? Math.max(firstDay, toDay - MAX_DAYS + 1) : toDay - defaultDays + 1;
  if (fromDay > toDay) fail(400, 'The start date is after the end date.');
  const days = toDay - fromDay + 1;
  if (days > MAX_DAYS) fail(400, 'Pick a range of three years or less.');
  let group = q.group || autoGroup(days);
  if (!GROUPS.includes(group)) fail(400, 'Group by day, week or month.');
  if (group === 'day' && days > MAX_DAY_BUCKETS) fail(400, 'Daily view works for up to 400 days. Group by week or month instead.');
  return { fromDay, toDay, days, group, today, preset: preset ? q.range : (!q.from && q.range === 'all' ? 'all' : (q.from || q.to ? 'custom' : '30d')) };
}

/* ---------------- row fetching ---------------- */
function fetchRows({ start, end, source, productKey, userId, hubId, keys }) {
  const rows = [];
  const wantOrders = source !== 'tools' && (productKey === 'all' || productKey === 'voosquare');
  const wantTools = source !== 'orders' && productKey !== 'voosquare';
  if (wantOrders) {
    const sql = `SELECT id, user_id, amount_usd v, paid_at t, item_type, item_id, item_name FROM orders WHERE status='paid' AND paid_at>=? AND paid_at<?${userId ? ' AND user_id=?' : ''}`;
    for (const o of D.db.prepare(sql).all(start, end, ...(userId ? [userId] : []))) {
      if (!(o.v > 0)) continue;
      rows.push({ kind: 'order', id: o.id, user_id: o.user_id, v: o.v, t: o.t, key: 'voosquare', sub: o.item_type === 'room' ? 'room:' + o.item_id : 'premium', sub_name: o.item_type === 'room' ? o.item_name : 'Premium' });
    }
  }
  if (wantTools) {
    let pid = null;
    if (productKey !== 'all') { pid = keys.list.find((k) => k.key === productKey).id; }
    const sql = `SELECT id, user_id, value_usd v, created_at t, product_id FROM events WHERE type='spend' AND created_at>=? AND created_at<? AND value_usd>0 AND value_usd<=${MAX_VALUE} AND product_id<>?${pid ? ' AND product_id=?' : ''}${userId ? ' AND user_id=?' : ''}`;
    for (const e of D.db.prepare(sql).all(start, end, hubId, ...(pid ? [pid] : []), ...(userId ? [userId] : []))) {
      const key = keys.byId.get(e.product_id);
      if (!key) continue;
      rows.push({ kind: 'spend', id: e.id, user_id: e.user_id, v: e.v, t: e.t, key });
    }
  }
  return rows;
}

/** Bucket rows into a zero-filled series for [fromDay, toDay], plus the same buckets shifted back by the range length. */
function buildSeries(rows, { fromDay, toDay, group, tz, keyList, shiftDays = 0 }) {
  const buckets = bucketDays(fromDay, toDay, group);
  const edges = buckets.map((b) => dayStart(b.from_day, tz)).concat(dayStart(toDay + 1, tz));
  const series = buckets.map((b, i) => ({ bucket: b.key, label: b.label, start_date: dayStr(b.from_day), end_date: dayStr(b.to_day), start: edges[i], total: 0, by: Object.fromEntries(keyList.map((k) => [k, 0])) }));
  let prevEdges = null;
  if (shiftDays) {
    prevEdges = buckets.map((b) => dayStart(b.from_day - shiftDays, tz)).concat(dayStart(toDay + 1 - shiftDays, tz));
    series.forEach((s) => { s.prev = 0; });
  }
  for (const r of rows) {
    const i = findBucket(edges, r.t);
    if (i >= 0) { const s = series[i]; s.total += r.v; s.by[r.key] = (s.by[r.key] || 0) + r.v; continue; }
    if (prevEdges) { const j = findBucket(prevEdges, r.t); if (j >= 0) series[j].prev += r.v; }
  }
  for (const s of series) { s.total = r2(s.total); for (const k of Object.keys(s.by)) s.by[k] = r2(s.by[k]); if (prevEdges) s.prev = r2(s.prev); }
  return { series, start: edges[0], end: edges[edges.length - 1], prevStart: prevEdges ? prevEdges[0] : null };
}

function userCards(ids) {
  if (!ids.length) return new Map();
  const rows = D.all(`SELECT id, name, email, avatar, premium_until FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return new Map(rows.map((u) => [u.id, u]));
}

/* ---------------- the report ---------------- */
function report(q, { revealEmail = false } = {}) {
  const tz = reportingTz();
  const keys = productKeys();
  const productKey = String(q.product || 'all');
  if (productKey !== 'all' && !keys.list.some((k) => k.key === productKey)) fail(400, 'Unknown product.');
  const source = String(q.source || 'all');
  if (!['all', 'orders', 'tools'].includes(source)) fail(400, 'Source must be all, orders or tools.');
  const first = firstRevenueAt(keys.hub.id);
  const firstDay = first ? localDay(first, tz) : null;
  const rg = parseRange(q, tz, { firstDay });
  const keyList = keys.list.map((k) => k.key);

  const start = dayStart(rg.fromDay, tz);
  const end = dayStart(rg.toDay + 1, tz);
  const prevStart = dayStart(rg.fromDay - rg.days, tz);
  const rows = fetchRows({ start: prevStart, end, source, productKey, hubId: keys.hub.id, keys });
  const { series } = buildSeries(rows, { fromDay: rg.fromDay, toDay: rg.toDay, group: rg.group, tz, keyList, shiftDays: rg.days });

  const cur = rows.filter((r) => r.t >= start && r.t < end);
  const sum = (a) => r2(a.reduce((x, r) => x + r.v, 0));
  const revenue = sum(cur);
  const prev = sum(rows.filter((r) => r.t >= prevStart && r.t < start));
  const ordersRows = cur.filter((r) => r.kind === 'order');
  const payers = new Map();
  for (const r of cur) if (r.user_id) payers.set(r.user_id, (payers.get(r.user_id) || 0) + r.v);
  const identified = [...payers.values()].reduce((a, b) => a + b, 0);

  const byKey = new Map();
  for (const r of cur) { const b = byKey.get(r.key) || { revenue: 0, count: 0 }; b.revenue += r.v; b.count++; byKey.set(r.key, b); }
  const by_product = keys.list.filter((k) => byKey.has(k.key)).map((k) => ({ ...k, revenue: r2(byKey.get(k.key).revenue), count: byKey.get(k.key).count, share: revenue ? byKey.get(k.key).revenue / revenue : 0 }))
    .sort((a, b) => b.revenue - a.revenue);
  const kindMap = new Map();
  for (const r of ordersRows) { const b = kindMap.get(r.sub) || { key: r.sub, name: r.sub_name, revenue: 0, count: 0 }; b.revenue += r.v; b.count++; kindMap.set(r.sub, b); }
  const kinds = [...kindMap.values()].map((k) => ({ ...k, revenue: r2(k.revenue) })).sort((a, b) => b.revenue - a.revenue);

  // Top customers: by total in range, with their split by product.
  const top = [...payers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const users = userCards(top.map(([id]) => id));
  const topBy = new Map(top.map(([id]) => [id, {}]));
  for (const r of cur) { const b = r.user_id && topBy.get(r.user_id); if (b) b[r.key] = (b[r.key] || 0) + r.v; }
  const top_customers = top.map(([id, total]) => {
    const u = users.get(id) || { name: 'Deleted member', email: '', avatar: '{}' };
    const by = topBy.get(id);
    for (const k of Object.keys(by)) by[k] = r2(by[k]);
    return { id, name: u.name, avatar: json(u.avatar, {}), email: revealEmail ? u.email : maskEmail(u.email), premium: (u.premium_until || 0) > now(), total: r2(total), by_product: by };
  });

  // Latest 10 paid items in the range.
  // Latest 10 without sorting every row.
  let recentRows = [];
  for (const r of cur) {
    if (recentRows.length < 10) { recentRows.push(r); if (recentRows.length === 10) recentRows.sort((a, b) => b.t - a.t); continue; }
    if (r.t > recentRows[9].t) { recentRows[9] = r; recentRows.sort((a, b) => b.t - a.t); }
  }
  recentRows = recentRows.sort((a, b) => b.t - a.t);
  const ru = userCards([...new Set(recentRows.map((r) => r.user_id).filter(Boolean))]);
  const orderInfo = new Map(); const eventInfo = new Map();
  const oIds = recentRows.filter((r) => r.kind === 'order').map((r) => r.id);
  const eIds = recentRows.filter((r) => r.kind === 'spend').map((r) => r.id);
  if (oIds.length) for (const o of D.all(`SELECT id, ref, item_name, currency, amount FROM orders WHERE id IN (${oIds.map(() => '?').join(',')})`, ...oIds)) orderInfo.set(o.id, o);
  if (eIds.length) for (const e of D.all(`SELECT id, label FROM events WHERE id IN (${eIds.map(() => '?').join(',')})`, ...eIds)) eventInfo.set(e.id, e);
  const recent = recentRows.map((r) => {
    const u = r.user_id ? ru.get(r.user_id) : null;
    const k = keys.list.find((x) => x.key === r.key);
    const o = orderInfo.get(r.id); const e = eventInfo.get(r.id);
    return {
      kind: r.kind, at: r.t, amount_usd: r2(r.v), key: r.key, product: k ? k.name : r.key,
      label: r.kind === 'order' ? (o ? o.item_name : r.sub_name) : ((e && e.label) || 'Spend reported by ' + (k ? k.name : 'a tool')),
      ref: o ? o.ref : '', local: o && o.currency !== 'USD' ? { amount: o.amount, currency: o.currency } : null,
      user: u ? { id: u.id, name: u.name, avatar: json(u.avatar, {}) } : null,
    };
  });

  return {
    tz, currency: 'USD', today: dayStr(rg.today), first_date: firstDay !== null ? dayStr(firstDay) : null,
    range: { from: dayStr(rg.fromDay), to: dayStr(rg.toDay), days: rg.days, group: rg.group, preset: rg.preset, prev_from: dayStr(rg.fromDay - rg.days), prev_to: dayStr(rg.fromDay - 1) },
    filters: { product: productKey, source },
    totals: {
      revenue, orders_revenue: sum(ordersRows), tools_revenue: sum(cur.filter((r) => r.kind === 'spend')),
      paying_users: payers.size, orders: ordersRows.length, payments: cur.length,
      arpu: payers.size ? r2(identified / payers.size) : 0, prev_revenue: prev, change_pct: prev > 0 ? Math.round(((revenue - prev) / prev) * 1000) / 10 : null,
    },
    products: keys.list, series, by_product, kinds, top_customers, recent,
  };
}

function firstRevenueAt(hubId) {
  const o = D.get("SELECT MIN(paid_at) t FROM orders WHERE status='paid' AND amount_usd>0");
  const e = D.get(`SELECT MIN(created_at) t FROM events WHERE type='spend' AND value_usd>0 AND value_usd<=${MAX_VALUE} AND product_id<>?`, hubId);
  const ts = [o && o.t, e && e.t].filter((x) => x);
  return ts.length ? Math.min(...ts) : null;
}

/** CSV of the same report: one row per bucket, one column per product, plus the total. */
function csv(q) {
  const r = report(q);
  const cols = r.products.filter((k) => r.series.some((s) => s.by[k.key]) || r.filters.product === k.key || k.key === 'voosquare');
  const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) || /^[=+\-@\t\r]/.test(s) ? '"' + s.replace(/^([=+\-@\t\r])/, "'$1").replace(/"/g, '""') + '"' : s; };
  const lines = [['period', 'start_date', 'end_date', 'total_usd', ...cols.map((k) => k.name + '_usd')].map(cell).join(',')];
  for (const s of r.series) lines.push([s.bucket, s.start_date, s.end_date, s.total.toFixed(2), ...cols.map((k) => (s.by[k.key] || 0).toFixed(2))].map(cell).join(','));
  lines.push(['total', r.range.from, r.range.to, r.totals.revenue.toFixed(2), ...cols.map((k) => r.series.reduce((a, s) => a + (s.by[k.key] || 0), 0).toFixed(2))].map(cell).join(','));
  return { body: '﻿' + lines.join('\r\n') + '\r\n', name: `voosquare-revenue_${r.range.from}_${r.range.to}_${r.range.group}.csv` };
}

/** One member's spend across VooSquare and every tool. */
function customerSpend(userId, q) {
  const tz = reportingTz();
  const keys = productKeys();
  const keyList = keys.list.map((k) => k.key);
  const all = fetchRows({ start: 0, end: 9e15, source: 'all', productKey: 'all', userId, hubId: keys.hub.id, keys }).sort((a, b) => b.t - a.t);
  const lifetime = r2(all.reduce((a, r) => a + r.v, 0));
  const firstDay = all.length ? localDay(all[all.length - 1].t, tz) : null;
  const today = todayIn(tz);
  const rq = { ...q };
  if (!rq.from && rq.range === '30d') rq.group = rq.group || 'day';
  if (!rq.from && rq.range === '12m') rq.group = rq.group || 'month';
  if (!rq.from && (rq.range === 'all' || !rq.range)) { rq.range = 'all'; if (firstDay === null) { rq.from = dayStr(today - 29); rq.to = dayStr(today); } }
  if (rq.range === 'all' && !rq.group && firstDay !== null) { const days = today - Math.max(firstDay, today - MAX_DAYS + 1) + 1; rq.group = days <= 45 ? 'day' : 'month'; }
  const rg = parseRange(rq, tz, { firstDay });
  const { series, start, end } = buildSeries(all, { fromDay: rg.fromDay, toDay: rg.toDay, group: rg.group, tz, keyList });
  const cur = all.filter((r) => r.t >= start && r.t < end);
  const total = r2(cur.reduce((a, r) => a + r.v, 0));
  const byKey = new Map();
  for (const r of cur) { const b = byKey.get(r.key) || { revenue: 0, count: 0, last_at: 0 }; b.revenue += r.v; b.count++; b.last_at = Math.max(b.last_at, r.t); byKey.set(r.key, b); }
  const by_product = keys.list.filter((k) => byKey.has(k.key)).map((k) => { const b = byKey.get(k.key); return { ...k, revenue: r2(b.revenue), count: b.count, last_at: b.last_at, share: total ? b.revenue / total : 0 }; }).sort((a, b) => b.revenue - a.revenue);

  const per = 20;
  const page = Math.max(0, Math.floor(Number(q.page) || 0));
  const slice = cur.slice(page * per, page * per + per);
  const oIds = slice.filter((r) => r.kind === 'order').map((r) => r.id);
  const eIds = slice.filter((r) => r.kind === 'spend').map((r) => r.id);
  const oi = new Map(oIds.length ? D.all(`SELECT id, ref, item_name, currency, amount FROM orders WHERE id IN (${oIds.map(() => '?').join(',')})`, ...oIds).map((o) => [o.id, o]) : []);
  const ei = new Map(eIds.length ? D.all(`SELECT id, label FROM events WHERE id IN (${eIds.map(() => '?').join(',')})`, ...eIds).map((e) => [e.id, e]) : []);
  const items = slice.map((r) => {
    const k = keys.list.find((x) => x.key === r.key);
    const o = oi.get(r.id); const e = ei.get(r.id);
    return { kind: r.kind, at: r.t, amount_usd: r2(r.v), key: r.key, product: k ? k.name : r.key, label: r.kind === 'order' ? (o ? o.item_name : r.sub_name) : ((e && e.label) || 'Spend reported by ' + (k ? k.name : 'a tool')), ref: o ? o.ref : '', local: o && o.currency !== 'USD' ? { amount: o.amount, currency: o.currency } : null };
  });
  return {
    tz, currency: 'USD', today: dayStr(today),
    lifetime: { total: lifetime, orders_total: r2(all.filter((r) => r.kind === 'order').reduce((a, r) => a + r.v, 0)), tools_total: r2(all.filter((r) => r.kind === 'spend').reduce((a, r) => a + r.v, 0)), count: all.length, first_at: all.length ? all[all.length - 1].t : null, last_at: all.length ? all[0].t : null },
    range: { from: dayStr(rg.fromDay), to: dayStr(rg.toDay), days: rg.days, group: rg.group, preset: ['all', '12m', '30d'].includes(rq.range) ? rq.range : 'custom' },
    total, count: cur.length, products: keys.list, by_product, series,
    timeline: { items, page, per, total: cur.length, pages: Math.max(1, Math.ceil(cur.length / per)) },
  };
}

/** Lifetime spend per member for the customers list (VooSquare orders + tool spend). SQL fragment joined on users.id. */
const SPENT_JOIN = `LEFT JOIN (SELECT user_id, SUM(amount_usd) s FROM orders WHERE status='paid' AND amount_usd>0 GROUP BY user_id) so ON so.user_id=users.id
  LEFT JOIN (SELECT user_id, SUM(value_usd) s FROM events WHERE type='spend' AND value_usd>0 AND value_usd<=${MAX_VALUE} AND user_id IS NOT NULL AND product_id NOT IN (SELECT id FROM products WHERE hub=1) GROUP BY user_id) se ON se.user_id=users.id`;
const SPENT_COL = 'ROUND(COALESCE(so.s,0)+COALESCE(se.s,0), 2)';

/** Daily revenue for the last n local days (overview sparkline), both sources. */
function lastDays(n = 30) {
  const tz = reportingTz();
  const today = todayIn(tz);
  const r = report({ from: dayStr(today - n + 1), to: dayStr(today), group: 'day' });
  return { tz, series: r.series.map((s) => s.total), total: r.totals.revenue, prev: r.totals.prev_revenue, change_pct: r.totals.change_pct };
}

/** UTC instant when the current month started in the reporting time zone (for "paid this month"). */
function monthStartMs() {
  const tz = reportingTz();
  return dayStart(monthStartOf(todayIn(tz)), tz);
}

/**
 * Dates shown to people (emails, notices, certificates) are in the reporting time zone (Africa/Lagos by default), like
 * receipts and reports, never the server's UTC (money audit MN-9). dateString: the same shape as Date#toDateString
 * ("Sun Nov 01 2026"); dateText: Intl options as for toLocaleDateString('en-GB', opts).
 */
function dateString(ms) {
  const p = parts(ms, reportingTz());
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d));
  return d.toUTCString().replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4}).*$/, '$1 $3 $2 $4');
}
function dateText(ms, opts = { day: 'numeric', month: 'long', year: 'numeric' }) { return new Date(ms).toLocaleDateString('en-GB', { ...opts, timeZone: reportingTz() }); }

module.exports = {
  MAX_VALUE, monthStartMs, dateString, dateText,
  DEFAULT_TZ, validTz, reportingTz, report, csv, customerSpend, lastDays, moneyPerm, maskEmail, SPENT_JOIN, SPENT_COL,
  _test: { dayStart, localDay, bucketDays, parseDay, dayStr, offsetMs },
};
