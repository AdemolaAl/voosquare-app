'use strict';
/*
 * VooSquare server. Zero npm dependencies: Node 22 built-ins only (http, node:sqlite, crypto, zlib).
 * Start: npm start   ·   Health: GET /healthz
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const config = require('./src/config');
const D = require('./src/db');
const A = require('./src/auth');
const mailer = require('./src/mailer');
const { seed } = require('./src/seed');
const { Router } = require('./src/router');
const { parseCookies, readBody, HttpError, now, clientIp } = require('./src/util');

/* Database schema, in this order (docs/CHANGING-SAFELY.md):
 *  1. src/db.js made a safety copy if this start changes the database (pre-migrate-v<N>-<time>.db in the backups folder).
 *  2. Every module that owns tables builds its baseline tables when it loads, so load them all first.
 *  3. The numbered migrations in src/migrations run once each, in a transaction. One that fails is rolled back and the
 *     app refuses to start, so a half-upgraded database is never served. */
require('./src/features'); require('./src/school'); require('./src/voice'); require('./src/aff');
const migrate = require('./src/migrate');
migrate.runOrExit(D.db);

seed();

/* Login codes in the HTTP reply (dev_code) exist only for tests and local development (CA-1). Asking for them
 * (NODE_ENV=test or DEV_LOGIN_CODES=1) on a public address with no email provider would let anyone sign in as anyone, so
 * the app refuses to start instead. docs/DEPLOY-GUIDE.md "Email and login codes". */
if (config.devCodesRequested && !config.localBase && !mailer.configured()) {
  console.error(`[startup] REFUSING TO START: login codes in replies are switched on (NODE_ENV=${process.env.NODE_ENV || ''}${process.env.DEV_LOGIN_CODES === '1' ? ', DEV_LOGIN_CODES=1' : ''}) on the public address ${config.baseUrl}, and no email provider is set up. Set NODE_ENV=production, remove DEV_LOGIN_CODES, and set EMAIL_PROVIDER and EMAIL_API_KEY.`);
  process.exit(1);
}
if (!config.localBase && !mailer.configured() && !config.safeCopy) {
  console.warn(`[startup] WARNING: no email provider is set up on ${config.baseUrl}. Nobody can receive a login code until EMAIL_PROVIDER and EMAIL_API_KEY are set (or Admin → Settings → Email).`);
}

const router = new Router();
require('./src/routes/app')(router);
require('./src/routes/integrations')(router);
require('./src/routes/admin')(router);
require('./src/routes/referrals')(router);
require('./src/routes/media')(router);
/* VooSquare Affiliates (src/aff): tracking links, affiliate app API, back office, stats API and provider webhooks. */
require('./src/routes/aff')(router);
require('./src/routes/aff-admin')(router);
/* VooSquare Academy (paced schools, exams and certificates inside the Academy). Content loads from src/seed/school on boot. */
const school = require('./src/school');
school.load();
school.routes(router);
/* Teaching voice: narration clips for the lessons (ElevenLabs or OpenAI), served from /voice/<file>.mp3. */
require('./src/voice').routes(router);
/* VooSquare Academy's own website (voosquareacademy.com): public catalog and previews, and the one-tap switch between the
 * two sites (src/academy.js). Its pages are served below, by host. */
const academy = require('./src/academy');
academy.routes(router);
/* Admin run-the-place tools: feature switches, What's new, backups, Today list and quick search. install() wraps every
 * route above with the feature switches (areas turned off, maintenance mode, paused sign-ups), so keep it last. */
const features = require('./src/features');
features.routes(router);
require('./src/flags').routes(router); // rollout flags for new features (off → team → % → everyone)
require('./src/backups').routes(router);
require('./src/routes/ops')(router);
require('./src/legal').routes(router); // /privacy, /terms and Admin → Legal (QA-3)
require('./src/account').routes(router); // Delete my account (POST /api/me/delete) and the public /delete-account page
require('./src/ugc').routes(router); // Report a message, block a member, Admin → Community → Reports, the app review sign-in
features.install(router);
require('./src/backups').start();
if (!config.safeCopy) require('./src/aff').start(); // SAFE_COPY=1: no affiliate jobs on a copy of production data
const uploads = require('./src/uploads');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.css', '.json', '.svg', '.txt', '.webmanifest']);
const fileCache = new Map(); // path -> { mtime, raw, gz }

function sendFile(req, res, file, { noCache = false } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  let entry = fileCache.get(file);
  if (!entry || entry.mtime !== st.mtimeMs) {
    const raw = fs.readFileSync(file);
    entry = { mtime: st.mtimeMs, raw, gz: COMPRESSIBLE.has(ext) && raw.length > 1024 ? zlib.gzipSync(raw, { level: 9 }) : null, etag: `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"` };
    if (st.size < 8_000_000) fileCache.set(file, entry);
  }
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304); res.end(); return true; }
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream', ETag: entry.etag,
    'Cache-Control': noCache || ext === '.html' ? 'no-cache' : (file.includes(`${path.sep}assets${path.sep}`) || file.includes(`${path.sep}email${path.sep}`) ? 'public, max-age=604800' : 'public, max-age=3600'),
  };
  if (path.basename(file) === 'widget.js') headers['Access-Control-Allow-Origin'] = '*';
  const useGz = entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (useGz) { headers['Content-Encoding'] = 'gzip'; headers.Vary = 'Accept-Encoding'; }
  const body = useGz ? entry.gz : entry.raw;
  headers['Content-Length'] = body.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/* Content Security Policy. Scripts only from this site (no inline scripts or handlers anywhere). Inline styles stay
 * allowed (style attributes are used for layout values). Images may come from any https address because the team can
 * paste image links in the admin. The admin email preview is a sandboxed srcdoc iframe (about:srcdoc, allowed). */
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob: https:", "media-src 'self' blob:",
  "connect-src 'self'", "frame-src 'self'", "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'",
  "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join('; ');
const PERMISSIONS = 'camera=(), microphone=(), geolocation=()';
const CORS_PATHS = [/^\/api\/widget\//, /^\/api\/v1\//, /^\/oauth\/token$/, /^\/oauth\/userinfo$/, /^\/api\/avatar\//];

/* Request timeouts (PT-3). requestTimeout limits how long a client may take to SEND its request (headers and body), so a
 * slow or stalled upload cannot hold a connection forever. Live updates (/api/stream) are not affected: an SSE request is
 * complete as soon as its headers arrive, and the open response is kept alive by the ping every 25 s. */
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 120_000;
const server = http.createServer({ connectionsCheckingInterval: Math.min(30_000, Math.max(250, Math.floor(REQUEST_TIMEOUT_MS / 4))) }, async (req, res) => {
  const started = now();
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end(); }
  const pathname = url.pathname;
  const siteCookie = academy.overrideCookie(url); // testing only, never in production: ?site=academy|voosquare
  if (siteCookie) res.setHeader('Set-Cookie', [siteCookie]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Security headers on every response (HTML pages, the small server-rendered pages and JSON alike). No page of
  // VooSquare may be framed; the support widget runs on other sites as a script, never in an iframe.
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('Permissions-Policy', PERMISSIONS);
  res.setHeader('X-Frame-Options', 'DENY');
  if (config.secure || config.prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');

  if (CORS_PATHS.some((re) => re.test(pathname))) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  }

  const match = router.match(req.method, pathname);
  if (match) {
    const cookies = parseCookies(req.headers.cookie);
    let rawBody = null;
    const setCookies = siteCookie ? [siteCookie] : [];
    const ctx = {
      req, res, url, params: match.params, cookies,
      site: academy.siteOf(req, url, cookies), // 'voosquare' or 'academy' (src/academy.js)
      query: Object.fromEntries(url.searchParams),
      ip: clientIp(req),
      user: null, handled: false,
      setCookie(c) { setCookies.push(c); res.setHeader('Set-Cookie', setCookies); },
      async raw() { if (!rawBody) rawBody = await readBody(req); return rawBody; },
      async json() { const b = await this.raw(); if (!b.length) return {}; try { return JSON.parse(b.toString('utf8')); } catch { throw new HttpError(400, 'Send valid JSON.'); } },
      async formOrJson() { const b = await this.raw(); const s = b.toString('utf8'); if (/json/.test(req.headers['content-type'] || '')) { try { return JSON.parse(s || '{}'); } catch { throw new HttpError(400, 'Send valid JSON.'); } } return Object.fromEntries(new URLSearchParams(s)); },
      redirect(to) { this.handled = true; res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' }); res.end(); },
      html(status, body) { this.handled = true; res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(body); },
    };
    try {
      ctx.user = A.loadUser(ctx);
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (mutating && pathname.startsWith('/api/') && !match.route.opts.noCsrf && req.headers['x-vs'] !== '1') {
        throw new HttpError(403, 'Request blocked. Refresh the page and try again.');
      }
      const out = await match.route.handler(ctx);
      if (ctx.handled || res.writableEnded || res.headersSent) return;
      if (out === undefined) { res.writeHead(204); return res.end(); }
      sendJson(res, 200, out);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error(`[${req.method} ${pathname}]`, e);
      if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
      sendJson(res, status, { error: status >= 500 && config.prod && !e.status ? 'Something went wrong on our side. Try again.' : e.message, ...(e.extra || {}) });
    } finally {
      if (!config.prod && pathname.startsWith('/api/') && pathname !== '/api/stream') console.log(`${req.method} ${pathname} ${res.statusCode} ${now() - started}ms`);
    }
    return;
  }

  // API callers (the app, the tools) always get JSON errors, never the HTML 404 page or an empty 405 (docs/API_VERSIONING.md, rule 5).
  if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Not found.' });
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  /* VooSquare Academy's site: the landing (/), /learn, /login, robots, sitemap, icons, and redirects to VooSquare for
   * VooSquare-only paths (src/academy.js). On the VooSquare host it only keeps the academy's shells off. */
  if (academy.serve(req, res, url, academy.siteOf(req, url, parseCookies(req.headers.cookie)), sendFile)) return;

  /* Referral links: /r/<code> */
  const ref = /^\/r\/([a-z0-9]{3,12})\/?$/i.exec(pathname);
  if (ref) {
    res.writeHead(302, { 'Set-Cookie': `vs_ref=${ref[1].toLowerCase()}; Path=/; Max-Age=${60 * 86400}; SameSite=Lax${config.secure ? '; Secure' : ''}`, Location: '/?ref=' + ref[1].toLowerCase() + '#join' });
    return res.end();
  }

  /* Static files */
  const pub = config.publicDir;
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { rel = pathname; }
  const file = path.normalize(path.join(pub, rel));
  if (file.startsWith(pub + path.sep) && !rel.endsWith('/') && sendFile(req, res, file)) return;

  /* Affiliate site: every page on affiliate.<domain> (and /affiliates on the main host) is the affiliate app shell. */
  if ((String(req.headers.host || '').toLowerCase().startsWith('affiliate.') && !pathname.startsWith('/admin')) || pathname === '/affiliates' || pathname.startsWith('/affiliates/')) {
    if (sendFile(req, res, path.join(pub, 'affiliate.html'), { noCache: true })) return;
  }

  /* App shells */
  if (pathname === '/admin' || pathname.startsWith('/admin/')) { if (sendFile(req, res, path.join(pub, 'admin.html'), { noCache: true })) return; }
  if (pathname === '/app' || pathname.startsWith('/app/')) { if (sendFile(req, res, path.join(pub, 'app.html'), { noCache: true })) return; }
  if (pathname === '/' || pathname === '/login' || pathname.startsWith('/blog') || pathname === '/premium' || pathname === '/pricing' || pathname === '/academy' || pathname === '/community') {
    if (sendFile(req, res, path.join(pub, 'index.html'), { noCache: true })) return;
  }
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  const nf = path.join(pub, '404.html');
  res.end(fs.existsSync(nf) ? fs.readFileSync(nf) : '<h1>Not found</h1>');
});

server.headersTimeout = Math.min(66_000, REQUEST_TIMEOUT_MS); // all request headers within this time
// Idle keep-alive sockets must close before headersTimeout runs out, or a reused connection would get a 408.
server.keepAliveTimeout = Math.max(500, Math.min(65_000, server.headersTimeout - 1000));
server.requestTimeout = REQUEST_TIMEOUT_MS; // the whole request (headers + body); live-update responses stay open
server.listen(config.port, () => {
  console.log(`VooSquare running on ${config.baseUrl} (port ${config.port})`);
  console.log(`Database: ${config.dbPath}`);
  if (config.safeCopy) console.log('SAFE_COPY is on: a copy of production data. No emails go out and affiliate jobs are off.');
  console.log(`Email: ${mailer.configured() ? 'ready' : 'not configured (codes print here; set EMAIL_PROVIDER and EMAIL_API_KEY)'}`);
  if (!config.ownerEmail) console.log('Tip: set OWNER_EMAIL so your account becomes the owner on first login.');
});
mailer.startWorker();

/* Clean up expired rows every hour. */
setInterval(() => {
  const t = now();
  D.run('DELETE FROM sessions WHERE expires<?', t);
  D.run('DELETE FROM login_codes WHERE expires<?', t - 86400_000);
  D.run('DELETE FROM sso_codes WHERE expires<?', t);
  D.run('DELETE FROM auth_handoffs WHERE expires<?', t - 86400_000); // one-tap switch links (60 s); the audit log keeps the history
  try { uploads.cleanup(); } catch (e) { console.error('[uploads] cleanup', e.message); }
  try { require('./src/payments').expireStale(t); } catch (e) { console.error('[orders] expire', e.message); } // unpaid transfer/crypto orders → 'expired'
}, 3600_000).unref();
setTimeout(() => { try { uploads.cleanup(); } catch { /* ignore */ } }, 30_000).unref();

/* Invite-only rooms: close approval windows that ran out and hand freed seats to the waitlist. */
const roomApps = require('./src/applications');
const tickApps = () => { try { roomApps.expireStale(); roomApps.promoteWaitlist(); } catch (e) { console.error('[applications]', e.message); } };
setInterval(tickApps, 10 * 60_000).unref();
setTimeout(tickApps, 15_000).unref();

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    console.log(`${sig} received, shutting down`);
    server.close(() => { try { D.db.close(); } catch { /* ignore */ } process.exit(0); });
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
