/* VooSquare Affiliates dashboard, part two: Postbacks and Telegram, Creatives, Academy, Contests, Payouts (receipts, KYC),
 * Sub-affiliates, Manager, Notifications, Settings, Compliance, Terms, Application. Ported from the approved preview (app2.js). */
(function () {
  'use strict';
  const A = window.AF, VS = A.VS, S = A.S, PG = A.PG;
  const { esc, icon, fmt, face, pi, $c, $c0, pct, tierBadge, statusPill, empty } = A;
  const me = () => S.me || {};
  const isPend = () => A.isPend();
  const shell = (...a) => A.affShell(...a);
  const myFace = () => A.avOf(me().avatar, me().email);

  /* ================= Postbacks + Telegram alerts ================= */
  const EV_ON = ['registration', 'first_payment', 'qualified', 'cpa_approved', 'cpa_declined', 'refund', 'chargeback'];
  const ALERT_T = [['signup', 'Sign-ups'], ['first_payment', 'First payments'], ['qualified', 'Qualified FTDs'], ['cpa', 'CPA approved or declined'], ['refunds', 'Refunds and chargebacks'], ['tier', 'Tier changes'], ['payouts', 'Payout updates'], ['earnings', 'Earnings available'], ['health', 'Lifetime RevShare health'], ['deals', 'Deals and offer changes'], ['contest_rank', 'Contest rank changes'], ['announcements', 'Announcements'], ['daily', 'Daily summary'], ['weekly', 'Weekly summary']];
  const tgPhone = (st) => `<div class="phone" data-io aria-hidden="true"><div class="ph-top"><span class="ph-ava">${pi('premium', 'sm')}</span><span><b>VooSquare Affiliates</b><small>bot${st.bot ? ' · @' + esc(st.bot) : ''}</small></span></div><div class="ph-chat">${[
    'First payment · Joinvoo Pro $99.00 · C-7F3KQ2 · sub1 fb_ng_v3 · commission $19.80 available now', 'Qualified FTD · Spyvoo Pro · C-2HN5RT', 'CPA approved · Replyvoo Titan · $300.00 · available now', 'Earnings available. Request a payout from the dashboard.', 'Yesterday: clicks, sign-ups, first payments and commission in one message.',
  ].map((m, i) => `<div class="tgm" style="--i:${i}"><p>${esc(m)}</p><small>example</small></div>`).join('')}</div><div class="ph-cmd">${['/balance', '/today', '/tier', '/link joinvoo'].map((c) => `<span>${c}</span>`).join('')}</div></div>`;
  function tgState(st) {
    if (!st.configured) return `<div class="tg-off">${icon('alert')}<div><b>Telegram alerts are not configured yet.</b><p class="muted sm">Our team is setting up the VooSquare Affiliates bot. Everything else works; you get the same alerts in Notifications meanwhile.</p></div></div>`;
    if (st.connected) return `<div class="tg-on"><span class="live-dot"></span><b>Connected${st.username ? ' as @' + esc(st.username) : ''}.</b><button class="btn btn-w btn-xs" data-tgtest>Send test alert</button><button class="btn btn-ghost btn-xs" data-tgoff>Disconnect</button></div>`;
    if (st.link) return `<div class="tg-connect"><div class="tg-qr">${A.qr(st.link, 132)}</div><div><b>Open the bot and press Start</b><p class="muted sm">Opens ${esc(st.link.replace('https://', ''))} · single use, 30 minutes</p><div class="lb-act"><a class="btn btn-k btn-sm" href="${esc(st.link)}" target="_blank" rel="noopener">${icon('tg')}Open Telegram</a><button class="btn btn-w btn-sm" data-tgcheck>I pressed Start</button><button class="btn btn-ghost btn-sm" data-tgcancel>Cancel</button></div></div></div>`;
    return `<button class="btn btn-k" data-tgconnect>${icon('tg')}Connect Telegram</button>`;
  }
  const pbRow = (p) => `<div class="pb-i"><span class="pb-ic">${icon('server')}</span><div><b>${esc(p.name)}</b><code>${esc(p.url)}</code><small>${p.method} · ${p.events.length} event${p.events.length === 1 ? '' : 's'} · ${p.products.length ? p.products.map((k) => esc(A.brand(k).short || A.brand(k).name)).join(', ') : 'all products'}${p.signed ? ' · signed' : ''}</small></div>
    <div class="pb-a"><button class="btn btn-w btn-xs" data-pbtest="${p.id}">${icon('send')}Test</button><button class="btn btn-ghost btn-xs" data-pbedit="${p.id}">Edit</button><button class="btn btn-ghost btn-xs" data-pbdel="${p.id}" aria-label="Delete ${esc(p.name)}">${icon('x')}</button></div>
    <label class="switch"><input type="checkbox" data-pbon="${p.id}" ${p.active ? 'checked' : ''} aria-label="Active"><i></i></label></div>`;
  const logRow = (l) => `<tr class="${l.status === 'dead' || l.status === 'retry' ? 'fail' : ''}"><td>${A.dtm(l.created_at)}</td><td><code>${esc(l.event)}</code>${l.test ? ' <span class="pill pill-w">test</span>' : ''}</td><td class="url"><code>${esc(l.url)}</code></td><td class="n">${l.response_code ? `<span class="st ${l.response_code < 300 ? 'st-g' : 'st-r'}">${l.response_code}</span>` : statusPill(l.status)}</td><td class="n">${l.response_ms != null ? fmt(l.response_ms) + ' ms' : '–'}</td><td class="n">${l.attempts} of 6</td><td class="n">${(l.status === 'dead' || l.status === 'retry') && !l.test ? `<button class="btn btn-w btn-xs" data-resend="${l.id}">Resend</button>` : ''}</td></tr>`;
  PG.postbacks = (arg) => shell('postbacks', 'Postbacks', async () => {
    const [d, tg] = await Promise.all([A.api('/api/aff/postbacks'), A.api('/api/aff/telegram')]);
    S.cache.pb = d; S.cache.tg = tg;
    A.then((pg) => { wirePostbacks(pg); if (arg === 'tg') pg.querySelector('#tg').scrollIntoView({ block: 'start' }); });
    return `<div class="ph"><div><h2>Postbacks</h2><p>Send events to your tracker (Keitaro, Binom, RedTrack, Voluum or your own) the moment they happen.</p></div><button class="btn btn-k btn-sm" data-addpb>${icon('plus')}Add postback</button></div>
      <section class="card"><div class="pbl" data-pbl>${d.postbacks.length ? d.postbacks.map(pbRow).join('') : empty('server', 'No postbacks yet.', 'Add your tracker URL below and we call it on every event you choose.')}</div></section>
      <section class="card pbb" data-pbb><div class="card-h"><h3 data-pbbt>Postback builder</h3></div>
        <form data-pbf><input type="hidden" name="id" value=""><div class="fgrid"><label class="field"><span class="lbl">Name</span><input class="inp" name="name" maxlength="60" placeholder="RedTrack · TikTok"></label><div class="field"><span class="lbl">Method</span><div class="seg seg-lg" data-seg="method"><button class="on" type="button" data-v="GET">GET</button><button type="button" data-v="POST">POST</button></div></div></div>
        <label class="field"><span class="lbl">URL</span><input class="inp mono" name="url" data-pburl placeholder="${esc(d.example)}"><span class="hint">https only. Tap a macro to add it at the cursor.</span></label>
        <div class="macros">${d.macros.map((m) => `<button type="button" data-macro="{${m}}">{${m}}</button>`).join('')}</div>
        <div class="field"><span class="lbl">Events</span><div class="evs">${d.events.map((e) => `<label class="ck sm"><input type="checkbox" name="ev" value="${e}" ${EV_ON.includes(e) ? 'checked' : ''}><i>${icon('check')}</i><span><code>${e}</code></span></label>`).join('')}</div></div>
        <div class="fgrid"><label class="field"><span class="lbl">Products</span><select class="inp" name="product"><option value="">All products</option>${['premium', 'spyvoo', 'joinvoo', 'vooads', 'replyvoo', 'castvoo', 'landvoo'].map((k) => `<option value="${k}">${esc(A.brand(k).name)}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Signing secret <em>optional</em></span><input class="inp mono" name="secret" maxlength="128" placeholder="Adds X-VooSquare-Signature" autocomplete="off"></label></div>
        <label class="switch"><input type="checkbox" name="active" checked><i></i>Active</label>
        <p class="err" hidden></p>
        <p class="muted sm">If your server does not answer with a 2xx within 5 seconds, we retry after ${d.retry_minutes.map((m) => (m >= 60 ? `${m / 60} h` : `${m} min`)).join(', ')}.</p>
        <div class="lb-act"><button class="btn btn-g btn-sm" type="submit">Save postback</button><button class="btn btn-ghost btn-sm" type="button" data-pbreset>Clear</button><div class="pb-res" data-pbres></div></div></form></section>
      <section class="card"><div class="card-h"><h3>Delivery log</h3><span class="sub">Last 30 days</span><div class="r"><label class="switch sm"><input type="checkbox" data-failonly><i></i>Failed only</label></div></div>
        <div class="tbl-w" data-logbox>${d.logs.length ? `<table class="tbl" data-pblog><thead><tr><th>Time</th><th>Event</th><th>URL sent</th><th class="n">Response</th><th class="n">Time</th><th class="n">Attempt</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${d.logs.map(logRow).join('')}</tbody></table>` : empty('list', 'Deliveries show here with the response code and time.')}</div></section>
      <section class="card tg" id="tg"><div class="tg-in"><div class="tg-l"><span class="tg-badge">${icon('tg')}</span><h3>Get alerts in Telegram</h3><p>Connect the VooSquare Affiliates bot and choose what you want to hear about. It takes one tap.</p>
        <div data-tgstate>${tgState(tg)}</div>
        <form data-tgprefs ${tg.configured ? '' : 'hidden'}><div class="tg-toggles">${ALERT_T.map(([k, t]) => `<label class="switch"><input type="checkbox" name="${k}" ${tg.prefs[k] ? 'checked' : ''}><i></i>${t}</label>`).join('')}</div>
        <div class="fgrid tg-q"><label class="field"><span class="lbl">Quiet hours from</span><input class="inp" type="time" name="quiet_from" value="${esc(tg.quiet_from || '')}"></label><label class="field"><span class="lbl">to</span><input class="inp" type="time" name="quiet_to" value="${esc(tg.quiet_to || '')}"></label><label class="field"><span class="lbl">Time zone</span><select class="inp" name="tz">${['Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Accra', 'Africa/Cairo', 'Europe/London', 'Asia/Dubai', 'Asia/Kolkata', 'America/New_York'].map((z) => `<option ${z === (tg.tz || 'Africa/Lagos') ? 'selected' : ''}>${z}</option>`).join('')}</select></label></div>
        <button class="btn btn-w btn-sm" type="submit">Save alert settings</button></form></div>
        <div class="tg-r">${tgPhone(tg)}</div></div></section>`;
  });
  function pbForm(f, p) {
    f.id.value = p ? p.id : ''; f.name.value = p ? p.name : ''; f.url.value = p ? p.url : ''; f.secret.value = ''; f.secret.placeholder = p && p.signed ? 'Saved. Type a new one to change it.' : 'Adds X-VooSquare-Signature';
    f.active.checked = p ? p.active : true; f.product.value = p && p.products[0] ? p.products[0] : '';
    f.querySelectorAll('[name=ev]').forEach((c) => { c.checked = p ? p.events.includes(c.value) : EV_ON.includes(c.value); });
    f.querySelectorAll('[data-seg=method] button').forEach((b) => b.classList.toggle('on', b.dataset.v === (p ? p.method : 'GET')));
    document.querySelector('[data-pbbt]').textContent = p ? 'Edit postback' : 'Postback builder';
  }
  function wirePostbacks(pg) {
    const f = pg.querySelector('[data-pbf]');
    const body = () => ({ name: f.name.value.trim(), url: f.url.value.trim(), method: (f.querySelector('[data-seg=method] .on') || {}).dataset.v || 'GET', events: [...f.querySelectorAll('[name=ev]:checked')].map((c) => c.value), products: f.product.value ? [f.product.value] : [], active: f.active.checked, ...(f.secret.value ? { secret: f.secret.value } : {}) });
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); const err = f.querySelector('.err'); err.hidden = true;
      const id = f.id.value;
      try {
        f.querySelector('[type=submit]').disabled = true;
        await (id ? A.PUT('/api/aff/postbacks/' + id, body()) : A.POST('/api/aff/postbacks', body()));
        VS.toast('Postback saved'); A.route();
      } catch (x) { err.hidden = false; err.textContent = x.message; } finally { f.querySelector('[type=submit]').disabled = false; }
    });
    pg.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-macro]');
      if (m) { const inp = f.url; const p = inp.selectionStart ?? inp.value.length; inp.value = inp.value.slice(0, p) + m.dataset.macro + inp.value.slice(p); inp.focus(); inp.setSelectionRange(p + m.dataset.macro.length, p + m.dataset.macro.length); }
      if (e.target.closest('[data-addpb]')) { pbForm(f, null); pg.querySelector('[data-pbb]').scrollIntoView({ behavior: VS.reduce ? 'auto' : 'smooth' }); f.url.focus({ preventScroll: true }); }
      if (e.target.closest('[data-pbreset]')) pbForm(f, null);
      const ed = e.target.closest('[data-pbedit]');
      if (ed) { pbForm(f, S.cache.pb.postbacks.find((p) => String(p.id) === ed.dataset.pbedit)); pg.querySelector('[data-pbb]').scrollIntoView({ behavior: VS.reduce ? 'auto' : 'smooth' }); }
      const dl = e.target.closest('[data-pbdel]');
      if (dl && confirm('Delete this postback? Its delivery log stays.')) { if (await A.act(dl, () => A.DEL('/api/aff/postbacks/' + dl.dataset.pbdel), 'Postback deleted')) A.route(); }
      const t = e.target.closest('[data-pbtest]');
      if (t) {
        const res = pg.querySelector('[data-pbres]'); res.innerHTML = '<span class="pb-spin"></span>Sending a test qualified event…';
        pg.querySelector('[data-pbb]').scrollIntoView({ block: 'nearest' });
        try { const r = await A.POST(`/api/aff/postbacks/${t.dataset.pbtest}/test`, { event: 'qualified' }); res.innerHTML = `<span class="st ${r.ok ? 'st-g' : 'st-r'}">${r.ok ? icon('check') : ''}${r.code || 'Error'}</span><span>${esc(r.message)}${r.ms ? ` (${r.ms} ms)` : ''}</span>`; A.mount(res); }
        catch (x) { res.innerHTML = `<span class="st st-r">${esc(x.message)}</span>`; }
      }
      const rs = e.target.closest('[data-resend]');
      if (rs && await A.act(rs, () => A.POST(`/api/aff/postbacks/logs/${rs.dataset.resend}/resend`), 'Queued again. It is sent within a minute.')) rs.remove();
      const box = pg.querySelector('[data-tgstate]');
      const tgSet = (st) => { S.cache.tg = { ...S.cache.tg, ...st }; box.innerHTML = tgState(S.cache.tg); A.mount(box); };
      const c = e.target.closest('[data-tgconnect]');
      if (c) { const r = await A.act(c, () => A.POST('/api/aff/telegram/connect')); if (r) { if (!r.configured) tgSet({ configured: false }); else { tgSet({ link: r.link }); window.open(r.link, '_blank', 'noopener'); } } }
      if (e.target.closest('[data-tgcancel]')) tgSet({ link: '' });
      const ck = e.target.closest('[data-tgcheck]');
      if (ck) { const r = await A.act(ck, () => A.api('/api/aff/telegram')); if (r) { if (r.connected) { tgSet({ ...r, link: '' }); VS.toast('Telegram connected'); } else VS.toast('Not connected yet. Press Start in the bot, then try again.', 'err'); } }
      const off = e.target.closest('[data-tgoff]');
      if (off) { const r = await A.act(off, () => A.POST('/api/aff/telegram/disconnect'), 'Telegram disconnected'); if (r) tgSet({ ...r, link: '' }); }
      const tt = e.target.closest('[data-tgtest]');
      if (tt) await A.act(tt, () => A.POST('/api/aff/telegram/test'), 'Test alert sent. Check Telegram.');
    });
    pg.addEventListener('change', async (e) => {
      if (e.target.matches('[data-failonly]')) { const d = await A.api('/api/aff/postbacks' + (e.target.checked ? '?failed=1' : '')); const b = pg.querySelector('[data-logbox]'); b.innerHTML = d.logs.length ? `<table class="tbl" data-pblog><thead><tr><th>Time</th><th>Event</th><th>URL sent</th><th class="n">Response</th><th class="n">Time</th><th class="n">Attempt</th><th></th></tr></thead><tbody>${d.logs.map(logRow).join('')}</tbody></table>` : empty('check', e.target.checked ? 'No failed deliveries.' : 'Deliveries show here with the response code and time.'); A.mount(b); }
      const on = e.target.closest('[data-pbon]');
      if (on) { try { await A.PUT('/api/aff/postbacks/' + on.dataset.pbon, { active: on.checked }); VS.toast(on.checked ? 'Postback on' : 'Postback paused'); } catch (x) { on.checked = !on.checked; VS.toast(x.message, 'err'); } }
    });
    const tf = pg.querySelector('[data-tgprefs]');
    if (tf) tf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prefs = Object.fromEntries(ALERT_T.map(([k]) => [k, tf[k].checked]));
      await A.act(tf.querySelector('[type=submit]'), () => A.PUT('/api/aff/telegram/prefs', { prefs, quiet_from: tf.quiet_from.value, quiet_to: tf.quiet_to.value, tz: tf.tz.value }), 'Alert settings saved');
    });
  }

  /* ================= Creatives ================= */
  const AR = { '9:16': '9/16', '1:1': '1/1', '4:5': '4/5', '16:9': '16/9' };
  function creative(c, i) {
    const b = A.brand(c.product_key);
    const ar = AR[c.size] || '1/1';
    const img = c.image ? `<img src="${esc(c.image.thumb_url || c.image.url)}" alt="" loading="lazy" class="cr-img">` : '';
    const vid = /video|story/i.test(c.format || '');
    return `<article class="cr" data-p="${esc(c.product_key)}" data-f="${esc(c.size)}" data-l="${esc(c.language)}"><div class="cr-prev" style="--a:${b.a};--b:${b.b};--acc:${b.acc};--ink:${b.ink};aspect-ratio:${ar}">
      ${img || `<div class="crm crm-${i % 3}"><span class="crm-logo">${pi(c.product_key, 'xs')}<b>${esc(b.short || b.name)}</b></span><h4>${esc(c.title)}</h4>${vid ? `<i class="crm-play">${icon('play')}</i>` : ''}<span class="crm-ui"><i></i><i></i><i></i></span><span class="crm-cta">${c.product_key === 'premium' ? 'Join free' : 'Start free'}</span></div>`}
      ${c.early_access ? '<span class="cr-tag early">Early access</span>' : c.is_new ? '<span class="cr-tag new">New</span>' : ''}<span class="cr-fmt">${esc(c.size || c.format || '')}</span></div>
      <div class="cr-b"><b>${esc(c.title)}</b><small>${esc([b.short || b.name, c.format, c.language, c.platform].filter(Boolean).join(' · '))}</small>
      <div class="cr-a">${c.image || c.file_url ? `<a class="btn btn-k btn-xs" href="${esc(c.file_url || c.image.url)}" download target="_blank" rel="noopener" data-cruse="${c.id}" data-kind="download">${icon('download')}Download</a>` : ''}${c.copy_text ? `<button class="btn btn-w btn-xs" data-copy="${esc(c.copy_text)}" data-cruse="${c.id}" data-kind="copy">${icon('copy')}Copy post</button>` : ''}<button class="btn btn-ghost btn-xs" data-copy="${esc(c.link)}">${icon('link')}Copy link</button></div></div></article>`;
  }
  const SWIPE = {
    joinvoo: { hooks: ['Your Telegram ads are buying joins that never deposit.', 'Meta optimises for what you send it. Send it real joins.', 'I stopped guessing which ad brought my depositors.'], short: ['Joinvoo tracks every real Telegram join and sends it to Meta, TikTok and Snapchat. Start free: {your_link}', 'If you run ads to Telegram, this is the tracking you are missing. {your_link}'] },
    spyvoo: { hooks: ['The ad that ran for 128 days is the one to study.', 'Before you spend, see what is already working in your country.', 'Every hook, broken down.'], short: ['Spyvoo searches live Facebook and Instagram ads from every country. Start free: {your_link}', 'Find the long runners in Kenya before your next test. {your_link}'] },
    replyvoo: { hooks: ['Slow inboxes lose leads.', 'Every chat answered in seconds, with the payment link.'], short: ['Replyvoo answers your Telegram and website chats in seconds and sends the payment link. {your_link}'] },
  };
  PG.creatives = (arg) => {
    const tab = ['library', 'copy', 'landing', 'kit', 'rules'].includes(arg) ? arg : 'library';
    return shell('creatives', 'Creatives', async () => {
      let inner;
      if (tab === 'library') {
        const d = await A.api('/api/aff/creatives');
        const L = d.creatives; const langs = [...new Set(L.map((c) => c.language).filter(Boolean))]; const sizes = [...new Set(L.map((c) => c.size).filter(Boolean))]; const prods = [...new Set(L.map((c) => c.product_key).filter(Boolean))];
        A.then((pg) => crWire(pg));
        inner = L.length ? `<div class="cr-filters"><div class="chips" data-crf="p"><button class="on" data-v="">All products</button>${prods.map((k) => `<button data-v="${k}">${pi(k, 'xs')}${esc(A.brand(k).short || A.brand(k).name)}</button>`).join('')}</div>
          <div class="cr-f2"><div class="seg" data-crf="f" data-noseg><button class="on" data-v="">All sizes</button>${sizes.map((s) => `<button data-v="${esc(s)}">${esc(s)}</button>`).join('')}</div>
          <select class="inp inp-sm" data-crl aria-label="Language"><option value="">All languages</option>${langs.map((l) => `<option>${esc(l)}</option>`).join('')}</select></div></div>
          <p class="linknote">${icon('link')}Links built in. Copy post includes your tracking link, and each creative's link has sub1 set to <code>cr_{creative_id}</code>.</p>
          <div class="cr-grid" data-crgrid>${L.map(creative).join('')}</div><div data-crempty hidden>${empty('image', 'No creatives match these filters.', '', '<button class="btn btn-w btn-sm" data-crclear>Clear filters</button>')}</div>`
          : empty('image', 'Approved creatives appear here.', 'Our team uploads new ads, banners and videos every week. Pro sees them 48 hours early, Elite and up 7 days early.');
      } else if (tab === 'copy') {
        const lk = (await A.api('/api/aff/links')).deep_links;
        inner = `<div class="swipe">${Object.entries(SWIPE).map(([k, s]) => { const link = (lk.find((x) => x.product_key === k) || {}).url || me().link || ''; return `<section class="card"><div class="card-h">${pi(k, 'sm')}<h3>${esc(A.brand(k).name)}</h3><span class="r"><span class="sample">Your link filled</span></span></div>
          <h4 class="sw-h">Hooks</h4>${s.hooks.map((h) => `<div class="sw"><p>${esc(h)}</p><button class="btn btn-ghost btn-xs" data-copy="${esc(h)}" aria-label="Copy">${icon('copy')}</button></div>`).join('')}
          <h4 class="sw-h">Short posts</h4>${s.short.map((h) => { const t = h.replace('{your_link}', link); return `<div class="sw"><p>${esc(h).replace('{your_link}', `<code>${esc(link)}</code>`)}</p><button class="btn btn-ghost btn-xs" data-copy="${esc(t)}" aria-label="Copy">${icon('copy')}</button></div>`; }).join('')}</section>`; }).join('')}</div>
          <p class="muted sm">Add your own experience, and tell your audience you earn a commission.</p>`;
      } else if (tab === 'landing') {
        const lk = (await A.api('/api/aff/links')).deep_links;
        inner = `<div class="lp-grid">${lk.map((l) => { const b = A.brand(l.product_key); return `<article class="lp" style="--a:${b.a};--b:${b.b};--acc:${b.acc}"><div class="lp-prev"><span class="lp-bar"><i></i><i></i><i></i></span><div class="lp-hero">${pi(l.product_key, 'sm')}<i></i><i class="s"></i><b></b></div><div class="lp-rows"><i></i><i></i><i></i></div></div><div class="cr-b"><b>${esc(l.name)}</b><small>${esc(l.domain || b.domain)} · home and pricing</small><div class="cr-a"><a class="btn btn-k btn-xs" href="#/aff/links/${l.product_key}">Get link</a><a class="btn btn-w btn-xs" href="https://${esc(l.domain || b.domain)}" target="_blank" rel="noopener">Preview</a></div></div></article>`; }).join('')}</div>`;
      } else if (tab === 'kit') {
        const k = await A.api('/api/aff/brand-kit');
        inner = `<div class="kit">
          <section class="card"><div class="card-h"><h3>Logos</h3></div><div class="kit-logos">${k.logos.map((l, i) => `<a class="kl ${['kl-l', 'kl-d', 'kl-i'][i] || 'kl-l'}" href="${esc(l.url)}" download>${/svg$/.test(l.url) ? `<img src="${esc(l.url)}" alt="" width="56">` : `<img src="${esc(l.url)}" alt="" class="kl-png">`}<small>${esc(l.name)}</small></a>`).join('')}</div></section>
          <section class="card"><div class="card-h"><h3>Product icons</h3></div><div class="kit-icons">${k.product_icons.map((p) => `<a href="${esc(p.url)}" download>${pi(p.key, 'lg')}<small>${esc(A.brand(p.key).short || p.name)}</small></a>`).join('')}</div></section>
          <section class="card"><div class="card-h"><h3>Colours</h3></div><div class="kit-cols">${k.colours.map((c) => `<button data-copy="${esc(c.hex)}"><i style="background:${esc(c.hex)}"></i><b>${esc(c.name)}</b><code>${esc(c.hex)}</code></button>`).join('')}</div></section>
          <section class="card"><div class="card-h"><h3>Fonts</h3></div><div class="kit-fonts"><div><b class="kf-1">Plus Jakarta Sans</b><small>Headings 800, body 400 to 700</small></div><div><b class="kf-2 serif">Instrument Serif</b><small>Italic accents only</small></div></div></section></div>`;
      } else {
        const k = await A.api('/api/aff/brand-kit');
        inner = rules(k.do, k.dont);
      }
      return `<div class="ph"><div><h2>Creatives</h2><p>Approved ads, banners, videos and copy. Every copy button includes your tracking link.</p></div></div><nav class="tabs" aria-label="Creative sections">${[['library', 'Library'], ['copy', 'Copy and swipe files'], ['landing', 'Landing pages'], ['kit', 'Brand kit'], ['rules', 'Rules']].map(([k, l]) => `<a href="#/aff/creatives/${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>${inner}`;
    });
  };
  const rules = (dos, donts) => `<div class="dodont"><section class="card do"><h3>${icon('check')}Do</h3><ul>${(dos || ['Show what the tool does', 'Use real screenshots', 'Add your own experience']).concat(['Tell your audience you earn a commission']).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section>
    <section class="card dont"><h3>${icon('x')}Do not</h3><ul>${(donts || ['Change logos', 'Use our names in search ads', 'Promise income']).map((x) => `<li>${esc(x)}</li>`).join('')}</ul></section></div>
    <p class="muted sm">Trading and gambling audiences: follow the law and the ad platform's rules in every country you run.</p>`;
  function crWire(pg) {
    const filter = () => {
      const p = (pg.querySelector('[data-crf="p"] .on') || {}).dataset.v || '', f = (pg.querySelector('[data-crf="f"] .on') || {}).dataset.v || '', l = (pg.querySelector('[data-crl]') || {}).value || '';
      let n = 0;
      pg.querySelectorAll('[data-crgrid] .cr').forEach((c) => { const ok = (!p || c.dataset.p === p) && (!f || c.dataset.f === f) && (!l || c.dataset.l === l); c.hidden = !ok; if (ok) n++; });
      const e = pg.querySelector('[data-crempty]'); if (e) e.hidden = n > 0;
    };
    pg.addEventListener('click', (e) => {
      const f = e.target.closest('[data-crf] button');
      if (f) { f.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === f)); filter(); }
      if (e.target.closest('[data-crclear]')) { pg.querySelectorAll('[data-crf]').forEach((s) => s.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === 0))); pg.querySelector('[data-crl]').value = ''; filter(); }
      const u = e.target.closest('[data-cruse]');
      if (u) A.POST(`/api/aff/creatives/${u.dataset.cruse}/use`, { kind: u.dataset.kind }).catch(() => {});
    });
    const l = pg.querySelector('[data-crl]'); if (l) l.addEventListener('change', filter);
  }

  /* ================= Academy ================= */
  const SCHOOLS = [['Foundations', 'foundations', 'How the money works, traffic, numbers, funnels, tracking and compliance.', '#0A1611'], ['Operator', 'operator', 'Offers and verticals, Meta in depth, creatives that convert.', '#5B3FE8'], ['Scale', 'scale', 'Scaling mechanics, infrastructure and risk.', '#0FA3A3'], ['Vertical schools', '', 'Finance, iGaming, trading, nutra and sweeps.', '#E8A317']];
  const START = [
    ['How the program pays', (p) => `RevShare is a share of what your customers pay, for life: ${A.tiers().map((t) => `${t.n} ${fmt(t.rate)}%`).join(', ')}. Vooads and Replyvoo are capped at 35%. CPA and Hybrid deals are by approval, up to ${$c0((p && p.cpa_max_cents) || 30000)}, for unique first-time paying customers only.`],
    ['What counts as a qualified FTD', () => 'A new paying customer you referred, counted at their first payment (a purchase or credits used in a tool). No second payment and no waiting period. Tiers, contests, activation and your lifetime RevShare health count qualified FTDs straight away.'],
    ['Activation and lifetime RevShare health', (p) => { const h = (p && p.health) || {}; return `Your earnings activate after your first ${(p && p.activation_customers) ?? 5} qualified customers; until then they show as Waiting for activation. The first ${h.ramp_days || 90} days after activation are a ramp-up. Then ${h.threshold || 50} new qualified customers in any rolling ${h.window_days || 90} days keeps RevShare active. Below that you get ${h.grace_days || 30} days of grace before RevShare on existing customers pauses.`; }],
    ['Balance, refunds and payouts', (p) => `RevShare is automatic: commission on credits used and on purchases is Available the moment the payment lands. Credits that have been used are non-refundable, so that commission is final. Only a card chargeback or proven fraud can reverse it; a reversal you cannot cover shows as owed and comes off your next payout. CPA is available as soon as our team approves it. Request your available balance in USDT (TRC20) or BTC; the minimum is $${((((p && p.payout_methods) || []).find((m) => m.method === 'usdt_trc20') || {}).min_cents || 5000) / 100}. Every payout has a PDF receipt.`],
    ['The rules that get accounts closed', () => 'No income claims. No bidding on VooSquare, Zedapex or tool names. No pretending to be us. No incentivised or fake sign-ups, and no referring yourself or your household. Declare every traffic source in Settings before you use it.'],
  ];
  PG.academy = () => shell('academy', 'Academy', async () => {
    const done = !!(me().checklist || {}).start_here;
    return `<section class="acad-hero" data-io><div><h2>Affiliate Academy</h2><p>Start with the 10-minute lesson on how the program pays. Then go deeper in VooSquare Academy, with certificates at the end of each school.</p>
        <div class="ah-stats"><span><b>${done ? 1 : 0}</b> of 1 starter lesson</span><span><b>10 min</b> Start here: read it before your first payout</span></div><a class="btn btn-l" href="#/aff/lesson">${icon('play')}${done ? 'Review: Start here' : 'Start: How the program pays'}</a></div>
        <div class="ah-ring">${A.ring(done ? 1 : 0, 168, 14, '#C9F65B', 'rgba(255,255,255,.1)')}<span><b>${done ? 100 : 0}%</b><small>required</small></span></div></section>
      <div class="mods"><section class="mod${done ? ' full' : ''}" style="--h:#00A86B"><div class="mod-h"><span class="mod-n">0</span><div><b>Start here</b><small>${START.length} sections · 10 min · read before your first payout</small></div>${done ? `<span class="cert">${icon('star')}Done</span>` : `<span class="mod-p">0/1</span>`}</div>
        <div class="mod-bar"><i style="--p:${done ? 1 : 0}"></i></div><ol class="mod-l">${START.map(([t], j) => `<li class="${done ? 'done' : j === 0 ? 'next' : ''}"><a href="#/aff/lesson"><i>${done ? icon('check') : j === 0 ? icon('play') : j + 1}</i><span>${esc(t)}</span><small>2 min</small></a></li>`).join('')}</ol></section>
        ${SCHOOLS.map(([n, slug, d, hue], i) => `<section class="mod" style="--h:${hue}"><div class="mod-h"><span class="mod-n">${i + 1}</span><div><b>${esc(n)}</b><small>VooSquare Academy · free with your Voo ID</small></div><span class="mod-p">${icon('ext')}</span></div><p class="muted sm">${esc(d)}</p><a class="btn btn-w btn-sm" href="/app#${slug ? 'school/' + slug : 'academy'}">Open in VooSquare Academy</a></section>`).join('')}</div>`;
  });
  PG.lesson = () => shell('academy', 'Academy', async () => {
    const p = S.pub;
    const done = !!(me().checklist || {}).start_here;
    return `<div class="lesson"><a class="back" href="#/aff/academy">${icon('left')}Academy</a>
      <div class="ls-h"><span class="ls-n">Start here · 10 min</span><h2>How the VooSquare affiliate program pays</h2></div>
      <div class="ls-vis" data-io><div class="lv-funnel">${[['Clicks', 1000, '100%'], ['Sign-ups', 120, '12%'], ['First payments', 31, '3.1%'], ['Qualified FTDs', 22, '2.2%']].map((r, i) => `<div class="lv-r" style="--w:${[1, 0.72, 0.46, 0.24][i]};--i:${i}"><b>${r[0]}</b><span>${fmt(r[1])}</span><small>${r[2]}</small></div>`).join('')}</div><div class="lv-side"><small>An example funnel</small><b>Qualified</b><p>Tiers, contests and lifetime RevShare health count the last step: every new customer counts at their first payment.</p></div></div>
      <div class="ls-b">${START.map(([t, f]) => `<h3>${esc(t)}</h3><p>${esc(f(p))}</p>`).join('')}
        <div class="ls-tip">${icon('shield')}<span><b>Stay compliant.</b> Talk about what the tools do. Do not promise profits from trading, betting or ads, and follow the ad platform's rules in every country you run.</span></div>
        <h3>Quick check</h3><div class="quiz" data-quiz><p>When does a customer count as a qualified FTD?</p>${['When they sign up', 'At their first payment', 'When they click your link'].map((o, i) => `<button data-q="${i === 1 ? 1 : 0}">${o}</button>`).join('')}</div></div>
      <div class="ls-f"><a class="btn btn-ghost" href="#/aff/academy">${icon('left')}Back</a>${done ? `<a class="btn btn-g" href="#/aff/academy">${icon('check')}Done</a>` : `<button class="btn btn-g" data-lessondone>Mark done${icon('arrow')}</button>`}</div></div>`;
  });
  document.addEventListener('click', async (e) => {
    const q = e.target.closest('[data-q]');
    if (q) { q.parentElement.querySelectorAll('button').forEach((b) => b.classList.remove('ok', 'no')); q.classList.add(q.dataset.q === '1' ? 'ok' : 'no'); VS.toast(q.dataset.q === '1' ? 'Correct.' : 'Not quite. Try again.', q.dataset.q === '1' ? 'ok' : 'err'); }
    const d = e.target.closest('[data-lessondone]');
    if (d && await A.act(d, () => A.POST('/api/aff/checklist', { item: 'start_here' }), 'Lesson done. Start here is ticked.')) { await A.refreshMe(); location.hash = '#/aff/academy'; }
  });

  /* ================= Contests ================= */
  const CTAB = [['live', 'Live'], ['upcoming', 'Upcoming'], ['completed', 'Completed']];
  const tabOf = (c) => (['live', 'qualifying'].includes(c.status) ? 'live' : c.status === 'upcoming' ? 'upcoming' : 'completed');
  const prizeTxt = (p) => (p.rank_from === p.rank_to ? `${ord(p.rank_from)}` : `${ord(p.rank_from)} to ${ord(p.rank_to)}`);
  const ord = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');
  const boardRow = (r, i) => `<div class="lbr${r.me ? ' me' : ''}${r.disqualified ? ' dq' : ''}" style="--i:${i}"><span class="lbr-n">${r.rank || '–'}</span>${face(A.avOf(r.avatar, r.name), 'sm')}<b>${esc(r.name)}${r.me ? ' <em>You</em>' : ''}</b><span class="flag" title="${esc(A.cname(r.country))}" aria-label="${esc(A.cname(r.country))}">${A.flag(r.country)}</span>${tierBadge(r.tier, 'sm')}<span class="lbr-s">${fmt(r.score, r.score % 1 ? 1 : 0)}</span><span class="lbr-t">${r.disqualified ? 'Removed' : r.provisional ? 'Provisional' : 'Final'}${r.movement ? ` <i class="mv ${r.movement > 0 ? 'up' : 'dn'}">${r.movement > 0 ? '▲' : '▼'}${Math.abs(r.movement)}</i>` : ''}</span></div>`;
  function contestCard(c) {
    const th = c.theme || {}; const acc = th.accent || '#C9F65B';
    return `<article class="ccard ccard-${tabOf(c)}" style="--cacc:${esc(acc)}">${c.banner ? `<img class="cc-img" src="${esc(c.banner.url)}" alt="">` : `<div class="cc-art" aria-hidden="true">${[3, 8, 12, 5].map((i, j) => `<span style="--j:${j}">${face(A.faceN(i), 'md')}</span>`).join('')}<i class="cc-trophy">${icon('trophy')}</i></div>`}
      <div class="cc-b"><span class="ct-live">${c.status === 'live' ? '<i class="live-dot"></i>Live' : c.status === 'upcoming' ? `Starts ${A.ds(c.starts_at)}` : statusPill(c.status)}</span><h3>${esc(c.title)}</h3><p class="muted sm">${A.dt(c.starts_at)} to ${A.dt(c.ends_at)}</p>${c.description ? `<p>${esc(c.description)}</p>` : ''}
        <div class="up-f"><span>Prize pool <b>${$c0(c.pool_cents)}</b></span>${c.me && c.me.rank ? `<span>You are <b>#${c.me.rank}</b></span>` : ''}<a class="btn btn-w btn-xs" href="#/aff/contests/${c.id}">${c.status === 'upcoming' ? 'Rules' : 'Leaderboard'}</a></div>
        ${c.winners && c.winners.length ? `<div class="cc-win">${c.winners.slice(0, 3).map((w) => `<span>${ord(w.rank)} ${esc(w.name)} ${A.flag(w.country)} · ${$c0(w.amount_cents)}</span>`).join('')}</div>` : ''}</div></article>`;
  }
  PG.contests = (arg) => shell('contests', 'Contests', async () => {
    const d = await A.api('/api/aff/contests');
    const L = d.contests || [];
    const id = Number(arg) || 0; const tab = CTAB.some((t) => t[0] === arg) ? arg : '';
    const focus = id ? L.find((c) => c.id === id) : !tab ? L.find((c) => tabOf(c) === 'live') : null;
    let detail = '';
    if (focus) {
      const det = await A.api(`/api/aff/contests/${focus.id}?limit=50`);
      const c = det.contest; const mine = det.me; const board = det.board || [];
      if (mine && mine.rank) S.cache.rank = mine.rank;
      const sc = c.scoring || {};
      A.then((pg) => A.countdowns(pg));
      detail = `<section class="ct-hero" data-io${c.banner ? ` style="--ctimg:url('${esc(c.banner.url)}')"` : ''}><div class="ct-l"><span class="ct-live">${c.status === 'live' ? '<i class="live-dot"></i>Live' : esc((A.statusPill(c.status).match(/>([^<]+)</) || [])[1] || c.status)} · ${A.dt(c.starts_at)} to ${A.dt(c.ends_at)}</span><h2>${esc(c.title)}</h2><p>${esc(c.description || `${sc.points || 1} point per qualified FTD.`)}${c.min_points ? ` Minimum to place: ${c.min_points} point${c.min_points === 1 ? '' : 's'}.` : ''}</p>
          ${c.status === 'live' || c.status === 'upcoming' ? `<div class="ct-cd" data-countdown="${c.status === 'upcoming' ? c.starts_at : c.ends_at}"></div>` : ''}
          <div class="ct-me"><div><small>Your rank</small><b>${mine && mine.rank ? '#' + mine.rank : '–'}</b></div><div><small>Your score</small><b>${mine ? fmt(mine.score, mine.score % 1 ? 1 : 0) : '0'}</b></div><div><small>Prize pool</small><b>${$c0(c.pool_cents)}</b></div></div>
          <p class="ct-gap">${isPend() ? 'You join contests once approved.' : mine && mine.gap_to_next ? `${fmt(mine.gap_to_next, 1)} points behind #${mine.rank - 1}.` : mine && mine.rank === 1 ? 'You are in first place.' : `${det.entrants} affiliates on the board.`}</p><div class="lb-act"><a class="btn btn-l btn-sm" href="#ct-rules" data-rules>Rules</a><a class="btn hero-b2 btn-sm" href="#/aff/links">Get a link</a></div></div>
        <div class="ct-r">${A.podium(board.slice(0, 3).map((r) => ({ name: r.name, score: r.score, avatar: r.avatar, country: r.country })))}</div></section>
        <div class="g-2-1"><section class="card"><div class="card-h"><h3>Leaderboard</h3><span class="sub">${c.status === 'completed' ? 'Final results.' : c.status === 'live' ? 'Live scores. Every customer counts at their first payment. Customers who charge back or fail checks are removed.' : c.status === 'qualifying' ? `Scores are final on ${A.dt(c.results_at)}.` : 'Final scores. Winners are announced once our team signs the results off.'}</span></div>
          ${board.length ? `<div class="lbd">${board.map(boardRow).join('')}${mine && mine.rank && !board.some((r) => r.me) ? `<div class="lbd-gap">…</div>${boardRow(mine, board.length)}` : ''}</div>` : empty('trophy', c.status === 'upcoming' ? 'The board opens when the contest starts.' : 'No scores yet. The first qualified FTD puts you on the board.')}</section>
          <div class="stack"><section class="card"><div class="card-h"><h3>Prizes</h3></div>${(c.prizes || []).length ? `<div class="prz">${c.prizes.map((p) => `<div><span>${esc(p.label || prizeTxt(p))}</span><b>${$c0(p.amount_cents)}${p.rank_to > p.rank_from ? ' each' : ''}</b></div>`).join('')}${c.rising && c.rising.amount_cents ? `<div><span>Rising prize</span><b>${$c0(c.rising.amount_cents)}</b></div>` : ''}</div>` : '<p class="muted sm">Prizes are announced with the contest.</p>'}
            ${c.milestone && c.milestone.amount_cents ? `<p class="muted sm">Milestone bonus ${$c0(c.milestone.amount_cents)} at ${c.milestone.points} points.</p>` : ''}</section>
            <section class="card" id="ct-rules"><div class="card-h"><h3>Rules</h3></div><div class="acc acc-sm">${[['Eligibility', 'Approved affiliates in good standing at start and end. Staff and their households excluded. One account per person or company.' + (c.eligibility && c.eligibility.min_tier ? ` Minimum tier: ${A.tiers()[c.eligibility.min_tier] ? A.tiers()[c.eligibility.min_tier].n : ''}.` : '')], ['Scoring', `Qualified FTDs from customers whose Voo ID was created inside the contest period. ${sc.points || 1} point each${(sc.plan_points || []).length ? `; plans from ${$c0(sc.plan_points[0].min_price_cents)} score ${sc.plan_points[0].points}` : ''}. A customer counts once, at their first payment. Scores are final when the contest ends${c.qual_days ? ` plus ${c.qual_days} days` : ''}.`], ['Multipliers', c.multipliers ? 'Tier multipliers apply to the main board: Pro x1.05 up to Senior Partner and Legend x1.25.' : 'No tier multipliers in this contest.'], ['Tie-break', 'Higher net revenue from contest customers, then earlier time of reaching the score.'], ['Anti-fraud', 'Any customer declined for fraud signals, blocked or charged back is removed. 3 or more removed, or a chargeback rate on contest customers over 15%, disqualifies the affiliate. Results are signed off by two staff.'], ['Prize payout', 'Added to your Available balance as soon as the results are signed off, then normal payout rules.'], ...(c.rules ? [['More', c.rules]] : [])].map(([q, a]) => `<div class="acc-i"><button data-acc aria-expanded="false"><span>${esc(q)}</span><i>${icon('plus')}</i></button><div class="acc-b"><p>${esc(a)}</p></div></div>`).join('')}</div></section></div></div>`;
    }
    const t = tab || (focus ? '' : 'live');
    const shown = t ? L.filter((c) => tabOf(c) === t) : L.filter((c) => c.id !== (focus && focus.id));
    return `${detail || `<div class="ph"><div><h2>Contests</h2><p>Monthly races and seasonal challenges, scored on qualified FTDs.</p></div></div>`}
      <nav class="tabs ct-tabs" aria-label="Contests">${CTAB.map(([k, l]) => `<a href="#/aff/contests/${k}" class="${k === t ? 'on' : ''}">${l} <i class="tc">${L.filter((c) => tabOf(c) === k).length}</i></a>`).join('')}</nav>
      ${shown.length ? `<div class="cc-grid">${shown.map(contestCard).join('')}</div>` : empty('trophy', t === 'completed' ? 'Past winners appear here after the first contest ends.' : t === 'upcoming' ? 'No contest announced yet.' : focus ? 'No other contests right now.' : 'No live contest right now.', 'New contests are announced here and in Telegram.')}`;
  });
  document.addEventListener('click', (e) => { const r = e.target.closest('[data-rules]'); if (r) { e.preventDefault(); const x = document.getElementById('ct-rules'); if (x) x.scrollIntoView({ behavior: VS.reduce ? 'auto' : 'smooth', block: 'center' }); } });

  /* ================= Payouts ================= */
  const BLOCK = { not_approved: 'Payouts open after approval.', paused: 'Your account is paused.', open_request: 'You have a request open.', below_minimum: 'Below the minimum.', no_wallet: 'Add a payout address first.', kyc_required: 'Verify your identity first.', terms_update: 'Accept the updated affiliate terms to request a payout. Your earnings keep counting meanwhile.' };
  const PSTEPS = [['requested', 'Requested'], ['approved', 'Approved'], ['processing', 'Sending'], ['paid', 'Paid']];
  function timeline(p) {
    const at = { requested: p.requested_at, approved: p.approved_at, processing: p.processing_at, paid: p.paid_at };
    const idx = p.status === 'paid' ? 3 : p.status === 'processing' ? 2 : p.status === 'approved' ? 1 : 0;
    if (['rejected', 'cancelled', 'held'].includes(p.status)) return `<div class="rq-tl"><div class="on"><i></i><b>${A.ds(p.requested_at)}</b><small>Requested</small></div><div class="on bad"><i></i><b>${statusPill(p.status, p.status_label)}</b><small>${esc(p.reason || p.hold_reason || '')}</small></div></div>`;
    return `<div class="rq-tl">${PSTEPS.map(([k, l], i) => `<div class="${i <= idx ? 'on' : ''}"><i></i><b>${at[k] ? A.ds(at[k]) : i === 3 && p.sla_due_at ? 'By ' + A.ds(p.sla_due_at) : '–'}</b><small>${l}</small></div>`).join('')}</div>`;
  }
  const histTable = (L) => (L.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Requested</th><th class="n">Amount</th><th>Method</th><th>Status</th><th>Transaction</th><th>Receipt</th></tr></thead><tbody>${L.map((r) => `<tr><td>${A.dt(r.requested_at)}</td><td class="n b">${$c(r.amount_cents)}${r.fee_cents ? `<small class="muted"> −${$c(r.fee_cents)} fee</small>` : ''}</td><td>${esc(r.method_label)}<small class="muted mono"> ${esc(r.wallet_masked)}</small></td><td>${statusPill(r.status, r.status_label)}${r.reason ? `<small class="muted"> ${esc(r.reason)}</small>` : ''}</td><td>${r.tx_hash ? `<a class="tx" href="${esc(r.explorer_url || '#')}" target="_blank" rel="noopener"><code>${esc(r.tx_hash.slice(0, 6))}…${esc(r.tx_hash.slice(-4))}</code>${icon('ext')}</a>` : '–'}</td><td>${r.receipt_url ? `<button class="btn btn-w btn-xs" data-dl="${esc(r.receipt_url)}" data-name="voosquare-receipt-${esc(r.receipt_no)}.pdf">${icon('download')}PDF</button>` : '–'}</td></tr>`).join('')}</tbody></table></div>` : empty('wallet', 'No payouts yet. Request one when your available balance reaches the minimum.'));
  async function payTab(tab) {
    if (tab === 'ledger') {
      const d = await A.api('/api/aff/ledger?limit=200');
      return d.rows.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Date</th><th>Customer</th><th>Product</th><th>Type</th><th class="n">Amount</th><th>Status</th><th>Release</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td>${A.ds(r.at)}</td><td>${r.customer_ref ? `<code>${esc(r.customer_ref)}</code>` : '–'}</td><td>${r.product_key ? `<span class="tp">${pi(r.product_key, 'xs')}${esc(A.brand(r.product_key).short || A.brand(r.product_key).name)}</span>` : '–'}</td><td>${r.special ? A.sdTag(r, true) + ' ' : ''}${esc(r.type_label)}${r.reason_text ? `<small class="muted"> · ${esc(r.reason_text)}</small>` : r.reason ? `<small class="muted"> · ${esc(r.reason)}</small>` : ''}</td><td class="n b ${r.amount_cents < 0 ? 'neg' : ''}">${$c(r.amount_cents)}</td><td>${statusPill(r.status, r.status_label)}</td><td>${r.release_at ? A.ds(r.release_at) : '–'}</td></tr>`).join('')}</tbody></table></div>` : empty('list', 'Every commission, reversal and adjustment shows here.');
    }
    if (tab === 'receipts') {
      const d = await A.api('/api/aff/receipts');
      return d.receipts.length ? `<p class="muted sm">A PDF receipt for every paid payout, with the transaction hash and line items.</p><div class="inv">${d.receipts.map((r) => `<div class="inv-r"><span class="inv-ic">${icon('receipt')}</span><b>${esc(r.receipt_no)}</b><span>${$c(r.amount_cents)} · ${A.dt(r.issued_at)} · ${esc(r.method === 'btc' ? 'BTC' : 'USDT (TRC20)')}</span><button class="btn btn-w btn-xs" data-dl="${esc(r.url)}" data-name="voosquare-receipt-${esc(r.receipt_no)}.pdf">${icon('download')}PDF</button></div>`).join('')}</div>` : empty('receipt', 'Receipts appear here when a payout is paid.', 'Each one has the transaction hash, period and line items.');
    }
    if (tab === 'statements') {
      const d = await A.api('/api/aff/statements');
      return `<p class="muted sm">A monthly statement of every earning, reversal and payout. Use it for your own records and taxes.</p><div class="inv">${d.months.map((m) => `<div class="inv-r"><span class="inv-ic">${icon('download')}</span><b>${A.monthLabel(m.month)}</b><span></span><button class="btn btn-w btn-xs" data-dl="${esc(m.pdf)}" data-name="voosquare-statement-${esc(m.month)}.pdf">PDF</button></div>`).join('')}</div>`;
    }
    return histTable(S.cache.pay.history);
  }
  PG.payouts = (arg) => {
    const tab = ['history', 'receipts', 'ledger', 'statements'].includes(arg) ? arg : 'history';
    return shell('payouts', 'Payouts', async () => {
      const d = await A.api('/api/aff/payouts'); S.cache.pay = d;
      const b = d.balance; const p = isPend();
      const wait = b.hold_cents + b.pending_activation_cents;
      const states = [['clock', b.hold_cents > 0 ? 'On hold' : 'Waiting', wait, b.hold_cents > 0 ? `${$c(b.hold_cents)} on hold until it clears${b.pending_activation_cents ? `, plus ${$c(b.pending_activation_cents)} waiting for activation` : ''}.` : b.pending_activation_cents ? 'Waiting for activation. It all becomes available at your 5th qualified customer.' : 'Nothing waiting. New commissions are available instantly.'], ['wallet', 'Available', b.available_cents, b.owed_cents ? `You owe ${$c(b.owed_cents)} from reversals; it comes off your next earnings.` : 'Ready to withdraw.'], ['send', 'Requested', b.requested_cents, 'With our finance team.'], ['check', 'Paid', b.paid_cents, 'Sent to your wallet, with the transaction hash.']];
      const meth = d.methods.find((m) => m.method === d.method) || d.methods[0] || { label: 'USDT (TRC20)', min_cents: 5000 };
      const wallet = d.method === 'btc' ? d.wallets.btc : d.wallets.usdt_trc20;
      const open = d.open;
      const tabsInner = await payTab(tab);
      const kyc = d.kyc || {};
      return `<div class="ph"><div><h2>Payouts</h2><p>Request your available balance in USDT (TRC20) or BTC. ${p ? '' : `At your tier we send within ${d.payout_days} business day${d.payout_days === 1 ? '' : 's'}.`}</p></div></div>
        <div class="pst">${states.map((s, i) => `<div class="pst-c${i === 1 ? ' hi' : ''}"><span class="pst-ic">${icon(s[0])}</span><small>${s[1]}</small><b>${A.cntc(s[2])}</b><p>${esc(s[3])}</p></div>`).join('')}</div>
        ${p ? `<section class="card pclosed"><span>${icon('lock')}</span><div><b>Payouts open after approval.</b><p class="muted">Add your USDT (TRC20) address now so your first payout is one tap.</p></div><a class="btn btn-w btn-sm" href="#/aff/settings/payout">${wallet ? 'Change payout address' : 'Add payout address'}</a></section>`
          : `<section class="card preq"><div class="preq-l"><small>${b.next_release ? 'Next release' : 'Instant earnings'}</small><b>${b.next_release ? `${$c(b.next_release.amount_cents)} becomes available on ${A.ds(b.next_release.at)}.` : 'Commissions land in Available the moment they are earned.'}</b>${open ? `<div class="preq-tl">${timeline(open)}</div>` : `<p class="muted sm">${d.blocked_by.filter((x) => x !== 'open_request').map((x) => esc(BLOCK[x] || x)).join(' ')}${d.blocked_by.includes('below_minimum') ? ` ${$c(d.gap_cents)} more to reach the ${$c0(meth.min_cents)} minimum.` : ''}</p>`}</div>
          <div class="preq-r">${open ? `<div class="preq-open">${statusPill(open.status, open.status_label)}<b>${$c(open.amount_cents)} in ${esc(open.method_label)}</b><p class="muted sm">Requested ${A.dtm(open.requested_at)}. We send by ${A.ds(open.sla_due_at)}. Your address is locked while a request is open.</p>${open.status === 'requested' ? `<button class="btn btn-w btn-sm" data-cancelreq="${open.id}">Cancel request</button>` : ''}</div>`
            : `<b class="preq-amt">${$c(Math.max(0, b.available_cents))}</b><small>available to withdraw</small><button class="btn btn-l btn-block" data-reqpay ${d.can_request ? '' : 'disabled'}>${icon('wallet')}Request payout</button><small class="muted">Minimum ${$c0(meth.min_cents)}. One open request at a time.${d.blocked_by.includes('no_wallet') ? ' <a class="lnk" href="#/aff/settings/payout">Add an address</a>' : ''}${d.blocked_by.includes('kyc_required') ? ' <a class="lnk" href="#kyc">Verify your identity</a>' : ''}${d.blocked_by.includes('terms_update') ? ' <button class="lnk" type="button" data-terms-review>Review and accept the updated terms</button>' : ''}</small>`}</div></section>`}
        <section class="card sla"><div class="card-h"><h3>When your money arrives</h3><span class="sub">Business days after your request, by tier</span></div><div class="sla-l">${slaRows()}</div></section>
        <nav class="tabs" aria-label="Payout sections">${[['history', 'History'], ['receipts', 'Receipts'], ['ledger', 'Earnings ledger'], ['statements', 'Statements']].map(([k, l]) => `<a href="#/aff/payouts/${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
        <section class="card">${tabsInner}</section>
        <section class="card kyc" id="kyc"><span class="kyc-ic">${icon('id')}</span><div><b>${kyc.status === 'verified' ? 'Identity verified' : kyc.status === 'pending' ? 'Identity check in review' : kyc.status === 'rejected' ? 'Identity check not passed' : 'Identity check'}</b><p class="muted sm">${kyc.status === 'verified' ? `Verified on ${A.dt(kyc.updated_at)}. Large payouts are approved by one finance user and sent by another.` : kyc.status === 'pending' ? 'We are reviewing your documents. You get an alert when it is done.' : kyc.status === 'rejected' ? esc(kyc.reason || 'Try again with clear photos.') : 'We confirm who you are before your first payout. It takes about 5 minutes.'}</p></div>${kyc.status === 'verified' ? statusPill('verified') : kyc.status === 'pending' ? statusPill('pending', 'In review') : `<button class="btn btn-w btn-sm" data-kyc>${kyc.status === 'rejected' ? 'Try again' : 'Start verification'}</button>`}</section>`;
    });
  };
  function slaRows() {
    const T = A.tiers(); const groups = {};
    T.forEach((t) => { const k = t.payout_days || 3; (groups[k] = groups[k] || []).push(t); });
    const myIdx = (me().tier || {}).idx;
    return Object.entries(groups).sort((a, b) => b[0] - a[0]).map(([d, ts]) => { const mine = !isPend() && ts.some((t) => t.i === myIdx); return `<div class="sla-r${mine ? ' me' : ''}"><b>${ts.length > 1 ? `${esc(ts[0].n)} to ${esc(ts[ts.length - 1].n)}` : esc(ts[0].n)}</b><span class="sla-d">${Array.from({ length: 3 }, (_, j) => `<i class="${j < d ? 'on' : ''}"></i>`).join('')}</span><span>${d} business day${d > 1 ? 's' : ''}</span>${mine ? '<em>You</em>' : ''}</div>`; }).join('');
  }
  function requestSheet() {
    const d = S.cache.pay; const b = d.balance;
    const s = A.sheet(`<div class="rq">${A.mHead('Request payout', `We send within ${d.payout_days} business day${d.payout_days === 1 ? '' : 's'} at your tier.`)}<div class="rq-b">
      <div class="rq-amt"><small>Amount</small><b>${$c(b.available_cents)}</b><span>Your full available balance</span></div>
      <div class="field"><span class="lbl">Method</span><div class="paym" role="radiogroup">${d.methods.map((m) => { const w = m.method === 'btc' ? d.wallets.btc : d.wallets.usdt_trc20; return `<label class="paym-o ${m.method === d.method ? 'on' : ''}"><input type="radio" name="rqm" value="${m.method}" ${m.method === d.method ? 'checked' : ''} ${w ? '' : 'disabled'}><i class="${m.method === 'btc' ? 'cm-btc' : 'cm-usdt'}">${m.method === 'btc' ? '₿' : '₮'}</i><span><b>${esc(m.label)}</b><small>${w ? esc(w) : 'No address saved'} · ${m.fee === 'covered' ? 'network fee covered' : m.fee_cents > 0 ? `fee about ${$c(m.fee_cents)}, deducted` : 'network fee deducted, shown before you confirm'} · min ${$c0(m.min_cents)}</small></span></label>`; }).join('')}</div></div>
      <div class="rq-tl"><div class="on"><i></i><b>Today</b><small>Request received</small></div><div><i></i><b>Next</b><small>Finance approves and sends</small></div><div><i></i><b>By day ${d.payout_days}</b><small>In your wallet with tx hash and PDF receipt</small></div></div>
      <p class="muted sm">One open request at a time. You can cancel while it says Requested. Your address is locked while a request is open.</p>
      <button class="btn btn-l btn-block" data-confirmreq>Request ${$c(b.available_cents)}</button></div></div>`, 'sheet-right');
    s.el.addEventListener('click', async (e) => {
      const c = e.target.closest('[data-confirmreq]'); if (!c) return;
      const method = (s.el.querySelector('[name=rqm]:checked') || {}).value;
      const r = await A.act(c, () => A.POST('/api/aff/payouts', { method }), (x) => `Payout request received: ${$c(x.payout.amount_cents)} in ${x.payout.method_label}`);
      if (r) { s.close(); location.hash = '#/aff/payouts'; A.route(); }
    });
  }
  async function kycFlow(btn) {
    const r = await A.act(btn, () => A.POST('/api/aff/kyc/start'));
    if (!r) return;
    if (r.mode === 'provider') { window.open(r.url, '_blank', 'noopener'); VS.toast('Verification opened in a new tab.'); return; }
    const LBL = { id_front: 'ID, front', id_back: 'ID, back', selfie: 'Selfie holding your ID', proof_of_address: 'Proof of address', company: 'Company registration' };
    const m = A.modal(`${A.mHead('Verify your identity', 'Photos stay private: only our finance team sees them. See the <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.')}<form class="vs-modal-b" data-kycf><div class="kyc-docs">${r.doc_types.filter((t) => t !== 'company' || me().kind === 'company').map((t) => `<label class="kyc-d"><input type="file" accept="image/*" data-doc="${t}" hidden><span class="kyc-dic">${icon(t === 'selfie' ? 'user' : 'id')}</span><b>${LBL[t] || t}</b><small data-st>${t === 'id_front' || t === 'selfie' ? 'Required' : 'Optional'}</small></label>`).join('')}</div><p class="err" hidden></p><button class="btn btn-g" type="submit">Send for review</button></form>`);
    const up = {};
    m.el.addEventListener('change', async (e) => {
      const inp = e.target.closest('[data-doc]'); if (!inp || !inp.files[0]) return;
      const st = inp.parentElement.querySelector('[data-st]'); st.textContent = 'Uploading…';
      try { const prep = await window.VSM.prepare(inp.files[0]); const u = await window.VSM.upload(prep, 'kyc').promise; up[inp.dataset.doc] = u.id; st.textContent = 'Added'; inp.parentElement.classList.add('ok'); }
      catch (x) { st.textContent = x.message; }
    });
    m.el.querySelector('form').addEventListener('submit', async (e) => {
      e.preventDefault(); const err = m.el.querySelector('.err');
      if (!up.id_front || !up.selfie) { err.hidden = false; err.textContent = 'Add the front of your ID and a selfie.'; return; }
      const ok = await A.act(e.target.querySelector('[type=submit]'), () => A.POST('/api/aff/kyc/documents', { documents: Object.entries(up).map(([doc_type, upload_id]) => ({ doc_type, upload_id })) }), 'Sent. We review it within 1 business day.');
      if (ok) { m.close(); A.route(); }
    });
  }
  document.addEventListener('click', async (e) => {
    const r = e.target.closest('[data-reqpay]');
    if (r) { e.preventDefault(); if (isPend()) return; if (!S.cache.pay || location.hash.indexOf('#/aff/payouts') !== 0) { location.hash = '#/aff/payouts'; return; } requestSheet(); }
    const c = e.target.closest('[data-cancelreq]');
    if (c && await A.act(c, () => A.POST(`/api/aff/payouts/${c.dataset.cancelreq}/cancel`), 'Request cancelled. The amount is back in your available balance.')) A.route();
    const k = e.target.closest('[data-kyc]');
    if (k) kycFlow(k);
  });

  /* ================= Sub-affiliates ================= */
  PG.subs = () => shell('subs', 'Sub-affiliates', async () => {
    const d = await A.api('/api/aff/subs');
    const s = (S.pub && S.pub.subs) || {};
    const boostP = d.boost.need_subs ? Math.min(1, d.boost.have / d.boost.need_subs) : 0;
    const boosted = d.rate_bp >= d.boosted_rate_bp && d.eligible;
    return `<div class="ph"><div><h2>Sub-affiliates</h2><p>Invite other affiliates. You earn a share of the commission we pay them, paid by Zedapex and never taken from theirs. One level only.</p></div></div>
      ${!d.enabled ? `<section class="card pclosed"><span>${icon('clock')}</span><div><b>The sub-affiliate program opens soon.</b><p class="muted">You will earn ${pct(s.rate_bp || d.base_rate_bp)} of what your sub-affiliates earn, ${pct(d.boosted_rate_bp)} with ${d.boost.need_subs} active subs. Your recruit link is ready below.</p></div></section>` : !d.eligible ? `<section class="card pclosed"><span>${icon('lock')}</span><div><b>You earn from sub-affiliates while your account is approved and lifetime RevShare is active.</b><p class="muted">Invite now; their commission share starts as soon as you qualify.</p></div></section>` : ''}
      <div class="g-2-1"><section class="card subs-hero" data-io><div class="sh-rate"><small>Your rate</small><b>${pct(d.eligible ? d.rate_bp : d.base_rate_bp)}</b><span>of your subs' approved commission${boosted ? ' · boosted' : ''}</span></div>
          <div class="sh-prog"><div class="sh-pt"><b>${d.boost.have} of ${d.boost.need_subs}</b><span>active subs with ${d.boost.need_customers_each}+ qualified paying customers each</span></div><div class="hl-bar"><i style="--p:${Math.max(0.02, boostP).toFixed(3)}"></i><span class="hl-th" style="--t:1"><em>${pct(d.boosted_rate_bp)}</em></span></div><p class="muted sm">${boosted ? 'You earn the boosted rate.' : `${Math.max(0, d.boost.need_subs - d.boost.have)} more active subs move you from ${pct(d.base_rate_bp)} to ${pct(d.boosted_rate_bp)}.`}</p></div>
          <div class="lb-out"><code>${esc(d.recruit_link)}</code><button class="btn btn-k btn-sm" data-copy="${esc(d.recruit_link)}">${icon('copy')}Copy</button></div><p class="muted sm">Your sub-affiliate code: <code>${esc(d.sub_code || '')}</code></p></section>
        <section class="card"><div class="card-h"><h3>Earned from your network</h3></div><div class="sumrow one"><div><small>Total</small><b>${A.cntc(d.total_earned_cents)}</b></div><div><small>Sub-affiliates</small><b>${fmt(d.subs.length)}</b></div><div><small>Active</small><b>${fmt(d.boost.have)}</b></div></div></section></div>
      <section class="card"><div class="card-h"><h3>Your network</h3><span class="sub">Their customers stay private; you see counts and your share.</span></div>${d.subs.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Affiliate</th><th>Country</th><th>Status</th><th>Tier</th><th class="n">Paying customers</th><th class="n">Qualified</th><th>Counts toward boost</th><th class="n">Your earnings</th><th>Joined</th></tr></thead><tbody>${d.subs.map((x) => `<tr><td><span class="tp">${face(A.faceN(A.hashStr(x.ref) % 40), 'sm')}<span><b>${esc(x.name || x.ref)}</b><small>${esc(x.ref)}</small></span></span></td><td>${x.country ? A.flag(x.country) + ' ' + esc(x.country) : '–'}</td><td>${statusPill(x.status === 'approved' ? 'active' : x.status)}</td><td>${tierBadge(x.tier, 'sm')}</td><td class="n">${fmt(x.paying_customers)}</td><td class="n">${fmt(x.qualified_customers)}</td><td>${x.active ? statusPill('active', 'Yes') : '<span class="muted sm">Not yet</span>'}</td><td class="n b">${$c(x.your_earnings_cents)}</td><td>${A.ds(x.joined_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('network', 'No sub-affiliates yet.', 'Share your recruit link with media buyers and creators you know.')}</section>`;
  });

  /* ================= Manager ================= */
  PG.manager = () => shell('manager', 'Manager', async () => {
    const d = await A.api('/api/aff/manager');
    const cur = d.private || d.general;
    const tg = (h) => (h ? `https://t.me/${String(h).replace(/^@/, '')}` : '');
    const msgs = d.notes.slice().reverse();
    A.then((pg) => { const l = pg.querySelector('[data-chat]'); if (l) l.scrollTop = 1e6; });
    return `<div class="mgr-page">${cur ? `<section class="card mgr-hero ${d.private ? 'priv' : ''}"><div class="mh-f">${face(A.avOf(cur.avatar, cur.name), 'xl')}<i class="online"></i></div><div class="mh-t"><span class="pill ${d.private ? 'pill-l' : 'pill-w'}">${d.private ? 'Private manager' : 'General manager'}</span><h2>${esc(cur.name)}</h2><p>${esc([(cur.languages || []).join(', '), cur.hours].filter(Boolean).join(' · ') || 'Answers on Telegram')}</p><p class="mh-sla">${icon('clock')}Replies ${esc(d.reply_target.toLowerCase())}</p>
        <div class="lb-act">${cur.telegram ? `<a class="btn btn-k btn-sm" href="${esc(tg(cur.telegram))}" target="_blank" rel="noopener">${icon('tg')}Message on Telegram</a>` : ''}<a class="btn btn-w btn-sm" href="#chat" data-tochat>${icon('chat')}Write here</a></div></div></section>`
        : `<section class="card mgr-hero">${me().applied ? empty('headset', 'Your manager is being assigned.', 'Write to us below in the meantime. The VooSquare team answers.') : empty('headset', 'A manager is assigned when you send your application.', 'Until then, write to us below and the team answers.')}</section>`}
      <div class="g-2-1"><section class="card chat" id="chat"><div class="card-h"><h3>Messages and notes</h3><span class="sub">Your manager sees these on your account</span></div><div class="chat-l" data-chat>${msgs.length ? msgs.map((m) => `<div class="cm-m ${m.mine ? 'out' : 'in'}">${m.mine ? '' : face(A.avOf(cur && cur.avatar, m.by), 'xs')}<p>${esc(m.body)}<small>${m.mine ? 'You' : esc(m.by || 'Manager')} · ${A.dtm(m.at)}</small></p>${m.mine ? face(myFace(), 'xs') : ''}</div>`).join('') : `<p class="muted sm chat-empty">No messages yet. Ask about deals, tracking or a conversion.</p>`}</div>
        <form class="chat-f" data-chatf><input class="inp" name="text" placeholder="Write to ${esc(cur ? cur.name.split(' ')[0] : 'the team')}" aria-label="Message" maxlength="2000"><button class="btn btn-g btn-sm" type="submit">${icon('send')}Send</button></form></section>
        <div class="stack"><section class="card"><div class="card-h"><h3>What your manager helps with</h3></div><ul class="ul">${['Deals and CPA applications', 'Tracking setup', 'Creatives', 'Compliance questions', 'Contest questions'].map((x) => `<li>${x}</li>`).join('')}</ul></section>
        ${d.private ? (d.general ? `<section class="card"><div class="mg-g">${face(A.avOf(d.general.avatar, d.general.name), 'sm')}<span><b>${esc(d.general.name)}</b> · General manager. Still your contact for general questions.</span></div></section>` : '')
          : `<section class="card teaser"><span>${icon('lock')}</span><p>${d.private_unlocked ? 'You qualify for a private manager. One is assigned within a few days.' : 'A private manager is assigned at Elite. You can also ask for one if you bring large volume from day one.'}</p></section>`}</div></div></div>`;
  });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-chatf]'); if (!f) return; e.preventDefault();
    const v = f.text.value.trim(); if (!v) return;
    const r = await A.act(f.querySelector('button'), () => A.POST('/api/aff/messages', { text: v }));
    if (!r) return;
    const l = document.querySelector('[data-chat]'); const em = l.querySelector('.chat-empty'); if (em) em.remove();
    l.insertAdjacentHTML('beforeend', `<div class="cm-m out new"><p>${esc(v)}<small>You · now</small></p>${face(myFace(), 'xs')}</div>`);
    f.text.value = ''; l.scrollTop = 1e6;
  });
  document.addEventListener('click', (e) => { if (e.target.closest('[data-tochat]')) { e.preventDefault(); const i = document.querySelector('[data-chatf] input'); if (i) { i.scrollIntoView({ block: 'center' }); i.focus(); } } });

  /* ================= Notifications ================= */
  const NCAT = ['All', 'Money', 'Customers', 'Deals', 'Contests', 'Announcements'];
  PG.notifications = (arg) => {
    const cat = NCAT.includes(arg) ? arg : 'All';
    return shell('notifications', 'Notifications', async () => {
      const [d, tg] = await Promise.all([A.api('/api/aff/notifications?limit=100' + (cat !== 'All' ? '&category=' + cat : '')), A.api('/api/aff/telegram').catch(() => null)]);
      S.cache.unread = d.unread;
      const L = d.notifications;
      const TGP = [['Money', ['earnings', 'payouts']], ['Customers', ['first_payment', 'qualified', 'refunds']], ['Deals', ['cpa', 'deals', 'tier']], ['Contests', ['contest_rank']], ['Announcements', ['announcements', 'health']]];
      A.then((pg) => pg.addEventListener('change', async (e) => {
        const c = e.target.closest('[data-tgcat]'); if (!c || !tg) return;
        const prefs = {}; TGP.find((x) => x[0] === c.dataset.tgcat)[1].forEach((k) => { prefs[k] = c.checked; });
        try { await A.PUT('/api/aff/telegram/prefs', { prefs }); VS.toast('Saved'); } catch (x) { c.checked = !c.checked; VS.toast(x.message, 'err'); }
      }));
      return `<div class="ph"><div><h2>Notifications</h2><p>Everything that happened on your account. Choose what reaches you in Telegram below.</p></div><button class="btn btn-w btn-sm" data-readall ${d.unread ? '' : 'disabled'}>Mark all read</button></div>
        <nav class="chips nf-chips" aria-label="Filter">${NCAT.map((c) => `<a href="#/aff/notifications/${c}" class="${c === cat ? 'on' : ''}" ${c === cat ? 'aria-current="page"' : ''}>${c}</a>`).join('')}</nav>
        <section class="card nfl">${L.length ? L.map((n) => `<a class="nf${n.read ? '' : ' unread'}" href="${n.link && /^#\//.test(n.link) ? esc(n.link) : '#/aff/notifications'}" data-nid="${n.id}">${pi(n.product_key || 'premium', 'sm')}<div><b>${esc(n.text)}</b><small>${esc(n.category)} · ${A.ago(n.at)}${A.ago(n.at) === 'now' ? '' : ' ago'}</small></div><i class="nf-dot"></i></a>`).join('') : empty('bell', cat === 'All' ? 'Nothing here yet.' : `No ${cat.toLowerCase()} notifications.`, 'Sign-ups, payments, payouts and announcements show here.')}</section>
        <section class="card"><div class="card-h"><h3>Channels</h3><span class="sub">In-app is always on.${tg && !tg.configured ? ' Telegram alerts are not configured yet.' : tg && !tg.connected ? ' <a class="lnk" href="#/aff/postbacks/tg">Connect Telegram</a> to turn it on.' : ''}</span></div><div class="tbl-w"><table class="tbl chm"><thead><tr><th>Type</th><th class="c">In-app</th><th class="c">Telegram</th></tr></thead><tbody>${TGP.map(([t, keys]) => `<tr><td>${t}</td><td class="c"><label class="switch"><input type="checkbox" checked disabled aria-label="${t} in-app"><i></i></label></td><td class="c"><label class="switch"><input type="checkbox" data-tgcat="${t}" ${tg && keys.some((k) => tg.prefs[k]) ? 'checked' : ''} ${tg && tg.configured && tg.connected ? '' : 'disabled'} aria-label="${t} in Telegram"><i></i></label></td></tr>`).join('')}</tbody></table></div></section>`;
    });
  };
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-readall]')) { const b = e.target.closest('[data-readall]'); if (await A.act(b, () => A.POST('/api/aff/notifications/read', { all: true }), 'You are up to date.')) { S.cache.unread = 0; A.route(); } }
    const n = e.target.closest('[data-nid]');
    if (n && n.classList.contains('unread')) { n.classList.remove('unread'); A.POST('/api/aff/notifications/read', { ids: [Number(n.dataset.nid)] }).catch(() => {}); S.cache.unread = Math.max(0, (S.cache.unread || 1) - 1); }
  });

  /* ================= Settings ================= */
  const STABS = [['profile', 'Profile'], ['traffic', 'Traffic sources'], ['payout', 'Payout details'], ['security', 'Security and API'], ['referrals', 'Sub-affiliates'], ['tax', 'Tax'], ['legal', 'Legal']];
  PG.settings = (arg) => {
    const tab = STABS.some((t) => t[0] === arg) ? arg : 'profile';
    return shell('settings', 'Settings', async () => {
      const d = await A.api('/api/aff/settings');
      const m = me(); const pr = d.profile;
      let inner = '';
      if (tab === 'profile') inner = `<form data-setf="profile"><div class="set-prof">${face(myFace(), 'xl')}<div><b>${esc(m.name)}</b><p class="muted">${esc(m.ref)} · ${m.approved_at ? 'Affiliate since ' + A.dt(m.approved_at) : m.applied_at ? 'Applied ' + A.dt(m.applied_at) : 'Application not sent'}</p><a class="btn btn-w btn-xs" href="/app#profile">Change avatar</a></div></div>
        <div class="fgrid"><label class="field"><span class="lbl">Display name</span><input class="inp" name="display_name" maxlength="40" value="${esc(pr.display_name)}"></label><label class="field"><span class="lbl">Type</span><select class="inp" name="kind"><option value="individual" ${pr.kind !== 'company' ? 'selected' : ''}>Individual</option><option value="company" ${pr.kind === 'company' ? 'selected' : ''}>Company</option></select></label>
        <label class="field"><span class="lbl">Company <em>if company</em></span><input class="inp" name="company" maxlength="80" value="${esc(pr.company || '')}"></label><label class="field"><span class="lbl">Country</span><select class="inp" name="country">${A.countryOptions(pr.country)}</select></label><label class="field"><span class="lbl">Languages</span><input class="inp" name="languages" value="${esc((pr.languages || []).join(', '))}" placeholder="English, Pidgin"></label><label class="field"><span class="lbl">Telegram</span><input class="inp" name="telegram" value="${esc(pr.telegram || '')}" autocapitalize="off"></label><label class="field"><span class="lbl">WhatsApp</span><input class="inp" name="whatsapp" value="${esc(pr.whatsapp || '')}" inputmode="tel"></label></div>
        <label class="switch"><input type="checkbox" name="hide_name" ${pr.hide_name ? 'checked' : ''}><i></i>Hide my name on leaderboards (shows Affiliate #${m.id})</label><label class="switch"><input type="checkbox" name="marketing" ${d.marketing ? 'checked' : ''}><i></i>Affiliate news and contest announcements by email</label><div class="lb-act"><button class="btn btn-g btn-sm" type="submit">Save changes</button></div></form>`;
      if (tab === 'traffic') {
        const t = d.traffic || {};
        const srcs = (await A.api('/api/aff/application').catch(() => ({ sources: [] }))).sources || [];
        inner = `<form data-setf="traffic"><p class="muted">Declare every source before you use it. Changes are logged and visible to your manager. Undeclared sources can lead to CPA declines.</p>
          <div class="field"><span class="lbl">Traffic sources</span><div class="chipset" data-chips="src">${srcs.map((s) => { const on = (t.sources || []).includes(s); return `<button type="button" data-v="${esc(s)}" class="${on ? 'on' : ''}" aria-pressed="${on}">${on ? icon('check') : ''}${esc(s)}</button>`; }).join('')}</div></div>
          <label class="field"><span class="lbl">Main geos <em>up to 5 country codes</em></span><input class="inp" name="geos" value="${esc((t.geos || []).join(', '))}" placeholder="NG, GH, KE"></label>
          <label class="field"><span class="lbl">Links</span><textarea class="inp" name="links" placeholder="One per line">${esc((t.links || []).join('\n'))}</textarea></label><div class="lb-act"><button class="btn btn-g btn-sm" type="submit">Save sources</button></div></form>`;
      }
      if (tab === 'payout') inner = `<form data-setf="payout"><div class="paym big" role="radiogroup"><label class="paym-o ${d.wallets.method !== 'btc' ? 'on' : ''}"><input type="radio" name="method" value="usdt_trc20" ${d.wallets.method !== 'btc' ? 'checked' : ''}><i class="cm-usdt">₮</i><span><b>USDT (TRC20)</b><small>${d.wallets.usdt_trc20 ? esc(d.wallets.usdt_trc20) : 'No address yet'}</small></span></label><label class="paym-o ${d.wallets.method === 'btc' ? 'on' : ''}"><input type="radio" name="method" value="btc" ${d.wallets.method === 'btc' ? 'checked' : ''}><i class="cm-btc">₿</i><span><b>BTC</b><small>${d.wallets.btc ? esc(d.wallets.btc) : 'No address yet'}</small></span></label></div>
        <label class="field"><span class="lbl">New USDT (TRC20) address</span><input class="inp mono" name="usdt_trc20" placeholder="T…" autocapitalize="off" spellcheck="false"></label><label class="field"><span class="lbl">New BTC address</span><input class="inp mono" name="btc" placeholder="bc1…" autocapitalize="off" spellcheck="false"><span class="hint">We check the checksum. Locked while a payout request is open.</span></label>
        ${d.wallets.locked ? `<p class="err">${icon('lock')}Your addresses are locked while a payout request is open.</p>` : ''}<div class="lb-act"><button class="btn btn-g btn-sm" type="submit" ${d.wallets.locked ? 'disabled' : ''}>Save payout details</button></div></form>`;
      if (tab === 'security') inner = `<div class="sec-r"><span>${icon('id')}</span><div><b>Voo ID</b><p class="muted sm">You sign in with a one-time code to ${esc(m.email)}. No passwords.</p></div><a class="btn btn-w btn-xs" href="/app#profile">Manage</a></div>
        <div class="api"><div class="card-h"><h3>Stats API</h3><span class="r">${d.api_unlocked ? '<span class="pill pill-g">Unlocked</span>' : `<span class="pill pill-w">${esc(A.tiers()[2] ? A.tiers()[2].n : 'Elite')} and up</span>`}</span></div><p class="muted sm">Read your reports from your own tools. Read-only. 120 requests a minute.</p>
          <div class="lb-out" data-keybox><code>${d.api_key ? esc(d.api_key.prefix) + '••••••••' : d.api_unlocked ? 'No key yet' : 'Opens at ' + esc(A.tiers()[2] ? A.tiers()[2].n : 'Elite')}</code>${d.api_unlocked && !isPend() ? `<button class="btn btn-k btn-xs" data-newkey>${d.api_key ? 'Rotate' : 'Create key'}</button>${d.api_key ? '<button class="btn btn-ghost btn-xs" data-delkey>Revoke</button>' : ''}` : ''}</div>
          <pre class="code">GET ${esc(location.origin)}/api/aff/v1/report?group=sub1&amp;period=month
Authorization: Bearer vsa_…</pre>
          <form data-ipsf class="chat-f"><input class="inp mono" name="ips" value="${esc(((d.api_key || {}).ips || []).join(', '))}" placeholder="IP allowlist, optional: 102.89.1.10" aria-label="IP allowlist"><button class="btn btn-w btn-sm" type="submit" ${d.api_key ? '' : 'disabled'}>Save</button></form></div>`;
      if (tab === 'referrals') inner = `<div class="subaff"><div><b>Sub-affiliate referrals</b><p class="muted">Invite other affiliates and earn a share of what our program pays them, paid by Zedapex and never taken from theirs.</p></div><a class="btn btn-w btn-sm" href="#/aff/subs">${icon('network')}Open my network</a></div>`;
      if (tab === 'tax') inner = `<form data-setf="tax"><div class="fgrid"><label class="field"><span class="lbl">Country of tax residence</span><select class="inp" name="tax_country">${A.countryOptions(d.tax.country || pr.country)}</select></label><label class="field"><span class="lbl">Tax ID <em>optional</em></span><input class="inp" name="tax_id" placeholder="${d.tax.tax_id_set ? 'Saved. Type a new one to change it.' : 'TIN'}"></label></div><p class="muted sm">You are responsible for taxes on your earnings. Monthly statements are on the Payouts page.</p><div class="lb-act"><button class="btn btn-g btn-sm" type="submit">Save</button></div></form>`;
      if (tab === 'legal') inner = `<div class="sec-r"><span>${icon('shield')}</span><div><b>Affiliate terms ${esc(d.legal.terms_version || '')}</b><p class="muted sm">${d.legal.accepted_at ? `Accepted on ${A.dtm(d.legal.accepted_at)}` : 'Not accepted yet'}${d.legal.current_version && d.legal.current_version !== d.legal.terms_version ? ` · new version ${esc(d.legal.current_version)}` : ''}</p></div><a class="btn btn-w btn-xs" href="#/aff/terms">Read</a>${d.legal.needs_accept ? '<button class="btn btn-k btn-xs" data-terms-accept>Accept the new terms</button>' : ''}</div>${(d.legal.history || []).length ? `<div class="tc-hist"><small class="muted">Acceptance history</small>${d.legal.history.map((h) => `<span><b>${esc(h.version)}</b> ${A.dtm(h.accepted_at)}</span>`).join('')}</div>` : ''}
        <div class="danger"><b>Close affiliate account</b><p class="muted sm">Your accrued earnings stay payable. New earnings stop. Your Voo ID and tools are not affected.</p><button class="btn btn-danger btn-sm" data-close-acc>Close affiliate account</button></div>`;
      A.then((pg) => wireSettings(pg));
      return `<div class="ph"><div><h2>Settings</h2></div></div><div class="set"><nav class="set-n" aria-label="Settings sections">${STABS.map(([k, l]) => `<a href="#/aff/settings/${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav><section class="card set-b">${inner}</section></div>`;
    });
  };
  function wireSettings(pg) {
    pg.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-setf]'); if (!f) return; e.preventDefault();
      const k = f.dataset.setf; const btn = f.querySelector('[type=submit]');
      let call;
      if (k === 'profile') call = () => A.PATCH('/api/aff/settings', { display_name: f.display_name.value, kind: f.kind.value, company: f.company.value, country: f.country.value, languages: f.languages.value.split(',').map((x) => x.trim()).filter(Boolean), telegram: f.telegram.value, whatsapp: f.whatsapp.value, hide_name: f.hide_name.checked, marketing: f.marketing.checked });
      if (k === 'traffic') call = () => A.PATCH('/api/aff/settings', { traffic: { sources: [...f.querySelectorAll('[data-chips=src] .on')].map((b) => b.dataset.v), geos: f.geos.value.split(/[,\s]+/).filter(Boolean), links: f.links.value.split(/\s+/).filter(Boolean) } });
      if (k === 'tax') call = () => A.PATCH('/api/aff/settings', { tax_country: f.tax_country.value, ...(f.tax_id.value ? { tax_id: f.tax_id.value } : {}) });
      if (k === 'payout') call = () => A.PUT('/api/aff/wallets', { method: f.querySelector('[name=method]:checked').value, ...(f.usdt_trc20.value.trim() ? { usdt_trc20: f.usdt_trc20.value.trim() } : {}), ...(f.btc.value.trim() ? { btc: f.btc.value.trim() } : {}) });
      const r = await A.act(btn, call, 'Saved');
      if (r) { if (r.account) S.me = r.account; else await A.refreshMe(); A.route(); }
    });
    pg.addEventListener('click', async (e) => {
      const nk = e.target.closest('[data-newkey]');
      if (nk) { const r = await A.act(nk, () => A.POST('/api/aff/api-key')); if (r) { A.modal(`${A.mHead('Your API key', 'Copy it now. It is shown once.')}<div class="vs-modal-b"><div class="lb-out"><code>${esc(r.key)}</code><button class="btn btn-k btn-sm" data-copy="${esc(r.key)}">${icon('copy')}Copy</button></div><button class="btn btn-w" data-close>Done</button></div>`); await A.refreshMe(); } }
      const dk = e.target.closest('[data-delkey]');
      if (dk && confirm('Revoke this key? Tools using it stop working.')) { if (await A.act(dk, () => A.DEL('/api/aff/api-key'), 'Key revoked')) A.route(); }
      const cl = e.target.closest('[data-close-acc]');
      if (cl) { const v = await A.ask('Close your affiliate account', 'Type CLOSE to confirm. Accrued earnings stay payable.', { label: 'Confirm', placeholder: 'CLOSE', ok: 'Close account', danger: true }); if (v && await A.act(cl, () => A.POST('/api/aff/close', { confirm: v }), 'Affiliate account closed')) { S.me = null; location.hash = '#/site'; } }
    });
    const ip = pg.querySelector('[data-ipsf]');
    if (ip) ip.addEventListener('submit', async (e) => { e.preventDefault(); await A.act(ip.querySelector('button'), () => A.PUT('/api/aff/api-ips', { ips: ip.ips.value.split(/[,\s]+/).filter(Boolean) }), (r) => `Allowlist saved (${r.ips.length})`); });
  }

  /* ================= Compliance ================= */
  PG.compliance = () => shell('compliance', 'Compliance', async () => {
    const [cpa, kit] = await Promise.all([A.api('/api/aff/cpa').catch(() => ({ stats: {} })), A.api('/api/aff/brand-kit')]);
    const m = me(); const t = m.tier || {}; const s = cpa.stats || {};
    const decided = (s.approved_month || 0) + (s.declined_month || 0);
    const dr = decided ? Math.round(((s.declined_month || 0) / decided) * 100) : null;
    const disc = 'I earn a commission if you buy through my link. It does not change your price.';
    return `<div class="ph"><div><h2>Compliance</h2><p>What you have declared, what is allowed, and how your account looks to our team.</p></div></div>
      <div class="g-3 health">${[['Account standing', isPend() ? 'Under review' : m.status === 'suspended' ? 'Paused' : m.cpa_paused ? 'CPA paused' : 'Good', isPend() || m.cpa_paused ? 'amb' : m.status === 'suspended' ? 'r' : 'g', m.cpa_paused ? 'CPA is paused on your account. Ask your manager.' : 'Warnings and pauses show here first.'], ['Refund rate, 2 months', isPend() ? '–' : fmt(t.refund_rate || 0, 1) + '%', (t.refund_rate || 0) > 8 ? 'amb' : 'g', 'Upgrades held above 8%, tier drops above 15%'], ['CPA decline rate, this month', dr == null ? '–' : dr + '%', dr > 20 ? 'r' : dr > 10 ? 'amb' : 'g', 'CPA pauses automatically above 20%']].map((h) => `<section class="card hc hc-${h[2]}"><small>${h[0]}</small><b>${h[1]}</b><p class="muted sm">${h[3]}</p></section>`).join('')}</div>
      <div class="g-2-1"><section class="card"><div class="card-h"><h3>Checklist</h3></div><div class="speed-l">${[['Traffic sources declared', ((m.traffic || {}).sources || []).length > 0, '#/aff/settings/traffic'], [`Terms accepted${m.terms_version ? ' (' + m.terms_version + ')' : ''}`, !!m.terms_accepted_at && !(m.terms || {}).needs_accept, '#/aff/settings/legal'], ['Identity verified', (m.kyc || {}).status === 'verified', '#/aff/payouts'], ['Start here lesson done', !!(m.checklist || {}).start_here, '#/aff/lesson'], ['Payout address added', !!(m.checklist || {}).payout_address, '#/aff/settings/payout']].map((x) => `<div class="${x[1] ? 'done' : ''}"><i>${x[1] ? icon('check') : ''}</i><span>${x[0]}</span>${x[1] ? '' : `<a class="btn btn-w btn-xs" href="${x[2]}">Do it</a>`}</div>`).join('')}</div></section>
        <section class="card"><div class="card-h"><h3>Disclosure you can paste</h3></div><div class="sw"><p>${disc}</p><button class="btn btn-ghost btn-xs" data-copy="${disc}" aria-label="Copy disclosure">${icon('copy')}</button></div><p class="muted sm">Trading and gambling audiences: follow the law and the ad platform's rules in every country you run.</p></section></div>
      ${rules(kit.do, kit.dont)}`;
  });

  /* ================= Terms (in the app), application ================= */
  PG.terms = () => shell('terms', 'Affiliate terms', async () => {
    const t = me().terms || {};
    const bar = t.needs_accept ? `<section class="card terms-accept"><span>${icon('shield')}</span><div><b>Updated terms ${esc(t.current)}${t.date ? ' · ' + esc(A.ds(Date.parse(t.date + 'T12:00:00Z'))) : ''}</b><p class="muted sm">The "Changes in ${esc(t.current)}" section at the top lists what changed. Accept to keep requesting payouts.</p></div><button class="btn btn-l btn-sm" data-terms-accept>Accept the updated terms</button></section>` : '';
    return `${bar}<section class="card terms-b in-app">${(await A.loadTerms()).html}</section>`;
  }, { noBanner: true });
  PG.application = () => shell('home', 'Application', async () => {
    const d = await A.api('/api/aff/application'); const a = d.application || {}; const m = me();
    if (!m.applied) { location.replace(`#/join/${Math.min(4, (m.app_step || 0) + 1)}`); return ''; }
    const replies = a.info_replies || [];
    return `<div class="ph"><div><h2>Your application</h2><p>Sent ${A.dtm(m.applied_at)}. Read only while we review it.</p></div>${statusPill(m.status === 'pending' ? 'pending' : m.status, m.status === 'pending' ? 'Under review' : '')}</div>
      <div class="g-2-1"><section class="card app-sum">${[['Display name', a.display_name], ['Type', `${a.kind === 'company' ? 'Company' + (a.company ? ' · ' + a.company : '') : 'Individual'} · ${A.cname(a.country)}`], ['Telegram', a.telegram], ['Traffic sources', (a.sources || []).join(', ')], ['Main geos', (a.geos || []).map(A.cname).join(', ')], ['Monthly volume', a.volume], ['Experience', [a.years, (a.verticals || []).join(', ')].filter(Boolean).join(' · ')], ['Links', (a.links || []).join(' · ')], ['How you will promote', a.plan], ['Payout', m.wallets && (m.wallets.usdt_trc20 || m.wallets.btc) ? (m.wallets.usdt_trc20 ? 'USDT (TRC20) ' + m.wallets.usdt_trc20 : 'BTC ' + m.wallets.btc) : 'Not set yet']].map((r) => `<div><small>${r[0]}</small><b>${esc(r[1] || '–')}</b></div>`).join('')}
        ${replies.map((r) => `<div><small>Your reply · ${A.ds(r.at)}</small><b>${esc(r.text)}</b></div>`).join('')}</section>
      <section class="card"><div class="card-h"><h3>What happens next</h3></div><ol class="tl">${[['Sent', A.dtm(m.applied_at), true], [`Manager assigned${m.managers && m.managers.general ? ': ' + m.managers.general.name : ''}`, '', !!(m.managers && m.managers.general)], ['Review', 'Usually within 2 business days', false], ['Decision by email, Telegram and here', '', false]].map((s) => `<li class="${s[2] ? 'done' : ''}"><i></i><b>${esc(s[0])}</b><small>${esc(s[1])}</small></li>`).join('')}</ol><a class="btn btn-w btn-sm" href="#/aff/manager">Message ${esc(m.managers && m.managers.general ? m.managers.general.name.split(' ')[0] : 'support')}</a></section></div>`;
  });

  /* ================= dispatch ================= */
  A.R.aff = async (page, arg) => {
    if (!S.user) { location.replace('#/join/login'); return null; }
    if (!S.me) { try { await A.refreshMe(); } catch { /* none */ } }
    if (!S.me) { location.replace(S.staff && S.staff.roles ? A.staffHome() : '#/join/none'); return null; }
    if (S.me.status === 'rejected') { location.replace('#/join/declined'); return null; }
    if (S.me.status === 'closed') { location.replace('#/site'); return null; }
    if (page === 'welcome') { S.me.welcome_seen = false; page = 'home'; }
    const f = PG[page] || PG.home;
    if (!S.cache.unreadLoaded) { S.cache.unreadLoaded = true; A.api('/api/aff/notifications?limit=1').then((r) => { S.cache.unread = r.unread; A.setUnread(r.unread); }).catch(() => {}); }
    return f(arg);
  };
})();
