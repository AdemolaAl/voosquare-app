'use strict';
/*
 * Rollout flags for NEW features (docs/CHANGING-SAFELY.md, "Add a feature behind a flag"). Different from the area
 * switches in src/features.js (whole areas on or off for everyone): a flag lets a new feature ship turned off, then be
 * tried by the team, then by a share of members, then by everyone, with no redeploy.
 *
 *   1. Declare it below: FLAGS = { 'new-checkout': 'The new checkout screen' }.
 *   2. In the server: if (flags.on('new-checkout', ctx.user)) { ...new path... } else { ...old path, unchanged... }
 *      In the app: VS.me.flags['new-checkout'] (sent on GET /api/me as `flags`).
 *   3. Admin API (settings permission): GET /api/admin/flags, PUT /api/admin/flags { key, mode, percent }.
 *      mode: 'off' (default) | 'staff' (the team only) | 'percent' (the team + `percent`% of members, the same members
 *      every time) | 'on' (everyone).
 *   4. When it has been on for everyone for a while, a later release removes the old path and the flag (the stored
 *      setting can stay; unknown keys are ignored).
 */
const crypto = require('node:crypto');
const D = require('./db');
const A = require('./auth');
const { now, fail, clean } = require('./util');

/* key → what it is (shown in the admin). Keep keys lower-case-with-dashes. */
const FLAGS = {
};
if (process.env.NODE_ENV === 'test') FLAGS['test-flag'] = 'Test flag (tests only)';

const MODES = ['off', 'staff', 'percent', 'on'];
function stored() { const v = D.getSetting('flags', {}); return v && typeof v === 'object' ? v : {}; }
function get(key) {
  const v = stored()[key] || {};
  return { key, label: FLAGS[key] || key, mode: MODES.includes(v.mode) ? v.mode : 'off', percent: Math.max(0, Math.min(100, Math.floor(Number(v.percent) || 0))), updated_at: v.updated_at || 0 };
}
/** The same member always lands in the same bucket (0-99) for a flag. */
const bucket = (key, userId) => crypto.createHash('sha256').update(key + ':' + userId).digest().readUInt32BE(0) % 100;

/** Is this flag on for this person? Unknown flags are off. */
function on(key, user) {
  if (!FLAGS[key]) return false;
  const f = get(key);
  if (f.mode === 'on') return true;
  if (f.mode === 'off') return false;
  const staff = !!(user && user.staff);
  if (staff) return true;
  if (f.mode === 'percent' && user && user.id) return bucket(key, user.id) < f.percent;
  return false;
}
const forUser = (user) => Object.fromEntries(Object.keys(FLAGS).map((k) => [k, on(k, user)]));

function routes(r) {
  r.get('/api/admin/flags', (ctx) => { A.requirePerm(ctx, 'settings'); return { flags: Object.keys(FLAGS).map(get), modes: MODES }; });
  r.put('/api/admin/flags', async (ctx) => {
    const me = A.requirePerm(ctx, 'settings');
    const b = await ctx.json();
    const key = clean(b.key, 60);
    if (!FLAGS[key]) fail(404, 'Unknown flag.');
    if (!MODES.includes(b.mode)) fail(400, 'mode must be off, staff, percent or on.');
    const all = stored();
    all[key] = { mode: b.mode, percent: Math.max(0, Math.min(100, Math.floor(Number(b.percent) || 0))), updated_at: now() };
    D.setSetting('flags', all);
    D.insert('audit', { user_id: me.id, action: 'settings.flag', detail: `${key}=${b.mode}${b.mode === 'percent' ? ' ' + all[key].percent + '%' : ''}`, created_at: now() });
    return { flag: get(key) };
  });
}

module.exports = { FLAGS, on, forUser, get, routes, bucket };
