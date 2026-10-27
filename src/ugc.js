'use strict';
/*
 * Community safety (Apple guideline 1.2, Google Play user-generated content policy) and the store reviewers' sign-in.
 *
 *  - Report a message: POST /api/messages/:id/report. One open report per member per message. The reporter stops seeing
 *    the message at once; after reports from HIDE_AT different members it is hidden from everyone but the team until
 *    someone reviews it (messages.hidden = 1). The team works the queue in Admin → Community → Reports: remove the
 *    message, dismiss the reports or ban the author. Every action is audited. Reports are never deleted.
 *  - Block a member: POST /api/blocks, DELETE /api/blocks/:user_id, GET /api/blocks. A blocked member's messages are
 *    left out for the blocker everywhere (room lists, live updates, previews). They are not told. The team cannot be
 *    blocked: moderators must stay visible.
 *  - App review account: an owner-controlled email plus fixed 6-digit code (Admin → Settings), or REVIEW_LOGIN_EMAIL and
 *    REVIEW_LOGIN_CODE (env wins). /api/auth/verify accepts that code for exactly that email, still rate limited, never
 *    for the owner or a team member. The code is stored hashed and never sent back.
 * Tables: src/migrations/013-ugc-reports-and-blocks.js.
 */
const config = require('./config');
const D = require('./db');
const A = require('./auth');
const up = require('./uploads');
const { now, fail, clean, json, limit, publish, isEmail, safeEq } = require('./util');

const REASONS = [['spam', 'Spam or scam'], ['harassment', 'Harassment or hate'], ['sexual', 'Sexual or violent content'], ['illegal', 'Illegal or dangerous'], ['other', 'Something else']];
const REASON_LABEL = Object.fromEntries(REASONS);
const HIDE_AT = 3;
const audit = (u, action, detail = '') => D.insert('audit', { user_id: u.id, action, detail: String(detail).slice(0, 500), created_at: now() });
const app = () => require('./routes/app').helpers; // loaded lazily: src/routes/app.js requires this file

/* ---------------- blocks ---------------- */
/** Ids of the members this member blocked. */
const blockedIds = (uid) => (uid ? D.all('SELECT blocked_id FROM member_blocks WHERE blocker_id=?', uid).map((r) => r.blocked_id) : []);
/** Ids of the members who blocked this member. */
const blockersOf = (uid) => new Set(uid ? D.all('SELECT blocker_id FROM member_blocks WHERE blocked_id=?', uid).map((r) => r.blocker_id) : []);
const isBlocked = (blocker, blocked) => !!(blocker && blocked && D.get('SELECT 1 FROM member_blocks WHERE blocker_id=? AND blocked_id=?', blocker, blocked));
/** SQL condition that leaves out authors the viewer blocked. `col` is the author column. */
const notBlockedSql = (col) => `${col} NOT IN (SELECT blocked_id FROM member_blocks WHERE blocker_id=?)`;

/** A new room message, live: everyone in the room except members who blocked its author. */
function publishMessage(roomId, msg) {
  const skip = blockersOf(msg.user && msg.user.id);
  publish('room:' + roomId, 'message', msg, skip.size ? (meta) => !!meta.uid && skip.has(meta.uid) : undefined);
}

/* ---------------- reports ---------------- */
/** Of these message ids, the ones this member reported (any status: a member who reported a message keeps it hidden). */
function reportedBy(uid, ids) {
  if (!uid || !ids.length) return new Set();
  return new Set(D.all(`SELECT DISTINCT message_id FROM message_reports WHERE reporter_id=? AND message_id IN (${ids.map(() => '?').join(',')})`, uid, ...ids).map((r) => r.message_id));
}
const openCount = () => D.get("SELECT COUNT(DISTINCT message_id) n FROM message_reports WHERE status='open'").n;

/** Everything about the reported messages, one group per message. status: 'open' or 'handled'. */
function reportGroups(status) {
  const where = status === 'handled' ? "r.status IN ('actioned','dismissed')" : "r.status='open'";
  const rows = D.all(`SELECT r.*, u.name reporter_name, h.name handler_name FROM message_reports r LEFT JOIN users u ON u.id=r.reporter_id LEFT JOIN users h ON h.id=r.handled_by
    WHERE ${where} ORDER BY r.id DESC LIMIT 600`);
  const ids = [...new Set(rows.map((r) => r.message_id))].slice(0, 100);
  if (!ids.length) return [];
  const ph = ids.map(() => '?').join(',');
  const msgs = Object.fromEntries(D.all(`SELECT m.*, u.name, u.handle, u.avatar, u.premium_until, u.perms, u.role_title, u.banned, u.email FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id IN (${ph})`, ...ids).map((m) => [m.id, m]));
  const rooms = Object.fromEntries(D.all('SELECT id, name FROM rooms').map((x) => [x.id, x.name]));
  const files = up.lookup(Object.values(msgs).map((m) => m.upload_id));
  return ids.filter((id) => msgs[id]).map((id) => {
    const m = msgs[id];
    const rs = rows.filter((r) => r.message_id === id);
    const counts = {};
    for (const r of rs) counts[r.reason] = (counts[r.reason] || 0) + 1;
    const last = rs[0];
    return {
      message_id: id, room: { id: m.room_id, name: rooms[m.room_id] || 'Room' },
      message: { id, body: m.body, deleted: !!m.deleted, hidden: !!m.hidden, attachment: files[m.upload_id] || null, created_at: m.created_at },
      author: { ...A.memberCard({ ...m, id: m.user_id }), banned: !!m.banned },
      reasons: Object.entries(counts).map(([reason, n]) => ({ reason, label: REASON_LABEL[reason] || 'Something else', n })).sort((a, b) => b.n - a.n),
      reports: rs.map((r) => ({ id: r.id, reason: r.reason, label: REASON_LABEL[r.reason] || 'Something else', note: r.note || '', reporter: { id: r.reporter_id, name: r.reporter_name || 'Member' }, created_at: r.created_at })),
      count: new Set(rs.map((r) => r.reporter_id)).size, first_at: rs[rs.length - 1].created_at, last_at: last.created_at,
      action: status === 'handled' ? last.action : '', handled_by: status === 'handled' ? last.handler_name || '' : '', handled_at: status === 'handled' ? last.handled_at : 0,
    };
  }).sort((a, b) => (status === 'handled' ? b.handled_at - a.handled_at : b.count - a.count || b.last_at - a.last_at));
}

/** Close every open report on a message. Returns how many were open. */
function closeReports(me, messageId, status, action) {
  return D.run("UPDATE message_reports SET status=?, action=?, handled_by=?, handled_at=? WHERE message_id=? AND status='open'", status, action, me.id, now(), messageId).changes;
}
/** The message behind an open report group, or a 404 the admin understands. */
function openGroupMessage(id) {
  const m = D.get('SELECT * FROM messages WHERE id=?', Number(id));
  if (!m) fail(404, 'Message not found.');
  if (!D.get("SELECT 1 FROM message_reports WHERE message_id=? AND status='open'", m.id)) fail(409, 'Someone on the team already handled these reports.');
  return m;
}
/** Remove a message for everyone (the same as Delete in a room). */
function removeMessage(m) {
  if (m.deleted) return;
  D.run('UPDATE messages SET deleted=1, pinned=0, hidden=0 WHERE id=?', m.id);
  up.softDelete(m.upload_id);
  publish('room:' + m.room_id, 'delete', { id: m.id });
  publish('community', 'activity', { room_id: m.room_id, id: m.id });
}
const staffPing = (d) => publish('staff:community', 'report', { ...d, open: openCount() });

/* ---------------- app review account ---------------- */
const CODE_RE = /^\d{6}$/;
const envReview = () => {
  const email = String(process.env.REVIEW_LOGIN_EMAIL || '').trim().toLowerCase();
  const code = String(process.env.REVIEW_LOGIN_CODE || '').trim();
  return email && code ? { email, code } : null;
};
/** Is this email the owner's or a team member's? Those never get a fixed code. */
function isStaffEmail(email) {
  if (!email) return false;
  if (config.ownerEmail && email === config.ownerEmail) return true;
  const u = D.get('SELECT perms FROM users WHERE email=?', email);
  return !!u && json(u.perms, []).length > 0;
}
/** The review sign-in in force: from the environment (wins when both variables are set) or from the admin setting. */
function reviewConfig() {
  const env = envReview();
  if (env) return { source: 'env', enabled: isEmail(env.email) && CODE_RE.test(env.code), email: env.email, check: (c) => safeEq(c, env.code) };
  const s = D.getSetting('review_login', {}) || {};
  return { source: 'admin', enabled: !!(s.enabled && s.email && s.code_hash), email: s.email || '', check: (c) => !!s.code_hash && safeEq(s.code_hash, A.codeHash(s.email, c)) };
}
/** True when `email` + `code` is the store reviewers' sign-in: switched on, the exact email, the fixed code, and never the
 * owner or a team member (checked again here, not only when it is saved). */
function reviewLoginOk(email, code) {
  const c = reviewConfig();
  if (!c.enabled || !email || email !== c.email || !CODE_RE.test(String(code || ''))) return false;
  if (isStaffEmail(email)) return false;
  return c.check(String(code));
}
function reviewAdminView() {
  const s = D.getSetting('review_login', {}) || {};
  const env = envReview();
  return { enabled: !!s.enabled, email: s.email || '', has_code: !!s.code_hash, updated_at: s.updated_at || 0, env: env ? { active: true, email: env.email, valid: isEmail(env.email) && CODE_RE.test(env.code) } : { active: false } };
}

/* ---------------- routes ---------------- */
function routes(r) {
  /* Members: report someone else's message. */
  r.post('/api/messages/:id/report', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('report:' + u.id, 20, 60 * 60_000);
    const b = await ctx.json();
    const m = D.get('SELECT * FROM messages WHERE id=? AND deleted=0', Number(ctx.params.id));
    if (!m) fail(404, 'Message not found.');
    const room = D.get('SELECT * FROM rooms WHERE id=?', m.room_id);
    if (!room || !app().roomAccess(u, room)) fail(403, 'This room is locked.');
    if (m.user_id === u.id) fail(400, "You can't report your own message. You can delete it instead.");
    const reason = REASON_LABEL[b.reason] ? b.reason : '';
    if (!reason) fail(400, 'Pick a reason.');
    const note = clean(b.note, 500);
    if (D.get("SELECT 1 FROM message_reports WHERE message_id=? AND reporter_id=? AND status='open'", m.id, u.id)) {
      return { ok: true, already: true, message: 'You already reported this message. Our team will review it within 24 hours.' };
    }
    D.insert('message_reports', { message_id: m.id, room_id: m.room_id, author_id: m.user_id, reporter_id: u.id, reason, note, status: 'open', created_at: now() });
    // Reports from HIDE_AT different members hide the message from everyone but the team until it is reviewed.
    // Messages from the team are never hidden this way (moderators must stay visible).
    const author = D.get('SELECT perms FROM users WHERE id=?', m.user_id);
    const reporters = D.get("SELECT COUNT(DISTINCT reporter_id) n FROM message_reports WHERE message_id=? AND status='open'", m.id).n;
    let hidden = false;
    if (!m.hidden && reporters >= HIDE_AT && !(author && json(author.perms, []).length)) {
      D.run('UPDATE messages SET hidden=1, pinned=0 WHERE id=?', m.id);
      hidden = true;
      publish('room:' + m.room_id, 'hide', { id: m.id });
    }
    staffPing({ message_id: m.id, room_id: m.room_id, hidden });
    return { ok: true, already: false, hidden_for_you: true };
  });

  /* Members: block, unblock, list. */
  r.get('/api/blocks', (ctx) => {
    const u = A.requireUser(ctx);
    const rows = D.all('SELECT u.*, b.created_at blocked_at FROM member_blocks b JOIN users u ON u.id=b.blocked_id WHERE b.blocker_id=? ORDER BY b.created_at DESC', u.id);
    return { blocks: rows.map((x) => ({ ...A.memberCard(x), blocked_at: x.blocked_at })) };
  });
  r.post('/api/blocks', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('block:' + u.id, 60, 60 * 60_000);
    const b = await ctx.json();
    const id = Number(b.user_id) || 0;
    if (id === u.id) fail(400, "You can't block yourself.");
    const t = D.get('SELECT * FROM users WHERE id=? AND COALESCE(deleted_at,0)=0', id);
    if (!t) fail(404, 'Member not found.');
    if (json(t.perms, []).length) fail(400, "You can't block someone from the VooSquare team. If something is wrong, report the message or contact support.");
    D.run('INSERT OR IGNORE INTO member_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)', u.id, t.id, now());
    return { ok: true, blocked: A.memberCard(t) };
  });
  r.del('/api/blocks/:user_id', (ctx) => {
    const u = A.requireUser(ctx);
    D.run('DELETE FROM member_blocks WHERE blocker_id=? AND blocked_id=?', u.id, Number(ctx.params.user_id) || 0);
    return { ok: true };
  });

  /* Admin → Community → Reports. */
  r.get('/api/admin/reports', (ctx) => {
    A.requirePerm(ctx, 'community');
    if (ctx.query.count) return { open: openCount() }; // the admin's nav badge
    const status = ctx.query.status === 'handled' ? 'handled' : 'open';
    return { status, groups: reportGroups(status), open: openCount(), reasons: REASONS.map(([k, l]) => ({ key: k, label: l })) };
  });
  r.post('/api/admin/reports/:message_id/dismiss', (ctx) => {
    const me = A.requirePerm(ctx, 'community');
    const m = openGroupMessage(ctx.params.message_id);
    const n = closeReports(me, m.id, 'dismissed', 'dismissed');
    if (m.hidden) D.run('UPDATE messages SET hidden=0 WHERE id=?', m.id);
    audit(me, 'report.dismiss', `message #${m.id} in room ${m.room_id} (${n} report${n === 1 ? '' : 's'})`);
    staffPing({ message_id: m.id, handled: 'dismissed' });
    return { ok: true, open: openCount() };
  });
  r.post('/api/admin/reports/:message_id/remove', (ctx) => {
    const me = A.requirePerm(ctx, 'community');
    const m = openGroupMessage(ctx.params.message_id);
    removeMessage(m);
    const n = closeReports(me, m.id, 'actioned', 'removed');
    audit(me, 'report.remove', `message #${m.id} in room ${m.room_id} (${n} report${n === 1 ? '' : 's'})`);
    staffPing({ message_id: m.id, handled: 'removed' });
    return { ok: true, open: openCount() };
  });
  r.post('/api/admin/reports/:message_id/ban', (ctx) => {
    const me = A.requirePerm(ctx, 'community');
    const m = openGroupMessage(ctx.params.message_id);
    const author = D.get('SELECT * FROM users WHERE id=?', m.user_id);
    if (!author) fail(404, 'Member not found.');
    if (json(author.perms, []).length) fail(400, "Team members can't be banned from here. Remove them from the team first.");
    // The same ban as Admin → Customers: the flag, every session ended and open live streams closed now.
    D.run('UPDATE users SET banned=1 WHERE id=?', author.id);
    A.revokeUser(author.id, 'banned');
    removeMessage(m);
    const n = closeReports(me, m.id, 'actioned', 'banned');
    audit(me, 'report.ban', `${author.email}: message #${m.id} in room ${m.room_id} (${n} report${n === 1 ? '' : 's'})`);
    staffPing({ message_id: m.id, handled: 'banned' });
    return { ok: true, open: openCount() };
  });

  /* Admin → Settings: the App review account. Owner only. */
  r.get('/api/admin/review-login', (ctx) => {
    const me = A.requireStaff(ctx);
    if (!A.isOwner(me)) fail(403, 'Only an owner can see the app review account.');
    return { review: reviewAdminView() };
  });
  r.put('/api/admin/review-login', async (ctx) => {
    const me = A.requireStaff(ctx);
    if (!A.isOwner(me)) fail(403, 'Only an owner can change the app review account.');
    limit('review-login:' + me.id, 30, 60 * 60_000);
    const b = await ctx.json();
    const old = D.getSetting('review_login', {}) || {};
    const enabled = !!b.enabled;
    const email = clean(b.email, 200).toLowerCase();
    const code = String(b.code || '').trim();
    if (email && !isEmail(email)) fail(400, 'Enter a valid email address.');
    if (code && !CODE_RE.test(code)) fail(400, 'The code must be exactly 6 digits.');
    if (email && isStaffEmail(email)) fail(400, "This email belongs to the owner or a team member. Use a separate one just for the review, for example review@yourdomain.com.");
    if (enabled && !email) fail(400, 'Add the email the reviewers will use.');
    // The saved code is tied to the email, so a new email needs the code typed again.
    const keepHash = !code && email && email === old.email && old.code_hash;
    if (enabled && !code && !keepHash) fail(400, 'Type the 6-digit code the reviewers will use.');
    const value = { enabled, email, code_hash: code ? A.codeHash(email, code) : keepHash || '', updated_at: now(), updated_by: me.id };
    D.setSetting('review_login', value);
    audit(me, 'settings.review_login', `${enabled ? 'on' : 'off'}${email ? ': ' + email : ''}${code ? ' (new code)' : ''}`);
    return { review: reviewAdminView() };
  });
}

module.exports = { REASONS, HIDE_AT, blockedIds, blockersOf, isBlocked, notBlockedSql, publishMessage, reportedBy, openCount, reviewLoginOk, reviewConfig, isStaffEmail, routes };
