'use strict';
/* End-to-end smoke test. Starts the server on a temporary database and walks every main flow.
 * Run: npm test   (exit code 0 = all good) */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Every test server sits behind one simulated proxy hop (TRUST_PROXY=1: the last X-Forwarded-For entry is the client), and
 * /healthz details need the health key. Spawned servers inherit both through process.env. */
process.env.TRUST_PROXY = '1';
process.env.HEALTH_KEY = process.env.HEALTH_KEY || 'test-health-key';
/* A port that is really free (and its voice-mock partner): another VooSquare already listening there would answer
 * instead of ours (IN-6). Checked by binding it in a short child process. */
function portFree(p) {
  const { spawnSync } = require('node:child_process');
  return spawnSync(process.execPath, ['-e', `const s=require('net').createServer();s.once('error',()=>process.exit(1));s.listen(${p},()=>s.close(()=>process.exit(0)))`], { timeout: 5000 }).status === 0;
}
let PORT = 0;
for (let i = 0; i < 60 && !PORT; i++) { const p = 4300 + Math.floor(Math.random() * 500); if (portFree(p) && portFree(p + 1100)) PORT = p; }
if (!PORT) PORT = 4300 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(os.tmpdir(), `voosquare-test-${process.pid}.db`);
const UPLOADS = path.join(os.tmpdir(), `voosquare-test-uploads-${process.pid}`);
const BACKUPS = path.join(os.tmpdir(), `voosquare-test-backups-${process.pid}`);
/* Teaching voice: clips go to their own folder; both providers point at a local mock (test/voice.js starts it). */
const VOICE = path.join(os.tmpdir(), `voosquare-test-voice-${process.pid}`);
const VOICE_MOCK_PORT = PORT + 1100;
/* VooSquare Academy: the fixture school (every slide type) plus two broken files the loader must skip. */
const SCHOOL_EXTRA = path.join(os.tmpdir(), `voosquare-test-school-${process.pid}`);
fs.rmSync(SCHOOL_EXTRA, { recursive: true, force: true });
fs.cpSync(path.join(__dirname, 'fixtures', 'school'), SCHOOL_EXTRA, { recursive: true });
fs.writeFileSync(path.join(SCHOOL_EXTRA, 'lab', '99-broken.json'), '{ "school": "lab", "order": 99, ');
{
  const good = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'school', 'lab', '01-every-slide.json'), 'utf8'));
  good.slug = 'bad-answer'; good.order = 98; good.lessons[0].quiz[2].answer = 7;
  fs.writeFileSync(path.join(SCHOOL_EXTRA, 'lab', '98-bad-answer.json'), JSON.stringify(good));
}
const http = require('node:http');
const crypto = require('node:crypto');

/* Tiny image files: the server reads only the header (type + size), so a valid header is enough. */
function fakePng(w, h, pad = 200) {
  const b = Buffer.alloc(33 + pad);
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
function fakeJpeg(w, h) {
  return Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00, 0xFF, 0xC0, 0x00, 0x11, 0x08]), Buffer.from([h >> 8, h & 255, w >> 8, w & 255]), Buffer.alloc(120)]);
}
async function uploadRaw(client, full, thumb, purpose = 'chat', headers = {}) {
  const body = Buffer.concat([full, thumb || Buffer.alloc(0)]);
  const res = await fetch(`${BASE}/api/uploads?purpose=${purpose}`, { method: 'POST', headers: { 'x-vs': '1', cookie: client.cookie, 'content-type': 'image/png', 'x-thumb-bytes': String(thumb ? thumb.length : 0), ...headers }, body });
  let data = null; try { data = await res.json(); } catch { /* ignore */ }
  return { status: res.status, data };
}

/* A stand-in for Gatevoo's API (and a custom provider) on localhost. */
function mockProvider() {
  const st = { invoices: {}, lastCreate: null, customBody: null, paid: false };
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.headers.authorization !== 'Bearer gk_test' && req.url.startsWith('/api/v1')) return send(401, { error: 'bad key' });
      if (req.method === 'GET' && req.url === '/api/v1/me') return send(200, { merchant: { name: 'Zedapex' } });
      if (req.method === 'POST' && req.url === '/api/v1/invoices') {
        const b = JSON.parse(raw); st.lastCreate = b;
        const id = 'inv_' + (Object.keys(st.invoices).length + 1);
        st.invoices[id] = { id, order_id: b.order_id, amount_usd: b.amount_usd, status: 'pending', paid_amount: 0 };
        return send(200, { id, checkout_url: `https://pay.gatevoo.test/i/${id}`, status: 'pending' });
      }
      const m = /^\/api\/v1\/invoices\/([\w-]+)$/.exec(req.url);
      if (req.method === 'GET' && m) return st.invoices[m[1]] ? send(200, st.invoices[m[1]]) : send(404, { error: 'nope' });
      if (req.method === 'POST' && req.url === '/custom/create') { st.customBody = JSON.parse(raw); return send(200, { data: { link: 'https://pay.custom.test/c_9', id: 'c_9' } }); }
      send(404, {});
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ st, srv, port: srv.address().port })));
}
/* Live updates: open /api/stream like a browser and keep everything it sends. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40); } return !!(await fn()); }
async function openStream(client, ch) {
  const ctl = new AbortController();
  const res = await fetch(`${BASE}/api/stream?ch=${encodeURIComponent(ch)}`, { headers: client && client.cookie ? { cookie: client.cookie } : {}, signal: ctl.signal });
  const st = { text: '', ended: false, close: () => ctl.abort() };
  const reader = res.body.getReader(); const dec = new TextDecoder();
  st.done = (async () => { try { for (;;) { const { done, value } = await reader.read(); if (done) break; st.text += dec.decode(value, { stream: true }); } } catch { /* aborted */ } st.ended = true; })();
  st.events = (name) => st.text.split('\n\n').filter((b) => b.startsWith(`event: ${name}\n`)).map((b) => JSON.parse(b.split('\ndata: ')[1]));
  await until(() => st.text.includes('event: ready'), 2000);
  st.channels = (st.events('ready')[0] || {}).channels || [];
  return st;
}
let passed = 0; let failed = 0;

function check(name, cond, extra) {
  if (cond) { passed++; process.stdout.write(`  ✓ ${name}\n`); }
  else { failed++; process.stdout.write(`  ✗ ${name}${extra ? '  ' + JSON.stringify(extra).slice(0, 300) : ''}\n`); }
}

class Client {
  constructor() { this.cookie = ''; }
  async req(method, p, body, headers = {}) {
    const h = { 'x-vs': '1', ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (body !== undefined) {
      if (typeof body === 'string') { payload = body; h['content-type'] = h['content-type'] || 'application/x-www-form-urlencoded'; }
      else { payload = JSON.stringify(body); h['content-type'] = 'application/json'; }
    }
    const res = await fetch(BASE + p, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) if (c.startsWith('vs_sess=')) this.cookie = c.split(';')[0];
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  get(p, h) { return this.req('GET', p, undefined, h); }
  post(p, b, h) { return this.req('POST', p, b === undefined ? {} : b, h); }
  put(p, b) { return this.req('PUT', p, b); }
  patch(p, b) { return this.req('PATCH', p, b); }
  del(p) { return this.req('DELETE', p); }
  async login(email, name) {
    const s = await this.post('/api/auth/start', { email, name });
    const v = await this.post('/api/auth/verify', { email, code: s.data.dev_code });
    return v;
  }
}

/* Boots a second server on a copy of the test database (after `mutate` edits the copy), lets it run its boot seed, stops it
 * and returns the copy for inspection. Used to check one-time upgrades of older databases. */
async function bootCopy(tag, mutate) {
  const { DatabaseSync } = require('node:sqlite');
  const file = `${DB}-${tag}.db`;
  for (const f of [file, file + '-wal', file + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  const live = new DatabaseSync(DB); live.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); live.close();
  const db = new DatabaseSync(file); mutate(db); db.close();
  const port = PORT + 600 + Math.floor(Math.random() * 200);
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DATABASE_PATH: file, UPLOADS_DIR: UPLOADS, VOICE_DIR: VOICE, OWNER_EMAIL: 'owner@test.dev', NODE_ENV: 'test', EMAIL_PROVIDER: '' }, stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/healthz`); if (r.ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
  srv.kill('SIGTERM');
  await new Promise((r) => srv.once('exit', r));
  const out = new DatabaseSync(file);
  const res = {
    product: out.prepare("SELECT * FROM products WHERE slug='spyvoo'").get(),
    ads: JSON.parse((out.prepare("SELECT value FROM settings WHERE key='ads'").get() || {}).value || 'null'),
    seq: out.prepare('SELECT key FROM email_sequence ORDER BY sort, delay_hours').all().map((r) => r.key),
    template: !!out.prepare("SELECT 1 FROM email_templates WHERE key='seq_spyvoo'").get(),
  };
  out.close();
  for (const f of [file, file + '-wal', file + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
  return res;
}

async function main() {
  const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, UPLOADS_DIR: UPLOADS, OWNER_EMAIL: 'owner@test.dev', NODE_ENV: 'test', EMAIL_PROVIDER: '', STREAM_RECHECK_MS: '400', BACKUPS_DIR: BACKUPS, SCHOOL_EXTRA_DIR: SCHOOL_EXTRA,
      VOICE_DIR: VOICE, VOICE_API_BASE: `http://127.0.0.1:${VOICE_MOCK_PORT}`, VOICE_BACKOFF_MS: '15', ELEVENLABS_API_KEY: 'el_test_key', OPENAI_API_KEY: 'sk-test-key' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + '/healthz'); if (r.ok) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }

  try {
    console.log('Pages');
    for (const p of ['/', '/login', '/app', '/admin', '/widget.js', '/css/shared.css', '/js/shared.js', '/assets/logo-icon.svg', '/email/hero-welcome.gif', '/healthz']) {
      const r = await fetch(BASE + p); check(`GET ${p} → 200`, r.status === 200, r.status);
    }
    check('unknown page → 404', (await fetch(BASE + '/nope')).status === 404);

    console.log('Site and auth');
    const anon = new Client();
    const site = await anon.get('/api/site');
    check('site has products, rooms, courses, posts', site.data.products.length >= 6 && site.data.rooms.length >= 5 && site.data.courses.length >= 1 && site.data.posts.length >= 1);
    {
      const spy = site.data.products.find((p) => p.slug === 'spyvoo');
      const stages = [...new Set(site.data.products.map((p) => p.stage))];
      check('Spyvoo is live as new, first in the Research stage', spy && spy.status === 'new' && spy.stage === 'Research' && stages[0] === 'Research' && spy.url === 'https://spyvoo.com' && spy.icon === 'spyvoo' && spy.offer === 'Start free', spy);
      const slide = (site.data.ads || []).find((x) => x.id === 'sl-spy');
      check('Spyvoo Spotlight slide on the website', slide && slide.theme === 'spy' && slide.scene === 'feed' && slide.cta_text === 'Start free' && slide.cta_url === 'https://spyvoo.com', slide);
      // Older databases (no Spyvoo, untouched slides) get it once; edited slides and a deleted Spyvoo are left alone.
      const before = (db) => {
        db.exec("DELETE FROM products WHERE slug='spyvoo'; DELETE FROM settings WHERE key='seeded_spyvoo'; DELETE FROM email_sequence WHERE key='seq_spyvoo'; DELETE FROM email_templates WHERE key='seq_spyvoo'");
        const ads = JSON.parse(db.prepare("SELECT value FROM settings WHERE key='ads'").get().value);
        return { ...ads, slides: ads.slides.filter((x) => x.id !== 'sl-spy') };
      };
      const up = await bootCopy('up', (db) => { const ads = before(db); db.prepare("UPDATE settings SET value=? WHERE key='ads'").run(JSON.stringify(ads)); });
      const edited = await bootCopy('edited', (db) => { const ads = before(db); ads.interval = 9; db.prepare("UPDATE settings SET value=? WHERE key='ads'").run(JSON.stringify(ads)); });
      const gone = await bootCopy('gone', (db) => { db.exec("DELETE FROM products WHERE slug='spyvoo'"); });
      check('upgrade adds Spyvoo, its slide and its email once', up.product && up.product.stage === 'Research' && up.product.status === 'new' && up.product.client_id && up.ads.slides.filter((x) => x.id === 'sl-spy').length === 1 && up.ads.slides[1].id === 'sl-spy' && up.template && up.seq[up.seq.length - 1] === 'seq_spyvoo', up.seq);
      check('upgrade leaves edited slides alone', edited.product && edited.ads.interval === 9 && !edited.ads.slides.some((x) => x.id === 'sl-spy'));
      check('a deleted Spyvoo stays deleted', !gone.product && gone.seq.filter((k) => k === 'seq_spyvoo').length === 1);
    }
    check('mutations need x-vs header', (await fetch(BASE + '/api/auth/logout', { method: 'POST' })).status === 403);
    const owner = new Client();
    const ov = await owner.login('owner@test.dev', 'Ejiro Owner');
    check('owner signs up and is owner', ov.status === 200 && ov.data.user.perms.includes('*'), ov.data);
    const bad = await new Client().post('/api/auth/verify', { email: 'x@test.dev', code: '000000' });
    check('wrong code rejected', bad.status === 400);
    const ada = new Client();
    const av = await ada.login('ada@test.dev', 'Ada Member');
    check('member signs up', av.status === 200 && av.data.isNew === true && av.data.user.perms.length === 0);
    const me = await ada.patch('/api/me', { handle: 'ada_buys', country: 'ng', avatar: { skin: 2, hair: 3, shirt: 1 }, onboarded: true });
    check('profile and face saved', me.data.user.handle === 'ada_buys' && me.data.user.country === 'NG' && me.data.user.avatar.skin === 2);
    check('member cannot open admin', (await ada.get('/api/admin/overview')).status === 403);
    const home = await ada.get('/api/me/home');
    check('home loads tools and courses', home.status === 200 && home.data.tools.length >= 6 && home.data.courses.length >= 1);
    check('welcome series queued', (await owner.get('/api/admin/emails')).data.queue.some((q) => q.template === 'welcome'));

    console.log('Community');
    // A plain paid room (no application) for the payment tests. Inner Circle is invite only.
    const plainPaid = await owner.post('/api/admin/rooms', { name: 'Offer Lab', topic: 'Paid rooms', access: 'paid', price_usd: 49, period_days: 30 });
    check('plain paid room is not invite only', plainPaid.status === 200 && plainPaid.data.room.approval_required === 0);
    const rooms = (await ada.get('/api/rooms')).data.rooms;
    const general = rooms.find((r) => r.slug === 'general');
    const lounge = rooms.find((r) => r.access === 'premium');
    const paid = rooms.find((r) => r.id === plainPaid.data.room.id);
    const ann = rooms.find((r) => r.read_only);
    check('free room unlocked, premium locked', general.unlocked && !lounge.unlocked);
    const msg = await ada.post(`/api/rooms/${general.id}/messages`, { body: 'Which hook won this week?' });
    check('member posts a message', msg.status === 200 && msg.data.message.user.id === av.data.user.id, msg.data);
    check('member cannot post in announcements', (await ada.post(`/api/rooms/${ann.id}/messages`, { body: 'hi' })).status === 403);
    check('premium room blocked', (await ada.get(`/api/rooms/${lounge.id}/messages`)).status === 403);
    const react = await owner.post(`/api/messages/${msg.data.message.id}/react`, { emoji: '🔥' });
    check('reaction works', react.status === 200 && react.data.reactions[0].n === 1);
    check('owner pins', (await owner.post(`/api/messages/${msg.data.message.id}/pin`)).data.pinned === true);
    const list = await ada.get(`/api/rooms/${general.id}/messages`);
    check('messages list with pinned', list.data.messages.length >= 1 && list.data.pinned.length === 1);
    check('member cannot delete others', (await ada.del(`/api/messages/${list.data.messages[0].id + 999}`)).status === 404);

    console.log('Academy and blog');
    const courses = (await ada.get('/api/courses')).data.courses;
    const free = courses.find((c) => !c.premium);
    const course = await ada.get('/api/courses/' + free.slug);
    const l1 = course.data.lessons[0];
    check('free lesson has steps', l1.steps.length >= 2 && !l1.locked);
    const done = await ada.post(`/api/lessons/${l1.id}/complete`);
    check('lesson completes with XP', done.data.gained >= 50);
    const prem = courses.find((c) => c.premium);
    if (prem) {
      const pc = await ada.get('/api/courses/' + prem.slug);
      check('premium lessons locked for free members', pc.data.lessons.every((l) => l.locked && l.steps.length === 0));
    }
    const posts = (await anon.get('/api/posts')).data.posts;
    check('blog list', posts.length >= 1);
    check('blog post reads', (await anon.get('/api/posts/' + posts[0].slug)).data.post.body.length >= 1);

    console.log('Support');
    const prods = (await owner.get('/api/admin/products')).data.products;
    const joinvoo = prods.find((p) => p.slug === 'joinvoo');
    const castvoo = prods.find((p) => p.slug === 'castvoo');
    const t = await ada.post('/api/support/tickets', { product_id: joinvoo.id, subject: 'Pixel', body: 'My pixel is not firing' });
    check('member opens ticket', t.status === 200);
    const w = await anon.post('/api/widget/castvoo/messages', { body: 'Hi from the Castvoo website', email: 'visitor@test.dev', name: 'Kofi' }, { 'x-vs': '' });
    check('widget message creates ticket', w.status === 200 && w.data.token && w.data.ticket_id);
    const wl = await anon.get(`/api/widget/castvoo/messages?token=${w.data.token}`);
    check('widget reads its thread', wl.data.messages.length === 1);
    const jfull = (await owner.get(`/api/admin/products/${joinvoo.id}`)).data.product;
    const api1 = await fetch(BASE + '/api/v1/support/messages', { method: 'POST', headers: { authorization: 'Bearer ' + jfull.api_key, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'apiuser@test.dev', body: 'From the Joinvoo app', external_ref: 'th_1' }) });
    check('support API creates ticket', api1.status === 200);
    const inbox = await owner.get('/api/admin/tickets?status=all');
    check('owner sees all tickets', inbox.data.tickets.length === 3, inbox.data.tickets.length);
    const reply = await owner.post(`/api/admin/tickets/${w.data.ticket_id}/reply`, { body: 'Hi Kofi, happy to help.' });
    check('staff reply', reply.status === 200);
    const wl2 = await anon.get(`/api/widget/castvoo/messages?token=${w.data.token}`);
    check('widget sees staff reply', wl2.data.messages.some((m) => m.author_type === 'staff'));
    check('reply email queued', (await owner.get('/api/admin/emails')).data.queue.some((q) => q.template === 'support_reply' && q.to_email === 'visitor@test.dev'));

    console.log('Team roles');
    const inv = await owner.post('/api/admin/team', { email: 'agent@test.dev', name: 'Agent Joy', perms: ['support'], support_scope: [joinvoo.id], role_title: 'Support' });
    check('invite support agent', inv.status === 200);
    const agent = new Client(); await agent.login('agent@test.dev');
    const ai = await agent.get('/api/admin/tickets?status=all');
    check('agent only sees Joinvoo tickets', ai.data.tickets.length === 2 && ai.data.tickets.every((x) => x.product_id === joinvoo.id), ai.data.tickets.map((x) => x.product_id));
    check('agent cannot open Castvoo ticket', (await agent.get(`/api/admin/tickets/${w.data.ticket_id}`)).status === 404);
    check('agent cannot see payments', (await agent.get('/api/admin/payment-methods')).status === 403);
    check('agent overview hides revenue', (await agent.get('/api/admin/overview')).data.revenue_30d === null);
    const editor = await owner.post('/api/admin/team', { email: 'editor@test.dev', perms: ['content'], role_title: 'Content' });
    const ed = new Client(); await ed.login('editor@test.dev');
    const tc = await ed.put('/api/admin/settings/top_card', { value: { enabled: true, title: 'New top card', body: 'Body', cta_text: 'Go', cta_url: '/app' } });
    check('content editor edits top card', tc.status === 200 && (await anon.get('/api/site')).data.top_card.title === 'New top card', editor.data);
    check('content editor cannot edit premium', (await ed.put('/api/admin/settings/premium', { value: {} })).status === 403);

    console.log('Payments and Premium');
    const pm = (await owner.get('/api/admin/payment-methods')).data.methods.find((m) => m.type === 'crypto' && m.currency === 'USDT');
    const save = await owner.post('/api/admin/payment-methods', { ...pm, enabled: true, config: { ...pm.config, address: 'TXYZtestaddress123' } });
    check('enable USDT method', save.status === 200 && save.data.method.enabled === 1);
    const methods = await ada.get('/api/billing/methods');
    check('member sees the method', methods.data.methods.length === 1);
    const co = await ada.post('/api/billing/checkout', { item: 'premium', method_id: pm.id });
    check('crypto checkout returns address and amount', co.status === 200 && co.data.pay.address === 'TXYZtestaddress123' && co.data.pay.amount === 20, co.data);
    const proof = await ada.post(`/api/billing/orders/${co.data.order.ref}/proof`, { proof: 'abc123txhash' });
    check('proof submitted', proof.data.order.status === 'review');
    const orders = await owner.get('/api/admin/orders?status=review');
    const approve = await owner.post(`/api/admin/orders/${orders.data.orders[0].id}/approve`);
    check('owner approves', approve.data.order.status === 'paid');
    const after = await ada.get('/api/me');
    check('member is Premium for ~30 days', after.data.user.premium && after.data.user.premium_until > Date.now() + 29 * 86400_000);
    check('premium room opens', (await ada.get(`/api/rooms/${lounge.id}/messages`)).status === 200);
    check('paid room still locked', (await ada.get(`/api/rooms/${paid.id}/messages`)).status === 403);
    const btc = (await owner.get('/api/admin/payment-methods')).data.methods.find((m) => m.currency === 'BTC');
    await owner.post('/api/admin/payment-methods', { ...btc, enabled: true, config: { ...btc.config, address: 'bc1qtest' } });
    const cb = await ada.post('/api/billing/checkout', { item: 'room', room_id: paid.id, method_id: btc.id });
    check('BTC amount keeps 8 decimals', cb.data.pay.amount > 0 && cb.data.pay.amount < 0.01, cb.data.pay);

    console.log('Free tools: maths');
    {
      const TM = require('../public/js/tools-math.js');
      const be = TM.breakEven({ payout: 100, rate: 10, margin: 30 });
      check('break-even: $100 payout, 10%, 30% → CPL $10 / max $7', be.beCpl === 10 && Math.abs(be.tCpl - 7) < 1e-9 && be.beCpa === 100 && Math.abs(be.tCpa - 70) < 1e-9 && be.leadsPerFtd === 10, be);
      check('break-even: missing rate gives no number', Number.isNaN(TM.breakEven({ payout: 100, rate: NaN, margin: 30 }).beCpl));
      const ro = TM.roas({ spend: 500, revenue: 1500, conversions: 10 });
      check('ROAS: 500 → 1500 is 3×, ROI 200%, profit 1000, CPA 50', ro.roas === 3 && ro.roi === 200 && ro.profit === 1000 && ro.cpa === 50 && Math.abs(ro.margin - 66.6667) < 0.001, ro);
      check('ROAS: conversions × payout', TM.roas({ spend: 100, conversions: 4, payout: 50 }).revenue === 200);
      check('ROAS: zero spend gives no ROAS', !Number.isFinite(TM.roas({ spend: 0, revenue: 100 }).roas));
      const ks = (spend, conversions, target = 25) => TM.killScale({ spend, conversions, target, days: 3 });
      check('kill: 2× target spent, 0 conversions', ks(50, 0).verdict === 'kill' && ks(49, 0).verdict === 'hold');
      check('kill: CPA > 1.5× after 3× spend', ks(80, 2).verdict === 'kill' && ks(70, 1).verdict === 'hold', [ks(80, 2), ks(70, 1)]);
      check('hold: within ±20%', ks(90, 3).verdict === 'hold' && /±20%/.test(ks(90, 3).rule));
      check('scale +20%: CPA ≤ 0.8× with 3+', ks(60, 3).verdict === 'scale' && ks(40, 2).verdict === 'hold' && ks(60, 3).label === 'Scale +20%');
      check('scale +30–50%: CPA ≤ 0.6× with 10+', ks(150, 10).verdict === 'scale_big' && ks(150, 9).verdict === 'scale');
      check('kill-or-scale needs spend and target', TM.killScale({ spend: NaN, conversions: 1, target: 25 }) === null && TM.killScale({ spend: 10, conversions: 1, target: 0 }) === null);
      check('kill-or-scale uses custom rules', TM.killScale({ spend: 30, conversions: 0, target: 25 }, { kill_zero_mult: 1 }).verdict === 'kill');
      // The website demo loops three example ad sets: their verdicts must match the rule engine.
      check('website demo scenarios match the rules', ['kill', 'hold', 'scale'].every((v, i) => ks([60, 85, 110][i], [0, 3, 6][i]).verdict === v));
      const bg = TM.budget({ goal: 100, cpa: 25, days: 30 });
      check('budget: 100 FTDs at $25 over 30 days → $2,500 total', bg.total === 2500 && Math.abs(bg.daily - 83.3333) < 0.001 && bg.timeline.length === 5 && bg.timeline[4].day === 30);
      const bd = TM.budget({ mode: 'daily', daily: 100, cpa: 20, days: 10, payout: 50 });
      check('budget: $100/day at $20 CPA → 5 a day, 50 total, revenue 2,500', bd.perDay === 5 && bd.conversions === 50 && bd.revenue === 2500);
      check('budget: revenue goal', TM.budget({ goalType: 'revenue', goal: 1000, payout: 50, cpa: 10, days: 10 }).conversions === 20);
      const fn = TM.funnel({ stages: [{ name: 'Clicks', value: 1000 }, { name: 'Joins', value: 400 }, { name: 'Reg', value: 80 }, { name: 'FTD', value: 20 }], payout: 100, lift: 10 });
      check('funnel: step rates, biggest drop, lift value', fn.stages[1].step === 40 && fn.stages[2].step === 20 && fn.biggestDrop === 2 && Math.abs(fn.extra - 2) < 1e-9 && Math.abs(fn.extraValue - 200) < 1e-6 && fn.overall === 2, fn);
      check('funnel: rate mode', TM.funnel({ mode: 'rate', stages: [{ value: 1000 }, { value: 40 }, { value: 20 }] }).final === 80);
      const u1 = TM.buildUtm({ base: 'https://x.com/lp?a=1&utm_source=old#top', params: [['utm_source', '{{site_source_name}}'], ['utm_campaign', '{{campaign.name}}'], ['n', 'a b&c'], ['empty', '']] });
      check('UTM: macros stay readable, values encoded, old key replaced, hash kept', u1.url === 'https://x.com/lp?a=1&utm_source={{site_source_name}}&utm_campaign={{campaign.name}}&n=a%20b%26c#top', u1);
      check('UTM: https only', !!TM.buildUtm({ base: 'http://x.com', params: [] }).error && !!TM.buildUtm({ base: 'x.com', params: [] }).error);
      check('UTM: bad parameter name refused', !!TM.buildUtm({ base: 'https://x.com', params: [['a b', '1']] }).error);
      check('UTM presets use only known macros', TM.UTM_PRESETS.tiktok.utm.utm_campaign === '__CAMPAIGN_NAME__' && TM.UTM_PRESETS.snapchat.utm.utm_term === '{{adSet.name}}' && TM.UTM_PRESETS.google.custom[0][1] === '{campaignid}');
      const pb = TM.buildPostback({ base: 'https://trk.example.com/pb?k=1', params: [['cid', '{clickid}'], ['sum', '##PAYOUT##'], ['x', 'a b']] });
      check('postback: macros kept as typed, appended to existing query', pb.url === 'https://trk.example.com/pb?k=1&cid={clickid}&sum=##PAYOUT##&x=a%20b', pb);
      check('postback: duplicate names refused', !!TM.buildPostback({ base: 'https://t.co/p', params: [['a', '1'], ['a', '2']] }).error);
      check('numbers: commas, symbols, junk', TM.parseNum('1,250.50') === 1250.5 && TM.parseNum('$40') === 40 && Number.isNaN(TM.parseNum('')) && Number.isNaN(TM.parseNum('12abc')));
      // QA regressions
      check('kill-or-scale: CPA typed exactly on the 0.8× line scales (float)', TM.killScale({ spend: 98.4, conversions: 3, target: 41 }).verdict === 'scale');
      check('kill-or-scale: narrow hold band does not say "data too thin" with enough conversions', TM.killScale({ spend: 225, conversions: 10, target: 25 }, { hold_band: 5 }).rule !== 'Data too thin');
      check('ROAS: negative conversions give no revenue', Number.isNaN(TM.roas({ spend: 100, conversions: -5, payout: 50 }).revenue));
      const b25 = TM.budget({ goal: 10, cpa: 10, days: 2.5 });
      check('budget: part days round, plan ends at the total', b25.timeline[b25.timeline.length - 1].spend === b25.total, b25);
      check('funnel: lifting a step over 100% never gives a negative gain', TM.funnel({ stages: [{ value: 100 }, { value: 200 }, { value: 50 }], liftStep: 1, lift: 10 }).extra === 0);
      check('funnel: a blank step gives no lift number', Number.isNaN(TM.funnel({ stages: [{ value: NaN }, { value: 5 }, { value: 1 }] }).extra));
      check('UTM: same parameter twice refused, spaces in path encoded', !!TM.buildUtm({ base: 'https://x.com', params: [['utm_source', 'a'], ['UTM_SOURCE', 'b']] }).error && TM.buildUtm({ base: 'https://x.com/a b', params: [['s', '1']] }).url === 'https://x.com/a%20b?s=1');
      check('UTM/postback: javascript: and data: refused', ['javascript:alert(1)', 'data:text/html,x', ' JAVASCRIPT:alert(1)'].every((b) => TM.buildUtm({ base: b, params: [] }).error && TM.buildPostback({ base: b, params: [] }).error));
      check('numbers: minus before a symbol', TM.parseNum('-$5') === -5);
      check('money: symbol only, no NaN shown', TM.money(1234.5, 'NGN') === '₦1,235' && TM.money(7, 'USD') === '$7.00' && TM.money(NaN) === '—' && TM.money(Infinity) === '—' && TM.money(5, 'XAF').startsWith('FCFA'));
    }

    console.log('Free tools: settings and saves');
    {
      const sTools = (await anon.get('/api/site')).data.calc_tools;
      check('site lists 8 tools with access, no thresholds', sTools.length === 8 && sTools.every((t) => t.key && t.name && ['free', 'premium'].includes(t.access)) && !('kill_scale' in (await anon.get('/api/site')).data));
      check('defaults: kill-or-scale, budget, postback are Premium', sTools.filter((t) => t.access === 'premium').map((t) => t.key).sort().join() === 'budget,killscale,postback');
      check('tools config needs login', (await anon.get('/api/tools')).status === 401);
      const fm = new Client(); await fm.login('freetools@test.dev', 'Free Tools');
      const fcfg = (await fm.get('/api/tools')).data;
      check('free member: config with price, not premium', fcfg.premium_ok === false && fcfg.premium.price_usd === 20 && fcfg.kill_scale.kill_zero_mult === 2 && fcfg.tools.length === 8);
      check('home lists the tools', (await fm.get('/api/me/home')).data.calc_tools.length === 8);
      const fsave = await fm.post('/api/tools/saves', { tool: 'roas', name: 'x', data: { spend: '1' } });
      check('free member cannot save (403, premium flag)', fsave.status === 403 && fsave.data.premium === true, fsave.data);
      check('saves need CSRF header', (await fm.req('POST', '/api/tools/saves', { tool: 'roas', data: {} }, { 'x-vs': '' })).status === 403);
      // ada is Premium (paid above)
      check('premium member: premium_ok', (await ada.get('/api/tools')).data.premium_ok === true);
      const s1 = await ada.post('/api/tools/saves', { tool: 'breakeven', name: '  Offer A <b>  ', data: { payout: '100', rate: '10', margin: '30' } });
      check('premium member saves a scenario', s1.status === 200 && s1.data.save.tool === 'breakeven' && s1.data.save.data.payout === '100' && s1.data.save.name === 'Offer A <b>', s1.data);
      check('unknown tool refused', (await ada.post('/api/tools/saves', { tool: 'nope', data: { a: 1 } })).status === 400);
      check('array data refused', (await ada.post('/api/tools/saves', { tool: 'roas', data: [1, 2] })).status === 400);
      check('data over 4 KB refused', (await ada.post('/api/tools/saves', { tool: 'roas', data: { x: 'y'.repeat(4100) } })).status === 400);
      const blank = await ada.post('/api/tools/saves', { tool: 'funnel', name: '', data: { stages: [] } });
      check('blank name gets the tool name', blank.data.save.name === 'Funnel calculator', blank.data);
      const mine = (await ada.get('/api/tools/saves?tool=breakeven')).data;
      check('list by tool', mine.saves.length === 1 && mine.saves[0].id === s1.data.save.id && mine.total === 2 && mine.max === 50);
      check('other members do not see the saves', (await fm.get('/api/tools/saves')).data.saves.length === 0 && (await owner.get('/api/tools/saves')).data.saves.every((x) => x.id !== s1.data.save.id));
      check('other members cannot delete them', (await fm.del('/api/tools/saves/' + s1.data.save.id)).status === 404 && (await owner.del('/api/tools/saves/' + s1.data.save.id)).status === 404);
      check('owner may save (staff preview)', (await owner.post('/api/tools/saves', { tool: 'utm', data: { base: 'https://x.com' } })).status === 200);
      {
        const { DatabaseSync } = require('node:sqlite');
        const sql = new DatabaseSync(DB);
        const uid = (await ada.get('/api/me')).data.user.id;
        const ins = sql.prepare("INSERT INTO tool_saves(user_id,tool,name,data,created_at) VALUES(?,'roas','bulk','{}',?)");
        for (let i = 0; i < 48; i++) ins.run(uid, Date.now());
        sql.close();
      }
      const over = await ada.post('/api/tools/saves', { tool: 'roas', data: { a: 1 } });
      check('limit of 50 saves per member', over.status === 409 && /50/.test(over.data.error), over.data);
      check('owner delete works', (await ada.del('/api/tools/saves/' + s1.data.save.id)).status === 200 && (await ada.get('/api/tools/saves?tool=breakeven')).data.saves.length === 0);
      check('after a delete you can save again', (await ada.post('/api/tools/saves', { tool: 'roas', data: { a: 1 } })).status === 200);

      // Setting: content perm, validation, public effect
      check('member cannot edit tools setting', (await fm.put('/api/admin/settings/tools', { value: {} })).status === 403);
      check('tools setting must be an object', (await owner.put('/api/admin/settings/tools', { value: 'x' })).status === 400);
      const ed2 = new Client(); await ed2.login('editor@test.dev');
      const put = await ed2.put('/api/admin/settings/tools', { value: {
        tools: { sizes: { enabled: false, access: 'free', sort: 0 }, utm: { enabled: true, access: 'premium', sort: -5 }, bogus: { enabled: true }, roas: { access: 'gold' } },
        kill_scale: { kill_zero_mult: 99, hold_band: -4, scale_cpa_mult: 0.5, big_cpa_mult: 0.9, scale_min_conv: 5, big_min_conv: 2, big_pct_min: 60, big_pct_max: 40, scale_pct: 'abc' },
      } });
      const v = put.data.value;
      check('content editor saves tools setting', put.status === 200, put.data);
      check('setting cleaned: unknown dropped, bad access default, order kept', !v.tools.bogus && v.tools.roas.access === 'free' && v.tools.utm.sort === 0 && v.tools.utm.access === 'premium' && Object.keys(v.tools).length === 8, v.tools);
      check('rules clamped and kept consistent', v.kill_scale.kill_zero_mult === 10 && v.kill_scale.hold_band === 0 && v.kill_scale.big_cpa_mult === 0.5 && v.kill_scale.big_min_conv === 5 && v.kill_scale.big_pct_max === 60 && v.kill_scale.scale_pct === 20, v.kill_scale);
      const blankR = (await owner.put('/api/admin/settings/tools', { value: { tools: {}, kill_scale: { kill_zero_mult: '', hold_band: null, scale_pct: '30' } } })).data.value.kill_scale;
      check('blank rule fields keep the default, not the minimum', blankR.kill_zero_mult === 2 && blankR.hold_band === 20 && blankR.scale_pct === 30, blankR);
      await ed2.put('/api/admin/settings/tools', { value: put.data.value });
      const site2 = (await anon.get('/api/site')).data.calc_tools;
      check('site follows the setting (off hidden, order, access)', site2.length === 7 && site2[0].key === 'utm' && site2[0].access === 'premium' && !site2.some((t) => t.key === 'sizes'));
      check('member config follows the setting', (await fm.get('/api/tools')).data.kill_scale.kill_zero_mult === 10);
      check('admin GET returns catalogue', (await owner.get('/api/admin/settings/tools')).data.catalog.length === 8);
      await owner.put('/api/admin/settings/tools', { value: { tools: {}, kill_scale: {} } });
      check('reset to defaults', (await anon.get('/api/site')).data.calc_tools.length === 8);
      for (const f of ['/js/tools.js', '/js/tools-math.js', '/css/tools.css']) check(`GET ${f} → 200`, (await fetch(BASE + f)).status === 200);
      check('app shell does not load tools.js up front', !(await (await fetch(BASE + '/app')).text()).includes('tools.js'));
    }

    console.log('Invite-only rooms');
    {
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(DB); // the test reaches into the database only to move clocks
      const inner = (await ada.get('/api/rooms')).data.rooms.find((r) => r.slug === 'inner-circle');
      check('Inner Circle seeded invite only at $299, 25 seats', inner.access === 'paid' && inner.price_usd === 299 && inner.approval_required === true && inner.seats === 25 && inner.seats_left === 25 && inner.apply_questions.length === 4 && inner.application === null, inner);
      check('site lists Inner Circle as invite only', (await anon.get('/api/site')).data.rooms.find((r) => r.id === inner.id).approval_required === true);
      const queued = async (tpl, to) => (await owner.get('/api/admin/emails')).data.queue.some((q) => q.template === tpl && (!to || q.to_email === to));

      const kim = new Client(); await kim.login('kim@test.dev', 'Kim Buyer');
      const kco = await kim.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id });
      check('checkout refused before applying', kco.status === 403 && /invite only/i.test(kco.data.error || kco.data.message || JSON.stringify(kco.data)), kco.data);
      check('apply needs the required answers', (await kim.post(`/api/rooms/${inner.id}/apply`, { answers: ['Forex, NG and KE', '', 'Feedback'] })).status === 400);
      const long = 'x'.repeat(5000);
      const ka = await kim.post(`/api/rooms/${inner.id}/apply`, { answers: ['Forex, NG and KE', '$8k a month', long] });
      check('apply works (optional question can be blank)', ka.status === 200 && ka.data.room.application.status === 'pending' && !ka.data.room.unlocked, ka.data);
      check('a second open application is refused', (await kim.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] })).status === 409);
      check('checkout still refused while pending', (await kim.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id })).status === 403);
      check('application received email queued', await queued('room_application_received', 'kim@test.dev'));
      check('members only see their own application', (await ada.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id).application === null);
      check('member cannot read the applications list', (await kim.get('/api/admin/applications')).status === 403);
      check('support agent (no community perm) cannot read applications', (await agent.get('/api/admin/applications')).status === 403);
      const al = await owner.get('/api/admin/applications?status=pending');
      const kApp = al.data.applications.find((a) => a.user.email === 'kim@test.dev');
      check('owner sees the application with answers and member info', kApp && kApp.answers.length === 4 && kApp.answers[0].q.includes('What do you run') && kApp.answers[0].a === 'Forex, NG and KE' && kApp.room.name.startsWith('Inner Circle') && kApp.user.member_since > 0 && kApp.paid_orders === 0, kApp);
      check('answers are length-capped', kApp.answers[2].a.length === 600);
      check('pending count reported', (al.data.counts.find((c) => c.status === 'pending') || {}).n >= 1);
      check('admin rooms list shows pending count', (await owner.get('/api/admin/rooms')).data.rooms.find((r) => r.id === inner.id).pending === 1);

      // Withdraw, reapply, reject, cooldown
      const kw = await kim.post(`/api/rooms/${inner.id}/apply/withdraw`);
      check('member withdraws', kw.status === 200 && kw.data.room.application.status === 'withdrawn');
      const ka2 = await kim.post(`/api/rooms/${inner.id}/apply`, { answers: ['Forex, NG and KE', '$8k a month', 'Reviews', '@kim'] });
      check('can apply again after withdrawing', ka2.status === 200 && ka2.data.room.application.status === 'pending');
      const kId = (await owner.get('/api/admin/applications?status=pending')).data.applications.find((a) => a.user.email === 'kim@test.dev').id;
      const rj = await owner.post(`/api/admin/applications/${kId}/reject`, { note: 'Come back when spend is steady <b>for 3 months</b>.' });
      check('owner rejects with a note', rj.status === 200 && rj.data.application.status === 'rejected');
      const kr = (await kim.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id).application;
      check('member sees the rejection note and the reapply date', kr.status === 'rejected' && kr.note.includes('for 3 months') && kr.reapply_at > Date.now() + 29 * 86400_000, kr);
      check('reapply blocked during the 30-day cooldown', (await kim.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] })).status === 429);
      check('rejection email queued', await queued('room_application_rejected', 'kim@test.dev'));
      const rjVars = JSON.parse(sql.prepare("SELECT vars FROM email_queue WHERE template='room_application_rejected' ORDER BY id DESC LIMIT 1").get().vars);
      check('note is escaped in the email', rjVars.note_html.includes('&lt;b&gt;') && !rjVars.note_html.includes('<b>'), rjVars);
      sql.prepare('UPDATE room_applications SET decided_at=? WHERE id=?').run(Date.now() - 31 * 86400_000, kId);
      check('reapply allowed after 30 days', (await kim.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] })).status === 200);

      // Approve, pay, access, renew
      const lee = new Client(); await lee.login('lee@test.dev', 'Lee Operator');
      await lee.post(`/api/rooms/${inner.id}/apply`, { answers: ['Casino, ZA', '$20k', 'Scale'] });
      const lId = (await owner.get('/api/admin/applications?status=pending')).data.applications.find((a) => a.user.email === 'lee@test.dev').id;
      const ap = await owner.post(`/api/admin/applications/${lId}/approve`, { note: 'Welcome in.' });
      check('owner approves', ap.status === 200 && ap.data.application.status === 'approved' && ap.data.application.approved_until > Date.now() + 6 * 86400_000);
      check('approval decision is audited', (await owner.get('/api/admin/audit')).data.audit.some((a) => a.action === 'application.approve'));
      const la = (await lee.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id);
      check('member sees approved with a pay window', la.application.status === 'approved' && la.application.note === 'Welcome in.' && !la.application.waitlist && la.seats_left === 24, la);
      check('approval email queued', await queued('room_application_approved', 'lee@test.dev'));
      const lco = await lee.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id });
      check('checkout allowed after approval', lco.status === 200 && lco.data.order.amount_usd === 299, lco.data);
      await lee.post(`/api/billing/orders/${lco.data.order.ref}/proof`, { proof: 'leetxhash1' });
      const lo = (await owner.get('/api/admin/orders?status=review')).data.orders.find((o) => o.ref === lco.data.order.ref);
      await owner.post(`/api/admin/orders/${lo.id}/approve`);
      check('paying fulfils access to the room', (await lee.get(`/api/rooms/${inner.id}/messages`)).status === 200);
      const lApp = (await owner.get('/api/admin/applications?status=approved')).data.applications.find((a) => a.id === lId);
      check('application marked paid', lApp.paid && lApp.access_until > Date.now());
      check('member renews without reapplying', (await lee.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id })).status === 200);

      // Approval window expiry
      const mo = new Client(); await mo.login('mo@test.dev', 'Mo Media');
      await mo.post(`/api/rooms/${inner.id}/apply`, { answers: ['Sports, GH', '$5k', 'Calls'] });
      const mId = (await owner.get('/api/admin/applications?status=pending')).data.applications.find((a) => a.user.email === 'mo@test.dev').id;
      await owner.post(`/api/admin/applications/${mId}/approve`, {});
      sql.prepare('UPDATE room_applications SET approved_until=? WHERE id=?').run(Date.now() - 1000, mId);
      const mco = await mo.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id });
      check('checkout refused after the approval window closes', mco.status === 403, mco.data);
      check('expired application shows as expired', (await mo.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id).application.status === 'expired');
      check('expired member can apply again', (await mo.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] })).status === 200);

      // Seats: room full -> waitlist, override, promotion when seats open
      const innerAdmin = (await owner.get('/api/admin/rooms')).data.rooms.find((r) => r.id === inner.id);
      check('admin room carries approval fields', innerAdmin.approval_required === 1 && innerAdmin.seats === 25 && innerAdmin.apply_questions.length === 4 && innerAdmin.seats_taken === 1, innerAdmin);
      const qs = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q1'];
      const sv = await owner.post('/api/admin/rooms', { ...innerAdmin, seats: 1, apply_questions: qs });
      check('admin saves seats and questions (max 5, unique)', sv.status === 200 && sv.data.room.seats === 1 && JSON.parse(sv.data.room.apply_questions).length === 5);
      await owner.post('/api/admin/rooms', { ...innerAdmin, seats: 1 });
      const nia = new Client(); await nia.login('nia@test.dev', 'Nia Ads');
      const nr = (await nia.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id);
      check('full room shows no seats left', nr.seats_left === 0 && nr.seats === 1);
      check('full room still takes applications', (await nia.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] })).status === 200);
      const nId = (await owner.get('/api/admin/applications?status=pending')).data.applications.find((a) => a.user.email === 'nia@test.dev').id;
      const wl = await owner.post(`/api/admin/applications/${nId}/approve`, {});
      check('approval in a full room goes to the waitlist', wl.data.application.status === 'approved' && wl.data.application.waitlist === true && wl.data.application.approved_until === 0, wl.data);
      check('waitlisted member sees the waitlist', (await nia.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id).application.waitlist === true);
      check('waitlisted member cannot pay yet', (await nia.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id })).status === 403);
      check('waitlist email queued', await queued('room_application_waitlist', 'nia@test.dev'));
      check('waitlist filter', (await owner.get('/api/admin/applications?status=waitlist')).data.applications.some((a) => a.id === nId));
      const ov2 = await owner.post(`/api/admin/applications/${nId}/approve`, { override_seats: true });
      check('owner can override the seat limit', ov2.data.application.approved_until > Date.now() && ov2.data.application.seat_override === true);
      check('overridden member can pay', (await nia.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id })).status === 200);
      const pia = new Client(); await pia.login('pia@test.dev', 'Pia Pixel');
      await pia.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] });
      const pId = (await owner.get('/api/admin/applications?status=pending')).data.applications.find((a) => a.user.email === 'pia@test.dev').id;
      await owner.post(`/api/admin/applications/${pId}/approve`, {});
      check('second approval waits for a seat', (await pia.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id).application.waitlist === true);
      await owner.post('/api/admin/rooms', { ...innerAdmin, seats: 5 });
      const pr = (await pia.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id).application;
      check('more seats move the waitlist forward', pr.status === 'approved' && !pr.waitlist && pr.approved_until > Date.now() + 6 * 86400_000, pr);

      // Customer page: answers only for the community team; a direct grant is the invite
      const cs = await owner.post('/api/admin/team', { email: 'cs@test.dev', perms: ['customers'], role_title: 'Customers' });
      const csC = new Client(); await csC.login('cs@test.dev');
      const kimId = (await owner.get('/api/admin/customers?q=kim@test.dev')).data.customers[0].id;
      check('customer page hides answers without community perm', cs.status === 200 && (await csC.get('/api/admin/customers/' + kimId)).data.applications === null);
      const kc = await owner.get('/api/admin/customers/' + kimId);
      check('customer page lists applications for the owner', kc.data.applications.length >= 3 && kc.data.applications[0].answers.length >= 3);
      await owner.patch('/api/admin/customers/' + kimId, { grant_room: inner.id });
      const kAfter = (await kim.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id);
      check('direct grant opens the room and closes the application', kAfter.unlocked && (await owner.get('/api/admin/applications?status=pending')).data.applications.every((a) => a.user.email !== 'kim@test.dev'));
      check('non-invite rooms refuse applications', (await kim.post(`/api/rooms/${general.id}/apply`, { answers: ['a'] })).status === 400);
      const spam = new Client(); await spam.login('spam@test.dev', 'Spam Bot');
      let hit = 0;
      for (let i = 0; i < 14; i++) { const r = await spam.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] }); if (r.status === 429) hit++; await spam.post(`/api/rooms/${inner.id}/apply/withdraw`); }
      check('applications are rate limited', hit > 0);

      // QA regression: a payment sent inside the window but confirmed after it keeps the seat and closes the application as paid
      const ray = new Client(); await ray.login('ray@test.dev', 'Ray Review');
      await ray.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] });
      const rId = (await owner.get('/api/admin/applications?status=pending')).data.applications.find((a) => a.user.email === 'ray@test.dev').id;
      await owner.post(`/api/admin/applications/${rId}/approve`, { override_seats: true });
      const rco = await ray.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id });
      await ray.post(`/api/billing/orders/${rco.data.order.ref}/proof`, { proof: 'raytxhash1' });
      const takenBefore = (await owner.get('/api/admin/rooms')).data.rooms.find((r) => r.id === inner.id).seats_taken;
      sql.prepare('UPDATE room_applications SET approved_until=? WHERE id=?').run(Date.now() - 1000, rId);
      const rr = (await ray.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id);
      check('window that lapses while the payment is in review does not expire', rr.application.status === 'approved', rr.application);
      check('seat stays held while the payment is in review', (await owner.get('/api/admin/rooms')).data.rooms.find((r) => r.id === inner.id).seats_taken === takenBefore);
      const ro = (await owner.get('/api/admin/orders?status=review')).data.orders.find((o) => o.ref === rco.data.order.ref);
      await owner.post(`/api/admin/orders/${ro.id}/approve`);
      const rApp = (await owner.get('/api/admin/applications?status=approved')).data.applications.find((a) => a.id === rId);
      check('late-confirmed payment marks the application paid', rApp && rApp.paid && (await ray.get(`/api/rooms/${inner.id}/messages`)).status === 200, rApp);
      const sol = new Client(); await sol.login('sol@test.dev', 'Sol Late');
      await sol.post(`/api/rooms/${inner.id}/apply`, { answers: ['a', 'b', 'c'] });
      const sId = (await owner.get('/api/admin/applications?status=pending')).data.applications.find((a) => a.user.email === 'sol@test.dev').id;
      await owner.post(`/api/admin/applications/${sId}/approve`, { override_seats: true });
      const sco = await sol.post('/api/billing/checkout', { item: 'room', room_id: inner.id, method_id: btc.id });
      sql.prepare('UPDATE room_applications SET approved_until=? WHERE id=?').run(Date.now() - 1000, sId);
      check('lapsed window without a payment in review expires', (await sol.get('/api/rooms')).data.rooms.find((r) => r.id === inner.id).application.status === 'expired');
      await owner.post(`/api/admin/orders/${sco.data.order.id}/approve`);
      const sApp = (await owner.get('/api/admin/applications?status=approved')).data.applications.find((a) => a.id === sId);
      check('payment confirmed after expiry still closes the application as paid', sApp && sApp.paid, sApp);
      sql.close();
    }

    console.log('Integrations');
    const prodSave = await owner.post('/api/admin/products', { ...jfull, sso: true, redirect_uris: 'https://joinvoo.com/auth/voosquare/callback', visible: true });
    check('product SSO saved', prodSave.data.product.sso === 1);
    const authz = await ada.get(`/oauth/authorize?client_id=${jfull.client_id}&redirect_uri=${encodeURIComponent('https://joinvoo.com/auth/voosquare/callback')}&state=xyz`);
    const loc = authz.headers.get('location') || '';
    check('authorize redirects with code', authz.status === 302 && loc.includes('code=') && loc.includes('state=xyz'), loc);
    const code = new URL(loc).searchParams.get('code');
    const tok = await anon.post('/oauth/token', `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent('https://joinvoo.com/auth/voosquare/callback')}&client_id=${jfull.client_id}&client_secret=${prodSave.data.product.client_secret}`, { 'x-vs': '' });
    check('token exchange returns user', tok.status === 200 && tok.data.user.email === 'ada@test.dev' && tok.data.id_token.split('.').length === 3, tok.data);
    const ui = await fetch(BASE + '/oauth/userinfo', { headers: { authorization: 'Bearer ' + tok.data.access_token } });
    check('userinfo works', ui.status === 200 && (await ui.json()).voo_id === after.data.user.voo_id);
    check('code is single use', (await anon.post('/oauth/token', `code=${code}&client_id=${jfull.client_id}&client_secret=${prodSave.data.product.client_secret}`, { 'x-vs': '' })).status === 400);
    const badRedirect = await ada.get(`/oauth/authorize?client_id=${jfull.client_id}&redirect_uri=${encodeURIComponent('https://evil.com/cb')}`);
    check('unknown redirect refused', badRedirect.status === 400);
    const ev = await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer ' + prodSave.data.product.api_key, 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ event_id: 'e1', voo_id: after.data.user.voo_id, type: 'ftd', label: 'First deposit from Video 3', value_usd: 120 }, { event_id: 'e1', voo_id: after.data.user.voo_id, type: 'ftd' }] }) });
    check('events stored once', (await ev.json()).stored === 1);
    check('activity shows event', (await ada.get('/api/me/activity')).data.activity.length === 1);
    check('bad API key refused', (await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer nope', 'content-type': 'application/json' }, body: '{}' })).status === 401);

    console.log('Admin screens');
    for (const p of ['/api/admin/me', '/api/admin/overview', '/api/admin/customers', '/api/admin/tickets', '/api/admin/canned', '/api/admin/rooms', '/api/admin/messages/recent', '/api/admin/courses', '/api/admin/posts', '/api/admin/products', '/api/admin/events', '/api/admin/payment-methods', '/api/admin/orders', '/api/admin/emails', '/api/admin/team', '/api/admin/audit', '/api/admin/settings/ads', '/api/admin/settings/premium', '/api/admin/settings/email']) {
      const r = await owner.get(p); check(`GET ${p}`, r.status === 200, r.data);
    }
    const tpls = (await owner.get('/api/admin/emails')).data.templates;
    check('email templates loaded (18+)', tpls.length >= 18, tpls.length);
    for (const tp of tpls) {
      const r = await owner.get('/api/admin/emails/' + tp.key);
      check(`email ${tp.key} renders without placeholders`, r.status === 200 && !/\{\{/.test(r.data.preview), r.data.preview && r.data.preview.match(/\{\{[^}]+\}\}/g));
    }
    {
      // Email design: hero art, alt text, plain-text part, prices from settings, per-template reset that keeps other edits.
      const pw = await owner.get('/api/admin/emails/seq_premium');
      check('email: premium price comes from settings', /\$20/.test(pw.data.preview) && /\$299/.test(pw.data.preview) && pw.data.template.html.includes('{{premium_price}}') && !pw.data.template.html.includes('$20'), pw.data.preview && pw.data.preview.slice(0, 80));
      check('email: hero, alt text, unsubscribe on marketing, plain text', /\/email\/premium\.gif" width="600" height="280" alt="[^"]+"/.test(pw.data.preview) && pw.data.preview.includes('/u/') && pw.data.template.text.includes('Unsubscribe') && !(await owner.get('/api/admin/emails/verify_code')).data.preview.includes('/u/'));
      check('email: tools hero includes Spyvoo', /tools\.gif"[^>]*alt="[^"]*Spyvoo/.test((await owner.get('/api/admin/emails/seq_tools')).data.preview));
      const before = (await owner.get('/api/admin/emails/seq_tools')).data;
      check('email: untouched template is not flagged as customised', before.customised === false);
      await owner.put('/api/admin/emails/seq_tools', { subject: 'Owner edit', preheader: before.template.preheader, html: before.template.html, text: before.template.text });
      await owner.put('/api/admin/emails/seq_joinvoo', { subject: 'Owner edit two', preheader: '', html: '<p>Mine</p>', text: 'Mine' });
      const edited = (await owner.get('/api/admin/emails/seq_tools')).data;
      check('email: edited template flagged as customised', edited.customised === true && edited.template.subject === 'Owner edit');
      check('email: reset needs the emails permission', (await ada.post('/api/admin/emails/seq_tools/reset', {})).status === 403);
      check('email: reset of an unknown template is a 404', (await owner.post('/api/admin/emails/nope/reset', {})).status === 404);
      const rs = await owner.post('/api/admin/emails/seq_tools/reset', {});
      const after = (await owner.get('/api/admin/emails/seq_tools')).data;
      check('email: reset one template to the new design', rs.status === 200 && after.template.subject === 'One login, every tool' && after.customised === false);
      check('email: reset leaves other edited templates alone', (await owner.get('/api/admin/emails/seq_joinvoo')).data.template.subject === 'Owner edit two');
      await owner.post('/api/admin/emails/seq_joinvoo/reset', {});
    }
    const cust = await owner.get(`/api/admin/customers/${av.data.user.id}`);
    check('customer profile', cust.data.customer.email === 'ada@test.dev' && cust.data.orders.length >= 1);
    const room = await owner.post('/api/admin/rooms', { name: 'Test Room', topic: 'Craft', access: 'free' });
    check('admin creates room', room.status === 200 && room.data.room.slug === 'test-room');
    const bc = await owner.post('/api/admin/broadcast', { segment: 'all', subject: 'Hello', body: 'Test broadcast' });
    check('broadcast queued', bc.data.queued >= 2);
    const unsub = await fetch(`${BASE}/u/${av.data.user.id}/bad-token`);
    check('bad unsubscribe token refused', unsub.status === 400);

    console.log('Security fixes (QA)');
    // Only people with customer or support access see the member list on the overview.
    check('content editor overview hides member list', (await ed.get('/api/admin/overview')).data.recent_members.length === 0);
    check('support agent overview still lists members', (await agent.get('/api/admin/overview')).data.recent_members.length > 0);
    // A non-owner with Team access cannot demote or rename the owner.
    await owner.post('/api/admin/team', { email: 'teamlead@test.dev', perms: ['team', 'customers'] });
    const lead = new Client(); await lead.login('teamlead@test.dev');
    check('non-owner cannot demote the owner', (await lead.post('/api/admin/team', { email: 'owner@test.dev', perms: ['support'] })).status === 403);
    check('owner keeps owner rights', (await owner.get('/api/me')).data.user.perms.includes('*'));
    check('non-owner cannot rename the owner', (await lead.patch(`/api/admin/customers/${ov.data.user.id}`, { name: 'Pwned' })).status === 403);
    check('last owner cannot drop own owner rights', (await owner.post('/api/admin/team', { email: 'owner@test.dev', perms: ['support'] })).status === 400);
    // Stripe webhooks need a signing secret; an empty secret must not let anyone forge "paid".
    const stripeM = (await owner.get('/api/admin/payment-methods')).data.methods.find((m) => m.type === 'stripe');
    await owner.post('/api/admin/payment-methods', { ...stripeM, enabled: false, config: { secret_key: 'sk_test_x', webhook_secret: '' } });
    const forged = JSON.stringify({ type: 'checkout.session.completed', data: { object: { client_reference_id: 'VS-NOPE', payment_status: 'paid' } } });
    const ts = Math.floor(Date.now() / 1000);
    const fsig = require('node:crypto').createHmac('sha256', '').update(`${ts}.${forged}`).digest('hex');
    check('stripe webhook without secret refused', (await fetch(`${BASE}/api/billing/webhook/${stripeM.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${ts},v1=${fsig}` }, body: forged })).status === 401);
    // OAuth hardening.
    const cbUri = encodeURIComponent('https://joinvoo.com/auth/voosquare/callback');
    check('authorize refuses javascript: redirect', (await ada.get(`/oauth/authorize?client_id=${jfull.client_id}&redirect_uri=${encodeURIComponent('javascript:alert(1)')}`)).status === 400);
    const az2 = await ada.get(`/oauth/authorize?client_id=${jfull.client_id}&redirect_uri=${cbUri}&state=s2`);
    const code2 = new URL(az2.headers.get('location')).searchParams.get('code');
    check('token without redirect_uri refused', (await anon.post('/oauth/token', `grant_type=authorization_code&code=${code2}&client_id=${jfull.client_id}&client_secret=${prodSave.data.product.client_secret}`, { 'x-vs': '' })).status === 400);
    check('malformed Basic auth is 401, not 500', (await anon.post('/oauth/token', 'grant_type=authorization_code&code=x', { 'x-vs': '', authorization: 'Basic ' + Buffer.from('%E0%A4%A:x').toString('base64') })).status === 401);
    await owner.post('/api/admin/products', { ...jfull, sso: false, redirect_uris: 'https://joinvoo.com/auth/voosquare/callback' });
    check('authorize refused while SSO is off', (await ada.get(`/oauth/authorize?client_id=${jfull.client_id}&redirect_uri=${cbUri}`)).status === 400);
    await owner.post('/api/admin/products', { ...jfull, sso: true, redirect_uris: 'https://joinvoo.com/auth/voosquare/callback' });
    // Widget visitors type any email: it must not attach the chat to that member's account, and page links must be http(s).
    const wv = await anon.post('/api/widget/joinvoo/messages', { body: 'I am Ada, honest', email: 'ada@test.dev', page: 'javascript:alert(1)' }, { 'x-vs': '' });
    check('widget email does not land in that member\'s inbox', !(await ada.get('/api/support/tickets')).data.tickets.some((x) => x.id === wv.data.ticket_id));
    check('widget page link must be http(s)', (await owner.get(`/api/admin/tickets/${wv.data.ticket_id}`)).data.ticket.page_url === '');
    // Unsafe links and colours from the admin are dropped.
    await owner.put('/api/admin/settings/announcements', { value: [{ enabled: true, text: 'Hi', link_text: 'Go', url: 'javascript:alert(1)' }, { enabled: true, text: 'Ok', url: '/app#academy' }] });
    await owner.put('/api/admin/settings/ads', { value: [{ enabled: true, placement: 'site', title: 'Ad', cta_url: ' JavaScript:alert(1)' }] });
    await owner.put('/api/admin/settings/top_card', { value: { enabled: true, title: 'T', cta_text: 'Go', cta_url: 'data:text/html,x' } });
    const s2 = (await anon.get('/api/site')).data;
    check('javascript:/data: links dropped from site content', s2.announcements[0].url === '' && s2.announcements[1].url === '/app#academy' && s2.ads[0].cta_url === '' && s2.top_card.cta_url === '');
    const badP = await owner.post('/api/admin/products', { name: 'Bad', slug: 'bad-product', color: '#000" onclick="x', tint: 'red', url: 'javascript:alert(1)', icon: 'javascript:alert(1)', visible: false });
    check('product colour, url and icon sanitised', badP.data.product.color === '#00A86B' && badP.data.product.url === '' && badP.data.product.icon === '');
    const okP = await owner.post('/api/admin/products', { name: 'Good', slug: 'good-product', color: '#123ABC', url: 'good.example', icon: 'https://cdn.example/icon.png', visible: false });
    check('valid product fields kept', okP.data.product.color === '#123ABC' && okP.data.product.url === 'https://good.example' && okP.data.product.icon === 'https://cdn.example/icon.png');
    check('room colour sanitised', (await owner.post('/api/admin/rooms', { name: 'Colour room', color: 'red;}</style>', archived: true })).data.room.color === '#00A86B');
    // Rate limits use the address added by our proxy (last X-Forwarded-For entry), so a faked first entry does not reset them.
    let limited = false;
    for (let i = 0; i < 32 && !limited; i++) {
      const r = await fetch(BASE + '/api/auth/start', { method: 'POST', headers: { 'x-vs': '1', 'content-type': 'application/json', 'x-forwarded-for': `10.0.0.${i}, 198.51.100.9` }, body: JSON.stringify({ email: `rl${i}@test.dev` }) });
      if (r.status === 429) limited = true;
    }
    check('spoofed X-Forwarded-For does not bypass rate limit', limited);
    // Payment methods limited to countries only show to members there.
    const mk = (await owner.get('/api/admin/payment-methods')).data.methods.find((m) => m.type === 'manual');
    await owner.post('/api/admin/payment-methods', { ...mk, enabled: true, countries: ['GH'] });
    check('country-limited method hidden from NG member', !(await ada.get('/api/billing/methods')).data.methods.some((m) => m.id === mk.id));
    await ada.patch('/api/me', { country: 'GH' });
    check('country-limited method shown to GH member', (await ada.get('/api/billing/methods')).data.methods.some((m) => m.id === mk.id));
    check('profile update with null avatar is not a 500', (await ada.patch('/api/me', { avatar: null })).status === 200);

    console.log('Images');
    const up1 = await uploadRaw(ada, fakePng(1200, 800, 4000), fakePng(480, 320));
    check('upload accepted (PNG + thumbnail)', up1.status === 200 && up1.data.upload.w === 1200 && up1.data.upload.h === 800 && /^\/u\/[\w-]{16}\.png$/.test(up1.data.upload.url), up1.data);
    const img = await fetch(BASE + up1.data.upload.url);
    check('image served with immutable cache + nosniff + inline', img.status === 200 && img.headers.get('content-type') === 'image/png' && /immutable/.test(img.headers.get('cache-control')) && /public/.test(img.headers.get('cache-control')) && img.headers.get('x-content-type-options') === 'nosniff' && /^inline/.test(img.headers.get('content-disposition') || ''), Object.fromEntries(img.headers));
    check('thumbnail served', (await fetch(BASE + up1.data.upload.thumb_url)).status === 200);
    check('wrong extension is 404', (await fetch(BASE + up1.data.upload.url.replace('.png', '.jpg'))).status === 404);
    const jpg = await uploadRaw(ada, fakeJpeg(900, 1600), null);
    check('JPEG size read from the file', jpg.status === 200 && jpg.data.upload.w === 900 && jpg.data.upload.h === 1600, jpg.data);
    const cam = new Client(); await cam.login('cam@test.dev', 'Cam Uploader');
    check('SVG rejected by magic bytes (content-type ignored)', (await uploadRaw(cam, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>'), null)).status === 415);
    check('GIF rejected', (await uploadRaw(cam, Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(50)]), null)).status === 415);
    check('thumbnail of another type rejected', (await uploadRaw(cam, fakePng(100, 100), fakeJpeg(50, 50))).status === 415);
    check('image over 600 KB rejected', (await uploadRaw(cam, fakePng(1000, 1000, 640 * 1024), null)).status === 413);
    let bigStatus = 0; try { bigStatus = (await uploadRaw(cam, fakePng(1000, 1000, 3 * 1024 * 1024), null, 'support')).status; } catch (e) { bigStatus = 'reset: ' + (e.cause && e.cause.code); }
    check('body far over the limit gets a 413 answer, not a dropped connection', bigStatus === 413, bigStatus);
    check('upload needs login', (await uploadRaw(anon, fakePng(10, 10), null)).status === 401);
    check('upload needs the x-vs header', (await fetch(`${BASE}/api/uploads`, { method: 'POST', headers: { cookie: ada.cookie }, body: fakePng(10, 10) })).status === 403);
    const im = await ada.post(`/api/rooms/${general.id}/messages`, { body: '', upload_id: up1.data.upload.id });
    check('image message without caption', im.status === 200 && im.data.message.attachment && im.data.message.attachment.id === up1.data.upload.id && im.data.message.attachment.w === 1200, im.data);
    check('same image cannot be attached twice', (await ada.post(`/api/rooms/${general.id}/messages`, { body: 'again', upload_id: up1.data.upload.id })).status === 400);
    check('someone else cannot attach your image', (await owner.post(`/api/rooms/${general.id}/messages`, { body: 'x', upload_id: jpg.data.upload.id })).status === 400);
    const rep = await owner.post(`/api/rooms/${general.id}/messages`, { body: 'Nice', reply_to: im.data.message.id });
    check('reply quote says Photo', rep.data.message.reply && rep.data.message.reply.body === 'Photo' && rep.data.message.reply.photo === true, rep.data.message.reply);
    const listI = await ada.get(`/api/rooms/${general.id}/messages`);
    check('room list carries the attachment', listI.data.messages.some((m) => m.attachment && m.attachment.id === up1.data.upload.id) && listI.data.room.can_image === true);
    const capRoom = await owner.post(`/api/rooms/${general.id}/messages`, { body: 'Team photo', upload_id: (await uploadRaw(owner, fakePng(800, 600), null)).data.upload.id });
    check('caption + image', capRoom.status === 200 && capRoom.data.message.body === 'Team photo' && !!capRoom.data.message.attachment);
    check('member cannot delete the image message of others', (await ada.del(`/api/messages/${capRoom.data.message.id}`)).status === 403);
    check('author deletes image message', (await ada.del(`/api/messages/${im.data.message.id}`)).status === 200);
    check('deleted message image is 404', (await fetch(BASE + up1.data.upload.url)).status === 404 && (await fetch(BASE + up1.data.upload.thumb_url)).status === 404);
    check('moderator delete removes image too', (await owner.del(`/api/messages/${capRoom.data.message.id}`)).status === 200 && !(await ada.get(`/api/rooms/${general.id}/messages`)).data.messages.find((m) => m.id === capRoom.data.message.id).attachment);
    // Room switch and global policy
    const genAdmin = (await owner.get('/api/admin/rooms')).data.rooms.find((r) => r.id === general.id);
    await owner.post('/api/admin/rooms', { ...genAdmin, images: false });
    const offUp = await uploadRaw(ada, fakePng(300, 300), null);
    check('room with images off refuses image messages', (await ada.post(`/api/rooms/${general.id}/messages`, { body: '', upload_id: offUp.data.upload.id })).status === 403 && (await ada.get('/api/rooms')).data.rooms.find((r) => r.id === general.id).can_image === false);
    await owner.post('/api/admin/rooms', { ...genAdmin, images: true });
    await owner.put('/api/admin/settings/images', { value: { who: 'team', daily_limit: 30, storage_mb: 200 } });
    check('"team only" blocks member chat uploads', (await uploadRaw(ada, fakePng(300, 300), null)).status === 403);
    check('"team only" still allows support screenshots', (await uploadRaw(ada, fakePng(300, 300), null, 'support')).status === 200);
    await owner.put('/api/admin/settings/images', { value: { who: 'everyone', daily_limit: 3, storage_mb: 200 } });
    const lims = []; for (let i = 0; i < 4; i++) lims.push((await uploadRaw(cam, fakePng(64, 64), null)).status);
    check('daily image limit enforced', lims.join() === '200,200,200,429', lims);
    await owner.put('/api/admin/settings/images', { value: { who: 'everyone', daily_limit: 30, storage_mb: 200 } });

    console.log('Room pictures and app store links');
    {
      const listR = (await ada.get('/api/rooms')).data.rooms;
      const slugs = ['announcements', 'introductions', 'general', 'tracking', 'creatives', 'telegram', 'geos-africa', 'tool-help', 'buyers-lounge', 'scaling-desk', 'offer-drops', 'creative-reviews', 'inner-circle'];
      check('every seeded room has house artwork (picture + cover)', slugs.every((sl) => { const r = listR.find((x) => x.slug === sl); return r && /^\/assets\/rooms\/[\w-]+\.webp\?v=\w+$/.test(r.image) && /-cover\.webp\?v=/.test(r.cover); }), listR.map((r) => [r.slug, r.image]));
      const artRes = await fetch(BASE + listR.find((x) => x.slug === 'general').image);
      const artBuf = Buffer.from(await artRes.arrayBuffer());
      check('artwork file is served as WebP', artRes.status === 200 && artBuf.toString('ascii', 8, 12) === 'WEBP');
      const dir = path.join(__dirname, '..', 'public', 'assets', 'rooms');
      const total = fs.readdirSync(dir).reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0);
      check('all artwork together stays under 1.5 MB', total > 0 && total < 1.5 * 1024 * 1024, total);
      const lockedR = (await cam.get('/api/rooms')).data.rooms.find((x) => x.slug === 'buyers-lounge');
      check('locked rooms show faces without names and no last message', !lockedR.unlocked && lockedR.last === null && lockedR.faces.every((f) => f.name === undefined), lockedR);
      const genR = listR.find((x) => x.slug === 'general');
      check('open rooms carry the last message and recent faces', genR.last && typeof genR.last.at === 'number' && genR.faces.length > 0 && genR.faces[0].name, genR.last);
      check('the public site lists room pictures', (await anon.get('/api/site')).data.rooms.every((r) => typeof r.image === 'string'));
      const anonGen = (await anon.get('/api/rooms')).data.rooms.find((x) => x.slug === 'general');
      check('logged-out visitors get no names or message text, even for free rooms', anonGen.last === null && anonGen.faces.length > 0 && anonGen.faces.every((f) => f.name === undefined && f.id === undefined), anonGen);

      check('members cannot upload room pictures', (await uploadRaw(ada, fakePng(512, 512), null, 'room')).status === 403);
      check('support agents cannot upload room pictures', (await uploadRaw(agent, fakePng(512, 512), null, 'room')).status === 403);
      const pic = await uploadRaw(owner, fakePng(512, 512), fakePng(240, 240), 'room');
      check('community staff upload a room picture', pic.status === 200, pic.data);
      check('room pictures are public by URL', (await fetch(BASE + pic.data.upload.url)).status === 200);
      check('SVG refused as a room picture', (await uploadRaw(owner, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), null, 'room')).status === 415);
      const genA = (await owner.get('/api/admin/rooms')).data.rooms.find((r) => r.slug === 'general');
      const tiny = await uploadRaw(owner, fakePng(40, 40), null, 'room');
      check('too small a picture is refused', (await owner.post('/api/admin/rooms', { ...genA, image_upload: tiny.data.upload.id })).status === 400);
      const squareAsCover = await uploadRaw(owner, fakePng(800, 800), null, 'room');
      check('a square image is refused as the cover', (await owner.post('/api/admin/rooms', { ...genA, cover_upload: squareAsCover.data.upload.id })).status === 400);
      const chatImg = await uploadRaw(owner, fakePng(512, 512), null, 'chat');
      check('a chat image cannot become a room picture', (await owner.post('/api/admin/rooms', { ...genA, image_upload: chatImg.data.upload.id })).status === 400);
      const cov = await uploadRaw(owner, fakePng(1200, 400), null, 'room');
      const savedPic = await owner.post('/api/admin/rooms', { ...genA, image_upload: pic.data.upload.id, cover_upload: cov.data.upload.id });
      check('room saves with an uploaded picture and cover', savedPic.status === 200 && savedPic.data.room.image_upload === pic.data.upload.id && savedPic.data.room.image === pic.data.upload.thumb_url && savedPic.data.room.cover === cov.data.upload.url, savedPic.data);
      const genM = (await ada.get('/api/rooms')).data.rooms.find((r) => r.slug === 'general');
      check('members see the uploaded picture instead of the artwork', genM.image === pic.data.upload.thumb_url && genM.cover === cov.data.upload.url);
      check('an attached picture cannot be reused on another room', (await owner.post('/api/admin/rooms', { ...(await owner.get('/api/admin/rooms')).data.rooms.find((r) => r.slug === 'tracking'), image_upload: pic.data.upload.id })).status === 400);
      const again = await owner.post('/api/admin/rooms', { ...savedPic.data.room, description: 'Anything about media buying and performance marketing.' });
      check('saving again without touching pictures keeps them', again.status === 200 && again.data.room.image_upload === pic.data.upload.id);
      const pic2 = await uploadRaw(owner, fakePng(600, 600), null, 'room');
      await owner.post('/api/admin/rooms', { ...again.data.room, image_upload: pic2.data.upload.id });
      check('a replaced picture is retired', (await fetch(BASE + pic.data.upload.url)).status === 404);
      const cleared = await owner.post('/api/admin/rooms', { ...again.data.room, image_upload: '', cover_upload: '' });
      check('removing the picture brings the house artwork back', cleared.status === 200 && /\/assets\/rooms\/general\.webp/.test(cleared.data.room.image) && /general-cover\.webp/.test(cleared.data.room.cover), cleared.data.room);
      const fresh = await owner.post('/api/admin/rooms', { name: 'Picture test room', topic: 'Craft', access: 'free', image_upload: (await uploadRaw(owner, fakePng(300, 300), null, 'room')).data.upload.id });
      check('a new room can be created with a picture', fresh.status === 200 && /^\/u\//.test(fresh.data.room.image) && fresh.data.room.cover === '');
      await owner.post('/api/admin/rooms', { ...fresh.data.room, archived: 1 });

      // App store links: website + member app.
      const apps0 = (await anon.get('/api/site')).data.apps;
      check('app links default to coming soon', apps0 && apps0.play_url === '' && apps0.app_store_url === '' && apps0.app_store_status === 'soon' && apps0.play_badge === null);
      check('members cannot change app links', (await ada.put('/api/admin/settings/apps', { value: { play_url: 'https://play.google.com/store/apps/details?id=x' } })).status === 403);
      check('Google Play link must be play.google.com', (await ed.put('/api/admin/settings/apps', { value: { play_url: 'https://evil.example/play' } })).status === 400);
      check('Google Play link must be https', (await ed.put('/api/admin/settings/apps', { value: { play_url: 'http://play.google.com/store/apps/details?id=x' } })).status === 400);
      check('javascript: links refused', (await ed.put('/api/admin/settings/apps', { value: { app_store_url: 'javascript:alert(1)' } })).status === 400);
      check('App Store link must be apps.apple.com', (await ed.put('/api/admin/settings/apps', { value: { app_store_url: 'https://apps.apple.com.evil.io/app/x' } })).status === 400);
      check('members cannot upload site badges', (await uploadRaw(ada, fakePng(646, 250), null, 'site')).status === 403);
      const bdg = await uploadRaw(ed, fakePng(646, 250), null, 'site');
      check('content editors upload a store badge', bdg.status === 200, bdg.data);
      const ap = await ed.put('/api/admin/settings/apps', { value: { play_url: 'https://play.google.com/store/apps/details?id=com.voosquare.app', play_badge_upload: bdg.data.upload.id, app_store_url: '' } });
      check('content editors save app links', ap.status === 200 && ap.data.value.play_badge && ap.data.value.play_badge.url === bdg.data.upload.url && ap.data.value.app_store_status === 'soon', ap.data);
      const apps1 = (await anon.get('/api/site')).data.apps;
      check('the website gets the Play link and badge', apps1.play_url.startsWith('https://play.google.com/') && apps1.play_badge.url === bdg.data.upload.url && apps1.app_store_status === 'soon' && apps1.play_badge_upload === undefined);
      check('the member app gets the app links', (await ada.get('/api/me/home')).data.apps.play_url === apps1.play_url);
      check('a badge from chat cannot be used', (await ed.put('/api/admin/settings/apps', { value: { play_badge_upload: (await uploadRaw(ed, fakePng(10, 10), null, 'support')).data.upload.id } })).status === 400);
      const ap2 = await ed.put('/api/admin/settings/apps', { value: { play_url: '', play_badge_upload: '', app_store_url: 'https://apps.apple.com/app/voosquare/id123' } });
      check('App Store goes live when its link is set; removed badge retired', ap2.status === 200 && ap2.data.value.app_store_status === 'live' && (await fetch(BASE + bdg.data.upload.url)).status === 404);
      await ed.put('/api/admin/settings/apps', { value: { play_url: '', play_badge_upload: '', app_store_url: '', app_store_badge_upload: '' } });
    }
    const muteMe = new Client(); const mv = await muteMe.login('mute@test.dev', 'Mute Me');
    await owner.patch(`/api/admin/customers/${mv.data.user.id}`, { mute_hours: 2 });
    check('muted member cannot upload chat images', (await uploadRaw(muteMe, fakePng(64, 64), null)).status === 403);
    // Support screenshots are private
    const sUp = await uploadRaw(ada, fakePng(1080, 2340), fakePng(222, 480), 'support');
    const tk = await ada.post('/api/support/tickets', { product_id: joinvoo.id, subject: 'Screenshot', body: 'See the error', upload_id: sUp.data.upload.id });
    check('ticket with screenshot', tk.status === 200);
    const tmsgs = await ada.get(`/api/support/tickets/${tk.data.ticket.id}`);
    check('member sees the screenshot in the thread', tmsgs.data.messages[0].attachment && tmsgs.data.messages[0].attachment.id === sUp.data.upload.id);
    check('screenshot is private: anonymous 404', (await fetch(BASE + sUp.data.upload.url)).status === 404);
    check('screenshot visible to its author', (await fetch(BASE + sUp.data.upload.url, { headers: { cookie: ada.cookie } })).status === 200);
    check('screenshot visible to support staff', (await fetch(BASE + sUp.data.upload.url, { headers: { cookie: agent.cookie } })).status === 200);
    const imgRes = await fetch(BASE + sUp.data.upload.url, { headers: { cookie: ada.cookie } });
    check('private image cache is private', /private/.test(imgRes.headers.get('cache-control')));
    const stUp = await uploadRaw(owner, fakePng(640, 480), null, 'support');
    const sr = await owner.post(`/api/admin/tickets/${tk.data.ticket.id}/reply`, { body: '', upload_id: stUp.data.upload.id });
    check('staff replies with an image', sr.status === 200 && (await ada.get(`/api/support/tickets/${tk.data.ticket.id}`)).data.messages.some((m) => m.author_type === 'staff' && m.attachment));
    check('member can open the staff image', (await fetch(BASE + stUp.data.upload.url, { headers: { cookie: ada.cookie } })).status === 200);
    const em = (await owner.get('/api/admin/emails')).data.queue.find((q) => q.template === 'support_reply' && q.to_email === 'ada@test.dev');
    check('reply email queued for the image (no attachment)', !!em);
    const wUp = await uploadRaw(owner, fakePng(640, 480), null, 'support');
    check('images cannot go to widget visitors', (await owner.post(`/api/admin/tickets/${w.data.ticket_id}/reply`, { body: 'x', upload_id: wUp.data.upload.id })).status === 400);
    const at = (await owner.get(`/api/admin/tickets/${tk.data.ticket.id}`)).data.messages;
    check('admin inbox shows attachments', at.filter((m) => m.attachment).length === 2);
    const discard = await uploadRaw(ada, fakePng(64, 64), null, 'support');
    check('member discards an unsent image', (await ada.del(`/api/uploads/${discard.data.upload.id}`)).status === 200 && (await fetch(BASE + discard.data.upload.url, { headers: { cookie: ada.cookie } })).status === 404);
    const stats = await owner.get('/api/admin/uploads/stats');
    check('storage stats', stats.status === 200 && stats.data.stats.count >= 3 && stats.data.stats.bytes > 0, stats.data);
    check('member cannot read storage stats', (await ada.get('/api/admin/uploads/stats')).status === 403);

    console.log('Payment methods: Gatevoo, custom manual, custom API');
    const ng = require('../src/netguard');
    check('SSRF guard blocks private and mapped addresses', ng.isBlockedIp('10.1.2.3') && ng.isBlockedIp('127.0.0.1') && ng.isBlockedIp('169.254.169.254') && ng.isBlockedIp('::1') && ng.isBlockedIp('::ffff:192.168.1.1') && ng.isBlockedIp('fd00::1') && !ng.isBlockedIp('8.8.8.8') && !ng.isBlockedIp('2606:4700::1111'));
    check('SSRF guard blocks IPv4 tunnelled in IPv6 (NAT64, 6to4, IPv4-compatible)', ng.isBlockedIp('64:ff9b::7f00:1') && ng.isBlockedIp('64:ff9b::a9fe:a9fe') && ng.isBlockedIp('2002:7f00:1::') && ng.isBlockedIp('::7f00:1') && ng.isBlockedIp('::ffff:0:a00:1') && !ng.isBlockedIp('1.1.1.1') && !ng.isBlockedIp('2001:4860:4860::8888'));
    check('SSRF guard refuses localhost URLs outside tests', !!ng.urlProblem('http://localhost:8080/x') && !!ng.urlProblem('https://127.0.0.1/') && !!ng.urlProblem('https://user:pw@example.com/') && ng.urlProblem('https://gatevoo.com/api') === '');
    let refused = false; try { await ng.guardedJson('http://localhost:9/'); } catch (e) { refused = /private/.test(e.message); }
    check('SSRF guard refuses a name that resolves to 127.0.0.1', refused);

    const mock = await mockProvider();
    try {
      const pms = (await owner.get('/api/admin/payment-methods')).data;
      const gv = pms.methods.find((m) => m.type === 'gatevoo');
      check('Gatevoo is seeded, switched off', !!gv && gv.enabled === 0 && gv.currency === 'USD' && gv.name === 'Pay with crypto · Gatevoo' && pms.types.gatevoo.test === true);
      check('cannot switch on Gatevoo without keys', (await owner.post('/api/admin/payment-methods', { ...gv, enabled: true })).status === 400);
      const gbase = `http://127.0.0.1:${mock.port}`;
      const tc = await owner.post('/api/admin/payment-methods/test', { id: gv.id, type: 'gatevoo', config: { api_base: gbase, api_key: 'gk_test', webhook_secret: 'whsec_test' } });
      check('Gatevoo test connection', tc.status === 200 && tc.data.ok === true && /Zedapex/.test(tc.data.checks.join(' ')), tc.data);
      const tcBad = await owner.post('/api/admin/payment-methods/test', { type: 'gatevoo', config: { api_base: gbase, api_key: 'wrong' } });
      check('test connection reports a bad key and a missing secret', tcBad.data.ok === false && tcBad.data.problems.length >= 2, tcBad.data);
      const gs = await owner.post('/api/admin/payment-methods', { ...gv, enabled: true, currency: 'NGN', rate: 1600, config: { api_base: gbase, api_key: 'gk_test', webhook_secret: 'whsec_test', assets: ['USDT_TRC20', 'BTC', 'DOGE'] } });
      check('Gatevoo saved: USD at 1, secrets masked, unknown coins dropped', gs.status === 200 && gs.data.method.currency === 'USD' && gs.data.method.rate === 1 && gs.data.method.config.api_key === '••••test' && gs.data.method.config.assets.join() === 'USDT_TRC20,BTC', gs.data);
      const re = await owner.post('/api/admin/payment-methods', { ...gs.data.method, name: 'Pay with crypto · Gatevoo' });
      check('saving with masked secrets keeps them', re.status === 200 && re.data.method.config.webhook_secret === '••••test');
      const bo = new Client(); await bo.login('bo@test.dev', 'Bo Buyer');
      const bm = (await bo.get('/api/billing/methods')).data.methods.find((m) => m.type === 'gatevoo');
      check('member sees Gatevoo with its coins', bm && bm.assets.join() === 'USDT_TRC20,BTC' && bm.redirect === true);
      const gco = await bo.post('/api/billing/checkout', { item: 'premium', method_id: gv.id });
      check('Gatevoo checkout redirects to the invoice', gco.status === 200 && gco.data.redirect_url === 'https://pay.gatevoo.test/i/inv_1', gco.data);
      check('invoice created with the contract fields', mock.st.lastCreate && mock.st.lastCreate.amount_usd === 20 && mock.st.lastCreate.order_id === gco.data.order.ref && /\/api\/billing\/webhook\/\d+$/.test(mock.st.lastCreate.webhook_url) && mock.st.lastCreate.assets.join() === 'USDT_TRC20,BTC' && mock.st.lastCreate.customer_email === 'bo@test.dev', mock.st.lastCreate);
      const hook = (body, secret) => { const raw = JSON.stringify(body); return fetch(`${BASE}/api/billing/webhook/${gv.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gatevoo-signature': crypto.createHmac('sha256', secret).update(raw).digest('hex') }, body: raw }); };
      const evt = { type: 'invoice.paid', invoice: { id: 'inv_1', order_id: gco.data.order.ref, status: 'paid', paid_amount: 20 } };
      check('webhook with a bad signature refused', (await hook(evt, 'not-the-secret')).status === 401);
      check('webhook with no signature refused', (await fetch(`${BASE}/api/billing/webhook/${gv.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(evt) })).status === 401);
      const early = await (await hook(evt, 'whsec_test')).json();
      check('signed webhook is re-checked with Gatevoo (still pending: no access)', early.paid === false && !(await bo.get('/api/me')).data.user.premium, early);
      mock.st.invoices.inv_1.status = 'paid'; mock.st.invoices.inv_1.paid_amount = 19;
      check('underpaid invoice does not unlock', (await (await hook(evt, 'whsec_test')).json()).paid === false);
      mock.st.invoices.inv_1.paid_amount = 20;
      const ok1 = await (await hook(evt, 'whsec_test')).json();
      const u1 = (await bo.get('/api/me')).data.user;
      check('paid invoice unlocks Premium', ok1.paid === true && u1.premium && u1.premium_until > Date.now() + 29 * 86400_000, ok1);
      await hook(evt, 'whsec_test'); await hook(evt, 'whsec_test');
      const u2 = (await bo.get('/api/me')).data.user;
      check('repeat webhooks are idempotent', u2.premium_until === u1.premium_until);
      check('order is paid once', (await bo.get('/api/me/orders')).data.orders.filter((o) => o.status === 'paid').length === 1);
      // A second order is confirmed by the return-page poll (GET to Gatevoo) without any webhook.
      const gco2 = await bo.post('/api/billing/checkout', { item: 'room', room_id: paid.id, method_id: gv.id });
      mock.st.invoices.inv_2.status = 'paid'; mock.st.invoices.inv_2.paid_amount = 49;
      const poll = await bo.get('/api/billing/orders/' + gco2.data.order.ref);
      check('order poll verifies with Gatevoo', poll.data.order.status === 'paid' && (await bo.get(`/api/rooms/${paid.id}/messages`)).status === 200, poll.data);
      const forged = { type: 'invoice.paid', invoice: { id: 'inv_X', order_id: gco2.data.order.ref } };
      check('webhook for an unknown invoice id is ignored', (await (await hook(forged, 'whsec_test')).json()).ok === true);
      const gv2 = await owner.post('/api/admin/payment-methods', { type: 'gatevoo', name: 'No secret', config: { api_base: gbase, api_key: 'gk_test' } });
      check('Gatevoo webhook refused when no secret is saved', (await fetch(`${BASE}/api/billing/webhook/${gv2.data.method.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gatevoo-signature': crypto.createHmac('sha256', '').update('{}').digest('hex') }, body: '{}' })).status === 401);

      // Custom manual method with copyable details and a screenshot proof
      const mm = await owner.post('/api/admin/payment-methods', { type: 'manual', name: 'MTN Mobile Money', currency: 'GHS', rate: 15, enabled: true, config: { icon: 'send', proof_mode: 'image', instructions: 'Send to the number below.', details: [{ label: 'MoMo number', value: '024 000 0000' }, { label: 'Name', value: 'Zedapex Ltd' }, { label: '', value: '' }, ...Array.from({ length: 6 }, (_, i) => ({ label: 'x' + i, value: 'y' })), { label: '<b>', value: 'z' }] } });
      check('custom manual method saved (max 6 details, blanks dropped)', mm.status === 200 && mm.data.method.config.details.length === 6 && mm.data.method.config.details[0].label === 'MoMo number', mm.data);
      const pub = (await bo.get('/api/billing/methods')).data.methods.find((m) => m.id === mm.data.method.id);
      check('custom manual details render in /api/billing/methods', pub && pub.details[0].value === '024 000 0000' && pub.icon === 'send' && pub.proof_mode === 'image' && pub.config === undefined, pub);
      const mco = await bo.post('/api/billing/checkout', { item: 'premium', method_id: mm.data.method.id });
      check('manual checkout returns the details', mco.data.pay.kind === 'manual' && mco.data.pay.details.length === 6 && mco.data.pay.amount === 300, mco.data.pay);
      check('screenshot required for this method', (await bo.post(`/api/billing/orders/${mco.data.order.ref}/proof`, { proof: 'REF12345' })).status === 400);
      const pUp = await uploadRaw(bo, fakePng(900, 1900), null, 'proof');
      const pr = await bo.post(`/api/billing/orders/${mco.data.order.ref}/proof`, { upload_id: pUp.data.upload.id });
      check('proof screenshot submitted', pr.status === 200 && pr.data.order.status === 'review', pr.data);
      const ro = (await owner.get('/api/admin/orders?status=review')).data.orders.find((o) => o.ref === mco.data.order.ref);
      check('admin order shows the proof image', ro && ro.proof_image && ro.proof_image.id === pUp.data.upload.id);
      check('proof image hidden from others', (await fetch(BASE + pUp.data.upload.url)).status === 404 && (await fetch(BASE + pUp.data.upload.url, { headers: { cookie: ada.cookie } })).status === 404);
      check('proof image visible to finance', (await fetch(BASE + pUp.data.upload.url, { headers: { cookie: owner.cookie } })).status === 200);

      // Custom API with a body template, minor units and a provider id field
      const ca = await owner.post('/api/admin/payment-methods', { type: 'custom', name: 'PayAny', currency: 'NGN', rate: 1600, enabled: true, config: { create_url: `http://127.0.0.1:${mock.port}/custom/create`, auth_header: 'Authorization: Bearer ca_secret', body_template: '{"amount": {{amount}}, "currency": "{{currency}}", "ref": "{{order_id}}", "customer": {"email": "{{email}}"}, "back": "{{return_url}}"}', minor_units: true, url_field: 'data.link', id_field: 'data.id', webhook_secret: 'cwh' } });
      check('custom API saved with secrets masked', ca.status === 200 && ca.data.method.config.auth_header.startsWith('••••') && ca.data.method.config.minor_units === true, ca.data);
      const cco = await bo.post('/api/billing/checkout', { item: 'premium', method_id: ca.data.method.id });
      check('custom API template rendered (minor units)', cco.data.redirect_url === 'https://pay.custom.test/c_9' && mock.st.customBody.amount === 3200000 && mock.st.customBody.currency === 'NGN' && mock.st.customBody.ref === cco.data.order.ref && mock.st.customBody.customer.email === 'bo@test.dev', mock.st.customBody);
      check('bad body template refused when switching on', (await owner.post('/api/admin/payment-methods', { ...ca.data.method, config: { ...ca.data.method.config, body_template: '{"amount": {{amount}' } })).status === 400);

      // Admin list: delete only without orders, duplicate, reorder
      check('method with orders cannot be deleted', (await owner.del(`/api/admin/payment-methods/${gv.id}`)).status === 409);
      const dup = await owner.post(`/api/admin/payment-methods/${mm.data.method.id}/duplicate`);
      check('duplicate starts switched off', dup.status === 200 && dup.data.method.enabled === 0 && dup.data.method.config.details.length === 6);
      check('unused method deletes', (await owner.del(`/api/admin/payment-methods/${dup.data.method.id}`)).status === 200);
      const ids = (await owner.get('/api/admin/payment-methods')).data.methods.map((m) => m.id);
      const ro2 = await owner.post('/api/admin/payment-methods/reorder', { ids: [...ids].reverse() });
      check('reorder', ro2.data.methods[0].id === ids[ids.length - 1]);
      const ssrfSave = await owner.post('/api/admin/payment-methods', { type: 'custom', name: 'Bad', enabled: true, config: { create_url: 'javascript:alert(1)', webhook_secret: 'x' } });
      check('unsafe custom URL refused', ssrfSave.status === 400);
    } finally { mock.srv.close(); }

    console.log('Live updates and security headers');
    {
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(DB);
      const gid = general.id;
      const u1 = new Client(); await u1.login('live.one@test.dev', 'Live One');
      const u2 = new Client(); await u2.login('live.two@test.dev', 'Live Two');
      const watch = await openStream(owner, 'staff');
      const s1 = await openStream(u1, 'room:' + gid);
      check('stream: signed-in member gets their channel and the room', s1.channels.includes('room:' + gid) && s1.channels.some((c) => c.startsWith('user:')));
      const s2a = await openStream(u2, 'room:' + gid); const s2b = await openStream(u2, 'room:' + gid);
      const anon = await openStream(null, 'room:' + gid);
      check('stream: visitors get community only', anon.channels.join() === 'community');
      const roomOnline = async () => (await ada.get('/api/rooms')).data.rooms.find((r) => r.id === gid).online;
      check('presence: distinct people per room (two tabs count once)', (await roomOnline()) === 2, await roomOnline());
      check('presence: change broadcast to the community channel as a count', await until(() => watch.events('presence').some((e) => e.room_id === gid && e.online === 2)), watch.events('presence'));
      check('presence: no names in presence events', watch.events('presence').every((e) => Object.keys(e).sort().join() === 'online,room_id'));
      await owner.patch(`/api/admin/customers/${u1.user ? u1.user.id : (await u1.get('/api/me')).data.user.id}`, { banned: true });
      check('ban: open streams close at once', await until(() => s1.ended, 1500) && s1.events('bye').length === 1);
      const s1r = await openStream(u1, 'room:' + gid);
      check('ban: reconnecting with the old cookie gets nothing private', s1r.channels.join() === 'community');
      s1r.close();
      check('presence: leaving updates the count', await until(async () => (await roomOnline()) === 1) && await until(() => watch.events('presence').some((e) => e.room_id === gid && e.online === 1)));
      await u2.post('/api/auth/logout');
      check('logout: that session\'s streams close', await until(() => s2a.ended && s2b.ended, 1500));
      const u3 = new Client(); await u3.login('live.three@test.dev', 'Live Three');
      const s3 = await openStream(u3, 'room:' + gid);
      const u3id = (await u3.get('/api/me')).data.user.id;
      sql.prepare('UPDATE sessions SET expires=? WHERE user_id=?').run(Date.now() - 1000, u3id);
      check('expired session: stream closed by the periodic re-check', await until(() => s3.ended, 3000));
      const s4 = await openStream(u3, 'room:' + gid);
      check('expired session: reconnect is anonymous', s4.channels.join() === 'community');
      s4.close(); anon.close(); watch.close();

      const pages = ['/', '/login', '/app', '/admin', '/api/me', '/no-such-page', '/oauth/authorize?client_id=nope'];
      for (const pth of pages) {
        const r = await fetch(BASE + pth, { redirect: 'manual' });
        const csp = r.headers.get('content-security-policy') || '';
        const scriptSrc = (csp.split(';').map((x) => x.trim()).find((x) => x.startsWith('script-src')) || '');
        check(`security headers on ${pth}`, scriptSrc === "script-src 'self'" && /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /img-src 'self' data: blob: https:/.test(csp)
          && r.headers.get('x-frame-options') === 'DENY' && /camera=\(\)/.test(r.headers.get('permissions-policy') || '') && r.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', [pth, csp]);
      }
      const htmlFiles = fs.readdirSync(path.join(__dirname, '..', 'public')).filter((f) => f.endsWith('.html'));
      const inline = htmlFiles.filter((f) => { const h = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8'); return /<script(?![^>]*\bsrc=)[^>]*>/i.test(h) || /\son[a-z]+\s*=/i.test(h.replace(/<style[\s\S]*?<\/style>/g, '')); });
      check('CSP: no inline scripts or inline event handlers in the HTML pages', inline.length === 0, inline);
      const jsInline = fs.readdirSync(path.join(__dirname, '..', 'public', 'js')).filter((f) => /\son(click|error|load|change|input|submit)=/.test(fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')));
      check('CSP: no inline event handlers in generated HTML', jsInline.length === 0, jsInline);
      sql.close();
    }

    console.log('Revenue');
    {
      // Real flows: checkout, proof, approval, Events API. The test moves paid_at into March 2025 so the numbers are exact.
      const { DatabaseSync } = require('node:sqlite');
      const sql = new DatabaseSync(DB);
      const iso = (s) => Date.parse(s);
      const usdt = (await owner.get('/api/admin/payment-methods')).data.methods.find((m) => m.type === 'crypto' && m.currency === 'USDT');
      await owner.post('/api/admin/payment-methods', { ...usdt, enabled: true, config: { ...usdt.config, address: 'TXYZtestaddress123' } });
      const rv1 = new Client(); const r1 = (await rv1.login('rev.one@test.dev', 'Rev One')).data.user;
      const rv2 = new Client(); const r2 = (await rv2.login('rev.two@test.dev', 'Rev Two')).data.user;
      const buy = async (c, body, paidAt, approve = true) => {
        const co = await c.post('/api/billing/checkout', { ...body, method_id: usdt.id });
        await c.post(`/api/billing/orders/${co.data.order.ref}/proof`, { proof: '0xrevenuetesthash' + co.data.order.ref });
        const o = (await owner.get('/api/admin/orders?status=review')).data.orders.find((x) => x.ref === co.data.order.ref);
        if (approve) await owner.post(`/api/admin/orders/${o.id}/approve`); else await owner.post(`/api/admin/orders/${o.id}/reject`, { reason: 'No payment' });
        sql.prepare('UPDATE orders SET paid_at=?, created_at=? WHERE id=?').run(paidAt, paidAt, o.id);
        return o;
      };
      await buy(rv1, { item: 'premium' }, iso('2025-03-10T23:30:00Z')); // 00:30 on 11 March in Lagos
      await buy(rv2, { item: 'room', room_id: paid.id }, iso('2025-03-10T22:59:00Z')); // 23:59 on 10 March in Lagos
      await buy(rv2, { item: 'premium' }, iso('2025-03-12T10:00:00Z'), false); // rejected: never counts
      const pend = await rv2.post('/api/billing/checkout', { item: 'premium', method_id: usdt.id });
      sql.prepare('UPDATE orders SET paid_at=? WHERE ref=?').run(iso('2025-03-12T10:00:00Z'), pend.data.order.ref); // pending: never counts
      const jv = (await owner.get('/api/admin/products')).data.products.find((p) => p.slug === 'joinvoo');
      const jkey = (await owner.get(`/api/admin/products/${jv.id}`)).data.product.api_key;
      const evList = [
        { event_id: 'rv-s1', voo_id: r1.voo_id, type: 'spend', label: 'Joinvoo Pro', value_usd: 100, occurred_at: '2025-03-15T12:00:00Z' },
        { event_id: 'rv-s2', voo_id: r2.voo_id, type: 'spend', label: 'Joinvoo Basic', value_usd: 30, occurred_at: '2025-03-31T23:30:00Z' }, // 1 April in Lagos
        { event_id: 'rv-s3', voo_id: r1.voo_id, type: 'spend', value_usd: 40, occurred_at: '2025-02-20T09:00:00Z' }, // previous period
        { event_id: 'rv-s4', type: 'spend', value_usd: 10, occurred_at: '2025-03-20T09:00:00Z' }, // no Voo ID: revenue, not a paying member
        { event_id: 'rv-f1', voo_id: r1.voo_id, type: 'ftd', value_usd: 500, occurred_at: '2025-03-12T09:00:00Z' }, // not revenue
      ];
      // The Events API refuses times older than 400 days, so the events go in now and the test moves them into 2025.
      const evr = await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer ' + jkey, 'content-type': 'application/json' }, body: JSON.stringify({ events: evList.map(({ occurred_at, ...e }) => e) }) });
      check('revenue: spend events stored', (await evr.json()).stored === 5);
      for (const e of evList) sql.prepare('UPDATE events SET created_at=?, received_at=? WHERE ext_id=?').run(iso(e.occurred_at), iso(e.occurred_at), e.event_id);
      // Event times: more than 10 minutes ahead is clamped to the time received, older than 400 days is refused.
      const tNow = Date.now();
      const evT = await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer ' + jkey, 'content-type': 'application/json' }, body: JSON.stringify({ events: [
        { event_id: 'tm-future', type: 'signup', occurred_at: new Date(tNow + 3 * 86400_000).toISOString() },
        { event_id: 'tm-skew', type: 'signup', occurred_at: new Date(tNow + 5 * 60_000).toISOString() },
        { event_id: 'tm-old', type: 'signup', occurred_at: new Date(tNow - 401 * 86400_000).toISOString() },
        { event_id: 'tm-ok', type: 'signup', occurred_at: new Date(tNow - 399 * 86400_000).toISOString() },
      ] }) }).then((x) => x.json());
      const tRow = (id) => sql.prepare('SELECT created_at, received_at FROM events WHERE ext_id=?').get(id);
      check('events: future occurred_at clamped to the time received', evT.stored === 3 && evT.clamped === 1 && tRow('tm-future').created_at === tRow('tm-future').received_at && tRow('tm-future').received_at <= Date.now(), evT);
      check('events: a few minutes of clock skew kept', tRow('tm-skew').created_at > tRow('tm-skew').received_at);
      check('events: older than 400 days refused and listed', !tRow('tm-old') && evT.rejected && evT.rejected[0].event_id === 'tm-old' && tRow('tm-ok') && tRow('tm-ok').received_at >= tNow, evT.rejected);

      check('reporting time zone rejects nonsense', (await owner.put('/api/admin/settings/reporting_tz', { value: 'Mars/Olympus' })).status === 400);
      check('reporting time zone saves', (await owner.put('/api/admin/settings/reporting_tz', { value: 'Africa/Lagos' })).status === 200 && (await owner.get('/api/admin/settings/reporting_tz')).data.value === 'Africa/Lagos');
      check('support agent cannot change the time zone', (await agent.put('/api/admin/settings/reporting_tz', { value: 'UTC' })).status === 403);

      const m = (await owner.get('/api/admin/revenue?from=2025-03-01&to=2025-03-31&group=day')).data;
      const day = (k) => m.series.find((s) => s.bucket === k);
      check('revenue: daily series is zero-filled (31 days)', m.series.length === 31 && m.series[0].bucket === '2025-03-01' && m.series[30].bucket === '2025-03-31' && day('2025-03-02').total === 0, m.series.length);
      check('revenue: 23:59 Lagos stays on its day', day('2025-03-10').total === 49 && day('2025-03-10').by.voosquare === 49, day('2025-03-10'));
      check('revenue: 23:30 UTC counts as the next day in Lagos', day('2025-03-11').total === 20, day('2025-03-11'));
      check('revenue: tool spend by product', day('2025-03-15').by.joinvoo === 100 && day('2025-03-20').total === 10);
      check('revenue: totals', m.totals.revenue === 179 && m.totals.orders_revenue === 69 && m.totals.tools_revenue === 110 && m.totals.orders === 2 && m.totals.paying_users === 2, m.totals);
      check('revenue: totals equal the sum of the series', Math.abs(m.series.reduce((a, s) => a + s.total, 0) - m.totals.revenue) < 1e-9);
      check('revenue: rejected, pending and ftd never count', !m.series.some((s) => s.total >= 500) && day('2025-03-12').total === 0);
      check('revenue: previous period and change', m.range.prev_from === '2025-01-29' && m.range.prev_to === '2025-02-28' && m.totals.prev_revenue === 40 && m.totals.change_pct === 347.5, [m.range, m.totals]);
      check('revenue: average per paying customer', m.totals.arpu === 84.5, m.totals.arpu); // (20+100 + 49) / 2; the $10 without a Voo ID is not a member
      check('revenue: VooSquare kinds', m.kinds.length === 2 && m.kinds.find((k) => k.key === 'premium').revenue === 20 && m.kinds.find((k) => k.key === 'room:' + paid.id).revenue === 49);
      check('revenue: top customer and split', m.top_customers[0].id === r1.id && m.top_customers[0].total === 120 && m.top_customers[0].by_product.joinvoo === 100 && m.top_customers[0].email === 'rev.one@test.dev');
      check('revenue: by product shares', m.by_product[0].key === 'joinvoo' && m.by_product[0].revenue === 110 && Math.abs(m.by_product.reduce((a, p) => a + p.share, 0) - 1) < 1e-9);
      check('revenue: recent payments newest first', m.recent.length === 4 && m.recent[0].amount_usd === 10 && m.recent.every((x, i, a) => !i || a[i - 1].at >= x.at));
      const apr = (await owner.get('/api/admin/revenue?from=2025-04-01&to=2025-04-01')).data;
      check('revenue: 31 Mar 23:30 UTC lands on 1 April', apr.totals.revenue === 30 && apr.series.length === 1);
      const wk = (await owner.get('/api/admin/revenue?from=2025-03-01&to=2025-03-31&group=week')).data;
      check('revenue: weeks start on Monday, first week clipped', wk.series[0].bucket === '2025-02-24' && wk.series[0].start_date === '2025-03-01' && wk.series[0].end_date === '2025-03-02' && wk.series[1].bucket === '2025-03-03' && wk.series.find((s) => s.bucket === '2025-03-10').total === 169 && wk.series.length === 6, wk.series.map((s) => [s.bucket, s.start_date, s.end_date, s.total]));
      const mo = (await owner.get('/api/admin/revenue?from=2025-01-01&to=2025-04-30&group=month')).data;
      check('revenue: months', mo.series.map((s) => s.bucket).join() === '2025-01,2025-02,2025-03,2025-04' && mo.series[1].total === 40 && mo.series[2].total === 179 && mo.series[3].total === 30, mo.series.map((s) => s.total));
      const q = async (p) => (await owner.get('/api/admin/revenue?from=2025-03-01&to=2025-03-31&' + p)).data.totals.revenue;
      check('revenue: product and source filters', (await q('product=joinvoo')) === 110 && (await q('product=voosquare')) === 69 && (await q('source=orders')) === 69 && (await q('source=tools')) === 110 && (await q('product=castvoo')) === 0);
      await owner.put('/api/admin/settings/reporting_tz', { value: 'UTC' });
      const utc = (await owner.get('/api/admin/revenue?from=2025-03-10&to=2025-03-11')).data;
      check('revenue: reporting time zone moves the day boundary', utc.tz === 'UTC' && utc.series[0].total === 69 && utc.series[1].total === 0, utc.series.map((s) => s.total));
      await owner.put('/api/admin/settings/reporting_tz', { value: 'Africa/Lagos' });
      const bad = async (p) => (await owner.get('/api/admin/revenue?' + p)).status;
      check('revenue: bad parameters refused', await bad('from=2025-02-31&to=2025-03-01') === 400 && await bad('from=2025-03-02&to=2025-03-01') === 400 && await bad('from=2020-01-01&to=2025-03-01') === 400
        && await bad('from=2024-01-01&to=2025-03-01&group=day') === 400 && await bad('product=nope') === 400 && await bad('group=year') === 400 && await bad('source=x') === 400);
      check('revenue: presets resolve on the server', (await owner.get('/api/admin/revenue?range=7d')).data.range.days === 7 && (await owner.get('/api/admin/revenue?range=all')).data.range.preset === 'all');
      check('revenue: support and content staff get 403', (await agent.get('/api/admin/revenue')).status === 403 && (await ed.get('/api/admin/revenue')).status === 403 && (await agent.get('/api/admin/revenue.csv')).status === 403 && (await agent.get(`/api/admin/customers/${r1.id}/spend`)).status === 403);
      await owner.post('/api/admin/team', { email: 'finance@test.dev', perms: ['payments'], role_title: 'Finance' });
      const fin = new Client(); await fin.login('finance@test.dev');
      const fm = (await fin.get('/api/admin/revenue?from=2025-03-01&to=2025-03-31')).data;
      check('revenue: finance sees money, emails masked without customer access', fm.totals.revenue === 179 && fm.top_customers[0].email === 're•••@test.dev', fm.top_customers[0] && fm.top_customers[0].email);

      const csv = await fetch(BASE + '/api/admin/revenue.csv?from=2025-03-01&to=2025-03-31&group=day', { headers: { cookie: owner.cookie } });
      const body = await csv.text();
      const lines = body.trim().split('\r\n');
      check('revenue CSV: attachment with one row per day and a total', csv.status === 200 && /attachment; filename="voosquare-revenue_2025-03-01_2025-03-31_day\.csv"/.test(csv.headers.get('content-disposition')) && /text\/csv/.test(csv.headers.get('content-type')) && lines.length === 33 && lines[0].includes('total_usd') && lines[0].includes('Joinvoo_usd') && lines[32].startsWith('total,2025-03-01,2025-03-31,179.00'), lines[0]);
      check('revenue CSV: day row values', lines.find((l) => l.startsWith('2025-03-11,')).split(',')[3] === '20.00');

      const sp = (await owner.get(`/api/admin/customers/${r1.id}/spend`)).data;
      check('customer spend: lifetime and split', sp.lifetime.total === 160 && sp.lifetime.orders_total === 20 && sp.lifetime.tools_total === 140 && sp.lifetime.count === 3 && sp.lifetime.first_at === iso('2025-02-20T09:00:00Z'), sp.lifetime);
      check('customer spend: all time range by month', sp.range.preset === 'all' && sp.range.from === '2025-02-20' && sp.range.group === 'month' && sp.total === 160 && Math.abs(sp.series.reduce((a, s) => a + s.total, 0) - 160) < 1e-9);
      check('customer spend: per product with last purchase', sp.by_product[0].key === 'joinvoo' && sp.by_product[0].revenue === 140 && sp.by_product[0].last_at === iso('2025-03-15T12:00:00Z') && sp.by_product.find((p) => p.key === 'voosquare').revenue === 20);
      check('customer spend: timeline newest first', sp.timeline.items.length === 3 && sp.timeline.items[0].amount_usd === 100 && sp.timeline.items[1].kind === 'order' && sp.timeline.items[1].label === 'VooSquare Premium');
      const sp30 = (await owner.get(`/api/admin/customers/${r1.id}/spend?range=30d`)).data;
      check('customer spend: 30-day range is empty for old purchases', sp30.total === 0 && sp30.series.length === 30 && sp30.lifetime.total === 160);
      const sr = (await owner.get(`/api/admin/customers/${r1.id}/spend?from=2025-03-01&to=2025-03-31&group=week`)).data;
      check('customer spend: custom range', sr.total === 120 && sr.timeline.total === 2);
      check('customer spend: unknown member 404', (await owner.get('/api/admin/customers/999999/spend')).status === 404);
      // A tool sending Infinity (1e999 in JSON) or an absurd amount must not poison revenue (was: totals came back null).
      const evBad = await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer ' + jkey, 'content-type': 'application/json' },
        body: `{"events":[{"event_id":"rv-inf","voo_id":"${r1.voo_id}","type":"spend","value_usd":1e999},{"event_id":"rv-huge","type":"spend","value_usd":"1e300"}]}` });
      check('events: Infinity and absurd values stored as 0', (await evBad.json()).stored === 2 && sql.prepare("SELECT COUNT(*) n FROM events WHERE ext_id IN ('rv-inf','rv-huge') AND value_usd=0").get().n === 2);
      sql.prepare("INSERT INTO events(product_id,user_id,ext_id,type,label,value_usd,created_at) VALUES(?,?,'rv-old-inf','spend','',?,?)").run(jv.id, r1.id, Infinity, iso('2025-03-16T12:00:00Z')); // stored before the check
      const mInf = (await owner.get('/api/admin/revenue?from=2025-03-01&to=2025-03-31')).data;
      check('revenue: Infinity rows ignored', mInf.totals.revenue === 179 && (await owner.get(`/api/admin/customers/${r1.id}/spend`)).data.lifetime.total === 160, mInf.totals);

      const cl = (await owner.get('/api/admin/customers?filter=paying&sort=spent')).data;
      check('customers: paying filter and spent sort', cl.money === true && cl.customers.every((c) => c.spent > 0) && cl.customers.every((c, i, a) => !i || a[i - 1].spent >= c.spent) && cl.customers.find((c) => c.id === r1.id).spent === 160, cl.customers.map((c) => c.spent));
      const ca = (await agent.get('/api/admin/customers?sort=spent')).data;
      check('customers: support staff never see spend', ca.money === false && ca.customers.every((c) => c.spent === undefined));
      const ov = (await owner.get('/api/admin/overview')).data;
      check('overview: 30-day revenue series in the reporting time zone', ov.revenue_series.length === 30 && Math.abs(ov.revenue_series.reduce((a, b) => a + b, 0) - ov.revenue_30d) < 0.01 && ov.reporting_tz === 'Africa/Lagos');

      console.log('Referral payouts');
      {
        const DAY = 86400000; const ago = (d) => Date.now() - d * DAY;
        const xf = () => ({ 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
        const signup = async (email, name, ref) => {
          const c = new Client();
          const s = await c.post('/api/auth/start', { email, name, ref }, xf());
          const v = await c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf());
          c.user = v.data.user; return c;
        };
        const refr = await signup('referrer@test.dev', 'Ref <img src=x onerror=alert(1)>');
        const me0 = (await refr.get('/api/me/referrals')).data;
        check('referrals: new member starts empty', me0.balance.available === 0 && me0.balance.lifetime === 0 && me0.can_request === false && me0.min_withdraw === 300 && me0.settle_days === 30 && me0.to_go === 300 && me0.method === null && me0.payouts.length === 0 && me0.terms.length > 40, me0);
        const kids = [];
        for (let i = 0; i < 5; i++) kids.push(await signup(`refkid${i}@test.dev`, `Kid ${i}`, me0.code));
        check('referrals: sign-ups with the link are linked', kids.every((k) => sql.prepare('SELECT referred_by FROM users WHERE id=?').get(k.user.id).referred_by === refr.user.id));
        const hub = sql.prepare('SELECT id FROM products WHERE hub=1').get();
        const ev = sql.prepare("INSERT INTO events(product_id,user_id,ext_id,type,label,value_usd,created_at) VALUES(?,?,?,'spend','',?,?)");
        const od = sql.prepare("INSERT INTO orders(ref,user_id,item_type,item_id,item_name,amount_usd,currency,amount,status,created_at,paid_at) VALUES(?,?,'premium',0,'VooSquare Premium',?,'USD',?,?,?,?)");
        ev.run(jv.id, kids[0].user.id, 'rf-1', 100, ago(40)); // settled
        od.run('RFO-1', kids[1].user.id, 20, 20, 'paid', ago(41), ago(40)); // settled Premium order
        ev.run(jv.id, kids[2].user.id, 'rf-2', 50, ago(5)); // still settling
        od.run('RFO-2', kids[3].user.id, 200, 200, 'refunded', ago(41), ago(40)); // refunded: never counts
        od.run('RFO-3', kids[3].user.id, 80, 80, 'failed', ago(41), null); // rejected: never counts
        ev.run(hub.id, kids[4].user.id, 'rf-hub', 500, ago(40)); // the hub's own key: never counts
        ev.run(jv.id, kids[4].user.id, 'rf-huge', 5e9, ago(40)); // absurd amount: ignored
        const m1 = (await refr.get('/api/me/referrals')).data;
        check('ledger: orders and tool spend count, refunds, failed, hub and absurd values do not', m1.spend_usd === 170 && m1.paying === 3 && m1.referred === 5, [m1.spend_usd, m1.paying]);
        check('ledger: current tier rate (10%) and settle days', m1.rate === 10 && m1.balance.lifetime === 17 && m1.balance.settled === 12 && m1.balance.pending === 5 && m1.balance.available === 12, m1.balance);
        check('ledger: next settle date and amount', m1.next_settle && m1.next_settle.amount === 5 && Math.abs(m1.next_settle.at - (ago(5) + 30 * DAY)) < 60000, m1.next_settle);
        check('ledger: people show totals only (no emails)', m1.people.length === 5 && m1.people.find((p) => p.name === 'Kid 0').earned_usd === 10 && m1.people.find((p) => p.name === 'Kid 3').paying === false && !JSON.stringify(m1.people).includes('@'));
        check('ledger: next tier', m1.next_tier && m1.next_tier.rate === 20 && m1.next_tier.need === 2, m1.next_tier);

        check('referral settings: bad settle days refused', (await owner.put('/api/admin/settings/referrals', { value: { tiers: [{ min: 1, rate: 10 }], min_withdraw: 300, settle_days: 400 } })).status === 400);
        check('referral settings: support agent cannot edit', (await agent.put('/api/admin/settings/referrals', { value: { tiers: [], min_withdraw: 1, settle_days: 0 } })).status === 403);
        const rs = await owner.put('/api/admin/settings/referrals', { value: { tiers: [{ min: 3, rate: 25 }, { min: 1, rate: 10 }, { min: 9, rate: 0 }], min_withdraw: 100, settle_days: 30, terms: 'Paid by the Zedapex team.' } });
        check('referral settings: tiers cleaned and sorted, terms saved', rs.status === 200 && rs.data.value.tiers.length === 2 && rs.data.value.tiers[0].min === 1 && rs.data.value.terms === 'Paid by the Zedapex team.', rs.data);
        const m2 = (await refr.get('/api/me/referrals')).data;
        check('ledger: the current tier applies to all earnings', m2.rate === 25 && m2.balance.lifetime === 42.5 && m2.balance.settled === 30 && m2.balance.available === 30 && m2.terms === 'Paid by the Zedapex team.', m2.balance);

        const pm = (b) => refr.put('/api/me/payout-method', b);
        check('payout method: TRC20 address validated', (await pm({ type: 'usdt_trc20', address: 'T123' })).status === 400 && (await pm({ type: 'usdt_trc20', address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F' })).status === 400);
        check('payout method: bank needs a real account number and country', (await pm({ type: 'bank', bank_name: 'GTBank', account_number: '12', account_name: 'Ref', country: 'NG' })).status === 400 && (await pm({ type: 'bank', bank_name: 'GTBank', account_number: '0123456789', account_name: 'Ref', country: '' })).status === 400);
        check('payout method: mobile money needs a phone number', (await pm({ type: 'mobile_money', provider: 'M-Pesa', number: 'abc', name: 'Ref', country: 'KE' })).status === 400);
        check('payout method: unknown type refused', (await pm({ type: 'paypal', email: 'x@y.z' })).status === 400);

        check('payout: refused without payout details', (await refr.post('/api/me/payouts')).status === 400);
        const okM = await pm({ type: 'bank', bank_name: 'GTBank <b>', account_number: '0123 4567 89', account_name: 'Ref Owner', country: 'ng' });
        check('payout method: bank saved, number normalised, masked summary', okM.status === 200 && okM.data.method.details.account_number === '0123456789' && okM.data.method.summary === 'GTBank <b> ••••6789' && okM.data.method.country === 'NG', okM.data);
        const okT = await pm({ type: 'usdt_trc20', address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' });
        check('payout method: TRC20 saved (one set per member)', okT.status === 200 && okT.data.method.summary === 'TQn9…bLSE' && sql.prepare('SELECT COUNT(*) n FROM payout_methods WHERE user_id=?').get(refr.user.id).n === 1);

        check('payout: refused below the minimum', (await refr.post('/api/me/payouts')).status === 400 && (await refr.get('/api/me/referrals')).data.can_request === false);
        await owner.put('/api/admin/settings/referrals', { value: { tiers: [{ min: 1, rate: 10 }, { min: 3, rate: 25 }], min_withdraw: 25, settle_days: 30, terms: '' } });
        const [r1p, r2p] = await Promise.all([refr.post('/api/me/payouts'), refr.post('/api/me/payouts')]);
        const okReq = [r1p, r2p].filter((r) => r.status === 200);
        check('payout: double click creates one request', okReq.length === 1 && [r1p, r2p].some((r) => r.status === 409) && sql.prepare("SELECT COUNT(*) n FROM payouts WHERE user_id=? AND status='requested'").get(refr.user.id).n === 1, [r1p.status, r2p.status]);
        const po1 = okReq[0].data.payout;
        check('payout: full available amount, method snapshot', po1.amount_usd === 30 && po1.status === 'requested' && po1.method.type === 'usdt_trc20' && po1.method.details === undefined);
        const m3 = (await refr.get('/api/me/referrals')).data;
        check('payout: balance moves to open', m3.balance.available === 0 && m3.balance.open === 30 && m3.open_payout.id === po1.id && m3.can_request === false);
        check('payout: second request refused while one is open', (await refr.post('/api/me/payouts')).status === 409);
        check('payout method: locked while a request is open', (await pm({ type: 'usdt_trc20', address: 'TJRabPrwbZy45sbavfcjinPJC18kjpRTv8' })).status === 409);
        check('payout: confirmation email queued', (await owner.get('/api/admin/emails')).data.queue.some((q) => q.template === 'payout_requested' && q.to_email === 'referrer@test.dev'));

        const other = kids[0];
        check('payout: another member cannot cancel it', (await other.post(`/api/me/payouts/${po1.id}/cancel`)).status === 404);
        check('payout: members cannot open the admin queue', (await other.get('/api/admin/payouts')).status === 403 && (await refr.get(`/api/admin/payouts/${po1.id}`)).status === 403);
        check('payout: support staff get 403', (await agent.get('/api/admin/payouts')).status === 403 && (await agent.post(`/api/admin/payouts/${po1.id}/paid`, { reference: 'abcdef' })).status === 403 && (await agent.get(`/api/admin/customers/${refr.user.id}/referrals`)).status === 403);
        const cnc = await refr.post(`/api/me/payouts/${po1.id}/cancel`);
        check('payout: member cancels, money returns', cnc.status === 200 && cnc.data.stats.balance.available === 30 && cnc.data.stats.payouts[0].status === 'cancelled');
        check('payout: cancelled cannot be cancelled again', (await refr.post(`/api/me/payouts/${po1.id}/cancel`)).status === 409);

        const po2 = (await refr.post('/api/me/payouts')).data.payout;
        const fq = await fin.get('/api/admin/payouts?status=requested');
        const row = fq.data.payouts.find((p) => p.id === po2.id);
        check('admin payouts: finance sees the queue with full details, email masked', fq.status === 200 && row && row.amount_usd === 30 && row.method.details.address === 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' && row.member.email.includes('•••') && fq.data.totals.requested >= 1, row);
        const oq = (await owner.get('/api/admin/payouts?status=open')).data.payouts.find((p) => p.id === po2.id);
        check('admin payouts: owner sees the email', oq && oq.member.email === 'referrer@test.dev' && oq.member.name === 'Ref <img src=x onerror=alert(1)>');
        const det = (await fin.get(`/api/admin/payouts/${po2.id}`)).data;
        check('admin payout detail: earnings by product and history', det.summary.by_product.find((p) => p.key === 'joinvoo').earned === 37.5 && det.summary.by_product.find((p) => p.key === 'voosquare').earned === 5 && det.summary.history.length === 2 && det.summary.rate === 25, det.summary.by_product);
        check('admin: mark paid needs a reference', (await fin.post(`/api/admin/payouts/${po2.id}/paid`, { reference: '' })).status === 400);
        const proc = await fin.post(`/api/admin/payouts/${po2.id}/processing`);
        check('admin: mark processing', proc.status === 200 && proc.data.payout.status === 'processing');
        check('payout: member cannot cancel once processing', (await refr.post(`/api/me/payouts/${po2.id}/cancel`)).status === 409);
        const ref = '<script>alert(1)</script>a3f1c2e4b5d6978812ab34cd56ef';
        const paidR = await fin.post(`/api/admin/payouts/${po2.id}/paid`, { reference: ref, note: '=HYPERLINK("http://x")' });
        check('admin: mark paid with reference', paidR.status === 200 && paidR.data.payout.status === 'paid' && paidR.data.payout.reference === ref && paidR.data.payout.paid_at > 0);
        check('admin: paid twice refused', (await fin.post(`/api/admin/payouts/${po2.id}/paid`, { reference: 'again123' })).status === 409 && (await fin.post(`/api/admin/payouts/${po2.id}/reject`, { note: 'late' })).status === 409);
        const m4 = (await refr.get('/api/me/referrals')).data;
        check('balance after paid', m4.balance.paid === 30 && m4.balance.available === 0 && m4.balance.open === 0 && m4.payouts[0].status === 'paid' && m4.payouts[0].reference === ref);
        const qp = (await owner.get('/api/admin/emails')).data.queue.find((q) => q.template === 'payout_paid' && q.to_email === 'referrer@test.dev');
        check('payout_paid email queued', !!qp);
        const pv = sql.prepare("SELECT vars FROM email_queue WHERE template='payout_paid' ORDER BY id DESC LIMIT 1").get().vars;
        check('payout_paid email: note escaped in HTML, reference kept as text', JSON.parse(pv).note_html.includes('=HYPERLINK(&quot;') && JSON.parse(pv).reference === ref && !JSON.parse(pv).note_html.includes('<script>'));

        sql.prepare("UPDATE events SET created_at=? WHERE ext_id='rf-2'").run(ago(31)); // the pending earning settles
        const m5 = (await refr.get('/api/me/referrals')).data;
        check('ledger: settled earnings minus paid', m5.balance.settled === 42.5 && m5.balance.available === 12.5 && m5.balance.pending === 0 && m5.can_request === false && m5.to_go === 12.5, m5.balance);
        await owner.put('/api/admin/settings/referrals', { value: { tiers: [{ min: 1, rate: 10 }, { min: 3, rate: 25 }], min_withdraw: 10, settle_days: 30, terms: '' } });
        const po3 = (await refr.post('/api/me/payouts')).data.payout;
        check('payout: second request after paid', po3 && po3.amount_usd === 12.5);
        check('admin: reject needs a reason', (await fin.post(`/api/admin/payouts/${po3.id}/reject`, { note: '' })).status === 400);
        const rj = await fin.post(`/api/admin/payouts/${po3.id}/reject`, { note: 'Wallet <b>flagged</b>' });
        const m6 = (await refr.get('/api/me/referrals')).data;
        check('admin: reject returns the amount to available', rj.status === 200 && m6.balance.available === 12.5 && m6.balance.paid === 30 && m6.payouts[0].status === 'rejected' && m6.payouts[0].note === 'Wallet <b>flagged</b>');
        const rv = sql.prepare("SELECT vars FROM email_queue WHERE template='payout_rejected' ORDER BY id DESC LIMIT 1").get();
        check('payout_rejected email queued with escaped reason', rv && JSON.parse(rv.vars).note_html.includes('Wallet &lt;b&gt;flagged&lt;/b&gt;'));
        check('payout note box follows dark mode (dm-panel, dm-ink, dm-body classes)', rv && ['class="dm-panel"', 'class="dm-ink"', 'class="dm-body"'].every((c) => JSON.parse(rv.vars).note_html.includes(c)));
        const tpl = (await owner.get('/api/admin/emails')).data.templates.map((t) => t.key);
        check('payout email templates seeded', ['payout_requested', 'payout_paid', 'payout_rejected'].every((k) => tpl.includes(k)));

        const tot = (await fin.get('/api/admin/payouts?status=paid')).data;
        check('admin payouts: paid filter and totals', tot.payouts.some((p) => p.id === po2.id) && tot.payouts.every((p) => p.status === 'paid') && tot.totals.paid_usd >= 30 && tot.totals.paid_month_usd >= 30 && tot.totals.rejected >= 1 && tot.totals.cancelled >= 1);
        check('admin payouts: search by reference', (await fin.get('/api/admin/payouts?status=all&q=a3f1c2e4')).data.payouts.length === 1);
        const pcsv = await fetch(BASE + '/api/admin/payouts.csv?status=all', { headers: { cookie: fin.cookie } });
        const pbody = await pcsv.text();
        check('admin payouts CSV: attachment, formula cells neutralised, email masked', pcsv.status === 200 && /attachment; filename="voosquare-payouts-all-/.test(pcsv.headers.get('content-disposition')) && pbody.includes(`"'=HYPERLINK(""http://x"")"`) && pbody.includes('TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE') && !pbody.includes('referrer@test.dev'), pbody.slice(0, 400));
        check('admin payouts CSV: support agent 403', (await agent.get('/api/admin/payouts.csv')).status === 403);
        const cr = (await fin.get(`/api/admin/customers/${refr.user.id}/referrals`)).data;
        check('customer card: referrals and payouts for finance', cr.referred === 5 && cr.paying === 3 && cr.balance.paid === 30 && cr.history.length === 3 && cr.method.type === 'usdt_trc20');
        const au = (await owner.get('/api/admin/audit')).data.audit.map((a) => a.action);
        check('audit log: payout steps recorded', ['payout.request', 'payout.cancel', 'payout.processing', 'payout.paid', 'payout.reject', 'payout_method.save', 'payouts.export'].every((a) => au.includes(a)));
        // Regression (QA): sub-cent tool spend, next-settle grouping, refunds after a paid payout, TRC20 checksum.
        const r2 = await signup('referrer2@test.dev', 'Ref Two');
        const r2code = (await r2.get('/api/me/referrals')).data.code;
        const k2 = await signup('ref2kid@test.dev', 'Kid Two', r2code);
        const k3 = await signup('ref2kid3@test.dev', 'Kid Three', r2code);
        for (let i = 0; i < 1000; i++) ev.run(jv.id, k2.user.id, 'sub-' + i, 0.004, ago(40));
        const s1 = (await r2.get('/api/me/referrals')).data;
        check('ledger: 1,000 sub-cent tool payments add up exactly ($4 spend, $0.40 at 10%)', s1.spend_usd === 4 && s1.balance.lifetime === 0.4 && s1.balance.available === 0.4, s1.balance);
        const t5 = ago(5);
        ev.run(jv.id, k3.user.id, 'ns-1', 100, t5); ev.run(jv.id, k3.user.id, 'ns-2', 100, t5 + 1000);
        const s2 = (await r2.get('/api/me/referrals')).data;
        check('ledger: next settle sums everything settling that day', s2.next_settle && s2.next_settle.amount === 20 && s2.balance.pending === 20, s2.next_settle);
        check('payout method: TRC20 checksum catches a typo', (await r2.put('/api/me/payout-method', { type: 'usdt_trc20', address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSF' })).status === 400);
        await r2.put('/api/me/payout-method', { type: 'usdt_trc20', address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' });
        od.run('RFO-9', k3.user.id, 1000, 1000, 'paid', ago(41), ago(40));
        const rp = (await r2.post('/api/me/payouts')).data.payout;
        check('payout: exact amount with sub-cent earnings', rp && rp.amount_usd === 100.4, rp);
        await fin.post(`/api/admin/payouts/${rp.id}/paid`, { reference: 'ref-r2-0001' });
        sql.prepare("UPDATE orders SET status='refunded' WHERE ref='RFO-9'").run();
        const s3 = (await r2.get('/api/me/referrals')).data;
        check('refund after a paid payout: available stays 0, owed shown, to_go includes it, no new request', s3.balance.available === 0 && s3.balance.owed === 100 && s3.balance.paid === 100.4 && s3.to_go === 110 && s3.can_request === false, s3);
        check('refund after a paid payout: request refused', (await r2.post('/api/me/payouts')).status === 400);
        check('admin summary shows the owed amount', (await fin.get(`/api/admin/customers/${r2.user.id}/referrals`)).data.balance.owed === 100);
        check('settings GET returns the default terms for the editor', (await owner.get('/api/admin/settings/referrals')).data.value.default_terms.length > 40);
        await owner.put('/api/admin/settings/referrals', { value: { tiers: [{ min: 1, rate: 10 }, { min: 5, rate: 20 }, { min: 20, rate: 30 }], min_withdraw: 300, settle_days: 30, terms: '' } });

        // Banned referred members: their spend stops counting (pending and settled), paid money shows as owed, unban restores.
        await owner.put('/api/admin/settings/referrals', { value: { tiers: [{ min: 1, rate: 10 }], min_withdraw: 10, settle_days: 30, terms: '' } });
        const r3 = await signup('referrer3@test.dev', 'Ref Three');
        const r3code = (await r3.get('/api/me/referrals')).data.code;
        const kA = await signup('ref3a@test.dev', 'Kid A', r3code);
        const kB = await signup('ref3b@test.dev', 'Kid B', r3code);
        ev.run(jv.id, kA.user.id, 'bn-a', 100, ago(40)); ev.run(jv.id, kB.user.id, 'bn-b', 200, ago(40)); ev.run(jv.id, kB.user.id, 'bn-b2', 50, ago(2));
        const b0 = (await r3.get('/api/me/referrals')).data;
        check('banned referrals: before the ban everything counts', b0.balance.available === 30 && b0.balance.pending === 5 && b0.paying === 2, b0.balance);
        await owner.patch(`/api/admin/customers/${kB.user.id}`, { banned: true });
        const b1 = (await r3.get('/api/me/referrals')).data;
        check('banned referrals: spend excluded from available and pending, not a paying referral', b1.balance.available === 10 && b1.balance.pending === 0 && b1.paying === 1 && b1.people.find((x) => x.name === 'Kid B').excluded === true, b1.balance);
        const bs = (await fin.get(`/api/admin/customers/${r3.user.id}/referrals`)).data;
        check('banned referrals: customer card lists them as excluded (banned)', bs.excluded.length === 1 && bs.excluded[0].id === kB.user.id && bs.excluded[0].reason === 'banned' && bs.excluded[0].spend_usd === 250, bs.excluded);
        await owner.patch(`/api/admin/customers/${kB.user.id}`, { banned: false });
        await r3.put('/api/me/payout-method', { type: 'usdt_trc20', address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' });
        const p3 = (await r3.post('/api/me/payouts')).data.payout;
        await fin.post(`/api/admin/payouts/${p3.id}/paid`, { reference: 'ref-r3-0001' });
        await owner.patch(`/api/admin/customers/${kB.user.id}`, { banned: true });
        const b2 = (await r3.get('/api/me/referrals')).data;
        check('banned referrals: already paid becomes owed', b2.balance.available === 0 && b2.balance.owed === 20 && b2.can_request === false, b2.balance);
        await owner.patch(`/api/admin/customers/${kB.user.id}`, { banned: false });
        const b3 = (await r3.get('/api/me/referrals')).data;
        check('banned referrals: unbanning restores the earnings', b3.balance.owed === 0 && b3.balance.settled === 30 && b3.balance.pending === 5 && b3.paying === 2 && !b3.people.some((x) => x.excluded), b3.balance);
        const er = await owner.post(`/api/admin/customers/${kB.user.id}/erase`, { confirm: 'ERASE', email: 'ref3b@test.dev' });
        const bs2 = (await fin.get(`/api/admin/customers/${r3.user.id}/referrals`)).data;
        check('erased referrals: excluded too, labelled erased', er.status === 200 && bs2.excluded.length === 1 && bs2.excluded[0].reason === 'erased' && bs2.balance.settled === 10, [er.status, bs2.excluded]);
        check('payout terms mention banned accounts', /banned/.test((await owner.get('/api/admin/settings/referrals')).data.value.default_terms));

        // Four eyes: nobody marks their own payout, owners included.
        const finCode = (await fin.get('/api/me/referrals')).data.code;
        const fk = await signup('finkid@test.dev', 'Fin Kid', finCode);
        ev.run(jv.id, fk.user.id, 'fe-1', 300, ago(40));
        await fin.put('/api/me/payout-method', { type: 'usdt_trc20', address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' });
        const fp = (await fin.post('/api/me/payouts')).data.payout;
        const selfP = await fin.post(`/api/admin/payouts/${fp.id}/processing`);
        check('four eyes: finance cannot mark their own payout sending, paid or not sent', selfP.status === 403 && /own payout/.test(selfP.data.error) && (await fin.post(`/api/admin/payouts/${fp.id}/paid`, { reference: 'self-ref-001' })).status === 403 && (await fin.post(`/api/admin/payouts/${fp.id}/reject`, { note: 'nope' })).status === 403);
        check('four eyes: another payments member can', (await owner.post(`/api/admin/payouts/${fp.id}/paid`, { reference: 'owner-ref-001' })).status === 200);
        const ownerCode = (await owner.get('/api/me/referrals')).data.code;
        const ok1 = await signup('ownerkid@test.dev', 'Owner Kid', ownerCode);
        ev.run(jv.id, ok1.user.id, 'fe-2', 300, ago(40));
        await owner.put('/api/me/payout-method', { type: 'usdt_trc20', address: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' });
        const op = (await owner.post('/api/me/payouts')).data.payout;
        check('four eyes: the owner cannot mark their own payout either', (await owner.post(`/api/admin/payouts/${op.id}/paid`, { reference: 'self-ref-002' })).status === 403 && (await fin.post(`/api/admin/payouts/${op.id}/paid`, { reference: 'fin-ref-002' })).status === 200);
        await owner.put('/api/admin/settings/referrals', { value: { tiers: [{ min: 1, rate: 10 }, { min: 5, rate: 20 }, { min: 20, rate: 30 }], min_withdraw: 300, settle_days: 30, terms: '' } });

        // Events API: settling runs from when VooSquare received the event, so a backdated occurred_at cannot skip it.
        const r4 = await signup('referrer4@test.dev', 'Ref Four');
        const k4 = await signup('ref4kid@test.dev', 'Kid Four', (await r4.get('/api/me/referrals')).data.code);
        const jkey2 = (await owner.get(`/api/admin/products/${jv.id}`)).data.product.api_key;
        await fetch(BASE + '/api/v1/events', { method: 'POST', headers: { authorization: 'Bearer ' + jkey2, 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ event_id: 'bd-1', voo_id: k4.user.voo_id, type: 'spend', value_usd: 100, occurred_at: new Date(ago(60)).toISOString() }] }) });
        const s4 = (await r4.get('/api/me/referrals')).data;
        check('settling: a backdated spend event still waits the full period from receipt', s4.balance.pending === 10 && s4.balance.settled === 0 && s4.next_settle && s4.next_settle.at > Date.now() + 29 * DAY, s4.balance);
      }
      sql.close();
    }
    // Affiliate program (src/aff): its own server, database and mock providers (test/affiliates.js).
    await require('./affiliates')({ check });
    // Money audit regressions MN-1..MN-11: rates, deal windows, qualification, contests, statements and dates on the payment date (test/money-fixes.js).
    await require('./money-fixes')({ check });
    // Affiliate links end to end: every link type → landing → root-domain cookie → sign-up (site, affiliate host, tool OAuth) → orders and spend → commission and postbacks (test/aff-links.js).
    await require('./aff-links')({ check });
    // Voo Connect (sdk/voo-connect): the sister-tool kit end to end against VooSquare plus the example tool, and check.js (test/voo-connect.js).
    await require('./voo-connect')({ check });
    // Session cookie name: __Host-vs_sess over https (a planted vs_sess is ignored and cleared), vs_sess over http; coupon cookie cleared at sign-up (test/session-cookie.js).
    await require('./session-cookie')({ BASE, check });
    // VooSquare Academy: loader, pacing, grading, exams, certificates and admin (test/school.js).
    await require('./school')({ BASE, Client, check, owner, DB });
    // Teaching voice: providers (mock), generation queue, caching, retries, clip access, Range, admin edits (test/voice.js).
    await require('./voice')({ BASE, Client, check, owner, DB, VOICE, VOICE_MOCK_PORT });
    // Included voice: voice packs (.tar upload, safety, linking), what members get, intro music (test/voice-pack.js).
    await require('./voice-pack')({ BASE, Client, check, owner, VOICE });
    // Admin run-the-place: feature switches, maintenance, paused sign-ups, backups, erase, What's new (test/admin-features.js).
    await require('./admin-features')({ BASE, Client, check, owner, DB, BACKUPS });
    // Affiliate front end: shell, files, CSP-safety and menus (test/aff-frontend.js). Runs last: it only reads.
    await require('./aff-frontend')({ BASE, Client, check, owner });
    // Platform QA regressions: events never dropped silently, wildcard redirects, summary SSRF guard, refunds stay refunded (test/platform-qa.js).
    await require('./platform-qa')({ BASE, Client, check, owner });
    // UX fixes from the independent QA: Telegram prefill, terms, /privacy and /terms, unpaid orders, codes, recycle bin (test/ux-fixes.js).
    await require('./ux-fixes')({ BASE, Client, check, owner, DB });
    // Delete my account (App Store 5.1.1(v), Google Play) and the phone app's user agent (test/account-delete.js).
    await require('./account-delete')({ BASE, Client, check, owner, DB });
    // Community safety for the app stores: report a message, block a member, Admin → Community → Reports, the App review sign-in (test/ugc-safety.js).
    await require('./ugc-safety')({ BASE, Client, check, owner, DB });
    // Production safety: migrations (old and fresh databases, failures, rollbacks), copies before updates, grandfathered
    // prices, school progress, recycle bin, rollout flags and the frozen /api/v1 shapes (test/safety.js).
    await require('./safety')({ BASE, Client, check, owner, DB, BACKUPS, SCHOOL_EXTRA, PORT });
    // VooSquare Academy content made in the admin: create, validate, permissions, members finishing it, reload and boot keep it, delete vs unpublish (test/school-admin.js).
    await require('./school-admin')({ BASE, Client, check, owner, DB, SCHOOL_EXTRA, PORT });
    // Security fixes (CA, PT, IN findings): their own servers on ports 4801-4809 and databases under the temp folder (test/security-fixes.js).
    await require('./security-fixes')({ check });
    // VooSquare Academy's own website: host routing, public catalog and previews, the one-tap switch, the name (test/academy.js).
    await require('./academy')({ check });
  } catch (e) {
    failed++;
    console.error('Test crashed:', e);
  } finally {
    srv.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 300));
    for (const f of [DB, DB + '-wal', DB + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    try { fs.rmSync(UPLOADS, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(BACKUPS, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(SCHOOL_EXTRA, { recursive: true, force: true }); } catch { /* ignore */ }
    try { fs.rmSync(VOICE, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  if (/Error|error:/.test(log) && failed) console.log('\nServer log:\n' + log.slice(-3000));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main();
