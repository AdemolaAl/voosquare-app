'use strict';
/*
 * Everything other Zedapex products use to connect to VooSquare:
 *  - "Continue with VooSquare" login (OAuth 2.0 authorization code, with an HS256 id_token)
 *  - Events API (feeds the live activity on each member's dashboard)
 *  - Support API and the embeddable support widget (one inbox for every product)
 */
const config = require('../config');
const D = require('../db');
const A = require('../auth');
const mailer = require('../mailer');
const { now, rid, sha256, hmac, safeEq, fail, limit, isEmail, clean, json, publish, publishTicket, esc, httpUrl } = require('../util');

/* Events API time checks (see docs/INTEGRATION.md). */
const EVENT_FUTURE_MS = 10 * 60_000;
const EVENT_MAX_AGE_MS = 400 * 86400_000;
/* Event types that move money (revenue, referral earnings, affiliate commissions): these need a stable event_id. */
const MONEY_EVENTS = ['spend', 'refund', 'chargeback', 'plan_started', 'plan_renewed', 'wallet_topup'];
const b64u = (s) => Buffer.from(s).toString('base64url');
function jwtHS256(payload, key) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const sig = hmac(key, `${head}.${body}`, 'sha256', 'base64url');
  return `${head}.${body}.${sig}`;
}
function accessToken(userId, productId) {
  const t = now();
  const payload = b64u(JSON.stringify({ u: userId, p: productId, iat: t, exp: t + 3600_000 }));
  return `vsat.${payload}.${hmac(D.secret(), payload, 'sha256', 'base64url')}`;
}
function readAccessToken(tok) {
  const [pre, payload, sig] = String(tok || '').split('.');
  if (pre !== 'vsat' || !payload || !safeEq(sig, hmac(D.secret(), payload, 'sha256', 'base64url'))) return null;
  const d = json(Buffer.from(payload, 'base64url').toString(), null);
  if (!d || !(d.exp > now())) return null;
  // Revoked by "Log out everywhere" (/oauth/logout) or a ban: tokens issued at or before that moment stop working (IN-5).
  const issued = Number(d.iat) || (Number(d.exp) - 3600_000);
  if (issued <= A.tokensRevokedAt(d.u)) return null;
  return d;
}

function claimsFor(user, product) {
  const ref = user.referred_by ? D.get('SELECT ref_code FROM users WHERE id=?', user.referred_by) : null;
  return {
    sub: user.voo_id, voo_id: user.voo_id, email: user.email, email_verified: true, name: user.name, country: user.country || '',
    voo_ref: ref ? ref.ref_code : '', premium: (user.premium_until || 0) > now(), picture: `${config.baseUrl}/api/avatar/${user.voo_id}.svg`,
    aud: product.client_id, iss: config.baseUrl,
  };
}

function redirectAllowed(product, uri) {
  try {
    const u = new URL(uri);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const list = json(product.redirect_uris, []);
    // A trailing * matches by prefix, but never onto another host (https://tool.com* must not allow https://tool.com.evil.com).
    const sameOrigin = (x) => { try { return new URL(x).origin === u.origin; } catch { return false; } };
    if (list.length) return list.includes(uri) || list.some((x) => x.endsWith('*') && uri.startsWith(x.slice(0, -1)) && sameOrigin(x.slice(0, -1)));
    if (product.url) return new URL(product.url).origin === u.origin;
    return false;
  } catch { return false; }
}

/** Where /oauth/logout may send the member back to: an allowed redirect URI, or any page on the product's own site
 * (the origin of its URL). Logout only; /oauth/authorize still needs a registered redirect URI (IN-1). */
function logoutAllowed(product, uri) {
  if (redirectAllowed(product, uri)) return true;
  try {
    const u = new URL(uri);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    return !!product.url && new URL(product.url).origin === u.origin;
  } catch { return false; }
}

function productByKey(ctx) {
  const auth = String(ctx.req.headers.authorization || '');
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!key) fail(401, 'Missing API key. Send Authorization: Bearer <product API key>.');
  const p = D.get('SELECT * FROM products WHERE api_key=?', key);
  if (!p) fail(401, 'Unknown API key.');
  limit('api:' + p.id, 600, 60_000);
  return p;
}

/* ---------- support helpers shared with admin ---------- */
function addCustomerMessage(ticket, body, authorId = null) {
  const m = D.insert('ticket_messages', { ticket_id: ticket.id, author_type: 'customer', author_id: authorId, body, created_at: now() });
  D.run("UPDATE tickets SET status='open', staff_unread=1, updated_at=? WHERE id=?", now(), ticket.id);
  const msg = { id: m.id, author_type: 'customer', author_name: ticket.name || ticket.email || 'Visitor', body, created_at: now() };
  publishTicket(ticket.product_id, { id: ticket.id, product_id: ticket.product_id });
  publish('ticket:' + ticket.id, 'message', msg);
  return msg;
}
function widgetMessages(ticketId) {
  return D.all('SELECT tm.id, tm.author_type, tm.body, tm.upload_id, tm.created_at, u.name author_name FROM ticket_messages tm LEFT JOIN users u ON u.id=tm.author_id WHERE ticket_id=? AND internal=0 ORDER BY tm.id', ticketId)
    .map(({ upload_id: img, ...m }) => ({ ...m, body: img ? (m.body ? m.body + '\n\n' : '') + '[Image: open your VooSquare inbox to view it]' : m.body, author_name: m.author_type === 'staff' ? (m.author_name || 'Support').split(' ')[0] : m.author_name }));
}

/* ---------- avatar SVG (used in emails and other products) ---------- */
const SKINS = ['#8D5524', '#C68642', '#5C3A1E', '#E0AC69', '#3B2219', '#A86B3C', '#6B4226', '#F1C27D'];
const BGS = ['#E7F8F0', '#E4ECFF', '#FFE3D6', '#FFF4CF', '#ECE8FF', '#FDE2EC', '#DDF3FF', '#F1F7D8'];
const SHIRTS = ['#00A86B', '#5B3FE8', '#EE5A2F', '#3D6BF2', '#E8AE18', '#111312', '#E8458B', '#0F766E'];
const HAIRC = ['#1B120C', '#3B2219', '#6B4226', '#C9A227', '#9AA3AD'];
function avatarSvg(a = {}) {
  const sk = SKINS[a.skin % 8 || 0], bg = BGS[a.bg % 8 || 0], sh = SHIRTS[a.shirt % 8 || 0], hc = HAIRC[a.hairColor % 5 || 0];
  const hair = [
    `<path d="M18.5 28C18 14 46 14 45.5 28C42 20.5 22 20.5 18.5 28Z" fill="${hc}"/>`,
    `<circle cx="32" cy="27" r="20" fill="${hc}" opacity=".0"/><path d="M14 34C12 14 52 14 50 34C46 22 18 22 14 34Z" fill="${hc}"/>`,
    `<circle cx="32" cy="13" r="7" fill="${hc}"/><path d="M18.5 27C19 15 45 15 45.5 27C41 21 23 21 18.5 27Z" fill="${hc}"/>`,
    `<path d="M17 27C16 9 48 9 47 27C41 19.5 23 19.5 17 27Z" fill="#E8458B"/><circle cx="40" cy="15" r="5" fill="#E8458B"/>`,
    `<path d="M20 22C24 16 40 16 44 22" stroke="${hc}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    '',
  ][a.hair % 6 || 0];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="128" height="128"><clipPath id="c"><circle cx="32" cy="32" r="32"/></clipPath><g clip-path="url(#c)"><rect width="64" height="64" fill="${bg}"/><path d="M8 66C10 50 21 45 32 45C43 45 54 50 56 66Z" fill="${sh}"/><rect x="27.5" y="38" width="9" height="9" rx="3" fill="${sk}"/><ellipse cx="32" cy="30" rx="13" ry="15" fill="${sk}"/>${hair}<ellipse cx="27" cy="31" rx="1.7" ry="2" fill="#140C08"/><ellipse cx="37" cy="31" rx="1.7" ry="2" fill="#140C08"/><path d="M27.5 37Q32 41 36.5 37" stroke="#3A1F14" stroke-width="1.8" fill="none" stroke-linecap="round"/></g></svg>`;
}

module.exports = function routes(r) {
  /* ================= Continue with VooSquare (OAuth 2.0) ================= */
  r.get('/oauth/authorize', (ctx) => {
    const q = ctx.query;
    // A tool passes back the affiliate click it received (ref, vclick, coupon) so attribution survives the domain change.
    if (!ctx.user && (q.vclick || q.ref || q.coupon)) require('../aff').captureFromAuthorize(ctx);
    const p = D.get('SELECT * FROM products WHERE client_id=?', String(q.client_id || ''));
    if (!p) return ctx.html(400, page('Unknown app', 'This login link is not set up correctly. Contact the app owner.'));
    if (!p.sso) return ctx.html(400, page('Login is not switched on', 'This app has not switched on VooSquare login yet. Contact the app owner.'));
    if (!q.redirect_uri || !redirectAllowed(p, q.redirect_uri)) return ctx.html(400, page('Redirect not allowed', 'The redirect address is not on this product’s allowed list in the VooSquare admin.'));
    if (!ctx.user) {
      const next = ctx.url.pathname + ctx.url.search;
      return ctx.redirect(`/login?product=${encodeURIComponent(p.slug)}&mode=${q.prompt === 'signup' ? 'signup' : 'login'}&next=${encodeURIComponent(next)}`);
    }
    const code = rid(24);
    D.run('INSERT INTO sso_codes(code_hash,user_id,product_id,redirect_uri,expires) VALUES(?,?,?,?,?)', sha256(code), ctx.user.id, p.id, q.redirect_uri, now() + 5 * 60_000);
    const u = new URL(q.redirect_uri);
    u.searchParams.set('code', code);
    if (q.state) u.searchParams.set('state', String(q.state));
    return ctx.redirect(u.toString());
  });

  r.post('/oauth/token', async (ctx) => {
    const b = await ctx.formOrJson();
    const auth = String(ctx.req.headers.authorization || '');
    let clientId = b.client_id; let clientSecret = b.client_secret;
    const dec = (v) => { try { return decodeURIComponent(v || ''); } catch { return ''; } };
    if (auth.startsWith('Basic ')) { const raw = Buffer.from(auth.slice(6), 'base64').toString(); const i = raw.indexOf(':'); clientId = clientId || dec(i < 0 ? raw : raw.slice(0, i)); clientSecret = clientSecret || dec(i < 0 ? '' : raw.slice(i + 1)); }
    const p = D.get('SELECT * FROM products WHERE client_id=?', String(clientId || ''));
    if (!p || !safeEq(p.client_secret, clientSecret)) fail(401, 'invalid_client');
    if (b.grant_type && b.grant_type !== 'authorization_code') fail(400, 'unsupported_grant_type');
    const row = D.get('SELECT * FROM sso_codes WHERE code_hash=?', sha256(String(b.code || '')));
    if (!row || row.expires < now() || row.product_id !== p.id) fail(400, 'invalid_grant');
    if (String(b.redirect_uri || '') !== row.redirect_uri) fail(400, 'invalid_grant');
    D.run('DELETE FROM sso_codes WHERE code_hash=?', row.code_hash);
    const user = D.get('SELECT * FROM users WHERE id=? AND banned=0', row.user_id);
    if (!user) fail(400, 'invalid_grant');
    const claims = claimsFor(user, p);
    const iat = Math.floor(now() / 1000);
    return {
      access_token: accessToken(user.id, p.id), token_type: 'Bearer', expires_in: 3600,
      id_token: jwtHS256({ ...claims, iat, exp: iat + 3600 }, p.client_secret), user: claims,
    };
  }, { noCsrf: true });

  r.get('/oauth/userinfo', (ctx) => {
    const tok = String(ctx.req.headers.authorization || '').replace(/^Bearer\s+/, '');
    const d = readAccessToken(tok);
    if (!d) fail(401, 'invalid_token');
    const user = D.get('SELECT * FROM users WHERE id=? AND banned=0', d.u);
    const p = D.get('SELECT * FROM products WHERE id=?', d.p);
    if (!user || !p) fail(401, 'invalid_token');
    return claimsFor(user, p);
  });

  r.get('/oauth/logout', (ctx) => {
    // "Log out everywhere": ends this VooSquare session and revokes every tool access token issued to the member so far.
    if (ctx.user) A.revokeTokens(ctx.user.id);
    A.destroySession(ctx);
    const to = String(ctx.query.redirect_uri || '');
    const ok = to && D.all('SELECT * FROM products').some((p) => logoutAllowed(p, to));
    return ctx.redirect(ok ? to : '/');
  });

  /* Public login branding for a product (used by /login?product=slug). */
  r.get('/api/login-brand/:slug', (ctx) => {
    const p = D.get('SELECT slug, name, icon, color, tint, tagline FROM products WHERE slug=?', ctx.params.slug);
    if (!p) fail(404, 'Unknown product');
    return { product: p };
  });

  r.get('/api/avatar/:file', (ctx) => {
    const vooId = String(ctx.params.file).replace(/\.svg$/, '');
    const u = D.get('SELECT avatar FROM users WHERE voo_id=?', vooId);
    ctx.res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=300' });
    ctx.res.end(avatarSvg(json(u ? u.avatar : '{}', {})));
    ctx.handled = true;
  });

  /* ================= Events API ================= */
  r.post('/api/v1/events', async (ctx) => {
    const p = productByKey(ctx);
    const b = await ctx.json();
    const list = Array.isArray(b.events) ? b.events.slice(0, 100) : [b];
    let stored = 0; let clamped = 0; const rejected = [];
    // `rejected[].event_id` echoes the id exactly as the tool sent it (never cut down), so the tool can match it to its queue.
    const sentId = (e) => (e && e.event_id !== undefined && e.event_id !== null && typeof e.event_id !== 'object' ? String(e.event_id) : '');
    // Never drop silently: events past the first 100 and events with no type are listed in `rejected` so the tool resends or fixes them.
    if (Array.isArray(b.events)) for (const e of b.events.slice(100)) rejected.push({ event_id: sentId(e), error: 'more than 100 events in one call; send this one again in the next call' });
    for (const e of list) {
      // Malformed entries (null, a string, a number, a list) are reported, never dropped silently (IN-4).
      if (!e || typeof e !== 'object' || Array.isArray(e)) { if (Array.isArray(b.events)) rejected.push({ event_id: '', error: 'each event must be an object' }); continue; }
      if (!e.type) { if (Object.keys(e).length || Array.isArray(b.events)) rejected.push({ event_id: sentId(e), error: 'type is required' }); continue; }
      // event_id is the dedupe key and is never shortened: two ids that only differ after 80 characters would collapse
      // into one and the second event would be lost as a "duplicate" (IN-2).
      const extId = e.event_id === undefined || e.event_id === null ? '' : clean(e.event_id, 1000);
      if (extId.length > 80) { rejected.push({ event_id: sentId(e), error: 'event_id is longer than 80 characters; send a shorter stable id (for example a hash of the long one)' }); continue; }
      // Money events need a stable event_id, or a retried call would count the money twice (IN-3).
      if (!extId && MONEY_EVENTS.includes(String(e.type))) { rejected.push({ event_id: '', error: `event_id is required for ${String(e.type).slice(0, 40)} events, so a retry can never count the money twice` }); continue; }
      // A refund or chargeback must point at a payment VooSquare received from this product: one that points at nothing can
      // never be reconciled (no commission to keep or reverse, no revenue to net). Refused for good, so the tool's admin sees it.
      // Checked before the insert; an earlier event in this same call counts (it is stored above, in order).
      const origId = e.original_event_id === undefined || e.original_event_id === null ? '' : clean(e.original_event_id, 200);
      if ((e.type === 'refund' || e.type === 'chargeback') && origId && !D.get("SELECT 1 FROM events WHERE product_id=? AND ext_id=? AND type NOT IN ('refund','chargeback')", p.id, origId)) {
        if (!(extId && D.get('SELECT 1 FROM events WHERE product_id=? AND ext_id=?', p.id, extId))) { rejected.push({ event_id: sentId(e), error: `original event not found: VooSquare has no payment with event_id "${origId.slice(0, 80)}" from this product, so this ${e.type} cannot be matched. Send the payment's own event first, or check original_event_id.` }); continue; }
      }
      const user = e.voo_id ? D.get('SELECT id FROM users WHERE voo_id=?', String(e.voo_id)) : null;
      // occurred_at is the tool's word: more than 10 minutes ahead is clamped to now (clock skew, bad input), older than
      // 400 days is refused. received_at is ours and settles referral earnings, so it cannot be backdated.
      const received = now();
      let at = e.occurred_at ? Date.parse(e.occurred_at) || received : received;
      if (at > received + EVENT_FUTURE_MS) { at = received; clamped++; }
      if (at < received - EVENT_MAX_AGE_MS) { rejected.push({ event_id: sentId(e), error: 'occurred_at is more than 400 days ago' }); continue; }
      // Money must be a real, sane number: Infinity or absurd values would poison revenue totals (see src/revenue.js MAX_VALUE).
      const val = Number(e.value_usd);
      const value = Number.isFinite(val) && Math.abs(val) <= 1e9 ? val : 0;
      const res = D.run('INSERT OR IGNORE INTO events(product_id,user_id,ext_id,type,label,value_usd,created_at,received_at) VALUES(?,?,?,?,?,?,?,?)',
        p.id, user ? user.id : null, extId || rid(8), clean(e.type, 40), clean(e.label, 140), value, at, received);
      if (res.changes) {
        stored++;
        if (user) publish('user:' + user.id, 'activity', { product: p.name, icon: p.icon, slug: p.slug, type: e.type, label: clean(e.label, 140), value_usd: value, created_at: at });
        // Affiliate commissions (spend, refund, chargeback, plan_started/renewed, wallet_topup): src/aff/engine.js.
        require('../aff').onEvent(res.id, e, p);
      }
    }
    return { ok: true, stored, ...(clamped ? { clamped } : {}), ...(rejected.length ? { rejected } : {}) };
  }, { noCsrf: true });

  r.get('/api/v1/users/:voo_id', (ctx) => {
    const p = productByKey(ctx);
    const u = D.get('SELECT * FROM users WHERE voo_id=?', ctx.params.voo_id);
    if (!u) fail(404, 'User not found');
    return claimsFor(u, p);
  });

  /* ================= Support API (server to server) ================= */
  r.post('/api/v1/support/messages', async (ctx) => {
    const p = productByKey(ctx);
    const b = await ctx.json();
    const email = clean(b.email, 200).toLowerCase();
    const body = clean(b.body, 4000);
    if (!body) fail(400, 'body is required');
    if (email && !isEmail(email)) fail(400, 'email is not valid');
    const user = (b.voo_id && D.get('SELECT * FROM users WHERE voo_id=?', String(b.voo_id))) || (email && D.get('SELECT * FROM users WHERE email=?', email)) || null;
    let t = b.external_ref ? D.get("SELECT * FROM tickets WHERE product_id=? AND external_ref=? AND status<>'closed'", p.id, String(b.external_ref)) : null;
    if (!t && (email || user)) t = D.get("SELECT * FROM tickets WHERE product_id=? AND email=? AND status<>'closed' ORDER BY id DESC LIMIT 1", p.id, email || user.email);
    if (!t) {
      const id = D.insert('tickets', { product_id: p.id, user_id: user ? user.id : null, email: email || (user && user.email) || '', name: clean(b.name, 80) || (user && user.name) || '', subject: clean(b.subject, 140) || body.slice(0, 80), status: 'open', channel: 'api', external_ref: clean(b.external_ref, 120), created_at: now(), updated_at: now() }).id;
      t = D.get('SELECT * FROM tickets WHERE id=?', id);
      publishTicket(p.id, { id: t.id, product_id: p.id, new: true });
    }
    addCustomerMessage(t, body, user ? user.id : null);
    return { ok: true, ticket_id: t.id };
  }, { noCsrf: true });

  r.get('/api/v1/support/tickets/:id/messages', (ctx) => {
    const p = productByKey(ctx);
    const t = D.get('SELECT * FROM tickets WHERE id=? AND product_id=?', Number(ctx.params.id), p.id);
    if (!t) fail(404, 'Ticket not found');
    return { ticket: { id: t.id, status: t.status, subject: t.subject }, messages: widgetMessages(t.id) };
  });

  /* ================= Support widget (any website) ================= */
  r.get('/api/widget/:slug/config', (ctx) => {
    const p = D.get('SELECT * FROM products WHERE slug=?', ctx.params.slug);
    if (!p) fail(404, 'Unknown product');
    const staffOnline = D.get("SELECT COUNT(*) n FROM users WHERE perms<>'[]' AND last_seen>?", now() - 5 * 60_000).n;
    return { product: { slug: p.slug, name: p.name, color: p.color, icon: p.icon }, greeting: p.support_greeting || `Hi! Ask us anything about ${p.name}. A real person answers.`, online: staffOnline > 0, icon_url: /^https?:\/\//i.test(p.icon || '') ? p.icon : (p.icon || '').startsWith('/') ? config.baseUrl + p.icon : `${config.baseUrl}/assets/icons/${/^[a-z0-9_-]+$/i.test(p.icon || '') ? p.icon : 'voosquare'}.svg` };
  });

  r.get('/api/widget/:slug/messages', (ctx) => {
    const p = D.get('SELECT * FROM products WHERE slug=?', ctx.params.slug);
    if (!p) fail(404, 'Unknown product');
    const token = String(ctx.query.token || '');
    if (token.length < 16) return { messages: [], status: 'new' };
    const t = D.get('SELECT * FROM tickets WHERE product_id=? AND visitor_token=? ORDER BY id DESC LIMIT 1', p.id, sha256(token));
    if (!t) return { messages: [], status: 'new' };
    if (t.customer_unread) D.run('UPDATE tickets SET customer_unread=0 WHERE id=?', t.id);
    return { messages: widgetMessages(t.id), status: t.status, ticket_id: t.id };
  });

  r.post('/api/widget/:slug/messages', async (ctx) => {
    const p = D.get('SELECT * FROM products WHERE slug=?', ctx.params.slug);
    if (!p) fail(404, 'Unknown product');
    limit('widget-ip:' + ctx.ip, 20, 60_000);
    const b = await ctx.json();
    const body = clean(b.body, 3000);
    if (!body) fail(400, 'Write a message first.');
    let token = String(b.token || '');
    if (token.length < 16) token = rid(24);
    const email = clean(b.email, 200).toLowerCase();
    if (email && !isEmail(email)) fail(400, 'That email does not look right.');
    // The email is typed by an anonymous visitor, so it is never proof of an account: keep it for replies only.
    const user = null;
    let t = D.get("SELECT * FROM tickets WHERE product_id=? AND visitor_token=? AND status<>'closed' ORDER BY id DESC LIMIT 1", p.id, sha256(token));
    if (!t) {
      const id = D.insert('tickets', { product_id: p.id, user_id: user ? user.id : null, visitor_token: sha256(token), email, name: clean(b.name, 80) || (user && user.name) || '', subject: body.slice(0, 80), status: 'open', channel: 'widget', page_url: httpUrl(b.page, 300), created_at: now(), updated_at: now() }).id;
      t = D.get('SELECT * FROM tickets WHERE id=?', id);
      publishTicket(p.id, { id: t.id, product_id: p.id, new: true });
    } else if ((email && !t.email) || (b.name && !t.name)) {
      D.run('UPDATE tickets SET email=COALESCE(NULLIF(email,\'\'),?), name=COALESCE(NULLIF(name,\'\'),?), user_id=COALESCE(user_id,?) WHERE id=?', email, clean(b.name, 80), user ? user.id : null, t.id);
      t = D.get('SELECT * FROM tickets WHERE id=?', t.id);
    }
    addCustomerMessage(t, body, user ? user.id : null);
    return { token, ticket_id: t.id, messages: widgetMessages(t.id) };
  }, { noCsrf: true });

  /* ================= Unsubscribe ================= */
  r.get('/u/:id/:token', (ctx) => {
    const id = Number(ctx.params.id);
    if (!safeEq(ctx.params.token, mailer.unsubToken(id))) return ctx.html(400, page('Link not valid', 'This unsubscribe link is not valid.'));
    D.run('UPDATE users SET marketing=0 WHERE id=?', id);
    return ctx.html(200, page('You are unsubscribed', 'You will no longer get marketing emails from VooSquare. You will still get codes, receipts and support replies.'));
  });
};

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · VooSquare</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#F5F8F6;color:#0A1A13;display:grid;place-items:center;min-height:100vh;padding:16px}
.c{max-width:440px;background:#fff;border:1px solid #E3EBE7;border-radius:24px;padding:32px;text-align:center}
h1{font-size:26px;letter-spacing:-.03em;margin:16px 0 8px}p{color:#5A6A63;line-height:1.6}a{display:inline-block;margin-top:16px;background:#00A86B;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700}</style></head>
<body><div class="c"><img src="/assets/logo-icon.svg" width="56" height="56" alt=""><h1>${esc(title)}</h1><p>${esc(body)}</p><a href="/">Go to VooSquare</a></div></body></html>`;
}

module.exports.helpers = { avatarSvg, widgetMessages, page };
