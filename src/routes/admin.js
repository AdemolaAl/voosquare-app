'use strict';
const config = require('../config');
const D = require('../db');
const A = require('../auth');
const mailer = require('../mailer');
const pay = require('../payments');
const up = require('../uploads');
const seed = require('../seed');
const apps = require('../applications');
const TOOLS = require('../tools');
const REV = require('../revenue');
const ART = require('../roomart');
const REF = require('../referrals');
const TRASH = require('../trash'); // deletes go through the recycle bin (deleted_rows)
const { now, rid, fail, clean, json, slugify, publish, publishTicket, mask, isEmail, bool, safeUrl, httpUrl, safeColor, limit } = require('../util');
const { guardedJson, urlProblem } = require('../netguard');

/** Links in emails must be absolute and safe: relative paths get the site address, javascript: and the like are dropped. */
function emailLink(u) {
  u = safeUrl(u, 300);
  if (!u) return '';
  if (u.startsWith('#')) return config.baseUrl + '/app' + u;
  return u.startsWith('/') ? config.baseUrl + u : u;
}

/** Settings saved from the admin: strip unsafe links (javascript:, data:) before they reach the site, app or emails. */
function sanitizeSetting(key, value) {
  const link = (x, k) => { if (x && typeof x === 'object' && k in x) x[k] = safeUrl(x[k]); };
  if (key === 'top_card' && value && typeof value === 'object') { value = { ...value }; link(value, 'cta_url'); }
  if (key === 'announcements') value = value.map((x) => { x = { ...x }; link(x, 'url'); link(x, 'cta_url'); link(x, 'image'); return x; });
  return value;
}

/** Spotlight slides: { slides, interval }. Accepts the older plain array of ads. Links are http(s) or same-site only, colours hex only, text capped. */
const AD_THEMES = ['join', 'spy', 'adv', 'reply', 'cast', 'land', 'affleego', 'gate', 'brand', 'premium', 'lime', 'custom'];
const AD_THEME_ALIAS = { dark: 'gate', gold: 'reply', night: 'premium', light: 'brand' };
const AD_PLACES = ['dashboard', 'academy', 'community', 'website'];
const AD_SCENES = ['auto', 'stat', 'chat', 'checkout', 'creative', 'feed'];
function cleanAds(value) {
  const src = Array.isArray(value) ? { slides: value } : (value && typeof value === 'object' ? value : {});
  const link = (u) => { u = safeUrl(u, 400); return /^(https?:\/\/|\/(?!\/)|#)/i.test(u) ? u : ''; };
  const hex = (c, def) => (/^#[0-9a-f]{6}$/i.test(String(c || '').trim()) ? String(c).trim() : def);
  const iconKey = (v) => { v = clean(v, 300); if (/^[a-z0-9_-]{1,40}$/i.test(v)) return v; if (/^\/(?!\/)[\w\-./]+$/.test(v)) return v; return /^https:\/\//i.test(v) ? httpUrl(v, 300) : ''; };
  const slides = (Array.isArray(src.slides) ? src.slides : []).filter((x) => x && typeof x === 'object').slice(0, 12).map((x) => {
    let theme = AD_THEME_ALIAS[x.theme] || x.theme;
    if (!AD_THEMES.includes(theme)) theme = 'brand';
    let places = Array.isArray(x.placements) ? x.placements : (x.placement ? [x.placement] : []);
    places = [...new Set(places.map((p) => (p === 'site' ? 'website' : p)).filter((p) => AD_PLACES.includes(p)))];
    const chips = (Array.isArray(x.chips) ? x.chips : String(x.chips || '').split('\n')).map((c) => clean(c, 40)).filter(Boolean).slice(0, 3);
    const image = httpUrl(x.image, 400);
    return {
      id: /^[\w-]{1,24}$/.test(String(x.id || '')) ? String(x.id) : rid(4), enabled: !!bool(x.enabled, 1), placements: places.length ? places : ['dashboard'],
      theme, c1: hex(x.c1, '#00A86B'), c2: hex(x.c2, '#0A1A13'), product: clean(x.product, 60), icon: iconKey(x.icon), brand: clean(x.brand, 24),
      kicker: clean(x.kicker, 48) || 'Sponsored by Zedapex', title: clean(x.title, 90), body: clean(x.body, 220), cta_text: clean(x.cta_text, 32), cta_url: link(x.cta_url),
      scene: AD_SCENES.includes(x.scene) ? x.scene : 'auto', stat_label: clean(x.stat_label, 32), stat_value: clean(x.stat_value, 14), example: x.example !== false && x.example !== 0, chips,
      image: /^https:/i.test(image) ? image : '', starts: Math.max(0, Number(x.starts) || 0), ends: Math.max(0, Number(x.ends) || 0),
    };
  }).filter((x) => x.title || x.body);
  return { slides, interval: Math.min(15, Math.max(3, Math.round(Number(src.interval) || 6))) };
}
const { supportScopeOk, messageRows, MSG_SELECT } = require('./app').helpers;

/** scheme://host:port of an address ('' when empty or not a URL): "the same endpoint host" for secret-carrying URLs. */
const originOf = (u) => { try { return u ? new URL(String(u)).origin.toLowerCase() : ''; } catch { return String(u || '').toLowerCase(); } };
const audit = (u, action, detail = '') => D.insert('audit', { user_id: u.id, action, detail: String(detail).slice(0, 500), created_at: now() });

/* Payment providers: the addresses that receive a method's stored secrets (API key, auth header). Moving one to a new host
 * (scheme://host:port) would send the saved secret there, so it needs an owner, the secrets typed again, and an audit line. */
const PM_ENDPOINTS = ['api_base', 'create_url', 'verify_url'];
function guardEndpointChange(me, old, type, incoming, cfg, action) {
  if (!old || old.type !== type) return; // a new method, or a new type, starts with no stored secrets
  const oc = pay.normalizeConfig(old.type, json(old.config, {}));
  const stored = ((pay.TYPES[type] && pay.TYPES[type].secrets) || []).filter((k) => oc[k]);
  if (!stored.length) return;
  const known = new Set(PM_ENDPOINTS.map((k) => originOf(oc[k])).filter(Boolean));
  const moved = PM_ENDPOINTS.filter((k) => cfg[k] && !known.has(originOf(cfg[k])));
  if (!moved.length) return;
  if (!A.isOwner(me)) fail(403, 'Only an owner can point a payment method at a new address (its saved secrets would go there).');
  const typed = (k) => incoming && typeof incoming[k] === 'string' && incoming[k].trim() && !incoming[k].startsWith('••••');
  const missing = stored.filter((k) => !typed(k));
  if (missing.length) fail(400, `The address moved to a new host. Type the ${missing.join(' and ')} again: saved secrets are never sent to a new address.`, { reenter: missing });
  audit(me, action, `${old.name}: ${moved.map((k) => `${k} ${[...known].join(',') || '(none)'} → ${originOf(cfg[k])}`).join('; ')}`);
}
const DAY = 86400_000;

/* Email templates only an owner may edit: they carry a secret that signs the reader in. */
const OWNER_TEMPLATES = ['verify_code'];
/* Settings only an owner may change (CA-3). `email` decides which provider account receives every login code (the
 * owner's too), so a delegated admin swapping the API key for their own account could read the owner's code. */
const OWNER_SETTINGS = ['email'];

/* Which settings keys each permission may edit. */
const SETTING_PERMS = {
  top_card: 'content', announcements: 'content', ads: 'content',
  premium: 'settings', free_plan: 'settings', referrals: 'settings', community: 'community', brand: 'settings', email: 'settings',
  images: 'community', tools: 'content', reporting_tz: 'settings', apps: 'content',
  grandfathering: 'settings', // { enabled, grace_days }: paying members keep their price (src/payments.js)
  billing: 'payments', // { pending_expire_days }: unpaid transfer and crypto orders turn 'expired' after this many days (src/payments.js)
};

function scopeSql(u) {
  if (u.perms.includes('*')) return { sql: '1=1', args: [] };
  const s = (u.support_scope || []).map(Number).filter(Boolean);
  if ((u.support_scope || []).includes('*')) return { sql: '1=1', args: [] };
  if (!s.length) return { sql: '1=0', args: [] };
  return { sql: `t.product_id IN (${s.map(() => '?').join(',')})`, args: s };
}

function productAdmin(p, reveal) {
  return {
    ...p, redirect_uris: json(p.redirect_uris, []),
    client_secret: reveal ? p.client_secret : mask(p.client_secret), api_key: reveal ? p.api_key : mask(p.api_key),
    endpoints: {
      authorize: `${config.baseUrl}/oauth/authorize`, token: `${config.baseUrl}/oauth/token`, userinfo: `${config.baseUrl}/oauth/userinfo`,
      logout: `${config.baseUrl}/oauth/logout`, events: `${config.baseUrl}/api/v1/events`, support: `${config.baseUrl}/api/v1/support/messages`,
      widget: `<script src="${config.baseUrl}/widget.js" data-product="${p.slug}" defer></script>`,
    },
  };
}

function customerRow(u) {
  return {
    id: u.id, voo_id: u.voo_id, email: u.email, name: u.name, handle: u.handle, country: u.country, avatar: json(u.avatar, {}),
    premium: (u.premium_until || 0) > now(), premium_until: u.premium_until, banned: !!u.banned, muted_until: u.muted_until,
    staff: json(u.perms, []).length > 0, perms: json(u.perms, []), xp: u.xp, created_at: u.created_at, last_seen: u.last_seen, marketing: !!u.marketing,
    deactivated: !!u.deactivated, erased: !!u.erased_at, deleted: !!u.deleted_at, deleted_at: u.deleted_at || 0,
  };
}

async function staffReply(staff, ticket, body, internal, uploadId) {
  const m = D.tx(() => {
    const row = D.insert('ticket_messages', { ticket_id: ticket.id, author_type: 'staff', author_id: staff.id, body, internal: internal ? 1 : 0, created_at: now() });
    if (uploadId) { up.claim(uploadId, staff, ['support'], 'tmsg:' + row.id); D.run('UPDATE ticket_messages SET upload_id=? WHERE id=?', String(uploadId), row.id); }
    return row;
  });
  const attachment = uploadId ? up.lookup([String(uploadId)])[String(uploadId)] : null;
  if (!internal) {
    D.run("UPDATE tickets SET status=CASE WHEN status='closed' THEN 'closed' ELSE 'pending' END, customer_unread=1, staff_unread=0, updated_at=?, assignee_id=COALESCE(assignee_id,?) WHERE id=?", now(), staff.id, ticket.id);
    const msg = { id: m.id, author_type: 'staff', author_name: staff.name.split(' ')[0], author_avatar: staff.avatar, body, attachment, created_at: now() };
    // Emails never carry the image itself: they say one was sent and link to the conversation.
    if (attachment) {
      const note = `${staff.name.split(' ')[0]} sent you an image. View it in VooSquare.`;
      body = body ? `${body}\n\n${note}` : note;
    }
    publish('ticket:' + ticket.id, 'message', msg);
    if (ticket.user_id) publish('user:' + ticket.user_id, 'support', { ticket_id: ticket.id });
    const product = D.get('SELECT * FROM products WHERE id=?', ticket.product_id);
    if (ticket.email) {
      const user = ticket.user_id ? D.get('SELECT * FROM users WHERE id=?', ticket.user_id) : null;
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      mailer.queue(user, 'support_reply', {
        name: ticket.name || (user && user.name) || '', firstName: (ticket.name || (user && user.name) || 'there').split(' ')[0],
        subject: ticket.subject, reply: body, reply_html: esc(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join(''),
        agent: staff.name.split(' ')[0], product: product ? product.name : 'VooSquare', ticket_url: ticket.user_id ? `${config.baseUrl}/app#support:${ticket.id}` : (product && product.url) || config.baseUrl,
      }, now(), ticket.email);
    }
    if (product && product.support_webhook) {
      // Admin-typed address: sent through the SSRF guard (public hosts only, resolved IP checked and pinned, no redirects,
      // 5 s timeout, capped reply), the same path as affiliate postbacks. Failures are logged without the URL or key.
      guardedJson(product.support_webhook, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + product.api_key }, body: JSON.stringify({ type: 'support.reply', ticket_id: ticket.id, external_ref: ticket.external_ref, email: ticket.email, body, agent: staff.name.split(' ')[0], created_at: now() }), timeoutMs: 5000, maxBytes: 16 * 1024 })
        .catch((e) => console.warn(`[support webhook] ${product.slug}: ${e.message}`));
    }
  } else {
    D.run('UPDATE tickets SET updated_at=? WHERE id=?', now(), ticket.id);
  }
  publishTicket(ticket.product_id, { id: ticket.id, product_id: ticket.product_id });
  return m.id;
}

module.exports = function routes(r) {
  /* ---------------- who am I / overview ---------------- */
  r.get('/api/admin/me', (ctx) => {
    const u = A.requireStaff(ctx);
    return { user: A.publicUser(u), perms: A.PERMS, products: D.all('SELECT id, slug, name, icon, color FROM products ORDER BY hub DESC, sort') };
  });

  r.get('/api/admin/overview', (ctx) => {
    const me = A.requireStaff(ctx);
    const money = A.can(me, 'payments') || A.can(me, 'settings');
    const people = A.can(me, 'customers') || A.can(me, 'support');
    const t = now();
    const signups = D.all('SELECT created_at FROM users WHERE created_at>?', t - 30 * DAY);
    const series = Array.from({ length: 30 }, (_, i) => { const start = t - (30 - i) * DAY; return signups.filter((s) => s.created_at >= start && s.created_at < start + DAY).length; });
    // Last 30 days in the reporting time zone: VooSquare sales plus spend reported by tools (see src/revenue.js).
    const rev = money ? REV.lastDays(30) : null;
    return {
      members: D.get('SELECT COUNT(*) n FROM users').n,
      new_today: D.get('SELECT COUNT(*) n FROM users WHERE created_at>?', t - DAY).n,
      new_week: D.get('SELECT COUNT(*) n FROM users WHERE created_at>?', t - 7 * DAY).n,
      active_week: D.get('SELECT COUNT(*) n FROM users WHERE last_seen>?', t - 7 * DAY).n,
      premium: D.get('SELECT COUNT(*) n FROM users WHERE premium_until>?', t).n,
      revenue_30d: money ? rev.total : null, revenue_prev_30d: money ? rev.prev : null, revenue_change_pct: money ? rev.change_pct : null,
      open_tickets: D.get("SELECT COUNT(*) n FROM tickets WHERE status='open'").n,
      orders_review: money ? D.get("SELECT COUNT(*) n FROM orders WHERE status='review'").n : null,
      messages_today: D.get('SELECT COUNT(*) n FROM messages WHERE created_at>?', t - DAY).n,
      lessons_done_week: D.get('SELECT COUNT(*) n FROM progress WHERE done_at>?', t - 7 * DAY).n,
      emails_queued: D.get("SELECT COUNT(*) n FROM email_queue WHERE status='queued'").n,
      email_ready: mailer.configured(),
      signups_series: series, revenue_series: money ? rev.series : null, reporting_tz: money ? rev.tz : null,
      recent_members: people ? D.all('SELECT * FROM users ORDER BY id DESC LIMIT 6').map(customerRow) : [],
      recent_orders: money ? D.all("SELECT o.*, u.name, u.email FROM orders o JOIN users u ON u.id=o.user_id ORDER BY o.id DESC LIMIT 6") : [],
      by_product: D.all("SELECT p.name, p.icon, COUNT(t.id) n FROM products p LEFT JOIN tickets t ON t.product_id=p.id AND t.status='open' GROUP BY p.id ORDER BY n DESC"),
    };
  });

  /* ---------------- customers ---------------- */
  r.get('/api/admin/customers', (ctx) => {
    A.requireStaff(ctx);
    const me = ctx.user;
    if (!A.can(me, 'customers') && !A.can(me, 'support')) fail(403, 'No access to customers.');
    const q = clean(ctx.query.q, 100).toLowerCase();
    const f = ctx.query.filter || 'all';
    const page = Math.max(0, Number(ctx.query.page) || 0);
    // Money (lifetime spend, the Paying filter and sorting by it) only for finance and settings.
    const money = REV.moneyPerm(A, me);
    const where = ['1=1']; const args = [];
    if (q) { where.push('(lower(email) LIKE ? OR lower(name) LIKE ? OR handle LIKE ? OR voo_id=?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`, q); }
    if (f === 'premium') { where.push('premium_until>?'); args.push(now()); }
    if (f === 'free') { where.push('premium_until<=?'); args.push(now()); }
    if (f === 'staff') where.push("perms<>'[]'");
    if (f === 'banned') where.push('banned=1');
    if (f === 'new') { where.push('created_at>?'); args.push(now() - 7 * DAY); }
    if (f === 'paying' && money) where.push(`${REV.SPENT_COL}>0`);
    const sort = money && ctx.query.sort === 'spent' ? 'spent' : 'new';
    const from = money ? `users ${REV.SPENT_JOIN}` : 'users';
    const total = D.get(`SELECT COUNT(*) n FROM ${from} WHERE ${where.join(' AND ')}`, ...args).n;
    const rows = D.all(`SELECT users.*${money ? `, ${REV.SPENT_COL} spent` : ''} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY ${sort === 'spent' ? 'spent DESC, users.id DESC' : 'users.id DESC'} LIMIT 40 OFFSET ?`, ...args, page * 40);
    return { total, page, sort, money, customers: rows.map((u) => (money ? { ...customerRow(u), spent: u.spent || 0 } : customerRow(u))) };
  });

  r.get('/api/admin/customers/:id', (ctx) => {
    A.requireStaff(ctx);
    if (!A.can(ctx.user, 'customers') && !A.can(ctx.user, 'support')) fail(403, 'No access to customers.');
    const u = D.get('SELECT * FROM users WHERE id=?', Number(ctx.params.id));
    if (!u) fail(404, 'Customer not found.');
    if (!A.can(ctx.user, 'customers')) {
      const sc = scopeSql(ctx.user);
      if (!D.get(`SELECT 1 FROM tickets t WHERE (t.user_id=? OR t.email=?) AND ${sc.sql} LIMIT 1`, u.id, u.email, ...sc.args)) fail(403, 'You can only open customers who contacted your products.');
    }
    const ref = u.referred_by ? D.get('SELECT id, name, email FROM users WHERE id=?', u.referred_by) : null;
    // A support agent without the customers permission sees only the conversations of products in their support scope.
    // (A visitor can type anyone's email into a product's widget, so one in-scope ticket must not open the others.)
    const tsc = A.can(ctx.user, 'customers') ? { sql: '1=1', args: [] } : scopeSql(ctx.user);
    return {
      customer: { ...customerRow(u), bio: u.bio, ref_code: u.ref_code, referred_by: ref, support_scope: json(u.support_scope, []), role_title: u.role_title, onboarded: !!u.onboarded },
      orders: D.all('SELECT * FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 20', u.id),
      tickets: D.all(`SELECT t.*, p.name product FROM tickets t LEFT JOIN products p ON p.id=t.product_id WHERE (t.user_id=? OR t.email=?) AND ${tsc.sql} ORDER BY t.updated_at DESC LIMIT 20`, u.id, u.email, ...tsc.args).map((t) => ({ ...t, visitor_token: undefined })),
      rooms: D.all('SELECT r.name, ra.until FROM room_access ra JOIN rooms r ON r.id=ra.room_id WHERE ra.user_id=?', u.id),
      // Lessons done: classic Academy lessons plus VooSquare Academy lessons passed (or marked passed), so the header matches the
      // VooSquare Academy card on the same page. The split is kept for anyone who needs it.
      ...(() => { const academy = D.get('SELECT COUNT(*) n FROM progress WHERE user_id=?', u.id).n; const school = D.get('SELECT COUNT(*) n FROM school_progress WHERE user_id=? AND (passed_at IS NOT NULL OR granted=1)', u.id).n; return { progress: academy + school, progress_split: { academy, school } }; })(),
      messages: D.get('SELECT COUNT(*) n FROM messages WHERE user_id=? AND deleted=0', u.id).n,
      referrals: D.get('SELECT COUNT(*) n FROM users WHERE referred_by=?', u.id).n,
      events: D.all('SELECT e.*, p.name product FROM events e LEFT JOIN products p ON p.id=e.product_id WHERE e.user_id=? ORDER BY e.id DESC LIMIT 10', u.id),
      emails: D.all('SELECT template, status, sent_at, send_at FROM email_queue WHERE user_id=? ORDER BY id DESC LIMIT 15', u.id),
      // Answers are private: only the community team (and owners) read them.
      applications: A.can(ctx.user, 'community') ? apps.adminRows('a.user_id=?', [u.id], 20) : null,
    };
  });

  r.patch('/api/admin/customers/:id', async (ctx) => {
    const me = A.requirePerm(ctx, 'customers');
    const id = Number(ctx.params.id);
    const u = D.get('SELECT * FROM users WHERE id=?', id);
    if (!u) fail(404, 'Customer not found.');
    const b = await ctx.json();
    const patch = {};
    if (json(u.perms, []).includes('*') && !A.isOwner(me) && (b.name !== undefined || b.mute_hours !== undefined)) fail(403, 'Only an owner can change an owner.');
    if (b.name !== undefined) { const n = clean(b.name, 60); if (n.length < 2) fail(400, 'Names need at least 2 characters.'); patch.name = n; }
    if (b.banned !== undefined) {
      if (json(u.perms, []).includes('*')) fail(400, 'You cannot ban the owner.');
      patch.banned = b.banned ? 1 : 0;
      if (b.banned) A.revokeUser(id, 'banned'); // sessions end and open live streams close now
    }
    if (b.mute_hours !== undefined) patch.muted_until = Number(b.mute_hours) > 0 ? now() + Number(b.mute_hours) * 3600_000 : 0;
    if (b.premium_days !== undefined) {
      const days = Number(b.premium_days);
      patch.premium_until = days > 0 ? Math.max(now(), u.premium_until || 0) + days * DAY : 0;
    }
    if (b.marketing !== undefined) patch.marketing = b.marketing ? 1 : 0;
    D.update('users', id, patch, Object.keys(patch));
    if (b.grant_room) {
      const room = D.get('SELECT * FROM rooms WHERE id=?', Number(b.grant_room));
      if (room) {
        D.run('INSERT INTO room_access(user_id,room_id,until) VALUES(?,?,?) ON CONFLICT(user_id,room_id) DO UPDATE SET until=excluded.until', id, room.id, room.period_days ? now() + room.period_days * DAY : 9e15);
        apps.closeOnGrant(me, id, room.id); // a direct grant is the invite
        publish('user:' + id, 'application', { room_id: room.id, room: room.name, status: 'granted' });
      }
    }
    audit(me, 'customer.update', `${u.email}: ${JSON.stringify(b).slice(0, 200)}`);
    return { customer: customerRow(D.get('SELECT * FROM users WHERE id=?', id)) };
  });

  r.post('/api/admin/customers/:id/email', async (ctx) => {
    const me = A.requirePerm(ctx, 'customers');
    const u = D.get('SELECT * FROM users WHERE id=?', Number(ctx.params.id));
    if (!u) fail(404, 'Customer not found.');
    const b = await ctx.json();
    const body = clean(b.body, 6000);
    if (!clean(b.subject, 140) || !body) fail(400, 'Add a subject and a message.');
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    mailer.queue(u, 'announcement', { subject: clean(b.subject, 140), title: clean(b.title || b.subject, 140), body, body_html: esc(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join(''), cta_text: clean(b.cta_text, 40) || 'Open VooSquare', cta_url: emailLink(b.cta_url) || config.baseUrl + '/app' });
    audit(me, 'customer.email', u.email);
    return { ok: true };
  });

  /* ---------------- support inbox ---------------- */
  r.get('/api/admin/tickets', (ctx) => {
    const me = A.requirePerm(ctx, 'support');
    const sc = scopeSql(me);
    const where = [sc.sql]; const args = [...sc.args];
    const st = ctx.query.status || 'open';
    if (st !== 'all') { where.push('t.status=?'); args.push(st); }
    if (ctx.query.product) { where.push('t.product_id=?'); args.push(Number(ctx.query.product)); }
    if (ctx.query.assignee === 'me') { where.push('t.assignee_id=?'); args.push(me.id); }
    if (ctx.query.assignee === 'none') where.push('t.assignee_id IS NULL');
    if (ctx.query.q) { const q = '%' + clean(ctx.query.q, 80).toLowerCase() + '%'; where.push('(lower(t.subject) LIKE ? OR lower(t.email) LIKE ? OR lower(t.name) LIKE ?)'); args.push(q, q, q); }
    const rows = D.all(`SELECT t.*, p.name product_name, p.icon product_icon, p.color product_color, a.name assignee_name,
      (SELECT body FROM ticket_messages WHERE ticket_id=t.id AND internal=0 ORDER BY id DESC LIMIT 1) last_body,
      (SELECT author_type FROM ticket_messages WHERE ticket_id=t.id AND internal=0 ORDER BY id DESC LIMIT 1) last_author,
      u.avatar user_avatar
      FROM tickets t LEFT JOIN products p ON p.id=t.product_id LEFT JOIN users a ON a.id=t.assignee_id LEFT JOIN users u ON u.id=t.user_id
      WHERE ${where.join(' AND ')} ORDER BY t.staff_unread DESC, t.updated_at DESC LIMIT 100`, ...args);
    const counts = D.all(`SELECT t.status, COUNT(*) n FROM tickets t WHERE ${sc.sql} GROUP BY t.status`, ...sc.args);
    return { tickets: rows.map((t) => ({ ...t, user_avatar: json(t.user_avatar, null), visitor_token: undefined })), counts };
  });

  r.get('/api/admin/tickets/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'support');
    const t = D.get('SELECT t.*, p.name product_name, p.icon product_icon, p.color product_color FROM tickets t LEFT JOIN products p ON p.id=t.product_id WHERE t.id=?', Number(ctx.params.id));
    if (!t || !supportScopeOk(me, t.product_id)) fail(404, 'Conversation not found.');
    D.run('UPDATE tickets SET staff_unread=0 WHERE id=?', t.id);
    const rows = D.all('SELECT tm.*, u.name author_name, u.avatar author_avatar FROM ticket_messages tm LEFT JOIN users u ON u.id=tm.author_id WHERE ticket_id=? ORDER BY tm.id', t.id);
    const files = up.lookup(rows.map((m) => m.upload_id));
    const messages = rows.map((m) => ({ ...m, attachment: files[m.upload_id] || null, author_avatar: json(m.author_avatar, null), author_name: m.author_name || (m.author_type === 'customer' ? (t.name || t.email || 'Visitor') : 'System') }));
    const user = t.user_id ? D.get('SELECT * FROM users WHERE id=?', t.user_id) : (t.email ? D.get('SELECT * FROM users WHERE email=?', t.email) : null);
    return {
      ticket: { ...t, visitor_token: undefined }, messages,
      customer: user ? { ...customerRow(user), tickets: D.get('SELECT COUNT(*) n FROM tickets WHERE user_id=? OR email=?', user.id, user.email).n, orders: D.all("SELECT item_name, amount, currency, status, created_at FROM orders WHERE user_id=? ORDER BY id DESC LIMIT 5", user.id) } : null,
      canned: D.all('SELECT * FROM canned WHERE product_id IS NULL OR product_id=? ORDER BY title', t.product_id),
      agents: D.all("SELECT id, name, avatar, support_scope, perms FROM users WHERE perms<>'[]'").filter((a) => { const p = json(a.perms, []); return p.includes('*') || p.includes('support'); }).map((a) => ({ id: a.id, name: a.name, avatar: json(a.avatar, {}) })),
    };
  });

  r.post('/api/admin/tickets/:id/reply', async (ctx) => {
    const me = A.requirePerm(ctx, 'support');
    const t = D.get('SELECT * FROM tickets WHERE id=?', Number(ctx.params.id));
    if (!t || !supportScopeOk(me, t.product_id)) fail(404, 'Conversation not found.');
    const b = await ctx.json();
    const body = clean(b.body, 6000);
    if (!body && !b.upload_id) fail(400, 'Write a reply first.');
    // Website-widget and API conversations have no VooSquare inbox to show an image in.
    if (b.upload_id && !t.user_id && !b.internal) fail(400, 'Images can only be sent to people with a VooSquare account. Describe it in words or send a link.');
    await staffReply(me, t, body, !!b.internal, b.upload_id || null);
    if (b.status && ['open', 'pending', 'closed'].includes(b.status)) D.run('UPDATE tickets SET status=? WHERE id=?', b.status, t.id);
    return { ok: true };
  });

  r.patch('/api/admin/tickets/:id', async (ctx) => {
    const me = A.requirePerm(ctx, 'support');
    const t = D.get('SELECT * FROM tickets WHERE id=?', Number(ctx.params.id));
    if (!t || !supportScopeOk(me, t.product_id)) fail(404, 'Conversation not found.');
    const b = await ctx.json();
    const patch = {};
    if (b.status && ['open', 'pending', 'closed'].includes(b.status)) patch.status = b.status;
    if (b.priority && ['low', 'normal', 'high', 'urgent'].includes(b.priority)) patch.priority = b.priority;
    if (b.assignee_id !== undefined) patch.assignee_id = b.assignee_id ? Number(b.assignee_id) : null;
    if (b.product_id !== undefined && A.isOwner(me)) patch.product_id = Number(b.product_id);
    patch.updated_at = now();
    D.update('tickets', t.id, patch, Object.keys(patch));
    if (patch.status === 'closed') D.insert('ticket_messages', { ticket_id: t.id, author_type: 'system', author_id: me.id, body: `${me.name.split(' ')[0]} closed this conversation`, internal: 1, created_at: now() });
    publishTicket(t.product_id, { id: t.id, product_id: t.product_id });
    publish('ticket:' + t.id, 'status', { status: patch.status || t.status });
    return { ok: true };
  });

  r.get('/api/admin/canned', (ctx) => { A.requirePerm(ctx, 'support'); return { canned: D.all('SELECT * FROM canned ORDER BY title') }; });
  r.post('/api/admin/canned', async (ctx) => {
    const me = A.requirePerm(ctx, 'support');
    const b = await ctx.json();
    if (!clean(b.title, 60) || !clean(b.body, 3000)) fail(400, 'Add a title and the reply text.');
    const id = b.id ? Number(b.id) : null;
    if (id) D.run('UPDATE canned SET title=?, body=?, product_id=? WHERE id=?', clean(b.title, 60), clean(b.body, 3000), b.product_id || null, id);
    else D.insert('canned', { title: clean(b.title, 60), body: clean(b.body, 3000), product_id: b.product_id || null });
    audit(me, 'canned.save', b.title);
    return { canned: D.all('SELECT * FROM canned ORDER BY title') };
  });
  r.del('/api/admin/canned/:id', (ctx) => { const me = A.requirePerm(ctx, 'support'); TRASH.remove('canned', 'id=?', [Number(ctx.params.id)], { by: me.id, reason: 'canned.delete' }); audit(me, 'canned.delete', ctx.params.id); return { ok: true }; });

  /* ---------------- community ---------------- */
  r.get('/api/admin/rooms', (ctx) => {
    A.requirePerm(ctx, 'community');
    apps.expireStale();
    return {
      rooms: D.all(`SELECT r.*, (SELECT COUNT(*) FROM messages m WHERE m.room_id=r.id AND m.deleted=0) messages,
        (SELECT COUNT(*) FROM room_access a WHERE a.room_id=r.id AND a.until>?) members,
        (SELECT COUNT(*) FROM room_applications x WHERE x.room_id=r.id AND x.status='pending') pending FROM rooms r ORDER BY archived, sort, id`, now())
        .map((r) => ({ ...r, ...ART.roomImages(r), apply_questions: apps.questionsOf(r), seats_taken: r.access === 'paid' && r.approval_required ? apps.seatsTaken(r) : r.members })),
      community: D.getSetting('community', {}),
      default_questions: apps.DEFAULT_QUESTIONS,
    };
  });
  r.post('/api/admin/rooms', async (ctx) => {
    const me = A.requirePerm(ctx, 'community');
    const b = await ctx.json();
    const name = clean(b.name, 60);
    if (!name) fail(400, 'Give the room a name.');
    const fields = {
      name, topic: clean(b.topic, 40) || 'General', description: clean(b.description, 300), icon: (/^[a-z0-9-]{1,20}$/i.test(String(b.icon || '')) ? b.icon : 'chat'), color: safeColor(b.color, '#00A86B'),
      access: ['free', 'premium', 'paid'].includes(b.access) ? b.access : 'free', price_usd: Math.max(0, Number(b.price_usd) || 0), period_days: Math.max(0, Number(b.period_days) || 0),
      read_only: bool(b.read_only), slow_secs: Math.max(0, Math.min(3600, Number(b.slow_secs) || 0)), sort: Number(b.sort) || 0, archived: bool(b.archived),
      images: bool(b.images, 1),
      approval_required: b.access === 'paid' ? bool(b.approval_required) : 0, seats: Math.max(0, Math.min(10000, Math.floor(Number(b.seats) || 0))),
      apply_questions: JSON.stringify(apps.cleanQuestions(b.apply_questions)),
    };
    if (fields.access === 'paid' && fields.price_usd <= 0) fail(400, 'Paid rooms need a price.');
    if (fields.approval_required && !json(fields.apply_questions, []).length) fields.apply_questions = JSON.stringify(apps.DEFAULT_QUESTIONS);
    let id = Number(b.id) || 0;
    const current = id ? D.get('SELECT image_upload, cover_upload FROM rooms WHERE id=?', id) : null;
    if (id && !current) fail(404, 'Room not found.');
    const pics = ART.prepareRoomImages(me, b, current); // checked before anything is written
    Object.assign(fields, pics.changes);
    if (id) D.update('rooms', id, fields, Object.keys(fields));
    else {
      let slug = slugify(name);
      if (D.get('SELECT 1 FROM rooms WHERE slug=?', slug)) slug += '-' + rid(2).toLowerCase();
      id = D.insert('rooms', { ...fields, slug, created_at: now() }).id;
    }
    pics.apply(id);
    audit(me, b.id ? 'room.update' : 'room.create', name);
    apps.promoteWaitlist(id); // more seats may have opened
    publish('community', 'rooms', {});
    const saved = D.get('SELECT * FROM rooms WHERE id=?', id);
    return { room: { ...saved, ...ART.roomImages(saved) } };
  });
  r.del('/api/admin/rooms/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'community');
    D.run('UPDATE rooms SET archived=1 WHERE id=?', Number(ctx.params.id));
    audit(me, 'room.archive', ctx.params.id);
    publish('community', 'rooms', {});
    return { ok: true };
  });
  /* Applications for invite-only rooms. Answers are visible to the community team and owners only. */
  r.get('/api/admin/applications', (ctx) => {
    A.requirePerm(ctx, 'community');
    const where = ['1=1']; const args = [];
    const st = String(ctx.query.status || 'pending');
    if (st === 'waitlist') where.push("a.status='approved' AND a.approved_until=0 AND a.paid_at IS NULL");
    else if (apps.STATUSES.includes(st)) { where.push('a.status=?'); args.push(st); }
    if (ctx.query.room) { where.push('a.room_id=?'); args.push(Number(ctx.query.room)); }
    if (ctx.query.q) { const q = '%' + clean(ctx.query.q, 80).toLowerCase() + '%'; where.push('(lower(u.name) LIKE ? OR lower(u.email) LIKE ?)'); args.push(q, q); }
    const rooms = D.all("SELECT id, slug, name, color, icon, seats, approval_required, access, image_upload FROM rooms WHERE access='paid' AND archived=0 ORDER BY sort, id")
      .map((r) => ({ ...r, image: ART.roomImages(r).image, seats_taken: apps.seatsTaken(r) }));
    const counts = D.all('SELECT status, COUNT(*) n FROM room_applications GROUP BY status');
    const waitlist = D.get("SELECT COUNT(*) n FROM room_applications WHERE status='approved' AND approved_until=0 AND paid_at IS NULL").n;
    return { applications: apps.adminRows(where.join(' AND '), args), rooms, counts, waitlist };
  });
  r.post('/api/admin/applications/:id/approve', async (ctx) => {
    const me = A.requirePerm(ctx, 'community');
    const b = await ctx.json();
    const a = apps.decide(me, ctx.params.id, { decision: 'approve', note: b.note, override_seats: !!b.override_seats });
    return { application: apps.adminRows('a.id=?', [a.id], 1)[0] };
  });
  r.post('/api/admin/applications/:id/reject', async (ctx) => {
    const me = A.requirePerm(ctx, 'community');
    const b = await ctx.json();
    const a = apps.decide(me, ctx.params.id, { decision: 'reject', note: b.note });
    return { application: apps.adminRows('a.id=?', [a.id], 1)[0] };
  });

  r.get('/api/admin/rooms/:id/messages', (ctx) => {
    A.requirePerm(ctx, 'community');
    const rows = D.all(`${MSG_SELECT} WHERE m.room_id=? ORDER BY m.id DESC LIMIT 100`, Number(ctx.params.id)).reverse();
    return { messages: messageRows(rows, ctx.user).map((m, i) => ({ ...m, body: rows[i].body })) };
  });
  r.get('/api/admin/messages/recent', (ctx) => {
    A.requirePerm(ctx, 'community');
    const rows = D.all(`${MSG_SELECT} WHERE m.deleted=0 ORDER BY m.id DESC LIMIT 60`);
    const rooms = Object.fromEntries(D.all('SELECT id, name FROM rooms').map((x) => [x.id, x.name]));
    return { messages: messageRows(rows, ctx.user).map((m) => ({ ...m, room: rooms[m.room_id] })) };
  });

  /* ---------------- academy ---------------- */
  r.get('/api/admin/courses', (ctx) => {
    A.requirePerm(ctx, 'academy');
    return { courses: D.all('SELECT c.*, (SELECT COUNT(*) FROM lessons l WHERE l.course_id=c.id) lessons, (SELECT COUNT(DISTINCT p.user_id) FROM progress p JOIN lessons l ON l.id=p.lesson_id WHERE l.course_id=c.id) learners FROM courses c ORDER BY sort, id') };
  });
  r.get('/api/admin/courses/:id', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const c = D.get('SELECT * FROM courses WHERE id=?', Number(ctx.params.id));
    if (!c) fail(404, 'Course not found.');
    return { course: c, lessons: D.all('SELECT * FROM lessons WHERE course_id=? ORDER BY idx, id', c.id).map((l) => ({ ...l, steps: json(l.steps, []), takeaways: json(l.takeaways, []), quiz: json(l.quiz, null) })) };
  });
  r.post('/api/admin/courses', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const b = await ctx.json();
    const title = clean(b.title, 120);
    if (!title) fail(400, 'Give the course a title.');
    const fields = {
      title, track: clean(b.track, 40) || 'Foundations', level: clean(b.level, 20) || 'Beginner', author_key: clean(b.author_key, 30) || 'team',
      author_name: clean(b.author_name, 60) || 'Zedapex team', author_role: clean(b.author_role, 60), description: clean(b.description, 600),
      grad: clean(b.grad, 200), mark: clean(b.mark, 4), premium: bool(b.premium), sort: Number(b.sort) || 0, published: bool(b.published, 1),
    };
    let id = Number(b.id) || 0;
    if (id) D.update('courses', id, fields, Object.keys(fields));
    else { let slug = slugify(title); if (D.get('SELECT 1 FROM courses WHERE slug=?', slug)) slug += '-' + rid(2).toLowerCase(); id = D.insert('courses', { ...fields, slug, created_at: now() }).id; }
    audit(me, 'course.save', title);
    return { course: D.get('SELECT * FROM courses WHERE id=?', id) };
  });
  r.del('/api/admin/courses/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const id = Number(ctx.params.id);
    // Into the recycle bin together (course, lessons and members' progress), so it can be restored as one batch.
    const batch = TRASH.newBatch(); const o = { by: me.id, reason: 'course.delete', batch };
    D.tx(() => { TRASH.remove('progress', 'lesson_id IN (SELECT id FROM lessons WHERE course_id=?)', [id], o); TRASH.remove('lessons', 'course_id=?', [id], o); TRASH.remove('courses', 'id=?', [id], o); });
    audit(me, 'course.delete', `${id} (recycle bin ${batch})`);
    return { ok: true };
  });
  r.post('/api/admin/lessons', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const b = await ctx.json();
    const title = clean(b.title, 140);
    if (!title) fail(400, 'Give the lesson a title.');
    let steps = b.steps;
    if (typeof steps === 'string') { try { steps = JSON.parse(steps); } catch { fail(400, 'The steps are not valid JSON.'); } }
    if (!Array.isArray(steps)) fail(400, 'Steps must be a list.');
    const fields = {
      title, minutes: Math.max(1, Number(b.minutes) || 5), premium: bool(b.premium), idx: Number(b.idx) || 0,
      steps: JSON.stringify(steps), takeaways: JSON.stringify(Array.isArray(b.takeaways) ? b.takeaways.map((x) => clean(x, 200)).filter(Boolean) : []),
      action: clean(b.action, 400), quiz: JSON.stringify(b.quiz && b.quiz.q ? b.quiz : null), published: bool(b.published, 1),
    };
    let id = Number(b.id) || 0;
    if (id) D.update('lessons', id, fields, Object.keys(fields));
    else { if (!D.get('SELECT 1 FROM courses WHERE id=?', Number(b.course_id))) fail(400, 'Choose a course.'); id = D.insert('lessons', { ...fields, course_id: Number(b.course_id) }).id; }
    audit(me, 'lesson.save', title);
    const l = D.get('SELECT * FROM lessons WHERE id=?', id);
    return { lesson: { ...l, steps: json(l.steps, []), takeaways: json(l.takeaways, []), quiz: json(l.quiz, null) } };
  });
  r.del('/api/admin/lessons/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const batch = TRASH.newBatch(); const o = { by: me.id, reason: 'lesson.delete', batch };
    D.tx(() => { TRASH.remove('progress', 'lesson_id=?', [Number(ctx.params.id)], o); TRASH.remove('lessons', 'id=?', [Number(ctx.params.id)], o); });
    audit(me, 'lesson.delete', `${ctx.params.id} (recycle bin ${batch})`);
    return { ok: true };
  });

  /* ---------------- blog ---------------- */
  r.get('/api/admin/posts', (ctx) => { A.requirePerm(ctx, 'blog'); return { posts: D.all('SELECT * FROM posts ORDER BY created_at DESC').map((p) => ({ ...p, body: json(p.body, []) })) }; });
  r.post('/api/admin/posts', async (ctx) => {
    const me = A.requirePerm(ctx, 'blog');
    const b = await ctx.json();
    const title = clean(b.title, 160);
    if (!title) fail(400, 'Give the post a title.');
    let body = b.body;
    if (typeof body === 'string') {
      // Plain text editor: blank-line paragraphs, "## " headings, "> " pull quotes, "- " lists.
      body = body.split(/\n{2,}/).map((blk) => {
        blk = blk.trim();
        if (blk.startsWith('## ')) return ['h', blk.slice(3)];
        if (blk.startsWith('> ')) return ['q', blk.slice(2)];
        if (/^- /m.test(blk) && blk.split('\n').every((l) => l.startsWith('- '))) return ['ul', blk.split('\n').map((l) => l.slice(2))];
        return ['p', blk];
      }).filter((x) => x[1] && x[1].length);
    }
    const fields = {
      title, category: clean(b.category, 40) || 'Playbook', author_key: clean(b.author_key, 30) || 'team', author_name: clean(b.author_name, 60) || 'Zedapex team',
      author_role: clean(b.author_role, 60), excerpt: clean(b.excerpt, 300), minutes: Math.max(1, Number(b.minutes) || 4), grad: clean(b.grad, 200), mark: clean(b.mark, 4),
      body: JSON.stringify(body || []), premium: bool(b.premium), published: bool(b.published, 1), featured: bool(b.featured),
    };
    let id = Number(b.id) || 0;
    if (fields.featured) D.run('UPDATE posts SET featured=0');
    if (id) D.update('posts', id, fields, Object.keys(fields));
    else { let slug = slugify(title); if (D.get('SELECT 1 FROM posts WHERE slug=?', slug)) slug += '-' + rid(2).toLowerCase(); id = D.insert('posts', { ...fields, slug, created_at: now() }).id; }
    audit(me, 'post.save', title);
    const p = D.get('SELECT * FROM posts WHERE id=?', id);
    return { post: { ...p, body: json(p.body, []) } };
  });
  r.del('/api/admin/posts/:id', (ctx) => { const me = A.requirePerm(ctx, 'blog'); TRASH.remove('posts', 'id=?', [Number(ctx.params.id)], { by: me.id, reason: 'post.delete' }); audit(me, 'post.delete', ctx.params.id); return { ok: true }; });

  /* ---------------- products & integrations ---------------- */
  r.get('/api/admin/products', (ctx) => { A.requirePerm(ctx, 'products'); return { products: D.all('SELECT * FROM products ORDER BY hub DESC, sort, id').map((p) => productAdmin(p, false)) }; });
  r.get('/api/admin/products/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'products');
    const p = D.get('SELECT * FROM products WHERE id=?', Number(ctx.params.id));
    if (!p) fail(404, 'Product not found.');
    // Client secrets sign id_tokens (anyone holding one can sign in to that tool as any member) and API keys post money
    // events: shown in full to owners only (CA-3). Other product staff see them masked.
    return { product: productAdmin(p, A.isOwner(me)), stats: { events_7d: D.get('SELECT COUNT(*) n FROM events WHERE product_id=? AND created_at>?', p.id, now() - 7 * DAY).n, tickets_open: D.get("SELECT COUNT(*) n FROM tickets WHERE product_id=? AND status='open'", p.id).n } };
  });
  r.post('/api/admin/products', async (ctx) => {
    const me = A.requirePerm(ctx, 'products');
    const b = await ctx.json();
    const name = clean(b.name, 60);
    if (!name) fail(400, 'Give the product a name.');
    let redirects = b.redirect_uris;
    if (typeof redirects === 'string') redirects = redirects.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
    const fields = {
      name, stage: clean(b.stage, 30), status: ['live', 'new', 'beta', 'soon'].includes(b.status) ? b.status : 'live', tagline: clean(b.tagline, 200), description: clean(b.description, 800),
      url: (/^https?:/i.test(safeUrl(b.url, 300)) ? safeUrl(b.url, 300) : ''), icon: /^[a-z0-9_-]{1,40}$/i.test(String(b.icon || '')) ? b.icon : (/^(https?:\/\/|\/)/i.test(safeUrl(b.icon, 300)) ? safeUrl(b.icon, 300) : ''),
      color: safeColor(b.color, '#00A86B'), tint: safeColor(b.tint, '#E7F8F0'), offer: clean(b.offer, 60),
      sort: Number(b.sort) || 0, visible: bool(b.visible, 1), external: bool(b.external), sso: bool(b.sso),
      redirect_uris: JSON.stringify((Array.isArray(redirects) ? redirects : []).map((x) => (httpUrl(String(x).replace(/\*$/, ''), 300) ? clean(x, 300) : '')).filter(Boolean)),
      summary_url: httpUrl(b.summary_url, 300), support_webhook: httpUrl(b.support_webhook, 300), support_greeting: clean(b.support_greeting, 200),
    };
    // Where the launcher opens the tool: URL/auth/voosquare?return_to=<launch path>. Empty = /dashboard. A path on the tool's own site only.
    if (b.launch_path !== undefined) {
      const lp = clean(b.launch_path, 200);
      if (lp && require('./app').helpers.launchPath(lp) !== lp) fail(400, 'The launch path is a page on the tool\'s own site that starts with one /, for example /app or /dashboard.');
      fields.launch_path = lp;
    }
    if (fields.support_webhook) { const p = urlProblem(fields.support_webhook); if (p) fail(400, 'The support webhook address ' + p + '.'); }
    if (fields.summary_url) { const p = urlProblem(fields.summary_url); if (p) fail(400, 'The summary URL ' + p + '.'); }
    let id = Number(b.id) || 0;
    const before = id ? D.get('SELECT * FROM products WHERE id=?', id) : null;
    if (id && !before) fail(404, 'Product not found.');
    // The summary URL and support webhook receive the product's API key (Authorization: Bearer). Pointing an existing
    // product at a new host is owner-only and audited, so the key cannot be sent somewhere new by a delegated admin.
    for (const k of ['summary_url', 'support_webhook']) {
      if (before && fields[k] && originOf(fields[k]) !== originOf(before[k])) {
        if (!A.isOwner(me)) fail(403, `Only an owner can point the ${k === 'summary_url' ? 'summary URL' : 'support webhook'} at a new address (it receives the product's API key).`);
        audit(me, 'product.endpoint_change', `${before.name} ${k}: ${originOf(before[k]) || '(none)'} → ${originOf(fields[k])}`);
      }
    }
    if (id) D.update('products', id, fields, Object.keys(fields));
    else {
      let slug = slugify(b.slug || name);
      if (D.get('SELECT 1 FROM products WHERE slug=?', slug)) fail(400, 'A product with that slug already exists.');
      id = D.insert('products', { ...fields, slug, client_id: 'vsc_' + rid(9), client_secret: 'vss_' + rid(24), api_key: 'vsk_' + rid(24), created_at: now() }).id;
    }
    audit(me, b.id ? 'product.update' : 'product.create', name);
    publish('community', 'site', { key: 'products' });
    return { product: productAdmin(D.get('SELECT * FROM products WHERE id=?', id), !before || A.isOwner(me)) };
  });
  r.post('/api/admin/products/:id/rotate', async (ctx) => {
    const me = A.requirePerm(ctx, 'products');
    const b = await ctx.json();
    const id = Number(ctx.params.id);
    if (b.which === 'secret') D.run('UPDATE products SET client_secret=? WHERE id=?', 'vss_' + rid(24), id);
    else if (b.which === 'api_key') D.run('UPDATE products SET api_key=? WHERE id=?', 'vsk_' + rid(24), id);
    else fail(400, 'Choose what to rotate.');
    audit(me, 'product.rotate', `${id} ${b.which}`);
    return { product: productAdmin(D.get('SELECT * FROM products WHERE id=?', id), A.isOwner(me)) };
  });
  r.del('/api/admin/products/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'products');
    const p = D.get('SELECT * FROM products WHERE id=?', Number(ctx.params.id));
    if (!p) fail(404, 'Product not found.');
    if (p.hub) fail(400, 'You cannot remove VooSquare itself.');
    D.run('UPDATE products SET visible=0 WHERE id=?', p.id);
    audit(me, 'product.hide', p.name);
    return { ok: true };
  });
  r.get('/api/admin/events', (ctx) => { A.requirePerm(ctx, 'products'); return { events: D.all('SELECT e.*, p.name product, u.email FROM events e LEFT JOIN products p ON p.id=e.product_id LEFT JOIN users u ON u.id=e.user_id ORDER BY e.id DESC LIMIT 100') }; });

  /* ---------------- site content & settings ---------------- */
  r.get('/api/admin/settings/:key', (ctx) => {
    const key = ctx.params.key;
    if (!SETTING_PERMS[key]) fail(404, 'Unknown setting.');
    A.requirePerm(ctx, SETTING_PERMS[key]);
    let value = D.getSetting(key, null);
    if (key === 'email' && value) value = { ...value, api_key: mask(value.api_key) };
    if (key === 'images') value = up.settings();
    if (key === 'tools') value = TOOLS.cleanSetting(value);
    if (key === 'reporting_tz') value = REV.reportingTz();
    if (key === 'apps') value = ART.adminApps();
    if (key === 'referrals') value = { ...REF.settings(), terms: (value && value.terms) || '', default_terms: REF.DEFAULT_TERMS };
    if (key === 'billing') value = pay.billingSettings();
    return { key, value, catalog: key === 'tools' ? TOOLS.CATALOG : undefined, email_env: key === 'email' ? { provider: config.email.provider, from: config.email.from, has_key: !!config.email.apiKey, ready: mailer.configured() } : undefined };
  });
  r.put('/api/admin/settings/:key', async (ctx) => {
    const key = ctx.params.key;
    if (!SETTING_PERMS[key]) fail(404, 'Unknown setting.');
    const me = A.requirePerm(ctx, SETTING_PERMS[key]);
    if (OWNER_SETTINGS.includes(key) && !A.isOwner(me)) fail(403, 'Only an owner can change the email provider.');
    const b = await ctx.json();
    let value = b.value;
    if (value === undefined) fail(400, 'Nothing to save.');
    if (key === 'premium') value = { ...value, price_usd: Math.max(0, Number(value.price_usd) || 0), period_days: Math.max(1, Number(value.period_days) || 30), features: (value.features || []).map((x) => clean(x, 200)).filter(Boolean) };
    if (key === 'email') { const old = D.getSetting('email', {}); if (typeof value.api_key === 'string' && value.api_key.startsWith('••••')) value.api_key = old.api_key; }
    if (key === 'images') value = { who: ['everyone', 'premium', 'team'].includes(value.who) ? value.who : 'everyone', daily_limit: Math.max(1, Math.min(500, Math.floor(Number(value.daily_limit) || up.DEFAULTS.daily_limit))), storage_mb: Math.max(0, Math.min(10_000, Math.floor(Number(value.storage_mb) || 0))) };
    if (key === 'ads') value = cleanAds(value);
    if (key === 'tools') { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Send the tools list and the Kill-or-scale rules.'); value = TOOLS.cleanSetting(value); }
    if (key === 'reporting_tz') { value = String(value || '').trim(); if (!REV.validTz(value)) fail(400, 'Choose a time zone from the list, for example Africa/Lagos.'); }
    if (key === 'apps') value = ART.cleanApps(me, value, D.getSetting('apps', {}));
    if (key === 'referrals') value = REF.cleanSetting(value);
    if (key === 'billing') value = pay.cleanBillingSetting(value);
    if (key === 'grandfathering') value = { enabled: !!(value && value.enabled !== false), grace_days: Math.max(0, Math.min(365, Math.floor(value && value.grace_days !== undefined && value.grace_days !== '' ? Number(value.grace_days) || 0 : 7))) };
    if (key === 'announcements') value = (Array.isArray(value) ? value : []).filter((x) => x && typeof x === 'object').map((x) => ({ ...x, id: x.id || rid(4) }));
    value = sanitizeSetting(key, value);
    D.setSetting(key, value);
    audit(me, 'settings.' + key, JSON.stringify(value).slice(0, 300));
    publish('community', 'site', { key });
    return { key, value: key === 'email' ? { ...value, api_key: mask(value.api_key) } : key === 'apps' ? ART.adminApps() : value };
  });

  /* ---------------- revenue ---------------- */
  // Finance and settings staff only, the same people who see money on the overview.
  const requireMoney = (ctx) => { const me = A.requireStaff(ctx); if (!REV.moneyPerm(A, me)) fail(403, "You don't have access to revenue."); return me; };
  r.get('/api/admin/revenue', (ctx) => {
    const me = requireMoney(ctx);
    return REV.report(ctx.query, { revealEmail: A.can(me, 'customers') });
  });
  r.get('/api/admin/revenue.csv', (ctx) => {
    const me = requireMoney(ctx);
    const out = REV.csv(ctx.query);
    audit(me, 'revenue.export', out.name);
    ctx.handled = true;
    ctx.res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${out.name}"`, 'Cache-Control': 'no-store' });
    ctx.res.end(out.body);
  });
  r.get('/api/admin/customers/:id/spend', (ctx) => {
    requireMoney(ctx);
    const u = D.get('SELECT id FROM users WHERE id=?', Number(ctx.params.id));
    if (!u) fail(404, 'Customer not found.');
    return REV.customerSpend(u.id, ctx.query);
  });

  /* ---------------- payments ---------------- */
  r.get('/api/admin/payment-methods', (ctx) => {
    A.requirePerm(ctx, 'payments');
    return { methods: D.all('SELECT * FROM payment_methods ORDER BY sort, id').map(pay.adminMethod), types: pay.TYPES };
  });
  r.post('/api/admin/payment-methods', async (ctx) => {
    const me = A.requirePerm(ctx, 'payments');
    const b = await ctx.json();
    if (!pay.TYPES[b.type]) fail(400, 'Choose a method type.');
    const name = clean(b.name, 80) || pay.TYPES[b.type].label;
    const old = b.id ? D.get('SELECT * FROM payment_methods WHERE id=?', Number(b.id)) : null;
    if (b.id && !old) fail(404, 'Payment method not found.');
    if (old && old.type !== b.type && D.get('SELECT 1 FROM orders WHERE method_id=? LIMIT 1', old.id)) fail(400, 'This method already has orders, so its type cannot change. Add a new method instead.');
    // Secrets of another type never carry over when the type changes.
    const cfg = pay.normalizeConfig(b.type, pay.mergeConfig(old && old.type === b.type ? old.config : '{}', b.config || {}));
    for (const k of ['create_url', 'verify_url', 'api_base']) if (cfg[k]) cfg[k] = httpUrl(cfg[k], 400);
    guardEndpointChange(me, old, b.type, b.config, cfg, 'payment_method.endpoint_change');
    const problems = pay.configProblems(b.type, cfg);
    if (bool(b.enabled) && problems.length) fail(400, 'Fix this before switching the method on: ' + problems[0]);
    const gv = b.type === 'gatevoo'; // Gatevoo invoices are priced in USD; the member picks USDT or BTC on Gatevoo's page.
    const fields = {
      type: b.type, name, currency: gv ? 'USD' : clean(b.currency, 10).toUpperCase() || 'USD', rate: gv ? 1 : Number(b.rate) > 0 ? Number(b.rate) : 1,
      config: JSON.stringify(cfg), enabled: bool(b.enabled), sort: b.sort === undefined || b.sort === '' ? (old ? old.sort : (D.get('SELECT COALESCE(MAX(sort),0)+1 s FROM payment_methods').s)) : Number(b.sort) || 0,
      note: clean(b.note, 200), countries: JSON.stringify((Array.isArray(b.countries) ? b.countries : String(b.countries || '').split(',')).map((c) => clean(c, 2).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))),
    };
    let id = old ? old.id : 0;
    if (id) D.update('payment_methods', id, fields, Object.keys(fields));
    else id = D.insert('payment_methods', fields).id;
    audit(me, 'payment_method.save', name);
    return { method: pay.adminMethod(D.get('SELECT * FROM payment_methods WHERE id=?', id)) };
  });
  r.del('/api/admin/payment-methods/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'payments');
    const m = D.get('SELECT * FROM payment_methods WHERE id=?', Number(ctx.params.id));
    if (!m) fail(404, 'Payment method not found.');
    // Orders point at their method (webhooks, verification, history), so a used method is switched off instead.
    if (D.get('SELECT 1 FROM orders WHERE method_id=? LIMIT 1', m.id)) fail(409, 'This method has orders, so it cannot be deleted. Switch it off instead.', { has_orders: true });
    D.run('DELETE FROM payment_methods WHERE id=?', m.id);
    audit(me, 'payment_method.delete', m.name);
    return { ok: true };
  });
  r.post('/api/admin/payment-methods/:id/duplicate', (ctx) => {
    const me = A.requirePerm(ctx, 'payments');
    const m = D.get('SELECT * FROM payment_methods WHERE id=?', Number(ctx.params.id));
    if (!m) fail(404, 'Payment method not found.');
    const id = D.insert('payment_methods', { type: m.type, name: (m.name + ' (copy)').slice(0, 80), currency: m.currency, rate: m.rate, config: m.config, enabled: 0, sort: D.get('SELECT COALESCE(MAX(sort),0)+1 s FROM payment_methods').s, note: m.note, countries: m.countries }).id;
    audit(me, 'payment_method.duplicate', m.name);
    return { method: pay.adminMethod(D.get('SELECT * FROM payment_methods WHERE id=?', id)) };
  });
  r.post('/api/admin/payment-methods/reorder', async (ctx) => {
    const me = A.requirePerm(ctx, 'payments');
    const b = await ctx.json();
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
    D.tx(() => ids.forEach((id, i) => D.run('UPDATE payment_methods SET sort=? WHERE id=?', i + 1, id)));
    audit(me, 'payment_method.reorder', ids.join(','));
    return { methods: D.all('SELECT * FROM payment_methods ORDER BY sort, id').map(pay.adminMethod) };
  });
  /* Test what is in the form (unsaved edits merge over the saved secrets). */
  r.post('/api/admin/payment-methods/test', async (ctx) => {
    const me = A.requirePerm(ctx, 'payments');
    limit('pmtest:' + ctx.user.id, 20, 60_000);
    const b = await ctx.json();
    if (!pay.TYPES[b.type]) fail(400, 'Choose a method type.');
    const old = b.id ? D.get('SELECT * FROM payment_methods WHERE id=?', Number(b.id)) : null;
    const cfg = pay.normalizeConfig(b.type, pay.mergeConfig(old && old.type === b.type ? old.config : '{}', b.config || {}));
    guardEndpointChange(me, old, b.type, b.config, cfg, 'payment_method.endpoint_test');
    return pay.testConnection(b.type, cfg);
  });
  r.get('/api/admin/orders', (ctx) => {
    A.requirePerm(ctx, 'payments');
    pay.expireStale();
    const st = ctx.query.status;
    const rows = st && st !== 'all' ? D.all('SELECT o.*, u.name, u.email, m.name method FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN payment_methods m ON m.id=o.method_id WHERE o.status=? ORDER BY o.id DESC LIMIT 200', st)
      : D.all('SELECT o.*, u.name, u.email, m.name method FROM orders o JOIN users u ON u.id=o.user_id LEFT JOIN payment_methods m ON m.id=o.method_id ORDER BY o.id DESC LIMIT 200');
    const sums = D.get("SELECT COALESCE(SUM(amount_usd),0) total, COUNT(*) n FROM orders WHERE status='paid'");
    const files = up.lookup(rows.map((o) => o.proof_upload));
    return { orders: rows.map((o) => ({ ...o, proof_image: files[o.proof_upload] || null })), paid_total_usd: sums.total, paid_count: sums.n };
  });
  r.post('/api/admin/orders/:id/approve', (ctx) => {
    const me = A.requirePerm(ctx, 'payments');
    const o = D.get('SELECT * FROM orders WHERE id=?', Number(ctx.params.id));
    if (!o) fail(404, 'Order not found.');
    if (o.status === 'refunded' || o.status === 'chargeback') fail(409, `This order was ${o.status === 'chargeback' ? 'charged back' : 'refunded'}. Ask the member to buy again.`);
    pay.fulfill(o.id, me.name);
    audit(me, 'order.approve', o.ref);
    return { order: D.get('SELECT * FROM orders WHERE id=?', o.id) };
  });
  r.post('/api/admin/orders/:id/reject', async (ctx) => {
    const me = A.requirePerm(ctx, 'payments');
    const b = await ctx.json();
    D.run("UPDATE orders SET status='failed', note=? WHERE id=? AND status NOT IN ('paid','refunded','chargeback')", clean(b.reason, 200) || 'Rejected', Number(ctx.params.id));
    audit(me, 'order.reject', ctx.params.id);
    publish('staff', 'order', { id: Number(ctx.params.id), status: 'failed' });
    return { ok: true };
  });

  /* ---------------- emails ---------------- */
  r.get('/api/admin/emails', (ctx) => {
    A.requirePerm(ctx, 'emails');
    return {
      templates: D.all('SELECT key, name, subject, marketing, updated_at FROM email_templates ORDER BY marketing, key'),
      sequence: D.all('SELECT * FROM email_sequence ORDER BY sort, delay_hours'),
      queue: D.all('SELECT q.id, q.template, q.to_email, q.status, q.send_at, q.sent_at, q.error FROM email_queue q ORDER BY q.id DESC LIMIT 60'),
      stats: D.all('SELECT status, COUNT(*) n FROM email_queue GROUP BY status'),
      ready: mailer.configured(),
    };
  });
  r.get('/api/admin/emails/:key', (ctx) => {
    A.requirePerm(ctx, 'emails');
    const t = D.get('SELECT * FROM email_templates WHERE key=?', ctx.params.key);
    if (!t) fail(404, 'Template not found.');
    let preview = '';
    try { preview = mailer.render(t.key, { ...mailer.baseVars(ctx.user), code: '482913', subject: 'Example subject', title: 'Example title', body: 'Example body', body_html: '<p>Example body</p>', cta_text: 'Open VooSquare', cta_url: config.baseUrl + '/app', reply: 'Example reply', reply_html: '<p>Example reply</p>', agent: 'Ada', product: 'Joinvoo', until: new Date(now() + 30 * DAY).toDateString(), item: 'VooSquare Premium', amount: '20 USD', ref: 'VS-EXAMPLE', room: 'Inner Circle with Dchessking', price: '$299', period: 'a month', note: 'Your numbers looked solid. Bring your last 30 days to the first call.', note_html: '<p style="margin:0;font-size:16px;line-height:25px;color:#0A1611;">Your numbers looked solid. Bring your last 30 days to the first call.</p>', deadline: new Date(now() + 7 * DAY).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), pay_url: config.baseUrl + '/app#community', reapply: new Date(now() + 30 * DAY).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), inviter: 'Dchessking', role: 'Support', cert_title: 'Certificate — Media Buying Foundations', cert_name: 'Ada Obi', school_title: 'Media Buying Foundations', cert_code: 'VS-ABCDE-23456', verify_url: config.baseUrl + '/verify/VS-ABCDE-23456', cert_url: config.baseUrl + '/app#cert/VS-ABCDE-23456', issued_on: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }).html; } catch (e) { preview = '<p>Preview failed: ' + e.message + '</p>'; }
    return { template: t, preview, customised: mailer.isCustomised(t) };
  });
  r.put('/api/admin/emails/:key', async (ctx) => {
    const me = A.requirePerm(ctx, 'emails');
    const b = await ctx.json();
    const t = D.get('SELECT * FROM email_templates WHERE key=?', ctx.params.key);
    if (!t) fail(404, 'Template not found.');
    // The login-code email carries the code that signs in as its reader (the owner too): only an owner edits it (CA-3).
    if (OWNER_TEMPLATES.includes(t.key) && !A.isOwner(me)) fail(403, 'Only an owner can edit the login code email.');
    D.run('UPDATE email_templates SET subject=?, preheader=?, html=?, text=?, updated_at=? WHERE key=?', clean(b.subject, 200) || t.subject, clean(b.preheader, 200), String(b.html || t.html).slice(0, 200_000), String(b.text || '').slice(0, 20_000), now(), t.key);
    audit(me, 'email.save', t.key);
    return { ok: true };
  });
  r.post('/api/admin/emails/:key/test', async (ctx) => {
    const me = A.requirePerm(ctx, 'emails');
    await mailer.sendNow(me.email, ctx.params.key, { code: '482913', subject: 'Test', title: 'Test broadcast', body: 'This is a test.', body_html: '<p>This is a test.</p>', cta_text: 'Open VooSquare', cta_url: config.baseUrl + '/app', reply: 'Test reply', reply_html: '<p>Test reply</p>', agent: me.name.split(' ')[0], product: 'Joinvoo', until: new Date(now() + 30 * DAY).toDateString(), item: 'VooSquare Premium', amount: '20 USD', ref: 'VS-TEST', room: 'Inner Circle with Dchessking', price: '$299', period: 'a month', note: 'Your numbers looked solid. Bring your last 30 days to the first call.', note_html: '<p style="margin:0;font-size:16px;line-height:25px;color:#0A1611;">Your numbers looked solid. Bring your last 30 days to the first call.</p>', deadline: new Date(now() + 7 * DAY).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), pay_url: config.baseUrl + '/app#community', reapply: new Date(now() + 30 * DAY).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }), inviter: me.name, role: 'Support', cert_title: 'Certificate — Media Buying Foundations', cert_name: 'Ada Obi', school_title: 'Media Buying Foundations', cert_code: 'VS-ABCDE-23456', verify_url: config.baseUrl + '/verify/VS-ABCDE-23456', cert_url: config.baseUrl + '/app#cert/VS-ABCDE-23456', issued_on: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) }, A.hydrate(D.get('SELECT * FROM users WHERE id=?', me.id)));
    return { ok: true, sent_to: me.email, console: !mailer.configured() };
  });
  r.post('/api/admin/emails/reset', async (ctx) => { const me = A.requirePerm(ctx, 'emails'); mailer.seedTemplates(true); audit(me, 'email.reset_all'); return { ok: true }; });
  /* One template back to the current default design. */
  r.post('/api/admin/emails/:key/reset', async (ctx) => {
    const me = A.requirePerm(ctx, 'emails');
    if (OWNER_TEMPLATES.includes(ctx.params.key) && !A.isOwner(me)) fail(403, 'Only an owner can change the login code email.');
    if (!D.get('SELECT 1 FROM email_templates WHERE key=?', ctx.params.key) || !mailer.resetTemplate(ctx.params.key)) fail(404, 'Template not found.');
    audit(me, 'email.reset', ctx.params.key);
    return { ok: true };
  });
  r.put('/api/admin/email-sequence', async (ctx) => {
    const me = A.requirePerm(ctx, 'emails');
    const b = await ctx.json();
    D.tx(() => { for (const [i, s] of (b.sequence || []).entries()) D.run('UPDATE email_sequence SET delay_hours=?, enabled=?, sort=? WHERE key=?', Number(s.delay_hours) || 0, s.enabled ? 1 : 0, i, s.key); });
    audit(me, 'email.sequence');
    return { sequence: D.all('SELECT * FROM email_sequence ORDER BY sort') };
  });
  r.post('/api/admin/broadcast', async (ctx) => {
    const me = A.requirePerm(ctx, 'emails');
    const b = await ctx.json();
    const subject = clean(b.subject, 140); const body = clean(b.body, 8000);
    if (!subject || !body) fail(400, 'Add a subject and a message.');
    const seg = b.segment || 'all';
    let users = D.all('SELECT * FROM users WHERE banned=0 AND marketing=1');
    if (seg === 'premium') users = users.filter((u) => u.premium_until > now());
    if (seg === 'free') users = users.filter((u) => u.premium_until <= now());
    if (seg === 'new') users = users.filter((u) => u.created_at > now() - 30 * DAY);
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const vars = { subject, title: clean(b.title, 140) || subject, body, body_html: esc(body).split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, '<br>')}</p>`).join(''), cta_text: clean(b.cta_text, 40) || 'Open VooSquare', cta_url: emailLink(b.cta_url) || config.baseUrl + '/app' };
    D.tx(() => { users.forEach((u, i) => mailer.queue(u, 'announcement', vars, now() + Math.floor(i / 50) * 60_000)); });
    audit(me, 'broadcast', `${subject} → ${users.length} (${seg})`);
    return { queued: users.length };
  });

  /* ---------------- team & roles ---------------- */
  r.get('/api/admin/team', (ctx) => {
    A.requirePerm(ctx, 'team');
    return { team: D.all("SELECT * FROM users WHERE perms<>'[]' ORDER BY id").map((u) => ({ ...customerRow(u), role_title: u.role_title, support_scope: json(u.support_scope, []) })), perms: A.PERMS };
  });
  r.post('/api/admin/team', async (ctx) => {
    const me = A.requirePerm(ctx, 'team');
    const b = await ctx.json();
    const email = clean(b.email, 200).toLowerCase();
    if (!isEmail(email)) fail(400, 'Enter a valid email.');
    let perms = [...new Set((Array.isArray(b.perms) ? b.perms : []).filter((p) => A.PERMS.includes(p) || p === '*'))];
    if (perms.includes('*') && !A.isOwner(me)) fail(403, 'Only an owner can make someone an owner.');
    if (!perms.length) fail(400, 'Give at least one permission.');
    let scope = Array.isArray(b.support_scope) ? b.support_scope.map((x) => (x === '*' ? '*' : Number(x))).filter(Boolean) : ['*'];
    let u = D.get('SELECT * FROM users WHERE email=?', email);
    const wasOwner = !!u && json(u.perms, []).includes('*');
    if (wasOwner && !A.isOwner(me)) fail(403, 'Only an owner can change an owner.');
    // Delegated team admins (CA-3): a non-owner never changes their own permissions, only gives permissions they hold
    // themselves, never edits someone who holds a permission they lack, and never widens a support scope beyond their own.
    if (!A.isOwner(me)) {
      if (u && u.id === me.id) fail(403, 'You cannot change your own permissions. Ask an owner.');
      const extra = perms.filter((p) => !me.perms.includes(p));
      if (extra.length) fail(403, `You can only give permissions you have yourself (not: ${extra.join(', ')}). Ask an owner.`);
      if (u && json(u.perms, []).some((p) => !me.perms.includes(p))) fail(403, 'This person has permissions you do not have. Ask an owner to change them.');
      const mine = (me.support_scope || []).map((x) => (x === '*' ? '*' : Number(x)));
      if (!mine.includes('*')) {
        if (!Array.isArray(b.support_scope)) scope = mine.filter(Boolean);
        if (scope.some((x) => !mine.includes(x))) fail(403, 'You can only give a support scope inside your own. Ask an owner.');
        if (!scope.length) fail(400, 'Choose at least one product for the support scope.');
      }
    }
    if (wasOwner && !perms.includes('*') && D.get("SELECT COUNT(*) n FROM users WHERE perms LIKE '%\"*\"%'").n <= 1) fail(400, 'There must be at least one owner.');
    const isNew = !u;
    if (!u) u = A.createUser({ email, name: b.name, perms });
    D.run('UPDATE users SET perms=?, support_scope=?, role_title=? WHERE id=?', JSON.stringify(perms), JSON.stringify(scope.length ? scope : ['*']), clean(b.role_title, 40), u.id);
    if (isNew || b.notify) mailer.queue(D.get('SELECT * FROM users WHERE id=?', u.id), 'admin_invite', { inviter: me.name, role: clean(b.role_title, 40) || perms.join(', ') });
    audit(me, 'team.save', `${email}: ${perms.join(',')}`);
    return { member: customerRow(D.get('SELECT * FROM users WHERE id=?', u.id)) };
  });
  r.del('/api/admin/team/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'team');
    const u = D.get('SELECT * FROM users WHERE id=?', Number(ctx.params.id));
    if (!u) fail(404, 'Not found.');
    if (json(u.perms, []).includes('*')) {
      if (!A.isOwner(me)) fail(403, 'Only an owner can remove an owner.');
      if (D.get("SELECT COUNT(*) n FROM users WHERE perms LIKE '%\"*\"%'").n <= 1) fail(400, 'There must be at least one owner.');
    }
    if (!A.isOwner(me) && u.id !== me.id && json(u.perms, []).some((p) => !me.perms.includes(p))) fail(403, 'This person has permissions you do not have. Ask an owner to remove them.');
    D.run("UPDATE users SET perms='[]', support_scope='[]', role_title='' WHERE id=?", u.id);
    audit(me, 'team.remove', u.email);
    return { ok: true };
  });

  r.get('/api/admin/audit', (ctx) => { A.requirePerm(ctx, 'team'); return { audit: D.all('SELECT a.*, u.name FROM audit a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 200') }; });

  r.post('/api/admin/reseed-content', async (ctx) => {
    const me = A.requirePerm(ctx, 'settings');
    if (!A.isOwner(me)) fail(403, 'Owner only.');
    const b = await ctx.json();
    if (b.confirm !== 'RESET') fail(400, 'Type RESET to confirm.');
    seed.seedContent(true);
    audit(me, 'content.reseed');
    return { ok: true };
  });
};
