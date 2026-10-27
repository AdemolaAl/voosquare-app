'use strict';
/*
 * Affiliate contests: builder data, scoring, live leaderboard and results.
 *
 * Scoring unit: qualified customers whose Voo ID was created inside the contest dates and who qualify by the end of the
 * qualification window (owner update 2026-10-05: default 0, so scores are final when the contest ends; admin may still set a
 * window for a special contest). Points per customer: scoring.points (default 1), raised by
 * scoring.plan_points ([{ min_price_cents, points }], e.g. plans of $99+ score 3) and scoring.product_points ({ slug: n }).
 * Tier multipliers (Pro x1.05 ... Legend x1.25) apply when `multipliers` is on, never to the Rising prize.
 * Customers declined for fraud, reversed for proven fraud (an approved fraud reversal) or refunded are removed; 3+ removed
 * or a refund rate over 15% disqualifies the affiliate. The Rising prize goes to the Starter/Pro affiliate with the most
 * points without multipliers (spec 3.2, 5.1).
 * Ties: higher net revenue from contest customers, then who reached the score first.
 * Scores move while the contest is live and are final at its end (or after any window admin set). Results need two staff: one finalises, another signs off;
 * then prizes become `contest_prize` earnings (available at once) and winners are told.
 */
const D = require('../db');
const C = require('./core');
const N = require('./notify');
const { now } = require('../util');

const DAY = C.DAY;
const JSON_FIELDS = ['images', 'theme', 'products', 'geos', 'scoring', 'prizes', 'rising', 'milestone', 'eligibility', 'winners'];
function hydrate(c) { if (!c) return null; for (const k of JSON_FIELDS) c[k] = C.json(c[k], ['images', 'products', 'geos', 'prizes', 'winners'].includes(k) ? [] : {}); return c; }
const get = (id) => hydrate(D.get('SELECT * FROM aff_contests WHERE id=?', Number(id)));

function status(c, at = now()) {
  if (c.cancelled) return 'cancelled';
  if (c.signoff_at) return 'completed';
  if (at < c.starts_at) return 'upcoming';
  if (at <= c.ends_at) return 'live';
  if (at < c.ends_at + c.qual_days * DAY) return 'qualifying';
  return c.final_at ? 'pending_signoff' : 'closed';
}

/** Validate builder input (admin). Amounts in cents; dates as ms or ISO. */
function clean(b, prev = {}) {
  const ts = (v, d) => { if (v === undefined) return d; const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : d; };
  const title = C.clean(b.title !== undefined ? b.title : prev.title, 120);
  if (title.length < 3) C.fail(400, 'Give the contest a name.');
  const starts = ts(b.starts_at, prev.starts_at); const ends = ts(b.ends_at, prev.ends_at);
  if (!starts || !ends || ends <= starts) C.fail(400, 'Set a start and an end date after it.');
  const prizes = (Array.isArray(b.prizes) ? b.prizes : prev.prizes || []).slice(0, 50).map((p) => ({
    label: C.clean(p.label, 40), rank_from: Math.max(1, Math.floor(Number(p.rank_from) || 1)), rank_to: Math.max(1, Math.floor(Number(p.rank_to || p.rank_from) || 1)),
    amount_cents: Math.max(0, Math.round(Number(p.amount_cents) || 0)),
  })).filter((p) => p.amount_cents > 0 && p.rank_to >= p.rank_from);
  const scoring = b.scoring !== undefined ? b.scoring : prev.scoring || {};
  const sc = {
    points: Math.max(1, Math.floor(Number(scoring.points) || 1)),
    plan_points: (Array.isArray(scoring.plan_points) ? scoring.plan_points : []).slice(0, 10).map((x) => ({ min_price_cents: Math.max(0, Math.round(Number(x.min_price_cents) || 0)), points: Math.max(0, Math.floor(Number(x.points) || 0)) })),
    product_points: Object.fromEntries(Object.entries(scoring.product_points || {}).filter(([k]) => C.inProgram(k)).slice(0, 30).map(([k, v]) => [String(k).slice(0, 40), Math.max(0, Math.floor(Number(v) || 0))])),
  };
  const r = b.rising !== undefined ? b.rising : prev.rising || {};
  const m = b.milestone !== undefined ? b.milestone : prev.milestone || {};
  const pool = prizes.reduce((s, p) => s + p.amount_cents * (p.rank_to - p.rank_from + 1), 0) + (Number(r.amount_cents) || 0) + (Number(m.amount_cents) || 0) * (Number(m.max_winners) || 0);
  return {
    title, kind: ['monthly', 'launch', 'geo', 'custom'].includes(b.kind) ? b.kind : prev.kind || 'monthly',
    description: C.clean(b.description !== undefined ? b.description : prev.description, 1000), rules: C.clean(b.rules !== undefined ? b.rules : prev.rules, 8000),
    banner_upload: C.clean(b.banner_upload !== undefined ? b.banner_upload : prev.banner_upload, 40),
    images: JSON.stringify((Array.isArray(b.images) ? b.images : prev.images || []).slice(0, 12).map((x) => C.clean(x, 40)).filter(Boolean)),
    theme: JSON.stringify(b.theme && typeof b.theme === 'object' ? { accent: /^#[0-9a-f]{6}$/i.test(b.theme.accent || '') ? b.theme.accent : '#00A86B', art: C.clean(b.theme.art, 30) } : prev.theme || {}),
    starts_at: starts, ends_at: ends, qual_days: Math.max(0, Math.min(120, Math.floor(Number(b.qual_days !== undefined ? b.qual_days : prev.qual_days ?? 0)))),
    products: JSON.stringify((Array.isArray(b.products) ? b.products : prev.products || []).map((x) => C.clean(x, 40)).filter((x) => x && C.inProgram(x))),
    geos: JSON.stringify((Array.isArray(b.geos) ? b.geos : prev.geos || []).map((x) => C.clean(x, 2).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x))),
    scoring: JSON.stringify(sc), min_points: Math.max(0, Math.floor(Number(b.min_points !== undefined ? b.min_points : prev.min_points) || 0)),
    multipliers: b.multipliers !== undefined ? (b.multipliers ? 1 : 0) : prev.multipliers ?? 1,
    prizes: JSON.stringify(prizes),
    rising: JSON.stringify({ amount_cents: Math.max(0, Math.round(Number(r.amount_cents) || 0)), max_tier: Math.max(0, Math.floor(Number(r.max_tier ?? 1))) }),
    milestone: JSON.stringify({ points: Math.max(0, Math.floor(Number(m.points) || 0)), amount_cents: Math.max(0, Math.round(Number(m.amount_cents) || 0)), max_winners: Math.max(0, Math.floor(Number(m.max_winners) || 0)) }),
    eligibility: JSON.stringify(b.eligibility && typeof b.eligibility === 'object' ? { min_tier: Math.max(0, Math.floor(Number(b.eligibility.min_tier) || 0)), staff: false } : prev.eligibility || {}),
    pool_cents: pool, announce: b.announce !== undefined ? (b.announce ? 1 : 0) : prev.announce ?? 1, published: b.published !== undefined ? (b.published ? 1 : 0) : prev.published ?? 1,
  };
}

/** Points one qualified customer earns in a contest (0 when the product or geo is not eligible). */
function pointsFor(c, cust, country) {
  if (!C.inProgram(cust.first_product)) return 0; // Affleego customers never score (not part of the affiliate program)
  if (!(C.capFor(cust.first_product) > 0)) return 0; // excluded products (Inner Circle, Gatevoo off) never score (MN-3)
  if (c.products.length && !c.products.includes(cust.first_product)) return 0;
  if (c.geos.length && !c.geos.includes(String(country || '').toUpperCase())) return 0;
  let pts = c.scoring.points || 1;
  if (c.scoring.product_points && c.scoring.product_points[cust.first_product] !== undefined) pts = c.scoring.product_points[cust.first_product];
  const price = D.get('SELECT price_cents FROM aff_plans WHERE product_key=? AND plan=?', cust.first_product, cust.first_plan || '');
  const unit = price ? price.price_cents : cust.first_amount_cents;
  for (const pp of (c.scoring.plan_points || []).slice().sort((x, y) => y.min_price_cents - x.min_price_cents)) if (unit >= pp.min_price_cents && pp.points > pts) { pts = pp.points; break; }
  return pts;
}

/** Recompute the materialised scores and ranks of one contest. Returns the rank changes [{ affiliate_id, from, to }]. */
function recompute(id, at = now()) {
  const c = get(id);
  if (!c || c.cancelled) return [];
  const qualEnd = c.ends_at + c.qual_days * DAY;
  const rows = D.all(`SELECT cu.*, t.country, t.blocked, t.locked_at FROM aff_customers cu JOIN aff_attributions t ON t.customer_user_id=cu.user_id
    WHERE t.locked_at>=? AND t.locked_at<=? AND cu.first_payment_at IS NOT NULL`, c.starts_at, c.ends_at);
  const by = new Map();
  for (const r of rows) {
    const s = by.get(r.affiliate_id) || { points: 0, customers: 0, revenue: 0, removed: 0, reached: 0, contest: 0, refunded: 0 };
    s.contest++;
    const fraud = D.get("SELECT 1 FROM aff_cpa_reviews WHERE customer_user_id=? AND status='declined' AND decline_reason NOT IN ('over_cap','refund_in_hold','chargeback','not_qualified')", r.user_id)
      // Proven fraud (MN-4): an approved fraud reversal on any of this customer's commissions removes the customer.
      || D.get("SELECT 1 FROM aff_clawbacks k, json_each(k.commission_ids) j JOIN aff_commissions m ON m.id=j.value WHERE k.status='approved' AND k.affiliate_id=? AND m.customer_user_id=? LIMIT 1", r.affiliate_id, r.user_id);
    if (r.refunds || r.chargebacks) s.refunded++;
    if (r.blocked || fraud || r.refunds || r.chargebacks) { s.removed++; by.set(r.affiliate_id, s); continue; }
    if (!r.qualified_at || r.qualified_at > qualEnd || r.qualified_at > at) { by.set(r.affiliate_id, s); continue; }
    // Points on the qualifying purchase (MN-3: a first purchase on an excluded product does not decide the points).
    const qv = D.get("SELECT product_key, plan, amount_cents FROM aff_conversions WHERE source_key=?", 'qual:' + r.user_id);
    const pts = pointsFor(c, qv && qv.product_key && qv.product_key !== r.first_product ? { ...r, first_product: qv.product_key, first_plan: qv.plan, first_amount_cents: qv.amount_cents } : r, r.country);
    if (pts > 0) { s.points += pts; s.customers++; s.revenue += r.total_cents - r.refunded_cents; s.reached = Math.max(s.reached, r.qualified_at); }
    by.set(r.affiliate_id, s);
  }
  const T = C.tiers();
  const prev = new Map(D.all('SELECT affiliate_id, rank FROM aff_contest_scores WHERE contest_id=?', c.id).map((r) => [r.affiliate_id, r.rank]));
  const list = [];
  for (const [affId, s] of by) {
    const a = C.byId(affId);
    if (!a || a.status !== 'approved') continue;
    if (c.eligibility && c.eligibility.min_tier && C.effectiveTier(a, at) < c.eligibility.min_tier) continue;
    const mult = c.multipliers ? (T[C.effectiveTier(a, at)] || T[0]).multiplier_bp : 10000;
    const dq = s.removed >= 3 ? 'Three or more customers removed' : s.contest >= 5 && s.refunded / s.contest > 0.15 ? 'Refund rate on contest customers over 15%' : '';
    list.push({ affiliate_id: affId, points: s.points, multiplier_bp: mult, score: Math.round(s.points * mult / 100), customers: s.customers, revenue_cents: s.revenue, reached_at: s.reached || null, removed: s.removed, disqualified: dq ? 1 : 0, dq_reason: dq });
  }
  list.sort((x, y) => x.disqualified - y.disqualified || y.score - x.score || y.revenue_cents - x.revenue_cents || (x.reached_at || 9e15) - (y.reached_at || 9e15));
  const changes = [];
  D.tx(() => {
    D.run('DELETE FROM aff_contest_scores WHERE contest_id=?', c.id);
    let rank = 0;
    for (const s of list) {
      const placed = !s.disqualified && s.points >= (c.min_points || 0) && s.points > 0;
      const r = placed ? ++rank : null;
      const p = prev.get(s.affiliate_id) ?? null;
      if (r !== p) changes.push({ affiliate_id: s.affiliate_id, from: p, to: r });
      D.insert('aff_contest_scores', { contest_id: c.id, ...s, rank: r, prev_rank: p, updated_at: at });
    }
  });
  if (status(c, at) === 'live') {
    for (const ch of changes) {
      if (!ch.to || (ch.from && ch.to >= ch.from)) continue;
      const a = C.byId(ch.affiliate_id);
      const above = ch.to > 1 ? D.get('SELECT score FROM aff_contest_scores WHERE contest_id=? AND rank=?', c.id, ch.to - 1) : null;
      const mine = D.get('SELECT score FROM aff_contest_scores WHERE contest_id=? AND affiliate_id=?', c.id, ch.affiliate_id);
      N.emit(a, 'contest_rank', { text: `You are #${ch.to} in ${c.title}.${above && mine ? ` ${((above.score - mine.score) / 100).toFixed(2).replace(/\.00$/, '')} points behind #${ch.to - 1}.` : ''}` });
    }
  }
  return changes;
}

/** Public leaderboard: rank, display name (or "Affiliate #id" when hidden), country, tier, score; `me` highlighted. */
function leaderboard(id, meAffId = null, limit = 50, at = now()) {
  const c = get(id);
  if (!c) C.fail(404, 'Contest not found.');
  const rows = D.all(`SELECT s.*, a.display_name, a.hide_name, a.country, a.code, u.name uname, u.avatar FROM aff_contest_scores s JOIN aff_affiliates a ON a.id=s.affiliate_id JOIN users u ON u.id=a.user_id
    WHERE s.contest_id=? ORDER BY s.rank IS NULL, s.rank, s.score DESC LIMIT ?`, c.id, limit);
  const T = C.tiers();
  const view = (r) => ({
    rank: r.rank, name: r.hide_name ? `Affiliate #${r.affiliate_id}` : (r.display_name || r.uname || `Affiliate #${r.affiliate_id}`), country: r.country || '',
    avatar: r.hide_name ? null : C.json(r.avatar, {}), tier: T[C.effectiveTier(C.byId(r.affiliate_id), at)].name, score: r.score / 100, points: r.points,
    provisional: ['live', 'qualifying'].includes(status(c, at)), me: r.affiliate_id === meAffId, disqualified: !!r.disqualified, movement: r.prev_rank && r.rank ? r.prev_rank - r.rank : 0,
  });
  const board = rows.filter((r) => r.rank).map(view);
  let mine = null;
  if (meAffId) {
    const r = D.get(`SELECT s.*, a.display_name, a.hide_name, a.country, u.name uname, u.avatar FROM aff_contest_scores s JOIN aff_affiliates a ON a.id=s.affiliate_id JOIN users u ON u.id=a.user_id WHERE s.contest_id=? AND s.affiliate_id=?`, c.id, meAffId);
    if (r) {
      mine = view(r);
      const above = r.rank && r.rank > 1 ? D.get('SELECT score FROM aff_contest_scores WHERE contest_id=? AND rank=?', c.id, r.rank - 1) : null;
      mine.gap_to_next = above ? (above.score - r.score) / 100 : 0;
    }
  }
  return { board, me: mine, entrants: D.get('SELECT COUNT(*) n FROM aff_contest_scores WHERE contest_id=?', c.id).n };
}

/** First staff member closes the results (after the qualification window). */
function finalise(id, me, at = now()) {
  const c = get(id);
  if (!c) C.fail(404, 'Contest not found.');
  if (c.final_at) C.fail(409, 'Results are already finalised. Another staff member signs off.');
  if (at < c.ends_at + c.qual_days * DAY) C.fail(409, c.qual_days ? 'The qualification window has not closed yet.' : 'The contest has not ended yet.');
  recompute(id, at);
  D.run('UPDATE aff_contests SET final_by=?, final_at=?, updated_at=? WHERE id=?', me.id, at, now(), id);
  C.audit(me, 'contest.finalise', { target: c.title });
  return get(id);
}
/** Second staff member signs off: winners are fixed and prizes created as earnings. */
function signoff(id, me, at = now()) {
  const c = get(id);
  if (!c) C.fail(404, 'Contest not found.');
  if (!c.final_at) C.fail(409, 'Finalise the results first.');
  if (c.signoff_at) C.fail(409, 'Results are already signed off.');
  if (c.final_by === me.id) C.fail(403, 'Results need a second staff member to sign off.');
  const scores = D.all('SELECT * FROM aff_contest_scores WHERE contest_id=? AND rank IS NOT NULL ORDER BY rank', c.id);
  const winners = [];
  for (const p of c.prizes) for (const s of scores) if (s.rank >= p.rank_from && s.rank <= p.rank_to) winners.push({ affiliate_id: s.affiliate_id, rank: s.rank, prize: p.label || `#${s.rank}`, amount_cents: p.amount_cents });
  if (c.rising && c.rising.amount_cents) {
    // Rising prize (spec 3.2, 5.1, MN-11): the eligible affiliate with the most points, no tier multiplier (ties: net
    // revenue, then who got there first), not the first one in the multiplied ranking.
    const best = scores.filter((s) => C.effectiveTier(C.byId(s.affiliate_id), at) <= (c.rising.max_tier ?? 1))
      .sort((x, y) => y.points - x.points || y.revenue_cents - x.revenue_cents || (x.reached_at || 9e15) - (y.reached_at || 9e15))[0];
    if (best) winners.push({ affiliate_id: best.affiliate_id, rank: best.rank, prize: 'Rising prize', amount_cents: c.rising.amount_cents });
  }
  if (c.milestone && c.milestone.points && c.milestone.amount_cents) {
    const hit = scores.filter((s) => s.points >= c.milestone.points).sort((x, y) => (x.reached_at || 0) - (y.reached_at || 0)).slice(0, c.milestone.max_winners || 0);
    for (const s of hit) winners.push({ affiliate_id: s.affiliate_id, rank: s.rank, prize: 'Milestone bonus', amount_cents: c.milestone.amount_cents });
  }
  const E = require('./engine');
  D.tx(() => {
    for (const w of winners) {
      E.addCommission({ affiliate_id: w.affiliate_id, type: 'contest_prize', amount_cents: w.amount_cents, product_key: '', status: 'available', reason: c.title, note: w.prize, uniq_key: `contest:${c.id}:${w.affiliate_id}:${w.prize}`, approved_by: me.id });
    }
    D.run('UPDATE aff_contests SET signoff_by=?, signoff_at=?, winners=?, updated_at=? WHERE id=?', me.id, at, JSON.stringify(winners), now(), c.id);
  });
  C.audit(me, 'contest.signoff', { target: c.title, after: { winners: winners.length } });
  for (const w of winners) {
    const a = C.byId(w.affiliate_id);
    N.emit(a, 'contest_won', { text: `${c.title} results are final. You placed #${w.rank} (${w.prize}): ${C.fmtUsd(w.amount_cents)} added to your balance.`, email: { contest: c.title, rank: String(w.rank), prize: w.prize, amount: C.fmtUsd(w.amount_cents) } });
  }
  return get(id);
}

function view(c, at = now(), { admin = false } = {}) {
  const up = require('../uploads');
  const imgs = up.lookup([c.banner_upload, ...c.images]);
  return {
    id: c.id, title: c.title, kind: c.kind, description: c.description, rules: c.rules, status: status(c, at), starts_at: c.starts_at, ends_at: c.ends_at,
    qual_days: c.qual_days, results_at: c.ends_at + c.qual_days * DAY, products: c.products, geos: c.geos, scoring: c.scoring, min_points: c.min_points,
    multipliers: !!c.multipliers, prizes: c.prizes, rising: c.rising, milestone: c.milestone, eligibility: c.eligibility, pool_cents: c.pool_cents, theme: c.theme,
    banner: imgs[c.banner_upload] || null, images: c.images.map((i) => imgs[i]).filter(Boolean),
    winners: c.signoff_at ? c.winners.map((w) => { const a = C.byId(w.affiliate_id); return { ...w, name: a ? (a.hide_name ? `Affiliate #${a.id}` : a.display_name) : '', country: a ? a.country : '' }; }) : [],
    ...(admin ? { final_at: c.final_at, final_by: c.final_by, signoff_at: c.signoff_at, signoff_by: c.signoff_by, published: !!c.published, cancelled: !!c.cancelled,
      entrants: D.get('SELECT COUNT(*) n FROM aff_contest_scores WHERE contest_id=?', c.id).n,
      removals: D.get('SELECT COALESCE(SUM(removed),0) n, COALESCE(SUM(disqualified),0) d FROM aff_contest_scores WHERE contest_id=?', c.id) } : {}),
  };
}
function list({ admin = false, at = now() } = {}) {
  return D.all(`SELECT * FROM aff_contests ${admin ? '' : 'WHERE published=1 AND cancelled=0'} ORDER BY starts_at DESC LIMIT 100`).map(hydrate).map((c) => view(c, at, { admin }));
}
function recomputeAll(at = now()) {
  let n = 0;
  for (const c of D.all('SELECT id, starts_at, ends_at, qual_days, signoff_at, cancelled FROM aff_contests WHERE cancelled=0 AND signoff_at IS NULL AND starts_at<=?', at)) { recompute(c.id, at); n++; }
  return n;
}

module.exports = { get, hydrate, status, clean, pointsFor, recompute, recomputeAll, leaderboard, finalise, signoff, view, list };
