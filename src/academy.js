'use strict';
/*
 * VooSquare Academy's own website (voosquareacademy.com) and the one-tap switch between it and VooSquare.
 *
 * Same app, same database, same Voo ID, same progress and certificates. Only the front door differs:
 *  - Host routing (server.js calls siteOf + serve): voosquareacademy.com, www.voosquareacademy.com and every host in
 *    ACADEMY_HOSTS get the academy site: / is the landing page (public/academy.html), /learn the member app in academy mode
 *    (public/learn.html), /login and /signup the sign-in page. VooSquare-only paths go to VOOSQUARE_URL. Outside production,
 *    ?site=academy (or ?site=voosquare) switches a browser for testing (a session cookie keeps the choice).
 *  - Public catalog and previews: GET /api/academy/catalog (titles, minutes and counts only) and
 *    GET /api/academy/preview/lessons/:id (only the lessons a new free member could open: school.previewLessonIds).
 *  - One-tap switch. Sessions are per host, so a signed-in member moves across with a single-use link:
 *      POST /api/auth/handoff { target, next }  (signed in, x-vs header, rate limited) → { url }
 *      GET  /auth/handoff?t=<token>&next=<path> on the target host: used once, within 60 seconds, by the site it was made
 *           for, while the session that made it is still signed in (so log out, "log out everywhere" and a ban end it),
 *           for a member who is not suspended. It signs in like the login does and goes to `next`, a same-site path only.
 *      GET  /auth/handoff/go?target=&next=  a page that makes the switch for a signed-in member (or sends a visitor to sign
 *           up first and comes back): used by "Join our community" for people who are not signed in yet.
 *    Only the SHA-256 of the token is stored (auth_handoffs, migration 010). Every redemption and refusal is in the audit log.
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const config = require('./config');
const D = require('./db');
const A = require('./auth');
const { now, rid, sha256, fail, limit, json, esc, closeSessionStreams } = require('./util');

const SITES = ['voosquare', 'academy'];
const HANDOFF_TTL = 60_000;
const NAMES = { voosquare: 'VooSquare', academy: 'VooSquare Academy' };

/* ------------------------------------------------------------------ which site a request is for */
const hostOf = (req) => String((req && req.headers && req.headers.host) || '').toLowerCase().replace(/\.$/, '').replace(/:\d+$/, '');
/** 'academy' for the academy's hosts (and, outside production, ?site=academy or its cookie), otherwise 'voosquare'. */
function siteOf(req, url, cookies) {
  if (config.academyHosts.includes(hostOf(req))) return 'academy';
  if (!config.prod) {
    const q = url && url.searchParams.get('site');
    if (q === 'academy' || q === 'voosquare') return q;
    if (cookies && cookies.vs_site === 'academy') return 'academy';
  }
  return 'voosquare';
}
/** Testing only (never in production): ?site=academy|voosquare is remembered for the browser session. */
function overrideCookie(url) {
  if (config.prod) return '';
  const q = url.searchParams.get('site');
  if (q === 'academy') return 'vs_site=academy; Path=/; SameSite=Lax';
  if (q === 'voosquare') return 'vs_site=; Path=/; SameSite=Lax; Max-Age=0';
  return '';
}
const baseFor = (site) => (site === 'academy' ? config.academyUrl : config.voosquareUrl);

/**
 * A path on the same site, or the site's home. Relative only: one leading slash, never `//` or `/\`, no backslash,
 * whitespace or control character anywhere (browsers drop tabs and newlines, which could turn `/\t/x` into `//x`).
 */
function safeNext(v, site) {
  const def = site === 'academy' ? '/learn' : '/app';
  const s = typeof v === 'string' ? v : '';
  if (!s || s.length > 400 || s[0] !== '/' || s[1] === '/' || /[\\\u0000-\u0020\u007f-\u00a0\u2028\u2029]/.test(s)) return def;
  try {
    const u = new URL(s, 'http://site.invalid');
    if (u.origin !== 'http://site.invalid') return def;
    const out = u.pathname + u.search + u.hash;
    return out.startsWith('//') ? def : out;
  } catch { return def; }
}

/* ------------------------------------------------------------------ the one-tap switch */
function redeemUrl(target, token, next) {
  const q = new URLSearchParams({ t: token, next });
  if (!config.prod) q.set('site', target); // lets a single test host play both sites; ignored in production
  return `${baseFor(target)}/auth/handoff?${q}`;
}
const audit = (userId, action, detail) => D.insert('audit', { user_id: userId, action, detail: String(detail).slice(0, 500), created_at: now() });

/** Small server-rendered page (refused switch, the switch in progress), in the VooSquare Academy look of /verify. */
function page(site, title, body, { script = '' } = {}) {
  const brand = site === 'academy'
    ? '<span class="vf-lock"><b>Voo<span>Square</span> Academy</b><small>The school for media buyers</small></span>'
    : '<span class="vf-lock"><b>Voo<span>Square</span></b><small>Media buying, squared.</small></span>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)} · ${esc(NAMES[site])}</title><link rel="icon" type="image/svg+xml" href="/assets/logo-icon.svg"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Instrument+Serif:ital@1&display=swap">
<link rel="stylesheet" href="/css/shared.css"><link rel="stylesheet" href="/css/school.css"></head>
<body class="vf-body vf-dark"><main class="vf"><a class="vf-brand" href="/"><img src="/assets/logo-icon.svg" alt="" width="34" height="34">${brand}</a>
<section class="vf-card">${body}</section></main>${script ? `<script src="${script}"></script>` : ''}</body></html>`;
}
function refused(ctx, site, next) {
  ctx.res.setHeader('Referrer-Policy', 'no-referrer');
  const login = `/login?next=${encodeURIComponent(next)}`;
  ctx.html(410, page(site, 'Link expired', `<div class="vf-status no"><span class="vf-dot"></span>This switch link no longer works</div>
    <h1 class="vf-nf">Log in to continue.</h1><p class="vf-note">Switch links work once, for one minute, while you are still signed in where you tapped it. Log in here with your Voo ID email: it is the same account.</p>
    <p style="margin-top:22px"><a class="btn btn-g" href="${esc(login)}">Log in to ${esc(NAMES[site])}</a></p>`));
}

/* ------------------------------------------------------------------ public catalog (titles, minutes, counts) */
let catMemo = { at: 0, key: null, data: null };
function publicCatalog() {
  const school = require('./school');
  const voice = require('./voice');
  const cat0 = school.catalog();
  if (catMemo.data && catMemo.key === cat0 && catMemo.at > now() - 60_000) return catMemo.data;
  const free = school.previewLessonIds();
  const state = school.stateFor(null, now()); // what a visitor may already see: published schools, modules and lesson titles
  const slides = new Map(cat0.lessons.map((l) => [l.id, l.steps_n || 0]));
  const schools = state.filter((s) => s.published).map((s) => {
    const mods = s.modules.map((m) => ({
      id: m.id, order: m.order, title: m.title, summary: m.summary, minutes: m.minutes, exam: !(m.exam && m.exam.none),
      lessons: m.lessons.map((l, i) => ({ id: l.id, n: i + 1, title: l.title, minutes: l.minutes, slides: slides.get(l.id) || 0, free: free.has(l.id) })),
    }));
    const lessons = mods.reduce((a, m) => a + m.lessons.length, 0);
    return {
      slug: s.slug, title: s.title, subtitle: s.subtitle, level: s.level, track: s.track, vertical: s.vertical, accent: s.accent || '',
      premium: s.premium, order: s.order, cert_title: school.brand(s.cert_title), final: !(s.final && s.final.none),
      modules_total: mods.length, lessons_total: lessons, minutes: mods.reduce((a, m) => a + m.minutes, 0),
      slides: mods.reduce((a, m) => a + m.lessons.reduce((b, l) => b + l.slides, 0), 0),
      narrator: voice.narratorName(s.slug), modules: mods,
    };
  }).filter((s) => s.lessons_total > 0);
  const sum = (k) => schools.reduce((a, s) => a + s[k], 0);
  const data = {
    counts: { schools: schools.length, modules: sum('modules_total'), lessons: sum('lessons_total'), slides: sum('slides'), minutes: sum('minutes'), hours: Math.round(sum('minutes') / 60) },
    schools, free: [...free],
    voice: voice.voiceOn() && !!D.get("SELECT 1 FROM voice_clips WHERE status='ready' AND file<>'' LIMIT 1"),
    academy_url: config.academyUrl, voosquare_url: config.voosquareUrl,
  };
  catMemo = { at: now(), key: cat0, data };
  return data;
}

/* ------------------------------------------------------------------ routes */
function routes(r) {
  r.get('/api/academy/catalog', (ctx) => {
    limit('acad-cat:' + ctx.ip, 2000, 10 * 60_000);
    return publicCatalog();
  });

  /* A full preview lesson for anyone, only when a brand-new free member could open it. The quiz is never sent (its
   * questions stay with members); the narration clips come with it and /voice/<file> lets visitors hear only those. */
  r.get('/api/academy/preview/lessons/:id', (ctx) => {
    limit('acad-prev:' + ctx.ip, 120, 10 * 60_000);
    const school = require('./school');
    const id = Number(ctx.params.id);
    const free = school.previewLessonIds();
    if (!Number.isInteger(id) || !free.has(id)) fail(403, 'Create your free account to watch this lesson.', { lock: { code: 'signup' } });
    const l = D.get('SELECT * FROM school_lessons WHERE id=? AND published=1', id);
    if (!l) fail(404, 'Lesson not found.');
    const st = school.findLesson(school.stateFor(null, now()), id);
    if (!st) fail(404, 'Lesson not found.');
    const rawSteps = json(l.steps, []);
    const { steps, refs } = school.resolveCards(rawSteps, null);
    const idx = st.m.lessons.findIndex((x) => x.id === id);
    const V = require('./voice');
    const voice = V.forMember(l, rawSteps, steps, null);
    // An uploaded intro track stays for members (/voice-music needs a login); visitors hear the bundled one.
    if (voice && voice.music && voice.music.custom) voice.music = { ...voice.music, url: V.DEFAULT_MUSIC_URL, custom: false };
    return {
      preview: true, refs,
      voice,
      lesson: {
        id: l.id, slug: l.slug, title: l.title, minutes: l.minutes, objectives: json(l.objectives, []), steps, takeaways: json(l.takeaways, []),
        action: l.action, glossary: json(l.glossary, []), quiz: [], quiz_count: school.lessonQuizCount(l), status: 'open', best: 0, total: 0, number: idx + 1, count: st.m.lessons.length,
      },
      module: { id: st.m.id, title: st.m.title, order: st.m.order, lessons: st.m.lessons.map((x) => ({ id: x.id, title: x.title, status: free.has(x.id) ? 'open' : 'locked' })) },
      school: { slug: st.s.slug, title: st.s.title, order: st.s.order, track: st.s.track },
      next: null,
    };
  });

  /* Mint: a single-use link that signs this member in on the other site. */
  r.post('/api/auth/handoff', async (ctx) => {
    const u = A.requireUser(ctx);
    const b = await ctx.json();
    const target = String(b.target || '');
    if (!SITES.includes(target)) fail(400, 'Choose where to switch to.');
    if (target === ctx.site) fail(400, `You are already on ${NAMES[target]}.`);
    limit('handoff-user:' + u.id, 30, 10 * 60_000);
    limit('handoff-ip:' + ctx.ip, 120, 10 * 60_000);
    const token = rid(32);
    const next = safeNext(b.next, target);
    const t = now();
    D.insert('auth_handoffs', { token_hash: sha256(token), user_id: u.id, target, session_hash: sha256(A.sessionToken(ctx)), next, created_at: t, expires: t + HANDOFF_TTL, used_at: 0, ip: String(ctx.ip || '').slice(0, 60) });
    return { url: redeemUrl(target, token, next), expires_in: HANDOFF_TTL / 1000 };
  });

  /* Redeem, on the target site. */
  r.get('/auth/handoff', (ctx) => {
    const site = ctx.site;
    const next = safeNext(ctx.query.next, site);
    try { limit('handoff-redeem:' + ctx.ip, 60, 10 * 60_000); } catch { return refused(ctx, site, next); }
    const tok = String(ctx.query.t || '');
    const row = tok.length >= 20 && tok.length <= 100 ? D.get('SELECT * FROM auth_handoffs WHERE token_hash=?', sha256(tok)) : null;
    const t = now();
    // Any refused use also burns the link, so a link that was tried in the wrong place can never be used later.
    const no = (why) => {
      if (row) { audit(row.user_id, 'auth.handoff_refused', `${why}: to ${site} from ${ctx.ip}`); if (!row.used_at) D.run('UPDATE auth_handoffs SET used_at=? WHERE token_hash=? AND used_at=0', t, row.token_hash); }
      return refused(ctx, site, next);
    };
    if (!row) return no('unknown');
    if (row.used_at) return no('already used');
    if (row.expires < t) return no('expired');
    if (row.target !== site) return no(`made for ${row.target}`);
    const user = D.get('SELECT id, banned FROM users WHERE id=?', row.user_id);
    if (!user || user.banned) return no('account suspended');
    if (row.created_at <= A.tokensRevokedAt(user.id)) return no('logged out everywhere');
    if (!D.get('SELECT 1 FROM sessions WHERE token_hash=? AND user_id=? AND expires>?', row.session_hash, user.id, t)) return no('session ended');
    // Someone else is signed in on this site: ask first, so a link sent by another person can never quietly sign this
    // browser into their account. The confirm code is tied to this browser's own session, so it cannot be put in a link.
    if (ctx.user && ctx.user.id !== user.id) {
      const cur = A.sessionToken(ctx) || '';
      const code = sha256('handoff-confirm:' + cur + ':' + row.token_hash).slice(0, 24);
      if (String(ctx.query.c || '') !== code) {
        const who = D.get('SELECT name, email FROM users WHERE id=?', user.id) || {};
        const first = (s2) => String(s2 || '').trim().split(/\s+/)[0] || 'another account';
        const masked = String(who.email || '').replace(/^(.).*(@.*)$/, '$1•••$2');
        const go = `/auth/handoff?t=${encodeURIComponent(tok)}&next=${encodeURIComponent(next)}&c=${code}`;
        ctx.res.setHeader('Referrer-Policy', 'no-referrer');
        return ctx.html(200, page(site, 'Switch account?', `<div class="vf-status"><span class="vf-dot"></span>You are signed in here as ${esc(first(ctx.user.name))}</div>
          <h1 class="vf-nf">Continue as ${esc(first(who.name))}?</h1><p class="vf-note">This link signs ${esc(NAMES[site])} into ${esc(masked || 'another account')}. Only continue if this is your account.</p>
          <p style="margin-top:22px"><a class="btn btn-g" href="${esc(go)}">Continue as ${esc(first(who.name))}</a> <a class="btn btn-w" href="${esc(next)}">Stay as ${esc(first(ctx.user.name))}</a></p>`));
      }
    }
    // Claim it atomically: two requests racing with the same token cannot both get in.
    if (!D.run('UPDATE auth_handoffs SET used_at=? WHERE token_hash=? AND used_at=0', t, row.token_hash).changes) return no('already used');
    if (!(ctx.user && ctx.user.id === user.id)) {
      // Whoever was signed in on this site before is signed out here (only here), then the member is signed in like a login.
      const old = A.sessionToken(ctx);
      if (old) { D.run('DELETE FROM sessions WHERE token_hash=?', sha256(old)); closeSessionStreams(sha256(old), 'logout'); }
      A.createSession(ctx, user.id);
    }
    audit(user.id, 'auth.handoff', `to ${site} (${String(ctx.req.headers.host || '').slice(0, 80)}) from ${ctx.ip}`);
    ctx.res.setHeader('Referrer-Policy', 'no-referrer');
    return ctx.redirect(next);
  });

  /* The switch as a page: signed in → it mints and goes (public/js/handoff-go.js); not signed in → sign up here first, then
   * come back to this page, which makes the switch. */
  r.get('/auth/handoff/go', (ctx) => {
    const site = ctx.site;
    const target = SITES.includes(ctx.query.target) && ctx.query.target !== site ? ctx.query.target : (site === 'academy' ? 'voosquare' : 'academy');
    const next = safeNext(ctx.query.next, target);
    const self = `/auth/handoff/go?target=${target}&next=${encodeURIComponent(next)}`;
    if (!ctx.user) return ctx.redirect(`/login?mode=${ctx.query.mode === 'login' ? 'login' : 'signup'}&next=${encodeURIComponent(self)}`);
    ctx.html(200, page(site, `Opening ${NAMES[target]}`, `<div class="vf-status ok"><span class="vf-dot"></span>Same Voo ID, you are signed in</div>
      <h1 class="vf-nf" data-handoff data-target="${esc(target)}" data-next="${esc(next)}">Opening ${esc(NAMES[target])}…</h1>
      <p class="vf-note" data-handoff-msg>One moment. If nothing happens, tap the button.</p>
      <p style="margin-top:22px"><button class="btn btn-g" type="button" data-handoff-go>Open ${esc(NAMES[target])}</button></p>`, { script: '/js/handoff-go.js' }));
  });
}

/* ------------------------------------------------------------------ the academy site's pages (server.js) */
const pageCache = new Map(); // file -> { mtime, raw, gz, etag }
/** The academy's HTML shells, with its public addresses filled in (canonical, Open Graph, links). */
function sendShell(req, res, file) {
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  let e = pageCache.get(file);
  if (!e || e.mtime !== st.mtimeMs) {
    const html = fs.readFileSync(file, 'utf8').split('%ACADEMY_URL%').join(esc(config.academyUrl)).split('%VOOSQUARE_URL%').join(esc(config.voosquareUrl));
    const raw = Buffer.from(html);
    e = { mtime: st.mtimeMs, raw, gz: zlib.gzipSync(raw, { level: 9 }), etag: `"a${raw.length.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"` };
    pageCache.set(file, e);
  }
  if (req.headers['if-none-match'] === e.etag) { res.writeHead(304); res.end(); return true; }
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = gz ? e.gz : e.raw;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ETag: e.etag, 'Content-Length': body.length, ...(gz ? { 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' } : {}) });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
function redirect(res, to, code = 302) { res.writeHead(code, { Location: to, 'Cache-Control': 'no-store' }); res.end(); return true; }
function text(req, res, type, body) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600', 'Content-Length': Buffer.byteLength(body) });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
/* Paths that only VooSquare has: on the academy host they go to the same path on VooSquare. */
const VOOSQUARE_ONLY = /^\/(app|admin|affiliates|blog|premium|pricing|community|r|a|go)(\/|$)/;

/**
 * Static-side routing for a non-API GET/HEAD. Returns true when it answered. On the academy site: the landing, /learn,
 * /login, robots, sitemap, icons and redirects; on VooSquare: keeps the academy's shells off the VooSquare host.
 */
function serve(req, res, url, site, sendFile) {
  const p = url.pathname;
  const pub = config.publicDir;
  if (site !== 'academy') {
    if (p === '/academy.html' || p === '/learn.html') return redirect(res, config.academyUrl + (p === '/learn.html' ? '/learn' : '/'));
    return false;
  }
  if (p === '/' || p === '/index.html' || p === '/academy.html' || p === '/login' || p === '/signup') {
    if (p === '/index.html' || p === '/academy.html') return redirect(res, '/' + url.search, 301);
    return sendShell(req, res, path.join(pub, 'academy.html'));
  }
  if (p === '/learn' || p.startsWith('/learn/')) return sendShell(req, res, path.join(pub, 'learn.html'));
  if (p === '/learn.html') return redirect(res, '/learn', 301);
  if (p === '/academy' || p === '/academy/') return redirect(res, '/', 301);
  if (p === '/robots.txt') return text(req, res, 'text/plain; charset=utf-8', `User-agent: *\nAllow: /\nDisallow: /learn\nDisallow: /auth/\nDisallow: /api/\nDisallow: /verify/\n\nSitemap: ${config.academyUrl}/sitemap.xml\n`);
  if (p === '/sitemap.xml') {
    const urls = ['/', '/privacy', '/terms'].map((x, i) => `  <url><loc>${esc(config.academyUrl + x)}</loc><changefreq>${i ? 'yearly' : 'weekly'}</changefreq><priority>${i ? '0.3' : '1.0'}</priority></url>`).join('\n');
    return text(req, res, 'application/xml; charset=utf-8', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  }
  // Icons: the exact VooSquare icon.
  if (p === '/favicon.ico' || p === '/favicon.png') return sendFile(req, res, path.join(pub, 'assets', 'logo-icon.png'));
  if (p === '/favicon.svg') return sendFile(req, res, path.join(pub, 'assets', 'logo-icon.svg'));
  if (p === '/apple-touch-icon.png' || p === '/apple-touch-icon-precomposed.png') return sendFile(req, res, path.join(pub, 'assets', 'apple-touch-icon.png'));
  if (/\.html$/.test(p)) return redirect(res, config.voosquareUrl + p);
  if (VOOSQUARE_ONLY.test(p)) return redirect(res, config.voosquareUrl + p + url.search);
  return false;
}

module.exports = { siteOf, overrideCookie, safeNext, routes, serve, publicCatalog, baseFor, SITES, HANDOFF_TTL };
