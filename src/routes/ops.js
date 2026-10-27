'use strict';
/* Admin helpers that make the panel easier to run: the "Today" list on the overview and the quick search (Ctrl/Cmd + K).
 * Feature switches and What's new: src/features.js. Backups: src/backups.js. */
const D = require('../db');
const A = require('../auth');
const mailer = require('../mailer');
const F = require('../features');
const B = require('../backups');
const { now, clean, json, fail, publish } = require('../util');

function supportScope(u) {
  if (u.perms.includes('*') || (u.support_scope || []).includes('*')) return { sql: '1=1', args: [] };
  const s = (u.support_scope || []).map(Number).filter(Boolean);
  return s.length ? { sql: `product_id IN (${s.map(() => '?').join(',')})`, args: s } : { sql: '1=0', args: [] };
}

module.exports = function routes(r) {
  /* What needs attention right now, for this person's permissions. Each item has one action. */
  r.get('/api/admin/today', (ctx) => {
    const me = A.requireStaff(ctx);
    const items = [];
    const add = (o) => items.push(o);
    if (A.can(me, 'support')) {
      const sc = supportScope(me);
      const n = D.get(`SELECT COUNT(*) n FROM tickets WHERE status='open' AND ${sc.sql}`, ...sc.args).n;
      add({ key: 'tickets', n, icon: 'inbox', title: n ? `${n} open ${n === 1 ? 'conversation' : 'conversations'}` : 'Inbox is clear', text: n ? 'Members are waiting for a reply.' : 'No one is waiting for a reply.', href: '#support', action: n ? 'Reply' : 'Open inbox', tone: n ? 'act' : 'ok' });
    }
    if (A.can(me, 'community')) {
      const n = D.get("SELECT COUNT(*) n FROM room_applications WHERE status='pending'").n;
      if (n) add({ key: 'applications', n, icon: 'star', title: `${n} room ${n === 1 ? 'application' : 'applications'}`, text: 'Members asked to join an invite-only room.', href: '#community/applications', action: 'Review', tone: 'act' });
    }
    if (A.can(me, 'payments')) {
      const p = D.get("SELECT COUNT(*) n FROM payouts WHERE status='requested'").n;
      if (p) add({ key: 'payouts', n: p, icon: 'wallet', title: `${p} payout ${p === 1 ? 'request' : 'requests'}`, text: 'Referral earnings to send from the Zedapex wallet or bank.', href: '#payouts', action: 'Send', tone: 'act' });
      const o = D.get("SELECT COUNT(*) n FROM orders WHERE status='review'").n;
      if (o) add({ key: 'orders', n: o, icon: 'card', title: `${o} ${o === 1 ? 'order' : 'orders'} to approve`, text: 'Members sent a payment proof.', href: '#payments?status=review', action: 'Check', tone: 'act' });
    }
    if (A.can(me, 'settings')) {
      if (!mailer.configured()) add({ key: 'email', n: 1, icon: 'mail', title: 'Email is not set up', text: 'Login codes and receipts print to the server log instead of reaching people.', href: '#settings', action: 'Set up', tone: 'warn' });
      const f = F.get();
      if (f.maintenance) add({ key: 'maintenance', n: 1, icon: 'lock', title: 'Maintenance mode is on', text: 'Members see the "back soon" page. The team can still get in.', href: '#settings/features', action: 'Turn off', tone: 'warn' });
      if (f.signups_paused) add({ key: 'signups', n: 1, icon: 'users', title: 'New sign-ups are paused', text: 'People with a Voo ID can still log in.', href: '#settings/features', action: 'Resume', tone: 'warn' });
      const off = Object.keys(F.AREAS).filter((k) => f[k] === false);
      if (off.length) add({ key: 'features', n: off.length, icon: 'eye', title: `${off.length} ${off.length === 1 ? 'area is' : 'areas are'} turned off`, text: off.map((k) => F.AREAS[k]).join(', ') + '.', href: '#settings/features', action: 'Review', tone: 'info' });
    }
    if (A.isOwner(me)) {
      const last = B.list()[0];
      const s = B.settings();
      const age = last ? now() - last.created_at : Infinity;
      add({ key: 'backups', n: last ? 0 : 1, icon: 'shield', title: last ? 'Backups are running' : 'No backup yet', text: last ? `Last copy ${Math.max(1, Math.round(age / 3600_000))} ${Math.round(age / 3600_000) <= 1 ? 'hour' : 'hours'} ago. Keeping the newest ${s.keep}.` : s.auto ? 'The first daily copy is made a minute after the app starts.' : 'Daily backups are off.', href: '#settings/backups', action: last ? 'Open' : 'Back up now', tone: !last || age > 36 * 3600_000 ? 'warn' : 'ok', at: last ? last.created_at : 0 });
    }
    return { items, at: now() };
  });

  /* Undo for "Hide product": show it to members again. */
  r.post('/api/admin/products/:id/show', (ctx) => {
    const me = A.requirePerm(ctx, 'products');
    const p = D.get('SELECT id, name FROM products WHERE id=?', Number(ctx.params.id));
    if (!p) fail(404, 'Product not found.');
    D.run('UPDATE products SET visible=1 WHERE id=?', p.id);
    D.insert('audit', { user_id: me.id, action: 'product.show', detail: p.name, created_at: now() });
    publish('community', 'site', { key: 'products' });
    return { ok: true };
  });

  /* Quick search: members, rooms, products, courses and posts this person can open. Five of each. */
  r.get('/api/admin/search', (ctx) => {
    const me = A.requireStaff(ctx);
    const q = clean(ctx.query.q, 80).toLowerCase();
    const out = { members: [], rooms: [], products: [], courses: [], posts: [] };
    if (q.length < 2) return out;
    const like = `%${q}%`;
    if (A.can(me, 'customers') || A.can(me, 'support')) {
      out.members = D.all('SELECT id, name, email, avatar, premium_until, banned FROM users WHERE lower(name) LIKE ? OR lower(email) LIKE ? OR handle LIKE ? OR voo_id=? ORDER BY last_seen DESC LIMIT 5', like, like, like, q)
        .map((u) => ({ id: u.id, name: u.name, email: u.email, avatar: json(u.avatar, {}), premium: (u.premium_until || 0) > now(), banned: !!u.banned }));
    }
    if (A.can(me, 'community')) out.rooms = D.all('SELECT id, name, topic, access, archived FROM rooms WHERE lower(name) LIKE ? OR lower(topic) LIKE ? ORDER BY archived, sort LIMIT 5', like, like);
    if (A.can(me, 'products')) out.products = D.all('SELECT id, name, slug, icon, color, visible FROM products WHERE lower(name) LIKE ? OR slug LIKE ? ORDER BY hub DESC, sort LIMIT 5', like, like);
    if (A.can(me, 'academy')) out.courses = D.all('SELECT id, title, track, published FROM courses WHERE lower(title) LIKE ? ORDER BY sort LIMIT 5', like);
    if (A.can(me, 'blog')) out.posts = D.all('SELECT id, title, category, published FROM posts WHERE lower(title) LIKE ? ORDER BY created_at DESC LIMIT 5', like);
    return out;
  });
};
