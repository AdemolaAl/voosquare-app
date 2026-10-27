/* VooSquare email heroes: animated SVG plates, rendered frame by frame in Chromium and saved as GIFs.
 *
 * House style (same world as the room artwork in tools/room-art):
 *  - Every hero sits on a flat plate: the topic colour sunk into the VooSquare night green, one lighter disc as the
 *    light source and a faint square grid. Flat colour, no outlines, no gradients on the subject.
 *  - Shared inks: ink #0A1A13, paper #F2EFE6 (warm off-white), lime #C9F65B as the one bright highlight.
 *  - People are the VooSquare cartoon members (VS.avatar parts). No real people, no third-party logos.
 *  - Frame 0 is always the finished picture (Outlook desktop only shows the first frame). Motion is small and loops.
 *
 * Stage: 600x280. scene(t) gets the loop time in seconds and returns SVG for the stage.
 * Used by index.html + render.py (python3 src/emails/art/render.py).
 */
(function () {
  'use strict';
  const VS = window.VS;

  /* ---------------- colour ---------------- */
  const hex = (c) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)); };
  const toHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const C = {
    ink: '#0A1A13', night: '#0A1611', paper: '#F2EFE6', paper2: '#DCD8CB', lime: '#C9F65B', limeD: '#9CC43A', brand: '#00A86B', mint: '#12C784',
    deep: '#00774B', gold: '#F5C542', goldD: '#C99618', red: '#FF6B5E', note: '#3FAE7A', noteD: '#2C8A5D',
  };
  const W = 600, H = 280;

  /* ---------------- time ---------------- */
  const cl = (x) => Math.max(0, Math.min(1, x));
  const seg = (T, a, b) => cl((T - a) / (b - a));
  const eo = (p) => 1 - Math.pow(1 - p, 3);
  const eio = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
  const back = (p, s = 1.9) => { if (p <= 0) return 0; if (p >= 1) return 1; const q = p - 1; return q * q * ((s + 1) * q + s) + 1; };
  const sin = (T, period, phase = 0) => Math.sin(2 * Math.PI * (T / period + phase));
  /** In-out window: 0 before a, ramps to 1 by a+r, holds, ramps back to 0 by b. */
  const win = (T, a, b, r = 0.18) => Math.min(eo(seg(T, a, a + r)), 1 - eio(seg(T, b - r, b)));
  const blinkAt = (T, period, off) => ((T + off) % period + period) % period < 0.13;
  const f = (n) => Math.round(n * 100) / 100;

  /* ---------------- people ---------------- */
  const n = (a, k) => Math.abs(Number(a[k]) || 0) % VS.AV.counts[k];
  function faceOnly(a, blink) {
    let raw = VS.avatar(a, { still: true }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    raw = raw.replace(/<rect width="64" height="64" fill="[^"]+"\/>/, '').replace(/<path d="M8 66C10 50[^>]*\/>/, '').replace(/<rect x="27.5" y="38"[^>]*\/>/, '');
    if (blink) raw = raw.replace('<g class="blink">', '<g class="blink" transform="translate(0 31) scale(1 .12) translate(0 -31)">');
    return raw;
  }
  function badge(a, cx, cy, r, ring, blink) {
    let raw = VS.avatar(a, { still: true }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    if (blink) raw = raw.replace('<g class="blink">', '<g class="blink" transform="translate(0 31) scale(1 .12) translate(0 -31)">');
    const s = (r * 2) / 64;
    return `${ring ? `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r + ring.w)}" fill="${ring.c}"/>` : ''}<g transform="translate(${f(cx - r)} ${f(cy - r)}) scale(${f(s * 1000) / 1000})">${raw}</g>`;
  }
  /**
   * A member bust in a 140x172 box (head top ~ y 18, shoulders ~ y 110, face centre ~ (70, 67)).
   * pose: down | type | wave | point | cheer | hold (both hands forward, holding something at ~ (70,150)).
   * rotR / rotL rotate the arms around the shoulders (degrees) for waving.
   */
  function person(a, o = {}) {
    const { x = 0, y = 0, s = 1, pose = 'down', flip = false, headset = false, goggles = null, blink = false, rotR = 0, rotL = 0, item = '' } = o;
    const skin = VS.AV.skins[n(a, 'skin')];
    const shirt = o.shirt || VS.AV.shirts[n(a, 'shirt')];
    const sleeve = mix(shirt, '#000000', 0.16);
    const arm = (d, hx, hy, r = 6.5) => `<path d="${d}" stroke="${sleeve}" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="${r}" fill="${skin}"/>`;
    const L = {
      down: arm('M42 126 Q30 146 34 166', 34, 168), type: arm('M44 128 Q34 142 50 152', 52, 152), wave: arm('M44 128 Q36 146 46 160', 47, 162),
      point: arm('M44 128 Q36 146 46 160', 47, 162), cheer: arm('M44 126 Q28 112 26 90', 26, 84, 7.5), hold: arm('M44 128 Q38 150 58 152', 60, 151),
    }[pose];
    const R = {
      down: arm('M98 126 Q110 146 106 166', 106, 168), type: arm('M96 128 Q106 142 90 152', 88, 152), wave: arm('M96 126 Q112 112 114 90', 114, 84, 7.5),
      point: arm('M96 124 Q120 118 134 104', 138, 101, 7), cheer: arm('M96 126 Q112 112 114 90', 114, 84, 7.5), hold: arm('M96 128 Q102 150 82 152', 80, 151),
    }[pose];
    const hs = headset ? '<g fill="none" stroke="#0A1A13" stroke-width="4" stroke-linecap="round"><path d="M42 54 Q42 18 70 18 Q98 18 98 54"/></g><rect x="36" y="48" width="11" height="18" rx="5" fill="#0A1A13"/><rect x="93" y="48" width="11" height="18" rx="5" fill="#0A1A13"/><path d="M99 62 Q98 80 82 82" stroke="#0A1A13" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="80" cy="82" r="3.5" fill="#C9F65B"/>' : '';
    // Spyvoo goggles: two big white lenses with navy pupils looking at (gx, gy) offset -1..1.
    let gg = '';
    if (goggles) {
      const [gx, gy] = goggles;
      gg = `<path d="M38 66 H102" stroke="#0E1A3D" stroke-width="4"/><circle cx="57" cy="68" r="15" fill="#3355F0"/><circle cx="83" cy="68" r="15" fill="#3355F0"/><circle cx="57" cy="68" r="12" fill="#fff"/><circle cx="83" cy="68" r="12" fill="#fff"/>`
        + `<circle cx="${f(57 + gx * 5)}" cy="${f(68 + gy * 4)}" r="5.6" fill="#0E1A3D"/><circle cx="${f(83 + gx * 5)}" cy="${f(68 + gy * 4)}" r="5.6" fill="#0E1A3D"/><circle cx="${f(59 + gx * 5)}" cy="${f(66 + gy * 4)}" r="1.8" fill="#fff"/><circle cx="${f(85 + gx * 5)}" cy="${f(66 + gy * 4)}" r="1.8" fill="#fff"/>`;
    }
    const body = `<path d="M30 172C32 124 48 108 70 108C92 108 108 124 110 172Z" fill="${shirt}"/><path d="M62 108 L70 120 L78 108" fill="rgba(255,255,255,.2)"/><rect x="62" y="94" width="16" height="18" rx="6" fill="${skin}"/><g transform="translate(25.2 25) scale(1.4)">${faceOnly(a, blink)}</g>${hs}${gg}`;
    const arms = `${item}<g transform="rotate(${rotL} 44 128)">${L}</g><g transform="rotate(${rotR} 96 126)">${R}</g>`;
    const t = flip ? `translate(${f(x + 140 * s)} ${f(y)}) scale(${-s} ${s})` : `translate(${f(x)} ${f(y)}) scale(${s})`;
    return `<g transform="${t}">${body}${arms}</g>`;
  }
  const CAST = [
    { skin: 3, hair: 3, hairColor: 2, eyes: 0, mouth: 0, acc: 2, shirt: 1, bg: 0 },
    { skin: 7, hair: 0, hairColor: 0, eyes: 0, mouth: 1, acc: 1, shirt: 0, bg: 0 },
    { skin: 0, hair: 2, hairColor: 1, eyes: 1, mouth: 0, acc: 0, shirt: 4, bg: 0 },
    { skin: 4, hair: 1, hairColor: 0, eyes: 0, mouth: 1, acc: 0, shirt: 3, bg: 2 },
    { skin: 1, hair: 5, hairColor: 3, eyes: 2, mouth: 0, acc: 2, shirt: 6, bg: 3 },
    { skin: 6, hair: 4, hairColor: 0, eyes: 0, mouth: 0, acc: 1, shirt: 7, bg: 4 },
    { skin: 2, hair: 0, hairColor: 1, eyes: 1, mouth: 1, acc: 0, shirt: 2, bg: 5 },
    { skin: 5, hair: 2, hairColor: 0, eyes: 0, mouth: 2, acc: 3, shirt: 5, bg: 6 },
  ];

  /* ---------------- props ---------------- */
  const shadow = (cx, cy, rx, ry = rx * 0.14, o = 0.3) => `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="#000" opacity="${o}"/>`;
  const sqs = (list) => list.map(([x, y, w, c, rot = 0, o = 1]) => `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(w)}" rx="${f(w * 0.26)}" fill="${c}" opacity="${o}" transform="rotate(${f(rot)} ${f(x + w / 2)} ${f(y + w / 2)})"/>`).join('');
  const txt = (x, y, s, size, fill, o = {}) => `<text x="${f(x)}" y="${f(y)}" font-family="Inter Display, Inter, Arial, sans-serif" font-size="${size}" font-weight="${o.w || 800}" fill="${fill}" text-anchor="${o.a || 'start'}" letter-spacing="${o.ls != null ? o.ls : -0.02 * size}"${o.op != null ? ` opacity="${o.op}"` : ''}>${s}</text>`;
  /** Text-like bars inside cards. */
  const bars = (x, y, widths, col, h = 6, gap = 12) => widths.map((w, i) => `<rect x="${f(x)}" y="${f(y + i * gap)}" width="${f(w)}" height="${h}" rx="${h / 2}" fill="${col}"/>`).join('');
  function bubble(x, y, w, h, fill, lines, tail = 'l', lineCol = 'rgba(10,26,19,.22)') {
    const tx = tail === 'l' ? x + 18 : x + w - 18;
    const tl = tail === 'l' ? `M${f(tx)} ${f(y + h - 2)} l-4 14 l17 -14Z` : `M${f(tx)} ${f(y + h - 2)} l4 14 l-17 -14Z`;
    let ls = '';
    for (let i = 0; i < lines; i++) ls += `<rect x="${f(x + 13)}" y="${f(y + 13 + i * 12)}" width="${f((w - 26) * (i === lines - 1 && lines > 1 ? 0.6 : 1))}" height="6" rx="3" fill="${lineCol}"/>`;
    return `${tail ? `<path d="${tl}" fill="${fill}"/>` : ''}<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${f(Math.min(15, h / 2))}" fill="${fill}"/>${ls}`;
  }
  const dots3 = (cx, cy, T, col = C.ink) => [0, 1, 2].map((i) => `<circle cx="${f(cx + (i - 1) * 11)}" cy="${f(cy - Math.max(0, sin(T, 0.6, -i * 0.18)) * 3)}" r="3.6" fill="${col}" opacity="${0.45 + 0.55 * Math.max(0, sin(T, 0.6, -i * 0.18))}"/>`).join('');
  /** Scale a group around a point. */
  const sAt = (cx, cy, s, inner, rot = 0) => (s <= 0.001 ? '' : `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f(rot)}) scale(${f(s * 1000) / 1000}) translate(${f(-cx)} ${f(-cy)})">${inner}</g>`);
  const op = (o, inner) => (o <= 0.01 ? '' : o >= 0.99 ? inner : `<g opacity="${f(o)}">${inner}</g>`);
  const mv = (dx, dy, inner) => `<g transform="translate(${f(dx)} ${f(dy)})">${inner}</g>`;
  const check = (cx, cy, r, bg = C.lime, fg = C.ink) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${bg}"/><path d="M${f(cx - r * 0.42)} ${f(cy + r * 0.02)} l${f(r * 0.3)} ${f(r * 0.3)} l${f(r * 0.56)} ${f(-r * 0.6)}" fill="none" stroke="${fg}" stroke-width="${f(r * 0.24)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const cross = (cx, cy, r, bg = C.red) => `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${bg}"/><path d="M${f(cx - r * 0.36)} ${f(cy - r * 0.36)} l${f(r * 0.72)} ${f(r * 0.72)} M${f(cx + r * 0.36)} ${f(cy - r * 0.36)} l${f(-r * 0.72)} ${f(r * 0.72)}" stroke="#fff" stroke-width="${f(r * 0.22)}" stroke-linecap="round"/>`;
  /** Front-facing coin. */
  const coin = (cx, cy, r, rot = 0, squash = 1) => `<g transform="translate(${f(cx)} ${f(cy)}) rotate(${f(rot)}) scale(${f(squash)} 1)"><circle cx="0" cy="${f(r * 0.16)}" r="${f(r)}" fill="${C.goldD}"/><circle cx="0" cy="0" r="${f(r)}" fill="${C.gold}"/><circle cx="0" cy="0" r="${f(r * 0.68)}" fill="none" stroke="${C.goldD}" stroke-width="${f(r * 0.12)}"/><rect x="${f(-r * 0.22)}" y="${f(-r * 0.22)}" width="${f(r * 0.44)}" height="${f(r * 0.44)}" rx="${f(r * 0.1)}" fill="${C.goldD}"/></g>`;
  /** Side view coin stack (n coins), bottom at y. */
  const stack = (cx, y, w, nn) => { let s = ''; for (let i = 0; i < nn; i++) { const yy = y - i * 7; s += `<rect x="${f(cx - w / 2)}" y="${f(yy - 9)}" width="${f(w)}" height="9" rx="4.5" fill="${C.goldD}"/><ellipse cx="${f(cx)}" cy="${f(yy - 9)}" rx="${f(w / 2)}" ry="4" fill="${C.gold}"/>`; } return s; };
  /** Banknote. */
  const note = (x, y, w, h, rot = 0) => `<g transform="rotate(${f(rot)} ${f(x + w / 2)} ${f(y + h / 2)})"><rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="5" fill="${C.note}"/><rect x="${f(x + 4)}" y="${f(y + 4)}" width="${f(w - 8)}" height="${f(h - 8)}" rx="3" fill="none" stroke="${C.noteD}" stroke-width="2"/><ellipse cx="${f(x + w / 2)}" cy="${f(y + h / 2)}" rx="${f(h * 0.28)}" ry="${f(h * 0.28)}" fill="${C.lime}"/><rect x="${f(x + w / 2 - h * 0.1)}" y="${f(y + h / 2 - h * 0.1)}" width="${f(h * 0.2)}" height="${f(h * 0.2)}" rx="1.5" fill="${C.noteD}"/></g>`;
  /** Laptop seen from the back (for people sitting behind a desk). */
  const laptopBack = (cx, y, w, mark = true) => `<path d="M${f(cx - w / 2 + 6)} ${f(y)} H${f(cx + w / 2 - 6)} Q${f(cx + w / 2)} ${f(y)} ${f(cx + w / 2)} ${f(y + 6)} V${f(y + w * 0.62)} H${f(cx - w / 2)} V${f(y + 6)} Q${f(cx - w / 2)} ${f(y)} ${f(cx - w / 2 + 6)} ${f(y)}Z" fill="${C.paper2}"/>${mark ? vmark(cx - 9, y + w * 0.31 - 9, 18) : ''}`;
  /** The VooSquare mark (four tiles), top-left (x, y), size w. */
  const vmark = (x, y, w, bg = C.brand, offs) => {
    const k = w / 64;
    const o = offs || [[0, 0], [0, 0], [0, 0], [0, 0]];
    const t = [[13, 13, '#fff', 1], [35, 13, '#fff', 0.75], [13, 35, '#fff', 0.75], [35, 35, C.lime, 1]];
    return `<g transform="translate(${f(x)} ${f(y)}) scale(${f(k * 1000) / 1000})">${bg ? `<rect width="64" height="64" rx="18" fill="${bg}"/>` : ''}${t.map(([tx, ty, c, oo], i) => `<rect x="${f(tx + o[i][0])}" y="${f(ty + o[i][1])}" width="16" height="16" rx="4.5" fill="${c}" opacity="${oo}"/>`).join('')}</g>`;
  };
  /** The Premium mark: an ink square with its lime exponent. */
  const pmark = (x, y, w, ink = C.ink) => `<rect x="${f(x)}" y="${f(y + w * 0.26)}" width="${f(w * 0.74)}" height="${f(w * 0.74)}" rx="${f(w * 0.2)}" fill="${ink}"/><rect x="${f(x + w * 0.69)}" y="${f(y)}" width="${f(w * 0.31)}" height="${f(w * 0.31)}" rx="${f(w * 0.09)}" fill="${C.lime}"/>`;

  /* Product tiles (the app icons, flat). */
  const ICONS = {
    spyvoo: ['#3355F0', '<g transform="translate(10 10) scale(1.833)"><path d="M11 8.6h2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><circle cx="6.6" cy="12.3" r="5.3" fill="#fff"/><circle cx="17.4" cy="12.3" r="5.3" fill="#fff"/><circle cx="8.1" cy="12.3" r="2.35" fill="#0E1A3D"/><circle cx="18.9" cy="12.3" r="2.35" fill="#0E1A3D"/><circle cx="8.9" cy="11.4" r=".75" fill="#fff"/><circle cx="19.7" cy="11.4" r=".75" fill="#fff"/></g>'],
    affleego: ['#FFE14D', '<g transform="translate(13 13) scale(1.583)"><path d="M5 18L11 6h2l6 12h-3.2l-1.3-2.8H9.5L8.2 18z" fill="#111"/><path d="M10.6 12.6h2.8L12 9.6z" fill="#FFE14D"/></g>'],
    vooads: ['#111312', '<g transform="translate(13 13) scale(1.583)"><circle cx="7.8" cy="12" r="4.2" fill="#fff"/><circle cx="16.2" cy="12" r="4.2" fill="#fff"/><circle cx="8.8" cy="12" r="2.1" fill="#EE5A2F"/><circle cx="17.2" cy="12" r="2.1" fill="#EE5A2F"/></g>'],
    land: ['#E8458B', '<g transform="translate(13 13) scale(1.583)"><rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="#fff" stroke-width="2.4"/><path d="M4 9.5h16M8 14h8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></g>'],
    join: ['#6A4CF5', '<g transform="translate(13 13) scale(1.583)"><circle cx="9" cy="12" r="5" fill="none" stroke="#fff" stroke-width="2.8"/><circle cx="15" cy="12" r="5" fill="none" stroke="#fff" stroke-width="2.8"/></g>'],
    reply: ['#111312', '<g transform="translate(13 13) scale(1.583)"><path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 16h-8l-4.5 3.5V16H5a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 5 5z" fill="#F5C542"/><circle cx="8.5" cy="10.5" r="1.3" fill="#111"/><circle cx="12" cy="10.5" r="1.3" fill="#111"/><circle cx="15.5" cy="10.5" r="1.3" fill="#111"/></g>'],
    cast: ['#3A64EC', '<g transform="translate(13 13) scale(1.583)"><path d="M15.6 8.1A5.4 5.4 0 1 0 15.6 15.9" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round"/><circle cx="19" cy="12" r="2" fill="#fff"/></g>'],
    gatevoo: ['#111111', '<g transform="translate(13 13) scale(1.583)"><path d="M17.4 8.2A6.4 6.4 0 1 0 18.4 13H12.6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="12.4" r="1.7" fill="#3E9B6F"/></g>'],
  };
  const tile = (k, x, y, w, ring) => `<g transform="translate(${f(x)} ${f(y)}) scale(${f((w / 64) * 1000) / 1000})">${ring ? `<rect x="-5" y="-5" width="74" height="74" rx="22" fill="none" stroke="${ring}" stroke-width="3"/>` : ''}<rect width="64" height="64" rx="18" fill="${ICONS[k][0]}"/>${(k === 'gatevoo' || k === 'vooads' || k === 'reply') ? '<rect x=".75" y=".75" width="62.5" height="62.5" rx="17.4" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="1.5"/>' : ''}${ICONS[k][1]}</g>`;

  /* ---------------- the plate ---------------- */
  /** Base colours of a plate, so the email header band can match the top of the hero exactly. */
  const plateColors = (accent, dark) => ({ base: dark ? '#0A1410' : mix(accent, C.night, 0.8), lift: dark ? '#122519' : mix(accent, C.night, 0.67) });
  function plate(h, inner, T) {
    const { base, lift } = plateColors(h.accent, h.dark);
    // The light rises from the floor, so the top edge of every hero is the plain base colour (it meets the email's header band).
    const hh = h.h || H;
    const lx = (h.light || [300])[0], ly = hh + 34, lr = hh === H ? 236 : 128;
    const cell = 28;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs><pattern id="grid" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse" x="6" y="0"><path d="M${cell} 0H0V${cell}" fill="none" stroke="#fff" stroke-opacity=".045" stroke-width="1"/></pattern></defs>
      <rect width="${W}" height="${H}" fill="${base}"/>
      <circle cx="${lx}" cy="${ly}" r="${lr}" fill="${lift}"/>
      <rect width="${W}" height="${H}" fill="url(#grid)"/>
      ${inner(T)}
    </svg>`;
  }

  /* =================================================================== scenes */
  const S = {};

  /* Welcome: three members at a long desk, the VooSquare mark assembles above them, one waves. */
  S.welcome = {
    accent: '#00A86B', dur: 3.6, light: [300, 30, 230],
    draw(T) {
      // Mark tiles drift apart then click back together.
      const sp = win(T, 0.5, 2.3, 0.45);
      const offs = [[-sp * 7, -sp * 7], [sp * 7, -sp * 7], [-sp * 7, sp * 7], [sp * 7, sp * 7]];
      const markY = 22 + sin(T, 3.6) * 2;
      const pop = 1 + 0.06 * win(T, 2.25, 2.75, 0.2);
      const wave = sin(T, 0.9) * 12 * win(T, 0.2, 3.2, 0.3);
      const desk = `<rect x="40" y="236" width="520" height="16" rx="8" fill="${C.paper}"/><rect x="40" y="252" width="520" height="40" fill="${mix('#00A86B', C.night, 0.6)}"/>`;
      const idcard = `<g transform="rotate(-8 92 82)"><rect x="40" y="50" width="104" height="66" rx="12" fill="${C.paper}"/><rect x="40" y="50" width="104" height="20" rx="12" fill="${C.lime}"/><rect x="40" y="60" width="104" height="10" fill="${C.lime}"/>${vmark(48, 53, 14, C.brand)}${badge(CAST[1], 64, 92, 14)}${bars(86, 84, [44, 30], 'rgba(10,26,19,.3)', 5, 11)}</g>`;
      const chips = `<g transform="rotate(7 506 84)"><rect x="458" y="60" width="98" height="48" rx="15" fill="${C.paper}"/>${tile('spyvoo', 467, 68, 32)}${tile('join', 507, 68, 32)}</g>`;
      return `${sqs([[200, 40, 10, C.lime, 20, 0.8], [560, 150, 12, C.paper, -14, 0.4], [30, 160, 8, C.paper, 30, 0.4], [394, 30, 9, C.lime, 0, 0.7]])}
        ${sAt(300, markY + 40, pop, `<rect x="262" y="${f(markY + 6)}" width="76" height="76" rx="22" fill="#000" opacity=".25"/>${vmark(262, markY, 76, C.brand, offs)}`)}
        ${idcard}${chips}
        ${person(CAST[4], { x: 72, y: 104, s: 0.9, pose: 'type', blink: blinkAt(T, 3.6, 0.4) })}
        ${person(CAST[1], { x: 233, y: 98, s: 0.96, pose: 'wave', rotR: wave, blink: blinkAt(T, 3.6, 1.9) })}
        ${person(CAST[0], { x: 402, y: 104, s: 0.9, pose: 'type', flip: true, blink: blinkAt(T, 3.6, 2.8) })}
        ${desk}${laptopBack(135, 204, 54)}${laptopBack(465, 204, 54)}`;
    },
  };

  /* Tools: one Voo ID card opens eight product tiles; a lime light runs through them in funnel order. */
  const TOOLS = [['spyvoo', 'Spyvoo', 'Research'], ['affleego', 'Affleego', 'Monetize'], ['vooads', 'Vooads', 'Acquire'], ['land', 'Landvoo', 'Acquire'],
    ['join', 'Joinvoo', 'Track'], ['reply', 'Replyvoo', 'Convert'], ['cast', 'Castvoo', 'Retain'], ['gatevoo', 'Gatevoo', 'Collect']];
  S.tools = {
    accent: '#00A86B', dur: 4.8, light: [140, 140, 200],
    draw(T) {
      const step = 4.8 / 8;
      const act = Math.floor(T / step) % 8;
      const ph = (T % step) / step;
      const x0 = 208, dx = 98, y1 = 40, y2 = 150, tw = 50;
      let out = '';
      // A rail behind each row, and the card's link into the grid.
      [y1, y2].forEach((yy) => { out += `<path d="M${x0 + tw / 2} ${yy + tw / 2} H${x0 + 3 * dx + tw / 2}" stroke="${C.paper}" stroke-opacity=".16" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`; });
      out += `<path d="M160 136 C186 136 180 ${y1 + tw / 2} ${x0 - 4} ${y1 + tw / 2} M160 136 C186 136 180 ${y2 + tw / 2} ${x0 - 4} ${y2 + tw / 2}" fill="none" stroke="${C.lime}" stroke-opacity=".5" stroke-width="2.5" stroke-dasharray="2 7" stroke-linecap="round"/>`;
      TOOLS.forEach(([k, name, stage], i) => {
        const x = x0 + (i % 4) * dx, y = i < 4 ? y1 : y2;
        const on = i === act;
        const lift = on ? -4 * Math.sin(Math.PI * Math.min(1, ph * 1.4)) : 0;
        const soon = k === 'land' || k === 'gatevoo';
        out += `<g transform="translate(0 ${f(lift)})">${on ? `<rect x="${x - 7}" y="${y - 7}" width="${tw + 14}" height="${tw + 14}" rx="20" fill="${C.lime}" opacity=".18"/>` : ''}${tile(k, x, y, tw, on ? C.lime : null)}</g>`;
        out += txt(x + tw / 2, y + tw + 22, name, 13, '#FFFFFF', { a: 'middle' });
        out += txt(x + tw / 2, y + tw + 38, soon ? 'Soon' : stage, 10.5, soon ? 'rgba(242,239,230,.5)' : C.lime, { a: 'middle', w: 600, ls: 0.2 });
      });
      // The Voo ID card: one login for all of them.
      const card = `<g transform="rotate(-6 96 136)"><rect x="40" y="94" width="122" height="84" rx="14" fill="#000" opacity=".25" transform="translate(4 6)"/><rect x="40" y="94" width="122" height="84" rx="14" fill="${C.paper}"/><rect x="40" y="94" width="122" height="26" rx="14" fill="${C.lime}"/><rect x="40" y="108" width="122" height="12" fill="${C.lime}"/>${vmark(50, 98, 18, C.brand)}${bars(74, 104, [46], 'rgba(10,26,19,.45)', 6)}${badge(CAST[2], 70, 148, 17, { w: 2.5, c: C.lime }, blinkAt(T, 4.8, 1.2))}${bars(96, 138, [52, 36], 'rgba(10,26,19,.3)', 6, 12)}</g>`;
      out += card;
      return out;
    },
  };

  /* Joinvoo: real members walk through the lime gate; a bot is stopped; good signals fly to the ad dashboard. */
  S.joinvoo = {
    accent: '#5B3FE8', dur: 3.6, light: [300, 300, 220],
    draw(T) {
      const gx = 300;
      const floor = `<rect x="0" y="236" width="600" height="44" fill="${mix('#5B3FE8', C.night, 0.66)}"/><path d="M0 236 H600" stroke="${C.paper}" stroke-opacity=".12" stroke-width="2"/>`;
      // walkers: x position over time (px/s), looping over 600+120
      const walkers = [[CAST[1], 1.0], [CAST[6], 2.8]];
      const sp = 640 / 3.6;
      let ppl = '';
      walkers.forEach(([a, off], i) => {
        const x = ((T + off) * sp) % 640 - 70;
        const bob = Math.abs(Math.sin((T + off) * 9)) * 2.5;
        const passed = x + 39 > gx + 30;
        ppl += mv(x, 0, `${person(a, { x: 0, y: 150 - bob, s: 0.56, pose: 'down', blink: blinkAt(T, 1.8, i) })}${passed ? check(39, 150 - bob, 9) : ''}`);
      });
      // the bot, stopped one step behind the gate line, shaking
      const shake = sin(T, 0.3) * 1.6;
      const bot = mv(188 + shake, 22, `<g transform="scale(.9)"><rect x="22" y="132" width="4" height="12" fill="#9AA3AD"/><circle cx="24" cy="130" r="4.5" fill="${C.red}"/><rect x="2" y="144" width="44" height="38" rx="11" fill="#9AA3AD"/><rect x="10" y="155" width="10" height="9" rx="2.5" fill="${C.red}"/><rect x="28" y="155" width="10" height="9" rx="2.5" fill="${C.red}"/><rect x="14" y="171" width="20" height="4" rx="2" fill="#5B636B"/><rect x="6" y="186" width="36" height="34" rx="9" fill="#7D868F"/><rect x="10" y="220" width="10" height="16" rx="4" fill="#5B636B"/><rect x="28" y="220" width="10" height="16" rx="4" fill="#5B636B"/>${cross(48, 128, 10)}</g>`);
      const gate = `<rect x="${gx - 40}" y="96" width="16" height="140" rx="8" fill="${C.lime}"/><rect x="${gx + 24}" y="96" width="16" height="140" rx="8" fill="${C.lime}"/><rect x="${gx - 48}" y="78" width="96" height="30" rx="15" fill="${C.lime}"/>${tile('join', gx - 12, 81, 24)}`;
      const gateBack = `<rect x="${gx - 24}" y="108" width="48" height="128" fill="${C.lime}" opacity=".1"/>`;
      // dashboard on the right receiving signals
      const dash = `<g transform="translate(470 40)"><rect width="110" height="78" rx="14" fill="${C.paper}"/>${bars(14, 14, [52], 'rgba(10,26,19,.35)', 6)}<rect x="14" y="52" width="12" height="14" rx="3" fill="#B7AAFB"/><rect x="32" y="44" width="12" height="22" rx="3" fill="#B7AAFB"/><rect x="50" y="36" width="12" height="30" rx="3" fill="#8C77F7"/><rect x="68" y="${f(26 - 6 * win(T, 0.9, 3.4, 0.3))}" width="12" height="${f(40 + 6 * win(T, 0.9, 3.4, 0.3))}" rx="3" fill="#5B3FE8"/><path d="M14 40 L38 32 L58 26 L82 16" fill="none" stroke="${C.ink}" stroke-width="2.5" stroke-linecap="round" opacity=".7"/></g>`;
      const pulse = (k) => { const p = ((T / 1.2) + k) % 1; const x = gx + 48 + (470 - gx - 48) * eio(p), y = 120 - Math.sin(p * Math.PI) * 50 - p * 20; return `<circle cx="${f(x)}" cy="${f(y)}" r="5" fill="${C.lime}" opacity="${f(1 - Math.pow(p, 4))}"/>`; };
      return `${floor}<path d="M${gx + 48} 120 Q${(gx + 470) / 2} 40 470 100" fill="none" stroke="${C.lime}" stroke-opacity=".35" stroke-width="2.5" stroke-dasharray="2 8" stroke-linecap="round"/>${pulse(0)}${pulse(0.5)}${dash}${gateBack}${bot}${ppl}${gate}`;
    },
  };

  /* Vooads: one line in, three ad sizes out, each checked before spend. */
  S.vooads = {
    accent: '#EE5A2F', dur: 4.0, light: [420, 150, 230],
    draw(T) {
      const typed = T < 0.2 ? 100 : Math.round(cl(seg(T, 0.3, 1.1)) * 100);
      const prompt = `<g transform="translate(26 106)"><rect width="196" height="52" rx="18" fill="${C.paper}"/><rect x="10" y="10" width="32" height="32" rx="10" fill="#111312"/><circle cx="21" cy="26" r="5.5" fill="#fff"/><circle cx="31" cy="26" r="5.5" fill="#fff"/><circle cx="22.5" cy="26" r="2.7" fill="#EE5A2F"/><circle cx="32.5" cy="26" r="2.7" fill="#EE5A2F"/><rect x="52" y="17" width="${f(Math.min(110, typed * 1.1))}" height="7" rx="3.5" fill="rgba(10,26,19,.55)"/><rect x="52" y="30" width="${f(Math.max(0, Math.min(70, typed * 1.1 - 110 + 70)))}" height="7" rx="3.5" fill="rgba(10,26,19,.3)"/>${typed < 100 ? `<rect x="${f(52 + Math.min(110, typed * 1.1) + 3)}" y="15" width="2.5" height="11" fill="${C.ink}"/>` : ''}<circle cx="176" cy="26" r="12" fill="#EE5A2F"/><path d="M171 26 h10 m-4 -4 l4 4 l-4 4" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>`;
      const flow = `<path d="M232 132 C262 132 262 132 284 132" stroke="${C.paper}" stroke-opacity=".3" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/>`;
            const ad = (i, x, y, w, h, inner) => { const s = 1 + 0.04 * win(T, 1.2 + i * 0.25, 1.75 + i * 0.25, 0.2); return sAt(x + w / 2, y + h / 2, s, `<rect x="${x + 4}" y="${y + 6}" width="${w}" height="${h}" rx="14" fill="#000" opacity=".25"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="${C.paper}"/>${inner}`); };
      const stamp = (i, cx, cy) => { const out = eio(seg(T, 0.25, 0.4)); const p = back(seg(T, 1.45 + i * 0.25, 1.8 + i * 0.25), 2.4); const s = T < 0.25 ? 1 : (T < 1.45 ? 1 - out : p); return sAt(cx, cy, Math.max(0, s), check(cx, cy, 12)); };
      const sq = ad(0, 284, 62, 110, 128, `<rect x="292" y="70" width="94" height="78" rx="9" fill="#FFB59C"/><circle cx="364" cy="90" r="11" fill="${C.gold}"/><path d="M292 148 L318 112 L338 132 L354 116 L386 148Z" fill="#C8401C"/>${bars(294, 158, [70, 46], 'rgba(10,26,19,.35)', 6, 11)}`);
      const story = ad(1, 412, 22, 82, 146, `<rect x="419" y="29" width="68" height="100" rx="9" fill="#2A1A14"/><circle cx="453" cy="79" r="16" fill="#EE5A2F"/><path d="M448 71 v16 l13 -8z" fill="#fff"/>${bars(422, 140, [56, 40], 'rgba(10,26,19,.35)', 6, 11)}`);
      const wide = ad(2, 344, 190, 168, 66, `<rect x="351" y="197" width="64" height="52" rx="8" fill="#FFD3C2"/><path d="M351 249 L373 222 L388 234 L415 249Z" fill="#EE5A2F"/>${bars(424, 207, [70, 52, 36], 'rgba(10,26,19,.35)', 6, 11)}`);
      const langs = ['Pidgin', 'Swahili', 'French'].map((l, i) => { const w = [62, 66, 60][i]; const x = 26 + [0, 70, 144][i]; return `<rect x="${x}" y="176" width="${w}" height="26" rx="13" fill="none" stroke="${C.paper}" stroke-opacity=".35" stroke-width="1.5"/>${txt(x + w / 2, 193.5, l, 12, C.paper, { a: 'middle', w: 600, ls: 0 })}`; }).join('');
      return `${sqs([[250, 40, 10, C.lime, 20, 0.8], [560, 160, 8, C.paper, 10, 0.5], [40, 50, 9, C.paper, -12, 0.4]])}
        ${prompt}${flow}${langs}${sq}${story}${wide}${stamp(0, 390, 66)}${stamp(1, 490, 26)}${stamp(2, 508, 194)}`;
    },
  };

  /* Replyvoo + Castvoo: 2 a.m., a lead asks; the AI Closer answers at once; Castvoo reaches the rest of the channel. */
  S.replycast = {
    accent: '#2449D8', dur: 4.0, light: [110, 40, 200],
    draw(T) {
      const moon = `<circle cx="72" cy="58" r="24" fill="${C.paper}"/><circle cx="84" cy="50" r="22" fill="${mix('#2449D8', C.night, 0.66)}"/>${sqs([[124, 36, 5, C.paper, 45, 0.7], [40, 112, 4, C.paper, 45, 0.5], [150, 90, 4, C.paper, 45, 0.5]])}`;
      const phone = `<g transform="translate(206 26)"><rect x="-4" y="6" width="176" height="252" rx="28" fill="#000" opacity=".25"/><rect width="168" height="258" rx="26" fill="${C.ink}"/><rect x="8" y="8" width="152" height="250" rx="20" fill="#E9E5D9"/><rect x="62" y="14" width="44" height="8" rx="4" fill="${C.ink}"/>
        <rect x="8" y="30" width="152" height="34" fill="#E6E2D6"/>${tile('reply', 18, 37, 20)}${bars(46, 41, [70, 42], 'rgba(10,26,19,.4)', 5, 9)}</g>`;
      const q = op(1 - win(T, 0.1, 0.5, 0.15) * 0 , bubble(222, 102, 104, 36, '#fff', 2, 'l'));
      // reply sequence: typing dots, then the answer, then the payment link card
      const typing = win(T, 0.5, 1.35, 0.12);
      const ans = T < 0.45 ? 1 : eo(seg(T, 1.3, 1.6));
      const pay = T < 0.45 ? 1 : back(seg(T, 1.8, 2.15));
      const hideAll = win(T, 3.55, 4.4, 0.25); // fades only right at the loop seam (none at T=0)
      const r1 = op(typing * (T > 0.45 ? 1 : 0), `<rect x="292" y="150" width="62" height="28" rx="14" fill="${C.lime}"/>${dots3(323, 164, T)}`);
      const r2 = sAt(354, 168, ans * (1 - hideAll), bubble(250, 146, 110, 46, C.lime, 2, 'r', 'rgba(10,26,19,.35)'));
      const r3 = sAt(330, 226, pay * (1 - hideAll), `<rect x="262" y="206" width="98" height="40" rx="12" fill="#fff"/><rect x="270" y="214" width="24" height="24" rx="7" fill="${C.ink}"/><path d="M276 226 h12 m-4 -4 l4 4 l-4 4" stroke="${C.lime}" stroke-width="2.4" fill="none" stroke-linecap="round"/>${bars(300, 218, [48, 30], 'rgba(10,26,19,.35)', 5, 10)}`);
      // Castvoo on the right: broadcast rings out to subscribers
      const cx = 460, cy = 132;
      const rings = `<circle cx="${cx}" cy="${cy}" r="58" fill="none" stroke="${C.paper}" stroke-opacity=".14" stroke-width="2"/><circle cx="${cx}" cy="${cy}" r="98" fill="none" stroke="${C.paper}" stroke-opacity=".1" stroke-width="2" stroke-dasharray="2 8"/>`;
      const SUBS = [[400, 50, 3], [540, 70, 5], [560, 190, 6], [392, 214, 0], [480, 236, 2]];
      const per = 4.0 / SUBS.length;
      const cur = Math.floor(T / per) % SUBS.length, pp = (T % per) / per;
      const [tx, ty] = SUBS[cur];
      const pulse = op(Math.min(1, pp * 5, (1 - pp) * 5), `<circle cx="${f(cx + (tx - cx) * eio(cl(pp * 1.3)))}" cy="${f(cy + (ty - cy) * eio(cl(pp * 1.3)))}" r="5" fill="${C.lime}"/>`);
      const subs = SUBS.map(([x, y, c], i) => { const lit = i === cur && pp > 0.7; return `${badge(CAST[c], x, y, 16, { w: 2.5, c: lit ? C.lime : 'rgba(242,239,230,.25)' }, blinkAt(T, 4, i * 0.7))}`; }).join('');
      return `${moon}${rings}${pulse}${tile('cast', cx - 26, cy - 26, 52)}${subs}${phone}${q}${r1}${r2}${r3}`;
    },
  };

  /* Academy: a member at a desk; the lesson on screen completes, XP pops. */
  S.academy = {
    accent: '#0F766E', dur: 4.0, light: [300, 60, 240],
    draw(T) {
      const restart = T > 0.6 && T < 3.0;
      const prog = restart ? eio(seg(T, 0.8, 2.5)) : 1;
      const done = T <= 0.6 || T >= 2.5;
      const xp = T <= 0.6 ? 1 : back(seg(T, 2.55, 2.9), 2.2);
      const screen = `<g transform="translate(150 34)"><rect x="-4" y="6" width="308" height="178" rx="18" fill="#000" opacity=".25"/><rect width="300" height="178" rx="18" fill="${C.ink}"/><rect x="10" y="10" width="280" height="158" rx="10" fill="${C.paper}"/>
        <rect x="22" y="22" width="112" height="112" rx="10" fill="#0F3B2C"/>${txt(32, 42, 'Traffic banking', 9.5, C.lime, { w: 700, ls: 0 })}${txt(120, 124, '101', 30, C.lime, { a: 'end', w: 400, ls: -1 })}
        <circle cx="78" cy="80" r="17" fill="${C.lime}"/>${done ? `<path d="M71 80 l5 5 l10 -10" stroke="${C.ink}" stroke-width="3.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : `<path d="M74 71 v18 l14 -9z" fill="${C.ink}"/>`}
        ${txt(146, 46, 'Lesson 1', 11, '#5D6B64', { w: 600, ls: 0 })}${txt(146, 70, 'Price a lead', 19, C.ink)}${txt(146, 90, 'before you bid', 19, C.ink)}
        <rect x="146" y="116" width="128" height="8" rx="4" fill="#E2DED2"/><rect x="146" y="116" width="${f(128 * prog)}" height="8" rx="4" fill="${C.brand}"/>
        ${txt(146, 148, 'Foundations', 11, '#5D6B64', { w: 600, ls: 0 })}</g>`;
      const xpChip = sAt(468, 52, xp, `<rect x="430" y="36" width="78" height="32" rx="16" fill="${C.lime}"/>${txt(469, 57.5, '+50 XP', 13.5, C.ink, { a: 'middle' })}`);
      const desk = `<rect x="40" y="232" width="520" height="16" rx="8" fill="${C.paper}"/><rect x="40" y="248" width="520" height="40" fill="${mix('#0F766E', C.night, 0.55)}"/>`;
      const stand = `<rect x="288" y="212" width="24" height="22" fill="${C.ink}"/><rect x="262" y="226" width="76" height="8" rx="4" fill="${C.ink}"/>`;
      const books = `<rect x="82" y="196" width="18" height="36" rx="3" fill="#EE5A2F"/><rect x="102" y="186" width="16" height="46" rx="3" fill="${C.lime}"/><rect x="120" y="200" width="16" height="32" rx="3" fill="${C.paper2}"/>`;
      const mug = `<rect x="470" y="200" width="28" height="32" rx="7" fill="${C.brand}"/><path d="M498 206 q12 0 12 10 q0 10 -12 10" fill="none" stroke="${C.brand}" stroke-width="5"/>`;
      return `${sqs([[60, 50, 10, C.lime, 20, 0.7], [540, 120, 9, C.paper, 12, 0.5], [100, 140, 7, C.paper, 30, 0.4]])}${screen}${stand}${xpChip}${desk}${books}${mug}`;
    },
  };

  /* Community: members around a table, chat bubbles pop in turn. */
  S.community = {
    accent: '#12C784', dur: 4.2, light: [300, 260, 240],
    draw(T) {
      // Bubble i is rewritten during [w0, w0 + 1.1]: it pops out, typing dots show, then it pops back.
      const W0 = [0.3, 1.6, 2.9];
      const gone = (i) => { const w0 = W0[i]; return T >= w0 + 0.15 && T < w0 + 0.85; };
      const sc = (i) => { const w0 = W0[i]; if (T < w0 || T >= w0 + 1.2) return 1; if (T < w0 + 0.15) return 1 - eio(seg(T, w0, w0 + 0.15)); if (T < w0 + 0.85) return 0; return back(seg(T, w0 + 0.85, w0 + 1.2)); };
      const b = (i, x, y, w, h, fill, lines, tail, lc) => sAt(tail === 'l' ? x + 18 : x + w - 18, y + h, sc(i), bubble(x, y, w, h, fill, lines, tail, lc));
      const typing = (i, x, y) => op(gone(i) ? win(T, W0[i] + 0.15, W0[i] + 0.85, 0.08) : 0, `<rect x="${x}" y="${y}" width="56" height="26" rx="13" fill="${C.paper}" opacity=".9"/>${dots3(x + 28, y + 13, T)}`);
      const table = `<ellipse cx="300" cy="262" rx="230" ry="44" fill="${mix('#12C784', C.night, 0.55)}"/><ellipse cx="300" cy="252" rx="230" ry="44" fill="${C.paper}"/><ellipse cx="300" cy="252" rx="180" ry="28" fill="none" stroke="${C.paper2}" stroke-width="3"/>`;
      const cups = `<rect x="190" y="230" width="24" height="20" rx="6" fill="#12C784"/><rect x="384" y="234" width="24" height="20" rx="6" fill="${C.ink}"/><rect x="284" y="240" width="34" height="9" rx="4" fill="${C.lime}"/>`;
      return `${person(CAST[4], { x: 96, y: 112, s: 0.8, pose: 'down', blink: blinkAt(T, 4.2, 0.5) })}
        ${person(CAST[1], { x: 244, y: 86, s: 0.86, pose: 'wave', rotR: sin(T, 1.05) * 10, blink: blinkAt(T, 4.2, 2.2) })}
        ${person(CAST[2], { x: 392, y: 108, s: 0.82, pose: 'cheer', flip: true, blink: blinkAt(T, 4.2, 3.1) })}
        ${table}${cups}
        ${typing(0, 70, 56)}${b(0, 26, 40, 112, 46, C.paper, 2, 'r')}
        ${typing(1, 380, 30)}${b(1, 370, 18, 124, 46, C.lime, 2, 'l', 'rgba(10,26,19,.3)')}
        ${typing(2, 482, 88)}${b(2, 474, 80, 98, 34, C.paper, 1, 'l')}
        ${sqs([[200, 30, 9, C.lime, 20, 0.7], [560, 30, 8, C.paper, 0, 0.5]])}`;
    },
  };

  /* Affleego + Gatevoo: the deal card on the left, coins travel to a wallet held by a member on the right. */
  S.affgate = {
    accent: '#1E6A4E', dur: 3.6, light: [300, 140, 230],
    draw(T) {
      const deal = `<g transform="rotate(-5 120 130)"><rect x="40" y="62" width="168" height="128" rx="18" fill="#000" opacity=".25" transform="translate(4 6)"/><rect x="40" y="62" width="168" height="128" rx="18" fill="${C.paper}"/>${tile('affleego', 54, 76, 34)}${bars(98, 84, [80, 52], 'rgba(10,26,19,.4)', 6, 12)}
        <rect x="54" y="124" width="56" height="24" rx="12" fill="#FFE14D"/>${txt(82, 140.5, 'CPA', 11.5, C.ink, { a: 'middle', ls: 0 })}<rect x="116" y="124" width="80" height="24" rx="12" fill="none" stroke="${C.ink}" stroke-opacity=".25" stroke-width="1.5"/>${txt(156, 140.5, 'RevShare', 11.5, C.ink, { a: 'middle', ls: 0 })}
        <rect x="54" y="160" width="142" height="18" rx="9" fill="${C.ink}"/>${bars(64, 166, [60], C.lime, 6)}</g>`;
      const path = 'M214 120 C290 30 390 40 452 176';
      const coins = [0, 1, 2].map((k) => { const p = ((T / 1.8) + k / 3) % 1; const x = 214 + (452 - 214) * p; const y = 120 - Math.sin(p * Math.PI) * 70 + p * 56; return op(Math.min(1, p * 6, (1 - p) * 6), coin(x, y, 13, p * 200, Math.abs(Math.cos(p * 7)) * 0.75 + 0.25)); }).join('');
      const wallet = `<g transform="translate(22 128) scale(.86)"><rect x="0" y="16" width="112" height="74" rx="16" fill="#111"/><rect x="0" y="16" width="112" height="22" rx="11" fill="#2A2A2A"/><rect x="66" y="44" width="52" height="30" rx="10" fill="#2A2A2A"/><circle cx="84" cy="59" r="6" fill="#3E9B6F"/>${tile('gatevoo', 10, 46, 30)}</g>`;
      return `<path d="${path}" fill="none" stroke="${C.paper}" stroke-opacity=".25" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>${deal}${coins}
        ${person(CAST[5], { x: 384, y: 52, s: 1.0, pose: 'hold', blink: blinkAt(T, 3.6, 1.1), item: wallet })}${stack(110, 252, 34, 3)}${stack(150, 252, 34, 5)}
        ${sqs([[300, 196, 10, C.lime, 20, 0.8], [560, 40, 9, C.paper, 12, 0.5], [30, 30, 8, C.lime, 0, 0.6]])}`;
    },
  };

  /* Premium: the Premium mark on a plinth, two members either side, sparkles. */
  const sparkle = (x, y, r, o = 1) => `<path d="M${f(x)} ${f(y - r)} Q${f(x)} ${f(y)} ${f(x + r)} ${f(y)} Q${f(x)} ${f(y)} ${f(x)} ${f(y + r)} Q${f(x)} ${f(y)} ${f(x - r)} ${f(y)} Q${f(x)} ${f(y)} ${f(x)} ${f(y - r)}Z" fill="${C.lime}" opacity="${f(o)}"/>`;
  S.premium = {
    accent: '#00774B', dur: 3.6, light: [300, 120, 200],
    draw(T) {
      const bob = 0;
      const plinth = `<ellipse cx="300" cy="258" rx="130" ry="18" fill="#000" opacity=".25"/><rect x="220" y="208" width="160" height="40" rx="12" fill="${mix('#00774B', C.night, 0.35)}"/><rect x="220" y="208" width="160" height="10" rx="5" fill="${mix('#00774B', '#fff', 0.15)}"/><rect x="204" y="240" width="192" height="18" rx="9" fill="${mix('#00774B', C.night, 0.5)}"/>`;
      const glow = `<circle cx="300" cy="${f(122 + bob)}" r="104" fill="${C.lime}" opacity=".07"/><circle cx="300" cy="${f(122 + bob)}" r="84" fill="${C.lime}" opacity=".07"/>`;
      const mark = `<rect x="234" y="${f(56 + bob + 8)}" width="132" height="132" rx="34" fill="#000" opacity=".28"/><rect x="234" y="${f(56 + bob)}" width="132" height="132" rx="34" fill="${C.paper}"/>${pmark(262, 82 + bob, 80)}`;
      const sp = [[188, 60, 9, 0], [412, 92, 12, 0.33], [398, 36, 6, 0.66], [204, 150, 6, 0.5]].map(([x, y, r, ph]) => { const s = 0.4 + 0.6 * Math.max(0, sin(T, 1.8, ph)); return sAt(x, y, s, sparkle(x, y, r)); }).join('');
      return `${glow}${plinth}${mark}${sp}
        ${person(CAST[4], { x: 84, y: 120, s: 0.86, pose: 'cheer', rotL: sin(T, 0.9) * 6, rotR: -sin(T, 0.9) * 6, blink: blinkAt(T, 3.6, 0.7) })}
        ${person(CAST[1], { x: 396, y: 124, s: 0.84, pose: 'wave', flip: true, rotR: sin(T, 0.9, 0.3) * 12, blink: blinkAt(T, 3.6, 2.4) })}`;
    },
  };

  /* Spyvoo: a member in Spyvoo goggles reads a live ad feed; a scan line finds the long runner. */
  S.spyvoo = {
    accent: '#3355F0', dur: 4.0, light: [170, 150, 210],
    draw(T) {
      const fx = 292, fy = 18, fw = 284, fh = 246;
      // Three ads in the feed; the middle one is the long runner. The scan line sweeps down and back.
      const sy = fy + 64 + (fh - 84) * (0.5 - 0.5 * Math.cos((T / 4.0) * 2 * Math.PI));
      const hit = Math.max(0, 1 - Math.abs(sy - (fy + 150)) / 40);
      const card = (y, hue, win2) => `<g transform="translate(${fx + 12} ${y})"><rect width="${fw - 24}" height="72" rx="12" fill="#fff"/>${win2 ? `<rect x="-3" y="-3" width="${fw - 18}" height="78" rx="14" fill="none" stroke="${C.lime}" stroke-width="${f(3 + hit * 1.5)}"/>` : ''}<rect x="9" y="9" width="72" height="54" rx="8" fill="${hue}"/><path d="M9 63 L32 38 L49 53 L61 44 L81 63Z" fill="${C.ink}" opacity=".22"/>${bars(92, 14, [130, 100], 'rgba(10,26,19,.3)', 6, 12)}
          ${win2 ? `<rect x="92" y="44" width="98" height="20" rx="10" fill="${C.lime}"/>${txt(141, 58, 'Long runner', 10.5, C.ink, { a: 'middle', ls: 0 })}` : `<rect x="92" y="46" width="60" height="14" rx="7" fill="${C.ink}" opacity=".1"/>`}</g>`;
      const feed = `<defs><clipPath id="feed"><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="20"/></clipPath></defs>
        <rect x="${fx + 4}" y="${fy + 6}" width="${fw}" height="${fh}" rx="20" fill="#000" opacity=".25"/><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="20" fill="#E6E9F5"/>
        <g clip-path="url(#feed)"><rect x="${fx}" y="${fy}" width="${fw}" height="40" fill="#fff"/>${tile('spyvoo', fx + 10, fy + 8, 24)}<rect x="${fx + 44}" y="${fy + 10}" width="${fw - 56}" height="20" rx="10" fill="#E6E9F5"/>${bars(fx + 56, fy + 17, [70], 'rgba(10,26,19,.3)', 6)}
        ${card(fy + 48, '#FFB59C', false)}${card(fy + 128, '#B9C6FF', true)}${card(fy + 208, '#FFE59A', false)}
        <rect x="${fx}" y="${f(sy - 14)}" width="${fw}" height="28" fill="#3355F0" opacity=".12"/><rect x="${fx}" y="${f(sy - 1.5)}" width="${fw}" height="3" fill="#3355F0"/></g>`;
      const look = [0.95, Math.max(-1, Math.min(1, (sy - 150) / 90))];
      return `${sqs([[40, 40, 10, C.lime, 20, 0.7], [250, 236, 8, C.paper, 12, 0.5], [200, 30, 7, C.paper, 0, 0.4]])}
        ${feed}
        ${person(CAST[4], { x: 60, y: 96, s: 1.08, pose: 'point', goggles: look })}`;
    },
  };

  /* Receipt: a slip prints out, the lime check stamps it. (Premium receipt, room access.) */
  S.receipt = {
    accent: '#00A86B', dur: 3.6, light: [300, 60, 230],
    draw(T) {
      const reprint = T > 0.5 && T < 3.3;
      const p = reprint ? eo(seg(T, 0.7, 1.9)) : 1;
      const stampP = reprint ? back(seg(T, 2.0, 2.35), 2.6) : 1;
      const top = 22, slot = 168, len = slot - top;
      const terminal = `<rect x="186" y="${slot - 6}" width="228" height="96" rx="22" fill="${C.paper}"/><rect x="186" y="${slot - 6}" width="228" height="18" rx="9" fill="#fff"/><rect x="206" y="${slot + 22}" width="124" height="48" rx="10" fill="${C.ink}"/>${bars(218, slot + 36, [64, 92], C.lime, 6, 14)}<circle cx="372" cy="${slot + 40}" r="16" fill="${C.brand}"/><circle cx="372" cy="${slot + 40}" r="6" fill="${C.paper}"/><rect x="226" y="${slot - 10}" width="148" height="12" rx="6" fill="${C.ink}"/>`;
      const slip = `<defs><clipPath id="slip"><rect x="200" y="0" width="200" height="${slot - 4}"/></clipPath></defs><g clip-path="url(#slip)"><g transform="translate(0 ${f((1 - p) * len)})">
        <path d="M240 ${top} H360 V${slot} H240Z" fill="#fff"/>
        ${vmark(252, top + 12, 20)}${bars(280, top + 19, [56], 'rgba(10,26,19,.45)', 6)}${bars(252, top + 46, [96, 66, 82], 'rgba(10,26,19,.2)', 6, 14)}<path d="M252 ${top + 96} H348" stroke="rgba(10,26,19,.2)" stroke-width="2" stroke-dasharray="4 4"/><rect x="252" y="${top + 108}" width="38" height="8" rx="4" fill="rgba(10,26,19,.45)"/><rect x="310" y="${top + 106}" width="38" height="12" rx="4" fill="${C.ink}"/>
        </g></g>`;
      const stamp = sAt(366, 46, stampP, `<g transform="rotate(-12 366 46)">${check(366, 46, 22)}</g>`);
      return `${sqs([[120, 60, 10, C.lime, 20, 0.7], [480, 80, 9, C.paper, -10, 0.5], [90, 200, 7, C.paper, 30, 0.4], [500, 210, 8, C.lime, 0, 0.6]])}
        ${shadow(300, 266, 140, 10, 0.3)}${slip}${terminal}${stamp}${coin(128, 214, 18)}${stack(470, 250, 36, 4)}`;
    },
  };

  /* Payment under review: a magnifier glides over the slip, an hourglass turns. */
  S.review = {
    accent: '#33507A', dur: 4.0, light: [300, 80, 220],
    draw(T) {
      const slip = `<g transform="rotate(-4 300 140)"><rect x="214" y="34" width="172" height="216" rx="14" fill="#000" opacity=".25" transform="translate(4 6)"/><rect x="214" y="34" width="172" height="216" rx="14" fill="#fff"/>${vmark(230, 50, 24)}${bars(262, 56, [70], 'rgba(10,26,19,.45)', 6)}${bars(230, 96, [140, 110, 126, 90], 'rgba(10,26,19,.18)', 6, 16)}<path d="M230 168 H370" stroke="rgba(10,26,19,.2)" stroke-width="2" stroke-dasharray="4 4"/><rect x="230" y="182" width="50" height="9" rx="4" fill="rgba(10,26,19,.45)"/><rect x="320" y="180" width="50" height="13" rx="4" fill="${C.ink}"/><rect x="230" y="210" width="84" height="22" rx="11" fill="#FFE59A"/>${txt(272, 225, 'In review', 11, '#6B5200', { a: 'middle', ls: 0 })}</g>`;
      const mx = 300 + Math.sin((T / 4) * 2 * Math.PI) * 44, my = 124 + Math.sin((T / 4) * 4 * Math.PI) * 18;
      const mag = `<g transform="translate(${f(mx)} ${f(my)}) rotate(-30)"><rect x="-7" y="40" width="14" height="50" rx="7" fill="${C.ink}"/><circle r="40" fill="#fff" opacity=".25"/><circle r="40" fill="none" stroke="${C.ink}" stroke-width="10"/><path d="M-22 -14 A26 26 0 0 1 -6 -26" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" opacity=".8"/></g>`;
      // hourglass on the left: flips every loop end, sand falls
      const fl = seg(T, 3.5, 4.0);
      const sand = T < 3.5 ? T / 3.5 : 1;
      const hg = `<g transform="translate(110 150) rotate(${f(180 * eio(fl))})"><rect x="-38" y="-62" width="76" height="12" rx="6" fill="${C.paper}"/><rect x="-38" y="50" width="76" height="12" rx="6" fill="${C.paper}"/><path d="M-30 -50 H30 Q30 -14 4 0 Q30 14 30 50 H-30 Q-30 14 -4 0 Q-30 -14 -30 -50Z" fill="#fff" opacity=".22"/>
        <path d="M${f(-26 * (1 - sand) - 2)} ${f(-46 + 40 * sand)} H${f(26 * (1 - sand) + 2)} L2 -2 H-2Z" fill="${C.gold}"/><path d="M-26 46 H26 L${f(26 - 22 * sand)} ${f(46 - 34 * sand)} H${f(-26 + 22 * sand)}Z" fill="${C.gold}"/>${T < 3.5 ? `<rect x="-1.5" y="0" width="3" height="44" fill="${C.gold}"/>` : ''}</g>`;
      return `${sqs([[480, 50, 10, C.lime, 20, 0.7], [530, 200, 8, C.paper, -10, 0.5], [60, 40, 8, C.paper, 30, 0.4]])}${shadow(300, 262, 130, 10, 0.3)}${slip}${hg}${mag}
        ${person(CAST[5], { x: 432, y: 118, s: 0.86, pose: 'type', flip: true, blink: blinkAt(T, 4, 1.6), headset: true })}`;
    },
  };

  /* Premium expiring: a calendar with the end date ringed, pages flip toward it. */
  S.expiring = {
    accent: '#00774B', dur: 4.0, light: [300, 40, 230],
    draw(T) {
      const flip = seg(T, 0.6, 1.1);
      const cal = `<g transform="translate(206 30)"><rect x="4" y="8" width="188" height="200" rx="20" fill="#000" opacity=".25"/><rect width="188" height="200" rx="20" fill="#fff"/><rect width="188" height="50" rx="20" fill="${C.brand}"/><rect y="30" width="188" height="20" fill="${C.brand}"/><rect x="40" y="-12" width="12" height="30" rx="6" fill="${C.ink}"/><rect x="136" y="-12" width="12" height="30" rx="6" fill="${C.ink}"/>${pmark(64, 16, 22, C.ink)}${bars(94, 26, [60], 'rgba(255,255,255,.75)', 7)}`
        + (() => { let g = ''; for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) { const x = 16 + c * 28, y = 66 + r * 32; const d = r * 6 + c; g += d === 20 ? `<rect x="${x}" y="${y}" width="20" height="20" rx="6" fill="${C.ink}"/>` : `<rect x="${x + 4}" y="${y + 7}" width="12" height="6" rx="3" fill="${d < 20 ? 'rgba(10,26,19,.14)' : 'rgba(10,26,19,.3)'}"/>`; } return g; })()
        + `<circle cx="${16 + 2 * 28 + 10}" cy="${66 + 3 * 32 + 10}" r="${f(17 + 2 * Math.max(0, sin(T, 1.0)))}" fill="none" stroke="${C.lime}" stroke-width="4"/></g>`;
      const page = op((1 - flip) * eo(seg(T, 0.25, 0.45)), `<g transform="translate(206 80) scale(1 ${f(1 - eio(flip))})"><rect width="188" height="150" rx="16" fill="#fff"/>${bars(16, 20, [40], 'rgba(10,26,19,.14)', 6)}</g>`);
      const hand = `<g transform="translate(470 120) rotate(${f(-20 + sin(T, 4) * 4)})"><circle r="44" fill="${C.paper}"/><circle r="36" fill="#fff"/><path d="M0 0 V-24" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/><path d="M0 0 L${f(Math.sin((T / 4) * 2 * Math.PI) * 18)} ${f(-Math.cos((T / 4) * 2 * Math.PI) * 18)}" stroke="${C.brand}" stroke-width="4" stroke-linecap="round"/><circle r="4" fill="${C.ink}"/></g>`;
      return `${sqs([[90, 50, 10, C.lime, 20, 0.7], [540, 220, 8, C.paper, -10, 0.5], [130, 210, 8, C.paper, 30, 0.4]])}${shadow(300, 254, 120, 10, 0.3)}${cal}${page}${hand}
        ${person(CAST[1], { x: 40, y: 128, s: 0.84, pose: 'point', blink: blinkAt(T, 4, 0.9) })}`;
    },
  };

  /* Support: a helper with a headset at a desk; the question bubble gets an answer. */
  S.support = {
    accent: '#475569', dur: 4.0, light: [300, 70, 220],
    draw(T) {
      const desk = `<rect x="150" y="226" width="300" height="16" rx="8" fill="${C.paper}"/><rect x="170" y="242" width="14" height="40" rx="5" fill="${C.paper2}"/><rect x="416" y="242" width="14" height="40" rx="5" fill="${C.paper2}"/>`;
      const laptop = `<path d="M246 160 H354 Q360 160 360 166 V224 H240 V166 Q240 160 246 160Z" fill="${C.ink}"/><rect x="250" y="168" width="100" height="50" rx="5" fill="#64748B"/><path d="M262 206 L282 192 L296 200 L316 182 L336 188" fill="none" stroke="${C.lime}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M226 224 H374 L380 232 H220Z" fill="${C.paper2}"/>`;
      const mug = `<rect x="398" y="196" width="26" height="30" rx="7" fill="#94A3B8"/><path d="M424 202 q11 0 11 9 q0 9 -11 9" fill="none" stroke="#94A3B8" stroke-width="5"/>`;
      const q = `<g transform="translate(48 50)"><rect width="104" height="78" rx="24" fill="${C.paper}"/><path d="M74 76 l10 18 l6 -20z" fill="${C.paper}"/>${bars(18, 22, [68, 52, 34], 'rgba(10,26,19,.3)', 7, 14)}</g>`;
      const typing = win(T, 0.45, 1.45, 0.12) * (T > 0.4 ? 1 : 0);
      const ans = T < 0.4 ? 1 : back(seg(T, 1.45, 1.8));
      const out = 1 - eio(seg(T, 3.6, 4.0));
      const a = sAt(470, 130, ans * (T < 0.4 ? 1 : out), `<g transform="translate(446 46)"><rect width="110" height="84" rx="24" fill="${C.lime}"/><path d="M26 82 l-10 18 l-6 -20z" fill="${C.lime}"/>${bars(18, 20, [74, 56], 'rgba(10,26,19,.35)', 7, 14)}${check(84, 60, 13, C.ink, C.lime)}</g>`);
      const ty = op(typing, `<g transform="translate(470 92)"><rect x="-6" y="-2" width="70" height="32" rx="16" fill="${C.lime}"/>${dots3(29, 14, T)}</g>`);
      const path = `<path d="M160 96 Q300 10 438 86" fill="none" stroke="${C.paper}" stroke-opacity=".3" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>`;
      return `${shadow(300, 276, 170, 10, 0.3)}${path}
        ${person(CAST[1], { x: 216, y: 52, s: 1.18, pose: 'type', headset: true, shirt: '#64748B', blink: blinkAt(T, 4, 1.3) })}
        ${desk}${laptop}${mug}${q}${ty}${a}`;
    },
  };

  /* Room applications: the invite card, a spotlight and a small row of seats (the Inner Circle look). */
  const SEATCOL = '#1D3A2C';
  const cone = `<path d="M240 0 H360 L470 280 H130Z" fill="${C.lime}" opacity=".05"/><path d="M270 0 H330 L400 280 H200Z" fill="${C.lime}" opacity=".04"/>`;
  const seatBack = (x, y, col) => `<rect x="${x}" y="${y}" width="56" height="46" rx="15" fill="${col}"/>`;
  const seatFront = (x, y, col) => `<rect x="${x - 4}" y="${y + 30}" width="64" height="24" rx="10" fill="${mix(col, '#000', 0.25)}"/><rect x="${x + 8}" y="${y + 54}" width="6" height="12" rx="3" fill="${C.ink}"/><rect x="${x + 42}" y="${y + 54}" width="6" height="12" rx="3" fill="${C.ink}"/>`;
  /** A seat, optionally with a member sitting in it (head and shoulders above the back). */
  const seat = (x, y, col, who, T, glow, i = 0) => `${glow ? `<rect x="${x - 8}" y="${y - 8}" width="72" height="76" rx="20" fill="${C.lime}" opacity="${f(glow)}"/>` : ''}${who ? person(who, { x: x + 28 - 29.4, y: y - 50, s: 0.42, pose: 'down', blink: blinkAt(T || 0, 3.6, i * 0.8) }) : ''}${seatBack(x, y, col)}${seatFront(x, y, col)}`;
  /** The invite card. */
  const invite = (x, y, s = 1, rot = 0) => `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${s})"><rect x="4" y="7" width="170" height="108" rx="16" fill="#000" opacity=".3"/><rect width="170" height="108" rx="16" fill="${C.paper}"/><rect width="170" height="34" rx="16" fill="${C.ink}"/><rect y="18" width="170" height="16" fill="${C.ink}"/>${pmark(14, 8, 18)}${txt(42, 22.5, 'Invite only', 11.5, C.paper, { w: 700, ls: 0 })}
    ${bars(16, 48, [104, 76], 'rgba(10,26,19,.3)', 6, 13)}${[0, 1, 2].map((k) => badge(CAST[k + 4], 30 + k * 20, 88, 10, { w: 2, c: C.paper })).join('')}<circle cx="140" cy="80" r="17" fill="${C.lime}"/>${pmark(131, 71, 18)}</g>`;
  S.apply_received = {
    accent: '#16302A', dark: true, dur: 3.6, light: [300, 20, 250],
    draw(T) {
      const drop = T > 0.5 && T < 3.3 ? eo(seg(T, 0.7, 1.6)) : 1;
      const cardY = 30 - (1 - drop) * 150;
      const tray = `<path d="M188 170 H412 L390 242 H210Z" fill="${C.paper2}"/><path d="M188 170 H412 L405 190 H195Z" fill="#fff" opacity=".6"/><rect x="178" y="160" width="244" height="16" rx="8" fill="${C.paper}"/>`;
      const tag = op(T < 0.5 || T > 1.7 ? 1 : 0, `<rect x="430" y="96" width="122" height="32" rx="16" fill="${C.lime}"/>${txt(491, 117, 'Reply in 48h', 12.5, C.ink, { a: 'middle', ls: 0 })}`);
      return `${cone}${shadow(300, 250, 120, 10, 0.4)}
        <defs><clipPath id="tray"><rect x="0" y="0" width="600" height="172"/></clipPath></defs><g clip-path="url(#tray)">${invite(215, cardY + 40, 1, -3)}</g>${tray}${tag}
        ${sqs([[110, 50, 10, C.lime, 20, 0.7], [500, 200, 8, C.paper, -10, 0.4], [60, 150, 7, C.paper, 30, 0.3]])}`;
    },
  };
  S.apply_approved = {
    accent: '#16302A', dark: true, dur: 3.6, light: [300, 20, 250],
    draw(T) {
      const g = 0.18 + 0.16 * Math.max(0, sin(T, 1.2));
      const row = [[70, 4], [150, 0], [230, -1], [310, 'held'], [390, 6], [470, -1]].map(([x, w], i) => (w === 'held' ? seat(x, 196, '#2F6B4C', null, T, g) : seat(x, 196, SEATCOL, w >= 0 ? CAST[w] : null, T, 0, i))).join('');
      const st = T > 0.5 && T < 3.3 ? back(seg(T, 0.9, 1.3), 2.6) : 1;
      const stamp = sAt(390, 44, st, `<g transform="rotate(-10 390 44)">${check(390, 44, 22)}</g>`);
      const arrow = `<path d="M336 140 Q352 162 338 186" fill="none" stroke="${C.lime}" stroke-width="3" stroke-dasharray="2 7" stroke-linecap="round"/><path d="M332 180 l6 8 l6 -9" fill="none" stroke="${C.lime}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
      return `${cone}${row}${invite(212, 22, 1, -4)}${stamp}${arrow}
        ${sqs([[110, 40, 10, C.lime, 20, 0.7], [520, 50, 8, C.paper, -10, 0.4], [60, 120, 7, C.paper, 30, 0.3]])}`;
    },
  };
  S.apply_waitlist = {
    accent: '#16302A', dark: true, dur: 3.6, light: [260, 20, 250],
    draw(T) {
      const row = [40, 112, 184, 256, 328].map((x, i) => seat(x, 196, SEATCOL, CAST[(i + 2) % 8], T, 0, i)).join('');
      const sway = sin(T, 1.8) * 5;
      const ticket = `<g transform="translate(486 214) rotate(${f(sway - 8)})"><rect x="-28" y="-18" width="56" height="36" rx="8" fill="${C.lime}"/><circle cx="-28" cy="0" r="6" fill="${C.night}"/><circle cx="28" cy="0" r="6" fill="${C.night}"/>${txt(0, 5.5, 'Next', 13, C.ink, { a: 'middle', ls: 0 })}</g>`;
      const sign = `<g transform="translate(150 34)"><rect width="168" height="70" rx="16" fill="${C.paper}"/><path d="M84 70 v22" stroke="${C.paper}" stroke-width="5"/>${pmark(16, 16, 24)}${txt(50, 34, 'Full', 15, C.ink, { ls: 0 })}${bars(50, 46, [96], 'rgba(10,26,19,.3)', 6)}</g>`;
      return `${cone}${sign}${row}${person(CAST[1], { x: 424, y: 96, s: 0.86, pose: 'hold', blink: blinkAt(T, 3.6, 2) })}${ticket}
        ${sqs([[60, 40, 10, C.lime, 20, 0.7], [540, 40, 8, C.paper, -10, 0.4]])}`;
    },
  };
  S.apply_rejected = {
    accent: '#16302A', dark: true, dur: 4.0, light: [300, 20, 250],
    draw(T) {
      const leaf = seg(T, 1.0, 1.5);
      const cal = `<g transform="translate(366 50)"><rect x="4" y="6" width="120" height="132" rx="16" fill="#000" opacity=".25"/><rect width="120" height="132" rx="16" fill="#fff"/><rect width="120" height="36" rx="16" fill="${C.ink}"/><rect y="20" width="120" height="16" fill="${C.ink}"/>${bars(16, 14, [60], 'rgba(242,239,230,.7)', 6)}`
        + (() => { let g = ''; for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) { const x = 14 + c * 25, y = 50 + r * 26; g += (r === 2 && c === 2) ? `<rect x="${x}" y="${y}" width="18" height="18" rx="5" fill="${C.lime}"/>` : `<rect x="${x + 3}" y="${y + 6}" width="12" height="6" rx="3" fill="rgba(10,26,19,.2)"/>`; } return g; })() + '</g>';
      const pg = op(eo(seg(T, 0.5, 0.7)) * (1 - leaf), `<g transform="translate(366 86) scale(1 ${f(1 - eio(leaf))})"><rect width="120" height="96" rx="12" fill="#fff"/><rect x="14" y="14" width="40" height="8" rx="4" fill="rgba(10,26,19,.2)"/></g>`);
      return `${cone}${sqs([[100, 50, 9, C.lime, 20, 0.6], [540, 220, 8, C.paper, -10, 0.4]])}${shadow(320, 250, 170, 10, 0.35)}
        ${invite(186, 72, 1, -6)}${cal}${pg}
        <path d="M330 222 q40 24 80 0" fill="none" stroke="${C.lime}" stroke-width="3" stroke-dasharray="2 8" stroke-linecap="round"/><path d="M406 214 l8 8 l-10 4" fill="none" stroke="${C.lime}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        ${person(CAST[3], { x: 30, y: 100, s: 0.94, pose: 'hold', blink: blinkAt(T, 4, 1.2), item: `<g transform="rotate(-8 70 146)"><rect x="40" y="124" width="60" height="44" rx="6" fill="#fff"/>${bars(48, 134, [40, 30, 36], 'rgba(10,26,19,.3)', 5, 9)}</g>` })}`;
    },
  };

  /* Payouts. */
  const phoneSm = (x, y, inner, rot = 0) => `<g transform="translate(${x} ${y}) rotate(${rot})"><rect x="3" y="6" width="96" height="170" rx="18" fill="#000" opacity=".25"/><rect width="96" height="170" rx="18" fill="${C.ink}"/><rect x="6" y="6" width="84" height="158" rx="13" fill="${C.paper}"/><rect x="34" y="10" width="28" height="6" rx="3" fill="${C.ink}"/>${inner}</g>`;
  S.payout_requested = {
    accent: '#00A86B', dur: 3.6, light: [250, 60, 230],
    draw(T) {
      const form = `${bars(16, 30, [50], 'rgba(10,26,19,.45)', 6)}<rect x="14" y="46" width="68" height="40" rx="10" fill="#fff"/>${coin(32, 66, 10)}${bars(48, 60, [26], C.ink, 9)}<rect x="14" y="94" width="68" height="18" rx="9" fill="#fff"/>${bars(22, 100, [40], 'rgba(10,26,19,.3)', 6)}<rect x="14" y="126" width="68" height="24" rx="12" fill="${C.brand}"/>${bars(30, 135, [36], '#fff', 6)}`;
      const lane = `<path d="M200 170 H470" stroke="${C.paper}" stroke-opacity=".22" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/>`;
      const p = (T % 1.8) / 1.8;
      const env = `<g transform="translate(${f(200 + 260 * eio(p))} ${f(170 - Math.sin(p * Math.PI) * 40)})">${op(Math.min(1, p * 8, (1 - p) * 8), `<rect x="-20" y="-14" width="40" height="28" rx="6" fill="#fff"/><path d="M-20 -12 L0 4 L20 -12" fill="none" stroke="${C.brand}" stroke-width="3" stroke-linejoin="round"/>`)}</g>`;
      const desk = `<g transform="translate(470 92)"><rect width="110" height="120" rx="18" fill="${C.paper}"/>${vmark(14, 14, 26)}${bars(46, 20, [50], 'rgba(10,26,19,.45)', 6)}${[0, 1, 2].map((i) => `<rect x="14" y="${54 + i * 20}" width="82" height="14" rx="7" fill="${i === 0 ? C.lime : '#E6E2D6'}"/>`).join('')}<circle cx="${f(26 + 60 * ((T / 3.6) % 1))}" cy="61" r="3" fill="${C.ink}" opacity=".4"/></g>`;
      const clock = `<g transform="translate(400 70)"><circle r="20" fill="#fff"/><path d="M0 0 V-12" stroke="${C.ink}" stroke-width="3" stroke-linecap="round"/><path d="M0 0 L${f(Math.sin((T / 3.6) * 2 * Math.PI) * 11)} ${f(-Math.cos((T / 3.6) * 2 * Math.PI) * 11)}" stroke="${C.brand}" stroke-width="3" stroke-linecap="round"/></g>`;
      return `${sqs([[60, 40, 10, C.lime, 20, 0.7], [560, 240, 8, C.paper, -10, 0.4], [400, 60, 9, C.paper, 12, 0.4]])}${lane}${env}${desk}
        ${person(CAST[6], { x: 40, y: 40, s: 1.15, pose: 'hold', blink: blinkAt(T, 3.6, 1.1), item: `<g transform="translate(48 116) rotate(-5) scale(.46)">${phoneSm(0, 0, form, 0)}</g>` })}`;
    },
  };
  S.payout_paid = {
    accent: '#00A86B', dur: 3.2, light: [300, 60, 240],
    draw(T) {
      const fall = [[150, 0, 0], [420, 0.8, 2], [470, 1.6, 0], [190, 2.4, 2]].map(([x, off, kind]) => {
        const p = ((T / 3.2) + off / 3.2) % 1; const y = -30 + p * 330; const rot = p * 300 + x;
        return kind === 2 ? note(x - 24, y - 12, 48, 26, rot) : coin(x, y, 11, rot, Math.abs(Math.cos(p * 9)) * 0.7 + 0.3);
      }).join('');
      const fan = `<g transform="translate(300 118)">${note(-74, -46, 64, 36, -28)}${note(-56, -60, 64, 36, -12)}${note(-36, -66, 64, 36, 4)}</g>`;
      return `${sqs([[70, 50, 10, C.lime, 20, 0.7], [540, 40, 9, C.paper, -10, 0.5]])}${fall}${shadow(300, 270, 120, 10, 0.3)}
        ${person(CAST[0], { x: 222, y: 92, s: 1.12, pose: 'cheer', blink: blinkAt(T, 3.2, 1.4), item: '' })}
        ${mv(-76, -6, `${note(214, 52, 56, 30, -24)}${note(226, 46, 56, 30, -10)}`)}${mv(0, -6, `${note(338, 50, 56, 30, 24)}${note(330, 44, 56, 30, 10)}`)}
        ${stack(110, 262, 40, 6)}${stack(156, 262, 40, 3)}${stack(470, 262, 40, 5)}${check(520, 160, 18)}`;
    },
  };
  S.payout_rejected = {
    accent: '#5A6B63', dur: 3.6, light: [300, 60, 220],
    draw(T) {
      const jar = `<g transform="translate(300 70)"><rect x="-70" y="0" width="140" height="170" rx="30" fill="#fff" opacity=".18"/><rect x="-58" y="-16" width="116" height="24" rx="10" fill="${C.paper}"/>${stack(-26, 158, 40, 4)}${stack(22, 158, 40, 6)}<rect x="-70" y="0" width="140" height="170" rx="30" fill="none" stroke="${C.paper}" stroke-opacity=".5" stroke-width="3"/></g>`;
      const p = (T % 1.8) / 1.8;
      const ret = op(Math.min(1, p * 6, (1 - p) * 6), coin(470 - 170 * eio(p), 110 - Math.sin(p * Math.PI) * 60 + p * 60, 13, -p * 200, Math.abs(Math.cos(p * 7)) * 0.7 + 0.3));
      const arc = `<path d="M470 110 Q390 30 330 150" fill="none" stroke="${C.paper}" stroke-opacity=".3" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round"/><path d="M336 140 l-6 12 l12 -2" fill="none" stroke="${C.paper}" stroke-opacity=".5" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
      const memo = `<g transform="translate(450 140) rotate(5)"><rect width="110" height="82" rx="14" fill="${C.paper}"/>${bars(14, 16, [70, 82, 50], 'rgba(10,26,19,.3)', 6, 14)}<rect x="14" y="58" width="44" height="14" rx="7" fill="${C.ink}"/></g>`;
      return `${sqs([[70, 50, 10, C.lime, 20, 0.6], [560, 40, 8, C.paper, -10, 0.4]])}${shadow(300, 252, 110, 10, 0.3)}${arc}${jar}${ret}${memo}
        ${person(CAST[3], { x: 40, y: 122, s: 0.86, pose: 'down', blink: blinkAt(T, 3.6, 0.9) })}`;
    },
  };

  /* Team invite: a lanyard badge swings, the admin key glints. */
  S.team = {
    accent: '#0F766E', dur: 3.6, light: [300, 30, 230],
    draw(T) {
      const a = 0;
      const badgeCard = `<g transform="rotate(${f(a)} 300 -20)"><path d="M270 -20 L292 70 M330 -20 L308 70" stroke="${C.lime}" stroke-width="8" stroke-linecap="round"/><rect x="286" y="64" width="28" height="18" rx="6" fill="${C.paper2}"/>
        <rect x="234" y="78" width="132" height="172" rx="18" fill="#000" opacity=".25" transform="translate(4 6)"/><rect x="234" y="78" width="132" height="172" rx="18" fill="#fff"/><rect x="234" y="78" width="132" height="44" rx="18" fill="${C.brand}"/><rect x="234" y="104" width="132" height="18" fill="${C.brand}"/>${vmark(246, 86, 26, null)}${bars(278, 94, [60], 'rgba(255,255,255,.8)', 6)}
        ${badge(CAST[2], 300, 158, 26, { w: 3, c: C.lime })}${bars(256, 196, [88, 64], 'rgba(10,26,19,.3)', 7, 14)}<rect x="256" y="226" width="54" height="14" rx="7" fill="${C.ink}"/></g>`;
      const key = `<g transform="translate(460 150) rotate(${f(-30 + sin(T, 1.8) * 4)})"><circle r="24" fill="${C.lime}"/><circle r="9" fill="${mix('#0F766E', C.night, 0.8)}"/><rect x="20" y="-6" width="64" height="12" rx="6" fill="${C.lime}"/><rect x="62" y="4" width="8" height="16" rx="3" fill="${C.lime}"/><rect x="76" y="4" width="8" height="12" rx="3" fill="${C.lime}"/></g>`;
      return `${sqs([[90, 60, 10, C.lime, 20, 0.7], [530, 50, 9, C.paper, -10, 0.5], [110, 200, 8, C.paper, 30, 0.4]])}${badgeCard}${key}
        ${person(CAST[4], { x: 40, y: 128, s: 0.84, pose: 'wave', rotR: sin(T, 0.9) * 10, blink: blinkAt(T, 3.6, 2) })}`;
    },
  };

  /* Broadcast: a megaphone with arcs, for news from the team. */
  S.broadcast = {
    accent: '#00A86B', dur: 3.0, light: [300, 140, 220],
    draw(T) {
      const arcs = [0, 1, 2].map((i) => { const p = ((T / 1.5) + i / 3) % 1; const r = 30 + p * 120; return `<path d="M${f(380 + r * 0.2)} ${f(132 - r)} Q${f(380 + r * 1.05)} 132 ${f(380 + r * 0.2)} ${f(132 + r)}" fill="none" stroke="${i === 0 ? C.lime : C.paper}" stroke-width="${f(6 - p * 3)}" stroke-linecap="round" opacity="${f((1 - p) * 0.9)}"/>`; }).join('');
      const mega = `<g transform="rotate(-10 300 140)"><rect x="196" y="120" width="56" height="70" rx="18" fill="${C.ink}"/><path d="M246 116 L370 60 L370 222 L246 186 Z" fill="${C.paper}"/><path d="M246 116 L370 60 L370 92 L246 136 Z" fill="#fff" opacity=".55"/><rect x="360" y="52" width="28" height="178" rx="14" fill="${C.brand}"/><rect x="367" y="62" width="9" height="158" rx="4.5" fill="#fff" opacity=".3"/><rect x="232" y="132" width="26" height="62" rx="10" fill="${C.brand}"/><path d="M226 190 l-6 42 q-2 11 10 11 h14 q10 0 8 -11 l-5 -42Z" fill="${C.ink}"/></g>`;
      return `${shadow(300, 262, 140, 10, 0.3)}${mega}${arcs}${sqs([[100, 60, 16, C.lime, 18], [140, 200, 10, C.paper, -12, 0.7], [70, 150, 8, C.paper, 12, 0.5], [530, 230, 10, C.lime, 30, 0.8]])}`;
    },
  };

  /* Login: a lock and the code. A still picture (no animation). */
  S.login = {
    accent: '#00A86B', dur: 0, light: [300, 150, 170], h: 150,
    draw() {
      const lock = `<g transform="translate(250 22)"><path d="M18 52 V36 a32 32 0 0 1 64 0 V52" fill="none" stroke="${C.paper2}" stroke-width="12" stroke-linecap="round"/><rect x="0" y="50" width="100" height="78" rx="20" fill="${C.paper}"/><rect x="0" y="50" width="100" height="16" rx="8" fill="#fff" opacity=".7"/><circle cx="50" cy="84" r="9" fill="${C.ink}"/><rect x="46" y="88" width="8" height="20" rx="4" fill="${C.ink}"/></g>`;
      const digits = (x0) => [0, 1, 2].map((i) => `<rect x="${x0 + i * 28}" y="70" width="22" height="30" rx="7" fill="${C.ink}" opacity=".55"/><circle cx="${x0 + i * 28 + 11}" cy="85" r="4" fill="${C.lime}"/>`).join('');
      return `${digits(132)}${digits(384)}${lock}${sqs([[90, 30, 9, C.lime, 20, 0.6], [500, 110, 8, C.paper, -10, 0.4]])}`;
    },
  };

  /* ---------------- registry ---------------- */
  // file: output name in public/email; who: which templates use it (for the contact sheet).
  const HEROES = [
    { key: 'welcome', file: 'hero-welcome.gif', alt: 'Three VooSquare members at a desk under the VooSquare mark' },
    { key: 'tools', file: 'tools.gif', alt: 'One Voo ID card next to the eight Voo tools: Spyvoo, Affleego, Vooads, Landvoo, Joinvoo, Replyvoo, Castvoo and Gatevoo' },
    { key: 'joinvoo', file: 'joinvoo.gif', alt: 'Real members walk through the Joinvoo gate while a bot is stopped' },
    { key: 'vooads', file: 'vooads.gif', alt: 'One line of text becomes three checked ads in different sizes' },
    { key: 'replycast', file: 'replycast.gif', alt: 'A chat answered at night on a phone, and a broadcast reaching subscribers' },
    { key: 'academy', file: 'academy.gif', alt: 'A Traffic Banking 101 lesson completing on screen, plus 50 XP' },
    { key: 'community', file: 'community.gif', alt: 'Members chatting around a table' },
    { key: 'affgate', file: 'affleego-gatevoo.gif', alt: 'An offer card on the left, coins travelling to a wallet on the right' },
    { key: 'premium', file: 'premium.gif', alt: 'The VooSquare Premium mark on a plinth between two members' },
    { key: 'spyvoo', file: 'spyvoo.gif', alt: 'A member in Spyvoo goggles reading a feed of ads, one marked as a long runner' },
    { key: 'receipt', file: 'receipt.gif', alt: 'A receipt printing out with a check mark' },
    { key: 'review', file: 'review.gif', alt: 'A payment slip under a magnifier, marked In review' },
    { key: 'expiring', file: 'expiring.gif', alt: 'A calendar with the end date ringed' },
    { key: 'support', file: 'support.gif', alt: 'A support teammate with a headset answering a question' },
    { key: 'apply_received', file: 'apply-received.gif', alt: 'An invite card dropping into a tray' },
    { key: 'apply_approved', file: 'apply-approved.gif', alt: 'An approved invite card above a row of seats, one held for you' },
    { key: 'apply_waitlist', file: 'apply-waitlist.gif', alt: 'A full row of seats and a member holding a Next ticket' },
    { key: 'apply_rejected', file: 'apply-rejected.gif', alt: 'An invite card and a calendar with a later date marked' },
    { key: 'payout_requested', file: 'payout-requested.gif', alt: 'A member sending a payout request from a phone to the team' },
    { key: 'payout_paid', file: 'payout-paid.gif', alt: 'A member cheering with cash while coins fall' },
    { key: 'payout_rejected', file: 'payout-rejected.gif', alt: 'Coins returning to a balance jar' },
    { key: 'team', file: 'team.gif', alt: 'A VooSquare team badge on a lanyard and a key' },
    { key: 'broadcast', file: 'broadcast.gif', alt: 'A megaphone' },
    { key: 'login', file: 'login.png', alt: '' },
  ];

  function svg(key, T) {
    const s = S[key];
    const h = { accent: s.accent, dark: s.dark, light: s.light, h: s.h };
    const out = plate(h, (t) => s.draw(t), T);
    return s.h ? out.replace(`height="${H}" viewBox="0 0 ${W} ${H}"`, `height="${s.h}" viewBox="0 0 ${W} ${s.h}"`) : out;
  }
  const info = (key) => { const s = S[key]; return { dur: s.dur, h: s.h || H, colors: plateColors(s.accent, s.dark) }; };

  window.EMAIL_ART = { HEROES, svg, info, plateColors, mix };
})();
