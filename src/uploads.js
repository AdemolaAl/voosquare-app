'use strict';
/*
 * Image sharing. Browsers compress before upload (max 1600px, WebP/JPEG, ~350 KB, plus a ~480px thumbnail),
 * so the server only checks and stores. Files live in config.uploadsDir (next to the database, on the volume).
 *  - Only JPEG, PNG and WebP are accepted, decided by magic bytes. The Content-Type header is ignored.
 *  - Width and height are read from the file itself.
 *  - Chat images are public by unguessable URL; support screenshots and payment proofs need the right login.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const D = require('./db');
const A = require('./auth');
const { now, rid, fail, limit, readBody } = require('./util');

const MAX_FULL = 600 * 1024;
const MAX_THUMB = 80 * 1024;
const PURPOSES = ['chat', 'support', 'proof', 'room', 'site', 'partner', 'aff_creative', 'aff_contest', 'kyc'];
/* Room pictures and site badges: uploaded by the team, shown to everyone (like chat images). */
const PUBLIC_PURPOSES = ['chat', 'room', 'site', 'partner', 'aff_creative', 'aff_contest'];
const TEAM_PURPOSES = { room: 'community', site: 'content', partner: 'academy', aff_creative: 'aff_admin', aff_contest: 'aff_admin' };
const EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const DAY = 86400_000;

const DEFAULTS = { who: 'everyone', daily_limit: 30, storage_mb: 200 };
const settings = () => ({ ...DEFAULTS, ...(D.getSetting('images', {}) || {}) });

fs.mkdirSync(config.uploadsDir, { recursive: true });

/* ---------------- file checks ---------------- */
/** Which image type the bytes really are (null for anything else, including SVG and GIF). */
function sniff(b) {
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
  if (b.length >= 8 && b.readUInt32BE(0) === 0x89504E47 && b.readUInt32BE(4) === 0x0D0A1A0A) return 'image/png';
  return null;
}

/** Pixel size from the file header. Returns null when it cannot be read. */
function dimensions(b, mime) {
  try {
    if (mime === 'image/png') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    if (mime === 'image/webp') {
      const kind = b.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
      if (kind === 'VP8L') { const bits = b.readUInt32LE(21); return { w: 1 + (bits & 0x3FFF), h: 1 + ((bits >> 14) & 0x3FFF) }; }
      if (kind === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3FFF, h: b.readUInt16LE(28) & 0x3FFF };
      return null;
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xFF) { i++; continue; }
        const marker = b[i + 1];
        if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
        const len = b.readUInt16BE(i + 2);
        if ((marker >= 0xC0 && marker <= 0xCF) && ![0xC4, 0xC8, 0xCC].includes(marker)) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5) };
        i += 2 + len;
      }
    }
  } catch { /* fall through */ }
  return null;
}

const fileFor = (id, ext, thumb) => path.join(config.uploadsDir, id.slice(0, 2), `${id}${thumb ? '_t' : ''}.${ext}`);
const urlFor = (u, thumb) => `/u/${u.id}${thumb ? '_t' : ''}.${EXT[u.mime]}`;

/** What the client gets back for an attached image. */
function publicUpload(u) {
  if (!u || u.deleted) return null;
  return { id: u.id, url: urlFor(u, false), thumb_url: u.thumb ? urlFor(u, true) : urlFor(u, false), w: u.w, h: u.h, mime: u.mime, bytes: u.bytes };
}
/** Map of id -> public upload for a list of ids (one query). */
function lookup(ids) {
  ids = [...new Set(ids.filter(Boolean))];
  if (!ids.length) return {};
  const rows = D.all(`SELECT * FROM uploads WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids);
  return Object.fromEntries(rows.map((u) => [u.id, publicUpload(u)]));
}

/* ---------------- who may upload ---------------- */
/** Why this member cannot share images in community rooms right now ('' when they can). */
function chatBlockReason(user) {
  if (!user) return 'Log in first.';
  if (user.muted_until > now()) return 'You are muted for a while.';
  const s = settings();
  if (A.can(user, 'community')) return '';
  if (s.who === 'team') return 'Only the team can share images right now.';
  if (s.who === 'premium' && !user.premium) return 'Sharing images is a Premium feature.';
  return '';
}

function checkQuota(user) {
  if (user.staff) return;
  const s = settings();
  const day = D.get('SELECT COUNT(*) n FROM uploads WHERE user_id=? AND created_at>?', user.id, now() - DAY).n;
  if (day >= Number(s.daily_limit || DEFAULTS.daily_limit)) fail(429, `You can share up to ${s.daily_limit} images a day. Try again tomorrow.`);
  const capMb = Number(s.storage_mb) || 0;
  if (capMb > 0) {
    const used = D.get('SELECT COALESCE(SUM(bytes+thumb),0) b FROM uploads WHERE user_id=? AND deleted=0', user.id).b;
    if (used > capMb * 1024 * 1024) fail(429, 'You have reached your image storage limit. Delete some older images first.');
  }
}

/* ---------------- create / attach / delete ---------------- */
/**
 * Body: the full image bytes followed by the thumbnail bytes. Header x-thumb-bytes says how long the thumbnail is.
 * Raw binary instead of base64 or multipart: no 33% overhead and nothing to parse.
 */
async function create(ctx) {
  const user = A.requireUser(ctx);
  const purpose = PURPOSES.includes(ctx.query.purpose) ? ctx.query.purpose : 'chat';
  if (purpose === 'chat') { const why = chatBlockReason(user); if (why) fail(403, why); }
  if (TEAM_PURPOSES[purpose] && !A.can(user, TEAM_PURPOSES[purpose])) fail(403, "You don't have access to change these pictures.");
  limit('upload-min:' + user.id, user.staff ? 30 : 8, 60_000);
  checkQuota(user);
  const thumbLen = Math.max(0, Math.floor(Number(ctx.req.headers['x-thumb-bytes']) || 0));
  if (thumbLen > MAX_THUMB) fail(413, 'The preview image is too large.');
  const raw = await readBody(ctx.req, MAX_FULL + MAX_THUMB + 1024);
  if (!raw.length || thumbLen >= raw.length) fail(400, 'Send an image.');
  const full = raw.subarray(0, raw.length - thumbLen);
  const thumb = thumbLen ? raw.subarray(raw.length - thumbLen) : null;
  if (full.length > MAX_FULL) fail(413, 'That image is too large after compression. Try a smaller one.');
  const mime = sniff(full);
  if (!mime) fail(415, 'Only JPEG, PNG and WebP images can be shared.');
  if (thumb && sniff(thumb) !== mime) fail(415, 'The preview image is not valid.');
  const dim = dimensions(full, mime);
  if (!dim || !dim.w || !dim.h || dim.w > 4096 || dim.h > 4096) fail(415, 'That image could not be read.');
  const id = rid(12);
  fs.mkdirSync(path.dirname(fileFor(id, EXT[mime])), { recursive: true });
  fs.writeFileSync(fileFor(id, EXT[mime]), full);
  if (thumb) fs.writeFileSync(fileFor(id, EXT[mime], true), thumb);
  D.insert('uploads', {
    id, user_id: user.id, sha: crypto.createHash('sha256').update(full).digest('hex'), mime, bytes: full.length,
    w: dim.w, h: dim.h, thumb: thumb ? thumb.length : 0, purpose, created_at: now(),
  });
  return { upload: publicUpload(D.get('SELECT * FROM uploads WHERE id=?', id)) };
}

/** Attach an uploaded image to something (a message, a ticket message, an order). Fails if it is not this user's fresh upload. */
function claim(id, user, purposes, ref) {
  if (!id) return null;
  const u = D.get('SELECT * FROM uploads WHERE id=? AND deleted=0', String(id));
  if (!u || u.user_id !== user.id || !purposes.includes(u.purpose) || u.attached_to) fail(400, 'That image is no longer available. Add it again.');
  D.run('UPDATE uploads SET attached_to=? WHERE id=?', ref, u.id);
  return u;
}
/** Remove an image from view. Files stay 7 days (moderation), then the hourly cleanup removes them. */
function softDelete(id) { if (id) D.run('UPDATE uploads SET deleted=? WHERE id=? AND deleted=0', now(), String(id)); }

/** Hourly: drop uploads nobody attached within 24h, and purge files deleted more than 7 days ago. */
function cleanup() {
  const t = now();
  D.run("UPDATE uploads SET deleted=? WHERE attached_to='' AND deleted=0 AND created_at<?", t, t - DAY);
  for (const u of D.all('SELECT * FROM uploads WHERE deleted>0 AND deleted<? AND purged=0 LIMIT 2000', t - 7 * DAY)) {
    for (const th of [false, true]) { try { fs.unlinkSync(fileFor(u.id, EXT[u.mime], th)); } catch { /* already gone */ } }
    D.run('UPDATE uploads SET purged=1 WHERE id=?', u.id);
  }
}

function stats() {
  const live = D.get('SELECT COUNT(*) n, COALESCE(SUM(bytes+thumb),0) b FROM uploads WHERE deleted=0');
  const disk = D.get('SELECT COALESCE(SUM(bytes+thumb),0) b FROM uploads WHERE purged=0');
  const by = D.all('SELECT purpose, COUNT(*) n, COALESCE(SUM(bytes+thumb),0) b FROM uploads WHERE deleted=0 GROUP BY purpose');
  const today = D.get('SELECT COUNT(*) n FROM uploads WHERE created_at>?', now() - DAY).n;
  return { count: live.n, bytes: live.b, disk_bytes: disk.b, today, by_purpose: by, dir: config.uploadsDir };
}

/* ---------------- serving ---------------- */
/** Who may see a support screenshot or a payment proof. */
function canView(u, viewer) {
  if (PUBLIC_PURPOSES.includes(u.purpose)) return true;
  if (!viewer) return false;
  if (viewer.id === u.user_id) return true;
  if (u.purpose === 'proof') return A.can(viewer, 'payments');
  // Affiliate identity documents: the affiliate, program admins and finance only.
  if (u.purpose === 'kyc') return A.can(viewer, 'aff_admin') || A.can(viewer, 'aff_finance') || A.can(viewer, 'payments');
  if (u.purpose === 'support') {
    const m = /^tmsg:(\d+)$/.exec(u.attached_to || '');
    if (!m) return false;
    const t = D.get('SELECT t.user_id, t.product_id, tm.internal FROM ticket_messages tm JOIN tickets t ON t.id=tm.ticket_id WHERE tm.id=?', Number(m[1]));
    if (!t) return false;
    if (A.can(viewer, 'support')) {
      // Agents see screenshots only for the products in their support scope.
      const s = viewer.support_scope || [];
      return viewer.perms.includes('*') || s.includes('*') || s.map(Number).includes(t.product_id);
    }
    return !t.internal && t.user_id === viewer.id;
  }
  return false;
}

function serve(ctx) {
  const m = /^([A-Za-z0-9_-]{16})(_t)?\.(webp|jpg|png)$/.exec(ctx.params.file || '');
  const res = ctx.res;
  ctx.handled = true;
  const notFound = () => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); res.end('Not found'); };
  if (!m) return notFound();
  const u = D.get('SELECT * FROM uploads WHERE id=?', m[1]);
  if (!u || u.deleted || EXT[u.mime] !== m[3] || (m[2] && !u.thumb)) return notFound();
  if (!canView(u, ctx.user)) return notFound();
  const etag = `"${u.sha.slice(0, 32)}${m[2] ? 't' : ''}"`;
  const cache = PUBLIC_PURPOSES.includes(u.purpose) ? 'public, max-age=31536000, immutable' : 'private, max-age=31536000, immutable';
  if (ctx.req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache }); return res.end(); }
  let body;
  try { body = fs.readFileSync(fileFor(u.id, m[3], !!m[2])); } catch { return notFound(); }
  res.writeHead(200, {
    'Content-Type': u.mime, 'Content-Length': body.length, 'Cache-Control': cache, ETag: etag,
    'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="voosquare-${u.id}.${m[3]}"`,
    'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(ctx.req.method === 'HEAD' ? undefined : body);
}

module.exports = { create, claim, softDelete, cleanup, stats, serve, lookup, publicUpload, chatBlockReason, settings, sniff, dimensions, DEFAULTS, MAX_FULL, MAX_THUMB };
