/* VooSquare member app: core helpers, state and shared components. Loaded before the page modules. */
(function () {
  'use strict';
  const VS = window.VS;
  const { $, $$, esc, icon } = VS;

  /* ---------------- state + tiny event bus ---------------- */
  const S = {
    user: null, home: null, rooms: null, roomsMeta: { rules: [], ads: [] }, tickets: null,
    unreadRooms: 0, openTickets: 0, notifs: [], route: { name: 'home', arg: '' },
  };
  const bus = {};
  const on = (ev, fn) => { (bus[ev] = bus[ev] || []).push(fn); return () => { bus[ev] = bus[ev].filter((f) => f !== fn); }; };
  const emit = (ev, data) => (bus[ev] || []).slice().forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } });

  /* ---------------- helpers ---------------- */
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const firstName = (n) => String(n || 'there').trim().split(/\s+/)[0];
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } },
  };
  const isMobile = () => matchMedia('(max-width: 1060px)').matches;
  const greeting = () => { const h = new Date().getHours(); return h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const plural = (n, one, many) => `${VS.fmt(n)} ${n === 1 ? one : (many || one + 's')}`;

  /** Amount in a payment currency: crypto keeps its precision. */
  function fmtAmount(n, cur) {
    const c = String(cur || '').toUpperCase();
    const x = Number(n) || 0;
    if (c === 'USD') return '$' + VS.fmt(x, x % 1 ? 2 : 0);
    if (['BTC', 'ETH'].includes(c)) return x.toLocaleString('en-US', { maximumFractionDigits: 8 }) + ' ' + c;
    return VS.fmt(x, x % 1 ? 2 : 0) + ' ' + c;
  }

  /** Escape, then turn URLs into links and keep line breaks. */
  function richText(s) {
    return esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`).replace(/\n/g, '<br>');
  }

  /** Internal links (/app#x or #x) route inside the app; everything else opens a new tab. */
  /** Links from settings or connected tools: only http(s), mailto and same-site paths are followed. */
  const safeHref = (u) => { u = String(u || '').trim(); return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(u) && !/[\s\\]/.test(u) ? u : ''; };
  function go(url) {
    url = safeHref(url);
    if (!url) return;
    const m = /^(?:\/app)?(#.*)$/.exec(url);
    if (m) { if (location.hash === m[1]) emit('route:refresh'); else location.hash = m[1]; return; }
    if (url.startsWith('/') && !url.startsWith('//')) { location.href = url; return; }
    window.open(url, '_blank', 'noopener');
  }
  const isInternal = (url) => /^(?:\/app)?#/.test(url || '');

  /* ---------------- countries ---------------- */
  const COUNTRIES = [
    ['NG', 'Nigeria'], ['KE', 'Kenya'], ['GH', 'Ghana'], ['ZA', 'South Africa'], ['CM', 'Cameroon'], ['UG', 'Uganda'], ['TZ', 'Tanzania'], ['RW', 'Rwanda'],
    ['CI', "Côte d'Ivoire"], ['SN', 'Senegal'], ['BJ', 'Benin'], ['TG', 'Togo'], ['ZM', 'Zambia'], ['ZW', 'Zimbabwe'], ['MW', 'Malawi'], ['ET', 'Ethiopia'],
    ['EG', 'Egypt'], ['MA', 'Morocco'], ['TN', 'Tunisia'], ['DZ', 'Algeria'], ['BW', 'Botswana'], ['NA', 'Namibia'], ['MZ', 'Mozambique'], ['AO', 'Angola'],
    ['CD', 'DR Congo'], ['GA', 'Gabon'], ['LR', 'Liberia'], ['SL', 'Sierra Leone'], ['GM', 'Gambia'], ['BF', 'Burkina Faso'], ['ML', 'Mali'], ['NE', 'Niger'],
    ['GB', 'United Kingdom'], ['US', 'United States'], ['CA', 'Canada'], ['DE', 'Germany'], ['FR', 'France'], ['NL', 'Netherlands'], ['ES', 'Spain'], ['IT', 'Italy'],
    ['PT', 'Portugal'], ['IE', 'Ireland'], ['PL', 'Poland'], ['UA', 'Ukraine'], ['TR', 'Türkiye'], ['AE', 'United Arab Emirates'], ['SA', 'Saudi Arabia'], ['QA', 'Qatar'],
    ['IN', 'India'], ['PK', 'Pakistan'], ['BD', 'Bangladesh'], ['ID', 'Indonesia'], ['PH', 'Philippines'], ['VN', 'Vietnam'], ['TH', 'Thailand'], ['MY', 'Malaysia'],
    ['SG', 'Singapore'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['AR', 'Argentina'], ['CO', 'Colombia'], ['CL', 'Chile'], ['PE', 'Peru'], ['AU', 'Australia'], ['NZ', 'New Zealand'],
  ];
  const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...cc].map((c) => 0x1F1A5 + c.charCodeAt(0))) : '');
  const countryName = (cc) => (COUNTRIES.find((c) => c[0] === cc) || [cc, cc || ''])[1];
  const countryOptions = (sel) => `<option value="">Choose your country</option>` + COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${flag(c)}  ${esc(n)}</option>`).join('');

  /* ---------------- overlays ---------------- */
  const layer = () => $('#layer');
  /** Centered modal on desktop, bottom sheet on phones. Returns { el, close }. */
  function modal(html, { cls = '', onClose, sheet = true } = {}) {
    const wrap = el(`<div class="vs-modal am-wrap ${sheet ? 'am-sheetable' : ''}" role="dialog" aria-modal="true"><div class="vs-modal-p am ${cls}">${html}</div></div>`);
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      wrap.classList.add('out');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => wrap.remove(), 220);
      if (onClose) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey);
    layer().appendChild(wrap);
    const f = wrap.querySelector('[autofocus]');
    if (f && !isMobile()) setTimeout(() => f.focus(), 60);
    return { el: wrap, close };
  }
  const modalHead = (title, sub) => `<div class="vs-modal-h"><div><h3>${title}</h3>${sub ? `<p class="am-sub">${sub}</p>` : ''}</div><button class="x" data-close aria-label="Close">${icon('x')}</button></div>`;

  /** In-app confirm (no window.confirm). Resolves true/false. */
  function ask(title, body, { ok = 'Confirm', danger = false } = {}) {
    return new Promise((resolve) => {
      let done = false;
      const m = modal(`${modalHead(esc(title))}<div class="vs-modal-b"><p class="muted">${esc(body)}</p><div class="am-actions"><button class="btn btn-w" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-k'}" data-ok>${esc(ok)}</button></div></div>`, { cls: 'am-sm', onClose: () => { if (!done) resolve(false); } });
      m.el.querySelector('[data-ok]').onclick = () => { done = true; resolve(true); m.close(); };
    });
  }

  /* ---------------- buttons ---------------- */
  async function busy(btn, fn) {
    if (!btn) return fn();
    btn.classList.add('loading'); btn.disabled = true;
    try { return await fn(); } finally { btn.classList.remove('loading'); btn.disabled = false; }
  }
  const errToast = (e) => {
    // Session ended (logged out elsewhere, banned or expired): send them to log in and come back here.
    if (e && e.status === 401) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.hash)); return; }
    VS.toast((e && e.message) || 'Something went wrong. Try again.', 'err');
  };

  /* ---------------- one-tap switch between VooSquare and VooSquare Academy (src/academy.js) ----------------
   * Sessions are per site. switchTo asks this site for a single-use link (60 seconds) that signs the member in on the
   * other site, then goes there. Same Voo ID, same progress: nobody logs in twice. */
  const LEARN = document.body.dataset.mode === 'learn';
  let switching = false;
  async function switchTo(target, next, btn) {
    if (switching) return;
    switching = true;
    try {
      await busy(btn, async () => {
        const r = await VS.api('/api/auth/handoff', { body: { target, next } });
        if (r && r.url) location.href = r.url;
      });
    } catch (e) { switching = false; errToast(e); return; }
    setTimeout(() => { switching = false; }, 4000);
  }

  /* ---------------- skeletons & empty states ---------------- */
  const skel = (h = 18, w = '100%', r = 12) => `<span class="skel" style="display:block;height:${h}px;width:${w};border-radius:${r}px"></span>`;
  const skelCards = (n = 3, h = 120) => `<div class="sk-grid">${Array.from({ length: n }, () => skel(h, '100%', 20)).join('')}</div>`;
  const empty = (ic, title, body, action = '') => `<div class="empty">${icon(ic)}<b>${title}</b>${body ? `<p>${body}</p>` : ''}${action ? `<div class="empty-a">${action}</div>` : ''}</div>`;
  const errorBox = (msg, retry = true) => `<div class="empty err-box">${icon('refresh')}<b>That did not load</b><p>${esc(msg || 'Check your connection and try again.')}</p>${retry ? '<div class="empty-a"><button class="btn btn-w btn-sm" data-retry>Try again</button></div>' : ''}</div>`;

  /* ---------------- product + people bits ---------------- */
  const STATUS = {
    live: ['Live', 'pill-g'], new: ['New', 'pill-l'], beta: ['Beta', 'pill-b'], soon: ['Coming soon', 'pill-w'],
  };
  const statusPill = (s) => { const x = STATUS[s] || [s ? s[0].toUpperCase() + s.slice(1) : 'Live', 'pill-w']; return `<span class="pill ${x[1]}">${esc(x[0])}</span>`; };
  const toolOpenUrl = (t) => safeHref(t.summary && t.summary.open_url) || safeHref(t.launch_url) || '';
  const toolState = (t) => {
    const url = toolOpenUrl(t);
    if (t.status === 'soon' && url) return 'waitlist';
    if (t.status === 'soon' || !url) return 'soon';
    return 'open';
  };
  const av = (a, size = 'md', still) => `<span class="av av-${size}">${VS.avatar(a || {}, { still })}</span>`;
  function badges(u) {
    let b = '';
    if (u.role_title) b += `<span class="bdg ${/founder/i.test(u.role_title) ? 'bdg-founder' : 'bdg-staff'}">${esc(u.role_title)}</span>`;
    else if (u.staff) b += '<span class="bdg bdg-staff">Staff</span>';
    if (u.premium) b += `<span class="bdg bdg-prem">${icon('premium')}Premium</span>`;
    return b;
  }
  /** The room's picture (upload or house artwork). Rooms without one get their icon on a solid tile in the room colour. */
  const safeImg = (u) => (/^\/(?!\/)[\w\-./?=&]+$/.test(String(u || '')) ? u : '');
  const roomChip = (r, size = '') => {
    const img = safeImg(r.image);
    return img
      ? `<span class="rchip pic ${size}" style="--rc:${esc(r.color || '#00A86B')}"><img src="${esc(img)}" alt="" loading="lazy" decoding="async"></span>`
      : `<span class="rchip ${size}" style="--rc:${esc(r.color || '#00A86B')}">${icon(r.icon || 'chat')}</span>`;
  };
  /** A room's wide cover as an <img> ('' when it has none). */
  const roomCover = (r, cls = '') => { const c = safeImg(r.cover); return c ? `<img class="${cls}" src="${esc(c)}" alt="" loading="lazy" decoding="async">` : ''; };
  /** Overlapping member faces. list: [{ avatar }]. */
  const faceStack = (list, max = 4, size = 'sm') => (list || []).slice(0, max).map((f) => `<span class="av av-${size} fs-i">${VS.avatar(f.avatar || {}, { still: true })}</span>`).join('');

  /* ---------------- cartoon buying team (from the approved design) ---------------- */
  function person(a, shirt, screen, wave) {
    const n = (k) => Math.abs(Number(a[k]) || 0) % VS.AV.counts[k];
    const skin = VS.AV.skins[n('skin')];
    const face = VS.avatar(a, {}).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const armL = `<g class="armt"><path d="M44 128 Q34 142 50 152" stroke="${shirt}" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="52" cy="152" r="6.5" fill="${skin}"/></g>`;
    const armR = wave ? `<g class="armw"><path d="M96 126 Q112 112 114 90" stroke="${shirt}" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="114" cy="84" r="7.5" fill="${skin}"/></g>` : `<g class="armt r"><path d="M96 128 Q106 142 90 152" stroke="${shirt}" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="88" cy="152" r="6.5" fill="${skin}"/></g>`;
    // The face is the member avatar without its circular background, scaled into the head slot.
    const head = face.replace(/<rect width="64" height="64" fill="[^"]+"\/>/, '').replace(/<path d="M8 66C10 50[^>]*\/>/, '').replace(/<rect x="27.5" y="38"[^>]*\/>/, '');
    return `<svg viewBox="0 0 140 170" aria-hidden="true"><g class="pbody"><path d="M30 172C32 124 48 108 70 108C92 108 108 124 110 172Z" fill="${shirt}"/><path d="M62 108 L70 120 L78 108" fill="rgba(255,255,255,.18)"/><rect x="62" y="94" width="16" height="18" rx="6" fill="${skin}"/><g class="phead"><g transform="translate(25.2 25) scale(1.4)">${head}</g></g>${armL}${armR}</g><g><path d="M36 132 H104 L100 168 H40 Z" fill="#20322A"/><path d="M36 132 H104 L100 168 H40 Z" fill="none" stroke="#365A47" stroke-width="1.5"/><circle class="screen" cx="70" cy="150" r="7" fill="${screen}"/></g></svg>`;
  }
  const CREW = [
    { a: { skin: 3, hair: 3, hairColor: 2, eyes: 0, mouth: 0, acc: 2, shirt: 1, bg: 0 }, shirt: '#5B3FE8', screen: '#9F8BFF', col: '#9F8BFF' },
    { a: { skin: 7, hair: 0, hairColor: 0, eyes: 0, mouth: 1, acc: 1, shirt: 0, bg: 0 }, shirt: '#00A86B', screen: '#C9F65B', col: '#12C784', wave: 1 },
    { a: { skin: 0, hair: 2, hairColor: 1, eyes: 1, mouth: 0, acc: 0, shirt: 4, bg: 0 }, shirt: '#E8AE18', screen: '#F5C542', col: '#F5C542' },
  ];
  const crewHtml = (wave) => CREW.map((c, i) => `<div class="seat">${person(c.a, c.shirt, c.screen, wave === undefined ? c.wave : wave === i)}</div>`).join('');
  function sparks(box, n = 10) {
    if (VS.reduce) return;
    for (let i = 0; i < n; i++) {
      const sp = document.createElement('span');
      sp.className = 'spark';
      sp.style.left = (5 + Math.random() * 90) + '%';
      sp.style.bottom = (Math.random() * 40) + 'px';
      sp.style.animationDelay = (-Math.random() * 6) + 's';
      sp.style.background = ['#C9F65B', '#12C784', '#9F8BFF', '#F5C542'][i % 4];
      box.appendChild(sp);
    }
  }

  /* ---------------- face builder (onboarding + profile) ---------------- */
  const COLOR_KEYS = { skin: 'skins', hairColor: 'hairColors', shirt: 'shirts', bg: 'bgs' };
  const ORDER = ['skin', 'hair', 'hairColor', 'eyes', 'mouth', 'acc', 'shirt', 'bg'];
  function randomFace() { const a = {}; for (const k of ORDER) a[k] = Math.floor(Math.random() * VS.AV.counts[k]); return a; }
  /**
   * Mounts the builder into `box`. Returns { get() }. onChange(avatar) fires on every change.
   */
  function faceBuilder(box, initial, onChange, { dark = false } = {}) {
    const a = { ...randomFace(), ...(initial || {}) };
    for (const k of ORDER) a[k] = Math.abs(Number(a[k]) || 0) % VS.AV.counts[k];
    box.innerHTML = `<div class="fb ${dark ? 'fb-dark' : ''}">
      <div class="fb-prev"><div class="fb-face" aria-label="Your face preview"></div><button class="btn btn-w btn-sm fb-rand" type="button">${icon('refresh')}Randomise</button></div>
      <div class="fb-rows">${ORDER.map((k) => `<div class="fb-row" data-k="${k}"><span class="fb-l">${esc(VS.AV.labels[k])}</span><div class="fb-opts" role="radiogroup" aria-label="${esc(VS.AV.labels[k])}"></div></div>`).join('')}</div>
    </div>`;
    const face = box.querySelector('.fb-face');
    const paintFace = (bounce) => {
      face.innerHTML = VS.avatar(a);
      if (bounce && !VS.reduce) { face.classList.remove('bounce'); void face.offsetWidth; face.classList.add('bounce'); }
    };
    const paintRow = (k) => {
      const row = box.querySelector(`.fb-row[data-k="${k}"] .fb-opts`);
      row.innerHTML = Array.from({ length: VS.AV.counts[k] }, (_, i) => {
        const on = a[k] === i;
        const inner = COLOR_KEYS[k] ? `<i style="background:${VS.AV[COLOR_KEYS[k]][i]}"></i>` : VS.avatar({ ...a, [k]: i }, { still: true });
        return `<button type="button" class="fb-o ${COLOR_KEYS[k] ? 'sw' : 'pv'} ${on ? 'on' : ''}" role="radio" aria-checked="${on}" aria-label="${esc(VS.AV.labels[k])} ${i + 1}" data-v="${i}">${inner}</button>`;
      }).join('');
    };
    const paintAll = (bounce) => { paintFace(bounce); ORDER.forEach(paintRow); };
    paintAll(false);
    box.addEventListener('click', (e) => {
      const o = e.target.closest('.fb-o');
      if (o) {
        const k = o.closest('.fb-row').dataset.k;
        a[k] = Number(o.dataset.v);
        // Previews of other shape rows depend on the full face, so repaint everything.
        paintAll(true);
        if (onChange) onChange({ ...a });
        return;
      }
      if (e.target.closest('.fb-rand')) {
        Object.assign(a, randomFace());
        paintAll(true);
        const r = box.querySelector('.fb-rand');
        r.classList.remove('spin1'); void r.offsetWidth; r.classList.add('spin1');
        if (onChange) onChange({ ...a });
      }
    });
    return { get: () => ({ ...a }) };
  }

  /* ---------------- ads: the Spotlight slider (shared component in /js/spotlight.js) ---------------- */
  /** Slides a member should see: Premium offers are hidden from Premium members. */
  /** iPhone app: no Premium or paid-room sales, prices or links to them (App Store guideline 3.1.1). */
  const NO_SALES = !!(VS.native && VS.native.app); // the phone apps (iPhone and Android) never sell: members buy on the website
  const SALE_URL = /#premium|\/(premium|pricing)(\/|$|\?|#)|checkout/i;
  /** Slides a member should see: Premium offers are hidden from Premium members (and from everyone in the iPhone app). */
  const adsFor = (ads) => (ads || []).filter((a) => a && !(S.user && S.user.premium && /#premium/.test(a.cta_url || '')) && !(NO_SALES && SALE_URL.test(a.cta_url || '')));
  /** Full-width animated slider for the dashboard and Academy. */
  function spotlight(ads, opts = {}) {
    const list = adsFor(ads);
    if (!list.length || !VS.spotlight) return '';
    return VS.spotlight.render(list, { interval: list[0].interval, ...opts });
  }
  /** Compact rotating card (community). Rotates through every community slide, not just the one passed in. */
  function adCard(ad) {
    if (!ad) return '';
    const all = (S.roomsMeta && S.roomsMeta.ads) || [];
    return spotlight(all.includes(ad) ? all : [ad], { variant: 'mini' });
  }

  /* ---------------- premium upsell ---------------- */
  function premiumUpsell(title, body) {
    // iPhone app: say it is part of Premium, nothing more (no button, no price, no "go buy").
    if (NO_SALES) return `<div class="upsell"><div class="upsell-art" aria-hidden="true">${VS.pmark('xl')}</div><h3>${esc(title || 'This is part of Premium')}</h3><p>This is part of VooSquare Premium.</p></div>`;
    return `<div class="upsell"><div class="upsell-art" aria-hidden="true">${VS.pmark('xl')}</div>
      <h3>${esc(title || 'This is part of Premium')}</h3><p>${esc(body || 'Premium members get every course, the premium rooms and monthly live breakdowns with Dchessking.')}</p>
      <div class="upsell-a"><a class="btn btn-l" href="#premium">${icon('premium')}See Premium</a></div></div>`;
  }

  /* ---------------- XP pop ---------------- */
  function xpPop(text, host = document.body) {
    const p = el(`<div class="xp-pop"><b>${esc(text)}</b></div>`);
    host.appendChild(p);
    setTimeout(() => p.remove(), 2200);
  }

  /* ---------------- events (tool activity) ---------------- */
  const EVENT_NAMES = {
    join: ['real join', 'real joins'], signup: ['sign-up', 'sign-ups'], register: ['sign-up', 'sign-ups'], lead: ['lead', 'leads'],
    ftd: ['first deposit', 'first deposits'], deposit: ['deposit', 'deposits'], chat_closed: ['chat closed', 'chats closed'], chat: ['chat', 'chats'],
    sale: ['sale', 'sales'], ad_created: ['ad made', 'ads made'], creative: ['creative made', 'creatives made'], broadcast: ['broadcast sent', 'broadcasts sent'],
    message: ['message sent', 'messages sent'], spend: ['spend logged', 'spend logged'], payment: ['payment', 'payments'],
  };
  const evName = (t, n) => { const x = EVENT_NAMES[t]; if (x) return n === 1 ? x[0] : x[1]; return String(t || 'event').replace(/[_-]+/g, ' '); };
  const evText = (e) => (e.label ? e.label : (e.product ? e.product + ': ' : '') + evName(e.type, 1));

  window.APP = {
    S, on, emit, el, debounce, firstName, ls, isMobile, greeting, plural, fmtAmount, richText, go, isInternal,
    COUNTRIES, flag, countryName, countryOptions, modal, modalHead, ask, busy, errToast, skel, skelCards, empty, errorBox,
    safeHref, statusPill, toolOpenUrl, toolState, av, badges, roomChip, roomCover, faceStack, safeImg, person, CREW, crewHtml, sparks, faceBuilder, randomFace, adCard, spotlight,
    premiumUpsell, xpPop, evName, evText, pages: {}, LEARN, switchTo, NO_SALES,
  };
})();
