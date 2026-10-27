/* VooSquare member app: Home and Apps. */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { esc, icon, fmt } = VS;
  const S = A.S;

  const STAGES = ['Research', 'Monetize', 'Acquire', 'Track', 'Convert', 'Retain', 'Collect'];
  const TIPS = [
    'Connect Joinvoo to see real joins here',
    'Your Voo ID opens every tool',
    'New here? Start Traffic Banking 101',
    'Say hi in Introductions',
    'Replyvoo answers chats in seconds',
    'Ask the community about your geo',
  ];

  /* seat for an event: Track tools sit left, Convert tools right, the rest in the middle */
  const seatFor = (e) => {
    const s = String(e.slug || e.product || '').toLowerCase();
    if (/join|track/.test(s)) return 0;
    if (/reply|cast|convert/.test(s)) return 2;
    return 1;
  };
  const evColor = (e) => {
    const t = (S.home && S.home.tools || []).find((x) => x.slug === e.slug || x.name === e.product);
    return (t && t.color) || '#12C784';
  };

  /* ---------------- today numbers ---------------- */
  function todayStats() {
    const rows = (S.home && S.home.today) || [];
    const by = {};
    let money = 0;
    for (const r of rows) {
      by[r.type] = (by[r.type] || 0) + (r.n || 0);
      if (r.type !== 'spend') money += Number(r.v) || 0;
    }
    const picks = [];
    const want = [['join', 'signup', 'lead'], ['ftd', 'deposit'], ['chat_closed', 'sale']];
    for (const group of want) {
      const t = group.find((k) => by[k] > 0);
      if (t) picks.push({ type: t, n: by[t] });
    }
    // Fill with any other event types the tools sent, so new tools still show up.
    for (const [t, n] of Object.entries(by)) if (picks.length < 3 && n > 0 && t !== 'spend' && !picks.find((p) => p.type === t)) picks.push({ type: t, n });
    return { picks, money: Math.round(money * 100) / 100 };
  }

  /* ---------------- HOME ---------------- */
  function renderHome(view) {
    const u = S.user;
    const h = S.home;
    const cleanups = [];
    if (!h) {
      view.innerHTML = `<div class="bento"><div class="c12">${A.skel(320, '100%', 30)}</div><div class="c12">${A.skel(180, '100%', 24)}</div><div class="c6">${A.skel(240, '100%', 24)}</div><div class="c6">${A.skel(240, '100%', 24)}</div></div>`;
      const off = A.on('home:loaded', () => { off(); renderHome(view); });
      return off;
    }
    const st = todayStats();
    const hasTools = (h.activity || []).length > 0;
    const course = continueCourse();
    const ann = (h.announcements || [])[0];
    view.innerHTML = `
      ${ann ? `<a class="annbar" href="${esc(A.safeHref(ann.url) || '#')}" data-go="${esc(A.safeHref(ann.url))}"><span class="live-dot"></span><span class="annbar-t">${esc(ann.text)}</span>${ann.link_text ? `<b>${esc(ann.link_text)}${icon('arrow')}</b>` : ''}</a>` : ''}
      <div class="bento">
        <div class="card hero2 c12">
          <div class="gridbg"></div>
          <div class="h2l">
            <p class="h2-date"><i></i><span>${esc(new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}</span></p>
            <h2>${esc(A.greeting())},<br><span class="uname1">${esc(A.firstName(u.name))}</span>.</h2>
            <p class="h2-sub">${st.picks.length ? 'Your tools are live. Here is what they sent in the last 24 hours.' : hasTools ? 'Your tools are connected. Nothing new in the last 24 hours yet.' : 'This is your square. Open a tool, learn in the Academy and talk shop with other buyers.'}</p>
            ${st.picks.length ? `<div class="h2-stats">${st.picks.map((p) => `<div><b data-count="${p.n}">0</b><small>${esc(A.evName(p.type, p.n))}</small></div>`).join('')}</div>`
              : `<div class="h2-cta"><span class="pi-stack">${(h.tools || []).filter((t) => A.toolState(t) === 'open').slice(0, 3).map((t) => VS.productIcon(t, 'sm')).join('')}</span><div><b>Connect your first tool</b><small>Sign in to Joinvoo or Replyvoo with your Voo ID and your results land here.</small></div></div>`}
            <div class="acts">
              <a class="btn btn-l btn-sm" href="#apps">${icon('grid')}${st.picks.length || hasTools ? 'Open a tool' : 'Connect a tool'}</a>
              ${course ? `<button class="btn btn-w btn-sm" data-resume>${icon('play')}${course.done ? 'Continue lesson' : 'Start learning'}</button>` : ''}
            </div>
          </div>
          <div class="crew" id="crew" aria-hidden="true">
            <div class="crew-top"><span class="crew-chip"><i></i>${st.picks.length ? 'Team live' : 'Your team'}</span><span class="crew-chip money" id="moneyChip" ${st.money > 0 ? '' : 'hidden'}>Today <b id="moneyV">$0</b></span></div>
            <div class="seats" id="seats">${A.crewHtml()}</div>
            <div class="desk"></div>
          </div>
        </div>

        <div class="card c12">
          <div class="card-h"><div><h3>Your tools</h3><span class="sub">Tap a tool to open it with your Voo ID</span></div><div class="r"><a class="btn btn-w btn-sm" href="#apps">All apps</a></div></div>
          <div class="launcher">${launcherTiles(h.tools || [])}</div>
        </div>

        ${toolsStrip(h.calc_tools)}

        ${((sp) => (sp ? `<div class="c12 spot-row">${sp}</div>` : ''))(A.spotlight(h.ads))}

        <div class="card c6">
          <div class="card-h"><div><h3>Continue learning</h3><span class="sub">Short animated lessons</span></div><span class="r"><a class="btn btn-w btn-sm" href="#tips">Tips</a></span></div>
          ${learnCard(course)}
        </div>
        <div class="card c6">
          <div class="card-h"><div><h3>Community</h3><span class="sub">Rooms you can join right now</span></div><span class="r"><a class="btn btn-w btn-sm" href="#community">Open</a></span></div>
          ${(h.rooms || []).length ? `<div class="hrooms">${h.rooms.map((r) => `<a class="hroom" href="#community/${r.id}">${A.roomChip(r)}<span class="hr-t"><b>${esc(r.name)}</b><small>${esc(r.description || r.topic)}</small></span>${r.unread ? `<span class="ub">${r.unread}</span>` : `<span class="hr-go">${icon('arrow')}</span>`}</a>`).join('')}</div>`
            : A.empty('chat', 'No rooms yet', 'Rooms appear here when the team opens them.')}
        </div>

        <div class="card c6">
          <div class="card-h"><div><h3>What's new</h3><span class="sub">From the Voo Blog</span></div><span class="r"><a class="btn btn-w btn-sm" href="#blog">Blog</a></span></div>
          ${(h.updates || []).length ? `<div class="ups">${h.updates.map((p) => `<a class="up" href="#post/${esc(p.slug)}"><span class="up-cv" style="background:${esc(p.grad || 'linear-gradient(135deg,#0F2E20,#1E6B47)')}">${esc(p.mark || p.title[0])}</span><span class="uc"><h4>${esc(p.title)}</h4><p>${esc(p.category)} · ${p.minutes} min read</p></span><time>${VS.timeAgo(p.created_at)}</time></a>`).join('')}</div>`
            : A.empty('pen', 'No posts yet', 'New posts from Dchessking and the team show up here.')}
        </div>
        <div class="card c6">
          <div class="card-h"><div><h3>Live activity</h3><span class="sub">Real events from your tools</span></div><span class="r"><span class="pill pill-g"><span class="live-dot" style="width:7px;height:7px"></span>Live</span></span></div>
          <div class="afeed" id="homeFeed">${feedHtml(h.activity || [])}</div>
        </div>
      </div>`;
    // What's new card (once per note) and cards for areas the team switched off. See /js/features.js.
    if (window.VSF) VSF.homeExtras(view, h, S.features);

    // count-ups
    view.querySelectorAll('.h2-stats [data-count]').forEach((b) => VS.countUp(b, Number(b.dataset.count)));
    let money = 0;
    const moneyV = view.querySelector('#moneyV');
    if (st.money > 0) { money = st.money; VS.countUp(moneyV, st.money, { pre: '$', dec: st.money % 1 ? 2 : 0, ms: 1600 }); }
    // ring
    const arc = view.querySelector('.ring-arc');
    if (arc) requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = arc.dataset.to; }));

    if (window.VTA) VTA.watch(view);
    /* crew loop: real events first, tips when there are none */
    const crew = view.querySelector('#crew');
    const seats = view.querySelector('#seats');
    A.sparks(crew);
    const queue = (h.activity || []).slice(0, 12).map((e) => ({ text: A.evText(e), seat: seatFor(e), col: evColor(e) }));
    let qi = 0, ti = Math.floor(Math.random() * TIPS.length), tick = 0;
    const bubble = (seatIdx, text, col) => {
      const seat = seats.children[seatIdx];
      if (!seat) return;
      seat.querySelectorAll('.bub').forEach((b) => b.remove());
      const b = A.el(`<div class="bub"><i style="background:${esc(col)}"></i><span>${esc(text)}</span></div>`);
      seat.appendChild(b);
      setTimeout(() => b.remove(), 2600);
    };
    const coin = (seatIdx, onLand) => {
      const chip = view.querySelector('#moneyChip');
      const seat = seats.children[seatIdx];
      if (!chip || chip.hidden || !seat || VS.reduce) { if (onLand) onLand(); return; }
      const cr = crew.getBoundingClientRect(), sr = seat.getBoundingClientRect(), mc = chip.getBoundingClientRect();
      const c = A.el('<span class="coinf">$</span>');
      const x0 = sr.left - cr.left + sr.width / 2 - 13, y0 = sr.top - cr.top + sr.height * 0.35;
      c.style.left = x0 + 'px'; c.style.top = y0 + 'px';
      crew.appendChild(c);
      requestAnimationFrame(() => requestAnimationFrame(() => { c.style.transform = `translate(${mc.left - cr.left + mc.width - 30 - x0}px,${mc.top - cr.top - y0}px) scale(.6)`; c.style.opacity = '.2'; }));
      setTimeout(() => { c.remove(); if (onLand) onLand(); chip.classList.add('hit'); setTimeout(() => chip.classList.remove('hit'), 250); }, 1000);
    };
    const step = () => {
      if (document.hidden) return;
      tick++;
      if (queue.length) {
        const e = queue[qi++ % queue.length];
        bubble(e.seat, e.text, e.col);
      } else {
        bubble(tick % 3, TIPS[ti++ % TIPS.length], '#C9F65B');
      }
    };
    if (!VS.reduce) {
      setTimeout(step, 700);
      const iv = setInterval(step, queue.length ? 2200 : 3200);
      cleanups.push(() => clearInterval(iv));
      // on load, a few coins land in the counter for today's real value
      if (st.money > 0) [300, 900, 1500].forEach((t, i) => setTimeout(() => coin(i % 3), t));
    } else if (queue.length || TIPS.length) {
      bubble(1, queue.length ? queue[0].text : TIPS[0], '#C9F65B');
    }

    /* live activity from the user stream */
    cleanups.push(A.on('activity', (e) => {
      const seat = seatFor(e);
      bubble(seat, A.evText(e), evColor(e));
      queue.unshift({ text: A.evText(e), seat, col: evColor(e) });
      if (queue.length > 12) queue.pop();
      const feed = view.querySelector('#homeFeed');
      if (feed) {
        if (feed.querySelector('.empty')) feed.innerHTML = '';
        feed.insertAdjacentHTML('afterbegin', feedItem(e, true));
      }
      const v = Number(e.value_usd) || 0;
      if (v > 0 && e.type !== 'spend') {
        const chip = view.querySelector('#moneyChip');
        if (chip) chip.hidden = false;
        coin(seat, () => { money += v; moneyV.textContent = '$' + fmt(money, money % 1 ? 2 : 0); });
      }
    }));

    view.addEventListener('click', (e) => {
      const r = e.target.closest('[data-resume]');
      if (r) { e.preventDefault(); A.resumeLearning(); return; }
      const pl = e.target.closest('[data-play]');
      if (pl) { e.preventDefault(); A.playLesson(pl.dataset.course, Number(pl.dataset.play)); }
    });
    return () => cleanups.forEach((f) => f());
  }

  function feedItem(e, fresh) {
    const t = (S.home && S.home.tools || []).find((x) => x.slug === e.slug || x.name === e.product) || { icon: e.icon, name: e.product };
    const v = Number(e.value_usd) || 0;
    return `<div class="fi ${fresh ? 'new' : ''}">${VS.productIcon(t, 'xs')}<span class="fi-text"><b>${esc(e.product || 'Tool')}</b> ${esc(e.label || A.evName(e.type, 1))}</span>${v > 0 ? `<span class="tag">$${fmt(v, v % 1 ? 2 : 0)}</span>` : ''}<time>${VS.timeAgo(e.created_at || Date.now())}</time></div>`;
  }
  function feedHtml(list) {
    if (!list.length) return A.empty('spark', 'No activity yet', 'When a connected tool records a join, a deposit or a closed chat, it shows up here as it happens.', '<a class="btn btn-w btn-sm" href="#apps">Connect a tool</a>');
    return list.map((e) => feedItem(e)).join('');
  }

  function launcherTiles(tools) {
    return tools.map((t) => {
      const s = A.toolState(t);
      const sub = s === 'waitlist' ? 'Waitlist' : s === 'soon' ? 'Coming soon' : t.external ? 'By Zedapex' : (t.stage || 'Open');
      return `<button class="lt ${s !== 'open' ? 'soon' : ''}" data-tool="${t.id}" aria-label="${esc(t.name)}: ${esc(sub)}"><span class="dot ${s}"></span>${VS.productIcon(t, 'xl')}<b>${esc(t.name)}</b><small>${esc(sub)}${s === 'open' || s === 'waitlist' ? icon('ext') : ''}</small></button>`;
    }).join('') + '<a class="lt soon next" href="#apps"><span class="pi pi-xl pi-next">' + icon('plus') + '</span><b>Next tool</b><small>On the way</small></a>';
  }

  /* ---------------- learning helpers ---------------- */
  function continueCourse() {
    const cs = (S.home && S.home.courses) || [];
    return cs.find((c) => !c.locked && c.done > 0 && c.done < c.lessons) || cs.find((c) => !c.locked && c.done < c.lessons) || cs.find((c) => !c.locked) || null;
  }
  function learnCard(c) {
    if (!c) return A.empty('book', 'No courses yet', 'Courses appear here as soon as the team publishes them.');
    const pct = c.lessons ? Math.round(c.done / c.lessons * 100) : 0;
    const C = 314;
    return `<div class="learn">
      <div class="ringp"><svg viewBox="0 0 120 120"><defs><linearGradient id="rgHome"><stop offset="0" stop-color="#12C784"/><stop offset="1" stop-color="#00774B"/></linearGradient></defs><circle cx="60" cy="60" r="50" fill="none" stroke="#EEF3F0" stroke-width="12"/><circle class="ring-arc" cx="60" cy="60" r="50" fill="none" stroke="url(#rgHome)" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}" data-to="${C - C * pct / 100}"/></svg><b>${pct}%</b></div>
      <div><span class="mono-k">${esc(c.track)} · ${esc(c.level)}</span><h4>${esc(c.title)}</h4><div class="by"><span class="av">${VS.authorAvatar(c.author_key, c.id)}</span>${esc(c.author_name)}</div>
      <p class="learn-m">${A.plural(c.done, 'lesson')} of ${c.lessons} done · ${c.minutes} min total</p>
      <button class="btn btn-g btn-sm" data-resume>${icon('play')}${c.done ? 'Continue' : 'Start course'}</button></div>
    </div>`;
  }
  /** Opens the next lesson of the course the member is working on. */
  A.resumeLearning = async function () {
    const c = continueCourse();
    if (!c) { location.hash = '#tips'; return; }
    try {
      const d = await VS.api('/api/courses/' + encodeURIComponent(c.slug));
      const next = d.lessons.find((l) => !l.done && !l.locked) || d.lessons.find((l) => !l.locked);
      if (!next) { location.hash = '#course/' + c.slug; return; }
      A.openPlayer(d, next.id);
    } catch (e) { A.errToast(e); }
  };
  A.continueCourse = continueCourse;

  /* ---------------- APPS ---------------- */
  function renderApps(view) {
    const h = S.home;
    if (!h) { view.innerHTML = A.skelCards(6, 220); const off = A.on('home:loaded', () => { off(); renderApps(view); }); return off; }
    const tools = h.tools || [];
    const stages = [...STAGES.filter((s) => tools.some((t) => t.stage === s)), ...[...new Set(tools.map((t) => t.stage || 'More'))].filter((s) => !STAGES.includes(s))];
    view.innerHTML = `
      <div class="apps-hero card">
        <div><span class="kick">One Voo ID</span><h2>Every tool in your square.</h2><p>Open any tool with the account you already have. Each tool runs its own billing and free plan.</p></div>
        <div class="apps-orbit" aria-hidden="true"><span class="core">${VS.productIcon({ icon: 'voosquare' }, 'lg')}</span><div class="orb">${tools.slice(0, 6).map((t, i) => `<span style="--i:${i};--n:${Math.min(tools.length, 6)}">${VS.productIcon(t, 'sm')}</span>`).join('')}</div></div>
      </div>
      ${stages.length > 1 ? `<div class="chips stage-chips" role="tablist"><button class="on" data-st="">All</button>${stages.map((s) => `<button data-st="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
      ${tools.length ? stages.map((s, si) => `<section class="stage-g" data-stage="${esc(s)}"><div class="stage-h"><span class="sn">Stage ${si + 1}</span><h3>${esc(s)}</h3></div><div class="apps">${tools.filter((t) => (t.stage || 'More') === s).map(appCard).join('')}</div></section>`).join('')
        : `<div class="card">${A.empty('grid', 'No tools yet', 'Tools show up here when the team adds them.')}</div>`}`;
    view.addEventListener('click', (e) => {
      const b = e.target.closest('[data-st]');
      if (!b) return;
      view.querySelectorAll('[data-st]').forEach((x) => x.classList.toggle('on', x === b));
      view.querySelectorAll('.stage-g').forEach((g) => { g.hidden = !!b.dataset.st && g.dataset.stage !== b.dataset.st; });
    });
  }
  function metricRows(sum) {
    if (!sum || !Array.isArray(sum.metrics) || !sum.metrics.length) return '';
    return `<div class="at-m">${sum.metrics.slice(0, 3).map((m) => { const l = Array.isArray(m) ? m[0] : (m.label || m.name); const v = Array.isArray(m) ? m[1] : (m.value ?? m.v); return `<div><b>${esc(typeof v === 'number' ? fmt(v, v % 1 ? 2 : 0) : v)}</b><small>${esc(l)}</small></div>`; }).join('')}<span class="at-mp">Last 24 hours</span></div>`;
  }
  function appCard(t) {
    const s = A.toolState(t);
    const btn = s === 'open' ? `<button class="btn btn-k btn-sm" data-tool="${t.id}"><span class="bl">Launch ${esc(t.name)}</span>${icon('ext')}</button>`
      : s === 'waitlist' ? `<button class="btn btn-w btn-sm" data-tool="${t.id}">Join the waitlist${icon('ext')}</button>`
        : '<button class="btn btn-w btn-sm" disabled>Coming soon</button>';
    return `<article class="at ${s === 'soon' ? 'soon' : ''}" style="--tint:${esc(t.tint || '#E7F8F0')}">
      <span class="tint"></span>
      <div class="row">${VS.productIcon(t, 'lg')}<div class="at-n"><h4>${esc(t.name)}</h4><span class="stage-l">${esc(t.stage || 'Tool')}</span></div>${A.statusPill(t.status)}</div>
      <p>${esc(t.tagline || t.description || '')}</p>
      ${t.summary ? metricRows(t.summary) : ''}
      <div class="go">${btn}${t.offer ? `<span class="fr">${esc(t.offer)}</span>` : ''}</div>
    </article>`;
  }

  /** Global tool click handler (launcher tiles, app cards, sidebar). */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tool]');
    if (!b || !S.home) return;
    e.preventDefault();
    const t = (S.home.tools || []).find((x) => String(x.id) === b.dataset.tool);
    if (!t) return;
    const s = A.toolState(t);
    if (s === 'soon') {
      const m = A.modal(`${A.modalHead(esc(t.name), esc(t.stage || ''))}<div class="vs-modal-b soon-m"><div class="soon-ic">${VS.productIcon(t, 'xl')}</div><p>${esc(t.tagline || '')}</p><p class="muted">${esc(t.name)} is on the way. Your Voo ID will open it the day it goes live, and we will email you.</p><button class="btn btn-k" data-close>Got it</button></div>`, { cls: 'am-sm' });
      return m;
    }
    window.open(A.toolOpenUrl(t), '_blank', 'noopener');
  });

  /* ---------------- FREE TOOLS (lazy) ----------------
   * The tools page code and styles load only when the page opens, so Home and the rest stay light. */
  let toolsP = null;
  A.loadTools = function () {
    if (window.VST && window.VSTM) return Promise.resolve();
    if (toolsP) return toolsP;
    const add = (tag, attrs) => new Promise((res, rej) => { const n = document.createElement(tag); Object.assign(n, attrs); n.onload = res; n.onerror = () => rej(new Error('The tools did not load. Check your connection and try again.')); document.head.appendChild(n); });
    toolsP = Promise.all([
      add('link', { rel: 'stylesheet', href: '/css/tools.css' }),
      add('script', { src: '/js/tools-math.js', async: false }),
      add('script', { src: '/js/tools.js', async: false }),
    ]).catch((e) => { toolsP = null; throw e; });
    return toolsP;
  };
  function renderTools(view, arg) {
    let inner = null, gone = false;
    if (!(window.VST && window.VSTM)) view.innerHTML = `<div class="tl-sk">${A.skel(64, '60%', 16)}<div class="sk-grid">${Array.from({ length: 6 }, () => A.skel(132, '100%', 22)).join('')}</div></div>`;
    A.loadTools().then(() => { if (!gone) inner = window.VST.render(view, arg); })
      .catch((e) => { if (!gone) { view.innerHTML = `<div class="card">${A.errorBox(e.message)}</div>`; const b = view.querySelector('[data-retry]'); if (b) b.onclick = () => A.emit('route:refresh'); } });
    return () => { gone = true; if (typeof inner === 'function') inner(); };
  }
  /** Compact strip on Home: a few tools with their Free or Premium badge. */
  function toolsStrip(list) {
    if (!list || !list.length) return '';
    const prem = S.user && (S.user.premium || (S.user.perms || []).includes('*'));
    return `<div class="c12 ftools"><div class="ft-h"><span class="mono-k">Free tools</span><span class="ft-sub">Break-even, ROAS, funnels and links. Runs in your browser.</span><a href="#tools">All tools${icon('arrow')}</a></div>
      <div class="ft-row">${list.slice(0, 4).map((t, i) => { const m = (window.VTA && VTA.META[t.key]) || { a: '#00A86B', surf: 'paper' }; return `<a class="ftc sf-${m.surf}" href="#tools/${esc(t.key)}" style="--d:${i};--a:${m.a};--t:${m.t || m.a}" data-ta-host><span class="ftc-art">${window.VTA ? VTA.art(t.key) : icon(t.icon)}</span><span class="ftc-t"><b>${esc(t.name)}</b><small class="${t.access === 'premium' ? 'p' : ''}">${t.access === 'premium' ? `${icon(prem ? 'premium' : 'lock')}Premium` : 'Free'}</small></span></a>`; }).join('')}</div></div>`;
  }

  A.pages.home = { title: 'Home', render: renderHome };
  A.pages.tools = { title: 'Tools', render: renderTools };
  A.pages.apps = { title: 'Apps', render: renderApps };
  A.feedItem = feedItem;
})();
