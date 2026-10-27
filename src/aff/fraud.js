'use strict';
/*
 * Fraud and duplicate checks for affiliate customers (CPA pays only for unique, first-time paying customers).
 *
 * Identity signals are stored as keyed hashes in aff_identities (never the raw value): normalised email, phone, device
 * fingerprint, IP and /24 subnet, user agent, payment instrument fingerprint and Telegram ID (the last three are sent by
 * tools as their own hashes and hashed again here). analyse() turns them into a risk score (weights in Program settings)
 * and a verdict: unique / possible / existing. Evidence shown to staff is masked; affiliates only ever see reason codes.
 */
const D = require('../db');
const C = require('./core');
const { now } = require('../util');

const DAY = C.DAY;
const DISPOSABLE = new Set(['mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', '10minutemail.com', '10minutemail.net', 'tempmail.com', 'tempmail.dev',
  'temp-mail.org', 'temp-mail.io', 'tempmailo.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net', 'getnada.com', 'nada.email', 'trashmail.com', 'trashmail.de',
  'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com', 'fakeinbox.com', 'emailondeck.com', 'spamgourmet.com', 'mailcatch.com',
  'moakt.com', 'tmail.ws', 'tmpmail.org', 'burnermail.io', 'inboxkitten.com', 'mail.tm', 'linshiyouxiang.net', 'mytemp.email', 'tempinbox.com', 'emailfake.com',
  'fakemail.net', 'mailpoof.com', 'dropmail.me', 'spambox.us', 'example.com']);
const isDisposable = (email) => DISPOSABLE.has(String(email || '').split('@')[1] || '');

const LABELS = {
  pre_existing: 'Existing Voo ID before click', prior_payment: 'Paid Zedapex before', email: 'Same email (normalised)', phone: 'Phone number',
  device: 'Device fingerprint', ip: 'Same IP', subnet: 'Same /24 subnet', payment: 'Payment instrument', telegram: 'Telegram ID', name: 'Name similarity',
  self_referral: 'Linked to the affiliate', loop: 'Referral loop', velocity: 'Velocity spike', proxy: 'VPN or proxy', disposable: 'Disposable email domain',
  geo_mismatch: 'Geo mismatch', instant_refund: 'Instant refund', fast_signup: 'Click to sign-up under 5 seconds', code_only: 'No click before sign-up',
  declined_cluster: 'Previously declined cluster',
};
/* Signals that prove the customer is someone who already paid (or the affiliate): verdict "existing". */
const HARD = ['pre_existing', 'prior_payment', 'self_referral'];

/* ------------------------------------------------------------------ identities */
function record(userId, kind, value, at = now()) {
  if (!userId || !value) return;
  D.run('INSERT OR IGNORE INTO aff_identities(user_id,kind,value,at) VALUES(?,?,?,?)', userId, kind, String(value).slice(0, 64), at);
}
const ipNet = (ip) => { const m = /^(?:::ffff:)?(\d+\.\d+\.\d+)\.\d+$/.exec(String(ip || '')); return m ? m[1] + '.0/24' : String(ip || '').split(':').slice(0, 4).join(':'); };
/** Header hints that a request came through a proxy, VPN or hosting relay (a hint only; a provider can be added later). */
function proxyHint(req) {
  const h = req.headers;
  if (h['via'] || h['x-proxy-id'] || h['proxy-connection'] || h['x-bluecoat-via'] || h['forwarded-for']) return true;
  const xff = String(h['x-forwarded-for'] || '').split(',').filter(Boolean);
  return xff.length > 2;
}
/** Country from the edge, if the hosting adds it (Cloudflare, Vercel, Railway with a CDN). */
const edgeCountry = (req) => String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'] || '').toUpperCase().slice(0, 2);
/** Device fingerprint the browser sent (the affiliate front end computes it; header or cookie). */
const fingerprint = (ctx) => String(ctx.req.headers['x-vs-fp'] || ctx.cookies.vs_fp || '').slice(0, 128);
/** Store what we can tell about a request for a user (at sign-up and on later activity). */
function recordRequest(userId, ctx, at = now()) {
  const ip = ctx.ip;
  if (ip) { record(userId, 'ip', C.hashOf('ip', ip), at); record(userId, 'net', C.hashOf('net', ipNet(ip)), at); }
  const ua = ctx.req.headers['user-agent'];
  if (ua) record(userId, 'ua', C.hashOf('ua', ua), at);
  const fp = fingerprint(ctx);
  if (fp) record(userId, 'fp', C.hashOf('fp', fp), at);
  if (proxyHint(ctx.req)) record(userId, 'proxy', '1', at);
  const cc = edgeCountry(ctx.req);
  if (cc) record(userId, 'geo_ip', cc, at);
}
/** Tool-supplied hints on events (already hashed by the tool; never raw PII): payment_fingerprint, telegram_id_hash, phone_hash, device_hash. */
function recordToolSignals(userId, s, at = now()) {
  if (!s || typeof s !== 'object') return;
  const map = { payment_fingerprint: 'pay', telegram_id_hash: 'tg', phone_hash: 'phone', device_hash: 'fp' };
  for (const [k, kind] of Object.entries(map)) if (s[k]) record(userId, kind, C.hashOf(kind, s[k]), at);
  if (s.payment_country) record(userId, 'geo_pay', String(s.payment_country).toUpperCase().slice(0, 2), at);
}
function recordEmail(userId, email, at = now()) { if (email) record(userId, 'email', C.hashOf('email', C.normEmail(email)), at); }

/* ------------------------------------------------------------------ helpers */
function bigrams(s) { s = String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); const out = []; for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2)); return out; }
/** Dice similarity of two names (0..1). */
function similarity(a, b) {
  const x = bigrams(a); const y = bigrams(b);
  if (!x.length || !y.length) return 0;
  const m = new Map(); for (const g of x) m.set(g, (m.get(g) || 0) + 1);
  let hit = 0; for (const g of y) { const n = m.get(g); if (n) { hit++; m.set(g, n - 1); } }
  return (2 * hit) / (x.length + y.length);
}
/** Did this user pay Zedapex (VooSquare order or tool spend) before `before`? */
function paidBefore(userId, before) {
  if (D.get("SELECT 1 FROM orders WHERE user_id=? AND status='paid' AND amount_usd>0 AND COALESCE(paid_at,created_at)<? LIMIT 1", userId, before)) return true;
  return !!D.get("SELECT 1 FROM events WHERE user_id=? AND type='spend' AND value_usd>0 AND created_at<? LIMIT 1", userId, before);
}
function everPaid(userId) {
  return !!(D.get("SELECT 1 FROM orders WHERE user_id=? AND status='paid' AND amount_usd>0 LIMIT 1", userId) || D.get("SELECT 1 FROM events WHERE user_id=? AND type='spend' AND value_usd>0 LIMIT 1", userId));
}

/* ------------------------------------------------------------------ analysis */
/**
 * Risk analysis of one referred customer for the affiliate they are attributed to.
 * Returns { risk, verdict, signals: [{ key, label, weight, evidence }], matches: [{ ref, relation, kinds, paid }] }.
 */
function analyse(customerId, at = now()) {
  const cfg = C.settings().fraud;
  const W = cfg.weights;
  const user = D.get('SELECT * FROM users WHERE id=?', customerId);
  const attr = D.get('SELECT * FROM aff_attributions WHERE customer_user_id=?', customerId);
  if (!user || !attr) return { risk: 0, verdict: 'unique', signals: [], matches: [] };
  const aff = D.get('SELECT a.*, u.name uname, u.email uemail FROM aff_affiliates a JOIN users u ON u.id=a.user_id WHERE a.id=?', attr.affiliate_id);
  const click = attr.click_id ? D.get('SELECT * FROM aff_clicks WHERE id=?', attr.click_id) : null;
  const signals = [];
  const add = (key, evidence) => { if (!signals.some((s) => s.key === key)) signals.push({ key, label: LABELS[key], weight: Number(W[key]) || 0, evidence }); };

  if (attr.pre_existing || (click && user.created_at < click.created_at)) add('pre_existing', `Voo ID ${C.vooRef(user.id)} was created before the affiliate click.`);
  if (paidBefore(customerId, attr.locked_at || user.created_at)) add('prior_payment', 'The customer paid Zedapex before this attribution.');

  const mine = D.all('SELECT kind, value FROM aff_identities WHERE user_id=?', customerId);
  const matches = new Map();
  const STRONG = { email: 'email', phone: 'phone', fp: 'device', pay: 'payment', tg: 'telegram' };
  for (const id of mine) {
    if (!STRONG[id.kind] && id.kind !== 'ip' && id.kind !== 'net') continue;
    const others = D.all('SELECT DISTINCT user_id FROM aff_identities WHERE kind=? AND value=? AND user_id<>? LIMIT 50', id.kind, id.value, customerId);
    for (const o of others) {
      const m = matches.get(o.user_id) || { user_id: o.user_id, kinds: new Set() };
      m.kinds.add(id.kind);
      matches.set(o.user_id, m);
    }
  }
  const out = [];
  let hardMatch = false;
  const since = at - 30 * DAY;
  let ipPeers = 0; let netPeers = 0;
  for (const m of matches.values()) {
    const oattr = D.get('SELECT affiliate_id, locked_at FROM aff_attributions WHERE customer_user_id=?', m.user_id);
    const isAff = aff && m.user_id === aff.user_id;
    const paid = everPaid(m.user_id);
    const sameAff = oattr && oattr.affiliate_id === attr.affiliate_id;
    const relation = isAff ? 'affiliate' : sameAff ? 'same_affiliate_customer' : paid ? 'existing_customer' : 'other_account';
    const strongKinds = [...m.kinds].filter((k) => STRONG[k]);
    for (const k of strongKinds) {
      const sig = STRONG[k];
      if (isAff) add('self_referral', `${LABELS[sig]} matches the affiliate's own account.`);
      else if (relation === 'existing_customer' && ['email', 'payment', 'phone', 'telegram'].includes(sig)) { hardMatch = true; add(sig, `${LABELS[sig]} matches ${C.vooRef(m.user_id)}, which already paid.`); }
      else add(sig, `${LABELS[sig]} matches ${C.vooRef(m.user_id)}${sameAff ? ', another customer of this affiliate' : ''}.`);
    }
    if (m.kinds.has('ip') || m.kinds.has('net')) {
      const recent = D.get('SELECT MAX(at) t FROM aff_identities WHERE user_id=? AND kind IN (\'ip\',\'net\')', m.user_id).t || 0;
      if (recent >= since && (sameAff || isAff)) { if (m.kinds.has('ip')) ipPeers++; else netPeers++; }
      if (isAff && m.kinds.has('ip')) add('self_referral', 'Same IP address as the affiliate.');
    }
    if (D.get("SELECT 1 FROM aff_cpa_reviews WHERE customer_user_id=? AND status='declined' LIMIT 1", m.user_id) && (m.kinds.has('fp') || m.kinds.has('ip') || m.kinds.has('pay'))) {
      add('declined_cluster', `Shares a device, IP or payment method with ${C.vooRef(m.user_id)}, declined before.`);
    }
    out.push({ ref: C.vooRef(m.user_id), relation, kinds: [...m.kinds].map((k) => ({ email: 'email', phone: 'phone', fp: 'device', pay: 'payment', tg: 'telegram', ip: 'ip', net: 'subnet' }[k])), paid });
  }
  if (ipPeers) add('ip', `Same IP as ${ipPeers} other referred ${ipPeers === 1 ? 'customer' : 'customers'} of this affiliate in 30 days.`);
  if (netPeers >= 2) add('subnet', `Same /24 subnet as ${netPeers} other referred customers in 30 days.`);

  // Name similarity with the affiliate and with other customers of the same affiliate.
  if (aff && similarity(user.name, aff.uname) >= 0.88) add('self_referral', 'The customer name is almost the same as the affiliate name.');
  if (C.normEmail(user.email) === C.normEmail(aff && aff.uemail)) add('self_referral', "Same email as the affiliate's own account.");
  const peers = D.all('SELECT u.id, u.name FROM aff_attributions t JOIN users u ON u.id=t.customer_user_id WHERE t.affiliate_id=? AND t.customer_user_id<>? ORDER BY t.locked_at DESC LIMIT 300', attr.affiliate_id, customerId);
  const twin = peers.find((p) => similarity(p.name, user.name) >= 0.88);
  if (twin) add('name', `Name ${similarity(twin.name, user.name).toFixed(2)} similar to ${C.vooRef(twin.id)}.`);

  // Referral loop: the customer referred the affiliate, or is the affiliate's parent.
  if (aff) {
    const affAttr = D.get('SELECT a2.user_id FROM aff_attributions t JOIN aff_affiliates a2 ON a2.id=t.affiliate_id WHERE t.customer_user_id=?', aff.user_id);
    const parent = aff.parent_affiliate_id ? D.get('SELECT user_id FROM aff_affiliates WHERE id=?', aff.parent_affiliate_id) : null;
    if ((affAttr && affAttr.user_id === customerId) || (parent && parent.user_id === customerId) || D.get('SELECT 1 FROM users WHERE id=? AND referred_by=?', aff.user_id, customerId)) add('loop', 'The customer referred the affiliate, or the two refer each other.');
  }
  // Velocity: sign-ups in the 24 hours before this one vs the affiliate's 14-day daily average.
  const ref = attr.locked_at || at;
  const day = D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>? AND locked_at<=?', attr.affiliate_id, ref - DAY, ref).n;
  const base = D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>? AND locked_at<=?', attr.affiliate_id, ref - 15 * DAY, ref - DAY).n / 14;
  if (day >= 10 && day >= 5 * Math.max(base, 1)) add('velocity', `${day} sign-ups in 24 hours, ${(day / Math.max(base, 1)).toFixed(1)}x the 14-day average.`);
  if (mine.some((i) => i.kind === 'proxy')) add('proxy', 'Signed up through a proxy, VPN or relay (header check).');
  if (isDisposable(user.email)) add('disposable', `Disposable email domain (${C.maskEmail(user.email)}).`);
  const geos = new Set([click && click.country, user.country, ...mine.filter((i) => i.kind === 'geo_pay' || i.kind === 'geo_ip').map((i) => i.value)].filter(Boolean).map((x) => String(x).toUpperCase()));
  if (geos.size > 1) add('geo_mismatch', `Countries differ: ${[...geos].join(', ')}.`);
  const quick = D.get(`SELECT 1 FROM aff_conversions r JOIN aff_conversions p ON p.id=r.related_id WHERE r.customer_user_id=? AND r.event_type IN ('refund','chargeback') AND r.occurred_at - p.occurred_at < ? LIMIT 1`, customerId, DAY);
  if (quick) add('instant_refund', 'Refund within 24 hours of the payment.');
  if (click && user.created_at - click.created_at < 5000 && user.created_at >= click.created_at) add('fast_signup', `Voo ID created ${Math.max(0, Math.round((user.created_at - click.created_at) / 1000))} s after the click.`);
  if (!click && (attr.method === 'code' || attr.method === 'coupon' || attr.method === 'ref_link')) add('code_only', 'Attributed by code with no tracked click.');

  const risk = Math.min(100, signals.reduce((s, x) => s + x.weight, 0));
  const existing = hardMatch || signals.some((s) => HARD.includes(s.key));
  const verdict = existing || risk >= cfg.existing_at ? 'existing' : risk >= cfg.possible_at || out.some((m) => m.kinds.some((k) => k !== 'ip' && k !== 'subnet')) ? 'possible' : 'unique';
  return { risk, verdict, signals: signals.sort((a, b) => b.weight - a.weight), matches: out.slice(0, 20), email: C.maskEmail(user.email) };
}

/* ------------------------------------------------------------------ affiliate fraud score */
/** 0..100 from CPA decline rate, refund rate, device clusters, proxy sign-ups and velocity. With a breakdown for staff. */
function affiliateScore(affId, at = now()) {
  const d = D.get("SELECT COUNT(*) n, COUNT(CASE WHEN status='declined' THEN 1 END) dn FROM aff_cpa_reviews WHERE affiliate_id=? AND decided_at>?", affId, at - 30 * DAY);
  const declinePct = d.n ? (100 * d.dn) / d.n : 0;
  const nc = D.get('SELECT COUNT(*) n, COUNT(CASE WHEN refunds>0 OR chargebacks>0 THEN 1 END) r FROM aff_customers WHERE affiliate_id=? AND first_payment_at>?', affId, at - 61 * DAY);
  const refundPct = nc.n ? (100 * nc.r) / nc.n : 0;
  const custs = D.all('SELECT customer_user_id id FROM aff_attributions WHERE affiliate_id=? AND locked_at>? LIMIT 2000', affId, at - 90 * DAY).map((r) => r.id);
  let cluster = 0; let proxy = 0;
  if (custs.length) {
    const ph = custs.map(() => '?').join(',');
    cluster = D.get(`SELECT COUNT(DISTINCT a.user_id) n FROM aff_identities a JOIN aff_identities b ON a.kind='fp' AND b.kind='fp' AND a.value=b.value AND a.user_id<>b.user_id WHERE a.user_id IN (${ph}) AND b.user_id IN (${ph})`, ...custs, ...custs).n;
    proxy = D.get(`SELECT COUNT(DISTINCT user_id) n FROM aff_identities WHERE kind='proxy' AND user_id IN (${ph})`, ...custs).n;
  }
  const clusterPct = custs.length ? (100 * cluster) / custs.length : 0;
  const proxyPct = custs.length ? (100 * proxy) / custs.length : 0;
  const day = D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>?', affId, at - DAY).n;
  const base = D.get('SELECT COUNT(*) n FROM aff_attributions WHERE affiliate_id=? AND locked_at>? AND locked_at<=?', affId, at - 15 * DAY, at - DAY).n / 14;
  const velocity = day >= 5 ? day / Math.max(base, 1) : 1;
  const score = Math.round(Math.min(100, Math.min(40, declinePct * 1.3) + Math.min(25, refundPct * 1.5) + Math.min(15, clusterPct) + Math.min(10, proxyPct) + Math.min(10, Math.max(0, velocity - 1) * 2)));
  return {
    score, breakdown: [
      { key: 'cpa_decline_rate', label: 'CPA decline rate', value: Math.round(declinePct * 10) / 10, unit: '%' },
      { key: 'refund_rate', label: 'Refund rate', value: Math.round(refundPct * 10) / 10, unit: '%' },
      { key: 'device_clusters', label: 'Same-device clusters', value: Math.round(clusterPct * 10) / 10, unit: '%' },
      { key: 'proxy', label: 'VPN or proxy sign-ups', value: Math.round(proxyPct * 10) / 10, unit: '%' },
      { key: 'velocity', label: 'Velocity vs 14-day average', value: Math.round(velocity * 10) / 10, unit: 'x' },
    ],
  };
}

module.exports = { analyse, affiliateScore, record, recordRequest, recordToolSignals, recordEmail, similarity, isDisposable, ipNet, proxyHint, edgeCountry, fingerprint, paidBefore, everPaid, LABELS, DISPOSABLE };
