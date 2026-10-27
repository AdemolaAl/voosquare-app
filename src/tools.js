'use strict';
/* Free tools (calculators and builders in the member app). The maths runs in the browser (public/js/tools-math.js);
 * the server keeps the catalogue, which tools are on and Free or Premium, the Kill-or-scale thresholds, and Premium saves. */
const { clean } = require('./util');

/** Names and one-liners live here so the app, the home strip and the website all show the same words. */
const CATALOG = [
  { key: 'breakeven', name: 'Break-even CPA/CPL', line: 'The most you can pay per lead and per FTD.', icon: 'target', access: 'free' },
  { key: 'roas', name: 'ROAS and profit', line: 'Profit, margin, ROAS and ROI from spend and revenue.', icon: 'chart', access: 'free' },
  { key: 'killscale', name: 'Kill or scale', line: 'A rule-based call on an ad set: kill, hold or scale.', icon: 'flag', access: 'premium' },
  { key: 'budget', name: 'Budget planner', line: 'Daily budget for a goal, or results for a budget.', icon: 'wallet', access: 'premium' },
  { key: 'funnel', name: 'Funnel calculator', line: 'Find the step that loses the most people.', icon: 'filter', access: 'free' },
  { key: 'utm', name: 'UTM builder', line: 'Tagged links with Meta, TikTok, Snapchat and Google macros.', icon: 'link', access: 'free' },
  { key: 'postback', name: 'Postback builder', line: 'A clean postback URL from your network’s macros.', icon: 'send', access: 'premium' },
  { key: 'sizes', name: 'Ad sizes', line: 'Feed, Stories, Reels and display sizes on one page.', icon: 'image', access: 'free' },
];
const KEYS = CATALOG.map((t) => t.key);

/* Kill-or-scale thresholds. Multipliers are of the target CPA. */
const RULES = {
  kill_zero_mult: 2, // kill: spend >= 2x target CPA with 0 conversions
  kill_cpa_mult: 1.5, // kill: CPA > 1.5x target ...
  kill_after_mult: 3, // ... once spend >= 3x target CPA
  hold_band: 20, // hold: CPA within +/-20% of target
  scale_cpa_mult: 0.8, scale_min_conv: 3, scale_pct: 20, // scale +20%: CPA <= 0.8x target with >= 3 conversions
  big_cpa_mult: 0.6, big_min_conv: 10, big_pct_min: 30, big_pct_max: 50, // scale +30-50%: CPA <= 0.6x with >= 10
};
const RULE_LIMITS = {
  kill_zero_mult: [1, 10], kill_cpa_mult: [1, 5], kill_after_mult: [1, 10], hold_band: [0, 50],
  scale_cpa_mult: [0.1, 1], scale_min_conv: [1, 1000], scale_pct: [1, 200],
  big_cpa_mult: [0.05, 1], big_min_conv: [1, 10000], big_pct_min: [1, 300], big_pct_max: [1, 300],
};
const INT_RULES = ['scale_min_conv', 'big_min_conv', 'scale_pct', 'big_pct_min', 'big_pct_max', 'hold_band'];

const DEFAULT = {
  tools: Object.fromEntries(CATALOG.map((t, i) => [t.key, { enabled: true, access: t.access, sort: i }])),
  kill_scale: { ...RULES },
};

/** Validate a saved `tools` setting. Unknown tools are dropped, missing ones come back with defaults, numbers are clamped. */
function cleanSetting(value) {
  const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const inTools = src.tools && typeof src.tools === 'object' && !Array.isArray(src.tools) ? src.tools : {};
  const rows = CATALOG.map((t, i) => {
    const x = inTools[t.key] && typeof inTools[t.key] === 'object' ? inTools[t.key] : {};
    const sort = Number.isFinite(Number(x.sort)) ? Number(x.sort) : 100 + i;
    return { key: t.key, enabled: x.enabled === undefined ? true : x.enabled === true || x.enabled === 1 || x.enabled === 'true', access: x.access === 'premium' ? 'premium' : x.access === 'free' ? 'free' : t.access, sort, i };
  }).sort((a, b) => a.sort - b.sort || a.i - b.i);
  const tools = Object.fromEntries(rows.map((r, idx) => [r.key, { enabled: r.enabled, access: r.access, sort: idx }]));
  const inRules = src.kill_scale && typeof src.kill_scale === 'object' ? src.kill_scale : {};
  const ks = {};
  for (const [k, def] of Object.entries(RULES)) {
    const [lo, hi] = RULE_LIMITS[k];
    const raw = inRules[k];
    // A field left blank (or null) keeps the default instead of becoming 0 and clamping to the minimum.
    let n = raw === '' || raw === null || raw === undefined || typeof raw === 'boolean' ? NaN : Number(raw);
    if (!Number.isFinite(n)) n = def;
    n = Math.min(hi, Math.max(lo, n));
    ks[k] = INT_RULES.includes(k) ? Math.round(n) : Math.round(n * 100) / 100;
  }
  // Keep the ladder consistent: the big-scale band sits inside the normal scale band.
  if (ks.big_cpa_mult > ks.scale_cpa_mult) ks.big_cpa_mult = ks.scale_cpa_mult;
  if (ks.big_min_conv < ks.scale_min_conv) ks.big_min_conv = ks.scale_min_conv;
  if (ks.big_pct_max < ks.big_pct_min) ks.big_pct_max = ks.big_pct_min;
  return { tools, kill_scale: ks };
}

/** Enabled tools in order, for the app, the home strip and the website. */
function publicList(setting) {
  const s = cleanSetting(setting);
  return CATALOG.filter((t) => s.tools[t.key].enabled)
    .sort((a, b) => s.tools[a.key].sort - s.tools[b.key].sort)
    .map((t) => ({ key: t.key, name: t.name, line: t.line, icon: t.icon, access: s.tools[t.key].access }));
}

/* ---------------- Premium saves ---------------- */
const MAX_SAVES = 50;
const MAX_DATA = 4096;
function cleanSave(b) {
  const tool = String((b && b.tool) || '');
  if (!KEYS.includes(tool)) return { error: 'Pick a tool to save.' };
  const data = b.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'Nothing to save.' };
  let raw;
  try { raw = JSON.stringify(data); } catch { return { error: 'Nothing to save.' }; }
  if (raw.length > MAX_DATA) return { error: 'That scenario is too large to save.' };
  const name = clean(b.name, 60) || CATALOG.find((t) => t.key === tool).name;
  return { tool, name, raw };
}

module.exports = { CATALOG, KEYS, RULES, DEFAULT, cleanSetting, publicList, cleanSave, MAX_SAVES, MAX_DATA };
