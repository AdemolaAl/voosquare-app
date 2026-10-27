'use strict';
/* Referral earnings and payouts: member API (/api/me/...) and admin API (/api/admin/payouts...). Logic in src/referrals.js. */
const config = require('../config');
const D = require('../db');
const A = require('../auth');
const mailer = require('../mailer');
const REF = require('../referrals');
const REV = require('../revenue');
const { now, fail, clean, json, limit, publish, esc } = require('../util');

const audit = (u, action, detail = '') => D.insert('audit', { user_id: u.id, action, detail: String(detail).slice(0, 500), created_at: now() });
const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateTxt = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: REV.reportingTz() });
const noteHtml = (label, note) => (note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 8px;"><tr><td class="dm-panel" bgcolor="#F3F6F4" style="background:#F3F6F4;border:1px solid #E3EAE6;border-radius:18px;padding:18px 22px;font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#33413A;"><b class="dm-ink" style="color:#0A1611;">${esc(label)}</b><br><span class="dm-body" style="color:#33413A;">${esc(note).replace(/\n/g, '<br>')}</span></td></tr></table>` : '');

function emailVars(p) {
  const v = REF.payoutView(p);
  return {
    amount: money(p.amount_usd), method: v.method ? `${v.method.label} · ${v.method.summary}` : '', reference: p.reference || '',
    note: p.note || '', date: dateTxt(p.paid_at || p.decided_at || p.requested_at), requested: dateTxt(p.requested_at), payout_id: String(p.id),
    referrals_url: `${config.baseUrl}/app#referrals`,
  };
}
function notifyMember(p, template, extra = {}) {
  const user = D.get('SELECT * FROM users WHERE id=?', p.user_id);
  if (user && !user.banned) mailer.queue(user, template, { ...emailVars(p), ...extra });
  publish('user:' + p.user_id, 'payout', { id: p.id, status: p.status, amount_usd: p.amount_usd });
}
const staffPing = (p) => publish('staff', 'payout', { id: p.id, status: p.status });

/** Finance (payments) staff and owners. Everyone else gets a 403. */
const requirePayouts = (ctx) => A.requirePerm(ctx, 'payments');

/** Admin row: the member, the request and the full payout details (finance needs them to pay). */
function adminRow(p, me) {
  const reveal = A.can(me, 'customers');
  return {
    ...REF.payoutView(p, { reveal: true }),
    member: { id: p.user_id, name: p.name || '', avatar: json(p.avatar, {}), email: reveal ? p.email : REV.maskEmail(p.email), voo_id: p.voo_id },
    decided_by: p.decided_name || null,
  };
}
const ROW_SQL = 'SELECT p.*, u.name, u.email, u.avatar, u.voo_id, d.name decided_name FROM payouts p JOIN users u ON u.id=p.user_id LEFT JOIN users d ON d.id=p.decided_by';

function totals() {
  const t = D.get(`SELECT
    COALESCE(SUM(CASE WHEN status='requested' THEN amount_usd END),0) requested_usd, COUNT(CASE WHEN status='requested' THEN 1 END) requested,
    COALESCE(SUM(CASE WHEN status='processing' THEN amount_usd END),0) processing_usd, COUNT(CASE WHEN status='processing' THEN 1 END) processing,
    COALESCE(SUM(CASE WHEN status='paid' THEN amount_usd END),0) paid_usd, COUNT(CASE WHEN status='paid' THEN 1 END) paid,
    COALESCE(SUM(CASE WHEN status='paid' AND paid_at>=? THEN amount_usd END),0) paid_month_usd, COUNT(CASE WHEN status='paid' AND paid_at>=? THEN 1 END) paid_month,
    COUNT(CASE WHEN status='rejected' THEN 1 END) rejected, COUNT(CASE WHEN status='cancelled' THEN 1 END) cancelled
    FROM payouts`, REV.monthStartMs(), REV.monthStartMs());
  for (const k of Object.keys(t)) if (k.endsWith('_usd')) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}
function listWhere(status) {
  if (status === 'open') return { sql: "p.status IN ('requested','processing')", args: [] };
  if (REF.STATUSES.includes(status)) return { sql: 'p.status=?', args: [status] };
  return { sql: '1=1', args: [] };
}
/** Earnings and payout history for one member, for the admin. */
function memberSummary(userId) {
  const L = REF.ledger(userId);
  return {
    referred: L.referred.length, paying: L.paying, rate: L.tier.rate, balance: L.balance, spend_usd: L.spend_usd,
    // Referred members whose spend does not count (banned). Shown on the customer card as "Excluded: banned".
    excluded: L.excluded.map(({ id, name, reason, spend_usd }) => ({ id, name, reason, spend_usd })),
    by_product: L.by_product.map(({ key, name, icon, color, spend, earned, count }) => ({ key, name, icon, color, spend, earned, count })),
    method: REF.getMethod(userId, true),
    history: D.all('SELECT * FROM payouts WHERE user_id=? ORDER BY requested_at DESC, id DESC LIMIT 20', userId).map((p) => REF.payoutView(p, { reveal: true })),
    min_withdraw: L.cfg.min_withdraw, settle_days: L.cfg.settle_days,
  };
}

/** Move a payout from one of `from` to `to`. Atomic: a second click finds the status already changed. */
function transition(me, id, from, to, patch) {
  const p = D.get('SELECT * FROM payouts WHERE id=?', id);
  if (!p) fail(404, 'Payout not found.');
  // Four eyes: nobody marks their own payout as sending, paid or not sent, owners included. Another finance member must.
  if (p.user_id === me.id) fail(403, 'This is your own payout. Another team member with payments access has to mark it sending, paid or not sent.');
  if (!from.includes(p.status)) fail(409, `This payout is already ${p.status}.`);
  const sets = { status: to, decided_by: me.id, decided_at: now(), ...patch };
  const keys = Object.keys(sets);
  const r = D.run(`UPDATE payouts SET ${keys.map((k) => k + '=?').join(',')} WHERE id=? AND status IN (${from.map(() => '?').join(',')})`, ...keys.map((k) => sets[k]), id, ...from);
  if (!r.changes) fail(409, 'Someone else just updated this payout. Refresh to see it.');
  return D.get('SELECT * FROM payouts WHERE id=?', id);
}

module.exports = function routes(r) {
  /* ---------------- member ---------------- */
  r.get('/api/me/referrals', (ctx) => REF.memberStats(A.requireUser(ctx), config.baseUrl));

  r.put('/api/me/payout-method', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('payout-method:' + u.id, 20, 10 * 60_000);
    const b = await ctx.json();
    const m = REF.cleanMethod(b);
    if (REF.openPayout(u.id)) fail(409, 'You have a payout request open. Cancel it first, or wait until it is paid, to change your details.');
    D.run('INSERT INTO payout_methods(user_id,type,details,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET type=excluded.type, details=excluded.details, updated_at=excluded.updated_at',
      u.id, m.type, JSON.stringify(m.details), now());
    audit(u, 'payout_method.save', `${m.type} ${REF.methodSummary(m.type, m.details)}`);
    return { method: REF.getMethod(u.id, true) };
  });

  r.post('/api/me/payouts', (ctx) => {
    const u = A.requireUser(ctx);
    limit('payout-req:' + u.id, 10, 10 * 60_000);
    const p = REF.request(u);
    audit(u, 'payout.request', `#${p.id} ${money(p.amount_usd)}`);
    notifyMember(p, 'payout_requested');
    staffPing(p);
    return { payout: REF.payoutView(p), stats: REF.memberStats(u, config.baseUrl) };
  });

  r.post('/api/me/payouts/:id/cancel', (ctx) => {
    const u = A.requireUser(ctx);
    limit('payout-cancel:' + u.id, 12, 10 * 60_000);
    const id = Number(ctx.params.id);
    const p = D.get('SELECT * FROM payouts WHERE id=? AND user_id=?', id, u.id);
    if (!p) fail(404, 'Payout not found.');
    if (p.status !== 'requested') fail(409, p.status === 'processing' ? 'The team is already sending this payout, so it cannot be cancelled. Message support if something is wrong.' : `This payout is already ${p.status}.`);
    const done = D.run("UPDATE payouts SET status='cancelled', decided_at=? WHERE id=? AND status='requested'", now(), id);
    if (!done.changes) fail(409, 'This payout just changed. Refresh to see it.');
    audit(u, 'payout.cancel', `#${id}`);
    staffPing({ id, status: 'cancelled' });
    return { stats: REF.memberStats(u, config.baseUrl) };
  });

  /* ---------------- admin ---------------- */
  r.get('/api/admin/payouts', (ctx) => {
    const me = requirePayouts(ctx);
    const status = String(ctx.query.status || 'requested');
    const w = listWhere(status);
    const q = clean(ctx.query.q, 100).toLowerCase();
    if (q) { w.sql += ' AND (lower(u.name) LIKE ? OR lower(u.email) LIKE ? OR p.reference LIKE ?)'; w.args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const order = ['requested', 'processing', 'open'].includes(status) ? 'p.requested_at ASC' : 'COALESCE(p.decided_at, p.requested_at) DESC';
    const rows = D.all(`${ROW_SQL} WHERE ${w.sql} ORDER BY ${order} LIMIT 200`, ...w.args);
    return { payouts: rows.map((p) => adminRow(p, me)), totals: totals(), min_withdraw: REF.settings().min_withdraw };
  });

  r.get('/api/admin/payouts.csv', (ctx) => {
    const me = requirePayouts(ctx);
    const status = String(ctx.query.status || 'all');
    const w = listWhere(status);
    const rows = D.all(`${ROW_SQL} WHERE ${w.sql} ORDER BY p.id DESC LIMIT 20000`, ...w.args);
    const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const iso = (t) => (t ? new Date(t).toISOString() : '');
    const reveal = A.can(me, 'customers');
    const lines = [['id', 'status', 'amount_usd', 'member', 'email', 'voo_id', 'method', 'details', 'reference', 'note', 'requested_at', 'decided_at', 'paid_at', 'decided_by'].join(',')];
    for (const p of rows) {
      const m = json(p.method, {});
      const d = m.details || {};
      const detail = m.type === 'usdt_trc20' ? d.address : m.type === 'bank' ? `${d.bank_name} ${d.account_number} ${d.account_name} ${d.country}` : `${d.provider} ${d.number} ${d.name} ${d.country}`;
      lines.push([p.id, p.status, p.amount_usd.toFixed(2), p.name, reveal ? p.email : REV.maskEmail(p.email), p.voo_id, REF.METHOD_LABEL[m.type] || m.type, detail, p.reference, p.note, iso(p.requested_at), iso(p.decided_at), iso(p.paid_at), p.decided_name || ''].map(cell).join(','));
    }
    const name = `voosquare-payouts-${status}-${new Date().toISOString().slice(0, 10)}.csv`;
    audit(me, 'payouts.export', name);
    ctx.handled = true;
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    ctx.res.end('﻿' + lines.join('\r\n') + '\r\n');
  });

  r.get('/api/admin/payouts/:id', (ctx) => {
    const me = requirePayouts(ctx);
    const p = D.get(`${ROW_SQL} WHERE p.id=?`, Number(ctx.params.id));
    if (!p) fail(404, 'Payout not found.');
    return { payout: adminRow(p, me), summary: memberSummary(p.user_id) };
  });

  r.post('/api/admin/payouts/:id/processing', (ctx) => {
    const me = requirePayouts(ctx);
    const p = transition(me, Number(ctx.params.id), ['requested'], 'processing', {});
    audit(me, 'payout.processing', `#${p.id} ${money(p.amount_usd)}`);
    publish('user:' + p.user_id, 'payout', { id: p.id, status: p.status, amount_usd: p.amount_usd });
    staffPing(p);
    return { payout: REF.payoutView(p, { reveal: true }) };
  });

  r.post('/api/admin/payouts/:id/paid', async (ctx) => {
    const me = requirePayouts(ctx);
    const b = await ctx.json();
    const reference = clean(b.reference, 200);
    if (reference.length < 4) fail(400, 'Paste the transaction hash or bank reference before marking it paid.');
    const p = transition(me, Number(ctx.params.id), ['requested', 'processing'], 'paid', { reference, note: clean(b.note, 500), paid_at: now() });
    audit(me, 'payout.paid', `#${p.id} ${money(p.amount_usd)} ref ${reference}`);
    notifyMember(p, 'payout_paid', { note_html: noteHtml('A note from the team', p.note) });
    staffPing(p);
    return { payout: REF.payoutView(p, { reveal: true }) };
  });

  r.post('/api/admin/payouts/:id/reject', async (ctx) => {
    const me = requirePayouts(ctx);
    const b = await ctx.json();
    const note = clean(b.note, 500);
    if (note.length < 3) fail(400, 'Add a short reason. The member sees it in the email and on their Referrals page.');
    const p = transition(me, Number(ctx.params.id), ['requested', 'processing'], 'rejected', { note });
    audit(me, 'payout.reject', `#${p.id} ${money(p.amount_usd)}: ${note}`);
    notifyMember(p, 'payout_rejected', { note_html: noteHtml('Why', note) });
    staffPing(p);
    return { payout: REF.payoutView(p, { reveal: true }) };
  });

  /* One member's referral earnings and payouts (customer page). */
  r.get('/api/admin/customers/:id/referrals', (ctx) => {
    requirePayouts(ctx);
    const u = D.get('SELECT id FROM users WHERE id=?', Number(ctx.params.id));
    if (!u) fail(404, 'Customer not found.');
    return memberSummary(u.id);
  });
};
