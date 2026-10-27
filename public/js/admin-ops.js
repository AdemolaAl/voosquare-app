/* VooSquare admin: run-the-place tools. Loaded after admin.js, which shares its helpers on window.VSA.
 * Settings → Features (switches), Settings → Backups, What's new, the Today list, quick search (Ctrl/Cmd + K) and shortcuts. */
(function () {
  'use strict';
  const { $, $$, esc, fmt, icon, toast, timeAgo, avatar } = VS;
  const A = window.VSA;
  const { S, can, isOwner, GET, POST, PUT, DEL, run, modal, confirmIn, undoToast, field, input, textarea, switchField, readForm, pill, empty, errorBox, skelRows, pageHead } = A;
  const bytes = (b) => (!b ? '0 KB' : b >= 1073741824 ? fmt(b / 1073741824, 2) + ' GB' : b >= 1048576 ? fmt(b / 1048576, b < 10485760 ? 1 : 0) + ' MB' : fmt(Math.max(1, Math.round(b / 1024))) + ' KB');
  const when = (t) => (t ? `${new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '');

  A.greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

  /* =====================================================================
   * TODAY: what needs attention, one action each
   * ===================================================================== */
  A.today = async function (host) {
    host.innerHTML = `<div class="card today"><div class="skel" style="height:120px"></div></div>`;
    let d;
    try { d = await GET('/api/admin/today'); } catch (e) { host.innerHTML = ''; return; }
    if (!host.isConnected) return;
    const acts = d.items.filter((x) => x.tone === 'act' || x.tone === 'warn');
    const rest = d.items.filter((x) => !(x.tone === 'act' || x.tone === 'warn'));
    const row = (x) => `<a class="td-r t-${esc(x.tone)}" href="${esc(x.href)}"><span class="td-ic">${icon(x.icon)}</span><span class="td-t"><b>${esc(x.title)}</b><small>${esc(x.text)}</small></span><span class="td-a">${esc(x.action)}${icon('arrow')}</span></a>`;
    host.innerHTML = `<section class="card today" aria-label="Today">
      <div class="card-h"><div><h3>Today</h3><span class="sub">${acts.length ? `${acts.length} ${acts.length === 1 ? 'thing needs' : 'things need'} you` : 'Nothing is waiting on you right now'}</span></div><button type="button" class="r btn btn-ghost btn-xs" data-td-refresh aria-label="Refresh the Today list">${icon('refresh')}Refresh</button></div>
      ${acts.length ? `<div class="td-list">${acts.map(row).join('')}</div>` : `<div class="td-clear">${icon('check')}<span>All clear. New conversations, applications, payouts and orders show up here as they arrive.</span></div>`}
      ${rest.length ? `<div class="td-list td-quiet">${rest.map(row).join('')}</div>` : ''}
    </section>`;
    $('[data-td-refresh]', host).onclick = () => A.today(host);
  };

  /* =====================================================================
   * SETTINGS → FEATURES
   * ===================================================================== */
  const AREAS = [
    ['Member areas', [
      ['community', 'Community', 'chat', 'Rooms, chat and member profiles.', 'Community in the menu, rooms and chat.', 'No Community in the menu or on the website. Messages and rooms are kept.'],
      ['academy', 'Academy', 'book', 'Courses and animated lessons.', 'The Academy, courses and lesson progress.', 'No Academy anywhere. Progress and XP are kept.'],
      ['voice', 'Teaching voice', 'wave', 'Narration read aloud in VooSquare Academy lessons.', 'A Listen button, captions and voice controls in lessons that have clips.', 'Lessons play silently. Clips and settings are kept.'],
      ['blog', 'Blog', 'pen', 'Posts on the website and in the app.', 'The blog on the website and posts in the app.', 'No blog section. Posts stay saved as they are.'],
      ['tools', 'Free tools', 'calc', 'Break-even, ROAS and the other calculators.', 'Free tools in the menu and on Home.', 'No free tools. Saved scenarios are kept.'],
      ['referrals', 'Referrals', 'gift', 'Referral links, earnings and payout requests.', 'Their referral link, earnings and payouts.', 'No Referrals page and no new payout requests. Earnings keep counting.'],
      ['affiliates', 'Affiliate program', 'users', 'affiliate.voosquare.com: applications, links, reports, payouts and contests.', 'The affiliate site and dashboard.', 'Affiliates see a "back soon" message. Clicks keep tracking and earnings keep counting.'],
      ['support', 'Support', 'help', 'The support inbox in the app and the website widget.', 'Support in the menu and the chat bubble on your sites.', 'No Support page and no widget. Your team inbox still works.'],
    ]],
    ['Selling', [
      ['premium', 'Premium', 'premium', 'Selling the Premium membership.', 'Pricing, the Premium page and checkout.', 'No pricing or checkout for Premium. Current Premium members keep it.'],
      ['paid_rooms', 'Paid rooms', 'star', 'Selling paid and invite-only rooms.', 'Paid rooms, applications and checkout.', 'Paid rooms are hidden from people outside them. Members inside keep access.'],
    ]],
    ['On every page', [
      ['spotlight', 'Spotlight ads', 'megaphone', 'The animated sponsor slider.', 'Spotlight slides on Home, Academy, community and the website.', 'No Spotlight slides. Your slides stay saved in Site content.'],
      ['announcements', 'Announcement bar', 'bell', 'The short rotating lines at the top.', 'The bar at the top of the site and app.', 'No announcement bar. Your lines stay saved.'],
      ['images', 'Image sharing', 'image', 'Members adding images to messages.', 'An image button in rooms.', 'No image button for members. The team can still share. Old images stay.'],
    ]],
  ];

  const areaRow = (f, [k, label, ic, desc, onTxt, offTxt]) => `<div class="ft-r ${f[k] ? 'is-on' : 'is-off'}" data-k="${k}">
      <span class="ft-ic">${icon(ic)}</span>
      <span class="ft-t"><b>${esc(label)}</b><small>${esc(desc)}</small><span class="ft-see"><span class="ft-lbl">Members see</span><span class="ft-on">${esc(onTxt)}</span><span class="ft-off">${esc(offTxt)}</span></span></span>
      <span class="ft-st" aria-hidden="true"><i></i><span class="ft-on">Live</span><span class="ft-off">Off</span></span>
      <label class="switch sw ft-sw"><input type="checkbox" data-area="${k}" ${f[k] ? 'checked' : ''} aria-label="${esc(label)}"><i></i></label>
    </div>`;

  async function featuresTab(el) {
    el.innerHTML = skelRows(6, 76);
    let d;
    try { d = await GET('/api/admin/features'); } catch (e) { el.innerHTML = errorBox(e); return; }
    if (!el.isConnected) return;
    let f = d.features;
    const draw = () => {
      el.innerHTML = `
        <div class="ft-intro"><span>${icon('shield')}</span><p>Switches go live in seconds for everyone. Nothing is deleted: turn an area back on and every room, course, post and setting is exactly where it was.</p></div>
        <div class="ft-grid">
          <section class="card ft-access" aria-label="Access">
            <div class="card-h"><div><h3>Access</h3><span class="sub">Who can get in right now.</span></div></div>
            <form class="ft-big ${f.maintenance ? 'is-on warn' : ''}" id="mtF" novalidate>
              <div class="ft-bh"><span class="ft-ic">${icon('lock')}</span><span class="ft-t"><b>Maintenance mode</b><small>Members see a friendly "back soon" page. You and the team still get in.</small></span>
                <label class="switch sw ft-sw"><input type="checkbox" id="mtSw" ${f.maintenance ? 'checked' : ''} aria-label="Maintenance mode"><i></i></label></div>
              ${field('Message on the "back soon" page', textarea('maintenance_message', f.maintenance_message, { rows: 2, ph: d.defaults.maintenance_message }), 'Leave empty to use the message shown in grey.')}
              <div class="row end"><button type="submit" class="btn btn-w btn-xs">Save message</button></div>
            </form>
            <form class="ft-big ${f.signups_paused ? 'is-on warn' : ''}" id="suF" novalidate>
              <div class="ft-bh"><span class="ft-ic">${icon('users')}</span><span class="ft-t"><b>Pause new sign-ups</b><small>People with a Voo ID still log in. New emails see your message instead of a code.</small></span>
                <label class="switch sw ft-sw"><input type="checkbox" id="suSw" ${f.signups_paused ? 'checked' : ''} aria-label="Pause new sign-ups"><i></i></label></div>
              ${field('Message for new people', textarea('signups_message', f.signups_message, { rows: 2, ph: d.defaults.signups_message }), 'Leave empty to use the message shown in grey.')}
              <div class="row end"><button type="submit" class="btn btn-w btn-xs">Save message</button></div>
            </form>
            <div class="ft-prev" aria-hidden="true"><span class="ft-prev-l">Preview of the "back soon" page</span><div class="bs-mini"><span class="bs-logo">${VS.PI.voosquare}</span><b>Back soon</b><p>${esc(f.maintenance_message || d.defaults.maintenance_message)}</p></div></div>
          </section>
          <div class="ft-areas">${AREAS.map(([g, rows]) => `<section class="card ft-group" aria-label="${esc(g)}"><div class="card-h"><div><h3>${esc(g)}</h3><span class="sub">${rows.filter((r) => f[r[0]]).length} of ${rows.length} live</span></div></div>${rows.map((r) => areaRow(f, r)).join('')}</section>`).join('')}</div>
        </div>`;
      bind();
    };
    const save = async (patch, msg, ctl) => {
      const before = { ...f };
      try {
        const r = await PUT('/api/admin/features', { ...f, ...patch });
        f = r.features;
        return { before };
      } catch (e) { toast(e.message, 'err'); if (ctl) ctl.checked = !ctl.checked; return null; }
    };
    const bind = () => {
      $$('[data-area]', el).forEach((cb) => cb.addEventListener('change', async () => {
        const k = cb.dataset.area; const v = cb.checked;
        const row = cb.closest('.ft-r');
        row.classList.toggle('is-on', v); row.classList.toggle('is-off', !v);
        const label = row.querySelector('b').textContent;
        cb.disabled = true;
        const ok = await save({ [k]: v }, '', cb);
        cb.disabled = false;
        if (!ok) { row.classList.toggle('is-on', !v); row.classList.toggle('is-off', v); return; }
        const sub = row.closest('.ft-group').querySelector('.sub');
        const rows = $$('.ft-r', row.closest('.ft-group'));
        sub.textContent = `${rows.filter((r) => r.classList.contains('is-on')).length} of ${rows.length} live`;
        undoToast(`${label} is ${v ? 'live' : 'off'} for members`, { onUndo: async () => { const r = await save({ [k]: !v }); if (r) draw(); } });
      }));
      const mt = $('#mtSw', el);
      mt.addEventListener('change', () => {
        if (mt.checked) {
          mt.checked = false;
          confirmIn(mt.closest('.ft-bh'), {
            text: 'Turn on maintenance mode? Members are shown the "back soon" page until you turn it off. You and the team still get in.', yes: 'Turn on',
            onYes: async () => { const r = await save({ maintenance: true, maintenance_message: $('[name=maintenance_message]', el).value }); if (r) { toast('Maintenance mode is on'); draw(); } },
          });
        } else {
          save({ maintenance: false }).then((r) => { if (r) { toast('Maintenance mode is off. Members are back in.'); draw(); } });
        }
      });
      const su = $('#suSw', el);
      su.addEventListener('change', async () => {
        const v = su.checked;
        const r = await save({ signups_paused: v, signups_message: $('[name=signups_message]', el).value }, '', su);
        if (r) { toast(v ? 'New sign-ups are paused' : 'Sign-ups are open again'); draw(); }
      });
      $('#mtF', el).addEventListener('submit', (e) => { e.preventDefault(); run($('button[type=submit]', e.target), () => PUT('/api/admin/features', { ...f, maintenance_message: e.target.maintenance_message.value }).then((r) => { f = r.features; $('.bs-mini p', el).textContent = f.maintenance_message || d.defaults.maintenance_message; }), 'Message saved'); });
      $('#suF', el).addEventListener('submit', (e) => { e.preventDefault(); run($('button[type=submit]', e.target), () => PUT('/api/admin/features', { ...f, signups_message: e.target.signups_message.value }).then((r) => { f = r.features; }), 'Message saved'); });
      $('[name=maintenance_message]', el).addEventListener('input', (e) => { $('.bs-mini p', el).textContent = e.target.value.trim() || d.defaults.maintenance_message; });
    };
    draw();
  }

  /* =====================================================================
   * SETTINGS → BACKUPS (owner)
   * ===================================================================== */
  async function backupsTab(el) {
    if (!isOwner()) { el.innerHTML = empty('shield', 'Owner only', 'Ask an owner to download a backup.'); return; }
    el.innerHTML = skelRows(4, 90);
    let d;
    const load = async () => { d = await GET('/api/admin/backups'); };
    try { await load(); } catch (e) { el.innerHTML = errorBox(e); return; }
    if (!el.isConnected) return;
    const draw = () => {
      const last = d.backups[0];
      el.innerHTML = `
        <section class="card bk-hero">
          <div class="bk-l"><h3>Download a copy of everything</h3><p>Members, orders, rooms, messages, courses and settings in one SQLite file, copied safely while VooSquare keeps running. Keep it somewhere private: it holds personal data.</p>
            <div class="row wrap"><a class="btn btn-g btn-sm" id="bkDl" href="/api/admin/backups/download" download>${icon('download')}Download backup</a><button type="button" class="btn btn-w btn-sm" id="bkRun">${icon('shield')}Keep a copy on the server</button></div></div>
          <dl class="bk-stats"><div><dt>Database</dt><dd>${bytes(d.db_bytes)}</dd></div><div><dt>Images folder</dt><dd>${bytes(d.uploads_bytes)}<small>${fmt(d.uploads_files)} files</small></dd></div><div><dt>Last copy</dt><dd>${last ? timeAgo(last.created_at) + ' ago' : 'None yet'}</dd></div></dl>
        </section>
        <p class="info-line sm mt">${icon('image')}<span>Images people share are not inside the database file. They live in <b class="mono">${esc(d.uploads_dir)}</b> on the same Railway volume, so Railway volume backups cover them. Copy that folder too if you move servers.</span></p>
        <div class="g2 mt">
          <form class="card stack" id="bkF" novalidate><div class="card-h"><div><h3>Daily copies</h3><span class="sub">Saved on the server in <span class="mono">${esc(d.dir)}</span>.</span></div></div>
            ${switchField('auto', d.settings.auto, 'Make a copy every day', 'The first one is made a minute after the app starts, then every 24 hours.')}
            ${field('How many copies to keep', `<select class="inp" name="keep" aria-label="Copies to keep">${[3, 5, 7, 14, 30].map((n) => `<option value="${n}"${n === d.settings.keep ? ' selected' : ''}>The newest ${n}</option>`).join('')}</select>`, 'Older copies are removed automatically. Copies you make by hand count too.')}
            ${d.last_error ? `<p class="err">${icon('flag')}The last daily copy failed: ${esc(d.last_error)}</p>` : ''}
            <div class="row end"><button type="submit" class="btn btn-g btn-sm">Save daily copies</button></div></form>
          <section class="card"><div class="card-h"><div><h3>Copies on the server</h3><span class="sub">${d.backups.length ? `${d.backups.length} saved, ${bytes(d.backups.reduce((a, b) => a + b.bytes, 0))} in total` : 'None yet'}</span></div></div>
            ${d.backups.length ? `<div class="bk-list">${d.backups.map((b) => `<div class="bk-r"><span class="bk-ic">${icon(b.kind === 'auto' ? 'clock' : b.kind === 'pre-migrate' ? 'flag' : 'shield')}</span><span class="bk-t"><b>${esc(when(b.created_at))}</b><small>${b.kind === 'auto' ? 'Daily copy' : b.kind === 'pre-migrate' ? 'Made automatically before an update' : b.kind === 'pre-restore' ? 'Saved just before a restore' : 'Made by hand'} · ${bytes(b.bytes)}</small></span><a class="btn btn-w btn-xs" href="/api/admin/backups/file/${encodeURIComponent(b.name)}" download aria-label="Download the copy from ${esc(when(b.created_at))}">${icon('download')}Download</a></div>`).join('')}</div>`
              : empty('shield', 'No copies yet', 'Make the first one now. Daily copies start a minute after the app starts.', '<button type="button" class="btn btn-g btn-sm" data-bk-first>Keep a copy now</button>')}
          </section>
        </div>
        ${d.schema ? `<p class="info-line sm mt">${icon('shield')}<span>Database version <b>${esc(String(d.schema.version))}</b>${d.schema.ok ? '' : ` (this code expects ${esc(String(d.schema.expected))})`}. Before every update that changes the database, VooSquare makes a copy by itself and keeps the newest ${esc(String(d.schema.keep))} of those.${d.schema.backup_error ? ` <b>The last one failed: ${esc(d.schema.backup_error)}</b>` : ''}</span></p>` : ''}
        <details class="card bk-help mt"><summary>${icon('help')}<b>How to restore a backup</b><span class="muted sm">Not from this page, on purpose.</span></summary>
          <ol><li>Restoring throws away everything after the copy was made (new members, payments, messages). Ask yourself if rolling back the last deploy in Railway is enough: it usually is, and it loses nothing.</li><li>Download the current database first (button above), just in case.</li><li>Copy the exact name of a copy from the list above, for example <span class="mono">pre-migrate-v4-2026-10-05-090000-000.db</span>.</li><li>In Railway, open the service → <b>Variables</b> → add <span class="mono">RESTORE_FROM</span> with that name. Railway restarts the app. Before it opens the database, it saves the current one as "Saved just before a restore", then puts your copy back.</li><li>Check <span class="mono">/healthz</span> and log in here. Then delete the <span class="mono">RESTORE_FROM</span> variable (it never restores the same copy twice, but keep things tidy).</li></ol>
          <p class="muted sm">Step by step, with what to check afterwards: docs/CHANGING-SAFELY.md, section 14.</p></details>`;
      const mk = async (btn) => { const r = await run(btn, () => POST('/api/admin/backups/run'), 'Copy saved on the server'); if (r) { d = { ...d, backups: r.backups }; await load().catch(() => {}); if (el.isConnected) draw(); } };
      $('#bkRun', el).onclick = (e) => mk(e.currentTarget);
      const first = $('[data-bk-first]', el); if (first) first.onclick = (e) => mk(e.currentTarget);
      $('#bkDl', el).addEventListener('click', () => { toast('Preparing your backup. The download starts in a moment.'); setTimeout(() => load().then(() => { if (el.isConnected) draw(); }).catch(() => {}), 2500); });
      $('#bkF', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readForm(e.target);
        const r = await run($('button[type=submit]', e.target), () => PUT('/api/admin/backups/settings', { auto: v.auto, keep: Number(v.keep) }), 'Daily copies saved');
        if (r) { await load().catch(() => {}); if (el.isConnected) draw(); }
      });
    };
    draw();
  }

  /* =====================================================================
   * SETTINGS → RECYCLE BIN (owner): what the team deleted in the admin, put back in one click (src/trash.js)
   * ===================================================================== */
  const BIN_KIND = { posts: ['Blog post', 'pen'], courses: ['Course', 'book'], lessons: ['Lesson', 'play'], progress: ['Member progress', 'check'], canned: ['Canned reply', 'inbox'], release_notes: ["What's new note", 'spark'], school_partners: ['School partner', 'users'] };
  const binKind = (t) => BIN_KIND[t] || [t.replace(/_/g, ' '), 'trash'];
  const binTitle = (r) => { const d = r.data || {}; return String(d.title || d.name || d.subject || d.question || d.body || `#${r.row_id}`).slice(0, 90); };
  async function recycleTab(el) {
    if (!isOwner()) { el.innerHTML = empty('trash', 'Owner only', 'Ask an owner to put back something that was deleted.'); return; }
    el.innerHTML = skelRows(4, 72);
    let rows;
    const load = async () => { rows = (await GET('/api/admin/recycle-bin')).rows; };
    try { await load(); } catch (e) { el.innerHTML = errorBox(e); return; }
    const draw = () => {
      if (!el.isConnected) return;
      // One entry per delete: a course goes in with its lessons and members' progress, and comes back the same way.
      const groups = [];
      const byBatch = new Map();
      for (const r of rows) {
        const key = r.batch || 'id:' + r.id;
        let g = byBatch.get(key);
        if (!g) { g = { key, batch: r.batch, id: r.id, rows: [], at: r.deleted_at, by: r.deleted_by_name }; byBatch.set(key, g); groups.push(g); }
        g.rows.push(r);
      }
      const head = (g) => g.rows.find((r) => r.table_name !== 'progress') || g.rows[0];
      el.innerHTML = `<p class="info-line sm">${icon('shield')}<span>When someone on the team deletes a post, course, lesson, canned reply, What's new note or school partner, a full copy lands here first. Restore puts it back exactly as it was, with any lessons and member progress that went with it. Orders, payouts and earnings are never deleted, so they never show here.</span></p>
        <section class="card mt"><div class="card-h"><div><h3>Deleted items</h3><span class="sub">${groups.length ? `${fmt(groups.length)} ${groups.length === 1 ? 'item' : 'items'}, newest first` : 'Nothing deleted yet'}</span></div></div>
        ${groups.length ? `<div class="bin-list">${groups.map((g) => { const h = head(g); const [k, ic] = binKind(h.table_name); const extra = g.rows.length - 1; const parts = {}; g.rows.forEach((r) => { if (r !== h) parts[r.table_name] = (parts[r.table_name] || 0) + 1; }); return `<div class="bin-r" data-key="${esc(g.key)}" data-cfm><span class="bk-ic">${icon(ic)}</span><span class="bin-t"><b>${esc(binTitle(h))}</b><small>${esc(k)}${extra ? ` with ${Object.entries(parts).map(([t, n]) => `${fmt(n)} ${binKind(t)[0].toLowerCase()}${n === 1 || t === 'progress' ? '' : 's'}`).join(' and ')}` : ''} · deleted ${esc(when(g.at))}${g.by ? ` by ${esc(g.by)}` : ''}</small></span><button type="button" class="btn btn-w btn-sm" data-restore>${icon('refresh')}Restore</button></div>`; }).join('')}</div>`
          : empty('trash', 'The recycle bin is empty', 'Things the team deletes in the admin show up here, ready to put back.')}</section>`;
      el.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', () => {
        const g = groups.find((x) => x.key === b.closest('.bin-r').dataset.key); if (!g) return;
        confirmIn(b, { text: `Put "${binTitle(head(g))}" back where it was?`, yes: 'Restore', danger: false, onYes: async () => {
          await POST('/api/admin/recycle-bin/restore', g.batch ? { batch: g.batch } : { id: g.id });
          toast('Restored');
          await load(); draw();
        } });
      }));
    };
    draw();
  }

  A.settingsTab = (tab, el) => (tab === 'features' ? featuresTab(el) : tab === 'backups' ? backupsTab(el) : tab === 'bin' ? recycleTab(el) : null);

  /* =====================================================================
   * WHAT'S NEW: in-app release notes for members
   * ===================================================================== */
  const noteCard = (n) => `<div class="wn-card"><span class="wn-k">${icon('spark')}What's new</span><b>${esc(n.title || 'Your title')}</b>${n.body ? `<p>${esc(n.body)}</p>` : '<p class="ph">One or two short sentences about what changed and why it helps.</p>'}<span class="wn-f">${n.link_url ? `<span class="btn btn-l btn-xs">${esc(n.link_text || 'Take a look')}${icon('arrow')}</span>` : ''}<span class="wn-x">Got it</span></span></div>`;
  /* =====================================================================
   * LEGAL: privacy policy and terms of service (/privacy, /terms), and the "approved by counsel" switches (src/legal.js)
   * ===================================================================== */
  const LG_DOCS = [['privacy', 'Privacy policy', '/privacy'], ['terms', 'Terms of service', '/terms']];
  A.page('legal', {
    t: 'Legal', i: 'shield', perm: () => can('settings'),
    async r(el, args) {
      const key = LG_DOCS.some((d) => d[0] === args[0]) ? args[0] : 'privacy';
      el.innerHTML = `${pageHead('Legal', 'The privacy policy and terms members read, and whether counsel has approved them.')}${skelRows(3, 120)}`;
      let d;
      try { d = await GET('/api/admin/legal'); } catch (e) { el.innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      const doc = d[key]; const meta = LG_DOCS.find((x) => x[0] === key);
      const APPR = [['privacy', 'Privacy policy', '/privacy'], ['terms', 'Terms of service', '/terms'], ['affiliate', 'Affiliate terms', '/affiliates#/site/terms']];
      el.innerHTML = `${pageHead('Legal', 'The privacy policy and terms members read, and whether counsel has approved them.')}
        <section class="card stack lg-appr"><div class="card-h"><div><h3>Approved by counsel</h3><span class="sub">While a document is not approved, its page shows: “${esc(d.banner.split('.')[0])}.” Turn it on only after your lawyer has reviewed the text.</span></div>${d.can_approve ? '' : pill('Owner only', 'w')}</div>
          <div class="lg-appr-l">${APPR.map(([k, l, u]) => `<div class="lg-appr-r"><span><b>${esc(l)}</b><a href="${u}" target="_blank" rel="noopener">${icon('ext')}Open page</a></span>${d.can_approve ? switchField('ap_' + k, d.approved[k], d.approved[k] ? 'Approved' : 'Draft') : pill(d.approved[k] ? 'Approved' : 'Draft', d.approved[k] ? 'g' : 'gold')}</div>`).join('')}</div></section>
        <nav class="tabs st-tabs mt" aria-label="Documents">${LG_DOCS.map(([k, l]) => `<a href="#legal/${k}" class="${k === key ? 'on' : ''}"${k === key ? ' aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>
        <form class="card stack" id="lgF" novalidate>
          <div class="card-h"><div><h3>${esc(meta[1])}</h3><span class="sub">${doc.custom ? `Your text, saved ${esc(when(doc.updated_at))}.` : `The draft template, naming only ${esc(d.company)}. Edit it with your lawyer, then save.`}</span></div><a class="r btn btn-w btn-xs" href="${meta[2]}" target="_blank" rel="noopener">${icon('ext')}View page</a></div>
          <textarea class="inp lg-ta" name="body" rows="22" spellcheck="true" aria-label="${esc(meta[1])} text">${esc(doc.body)}</textarea>
          <p class="info-line sm">${icon('pen')}<span>Start a section with <b class="mono">## </b>, a list item with <b class="mono">- </b>, bold with <b class="mono">**words**</b>, a link with <b class="mono">[text](/privacy)</b>. <b class="mono">{support_email}</b> becomes the support email from Settings.</span></p>
          <div class="row end" data-cfm>${doc.custom ? `<button type="button" class="btn btn-ghost btn-sm" id="lgReset">${icon('refresh')}Go back to the template</button>` : ''}<button type="submit" class="btn btn-g btn-sm">Save ${esc(meta[1].toLowerCase())}</button></div>
        </form>`;
      const f = $('#lgF', el);
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await run($('button[type=submit]', f), () => PUT('/api/admin/legal/' + key, { body: f.body.value }), `${meta[1]} saved`);
        if (r && el.isConnected) A.route(true);
      });
      const rs = $('#lgReset', el);
      if (rs) rs.onclick = () => confirmIn(rs, { text: 'Replace your text with the draft template? Your saved text is overwritten.', yes: 'Use the template', onYes: async () => { await PUT('/api/admin/legal/' + key, { body: '' }); toast('Template restored'); A.route(true); } });
      el.querySelectorAll('.lg-appr [name^="ap_"]').forEach((sw) => sw.addEventListener('change', async () => {
        const k = sw.name.slice(3);
        const r = await run(null, () => PUT('/api/admin/legal/approval', { [k]: sw.checked }), sw.checked ? 'Marked as approved. The draft banner is gone from that page.' : 'Marked as draft. The banner is back.');
        if (!r) { sw.checked = !sw.checked; return; }
        const lb = sw.closest('label').querySelector('span'); if (lb) lb.textContent = sw.checked ? 'Approved' : 'Draft';
      }));
    },
  });

  A.page('whatsnew', {
    t: "What's new", i: 'spark', perm: () => can('content'),
    async r(el) {
      el.innerHTML = `${pageHead("What's new", 'Tell members about a new feature. The note shows once as a card on their Home, then stays out of the way.')}${skelRows(3, 90)}`;
      let d;
      const load = async () => { d = await GET('/api/admin/whats-new'); };
      try { await load(); } catch (e) { el.innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      let editing = null;
      const draw = () => {
        const n = editing || { title: '', body: '', link_url: '', link_text: '' };
        el.innerHTML = `${pageHead("What's new", 'Tell members about a new feature. The note shows once as a card on their Home, then stays out of the way.')}
          <div class="ed-grid">
            <form class="card stack" id="wnF" novalidate><div class="card-h"><div><h3>${editing ? 'Edit note' : 'Post a note'}</h3><span class="sub">${editing ? 'Members who closed it will not see it again.' : 'Members who joined before you post it see it once.'}</span></div></div>
              <input type="hidden" name="id" value="${esc(n.id || '')}">
              ${field('Title', input('title', n.title, { ph: 'Saved scenarios in the free tools', max_len: 80 }), 'Up to 80 characters. Say what is new in plain words.')}
              ${field('Short text', textarea('body', n.body, { rows: 3, ph: 'Premium members can now save a calculator scenario and come back to it.' }), 'Up to 280 characters. One or two sentences.')}
              <div class="g2c">${field('Button link', input('link_url', n.link_url, { ph: '/app#tools or https://...' }), 'Optional. /app# links stay in the app.')}${field('Button text', input('link_text', n.link_text, { ph: 'Try it', max_len: 32 }), 'Optional. Defaults to "Take a look".')}</div>
              <div class="row end">${editing ? '<button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel edit</button>' : ''}<button type="submit" class="btn btn-g btn-sm">${editing ? 'Save note' : 'Post to members'}</button></div></form>
            <div class="card prev-card stick"><span class="muted xs">How it looks on member Home</span><div class="wn-stage" id="wnP">${noteCard(n)}</div></div>
          </div>
          <section class="card mt"><div class="card-h"><div><h3>Posted notes</h3><span class="sub">Only the newest live note shows. Turn one off to stop showing it.</span></div></div>
            ${d.notes.length ? `<div class="wn-list">${d.notes.map((x) => `<div class="wn-r ${x.published ? '' : 'off'}" data-id="${x.id}" data-cfm><span class="wn-t"><b>${esc(x.title)}</b><small>${esc(when(x.created_at))} · seen and closed by ${fmt(x.seen)} ${x.seen === 1 ? 'member' : 'members'}</small></span>
              <label class="switch sw"><input type="checkbox" data-pub ${x.published ? 'checked' : ''} aria-label="Show ${esc(x.title)} to members"><i></i><span>${x.published ? 'Live' : 'Off'}</span></label>
              <span class="row"><button type="button" class="btn btn-w btn-xs" data-edit>${icon('pen')}Edit</button><button type="button" class="btn btn-danger btn-xs" data-del aria-label="Delete ${esc(x.title)}">${icon('trash')}</button></span></div>`).join('')}</div>`
              : empty('spark', 'No notes yet', 'Post your first note above. It appears on member Home straight away, no rebuild needed.')}
          </section>`;
        const f = $('#wnF', el);
        const prev = () => { const v = readForm(f); $('#wnP', el).innerHTML = noteCard(v); };
        f.addEventListener('input', prev);
        const cx = $('[data-cancel]', f); if (cx) cx.onclick = () => { A.guard.clean(cx); editing = null; draw(); };
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const v = readForm(f);
          const r = await run($('button[type=submit]', f), () => POST('/api/admin/whats-new', { ...v, id: v.id ? Number(v.id) : undefined, published: editing ? !!editing.published : true }), editing ? 'Note saved' : 'Posted. Members see it on Home now.');
          if (r) { editing = null; await load(); if (el.isConnected) draw(); }
        });
        $$('.wn-r', el).forEach((row) => {
          const x = d.notes.find((n2) => n2.id === Number(row.dataset.id));
          $('[data-pub]', row).addEventListener('change', async (e) => {
            const on = e.target.checked;
            const r = await run(null, () => POST('/api/admin/whats-new', { ...x, published: on }), on ? 'Note is live' : 'Note is off');
            if (r) { x.published = on ? 1 : 0; row.classList.toggle('off', !on); $('span', e.target.parentElement).textContent = on ? 'Live' : 'Off'; } else e.target.checked = !on;
          });
          $('[data-edit]', row).onclick = () => { editing = x; draw(); $('[name=title]', el).focus(); window.scrollTo({ top: 0, behavior: VS.reduce ? 'auto' : 'smooth' }); };
          const del = $('[data-del]', row);
          del.onclick = () => confirmIn(del, { text: `Delete "${x.title}"? Members who have not closed it yet will not see it.`, yes: 'Delete note', onYes: async () => { await DEL('/api/admin/whats-new/' + x.id); toast('Note deleted'); await load(); if (el.isConnected) draw(); } });
        });
      };
      draw();
    },
  });

  /* =====================================================================
   * QUICK SEARCH (Ctrl/Cmd + K)
   * ===================================================================== */
  const SETTINGS_ITEMS = () => [
    ...(can('settings') ? [
      ['Features: turn areas on and off', '#settings/features', 'sliders', 'Community, Academy, blog, Premium, ads...'],
      ['Maintenance mode', '#settings/features', 'lock', 'Show members a "back soon" page'],
      ['Pause new sign-ups', '#settings/features', 'users', 'Existing members still log in'],
      ['Email provider', '#settings', 'mail', 'Resend, Brevo or Postmark'],
      ['Brand and social links', '#settings', 'settings', 'Company, support email, Telegram, X'],
      ['Reporting time zone', '#settings', 'clock', 'How revenue days are cut'],
      ['Plans and referral rules', '#plans', 'diamond', 'Premium price, tiers, minimum payout'],
    ] : []),
    ...(isOwner() ? [['Backups: download the database', '#settings/backups', 'shield', 'Owner only']] : []),
    ...(can('content') ? [['Post a What\'s new note', '#whatsnew', 'spark', 'Announce a feature to members'], ['Announcement bar', '#content', 'megaphone', 'Short lines at the top'], ['Spotlight slides', '#content', 'megaphone', 'The sponsor slider']] : []),
    ...(can('team') ? [['Add someone to the team', '#team', 'shield', 'Roles and permissions'], ['Audit log', '#audit', 'clock', 'Every change in the admin']] : []),
    ...(can('support') ? [['Canned replies', '#support', 'reply', 'Saved answers for the inbox']] : []),
  ];
  let palOpen = false;
  A.openSearch = function () {
    if (palOpen || !S.me) return;
    palOpen = true;
    const pages = A.NAV.flatMap(([g, keys]) => keys.filter((k) => A.PAGES[k] && A.PAGES[k].perm()).map((k) => ({ g: 'Pages', t: A.PAGES[k].t, ic: icon(A.PAGES[k].i), href: '#' + k, s: g })));
    const statics = [...pages, ...SETTINGS_ITEMS().map(([t, href, ic, s]) => ({ g: 'Settings and actions', t, ic: icon(ic), href, s }))];
    const ov = document.createElement('div');
    ov.className = 'adm-pal-ov';
    ov.innerHTML = `<div class="adm-pal" role="dialog" aria-modal="true" aria-label="Search the admin"><div class="ap-in">${icon('search')}<input id="apQ" type="text" placeholder="Search members, rooms, products, pages and settings" autocomplete="off" spellcheck="false" aria-controls="apL" aria-autocomplete="list"><kbd>Esc</kbd></div><div class="ap-list" id="apL" role="listbox" aria-label="Results"></div><div class="ap-foot"><span><kbd>↑</kbd><kbd>↓</kbd>to move</span><span><kbd>Enter</kbd>to open</span><span><kbd>?</kbd>all shortcuts</span></div></div>`;
    document.body.appendChild(ov);
    document.body.classList.add('noscroll');
    const q = $('#apQ', ov); const L = $('#apL', ov);
    let list = []; let sel = 0; let dyn = []; let seq = 0; let loading = false;
    const prevFocus = document.activeElement;
    const paint = () => {
      const s = q.value.trim().toLowerCase();
      const st = s ? statics.filter((x) => `${x.t} ${x.s} ${x.g}`.toLowerCase().includes(s)) : statics.filter((x) => x.g === 'Pages');
      list = s ? [...dyn, ...st] : st;
      sel = Math.min(sel, Math.max(0, list.length - 1));
      let g = '';
      L.innerHTML = list.length ? list.map((x, i) => { const h = x.g !== g ? `<div class="ap-g" role="presentation">${esc(x.g)}</div>` : ''; g = x.g; return `${h}<a class="ap-i ${i === sel ? 'sel' : ''}" href="${esc(x.href)}" role="option" id="api${i}" aria-selected="${i === sel}" data-i="${i}"><span class="ap-ic">${x.ic}</span><span class="ap-t">${esc(x.t)}</span><small>${esc(x.s || '')}</small></a>`; }).join('')
        : `<div class="ap-none">${loading ? 'Searching...' : `Nothing matches "${esc(q.value)}". Try a name, an email or a page.`}</div>`;
      q.setAttribute('aria-activedescendant', list.length ? 'api' + sel : '');
      const se = $('.sel', L); if (se) se.scrollIntoView({ block: 'nearest' });
    };
    const search = A.debounce(async () => {
      const s = q.value.trim();
      const my = ++seq;
      if (s.length < 2) { dyn = []; loading = false; paint(); return; }
      try {
        const r = await GET('/api/admin/search?q=' + encodeURIComponent(s));
        if (my !== seq) return;
        dyn = [
          ...r.members.map((m) => ({ g: 'Members', t: m.name, ic: `<span class="av av-xs">${avatar(m.avatar && Object.keys(m.avatar).length ? m.avatar : { skin: m.id % 8, hair: m.id % 6 })}</span>`, href: '#customers/' + m.id, s: m.email })),
          ...r.rooms.map((x) => ({ g: 'Rooms', t: x.name, ic: icon('chat'), href: '#community', s: `${x.topic}${x.archived ? ' · archived' : ''}` })),
          ...r.products.map((x) => ({ g: 'Products', t: x.name, ic: VS.productIcon(x, 'xs'), href: '#products/' + x.id, s: x.visible ? x.slug : 'Hidden' })),
          ...r.courses.map((x) => ({ g: 'Courses', t: x.title, ic: icon('book'), href: '#academy/' + x.id, s: x.track })),
          ...r.posts.map((x) => ({ g: 'Blog posts', t: x.title, ic: icon('pen'), href: '#blog/' + x.id, s: x.category })),
        ];
      } catch { dyn = []; }
      loading = false; paint();
    }, 160);
    const close = () => { palOpen = false; ov.remove(); document.removeEventListener('keydown', key, true); if (!$('.adm-modal')) document.body.classList.remove('noscroll'); if (prevFocus && prevFocus.focus && prevFocus.isConnected) prevFocus.focus(); };
    const pick = (x) => { close(); if (x) location.hash = x.href; };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, list.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(list[sel]); }
      else if (e.key === 'Tab') { e.preventDefault(); q.focus(); }
    };
    document.addEventListener('keydown', key, true);
    q.addEventListener('input', () => { sel = 0; loading = q.value.trim().length >= 2; paint(); search(); });
    ov.addEventListener('click', (e) => { const a = e.target.closest('[data-i]'); if (a) { e.preventDefault(); pick(list[Number(a.dataset.i)]); } else if (e.target === ov) close(); });
    paint();
    setTimeout(() => q.focus(), 20);
  };

  /* =====================================================================
   * KEYBOARD SHORTCUTS
   * ===================================================================== */
  const GO = [['o', 'overview', 'Overview'], ['s', 'support', 'Support inbox'], ['c', 'customers', 'Customers'], ['m', 'community', 'Community'], ['a', 'academy', 'Academy'], ['b', 'blog', 'Blog'], ['p', 'payments', 'Payments'], ['w', 'whatsnew', "What's new"], ['t', 'settings', 'Settings'], ['f', 'settings/features', 'Features']];
  let gAt = 0;
  A.goKey = (e) => {
    const k = e.key.toLowerCase();
    if (k === 'g') { gAt = Date.now(); return; }
    if (gAt && Date.now() - gAt < 1200) {
      gAt = 0;
      const hit = GO.find((x) => x[0] === k);
      if (hit && A.PAGES[hit[1].split('/')[0]] && A.PAGES[hit[1].split('/')[0]].perm()) { e.preventDefault(); location.hash = '#' + hit[1]; }
    }
  };
  A.shortcuts = () => {
    const mac = /Mac|iP/.test(navigator.platform);
    const rows = [[[mac ? '⌘' : 'Ctrl', 'K'], 'Search members, rooms, products, pages and settings'], [['/'], 'Search, too'], [['?'], 'Show these shortcuts'], [['Esc'], 'Close a window or the menu'],
      ...GO.filter((x) => A.PAGES[x[1].split('/')[0]] && A.PAGES[x[1].split('/')[0]].perm()).map(([k, , l]) => [['G', k.toUpperCase()], 'Go to ' + l])];
    modal({ title: 'Keyboard shortcuts', body: `<p class="muted sm">Press G, then a letter, to jump to a section.</p><dl class="kb-list">${rows.map(([keys, t]) => `<div><dt>${keys.map((k) => `<kbd>${esc(k)}</kbd>`).join(`<span class="kb-then">${keys[0] === 'G' ? 'then' : '+'}</span>`)}</dt><dd>${esc(t)}</dd></div>`).join('')}</dl>` });
  };
})();
