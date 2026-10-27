/* VooSquare Academy lesson art: illustrated scenes, cast chips and the plan that picks them. Loaded on demand by the lesson
 * player (app-school.js) and by the admin lesson preview, after shared.js (VS.avatar) and lesson-visuals.js (VSL).
 *
 *   VSA.scene(key)             SVG for one scene (360 × 240), layered for parallax, idle motion in lesson-art.css
 *   VSA.pick(text, ctx)        best scene key for some text (lesson openings)
 *   VSA.plan(steps, ctx)       one entry per slide: { scene, chips } — deterministic, no scene twice in a row
 *   VSA.dress(stageEl, step, p)  adds the scene, the cast chips on cards / flow nodes and the living backdrop
 *   VSA.ambient()              the moving backdrop (glow, particles, sheen) for any dark stage
 *   VSA.parallax(el)           pointer parallax on desktop (fine pointers only, never with reduced motion)
 *
 * The cast is drawn from the same face code as the member avatars and the welcome-screen crew (VS.avatar + the crew
 * body), so every person in a lesson matches the rest of VooSquare. Art is chosen at render time from the slide's
 * type, heading and text plus the lesson, module and school: content files are never touched.
 * Motion: CSS transforms and opacity only; static with prefers-reduced-motion; paused while the stage is off-screen. */
(function () {
  'use strict';
  const VS = window.VS || null;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- palette (brand night greens, lime accent) ---------------- */
  const C = {
    n0: '#0B1C14', n1: '#10261B', n2: '#163423', n3: '#1D4430', line: '#2C5440', line2: '#3B6B53',
    lime: '#C9F65B', green: '#12C784', mint: '#B3E8D3', paper: '#F3F8F5', paper2: '#D9E7DF', paper3: '#B9CEC3',
    gold: '#F5C542', gold2: '#D9A21B', coral: '#FF9A5C', violet: '#A796FF', sky: '#8DB2FF', ink: '#0E1B15',
  };

  /* ---------------- the cast ---------------- */
  // a = member-avatar settings (shared.js). One look per role, used in scenes and on card chips alike.
  const CAST = {
    you: { a: { skin: 0, hair: 0, hairColor: 0, eyes: 0, mouth: 0, acc: 1, shirt: 0 }, shirt: '#12A673', role: 'Affiliate' },
    ada: { a: { skin: 4, hair: 5, hairColor: 0, eyes: 0, mouth: 0, acc: 2, shirt: 1 }, shirt: '#6A55E6', role: 'Advertiser' },
    kofi: { a: { skin: 2, hair: 4, hairColor: 0, eyes: 0, mouth: 0, acc: 0, shirt: 7 }, shirt: '#0F8F80', role: 'Network' },
    zara: { a: { skin: 3, hair: 2, hairColor: 1, eyes: 0, mouth: 0, acc: 0, shirt: 3 }, shirt: '#3D6BF2', role: 'Traffic source' },
    tunde: { a: { skin: 6, hair: 0, hairColor: 0, eyes: 0, mouth: 0, acc: 3, shirt: 5 }, shirt: '#E2A519', role: 'User' },
    amina: { a: { skin: 5, hair: 1, hairColor: 1, eyes: 0, mouth: 0, acc: 2, shirt: 2 }, shirt: '#E8693D', role: 'Creator' },
    sam: { a: { skin: 7, hair: 5, hairColor: 2, eyes: 0, mouth: 0, acc: 1, shirt: 5 }, shirt: '#E9F0EC', role: 'Analyst' },
    nia: { a: { skin: 1, hair: 2, hairColor: 0, eyes: 0, mouth: 0, acc: 0, shirt: 4 }, shirt: '#B8E04A', role: 'Manager' },
  };
  const skinOf = (c) => (VS ? VS.AV.skins[(Number(c.a.skin) || 0) % 8] : '#8D5524');
  const headCache = {};
  /** The member-avatar face without its round background, shirt and neck (exactly like the welcome-screen crew). */
  function headOf(key) {
    const c = CAST[key];
    if (!VS) return `<ellipse cx="32" cy="30" rx="13" ry="15" fill="${skinOf(c)}"/>`;
    // A fresh avatar each time keeps clip-path ids unique; the regexes only drop the parts the body replaces.
    const face = VS.avatar(c.a, {}).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    return face.replace(/<rect width="64" height="64" fill="[^"]+"\/>/, '').replace(/<path d="M8 66C10 50[^>]*\/>/, '').replace(/<rect x="27.5" y="38"[^>]*\/>/, '');
  }
  /** Round face chip (cards, flow nodes): the member avatar on a deep green disc. */
  function faceChip(key) {
    const c = CAST[key] || CAST.you;
    if (!headCache[key]) headCache[key] = VS ? VS.avatar(c.a, { still: true }).replace(/<rect width="64" height="64" fill="[^"]+"\/>/, '<rect width="64" height="64" fill="#21402F"/>') : '';
    return headCache[key];
  }

  /* ---------------- figures (crew body, 140 × 170 frame) ---------------- */
  const arm = (sh, skin, d, hx, hy, cls = '') => `<g class="${cls}"><path d="${d}" stroke="${sh}" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="6.5" fill="${skin}"/></g>`;
  const laptopBack = '<path d="M36 132H104L100 168H40Z" fill="#20322A"/><path d="M36 132H104L100 168H40Z" fill="none" stroke="#3B6B53" stroke-width="1.5"/><rect x="36" y="131" width="68" height="3" rx="1.5" fill="#C9F65B" opacity=".25"/><circle class="la-glow" cx="70" cy="150" r="6.5" fill="#C9F65B"/>';
  /**
   * A person from the waist up. pose: desk (typing at a laptop) | phone | point | wave | halt | cheer | think | hold | rest.
   * o.item: SVG drawn in the hands for "hold" (frame coordinates).
   */
  function fig(key, pose = 'desk', x = 0, y = 0, s = 1, o = {}) {
    const c = CAST[key] || CAST.you;
    const skin = skinOf(c), sh = c.shirt;
    const A = (d, hx, hy, cls) => arm(sh, skin, d, hx, hy, cls);
    let arms = ''; let front = ''; let mid = '';
    switch (pose) {
      case 'desk': arms = A('M44 128 Q34 142 50 152', 52, 152, 'la-type') + A('M96 128 Q106 142 90 152', 88, 152, 'la-type r'); front = laptopBack; break;
      case 'phone':
        mid = '<rect x="59" y="118" width="22" height="36" rx="5" fill="#0B1510" stroke="#3B6B53" stroke-width="1.5"/><rect x="61.5" y="122" width="17" height="27" rx="3" fill="#C9F65B" opacity=".9"/><rect class="la-scrollbar" x="64" y="126" width="12" height="3" rx="1.5" fill="#14301F" opacity=".5"/><rect x="64" y="132" width="9" height="3" rx="1.5" fill="#14301F" opacity=".35"/>';
        arms = A('M44 128 Q38 152 60 150', 61, 149) + `<g class="la-thumb">${A('M96 128 Q104 152 80 150', 79, 148)}</g>`; break;
      case 'point': arms = A('M44 128 Q36 150 42 172', 42, 176) + A('M96 126 Q116 118 126 98', 128, 94, 'la-point'); break;
      case 'wave': arms = A('M44 128 Q34 142 50 152', 52, 152) + A('M96 126 Q112 112 114 90', 114, 84, 'la-wave'); break;
      case 'halt': arms = A('M44 128 Q36 150 42 172', 42, 176) + A('M96 126 Q114 116 116 94', 116, 88); break;
      case 'cheer': arms = A('M44 126 Q30 110 28 90', 28, 85, 'la-cheer') + A('M96 126 Q110 110 112 90', 112, 85, 'la-cheer r'); break;
      case 'think': arms = A('M44 128 Q46 152 82 146', 84, 145) + A('M96 128 Q112 122 92 104', 90, 103); break;
      case 'hold': mid = o.item || ''; arms = A('M44 128 Q38 150 54 156', 56, 156) + A('M96 128 Q102 150 86 156', 84, 156); break;
      default: arms = A('M44 128 Q36 150 42 172', 42, 176) + A('M96 128 Q104 150 98 172', 98, 176);
    }
    const body = `<path d="M30 172C32 124 48 108 70 108C92 108 108 124 110 172Z" fill="${sh}"/><path d="M70 108C92 108 108 124 110 172H88C90 142 86 120 70 108Z" fill="#000" opacity=".13"/><path d="M62 108L70 120L78 108" fill="#fff" opacity=".2"/><rect x="62" y="94" width="16" height="18" rx="6" fill="${skin}"/>`;
    const head = `<g class="la-head"><g transform="translate(25.2 25) scale(1.4)">${headOf(key)}</g></g>`;
    return `<g transform="translate(${x} ${y}) scale(${s})"><g class="la-fig${o.flip ? ' la-flip' : ''}"${o.flip ? ' transform="translate(140 0) scale(-1 1)"' : ''}><g class="la-bob" style="animation-delay:${o.d || 0}s">${body}${head}${mid}${arms}</g>${front}</g></g>`;
  }
  /** Seated at the desk line (y = top of the desk). */
  const seated = (key, cx, deskY, s = 1, o = {}) => fig(key, o.pose || 'desk', cx - 70 * s, deskY + 4 - 168 * s, s, o);
  /** Standing, cropped by the bottom of the scene (half body). */
  const stand = (key, pose, cx, s = 1, o = {}) => fig(key, pose, cx - 70 * s, 244 - 170 * s + (o.dy || 0), s, o);

  /* ---------------- props ---------------- */
  const R = (x, y, w, h, rx, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;
  const line = (x, y, w, fill = C.paper2, h = 6) => R(x, y, w, h, h / 2, fill);
  const shadow = (x, y, w, h, rx) => R(x + 3, y + 6, w, h, rx, '#020A06', 'opacity=".38"');
  /** A light UI card. */
  const card = (x, y, w, h, inner = '', o = {}) => `<g transform="translate(${x} ${y})">${shadow(0, 0, w, h, o.rx || 12)}${R(0, 0, w, h, o.rx || 12, o.fill || C.paper, o.stroke ? `stroke="${o.stroke}" stroke-width="2"` : '')}${inner}</g>`;
  /** A dark glass card. */
  const glass = (x, y, w, h, inner = '', o = {}) => `<g transform="translate(${x} ${y})">${shadow(0, 0, w, h, o.rx || 14)}${R(0, 0, w, h, o.rx || 14, C.n1, `stroke="${o.stroke || C.line2}" stroke-width="1.5"`)}${inner}</g>`;
  const desk = (y = 214) => `<rect x="-20" y="${y}" width="400" height="${270 - y}" fill="#18301F"/><rect x="-20" y="${y}" width="400" height="2.5" fill="${C.line}"/><rect x="-20" y="${y + 2.5}" width="400" height="10" fill="${C.lime}" opacity=".05"/>`;
  const halo = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${C.n2}" opacity=".85"/><circle cx="${cx}" cy="${cy}" r="${r + 16}" fill="none" stroke="${C.lime}" stroke-opacity=".09" stroke-width="1.5"/><circle class="la-orbit" cx="${cx}" cy="${cy}" r="${r + 30}" fill="none" stroke="${C.lime}" stroke-opacity=".07" stroke-dasharray="2 9"/>`;
  const coin = (x, y, r = 9, cls = '', d = 0) => `<g class="${cls}" style="animation-delay:${d}s"><circle cx="${x}" cy="${y}" r="${r}" fill="${C.gold}"/><circle cx="${x}" cy="${y}" r="${r * 0.66}" fill="none" stroke="${C.gold2}" stroke-width="1.6"/><path d="M${x} ${y - r * 0.38}v${r * 0.76}" stroke="${C.gold2}" stroke-width="1.8" stroke-linecap="round"/></g>`;
  const tick = (x, y, r = 10, fill = C.lime, cls = '') => `<g class="${cls}"><circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/><path d="M${x - r * 0.42} ${y + r * 0.02}l${r * 0.3} ${r * 0.3} ${r * 0.56}-${r * 0.6}" stroke="${C.ink}" stroke-width="${Math.max(1.8, r * 0.22)}" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
  const pin = (x, y, d = 0, col = C.lime) => `<g transform="translate(${x} ${y})"><circle class="la-ping" r="9" fill="${col}" opacity=".35" style="animation-delay:${d}s"/><circle r="4.5" fill="${col}"/><circle r="1.8" fill="${C.ink}"/></g>`;
  /** Small icon on a tile, using the chip icon set. */
  const glyph = (k, x, y, size = 22, col = C.ink) => `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[k] || IC.spark}</svg>`;
  const bubble = (x, y, w, h, fill = C.paper, inner = '', cls = 'la-pop', d = 0, tail = 'l') => `<g class="${cls}" style="animation-delay:${d}s"><g transform="translate(${x} ${y})">${R(0, 0, w, h, h / 2 > 14 ? 14 : h / 2, fill)}<path d="${tail === 'l' ? `M14 ${h - 1}l-4 9 12-9z` : `M${w - 14} ${h - 1}l4 9-12-9z`}" fill="${fill}"/>${inner}</g></g>`;
  const lay = (b, m, f = '') => `<g class="la-l1"><g class="la-d1">${b}</g></g><g class="la-l2">${m}</g><g class="la-l3"><g class="la-d3">${f}</g></g>`;
  /** A browser window. */
  const browser = (x, y, w, h, inner = '') => card(x, y, w, h, `${R(0, 0, w, 18, 12, C.paper2)}${R(0, 10, w, 8, 0, C.paper2)}<circle cx="11" cy="9" r="2.6" fill="${C.paper3}"/><circle cx="19" cy="9" r="2.6" fill="${C.paper3}"/><circle cx="27" cy="9" r="2.6" fill="${C.paper3}"/>${R(38, 5, w - 50, 8, 4, C.paper)}${inner}`);
  /** A phone (frame + screen); inner is drawn in screen coordinates (w-8 × h-14). */
  const phone = (x, y, w, h, inner = '') => `<g transform="translate(${x} ${y})">${shadow(0, 0, w, h, 16)}${R(0, 0, w, h, 16, '#0A140F', `stroke="${C.line2}" stroke-width="1.5"`)}<svg x="4" y="8" width="${w - 8}" height="${h - 14}" viewBox="0 0 ${w - 8} ${h - 14}">${R(0, 0, w - 8, h - 14, 11, C.paper)}${inner}</svg>${R(w / 2 - 10, 3, 20, 3, 1.5, '#22362B')}</g>`;

  /* ---------------- chip icon set (24 × 24, stroke) ---------------- */
  const IC = {
    spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
    coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.9-2.8 2.1 0 2.9 5.8 1.4 5.8 4.3 0 1.2-1.3 2.1-3 2.1-1.3 0-2.5-.6-3-1.5M12 6v1.8M12 16.3V18"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16l4-5 3 3 5-7"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".9" fill="currentColor"/>',
    server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/>',
    page: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8.5h18M7 13h10M7 16.5h6"/>',
    plane: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    camera: '<rect x="3" y="7" width="13" height="11" rx="2.5"/><path d="M16 11l5-3v9l-5-3"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
    calc: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/>',
    stairs: '<path d="M4 20h4v-4h4v-4h4V8h4V4"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    people: '<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.8 5.5-4.8s4.9 1.8 5.5 4.8"/><circle cx="17" cy="8" r="2.6"/><path d="M15.5 13.6c2.4-.3 4.4 1.2 5 4.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    check: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.3l2.7 2.7L16 9.5"/>',
    candles: '<path d="M6 4v16M12 3v18M18 6v12"/><rect x="4" y="8" width="4" height="7" rx="1"/><rect x="10" y="6" width="4" height="6" rx="1"/><rect x="16" y="9" width="4" height="5" rx="1"/>',
    ticket: '<path d="M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2.5 2.5 0 0 0 0 5v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2.5 2.5 0 0 0 0-5z"/><path d="M14 5v14" stroke-dasharray="2 2.5"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
    bottle: '<path d="M9.5 3h5M10 3v3.5c-2 1-3 2.5-3 4.5v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-8c0-2-1-3.5-3-4.5V3"/><path d="M7 13h10"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S9 9 12 9zM12 9c2-4 6-4 6-1.5S15 9 12 9z"/>',
    form: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
    phone: '<rect x="7" y="3" width="10" height="18" rx="2.5"/><path d="M11 18h2"/>',
    book: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
    globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
    funnel: '<path d="M4 5h16l-6 7.5V19l-4-2v-4.5z"/>',
    hub: '<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="M6.6 6.6l3.3 3.3M17.4 6.6l-3.3 3.3M6.6 17.4l3.3-3.3M17.4 17.4l-3.3-3.3"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    cursor: '<path d="M6 3l12 6-5.5 1.5L11 16z"/><path d="M13 13l5 5"/>',
    mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M4 7l8 6 8-6"/>',
    ad: '<path d="M4 10v4a1 1 0 0 0 1 1h2l7 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
    store: '<path d="M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16"/><path d="M10 20v-5h4v5"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
  };
  const iconSvg = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[k] || IC.spark}</svg>`;

  /* ================================================================
   * SCENES (360 × 240). Each returns lay(back, middle, front).
   * ================================================================ */
  const SCENES = {
    /* The five players */
    brand: () => lay(
      halo(118, 150, 86),
      `${browser(196, 34, 142, 150, `${R(10, 26, 122, 58, 9, C.n2)}<path d="M54 74l18-30 18 30z" fill="${C.green}" opacity=".9"/><circle cx="96" cy="44" r="8" fill="${C.lime}"/>${line(10, 94, 90, C.paper3)}${line(10, 106, 64)}${R(10, 120, 60, 18, 9, C.ink)}${R(18, 127, 44, 4, 2, C.lime)}`)}${stand('ada', 'point', 112, 1.02)}`,
      `<g class="la-float" style="animation-delay:-1s">${card(258, 154, 92, 40, `${R(9, 9, 22, 22, 7, C.lime)}${glyph('ad', 12, 12, 16)}${line(38, 12, 44, C.paper3)}${line(38, 23, 30)}`)}</g>`),
    hub: () => {
      const nodes = [['ada', 60, 62], ['you', 300, 62], ['zara', 62, 168], ['tunde', 298, 168]];
      const cx = 180, cy = 112;
      return lay(
        `${halo(cx, cy, 70)}${nodes.map(([, x, y]) => `<path d="M${cx} ${cy}L${x} ${y}" stroke="${C.line2}" stroke-width="2" stroke-dasharray="3 6"/>`).join('')}`,
        `${nodes.map(([k, x, y], i) => `<circle class="la-dot" cx="${cx}" cy="${cy}" r="4" fill="${C.lime}" style="--dx:${x - cx}px;--dy:${y - cy}px;animation-delay:${i * 0.55}s"/>`).join('')}
         ${nodes.map(([k, x, y]) => `<g transform="translate(${x - 24} ${y - 24})"><circle cx="24" cy="24" r="27" fill="${C.n1}" stroke="${C.line2}" stroke-width="1.5"/><svg width="48" height="48" viewBox="0 0 64 64">${faceChip(k).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg></g>`).join('')}
         <g transform="translate(${cx - 34} ${cy - 34})">${shadow(0, 0, 68, 68, 20)}${R(0, 0, 68, 68, 20, C.lime)}<g class="la-pulse">${glyph('hub', 16, 16, 36, C.ink)}</g></g>`,
        `<g class="la-float">${card(cx + 46, cy - 70, 40, 24, `${R(7, 7, 10, 10, 3, C.green)}${line(21, 9, 13, C.paper3)}`)}</g>`);
    },
    laptop: () => lay(
      `${halo(180, 130, 82)}<g class="la-float" style="animation-delay:-2s">${glass(30, 40, 104, 70, `<path class="la-draw" pathLength="1" d="M12 54L32 40L48 46L68 24L92 16" fill="none" stroke="${C.lime}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>${line(12, 12, 40, C.line2)}`)}</g>`,
      `${desk()}${seated('you', 180, 214)}`,
      `<g class="la-float">${card(240, 44, 96, 34, `${R(8, 8, 18, 18, 6, C.n2)}${glyph('link', 10, 10, 14, C.lime)}${line(32, 11, 50, C.paper3)}${line(32, 21, 34)}`)}</g>${bubble(256, 96, 82, 28, C.lime, `${tick(15, 14, 7, C.ink)}${line(28, 11, 44, C.ink, 6)}`, 'la-pop', 0.6, 'l')}`),
    feed: () => lay(
      halo(206, 124, 84),
      `${phone(150, 18, 112, 214, `<g class="la-feed">${[0, 1].map((k) => `<g transform="translate(0 ${k * 196})">${R(8, 8, 88, 52, 8, C.paper2)}${line(8, 66, 70, C.paper3)}${line(8, 77, 50)}${R(8, 92, 88, 64, 8, C.n2)}${R(8, 92, 88, 14, 7, C.lime)}${line(14, 97, 30, C.ink, 4)}<path d="M44 140l12-20 12 20z" fill="${C.green}"/>${R(8, 162, 88, 10, 5, C.ink)}${line(8, 178, 64, C.paper3)}</g>`).join('')}</g>`)}${stand('zara', 'point', 84, 0.98, { dy: 4 })}`,
      `<g class="la-float" style="animation-delay:-1.4s">${card(272, 54, 74, 30, `${glyph('eye', 9, 6, 18, C.ink)}${line(32, 9, 32, C.paper3)}${line(32, 18, 22)}`)}</g><g class="la-float" style="animation-delay:-3s">${card(276, 150, 66, 30, `${glyph('cursor', 9, 6, 18, C.ink)}${line(32, 12, 24, C.lime)}`)}</g>`),
    phoneuser: () => lay(
      halo(170, 140, 84),
      `${stand('tunde', 'phone', 170, 1.08, { dy: 2 })}`,
      `${bubble(232, 52, 106, 40, C.paper, `${R(9, 9, 22, 22, 7, C.green)}${glyph('plane', 12, 12, 16, '#fff')}${line(38, 11, 54, C.paper3)}${line(38, 22, 38)}`, 'la-pop', 0.3, 'l')}<g class="la-float" style="animation-delay:-2s">${card(24, 70, 84, 34, `${tick(17, 17, 9)}${line(32, 11, 40, C.paper3)}${line(32, 21, 28)}`)}</g>`),

    /* Money */
    payout: () => lay(
      `${halo(250, 140, 74)}${glass(24, 58, 108, 92, `${R(12, 12, 28, 28, 9, C.lime)}${glyph('hub', 15, 15, 22)}${line(48, 16, 46, C.line2)}${line(48, 28, 30, C.line2)}${[0, 1, 2, 3, 4].map((k) => R(12 + k * 18, 54, 13, 22, 4, k < 3 ? C.n3 : C.lime, k < 3 ? '' : 'opacity=".85"')).join('')}`)}<path d="M138 104C170 92 196 92 214 106" fill="none" stroke="${C.line2}" stroke-width="2" stroke-dasharray="3 6"/>`,
      `${[0, 1, 2].map((k) => `<g class="la-slide" style="--dx:72px;--dy:12px;animation-delay:${k * 0.9}s">${coin(140, 96, 8)}</g>`).join('')}${stand('you', 'hold', 252, 0.98, { item: `<g>${R(46, 128, 48, 34, 9, C.ink)}${R(46, 128, 48, 12, 6, '#24382D')}${R(74, 140, 20, 12, 5, C.gold)}</g>` })}`,
      `${bubble(266, 54, 80, 30, C.lime, `${glyph('coin', 8, 4, 22)}${line(36, 12, 34, C.ink)}`, 'la-pop', 1.2)}`),
    wallet: () => lay(
      halo(160, 140, 84),
      `${stand('tunde', 'hold', 156, 1.04, { item: `${R(42, 120, 56, 40, 10, C.ink)}${R(42, 120, 56, 14, 7, '#24382D')}${R(72, 136, 26, 14, 6, C.gold)}<circle cx="80" cy="143" r="2.5" fill="${C.ink}"/>` })}`,
      `${[0, 1, 2].map((k) => `<g class="la-drop" style="animation-delay:${k * 0.8}s">${coin(156 + (k - 1) * 14, 92, 9)}</g>`).join('')}<g class="la-float">${card(248, 70, 92, 46, `${line(12, 10, 40, C.paper3)}${R(12, 22, 54, 12, 6, C.green)}${R(12, 22, 34, 12, 6, C.lime)}`)}</g>${card(30, 120, 76, 30, `${glyph('coin', 8, 4, 22, C.gold2)}${line(36, 12, 30, C.paper3)}`)}`),
    models: () => lay(
      `${glass(26, 42, 140, 156, `${line(14, 14, 54, C.line2)}${[0, 1, 2, 3].map((k) => `<g transform="translate(70 ${120 - k * 12})"><ellipse rx="22" ry="7" fill="${C.gold2}"/><ellipse cy="-3" rx="22" ry="7" fill="${C.gold}"/></g>`).join('')}${line(14, 136, 80, C.line2)}`)}${glass(194, 42, 140, 156, `${line(14, 14, 64, C.line2)}${[0, 1, 2, 3, 4, 5].map((k) => `<g class="la-grow" style="animation-delay:${k * 0.35}s">${R(10 + k * 20, 128 - 16 - k * 10, 14, 16 + k * 10, 4, k % 2 ? C.lime : C.green)}</g>`).join('')}${line(14, 136, 90, C.line2)}`)}`,
      `<circle cx="180" cy="120" r="18" fill="${C.ink}" stroke="${C.line2}" stroke-width="1.5"/><path d="M172 120h16M180 112v16" stroke="${C.lime}" stroke-width="2.4" stroke-linecap="round" transform="rotate(45 180 120)"/>`,
      `<g class="la-float">${coin(150, 52, 11)}</g><g class="la-float" style="animation-delay:-2s">${coin(318, 60, 8)}</g>`),
    budget: () => lay(
      `${halo(118, 140, 80)}<g class="la-float" style="animation-delay:-1s">${card(214, 34, 110, 150, `${R(12, 12, 86, 32, 8, C.ink)}${line(52, 25, 38, C.lime, 7)}${[0, 1, 2].map((r) => [0, 1, 2].map((q) => R(12 + q * 30, 54 + r * 30, 24, 22, 7, r === 2 && q === 2 ? C.lime : C.paper2)).join('')).join('')}`)}</g>`,
      `${stand('you', 'think', 114, 1.02)}`,
      `${[0, 1, 2, 3].map((k) => `<g transform="translate(330 ${206 - k * 9})"><ellipse rx="18" ry="6" fill="${C.gold2}"/><ellipse cy="-3" rx="18" ry="6" fill="${C.gold}"/></g>`).join('')}`),

    /* Data */
    dashboard: () => lay(
      halo(160, 120, 90),
      `${desk(208)}<g transform="translate(46 30)">${shadow(0, 0, 220, 146, 12)}${R(0, 0, 220, 146, 12, '#0A140F', `stroke="${C.line2}" stroke-width="1.5"`)}${R(8, 8, 204, 130, 7, C.paper)}${[0, 1, 2].map((k) => `${R(16 + k * 64, 16, 56, 30, 6, k === 1 ? C.lime : C.paper2)}${line(22 + k * 64, 24, 26, k === 1 ? C.ink : C.paper3, 4)}${line(22 + k * 64, 34, 38, k === 1 ? C.ink : C.paper3, 5)}`).join('')}<path d="M16 120L52 96L84 104L120 74L156 82L196 56" fill="none" stroke="${C.paper2}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/><path class="la-draw" pathLength="1" d="M16 120L52 96L84 104L120 74L156 82L196 56" fill="none" stroke="${C.green}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><circle class="la-ping" cx="196" cy="56" r="6" fill="${C.green}" opacity=".4"/></g>${R(140, 176, 32, 34, 4, '#0A140F')}${R(118, 204, 76, 6, 3, '#0A140F')}${stand('sam', 'point', 300, 0.92, { dy: 6 })}`),
    tracking: () => lay(
      `${halo(180, 120, 76)}<path class="la-dash" d="M120 110C150 70 210 70 238 110" fill="none" stroke="${C.lime}" stroke-opacity=".6" stroke-width="2" stroke-dasharray="4 7"/>`,
      `${browser(22, 70, 118, 100, `${R(10, 28, 98, 32, 7, C.n2)}${line(10, 68, 70, C.paper3)}${line(10, 80, 50)}<g class="la-pulse">${R(90, 78, 12, 12, 3, C.lime)}</g>`)}<g transform="translate(244 74)"><circle class="la-ping" cx="44" cy="44" r="40" fill="${C.lime}" opacity=".18"/><circle cx="44" cy="44" r="44" fill="${C.n1}" stroke="${C.line2}" stroke-width="1.5"/>${glyph('target', 16, 16, 56, C.lime)}</g><circle class="la-dot" cx="132" cy="104" r="4.5" fill="${C.lime}" style="--dx:112px;--dy:2px"/>`,
      `<g class="la-float">${card(132, 156, 98, 34, `${R(8, 8, 18, 18, 6, C.ink)}${glyph('link', 10, 10, 14, C.lime)}${line(32, 11, 54, C.paper3)}${line(32, 21, 36)}`)}</g>`),
    postback: () => lay(
      `<path d="M98 82C150 30 210 30 262 82" fill="none" stroke="${C.line2}" stroke-width="2" stroke-dasharray="3 7"/><path d="M98 150C150 196 210 196 262 150" fill="none" stroke="${C.lime}" stroke-opacity=".55" stroke-width="2" stroke-dasharray="3 7"/>`,
      `${[[30, 'hub'], [262, 'chart']].map(([x, g]) => `<g transform="translate(${x} 60)">${shadow(0, 0, 68, 118, 14)}${R(0, 0, 68, 118, 14, C.n1, `stroke="${C.line2}" stroke-width="1.5"`)}${[0, 1, 2].map((k) => `${R(10, 12 + k * 26, 48, 18, 5, C.n3)}<circle class="la-blinkdot" cx="20" cy="${21 + k * 26}" r="2.6" fill="${C.lime}" style="animation-delay:${k * 0.4}s"/>${line(28, 18 + k * 26, 22, C.line2, 5)}`).join('')}${R(18, 90, 32, 18, 6, C.lime)}${glyph(g, 25, 90, 18)}</g>`).join('')}<circle class="la-dot" cx="252" cy="160" r="5" fill="${C.lime}" style="--dx:-144px;--dy:0px"/><circle class="la-dot" cx="108" cy="72" r="4" fill="${C.mint}" style="--dx:144px;--dy:0px;animation-delay:1.1s"/>`,
      `${tick(180, 186, 13, C.lime, 'la-popc')}`),
    landing: () => lay(
      halo(206, 120, 80),
      `${browser(120, 26, 214, 176, `${R(12, 28, 190, 64, 9, C.n2)}<path d="M80 82l22-34 22 34z" fill="${C.green}"/><circle cx="150" cy="48" r="9" fill="${C.lime}"/>${line(12, 102, 140, C.ink, 8)}${line(12, 116, 110, C.paper3)}${line(12, 128, 86, C.paper3)}<g class="la-cta">${R(12, 144, 100, 22, 11, C.lime)}${line(34, 152, 56, C.ink, 5)}</g>`)}<g class="la-cursor"><path d="M0 0l15 7.5-6.5 1.8L6.5 16z" transform="translate(206 168)" fill="#fff" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/></g>${stand('amina', 'rest', 74, 0.96, { dy: 6 })}`),
    telegram: () => lay(
      halo(196, 124, 84),
      `${phone(142, 14, 118, 220, `${R(0, 0, 110, 30, 0, C.paper2)}<circle cx="18" cy="15" r="9" fill="#2AABEE"/>${glyph('plane', 11, 8, 14, '#fff')}${line(32, 9, 44, C.ink, 5)}${line(32, 18, 28, C.paper3, 4)}${[[8, 42, 70, 0], [32, 78, 70, 1], [8, 114, 62, 0], [40, 150, 62, 1]].map(([x, y, w, me], k) => `<g class="la-msg" style="animation-delay:${k * 0.7}s">${R(x, y, w, 26, 10, me ? '#DDF7C8' : '#fff', me ? '' : `stroke="${C.paper2}"`)}${line(x + 8, y + 8, w - 22, C.paper3, 4)}${line(x + 8, y + 16, w - 34, C.paper3, 4)}</g>`).join('')}`)}${stand('kofi', 'wave', 70, 0.96, { dy: 4 })}`,
      `<g class="la-float">${card(276, 46, 70, 30, `<circle cx="16" cy="15" r="8" fill="#2AABEE"/>${glyph('people', 9, 8, 14, '#fff')}${line(30, 12, 30, C.paper3)}`)}</g>`),
    creative: () => lay(
      `<circle cx="120" cy="104" r="76" fill="none" stroke="${C.paper}" stroke-opacity=".14" stroke-width="10"/><circle cx="120" cy="104" r="76" fill="${C.n2}" opacity=".7"/>`,
      `${stand('amina', 'wave', 120, 1.02)}<g transform="translate(250 40)"><path d="M30 120L6 196M30 120L54 196M30 120V200" stroke="${C.line2}" stroke-width="4" stroke-linecap="round"/>${shadow(0, 0, 60, 112, 12)}${R(0, 0, 60, 112, 12, '#0A140F', `stroke="${C.line2}" stroke-width="1.5"`)}${R(5, 8, 50, 96, 8, C.n2)}<path d="M15 30h8M15 30v8M45 30h-8M45 30v8M15 82h8M15 82v-8M45 82h-8M45 82v-8" stroke="${C.paper}" stroke-width="1.6" opacity=".7"/><circle class="la-rec" cx="46" cy="18" r="4" fill="#FF5A4E"/></g>`,
      `<g class="la-float">${card(212, 168, 70, 30, `${glyph('camera', 9, 5, 20, C.ink)}${line(36, 12, 24, C.paper3)}`)}</g>`),
    abtest: () => lay(
      '',
      `${stand('sam', 'think', 74, 0.96, { dy: 4 })}${['A', 'B'].map((t, k) => `<g transform="translate(${158 + k * 98} 36)">${shadow(0, 0, 84, 150, 12)}${R(0, 0, 84, 150, 12, C.paper, k ? `stroke="${C.lime}" stroke-width="3"` : '')}${R(8, 8, 68, 58, 8, k ? C.n2 : C.paper2)}<text x="42" y="44" text-anchor="middle" font-family="JetBrains Mono, monospace" font-weight="700" font-size="18" fill="${k ? C.lime : C.paper3}">${t}</text>${line(8, 76, 56, C.paper3)}${R(8, 100, 68, 10, 5, C.paper2)}<g class="la-grow x" style="animation-delay:${0.3 + k * 0.4}s">${R(8, 100, k ? 60 : 30, 10, 5, k ? C.green : C.paper3)}</g>${line(8, 120, 40, C.paper3)}</g>`).join('')}`,
      `${tick(334, 40, 13, C.lime, 'la-popc')}`),

    /* Plan, scale, rules */
    growth: () => lay(
      halo(140, 140, 80),
      `${desk()}${[0, 1, 2, 3, 4].map((k) => `<g class="la-grow" style="animation-delay:${k * 0.25}s">${R(28 + k * 34, 190 - k * 28, 26, 24 + k * 28, 6, k === 4 ? C.lime : k > 1 ? C.green : C.n3)}</g>`).join('')}<path class="la-draw" pathLength="1" d="M40 170L74 144L108 118L142 90L176 62" fill="none" stroke="${C.lime}" stroke-width="2.4" stroke-dasharray="1 0" stroke-linecap="round"/>${seated('you', 274, 214, 0.92)}`,
      `<g class="la-float">${card(196, 30, 62, 28, `${glyph('stairs', 8, 4, 20, C.green)}${line(34, 11, 20, C.paper3)}`)}</g>`),
    shield: () => lay(
      halo(212, 120, 84),
      `<g transform="translate(176 38)"><path d="M48 0l48 18v34c0 32-21 56-48 70C21 108 0 84 0 52V18z" fill="${C.n1}" stroke="${C.lime}" stroke-width="3"/><path class="la-draw" pathLength="1" d="M28 60l14 14 28-28" fill="none" stroke="${C.lime}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></g>${stand('ada', 'hold', 92, 1, { item: `${R(48, 112, 44, 54, 6, C.paper)}${R(60, 108, 20, 8, 3, C.paper3)}${line(55, 126, 30, C.paper3, 4)}${line(55, 136, 24, C.paper3, 4)}${tick(80, 152, 6)}` })}`,
      `<g class="la-float">${card(276, 150, 70, 46, `${line(10, 10, 46, C.paper3)}${line(10, 20, 34)}<circle cx="52" cy="32" r="9" fill="none" stroke="${C.green}" stroke-width="2.4"/>`)}</g>`),
    warning: () => lay(
      `<circle class="la-ping" cx="236" cy="104" r="60" fill="${C.coral}" opacity=".16"/>${halo(236, 104, 62).replace(/fill="#163423"/, 'fill="#2A2618"')}`,
      `<g transform="translate(196 62)"><path d="M40 4l40 70H0z" fill="${C.coral}" stroke="${C.coral}" stroke-width="8" stroke-linejoin="round"/><path d="M40 30v20M40 60v.5" stroke="#2A1206" stroke-width="7" stroke-linecap="round"/></g>${stand('kofi', 'halt', 96, 1.02)}`,
      `<g class="la-float">${card(270, 172, 76, 30, `${R(8, 8, 14, 14, 4, C.coral)}${line(28, 12, 38, C.paper3)}`)}</g>`),
    checklist: () => lay(
      halo(110, 136, 80),
      `${desk()}${seated('you', 112, 214)}`,
      `<g class="la-float" style="animation-delay:-1s">${card(206, 28, 130, 168, `${R(42, -6, 46, 14, 5, C.paper3)}${[0, 1, 2, 3].map((k) => `${R(14, 22 + k * 34, 22, 22, 7, C.paper2)}<g class="la-tick" style="animation-delay:${0.4 + k * 0.6}s">${tick(25, 33 + k * 34, 11)}</g>${line(44, 27 + k * 34, 70, C.paper3)}${line(44, 38 + k * 34, 46)}`).join('')}`)}</g>`),
    certificate: () => lay(
      `${halo(120, 130, 84)}${[0, 1, 2, 3, 4, 5, 6, 7].map((k) => `<path class="la-ray" d="M120 34v-16" transform="rotate(${k * 45} 120 130)" stroke="${C.lime}" stroke-width="2.4" stroke-linecap="round" style="animation-delay:${k * 0.15}s"/>`).join('')}`,
      `${stand('you', 'cheer', 120, 1)}<g transform="translate(206 42)">${shadow(0, 0, 136, 104, 10)}${R(0, 0, 136, 104, 10, C.paper)}${R(6, 6, 124, 92, 7, 'none', `stroke="${C.gold}" stroke-width="1.5"`)}${line(30, 22, 76, C.ink, 7)}${line(40, 36, 56, C.paper3)}${line(24, 56, 88, C.paper2)}${line(32, 66, 72, C.paper2)}<g transform="translate(108 84)"><path d="M-8 6l-5 18 9-5 4 8 4-20zM8 6l5 18-9-5-4 8-4-20z" fill="${C.green}"/><circle r="13" fill="${C.gold}"/><circle r="8.5" fill="none" stroke="${C.gold2}" stroke-width="1.6"/></g></g>`),
    clock: () => lay(
      halo(250, 110, 74),
      `<g transform="translate(206 36)">${shadow(0, 0, 112, 104, 14)}${R(0, 0, 112, 104, 14, C.paper)}${R(0, 0, 112, 26, 14, C.lime)}${R(0, 14, 112, 12, 0, C.lime)}${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((k) => R(10 + (k % 4) * 24, 34 + Math.floor(k / 4) * 22, 18, 16, 4, k === 6 ? C.green : C.paper2, k < 6 ? 'opacity=".55"' : '')).join('')}</g><g transform="translate(216 168)"><circle r="30" fill="${C.n1}" stroke="${C.lime}" stroke-width="3"/><path class="la-hand" d="M0 0V-20" stroke="${C.lime}" stroke-width="3.5" stroke-linecap="round"/><path d="M0 0h13" stroke="${C.paper}" stroke-width="3" stroke-linecap="round"/><circle r="3.5" fill="${C.lime}"/></g>${stand('kofi', 'think', 98, 1)}`),
    funnel: () => lay(
      halo(140, 120, 80),
      `<g transform="translate(64 34)"><path d="M0 0h152l-52 74v62l-48-18V74z" fill="${C.n1}" stroke="${C.line2}" stroke-width="2" stroke-linejoin="round"/><path d="M10 6h132" stroke="${C.lime}" stroke-width="3" stroke-linecap="round" opacity=".7"/>${[0, 1, 2, 3, 4].map((k) => `<circle class="la-fall" cx="${30 + k * 24}" cy="-6" r="4.5" fill="${k === 2 ? C.lime : C.mint}" style="--fx:${(76 - (30 + k * 24))}px;animation-delay:${k * 0.45}s"/>`).join('')}</g>${stand('sam', 'point', 290, 0.94, { dy: 4, flip: false })}`,
      `${tick(140, 196, 12, C.lime, 'la-popc')}`),
    talk: () => lay(
      `${halo(110, 140, 66)}${halo(250, 140, 66)}`,
      `${stand('you', 'rest', 104, 0.92, { dy: 6 })}${stand('kofi', 'rest', 256, 0.92, { dy: 6, flip: true, d: -1.2 })}`,
      `${bubble(40, 40, 110, 40, C.paper, `${line(12, 12, 80, C.paper3)}${line(12, 23, 54)}`, 'la-pop', 0, 'r')}${bubble(206, 26, 116, 40, C.lime, `${line(12, 12, 86, C.ink)}${line(12, 23, 60, C.ink)}`, 'la-pop', 1.6, 'l')}`),
    team: () => lay(
      `<rect x="0" y="20" width="360" height="120" fill="none"/>${bubble(146, 22, 72, 30, C.paper, `${line(12, 12, 48, C.paper3)}`, 'la-pop', 0.5)}`,
      `${desk(214)}${seated('ada', 66, 214, 0.86, { d: -0.6 })}${seated('you', 180, 214, 0.96, { pose: 'wave' })}<g transform="translate(${180 - 70 * 0.96} ${218 - 168 * 0.96}) scale(.96)">${laptopBack}</g>${seated('kofi', 294, 214, 0.86, { d: -1.4 })}`,
      ''),
    audience: () => {
      const keys = ['ada', 'tunde', 'zara', 'amina', 'kofi', 'sam', 'nia', 'you'];
      return lay(
        '',
        `${keys.map((k, i) => { const x = 46 + (i % 4) * 72, y = 50 + Math.floor(i / 4) * 86; return `<g transform="translate(${x} ${y})" class="${i === 5 ? '' : 'la-dim'}"><circle cx="28" cy="28" r="30" fill="${C.n1}" stroke="${C.line2}" stroke-width="1.5"/><svg width="56" height="56" viewBox="0 0 64 64">${faceChip(k).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg></g>`; }).join('')}`,
        `<g transform="translate(${46 + 72 + 28} ${50 + 86 + 28})"><circle class="la-ping" r="38" fill="none" stroke="${C.lime}" stroke-width="2"/><circle r="38" fill="none" stroke="${C.lime}" stroke-width="2.5"/><path d="M-46 0h12M34 0h12M0 -46v12M0 34v12" stroke="${C.lime}" stroke-width="2.5" stroke-linecap="round"/></g>`);
    },
    auction: () => lay(
      halo(100, 150, 70),
      `${desk()}${seated('you', 96, 214, 0.9)}${[0, 1, 2].map((k) => `<g class="la-bid" style="animation-delay:${k * 0.8}s">${card(182 + k * 58, 60 + [20, 0, 30][k], 50, 70, `${R(6, 6, 38, 30, 6, k === 1 ? C.n2 : C.paper2)}${line(6, 44, 30, C.paper3)}${R(6, 54, 30, 10, 5, k === 1 ? C.lime : C.paper2)}`)}</g>`).join('')}`,
      `${bubble(232, 24, 66, 26, C.lime, `${glyph('coin', 6, 3, 20)}${line(32, 10, 22, C.ink)}`, 'la-pop', 0.8)}`),
    fraud: () => lay(
      halo(110, 134, 76),
      `${card(176, 34, 156, 160, `${line(14, 14, 60, C.ink, 7)}${[0, 1, 2, 3, 4].map((k) => `${R(12, 34 + k * 24, 132, 18, 6, k === 2 ? '#FFE3D3' : C.paper2)}${R(18, 40 + k * 24, 6, 6, 2, k === 2 ? C.coral : C.green)}${line(30, 40 + k * 24, 70, k === 2 ? C.coral : C.paper3, 5)}`).join('')}`)}<g class="la-scan"><g transform="translate(226 104)"><circle r="20" fill="#fff" fill-opacity=".14" stroke="${C.ink}" stroke-width="5"/><path d="M14 14l16 16" stroke="${C.ink}" stroke-width="7" stroke-linecap="round"/></g></g>${stand('sam', 'rest', 96, 0.98, { dy: 4 })}`),

    /* Places */
    africa: () => lay(
      '',
      `<g transform="translate(40 14) scale(.98)"><path d="M34.8 3.6L23.8 16.5L14.5 28.5L2.9 48L1.7 66.9L8.7 78L14.5 85.5L21.8 92.1L30.4 97.8L46.4 96.6L55.1 93L62.1 91.8L69.6 98.1L79.8 99.3L79.2 111L86.4 123L89.9 138L87 162L94.3 179.7L97.1 192L105.6 213.6L110.2 215.4L126.4 213L133.4 209.1L142.1 200.4L147.6 189L155.2 183L153.7 171L169.7 156L169.7 142.5L166.2 131.4L167.3 123L174 112.5L185.6 105L194.3 93L200.7 75.6L179.8 79.5L177.8 76.2L165.3 64.2L160.4 54L153.7 39L146.4 21.3L145.9 17.1L139.2 16.8L124.7 15.6L110.2 18L107.3 20.1L97.1 15L84.1 11.4L82.6 0L60.9 .6L47.9 5.1Z" fill="${C.n2}" stroke="${C.line2}" stroke-width="2" stroke-linejoin="round"/><path d="M195.2 147L198.7 157.5L188.5 186L179.8 181.5L180.7 162L188.5 156Z" fill="${C.n2}" stroke="${C.line2}" stroke-width="2" stroke-linejoin="round"/>${pin(62.1, 91.5, 0)}${pin(51.6, 94.2, 0.5)}${pin(85.5, 99.3, 1)}${pin(158.9, 114.9, 1.5)}${pin(133.4, 189.6, 2)}<path class="la-dash" d="M62 91C90 70 130 80 158 114" fill="none" stroke="${C.lime}" stroke-opacity=".5" stroke-width="1.6" stroke-dasharray="3 6"/></g>${stand('zara', 'phone', 300, 0.86, { dy: 8 })}`),
    globe: () => lay(
      '',
      `<g transform="translate(130 120)"><defs><clipPath id="lag${sceneN}"><circle r="91"/></clipPath></defs><circle r="92" fill="${C.n2}" stroke="${C.line2}" stroke-width="2"/><g clip-path="url(#lag${sceneN})"><g class="la-spin">${[-2, -1, 0, 1, 2, 3, 4].map((k) => `<ellipse cx="${k * 60}" cy="0" rx="34" ry="92" fill="none" stroke="${C.lime}" stroke-opacity=".22" stroke-width="1.5"/>`).join('')}</g></g><path d="M-92 0h184M-80 -46h160M-80 46h160" stroke="${C.lime}" stroke-opacity=".18" stroke-width="1.5"/>${pin(-30, -20, 0)}${pin(36, 8, 0.7)}${pin(-6, 52, 1.4)}${pin(58, -44, 2.1, C.mint)}</g>${stand('nia', 'point', 300, 0.9, { dy: 6 })}`),

    /* Verticals */
    trading: () => lay(
      halo(250, 130, 78),
      `${glass(26, 30, 196, 140, `${[0, 1, 2, 3].map((k) => line(14, 18 + k * 30, 168, C.n3, 2)).join('')}${[[22, 70, 30, 1], [44, 60, 34, 0], [66, 52, 26, 1], [88, 44, 34, 1], [110, 58, 20, 0], [132, 36, 34, 1], [154, 26, 30, 1]].map(([x, y, h, up], k) => `<g class="la-grow" style="animation-delay:${k * 0.2}s"><path d="M${x + 6} ${y - 8}v${h + 16}" stroke="${up ? C.green : C.coral}" stroke-width="2"/>${R(x, y, 12, h, 3, up ? C.green : C.coral)}</g>`).join('')}<path class="la-draw" pathLength="1" d="M18 100L50 86L72 90L94 70L116 76L138 56L170 40" fill="none" stroke="${C.lime}" stroke-width="2.5" stroke-linecap="round"/>`)}${desk()}${seated('you', 270, 214, 0.9)}`,
      `<g class="la-float">${card(160, 168, 74, 30, `${R(8, 8, 14, 14, 4, C.green)}${line(28, 12, 36, C.paper3)}`)}</g>`),
    sports: () => lay(
      halo(116, 140, 80),
      `${stand('tunde', 'cheer', 116, 1)}<g class="la-float" style="animation-delay:-1s"><g transform="translate(206 44)">${shadow(0, 0, 136, 112, 14)}${R(0, 0, 136, 112, 14, C.paper)}${R(0, 0, 136, 30, 14, C.n2)}${R(0, 16, 136, 14, 0, C.n2)}${line(12, 12, 50, C.lime, 6)}<circle cx="34" cy="58" r="14" fill="${C.sky}"/><circle cx="102" cy="58" r="14" fill="${C.coral}"/>${line(58, 55, 20, C.paper3)}${[0, 1, 2].map((k) => R(12 + k * 40, 84, 32, 16, 6, k === 1 ? C.lime : C.paper2)).join('')}<path d="M90 30v82" stroke="${C.paper2}" stroke-dasharray="3 4"/></g></g><g transform="translate(300 176)"><circle r="20" fill="${C.n1}" stroke="${C.coral}" stroke-width="2.5"/><text y="5" text-anchor="middle" font-family="Plus Jakarta Sans, sans-serif" font-weight="800" font-size="13" fill="${C.coral}">18+</text></g>`,
      `<g class="la-roll"><g transform="translate(206 186)"><circle r="14" fill="#fff"/><path d="M0 -6l5.7 4.1-2.2 6.7h-7l-2.2-6.7z" fill="${C.ink}"/><path d="M0 -6V-14M5.7 -1.9L13 -4.5M3.5 4.8L8 11.5M-3.5 4.8L-8 11.5M-5.7 -1.9L-13 -4.5" stroke="${C.ink}" stroke-width="1.3"/></g></g>`),
    finance: () => lay(
      halo(110, 140, 78),
      `${desk()}${seated('ada', 110, 214, 0.94)}<g class="la-float" style="animation-delay:-1.5s"><g transform="translate(206 40) rotate(-6)">${shadow(0, 0, 126, 80, 12)}${R(0, 0, 126, 80, 12, C.n3, `stroke="${C.line2}" stroke-width="1.5"`)}${R(0, 18, 126, 14, 0, C.ink)}${R(12, 44, 22, 16, 4, C.gold)}${line(12, 66, 60, C.line2, 5)}</g></g>${card(244, 120, 96, 82, `${line(12, 12, 50, C.paper3)}<text x="12" y="52" font-family="Plus Jakarta Sans, sans-serif" font-weight="800" font-size="26" fill="${C.green}">%</text>${line(40, 34, 44, C.paper2)}${line(40, 46, 30, C.paper2)}${line(12, 64, 72, C.paper3)}`)}`),
    nutra: () => lay(
      halo(116, 140, 80),
      `${stand('amina', 'hold', 116, 1, { item: `<g>${R(42, 120, 56, 42, 4, '#C99A5B')}<path d="M42 132h56" stroke="#A97A3B" stroke-width="2"/>${R(64, 120, 12, 42, 0, '#E4C089')}</g>` })}<g transform="translate(220 40)"><g class="la-float">${shadow(0, 30, 54, 110, 12)}${R(10, 0, 34, 20, 6, C.paper3)}<path d="M0 46C0 30 10 24 16 20h22c6 4 16 10 16 26v74a10 10 0 0 1-10 10H10A10 10 0 0 1 0 120z" fill="${C.paper}"/>${R(0, 60, 54, 42, 0, C.green)}<path d="M27 70c10 0 14 8 14 16-10 0-14-8-14-16zM27 70c-10 0-14 8-14 16 10 0 14-8 14-16z" fill="${C.lime}"/></g></g>`,
      `<g class="la-float" style="animation-delay:-2s">${card(286, 150, 60, 44, `${glyph('box', 8, 10, 22, C.ink)}${line(34, 14, 18, C.paper3)}${line(34, 24, 12, C.green)}`)}</g>`),
    sweeps: () => lay(
      halo(250, 130, 74),
      `${stand('tunde', 'phone', 92, 1)}<g transform="translate(200 50)"><g class="la-lid">${R(0, 0, 112, 26, 6, C.lime)}${R(48, 0, 16, 26, 0, C.green)}<path d="M56 0c-8-20-30-18-26-4 2 6 16 6 26 4zM56 0c8-20 30-18 26-4-2 6-16 6-26 4z" fill="none" stroke="${C.green}" stroke-width="5"/></g>${R(8, 26, 96, 70, 4, C.n3)}${R(48, 26, 16, 70, 0, C.green)}</g>`,
      `<g class="la-float">${card(212, 156, 130, 46, `${glyph('mail', 10, 12, 22, C.ink)}${R(38, 12, 54, 22, 6, C.paper2)}${tick(108, 23, 10)}`)}</g>`),
  };
  // A few names the matcher may produce for the same picture.
  SCENES.network = SCENES.hub; SCENES.affiliate = SCENES.laptop; SCENES.user = SCENES.phoneuser;

  let sceneN = 0;
  /** One scene as an SVG string. */
  function scene(key) {
    const fn = SCENES[key] || SCENES.laptop;
    sceneN++;
    const body = fn();
    // Standing people are half figures: a low counter in front of them grounds the crop (desk scenes have their own).
    const floor = body.includes('fill="#18301F"') ? '' : `<rect x="-20" y="226" width="400" height="20" fill="#132A1E"/><rect x="-20" y="226" width="400" height="2" fill="${C.line}"/><rect x="-20" y="228" width="400" height="8" fill="${C.lime}" opacity=".04"/>`;
    return `<svg class="la-svg" viewBox="0 0 360 240" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" data-scene="${key}">${body}${floor}</svg>`;
  }

  /* ================================================================
   * PICKING ART
   * ================================================================ */
  /* [scene, pattern, weight]. Matched against the heading (×3), slide text (×2), lesson and module titles (×1). */
  const RULES = [
    ['brand', /\badvertis|\bbrands?\b|merchant|owns the product|product owner|\boperators?\b|\blenders?\b|\bbrokers?\b/, 2],
    ['hub', /\bnetworks?\b|connects|in the middle|middleman/, 2],
    ['laptop', /\baffiliates?\b|media buyer|\bpublisher|\byou send\b|your link/, 1.2],
    ['feed', /traffic|\bfeed\b|placement|\bmeta\b|facebook|tiktok|snapchat|instagram|\bnative\b|\bpush\b|\bpops?\b|attention|scroll|impression/, 1.4],
    ['phoneuser', /\busers?\b|real person|\bpeople\b|\bvisitors?\b|\bcustomers?\b|\binstalls?\b|\bjoins?\b|\bjoined\b|on (their|a) phone|\bmobile\b/, 1.1],
    ['payout', /\bpayouts?\b|\bpaid\b|\bpays\b|payment|pay you|\bholds?\b|invoice|net ?\d+|payment terms|approv/, 1.5],
    ['wallet', /wallet|\bcash\b|\bearn|\bprofit|\bmoney\b|revenue|income|bankroll|margin/, 1.2],
    ['models', /\bcpa\b|\bcpl\b|revshare|rev share|\bhybrid\b|\bcpi\b|\bcps\b|payout model|one-?off|recurring|lifetime/, 2],
    ['dashboard', /dashboard|\breport|\bmetrics?\b|\bkpis?\b|\bctr\b|\bcpc\b|\broas\b|\broi\b|\bepc\b|numbers|spreadsheet|\bsheet\b|weekly review|\bdata\b/, 1.3],
    ['tracking', /\bpixel|\butms?\b|click id|fbclid|tracking|tracker|\blinks?\b|sub ?ids?|attribution|event_id|\bevents?\b/, 1.6],
    ['postback', /postback|\bs2s\b|server|conversions api|\bcapi\b|\bapi\b|reports? back|dedup/, 2],
    ['landing', /landing|\blanders?\b|prelander|\bpages?\b|website|page speed|\bcta\b|advertorial|\bquiz/, 1.6],
    ['telegram', /telegram|\bchannels?\b|\bbots?\b|botfather|broadcast|\bdrips?\b|\bgroups?\b|invite link|welcome (flow|message)/, 1.8],
    ['creative', /creative|\bvideos?\b|\bhooks?\b|\bugc\b|\bangles?\b|\bformats?\b|filming|camera|thumbnail|\bvisuals?\b|creator/, 1.6],
    ['abtest', /\btests?\b|\btesting\b|a\/b|variants?|split test|experiment|sample size|winners?|losers?|iterat|sprint/, 1.5],
    ['budget', /budget|\bspend|\bcosts?\b|afford|tuition|break-?even|calculat|\bbid cap/, 1.4],
    ['growth', /\bscal(e|es|ed|ing)\b|\bgrow(th)?\b|expand|double the|duplicat|horizontal|vertical scaling|compound/, 1.6],
    ['shield', /complian|polic(y|ies)|\blaws?\b|legal|licen[cs]|regulat|authori[sz]|consent|privacy|disclos|\bhonest|\bage limit|18\+|responsible|verified|verify/, 1.3],
    ['warning', /\bwarn|\bnever\b|\bavoid|\brisks?\b|\bbann?(ed|s)?\b|restrict|\bscams?\b|\bfake\b|red flags?|\bstop\b|mistake|danger|clawback|chargeback|predatory|watch out/, 1.4],
    ['africa', /nigeria|kenya|ghana|south africa|cameroon|africa|lagos|nairobi|accra|\bgeos?\b|countr(y|ies)|west africa|east africa/, 2],
    ['globe', /global|\bworld|tier ?1|\btiers?\b|international|languages?|locali[sz]|europe|latam|\basia\b|bilingual/, 1.5],
    ['trading', /trading|\btraders?\b|forex|\bcfds?\b|crypto|\bkyc\b|\bftds?\b|deposit|exchange|candle|copy trading|signals/, 1.6],
    ['sports', /igaming|gambl|betting|sportsbook|casino|\bodds\b|\bmatch(es)?\b|\bsports?\b|tipster|\bslots?\b|\bplayers?\b/, 1.6],
    ['finance', /financ|\bloans?\b|credit|\blend|\bapr\b|insurance|\bbank|\bcards?\b|borrow|interest rate/, 1.5],
    ['nutra', /nutra|health|supplement|\bcod\b|cash on delivery|call cent|buyout|wellness|delivery|courier|\border form/, 1.6],
    ['sweeps', /sweep|\bprizes?\b|giveaway|\bgift|contest|\bsoi\b|\bdoi\b|zip submit|email submit|lead form|\bforms?\b/, 1.5],
    ['checklist', /checklist|\broutine|\bhabits?\b|\blearn|before you|set ?up|prepare|\bsops?\b|step by step|\bplan\b/, 1],
    ['certificate', /certificate|well done|congrat|you finished|celebrat|capstone|portfolio of results|graduat|what comes next/, 2],
    ['clock', /\bdays?\b|\bhours?\b|\bweeks?\b|\bmonths?\b|\b72\b|\btime\b|\bwait|patience|\blag\b|delay|season|calendar|attribution window/, 1],
    ['funnel', /funnel|drop[- ]?off|\bdrops?\b|journey|from click to|from ad to|path from/, 1.6],
    ['talk', /affiliate manager|account manager|talk(ing)? to|negotiat|ask (your|the)|\bdeal terms|\bcontracts?\b|\bpartners?\b/, 1.5],
    ['team', /\bteams?\b|\bhir(e|ing)\b|delegat|\bstaff\b|meeting|incentive|pay plan|\bbuyers on\b|training buyers/, 1.8],
    ['audience', /audiences?|targeting|lookalike|\binterests?\b|\bbroad\b|segment|demographic|cohort/, 1.5],
    ['auction', /auction|\bbids?\b|\bbidding\b|\bcpm\b|compet|relevance/, 1.6],
    ['fraud', /fraud|\bbots? traffic|fake leads|duplicates?|\bscrubs?\b|\btrash\b|invalid|multi-?account|bonus abuse|lead quality|\bquality\b/, 1.5],
  ];
  const SCHOOL_BIAS = { 'v-trading': 'trading', 'v-igaming': 'sports', 'v-finance': 'finance', 'v-nutra': 'nutra', 'v-sweeps': 'sweeps' };
  const GENERIC = ['laptop', 'team', 'dashboard', 'checklist', 'phoneuser', 'talk', 'audience', 'budget'];
  const hash = (s) => { let h = 2166136261; for (const ch of String(s)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
  const low = (x) => String(x ?? '').toLowerCase();
  function rank(parts, ctx = {}) {
    const sc = {};
    for (const [key, re, w] of RULES) {
      let s = 0;
      for (const [txt, k] of parts) if (txt && re.test(txt)) s += k;
      if (s) sc[key] = (sc[key] || 0) + s * w;
    }
    const bias = SCHOOL_BIAS[ctx.school];
    if (bias) sc[bias] = (sc[bias] || 0) + 1.5;
    return Object.entries(sc).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((e) => e[0]);
  }
  /** The scene for free text (a lesson opening): lesson title × 3, objectives × 2, module × 1. */
  function pick(text, ctx = {}) {
    const r = rank([[low(ctx.title), 3], [low(text), 2], [low(ctx.module), 1]], ctx);
    return r[0] || GENERIC[hash((ctx.title || '') + text) % GENERIC.length];
  }
  /** Words the narrator does not read but the slide shows. */
  function slideText(st) {
    const d = st && st.d;
    if (!d) return '';
    if (typeof d === 'string') return d;
    if (Array.isArray(d)) return d.map((x) => (typeof x === 'string' ? x : '')).join(' ');
    return [d.b, d.s, d.label, d.note, d.text].filter(Boolean).join(' ');
  }
  const SCENE_TYPES = ['big', 'stat', 'tip', 'quote'];

  /* Cast and icons for card titles and flow nodes. */
  const ROLE = [
    ['ada', /^(the )?(advertis|brand|merchant|operator|lender|broker)/],
    ['kofi', /^(the |affiliate |ad )?networks?\b/],
    ['you', /^(the |you,? the )?(affiliate|you\b|media buyer|publisher)/],
    ['zara', /^(the )?(traffic source|ad platform|platform)/],
    ['tunde', /^(the )?(users?|person|player|lead|customer|buyer|borrower|visitor|trader)\b/],
    ['nia', /^(the |your )?(affiliate manager|account manager|manager)/],
  ];
  const ICON_RULES = [
    ['coin', /payout|\bpay\b|\bpaid\b|money|cash|revenue|profit|\bcpa\b|\bcpl\b|revshare|\bcpi\b|\bcps\b|hybrid|cost|price|\$|bonus|deposit|\bftd/],
    ['chart', /chart|metric|\bkpi|\bctr\b|\bcpm\b|\bcpc\b|\broas\b|\broi\b|\bepc\b|rate|growth|\bltv\b|report|result/],
    ['link', /\blinks?\b|\butms?\b|click id|\burl\b|sub ?id|redirect|tracker/],
    ['target', /pixel|event|conversion|target|goal|objective|optimi[sz]/],
    ['server', /postback|server|\bapi\b|\bs2s\b|capi/],
    ['page', /page|lander|prelander|website|advertorial|article/],
    ['plane', /telegram|channel|broadcast|\bdm\b/],
    ['bot', /\bbots?\b|botfather|automation|automated/],
    ['camera', /creative|video|\bhook|\bugc\b|angle|format|image|thumbnail|visual/],
    ['flask', /\btests?\b|testing|variant|split|experiment|sample/],
    ['calc', /budget|spend|break-?even|calculat|math/],
    ['stairs', /scal|step up|ladder|level/],
    ['shield', /polic|complian|\blaws?\b|legal|licen|regulat|authori|consent|privacy|safe|honest|verify|verified/],
    ['alert', /warn|\brisk|\bban|scam|fake|fraud|red flag|danger|mistake|restrict|clawback|chargeback/],
    ['pin', /\bgeos?\b|country|nigeria|kenya|ghana|africa|cameroon|local|tier/],
    ['people', /\bteam|audience|\bpeople|community|group|lookalike|interest/],
    ['clock', /\btime|\bday|\bweek|\bmonth|\bhour|\bwait|\bhold|delay|lag|window|season/],
    ['candles', /trading|forex|crypto|\bcfd/],
    ['ticket', /sport|casino|betting|gambl|igaming|\bodds/],
    ['card', /\bloan|credit|\bcards?\b|\bbank|insurance|financ/],
    ['bottle', /nutra|health|supplement|wellness|\bcod\b/],
    ['gift', /sweep|prize|gift|giveaway/],
    ['form', /\bforms?\b|submit|sign ?up|register|registration|\bkyc\b|\bsoi\b|\bdoi\b/],
    ['mail', /e-?mail|inbox|newsletter/],
    ['phone', /phone|mobile|\bapps?\b|install|\bsms\b|whatsapp/],
    ['eye', /impression|reach|view|frequency|attention/],
    ['cursor', /\bclicks?\b|\btaps?\b|\bcta\b|button/],
    ['ad', /\bads?\b|advert|campaign|sponsor/],
    ['store', /shop|store|e-?commerce|product/],
    ['box', /delivery|order|courier|package|ship/],
    ['book', /learn|course|lesson|guide|read|study|tutorial/],
    ['funnel', /funnel|drop/],
    ['globe', /global|world|international|language/],
    ['hub', /network|connect/],
    ['check', /approv|valid|qualif|done|confirm|checklist/],
  ];
  function chipFor(title) {
    const t = low(title).trim();
    for (const [who, re] of ROLE) if (re.test(t)) return { who };
    for (const [ico, re] of ICON_RULES) if (re.test(t)) return { ico };
    return null;
  }
  /** Chips for a list of item titles: only when most items match (a half-decorated list looks unfinished). */
  function chipsFor(titles) {
    if (!titles.length || titles.length > 7) return null;
    const c = titles.map(chipFor);
    const hit = c.filter(Boolean).length;
    if (hit / titles.length < 0.75) return null;
    // Two items with the same icon read fine; a list where every item has the same icon says nothing.
    const kinds = new Set(c.filter(Boolean).map((x) => x.who || x.ico));
    if (titles.length > 2 && kinds.size < 2) return null;
    return c.map((x, i) => x || { n: i + 1 });
  }

  /** One entry per slide: { scene } for text-led slides, { chips } for cards and flows, or null. */
  function plan(steps, ctx = {}) {
    const out = []; const recent = [];
    const base = [[low(ctx.title), 1], [low(ctx.module), 1]];
    (steps || []).forEach((st, i) => {
      if (!st || typeof st !== 'object') { out.push(null); return; }
      const v = st.v;
      if (SCENE_TYPES.includes(v) || !v) {
        const r = rank([[low(st.h), 3], [low(slideText(st)), 2], [low(st.p).slice(0, 400), 0.6], ...base], ctx);
        let key = r.find((k) => !recent.slice(-3).includes(k));
        if (!key) {
          const pool = GENERIC.filter((k) => !recent.slice(-3).includes(k));
          key = pool[hash(`${st.h}|${i}|${ctx.title}`) % pool.length];
        }
        recent.push(key);
        out.push({ scene: key });
        return;
      }
      if (v === 'cards' && Array.isArray(st.d)) { const ch = chipsFor(st.d.map((x) => String(x).split('|')[0])); out.push(ch ? { chips: ch } : null); return; }
      if (v === 'flow' && Array.isArray(st.d)) { const ch = chipsFor(st.d.map(String)); out.push(ch ? { chips: ch } : null); return; }
      out.push(null);
    });
    return out;
  }

  /* ================================================================
   * STAGE DRESSING
   * ================================================================ */
  /** The living backdrop: two drifting glows, a soft sheen over the grid and a few slow particles. */
  function ambient() {
    let p = '';
    for (let k = 0; k < 9; k++) {
      const h = hash('p' + k);
      p += `<b style="left:${(6 + (h % 88)).toFixed(0)}%;top:${(30 + ((h >> 8) % 66)).toFixed(0)}%;animation-delay:-${((h >> 4) % 140) / 10}s;animation-duration:${11 + ((h >> 12) % 7)}s"></b>`;
    }
    return `<div class="la-amb" aria-hidden="true"><i class="la-g1"></i><i class="la-g2"></i><i class="la-sh"></i>${p}</div>`;
  }
  function chipHtml(c) {
    if (c.who) return `<span class="la-chip la-face" aria-hidden="true">${faceChip(c.who)}</span>`;
    if (c.ico) return `<span class="la-chip la-ic" aria-hidden="true">${iconSvg(c.ico)}</span>`;
    return `<span class="la-chip la-num" aria-hidden="true">${c.n}</span>`;
  }
  /** Dress a rendered stage: scene, chips, backdrop. Safe to call on any VSL stage; does nothing it cannot do. */
  function dress(stage, step, p, o = {}) {
    if (!stage) return;
    if (o.ambient !== false && !stage.querySelector(':scope > .la-amb')) { stage.insertAdjacentHTML('afterbegin', ambient()); stage.classList.add('la-live'); }
    if (!p) return;
    if (p.scene) {
      const root = [...stage.children].find((c) => !c.classList.contains('la-amb'));
      if (!root) return;
      stage.classList.add('la-split', 'la-v-' + (step && step.v ? step.v : 'big'));
      root.insertAdjacentHTML('afterend', `<div class="la-art" data-scene="${p.scene}">${scene(p.scene)}</div>`);
      parallax(stage);
    }
    if (p.chips) {
      const items = stage.querySelectorAll(step.v === 'cards' ? '.vl-c' : '.vl-fn');
      items.forEach((el, i) => { if (p.chips[i]) { el.insertAdjacentHTML('afterbegin', chipHtml(p.chips[i])); el.classList.add('la-has'); } });
      const box = stage.querySelector(step.v === 'cards' ? '.vl-cards' : '.vl-flow');
      if (box) box.classList.add('la-chips');
    }
  }
  /** Pointer parallax for the scene layers (desktop, fine pointer). Mobile and reduced motion get the idle drift only. */
  function parallax(el) {
    if (!el || el._lap || reduced() || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    el._lap = true;
    let raf = 0; let x = 0; let y = 0;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      x = ((e.clientX - r.left) / r.width - 0.5) * 2; y = ((e.clientY - r.top) / r.height - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; el.style.setProperty('--px', x.toFixed(3)); el.style.setProperty('--py', y.toFixed(3)); });
    });
    el.addEventListener('pointerleave', () => { el.style.setProperty('--px', 0); el.style.setProperty('--py', 0); });
  }

  window.VSA = { scene, pick, plan, dress, ambient, parallax, chipsFor, faceChip, CAST, SCENES: Object.keys(SCENES), iconSvg };
})();
