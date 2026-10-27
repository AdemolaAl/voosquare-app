/* VooSquare Spotlight: the animated sponsor slider. Shared by the member app, the website and the admin live preview.
 * VS.spotlight.render(slides, { variant: 'full'|'mini', interval, preview }) returns HTML; any .spot added to the page is wired up
 * automatically (autoplay, swipe, keys, pause when hidden or off-screen). Pure CSS/JS, see /css/spotlight.css. */
(function () {
  'use strict';
  const VS = window.VS;
  if (!VS) return;
  const { esc, icon } = VS;

  /* Brand themes. a/b = background gradient, acc = accent, glow = light bloom, spk = sparkline colour, cta = [bg, text]. */
  const THEMES = {
    join: { label: 'Joinvoo', a: '#7B5CFF', b: '#3418B8', fg: 'light', acc: '#C9F65B', glow: '#B9A8FF', spk: '#5B3FE8', cta: ['#FFFFFF', '#2B1597'], icon: 'join' },
    spy: { label: 'Spyvoo', a: '#FFFFFF', b: '#DCE4FF', fg: 'dark', ink: '#0E1A3D', ink2: 'rgba(14,26,61,.72)', acc: '#3355F0', glow: '#B8C8FF', spk: '#3355F0', cta: ['#3355F0', '#FFFFFF'], icon: 'spyvoo' },
    adv: { label: 'Vooads', a: '#2A1A14', b: '#0D0907', fg: 'light', acc: '#FF7A45', glow: '#EE5A2F', spk: '#EE5A2F', cta: ['#FF6A33', '#FFFFFF'], icon: 'vooads' },
    reply: { label: 'Replyvoo', a: '#FFD65E', b: '#F0A90F', fg: 'dark', acc: '#111312', glow: '#FFF3C4', spk: '#B88A00', cta: ['#111312', '#FFD65E'], icon: 'reply' },
    cast: { label: 'Castvoo', a: '#5584FF', b: '#1A35A8', fg: 'light', acc: '#C6D5FF', glow: '#9DB8FF', spk: '#3D6BF2', cta: ['#FFFFFF', '#1A35A8'], icon: 'cast' },
    land: { label: 'Landvoo', a: '#FF74B0', b: '#C21F66', fg: 'light', acc: '#FFE1EE', glow: '#FFB6D5', spk: '#E8458B', cta: ['#FFFFFF', '#B01A5B'], icon: 'land' },
    affleego: { label: 'Affleego', a: '#FFEB66', b: '#FFC21A', fg: 'dark', acc: '#111312', glow: '#FFF8CC', spk: '#C79100', cta: ['#111312', '#FFE14D'], icon: 'affleego' },
    gate: { label: 'Gatevoo', a: '#1A1A1A', b: '#000000', fg: 'light', acc: '#3EE08F', glow: '#3EE08F', spk: '#12A866', cta: ['#FFFFFF', '#000000'], icon: 'gatevoo' },
    brand: { label: 'VooSquare', a: '#16CC8B', b: '#00714B', fg: 'light', acc: '#C9F65B', glow: '#D8FF7A', spk: '#00A86B', cta: ['#0A1A13', '#C9F65B'], icon: 'voosquare' },
    premium: { label: 'Premium', a: '#15422F', b: '#06110C', fg: 'light', acc: '#C9F65B', glow: '#12C784', spk: '#00A86B', cta: ['#C9F65B', '#0A1A13'], icon: 'voosquare' },
    lime: { label: 'Lime', a: '#DDFB78', b: '#A6DE36', fg: 'dark', acc: '#0A1A13', glow: '#F4FFD0', spk: '#00774B', cta: ['#0A1A13', '#C9F65B'], icon: 'voosquare' },
  };
  const ALIAS = { dark: 'gate', gold: 'reply', night: 'premium', light: 'brand' };
  const PLACES = [['dashboard', 'Member dashboard'], ['academy', 'Academy'], ['community', 'Community'], ['website', 'Website']];
  const SCENES = [['auto', 'Match the theme'], ['stat', 'Stat card'], ['chat', 'Chat'], ['checkout', 'Checkout'], ['creative', 'Ad creatives'], ['feed', 'Ad spy feed']];
  const AUTO_SCENE = { reply: 'chat', gate: 'checkout', adv: 'creative', spy: 'feed' };

  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '').trim()) ? String(c).trim() : '');
  const lum = (c) => { const n = parseInt(c.slice(1), 16); const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]; };
  const mixLum = (a, b) => (lum(a) + lum(b)) / 2;
  const safeHref = (u) => { u = String(u || '').trim(); return /^(https?:\/\/|mailto:|\/(?!\/)|#)/i.test(u) && !/[\s\\<>"'`]/.test(u) ? u : ''; };
  const safeImg = (u) => { u = String(u || '').trim(); return /^https:\/\/[^/\s]/i.test(u) && !/[\s\\<>"'`]/.test(u) ? u : ''; };
  const isInternal = (u) => /^(?:\/app)?#/.test(u || '');
  const hashNum = (s) => { let h = 7; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

  /** Theme colours for a slide (custom uses the two admin colours). */
  function themeOf(s) {
    if (s.theme === 'custom') {
      const a = hex(s.c1) || '#00A86B'; const b = hex(s.c2) || '#0A1A13';
      const dark = mixLum(a, b) > 0.42;
      return { label: 'Custom', a, b, fg: dark ? 'dark' : 'light', acc: dark ? '#111312' : '#FFFFFF', glow: dark ? '#FFFFFF' : a, spk: lum(a) > 0.6 ? b : a, cta: dark ? ['#111312', '#FFFFFF'] : ['#FFFFFF', '#111312'], icon: 'voosquare' };
    }
    return THEMES[ALIAS[s.theme] || s.theme] || THEMES.brand;
  }

  /** Accepts the new slide shape and the old single-card ad shape. */
  function norm(x, i) {
    const s = { ...(x || {}) };
    let theme = ALIAS[s.theme] || s.theme;
    if (theme !== 'custom' && !THEMES[theme]) theme = 'brand';
    const t = theme === 'custom' ? null : THEMES[theme];
    let places = Array.isArray(s.placements) ? s.placements.slice() : [];
    if (!places.length && s.placement) places = [s.placement];
    places = places.map((p) => (p === 'site' ? 'website' : p));
    const chips = (Array.isArray(s.chips) ? s.chips : String(s.chips || '').split('\n')).map((c) => String(c || '').trim()).filter(Boolean).slice(0, 3);
    return {
      id: s.id || 'sl' + i, enabled: s.enabled !== false, placements: places, theme, c1: s.c1 || '', c2: s.c2 || '',
      icon: s.icon != null ? s.icon : (t ? t.icon : 'voosquare'), brand: s.brand || (t ? t.label : ''), product: s.product || '',
      kicker: s.kicker || 'Sponsored by Zedapex', title: s.title || '', body: s.body || '', cta_text: s.cta_text || '', cta_url: s.cta_url || '',
      scene: s.scene || 'auto', stat_label: s.stat_label || '', stat_value: s.stat_value || '', example: s.example !== false, chips, image: s.image || '',
      starts: Number(s.starts) || 0, ends: Number(s.ends) || 0,
    };
  }
  /** Slides for one placement: switched on, inside their dates. */
  function pick(list, place, { now = Date.now() } = {}) {
    return (Array.isArray(list) ? list : []).map(norm).filter((s) => s.enabled && (s.title || s.body) && (!place || s.placements.includes(place)) && (!s.starts || s.starts <= now) && (!s.ends || s.ends >= now));
  }

  /* ---------------- pieces ---------------- */
  const FACES = [
    { skin: 3, hair: 3, hairColor: 2, eyes: 0, mouth: 1, acc: 2, shirt: 1, bg: 3 },
    { skin: 7, hair: 0, hairColor: 0, eyes: 0, mouth: 0, acc: 1, shirt: 0, bg: 0 },
    { skin: 0, hair: 2, hairColor: 1, eyes: 1, mouth: 1, acc: 0, shirt: 4, bg: 1 },
    { skin: 5, hair: 5, hairColor: 3, eyes: 0, mouth: 0, acc: 2, shirt: 6, bg: 5 },
    { skin: 1, hair: 1, hairColor: 0, eyes: 2, mouth: 1, acc: 0, shirt: 3, bg: 6 },
    { skin: 4, hair: 4, hairColor: 1, eyes: 0, mouth: 2, acc: 3, shirt: 2, bg: 2 },
  ];
  const face = (k, cls = '') => `<span class="sp-face ${cls}">${VS.avatar(FACES[k % FACES.length])}</span>`;
  const pIcon = (s, size) => (s.icon ? VS.productIcon({ icon: s.icon, name: s.brand, color: themeOf(s).spk }, size) : '');

  /** Parse "+412", "$1,200", "3.5x" into a count-up spec. */
  function countSpec(v) {
    const m = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(String(v || '').trim());
    if (!m) return null;
    const num = Number(m[2].replace(/,/g, ''));
    if (!isFinite(num)) return null;
    return { pre: m[1], num, dec: (m[2].split('.')[1] || '').length, suf: m[3] };
  }
  const numHtml = (v, cls = 'sp-num') => {
    const c = countSpec(v);
    return `<b class="${cls}"${c ? ` data-count="${c.num}" data-dec="${c.dec}" data-pre="${esc(c.pre)}" data-suf="${esc(c.suf)}"` : ''}>${esc(v)}</b>`;
  };

  /** Rising sparkline, seeded so each slide keeps its own shape. */
  function spark(seed) {
    let h = hashNum(seed) || 1;
    const rnd = () => { h = (h * 1103515245 + 12345) >>> 0; return (h % 1000) / 1000; };
    const pts = []; const n = 9;
    for (let i = 0; i < n; i++) { const trend = 46 - (i / (n - 1)) * 34; pts.push([4 + i * (192 / (n - 1)), Math.max(6, Math.min(50, trend + (rnd() - 0.5) * 16))]); }
    pts[n - 1][1] = 8;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < n; i++) { const [x0, y0] = pts[i - 1]; const [x1, y1] = pts[i]; const cx = (x0 + x1) / 2; d += ` C${cx} ${y0} ${cx} ${y1} ${x1} ${y1}`; }
    const gid = 'spg' + (hashNum(seed + 'g') % 1e7) + (sparkN++);
    const [ex, ey] = pts[n - 1];
    return `<svg class="sp-spark" viewBox="0 0 200 56" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--spk)" stop-opacity=".28"/><stop offset="1" stop-color="var(--spk)" stop-opacity="0"/></linearGradient></defs><path class="sp-area" d="${d} L${ex} 56 L4 56Z" fill="url(#${gid})"/><path class="sp-line" d="${d}" pathLength="1" fill="none" stroke="var(--spk)" stroke-width="2.6" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle class="sp-end" cx="${ex}" cy="${ey}" r="4" fill="var(--spk)"/></svg>`;
  }
  let sparkN = 0;

  const chip = (text, k, i, s) => {
    if (!text) return '';
    const lead = k === 0 ? face(i + 2, 'sp-face-xs') : k === 1 ? `<i class="sp-dot sp-dot-acc">${icon('check')}</i>` : '<i class="sp-dot sp-live"></i>';
    return `<span class="sp-chip sp-c${k + 1} ${k === 1 ? 'sp-chip-acc' : ''}" style="--d:${k}">${lead}<span>${esc(text)}</span></span>`;
  };
  const chipsHtml = (s, i, skip = []) => s.chips.map((c, k) => (skip.includes(k) ? '' : chip(c, k, i, s))).join('');
  const exampleTag = (s) => (s.example ? '<em class="sp-ex">Example</em>' : '');

  function sceneStat(s, i) {
    return `<div class="sp-card">
      <div class="sp-card-h">${pIcon(s, 'xs')}<span>${esc(s.stat_label || s.brand || 'Today')}</span>${exampleTag(s)}</div>
      ${s.stat_value ? numHtml(s.stat_value) : ''}
      ${spark(s.id + s.title)}
      ${s.example ? `<div class="sp-card-f"><span><i class="sp-live"></i>Live</span><span class="sp-up">${icon('up')}Today</span></div>` : ''}
    </div>${chipsHtml(s, i)}${face(i, 'sp-f1')}${face(i + 3, 'sp-f2')}`;
  }
  function sceneChat(s, i) {
    const [q, a, done] = s.chips;
    return `<div class="sp-phone">
      <div class="sp-ph-h">${pIcon(s, 'xs')}<b>${esc(s.brand || 'AI Closer')}</b><span class="sp-on"><i></i>online</span></div>
      <div class="sp-msg sp-msg-in sp-m1">${face(i + 1, 'sp-face-xs')}<span>${esc(q || 'Is the VIP group still open?')}</span></div>
      <div class="sp-msg sp-msg-out sp-m2"><span class="sp-typing"><i></i><i></i><i></i></span><span class="sp-tx">${esc(a || 'Yes. Here is your link to join today.')}</span></div>
      ${done !== '' ? `<div class="sp-paid sp-m3">${icon('check')}${esc(done || 'Paid · Joined')}</div>` : ''}
    </div>${s.stat_value ? `<span class="sp-chip sp-chip-stat sp-c2"><span>${esc(s.stat_label || 'Reply time')}</span><b>${esc(s.stat_value)}</b>${s.example ? '<em class="sp-ex">Example</em>' : ''}</span>` : ''}${face(i, 'sp-f1')}`;
  }
  function sceneCheckout(s, i) {
    // QR-style code: three finder squares and seeded modules (decorative only).
    let h = hashNum(s.id) || 3; const cells = []; const G = 21;
    const inFinder = (x, y) => [[0, 0], [G - 7, 0], [0, G - 7]].some(([fx, fy]) => x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7);
    for (let y = 0; y < G; y++) for (let x = 0; x < G; x++) {
      if (inFinder(x, y)) continue;
      h = (h * 1103515245 + 12345) >>> 0;
      if ((h >>> 16) % 100 < 46) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
    const finder = (fx, fy) => `<rect x="${fx + 0.5}" y="${fy + 0.5}" width="6" height="6" rx="1.4" fill="none" stroke="#0A1A13" stroke-width="1"/><rect x="${fx + 2}" y="${fy + 2}" width="3" height="3" rx=".6"/>`;
    cells.push(finder(0, 0), finder(G - 7, 0), finder(0, G - 7));
    return `<div class="sp-pay">
      <div class="sp-pay-h">${pIcon(s, 'xs')}<b>${esc(s.brand || 'Checkout')}</b><span class="sp-net">${esc(s.stat_label || 'USDT · TRC20')}</span></div>
      <div class="sp-pay-m"><svg class="sp-qr" viewBox="0 0 21 21" shape-rendering="crispEdges" aria-hidden="true">${cells.join('')}</svg><div><small>Amount due${s.example ? ' <em class="sp-ex">Example</em>' : ''}</small>${numHtml(s.stat_value || '$120', 'sp-amt')}<span class="sp-addr">TQ7x…9Kp2</span></div></div>
      <div class="sp-st"><span class="sp-w"><i class="sp-spin"></i>Waiting for payment</span><span class="sp-ok">${icon('check')}Paid to your wallet</span></div>
    </div><span class="sp-coin sp-k1">₮</span><span class="sp-coin sp-k2">₿</span>${chipsHtml(s, i, [2])}${face(i + 1, 'sp-f1')}`;
  }
  function sceneCreative(s, i) {
    const caps = s.chips.length ? s.chips : ['Wait, this works in Pidgin?', 'Watch before you scroll', 'Nairobi, you need this'];
    const fills = ['linear-gradient(160deg,#FF8A5B,#EE5A2F 60%,#9A2A0E)', 'linear-gradient(160deg,#8C74FF,#5B3FE8 60%,#2B1597)', 'linear-gradient(160deg,#3FE0A0,#00A86B 60%,#00553A)'];
    return `<div class="sp-fan">${[0, 1, 2].map((k) => `<div class="sp-tile sp-tile${k + 1}" style="background:${fills[k]}"><span class="sp-tile-face">${VS.avatar(FACES[(i + k) % FACES.length])}</span><span class="sp-play">${icon('play')}</span><span class="sp-cap">${esc(caps[k % caps.length])}</span><span class="sp-ratio">${['9:16', '1:1', '4:5'][k]}</span></div>`).join('')}</div>
      ${s.stat_value ? `<span class="sp-chip sp-chip-stat sp-c2"><span>${esc(s.stat_label || 'Ads made')}</span>${numHtml(s.stat_value, 'sp-cnum')}${s.example ? '<em class="sp-ex">Example</em>' : ''}</span>` : ''}`;
  }
  /** Ad spy feed: a live search, the long-running winner gets its badge and the AI reads its hook. */
  function sceneFeed(s, i) {
    const [hook, saved] = s.chips;
    const fills = ['linear-gradient(160deg,#6F8BFF,#3355F0 60%,#1B2E9E)', 'linear-gradient(160deg,#FFB27A,#EE7A3F 60%,#A8441A)'];
    const ad = (k, badge) => `<div class="sp-ad sp-ad${k + 1}"><span class="sp-ad-th" style="background:${fills[k]}"><span class="sp-ad-face">${VS.avatar(FACES[(i + k + 1) % FACES.length])}</span><span class="sp-play">${icon('play')}</span></span><span class="sp-ad-tx"><i></i><i></i><i></i></span>${badge}</div>`;
    return `<div class="sp-feed">
      <div class="sp-feed-h">${pIcon(s, 'xs')}<span class="sp-q">${icon('search')}<span>Live ads · All countries</span></span></div>
      ${ad(0, `<span class="sp-run"><i></i>${esc(s.stat_label || 'Running')} ${numHtml(s.stat_value || '94 days', 'sp-rn')}${s.example ? ' <em class="sp-ex">Example</em>' : ''}</span>`)}
      ${ad(1, '<span class="sp-run sp-run-new">Started this week</span>')}
      <span class="sp-scan"></span>
    </div>${hook ? `<span class="sp-chip sp-chip-acc sp-c1 sp-hook" style="--d:1"><i class="sp-dot sp-dot-acc">${icon('spark')}</i><span>${esc(hook)}</span></span>` : ''}${saved ? `<span class="sp-chip sp-c2" style="--d:2"><i class="sp-dot sp-saved">${icon('check')}</i><span>${esc(saved)}</span></span>` : ''}`;
  }
  function sceneImage(s, i, img) {
    return `<div class="sp-img"><img src="${esc(img)}" alt="" loading="lazy" decoding="async"></div>${chipsHtml(s, i, [2])}${face(i, 'sp-f1')}`;
  }
  function scene(s, i) {
    const img = safeImg(s.image);
    if (img) return ['image', sceneImage(s, i, img)];
    const kind = s.scene === 'auto' || !s.scene ? (AUTO_SCENE[s.theme] || 'stat') : s.scene;
    if (kind === 'chat') return [kind, sceneChat(s, i)];
    if (kind === 'checkout') return [kind, sceneCheckout(s, i)];
    if (kind === 'creative') return [kind, sceneCreative(s, i)];
    if (kind === 'feed') return [kind, sceneFeed(s, i)];
    return ['stat', sceneStat(s, i)];
  }

  /* ---------------- render ---------------- */
  let N = 0;
  function render(list, opts = {}) {
    const slides = (Array.isArray(list) ? list : []).map((x, i) => (x && x.placements && x.chips && 'example' in x ? x : norm(x, i)));
    if (!slides.length) return '';
    const mini = opts.variant === 'mini';
    const id = 'sp' + (++N);
    const sec = Math.min(15, Math.max(3, Number(opts.interval) || 6));
    const many = slides.length > 1;
    const body = slides.map((s, i) => {
      const t = themeOf(s);
      const href = safeHref(s.cta_url);
      const ext = href && !isInternal(href) && !/^\/(?!\/)/.test(href);
      const vars = `--a:${t.a};--b:${t.b};--acc:${t.acc};--accf:${lum(t.acc) > 0.35 ? '#0A1A13' : '#FFFFFF'};--glow:${t.glow};--spk:${t.spk};--ctab:${t.cta[0]};--ctaf:${t.cta[1]}${t.ink ? `;--fg:${t.ink};--fg2:${t.ink2 || t.ink}` : ''}`;
      const label = `${i + 1} of ${slides.length}${s.brand ? ': ' + s.brand : ''}`;
      const cta = s.cta_text ? `<a class="sp-cta" href="${esc(href || '#')}" ${href ? `data-go="${esc(href)}"` : ''} ${ext ? 'target="_blank" rel="noopener"' : ''}${opts.preview ? ' tabindex="-1"' : ''}><span>${esc(s.cta_text)}</span><span class="sp-arr">${icon(ext ? 'ext' : 'arrow')}</span></a>` : '';
      const head = `<div class="sp-brand">${s.icon ? `<span class="sp-pi">${pIcon(s, mini ? 'xs' : 'sm')}</span>` : ''}<span class="sp-bt">${s.brand ? `<b>${esc(s.brand)}</b>` : ''}<small>${esc(s.kicker)}</small></span></div>`;
      const copy = `<div class="sp-copy">${head}<h3 class="sp-t">${esc(s.title)}</h3>${s.body ? `<p class="sp-p">${esc(s.body)}</p>` : ''}${cta}</div>`;
      let art;
      if (mini) art = `<div class="sp-scene sp-scene-mini" aria-hidden="true">${s.chips[0] ? chip(s.chips[0], 0, i, s) : ''}${face(i, 'sp-f1')}</div>`;
      else { const [kind, html] = scene(s, i); art = `<div class="sp-scene" aria-hidden="true"><div class="sp-sc sc-${kind}">${html}</div></div>`; }
      return `<article class="sp-slide sp-fg-${t.fg}${i === 0 ? ' is-on' : ''}" id="${id}-${i}" style="${vars}" role="group" aria-roledescription="slide" aria-label="${esc(label)}"${i ? ' aria-hidden="true" inert' : ''} data-fg="${t.fg}">
        <div class="sp-bg" aria-hidden="true"><i class="sp-blob sp-b1"></i><i class="sp-blob sp-b2"></i><i class="sp-sq sp-q1"></i><i class="sp-sq sp-q2"></i><i class="sp-grid"></i><i class="sp-shine"></i></div>
        ${copy}${art}
      </article>`;
    }).join('');
    const tabs = many ? `<div class="sp-ctrl"><div class="sp-tabs" role="group" aria-label="Choose a slide">${slides.map((s, i) => `<button type="button" class="sp-tab${i === 0 ? ' is-cur' : ''}" data-k="${i}" aria-label="Show slide ${i + 1}${s.brand ? ': ' + esc(s.brand) : ''}"${i === 0 ? ' aria-current="true"' : ''}>${mini ? '' : `<span class="sp-tl">${esc(s.brand || 'Slide ' + (i + 1))}</span>`}<span class="sp-track"><i class="sp-fill"></i></span></button>`).join('')}</div>
      <div class="sp-btns">${mini ? '' : `<button type="button" class="sp-b" data-prev aria-label="Previous slide">${icon('left')}</button><button type="button" class="sp-b" data-next aria-label="Next slide">${icon('arrow')}</button>`}<button type="button" class="sp-b" data-pause aria-label="Pause slides"><span class="sp-ip">${icon('pause')}</span><span class="sp-iy">${icon('play')}</span></button></div></div>` : '';
    return `<section class="spot ${mini ? 'sp-mini' : 'sp-full'} ${many ? '' : 'sp-one'} sp-fg-${themeOf(slides[0]).fg}${opts.preview ? ' sp-preview' : ''}" data-spot style="--int:${sec}s" aria-roledescription="carousel" aria-label="${esc(opts.label || 'Sponsored by Zedapex')}">
      <div class="sp-stage" aria-live="off">${body}</div>${tabs}
    </section>`;
  }

  /* ---------------- behaviour ---------------- */
  const live = new Set();
  function countIn(slide) {
    slide.querySelectorAll('[data-count]').forEach((b) => {
      const to = Number(b.dataset.count); const dec = Number(b.dataset.dec) || 0; const pre = b.dataset.pre || ''; const suf = b.dataset.suf || '';
      const show = (v) => { b.textContent = pre + VS.fmt(v, dec) + suf; };
      if (VS.reduce) return show(to);
      const t0 = performance.now(); const ms = 1300;
      const step = (t) => { const p = Math.min((t - t0) / ms, 1); show(to * (1 - Math.pow(1 - p, 3))); if (p < 1 && slide.classList.contains('is-on')) requestAnimationFrame(step); else show(to); };
      requestAnimationFrame(step);
    });
  }

  function mount(root) {
    if (!root || root.dataset.spotOn) return null;
    root.dataset.spotOn = '1';
    const slides = [...root.querySelectorAll('.sp-slide')];
    const tabs = [...root.querySelectorAll('.sp-tab')];
    const stage = root.querySelector('.sp-stage');
    const pauseB = root.querySelector('[data-pause]');
    const n = slides.length;
    const auto = n > 1 && !VS.reduce;
    if (!auto) root.classList.add('sp-noauto');
    let outT = 0; let i = 0; let userPaused = false; let hover = false; let focus = false; let inView = false;

    const sync = () => {
      const idle = !inView || document.hidden;
      root.classList.toggle('is-idle', idle);
      const run = auto && !userPaused && !hover && !focus && !idle;
      root.classList.toggle('is-run', run);
      root.classList.toggle('is-paused', userPaused);
      if (pauseB) pauseB.setAttribute('aria-label', userPaused ? 'Play slides' : 'Pause slides');
      stage.setAttribute('aria-live', run ? 'off' : 'polite');
    };
    const go = (k, dir) => {
      k = ((k % n) + n) % n;
      if (k === i) return;
      const d = dir || (k > i ? 1 : -1);
      root.style.setProperty('--dir', d);
      root.classList.toggle('dir-prev', d < 0);
      const old = slides[i];
      slides.forEach((x) => x.classList.remove('is-out', 'sp-in'));
      old.classList.remove('is-on'); old.setAttribute('aria-hidden', 'true'); old.inert = true;
      if (!VS.reduce) old.classList.add('is-out');
      i = k;
      const cur = slides[i];
      cur.classList.add('is-on'); cur.removeAttribute('aria-hidden'); cur.inert = false;
      if (!VS.reduce) cur.classList.add('sp-in');
      clearTimeout(outT);
      outT = setTimeout(() => slides.forEach((x) => x.classList.remove('is-out', 'sp-in')), 1050);
      root.classList.toggle('sp-fg-dark', cur.dataset.fg === 'dark'); root.classList.toggle('sp-fg-light', cur.dataset.fg !== 'dark');
      tabs.forEach((t, j) => { t.classList.toggle('is-cur', j === i); t.classList.toggle('is-done', j < i); if (j === i) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current'); });
      if (inView) countIn(cur);
    };
    const next = () => go(i + 1, 1);
    const prev = () => go(i - 1, -1);

    // The active tab's progress fill drives autoplay: its CSS animation pauses with the slider, and its end moves on.
    const onEnd = (e) => { if (e.target.classList.contains('sp-fill') && e.target.closest('.sp-tab.is-cur')) next(); };
    root.addEventListener('animationend', onEnd);
    root.addEventListener('click', (e) => {
      if (swiped) { e.preventDefault(); e.stopPropagation(); swiped = false; return; }
      if (root.classList.contains('sp-preview') && e.target.closest('.sp-cta')) { e.preventDefault(); e.stopPropagation(); return; }
      const t = e.target.closest('.sp-tab'); if (t) { go(Number(t.dataset.k)); return; }
      if (e.target.closest('[data-next]')) next();
      else if (e.target.closest('[data-prev]')) prev();
      else if (e.target.closest('[data-pause]')) { userPaused = !userPaused; sync(); }
    }, true);
    root.addEventListener('keydown', (e) => {
      if (n < 2 || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault(); if (e.key === 'ArrowRight') next(); else prev();
        if (e.target.classList.contains('sp-tab')) tabs[i].focus();
      }
    });
    root.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hover = true; sync(); } });
    root.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hover = false; sync(); } });
    root.addEventListener('focusin', (e) => { if (e.target.matches(':focus-visible')) { focus = true; sync(); } });
    root.addEventListener('focusout', (e) => { if (!root.contains(e.relatedTarget)) { focus = false; sync(); } });

    // Swipe (touch, pen or mouse drag). Vertical drags keep scrolling the page.
    let sx = 0; let sy = 0; let down = false; let swiped = false;
    stage.addEventListener('pointerdown', (e) => { if (n < 2 || e.button > 0) return; down = true; sx = e.clientX; sy = e.clientY; });
    stage.addEventListener('pointerup', (e) => {
      if (!down) return; down = false;
      const dx = e.clientX - sx; const dy = e.clientY - sy;
      if (Math.abs(dx) > 44 && Math.abs(dx) > Math.abs(dy) * 1.2) { swiped = true; if (dx < 0) next(); else prev(); setTimeout(() => { swiped = false; }, 400); }
    });
    stage.addEventListener('pointercancel', () => { down = false; });

    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => {
      const was = inView; inView = es[es.length - 1].isIntersecting; sync();
      if (inView && !was) countIn(slides[i]);
    }, { threshold: 0.2 }) : null;
    if (io) io.observe(root); else inView = true;
    const onVis = () => sync();
    document.addEventListener('visibilitychange', onVis);
    sync();

    const ctl = {
      root, go: (k) => go(k), next, prev, get index() { return i; },
      destroy() { if (io) io.disconnect(); document.removeEventListener('visibilitychange', onVis); root.removeEventListener('animationend', onEnd); live.delete(ctl); },
    };
    live.add(ctl);
    root._spot = ctl;
    return ctl;
  }

  const scan = (node) => {
    if (!node || node.nodeType !== 1) return;
    if (node.matches('[data-spot]')) mount(node);
    node.querySelectorAll && node.querySelectorAll('[data-spot]').forEach(mount);
  };
  const mo = new MutationObserver((recs) => {
    let removed = false;
    for (const r of recs) { r.addedNodes.forEach(scan); if (r.removedNodes.length) removed = true; }
    if (removed) live.forEach((c) => { if (!c.root.isConnected) c.destroy(); });
  });
  const start = () => { mo.observe(document.body, { childList: true, subtree: true }); scan(document.body); };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);

  VS.spotlight = { render, mount, pick, norm, themeOf, THEMES, PLACES, SCENES, AUTO_SCENE };
})();
