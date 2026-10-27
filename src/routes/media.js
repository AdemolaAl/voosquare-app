'use strict';
/* Image uploads: create, serve, discard, storage stats. See src/uploads.js. */
const D = require('../db');
const A = require('../auth');
const up = require('../uploads');
const { fail } = require('../util');

module.exports = function routes(r) {
  r.post('/api/uploads', (ctx) => up.create(ctx));

  /* The member removed an image from the composer before sending: drop it now instead of waiting for the cleanup. */
  r.del('/api/uploads/:id', (ctx) => {
    const u = A.requireUser(ctx);
    const row = D.get('SELECT * FROM uploads WHERE id=?', String(ctx.params.id));
    if (!row || row.user_id !== u.id) fail(404, 'Image not found.');
    if (row.attached_to) fail(400, 'Delete the message instead.');
    up.softDelete(row.id);
    return { ok: true };
  });

  r.get('/u/:file', (ctx) => up.serve(ctx));

  r.get('/api/admin/uploads/stats', (ctx) => {
    const me = A.requireStaff(ctx);
    if (!A.can(me, 'community') && !A.can(me, 'settings')) fail(403, "You don't have access to this part of the admin.");
    return { stats: up.stats(), settings: up.settings() };
  });
};
