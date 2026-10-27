'use strict';
/*
 * Feature switches (Admin → Settings → Features), "What's new" notes for members, and member states
 * (deactivated, erased) used by the admin's Customers page.
 *
 * Switches live in the `features` setting. They never touch data: an area that is off answers its member API with
 * 403 { off: '<area>' } and is left out of the public payloads, so turning it back on restores everything as it was.
 * Enforcement wraps every route once at boot (install), so a new endpoint under an area's path is covered automatically.
 */
const config = require('./config');
const D = require('./db');
const A = require('./auth');
const { now, fail, clean, json, publish, limit, safeUrl } = require('./util');

/* ---------------- member states (columns added in place) ---------------- */
{
  const cols = D.db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('deactivated')) D.db.exec('ALTER TABLE users ADD COLUMN deactivated INTEGER DEFAULT 0');
  if (!cols.includes('erased_at')) D.db.exec('ALTER TABLE users ADD COLUMN erased_at INTEGER DEFAULT 0');
}
D.db.exec(`CREATE TABLE IF NOT EXISTS release_notes(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT DEFAULT '', link_url TEXT DEFAULT '', link_text TEXT DEFAULT '',
  published INTEGER DEFAULT 1, created_by INTEGER, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS release_seen(user_id INTEGER NOT NULL, note_id INTEGER NOT NULL, seen_at INTEGER, PRIMARY KEY(user_id, note_id));`);

/* ---------------- the switches ---------------- */
const AREAS = {
  community: 'Community', academy: 'The Academy', blog: 'The blog', tools: 'Free tools', referrals: 'Referrals',
  premium: 'Premium', paid_rooms: 'Paid rooms', support: 'Support', spotlight: 'Spotlight ads', announcements: 'The announcement bar', images: 'Image sharing', voice: 'The teaching voice',
  affiliates: 'The affiliate program',
};
const DEFAULTS = {
  community: true, academy: true, blog: true, tools: true, referrals: true, premium: true, paid_rooms: true, support: true,
  spotlight: true, announcements: true, images: true, voice: true, affiliates: true,
  signups_paused: false, signups_message: '', maintenance: false, maintenance_message: '',
};
const DEFAULT_SIGNUPS_MSG = 'New sign-ups are paused for a short while. If you already have a Voo ID, log in as usual.';
const DEFAULT_MAINT_MSG = 'VooSquare is getting an upgrade. We will be back shortly. Your account, rooms and progress are safe.';

function get() {
  const v = D.getSetting('features', null);
  const out = { ...DEFAULTS };
  if (v && typeof v === 'object') for (const k of Object.keys(DEFAULTS)) if (v[k] !== undefined) out[k] = typeof DEFAULTS[k] === 'boolean' ? !!v[k] : String(v[k] || '');
  return out;
}
function clean_(v) {
  const cur = get();
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    const x = v && typeof v === 'object' && v[k] !== undefined ? v[k] : cur[k];
    out[k] = typeof DEFAULTS[k] === 'boolean' ? !!x : clean(x, 300);
  }
  return out;
}
/** What the site and the app read: every switch, plus the two messages with their defaults filled in. */
function publicFeatures() {
  const f = get();
  return { ...f, signups_message: f.signups_message || DEFAULT_SIGNUPS_MSG, maintenance_message: f.maintenance_message || DEFAULT_MAINT_MSG, affiliate_url: config.affiliateUrl || '/affiliates' };
}
const on = (k) => get()[k] !== false;
const offError = (k) => fail(403, `${AREAS[k] || 'This part of VooSquare'} is turned off for now. Everything you saved is kept.`, { off: k });

/* ---------------- enforcement ---------------- */
/* Member API paths per area (matched on the real path). Admin routes (/api/admin/*) are never switched off. */
const AREA_PATHS = [
  [/^\/api\/rooms(\/|$)/, 'community'], [/^\/api\/messages\//, 'community'], [/^\/api\/members\//, 'community'],
  [/^\/api\/school\/voice(\/|$)/, 'voice'], [/^\/api\/courses(\/|$)/, 'academy'], [/^\/api\/lessons\//, 'academy'], [/^\/api\/school(\/|$)/, 'academy'], [/^\/api\/academy\//, 'academy'],
  [/^\/api\/posts(\/|$)/, 'blog'],
  [/^\/api\/tools(\/|$)/, 'tools'],
  [/^\/api\/me\/(referrals|payout-method|payouts)(\/|$)/, 'referrals'],
  [/^\/api\/support\//, 'support'], [/^\/api\/widget\//, 'support'],
  // Affiliate program API (provider webhooks and the Telegram webhook stay open so nothing is lost while it is off).
  [/^\/api\/aff\/(?!hooks\/|telegram\/webhook$)/, 'affiliates'],
];
/* Open during maintenance for members (staff are never stopped): sign-in, the shell's own payloads, webhooks and tool-to-hub APIs. */
const MAINT_OPEN = [/^\/healthz$/, /^\/api\/site$/, /^\/api\/auth\//, /^\/api\/admin\//, /^\/api\/billing\/webhook\//, /^\/api\/v1\//, /^\/oauth\//, /^\/u\//, /^\/api\/avatar\//, /^\/api\/login-brand\//, /^\/api\/stream$/, /^\/verify\//, /^\/api\/verify\//, /^\/api\/aff\/hooks\//, /^\/api\/aff\/telegram\/webhook$/];

async function before(ctx) {
  const p = ctx.url.pathname;
  const m = ctx.req.method;
  if (p.startsWith('/api/admin/')) return;
  const f = get();
  const u = ctx.user;
  const staff = !!(u && u.staff);

  if (f.maintenance && !staff && p.startsWith('/api/') && !MAINT_OPEN.some((re) => re.test(p)) && !(p === '/api/me' && m === 'GET')) {
    fail(503, f.maintenance_message || DEFAULT_MAINT_MSG, { maintenance: true });
  }
  for (const [re, k] of AREA_PATHS) if (re.test(p) && f[k] === false) offError(k);

  if (f.signups_paused && (p === '/api/auth/start' || p === '/api/auth/verify') && m === 'POST') {
    const b = await ctx.json();
    const email = clean(b.email, 200).toLowerCase();
    if (email && email !== config.ownerEmail && !D.get('SELECT 1 FROM users WHERE email=?', email)) {
      fail(403, f.signups_message || DEFAULT_SIGNUPS_MSG, { signups_paused: true });
    }
  }
  if (p === '/api/billing/checkout' && m === 'POST') {
    const b = await ctx.json();
    if (b.item === 'premium' && f.premium === false) offError('premium');
    if (b.item === 'room' && f.paid_rooms === false) offError('paid_rooms');
  }
  if (/^\/api\/rooms\/\d+\/apply$/.test(p) && f.paid_rooms === false) offError('paid_rooms');
  if (p === '/api/uploads' && m === 'POST' && f.images === false && !staff && (!ctx.query.purpose || ctx.query.purpose === 'chat')) {
    fail(403, 'Image sharing is turned off for now.', { off: 'images' });
  }
  const post = /^\/api\/rooms\/(\d+)\/messages$/.exec(p);
  if (post && m === 'POST' && u) {
    if (D.get('SELECT deactivated FROM users WHERE id=?', u.id)?.deactivated) fail(403, 'Your account is not active in the community. Contact support if you think this is a mistake.');
    if (f.images === false && !staff) { const b = await ctx.json(); if (b.upload_id) fail(403, 'Image sharing is turned off for now.', { off: 'images' }); }
  }
  const mem = /^\/api\/members\/(\d+)$/.exec(p);
  if (mem && D.get('SELECT deactivated FROM users WHERE id=?', Number(mem[1]))?.deactivated) fail(404, 'Member not found.');
}

function deactivatedIds() { return new Set(D.all('SELECT id FROM users WHERE deactivated=1').map((r) => r.id)); }

function after(ctx, out) {
  if (!out || typeof out !== 'object' || Array.isArray(out)) return out;
  const p = ctx.url.pathname;
  if (p.startsWith('/api/admin/') || ctx.req.method !== 'GET') return out;
  const f = get();
  const staff = !!(ctx.user && ctx.user.staff);
  if (f.spotlight === false && 'ads' in out) out.ads = [];
  if (f.announcements === false && 'announcements' in out) out.announcements = [];
  const keepRoom = (r) => !((f.paid_rooms === false && r.access === 'paid' && !r.unlocked) || (f.premium === false && r.access === 'premium' && !r.unlocked));
  const noImages = (r) => (f.images === false && !staff ? { ...r, can_image: false } : r);

  if (p === '/api/site') {
    out.features = publicFeatures();
    if (f.community === false) out.rooms = [];
    else out.rooms = (out.rooms || []).filter((r) => !((f.paid_rooms === false && r.access === 'paid') || (f.premium === false && r.access === 'premium')));
    if (f.academy === false) out.courses = [];
    if (f.blog === false) out.posts = [];
    if (f.tools === false) out.calc_tools = [];
  } else if (p === '/api/me') {
    out.features = publicFeatures();
    out.flags = require('./flags').forUser(ctx.user); // rollout flags for new features (src/flags.js)
  } else if (p === '/api/me/home') {
    out.features = publicFeatures();
    if (f.academy === false) out.courses = [];
    if (f.community === false) { out.rooms = []; out.unread_rooms = 0; } else out.rooms = (out.rooms || []).filter(keepRoom);
    if (f.blog === false) out.updates = [];
    if (f.tools === false) out.calc_tools = [];
    if (f.support === false) out.open_tickets = 0;
    if (ctx.user) out.whats_new = whatsNewFor(ctx.user);
  } else if (p === '/api/rooms') {
    const hide = deactivatedIds();
    out.rooms = (out.rooms || []).filter(keepRoom).map((r) => ({ ...noImages(r), faces: (r.faces || []).filter((x) => !x.id || !hide.has(x.id)), last: r.last && hide.has(r.last.user_id) ? null : r.last }));
  } else if (/^\/api\/rooms\/\d+\/messages$/.test(p)) {
    const hide = deactivatedIds();
    if (hide.size) {
      const vis = (x) => !(x.user && hide.has(x.user.id));
      out.messages = (out.messages || []).filter(vis);
      out.pinned = (out.pinned || []).filter(vis);
    }
    if (out.room) out.room = noImages(out.room);
  }
  return out;
}

/** Wrap every registered route with the checks above. Call once, after all routes are added. */
function install(router) {
  for (const r of router.routes) {
    if (r._features) continue;
    const h = r.handler;
    r.handler = async (ctx) => {
      await before(ctx);
      const out = await h(ctx);
      return after(ctx, out);
    };
    r._features = true;
  }
}

/* ---------------- What's new ---------------- */
const notePublic = (n) => ({ id: n.id, title: n.title, body: n.body, link_url: n.link_url, link_text: n.link_text, created_at: n.created_at });
/** The newest published note this member has not dismissed, written after they joined (new members are not shown old news). */
function whatsNewFor(u) {
  const n = D.get(`SELECT * FROM release_notes WHERE published=1 AND created_at>=? AND id NOT IN (SELECT note_id FROM release_seen WHERE user_id=?)
    ORDER BY created_at DESC, id DESC LIMIT 1`, u.created_at || 0, u.id);
  return n ? notePublic(n) : null;
}
function cleanNote(b) {
  const title = clean(b.title, 80);
  if (!title) fail(400, 'Give the note a title.');
  const link = safeUrl(b.link_url, 300);
  return { title, body: clean(b.body, 280), link_url: /^(https?:\/\/|\/(?!\/)|#)/i.test(link) ? link : '', link_text: clean(b.link_text, 32), published: b.published === false || b.published === 0 ? 0 : 1 };
}

/* ---------------- erase personal data ---------------- */
function erase(me, id) {
  const u = D.get('SELECT * FROM users WHERE id=?', id);
  if (!u) fail(404, 'Customer not found.');
  if (json(u.perms, []).length) fail(400, 'Remove this person from the team first.');
  if (u.erased_at) fail(400, 'This member was already erased.');
  const anon = `erased-${u.id}@erased.invalid`;
  let handle = 'erased_' + u.id;
  if (D.get('SELECT 1 FROM users WHERE handle=? AND id<>?', handle, u.id)) handle += '_' + now().toString(36);
  D.tx(() => {
    D.run(`UPDATE users SET name='Erased member', email=?, handle=?, avatar='{}', bio='', country='', marketing=0, deactivated=1, banned=1, erased_at=?, role_title='' WHERE id=?`, anon, handle, now(), u.id);
    D.run('DELETE FROM sessions WHERE user_id=?', u.id);
    D.run('DELETE FROM login_codes WHERE email=?', u.email);
    D.run('DELETE FROM payout_methods WHERE user_id=?', u.id);
    D.run("UPDATE tickets SET email=?, name='Erased member' WHERE user_id=? OR email=?", anon, u.id, u.email);
    D.run("DELETE FROM email_queue WHERE (user_id=? OR to_email=?) AND status='queued'", u.id, u.email);
    D.run("UPDATE email_queue SET to_email=?, vars='{}' WHERE user_id=? OR to_email=?", anon, u.id, u.email);
    D.run('DELETE FROM tool_saves WHERE user_id=?', u.id);
    // VooSquare Academy certificates stay verifiable but no longer carry the name.
    D.run("UPDATE school_certificates SET name='Erased member' WHERE user_id=?", u.id);
  });
  A.revokeUser(u.id, 'erased'); // close their open live streams now (sessions are already gone)
  D.insert('audit', { user_id: me.id, action: 'customer.erase', detail: `#${u.id} (personal data erased; orders kept)`, created_at: now() });
}

/* ---------------- routes ---------------- */
function routes(r) {
  r.get('/api/admin/features', (ctx) => {
    A.requirePerm(ctx, 'settings');
    return { features: get(), defaults: { signups_message: DEFAULT_SIGNUPS_MSG, maintenance_message: DEFAULT_MAINT_MSG } };
  });
  r.put('/api/admin/features', async (ctx) => {
    const me = A.requirePerm(ctx, 'settings');
    const b = await ctx.json();
    const before_ = get();
    const v = clean_(b.features || b);
    D.setSetting('features', v);
    const changed = Object.keys(v).filter((k) => v[k] !== before_[k]);
    D.insert('audit', { user_id: me.id, action: 'settings.features', detail: changed.map((k) => `${k}=${typeof v[k] === 'boolean' ? (v[k] ? 'on' : 'off') : 'edited'}`).join(', ').slice(0, 500) || 'no change', created_at: now() });
    publish('community', 'site', { key: 'features' });
    return { features: get() };
  });

  /* Members: dismiss the What's new card. */
  r.post('/api/me/whats-new/:id/seen', (ctx) => {
    const u = A.requireUser(ctx);
    limit('wn:' + u.id, 30, 60_000);
    D.run('INSERT OR IGNORE INTO release_seen(user_id,note_id,seen_at) VALUES(?,?,?)', u.id, Number(ctx.params.id) || 0, now());
    return { ok: true };
  });

  r.get('/api/admin/whats-new', (ctx) => {
    A.requirePerm(ctx, 'content');
    const notes = D.all('SELECT n.*, (SELECT COUNT(*) FROM release_seen s WHERE s.note_id=n.id) seen FROM release_notes n ORDER BY n.created_at DESC, n.id DESC LIMIT 50');
    return { notes, members: D.get('SELECT COUNT(*) n FROM users WHERE banned=0').n };
  });
  r.post('/api/admin/whats-new', async (ctx) => {
    const me = A.requirePerm(ctx, 'content');
    const b = await ctx.json();
    const v = cleanNote(b);
    let id = Number(b.id) || 0;
    if (id) {
      if (!D.get('SELECT 1 FROM release_notes WHERE id=?', id)) fail(404, 'Note not found.');
      D.update('release_notes', id, { ...v, updated_at: now() }, ['title', 'body', 'link_url', 'link_text', 'published', 'updated_at']);
    } else id = D.insert('release_notes', { ...v, created_by: me.id, created_at: now(), updated_at: now() }).id;
    D.insert('audit', { user_id: me.id, action: b.id ? 'whats_new.update' : 'whats_new.post', detail: v.title, created_at: now() });
    publish('community', 'site', { key: 'whats_new' });
    return { note: D.get('SELECT * FROM release_notes WHERE id=?', id) };
  });
  r.del('/api/admin/whats-new/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'content');
    const n = D.get('SELECT * FROM release_notes WHERE id=?', Number(ctx.params.id));
    if (!n) fail(404, 'Note not found.');
    D.run('DELETE FROM release_seen WHERE note_id=?', n.id);
    require('./trash').remove('release_notes', 'id=?', [n.id], { by: me.id, reason: 'whats_new.delete' });
    D.insert('audit', { user_id: me.id, action: 'whats_new.delete', detail: n.title, created_at: now() });
    publish('community', 'site', { key: 'whats_new' });
    return { ok: true };
  });

  /* Customers: hide from the community (reversible) and erase personal data (owner, permanent). */
  r.post('/api/admin/customers/:id/deactivate', async (ctx) => {
    const me = A.requirePerm(ctx, 'customers');
    const u = D.get('SELECT * FROM users WHERE id=?', Number(ctx.params.id));
    if (!u) fail(404, 'Customer not found.');
    if (json(u.perms, []).includes('*')) fail(400, 'You cannot deactivate an owner.');
    if (u.erased_at) fail(400, 'This member was erased.');
    const b = await ctx.json();
    const v = b.deactivated === false ? 0 : 1;
    D.run('UPDATE users SET deactivated=? WHERE id=?', v, u.id);
    D.insert('audit', { user_id: me.id, action: v ? 'customer.deactivate' : 'customer.reactivate', detail: u.email, created_at: now() });
    publish('community', 'rooms', {});
    return { deactivated: !!v };
  });
  r.post('/api/admin/customers/:id/erase', async (ctx) => {
    const me = A.requireStaff(ctx);
    if (!A.isOwner(me)) fail(403, 'Only an owner can erase personal data.');
    limit('erase:' + me.id, 10, 60 * 60_000);
    const id = Number(ctx.params.id);
    const u = D.get('SELECT email FROM users WHERE id=?', id);
    if (!u) fail(404, 'Customer not found.');
    const b = await ctx.json();
    if (b.confirm !== 'ERASE' || clean(b.email, 200).toLowerCase() !== u.email) fail(400, "Type ERASE and the member's email to confirm.");
    erase(me, id);
    publish('community', 'rooms', {});
    return { ok: true };
  });
}

module.exports = { install, routes, get, on, publicFeatures, whatsNewFor, AREAS, DEFAULTS };
