/* VooSquare tool art: one small animated SVG scene per free tool. Shared by the Tools page, the Home strip and the website.
 * VTA.art(key) returns markup; VTA.watch(root) plays scenes only while they are on screen and speeds them up on hover or tap.
 * Motion is CSS keyframes (/css/toolart.css) plus WAAPI for staggered sets; everything animates transform and opacity only. */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Each tool's identity. The accents come from the Voo family colours so the set reads as one system. */
  const META = {
    /* a: scene accent, u: the same hue made readable on white (sliders, chips, focus), t: tint hue when it differs. */
    breakeven: { a: '#C9F65B', u: '#00A86B', surf: 'night' },
    roas: { a: '#0A1A13', u: '#00774B', surf: 'lime' },
    killscale: { a: '#EE5A2F', u: '#E04B22', t: '#F2A23A', surf: 'paper' },
    budget: { a: '#E8A317', u: '#B7800B', surf: 'paper' },
    funnel: { a: '#3D6BF2', u: '#3D6BF2', surf: 'paper' },
    utm: { a: '#5B3FE8', u: '#5B3FE8', surf: 'paper' },
    postback: { a: '#3EE08F', u: '#12A866', surf: 'coal' },
    sizes: { a: '#0E9384', u: '#0E9384', surf: 'paper' },
  };
  const coin = (x, y, w = 12, cls = 'ta-cn') => `<g class="${cls}"><path class="f-a2" d="M${x - w} ${y}v4a${w} 4 0 0 0 ${w * 2} 0v-4z"/><ellipse class="f-a" cx="${x}" cy="${y}" rx="${w}" ry="4"/><ellipse class="s-a2" cx="${x}" cy="${y}" rx="${w * 0.55}" ry="1.9" fill="none"/></g>`;

  const ART = {
    /* A balance beam that tilts under the cost, then levels as coins land. */
    breakeven: () => `<svg viewBox="0 0 120 80"><path class="s-d" d="M60 30v38M46 70h28" stroke-width="3.2" stroke-linecap="round"/>
      <g class="ta-beam"><path class="s-a" d="M20 28h80" stroke-width="3" stroke-linecap="round"/>
        <g class="ta-pan l"><path class="s-d" d="M20 28l-9 16M20 28l9 16" stroke-width="1.2"/><path class="f-s" d="M8 44h24a12 6 0 0 1-24 0z"/>${coin(20, 39, 6, 'ta-c')}${coin(20, 35, 6, 'ta-c')}${coin(20, 31, 6, 'ta-c')}</g>
        <g class="ta-pan r"><path class="s-d" d="M100 28l-9 16M100 28l9 16" stroke-width="1.2"/><path class="f-s" d="M88 44h24a12 6 0 0 1-24 0z"/><rect class="f-i" x="93" y="33" width="14" height="10" rx="2"/><path class="s-a" d="M96 37h8M96 40h5" stroke-width="1.4" stroke-linecap="round"/></g>
        <circle class="f-surf s-a" cx="60" cy="28" r="4" stroke-width="2.2"/></g>
      <circle class="ta-ok f-a" cx="60" cy="28" r="9" opacity="0"/></svg>`,

    /* Spend stays put while the return stack grows and the multiple appears. */
    roas: () => {
      let k = '';
      for (let i = 0; i < 7; i++) k += coin(68, 92 - i * 8, 13, 'ta-c');
      return `<svg viewBox="0 0 100 112"><path class="s-d" d="M8 100h84" stroke-width="1.5" stroke-dasharray="2 3"/>
        <g class="ta-sp">${coin(30, 92, 11, 'ta-cs')}${coin(30, 84, 11, 'ta-cs')}${coin(30, 76, 11, 'ta-cs')}</g>${k}
        <g class="ta-x"><path class="s-i" d="M28 64C30 38 44 24 60 22" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-dasharray="1 5"/><path class="f-i" d="M62 17l2 10-9-3z"/>
        <rect class="f-i" x="6" y="8" width="38" height="20" rx="10"/><text class="f-surf" x="25" y="22.5" text-anchor="middle" font-size="12.5" font-weight="800">2.4×</text></g></svg>`;
    },

    /* A traffic light runs Kill, Hold, Scale and the verdict pill flips with it. */
    killscale: () => `<svg viewBox="0 0 120 80"><rect class="f-i" x="12" y="6" width="28" height="68" rx="11"/>
      ${[['#FF5A4A', 22], ['#F5C542', 40], ['#12C784', 58]].map(([c, y], i) => `<circle cx="26" cy="${y}" r="7" fill="#26372F"/><g class="ta-lamp l${i + 1}"><circle cx="26" cy="${y}" r="11" fill="${c}" opacity=".22"/><circle cx="26" cy="${y}" r="7" fill="${c}"/></g>`).join('')}
      <rect class="f-d" x="50" y="14" width="40" height="4" rx="2"/><rect class="f-d" x="50" y="60" width="54" height="4" rx="2" opacity=".6"/>
      ${[['Kill', '#E5483A', '#fff'], ['Hold', '#F5C542', '#1C1500'], ['Scale', '#00A86B', '#fff']].map(([t, bg, fg], i) => `<g class="ta-pill p${i + 1}"><rect x="50" y="26" width="62" height="26" rx="13" fill="${bg}"/><text x="81" y="43.5" text-anchor="middle" font-size="13" font-weight="800" fill="${fg}">${t}</text></g>`).join('')}</svg>`,

    /* Calendar days fill one by one while the spend bar grows. */
    budget: () => {
      let c = '';
      for (let i = 0; i < 21; i++) c += `<rect class="ta-d" x="${25 + (i % 7) * 10.4}" y="${30 + Math.floor(i / 7) * 10.4}" width="8" height="8" rx="2.2"/>`;
      return `<svg viewBox="0 0 120 80"><rect class="f-w s-l" x="18" y="8" width="84" height="66" rx="9"/><path class="f-a" d="M18 17a9 9 0 0 1 9-9h66a9 9 0 0 1 9 9v5H18z"/>
        <rect class="f-i" x="36" y="4" width="4" height="9" rx="2"/><rect class="f-i" x="80" y="4" width="4" height="9" rx="2"/>
        <g class="f-l">${c.replace(/class="ta-d"/g, 'class="f-l"')}</g><g class="f-a">${c}</g>
        <rect class="f-l" x="25" y="64" width="70" height="3.5" rx="1.75"/><rect class="ta-bar f-i" x="25" y="64" width="70" height="3.5" rx="1.75"/></svg>`;
    },

    /* People fall through the funnel; a few bounce off and drop away. */
    funnel: () => {
      const P = [[-14, 0, 0], [6, 0.45, 0], [-2, 0.9, 0], [16, 1.35, 1], [10, 1.8, 0], [-18, 2.25, 2], [2, 2.7, 0]];
      return `<svg viewBox="0 0 120 80"><path class="f-s s-a" d="M26 12h68L68 44v24H52V44z" stroke-width="2" stroke-linejoin="round"/>
        <path class="s-a" d="M34 22h52" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/><path class="s-a" d="M47 34h26" stroke-width="1" stroke-dasharray="2 3" opacity=".5"/>
        ${P.map(([x, d, o]) => `<circle class="ta-p${o ? ' off o' + o : ''} f-${o ? 'd' : 'a'}" cx="60" cy="4" r="2.8" style="--x:${x}px;animation-delay:${d}s"/>`).join('')}</svg>`;
    },

    /* Two links slide together and snap, then the tags clip on. */
    utm: () => `<svg viewBox="0 0 120 80"><g class="ta-lk l"><rect class="s-a" x="14" y="31" width="44" height="18" rx="9" fill="none" stroke-width="5.5"/></g>
      <g class="ta-lk r"><rect class="s-i" x="56" y="31" width="44" height="18" rx="9" fill="none" stroke-width="5.5"/></g>
      ${[['#5B3FE8', 22, 10], ['#3D6BF2', 50, 58], ['#00A86B', 80, 10]].map(([c, x, y]) => `<g class="ta-tag"><path d="M${x + 8} ${y + 4}l0 ${y < 40 ? 18 : -10}" stroke="${c}" stroke-width="1.2" opacity=".6"/><path d="M${x} ${y}h14l4 4-4 4H${x}a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2z" fill="${c}"/><circle cx="${x + 2.5}" cy="${y + 4}" r="1.1" fill="#fff"/></g>`).join('')}</svg>`,

    /* A conversion pings the tracker and comes back with a tick. */
    postback: () => `<svg viewBox="0 0 120 80"><path class="s-d" d="M34 40h52" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>
      <circle class="f-n s-a" cx="22" cy="40" r="12" stroke-width="2"/><path class="ta-tk s-a" d="M16.5 40.5l3.8 3.8 7.4-7.6" stroke-width="2.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <g class="ta-node"><rect class="f-n s-w" x="86" y="28" width="24" height="24" rx="7" stroke-width="2"/><path class="s-w" d="M92 37h12M92 43h8" stroke-width="2" stroke-linecap="round"/></g>
      <circle class="ta-go f-a" cx="34" cy="40" r="4"/><circle class="ta-back f-w" cx="86" cy="40" r="3.2"/></svg>`,

    /* One creative frame stretches 1:1, 4:5, 9:16. */
    sizes: () => `<svg viewBox="0 0 120 96"><rect class="s-l" x="40" y="8.5" width="40" height="71" rx="5" fill="none" stroke-dasharray="2 3"/>
      <g class="ta-fr"><rect class="f-s s-a" x="40" y="24" width="40" height="40" rx="4.5" stroke-width="1.8" vector-effect="non-scaling-stroke"/></g>
      <circle class="f-a" cx="60" cy="39" r="6"/><rect class="f-a" x="49" y="49" width="22" height="3.6" rx="1.8" opacity=".7"/>
      ${['1:1', '4:5', '9:16'].map((t, i) => `<text class="ta-rt r${i + 1} f-i" x="60" y="93" text-anchor="middle" font-size="10" font-weight="800">${t}</text>`).join('')}</svg>`,
  };

  /* Staggered sets: an element joins the scene at `at` (0 to 1 of the loop), holds, then leaves with the rest. */
  const SEQ = {
    breakeven: [['.ta-pan.l .ta-c', (i) => 0.14 + i * 0.12, 6000]],
    roas: [['.ta-c', (i) => 0.08 + i * 0.075, 5600]],
    budget: [['.ta-d', (i) => 0.05 + i * 0.026, 5600]],
    utm: [['.ta-tag', (i) => 0.4 + i * 0.08, 5000]],
  };
  function stagger(svg, key) {
    (SEQ[key] || []).forEach(([sel, at, dur]) => {
      svg.querySelectorAll(sel).forEach((el, i) => {
        const a = Math.min(0.85, at(i));
        el.animate([
          { opacity: 0, transform: 'translateY(-10px)', offset: 0 }, { opacity: 0, transform: 'translateY(-10px)', offset: a, easing: 'cubic-bezier(.3,1.5,.4,1)' },
          { opacity: 1, transform: 'translateY(0)', offset: Math.min(0.88, a + 0.05) }, { opacity: 1, transform: 'translateY(0)', offset: 0.9 },
          { opacity: 0, transform: 'translateY(0)', offset: 0.97 }, { opacity: 0, transform: 'translateY(0)', offset: 1 },
        ], { duration: dur, iterations: Infinity });
      });
    });
  }

  /** Markup for a tool's scene. Unknown tools get a quiet square mark. */
  function art(key, cls = '') {
    const m = META[key];
    const inner = ART[key] ? ART[key]() : '<svg viewBox="0 0 120 80"><rect class="f-s s-a" x="44" y="24" width="32" height="32" rx="9" stroke-width="2"/></svg>';
    return `<span class="ta ta-${ART[key] ? key : 'none'} sf-${m ? m.surf : 'paper'} ${cls}" data-ta="${ART[key] ? key : ''}" aria-hidden="true">${inner}</span>`;
  }

  /* Play only what is on screen. Hover or press speeds a scene up. */
  let io = null;
  const setRate = (el, r) => el.getAnimations({ subtree: true }).forEach((a) => { try { a.updatePlaybackRate(r); } catch { a.playbackRate = r; } });
  function play(el, on) {
    if (on && el.closest('.idle')) on = false;
    el.classList.toggle('ta-on', on);
    const all = el.getAnimations({ subtree: true });
    all.forEach((a) => (on ? a.play() : a.pause()));
    if (!on) return;
    // CSS loops and the staggered WAAPI parts share one clock, so the beam levels when the coins land.
    requestAnimationFrame(() => {
      const zero = all.filter((a) => !a.effect.getTiming().delay);
      const ref = zero.find((a) => a instanceof CSSAnimation) || zero[0];
      if (ref && ref.currentTime != null) zero.forEach((a) => { if (a !== ref) a.currentTime = ref.currentTime; });
    });
  }
  function watch(root = document, hostSel = '[data-ta-host]') {
    if (reduce) return;
    if (!io && 'IntersectionObserver' in window) io = new IntersectionObserver((es) => es.forEach((e) => { e.target.dataset.vis = e.isIntersecting ? '1' : '0'; play(e.target, e.isIntersecting); }), { rootMargin: '40px' });
    root.querySelectorAll('.ta:not([data-ta-w])').forEach((el) => {
      el.dataset.taW = 1;
      const key = el.dataset.ta;
      const svg = el.querySelector('svg');
      if (svg && key) stagger(svg, key);
      if (io) { play(el, false); io.observe(el); } else play(el, true);
      const host = el.closest(hostSel) || el;
      if (!host.dataset.taH) {
        host.dataset.taH = 1;
        const fast = () => host.querySelectorAll('.ta').forEach((t) => setRate(t, 2.4));
        const calm = () => host.querySelectorAll('.ta').forEach((t) => setRate(t, 1));
        host.addEventListener('pointerenter', fast); host.addEventListener('pointerleave', calm);
        host.addEventListener('focusin', fast); host.addEventListener('focusout', calm);
        host.addEventListener('touchstart', () => { fast(); setTimeout(calm, 1600); }, { passive: true });
      }
    });
  }

  /** Pause or resume one scene by hand (a tool with nothing to show yet). */
  const hold = (el, idle) => { const t = el && el.querySelector('.ta'); if (!t || reduce) return; el.classList.toggle('idle', idle); play(t, !idle && t.dataset.vis !== '0'); };

  window.VTA = { art, watch, hold, META, keys: Object.keys(ART) };
})();
