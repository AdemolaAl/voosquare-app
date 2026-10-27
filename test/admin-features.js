'use strict';
/* Admin run-the-place checks: feature switches, maintenance mode, paused sign-ups, backups, erase personal data,
 * deactivate, What's new, Today and quick search. Called from test/smoke.js with its helpers. */
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function adminFeatures({ BASE, Client, check, owner, DB, BACKUPS }) {
  const { DatabaseSync } = require('node:sqlite');
  // Each sign-in comes from its own address so the per-IP code limit never trips across the whole smoke run.
  const xf = () => ({ 'x-forwarded-for': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (c, email, name) => { const s = await c.post('/api/auth/start', { email, name }, xf()); return c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf()); };
  console.log('Admin: feature switches');
  const setF = (patch) => owner.put('/api/admin/features', patch);
  const allOn = { community: true, academy: true, blog: true, tools: true, referrals: true, premium: true, paid_rooms: true, support: true, spotlight: true, announcements: true, images: true, signups_paused: false, maintenance: false, signups_message: '', maintenance_message: '' };

  const mem = new Client(); await login(mem, 'feat-member@test.dev', 'Fela Member');
  const memId = (await mem.get('/api/me')).data.user.id;
  const agent = new Client(); await login(agent, 'feat-agent@test.dev', 'Agent Ade');
  await owner.post('/api/admin/team', { email: 'feat-agent@test.dev', perms: ['support', 'customers'], support_scope: ['*'] });
  const editor = new Client(); await login(editor, 'feat-editor@test.dev', 'Edi Content');
  await owner.post('/api/admin/team', { email: 'feat-editor@test.dev', perms: ['content'] });

  const f0 = await owner.get('/api/admin/features');
  check('features: defaults are all on, maintenance and paused sign-ups off', f0.status === 200 && Object.keys(allOn).filter((k) => typeof allOn[k] === 'boolean' && k !== 'signups_paused' && k !== 'maintenance').every((k) => f0.data.features[k] === true) && !f0.data.features.maintenance && !f0.data.features.signups_paused && f0.data.defaults.maintenance_message.length > 20, f0.data);
  check('features: settings permission needed (agent 403, member 403)', (await agent.get('/api/admin/features')).status === 403 && (await mem.put('/api/admin/features', { academy: false })).status === 403);
  const site0 = (await new Client().get('/api/site')).data;
  check('features: public site payload carries the switches', site0.features && site0.features.academy === true && site0.features.maintenance === false && typeof site0.features.maintenance_message === 'string');
  check('features: /api/me carries the switches', (await mem.get('/api/me')).data.features.community === true);

  // Seed what the switches hide: an announcement line, a course lesson, a paid room.
  const annBefore = (await owner.get('/api/admin/settings/announcements')).data.value || [];
  await owner.put('/api/admin/settings/announcements', { value: [{ id: 'fa1', enabled: true, text: 'Live session Friday', link_text: '', url: '' }] });
  const rooms0 = (await mem.get('/api/rooms')).data.rooms;
  const general = rooms0.find((r) => r.slug === 'general');
  const paidRoom = rooms0.find((r) => r.access === 'paid' && !r.unlocked);
  const course = (await mem.get('/api/courses')).data.courses.find((c) => !c.premium);
  const lesson = (await mem.get('/api/courses/' + course.slug)).data.lessons[0];

  const off = async (k) => { const r = await setF({ ...allOn, [k]: false }); return r.status === 200 && r.data.features[k] === false; };
  const is403 = (r, k) => r.status === 403 && r.data && r.data.off === k && /turned off/i.test(r.data.error);

  check('community off: switch saved', await off('community'));
  check('community off: rooms, messages and profiles 403', is403(await mem.get('/api/rooms'), 'community') && is403(await mem.get(`/api/rooms/${general.id}/messages`), 'community') && is403(await mem.post(`/api/rooms/${general.id}/messages`, { body: 'hi' }), 'community') && is403(await mem.get('/api/members/' + memId), 'community'));
  check('community off: site and home have no rooms', (await new Client().get('/api/site')).data.rooms.length === 0 && (await mem.get('/api/me/home')).data.rooms.length === 0);
  check('community off: admin still manages rooms', (await owner.get('/api/admin/rooms')).status === 200);

  check('academy off: courses, course and lesson complete 403', await off('academy') && is403(await mem.get('/api/courses'), 'academy') && is403(await mem.get('/api/courses/' + course.slug), 'academy') && is403(await mem.post(`/api/lessons/${lesson.id}/complete`), 'academy'));
  check('academy off: site and home have no courses', (await new Client().get('/api/site')).data.courses.length === 0 && (await mem.get('/api/me/home')).data.courses.length === 0);

  check('blog off: posts 403, site has none', await off('blog') && is403(await mem.get('/api/posts'), 'blog') && (await new Client().get('/api/site')).data.posts.length === 0 && (await mem.get('/api/me/home')).data.updates.length === 0);
  check('free tools off: tools 403, no tools on home', await off('tools') && is403(await mem.get('/api/tools'), 'tools') && is403(await mem.get('/api/tools/saves'), 'tools') && (await mem.get('/api/me/home')).data.calc_tools.length === 0);
  check('referrals off: referrals and payouts 403', await off('referrals') && is403(await mem.get('/api/me/referrals'), 'referrals') && is403(await mem.post('/api/me/payouts'), 'referrals'));
  check('support off: member inbox and website widget 403', await off('support') && is403(await mem.get('/api/support/tickets'), 'support') && is403(await mem.post('/api/support/tickets', { body: 'help' }), 'support') && is403(await new Client().get('/api/widget/voosquare/config'), 'support'));
  check('support off: team inbox still works', (await owner.get('/api/admin/tickets')).status === 200);
  check('premium off: Premium checkout 403', await off('premium') && is403(await mem.post('/api/billing/checkout', { item: 'premium', method_id: 1 }), 'premium'));
  {
    await off('paid_rooms');
    const rs = (await mem.get('/api/rooms')).data.rooms;
    check('paid rooms off: checkout and apply 403, paid rooms hidden from outsiders', is403(await mem.post('/api/billing/checkout', { item: 'room', room_id: paidRoom ? paidRoom.id : 1, method_id: 1 }), 'paid_rooms') && !rs.some((r) => r.access === 'paid' && !r.unlocked) && rs.some((r) => r.access === 'free') && is403(await mem.post(`/api/rooms/${paidRoom ? paidRoom.id : 1}/apply`, { answers: [] }), 'paid_rooms'));
    check('paid rooms off: hidden from the public site too', !(await new Client().get('/api/site')).data.rooms.some((r) => r.access === 'paid'));
  }
  check('spotlight off: no slides on site, home, community or academy', await off('spotlight') && (await new Client().get('/api/site')).data.ads.length === 0 && (await mem.get('/api/me/home')).data.ads.length === 0 && (await mem.get('/api/rooms')).data.ads.length === 0 && (await mem.get('/api/courses')).data.ads.length === 0);
  check('announcement bar off: no lines on site or home', await off('announcements') && (await new Client().get('/api/site')).data.announcements.length === 0 && (await mem.get('/api/me/home')).data.announcements.length === 0);
  {
    await off('images');
    const png = Buffer.alloc(233); Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(png, 0); png.writeUInt32BE(13, 8); png.write('IHDR', 12, 'ascii'); png.writeUInt32BE(40, 16); png.writeUInt32BE(40, 20);
    const up = (c) => fetch(`${BASE}/api/uploads?purpose=chat`, { method: 'POST', headers: { 'x-vs': '1', cookie: c.cookie, 'content-type': 'image/png', 'x-thumb-bytes': '0' }, body: png });
    const mu = await up(mem); const mj = await mu.json();
    const ou = await up(owner);
    const rs = (await mem.get('/api/rooms')).data.rooms;
    check('images off: members cannot upload or post images, the team can', mu.status === 403 && mj.off === 'images' && ou.status === 200 && rs.every((r) => r.can_image === false) && (await mem.post(`/api/rooms/${general.id}/messages`, { body: 'x', upload_id: 'abc' })).status === 403);
  }
  {
    const r = await setF(allOn);
    const site = (await new Client().get('/api/site')).data;
    const rs = (await mem.get('/api/rooms')).data.rooms;
    check('all back on: everything returns as it was', r.status === 200 && rs.length === rooms0.length && site.courses.length > 0 && site.posts.length > 0 && site.ads.length > 0 && site.announcements.length === 1 && (await mem.get('/api/courses')).status === 200 && (await mem.get('/api/me/referrals')).status === 200 && (await mem.get('/api/support/tickets')).status === 200, { rooms: rs.length, was: rooms0.length });
  }
  const au1 = (await owner.get('/api/admin/audit')).data.audit;
  check('features: changes are in the audit log', au1.some((a) => a.action === 'settings.features' && /academy=off/.test(a.detail)));

  console.log('Admin: maintenance mode and paused sign-ups');
  await setF({ ...allOn, maintenance: true, maintenance_message: 'Upgrading the rooms. Back by 6pm.' });
  {
    const h = await mem.get('/api/me/home');
    check('maintenance: member APIs answer 503 with the message', h.status === 503 && h.data.maintenance === true && h.data.error === 'Upgrading the rooms. Back by 6pm.' && (await mem.get('/api/rooms')).status === 503 && (await mem.patch('/api/me', { bio: 'x' })).status === 503);
    const me = await mem.get('/api/me');
    check('maintenance: /api/me and /api/site still answer so the page can say "back soon"', me.status === 200 && me.data.features.maintenance === true && (await new Client().get('/api/site')).data.features.maintenance === true);
    check('maintenance: staff still get in', (await owner.get('/api/me/home')).status === 200 && (await owner.get('/api/rooms')).status === 200 && (await agent.get('/api/me/home')).status === 200);
    const lg = await new Client().post('/api/auth/start', { email: 'feat-member@test.dev' }, xf());
    check('maintenance: sign-in still works (staff need it)', lg.status === 200);
    check('maintenance: widget hidden for visitors', (await new Client().get('/api/widget/voosquare/config')).status === 503);
    check('maintenance: Today shows it to settings staff', (await owner.get('/api/admin/today')).data.items.some((i) => i.key === 'maintenance'));
  }
  await setF({ ...allOn, signups_paused: true, signups_message: 'Doors open again on Monday.' });
  {
    const n = await new Client().post('/api/auth/start', { email: 'brand-new@test.dev', name: 'New Person' }, xf());
    check('sign-ups paused: a new email gets the message, no code', n.status === 403 && n.data.signups_paused === true && n.data.error === 'Doors open again on Monday.' && !n.data.dev_code);
    const ex = await new Client().post('/api/auth/start', { email: 'feat-member@test.dev' }, xf());
    check('sign-ups paused: existing members still get a code', ex.status === 200 && !!ex.data.dev_code);
    const sql = new DatabaseSync(DB);
    check('sign-ups paused: no account was created', !sql.prepare("SELECT 1 FROM users WHERE email='brand-new@test.dev'").get());
    sql.close();
  }
  await setF(allOn);
  check('sign-ups open again: new email gets a code', (await new Client().post('/api/auth/start', { email: 'brand-new@test.dev' }, xf())).status === 200);

  console.log('Admin: backups');
  {
    check('backups: members and non-owner staff get 403', (await mem.get('/api/admin/backups')).status === 403 && (await agent.get('/api/admin/backups')).status === 403 && (await agent.get('/api/admin/backups/download')).status === 403);
    // The daily copy runs shortly after boot (BACKUPS_DIR is set for the test server).
    let list;
    for (let i = 0; i < 40; i++) { list = (await owner.get('/api/admin/backups')).data; if (list.backups.some((b) => b.kind === 'auto')) break; await new Promise((r) => setTimeout(r, 150)); }
    check('backups: the daily copy was made after boot, with sizes', list.backups.some((b) => b.kind === 'auto' && b.bytes > 10_000) && list.settings.auto === true && list.settings.keep === 7 && list.db_bytes > 0 && list.dir === BACKUPS, list);
    const res = await fetch(BASE + '/api/admin/backups/download', { headers: { cookie: owner.cookie } });
    const buf = Buffer.from(await res.arrayBuffer());
    check('backups: download is a valid SQLite file, as an attachment, not cached', res.status === 200 && buf.subarray(0, 16).toString('latin1') === 'SQLite format 3\u0000' && /attachment; filename="voosquare-\d{4}-\d{2}-\d{2}-\d{4}\.db"/.test(res.headers.get('content-disposition')) && res.headers.get('cache-control') === 'no-store', { status: res.status, cd: res.headers.get('content-disposition') });
    {
      const { DatabaseSync: DS } = require('node:sqlite');
      const tmp = path.join(BACKUPS, 'check.sqlite');
      fs.writeFileSync(tmp, buf);
      const b = new DS(tmp, { readOnly: true });
      const n = b.prepare('SELECT COUNT(*) n FROM users').get().n;
      b.close(); fs.unlinkSync(tmp);
      check('backups: the copy opens and holds the members', n >= 3);
    }
    await new Promise((r) => setTimeout(r, 150));
    check('backups: the temporary copy is deleted after sending', !fs.readdirSync(BACKUPS).some((n) => n.startsWith('.tmp-')));
    const s = await owner.put('/api/admin/backups/settings', { auto: true, keep: 3 });
    check('backups: keep setting saved (1 to 30)', s.status === 200 && s.data.settings.keep === 3);
    for (let i = 0; i < 4; i++) await owner.post('/api/admin/backups/run');
    const l2 = (await owner.get('/api/admin/backups')).data.backups;
    check('backups: rotation keeps the newest 3', l2.length === 3 && l2.every((b) => b.kind === 'manual') && fs.readdirSync(BACKUPS).filter((n) => n.endsWith('.db')).length === 3, l2.map((b) => b.name));
    const one = await fetch(BASE + '/api/admin/backups/file/' + encodeURIComponent(l2[0].name), { headers: { cookie: owner.cookie } });
    const ob = Buffer.from(await one.arrayBuffer());
    check('backups: a stored copy downloads', one.status === 200 && ob.subarray(0, 15).toString() === 'SQLite format 3');
    check('backups: unknown or unsafe names are refused', (await owner.get('/api/admin/backups/file/..%2Fvoosquare.db')).status === 404 && (await owner.get('/api/admin/backups/file/nope.db')).status === 404);
    const au = (await owner.get('/api/admin/audit')).data.audit.map((a) => a.action);
    // The daily copy is logged at boot, so it can sit beyond the newest 200 rows the audit page shows: look it up directly.
    const autoLogged = (() => { const s = new DatabaseSync(DB); const r = s.prepare("SELECT 1 FROM audit WHERE action='backup.auto'").get(); s.close(); return !!r; })();
    check('backups: audit log has download, run, settings and the daily copy', ['backup.download', 'backup.run', 'backup.settings'].every((a) => au.includes(a)) && autoLogged, au.slice(0, 20));
    let limited = false;
    for (let i = 0; i < 8 && !limited; i++) limited = (await owner.get('/api/admin/backups/download')).status === 429;
    check('backups: downloads are rate limited', limited);
    await owner.put('/api/admin/backups/settings', { auto: true, keep: 7 });
    check('Today: backups status for the owner', (await owner.get('/api/admin/today')).data.items.some((i) => i.key === 'backups' && i.title === 'Backups are running'));
  }

  console.log('Admin: customers (deactivate, erase)');
  {
    const msg = await mem.post(`/api/rooms/${general.id}/messages`, { body: 'Message from Fela' });
    const other = new Client(); await login(other, 'feat-other@test.dev', 'Ola Other');
    check('deactivate: hides a member from the community', (await owner.post(`/api/admin/customers/${memId}/deactivate`, { deactivated: true })).data.deactivated === true);
    const list = (await other.get(`/api/rooms/${general.id}/messages`)).data.messages;
    check('deactivate: their messages and profile are hidden, they cannot post', !list.some((m) => m.id === msg.data.message.id) && (await other.get('/api/members/' + memId)).status === 404 && (await mem.post(`/api/rooms/${general.id}/messages`, { body: 'still here?' })).status === 403);
    check('deactivate: shows on the customer record', (await owner.get('/api/admin/customers/' + memId)).data.customer.deactivated === true);
    await owner.post(`/api/admin/customers/${memId}/deactivate`, { deactivated: false });
    check('reactivate: messages come back', (await other.get(`/api/rooms/${general.id}/messages`)).data.messages.some((m) => m.id === msg.data.message.id) && (await other.get('/api/members/' + memId)).status === 200);
    check('deactivate: content editors cannot', (await editor.post(`/api/admin/customers/${memId}/deactivate`, {})).status === 403);

    const erin = new Client(); await login(erin, 'erin-erase@test.dev', 'Erin Erase');
    const erinId = (await erin.get('/api/me')).data.user.id;
    const sql = new DatabaseSync(DB);
    sql.prepare("INSERT INTO orders(ref,user_id,item_type,item_name,amount_usd,currency,amount,status,created_at,paid_at) VALUES('ER-1',?,'premium','VooSquare Premium',20,'USD',20,'paid',?,?)").run(erinId, Date.now(), Date.now());
    sql.prepare("INSERT INTO payout_methods(user_id,type,details,updated_at) VALUES(?,'bank','{\"account\":\"0123456789\"}',?)").run(erinId, Date.now());
    sql.close();
    check('erase: only an owner (agent 403)', (await agent.post(`/api/admin/customers/${erinId}/erase`, { confirm: 'ERASE', email: 'erin-erase@test.dev' })).status === 403);
    check('erase: needs ERASE and the exact email', (await owner.post(`/api/admin/customers/${erinId}/erase`, { confirm: 'ERASE', email: 'wrong@test.dev' })).status === 400 && (await owner.post(`/api/admin/customers/${erinId}/erase`, { confirm: 'yes', email: 'erin-erase@test.dev' })).status === 400);
    check('erase: staff must leave the team first', (await owner.post(`/api/admin/customers/${(await agent.get('/api/me')).data.user.id}/erase`, { confirm: 'ERASE', email: 'feat-agent@test.dev' })).status === 400);
    const er = await owner.post(`/api/admin/customers/${erinId}/erase`, { confirm: 'ERASE', email: 'erin-erase@test.dev' });
    const c = (await owner.get('/api/admin/customers/' + erinId)).data;
    const db = new DatabaseSync(DB);
    const row = db.prepare('SELECT * FROM users WHERE id=?').get(erinId);
    const orders = db.prepare('SELECT COUNT(*) n FROM orders WHERE user_id=?').get(erinId).n;
    const pm = db.prepare('SELECT COUNT(*) n FROM payout_methods WHERE user_id=?').get(erinId).n;
    db.close();
    check('erase: name, email, handle and avatar anonymised; orders kept; payout details gone', er.status === 200 && c.customer.erased === true && row.name === 'Erased member' && row.email === `erased-${erinId}@erased.invalid` && row.avatar === '{}' && row.bio === '' && orders === 1 && pm === 0 && c.orders.length === 1, row);
    check('erase: signed out for good', (await erin.get('/api/me')).data.user === null);
    check('erase: second erase refused, audit logged', (await owner.post(`/api/admin/customers/${erinId}/erase`, { confirm: 'ERASE', email: `erased-${erinId}@erased.invalid` })).status === 400 && (await owner.get('/api/admin/audit')).data.audit.some((a) => a.action === 'customer.erase'));
    check('members are never hard-deleted: no delete route', (await owner.del('/api/admin/customers/' + memId)).status === 404 || (await owner.del('/api/admin/customers/' + memId)).status === 405);
  }

  console.log("Admin: What's new");
  {
    check("what's new: content permission needed", (await mem.post('/api/admin/whats-new', { title: 'x' })).status === 403 && (await agent.get('/api/admin/whats-new')).status === 403);
    check("what's new: title required, unsafe links dropped", (await editor.post('/api/admin/whats-new', { title: '' })).status === 400);
    const p = await editor.post('/api/admin/whats-new', { title: 'Saved scenarios', body: 'Save a calculator scenario and come back to it.', link_url: 'javascript:alert(1)', link_text: 'Try it' });
    check("what's new: posted", p.status === 200 && p.data.note.link_url === '' && p.data.note.published === 1);
    const p2 = await editor.post('/api/admin/whats-new', { id: p.data.note.id, title: 'Saved scenarios', body: 'Save a calculator scenario and come back to it.', link_url: '/app#tools', link_text: 'Try it' });
    const h = (await mem.get('/api/me/home')).data.whats_new;
    check("what's new: shows on member Home", p2.status === 200 && h && h.title === 'Saved scenarios' && h.link_url === '/app#tools');
    const late = new Client(); await login(late, 'feat-late@test.dev', 'Late Joiner');
    check("what's new: people who join later do not get old news", (await late.get('/api/me/home')).data.whats_new === null);
    await mem.post(`/api/me/whats-new/${h.id}/seen`);
    check("what's new: shows once (gone after Got it)", (await mem.get('/api/me/home')).data.whats_new === null);
    const other = new Client(); await login(other, 'feat-other@test.dev');
    check("what's new: still shows for others", (await other.get('/api/me/home')).data.whats_new.id === h.id);
    await editor.post('/api/admin/whats-new', { ...p2.data.note, published: false });
    check("what's new: turning a note off hides it", (await other.get('/api/me/home')).data.whats_new === null);
    const lst = (await editor.get('/api/admin/whats-new')).data;
    check("what's new: admin list with seen counts", lst.notes[0].id === h.id && lst.notes[0].seen === 1);
    check("what's new: delete", (await editor.del('/api/admin/whats-new/' + h.id)).status === 200 && (await editor.get('/api/admin/whats-new')).data.notes.length === 0);
  }

  console.log('Admin: Today, quick search, product undo');
  {
    const t = (await owner.get('/api/admin/today')).data.items.map((i) => i.key);
    const ta = (await agent.get('/api/admin/today')).data.items.map((i) => i.key);
    check('Today: owner sees inbox, email and backups; an agent only the inbox', t.includes('tickets') && t.includes('email') && t.includes('backups') && ta.includes('tickets') && !ta.includes('backups') && !ta.includes('email'));
    check('Today: members get 403', (await mem.get('/api/admin/today')).status === 403);
    const s = (await owner.get('/api/admin/search?q=fela')).data;
    const sp = (await owner.get('/api/admin/search?q=spy')).data;
    check('quick search: members and products', s.members.some((m) => m.email === 'feat-member@test.dev') && sp.products.some((p) => p.slug === 'spyvoo'));
    check('quick search: only what the person can open (editor sees no members)', (await editor.get('/api/admin/search?q=fela')).data.members.length === 0 && (await owner.get('/api/admin/search?q=f')).data.members.length === 0);
    const prods = (await owner.get('/api/admin/products')).data.products;
    const spy = prods.find((p) => p.slug === 'spyvoo');
    await owner.del('/api/admin/products/' + spy.id);
    const hidden = !(await new Client().get('/api/site')).data.products.some((p) => p.slug === 'spyvoo');
    const sh = await owner.post(`/api/admin/products/${spy.id}/show`);
    check('products: Undo after hide shows the product again', hidden && sh.status === 200 && (await new Client().get('/api/site')).data.products.some((p) => p.slug === 'spyvoo'));
  }
  await owner.put('/api/admin/settings/announcements', { value: annBefore });
};
