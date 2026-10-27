/* VooSquare feature switches on the member side (website and app). The admin turns areas on and off in
 * Admin → Settings → Features; /api/site, /api/me and /api/me/home carry the switches as `features`.
 * This file hides what is off, shows the "back soon" page in maintenance mode and the What's new card on Home. */
(function () {
  'use strict';
  const VS = window.VS;
  const { esc, icon } = VS;

  /* App page → the area it belongs to. */
  const PAGE_AREA = { community: 'community', academy: 'academy', course: 'academy', tips: 'academy', school: 'academy', module: 'academy', cert: 'academy', blog: 'blog', post: 'blog', tools: 'tools', referrals: 'referrals', support: 'support', premium: 'premium' };
  const AREA_NAME = { community: 'The community', academy: 'The Academy', blog: 'The blog', tools: 'Free tools', referrals: 'Referrals', support: 'Support', premium: 'Premium' };
  const AREAS = ['community', 'academy', 'blog', 'tools', 'referrals', 'support', 'premium', 'paid_rooms', 'spotlight', 'announcements', 'images', 'affiliates'];

  const isOff = (f, k) => !!f && f[k] === false;
  const pageOff = (name, f) => { const k = PAGE_AREA[name]; return k && isOff(f, k) ? k : ''; };

  /** body.f-off-<area> classes let CSS hide links to areas that are off, wherever they are. */
  function bodyClasses(f) {
    AREAS.forEach((k) => document.body.classList.toggle('f-off-' + k, isOff(f, k)));
    // "Affiliates" links: point at the affiliate host when one is configured.
    if (f && f.affiliate_url) document.querySelectorAll('a[data-aff-link]').forEach((a) => { a.href = f.affiliate_url; });
    document.body.classList.toggle('f-signups-paused', !!(f && f.signups_paused));
  }

  function offCard(k) {
    return `<div class="f-offpage"><span class="f-off-ic">${icon('lock')}</span><h2>${esc(AREA_NAME[k] || 'This part of VooSquare')} is turned off for now</h2><p>The team switched it off for a while. Nothing you saved is lost, and it comes back exactly as you left it.</p><a class="btn btn-g" href="#home">${icon('home')}Back to Home</a></div>`;
  }

  /** Full "back soon" page. Staff never see it (they get a thin bar instead). */
  function backSoon(message) {
    return `<main class="f-soon" role="main" aria-labelledby="fsT"><div class="gridbg"></div><span class="f-glow" aria-hidden="true"></span>
      <div class="f-soon-in">
        <span class="f-tiles" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="f-brand">Voo<b>Square</b></span>
        <h1 id="fsT">Back <span class="serif">soon.</span></h1>
        <p>${esc(message || 'VooSquare is getting an upgrade. We will be back shortly.')}</p>
        <div class="f-soon-a"><button type="button" class="btn btn-l" data-f-retry>${icon('refresh')}Check again</button><a class="btn btn-ghost-d" href="/" data-f-home>VooSquare home</a></div>
        ${/safe/i.test(message || '') ? '' : '<small>Your account, rooms and progress are safe.</small>'}
      </div></main>`;
  }
  function showBackSoon(message) {
    const sp = document.getElementById('splash'); if (sp) sp.remove();
    document.body.classList.add('f-soon-body');
    const root = document.getElementById('root') || document.body;
    root.innerHTML = backSoon(message);
    const b = root.querySelector('[data-f-retry]');
    if (b) b.addEventListener('click', () => location.reload());
    const h = root.querySelector('[data-f-home]'); if (h && location.pathname === '/') h.remove();
  }
  function staffBar(f) {
    if (!f || !f.maintenance || document.querySelector('.f-staffbar')) return;
    const b = document.createElement('div');
    b.className = 'f-staffbar'; b.setAttribute('role', 'status');
    b.innerHTML = `${icon('lock')}<span>Maintenance mode is on. Members see the "back soon" page. You see VooSquare because you are on the team.</span><a href="/admin#settings/features">Turn off</a>`;
    document.body.prepend(b);
  }

  /* ---------------- What's new card on member Home ---------------- */
  const seen = new Set();
  function whatsNew(note) {
    if (!note || seen.has(note.id)) return '';
    let href = note.link_url || '';
    if (/^\/app#/.test(href) && location.pathname.startsWith('/app')) href = href.slice(4);
    const ext = /^https?:\/\//i.test(href);
    return `<div class="c12 f-wn" data-wn="${note.id}" role="region" aria-label="What's new"><div class="f-wn-in">
      <span class="f-wn-k">${icon('spark')}What's new</span>
      <div class="f-wn-t"><b>${esc(note.title)}</b>${note.body ? `<p>${esc(note.body)}</p>` : ''}</div>
      <div class="f-wn-a">${href ? `<a class="btn btn-l btn-sm" href="${esc(href)}"${ext ? ' target="_blank" rel="noopener"' : ''} data-wn-go>${esc(note.link_text || 'Take a look')}${icon('arrow')}</a>` : ''}<button type="button" class="btn btn-ghost-d btn-sm" data-wn-x>Got it</button></div>
    </div></div>`;
  }
  /** Put the card at the top of Home (inside .bento) and dismiss it for good on "Got it" or the link. */
  function homeExtras(view, home, f) {
    if (!view) return;
    const bento = view.querySelector('.bento');
    const note = home && home.whats_new;
    if (bento && note && !view.querySelector('.f-wn')) {
      const hero = bento.querySelector('.hero2');
      (hero || bento.firstElementChild || bento).insertAdjacentHTML(hero ? 'afterend' : 'afterbegin', whatsNew(note));
      const card = bento.querySelector('.f-wn');
      if (card) {
        const done = (animate) => {
          seen.add(note.id);
          VS.api(`/api/me/whats-new/${note.id}/seen`, { method: 'POST', body: {} }).catch(() => {});
          if (home) home.whats_new = null;
          if (animate && !VS.reduce) { card.classList.add('out'); setTimeout(() => card.remove(), 320); } else card.remove();
        };
        card.addEventListener('click', (e) => { if (e.target.closest('[data-wn-x]')) done(true); else if (e.target.closest('[data-wn-go]')) done(false); });
      }
    }
    // Home cards that point at an area that is off.
    if (f) ['academy', 'community', 'blog'].forEach((k) => { if (isOff(f, k)) view.querySelectorAll(`.bento > .card .card-h a[href="#${k}"]`).forEach((a) => { const c = a.closest('.card'); if (c) c.remove(); }); });
  }

  /* ---------------- website ---------------- */
  const SITE_SECTIONS = { community: 'community', academy: 'academy', blog: 'blog', tools: 'free-tools', premium: 'pricing' };
  function applySite(f, user) {
    if (!f) return;
    bodyClasses(f);
    Object.entries(SITE_SECTIONS).forEach(([k, id]) => {
      const off = isOff(f, k);
      const sec = document.getElementById(id); if (sec) sec.hidden = off;
      document.querySelectorAll(`a[href="#${id}"]`).forEach((a) => { if (a.closest('.links, .drawer, footer, .ft, #ftAcct')) a.hidden = off; });
    });
    if (f.maintenance) {
      if (user && user.staff) staffBar(f);
      else if (!document.documentElement.classList.contains('html-login')) {
        document.body.classList.add('f-soon-body');
        const site = document.querySelector('.site');
        if (site) site.hidden = true;
        const holder = document.createElement('div');
        holder.id = 'fSoon';
        document.body.appendChild(holder);
        holder.innerHTML = backSoon(f.maintenance_message);
        holder.querySelector('[data-f-retry]').addEventListener('click', () => location.reload());
        const h = holder.querySelector('[data-f-home]');
        if (h) { h.textContent = 'Team log in'; h.setAttribute('href', '/login'); }
      }
    }
  }

  window.VSF = { isOff, pageOff, bodyClasses, offCard, backSoon, showBackSoon, staffBar, whatsNew, homeExtras, applySite };
})();
