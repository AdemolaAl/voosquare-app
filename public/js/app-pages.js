/* VooSquare member app: Blog, Support and Profile. (Referrals: app-referrals.js) */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { esc, icon } = VS;
  const S = A.S;
  const DEF_GRAD = 'linear-gradient(135deg,#0F2E20,#1E6B47)';

  /* ---------------- BLOG ---------------- */
  const postCard = (p, big) => `<a class="post ${big ? 'big' : ''}" href="#post/${esc(p.slug)}">
    <div class="post-cv" style="background:${esc(p.grad || DEF_GRAD)}"><span class="cvmark">${esc(p.mark || p.title[0])}</span><span class="post-tags"><span class="pill pill-k">${esc(p.category)}</span>${p.premium ? `<span class="pill pill-gold">${icon('premium')}Premium</span>` : ''}</span></div>
    <div class="post-b"><h4>${esc(p.title)}</h4>${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ''}<div class="post-by"><span class="av av-xs">${VS.authorAvatar(p.author_key, p.id)}</span>${esc(p.author_name)}<span class="dotsep"></span>${p.minutes} min<span class="dotsep"></span>${esc(VS.timeAgo(p.created_at))}</div></div></a>`;

  function renderBlog(view) {
    let cat = '';
    const paint = async () => {
      try {
        const d = await VS.api('/api/posts' + (cat ? '?category=' + encodeURIComponent(cat) : ''));
        const ps = d.posts;
        const feat = !cat && ps[0];
        view.querySelector('#blogBody').innerHTML = ps.length ? `${feat ? postCard(feat, true) : ''}<div class="bgrid">${ps.slice(feat ? 1 : 0).map((p) => postCard(p)).join('')}</div>` : A.empty('pen', 'No posts here yet', 'New posts land here first.');
        if (!view.querySelector('#blogCats').childElementCount && d.categories.length > 1) {
          view.querySelector('#blogCats').innerHTML = `<button class="on" data-cat="">All</button>${d.categories.map((c) => `<button data-cat="${esc(c)}">${esc(c)}</button>`).join('')}`;
        }
      } catch (e) { view.querySelector('#blogBody').innerHTML = A.errorBox(e.message); }
    };
    view.innerHTML = `<div class="page-head"><div><span class="kick">The Voo Blog</span><h2>Field notes from the buying desk.</h2><p>Playbooks, breakdowns and news from Dchessking and the Zedapex team.</p></div></div>
      <div class="chips" id="blogCats"></div><div id="blogBody">${A.skel(300, '100%', 24)}<div style="height:14px"></div>${A.skelCards(3, 240)}</div>`;
    view.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cat]');
      if (b) { cat = b.dataset.cat; view.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('on', x === b)); paint(); }
      if (e.target.closest('[data-retry]')) paint();
    });
    paint();
  }

  function blockHtml(b) {
    const [t, v] = Array.isArray(b) ? b : ['p', b];
    if (t === 'h' || t === 'h2' || t === 'h3') return `<h3>${esc(v)}</h3>`;
    if (t === 'q' || t === 'quote') return `<blockquote>${esc(v)}</blockquote>`;
    if (t === 'ul' || t === 'list') return `<ul>${(Array.isArray(v) ? v : [v]).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    if (t === 'ol') return `<ol>${(Array.isArray(v) ? v : [v]).map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`;
    return `<p>${A.richText(v)}</p>`;
  }
  function renderPost(view, slug) {
    view.innerHTML = `<a class="backlink" href="#blog">${icon('left')}Blog</a>${A.skel(240, '100%', 24)}<div style="height:16px"></div>${A.skel(18)}${A.skel(18, '80%')}`;
    VS.api('/api/posts/' + encodeURIComponent(slug)).then((d) => {
      const p = d.post;
      A.setTitle('Blog');
      view.innerHTML = `<a class="backlink" href="#blog">${icon('left')}Blog</a>
        <article class="reader">
          <div class="reader-cv" style="background:${esc(p.grad || DEF_GRAD)}"><span class="cvmark">${esc(p.mark || p.title[0])}</span><div class="gridbg"></div><div class="rc-in"><span class="post-tags"><span class="pill pill-l">${esc(p.category)}</span>${p.premium ? `<span class="pill pill-gold">${icon('premium')}Premium</span>` : ''}</span><h1>${esc(p.title)}</h1></div></div>
          <div class="reader-by"><span class="av av-md">${VS.authorAvatar(p.author_key, p.id)}</span><div><b>${esc(p.author_name)}</b><small>${esc(p.author_role || 'Zedapex')} · ${esc(VS.dateStr(p.created_at))} · ${p.minutes} min read</small></div></div>
          <div class="prose ${p.locked ? 'faded' : ''}">${p.excerpt ? `<p class="lead">${esc(p.excerpt)}</p>` : ''}${(p.body || []).map(blockHtml).join('')}</div>
          ${p.locked ? `<div class="reader-lock">${A.premiumUpsell('Keep reading with Premium', 'This post is part of Premium. Premium includes the full playbooks, every course and the premium rooms.')}</div>` : ''}
        </article>
        ${(d.more || []).length ? `<div class="more"><h3>More from the blog</h3><div class="bgrid">${d.more.map((x) => postCard(x)).join('')}</div></div>` : ''}`;
      view.scrollTop = 0; window.scrollTo(0, 0);
    }).catch((e) => { view.innerHTML = `<a class="backlink" href="#blog">${icon('left')}Blog</a><div class="card">${A.empty('pen', e.status === 404 ? 'Post not found' : 'That did not load', e.status === 404 ? 'It may have been moved or unpublished.' : esc(e.message))}</div>`; });
  }

  /* ---------------- SUPPORT ---------------- */
  const T_STATUS = { open: ['Waiting for us', 'pill-w'], pending: ['Replied', 'pill-g'], closed: ['Closed', 'pill-w'] };
  const tPill = (s) => { const x = T_STATUS[s] || [s, 'pill-w']; return `<span class="pill ${x[1]}">${esc(x[0])}</span>`; };
  let productsCache = null;

  function renderSupport(view, arg) {
    const tid = Number(String(arg || '').replace(/^:/, '')) || 0;
    view.classList.add('page-sp');
    view.innerHTML = `<div class="sp" data-mode="${tid ? 'conv' : 'list'}">
      <aside class="sp-list"><div class="sp-lh"><div><h2>Support</h2><p>One inbox for every Voo tool</p></div><button class="btn btn-g btn-sm" data-new>${icon('plus')}New message</button></div><div id="tList">${A.skel(64)}${A.skel(64)}${A.skel(64)}</div></aside>
      <section class="sp-main" id="spMain"></section>
    </div>`;
    const list = view.querySelector('#tList');
    const main = view.querySelector('#spMain');
    let convClean = null;
    const paintList = async () => {
      try {
        const d = await VS.api('/api/support/tickets');
        S.tickets = d.tickets;
        S.openTickets = d.tickets.filter((t) => t.unread).length; A.emit('badges');
        list.innerHTML = d.tickets.length ? d.tickets.map((t) => `<a class="tk ${t.id === tid ? 'on' : ''} ${t.unread ? 'unread' : ''}" href="#support/${t.id}">${VS.productIcon(t.product || {}, 'sm')}<span class="tk-t"><b>${esc(t.subject || 'Conversation')}</b><small>${esc((t.product && t.product.name) || 'VooSquare')} · ${esc(VS.timeAgo(t.updated_at))}</small></span><span class="tk-r">${t.unread ? '<span class="udot" aria-label="New reply"></span>' : ''}${tPill(t.status)}</span></a>`).join('')
          : A.empty('inbox', 'No conversations yet', 'Questions about any Voo tool, billing or your account? Send us a message. A real person replies.', '<button class="btn btn-k btn-sm" data-new>Send a message</button>');
      } catch (e) { list.innerHTML = A.errorBox(e.message); }
    };
    paintList();
    if (tid) convClean = openConv(main, tid, paintList);
    else main.innerHTML = `<div class="sp-hello"><div class="sp-faces" aria-hidden="true">${[[1, 2, 0, 1], [6, 0, 3, 2], [4, 5, 7, 6]].map(([s, h, sh, b], i) => `<span class="av av-lg" style="--d:${i}">${VS.avatar({ skin: s, hair: h, shirt: sh, bg: b, hairColor: i, eyes: 0, mouth: i % 2 })}</span>`).join('')}</div><h3>How can we help?</h3><p>Ask about any tool, a payment or your account. The Zedapex team replies here and by email.</p><button class="btn btn-k" data-new>${icon('chat')}New message</button></div>`;
    view.addEventListener('click', (e) => {
      if (e.target.closest('[data-new]')) newTicket();
      if (e.target.closest('[data-retry]')) paintList();
    });
    const off = A.on('support', paintList);
    return () => { off(); if (convClean) convClean(); };
  }

  async function newTicket(preselect) {
    const m = A.modal(`${A.modalHead('New message', 'We reply here and by email')}<div class="vs-modal-b"><div class="lbl">Which tool is this about?</div><div class="pp" id="pp">${A.skel(44)}</div>
      <div class="field"><label for="tSub">Subject</label><input class="inp" id="tSub" maxlength="140" placeholder="A few words about the issue"></div>
      <div class="field"><label for="tBody">Message</label><textarea class="inp" id="tBody" rows="5" maxlength="4000" placeholder="What happened, and what did you expect? Add links or error messages if you have them."></textarea></div>
      ${window.VSM ? `<div class="proof-box"><div class="att-host" id="tAtt" hidden></div><button type="button" class="proof-add" id="tAttB"><span class="kic2">${icon('image')}</span><span>Add a screenshot<small>Optional. It helps us see the problem.</small></span></button></div>` : ''}
      <button class="btn btn-g" data-send>${icon('send')}Send message</button></div>`, { cls: 'am-md' });
    const tatt = window.VSM ? VSM.attacher({ btn: m.el.querySelector('#tAttB'), chipHost: m.el.querySelector('#tAtt'), purpose: 'support', label: 'Screenshot', onChange: (s) => { m.el.querySelector('#tAttB').hidden = s.has; } }) : null;
    let sel = 0;
    try {
      productsCache = productsCache || (await VS.api('/api/support/products')).products;
      sel = preselect || (productsCache[0] && productsCache[0].id) || 0;
      const paint = () => { m.el.querySelector('#pp').innerHTML = productsCache.map((p) => `<button class="ppo ${p.id === sel ? 'on' : ''}" data-p="${p.id}" aria-pressed="${p.id === sel}">${VS.productIcon(p, 'xs')}${esc(p.name)}</button>`).join(''); };
      paint();
      m.el.querySelector('#pp').addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (b) { sel = Number(b.dataset.p); paint(); } });
    } catch (e) { m.el.querySelector('#pp').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
    m.el.querySelector('[data-send]').addEventListener('click', async (e) => {
      const body = m.el.querySelector('#tBody').value.trim();
      if (!body) { m.el.querySelector('#tBody').focus(); VS.toast('Tell us what you need help with.', 'err'); return; }
      await A.busy(e.currentTarget, async () => {
        try {
          const upl = tatt && tatt.has() ? await tatt.get() : null;
          const d = await VS.api('/api/support/tickets', { body: { product_id: sel, subject: m.el.querySelector('#tSub').value.trim(), body, upload_id: upl ? upl.id : undefined } });
          if (tatt) tatt.sent();
          m.close();
          VS.toast('Message sent. We will reply soon.');
          location.hash = '#support/' + d.ticket.id;
        } catch (err) { A.errToast(err); }
      });
    });
  }

  function openConv(main, id, onChange) {
    main.innerHTML = `<div class="conv"><header class="conv-h"><a class="room-back" href="#support" aria-label="All conversations">${icon('left')}</a>${A.skel(34, '34px', 11)}<div class="conv-ht">${A.skel(16, '50%')}</div></header><div class="conv-msgs" id="cMsgs">${A.skel(60, '70%', 18)}<div style="height:10px"></div>${A.skel(60, '60%', 18)}</div></div>`;
    let ticket = null, msgs = [], live = null, closed = false, att = null;
    const box = () => main.querySelector('#cMsgs');
    const bubble = (m, fresh) => {
      const staff = m.author_type === 'staff';
      return `<div class="bub2 ${staff ? 'them' : 'mine'} ${fresh ? 'fresh' : ''}" data-id="${m.id}">${staff ? `<span class="av av-sm">${m.author_avatar && Object.keys(m.author_avatar).length ? VS.avatar(m.author_avatar) : VS.bot()}</span>` : ''}<div class="b2"><span class="b2-n">${staff ? `${esc(m.author_name || 'Support')} <em>${esc((ticket.product && ticket.product.name) || 'VooSquare')} team</em>` : 'You'}</span>${m.attachment && window.VSM ? VSM.thumb(m.attachment, { maxW: 300, maxH: 320 }) : ''}${m.body ? `<div class="b2-t">${A.richText(m.body)}</div>` : ''}<time title="${esc(new Date(m.created_at).toLocaleString())}">${esc(VS.timeAgo(m.created_at))}</time></div></div>`;
    };
    const add = (m, fresh) => {
      if (msgs.some((x) => x.id === m.id)) return;
      msgs.push(m);
      box().insertAdjacentHTML('beforeend', bubble(m, fresh));
      box().scrollTop = box().scrollHeight;
    };
    const load = async () => {
      try {
        const d = await VS.api('/api/support/tickets/' + id);
        if (closed) return;
        ticket = d.ticket; msgs = [];
        A.setTitle('Support');
        main.innerHTML = `<div class="conv">
          <header class="conv-h"><a class="room-back" href="#support" aria-label="All conversations">${icon('left')}</a>${VS.productIcon(ticket.product || {}, 'sm')}<div class="conv-ht"><h3>${esc(ticket.subject || 'Conversation')}</h3><p>${esc((ticket.product && ticket.product.name) || 'VooSquare')} · started ${esc(VS.dateStr(ticket.created_at))}</p></div><span id="tSt">${tPill(ticket.status)}</span></header>
          <div class="conv-msgs" id="cMsgs"></div>
          <div class="composer conv-comp"><div class="att-host" id="rAtt" hidden></div><div class="comp-row">${window.VSM ? `<button class="comp-att" id="rAttB" type="button" aria-label="Add a screenshot" title="Add a screenshot">${icon('image')}</button>` : ''}<textarea id="rIn" rows="1" maxlength="4000" placeholder="${ticket.status === 'closed' ? 'Reply to reopen this conversation' : 'Write a reply'}" aria-label="Reply"></textarea><button class="comp-send" id="rSend" aria-label="Send">${icon('send')}</button></div></div>
        </div>`;
        d.messages.forEach((m) => add(m));
        const ta = main.querySelector('#rIn');
        att = window.VSM ? VSM.attacher({ btn: main.querySelector('#rAttB'), chipHost: main.querySelector('#rAtt'), purpose: 'support', label: 'Screenshot' }) : null;
        if (att) ta.addEventListener('paste', (e) => { const f = VSM.fileFrom(e.clipboardData); if (f) { e.preventDefault(); att.add(f); } });
        ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; });
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
        main.querySelector('#rSend').addEventListener('click', send);
        if (ticket.unread && onChange) onChange();
        live = VS.stream(['ticket:' + id], {
          message: (m) => { add(m, true); if (m.author_type === 'staff') VS.api('/api/support/tickets/' + id).then((d) => {
            // A staff reply moves the ticket to "Replied": keep the header pill in step with the list.
            if (!closed && d && d.ticket && d.ticket.status) { ticket.status = d.ticket.status; const el = main.querySelector('#tSt'); if (el) el.innerHTML = tPill(d.ticket.status); }
            if (onChange) onChange();
          }).catch(() => {}); },
          status: (s) => { if (s && s.status) { ticket.status = s.status; const el = main.querySelector('#tSt'); if (el) el.innerHTML = tPill(s.status); } },
        });
      } catch (e) {
        main.innerHTML = `<div class="sp-hello">${A.empty('inbox', e.status === 404 ? 'Conversation not found' : 'That did not load', esc(e.message), '<a class="btn btn-w btn-sm" href="#support">All conversations</a>')}</div>`;
      }
    };
    async function send() {
      const ta = main.querySelector('#rIn');
      const body = ta.value.trim();
      const hasImg = !!(att && att.has());
      if (!body && !hasImg) return;
      const btn = main.querySelector('#rSend');
      await A.busy(btn, async () => {
        try {
          const upl = hasImg ? await att.get() : null;
          const d = await VS.api(`/api/support/tickets/${id}/messages`, { body: { body, upload_id: upl ? upl.id : undefined } });
          ta.value = ''; ta.style.height = 'auto';
          if (att) att.sent();
          add(d.message, true);
          ticket.status = 'open';
          const el = main.querySelector('#tSt'); if (el) el.innerHTML = tPill('open');
          if (onChange) onChange();
        } catch (e) { A.errToast(e); }
      });
    }
    load();
    return () => { closed = true; if (live) live.close(); if (att) att.destroy(); };
  }
  A.newTicket = newTicket;

  /* ---------------- PROFILE ---------------- */
  /** "Get the app": only once the Google Play link is set (the App Store joins when it has a link too). */
  function getApp() {
    const a = (S.home && S.home.apps) || {};
    const ok = (u, p) => typeof u === 'string' && u.startsWith(p) && !/[\s"'<>]/.test(u);
    if (!ok(a.play_url, 'https://play.google.com/')) return '';
    const btn = (url, lead, name) => `<a class="ga-b" href="${esc(url)}" target="_blank" rel="noopener"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M12 7.5v7M9.2 11.8 12 14.6l2.8-2.8M10.5 18.5h3"/></svg><span><small>${lead}</small><b>${name}</b></span></a>`;
    return `<div class="getapp"><div><b>Get the app</b><small>VooSquare on your phone, with the same Voo ID.</small></div><div class="ga-r">${btn(a.play_url, 'Get it on', 'Google Play')}${ok(a.app_store_url, 'https://apps.apple.com/') ? btn(a.app_store_url, 'Download on the', 'App Store') : '<span class="ga-b soon"><span><small>Coming soon</small><b>App Store</b></span></span>'}</div></div>`;
  }
  function renderProfile(view, arg) {
    const u = S.user;
    // #profile/delete (from the public /delete-account page): open the delete sheet once, then stay on #profile.
    if (arg === 'delete') setTimeout(() => { history.replaceState(history.state, '', location.pathname + location.search + '#profile'); deleteSheet(); }, 0);
    let face = { ...u.avatar };
    view.innerHTML = `<div class="prof">
      <div class="card prof-id">
        <div class="pid-top"><span class="av av-xl pid-face" id="pidFace">${VS.avatar(u.avatar)}</span><div><h2>${esc(u.name)}</h2><p class="muted">@${esc(u.handle || '')}</p><div class="pid-b">${A.badges({ ...u, staff: u.staff })}</div></div></div>
        <div class="pid-rows">
          <div class="pid-r"><small>Voo ID</small><code id="vooId">${esc(u.voo_id)}</code><button class="btn btn-w btn-xs" data-copyid>${icon('copy')}Copy</button></div>
          <div class="pid-r"><small>Email</small><span>${esc(u.email)}</span></div>
          <div class="pid-r"><small>Member since</small><span>${esc(VS.dateStr(u.created_at))}</span></div>
          <div class="pid-r"><small>XP</small><span><b>${VS.fmt(u.xp || 0)}</b> from Academy lessons</span></div>
          <div class="pid-r"><small>Plan</small><span>${u.premium ? `Premium until ${esc(VS.dateStr(u.premium_until))}` : 'Free for life'}</span>${u.premium ? '' : '<a class="btn btn-l btn-xs" href="#premium">Go Premium</a>'}</div>
        </div>
        ${getApp()}
        <button class="btn btn-w btn-block" data-logout>${icon('logout')}Log out</button>
      </div>
      <div class="prof-r">
        <div class="card"><div class="card-h"><div><h3>Your face</h3><span class="sub">This is how you show up in the community</span></div></div><div id="pfb"></div><div class="prof-save"><button class="btn btn-k" data-saveface disabled>${icon('check')}Save face</button></div></div>
        <div class="card"><div class="card-h"><h3>Your details</h3></div>
          <form class="pform" id="pform" novalidate>
            <div class="f2"><div class="field"><label for="pName">Name</label><input class="inp" id="pName" maxlength="60" value="${esc(u.name)}" autocomplete="name"></div>
            <div class="field"><label for="pHandle">Handle</label><div class="inp-pre"><span>@</span><input class="inp" id="pHandle" maxlength="20" value="${esc(u.handle || '')}" autocapitalize="off" autocomplete="off" spellcheck="false"></div><span class="hint" id="pHint">3 to 20 letters, numbers or underscores</span></div></div>
            <div class="field"><label for="pBio">Bio</label><textarea class="inp" id="pBio" maxlength="240" rows="3" placeholder="What you run, your geos and verticals">${esc(u.bio || '')}</textarea></div>
            <div class="field"><label for="pCountry">Country</label><select class="inp" id="pCountry">${A.countryOptions(u.country)}</select></div>
            <label class="switch"><input type="checkbox" id="pMk" ${u.marketing ? 'checked' : ''}><i></i>Email me product news, new lessons and offers</label>
            <button class="btn btn-g" type="submit">${icon('check')}Save details</button>
          </form>
        </div>
        <div id="pVoice"></div>
        <div class="card" id="pBlocks"><div class="card-h"><div><h3>Blocked members</h3><span class="sub">You don't see their messages. They aren't told.</span></div></div><div class="pb-list">${A.skel(40)}</div></div>
        <div class="card prof-del"><div class="pd-t"><b>Delete account</b><small>Remove your Voo ID and your personal data for good.</small></div><button type="button" class="btn btn-w btn-sm" data-delacct>${icon('trash')}Delete account</button></div>
      </div>
    </div>`;
    if (window.VSV) VSV.prefsCard(view.querySelector('#pVoice')); // Lessons: teaching voice on or off (app-voice.js)
    blockedCard(view.querySelector('#pBlocks'));
    const saveFaceBtn = view.querySelector('[data-saveface]');
    A.faceBuilder(view.querySelector('#pfb'), u.avatar, (a) => { face = a; saveFaceBtn.disabled = false; view.querySelector('#pidFace').innerHTML = VS.avatar(a); });
    const hInput = view.querySelector('#pHandle');
    hInput.addEventListener('input', () => {
      hInput.value = hInput.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
      const ok = /^[a-z0-9_]{3,20}$/.test(hInput.value);
      view.querySelector('#pHint').className = 'hint ' + (ok ? '' : 'err');
    });
    view.addEventListener('click', async (e) => {
      if (e.target.closest('[data-copyid]')) VS.copyText(u.voo_id, view.querySelector('#vooId'));
      if (e.target.closest('[data-logout]')) A.logout();
      if (e.target.closest('[data-delacct]')) deleteSheet();
      const sf = e.target.closest('[data-saveface]');
      if (sf) await A.busy(sf, async () => { try { await save({ avatar: face }); VS.toast('Face saved'); sf.disabled = true; } catch (err) { A.errToast(err); } });
    });
    view.querySelector('#pform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.submitter || e.target.querySelector('[type=submit]');
      const h = hInput.value.trim();
      if (!/^[a-z0-9_]{3,20}$/.test(h)) { hInput.focus(); VS.toast('Handles use 3 to 20 letters, numbers or underscores.', 'err'); return; }
      await A.busy(btn, async () => {
        try {
          await save({ name: view.querySelector('#pName').value.trim(), handle: h, bio: view.querySelector('#pBio').value.trim(), country: view.querySelector('#pCountry').value, marketing: view.querySelector('#pMk').checked });
          VS.toast('Details saved');
        } catch (err) { A.errToast(err); }
      });
    });
  }
  /* ---------------- blocked members (src/ugc.js): the list, with Unblock ---------------- */
  async function blockedCard(card) {
    const list = card.querySelector('.pb-list');
    let rows = [];
    const paint = () => {
      list.innerHTML = rows.length ? rows.map((m) => `<div class="pb-row" data-uid="${m.id}"><span class="av av-md">${VS.avatar(m.avatar)}</span><span class="pb-t"><b>${esc(m.name)}</b><small>${m.handle ? '@' + esc(m.handle) + ' · ' : ''}Blocked ${esc(VS.dateStr(m.blocked_at))}</small></span><button type="button" class="btn btn-w btn-xs" data-unblock="${m.id}">Unblock</button></div>`).join('')
        : '<p class="pb-empty">You haven\'t blocked anyone. To block someone, open the menu on one of their messages.</p>';
    };
    try { rows = (await VS.api('/api/blocks')).blocks; } catch { card.remove(); return; }
    if (!card.isConnected) return;
    paint();
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-unblock]');
      if (!b) return;
      const m = rows.find((x) => x.id === Number(b.dataset.unblock));
      if (m) A.busy(b, async () => { if (A.unblockMember && await A.unblockMember(m)) { rows = rows.filter((x) => x !== m); paint(); } });
    });
  }

  /* ---------------- delete my account (App Store 5.1.1(v), Google Play) ----------------
   * One sheet: what happens, then type DELETE. POST /api/me/delete signs out everywhere; the goodbye screen replaces the app. */
  async function deleteSheet() {
    const m = A.modal(`${A.modalHead('Delete your account?', 'This cannot be undone.')}<div class="vs-modal-b del-m">${A.skel(120)}</div>`, { cls: 'am-sm am-del' });
    const b = m.el.querySelector('.del-m');
    let st;
    try { st = await VS.api('/api/me/delete'); } catch (e) { if (e.status === 401) { A.errToast(e); return; } st = { can_delete: true }; }
    if (!st.can_delete) {
      b.innerHTML = `<p class="del-why">${icon('lock')}<span>${esc(st.reason)}</span></p><div class="am-actions"><button class="btn btn-k" data-close>OK</button></div>`;
      return;
    }
    b.innerHTML = `<p class="muted">Deleting your account removes your Voo ID everywhere: VooSquare, VooSquare Academy and the app.</p>
      <ul class="del-list">
        <li>${icon('x')}<span><b>Removed:</b> your profile, name, email, face and bio, your sign-ins and the tools you logged in to with your Voo ID.</span></li>
        <li>${icon('x')}<span><b>Removed:</b> your lesson progress and settings. Your certificates are cancelled.</span></li>
        <li>${icon('chat')}<span><b>Your messages stay</b> so other people's chats still make sense, but they show <b>Deleted member</b> instead of your name.</span></li>
        <li>${icon('shield')}<span><b>Kept by law:</b> records of what you paid for and any payouts, without your name or email. Anything you paid for ends with the account.</span></li>
      </ul>
      <div class="field"><label for="delIn">Type <b>DELETE</b> to confirm</label><input class="inp del-in" id="delIn" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" placeholder="DELETE"></div>
      <div class="am-actions"><button class="btn btn-w" data-close>Keep my account</button><button class="btn btn-danger" data-del disabled>${icon('trash')}Delete my account</button></div>`;
    const inp = b.querySelector('#delIn'), go = b.querySelector('[data-del]');
    inp.addEventListener('input', () => { go.disabled = inp.value.trim().toUpperCase() !== 'DELETE'; });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !go.disabled) go.click(); });
    go.addEventListener('click', () => A.busy(go, async () => {
      S.leaving = true; // the server ends this session's live updates; do not bounce to the login page meanwhile
      try {
        await VS.api('/api/me/delete', { body: { confirm: inp.value.trim().toUpperCase() } });
        m.close();
        goodbye();
      } catch (e) { S.leaving = false; A.errToast(e); }
    }));
  }
  /** Full-screen goodbye, in the same look as the "back soon" page. The session is already gone on the server. */
  function goodbye() {
    const sp = document.getElementById('splash'); if (sp) sp.remove();
    document.body.classList.add('f-soon-body');
    const root = document.getElementById('root') || document.body;
    root.innerHTML = `<main class="f-soon" role="main" aria-labelledby="byeT"><div class="gridbg"></div><span class="f-glow" aria-hidden="true"></span>
      <div class="f-soon-in">
        <span class="f-tiles" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
        <span class="f-brand">Voo<b>Square</b></span>
        <h1 id="byeT">Account <span class="serif">deleted.</span></h1>
        <p>Your Voo ID and your personal data are gone, and you are signed out on every device. Thank you for learning and building with us.</p>
        <div class="f-soon-a"><a class="btn btn-l" href="/">${icon('home')}${A.LEARN ? 'VooSquare Academy home' : 'VooSquare home'}</a></div>
        <small>Changed your mind later? You can create a new free account with the same email.</small>
      </div></main>`;
    const layer = document.getElementById('layer'); if (layer) layer.replaceChildren();
    try { history.replaceState(null, '', location.pathname); } catch { /* ignore */ }
  }
  A.deleteAccount = deleteSheet;

  async function save(patch) {
    const d = await VS.api('/api/me', { method: 'PATCH', body: patch });
    S.user = d.user;
    A.emit('user');
    return d.user;
  }
  A.saveMe = save;

  A.pages.blog = { title: 'Blog', render: renderBlog };
  A.pages.post = { title: 'Blog', nav: 'blog', render: renderPost };
  A.pages.support = { title: 'Support', render: renderSupport, full: true };
  A.pages.profile = { title: 'Profile', render: renderProfile };
})();
