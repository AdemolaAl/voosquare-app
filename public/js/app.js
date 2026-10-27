/* VooSquare member app: boot, shell, router, search, notifications, onboarding and live updates. */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { $, $$, esc, icon } = VS;
  const S = A.S;

  /* ---------------- data loaders ---------------- */
  A.refreshHome = async function () {
    try {
      const h = await VS.api('/api/me/home');
      S.home = h;
      if (h.features) applyFeatures(h.features);
      S.openTickets = h.open_tickets || 0;
      A.emit('home:loaded'); A.emit('badges');
      paintSideTools(); paintSideLesson();
    } catch (e) { if (e.status === 401) return toLogin(); if (e.status === 503 && e.data && e.data.maintenance && window.VSF) return VSF.showBackSoon(e.message); console.warn(e); }
  };
  /* Feature switches (Admin → Settings → Features): hide what is off, re-route away from it, maintenance for members. */
  function applyFeatures(f) {
    const was = S.features || {};
    S.features = f || {};
    if (!window.VSF) return;
    if (S.features.maintenance && !(S.user && S.user.staff)) { VSF.showBackSoon(S.features.maintenance_message); return; }
    VSF.bodyClasses(S.features);
    if (S.user && S.user.staff) VSF.staffBar(S.features);
    const changed = Object.keys(S.features).some((k) => typeof S.features[k] === 'boolean' && was[k] !== undefined && was[k] !== S.features[k]);
    if (changed && S.route && (VSF.pageOff(S.route.name, S.features) || VSF.pageOff(S.route.name, was))) A.emit('route:refresh');
    else if (changed && S.route && S.route.name === 'home') A.emit('route:refresh');
    else if (S.route && S.route.name === 'home' && S.home && S.home.whats_new) VSF.homeExtras(document.querySelector('#view .page'), S.home, S.features);
  }
  A.applyFeatures = applyFeatures;
  A.loadRooms = async function () {
    const d = await VS.api('/api/rooms');
    S.rooms = d.rooms; S.roomsMeta = { rules: d.rules || [], ads: d.ads || [] };
    // Invite-only rooms: an approval waiting for payment, or a decision, shows in the bell.
    d.rooms.forEach((r) => {
      const a = r.application;
      if (!a || r.unlocked || !a.decided_at) return;
      if (a.status === 'approved' && !a.waitlist) addNotif({ id: `ap${a.id}:approved`, room_id: r.id, ic: 'check', title: 'You are approved', body: `${r.name} · pay to take your seat`, at: a.decided_at, href: '#community/' + r.id });
      else if (a.status === 'rejected') addNotif({ id: `ap${a.id}:rejected`, room_id: r.id, ic: 'chat', title: 'Application update', body: r.name, at: a.decided_at, href: '#community/' + r.id });
    });
    A.recountRooms();
    A.emit('rooms');
    return d;
  };
  A.recountRooms = function () {
    S.unreadRooms = (S.rooms || []).filter((r) => r.unlocked).reduce((a, r) => a + (r.unread || 0), 0);
    A.emit('badges');
  };
  A.logout = async function () {
    try { await VS.api('/api/auth/logout', { body: {} }); } catch { /* still leave */ }
    location.href = '/';
  };
  // S.leaving: the member is deleting their account; the goodbye screen stays up instead of the login page.
  function toLogin() { if (S.leaving) return; location.replace('/login?next=' + encodeURIComponent(location.pathname + location.hash)); }

  /* ---------------- routes ---------------- */
  const NAV = [
    { k: 'home', t: 'Home', i: 'home' }, { k: 'apps', t: 'Apps', i: 'grid' }, { k: 'tools', t: 'Tools', i: 'calc' }, { k: 'community', t: 'Community', i: 'chat', b: 'rooms' },
    { k: 'academy', t: 'School', i: 'book' }, { k: 'tips', t: 'Tips', i: 'spark' }, { k: 'blog', t: 'Blog', i: 'pen' },
  ];
  const NAV2 = [
    { k: 'support', t: 'Support', i: 'help', b: 'tickets' }, { k: 'premium', t: 'Premium', i: 'premium' }, { k: 'referrals', t: 'Referrals', i: 'gift' }, { k: 'profile', t: 'Profile', i: 'user' },
  ];
  /* VooSquare Academy's own site (/learn on voosquareacademy.com): only the Academy lives here. Everything else is one tap
   * away on VooSquare, signed in with the same Voo ID (A.switchTo, src/academy.js). */
  const LEARN = A.LEARN;
  const LEARN_PAGES = ['academy', 'school', 'module', 'cert', 'tips', 'course', 'profile'];
  const NAV_L = [{ k: 'academy', t: 'School', i: 'book' }, { k: 'tips', t: 'Tips', i: 'spark' }, { k: 'profile', t: 'Profile', i: 'user' }];
  const NAV_VSQ = [
    { k: 'community', t: 'Community', i: 'chat' }, { k: 'apps', t: 'Apps', i: 'grid' }, { k: 'tools', t: 'Tools', i: 'calc' },
    { k: 'premium', t: 'Premium', i: 'premium' }, { k: 'support', t: 'Support', i: 'help' },
  ];
  const vsqPath = (r) => '/app' + (r && r.name && r.name !== 'home' ? '#' + r.name + (r.arg ? '/' + r.arg : '') : '');
  function parse() {
    let h = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (!h) return { name: LEARN ? 'academy' : 'home', arg: '' };
    let m = /^(billing-return|support):(.+)$/.exec(h);
    if (m) return { name: m[1], arg: m[2] };
    m = /^([a-z-]+)(?:\/(.+))?$/.exec(h);
    if (m && A.pages[m[1]]) return { name: m[1], arg: m[2] || '' };
    return { name: LEARN ? 'academy' : 'home', arg: '' };
  }
  /** Learn mode: a VooSquare page (community, Premium, billing, tools...) opens on VooSquare, already signed in. */
  function switchPage(r) {
    const n = NAV_VSQ.find((x) => x.k === r.name) || { t: (A.pages[r.name] && A.pages[r.name].title) || 'VooSquare', i: 'grid' };
    return {
      title: n.t, nav: r.name,
      render: (v) => {
        v.innerHTML = `<div class="ln-switch card"><span class="ln-sw-ic">${VS.productIcon({ icon: 'voosquare' }, 'lg')}</span>
          <h2>${esc(n.t)} is on VooSquare</h2><p>Same Voo ID, you're signed in. Your lessons and certificates stay right here.</p>
          <div class="ln-sw-a"><button class="btn btn-l" data-switch="${esc(vsqPath(r))}">${icon('arrow')}Open ${esc(n.t)} on VooSquare</button><a class="btn btn-w" href="#academy">Back to the Academy</a></div></div>`;
        // Opened from inside the Academy: go now, and leave the Academy page in history so Back comes back to it.
        // Opened directly (a bookmark, a reload, Back from VooSquare): wait for the tap.
        if (booted) { history.replaceState(history.state, '', location.pathname + location.search + lastLearnHash); A.switchTo('voosquare', vsqPath(r), v.querySelector('[data-switch]')); }
      },
    };
  }
  let booted = false; let lastLearnHash = '#academy';

  let cleanup = null, routeSeq = 0;
  function route() {
    const r = parse();
    S.route = r;
    if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
    const offK = window.VSF ? VSF.pageOff(r.name, S.features) : '';
    if (LEARN && LEARN_PAGES.includes(r.name)) lastLearnHash = location.hash || '#academy';
    const page = LEARN && !LEARN_PAGES.includes(r.name) ? switchPage(r)
      : offK ? { title: A.pages[r.name].title, nav: A.pages[r.name].nav, render: (v) => { v.innerHTML = VSF.offCard(offK); } } : A.pages[r.name];
    const main = $('#view');
    closeMenu();
    $$('.mpop,.rxpick').forEach((x) => x.remove());
    const v = document.createElement('section');
    v.className = 'page';
    v.dataset.p = r.name;
    main.replaceChildren(v);
    document.body.dataset.page = r.name;
    document.body.classList.toggle('in-room', (r.name === 'community' || r.name === 'support') && !!r.arg);
    A.setTitle(page.title);
    const nav = page.nav || r.name;
    $$('[data-nav]').forEach((b) => { const on = b.dataset.nav === nav; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    if (!page.full) window.scrollTo(0, 0);
    const seq = ++routeSeq;
    try {
      const c = page.render(v, r.arg);
      if (seq === routeSeq) cleanup = typeof c === 'function' ? c : null;
    } catch (e) {
      console.error(e);
      v.innerHTML = `<div class="card">${A.errorBox(e.message)}</div>`;
    }
    booted = true;
  }
  const SITE_NAME = LEARN ? 'VooSquare Academy' : 'VooSquare';
  A.setTitle = (t) => { const h = $('#pageTitle'); if (h) h.textContent = t; document.title = t && t !== 'Home' && t !== SITE_NAME ? `${t} · ${SITE_NAME}` : SITE_NAME; };
  A.on('route:refresh', route);

  /* ---------------- shell ---------------- */
  function shell() {
    const navBtn = (n) => `<a class="nl" href="#${n.k}" data-nav="${n.k}">${icon(n.i)}<span>${n.t}</span>${n.b ? `<span class="cnt" data-badge="${n.b}" hidden></span>` : ''}</a>`;
    if (LEARN) return learnShell(navBtn);
    $('#root').innerHTML = `<div class="shell" id="shell">
      <aside class="side" id="side" aria-label="VooSquare menu">
        <a class="brand" href="/" aria-label="VooSquare site">${VS.productIcon({ icon: 'voosquare' }, 'sm')}<span>Voo<b>Square</b></span></a>
        <a class="ws" href="#profile" id="wsCard"></a>
        <nav class="navg" aria-label="Main"><h5>Square</h5>${NAV.map(navBtn).join('')}</nav>
        <nav class="navg" aria-label="Account"><h5>Account</h5>${NAV2.map(navBtn).join('')}<a class="nl" href="/affiliates" data-aff-link>${icon('trend')}<span>Affiliates</span></a></nav>
        <div class="navg"><h5>Your tools</h5><div id="sideTools">${A.skel(34)}${A.skel(34)}</div></div>
        <div id="sideLesson"></div>
        <div class="side-foot"><button class="nl" data-logout>${icon('logout')}<span>Log out</span></button></div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main">
        <header class="top">
          <button class="ham" id="ham" aria-label="Open menu">${icon('menu')}</button>
          <h1 id="pageTitle">Home</h1>
          <button class="search" id="openPal">${icon('search')}<span>Search tools, rooms, lessons</span><kbd>${/Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl '}K</kbd></button>
          <div class="top-r">
            <button class="ib ib-search" id="openPalM" aria-label="Search">${icon('search')}</button>
            <button class="ib" id="bell" aria-label="Notifications">${icon('bell')}<span class="badge" id="bellN" hidden></span></button>
            <a class="me" href="#profile" id="meAv" aria-label="Your profile"></a>
          </div>
        </header>
        <div class="offline" id="offline" hidden>${icon('refresh')}You are offline. We will reconnect when you are back.</div>
        <main id="view" class="view"></main>
      </div>
      <nav class="bnav" aria-label="App">
        <a href="#home" data-nav="home">${icon('home')}<span>Home</span></a>
        <a href="#apps" data-nav="apps">${icon('grid')}<span>Apps</span></a>
        <a class="mid" href="#community" data-nav="community" aria-label="Community">${VS.productIcon({ icon: 'voosquare' }, 'lg')}<span class="cnt" data-badge="rooms" hidden></span></a>
        <a href="#academy" data-nav="academy">${icon('book')}<span>School</span></a>
        <button id="bMenu">${icon('menu')}<span>Menu</span><span class="mdot" data-badge="any" hidden></span></button>
      </nav>
    </div>`;
    shellEvents();
  }
  /** Learn mode: the Academy lock-up, Academy pages, and VooSquare one tap away (Community in the header and the tab bar). */
  function learnShell(navBtn) {
    const swBtn = (n) => `<a class="nl nl-sw" href="#${n.k}" data-switch="/app#${n.k}">${icon(n.i)}<span>${n.t}</span><span class="nl-ext">${icon('arrow')}</span></a>`;
    $('#root').innerHTML = `<div class="shell ln-shell" id="shell">
      <aside class="side" id="side" aria-label="VooSquare Academy menu">
        <a class="brand ln-brand" href="/" aria-label="VooSquare Academy home">${VS.productIcon({ icon: 'voosquare' }, 'sm')}<span class="ln-lock"><span>Voo<b>Square</b> Academy</span><small>The school for media buyers</small></span></a>
        <a class="ws" href="#profile" id="wsCard"></a>
        <nav class="navg" aria-label="Academy"><h5>Academy</h5>${NAV_L.map(navBtn).join('')}</nav>
        <nav class="navg" aria-label="VooSquare"><h5>On VooSquare</h5>${NAV_VSQ.map(swBtn).join('')}</nav>
        <div class="ln-comm"><span class="ln-comm-k">${VS.productIcon({ icon: 'voosquare' }, 'xs')}Community</span><b>Join our community.</b><p>Switch to VooSquare. Same Voo ID, you're signed in.</p><button class="btn btn-l btn-sm btn-block" data-switch="/app#community">Switch to VooSquare${icon('arrow')}</button></div>
        <div id="sideLesson"></div>
        <div class="side-foot"><button class="nl" data-logout>${icon('logout')}<span>Log out</span></button></div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main">
        <header class="top">
          <button class="ham" id="ham" aria-label="Open menu">${icon('menu')}</button>
          <h1 id="pageTitle">School</h1>
          <button class="search" id="openPal">${icon('search')}<span>Search lessons</span><kbd>${/Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl '}K</kbd></button>
          <div class="top-r">
            <button class="ln-top-comm" data-switch="/app#community" aria-label="Community on VooSquare">${VS.productIcon({ icon: 'voosquare' }, 'xs')}<span>Community</span></button>
            <button class="ib ib-search" id="openPalM" aria-label="Search">${icon('search')}</button>
            <button class="ib" id="bell" aria-label="Notifications">${icon('bell')}<span class="badge" id="bellN" hidden></span></button>
            <a class="me" href="#profile" id="meAv" aria-label="Your profile"></a>
          </div>
        </header>
        <div class="offline" id="offline" hidden>${icon('refresh')}You are offline. We will reconnect when you are back.</div>
        <main id="view" class="view"></main>
      </div>
      <nav class="bnav" aria-label="Academy">
        <a href="#academy" data-nav="academy">${icon('book')}<span>School</span></a>
        <a href="#tips" data-nav="tips">${icon('spark')}<span>Tips</span></a>
        <button class="mid" data-switch="/app#community" aria-label="Community on VooSquare">${VS.productIcon({ icon: 'voosquare' }, 'lg')}</button>
        <a href="#profile" data-nav="profile">${icon('user')}<span>Profile</span></a>
        <button id="bMenu">${icon('menu')}<span>Menu</span><span class="mdot" data-badge="any" hidden></span></button>
      </nav>
    </div>`;
    shellEvents();
    document.addEventListener('click', (e) => {
      const sw = e.target.closest('[data-switch]');
      if (!sw || e.defaultPrevented) return;
      e.preventDefault(); closeMenu();
      A.switchTo('voosquare', sw.dataset.switch, sw.tagName === 'BUTTON' ? sw : null);
    });
  }
  function shellEvents() {
    paintUser();
    paintSideTools();
    paintSideLesson();

    $('#ham').addEventListener('click', openMenu);
    $('#bMenu').addEventListener('click', openMenu);
    $('#scrim').addEventListener('click', closeMenu);
    $('#openPal').addEventListener('click', openPalette);
    $('#openPalM').addEventListener('click', openPalette);
    $('#bell').addEventListener('click', toggleNotifs);
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-logout]')) { e.preventDefault(); A.logout(); return; }
      const sl = e.target.closest('[data-side-resume]');
      if (sl) { e.preventDefault(); closeMenu(); A.resumeLearning(); return; }
      const g = e.target.closest('a[data-go]');
      if (g && g.dataset.go && !A.isInternal(g.dataset.go)) { e.preventDefault(); A.go(g.dataset.go); }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
      if (e.key === 'Escape') closeMenu();
    });
    // swipe the menu closed on phones
    let sx = null;
    $('#side').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    $('#side').addEventListener('touchend', (e) => { if (sx != null && e.changedTouches[0].clientX - sx < -60) closeMenu(); sx = null; });
    A.on('badges', paintBadges);
    A.on('user', paintUser);
  }
  function openMenu() { $('#shell').classList.add('open'); document.body.classList.add('noscroll-m'); }
  function closeMenu() { const s = $('#shell'); if (s) s.classList.remove('open'); document.body.classList.remove('noscroll-m'); }

  function paintUser() {
    const u = S.user;
    const ws = $('#wsCard');
    if (!ws) return;
    ws.innerHTML = `<span class="av">${VS.avatar(u.avatar)}</span><div class="ws-t"><b>${esc(u.name)}</b><small>@${esc(u.handle || '')}${u.premium ? `<span class="ws-prem">${icon('premium')}Premium</span>` : ''}</small></div>`;
    $('#meAv').innerHTML = VS.avatar(u.avatar);
  }
  function paintSideTools() {
    const box = $('#sideTools');
    if (!box || !S.home) return;
    const tools = S.home.tools || [];
    box.innerHTML = tools.map((t) => { const s = A.toolState(t); return `<button class="nl tl" data-tool="${t.id}">${VS.productIcon(t, 'xs')}<span>${esc(t.name)}</span><span class="stt ${s}" title="${s === 'open' ? 'Live' : s === 'waitlist' ? 'Waitlist' : 'Coming soon'}"></span></button>`; }).join('') || '<p class="side-empty">Tools appear here soon.</p>';
  }
  function paintSideLesson() {
    const box = $('#sideLesson');
    if (!box || !S.home || !A.continueCourse) return;
    const c = A.continueCourse();
    if (!c) { box.innerHTML = ''; return; }
    const pct = c.lessons ? Math.round(c.done / c.lessons * 100) : 0;
    box.innerHTML = `<div class="side-card"><span class="sc-k">${c.done ? 'Continue lesson' : 'Start here'}</span><b>${esc(c.title)}</b><p>${esc(c.author_name)} · ${c.done} of ${c.lessons} lessons</p><div class="prog"><i style="width:${pct}%"></i></div><button class="btn btn-l" data-side-resume>${icon('play')}${c.done ? 'Resume lesson' : 'Start lesson 1'}</button></div>`;
  }
  function paintBadges() {
    const vals = { rooms: S.unreadRooms, tickets: S.openTickets };
    $$('[data-badge]').forEach((b) => {
      const k = b.dataset.badge;
      const n = k === 'any' ? (vals.tickets || 0) : vals[k] || 0;
      b.hidden = !n;
      if (k !== 'any') b.textContent = n > 99 ? '99+' : n;
    });
    const unread = S.notifs.filter((n) => !n.read).length;
    const bn = $('#bellN');
    if (bn) { bn.hidden = !unread; bn.textContent = unread > 9 ? '9+' : unread; }
  }
  A.on('lesson:done', () => paintSideLesson());

  /* ---------------- search palette ---------------- */
  function paletteItems() {
    const items = [];
    if (LEARN) {
      NAV_L.forEach((p) => items.push({ g: 'Pages', t: p.t, ic: `<span class="gi">${icon(p.i)}</span>`, go: '#' + p.k, s: '' }));
      ((S.home && S.home.courses) || []).forEach((c) => items.push({ g: 'Courses', t: c.title, ic: `<span class="gi">${icon('book')}</span>`, go: '#course/' + c.slug, s: `${c.lessons} lessons` }));
      NAV_VSQ.filter((p) => !(A.NO_SALES && p.k === 'premium')).forEach((p) => items.push({ g: 'On VooSquare', t: p.t, ic: `<span class="gi">${icon(p.i)}</span>`, go: '#' + p.k, s: 'Switch, signed in' }));
      items.push({ g: 'Actions', t: 'Edit my face', ic: `<span class="gi">${icon('smile')}</span>`, go: '#profile', s: '' });
      return items;
    }
    const pages = [...NAV, ...NAV2].filter((p) => !(window.VSF && VSF.pageOff(p.k, S.features)) && !(A.NO_SALES && p.k === 'premium'));
    pages.forEach((p) => items.push({ g: 'Pages', t: p.t, ic: `<span class="gi">${icon(p.i)}</span>`, go: '#' + p.k, s: '' }));
    ((S.home && S.home.tools) || []).forEach((t) => items.push({ g: 'Tools', t: t.name, ic: VS.productIcon(t, 'sm'), tool: t.id, s: t.stage || '' }));
    ((S.home && S.home.calc_tools) || []).forEach((t) => items.push({ g: 'Free tools', t: t.name, ic: `<span class="gi">${icon(t.icon)}</span>`, go: '#tools/' + t.key, s: t.access === 'premium' ? 'Premium' : 'Free' }));
    (S.rooms || []).forEach((r) => items.push({ g: 'Rooms', t: r.name, ic: A.roomChip(r, 'sm'), go: '#community/' + r.id, s: r.unlocked ? (r.unread ? `${r.unread} new` : r.topic) : 'Locked' }));
    ((S.home && S.home.courses) || []).forEach((c) => items.push({ g: 'Courses', t: c.title, ic: `<span class="gi">${icon('book')}</span>`, go: '#course/' + c.slug, s: `${c.lessons} lessons` }));
    ((S.home && S.home.updates) || []).forEach((p) => items.push({ g: 'Blog', t: p.title, ic: `<span class="gi">${icon('pen')}</span>`, go: '#post/' + p.slug, s: p.category }));
    items.push({ g: 'Actions', t: 'Message support', ic: `<span class="gi">${icon('chat')}</span>`, act: 'ticket', s: '' });
    items.push({ g: 'Actions', t: 'Edit my face', ic: `<span class="gi">${icon('smile')}</span>`, go: '#profile', s: '' });
    return items;
  }
  function openPalette() {
    if ($('.pal')) return;
    if (!S.rooms) A.loadRooms().catch(() => {});
    const all = paletteItems();
    let sel = 0, list = all;
    const wrap = A.el(`<div class="overlay pal-ov" role="dialog" aria-modal="true" aria-label="Search"><div class="pal"><div class="pal-in">${icon('search')}<input id="palQ" placeholder="Search tools, rooms, courses, pages" autocomplete="off" spellcheck="false"><kbd>Esc</kbd></div><div class="pal-list" id="palL" role="listbox"></div></div></div>`);
    document.body.appendChild(wrap);
    const q = wrap.querySelector('#palQ'), L = wrap.querySelector('#palL');
    const paint = () => {
      const s = q.value.trim().toLowerCase();
      list = s ? all.filter((x) => (x.t + ' ' + x.g + ' ' + x.s).toLowerCase().includes(s)) : all.filter((x) => x.g !== 'Blog' && x.g !== 'Free tools');
      sel = Math.min(sel, Math.max(0, list.length - 1));
      let g = '';
      L.innerHTML = list.length ? list.map((x, i) => { const head = x.g !== g ? `<div class="pal-g">${esc(x.g)}</div>` : ''; g = x.g; return `${head}<button class="pal-i ${i === sel ? 'sel' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}">${x.ic}<span>${esc(x.t)}</span><small>${esc(x.s)}</small></button>`; }).join('') : `<div class="pal-none">No results for "${esc(q.value)}"</div>`;
      const se = L.querySelector('.sel'); if (se) se.scrollIntoView({ block: 'nearest' });
    };
    const close = () => { wrap.remove(); document.removeEventListener('keydown', key, true); };
    const pick = (x) => {
      close();
      if (!x) return;
      if (x.tool) { const b = document.createElement('button'); b.dataset.tool = x.tool; b.hidden = true; document.body.appendChild(b); b.click(); b.remove(); return; }
      if (x.act === 'ticket') { A.newTicket(); return; }
      location.hash = x.go;
    };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, list.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(list[sel]); }
    };
    document.addEventListener('keydown', key, true);
    q.addEventListener('input', () => { sel = 0; paint(); });
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(list[Number(b.dataset.i)]); else if (e.target === wrap) close(); });
    paint();
    setTimeout(() => q.focus(), 30);
  }

  /* ---------------- notifications ---------------- */
  // Room notifications show the room's picture; the rest keep a line icon.
  const niIcon = (n) => { const r = n.room_id && (S.rooms || []).find((x) => x.id === n.room_id); return r ? `<span class="ni-ic ni-room">${A.roomChip(r, 'sm')}</span>` : `<span class="ni-ic">${icon(n.ic || 'bell')}</span>`; };
  const seen = new Set(A.ls.get('vs_seen_notifs', []));
  function addNotif(n) {
    if (S.notifs.some((x) => x.id === n.id)) { const x = S.notifs.find((y) => y.id === n.id); Object.assign(x, n, { read: seen.has(n.id) && !n.fresh }); }
    else S.notifs.unshift({ ...n, read: seen.has(n.id) });
    S.notifs.sort((a, b) => b.at - a.at);
    paintBadges();
    const p = $('.notif'); if (p) paintNotifList(p);
  }
  function markAllRead() {
    S.notifs.forEach((n) => { n.read = true; seen.add(n.id); });
    A.ls.set('vs_seen_notifs', [...seen].slice(-200));
    paintBadges();
  }
  async function loadTicketNotifs() {
    try {
      const d = await VS.api('/api/support/tickets');
      S.tickets = d.tickets;
      S.openTickets = d.tickets.filter((t) => t.unread).length;
      d.tickets.filter((t) => t.unread).forEach((t) => addNotif({ id: `t${t.id}:${t.updated_at}`, ic: 'chat', title: 'New reply from support', body: t.subject, at: t.updated_at, href: '#support/' + t.id, fresh: true }));
      paintBadges();
    } catch { /* ignore */ }
  }
  function paintNotifList(p) {
    const L = p.querySelector('.notif-l');
    L.innerHTML = S.notifs.length ? S.notifs.slice(0, 30).map((n) => `<a class="nitem ${n.read ? '' : 'unread'}" href="${esc(n.href || '#home')}" data-go="${esc(n.href || '')}">${niIcon(n)}<div><p>${esc(n.title)}</p>${n.body ? `<small>${esc(n.body)}</small>` : ''}${n.at > 0 ? `<time>${esc(VS.timeAgo(n.at))}</time>` : '<time>News</time>'}</div>${n.read ? '' : '<span class="dotu"></span>'}</a>`).join('')
      : `<div class="empty">${icon('bell')}<b>You are all caught up</b><p>Support replies, payments and news show up here.</p></div>`;
  }
  function toggleNotifs() {
    const ex = $('.notif');
    if (ex) { ex.remove(); return; }
    const p = A.el(`<div class="notif" role="dialog" aria-label="Notifications"><div class="notif-h"><b>Notifications</b><button data-readall>Mark all read</button></div><div class="notif-l"></div></div>`);
    document.body.appendChild(p);
    paintNotifList(p);
    p.addEventListener('click', (e) => {
      if (e.target.closest('[data-readall]')) { markAllRead(); paintNotifList(p); return; }
      if (e.target.closest('.nitem')) { setTimeout(() => p.remove(), 50); markAllRead(); }
    });
    const off = (e) => { if (!p.contains(e.target) && !e.target.closest('#bell')) { p.remove(); document.removeEventListener('pointerdown', off); } };
    setTimeout(() => document.addEventListener('pointerdown', off), 0);
  }

  /* ---------------- live (user + community) ---------------- */
  function liveStream() {
    VS.stream(['community'], {
      activity: (d) => {
        if (d && d.room_id !== undefined) {
          // community activity: a new message in a room
          const r = (S.rooms || []).find((x) => x.id === d.room_id);
          const viewing = S.route.name === 'community' && Number(S.route.arg) === d.room_id;
          if (r && r.unlocked && !viewing) { r.unread = Math.min((r.unread || 0) + 1, 99); A.recountRooms(); A.emit('rooms'); }
          return;
        }
        // tool activity for this user
        if (S.home) S.home.activity = [d, ...(S.home.activity || [])].slice(0, 20);
        A.emit('activity', d);
      },
      presence: (d) => {
        // How many people have a room open right now (a count, never names).
        const r = (S.rooms || []).find((x) => x.id === d.room_id);
        if (r) r.online = d.online;
        A.emit('presence', d);
      },
      bye: () => {
        // The server closed this stream: the session ended (logged out elsewhere, expired or suspended). Check once.
        VS.api('/api/me').then((m) => { if (!m || !m.user) toLogin(); }).catch((e) => { if (e.status === 401) toLogin(); });
      },
      support: (d) => {
        VS.toast('New reply from support');
        loadTicketNotifs();
        A.emit('support', d);
      },
      order: (d) => {
        if (d.status === 'paid') {
          addNotif({ id: 'o' + d.ref, ic: 'premium', title: 'Payment confirmed', body: 'Order ' + d.ref, at: Date.now(), href: '#premium', fresh: true });
          VS.api('/api/me').then((m) => { if (m.user) { S.user = m.user; A.emit('user'); } }).catch(() => {});
          A.loadRooms().catch(() => {});
        }
        A.emit('order', d); A.emit('orders');
      },
      payout: (d) => {
        // The team moved a referral payout along (sending, paid, not sent). Requests and cancels by the member also land here.
        const msg = { processing: ['Your payout is being sent', 'send'], paid: ['Payout sent', 'wallet'], rejected: ['Payout not sent', 'wallet'] }[d.status];
        if (msg) { VS.toast(msg[0]); addNotif({ id: `po${d.id}:${d.status}`, ic: msg[1], title: msg[0], body: '$' + VS.fmt(d.amount_usd, 2), at: Date.now(), href: '#referrals', fresh: true }); }
        A.emit('payout', d);
      },
      rooms: () => { A.loadRooms().catch(() => {}); },
      application: (d) => {
        // The team decided on an invite-only room application (or a seat opened).
        const msg = { approved: ['You are approved', 'check'], rejected: ['Application update', 'chat'], granted: ['You have been added', 'star'] }[d.status];
        if (msg) { VS.toast(`${msg[0]}: ${d.room}`); addNotif({ id: `ap${d.id || d.room_id}:${d.status}`, room_id: d.room_id, ic: msg[1], title: msg[0], body: d.room, at: Date.now(), href: '#community/' + d.room_id, fresh: true }); }
        A.loadRooms().catch(() => {});
      },
      site: () => { A.refreshHome(); },
    });
  }

  /* ---------------- onboarding ---------------- */
  const RUNS = ['Trading', 'iGaming', 'Sports betting', 'Crypto', 'E-commerce', 'Lead gen', 'Agency', 'Other'];
  function onboarding() {
    return new Promise((resolve) => {
      const u = S.user;
      const st = { step: 0, face: { ...A.randomFace(), ...u.avatar }, name: u.name || '', handle: u.handle || '', country: u.country || '', runs: [] };
      const ob = A.el(`<div class="ob" role="dialog" aria-modal="true" aria-label="Welcome to ${LEARN ? 'VooSquare Academy' : 'VooSquare'}"><div class="gridbg"></div><span class="ob-glow"></span>
        <div class="ob-top">${VS.productIcon({ icon: 'voosquare' }, 'sm')}<b>Voo<span>Square</span>${LEARN ? ' Academy' : ''}</b><div class="ob-dots">${(LEARN ? [0, 1, 2] : [0, 1, 2, 3]).map((i) => `<i data-d="${i}"></i>`).join('')}</div><button type="button" class="ob-skip" data-skip>Skip for now</button></div>
        <div class="ob-body" id="obB"></div></div>`);
      document.body.appendChild(ob);
      document.body.classList.add('noscroll');
      const B = ob.querySelector('#obB');
      const dots = () => ob.querySelectorAll('.ob-dots i').forEach((d, i) => { d.className = i < st.step ? 'done' : i === st.step ? 'on' : ''; });
      const paint = () => {
        dots();
        const s = st.step;
        B.innerHTML = `<div class="ob-step" data-s="${s}">${[step0, step1, step2, step3][s]()}</div>`;
        if (s === 1) A.faceBuilder(B.querySelector('#obFb'), st.face, (a) => { st.face = a; }, { dark: true });
        if (s === 2) bind2();
        const f = B.querySelector('[autofocus]'); if (f && !A.isMobile()) f.focus();
        B.scrollTop = 0;
      };
      const step0 = () => LEARN ? `<div class="ob-hero"><div class="crew ob-crew" aria-hidden="true"><div class="seats">${A.crewHtml(1)}</div><div class="desk"></div></div>
        <span class="kick kick-d">Your Voo ID is ready</span><h1>Welcome to VooSquare <span class="serif">Academy</span>, ${esc(A.firstName(u.name))}.</h1>
        <p>The school for media buyers. Set up your student profile in under a minute, then enrol in Foundations.</p>
        <button class="btn btn-l ob-go" data-next>Let's go${icon('arrow')}</button></div>` : `<div class="ob-hero"><div class="crew ob-crew" aria-hidden="true"><div class="seats">${A.crewHtml(1)}</div><div class="desk"></div></div>
        <span class="kick kick-d">Your Voo ID is ready</span><h1>Welcome to the <span class="serif">square</span>, ${esc(A.firstName(u.name))}.</h1>
        <p>This is where media buyers learn, talk shop and open every Zedapex tool with one account. Let's set you up in under a minute.</p>
        <button class="btn btn-l ob-go" data-next>Let's go${icon('arrow')}</button></div>`;
      const step1 = () => `<div class="ob-head"><span class="kick kick-d">Step 1 of ${LEARN ? 2 : 3}</span><h2>Build your face</h2><p>${LEARN ? 'It goes on your student card and your certificates page. Change it any time from your profile.' : 'This is how other buyers see you in the community. Change it any time from your profile.'}</p></div><div id="obFb" class="ob-fb"></div><div class="ob-nav"><button class="btn btn-ghost-d" data-back>${icon('left')}Back</button><button class="btn btn-l" data-next>Looks good${icon('arrow')}</button></div>`;
      const step2 = () => `<div class="ob-head"><span class="kick kick-d">Step 2 of ${LEARN ? 2 : 3}</span><h2>About you</h2><p>${LEARN ? 'Your name goes on your student card and your certificates.' : 'Your name and handle show next to your messages.'}</p></div>
        <div class="ob-form"><div class="ob-me"><span class="av av-lg">${VS.avatar(st.face)}</span><div><b id="obPrevN">${esc(st.name || 'Your name')}</b><small id="obPrevH">@${esc(st.handle || 'handle')}</small></div></div>
          <div class="field"><label for="obName">Your name</label><input class="inp" id="obName" maxlength="60" value="${esc(st.name)}" autocomplete="name" autofocus></div>
          <div class="field"><label for="obHandle">Handle</label><div class="inp-pre"><span>@</span><input class="inp" id="obHandle" maxlength="20" value="${esc(st.handle)}" autocapitalize="off" autocomplete="off" spellcheck="false"></div><span class="hint" id="obHint">3 to 20 letters, numbers or underscores</span></div>
          <div class="field"><label for="obCountry">Country</label><select class="inp" id="obCountry">${A.countryOptions(st.country)}</select></div>
          <div class="field"><span class="lbl">What do you run? <em>Optional</em></span><div class="ob-chips">${RUNS.map((r) => `<button type="button" class="${st.runs.includes(r) ? 'on' : ''}" data-run="${esc(r)}">${esc(r)}</button>`).join('')}</div></div>
          <p class="err" id="obErr" hidden></p></div>
        <div class="ob-nav"><button class="btn btn-ghost-d" data-back>${icon('left')}Back</button><button class="btn btn-l" data-save2>Continue${icon('arrow')}</button></div>`;
      const step3 = () => `<div class="ob-head"><span class="kick kick-d">Step 3 of 3</span><h2>Where do you want to start?</h2><p>You can reach everything from the menu later.</p></div>
        <div class="ob-picks">
          <button class="ob-pick" data-first="community"><span class="obp-ic">${icon('chat')}</span><b>Community</b><small>Say hi in Introductions and meet other buyers.</small><span class="obp-go">${icon('arrow')}</span></button>
          <button class="ob-pick" data-first="academy"><span class="obp-ic lime">${icon('play')}</span><b>Academy</b><small>Watch lesson 1 of Traffic Banking 101. It takes 6 minutes.</small><span class="obp-go">${icon('arrow')}</span></button>
          <button class="ob-pick" data-first="apps"><span class="obp-ic">${icon('grid')}</span><b>Apps</b><small>Open Joinvoo, Vooads, Replyvoo and the rest with your Voo ID.</small><span class="obp-go">${icon('arrow')}</span></button>
        </div>
        <div class="ob-nav"><button class="btn btn-ghost-d" data-back>${icon('left')}Back</button><span></span></div>`;
      function bind2() {
        const n = B.querySelector('#obName'), h = B.querySelector('#obHandle');
        n.addEventListener('input', () => { st.name = n.value; B.querySelector('#obPrevN').textContent = n.value || 'Your name'; });
        h.addEventListener('input', () => {
          h.value = h.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
          st.handle = h.value;
          B.querySelector('#obPrevH').textContent = '@' + (h.value || 'handle');
          const ok = /^[a-z0-9_]{3,20}$/.test(h.value);
          const hint = B.querySelector('#obHint');
          hint.className = 'hint ' + (h.value && !ok ? 'err' : ok ? 'ok' : '');
          hint.textContent = ok ? 'Looks good' : '3 to 20 letters, numbers or underscores';
        });
        B.querySelector('#obCountry').addEventListener('change', (e) => { st.country = e.target.value; });
        B.querySelector('.ob-chips').addEventListener('click', (e) => {
          const b = e.target.closest('[data-run]'); if (!b) return;
          const r = b.dataset.run;
          st.runs = st.runs.includes(r) ? st.runs.filter((x) => x !== r) : [...st.runs, r];
          b.classList.toggle('on');
        });
      }
      const bioFromRuns = () => (st.runs.length && !(u.bio || '').trim() ? `I run ${st.runs.join(', ').replace(/, ([^,]*)$/, ' and $1')} campaigns.` : undefined);
      /* Skip (button or Esc): keep the face shown so far and go straight to where they were heading (for example the
       * room a "Join the chat" link opened). Name, handle and face can be changed later in Profile. */
      let leaving = false;
      const close = (target) => { leaving = true; document.removeEventListener('keydown', onKey); ob.classList.add('out'); setTimeout(() => { ob.remove(); document.body.classList.remove('noscroll'); }, 450); resolve(target); };
      const skip = async (btn) => {
        if (leaving) return;
        await A.busy(btn, async () => {
          try { await A.saveMe({ avatar: st.face, onboarded: true }); } catch { /* still let them in; they see onboarding again next time */ }
          close(location.hash && location.hash.length > 1 ? location.hash : '#home');
        });
      };
      const onKey = (e) => { if (e.key === 'Escape' && !leaving) skip(ob.querySelector('[data-skip]')); };
      document.addEventListener('keydown', onKey);
      ob.addEventListener('click', async (e) => {
        const t = e.target;
        const sk = t.closest('[data-skip]');
        if (sk) { skip(sk); return; }
        if (t.closest('[data-next]')) { st.step++; paint(); return; }
        if (t.closest('[data-back]')) { st.step = Math.max(0, st.step - 1); paint(); return; }
        const s2 = t.closest('[data-save2]');
        if (s2) {
          const err = B.querySelector('#obErr');
          err.hidden = true;
          if (st.name.trim().length < 2) { err.textContent = 'Your name needs at least 2 characters.'; err.hidden = false; B.querySelector('#obName').focus(); return; }
          if (!/^[a-z0-9_]{3,20}$/.test(st.handle)) { err.textContent = 'Handles use 3 to 20 letters, numbers or underscores.'; err.hidden = false; B.querySelector('#obHandle').focus(); return; }
          await A.busy(s2, async () => {
            try {
              const patch = { name: st.name.trim(), handle: st.handle, country: st.country, avatar: st.face };
              const bio = bioFromRuns(); if (bio) patch.bio = bio;
              if (LEARN) {
                // The Academy has no "where to start" step: the school is the start.
                await A.saveMe({ ...patch, onboarded: true });
                VS.confetti();
                close('#academy');
                return;
              }
              await A.saveMe(patch);
              st.step = 3; paint();
            } catch (er) { err.textContent = er.message; err.hidden = false; }
          });
          return;
        }
        const f = t.closest('[data-first]');
        if (f) {
          await A.busy(f, async () => {
            try {
              await A.saveMe({ name: st.name.trim(), handle: st.handle, country: st.country, avatar: st.face, onboarded: true });
              VS.confetti();
              const dest = f.dataset.first;
              let target = '#' + dest;
              if (dest === 'community') { try { const d = S.rooms ? { rooms: S.rooms } : await A.loadRooms(); const intro = d.rooms.find((r) => r.slug === 'introductions'); if (intro) target = '#community/' + intro.id; } catch { /* list */ } }
              close(target);
            } catch (er) { A.errToast(er); }
          });
        }
      });
      paint();
    });
  }

  /* ---------------- viewport (keyboard on phones) ---------------- */
  function trackViewport() {
    const vv = window.visualViewport;
    const set = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--vvh', h + 'px');
      document.documentElement.style.setProperty('--vvt', (vv ? vv.offsetTop : 0) + 'px');
    };
    set();
    if (vv) { vv.addEventListener('resize', set); vv.addEventListener('scroll', set); }
    window.addEventListener('resize', set);
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    trackViewport();
    let me;
    try { me = await VS.api('/api/me'); } catch (e) {
      $('#splash').innerHTML = `<div class="splash-in">${VS.productIcon({ icon: 'voosquare' }, 'xl')}<b class="splash-word">We could not reach VooSquare</b><small class="splash-sub">${esc(e.message)}</small><button class="btn btn-l" data-reload>Try again</button></div>`;
      const rb = $('#splash [data-reload]'); if (rb) rb.addEventListener('click', () => location.reload());
      return;
    }
    if (!me || !me.user) return toLogin();
    S.user = me.user;
    S.features = me.features || {};
    if (window.VSF && S.features.maintenance && !S.user.staff) return VSF.showBackSoon(S.features.maintenance_message);
    if (window.VSF) VSF.bodyClasses(S.features);
    const homeP = A.refreshHome();
    if (!LEARN) A.loadRooms().catch(() => {});
    shell();
    if (window.VSF) VSF.bodyClasses(S.features); // again, so the new menu links pick up the affiliate URL
    window.addEventListener('hashchange', route);
    window.addEventListener('online', () => { $('#offline').hidden = true; A.refreshHome(); });
    window.addEventListener('offline', () => { $('#offline').hidden = false; });
    if (!navigator.onLine) $('#offline').hidden = false;

    await Promise.race([homeP, new Promise((r) => setTimeout(r, 2500))]);
    const sp = $('#splash');
    sp.classList.add('out');
    setTimeout(() => sp.remove(), 500);

    if (!S.user.onboarded) {
      const target = await onboarding();
      if (location.hash === target) route(); else location.hash = target;
    } else route();

    // notifications: announcements + support replies
    homeP.then(() => {
      ((S.home && S.home.announcements) || []).forEach((a, i) => addNotif({ id: 'a:' + (a.id || i) + ':' + a.text.length, ic: 'megaphone', title: a.text, body: a.link_text || '', at: -i, href: A.safeHref(a.url) }));
    });
    loadTicketNotifs();
    liveStream();
    // Back from "Join our community" (signed up on VooSquare, then switched back here).
    if (LEARN && /[?&]welcome=community\b/.test(location.search)) {
      history.replaceState(history.state, '', location.pathname + location.hash);
      setTimeout(() => VS.toast('You are in the VooSquare community too. Same Voo ID.'), 600);
    }
  }

  boot();
})();
