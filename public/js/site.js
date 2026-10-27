/* VooSquare public site and /login page. Vanilla JS on top of window.VS (shared.js) and window.VSL (lesson-visuals.js).
 * Renders the shell instantly, then fills every dynamic part from GET /api/site and GET /api/me. */
(function () {
  'use strict';
  const VS = window.VS;
  const { $, $$, esc, fmt } = VS;
  const reduce = VS.reduce;
  const layer = $('#layer');
  const params = new URLSearchParams(location.search);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const isLogin = path === '/login';

  /* ------------------------------------------------------------------ utils */
  const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/') || u.startsWith('#')) return u;
    if (/^mailto:[^\s]+$/i.test(u)) return u;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(u)) return 'https://' + u;
    return '';
  }
  const isExt = (u) => /^https?:\/\//i.test(u) && !u.startsWith(location.origin);
  /* Same-site paths only. Browsers drop tabs and newlines in URLs, so "/\t/evil.com" would become "//evil.com": reject whitespace and backslashes, then confirm the origin. */
  const safeNext = (n) => {
    n = String(n || '');
    if (!/^\/(?![\/\\])/.test(n) || /[\u0000-\u0020\u007f\\]/.test(n)) return '';
    try { const u = new URL(n, location.origin); return u.origin === location.origin ? u.pathname + u.search + u.hash : ''; } catch { return ''; }
  };
  const safeColor = (c, def) => { c = String(c || '').trim(); return /^#[0-9a-f]{3,8}$/i.test(c) || /^rgba?\([\d\s.,%]+\)$/i.test(c) ? c : def; };
  const safeBg = (g, def) => { g = String(g || '').trim(); return g && /^[a-z0-9#(),.%\s-]+$/i.test(g) && !/url|expression/i.test(g) ? g : def; };
  function rgb(c) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(c || '').trim());
    if (!m) return null;
    let h = m[1]; if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  function lum(c) {
    const v = rgb(c); if (!v) return 0.2;
    const [r, g, b] = v.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const inkOn = (c) => (lum(c) > 0.42 ? '#14200A' : '#fff');
  const alpha = (c, a) => { const v = rgb(c); return v ? `rgba(${v[0]},${v[1]},${v[2]},${a})` : `rgba(0,168,107,${a})`; };
  /** Readable accent text for a brand colour on white/tint (darkens light colours). */
  const accent = (c) => { const v = rgb(c); if (!v) return 'var(--deep)'; if (lum(c) < 0.3) return c; const k = 0.55; return `rgb(${v.map((x) => Math.round(x * k)).join(',')})`; };
  const av = (s) => VS.avatar({ skin: s % 8, hair: (s * 3 + 1) % 6, hairColor: (s * 7) % 5, eyes: s % 3 === 2 ? 0 : s % 3, mouth: (s >> 1) % 2, acc: s % 6 === 0 ? 1 : s % 5 === 2 ? 2 : 0, shirt: (s * 5 + 1) % 8, bg: (s * 3) % 8 });
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
  const periodLabel = (d) => { d = Number(d) || 30; return d === 30 || d === 31 ? 'month' : d === 365 ? 'year' : d === 7 ? 'week' : d === 90 ? 'quarter' : d + ' days'; };
  const money = (n) => '$' + fmt(n, Number(n) % 1 ? 2 : 0);
  const EYES = '<svg viewBox="0 0 24 24" aria-hidden="true"><g class="blink"><rect x="5.5" y="8" width="5" height="8" rx="2.5" fill="#fff"/><rect x="13.5" y="8" width="5" height="8" rx="2.5" fill="#fff"/></g><g class="pupil"><circle cx="8.6" cy="12" r="1.6" fill="#0A1A13"/><circle cx="16.6" cy="12" r="1.6" fill="#0A1A13"/></g></svg>';
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

  function fill(root = document) {
    $$('[data-av]', root).forEach((el) => { if (!el.dataset.d) { el.innerHTML = av(Number(el.dataset.av) || 0); el.dataset.d = 1; } });
    $$('[data-pi]', root).forEach((el) => {
      const p = bySlug(el.dataset.pi) || { icon: el.dataset.pi };
      const t = document.createElement('template');
      t.innerHTML = VS.productIcon({ icon: p.icon || el.dataset.pi, name: p.name, color: p.color }, el.dataset.size || 'sm');
      const n = t.content.firstElementChild;
      if (el.dataset.cls) n.classList.add(...el.dataset.cls.split(' '));
      el.replaceWith(n);
    });
    VS.fillIcons(root);
  }
  const ic = VS.icon;

  /* ------------------------------------------------------------------ state + fallback */
  const FALLBACK = {
    brand: { company: 'Zedapex', founder: 'Dchessking' }, top_card: null, announcements: [], ads: [],
    products: [
      { slug: 'spyvoo', name: 'Spyvoo', stage: 'Research', status: 'new', tagline: 'Search live Facebook and Instagram ads from every country and see why the winners work.', icon: 'spyvoo', color: '#3355F0', tint: '#EEF2FF', url: 'https://spyvoo.com', offer: 'Start free' },
      { slug: 'affleego', name: 'Affleego', stage: 'Monetize', status: 'live', tagline: 'Premium CPA and RevShare deals in finance, sports and casino.', icon: 'affleego', color: '#E8C200', tint: '#FFF6C7', external: true, url: 'https://affleego.com', offer: 'Zedapex platform' },
      { slug: 'vooads', name: 'Vooads', stage: 'Acquire', status: 'new', tagline: 'Turn one sentence into videos, images and hooks in every size and language.', icon: 'vooads', color: '#EE5A2F', tint: '#FCE6DC', url: '', offer: 'First ads free' },
      { slug: 'landvoo', name: 'Landvoo', stage: 'Acquire', status: 'soon', tagline: 'Landing pages built to pass review and convert paid traffic.', icon: 'land', color: '#E8458B', tint: '#FDE2EC', url: '' },
      { slug: 'joinvoo', name: 'Joinvoo', stage: 'Track', status: 'live', tagline: 'Every real Telegram join and deposit, sent back to Meta, TikTok and Snapchat.', icon: 'join', color: '#5B3FE8', tint: '#ECE8FF', url: 'https://joinvoo.com', offer: '500 joins free' },
      { slug: 'replyvoo', name: 'Replyvoo', stage: 'Convert', status: 'new', tagline: 'AI Closers answer every chat, qualify leads and send the payment link.', icon: 'reply', color: '#B88A00', tint: '#FFF4CF', url: '', offer: '30 free chats a month' },
      { slug: 'castvoo', name: 'Castvoo', stage: 'Retain', status: 'beta', tagline: 'Welcome, follow up and sell to every subscriber on schedule.', icon: 'cast', color: '#2449D8', tint: '#E4ECFF', url: '', offer: '7 days free' },
      { slug: 'gatevoo', name: 'Gatevoo', stage: 'Collect', status: 'soon', tagline: 'The checkout behind the Voo family. USDT and Bitcoin, straight to your wallet.', icon: 'gatevoo', color: '#111111', tint: '#F1F0EB', external: true, url: 'https://gatevoo.com', offer: 'Join the waitlist' },
    ],
    rooms: [
      { name: 'Introductions', topic: 'Start here', icon: 'wave', color: '#12C784', access: 'free', description: 'Say hi. Tell us what you run, your geos and your verticals.' },
      { name: 'General', topic: 'Start here', icon: 'chat', color: '#0F766E', access: 'free', description: 'Anything about media buying and performance marketing.' },
      { name: 'Tracking & signals', topic: 'Craft', icon: 'target', color: '#5B3FE8', access: 'free', description: 'Pixels, CAPI, postbacks, attribution and clean signals.' },
      { name: 'Buyers’ Lounge', topic: 'Premium', icon: 'diamond', color: '#00774B', access: 'premium', description: 'Serious operators only. Real numbers, real campaigns.' },
    ],
    premium: { enabled: true, name: 'VooSquare Premium', price_usd: 20, period_days: 30, tagline: 'For operators who scale.', features: ['Premium rooms', 'Every Academy course, including the advanced tracks', 'Monthly live campaign breakdown with Dchessking, plus replays', 'Templates and playbooks', 'Priority support across every Voo tool', 'Premium badge and early access to new tools'] },
    free_plan: { name: 'Free for life', features: ['One Voo ID for every tool', 'Free community rooms', 'Free Academy courses', 'The Voo Blog', 'Support for every tool'] },
    community: {}, courses: [], posts: [], counts: {},
  };
  const S = { site: null, user: null, meDone: false, products: FALLBACK.products, failed: false };
  const bySlug = (slug) => S.products.find((p) => p.slug === slug);
  const status = (p) => String(p.status || 'live').toLowerCase();
  const STATUS_PILL = { live: ['Live', 'pill-g'], new: ['New', 'pill-p'], beta: ['Beta', 'pill-b'], soon: ['Soon', 'pill-w'] };
  const statusPill = (p) => { const s = STATUS_PILL[status(p)] || [p.status || 'Live', 'pill-w']; return `<span class="pill ${s[1]}">${esc(s[0])}</span>`; };

  let refCode = params.get('ref') || '';
  try { if (refCode) sessionStorage.setItem('vs_ref', refCode); else refCode = sessionStorage.getItem('vs_ref') || ''; } catch { /* storage blocked */ }
  refCode = refCode.replace(/[^a-z0-9]/gi, '').slice(0, 20);
  const productParam = (params.get('product') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40);

  /* ------------------------------------------------------------------ overlays */
  const stack = [];
  function overlay(html, { onClose } = {}) {
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const el = wrap.firstElementChild;
    layer.appendChild(el);
    const prevFocus = document.activeElement;
    const o = {
      el,
      close() {
        const i = stack.indexOf(o); if (i < 0) return;
        stack.splice(i, 1); el.remove();
        if (!stack.length) document.body.style.overflow = '';
        if (onClose) onClose();
        if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
        syncFloat();
      },
    };
    stack.push(o);
    document.body.style.overflow = 'hidden';
    el.addEventListener('mousedown', (e) => { if (e.target === el) o.downOnBackdrop = true; });
    el.addEventListener('click', (e) => { if (e.target === el && o.downOnBackdrop) o.close(); o.downOnBackdrop = false; });
    $$('[data-x]', el).forEach((b) => b.addEventListener('click', () => o.close()));
    fill(el);
    syncFloat();
    return o;
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].close(); });

  /* ================================================================== AUTH (shared by modal + /login) */
  function authUI(root, o) {
    const st = { mode: o.mode === 'login' ? 'login' : 'signup', email: '', name: '', dev: '', existing: false, timer: 0, busy: false };
    const P = o.brand; // product branding on /login
    const btnCls = o.btnCls || 'btn btn-g btn-block';
    function heads() {
      if (P) return st.mode === 'signup'
        ? [`Create your ${P.name} account`, `Your Voo ID is one free account for ${P.name} and every Zedapex tool.`]
        : [`Log in to ${P.name}`, 'Use your Voo ID email. We’ll send you a 6-digit code.'];
      if (o.page) return st.mode === 'signup' ? ['Create your Voo ID', 'One free account for every Zedapex tool, the community and the Academy.'] : ['Log in to VooSquare', 'Use your email. We’ll send you a 6-digit code.'];
      return st.mode === 'signup' ? ['Create your free account', 'Takes 30 seconds. No card needed.'] : ['Welcome back', 'Log in with your email. We’ll send you a 6-digit code.'];
    }
    function step1(msg) {
      clearInterval(st.timer);
      const [h, p] = heads();
      root.innerHTML = `<form class="au" novalidate>
        <div class="au-head"><h3>${esc(h)}</h3><p>${esc(p)}</p></div>
        <div class="seg au-tabs" role="tablist"><button type="button" role="tab" data-m="signup" class="${st.mode === 'signup' ? 'on' : ''}" aria-selected="${st.mode === 'signup'}">Create account</button><button type="button" role="tab" data-m="login" class="${st.mode === 'login' ? 'on' : ''}" aria-selected="${st.mode === 'login'}">Log in</button></div>
        ${st.mode === 'signup' ? `<div class="field"><label for="auName">Your name</label><input class="inp" id="auName" name="name" autocomplete="name" placeholder="Tunde Bakare" maxlength="60" value="${esc(st.name)}"></div>` : ''}
        <div class="field"><label for="auEmail">Email</label><input class="inp" id="auEmail" name="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@company.com" value="${esc(st.email)}"></div>
        <p class="err" role="alert" ${msg ? '' : 'hidden'}>${esc(msg || '')}</p>
        <button class="${btnCls}" type="submit">${st.mode === 'signup' ? 'Create my free account' : 'Send my code'} <span class="arr">${ic('arrow')}</span></button>
        <p class="au-fine">${st.mode === 'signup' ? 'Free forever. No card needed. ' : ''}We email you a 6&#8209;digit code. No passwords.</p>
        ${st.mode === 'signup' ? '<p class="au-fine au-legal">By creating an account you agree to the <a href="/terms" target="_blank" rel="noopener">Terms of service</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.</p>' : ''}
      </form>`;
      const f = $('form', root);
      f.addEventListener('input', () => { const er = $('.err', f); if (er && !er.hidden) er.hidden = true; }); // a fixed field clears the old message
      $$('[data-m]', f).forEach((b) => b.addEventListener('click', () => { st.mode = b.dataset.m; keep(); step1(); focusFirst(); }));
      function keep() { const n = $('#auName', f); if (n) st.name = n.value.trim(); st.email = $('#auEmail', f).value.trim(); }
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); keep();
        const err = $('.err', f);
        const say = (m) => { err.textContent = m; err.hidden = false; };
        if (st.mode === 'signup' && st.name.length < 2) { say('Add your name so we know what to call you.'); $('#auName', f).focus(); return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(st.email)) { say('Enter a valid email so we can send your code.'); $('#auEmail', f).focus(); return; }
        const b = $('button[type=submit]', f); b.classList.add('loading'); b.disabled = true; err.hidden = true;
        try { await sendCode(); step2(); } catch (x) { say(x.message); b.classList.remove('loading'); b.disabled = false; }
      });
    }
    async function sendCode() {
      const body = { email: st.email, ref: refCode || undefined, product: o.product || undefined, coupon: VS.coupon() || undefined };
      if (st.mode === 'signup' && st.name) body.name = st.name;
      const r = await VS.api('/api/auth/start', { body });
      st.dev = r && r.dev_code ? String(r.dev_code) : '';
    }
    function step2() {
      // Neutral on purpose: the reply to /api/auth/start never says whether the email has an account (PT-2).
      const note = st.mode === 'signup' ? 'Already have an account with this email? The code logs you in.' : 'New here? Enter the code and we’ll create your free account.';
      root.innerHTML = `<form class="au" novalidate autocomplete="off">
        <div class="au-head"><h3>Check your email</h3><p>We sent a 6-digit code to <span class="au-email">${esc(st.email)} <button type="button" data-back>Change</button></span></p></div>
        ${note ? `<p class="au-fine" style="text-align:left">${esc(note)}</p>` : ''}
        <div class="otp" role="group" aria-label="6-digit code">${[0, 1, 2, 3, 4, 5].map((i) => `<input inputmode="numeric" pattern="[0-9]*" maxlength="6" aria-label="Digit ${i + 1}" ${i === 0 ? 'autocomplete="one-time-code"' : 'autocomplete="off"'}>`).join('')}</div>
        <p class="err" role="alert" hidden></p>
        <button class="${btnCls}" type="submit">Verify and continue <span class="arr">${ic('arrow')}</span></button>
        <div class="au-row"><span>Didn’t get it? Check spam.</span><button type="button" data-resend disabled>Resend in 30s</button></div>
        ${st.dev ? `<div class="dev-hint">${ic('settings')}<span>Dev code: <b>${esc(st.dev)}</b></span><button type="button" data-devfill>Fill it</button></div>` : ''}
      </form>`;
      const f = $('form', root);
      const boxes = $$('.otp input', f);
      const err = $('.err', f);
      const say = (m) => { err.textContent = m; err.hidden = false; };
      const code = () => boxes.map((b) => b.value).join('');
      function put(d, start) {
        d.split('').slice(0, 6 - start).forEach((c, k) => { boxes[start + k].value = c; boxes[start + k].classList.add('f'); });
        boxes[Math.min(start + d.length, 5)].focus();
        maybe();
      }
      function maybe() { if (code().length === 6 && !st.busy) verify(); }
      boxes.forEach((b, i) => {
        b.addEventListener('input', () => {
          const v = b.value.replace(/\D/g, '');
          if (v.length > 1) { put(v, v.length >= 6 ? 0 : i); return; }
          b.value = v; b.classList.toggle('f', !!v); f.querySelector('.otp').classList.remove('bad');
          if (v && i < 5) boxes[i + 1].focus();
          maybe();
        });
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Backspace' && !b.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ''; boxes[i - 1].classList.remove('f'); boxes[i - 1].focus(); }
          else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); boxes[i - 1].focus(); }
          else if (e.key === 'ArrowRight' && i < 5) { e.preventDefault(); boxes[i + 1].focus(); }
        });
        b.addEventListener('paste', (e) => {
          const d = ((e.clipboardData || window.clipboardData).getData('text') || '').replace(/\D/g, '');
          if (d) { e.preventDefault(); put(d.slice(0, 6), d.length >= 6 ? 0 : i); }
        });
        b.addEventListener('focus', () => b.select());
      });
      async function verify() {
        const c = code();
        if (c.length !== 6) { say('Enter all 6 digits.'); boxes[c.length] && boxes[c.length].focus(); return; }
        st.busy = true; err.hidden = true;
        const sb = $('button[type=submit]', f); sb.classList.add('loading'); sb.disabled = true;
        try {
          const r = await VS.api('/api/auth/verify', { body: { email: st.email, code: c, name: st.name || undefined, ask_name: true, coupon: VS.coupon() || undefined }, headers: { 'x-vs-fp': VS.fp() } });
          clearInterval(st.timer);
          if (r && r.need_name) { stepName(c); return; }
          step3(r.user, r.isNew);
        } catch (x) {
          st.busy = false; sb.classList.remove('loading'); sb.disabled = false;
          say(x.message);
          const g = $('.otp', f); g.classList.remove('bad'); void g.offsetWidth; g.classList.add('bad');
          boxes.forEach((b) => { b.value = ''; b.classList.remove('f'); }); boxes[0].focus();
        }
      }
      f.addEventListener('submit', (e) => { e.preventDefault(); verify(); });
      $('[data-back]', f).addEventListener('click', () => step1());
      const dv = $('[data-devfill]', f); if (dv) dv.addEventListener('click', () => put(st.dev, 0));
      const rs = $('[data-resend]', f);
      let left = 30;
      const tick = () => { if (left > 0) { rs.textContent = `Resend in ${left}s`; rs.disabled = true; left--; } else { rs.textContent = 'Send a new code'; rs.disabled = false; clearInterval(st.timer); } };
      clearInterval(st.timer); tick(); st.timer = setInterval(tick, 1000);
      rs.addEventListener('click', async () => {
        rs.disabled = true; rs.textContent = 'Sending…';
        try { await sendCode(); VS.toast('New code sent'); step2(); } catch (x) { say(x.message); rs.disabled = false; rs.textContent = 'Send a new code'; }
      });
      setTimeout(() => boxes[0].focus(), 60);
    }
    /* A new email signed in from "Log in": the code was right, ask for a name, then create the account with the same code. */
    function stepName(c) {
      root.innerHTML = `<form class="au" novalidate>
        <div class="au-head"><h3>Welcome to VooSquare</h3><p>This email is new here. What should we call you?</p></div>
        <div class="field"><label for="auName2">Your name</label><input class="inp" id="auName2" name="name" autocomplete="name" placeholder="Tunde Bakare" maxlength="60" value="${esc(st.name)}"></div>
        <p class="err" role="alert" hidden></p>
        <button class="${btnCls}" type="submit">Create my free account <span class="arr">${ic('arrow')}</span></button>
        <p class="au-fine au-legal">By creating an account you agree to the <a href="/terms" target="_blank" rel="noopener">Terms of service</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.</p>
      </form>`;
      const f = $('form', root); const inp = $('#auName2', f); const err = $('.err', f);
      inp.addEventListener('input', () => { err.hidden = true; });
      setTimeout(() => inp.focus(), 60);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        st.name = inp.value.trim();
        if (st.name.length < 2) { err.textContent = 'Add your name so we know what to call you.'; err.hidden = false; inp.focus(); return; }
        const b = $('button[type=submit]', f); b.classList.add('loading'); b.disabled = true; err.hidden = true;
        try {
          const r = await VS.api('/api/auth/verify', { body: { email: st.email, code: c, name: st.name, ask_name: true, coupon: VS.coupon() || undefined }, headers: { 'x-vs-fp': VS.fp() } });
          step3(r.user, r.isNew);
        } catch (x) { err.textContent = x.message; err.hidden = false; b.classList.remove('loading'); b.disabled = false; }
      });
    }
    function step3(user, isNew) {
      S.user = user;
      const dest = safeNext(o.next) || '/app';
      root.innerHTML = `<div class="au-ok" role="status"><span class="big">${ic('check')}</span><h3>${isNew ? 'Welcome to the square' : 'Welcome back'}, ${esc(firstName(user && user.name))}.</h3><p>${isNew ? 'Your Voo ID is ready. Taking you to your dashboard to finish setting up.' : P ? `Taking you back to ${esc(P.name)}.` : 'Taking you to your dashboard.'}</p><span class="bar2"><i></i></span></div>`;
      if (isNew) VS.confetti();
      setTimeout(() => { location.href = dest; }, reduce ? 300 : 1300);
    }
    function focusFirst() { setTimeout(() => { const i = $('#auName', root) || $('#auEmail', root); if (i && matchMedia('(pointer:fine)').matches) i.focus(); else if (i && o.focusAlways) i.focus(); }, 60); }
    step1(); focusFirst();
    return { destroy() { clearInterval(st.timer); } };
  }

  let authOpen = null;
  function openAuth({ mode = 'signup', product = '', next = '' } = {}) {
    if (S.user) { location.href = safeNext(next) || '/app'; return; }
    if (authOpen) authOpen.close();
    let ui;
    const o = overlay(`<div class="vs-modal au-modal"><div class="vs-modal-p" role="dialog" aria-modal="true" aria-label="${mode === 'login' ? 'Log in' : 'Create your free account'}">
      <div class="vs-modal-h"><span class="au-badge"><span class="brand"><span data-pi="voosquare" data-size="sm"></span><span>Voo<b>Square</b></span></span></span><button class="x" data-x aria-label="Close">${ic('x')}</button></div>
      <div class="vs-modal-b"><div id="auRoot"></div></div></div></div>`, { onClose: () => { authOpen = null; if (ui) ui.destroy(); if (location.hash === '#join') history.replaceState(history.state, '', location.pathname + location.search); } });
    authOpen = o;
    ui = authUI($('#auRoot', o.el), { mode, product: product || productParam, next, focusAlways: true });
  }

  /* ================================================================== /login page */
  async function loginPage() {
    const card = $('#lgCard');
    const mode = params.get('mode') === 'signup' ? 'signup' : 'login';
    const next = safeNext(params.get('next')) || '/app';
    let P = null;
    const [brandR, meR] = await Promise.allSettled([
      productParam ? VS.api('/api/login-brand/' + encodeURIComponent(productParam)) : Promise.resolve(null),
      VS.api('/api/me'),
    ]);
    if (brandR.status === 'fulfilled' && brandR.value && brandR.value.product) P = brandR.value.product;
    const user = meR.status === 'fulfilled' && meR.value ? meR.value.user : null;
    const pc = P ? safeColor(P.color, '#00A86B') : '#00A86B';
    card.style.setProperty('--pc', pc);
    card.style.setProperty('--pci', inkOn(pc));
    document.title = P ? `${mode === 'signup' ? 'Create your' : 'Log in to'} ${P.name}${mode === 'signup' ? ' account' : ''} · VooSquare` : (mode === 'signup' ? 'Create your Voo ID · VooSquare' : 'Log in · VooSquare');
    const iconHtml = `<div class="lg-ic"><span class="halo"></span>${VS.productIcon(P ? { icon: P.icon, name: P.name, color: pc } : { icon: 'voosquare' }, 'xl')}${P ? `<span class="vsb">${VS.productIcon({ icon: 'voosquare' }, 'xs')}</span>` : ''}</div>`;
    function form() {
      card.innerHTML = iconHtml + '<div id="lgAuth"></div>';
      authUI($('#lgAuth', card), { mode, product: P ? P.slug : productParam, next, brand: P, page: true, btnCls: 'btn btn-p btn-block', focusAlways: true });
    }
    if (user) {
      card.innerHTML = `${iconHtml}<div class="lg-signed"><span class="av">${VS.avatar(user.avatar || {})}</span><div><h3 style="font-size:24px">You’re signed in, ${esc(firstName(user.name))}.</h3><p style="color:var(--muted);margin-top:6px">${esc(user.email || '')}</p></div>
        <a class="btn btn-p btn-block" href="${esc(next)}">Continue${P ? ' to ' + esc(P.name) : ''} <span class="arr">${ic('arrow')}</span></a>
        <button class="btn btn-ghost" data-switch>Use another account</button></div>`;
      $('[data-switch]', card).addEventListener('click', async () => { try { await VS.api('/api/auth/logout', { body: {} }); } catch { /* ignore */ } form(); });
    } else form();
  }

  /* ================================================================== SITE */
  /* ---------- nav + account-aware CTAs ---------- */
  function renderAccount() {
    const u = S.user;
    const navR = $('#navR');
    const menu = '<button class="menu-b" id="menuB" aria-expanded="false" aria-controls="drawer" aria-label="Open menu">' + ic('menu') + '</button>';
    if (u) {
      navR.innerHTML = `<a class="me-btn" href="/app" aria-label="Open dashboard"><span class="av">${VS.avatar(u.avatar || {})}</span><span class="lbl">Open dashboard</span></a>${menu}`;
      $('#drawerAcct').innerHTML = `<a class="btn btn-k btn-block" href="/app"><span class="av av-xs" style="border:2px solid var(--lime)">${VS.avatar(u.avatar || {})}</span>Open dashboard</a>`;
      const go = `<a class="btn btn-g" href="/app">Open dashboard <span class="arr">${ic('arrow')}</span></a>`;
      $('#heroCtas').innerHTML = go + '<a class="btn btn-w" href="#tools">Explore the tools</a>';
      $('#finalCtas').innerHTML = go + '<a class="btn btn-w" href="#community">Visit the community</a>';
      $('#floatLbl').textContent = 'Open dashboard';
      $('#floatFace').innerHTML = `<span class="av">${VS.avatar(u.avatar || {})}</span>`;
      $('#floatCta').setAttribute('aria-label', 'Open your dashboard');
      $('#ftAcct').innerHTML = `<li><a href="/app">Open dashboard</a></li><li><a href="/app#premium">${u.premium ? 'Your Premium' : 'Go Premium'}</a></li><li><a href="#pricing">Pricing</a></li><li><a href="#community">Community</a></li>${supportLi()}`;
      $('#dfGreet').textContent = `${greeting()}, ${firstName(u.name)}.`;
      $('#deviceFrame').dataset.next = '/app';
      $('.open-hint').innerHTML = ic('grid') + 'Tap to open';
    } else {
      $('#floatFace').innerHTML = EYES;
      $('#dfGreet').textContent = `${greeting()}, Tunde.`;
      $('#ftAcct').innerHTML = `<li><button data-auth="signup">Create free account</button></li><li><button data-auth="login">Log in</button></li><li><a href="#pricing">Pricing</a></li><li><a href="#community">Community</a></li>${supportLi()}`;
    }
  }
  function supportLi() {
    const e = S.site && S.site.brand && S.site.brand.support_email;
    return e && /^[^\s@<>"]+@[^\s@<>"]+$/.test(e) ? `<li><a href="mailto:${esc(e)}">Support</a></li>` : '';
  }
  function syncFloat() {
    const f = $('#floatCta'); if (!f) return;
    f.classList.toggle('hide', window.scrollY < 520 || stack.length > 0);
  }

  /* ---------- timers that only run on screen ---------- */
  /** Run fn every `ms` only while `el` is on screen and the tab is visible: no timer wakes up for a hidden section. */
  function onScreenTimer(el, fn, ms) {
    let on = !('IntersectionObserver' in window); let id = 0;
    const sync = () => { const run = on && !document.hidden; if (run && !id) id = setInterval(fn, ms); else if (!run && id) { clearInterval(id); id = 0; } };
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { on = es[es.length - 1].isIntersecting; sync(); }, { rootMargin: '80px 0px' }) : null;
    if (io && el) io.observe(el);
    document.addEventListener('visibilitychange', sync);
    sync();
    return { stop() { clearInterval(id); id = 0; if (io) io.disconnect(); document.removeEventListener('visibilitychange', sync); } };
  }
  const NOOP_TIMER = { stop() {} };

  /* ---------- announcements ---------- */
  let annT = NOOP_TIMER;
  function renderAnn(list) {
    const box = $('#ann');
    const items = (list || []).filter((a) => a && a.text);
    annT.stop(); annT = NOOP_TIMER;
    if (!items.length) { box.hidden = true; return; }
    $('#annMsgs').innerHTML = items.map((a, i) => {
      const u = safeUrl(a.url);
      return `<div class="ann-msg ${i ? '' : 'on'}"><span>${esc(a.text)}</span>${u ? `<a href="${esc(u)}" ${isExt(u) ? 'target="_blank" rel="noopener"' : ''}>${esc(a.link_text || 'Learn more')} →</a>` : ''}</div>`;
    }).join('');
    box.hidden = false;
    const els = $$('.ann-msg', box); let i = 0;
    if (!reduce && els.length > 1) annT = onScreenTimer(box, () => { els[i].classList.remove('on'); i = (i + 1) % els.length; els[i].classList.add('on'); }, 4600);
  }

  /* ---------- top card ---------- */
  function renderTop(t) {
    const w = $('#topcardW');
    if (!t || !(t.title || t.body)) { w.hidden = true; return; }
    const theme = ['dark', 'light', 'brand'].includes(t.theme) ? t.theme : 'dark';
    const u = safeUrl(t.cta_url);
    const bcls = theme === 'light' ? 'btn btn-g' : theme === 'brand' ? 'btn btn-w' : 'btn btn-l';
    const sq = theme === 'light' ? '' : `<span class="tc-sq" style="width:46px;height:46px;background:var(--join);right:30%;top:-14px;opacity:.5"></span><span class="tc-sq" style="width:30px;height:30px;background:var(--reply);right:4%;bottom:12%;animation-delay:-3s;opacity:.6"></span>`;
    $('#topcard').innerHTML = `<div class="topcard t-${theme}">${theme === 'light' ? '' : '<div class="gridbg"></div>'}${sq}
      <div>${t.eyebrow ? `<span class="tc-eye"><i></i>${esc(t.eyebrow)}</span>` : ''}${t.title ? `<h2>${esc(t.title)}</h2>` : ''}${t.body ? `<p>${esc(t.body)}</p>` : ''}</div>
      ${u && t.cta_text ? `<div><a class="${bcls}" href="${esc(u)}" ${isExt(u) ? 'target="_blank" rel="noopener"' : ''}>${esc(t.cta_text)} <span class="arr">${ic(isExt(u) ? 'ext' : 'arrow')}</span></a></div>` : ''}
    </div>`;
    w.hidden = false;
  }

  /* ---------- marquee ---------- */
  function renderMarq() {
    const words = ['Meta', 'TikTok', 'Snapchat', 'Telegram', 'Lagos', 'Nairobi', 'Accra', 'Johannesburg', 'Douala'];
    const prods = S.products.map((p) => `<span class="p">${VS.productIcon(p, 'xs')}${esc(p.name)}</span>`);
    const mix = [];
    const n = Math.max(prods.length, words.length);
    for (let i = 0; i < n; i++) { if (prods[i]) mix.push(prods[i]); if (words[i]) mix.push(`<span><i></i>${esc(words[i])}</span>`); }
    const html = mix.join('');
    $('#marq').innerHTML = html + html;
  }

  /* ---------- hero device ---------- */
  let feedT = NOOP_TIMER;
  function renderHeroDevice() {
    const ps = [...S.products.filter((p) => status(p) !== 'soon'), ...S.products.filter((p) => status(p) === 'soon')].slice(0, 4);
    $('#dfApps').innerHTML = ps.map((p) => `<span class="df-app">${VS.productIcon(p, 'xs')}<span class="nm">${esc(p.name)}</span></span>`).join('');
    const d = new Date();
    $('#dfDate').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    const live = S.products.filter((p) => status(p) !== 'soon').length;
    $('#dfSub').textContent = `${live} tools live · community · Academy`;
    const ITEMS = [
      ['Ada joined · Video 3', 'joinvoo', 1], ['Deposit sent to Meta · $120', 'joinvoo', 7], ['Payment link sent to Musa', 'replyvoo', 4],
      ['12 new ads ready · Pidgin', 'vooads', 5], ['Day 3 follow-up sent to 840 people', 'castvoo', 9], ['Bot click filtered', 'joinvoo', -1],
      ['Winner found · running 94 days', 'spyvoo', 3], ['Wanjiru asked about VIP · answered', 'replyvoo', 11], ['Kofi finished Lesson 2', 'academy', 12], ['Amara said hi in Introductions', 'community', 14],
    ].map(([t, s, a]) => {
      if (s === 'academy') return [t, 'Academy', '#E7F8F0', '#00774B', a];
      if (s === 'community') return [t, 'Community', '#E7F8F0', '#00774B', a];
      const p = bySlug(s); if (!p) return null;
      return [t, p.name, safeColor(p.tint, '#E7F8F0'), accent(safeColor(p.color, '#00774B')), a];
    }).filter(Boolean);
    const hf = $('#heroFeed'); let fi = 0;
    const push = (first) => {
      const [t, tool, bg, fg, a] = ITEMS[fi++ % ITEMS.length];
      const el = document.createElement('span'); el.className = 'fi' + (first ? '' : ' new');
      el.innerHTML = `<span class="av">${a < 0 ? VS.bot() : av(a)}</span><span class="fi-text">${esc(t)}</span><span class="tag" style="background:${bg};color:${fg}">${esc(tool)}</span>`;
      hf.prepend(el); while (hf.children.length > 3) hf.lastElementChild.remove();
    };
    hf.innerHTML = ''; for (let i = 0; i < 3; i++) push(true);
    feedT.stop(); feedT = NOOP_TIMER;
    if (!reduce && ITEMS.length) feedT = onScreenTimer($('.hero') || hf, () => push(false), 2600);
  }

  /* ---------- lanes (walkers through the Joinvoo gate) ---------- */
  const NAMES = ['Ada', 'Musa', 'Wanjiru', 'Kofi', 'Thandi', 'Emeka', 'Amara', 'Juma'];
  function buildLanes(root) {
    $$('[data-lane]', root).forEach((lane, li) => {
      if (lane.dataset.built) return; lane.dataset.built = 1;
      const n = Number(lane.dataset.lane) || 4;
      for (let i = 0; i < n + 2; i++) {
        const isBot = i % 3 === 2, w = document.createElement('div');
        w.className = 'walker ' + (isBot ? 'bot' : 'real');
        w.style.top = (8 + ((i * 37) % 74)) + '%';
        w.style.animationDelay = (-(i * 6 / (n + 2))).toFixed(2) + 's';
        w.innerHTML = `<span class="av">${isBot ? VS.bot() : av(i + li * 7 + 20)}</span>${isBot ? '' : `<span class="wt">${NAMES[(i + li) % 8]} ✓</span>`}`;
        lane.appendChild(w);
      }
    });
  }

  /* ---------- story player ---------- */
  const CHAPTERS = [
    { k: 'Monday · the guess', t: 'He tested a guess. Again.', b: 'Tunde writes every new angle from scratch. He can’t see which ads in his market have run for months, or why they work. So the first part of every test budget pays for the lesson.', slug: 'spyvoo', icon: 'spyvoo', tn: 'Spyvoo', tf: 'Find a winner in 30 seconds' },
    { k: 'Tuesday · the creative', t: 'His best ad died on Thursday.', b: 'Meet Tunde. He spends $500 a day on Meta. His winning video is tired after four days, and his editor needs a week for new ones. So he keeps paying for an ad nobody watches.', slug: 'vooads', icon: 'vooads', tn: 'Vooads', tf: '12 fresh ads before lunch' },
    { k: 'Wednesday · the blind spot', t: 'People tap Join. Meta sees nothing.', b: 'Telegram passes nothing back to the ad. Meta optimises for clicks: bots, accidental taps, people who never join. Tunde pays for every one of them.', slug: 'joinvoo', icon: 'join', tn: 'Joinvoo', tf: 'Every real join and deposit, sent back to the ad' },
    { k: 'Thursday · the inbox', t: '200 DMs. Nobody home.', b: 'His ads worked. Now people are asking questions at 2am, and by morning they have bought from someone else. Leads he paid for are going cold in his inbox.', slug: 'replyvoo', icon: 'reply', tn: 'Replyvoo', tf: 'AI that answers in seconds and sends the link' },
    { k: 'Friday · the cold list', t: 'They joined. Then they forgot.', b: 'Most people don’t buy on day one. Without a welcome, a reminder and an offer at the right time, his new subscribers drift away.', slug: 'castvoo', icon: 'cast', tn: 'Castvoo', tf: 'Welcome, follow up and sell on schedule' },
    { k: 'Sunday · the square', t: 'Same budget. Different business.', b: 'Proven angles, fresh creatives, clean signals, every chat answered, every subscriber followed up. Tunde spends the same money and gets more back from it, from one account.', slug: '', icon: 'voosquare', tn: 'VooSquare', tf: 'Every tool, one login' },
  ];
  const visible = { hero: true, story: false, chat: false };
  function initStory() {
    const barsEl = $('#bars');
    CHAPTERS.forEach((c, i) => { const b = document.createElement('button'); b.className = 'bar'; b.setAttribute('role', 'tab'); b.setAttribute('aria-label', 'Chapter ' + (i + 1) + ': ' + c.t); b.innerHTML = '<i></i>'; b.onclick = () => go(i); barsEl.appendChild(b); });
    const bars = [...barsEl.children], scenes = $$('#stage .scene'), txt = $('#chapText');
    let cur = 0, prog = 0, playing = !reduce, last = performance.now();
    function render() {
      const c = CHAPTERS[cur]; txt.classList.add('swap');
      const p = c.slug ? bySlug(c.slug) : null;
      setTimeout(() => {
        $('#chK').textContent = c.k; $('#chT').textContent = c.t; $('#chB').textContent = c.b;
        $('#chF').innerHTML = `${VS.productIcon(p || { icon: c.icon }, 'sm')}<span>Fixed by ${esc(p ? p.name : c.tn)}<small>${esc(c.tf)}</small></span>`;
        txt.classList.remove('swap');
      }, reduce ? 0 : 220);
      scenes.forEach((s, i) => { if (i === cur) { s.classList.remove('on'); void s.offsetWidth; s.classList.add('on'); } else s.classList.remove('on'); });
      bars.forEach((b, i) => { b.setAttribute('aria-selected', i === cur); b.firstChild.style.width = i < cur ? '100%' : '0%'; });
      if (cur === CHAPTERS.length - 1) $$('#stage [data-count]').forEach((el) => VS.countUp(el, Number(el.dataset.count), { dec: Number(el.dataset.dec) || 0, pre: el.dataset.pre || '', suf: el.dataset.suf || '', ms: 1300 }));
    }
    function go(i) { cur = (i + CHAPTERS.length) % CHAPTERS.length; prog = 0; render(); }
    $('#prev').onclick = () => go(cur - 1); $('#next').onclick = () => go(cur + 1);
    const playB = $('#play');
    function setPlay(p) { playing = p; if (S.wakeStory) S.wakeStory(); playB.innerHTML = ic(p ? 'pause' : 'play'); playB.setAttribute('aria-label', p ? 'Pause story' : 'Play story'); }
    playB.onclick = () => setPlay(!playing); setPlay(playing);
    // The progress loop runs only while the story is on screen and the tab is visible (no frames burnt off screen).
    let running = false;
    function loop(t) {
      if (!visible.story || document.hidden || !playing) { running = false; return; }
      const dt = Math.min(t - last, 100); last = t;
      if (playing && !stack.length) { prog += dt / 7000; if (prog >= 1) go(cur + 1); }
      bars[cur].firstChild.style.width = Math.min(prog, 1) * 100 + '%';
      requestAnimationFrame(loop);
    }
    const wake = () => { if (!running && playing && visible.story && !document.hidden) { running = true; last = performance.now(); requestAnimationFrame(loop); } };
    document.addEventListener('visibilitychange', wake);
    S.wakeStory = wake;
    render(); wake();
    S.rerenderStory = render;
  }

  /* ---------- founder "so we built" ---------- */
  function renderLessonsCost() {
    const L = [['spyvoo', 'spyvoo', 'Paid to test angles blind'], ['vooads', 'vooads', 'Burnt money on dead creatives'], ['joinvoo', 'join', 'Paid for clicks that weren’t people'], ['replyvoo', 'reply', 'Lost buyers in the inbox'], ['castvoo', 'cast', 'Watched joiners go cold']];
    $('#lessonsCost').innerHTML = L.map(([slug, icon, t]) => {
      const p = bySlug(slug); if (!p && !S.failed && S.site) return '';
      const q = p || { icon, name: slug[0].toUpperCase() + slug.slice(1) };
      return `<a class="lc" href="#tool-${esc(slug)}">${VS.productIcon(q, 'sm')}<div><b>${esc(t)}</b><p>So we built ${esc(q.name)}.</p></div></a>`;
    }).join('');
  }

  /* ---------- the Voo system ---------- */
  const STAGES = { Research: 'Find what’s already winning before you spend.', Monetize: 'Find offers worth running before you spend.', Acquire: 'Get attention with ads and pages that convert.', Track: 'See which ads bring real people and real money.', Convert: 'Turn chats and leads into paying customers.', Retain: 'Bring every subscriber back until they buy.', Collect: 'Get paid in crypto, straight to your wallet.' };
  const STAGE_ORDER = Object.keys(STAGES);
  function productAction(p, label) {
    const u = safeUrl(p.url), st = status(p);
    if (u) return { href: u, ext: isExt(u), label: label || (st === 'soon' ? 'Join the waitlist' : `Open ${p.name}`) };
    if (st === 'soon') return { auth: 'signup', product: p.slug, label: 'Get early access' };
    return { auth: 'signup', product: p.slug, next: '/app#apps', label: label || `Launch ${p.name}` };
  }
  function actBtn(a, cls) {
    const arr = `<span class="arr">${ic(a.ext ? 'ext' : 'arrow')}</span>`;
    if (a.href) return `<a class="${cls}" href="${esc(a.href)}" ${a.ext ? 'target="_blank" rel="noopener"' : ''}>${esc(a.label)} ${arr}</a>`;
    return `<button class="${cls}" data-auth="${a.auth}" ${a.product ? `data-product="${esc(a.product)}"` : ''} ${a.next ? `data-next="${esc(a.next)}"` : ''}>${esc(a.label)} ${arr}</button>`;
  }
  function renderSystem() {
    const stages = [];
    S.products.forEach((p) => { const s = String(p.stage || 'Other'); if (!stages.includes(s)) stages.push(s); });
    stages.sort((a, b) => { const ia = STAGE_ORDER.indexOf(a), ib = STAGE_ORDER.indexOf(b); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib); });
    $('#stageCount').textContent = NUM[stages.length] || String(stages.length);
    $('#system').innerHTML = stages.map((s, i) => `<div class="stg"><span class="sn">STAGE ${i + 1}</span><h3>${esc(s)}</h3><p>${esc(STAGES[s] || `Tools for the ${s.toLowerCase()} stage of your funnel.`)}</p><div class="sapps">${S.products.filter((p) => String(p.stage || 'Other') === s).map((p) => `<a class="sapp ${status(p) === 'soon' ? 'soon' : ''}" href="#tool-${esc(p.slug)}">${VS.productIcon(p, 'xs')}${esc(p.name)}${status(p) === 'soon' ? ' · soon' : ''}</a>`).join('')}</div></div>`).join('');
  }

  let gateT = []; // on-screen timers of the Gatevoo card
  function renderLaunch() {
    const cards = [], gate = [], lab = [];
    S.products.forEach((p) => {
      const s = String(p.slug || '').toLowerCase();
      if (s === 'gatevoo') gate.push(p);
      else if (s === 'landvoo' && status(p) === 'soon') lab.push(p);
      else cards.push(p);
    });
    const html = cards.map((p) => {
      const s = String(p.slug || '').toLowerCase();
      if (s === 'joinvoo') return cardJoin(p);
      if (s === 'replyvoo') return cardReply(p);
      if (s === 'vooads' || s === 'advoo') return cardAds(p);
      if (s === 'castvoo') return cardCast(p);
      if (s === 'spyvoo') return cardSpy(p);
      return cardGeneric(p);
    });
    const lp = $('#lp');
    lp.innerHTML = html.join('');
    const all = $$('.appc', lp);
    if (all.length % 2 === 1) all[all.length - 1].classList.add('wide');
    fill(lp); buildLanes(lp);
    gateT.forEach((t) => t.stop()); gateT = [];
    $('#gateSlot').innerHTML = gate.map(cardGate).join('');
    if (gate.length) startGate($('#gpay'));
    $('#labSlot').innerHTML = lab.map((p) => `<div class="lab" id="tool-${esc(p.slug)}">${VS.productIcon(p, 'md')}<div><b>${esc(p.name)} is in the lab.</b><p>${esc(p.tagline || '')} Account holders get early access.</p></div>${actBtn({ auth: 'signup', product: p.slug, next: '/app#apps', label: 'Get early access' }, 'btn btn-w btn-sm')}</div>`).join('');
    fill($('#gateSlot'));
  }
  const top = (p, extra = '') => `<div class="appc-top">${VS.productIcon(p, 'md').replace('class="pi', `class="pi ${extra}`)}<span class="nm">${esc(p.name)}</span><span class="badge">${esc(p.stage || '')}</span></div>`;
  const offer = (p, def) => (p.offer || def) ? `<span class="offer">${esc(p.offer || def)}</span>` : '';
  function cardJoin(p) {
    return `<article class="appc a-join" id="tool-${esc(p.slug)}">${top(p, 'glass')}<h3>Track every lead.<br>Kill every fake.</h3><p class="d">Tracks every real Telegram join, sign-up and deposit and feeds it back to Meta, TikTok and Snapchat, so your ads buy quality, not noise.</p><div class="mini"><div class="mini-lane" data-lane="4"><div class="gate"></div></div></div><div class="appc-foot">${actBtn(productAction(p, `Launch ${p.name}`), 'btn')}${offer(p)}</div></article>`;
  }
  function cardReply(p) {
    return `<article class="appc a-reply" id="tool-${esc(p.slug)}">${top(p, 'coal')}<h3>Answer every chat. Close in the inbox.</h3><p class="d">AI Closers answer every chat in seconds, qualify every lead and send the payment link while you sleep.</p><div class="mini mini-reply" aria-hidden="true"><div class="msg in">Is the VIP group still open?</div><div class="msg out">Yes. Here’s your link to join today.</div><div class="msg paid">${ic('check')}Joined · Paid</div></div><div class="appc-foot">${actBtn(productAction(p, `Launch ${p.name}`), 'btn')}${offer(p)}</div></article>`;
  }
  function cardAds(p) {
    return `<article class="appc a-adv" id="tool-${esc(p.slug)}">${top(p)}<h3>Make ads that hold attention. <span class="serif">Own</span> <span class="o">your geo.</span></h3><p class="d">Your creatives die in four days and your editor needs seven. ${esc(p.name)} turns one sentence into videos, images and hooks in every size, writes and voices them in Pidgin, Swahili and French, and checks them against Meta’s rules before you spend.</p><div class="mini" aria-hidden="true"><div class="mini-cr"><span class="av" data-av="14"></span><b>"Wait, this works in Pidgin?"</b></div><div class="mini-cr"><span class="av" data-av="15"></span><b>"Watch before you scroll"</b></div><div class="mini-cr"><span class="av" data-av="16"></span><b>"Nairobi, you need this"</b></div></div><div class="appc-foot">${actBtn(productAction(p, 'Make my first ads'), 'btn btn-k')}${offer(p, 'Pidgin · Swahili · French')}</div></article>`;
  }
  function cardCast(p) {
    return `<article class="appc a-cast" id="tool-${esc(p.slug)}">${top(p)}<h3>Turn your Telegram into a <span class="b">sales machine.</span></h3><p class="d">${esc(p.name)} welcomes every new subscriber, follows up on time and sends each group the message written for them. Your bots and channels keep selling while you sleep.</p><div class="mini mini-cast" aria-hidden="true"><span class="ring"></span><span class="ring"></span><span class="ring"></span>${VS.productIcon(p, 'lg')}<span class="bubble mb1">Welcome, Ada</span><span class="bubble mb2">Your free guide</span><span class="bubble mb3">Offer ends tonight</span></div><div class="appc-foot">${actBtn(productAction(p, 'Start free'), 'btn')}${offer(p)}</div></article>`;
  }
  function cardSpy(p) {
    const row = (k, cls, badge) => `<div class="spy-ad ${cls}"><span class="th t${k}"><span class="av" data-av="${20 + k}"></span></span><span class="tx"><i></i><i></i></span>${badge}</div>`;
    const note = p.offer && p.offer !== 'Start free' ? offer(p) : '<span class="offer">Facebook · Instagram · TikTok soon</span>';
    return `<article class="appc a-spy" id="tool-${esc(p.slug)}">${top(p)}<h3>Spy the winners. <span class="b">Scale your own.</span></h3><p class="d">Search live Facebook and Instagram ads from every country. See which ones have run for months and why they work, with an AI breakdown of every hook. Then launch your own angle before your budget burns.</p><div class="mini mini-spy" aria-hidden="true"><div class="spy-q">${ic('search')}<span>Search live ads · All countries</span><b>FB · IG</b></div><div class="spy-feed"><span class="spy-scan"></span>${row(1, 'win', '<span class="run"><i></i>Running 94 days</span>')}${row(2, '', '<span class="run new">Started this week</span>')}${row(3, '', '<span class="run new">Running 9 days</span>')}</div><span class="spy-hook"><b>AI</b>Hook: a question in the first second</span><span class="ex-tag">Example</span></div><div class="appc-foot">${actBtn(productAction(p, 'Start free'), 'btn')}${note}</div></article>`;
  }
  function cardGeneric(p) {
    const c = safeColor(p.color, '#00A86B'), t = safeColor(p.tint, '#E7F8F0');
    const desc = p.description && p.description !== p.tagline ? p.description : '';
    const words = String(p.tagline || p.name).split(' ');
    const head = words.length > 3 ? `${esc(words.slice(0, -2).join(' '))} <span class="hl">${esc(words.slice(-2).join(' '))}</span>` : `<span class="hl">${esc(words.join(' '))}</span>`;
    const chips = [p.stage, STATUS_PILL[status(p)] ? STATUS_PILL[status(p)][0] : p.status, p.offer].filter(Boolean).slice(0, 3);
    return `<article class="appc a-gen" id="tool-${esc(p.slug)}" style="--c:${c};--t:${t};--ci:${inkOn(c)};--ca:${accent(c)}">${top(p)}<h3>${head}</h3>${desc ? `<p class="d">${esc(desc)}</p>` : ''}<div class="mini" aria-hidden="true"><span class="ring"></span><span class="ring"></span><span class="ring"></span>${VS.productIcon(p, 'xl')}${chips.map((x, i) => `<span class="gen-chip g${i + 1}"><i></i>${esc(x)}</span>`).join('')}</div><div class="appc-foot">${actBtn(productAction(p), 'btn')}${status(p) === 'soon' ? '' : offer(p)}</div></article>`;
  }
  function cardGate(p) {
    const a = productAction(p, status(p) === 'soon' ? 'Join the waitlist' : `Open ${p.name}`);
    return `<div class="gate-card" id="tool-${esc(p.slug)}"><div>
      <span class="soon"><b><i></i>${status(p) === 'soon' ? 'Coming soon' : 'Live'}</b>The checkout behind the Voo family</span>
      <h3>Open the gate.<br><span>Get paid in a minute.</span></h3>
      <p class="d">One checkout for your <b>website</b>, your <b>links</b> and your <b>chats</b>. Your customer pays in USDT or Bitcoin, the money lands in <b>your wallet</b>, and the order unlocks itself.</p>
      <div class="row">${actBtn(a, 'btn btn-k')}<span class="note">Straight to your wallet · No middleman holding funds</span></div></div>
      <div class="gpay wait" id="gpay" aria-hidden="true"><div class="gridbg"></div>
        <span class="gchip2"><i></i><span class="gTime">00:21</span> TRON · <span class="gState">confirming</span></span>
        <div class="gwal"><small>YOUR WALLET</small><b class="gBal">$1,252.13</b></div>
        <div class="gph a"><span class="ck">${ic('check')}</span><b>Sent</b><small>49.13 USDT<br>Shopper · Accra</small></div>
        <div class="gph b"><span class="ck">${ic('check')}</span><b>Order confirmed</b><small>#1043 · Paid<br>49.13 USDT</small></div>
        <span class="gcoin">₮</span><span class="ex-tag dk">Example payment</span></div></div>`;
  }
  function startGate(gp) {
    if (!gp) return;
    let bal = 1252.13, t = 21;
    const stt = $('.gState', gp), tm = $('.gTime', gp), gb = $('.gBal', gp);
    const cities = ['Accra', 'Lagos', 'Nairobi', 'Douala', 'Durban'];
    function cycle() {
      gp.classList.add('wait'); gp.classList.remove('fly'); stt.textContent = 'confirming'; t = 10 + Math.floor(Math.random() * 20);
      setTimeout(() => gp.classList.add('fly'), 900);
      setTimeout(() => {
        gp.classList.remove('wait'); stt.textContent = 'confirmed';
        const amt = +(20 + Math.random() * 80).toFixed(2); bal += amt;
        gb.textContent = '$' + fmt(bal, 2); gb.classList.add('hit'); setTimeout(() => gb.classList.remove('hit'), 260);
        $$('.gph small', gp).forEach((e, i) => { e.innerHTML = i ? `#${1043 + Math.floor(Math.random() * 90)} · Paid<br>${amt.toFixed(2)} USDT` : `${amt.toFixed(2)} USDT<br>Shopper · ${cities[Math.floor(Math.random() * 5)]}`; });
      }, 1900);
    }
    if (reduce) { gp.classList.remove('wait'); return; }
    gateT.push(onScreenTimer(gp, () => { tm.textContent = '00:' + String(t++ % 60).padStart(2, '0'); }, 1000));
    cycle(); gateT.push(onScreenTimer(gp, cycle, 4200));
  }

  /* ---------- community ---------- */
  const ACCESS = { free: ['Free', 'pill-g'], premium: ['Premium', 'pill-gold'], paid: ['Paid', 'pill-k'] };
  function renderCommunity() {
    const rooms = (S.site && S.site.rooms) || FALLBACK.rooms;
    const free = rooms.filter((r) => r.access === 'free'), prem = rooms.filter((r) => r.access === 'premium'), paid = rooms.filter((r) => r.access === 'paid');
    const pr = (S.site && S.site.premium) || FALLBACK.premium;
    const list = (a) => a.map((r) => r.name).slice(0, 4).join(', ');
    // Room pictures (house artwork or the team's upload); rooms without one keep their icon.
    const pic = (r) => (/^\/(?!\/)[\w\-./?=&]+$/.test(String(r.image || '')) ? `<img src="${esc(r.image)}" alt="" loading="lazy">` : '');
    const stack = (a, fallback) => { const imgs = a.map(pic).filter(Boolean).slice(0, 3); return imgs.length ? `<span class="ti tstack">${imgs.map((x) => `<i>${x}</i>`).join('')}</span>` : fallback; };
    const tiers = [];
    if (free.length) tiers.push(`<div class="tier">${stack(free, `<span class="ti" style="background:var(--tint);color:var(--deep)">${ic('users')}</span>`)}<div><b>${free.length} free room${free.length === 1 ? '' : 's'} for every buyer</b><p>${esc(list(free))}${free.length > 4 ? ' and more' : ''}.</p></div><span class="pill pill-g">Free</span></div>`);
    if (prem.length) tiers.push(`<div class="tier">${stack(prem, `<span class="ti" style="background:#FFF1C2;color:#7A5300">${ic('diamond')}</span>`)}<div><b>${prem.length} premium room${prem.length === 1 ? '' : 's'}</b><p>${esc(list(prem))}. Included with Premium${pr && pr.price_usd ? ` at ${money(pr.price_usd)} a ${periodLabel(pr.period_days)}` : ''}.</p></div><span class="pill pill-gold">Premium</span></div>`);
    paid.forEach((r) => tiers.push(`<div class="tier">${stack([r], `<span class="ti" style="background:var(--black);color:var(--lime)">${ic(VS.P[r.icon] ? r.icon : 'star')}</span>`)}<div><b>${esc(r.name)}</b><p>${esc(r.description || 'A small paid room.')}${r.price_usd ? (r.approval_required ? ` By application, then ${money(r.price_usd)} a month.` : ` ${money(r.price_usd)} a month, sold separately.`) : ''}</p></div><span class="pill pill-k">${r.approval_required ? 'Invite only' : 'Paid'}</span></div>`));
    if (tiers.length) $('#tiers').innerHTML = tiers.join('');
    $('#cmCount').textContent = 'Free with your Voo ID';
    // rooms grouped by topic
    const topics = [];
    rooms.forEach((r) => { const t = r.topic || 'Rooms'; if (!topics.includes(t)) topics.push(t); });
    $('#rooms').innerHTML = topics.map((t) => `<div class="rg"><h4>${esc(t)}</h4><div class="rg-list">${rooms.filter((r) => (r.topic || 'Rooms') === t).map((r) => {
      const c = safeColor(r.color, '#00A86B'); const a = ACCESS[r.access] || ACCESS.free;
      const badge = r.access === 'paid' && r.price_usd ? `${money(r.price_usd)}/mo` : a[0];
      return `<button class="rm" data-room>${pic(r) ? `<span class="ri rpic">${pic(r)}</span>` : `<span class="ri" style="background:${alpha(c, 0.12)};color:${accent(c)}">${ic(VS.P[r.icon] ? r.icon : 'chat')}</span>`}<div><b><span class="nm">${esc(r.name)}</span><span class="pill ${a[1]}">${r.access === 'free' ? '' : ic('lock')}${esc(badge)}</span></b><p>${esc(r.description || '')}</p></div></button>`;
    }).join('')}</div></div>`).join('');
    const rules = S.site && S.site.community && S.site.community.rules;
    $('#rulesSlot').innerHTML = Array.isArray(rules) && rules.length ? `<div class="rules"><b>House rules</b><ul>${rules.slice(0, 6).map((r) => `<li>${ic('check')}<span>${esc(r)}</span></li>`).join('')}</ul></div>` : '';
    const fc = $('#faqCommunity');
    if (fc) fc.textContent = `Yes. Every account gets the free rooms${free.length ? ': ' + free.map((r) => r.name).join(', ') : ''}. ${prem.length ? 'Premium adds the premium rooms' + (prem.length ? ` (${prem.map((r) => r.name).join(', ')})` : '') + '. ' : ''}${paid.length ? `${paid.map((r) => r.name).join(' and ')} ${paid.length > 1 ? 'are' : 'is'} sold separately.` : ''}`.trim();
  }
  const CHAT = [
    { s: 21, n: 'Amara', t: 'Anyone else seeing CPMs jump in Nigeria this week?' },
    { s: 30, n: 'Juma', t: 'Yes, since Tuesday. I moved budget to my best hook and it settled.' },
    { s: 12, n: 'Kofi', t: 'What kill rule do you use on new ad sets?' },
    { f: 1, n: 'Dchessking', t: 'Spend twice your target CPA with no deposit, cut it. Write the rule before you launch.' },
    { s: 4, n: 'Thandi', t: 'Saving that one. Same for Telegram joins?' },
    { f: 1, n: 'Dchessking', t: 'Same idea. Price the join with the break-even calculator first.' },
    { me: 1, s: 3, n: 'You', t: 'Thanks. Trying it on my Kenya campaign tomorrow.' },
    { s: 30, n: 'Juma', t: 'Post your numbers in Tracking & signals after. We’ll look.' },
  ];
  function initChat() {
    const body = $('#ccBody'); if (!body) return;
    $('#ccStack').innerHTML = [21, 30, 12, 4].map((s) => `<span class="av">${av(s)}</span>`).join('') + `<span class="av">${VS.founder()}</span>`;
    const msg = (m) => `<div class="cm-m ${m.f ? 'founder-m' : ''} ${m.me ? 'me' : ''}"><span class="av">${m.f ? VS.founder() : av(m.s)}</span><div class="bb"><b>${esc(m.n)}${m.f ? '<em>FOUNDER</em>' : ''}</b>${esc(m.t)}</div></div>`;
    if (reduce) { body.innerHTML = CHAT.slice(-5).map(msg).join(''); return; }
    let i = 0, typing = false;
    function step() {
      const m = CHAT[i % CHAT.length];
      if (!typing) {
        typing = true;
        const t = document.createElement('div'); t.className = 'cm-typing'; t.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>${esc(m.n)} is typing`;
        body.appendChild(t);
      } else {
        typing = false; $$('.cm-typing', body).forEach((x) => x.remove());
        body.insertAdjacentHTML('beforeend', msg(m)); i++;
        while (body.children.length > 6) body.firstElementChild.remove();
      }
    }
    body.innerHTML = CHAT.slice(0, 3).map(msg).join(''); i = 3;
    onScreenTimer($('.cm-chat') || body, step, 1300);
  }

  /* ---------- academy ---------- */
  function courseAuthor(c) { return VS.authorAvatar(c.author_key, Number(c.id) || 7); }
  function renderAcademy() {
    const cs = (S.site && S.site.courses) || [];
    const slot = $('#featSlot'), rail = $('#rail');
    if (!cs.length) {
      slot.innerHTML = `<div class="feature"><div class="feature-l"><h3>Courses are on the way.</h3><p>${S.failed ? 'We couldn’t load the Academy right now. Refresh in a moment.' : 'New lessons are being recorded. Create your free account to get them first.'}</p><div class="ctas">${S.user ? '<a class="btn btn-l" href="/app#academy">Open the Academy</a>' : '<button class="btn btn-l" data-auth="signup" data-next="/app#academy">Create my free account</button>'}</div></div><div class="feature-r" aria-hidden="true"><div class="orbit" id="featOrbit"></div><span class="bigplay">${ic('book')}</span></div></div>`;
      rail.innerHTML = ''; orbit(); return;
    }
    const c = cs[0];
    const lock = c.premium;
    slot.innerHTML = `<div class="feature"><div class="feature-l">
      <div class="by"><span class="av">${courseAuthor(c)}</span><div><b>${esc(c.author_name || 'Zedapex team')}</b><small>${esc(c.author_role || '')}</small></div></div>
      <h3>${esc(c.title)}</h3><p>${esc(c.description || '')}</p>
      <div class="feature-meta"><span>${c.lessons} lesson${c.lessons === 1 ? '' : 's'}</span><span>${c.minutes} min</span>${c.level ? `<span>${esc(c.level)}</span>` : ''}<span>Animated</span><span>${lock ? 'Premium' : 'Free'}</span></div>
      <div class="ctas"><button class="btn btn-l" data-play="${esc(c.slug)}">${ic('play')}${lock ? 'Preview lesson 1' : 'Watch lesson 1 free'}</button>${S.user ? '<a class="btn btn-ow" href="/app#academy">See all lessons</a>' : '<button class="btn btn-ow" data-auth="signup" data-next="/app#academy">See all lessons</button>'}</div>
    </div><div class="feature-r" data-play="${esc(c.slug)}" role="button" tabindex="0" aria-label="Play a free preview of ${esc(c.title)}"><div class="orbit" id="featOrbit"></div><span class="bigplay">${ic('play')}</span><span class="fr-lbl">Free preview · lesson 1</span></div></div>`;
    orbit();
    rail.innerHTML = cs.map((x) => `<button class="course" data-play="${esc(x.slug)}" aria-label="${esc(x.title)}${x.premium ? ', Premium' : ''}"><div class="cv" style="background:${safeBg(x.grad, 'linear-gradient(135deg,#0F2E20,#1E6B47)')}"><span class="cvmark">${esc(x.mark || '')}</span><span class="trk">${esc(x.track || 'Course')}</span>${x.premium ? `<span class="lockb">${ic('lock')}Premium</span>` : ''}</div><div class="cb"><h4>${esc(x.title)}</h4><div class="cby"><span class="av">${courseAuthor(x)}</span>${esc(x.author_name || 'Zedapex team')}</div><div class="cmeta"><span>${x.lessons} lessons · ${x.minutes} min</span><span>${esc(x.level || '')}</span></div></div></button>`).join('');
    if (cs.length < 2) rail.style.display = 'none';
  }
  function orbit() {
    const orb = $('#featOrbit'); if (!orb) return;
    const R = matchMedia('(max-width: 600px)').matches ? 110 : 130;
    ['CPL', 'FTD', 'ROAS', 'CAPI', 'Postback', 'Kill rules', 'Hooks', 'Scale'].forEach((t, i) => { const a = i / 8 * Math.PI * 2; const s = document.createElement('span'); s.textContent = t; s.style.transform = `translate(-50%,-50%) translate(${Math.cos(a) * R}px,${Math.sin(a) * R * 0.7}px)`; orb.appendChild(s); });
  }
  function initCalc() {
    const cPay = $('#cPay'), cRate = $('#cRate'), cMar = $('#cMar');
    const m = (v) => '$' + v.toFixed(2);
    function calc() {
      const pay = Math.max(0, +cPay.value || 0), rate = Math.max(0, +cRate.value || 0) / 100, mar = Math.min(95, Math.max(0, +cMar.value || 0)) / 100;
      const be = pay * rate, max = be * (1 - mar);
      $('#oBe').textContent = m(be); $('#oMax').textContent = m(max); $('#oJ').textContent = rate > 0 ? fmt(Math.ceil(1 / rate)) : '–';
      $('#cNote').textContent = rate > 0 ? `Pay more than ${m(be)} per join and you lose money. Keep joins under ${m(max)} to keep ${Math.round(mar * 100)}% profit.` : 'Enter your join-to-deposit rate to see your numbers.';
    }
    [cPay, cRate, cMar].forEach((i) => i.addEventListener('input', calc)); calc();
    const gloss = { CPL: ['Cost per lead', 'What you pay for one lead. For Telegram, count real joins, not clicks.'], FTD: ['First-time deposit', 'The first time a person you brought puts money in. Most affiliate payouts are based on it.'], CPA: ['Cost per action', 'What you pay for one result you care about, like a sign-up or a deposit.'], ROAS: ['Return on ad spend', 'Revenue divided by ad spend. 3× means $3 back for every $1 spent.'], CAPI: ['Conversions API', 'Meta’s way to receive events from a server, so ad blockers and in-app browsers can’t hide them.'], Postback: ['Postback', 'A message your network sends when someone registers or deposits, so your tracker can credit the ad.'], CTR: ['Click-through rate', 'The share of people who saw your ad and clicked it. A falling CTR is an early sign of a tired creative.'], Frequency: ['Frequency', 'How many times the average person saw your ad. When it climbs on a small audience, results usually drop.'] };
    const gc = $('#gchips'), gd = $('#gdef');
    function showG(k) { $$('.gchip', gc).forEach((c) => c.setAttribute('aria-pressed', c.textContent === k)); gd.innerHTML = `<b>${esc(k)} · ${esc(gloss[k][0])}</b><p>${esc(gloss[k][1])}</p>`; }
    Object.keys(gloss).forEach((k) => { const b = document.createElement('button'); b.className = 'gchip'; b.textContent = k; b.onclick = () => showG(k); gc.appendChild(b); });
    showG('FTD');
  }

  /* ---------- free tools: chips from the tools setting + a looping Kill-or-scale demo ---------- */
  function renderFreeTools() {
    const list = (S.site && S.site.calc_tools) || [];
    const box = $('#ftChips');
    const sec = $('#free-tools');
    if (!box || !sec) return;
    if (S.site && !list.length) { sec.hidden = true; $$('a[href="#free-tools"]').forEach((a) => { a.hidden = true; }); return; }
    box.innerHTML = list.map((t, i) => { const m = (window.VTA && VTA.META[t.key]) || null; return `<a class="ftchip${m ? ' sf-' + m.surf : ''}" href="/app#tools/${esc(t.key)}" style="--d:${i}${m ? `;--a:${m.a};--t:${m.t || m.a}` : ''}" data-ta-host><span class="fti">${m ? VTA.art(t.key) : ic(VS.P[t.icon] ? t.icon : 'spark')}</span>${esc(t.name)}<em class="${t.access === 'premium' ? 'p' : ''}">${t.access === 'premium' ? `${ic('premium')}Premium` : 'Free'}</em></a>`; }).join('');
    const fi = $('.ftd-ic');
    if (fi && window.VTA) { fi.innerHTML = VTA.art('killscale'); fi.classList.add('has-art'); }
    if (window.VTA) { VTA.watch(box); VTA.watch(sec); }
    if (S.user) $('#ftCtas').innerHTML = `<a class="btn btn-g" href="/app#tools">Open the tools <span class="arr">${ic('arrow')}</span></a>`;
  }
  /* Three example ad sets typed into the card in turn. Their verdicts follow the default rules (checked in test/smoke.js). */
  const FT_DEMO = [
    { spend: 60, conv: 0, verdict: 'kill', label: 'Kill', reason: 'You spent 2.4× your target CPA without a single conversion.' },
    { spend: 85, conv: 3, verdict: 'hold', label: 'Hold', reason: 'CPA is 1.13× your target. Keep the budget where it is.' },
    { spend: 110, conv: 6, verdict: 'scale', label: 'Scale +20%', reason: 'CPA is 0.73× your target across 6 conversions.' },
  ];
  const FT_TARGET = 25, FT_PAYOUT = 40;
  function initToolsDemo() {
    const card = $('#ftDemo');
    if (!card) return;
    const q = (k) => $(`[data-t="${k}"]`, card);
    const paint = (d) => {
      const cpa = d.conv ? d.spend / d.conv : NaN;
      q('cpa').textContent = d.conv ? '$' + cpa.toFixed(2) : '—';
      q('roas').textContent = ((d.conv * FT_PAYOUT) / d.spend).toFixed(2) + '×';
      const pill = q('pill');
      pill.className = 'ftd-pill v-' + d.verdict;
      pill.textContent = d.label;
      if (!reduce) { pill.classList.remove('flip'); void pill.offsetWidth; pill.classList.add('flip'); }
      q('reason').textContent = d.reason;
      // Meter: CPA against target on a 0–2.5× scale; no conversions fills it red.
      q('meter').style.width = (d.conv ? Math.min(cpa / FT_TARGET / 2.5, 1) * 100 : 100) + '%';
      q('meter').className = 'v-' + d.verdict;
    };
    if (reduce) { const d = FT_DEMO[2]; q('spend').textContent = d.spend; q('conv').textContent = d.conv; paint(d); return; }
    let on = false, wake = null;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const waitVisible = () => (on && !document.hidden ? Promise.resolve() : new Promise((r) => { wake = r; }));
    const resume = () => { if (on && !document.hidden && wake) { const w = wake; wake = null; w(); } };
    document.addEventListener('visibilitychange', resume);
    if ('IntersectionObserver' in window) new IntersectionObserver((es) => { on = es[0].isIntersecting; card.classList.toggle('run', on); resume(); }, { threshold: 0.25 }).observe(card);
    else on = true;
    const type = async (k, val) => {
      const el = q(k), caret = $(`[data-c="${k}"]`, card), s = String(val);
      caret.classList.add('on');
      el.textContent = '';
      await sleep(260);
      for (const ch of s) { await waitVisible(); el.textContent += ch; await sleep(120); }
      await sleep(180);
      caret.classList.remove('on');
    };
    (async () => {
      for (let i = 0; ; i = (i + 1) % FT_DEMO.length) {
        await waitVisible();
        const d = FT_DEMO[i];
        card.classList.add('typing');
        await type('spend', d.spend);
        await type('conv', d.conv);
        card.classList.remove('typing');
        paint(d);
        await sleep(2800);
      }
    })();
  }

  /* ---------- lesson preview player ---------- */
  let PL = null;
  async function openPreview(slug) {
    if (!slug) return;
    const o = overlay(`<div class="player" role="dialog" aria-modal="true" aria-label="Lesson preview"><div class="pl">
      <div class="pl-top"><span class="av">${VS.founder()}</span><div><b>Loading lesson…</b><small>VooSquare Academy · free preview</small></div><button class="x" data-x aria-label="Close lesson">${ic('x')}</button></div>
      <div class="pl-loading"><div class="skel" style="width:min(520px,80vw);height:240px;opacity:.15"></div></div></div></div>`, { onClose: () => { PL = null; } });
    let r;
    try { r = await VS.api('/api/courses/' + encodeURIComponent(slug)); }
    catch (e) { if (stack.includes(o)) endScreen(o, { icon: 'help', title: 'We couldn’t load this lesson.', text: e.message, acts: `<button class="btn btn-l" data-retry>Try again</button><button class="btn btn-ow" data-x>Close</button>` }, () => { o.close(); openPreview(slug); }); return; }
    if (!stack.includes(o)) return;
    const c = r.course || {}, ls = r.lessons || [];
    const L = ls.find((l) => !l.locked && l.steps && l.steps.length) || ls[0];
    const topHtml = (lsn) => `<span class="av">${courseAuthor(c)}</span><div><b>${esc(lsn ? lsn.title : c.title)}</b><small>${esc(c.title || '')}${lsn ? ` · Lesson ${(lsn.idx ?? ls.indexOf(lsn)) + 1}` : ''} · ${esc(c.author_name || 'Zedapex team')}</small></div><button class="x" aria-label="Close lesson">${ic('x')}</button>`;
    const plEl = $('.pl', o.el);
    if (!L || L.locked || !(L.steps && L.steps.length)) {
      $('.pl-top', plEl).innerHTML = topHtml(L); $('.pl-top .x', plEl).onclick = () => o.close();
      const prem = c.premium || (L && L.locked);
      endScreen(o, prem
        ? { icon: 'lock', lk: 1, title: 'This course is part of Premium.', text: 'Premium unlocks every Academy course, the premium rooms and a monthly live breakdown with Dchessking.', acts: S.user ? `<a class="btn btn-l" href="/app#premium">Go Premium</a><button class="btn btn-ow" data-x>Close</button>` : `<button class="btn btn-l" data-auth="signup" data-next="/app#premium">Create account and go Premium</button><button class="btn btn-ow" data-x>Close</button>` }
        : { icon: 'book', lk: 1, title: 'Lessons are on the way.', text: 'This course has no published lessons yet. Create your free account and we’ll tell you when it’s live.', acts: S.user ? `<a class="btn btn-l" href="/app#academy">Open the Academy</a>` : `<button class="btn btn-l" data-auth="signup" data-next="/app#academy">Create my free account</button>` });
      return;
    }
    PL = { o, c, L, steps: L.steps, i: 0, prog: 0, playing: !reduce, last: performance.now() };
    plEl.innerHTML = `<div class="pl-top">${topHtml(L)}</div><div class="pl-bars">${L.steps.map(() => '<i><b></b></i>').join('')}</div><div id="plBody"></div>`;
    $('.pl-top .x', plEl).onclick = () => o.close();
    plRender();
    requestAnimationFrame(plLoop);
  }
  function plRender() {
    const s = PL.steps[PL.i], body = $('#plBody', PL.o.el);
    body.innerHTML = `<div class="vl-stage">${window.VSL ? window.VSL.render(s) : `<div class="vl-big"><b>${esc(s.h)}</b></div>`}</div>
      <div class="pl-text"><p class="sk">Step ${PL.i + 1} of ${PL.steps.length} · Free preview</p><h3>${esc(s.h || '')}</h3><p>${esc(s.p || '')}</p></div>
      <div class="pl-ctl"><button class="cb" data-pp aria-label="Previous step">${ic('left')}</button><button class="cb main" data-pl aria-label="${PL.playing ? 'Pause' : 'Play'}">${ic(PL.playing ? 'pause' : 'play')}</button><button class="cb" data-pn aria-label="Next step">${ic('arrow')}</button><span class="cnt">${esc(PL.L.minutes || '')} min lesson<br>Examples, not promised results</span></div>`;
    if (window.VSL) window.VSL.animate(body);
    $$('.pl-bars i b', PL.o.el).forEach((b, i) => { b.style.width = i < PL.i ? '100%' : '0%'; });
    $('[data-pp]', body).onclick = () => plGo(PL.i - 1);
    $('[data-pn]', body).onclick = () => plGo(PL.i + 1);
    $('[data-pl]', body).onclick = plToggle;
  }
  function plToggle() {
    PL.playing = !PL.playing;
    const b = $('[data-pl]', PL.o.el);
    if (b) { b.innerHTML = ic(PL.playing ? 'pause' : 'play'); b.setAttribute('aria-label', PL.playing ? 'Pause' : 'Play'); }
  }
  function plGo(i) {
    if (!PL) return;
    if (i < 0) i = 0;
    if (i >= PL.steps.length) { plDone(); return; }
    PL.i = i; PL.prog = 0; plRender();
  }
  function plDone() {
    const { o, c } = PL; PL.playing = false; PL.done = true;
    $$('.pl-bars i b', o.el).forEach((b) => { b.style.width = '100%'; });
    $('#plBody', o.el).innerHTML = `<div class="pl-end"><span class="big">${ic('check')}</span><h3>That was lesson 1.</h3><p>${S.user ? `Keep going with ${esc(c.title)} in the Academy. Your progress saves as you learn.` : `Create your free account to keep going: the rest of ${esc(c.title)}, the community and every Voo tool.`}</p>
      <div class="acts">${S.user ? '<a class="btn btn-l" href="/app#academy">Continue in the Academy</a>' : '<button class="btn btn-l" data-auth="signup" data-next="/app#academy">Create my free account</button>'}<button class="btn btn-ow" data-again>Watch again</button></div></div>`;
    $('[data-again]', o.el).onclick = () => { PL.done = false; PL.playing = !reduce; plGo(0); };
    if (!reduce && !S.user) VS.confetti();
  }
  function plLoop(t) {
    if (!PL) return;
    const dt = Math.min(t - PL.last, 100); PL.last = t;
    if (PL.playing && !PL.done && !document.hidden) {
      const s = PL.steps[PL.i]; const dur = Math.max(6000, Math.min(11000, String(s.p || '').length * 60));
      PL.prog += dt / dur;
      const b = $$('.pl-bars i b', PL.o.el)[PL.i]; if (b) b.style.width = Math.min(PL.prog, 1) * 100 + '%';
      if (PL.prog >= 1) plGo(PL.i + 1);
    }
    requestAnimationFrame(plLoop);
  }
  function endScreen(o, { icon, lk, title, text, acts }, retry) {
    const pl = $('.pl', o.el);
    const body = $('#plBody', pl) || $('.pl-loading', pl);
    const div = document.createElement('div'); div.id = 'plBody';
    div.innerHTML = `<div class="pl-end"><span class="big ${lk ? 'lk' : ''}">${ic(icon)}</span><h3>${esc(title)}</h3><p>${esc(text)}</p><div class="acts">${acts}</div></div>`;
    body.replaceWith(div);
    $$('[data-x]', div).forEach((b) => b.addEventListener('click', () => o.close()));
    const r = $('[data-retry]', div); if (r && retry) r.onclick = retry;
  }
  document.addEventListener('keydown', (e) => {
    if (!PL || PL.done || stack[stack.length - 1] !== PL.o) return;
    if (e.key === 'ArrowRight') plGo(PL.i + 1);
    else if (e.key === 'ArrowLeft') plGo(PL.i - 1);
    else if (e.key === ' ' && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); plToggle(); }
  });

  /* ---------- blog ---------- */
  const postAuthor = (p) => VS.authorAvatar(p.author_key, (Number(p.id) || 3) + 5);
  function postCard(p, cls = '') {
    return `<a class="post ${cls}" href="/blog/${esc(encodeURIComponent(p.slug))}" data-post="${esc(p.slug)}"><div class="pc" style="background:${safeBg(p.grad, 'linear-gradient(135deg,#0F2E20,#1E6B47)')}"><span class="pm2">${esc(p.mark || '')}</span><span class="trk">${esc(p.category || 'Blog')}</span>${p.premium ? `<span class="lockb">${ic('lock')}Premium</span>` : ''}</div><div class="pb"><h3>${esc(p.title)}</h3>${cls === 'row' ? '' : `<p>${esc(p.excerpt || '')}</p>`}<div class="pmeta"><span class="av">${postAuthor(p)}</span>${esc(p.author_name || 'Zedapex team')} · ${esc(p.minutes || 3)} min read</div></div></a>`;
  }
  function renderBlog() {
    const posts = (S.site && S.site.posts) || [];
    const g = $('#blogGrid'), more = $('#blogMore');
    if (!posts.length) {
      g.className = 'blog-grid solo';
      g.innerHTML = `<div class="card empty" style="border-radius:26px">${ic('pen')}<b>${S.failed ? 'We couldn’t load the blog right now.' : 'First posts are on the way.'}</b><span>${S.failed ? 'Refresh in a moment.' : 'Field notes from the buying desk land here soon.'}</span></div>`;
      more.innerHTML = ''; return;
    }
    const feat = posts.find((p) => p.featured) || posts[0];
    const rest = posts.filter((p) => p !== feat);
    if (!rest.length) { g.className = 'blog-grid solo'; g.innerHTML = postCard(feat, 'big'); more.innerHTML = ''; return; }
    g.className = 'blog-grid';
    g.innerHTML = `<div>${postCard(feat, 'big')}</div><div class="post-list">${rest.slice(0, 3).map((p) => postCard(p, 'row')).join('')}</div>`;
    more.innerHTML = rest.slice(3).map((p) => postCard(p)).join('');
  }
  function renderBody(body) {
    return (Array.isArray(body) ? body : []).map((b) => {
      if (typeof b === 'string') return `<p>${esc(b)}</p>`;
      const t = Array.isArray(b) ? b[0] : b && (b.t || b.type);
      const v = Array.isArray(b) ? b[1] : b && (b.text ?? b.items ?? b.v);
      if (t === 'h' || t === 'h2' || t === 'h3') return `<h4>${esc(v)}</h4>`;
      if (t === 'q' || t === 'quote') return `<p class="pull">${esc(v)}</p>`;
      if (t === 'ul' || t === 'ol') return `<${t}>${(Array.isArray(v) ? v : [v]).map((x) => `<li>${esc(x)}</li>`).join('')}</${t}>`;
      if (t === 'img') { const u = safeUrl(v); return u ? `<img src="${esc(u)}" alt="${esc(Array.isArray(b) ? b[2] || '' : b.alt || '')}" loading="lazy">` : ''; }
      return `<p>${esc(v)}</p>`;
    }).join('');
  }
  let reader = null, readerPushed = false;
  async function openPost(slug, { push = true } = {}) {
    if (!slug) return;
    let replacing = false;
    if (reader) { silentRemove(reader); reader = null; replacing = true; }
    const o = overlay(`<div class="vs-sheet reader"><div class="vs-sheet-p" role="dialog" aria-modal="true" aria-label="Blog post" style="width:min(740px,100%)">
      <div class="sheet-cv" style="background:linear-gradient(135deg,#0F2E20,#1E6B47)"><button class="x" data-x aria-label="Close post">${ic('x')}</button><div style="position:relative;width:100%"><div class="skel" style="height:34px;width:70%;opacity:.25"></div></div></div>
      <div class="sheet-b"><div class="skel" style="height:18px"></div><div class="skel" style="height:18px;width:90%"></div><div class="skel" style="height:18px;width:80%"></div></div></div></div>`, {
      onClose: () => {
        reader = null; document.title = 'VooSquare';
        if (location.pathname.startsWith('/blog/')) { if (readerPushed) { readerPushed = false; history.back(); } else history.replaceState(null, '', '/#blog'); }
      },
    });
    reader = o;
    if (push && location.pathname !== '/blog/' + encodeURIComponent(slug)) {
      if (replacing) history.replaceState({ post: slug }, '', '/blog/' + encodeURIComponent(slug));
      else { history.pushState({ post: slug }, '', '/blog/' + encodeURIComponent(slug)); readerPushed = true; }
    }
    let r;
    try { r = await VS.api('/api/posts/' + encodeURIComponent(slug)); }
    catch (e) {
      if (reader !== o) return;
      $('.sheet-b', o.el).innerHTML = `<div class="empty">${ic('help')}<b>${e.status === 404 ? 'We couldn’t find that post.' : 'We couldn’t load this post.'}</b><span>${esc(e.status === 404 ? 'It may have moved or been unpublished.' : e.message)}</span><button class="btn btn-k btn-sm" data-x>Back to the blog</button></div>`;
      $$('[data-x]', $('.sheet-b', o.el)).forEach((b) => b.onclick = () => o.close());
      return;
    }
    if (reader !== o) return;
    const p = r.post; document.title = p.title + ' · VooSquare';
    const cv = $('.sheet-cv', o.el);
    cv.style.background = safeBg(p.grad, 'linear-gradient(135deg,#0F2E20,#1E6B47)');
    cv.innerHTML = `<span class="bigmk">${esc(p.mark || '')}</span><button class="x" aria-label="Close post">${ic('x')}</button><div style="position:relative"><span class="trk">${esc(p.category || 'Blog')} · ${esc(p.minutes || 3)} min read</span>${p.premium ? ` <span class="lockb">${ic('lock')}Premium</span>` : ''}<h3>${esc(p.title)}</h3></div>`;
    $('.x', cv).onclick = () => o.close();
    const paywall = p.locked ? `<div class="paywall"><b>Go Premium to read the rest.</b><p>This post is part of Premium. You also get every Academy course, the premium rooms and a monthly live breakdown with Dchessking.</p>${S.user ? '<a class="btn btn-l" href="/app#premium">Go Premium</a>' : '<button class="btn btn-l" data-auth="signup" data-next="/app#premium">Create account and go Premium</button>'}</div>` : '';
    const more = (r.more || []).slice(0, 2);
    $('.sheet-b', o.el).innerHTML = `<div class="by"><span class="av">${postAuthor(p)}</span><div><b>${esc(p.author_name || 'Zedapex team')}</b><small>${esc(p.author_role || '')}${p.created_at ? ' · ' + esc(VS.dateStr(p.created_at)) : ''}</small></div></div>
      <article class="article ${p.locked ? 'fade' : ''}">${p.excerpt ? `<p style="font-weight:600;color:var(--ink)">${esc(p.excerpt)}</p>` : ''}${renderBody(p.body)}</article>${paywall}
      ${!p.locked && !S.user ? `<div class="paywall" style="background:linear-gradient(140deg,var(--brand2),var(--deep))"><b>Get notes like this every week.</b><p style="color:rgba(255,255,255,.85)">Create your free Voo ID for the blog, the free Academy courses and the community.</p><button class="btn btn-w" data-auth="signup">Create my free account</button></div>` : ''}
      ${more.length ? `<div class="keep"><b>Keep reading</b><div class="kl">${more.map((m) => postCard(m, 'row')).join('')}</div></div>` : ''}`;
    $('.vs-sheet-p', o.el).scrollTop = 0;
  }
  window.addEventListener('popstate', () => {
    const m = /^\/blog\/([^/]+)$/.exec(location.pathname);
    if (m) { readerPushed = false; openPost(decodeURIComponent(m[1]), { push: false }); }
    else if (reader) { readerPushed = false; silentRemove(reader); reader = null; document.title = 'VooSquare'; }
  });
  function silentRemove(o) { const i = stack.indexOf(o); if (i >= 0) stack.splice(i, 1); o.el.remove(); if (!stack.length) document.body.style.overflow = ''; syncFloat(); }

  /* ---------- pricing ---------- */
  function renderPricing() {
    const fp = (S.site && S.site.free_plan) || FALLBACK.free_plan;
    const pr = (S.site && S.site.premium) || FALLBACK.premium;
    const u = S.user;
    const li = (f) => `<li><span class="ck">${ic('check')}</span><span>${esc(f)}</span></li>`;
    const freeBtn = u ? '<a class="btn btn-w btn-block" href="/app">Open dashboard</a>' : '<button class="btn btn-k btn-block" data-auth="signup">Create my free account</button>';
    const premBtn = u && u.premium ? '<a class="btn btn-l btn-block" href="/app#premium">You’re Premium · manage</a>' : u ? '<a class="btn btn-l btn-block" href="/app#premium">Go Premium</a>' : '<button class="btn btn-l btn-block" data-auth="signup" data-next="/app#premium">Go Premium</button>';
    const plans = [`<div class="plan"><div class="pn">${VS.productIcon({ icon: 'voosquare' }, 'sm')}${esc(fp.name || 'Free for life')}${u && !u.premium ? '<span class="pill pill-g">Your plan</span>' : ''}</div><div class="pp"><b>$0</b><span>forever</span></div><p class="pt">Everything you need to start, with one Voo ID.</p><ul>${(fp.features || []).map(li).join('')}</ul>${freeBtn}</div>`];
    if (pr && pr.enabled !== false) plans.push(`<div class="plan prem"><span class="glow"></span><div class="pn"><span class="pi pi-sm" style="background:var(--lime);color:#14200A">${ic('diamond')}</span>${esc(pr.name || 'Premium')}${u && u.premium ? '<span class="pill pill-l">Your plan</span>' : '<span class="pill pill-l">For operators who scale</span>'}</div><div class="pp"><b>${money(pr.price_usd || 0)}</b><span>per ${esc(periodLabel(pr.period_days))}</span></div>${pr.tagline ? `<p class="pt">${esc(pr.tagline)}</p>` : ''}<ul>${(pr.features || []).map(li).join('')}</ul>${premBtn}</div>`);
    const box = $('#plans'); box.className = 'plans' + (plans.length === 1 ? ' one' : ''); box.innerHTML = plans.join('');
    const paid = ((S.site && S.site.rooms) || []).filter((r) => r.access === 'paid');
    $('#planNote').innerHTML = paid.length ? `<span>Paid rooms are sold separately:</span>${paid.map((r) => `<span class="pr"><span class="ri" style="background:${safeColor(r.color, '#111312')}">${ic(VS.P[r.icon] ? r.icon : 'star')}</span>${esc(r.name)}${r.price_usd ? ` · ${r.approval_required ? 'invite only, ' : ''}${money(r.price_usd)}/mo` : ''}</span>`).join('')}` : '';
    const fq = $('#faqPremium');
    if (fq && pr) fq.innerHTML = `<p>${pr.enabled === false ? 'Premium is paused right now.' : `${money(pr.price_usd || 0)} a ${esc(periodLabel(pr.period_days))}. It includes:`}</p><ul>${(pr.features || []).map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
  }

  /* ---------- what's new + site promos ---------- */
  function renderNews() {
    const items = [];
    const posts = (S.site && S.site.posts) || [];
    const fresh = S.products.filter((p) => ['new', 'beta'].includes(status(p)));
    const live = S.products.filter((p) => status(p) === 'live');
    const latestPost = [...posts].sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    fresh.slice(0, 2).forEach((p) => items.push(['p', p]));
    latestPost.slice(0, 4 - items.length - (fresh.length > 2 ? 1 : 0)).forEach((p) => items.push(['b', p]));
    fresh.slice(2).concat(live).forEach((p) => { if (items.length < 4) items.push(['p', p]); });
    $('#news').innerHTML = items.slice(0, 4).map(([k, x]) => {
      if (k === 'b') return `<a class="nw" href="/blog/${esc(encodeURIComponent(x.slug))}" data-post="${esc(x.slug)}"><div class="nt"><span class="pi pi-sm" style="background:${safeBg(x.grad, 'var(--brand)')}">${esc(x.mark || 'V')}</span><b>Blog</b><span class="pill pill-g">${esc(x.category || 'Post')}</span></div><h3>${esc(x.title)}</h3><p>${esc(x.excerpt || '')}</p><span class="go" style="color:var(--deep)">Read the post ${ic('arrow')}</span></a>`;
      const a = productAction(x); const c = accent(safeColor(x.color, '#00774B'));
      const inner = `<div class="nt">${VS.productIcon(x, 'sm')}<b>${esc(x.name)}</b>${statusPill(x)}</div><h3>${esc(x.tagline || x.name)}</h3>${x.offer ? `<p>${esc(x.offer)}.</p>` : ''}<span class="go" style="color:${c}">${esc(a.label)} ${ic(a.ext ? 'ext' : 'arrow')}</span>`;
      return a.href ? `<a class="nw" href="${esc(a.href)}" ${a.ext ? 'target="_blank" rel="noopener"' : ''}>${inner}</a>` : `<button class="nw" data-auth="signup" data-product="${esc(a.product || '')}" ${a.next ? `data-next="${esc(a.next)}"` : ''}>${inner}</button>`;
    }).join('');
    // Spotlight slider (shared with the app): only slides placed on the website.
    const raw = (S.site && S.site.ads) || [];
    const ads = VS.spotlight ? VS.spotlight.pick(raw, 'website') : [];
    $('#promos').innerHTML = ads.length ? VS.spotlight.render(ads, { interval: raw[0] && raw[0].interval }) : '';
  }

  /* ---------- footer ---------- */
  function renderFooter() {
    const b = (S.site && S.site.brand) || FALLBACK.brand;
    $('#ftTools').innerHTML = S.products.map((p) => { const u = safeUrl(p.url); return `<li>${u ? `<a href="${esc(u)}" ${isExt(u) ? 'target="_blank" rel="noopener"' : ''}>${esc(p.name)}${isExt(u) ? ic('ext') : ''}</a>` : `<a href="#tool-${esc(p.slug)}">${esc(p.name)}${status(p) === 'soon' ? ' · soon' : ''}</a>`}</li>`; }).join('');
    $('#ftCopy').textContent = `© ${new Date().getFullYear()} VooSquare · A ${b.company || 'Zedapex'} company`;
    $('#ftAbout').textContent = `Tools for media buyers and big performing operators. A ${b.company || 'Zedapex'} company, built in Lagos.`;
    const soc = [];
    const h = (v) => String(v || '').trim().replace(/^@/, '');
    const link = (v, base) => { v = String(v || '').trim(); if (!v) return ''; if (/^https?:\/\//i.test(v)) return safeUrl(v); return /^[\w.]{2,40}$/.test(h(v)) ? base + h(v) : ''; };
    [['Telegram', link(b.telegram, 'https://t.me/')], ['X', link(b.x, 'https://x.com/')], ['Instagram', link(b.instagram, 'https://instagram.com/')]].forEach(([n, u]) => { if (u) soc.push(`<a href="${esc(u)}" target="_blank" rel="noopener">${n}</a>`); });
    $('#socials').innerHTML = soc.join('');
  }

  /* ---------- skeleton-friendly first paint + data ---------- */
  /* ---------- app store buttons (hero + footer) ----------
   * The official Google and Apple badges are uploaded by the team in the admin; we never draw them. Until a badge is
   * there, a neutral button with a phone icon shows. A store without a link says "Coming soon" and is not clickable. */
  const PHONE = '<svg class="ico st-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M12 7.5v7M9.2 11.8 12 14.6l2.8-2.8M10.5 18.5h3"/></svg>';
  const storeLink = (u, prefix) => (typeof u === 'string' && u.startsWith(prefix) && !/[\s"'<>]/.test(u) ? u : '');
  function storeBtn(kind, a) {
    const play = kind === 'play';
    const name = play ? 'Google Play' : 'App Store';
    const url = play ? storeLink(a.play_url, 'https://play.google.com/') : storeLink(a.app_store_url, 'https://apps.apple.com/');
    const badge = play ? a.play_badge : a.app_store_badge;
    const lead = play ? 'Get it on' : 'Download on the';
    const label = url ? `${lead} ${name}` : `${name}, coming soon`;
    const img = badge && /^\/u\/[\w-]+\.(png|webp|jpg)$/.test(badge.url || '') ? badge : null;
    if (img) {
      const pic = `<img src="${VS.esc(img.url)}" alt="${VS.esc(label)}" height="48" width="${Math.round(48 * ((img.w || 3) / (img.h || 1)))}" loading="lazy">`;
      return url ? `<a class="st-badge" href="${VS.esc(url)}" target="_blank" rel="noopener">${pic}</a>` : `<span class="st-badge soon" role="img" aria-label="${VS.esc(label)}">${pic}<em>Coming soon</em></span>`;
    }
    const inner = `${PHONE}<span class="st-t"><small>${url ? lead : 'Coming soon'}</small><b>${name}</b></span>`;
    return url ? `<a class="st-btn" href="${VS.esc(url)}" target="_blank" rel="noopener" aria-label="${VS.esc(label)}">${inner}</a>` : `<span class="st-btn soon" role="img" aria-label="${VS.esc(label)}">${inner}</span>`;
  }
  function renderStores() {
    const a = (S.site && S.site.apps) || {};
    const html = storeBtn('play', a) + storeBtn('app_store', a);
    ['#heroStores', '#ftStores'].forEach((id) => { const el = $(id); if (el) el.innerHTML = html; });
  }

  function renderAll() {
    renderStores();
    renderMarq(); renderHeroDevice(); renderLessonsCost(); renderSystem(); renderLaunch(); renderFreeTools(); renderCommunity(); renderAcademy(); renderBlog(); renderPricing(); renderNews(); renderFooter();
    if (S.rerenderStory) S.rerenderStory();
    renderAccount();
    fill(document.querySelector('.site'));
  }

  function routeOnLoad() {
    const sec = { '/premium': 'pricing', '/pricing': 'pricing', '/academy': 'academy', '/community': 'community', '/blog': 'blog' }[path];
    const m = /^\/blog\/([^/]+)$/.exec(path);
    if (m) openPost(decodeURIComponent(m[1]), { push: false });
    else if (sec) { const el = document.getElementById(sec); if (el) el.scrollIntoView({ behavior: 'auto' }); }
    else if (location.hash && location.hash !== '#join' && location.hash.length > 1) { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView({ behavior: 'auto' }); }
    if (location.hash === '#join') openAuth({ mode: 'signup' });
  }

  function observe() {
    if (!('IntersectionObserver' in window)) { visible.story = visible.chat = true; if (S.wakeStory) S.wakeStory(); return; }
    const io = new IntersectionObserver((es) => { es.forEach((e) => { visible[e.target.dataset.vis] = e.isIntersecting; }); if (S.wakeStory) S.wakeStory(); }, { threshold: 0.15 });
    [['.hero', 'hero'], ['#story', 'story'], ['.cm-chat', 'chat']].forEach(([s, k]) => { const el = $(s); if (el) { el.dataset.vis = k; io.observe(el); } });
    const links = $$('.links a');
    const io2 = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id)); }), { rootMargin: '-45% 0px -50% 0px' });
    ['story', 'founder', 'tools', 'free-tools', 'community', 'academy', 'blog', 'pricing'].forEach((id) => { const el = document.getElementById(id); if (el) io2.observe(el); });
  }

  /* ---------- pause looping CSS animations off screen ---------- */
  /* Each top-level block of the page gets .anim-paused while it is off screen (site.css pauses every animation inside
   * it), and <html> gets .tab-hidden while the tab is in the background. Modals and the floating button are outside
   * these blocks and keep running. Reduced motion already turns the loops off in CSS. */
  function pauseOffscreen() {
    const root = document.documentElement;
    const onVis = () => root.classList.toggle('tab-hidden', document.hidden);
    document.addEventListener('visibilitychange', onVis); onVis();
    if (!('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('anim-paused', !e.isIntersecting)), { rootMargin: '120px 0px' });
    const seen = new WeakSet();
    const main = $('.site > main');
    const watch = () => [$('#loginPage'), $('#ann'), $('#nav'), ...(main ? [...main.children] : []), $('.site-f')].forEach((el) => {
      if (el && !seen.has(el)) { seen.add(el); io.observe(el); }
    });
    watch();
    if (main) new MutationObserver(watch).observe(main, { childList: true });
  }
  pauseOffscreen();

  /* ---------- global clicks ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    const au = t.closest('[data-auth]');
    if (au) { e.preventDefault(); if (authOpen && au.closest('.au-modal')) return; openAuth({ mode: au.dataset.auth, product: au.dataset.product || '', next: au.dataset.next || '' }); return; }
    const mb = t.closest('#menuB');
    if (mb) { const dr = $('#drawer'); const o = dr.classList.toggle('open'); mb.setAttribute('aria-expanded', o); mb.innerHTML = ic(o ? 'x' : 'menu'); return; }
    if (t.closest('#drawer a, #drawer button')) { const dr = $('#drawer'); dr.classList.remove('open'); const m = $('#menuB'); if (m) { m.setAttribute('aria-expanded', false); m.innerHTML = ic('menu'); } }
    const pst = t.closest('[data-post]');
    if (pst && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); openPost(pst.dataset.post); return; }
    const pl = t.closest('[data-play]');
    if (pl) { e.preventDefault(); openPreview(pl.dataset.play); return; }
    if (t.closest('[data-play-first]')) { const c = S.site && S.site.courses && S.site.courses[0]; if (c) openPreview(c.slug); else document.getElementById('academy').scrollIntoView(); return; }
    if (t.closest('[data-room]')) { if (S.user) location.href = '/app#community'; else openAuth({ mode: 'signup', next: '/app#community' }); return; }
    const a = t.closest('a[href]');
    if (a) {
      const href = a.getAttribute('href');
      if (href === '#join') { e.preventDefault(); openAuth({ mode: 'signup' }); return; }
      if (!S.user && S.meDone && /^\/app(\/|#|$)/.test(href) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openAuth({ mode: 'signup', next: href }); return; }
      if (href.startsWith('#') && href.length > 1 && stack.length) { stack.slice().reverse().forEach((o) => o.close()); }
    }
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.feature-r[data-play]')) { e.preventDefault(); openPreview(e.target.dataset.play); }
  });
  window.addEventListener('scroll', syncFloat, { passive: true });
  window.addEventListener('hashchange', () => { if (location.hash === '#join') openAuth({ mode: 'signup' }); });

  /* ---------- boot ---------- */
  async function bootSite() {
    $('#dcBig').innerHTML = VS.founder(true);
    fill(document.querySelector('.site'));
    initStory(); buildLanes($('#stage')); initCalc(); initToolsDemo(); initChat(); observe();
    renderMarq(); renderHeroDevice(); renderLessonsCost(); renderAccount(); syncFloat();
    routeOnLoad();
    const meP = VS.api('/api/me').then((r) => { S.user = (r && r.user) || null; }).catch(() => { S.user = null; }).finally(() => { S.meDone = true; });
    try {
      const site = await VS.api('/api/site');
      S.site = site;
      S.products = (site.products || []).filter((p) => !p.hub);
    } catch (e) {
      S.failed = true; S.site = null; S.products = FALLBACK.products;
    }
    await meP;
    // Areas the team switched off (Admin → Settings → Features) are hidden; maintenance mode shows "back soon".
    if (window.VSF && S.site) VSF.applySite(S.site.features, S.user);
    // VooSquare Academy's own website (voosquareacademy.com): the same school, for people who only want the lessons.
    const au = S.site && S.site.academy_url;
    if (au && /^https?:\/\//.test(au)) $$('[data-academy-site]').forEach((x) => { x.href = au; x.hidden = false; const h = x.querySelector('[data-academy-host]'); if (h) h.textContent = au.replace(/^https?:\/\/(www\.)?/, ''); });
    renderAnn(S.site && S.site.announcements);
    renderTop(S.site && S.site.top_card);
    renderAll();
    if (!S.site) {
      // Keep the fallback data available to sections that read S.site directly.
      S.site = { ...FALLBACK, posts: [], courses: [] };
      renderCommunity(); renderPricing(); renderStores();
    }
    // Sections above may have shifted; re-apply a deep-linked section scroll.
    const sec = { '/premium': 'pricing', '/pricing': 'pricing', '/academy': 'academy', '/community': 'community', '/blog': 'blog' }[path];
    if (sec) document.getElementById(sec).scrollIntoView({ behavior: 'auto' });
    else if (location.hash && location.hash.length > 1 && location.hash !== '#join') { const el = document.getElementById(location.hash.slice(1)); if (el) el.scrollIntoView({ behavior: 'auto' }); }
  }

  fill(document);
  if (isLogin) loginPage();
  else bootSite();
})();
