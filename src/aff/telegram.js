'use strict';
/*
 * Telegram alerts through the VooSquare Affiliates bot.
 *  - Env: TELEGRAM_BOT_TOKEN (from @BotFather), TELEGRAM_BOT_USERNAME (optional; read with getMe otherwise),
 *    TELEGRAM_WEBHOOK_SECRET (optional; derived from the app secret otherwise), TELEGRAM_API_BASE (tests only).
 *  - Connect: the affiliate taps https://t.me/<bot>?start=<one-time code> (30 minutes). Telegram sends "/start <code>" to
 *    POST /api/aff/telegram/webhook (header X-Telegram-Bot-Api-Secret-Token must match), which links the chat.
 *  - Alerts go through an outbox (aff_tg_outbox) with retries and rate limits (25 messages a second overall, one a
 *    second per chat), respecting quiet hours. Plain text, no emoji, customers only as references, never PII.
 *  - Without a token everything here is a no-op and the dashboard shows "not configured".
 */
const crypto = require('node:crypto');
const config = require('../config');
const D = require('../db');
const C = require('./core');
const { now, rid, sha256, hmac, fetchJson, safeEq } = require('../util');

const env = process.env;
const token = () => env.TELEGRAM_BOT_TOKEN || '';
const configured = () => !!token();
const apiBase = () => (env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const webhookSecret = () => env.TELEGRAM_WEBHOOK_SECRET || hmac(D.secret(), 'tg-webhook').slice(0, 48);
let botName = env.TELEGRAM_BOT_USERNAME || '';

async function call(method, body) {
  if (!configured()) return { ok: false, description: 'not configured' };
  const r = await fetchJson(`${apiBase()}/bot${token()}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }, 8000);
  return r.data || { ok: false };
}
async function botUsername() {
  if (botName || !configured()) return botName;
  try { const r = await call('getMe', {}); if (r && r.ok && r.result) botName = r.result.username || ''; } catch { /* offline */ }
  return botName;
}

const DEFAULT_PREFS = { signup: false, first_payment: true, qualified: true, cpa: true, refunds: true, tier: true, payouts: true, contest_rank: false, announcements: true, earnings: true, deals: true, health: true, daily: true, weekly: true };
function row(affId) {
  let r = D.get('SELECT * FROM aff_telegram WHERE affiliate_id=?', affId);
  if (!r) { D.run('INSERT OR IGNORE INTO aff_telegram(affiliate_id, prefs, updated_at) VALUES(?,?,?)', affId, JSON.stringify(DEFAULT_PREFS), now()); r = D.get('SELECT * FROM aff_telegram WHERE affiliate_id=?', affId); }
  return r;
}
function state(affId) {
  const r = row(affId);
  return {
    configured: configured(), bot: botName || null, connected: !!(r.verified && r.chat_id), username: r.username || '', linked_at: r.linked_at || null,
    prefs: { ...DEFAULT_PREFS, ...C.json(r.prefs, {}) }, quiet_from: r.quiet_from, quiet_to: r.quiet_to, tz: r.tz,
  };
}
/** One-time connect code and the deep link. */
async function connect(affId) {
  if (!configured()) return { configured: false };
  const code = rid(12).replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
  row(affId);
  D.run('UPDATE aff_telegram SET code_hash=?, code_expires=?, updated_at=? WHERE affiliate_id=?', sha256(code), now() + 30 * 60_000, now(), affId);
  const bot = await botUsername();
  return { configured: true, code, link: `https://t.me/${bot || 'VooSquareAffiliatesBot'}?start=${code}`, expires_at: now() + 30 * 60_000 };
}
function disconnect(affId) { D.run("UPDATE aff_telegram SET chat_id='', username='', verified=0, updated_at=? WHERE affiliate_id=?", now(), affId); }
function setPrefs(affId, b) {
  const cur = state(affId);
  const prefs = { ...cur.prefs };
  if (b && b.prefs && typeof b.prefs === 'object') for (const k of Object.keys(DEFAULT_PREFS)) if (k in b.prefs) prefs[k] = !!b.prefs[k];
  const hm = (v, d) => (v === undefined ? d : /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : '');
  D.run('UPDATE aff_telegram SET prefs=?, quiet_from=?, quiet_to=?, tz=?, updated_at=? WHERE affiliate_id=?', JSON.stringify(prefs), hm(b.quiet_from, cur.quiet_from), hm(b.quiet_to, cur.quiet_to), C.clean(b.tz, 40) || cur.tz || 'Africa/Lagos', now(), affId);
  return state(affId);
}

/** Queue an alert. kind null = always sends (account messages). */
function alert(a, kind, text) {
  if (!configured() || !a) return false;
  const r = D.get('SELECT * FROM aff_telegram WHERE affiliate_id=?', a.id);
  if (!r || !r.verified || !r.chat_id) return false;
  const prefs = { ...DEFAULT_PREFS, ...C.json(r.prefs, {}) };
  if (kind && !prefs[kind]) return false;
  D.insert('aff_tg_outbox', { affiliate_id: a.id, chat_id: r.chat_id, kind: kind || 'account', text: String(text).slice(0, 3500), status: 'queued', next_at: quietEnd(r, now()), created_at: now() });
  setImmediate(() => { work().catch(() => {}); });
  return true;
}
/** When the next message may go out given the affiliate's quiet hours (local time in their zone). */
function quietEnd(r, at) {
  if (!r.quiet_from || !r.quiet_to) return at;
  let hm;
  try { hm = new Intl.DateTimeFormat('en-GB', { timeZone: r.tz || 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at); } catch { return at; }
  const mins = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const cur = mins(hm); const f = mins(r.quiet_from); const t = mins(r.quiet_to);
  const inQuiet = f < t ? cur >= f && cur < t : cur >= f || cur < t;
  if (!inQuiet) return at;
  const wait = (t - cur + 1440) % 1440;
  return at + wait * 60_000;
}

let working = false; let again = false;
const perChat = new Map();
async function work(at = now()) {
  if (!configured()) return 0;
  if (working) { again = true; return 0; }
  working = true; let n = 0;
  try {
    const due = D.all("SELECT * FROM aff_tg_outbox WHERE status='queued' AND next_at<=? ORDER BY id LIMIT 25", at);
    for (const m of due) {
      const last = perChat.get(m.chat_id) || 0;
      const gap = Number(env.TELEGRAM_CHAT_GAP_MS) >= 0 && env.TELEGRAM_CHAT_GAP_MS !== undefined ? Number(env.TELEGRAM_CHAT_GAP_MS) : 1000; // Telegram: about one message a second per chat
      if (Date.now() - last < gap) { await new Promise((r) => setTimeout(r, gap - (Date.now() - last))); }
      perChat.set(m.chat_id, Date.now());
      let res;
      try { res = await call('sendMessage', { chat_id: m.chat_id, text: m.text, disable_web_page_preview: true }); } catch (e) { res = { ok: false, description: e.message }; }
      if (res && res.ok) D.run("UPDATE aff_tg_outbox SET status='sent', sent_at=?, attempts=attempts+1 WHERE id=?", now(), m.id);
      else {
        const retryAfter = res && res.parameters && res.parameters.retry_after ? res.parameters.retry_after * 1000 : 60_000 * (m.attempts + 1);
        const blocked = res && /blocked|chat not found|deactivated/i.test(res.description || '');
        D.run('UPDATE aff_tg_outbox SET status=?, attempts=attempts+1, error=?, next_at=? WHERE id=?', blocked || m.attempts >= 4 ? 'failed' : 'queued', String((res && res.description) || 'error').slice(0, 300), at + retryAfter, m.id);
        if (blocked) D.run("UPDATE aff_telegram SET verified=0 WHERE chat_id=?", m.chat_id);
      }
      n++;
    }
  } finally {
    working = false;
    if (again) { again = false; setImmediate(() => { work().catch(() => {}); }); }
  }
  return n;
}

/* ------------------------------------------------------------------ webhook */
function checkSecret(ctx) { return safeEq(String(ctx.req.headers['x-telegram-bot-api-secret-token'] || ''), webhookSecret()); }
async function onUpdate(u) {
  const msg = u && (u.message || u.edited_message);
  if (!msg || !msg.chat || typeof msg.text !== 'string') return { ok: true };
  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const reply = (t) => call('sendMessage', { chat_id: chatId, text: t, disable_web_page_preview: true }).catch(() => {});
  const start = /^\/start(?:@\w+)?\s+([A-Za-z0-9]{6,32})$/.exec(text);
  if (start) {
    const r = D.get('SELECT * FROM aff_telegram WHERE code_hash=? AND code_expires>?', sha256(start[1]), now());
    if (!r) { await reply('That link has expired. Open Notifications in your VooSquare affiliate dashboard and tap Connect Telegram again.'); return { ok: true, linked: false }; }
    D.run("UPDATE aff_telegram SET chat_id=?, username=?, verified=1, code_hash='', code_expires=0, linked_at=?, updated_at=? WHERE affiliate_id=?", chatId, C.clean(msg.from && msg.from.username, 64), now(), now(), r.affiliate_id);
    C.audit(null, 'telegram.connected', { affiliate_id: r.affiliate_id });
    await reply(`Connected. You will get VooSquare affiliate alerts here. Change them any time: ${config.baseUrl}/affiliates#/aff/notifications`);
    require('../util').publish('user:' + (C.byId(r.affiliate_id) || {}).user_id, 'aff', { kind: 'telegram_connected' });
    return { ok: true, linked: true, affiliate_id: r.affiliate_id };
  }
  const linked = D.get('SELECT * FROM aff_telegram WHERE chat_id=? AND verified=1', chatId);
  if (!linked) { await reply('Connect this chat from your VooSquare affiliate dashboard: Notifications, then Connect Telegram.'); return { ok: true }; }
  const a = C.byId(linked.affiliate_id);
  const E = require('./engine');
  const cmd = text.split(/\s+/)[0].replace(/@\w+$/, '').toLowerCase();
  if (cmd === '/balance') { const b = E.balance(a.id); await reply(`Available: ${C.fmtUsd(b.available_cents)}.${b.hold_cents > 0 ? ` On hold: ${C.fmtUsd(b.hold_cents)}.` : ''}${b.pending_activation_cents > 0 ? ` Waiting for activation: ${C.fmtUsd(b.pending_activation_cents)}.` : ''} In CPA review: ${C.fmtUsd(b.in_review_cents)}. Paid all time: ${C.fmtUsd(b.paid_cents)}.`); }
  else if (cmd === '/tier') { const t = C.tiers()[C.effectiveTier(a)]; await reply(`Your tier: ${t.name}, ${t.rate_bp / 100}% RevShare.`); }
  else if (cmd === '/stop') { disconnect(a.id); await reply('Alerts stopped. Connect again from your dashboard any time.'); }
  else if (cmd === '/today' || cmd === '/month') {
    const R = require('./reports');
    const k = R.kpis(a.id, cmd === '/today' ? 'today' : 'month');
    await reply(`${cmd === '/today' ? 'Today' : 'This month'}: ${k.clicks} clicks · ${k.signups} sign-ups · ${k.paying} first payments · ${k.qualified} qualified FTDs · ${C.fmtUsd(k.commission_cents)} commission${k.adjustments_cents ? ` (plus ${C.fmtUsd(k.adjustments_cents)} in adjustments)` : ''}.`);
  } else await reply('Commands: /balance, /today, /month, /tier, /stop');
  return { ok: true };
}
async function setWebhook() {
  if (!configured()) return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not set.' };
  return call('setWebhook', { url: `${config.baseUrl}/api/aff/telegram/webhook`, secret_token: webhookSecret(), allowed_updates: ['message'] });
}

module.exports = { configured, state, connect, disconnect, setPrefs, alert, work, onUpdate, checkSecret, setWebhook, webhookSecret, botUsername, DEFAULT_PREFS, quietEnd, _crypto: crypto };
