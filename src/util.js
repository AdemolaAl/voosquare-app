'use strict';
const crypto = require('node:crypto');

const now = () => Date.now();
const rid = (n = 16) => crypto.randomBytes(n).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const hmac = (key, s, alg = 'sha256', enc = 'hex') => crypto.createHmac(alg, String(key)).update(s).digest(enc);

function safeEq(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, message, extra) => { throw new HttpError(status, message, extra); };

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore bad cookie */ }
    }
  }
  return out;
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (over) {
        // Keep reading (and dropping) a little so the client gets the 413 answer instead of a reset connection; give up on huge bodies.
        if (size > limit + 8_000_000) req.destroy();
      } else if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(new HttpError(413, 'That request is too large.'));
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------- rate limiting (in memory, per process) ---------- */
const buckets = new Map();
function limit(key, max, windowMs) {
  const t = now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n++;
  if (b.n > max) fail(429, 'Too many requests. Wait a moment and try again.');
}
setInterval(() => { const t = now(); for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k); }, 60_000).unref();

/* ---------- live updates (Server-Sent Events) ---------- */
const channels = new Map(); // channel -> Set(res)
const streams = new Set(); // every open stream; res._vs = { list, uid, sess, check }
/**
 * Subscribe a response to channels. `meta.uid` and `meta.sess` (session token hash) let the server close the stream
 * when the user is banned or the session ends; `meta.check()` is called every STREAM_RECHECK_MS and closes the
 * stream when it returns false (session expired or revoked, access lost).
 */
function subscribe(res, list, meta = {}) {
  res._vs = { list, uid: meta.uid || null, sess: meta.sess || null, check: meta.check || null, ip: meta.ip || '' };
  streams.add(res);
  for (const ch of list) {
    if (!channels.has(ch)) channels.set(ch, new Set());
    channels.get(ch).add(res);
    if (ch.startsWith('room:')) presenceChanged(ch);
  }
  res.on('close', () => unsubscribe(res));
}
function unsubscribe(res) {
  if (!streams.delete(res)) return;
  for (const ch of res._vs.list) {
    const set = channels.get(ch);
    if (set) { set.delete(res); if (!set.size) channels.delete(ch); }
    if (ch.startsWith('room:')) presenceChanged(ch);
  }
}
/** Close every open stream `pred(meta)` matches: no more events reach it. The browser reconnects with what it may still see. */
function closeStreams(pred, reason = 'revoked') {
  let n = 0;
  for (const res of [...streams]) {
    if (!pred(res._vs)) continue;
    unsubscribe(res);
    try { res.write(`event: bye\ndata: ${JSON.stringify({ reason })}\n\n`); res.end(); } catch { /* client gone */ }
    n++;
  }
  return n;
}
/* Open-stream caps (PT-3): per client address, per signed-in member and for the whole server. Env overrides for tests. */
const STREAM_CAPS = {
  ip: Number(process.env.STREAM_MAX_PER_IP) || 40,
  user: Number(process.env.STREAM_MAX_PER_USER) || 12,
  total: Number(process.env.STREAM_MAX_TOTAL) || 5000,
};
/** Why a new stream for this address / member would go over a cap ('' = fine). */
function streamCapReason(ip, uid) {
  if (streams.size >= STREAM_CAPS.total) return 'total';
  let byIp = 0; let byUser = 0;
  for (const res of streams) { if (ip && res._vs.ip === ip) byIp++; if (uid && res._vs.uid === uid) byUser++; }
  if (uid && byUser >= STREAM_CAPS.user) return 'user';
  if (byIp >= STREAM_CAPS.ip) return 'ip';
  return '';
}
const closeUserStreams = (userId, reason) => closeStreams((m) => m.uid === userId, reason);
const closeSessionStreams = (sessHash, reason) => closeStreams((m) => !!sessHash && m.sess === sessHash, reason);
/** Send an event to every open stream on `channel`. `skip(meta)` (optional) leaves out streams it returns true for, for
 * example members who blocked the author of a new message (src/ugc.js). */
function publish(channel, event, data, skip) {
  const set = channels.get(channel);
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) { if (skip && skip(res._vs || {})) continue; try { res.write(msg); } catch { /* client gone */ } }
}
/** Ticket events go to a per-product staff channel so agents only hear about products in their scope. */
const publishTicket = (productId, data) => publish('staff:p' + productId, 'ticket', data);
const listeners = (channel) => (channels.get(channel)?.size || 0);
/** Distinct signed-in people with the channel open (several tabs count once). */
function presence(channel) {
  const set = channels.get(channel);
  if (!set) return 0;
  const ids = new Set();
  for (const res of set) if (res._vs && res._vs.uid) ids.add(res._vs.uid);
  return ids.size;
}
/* Room presence: when the number of people in a room changes, tell everyone (counts only, never names), debounced. */
const PRESENCE_DEBOUNCE_MS = 1500;
const presenceTimers = new Map(); const presenceSent = new Map();
function presenceChanged(ch) {
  if (presenceTimers.has(ch)) return;
  presenceTimers.set(ch, setTimeout(() => {
    presenceTimers.delete(ch);
    const n = presence(ch);
    if (presenceSent.get(ch) === n) return;
    if (n) presenceSent.set(ch, n); else presenceSent.delete(ch);
    publish('community', 'presence', { room_id: Number(ch.slice(5)), online: n });
  }, PRESENCE_DEBOUNCE_MS).unref());
}
setInterval(() => {
  for (const res of streams) { try { res.write(': ping\n\n'); } catch { /* ignore */ } }
}, 25_000).unref();
/* Sessions can end without a request (expiry, a row deleted elsewhere): re-check every open stream regularly. */
const RECHECK_MS = Number(process.env.STREAM_RECHECK_MS) || 60_000;
setInterval(() => {
  closeStreams((m) => { if (!m.check) return false; try { return !m.check(); } catch { return true; } }, 'expired');
}, RECHECK_MS).unref();

/* ---------- misc ---------- */
const isEmail = (s) => typeof s === 'string' && s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
const clean = (s, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60) || rid(4).toLowerCase();
const json = (s, def) => { if (s == null || s === '') return def; try { return JSON.parse(s); } catch { return def; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bool = (v, def = 0) => (v === undefined || v === null ? def : (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0));
const mask = (v) => { v = String(v || ''); return v ? '••••' + v.slice(-4) : ''; };
/** Links admins and visitors can set: http(s), site-relative (/x, #x) or mailto only. Anything else (javascript:, data:) becomes ''. */
function safeUrl(u, max = 500) {
  u = clean(u, max);
  if (!u || /[\s<>"'`\\]/.test(u)) return '';
  if (/^https?:\/\/[^/]/i.test(u)) return u;
  if (u.startsWith('//')) return 'https:' + u;
  if (u.startsWith('/') || u.startsWith('#')) return u;
  if (/^mailto:[^\s]+$/i.test(u)) return u;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(u)) return 'https://' + u;
  return '';
}
/** Only absolute http(s) URLs (used for server-side calls and OAuth redirects). */
const httpUrl = (u, max = 500) => { u = clean(u, max); return /^https?:\/\/[^/\s]/i.test(u) && !/[\s<>"'`\\]/.test(u) ? u : ''; };
/** CSS colours admins can set: #hex only. */
const safeColor = (c, def) => { c = String(c || '').trim(); return /^#[0-9a-f]{3,8}$/i.test(c) ? c : def; };
/** Client IP. X-Forwarded-For is trusted only for the number of proxy hops in TRUST_PROXY (src/config.js): with n trusted
 * hops the client is the n-th entry from the right (each trusted proxy appends the address it saw; anything further left
 * came from the client and can be faked). With no trusted proxy the header is ignored and the socket address is used. */
function clientIp(req, hops = require('./config').trustProxy) {
  const sock = String((req.socket && req.socket.remoteAddress) || '');
  if (!hops) return sock;
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!xff.length) return sock;
  return xff[Math.max(0, xff.length - hops)];
}

async function fetchJson(url, opts = {}, timeoutMs = 12_000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: res.ok, status: res.status, data };
  } finally { clearTimeout(t); }
}

module.exports = {
  now, rid, sha256, hmac, safeEq, HttpError, fail, parseCookies, readBody, limit,
  subscribe, publish, publishTicket, listeners, presence, closeStreams, closeUserStreams, closeSessionStreams, streamCapReason, bool, isEmail, clean, slugify, json, esc, mask, fetchJson,
  safeUrl, httpUrl, safeColor, clientIp,
};
