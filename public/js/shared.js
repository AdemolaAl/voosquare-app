/* VooSquare shared helpers: API, icons, animated avatars, toasts, live updates. Used by the site, the app and the admin. */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const money = (n, cur = 'USD') => (cur === 'USD' ? '$' + fmt(n, n % 1 ? 2 : 0) : fmt(n, 2) + ' ' + cur);

  function timeAgo(t) {
    const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 86400 * 7) return Math.floor(s / 86400) + 'd';
    return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  const dateStr = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  /* ---------------- API ---------------- */
  async function api(path, opts = {}) {
    const init = { method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'), headers: { 'x-vs': '1', ...(opts.headers || {}) }, credentials: 'same-origin' };
    if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
    let res;
    try { res = await fetch(path, init); } catch { const e = new Error('You seem to be offline. Check your connection.'); e.status = 0; throw e; }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    if (!res.ok) { const e = new Error((data && data.error) || 'Something went wrong. Try again.'); e.status = res.status; e.data = data; throw e; }
    return data;
  }

  /* ---------------- device fingerprint (privacy-light) ----------------
   * A short hash of stable browser traits (no canvas, no fonts, no storage), sent as `x-vs-fp` on sign-up and on the
   * affiliate application so the duplicate check can link one person's accounts. It never leaves VooSquare. */
  function fp() {
    try {
      const n = navigator, s = screen || {};
      const parts = [n.userAgent, n.language, (n.languages || []).join(','), n.platform, n.hardwareConcurrency, n.deviceMemory, n.maxTouchPoints,
        s.width + 'x' + s.height, s.colorDepth, window.devicePixelRatio, Intl.DateTimeFormat().resolvedOptions().timeZone];
      let h1 = 0x811c9dc5, h2 = 0x01000193;
      for (const c of parts.join('|')) { const k = c.charCodeAt(0); h1 = Math.imul(h1 ^ k, 16777619) >>> 0; h2 = Math.imul(h2 + k, 2246822519) >>> 0; }
      return 'fp1_' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
    } catch { return ''; }
  }
  /** Affiliate coupon kept from a tracking link (?coupon= on the page, or the vs_coupon cookie the link sets). */
  function coupon() {
    try {
      const q = new URLSearchParams(location.search).get('coupon');
      if (q && /^[A-Za-z0-9_-]{3,24}$/.test(q)) { sessionStorage.setItem('vs_coupon', q.toUpperCase()); return q.toUpperCase(); }
      const m = /(?:^|;\s*)vs_coupon=([A-Za-z0-9_-]{3,24})/.exec(document.cookie);
      return (m && m[1].toUpperCase()) || sessionStorage.getItem('vs_coupon') || '';
    } catch { return ''; }
  }

  /* ---------------- the VooSquare phone app (native shell) ----------------
   * The iPhone and Android apps load this site in a web view and add " VooSquareApp/<version> (ios|android)" to the user
   * agent. <html> gets is-app plus is-app-ios or is-app-android, so CSS and pages can adapt. In the apps nothing may sell
   * Premium or paid rooms (App Store 3.1.1, Google Play payments policy). For display only: never use it for security. */
  function nativeApp(ua) {
    const m = /VooSquareApp\/[\d.]+ \((ios|android)\)/i.exec(String(ua || ''));
    return { app: !!m, platform: m ? m[1].toLowerCase() : '' };
  }
  const native = nativeApp(typeof navigator !== 'undefined' ? navigator.userAgent : '');
  if (native.app) document.documentElement.classList.add('is-app', 'is-app-' + native.platform);

  /* ---------------- line icons ---------------- */
  const P = {
    home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/>',
    book: '<path d="M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>',
    chat: '<path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
    wallet: '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.2"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S9 9 12 9zM12 9c2-4 6-4 6-1.5S15 9 12 9z"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M9 20h6"/>',
    users: '<circle cx="9" cy="9" r="3.5"/><path d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5"/><circle cx="17" cy="8" r="2.6"/><path d="M16 13.5c2.6 0 4.4 1.6 5 4.5"/>',
    user: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6"/>',
    id: '<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 16.5c.6-1.7 2-2.6 3.5-2.6s2.9.9 3.5 2.6M15 10h3.5M15 13.5h3.5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M8.5 5v14M15.5 5v14" stroke-width="3"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    left: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    logout: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 16l-4-4 4-4M6 12h10"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    up: '<path d="M7 14l5-5 5 5"/>', down: '<path d="M7 10l5 5 5-5"/>',
    ext: '<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    tag: '<path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8-9 9z"/><circle cx="8" cy="8" r="1.6"/>',
    megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l7 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
    wave: '<path d="M7 11V6.5a1.5 1.5 0 0 1 3 0V11M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 15a1.6 1.6 0 0 1 2.6-1.8L7 14.5"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
    send: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 0 1 4.8 1c0 1.7-2.3 2-2.3 3.5M12 17h.01"/>',
    diamond: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16 3-16"/>',
    rocket: '<path d="M12 15l-3-3c1-4 4-8 10-9-1 6-5 9-9 10z"/><path d="M9 12l-4 1-2 3 4 1M12 15l-1 4 3 2 1-4"/><circle cx="15" cy="9" r="1.5"/>',
    /* The Premium mark: a square raised to a power ("Media buying, squared"). The exponent takes --pm when set. */
    premium: '<rect x="2.5" y="8" width="13" height="13" rx="3.4" fill="currentColor" stroke="none"/><rect x="17.2" y="2.8" width="5.2" height="5.2" rx="1.5" stroke="none" style="fill:var(--pm,currentColor)"/>',
    rooms: '<path d="M4 6.6A2.6 2.6 0 0 1 6.6 4h6.8A2.6 2.6 0 0 1 16 6.6v3.8a2.6 2.6 0 0 1-2.6 2.6H9.2L5.8 16v-3.1A2.6 2.6 0 0 1 4 10.4z"/><path d="M19 9.6a2 2 0 0 1 1 1.8v3.8a2 2 0 0 1-2 2v2.6l-3.1-2.6h-3a2 2 0 0 1-1.8-1.2"/>',
    live: '<rect x="3" y="4.5" width="18" height="13" rx="3"/><path d="M10.4 8.6v4.8l4-2.4z" fill="currentColor"/><path d="M8.5 21h7"/>',
    headset: '<path d="M4.5 14.5V12a7.5 7.5 0 0 1 15 0v2.5"/><rect x="3.5" y="13" width="4" height="6" rx="1.6"/><rect x="16.5" y="13" width="4" height="6" rx="1.6"/><path d="M18.5 19c0 1.4-1.4 2.3-3.5 2.3h-2"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5L12 13l8.5-6.5"/>',
    card: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
    pin: '<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    reply: '<path d="M10 8L5 12.5 10 17M5 12.5h9a5 5 0 0 1 5 5V19"/>',
    smile: '<circle cx="12" cy="12" r="8.5"/><path d="M8.5 14a4 4 0 0 0 7 0M9 10h.01M15 10h.01"/>',
    inbox: '<path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16l4-5 3 3 5-7"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    filter: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
    layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
    sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    block: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01" stroke-width="2.2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  };
  // Old data (room icons, notifications) may still say "crown": show a star. Hidden from icon pickers.
  Object.defineProperty(P, 'crown', { value: P.star, enumerable: false });
  const icon = (name, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || P.spark}</svg>`;

  /** The Premium mark as a tile: an ink square with its lime exponent. size: sm|md|lg|xl. Animates gently unless .still. */
  const pmark = (size = 'md', cls = '') => `<span class="pmk pmk-${size} ${cls}" aria-hidden="true"><i class="pmk-b"></i><i class="pmk-e"></i></span>`;

  /* ---------------- product icons ---------------- */
  const PI = {
    voosquare: '<svg viewBox="0 0 24 24"><rect class="sq-cell" x="4" y="4" width="7" height="7" rx="2" fill="#fff"/><rect class="sq-cell" x="13" y="4" width="7" height="7" rx="2" fill="#fff" opacity=".75"/><rect class="sq-cell" x="4" y="13" width="7" height="7" rx="2" fill="#fff" opacity=".75"/><rect class="sq-cell" x="13" y="13" width="7" height="7" rx="2" fill="#C9F65B"/></svg>',
    join: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.8"><circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/></svg>',
    cast: '<svg viewBox="0 0 24 24" fill="none"><path d="M15.6 8.1A5.4 5.4 0 1 0 15.6 15.9" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="19" cy="12" r="2" fill="#fff"/></svg>',
    reply: '<svg viewBox="0 0 24 24"><path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z" fill="#F5C542"/><circle cx="8.5" cy="10.5" r="1.3" fill="#111"/><circle cx="12" cy="10.5" r="1.3" fill="#111"/><circle cx="15.5" cy="10.5" r="1.3" fill="#111"/></svg>',
    vooads: '<svg viewBox="0 0 24 24"><circle cx="7.8" cy="12" r="4.2" fill="#fff"/><circle cx="16.2" cy="12" r="4.2" fill="#fff"/><g class="pupil"><circle cx="8.8" cy="12" r="2.1" fill="#EE5A2F"/><circle cx="17.2" cy="12" r="2.1" fill="#EE5A2F"/></g></svg>',
    land: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><rect x="4" y="5" width="16" height="14" rx="2.5"/><path d="M4 9.5h16M8 14h8"/></svg>',
    affleego: '<svg viewBox="0 0 24 24"><path d="M5 18L11 6h2l6 12h-3.2l-1.3-2.8H9.5L8.2 18z" fill="#111"/><path d="M10.6 12.6h2.8L12 9.6z" fill="#FFE14D"/></svg>',
    gatevoo: '<svg viewBox="0 0 24 24" fill="none"><path d="M17.4 8.2A6.4 6.4 0 1 0 18.4 13H12.6" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="12.4" r="1.7" fill="#3E9B6F"/></svg>',
    spyvoo: '<svg viewBox="0 0 24 24"><path d="M11 8.6h2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><circle cx="6.6" cy="12.3" r="5.3" fill="#fff"/><circle cx="17.4" cy="12.3" r="5.3" fill="#fff"/><g class="spy-eye"><circle cx="8.1" cy="12.3" r="2.35" fill="#0E1A3D"/><circle cx="18.9" cy="12.3" r="2.35" fill="#0E1A3D"/><circle cx="8.9" cy="11.4" r=".75" fill="#fff"/><circle cx="19.7" cy="11.4" r=".75" fill="#fff"/></g></svg>',
  };
  const PI_BG = {
    voosquare: 'linear-gradient(140deg,#12C784,#00774B)', join: 'linear-gradient(140deg,#7C5CFF,#5B3FE8)', cast: 'linear-gradient(140deg,#5B86FF,#2449D8)',
    reply: '#111312', vooads: '#111312', land: 'linear-gradient(140deg,#FF7DB5,#E8458B)', affleego: '#FFE14D', gatevoo: '#111111',
    spyvoo: '#3355F0',
  };
  /** Product icon chip. `icon` is a built-in key or an image URL. size: xs|sm|md|lg */
  function productIcon(p, size = 'md') {
    const key = (p && p.icon) || 'voosquare';
    const isUrl = /^(https?:)?\/\//.test(key) || key.startsWith('/');
    const col = p && /^#[0-9a-f]{3,8}$/i.test(String(p.color || '').trim()) ? p.color.trim() : '#00A86B';
    const bg = isUrl ? '#fff' : (PI_BG[key] || col);
    const inner = isUrl ? `<img src="${esc(key)}" alt="" loading="lazy">` : (PI[key] || `<b>${esc(((p && p.name) || '?')[0])}</b>`);
    return `<span class="pi pi-${size}" style="background:${bg}">${inner}</span>`;
  }

  /* ---------------- animated avatars ---------------- */
  const AV = {
    skins: ['#8D5524', '#C68642', '#5C3A1E', '#E0AC69', '#3B2219', '#A86B3C', '#6B4226', '#F1C27D'],
    bgs: ['#E7F8F0', '#E4ECFF', '#FFE3D6', '#FFF4CF', '#ECE8FF', '#FDE2EC', '#DDF3FF', '#F1F7D8'],
    shirts: ['#00A86B', '#5B3FE8', '#EE5A2F', '#3D6BF2', '#E8AE18', '#111312', '#E8458B', '#0F766E'],
    hairColors: ['#1B120C', '#3B2219', '#6B4226', '#C9A227', '#9AA3AD'],
    labels: { skin: 'Skin', hair: 'Hair', hairColor: 'Hair colour', eyes: 'Eyes', mouth: 'Mouth', acc: 'Extras', shirt: 'Top', bg: 'Background' },
    counts: { skin: 8, hair: 6, hairColor: 5, eyes: 3, mouth: 3, acc: 4, shirt: 8, bg: 8 },
  };
  let avN = 0;
  function avatar(a = {}, opts = {}) {
    const n = (k) => Math.abs(Number(a[k]) || 0) % AV.counts[k];
    const id = 'av' + (avN++);
    const skin = AV.skins[n('skin')], bg = AV.bgs[n('bg')], shirt = AV.shirts[n('shirt')], hc = AV.hairColors[n('hairColor')];
    const hairBack = [
      '', `<path d="M15 34C12 13 52 13 49 34L47 46H17Z" fill="${hc}"/>`, `<circle cx="32" cy="13" r="7" fill="${hc}"/>`, '', '', `<path d="M14 30C14 10 50 10 50 30v14H14z" fill="${hc}"/>`,
    ][n('hair')];
    const hairFront = [
      `<path d="M18.5 28C18 14 46 14 45.5 28C42 20.5 22 20.5 18.5 28Z" fill="${hc}"/>`,
      `<path d="M19 26C20 15 44 15 45 26C40 21 24 21 19 26Z" fill="${hc}"/>`,
      `<path d="M18.5 27C19 15 45 15 45.5 27C41 21 23 21 18.5 27Z" fill="${hc}"/>`,
      `<path d="M17 27C16 9 48 9 47 27C41 19.5 23 19.5 17 27Z" fill="${['#E8458B', '#F5C542', '#00A86B', '#EE5A2F', '#5B3FE8'][n('hairColor')]}"/><circle cx="40" cy="15" r="5" fill="${['#E8458B', '#F5C542', '#00A86B', '#EE5A2F', '#5B3FE8'][n('hairColor')]}"/>`,
      `<path d="M21 21c3-5 19-5 22 0" stroke="${hc}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
      `<path d="M18 27C18 15 46 15 46 27C42 22 22 22 18 27Z" fill="${hc}"/>`,
    ][n('hair')];
    const eyes = [
      '<ellipse cx="27" cy="31" rx="1.7" ry="2" fill="#140C08"/><ellipse cx="37" cy="31" rx="1.7" ry="2" fill="#140C08"/>',
      '<path d="M25 31.5q2-2.4 4 0M35 31.5q2-2.4 4 0" stroke="#140C08" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
      '<ellipse cx="27" cy="31" rx="1.7" ry="2" fill="#140C08"/><path d="M35 31.5h4" stroke="#140C08" stroke-width="1.8" stroke-linecap="round"/>',
    ][n('eyes')];
    const mouth = [
      '<path d="M27.5 37Q32 41 36.5 37" stroke="#3A1F14" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
      '<path d="M27 36.5Q32 43 37 36.5Z" fill="#3A1F14"/><path d="M28.5 37.2h7" stroke="#fff" stroke-width="1.2"/>',
      '<ellipse cx="32" cy="38" rx="2" ry="2.3" fill="#3A1F14"/>',
    ][n('mouth')];
    const acc = [
      '',
      '<g fill="none" stroke="#111" stroke-width="1.6"><circle cx="27" cy="31" r="4.2"/><circle cx="37" cy="31" r="4.2"/><path d="M31.2 31h1.6"/></g>',
      '<circle cx="19.5" cy="34" r="1.6" fill="#F5C542"/><circle cx="44.5" cy="34" r="1.6" fill="#F5C542"/>',
      `<path d="M18 22c0-9 28-9 28 0z" fill="${shirt}"/><path d="M44 21h8" stroke="${shirt}" stroke-width="3" stroke-linecap="round"/>`,
    ][n('acc')];
    const blinkDelay = ((Number(a.skin) || 0) * 0.7 + (Number(a.bg) || 0) * 0.3) % 4;
    const anim = opts.still || reduce ? '' : ` style="animation-delay:-${blinkDelay}s"`;
    return `<svg class="avsvg" viewBox="0 0 64 64" aria-hidden="true"><defs><clipPath id="${id}"><circle cx="32" cy="32" r="32"/></clipPath></defs><g clip-path="url(#${id})"><rect width="64" height="64" fill="${bg}"/>${hairBack}<path d="M8 66C10 50 21 45 32 45C43 45 54 50 56 66Z" fill="${shirt}"/><rect x="27.5" y="38" width="9" height="9" rx="3" fill="${skin}"/><ellipse cx="32" cy="30" rx="13" ry="15" fill="${skin}"/>${hairFront}<g class="blink"${anim}>${eyes}</g>${acc}${mouth}</g></svg>`;
  }
  /** Illustrated founder avatar (swap for a real photo in admin later). */
  function founder(big) {
    const id = 'fd' + (avN++);
    return `<svg class="avsvg" viewBox="0 0 200 ${big ? 240 : 200}" aria-hidden="true">${big ? '' : `<defs><clipPath id="${id}"><circle cx="100" cy="100" r="100"/></clipPath></defs>`}<g ${big ? '' : `clip-path="url(#${id})"`}>${big ? '' : '<rect width="200" height="200" fill="#1F4A35"/>'}
    <path d="M20 ${big ? 240 : 206}C26 ${big ? 170 : 160} 60 150 100 150C140 150 174 ${big ? 170 : 160} 180 ${big ? 240 : 206}Z" fill="#0A0F0C"/>
    <path d="M78 150L100 182L122 150" fill="#C9F65B"/><path d="M88 150L100 168L112 150" fill="#0A0F0C"/>
    <rect x="86" y="118" width="28" height="30" rx="10" fill="#6B4226"/><ellipse cx="100" cy="92" rx="40" ry="46" fill="#7A4A2A"/>
    <path d="M60 86C58 44 142 44 140 86C134 66 118 58 100 58C82 58 66 66 60 86Z" fill="#120B07"/>
    <path d="M66 110C70 140 130 140 134 110C128 128 72 128 66 110Z" fill="#120B07"/>
    <g class="blink"><ellipse cx="84" cy="92" rx="4.5" ry="5.2" fill="#120B07"/><ellipse cx="116" cy="92" rx="4.5" ry="5.2" fill="#120B07"/></g>
    <g fill="none" stroke="#C9F65B" stroke-width="3"><rect x="70" y="82" width="26" height="20" rx="7"/><rect x="104" y="82" width="26" height="20" rx="7"/><path d="M96 90h8"/></g>
    <path d="M88 116Q100 124 112 116" stroke="#2A140A" stroke-width="3.5" fill="none" stroke-linecap="round"/>
    <g transform="translate(100 34)"><path d="M-22 6L-16 -12L-6 0L0 -16L6 0L16 -12L22 6Z" fill="#C9F65B"/><rect x="-22" y="6" width="44" height="7" rx="3" fill="#C9F65B"/></g></g></svg>`;
  }
  const authorAvatar = (key, seed = 7) => (key === 'dchessking' ? founder() : avatar({ skin: seed % 8, hair: seed % 6, shirt: (seed * 3) % 8, bg: (seed * 5) % 8, hairColor: seed % 5 }));
  function bot() {
    return '<svg class="avsvg" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="32" fill="#FFD9D3"/><rect x="18" y="20" width="28" height="24" rx="7" fill="#9AA3AD"/><rect x="30.5" y="12" width="3" height="8" fill="#9AA3AD"/><circle cx="32" cy="11" r="3" fill="#E5322D"/><rect x="23" y="27" width="6" height="6" rx="1.5" fill="#E5322D"/><rect x="35" y="27" width="6" height="6" rx="1.5" fill="#E5322D"/><rect x="25" y="37" width="14" height="3" rx="1.5" fill="#5B636B"/></svg>';
  }

  /* ---------------- toast & confetti ---------------- */
  let toastT;
  function toast(msg, kind = 'ok') {
    $$('.vs-toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'vs-toast ' + kind;
    t.setAttribute('role', 'status');
    t.innerHTML = icon(kind === 'err' ? 'x' : 'check') + '<span>' + esc(msg) + '</span>';
    document.body.appendChild(t);
    clearTimeout(toastT);
    toastT = setTimeout(() => t.remove(), 3200);
  }
  function confetti() {
    if (reduce) return;
    const cf = document.createElement('div');
    cf.className = 'vs-confetti';
    const cols = ['#5B3FE8', '#F5C542', '#EE5A2F', '#3D6BF2', '#00A86B', '#C9F65B'];
    for (let i = 0; i < 70; i++) {
      const c = document.createElement('i');
      c.style.left = Math.random() * 100 + '%';
      c.style.background = cols[i % 6];
      c.style.animationDelay = Math.random() * 0.5 + 's';
      c.style.width = c.style.height = 7 + Math.random() * 8 + 'px';
      cf.appendChild(c);
    }
    document.body.appendChild(cf);
    setTimeout(() => cf.remove(), 2800);
  }

  /** Count a number up inside an element. */
  function countUp(el, to, { dec = 0, pre = '', suf = '', ms = 1100 } = {}) {
    if (!el) return;
    const show = (v) => { el.textContent = pre + fmt(v, dec) + suf; };
    if (reduce) return show(to);
    const t0 = performance.now();
    (function step(t) { const p = Math.min((t - t0) / ms, 1); show(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(t0);
  }

  /* ---------------- live updates (SSE with reconnect) ---------------- */
  function stream(channels, handlers) {
    let es; let closed = false; let retry = 1000;
    const open = () => {
      if (closed) return;
      es = new EventSource('/api/stream?ch=' + encodeURIComponent(channels.join(',')));
      for (const [ev, fn] of Object.entries(handlers)) es.addEventListener(ev, (e) => { try { fn(JSON.parse(e.data)); } catch (err) { console.error(err); } });
      es.onopen = () => { retry = 1000; };
      es.onerror = () => { es.close(); if (!closed) setTimeout(open, retry = Math.min(retry * 2, 15000)); };
    };
    open();
    return { close() { closed = true; if (es) es.close(); } };
  }

  async function copyText(text, el) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch {
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      toast('Selected. Copy it to share.');
    }
  }

  function fillIcons(root = document) {
    $$('[data-i]', root).forEach((el) => { if (!el.dataset.iDone) { el.insertAdjacentHTML('afterbegin', icon(el.dataset.i)); el.dataset.iDone = 1; } });
  }

  /* Soft keyboard (QA-21): when a field gets focus on a phone, or the keyboard opens and shrinks the visible area, keep the
   * field in the middle of what is still visible. iOS does not always scroll a field out from under a fixed bottom bar. */
  if (window.visualViewport && matchMedia('(pointer: coarse)').matches) {
    const keepVisible = () => {
      const el = document.activeElement;
      if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || /^(checkbox|radio|range|button|submit)$/.test(el.type)) return;
      const r = el.getBoundingClientRect(); const vv = window.visualViewport;
      if (r.bottom > vv.height - 88 || r.top < 56) el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
    };
    document.addEventListener('focusin', () => setTimeout(keepVisible, 320));
    window.visualViewport.addEventListener('resize', () => setTimeout(keepVisible, 60));
  }

  window.VS = { $, $$, esc, fmt, money, timeAgo, dateStr, timeStr, api, icon, P, pmark, productIcon, PI, avatar, founder, authorAvatar, bot, AV, toast, confetti, countUp, stream, copyText, fillIcons, reduce, fp, coupon };
  window.VS.native = native; // { app, platform: 'ios'|'android'|'' } (the phone app, above)
  window.VS.nativeApp = nativeApp;
})();
