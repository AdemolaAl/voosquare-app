'use strict';
/*
 * Affiliate tracking: clicks, the first-party cookie, attribution at Voo ID creation, coupons, links and deep links.
 *
 *  GET /a/:code (any host) and /go/:code (affiliate.* host): records the click (rate limited, bot user agents skipped),
 *  sets `vs_aff=<click uid>` on the parent domain (HttpOnly, SameSite=Lax, Secure on https, 60 days by default) and
 *  redirects to the offer, passing `ref`, `vclick` and sub1..sub5 so tools can hand them back to /oauth/authorize.
 *  A code is either a saved link's code or the affiliate's own code (their Voo ID referral code).
 *
 *  Attribution happens once, when the Voo ID is created (sign-up on VooSquare or through any tool's "Continue with
 *  VooSquare"), and is locked for life. Order of evidence: coupon typed at sign-up, then the last tracked click inside the
 *  attribution window, then a VooSquare referral code belonging to an affiliate. A person who already had a Voo ID is never
 *  attributed. One ledger: users.referred_by is set to the affiliate's Voo ID when it was empty.
 */
const config = require('../config');
const D = require('../db');
const C = require('./core');
const F = require('./fraud');
const N = require('./notify');
const { now, rid, limit, clean, safeEq, hmac } = require('../util');

const DAY = C.DAY;
const BOT_UA = /bot\b|crawl|spider|slurp|facebookexternalhit|facebot|whatsapp|telegrambot|twitterbot|linkedinbot|discordbot|preview|curl\/|wget|python-|go-http|headless|monitor|pingdom|uptime|lighthouse|httpclient|okhttp|java\//i;
const SUB_RE = /^[A-Za-z0-9_\-.{}]{0,64}$/;
// An unreplaced tracker macro ({clickid}, {sub1}) is empty, never the literal word: postbacks would send cid=clickid.
const cleanSub = (v) => { v = String(v ?? '').trim().slice(0, 64); if (/[{}]/.test(v)) return ''; return /^[A-Za-z0-9_\-.]*$/.test(v) ? v : v.replace(/[^A-Za-z0-9_\-.]/g, ''); };

/* ------------------------------------------------------------------ cookies */
/** Parent domain for the tracking cookie: voosquare.com covers affiliate.voosquare.com, go.voosquare.com and the app. */
function cookieDomain() {
  try {
    const h = new URL(config.baseUrl).hostname;
    if (!h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.endsWith('.localhost')) return '';
    const parts = h.split('.');
    // up.railway.app and similar public suffixes: keep the full host.
    // Shared platform domains are public suffixes (browsers refuse a cookie for vercel.app): keep the full host there.
    if (/(^|\.)(up\.railway\.app|railway\.app|vercel\.app|herokuapp\.com|onrender\.com|fly\.dev|netlify\.app|pages\.dev)$/.test(h)) return h;
    // Country second levels (voosquare.com.ng, voosquare.co.uk): the site is the last three labels, not com.ng.
    if (parts.length >= 3 && /^[a-z]{2}$/.test(parts[parts.length - 1]) && /^(com|co|org|net|gov|edu|ac|ltd|plc|sch)$/.test(parts[parts.length - 2])) return parts.slice(-3).join('.');
    return parts.slice(-2).join('.');
  } catch { return ''; }
}
function cookie(name, value, maxAgeSec, { httpOnly = true } = {}) {
  const dom = cookieDomain();
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax${httpOnly ? '; HttpOnly' : ''}${dom ? '; Domain=.' + dom : ''}${config.secure ? '; Secure' : ''}`;
}
const sign = (v) => `${v}.${hmac(D.secret(), 'affparent|' + v).slice(0, 16)}`;
const unsign = (s) => { const [v, sig] = String(s || '').split('.'); return v && safeEq(sig, hmac(D.secret(), 'affparent|' + v).slice(0, 16)) ? v : null; };

/* ------------------------------------------------------------------ destinations */
/* Home domains of the Voo tools, for tools whose address is not set in Products yet. */
const TOOL_DOMAINS = { spyvoo: 'spyvoo.com', joinvoo: 'joinvoo.com', vooads: 'vooads.com', replyvoo: 'replyvoo.com', castvoo: 'castvoo.com', landvoo: 'landvoo.com', gatevoo: 'gatevoo.com' };
function approvedHosts() {
  const hosts = new Set();
  try { hosts.add(new URL(config.baseUrl).hostname); } catch { /* ignore */ }
  const root = cookieDomain(); if (root) hosts.add(root);
  // The tool domains match the link builder's destinations: every product in the program that earns commission (Affleego
  // never; Gatevoo only once it is switched on in Deals and products). A tool with no address yet uses its own domain.
  const live = new Set(C.productList().filter((p) => p.commissionable && p.cap_bp > 0).map((p) => p.key));
  for (const p of D.all('SELECT slug, url FROM products WHERE hub=0')) {
    if (!C.inProgram(p.slug) || !live.has(p.slug)) continue;
    let h = ''; try { h = p.url ? new URL(p.url).hostname.replace(/^www\./, '') : ''; } catch { h = ''; }
    hosts.add(h || TOOL_DOMAINS[p.slug] || `${p.slug}.com`);
  }
  for (const h of C.settings().link_domains || []) hosts.add(String(h).toLowerCase().replace(/^www\./, ''));
  return hosts;
}
/** A deep link must be http(s) on VooSquare or a Zedapex tool domain (or a subdomain of one). Returns '' when not allowed. */
function deepLinkOk(u) {
  let url; try { url = new URL(String(u || '')); } catch { return ''; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !config.prod)) return '';
  if (url.username || url.password) return '';
  const h = url.hostname.toLowerCase().replace(/^www\./, '');
  for (const ok of approvedHosts()) if (h === ok || h.endsWith('.' + ok)) return url.toString();
  return '';
}
/** Landing page for a product key. VooSquare pages for Premium and rooms, the tool's own site otherwise. */
function landingFor(key) {
  const base = config.baseUrl;
  if (!key || key === 'home' || key === 'smart' || !C.inProgram(key)) return base + '/'; // Affleego is not a program destination
  if (key === 'premium') return base + '/premium';
  if (key === 'room' || key === 'inner-circle') return base + '/community';
  if (key === 'affiliates' || key === 'recruit') return base + '/affiliates#/join';
  const p = D.get('SELECT slug, url FROM products WHERE slug=?', key);
  if (p && p.url) return p.url;
  return `${base}/?product=${encodeURIComponent(key)}`;
}
function deviceOf(ua) { ua = String(ua || ''); return /iPad|Tablet|PlayBook|Silk/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone|iPod|Opera Mini|IEMobile/i.test(ua) ? 'mobile' : 'desktop'; }

/* ------------------------------------------------------------------ links and codes */
function resolve(code) {
  code = String(code || '').trim();
  if (!/^[A-Za-z0-9_-]{3,24}$/.test(code)) return null;
  const link = D.get('SELECT * FROM aff_links WHERE code=?', code);
  if (link) { const a = C.byId(link.affiliate_id); return a ? { a, link } : null; }
  const a = C.hydrate(D.get('SELECT * FROM aff_affiliates WHERE code=?', code.toLowerCase()));
  return a ? { a, link: null } : null;
}
const uniqueLinkCode = () => { for (;;) { const c = rid(5).replace(/[^A-Za-z0-9]/g, '').slice(0, 6); if (c.length >= 5 && !D.get('SELECT 1 FROM aff_links WHERE code=?', c) && !D.get('SELECT 1 FROM aff_affiliates WHERE code=?', c.toLowerCase())) return c; } };

/** The public tracking URL for an affiliate (and an optional saved link / product / subs). */
function trackingUrl(a, { link = null, product = '', subs = {}, deep = '', click = '' } = {}) {
  const u = new URL(`${config.baseUrl}/a/${link ? link.code : a.code}`);
  if (product && !link) u.searchParams.set('p', product);
  for (let i = 1; i <= 5; i++) if (subs['sub' + i]) u.searchParams.set('sub' + i, subs['sub' + i]);
  if (deep) u.searchParams.set('url', deep);
  if (click) u.searchParams.set('click_id', click);
  return u.toString().replace(/%7B/g, '{').replace(/%7D/g, '}');
}

/* ------------------------------------------------------------------ the click */
/** GET /a/:code and /go/:code. Always redirects; records the click and sets the cookie when it is a real visitor. */
function click(ctx) {
  const q = ctx.query;
  const r = resolve(ctx.params.code);
  if (!r || ['rejected', 'closed'].includes(r.a.status)) return ctx.redirect(config.baseUrl + '/');
  const { a, link } = r;
  const recruit = q.join === '1' || q.p === 'recruit';
  const asked = clean(q.p || (link && link.product_key) || '', 40).toLowerCase();
  const product = recruit ? 'recruit' : C.inProgram(asked) ? asked : ''; // Affleego is not a program product: counted as a VooSquare click
  let dest = deepLinkOk(q.url) || (link && link.dest_url ? deepLinkOk(link.dest_url) : '') || landingFor(product);
  const subs = {}; for (let i = 1; i <= 5; i++) subs['sub' + i] = cleanSub(q['sub' + i] !== undefined ? q['sub' + i] : link ? link['sub' + i] : '');
  const ext = cleanSub(q.click_id || q.clickid || q.cid || '');
  const ua = String(ctx.req.headers['user-agent'] || '');
  let uid = '';
  const isBot = !ua || BOT_UA.test(ua);
  let allowed = !isBot;
  if (allowed) { try { limit('aff-click:' + ctx.ip, C.settings().click_rate_per_min || 60, 60_000); } catch { allowed = false; } }
  if (allowed) {
    uid = rid(12).replace(/[^A-Za-z0-9]/g, 'x');
    const ref = String(ctx.req.headers.referer || ctx.req.headers.referrer || '');
    let refHost = ''; try { refHost = ref ? new URL(ref).hostname : ''; } catch { /* ignore */ }
    D.insert('aff_clicks', {
      uid, affiliate_id: a.id, link_id: link ? link.id : null, product_key: product, ...subs, ext_click_id: ext,
      ip_hash: C.hashOf('ip', ctx.ip), net_hash: C.hashOf('net', F.ipNet(ctx.ip)), ua_hash: C.hashOf('ua', ua), fp_hash: '', country: F.edgeCountry(ctx.req),
      device: deviceOf(ua), referrer: refHost.slice(0, 120), landing: dest.slice(0, 300), kind: recruit ? 'recruit' : product === 'smart' ? 'smart' : link ? 'link' : 'code',
      proxy: F.proxyHint(ctx.req) ? 1 : 0, existing_user: ctx.user ? 1 : 0, created_at: now(),
    });
    const days = C.settings().attribution_days;
    if (recruit) ctx.setCookie(cookie('vs_aff_parent', sign(String(a.id)), days * 86400));
    else ctx.setCookie(cookie('vs_aff', uid, days * 86400));
    if (!recruit && !ctx.cookies.vs_ref) ctx.setCookie(cookie('vs_ref', a.code, days * 86400, { httpOnly: false }));
    // The "click" postback event (offered in the postback editor, off by default): fired per counted click, with the subs.
    if (!recruit) { try { require('./postbacks').enqueue(a, 'click', null, { click_id: ext, ...subs, device: deviceOf(ua), country: F.edgeCountry(ctx.req), offer: product, offer_id: product, product }); } catch (e) { console.error('[aff click postback]', e.message); } }
  }
  if (!recruit) {
    const u = new URL(dest);
    u.searchParams.set('ref', a.code);
    if (uid) u.searchParams.set('vclick', uid);
    for (const [k, v] of Object.entries(subs)) if (v) u.searchParams.set(k, v);
    dest = u.toString();
  }
  return ctx.redirect(dest);
}
/** /oauth/authorize?...&ref=&vclick=: a tool handed back our click on a domain where the cookie could not be read. */
function captureFromAuthorize(ctx) {
  const q = ctx.query;
  const days = C.settings().attribution_days;
  // Last click wins: the tool's click replaces a cookie only when it is newer (the cookie may be an older click from another link).
  const handed = q.vclick && /^[A-Za-z0-9]{8,24}$/.test(String(q.vclick)) ? D.get('SELECT created_at FROM aff_clicks WHERE uid=?', String(q.vclick)) : null;
  const held = handed && ctx.cookies.vs_aff ? D.get('SELECT created_at FROM aff_clicks WHERE uid=?', String(ctx.cookies.vs_aff)) : null;
  if (handed && (!held || held.created_at < handed.created_at)) ctx.setCookie(cookie('vs_aff', String(q.vclick), days * 86400));
  if (q.ref && !ctx.cookies.vs_ref && /^[a-z0-9]{3,12}$/i.test(String(q.ref))) ctx.setCookie(cookie('vs_ref', String(q.ref).toLowerCase(), days * 86400, { httpOnly: false }));
  if (q.coupon && /^[A-Za-z0-9_-]{3,24}$/.test(String(q.coupon))) ctx.setCookie(cookie('vs_coupon', String(q.coupon).toUpperCase(), 3600, { httpOnly: false }));
}

/* ------------------------------------------------------------------ coupons */
function couponFor(code, { country = '' } = {}) {
  code = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) return null;
  const c = D.get('SELECT * FROM aff_coupons WHERE code=? AND active=1', code);
  if (!c || (c.max_uses && c.uses >= c.max_uses)) return null;
  const geos = C.json(c.geos, []);
  if (geos.length && country && !geos.includes(country)) return null;
  const a = C.byId(c.affiliate_id);
  if (!a || ['rejected', 'closed'].includes(a.status)) return null;
  return { coupon: c, a };
}

/* ------------------------------------------------------------------ attribution */
/** Lock a new Voo ID to an affiliate. Called once, right after the user row is created. */
function onSignup(user, ctx, { coupon = '' } = {}) {
  const at = now();
  try {
    F.recordEmail(user.id, user.email, at);
    if (ctx) F.recordRequest(user.id, ctx, at);
  } catch (e) { console.error('[aff identities]', e.message); }
  if (D.get('SELECT 1 FROM aff_attributions WHERE customer_user_id=?', user.id)) return null;
  const days = C.settings().attribution_days;
  let a = null; let clk = null; let method = ''; let couponCode = '';
  const cpn = couponFor(coupon || (ctx && ctx.cookies && ctx.cookies.vs_coupon), { country: user.country });
  if (cpn) { a = cpn.a; method = 'coupon'; couponCode = cpn.coupon.code; }
  if (!a && ctx && ctx.cookies && ctx.cookies.vs_aff) {
    clk = D.get('SELECT * FROM aff_clicks WHERE uid=? AND created_at>?', String(ctx.cookies.vs_aff), at - days * DAY);
    if (clk) { a = C.byId(clk.affiliate_id); method = clk.kind === 'smart' ? 'smartlink' : 'link'; }
  }
  if (!a && user.referred_by) {
    a = C.byUser(user.referred_by);
    if (a) method = 'ref_link';
  }
  if (!a || ['rejected', 'closed'].includes(a.status) || a.user_id === user.id) return null;
  if (clk && a.id !== clk.affiliate_id) clk = null;
  // The last tracked click of this affiliate inside the window, when attribution came from a code or coupon.
  if (!clk && ctx && ctx.cookies && ctx.cookies.vs_aff) { const c2 = D.get('SELECT * FROM aff_clicks WHERE uid=? AND affiliate_id=? AND created_at>?', String(ctx.cookies.vs_aff), a.id, at - days * DAY); if (c2) clk = c2; }
  const affUser = D.get('SELECT email FROM users WHERE id=?', a.user_id);
  const blocked = affUser && C.normEmail(affUser.email) === C.normEmail(user.email) ? 'self_referral' : '';
  const pre = clk && user.created_at < clk.created_at ? 1 : 0;
  const ref = C.custRef(a.id, user.id);
  D.tx(() => {
    D.run(`INSERT OR IGNORE INTO aff_attributions(customer_user_id,affiliate_id,click_id,method,coupon_code,pre_existing,blocked,click_at,locked_at,cust_ref,country,device,sub1,sub2,sub3,sub4,sub5,ext_click_id)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, user.id, a.id, clk ? clk.id : null, method, couponCode, pre, blocked, clk ? clk.created_at : null, at, ref,
    (clk && clk.country) || user.country || (ctx ? F.edgeCountry(ctx.req) : '') || '', clk ? clk.device : ctx ? deviceOf(ctx.req.headers['user-agent']) : '',
    clk ? clk.sub1 : '', clk ? clk.sub2 : '', clk ? clk.sub3 : '', clk ? clk.sub4 : '', clk ? clk.sub5 : '', clk ? clk.ext_click_id : '');
    if (couponCode) D.run('UPDATE aff_coupons SET uses=uses+1 WHERE code=?', couponCode);
    // One referral ledger: the affiliate attribution decides the member referrer of this brand-new Voo ID too.
    D.run('UPDATE users SET referred_by=? WHERE id=?', a.user_id, user.id);
    if (clk) { F.record(user.id, 'ip', clk.ip_hash, at); F.record(user.id, 'net', clk.net_hash, at); } // the click's network joins the customer's identities
    D.run(`INSERT OR IGNORE INTO aff_conversions(affiliate_id,customer_user_id,event_type,source,source_key,status,country,occurred_at,received_at) VALUES(?,?,?,?,?,?,?,?,?)`,
      a.id, user.id, 'registration', 'signup', 'reg:' + user.id, blocked ? 'blocked' : 'tracked', (clk && clk.country) || user.country || '', at, at);
  });
  if (ctx && ctx.cookies && ctx.cookies.vs_aff) ctx.setCookie(cookie('vs_aff', '', 0));
  const conv = D.get('SELECT * FROM aff_conversions WHERE source_key=?', 'reg:' + user.id);
  N.emit(a, 'signup', { text: `New sign-up · ${ref}${clk && clk.sub1 ? ' · sub1 ' + clk.sub1 : ''}${clk && clk.product_key && !['smart', 'recruit'].includes(clk.product_key) ? ' · ' + (C.product(clk.product_key) || { name: clk.product_key }).name : ''}`, postback: 'registration', conversion: conv });
  return D.get('SELECT * FROM aff_attributions WHERE customer_user_id=?', user.id);
}
/** A coupon typed at VooSquare checkout: recorded on the order; it attributes only a Voo ID created in the last hour (same sign-up session). */
function onCheckoutCoupon(user, orderId, code) {
  const c = couponFor(code, { country: user.country });
  if (!c) return false;
  D.run('UPDATE orders SET aff_coupon=? WHERE id=?', c.coupon.code, orderId);
  if (!D.get('SELECT 1 FROM aff_attributions WHERE customer_user_id=?', user.id) && now() - user.created_at < 3600_000 && !F.everPaid(user.id)) {
    onSignup(D.get('SELECT * FROM users WHERE id=?', user.id), null, { coupon: c.coupon.code });
  }
  return true;
}
/** The sub-affiliate parent from the recruitment cookie (or a typed parent code), checked. */
function parentFrom(ctx, code) {
  let parent = null;
  const id = ctx && unsign(ctx.cookies.vs_aff_parent);
  if (id) parent = C.byId(Number(id));
  if (!parent && code) parent = C.hydrate(D.get('SELECT * FROM aff_affiliates WHERE sub_code=? OR code=?', String(code), String(code).toLowerCase()));
  return parent;
}

module.exports = { click, captureFromAuthorize, onSignup, onCheckoutCoupon, couponFor, resolve, trackingUrl, deepLinkOk, landingFor, approvedHosts, cookieDomain, cookie, uniqueLinkCode, cleanSub, SUB_RE, parentFrom, deviceOf, BOT_UA };
