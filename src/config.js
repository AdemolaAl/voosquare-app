'use strict';
const fs = require('node:fs');
const path = require('node:path');
const env = process.env;

const port = Number(env.PORT) || 3000;
const railwayUrl = env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + env.RAILWAY_PUBLIC_DOMAIN : '';
const baseUrl = (env.BASE_URL || railwayUrl || 'http://localhost:' + port).replace(/\/+$/, '');

function defaultDbPath() {
  if (env.DATABASE_PATH) return env.DATABASE_PATH;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return path.join(env.RAILWAY_VOLUME_MOUNT_PATH, 'voosquare.db');
  if (fs.existsSync('/data')) return '/data/voosquare.db';
  return path.join(__dirname, '..', 'data', 'voosquare.db');
}

const dbPath = defaultDbPath();
const secure = baseUrl.startsWith('https://');

/* A base address that can never be a public site: localhost, 127.0.0.1, *.localhost and the reserved *.test names. */
const baseHost = (() => { try { return new URL(baseUrl).hostname.toLowerCase(); } catch { return ''; } })();
const localBase = !env.RAILWAY_PUBLIC_DOMAIN && (baseHost === 'localhost' || baseHost === '127.0.0.1' || baseHost === '[::1]' || baseHost.endsWith('.localhost') || baseHost.endsWith('.test'));
/* Login codes in the HTTP reply (no email needed) are for tests and local development only: NODE_ENV=test or
 * DEV_LOGIN_CODES=1, AND a local base address. Anything else never returns them (server.js refuses to start when they are
 * asked for on a public address). */
const devCodesRequested = env.NODE_ENV === 'test' || env.DEV_LOGIN_CODES === '1';

/* Trusted proxies in front of the app (docs/DEPLOY-GUIDE.md "Client IP addresses"). TRUST_PROXY=<n> trusts n hops of
 * X-Forwarded-For (the client is the n-th address from the right); 0 or unset = the header is ignored. Default: exactly one
 * hop on Railway (RAILWAY_ENVIRONMENT is set; its edge appends the real address), none anywhere else. */
function trustProxyHops() {
  const v = String(env.TRUST_PROXY ?? '').trim().toLowerCase();
  if (v === '') return env.RAILWAY_ENVIRONMENT ? 1 : 0;
  if (v === 'true') return 1;
  if (v === 'false') return 0;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
}

module.exports = {
  port,
  baseUrl,
  prod: env.NODE_ENV === 'production',
  secure,
  localBase,
  devCodesRequested,
  /* Login codes may be returned in the reply (dev_code) only when asked for AND the base address is local. */
  devLoginCodes: devCodesRequested && localBase,
  trustProxy: trustProxyHops(),
  /* GET /healthz details (database and schema state) only with header X-Health-Key: <HEALTH_KEY> or for an owner. */
  healthKey: env.HEALTH_KEY || '',
  /* The sign-in cookie. Over https it is `__Host-vs_sess`: the browser only accepts it from this exact host with Secure,
   * Path=/ and no Domain, so a sister tool on another *.voosquare.com subdomain can never plant or overwrite it. Over
   * plain http (local dev, tests) __Host- is impossible, so it stays `vs_sess`. Every set/read/clear uses this name.
   * Renaming it signs everyone out: see docs/CHANGING-SAFELY.md before changing it after launch. */
  sessionCookie: secure ? '__Host-vs_sess' : 'vs_sess',
  /* The plain name. Over https it is never trusted (anyone on a sibling subdomain could set it) and is cleared when seen. */
  legacySessionCookie: 'vs_sess',
  dbPath,
  /* Images people share live next to the database, so on Railway they sit on the same /data volume. */
  uploadsDir: env.UPLOADS_DIR || path.join(path.dirname(dbPath), 'uploads'),
  /* Database copies (daily, by hand, and automatically before every update): next to the database, on the same volume. */
  backupsDir: env.BACKUPS_DIR || path.join(path.dirname(dbPath), 'backups'),
  /* Server-side calls to admin-entered payment URLs may reach private/localhost addresses only in tests or when explicitly allowed. */
  allowPrivateOutbound: env.NODE_ENV === 'test' || env.ALLOW_PRIVATE_OUTBOUND === '1',
  appSecret: env.APP_SECRET || '',
  /* SAFE_COPY=1 on a staging or local copy of production data: no emails, no affiliate jobs (postbacks, Telegram,
   * payouts), so a rehearsal never reaches real members or partners. docs/CHANGING-SAFELY.md. */
  safeCopy: env.SAFE_COPY === '1',
  ownerEmail: (env.OWNER_EMAIL || '').trim().toLowerCase(),
  /* Where "Affiliates" links point. Empty = /affiliates on this host; set AFFILIATE_URL=https://affiliate.voosquare.com once that domain is live. */
  affiliateUrl: (env.AFFILIATE_URL || '').trim().replace(/\/+$/, ''),
  /* VooSquare Academy's own website (same app, same accounts). Requests whose Host is voosquareacademy.com,
   * www.voosquareacademy.com or any host in ACADEMY_HOSTS (comma separated) get the academy site (server.js, src/academy.js).
   * ACADEMY_URL: its public address for links, canonical tags, the sitemap and the one-tap switch (default
   * https://voosquareacademy.com). Set it explicitly once the domain is live: new certificates then print their verify
   * link on the academy domain too. VOOSQUARE_URL: where the academy sends people for everything else (default BASE_URL). */
  academyHosts: [...new Set(['voosquareacademy.com', 'www.voosquareacademy.com', ...String(env.ACADEMY_HOSTS || '').split(',')]
    .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean))],
  academyUrl: (env.ACADEMY_URL || 'https://voosquareacademy.com').trim().replace(/\/+$/, ''),
  academyUrlSet: !!String(env.ACADEMY_URL || '').trim(),
  voosquareUrl: (env.VOOSQUARE_URL || baseUrl).trim().replace(/\/+$/, ''),
  email: {
    provider: (env.EMAIL_PROVIDER || '').toLowerCase(),
    apiKey: env.EMAIL_API_KEY || '',
    from: env.EMAIL_FROM || 'VooSquare <hello@voosquare.com>',
    replyTo: env.EMAIL_REPLY_TO || '',
  },
  publicDir: path.join(__dirname, '..', 'public'),
};
