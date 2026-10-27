'use strict';
/*
 * A very small PDF writer (no dependencies): one or more pages of vector shapes and text in the 14 standard fonts
 * (Helvetica, Helvetica-Bold, Times-Italic, Times-Roman), WinAnsi encoding. Enough for the VooSquare Academy certificate.
 * Coordinates are PDF points with the origin at the bottom left.
 */

/* Glyph widths (1/1000 em) for ASCII 32..126, from the standard Adobe font metrics. */
const W = {
  Helvetica: [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584],
  'Helvetica-Bold': [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584],
  'Times-Italic': [250, 333, 420, 500, 500, 833, 778, 214, 333, 333, 500, 675, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 333, 333, 675, 675, 675, 500, 920, 611, 611, 667, 722, 611, 611, 722, 722, 333, 444, 667, 556, 833, 667, 722, 611, 722, 611, 500, 556, 722, 611, 833, 611, 556, 556, 389, 278, 389, 422, 500, 333, 500, 500, 444, 500, 444, 278, 500, 500, 278, 278, 444, 278, 722, 500, 500, 500, 500, 389, 389, 278, 500, 444, 667, 444, 444, 389, 400, 275, 400, 541],
  'Times-Roman': [250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722, 722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541],
};
const FONTS = { F1: 'Helvetica', F2: 'Helvetica-Bold', F3: 'Times-Italic', F4: 'Times-Roman' };
const FONT_KEY = Object.fromEntries(Object.entries(FONTS).map(([k, v]) => [v, k]));

/* Unicode → WinAnsi (cp1252) for the characters outside Latin-1 that people actually type. */
const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
const LATIN_EXTRA = { 0x0141: 76, 0x0142: 108, 0x0110: 68, 0x0111: 100, 0x0131: 105, 0x0126: 72, 0x0127: 104 }; // Ł ł Đ đ ı Ħ ħ
const enc1 = (ch) => { const c = ch.codePointAt(0); return c >= 32 && c < 127 ? c : CP1252[c] || (c >= 0xA0 && c <= 0xFF ? c : 0); };
function winAnsi(str) {
  const out = [];
  // Letter by letter, each with its accents (NFD clusters), so a letter with two marks (Yoruba ọ̀, ẹ́) keeps the one
  // WinAnsi can print (ò, é) instead of turning the extra mark into a question mark.
  const clusters = String(str ?? '').normalize('NFD').match(/\P{M}\p{M}*|\p{M}+/gu) || [];
  for (const cl of clusters) {
    const whole = cl.normalize('NFC');
    let c = [...whole].length === 1 ? enc1(whole) : 0;
    if (!c) {
      const base = cl.replace(/\p{M}+/gu, '');
      if (!base) continue; // a stray accent on its own: drop it
      for (const m of cl.slice(base.length).match(/\p{M}/gu) || []) { const t = (base + m).normalize('NFC'); if ([...t].length === 1 && (c = enc1(t))) break; }
      if (!c) c = enc1(base) || LATIN_EXTRA[base.codePointAt(0)] || 63;
    }
    out.push(c);
  }
  return out;
}
/** Width of a string in points. */
function textWidth(str, font, size) {
  const t = W[font] || W.Helvetica;
  let w = 0;
  for (const c of winAnsi(str)) w += c >= 32 && c <= 126 ? t[c - 32] : (font.startsWith('Times') ? 500 : 556);
  return (w / 1000) * size;
}
const pdfStr = (str) => '(' + winAnsi(str).map((c) => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c >= 32 && c < 127 ? String.fromCharCode(c) : '\\' + c.toString(8).padStart(3, '0'))).join('') + ')';
const n = (v) => (Math.round(v * 100) / 100).toString();
const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h); const v = m ? parseInt(m[1], 16) : 0; return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => n(x / 255)).join(' '); };

/** A page you draw on. Every method returns the page so calls can chain. */
class Page {
  constructor(w, h) { this.w = w; this.h = h; this.ops = []; }
  fill(c) { this.ops.push(hex(c) + ' rg'); return this; }
  stroke(c, lw = 1) { this.ops.push(hex(c) + ' RG ' + n(lw) + ' w'); return this; }
  rect(x, y, w, h, mode = 'f') { this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re ${mode}`); return this; }
  line(x1, y1, x2, y2) { this.ops.push(`${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`); return this; }
  /** Rounded rectangle path, then fill (f), stroke (S) or both (B). */
  rrect(x, y, w, h, r, mode = 'f') {
    const k = 0.5523 * r;
    this.ops.push([
      `${n(x + r)} ${n(y)} m`, `${n(x + w - r)} ${n(y)} l`, `${n(x + w - r + k)} ${n(y)} ${n(x + w)} ${n(y + r - k)} ${n(x + w)} ${n(y + r)} c`,
      `${n(x + w)} ${n(y + h - r)} l`, `${n(x + w)} ${n(y + h - r + k)} ${n(x + w - r + k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} c`,
      `${n(x + r)} ${n(y + h)} l`, `${n(x + r - k)} ${n(y + h)} ${n(x)} ${n(y + h - r + k)} ${n(x)} ${n(y + h - r)} c`,
      `${n(x)} ${n(y + r)} l`, `${n(x)} ${n(y + r - k)} ${n(x + r - k)} ${n(y)} ${n(x + r)} ${n(y)} c`, `h ${mode}`,
    ].join(' '));
    return this;
  }
  circle(cx, cy, r, mode = 'f') {
    const k = 0.5523 * r;
    this.ops.push([
      `${n(cx + r)} ${n(cy)} m`, `${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c`,
      `${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c`, `${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c`,
      `${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`, `h ${mode}`,
    ].join(' '));
    return this;
  }
  /** Free path: list of ['m', x, y] | ['l', x, y] | ['c', x1, y1, x2, y2, x, y], then a paint op. */
  path(cmds, mode = 'S') { this.ops.push(cmds.map(([op, ...a]) => a.map(n).join(' ') + ' ' + op).join(' ') + ' ' + mode); return this; }
  dash(on, off) { this.ops.push(on ? `[${n(on)} ${n(off)}] 0 d` : '[] 0 d'); return this; }
  lineCap(c) { this.ops.push(`${c} J`); return this; }
  /** Text. o: { font, size, color, align: left|center|right, spacing (character spacing in pt) }. */
  text(str, x, y, o = {}) {
    const font = o.font || 'Helvetica';
    const size = o.size || 12;
    const cs = o.spacing || 0;
    const w = textWidth(str, font, size) + cs * Math.max(0, winAnsi(str).length - 1);
    const tx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
    this.ops.push(`BT ${hex(o.color || '#000000')} rg /${FONT_KEY[font] || 'F1'} ${n(size)} Tf ${cs ? n(cs) + ' Tc ' : ''}${n(tx)} ${n(y)} Td ${pdfStr(str)} Tj${cs ? ' 0 Tc' : ''} ET`);
    return this;
  }
  /** Wrap text to a width; returns the y below the last line. */
  para(str, x, y, width, o = {}) {
    const font = o.font || 'Helvetica'; const size = o.size || 12; const lh = o.lh || size * 1.45;
    const words = String(str).split(/\s+/).filter(Boolean);
    let line = '';
    const lines = [];
    for (const w of words) { const t = line ? line + ' ' + w : w; if (textWidth(t, font, size) > width && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    lines.forEach((l, i) => this.text(l, o.align === 'center' ? x + width / 2 : x, y - i * lh, { ...o, font, size }));
    return y - lines.length * lh;
  }
  save() { this.ops.push('q'); return this; }
  restore() { this.ops.push('Q'); return this; }
}

/** Serialise pages into a PDF file (Buffer). */
function build(pages, info = {}) {
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add(null);
  const pagesObj = add(null);
  const fontIds = {};
  for (const [k, name] of Object.entries(FONTS)) fontIds[k] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
  const fontRes = Object.entries(fontIds).map(([k, id]) => `/${k} ${id} 0 R`).join(' ');
  const kids = [];
  for (const p of pages) {
    const content = p.ops.join('\n');
    const cid = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n(p.w)} ${n(p.h)}] /Resources << /Font << ${fontRes} >> >> /Contents ${cid} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  const d = new Date();
  const pd = `D:${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}00Z`;
  const infoId = add(`<< /Title ${pdfStr(info.title || 'Document')} /Author ${pdfStr(info.author || 'VooSquare')} /Creator (VooSquare) /Producer (VooSquare) /CreationDate (${pd}) >>`);
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/* ------------------------------------------------------------------ the VooSquare Academy certificate */
const C = { ink: '#0A1A13', body: '#3A4842', muted: '#6A7A73', line: '#E3EBE7', brand: '#00A86B', deep: '#00774B', lime: '#C9F65B', night: '#0A1611', night2: '#13261C', ntext: '#B9C9C1', tint: '#E7F8F0' };

/** The VooSquare mark: a green tile with four cells, the last one lime. (x, y) is the bottom-left corner. */
function mark(pg, x, y, s) {
  pg.fill(C.brand).rrect(x, y, s, s, s * 0.26);
  const c = s * 0.29, g = s * 0.1, o = (s - 2 * c - g) / 2;
  pg.fill('#FFFFFF').rrect(x + o, y + o + c + g, c, c, c * 0.28);
  pg.fill('#B3E8D3').rrect(x + o + c + g, y + o + c + g, c, c, c * 0.28);
  pg.fill('#B3E8D3').rrect(x + o, y + o, c, c, c * 0.28);
  pg.fill(C.lime).rrect(x + o + c + g, y + o, c, c, c * 0.28);
}

/**
 * Certificate, A4 landscape. d: { name, title, school, schoolOrder, track, verticalTitle, date, code, verifyUrl, final, site }.
 * Left: the night panel with the brand and the three-stage route (earned stages filled). Right: the award.
 */
function certificate(d) {
  const PW = 841.89, PH = 595.28;
  const pg = new Page(PW, PH);
  const PANEL = 232;
  // Paper and frame.
  pg.fill('#FFFFFF').rect(0, 0, PW, PH);
  pg.fill(C.night).rect(0, 0, PANEL, PH);
  pg.stroke(C.night2, 0.6);
  for (let x = 24; x < PANEL; x += 26) pg.line(x, 0, x, PH);
  for (let y = 20; y < PH; y += 26) pg.line(0, y, PANEL, y);
  pg.stroke(C.line, 0.8).rect(PANEL + 18, 18, PW - PANEL - 36, PH - 36, 'S');
  pg.fill(C.brand).rect(PANEL, 0, 3, PH);

  // Brand.
  mark(pg, 36, PH - 82, 40);
  // The wordmark: VooSquare (lime "Square") next to the VooSquare mark.
  pg.text('Voo', 88, PH - 60, { font: 'Helvetica-Bold', size: 19, color: '#FFFFFF' });
  pg.text('Square', 88 + textWidth('Voo', 'Helvetica-Bold', 19), PH - 60, { font: 'Helvetica-Bold', size: 19, color: C.lime });
  pg.text('Academy', 88, PH - 79, { font: 'Times-Italic', size: 16, color: '#FFFFFF' });

  // The route: Foundations → Operator → Scale, stations earned in lime.
  // Main schools show the three-stage route; a vertical school shows Foundations then its vertical.
  // An extra school (made in the admin, outside the paced path) shows just itself.
  const vert = d.track === 'vertical';
  const extra = d.track === 'extra';
  const stations = vert ? ['Foundations', String(d.verticalTitle || 'Vertical')] : extra ? [((s) => (s.length > 24 ? s.slice(0, 22).trim() + '...' : s))(String(d.school || 'VooSquare Academy'))] : ['Foundations', 'Operator', 'Scale and Lead'];
  const subs = vert ? ['Main school', 'Vertical school'] : extra ? ['VooSquare Academy'] : ['School 1', 'School 2', 'School 3'];
  const earned = vert ? 2 : extra ? 1 : Math.max(1, Math.min(3, Number(d.schoolOrder) || 1));
  const sx = 52, top = PH - 190, gap = 92;
  pg.lineCap(1);
  for (let i = 0; i < stations.length - 1; i++) {
    const y1 = top - i * gap - 13, y2 = top - (i + 1) * gap + 13;
    if (i + 1 < earned) pg.stroke(C.lime, 3).line(sx, y1, sx, y2);
    else pg.stroke('#2B4537', 2).dash(3, 5).line(sx, y1, sx, y2).dash(0);
  }
  stations.forEach((label, i) => {
    const y = top - i * gap;
    const on = i < earned;
    if (on) { pg.fill(C.lime).circle(sx, y, 13); pg.stroke(C.night, 2.4).path([['m', sx - 5.5, y + 0.5], ['l', sx - 1.5, y - 4], ['l', sx + 6, y + 4.5]], 'S'); }
    else { pg.fill(C.night).circle(sx, y, 13); pg.stroke('#2B4537', 2).circle(sx, y, 12, 'S'); pg.text(String(i + 1), sx, y - 4, { font: 'Helvetica-Bold', size: 11, color: '#6F8579', align: 'center' }); }
    pg.text(label, sx + 26, y + 1, { font: 'Helvetica-Bold', size: 12.5, color: on ? '#FFFFFF' : '#6F8579' });
    pg.text(subs[i], sx + 26, y - 13, { font: 'Helvetica', size: 9, color: on ? C.ntext : '#4E6458' });
  });
  pg.text('The school for media buyers.', 36, 46, { font: 'Times-Italic', size: 13, color: C.lime });
  pg.text(String(d.site || 'voosquareacademy.com'), 36, 30, { font: 'Helvetica', size: 9, color: C.ntext });

  // The award.
  const x0 = PANEL + 62, cw = PW - x0 - 62;
  const parts = String(d.title || 'Certificate').split(/\s+[—–-]\s+/);
  const label = parts.length > 1 ? parts[0] : 'Certificate';
  const main = parts.length > 1 ? parts.slice(1).join(' — ') : parts[0];
  pg.fill(C.deep).rect(x0, PH - 92, 26, 3);
  pg.text(label, x0 + 36, PH - 95, { font: 'Helvetica-Bold', size: 11.5, color: C.deep, spacing: 0.3 });
  let ts = 36;
  while (ts > 22 && textWidth(main, 'Helvetica-Bold', ts) > cw) ts -= 1;
  pg.text(main, x0, PH - 142, { font: 'Helvetica-Bold', size: ts, color: C.ink, spacing: -0.6 });
  pg.text('This certifies that', x0, PH - 196, { font: 'Helvetica', size: 12, color: C.muted });
  const nm = String(d.name || '').trim() || 'VooSquare Academy graduate';
  let ns = 52;
  while (ns > 26 && textWidth(nm, 'Times-Italic', ns) > cw) ns -= 1;
  pg.text(nm, x0, PH - 258, { font: 'Times-Italic', size: ns, color: C.ink });
  pg.stroke(C.line, 1).line(x0, PH - 276, x0 + cw, PH - 276);
  pg.fill(C.brand).rect(x0, PH - 277.5, 64, 3);
  // "Passed the school's final exam" only when there was one and it was passed (an admin-made school may have none).
  const what = d.final === false
    ? `completed every lesson and module of VooSquare Academy: ${d.school || ''}. Taught by the VooSquare Academy team at Zedapex.`
    : `completed every lesson, quiz and module exam of VooSquare Academy: ${d.school || ''}, and passed the school's final exam. Taught by the VooSquare Academy team at Zedapex.`;
  pg.para(what, x0, PH - 304, cw - 40, { font: 'Helvetica', size: 12, color: C.body, lh: 18 });

  // Signature and seal.
  const sy = 150;
  pg.text('Dchessking', x0 + 4, sy + 12, { font: 'Times-Italic', size: 30, color: C.ink });
  pg.stroke(C.ink, 0.8).line(x0, sy, x0 + 200, sy);
  pg.text('Dchessking, Founder, Zedapex', x0, sy - 15, { font: 'Helvetica-Bold', size: 10, color: C.ink });
  pg.text('VooSquare Academy', x0, sy - 28, { font: 'Helvetica', size: 9, color: C.muted });
  const cx = x0 + cw - 52, cy = sy + 14;
  pg.fill(C.tint).circle(cx, cy, 50);
  pg.stroke(C.brand, 1.4).circle(cx, cy, 43, 'S');
  pg.stroke(C.brand, 0.6).dash(1.5, 3).circle(cx, cy, 38, 'S').dash(0);
  mark(pg, cx - 17, cy - 9, 34);
  pg.text('VERIFIED', cx, cy - 25, { font: 'Helvetica-Bold', size: 6.5, color: C.deep, align: 'center', spacing: 1.2 });

  // Facts.
  const fy = 64;
  pg.stroke(C.line, 0.8).line(x0, fy + 30, x0 + cw, fy + 30);
  const cols = [['Issued', d.date || ''], ['Certificate code', d.code || ''], ['Check it at', String(d.verifyUrl || '').replace(/^https?:\/\//, '')]];
  const cwid = [120, 150, cw - 270];
  let cxp = x0;
  cols.forEach(([k, v], i) => {
    pg.text(k, cxp, fy + 12, { font: 'Helvetica', size: 8.5, color: C.muted });
    let vs = 10.5;
    while (vs > 7 && textWidth(v, 'Helvetica-Bold', vs) > cwid[i] - 8) vs -= 0.5;
    pg.text(v, cxp, fy - 4, { font: 'Helvetica-Bold', size: vs, color: C.ink });
    cxp += cwid[i];
  });
  return build([pg], { title: `${d.title} - ${nm}`, author: 'VooSquare Academy' });
}

module.exports = { Page, build, certificate, textWidth, winAnsi, mark };
