'use strict';
/* UX fixes from the independent black-box QA (2026-10-05, findings QA-1 … QA-38). Called from test/smoke.js.
 *  - QA-1  Telegram prefill never shows "[object Object]".
 *  - QA-2  Affiliate terms: no {placeholders}, no internal file paths, figures from settings, owner-controlled draft banner.
 *  - QA-3  /privacy and /terms pages from Admin → Legal, with their own approval switches; linked in footers and sign-up.
 *  - QA-4  Unpaid transfer/crypto orders: reused, cancellable, expire after the setting ('expired', never deleted).
 *  - QA-5  A code that does not exist is refused before any order is made.
 *  - QA-6  Customer "Lessons done" counts VooSquare Academy lessons.  QA-8 deep-link domains follow the program.
 *  - QA-12 Application chips say what is true.  QA-13/14 team presets.  QA-27 recycle bin.  QA-37 voice switches. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = async function uxFixes({ BASE, Client, check, owner, DB }) {
  const { DatabaseSync } = require('node:sqlite');
  const sqlRun = (q, ...a) => { const s = new DatabaseSync(DB); try { return s.prepare(q).run(...a); } finally { s.close(); } };
  const sqlGet = (q, ...a) => { const s = new DatabaseSync(DB); try { return s.prepare(q).get(...a); } finally { s.close(); } };
  const xf = () => ({ 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (c, email, name) => { const s = await c.post('/api/auth/start', { email, name }, xf()); return c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf()); };
  const pub = path.join(__dirname, '..', 'public');
  const read = (f) => fs.readFileSync(path.join(pub, f), 'utf8');
  console.log('UX fixes (independent QA)');

  /* ---------------- QA-1: Telegram prefill ---------------- */
  {
    const src = read('js/aff-site.js');
    const m = /const tgHandle = \(v\) => \{[\s\S]*?\n {2}\};/.exec(src);
    let fn = null; try { fn = m && vm.runInNewContext(`(${m[0].replace(/^const tgHandle = /, '').replace(/;$/, '')})`); } catch { fn = null; }
    check('QA-1: the Telegram field prefills a handle string, never "[object Object]"', !!fn && fn({ configured: false, connected: false, username: '' }) === '' && fn({ username: 'ada_ads' }) === '@ada_ads' && fn('@ada') === '@ada' && fn(undefined) === '' && !/a\.telegram \|\| me\.telegram/.test(src));
    const u = new Client(); await login(u, 'ux-tg@test.dev', 'Tg Person');
    const acc = (await u.post('/api/aff/account', {})).data.account;
    check('QA-1: /api/aff/me keeps telegram as the alerts state object (the shape the form must not print)', acc && typeof acc.telegram === 'object');
  }

  /* ---------------- QA-2: affiliate terms ---------------- */
  {
    const t = (await new Client().get('/api/aff/terms')).data;
    const p = (await new Client().get('/api/aff/public')).data;
    check('QA-2: affiliate terms have no {placeholders} and no internal file paths', t.markdown.length > 5000 && !/[{}]/.test(t.markdown) && !/docs\//.test(t.markdown) && !/confirm with counsel\}/.test(t.markdown), (t.markdown.match(/\{[^}]*\}/g) || []).slice(0, 5));
    check('QA-2: figures come from the program settings (attribution window, payout minimum)', t.markdown.includes(`${p.attribution_days} days from the click`) && /\*\*\$\d+\*\* for USDT/.test(t.markdown));
    check('QA-2: the draft banner shows until the owner approves (default off)', t.approved === false && /DRAFT FOR LEGAL REVIEW\.\*\* Not in force/.test(t.markdown) && /^## Changes in v1\.1$/m.test(t.markdown));
    const staff = new Client(); await login(staff, 'ux-settings@test.dev', 'Set Tings');
    await owner.post('/api/admin/team', { email: 'ux-settings@test.dev', perms: ['settings'] });
    check('QA-2: only an owner can mark a document approved by counsel', (await staff.put('/api/admin/legal/approval', { affiliate: true })).status === 403);
    const ap = await owner.put('/api/admin/legal/approval', { affiliate: true });
    const t2 = (await new Client().get('/api/aff/terms')).data;
    check('QA-2: approved → the banner is gone, the change is in the audit log', ap.status === 200 && ap.data.approved.affiliate === true && t2.approved === true && !/DRAFT FOR LEGAL REVIEW/.test(t2.markdown) && !!sqlGet("SELECT 1 FROM audit WHERE action='legal.approval'"));
    await owner.put('/api/admin/legal/approval', { affiliate: false });
    check('QA-2: no "draft" wording was added to the affiliate app code (the banner comes from the server)', !/draft/i.test(read('js/aff-site.js') + read('js/aff-core.js')));
  }

  /* ---------------- QA-3: privacy policy and terms of service ---------------- */
  {
    const page = async (u) => { const r = await fetch(BASE + u, { redirect: 'manual' }); return { status: r.status, text: await r.text(), loc: r.headers.get('location'), csp: r.headers.get('content-security-policy') }; };
    const pv = await page('/privacy'); const tm = await page('/terms');
    const sections = (h) => (h.match(/<h2 id=/g) || []).length;
    check('QA-3: /privacy and /terms are pages (200, CSP, no scripts) naming only Zedapex Limited, Lagos', pv.status === 200 && tm.status === 200 && !!pv.csp && !/<script/i.test(pv.text + tm.text) && pv.text.includes('Zedapex Limited, Lagos') && tm.text.includes('Zedapex Limited, Lagos'));
    check('QA-3: the privacy template covers data, payment proofs, KYC images, use, sharing via Voo ID, retention, rights, cookies, contact', sections(pv.text) >= 8 && /payment proof/i.test(pv.text) && /selfie/i.test(pv.text) && /Continue with VooSquare/.test(pv.text) && /How long we keep it/.test(pv.text) && /Your rights/.test(pv.text) && /Cookies/.test(pv.text) && /<h2 id="s\d+">Contact<\/h2>/.test(pv.text) && /mailto:/.test(pv.text));
    check('QA-3: privacy carries the draft warning while Terms of service does not', pv.text.includes('Draft — needs legal review before launch') && !tm.text.includes('Draft — needs legal review before launch') && sections(tm.text) >= 6);
    check('QA-3: /legal goes to the terms', (await page('/legal')).status === 302);
    const member = new Client(); await login(member, 'ux-legal-member@test.dev', 'Leg Al');
    check('QA-3: Admin → Legal needs the settings permission', (await member.get('/api/admin/legal')).status === 403 && (await member.put('/api/admin/legal/privacy', { body: 'x' })).status === 403);
    const g = (await owner.get('/api/admin/legal')).data;
    check('QA-3: Admin → Legal returns both documents, the template and the switches', g.privacy.custom === false && g.terms.custom === false && g.can_approve === true && g.approved.privacy === false && g.templates.privacy.length > 1000);
    const sv = await owner.put('/api/admin/legal/privacy', { body: '# Privacy policy\n\n## Who we are\nUX test text <script>x</script> for the policy.\n\n## Contact\nWrite to {support_email}.' });
    const pv2 = await page('/privacy');
    check('QA-3: saved text renders on /privacy, escaped, with a last-updated date', sv.status === 200 && sv.data.doc.custom === true && pv2.text.includes('UX test text &lt;script&gt;') && /Last updated/.test(pv2.text));
    await owner.put('/api/admin/legal/approval', { privacy: true });
    const pv3 = await page('/privacy'); const tm3 = await page('/terms');
    check('QA-3: approving the privacy policy removes its banner; Terms of service remains clear', !pv3.text.includes('needs legal review') && !tm3.text.includes('needs legal review'));
    const rs = await owner.put('/api/admin/legal/privacy', { body: '' });
    await owner.put('/api/admin/legal/approval', { privacy: false });
    check('QA-3: an empty save goes back to the template', rs.data.doc.custom === false && (await page('/privacy')).text.includes('How long we keep it'));
    const site = read('index.html'); const sj = read('js/site.js'); const af = read('js/aff-site.js');
    check('QA-3: linked from the website footer, sign-up, the affiliate site footer and application, and checkout', /href="\/privacy"/.test(site) && /href="\/terms"/.test(site) && /href="\/terms"[^>]*>Terms of service/.test(sj) && /href="\/privacy"[^>]*>Privacy policy/.test(sj) && (af.match(/\/privacy/g) || []).length >= 3 && /\/terms"/.test(read('js/app-billing.js')));
  }

  /* ---------------- QA-4 and QA-5: unpaid orders and codes ---------------- */
  {
    const bank = (await owner.get('/api/admin/payment-methods')).data.methods.find((m) => m.type === 'manual' && m.name === 'Bank transfer');
    const on = await owner.post('/api/admin/payment-methods', { ...bank, countries: [], enabled: true, config: { ...bank.config, details: [{ label: 'Bank', value: 'UX Bank' }, { label: 'Account number', value: '0123456789' }, { label: 'Account name', value: 'Zedapex Limited' }] } });
    const mid = on.data && on.data.method ? on.data.method.id : bank.id;
    const buyer = new Client(); await login(buyer, 'ux-buyer@test.dev', 'Bayo Buyer');
    const co = (b = {}) => buyer.post('/api/billing/checkout', { item: 'premium', method_id: mid, ...b });
    const n0 = sqlGet('SELECT COUNT(*) n FROM orders').n;
    const bad = await co({ coupon: 'FAKE10' });
    check('QA-5: a code that does not exist is refused with a clear message, and no order is made', on.status === 200 && bad.status === 400 && bad.data.field === 'coupon' && /not valid/.test(bad.data.error) && sqlGet('SELECT COUNT(*) n FROM orders').n === n0, { on: on.status, bad: bad.data });
    const chk = await buyer.post('/api/billing/coupon', { coupon: 'NOPE99' });
    check('QA-5: "Apply" checks a code before paying', chk.status === 400 && chk.data.field === 'coupon' && (await buyer.post('/api/billing/coupon', {})).status === 400);
    const a = await co(); const b = await co();
    check('QA-4: opening checkout again for the same plan and method reuses the unpaid order', a.status === 200 && b.status === 200 && a.data.order.ref === b.data.order.ref && b.data.reused === true && !!b.data.pay, { a: a.data, b: b.data });
    const cx = await buyer.post(`/api/billing/orders/${a.data.order.ref}/cancel`, {});
    const proof = await buyer.post(`/api/billing/orders/${a.data.order.ref}/proof`, { proof: 'REF-12345' });
    check('QA-4: the member can cancel an unpaid order; it stays on the account as cancelled', cx.status === 200 && cx.data.order.status === 'cancelled' && proof.status === 400 && /cancelled/.test(proof.data.error) && sqlGet('SELECT status FROM orders WHERE ref=?', a.data.order.ref).status === 'cancelled');
    const c = await co();
    check('QA-4: a new checkout after cancelling makes a new order', c.status === 200 && c.data.order.ref !== a.data.order.ref);
    const other = new Client(); await login(other, 'ux-other@test.dev', 'Other One');
    check('QA-4: nobody else can cancel your order', (await other.post(`/api/billing/orders/${c.data.order.ref}/cancel`, {})).status === 404);
    await buyer.post(`/api/billing/orders/${c.data.order.ref}/proof`, { proof: 'REF-777777' });
    check('QA-4: an order being checked cannot be cancelled', (await buyer.post(`/api/billing/orders/${c.data.order.ref}/cancel`, {})).status === 409);
    const d = await co();
    sqlRun('UPDATE orders SET created_at=? WHERE ref=?', Date.now() - 8 * 86400_000, d.data.order.ref);
    const mine = (await buyer.get('/api/me/orders')).data.orders;
    check('QA-4: an unpaid transfer order older than 7 days turns "expired" (kept, never deleted)', mine.find((o) => o.ref === d.data.order.ref).status === 'expired' && mine.find((o) => o.ref === c.data.order.ref).status === 'review');
    check('QA-4: an expired order cannot take proof, with a way forward', /expired/.test((await buyer.post(`/api/billing/orders/${d.data.order.ref}/proof`, { proof: 'REF-1' })).data.error));
    const bs0 = await owner.get('/api/admin/settings/billing');
    const bad0 = await owner.put('/api/admin/settings/billing', { value: { pending_expire_days: 0 } });
    const ok3 = await owner.put('/api/admin/settings/billing', { value: { pending_expire_days: 3 } });
    const e = await co();
    sqlRun('UPDATE orders SET created_at=? WHERE ref=?', Date.now() - 4 * 86400_000, e.data.order.ref);
    const list = (await owner.get('/api/admin/orders?status=expired')).data.orders;
    check('QA-4: the expiry is a setting (default 7, 1 to 90 days) and the admin list expires too', bs0.data.value.pending_expire_days === 7 && bad0.status === 400 && ok3.status === 200 && list.some((o) => o.ref === e.data.order.ref));
    await owner.put('/api/admin/settings/billing', { value: { pending_expire_days: 7 } });
    const late = await owner.post(`/api/admin/orders/${list.find((o) => o.ref === e.data.order.ref).id}/approve`);
    check('QA-4: an expired order can still be approved when the money arrives late', late.status === 200 && late.data.order.status === 'paid');
    await owner.post('/api/admin/payment-methods', { ...bank, enabled: false });
  }

  /* ---------------- QA-6: lessons done ---------------- */
  {
    const st = new Client(); const v = await login(st, 'ux-student@test.dev', 'Stu Dent');
    const uid = v.data.user.id;
    const lesson = sqlGet('SELECT id FROM school_lessons ORDER BY id LIMIT 1');
    if (lesson) sqlRun('INSERT OR REPLACE INTO school_progress(user_id, lesson_id, best_score, total, attempts, passed_at, last_at) VALUES(?,?,?,?,?,?,?)', uid, lesson.id, 5, 5, 1, Date.now(), Date.now());
    const cd = (await owner.get('/api/admin/customers/' + uid)).data;
    check('QA-6: the customer header counts VooSquare Academy lessons passed', !!lesson && cd.progress === 1 && cd.progress_split.school === 1 && cd.progress_split.academy === 0, cd.progress_split);
  }

  /* ---------------- QA-8 and QA-12: deep-link domains, application chips ---------------- */
  {
    const af = new Client(); await login(af, 'ux-aff@test.dev', 'Uche Aff');
    await af.post('/api/aff/account', {});
    const L = (await af.get('/api/aff/links')).data;
    const hosts = L.approved_domains;
    const affleego = sqlGet("SELECT url FROM products WHERE slug='affleego'");
    const ah = affleego && affleego.url ? new URL(affleego.url).hostname.replace(/^www\./, '') : 'affleego.com';
    const destKeys = L.deep_links.map((x) => x.product_key).filter((k) => !['premium', 'room'].includes(k));
    check('QA-8: every link-builder destination tool has an approved domain; Affleego never; Gatevoo only when it is a destination', destKeys.length >= 5 && !hosts.includes(ah) && (destKeys.includes('gatevoo') || !hosts.some((h) => /gatevoo/.test(h))) && ['vooads', 'replyvoo', 'castvoo', 'landvoo'].every((k) => hosts.some((h) => h.includes(k))), { hosts, destKeys });
    await af.put('/api/aff/application/1', { display_name: 'uche.ads', kind: 'individual', country: 'NG', telegram: '@uche_ads', language: 'English' });
    await af.put('/api/aff/application/2', { sources: ['Meta ads'], geos: ['NG'], volume: '$1k–$10k' });
    await af.put('/api/aff/application/3', { plan: 'I run Meta ads to Nigerian media buyers and point them to the VooSquare tools with honest landing pages.', links: [] });
    await af.put('/api/aff/application/4', { accept_terms: true, no_income_claims: true, adult: true });
    const apps = (await owner.get('/api/admin/aff/applications?status=pending')).data.applications;
    const mine = apps.find((x) => x.display_name === 'uche.ads');
    const lbl = (k) => (mine.checks.find((c) => c.key === k) || {}).label;
    check('QA-12: failed checks say what is true ("Voo ID is new (0 days)", "No links")', !!mine && lbl('voo_id_age') === 'Voo ID is new (0 days)' && lbl('links') === 'No links' && mine.age === 'under a minute', mine && { checks: mine.checks, age: mine.age });

    /* QA-7: a manual adjustment is not performance: Commission MTD and the 30-day chart leave it out, it has its own line,
     * and the balance still pays it. */
    const affId = mine.affiliate_id || mine.id;
    const before = (await owner.get(`/api/admin/aff/affiliates/${affId}`)).data;
    // SV-1: "Commission" means earned commission without manual adjustments on every surface; adjustments are their own figure.
    const csvRow = async () => { const t = String((await owner.get('/api/admin/aff/affiliates.csv')).data).replace(/^\uFEFF/, '').trim().split(/\r?\n/); const h = t[0].split(','); const r = (t.find((l) => l.startsWith(`AF-${affId},`)) || '').split(','); return { com: r[h.indexOf('commission_mtd_usd')], adj: r[h.indexOf('adjustments_mtd_usd')], hasCol: h.includes('adjustments_mtd_usd') }; };
    const affSide = async () => {
      const k = (await af.get('/api/aff/stats?period=month')).data; const rep = (await af.get('/api/aff/reports?period=month&group=day')).data; const prod = (await af.get('/api/aff/reports?period=month&group=product')).data;
      const csv = String((await af.get('/api/aff/reports.csv?period=month&group=day')).data).replace(/^\uFEFF/, '').trim().split(/\r?\n/); const ch = csv[0].split(','); const tot = csv[csv.length - 1].split(',');
      const ser = ((await af.get('/api/aff/series?days=30')).data.series || []);
      return { k_com: k.commission_cents, k_adj: k.adjustments_cents, rep_com: rep.total.commission_cents, rep_adj: rep.total.adjustments_cents, rows_adj: rep.rows.reduce((s2, x) => s2 + (x.adjustments_cents || 0), 0), prod_com: prod.total.commission_cents, prod_adj: prod.total.adjustments_cents,
        csv_com: tot[ch.indexOf('commission_usd')], csv_adj: tot[ch.indexOf('adjustments_usd')], ser_com: ser.reduce((s2, x) => s2 + x.commission_cents, 0), ser_adj: ser.reduce((s2, x) => s2 + (x.adjustments_cents || 0), 0) };
    };
    const ov = async () => (await owner.get('/api/admin/aff/overview')).data;
    const csvB = await csvRow(); const sideB = await affSide(); const ovB = await ov();
    const adj = await owner.post(`/api/admin/aff/affiliates/${affId}/adjustments`, { amount_usd: 100, reason: 'Launch bonus for QA', idempotency_key: 'ux-qa7-' + Date.now() });
    const after = (await owner.get(`/api/admin/aff/affiliates/${affId}`)).data;
    const chart = (d) => (d.series || []).reduce((s, x) => s + x.commission_cents, 0);
    check('QA-7: a $100 adjustment leaves Commission MTD and the chart as they were, shows on its own line, and is in the balance', adj.status === 200 && after.affiliate.commission_mtd_cents === before.affiliate.commission_mtd_cents && chart(after) === chart(before) && after.adjustments_mtd_cents - (before.adjustments_mtd_cents || 0) === 10000 && after.balance.available_cents - before.balance.available_cents === 10000, { adj: adj.status, before: before.affiliate && before.affiliate.commission_mtd_cents, after: after.affiliate && after.affiliate.commission_mtd_cents, adjMtd: after.adjustments_mtd_cents, chart: chart(after) });
    const list = (await owner.get('/api/admin/aff/affiliates?q=uche')).data;
    const row = list && list.affiliates && list.affiliates.find((x) => x.id === affId);
    check('QA-7: the affiliates list Commission MTD leaves adjustments out too', !row || row.commission_mtd_cents === before.affiliate.commission_mtd_cents, row);
    const csvA = await csvRow(); const sideA = await affSide(); const ovA = await ov();
    const usd = (x) => Math.round(Number(x) * 100);
    check('SV-1: affiliates.csv commission_mtd_usd leaves the adjustment out and adjustments_mtd_usd shows it', csvA.hasCol && csvA.com === csvB.com && usd(csvA.adj) - usd(csvB.adj) === 10000 && usd(csvA.com) === after.affiliate.commission_mtd_cents && usd(csvA.adj) === after.adjustments_mtd_cents, { csvB, csvA });
    check('SV-1: the affiliate\'s own KPIs, report, reports.csv and chart leave the adjustment out of Commission and show it as Adjustments',
      ['k_com', 'rep_com', 'prod_com', 'csv_com', 'ser_com'].every((k) => sideA[k] === sideB[k]) && sideA.k_adj - (sideB.k_adj || 0) === 10000 && sideA.rep_adj - sideB.rep_adj === 10000 && sideA.rows_adj - sideB.rows_adj === 10000
        && sideA.prod_adj - sideB.prod_adj === 10000 && usd(sideA.csv_adj) - usd(sideB.csv_adj) === 10000 && sideA.ser_adj - sideB.ser_adj === 10000, { sideB, sideA });
    check('SV-1: affiliate report Commission (this month) = admin Commission MTD = affiliates.csv; Adjustments agree too', sideA.k_com === after.affiliate.commission_mtd_cents && sideA.prod_com === usd(csvA.com) && sideA.k_adj === after.adjustments_mtd_cents && sideA.prod_adj === usd(csvA.adj), { sideA, csvA, admin: after.affiliate.commission_mtd_cents });
    check('SV-1: admin overview Commission earned leaves the adjustment out; adjustments_mtd_cents shows it', ovA.commission_mtd_cents === ovB.commission_mtd_cents && ovA.adjustments_mtd_cents - ovB.adjustments_mtd_cents === 10000, { b: [ovB.commission_mtd_cents, ovB.adjustments_mtd_cents], a: [ovA.commission_mtd_cents, ovA.adjustments_mtd_cents] });
    check('SV-1: the dashboard and admin screens label adjustments as their own figure', /Adjustments MTD/.test(read('js/aff-admin.js')) && /kpi-adj/.test(read('js/aff-app1.js')) && /\['Adjustments', \$c0\(t\.adjustments_cents/.test(read('js/aff-app1.js')));
    check('QA-33: payout line items keep a manual adjustment on its own line with the reason the affiliate was told', /GROUP BY type, product_key, sp, rsn/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'aff', 'payouts.js'), 'utf8')) && /l\.reason \? `: \$\{esc\(l\.reason\)\}`/.test(read('js/aff-admin.js')));
  }

  /* ---------------- QA-13, QA-14, QA-15: team presets, payment cards ---------------- */
  {
    const adm = read('js/admin.js');
    check('QA-13: the "Admin" preset leaves out affiliate super admin, which has its own label and warning', /\['admin', 'Admin', [^\]]*S\.allPerms\.filter\(\(p\) => p !== SUPER\)\]/.test(adm) && /aff_admin: \['Affiliate super admin'/.test(adm) && /perm-warn/.test(adm));
    check('QA-14: the Finance preset gets the affiliate finance views; the Affiliates entry only shows to affiliate roles', /\['finance', 'Finance', [^\]]*\['payments', 'aff_finance'\]\]/.test(adm) && /const AFF_PERMS = \['aff_admin', 'aff_manager', 'aff_fraud', 'aff_finance'\];/.test(adm));
    check('QA-15/17: method switches say On or Off; orders come first with plain status words', /m\.enabled \? 'On' : 'Off'/.test(adm) && adm.indexOf('id="orders"') < adm.indexOf('id="pmL" class="mt"') && /review: 'To check'/.test(adm));
    check('QA-4: Payments has the "unpaid orders expire after N days" control', /id="oExp"/.test(adm) && /PUT\('\/api\/admin\/settings\/billing', \{ value: \{ pending_expire_days: days \} \}\)/.test(adm));
    check('QA-16: the seeded "fill in your bank details" note only shows while the method is off', /m\.note && !m\.enabled/.test(adm));
    check('QA-32: the "Application sent" live toast is not shown over the done screen', /d\.kind === 'applied' && \/\\\/join\\\/\/\.test\(location\.hash\)/.test(read('js/aff-core.js')));
  }

  /* ---------------- QA-27: recycle bin ---------------- */
  {
    const post = (await owner.post('/api/admin/posts', { title: 'UX bin post', body: 'Delete me, then bring me back.', published: false })).data;
    const pid = post.post ? post.post.id : post.id;
    await owner.del('/api/admin/posts/' + pid);
    const bin = (await owner.get('/api/admin/recycle-bin')).data.rows;
    const row = bin.find((r) => r.table_name === 'posts' && Number(r.row_id) === Number(pid));
    const staff = new Client(); await login(staff, 'ux-settings@test.dev', 'Set Tings');
    check('QA-27: the recycle bin lists the deleted post with who deleted it, owner only', !!row && !!row.deleted_by_name && (await staff.get('/api/admin/recycle-bin')).status === 403);
    const rs = await owner.post('/api/admin/recycle-bin/restore', row.batch ? { batch: row.batch } : { id: row.id });
    check('QA-27: Restore puts it back', rs.status === 200 && !!sqlGet('SELECT 1 FROM posts WHERE id=?', pid));
    check('QA-27: the admin has a Recycle bin tab', /\['bin', 'Recycle bin', 'trash'\]/.test(read('js/admin.js')) && /function recycleTab/.test(read('js/admin-ops.js')));
  }

  /* ---------------- QA-37 and a few copy checks ---------------- */
  {
    const m = new Client(); await login(m, 'ux-voice@test.dev', 'Voi Ce');
    const vp = await m.get('/api/school/voice/prefs');
    check('QA-37: voice prefs say whether any clip exists, so Profile can hide the switches', vp.status !== 200 || typeof vp.data.available === 'boolean');
    check('QA-26: onboarding has Skip for now and Esc', /data-skip>Skip for now</.test(read('js/app.js')) && /e\.key === 'Escape'/.test(read('js/app.js')));
    check('QA-33: one name for the Academy team in lessons and certificates', !/Voo Academy team/.test(read('js/app-school.js')));
  }
};
