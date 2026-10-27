/* VooSquare member app: Free tools (#tools, #tools/<key>). Loaded on demand by app-home.js together with
 * /js/tools-math.js (window.VSTM, the pure maths) and /css/tools.css. All calculations run in the browser. */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP, M = window.VSTM;
  const { esc, icon } = VS;
  const S = A.S;
  const P = M.parseNum;

  /* ---------------- config, currency, stored inputs ---------------- */
  let cfg = null; // { tools, kill_scale, premium, premium_ok, max_saves }
  const CUR_KEY = 'vs_tools_cur';
  const cur = () => { const c = A.ls.get(CUR_KEY, 'USD'); return M.CURRENCIES[c] ? c : 'USD'; };
  const sym = (c) => M.CURRENCIES[c || cur()].sym.trim();
  const premiumOk = () => !!(cfg && cfg.premium_ok);
  const priceLabel = () => {
    const p = (cfg && cfg.premium) || {};
    const per = Number(p.period_days) === 30 ? 'month' : Number(p.period_days) === 365 ? 'year' : `${p.period_days || 30} days`;
    return `$${VS.fmt(p.price_usd || 20, (p.price_usd || 0) % 1 ? 2 : 0)}/${per}`;
  };
  const loadVals = (key, def) => ({ ...def, ...(A.ls.get('vs_tool_' + key, {}) || {}) });
  const saveVals = (key, v) => A.ls.set('vs_tool_' + key, v);

  /* ---------------- small builders ---------------- */
  /** Number input that accepts commas and spaces. Options: slider [min,max,step], step (adds − and + buttons), presets [values], dot (colour). */
  const dot = (c) => (c ? `<i class="tl-dot" style="--c:${c}"></i>` : '');
  const numF = (k, label, v, o = {}) => `<div class="tl-f${o.cls ? ' ' + o.cls : ''}${o.slider ? ' has-sl' : ''}"><label for="tf-${k}">${dot(o.dot)}${esc(label)}${o.opt ? ' <em>Optional</em>' : ''}</label><div class="tl-inp${o.step ? ' stp' : ''}">${o.step ? `<button type="button" class="tl-st" data-stp="${k}" data-d="-${o.step}" aria-label="Less ${esc(label)}">${icon('minus')}</button>` : ''}${o.pre ? `<span class="pre">${esc(o.pre)}</span>` : ''}<input id="tf-${k}" data-k="${k}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${esc(v[k] ?? '')}" placeholder="${esc(o.ph || '0')}">${o.suf ? `<span class="suf">${esc(o.suf)}</span>` : ''}${o.step ? `<button type="button" class="tl-st" data-stp="${k}" data-d="${o.step}" aria-label="More ${esc(label)}">${icon('plus')}</button>` : ''}</div>${o.slider ? `<input class="tl-rg" type="range" data-sl="${k}" min="${o.slider[0]}" max="${o.slider[1]}" step="${o.slider[2] || 1}" value="${esc(Number.isFinite(P(v[k])) ? P(v[k]) : o.slider[0])}" aria-label="${esc(label)}">` : ''}${o.presets ? `<div class="tl-pre">${o.presets.map((x) => `<button type="button" data-pv="${k}" data-val="${x}">${esc((o.pre || '') + VS.fmt(x))}</button>`).join('')}</div>` : ''}${o.hint ? `<small class="tl-hint">${esc(o.hint)}</small>` : ''}</div>`;
  const textF = (k, label, v, o = {}) => `<div class="tl-f${o.cls ? ' ' + o.cls : ''}"><label for="tf-${k}">${dot(o.dot)}${esc(label)}</label><div class="tl-inp"><input id="tf-${k}" data-k="${k}" type="text" ${o.im ? `inputmode="${o.im}"` : ''} autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(v[k] ?? '')}" placeholder="${esc(o.ph || '')}"></div></div>`;
  /** Payout presets make sense in dollars only (no exchange rates here). */
  const payPresets = (c) => (c === 'USD' ? [25, 50, 100, 200] : undefined);
  /** Pop newly added children in (coins, calendar days). */
  function popIn(nodes, from) {
    if (VS.reduce) return;
    nodes.forEach((n, i) => { if (i >= from) n.animate([{ opacity: 0, transform: 'translateY(-12px)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: (i - from) * 45, easing: 'cubic-bezier(.2,1.4,.4,1)', fill: 'backwards' }); });
  }
  /** A stack of coins in the stage SVGs. */
  function coinStack(g, n, cx, base, rx = 24, cls = '') {
    if (!g || g._n === n) return;
    const from = Math.min(g._n || 0, n);
    let h = '';
    for (let i = 0; i < n; i++) { const y = base - i * 8; h += `<g class="cn ${cls}"><path class="cn-s" d="M${cx - rx} ${y}v5a${rx} 6.5 0 0 0 ${rx * 2} 0v-5z"/><ellipse class="cn-t" cx="${cx}" cy="${y}" rx="${rx}" ry="6.5"/><ellipse class="cn-r" cx="${cx}" cy="${y}" rx="${rx * 0.56}" ry="3.2"/></g>`; }
    g.innerHTML = h; g._n = n;
    popIn([...g.children], from);
  }
  const segF = (k, opts, v, label) => `<div class="tl-f tl-segf">${label ? `<span class="lbl2">${esc(label)}</span>` : ''}<div class="seg" role="group"${label ? ` aria-label="${esc(label)}"` : ''}>${opts.map(([val, t]) => `<button type="button" data-seg="${k}" data-v="${val}" class="${v[k] === val ? 'on' : ''}" aria-pressed="${v[k] === val}">${esc(t)}</button>`).join('')}</div></div>`;
  const stat = (k, label, o = {}) => `<div class="tl-s${o.hl ? ' hl' : ''}${o.big ? ' big' : ''}" data-s="${k}"><small>${esc(label)}</small><b data-o="${k}">—</b>${o.sub ? `<span class="tl-sub" data-sub="${k}"></span>` : ''}</div>`;
  const clamp01 = (n) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

  /** Tween a number into an element. Non-numbers show "—" straight away. */
  function setNum(el, val, fmt) {
    if (!el) return;
    if (!Number.isFinite(val)) { cancelAnimationFrame(el._raf); el._v = undefined; el.textContent = '—'; return; }
    const from = Number.isFinite(el._v) ? el._v : 0;
    el._v = val; el._f = fmt;
    cancelAnimationFrame(el._raf);
    if (VS.reduce || from === val) { el.textContent = fmt(val); return; }
    const t0 = performance.now(), ms = from === 0 ? 700 : 380;
    const step = (t) => { const p = Math.min((t - t0) / ms, 1); const e = 1 - Math.pow(1 - p, 3); el.textContent = fmt(from + (val - from) * e); if (p < 1) el._raf = requestAnimationFrame(step); };
    el._raf = requestAnimationFrame(step);
  }
  const $o = (root, k) => root.querySelector(`[data-o="${k}"]`);
  const money = (c) => (n) => M.money(n, c);

  /* =====================================================================
   * TOOL DEFINITIONS
   * Each tool: defaults, form(v, c), out(c), calc(v) → result, paint(root, r, v, c), head(r, c) → [label, text],
   * share(v, r, c) → text, how (one line). Inputs carry data-k; read() collects them as strings.
   * ===================================================================== */
  const T = {};

  /* 1. Break-even CPA/CPL */
  T.breakeven = {
    defaults: { payout: '100', rate: '10', margin: '30', now: '' },
    how: 'Break-even is the cost where you make nothing. Max is the most you can pay and still keep your margin.',
    form: (v, c) => `<div class="tl-fs">${numF('payout', 'Payout per FTD or sale', v, { pre: sym(c), cls: 'full', presets: payPresets(c) })}${numF('rate', 'Lead to FTD rate', v, { suf: '%', slider: [0.5, 50, 0.5], hint: '10 means 1 in 10 leads deposits.' })}${numF('margin', 'Margin you want', v, { suf: '%', slider: [0, 90, 1] })}${numF('now', 'Your CPL now', v, { pre: sym(c), opt: true, cls: 'full', hint: 'Add it and the scale tips to profit or loss.' })}</div>`,
    out: () => `<div class="tl-scene sf-night be-st" aria-hidden="true"><svg viewBox="0 0 320 136"><path class="st-post" d="M160 46v74M130 122h60"/>
        <g class="be-beam"><path class="st-beam" d="M44 44h232"/>
          <g class="be-pan l"><path class="st-str" d="M44 44l-27 38M44 44l27 38"/><path class="st-dish" d="M12 82h64a32 11 0 0 1-64 0z"/><g data-coins></g><text class="st-lb" x="44" y="114" text-anchor="middle" data-o="beL"></text></g>
          <g class="be-pan r"><path class="st-str" d="M276 44l-27 38M276 44l27 38"/><path class="st-dish" d="M244 82h64a32 11 0 0 1-64 0z"/><rect class="st-rc" x="261" y="61" width="30" height="20" rx="3.5"/><path class="st-rl" d="M267 68h18M267 74h11"/><text class="st-lb" x="276" y="114" text-anchor="middle" data-o="beR"></text></g>
          <circle class="st-pv" cx="160" cy="44" r="6"/></g></svg><span class="tl-chip" data-o="beChip"></span></div>
      <div class="tl-stats two">${stat('tCpl', 'Max CPL', { hl: true, big: true })}${stat('beCpl', 'Break-even CPL', { big: true })}${stat('tCpa', 'Max CPA')}${stat('beCpa', 'Break-even CPA')}</div>
      <p class="tl-line" data-o="line"></p>`,
    calc: (v) => M.breakEven({ payout: P(v.payout), rate: P(v.rate), margin: P(v.margin) }),
    paint(root, r, v, c) {
      const m = money(c);
      setNum($o(root, 'tCpl'), r.tCpl, m); setNum($o(root, 'beCpl'), r.beCpl, m); setNum($o(root, 'tCpa'), r.tCpa, m); setNum($o(root, 'beCpa'), r.beCpa, m);
      // The scale: level at break-even; with a current CPL it tips toward profit (left) or loss (right).
      const now = P(v.now);
      const has = Number.isFinite(now) && now > 0 && r.beCpl > 0;
      const kept = has ? (1 - now / r.beCpl) * 100 : NaN;
      const ang = has ? Math.max(-13, Math.min(13, -kept * 0.32)) : 0;
      root.querySelector('.be-beam').style.transform = `rotate(${ang}deg)`;
      root.querySelectorAll('.be-pan').forEach((g) => { g.style.transform = `rotate(${-ang}deg)`; });
      coinStack(root.querySelector('[data-coins]'), Number.isFinite(r.beCpl) ? Math.max(1, Math.round(Math.min(r.margin, 60) / 10)) : 0, 44, 76, 15);
      $o(root, 'beL').textContent = 'Max ' + m(r.tCpl); $o(root, 'beR').textContent = 'Even ' + m(r.beCpl);
      const chip = $o(root, 'beChip');
      const st = !has ? ['', Number.isFinite(r.beCpl) ? 'Level at break-even' : 'Waiting for numbers'] : kept >= r.margin ? ['ok', `Profit. Keeps ${M.pct(kept, 0)}`] : kept > 0 ? ['warn', `Thin. Keeps ${M.pct(kept, 0)}`] : ['bad', `Loss. ${M.pct(-kept, 0)} over`];
      chip.className = 'tl-chip ' + st[0]; chip.textContent = st[1];
      $o(root, 'line').textContent = Number.isFinite(r.beCpl)
        ? `Pay up to ${m(r.tCpl)} per lead to keep ${Math.round(r.margin)}% margin. Above ${m(r.beCpl)} per lead you lose money. About ${M.num(r.leadsPerFtd, r.leadsPerFtd % 1 ? 1 : 0)} leads make one FTD.`
        : 'Enter your payout and lead to FTD rate to see your numbers.';
    },
    head: (r, c) => ['Max CPL', M.money(r.tCpl, c)],
    share: (v, r, c) => `Break-even check: payout ${M.money(P(v.payout), c)} per FTD, ${M.pct(P(v.rate))} lead to FTD, ${M.pct(P(v.margin), 0)} margin. Max CPL ${M.money(r.tCpl, c)} (break-even ${M.money(r.beCpl, c)}), max CPA ${M.money(r.tCpa, c)}.`,
  };

  /* 2. ROAS and profit */
  T.roas = {
    defaults: { mode: 'rev', spend: '500', revenue: '1500', conversions: '12', payout: '120' },
    how: 'ROAS above 1× means revenue beat spend. ROI is profit as a share of what you spent.',
    form: (v, c) => `${segF('mode', [['rev', 'I know revenue'], ['conv', 'Conversions × payout']], v)}<div class="tl-fs">${numF('spend', 'Ad spend', v, { pre: sym(c), cls: v.mode === 'conv' ? 'full' : '' })}${v.mode === 'conv'
      ? numF('conversions', 'Conversions', v, { ph: '0', step: 1 }) + numF('payout', 'Payout per conversion', v, { pre: sym(c), presets: payPresets(c) })
      : numF('revenue', 'Revenue', v, { pre: sym(c) }) + numF('conversions', 'Conversions', v, { opt: true, hint: 'Add it to see your CPA.' })}</div>`,
    out: () => `<div class="tl-scene sf-lime ro-st" aria-hidden="true"><svg viewBox="0 0 320 136"><path class="st-gr" d="M14 111h292"/><g data-stk="s"></g><g data-stk="r"></g>
        <text class="st-lb" x="62" y="129" text-anchor="middle" data-o="bs"></text><text class="st-lb" x="168" y="129" text-anchor="middle" data-o="br"></text></svg>
        <div class="ro-x"><b data-o="rx">—</b><small>ROAS</small></div></div>
      <div class="tl-stats two">${stat('profit', 'Profit', { hl: true, big: true })}${stat('roas', 'ROAS', { big: true })}${stat('roi', 'ROI')}${stat('margin', 'Margin')}${stat('cpa', 'CPA')}${stat('revenue', 'Revenue')}</div>`,
    calc: (v) => (v.mode === 'conv' ? M.roas({ spend: P(v.spend), conversions: P(v.conversions), payout: P(v.payout) }) : M.roas({ spend: P(v.spend), revenue: P(v.revenue), conversions: P(v.conversions) })),
    paint(root, r, v, c) {
      const m = money(c);
      setNum($o(root, 'profit'), r.profit, m); setNum($o(root, 'roas'), r.roas, M.times); setNum($o(root, 'roi'), r.roi, (n) => M.pct(n, 0));
      setNum($o(root, 'margin'), r.margin, (n) => M.pct(n, 0)); setNum($o(root, 'cpa'), r.cpa, m); setNum($o(root, 'revenue'), r.revenue, m);
      root.querySelector('[data-s="profit"]').classList.toggle('neg', r.profit < 0);
      // Two coin stacks to the same scale: spend against what came back.
      const max = Math.max(r.spend || 0, r.revenue || 0);
      const n = (x) => (max > 0 && x > 0 ? Math.max(1, Math.round(clamp01(x / max) * 10)) : 0);
      coinStack(root.querySelector('[data-stk="s"]'), n(r.spend), 62, 101, 28, 'sp');
      const rg = root.querySelector('[data-stk="r"]');
      coinStack(rg, n(r.revenue), 168, 101, 28, 'rv');
      rg.classList.toggle('neg', r.profit < 0);
      $o(root, 'bs').textContent = 'Spend ' + m(r.spend); $o(root, 'br').textContent = 'Revenue ' + m(r.revenue);
      setNum($o(root, 'rx'), r.roas, M.times);
      root.querySelector('.ro-x').classList.toggle('neg', r.profit < 0);
    },
    head: (r, c) => ['Profit', M.money(r.profit, c)],
    share: (v, r, c) => `ROAS check: spend ${M.money(r.spend, c)}, revenue ${M.money(r.revenue, c)}. Profit ${M.money(r.profit, c)}, ROAS ${M.times(r.roas)}, ROI ${M.pct(r.roi, 0)}${Number.isFinite(r.cpa) ? `, CPA ${M.money(r.cpa, c)}` : ''}.`,
  };

  /* 3. Kill or scale */
  T.killscale = {
    defaults: { spend: '110', conversions: '6', target: '25', days: '3', ctr: '' },
    how: 'The rules run in order: kill, scale, then hold. It is a guide. Check your tracking before you act.',
    form: (v, c) => `<div class="tl-fs">${numF('spend', 'Spend so far', v, { pre: sym(c) })}${numF('target', 'Target CPA', v, { pre: sym(c) })}${numF('conversions', 'Conversions', v, { step: 1 })}${numF('days', 'Days running', v, { step: 1 })}${numF('ctr', 'CTR', v, { suf: '%', opt: true, cls: 'full' })}</div>`,
    out: () => `<div class="tl-verdict"><svg class="ks-light" viewBox="0 0 40 104" aria-hidden="true"><rect x="2" y="2" width="36" height="100" rx="15"/>${['kill', 'hold', 'scale'].map((k, i) => `<circle class="lp lp-${k}" cx="20" cy="${22 + i * 30}" r="10"/>`).join('')}</svg><div class="ks-v"><span class="tl-pill" data-o="pill">—</span><p class="tl-reason" data-o="reason">Enter spend and your target CPA.</p><p class="tl-rule"><span class="mono-k">Rule</span><span data-o="rule">—</span></p><p class="tl-rule" data-o="ctr" hidden></p></div></div>
      <div class="tl-stats two">${stat('cpa', 'CPA')}${stat('ratio', 'CPA vs target')}${stat('spendX', 'Spend vs target CPA')}${stat('daily', 'Spend per day')}</div>
      <details class="tl-rules"><summary>The rules</summary><ul data-o="rules"></ul></details>
      <p class="tl-guide">${icon('flag')}A guide, not a promise. Ad results swing; follow your platform's rules and the law where you run.</p>`,
    calc: (v) => M.killScale({ spend: P(v.spend), conversions: P(v.conversions), target: P(v.target), days: P(v.days), ctr: P(v.ctr) }, cfg && cfg.kill_scale),
    paint(root, r, v, c) {
      const m = money(c);
      const pill = $o(root, 'pill');
      const verdict = r ? r.verdict : '';
      if (pill.dataset.v !== verdict) {
        pill.dataset.v = verdict;
        pill.className = 'tl-pill ' + (verdict ? 'v-' + verdict.replace('_big', '') : '');
        root.querySelector('.ks-light').dataset.on = verdict.replace('_big', '');
        root.querySelector('.tl-verdict').dataset.v = verdict.replace('_big', '');
        pill.textContent = r ? r.label : '—';
        if (!VS.reduce) { pill.classList.remove('flip'); void pill.offsetWidth; pill.classList.add('flip'); }
      }
      $o(root, 'reason').textContent = r ? r.reason : 'Enter spend and your target CPA.';
      $o(root, 'rule').textContent = r ? r.rule : '—';
      const ctrEl = $o(root, 'ctr');
      ctrEl.hidden = !(r && Number.isFinite(r.ctr));
      if (!ctrEl.hidden) ctrEl.innerHTML = `<span class="mono-k">CTR</span><span>${esc(M.pct(r.ctr, 2))} \u00B7 shown for context, not used in the verdict</span>`;
      setNum($o(root, 'cpa'), r ? r.cpa : NaN, m); setNum($o(root, 'ratio'), r ? r.ratio : NaN, M.times); setNum($o(root, 'spendX'), r ? r.spendX : NaN, M.times); setNum($o(root, 'daily'), r ? r.daily : NaN, m);
      const R = { ...M.DEFAULT_RULES, ...((cfg && cfg.kill_scale) || {}) };
      $o(root, 'rules').innerHTML = [
        `Kill: spend reaches ${R.kill_zero_mult}× target CPA with no conversions.`,
        `Kill: CPA above ${R.kill_cpa_mult}× target after spending ${R.kill_after_mult}× target CPA.`,
        `Scale +${R.big_pct_min}–${R.big_pct_max}%: CPA at or under ${R.big_cpa_mult}× target with ${R.big_min_conv}+ conversions.`,
        `Scale +${R.scale_pct}%: CPA at or under ${R.scale_cpa_mult}× target with ${R.scale_min_conv}+ conversions.`,
        `Hold: CPA within ±${R.hold_band}% of target, or too little data to call.`,
      ].map((x) => `<li>${esc(x)}</li>`).join('');
    },
    head: (r) => ['Verdict', r ? r.label : '—'],
    share: (v, r, c) => (r ? `Kill or scale check: spent ${M.money(P(v.spend), c)}, ${M.num(r.conversions)} conversions, target CPA ${M.money(P(v.target), c)}. CPA ${M.money(r.cpa, c)} (${M.times(r.ratio)} target). Verdict: ${r.label}. ${r.reason}` : ''),
  };

  /* 4. Budget planner */
  T.budget = {
    defaults: { mode: 'goal', goalType: 'conv', goal: '100', payout: '', cpa: '25', days: '30', daily: '100' },
    how: 'Daily budget = goal × target CPA ÷ days. Real CPA moves, so check it every few days.',
    form(v, c) {
      const goal = v.mode !== 'daily';
      return `${segF('mode', [['goal', 'Plan for a goal'], ['daily', 'I have a daily budget']], v)}
        ${goal ? segF('goalType', [['conv', 'FTDs or sales'], ['revenue', 'Revenue']], v, 'Goal is') : ''}
        <div class="tl-fs">${goal
          ? (v.goalType === 'revenue' ? numF('goal', 'Revenue goal', v, { pre: sym(c) }) + numF('payout', 'Payout per conversion', v, { pre: sym(c) }) : numF('goal', 'Conversions you want', v) + numF('payout', 'Payout per conversion', v, { pre: sym(c), opt: true }))
          : numF('daily', 'Daily budget', v, { pre: sym(c) }) + numF('payout', 'Payout per conversion', v, { pre: sym(c), opt: true })}
        ${numF('cpa', 'Target CPA', v, { pre: sym(c) })}${numF('days', 'Days', v, { step: 1 })}</div>`;
    },
    out: () => `<div class="tl-scene sf-paper bu-st" aria-hidden="true"><div class="bu-cal" data-o="cal"></div><div class="bu-sum"><b data-o="buDays">—</b><small data-o="buSub"></small><i class="bu-bar"><i data-o="buBar"></i></i></div></div>
      <div class="tl-stats two">${stat('main', 'Daily budget', { hl: true, big: true })}${stat('total', 'Total spend', { big: true })}${stat('conv', 'Conversions')}${stat('perDay', 'Per day')}${stat('revenue', 'Revenue')}${stat('profit', 'Profit')}</div>
      <div class="tl-tl" data-o="tl"></div>`,
    calc: (v) => M.budget({ mode: v.mode === 'daily' ? 'daily' : 'goal', goalType: v.goalType === 'revenue' ? 'revenue' : 'conversions', goal: P(v.goal), payout: P(v.payout), cpa: P(v.cpa), days: P(v.days), daily: P(v.daily) }),
    paint(root, r, v, c) {
      const m = money(c);
      const goal = v.mode !== 'daily';
      root.querySelector('[data-s="main"] small').textContent = goal ? 'Daily budget' : 'Conversions';
      root.querySelector('[data-s="conv"] small').textContent = goal ? 'Conversions' : 'Daily budget';
      setNum($o(root, 'main'), goal ? r.daily : r.conversions, goal ? m : (n) => M.num(n, n < 10 && n % 1 ? 1 : 0));
      setNum($o(root, 'conv'), goal ? r.conversions : r.daily, goal ? (n) => M.num(n, n < 10 && n % 1 ? 1 : 0) : m);
      setNum($o(root, 'total'), r.total, m); setNum($o(root, 'perDay'), r.perDay, (n) => M.num(n, n < 10 ? 1 : 0));
      setNum($o(root, 'revenue'), r.revenue, m); setNum($o(root, 'profit'), r.profit, m);
      // Calendar: one square per day (per week past five weeks), filled as far as the plan runs.
      const days = Math.round(P(v.days));
      const weeks = days > 35;
      const cells = Number.isFinite(days) && days > 0 ? Math.min(weeks ? Math.ceil(days / 7) : days, 52) : 0;
      const cal = $o(root, 'cal');
      if (cal._n !== cells) {
        const from = Math.min(cal._n || 0, cells);
        cal.innerHTML = Array.from({ length: Math.max(cells, weeks ? 0 : 7) }, (_, i) => `<i class="${i < cells ? 'on' : ''}"></i>`).join('');
        cal._n = cells; cal.classList.toggle('wk', weeks);
        popIn([...cal.children].slice(0, cells), from);
      }
      $o(root, 'buDays').textContent = cells ? (weeks ? `${M.num(days)} days` : `${days} day${days === 1 ? '' : 's'}`) : '—';
      $o(root, 'buSub').textContent = Number.isFinite(r.daily) ? `${m(r.daily)} a day, ${m(r.total)} in total${weeks ? '. Each square is a week.' : ''}` : 'Add a CPA and days to plan.';
      $o(root, 'buBar').style.transform = `scaleX(${Number.isFinite(r.profit) && r.total > 0 ? clamp01(r.revenue / Math.max(r.total, r.revenue)) : Number.isFinite(r.total) ? 1 : 0})`;
      const tl = $o(root, 'tl');
      if (!r.timeline.length) { tl.innerHTML = '<p class="tl-line">Fill in the fields to see the plan day by day.</p>'; return; }
      const last = r.timeline[r.timeline.length - 1].day;
      tl.innerHTML = `<div class="tl-track"><i class="tl-fill"></i>${r.timeline.map((p) => `<span class="tl-dot" style="left:${last > 1 ? ((p.day - 1) / (last - 1)) * 100 : 100}%"></span>`).join('')}</div>
        <div class="tl-marks">${r.timeline.map((p) => `<div><small>Day ${p.day}</small><b>${esc(M.money(p.spend, c))}</b><span>${esc(M.num(p.conversions, p.conversions < 10 && p.conversions % 1 ? 1 : 0))} conv.</span></div>`).join('')}</div>`;
      requestAnimationFrame(() => { const f = tl.querySelector('.tl-fill'); if (f) f.style.transform = 'scaleX(1)'; });
    },
    head: (r, c, v) => (v.mode === 'daily' ? ['Conversions', M.num(r.conversions, 0)] : ['Daily budget', M.money(r.daily, c)]),
    share: (v, r, c) => `Budget plan: ${M.num(r.conversions, 0)} conversions at ${M.money(P(v.cpa), c)} CPA over ${M.num(P(v.days))} days. Daily budget ${M.money(r.daily, c)}, total ${M.money(r.total, c)}.`,
  };

  /* 5. Funnel calculator */
  const FUNNEL_DEF = [['Clicks', '2000'], ['Joins', '600'], ['Registrations', '120'], ['FTDs', '24']];
  T.funnel = {
    defaults: { mode: 'count', stages: FUNNEL_DEF.map(([n, x]) => ({ name: n, value: x })), payout: '100', lift: '10', liftStep: '' },
    how: 'Each step is the share of people from the step before. The biggest drop is usually the cheapest place to win FTDs back.',
    form(v, c) {
      const st = v.stages;
      return `${segF('mode', [['count', 'Counts'], ['rate', 'Rates']], v)}
        <div class="tl-stages">${st.map((s, i) => `<div class="tl-stage"><span class="tl-n">${i + 1}</span><input class="tl-sn" data-st="${i}" data-f="name" value="${esc(s.name)}" aria-label="Step ${i + 1} name" maxlength="24" autocomplete="off"><div class="tl-inp sm"><input data-st="${i}" data-f="value" type="text" inputmode="decimal" autocomplete="off" value="${esc(s.value)}" aria-label="Step ${i + 1} ${v.mode === 'rate' && i ? 'rate' : 'count'}" placeholder="0">${v.mode === 'rate' && i ? '<span class="suf">%</span>' : ''}</div>${st.length > 3 ? `<button type="button" class="tl-x" data-rm-stage="${i}" aria-label="Remove step ${i + 1}">${icon('x')}</button>` : '<span class="tl-x-sp"></span>'}</div>`).join('')}
        ${st.length < 5 ? `<button type="button" class="btn btn-w btn-xs tl-add" data-add-stage>${icon('plus')}Add a step</button>` : ''}</div>
        <div class="tl-fs">${numF('payout', 'Payout per FTD', v, { pre: sym(c) })}${numF('lift', 'Lift one step by', v, { suf: '%', slider: [1, 100, 1] })}</div>`;
    },
    out: () => `<div class="tl-fun" data-o="fun"></div><div class="tl-stats two">${stat('final', 'Final conversions', { big: true })}${stat('overall', 'End-to-end rate', { big: true })}</div>
      <div class="tl-lift"><label for="tf-liftStep" class="lbl2">Lift step</label><select id="tf-liftStep" class="inp" data-k="liftStep"></select><p data-o="lift"></p></div>`,
    calc: (v) => M.funnel({ stages: v.stages.map((s) => ({ name: s.name, value: P(s.value) })), mode: v.mode === 'rate' ? 'rate' : 'count', payout: P(v.payout), lift: P(v.lift), liftStep: v.liftStep === '' ? undefined : Number(v.liftStep) }),
    paint(root, r, v, c) {
      const fun = $o(root, 'fun');
      const top = r.stages[0] && r.stages[0].count > 0 ? r.stages[0].count : 0;
      const sig = r.stages.length + ':' + r.biggestDrop;
      if (fun.dataset.sig !== sig) {
        fun.dataset.sig = sig;
        fun.innerHTML = r.stages.map((s, i) => `<div class="tl-fr${i === r.biggestDrop ? ' drop' : ''}" data-fr="${i}"><i class="tl-fc"></i><div class="tl-fl"><b data-fn="${i}"></b><span data-fc="${i}"></span></div><div class="tl-fb"><i data-fw="${i}"></i></div><span class="tl-fp" data-fp="${i}"></span>${i === r.biggestDrop ? '<span class="tl-tag">Biggest drop</span>' : ''}</div>`).join('');
      }
      r.stages.forEach((s, i) => {
        fun.querySelector(`[data-fn="${i}"]`).textContent = s.name;
        fun.querySelector(`[data-fc="${i}"]`).textContent = M.num(s.count, s.count < 10 && s.count % 1 ? 1 : 0);
        // Each row is one slice of the funnel: the band narrows from the step before to this one.
        const wOf = (x) => { const w = top ? Math.max(3, (x / top) * 100) : 3; return Number.isFinite(w) ? Math.min(w, 100) : 3; };
        const row = fun.querySelector(`[data-fr="${i}"]`);
        row.style.setProperty('--w', wOf(s.count) + '%'); row.style.setProperty('--pw', wOf(i ? r.stages[i - 1].count : s.count) + '%');
        fun.querySelector(`[data-fp="${i}"]`).textContent = i ? M.pct(s.step) : '';
      });
      setNum($o(root, 'final'), r.final, (n) => M.num(n, n < 10 && n % 1 ? 1 : 0));
      setNum($o(root, 'overall'), r.overall, (n) => M.pct(n, 2));
      const sel = root.querySelector('[data-k="liftStep"]');
      const opts = r.stages.slice(1).map((s, j) => `<option value="${j + 1}">${esc(r.stages[j].name)} → ${esc(s.name)}${j + 1 === r.biggestDrop ? ' (biggest drop)' : ''}</option>`).join('');
      if (sel.dataset.opts !== opts) { sel.innerHTML = opts; sel.dataset.opts = opts; }
      sel.value = String(r.liftStep > 0 ? r.liftStep : 1);
      const at = r.stages[r.liftStep];
      $o(root, 'lift').innerHTML = at && Number.isFinite(r.extra)
        ? `Lift <b>${esc(r.stages[r.liftStep - 1].name)} → ${esc(at.name)}</b> by ${esc(M.pct(P(v.lift), 0))} and you get <b>${esc(M.num(r.extra, r.extra < 10 ? 1 : 0))} more ${esc(r.stages[r.stages.length - 1].name)}</b>${Number.isFinite(r.extraValue) ? ` = <b class="g">${esc(M.money(r.extraValue, c))}</b>` : ''}.`
        : 'Fill in every step to see where to improve.';
    },
    head: (r) => ['Final', M.num(r.final, r.final < 10 && r.final % 1 ? 1 : 0)],
    share: (v, r, c) => `Funnel: ${r.stages.map((s) => `${s.name} ${M.num(s.count, 0)}`).join(' → ')}. End-to-end ${M.pct(r.overall, 2)}. Biggest drop: ${r.biggestDrop > 0 ? `${r.stages[r.biggestDrop - 1].name} → ${r.stages[r.biggestDrop].name} (${M.pct(r.stages[r.biggestDrop].step)})` : '—'}.${Number.isFinite(r.extraValue) ? ` A ${M.pct(P(v.lift), 0)} lift there is worth about ${M.money(r.extraValue, c)}.` : ''}`,
  };

  /* 6. UTM / link builder */
  const UTM_FIELDS = [['utm_source', 'Source', 'facebook'], ['utm_medium', 'Medium', 'paid_social'], ['utm_campaign', 'Campaign', 'spring_ng'], ['utm_content', 'Content (ad)', 'hook_a'], ['utm_term', 'Term', 'lookalike_1']];
  T.utm = {
    wide: true, nocur: true,
    defaults: { base: 'https://', utm_source: '', utm_medium: '', utm_campaign: '', utm_content: '', utm_term: '', custom: [] },
    how: 'Ad platforms swap the {{macros}} for real names at click time. Open the final link once before you launch.',
    form: (v) => `<div class="tl-presets"><span class="lbl2">Presets</span><div class="chips">${Object.entries(M.UTM_PRESETS).map(([k, p]) => `<button type="button" data-preset="${k}">${esc(p.label)}</button>`).join('')}<button type="button" data-preset="">Clear</button></div></div>
      ${textF('base', 'Landing page link', v, { ph: 'https://example.com/offer', im: 'url', cls: 'full' })}
      <div class="tl-fs">${UTM_FIELDS.map(([k, l, ph], i) => textF(k, l, v, { ph, dot: DOTS[i] })).join('')}</div>
      ${customRows(v.custom, 'Custom parameters')}`,
    out: () => `<div class="tl-url"><span class="mono-k">Your link</span><code data-o="url"></code><p class="err" data-o="err" hidden></p><div class="tl-url-a"><button type="button" class="btn btn-k btn-sm" data-copy-url>${icon('copy')}Copy link</button><span class="tl-meta" data-o="meta"></span></div></div>`,
    calc: (v) => M.buildUtm({ base: v.base, params: [...UTM_FIELDS.map(([k]) => [k, v[k]]), ...v.custom.map((x) => [x.k, x.v])] }),
    paint: (root, r, v) => paintUrl(root, r, v.base, undefined, (k) => { const i = UTM_FIELDS.findIndex(([x]) => x === k); return i < 0 ? 5 : i; }),
    head: (r) => ['Link', r.url ? `${r.count} parameter${r.count === 1 ? '' : 's'}` : '—'],
    share: (v, r) => (r.url ? `UTM template I use:\n${r.url}` : ''),
  };
  function customRows(list, label) {
    return `<div class="tl-custom"><span class="lbl2">${dot(DOTS[5])}${esc(label)} <em>Up to 5</em></span>${list.map((x, i) => `<div class="tl-kv"><input data-cu="${i}" data-f="k" value="${esc(x.k)}" placeholder="name" aria-label="Parameter name ${i + 1}" autocomplete="off" autocapitalize="off" spellcheck="false"><span>=</span><input data-cu="${i}" data-f="v" value="${esc(x.v)}" placeholder="value or macro" aria-label="Parameter value ${i + 1}" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="tl-x" data-rm-cu="${i}" aria-label="Remove parameter ${i + 1}">${icon('x')}</button></div>`).join('')}${list.length < 5 ? `<button type="button" class="btn btn-w btn-xs tl-add" data-add-cu>${icon('plus')}Add a parameter</button>` : ''}</div>`;
  }
  /* Each parameter keeps one colour in the form and in the built link. Light versions read on the dark link box. */
  const DOTS = ['#5B3FE8', '#3D6BF2', '#00A86B', '#E8A317', '#0E9384', '#EE5A2F'];
  /** Show a built URL with every parameter colour-coded, or the validation error. colorOf(name) → 0..5. */
  function paintUrl(root, r, base, ph = 'https://your-landing-page.com/?utm_source=…', colorOf = () => 5) {
    const code = $o(root, 'url'), err = $o(root, 'err'), meta = $o(root, 'meta');
    const btn = root.querySelector('[data-copy-url]');
    const blank = !String(base || '').trim() || /^https?:\/\/$/.test(String(base).trim());
    if (r.error) {
      code.innerHTML = `<span class="ph">${esc(ph)}</span>`;
      err.hidden = blank; err.textContent = r.error; btn.disabled = true; meta.textContent = ''; return;
    }
    err.hidden = true; btn.disabled = false;
    const q = r.url.indexOf('?');
    const h = r.url.indexOf('#', q < 0 ? 0 : q);
    const pre = q < 0 ? r.url : r.url.slice(0, q);
    const qs = q < 0 ? '' : r.url.slice(q, h < 0 ? undefined : h);
    const hash = h < 0 ? '' : r.url.slice(h);
    const part = (kv) => {
      const at = kv.indexOf('=');
      const k = at < 0 ? kv : kv.slice(0, at), val = at < 0 ? '' : kv.slice(at + 1);
      let name = k; try { name = decodeURIComponent(k); } catch { /* keep raw */ }
      return `<span class="uq c${colorOf(name)}" data-pk="${esc(name)}"><b>${esc(k)}</b>=${esc(val).replace(/(\{[^}]*\}+)/g, '<em>$1</em>')}</span>`;
    };
    code.innerHTML = `<span class="u0">${esc(pre)}</span>${qs ? '<span class="us">?</span>' + qs.slice(1).split('&').map(part).join('<span class="us">&amp;</span>') : ''}${esc(hash)}`;
    hotParam(root, root.dataset.hot);
    code.dataset.url = r.url;
    meta.textContent = r.insecure ? 'Plain http: use https if your tracker supports it.' : `${r.count} parameter${r.count === 1 ? '' : 's'} · ${r.url.length} characters`;
  }

  function hotParam(root, name) {
    root.dataset.hot = name || '';
    root.querySelectorAll('.uq').forEach((x) => x.classList.toggle('hot', !!name && x.dataset.pk === name));
  }

  /* 7. Postback URL builder */
  const PB_COL = [2, 3, 1, 0, 4];
  const PB_ROWS = [['click', 'Click ID', 'click_id'], ['payout', 'Payout', 'payout'], ['status', 'Status or event', 'status'], ['txid', 'Transaction ID', 'txid'], ['currency', 'Currency', 'currency']];
  T.postback = {
    wide: true, nocur: true,
    defaults: { base: 'https://', ...Object.fromEntries(PB_ROWS.flatMap(([k, , n]) => [[k + '_k', n], [k + '_v', '']])), custom: [] },
    how: 'Your network calls this URL when someone registers or deposits. It only works if the click ID went out on your offer link first.',
    form: (v) => `${textF('base', 'Receiver URL from your tracker', v, { ph: 'https://your-tracker.com/postback', im: 'url', cls: 'full' })}
      <div class="tl-pb"><div class="tl-pbh"><span>Field</span><span>Parameter name</span><span>Network macro or value</span></div>${PB_ROWS.map(([k, l], i) => `<div class="tl-pbr"><b>${dot(DOTS[PB_COL[i]])}${esc(l)}</b><input data-k="${k}_k" value="${esc(v[k + '_k'])}" aria-label="${esc(l)} parameter name" autocomplete="off" autocapitalize="off" spellcheck="false"><input data-k="${k}_v" value="${esc(v[k + '_v'])}" placeholder="From your network's docs" aria-label="${esc(l)} macro" autocomplete="off" autocapitalize="off" spellcheck="false"></div>`).join('')}</div>
      ${customRows(v.custom, 'Extra fields')}
      <ol class="tl-howto"><li>Send your click ID to the network on the offer link (for example as a sub ID).</li><li>Type the macros your network lists in its postback docs into the right column.</li><li>Paste the final URL into the network's postback field, then fire a test conversion.</li></ol>`,
    out: () => `<div class="tl-scene sf-coal pb-st" aria-hidden="true">${window.VTA ? VTA.art('postback') : ''}<span class="pb-l">Your network</span><span class="pb-r">Your tracker</span><b class="pb-s" data-o="pbS"></b></div><div class="tl-url"><span class="mono-k">Postback URL</span><code data-o="url"></code><p class="err" data-o="err" hidden></p><div class="tl-url-a"><button type="button" class="btn btn-k btn-sm" data-copy-url>${icon('copy')}Copy URL</button><span class="tl-meta" data-o="meta"></span></div></div>`,
    calc: (v) => M.buildPostback({ base: v.base, params: [...PB_ROWS.map(([k]) => [v[k + '_k'], v[k + '_v']]), ...v.custom.map((x) => [x.k, x.v])] }),
    paint: (root, r, v) => {
      const names = PB_ROWS.map(([k]) => String(v[k + '_k'] || '').trim());
      paintUrl(root, r, v.base, 'https://your-tracker.com/postback?click_id=…', (k) => { const i = names.indexOf(k); return i < 0 ? 5 : PB_COL[i]; });
      const pbs = root.querySelector('.pb-st');
      if (window.VTA && pbs.classList.contains('idle') !== !!r.error) VTA.hold(pbs, !!r.error); else pbs.classList.toggle('idle', !!r.error);
      $o(root, 'pbS').textContent = r.error ? 'Add your tracker URL' : 'Ready to paste';
    },
    head: (r) => ['Postback', r.url ? `${r.count} field${r.count === 1 ? '' : 's'}` : '—'],
    share: (v, r) => (r.url ? `Postback template (macros from my network's docs):\n${r.url}` : ''),
  };

  /* 8. Ad sizes cheat sheet (static) */
  const SIZES = [
    ['Meta', [['Feed square', '1:1', 1080, 1080], ['Feed vertical', '4:5', 1080, 1350], ['Stories and Reels', '9:16', 1080, 1920, true]]],
    ['TikTok and Snapchat', [['TikTok in-feed video', '9:16', 1080, 1920], ['Snapchat full-screen ad', '9:16', 1080, 1920]]],
    ['Google Display', [['Medium rectangle', '', 300, 250], ['Large rectangle', '', 336, 280], ['Leaderboard', '', 728, 90], ['Half page', '', 300, 600], ['Mobile banner', '', 320, 50], ['Wide skyscraper', '', 160, 600]]],
  ];
  T.sizes = {
    static: true,
    how: 'Sizes in pixels. The shaded bands on Reels are where the app draws its buttons and captions.',
    page: () => `<section class="sz-hero" aria-label="Preview a size"><div class="sz-stage"><button type="button" class="sz-frame" data-cycle aria-label="Show the next Meta size"><span class="sz-art"><span class="sz-ad"><i></i><b></b><b></b></span><i class="st"></i><i class="sb"></i></span></button></div>
        <div class="sz-info"><small data-o="szG"></small><h3 data-o="szN"></h3><p class="sz-dim"><b data-o="szD"></b><span data-o="szR"></span></p><p class="sz-safe" data-o="szS"></p>
          <div class="seg" role="group" aria-label="Meta ratios">${SIZES[0][1].map(([, r], i) => `<button type="button" data-meta="${i}">${esc(r)}</button>`).join('')}</div><small class="sz-tip">Tap the frame to switch. Tap any size below to see its real shape.</small></div></section>
      <div class="tl-sizes">${SIZES.map(([g, list], gi) => `<section class="card tl-sg${list.length > 3 ? ' wide' : ''}"><h3>${esc(g)}</h3><div class="tl-sl">${list.map(([n, r, w, h, safe], i) => {
      const sc = Math.min(64 / w, 72 / h);
      return `<button type="button" class="tl-sz" data-sz="${gi}:${i}"><div class="tl-sz-box"><span class="tl-sz-art${safe ? ' safe' : ''}" style="width:${Math.max(8, Math.round(w * sc))}px;height:${Math.max(6, Math.round(h * sc))}px">${safe ? '<i class="st"></i><i class="sb"></i>' : ''}</span></div><div class="tl-sz-t"><b>${esc(n)}</b><span class="mono">${w}×${h}</span>${r ? `<span class="pill pill-w">${esc(r)}</span>` : ''}</div></button>`;
    }).join('')}</div></section>`).join('')}</div><p class="tl-fine">Check each platform's current specs before you export. They change.</p>`,
    bind(view) {
      let cur = [0, 0];
      const show = (gi, i) => {
        cur = [gi, i];
        const [g, list] = SIZES[gi]; const [n, r, w, h, safe] = list[i];
        const box = view.querySelector('.sz-stage'), art = view.querySelector('.sz-art');
        const bw = Math.max(80, box.clientWidth - 24), bh = Math.max(80, box.clientHeight - 24);
        const sc = Math.min(bw / w, bh / h);
        art.style.width = Math.max(18, Math.round(w * sc)) + 'px'; art.style.height = Math.max(14, Math.round(h * sc)) + 'px';
        art.classList.toggle('safe', !!safe); art.classList.toggle('thin', h * sc < 60 || w * sc < 60);
        $o(view, 'szG').textContent = g; $o(view, 'szN').textContent = n; $o(view, 'szD').textContent = `${w}×${h}`; $o(view, 'szR').textContent = r || '';
        $o(view, 'szS').textContent = safe ? 'Keep about the top 14% and bottom 35% clear of text and logos.' : '';
        view.querySelectorAll('[data-meta]').forEach((b) => { const on = gi === 0 && Number(b.dataset.meta) === i; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
        view.querySelectorAll('[data-sz]').forEach((b) => b.classList.toggle('on', b.dataset.sz === `${gi}:${i}`));
      };
      view.addEventListener('click', (e) => {
        if (e.target.closest('[data-cycle]')) { show(0, cur[0] === 0 ? (cur[1] + 1) % SIZES[0][1].length : 0); return; }
        const m = e.target.closest('[data-meta]'); if (m) { show(0, Number(m.dataset.meta)); return; }
        const z = e.target.closest('[data-sz]');
        if (z) { const [gi, i] = z.dataset.sz.split(':').map(Number); show(gi, i); if (innerWidth < 900) view.querySelector('.sz-hero').scrollIntoView({ behavior: VS.reduce ? 'auto' : 'smooth', block: 'center' }); }
      });
      show(0, 0);
    },
  };

  /* Premium teasers (used when a tool is Premium and the member is not). */
  const TEASE = {
    killscale: 'Enter spend, conversions and your target CPA. Get a kill, hold or scale call and the rule behind it.',
    budget: 'Work out the daily budget for a goal, or what a budget should bring in, with a day-by-day plan.',
    postback: 'Build a clean postback URL from your tracker and your network’s macros, ready to paste.',
  };

  /* =====================================================================
   * PAGES
   * ===================================================================== */
  const pchip = (cls = '') => `<span class="tl-pc ${cls}">${icon('premium')}Premium</span>`;
  const curSelect = () => `<label class="tl-cur"><span class="sr">Currency</span>${icon('wallet')}<select data-cur aria-label="Currency">${Object.keys(M.CURRENCIES).map((c) => `<option value="${c}"${c === cur() ? ' selected' : ''}>${c}</option>`).join('')}</select></label>`;
  const meta2 = (key) => (window.VTA && VTA.META[key]) || { a: '#00A86B', u: '#00A86B', surf: 'paper' };
  const art = (key, cls) => (window.VTA ? VTA.art(key, cls) : '');

  /* Bento: every tool on one screen. Size follows the tool, so the two everyday ones lead. */
  const SIZE = { breakeven: 'xl', roas: 'tall' };
  function grid(view) {
    const list = cfg.tools;
    A.setTitle('Tools');
    const nPrem = list.filter((t) => t.access === 'premium').length;
    view.innerHTML = `<div class="tl-head"><div class="tl-hl"><h2>Run the numbers</h2><p><span class="tl-hw">${list.length - nPrem} free with your Voo ID${nPrem ? `, ${nPrem} with Premium` : ''}. Everything runs in your browser.</span><span class="tl-hn">${list.length - nPrem} free${nPrem ? `, ${nPrem} with Premium` : ''}</span></p></div>${curSelect()}</div>
      ${list.length ? `<div class="tl-bento">${list.map((t, i) => {
        const locked = t.access === 'premium' && !premiumOk(); const m = meta2(t.key);
        return `<a class="tb tb-${SIZE[t.key] || 'n'} sf-${m.surf}${locked ? ' locked' : ''}" href="#tools/${esc(t.key)}" style="--a:${m.a};--u:${m.u};--t:${m.t || m.a};--d:${i}" data-ta-host>
          <span class="tb-art">${art(t.key)}</span>
          <span class="tb-t"><b>${esc(t.name)}</b><small>${esc(t.line)}</small></span>
          ${t.access === 'premium' ? pchip(locked ? 'lk' : '') : ''}<span class="tb-go">${icon('arrow')}</span></a>`;
      }).join('')}</div>`
        : `<div class="card">${A.empty('calc', 'No tools right now', 'The team has switched the tools off for a moment.')}</div>`}
      <p class="tl-fine">Results are estimates from the numbers you type. They are not a promise of results.</p>`;
    bindCur(view, () => grid(view));
    if (window.VTA) VTA.watch(view);
  }
  function bindCur(view, onChange) {
    const s = view.querySelector('[data-cur]');
    if (s) s.addEventListener('change', () => { A.ls.set(CUR_KEY, s.value); onChange(); });
  }

  /** Stored or saved values can be old or hand-edited: keep only strings, 3–5 funnel steps and up to 5 custom rows. */
  function norm(def, data) {
    const str = (x) => (x == null || typeof x === 'object' ? '' : String(x));
    const v = { ...def.defaults };
    if (data && typeof data === 'object' && !Array.isArray(data)) for (const k of Object.keys(def.defaults)) if (k in data && !Array.isArray(def.defaults[k])) v[k] = str(data[k]);
    if (Array.isArray(def.defaults.stages)) {
      const st = data && Array.isArray(data.stages) ? data.stages.filter((s) => s && typeof s === 'object').slice(0, 5).map((s) => ({ name: str(s.name).slice(0, 24), value: str(s.value) })) : [];
      v.stages = st.length >= 3 ? st : def.defaults.stages.map((s) => ({ ...s }));
    }
    if (Array.isArray(def.defaults.custom)) v.custom = data && Array.isArray(data.custom) ? data.custom.filter((x) => x && typeof x === 'object').slice(0, 5).map((x) => ({ k: str(x.k), v: str(x.v) })) : [];
    return v;
  }

  function toolPage(view, key) {
    const meta = cfg.tools.find((t) => t.key === key);
    const def = T[key];
    if (!meta || !def) { location.hash = '#tools'; return null; }
    A.setTitle(meta.name);
    const locked = meta.access === 'premium' && !premiumOk();
    const c = cur();
    const canSave = !def.static;
    const m2 = meta2(key);
    view.innerHTML = `<div class="tl-top" style="--a:${m2.a};--u:${m2.u};--t:${m2.t || m2.a}"><a class="tl-back" href="#tools" aria-label="All tools">${icon('left')}</a><span class="tl-mart sf-${m2.surf}" data-ta-host>${art(key)}</span><div class="tl-tt"><h2>${esc(meta.name)}${meta.access === 'premium' ? pchip() : ''}</h2><p>${esc(meta.line)}</p></div>
        <div class="tl-acts">${def.static || def.nocur || locked ? '' : curSelect()}${!locked && canSave ? `${premiumOk() ? `<button type="button" class="btn btn-w btn-sm" data-saved>${icon('layers')}Saved<span class="tl-cnt" data-o="nsaved"></span></button>` : ''}<button type="button" class="btn btn-w btn-sm" data-save>${icon('star')}Save${premiumOk() ? '' : `<span class="tl-mini">${icon('premium')}</span>`}</button><button type="button" class="btn btn-k btn-sm" data-share>${icon('send')}Share</button>` : ''}</div></div>
      ${def.static || locked ? '' : `<button type="button" class="tl-sticky" aria-expanded="false" aria-label="Show more results"><span class="tl-sk-h"><small data-h="l"></small><b data-h="v"></b>${icon('down')}</span><span class="tl-sk-x" data-h="x"></span></button>`}
      ${locked ? lockedPanel(key, meta) : def.static ? def.page() : `<div class="tl-body${def.wide ? ' wide' : ''}" style="--a:${m2.a};--u:${m2.u};--t:${m2.t || m2.a}"><form class="card tl-in" novalidate autocomplete="off"></form><div class="card tl-out"><div class="tl-out-in">${def.out(c)}</div><p class="tl-how"><span class="mono-k">How to read this</span>${esc(def.how)}</p></div></div>`}
      ${def.static ? `<p class="tl-how solo"><span class="mono-k">How to read this</span>${esc(def.how)}</p>` : ''}`;
    if (window.VTA) VTA.watch(view);
    if (locked) return null;
    if (def.static) { if (def.bind) def.bind(view); return null; }

    const form = view.querySelector('.tl-in'), out = view.querySelector('.tl-out');
    let v = norm(def, loadVals(key, def.defaults));
    let res = null;
    const sticky = view.querySelector('.tl-sticky');

    const paintForm = () => { form.innerHTML = def.form(v, cur()); };
    const read = () => {
      form.querySelectorAll('[data-k]').forEach((el) => { v[el.dataset.k] = el.value; });
      out.querySelectorAll('[data-k]').forEach((el) => { v[el.dataset.k] = el.value; });
      if (v.stages) form.querySelectorAll('[data-st]').forEach((el) => { const s = v.stages[Number(el.dataset.st)]; if (s) s[el.dataset.f] = el.value; });
      if (v.custom) form.querySelectorAll('[data-cu]').forEach((el) => { const s = v.custom[Number(el.dataset.cu)]; if (s) s[el.dataset.f] = el.value; });
    };
    const update = () => {
      res = def.calc(v);
      def.paint(out, res, v, cur());
      const [hl, hv] = def.head(res, cur(), v);
      if (sticky) {
        sticky.querySelector('[data-h="l"]').textContent = hl; sticky.querySelector('[data-h="v"]').textContent = hv;
        // The expanded bar repeats the other headline numbers.
        sticky.querySelector('[data-h="x"]').innerHTML = [...out.querySelectorAll('.tl-s')].filter((x) => x.querySelector('small').textContent !== hl).slice(0, 4)
          .map((x) => { const b = x.querySelector('b'); return `<span><small>${esc(x.querySelector('small').textContent)}</small><b>${esc(b._f && Number.isFinite(b._v) ? b._f(b._v) : b.textContent)}</b></span>`; }).join('');
      }
      form.querySelectorAll('[data-sl]').forEach((rg) => {
        const x = P(v[rg.dataset.sl]);
        if (Number.isFinite(x) && document.activeElement !== rg) rg.value = x;
        rg.style.setProperty('--p', ((Math.min(Math.max(Number(rg.value), +rg.min), +rg.max) - rg.min) / (rg.max - rg.min)) * 100 + '%');
      });
      form.querySelectorAll('[data-pv]').forEach((b) => b.classList.toggle('on', P(v[b.dataset.pv]) === Number(b.dataset.val)));
      saveVals(key, v);
    };
    paintForm(); update();
    if (window.VTA) VTA.watch(out);
    if (sticky) sticky.addEventListener('click', () => { const o = sticky.classList.toggle('open'); sticky.setAttribute('aria-expanded', o); });

    form.addEventListener('input', (e) => {
      const sl = e.target.closest('[data-sl]');
      if (sl) { const t = form.querySelector(`[data-k="${sl.dataset.sl}"]`); if (t) t.value = sl.value; }
      read(); update();
    });
    // Link builders: the field in focus lights up its part of the link.
    form.addEventListener('focusin', (e) => {
      const t = e.target;
      let name = '';
      if (t.dataset.k && /^utm_/.test(t.dataset.k)) name = t.dataset.k;
      else if (t.dataset.k && /_(k|v)$/.test(t.dataset.k)) name = String(v[t.dataset.k.replace(/_(k|v)$/, '_k')] || '').trim();
      else if (t.dataset.cu !== undefined && v.custom && v.custom[Number(t.dataset.cu)]) name = String(v.custom[Number(t.dataset.cu)].k || '').trim();
      hotParam(out, name);
    });
    form.addEventListener('focusout', () => hotParam(out, ''));
    out.addEventListener('change', (e) => { if (e.target.matches('[data-k]')) { read(); update(); } });
    form.addEventListener('submit', (e) => e.preventDefault());
    form.addEventListener('click', (e) => {
      const stp = e.target.closest('[data-stp]');
      if (stp) {
        read();
        const k = stp.dataset.stp, n = Math.max(0, Math.round(((P(v[k]) || 0) + Number(stp.dataset.d)) * 100) / 100);
        v[k] = String(n); const t = form.querySelector(`[data-k="${k}"]`); if (t) t.value = v[k];
        update(); return;
      }
      const pv = e.target.closest('[data-pv]');
      if (pv) { read(); v[pv.dataset.pv] = pv.dataset.val; const t = form.querySelector(`[data-k="${pv.dataset.pv}"]`); if (t) t.value = pv.dataset.val; update(); return; }
      const sg = e.target.closest('[data-seg]');
      if (sg) { read(); v[sg.dataset.seg] = sg.dataset.v; paintForm(); update(); return; }
      const pr = e.target.closest('[data-preset]');
      if (pr) {
        read();
        const p = M.UTM_PRESETS[pr.dataset.preset];
        UTM_FIELDS.forEach(([k]) => { v[k] = p ? (p.utm[k] ?? '') : ''; });
        v.custom = p ? p.custom.map(([k, x]) => ({ k, v: x })) : [];
        paintForm(); update();
        form.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on', b === pr && !!p));
        return;
      }
      if (e.target.closest('[data-add-stage]') && v.stages.length < 5) { read(); v.stages.splice(v.stages.length - 1, 0, { name: 'New step', value: '' }); v.liftStep = ''; paintForm(); update(); const f = form.querySelectorAll('.tl-sn')[v.stages.length - 2]; if (f) f.select(); return; }
      const rs = e.target.closest('[data-rm-stage]');
      if (rs && v.stages.length > 3) { read(); v.stages.splice(Number(rs.dataset.rmStage), 1); v.liftStep = ''; paintForm(); update(); return; }
      if (e.target.closest('[data-add-cu]') && v.custom.length < 5) { read(); v.custom.push({ k: '', v: '' }); paintForm(); update(); const f = form.querySelectorAll('[data-cu][data-f="k"]'); if (f.length) f[f.length - 1].focus(); return; }
      const rc = e.target.closest('[data-rm-cu]');
      if (rc) { read(); v.custom.splice(Number(rc.dataset.rmCu), 1); paintForm(); update(); }
    });
    out.addEventListener('click', (e) => {
      const cp = e.target.closest('[data-copy-url]');
      if (cp) { const code = out.querySelector('[data-o="url"]'); if (code.dataset.url) VS.copyText(code.dataset.url, code); }
    });
    bindCur(view, () => { toolPage(view, key); });

    /* Save, saved list and share */
    const sv = view.querySelector('[data-save]');
    if (sv) sv.addEventListener('click', () => (premiumOk() ? saveModal(key, meta, v, res) : saveUpsell(meta)));
    const sl = view.querySelector('[data-saved]');
    const loadInto = (data) => { v = norm(def, data); paintForm(); update(); };
    if (sl) { sl.addEventListener('click', () => savedModal(key, meta, loadInto, () => countSaved(view, key))); countSaved(view, key); }
    const sh = view.querySelector('[data-share]');
    if (sh) sh.addEventListener('click', () => shareModal(meta, def.share(v, res, cur())));
    return null;
  }

  /** Premium tool for a member without Premium: the tool's own scene, what it does, and the way in. */
  function lockedPanel(key, meta) {
    const m = meta2(key);
    return `<section class="tl-lock" style="--a:${m.a};--u:${m.u};--t:${m.t || m.a}"><div class="tl-lock-art sf-${m.surf}" data-ta-host>${art(key)}<span class="ex-tag">Preview</span></div>
      <div class="tl-lock-t">${VS.pmark('lg')}<h3>${esc(meta.name)} comes with Premium</h3><p>${esc(TEASE[key] || meta.line)}</p>
        <ul class="tl-lock-l"><li>${icon('check')}Every Premium tool, plus saved scenarios</li><li>${icon('check')}Premium rooms and every Academy course</li><li>${icon('check')}Monthly live breakdowns with Dchessking</li></ul>
        <div class="tl-lock-a"><a class="btn btn-k" href="#premium">${icon('premium')}Go Premium · ${esc(priceLabel())}</a><a class="btn btn-ghost btn-sm" href="#tools">See the free tools</a></div><small>The free tools stay free.</small></div></section>`;
  }

  /* ---------------- saves (Premium) ---------------- */
  async function countSaved(view, key) {
    try {
      const d = await VS.api('/api/tools/saves?tool=' + encodeURIComponent(key));
      const n = view.querySelector('[data-o="nsaved"]');
      if (n) n.textContent = d.saves.length ? String(d.saves.length) : '';
    } catch { /* the count is a nicety */ }
  }
  function saveUpsell(meta) {
    A.modal(`${A.modalHead('Save your scenarios')}<div class="vs-modal-b">${A.premiumUpsell('Saving is part of Premium', `Premium members save up to ${cfg.max_saves || 50} scenarios across every tool and reload them in one tap. ${meta.name} stays free to use.`).replace('href="#premium"', 'href="#premium" data-close').replace('See Premium', `Go Premium · ${esc(priceLabel())}`)}</div>`, { cls: 'am-sm' });
  }
  function suggestName(key, v) {
    const d = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const c = cur();
    const bits = { breakeven: () => `Payout ${M.money(P(v.payout), c)} at ${M.pct(P(v.rate), 0)}`, roas: () => `Spend ${M.money(P(v.spend), c)}`, killscale: () => `Ad set at ${M.money(P(v.spend), c)} spend`, budget: () => `${v.days || '?'} day plan`, funnel: () => `${v.stages.length}-step funnel`, utm: () => (v.utm_campaign || 'Link').slice(0, 30), postback: () => 'Postback' };
    return `${(bits[key] ? bits[key]() : 'Scenario')} · ${d}`.slice(0, 60);
  }
  function saveModal(key, meta, v, res) {
    const m = A.modal(`${A.modalHead('Save this scenario', esc(meta.name))}<form class="vs-modal-b" novalidate><div class="field"><label for="tlSaveN">Name</label><input class="inp" id="tlSaveN" maxlength="60" value="${esc(suggestName(key, v))}" autofocus></div><p class="err" hidden></p><div class="am-actions"><button type="button" class="btn btn-w" data-close>Cancel</button><button class="btn btn-k" type="submit">${icon('star')}Save</button></div></form>`, { cls: 'am-sm' });
    const f = m.el.querySelector('form');
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const err = f.querySelector('.err'); err.hidden = true;
      A.busy(f.querySelector('[type=submit]'), async () => {
        try {
          await VS.api('/api/tools/saves', { body: { tool: key, name: f.querySelector('#tlSaveN').value.trim(), data: { ...v, currency: cur() } } });
          m.close(); VS.toast('Saved');
          const n = document.querySelector('[data-o="nsaved"]');
          if (n) n.textContent = String((Number(n.textContent) || 0) + 1);
        } catch (er) { if (er.status === 401) return A.errToast(er); err.textContent = er.message; err.hidden = false; }
      });
    });
  }
  async function savedModal(key, meta, loadInto, recount) {
    const m = A.modal(`${A.modalHead('Saved scenarios', esc(meta.name))}<div class="vs-modal-b"><div class="tl-saves">${A.skel(56)}${A.skel(56)}</div></div>`, { cls: 'am-sm' });
    const box = m.el.querySelector('.tl-saves');
    let list = [];
    const paint = () => {
      box.innerHTML = list.length ? list.map((s) => `<div class="tl-sv" data-id="${s.id}"><button type="button" class="tl-sv-l" data-load="${s.id}"><b>${esc(s.name)}</b><small>${esc(VS.dateStr(s.created_at))}${s.data.currency && s.data.currency !== 'USD' ? ' · ' + esc(s.data.currency) : ''}</small></button><button type="button" class="ib2 tl-sv-x" data-del="${s.id}" aria-label="Delete ${esc(s.name)}">${icon('trash')}</button></div>`).join('')
        : A.empty('star', 'Nothing saved yet', 'Press Save on this tool to keep the numbers you are looking at.');
    };
    try { list = (await VS.api('/api/tools/saves?tool=' + encodeURIComponent(key))).saves; paint(); } catch (e) { box.innerHTML = A.errorBox(e.message, false); return; }
    box.addEventListener('click', async (e) => {
      const ld = e.target.closest('[data-load]');
      if (ld) {
        const s = list.find((x) => String(x.id) === ld.dataset.load);
        if (!s) return;
        const { currency, ...data } = s.data;
        if (currency && M.CURRENCIES[currency] && currency !== cur()) { A.ls.set(CUR_KEY, currency); saveVals(key, data); m.close(); A.emit('route:refresh'); VS.toast('Loaded'); return; }
        loadInto(data); m.close(); VS.toast('Loaded');
        return;
      }
      const dl = e.target.closest('[data-del]');
      if (dl) {
        const ok = await A.ask('Delete this scenario?', 'It is removed from your saved list.', { ok: 'Delete', danger: true });
        if (!ok) return;
        try { await VS.api('/api/tools/saves/' + dl.dataset.del, { method: 'DELETE' }); list = list.filter((x) => String(x.id) !== dl.dataset.del); paint(); recount(); } catch (er) { A.errToast(er); }
      }
    });
  }

  /* ---------------- share to community ---------------- */
  async function shareModal(meta, text) {
    if (!text) { VS.toast('Fill in the tool first', 'err'); return; }
    if (!S.rooms) { try { await A.loadRooms(); } catch (e) { A.errToast(e); return; } }
    const rooms = (S.rooms || []).filter((r) => r.unlocked && r.can_post);
    if (!rooms.length) { VS.toast('No room you can post in right now', 'err'); return; }
    const pick = rooms.find((r) => /general|tracking|numbers/i.test(r.slug || r.name)) || rooms[0];
    const m = A.modal(`${A.modalHead('Share to the community', 'You read it before it is sent')}<form class="vs-modal-b" novalidate>
      <div class="field"><label for="tlRoom">Room</label><select class="inp" id="tlRoom">${rooms.map((r) => `<option value="${r.id}"${r.id === pick.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="tlTxt">Message</label><textarea class="inp" id="tlTxt" rows="5" maxlength="2000">${esc(text + '\n\nWhat would you change?')}</textarea><span class="hint">Numbers come from the ${esc(meta.name)} tool. Leave out anything private.</span></div>
      <div class="am-actions"><button type="button" class="btn btn-w" data-close>Cancel</button><button class="btn btn-k" type="submit">${icon('send')}Open the room</button></div></form>`, { cls: 'am-sm' });
    m.el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = Number(m.el.querySelector('#tlRoom').value);
      A.toolDraft = { room_id: id, text: m.el.querySelector('#tlTxt').value.trim() };
      m.close();
      location.hash = '#community/' + id;
    });
  }

  /* ---------------- entry ---------------- */
  async function render(view, arg) {
    if (!cfg) {
      try { cfg = await VS.api('/api/tools'); } catch (e) {
        if (e.status === 401) return A.errToast(e);
        view.innerHTML = `<div class="card">${A.errorBox(e.message)}</div>`;
        const b = view.querySelector('[data-retry]'); if (b) b.onclick = () => A.emit('route:refresh');
        return null;
      }
      // Premium can change while the app is open (a payment lands): read it from the live user.
      A.on('user', () => { if (cfg) cfg.premium_ok = !!(S.user && (S.user.premium || (S.user.perms || []).includes('*'))); });
      A.on('home:loaded', () => { VS.api('/api/tools').then((d) => { cfg = d; }).catch(() => {}); });
    }
    if (!view.isConnected) return null;
    const key = String(arg || '').split('/')[0];
    view.classList.add('page-tl');
    if (key && T[key]) return toolPage(view, key);
    grid(view);
    return null;
  }

  window.VST = { render, T };
})();
