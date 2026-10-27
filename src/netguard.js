'use strict';
/*
 * Outbound requests to addresses an admin typed in (custom payment APIs, Gatevoo api_base).
 * Guards against SSRF: https only in production, no localhost / private / link-local / metadata addresses
 * (checked on the resolved IP, and pinned through a custom DNS lookup so a second lookup cannot swap
 * in a private address), no redirects, a timeout and a response size limit.
 * Error messages never include headers or secrets.
 */
const http = require('node:http');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const config = require('./config');

const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(a, p, 'ipv4');
// ::/96 also covers :: , ::1 and IPv4-compatible (::7f00:1). IPv4 tunnelled in IPv6 (NAT64 64:ff9b::/96 and /48, 6to4 2002::/16,
// translated ::ffff:0:x) can reach private IPv4 hosts, so those prefixes are refused whole. (Mapped ::ffff:x is handled in
// isBlockedIp: a ::ffff:0:0/96 rule here would also match every plain IPv4 address, because BlockList maps IPv4 into it.)
for (const [a, p] of [['::', 96], ['::ffff:0:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]]) blocked.addSubnet(a, p, 'ipv6');

class GuardError extends Error {}

/** True when an IP address must not be reached from the server. */
function isBlockedIp(ip) {
  const fam = net.isIP(ip);
  if (!fam) return true;
  if (fam === 6) {
    const lower = ip.toLowerCase();
    // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::a.b.c.d) addresses: check the IPv4 inside.
    const m = /^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (m) return blocked.check(m[1], 'ipv4');
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(lower)) return true;
    return blocked.check(ip, 'ipv6');
  }
  return blocked.check(ip, 'ipv4');
}

/** Syntax check for a URL an admin saves. Returns '' when fine, otherwise a plain-language problem. */
function urlProblem(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'is not a valid web address'; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !config.prod)) return 'must start with https://';
  if (u.username || u.password) return 'must not contain a username or password';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!config.allowPrivateOutbound) {
    if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) return 'points to a private address';
    if (net.isIP(host) && isBlockedIp(host)) return 'points to a private address';
  }
  return '';
}

function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
    if (err) return cb(err);
    if (!addrs.length) return cb(new GuardError('could not be found'));
    if (!config.allowPrivateOutbound && addrs.some((a) => isBlockedIp(a.address))) return cb(new GuardError('points to a private address'));
    if (options && options.all) return cb(null, addrs);
    const fam = options && options.family;
    const pick = addrs.find((a) => !fam || a.family === fam) || addrs[0];
    cb(null, pick.address, pick.family);
  });
}

/**
 * One guarded request. Resolves { ok, status, headers, body: Buffer, redirect } or throws GuardError / Error with a short
 * message that is safe to show to the admin. Redirects are never followed.
 */
function guardedRequest(url, { method = 'GET', headers = {}, body, timeoutMs = 10_000, maxBytes = 256 * 1024, accept = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const problem = urlProblem(url);
    if (problem) return reject(new GuardError('The address ' + problem + '.'));
    const u = new URL(url);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    const h = { Accept: accept, 'User-Agent': 'VooSquare/1.0', ...headers };
    if (payload) h['Content-Length'] = payload.length;
    let done = false;
    const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
    const req = lib.request({
      protocol: u.protocol, hostname: host, port: u.port || undefined, path: u.pathname + u.search, method, headers: h,
      // IP literals skip DNS, so they were checked in urlProblem(); names are checked here, on the address actually used.
      lookup: net.isIP(host) ? undefined : guardedLookup,
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) { req.destroy(); finish(reject, new GuardError('The provider sent too much data.')); } else chunks.push(c);
      });
      res.on('end', () => finish(resolve, { ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), redirect: res.statusCode >= 300 && res.statusCode < 400 }));
      res.on('error', (e) => finish(reject, e));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, new GuardError('The provider did not answer in time.')); }, timeoutMs);
    req.on('error', (e) => finish(reject, e instanceof GuardError ? new GuardError('The address ' + e.message + '.') : new GuardError(e.code === 'ENOTFOUND' ? 'The address could not be found.' : 'Could not reach the provider.')));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Like util.fetchJson, for admin-entered URLs. Resolves { ok, status, data } or throws GuardError / Error
 * with a short message that is safe to show to the admin.
 */
async function guardedJson(url, opts = {}) {
  const r = await guardedRequest(url, opts);
  const text = r.body.toString('utf8');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  return { ok: r.ok, status: r.status, data, redirect: r.redirect };
}

module.exports = { guardedJson, guardedRequest, urlProblem, isBlockedIp, GuardError };
