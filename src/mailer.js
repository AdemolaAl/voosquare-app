'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const D = require('./db');
const { now, hmac, esc, json, fetchJson } = require('./util');

/* Templates live in the database (editable in admin). The files are the defaults used on first boot. */
const TEMPLATE_FILE = path.join(__dirname, 'emails', 'templates.json');
const SEQUENCE_FILE = path.join(__dirname, 'emails', 'sequence.json');

/** Transactional emails that must send even if the person opted out of marketing. */
const TRANSACTIONAL = new Set(['verify_code', 'premium_receipt', 'premium_welcome', 'premium_expiring', 'room_access', 'support_reply', 'admin_invite', 'order_review', 'room_application_received', 'room_application_approved', 'room_application_waitlist', 'room_application_rejected', 'payout_requested', 'payout_paid', 'payout_rejected', 'certificate_issued',
  'aff_application_received', 'aff_application_approved', 'aff_application_rejected', 'aff_info_requested', 'aff_cpa_approved', 'aff_cpa_declined', 'aff_payout_requested', 'aff_payout_paid', 'aff_payout_rejected', 'aff_health_warning', 'aff_health_paused', 'aff_tier_up', 'aff_contest_won', 'aff_custom_deal']);

const FALLBACK = {
  verify_code: {
    name: 'Verification code', subject: 'Your VooSquare code: {{code}}', preheader: 'Use this code to sign in.',
    html: '<p>Hi {{firstName}},</p><p>Your VooSquare code is:</p><p style="font-size:32px;font-weight:800;letter-spacing:6px">{{code}}</p><p>It expires in 10 minutes. If you did not ask for it, ignore this email.</p>',
    text: 'Your VooSquare code is {{code}}. It expires in 10 minutes.',
  },
  welcome: { name: 'Welcome', subject: 'Welcome to VooSquare, {{firstName}}', html: '<p>Welcome to VooSquare, {{firstName}}.</p><p><a href="{{appUrl}}">Open your dashboard</a></p>', text: 'Welcome to VooSquare. Open your dashboard: {{appUrl}}', marketing: 1 },
  support_reply: { name: 'Support reply', subject: 'Re: {{subject}}', html: '<p>Hi {{firstName}},</p>{{{reply_html}}}<p>— {{agent}}, {{product}} support</p>', text: '{{reply}}\n\n— {{agent}}, {{product}} support' },
  premium_receipt: { name: 'Premium receipt', subject: 'Payment received: {{item}}', html: '<p>Thanks {{firstName}}. We received {{amount}} for {{item}}. Reference {{ref}}.</p>', text: 'We received {{amount}} for {{item}}. Reference {{ref}}.' },
  premium_welcome: { name: 'Premium welcome', subject: 'You are Premium now', html: '<p>Your Premium access is active until {{until}}.</p>', text: 'Your Premium access is active until {{until}}.' },
  premium_expiring: { name: 'Premium expiring', subject: 'Your Premium ends on {{until}}', html: '<p>Your Premium ends on {{until}}. <a href="{{appUrl}}#premium">Renew</a></p>', text: 'Your Premium ends on {{until}}. Renew: {{appUrl}}#premium' },
  room_access: { name: 'Room access', subject: 'You are in: {{room}}', html: '<p>You now have access to {{room}}.</p>', text: 'You now have access to {{room}}.' },
  order_review: { name: 'Payment under review', subject: 'We are checking your payment', html: '<p>We received your payment details for {{item}} and will confirm shortly.</p>', text: 'We received your payment details for {{item}} and will confirm shortly.' },
  admin_invite: { name: 'Team invite', subject: 'You have been added to the VooSquare team', html: '<p>{{inviter}} added you to the VooSquare team as {{role}}. <a href="{{baseUrl}}/admin">Open the admin</a></p>', text: '{{inviter}} added you to the VooSquare team as {{role}}. {{baseUrl}}/admin' },
  announcement: { name: 'Broadcast', subject: '{{subject}}', html: '<h2>{{title}}</h2>{{{body_html}}}<p><a href="{{cta_url}}">{{cta_text}}</a></p>', text: '{{title}}\n\n{{body}}\n\n{{cta_url}}', marketing: 1 },
};

function fileTemplates() {
  try { return JSON.parse(fs.readFileSync(TEMPLATE_FILE, 'utf8')); } catch { return {}; }
}
function fileSequence() {
  try { return JSON.parse(fs.readFileSync(SEQUENCE_FILE, 'utf8')); } catch {
    return [{ key: 'welcome', delayHours: 0 }];
  }
}

const LEGACY_FILE = path.join(__dirname, 'emails', 'legacy-defaults.json');
/** Fingerprint of a template's content, to tell an untouched default from an owner edit. */
const tplHash = (t) => crypto.createHash('sha256').update(JSON.stringify([t.subject || '', t.preheader || '', t.html || '', t.text || ''])).digest('hex').slice(0, 32);
function legacyHashes() {
  try { return JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')).hashes || {}; } catch { return {}; }
}
const defaultTemplates = () => ({ ...FALLBACK, ...fileTemplates() });

function writeTemplate(key, t) {
  D.run(`INSERT INTO email_templates(key,name,subject,preheader,html,text,marketing,updated_at) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET name=excluded.name,subject=excluded.subject,preheader=excluded.preheader,html=excluded.html,text=excluded.text,marketing=excluded.marketing,updated_at=excluded.updated_at`,
  key, t.name || key, t.subject || key, t.preheader || '', t.html || '', t.text || '', t.marketing ? 1 : (TRANSACTIONAL.has(key) ? 0 : (t.marketing === 0 ? 0 : 1)), now());
}

/**
 * Load default templates into the database.
 * - Missing templates are added.
 * - A stored template that still matches a default we shipped (it was never edited) moves to the current default.
 * - Anything the owner edited is kept, unless force (Reset all).
 */
function seedTemplates(force = false) {
  const merged = defaultTemplates();
  const seeded = D.getSetting('email_default_hashes', {});
  const legacy = legacyHashes();
  for (const [key, t] of Object.entries(merged)) {
    const row = D.get('SELECT * FROM email_templates WHERE key=?', key);
    const fresh = tplHash(t);
    if (row && !force) {
      const cur = tplHash(row);
      const untouched = cur === seeded[key] || (legacy[key] || []).includes(cur);
      if (!untouched || cur === fresh) { if (cur === fresh) seeded[key] = fresh; continue; }
    }
    writeTemplate(key, t);
    seeded[key] = fresh;
  }
  D.setSetting('email_default_hashes', seeded);
  if (force || !D.get('SELECT 1 FROM email_sequence')) {
    if (force) D.run('DELETE FROM email_sequence');
    fileSequence().forEach((s, i) => D.run('INSERT OR REPLACE INTO email_sequence(key,delay_hours,enabled,sort) VALUES(?,?,1,?)', s.key, Number(s.delayHours) || 0, i));
  }
}

/** Put one template back to the current default design (admin: "Reset to new design"). */
function resetTemplate(key) {
  const t = defaultTemplates()[key];
  if (!t) return false;
  writeTemplate(key, t);
  const seeded = D.getSetting('email_default_hashes', {});
  seeded[key] = tplHash(t);
  D.setSetting('email_default_hashes', seeded);
  return true;
}
/** True when the stored template differs from the current default (the admin shows a reset button). */
function isCustomised(row) {
  const t = defaultTemplates()[row.key];
  return !!t && tplHash(row) !== tplHash(t);
}

/* Prices and plan facts for the templates, from settings, so editing Premium or the Inner Circle in admin updates every email. */
const money = (n) => { const v = Number(n) || 0; return '$' + (Number.isInteger(v) ? String(v) : v.toFixed(2)); };
function periodText(days) {
  const d = Number(days) || 0;
  if (!d) return 'once';
  if (d === 7) return 'a week';
  if (d >= 28 && d <= 31) return 'a month';
  if (d === 90 || d === 91) return 'a quarter';
  if (d === 365 || d === 366) return 'a year';
  return `every ${d} days`;
}
function planVars() {
  const pr = D.getSetting('premium', {});
  const ic = D.get("SELECT name, price_usd, period_days, seats FROM rooms WHERE slug='inner-circle'") || {};
  return {
    premium_name: pr.name || 'VooSquare Premium',
    premium_price: money(pr.price_usd || 20),
    premium_period: periodText(pr.period_days || 30),
    inner_circle_name: ic.name || 'Inner Circle with Dchessking',
    inner_circle_price: money(ic.price_usd || 299),
    inner_circle_period: periodText(ic.period_days == null ? 30 : ic.period_days),
    inner_circle_size: Number(ic.seats) > 0 ? `${Number(ic.seats)} seats` : 'A small room',
  };
}

function settingsEmail() {
  const s = D.getSetting('email', {});
  return {
    provider: (s.provider || config.email.provider || '').toLowerCase(),
    apiKey: s.api_key || config.email.apiKey,
    from: s.from || config.email.from,
    // Codes, receipts and support replies go out from their own address so they build their own reputation in Gmail,
    // apart from the welcome series and broadcasts. Falls back to the main From address.
    fromTransactional: s.from_transactional || config.email.fromTransactional || s.from || config.email.from,
    replyTo: s.reply_to || config.email.replyTo,
  };
}
// SAFE_COPY=1 (a staging or local copy of production data): never email real members; emails print to the log.
const configured = () => { if (config.safeCopy) return false; const e = settingsEmail(); return !!(e.provider && e.provider !== 'console' && e.apiKey); };

const unsubToken = (userId) => hmac(D.secret(), 'unsub:' + userId).slice(0, 24);

function baseVars(user) {
  const brand = D.getSetting('brand', {});
  const name = (user && user.name) || '';
  return {
    baseUrl: config.baseUrl, appUrl: config.baseUrl + '/app', year: String(new Date().getFullYear()),
    name, firstName: (name.split(' ')[0] || 'there'), email: user ? user.email : '',
    unsubscribeUrl: user ? `${config.baseUrl}/u/${user.id}/${unsubToken(user.id)}` : config.baseUrl,
    supportEmail: brand.support_email || 'support@voosquare.com',
    refLink: user && user.ref_code ? `${config.baseUrl}/r/${user.ref_code}` : config.baseUrl,
    ...planVars(),
  };
}

/** {{var}} is escaped for HTML; {{{var}}} is inserted raw. */
function fill(str, vars, html) {
  return String(str || '')
    .replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ''))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] != null ? (html ? esc(vars[k]) : String(vars[k])) : ''));
}

function render(key, vars) {
  const t = D.get('SELECT * FROM email_templates WHERE key=?', key) || { ...FALLBACK[key], key };
  if (!t || !t.html) throw new Error('Unknown email template: ' + key);
  return {
    subject: fill(t.subject, vars, false),
    html: fill(t.html, { ...vars, preheader: fill(t.preheader || '', vars, false) }, true),
    text: fill(t.text || '', vars, false).replace(/\n{3,}/g, '\n\n'),
    marketing: !!t.marketing && !TRANSACTIONAL.has(key),
    unsubscribeUrl: vars.unsubscribeUrl || '',
  };
}

/**
 * Extra headers. Marketing gets one-click unsubscribe (RFC 8058), which Gmail and Yahoo require from bulk senders.
 * Transactional mail gets none: a List-Unsubscribe header tells Gmail "this is a newsletter".
 */
function mailHeaders(msg) {
  if (!msg.marketing || !/\/u\/\d+\//.test(msg.unsubscribeUrl || '')) return null;
  return { 'List-Unsubscribe': `<${msg.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

async function deliver(to, msg) {
  const e = settingsEmail();
  const from = msg.marketing ? e.from : e.fromTransactional;
  const headers = mailHeaders(msg);
  const fromMatch = /^(.*)<(.+)>$/.exec(from || '');
  const fromName = fromMatch ? fromMatch[1].trim().replace(/^"|"$/g, '') : 'VooSquare';
  const fromEmail = fromMatch ? fromMatch[2].trim() : from;
  if (!configured()) {
    console.log(`[email:console] to=${to} subject="${msg.subject}"\n${msg.text.slice(0, 400)}`);
    return { ok: true, console: true };
  }
  let r;
  if (e.provider === 'resend') {
    r = await fetchJson('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: 'Bearer ' + e.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: msg.subject, html: msg.html, text: msg.text, reply_to: e.replyTo || undefined, headers: headers || undefined }),
    });
  } else if (e.provider === 'brevo') {
    r = await fetchJson('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': e.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ sender: { name: fromName, email: fromEmail }, to: [{ email: to }], subject: msg.subject, htmlContent: msg.html, textContent: msg.text, replyTo: e.replyTo ? { email: e.replyTo } : undefined, headers: headers || undefined }),
    });
  } else if (e.provider === 'postmark') {
    r = await fetchJson('https://api.postmarkapp.com/email', {
      method: 'POST', headers: { 'X-Postmark-Server-Token': e.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ From: from, To: to, Subject: msg.subject, HtmlBody: msg.html, TextBody: msg.text, ReplyTo: e.replyTo || undefined, MessageStream: 'outbound', Headers: headers ? Object.entries(headers).map(([Name, Value]) => ({ Name, Value })) : undefined }),
    });
  } else {
    throw new Error('Unknown EMAIL_PROVIDER: ' + e.provider + ' (use resend, brevo or postmark)');
  }
  if (!r.ok) throw new Error(`Email provider error ${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`);
  return { ok: true };
}

/** Send right away (used for codes and tests). */
async function sendNow(to, key, vars = {}, user = null) {
  const msg = render(key, { ...baseVars(user), ...vars });
  return deliver(to, msg);
}

/** Queue for the background worker. */
function queue(user, key, vars = {}, sendAt = now(), toEmail = null) {
  D.insert('email_queue', { user_id: user ? user.id : null, to_email: toEmail || (user && user.email), template: key, vars: JSON.stringify(vars), send_at: sendAt, status: 'queued' });
}

function startSequence(user) {
  const seq = D.all('SELECT * FROM email_sequence WHERE enabled=1 ORDER BY sort, delay_hours');
  for (const s of seq) queue(user, s.key, {}, now() + s.delay_hours * 3600_000);
}

let working = false;
async function work() {
  if (working) return;
  working = true;
  try {
    const due = D.all("SELECT * FROM email_queue WHERE status='queued' AND send_at<=? ORDER BY send_at LIMIT 25", now());
    for (const job of due) {
      const user = job.user_id ? D.get('SELECT * FROM users WHERE id=?', job.user_id) : null;
      try {
        if (user && user.banned) { D.run("UPDATE email_queue SET status='skipped',error='banned' WHERE id=?", job.id); continue; }
        if (user && user.deleted_at) { D.run("UPDATE email_queue SET status='skipped',error='deleted' WHERE id=?", job.id); continue; }
        const msg = render(job.template, { ...baseVars(user), ...json(job.vars, {}) });
        if (msg.marketing && user && !user.marketing) { D.run("UPDATE email_queue SET status='skipped',error='unsubscribed' WHERE id=?", job.id); continue; }
        await deliver(job.to_email, msg);
        D.run("UPDATE email_queue SET status='sent',sent_at=? WHERE id=?", now(), job.id);
      } catch (e) {
        const attempts = job.attempts + 1;
        D.run('UPDATE email_queue SET attempts=?,error=?,status=?,send_at=? WHERE id=?', attempts, String(e.message).slice(0, 500), attempts >= 4 ? 'failed' : 'queued', now() + attempts * 5 * 60_000, job.id);
      }
    }
    // Premium ending in the next 3 days: remind once per period.
    const soon = D.all('SELECT * FROM users WHERE premium_until>? AND premium_until<? AND premium_notice<>premium_until AND COALESCE(deleted_at,0)=0', now(), now() + 3 * 86400_000);
    for (const u of soon) {
      queue(u, 'premium_expiring', { until: require('./revenue').dateString(u.premium_until) }); // Lagos date (MN-9)
      D.run('UPDATE users SET premium_notice=premium_until WHERE id=?', u.id);
    }
  } finally { working = false; }
}
function startWorker() { setInterval(() => { work().catch((e) => console.error('[email worker]', e)); }, 20_000).unref(); setTimeout(() => work().catch(() => {}), 3000).unref(); }

module.exports = { seedTemplates, resetTemplate, isCustomised, render, sendNow, queue, startSequence, startWorker, configured, unsubToken, baseVars, TRANSACTIONAL, work };
