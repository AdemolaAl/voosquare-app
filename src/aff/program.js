'use strict';
/*
 * The affiliate program around the money: accounts and applications, approval workflow and manager assignment, deals and
 * deal requests (within program limits, owner approval above them), scheduled offer changes with notice periods,
 * announcements, creatives, program settings and product rules.
 */
const config = require('../config');
const D = require('../db');
const A = require('../auth');
const C = require('./core');
const N = require('./notify');
const { now, rid, publish, safeUrl } = require('../util');

const DAY = C.DAY;
const DECLINE_APP = {
  not_enough_info: 'Not enough information about your traffic', links_dead: 'Links did not work or showed no activity', traffic_type: 'Traffic type we do not accept (incentivised, spam, adult)',
  geo_vertical: 'Country or vertical we cannot serve yet', duplicate: 'Duplicate account', terms_breach: 'Terms breach on another account',
};
const SOURCES = ['Meta ads', 'TikTok ads', 'Google ads', 'Snapchat ads', 'Native', 'Push', 'Telegram channel or group', 'YouTube', 'Instagram or TikTok organic', 'X', 'Email list', 'Website or blog', 'SEO', 'Community or course', 'Agency clients', 'Other'];
const VOLUMES = ['Under $1k ad spend', '$1k–$10k', '$10k–$50k', '$50k–$200k', '$200k+', 'I do not run paid ads'];

/* ------------------------------------------------------------------ roles */
const roles = (u) => {
  const owner = !!u && u.perms.includes('*');
  const admin = owner || A.can(u, 'aff_admin');
  return { owner, admin, manager: admin || A.can(u, 'aff_manager'), fraud: admin || A.can(u, 'aff_fraud'), finance: admin || A.can(u, 'aff_finance') || A.can(u, 'payments'), any: admin || ['aff_manager', 'aff_fraud', 'aff_finance'].some((p) => A.can(u, p)) };
};
/** Managers see only the affiliates assigned to them; admins see all. */
function canSee(u, a) {
  const r = roles(u);
  if (r.admin || r.fraud || r.finance) return true;
  return !!a && (a.general_manager_id === u.id || a.private_manager_id === u.id);
}
function scopeSql(u, alias = 'a') {
  const r = roles(u);
  if (r.admin || r.fraud || r.finance) return { sql: '1=1', args: [] };
  return { sql: `(${alias}.general_manager_id=? OR ${alias}.private_manager_id=?)`, args: [u.id, u.id] };
}

/* ------------------------------------------------------------------ accounts and applications */
function uniqueSubCode() { for (;;) { const c = 'S' + rid(4).replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase(); if (c.length >= 5 && !D.get('SELECT 1 FROM aff_affiliates WHERE sub_code=?', c)) return c; } }
/** Create the affiliate account for a Voo ID (idempotent). The dashboard works at once; earnings start at approval. */
function ensure(user, { parent = null } = {}) {
  let a = C.byUser(user.id);
  if (a) return a;
  const code = user.ref_code;
  const t = now();
  // One level only: the parent is recorded; earnings flow only from a sub to its direct parent.
  const parentId = parent && parent.user_id !== user.id && ['approved', 'pending'].includes(parent.status) ? parent.id : null;
  D.run(`INSERT OR IGNORE INTO aff_affiliates(user_id, code, status, display_name, country, sub_code, notif_prefs, created_at, updated_at, parent_affiliate_id)
    VALUES(?,?,?,?,?,?,?,?,?,?)`, user.id, code, 'pending', C.clean(user.handle || user.name, 40), user.country || '', uniqueSubCode(), '{}', t, t, parentId);
  a = C.byUser(user.id);
  C.audit(user, 'affiliate.create', { affiliate_id: a.id, after: { parent: a.parent_affiliate_id } });
  return a;
}
const pickList = (v, allowed, max) => (Array.isArray(v) ? v : []).map((x) => C.clean(x, 60)).filter((x) => !allowed || allowed.includes(x)).slice(0, max);
const countries = (v, max) => (Array.isArray(v) ? v : []).map((x) => String(x || '').toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x)).slice(0, max);
/** Save one step of the 4-step application. Step 4 submits it. */
function saveStep(a, step, b, ctx) {
  if (a.status === 'approved' || a.status === 'suspended') C.fail(409, 'Your account is already approved.');
  if (a.status === 'closed') C.fail(409, 'This affiliate account is closed.');
  if (a.status === 'rejected') {
    if (now() < (a.reapply_after || 0)) C.fail(409, `You can apply again after ${C.dayKey(a.reapply_after)}.`);
    D.run("UPDATE aff_affiliates SET status='pending', applied_at=NULL, app_step=0, decline_reasons='[]', info_request='' WHERE id=?", a.id);
  }
  const app = { ...(a.application || {}) };
  step = Number(step);
  if (step === 1) {
    const name = C.clean(b.display_name, 40);
    if (name.length < 2) C.fail(400, 'Add a display name (shown on contest leaderboards).');
    const tg = C.clean(b.telegram, 40).replace(/^@?/, '@');
    if (!/^@[A-Za-z0-9_]{4,32}$/.test(tg)) C.fail(400, 'Add your Telegram username. Your manager contacts you there.');
    const cc = String(b.country || '').toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) C.fail(400, 'Choose your country of residence.');
    const kind = b.kind === 'company' ? 'company' : 'individual';
    if (kind === 'company' && C.clean(b.company, 80).length < 2) C.fail(400, 'Add the company name.');
    Object.assign(app, { display_name: name, kind, company: kind === 'company' ? C.clean(b.company, 80) : '', company_country: kind === 'company' ? String(b.company_country || '').toUpperCase().slice(0, 2) : '', country: cc, telegram: tg, whatsapp: C.clean(b.whatsapp, 24), language: C.clean(b.language, 30) || 'English' });
    D.run('UPDATE aff_affiliates SET display_name=?, kind=?, company=?, country=?, telegram=?, whatsapp=?, languages=? WHERE id=?', name, kind, app.company, cc, tg, app.whatsapp, JSON.stringify([app.language]), a.id);
  } else if (step === 2) {
    const sources = pickList(b.sources, SOURCES, 16);
    if (!sources.length) C.fail(400, 'Choose at least one traffic source.');
    const geos = countries(b.geos, 5);
    if (!geos.length) C.fail(400, 'Choose the countries you send most traffic to.');
    const volume = VOLUMES.includes(b.volume) ? b.volume : '';
    if (!volume) C.fail(400, 'Choose your monthly volume.');
    Object.assign(app, { sources, geos, volume, audience_size: Math.max(0, Math.floor(Number(b.audience_size) || 0)), audience_platform: C.clean(b.audience_platform, 40), products: pickList(b.products, null, 12) });
    D.run('UPDATE aff_affiliates SET traffic=? WHERE id=?', JSON.stringify({ sources, geos, volume, audience_size: app.audience_size, audience_platform: app.audience_platform }), a.id);
  } else if (step === 3) {
    const plan = C.clean(b.plan, 600);
    if (plan.length < 50) C.fail(400, 'Tell us how you plan to promote VooSquare (at least 50 characters).');
    const links = (Array.isArray(b.links) ? b.links : []).map((u) => safeUrl(u, 300)).filter((u) => /^https?:\/\//.test(u)).slice(0, 5);
    Object.assign(app, { years: C.clean(b.years, 20), verticals: pickList(b.verticals, null, 10), networks: C.clean(b.networks, 300), links, plan, heard: C.clean(b.heard, 60) });
  } else if (step === 4) {
    if (!b.accept_terms || !b.no_income_claims || !b.adult) C.fail(400, 'Tick the three boxes to submit your application.');
    for (const k of ['display_name', 'sources', 'plan']) if (!app[k]) C.fail(400, 'Finish the earlier steps first.');
    const P = require('./payouts');
    if (b.usdt) { const w = P.cleanWallet('usdt_trc20', b.usdt); D.run('UPDATE aff_affiliates SET wallet_usdt=? WHERE id=?', w, a.id); }
    if (b.btc) { const w = P.cleanWallet('btc', b.btc); D.run('UPDATE aff_affiliates SET wallet_btc=? WHERE id=?', w, a.id); }
    app.submitted = true;
    const t = now();
    D.run('UPDATE aff_affiliates SET applied_at=?, marketing=?, general_manager_id=COALESCE(general_manager_id, ?) WHERE id=?', t, b.news ? 1 : 0, assignGeneral(a), a.id);
    C.acceptTerms(a, 'application', t); // new applicants accept the current version directly (history row + audit)
    if (ctx) { try { require('./fraud').recordRequest(a.user_id, ctx, t); } catch { /* ignore */ } }
  } else C.fail(400, 'Unknown step.');
  D.run('UPDATE aff_affiliates SET application=?, app_step=MAX(app_step,?), updated_at=? WHERE id=?', JSON.stringify(app), step, now(), a.id);
  const out = C.byId(a.id);
  if (step === 4) {
    C.audit(a.user_id, 'application.submit', { affiliate_id: a.id });
    N.emit(out, 'applied', { text: 'Application sent. You can explore the dashboard while we review it.', email: { name: out.display_name } });
    publish('staff', 'aff', { kind: 'application', id: a.id });
  }
  return out;
}
/** Automatic checks shown on an application card. */
function appChecks(a) {
  const u = D.get('SELECT * FROM users WHERE id=?', a.user_id);
  const blocked = new Set((C.settings().blocked_countries || []).map(String));
  const idents = D.all("SELECT kind, value FROM aff_identities WHERE user_id=? AND kind IN ('fp','ip','email')", a.user_id);
  let dup = null;
  for (const i of idents) {
    const o = D.get('SELECT a.id FROM aff_identities x JOIN aff_affiliates a ON a.user_id=x.user_id WHERE x.kind=? AND x.value=? AND x.user_id<>? LIMIT 1', i.kind, i.value, a.user_id);
    if (o) { dup = { affiliate: `AF-${o.id}`, kind: i.kind === 'fp' ? 'device' : i.kind }; break; }
  }
  if (!dup && a.wallet_usdt) { const o = D.get("SELECT id FROM aff_affiliates WHERE wallet_usdt=? AND id<>? LIMIT 1", a.wallet_usdt, a.id); if (o) dup = { affiliate: `AF-${o.id}`, kind: 'payout address' }; }
  /* Each label states what is true, so a red chip never reads as a passed check ("Voo ID is new (3 days)", "No links"). */
  const ageDays = u ? Math.max(0, Math.floor((now() - u.created_at) / DAY)) : 0;
  const nLinks = ((a.application || {}).links || []).length;
  const blockedCountry = blocked.has(a.country);
  return [
    { key: 'voo_id_age', label: u && ageDays > 30 ? 'Voo ID older than 30 days' : `Voo ID is new (${ageDays} ${ageDays === 1 ? 'day' : 'days'})`, ok: !!u && now() - u.created_at > 30 * DAY },
    { key: 'email', label: 'Email verified', ok: true },
    { key: 'duplicates', label: dup ? `Same ${dup.kind} as ${dup.affiliate}` : 'No duplicate signals', ok: !dup },
    { key: 'country', label: blockedCountry ? 'Country is on the block list' : 'Country not on block list', ok: !blockedCountry },
    { key: 'links', label: nLinks ? `${nLinks} ${nLinks === 1 ? 'link' : 'links'} added` : 'No links', ok: nLinks > 0 },
  ];
}

function decideGuard(me, a) {
  if (!canSee(me, a)) C.fail(404, 'Affiliate not found.');
  if (a.user_id === me.id) C.fail(403, 'You cannot decide your own application.');
}
function approve(me, a, at = now()) {
  decideGuard(me, a);
  if (a.status === 'approved') C.fail(409, 'Already approved.');
  if (!a.applied_at && a.status === 'pending') C.fail(409, 'The application is not submitted yet.');
  D.run("UPDATE aff_affiliates SET status='approved', approved_at=?, decided_by=?, decided_at=?, tier=0, tier_month=?, info_request='', welcome_seen=0, updated_at=? WHERE id=?", at, me.id, at, C.monthKey(at), now(), a.id);
  C.audit(me, 'application.approve', { affiliate_id: a.id, before: { status: a.status }, after: { status: 'approved' } });
  const out = C.byId(a.id);
  const gm = out.general_manager_id ? D.get('SELECT name FROM users WHERE id=?', out.general_manager_id) : null;
  N.emit(out, 'approved', { text: `You are approved. You earn ${C.tiers()[0].rate_bp / 100}% lifetime RevShare from today.${gm ? ` Your manager is ${gm.name}.` : ''} Create your first link: ${N.affUrl('links')}`, email: { manager: gm ? gm.name : 'the VooSquare team', rate: `${C.tiers()[0].rate_bp / 100}%` } });
  return out;
}
function reject(me, a, reasons, note) {
  decideGuard(me, a);
  const list = (Array.isArray(reasons) ? reasons : []).filter((r) => DECLINE_APP[r]);
  if (!list.length) C.fail(400, 'Choose at least one reason.');
  const after = now() + C.settings().reapply_days * DAY;
  D.run("UPDATE aff_affiliates SET status='rejected', decided_by=?, decided_at=?, decline_reasons=?, reapply_after=?, info_request=?, updated_at=? WHERE id=?", me.id, now(), JSON.stringify(list), after, C.clean(note, 500), now(), a.id);
  C.audit(me, 'application.reject', { affiliate_id: a.id, after: { reasons: list } });
  const out = C.byId(a.id);
  N.emit(out, 'rejected', { text: `We could not approve your application. Reason: ${list.map((r) => DECLINE_APP[r]).join('; ')}. You can apply again after ${C.dayKey(after)}.`, email: { reasons: list.map((r) => DECLINE_APP[r]).join('; '), reapply: C.dateShort(after) } });
  return out;
}
function askInfo(me, a, text) {
  decideGuard(me, a);
  text = C.clean(text, 600);
  if (text.length < 5) C.fail(400, 'Write what you need from them.');
  D.run('UPDATE aff_affiliates SET info_request=?, info_requested_by=?, updated_at=? WHERE id=?', text, me.id, now(), a.id);
  C.audit(me, 'application.info', { affiliate_id: a.id, after: { text } });
  const out = C.byId(a.id);
  N.emit(out, 'info_request', { text: `${me.name} needs more information about your application: ${text}`, email: { manager: me.name, request: text } });
  return out;
}
function escalate(me, a) { decideGuard(me, a); D.run('UPDATE aff_affiliates SET escalated=1 WHERE id=?', a.id); C.audit(me, 'application.escalate', { affiliate_id: a.id }); return C.byId(a.id); }
function setStatus(me, a, status, reason) {
  if (!['approved', 'suspended', 'closed'].includes(status)) C.fail(400, 'Choose active, paused or closed.');
  if (status !== 'approved' && C.clean(reason, 300).length < 3) C.fail(400, 'Add a reason. It is logged.');
  if (a.user_id === me.id) C.fail(403, 'You cannot change your own affiliate account.');
  if (status === 'approved' && !a.approved_at) C.fail(409, 'Approve the application first.');
  D.run('UPDATE aff_affiliates SET status=?, pause_reason=?, closed_at=?, updated_at=? WHERE id=?', status, C.clean(reason, 300), status === 'closed' ? now() : null, now(), a.id);
  C.audit(me, 'affiliate.status', { affiliate_id: a.id, before: { status: a.status }, after: { status, reason } });
  const out = C.byId(a.id);
  if (status === 'suspended') N.emit(out, 'account_paused', { text: 'Your affiliate account is paused while we review recent activity. Earnings are held. Your manager will contact you within 2 business days.' });
  return out;
}

/* ------------------------------------------------------------------ managers */
function managers({ kind } = {}) {
  return D.all(`SELECT m.*, u.name, u.avatar, u.email, u.perms FROM aff_managers m JOIN users u ON u.id=m.user_id WHERE m.active=1 ORDER BY u.name`)
    .map((m) => ({ ...m, kinds: C.json(m.kinds, []), languages: C.json(m.languages, []), countries: C.json(m.countries, []) }))
    .filter((m) => !kind || m.kinds.includes(kind));
}
const loadOf = (uid, col) => D.get(`SELECT COUNT(*) n FROM aff_affiliates WHERE ${col}=? AND status IN ('pending','approved','suspended')`, uid).n;
/** Every affiliate gets a general manager: same country first, then least loaded (round robin on ties). */
function assignGeneral(a) {
  if (a.general_manager_id) return a.general_manager_id;
  const list = managers({ kind: 'general' });
  if (!list.length) return null;
  const cap = C.settings().manager_capacity.general;
  const score = (m) => (m.countries.includes(a.country) ? 0 : 1) * 1e6 + loadOf(m.user_id, 'general_manager_id') * 10 + (m.rr_at ? 1 : 0);
  const ok = list.filter((m) => loadOf(m.user_id, 'general_manager_id') < (m.capacity || cap));
  const pick = (ok.length ? ok : list).sort((x, y) => score(x) - score(y) || (x.rr_at || 0) - (y.rr_at || 0))[0];
  D.run('UPDATE aff_managers SET rr_at=? WHERE user_id=?', now(), pick.user_id);
  return pick.user_id;
}
function setManagers(me, a, { general_manager_id, private_manager_id }) {
  const isMgr = (id, kind) => id === null || !!managers({ kind }).find((m) => m.user_id === id);
  const g = general_manager_id === undefined ? a.general_manager_id : general_manager_id === null || general_manager_id === '' ? null : Number(general_manager_id);
  const p = private_manager_id === undefined ? a.private_manager_id : private_manager_id === null || private_manager_id === '' ? null : Number(private_manager_id);
  if (!isMgr(g, 'general')) C.fail(400, 'Choose a general manager from the team.');
  if (!g) C.fail(400, 'Every affiliate has exactly one general manager.');
  if (p !== null && !isMgr(p, 'private')) C.fail(400, 'Choose a private manager from the team.');
  if (g === me.id && a.general_manager_id !== me.id && !roles(me).admin) C.fail(403, 'Managers cannot assign themselves.');
  if (a.user_id === g || a.user_id === p) C.fail(400, 'An affiliate cannot manage their own account.');
  D.run('UPDATE aff_affiliates SET general_manager_id=?, private_manager_id=?, updated_at=? WHERE id=?', g, p, now(), a.id);
  C.audit(me, 'affiliate.managers', { affiliate_id: a.id, before: { g: a.general_manager_id, p: a.private_manager_id }, after: { g, p } });
  const out = C.byId(a.id);
  if (g !== a.general_manager_id || p !== a.private_manager_id) N.inApp(out, 'announcement', `Your manager${p ? 's are' : ' is'} ${[g, p].filter(Boolean).map((id) => D.get('SELECT name FROM users WHERE id=?', id).name).join(' and ')}.`);
  return out;
}
/** Private manager suggestions: approved affiliates at Elite+ for a full calendar month without one. */
function privateSuggestions(at = now()) {
  const min = C.settings().private_manager_min_tier;
  return D.all("SELECT * FROM aff_affiliates WHERE status='approved' AND private_manager_id IS NULL").map(C.hydrate)
    .filter((a) => C.effectiveTier(a, at) >= min && D.get('SELECT 1 FROM aff_tier_history WHERE affiliate_id=? AND to_tier>=? AND at<? LIMIT 1', a.id, min, C.monthStartOf(C.addMonths(C.monthKey(at), -1)))).map((a) => a.id);
}
function managerView(m, at = now()) {
  const general = loadOf(m.user_id, 'general_manager_id'); const priv = loadOf(m.user_id, 'private_manager_id');
  const [ms] = C.monthRange(C.monthKey(at));
  const approvals = D.get("SELECT COUNT(*) n FROM aff_audit WHERE actor_id=? AND action='application.approve' AND created_at>=?", m.user_id, ms).n;
  const reviews = D.get('SELECT COUNT(*) n FROM aff_cpa_reviews WHERE reviewer_id=? AND decided_at>?', m.user_id, at - 7 * DAY).n;
  const rev = D.get(`SELECT COALESCE(SUM(v.amount_cents),0) s FROM aff_conversions v JOIN aff_affiliates a ON a.id=v.affiliate_id WHERE (a.general_manager_id=? OR a.private_manager_id=?) AND v.event_type IN ('first_payment','repeat_payment') AND v.occurred_at>=?`, m.user_id, m.user_id, ms).s;
  const cap = C.settings().manager_capacity;
  return { user_id: m.user_id, name: m.name, avatar: C.json(m.avatar, {}), kinds: m.kinds, languages: m.languages, countries: m.countries, hours: m.hours, telegram: m.telegram,
    load: { general, private: priv, target: m.capacity || (m.kinds.includes('private') && !m.kinds.includes('general') ? cap.private : cap.general) }, approvals_mtd: approvals, cpa_reviews_7d: reviews, partner_revenue_mtd_cents: rev };
}

/* ------------------------------------------------------------------ deals and changes */
/** Create a per-affiliate deal (admin). Within limits; above them the owner must approve. */
function createDeal(me, a, b, { fromRequest = null } = {}) {
  const r = roles(me);
  const p = C.product(String(b.product_key || ''));
  if (!p || !p.commissionable) C.fail(400, 'Choose a commissionable product.');
  const model = ['cpa', 'hybrid'].includes(b.model) ? b.model : 'cpa';
  const cpa = C.parseUsd(b.cpa_usd !== undefined ? b.cpa_usd : b.cpa_cents !== undefined ? b.cpa_cents / 100 : undefined);
  if (cpa === null || cpa <= 0) C.fail(400, 'Set the CPA amount.');
  const rate = model === 'hybrid' ? C.parsePct(b.rate_pct !== undefined ? b.rate_pct : b.rate_bp !== undefined ? b.rate_bp / 100 : undefined) : 0;
  if (model === 'hybrid' && !rate) C.fail(400, 'Set the Hybrid RevShare percentage.');
  if (rate > C.capMaxFor(p.key)) C.fail(400, `RevShare on ${p.name} can never be above ${C.capMaxFor(p.key) / 100}% (hard cap, owner rule).`);
  const max = C.settings().cpa.max_cents;
  const over = cpa > max || rate > p.cap_bp;
  if (over && !r.owner) C.fail(403, `Over the program limits (CPA up to ${C.fmtUsd(max)}, RevShare up to the product cap of ${p.cap_bp / 100}%). The owner has to approve this deal.`, { needs_owner: true });
  const t = now();
  const id = D.insert('aff_deals', { affiliate_id: a.id, product_key: p.key, plan: C.clean(b.plan, 60), model, cpa_cents: cpa, rate_bp: rate || 0, monthly_cap: Math.max(1, Math.floor(Number(b.monthly_cap) || 50)),
    traffic: JSON.stringify((Array.isArray(b.traffic) ? b.traffic : []).map((x) => C.clean(x, 40)).slice(0, 10)), geos: JSON.stringify(countries(b.geos, 30)),
    starts_at: t, ends_at: b.ends_at ? Date.parse(b.ends_at) || 0 : 0, status: 'active', created_by: me.id, approved_by: me.id, created_at: t, updated_at: t }).id;
  if (!a.cpa_started_at) D.run('UPDATE aff_affiliates SET cpa_started_at=? WHERE id=?', t, a.id);
  D.insert('aff_offer_changes', { scope: 'affiliate', affiliate_id: a.id, deal_id: id, product_key: p.key, field: model, old_value: '', new_value: C.fmtUsd(cpa) + (rate ? ` + ${rate / 100}%` : ''), direction: 'new', announced_at: t, effective_at: t, applied_at: t, created_by: me.id, note: fromRequest ? `Request #${fromRequest}` : '' });
  C.audit(me, 'deal.create', { affiliate_id: a.id, after: { product: p.key, model, cpa, rate } });
  N.emit(a, 'deal_change', { text: `${p.name}${b.plan ? ' ' + C.clean(b.plan, 60) : ''} ${model === 'hybrid' ? 'Hybrid' : 'CPA'} is now ${C.fmtUsd(cpa)}${rate ? ` + ${rate / 100}%` : ''} for your account, from today.` });
  return D.get('SELECT * FROM aff_deals WHERE id=?', id);
}
/** Change a deal's CPA. Increases apply now; reductions are scheduled at least 7 days out (one affiliate). */
function changeDeal(me, deal, b, at = now()) {
  const a = C.byId(deal.affiliate_id);
  if (b.status === 'paused' || b.status === 'active' || b.status === 'ended') {
    if (b.status === 'paused' && C.clean(b.reason, 300).length < 3) C.fail(400, 'Add a reason for pausing (fraud review pauses are immediate and logged).');
    D.run('UPDATE aff_deals SET status=?, pause_reason=?, updated_at=? WHERE id=?', b.status, C.clean(b.reason, 300), now(), deal.id);
    C.audit(me, 'deal.' + b.status, { affiliate_id: deal.affiliate_id, target: `deal #${deal.id}`, after: { reason: b.reason } });
  }
  const p = C.product(deal.product_key);
  if (b.monthly_cap !== undefined) D.run('UPDATE aff_deals SET monthly_cap=?, updated_at=? WHERE id=?', Math.max(1, Math.floor(Number(b.monthly_cap) || 1)), now(), deal.id);
  const cpa = b.cpa_usd !== undefined ? C.parseUsd(b.cpa_usd) : null;
  if (cpa !== null && cpa !== deal.cpa_cents) {
    if (cpa > C.settings().cpa.max_cents && !roles(me).owner) C.fail(403, 'Over the $300 program limit. The owner has to approve it.', { needs_owner: true });
    if (cpa > deal.cpa_cents) {
      D.run('UPDATE aff_deals SET cpa_cents=?, updated_at=? WHERE id=?', cpa, now(), deal.id);
      D.insert('aff_offer_changes', { scope: 'affiliate', affiliate_id: deal.affiliate_id, deal_id: deal.id, product_key: deal.product_key, field: 'cpa', old_value: String(deal.cpa_cents), new_value: String(cpa), direction: 'increase', announced_at: at, effective_at: at, applied_at: at, created_by: me.id });
      N.emit(a, 'deal_change', { text: `${p.name} CPA is now ${C.fmtUsd(cpa)} for your account, from today.` });
    } else {
      const min = at + C.settings().notice_days.cpa_affiliate * DAY;
      const eff = Math.max(min, b.effective_at ? Date.parse(b.effective_at) || 0 : 0);
      D.insert('aff_offer_changes', { scope: 'affiliate', affiliate_id: deal.affiliate_id, deal_id: deal.id, product_key: deal.product_key, field: 'cpa', old_value: String(deal.cpa_cents), new_value: String(cpa), direction: 'reduction', announced_at: at, effective_at: eff, created_by: me.id });
      N.emit(a, 'deal_change', { text: `From ${C.dayKey(eff)}, ${p.name} CPA changes from ${C.fmtUsd(deal.cpa_cents)} to ${C.fmtUsd(cpa)}. Customers who qualify before then keep ${C.fmtUsd(deal.cpa_cents)}.` });
    }
    C.audit(me, 'deal.cpa_change', { affiliate_id: deal.affiliate_id, target: `deal #${deal.id}`, before: { cpa: deal.cpa_cents }, after: { cpa } });
  }
  return D.get('SELECT * FROM aff_deals WHERE id=?', deal.id);
}
/** Program-wide default CPA change for a product: increases now, reductions at least 14 days out. Also applies to deals at the default amount. */
function scheduleProgramCpa(me, productKey, cpa, effectiveAt, at = now()) {
  const p = C.product(productKey);
  if (!p) C.fail(400, 'Unknown product.');
  if (cpa === null || cpa < 0) C.fail(400, 'Set the new CPA.');
  if (cpa > C.settings().cpa.max_cents && !roles(me).owner) C.fail(403, 'Over the $300 program limit. The owner has to approve it.', { needs_owner: true });
  const old = p.cpa_cents || 0;
  const reduction = cpa < old;
  const eff = reduction ? Math.max(at + C.settings().notice_days.cpa_program * DAY, effectiveAt ? Date.parse(effectiveAt) || 0 : 0) : at;
  const id = D.insert('aff_offer_changes', { scope: 'program', product_key: p.key, field: 'cpa', old_value: String(old), new_value: String(cpa), direction: reduction ? 'reduction' : 'increase', announced_at: at, effective_at: eff, created_by: me.id }).id;
  C.audit(me, 'offer.cpa_schedule', { target: p.key, before: { cpa: old }, after: { cpa, effective_at: eff } });
  if (!reduction) applyChange(D.get('SELECT * FROM aff_offer_changes WHERE id=?', id), at);
  const text = reduction ? `From ${C.dayKey(eff)}, ${p.name} CPA changes from ${C.fmtUsd(old)} to ${C.fmtUsd(cpa)}. Customers who qualify before then keep ${C.fmtUsd(old)}.` : `${p.name} CPA is now ${C.fmtUsd(cpa)}, from today.`;
  for (const a of D.all("SELECT DISTINCT a.* FROM aff_affiliates a JOIN aff_deals d ON d.affiliate_id=a.id WHERE d.product_key=? AND d.status='active'", p.key).map(C.hydrate)) N.emit(a, 'deal_change', { text });
  return D.get('SELECT * FROM aff_offer_changes WHERE id=?', id);
}
function applyChange(ch, at = now()) {
  if (ch.applied_at) return;
  if (ch.scope === 'affiliate' && ch.deal_id && ch.field === 'cpa') D.run('UPDATE aff_deals SET cpa_cents=?, updated_at=? WHERE id=?', Number(ch.new_value), at, ch.deal_id);
  if (ch.scope === 'program' && ch.field === 'cpa') {
    setProduct(ch.product_key, { cpa_cents: Number(ch.new_value) });
    D.run("UPDATE aff_deals SET cpa_cents=?, updated_at=? WHERE product_key=? AND cpa_cents=? AND status='active' AND model IN ('cpa','hybrid')", Number(ch.new_value), at, ch.product_key, Number(ch.old_value));
  }
  // Rate history (money audit MN-1): a scheduled cap or tier-rate change counts from its effective date.
  const eff = ch.effective_at || at;
  if (ch.scope === 'program' && ch.field === 'cap') setProduct(ch.product_key, { cap_bp: Number(ch.new_value) }, eff, ch.created_by);
  if (ch.scope === 'program' && ch.field === 'settings') {
    const v = C.json(ch.new_value, null);
    if (v) { const before = C.settings().tiers; D.setSetting('aff', C.merge(D.getSetting('aff', {}) || {}, v)); C.logRateChange('tiers', '', before, C.settings().tiers, eff, ch.created_by); }
  }
  D.run('UPDATE aff_offer_changes SET applied_at=? WHERE id=?', at, ch.id);
}
/** Job: apply scheduled changes whose date came, and remind affected affiliates 2 days before. */
function applyDueChanges(at = now()) {
  let n = 0;
  for (const ch of D.all('SELECT * FROM aff_offer_changes WHERE applied_at IS NULL AND effective_at<=?', at)) { applyChange(ch, at); n++; }
  for (const ch of D.all('SELECT * FROM aff_offer_changes WHERE applied_at IS NULL AND reminded_at IS NULL AND effective_at<=?', at + 2 * DAY)) {
    D.run('UPDATE aff_offer_changes SET reminded_at=? WHERE id=?', at, ch.id);
    const p = C.product(ch.product_key);
    const text = `Reminder: from ${C.dayKey(ch.effective_at)}, ${p ? p.name : ch.product_key} ${ch.field === 'cap' ? 'RevShare cap' : 'CPA'} changes.`;
    const list = ch.affiliate_id ? [C.byId(ch.affiliate_id)] : D.all("SELECT DISTINCT a.* FROM aff_affiliates a JOIN aff_deals d ON d.affiliate_id=a.id WHERE d.product_key=? AND d.status='active'", ch.product_key).map(C.hydrate);
    for (const a of list) if (a) N.emit(a, 'deal_change', { text });
  }
  return n;
}
/** Save product rules. A change to the effective RevShare cap (cap or commissionable) is logged with its time (MN-1). */
function setProduct(key, patch, at = now(), by = null) {
  const before = C.capFor(key);
  const all = D.getSetting('aff_products', {}) || {};
  all[key] = { ...(all[key] || {}), ...patch };
  D.setSetting('aff_products', all);
  C.logRateChange('cap', key, before, C.capFor(key), at, by);
}
/** Admin edit of product rules. Cap reductions are scheduled 30 days out; CPA default reductions go through scheduleProgramCpa. */
function updateProduct(me, key, b, at = now()) {
  const p = C.product(key);
  if (!p) C.fail(404, 'Unknown product.');
  if (p.locked) C.fail(400, 'Inner Circle is excluded by program rule and cannot be enabled.');
  const patch = {};
  if (b.commissionable !== undefined) patch.commissionable = !!b.commissionable;
  if (b.qualification !== undefined) { const q = b.qualification === 'second_or_30d' ? 'first' : b.qualification; if (!['first', 'second'].includes(q)) C.fail(400, 'Qualification is "first" (first payment) or "second" (second payment).'); patch.qualification = q; }
  for (const k of ['hold_days', 'cpa_hold_days', 'monthly_cap']) if (b[k] !== undefined) { const v = Math.floor(Number(b[k])); if (!Number.isFinite(v) || v < 0 || v > 365) C.fail(400, `${k} must be 0 to 365.`); patch[k] = v; }
  if (b.hybrid_cpa_usd !== undefined) patch.hybrid_cpa_cents = C.parseUsd(b.hybrid_cpa_usd) || 0;
  if (b.hybrid_rate_pct !== undefined) { const v = C.parsePct(b.hybrid_rate_pct); if (v === null || v > p.cap_bp) C.fail(400, `Hybrid RevShare must be at most the cap (${p.cap_bp / 100}%).`); patch.hybrid_rate_bp = v; }
  let scheduled = null;
  if (b.cap_pct !== undefined) {
    // Hard caps (owner rule): Vooads and Replyvoo at most 35%, every product at most 50%. Not a setting.
    const max = C.capMaxFor(key);
    const v = C.parsePct(b.cap_pct);
    if (v === null || v > max) C.fail(400, `The RevShare cap on ${p.name} is 0% to ${max / 100}%${max < C.HARD_CAP_BP ? ' (AI-heavy tool, hard cap)' : ''}.`, { max_pct: max / 100 });
    if (v > p.cap_bp || !p.commissionable) patch.cap_bp = v;
    else if (v < p.cap_bp) {
      const eff = at + C.settings().notice_days.revshare * DAY;
      scheduled = D.get('SELECT * FROM aff_offer_changes WHERE id=?', D.insert('aff_offer_changes', { scope: 'program', product_key: key, field: 'cap', old_value: String(p.cap_bp), new_value: String(v), direction: 'reduction', announced_at: at, effective_at: eff, created_by: me.id }).id);
    }
  }
  setProduct(key, patch, at, me.id);
  if (b.cpa_usd !== undefined) { const v = C.parseUsd(b.cpa_usd); if (v !== p.cpa_cents) scheduled = scheduleProgramCpa(me, key, v, b.effective_at, at); }
  C.audit(me, 'product.update', { target: key, before: { cap_bp: p.cap_bp, commissionable: p.commissionable }, after: patch });
  return { product: C.product(key), scheduled };
}

/* ------------------------------------------------------------------ custom RevShare deals (owner and program super admins) */
/*
 * Owner decision 2026-10-05: "I can create custom deal and increase rev share to even 90%. But of course this is only for
 * special deals. Not talked about anywhere except in the dashboard." One affiliate, one product or all products ('*'),
 * up to 90%. Above 50% the deal is a "Special deal" and overrides the product caps (35% Vooads/Replyvoo, 50% others) for
 * that deal only; up to 50% the normal caps apply. Window: forever, until a date, or from a date to a date. Rates apply
 * to payments dated inside the window only (forward from creation), then the tier rate and cap apply again. Visible to
 * that affiliate and to staff only (never on the public site, public API or public docs).
 * Owner update 2026-10-05 ("yes"): program super admins (the `aff_admin` role) may create and change these deals too.
 * Managers, finance and fraud check may not (403). The Special-deal confirm step and the audit log apply to everyone.
 */
const SPECIAL_MAX_BP = 9000;
const AI_WARNING = 'AI tools cost more — this deal may lose money.';
/** 'YYYY-MM-DD' → the start of that day in the reporting time zone (Africa/Lagos); a number is taken as ms. */
function dayStartOf(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim());
  if (!m) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return C.dayStartAt(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
}
const fmtDay = (t) => C.dayKey(t);
function rsWindowText(d) {
  if (!d.ends_at) return d.starts_at > now() ? `from ${fmtDay(d.starts_at)}, no end date` : 'no end date';
  return d.starts_at > now() ? `from ${fmtDay(d.starts_at)} to ${fmtDay(d.ends_at - 1)}` : `until ${fmtDay(d.ends_at - 1)}`;
}
const rsProductName = (key) => (key === '*' ? 'all products' : (C.product(key) || { name: key }).name);
function rsWarning(key, rate) {
  if (rate <= C.HARD_CAP_BP) return '';
  return key === '*' || C.AI_CAPPED.includes(key) ? AI_WARNING : '';
}
/** Create a custom RevShare deal. b: { product_key ('*' or 'all' = every product), rate_pct, duration: forever|until|range, starts_at, ends_at, confirm, note }. */
function createRevshareDeal(me, a, b, at = now()) {
  if (!roles(me).admin) C.fail(403, 'Only the owner or a program super admin can create a custom RevShare deal.');
  if (a.user_id === me.id) C.fail(403, 'You cannot give your own affiliate account a deal.');
  if (a.status !== 'approved') C.fail(409, 'Custom deals are for approved affiliates.');
  let key = String(b.product_key || '').trim().toLowerCase();
  if (key === 'all' || key === '') key = '*';
  let p = null;
  if (key !== '*') { p = C.product(key); if (!p || !p.commissionable || !C.capFor(key)) C.fail(400, 'Choose a commissionable product, or all products.'); }
  const rate = C.parsePct(b.rate_pct !== undefined ? b.rate_pct : b.rate_bp !== undefined ? b.rate_bp / 100 : undefined);
  if (!rate) C.fail(400, 'Set the RevShare percentage.');
  if (rate > SPECIAL_MAX_BP) C.fail(400, `A custom RevShare deal is at most ${SPECIAL_MAX_BP / 100}%.`);
  const special = rate > C.HARD_CAP_BP;
  if (!special && p && rate > C.capMaxFor(key)) C.fail(400, `Up to 50% a deal keeps the normal caps: ${p.name} is at most ${C.capMaxFor(key) / 100}%. Only a Special deal (above 50%) overrides it.`);
  const warning = rsWarning(key, rate);
  if (special && b.confirm !== true) C.fail(409, `This is a Special deal (${rate / 100}%, above 50%). Confirm to create it.${warning ? ' ' + warning : ''}`, { needs_confirm: true, special: true, warning });
  const duration = ['forever', 'until', 'range'].includes(b.duration) ? b.duration : 'forever';
  let starts = at; let ends = 0;
  if (duration === 'until' || duration === 'range') {
    const e = dayStartOf(b.ends_at);
    if (!e) C.fail(400, 'Choose the end date.');
    ends = typeof b.ends_at === 'number' ? e : e + C.DAY; // a date is inclusive: the deal runs to the end of that day
    if (duration === 'range') { const st = dayStartOf(b.starts_at); if (!st) C.fail(400, 'Choose the start date.'); starts = Math.max(at, st); }
    if (ends <= starts) C.fail(400, 'The end date must be after the start date (and in the future).');
  }
  const id = D.insert('aff_deals', { affiliate_id: a.id, product_key: key, plan: '', model: 'revshare', cpa_cents: 0, rate_bp: rate, monthly_cap: 0, traffic: '[]', geos: '[]',
    starts_at: starts, ends_at: ends, status: 'active', special: special ? 1 : 0, duration, created_by: me.id, approved_by: me.id, created_at: at, updated_at: at }).id;
  D.insert('aff_offer_changes', { scope: 'affiliate', affiliate_id: a.id, deal_id: id, product_key: key, field: 'revshare', old_value: '', new_value: `${rate / 100}%`, direction: 'new', announced_at: at, effective_at: starts, applied_at: at, created_by: me.id, note: special ? 'Special deal' : 'Custom deal' });
  C.audit(me, 'deal.revshare_create', { affiliate_id: a.id, target: `deal #${id}`, after: { product: key, rate_bp: rate, special, duration, starts_at: starts, ends_at: ends, warning, note: C.clean(b.note, 300) } });
  revshareJobs(at);
  return D.get('SELECT * FROM aff_deals WHERE id=?', id);
}
/** Owner or program super admin: end a custom deal now, or move its end date (forward-only: payments already made keep their rate). */
function changeRevshareDeal(me, deal, b, at = now()) {
  if (!roles(me).admin) C.fail(403, 'Only the owner or a program super admin can change a custom RevShare deal.');
  const a = C.byId(deal.affiliate_id);
  const before = { status: deal.status, ends_at: deal.ends_at };
  if (b.status === 'ended') {
    D.run("UPDATE aff_deals SET status='ended', ends_at=CASE WHEN ends_at=0 OR ends_at>? THEN ? ELSE ends_at END, updated_at=? WHERE id=?", at, at, at, deal.id);
    if (a) N.emit(a, 'special_deal', { text: `Your ${deal.special ? 'Special deal' : 'custom deal'} (${deal.rate_bp / 100}% on ${rsProductName(deal.product_key)}) has ended. New payments earn your normal tier rate.`, email: { title: 'Your custom deal has ended', body: `Your ${deal.special ? 'Special deal' : 'custom deal'} of ${deal.rate_bp / 100}% on ${rsProductName(deal.product_key)} has ended. Payments from now on earn your normal tier rate. Earnings already made keep their rate.` } });
  } else if (b.ends_at !== undefined || b.duration === 'forever') {
    let ends = 0;
    if (b.duration !== 'forever') { const e = dayStartOf(b.ends_at); if (!e) C.fail(400, 'Choose the end date.'); ends = typeof b.ends_at === 'number' ? e : e + C.DAY; if (ends <= Math.max(at, deal.starts_at || 0)) C.fail(400, 'The new end date must be in the future (rates apply going forward only).'); }
    D.run('UPDATE aff_deals SET ends_at=?, duration=?, end_notified_at=NULL, updated_at=? WHERE id=?', ends, ends ? (deal.duration === 'range' ? 'range' : 'until') : 'forever', at, deal.id);
    if (a) N.emit(a, 'special_deal', { text: `Your ${deal.special ? 'Special deal' : 'custom deal'} (${deal.rate_bp / 100}% on ${rsProductName(deal.product_key)}) now runs ${ends ? 'until ' + fmtDay(ends - 1) : 'with no end date'}.` });
  } else C.fail(400, 'Nothing to change. Send status "ended" or a new end date.');
  C.audit(me, 'deal.revshare_change', { affiliate_id: deal.affiliate_id, target: `deal #${deal.id}`, before, after: D.get('SELECT status, ends_at FROM aff_deals WHERE id=?', deal.id) });
  return D.get('SELECT * FROM aff_deals WHERE id=?', deal.id);
}
/** Job: tell the affiliate when a custom deal starts and 7 days before it ends; mark ended deals. Idempotent. */
function revshareJobs(at = now()) {
  let n = 0;
  for (const d of D.all("SELECT * FROM aff_deals WHERE model='revshare' AND status='active' AND start_notified_at IS NULL AND COALESCE(starts_at,0)<=? AND (ends_at=0 OR ends_at>?)", at, at)) {
    if (!D.run('UPDATE aff_deals SET start_notified_at=? WHERE id=? AND start_notified_at IS NULL', at, d.id).changes) continue;
    const a = C.byId(d.affiliate_id); if (!a) continue;
    const tag = d.special ? 'Special deal' : 'Custom deal';
    N.emit(a, 'special_deal', { text: `${tag}: ${d.rate_bp / 100}% RevShare on ${rsProductName(d.product_key)}, ${rsWindowText(d)}. It applies to payments from today.`,
      email: { title: `${tag}: ${d.rate_bp / 100}% RevShare`, body: `You have a ${tag.toLowerCase()} of ${d.rate_bp / 100}% RevShare on ${rsProductName(d.product_key)}, ${rsWindowText(d)}. It applies to your customers' payments from today. You can see it on your Offers page.` } });
    n++;
  }
  for (const d of D.all("SELECT * FROM aff_deals WHERE model='revshare' AND status='active' AND end_notified_at IS NULL AND ends_at>? AND ends_at<=? AND COALESCE(starts_at,0)<=?", at, at + 7 * C.DAY, at)) {
    if (!D.run('UPDATE aff_deals SET end_notified_at=? WHERE id=? AND end_notified_at IS NULL', at, d.id).changes) continue;
    const a = C.byId(d.affiliate_id); if (!a) continue;
    const days = Math.max(1, Math.ceil((d.ends_at - at) / C.DAY));
    const tag = d.special ? 'Special deal' : 'Custom deal';
    N.emit(a, 'special_deal', { text: `${tag} ending soon: ${d.rate_bp / 100}% on ${rsProductName(d.product_key)} ends on ${fmtDay(d.ends_at - 1)} (${days} day${days === 1 ? '' : 's'} left). After that, new payments earn your tier rate.`,
      email: { title: `Your ${tag.toLowerCase()} ends in ${days} day${days === 1 ? '' : 's'}`, body: `Your ${tag.toLowerCase()} of ${d.rate_bp / 100}% RevShare on ${rsProductName(d.product_key)} ends on ${fmtDay(d.ends_at - 1)}. After that, new payments earn your normal tier rate. Talk to your manager if you want to discuss it.` } });
    n++;
  }
  D.run("UPDATE aff_deals SET status='ended', updated_at=? WHERE model='revshare' AND status='active' AND ends_at>0 AND ends_at<=?", at, at);
  return n;
}
/** Custom deals an affiliate sees (active or starting later), with the countdown. Only for that affiliate and staff. */
function revshareDealsFor(affId, at = now()) {
  return D.all("SELECT * FROM aff_deals WHERE affiliate_id=? AND model='revshare' AND status='active' AND (ends_at=0 OR ends_at>?) ORDER BY rate_bp DESC, id DESC", affId, at).map((d) => ({
    id: d.id, product_key: d.product_key, all_products: d.product_key === '*', product: rsProductName(d.product_key), rate_bp: d.rate_bp, special: !!d.special || d.rate_bp > C.HARD_CAP_BP,
    label: (d.special || d.rate_bp > C.HARD_CAP_BP) ? `Special deal ${d.rate_bp / 100}%` : `Custom deal ${d.rate_bp / 100}%`,
    duration: d.duration || (d.ends_at ? 'until' : 'forever'), starts_at: d.starts_at, ends_at: d.ends_at || null, live: (d.starts_at || 0) <= at,
    days_left: d.ends_at ? Math.max(0, Math.ceil((d.ends_at - at) / C.DAY)) : null, last_day: d.ends_at ? fmtDay(d.ends_at - 1) : null,
  }));
}

/* ------------------------------------------------------------------ deal requests */
function requestDeal(me, a, b, source = 'manager') {
  const p = C.product(String(b.product_key || ''));
  const model = ['cpa', 'hybrid', 'tier_floor', 'cap_raise'].includes(b.model) ? b.model : 'cpa';
  if (model !== 'tier_floor' && (!p || !p.commissionable)) C.fail(400, 'Choose a commissionable product.');
  const cpa = C.parseUsd(b.cpa_usd) || 0; const rate = C.parsePct(b.rate_pct) || 0;
  if (p && rate > C.capMaxFor(p.key)) C.fail(400, `RevShare on ${p.name} can never be above ${C.capMaxFor(p.key) / 100}% (hard cap, owner rule).`);
  const max = C.settings().cpa.max_cents;
  const needsOwner = cpa > max || (p && rate > p.cap_bp) ? 1 : 0;
  if (source === 'affiliate') {
    if (a.status !== 'approved') C.fail(403, 'Available after approval.');
    if (C.effectiveTier(a) < C.settings().cpa.min_tier && !b.recommended) C.fail(403, `CPA opens at ${C.tierName(C.settings().cpa.min_tier)}, or earlier by manager recommendation.`);
  }
  const id = D.insert('aff_deal_requests', { affiliate_id: a.id, requested_by: me.id, source, product_key: p ? p.key : '', plan: C.clean(b.plan, 60), model, cpa_cents: cpa, rate_bp: rate,
    monthly_cap: Math.max(0, Math.floor(Number(b.monthly_cap) || 0)), tier_floor: b.tier_floor !== undefined ? Math.max(0, Math.min(C.tiers().length - 1, Math.floor(Number(b.tier_floor)))) : null,
    floor_until: b.floor_until ? Date.parse(b.floor_until) || 0 : 0, traffic: JSON.stringify((Array.isArray(b.traffic) ? b.traffic : []).slice(0, 10)), geos: JSON.stringify(countries(b.geos, 20)),
    expected: Math.max(0, Math.floor(Number(b.expected) || 0)), sample_url: safeUrl(b.sample_url, 300), reason: C.clean(b.reason || b.note, 1000), needs_owner: needsOwner, status: 'pending', created_at: now() }).id;
  C.audit(me, 'deal_request.create', { affiliate_id: a.id, after: { id, model, cpa, rate } });
  publish('staff', 'aff', { kind: 'deal_request', id });
  return D.get('SELECT * FROM aff_deal_requests WHERE id=?', id);
}
function decideRequest(me, id, approveIt, note) {
  const rq = D.get('SELECT * FROM aff_deal_requests WHERE id=?', Number(id));
  if (!rq) C.fail(404, 'Request not found.');
  if (rq.status !== 'pending') C.fail(409, `This request is already ${rq.status}.`);
  if (rq.requested_by === me.id && !roles(me).owner) C.fail(403, 'Another admin has to decide your own request.');
  if (approveIt && rq.needs_owner && !roles(me).owner) C.fail(403, 'Over program limits: only the owner can approve this.');
  const a = C.byId(rq.affiliate_id);
  let dealId = null;
  if (approveIt) {
    if (rq.model === 'tier_floor') {
      D.run('UPDATE aff_affiliates SET tier_floor=?, tier_floor_until=? WHERE id=?', rq.tier_floor, rq.floor_until || now() + 90 * DAY, a.id);
      C.audit(me, 'tier.floor', { affiliate_id: a.id, after: { tier: rq.tier_floor, until: rq.floor_until } });
    } else if (rq.model === 'cap_raise') {
      const deal = D.get("SELECT * FROM aff_deals WHERE affiliate_id=? AND product_key=? AND status='active' AND model IN ('cpa','hybrid') ORDER BY id DESC LIMIT 1", a.id, rq.product_key);
      if (deal) { D.run('UPDATE aff_deals SET monthly_cap=? WHERE id=?', rq.monthly_cap || deal.monthly_cap, deal.id); dealId = deal.id; }
    } else {
      const ownerOk = rq.needs_owner ? { ...me, perms: ['*'] } : me;
      dealId = createDeal(ownerOk, a, { product_key: rq.product_key, plan: rq.plan, model: rq.model, cpa_usd: rq.cpa_cents / 100, rate_pct: rq.rate_bp / 100, monthly_cap: rq.monthly_cap || 50, traffic: C.json(rq.traffic, []), geos: C.json(rq.geos, []) }, { fromRequest: rq.id }).id;
    }
  }
  D.run('UPDATE aff_deal_requests SET status=?, decided_by=?, decided_at=?, decision_note=?, deal_id=? WHERE id=?', approveIt ? 'approved' : 'declined', me.id, now(), C.clean(note, 500), dealId, rq.id);
  C.audit(me, 'deal_request.' + (approveIt ? 'approve' : 'decline'), { affiliate_id: a.id, target: `request #${rq.id}`, after: { note } });
  if (rq.source === 'affiliate' && !approveIt) N.emit(a, 'deal_change', { text: `Your ${rq.model.toUpperCase()} request was not approved${note ? ': ' + C.clean(note, 200) : ''}.` });
  return D.get('SELECT * FROM aff_deal_requests WHERE id=?', rq.id);
}

/* ------------------------------------------------------------------ announcements */
function audienceIds(aud) {
  const k = aud && aud.kind;
  const base = "SELECT * FROM aff_affiliates WHERE status IN ('approved','pending','suspended')";
  let list = D.all(base).map(C.hydrate);
  if (k === 'tier') list = list.filter((a) => a.status === 'approved' && C.effectiveTier(a) >= Number(aud.min_tier || 0));
  else if (k === 'manager') list = list.filter((a) => a.general_manager_id === Number(aud.manager_id) || a.private_manager_id === Number(aud.manager_id));
  else if (k === 'product') list = list.filter((a) => D.get('SELECT 1 FROM aff_conversions WHERE affiliate_id=? AND product_key=? LIMIT 1', a.id, String(aud.product)) || ((a.traffic || {}).products || (a.application || {}).products || []).includes(aud.product));
  else if (k === 'geo') list = list.filter((a) => a.country === String(aud.country).toUpperCase() || ((a.traffic || {}).geos || []).includes(String(aud.country).toUpperCase()));
  else if (k === 'affiliate') list = list.filter((a) => a.id === Number(aud.affiliate_id));
  return list;
}
function sendAnnouncement(an, at = now()) {
  if (!D.run('UPDATE aff_announcements SET sent_at=? WHERE id=? AND sent_at IS NULL', at, an.id).changes) return 0;
  const ch = C.json(an.channels, {});
  const list = audienceIds(C.json(an.audience, {}));
  for (const a of list) {
    N.emit(a, 'announcement', { text: `${an.title}. ${an.body}`.trim(), noApp: !ch.dashboard, tg: ch.telegram ? `${an.title}. ${an.body} ${an.link || N.affUrl('home')}` : null });
    if (ch.email) { const u = D.get('SELECT * FROM users WHERE id=?', a.user_id); if (u && !u.banned) require('../mailer').queue(u, 'announcement', { subject: an.title, title: an.title, body: an.body, body_html: C.clean(an.body, 2000).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])), cta_url: an.link || N.affUrl('home'), cta_text: 'Open the dashboard' }); }
  }
  D.run('UPDATE aff_announcements SET recipients=? WHERE id=?', list.length, an.id);
  return list.length;
}
function createAnnouncement(me, b, at = now()) {
  const title = C.clean(b.title, 140);
  if (title.length < 3) C.fail(400, 'Add a title.');
  const kind = ['new_offer', 'cpa_change', 'creatives', 'contest', 'policy', 'maintenance', 'news'].includes(b.kind) ? b.kind : 'news';
  const eff = b.effective_at ? Date.parse(b.effective_at) || null : null;
  if (kind === 'cpa_change' && !eff) C.fail(400, 'A CPA change needs its effective date.');
  const aud = b.audience && typeof b.audience === 'object' ? b.audience : { kind: 'all' };
  if (!['all', 'tier', 'manager', 'product', 'geo', 'affiliate'].includes(aud.kind)) C.fail(400, 'Choose who sees it.');
  const ch = { dashboard: b.channels ? !!b.channels.dashboard : true, email: !!(b.channels && b.channels.email), telegram: !!(b.channels && b.channels.telegram) };
  const sendAt = b.send_at ? Date.parse(b.send_at) || at : at;
  const id = D.insert('aff_announcements', { kind, title, body: C.clean(b.body, 500), link: safeUrl(b.link, 300), audience: JSON.stringify(aud), channels: JSON.stringify(ch), pinned: b.pinned ? 1 : 0,
    effective_at: eff, send_at: sendAt, expires_at: b.expires_at ? Date.parse(b.expires_at) || 0 : 0, created_by: me.id, created_at: at }).id;
  C.audit(me, 'announcement.create', { target: title });
  const an = D.get('SELECT * FROM aff_announcements WHERE id=?', id);
  if (sendAt <= at) sendAnnouncement(an, at);
  return D.get('SELECT * FROM aff_announcements WHERE id=?', id);
}
function announcementsFor(a, at = now(), limit = 10) {
  return D.all('SELECT * FROM aff_announcements WHERE sent_at IS NOT NULL AND send_at<=? AND (expires_at=0 OR expires_at>?) ORDER BY pinned DESC, send_at DESC LIMIT 100', at, at)
    .filter((an) => audienceIds(C.json(an.audience, {})).some((x) => x.id === a.id)).slice(0, limit)
    .map((an) => ({ id: an.id, kind: an.kind, title: an.title, body: an.body, link: an.link, pinned: !!an.pinned, effective_at: an.effective_at, at: an.send_at }));
}

/* ------------------------------------------------------------------ creatives */
function cleanCreative(b, prev = {}) {
  const v = (k, max) => C.clean(b[k] !== undefined ? b[k] : prev[k], max);
  const pk = v('product_key', 40);
  if (pk && !C.product(pk)) C.fail(400, 'Unknown product.');
  const landing = b.landing_url !== undefined ? safeUrl(b.landing_url, 300) : prev.landing_url || '';
  const file = b.file_url !== undefined ? safeUrl(b.file_url, 500) : prev.file_url || '';
  if (b.upload_id) { const u = D.get("SELECT * FROM uploads WHERE id=? AND deleted=0 AND purpose='aff_creative'", String(b.upload_id)); if (!u) C.fail(400, 'That image is no longer available. Upload it again.'); D.run("UPDATE uploads SET attached_to='aff_creative' WHERE id=?", u.id); }
  const out = { title: v('title', 120), product_key: pk, format: v('format', 30), size: v('size', 30), language: v('language', 30) || 'English', platform: v('platform', 30), geo: v('geo', 2).toUpperCase(),
    copy_text: C.clean(b.copy_text !== undefined ? b.copy_text : prev.copy_text, 4000), landing_url: landing, upload_id: b.upload_id !== undefined ? C.clean(b.upload_id, 40) : prev.upload_id || '', file_url: file,
    min_tier: Math.max(0, Math.min(6, Math.floor(Number(b.min_tier !== undefined ? b.min_tier : prev.min_tier) || 0))), public_from: b.public_from !== undefined ? (Date.parse(b.public_from) || Number(b.public_from) || 0) : prev.public_from || 0,
    early_access: b.early_access !== undefined ? (b.early_access ? 1 : 0) : prev.early_access ?? 1, active: b.active !== undefined ? (b.active ? 1 : 0) : prev.active ?? 1 };
  if (!out.title) C.fail(400, 'Give the creative a title.');
  if (!out.upload_id && !out.file_url && !out.copy_text) C.fail(400, 'Add an image, a file link or copy text.');
  return out;
}
/** Early access: Pro sees new creatives 48 hours before the public date, Elite and up 7 days before. */
function creativeVisibleAt(cr, tier) { const early = cr.early_access ? (tier >= 2 ? 7 * DAY : tier >= 1 ? 2 * DAY : 0) : 0; return (cr.public_from || 0) - early; }
function creativesFor(a, q = {}, at = now()) {
  const tier = C.effectiveTier(a, at);
  const T = require('./tracking');
  const up = require('../uploads');
  const rows = D.all('SELECT * FROM aff_creatives WHERE active=1 ORDER BY COALESCE(public_from, created_at) DESC, id DESC LIMIT 500').filter((cr) => tier >= cr.min_tier && creativeVisibleAt(cr, tier) <= at)
    .filter((cr) => C.inProgram(cr.product_key) && (!q.product || cr.product_key === q.product) && (!q.format || cr.format === q.format) && (!q.language || cr.language === q.language) && (!q.geo || cr.geo === q.geo || !cr.geo));
  const imgs = up.lookup(rows.map((r) => r.upload_id));
  return rows.map((cr) => {
    const link = T.trackingUrl(a, { product: cr.product_key, subs: { sub1: `cr_${cr.id}` }, deep: cr.landing_url && T.deepLinkOk(cr.landing_url) ? cr.landing_url : '' });
    return { id: cr.id, title: cr.title, product_key: cr.product_key, format: cr.format, size: cr.size, language: cr.language, platform: cr.platform, geo: cr.geo, image: imgs[cr.upload_id] || null, file_url: cr.file_url,
      copy_text: cr.copy_text.replace(/\{your_link\}/g, link), link, is_new: at - (cr.public_from || cr.created_at) < 7 * DAY, early_access: (cr.public_from || 0) > at, public_from: cr.public_from };
  });
}

/* ------------------------------------------------------------------ settings */
/** Validate and save program settings. Changes that reduce affiliates' rights (lower rates, higher thresholds) wait 30 days. */
function updateSettings(me, b, at = now()) {
  const cur = C.settings();
  const next = C.merge(cur, b || {});
  // Shape checks.
  if (!Array.isArray(next.tiers) || next.tiers.length < 1 || next.tiers.length > 10) C.fail(400, 'Tiers must be a list of 1 to 10.');
  next.tiers = next.tiers.map((t, i) => ({ name: C.clean(t.name, 30) || `Tier ${i + 1}`, min: Math.max(0, Math.floor(Number(t.min) || 0)), rate_bp: Math.max(0, Math.min(5000, Math.round(Number(t.rate_bp) || 0))), multiplier_bp: Math.max(10000, Math.min(20000, Math.round(Number(t.multiplier_bp) || 10000))), sla_days: Math.max(1, Math.min(10, Math.floor(Number(t.sla_days) || 3))), approval: !!t.approval }));
  for (let i = 1; i < next.tiers.length; i++) if (next.tiers[i].min < next.tiers[i - 1].min) C.fail(400, 'Tier thresholds must go up.');
  next.attribution_days = Math.max(1, Math.min(365, Math.floor(Number(next.attribution_days) || 60)));
  next.activation_customers = Math.max(0, Math.min(1000, Math.floor(Number(next.activation_customers))));
  next.health.threshold = Math.max(0, Math.min(100000, Math.floor(Number(next.health.threshold))));
  // Holds (owner update 2026-10-05: 0 by default, earnings are instant). A hold applies to earnings created after it is saved.
  delete next.holds.revshare_days;
  for (const k of ['spend_days', 'order_days', 'card_order_days', 'cpa_days', 'cpa_long_days', 'cpa_new_days', 'review_extend_days']) {
    const v = Math.floor(Number(next.holds[k]));
    if (!Number.isFinite(v) || v < 0 || v > 120) C.fail(400, 'Hold days must be 0 to 120.');
    next.holds[k] = v;
  }
  next.holds.cpa_long_cents = Math.max(0, Math.round(Number(next.holds.cpa_long_cents) || 0));
  next.qualification = { rule: 'first_payment' };
  // Terms version: 'v1.1' style, never below the version the code ships (raising it makes every affiliate accept again).
  next.terms_version = String(next.terms_version || '').trim();
  if (!/^v\d+(\.\d+){0,2}$/i.test(next.terms_version)) C.fail(400, 'Terms version looks like v1.1.');
  if (C.cmpVersion(next.terms_version, C.TERMS.version) < 0) C.fail(400, `The terms version cannot be lower than ${C.TERMS.version} (the version of the published terms).`);
  next.payouts.four_eyes_cents = Math.max(0, Math.round(Number(next.payouts.four_eyes_cents) || 0));
  next.adjustments.four_eyes_cents = Math.max(0, Math.min(10_000_000, Math.round(Number(next.adjustments.four_eyes_cents) || 0)));
  next.adjustments.dup_window_sec = Math.max(10, Math.min(3600, Math.floor(Number(next.adjustments.dup_window_sec) || 60)));
  for (const m of Object.keys(next.payouts.methods)) next.payouts.methods[m].min_cents = Math.max(0, Math.round(Number(next.payouts.methods[m].min_cents) || 0));
  if (!['off', 'first_payout', 'threshold', 'always'].includes(next.kyc.required)) C.fail(400, 'KYC rule must be off, first_payout, threshold or always.');
  for (const prov of [next.kyc.provider, next.payouts.provider]) {
    if (!['manual', 'http'].includes(prov.kind)) C.fail(400, 'Provider kind is manual or http.');
    if (prov.kind === 'http') { const p = require('../netguard').urlProblem(prov.api_base); if (p) C.fail(400, 'The provider address ' + p + '.'); }
  }
  // Reductions wait the notice period.
  const unfavourable = {};
  cur.tiers.forEach((t, i) => { const n = next.tiers[i]; if (n && (n.rate_bp < t.rate_bp || n.min > t.min)) unfavourable.tiers = next.tiers; });
  if (next.health.threshold > cur.health.threshold) unfavourable.health = { threshold: next.health.threshold };
  let scheduled = null;
  const apply = { ...next };
  if (Object.keys(unfavourable).length) {
    if (unfavourable.tiers) apply.tiers = cur.tiers;
    if (unfavourable.health) apply.health = { ...next.health, threshold: cur.health.threshold };
    const eff = at + C.settings().notice_days.revshare * DAY;
    scheduled = D.get('SELECT * FROM aff_offer_changes WHERE id=?', D.insert('aff_offer_changes', { scope: 'program', field: 'settings', old_value: JSON.stringify({ tiers: cur.tiers, health: { threshold: cur.health.threshold } }), new_value: JSON.stringify(unfavourable), direction: 'reduction', announced_at: at, effective_at: eff, created_by: me.id }).id);
  }
  D.setSetting('aff', apply);
  // Tier rates that change now (favourable changes) are logged: payments dated before keep the old rate (MN-1).
  C.logRateChange('tiers', '', cur.tiers, C.settings().tiers, at, me.id);
  C.audit(me, 'settings.update', { before: cur, after: apply });
  return { settings: C.settings(), scheduled };
}
/** Settings with secrets hidden (admin view). */
function publicSettings() {
  const s = JSON.parse(JSON.stringify(C.settings()));
  for (const prov of [s.kyc.provider, s.payouts.provider]) { prov.api_key_set = !!prov.api_key; prov.webhook_secret_set = !!prov.webhook_secret; delete prov.api_key; delete prov.webhook_secret; }
  return s;
}

/* ------------------------------------------------------------------ API keys */
function newApiKey(a) {
  if (C.effectiveTier(a) < C.settings().stats_api_min_tier) C.fail(403, `The stats API opens at ${C.tierName(C.settings().stats_api_min_tier)}.`);
  const key = 'vsa_' + rid(24).replace(/[^A-Za-z0-9]/g, '');
  D.run('UPDATE aff_affiliates SET api_key_hash=?, api_key_prefix=?, updated_at=? WHERE id=?', C.keyed('apikey|' + key), key.slice(0, 8), now(), a.id);
  C.audit(a.user_id, 'api_key.create', { affiliate_id: a.id });
  return key;
}
function byApiKey(key) { return key && key.startsWith('vsa_') ? C.hydrate(D.get('SELECT * FROM aff_affiliates WHERE api_key_hash=?', C.keyed('apikey|' + key))) : null; }

module.exports = {
  DECLINE_APP, SOURCES, VOLUMES, roles, canSee, scopeSql, ensure, saveStep, appChecks, approve, reject, askInfo, escalate, setStatus, managers, assignGeneral, setManagers,
  privateSuggestions, managerView, createDeal, changeDeal, createRevshareDeal, changeRevshareDeal, revshareJobs, revshareDealsFor, SPECIAL_MAX_BP, AI_WARNING, scheduleProgramCpa, applyChange, applyDueChanges, setProduct, updateProduct, requestDeal, decideRequest,
  audienceIds, sendAnnouncement, createAnnouncement, announcementsFor, cleanCreative, creativesFor, creativeVisibleAt, updateSettings, publicSettings, newApiKey, byApiKey, config,
};
