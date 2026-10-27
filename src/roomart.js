'use strict';
/*
 * Room pictures and the app store links.
 *  - Every seeded room has house artwork in public/assets/rooms/<slug>.webp (square) and <slug>-cover.webp (wide),
 *    drawn by tools/room-art. A picture or cover the team uploads always wins; removing it brings the artwork back.
 *  - The artwork is matched by the room's slug, which never changes when a room is renamed, so older databases get it
 *    without any write and an owner's upload is never overwritten.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const D = require('./db');
const up = require('./uploads');
const { fail, clean } = require('./util');

const DIR = path.join(__dirname, '..', 'public', 'assets', 'rooms');

/** slug -> { image, cover } for the artwork files that exist. A short content hash busts the 7-day asset cache. */
const ART = (() => {
  const out = {};
  let files = [];
  try { files = fs.readdirSync(DIR); } catch { return out; }
  const ver = (f) => crypto.createHash('sha1').update(fs.readFileSync(path.join(DIR, f))).digest('hex').slice(0, 8);
  for (const f of files) {
    const m = /^([a-z0-9-]+?)(-cover)?\.webp$/.exec(f);
    if (!m) continue;
    const slot = out[m[1]] || (out[m[1]] = { image: '', cover: '' });
    slot[m[2] ? 'cover' : 'image'] = `/assets/rooms/${f}?v=${ver(f)}`;
  }
  return out;
})();

const defaults = (slug) => ART[slug] || { image: '', cover: '' };

/** Picture and cover URLs for a room row: upload first, then the house artwork, then nothing (the icon shows). */
function roomImages(r) {
  const files = up.lookup([r.image_upload, r.cover_upload]);
  const def = defaults(r.slug);
  const pic = files[r.image_upload];
  const cov = files[r.cover_upload];
  return {
    image: pic ? pic.thumb_url : def.image,
    cover: cov ? cov.url : def.cover,
    image_custom: !!pic, cover_custom: !!cov,
    image_default: def.image, cover_default: def.cover,
  };
}

/* Upload rules for each slot. The browser compresses before upload, so sizes here are what arrives on the server. */
const SLOTS = {
  image_upload: { label: 'picture', minW: 96, minH: 96, check: (u) => u.w / u.h >= 0.6 && u.w / u.h <= 1.67, shape: 'close to square' },
  cover_upload: { label: 'cover', minW: 600, minH: 150, check: (u) => u.w / u.h >= 1.6, shape: 'wide (at least 16:10, best 3:1)' },
};

/**
 * Validate the picture and cover a room save sends. Returns { changes, apply(roomId) }:
 * changes are the column values to write; apply() attaches new uploads to the room and retires replaced ones.
 * An unchanged value is ignored, so saving a room without touching its pictures never needs a fresh upload.
 */
function prepareRoomImages(me, body, current) {
  const changes = {};
  const claims = [];
  const retire = [];
  for (const [k, rule] of Object.entries(SLOTS)) {
    if (body[k] === undefined || body[k] === null) continue;
    const v = String(body[k] || '').trim();
    const cur = (current && current[k]) || '';
    if (v === cur) continue;
    if (v) {
      if (!/^[A-Za-z0-9_-]{16}$/.test(v)) fail(400, `That ${rule.label} is no longer available. Upload it again.`);
      const u = D.get('SELECT * FROM uploads WHERE id=? AND deleted=0', v);
      if (!u || u.purpose !== 'room' || u.user_id !== me.id || u.attached_to) fail(400, `That ${rule.label} is no longer available. Upload it again.`);
      if (u.w < rule.minW || u.h < rule.minH) fail(400, `The ${rule.label} is too small. Use an image at least ${rule.minW} by ${rule.minH} pixels.`);
      if (!rule.check(u)) fail(400, `The ${rule.label} should be ${rule.shape}.`);
      claims.push(v);
    }
    if (cur) retire.push(cur);
    changes[k] = v;
  }
  return {
    changes,
    apply(roomId) {
      for (const id of claims) D.run('UPDATE uploads SET attached_to=? WHERE id=?', 'room:' + roomId, id);
      for (const id of retire) up.softDelete(id);
    },
  };
}

/* ---------------- app store links (website + member app) ---------------- */
const APPS_DEFAULT = { play_url: '', play_badge_upload: '', app_store_url: '', app_store_badge_upload: '', app_store_status: 'soon' };
const STORE = {
  play: { url: 'play_url', badge: 'play_badge_upload', prefix: 'https://play.google.com/', name: 'Google Play' },
  app_store: { url: 'app_store_url', badge: 'app_store_badge_upload', prefix: 'https://apps.apple.com/', name: 'App Store' },
};

/** Check what the admin saved. Links must be the store's own https address; badges must be images the team uploaded. */
function cleanApps(me, value, old) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Send the app store settings.');
  old = { ...APPS_DEFAULT, ...(old || {}) };
  const out = { ...APPS_DEFAULT };
  const claims = [];
  for (const s of Object.values(STORE)) {
    const url = clean(value[s.url], 400);
    if (url) {
      let ok = false;
      try { const u = new URL(url); ok = u.protocol === 'https:' && url.startsWith(s.prefix) && !/[\s"'<>]/.test(url); } catch { ok = false; }
      if (!ok) fail(400, `The ${s.name} link must start with ${s.prefix}`);
    }
    out[s.url] = url;
    const badge = String(value[s.badge] || '').trim();
    if (badge && badge !== old[s.badge]) {
      const u = /^[A-Za-z0-9_-]{16}$/.test(badge) ? D.get('SELECT * FROM uploads WHERE id=? AND deleted=0', badge) : null;
      if (!u || u.purpose !== 'site' || u.user_id !== me.id || u.attached_to) fail(400, `That ${s.name} badge is no longer available. Upload it again.`);
      claims.push(badge);
    }
    if (old[s.badge] && old[s.badge] !== badge) up.softDelete(old[s.badge]);
    out[s.badge] = badge;
  }
  out.app_store_status = out.app_store_url ? 'live' : 'soon';
  for (const id of claims) D.run('UPDATE uploads SET attached_to=? WHERE id=?', 'site:apps', id);
  return out;
}

/** What the website and the app get: links and badge image URLs only. */
function publicApps() {
  const v = { ...APPS_DEFAULT, ...(D.getSetting('apps', {}) || {}) };
  const files = up.lookup([v.play_badge_upload, v.app_store_badge_upload]);
  const badge = (id) => { const f = files[id]; return f ? { url: f.url, w: f.w, h: f.h } : null; };
  return {
    play_url: v.play_url || '', play_badge: badge(v.play_badge_upload),
    app_store_url: v.app_store_url || '', app_store_badge: badge(v.app_store_badge_upload),
    app_store_status: v.app_store_url ? 'live' : 'soon',
  };
}
/** Admin view: the stored ids plus preview URLs. */
function adminApps() {
  const v = { ...APPS_DEFAULT, ...(D.getSetting('apps', {}) || {}) };
  const p = publicApps();
  return { ...v, play_badge: p.play_badge, app_store_badge: p.app_store_badge };
}

module.exports = { ART, defaults, roomImages, prepareRoomImages, SLOTS, cleanApps, publicApps, adminApps, APPS_DEFAULT };
