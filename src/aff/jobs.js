'use strict';
/*
 * Affiliate background jobs. Every minute: postback and Telegram deliveries. Every hour: qualification catch-up (customers
 * with a counted payment whose live hook was missed), release of any admin-set holds, activation, health, monthly tiers (once per affiliate per month), scheduled offer changes, announcements,
 * contest scores, affiliate fraud scores, catch-up of missed events and the daily Telegram summary.
 * runAll(at) is also exposed to admins (and to tests with a moved clock) at POST /api/admin/aff/jobs/run.
 */
const D = require('../db');
const C = require('./core');
const E = require('./engine');
const F = require('./fraud');
const P = require('./program');
const PB = require('./postbacks');
const TG = require('./telegram');
const CT = require('./contests');
const { now } = require('../util');

async function runAll(at = now(), { reconcile = true } = {}) {
  const out = {};
  const step = async (k, fn) => { try { out[k] = await fn(); } catch (e) { out[k] = { error: e.message }; console.error('[aff job]', k, e); } };
  if (reconcile) await step('reconcile', () => E.reconcile());
  await step('qualified', () => E.qualifyPending(at));
  await step('activated', () => D.all("SELECT * FROM aff_affiliates WHERE activated_at IS NULL AND status IN ('approved','suspended')").map(C.hydrate).filter((a) => E.checkActivation(a, at)).length);
  await step('settled', () => E.settle(at));
  await step('health', () => E.runHealth(at));
  await step('tiers', () => E.runTiers(at));
  await step('changes', () => P.applyDueChanges(at));
  await step('custom_deals', () => P.revshareJobs(at));
  await step('announcements', () => D.all('SELECT * FROM aff_announcements WHERE sent_at IS NULL AND send_at<=?', at).reduce((n, an) => n + P.sendAnnouncement(an, at), 0));
  await step('contests', () => CT.recomputeAll(at));
  await step('fraud', () => { let n = 0; for (const a of D.all("SELECT id, fraud_score FROM aff_affiliates WHERE status IN ('approved','suspended')")) { const s = F.affiliateScore(a.id, at).score; if (s !== a.fraud_score) { D.run('UPDATE aff_affiliates SET fraud_score=? WHERE id=?', s, a.id); n++; } } return n; });
  await step('summary', () => dailySummary(at));
  await step('postbacks', () => PB.work(at));
  await step('telegram', () => TG.work(at));
  return out;
}
/** Daily Telegram summary of yesterday, once a day after 08:00 in the reporting time zone. */
function dailySummary(at = now()) {
  if (!TG.configured()) return 0;
  const today = C.dayKey(at);
  if (D.getSetting('aff_summary_day', '') === today) return 0;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: C.tz(), hour: '2-digit', hourCycle: 'h23' }).format(at));
  if (hour < 8) return 0;
  D.setSetting('aff_summary_day', today);
  const R = require('./reports');
  let n = 0;
  for (const t of D.all('SELECT affiliate_id FROM aff_telegram WHERE verified=1')) {
    const a = C.byId(t.affiliate_id);
    if (!a || a.status !== 'approved') continue;
    const k = R.kpis(a.id, 'yesterday', at); const b = E.balance(a.id, at);
    if (TG.alert(a, 'daily', `Yesterday: ${k.clicks} clicks · ${k.signups} sign-ups · ${k.paying} first payments · ${k.qualified} qualified FTDs · ${C.fmtUsd(k.commission_cents)} commission${k.adjustments_cents ? ` (plus ${C.fmtUsd(k.adjustments_cents)} in adjustments)` : ''}. Available: ${C.fmtUsd(b.available_cents)}.`)) n++;
  }
  return n;
}
let started = false;
function start() {
  if (started || process.env.AFF_JOBS === 'off') return; // tests drive the jobs with a moved clock instead
  started = true;
  setInterval(() => { PB.work().catch((e) => console.error('[aff postbacks]', e.message)); TG.work().catch((e) => console.error('[aff telegram]', e.message)); }, 60_000).unref();
  setInterval(() => { runAll().catch((e) => console.error('[aff jobs]', e)); }, 3600_000).unref();
  setTimeout(() => { runAll().catch((e) => console.error('[aff jobs]', e)); }, 20_000).unref();
}

module.exports = { runAll, start, dailySummary };
