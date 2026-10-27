/* Animated lesson visuals. VSL.render(step) returns HTML for the dark lesson stage; VSL.animate(stageEl) starts it.
 * Step shape: { v: type, h: heading, p: narration, d: data }   (full shapes: docs/SCHOOL_BRIEF.md)
 * Classic types:
 *   big      { b: "Big line", s: "small line" }
 *   stat     { n: 1.84, pre: "$", suf: "", dec: 2, label: "cost per real join", note: "Example" }
 *   flow     ["Step", "Step", "Step"]                     (left to right, last one highlighted)
 *   eq       ["$500", "÷", "250 joins", "=", "$2.00"]      (operators: ÷ × + − → =)
 *   check    ["item", "item"]                               (ticks animate in)
 *   quote    "text"  (optional step.by: "dchessking" | any name)
 *   bars     [["Label", percent0to100, "value label"], ...]
 *   funnel   [["Clicks", 1000], ["Joined", 410], ["Deposited", 22]]
 *   cards    ["Title|sub", "Title|sub"]
 *   curve    { a: [..numbers], b: [..numbers], la: "CTR %", lb: "Frequency", x: ["D1",...] }
 *   compare  { a: { title: "Before", items: [..] }, b: { title: "After", items: [..] } }
 *   chat     [{ from: "lead" | "ai" | "buyer", text: "..." }]
 * VooSquare Academy types:
 *   table    { cols: [..], rows: [[..], ..] }
 *   tip      { kind: "tip" | "warn" | "example", text }
 *   phone    { app: "chat" | "bot" | "browser", title, subtitle, messages: [{ from: "me" | "them", text, buttons }], url, page: { h, p, cta } }
 *   screen   { kind: "browser", url, title, blocks: [{ type: field|select|toggle|radio|text|table|button, ... }], highlight }
 *   walk     { steps: [{ title, text, screen: { v: "phone" | "screen", ...that type's d } }] }
 *   map      { nodes: [{ id, label, kind }], edges: [[from, to, label]] }
 *   code     { lang, text, note }
 *   lab      { kind: breakeven | roas | killscale | budget | funnel | utm | verticalpicker, task, preset, answer: { field, value, tolerance } }
 *   photo    { src, alt, caption }
 * Everything animates on enter, respects prefers-reduced-motion and pauses while the stage is off-screen. No inline
 * scripts or handlers (CSP): animate() binds the interactive parts.
 */
(function () {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const OPS = ['÷', '×', '+', '−', '-', '→', '='];
  const tick = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const arr = (x) => (Array.isArray(x) ? x : []);
  let uid = 0;

  /* Line icons (own set, so the visuals also work where shared.js is not loaded). */
  const I = {
    tip: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z"/>',
    warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    example: '<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8.5 7.5h7M8.5 12h.01M12 12h.01M15.5 12h.01M8.5 15.5h.01M12 15.5h.01M15.5 15.5h.01"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    left: '<path d="M15 6l-6 6 6 6"/>',
    right: '<path d="M9 6l6 6-6 6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    down: '<path d="M7 10l5 5 5-5"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
    clip: '<path d="M20 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/>',
    reload: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
    ad: '<path d="M4 10v4a1 1 0 0 0 1 1h2l7 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
    page: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 8.5h18M7 13h10M7 16.5h6"/>',
    telegram: '<path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/>',
    bot: '<rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M9.5 16.5h5"/>',
    offer: '<path d="M3.5 12.5V5a1.5 1.5 0 0 1 1.5-1.5h7.5l8 8-9 9z"/><circle cx="8" cy="8" r="1.6"/>',
    data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    person: '<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c1-4 4-6 7.5-6s6.5 2 7.5 6"/>',
    money: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.9-2.8 2.1 0 2.9 5.8 1.4 5.8 4.3 0 1.2-1.3 2.1-3 2.1-1.3 0-2.5-.6-3-1.5M12 6v1.8M12 16.3V18"/>',
    tool: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17v3h3l5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16l4-5 3 3 5-7"/>',
    pointer: '<path d="M5 3l14 7-6 2-2 6z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/>',
  };
  const ic = (k, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[k] || I.tip}</svg>`;

  /* ---------------- shared pieces ---------------- */
  const statusBar = () => `<div class="ph-sb"><b>9:41</b><span class="ph-isl" aria-hidden="true"></span><span class="ph-sig" aria-hidden="true"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1" opacity=".35"/></svg><svg viewBox="0 0 16 12"><path d="M8 11.5l2.4-2.9a3.5 3.5 0 0 0-4.8 0zM3.4 6.5a6.6 6.6 0 0 1 9.2 0l1.6-1.9a9 9 0 0 0-12.4 0z"/></svg><svg viewBox="0 0 27 12"><rect x=".5" y=".5" width="22" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".45"/><rect x="2.2" y="2.2" width="15" height="7.6" rx="1.8"/><rect x="24" y="4" width="2" height="4" rx="1" opacity=".45"/></svg></span></div>`;
  const initial = (t) => (String(t || '?').trim()[0] || '?').toUpperCase();
  const AVC = ['#3D6BF2', '#00A86B', '#E8458B', '#EE5A2F', '#5B3FE8', '#0F766E', '#B88A00'];
  const avColor = (t) => { let h = 0; for (const c of String(t || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVC[h % AVC.length]; };
  const nl = (s) => esc(s).replace(/\n/g, '<br>');

  function phoneHtml(d, opts = {}) {
    d = d || {};
    const app = d.app === 'browser' ? 'browser' : d.app === 'bot' ? 'bot' : 'chat';
    let inner;
    if (app === 'browser') {
      const pg = d.page || {};
      inner = `<div class="ph-url">${ic('lock')}<span>${esc(d.url || 'example.com')}</span>${ic('reload')}</div>
        <div class="ph-page"><div class="ph-hero" aria-hidden="true"><i></i><i></i><i></i></div>
          ${pg.h ? `<h5>${esc(pg.h)}</h5>` : ''}${pg.p ? `<p>${nl(pg.p)}</p>` : ''}${pg.cta ? `<span class="ph-cta" data-tap>${esc(pg.cta)}</span>` : ''}
          <small class="ph-ex">Example page</small></div>`;
    } else {
      const msgs = arr(d.messages);
      inner = `<div class="ph-head"><span class="ph-back">${ic('left')}</span><span class="ph-av" style="background:${avColor(d.title)}">${esc(initial(d.title))}</span><span class="ph-ht"><b>${esc(d.title || 'Chat')}</b><small>${esc(d.subtitle || (app === 'bot' ? 'bot' : 'online'))}</small></span></div>
        <div class="ph-chat"><div class="ph-msgs">${msgs.map((m, i) => {
          const me = m && m.from === 'me';
          const btns = arr(m && m.buttons);
          return `<div class="ph-m ${me ? 'pm-me' : 'pm-them'}" data-i="${i}"><div class="ph-b">${nl(m && m.text)}<span class="ph-time">9:4${Math.min(9, 1 + i)}${me ? '<svg viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5.5l2.6 2.6L9 2.5M6.5 8.1L12 2.5"/></svg>' : ''}</span></div>${btns.length ? `<div class="ph-kb" style="grid-template-columns:repeat(${Math.min(btns.length, btns.length > 3 ? 2 : btns.length)},1fr)">${btns.map((b) => `<span data-tap>${esc(b)}</span>`).join('')}</div>` : ''}</div>`;
        }).join('')}<div class="ph-typing" aria-hidden="true"><i></i><i></i><i></i></div></div></div>
        <div class="ph-comp">${app === 'bot' ? '<span class="ph-menu">Menu</span>' : ic('clip')}<span class="ph-in">Message</span>${ic('mic')}</div>`;
    }
    return `<div class="vl-phone ${opts.cls || ''}" data-app="${app}" role="img" aria-label="${esc(app === 'browser' ? 'Example phone page: ' + ((d.page && d.page.h) || d.url || '') : 'Example chat: ' + (d.title || ''))}"><div class="ph-frame"><div class="ph-screen">${statusBar()}${inner}</div></div></div>`;
  }

  function screenHtml(d, opts = {}) {
    d = d || {};
    const blocks = arr(d.blocks);
    const hl = Number.isInteger(d.highlight) ? d.highlight : -1;
    const blk = (b, i) => {
      b = b || {};
      const on = i === hl ? ' hl' : '';
      const lab = b.label ? `<span class="sc-l">${esc(b.label)}</span>` : '';
      switch (b.type) {
        case 'field': return `<div class="sc-blk sc-field${on}" data-b="${i}">${lab}<span class="sc-in"><span class="sc-v" data-val="${esc(b.value ?? '')}">${esc(b.value ?? '')}</span><i class="sc-caret"></i></span></div>`;
        case 'select': return `<div class="sc-blk sc-select${on}" data-b="${i}">${lab}<span class="sc-in"><span class="sc-v">${esc(b.value ?? '')}</span>${ic('down')}</span></div>`;
        case 'toggle': return `<div class="sc-blk sc-toggle${on}" data-b="${i}"><span class="sc-l">${esc(b.label || '')}</span><span class="sc-sw ${b.on ? 'on' : ''}"><i></i></span></div>`;
        case 'radio': return `<div class="sc-blk sc-radio${on}" data-b="${i}">${lab}<span class="sc-ro">${arr(b.options).map((o, k) => `<span class="${Number(b.value) === k || b.value === o ? 'on' : ''}"><i></i>${esc(o)}</span>`).join('')}</span></div>`;
        case 'text': return `<p class="sc-blk sc-text${on}" data-b="${i}">${nl(b.value || b.label || '')}</p>`;
        case 'table': return `<div class="sc-blk sc-table${on}" data-b="${i}"><table><thead><tr>${arr(b.cols).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${arr(b.rows).map((r) => `<tr>${arr(r).map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
        case 'button': return `<div class="sc-blk sc-btnrow${on}" data-b="${i}"><span class="sc-btn">${esc(b.label || 'Continue')}</span></div>`;
        default: return `<p class="sc-blk sc-text${on}" data-b="${i}">${esc(b.label || b.value || '')}</p>`;
      }
    };
    return `<div class="vl-screen ${opts.cls || ''}" role="img" aria-label="${esc('Example screen: ' + (d.title || d.url || ''))}">
      <div class="sc-bar"><span class="sc-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sc-url">${ic('lock')}<span>${esc(d.url || 'app.example')}</span></span></div>
      <div class="sc-body"><div class="sc-side" aria-hidden="true"><i></i><i class="on"></i><i></i><i></i></div>
        <div class="sc-main">${d.title ? `<div class="sc-title"><b>${esc(d.title)}</b><span class="sc-ex">Example</span></div>` : ''}<div class="sc-blocks">${blocks.map(blk).join('')}</div></div>
        <span class="sc-cursor" aria-hidden="true"><svg viewBox="0 0 24 24">${I.pointer}</svg></span></div></div>`;
  }

  /* A walk step's screen: "v" picks the device; without it, a screen-shaped object (blocks, no app) is drawn as a screen. */
  const subScreen = (s) => {
    if (s && s.d && typeof s.d === 'object' && !Array.isArray(s.d)) s = { ...s.d, v: s.v }; // also accept { v, d: {...} } like a slide
    return s && (s.v === 'screen' || (s.v !== 'phone' && !s.app && Array.isArray(s.blocks))) ? screenHtml(s) : phoneHtml(s || {});
  };

  /* ---------------- code ---------------- */
  const markPh = (t) => t.replace(/(&lt;[^&]*?&gt;|\{\{?[\w.]+\}?\}|__[A-Z_]+__)/g, '<span class="cdk-m">$1</span>');
  function highlight(lang, text) {
    const raw = String(text ?? '');
    if (lang === 'url') {
      const qi = raw.indexOf('?');
      if (qi < 0) return markPh(esc(raw));
      return markPh(esc(raw.slice(0, qi))) + '<span class="cdk-p">?</span>' + raw.slice(qi + 1).split('&').map((p) => { const k = p.indexOf('='); return k < 0 ? esc(p) : `<span class="cdk-k">${esc(p.slice(0, k))}</span>=<span class="cdk-v">${markPh(esc(p.slice(k + 1)))}</span>`; }).join('<span class="cdk-p">&amp;</span>');
    }
    const t = esc(raw);
    if (lang === 'json') return t.replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(-?\d+\.?\d*|true|false|null)\b/g, (m, str, colon, lit) => (str ? (colon ? `<span class="cdk-k">${str}</span>${colon}` : `<span class="cdk-v">${str}</span>`) : `<span class="cdk-n">${lit}</span>`));
    if (lang === 'bash') return markPh(t.replace(/^(\$ )/gm, '<span class="cdk-p">$1</span>').replace(/(\s)(-{1,2}[\w-]+)/g, '$1<span class="cdk-k">$2</span>'));
    if (lang === 'js') return t.replace(/(&#39;(?:[^&]|&(?!#39;))*?&#39;|&quot;(?:[^&]|&(?!quot;))*?&quot;|`[^`]*`)|\b(const|let|var|function|return|await|async|if|else|new)\b/g, (m, str, kw) => (str ? `<span class="cdk-v">${str}</span>` : `<span class="cdk-k">${kw}</span>`));
    return markPh(t);
  }

  /* ---------------- labs ---------------- */
  const LAB_NAME = { breakeven: 'Break-even calculator', roas: 'ROAS and profit', killscale: 'Kill, hold or scale', budget: 'Budget planner', funnel: 'Funnel leaks', utm: 'Link builder', verticalpicker: 'Vertical picker' };
  const LAB_FIELDS = {
    breakeven: [['payout', 'Payout per FTD', '$', ''], ['cr_pct', 'Leads that deposit', '', '%'], ['margin_pct', 'Margin you keep', '', '%']],
    roas: [['spend', 'Ad spend', '$', ''], ['revenue', 'Revenue', '$', '']],
    killscale: [['spend', 'Spent so far', '$', ''], ['conversions', 'Conversions', '', ''], ['target_cpa', 'Target CPA', '$', ''], ['days', 'Days running', '', '']],
    budget: [['goal', 'Conversions wanted', '', ''], ['target_cpa', 'Target CPA', '$', ''], ['days', 'Days', '', '']],
  };
  const ANSWER = { max_cpl: ['Max cost per lead', '$', ''], max_cpa: ['Max cost per FTD', '$', ''], roas: ['ROAS', '', '×'], profit: ['Profit', '$', ''], daily_budget: ['Daily budget', '$', ''] };
  const fmtN = (v, dec = 2) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: Math.abs(v) % 1 ? dec : 0, maximumFractionDigits: dec }) : '—');
  const money = (v) => (Number.isFinite(v) ? (v < 0 ? '-$' : '$') + fmtN(Math.abs(v)) : '—');
  const num = (v) => { const n = Number(String(v ?? '').replace(/[\s,$%×x]/g, '')); return String(v ?? '').trim() === '' ? NaN : n; };

  function labCompute(kind, p, field) {
    const g = (k) => num(p[k]);
    if (kind === 'breakeven') {
      const pay = g('payout'), cr = g('cr_pct') / 100, m = (Number.isFinite(g('margin_pct')) ? g('margin_pct') : 0) / 100;
      const r = { max_cpl: pay * cr * (1 - m), max_cpa: pay * (1 - m) };
      const work = field === 'max_cpa' ? `${money(pay)} × (1 − ${fmtN(m * 100)}%) = ${money(r.max_cpa)}` : `${money(pay)} × ${fmtN(cr * 100)}% = ${money(pay * cr)} break-even, × (1 − ${fmtN(m * 100)}%) = ${money(r.max_cpl)}`;
      return { value: r[field || 'max_cpl'], work };
    }
    if (kind === 'roas') {
      const s = g('spend'), rev = g('revenue');
      const r = { roas: rev / s, profit: rev - s };
      return { value: r[field || 'roas'], work: field === 'profit' ? `${money(rev)} − ${money(s)} = ${money(r.profit)}` : `${money(rev)} ÷ ${money(s)} = ${fmtN(r.roas)}×` };
    }
    if (kind === 'budget') {
      const goal = g('goal'), cpa = g('target_cpa'), days = g('days');
      const v = goal * cpa / days;
      return { value: v, work: `${fmtN(goal, 0)} × ${money(cpa)} = ${money(goal * cpa)} total, ÷ ${fmtN(days, 0)} days = ${money(v)} a day` };
    }
    if (kind === 'killscale') {
      const TM = window.VSTM;
      if (!TM) return { value: '', work: '' };
      const r = TM.killScale({ spend: g('spend'), conversions: g('conversions'), target: g('target_cpa'), days: g('days') });
      if (!r) return { value: '', work: '' };
      return { value: r.verdict === 'scale_big' ? 'scale' : r.verdict, work: `${r.label}: ${r.reason} Rule: ${r.rule}.` };
    }
    if (kind === 'funnel') {
      const steps = arr(p.steps);
      let worst = -1, low = Infinity;
      const rates = steps.map((s, i) => { if (!i) return null; const prev = num(steps[i - 1][1]); const r = prev > 0 ? num(s[1]) / prev * 100 : NaN; if (Number.isFinite(r) && r < low) { low = r; worst = i; } return r; });
      return { value: worst, rates, work: worst > 0 ? `${esc(steps[worst][0])}: ${fmtN(num(steps[worst][1]), 0)} ÷ ${fmtN(num(steps[worst - 1][1]), 0)} = ${fmtN(rates[worst], 0)}%, the lowest pass-through.` : '' };
    }
    return { value: NaN, work: '' };
  }

  function labHtml(d) {
    d = d || {};
    const kind = LAB_NAME[d.kind] ? d.kind : 'breakeven';
    const p = d.preset || {};
    const ans = d.answer || {};
    const head = `<div class="lb-head"><span class="lb-ic">${ic('example')}</span><span><small>Practice</small><b>${esc(LAB_NAME[kind])}</b></span></div>${d.task ? `<p class="lb-task">${esc(d.task)}</p>` : ''}`;
    const inField = ([k, label, pre, suf], val) => `<label class="lb-f"><span>${esc(label)}</span><span class="lb-in">${pre ? `<i>${pre}</i>` : ''}<input type="text" inputmode="decimal" data-k="${esc(k)}" value="${esc(val ?? '')}" autocomplete="off">${suf ? `<i>${suf}</i>` : ''}</span></label>`;
    let body = '';
    // Writers may rename the labels: { "rate": "Approval rate", "unit": "approved lead" } or any field key.
    const lab = d.labels && typeof d.labels === 'object' ? d.labels : {};
    const unit = lab.unit ? String(lab.unit) : '';
    const relabel = (f) => {
      const [k, label, pre, suf] = f;
      let l = lab[k] || label;
      if (kind === 'breakeven' && !lab[k]) {
        if (k === 'payout' && unit) l = `Payout per ${unit}`;
        if (k === 'cr_pct' && lab.rate) l = lab.rate;
        if (k === 'margin_pct' && lab.margin) l = lab.margin;
      }
      return [k, l, pre, suf];
    };
    if (LAB_FIELDS[kind]) {
      const field = ans.field || (kind === 'breakeven' ? 'max_cpl' : kind === 'roas' ? 'roas' : kind === 'budget' ? 'daily_budget' : 'verdict');
      const inputs = `<div class="lb-grid">${LAB_FIELDS[kind].map((f) => inField(relabel(f), p[f[0]])).join('')}</div>`;
      let answer;
      if (kind === 'killscale') answer = `<div class="lb-ans"><span class="lb-al">${esc(lab.answer || 'Your call')}</span><div class="lb-choice" role="group" aria-label="Your call">${['kill', 'hold', 'scale'].map((v) => `<button type="button" data-pick="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div></div>`;
      else {
        const a = ANSWER[field] || ['Your answer', '', ''];
        let al = a[0].toLowerCase();
        if (field === 'max_cpa' && unit) al = `max cost per ${unit}`;
        answer = `<div class="lb-ans">${inField([field, lab.answer || 'Your answer: ' + al, a[1], a[2]], '').replace('class="lb-f"', 'class="lb-f lb-mine"')}</div>`;
      }
      body = `${inputs}${answer}<div class="lb-act"><button type="button" class="lb-btn" data-check>Check answer</button><button type="button" class="lb-link" data-show hidden>Show the working</button></div><div class="lb-fb" aria-live="polite"></div>`;
      return `<div class="vl-lab vl-interactive" data-kind="${kind}" data-field="${esc(field)}" data-preset="${esc(JSON.stringify(p))}" data-answer="${esc(JSON.stringify(ans))}">${head}${body}</div>`;
    }
    if (kind === 'funnel') {
      const steps = arr(p.steps);
      body = `<div class="lb-fun">${steps.map((s, i) => `<div class="lb-fr" data-i="${i}"><span class="lb-fn">${i}</span><span class="lb-fl">${esc(s[0])}</span><input type="text" inputmode="numeric" data-step="${i}" value="${esc(s[1])}" aria-label="${esc(s[0])}"><span class="lb-rate" data-rate="${i}"></span>${i ? `<button type="button" class="lb-pickrow" data-pick="${i}" aria-label="Pick ${esc(s[0])} as the weakest step">Weakest</button>` : '<span></span>'}</div>`).join('')}</div>
        ${p.payout ? `<p class="lb-note">Payout ${money(num(p.payout))} per FTD.</p>` : ''}<div class="lb-act"><button type="button" class="lb-btn" data-check disabled>Pick the weakest step</button><button type="button" class="lb-link" data-show hidden>Show the rates</button></div><div class="lb-fb" aria-live="polite"></div>`;
      return `<div class="vl-lab vl-interactive" data-kind="funnel" data-field="worst_step" data-preset="${esc(JSON.stringify(p))}" data-answer="${esc(JSON.stringify(ans))}">${head}${body}</div>`;
    }
    if (kind === 'utm') {
      const f = [['base', 'Landing page link', p.base || 'https://example.com/offer'], ['source', 'utm_source', p.source || 'facebook'], ['medium', 'utm_medium', p.medium || 'paid_social'], ['campaign', 'utm_campaign', p.campaign || 'ng_test_01'], ['content', 'utm_content', p.content || '']];
      body = `<div class="lb-grid lb-utm">${f.map(([k, l, v]) => `<label class="lb-f${k === 'base' ? ' wide' : ''}"><span>${esc(l)}</span><span class="lb-in"><input type="text" data-k="${k}" value="${esc(v)}" autocomplete="off" spellcheck="false"></span></label>`).join('')}</div>
        <div class="lb-out"><code data-out></code><button type="button" class="lb-copy" data-copy-out>${ic('copy')}Copy</button></div><p class="lb-note">Build the link, then paste it into a browser and check the page still opens. Free build: there is no single right answer.</p>`;
      return `<div class="vl-lab vl-interactive" data-kind="utm">${head}${body}</div>`;
    }
    // verticalpicker
    const Q = [
      ['budget', 'Spare test budget a month', [['low', 'Under $300'], ['mid', '$300 to $1,500'], ['high', 'Over $1,500']]],
      ['risk', 'Risk you can carry', [['low', 'Low'], ['mid', 'Medium'], ['high', 'High']]],
      ['geo', 'Where you will run', [['africa', 'African geos'], ['mixed', 'Mixed'], ['tier1', 'Tier 1 (US, UK, EU)']]],
      ['skill', 'Your strongest skill', [['creative', 'Videos and copy'], ['data', 'Numbers and tracking'], ['chat', 'Chat, sales and community']]],
      ['reg', 'Regulated verticals', [['avoid', 'Avoid them for now'], ['comply', 'I will get authorization and follow the law']]],
    ];
    body = `<div class="lb-q">${Q.map(([k, l, opts]) => `<div class="lb-qr"><span class="lb-ql">${esc(l)}</span><div class="lb-choice" role="group" aria-label="${esc(l)}" data-q="${k}">${opts.map(([v, t]) => `<button type="button" data-v="${v}">${esc(t)}</button>`).join('')}</div></div>`).join('')}</div>
      <div class="lb-act"><button type="button" class="lb-btn" data-suggest disabled>Suggest verticals</button></div><div class="lb-fb lb-vp" aria-live="polite"></div>`;
    return `<div class="vl-lab vl-interactive" data-kind="verticalpicker">${head}${body}</div>`;
  }

  /* Vertical picker rules: a guide, not advice. Scores per vertical, with the reasons that moved them. */
  const VERTS = {
    ecom: { name: 'E-commerce (COD and CPS)', base: 3, why: 'Physical products and cash on delivery are familiar to buyers, offers are unregulated in most geos and payouts start small.' },
    apps: { name: 'Apps and installs (CPI)', base: 2, why: 'Cheap events to optimise for, fast feedback, no deposit needed from the user.' },
    leadgen: { name: 'Lead generation (CPL)', base: 2, why: 'You are paid for a qualified form fill, so learning is fast and the money at risk per test is small.' },
    finance: { name: 'Finance and loans', base: 1, why: 'High payouts, but strict rules on claims and who may advertise. Platform authorization and local licensing apply.' },
    trading: { name: 'Trading (FTD and RevShare)', base: 1, why: 'Large payouts and RevShare upside; needs authorization for financial ads, KYC-heavy funnels and patience for deposits.' },
    igaming: { name: 'iGaming and sports betting', base: 1, why: 'Strong payouts where it is legal; needs gambling ad authorization, age limits and licensed operators only.' },
    nutra: { name: 'Health and wellness offers', base: 0, why: 'Easy to sell, easy to break rules: health claims are tightly limited by platforms and law.' },
  };
  function pickVerticals(a) {
    const s = Object.fromEntries(Object.entries(VERTS).map(([k, v]) => [k, { score: v.base, notes: [] }]));
    const add = (k, n, note) => { s[k].score += n; if (note && n > 0) s[k].notes.push(note); };
    if (a.budget === 'low') { add('ecom', 2, 'fits a small test budget'); add('apps', 2, 'cheap events stretch a small budget'); add('leadgen', 2, 'low cost per result'); add('trading', -2); add('igaming', -2); add('finance', -1); }
    if (a.budget === 'mid') { add('ecom', 1, 'room for proper creative tests'); add('leadgen', 1); add('trading', 1, 'enough budget to wait for deposits'); add('igaming', 1); }
    if (a.budget === 'high') { add('trading', 2, 'budget to wait for deposits and qualify RevShare'); add('igaming', 2, 'budget for the longer learning phase'); add('finance', 1); }
    if (a.risk === 'low') { add('ecom', 1); add('leadgen', 2, 'low variance per result'); add('apps', 1); add('trading', -1); add('igaming', -2); add('nutra', -1); }
    if (a.risk === 'high') { add('trading', 2, 'high payout, high variance suits your risk level'); add('igaming', 2, 'payouts swing, which you said you can carry'); }
    if (a.geo === 'africa') { add('ecom', 2, 'cash on delivery is common in African geos'); add('trading', 1, 'strong demand in Nigeria, Kenya and South Africa, where it is legal and authorised'); add('apps', 1, 'Android-heavy markets suit app offers'); add('igaming', 1, 'sports betting has large audiences where it is licensed'); }
    if (a.geo === 'tier1') { add('finance', 2, 'tier 1 pays the highest for qualified finance leads'); add('leadgen', 1, 'tier 1 lead payouts are high'); add('ecom', -1); }
    if (a.geo === 'mixed') { add('apps', 1, 'app offers run in most geos'); add('leadgen', 1); }
    if (a.skill === 'creative') { add('ecom', 2, 'product demos reward strong video and copy'); add('apps', 1, 'short videos drive installs'); }
    if (a.skill === 'data') { add('leadgen', 2, 'tracking and testing skills pay off on volume'); add('trading', 1, 'deposit tracking rewards careful data work'); add('finance', 1); }
    if (a.skill === 'chat') { add('trading', 2, 'Telegram funnels and chat follow-up lift deposits'); add('igaming', 1, 'community and chat keep players engaged'); add('ecom', 1, 'chat confirms COD orders'); }
    if (a.reg === 'avoid') { for (const k of ['trading', 'igaming', 'finance', 'nutra']) s[k].score -= 6; }
    if (a.reg === 'comply') { add('trading', 1, 'you plan to get authorization and follow the law'); add('finance', 1, 'you plan to get authorization and follow the law'); }
    return Object.entries(s).sort((x, y) => y[1].score - x[1].score).slice(0, 3).map(([k, v]) => ({ key: k, name: VERTS[k].name, why: VERTS[k].why, notes: [...new Set(v.notes)].slice(0, 3), regulated: ['trading', 'igaming', 'finance', 'nutra'].includes(k) }));
  }

  /* ---------------- map ---------------- */
  function mapHtml(d) {
    const nodes = arr(d && d.nodes).slice(0, 12);
    return `<div class="vl-map" data-map="${esc(JSON.stringify({ nodes, edges: arr(d && d.edges) }))}" role="img" aria-label="${esc('Flow: ' + nodes.map((n) => n.label).join(', '))}"><div class="mp-svg"></div><ol class="sr">${nodes.map((n) => `<li>${esc(n.label)}</li>`).join('')}</ol></div>`;
  }
  const KIND_IC = { ad: 'ad', page: 'page', telegram: 'telegram', bot: 'bot', offer: 'offer', data: 'data', person: 'person', money: 'money', tool: 'tool' };
  function wrapLabel(s, max) {
    const words = String(s || '').split(/\s+/); const lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (t.length > max && line) { lines.push(line); line = w; } else line = t; }
    if (line) lines.push(line);
    if (lines.length > 2) { lines[1] = lines.slice(1).join(' '); lines.length = 2; if (lines[1].length > max) lines[1] = lines[1].slice(0, max - 1) + '…'; }
    return lines;
  }
  function layoutMap(el) {
    let data;
    try { data = JSON.parse(el.dataset.map); } catch { return; }
    const nodes = data.nodes.filter((n) => n && n.id);
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const edges = data.edges.filter((e) => Array.isArray(e) && byId[e[0]] && byId[e[1]] && e[0] !== e[1]);
    // Layers: longest path from a source (cycles are cut by the visit guard).
    const depth = {};
    const visit = (id, seen) => { if (depth[id] !== undefined) return depth[id]; if (seen.has(id)) return 0; seen.add(id); const ins = edges.filter((e) => e[1] === id); const d = ins.length ? Math.max(...ins.map((e) => visit(e[0], seen) + 1)) : 0; depth[id] = d; return d; };
    nodes.forEach((n) => visit(n.id, new Set()));
    const layers = [];
    nodes.forEach((n) => { (layers[depth[n.id]] = layers[depth[n.id]] || []).push(n); });
    const L = layers.filter(Boolean);
    const W = Math.max(280, el.clientWidth || 600);
    const narrow = W < 560;
    const NW = narrow ? Math.min(150, (W - 40) / Math.max(1, Math.max(...L.map((l) => l.length))) - 12) : 150, NH = 60;
    const pos = {};
    let VW, VH;
    if (narrow) {
      // Top to bottom: one row per layer, nodes of a layer side by side.
      const gapY = 46;
      VW = W; VH = L.length * NH + (L.length - 1) * gapY + 20;
      L.forEach((layer, li) => { const tw = layer.length * NW + (layer.length - 1) * 12; layer.forEach((n, k) => { pos[n.id] = { x: (W - tw) / 2 + k * (NW + 12), y: 10 + li * (NH + gapY), row: li, dir: 'down' }; }); });
    } else {
      // Left to right, wrapping into a snake when there are more layers than fit.
      const labW = Math.max(0, ...edges.map((e) => (e[2] ? String(e[2]).length * 6.1 + 22 : 0)));
      const want = Math.max(56, Math.min(labW, 150));
      const perRow = Math.max(2, Math.min(L.length, Math.floor((W - 20 + want) / (NW + want))));
      const rows = Math.ceil(L.length / perRow);
      const gapX = perRow > 1 ? Math.min(Math.max(want, 56) + 30, (W - 20 - perRow * NW) / (perRow - 1)) : 0;
      const maxStack = Math.max(...L.map((l) => l.length));
      const rowH = maxStack * NH + (maxStack - 1) * 14;
      const gapY = 64;
      VW = W; VH = rows * rowH + (rows - 1) * gapY + 24;
      const used = Math.min(perRow, L.length) * NW + (Math.min(perRow, L.length) - 1) * gapX;
      const x0 = (W - used) / 2;
      L.forEach((layer, li) => {
        const row = Math.floor(li / perRow); let col = li % perRow;
        const rtl = row % 2 === 1; if (rtl) col = perRow - 1 - col;
        const th = layer.length * NH + (layer.length - 1) * 14;
        layer.forEach((n, k) => { pos[n.id] = { x: x0 + col * (NW + gapX), y: 12 + row * (rowH + gapY) + (rowH - th) / 2 + k * (NH + 14), row, rtl }; });
      });
    }
    const id = 'mp' + (++uid);
    const R = reduced();
    const pathFor = (a, b) => {
      const A0 = pos[a], B0 = pos[b];
      if (A0.row === B0.row && !narrow) {
        const fwd = B0.x >= A0.x;
        const x1 = fwd ? A0.x + NW : A0.x, x2 = fwd ? B0.x : B0.x + NW, y1 = A0.y + NH / 2, y2 = B0.y + NH / 2, mx = (x1 + x2) / 2;
        return { d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`, lx: mx, ly: (y1 + y2) / 2 };
      }
      const down = B0.y > A0.y;
      const x1 = A0.x + NW / 2, y1 = down ? A0.y + NH : A0.y, x2 = B0.x + NW / 2, y2 = down ? B0.y : B0.y + NH, my = (y1 + y2) / 2;
      return { d: `M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`, lx: (x1 + x2) / 2, ly: my };
    };
    const maxChars = Math.max(10, Math.floor((NW - 46) / 6.6));
    const eHtml = edges.map((e, i) => {
      const p = pathFor(e[0], e[1]);
      const lab = e[2] ? String(e[2]) : '';
      const lw = lab.length * 6.1 + 14;
      return `<g class="mp-e" style="--d:${0.35 + i * 0.22}s"><path id="${id}e${i}" class="mp-path" d="${p.d}"/>${R ? '' : `<circle class="mp-dot" r="3.6"><animateMotion dur="${2.2 + (i % 3) * 0.25}s" begin="${(0.6 + i * 0.3).toFixed(2)}s" repeatCount="indefinite"><mpath href="#${id}e${i}"/></animateMotion></circle>`}${lab ? `<g class="mp-lab"><rect x="${(p.lx - lw / 2).toFixed(1)}" y="${(p.ly - 10).toFixed(1)}" width="${lw.toFixed(1)}" height="20" rx="10"/><text x="${p.lx.toFixed(1)}" y="${(p.ly + 4).toFixed(1)}" text-anchor="middle">${esc(lab)}</text></g>` : ''}</g>`;
    }).join('');
    const nHtml = nodes.map((n, i) => {
      const p = pos[n.id]; if (!p) return '';
      const lines = wrapLabel(n.label, maxChars);
      const k = KIND_IC[n.kind] || 'tool';
      return `<g class="mp-n k-${esc(k)}" style="--d:${i * 0.12}s" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"><rect class="mp-box" width="${NW}" height="${NH}" rx="16"/><circle class="mp-ic" cx="24" cy="${NH / 2}" r="15"/><svg x="14" y="${NH / 2 - 10}" width="20" height="20" viewBox="0 0 24 24" class="mp-g">${I[k]}</svg>${lines.map((l, j) => `<text x="46" y="${NH / 2 + (j - (lines.length - 1) / 2) * 15 + 4.5}">${esc(l)}</text>`).join('')}</g>`;
    }).join('');
    el.querySelector('.mp-svg').innerHTML = `<svg viewBox="0 0 ${VW.toFixed(0)} ${VH.toFixed(0)}" width="100%" style="max-width:${VW}px" aria-hidden="true">${eHtml}${nHtml}</svg>`;
    el.dataset.narrow = narrow ? '1' : '';
  }

  /* ---------------- render ---------------- */
  function render(step) {
    const d = step && step.d;
    const t = step && step.v;
    try {
      if (t === 'big') return `<div class="vl-big"><b>${esc(d.b)}</b>${d.s ? `<small>${esc(d.s)}</small>` : ''}</div>`;
      if (t === 'stat') return `<div class="vl-stat"><b data-count="${Number(d.n) || 0}" data-pre="${esc(d.pre || '')}" data-suf="${esc(d.suf || '')}" data-dec="${Number(d.dec) || 0}">${esc((d.pre || '') + d.n + (d.suf || ''))}</b><small>${esc(d.label || '')}</small>${d.note ? `<em>${esc(d.note)}</em>` : ''}</div>`;
      if (t === 'flow') return `<div class="vl-flow">${d.map((n, i) => `${i ? `<span class="vl-fl"><i style="animation-delay:${i * 0.2}s"></i></span>` : ''}<span class="vl-fn ${i === d.length - 1 ? 'last' : ''}" style="animation-delay:${i * 0.25}s">${esc(n)}</span>`).join('')}</div>`;
      if (t === 'eq') return `<div class="vl-eq">${d.map((x, i) => OPS.includes(String(x).trim()) ? `<span class="o" style="animation-delay:${i * 0.28}s">${esc(x)}</span>` : `<span class="t ${i === d.length - 1 ? 'r' : ''}" style="animation-delay:${i * 0.28}s">${esc(x)}</span>`).join('')}</div>`;
      if (t === 'check') return `<div class="vl-check">${d.map((x, i) => `<div class="vl-k" style="animation-delay:${i * 0.14}s"><span style="animation-delay:${0.5 + i * 0.5}s">${tick}</span>${esc(x)}</div>`).join('')}</div>`;
      if (t === 'quote') {
        const by = step.by || 'dchessking';
        const face = by === 'dchessking' && window.VS ? window.VS.founder().replace(/<g transform="translate\(100 34\)">[\s\S]*?<\/g>/, '') : (window.VS ? window.VS.avatar({ skin: 3, hair: 2, shirt: 1, bg: 0 }) : '');
        return `<div class="vl-quote"><q>${esc(d)}</q><span class="who"><span class="av av-sm">${face}</span>${esc(by === 'dchessking' ? 'Dchessking' : by)}</span></div>`;
      }
      if (t === 'bars') return `<div class="vl-bars">${d.map((r, i) => `<div class="vl-br${String(r[2] ?? '').length > 9 ? ' wide' : ''}"><span>${esc(r[0])}</span><span class="vl-bt"><i style="width:${Math.max(Math.min(Number(r[1]) || 0, 100), 1.5)}%;animation-delay:${i * 0.18}s"></i></span><b>${esc(r[2] ?? '')}</b></div>`).join('')}<p class="vl-note">Illustration</p></div>`;
      if (t === 'funnel') {
        const max = Math.max(...d.map((r) => Number(r[1]) || 0), 1);
        return `<div class="vl-funnel">${d.map((r, i) => { const w = Math.max((Number(r[1]) || 0) / max * 100, 8); const prev = i ? Number(d[i - 1][1]) || 0 : 0; const pct = i && prev ? Math.round((Number(r[1]) || 0) / prev * 100) : null; return `<div class="vl-fu" style="animation-delay:${i * 0.2}s"><div class="vl-fb" style="width:${w}%"><b>${esc(Number(r[1]).toLocaleString('en-US'))}</b></div><span>${esc(r[0])}${pct !== null ? ` <em>${pct}% carry on</em>` : ''}</span></div>`; }).join('')}<p class="vl-note">Illustration</p></div>`;
      }
      if (t === 'cards') return `<div class="vl-cards" style="grid-template-columns:repeat(${d.length <= 3 ? d.length : d.length === 4 ? 2 : 3},minmax(0,1fr))">${d.map((x, i) => { const [a, b] = String(x).split('|'); return `<div class="vl-c" style="animation-delay:${i * 0.15}s">${esc(a)}${b ? `<small>${esc(b)}</small>` : ''}</div>`; }).join('')}</div>`;
      if (t === 'curve') {
        const W = 400, H = 170, n = d.a.length, all = [...d.a, ...(d.b || [])].map((v) => Number(v) || 0), mx = Math.max(...all) * 1.1 || 1;
        const pts = (a) => a.map((v, i) => `${(i / (n - 1) * W).toFixed(1)},${(H - (Number(v) || 0) / mx * H).toFixed(1)}`).join(' L');
        const xs = d.x || d.a.map((_, i) => 'D' + (i + 1));
        return `<div class="vl-curve"><svg viewBox="-10 -26 ${W + 20} ${H + 56}"><g stroke="#22362B">${[0, 1, 2, 3, 4].map((i) => `<line x1="0" x2="${W}" y1="${i * H / 4}" y2="${i * H / 4}"/>`).join('')}</g><path class="vl-draw" d="M${pts(d.a)}" fill="none" stroke="#C9F65B" stroke-width="4" stroke-linecap="round"/>${d.b ? `<path class="vl-draw" style="animation-delay:.5s" d="M${pts(d.b)}" fill="none" stroke="#FF7A45" stroke-width="4" stroke-linecap="round"/>` : ''}${xs.map((x, i) => `<text x="${i / (n - 1) * W}" y="${H + 22}" fill="#8A9A93" font-size="12" text-anchor="middle" font-family="JetBrains Mono, monospace">${esc(x)}</text>`).join('')}<g font-size="13" font-weight="700"><rect x="0" y="-24" width="10" height="10" rx="2" fill="#C9F65B"/><text x="16" y="-15" fill="#fff">${esc(d.la || '')}</text>${d.b ? `<rect x="130" y="-24" width="10" height="10" rx="2" fill="#FF7A45"/><text x="146" y="-15" fill="#fff">${esc(d.lb || '')}</text>` : ''}</g></svg><p class="vl-note">Illustration</p></div>`;
      }
      if (t === 'compare') return `<div class="vl-compare"><div class="vl-cmp a"><b>${esc(d.a.title)}</b>${d.a.items.map((x, i) => `<span style="animation-delay:${0.1 + i * 0.12}s">${esc(x)}</span>`).join('')}</div><div class="vl-cmp b"><b>${esc(d.b.title)}</b>${d.b.items.map((x, i) => `<span style="animation-delay:${0.6 + i * 0.12}s">${esc(x)}</span>`).join('')}</div></div>`;
      if (t === 'chat') return `<div class="vl-chat">${d.map((m, i) => `<div class="vl-msg ${m.from === 'lead' ? 'in' : m.from === 'paid' ? 'paid' : 'out'}" style="animation-delay:${0.3 + i * 0.9}s">${esc(m.text)}</div>`).join('')}</div>`;
      /* ----- VooSquare Academy types ----- */
      if (t === 'table') {
        const cols = arr(d.cols), rows = arr(d.rows);
        return `<div class="vl-table"><div class="tb-wrap"><table><thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr style="animation-delay:${0.15 + i * 0.09}s">${arr(r).map((c, k) => (k ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`)).join('')}</tr>`).join('')}</tbody></table></div></div>`;
      }
      if (t === 'tip') {
        const k = ['warn', 'example'].includes(d.kind) ? d.kind : 'tip';
        const label = { tip: 'Tip', warn: 'Watch out', example: 'Worked example' }[k];
        return `<div class="vl-tip k-${k}"><span class="tp-ic">${ic(k)}</span><span class="tp-l">${label}</span><p>${nl(d.text)}</p></div>`;
      }
      if (t === 'phone') return `<div class="vl-device">${phoneHtml(d)}</div>`;
      if (t === 'screen') return `<div class="vl-device wide">${screenHtml(d)}</div>`;
      if (t === 'walk') {
        const steps = arr(d.steps).slice(0, 7);
        if (!steps.length) throw new Error('empty walk');
        return `<div class="vl-walk vl-interactive" data-n="${steps.length}" data-walk="${esc(JSON.stringify(steps))}">
          <div class="wk-side"><div class="wk-dots" role="tablist" aria-label="Walkthrough steps">${steps.map((s, i) => `<button type="button" role="tab" data-go="${i}" aria-selected="${i === 0}" aria-label="Step ${i + 1}: ${esc(s.title)}"><span>${i + 1}</span></button>`).join('')}</div>
            <div class="wk-txt"><small data-wk-n>Step 1 of ${steps.length}</small><b data-wk-t>${esc(steps[0].title)}</b><p data-wk-p>${nl(steps[0].text)}</p></div>
            <div class="wk-ctl"><button type="button" class="wk-b" data-wk="-1" disabled>${ic('left')}Back</button><button type="button" class="wk-b wk-main" data-wk="1">Next${ic('right')}</button></div></div>
          <div class="wk-dev">${subScreen(steps[0].screen)}</div></div>`;
      }
      if (t === 'map') return mapHtml(d);
      if (t === 'code') {
        const lang = ['text', 'url', 'json', 'js', 'bash'].includes(d.lang) ? d.lang : 'text';
        return `<div class="vl-code"><div class="cd-bar"><span class="cd-lang">${esc({ text: 'Text', url: 'Link', json: 'JSON', js: 'JavaScript', bash: 'Terminal' }[lang])}</span><button type="button" class="cd-copy" data-code-copy>${ic('copy')}<span>Copy</span></button></div><pre class="cd-pre lang-${lang}"><code>${highlight(lang, d.text)}</code></pre>${d.note ? `<p class="cd-note">${esc(d.note)}</p>` : ''}<textarea class="sr" tabindex="-1" aria-hidden="true" data-code-raw>${esc(d.text)}</textarea></div>`;
      }
      if (t === 'lab') return labHtml(d);
      if (t === 'product') {
        const p = step._ref;
        if (!p) return `<div class="vl-product none"><div class="pd-card"><span class="pd-ic">${ic('tool')}</span><span class="pd-t"><b>${esc(d.slug)}</b><small>Product card. It shows the live product from Admin → Products.</small></span></div>${d.why ? `<p class="pd-why"><span>Why it helps here</span>${esc(d.why)}</p>` : ''}</div>`;
        const icn = window.VS && window.VS.productIcon ? window.VS.productIcon(p, 'lg') : '';
        const st = { live: 'Live', new: 'New', beta: 'Beta', soon: 'Coming soon' }[p.status] || 'Live';
        const go = p.launch_url ? `<a class="pd-go" href="${esc(p.launch_url)}" ${p.hub ? '' : 'target="_blank" rel="noopener"'}>${p.status === 'soon' ? 'Join the waitlist' : `Open ${esc(p.name)}`}${ic('right')}</a>` : `<span class="pd-go off">${p.status === 'soon' ? 'Coming soon' : 'Find it in Apps'}</span>`;
        const hex = /^#([0-9a-f]{6})$/i.exec(p.color || '') ? parseInt(p.color.slice(1), 16) : 0x00A86B;
        const lum = (0.299 * (hex >> 16) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)) / 255;
        return `<div class="vl-product" style="--pc:${esc(p.color || '#00A86B')};--pcf:${lum > 0.62 ? '#14200A' : '#fff'}"><div class="pd-card"><span class="pd-glow" aria-hidden="true"></span>${icn}<span class="pd-t"><span class="pd-row"><b>${esc(p.name)}</b><span class="pd-st s-${esc(p.status)}">${st}</span></span><small>${esc(p.stage || '')}${p.offer ? ` · ${esc(p.offer)}` : ''}</small></span><p class="pd-tag">${esc(p.tagline || '')}</p>${go}</div>${d.why ? `<p class="pd-why"><span>Why it helps here</span>${esc(d.why)}</p>` : ''}<small class="pd-note">A Zedapex tool. Optional: everything in this lesson works without it.</small></div>`;
      }
      if (t === 'partner') {
        const list = Array.isArray(step._ref) ? step._ref : [];
        const vname = { nutra: 'nutra', igaming: 'iGaming', trading: 'trading', finance: 'finance', sweeps: 'sweepstakes and lead gen', general: 'every vertical' }[d.vertical] || d.vertical || '';
        if (!list.length) return `<div class="vl-partner empty"><span class="pt-ic">${ic('offer')}</span><b>Partner cards for ${esc(vname)}</b><p>${step._staff ? 'None yet. Add partners in Admin → Academy → Partners. Members skip this slide until there are some.' : 'Partners appear here when the team adds them.'}</p></div>`;
        return `<div class="vl-partner">${d.note ? `<p class="pt-note">${ic('tip')}${esc(d.note)}</p>` : ''}<div class="pt-cards">${list.slice(0, 6).map((x, i) => `<a class="pt-c" href="${esc(x.go)}" target="_blank" rel="noopener sponsored" style="animation-delay:${i * 0.1}s"><span class="pt-ch">${x.logo ? `<img src="${esc(x.logo)}" alt="">` : `<span class="pt-ini">${esc((x.name || '?')[0])}</span>`}<b>${esc(x.name)}</b>${x.badge ? `<em>${esc(x.badge)}</em>` : ''}</span>${x.description ? `<p>${esc(x.description)}</p>` : ''}${(x.highlights || []).length ? `<ul>${x.highlights.map((h) => `<li>${ic('check')}${esc(h)}</li>`).join('')}</ul>` : ''}<span class="pt-go">${esc(x.cta || 'Visit')}${ic('right')}</span></a>`).join('')}</div><small class="pd-note">Check each partner's terms, and the law and ad rules in every country you run.</small></div>`;
      }
      if (t === 'photo') return `<figure class="vl-photo"><img src="/${esc(String(d.src || '').replace(/^\/+/, ''))}" alt="${esc(d.alt || '')}" loading="lazy" decoding="async">${d.caption ? `<figcaption>${esc(d.caption)}</figcaption>` : ''}</figure>`;
    } catch (e) {
      return `<div class="vl-big"><b>${esc(step && step.h)}</b></div>`;
    }
    return `<div class="vl-big"><b>${esc(step && step.h)}</b></div>`;
  }

  /* ---------------- motion helpers ---------------- */
  /** Timeline that waits while its stage is off-screen (class vl-off) and stops when the element leaves the page. */
  function timeline(el, steps) {
    let i = 0; let tm = 0;
    const tickT = () => {
      if (!el.isConnected) return;
      if (el.closest('.vl-off') || document.hidden) { tm = setTimeout(tickT, 250); return; }
      if (i >= steps.length) return;
      const [wait, fn] = steps[i++];
      tm = setTimeout(() => { if (!el.isConnected) return; fn(); tickT(); }, wait);
    };
    tickT();
    return () => clearTimeout(tm);
  }

  function playPhone(ph) {
    if (ph._stop) ph._stop();
    const msgs = [...ph.querySelectorAll('.ph-m')];
    const typing = ph.querySelector('.ph-typing');
    const box = ph.querySelector('.ph-chat');
    const scroll = () => { if (box) box.scrollTop = box.scrollHeight; };
    if (!msgs.length) { const cta = ph.querySelector('.ph-cta'); if (cta && !reduced()) ph._stop = timeline(ph, [[1400, () => tap(cta)]]); return; }
    if (reduced()) { msgs.forEach((m) => m.classList.add('pm-in')); scroll(); return; }
    msgs.forEach((m) => m.classList.remove('pm-in'));
    const steps = [];
    msgs.forEach((m, k) => {
      if (m.classList.contains('pm-them')) {
        steps.push([k ? 420 : 350, () => { typing.classList.add('on'); scroll(); }]);
        steps.push([Math.min(1500, 520 + m.textContent.length * 9), () => { typing.classList.remove('on'); m.classList.add('pm-in'); scroll(); }]);
      } else steps.push([k ? 650 : 400, () => { m.classList.add('pm-in'); scroll(); }]);
    });
    const lastBtn = ph.querySelector('.ph-m:last-of-type .ph-kb span') || null;
    if (lastBtn) steps.push([700, () => tap(lastBtn)]);
    ph._stop = timeline(ph, steps);
  }

  function tap(target) {
    if (!target || reduced()) return;
    target.classList.remove('vl-tap'); void target.offsetWidth; target.classList.add('vl-tap');
  }

  function playScreen(sc) {
    const hl = sc.querySelector('.sc-blk.hl');
    const cur = sc.querySelector('.sc-cursor');
    if (!hl || !cur) { if (cur) cur.hidden = true; return; }
    const body = sc.querySelector('.sc-body');
    const place = () => {
      const b = body.getBoundingClientRect(); const r = (hl.querySelector('.sc-in,.sc-sw,.sc-btn,.sc-ro') || hl).getBoundingClientRect();
      cur.style.setProperty('--tx', (r.left - b.left + Math.min(r.width * 0.7, r.width - 12)) + 'px');
      cur.style.setProperty('--ty', (r.top - b.top + r.height * 0.55) + 'px');
    };
    place();
    const v = hl.querySelector('.sc-v[data-val]');
    if (reduced()) { cur.classList.add('sc-at'); return; }
    cur.classList.remove('sc-at');
    const steps = [[500, () => { place(); cur.classList.add('sc-at'); }], [900, () => tap(hl.querySelector('.sc-in,.sc-sw,.sc-btn,.sc-ro') || hl)]];
    if (v) {
      const full = v.dataset.val; v.textContent = '';
      for (let k = 1; k <= full.length; k++) steps.push([k === 1 ? 250 : 45, () => { v.textContent = full.slice(0, k); }]);
    }
    sc._stop = timeline(sc, steps);
  }

  function bindWalk(w) {
    let steps;
    try { steps = JSON.parse(w.dataset.walk); } catch { return; }
    let cur = 0;
    const show = (n) => {
      cur = Math.max(0, Math.min(steps.length - 1, n));
      const s = steps[cur];
      w.querySelector('[data-wk-n]').textContent = `Step ${cur + 1} of ${steps.length}`;
      w.querySelector('[data-wk-t]').textContent = s.title || '';
      w.querySelector('[data-wk-p]').innerHTML = nl(s.text);
      w.querySelectorAll('[data-go]').forEach((b, k) => { b.setAttribute('aria-selected', k === cur); b.classList.toggle('done', k < cur); });
      w.querySelector('[data-wk="-1"]').disabled = cur === 0;
      const nx = w.querySelector('[data-wk="1"]');
      nx.disabled = cur === steps.length - 1;
      nx.innerHTML = cur === steps.length - 1 ? `Done${ic('check')}` : `Next${ic('right')}`;
      const dev = w.querySelector('.wk-dev');
      dev.innerHTML = subScreen(s.screen);
      dev.classList.remove('swap'); void dev.offsetWidth; dev.classList.add('swap');
      startDevices(dev);
    };
    w.addEventListener('click', (e) => {
      const b = e.target.closest('[data-wk],[data-go]');
      if (!b || b.disabled) return;
      e.stopPropagation();
      show(b.dataset.go !== undefined ? Number(b.dataset.go) : cur + Number(b.dataset.wk));
    });
    w.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') e.stopPropagation(); });
    startDevices(w.querySelector('.wk-dev'));
  }

  function startDevices(root) {
    root.querySelectorAll('.vl-phone').forEach(playPhone);
    root.querySelectorAll('.vl-screen').forEach((sc) => requestAnimationFrame(() => playScreen(sc)));
  }

  function bindCode(c) {
    const b = c.querySelector('[data-code-copy]');
    if (!b) return;
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = c.querySelector('[data-code-raw]').value;
      let ok = false;
      try { await navigator.clipboard.writeText(text); ok = true; } catch { /* blocked */ }
      if (!ok) { const r = document.createRange(); r.selectNodeContents(c.querySelector('code')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      b.classList.add('done'); b.querySelector('span').textContent = ok ? 'Copied' : 'Selected';
      setTimeout(() => { b.classList.remove('done'); b.querySelector('span').textContent = 'Copy'; }, 1800);
    });
  }

  /* tools-math.js is loaded on demand for the labs that need it (Kill or scale rules, link builder). */
  let tmP = null;
  function needTM() {
    if (window.VSTM) return Promise.resolve(window.VSTM);
    if (!tmP) tmP = new Promise((res) => { const s = document.createElement('script'); s.src = '/js/tools-math.js'; s.onload = () => res(window.VSTM); s.onerror = () => res(null); document.head.appendChild(s); });
    return tmP;
  }

  function celebrate(fb, ok, title, text, work) {
    fb.innerHTML = `<div class="lb-res ${ok ? 'ok' : 'no'}"><span class="lb-badge">${ic(ok ? 'check' : 'x')}</span><div><b>${esc(title)}</b>${text ? `<p>${esc(text)}</p>` : ''}${work ? `<p class="lb-work">${work}</p>` : ''}</div></div>`;
    if (ok && !reduced()) { const r = fb.querySelector('.lb-res'); for (let i = 0; i < 12; i++) { const s = document.createElement('i'); s.className = 'lb-spark'; s.style.setProperty('--a', (i * 30) + 'deg'); s.style.setProperty('--dl', (i % 3) * 0.04 + 's'); r.appendChild(s); } }
  }

  function bindLab(lab) {
    const kind = lab.dataset.kind;
    const fb = lab.querySelector('.lb-fb');
    const stop = (e) => e.stopPropagation();
    lab.addEventListener('keydown', stop);
    lab.addEventListener('touchstart', stop, { passive: true });
    lab.addEventListener('touchend', stop);
    if (kind === 'utm') {
      const out = lab.querySelector('[data-out]');
      const build = async () => {
        const v = (k) => lab.querySelector(`[data-k="${k}"]`).value.trim();
        const TM = await needTM();
        const params = [['utm_source', v('source')], ['utm_medium', v('medium')], ['utm_campaign', v('campaign')], ['utm_content', v('content')]];
        const r = TM ? TM.buildUtm({ base: v('base'), params }) : { url: v('base') + '?' + params.filter((p) => p[1]).map((p) => p.join('=')).join('&') };
        out.textContent = r.error || r.url; out.classList.toggle('lb-err', !!r.error);
      };
      lab.addEventListener('input', build); build();
      lab.querySelector('[data-copy-out]').addEventListener('click', async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(out.textContent); e.currentTarget.classList.add('done'); } catch { /* ignore */ } });
      return;
    }
    if (kind === 'verticalpicker') {
      const ans = {};
      const go = lab.querySelector('[data-suggest]');
      lab.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q] [data-v]');
        if (b) {
          const g = b.closest('[data-q]'); ans[g.dataset.q] = b.dataset.v;
          g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
          go.disabled = Object.keys(ans).length < 5;
          go.textContent = go.disabled ? `Answer all five (${Object.keys(ans).length} of 5)` : 'Suggest verticals';
          return;
        }
        if (e.target.closest('[data-suggest]')) {
          const list = pickVerticals(ans);
          fb.innerHTML = `<div class="vp-res">${list.map((v, i) => `<div class="vp-c" style="animation-delay:${i * 0.12}s"><span class="vp-n">${i + 1}</span><div><b>${esc(v.name)}</b><p>${esc(v.why)}</p>${v.notes.length ? `<ul>${v.notes.map((n) => `<li>${ic('check')}${esc(n[0].toUpperCase() + n.slice(1))}</li>`).join('')}</ul>` : ''}${v.regulated ? '<p class="vp-reg">Regulated: check the ad platform\'s authorization rules and the law in every country you run.</p>' : ''}</div></div>`).join('')}</div><p class="lb-note">This is a guide to start your research, not advice. Change an answer to see how the shortlist moves.</p>`;
        }
      });
      go.textContent = 'Answer all five (0 of 5)';
      return;
    }
    let preset = {}; let answer = {};
    try { preset = JSON.parse(lab.dataset.preset || '{}'); answer = JSON.parse(lab.dataset.answer || '{}'); } catch { /* ignore */ }
    const field = lab.dataset.field;
    let tries = 0;
    const cur = () => {
      if (kind === 'funnel') return { ...preset, steps: arr(preset.steps).map((s, i) => [s[0], num(lab.querySelector(`[data-step="${i}"]`).value)]) };
      const p = {}; lab.querySelectorAll('.lb-grid [data-k]').forEach((i) => { p[i.dataset.k] = i.value; }); return p;
    };
    const changed = () => {
      const c = cur();
      if (kind === 'funnel') return arr(preset.steps).some((s, i) => num(s[1]) !== c.steps[i][1]);
      return Object.keys(c).some((k) => num(c[k]) !== num(preset[k]));
    };
    const showBtn = lab.querySelector('[data-show]');
    const expected = () => {
      const r = labCompute(kind, cur(), field);
      // The lesson's own answer counts while the numbers are untouched; change them and the maths decides.
      if (!changed() && answer && answer.value !== undefined && answer.value !== '') r.value = kind === 'killscale' ? String(answer.value).replace('scale_big', 'scale') : Number(answer.value);
      return r;
    };
    let pick = null;
    if (kind === 'killscale') needTM();
    lab.addEventListener('click', async (e) => {
      const pb = e.target.closest('[data-pick]');
      if (pb) {
        e.stopPropagation(); pick = pb.dataset.pick;
        lab.querySelectorAll('[data-pick]').forEach((x) => x.classList.toggle('on', x === pb));
        const cb = lab.querySelector('[data-check]'); cb.disabled = false; cb.textContent = 'Check answer';
        return;
      }
      if (e.target.closest('[data-show]')) {
        e.stopPropagation();
        const r = expected();
        if (kind === 'funnel') paintRates(r);
        celebrate(fb, false, 'The working', '', r.work || esc(kind === 'killscale' ? String(r.value) : fmtN(r.value)));
        fb.querySelector('.lb-res').classList.replace('no', 'info');
        return;
      }
      if (!e.target.closest('[data-check]')) return;
      e.stopPropagation();
      if (kind === 'killscale') await needTM();
      const r = expected();
      let ok; let mine;
      if (kind === 'killscale' || kind === 'funnel') { if (pick == null) return; mine = kind === 'funnel' ? Number(pick) : pick; ok = String(mine) === String(r.value); }
      else {
        mine = num(lab.querySelector('.lb-mine input').value);
        if (!Number.isFinite(mine)) { celebrate(fb, false, 'Type your answer first', 'Use numbers only, for example 8 or 8.50.'); return; }
        const tol = Math.max(Number(answer.tolerance) || 0, 0.01);
        ok = Math.abs(mine - r.value) <= Math.max(tol, tol * Math.abs(r.value)) + 1e-9;
      }
      tries++;
      if (kind === 'funnel') paintRates(r);
      if (ok) celebrate(fb, true, 'Correct', kind === 'killscale' ? '' : '', r.work);
      else {
        let hint = 'Check each number in the task and try again.';
        if (typeof mine === 'number' && Number.isFinite(r.value) && kind !== 'funnel') hint = mine > r.value ? 'Too high. Go back over the margin and the rate.' : 'Too low. Check what you multiplied or divided by.';
        if (kind === 'funnel') hint = 'Compare each row with the row above it, not with the first row.';
        if (kind === 'killscale') hint = 'Compare your CPA with the target, and check whether there is enough data yet.';
        celebrate(fb, false, 'Not yet', hint);
        if (tries >= 2) showBtn.hidden = false;
      }
    });
    function paintRates(r) {
      if (!r.rates) return;
      r.rates.forEach((v, i) => { const el = lab.querySelector(`[data-rate="${i}"]`); if (el) { el.textContent = i && Number.isFinite(v) ? fmtN(v, 0) + '%' : ''; el.classList.toggle('low', i === r.value); } });
    }
    lab.addEventListener('input', () => { if (fb.innerHTML) fb.innerHTML = ''; });
  }

  /** Pause animations while a stage is off-screen. */
  const seen = new WeakSet();
  function watch(root) {
    if (seen.has(root) || !('IntersectionObserver' in window)) return;
    seen.add(root);
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      root.classList.toggle('vl-off', !en.isIntersecting);
      root.querySelectorAll('svg').forEach((s) => { try { if (en.isIntersecting) s.unpauseAnimations(); else s.pauseAnimations(); } catch { /* not an SVG root */ } });
    }), { threshold: 0.05 });
    io.observe(root);
  }

  function countUp(el) {
    const to = Number(el.dataset.count), dec = Number(el.dataset.dec) || 0, pre = el.dataset.pre || '', suf = el.dataset.suf || '';
    const show = (v) => { el.textContent = pre + v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + suf; };
    if (reduced()) return show(to);
    const t0 = performance.now();
    (function step(t) { const p = Math.min((t - t0) / 1300, 1); show(to * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); })(t0);
  }

  /* ---------------- build with the voice ----------------
   * The narrator (app-voice.js) calls build(stage) when a slide's clip starts, then reveal(stage, f) as the clip plays
   * (f = played share of the clip, 0..1). The parts listed here come in one by one across the first ~60% of the clip.
   * Dense, interactive or self-timed visuals (phone, screen, walk, lab, map, code, curve) are left alone. */
  const BUILD = {
    big: '.vl-big > b, .vl-big > small', stat: '.vl-stat > b, .vl-stat > small, .vl-stat > em', flow: '.vl-fn, .vl-fl', eq: '.vl-eq > .t, .vl-eq > .o',
    check: '.vl-k', quote: '.vl-quote > q, .vl-quote > .who', bars: '.vl-br', funnel: '.vl-fu', cards: '.vl-c', compare: '.vl-cmp > b, .vl-cmp > span',
    chat: '.vl-msg', table: '.vl-table tbody tr', tip: '.vl-tip > .tp-ic, .vl-tip > .tp-l, .vl-tip > p',
  };
  const BUILD_END = 0.6;
  /** Prepare a stage to build with the voice. Returns false when the slide has nothing to build. */
  function build(stage) {
    if (!stage || reduced() || stage._vb) return !!(stage && stage._vb);
    const sel = BUILD[stage.dataset.v];
    if (!sel) return false;
    const items = [...stage.querySelectorAll(':scope > .la-art'), ...stage.querySelectorAll(sel)];
    if (items.length - (items[0] && items[0].classList.contains('la-art') ? 1 : 0) < 2) return false;
    items.forEach((el) => el.classList.add('vb'));
    stage._vb = items; stage._vbn = 0;
    stage.classList.add('vl-build');
    reveal(stage, 0);
    return true;
  }
  /** Show the parts the voice has reached. f >= 1 shows everything. */
  function reveal(stage, f) {
    const items = stage && stage._vb;
    if (!items) return;
    // The illustration (if any) and the first part show at once; the rest follow evenly up to BUILD_END of the clip.
    const n = items.length; const lead = items[0].classList.contains('la-art') ? 1 : 0; const parts = n - lead;
    const want = f >= 1 ? n : Math.min(n, lead + 1 + Math.floor((Math.max(0, f) / BUILD_END) * parts + 1e-6));
    for (let k = stage._vbn; k < want; k++) {
      const el = items[k];
      el.classList.add('vb-in');
      if (el.matches('[data-count]')) countUp(el);
      el.querySelectorAll('[data-count]').forEach(countUp);
    }
    stage._vbn = Math.max(stage._vbn, want);
  }

  /** Run after inserting render() output: count-ups, line drawing and the interactive parts. */
  function animate(root) {
    if (!root) return;
    root.querySelectorAll('.vl-draw').forEach((p) => { try { p.style.setProperty('--len', Math.ceil(p.getTotalLength())); } catch { /* ignore */ } });
    root.querySelectorAll('[data-count]').forEach(countUp);
    root.querySelectorAll('.vl-walk').forEach(bindWalk);
    root.querySelectorAll('.vl-device').forEach(startDevices);
    root.querySelectorAll('.vl-code').forEach(bindCode);
    root.querySelectorAll('.vl-lab').forEach(bindLab);
    root.querySelectorAll('.vl-photo img').forEach((img) => img.addEventListener('error', () => { const f = img.closest('.vl-photo'); f.classList.add('missing'); img.remove(); }, { once: true }));
    root.querySelectorAll('.vl-map').forEach((m) => {
      layoutMap(m);
      if ('ResizeObserver' in window) { let w = m.clientWidth; const ro = new ResizeObserver(() => { if (!m.isConnected) { ro.disconnect(); return; } if (Math.abs(m.clientWidth - w) > 40) { w = m.clientWidth; layoutMap(m); } }); ro.observe(m); }
    });
    watch(root);
  }

  const TYPES = ['big', 'stat', 'flow', 'eq', 'check', 'quote', 'bars', 'funnel', 'cards', 'curve', 'compare', 'chat'];
  const SCHOOL_TYPES = ['table', 'tip', 'phone', 'screen', 'walk', 'map', 'code', 'lab', 'photo', 'product', 'partner'];
  window.VSL = { render, animate, build, reveal, TYPES, ALL_TYPES: [...TYPES, ...SCHOOL_TYPES], SCHOOL_TYPES, pickVerticals, labCompute };
})();
