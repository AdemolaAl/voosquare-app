'use strict';
/**
 * Room applications: paid rooms that are invite only.
 * A member applies, the team approves or rejects, and an approved member has a payment window (7 days).
 * Seats: members with active access hold a seat, and so does an approved member inside their payment window.
 * When the room is full, an approval goes on the waitlist (no window yet) unless the team overrides the seat limit.
 */
const config = require('./config');
const D = require('./db');
const mailer = require('./mailer');
const { now, fail, clean, json, esc, publish } = require('./util');

const DAY = 86400_000;
const PAY_WINDOW_DAYS = 7;
const REAPPLY_DAYS = 30;
const MAX_QUESTIONS = 5;
const MAX_Q_LEN = 140;
const MAX_ANSWER = 600;
const STATUSES = ['pending', 'approved', 'rejected', 'withdrawn', 'expired'];
const DEFAULT_QUESTIONS = [
  'What do you run right now? (verticals, geos)',
  'Your monthly ad spend',
  'What do you want from this room?',
  'Telegram or WhatsApp handle (optional)',
];

const isOptional = (q) => /\(optional\)/i.test(String(q || ''));

/** Clean the questions an admin saved: short, unique, at most five. */
function cleanQuestions(v) {
  const list = Array.isArray(v) ? v : String(v || '').split('\n');
  const out = [];
  for (const x of list) { const q = clean(x, MAX_Q_LEN); if (q && !out.includes(q)) out.push(q); }
  return out.slice(0, MAX_QUESTIONS);
}
const questionsOf = (room) => { const q = cleanQuestions(json(room.apply_questions, [])); return q.length ? q : DEFAULT_QUESTIONS; };

/* A payment the team is still checking (manual or crypto proof sent) keeps the seat after the 7 days run out:
 * the member paid in time, the team just has not confirmed it yet. */
const IN_REVIEW = "EXISTS (SELECT 1 FROM orders o WHERE o.user_id=room_applications.user_id AND o.item_type='room' AND o.item_id=room_applications.room_id AND o.status='review')";
const inReview = (app) => !!D.get("SELECT 1 FROM orders WHERE user_id=? AND item_type='room' AND item_id=? AND status='review' LIMIT 1", app.user_id, app.room_id);

/** Approved members whose payment window ran out without paying become expired. */
function expireStale() {
  D.run(`UPDATE room_applications SET status='expired' WHERE status='approved' AND approved_until>0 AND approved_until<? AND paid_at IS NULL AND NOT ${IN_REVIEW}`, now());
}

/** Seats in use: active members, plus approved members who still have time to pay. */
function seatsTaken(room) {
  const t = now();
  const members = D.get('SELECT COUNT(*) n FROM room_access WHERE room_id=? AND until>?', room.id, t).n;
  const holds = D.get(`SELECT COUNT(*) n FROM room_applications a WHERE a.room_id=? AND a.status='approved' AND a.paid_at IS NULL
    AND (a.approved_until>? OR (a.approved_until>0 AND EXISTS (SELECT 1 FROM orders o WHERE o.user_id=a.user_id AND o.item_type='room' AND o.item_id=a.room_id AND o.status='review')))
    AND NOT EXISTS (SELECT 1 FROM room_access ra WHERE ra.user_id=a.user_id AND ra.room_id=a.room_id AND ra.until>?)`, room.id, t, t).n;
  return members + holds;
}
const seatsFree = (room) => (room.seats > 0 ? Math.max(0, room.seats - seatsTaken(room)) : Infinity);

function hasAccess(userId, roomId) {
  const ra = D.get('SELECT until FROM room_access WHERE user_id=? AND room_id=?', userId, roomId);
  return !!(ra && ra.until > now());
}

/** The member's latest application for a room (or null). */
function latest(userId, roomId) {
  return D.get('SELECT * FROM room_applications WHERE user_id=? AND room_id=? ORDER BY id DESC LIMIT 1', userId, roomId);
}

/** What the member sees about their own application. Never includes who decided or other members' data. */
function memberView(app) {
  if (!app) return null;
  const st = app.status === 'approved' && app.approved_until > 0 && app.approved_until < now() && !app.paid_at && !inReview(app) ? 'expired' : app.status;
  return {
    id: app.id, status: st, created_at: app.created_at, decided_at: app.decided_at || null,
    note: st === 'approved' || st === 'rejected' ? app.note_to_member || '' : '',
    approved_until: st === 'approved' ? app.approved_until || 0 : 0,
    waitlist: st === 'approved' && !app.approved_until && !app.paid_at,
    paid: !!app.paid_at,
    reapply_at: st === 'rejected' && app.decided_at ? app.decided_at + REAPPLY_DAYS * DAY : 0,
  };
}

/** Room fields members see for an invite-only room. */
function roomExtras(room, user) {
  if (!room.approval_required || room.access !== 'paid') return { approval_required: false };
  const taken = room.seats > 0 ? seatsTaken(room) : 0;
  return {
    approval_required: true, seats: room.seats || 0, seats_taken: room.seats > 0 ? Math.min(taken, room.seats) : 0,
    seats_left: room.seats > 0 ? Math.max(0, room.seats - taken) : null,
    apply_questions: questionsOf(room),
    application: user ? memberView(latest(user.id, room.id)) : null,
  };
}

/** Checkout guard: an invite-only room needs an approved, unexpired application, unless the member already has access (renewal). */
function assertCanBuy(user, room) {
  if (!room || !room.approval_required) return;
  if (hasAccess(user.id, room.id)) return;
  expireStale();
  const app = latest(user.id, room.id);
  if (!app || app.status === 'pending') fail(403, app ? 'Your application is still being reviewed.' : `${room.name} is invite only. Apply first.`, { apply: true });
  if (app.status !== 'approved') fail(403, app.status === 'expired' ? 'Your approval window has closed. Apply again.' : `${room.name} is invite only. Apply first.`, { apply: true });
  if (!app.approved_until) fail(403, 'The room is full right now. You are on the waitlist and we will tell you when a seat opens.', { waitlist: true });
  if (app.approved_until < now()) fail(403, 'Your approval window has closed. Apply again.', { apply: true });
}

/** Called when a room order is paid: the member's latest application is done (also when its window lapsed before the team confirmed the payment). */
function markPaid(userId, roomId) {
  D.run(`UPDATE room_applications SET paid_at=?, status='approved' WHERE id=(SELECT MAX(id) FROM room_applications WHERE user_id=? AND room_id=?)
    AND status IN ('approved','expired') AND paid_at IS NULL`, now(), userId, roomId);
}

const money = (n) => '$' + (Number(n) % 1 ? Number(n).toFixed(2) : String(Number(n)));
const period = (d) => (!d ? 'one payment' : d === 30 ? 'a month' : `every ${d} days`);
/** The team's note as an email block (escaped). Empty when there is no note, so the email shows no empty box. */
const noteHtml = (note, label) => (note ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 4px;"><tr><td class="dm-panel" bgcolor="#F6F4EE" style="background:#F6F4EE;border:1px solid #E9E5DA;border-left:4px solid #00A86B;border-radius:4px 16px 16px 4px;padding:16px 20px;">`
  + `<p class="dm-ink" style="margin:0 0 4px;font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;line-height:20px;font-weight:700;color:#0A1611;">${esc(label)}</p>`
  + `<p class="dm-body" style="margin:0;font-family:'Plus Jakarta Sans','Segoe UI',Helvetica,Arial,sans-serif;font-size:15px;line-height:23px;color:#3A4842;">${esc(note).replace(/\n/g, '<br>')}</p></td></tr></table>` : '');
// People-facing dates in the reporting time zone (Africa/Lagos), never the server's UTC (MN-9).
const dateLong = (t) => require('./revenue').dateText(t, { weekday: 'long', day: 'numeric', month: 'long' });

function emailVars(room, app) {
  return {
    room: room.name, price: money(room.price_usd), period: period(room.period_days),
    note: app.note_to_member || '', note_html: noteHtml(app.note_to_member, 'A note from the team'),
    deadline: app.approved_until ? dateLong(app.approved_until) : '',
    pay_url: `${config.baseUrl}/app#community/${room.id}`,
    reapply: app.decided_at ? dateLong(app.decided_at + REAPPLY_DAYS * DAY) : '',
  };
}

/** Tell the member (email + live notification). */
function notify(app, kind) {
  const user = D.get('SELECT * FROM users WHERE id=?', app.user_id);
  const room = D.get('SELECT * FROM rooms WHERE id=?', app.room_id);
  if (!user || !room) return;
  const tpl = { approved: 'room_application_approved', waitlist: 'room_application_waitlist', rejected: 'room_application_rejected', received: 'room_application_received' }[kind];
  if (tpl) mailer.queue(user, tpl, emailVars(room, app));
  publish('user:' + user.id, 'application', { room_id: room.id, room: room.name, status: kind === 'waitlist' ? 'approved' : kind, id: app.id });
}

/** Give a free seat to the oldest waitlisted approvals. Safe to call often. */
function promoteWaitlist(roomId) {
  const rooms = roomId ? D.all("SELECT * FROM rooms WHERE id=? AND access='paid' AND approval_required=1 AND archived=0", roomId) : D.all("SELECT * FROM rooms WHERE access='paid' AND approval_required=1 AND archived=0");
  for (const room of rooms) {
    let free = seatsFree(room);
    if (free <= 0) continue;
    const waiting = D.all("SELECT * FROM room_applications WHERE room_id=? AND status='approved' AND approved_until=0 AND paid_at IS NULL ORDER BY decided_at, id", room.id);
    for (const app of waiting) {
      if (free <= 0) break;
      if (hasAccess(app.user_id, room.id)) continue;
      const until = now() + PAY_WINDOW_DAYS * DAY;
      if (!D.run("UPDATE room_applications SET approved_until=? WHERE id=? AND approved_until=0 AND status='approved'", until, app.id).changes) continue;
      free--;
      notify({ ...app, approved_until: until }, 'approved');
      D.insert('audit', { user_id: null, action: 'application.seat_opened', detail: `#${app.id} ${room.name}`, created_at: now() });
    }
  }
}

/** Member submits an application. */
function apply(user, room, answersIn) {
  if (!room || room.archived || room.access !== 'paid' || !room.approval_required) fail(400, 'This room does not take applications.');
  if (hasAccess(user.id, room.id)) fail(400, 'You already have access to this room.');
  expireStale();
  const prev = latest(user.id, room.id);
  if (prev && prev.status === 'pending') fail(409, 'Your application is already with the team.');
  if (prev && prev.status === 'approved' && !prev.paid_at) fail(409, 'You are already approved. Complete your payment to join.');
  if (prev && prev.status === 'rejected' && prev.decided_at && prev.decided_at + REAPPLY_DAYS * DAY > now()) fail(429, `You can apply again from ${dateLong(prev.decided_at + REAPPLY_DAYS * DAY)}.`);
  const qs = questionsOf(room);
  const given = Array.isArray(answersIn) ? answersIn : [];
  const answers = qs.map((q, i) => ({ q, a: clean(typeof given[i] === 'object' && given[i] ? given[i].a : given[i], MAX_ANSWER) }));
  const missing = answers.find((x) => !x.a && !isOptional(x.q));
  if (missing) fail(400, `Answer: ${missing.q}`);
  const row = D.insert('room_applications', { room_id: room.id, user_id: user.id, answers: JSON.stringify(answers), status: 'pending', note_to_member: '', created_at: now(), approved_until: 0 });
  const app = D.get('SELECT * FROM room_applications WHERE id=?', row.id);
  notify(app, 'received');
  publish('staff:community', 'application', { id: app.id, room_id: room.id, status: 'pending' });
  D.insert('audit', { user_id: user.id, action: 'application.create', detail: `#${app.id} ${room.name}`, created_at: now() });
  return app;
}

function withdraw(user, room) {
  const app = latest(user.id, room.id);
  if (!app || !['pending', 'approved'].includes(app.status) || app.paid_at) fail(400, 'There is no open application to withdraw.');
  D.run("UPDATE room_applications SET status='withdrawn', decided_at=? WHERE id=?", now(), app.id);
  publish('staff:community', 'application', { id: app.id, room_id: room.id, status: 'withdrawn' });
  D.insert('audit', { user_id: user.id, action: 'application.withdraw', detail: `#${app.id} ${room.name}`, created_at: now() });
  if (app.status === 'approved') promoteWaitlist(room.id);
  return D.get('SELECT * FROM room_applications WHERE id=?', app.id);
}

/** Team decision. override_seats lets an approval through when the room is full. */
function decide(staff, id, { decision, note, override_seats }) {
  const app = D.get('SELECT * FROM room_applications WHERE id=?', Number(id));
  if (!app) fail(404, 'Application not found.');
  const room = D.get('SELECT * FROM rooms WHERE id=?', app.room_id);
  if (!room) fail(404, 'Room not found.');
  if (!['approve', 'reject'].includes(decision)) fail(400, 'Approve or reject.');
  const okFrom = decision === 'approve' ? ['pending', 'rejected', 'expired', 'approved'] : ['pending', 'approved'];
  if (!okFrom.includes(app.status) || app.paid_at) fail(409, `This application is already ${app.paid_at ? 'paid' : app.status}.`);
  const msg = clean(note, 600);
  let kind;
  if (decision === 'approve') {
    // A fresh approval (or a re-approval of a waitlisted one when the team overrides seats) gets a 7-day window.
    const hasSeat = override_seats || seatsFree(room) > 0 || (app.status === 'approved' && app.approved_until > now());
    const until = hasSeat ? (app.status === 'approved' && app.approved_until > now() ? app.approved_until : now() + PAY_WINDOW_DAYS * DAY) : 0;
    D.run("UPDATE room_applications SET status='approved', note_to_member=?, decided_by=?, decided_at=?, approved_until=?, seat_override=? WHERE id=?", msg, staff.id, now(), until, override_seats ? 1 : 0, app.id);
    kind = until ? 'approved' : 'waitlist';
  } else {
    D.run("UPDATE room_applications SET status='rejected', note_to_member=?, decided_by=?, decided_at=?, approved_until=0 WHERE id=?", msg, staff.id, now(), app.id);
    kind = 'rejected';
  }
  const fresh = D.get('SELECT * FROM room_applications WHERE id=?', app.id);
  notify(fresh, kind);
  publish('staff:community', 'application', { id: app.id, room_id: room.id, status: fresh.status });
  D.insert('audit', { user_id: staff.id, action: 'application.' + (decision === 'approve' ? (kind === 'waitlist' ? 'waitlist' : 'approve') : 'reject'), detail: `#${app.id} ${room.name}${override_seats ? ' (seat limit overridden)' : ''}`, created_at: now() });
  if (decision === 'reject' && app.status === 'approved') promoteWaitlist(room.id);
  return fresh;
}

/** Granting a room by hand from the customer page counts as the invite: open applications close as approved. */
function closeOnGrant(staff, userId, roomId) {
  D.run("UPDATE room_applications SET status='approved', decided_by=?, decided_at=?, paid_at=? WHERE user_id=? AND room_id=? AND status IN ('pending','approved') AND paid_at IS NULL", staff.id, now(), now(), userId, roomId);
}

/** Rows for the admin list and the customer page. */
function adminRows(where, args, limitN = 200) {
  expireStale();
  const rows = D.all(`SELECT a.*, r.name room_name, r.color room_color, r.icon room_icon, r.seats room_seats, r.slug room_slug, r.image_upload room_image_upload, u.name, u.email, u.handle, u.avatar, u.premium_until, u.created_at member_since, u.country,
      d.name decided_by_name,
      (SELECT COUNT(*) FROM orders o WHERE o.user_id=a.user_id AND o.status='paid') paid_orders,
      (SELECT COALESCE(SUM(amount_usd),0) FROM orders o WHERE o.user_id=a.user_id AND o.status='paid') spend_usd,
      (SELECT until FROM room_access ra WHERE ra.user_id=a.user_id AND ra.room_id=a.room_id) access_until
    FROM room_applications a JOIN rooms r ON r.id=a.room_id JOIN users u ON u.id=a.user_id LEFT JOIN users d ON d.id=a.decided_by
    WHERE ${where} ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.id DESC LIMIT ${Number(limitN) || 200}`, ...args);
  return rows.map((a) => ({
    id: a.id, room_id: a.room_id, room: { name: a.room_name, color: a.room_color, icon: a.room_icon, seats: a.room_seats, image: require('./roomart').roomImages({ slug: a.room_slug, image_upload: a.room_image_upload }).image },
    user: { id: a.user_id, name: a.name, email: a.email, handle: a.handle, avatar: json(a.avatar, {}), premium: (a.premium_until || 0) > now(), member_since: a.member_since, country: a.country },
    answers: json(a.answers, []), status: a.status, note_to_member: a.note_to_member, decided_by: a.decided_by_name || null, decided_at: a.decided_at,
    created_at: a.created_at, approved_until: a.approved_until, waitlist: a.status === 'approved' && !a.approved_until && !a.paid_at, seat_override: !!a.seat_override,
    paid: !!a.paid_at, access_until: a.access_until || 0, paid_orders: a.paid_orders, spend_usd: Math.round(a.spend_usd * 100) / 100,
  }));
}

module.exports = {
  DEFAULT_QUESTIONS, STATUSES, PAY_WINDOW_DAYS, REAPPLY_DAYS, MAX_QUESTIONS, MAX_ANSWER,
  cleanQuestions, questionsOf, seatsTaken, seatsFree, roomExtras, memberView, latest, assertCanBuy, markPaid,
  apply, withdraw, decide, closeOnGrant, adminRows, expireStale, promoteWaitlist, hasAccess,
};
