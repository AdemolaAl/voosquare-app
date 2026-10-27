'use strict';
/*
 * Affiliate program back office: /api/admin/aff/*. Roles (src/auth.js permissions):
 *  aff_admin   super admin of the program (owners have it implicitly): everything
 *  aff_manager general or private manager: only assigned affiliates (applications, notes, deal requests, alerts)
 *  aff_fraud   CPA review queue, duplicate checks, fraud signals, flags, CPA pause, clawback proposals
 *  aff_finance payouts queue (four eyes), wallets, KYC, clawback approvals, adjustments (also `payments`)
 * Contract: docs/AFFILIATE_API.md.
 */
const D = require('../db');
const A = require('../auth');
const C = require('../aff/core');
const E = require('../aff/engine');
const F = require('../aff/fraud');
const V = require('../aff/views');
const P = require('../aff/program');
const R = require('../aff/reports');
const PAY = require('../aff/payouts');
const KYC = require('../aff/kyc');
const TG = require('../aff/telegram');
const CT = require('../aff/contests');
const J = require('../aff/jobs');
const up = require('../uploads');
const { now, fail, clean, json, limit } = require('../util');

const DAY = C.DAY;
/** The admin view of a product's plan catalogue (price, where it came from, what tools last reported, mismatches). */
const planRows = (key) => D.all('SELECT plan, price_cents, synced_at, price_source, reported_cents, reported_at, mismatch_count, mismatch_at, confirmed_at FROM aff_plans WHERE product_key=? ORDER BY price_cents', key);
function need(ctx, role) {
  const u = A.requireUser(ctx);
  const r = P.roles(u);
  if (!(role === 'any' ? r.any : r[role])) fail(403, "You don't have access to this part of the affiliate admin.");
  return u;
}
function affOr404(me, id) {
  const a = C.byId(id);
  if (!a || !P.canSee(me, a)) fail(404, 'Affiliate not found.');
  return a;
}
const sendCsv = (ctx, lines, name) => {
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  ctx.handled = true;
  ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
  ctx.res.end('﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n') + '\r\n');
};
const ageTxt = (ms) => { const h = Math.floor(ms / 3600_000); if (h < 1) { const m = Math.floor(ms / 60_000); return m < 1 ? 'under a minute' : `${m}m`; } return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`; };

/** CPA review row/detail for staff: timeline, geos, signals with masked evidence, verdict. */
function cpaView(rv, at, { full = false } = {}) {
  const a = C.byId(rv.affiliate_id);
  const u = D.get('SELECT name, avatar FROM users WHERE id=?', a.user_id) || {};
  const attr = E.attribution(rv.customer_user_id) || {};
  const cust = E.customer(rv.customer_user_id) || {};
  const out = {
    id: rv.id, conversion_id: rv.conversion_id, ref: 'CV-' + rv.conversion_id, affiliate: { id: a.id, ref: `AF-${a.id}`, name: u.name, display_name: a.display_name, avatar: C.json(u.avatar, {}), tier: C.tierName(C.effectiveTier(a, at)) },
    product_key: rv.product_key, plan: rv.plan, amount_cents: rv.amount_cents, model: rv.model, customer_ref: attr.cust_ref || '', risk: rv.risk, verdict: rv.verdict, signals: json(rv.signals, []),
    status: rv.status, decline_reason: rv.decline_reason, note: rv.note, extended_days: rv.extended_days, created_at: rv.created_at, age: ageTxt(at - rv.created_at), qualified_at: cust.qualified_at || null, sub1: attr.sub1 || '',
    reviewer: rv.reviewer_id ? (D.get('SELECT name FROM users WHERE id=?', rv.reviewer_id) || {}).name : null, decided_at: rv.decided_at,
  };
  if (!full) return out;
  const click = attr.click_id ? D.get('SELECT * FROM aff_clicks WHERE id=?', attr.click_id) : null;
  const user = D.get('SELECT created_at, country FROM users WHERE id=?', rv.customer_user_id) || {};
  const pays = D.all("SELECT occurred_at, product_key, plan, amount_cents, event_type FROM aff_conversions WHERE customer_user_id=? AND event_type IN ('first_payment','repeat_payment','refund','chargeback') ORDER BY occurred_at LIMIT 20", rv.customer_user_id);
  const idents = D.all("SELECT kind, value FROM aff_identities WHERE user_id=? AND kind IN ('geo_pay','geo_ip')", rv.customer_user_id);
  const timeline = [];
  if (click) timeline.push({ label: 'Click', at: click.created_at, detail: [click.sub1, click.device, click.country].filter(Boolean).join(' · ') });
  timeline.push({ label: 'Voo ID created', at: user.created_at, detail: click ? `${Math.max(0, Math.round((user.created_at - click.created_at) / 1000))} s after click` : `Attributed by ${attr.method || 'code'}` });
  pays.forEach((p, i) => timeline.push({ label: p.event_type === 'refund' ? 'Refund' : p.event_type === 'chargeback' ? 'Chargeback' : i === 0 ? 'First payment' : 'Payment', at: p.occurred_at, detail: `${E.prodName(p.product_key, p.plan)} ${C.fmtUsd(p.amount_cents)}` }));
  if (cust.qualified_at) timeline.push({ label: 'Qualified', at: cust.qualified_at, detail: cust.qualify_rule === 'second_payment' ? 'Second payment' : cust.qualify_rule === 'first_payment' ? 'First payment' : String(cust.qualify_rule || '').endsWith('_days_active') ? 'Active after first payment (earlier rule)' : 'Qualified' });
  const fa = F.analyse(rv.customer_user_id, at);
  return { ...out, timeline, geo: { click: click ? click.country : '', profile: user.country || '', payment: (idents.find((i) => i.kind === 'geo_pay') || {}).value || '' }, analysis: fa, email_masked: fa.email,
    subs: { sub1: attr.sub1, sub2: attr.sub2, sub3: attr.sub3, sub4: attr.sub4, sub5: attr.sub5 } };
}
function payoutRow(p, at, me) {
  const a = C.byId(p.affiliate_id);
  const u = D.get('SELECT name, avatar FROM users WHERE id=?', a.user_id) || {};
  const flags = [];
  if (a.cpa_paused) flags.push(a.cpa_paused_reason || 'CPA paused');
  if (a.fraud_score >= 60) flags.push(`Fraud score ${a.fraud_score}`);
  if (a.kyc_status !== 'verified' && PAY.kycRequired(a, p.amount_cents)) flags.push('KYC not verified');
  const big = p.amount_cents > C.settings().payouts.four_eyes_cents;
  const approver = p.approved_by ? D.get('SELECT name FROM users WHERE id=?', p.approved_by) : null;
  return {
    ...PAY.view(p, { reveal: true }), affiliate: { id: a.id, ref: `AF-${a.id}`, name: u.name, display_name: a.display_name, avatar: C.json(u.avatar, {}), tier: C.tierName(C.effectiveTier(a, at)), kyc: a.kyc_status },
    sla: p.sla_due_at ? { due_at: p.sla_due_at, overdue: ['requested', 'approved', 'processing'].includes(p.status) && at > p.sla_due_at, left_ms: p.sla_due_at - at } : null,
    checks: flags.length ? flags : ['Clean'], four_eyes: big ? { needed: true, approved_by: approver ? approver.name : null, you_approved: p.approved_by === me.id, next: p.status === 'requested' ? 'approve' : p.status === 'approved' ? 'send' : null } : { needed: false },
    own: a.user_id === me.id,
  };
}

/** An adjustment waiting for (or past) its second approval, for the back office. */
function adjView(x, me = null) {
  const a = C.byId(x.affiliate_id);
  const by = x.requested_by ? D.get('SELECT name FROM users WHERE id=?', x.requested_by) : null;
  const dec = x.decided_by ? D.get('SELECT name FROM users WHERE id=?', x.decided_by) : null;
  return { id: x.id, affiliate_id: x.affiliate_id, affiliate: a ? a.display_name : '', amount_cents: x.amount_cents, reason: x.reason, status: x.status,
    requested_by: by ? by.name : '', requested_at: x.created_at, decided_by: dec ? dec.name : '', decided_at: x.decided_at, decision_note: x.decision_note || '',
    commission_id: x.commission_id, mine: !!me && x.requested_by === me.id };
}

module.exports = function routes(r) {
  /* ================= who am I ================= */
  r.get('/api/admin/aff/me', (ctx) => {
    const me = need(ctx, 'any'); const ro = P.roles(me);
    const sc = P.scopeSql(me);
    return { roles: ro, manager: D.get('SELECT * FROM aff_managers WHERE user_id=?', me.id) ? P.managerView({ ...D.get('SELECT m.*, u.name, u.avatar FROM aff_managers m JOIN users u ON u.id=m.user_id WHERE m.user_id=?', me.id), kinds: json(D.get('SELECT kinds FROM aff_managers WHERE user_id=?', me.id).kinds, []), languages: [], countries: [] }) : null,
      counts: { affiliates: D.get(`SELECT COUNT(*) n FROM aff_affiliates a WHERE ${sc.sql}`, ...sc.args).n, applications: D.get(`SELECT COUNT(*) n FROM aff_affiliates a WHERE a.status='pending' AND a.applied_at IS NOT NULL AND ${sc.sql}`, ...sc.args).n, cpa: ro.fraud ? D.get("SELECT COUNT(*) n FROM aff_cpa_reviews WHERE status='pending'").n : 0, payouts: ro.finance ? D.get("SELECT COUNT(*) n FROM aff_payouts WHERE status IN ('requested','approved','held')").n : 0 } };
  });

  /* ================= overview ================= */
  r.get('/api/admin/aff/overview', (ctx) => {
    need(ctx, 'admin'); const at = C.clock(ctx);
    const o = R.overview(at);
    const top = o.top.map((id) => V.adminRow(C.byId(id), at));
    const today = [];
    const sla = C.settings().approval_sla_days * DAY;
    for (const a of D.all("SELECT * FROM aff_affiliates WHERE status='pending' AND applied_at IS NOT NULL AND applied_at<? ORDER BY applied_at LIMIT 5", at - sla).map(C.hydrate)) today.push({ kind: 'application_overdue', title: 'Application overdue', text: `${a.display_name} · ${ageTxt(at - a.applied_at - sla)} past the ${C.settings().approval_sla_days}-day target`, href: '#/admin/approvals', tone: 'r' });
    if (o.payouts_due.four_eyes) today.push({ kind: 'four_eyes', title: `${o.payouts_due.four_eyes} payout${o.payouts_due.four_eyes === 1 ? ' needs' : 's need'} a second finance user`, text: 'Over the four-eyes limit', href: '#/admin/payouts', tone: 'amb' });
    const adjN = D.get("SELECT COUNT(*) n FROM aff_adjustment_requests WHERE status='pending'").n;
    if (adjN) today.push({ kind: 'adjustment_four_eyes', title: `${adjN} adjustment${adjN === 1 ? ' needs' : 's need'} a second approval`, text: `Positive adjustments over ${C.fmtUsd(C.settings().adjustments.four_eyes_cents)}`, href: '#/admin/payouts', tone: 'amb' });
    for (const a of D.all("SELECT * FROM aff_affiliates WHERE cpa_paused=1 AND status='approved' LIMIT 3").map(C.hydrate)) today.push({ kind: 'cpa_paused', title: 'CPA auto-paused', text: `${a.display_name} · ${a.cpa_paused_reason}`, href: '#/fraud/flags', tone: 'r' });
    for (const a of D.all('SELECT * FROM aff_affiliates WHERE legend_pending=1 AND legend_approved=0 LIMIT 3').map(C.hydrate)) today.push({ kind: 'legend', title: 'Legend review', text: `${a.display_name} reached Legend volume`, href: `#/admin/affiliate/${a.id}`, tone: 'g' });
    for (const ch of D.all('SELECT * FROM aff_offer_changes WHERE applied_at IS NULL ORDER BY effective_at LIMIT 3')) today.push({ kind: 'scheduled_change', title: 'Scheduled deal change', text: `${E.prodName(ch.product_key)} ${ch.field} ${ch.field === 'cpa' ? C.fmtUsd(Number(ch.old_value)) + ' → ' + C.fmtUsd(Number(ch.new_value)) : ''} on ${C.dayKey(ch.effective_at)}`, href: '#/admin/deals', tone: 'w' });
    return { ...o, top, today };
  });

  /* ================= affiliates ================= */
  const listAffiliates = (ctx, me, max = 200) => {
    const q = ctx.query; const sc = P.scopeSql(me);
    const where = [sc.sql]; const args = [...sc.args];
    if (q.status) { where.push('a.status=?'); args.push(String(q.status)); } else where.push("a.status<>'closed'");
    if (q.manager) { where.push('(a.general_manager_id=? OR a.private_manager_id=?)'); args.push(Number(q.manager), Number(q.manager)); }
    if (q.kyc) { where.push('a.kyc_status=?'); args.push(String(q.kyc)); }
    if (q.fraud_min) { where.push('a.fraud_score>=?'); args.push(Number(q.fraud_min)); }
    if (q.q) { const like = `%${clean(q.q, 80).toLowerCase()}%`; where.push("(lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR lower(a.display_name) LIKE ? OR a.code=? OR u.voo_id=? OR a.wallet_usdt=? OR a.wallet_btc=? OR ('af-' || a.id)=?)"); args.push(like, like, like, String(q.q).toLowerCase(), String(q.q), String(q.q), String(q.q), String(q.q).toLowerCase()); }
    const rows = D.all(`SELECT a.* FROM aff_affiliates a JOIN users u ON u.id=a.user_id WHERE ${where.join(' AND ')} ORDER BY a.id DESC LIMIT ?`, ...args, max).map(C.hydrate);
    const at = C.clock(ctx); const reveal = A.can(me, 'customers') || P.roles(me).admin;
    let out = rows.map((a) => V.adminRow(a, at, { reveal }));
    if (q.tier !== undefined && q.tier !== '') out = out.filter((x) => x.tier === q.tier || String(x.tier_idx) === String(q.tier));
    return out;
  };
  r.get('/api/admin/aff/affiliates', (ctx) => {
    const me = need(ctx, 'any');
    const rows = listAffiliates(ctx, me);
    return { affiliates: rows, counts: { active: D.get("SELECT COUNT(*) n FROM aff_affiliates WHERE status='approved'").n, paused: D.get("SELECT COUNT(*) n FROM aff_affiliates WHERE status='suspended'").n, closed: D.get("SELECT COUNT(*) n FROM aff_affiliates WHERE status='closed'").n } };
  });
  r.get('/api/admin/aff/affiliates.csv', (ctx) => {
    const me = need(ctx, 'admin');
    const rows = listAffiliates(ctx, me, 20000);
    C.audit(me, 'export.affiliates', { target: `${rows.length} rows` });
    sendCsv(ctx, [['ref', 'name', 'display_name', 'email', 'country', 'status', 'tier', 'qualified_mtd', 'commission_mtd_usd', 'adjustments_mtd_usd', 'refund_rate', 'fraud_score', 'kyc', 'health', 'general_manager', 'private_manager'],
      ...rows.map((x) => [x.ref, x.name, x.display_name, x.email, x.country, x.status, x.tier, x.qualified_mtd, C.usd(x.commission_mtd_cents).toFixed(2), C.usd(x.adjustments_mtd_cents || 0).toFixed(2), x.refund_rate, x.fraud_score, x.kyc, x.health, x.general_manager ? x.general_manager.name : '', x.private_manager ? x.private_manager.name : ''])], `voosquare-affiliates-${C.dayKey(now())}.csv`);
  });
  r.get('/api/admin/aff/affiliates/:id', (ctx) => {
    const me = need(ctx, 'any'); const ro = P.roles(me); const at = C.clock(ctx);
    const a = affOr404(me, ctx.params.id);
    const row = V.adminRow(a, at, { reveal: A.can(me, 'customers') || ro.admin });
    const fs = F.affiliateScore(a.id, at);
    return {
      affiliate: row, account: { ...V.me(a, at), wallets: ro.finance ? { usdt_trc20: a.wallet_usdt, btc: a.wallet_btc, method: a.payout_method } : V.me(a, at).wallets },
      application: a.application, checks: P.appChecks(a), balance: E.balance(a.id, at), tier: V.tierCard(a, at), health: V.health(a, at), fraud: fs,
      deals: D.all('SELECT * FROM aff_deals WHERE affiliate_id=? ORDER BY id DESC', a.id).map(R.dealView), deal_requests: D.all('SELECT * FROM aff_deal_requests WHERE affiliate_id=? ORDER BY id DESC LIMIT 20', a.id),
      notes: D.all('SELECT n.*, u.name author FROM aff_notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.affiliate_id=? ORDER BY n.id DESC LIMIT 50', a.id).map((n) => ({ id: n.id, body: n.body, shared: !!n.shared, author: n.author, at: n.created_at, from_affiliate: n.author_id === a.user_id })),
      audit: D.all('SELECT x.*, u.name actor FROM aff_audit x LEFT JOIN users u ON u.id=x.actor_id WHERE x.affiliate_id=? ORDER BY x.id DESC LIMIT 30', a.id).map((x) => ({ at: x.created_at, actor: x.actor || 'System', action: x.action, target: x.target })),
      kyc: KYC.state(a), kyc_docs: ro.finance ? up.lookup(D.all('SELECT upload_id FROM aff_kyc_docs WHERE affiliate_id=?', a.id).map((d) => d.upload_id)) : {},
      subs: D.all('SELECT id, display_name, status FROM aff_affiliates WHERE parent_affiliate_id=?', a.id).map((x) => ({ ref: `AF-${x.id}`, name: x.display_name, status: x.status })),
      custom_deals: P.revshareDealsFor(a.id, at), can_create_custom_deal: ro.admin,
      adjustment_requests: ro.finance ? D.all('SELECT * FROM aff_adjustment_requests WHERE affiliate_id=? ORDER BY id DESC LIMIT 20', a.id).map((x) => adjView(x, me)) : [],
      adjustments_four_eyes_cents: C.settings().adjustments.four_eyes_cents,
      // Commission never includes manual adjustments; they are their own figure (QA-7, SV-1).
      adjustments_mtd_cents: row.adjustments_mtd_cents,
      series: R.series(a.id, 30, at), payouts: ro.finance ? D.all('SELECT * FROM aff_payouts WHERE affiliate_id=? ORDER BY id DESC LIMIT 20', a.id).map((p) => PAY.view(p)) : [],
    };
  });
  r.patch('/api/admin/aff/affiliates/:id', async (ctx) => {
    const me = need(ctx, 'any'); const ro = P.roles(me);
    const a = affOr404(me, ctx.params.id);
    const b = await ctx.json();
    if (a.user_id === me.id) fail(403, 'You cannot change your own affiliate account.');
    const sets = {};
    if (b.tier_override !== undefined || b.tier_floor !== undefined || b.legend_approved !== undefined || b.health_exempt !== undefined) {
      if (!ro.admin) fail(403, 'Only a program admin can change tiers and health.');
      const n = C.tiers().length;
      if (b.tier_override !== undefined) sets.tier_override = b.tier_override === null || b.tier_override === '' ? null : Math.max(0, Math.min(n - 1, Math.floor(Number(b.tier_override))));
      if (b.tier_floor !== undefined) { sets.tier_floor = b.tier_floor === null || b.tier_floor === '' ? null : Math.max(0, Math.min(n - 1, Math.floor(Number(b.tier_floor)))); sets.tier_floor_until = b.floor_until ? Date.parse(b.floor_until) || 0 : sets.tier_floor === null ? 0 : now() + 90 * DAY; }
      if (b.legend_approved !== undefined) { sets.legend_approved = b.legend_approved ? 1 : 0; if (b.legend_approved) sets.legend_pending = 0; }
      if (b.health_exempt !== undefined) sets.health_exempt = b.health_exempt ? 1 : 0;
    }
    if (b.cpa_paused !== undefined) {
      if (!ro.fraud) fail(403, 'Only fraud-check managers and admins can pause CPA.');
      if (b.cpa_paused && clean(b.reason, 300).length < 3) fail(400, 'Add a reason for pausing CPA.');
      sets.cpa_paused = b.cpa_paused ? 1 : 0; sets.cpa_paused_reason = b.cpa_paused ? clean(b.reason, 300) : '';
    }
    const keys = Object.keys(sets);
    if (keys.length) { D.run(`UPDATE aff_affiliates SET ${keys.map((k) => k + '=?').join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => sets[k]), now(), a.id); C.audit(me, 'affiliate.update', { affiliate_id: a.id, before: Object.fromEntries(keys.map((k) => [k, a[k]])), after: sets }); }
    let out = C.byId(a.id);
    if (b.status !== undefined) { if (!ro.admin) fail(403, 'Only a program admin can pause or close an account.'); out = P.setStatus(me, out, b.status === 'active' ? 'approved' : b.status === 'paused' ? 'suspended' : b.status, b.reason); }
    return { affiliate: V.adminRow(out, C.clock(ctx)) };
  });
  r.put('/api/admin/aff/affiliates/:id/managers', async (ctx) => {
    const me = need(ctx, 'admin');
    const a = affOr404(me, ctx.params.id);
    return { affiliate: V.adminRow(P.setManagers(me, a, await ctx.json()), C.clock(ctx)) };
  });
  r.post('/api/admin/aff/affiliates/:id/notes', async (ctx) => {
    const me = need(ctx, 'manager');
    const a = affOr404(me, ctx.params.id);
    const b = await ctx.json(); const body = clean(b.body, 2000);
    if (body.length < 2) fail(400, 'Write a note.');
    const id = D.insert('aff_notes', { affiliate_id: a.id, author_id: me.id, body, shared: b.shared ? 1 : 0, created_at: now() }).id;
    C.audit(me, 'note.add', { affiliate_id: a.id, after: { shared: !!b.shared } });
    if (b.shared) require('../aff/notify').inApp(a, 'announcement', `New note from ${me.name}: ${body.slice(0, 140)}`);
    return { note: D.get('SELECT * FROM aff_notes WHERE id=?', id) };
  });
  /* Manual adjustments (owner decision 2026-10-05): a reason is always required; a positive adjustment above
   * settings.adjustments.four_eyes_cents ($500 by default) waits for a second finance/admin user (never the requester);
   * an idempotency key makes a retried request a no-op; the same affiliate + amount + reason again within
   * dup_window_sec (60 s) is refused as a double click. */
  r.post('/api/admin/aff/affiliates/:id/adjustments', async (ctx) => {
    const me = need(ctx, 'finance');
    const a = affOr404(me, ctx.params.id);
    if (a.user_id === me.id) fail(403, 'You cannot adjust your own balance.');
    const b = await ctx.json();
    const cents = Math.round(Number(b.amount_usd) * 100);
    if (!Number.isFinite(cents) || cents === 0 || Math.abs(cents) > 10_000_000) fail(400, 'Set an amount (negative to deduct).');
    const reason = clean(b.reason, 300);
    if (reason.length < 3) fail(400, 'Add a reason. The affiliate sees it on the ledger.');
    const idem = clean(b.idempotency_key || ctx.req.headers['idempotency-key'] || '', 80);
    if (idem && !/^[A-Za-z0-9_.:-]{8,80}$/.test(idem)) fail(400, 'The idempotency key must be 8 to 80 letters, numbers, dots, dashes or colons.');
    const cfg = C.settings().adjustments;
    const t = now();
    // Same key again: answer with what the first request did (nothing new is created).
    if (idem) {
      const done = D.get('SELECT * FROM aff_commissions WHERE uniq_key=?', `adj:${a.id}:k:${idem}`);
      if (done) return { commission: V.ledgerRow(done), balance: E.balance(a.id), replayed: true };
      const rq = D.get('SELECT * FROM aff_adjustment_requests WHERE idem_key=?', `${a.id}:${idem}`);
      if (rq) return { request: adjView(rq), pending_approval: rq.status === 'pending', balance: E.balance(a.id), replayed: true };
    }
    const since = t - Math.max(1, Number(cfg.dup_window_sec) || 60) * 1000;
    const dup = D.get("SELECT 1 FROM aff_commissions WHERE affiliate_id=? AND uniq_key LIKE 'adj%' AND amount_cents=? AND reason=? AND created_at>?", a.id, cents, reason, since)
      || D.get('SELECT 1 FROM aff_adjustment_requests WHERE affiliate_id=? AND amount_cents=? AND reason=? AND created_at>?', a.id, cents, reason, since);
    if (dup) fail(409, 'The same adjustment (amount and reason) was just added for this affiliate. If you really mean a second one, wait a minute or change the reason.');
    if (cents > 0 && cents > Math.max(0, Number(cfg.four_eyes_cents) || 0)) {
      const id = D.insert('aff_adjustment_requests', { affiliate_id: a.id, amount_cents: cents, reason, idem_key: idem ? `${a.id}:${idem}` : null, status: 'pending', requested_by: me.id, created_at: t }).id;
      C.audit(me, 'adjustment.request', { affiliate_id: a.id, target: `adjustment request #${id}`, after: { cents, reason } });
      return { request: adjView(D.get('SELECT * FROM aff_adjustment_requests WHERE id=?', id)), pending_approval: true, balance: E.balance(a.id) };
    }
    const c = E.addCommission({ affiliate_id: a.id, type: cents < 0 ? 'clawback' : 'adjustment', amount_cents: cents, status: 'available', reason, approved_by: me.id, uniq_key: idem ? `adj:${a.id}:k:${idem}` : `adj:${a.id}:${t}:${Math.random()}` });
    C.audit(me, 'adjustment.create', { affiliate_id: a.id, after: { cents, reason } });
    return { commission: V.ledgerRow(c), balance: E.balance(a.id) };
  });
  r.get('/api/admin/aff/adjustments', (ctx) => {
    const me = need(ctx, 'finance');
    const st = ['pending', 'approved', 'declined'].includes(ctx.query.status) ? ctx.query.status : null;
    const rows = D.all(`SELECT * FROM aff_adjustment_requests ${st ? 'WHERE status=?' : ''} ORDER BY id DESC LIMIT 200`, ...(st ? [st] : []));
    return { requests: rows.map((x) => adjView(x, me)), four_eyes_cents: C.settings().adjustments.four_eyes_cents };
  });
  r.post('/api/admin/aff/adjustments/:id/:action', async (ctx) => {
    const me = need(ctx, 'finance');
    if (!['approve', 'decline'].includes(ctx.params.action)) fail(404, 'Unknown action.');
    const b = await ctx.json();
    const rq = D.get('SELECT * FROM aff_adjustment_requests WHERE id=?', Number(ctx.params.id));
    if (!rq) fail(404, 'Adjustment request not found.');
    const a = affOr404(me, rq.affiliate_id);
    if (rq.status !== 'pending') fail(409, `This adjustment is already ${rq.status}.`);
    if (rq.requested_by === me.id) fail(403, 'Four eyes: a second finance or admin user has to approve or decline your own request.');
    if (a.user_id === me.id) fail(403, 'You cannot approve an adjustment to your own balance.');
    const note = clean(b.note, 300);
    const t = now();
    let com = null;
    D.tx(() => {
      if (!D.run("UPDATE aff_adjustment_requests SET status=?, decided_by=?, decided_at=?, decision_note=? WHERE id=? AND status='pending'", ctx.params.action === 'approve' ? 'approved' : 'declined', me.id, t, note, rq.id).changes) fail(409, 'Someone else just decided this adjustment.');
      if (ctx.params.action === 'approve') {
        com = E.addCommission({ affiliate_id: a.id, type: 'adjustment', amount_cents: rq.amount_cents, status: 'available', reason: rq.reason, approved_by: me.id, uniq_key: `adjreq:${rq.id}` });
        if (com) D.run('UPDATE aff_adjustment_requests SET commission_id=? WHERE id=?', com.id, rq.id);
      }
    });
    C.audit(me, 'adjustment.' + ctx.params.action, { affiliate_id: a.id, target: `adjustment request #${rq.id}`, after: { cents: rq.amount_cents, reason: rq.reason, requested_by: rq.requested_by, note } });
    return { request: adjView(D.get('SELECT * FROM aff_adjustment_requests WHERE id=?', rq.id), me), commission: com ? V.ledgerRow(com) : null, balance: E.balance(a.id) };
  });
  r.post('/api/admin/aff/attributions', async (ctx) => {
    const me = need(ctx, 'admin');
    const b = await ctx.json();
    const user = D.get('SELECT * FROM users WHERE id=?', Number(b.user_id));
    const a = C.byId(b.affiliate_id);
    if (!user || !a) fail(404, 'Member or affiliate not found.');
    if (E.attribution(user.id)) fail(409, 'This member is already attributed. Attribution is locked for life.');
    if (clean(b.reason, 300).length < 3) fail(400, 'Add a reason (it is logged).');
    D.run('INSERT INTO aff_attributions(customer_user_id,affiliate_id,method,pre_existing,locked_at,cust_ref,country) VALUES(?,?,?,?,?,?,?)', user.id, a.id, 'manual', 1, now(), C.custRef(a.id, user.id), user.country || '');
    C.audit(me, 'attribution.manual', { affiliate_id: a.id, target: C.vooRef(user.id), after: { reason: clean(b.reason, 300) } });
    return { ok: true };
  });

  /* ================= applications ================= */
  r.get('/api/admin/aff/applications', (ctx) => {
    const me = need(ctx, 'manager'); const at = C.clock(ctx);
    const sc = P.scopeSql(me); const st = ['pending', 'rejected', 'approved'].includes(ctx.query.status) ? ctx.query.status : 'pending';
    const sla = C.settings().approval_sla_days * DAY;
    const rows = D.all(`SELECT a.* FROM aff_affiliates a WHERE a.status=? AND a.applied_at IS NOT NULL AND ${sc.sql} ORDER BY a.escalated DESC, a.applied_at LIMIT 200`, st, ...sc.args).map(C.hydrate);
    return { applications: rows.map((a) => {
      const u = D.get('SELECT name, avatar FROM users WHERE id=?', a.user_id) || {};
      const app = a.application || {};
      const due = a.applied_at + sla;
      return { id: a.id, ref: `AF-${a.id}`, name: u.name, display_name: a.display_name, avatar: C.json(u.avatar, {}), country: a.country, telegram: a.telegram, applied_at: a.applied_at, age: ageTxt(at - a.applied_at),
        sla: { due_at: due, overdue: at > due, text: at > due ? `Overdue ${ageTxt(at - due)}` : `Due in ${ageTxt(due - at)}` }, sources: app.sources || [], volume: app.volume || '', years: app.years || '', geos: app.geos || [],
        verticals: app.verticals || [], links: app.links || [], plan: app.plan || '', products: app.products || [], networks: app.networks || '', checks: P.appChecks(a), escalated: !!a.escalated, info_request: a.info_request, info_replies: app.info_replies || [],
        general_manager: V.userCard(a.general_manager_id), status: a.status, decline_reasons: a.decline_reasons };
    }), reasons: P.DECLINE_APP };
  });
  const appAction = (fn) => async (ctx) => {
    const me = need(ctx, 'manager');
    const a = affOr404(me, ctx.params.id);
    const b = await ctx.json();
    return { affiliate: V.adminRow(fn(me, a, b), C.clock(ctx)) };
  };
  r.post('/api/admin/aff/applications/:id/approve', appAction((me, a, b) => P.approve(me, a, now())));
  r.post('/api/admin/aff/applications/:id/reject', appAction((me, a, b) => P.reject(me, a, b.reasons, b.note)));
  r.post('/api/admin/aff/applications/:id/info', appAction((me, a, b) => P.askInfo(me, a, b.text)));
  r.post('/api/admin/aff/applications/:id/escalate', appAction((me, a) => P.escalate(me, a)));

  /* ================= CPA review and fraud ================= */
  r.get('/api/admin/aff/cpa', (ctx) => {
    const me = need(ctx, 'fraud'); const at = C.clock(ctx);
    const st = ['pending', 'approved', 'declined'].includes(ctx.query.status) ? ctx.query.status : 'pending';
    const rows = D.all(`SELECT * FROM aff_cpa_reviews WHERE status=? ${ctx.query.affiliate ? 'AND affiliate_id=?' : ''} ORDER BY ${st === 'pending' ? 'risk DESC, created_at ASC' : 'decided_at DESC'} LIMIT 300`, ...[st, ...(ctx.query.affiliate ? [Number(ctx.query.affiliate)] : [])]);
    const day0 = C.dayStartAt(at);
    const stats = D.get("SELECT COUNT(CASE WHEN status='pending' THEN 1 END) q, COUNT(CASE WHEN status='approved' AND decided_at>=? THEN 1 END) ok, COUNT(CASE WHEN status='declined' AND decided_at>=? THEN 1 END) no, COALESCE(SUM(CASE WHEN status='pending' THEN amount_cents END),0) stake FROM aff_cpa_reviews", day0, day0);
    void me;
    return { queue: rows.map((rv) => cpaView(rv, at)), stats: { in_queue: stats.q, approved_today: stats.ok, declined_today: stats.no, at_stake_cents: stats.stake }, reasons: E.DECLINE, bulk_max_risk: C.settings().cpa.bulk_max_risk };
  });
  r.get('/api/admin/aff/cpa/:id', (ctx) => {
    need(ctx, 'fraud');
    const rv = D.get('SELECT * FROM aff_cpa_reviews WHERE id=?', Number(ctx.params.id));
    if (!rv) fail(404, 'Conversion not found.');
    return { conversion: cpaView(rv, C.clock(ctx), { full: true }), reasons: E.DECLINE };
  });
  /* One-tap duplicate check: a fresh analysis with masked evidence; the stored risk and verdict are updated. */
  r.post('/api/admin/aff/cpa/:id/check', (ctx) => {
    const me = need(ctx, 'fraud');
    const rv = D.get('SELECT * FROM aff_cpa_reviews WHERE id=?', Number(ctx.params.id));
    if (!rv) fail(404, 'Conversion not found.');
    limit('aff-dup:' + me.id, 120, 60_000);
    const fa = F.analyse(rv.customer_user_id, C.clock(ctx));
    D.run('UPDATE aff_cpa_reviews SET risk=?, verdict=?, signals=? WHERE id=?', fa.risk, fa.verdict, JSON.stringify(fa.signals.map((s) => s.key)), rv.id);
    return { verdict: fa.verdict, risk: fa.risk, signals: fa.signals, matches: fa.matches, email_masked: fa.email, checked: Object.keys(F.LABELS) };
  });
  const decide = (action) => async (ctx) => {
    const me = need(ctx, 'fraud');
    const b = await ctx.json();
    const rv = E.decideCpa(Number(ctx.params.id), me, action, { reason: b.reason, note: b.note, at: C.clock(ctx) });
    return { conversion: cpaView(rv, C.clock(ctx)) };
  };
  r.post('/api/admin/aff/cpa/:id/approve', decide('approve'));
  r.post('/api/admin/aff/cpa/:id/decline', decide('decline'));
  r.post('/api/admin/aff/cpa/:id/extend', decide('extend'));
  r.post('/api/admin/aff/cpa/bulk-approve', async (ctx) => {
    const me = need(ctx, 'fraud');
    const b = await ctx.json();
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).slice(0, 100);
    if (!ids.length) fail(400, 'Choose conversions.');
    const rows = ids.map((id) => D.get('SELECT * FROM aff_cpa_reviews WHERE id=?', id));
    const max = C.settings().cpa.bulk_max_risk;
    if (rows.some((x) => !x || x.status !== 'pending')) fail(409, 'Some conversions are already decided. Refresh the queue.');
    if (rows.some((x) => x.risk >= max) || new Set(rows.map((x) => x.affiliate_id)).size !== 1) fail(400, `Bulk approve needs risk under ${max} and one affiliate.`);
    const at = C.clock(ctx);
    for (const x of rows) E.decideCpa(x.id, me, 'approve', { note: 'Bulk approve', at });
    C.audit(me, 'cpa.bulk_approve', { affiliate_id: rows[0].affiliate_id, after: { ids } });
    return { approved: rows.length };
  });
  r.get('/api/admin/aff/fraud/signals', (ctx) => {
    need(ctx, 'fraud'); const at = C.clock(ctx);
    const since = at - 30 * DAY;
    const custs = D.all('SELECT t.customer_user_id id, t.affiliate_id aff FROM aff_attributions t WHERE t.locked_at>?', since);
    const cards = {};
    const add = (key, affId) => { const c = cards[key] || (cards[key] = { key, label: F.LABELS[key], count: 0, by: {} }); c.count++; c.by[affId] = (c.by[affId] || 0) + 1; };
    for (const c of custs.slice(0, 3000)) {
      const ids = D.all('SELECT kind FROM aff_identities WHERE user_id=?', c.id).map((x) => x.kind);
      if (ids.includes('proxy')) add('proxy', c.aff);
      const u = D.get('SELECT email FROM users WHERE id=?', c.id);
      if (u && F.isDisposable(u.email)) add('disposable', c.aff);
    }
    for (const r2 of D.all(`SELECT a.user_id, t.affiliate_id aff FROM aff_identities a JOIN aff_identities b ON a.kind='fp' AND b.kind='fp' AND a.value=b.value AND a.user_id<>b.user_id JOIN aff_attributions t ON t.customer_user_id=a.user_id WHERE t.locked_at>? GROUP BY a.user_id`, since)) add('device', r2.aff);
    for (const r2 of D.all(`SELECT v.affiliate_id aff FROM aff_conversions v JOIN aff_conversions p ON p.id=v.related_id WHERE v.event_type IN ('refund','chargeback') AND v.occurred_at>? AND v.occurred_at - p.occurred_at < ?`, since, DAY)) add('instant_refund', r2.aff);
    for (const r2 of D.all('SELECT t.affiliate_id aff FROM aff_attributions t JOIN aff_clicks k ON k.id=t.click_id JOIN users u ON u.id=t.customer_user_id WHERE t.locked_at>? AND u.created_at - k.created_at < 5000', since)) add('fast_signup', r2.aff);
    for (const r2 of D.all('SELECT a.id FROM aff_affiliates a WHERE a.status=\'approved\'')) {
      const day = D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>?', r2.id, at - DAY).n;
      const base = D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>? AND locked_at<=?', r2.id, at - 15 * DAY, at - DAY).n / 14;
      if (day >= 10 && day >= 5 * Math.max(base, 1)) { const c = cards.velocity || (cards.velocity = { key: 'velocity', label: F.LABELS.velocity, count: 0, by: {} }); c.count++; c.by[r2.id] = Math.round((10 * day) / Math.max(base, 1)) / 10; }
    }
    const name = (id) => (C.byId(id) || {}).display_name || `AF-${id}`;
    return { weights: C.settings().fraud.weights, cards: Object.values(cards).map((c) => ({ key: c.key, label: c.label, count: c.count, affiliates: Object.entries(c.by).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([id, n]) => ({ id: Number(id), name: name(Number(id)), value: n })) })) };
  });
  r.get('/api/admin/aff/fraud/velocity/:id', (ctx) => {
    const me = need(ctx, 'fraud'); const a = affOr404(me, ctx.params.id); const at = C.clock(ctx);
    const days = []; for (let i = 20; i >= 0; i--) { const f = C.dayStartAt(at - i * DAY); days.push({ day: C.dayKey(f + 3 * C.HOUR), signups: D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>=? AND locked_at<?', a.id, f, f + DAY).n }); }
    return { series: days };
  });
  r.get('/api/admin/aff/fraud/flags', (ctx) => {
    need(ctx, 'fraud'); const at = C.clock(ctx);
    const rows = D.all("SELECT * FROM aff_affiliates WHERE status IN ('approved','suspended') AND (cpa_paused=1 OR fraud_score>=40) ORDER BY fraud_score DESC LIMIT 100").map(C.hydrate);
    return { flags: rows.map((a) => { const d = D.get("SELECT COUNT(*) n, COUNT(CASE WHEN status='declined' THEN 1 END) dn FROM aff_cpa_reviews WHERE affiliate_id=? AND decided_at>? AND decline_reason<>'over_cap'", a.id, at - 30 * DAY); const u = D.get('SELECT name, avatar FROM users WHERE id=?', a.user_id) || {};
      return { id: a.id, ref: `AF-${a.id}`, name: u.name, display_name: a.display_name, avatar: C.json(u.avatar, {}), fraud_score: a.fraud_score, decline_rate: d.n ? Math.round((1000 * d.dn) / d.n) / 10 : 0, state: a.cpa_paused ? 'CPA auto-paused' : 'Watching', why: a.cpa_paused_reason || 'Fraud score' }; }) };
  });
  r.post('/api/admin/aff/clawbacks', async (ctx) => {
    const me = need(ctx, 'fraud');
    const b = await ctx.json();
    const a = affOr404(me, b.affiliate_id);
    const ids = (Array.isArray(b.commission_ids) ? b.commission_ids : []).map(Number).slice(0, 200);
    const rows = ids.map((id) => D.get("SELECT * FROM aff_commissions WHERE id=? AND affiliate_id=? AND amount_cents>0 AND status IN ('hold','available','paid','pending_activation')", id, a.id)).filter(Boolean);
    if (!rows.length) fail(400, 'Choose commissions to claw back.');
    const reason = clean(b.reason, 300); if (reason.length < 3) fail(400, 'Add the reason.');
    const paidLimit = C.settings().cpa.fraud_clawback_days * DAY;
    if (rows.some((x) => x.status === 'paid' && now() - x.updated_at > paidLimit)) fail(400, `Paid commissions can be clawed back for fraud within ${C.settings().cpa.fraud_clawback_days} days of payout.`);
    const id = D.insert('aff_clawbacks', { affiliate_id: a.id, commission_ids: JSON.stringify(rows.map((x) => x.id)), amount_cents: rows.reduce((s, x) => s + x.amount_cents, 0), reason, status: 'pending', proposed_by: me.id, created_at: now() }).id;
    C.audit(me, 'clawback.propose', { affiliate_id: a.id, after: { id, reason } });
    return { clawback: D.get('SELECT * FROM aff_clawbacks WHERE id=?', id) };
  });
  // Lists across affiliates: managers see only their assigned affiliates' rows (P.scopeSql), like every other list.
  r.get('/api/admin/aff/clawbacks', (ctx) => { const me = need(ctx, 'any'); const sc = P.scopeSql(me); return { clawbacks: D.all(`SELECT c.*, u.name proposer FROM aff_clawbacks c JOIN aff_affiliates a ON a.id=c.affiliate_id LEFT JOIN users u ON u.id=c.proposed_by WHERE ${sc.sql} ORDER BY c.id DESC LIMIT 200`, ...sc.args) }; });
  r.post('/api/admin/aff/clawbacks/:id/:action', async (ctx) => {
    const me = need(ctx, 'finance');
    const cb = D.get('SELECT * FROM aff_clawbacks WHERE id=?', Number(ctx.params.id));
    if (!cb) fail(404, 'Clawback not found.');
    if (cb.status !== 'pending') fail(409, `Already ${cb.status}.`);
    if (cb.proposed_by === me.id) fail(403, 'Another staff member has to approve the clawback you proposed.');
    const a = C.byId(cb.affiliate_id);
    if (a.user_id === me.id) fail(403, 'You cannot decide a clawback on your own account.');
    if (ctx.params.action === 'approve') {
      // Proven fraud (or a terms breach) reverses even final earnings: held ones are cancelled, released or paid ones get a
      // negative clawback row (owed, deducted from the next payout). Two people: proposer and a different finance user.
      let reversed = 0;
      for (const id of json(cb.commission_ids, [])) { const c = D.get('SELECT * FROM aff_commissions WHERE id=?', id); if (c) reversed += E.reverseCommission(c, 1, 'fraud', 'cb' + cb.id, now(), me.id, `Fraud reversal #${cb.id}`); }
      D.run("UPDATE aff_clawbacks SET status='approved', decided_by=?, decided_at=? WHERE id=?", me.id, now(), cb.id);
      const a2 = C.byId(cb.affiliate_id);
      if (a2 && reversed > 0) require('../aff/notify').emit(a2, 'chargeback', { text: `Fraud reversal #${cb.id}: ${C.fmtUsd(reversed)} reversed after a proven fraud finding. Your manager can explain.` });
    } else if (ctx.params.action === 'reject') D.run("UPDATE aff_clawbacks SET status='rejected', decided_by=?, decided_at=? WHERE id=?", me.id, now(), cb.id);
    else fail(404, 'Unknown action.');
    C.audit(me, 'clawback.' + ctx.params.action, { affiliate_id: cb.affiliate_id, target: `#${cb.id}`, after: { reason: cb.reason, amount_cents: cb.amount_cents } });
    return { clawback: D.get('SELECT * FROM aff_clawbacks WHERE id=?', cb.id), balance: E.balance(cb.affiliate_id) };
  });

  /* ================= products, deals, offer changes ================= */
  r.get('/api/admin/aff/products', (ctx) => {
    const me = need(ctx, 'any'); const sc = P.scopeSql(me);
    return { products: C.productList().map((p) => ({ ...p, cap_pct: p.cap_bp / 100, suggested_cpa_cents: p.plans.length ? Math.max(...p.plans.map((x) => C.suggestCpa(x.price_cents, p.payg))) : 0,
      plans: planRows(p.key).map((x) => ({ ...x, confirmed: x.price_source === 'admin', needs_review: x.price_source !== 'admin' || x.mismatch_count > 0, suggested_cpa_cents: C.suggestCpa(x.price_cents, p.payg) })),
      plans_to_review: planRows(p.key).filter((x) => x.price_source !== 'admin' || x.mismatch_count > 0).length,
      last_sync: planRows(p.key).reduce((m, x) => Math.max(m, x.reported_at || x.synced_at || 0), 0) || null })),
    changes: D.all(`SELECT c.* FROM aff_offer_changes c LEFT JOIN aff_affiliates a ON a.id=c.affiliate_id WHERE (c.affiliate_id IS NULL OR ${sc.sql}) ORDER BY c.id DESC LIMIT 50`, ...sc.args) };
  });
  r.put('/api/admin/aff/products/:key', async (ctx) => { const me = need(ctx, 'admin'); return P.updateProduct(me, ctx.params.key, await ctx.json(), C.clock(ctx)); });
  /* Plan catalogue (admin-owned): set or confirm a plan's price, or remove a plan name a tool sent by mistake. Tools' plan
   * events never change a catalogue price; they only record what the customer paid and flag a difference here. */
  r.put('/api/admin/aff/products/:key/plans', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    const p = C.product(ctx.params.key);
    if (!p) fail(404, 'Unknown product.');
    const plan = C.clean(b.plan, 60);
    if (!plan) fail(400, 'Name the plan exactly as the tool sends it (for example Basic, Pro, Business).');
    const before = D.get('SELECT * FROM aff_plans WHERE product_key=? AND plan=?', p.key, plan);
    const cents = b.price_usd === undefined && before ? before.price_cents : C.parseUsd(b.price_usd);
    if (!(cents > 0)) fail(400, 'Give the plan\'s list price per month in USD (more than 0).');
    const row = E.setPlanPrice(p.key, plan, cents, me.id, C.clock(ctx));
    C.audit(me, before ? 'plan.price' : 'plan.add', { target: `${p.key}:${plan}`, before: before ? { price_cents: before.price_cents, price_source: before.price_source, mismatch_count: before.mismatch_count } : null, after: { price_cents: row.price_cents } });
    return { plan: { ...row, confirmed: true, suggested_cpa_cents: C.suggestCpa(row.price_cents, p.payg) } };
  });
  r.del('/api/admin/aff/products/:key/plans', (ctx) => {
    const me = need(ctx, 'admin');
    const plan = C.clean(ctx.query.plan, 60);
    const before = D.get('SELECT * FROM aff_plans WHERE product_key=? AND plan=?', String(ctx.params.key), plan);
    if (!before) fail(404, 'Plan not found.');
    D.run('DELETE FROM aff_plans WHERE product_key=? AND plan=?', before.product_key, before.plan);
    C.audit(me, 'plan.remove', { target: `${before.product_key}:${before.plan}`, before: { price_cents: before.price_cents, price_source: before.price_source } });
    return { ok: true };
  });
  r.get('/api/admin/aff/offer-changes', (ctx) => { const me = need(ctx, 'any'); const sc = P.scopeSql(me); return { changes: D.all(`SELECT c.*, a.display_name FROM aff_offer_changes c LEFT JOIN aff_affiliates a ON a.id=c.affiliate_id WHERE (c.affiliate_id IS NULL OR ${sc.sql}) ORDER BY c.id DESC LIMIT 200`, ...sc.args) }; });
  r.post('/api/admin/aff/offer-changes', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    if (b.scope === 'affiliate') {
      const deal = D.get('SELECT * FROM aff_deals WHERE id=?', Number(b.deal_id));
      if (!deal) fail(404, 'Deal not found.');
      return { deal: R.dealView(P.changeDeal(me, deal, { cpa_usd: b.cpa_usd, effective_at: b.effective_at }, C.clock(ctx))) };
    }
    return { change: P.scheduleProgramCpa(me, String(b.product_key || ''), C.parseUsd(b.cpa_usd), b.effective_at, C.clock(ctx)) };
  });
  r.post('/api/admin/aff/affiliates/:id/deals', async (ctx) => {
    const me = need(ctx, 'admin');
    const a = affOr404(me, ctx.params.id);
    if (a.status !== 'approved') fail(409, 'Deals are for approved affiliates.');
    return { deal: R.dealView(P.createDeal(me, a, await ctx.json())) };
  });
  /* Custom RevShare deals (owner and program super admins (aff_admin) only, up to 90%; above 50% = Special deal). Staff and that affiliate only. */
  r.post('/api/admin/aff/affiliates/:id/revshare-deals', async (ctx) => {
    const me = need(ctx, 'any');
    const a = affOr404(me, ctx.params.id);
    return { deal: R.dealView(P.createRevshareDeal(me, a, await ctx.json(), C.clock(ctx))) };
  });
  r.get('/api/admin/aff/revshare-deals', (ctx) => {
    const me = need(ctx, 'any'); const sc = P.scopeSql(me); const at = C.clock(ctx);
    const rows = D.all(`SELECT d.*, a.display_name FROM aff_deals d JOIN aff_affiliates a ON a.id=d.affiliate_id WHERE d.model='revshare' AND ${sc.sql} AND (${ctx.query.all ? '1=1' : "d.status='active' AND (d.ends_at=0 OR d.ends_at>?)"}) ORDER BY d.id DESC LIMIT 200`, ...sc.args, ...(ctx.query.all ? [] : [at]));
    return { deals: rows.map((d) => ({ ...R.dealView(d), affiliate_id: d.affiliate_id, affiliate: d.display_name, days_left: d.ends_at ? Math.max(0, Math.ceil((d.ends_at - at) / DAY)) : null })), can_create: P.roles(me).admin, max_pct: P.SPECIAL_MAX_BP / 100 };
  });
  r.patch('/api/admin/aff/deals/:id', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    const deal = D.get('SELECT * FROM aff_deals WHERE id=?', Number(ctx.params.id));
    if (!deal) fail(404, 'Deal not found.');
    if (deal.model === 'revshare') return { deal: R.dealView(P.changeRevshareDeal(me, deal, b, C.clock(ctx))) };
    if (b.status === 'paused' && !P.roles(me).fraud) fail(403, 'Not allowed.');
    return { deal: R.dealView(P.changeDeal(me, deal, b, C.clock(ctx))) };
  });
  r.get('/api/admin/aff/deal-requests', (ctx) => {
    const me = need(ctx, 'manager'); const ro = P.roles(me);
    const st = ['pending', 'approved', 'declined'].includes(ctx.query.status) ? ctx.query.status : null;
    const rows = D.all(`SELECT q.*, a.display_name, u.name requester FROM aff_deal_requests q JOIN aff_affiliates a ON a.id=q.affiliate_id LEFT JOIN users u ON u.id=q.requested_by
      WHERE ${st ? 'q.status=? AND ' : ''}${ro.admin ? '1=1' : '(q.requested_by=? OR a.general_manager_id=? OR a.private_manager_id=?)'} ORDER BY q.id DESC LIMIT 200`, ...[...(st ? [st] : []), ...(ro.admin ? [] : [me.id, me.id, me.id])]);
    return { requests: rows.map((q) => ({ ...q, traffic: json(q.traffic, []), geos: json(q.geos, []), product: q.product_key ? E.prodName(q.product_key) : '' })) };
  });
  r.post('/api/admin/aff/affiliates/:id/deal-requests', async (ctx) => {
    const me = need(ctx, 'manager');
    const a = affOr404(me, ctx.params.id);
    return { request: P.requestDeal(me, a, await ctx.json(), 'manager') };
  });
  r.post('/api/admin/aff/deal-requests/:id/:action', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    if (!['approve', 'decline'].includes(ctx.params.action)) fail(404, 'Unknown action.');
    return { request: P.decideRequest(me, ctx.params.id, ctx.params.action === 'approve', b.note) };
  });
  r.get('/api/admin/aff/coupons', (ctx) => { const me = need(ctx, 'any'); const sc = P.scopeSql(me); return { coupons: D.all(`SELECT c.*, a.display_name FROM aff_coupons c JOIN aff_affiliates a ON a.id=c.affiliate_id WHERE ${sc.sql} ORDER BY c.id DESC LIMIT 500`, ...sc.args) }; });
  r.post('/api/admin/aff/coupons', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    const a = affOr404(me, b.affiliate_id);
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,24}$/.test(code)) fail(400, 'Use 3 to 24 letters, numbers, _ or -.');
    if (D.get('SELECT 1 FROM aff_coupons WHERE code=?', code)) fail(409, 'That code is taken.');
    const pk = clean(b.product_key, 40);
    if (pk && !C.product(pk)) fail(400, 'Unknown product.');
    const id = D.insert('aff_coupons', { affiliate_id: a.id, code, product_key: pk, discount_pct: Math.max(0, Math.min(90, Math.floor(Number(b.discount_pct) || 0))), max_uses: Math.max(0, Math.floor(Number(b.max_uses) || 0)),
      geos: JSON.stringify((Array.isArray(b.geos) ? b.geos : []).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x))), created_by: me.id, created_at: now() }).id;
    C.audit(me, 'coupon.create', { affiliate_id: a.id, target: code });
    return { coupon: D.get('SELECT * FROM aff_coupons WHERE id=?', id) };
  });
  r.patch('/api/admin/aff/coupons/:id', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    const c = D.get('SELECT * FROM aff_coupons WHERE id=?', Number(ctx.params.id)); if (!c) fail(404, 'Coupon not found.');
    D.run('UPDATE aff_coupons SET active=?, discount_pct=?, max_uses=? WHERE id=?', b.active !== undefined ? (b.active ? 1 : 0) : c.active, b.discount_pct !== undefined ? Math.max(0, Math.min(90, Math.floor(Number(b.discount_pct) || 0))) : c.discount_pct, b.max_uses !== undefined ? Math.max(0, Math.floor(Number(b.max_uses) || 0)) : c.max_uses, c.id);
    C.audit(me, 'coupon.update', { affiliate_id: c.affiliate_id, target: c.code });
    return { coupon: D.get('SELECT * FROM aff_coupons WHERE id=?', c.id) };
  });

  /* ================= contests ================= */
  r.get('/api/admin/aff/contests', (ctx) => { need(ctx, 'any'); return { contests: CT.list({ admin: true, at: C.clock(ctx) }) }; });
  r.post('/api/admin/aff/contests', async (ctx) => {
    const me = need(ctx, 'admin');
    const v = CT.clean(await ctx.json());
    const id = D.insert('aff_contests', { ...v, created_by: me.id, created_at: now(), updated_at: now() }).id;
    for (const u of [v.banner_upload, ...json(v.images, [])].filter(Boolean)) D.run("UPDATE uploads SET attached_to='aff_contest' WHERE id=? AND purpose IN ('aff_contest','aff_creative')", u);
    C.audit(me, 'contest.create', { target: v.title });
    const c = CT.get(id);
    if (c.announce && c.published && c.starts_at <= now() + 7 * DAY) P.createAnnouncement(me, { kind: 'contest', title: `${c.title} ${c.starts_at <= now() ? 'has started' : 'starts soon'}`, body: c.pool_cents ? `Prize pool ${C.fmtUsd(c.pool_cents)}.` : '', channels: { dashboard: true, telegram: true } });
    return { contest: CT.view(c, C.clock(ctx), { admin: true }) };
  });
  r.put('/api/admin/aff/contests/:id', async (ctx) => {
    const me = need(ctx, 'admin');
    const c = CT.get(ctx.params.id); if (!c) fail(404, 'Contest not found.');
    if (c.signoff_at) fail(409, 'Results are final. The contest cannot change.');
    const v = CT.clean(await ctx.json(), c);
    D.update('aff_contests', c.id, { ...v, updated_at: now() }, [...Object.keys(v), 'updated_at']);
    C.audit(me, 'contest.update', { target: v.title });
    return { contest: CT.view(CT.get(c.id), C.clock(ctx), { admin: true }) };
  });
  r.post('/api/admin/aff/contests/:id/cancel', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    const c = CT.get(ctx.params.id); if (!c) fail(404, 'Contest not found.');
    if (clean(b.note, 300).length < 3) fail(400, 'Contests are cancelled only for fraud, a technical failure or a legal requirement. Add the reason shown on the contest page.');
    D.run('UPDATE aff_contests SET cancelled=1, cancel_note=?, updated_at=? WHERE id=?', clean(b.note, 300), now(), c.id);
    C.audit(me, 'contest.cancel', { target: c.title, after: { note: b.note } });
    return { ok: true };
  });
  r.get('/api/admin/aff/contests/:id/leaderboard', (ctx) => {
    need(ctx, 'any'); const at = C.clock(ctx);
    const c = CT.get(ctx.params.id); if (!c) fail(404, 'Contest not found.');
    const rows = D.all('SELECT s.*, a.display_name FROM aff_contest_scores s JOIN aff_affiliates a ON a.id=s.affiliate_id WHERE s.contest_id=? ORDER BY s.rank IS NULL, s.rank, s.score DESC LIMIT 500', c.id);
    return { contest: CT.view(c, at, { admin: true }), rows: rows.map((s) => ({ affiliate_id: s.affiliate_id, ref: `AF-${s.affiliate_id}`, name: s.display_name, rank: s.rank, points: s.points, multiplier_bp: s.multiplier_bp, score: s.score / 100, customers: s.customers, revenue_cents: s.revenue_cents, removed: s.removed, disqualified: !!s.disqualified, dq_reason: s.dq_reason })) };
  });
  r.post('/api/admin/aff/contests/:id/recompute', (ctx) => { need(ctx, 'admin'); return { changes: CT.recompute(Number(ctx.params.id), C.clock(ctx)).length }; });
  r.post('/api/admin/aff/contests/:id/finalise', (ctx) => { const me = need(ctx, 'admin'); return { contest: CT.view(CT.finalise(Number(ctx.params.id), me, C.clock(ctx)), C.clock(ctx), { admin: true }) }; });
  r.post('/api/admin/aff/contests/:id/signoff', (ctx) => { const me = need(ctx, 'any'); if (!P.roles(me).admin && !P.roles(me).fraud) fail(403, 'Results are signed off by a program admin or a fraud-check manager.'); return { contest: CT.view(CT.signoff(Number(ctx.params.id), me, C.clock(ctx)), C.clock(ctx), { admin: true }) }; });

  /* ================= creatives ================= */
  r.get('/api/admin/aff/creatives', (ctx) => {
    need(ctx, 'any');
    const rows = D.all('SELECT * FROM aff_creatives ORDER BY id DESC LIMIT 500');
    const imgs = up.lookup(rows.map((x) => x.upload_id));
    return { creatives: rows.map((x) => ({ ...x, image: imgs[x.upload_id] || null })), most_used: rows.slice().sort((x, y) => (y.downloads + y.copies) - (x.downloads + x.copies)).slice(0, 6).map((x) => ({ id: x.id, title: x.title, product_key: x.product_key, uses: x.downloads + x.copies })) };
  });
  r.post('/api/admin/aff/creatives', async (ctx) => {
    const me = need(ctx, 'admin');
    const v = P.cleanCreative(await ctx.json());
    const id = D.insert('aff_creatives', { ...v, created_by: me.id, created_at: now(), updated_at: now() }).id;
    C.audit(me, 'creative.create', { target: v.title });
    return { creative: D.get('SELECT * FROM aff_creatives WHERE id=?', id) };
  });
  r.put('/api/admin/aff/creatives/:id', async (ctx) => {
    const me = need(ctx, 'admin');
    const cr = D.get('SELECT * FROM aff_creatives WHERE id=?', Number(ctx.params.id)); if (!cr) fail(404, 'Creative not found.');
    const v = P.cleanCreative(await ctx.json(), cr);
    D.update('aff_creatives', cr.id, { ...v, updated_at: now() }, [...Object.keys(v), 'updated_at']);
    C.audit(me, 'creative.update', { target: v.title });
    return { creative: D.get('SELECT * FROM aff_creatives WHERE id=?', cr.id) };
  });
  r.del('/api/admin/aff/creatives/:id', (ctx) => { const me = need(ctx, 'admin'); D.run('UPDATE aff_creatives SET active=0 WHERE id=?', Number(ctx.params.id)); C.audit(me, 'creative.archive', { target: ctx.params.id }); return { ok: true }; });

  /* ================= announcements ================= */
  r.get('/api/admin/aff/announcements', (ctx) => { need(ctx, 'any'); return { announcements: D.all('SELECT * FROM aff_announcements ORDER BY id DESC LIMIT 200').map((x) => ({ ...x, audience: json(x.audience, {}), channels: json(x.channels, {}) })) }; });
  r.post('/api/admin/aff/announcements', async (ctx) => {
    const me = need(ctx, 'manager'); const b = await ctx.json();
    if (!P.roles(me).admin) b.audience = { kind: 'manager', manager_id: me.id };
    return { announcement: P.createAnnouncement(me, b, C.clock(ctx)) };
  });
  r.del('/api/admin/aff/announcements/:id', (ctx) => { const me = need(ctx, 'admin'); D.run('UPDATE aff_announcements SET expires_at=? WHERE id=?', now(), Number(ctx.params.id)); C.audit(me, 'announcement.expire', { target: ctx.params.id }); return { ok: true }; });

  /* ================= payouts (finance) ================= */
  r.get('/api/admin/aff/payouts', (ctx) => {
    const me = need(ctx, 'finance'); const at = C.clock(ctx);
    const st = String(ctx.query.status || 'open');
    const where = st === 'open' ? "status IN ('requested','approved','processing','held')" : PAY.STATUS_LABEL[st] ? 'status=?' : '1=1';
    const rows = D.all(`SELECT * FROM aff_payouts WHERE ${where} ORDER BY ${st === 'open' ? 'sla_due_at ASC' : 'id DESC'} LIMIT 300`, ...(PAY.STATUS_LABEL[st] ? [st] : []));
    const [ms] = C.monthRange(C.monthKey(at));
    const t = D.get(`SELECT COALESCE(SUM(CASE WHEN status='requested' OR status='approved' THEN amount_cents END),0) req, COUNT(CASE WHEN status='requested' OR status='approved' THEN 1 END) reqn,
      COALESCE(SUM(CASE WHEN status='processing' THEN amount_cents END),0) proc, COUNT(CASE WHEN status='processing' THEN 1 END) procn, COALESCE(SUM(CASE WHEN status='paid' AND paid_at>=? THEN amount_cents END),0) paid, COUNT(CASE WHEN status='paid' AND paid_at>=? THEN 1 END) paidn,
      COALESCE(SUM(CASE WHEN status='held' THEN amount_cents END),0) held, COUNT(CASE WHEN status='held' THEN 1 END) heldn FROM aff_payouts`, ms, ms);
    return { payouts: rows.map((p) => payoutRow(p, at, me)), totals: { requested_cents: t.req, requested: t.reqn, sending_cents: t.proc, sending: t.procn, paid_month_cents: t.paid, paid_month: t.paidn, held_cents: t.held, held: t.heldn }, four_eyes_cents: C.settings().payouts.four_eyes_cents };
  });
  r.get('/api/admin/aff/payouts.csv', (ctx) => {
    const me = need(ctx, 'finance');
    const rows = D.all('SELECT p.*, a.display_name FROM aff_payouts p JOIN aff_affiliates a ON a.id=p.affiliate_id ORDER BY p.id DESC LIMIT 20000');
    C.audit(me, 'export.payouts', { target: `${rows.length} rows` });
    sendCsv(ctx, [['id', 'affiliate', 'name', 'status', 'amount_usd', 'fee_usd', 'method', 'wallet', 'tx_hash', 'receipt_no', 'requested_at', 'paid_at'],
      ...rows.map((p) => [p.id, `AF-${p.affiliate_id}`, p.display_name, p.status, C.usd(p.amount_cents).toFixed(2), C.usd(p.fee_cents).toFixed(2), p.method, p.wallet, p.tx_hash, p.receipt_no || '', p.requested_at ? new Date(p.requested_at).toISOString() : '', p.paid_at ? new Date(p.paid_at).toISOString() : ''])], `voosquare-affiliate-payouts-${C.dayKey(now())}.csv`);
  });
  r.get('/api/admin/aff/payouts/:id', (ctx) => {
    const me = need(ctx, 'finance'); const at = C.clock(ctx);
    const p = D.get('SELECT * FROM aff_payouts WHERE id=?', Number(ctx.params.id)); if (!p) fail(404, 'Payout not found.');
    const a = C.byId(p.affiliate_id);
    return { payout: payoutRow(p, at, me), lines: PAY.lineItems(p.id), balance: E.balance(a.id, at),
      recent_declines: D.all("SELECT product_key, decline_reason, decided_at FROM aff_cpa_reviews WHERE affiliate_id=? AND status='declined' ORDER BY decided_at DESC LIMIT 10", a.id), fraud: F.affiliateScore(a.id, at) };
  });
  const payAct = (fn) => async (ctx) => { const me = need(ctx, 'finance'); const b = await ctx.json(); const p = await fn(me, ctx.params.id, b, C.clock(ctx)); return { payout: payoutRow(p, C.clock(ctx), me) }; };
  r.post('/api/admin/aff/payouts/:id/approve', payAct((me, id, b, at) => PAY.approve(me, id, at)));
  r.post('/api/admin/aff/payouts/:id/processing', payAct((me, id, b, at) => PAY.processing(me, id, at)));
  r.post('/api/admin/aff/payouts/:id/paid', payAct((me, id, b, at) => PAY.paid(me, id, b, at)));
  r.post('/api/admin/aff/payouts/:id/reject', payAct((me, id, b, at) => PAY.reject(me, id, b.reason || b.note, at)));
  r.post('/api/admin/aff/payouts/:id/hold', payAct((me, id, b, at) => PAY.hold(me, id, b.reason, at)));
  r.post('/api/admin/aff/payouts/:id/release', payAct((me, id) => PAY.release(me, id)));
  r.post('/api/admin/aff/payouts/:id/check', payAct((me, id) => PAY.providerCheck(me, id)));

  /* ================= KYC ================= */
  r.get('/api/admin/aff/kyc', (ctx) => {
    need(ctx, 'finance');
    const st = ['pending', 'verified', 'rejected', 'none'].includes(ctx.query.status) ? ctx.query.status : 'pending';
    const rows = D.all('SELECT * FROM aff_affiliates WHERE kyc_status=? ORDER BY kyc_updated_at LIMIT 200', st).map(C.hydrate);
    return { affiliates: rows.map((a) => { const docs = D.all('SELECT * FROM aff_kyc_docs WHERE affiliate_id=? ORDER BY id DESC LIMIT 10', a.id); const imgs = up.lookup(docs.map((d) => d.upload_id));
      return { id: a.id, ref: `AF-${a.id}`, display_name: a.display_name, country: a.country, kyc: KYC.state(a), provider_ref: a.kyc_provider_ref, documents: docs.map((d) => ({ type: d.doc_type, image: imgs[d.upload_id] || null, at: d.created_at })) }; }) };
  });
  r.post('/api/admin/aff/kyc/:id', async (ctx) => {
    const me = need(ctx, 'finance'); const b = await ctx.json();
    const a = affOr404(me, ctx.params.id);
    return { kyc: KYC.state(KYC.decide(me, a, b.status, b.reason)) };
  });

  /* ================= managers ================= */
  r.get('/api/admin/aff/managers', (ctx) => {
    need(ctx, 'any'); const at = C.clock(ctx);
    return { managers: P.managers().map((m) => P.managerView(m, at)), private_suggestions: P.privateSuggestions(at).map((id) => V.adminRow(C.byId(id), at)), unassigned: D.get("SELECT COUNT(*) n FROM aff_affiliates WHERE general_manager_id IS NULL AND status IN ('pending','approved','suspended')").n };
  });
  r.put('/api/admin/aff/managers/:user_id', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    const u = D.get('SELECT * FROM users WHERE id=?', Number(ctx.params.user_id));
    if (!u) fail(404, 'Team member not found.');
    const perms = json(u.perms, []);
    if (!perms.includes('*') && !perms.includes('aff_manager') && !perms.includes('aff_admin') && !perms.includes('aff_fraud')) fail(400, 'Give this person the aff_manager (or aff_fraud) permission in Team first.');
    const kinds = (Array.isArray(b.kinds) ? b.kinds : ['general']).filter((k) => ['general', 'private', 'fraud', 'finance'].includes(k));
    if (!kinds.length) fail(400, 'Choose at least one role: general, private, fraud or finance.');
    D.run(`INSERT INTO aff_managers(user_id,kinds,languages,countries,capacity,hours,telegram,active,created_at) VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET kinds=excluded.kinds, languages=excluded.languages, countries=excluded.countries, capacity=excluded.capacity, hours=excluded.hours, telegram=excluded.telegram, active=excluded.active`,
    u.id, JSON.stringify(kinds), JSON.stringify((Array.isArray(b.languages) ? b.languages : []).map((x) => clean(x, 30)).slice(0, 8)), JSON.stringify((Array.isArray(b.countries) ? b.countries : []).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 60)),
    Math.max(0, Math.floor(Number(b.capacity) || 0)), clean(b.hours, 80), clean(b.telegram, 40), b.active === false ? 0 : 1, now());
    if (b.active === false) D.run('UPDATE aff_affiliates SET general_manager_id=NULL WHERE general_manager_id=?', u.id);
    C.audit(me, 'manager.save', { target: u.name, after: { kinds, active: b.active !== false } });
    return { manager: P.managerView({ ...D.get('SELECT m.*, u.name, u.avatar FROM aff_managers m JOIN users u ON u.id=m.user_id WHERE m.user_id=?', u.id), kinds, languages: [], countries: [] }, C.clock(ctx)) };
  });
  r.post('/api/admin/aff/managers/reassign', async (ctx) => {
    const me = need(ctx, 'admin'); const b = await ctx.json();
    const from = b.from_user_id ? Number(b.from_user_id) : null;
    const list = D.all(`SELECT * FROM aff_affiliates WHERE ${from ? 'general_manager_id=?' : 'general_manager_id IS NULL'} AND status IN ('pending','approved','suspended')`, ...(from ? [from] : [])).map(C.hydrate);
    let n = 0;
    for (const a of list) {
      const to = b.to_user_id ? Number(b.to_user_id) : P.assignGeneral({ ...a, general_manager_id: null });
      if (to && to !== a.general_manager_id) { P.setManagers(me, a, { general_manager_id: to }); n++; }
    }
    C.audit(me, 'manager.reassign', { after: { from, to: b.to_user_id || 'auto', n } });
    return { moved: n };
  });
  r.get('/api/admin/aff/manager/home', (ctx) => {
    const me = need(ctx, 'manager'); const at = C.clock(ctx);
    const sc = P.scopeSql(me);
    const mine = D.all(`SELECT a.* FROM aff_affiliates a WHERE a.status IN ('approved','suspended') AND (a.general_manager_id=? OR a.private_manager_id=?) ORDER BY a.id DESC LIMIT 500`, me.id, me.id).map(C.hydrate);
    const rows = mine.map((a) => V.adminRow(a, at));
    const alerts = [];
    for (const a of mine) {
      const day = D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>?', a.id, at - DAY).n;
      const base = D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>? AND locked_at<=?', a.id, at - 15 * DAY, at - DAY).n / 14;
      if (day >= 10 && day >= 5 * Math.max(base, 1)) alerts.push({ kind: 'spike', tone: 'r', affiliate_id: a.id, text: `${a.display_name} sign-ups ${(day / Math.max(base, 1)).toFixed(1)}x the 14-day average in 24 h.` });
      if (a.cpa_paused) alerts.push({ kind: 'fraud', tone: 'r', affiliate_id: a.id, text: `${a.display_name}: CPA paused (${a.cpa_paused_reason}).` });
      if (a.health_state === 'grace' || a.health_state === 'at_risk') alerts.push({ kind: 'health', tone: 'amb', affiliate_id: a.id, text: `${a.display_name}: lifetime RevShare ${a.health_state === 'grace' ? 'in grace' : 'at risk'}.` });
      if (a.tier_grace_month) alerts.push({ kind: 'grace', tone: 'amb', affiliate_id: a.id, text: `${a.display_name}: tier grace month (${C.tierName(a.tier)}).` });
      const wk = D.get('SELECT COUNT(*) n FROM aff_clicks WHERE affiliate_id=? AND created_at>?', a.id, at - 7 * DAY).n; const pw = D.get('SELECT COUNT(*) n FROM aff_clicks WHERE affiliate_id=? AND created_at>? AND created_at<=?', a.id, at - 14 * DAY, at - 7 * DAY).n;
      if (pw >= 100 && wk < pw * 0.4) alerts.push({ kind: 'drop', tone: 'amb', affiliate_id: a.id, text: `${a.display_name} clicks down ${Math.round(100 - (100 * wk) / pw)}% vs last week.` });
    }
    return { partners: rows, stats: { partners: rows.length, target: (D.get('SELECT capacity FROM aff_managers WHERE user_id=?', me.id) || {}).capacity || C.settings().manager_capacity.general, qualified_mtd: rows.reduce((s, x) => s + x.qualified_mtd, 0), commission_mtd_cents: rows.reduce((s, x) => s + x.commission_mtd_cents, 0), adjustments_mtd_cents: rows.reduce((s, x) => s + (x.adjustments_mtd_cents || 0), 0) },
      applications: D.get(`SELECT COUNT(*) n FROM aff_affiliates a WHERE a.status='pending' AND a.applied_at IS NOT NULL AND ${sc.sql}`, ...sc.args).n, alerts };
  });

  /* ================= audit ================= */
  const auditRows = (ctx, max) => {
    const q = ctx.query; const where = ['1=1']; const args = [];
    if (q.affiliate) { where.push('x.affiliate_id=?'); args.push(Number(q.affiliate)); }
    if (q.action) { where.push('x.action LIKE ?'); args.push(String(q.action) + '%'); }
    if (q.q) { where.push('(x.target LIKE ? OR u.name LIKE ?)'); args.push(`%${clean(q.q, 80)}%`, `%${clean(q.q, 80)}%`); }
    return D.all(`SELECT x.*, u.name actor FROM aff_audit x LEFT JOIN users u ON u.id=x.actor_id WHERE ${where.join(' AND ')} ORDER BY x.id DESC LIMIT ? OFFSET ?`, ...args, max, Math.max(0, Number(q.offset) || 0));
  };
  r.get('/api/admin/aff/audit', (ctx) => { need(ctx, 'admin'); return { rows: auditRows(ctx, Math.min(500, Number(ctx.query.limit) || 100)).map((x) => ({ id: x.id, at: x.created_at, actor: x.actor || 'System', action: x.action, affiliate_id: x.affiliate_id, target: x.target, before: json(x.before, null), after: json(x.after, null) })) }; });
  r.get('/api/admin/aff/audit.csv', (ctx) => {
    const me = need(ctx, 'admin'); const rows = auditRows(ctx, 50000);
    C.audit(me, 'export.audit', { target: `${rows.length} rows` });
    sendCsv(ctx, [['id', 'time', 'actor', 'action', 'affiliate', 'target', 'before', 'after'], ...rows.map((x) => [x.id, new Date(x.created_at).toISOString(), x.actor || 'System', x.action, x.affiliate_id ? `AF-${x.affiliate_id}` : '', x.target, x.before, x.after])], `voosquare-affiliate-audit-${C.dayKey(now())}.csv`);
  });

  /* ================= settings, Telegram, jobs, order refunds ================= */
  r.get('/api/admin/aff/settings', (ctx) => { need(ctx, 'admin'); return { settings: P.publicSettings(), defaults: C.DEFAULTS, telegram: { configured: TG.configured() } }; });
  r.put('/api/admin/aff/settings', async (ctx) => {
    const me = need(ctx, 'admin');
    const b = await ctx.json();
    // Secrets are write-only: an empty or missing value keeps the stored one.
    const cur = C.settings();
    // A provider's address receives its API key (and, for payouts, decides where money is sent). Moving it to a new host
    // needs an owner, the API key typed again (a saved key never goes to a new address) and an audit line (CA-3).
    const hostOf = (pv) => { if (!pv || pv.kind !== 'http' || !pv.api_base) return ''; try { return new URL(String(pv.api_base)).origin.toLowerCase(); } catch { return String(pv.api_base).toLowerCase(); } };
    for (const k of ['kyc', 'payouts']) {
      const inc = b[k] && b[k].provider; if (!inc || typeof inc !== 'object') continue;
      const was = hostOf(cur[k].provider); const next = hostOf({ ...cur[k].provider, ...inc });
      if (!next || next === was) continue;
      // First connection (no saved key yet): nothing secret can leak, so program admins may set it up (audited).
      if (cur[k].provider.api_key && !A.isOwner(me)) fail(403, `Only an owner can point the ${k === 'kyc' ? 'verification' : 'payout'} provider at a new address (its saved API key would go there).`);
      if (cur[k].provider.api_key && !(typeof inc.api_key === 'string' && inc.api_key.trim() && !inc.api_key.startsWith('••••'))) fail(400, 'The provider address moved to a new host. Type the API key again: a saved key is never sent to a new address.', { reenter: ['api_key'] });
      C.audit(me, `settings.${k}_provider_endpoint`, { target: `${was || '(none)'} → ${next}` });
    }
    for (const k of ['kyc', 'payouts']) if (b[k] && b[k].provider) for (const s of ['api_key', 'webhook_secret']) if (!b[k].provider[s] || String(b[k].provider[s]).startsWith('••••')) b[k].provider[s] = cur[k].provider[s];
    const r2 = P.updateSettings(me, b, C.clock(ctx));
    return { settings: P.publicSettings(), scheduled: r2.scheduled };
  });
  r.get('/api/admin/aff/telegram', async (ctx) => { need(ctx, 'admin'); return { configured: TG.configured(), bot: await TG.botUsername(), connected: D.get('SELECT COUNT(*) n FROM aff_telegram WHERE verified=1').n, queued: D.get("SELECT COUNT(*) n FROM aff_tg_outbox WHERE status='queued'").n, failed: D.get("SELECT COUNT(*) n FROM aff_tg_outbox WHERE status='failed'").n }; });
  r.post('/api/admin/aff/telegram/webhook', async (ctx) => { need(ctx, 'admin'); return TG.setWebhook(); });
  r.post('/api/admin/aff/jobs/run', async (ctx) => {
    need(ctx, 'admin');
    const b = await ctx.json();
    const at = process.env.NODE_ENV === 'test' && Number(b.at) > 0 ? Number(b.at) : now();
    return { at, result: await J.runAll(at, { reconcile: b.reconcile !== false }) };
  });
  r.post('/api/admin/aff/orders/:id/refund', async (ctx) => {
    const me = A.requireUser(ctx);
    if (!A.can(me, 'payments') && !P.roles(me).finance) fail(403, "You don't have access to this part of the admin.");
    const b = await ctx.json();
    const kind = b.kind === 'chargeback' ? 'chargeback' : 'refund';
    const o = D.get('SELECT * FROM orders WHERE id=?', Number(ctx.params.id));
    if (!o) fail(404, 'Order not found.');
    if (o.status !== 'paid') fail(409, 'Only paid orders can be refunded or charged back.');
    D.run('UPDATE orders SET status=?, note=? WHERE id=? AND status=\'paid\'', kind === 'chargeback' ? 'chargeback' : 'refunded', clean(b.reason, 200) || (kind === 'chargeback' ? 'Charged back' : 'Refunded'), o.id);
    D.insert('audit', { user_id: me.id, action: 'order.' + kind, detail: o.ref, created_at: now() });
    const res = require('../aff').onOrderReversed(o.id, kind);
    return { order: D.get('SELECT * FROM orders WHERE id=?', o.id), affiliate: res ? { reversed_cents: res.reversed_cents } : null };
  });
};
