/* VooSquare Academy website (voosquareacademy.com, public/academy.html). Every number on the page comes from the real
 * content (/api/academy/catalog: lesson, slide and hour counts) and every lesson shown is a real one. The free lesson
 * plays in the real lesson player (app-school.js, preview mode, /api/academy/preview): sound and captions only after a tap.
 * Sign-in uses the same email-code flow as VooSquare (/api/auth/start, /api/auth/verify). "Join our community" switches
 * a signed-in learner to VooSquare already signed in (APP.switchTo, src/academy.js). No inline scripts (CSP). */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { esc, icon } = VS;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const params = new URLSearchParams(location.search);
  const AUTH = /^\/(login|signup)\/?$/.test(location.pathname);
  const S = { me: null, cat: null, site: null, lesson: null };
  const VORDER = ['trading', 'igaming', 'finance', 'nutra', 'sweeps'];
  const VSCENE = { trading: 'trading', igaming: 'sports', finance: 'finance', nutra: 'nutra', sweeps: 'sweeps' };
  const SHORT = { foundations: 'Foundations', operator: 'Operator', scale: 'Scale and Lead' };
  const shortName = (s) => SHORT[s.slug] || s.title;
  const hours = (min) => (min >= 90 ? `${Math.round(min / 60)} hours` : `${min} minutes`);
  const hm = (min) => (min >= 60 ? `${Math.round(min / 60)} h` : `${min} min`);
  const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many || one + 's'}`;
  /** A path on this site, or ''. Same rules as the server (src/academy.js safeNext). */
  const safeNext = (n) => {
    n = String(n || '');
    if (!/^\/(?![\/\\])/.test(n) || /[\u0000-\u0020\u007f\\]/.test(n)) return '';
    try { const u = new URL(n, location.origin); return u.origin === location.origin ? u.pathname + u.search + u.hash : ''; } catch { return ''; }
  };
  const vsqUrl = () => (S.cat && S.cat.voosquare_url) || '';
  const signupHref = (next) => `/signup${next ? '?next=' + encodeURIComponent(next) : ''}`;

  /* ================================================================ boot */
  async function boot() {
    const [me, cat, site] = await Promise.allSettled([VS.api('/api/me'), VS.api('/api/academy/catalog'), VS.api('/api/site')]);
    S.me = me.status === 'fulfilled' && me.value ? me.value.user : null;
    S.cat = cat.status === 'fulfilled' ? cat.value : null;
    S.site = site.status === 'fulfilled' ? site.value : null;
    if (AUTH) { authPage(); return; }
    account();
    navScroll();
    if (!S.cat) { const r = $('#libRows'); if (r) r.innerHTML = `<div class="va-wrap"><p class="va-empty">The lessons did not load. Check your connection and refresh the page.</p></div>`; return; }
    facts(); hero(); verticals(); path(); library(); how(); community();
  }

  /* ================================================================ nav and account-aware buttons */
  function account() {
    const u = S.me;
    if (u) {
      $('#acNavR').innerHTML = `<a class="va-me" href="/learn" aria-label="Continue learning"><span class="av">${VS.avatar(u.avatar || {})}</span><span class="lbl">Continue learning</span></a>`;
      $$('[data-signup]').forEach((a) => { a.href = '/learn'; a.textContent = 'Continue learning'; });
    }
  }
  function navScroll() {
    const nav = $('#acNav');
    const on = () => nav.classList.toggle('solid', window.scrollY > 24);
    on(); window.addEventListener('scroll', on, { passive: true });
  }

  /* ================================================================ hero */
  function facts() {
    const c = S.cat.counts;
    $$('#heroFacts [data-k]').forEach((d) => {
      const v = c[d.dataset.k] || 0;
      d.textContent = '0';
      if (reduce()) d.textContent = v.toLocaleString('en-US'); else VS.countUp(d, v);
    });
  }
  async function hero() {
    $('#heroCrew').innerHTML = A.crewHtml();
    const id = (S.cat.free || [])[0];
    const play = $('#heroPlay');
    if (!id) { play.hidden = true; $('#heroScreen').classList.add('va-screen-empty'); return; }
    let d;
    try { d = await VS.api('/api/academy/preview/lessons/' + id); } catch { play.hidden = true; return; }
    S.lesson = d;
    const L = d.lesson;
    $('#heroLessonT').textContent = `${shortName(d.school)} · Lesson ${L.number}: ${L.title}`;
    const voice = d.voice && d.voice.available;
    $('#heroPlay b').textContent = voice ? 'Watch with the narrator' : 'Watch the free lesson';
    $('#heroPlaySub').textContent = voice ? `${L.minutes} min · voice and captions start when you tap` : `${L.minutes} min · ${L.steps.length} slides`;
    play.addEventListener('click', () => openPreview(id));
    frame(L, d);
  }
  /** The device frame: the free lesson's first slides, silent, one after another. Static with reduced motion. */
  function frame(L, d) {
    const fit = $('#heroFit'), screen = $('#heroScreen'), bars = $('#heroBars');
    const steps = L.steps.slice(0, 7);
    let plan = [];
    try { plan = window.VSA ? VSA.plan(steps, { school: d.school.slug, module: d.module.title, title: L.title }) : []; } catch { plan = []; }
    bars.innerHTML = steps.map(() => '<i><b></b></i>').join('');
    const fitNow = () => { const w = screen.clientWidth; if (w) fit.style.setProperty('--s', (w / 760).toFixed(4)); };
    fitNow();
    if (window.ResizeObserver) new ResizeObserver(fitNow).observe(screen); else window.addEventListener('resize', fitNow);
    let i = -1, timer = 0, visible = true;
    const DUR = 5600;
    const show = (n) => {
      i = n % steps.length;
      const s = steps[i];
      const el = document.createElement('div');
      el.className = 'va-slide';
      el.innerHTML = `<div class="vl-stage va-slide-stage" data-v="${esc(s.v)}">${VSL.render(s)}</div><div class="va-slide-cap"><span>Slide ${i + 1}</span><b>${esc(s.h || '')}</b></div>`;
      const stage = el.querySelector('.vl-stage');
      if (window.VSA) { try { VSA.dress(stage, s, plan[i]); } catch { /* the slide works without its art */ } }
      fit.appendChild(el);
      requestAnimationFrame(() => el.classList.add('on'));
      try { VSL.animate(stage); } catch { /* static */ }
      const old = $$('.va-slide', fit).filter((x) => x !== el);
      old.forEach((x) => { x.classList.remove('on'); x.classList.add('off'); setTimeout(() => x.remove(), 900); });
      $$('i', bars).forEach((b, k) => { b.className = k < i ? 'done' : k === i ? 'cur' : ''; });
      $('#heroCount').textContent = `${i + 1} / ${steps.length}`;
    };
    const tick = () => { clearTimeout(timer); if (reduce() || !visible || document.hidden) return; timer = setTimeout(() => { show(i + 1); tick(); }, DUR); };
    show(0);
    if (reduce()) { bars.classList.add('still'); return; }
    tick();
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { visible = es[0].isIntersecting; bars.classList.toggle('paused', !visible); if (visible) tick(); else clearTimeout(timer); }, { threshold: 0.2 }).observe(screen);
    document.addEventListener('visibilitychange', () => { bars.classList.toggle('paused', document.hidden); if (!document.hidden) tick(); });
  }
  function openPreview(id) {
    A.openSchoolLesson(id, null, {
      preview: true,
      onSignup: () => { location.href = S.me ? '/learn' : signupHref('/learn'); },
      onLocked: () => lockedSheet(null),
    });
  }

  /* ================================================================ choose your vertical */
  function verticals() {
    const vs = S.cat.schools.filter((s) => s.track === 'vertical').sort((a, b) => VORDER.indexOf(a.vertical) - VORDER.indexOf(b.vertical));
    const main = S.cat.schools.find((s) => s.track === 'main');
    const vnar = (vs.find((s) => s.narrator) || {}).narrator, mnar = main && main.narrator;
    $$('[data-narr="vertical"]').forEach((b) => { if (vnar) b.textContent = vnar; else b.closest('p').lastChild && (b.closest('p').innerHTML = 'After Foundations, go deep on the one market you want to run. Each vertical school has its own offers, rules, funnels and numbers.'); });
    $$('[data-narr="main"]').forEach((b) => { if (mnar) b.textContent = mnar; });
    const line = $('[data-narr-line]'); if (line && mnar && vnar) line.textContent = `${mnar} reads the main path; ${vnar} reads the vertical schools.`;
    if (!vs.length) { $('#verticals').hidden = true; return; }
    const list = $('#vertList'), panel = $('#vertPanel');
    list.innerHTML = vs.map((v, k) => `<button class="va-vtab" role="tab" id="vt-${esc(v.vertical)}" aria-selected="${k === 0}" aria-controls="vertPanel" tabindex="${k === 0 ? 0 : -1}" data-v="${esc(v.vertical)}" style="--acc:${esc(v.accent || '#C9F65B')}">
      <span class="va-vtab-ic">${A.vglyph(v.vertical)}</span><span class="va-vtab-t"><b>${esc(v.title)}</b><small>${v.modules_total} modules · ${v.lessons_total} lessons</small></span></button>`).join('');
    const paint = (v) => {
      panel.style.setProperty('--acc', v.accent || '#C9F65B');
      panel.setAttribute('aria-labelledby', 'vt-' + v.vertical);
      const next = `/learn#school/${v.slug}`;
      const cta = S.me ? `<a class="btn btn-l" href="${esc(next)}">Open the ${esc(v.title)} school</a>` : `<a class="btn btn-l" href="${esc(signupHref(next))}">Start with Foundations, free</a>`;
      const scene = window.VSA ? VSA.scene(VSCENE[v.vertical] || 'laptop') : '';
      panel.innerHTML = `<div class="va-vp" data-key="${esc(v.vertical)}">
        <div class="va-vp-art vl-stage">${window.VSA ? VSA.ambient() : ''}<div class="la-art">${scene}</div></div>
        <div class="va-vp-body">
          <div class="va-vp-h"><h3>${esc(v.title)}</h3>${v.premium ? '<span class="va-pill">Premium</span>' : ''}</div>
          <p class="va-vp-sub">${esc(v.subtitle)}</p>
          <p class="va-vp-meta">${v.modules_total} modules, ${v.lessons_total} lessons, about ${hours(v.minutes)}${v.narrator ? `. Taught by ${esc(v.narrator)}` : ''}.</p>
          <ol class="va-vp-mods">${v.modules.map((m) => `<li><span>${m.order}</span><b>${esc(m.title)}</b><small>${m.lessons.length} lessons</small></li>`).join('')}</ol>
          <div class="va-vp-foot">${cta}<span class="va-vp-cert">Ends with the ${esc(v.cert_title)} certificate</span></div>
        </div></div>`;
      if (window.VSA) VSA.parallax(panel.querySelector('.va-vp-art'));
    };
    const select = (btn, focus) => {
      $$('.va-vtab', list).forEach((b) => { const on = b === btn; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
      if (focus) btn.focus();
      paint(vs.find((v) => v.vertical === btn.dataset.v));
    };
    list.addEventListener('click', (e) => { const b = e.target.closest('.va-vtab'); if (b) select(b); });
    list.addEventListener('keydown', (e) => {
      const tabs = $$('.va-vtab', list); const k = tabs.indexOf(document.activeElement);
      if (k < 0) return;
      const n = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (n) { e.preventDefault(); select(tabs[(k + n + tabs.length) % tabs.length], true); }
      if (e.key === 'Home') { e.preventDefault(); select(tabs[0], true); }
      if (e.key === 'End') { e.preventDefault(); select(tabs[tabs.length - 1], true); }
    });
    paint(vs[0]);
  }

  /* ================================================================ the path */
  function path() {
    const main = S.cat.schools.filter((s) => s.track === 'main');
    const vs = S.cat.schools.filter((s) => s.track === 'vertical');
    const station = (n, title, level, lines, cert, cls = '') => `<li class="va-st ${cls}" style="--i:${n}"><span class="va-st-n">${n}</span>
      <div class="va-st-b"><small>${esc(level)}</small><h3>${esc(title)}</h3><p>${lines}</p><span class="va-st-cert">${icon('trophy')}${esc(cert)}</span></div></li>`;
    let html = main.map((s, k) => station(k + 1, shortName(s), s.level, `${s.modules_total} modules · ${s.lessons_total} lessons · about ${hours(s.minutes)}`, s.cert_title)).join('');
    if (vs.length) {
      const avg = Math.round(vs.reduce((a, s) => a + s.minutes, 0) / vs.length);
      html += station(main.length + 1, 'Your vertical', vs.some((v) => v.premium) ? 'Premium' : 'Free', `${vs.length} to choose from: ${vs.map((v) => esc(v.title)).join(', ')}. About ${hours(avg)} each`, 'Vertical Specialist certificate', 'va-st-v');
    }
    const route = $('#pathRoute');
    route.innerHTML = html;
    if ('IntersectionObserver' in window && !reduce()) {
      const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { route.classList.add('in'); io.disconnect(); } }, { threshold: 0.25 });
      io.observe(route);
    } else route.classList.add('in');
  }

  /* ================================================================ the lessons (a film library) */
  function library() {
    const c = S.cat.counts;
    const free = new Set(S.cat.free || []);
    $('#libSub').textContent = `${plural(c.lessons, 'narrated lesson')} with animated slides and captions, about ${c.hours} hours in all, arranged by school.${free.size ? ` ${free.size === 1 ? 'The first lesson is' : 'The first lessons are'} free to watch now, no account needed.` : ''}`;
    const order = { main: 0, vertical: 1, extra: 2 };
    const schools = S.cat.schools.slice().sort((a, b) => (order[a.track] - order[b.track]) || (a.track === 'vertical' ? VORDER.indexOf(a.vertical) - VORDER.indexOf(b.vertical) : a.order - b.order));
    const note = (s, k) => (s.premium ? `${VS.pmark('sm', 'still')}Premium` : s.track === 'main' && k === 0 ? 'Free to start' : s.track === 'main' ? `After ${esc(shortName(schools[k - 1]))}` : 'Free with your account');
    $('#libRows').innerHTML = schools.map((s, k) => `<section class="va-row" style="--acc:${esc(s.accent || '#C9F65B')}" aria-label="${esc(s.title)}">
      <div class="va-wrap va-row-h"><div><h3>${esc(s.title)}</h3><p>${s.lessons_total} lessons · ${hm(s.minutes)}${s.narrator ? ` · read by ${esc(s.narrator)}` : ''}</p></div><span class="va-row-note">${note(s, k)}</span>
        <span class="va-row-nav"><button type="button" data-scroll="-1" aria-label="Scroll ${esc(s.title)} back">${icon('left')}</button><button type="button" data-scroll="1" aria-label="Scroll ${esc(s.title)} forward">${icon('arrow')}</button></span></div>
      <div class="va-scroll" tabindex="-1"><ol class="va-track">${s.modules.map((m) => m.lessons.map((l) => card(s, m, l, free.has(l.id))).join('')).join('')}</ol></div></section>`).join('');
    // Posters are drawn only when a card comes near the screen (hundreds of lessons, a few on screen at a time).
    const draw = (el) => {
      if (el.dataset.drawn || !window.VSA) return;
      el.dataset.drawn = 1;
      try { el.innerHTML = VSA.scene(VSA.pick(el.dataset.t, { school: el.dataset.s, module: el.dataset.m, title: el.dataset.t })); } catch { /* plain poster */ }
    };
    const posters = $$('.va-poster-art');
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { draw(e.target); io.unobserve(e.target); } }), { rootMargin: '200px 400px' });
      posters.forEach((p) => io.observe(p));
    } else posters.slice(0, 40).forEach(draw);
    const rows = $('#libRows');
    rows.addEventListener('click', (e) => {
      const sb = e.target.closest('[data-scroll]');
      if (sb) { const sc = sb.closest('.va-row').querySelector('.va-scroll'); sc.scrollBy({ left: Number(sb.dataset.scroll) * sc.clientWidth * 0.85, behavior: reduce() ? 'auto' : 'smooth' }); return; }
      const b = e.target.closest('[data-lesson]');
      if (!b) return;
      const id = Number(b.dataset.lesson);
      if (b.dataset.free) { openPreview(id); return; }
      if (S.me) { location.href = `/learn#module/${b.dataset.mod}`; return; }
      lockedSheet(b);
    });
    const syncNav = (row) => { const sc = row.querySelector('.va-scroll'); const [p, n] = row.querySelectorAll('[data-scroll]'); p.disabled = sc.scrollLeft < 8; n.disabled = sc.scrollLeft + sc.clientWidth > sc.scrollWidth - 8; };
    $$('.va-row', rows).forEach((row) => { syncNav(row); row.querySelector('.va-scroll').addEventListener('scroll', () => syncNav(row), { passive: true }); });
    window.addEventListener('resize', () => $$('.va-row', rows).forEach(syncNav));
  }
  function card(s, m, l, isFree) {
    const label = `${l.title}. ${shortName(s)}, module ${m.order}, lesson ${l.n}. ${l.minutes} minutes. ${isFree ? 'Free to watch now.' : 'Opens with your free account.'}`;
    return `<li><button type="button" class="va-card${isFree ? ' free' : ''}" data-lesson="${l.id}" data-mod="${m.id}"${isFree ? ' data-free="1"' : ''} aria-label="${esc(label)}">
      <span class="va-poster vl-stage"><span class="va-poster-art" data-t="${esc(l.title)}" data-s="${esc(s.slug)}" data-m="${esc(m.title)}"></span>
        <span class="va-badge">${isFree ? `<span class="va-free">${icon('play')}Free</span>` : `<span class="va-lock-b">${icon('lock')}</span>`}</span><span class="va-dur">${l.minutes} min</span>
        ${isFree ? `<span class="va-bigplay" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg></span>` : ''}</span>
      <span class="va-card-t"><b>${esc(l.title)}</b><small>Module ${m.order} · Lesson ${l.n} · ${l.slides} slides</small></span></button></li>`;
  }
  function lockedSheet(btn) {
    const title = btn ? btn.querySelector('.va-card-t b').textContent : 'This lesson';
    const next = btn ? `/learn#module/${btn.dataset.mod}` : '/learn';
    const m = A.modal(`${A.modalHead('Opens with your free account')}<div class="vs-modal-b va-sheet"><p><b>${esc(title)}</b> plays in order, after the lessons before it. Create your free account, enrol in Foundations and your progress saves as you go.</p>
      <div class="am-actions"><button class="btn btn-w" data-close>Not now</button><a class="btn btn-l" href="${esc(signupHref(next))}">Start learning free</a></div><p class="va-sheet-s">Already have a Voo ID? <a href="/login?next=${esc(encodeURIComponent(next))}">Log in</a></p></div>`, { cls: 'am-sm va-modal' });
    return m;
  }

  /* ================================================================ how a lesson works: the real card and certificate */
  function how() {
    const now = Date.now();
    const face = { skin: 2, hair: 0, hairColor: 0, eyes: 0, mouth: 0, acc: 1, shirt: 0, bg: 0 };
    const main = S.cat.schools.find((s) => s.slug === 'foundations') || S.cat.schools[0];
    if (!main) return;
    $('#howCard').innerHTML = A.studentCardHtml({ name: 'Your name', number: 'VS-2026-00421', school: main.title, level: main.level || 'Beginner', issued_at: now, avatar: face, track: 'main', premium: false, accent: '' });
    const site = (() => { try { return new URL(S.cat.academy_url).host.replace(/^www\./, ''); } catch { return 'voosquareacademy.com'; } })();
    $('#howCert').innerHTML = `<div class="cert-fit">${A.certHtml({ title: main.cert_title, name: 'Your name', school: main.title, school_order: 1, track: 'main', issued_at: now, code: 'VS-EXAMP-LE000', verify_url: `${S.cat.academy_url}/verify/VS-EXAMP-LE000`, final: main.final, site })}</div>`;
    const f = $('#howCert .cert-fit');
    const fit = () => { if (f.clientWidth) f.style.setProperty('--s', Math.min(1, f.clientWidth / 1120)); };
    fit();
    if (window.ResizeObserver) new ResizeObserver(fit).observe(f); else window.addEventListener('resize', fit);
    if (A.cardTilt) A.cardTilt($('#howShow'));
  }

  /* ================================================================ community */
  function community() {
    const site = S.site || {};
    const rooms = (site.rooms || []).slice().sort((a, b) => ['free', 'premium', 'paid'].indexOf(a.access) - ['free', 'premium', 'paid'].indexOf(b.access));
    // A real sample of what is there: a few free rooms, then one Premium and one invite-only room when they exist.
    const shown = [...rooms.filter((r) => r.access === 'free').slice(0, 4), ...rooms.filter((r) => r.access === 'premium').slice(0, 1), ...rooms.filter((r) => r.access === 'paid').slice(0, 1)];
    const free = rooms.filter((r) => r.access === 'free').length;
    const tag = { free: 'Free', premium: 'Premium', paid: 'Invite only' };
    $('#commRooms').innerHTML = rooms.length ? `<p class="va-k2">${plural(rooms.length, 'room')} on VooSquare${free ? `, ${free} free with your account` : ''}</p>
      <ul class="va-roomlist">${shown.map((r) => `<li><span class="va-room-pic">${r.image && /^\/(?!\/)/.test(r.image) ? `<img src="${esc(r.image)}" alt="" loading="lazy" decoding="async">` : VS.productIcon({ icon: 'voosquare' }, 'sm')}</span><span><b>${esc(r.name)}</b><small>${esc(r.topic || '')}</small></span><em class="va-acc ${esc(r.access)}">${esc(r.access === 'paid' && !r.approval_required ? 'Paid' : tag[r.access] || '')}</em></li>`).join('')}</ul>` : '';
    const tools = (site.products || []).filter((p) => !p.hub);
    $('#commTools').innerHTML = tools.length ? `<p class="va-k2">The same Voo ID opens ${plural(tools.length, 'Zedapex tool')}</p><div class="va-toolrow">${tools.slice(0, 9).map((p) => `<span class="va-tool" title="${esc(p.name)}">${VS.productIcon(p, 'sm')}<small>${esc(p.name)}</small></span>`).join('')}</div>` : '';
    const ctas = $('#commCtas');
    if (S.me) {
      ctas.innerHTML = `<button class="btn btn-l va-btn-big" type="button" data-switch>Switch to VooSquare</button><span class="va-cta-note">Opens the community rooms, signed in as ${esc(S.me.name || 'you')}.</span>`;
      ctas.querySelector('[data-switch]').addEventListener('click', (e) => A.switchTo('voosquare', '/app#community', e.currentTarget));
    } else {
      // Sign up on VooSquare, then come back here signed in on both (src/academy.js /auth/handoff/go).
      const back = '/auth/handoff/go?target=academy&next=' + encodeURIComponent('/learn?welcome=community');
      ctas.innerHTML = `<a class="btn btn-l va-btn-big" href="${esc(vsqUrl() + back)}">Join the community</a><a class="va-cta-alt" href="/login">I have a Voo ID</a>`;
    }
  }

  /* ================================================================ /login and /signup */
  function authPage() {
    const box = $('#acAuth');
    box.hidden = false;
    const card = $('#authCard');
    const next = safeNext(params.get('next')) || '/learn';
    let mode = location.pathname.startsWith('/signup') || params.get('mode') === 'signup' ? 'signup' : 'login';
    document.title = `${mode === 'signup' ? 'Create your free account' : 'Log in'} · VooSquare Academy`;
    const head = `<a class="va-lock va-auth-lock" href="/"><img src="/assets/logo-icon.svg" alt="" width="40" height="40"><span><b>Voo<span>Square</span> Academy</b><small>The school for media buyers</small></span></a>`;
    if (S.me) {
      card.innerHTML = `${head}<div class="va-au-signed"><span class="av">${VS.avatar(S.me.avatar || {})}</span><h1>You're signed in, ${esc(A.firstName(S.me.name))}.</h1><p>${esc(S.me.email || '')}</p>
        <a class="btn btn-l btn-block va-btn-big" href="${esc(next)}">Continue learning</a><button class="va-au-link" type="button" data-other>Use another account</button></div>`;
      card.querySelector('[data-other]').addEventListener('click', async () => { try { await VS.api('/api/auth/logout', { body: {} }); } catch { /* ignore */ } S.me = null; authPage(); });
      return;
    }
    const st = { email: '', name: '', dev: '', timer: 0, busy: false };
    const step1 = (msg) => {
      clearInterval(st.timer);
      card.innerHTML = `${head}<form class="va-au" novalidate>
        <h1>${mode === 'signup' ? 'Create your free account' : 'Log in to learn'}</h1>
        <p class="va-au-sub">${mode === 'signup' ? 'One free Voo ID for the Academy, the VooSquare community and every Zedapex tool. No card needed.' : 'Use your Voo ID email. We will send you a 6-digit code. No passwords.'}</p>
        <div class="va-seg" role="tablist"><button type="button" role="tab" data-m="signup" aria-selected="${mode === 'signup'}">Create account</button><button type="button" role="tab" data-m="login" aria-selected="${mode === 'login'}">Log in</button></div>
        ${mode === 'signup' ? `<label class="va-field"><span>Your name</span><input class="inp" name="name" autocomplete="name" maxlength="60" placeholder="The name for your certificates" value="${esc(st.name)}"></label>` : ''}
        <label class="va-field"><span>Email</span><input class="inp" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@company.com" value="${esc(st.email)}"></label>
        <p class="va-err" role="alert" ${msg ? '' : 'hidden'}>${esc(msg || '')}</p>
        <button class="btn btn-l btn-block va-btn-big" type="submit">${mode === 'signup' ? 'Create my free account' : 'Send my code'}</button>
        ${mode === 'signup' ? '<p class="va-fine">By creating an account you agree to the <a href="/terms" target="_blank" rel="noopener">Terms of service</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.</p>' : '<p class="va-fine">New here? Enter the code and we create your free account.</p>'}
      </form>`;
      const f = card.querySelector('form');
      const say = (m) => { const e = f.querySelector('.va-err'); e.textContent = m; e.hidden = false; };
      f.addEventListener('input', () => { f.querySelector('.va-err').hidden = true; });
      $$('[data-m]', f).forEach((b) => b.addEventListener('click', () => { keep(); mode = b.dataset.m; history.replaceState(null, '', (mode === 'signup' ? '/signup' : '/login') + location.search); step1(); focus(); }));
      const keep = () => { if (f.name && f.name.value !== undefined && f.querySelector('[name=name]')) st.name = f.querySelector('[name=name]').value.trim(); st.email = f.querySelector('[name=email]').value.trim(); };
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); keep();
        if (mode === 'signup' && st.name.length < 2) { say('Add your name. It goes on your student card and certificates.'); f.querySelector('[name=name]').focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(st.email)) { say('Enter a valid email so we can send your code.'); f.querySelector('[name=email]').focus(); return; }
        const b = f.querySelector('[type=submit]'); b.classList.add('loading'); b.disabled = true;
        try { await send(); step2(); } catch (x) { say(x.message); b.classList.remove('loading'); b.disabled = false; }
      });
    };
    const send = async () => {
      const body = { email: st.email, coupon: VS.coupon() || undefined };
      if (mode === 'signup' && st.name) body.name = st.name;
      const r = await VS.api('/api/auth/start', { body });
      st.dev = r && r.dev_code ? String(r.dev_code) : '';
    };
    const step2 = () => {
      card.innerHTML = `${head}<form class="va-au" novalidate autocomplete="off">
        <h1>Check your email</h1><p class="va-au-sub">We sent a 6-digit code to <b>${esc(st.email)}</b>. <button type="button" class="va-au-link" data-back>Change</button></p>
        <div class="otp va-otp" role="group" aria-label="6-digit code">${[0, 1, 2, 3, 4, 5].map((k) => `<input inputmode="numeric" pattern="[0-9]*" maxlength="6" aria-label="Digit ${k + 1}" ${k === 0 ? 'autocomplete="one-time-code"' : 'autocomplete="off"'}>`).join('')}</div>
        <p class="va-err" role="alert" hidden></p>
        <button class="btn btn-l btn-block va-btn-big" type="submit">Verify and continue</button>
        <div class="va-au-row"><span>No email? Check spam.</span><button type="button" class="va-au-link" data-resend disabled>Resend in 30s</button></div>
        ${st.dev ? `<p class="va-dev">Dev code: <b>${esc(st.dev)}</b> <button type="button" class="va-au-link" data-devfill>Fill it</button></p>` : ''}
      </form>`;
      const f = card.querySelector('form'); const boxes = $$('.otp input', f);
      const say = (m) => { const e = f.querySelector('.va-err'); e.textContent = m; e.hidden = false; };
      const code = () => boxes.map((b) => b.value).join('');
      const put = (d, at) => { d.split('').slice(0, 6 - at).forEach((c, k) => { boxes[at + k].value = c; }); boxes[Math.min(at + d.length, 5)].focus(); if (code().length === 6) verify(); };
      boxes.forEach((b, k) => {
        b.addEventListener('input', () => { const v = b.value.replace(/\D/g, ''); if (v.length > 1) { put(v, v.length >= 6 ? 0 : k); return; } b.value = v; if (v && k < 5) boxes[k + 1].focus(); if (code().length === 6) verify(); });
        b.addEventListener('keydown', (e) => { if (e.key === 'Backspace' && !b.value && k > 0) { e.preventDefault(); boxes[k - 1].value = ''; boxes[k - 1].focus(); } });
        b.addEventListener('paste', (e) => { const d = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, ''); if (d) { e.preventDefault(); put(d.slice(0, 6), d.length >= 6 ? 0 : k); } });
      });
      const verify = async (nameNow) => {
        const c = code();
        if (c.length !== 6) { say('Enter all 6 digits.'); return; }
        if (st.busy) return; st.busy = true;
        const sb = f.querySelector('[type=submit]'); sb.classList.add('loading'); sb.disabled = true;
        try {
          const r = await VS.api('/api/auth/verify', { body: { email: st.email, code: c, name: nameNow || st.name || undefined, ask_name: true, coupon: VS.coupon() || undefined }, headers: { 'x-vs-fp': VS.fp() } });
          if (r && r.need_name) { askName(c); return; }
          done(r.user, r.isNew);
        } catch (x) { st.busy = false; sb.classList.remove('loading'); sb.disabled = false; say(x.message); boxes.forEach((b) => { b.value = ''; }); boxes[0].focus(); }
      };
      f.addEventListener('submit', (e) => { e.preventDefault(); verify(); });
      f.querySelector('[data-back]').addEventListener('click', () => step1());
      const dv = f.querySelector('[data-devfill]'); if (dv) dv.addEventListener('click', () => put(st.dev, 0));
      const rs = f.querySelector('[data-resend]'); let left = 30;
      const tick = () => { if (left > 0) { rs.textContent = `Resend in ${left}s`; rs.disabled = true; left--; } else { rs.textContent = 'Send a new code'; rs.disabled = false; clearInterval(st.timer); } };
      clearInterval(st.timer); tick(); st.timer = setInterval(tick, 1000);
      rs.addEventListener('click', async () => { rs.disabled = true; try { await send(); VS.toast('New code sent'); step2(); } catch (x) { say(x.message); rs.disabled = false; } });
      setTimeout(() => boxes[0].focus(), 60);
    };
    const askName = (c) => {
      card.innerHTML = `${head}<form class="va-au" novalidate><h1>Welcome to VooSquare Academy</h1><p class="va-au-sub">This email is new here. What name should go on your student card?</p>
        <label class="va-field"><span>Your name</span><input class="inp" name="name" autocomplete="name" maxlength="60" value="${esc(st.name)}"></label><p class="va-err" role="alert" hidden></p>
        <button class="btn btn-l btn-block va-btn-big" type="submit">Create my free account</button>
        <p class="va-fine">By creating an account you agree to the <a href="/terms" target="_blank" rel="noopener">Terms of service</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.</p></form>`;
      const f = card.querySelector('form'); const inp = f.querySelector('[name=name]');
      setTimeout(() => inp.focus(), 60);
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); st.name = inp.value.trim();
        const err = f.querySelector('.va-err');
        if (st.name.length < 2) { err.textContent = 'Add your name. It goes on your student card and certificates.'; err.hidden = false; return; }
        const b = f.querySelector('[type=submit]'); b.classList.add('loading'); b.disabled = true;
        try { const r = await VS.api('/api/auth/verify', { body: { email: st.email, code: c, name: st.name, ask_name: true, coupon: VS.coupon() || undefined }, headers: { 'x-vs-fp': VS.fp() } }); done(r.user, r.isNew); } catch (x) { err.textContent = x.message; err.hidden = false; b.classList.remove('loading'); b.disabled = false; }
      });
    };
    const done = (user, isNew) => {
      clearInterval(st.timer);
      card.innerHTML = `${head}<div class="va-au-ok" role="status"><span class="va-au-tick">${icon('check')}</span><h1>${isNew ? 'Welcome' : 'Welcome back'}, ${esc(A.firstName(user && user.name))}.</h1><p>${isNew ? 'Your Voo ID is ready. Taking you to the school.' : 'Taking you to your lessons.'}</p></div>`;
      if (isNew && !reduce()) VS.confetti();
      setTimeout(() => { location.href = next; }, reduce() ? 300 : 1100);
    };
    const focus = () => setTimeout(() => { const i = card.querySelector('[name=name]') || card.querySelector('[name=email]'); if (i) i.focus(); }, 60);
    step1(); focus();
  }

  boot();
})();
