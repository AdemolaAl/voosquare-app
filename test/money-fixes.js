'use strict';
/*
 * Money audit regressions (MN-1 .. MN-11, /tmp findings "money.md"): commission rates, deal windows, qualification,
 * contests, statements and dates on the PAYMENT date, one payment timestamp everywhere.
 * Runs its own server on its own temporary database (NODE_ENV=test for the x-vs-now clock and the jobs endpoint,
 * AFF_JOBS=off). A few timestamps the API cannot express (an approval date last month) are set in the database directly.
 *   Standalone: node test/money-fixes.js        From npm test: called by test/smoke.js with its check().
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DAY = 86400_000; const MIN = 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lagosMonth = (t) => new Date(t + 3600_000).toISOString().slice(0, 7);

module.exports = async function moneyFixes({ check }) {
  const { DatabaseSync } = require('node:sqlite');
  const PORT = Number(process.env.MONEY_TEST_PORT) || 6100 + Math.floor(Math.random() * 500);
  const BASE = `http://127.0.0.1:${PORT}`;
  const TMP = process.env.MONEY_TEST_DIR || os.tmpdir();
  const DB = path.join(TMP, `voosquare-money-test-${process.pid}.db`);
  const UPLOADS = path.join(TMP, `voosquare-money-uploads-${process.pid}`);
  for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, UPLOADS_DIR: UPLOADS, BACKUPS_DIR: path.join(UPLOADS, 'backups'), OWNER_EMAIL: 'owner@money.test',
      NODE_ENV: 'test', EMAIL_PROVIDER: '', AFF_JOBS: 'off', TRUST_PROXY: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) break; } catch { /* wait */ } await sleep(100); }
  const sql = new DatabaseSync(DB);
  sql.exec('PRAGMA busy_timeout=5000');
  const q1 = (s, ...a) => sql.prepare(s).get(...a);
  const qa = (s, ...a) => sql.prepare(s).all(...a);
  const run = (s, ...a) => sql.prepare(s).run(...a);

  let ipN = 0;
  class Client {
    constructor() { this.jar = new Map(); ipN++; this.ip = `10.${(ipN * 7) % 250}.${(ipN * 13) % 250}.${1 + (ipN % 250)}`; }
    get cookie() { return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; '); }
    store(res) { for (const c of res.headers.getSetCookie ? res.headers.getSetCookie() : []) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i); const v = kv.slice(i + 1); if (/Max-Age=0\b/.test(c) || v === '') this.jar.delete(k); else this.jar.set(k, v); } }
    async req(method, p, body, headers = {}) {
      const h = { 'x-vs': '1', 'x-forwarded-for': this.ip, ...headers };
      if (this.jar.size) h.cookie = this.cookie;
      let payload; if (body !== undefined) { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
      const res = await fetch(BASE + p, { method, headers: h, body: payload, redirect: 'manual' });
      this.store(res);
      const buf = Buffer.from(await res.arrayBuffer());
      let data = null; const text = buf.toString('utf8'); try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, buf };
    }
    get(p, h) { return this.req('GET', p, undefined, h); }
    post(p, b, h) { return this.req('POST', p, b === undefined ? {} : b, h); }
    put(p, b, h) { return this.req('PUT', p, b, h); }
    patch(p, b, h) { return this.req('PATCH', p, b, h); }
    async login(email, name) {
      const s = await this.post('/api/auth/start', { email, name });
      const v = await this.post('/api/auth/verify', { email, code: s.data && s.data.dev_code });
      this.user = v.data && v.data.user;
      if (!this.user) throw new Error('login failed for ' + email + ': ' + JSON.stringify(s.data));
      return v;
    }
  }
  const at = (t) => ({ 'x-vs-now': String(Math.round(t)) });

  try {
    console.log('Money fixes (MN-1 .. MN-11)');
    const T0 = Date.now();
    const owner = new Client(); await owner.login('owner@money.test', 'Ejiro Owner');
    const staff = async (email, name, perms) => { const c = new Client(); await c.login(email, name); await owner.post('/api/admin/team', { email, perms }); return c; };
    const admin = await staff('admin@money.test', 'Ada Admin', ['aff_admin']);
    const fraud = await staff('fraud@money.test', 'Fatima Fraud', ['aff_fraud']);
    const fin1 = await staff('fin1@money.test', 'Finance One', ['aff_finance']);
    const fin2 = await staff('fin2@money.test', 'Finance Two', ['aff_finance']);
    const jobs = (t) => owner.post('/api/admin/aff/jobs/run', { at: Math.round(t) });
    const keyOf = (slug) => q1('SELECT api_key FROM products WHERE slug=?', slug).api_key;
    const pidOf = (slug) => q1('SELECT id FROM products WHERE slug=?', slug).id;
    let evn = 0;
    async function ev(slug, cust, type, usd, o = {}) {
      const id = o.id || `${slug}_${++evn}_${T0}`;
      const body = { event_id: id, voo_id: cust.user.voo_id, type, value_usd: usd, ...(o.occurred_at ? { occurred_at: new Date(o.occurred_at).toISOString() } : {}), ...(o.original ? { original_event_id: o.original } : {}) };
      await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer ' + keyOf(slug), 'content-type': 'application/json' }, body: JSON.stringify({ events: [body] }) });
      const row = q1('SELECT * FROM events WHERE product_id=? AND ext_id=?', pidOf(slug), id);
      return { id, row, com: row ? q1('SELECT * FROM aff_commissions WHERE uniq_key=?', 'rs:event:' + row.id) : null };
    }
    // Paid orders (Inner Circle) through the manual method, approved by the owner.
    await owner.post('/api/admin/payment-methods', { id: 6, type: 'manual', name: 'Bank transfer', enabled: true, currency: 'USD', rate: 1, config: { instructions: 'Pay to 0000', details: [], proof_mode: 'either' } });
    await owner.post('/api/admin/rooms', { id: 13, name: 'Inner Circle with Dchessking', access: 'paid', price_usd: 299, period_days: 30, approval_required: false, seats: 25 });

    // Contest over the whole run. Points: 1 per customer, Castvoo 10, Landvoo 12. Pro multiplier raised to x1.5 (favourable: applies now).
    const sNow = (await admin.get('/api/admin/aff/settings')).data.settings;
    await admin.put('/api/admin/aff/settings', { tiers: sNow.tiers.map((t, i) => (i === 1 ? { ...t, multiplier_bp: 15000 } : t)) });
    const ctEnd = T0 + 30 * MIN;
    const ct = await admin.post('/api/admin/aff/contests', { title: 'Money fixes race', kind: 'monthly', starts_at: T0 - MIN, ends_at: ctEnd, qual_days: 0, min_points: 1, multipliers: true,
      scoring: { points: 1, product_points: { castvoo: 10, landvoo: 12 } }, prizes: [{ label: '1st', rank_from: 1, rank_to: 1, amount_cents: 10000 }], rising: { amount_cents: 4000, max_tier: 1 }, announce: false });
    const CT = ct.data.contest.id;

    const WALLET = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
    async function makeAff(email, name, handle, { parent = null, approveIt = true } = {}) {
      const c = new Client(); c.tag = handle;
      if (parent) await c.get(`/a/${parent.aff.code}?join=1`);
      await c.login(email, name);
      await c.post('/api/aff/account', {});
      await c.put('/api/aff/application/1', { display_name: handle, country: 'NG', telegram: '@' + handle + '_tg', kind: 'individual' });
      await c.put('/api/aff/application/2', { sources: ['Meta ads'], geos: ['NG'], volume: '$10k–$50k', products: ['joinvoo'] });
      await c.put('/api/aff/application/3', { years: '3–5', plan: 'Reviews of Joinvoo and Replyvoo on my Telegram channel for Nigerian buyers, plus Meta ads to landers.', links: ['https://t.me/x'] });
      const s4 = await c.put('/api/aff/application/4', { accept_terms: true, no_income_claims: true, adult: true, usdt: WALLET });
      c.aff = s4.data.account;
      if (approveIt) await approve(c);
      return c;
    }
    async function approve(c) { await owner.post(`/api/admin/aff/applications/${c.aff.id}/approve`); c.aff = (await c.get('/api/aff/me')).data.account; }
    let cn = 0;
    async function cust(aff, tag, product = 'joinvoo') {
      const c = new Client(); c.tag = tag;
      await c.get(`/a/${aff.aff.code}?p=${product}&sub1=s${++cn}`);
      await c.login(`${tag}.${T0 % 100000}@cust.money.test`, `Cust ${tag}`);
      return c;
    }
    const comRow = (key) => q1('SELECT * FROM aff_commissions WHERE uniq_key=?', key);

    /* ---------------------------------------------------------------- MN-1: tier on the payment date (aff_tier_history) */
    const T = await makeAff('tina@money.test', 'Tina T', 'tina');
    const tc = []; const te = [];
    for (let i = 1; i <= 10; i++) { tc[i] = await cust(T, 't' + i); te[i] = await ev('joinvoo', tc[i], 'spend', 10); }
    check('MN-1: fast lane moves T to Pro at the 10th qualified customer', (await T.get('/api/aff/me')).data.account.tier.tier === 'Pro');
    const tFast = te[10].row.created_at;
    // Dated between t1's payment (after the click and approval) and the 10th qualified payment that moved T to Pro.
    const late = await ev('joinvoo', tc[1], 'spend', 30, { occurred_at: Math.round((te[1].row.created_at + tFast) / 2) });
    check('MN-1: a payment dated before the tier change, reported after it, pays the old tier rate (20%, not 25%)', late.com && late.com.rate_bp === 2000 && late.com.amount_cents === 600, late.com);
    const after = await ev('joinvoo', tc[2], 'spend', 30);
    check('MN-1: a payment after the tier change pays the new tier rate (25%)', after.com && after.com.rate_bp === 2500 && after.com.amount_cents === 750, after.com);

    /* ---------------------------------------------------------------- MN-8: sub page net of override clawbacks */
    const S = await makeAff('sola@money.test', 'Sola S', 'sola', { parent: T });
    const sc = []; const se = [];
    for (let i = 1; i <= 5; i++) { sc[i] = await cust(S, 's' + i); se[i] = await ev('joinvoo', sc[i], 'spend', 20); }
    const ovGross = q1("SELECT COALESCE(SUM(amount_cents),0) s FROM aff_commissions WHERE affiliate_id=? AND type='sub_override' AND status NOT IN ('reversed','declined')", T.aff.id).s;
    await ev('joinvoo', sc[1], 'chargeback', 20, { original: se[1].id });
    const ovClaw = q1("SELECT COALESCE(SUM(k.amount_cents),0) s FROM aff_commissions k JOIN aff_commissions o ON o.id=k.source_commission_id AND o.type='sub_override' WHERE k.affiliate_id=? AND k.type='clawback'", T.aff.id).s;
    const subs = (await T.get('/api/aff/subs')).data;
    check('MN-8: a chargeback after release claws back the parent override', ovGross > 0 && ovClaw < 0, { ovGross, ovClaw });
    check('MN-8: sub network page total = overrides − override clawbacks (agrees with the ledger)', subs.total_earned_cents === ovGross + ovClaw, { total: subs.total_earned_cents, ovGross, ovClaw });
    check('MN-8: per-sub "your earnings" adds up to the net total', subs.subs.reduce((a, x) => a + x.your_earnings_cents, 0) === subs.total_earned_cents, subs.subs);

    /* ---------------------------------------------------------------- MN-2: Special deal window decides, not status or receive time */
    const R = await makeAff('remi@money.test', 'Remi R', 'remi');
    const rc = []; for (let i = 1; i <= 4; i++) rc[i] = await cust(R, 'r' + i);
    const d1 = await admin.post(`/api/admin/aff/affiliates/${R.aff.id}/revshare-deals`, { product_key: 'spyvoo', rate_pct: 60, duration: 'until', ends_at: Date.now() + 1500, confirm: true });
    const deal1 = q1('SELECT * FROM aff_deals WHERE id=?', d1.data.deal.id);
    while (Date.now() < deal1.ends_at + 300) await sleep(100);
    await jobs(Date.now());
    check('MN-2: the hourly job marked the expired deal ended', q1('SELECT status FROM aff_deals WHERE id=?', deal1.id).status === 'ended');
    const in1 = await ev('spyvoo', rc[1], 'spend', 29, { occurred_at: deal1.ends_at - 100 });
    check('MN-2: payment dated inside the window, reported after the job ended the deal, earns the deal rate (60%)', in1.com && in1.com.rate_bp === 6000 && in1.com.amount_cents === 1740, in1.com);
    const out1 = await ev('spyvoo', rc[2], 'spend', 29, { occurred_at: deal1.ends_at });
    check('MN-2: payment dated exactly at the window end earns the tier rate (20%)', out1.com && out1.com.rate_bp === 2000, out1.com);
    const d2 = await admin.post(`/api/admin/aff/affiliates/${R.aff.id}/revshare-deals`, { product_key: 'joinvoo', rate_pct: 60, duration: 'forever', confirm: true });
    await sleep(30);
    const tEnd = Date.now();
    await admin.patch(`/api/admin/aff/deals/${d2.data.deal.id}`, { status: 'ended' }, at(tEnd));
    await sleep(30);
    const in2 = await ev('joinvoo', rc[3], 'spend', 10, { occurred_at: tEnd - 10 });
    const out2 = await ev('joinvoo', rc[4], 'spend', 10, { occurred_at: tEnd + 5 });
    check('MN-2: a deal ended early ends at the time it was ended (before: deal rate, after: tier rate)', in2.com && in2.com.rate_bp === 6000 && out2.com && out2.com.rate_bp === 2000, { in2: in2.com && in2.com.rate_bp, out2: out2.com && out2.com.rate_bp });

    /* ---------------------------------------------------------------- MN-3 + MN-4: excluded products, fraud reversal in contests */
    const F = await makeAff('femi@money.test', 'Femi F', 'femi');
    const f1 = await cust(F, 'f1'); const f2 = await cust(F, 'f2'); const f3 = await cust(F, 'f3'); const f4 = await cust(F, 'f4');
    const ef1 = await ev('joinvoo', f1, 'spend', 10); await ev('joinvoo', f2, 'spend', 10);
    const ic = await f3.post('/api/billing/checkout', { item: 'room', room_id: 13, method_id: 6 });
    if (ic.status === 200) await owner.post(`/api/admin/orders/${ic.data.order.id}/approve`);
    await ev('gatevoo', f4, 'spend', 100);
    const qOf = (c) => { const r = q1('SELECT qualified_at, payments FROM aff_customers WHERE user_id=?', c.user.id); return r || {}; };
    check('MN-3: an Inner Circle-only customer is tracked but not a qualified FTD', ic.status === 200 && qOf(f3).payments === 1 && qOf(f3).qualified_at == null, { ic: ic.status, c: qOf(f3) });
    check('MN-3: a Gatevoo-only customer (Gatevoo not commissionable) is not a qualified FTD', qOf(f4).payments === 1 && qOf(f4).qualified_at == null, qOf(f4));
    check('MN-3: F counts 2 qualified customers (not 4)', q1('SELECT COUNT(*) n FROM aff_customers WHERE affiliate_id=? AND qualified_at IS NOT NULL', F.aff.id).n === 2);
    const fr = await fraud.post('/api/admin/aff/clawbacks', { affiliate_id: F.aff.id, commission_ids: [ef1.com.id], reason: 'Proven fraud: linked devices' });
    const frOk = await fin1.post(`/api/admin/aff/clawbacks/${fr.data.clawback.id}/approve`, {});
    check('MN-4: fraud reversal proposed and approved by a second person', fr.status === 200 && frOk.status === 200, [fr.status, frOk.status]);

    /* ---------------------------------------------------------------- MN-11: Rising prize without multipliers */
    const P = await makeAff('pat@money.test', 'Pat Pro', 'pat');
    await admin.patch(`/api/admin/aff/affiliates/${P.aff.id}`, { tier_override: 1 });
    const Q = await makeAff('quin@money.test', 'Quin Starter', 'quin');
    const p1 = await cust(P, 'p1', 'castvoo'); await ev('castvoo', p1, 'spend', 19); // 10 points x1.5 = 15
    const q1c = await cust(Q, 'q1', 'landvoo'); await ev('landvoo', q1c, 'spend', 19); // 12 points x1.0 = 12

    /* ---------------------------------------------------------------- MN-6 + MN-9: CPA in review; dates in Lagos */
    const Cc = await makeAff('chidi@money.test', 'Chidi C', 'chidi');
    const cd = await admin.post(`/api/admin/aff/affiliates/${Cc.aff.id}/deals`, { product_key: 'replyvoo', model: 'cpa', cpa_usd: 100, monthly_cap: 3 });
    const x1 = await cust(Cc, 'x1', 'replyvoo'); await ev('replyvoo', x1, 'spend', 129);
    const x2 = await cust(Cc, 'x2', 'joinvoo'); await ev('joinvoo', x2, 'spend', 30);
    const monthNow = lagosMonth(Date.now());
    const stC = (await Cc.get(`/api/aff/statements?month=${monthNow}`)).data;
    const balC = (await Cc.get('/api/aff/balance')).data;
    check('MN-6: statement "earned" leaves out CPA still in review (= lifetime balance)', balC.in_review_cents === 10000 && stC.earned_cents === balC.lifetime_cents, { st: stC.earned_cents, bal: balC });
    check('MN-6: statement shows CPA in review apart', stC.in_review_cents === 10000, stC.in_review_cents);
    const repC = (await Cc.get('/api/aff/reports?period=month&group=product')).data;
    check('MN-6: report commission leaves out CPA in review', repC.total.commission_cents === balC.lifetime_cents, { rep: repC.total.commission_cents, life: balC.lifetime_cents });
    const tChg = Date.parse('2026-10-04T23:30:00Z'); // 5 Oct 00:30 Lagos; notice 7 days → 12 Oct (Lagos)
    await admin.patch(`/api/admin/aff/deals/${cd.data.deal.id}`, { cpa_usd: 80 }, at(tChg));
    const nC = (await Cc.get('/api/aff/notifications')).data.notifications.find((n) => /CPA changes from/.test(n.text));
    check('MN-9: CPA reduction notice uses the Lagos date of the effective time (2026-10-12, not UTC 2026-10-11)', !!nC && /From 2026-10-12,/.test(nC.text), nC && nC.text);

    /* ---------------------------------------------------------------- MN-7: dated before approval, reported after → member rules */
    const Dd = await makeAff('dayo@money.test', 'Dayo D', 'dayo', { approveIt: false });
    const dc = await cust(Dd, 'd1', 'spyvoo');
    await sleep(20);
    await approve(Dd);
    const dApproved = q1('SELECT approved_at FROM aff_affiliates WHERE id=?', Dd.aff.id).approved_at;
    const ed = await ev('spyvoo', dc, 'spend', 29, { occurred_at: dApproved - 2 * MIN });
    const dRef = (await Dd.get('/api/me/referrals')).data;
    check('MN-7: payment dated before approval earns nothing on the affiliate side', !ed.com && q1('SELECT COUNT(*) n FROM aff_commissions WHERE customer_user_id=?', dc.user.id).n === 0);
    check('MN-7: ...and is paid by the member referral program (10% of $29)', dRef.paying === 1 && dRef.earned_usd === 2.9, { paying: dRef.paying, earned: dRef.earned_usd });

    /* ---------------------------------------------------------------- MN-10: one payment timestamp */
    const skew = await ev('landvoo', q1c, 'spend', 19, { occurred_at: Date.now() + 9 * MIN });
    const conv = q1('SELECT occurred_at FROM aff_conversions WHERE source_key=?', 'event:' + skew.row.id);
    check('MN-10: affiliate conversion time = revenue analytics time (events.created_at) for a skewed event', conv && conv.occurred_at === skew.row.created_at, { conv, ev: skew.row.created_at });

    /* ---------------------------------------------------------------- MN-5: commission in the payment month */
    const prevKey = (() => { const [y, m] = monthNow.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; })();
    const tPrev = Date.parse(prevKey + '-15T12:00:00Z');
    run('UPDATE aff_affiliates SET approved_at=? WHERE id=?', tPrev - 20 * DAY, T.aff.id); // T approved before last month (API cannot backdate)
    const k = await cust(T, 'k1');
    run('UPDATE users SET created_at=? WHERE id=?', tPrev - DAY, k.user.id);
    run('UPDATE aff_attributions SET locked_at=?, click_at=? WHERE customer_user_id=?', tPrev - DAY, tPrev - DAY - MIN, k.user.id);
    const ek = await ev('joinvoo', k, 'spend', 50, { occurred_at: tPrev });
    check('MN-5/MN-1: last month payment reported now pays last month\'s tier (Starter 20%)', ek.com && ek.com.rate_bp === 2000 && ek.com.amount_cents === 1000, ek.com);
    const stPrev = (await T.get(`/api/aff/statements?month=${prevKey}`)).data;
    const stCur = (await T.get(`/api/aff/statements?month=${monthNow}`)).data;
    check('MN-5: last month\'s statement carries the commission of last month\'s payment, marked as reported late', stPrev.earned_cents === 1000 && stPrev.late_cents === 1000, stPrev);
    const curRows = qa("SELECT amount_cents, COALESCE(earned_at, created_at) e FROM aff_commissions WHERE affiliate_id=? AND status IN ('available','paid','hold','pending_activation')", T.aff.id).filter((r) => lagosMonth(r.e) === monthNow).reduce((a, r) => a + r.amount_cents, 0);
    check('MN-5: this month\'s statement does not include it', stCur.earned_cents === curRows, { st: stCur.earned_cents, curRows });
    const rep = (await T.get(`/api/aff/reports?from=${prevKey}-01&to=${monthNow}-28&group=month`)).data;
    const rowPrev = rep.rows.find((r) => r.key === prevKey) || {};
    check('MN-5: report month row for last month: revenue, qualified and commission on the same (payment) date', rowPrev.revenue_cents === 5000 && rowPrev.qualified === 1 && rowPrev.commission_cents === 1000, rowPrev);
    const led = (await T.get('/api/aff/ledger?limit=500')).data.rows.find((r) => r.id === ek.com.id);
    check('MN-5: ledger row keeps when it was recorded (at) and adds the payment date (earned_at)', led && led.earned_at === tPrev && led.at > tPrev, led);

    /* ---------------------------------------------------------------- MN-9: payout email date in Lagos */
    await fin1.post(`/api/admin/aff/affiliates/${T.aff.id}/adjustments`, { amount_usd: 100, reason: 'Bonus for the test', idempotency_key: 'mf-' + T0 });
    await fin1.post(`/api/admin/aff/kyc/${T.aff.id}`, { status: 'verified' });
    const rq = await T.post('/api/aff/payouts', { method: 'usdt_trc20' });
    const tPaid = Date.parse('2026-10-31T23:30:00Z'); // 1 Nov 00:30 Lagos
    const pd = await fin2.post(`/api/admin/aff/payouts/${rq.data.payout && rq.data.payout.id}/paid`, { tx_hash: 'a'.repeat(64) }, at(tPaid));
    const em = q1("SELECT vars FROM email_queue WHERE template='aff_payout_paid' AND to_email=? ORDER BY id DESC LIMIT 1", 'tina@money.test');
    const vars = em ? JSON.parse(em.vars) : {};
    check('MN-9: payout paid at 31 Oct 23:30 UTC: the email says 1 Nov 2026 like the receipt (Lagos)', rq.status === 200 && pd.status === 200 && vars.date === '1 Nov 2026', { rq: rq.status, pd: pd.status, date: vars.date });

    /* ---------------------------------------------------------------- contest results (MN-3, MN-4, MN-11) */
    await admin.post(`/api/admin/aff/contests/${CT}/finalise`, {}, at(ctEnd + 1000));
    const sg = await fraud.post(`/api/admin/aff/contests/${CT}/signoff`, {}, at(ctEnd + 2000));
    const lb = (await admin.get(`/api/admin/aff/contests/${CT}/leaderboard`, at(ctEnd + 3000))).data.rows || [];
    const rowF = lb.find((r) => r.affiliate_id === F.aff.id) || {};
    check('MN-4: the customer reversed for proven fraud is removed from the contest', rowF.removed === 1 && rowF.points === 1, rowF);
    check('MN-3: Inner Circle-only and Gatevoo-only customers score no contest points', rowF.points === 1, rowF);
    const winners = sg.data && sg.data.contest ? sg.data.contest.winners : (await admin.get('/api/admin/aff/contests', at(ctEnd + 4000))).data.contests.find((c) => c.id === CT).winners;
    const rising = (winners || []).find((w) => w.prize === 'Rising prize');
    const rowP = lb.find((r) => r.affiliate_id === P.aff.id) || {}; const rowQ = lb.find((r) => r.affiliate_id === Q.aff.id) || {};
    check('MN-11: Pro outranks Starter with the multiplier (15 vs 12) but has fewer raw points (10 vs 12)', rowP.rank < rowQ.rank && rowP.points === 10 && rowQ.points === 12, { rowP, rowQ });
    check('MN-11: the Rising prize goes to the most raw points among Starter/Pro (Q), not the first in the multiplied ranking', rising && rising.affiliate_id === Q.aff.id, winners);

    /* ---------------------------------------------------------------- MN-1: tier rate change is forward only (settings rate log) */
    // Customers attributed before the change (a payment is never rated before its attribution).
    const q2 = await cust(Q, 'q2', 'castvoo'); const q3 = await cust(Q, 'q3', 'castvoo');
    await sleep(2100);
    const s2 = (await admin.get('/api/admin/aff/settings')).data.settings;
    const tChange = Date.now();
    await admin.put('/api/admin/aff/settings', { tiers: s2.tiers.map((t, i) => (i === 0 ? { ...t, rate_bp: 2200 } : t)) });
    await sleep(20);
    const before = await ev('castvoo', q2, 'spend', 19, { occurred_at: tChange - 2000 });
    const afterR = await ev('castvoo', q3, 'spend', 19);
    check('MN-1: payment dated before the Starter rate change keeps 20% (380), after it pays 22% (418)', before.com && before.com.amount_cents === 380 && afterR.com && afterR.com.amount_cents === 418, { before: before.com && before.com.amount_cents, after: afterR.com && afterR.com.amount_cents });
    const q4 = await cust(Q, 'q4', 'castvoo');
    const pre = await ev('castvoo', q4, 'spend', 19, { occurred_at: tChange - 2000 });
    check('MN-1: a payment backdated before the customer was attributed is rated at the attribution date (22%), not earlier', pre.com && pre.com.amount_cents === 418, pre.com);
    check('MN-1: the rate change is logged in aff_rate_history', q1("SELECT COUNT(*) n FROM aff_rate_history WHERE kind='tiers'").n >= 1);
  } catch (e) {
    check('money fixes: test crashed: ' + e.message, false, e.stack);
  } finally {
    srv.kill('SIGTERM');
    await sleep(200);
    try { sql.close(); } catch { /* ignore */ }
    for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    try { fs.rmSync(UPLOADS, { recursive: true, force: true }); } catch { /* ignore */ }
    if (/Error/.test(log) && process.env.MONEY_TEST_LOG) console.log(log.slice(-3000));
  }
};

if (require.main === module) {
  let passed = 0; let failed = 0;
  const check = (name, cond, extra) => { if (cond) { passed++; console.log('  ok  ' + name); } else { failed++; console.log('  FAIL ' + name, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };
  module.exports({ check }).then(() => { console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); });
}
