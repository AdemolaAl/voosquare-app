'use strict';
const config = require('./config');
const D = require('./db');
const { now, rid, sha256, safeEq, fail, json, clean, closeSessionStreams, closeUserStreams } = require('./util');

const SESSION_DAYS = 30;
const PERMS = ['customers', 'support', 'community', 'academy', 'blog', 'content', 'products', 'payments', 'emails', 'team', 'settings', 'aff_admin', 'aff_manager', 'aff_fraud', 'aff_finance'];

function hydrate(u) {
  if (!u) return null;
  u.avatar = json(u.avatar, {});
  u.perms = json(u.perms, []);
  u.support_scope = json(u.support_scope, []);
  u.premium = (u.premium_until || 0) > now();
  u.staff = u.perms.length > 0;
  return u;
}

function can(u, perm) {
  return !!u && (u.perms.includes('*') || u.perms.includes(perm));
}
const isOwner = (u) => !!u && u.perms.includes('*');

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, voo_id: u.voo_id, email: u.email, name: u.name, handle: u.handle, country: u.country,
    avatar: u.avatar, bio: u.bio, premium: u.premium, premium_until: u.premium_until, perms: u.perms,
    support_scope: u.support_scope, role_title: u.role_title, staff: u.staff, ref_code: u.ref_code,
    onboarded: !!u.onboarded, xp: u.xp, marketing: !!u.marketing, created_at: u.created_at,
  };
}
/** What other members see in the community. */
function memberCard(u) {
  return { id: u.id, name: u.name, handle: u.handle, avatar: json(u.avatar, {}), premium: (u.premium_until || 0) > now(), staff: json(u.perms, []).length > 0, role_title: u.role_title || '' };
}

/** The session token from this request, read only from config.sessionCookie (never from a plain vs_sess over https). */
const sessionToken = (ctx) => (ctx.cookies && ctx.cookies[config.sessionCookie]) || '';

/* Over https a plain `vs_sess` is never trusted: any *.voosquare.com subdomain could have set it (host-only or on the
 * parent domain). Clear both forms so it stops being sent. */
function dropLegacySession(ctx) {
  if (config.sessionCookie === config.legacySessionCookie || !ctx.cookies || !(config.legacySessionCookie in ctx.cookies)) return;
  const name = config.legacySessionCookie;
  ctx.setCookie(`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`);
  const dom = require('./aff/tracking').cookieDomain();
  if (dom) ctx.setCookie(`${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Domain=.${dom}; Secure`);
}

const lastSeenWrites = new Map();
function loadUser(ctx) {
  dropLegacySession(ctx);
  const token = sessionToken(ctx);
  if (!token) return null;
  const u = D.get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?', sha256(token), now());
  if (!u || u.banned || u.deleted_at) return null; // deleted_at: the member deleted the account (src/account.js)
  const t = now();
  if ((lastSeenWrites.get(u.id) || 0) < t - 60_000) { lastSeenWrites.set(u.id, t); D.run('UPDATE users SET last_seen=? WHERE id=?', t, u.id); }
  return hydrate(u);
}

function requireUser(ctx) { if (!ctx.user) fail(401, 'Please log in first.'); return ctx.user; }
function requirePerm(ctx, perm) {
  const u = requireUser(ctx);
  if (!can(u, perm)) fail(403, "You don't have access to this part of the admin.");
  return u;
}
function requireStaff(ctx) { const u = requireUser(ctx); if (!u.staff) fail(403, 'Staff only.'); return u; }

/* Host-only (no Domain) with Path=/ and, over https, Secure: exactly what a __Host- cookie requires. */
function cookie(name, value, maxAgeSec) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${config.secure ? '; Secure' : ''}`;
}

function createSession(ctx, userId) {
  const token = rid(32);
  D.run('INSERT INTO sessions(token_hash,user_id,created_at,expires) VALUES(?,?,?,?)', sha256(token), userId, now(), now() + SESSION_DAYS * 86400_000);
  ctx.setCookie(cookie(config.sessionCookie, token, SESSION_DAYS * 86400));
}
function destroySession(ctx) {
  const token = sessionToken(ctx);
  if (token) { D.run('DELETE FROM sessions WHERE token_hash=?', sha256(token)); closeSessionStreams(sha256(token), 'logout'); }
  ctx.setCookie(cookie(config.sessionCookie, '', 0));
}
/** End every session of a user (ban) and close their live streams at once. */
function revokeUser(userId, reason = 'revoked') {
  D.run('DELETE FROM sessions WHERE user_id=?', userId);
  closeUserStreams(userId, reason);
  revokeTokens(userId);
}
/* Tool access tokens (vsat.…, src/routes/integrations.js) are stateless for an hour. "Log out everywhere" and a ban record
 * the moment in the settings table (key oauth_revoked:<user id>); every token issued at or before it is refused. */
function revokeTokens(userId) { if (userId) D.setSetting('oauth_revoked:' + userId, now()); }
function tokensRevokedAt(userId) { return Number(D.getSetting('oauth_revoked:' + Number(userId), 0)) || 0; }

const codeHash = (email, code) => sha256(`${email}:${code}:${D.secret()}`);

function randomAvatar() {
  const r = (n) => Math.floor(Math.random() * n);
  return { skin: r(8), hair: r(6), hairColor: r(5), shirt: r(8), bg: r(8), eyes: r(3), mouth: r(3), acc: r(4) };
}

function uniqueHandle(base) {
  let h = String(base || 'buyer').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 14) || 'buyer';
  if (h.length < 3) h = h + 'buyer';
  if (!D.get('SELECT 1 FROM users WHERE handle=?', h)) return h;
  for (let i = 0; i < 20; i++) {
    const c = h + Math.floor(100 + Math.random() * 9900);
    if (!D.get('SELECT 1 FROM users WHERE handle=?', c)) return c;
  }
  return h + rid(3).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function uniqueRefCode() {
  for (;;) {
    const c = rid(5).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 7);
    if (c.length >= 5 && !D.get('SELECT 1 FROM users WHERE ref_code=?', c)) return c;
  }
}

/** Create a member. Returns the hydrated user. */
function createUser({ email, name, ref, productId, perms }) {
  const referrer = ref ? D.get('SELECT id FROM users WHERE ref_code=?', String(ref).toLowerCase()) : null;
  const displayName = clean(name, 60) || email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const p = perms || (config.ownerEmail && email === config.ownerEmail ? ['*'] : []);
  const r = D.insert('users', {
    voo_id: 'vs_' + rid(10), email, name: displayName, handle: uniqueHandle(displayName.split(' ')[0]),
    avatar: JSON.stringify(randomAvatar()), perms: JSON.stringify(p), ref_code: uniqueRefCode(),
    referred_by: referrer ? referrer.id : null, signup_product: productId || null,
    role_title: p.includes('*') ? 'Founder' : '', created_at: now(), last_seen: now(),
  });
  return hydrate(D.get('SELECT * FROM users WHERE id=?', r.id));
}

module.exports = {
  PERMS, hydrate, can, isOwner, publicUser, memberCard, loadUser, requireUser, requirePerm, requireStaff,
  createSession, destroySession, sessionToken, revokeUser, revokeTokens, tokensRevokedAt, codeHash, createUser, randomAvatar, uniqueHandle, cookie, safeEq,
};
