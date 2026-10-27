'use strict';
/* VooSquare Academy's own website (src/academy.js): host routing, the public catalog and previews (nothing locked leaks,
 * preview audio rules), the one-tap switch between the two sites (success, single use, expiry, wrong site, open redirects,
 * signed-out mint, suspended member, CSRF, log out everywhere), and "Voo School" gone from what people see.
 * Its own server and database: VooSquare on 127.0.0.1, the academy on the host "localhost" (ACADEMY_HOSTS), same port. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

module.exports = async function academy({ check }) {
  const ROOT = path.join(__dirname, '..');
  let PORT = 0;
  for (let i = 0; i < 40 && !PORT; i++) {
    const p = 5100 + Math.floor(Math.random() * 600);
    const free = await new Promise((r) => { const s = require('node:net').createServer(); s.once('error', () => r(false)); s.listen(p, () => s.close(() => r(true))); });
    if (free) PORT = p;
  }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-academy-'));
  const VOICE = path.join(TMP, 'voice');
  const VSQ = `http://127.0.0.1:${PORT}`;
  const ACAD = `http://localhost:${PORT}`;
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: ROOT, stdio: 'ignore',
    env: { ...process.env, PORT: String(PORT), BASE_URL: VSQ, ACADEMY_HOSTS: 'localhost, learn.example.test', ACADEMY_URL: ACAD, DATABASE_PATH: path.join(TMP, 'db.sqlite'), UPLOADS_DIR: path.join(TMP, 'up'), BACKUPS_DIR: path.join(TMP, 'bk'), VOICE_DIR: VOICE, OWNER_EMAIL: 'owner@acad.test', NODE_ENV: 'test', EMAIL_PROVIDER: '', ELEVENLABS_API_KEY: '', OPENAI_API_KEY: '', SCHOOL_EXTRA_DIR: '' },
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 80; i++) { try { if ((await fetch(VSQ + '/healthz')).ok) break; } catch { /* starting */ } await sleep(120); }

  /* A request to 127.0.0.1 with any Host header (the academy is "localhost"; real names too). */
  function req(host, method, p, { cookie = '', body, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
      const r = http.request({ host: '127.0.0.1', port: PORT, method, path: p, headers: { host, ...(cookie ? { cookie } : {}), ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), ...headers } }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null; try { json = JSON.parse(text); } catch { /* html */ }
          const sc = [].concat(res.headers['set-cookie'] || []);
          const sess = sc.map((c) => c.split(';')[0]).find((c) => c.startsWith('vs_sess=') && c.length > 8);
          resolve({ status: res.statusCode, headers: res.headers, text, json, cookie: sess || '' });
        });
      });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }
  const V = `127.0.0.1:${PORT}`, AH = `localhost:${PORT}`;
  const login = async (host, email, name) => {
    const s = await req(host, 'POST', '/api/auth/start', { body: { email, name }, headers: { 'x-vs': '1' } });
    const v = await req(host, 'POST', '/api/auth/verify', { body: { email, code: s.json.dev_code }, headers: { 'x-vs': '1' } });
    return v.cookie;
  };
  const { DatabaseSync } = require('node:sqlite');
  const sql = new DatabaseSync(path.join(TMP, 'db.sqlite'));

  try {
    console.log('Academy site: host routing');
    const home = await req(AH, 'GET', '/');
    check('academy host: / is the landing (Learn media buying, canonical on ACADEMY_URL)', home.status === 200 && /Learn media/.test(home.text) && /buying\./.test(home.text) && home.text.includes(`<link rel="canonical" href="${ACAD}/">`) && home.text.includes('Choose your vertical') && home.text.includes('The school for media buyers'));
    for (const h of ['voosquareacademy.com', 'www.voosquareacademy.com', 'learn.example.test', 'VooSquareAcademy.com']) {
      const r = await req(h, 'GET', '/');
      check(`academy host ${h}: gets the landing`, r.status === 200 && /va-hero/.test(r.text));
    }
    const vsHome = await req(V, 'GET', '/');
    check('VooSquare host: / is unchanged (the VooSquare site, not the academy landing)', vsHome.status === 200 && !/va-hero/.test(vsHome.text) && /VooSquare/.test(vsHome.text));
    check('VooSquare host: /app, /login and /admin unchanged', (await req(V, 'GET', '/app')).status === 200 && (await req(V, 'GET', '/login')).status === 200 && (await req(V, 'GET', '/admin')).status === 200);
    check('VooSquare host: /learn is not a page there', (await req(V, 'GET', '/learn')).status === 404);
    const learn = await req(AH, 'GET', '/learn');
    check('academy host: /learn is the learner app in academy mode', learn.status === 200 && /data-mode="learn"/.test(learn.text) && /<title>VooSquare Academy<\/title>/.test(learn.text));
    check('academy host: /login and /signup are the sign-in page', (await req(AH, 'GET', '/login')).status === 200 && /va-auth/.test((await req(AH, 'GET', '/signup')).text));
    const app = await req(AH, 'GET', '/app?x=1');
    check('academy host: VooSquare-only paths go to VooSquare', app.status === 302 && app.headers.location === `${VSQ}/app?x=1` && (await req(AH, 'GET', '/community')).headers.location === `${VSQ}/community` && (await req(AH, 'GET', '/index.html')).status === 301);
    const robots = await req(AH, 'GET', '/robots.txt'); const sm = await req(AH, 'GET', '/sitemap.xml');
    check('academy host: robots.txt and sitemap.xml on the academy address', robots.status === 200 && robots.text.includes(`Sitemap: ${ACAD}/sitemap.xml`) && /Disallow: \/learn/.test(robots.text) && sm.status === 200 && sm.text.includes(`<loc>${ACAD}/</loc>`));
    check('VooSquare host: no academy robots or sitemap', (await req(V, 'GET', '/robots.txt')).status === 404 && (await req(V, 'GET', '/sitemap.xml')).status === 404);
    const fav = await req(AH, 'GET', '/favicon.ico'); const ati = await req(AH, 'GET', '/apple-touch-icon.png');
    check('academy host: favicon and apple-touch icon are the VooSquare icon', fav.status === 200 && /image\/png/.test(fav.headers['content-type']) && ati.status === 200 && home.text.includes('href="/assets/logo-icon.svg"') && home.text.includes('href="/assets/apple-touch-icon.png"'));
    check('academy landing: SEO (title, description, Open Graph)', /<title>VooSquare Academy · The school for media buyers<\/title>/.test(home.text) && /<meta name="description" content="[^"]{60,}">/.test(home.text) && home.text.includes(`<meta property="og:url" content="${ACAD}/">`) && /og:title/.test(home.text));
    check('academy pages: CSP header, no inline scripts or handlers', /script-src 'self'/.test(home.headers['content-security-policy'] || '') && !/<script(?![^>]*\bsrc=)[^>]*>/i.test(home.text + learn.text) && !/\son[a-z]+=/i.test(home.text + learn.text));
    const ov = await req(V, 'GET', '/?site=academy');
    check('testing override: ?site=academy shows the academy on any host outside production (and is remembered)', ov.status === 200 && /va-hero/.test(ov.text) && /vs_site=academy/.test([].concat(ov.headers['set-cookie'] || []).join(';')) && /va-hero/.test((await req(V, 'GET', '/', { cookie: 'vs_site=academy' })).text));
    check('verify pages answer on both hosts', (await req(AH, 'GET', '/verify/VS-NOPE0-NOPE0')).status === 404 && /VooSquare Academy/.test((await req(V, 'GET', '/verify/VS-NOPE0-NOPE0')).text));

    console.log('Academy site: public catalog and previews');
    const cat = (await req(AH, 'GET', '/api/academy/catalog')).json;
    const all = cat.schools.flatMap((s) => s.modules.flatMap((m) => m.lessons));
    const found = cat.schools.find((s) => s.slug === 'foundations');
    const first = found.modules[0].lessons[0];
    check('catalog: real counts from the content', cat.counts.lessons === all.length && all.length > 300 && cat.counts.slides > 1000 && cat.counts.hours > 10 && cat.counts.schools >= 8);
    const vFirst = cat.schools.filter((s) => s.track === 'vertical').map((s) => s.modules[0].lessons[0].id);
    check('catalog: only lesson 1 of Foundations plays before sign-up (vertical schools are free for members, not a public teaser)', cat.free.length === 1 && cat.free[0] === first.id && first.free && all.filter((l) => l.free).length === 1 && vFirst.every((id) => !cat.free.includes(id)));
    const catText = JSON.stringify(cat);
    check('catalog: titles and counts only, never lesson content, scripts, quizzes or answers', !/"(steps|say|say_intro|quiz|answer|objectives|takeaways|glossary|exam|options|why)"\s*:\s*[[{"]/.test(catText.replace(/"exam":(true|false)/g, '')));
    check('catalog: narrators named per school (Michael for the main path, Grace for the verticals)', found.narrator === 'Michael' && cat.schools.filter((s) => s.track === 'vertical').every((s) => s.narrator === 'Grace' && !s.premium));
    const pv = await req(AH, 'GET', `/api/academy/preview/lessons/${first.id}`);
    check('preview: the free lesson plays for a signed-out visitor, without its quiz', pv.status === 200 && pv.json.preview && pv.json.lesson.steps.length > 3 && pv.json.lesson.quiz.length === 0 && pv.json.lesson.quiz_count === 5 && !/"answer"/.test(pv.text));
    const second = found.modules[0].lessons[1];
    const vert = cat.schools.find((s) => s.slug === 'v-trading').modules[0].lessons[0];
    const vert2 = cat.schools.find((s) => s.slug === 'v-trading').modules[0].lessons[1];
    const lockedR = await req(AH, 'GET', `/api/academy/preview/lessons/${second.id}`);
    const premR = await req(AH, 'GET', `/api/academy/preview/lessons/${vert2.id}`);
    const vertR = await req(AH, 'GET', `/api/academy/preview/lessons/${vert.id}`);
    check('preview: locked lessons (Foundations lesson 2, vertical lessons 1 and 2) ask visitors to sign up, with nothing in the reply', vertR.status === 403 && vertR.json.lock.code === 'signup' && !vertR.json.lesson && lockedR.status === 403 && lockedR.json.lock.code === 'signup' && !lockedR.json.lesson && premR.status === 403 && !premR.json.lesson && (await req(AH, 'GET', '/api/academy/preview/lessons/999999')).status === 403 && (await req(AH, 'GET', '/api/academy/preview/lessons/abc')).status === 403);
    // Preview audio: clips of the free lesson only, for visitors; everything else still needs a member who can open it.
    fs.mkdirSync(VOICE, { recursive: true });
    const mp3 = Buffer.concat([Buffer.from([0xFF, 0xFB, 0x90, 0x64]), Buffer.alloc(800)]);
    const fFree = crypto.randomBytes(32).toString('hex') + '.mp3', fLocked = crypto.randomBytes(32).toString('hex') + '.mp3';
    fs.writeFileSync(path.join(VOICE, fFree), mp3); fs.writeFileSync(path.join(VOICE, fLocked), mp3);
    const ins = sql.prepare("INSERT INTO voice_clips(lesson_id, slot, text, file, status, duration_ms, updated_at) VALUES(?,?,?,?, 'ready', 1000, ?)");
    ins.run(first.id, 'intro', 'x', fFree, Date.now()); ins.run(second.id, 'intro', 'y', fLocked, Date.now());
    check('preview audio: a visitor hears a clip of the free lesson', (await req(AH, 'GET', '/voice/' + fFree)).status === 200);
    check('preview audio: a visitor cannot fetch a clip of a locked lesson', (await req(AH, 'GET', '/voice/' + fLocked)).status === 401 && (await req(V, 'GET', '/voice/' + fLocked)).status === 401);
    // A signed-in member who has not enrolled yet watches the same preview on the landing: its narration must play too.
    const freshC = await login(AH, 'fresh-preview@acad.test', 'Fresh Preview');
    check('preview audio: a signed-in member who has not enrolled hears the free lesson too (not a locked clip)', !!freshC && (await req(AH, 'GET', '/voice/' + fFree, { cookie: freshC })).status === 200 && (await req(AH, 'GET', '/voice/' + fLocked, { cookie: freshC })).status === 403);
    const ownerC = await login(V, 'owner@acad.test', 'Owner');
    await req(V, 'PUT', '/api/admin/features', { cookie: ownerC, headers: { 'x-vs': '1' }, body: { voice: false } });
    check('preview audio: nothing for visitors while the teaching voice is off', (await req(AH, 'GET', '/voice/' + fFree)).status === 401);
    await req(V, 'PUT', '/api/admin/features', { cookie: ownerC, headers: { 'x-vs': '1' }, body: { voice: true } });
    await req(V, 'PUT', '/api/admin/features', { cookie: ownerC, headers: { 'x-vs': '1' }, body: { academy: false } });
    check('catalog and previews follow the Academy switch', (await req(AH, 'GET', '/api/academy/catalog')).status === 403 && (await req(AH, 'GET', `/api/academy/preview/lessons/${first.id}`)).status === 403);
    await req(V, 'PUT', '/api/admin/features', { cookie: ownerC, headers: { 'x-vs': '1' }, body: { academy: true } });

    console.log('Academy site: one-tap switch');
    const mem = await login(V, 'switch@acad.test', 'Sam Switch');
    const uid = sql.prepare("SELECT id FROM users WHERE email='switch@acad.test'").get().id;
    const mint = (cookie, target = 'academy', next = '/learn#academy', host = V, headers = { 'x-vs': '1' }) => req(host, 'POST', '/api/auth/handoff', { cookie, headers, body: { target, next } });
    const parts = (u) => { const x = new URL(u); return { host: x.host, path: x.pathname + x.search }; };
    const redeem = (u, host, cookie = '') => req(host || parts(u).host, 'GET', parts(u).path, { cookie });
    check('mint: signed out gets 401', (await mint('')).status === 401);
    check('mint: without the x-vs header (CSRF) gets 403', (await mint(mem, 'academy', '/learn', V, {})).status === 403);
    check('mint: an unknown site or the site you are on is refused', (await mint(mem, 'elsewhere')).status === 400 && (await mint(mem, 'voosquare')).status === 400);
    const m1 = await mint(mem);
    const row1 = sql.prepare('SELECT * FROM auth_handoffs WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(uid);
    const tok = new URL(m1.json.url).searchParams.get('t');
    check('mint: a single-use link on the academy address; only the token hash is stored, 60 seconds', m1.status === 200 && m1.json.url.startsWith(`${ACAD}/auth/handoff?t=`) && m1.json.expires_in === 60 && row1 && row1.token_hash === crypto.createHash('sha256').update(tok).digest('hex') && !JSON.stringify(row1).includes(tok) && row1.expires - row1.created_at === 60_000 && row1.target === 'academy');
    const r1 = await redeem(m1.json.url, AH);
    check('redeem: signs in on the academy and goes to next', r1.status === 302 && r1.headers.location === '/learn#academy' && !!r1.cookie);
    const meA = await req(AH, 'GET', '/api/me', { cookie: r1.cookie });
    check('redeem: same Voo ID on the academy host, no second login', meA.json.user && meA.json.user.id === uid);
    check('redeem: written to the audit log', !!sql.prepare("SELECT 1 FROM audit WHERE user_id=? AND action='auth.handoff'").get(uid));
    check('redeem: a link works only once', (await redeem(m1.json.url, AH)).status === 410 && !!sql.prepare("SELECT 1 FROM audit WHERE user_id=? AND action='auth.handoff_refused' AND detail LIKE 'already used%'").get(uid));
    const back = await mint(r1.cookie, 'voosquare', '/app#community', AH);
    const rb = await redeem(back.json.url, V);
    check('the reverse works: academy → VooSquare community, signed in', back.status === 200 && back.json.url.startsWith(`${VSQ}/auth/handoff?`) && rb.status === 302 && rb.headers.location === '/app#community' && (await req(V, 'GET', '/api/me', { cookie: rb.cookie })).json.user.id === uid);
    const m2 = await mint(mem);
    sql.prepare('UPDATE auth_handoffs SET expires=? WHERE token_hash=?').run(Date.now() - 1, crypto.createHash('sha256').update(new URL(m2.json.url).searchParams.get('t')).digest('hex'));
    check('redeem: an expired link is refused', (await redeem(m2.json.url, AH)).status === 410);
    const m3 = await mint(mem);
    const wrong = new URL(m3.json.url); wrong.searchParams.set('site', 'voosquare');
    check('redeem: a link made for the academy does not work on VooSquare (and is burnt by the try)', (await req(V, 'GET', wrong.pathname + wrong.search)).status === 410 && (await redeem(m3.json.url, AH)).status === 410);
    check('redeem: an unknown or malformed token is refused', (await req(AH, 'GET', '/auth/handoff?t=nope')).status === 410 && (await req(AH, 'GET', '/auth/handoff?t=' + 'a'.repeat(43))).status === 410 && (await req(AH, 'GET', '/auth/handoff')).status === 410);
    // Open redirects: whatever next says, the member lands on a path of the same site.
    const bad = ['//evil.example/x', '/\\evil.example', 'https://evil.example/', '/\t/evil.example', '\\\\evil.example', 'javascript:alert(1)', '/%0a/evil.example', ' /x', '/x\\y', '//%09evil.example'];
    let safe = true; const seen = [];
    for (const n of bad) {
      const mm = await mint(mem, 'academy', n);
      const u = new URL(mm.json.url); u.searchParams.set('next', n);
      const rr = await req(AH, 'GET', u.pathname + u.search);
      seen.push(rr.headers.location);
      if (rr.status !== 302 || !/^\/(?![\/\\])/.test(rr.headers.location) || /[\\\s]/.test(rr.headers.location)) safe = false;
    }
    check('redeem: no open redirect (//, \\, schemes, tabs, newlines all land on a same-site path)', safe && seen.filter((l) => l === '/learn').length >= bad.length - 1, seen);
    const okNext = await mint(mem, 'academy', '/learn?welcome=community#school/foundations');
    check('redeem: a normal path with query and hash is kept', (await redeem(okNext.json.url, AH)).headers.location === '/learn?welcome=community#school/foundations');
    // Suspended member, log out, log out everywhere.
    const m4 = await mint(mem);
    sql.prepare('UPDATE users SET banned=1 WHERE id=?').run(uid);
    check('redeem: refused for a suspended member', (await redeem(m4.json.url, AH)).status === 410);
    sql.prepare('UPDATE users SET banned=0 WHERE id=?').run(uid);
    const m5 = await mint(mem);
    await req(V, 'POST', '/api/auth/logout', { cookie: mem, headers: { 'x-vs': '1' } });
    check('redeem: refused once the session that made it logged out', (await redeem(m5.json.url, AH)).status === 410);
    const mem2 = await login(V, 'switch@acad.test');
    const m6 = await mint(mem2);
    await req(V, 'GET', '/oauth/logout', { cookie: mem2 });
    check('redeem: refused after "log out everywhere"', (await redeem(m6.json.url, AH)).status === 410);
    const mem3 = await login(V, 'switch@acad.test');
    const m7 = await mint(mem3);
    await req(V, 'PATCH', `/api/admin/customers/${uid}`, { cookie: ownerC, headers: { 'x-vs': '1' }, body: { banned: true } });
    const banned = sql.prepare('SELECT banned FROM users WHERE id=?').get(uid).banned;
    check('redeem: refused after a ban from the admin (sessions end)', (await redeem(m7.json.url, AH)).status === 410, { banned });
    sql.prepare('UPDATE users SET banned=0 WHERE id=?').run(uid);
    const other = await login(AH, 'other@acad.test', 'Other Person');
    const mem4 = await login(V, 'switch@acad.test');
    const m8 = await mint(mem4);
    const r8a = await redeem(m8.json.url, AH, other);
    check('redeem: another person signed in here gets asked first (no silent account swap)', r8a.status === 200 && /Continue as/.test(r8a.text || r8a.body || '') && (await req(AH, 'GET', '/api/me', { cookie: other })).json.user.email === 'other@acad.test', r8a.status);
    const forged = await redeem(m8.json.url + '&c=' + 'f'.repeat(24), AH, other);
    check('redeem: a made-up confirm code does not switch', forged.status === 200 && (await req(AH, 'GET', '/api/me', { cookie: other })).json.user.email === 'other@acad.test');
    const cAt = /&amp;c=([a-f0-9]{24})/.exec(r8a.text || r8a.body || '');
    const r8 = await redeem(m8.json.url + '&c=' + (cAt ? cAt[1] : 'x'), AH, other);
    check('redeem: after "Continue", it replaces whoever was signed in on that site (only there)', r8.status === 302 && (await req(AH, 'GET', '/api/me', { cookie: r8.cookie })).json.user.id === uid && (await req(AH, 'GET', '/api/me', { cookie: other })).json.user === null && (await req(V, 'GET', '/api/me', { cookie: mem4 })).json.user.id === uid);
    const go0 = await req(AH, 'GET', '/auth/handoff/go?target=voosquare&next=/app%23community');
    const go1 = await req(V, 'GET', '/auth/handoff/go?target=academy&next=/learn%3Fwelcome%3Dcommunity', { cookie: mem4 });
    check('the switch page: signed out → sign up first and come back; signed in → it makes the switch', go0.status === 302 && go0.headers.location.startsWith('/login?mode=signup&next=%2Fauth%2Fhandoff%2Fgo%3Ftarget%3Dvoosquare') && go1.status === 200 && /data-target="academy"/.test(go1.text) && /data-next="\/learn\?welcome=community"/.test(go1.text) && /<script src="\/js\/handoff-go.js"><\/script>/.test(go1.text));
    check('the switch page script exists and posts with the CSRF header', /'x-vs': '1'/.test(fs.readFileSync(path.join(ROOT, 'public', 'js', 'handoff-go.js'), 'utf8')));

    console.log('Academy site: the name');
    const offenders = [];
    const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|html|css|json|md)$/.test(f.name)) { const t = fs.readFileSync(p, 'utf8'); if (/Voo School|Voo Academy|learnVOO/.test(t)) offenders.push(path.relative(ROOT, p)); } } };
    walk(path.join(ROOT, 'public'));
    walk(path.join(ROOT, 'src'));
    walk(path.join(ROOT, 'docs'));
    // Allowed: a shipped migration (never edited) and the one-time rename of saved titles and emails in src/seed.js.
    const left = offenders.filter((f) => !/^src[\\/]migrations[\\/]/.test(f) && f !== path.join('src', 'seed.js'));
    check('"Voo School" and "Voo Academy" are gone from everything people see (public, src, docs, emails, lessons)', !left.length, left);
    const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'emails', 'templates.json'), 'utf8')).certificate_issued;
    check('certificate email: VooSquare Academy, and it says how the school was finished', /VooSquare Academy/.test(tpl.name + tpl.html) && /\{\{finish_note\}\}/.test(tpl.html + tpl.text));
  } finally {
    try { sql.close(); } catch { /* ignore */ }
    srv.kill('SIGTERM');
    await sleep(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  }
};
