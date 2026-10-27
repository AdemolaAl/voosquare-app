/* VooSquare free tools: pure maths and link builders. No DOM. Loaded on demand in the app (window.VSTM)
 * and required by test/smoke.js in Node. Rates and margins are percentages (10 means 10%). */
(function (root, factory) {
  const M = factory();
  if (typeof module === 'object' && module.exports) module.exports = M;
  else root.VSTM = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const ok = (n) => typeof n === 'number' && Number.isFinite(n);
  const pos = (n) => ok(n) && n > 0;
  const div = (a, b) => (ok(a) && ok(b) && b !== 0 ? a / b : NaN);

  /** "1,250.50", " 300 ", "$40" → number. Empty or junk → NaN. */
  function parseNum(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = String(v == null ? '' : v).replace(/[\s, ]/g, '').replace(/^(-?)[^\d.-]+/, '$1').replace(/%$/, '');
    if (!s || !/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return NaN;
    return Number(s);
  }

  /* ---------------- money and numbers ---------------- */
  const CURRENCIES = {
    USD: { sym: '$', name: 'US dollar' }, NGN: { sym: '₦', name: 'Naira' }, KES: { sym: 'KSh ', name: 'Kenyan shilling' },
    GHS: { sym: 'GH₵', name: 'Cedi' }, ZAR: { sym: 'R ', name: 'Rand' }, XAF: { sym: 'FCFA ', name: 'CFA franc' },
  };
  const group = (n, d) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  /** Money with the chosen symbol (symbol only, no exchange rates). Under 1,000 shows cents. Not a number → "—". */
  function money(n, cur = 'USD') {
    if (!ok(n)) return '—';
    const sym = (CURRENCIES[cur] || CURRENCIES.USD).sym;
    const d = Math.abs(n) < 1000 ? 2 : 0;
    return (n < 0 ? '-' : '') + sym + group(Math.abs(n), d);
  }
  const num = (n, d = 0) => (ok(n) ? group(n, d) : '—');
  const pct = (n, d = 1) => (ok(n) ? group(n, Math.abs(n) >= 100 ? 0 : d) + '%' : '—');
  const times = (n) => (ok(n) ? group(n, 2) + '×' : '—');

  /* ---------------- 1. break-even CPA/CPL ---------------- */
  /** payout per FTD, rate lead→FTD (%), margin wanted (%). */
  function breakEven({ payout, rate, margin }) {
    const p = pos(payout) ? payout : NaN;
    const r = pos(rate) ? Math.min(rate, 100) / 100 : NaN;
    const m = ok(margin) ? Math.min(Math.max(margin, 0), 99) / 100 : 0;
    const beCpl = p * r;
    return { beCpl, tCpl: beCpl * (1 - m), beCpa: p, tCpa: p * (1 - m), leadsPerFtd: div(1, r), margin: m * 100 };
  }

  /* ---------------- 2. ROAS and profit ---------------- */
  /** spend + revenue, or spend + conversions × payout. */
  function roas({ spend, revenue, conversions, payout }) {
    const cv = ok(conversions) && conversions >= 0 ? conversions : NaN;
    const rev = ok(revenue) ? revenue : (ok(cv) && ok(payout) ? cv * payout : NaN);
    const s = ok(spend) && spend >= 0 ? spend : NaN;
    const profit = rev - s;
    return {
      spend: s, revenue: rev, profit,
      margin: div(profit, rev) * 100, roas: div(rev, s), roi: div(profit, s) * 100,
      cpa: pos(cv) ? s / cv : NaN, conversions: cv,
    };
  }

  /* ---------------- 3. kill or scale ---------------- */
  const DEFAULT_RULES = {
    kill_zero_mult: 2, kill_cpa_mult: 1.5, kill_after_mult: 3, hold_band: 20,
    scale_cpa_mult: 0.8, scale_min_conv: 3, scale_pct: 20,
    big_cpa_mult: 0.6, big_min_conv: 10, big_pct_min: 30, big_pct_max: 50,
  };
  const x = (n) => (Math.round(n * 100) / 100).toString() + '×';
  /**
   * A rule-based guide, checked in order: kill (no conversions), kill (CPA too high after enough spend),
   * scale big, scale, then hold. Returns null until spend and target CPA are filled in.
   */
  function killScale({ spend, conversions, target, days, ctr }, rules) {
    const R = { ...DEFAULT_RULES, ...(rules || {}) };
    if (!ok(spend) || spend < 0 || !pos(target)) return null;
    const conv = ok(conversions) && conversions > 0 ? Math.floor(conversions) : 0;
    const cpa = conv ? spend / conv : NaN;
    // Rounded so a CPA typed at exactly a rule line (98.40 / 3 vs 41 = 0.8×) is not lost to float error.
    const r9 = (n) => Math.round(n * 1e9) / 1e9;
    const ratio = conv ? r9(cpa / target) : NaN;
    const spendX = r9(spend / target);
    const daily = pos(days) ? spend / days : NaN;
    const base = { cpa, ratio, spendX, conversions: conv, daily, ctr: ok(ctr) ? ctr : NaN };
    const band = R.hold_band / 100;
    if (!conv && spendX >= R.kill_zero_mult) {
      return { ...base, verdict: 'kill', label: 'Kill', rule: `Spend ≥ ${x(R.kill_zero_mult)} target CPA with 0 conversions`, reason: `You spent ${x(spendX)} your target CPA without a single conversion.` };
    }
    if (conv && spendX >= R.kill_after_mult && ratio > R.kill_cpa_mult) {
      return { ...base, verdict: 'kill', label: 'Kill', rule: `CPA > ${x(R.kill_cpa_mult)} target after ≥ ${x(R.kill_after_mult)} target spend`, reason: `CPA is ${x(ratio)} your target after spending ${x(spendX)} your target CPA.` };
    }
    if (conv >= R.big_min_conv && ratio <= R.big_cpa_mult) {
      return { ...base, verdict: 'scale_big', label: `Scale +${R.big_pct_min}–${R.big_pct_max}%`, pct: [R.big_pct_min, R.big_pct_max], rule: `CPA ≤ ${x(R.big_cpa_mult)} target with ≥ ${R.big_min_conv} conversions`, reason: `CPA is ${x(ratio)} your target across ${conv} conversions. Raise the budget in steps.` };
    }
    if (conv >= R.scale_min_conv && ratio <= R.scale_cpa_mult) {
      return { ...base, verdict: 'scale', label: `Scale +${R.scale_pct}%`, pct: [R.scale_pct], rule: `CPA ≤ ${x(R.scale_cpa_mult)} target with ≥ ${R.scale_min_conv} conversions`, reason: `CPA is ${x(ratio)} your target across ${conv} conversions.` };
    }
    // Hold: say why.
    let reason, rule;
    if (!conv) { rule = 'Data too thin'; reason = `No conversions yet, and spend is under ${x(R.kill_zero_mult)} your target CPA. Let it run.`; }
    else if (Math.abs(ratio - 1) <= band) { rule = `CPA within ±${R.hold_band}% of target`; reason = `CPA is ${x(ratio)} your target. Keep the budget where it is.`; }
    else if (ratio < 1 && conv < R.scale_min_conv) { rule = 'Data too thin'; reason = `CPA looks good, but ${conv} conversion${conv === 1 ? ' is' : 's are'} not enough. Wait for ${R.scale_min_conv}.`; }
    else if (ratio < 1) { rule = `CPA under target, above the ${x(R.scale_cpa_mult)} scale line`; reason = `CPA is ${x(ratio)} your target. Keep the budget where it is until it drops to ${x(R.scale_cpa_mult)}.`; }
    else if (spendX < R.kill_after_mult) { rule = 'Data too thin'; reason = `CPA is ${x(ratio)} your target, but spend is under ${x(R.kill_after_mult)} your target CPA. Give it more data.`; }
    else { rule = `CPA above target, under the ${x(R.kill_cpa_mult)} kill line`; reason = `CPA is ${x(ratio)} your target. Fix the creative or audience before adding budget.`; }
    return { ...base, verdict: 'hold', label: 'Hold', rule, reason };
  }

  /* ---------------- 4. budget planner ---------------- */
  /** Checkpoints along the run: day 1, a quarter, half, three quarters and the last day. */
  function timeline(days, perDaySpend, perDayConv) {
    const D = Math.max(1, Math.round(days));
    const marks = [...new Set([1, Math.round(D * 0.25), Math.round(D * 0.5), Math.round(D * 0.75), D].filter((d) => d >= 1))].sort((a, b) => a - b);
    return marks.map((d) => ({ day: d, spend: perDaySpend * d, conversions: perDayConv * d }));
  }
  /**
   * mode 'goal': goal (conversions, or revenue with goalType 'revenue' and payout), cpa, days → daily budget.
   * mode 'daily': daily budget, cpa, days → conversions per day and in total.
   */
  function budget({ mode = 'goal', goalType = 'conversions', goal, payout, cpa, days, daily }) {
    const d = pos(days) ? Math.max(1, Math.round(days)) : NaN; // whole days, so the day-by-day plan adds up to the total
    if (!pos(cpa) || !ok(d)) return { total: NaN, daily: NaN, conversions: NaN, perDay: NaN, revenue: NaN, timeline: [] };
    let conv, total, dly;
    if (mode === 'daily') {
      dly = pos(daily) ? daily : NaN;
      total = dly * d;
      conv = total / cpa;
    } else {
      conv = goalType === 'revenue' ? div(goal, pos(payout) ? payout : NaN) : (pos(goal) ? goal : NaN);
      total = conv * cpa;
      dly = total / d;
    }
    const revenue = pos(payout) ? conv * payout : NaN;
    const ready = ok(total) && ok(conv);
    return { total, daily: dly, conversions: conv, perDay: conv / d, revenue, profit: revenue - total, timeline: ready ? timeline(d, dly, conv / d) : [] };
  }

  /* ---------------- 5. funnel ---------------- */
  /**
   * stages: [{ name, value }]. mode 'count': every value is a count. mode 'rate': the first is a count,
   * the rest are the % of the step before. lift: % improvement of one step (default: the biggest drop).
   */
  function funnel({ stages, mode = 'count', payout, lift = 10, liftStep }) {
    const list = (stages || []).slice(0, 5);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const v = list[i].value;
      let count;
      if (i === 0 || mode === 'count') count = ok(v) && v >= 0 ? v : NaN;
      else count = ok(v) && v >= 0 ? out[i - 1].count * Math.min(v, 100) / 100 : NaN;
      const step = i === 0 ? 100 : div(count, out[i - 1].count) * 100;
      out.push({ name: list[i].name || `Step ${i + 1}`, count, step, overall: i === 0 ? 100 : div(count, out[0].count) * 100 });
    }
    let drop = -1, low = Infinity;
    out.forEach((s, i) => { if (i > 0 && ok(s.step) && s.step < low) { low = s.step; drop = i; } });
    const last = out.length ? out[out.length - 1].count : NaN;
    const at = Number.isInteger(liftStep) && liftStep > 0 && liftStep < out.length ? liftStep : drop;
    const l = ok(lift) && lift > 0 ? lift : 0;
    // Every step multiplies into the last one, so lifting any one step by l% lifts the end of the funnel by l%,
    // as long as that step stays at or under 100%.
    const capped = at > 0 && ok(out[at].step) ? Math.min(out[at].step * (1 + l / 100), 100) : NaN;
    const complete = out.length > 1 && out.every((s) => ok(s.count));
    // A step already at or over 100% (counts that grow) cannot be lifted; a 0% step lifted by l% is still 0.
    const extra = !complete || !(at > 0) ? NaN : out[at].step > 0 ? Math.max(0, last * (capped / out[at].step - 1)) : 0;
    return { stages: out, biggestDrop: drop, liftStep: at, extra, extraValue: pos(payout) ? extra * payout : NaN, final: last, overall: out.length > 1 ? out[out.length - 1].overall : NaN };
  }

  /* ---------------- 6. UTM / link builder ---------------- */
  /** Percent-encode a value but keep ad-platform macro braces readable ({{ad.name}}, {keyword}). */
  const encVal = (v) => encodeURIComponent(String(v)).replace(/%7B/gi, '{').replace(/%7D/gi, '}');
  function splitBase(base) {
    const s = String(base || '').trim();
    let url;
    try { url = new URL(s); } catch { return { error: 'Paste a full link that starts with https://' }; }
    if (url.protocol !== 'https:') return { error: 'Use an https:// link. Ad platforms and browsers flag plain http.' };
    if (!url.hostname || !url.hostname.includes('.')) return { error: 'That link has no domain. Check it and try again.' };
    const hashAt = s.indexOf('#');
    const hash = hashAt >= 0 ? s.slice(hashAt) : '';
    const noHash = hashAt >= 0 ? s.slice(0, hashAt) : s;
    const qAt = noHash.indexOf('?');
    return { path: (qAt >= 0 ? noHash.slice(0, qAt) : noHash).replace(/ /g, '%20'), query: qAt >= 0 ? noHash.slice(qAt + 1) : '', hash };
  }
  const KEY_RE = /^[A-Za-z0-9_.\-[\]]{1,40}$/;
  /**
   * params: [[key, value], ...]. Empty values are skipped. Keys already in the link are replaced.
   * Returns { url } or { error }.
   */
  function buildUtm({ base, params }) {
    const b = splitBase(base);
    if (b.error) return { error: b.error };
    const keep = (params || []).filter(([k, v]) => String(k || '').trim() && String(v == null ? '' : v).trim() !== '').map(([k, v]) => [String(k).trim(), String(v).trim()]);
    const bad = keep.find(([k]) => !KEY_RE.test(k));
    if (bad) return { error: `"${bad[0]}" is not a valid parameter name. Use letters, numbers, _ - . only.` };
    const twice = keep.find(([k], i) => keep.findIndex(([k2]) => k2.toLowerCase() === k.toLowerCase()) !== i);
    if (twice) return { error: `"${twice[0]}" is used twice. Each parameter name must be different.` };
    const set = new Set(keep.map(([k]) => k.toLowerCase()));
    const old = b.query ? b.query.split('&').filter((p) => p && !set.has(decodeURIComponentSafe(p.split('=')[0]).toLowerCase())) : [];
    const q = [...old, ...keep.map(([k, v]) => `${encodeURIComponent(k)}=${encVal(v)}`)].join('&');
    return { url: b.path + (q ? '?' + q : '') + b.hash, count: keep.length };
  }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

  /** Ad-platform presets. Only macros documented by each platform. */
  const UTM_PRESETS = {
    meta: { label: 'Meta', utm: { utm_source: '{{site_source_name}}', utm_medium: 'paid_social', utm_campaign: '{{campaign.name}}', utm_content: '{{ad.name}}', utm_term: '{{adset.name}}' }, custom: [['placement', '{{placement}}'], ['campaign_id', '{{campaign.id}}'], ['adset_id', '{{adset.id}}'], ['ad_id', '{{ad.id}}']] },
    tiktok: { label: 'TikTok', utm: { utm_source: 'tiktok', utm_medium: 'paid_social', utm_campaign: '__CAMPAIGN_NAME__', utm_content: '__CID_NAME__', utm_term: '__AID_NAME__' }, custom: [['campaign_id', '__CAMPAIGN_ID__'], ['adgroup_id', '__AID__'], ['ad_id', '__CID__']] },
    snapchat: { label: 'Snapchat', utm: { utm_source: 'snapchat', utm_medium: 'paid_social', utm_campaign: '{{campaign.name}}', utm_content: '{{ad.name}}', utm_term: '{{adSet.name}}' }, custom: [['campaign_id', '{{campaign.id}}'], ['adset_id', '{{adSet.id}}'], ['ad_id', '{{ad.id}}']] },
    google: { label: 'Google', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: '', utm_content: '{creative}', utm_term: '{keyword}' }, custom: [['campaignid', '{campaignid}'], ['adgroupid', '{adgroupid}']] },
  };

  /* ---------------- 7. postback URL builder ---------------- */
  /** Macros stay as typed (networks swap them before calling); only spaces, &, quotes and angle brackets are encoded. */
  const encMacro = (v) => String(v).replace(/[\s&"<>]/g, (c) => encodeURIComponent(c));
  function buildPostback({ base, params }) {
    const s = String(base || '').trim();
    let url;
    try { url = new URL(s); } catch { return { error: 'Paste the full receiver URL from your tracker, starting with https://' }; }
    if (!/^https?:$/.test(url.protocol)) return { error: 'The receiver URL must start with https://' };
    const keep = (params || []).filter(([k, v]) => String(k || '').trim() && String(v == null ? '' : v).trim() !== '').map(([k, v]) => [String(k).trim(), String(v).trim()]);
    const bad = keep.find(([k]) => !KEY_RE.test(k));
    if (bad) return { error: `"${bad[0]}" is not a valid parameter name. Use letters, numbers, _ - . only.` };
    const dupe = keep.find(([k], i) => keep.findIndex(([k2]) => k2 === k) !== i);
    if (dupe) return { error: `"${dupe[0]}" is used twice. Each parameter name must be different.` };
    const hashAt = s.indexOf('#');
    const noHash = hashAt >= 0 ? s.slice(0, hashAt) : s;
    const sep = noHash.includes('?') ? (/[?&]$/.test(noHash) ? '' : '&') : '?';
    const q = keep.map(([k, v]) => `${encodeURIComponent(k)}=${encMacro(v)}`).join('&');
    return { url: noHash + (q ? sep + q : ''), count: keep.length, insecure: url.protocol === 'http:' };
  }

  return { parseNum, money, num, pct, times, CURRENCIES, breakEven, roas, killScale, DEFAULT_RULES, budget, funnel, buildUtm, UTM_PRESETS, buildPostback, encVal };
});
