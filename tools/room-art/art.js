/* VooSquare room artwork: hand-built SVG plates, one per seeded room, in one house style.
 *
 * House style ("plates")
 *  - Each room sits on its own dark plate: the room accent sunk into the VooSquare night green, a faint square grid
 *    (the "squared" motif) and one soft light source. Foreground is flat colour, no outlines.
 *  - Shared inks: ink #0A1A13, paper #F2EFE6 (warm off-white), lime #C9F65B as the one bright highlight.
 *  - People are the VooSquare cartoon members (VS.avatar parts), so rooms and profiles feel like one world.
 *  - No real people, no third-party logos or brand marks: planes, phones and maps are generic shapes.
 *
 * Square plates are 512x512. Covers are 1200x400: the same scene on the right, with a quieter extension on the
 * left where the app lays text over it.
 *
 * Used by index.html + render.py (Chromium) to write public/assets/rooms/<slug>.webp and <slug>-cover.webp.
 */
(function () {
  'use strict';
  const VS = window.VS;

  /* ---------------- colour ---------------- */
  const hex = (c) => { c = c.replace('#', ''); if (c.length === 3) c = c.split('').map((x) => x + x).join(''); return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16)); };
  const toHex = (a) => '#' + a.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  /** Mix colour a toward b by t (0..1). */
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const C = { ink: '#0A1A13', night: '#0A1611', paper: '#F2EFE6', paper2: '#DCD8CB', lime: '#C9F65B', brand: '#00A86B', mint: '#12C784' };

  /* ---------------- people (VooSquare cartoon members) ---------------- */
  const n = (a, k) => Math.abs(Number(a[k]) || 0) % VS.AV.counts[k];
  /** The avatar face without its round background, body and neck: drawn in a 64x64 box, face centre ~ (32, 30). */
  function faceOnly(a) {
    const raw = VS.avatar(a, { still: true }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    return raw.replace(/<rect width="64" height="64" fill="[^"]+"\/>/, '').replace(/<path d="M8 66C10 50[^>]*\/>/, '').replace(/<rect x="27.5" y="38"[^>]*\/>/, '');
  }
  /** A round avatar badge (with its own background), centre (cx, cy), radius r. */
  function badge(a, cx, cy, r, ring) {
    const raw = VS.avatar(a, { still: true }).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const s = (r * 2) / 64;
    return `${ring ? `<circle cx="${cx}" cy="${cy}" r="${r + ring.w}" fill="${ring.c}"/>` : ''}<g transform="translate(${cx - r} ${cy - r}) scale(${s})">${raw}</g>`;
  }
  /**
   * A standing or seated member in a 140x170 box (head top ~ y 18, shoulders ~ y 110).
   * pose: 'down' | 'wave' | 'type' | 'point' | 'cheer'
   */
  function person(a, { x = 0, y = 0, s = 1, shirt, pose = 'down', flip = false, headset = false } = {}) {
    const skin = VS.AV.skins[n(a, 'skin')];
    shirt = shirt || VS.AV.shirts[n(a, 'shirt')];
    const arm = (d, hx, hy, r = 6.5) => `<path d="${d}" stroke="${shirt}" stroke-width="13" fill="none" stroke-linecap="round"/><circle cx="${hx}" cy="${hy}" r="${r}" fill="${skin}"/>`;
    const L = { down: arm('M44 128 Q36 146 46 160', 47, 162), type: arm('M44 128 Q34 142 50 152', 52, 152), wave: arm('M44 128 Q36 146 46 160', 47, 162), point: arm('M44 128 Q36 146 46 160', 47, 162), cheer: arm('M44 126 Q28 112 26 90', 26, 84, 7.5) }[pose];
    const R = { down: arm('M96 128 Q104 146 94 160', 93, 162), type: arm('M96 128 Q106 142 90 152', 88, 152), wave: arm('M96 126 Q112 112 114 90', 114, 84, 7.5), point: arm('M96 124 Q120 118 134 104', 138, 101, 7), cheer: arm('M96 126 Q112 112 114 90', 114, 84, 7.5) }[pose];
    const hs = headset ? '<g fill="none" stroke="#0A1A13" stroke-width="4" stroke-linecap="round"><path d="M42 54 Q42 18 70 18 Q98 18 98 54"/></g><rect x="36" y="48" width="11" height="18" rx="5" fill="#0A1A13"/><rect x="93" y="48" width="11" height="18" rx="5" fill="#0A1A13"/><path d="M99 62 Q98 80 82 82" stroke="#0A1A13" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="80" cy="82" r="3.5" fill="#C9F65B"/>' : '';
    const body = `<path d="M30 172C32 124 48 108 70 108C92 108 108 124 110 172Z" fill="${shirt}"/><path d="M62 108 L70 120 L78 108" fill="rgba(255,255,255,.2)"/><rect x="62" y="94" width="16" height="18" rx="6" fill="${skin}"/><g transform="translate(25.2 25) scale(1.4)">${faceOnly(a)}</g>${hs}${L}${R}`;
    const t = flip ? `translate(${x + 140 * s} ${y}) scale(${-s} ${s})` : `translate(${x} ${y}) scale(${s})`;
    return `<g transform="${t}">${body}</g>`;
  }
  // A small, steady cast. Seeds are fixed so every render is identical.
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

  /** Dchessking, the founder illustration, without the crown. Head centre ~ (100, 92) in a 200x240 box. */
  function founderFig(x, y, s) {
    const raw = VS.founder(true).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<g transform="translate\(100 34\)">[\s\S]*?<\/g>/, '');
    return `<g transform="translate(${x} ${y}) scale(${s})">${raw}</g>`;
  }

  /* ---------------- small props ---------------- */
  const sq = (x, y, w, fill, r = w * 0.26, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${r}" fill="${fill}" ${extra}/>`;
  /** A chat bubble with a tail and text lines. */
  function bubble(x, y, w, h, fill, lines, tail = 'l', lineCol = 'rgba(10,26,19,.22)') {
    const tx = tail === 'l' ? x + 18 : x + w - 18;
    const tl = tail === 'l' ? `M${tx} ${y + h - 2} l-4 16 l18 -16Z` : `M${tx} ${y + h - 2} l4 16 l-18 -16Z`;
    let ls = '';
    for (let i = 0; i < lines; i++) ls += `<rect x="${x + 14}" y="${y + 14 + i * 13}" width="${(w - 28) * (i === lines - 1 ? 0.6 : 1)}" height="6" rx="3" fill="${lineCol}"/>`;
    return `<path d="${tl}" fill="${fill}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(16, h / 2)}" fill="${fill}"/>${ls}`;
  }
  /** Floating confetti squares. */
  function confetti(list) { return list.map(([x, y, w, c, rot = 0, o = 1]) => `<rect x="${x}" y="${y}" width="${w}" height="${w}" rx="${w * 0.25}" fill="${c}" opacity="${o}" transform="rotate(${rot} ${x + w / 2} ${y + w / 2})"/>`).join(''); }
  /** The Premium mark: an ink square with its lime exponent. */
  const pmark = (x, y, w) => `<rect x="${x}" y="${y + w * 0.26}" width="${w * 0.74}" height="${w * 0.74}" rx="${w * 0.2}" fill="${C.ink}"/><rect x="${x + w * 0.16}" y="${y + w * 0.58}" width="${w * 0.24}" height="${w * 0.24}" rx="${w * 0.07}" fill="none" stroke="rgba(201,246,91,.4)" stroke-width="${w * 0.03}"/><rect x="${x + w * 0.69}" y="${y}" width="${w * 0.31}" height="${w * 0.31}" rx="${w * 0.09}" fill="${C.lime}"/>`;
  const shadow = (cx, cy, rx, ry = rx * 0.16, o = 0.32) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity="${o}"/>`;

  /** The Premium hallmark: same size and place on every premium plate. */
  const HALL = `<rect x="428" y="24" width="64" height="64" rx="20" fill="#fff" opacity=".08"/>${pmark(438, 34, 44)}`;

  /* ---------------- scenes (512x512 stage) ---------------- */
  const S = {};

  S.announcements = (k) => {
    const a = k.accent;
    const arcs = [0, 1, 2].map((i) => `<path d="M${352 + i * 30} ${150 - i * 26} Q${392 + i * 40} ${206} ${352 + i * 30} ${262 + i * 26}" fill="none" stroke="${i ? C.paper : C.lime}" stroke-width="${10 - i * 2}" stroke-linecap="round" opacity="${1 - i * 0.3}"/>`).join('');
    const ribbon = `<path d="M196 360 C150 420 96 340 52 398 L30 372 L60 352 C100 300 150 380 186 330Z" fill="${C.lime}"/><path d="M52 398 L30 372 L14 400 L40 404Z" fill="${mix(C.lime, '#000', 0.3)}"/>`;
    return `${shadow(250, 448, 170)}${ribbon}
      <g transform="rotate(-14 250 230)">
        <rect x="150" y="230" width="62" height="118" rx="20" fill="${C.ink}"/>
        <path d="M200 228 L330 146 L330 346 L200 328 Z" fill="${C.paper}"/>
        <path d="M200 228 L330 146 L330 186 L200 252 Z" fill="#fff" opacity=".55"/>
        <rect x="318" y="138" width="32" height="218" rx="16" fill="${a}"/>
        <rect x="326" y="148" width="10" height="196" rx="5" fill="#fff" opacity=".3"/>
        <rect x="186" y="246" width="30" height="80" rx="12" fill="${a}"/>
        <path d="M180 346 l-8 52 q-2 14 12 14 h18 q12 0 10 -14 l-6 -52Z" fill="${C.ink}"/>
      </g>
      ${arcs}
      ${confetti([[402, 96, 22, C.lime, 18], [436, 168, 14, C.paper, -12], [420, 318, 18, a, 30], [70, 120, 16, C.paper, 12, 0.8], [104, 70, 10, C.lime, 0, 0.9], [452, 252, 10, C.lime, 45]])}`;
  };

  S.introductions = (k) => {
    const a = k.accent;
    const table = `<ellipse cx="256" cy="372" rx="196" ry="56" fill="${mix(a, C.night, 0.55)}"/><ellipse cx="256" cy="360" rx="196" ry="56" fill="${C.paper}"/><ellipse cx="256" cy="360" rx="150" ry="36" fill="none" stroke="${C.paper2}" stroke-width="3"/>`;
    const cups = `<rect x="168" y="334" width="26" height="22" rx="6" fill="${a}"/><rect x="318" y="338" width="26" height="22" rx="6" fill="${C.ink}"/><rect x="242" y="350" width="34" height="10" rx="4" fill="${C.lime}"/>`;
    return `${shadow(256, 440, 210, 26, 0.35)}
      ${person(CAST[4], { x: 66, y: 150, s: 1.02, pose: 'down' })}
      ${person(CAST[1], { x: 176, y: 112, s: 1.12, pose: 'wave' })}
      ${person(CAST[2], { x: 300, y: 146, s: 1.04, pose: 'cheer', flip: true })}
      ${table}${cups}
      ${bubble(330, 64, 120, 54, C.lime, 2, 'l', 'rgba(10,26,19,.3)')}
      ${bubble(48, 92, 96, 44, C.paper, 1, 'r')}
      ${confetti([[452, 160, 12, C.paper, 20, 0.7], [30, 220, 10, C.lime, 0, 0.8]])}`;
  };

  S.general = (k) => {
    const a = k.accent;
    // A busy square: paving, people at different depths, conversations in the air.
    let tiles = '';
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) tiles += `<rect x="${-30 + c * 66 + (r % 2) * 33}" y="${392 + r * 30}" width="58" height="22" rx="6" fill="${mix(a, C.night, 0.5 + r * 0.08)}"/>`;
    const centre = `<rect x="206" y="316" width="100" height="80" rx="16" fill="${mix(a, C.paper, 0.2)}"/><rect x="216" y="270" width="36" height="36" rx="9" fill="${C.paper}"/><rect x="260" y="270" width="36" height="36" rx="9" fill="${C.paper}" opacity=".7"/><rect x="216" y="226" width="36" height="36" rx="9" fill="${C.paper}" opacity=".7"/><rect x="260" y="226" width="36" height="36" rx="9" fill="${C.lime}"/>`;
    return `${tiles}${centre}
      ${person(CAST[3], { x: 24, y: 240, s: 0.98, pose: 'point' })}
      ${person(CAST[5], { x: 132, y: 270, s: 0.86, pose: 'down', flip: true })}
      ${person(CAST[0], { x: 308, y: 262, s: 0.9, pose: 'type' })}
      ${person(CAST[6], { x: 392, y: 226, s: 1.0, pose: 'wave', flip: true })}
      ${bubble(40, 70, 140, 62, C.paper, 2, 'r')}
      ${bubble(196, 116, 104, 46, C.lime, 1, 'l', 'rgba(10,26,19,.3)')}
      ${bubble(330, 52, 150, 70, C.paper, 3, 'l')}
      ${bubble(300, 158, 72, 36, a, 1, 'r', 'rgba(255,255,255,.4)')}`;
  };

  S.tracking = (k) => {
    const a = k.accent;
    const cx = 256, cy = 262;
    const rings = [64, 118, 172].map((r, i) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.paper}" stroke-opacity="${0.5 - i * 0.12}" stroke-width="2" ${i === 2 ? 'stroke-dasharray="4 10"' : ''}/>`).join('');
    const blips = [[332, 186, C.lime, 16], [190, 330, C.paper, 12], [356, 318, C.lime, 12], [168, 196, C.paper, 10], [296, 380, C.paper, 9]].map(([x, y, c, w]) => `<rect x="${x - w}" y="${y - w}" width="${w * 2}" height="${w * 2}" rx="${w * 0.7}" fill="${c}" opacity=".18"/><rect x="${x - w / 2}" y="${y - w / 2}" width="${w}" height="${w}" rx="${w * 0.25}" fill="${c}"/>`).join('');
    const links = `<path d="M332 186 L${cx} ${cy} L190 330 M${cx} ${cy} L356 318" stroke="${C.lime}" stroke-width="2" stroke-dasharray="3 7" opacity=".7"/>`;
    const sweep = `<path d="M${cx} ${cy} L${cx + 172} ${cy - 10} A172 172 0 0 0 ${cx + 92} ${cy - 146} Z" fill="url(#sweep)"/>`;
    const card = `<g transform="translate(330 404)"><rect width="150" height="70" rx="16" fill="${C.paper}"/><path d="M16 50 L44 38 L70 44 L98 24 L132 16" fill="none" stroke="${a}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="132" cy="16" r="6" fill="${C.ink}"/></g>`;
    const card2 = `<g transform="translate(34 46)"><rect width="122" height="52" rx="14" fill="${C.ink}"/><rect x="14" y="16" width="20" height="20" rx="6" fill="${C.lime}"/><rect x="44" y="18" width="62" height="6" rx="3" fill="${C.paper}" opacity=".8"/><rect x="44" y="30" width="40" height="6" rx="3" fill="${C.paper}" opacity=".4"/></g>`;
    return `<defs><linearGradient id="sweep" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="${C.lime}" stop-opacity="0"/><stop offset="1" stop-color="${C.lime}" stop-opacity=".55"/></linearGradient></defs>
      <circle cx="${cx}" cy="${cy}" r="172" fill="${mix(a, C.night, 0.45)}"/>${rings}${sweep}
      <path d="M${cx - 172} ${cy} H${cx + 172} M${cx} ${cy - 172} V${cy + 172}" stroke="${C.paper}" stroke-opacity=".15" stroke-width="2"/>
      ${links}${blips}<circle cx="${cx}" cy="${cy}" r="12" fill="${C.paper}"/><circle cx="${cx}" cy="${cy}" r="5" fill="${a}"/>${card}${card2}`;
  };

  S.creatives = (k) => {
    const a = k.accent;
    const phone = (x, y, rot, screen, inner) => `<g transform="rotate(${rot} ${x + 70} ${y + 130})"><rect x="${x - 6}" y="${y + 10}" width="152" height="270" rx="30" fill="#000" opacity=".25"/><rect x="${x}" y="${y}" width="140" height="262" rx="26" fill="${C.ink}"/><rect x="${x + 8}" y="${y + 8}" width="124" height="246" rx="20" fill="${screen}"/>${inner(x + 8, y + 8)}<rect x="${x + 52}" y="${y + 14}" width="36" height="8" rx="4" fill="${C.ink}"/></g>`;
    const s1 = (x, y) => `<rect x="${x + 14}" y="${y + 40}" width="96" height="14" rx="5" fill="${C.ink}"/><rect x="${x + 14}" y="${y + 60}" width="70" height="14" rx="5" fill="${C.ink}"/><circle cx="${x + 62}" cy="${y + 150}" r="30" fill="${a}"/><path d="M${x + 54} ${y + 136} v28 l24 -14z" fill="${C.paper}"/><rect x="${x + 14}" y="${y + 206}" width="96" height="24" rx="12" fill="${C.ink}"/>`;
    const s2 = (x, y) => `${badge(CAST[7], x + 62, y + 96, 44)}<rect x="${x + 10}" y="${y + 20}" width="104" height="22" rx="7" fill="${C.lime}"/><rect x="${x + 18}" y="${y + 28}" width="70" height="6" rx="3" fill="${C.ink}"/><rect x="${x + 14}" y="${y + 160}" width="96" height="8" rx="4" fill="${C.paper}" opacity=".85"/><rect x="${x + 14}" y="${y + 174}" width="66" height="8" rx="4" fill="${C.paper}" opacity=".5"/><rect x="${x + 14}" y="${y + 202}" width="96" height="26" rx="13" fill="${C.lime}"/>`;
    const s3 = (x, y) => `<rect x="${x}" y="${y}" width="124" height="120" rx="20" fill="${mix(a, '#fff', 0.35)}"/><circle cx="${x + 84}" cy="${y + 48}" r="22" fill="${C.lime}"/><path d="M${x} ${y + 120} L${x + 40} ${y + 70} L${x + 70} ${y + 100} L${x + 92} ${y + 80} L${x + 124} ${y + 120}Z" fill="${C.ink}" opacity=".7"/><rect x="${x + 14}" y="${y + 140}" width="80" height="10" rx="5" fill="${C.ink}"/><rect x="${x + 14}" y="${y + 158}" width="96" height="8" rx="4" fill="${C.ink}" opacity=".35"/><rect x="${x + 14}" y="${y + 172}" width="70" height="8" rx="4" fill="${C.ink}" opacity=".35"/>`;
    // The hook: a line from the top with a hook catching the middle phone.
    const hook = `<path d="M262 0 V92" stroke="${C.paper}" stroke-width="4"/><path d="M262 92 v22 a20 20 0 0 1 -40 0 v-8" fill="none" stroke="${C.lime}" stroke-width="8" stroke-linecap="round"/><path d="M222 108 l-9 10 h17z" fill="${C.lime}"/>`;
    return `${shadow(256, 460, 200, 24, 0.35)}
      ${phone(46, 160, -12, C.paper, s1)}
      ${phone(330, 168, 11, C.paper, s3)}
      ${phone(186, 112, 0, a, s2)}
      ${hook}
      ${confetti([[96, 92, 18, C.lime, 20], [420, 104, 14, C.paper, -16, 0.8], [454, 420, 12, C.lime, 0]])}`;
  };

  S.telegram = (k) => {
    const a = k.accent;
    const plane = (x, y, s, rot, c) => `<g transform="translate(${x} ${y}) rotate(${rot}) scale(${s})"><path d="M-30 -4 L34 -22 L6 26 L-2 8 Z" fill="${c}"/><path d="M-2 8 L34 -22 L6 4 Z" fill="#000" opacity=".18"/><path d="M-2 8 L4 22 L6 4Z" fill="#000" opacity=".28"/></g>`;
    const funnel = `<path d="M118 150 H394 L300 300 V376 Q300 392 284 392 H228 Q212 392 212 376 V300 Z" fill="${C.paper}"/><path d="M118 150 H394 L378 176 H134 Z" fill="${C.paper2}"/><ellipse cx="256" cy="150" rx="138" ry="22" fill="${mix(a, C.night, 0.3)}"/><ellipse cx="256" cy="150" rx="138" ry="22" fill="none" stroke="${C.paper}" stroke-width="6"/><rect x="212" y="270" width="88" height="14" rx="7" fill="${a}"/>`;
    const trail = `<path d="M40 70 Q120 40 180 110 M470 60 Q400 40 340 112 M256 30 Q256 70 250 118" fill="none" stroke="${C.paper}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round" opacity=".7"/>`;
    const out = `<path d="M256 392 V428 Q256 452 300 454 H470" fill="none" stroke="${C.lime}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round"/>`;
    return `${trail}${funnel}${out}
      ${plane(60, 72, 1.2, 12, C.paper)}${plane(452, 70, 1.1, 160, C.paper)}${plane(250, 52, 1, 80, C.lime)}${plane(180, 116, 0.8, 40, C.paper)}${plane(342, 118, 0.85, 130, C.lime)}
      ${plane(364, 452, 0.9, 0, C.lime)}${plane(442, 452, 0.9, 0, C.lime)}`;
  };

  /* Africa, simplified: drawn on a 0..100 grid, then filled with small squares. */
  const AFRICA = [[30, 6], [38, 3], [47, 4], [53, 7], [60, 9], [66, 8], [72, 8], [76, 15], [80, 23], [84, 30], [89, 34], [97, 34], [95, 41], [89, 50], [83, 58], [81, 66], [82, 74], [77, 80], [72, 86], [66, 93], [58, 97], [52, 96], [48, 88], [45, 79], [43, 70], [41, 61], [42, 54], [40, 49], [35, 47], [29, 48], [22, 47], [16, 44], [10, 39], [5, 33], [3, 26], [6, 18], [12, 12], [20, 8]];
  const MADAGASCAR = [[88, 72], [91, 70], [92, 76], [89, 86], [86, 84], [86, 77]];
  S['geos-africa'] = (k) => {
    const a = k.accent;
    const ox = 96, oy = 54, sc = 3.3;
    const pts = (list) => list.map(([x, y]) => `${(ox + x * sc).toFixed(1)},${(oy + y * sc).toFixed(1)}`).join(' ');
    let dots = '';
    const step = 11;
    for (let y = oy; y < oy + 100 * sc; y += step) for (let x = ox; x < ox + 100 * sc; x += step) dots += `<rect x="${x + 2}" y="${y + 2}" width="${step - 5}" height="${step - 5}" rx="1.6"/>`;
    const pins = { NG: [37, 42], CM: [43, 47.5], GH: [27, 44], KE: [80, 52], ZA: [59, 88] };
    const pin = ([x, y], big) => { const px = ox + x * sc, py = oy + y * sc; const k = big ? 1 : 0.72; return `<g transform="translate(${px} ${py}) scale(${k}) translate(${-px} ${-py})"><circle cx="${px}" cy="${py}" r="${big ? 30 : 22}" fill="${C.lime}" opacity=".16"/><circle cx="${px}" cy="${py}" r="${big ? 18 : 13}" fill="${C.lime}" opacity=".28"/><path d="M${px} ${py + 2} c-12 -14 -14 -20 -14 -26 a14 14 0 0 1 28 0 c0 6 -2 12 -14 26z" transform="translate(0 -6)" fill="${C.lime}"/><circle cx="${px}" cy="${py - 26}" r="5.5" fill="${C.ink}"/></g>`; };
    const arcs = `<path d="M${ox + 37 * sc} ${oy + 42 * sc} Q${ox + 60 * sc} ${oy + 30 * sc} ${ox + 80 * sc} ${oy + 52 * sc} M${ox + 37 * sc} ${oy + 42 * sc} Q${ox + 40 * sc} ${oy + 70 * sc} ${ox + 59 * sc} ${oy + 88 * sc} M${ox + 27 * sc} ${oy + 44 * sc} Q${ox + 32 * sc} ${oy + 38 * sc} ${ox + 37 * sc} ${oy + 42 * sc}" fill="none" stroke="${C.lime}" stroke-width="2.5" stroke-dasharray="3 8" stroke-linecap="round" opacity=".8"/>`;
    return `<defs><clipPath id="af"><polygon points="${pts(AFRICA)}"/><polygon points="${pts(MADAGASCAR)}"/></clipPath></defs>
      <polygon points="${pts(AFRICA)}" fill="${mix(a, C.night, 0.35)}" transform="translate(8 10)" opacity=".6"/>
      <g clip-path="url(#af)"><rect x="0" y="0" width="512" height="512" fill="${mix(a, C.night, 0.3)}"/><g fill="${C.paper}">${dots}</g></g>
      ${arcs}${pin(pins.GH)}${pin(pins.CM)}${pin(pins.ZA, true)}${pin(pins.KE, true)}${pin(pins.NG, true)}`;
  };

  S['tool-help'] = (k) => {
    const a = k.accent;
    const desk = `<rect x="70" y="352" width="372" height="22" rx="10" fill="${C.paper}"/><rect x="92" y="372" width="18" height="90" rx="6" fill="${C.paper2}"/><rect x="402" y="372" width="18" height="90" rx="6" fill="${C.paper2}"/>`;
    const laptop = `<path d="M196 262 H318 Q326 262 326 270 V344 H188 V270 Q188 262 196 262Z" fill="${C.ink}"/><rect x="198" y="272" width="118" height="62" rx="6" fill="${mix(a, '#fff', 0.15)}"/><path d="M212 318 L236 302 L254 312 L278 290 L300 298" fill="none" stroke="${C.lime}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M170 344 H344 L352 354 H162 Z" fill="${C.paper2}"/>`;
    const mug = `<rect x="362" y="316" width="34" height="38" rx="8" fill="${a}"/><path d="M396 324 q14 0 14 12 q0 12 -14 12" fill="none" stroke="${a}" stroke-width="6"/>`;
    const qBubble = `<g transform="translate(46 88)"><rect width="104" height="88" rx="26" fill="${C.paper}"/><path d="M70 86 l10 22 l8 -24z" fill="${C.paper}"/><path d="M36 34 a16 16 0 1 1 22 15 q-6 3 -6 10 v4" fill="none" stroke="${C.ink}" stroke-width="9" stroke-linecap="round"/><circle cx="52" cy="72" r="6" fill="${C.ink}"/></g>`;
    const okBubble = `<g transform="translate(364 76)"><rect width="104" height="88" rx="26" fill="${C.lime}"/><path d="M28 88 l-10 22 l-6 -24z" fill="${C.lime}"/><path d="M30 46 l16 16 l30 -32" fill="none" stroke="${C.ink}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    const steps = `<path d="M150 150 Q256 60 362 130" fill="none" stroke="${C.paper}" stroke-width="3" stroke-dasharray="2 10" stroke-linecap="round" opacity=".7"/>`;
    return `${shadow(256, 470, 200, 20, 0.35)}${steps}
      ${person(CAST[1], { x: 172, y: 150, s: 1.22, pose: 'type', headset: true, shirt: a })}
      ${desk}${laptop}${mug}${qBubble}${okBubble}`;
  };

  S['buyers-lounge'] = (k) => {
    const a = k.accent;
    const fl = (x, flip) => (flip ? `translate(${x * 2 + 140} 0) scale(-1 1)` : '');
    const chairBack = (x, flip, col) => `<g transform="${fl(x, flip)}"><path d="M${x} 300 Q${x - 6} 214 ${x + 40} 208 H${x + 104} Q${x + 140} 210 ${x + 140} 250 V330 H${x}Z" fill="${col}"/><path d="M${x + 20} 300 Q${x + 18} 236 ${x + 46} 232 H${x + 100} Q${x + 120} 234 ${x + 120} 260 V300Z" fill="#000" opacity=".12"/></g>`;
    const chairSeat = (x, flip, col) => `<g transform="${fl(x, flip)}"><rect x="${x - 14}" y="318" width="168" height="58" rx="26" fill="${mix(col, '#000', 0.22)}"/><rect x="${x - 2}" y="308" width="144" height="34" rx="16" fill="${mix(col, '#fff', 0.14)}"/><rect x="${x - 22}" y="270" width="28" height="92" rx="14" fill="${mix(col, '#000', 0.1)}"/><rect x="${x + 134}" y="270" width="28" height="92" rx="14" fill="${mix(col, '#000', 0.1)}"/><rect x="${x + 6}" y="372" width="12" height="54" rx="6" fill="${C.ink}"/><rect x="${x + 122}" y="372" width="12" height="54" rx="6" fill="${C.ink}"/></g>`;
    const frame = `<g transform="translate(166 58)"><rect width="180" height="120" rx="18" fill="${C.paper}"/><rect x="14" y="14" width="152" height="92" rx="10" fill="${C.ink}"/><rect x="34" y="72" width="16" height="22" rx="4" fill="${mix(a, '#fff', 0.3)}"/><rect x="60" y="58" width="16" height="36" rx="4" fill="${mix(a, '#fff', 0.3)}"/><rect x="86" y="64" width="16" height="30" rx="4" fill="${mix(a, '#fff', 0.3)}"/><rect x="112" y="40" width="16" height="54" rx="4" fill="${C.lime}"/><path d="M34 52 L68 40 L94 46 L130 26" fill="none" stroke="${C.lime}" stroke-width="3" stroke-linecap="round"/></g>`;
    const table = `<ellipse cx="256" cy="380" rx="46" ry="12" fill="${C.paper2}"/><rect x="250" y="384" width="12" height="46" rx="5" fill="${C.ink}"/><ellipse cx="256" cy="378" rx="46" ry="12" fill="${C.paper}"/><rect x="232" y="350" width="22" height="26" rx="6" fill="${C.ink}"/><rect x="262" y="356" width="22" height="20" rx="6" fill="${a}"/>`;
    const plant = `<rect x="440" y="378" width="40" height="50" rx="10" fill="${C.paper}"/><path d="M460 380 Q430 330 448 290 M460 380 Q470 320 494 300 M460 380 Q462 340 456 300" stroke="${C.mint}" stroke-width="10" fill="none" stroke-linecap="round"/>`;
    return `${shadow(256, 432, 230, 22, 0.35)}${frame}${HALL}
      ${chairBack(52, false, mix(a, '#fff', 0.16))}
      ${person(CAST[3], { x: 56, y: 150, s: 1.0, pose: 'down' })}
      ${chairSeat(52, false, mix(a, '#fff', 0.16))}
      ${chairBack(316, true, mix(a, '#fff', 0.16))}
      ${person(CAST[6], { x: 320, y: 150, s: 1.0, pose: 'wave', flip: true })}
      ${chairSeat(316, true, mix(a, '#fff', 0.16))}
      ${table}${plant}`;
  };

  S['scaling-desk'] = (k) => {
    const a = k.accent;
    const bars = [70, 120, 170, 240, 320].map((h, i) => `<rect x="${60 + i * 78}" y="${440 - h}" width="56" height="${h}" rx="12" fill="${i === 4 ? C.lime : mix(a, C.paper, 0.25 + i * 0.12)}"/>`).join('');
    const grid = [120, 200, 280, 360].map((y) => `<path d="M40 ${y} H472" stroke="${C.paper}" stroke-opacity=".1" stroke-width="2"/>`).join('');
    // A rocket built from squares, lifting off the tallest bar.
    const rocket = `<g transform="translate(372 96) rotate(32)"><path d="M0 -70 Q30 -40 30 10 V54 H-30 V10 Q-30 -40 0 -70Z" fill="${C.paper}"/><circle cx="0" cy="-10" r="13" fill="${a}"/><circle cx="0" cy="-10" r="6" fill="${C.ink}"/><path d="M-30 20 L-52 58 H-30Z" fill="${C.lime}"/><path d="M30 20 L52 58 H30Z" fill="${C.lime}"/><rect x="-16" y="54" width="32" height="10" rx="3" fill="${C.ink}"/><path d="M-12 66 Q0 120 12 66Z" fill="${C.lime}"/><path d="M-6 66 Q0 98 6 66Z" fill="#fff"/></g>`;
    const trail = `<path d="M90 380 Q200 330 260 270 T380 150" fill="none" stroke="${C.lime}" stroke-width="4" stroke-dasharray="2 12" stroke-linecap="round"/>`;
    return `${grid}${bars}${trail}${rocket}
      ${confetti([[300, 70, 14, C.paper, 20, 0.7], [452, 210, 12, C.lime, 0], [184, 150, 10, C.paper, 45, 0.6]])}${HALL}`;
  };

  S['offer-drops'] = (k) => {
    const a = k.accent;
    const coin = (x, y, r, rot = 0) => `<g transform="rotate(${rot} ${x} ${y})"><ellipse cx="${x}" cy="${y + r * 0.14}" rx="${r}" ry="${r}" fill="${mix(C.lime, '#000', 0.3)}"/><circle cx="${x}" cy="${y}" r="${r}" fill="${C.lime}"/><rect x="${x - r * 0.36}" y="${y - r * 0.36}" width="${r * 0.72}" height="${r * 0.72}" rx="${r * 0.18}" fill="none" stroke="${C.ink}" stroke-width="${r * 0.13}"/></g>`;
    const parcel = (x, y, w, rot, col) => `<g transform="rotate(${rot} ${x + w / 2} ${y + w / 2})"><rect x="${x}" y="${y}" width="${w}" height="${w * 0.82}" rx="${w * 0.12}" fill="${col}"/><rect x="${x + w * 0.42}" y="${y}" width="${w * 0.16}" height="${w * 0.82}" fill="${C.ink}" opacity=".85"/><rect x="${x}" y="${y + w * 0.32}" width="${w}" height="${w * 0.14}" fill="${C.ink}" opacity=".85"/></g>`;
    const tray = `<path d="M96 380 H416 L392 452 H120 Z" fill="${C.paper}"/><path d="M96 380 H416 L408 404 H104 Z" fill="${C.paper2}"/><rect x="88" y="368" width="336" height="20" rx="10" fill="${C.paper}"/>`;
    const streaks = [[150, 40, 120], [260, 20, 90], [360, 50, 110], [210, 150, 70], [320, 170, 60]].map(([x, y, h]) => `<path d="M${x} ${y} V${y + h}" stroke="${C.paper}" stroke-opacity=".25" stroke-width="3" stroke-linecap="round"/>`).join('');
    return `${streaks}
      ${parcel(124, 96, 86, -14, C.paper)}${parcel(300, 150, 96, 10, a === '#8A6A00' ? '#E8AE18' : a)}
      ${coin(250, 92, 26, 10)}${coin(404, 92, 20)}${coin(196, 238, 22, -12)}${coin(262, 300, 30)}
      ${tray}
      ${coin(170, 360, 24)}${coin(230, 352, 28)}${coin(296, 356, 24)}${coin(350, 362, 20)}
      ${HALL}`;
  };

  S['creative-reviews'] = (k) => {
    const a = k.accent;
    const tile = (x, y, kind, mark) => {
      const fills = [C.paper, mix(a, '#fff', 0.3), C.ink, C.lime, mix(a, C.paper, 0.55)];
      const bg = fills[kind % fills.length];
      const fg = bg === C.ink ? C.paper : C.ink;
      const art = [`<circle cx="${x + 40}" cy="${y + 36}" r="16" fill="${fg}" opacity=".7"/>`, `<rect x="${x + 14}" y="${y + 20}" width="52" height="10" rx="4" fill="${fg}"/><rect x="${x + 14}" y="${y + 36}" width="36" height="10" rx="4" fill="${fg}" opacity=".6"/>`, `<path d="M${x + 30} ${y + 22} v28 l24 -14z" fill="${fg}"/>`, `<path d="M${x + 10} ${y + 62} L${x + 30} ${y + 36} L${x + 46} ${y + 50} L${x + 70} ${y + 24}" fill="none" stroke="${fg}" stroke-width="5" stroke-linecap="round"/>`][kind % 4];
      const mk = mark === 'ok' ? `<circle cx="${x + 74}" cy="${y + 6}" r="15" fill="${C.lime}"/><path d="M${x + 67} ${y + 6} l5 5 l10 -10" fill="none" stroke="${C.ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`
        : mark === 'no' ? `<circle cx="${x + 74}" cy="${y + 6}" r="15" fill="#FF6B5E"/><path d="M${x + 68} ${y} l12 12 M${x + 80} ${y} l-12 12" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`
          : mark === 'ring' ? `<ellipse cx="${x + 40}" cy="${y + 40}" rx="56" ry="50" fill="none" stroke="${C.lime}" stroke-width="5" transform="rotate(-8 ${x + 40} ${y + 40})"/>` : '';
      return `<rect x="${x}" y="${y}" width="80" height="80" rx="14" fill="${bg}"/>${art}${mk}`;
    };
    const cells = [[0, 0, 0, 'ok'], [1, 0, 1, ''], [2, 0, 2, 'no'], [3, 0, 3, ''], [0, 1, 4, ''], [1, 1, 3, 'ring'], [2, 1, 0, ''], [3, 1, 1, 'ok'], [0, 2, 2, ''], [1, 2, 0, 'no'], [2, 2, 4, 'ok'], [3, 2, 2, '']];
    const wall = `<rect x="56" y="54" width="400" height="310" rx="26" fill="${mix(a, C.night, 0.5)}"/>` + cells.map(([c, r, kd, mk]) => tile(76 + c * 96, 74 + r * 96, kd, mk)).join('');
    return `${wall}
      ${person(CAST[5], { x: 316, y: 302, s: 1.0, pose: 'point', flip: true })}
      ${person(CAST[0], { x: 40, y: 318, s: 0.9, pose: 'down' })}
      ${HALL}`;
  };

  S['inner-circle'] = (k) => {
    // Dark and quiet: a small ring of seats around the founder, lime light from above.
    const cx = 256, cy = 330;
    const seats = [];
    // Eight seats around the floor, none hidden behind him and none stacked at the sides.
    [200, 235, 305, 340, 35, 65, 115, 145].forEach((deg, i) => {
      const t = (deg * Math.PI) / 180;
      seats.push({ x: cx + Math.cos(t) * 206, y: 392 + Math.sin(t) * 64, i, back: Math.sin(t) < 0 });
    });
    seats.sort((p, q) => p.y - q.y);
    const seat = (s) => `<g>${s.i % 4 === 2 ? '' : badge(CAST[s.i % CAST.length], s.x, s.y - 26, 16, { w: 2.5, c: '#0A1611' })}<rect x="${s.x - 22}" y="${s.y - 12}" width="44" height="30" rx="10" fill="#18291F"/><rect x="${s.x - 22}" y="${s.y - 12}" width="44" height="30" rx="10" fill="none" stroke="${C.lime}" stroke-opacity="${s.i % 4 === 2 ? 0.9 : 0.4}" stroke-width="2"/></g>`;
    const glow = `<radialGradient id="spot" cx="50%" cy="0%" r="80%"><stop offset="0" stop-color="${C.lime}" stop-opacity=".32"/><stop offset="1" stop-color="${C.lime}" stop-opacity="0"/></radialGradient>`;
    const cone = `<path d="M206 0 H306 L400 470 H112Z" fill="url(#spot)"/>`;
    const floor = `<ellipse cx="${cx}" cy="402" rx="244" ry="78" fill="#0F2419"/><ellipse cx="${cx}" cy="398" rx="244" ry="78" fill="none" stroke="${C.lime}" stroke-opacity=".22" stroke-width="2"/><ellipse cx="${cx}" cy="384" rx="120" ry="26" fill="${C.lime}" opacity=".1"/>`;
    const ring = `<circle cx="${cx}" cy="178" r="96" fill="none" stroke="${C.lime}" stroke-width="3" stroke-dasharray="1 9" stroke-linecap="round" opacity=".7"/>`;
    return `<defs>${glow}</defs>${cone}${floor}${ring}
      ${seats.filter((s) => s.back).map(seat).join('')}
      ${founderFig(156, 104, 1.0)}
      ${seats.filter((s) => !s.back).map(seat).join('')}
      ${confetti([[64, 64, 12, C.lime, 20, 0.8], [434, 92, 16, C.lime, -10, 0.5], [460, 40, 8, C.lime, 0, 0.9]])}`;
  };

  /* ---------------- the rooms ---------------- */
  const ROOMS = [
    { slug: 'announcements', accent: '#00A86B' },
    { slug: 'introductions', accent: '#12C784' },
    { slug: 'general', accent: '#0F766E' },
    { slug: 'tracking', accent: '#5B3FE8' },
    { slug: 'creatives', accent: '#EE5A2F' },
    { slug: 'telegram', accent: '#2449D8' },
    { slug: 'geos-africa', accent: '#B45309' },
    { slug: 'tool-help', accent: '#475569' },
    { slug: 'buyers-lounge', accent: '#00774B', premium: true },
    { slug: 'scaling-desk', accent: '#0F766E', premium: true },
    { slug: 'offer-drops', accent: '#8A6A00', premium: true },
    { slug: 'creative-reviews', accent: '#C8401C', premium: true },
    { slug: 'inner-circle', accent: '#111312', dark: true },
  ];

  /* ---------------- the plate (background + stage) ---------------- */
  function plate(room, W, H) {
    const a = room.accent;
    const base = room.dark ? '#08120D' : mix(a, C.night, 0.78);
    const lift = room.dark ? '#13281C' : mix(a, C.night, 0.5);
    const cover = W !== H;
    const s = cover ? H / 512 : W / 512;
    const ox = cover ? W - 512 * s - 36 : 0;
    const cell = 32;
    // The left of a cover sits under text in the app: keep it quiet (grid, a few squares) and let the scene carry the right.
    const ext = cover ? confetti([[ox - 160, 70, 18, C.lime, 14, 0.75], [ox - 300, 250, 12, C.paper, -10, 0.35], [ox - 90, 300, 10, a === '#111312' ? C.lime : C.paper, 30, 0.5], [ox - 440, 120, 10, C.lime, 0, 0.4]]) : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <radialGradient id="lift" cx="${cover ? 0.78 : 0.7}" cy="0.22" r="${cover ? 0.7 : 0.75}"><stop offset="0" stop-color="${lift}"/><stop offset="1" stop-color="${base}"/></radialGradient>
        <pattern id="grid" width="${cell}" height="${cell}" patternUnits="userSpaceOnUse"><path d="M${cell} 0H0V${cell}" fill="none" stroke="#fff" stroke-opacity=".05" stroke-width="1.5"/></pattern>
        <linearGradient id="fadeL" x1="0" x2="1"><stop offset="0" stop-color="${base}" stop-opacity=".0"/><stop offset="1" stop-color="${base}" stop-opacity="0"/></linearGradient>
      </defs>
      <rect width="${W}" height="${H}" fill="url(#lift)"/>
      <rect width="${W}" height="${H}" fill="url(#grid)"/>
      ${ext}
      <g transform="translate(${ox} 0) scale(${s})">${S[room.slug](room)}</g>
    </svg>`;
  }

  window.ROOM_ART = { ROOMS, plate, mix };
})();
