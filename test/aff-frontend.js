'use strict';
/*
 * VooSquare Affiliates front end: the app shell and its files serve on /affiliates and on the affiliate host, every
 * script is CSP-safe (no inline scripts or on* handlers), the "Affiliates" menu items exist on the site, in the member
 * app and in the admin, and the feature switch hides them. Called by test/smoke.js with its server and check().
 */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function affFrontend({ BASE, Client, check, owner }) {
  console.log('Affiliates front end: shell, files, menus');
  const pub = path.join(__dirname, '..', 'public');
  const get = async (p, headers = {}) => { const r = await fetch(BASE + p, { headers, redirect: 'manual' }); return { status: r.status, type: r.headers.get('content-type') || '', csp: r.headers.get('content-security-policy') || '', text: await r.text() }; };

  const shell = await get('/affiliates');
  check('aff-fe: /affiliates serves the affiliate app shell', shell.status === 200 && shell.text.includes('id="aff-app"') && shell.text.includes('/js/aff-core.js'));
  check('aff-fe: deep paths under /affiliates serve the shell', (await get('/affiliates/anything')).text.includes('id="aff-app"'));
  const viaHost = (p) => new Promise((resolve, reject) => { const u = new URL(BASE + p); require('node:http').get({ host: u.hostname, port: u.port, path: u.pathname, headers: { host: 'affiliate.example.com' } }, (res) => { let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); }).on('error', reject); });
  const host = await viaHost('/login');
  check('aff-fe: the affiliate host serves the app for /login (Voo ID sign-in inside the app)', host.status === 200 && host.text.includes('id="aff-app"'));
  check('aff-fe: the affiliate host still serves the admin shell on /admin', !(await viaHost('/admin')).text.includes('id="aff-app"'));
  check('aff-fe: strict CSP on the shell (scripts from self only)', /script-src 'self'(;|$)/.test(shell.csp));
  check('aff-fe: no inline scripts or on* handlers in the shell', !/<script(?![^>]*\bsrc=)[^>]*>/i.test(shell.text) && !/\son[a-z]+=/i.test(shell.text));

  const scripts = [...shell.text.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const styles = [...shell.text.matchAll(/<link rel="stylesheet" href="(\/[^"]+)"/g)].map((m) => m[1]);
  check('aff-fe: the shell loads the five affiliate scripts and both stylesheets', ['aff-core', 'aff-site', 'aff-app1', 'aff-app2', 'aff-admin'].every((n) => scripts.includes(`/js/${n}.js`)) && styles.includes('/css/aff.css') && styles.includes('/css/aff-live.css'), scripts);
  for (const f of [...scripts, ...styles]) {
    const r = await get(f);
    check(`aff-fe: ${f} serves`, r.status === 200 && (f.endsWith('.js') ? /javascript/.test(r.type) : /css/.test(r.type)) && r.text.length > 100);
  }
  for (const f of ['aff-core', 'aff-site', 'aff-app1', 'aff-app2', 'aff-admin']) {
    const src = fs.readFileSync(path.join(pub, 'js', f + '.js'), 'utf8');
    let ok = true; try { new Function(src); } catch { ok = false; } // eslint-disable-line no-new-func
    check(`aff-fe: ${f}.js parses`, ok);
    check(`aff-fe: ${f}.js has no inline on* handlers in its markup`, !/\son(click|change|input|submit|load|error)=/i.test(src));
    check(`aff-fe: ${f}.js uses no eval or new Function`, !/\beval\(|new Function\(/.test(src));
  }
  const core = fs.readFileSync(path.join(pub, 'js', 'aff-core.js'), 'utf8');
  const site = fs.readFileSync(path.join(pub, 'js', 'aff-site.js'), 'utf8');
  check('aff-fe: sign-up sends the device fingerprint header and the coupon', /'x-vs-fp': VS\.fp\(\)/.test(site) && /coupon: VS\.coupon\(\)/.test(site));
  check('aff-fe: public header and hero have Log in and Join', /href="#\/join\/login">Log in/.test(site) && /href="#\/join\/signin">Join/.test(site) && /hero-cta/.test(site));
  check('aff-fe: router covers site, join, affiliate and back office', ['R.site', 'R.join', 'R.aff', 'R.admin', 'R.mgr', 'R.fraud', 'R.fin'].every((k) => (core + site + fs.readFileSync(path.join(pub, 'js', 'aff-app2.js'), 'utf8') + fs.readFileSync(path.join(pub, 'js', 'aff-admin.js'), 'utf8')).includes('A.' + k)));
  // Owner update 2026-10-05: instant RevShare, first-payment qualification, used credits non-refundable.
  const affJs = ['aff-core', 'aff-site', 'aff-app1', 'aff-app2', 'aff-admin'].map((f) => fs.readFileSync(path.join(pub, 'js', f + '.js'), 'utf8')).join('\n');
  check('aff-fe: no old hold or qualification copy left (30-day holds, "second payment or 30 days", 30 to 60 days)', !/Second payment or 30 days|second time, or stays active for 30 days|RevShare 30 days|held 30 to 60 days|30 to 60 days|on hold for 30 days|Scores are provisional until the qualification window/i.test(affJs));
  check('aff-fe: the dashboard shows On hold only when there is money on hold', /b\.hold_cents > 0 \? \['On hold'/.test(fs.readFileSync(path.join(pub, 'js', 'aff-app1.js'), 'utf8')));
  check('aff-fe: admin settings expose the hold days per source', ['hd_spend', 'hd_order', 'hd_card', 'hd_cpa'].every((k) => affJs.includes(`'${k}'`)));
  const terms = fs.readFileSync(path.join(__dirname, '..', 'docs', 'AFFILIATE_TERMS.md'), 'utf8');
  check('aff-fe: terms carry the non-refundable credits clause', terms.includes('Credits that have been used are non-refundable; commission on used credits is final except in the case of a payment chargeback or proven fraud.') && !/RevShare is held for \{30\} days/.test(terms));
  // Owner answers 2026-10-05: the founder quote is approved (no "draft" tag anywhere in the affiliate app), terms v1.1 re-acceptance UI.
  check('aff-fe: no "draft" tag left in the affiliate app (scripts and shell)', !/draft/i.test(affJs + fs.readFileSync(path.join(pub, 'affiliate.html'), 'utf8')));
  const app1 = fs.readFileSync(path.join(pub, 'js', 'aff-app1.js'), 'utf8');
  check('aff-fe: updated-terms banner and "what changed" modal accept through /api/aff/terms/accept with the version', /We've updated the affiliate terms/.test(app1) && /what changed/.test(app1) && /'\/api\/aff\/terms\/accept', \{ version: t\.current \}/.test(app1) && /href="#\/aff\/terms"/.test(app1));
  check('aff-fe: payouts page explains the terms block', /terms_update: 'Accept the updated affiliate terms/.test(affJs));
  check('aff-fe: terms start with "Changes in v1.1" and say tool refunds never reverse commission, plans included', /Version: \*\*v1\.1\*\*/.test(terms) && /## Changes in v1\.1/.test(terms) && terms.indexOf('## Changes in v1.1') < terms.indexOf('## 1. Definitions') && /Refunds made by a Product \(tool\) never reverse your commission\*\*, whatever they refund: used credits, a plan payment/.test(terms));
  const shared = fs.readFileSync(path.join(pub, 'js', 'shared.js'), 'utf8');
  check('aff-fe: shared helpers expose fp() and coupon(), and api() passes extra headers', /fp, coupon \}/.test(shared) && /\.\.\.\(opts\.headers \|\| \{\}\)/.test(shared));
  check('aff-fe: checkout passes a coupon', /coupon: cpn \|\| undefined/.test(fs.readFileSync(path.join(pub, 'js', 'app-billing.js'), 'utf8')));

  // Menus: site header, drawer and footer; member app; admin.
  const index = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
  check('aff-fe: "Affiliates" is in the site header, mobile menu and footer', (index.match(/href="\/affiliates" data-aff-link/g) || []).length >= 3);
  check('aff-fe: "Affiliates" is in the member app menu', /href="\/affiliates" data-aff-link/.test(fs.readFileSync(path.join(pub, 'js', 'app.js'), 'utf8')));
  check('aff-fe: the admin has an Affiliates section that opens the back office', /page\('affiliates'/.test(fs.readFileSync(path.join(pub, 'js', 'admin.js'), 'utf8')));
  check('aff-fe: the feature switch hides the links (CSS)', /\.f-off-affiliates \[data-aff-link\]/.test(fs.readFileSync(path.join(pub, 'css', 'features.css'), 'utf8')) && /'affiliates'\]/.test(fs.readFileSync(path.join(pub, 'js', 'features.js'), 'utf8')));
  const site1 = await (await fetch(BASE + '/api/site')).json();
  check('aff-fe: /api/site carries the affiliates switch and the affiliate URL', site1.features && site1.features.affiliates === true && site1.features.affiliate_url === '/affiliates', site1.features);
  void owner; // switching the program off is covered in test/affiliates.js (API answers { off: 'affiliates' }, tracking keeps running).
};
