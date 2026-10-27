'use strict';
/*
 * VooSquare Affiliates: public tracking, the affiliate app API (/api/aff/*), the read-only stats API (/api/aff/v1/*, API key)
 * and provider webhooks (/api/aff/hooks/*, /api/aff/telegram/webhook). Contract: docs/AFFILIATE_API.md.
 */
const config = require('../config');
const D = require('../db');
const A = require('../auth');
const C = require('../aff/core');
const E = require('../aff/engine');
const T = require('../aff/tracking');
const V = require('../aff/views');
const P = require('../aff/program');
const R = require('../aff/reports');
const PAY = require('../aff/payouts');
const KYC = require('../aff/kyc');
const PB = require('../aff/postbacks');
const TG = require('../aff/telegram');
const CT = require('../aff/contests');
const QR = require('../aff/qr');
const { now, fail, limit, clean, safeUrl, publish } = require('../util');

const DAY = C.DAY;
/** The signed-in member's affiliate account, or 404 { no_account: true }. */
function mine(ctx) {
  const u = A.requireUser(ctx);
  const a = C.byUser(u.id);
  if (!a) fail(404, 'You do not have an affiliate account yet.', { no_account: true });
  if (a.status === 'closed') fail(403, 'This affiliate account is closed.', { closed: true });
  return a;
}
const approvedOnly = (a) => { if (a.status !== 'approved') fail(403, 'This page opens after approval.', { pending: true }); };
const sendPdf = (ctx, buf, name) => { ctx.handled = true; ctx.res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${name}"`, 'Cache-Control': 'private, no-store', 'Content-Length': buf.length }); ctx.res.end(buf); };
const sendSvg = (ctx, svg) => { ctx.handled = true; ctx.res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=300' }); ctx.res.end(svg); };
const sendCsv = (ctx, text, name) => { ctx.handled = true; ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' }); ctx.res.end('﻿' + text); };

function linkView(a, l, at) {
  const st = D.get(`SELECT (SELECT COUNT(*) FROM aff_clicks WHERE link_id=?) clicks, (SELECT COUNT(*) FROM aff_attributions t JOIN aff_clicks k ON k.id=t.click_id WHERE k.link_id=?) signups,
    (SELECT COUNT(*) FROM aff_customers c JOIN aff_attributions t ON t.customer_user_id=c.user_id JOIN aff_clicks k ON k.id=t.click_id WHERE k.link_id=? AND c.qualified_at IS NOT NULL) qualified,
    (SELECT COALESCE(SUM(m.amount_cents),0) FROM aff_commissions m JOIN aff_attributions t ON t.customer_user_id=m.customer_user_id JOIN aff_clicks k ON k.id=t.click_id WHERE k.link_id=? AND m.status NOT IN ('declined','reversed')) com`, l.id, l.id, l.id, l.id);
  return { id: l.id, code: l.code, name: l.name, product_key: l.product_key, dest_url: l.dest_url, subs: { sub1: l.sub1, sub2: l.sub2, sub3: l.sub3, sub4: l.sub4, sub5: l.sub5 }, click_macro: l.click_macro,
    url: T.trackingUrl(a, { link: l, click: l.click_macro }), archived: !!l.archived, created_at: l.created_at, clicks: st.clicks, signups: st.signups, qualified: st.qualified, commission_cents: st.com };
}
function readSubs(b) {
  const subs = {};
  for (let i = 1; i <= 5; i++) {
    const v = String(b['sub' + i] ?? (b.subs && b.subs['sub' + i]) ?? '').trim();
    if (v && !/^[A-Za-z0-9_\-.]{1,64}$/.test(v)) fail(400, 'Use letters, numbers, _ and - only, up to 64 characters.');
    subs['sub' + i] = v;
  }
  return subs;
}

module.exports = function routes(r) {
  /* ================= tracking ================= */
  r.get('/a/:code', (ctx) => T.click(ctx));
  r.get('/go/:code', (ctx) => T.click(ctx));

  /* ================= public program info (landing page) ================= */
  r.get('/api/aff/public', (ctx) => {
    const s = C.settings();
    const at = C.clock(ctx);
    return {
      tiers: C.tiers().map((t) => ({ name: t.name, min: t.min, rate_bp: t.rate_bp, approval: !!t.approval, multiplier_bp: t.multiplier_bp, payout_days: t.sla_days })),
      products: C.productList().map((p) => ({ key: p.key, name: p.name, icon: p.icon, color: p.color, commissionable: p.commissionable && p.cap_bp > 0, cap_bp: p.cap_bp, pitch: (V.PITCH[p.key] || [''])[0], who: (V.PITCH[p.key] || ['', ''])[1], status: p.tool_status || 'live', cpa_example_cents: p.cpa_cents || 0 })),
      cpa_max_cents: s.cpa.max_cents, attribution_days: s.attribution_days, payout_methods: Object.entries(s.payouts.methods).filter(([, m]) => m.enabled).map(([k, m]) => ({ method: k, label: PAY.METHOD_LABEL[k] || k, min_cents: m.min_cents, fee: m.fee })),
      holds: s.holds, quality: s.quality, activation_customers: s.activation_customers, health: { threshold: s.health.threshold, window_days: s.health.window_days, ramp_days: s.health.ramp_days, grace_days: s.health.grace_days },
      subs: { enabled: s.subs.enabled, rate_bp: s.subs.rate_bp, boosted_rate_bp: s.subs.boosted_rate_bp, boost_subs: s.subs.boost_subs, boost_sub_customers: s.subs.boost_sub_customers },
      contests: CT.list({ at }).filter((c) => ['live', 'upcoming'].includes(c.status)).slice(0, 3).map((c) => ({ id: c.id, title: c.title, status: c.status, starts_at: c.starts_at, ends_at: c.ends_at, pool_cents: c.pool_cents, banner: c.banner })),
      terms_version: s.terms_version, telegram: TG.configured(),
    };
  });
  r.get('/api/aff/terms', () => {
    const v = C.settings().terms_version;
    return { version: v, date: C.cmpVersion(v, C.TERMS.version) === 0 ? C.TERMS.date : '', changes: C.termsChanges(v), markdown: require('../legal').affiliateTerms(), approved: require('../legal').approved('affiliate') };
  });
  /* Accept the current affiliate terms (the "We've updated the affiliate terms" banner). Optional { version }: refused when it
   * is not the current one (the page was open while the terms changed again). Recorded with version and time (audit). */
  r.post('/api/aff/terms/accept', async (ctx) => {
    const a = mine(ctx);
    limit('aff-terms:' + a.id, 20, 600_000);
    const b = (await ctx.json()) || {};
    const cur = C.settings().terms_version;
    if (b.version && String(b.version) !== cur) fail(409, `The terms changed to ${cur} while this page was open. Read the new version, then accept.`, { current_version: cur });
    if (!a.applied_at) fail(409, 'You accept the terms when you send your application.');
    if (a.terms_version !== cur) C.acceptTerms(a, 'update', now());
    return { account: V.me(C.byId(a.id), C.clock(ctx)) };
  });

  /* ================= account and application ================= */
  r.get('/api/aff/me', (ctx) => {
    const u = A.requireUser(ctx);
    const a = C.byUser(u.id);
    if (!a) return { account: null, user: { name: u.name, email: u.email, country: u.country, handle: u.handle } };
    return { account: V.me(a, C.clock(ctx)) };
  });
  r.post('/api/aff/account', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('aff-account:' + u.id, 10, 60_000);
    const b = await ctx.json();
    const parent = T.parentFrom(ctx, b.parent_code);
    const a = P.ensure(u, { parent });
    return { account: V.me(a, C.clock(ctx)) };
  });
  r.get('/api/aff/application', (ctx) => { const a = mine(ctx); return { step: a.app_step, submitted: !!a.applied_at, application: a.application, sources: P.SOURCES, volumes: P.VOLUMES, status: a.status }; });
  r.put('/api/aff/application/:step', async (ctx) => {
    const a = mine(ctx);
    limit('aff-app:' + a.id, 30, 60_000);
    const out = P.saveStep(a, ctx.params.step, await ctx.json(), ctx);
    return { account: V.me(out, C.clock(ctx)) };
  });
  /* Reply to a manager's "We need a bit more from you" request: kept on the application, shown to the manager as a note. */
  r.post('/api/aff/application/reply', async (ctx) => {
    const a = mine(ctx);
    limit('aff-app-reply:' + a.id, 10, 600_000);
    if (a.status !== 'pending' || !a.info_request) fail(409, 'There is no open request on your application.');
    const b = await ctx.json();
    const text = clean(b.text, 1200);
    if (text.length < 5) fail(400, 'Write your answer for your manager.');
    const links = (Array.isArray(b.links) ? b.links : b.link ? [b.link] : []).map((u) => safeUrl(u, 300)).filter((u) => /^https?:\/\//.test(u)).slice(0, 5);
    const app = { ...(a.application || {}) };
    app.info_replies = [...(app.info_replies || []), { request: a.info_request, text, links, at: now() }].slice(-10);
    if (links.length) app.links = [...new Set([...(app.links || []), ...links])].slice(0, 8);
    D.run("UPDATE aff_affiliates SET application=?, info_request='', updated_at=? WHERE id=?", JSON.stringify(app), now(), a.id);
    D.insert('aff_notes', { affiliate_id: a.id, author_id: a.user_id, body: `Reply to "${a.info_request.slice(0, 120)}": ${text}${links.length ? ' ' + links.join(' ') : ''}`, shared: 1, created_at: now() });
    C.audit(a.user_id, 'application.info_reply', { affiliate_id: a.id });
    publish('staff', 'aff', { kind: 'application', id: a.id });
    return { account: V.me(C.byId(a.id), C.clock(ctx)) };
  });
  /* Message to the manager (also used by "Ask about this" on a conversion, with its reference). Shows on the manager's partner notes. */
  r.post('/api/aff/messages', async (ctx) => {
    const a = mine(ctx);
    limit('aff-msg:' + a.id, 30, 600_000);
    const b = await ctx.json();
    const body = clean(b.text, 2000);
    if (body.length < 2) fail(400, 'Write a message.');
    const ref = /^[A-Z]{1,3}-[A-Z0-9]{2,12}$/.test(String(b.ref || '')) ? String(b.ref) : '';
    const id = D.insert('aff_notes', { affiliate_id: a.id, author_id: a.user_id, body: ref ? `[${ref}] ${body}` : body, shared: 1, created_at: now() }).id;
    publish('staff', 'aff', { kind: 'message', id: a.id });
    const n = D.get('SELECT * FROM aff_notes WHERE id=?', id);
    return { message: { id: n.id, body: n.body, at: n.created_at, mine: true } };
  });
  r.post('/api/aff/welcome-seen', (ctx) => { const a = mine(ctx); D.run('UPDATE aff_affiliates SET welcome_seen=1 WHERE id=?', a.id); return { ok: true }; });
  r.post('/api/aff/checklist', async (ctx) => {
    const a = mine(ctx); const b = await ctx.json();
    if (b.item !== 'start_here') fail(400, 'Unknown item.');
    D.run('UPDATE aff_affiliates SET notif_prefs=? WHERE id=?', JSON.stringify({ ...a.notif_prefs, start_here_done: true }), a.id);
    return { ok: true };
  });
  r.post('/api/aff/close', async (ctx) => {
    const a = mine(ctx); const b = await ctx.json();
    if (b.confirm !== 'CLOSE') fail(400, 'Type CLOSE to confirm.');
    if (PAY.openPayout(a.id)) fail(409, 'You have a payout request open. Wait until it is paid, or cancel it first.');
    D.run("UPDATE aff_affiliates SET status='closed', closed_at=?, updated_at=? WHERE id=?", now(), now(), a.id);
    C.audit(a.user_id, 'affiliate.close', { affiliate_id: a.id });
    return { ok: true };
  });

  /* ================= dashboard ================= */
  r.get('/api/aff/home', (ctx) => {
    const a = mine(ctx); const at = C.clock(ctx);
    const contests = CT.list({ at }).filter((c) => c.status === 'live');
    const live = contests[0] ? { ...contests[0], ...CT.leaderboard(contests[0].id, a.id, 3, at) } : null;
    return {
      account: V.me(a, at), balance: E.balance(a.id, at), kpis: R.kpis(a.id, ctx.query.period || 'today', at), announcements: P.announcementsFor(a, at, 3),
      top_subs: R.topSubs(a.id, at, 7), contest: live, custom_deals: P.revshareDealsFor(a.id, at), series: R.series(a.id, Number(ctx.query.days) || 30, at),
      tracking: a.status === 'approved' ? null : { clicks: D.get('SELECT COUNT(*) n FROM aff_clicks WHERE affiliate_id=?', a.id).n, signups: D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=?', a.id).n },
    };
  });
  r.get('/api/aff/balance', (ctx) => { const a = mine(ctx); return E.balance(a.id, C.clock(ctx)); });
  r.get('/api/aff/stats', (ctx) => { const a = mine(ctx); return R.kpis(a.id, ctx.query.period || 'today', C.clock(ctx)); });
  r.get('/api/aff/series', (ctx) => { const a = mine(ctx); return { series: R.series(a.id, Math.min(366, Math.max(7, Number(ctx.query.days) || 30)), C.clock(ctx)) }; });
  r.get('/api/aff/reports', (ctx) => { const a = mine(ctx); return R.report(a.id, ctx.query, C.clock(ctx)); });
  r.get('/api/aff/reports.csv', (ctx) => { const a = mine(ctx); sendCsv(ctx, R.reportCsv(a.id, ctx.query, C.clock(ctx)), `voosquare-affiliate-report-${C.dayKey(now())}.csv`); });
  r.get('/api/aff/conversions', (ctx) => { const a = mine(ctx); return R.conversions(a.id, ctx.query, C.clock(ctx)); });
  r.get('/api/aff/customers', (ctx) => { const a = mine(ctx); return R.customers(a.id, ctx.query); });
  r.get('/api/aff/cohorts', (ctx) => { const a = mine(ctx); return { cohorts: R.cohorts(a.id, C.clock(ctx), Math.min(12, Math.max(1, Number(ctx.query.months) || 6))), repeat: R.repeatStats(a.id) }; });
  r.get('/api/aff/refunds', (ctx) => { const a = mine(ctx); const at = C.clock(ctx); const [ms] = C.monthRange(C.monthKey(at)); return { refunds: R.refunds(a.id), month: D.get("SELECT COUNT(CASE WHEN event_type='refund' THEN 1 END) r, COUNT(CASE WHEN event_type='chargeback' THEN 1 END) c, COALESCE(SUM(reversed_cents),0) rev FROM aff_conversions WHERE affiliate_id=? AND occurred_at>=? AND event_type IN ('refund','chargeback')", a.id, ms), refund_rate: V.tierCard(a, at).refund_rate }; });
  r.get('/api/aff/cpa', (ctx) => { const a = mine(ctx); return R.cpa(a.id, C.clock(ctx)); });
  r.get('/api/aff/ledger', (ctx) => {
    const a = mine(ctx); const q = ctx.query;
    const where = ['affiliate_id=?']; const args = [a.id];
    if (q.status) { where.push('status=?'); args.push(String(q.status)); }
    if (q.type) { where.push('type=?'); args.push(String(q.type)); }
    const lim = Math.min(500, Math.max(1, Number(q.limit) || 100)); const off = Math.max(0, Number(q.offset) || 0);
    return { total: D.get(`SELECT COUNT(*) n FROM aff_commissions WHERE ${where.join(' AND ')}`, ...args).n, rows: D.all(`SELECT * FROM aff_commissions WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, ...args, lim, off).map(V.ledgerRow) };
  });

  /* ================= offers and CPA ================= */
  r.get('/api/aff/offers', (ctx) => V.offers(mine(ctx), C.clock(ctx)));
  r.post('/api/aff/cpa-requests', async (ctx) => {
    const a = mine(ctx);
    limit('aff-cpa-req:' + a.id, 10, 3600_000);
    const b = await ctx.json();
    const u = D.get('SELECT * FROM users WHERE id=?', a.user_id);
    const rq = P.requestDeal(A.hydrate(u), a, { ...b, model: b.model === 'hybrid' ? 'hybrid' : 'cpa' }, 'affiliate');
    return { request: { id: rq.id, status: rq.status }, message: 'Sent to your manager. You get an answer within 3 business days.' };
  });

  /* ================= links ================= */
  r.get('/api/aff/links', (ctx) => {
    const a = mine(ctx); const at = C.clock(ctx);
    const links = D.all('SELECT * FROM aff_links WHERE affiliate_id=? AND archived=? ORDER BY id DESC LIMIT 200', a.id, ctx.query.archived === '1' ? 1 : 0).map((l) => linkView(a, l, at));
    return {
      links, base: T.trackingUrl(a), smartlink: T.trackingUrl(a, { product: 'smart' }), recruit: `${config.baseUrl}/a/${a.code}?join=1`,
      deep_links: C.productList().filter((p) => p.commissionable && p.cap_bp > 0).map((p) => ({ product_key: p.key, name: p.name, url: T.trackingUrl(a, { product: p.key }), domain: p.domain })),
      approved_domains: [...T.approvedHosts()], coupons_unlocked: V.perks(a, at).coupons,
    };
  });
  r.post('/api/aff/links', async (ctx) => {
    const a = mine(ctx);
    limit('aff-link:' + a.id, 60, 3600_000);
    const b = await ctx.json();
    const subs = readSubs(b);
    const product = clean(b.product_key, 40);
    if (product && !C.product(product) && !['home', 'smart'].includes(product)) fail(400, 'Choose a destination.');
    let dest = '';
    if (b.dest_url) { dest = T.deepLinkOk(b.dest_url); if (!dest) fail(400, 'Links can only point to VooSquare and Zedapex tool domains.'); }
    if (b.custom_landing && !V.perks(a).custom_landing) fail(403, 'Custom landing pages open at Master.');
    const macro = clean(b.click_macro, 64);
    const id = D.insert('aff_links', { affiliate_id: a.id, code: T.uniqueLinkCode(), name: clean(b.name, 80) || (product ? (C.product(product) || { name: product }).name : 'VooSquare') + (subs.sub1 ? ' · ' + subs.sub1 : ''), product_key: product, dest_url: dest, ...subs, click_macro: macro, created_at: now() }).id;
    return { link: linkView(a, D.get('SELECT * FROM aff_links WHERE id=?', id), C.clock(ctx)) };
  });
  r.patch('/api/aff/links/:id', async (ctx) => {
    const a = mine(ctx); const b = await ctx.json();
    const l = D.get('SELECT * FROM aff_links WHERE id=? AND affiliate_id=?', Number(ctx.params.id), a.id);
    if (!l) fail(404, 'Link not found.');
    if (b.name !== undefined) D.run('UPDATE aff_links SET name=? WHERE id=?', clean(b.name, 80), l.id);
    if (b.archived !== undefined) D.run('UPDATE aff_links SET archived=? WHERE id=?', b.archived ? 1 : 0, l.id);
    return { link: linkView(a, D.get('SELECT * FROM aff_links WHERE id=?', l.id), C.clock(ctx)) };
  });
  /** Link builder preview: the URL for any product / deep link / subs, without saving. */
  r.get('/api/aff/links/build', (ctx) => {
    const a = mine(ctx); const q = ctx.query;
    const subs = readSubs(q);
    let deep = '';
    if (q.url) { deep = T.deepLinkOk(q.url); if (!deep) fail(400, 'Links can only point to VooSquare and Zedapex tool domains.'); }
    const prod = clean(q.product, 40).toLowerCase();
    if (prod && !C.product(prod) && !['home', 'smart'].includes(prod)) fail(400, 'Choose a destination.');
    const url = T.trackingUrl(a, { product: prod, subs, deep, click: clean(q.click_macro, 64) });
    return { url, qr_svg: QR.svg(url, { px: 220 }) };
  });
  r.get('/api/aff/links/:id/qr.svg', (ctx) => {
    const a = mine(ctx);
    const l = D.get('SELECT * FROM aff_links WHERE id=? AND affiliate_id=?', Number(ctx.params.id), a.id);
    if (!l) fail(404, 'Link not found.');
    sendSvg(ctx, QR.svg(T.trackingUrl(a, { link: l }), { px: Number(ctx.query.px) || 512 }));
  });
  r.get('/api/aff/qr.svg', (ctx) => {
    const a = mine(ctx);
    const text = String(ctx.query.text || '');
    if (!text.startsWith(config.baseUrl + '/a/') || text.length > 800) fail(400, 'QR codes are made for your tracking links only.');
    sendSvg(ctx, QR.svg(text, { px: Number(ctx.query.px) || 512 }));
    void a;
  });
  r.get('/api/aff/coupons', (ctx) => {
    const a = mine(ctx);
    return { unlocked: V.perks(a, C.clock(ctx)).coupons, coupons: D.all('SELECT * FROM aff_coupons WHERE affiliate_id=? ORDER BY id DESC', a.id).map((c) => ({ id: c.id, code: c.code, product_key: c.product_key, discount_pct: c.discount_pct, uses: c.uses, max_uses: c.max_uses, active: !!c.active })) };
  });
  r.post('/api/aff/coupons', async (ctx) => {
    const a = mine(ctx); approvedOnly(a);
    if (!V.perks(a, C.clock(ctx)).coupons) fail(403, 'Custom coupon codes open at Master.');
    limit('aff-coupon:' + a.id, 10, 3600_000);
    const b = await ctx.json();
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9_-]{4,20}$/.test(code)) fail(400, 'Use 4 to 20 letters, numbers, _ or -.');
    if (D.get('SELECT 1 FROM aff_coupons WHERE code=?', code)) fail(409, 'That code is taken.');
    if (D.get('SELECT COUNT(*) n FROM aff_coupons WHERE affiliate_id=?', a.id).n >= 20) fail(400, 'You can have up to 20 codes.');
    const pk = clean(b.product_key, 40);
    if (pk && !C.product(pk)) fail(400, 'Unknown product.');
    const id = D.insert('aff_coupons', { affiliate_id: a.id, code, product_key: pk, created_by: a.user_id, created_at: now() }).id;
    return { coupon: D.get('SELECT * FROM aff_coupons WHERE id=?', id) };
  });

  /* ================= payouts, wallets, KYC ================= */
  r.get('/api/aff/payouts', (ctx) => {
    const a = mine(ctx); const at = C.clock(ctx);
    const s = C.settings(); const b = E.balance(a.id, at);
    const open = PAY.openPayout(a.id);
    const method = a.payout_method || 'usdt_trc20';
    const m = s.payouts.methods[method] || {};
    const reasons = [];
    if (a.status !== 'approved') reasons.push(a.status === 'suspended' ? 'paused' : 'not_approved');
    if (C.termsState(a).needs_accept) reasons.push('terms_update');
    if (open) reasons.push('open_request');
    if (b.available_cents < (m.min_cents || 0)) reasons.push('below_minimum');
    if (!(method === 'btc' ? a.wallet_btc : a.wallet_usdt)) reasons.push('no_wallet');
    if (PAY.kycRequired(a, b.available_cents)) reasons.push('kyc_required');
    const tier = C.tiers()[C.effectiveTier(a, at)];
    return {
      balance: b, methods: Object.entries(s.payouts.methods).filter(([, x]) => x.enabled).map(([k, x]) => ({ method: k, label: PAY.METHOD_LABEL[k] || k, min_cents: x.min_cents, fee: x.fee, fee_cents: x.fee_cents })),
      method, wallets: V.me(a, at).wallets, can_request: !reasons.length, blocked_by: reasons, gap_cents: Math.max(0, (m.min_cents || 0) - b.available_cents), payout_days: tier.sla_days,
      terms: C.termsState(a), open: open ? PAY.view(open) : null, history: D.all('SELECT * FROM aff_payouts WHERE affiliate_id=? ORDER BY id DESC LIMIT 50', a.id).map((p) => PAY.view(p)), kyc: KYC.state(a),
    };
  });
  r.post('/api/aff/payouts', async (ctx) => {
    const a = mine(ctx);
    limit('aff-payout:' + a.id, 10, 600_000);
    const b = await ctx.json();
    const p = PAY.request(a, { method: b.method }, C.clock(ctx));
    publish('staff', 'aff', { kind: 'payout', id: p.id });
    return { payout: PAY.view(p), balance: E.balance(a.id, C.clock(ctx)) };
  });
  r.post('/api/aff/payouts/:id/cancel', (ctx) => { const a = mine(ctx); limit('aff-payout-c:' + a.id, 12, 600_000); return { payout: PAY.view(PAY.cancel(a, ctx.params.id)), balance: E.balance(a.id, C.clock(ctx)) }; });
  r.get('/api/aff/payouts/:id', (ctx) => {
    const a = mine(ctx);
    const p = D.get('SELECT * FROM aff_payouts WHERE id=? AND affiliate_id=?', Number(ctx.params.id), a.id);
    if (!p) fail(404, 'Payout not found.');
    return { payout: PAY.view(p), lines: PAY.lineItems(p.id) };
  });
  /* Receipt PDF: the affiliate, or finance staff. */
  r.get('/api/aff/payouts/:id/receipt.pdf', (ctx) => {
    const u = A.requireUser(ctx);
    const p = D.get('SELECT * FROM aff_payouts WHERE id=?', Number(ctx.params.id));
    if (!p) fail(404, 'Payout not found.');
    const a = C.byId(p.affiliate_id);
    if (!(a && a.user_id === u.id) && !P.roles(u).finance) fail(404, 'Payout not found.');
    sendPdf(ctx, PAY.receiptPdf(p.id), `voosquare-receipt-${p.receipt_no || p.id}.pdf`);
  });
  r.get('/api/aff/receipts', (ctx) => {
    const a = mine(ctx);
    return { receipts: D.all('SELECT r.receipt_no, r.issued_at, r.payout_id, p.amount_cents, p.method, p.tx_hash FROM aff_receipts r JOIN aff_payouts p ON p.id=r.payout_id WHERE r.affiliate_id=? ORDER BY r.id DESC', a.id).map((x) => ({ ...x, url: `/api/aff/payouts/${x.payout_id}/receipt.pdf` })) };
  });
  r.get('/api/aff/statements', (ctx) => {
    const a = mine(ctx); const at = C.clock(ctx);
    if (ctx.query.month) return PAY.statement(a, String(ctx.query.month));
    const months = []; let k = C.monthKey(at); const first = C.monthKey(a.created_at);
    for (let i = 0; i < 24; i++) { months.push({ month: k, pdf: `/api/aff/statements/${k}.pdf` }); if (k <= first) break; k = C.addMonths(k, -1); }
    return { months };
  });
  r.get('/api/aff/statements/:month', (ctx) => {
    const a = mine(ctx);
    const m = /^(\d{4}-\d{2})\.pdf$/.exec(ctx.params.month);
    if (!m) fail(404, 'Not found.');
    sendPdf(ctx, PAY.statementPdf(a, m[1]), `voosquare-statement-${m[1]}.pdf`);
  });
  r.put('/api/aff/wallets', async (ctx) => {
    const a = mine(ctx);
    limit('aff-wallet:' + a.id, 20, 600_000);
    if (PAY.openPayout(a.id)) fail(409, 'Your payout address is locked while a request is open.');
    const b = await ctx.json();
    const sets = {};
    if (b.usdt_trc20 !== undefined) sets.wallet_usdt = b.usdt_trc20 ? PAY.cleanWallet('usdt_trc20', b.usdt_trc20) : '';
    if (b.btc !== undefined) sets.wallet_btc = b.btc ? PAY.cleanWallet('btc', b.btc) : '';
    if (b.method !== undefined) { if (!PAY.METHOD_LABEL[b.method]) fail(400, 'Choose USDT (TRC20) or BTC.'); sets.payout_method = b.method; }
    const keys = Object.keys(sets);
    if (keys.length) D.run(`UPDATE aff_affiliates SET ${keys.map((k) => k + '=?').join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => sets[k]), now(), a.id);
    C.audit(a.user_id, 'wallet.save', { affiliate_id: a.id, after: { usdt: sets.wallet_usdt ? C.maskWallet(sets.wallet_usdt) : undefined, btc: sets.wallet_btc ? C.maskWallet(sets.wallet_btc) : undefined, method: sets.payout_method } });
    return { wallets: V.me(C.byId(a.id), C.clock(ctx)).wallets };
  });
  r.get('/api/aff/kyc', (ctx) => KYC.state(mine(ctx)));
  r.post('/api/aff/kyc/start', async (ctx) => { const a = mine(ctx); limit('aff-kyc:' + a.id, 10, 3600_000); return KYC.start(a); });
  r.post('/api/aff/kyc/documents', async (ctx) => { const a = mine(ctx); limit('aff-kyc-d:' + a.id, 20, 3600_000); const b = await ctx.json(); return KYC.submitDocs(a, b.documents); });

  /* ================= postbacks ================= */
  r.get('/api/aff/postbacks', (ctx) => {
    const a = mine(ctx);
    const failed = ctx.query.failed === '1';
    return {
      postbacks: D.all('SELECT * FROM aff_postbacks WHERE affiliate_id=? ORDER BY id', a.id).map(PB.view), events: PB.EVENTS, macros: PB.MACROS, retry_minutes: PB.RETRY_MIN,
      logs: D.all(`SELECT * FROM aff_postback_deliveries WHERE affiliate_id=? AND created_at>? ${failed ? "AND status IN ('retry','dead')" : ''} ORDER BY id DESC LIMIT 200`, a.id, now() - 30 * DAY).map(PB.deliveryView),
      example: 'https://tracker.example.com/postback?cid={click_id}&event={event}&payout={commission}&sub1={sub1}',
    };
  });
  const savePostback = async (ctx, existing) => {
    const a = mine(ctx);
    limit('aff-pb:' + a.id, 30, 600_000);
    const b = await ctx.json();
    const url = String(b.url !== undefined ? b.url : existing ? existing.url : '').trim();
    const prob = PB.urlProblem(url);
    if (prob) fail(400, prob.includes('https') ? 'URL must start with https://' : prob);
    const events = b.events !== undefined ? PB.cleanEvents(b.events) : existing ? C.json(existing.events, []) : ['first_payment', 'qualified'];
    if (!events.length) fail(400, 'Choose at least one event.');
    const method = (b.method || (existing && existing.method) || 'GET').toUpperCase() === 'POST' ? 'POST' : 'GET';
    const products = b.products !== undefined ? (Array.isArray(b.products) ? b.products.filter((k) => C.product(k)) : []) : existing ? C.json(existing.products, []) : [];
    const row = { name: clean(b.name !== undefined ? b.name : existing ? existing.name : '', 60) || 'Postback', url, method, events: JSON.stringify(events), products: JSON.stringify(products),
      active: b.active !== undefined ? (b.active ? 1 : 0) : existing ? existing.active : 1, secret: b.secret !== undefined ? clean(b.secret, 128) : existing ? existing.secret : '', updated_at: now() };
    if (existing) { D.update('aff_postbacks', existing.id, row, Object.keys(row)); return { postback: PB.view(D.get('SELECT * FROM aff_postbacks WHERE id=?', existing.id)) }; }
    if (D.get('SELECT COUNT(*) n FROM aff_postbacks WHERE affiliate_id=?', a.id).n >= 20) fail(400, 'You can have up to 20 postbacks.');
    const id = D.insert('aff_postbacks', { affiliate_id: a.id, ...row, created_at: now() }).id;
    return { postback: PB.view(D.get('SELECT * FROM aff_postbacks WHERE id=?', id)) };
  };
  const ownPb = (ctx) => { const a = mine(ctx); const pb = D.get('SELECT * FROM aff_postbacks WHERE id=? AND affiliate_id=?', Number(ctx.params.id), a.id); if (!pb) fail(404, 'Postback not found.'); return { a, pb }; };
  r.post('/api/aff/postbacks', (ctx) => savePostback(ctx, null));
  r.put('/api/aff/postbacks/:id', (ctx) => savePostback(ctx, ownPb(ctx).pb));
  r.del('/api/aff/postbacks/:id', (ctx) => { const { pb } = ownPb(ctx); D.run('DELETE FROM aff_postbacks WHERE id=?', pb.id); return { ok: true }; });
  r.post('/api/aff/postbacks/:id/test', async (ctx) => {
    const { a, pb } = ownPb(ctx);
    limit('aff-pb-test:' + a.id, 20, 600_000);
    const b = await ctx.json();
    const res = await PB.test(a, pb, b.event);
    return { ok: res.ok, code: res.code, ms: res.ms, error: res.error, message: res.ok || res.code ? `Test sent. Your server answered ${res.code}.` : res.error || 'That host could not be reached. Check the domain.' };
  });
  r.post('/api/aff/postbacks/logs/:id/resend', (ctx) => {
    const a = mine(ctx);
    const d = D.get('SELECT * FROM aff_postback_deliveries WHERE id=? AND affiliate_id=? AND test=0', Number(ctx.params.id), a.id);
    if (!d) fail(404, 'Log entry not found.');
    PB.resend(d);
    return { ok: true };
  });

  /* ================= Telegram ================= */
  r.get('/api/aff/telegram', (ctx) => TG.state(mine(ctx).id));
  r.post('/api/aff/telegram/connect', async (ctx) => { const a = mine(ctx); limit('aff-tg:' + a.id, 10, 600_000); return TG.connect(a.id); });
  r.post('/api/aff/telegram/disconnect', (ctx) => { const a = mine(ctx); TG.disconnect(a.id); return TG.state(a.id); });
  r.put('/api/aff/telegram/prefs', async (ctx) => { const a = mine(ctx); return TG.setPrefs(a.id, await ctx.json()); });
  r.post('/api/aff/telegram/test', (ctx) => {
    const a = mine(ctx); limit('aff-tg-test:' + a.id, 5, 600_000);
    const st = TG.state(a.id);
    if (!st.configured) fail(400, 'Telegram alerts are not configured on this server.');
    if (!st.connected) fail(400, 'Connect Telegram first.');
    TG.alert(a, null, 'Test alert from VooSquare Affiliates. Your alerts arrive here.');
    return { ok: true };
  });
  r.post('/api/aff/telegram/webhook', async (ctx) => {
    if (!TG.configured()) fail(404, 'Not configured.');
    if (!TG.checkSecret(ctx)) fail(401, 'Bad secret');
    return TG.onUpdate(await ctx.json());
  }, { noCsrf: true });

  /* ================= creatives, contests, announcements, notifications, manager ================= */
  r.get('/api/aff/creatives', (ctx) => { const a = mine(ctx); return { creatives: P.creativesFor(a, ctx.query, C.clock(ctx)) }; });
  r.post('/api/aff/creatives/:id/use', async (ctx) => {
    const a = mine(ctx); const b = await ctx.json();
    const cr = D.get('SELECT * FROM aff_creatives WHERE id=? AND active=1', Number(ctx.params.id));
    if (!cr) fail(404, 'Creative not found.');
    limit('aff-cr:' + a.id, 120, 600_000);
    D.run(`UPDATE aff_creatives SET ${b.kind === 'copy' ? 'copies=copies+1' : 'downloads=downloads+1'} WHERE id=?`, cr.id);
    return { ok: true };
  });
  r.get('/api/aff/brand-kit', () => ({
    logos: [{ name: 'Logo, light', url: '/assets/logo-light.png' }, { name: 'Logo, dark', url: '/assets/logo-dark.png' }, { name: 'Icon', url: '/assets/logo-icon.svg' }],
    product_icons: C.productList().filter((p) => p.icon).map((p) => ({ key: p.key, name: p.name, url: `/assets/icons/${/^[a-z0-9_-]+$/i.test(p.icon) ? p.icon : 'voosquare'}.svg` })),
    colours: [['VooSquare green', '#00A86B'], ['Green', '#12C784'], ['Deep green', '#00774B'], ['Lime', '#C9F65B'], ['Night', '#0A1611']].map(([name, hex]) => ({ name, hex })),
    fonts: ['Plus Jakarta Sans', 'Instrument Serif', 'JetBrains Mono'],
    do: ['Show what the tool does', 'Use real screenshots', 'Say "Start free" where the product offers it', 'Add your own experience'],
    dont: ['Change logos', 'Use our names in search ads', 'Say you are VooSquare or Zedapex', 'Promise income', 'Use fake reviews', 'Show Inner Circle as a paid offer'],
  }));
  r.get('/api/aff/contests', (ctx) => {
    const a = mine(ctx); const at = C.clock(ctx);
    return { contests: CT.list({ at }).map((c) => { const lb = ['live', 'qualifying', 'closed', 'pending_signoff', 'completed'].includes(c.status) ? CT.leaderboard(c.id, a.id, 3, at) : null; return { ...c, me: lb ? lb.me : null, top: lb ? lb.board : [], entrants: lb ? lb.entrants : 0 }; }) };
  });
  r.get('/api/aff/contests/:id', (ctx) => {
    const a = mine(ctx); const at = C.clock(ctx);
    const c = CT.get(ctx.params.id);
    if (!c || !c.published || c.cancelled) fail(404, 'Contest not found.');
    return { contest: CT.view(c, at), ...CT.leaderboard(c.id, a.id, Math.min(200, Number(ctx.query.limit) || 50), at) };
  });
  r.get('/api/aff/announcements', (ctx) => { const a = mine(ctx); return { announcements: P.announcementsFor(a, C.clock(ctx), 50) }; });
  r.get('/api/aff/notifications', (ctx) => {
    const a = mine(ctx);
    const cat = ctx.query.category && ctx.query.category !== 'All' ? String(ctx.query.category) : null;
    const rows = D.all(`SELECT * FROM aff_notifications WHERE affiliate_id=? ${cat ? 'AND category=?' : ''} ORDER BY id DESC LIMIT ?`, ...[a.id, ...(cat ? [cat] : []), Math.min(200, Number(ctx.query.limit) || 50)]);
    return { unread: D.get('SELECT COUNT(*) n FROM aff_notifications WHERE affiliate_id=? AND read_at IS NULL', a.id).n, notifications: rows.map((n) => ({ id: n.id, category: n.category, kind: n.kind, text: n.text, product_key: n.product_key, link: n.link, read: !!n.read_at, at: n.created_at })) };
  });
  r.post('/api/aff/notifications/read', async (ctx) => {
    const a = mine(ctx); const b = await ctx.json();
    if (b.all) D.run('UPDATE aff_notifications SET read_at=? WHERE affiliate_id=? AND read_at IS NULL', now(), a.id);
    else for (const id of (Array.isArray(b.ids) ? b.ids : []).slice(0, 200)) D.run('UPDATE aff_notifications SET read_at=? WHERE id=? AND affiliate_id=?', now(), Number(id), a.id);
    return { ok: true };
  });
  r.get('/api/aff/manager', (ctx) => {
    const a = mine(ctx); const at = C.clock(ctx);
    return {
      general: V.userCard(a.general_manager_id), private: V.userCard(a.private_manager_id), private_unlocked: V.perks(a, at).private_manager,
      reply_target: a.private_manager_id ? 'Within 4 working hours' : 'Within 1 business day',
      notes: D.all('SELECT n.id, n.body, n.created_at, n.author_id, u.name FROM aff_notes n LEFT JOIN users u ON u.id=n.author_id WHERE n.affiliate_id=? AND n.shared=1 ORDER BY n.id DESC LIMIT 50', a.id).map((n) => ({ id: n.id, body: n.body, by: n.name, at: n.created_at, mine: n.author_id === a.user_id })),
    };
  });
  /**
   * Net sub-affiliate earnings of parent `affId` (from one sub, or all): overrides not cancelled, minus the clawbacks on
   * overrides that were already released or paid when their source was charged back or reversed for fraud (money audit
   * MN-8), so this page agrees with the balance and the ledger.
   */
  const subNet = (affId, subId = null) => D.get(`SELECT COALESCE(SUM(k.amount_cents),0) s FROM aff_commissions k
    JOIN aff_commissions o ON o.id=CASE WHEN k.type='sub_override' THEN k.id ELSE k.source_commission_id END AND o.type='sub_override'
    LEFT JOIN aff_commissions src ON src.id=o.source_commission_id
    WHERE k.affiliate_id=? AND ((k.type='sub_override' AND k.status NOT IN ('reversed','declined')) OR k.type='clawback')
    ${subId ? 'AND (src.affiliate_id=? OR (src.id IS NULL AND o.note=?))' : ''}`, affId, ...(subId ? [subId, `Sub-affiliate #${subId}`] : [])).s;
  r.get('/api/aff/subs', (ctx) => {
    const a = mine(ctx); const at = C.clock(ctx);
    const s = C.settings().subs;
    const subs = D.all('SELECT * FROM aff_affiliates WHERE parent_affiliate_id=? ORDER BY id DESC', a.id).map(C.hydrate);
    const rows = subs.map((x) => {
      const q = D.get('SELECT COUNT(*) n FROM aff_customers WHERE affiliate_id=? AND qualified_at IS NOT NULL', x.id).n;
      const cust = D.get('SELECT COUNT(*) n FROM aff_customers WHERE affiliate_id=? AND first_payment_at IS NOT NULL', x.id).n;
      const earned = subNet(a.id, x.id);
      return { ref: `AF-${x.id}`, name: x.hide_name ? `Affiliate #${x.id}` : x.display_name, country: x.country, status: x.status, tier: C.tierName(C.effectiveTier(x, at)), paying_customers: cust, qualified_customers: q, active: x.status === 'approved' && x.health_state !== 'paused' && q >= s.boost_sub_customers, your_earnings_cents: earned, joined_at: x.created_at };
    });
    const rate = E.subRate(a);
    return { enabled: s.enabled, eligible: rate > 0, rate_bp: rate, base_rate_bp: s.rate_bp, boosted_rate_bp: s.boosted_rate_bp, boost: { need_subs: s.boost_subs, need_customers_each: s.boost_sub_customers, have: rows.filter((x) => x.active).length },
      recruit_link: `${config.baseUrl}/a/${a.code}?join=1`, sub_code: a.sub_code, subs: rows, total_earned_cents: subNet(a.id) };
  });

  /* ================= settings ================= */
  r.get('/api/aff/settings', (ctx) => {
    const a = mine(ctx); const me = V.me(a, C.clock(ctx));
    return { profile: { display_name: a.display_name, hide_name: !!a.hide_name, kind: a.kind, company: a.company, country: a.country, languages: a.languages, telegram: a.telegram, whatsapp: a.whatsapp, avatar: me.avatar },
      traffic: a.traffic, wallets: me.wallets, telegram: TG.state(a.id), tax: { country: a.tax_country, tax_id_set: !!a.tax_id }, api_key: me.api_key, api_unlocked: me.perks.stats_api,
      legal: { terms_version: a.terms_version, accepted_at: a.terms_accepted_at, current_version: C.settings().terms_version, needs_accept: C.termsState(a).needs_accept,
        history: D.all('SELECT version, accepted_at, source FROM aff_terms_acceptances WHERE affiliate_id=? ORDER BY id DESC LIMIT 10', a.id) }, marketing: !!a.marketing };
  });
  r.patch('/api/aff/settings', async (ctx) => {
    const a = mine(ctx);
    limit('aff-settings:' + a.id, 30, 600_000);
    const b = await ctx.json(); const sets = {};
    if (b.display_name !== undefined) { const v = clean(b.display_name, 40); if (v.length < 2) fail(400, 'Display name needs 2 characters or more.'); sets.display_name = v; }
    if (b.hide_name !== undefined) sets.hide_name = b.hide_name ? 1 : 0;
    if (b.kind !== undefined) sets.kind = b.kind === 'company' ? 'company' : 'individual';
    if (b.company !== undefined) sets.company = clean(b.company, 80);
    if (b.country !== undefined) { const v = String(b.country).toUpperCase(); if (!/^[A-Z]{2}$/.test(v)) fail(400, 'Choose a country.'); sets.country = v; }
    if (b.languages !== undefined) sets.languages = JSON.stringify((Array.isArray(b.languages) ? b.languages : []).map((x) => clean(x, 30)).slice(0, 6));
    if (b.telegram !== undefined) { const v = clean(b.telegram, 40).replace(/^@?/, '@'); if (!/^@[A-Za-z0-9_]{4,32}$/.test(v)) fail(400, 'Check the Telegram username.'); sets.telegram = v; }
    if (b.whatsapp !== undefined) sets.whatsapp = clean(b.whatsapp, 24);
    if (b.tax_country !== undefined) sets.tax_country = String(b.tax_country || '').toUpperCase().slice(0, 2);
    if (b.tax_id !== undefined) sets.tax_id = clean(b.tax_id, 40);
    if (b.marketing !== undefined) sets.marketing = b.marketing ? 1 : 0;
    if (b.traffic !== undefined && b.traffic && typeof b.traffic === 'object') {
      const t = { ...a.traffic };
      if (b.traffic.sources !== undefined) t.sources = (Array.isArray(b.traffic.sources) ? b.traffic.sources : []).filter((x) => P.SOURCES.includes(x)).slice(0, 16);
      if (b.traffic.geos !== undefined) t.geos = (Array.isArray(b.traffic.geos) ? b.traffic.geos : []).map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, 5);
      if (b.traffic.volume !== undefined && P.VOLUMES.includes(b.traffic.volume)) t.volume = b.traffic.volume;
      if (b.traffic.links !== undefined) t.links = (Array.isArray(b.traffic.links) ? b.traffic.links : []).map((u) => safeUrl(u, 300)).filter(Boolean).slice(0, 5);
      sets.traffic = JSON.stringify(t);
      C.audit(a.user_id, 'traffic.update', { affiliate_id: a.id, before: a.traffic, after: t });
    }
    if (b.accept_terms && a.terms_version !== C.settings().terms_version) C.acceptTerms(a, 'settings', now());
    const keys = Object.keys(sets);
    if (keys.length) D.run(`UPDATE aff_affiliates SET ${keys.map((k) => k + '=?').join(',')}, updated_at=? WHERE id=?`, ...keys.map((k) => sets[k]), now(), a.id);
    return { account: V.me(C.byId(a.id), C.clock(ctx)) };
  });
  r.post('/api/aff/api-key', (ctx) => { const a = mine(ctx); approvedOnly(a); limit('aff-key:' + a.id, 5, 3600_000); return { key: P.newApiKey(a), note: 'Copy it now. It is shown once.' }; });
  r.del('/api/aff/api-key', (ctx) => { const a = mine(ctx); D.run("UPDATE aff_affiliates SET api_key_hash=NULL, api_key_prefix='' WHERE id=?", a.id); return { ok: true }; });
  r.put('/api/aff/api-ips', async (ctx) => {
    const a = mine(ctx); const b = await ctx.json();
    const ips = (Array.isArray(b.ips) ? b.ips : []).map((x) => String(x).trim()).filter((x) => require('node:net').isIP(x)).slice(0, 10);
    D.run('UPDATE aff_affiliates SET api_ips=? WHERE id=?', JSON.stringify(ips), a.id);
    return { ips };
  });

  /* ================= stats API (read-only, API key) ================= */
  const byKey = (ctx) => {
    const auth = String(ctx.req.headers.authorization || '');
    const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : String(ctx.query.api_key || '');
    const a = P.byApiKey(key);
    if (!a || !['approved', 'suspended'].includes(a.status)) fail(401, 'Unknown or missing API key. Send Authorization: Bearer vsa_...');
    if (a.api_ips.length && !a.api_ips.includes(ctx.ip)) fail(403, 'This IP address is not on the allowlist for your API key.');
    limit('aff-api:' + a.id, 120, 60_000);
    return a;
  };
  r.get('/api/aff/v1/stats', (ctx) => { const a = byKey(ctx); return { affiliate_id: `AF-${a.id}`, ...R.kpis(a.id, ctx.query.period || 'today', now()) }; });
  r.get('/api/aff/v1/report', (ctx) => { const a = byKey(ctx); return R.report(a.id, ctx.query, now()); });
  r.get('/api/aff/v1/conversions', (ctx) => { const a = byKey(ctx); return R.conversions(a.id, ctx.query, now()); });
  r.get('/api/aff/v1/payouts', (ctx) => { const a = byKey(ctx); return { balance: E.balance(a.id), payouts: D.all('SELECT * FROM aff_payouts WHERE affiliate_id=? ORDER BY id DESC LIMIT 100', a.id).map((p) => PAY.view(p, { reveal: false })) }; });

  /* ================= provider webhooks ================= */
  r.post('/api/aff/hooks/kyc', async (ctx) => KYC.webhook(ctx.req.headers, await ctx.raw()), { noCsrf: true });
  r.post('/api/aff/hooks/payouts', async (ctx) => PAY.providerWebhook(ctx.req.headers, await ctx.raw()), { noCsrf: true });
};
