'use strict';
const crypto = require('node:crypto');
const config = require('../config');
const D = require('../db');
const A = require('../auth');
const mailer = require('../mailer');
const pay = require('../payments');
const up = require('../uploads');
const apps = require('../applications');
const TOOLS = require('../tools');
const ART = require('../roomart');
const UGC = require('../ugc'); // reports, blocks and the app review sign-in
const { now, rid, sha256, safeEq, fail, limit, isEmail, clean, json, subscribe, publish, publishTicket, presence, streamCapReason } = require('../util');

/* ------------------------------ shared helpers ------------------------------ */
const PRODUCT_PUBLIC = (p) => ({
  id: p.id, slug: p.slug, name: p.name, stage: p.stage, status: p.status, tagline: p.tagline, description: p.description,
  url: p.url, icon: p.icon, color: p.color, tint: p.tint, offer: p.offer, external: !!p.external, sso: !!p.sso, sort: p.sort, hub: !!p.hub,
});
/** A product's launch path (Admin → Products → Launch path): one leading slash, on the tool's own site. Default /dashboard. */
const launchPath = (v) => {
  const s = String(v || '').trim();
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') && !/[\u0000-\u0020<>"'`\\]/.test(s) && s.length <= 200 ? s : '/dashboard';
};
const launchUrl = (p) => (p.sso && p.url ? p.url.replace(/\/+$/, '') + '/auth/voosquare?return_to=' + encodeURIComponent(launchPath(p.launch_path)).replace(/%2F/gi, '/') : p.url || '');

/** Spotlight slides for one placement. The setting is { slides, interval } (older saves are a plain array with one `placement` each). */
function activeAds(placement) {
  const t = now();
  const raw = D.getSetting('ads', []);
  const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.slides) ? raw.slides : []);
  const interval = Math.min(15, Math.max(3, Number(raw && raw.interval) || 6));
  const fix = (p) => (p === 'site' ? 'website' : p);
  const places = (a) => (Array.isArray(a.placements) && a.placements.length ? a.placements : [a.placement]).map(fix);
  return list.filter((a) => a && a.enabled && (!placement || places(a).includes(fix(placement))) && (!a.starts || a.starts <= t) && (!a.ends || a.ends >= t)).map((a) => ({ ...a, interval }));
}

function roomAccess(user, room) {
  if (!room || room.archived) return false;
  if (user && A.can(user, 'community')) return true;
  if (room.access === 'free') return true;
  if (!user) return false;
  if (room.access === 'premium') return user.premium;
  if (room.access === 'paid') { const ra = D.get('SELECT until FROM room_access WHERE user_id=? AND room_id=?', user.id, room.id); return !!(ra && ra.until > now()); }
  return false;
}
const canPost = (user, room) => roomAccess(user, room) && (!room.read_only || A.can(user, 'community'));
/** Images in a room: the room allows them (team always may), and the global "who can share images" policy lets this member. */
const canImage = (user, room) => !!user && canPost(user, room) && (room.images !== 0 || A.can(user, 'community')) && !up.chatBlockReason(user);

function roomPublic(r, user) {
  const unlocked = roomAccess(user, r);
  let unread = 0;
  if (user && unlocked) {
    const read = D.get('SELECT last_id FROM room_reads WHERE user_id=? AND room_id=?', user.id, r.id);
    unread = D.get(`SELECT COUNT(*) n FROM messages WHERE room_id=? AND id>? AND deleted=0 AND hidden=0 AND user_id<>? AND ${UGC.notBlockedSql('user_id')}`, r.id, read ? read.last_id : 0, user.id, user.id).n;
  }
  // Who has been talking lately (faces only for locked rooms) and, for members inside, the last message.
  // Logged-out visitors never get names or message text, even for free rooms (reading them needs a login too).
  const inside = unlocked && !!user;
  // Members someone blocked, and messages hidden for review, stay out of the previews (src/ugc.js).
  const viewer = user ? user.id : 0;
  const recent = D.all(`SELECT u.id, u.name, u.avatar, MAX(m.id) last FROM messages m JOIN users u ON u.id=m.user_id WHERE m.room_id=? AND m.deleted=0 AND m.id > (SELECT COALESCE(MAX(id),0)-400 FROM messages WHERE room_id=?) AND ${UGC.notBlockedSql('m.user_id')} GROUP BY m.user_id ORDER BY last DESC LIMIT 4`, r.id, r.id, viewer);
  const lastRow = inside ?D.get(`SELECT m.body, m.upload_id, m.created_at, m.user_id, u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.room_id=? AND m.deleted=0 AND m.hidden=0 AND ${UGC.notBlockedSql('m.user_id')} ORDER BY m.id DESC LIMIT 1`, r.id, viewer) : null;
  const art = ART.roomImages(r);
  return {
    id: r.id, slug: r.slug, name: r.name, topic: r.topic, description: r.description, icon: r.icon, color: r.color,
    image: art.image, cover: art.cover,
    faces: recent.map((x) => (inside ?{ id: x.id, name: x.name, avatar: json(x.avatar, {}) } : { avatar: json(x.avatar, {}) })),
    last: lastRow ? { name: lastRow.name, user_id: lastRow.user_id, body: String(lastRow.body || '').slice(0, 120), photo: !!lastRow.upload_id, at: lastRow.created_at } : null,
    access: r.access, price_usd: r.price_usd, period_days: r.period_days, read_only: !!r.read_only, slow_secs: r.slow_secs,
    unlocked, can_post: user ? canPost(user, r) : false, unread: Math.min(unread, 99), online: presence('room:' + r.id),
    images: r.images !== 0, can_image: canImage(user, r),
    ...apps.roomExtras(r, user),
  };
}

function messageRows(rows, user) {
  if (!rows.length) return [];
  const ids = rows.map((m) => m.id);
  const ph = ids.map(() => '?').join(',');
  const reacts = D.all(`SELECT message_id, emoji, COUNT(*) n, SUM(user_id=?) mine FROM reactions WHERE message_id IN (${ph}) GROUP BY message_id, emoji`, user ? user.id : 0, ...ids);
  const replyIds = [...new Set(rows.map((m) => m.reply_to).filter(Boolean))];
  const replies = replyIds.length ? D.all(`SELECT m.id, m.body, m.deleted, m.upload_id, m.user_id, m.hidden, u.name FROM messages m JOIN users u ON u.id=m.user_id WHERE m.id IN (${replyIds.map(() => '?').join(',')})`, ...replyIds) : [];
  // Safety (src/ugc.js): for members, a message they reported or one hidden for review shows as hidden, and quotes of
  // hidden messages or of members they blocked say so. The community team sees everything, with `in_review` marked.
  const mod = !!user && A.can(user, 'community');
  const mineReported = user && !mod ? UGC.reportedBy(user.id, [...ids, ...replyIds]) : new Set();
  const blocked = user ? new Set(UGC.blockedIds(user.id)) : new Set();
  const hiddenFor = (m) => (m.deleted || mod ? '' : mineReported.has(m.id) ? 'reported' : m.hidden ? 'review' : '');
  const files = up.lookup(rows.filter((m) => !m.deleted && !hiddenFor(m)).map((m) => m.upload_id));
  // Reply quotes say "Photo" for image messages (with the caption after it, if any).
  const quote = (r) => (r.deleted ? 'Message deleted' : hiddenFor(r) || blocked.has(r.user_id) ? 'Message hidden' : r.upload_id ? ('Photo' + (r.body ? ' · ' + r.body : '')).slice(0, 140) : r.body.slice(0, 140));
  return rows.map((m) => {
    const hid = hiddenFor(m);
    return {
      id: m.id, room_id: m.room_id, body: m.deleted || hid ? '' : m.body, deleted: !!m.deleted, pinned: !!m.pinned, created_at: m.created_at,
      attachment: m.deleted || hid ? null : files[m.upload_id] || null,
      reply: m.reply_to ? (() => { const r = replies.find((x) => x.id === m.reply_to); return r ? { id: r.id, name: r.name, body: quote(r), photo: !r.deleted && !hiddenFor(r) && !blocked.has(r.user_id) && !!r.upload_id } : null; })() : null,
      user: A.memberCard({ ...m, id: m.user_id }),
      reactions: hid ? [] : reacts.filter((r) => r.message_id === m.id).map((r) => ({ emoji: r.emoji, n: r.n, mine: !!r.mine })),
      ...(hid ? { hidden: hid } : {}),
      ...(mod && m.hidden && !m.deleted ? { in_review: true } : {}),
    };
  });
}
const MSG_SELECT = 'SELECT m.*, u.name, u.handle, u.avatar, u.premium_until, u.perms, u.role_title FROM messages m JOIN users u ON u.id=m.user_id';
const REACTIONS = ['🔥', '👍', '💰', '🚀', '😂', '👀', '🙏', '💯'];

/* summary cache for connected tools */
const summaryCache = new Map();
async function toolSummary(p, user) {
  if (!p.summary_url || !p.api_key) return null;
  const key = p.id + ':' + user.id;
  const hit = summaryCache.get(key);
  if (hit && hit.t > now() - 60_000) return hit.v;
  let v = null;
  try {
    const u = p.summary_url + (p.summary_url.includes('?') ? '&' : '?') + 'voo_id=' + encodeURIComponent(user.voo_id) + '&period=1d';
    // Admin-typed address: through the SSRF guard (public hosts only, resolved IP pinned, no redirects, capped reply).
    const r = await require('../netguard').guardedJson(u, { headers: { Authorization: 'Bearer ' + p.api_key }, timeoutMs: 1500, maxBytes: 64 * 1024 });
    if (r.ok && r.data && r.data.linked !== false) v = { status: r.data.status || 'active', metrics: Array.isArray(r.data.metrics) ? r.data.metrics.slice(0, 6) : [], open_url: r.data.open_url || '' };
  } catch { v = null; }
  summaryCache.set(key, { t: now(), v });
  return v;
}

/** Referral link, earnings and payouts for one member (see src/referrals.js). */
const referralStats = (u) => require('../referrals').memberStats(u, config.baseUrl);

function courseList(user) {
  const courses = D.all('SELECT * FROM courses WHERE published=1 ORDER BY sort, id');
  const lessons = D.all('SELECT id, course_id, minutes, premium FROM lessons WHERE published=1');
  const done = user ? new Set(D.all('SELECT lesson_id FROM progress WHERE user_id=?', user.id).map((r) => r.lesson_id)) : new Set();
  return courses.map((c) => {
    const ls = lessons.filter((l) => l.course_id === c.id);
    return {
      id: c.id, slug: c.slug, title: c.title, track: c.track, level: c.level, author_key: c.author_key, author_name: c.author_name, author_role: c.author_role,
      description: c.description, grad: c.grad, mark: c.mark, premium: !!c.premium, lessons: ls.length, minutes: ls.reduce((a, l) => a + (l.minutes || 0), 0),
      done: ls.filter((l) => done.has(l.id)).length, locked: !!c.premium && !(user && (user.premium || A.can(user, 'academy'))),
    };
  });
}

function postSummary(p) {
  return { id: p.id, slug: p.slug, title: p.title, category: p.category, author_key: p.author_key, author_name: p.author_name, author_role: p.author_role, excerpt: p.excerpt, minutes: p.minutes, grad: p.grad, mark: p.mark, premium: !!p.premium, featured: !!p.featured, created_at: p.created_at };
}

function ticketPublic(t) {
  const p = D.get('SELECT name, icon, color FROM products WHERE id=?', t.product_id);
  return { id: t.id, product_id: t.product_id, product: p, subject: t.subject, status: t.status, channel: t.channel, created_at: t.created_at, updated_at: t.updated_at, unread: t.customer_unread };
}

/* ------------------------------ routes ------------------------------ */
module.exports = function routes(r) {
  /* Railway's health check (railway.json). 200 only when the database answers and every migration this code knows is
   * applied; otherwise 503, so a broken deploy is never marked healthy. Keep `ok` and `time`: monitors read them. */
  r.get('/healthz', (ctx) => {
    let db = false; let version = 0;
    try { db = D.get('SELECT 1 ok').ok === 1; version = D.get('SELECT COALESCE(MAX(version),0) v FROM schema_migrations').v; } catch { /* reported below */ }
    const expected = require('../migrate').state.expected;
    const schema = { version, expected, ok: version >= expected };
    // Anyone gets { ok, time } (enough for Railway's check). The database and schema details only with the header
    // X-Health-Key: <HEALTH_KEY> or for a signed-in owner, so the exact migration version is not public (PT-4).
    const key = String(ctx.req.headers['x-health-key'] || '');
    const detail = (config.healthKey && safeEq(key, config.healthKey)) || A.isOwner(ctx.user);
    if (!db || !schema.ok) {
      if (!detail) fail(503, 'Not ready.', { ok: false, time: now() });
      fail(503, db ? 'Database migrations are not applied.' : 'The database does not answer.', { ok: false, time: now(), db: db ? 'ok' : 'down', schema });
    }
    return detail ? { ok: true, time: now(), db: 'ok', schema } : { ok: true, time: now() };
  });

  /* Public site data: everything the marketing site and app shell need. */
  r.get('/api/site', (ctx) => {
    const products = D.all('SELECT * FROM products WHERE visible=1 ORDER BY sort, id').map(PRODUCT_PUBLIC);
    const rooms = D.all('SELECT * FROM rooms WHERE archived=0 ORDER BY sort, id').map((x) => ({ id: x.id, name: x.name, topic: x.topic, icon: x.icon, color: x.color, access: x.access, price_usd: x.price_usd, period_days: x.period_days, description: x.description, approval_required: !!(x.approval_required && x.access === 'paid'), seats: x.access === 'paid' ? x.seats || 0 : 0, image: ART.roomImages(x).image }));
    const top = D.getSetting('top_card', {});
    return {
      brand: D.getSetting('brand', {}),
      top_card: top.enabled ? top : null,
      announcements: D.getSetting('announcements', []).filter((a) => a.enabled),
      ads: activeAds(null),
      products, rooms,
      premium: D.getSetting('premium', {}),
      free_plan: D.getSetting('free_plan', {}),
      community: D.getSetting('community', {}),
      calc_tools: TOOLS.publicList(D.getSetting('tools', null)),
      courses: courseList(ctx.user).slice(0, 12),
      posts: D.all('SELECT * FROM posts WHERE published=1 ORDER BY featured DESC, created_at DESC LIMIT 8').map(postSummary),
      counts: {
        lessons: D.get('SELECT COUNT(*) n FROM lessons WHERE published=1').n,
        rooms: rooms.length,
      },
      apps: ART.publicApps(),
      email_ready: mailer.configured(),
      academy_url: config.academyUrl, // VooSquare Academy's own website (src/academy.js)
    };
  });

  /* ---------------- auth: email + 6-digit code ---------------- */
  r.post('/api/auth/start', async (ctx) => {
    const b = await ctx.json();
    const email = clean(b.email, 200).toLowerCase();
    if (!isEmail(email)) fail(400, 'Enter a valid email address.');
    limit('code-ip:' + ctx.ip, 30, 15 * 60_000); // mobile carriers put many people behind one IP
    limit('code-email:' + email, mailer.configured() || config.prod || !config.devLoginCodes ? 5 : 100, 15 * 60_000);
    // The reply is the same whether or not the email has an account, and for suspended accounts too (PT-2): a suspended
    // member learns it from /api/auth/verify, after proving they own the inbox.
    const product = b.product ? D.get('SELECT id FROM products WHERE slug=?', String(b.product)) : null;
    const code = String(crypto.randomInt(100000, 1000000));
    D.run(`INSERT INTO login_codes(email,code_hash,expires,attempts,name,ref,product_id,created_at) VALUES(?,?,?,0,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash,expires=excluded.expires,attempts=0,name=excluded.name,ref=excluded.ref,product_id=excluded.product_id,created_at=excluded.created_at`,
    email, A.codeHash(email, code), now() + 10 * 60_000, clean(b.name, 60), clean(b.ref || ctx.cookies.vs_ref || '', 20), product ? product.id : null, now());
    // Affiliate coupon typed at sign-up (src/aff): kept with the code until the Voo ID is created.
    D.run('UPDATE login_codes SET aff_coupon=? WHERE email=?', clean(b.coupon || ctx.cookies.vs_coupon || '', 24), email);
    const user = D.get('SELECT * FROM users WHERE email=?', email);
    try {
      await mailer.sendNow(email, 'verify_code', { code, name: user ? user.name : clean(b.name, 60), firstName: (user ? user.name : clean(b.name, 60) || 'there').split(' ')[0] }, user);
    } catch (e) {
      console.error('[auth] email failed', e.message);
      if (mailer.configured()) fail(502, 'We could not send your code. Try again in a minute.');
    }
    // `existing` stays in the reply for older pages but is always false: it must not reveal whether the email has an
    // account. New-vs-returning is decided after the code (verify answers need_name / isNew).
    // dev_code only for tests and local development (config.devLoginCodes), never on a public address (CA-1).
    return { ok: true, existing: false, dev_code: config.devLoginCodes && !mailer.configured() ? code : undefined };
  });

  r.post('/api/auth/verify', async (ctx) => {
    const b = await ctx.json();
    const email = clean(b.email, 200).toLowerCase();
    const code = String(b.code || '').replace(/\D/g, '');
    limit('verify-ip:' + ctx.ip, 60, 15 * 60_000);
    limit('verify-email:' + email, 40, 24 * 3600_000);
    // App review account (src/ugc.js): store reviewers have no inbox, so a fixed code the owner set works for exactly
    // that email (never the owner or a team member). Normal codes keep working for it too.
    const review = UGC.reviewLoginOk(email, code);
    const row = D.get('SELECT * FROM login_codes WHERE email=?', email) || (review ? { name: 'App Review', ref: '', product_id: null } : null);
    if (!review) {
      if (!row || row.expires < now()) fail(400, 'That code has expired. Request a new one.');
      if (row.attempts >= 5) { D.run('DELETE FROM login_codes WHERE email=?', email); fail(400, 'Too many wrong tries. Request a new code.'); }
      if (!safeEq(row.code_hash, A.codeHash(email, code))) { D.run('UPDATE login_codes SET attempts=attempts+1 WHERE email=?', email); fail(400, 'That code is not right. Check the email and try again.'); }
    }
    if (review) row.name = 'App Review';
    // A name typed on the code step (the sign-in pages no longer know before the code whether the email is new, PT-2).
    const lateName = clean(b.name, 60);
    const existingRow = D.get('SELECT id FROM users WHERE email=?', email);
    // ask_name: the page can ask for a name. A new account with no name yet gets { need_name: true } and the code stays
    // valid, so the page shows a name field and sends the same code again with `name`. Only after a correct code.
    if (!existingRow && b.ask_name && clean(row.name, 60).length < 2 && lateName.length < 2) return { need_name: true };
    D.run('DELETE FROM login_codes WHERE email=?', email);
    let user = A.hydrate(D.get('SELECT * FROM users WHERE email=?', email));
    let isNew = false;
    if (!user) {
      user = A.createUser({ email, name: review ? 'App Review' : lateName.length >= 2 ? lateName : row.name, ref: row.ref, productId: row.product_id });
      isNew = true;
      mailer.startSequence(user);
      // Affiliate attribution is decided once, now, and locked for life (src/aff/tracking.js).
      require('../aff').onSignup(user, ctx, { coupon: clean(b.coupon || row.aff_coupon || '', 24) });
    } else if (user.deleted_at) fail(403, 'This account was deleted.');
    else if (user.banned) fail(403, 'This account is suspended. Contact support.');
    if (config.ownerEmail && email === config.ownerEmail && !user.perms.includes('*')) {
      D.run("UPDATE users SET perms='[\"*\"]', role_title=CASE WHEN role_title='' THEN 'Founder' ELSE role_title END WHERE id=?", user.id);
      user = A.hydrate(D.get('SELECT * FROM users WHERE id=?', user.id));
    }
    A.createSession(ctx, user.id);
    // Clear the referral cookie in both forms: host-only (/r/<code>) and parent-domain (affiliate links set it on .<root>).
    const T = require('../aff/tracking');
    if (ctx.cookies.vs_ref) { ctx.setCookie('vs_ref=; Path=/; Max-Age=0'); if (T.cookieDomain()) ctx.setCookie(T.cookie('vs_ref', '', 0, { httpOnly: false })); }
    // The 1-hour coupon cookie (?coupon= on a tracking link) has done its job at sign-up: clear it in both forms too.
    // A returning member keeps it, since the checkout can still apply it.
    if (isNew && ctx.cookies.vs_coupon) { ctx.setCookie(`vs_coupon=; Path=/; Max-Age=0; SameSite=Lax${config.secure ? '; Secure' : ''}`); if (T.cookieDomain()) ctx.setCookie(T.cookie('vs_coupon', '', 0, { httpOnly: false })); }
    return { user: A.publicUser(user), isNew };
  });

  r.post('/api/auth/logout', (ctx) => { A.destroySession(ctx); return { ok: true }; });

  /* ---------------- me ---------------- */
  r.get('/api/me', (ctx) => ({ user: A.publicUser(ctx.user) }));

  r.patch('/api/me', async (ctx) => {
    const u = A.requireUser(ctx);
    const b = await ctx.json();
    const patch = {};
    if (b.name !== undefined) { const n = clean(b.name, 60); if (n.length < 2) fail(400, 'Your name needs at least 2 characters.'); patch.name = n; }
    if (b.handle !== undefined) {
      const h = String(b.handle).toLowerCase().replace(/^@/, '');
      if (!/^[a-z0-9_]{3,20}$/.test(h)) fail(400, 'Handles use 3 to 20 letters, numbers or underscores.');
      const taken = D.get('SELECT id FROM users WHERE handle=? AND id<>?', h, u.id);
      if (taken) fail(400, 'That handle is taken.');
      patch.handle = h;
    }
    if (b.country !== undefined) patch.country = clean(b.country, 2).toUpperCase();
    if (b.bio !== undefined) patch.bio = clean(b.bio, 240);
    if (b.avatar && typeof b.avatar === 'object') {
      const a = {};
      for (const k of ['skin', 'hair', 'hairColor', 'shirt', 'bg', 'eyes', 'mouth', 'acc']) a[k] = Math.max(0, Math.min(20, Number(b.avatar[k]) || 0));
      patch.avatar = JSON.stringify(a);
    }
    if (b.marketing !== undefined) patch.marketing = b.marketing ? 1 : 0;
    if (b.onboarded !== undefined) patch.onboarded = b.onboarded ? 1 : 0;
    D.update('users', u.id, patch, Object.keys(patch));
    return { user: A.publicUser(A.hydrate(D.get('SELECT * FROM users WHERE id=?', u.id))) };
  });

  r.get('/api/me/home', async (ctx) => {
    const u = A.requireUser(ctx);
    const products = D.all('SELECT * FROM products WHERE visible=1 ORDER BY sort, id');
    const tools = await Promise.all(products.map(async (p) => ({ ...PRODUCT_PUBLIC(p), launch_url: launchUrl(p), summary: await toolSummary(p, u) })));
    const dayAgo = now() - 86400_000;
    const ev = D.all('SELECT type, COUNT(*) n, SUM(value_usd) v FROM events WHERE user_id=? AND created_at>? GROUP BY type', u.id, dayAgo);
    const activity = D.all('SELECT e.*, p.name product, p.icon, p.slug FROM events e LEFT JOIN products p ON p.id=e.product_id WHERE e.user_id=? ORDER BY e.id DESC LIMIT 20', u.id);
    const rooms = D.all('SELECT * FROM rooms WHERE archived=0 ORDER BY sort, id').map((x) => roomPublic(x, u));
    return {
      tools, today: ev, activity,
      courses: courseList(u),
      rooms: rooms.filter((x) => x.unlocked).sort((a, b) => b.unread - a.unread).slice(0, 5),
      unread_rooms: rooms.reduce((a, x) => a + x.unread, 0),
      open_tickets: D.get("SELECT COUNT(*) n FROM tickets WHERE user_id=? AND customer_unread=1", u.id).n,
      ads: activeAds('dashboard'),
      announcements: D.getSetting('announcements', []).filter((a) => a.enabled),
      updates: D.all('SELECT * FROM posts WHERE published=1 ORDER BY created_at DESC LIMIT 4').map(postSummary),
      calc_tools: TOOLS.publicList(D.getSetting('tools', null)),
      apps: ART.publicApps(),
    };
  });

  /* ---------------- free tools ----------------
   * The maths runs in the browser. Which tools are Premium is shown in the app (a member could still run the maths
   * locally, which is fine); saving scenarios is checked here. */
  const toolsPremiumOk = (u) => !!(u && (u.premium || A.isOwner(u)));
  r.get('/api/tools', (ctx) => {
    const u = A.requireUser(ctx);
    const s = TOOLS.cleanSetting(D.getSetting('tools', null));
    const p = D.getSetting('premium', {});
    return {
      tools: TOOLS.publicList(s), kill_scale: s.kill_scale, premium_ok: toolsPremiumOk(u),
      premium: { enabled: p.enabled !== false, price_usd: Number(p.price_usd) || 0, period_days: Number(p.period_days) || 30 },
      max_saves: TOOLS.MAX_SAVES,
    };
  });
  const savePublic = (x) => ({ id: x.id, tool: x.tool, name: x.name, data: json(x.data, {}), created_at: x.created_at });
  r.get('/api/tools/saves', (ctx) => {
    const u = A.requireUser(ctx);
    const tool = String(ctx.query.tool || '');
    const rows = TOOLS.KEYS.includes(tool)
      ? D.all('SELECT * FROM tool_saves WHERE user_id=? AND tool=? ORDER BY id DESC LIMIT 50', u.id, tool)
      : D.all('SELECT * FROM tool_saves WHERE user_id=? ORDER BY id DESC LIMIT 50', u.id);
    return { saves: rows.map(savePublic), total: D.get('SELECT COUNT(*) n FROM tool_saves WHERE user_id=?', u.id).n, max: TOOLS.MAX_SAVES };
  });
  r.post('/api/tools/saves', async (ctx) => {
    const u = A.requireUser(ctx);
    if (!toolsPremiumOk(u)) fail(403, 'Saving scenarios is part of Premium.', { premium: true });
    limit('tool-save:' + u.id, 30, 60_000);
    const v = TOOLS.cleanSave(await ctx.json());
    if (v.error) fail(400, v.error);
    if (D.get('SELECT COUNT(*) n FROM tool_saves WHERE user_id=?', u.id).n >= TOOLS.MAX_SAVES) fail(409, `You have ${TOOLS.MAX_SAVES} saved scenarios. Delete one to save another.`);
    const row = D.insert('tool_saves', { user_id: u.id, tool: v.tool, name: v.name, data: v.raw, created_at: now() });
    return { save: savePublic(D.get('SELECT * FROM tool_saves WHERE id=?', row.id)) };
  });
  r.del('/api/tools/saves/:id', (ctx) => {
    const u = A.requireUser(ctx);
    limit('tool-save:' + u.id, 30, 60_000);
    const row = D.get('SELECT id FROM tool_saves WHERE id=? AND user_id=?', Number(ctx.params.id), u.id);
    if (!row) fail(404, 'Saved scenario not found.');
    D.run('DELETE FROM tool_saves WHERE id=?', row.id);
    return { ok: true };
  });

  r.get('/api/me/activity', (ctx) => {
    const u = A.requireUser(ctx);
    return { activity: D.all('SELECT e.*, p.name product, p.icon, p.slug FROM events e LEFT JOIN products p ON p.id=e.product_id WHERE e.user_id=? ORDER BY e.id DESC LIMIT 60', u.id) };
  });
  // GET /api/me/referrals and the payout endpoints live in src/routes/referrals.js.
  r.get('/api/me/orders', (ctx) => (pay.expireStale(), {
    orders: D.all('SELECT o.*, m.name method_name FROM orders o LEFT JOIN payment_methods m ON m.id=o.method_id WHERE o.user_id=? ORDER BY o.id DESC LIMIT 50', A.requireUser(ctx).id)
      .map((o) => ({ ...pay.publicOrder(o), method: o.method_name || '' })),
  }));

  r.get('/api/members/:id', (ctx) => {
    A.requireUser(ctx);
    const m = D.get('SELECT * FROM users WHERE id=? AND banned=0 AND COALESCE(deleted_at,0)=0', Number(ctx.params.id));
    if (!m) fail(404, 'Member not found.');
    return { member: { ...A.memberCard(m), bio: m.bio, country: m.country, joined: m.created_at, xp: m.xp, messages: D.get('SELECT COUNT(*) n FROM messages WHERE user_id=? AND deleted=0', m.id).n, blocked: UGC.isBlocked(ctx.user.id, m.id) } };
  });

  /* ---------------- community ---------------- */
  r.get('/api/rooms', (ctx) => {
    apps.expireStale();
    const rooms = D.all('SELECT * FROM rooms WHERE archived=0 ORDER BY sort, id').map((x) => roomPublic(x, ctx.user));
    return { rooms, rules: D.getSetting('community', {}).rules || [], ads: activeAds('community') };
  });

  r.get('/api/rooms/:id/messages', (ctx) => {
    const u = A.requireUser(ctx);
    const room = D.get('SELECT * FROM rooms WHERE id=?', Number(ctx.params.id));
    if (!room || room.archived) fail(404, 'Room not found.');
    if (!roomAccess(u, room)) fail(403, 'This room is locked.', { locked: true, room: roomPublic(room, u) });
    const before = Number(ctx.query.before) || 9e15;
    // Members this member blocked are left out here, on the server (src/ugc.js).
    const rows = D.all(`${MSG_SELECT} WHERE m.room_id=? AND m.id<? AND ${UGC.notBlockedSql('m.user_id')} ORDER BY m.id DESC LIMIT 50`, room.id, before, u.id).reverse();
    const pinned = D.all(`${MSG_SELECT} WHERE m.room_id=? AND m.pinned=1 AND m.deleted=0 AND ${UGC.notBlockedSql('m.user_id')} ORDER BY m.id DESC LIMIT 3`, room.id, u.id);
    return { room: roomPublic(room, u), messages: messageRows(rows, u), pinned: messageRows(pinned, u).filter((m) => !m.hidden), reactions: REACTIONS, more: rows.length === 50 };
  });

  r.post('/api/rooms/:id/messages', async (ctx) => {
    const u = A.requireUser(ctx);
    const room = D.get('SELECT * FROM rooms WHERE id=?', Number(ctx.params.id));
    if (!room || room.archived) fail(404, 'Room not found.');
    if (!canPost(u, room)) fail(403, room.read_only ? 'Only the team posts in this room.' : 'This room is locked.');
    if (u.muted_until > now()) fail(403, 'You are muted for a while. Read the community rules.');
    const b = await ctx.json();
    const body = clean(b.body, 2000);
    if (!body && !b.upload_id) fail(400, 'Write a message first.');
    if (b.upload_id && !canImage(u, room)) fail(403, up.chatBlockReason(u) || 'Images are turned off in this room.');
    limit('msg:' + u.id, 8, 10_000);
    if (room.slow_secs && !A.can(u, 'community')) {
      const last = D.get('SELECT created_at FROM messages WHERE room_id=? AND user_id=? ORDER BY id DESC LIMIT 1', room.id, u.id);
      if (last && last.created_at > now() - room.slow_secs * 1000) fail(429, `Slow mode is on. You can post again in ${Math.ceil((last.created_at + room.slow_secs * 1000 - now()) / 1000)}s.`);
    }
    const replyTo = b.reply_to ? D.get('SELECT id FROM messages WHERE id=? AND room_id=?', Number(b.reply_to), room.id) : null;
    const m = D.tx(() => {
      const row = D.insert('messages', { room_id: room.id, user_id: u.id, body, reply_to: replyTo ? replyTo.id : null, created_at: now() });
      if (b.upload_id) { up.claim(b.upload_id, u, ['chat'], 'msg:' + row.id); D.run('UPDATE messages SET upload_id=? WHERE id=?', String(b.upload_id), row.id); }
      return row;
    });
    D.run('INSERT INTO room_reads(user_id,room_id,last_id) VALUES(?,?,?) ON CONFLICT(user_id,room_id) DO UPDATE SET last_id=excluded.last_id', u.id, room.id, m.id);
    const [msg] = messageRows([D.get(`${MSG_SELECT} WHERE m.id=?`, m.id)], null);
    UGC.publishMessage(room.id, msg); // everyone in the room except members who blocked the author
    publish('community', 'activity', { room_id: room.id, id: m.id });
    return { message: msg };
  });

  /* Invite-only rooms: apply, withdraw. Members only ever see their own application. */
  r.post('/api/rooms/:id/apply', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('apply:' + u.id, 12, 60 * 60_000);
    const room = D.get('SELECT * FROM rooms WHERE id=?', Number(ctx.params.id));
    if (!room || room.archived) fail(404, 'Room not found.');
    const b = await ctx.json();
    apps.apply(u, room, b.answers);
    return { room: roomPublic(D.get('SELECT * FROM rooms WHERE id=?', room.id), u) };
  });
  r.post('/api/rooms/:id/apply/withdraw', (ctx) => {
    const u = A.requireUser(ctx);
    limit('apply:' + u.id, 12, 60 * 60_000);
    const room = D.get('SELECT * FROM rooms WHERE id=?', Number(ctx.params.id));
    if (!room) fail(404, 'Room not found.');
    apps.withdraw(u, room);
    return { room: roomPublic(D.get('SELECT * FROM rooms WHERE id=?', room.id), u) };
  });

  r.post('/api/rooms/:id/read', async (ctx) => {
    const u = A.requireUser(ctx);
    const b = await ctx.json();
    D.run('INSERT INTO room_reads(user_id,room_id,last_id) VALUES(?,?,?) ON CONFLICT(user_id,room_id) DO UPDATE SET last_id=MAX(last_id,excluded.last_id)', u.id, Number(ctx.params.id), Number(b.last_id) || 0);
    return { ok: true };
  });

  r.del('/api/messages/:id', (ctx) => {
    const u = A.requireUser(ctx);
    const m = D.get('SELECT * FROM messages WHERE id=?', Number(ctx.params.id));
    if (!m) fail(404, 'Message not found.');
    if (m.user_id !== u.id && !A.can(u, 'community')) fail(403, 'You can only delete your own messages.');
    D.run('UPDATE messages SET deleted=1, pinned=0 WHERE id=?', m.id);
    up.softDelete(m.upload_id);
    if (m.user_id !== u.id) D.insert('audit', { user_id: u.id, action: 'message.delete', detail: `#${m.id} in room ${m.room_id}`, created_at: now() });
    publish('room:' + m.room_id, 'delete', { id: m.id });
    return { ok: true };
  });

  r.post('/api/messages/:id/react', async (ctx) => {
    const u = A.requireUser(ctx);
    const b = await ctx.json();
    if (!REACTIONS.includes(b.emoji)) fail(400, 'Pick one of the reactions.');
    const m = D.get('SELECT * FROM messages WHERE id=? AND deleted=0', Number(ctx.params.id));
    if (!m) fail(404, 'Message not found.');
    if (!roomAccess(u, D.get('SELECT * FROM rooms WHERE id=?', m.room_id))) fail(403, 'This room is locked.');
    limit('react:' + u.id, 30, 10_000);
    const has = D.get('SELECT 1 FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, u.id, b.emoji);
    if (has) D.run('DELETE FROM reactions WHERE message_id=? AND user_id=? AND emoji=?', m.id, u.id, b.emoji);
    else D.run('INSERT INTO reactions(message_id,user_id,emoji) VALUES(?,?,?)', m.id, u.id, b.emoji);
    const reactions = D.all('SELECT emoji, COUNT(*) n FROM reactions WHERE message_id=? GROUP BY emoji', m.id);
    publish('room:' + m.room_id, 'react', { id: m.id, reactions, by: u.id, emoji: b.emoji, added: !has });
    return { reactions };
  });

  r.post('/api/messages/:id/pin', (ctx) => {
    const u = A.requirePerm(ctx, 'community');
    const m = D.get('SELECT * FROM messages WHERE id=?', Number(ctx.params.id));
    if (!m) fail(404, 'Message not found.');
    D.run('UPDATE messages SET pinned=? WHERE id=?', m.pinned ? 0 : 1, m.id);
    D.insert('audit', { user_id: u.id, action: m.pinned ? 'message.unpin' : 'message.pin', detail: '#' + m.id, created_at: now() });
    publish('room:' + m.room_id, 'pin', { id: m.id, pinned: !m.pinned });
    return { pinned: !m.pinned };
  });

  /* ---------------- academy ---------------- */
  r.get('/api/courses', (ctx) => ({ courses: courseList(ctx.user), ads: activeAds('academy') }));

  r.get('/api/courses/:slug', (ctx) => {
    const c = D.get('SELECT * FROM courses WHERE slug=? AND published=1', ctx.params.slug);
    if (!c) fail(404, 'Course not found.');
    const u = ctx.user;
    const premiumOk = !!(u && (u.premium || A.can(u, 'academy')));
    const done = u ? new Set(D.all('SELECT lesson_id FROM progress WHERE user_id=?', u.id).map((x) => x.lesson_id)) : new Set();
    const lessons = D.all('SELECT * FROM lessons WHERE course_id=? AND published=1 ORDER BY idx, id', c.id).map((l) => {
      const locked = (c.premium || l.premium) && !premiumOk;
      return {
        id: l.id, idx: l.idx, title: l.title, minutes: l.minutes, premium: !!(c.premium || l.premium), locked, done: done.has(l.id),
        steps: locked ? [] : json(l.steps, []), step_count: json(l.steps, []).length,
        takeaways: locked ? [] : json(l.takeaways, []), action: locked ? '' : l.action, quiz: locked ? null : normQuiz(json(l.quiz, null)),
      };
    });
    return { course: { ...courseList(u).find((x) => x.id === c.id) }, lessons };
  });

  r.post('/api/lessons/:id/complete', (ctx) => {
    const u = A.requireUser(ctx);
    const l = D.get('SELECT l.*, c.premium cp FROM lessons l JOIN courses c ON c.id=l.course_id WHERE l.id=?', Number(ctx.params.id));
    if (!l) fail(404, 'Lesson not found.');
    if ((l.cp || l.premium) && !(u.premium || A.can(u, 'academy'))) fail(403, 'This lesson is part of Premium.');
    const had = D.get('SELECT 1 FROM progress WHERE user_id=? AND lesson_id=?', u.id, l.id);
    let gained = 0;
    if (!had) {
      D.run('INSERT INTO progress(user_id,lesson_id,done_at) VALUES(?,?,?)', u.id, l.id, now());
      gained = 50;
      const left = D.get('SELECT COUNT(*) n FROM lessons WHERE course_id=? AND published=1 AND id NOT IN (SELECT lesson_id FROM progress WHERE user_id=?)', l.course_id, u.id).n;
      if (left === 0) gained += 150;
      D.run('UPDATE users SET xp=xp+? WHERE id=?', gained, u.id);
    }
    return { gained, xp: D.get('SELECT xp FROM users WHERE id=?', u.id).xp, course_done: gained > 50 };
  });

  /* ---------------- blog ---------------- */
  r.get('/api/posts', (ctx) => {
    const cat = ctx.query.category;
    const rows = cat ? D.all('SELECT * FROM posts WHERE published=1 AND category=? ORDER BY featured DESC, created_at DESC', cat) : D.all('SELECT * FROM posts WHERE published=1 ORDER BY featured DESC, created_at DESC');
    return { posts: rows.map(postSummary), categories: D.all('SELECT DISTINCT category FROM posts WHERE published=1').map((x) => x.category) };
  });
  r.get('/api/posts/:slug', (ctx) => {
    const p = D.get('SELECT * FROM posts WHERE slug=? AND published=1', ctx.params.slug);
    if (!p) fail(404, 'Post not found.');
    const locked = p.premium && !(ctx.user && (ctx.user.premium || A.can(ctx.user, 'blog')));
    const more = D.all('SELECT * FROM posts WHERE published=1 AND id<>? ORDER BY created_at DESC LIMIT 3', p.id).map(postSummary);
    return { post: { ...postSummary(p), body: locked ? json(p.body, []).slice(0, 2) : json(p.body, []), locked }, more };
  });

  /* ---------------- billing ---------------- */
  const couponOk = (u, code) => { try { return !!require('../aff/tracking').couponFor(code, { country: u.country }); } catch { return false; } };
  r.get('/api/billing/methods', (ctx) => {
    const u = A.requireUser(ctx);
    // A method limited to some countries only shows to members in those countries (members with no country see everything).
    const fits = (m) => { const list = json(m.countries, []); return !list.length || !u.country || list.includes(u.country); };
    return {
      methods: D.all('SELECT * FROM payment_methods WHERE enabled=1 ORDER BY sort, id').filter(fits).map(pay.publicMethod),
      premium: D.getSetting('premium', {}),
      // This member's prices: today's, or the price they keep while their access is active (grandfathering).
      prices: { premium: pay.quote(u, 'premium'), rooms: pay.roomQuotes(u) },
    };
  });
  r.post('/api/billing/checkout', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('checkout:' + u.id, 10, 10 * 60_000);
    const b = await ctx.json();
    // A code that does not exist is refused before any order is made, so the member is never charged thinking it worked.
    const code = clean(b.coupon || '', 24);
    if (code && !couponOk(u, code)) fail(400, 'That code is not valid. Check it, or remove it to pay without a code.', { field: 'coupon' });
    const out = await pay.createCheckout(u, { item: b.item, room_id: Number(b.room_id) || null, method_id: Number(b.method_id) });
    if (code && out.order) require('../aff').onCheckoutCoupon(u, out.order.id, code);
    return out;
  });
  /* Check a code before paying ("Apply" in the checkout sheet). */
  r.post('/api/billing/coupon', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('coupon:' + u.id, 20, 10 * 60_000);
    const code = clean((await ctx.json()).coupon || '', 24);
    if (!code) fail(400, 'Type a code first.');
    if (!couponOk(u, code)) fail(400, 'That code is not valid. Check it, or remove it to pay without a code.', { field: 'coupon' });
    return { ok: true, code: code.toUpperCase() };
  });
  /* The member cancels an order they have not paid. Kept on the account as 'cancelled', never deleted. */
  r.post('/api/billing/orders/:ref/cancel', (ctx) => {
    const u = A.requireUser(ctx);
    const o = pay.cancelOrder(u, ctx.params.ref);
    publish('staff', 'order', { ref: o.ref, status: o.status });
    return { order: pay.publicOrder(o) };
  });
  r.get('/api/billing/orders/:ref', async (ctx) => {
    const u = A.requireUser(ctx);
    let o = D.get('SELECT * FROM orders WHERE ref=? AND user_id=?', ctx.params.ref, u.id);
    if (!o) fail(404, 'Order not found.');
    if (o.status === 'pending') {
      try { if (await pay.verifyWithProvider(o)) o = pay.fulfill(o.id, 'return check'); } catch (e) { console.error('[billing] verify', e.message); }
    }
    const m = D.get('SELECT * FROM payment_methods WHERE id=?', o.method_id);
    const payInfo = m && o.status === 'pending' ? pay.payInstructions(m, o.amount, o.currency) : null;
    return { order: pay.publicOrder(o), pay: payInfo, user: A.publicUser(A.hydrate(D.get('SELECT * FROM users WHERE id=?', u.id))) };
  });
  r.post('/api/billing/orders/:ref/proof', async (ctx) => {
    const u = A.requireUser(ctx);
    const o = D.get('SELECT * FROM orders WHERE ref=? AND user_id=?', ctx.params.ref, u.id);
    if (!o) fail(404, 'Order not found.');
    if (o.status === 'expired' || o.status === 'cancelled') fail(400, `This order ${o.status === 'expired' ? 'expired' : 'was cancelled'}. Start a new payment, or message support with order ${o.ref} if you already paid.`);
    if (o.status !== 'pending') fail(400, 'This order is already ' + o.status + '.');
    const b = await ctx.json();
    pay.submitProof(u, o, { proof: b.proof, upload_id: b.upload_id });
    mailer.queue(u, 'order_review', { item: o.item_name, ref: o.ref, amount: `${o.amount} ${o.currency}` });
    publish('staff', 'order', { ref: o.ref, status: 'review' });
    return { order: pay.publicOrder(D.get('SELECT * FROM orders WHERE id=?', o.id)) };
  });
  r.post('/api/billing/webhook/:id', async (ctx) => {
    const raw = await ctx.raw();
    return pay.webhook(Number(ctx.params.id), ctx.req.headers, raw);
  }, { noCsrf: true });

  /* ---------------- support (members) ---------------- */
  r.get('/api/support/products', () => ({ products: D.all('SELECT id, slug, name, icon, color FROM products WHERE visible=1 OR hub=1 ORDER BY hub DESC, sort') }));
  r.get('/api/support/tickets', (ctx) => {
    const u = A.requireUser(ctx);
    return { tickets: D.all('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC LIMIT 50', u.id).map(ticketPublic) };
  });
  r.post('/api/support/tickets', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('ticket:' + u.id, 6, 10 * 60_000);
    const b = await ctx.json();
    const product = D.get('SELECT * FROM products WHERE id=?', Number(b.product_id)) || D.get('SELECT * FROM products WHERE hub=1');
    const body = clean(b.body, 4000);
    if (!body) fail(400, 'Tell us what you need help with.');
    const t = D.tx(() => {
      const tk = D.insert('tickets', { product_id: product.id, user_id: u.id, email: u.email, name: u.name, subject: clean(b.subject, 140) || body.slice(0, 80), status: 'open', channel: 'voosquare', created_at: now(), updated_at: now(), staff_unread: 1 });
      const tm = D.insert('ticket_messages', { ticket_id: tk.id, author_type: 'customer', author_id: u.id, body, created_at: now() });
      if (b.upload_id) { up.claim(b.upload_id, u, ['support'], 'tmsg:' + tm.id); D.run('UPDATE ticket_messages SET upload_id=? WHERE id=?', String(b.upload_id), tm.id); }
      return tk;
    });
    publishTicket(product.id, { id: t.id, product_id: product.id, new: true });
    return { ticket: ticketPublic(D.get('SELECT * FROM tickets WHERE id=?', t.id)) };
  });
  r.get('/api/support/tickets/:id', (ctx) => {
    const u = A.requireUser(ctx);
    const t = D.get('SELECT * FROM tickets WHERE id=? AND user_id=?', Number(ctx.params.id), u.id);
    if (!t) fail(404, 'Conversation not found.');
    D.run('UPDATE tickets SET customer_unread=0 WHERE id=?', t.id);
    const rows = D.all('SELECT tm.*, u.name author_name, u.avatar author_avatar, u.role_title FROM ticket_messages tm LEFT JOIN users u ON u.id=tm.author_id WHERE ticket_id=? AND internal=0 ORDER BY tm.id', t.id);
    const files = up.lookup(rows.map((m) => m.upload_id));
    const msgs = rows.map((m) => ({ id: m.id, author_type: m.author_type, author_name: m.author_type === 'staff' ? (m.author_name || 'Support') : m.author_name, author_avatar: json(m.author_avatar, {}), body: m.body, attachment: files[m.upload_id] || null, created_at: m.created_at }));
    return { ticket: ticketPublic(t), messages: msgs };
  });
  r.post('/api/support/tickets/:id/messages', async (ctx) => {
    const u = A.requireUser(ctx);
    const t = D.get('SELECT * FROM tickets WHERE id=? AND user_id=?', Number(ctx.params.id), u.id);
    if (!t) fail(404, 'Conversation not found.');
    limit('tmsg:' + u.id, 10, 60_000);
    const b = await ctx.json();
    const body = clean(b.body, 4000);
    if (!body && !b.upload_id) fail(400, 'Write a message first.');
    const m = D.tx(() => {
      const row = D.insert('ticket_messages', { ticket_id: t.id, author_type: 'customer', author_id: u.id, body, created_at: now() });
      if (b.upload_id) { up.claim(b.upload_id, u, ['support'], 'tmsg:' + row.id); D.run('UPDATE ticket_messages SET upload_id=? WHERE id=?', String(b.upload_id), row.id); }
      return row;
    });
    D.run("UPDATE tickets SET status='open', staff_unread=1, updated_at=? WHERE id=?", now(), t.id);
    const msg = { id: m.id, author_type: 'customer', author_name: u.name, author_avatar: u.avatar, body, attachment: b.upload_id ? up.lookup([String(b.upload_id)])[String(b.upload_id)] : null, created_at: now() };
    publishTicket(t.product_id, { id: t.id, product_id: t.product_id });
    publish('ticket:' + t.id, 'message', msg);
    return { message: msg };
  });

  /* ---------------- live updates ---------------- */
  r.get('/api/stream', (ctx) => {
    const u = ctx.user;
    const want = String(ctx.query.ch || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 20);
    const ok = [...new Set(streamChannels(u, want))];
    const token = A.sessionToken(ctx);
    const sess = u && token ? sha256(token) : null;
    // Caps on open streams per address, per member and in total (PT-3). The page's EventSource retries on its own.
    const over = streamCapReason(ctx.ip, u ? u.id : null);
    if (over) fail(429, 'Too many live connections. Close some tabs and try again.', { stream_cap: over });
    ctx.res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    ctx.res.write(`event: ready\ndata: ${JSON.stringify({ channels: ok })}\n\n`);
    // Signed-in streams are re-checked regularly: an expired or revoked session, a ban, or lost access to a room or a
    // staff channel closes the stream (the browser reconnects and gets only what it may still see).
    const check = sess ? () => {
      const row = D.get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?', sess, now());
      if (!row || row.banned) return false;
      const still = new Set(streamChannels(A.hydrate(row), want));
      return ok.every((ch) => still.has(ch));
    } : null;
    subscribe(ctx.res, ok, { uid: u ? u.id : null, sess, check, ip: ctx.ip });
    ctx.handled = true;
  });
};

/** The live channels a viewer may open, from the ones asked for. Logged-out visitors get `community` only. */
function streamChannels(u, want) {
  const ok = ['community'];
  if (u) ok.push('user:' + u.id);
  for (const ch of want) {
    const [kind, idStr] = ch.split(':');
    const id = Number(idStr);
    if (kind === 'room' && u) { const room = D.get('SELECT * FROM rooms WHERE id=?', id); if (roomAccess(u, room)) ok.push(ch); }
    else if (kind === 'ticket' && u) { const t = D.get('SELECT user_id, product_id FROM tickets WHERE id=?', id); if (t && (t.user_id === u.id || (A.can(u, 'support') && supportScopeOk(u, t.product_id)))) ok.push(ch); }
    else if (ch === 'staff' && u && u.staff) {
      if (A.can(u, 'payments')) ok.push('staff');
      if (A.can(u, 'community')) ok.push('staff:community');
      if (A.can(u, 'support')) for (const p of D.all('SELECT id FROM products')) if (supportScopeOk(u, p.id)) ok.push('staff:p' + p.id);
    }
  }
  return ok;
}

function normQuiz(q) {
  if (!q || !q.q) return null;
  return { q: q.q, options: q.options || [], answer: Number(q.answer) || 0, why: q.why || q.explain || q.explanation || '' };
}

function supportScopeOk(u, productId) {
  if (u.perms.includes('*')) return true;
  const s = u.support_scope || [];
  return s.includes('*') || s.includes(productId) || s.includes(String(productId));
}

module.exports.helpers = { roomAccess, roomPublic, messageRows, MSG_SELECT, PRODUCT_PUBLIC, launchUrl, launchPath, courseList, postSummary, supportScopeOk, referralStats, activeAds };
