/* VooSquare member app: Community (rooms, live chat, reactions, member cards). */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { esc, icon } = VS;
  const S = A.S;
  const GROUP_MS = 5 * 60_000;
  const isStaff = () => !!S.user && (S.user.perms.includes('*') || S.user.perms.includes('community'));

  const dayKey = (t) => new Date(t).toDateString();
  function dayLabel(t) {
    const d = new Date(t), n = new Date();
    if (d.toDateString() === n.toDateString()) return 'Today';
    const y = new Date(n); y.setDate(n.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
  }
  const priceLabel = (r) => A.NO_SALES ? 'Paid room' : `$${VS.fmt(r.price_usd, r.price_usd % 1 ? 2 : 0)}${r.period_days ? (r.period_days === 30 ? '/mo' : ` / ${r.period_days} days`) : ' once'}`;
  const relTime = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 86400 ? VS.timeAgo(t) + ' ago' : VS.timeStr(t); };

  /* ---------------- room list ---------------- */
  /** Short status chip for an invite-only room in the list. */
  function inviteChip(r) {
    const a = r.application;
    if (a && a.status === 'pending') return `<span class="rl-lock ic-applied">${icon('clock')}Applied</span>`;
    if (a && a.status === 'approved' && a.waitlist) return `<span class="rl-lock ic-applied">${icon('clock')}Waitlist</span>`;
    if (a && a.status === 'approved') return `<span class="rl-lock ic-ok">${icon('check')}Approved</span>`;
    return `<span class="rl-lock ic-inv" title="Invite only · ${esc(priceLabel(r))}">${icon('lock')}Invite only</span>`;
  }
  /** "Ada: running NG tonight" for the list and tiles. Locked rooms show their description instead. */
  function lastLine(r) {
    const l = r.unlocked && r.last;
    if (!l) return esc(r.description || r.topic || '');
    const who = S.user && l.user_id === S.user.id ? 'You' : String(l.name || '').split(' ')[0];
    const what = l.body ? l.body : l.photo ? 'Shared a photo' : '';
    return `<em>${esc(who)}:</em> ${esc(what)}`;
  }
  const shortAgo = (t) => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : VS.timeAgo(t); };
  function listRight(r) {
    if (!r.unlocked) return r.access === 'paid' ? (r.approval_required ? inviteChip(r) : `<span class="rl-lock">${icon('lock')}${esc(priceLabel(r))}</span>`) : `<span class="rl-lock prem" title="Premium room">${icon('premium')}</span>`;
    const t = r.last ? `<time>${esc(shortAgo(r.last.at))}</time>` : '';
    return `<span class="rl-r">${t}${r.unread ? `<span class="ub">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}</span>`;
  }
  function roomItem(r, cur) {
    return `<a class="rl ${cur ? 'on' : ''} ${r.unread && r.unlocked ? 'has-unread' : ''} ${r.unlocked ? '' : 'locked'}" href="#community/${r.id}" data-room="${r.id}" style="--rc:${esc(r.color || '#00A86B')}">
      <span class="rl-pic">${A.roomChip(r)}${r.online ? '<i class="rl-on" title="People here now"></i>' : ''}</span><span class="rl-t"><b>${esc(r.name)}</b><small>${lastLine(r)}</small></span>${listRight(r)}</a>`;
  }
  function roomListHtml(cur) {
    const rooms = S.rooms || [];
    const topics = [...new Set(rooms.map((r) => r.topic || 'Rooms'))];
    return topics.map((t) => `<div class="rl-g"><h5>${esc(t)}</h5>${rooms.filter((r) => (r.topic || 'Rooms') === t).map((r) => roomItem(r, String(r.id) === String(cur))).join('')}</div>`).join('');
  }
  function rulesCard() {
    const rules = (S.roomsMeta && S.roomsMeta.rules) || [];
    if (!rules.length) return '';
    return `<div class="card rules"><div class="card-h"><h3>House rules</h3></div><ol>${rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>${REPORT_LINE}</div>`;
  }

  /* Safety (src/ugc.js): report a message, block a member. */
  const REPORT_LINE = `<p class="rules-rep">${icon('flag')}<span>Report anything that breaks the rules. Our team reviews reports within 24 hours.</span></p>`;
  const REPORT_REASONS = [['spam', 'Spam or scam'], ['harassment', 'Harassment or hate'], ['sexual', 'Sexual or violent content'], ['illegal', 'Illegal or dangerous'], ['other', 'Something else']];
  const firstName = (n) => String(n || '').split(' ')[0] || 'This member';
  /** Ask, then block. Emits 'blocked' so open rooms drop that member's messages at once. */
  A.blockMember = async function (user) {
    const ok = await A.ask(`Block ${user.name}?`, "You won't see their messages. They won't be told.", { ok: 'Block', danger: true });
    if (!ok) return false;
    try { await VS.api('/api/blocks', { body: { user_id: user.id } }); } catch (e) { A.errToast(e); return false; }
    VS.toast(`${firstName(user.name)} is blocked`);
    A.emit('blocked', user.id);
    return true;
  };
  A.unblockMember = async function (user) {
    try { await VS.api('/api/blocks/' + user.id, { method: 'DELETE' }); } catch (e) { A.errToast(e); return false; }
    VS.toast(`${firstName(user.name)} is unblocked`);
    A.emit('unblocked', user.id);
    return true;
  };
  /** The report sheet: a reason and an optional note. Resolves true once the report is in (or was already). */
  function reportSheet(m) {
    return new Promise((resolve) => {
      let done = false;
      const what = ((m.attachment ? 'Photo' + (m.body ? ' · ' : '') : '') + (m.body || '')).slice(0, 120);
      const s = A.modal(`${A.modalHead('Report message', 'Our team reviews every report within 24 hours.')}<form class="vs-modal-b rp-f" novalidate>
          <div class="rp-q"><span class="av av-sm">${VS.avatar(m.user.avatar)}</span><span><b>${esc(m.user.name)}</b><em>${esc(what)}</em></span></div>
          <div class="rp-l" role="radiogroup" aria-label="Why are you reporting this?"><span class="lbl">Why are you reporting this?</span>${REPORT_REASONS.map(([k, l]) => `<button type="button" class="rp-r" role="radio" aria-checked="false" data-r="${k}"><span class="ck-radio"></span><b>${l}</b></button>`).join('')}</div>
          <div class="field"><label for="rpNote">Add a note <em class="rp-opt">Optional</em></label><textarea class="inp" id="rpNote" maxlength="500" rows="2" placeholder="Anything that helps us understand"></textarea></div>
          <div class="am-actions"><button type="button" class="btn btn-w" data-close>Cancel</button><button type="submit" class="btn btn-danger" disabled>${icon('flag')}Send report</button></div>
        </form>`, { cls: 'am-sm am-report', onClose: () => { if (!done) resolve(false); } });
      const f = s.el.querySelector('form');
      const go = f.querySelector('[type=submit]');
      let reason = '';
      f.addEventListener('click', (e) => {
        const b = e.target.closest('[data-r]');
        if (!b) return;
        reason = b.dataset.r;
        f.querySelectorAll('[data-r]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
        go.disabled = false;
      });
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        if (!reason) return;
        A.busy(go, async () => {
          try {
            const d = await VS.api(`/api/messages/${m.id}/report`, { body: { reason, note: f.querySelector('#rpNote').value.trim() } });
            done = true; s.close(); resolve(true);
            VS.toast(d.already ? 'You already reported this. Our team will review it within 24 hours.' : 'Thanks. Our team will review it within 24 hours.');
          } catch (err) { A.errToast(err); }
        });
      });
    });
  }

  /* ---------------- page ---------------- */
  function renderCommunity(view, arg) {
    view.classList.add('page-cm');
    const roomId = arg ? Number(arg) : 0;
    const cleanups = [];
    view.innerHTML = `<div class="cm" data-mode="${roomId ? 'room' : 'list'}">
      <aside class="cm-list" aria-label="Rooms">
        <div class="cm-lh"><div><h2>Community</h2><p>Talk shop with working buyers</p></div></div>
        <div class="cm-rooms" id="cmRooms">${S.rooms ? roomListHtml(roomId) : Array.from({ length: 7 }, () => `<div class="rl-sk">${A.skel(40, '40px', 13)}${A.skel(14, '60%')}</div>`).join('')}</div>
        <div class="cm-lf"><button class="btn btn-ghost btn-sm" data-rules>${icon('shield')}House rules</button></div>
      </aside>
      <section class="cm-main" id="cmMain"></section>
    </div>`;
    const list = view.querySelector('#cmRooms');
    const main = view.querySelector('#cmMain');
    const paintList = () => { list.innerHTML = roomListHtml(roomId); };

    let waitingUnlock = false;
    const start = () => {
      paintList();
      if (roomId) { cleanups.push(openRoom(main, roomId, view)); const r = (S.rooms || []).find((x) => x.id === roomId); waitingUnlock = !!(r && !r.unlocked); }
      else welcome(main);
    };
    if (S.rooms) start();
    else A.loadRooms().then(start).catch((e) => { list.innerHTML = A.errorBox(e.message); main.innerHTML = ''; });

    cleanups.push(A.on('rooms', () => {
      paintList();
      // A payment was just confirmed: open the room that was locked a moment ago.
      const r = waitingUnlock && (S.rooms || []).find((x) => x.id === roomId);
      if (r && r.unlocked) { waitingUnlock = false; cleanups.push(openRoom(main, roomId, view)); }
      // Invite-only room: the team decided, or a seat opened. Show the new state.
      else if (r && r.approval_required) { const card = main.querySelector('.ic-card'); if (card && card.dataset.state !== inviteState(r)) lockedRoom(main, r); }
    }));
    // Someone opened or left a room: counts on the community home, the room header and the list dot follow live.
    cleanups.push(A.on('presence', (d) => {
      const r = (S.rooms || []).find((x) => x.id === d.room_id);
      if (!r) return;
      paintPresence(main, r);
      const on = main.querySelector('#rOn');
      if (on && roomId === r.id) on.textContent = Math.max(1, r.online || 0);
      const pic = list.querySelector(`[data-room="${r.id}"] .rl-pic`);
      const dot = pic && pic.querySelector('.rl-on');
      if (pic && !!r.online !== !!dot) { if (dot) dot.remove(); else pic.insertAdjacentHTML('beforeend', '<i class="rl-on" title="People here now"></i>'); }
    }));
    const iv = setInterval(() => { if (!document.hidden) A.loadRooms().catch(() => {}); }, 45_000);
    cleanups.push(() => clearInterval(iv));
    view.addEventListener('click', (e) => {
      if (e.target.closest('[data-rules]')) { e.preventDefault(); showRules(); }
      if (e.target.closest('[data-retry]')) { e.preventDefault(); A.emit('route:refresh'); }
    });
    return () => cleanups.forEach((f) => f && f());
  }

  function showRules() {
    const rules = (S.roomsMeta && S.roomsMeta.rules) || [];
    A.modal(`${A.modalHead('House rules', 'Keep the square useful for everyone')}<div class="vs-modal-b"><ol class="rules-ol">${rules.map((r) => `<li>${esc(r)}</li>`).join('') || '<li>Be useful and respectful.</li>'}</ol>${REPORT_LINE}<p class="muted small">Running trading or gambling offers? Follow the law and the ad platform's rules in every country you run.</p><button class="btn btn-k" data-close>Got it</button></div>`, { cls: 'am-sm' });
  }

  /* ---------------- community home ---------------- */
  // One line under each section title, for the topics the team seeded. Topics added later show without one.
  const TOPIC_LINES = {
    'Start here': 'New here? Begin with these three.',
    Craft: 'The work itself: signals, creatives and funnels.',
    Geos: 'Market by market, from people running there.',
    Help: 'Stuck on a Voo tool? Ask, and the team answers.',
    Premium: 'Where members who scale share live numbers.',
    'Paid rooms': 'Small rooms, by application.',
  };
  /** Distinct recent faces across rooms (members you can see), newest first. */
  function recentFaces(rooms, max) {
    const seen = new Set(); const out = [];
    rooms.filter((r) => r.unlocked).forEach((r) => (r.faces || []).forEach((f) => { const k = f.id || JSON.stringify(f.avatar); if (!seen.has(k)) { seen.add(k); out.push(f); } }));
    return out.slice(0, max);
  }
  // Live presence: rendered for every open room and shown or hidden as people come and go (see paintPresence).
  const isLive = (r) => !!(r.online && r.unlocked);
  const liveTag = (r) => (r.unlocked ? `<span class="live-tag" data-live="${r.id}"${isLive(r) ? '' : ' hidden'}><i></i><span>${r.online || 0}</span> here now</span>` : '');
  const liveLine = (rooms) => {
    const online = rooms.reduce((a, r) => a + (r.online || 0), 0);
    return online ? `<span class="live-dot"></span>${plural(online, 'person', 'people')} in the rooms now` : `<span class="live-dot idle"></span>${plural(rooms.length, 'room', 'rooms')}, moderated by the Zedapex team`;
  };
  /** Update the "here now" counts in place (community home and room header). Counts only, never names. */
  function paintPresence(root, r) {
    if (!root || !r) return;
    const live = isLive(r);
    root.querySelectorAll(`[data-live="${r.id}"]`).forEach((el) => { el.hidden = !live; const n = el.querySelector('span'); if (n) n.textContent = r.online || 0; });
    root.querySelectorAll(`[data-live-off="${r.id}"]`).forEach((el) => { el.hidden = live; });
    const line = root.querySelector('#chLive');
    if (line) line.innerHTML = liveLine(S.rooms || []);
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const AD_HIDE_KEY = 'vs_cm_ad_hidden';

  /** A room tile with its cover. Used for free rooms. */
  function tile(r, big) {
    return `<a class="rt ${big ? 'big' : ''} ${r.unread ? 'has-unread' : ''}" href="#community/${r.id}" style="--rc:${esc(r.color || '#00A86B')}">
      <span class="rt-cov">${A.roomCover(r) || `<span class="rt-cov-f">${icon(r.icon || 'chat')}</span>`}${liveTag(r)}</span>
      <span class="rt-b">
        <span class="rt-h">${A.roomChip(r, 'md')}<b>${esc(r.name)}</b>${r.unread ? `<span class="ub">${r.unread > 99 ? '99+' : r.unread}</span>` : ''}</span>
        <span class="rt-last">${lastLine(r)}</span>
        <span class="rt-f"><span class="fs">${A.faceStack(r.faces, 4, 'xs')}</span><small>${r.read_only ? 'Team posts only' : r.last ? 'Active ' + esc(shortAgo(r.last.at) === 'now' ? 'just now' : shortAgo(r.last.at) + ' ago') : 'Be the first to post'}</small></span>
      </span></a>`;
  }
  /** A single-room section: picture, name, the latest line, wide. */
  function wideRow(r) {
    return `<a class="rw ${r.unread ? 'has-unread' : ''}" href="#community/${r.id}" style="--rc:${esc(r.color || '#00A86B')}">
      <span class="rw-art">${A.roomChip(r, 'xl')}</span>
      <span class="rw-b"><b>${esc(r.name)}</b><span class="rt-last">${lastLine(r)}</span><span class="rt-f"><span class="fs">${A.faceStack(r.faces, 3, 'xs')}</span>${r.unlocked ? `<small class="on" data-live="${r.id}"${isLive(r) ? '' : ' hidden'}><span>${r.online || 0}</span> here now</small>` : ''}<small data-live-off="${r.id}"${isLive(r) ? ' hidden' : ''}>${esc(r.description)}</small></span></span>
      ${r.unread ? `<span class="ub">${r.unread > 99 ? '99+' : r.unread}</span>` : `<span class="rw-go">${icon('arrow')}</span>`}</a>`;
  }
  /** Premium rooms: one dark panel, a row per room. */
  function premiumPanel(rooms) {
    const open = rooms.every((r) => r.unlocked);
    return `<div class="pp">
      <div class="pp-h">${VS.pmark('lg', 'inv')}<div><b>${open ? 'Your Premium rooms' : 'Premium rooms'}</b><p>${open ? 'Open to you. Bring real numbers.' : 'Real numbers, offers and creative reviews from members who scale.'}</p></div>${open ? '' : `<a class="btn btn-l btn-sm" href="#premium">${icon('premium')}Go Premium</a>`}</div>
      <div class="pp-l">${rooms.map((r) => `<a class="pr ${r.unlocked ? '' : 'locked'}" href="#community/${r.id}" style="--rc:${esc(r.color || '#00A86B')}">${A.roomChip(r, 'lg')}<span class="pr-t"><b>${esc(r.name)}</b><small>${lastLine(r)}</small></span><span class="pr-r">${r.unlocked ? (r.unread ? `<span class="ub">${r.unread}</span>` : `${liveTag(r)}<span class="pr-go" data-live-off="${r.id}"${isLive(r) ? ' hidden' : ''}>${icon('arrow')}</span>`) : `<span class="fs">${A.faceStack(r.faces, 3, 'xs')}</span><span class="pr-lock">${icon('lock')}</span>`}</span></a>`).join('')}</div>
    </div>`;
  }
  /** Invite-only room: a feature with its cover, price and seats. */
  function inviteFeature(r) {
    const state = inviteState(r);
    const stateTxt = r.unlocked ? 'You are a member' : { pending: 'Application received', approved: A.NO_SALES ? 'Approved' : 'Approved · pay to join', waitlist: 'On the waitlist', rejected: 'Not this time', expired: 'Approval window closed' }[state] || '';
    const taken = Math.min(r.seats_taken || 0, r.seats || 0);
    return `<a class="ifc" href="#community/${r.id}">
      <span class="ifc-cov">${A.roomCover(r)}</span>
      <span class="ifc-b">
        <span class="ifc-k">${icon('lock')}Invite only${r.seats ? ` · ${r.seats} seats` : ''}</span>
        <b>${esc(r.name)}</b>
        <span class="ifc-d">${esc(r.description)}</span>
        ${r.seats ? `<span class="ifc-seats" aria-label="${taken} of ${r.seats} seats taken">${Array.from({ length: Math.min(r.seats, 40) }, (_, i) => `<i class="${i < Math.round((taken / r.seats) * Math.min(r.seats, 40)) ? 'on' : ''}"></i>`).join('')}</span>` : ''}
        <span class="ifc-f">${A.NO_SALES ? '' : `<span class="ifc-p">${esc(money0(r.price_usd))}<small>${esc(perLabel(r.period_days))}</small></span>`}${stateTxt ? `<span class="ifc-st">${esc(stateTxt)}</span>` : `<span class="btn btn-l btn-sm">See how to join</span>`}</span>
      </span></a>`;
  }

  function welcome(main) {
    const rooms = S.rooms || [];
    const ad = ((S.roomsMeta && S.roomsMeta.ads) || [])[0];
    // Phones: the compact sponsor card sits under the intro (on wide screens it closes the page), and can be hidden
    // for the rest of the session. Never inside a room.
    const phone = matchMedia('(max-width: 720px)').matches;
    let hidden = false; try { hidden = sessionStorage.getItem(AD_HIDE_KEY) === '1'; } catch { /* private mode */ }
    const adTop = !!ad && phone && !hidden && !!A.adCard(ad);
    const faces = recentFaces(rooms, 6);
    const start = rooms.find((r) => r.slug === 'introductions' && r.unlocked && r.can_post) || rooms.find((r) => r.unlocked && r.can_post);
    // The mosaic: four room pictures in a 2x2 square with a fifth raised as the exponent, like the VooSquare mark.
    const pics = rooms.filter((r) => A.safeImg(r.image));
    const exp = rooms.find((r) => r.approval_required && A.safeImg(r.image)) || pics[4];
    const grid = pics.filter((r) => r !== exp);
    const cell = (r, i) => `<span class="mz-c" style="--i:${i}" data-mz="${i}"><img src="${esc(r.image)}" alt="" decoding="async"></span>`;
    const mosaic = grid.length >= 4 ? `<div class="mz" aria-hidden="true">${grid.slice(0, 4).map(cell).join('')}${exp ? `<span class="mz-c mz-e" style="--i:4"><img src="${esc(exp.image)}" alt=""></span>` : ''}</div>` : '';

    // Sections by topic, in the team's order. The layout follows the rooms in each: premium rooms share a dark panel,
    // an invite-only room gets a feature, a topic with one room is a wide row (two of those sit side by side).
    const topics = [...new Set(rooms.map((r) => r.topic || 'Rooms'))];
    const blocks = topics.map((t) => {
      const list = rooms.filter((r) => (r.topic || 'Rooms') === t);
      const kind = list.every((r) => r.access === 'premium') ? 'prem' : list.some((r) => r.approval_required) && list.length === 1 ? 'invite' : list.length === 1 ? 'wide' : 'grid';
      return { t, list, kind };
    });
    const head = (b) => `<header class="cs-h"><h3>${esc(b.t)}</h3>${TOPIC_LINES[b.t] ? `<p>${esc(TOPIC_LINES[b.t])}</p>` : ''}</header>`;
    let html = '';
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      if (b.kind === 'wide' && blocks[i + 1] && blocks[i + 1].kind === 'wide') {
        const c = blocks[i + 1]; i++;
        html += `<div class="cs-pair"><section class="cs">${head(b)}${wideRow(b.list[0])}</section><section class="cs">${head(c)}${wideRow(c.list[0])}</section></div>`;
        continue;
      }
      const body = b.kind === 'prem' ? premiumPanel(b.list) : b.kind === 'invite' ? inviteFeature(b.list[0]) : b.kind === 'wide' ? wideRow(b.list[0]) : `<div class="rts n${Math.min(b.list.length, 4)}">${b.list.map((r, j) => tile(r, j === 0 && b.list.length === 3)).join('')}</div>`;
      html += `<section class="cs cs-${b.kind}">${head(b)}${body}</section>`;
    }

    main.innerHTML = `<div class="cm-welcome">
      <section class="ch">
        <div class="ch-t">
          <p class="ch-live" id="chLive">${liveLine(rooms)}</p>
          <h2>Talk shop with buyers who spend every day.</h2>
          <p class="ch-p">What worked, what failed and the numbers behind it, from buyers running Nigeria to South Africa and beyond.</p>
          <div class="ch-a">${start ? `<a class="btn btn-l" href="#community/${start.id}">${icon('wave')}Say hi in ${esc(start.name)}</a>` : ''}<button class="btn btn-ghost btn-sm ch-rules" data-rules>${icon('shield')}House rules</button></div>
          ${faces.length ? `<div class="ch-faces"><span class="fs">${A.faceStack(faces, 6, 'sm')}</span><small>Recently active</small></div>` : ''}
        </div>
        ${mosaic}
      </section>
      ${adTop ? `<div class="cm-ad cm-ad-m">${A.adCard(ad)}<button type="button" class="cm-ad-x" data-ad-x aria-label="Hide for now">${icon('x')}</button></div>` : ''}
      ${html}
      ${ad && !phone ? `<div class="cm-ad">${A.adCard(ad)}</div>` : ''}
    </div>`;
    const adX = main.querySelector('[data-ad-x]');
    if (adX) adX.addEventListener('click', () => { try { sessionStorage.setItem(AD_HIDE_KEY, '1'); } catch { /* private mode */ } const c = adX.closest('.cm-ad-m'); c.classList.add('out'); setTimeout(() => c.remove(), VS.reduce ? 0 : 260); });

    // Calm life: every few seconds one square of the mosaic turns to another room.
    if (!VS.reduce && grid.length > 4) {
      let k = 4;
      const iv = setInterval(() => {
        if (!main.isConnected || !main.querySelector('.mz')) { clearInterval(iv); return; }
        if (document.hidden) return;
        const c = main.querySelector(`[data-mz="${k % 4}"]`);
        const r = grid[k % grid.length];
        if (c && r) { const img = document.createElement('img'); img.src = r.image; img.alt = ''; img.className = 'in'; c.appendChild(img); setTimeout(() => { while (c.children.length > 1) c.firstChild.remove(); img.classList.remove('in'); }, 900); }
        k++;
      }, 3800);
    }
  }

  /* ---------------- room ---------------- */
  function openRoom(main, roomId, view) {
    const room = (S.rooms || []).find((r) => r.id === roomId);
    if (!room) { main.innerHTML = `<div class="cm-pad">${A.empty('chat', 'Room not found', 'It may have been archived.', '<a class="btn btn-w btn-sm" href="#community">All rooms</a>')}</div>`; return null; }
    A.setTitle(room.name);
    if (!room.unlocked) { lockedRoom(main, room); return null; }

    const st = { msgs: [], pinned: [], reactions: [], more: false, replyTo: null, pinIdx: 0, newCount: 0, slowUntil: 0, sending: false, closed: false };
    const staff = isStaff();
    main.innerHTML = `<div class="room" style="--rc:${esc(room.color || '#00A86B')}">
      <header class="room-h">
        <span class="room-cov" aria-hidden="true">${A.roomCover(room)}</span>
        <a class="room-back" href="#community" aria-label="All rooms">${icon('left')}</a>
        ${A.roomChip(room, 'lg')}
        <div class="room-ht"><h3>${esc(room.name)}</h3><p><span class="room-on"><i class="on-dot"></i><span id="rOn">${room.online || 1}</span> online</span>${room.read_only ? `<span class="room-note">${icon('megaphone')}Team posts only</span>` : ''}${room.slow_secs ? `<span class="room-note">${icon('clock')}Slow mode ${room.slow_secs}s</span>` : ''}<span class="room-desc">${esc(room.description)}</span></p></div>
        ${(room.faces || []).length ? `<span class="room-faces fs" title="Recently active here">${A.faceStack(room.faces, 4, 'sm')}</span>` : ''}
        <button class="ib room-rules" data-rules aria-label="House rules">${icon('shield')}</button>
      </header>
      <div class="pinbar" id="pinbar" hidden></div>
      <div class="msgs" id="msgs" role="log" aria-live="polite"><div class="msgs-in" id="msgsIn">${Array.from({ length: 6 }, (_, i) => `<div class="msg-sk">${A.skel(40, '40px', 20)}<div>${A.skel(12, (30 + i * 7) + '%')}${A.skel(14, (55 + (i % 3) * 12) + '%')}</div></div>`).join('')}</div></div>
      <button class="newpill" id="newPill" hidden>${icon('down')}<span>New messages</span></button>
      <div class="composer" id="composer"></div>
    </div>`;
    const box = main.querySelector('#msgs');
    const inner = main.querySelector('#msgsIn');
    const pill = main.querySelector('#newPill');
    const comp = main.querySelector('#composer');
    const pinbar = main.querySelector('#pinbar');

    /* ---- composer ---- */
    function paintComposer() {
      if (!room.can_post) {
        comp.innerHTML = `<div class="comp-ro">${icon('megaphone')}<span>${room.read_only ? 'Only the team posts in this room. Reply in General or Introductions.' : 'You cannot post in this room.'}</span></div>`;
        return;
      }
      const img = !!room.can_image && !!window.VSM;
      comp.innerHTML = `<div class="att-host" id="cAtt" hidden></div><div class="comp-reply" id="cReply" hidden></div>
        <div class="comp-row">${img ? `<button class="comp-att" id="cAttB" type="button" aria-label="Add a photo" title="Add a photo">${icon('image')}</button>` : ''}<textarea id="cIn" rows="1" maxlength="2000" placeholder="Message ${esc(room.name)}" aria-label="Write a message"></textarea><button class="comp-send" id="cSend" aria-label="Send">${icon('send')}</button></div>
        <div class="comp-meta"><span id="cSlow"></span><span class="comp-hint">Enter to send · Shift+Enter for a new line</span></div>`;
      const ta = comp.querySelector('#cIn');
      st.att = img ? VSM.attacher({ btn: comp.querySelector('#cAttB'), chipHost: comp.querySelector('#cAtt'), purpose: 'chat', onChange: (s) => { ta.placeholder = s.has ? 'Add a caption (optional)' : `Message ${room.name}`; } }) : null;
      if (st.att) {
        // Paste a screenshot or drop an image on the composer.
        ta.addEventListener('paste', (e) => { const f = VSM.fileFrom(e.clipboardData); if (f) { e.preventDefault(); st.att.add(f); } });
        const row = comp.querySelector('.comp-row');
        row.addEventListener('dragover', (e) => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); row.classList.add('drag'); } });
        row.addEventListener('dragleave', () => row.classList.remove('drag'));
        row.addEventListener('drop', (e) => { row.classList.remove('drag'); const f = VSM.fileFrom(e.dataTransfer); if (f) { e.preventDefault(); st.att.add(f); } });
      }
      const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; };
      ta.addEventListener('input', grow);
      // A summary shared from Tools lands here as a draft; the member reads it and sends it.
      if (A.toolDraft && A.toolDraft.room_id === room.id) { ta.value = String(A.toolDraft.text || '').slice(0, 2000); A.toolDraft = null; requestAnimationFrame(() => { grow(); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }); }
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
        if (e.key === 'Escape' && st.replyTo) setReply(null);
      });
      comp.querySelector('#cSend').addEventListener('click', send);
      // keep the latest message visible when the keyboard opens
      ta.addEventListener('focus', () => { if (atBottom(200)) setTimeout(() => scrollBottom(), 250); });
      slowTick();
    }
    function setReply(m) {
      st.replyTo = m;
      const r = comp.querySelector('#cReply');
      if (!r) return;
      if (!m) { r.hidden = true; r.innerHTML = ''; return; }
      r.hidden = false;
      r.innerHTML = `${icon('reply')}<span>Replying to <b>${esc(m.user.name)}</b> <em>${esc(((m.attachment ? 'Photo' + (m.body ? ' · ' : '') : '') + (m.body || '')).slice(0, 90))}</em></span><button aria-label="Cancel reply" data-cancel-reply>${icon('x')}</button>`;
      comp.querySelector('#cIn').focus();
    }
    let slowIv = null;
    function slowTick() {
      const span = comp.querySelector('#cSlow');
      const btn = comp.querySelector('#cSend');
      const ta = comp.querySelector('#cIn');
      if (!span) return;
      const left = Math.ceil((st.slowUntil - Date.now()) / 1000);
      if (left > 0) {
        span.innerHTML = `${icon('clock')}Slow mode: you can post again in ${left}s`;
        span.className = 'slow on';
        btn.disabled = true; ta.placeholder = `Wait ${left}s`;
        if (!slowIv) slowIv = setInterval(slowTick, 1000);
      } else {
        span.innerHTML = ''; span.className = '';
        btn.disabled = false; ta.placeholder = `Message ${room.name}`;
        clearInterval(slowIv); slowIv = null;
      }
    }
    async function send() {
      const ta = comp.querySelector('#cIn');
      if (!ta || st.sending) return;
      const body = ta.value.trim();
      const hasImg = !!(st.att && st.att.has());
      if (!body && !hasImg) { ta.focus(); return; }
      if (st.slowUntil > Date.now()) return;
      st.sending = true;
      comp.querySelector('#cSend').classList.add('loading');
      try {
        const upl = hasImg ? await st.att.get() : null;
        const d = await VS.api(`/api/rooms/${room.id}/messages`, { body: { body, reply_to: st.replyTo ? st.replyTo.id : null, upload_id: upl ? upl.id : undefined } });
        ta.value = ''; ta.style.height = 'auto';
        if (st.att) st.att.sent();
        setReply(null);
        addMessage(d.message, true);
        if (room.slow_secs && !staff) { st.slowUntil = Date.now() + room.slow_secs * 1000; slowTick(); }
      } catch (e) {
        const m = /(\d+)s/.exec(e.message || '');
        if (e.status === 429 && m && /slow/i.test(e.message)) { st.slowUntil = Date.now() + Number(m[1]) * 1000; slowTick(); }
        A.errToast(e);
      } finally {
        st.sending = false;
        const b = comp.querySelector('#cSend'); if (b) b.classList.remove('loading');
      }
    }

    /* ---- messages ---- */
    // The three reactions offered right on the message (the full set is one tap further).
    const quick = () => (st.reactions.length ? st.reactions : ['🔥', '👍', '💯']).slice(0, 3);
    const sameGroup = (a, b) => a && b && !a.deleted && !b.deleted && a.user.id === b.user.id && b.created_at - a.created_at < GROUP_MS && !b.reply && dayKey(a.created_at) === dayKey(b.created_at);
    function msgHtml(m, prev, fresh) {
      const cont = sameGroup(prev, m);
      const mine = m.user.id === S.user.id;
      const div = !prev || dayKey(prev.created_at) !== dayKey(m.created_at) ? `<div class="daydiv" data-day="${dayKey(m.created_at)}"><span>${esc(dayLabel(m.created_at))}</span></div>` : '';
      const canDel = !m.deleted && (mine || staff);
      const hid = !m.deleted && m.hidden; // reported by me, or hidden for review (src/ugc.js)
      const others = !mine && !m.deleted && !hid;
      return `${div}<div class="msg ${cont ? 'cont' : ''} ${mine ? 'mine' : ''} ${m.pinned ? 'pinned' : ''} ${m.deleted ? 'deleted' : ''} ${hid ? 'hid' : ''} ${fresh ? 'fresh' : ''}" data-id="${m.id}">
        <div class="msg-av">${cont ? `<time class="msg-th">${VS.timeStr(m.created_at)}</time>` : `<button class="av av-md" data-member="${m.user.id}" aria-label="${esc(m.user.name)}">${VS.avatar(m.user.avatar)}</button>`}</div>
        <div class="msg-b">
          ${cont ? '' : `<div class="msg-h"><button class="msg-n" data-member="${m.user.id}">${esc(m.user.name)}</button>${m.user.handle ? `<span class="msg-hd">@${esc(m.user.handle)}</span>` : ''}${A.badges(m.user)}<time data-t="${m.created_at}" title="${esc(new Date(m.created_at).toLocaleString())}">${esc(relTime(m.created_at))}</time></div>`}
          <div class="mbub ${m.attachment && !m.deleted ? 'has-img' : ''} ${m.body || m.deleted || hid || m.reply ? '' : 'img-only'}">
          ${m.reply ? `<button class="msg-q" data-jump="${m.reply.id}">${icon('reply')}<b>${esc(m.reply.name)}</b><span>${esc(m.reply.body)}</span></button>` : ''}
          ${!m.deleted && m.attachment && window.VSM ? VSM.thumb(m.attachment, { maxW: 320, maxH: 300 }) : ''}
          ${m.body || m.deleted || hid ? `<div class="msg-t">${m.deleted ? `<i class="msg-del">${icon('trash')}Message deleted</i>` : hid ? `<i class="msg-del">${icon('flag')}${m.hidden === 'reported' ? 'You reported this message' : 'Hidden while our team reviews it'}</i>` : A.richText(m.body)}</div>` : ''}
          </div>
          ${m.pinned ? `<span class="msg-pin">${icon('pin')}Pinned</span>` : ''}${m.in_review && !m.deleted ? `<span class="msg-pin msg-rev">${icon('flag')}Hidden for members · in review</span>` : ''}
          ${!m.deleted && m.reactions.length ? `<div class="rx">${m.reactions.map((r) => `<button class="rxc ${r.mine ? 'on' : ''}" data-rx="${esc(r.emoji)}" aria-pressed="${r.mine}"><span class="rxe">${esc(r.emoji)}</span><b>${r.n}</b></button>`).join('')}<button class="rxc add" data-rxpick aria-label="Add reaction">${icon('smile')}</button></div>` : ''}
        </div>
        ${m.deleted || hid ? '' : `<div class="msg-act" role="toolbar" aria-label="Message actions">
          ${quick().map((e) => `<button class="qr" data-rx="${esc(e)}" aria-label="React ${esc(e)}">${esc(e)}</button>`).join('')}<i class="ma-sep"></i>
          <button data-rxpick aria-label="More reactions" title="More reactions">${icon('smile')}</button>
          ${room.can_post ? `<button data-reply aria-label="Reply" title="Reply">${icon('reply')}</button>` : ''}
          ${staff ? `<button data-pin aria-label="${m.pinned ? 'Unpin' : 'Pin'}" title="${m.pinned ? 'Unpin' : 'Pin'}">${icon('pin')}</button>` : ''}
          ${others ? `<button data-report aria-label="Report" title="Report">${icon('flag')}</button>` : ''}
          ${others && !m.user.staff ? `<button data-block aria-label="Block ${esc(m.user.name)}" title="Block">${icon('block')}</button>` : ''}
          ${canDel ? `<button data-del class="danger" aria-label="Delete" title="Delete">${icon('trash')}</button>` : ''}
        </div>`}
      </div>`;
    }
    function paintAll(keepScroll) {
      const prevH = box.scrollHeight, prevTop = box.scrollTop;
      let html = st.more ? `<div class="older"><button class="btn btn-w btn-xs" id="older">${icon('up')}Load older messages</button></div>` : `<div class="room-start" style="--rc:${esc(room.color || '#00A86B')}">${A.roomCover(room) ? `<span class="rs-art">${A.roomCover(room)}</span>` : A.roomChip(room, 'xl')}<h4>This is the start of ${esc(room.name)}</h4><p>${esc(room.description)}</p></div>`;
      st.msgs.forEach((m, i) => { html += msgHtml(m, st.msgs[i - 1]); });
      if (!st.msgs.length) html += `<div class="room-empty"><b>No messages yet</b><p>${room.can_post ? 'Say what you run and what you want to learn. Someone will reply.' : 'The team will post here soon.'}</p></div>`;
      inner.innerHTML = html;
      if (keepScroll) box.scrollTop = prevTop + (box.scrollHeight - prevH);
    }
    function repaintOne(id) {
      const i = st.msgs.findIndex((m) => m.id === id);
      const node = inner.querySelector(`.msg[data-id="${id}"]`);
      if (i < 0 || !node) return;
      const tmp = A.el(`<div>${msgHtml(st.msgs[i], st.msgs[i - 1])}</div>`);
      const fresh = tmp.querySelector('.msg');
      node.replaceWith(fresh);
    }
    const atBottom = (px = 90) => box.scrollHeight - box.scrollTop - box.clientHeight < px;
    const scrollBottom = (smooth) => { box.scrollTo({ top: box.scrollHeight, behavior: smooth && !VS.reduce ? 'smooth' : 'auto' }); };
    function addMessage(m, mine) {
      if (st.msgs.some((x) => x.id === m.id)) return;
      const stick = mine || atBottom();
      const prev = st.msgs[st.msgs.length - 1];
      st.msgs.push(m);
      const emptyEl = inner.querySelector('.room-empty');
      if (emptyEl) emptyEl.remove();
      inner.insertAdjacentHTML('beforeend', msgHtml(m, prev, true));
      if (stick) { scrollBottom(true); markRead(); }
      else { st.newCount++; pill.hidden = false; pill.querySelector('span').textContent = st.newCount === 1 ? '1 new message' : `${st.newCount} new messages`; }
    }
    function paintPins() {
      const p = st.pinned;
      if (!p.length) { pinbar.hidden = true; return; }
      st.pinIdx = st.pinIdx % p.length;
      const m = p[st.pinIdx];
      pinbar.hidden = false;
      pinbar.innerHTML = `<button class="pin-in" data-jump="${m.id}" data-cycle>${icon('pin')}<span class="pin-t"><b>Pinned${p.length > 1 ? ` ${st.pinIdx + 1} of ${p.length}` : ''}</b> <span>${esc(m.user.name)}: ${esc(m.body || (m.attachment ? 'Photo' : ''))}</span></span></button>`;
    }
    let readT = 0, readTimer = null;
    function markRead() {
      const last = st.msgs[st.msgs.length - 1];
      if (!last || document.hidden) return;
      const doIt = () => { readT = Date.now(); VS.api(`/api/rooms/${room.id}/read`, { body: { last_id: last.id } }).catch(() => {}); };
      if (room.unread) { room.unread = 0; A.emit('rooms'); A.recountRooms(); }
      clearTimeout(readTimer);
      if (Date.now() - readT > 1500) doIt(); else readTimer = setTimeout(doIt, 1500);
    }

    async function load() {
      try {
        const d = await VS.api(`/api/rooms/${room.id}/messages`);
        if (st.closed) return;
        Object.assign(room, d.room);
        st.msgs = d.messages; st.pinned = d.pinned; st.reactions = d.reactions || []; st.more = d.more;
        main.querySelector('#rOn').textContent = Math.max(1, d.room.online || 1);
        paintComposer(); paintAll(); paintPins();
        scrollBottom();
        // fonts and avatars can change heights after first paint
        requestAnimationFrame(() => scrollBottom());
        markRead();
      } catch (e) {
        if (e.status === 403 && e.data && e.data.locked) { Object.assign(room, e.data.room); lockedRoom(main, room); return; }
        inner.innerHTML = A.errorBox(e.message);
      }
    }
    async function older(btn) {
      const first = st.msgs[0];
      if (!first) return;
      await A.busy(btn, async () => {
        try {
          const d = await VS.api(`/api/rooms/${room.id}/messages?before=${first.id}`);
          st.msgs = [...d.messages.filter((m) => !st.msgs.some((x) => x.id === m.id)), ...st.msgs];
          st.more = d.more;
          paintAll(true);
        } catch (e) { A.errToast(e); }
      });
    }

    /* ---- reactions ---- */
    async function react(m, emoji) {
      const r = m.reactions.find((x) => x.emoji === emoji);
      if (r) { r.mine = !r.mine; r.n += r.mine ? 1 : -1; if (r.n <= 0) m.reactions = m.reactions.filter((x) => x !== r); }
      else m.reactions.push({ emoji, n: 1, mine: true });
      repaintOne(m.id);
      const chip = inner.querySelector(`.msg[data-id="${m.id}"] .rxc[data-rx="${CSS.escape(emoji)}"]`);
      if (chip) chip.classList.add('bump');
      try {
        const d = await VS.api(`/api/messages/${m.id}/react`, { body: { emoji } });
        applyCounts(m, d.reactions);
      } catch (e) { A.errToast(e); }
    }
    function applyCounts(m, counts, by, emoji, added) {
      const mine = new Set(m.reactions.filter((x) => x.mine).map((x) => x.emoji));
      if (by === S.user.id && emoji) { if (added) mine.add(emoji); else mine.delete(emoji); }
      m.reactions = counts.map((c) => ({ emoji: c.emoji, n: c.n, mine: mine.has(c.emoji) }));
      repaintOne(m.id);
    }
    let picker = null;
    function closePicker() { if (picker) { picker.remove(); picker = null; } }
    function openPicker(anchor, m) {
      closePicker();
      const list = st.reactions.length ? st.reactions : ['🔥', '👍', '💯'];
      picker = A.el(`<div class="rxpick" role="menu">${list.map((e) => `<button role="menuitem" data-pick="${esc(e)}" aria-label="React ${esc(e)}">${esc(e)}</button>`).join('')}</div>`);
      document.body.appendChild(picker);
      const r = anchor.getBoundingClientRect();
      const w = picker.offsetWidth, hgt = picker.offsetHeight;
      picker.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
      picker.style.top = (r.top - hgt - 8 < 8 ? r.bottom + 8 : r.top - hgt - 8) + 'px';
      picker.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b) { react(m, b.dataset.pick); closePicker(); } });
    }
    const onDocDown = (e) => { if (picker && !picker.contains(e.target) && !e.target.closest('[data-rxpick]')) closePicker(); };
    document.addEventListener('pointerdown', onDocDown);

    /* ---- message actions ---- */
    async function del(m) {
      const ok = await A.ask('Delete this message?', 'It will be removed for everyone in the room.', { ok: 'Delete', danger: true });
      if (!ok) return;
      try { await VS.api(`/api/messages/${m.id}`, { method: 'DELETE' }); markDeleted(m.id); } catch (e) { A.errToast(e); }
    }
    function markDeleted(id) {
      const m = st.msgs.find((x) => x.id === id);
      if (m) { m.deleted = true; m.body = ''; m.attachment = null; m.pinned = false; m.reactions = []; repaintOne(id); }
      st.pinned = st.pinned.filter((x) => x.id !== id); paintPins();
    }
    async function pin(m) {
      try {
        const d = await VS.api(`/api/messages/${m.id}/pin`, { body: {} });
        applyPin(m.id, d.pinned);
        VS.toast(d.pinned ? 'Message pinned' : 'Message unpinned');
      } catch (e) { A.errToast(e); }
    }
    function applyPin(id, pinned) {
      const m = st.msgs.find((x) => x.id === id);
      if (m) { m.pinned = pinned; repaintOne(id); }
      if (pinned) { if (m && !st.pinned.some((x) => x.id === id)) st.pinned.unshift(m); else if (!m) refreshPins(); }
      else st.pinned = st.pinned.filter((x) => x.id !== id);
      st.pinned = st.pinned.slice(0, 3); st.pinIdx = 0; paintPins();
    }
    /* ---- safety: report and block ---- */
    async function report(m) {
      if (await reportSheet(m)) setHidden(m.id, 'reported');
    }
    function setHidden(id, why) {
      const m = st.msgs.find((x) => x.id === id);
      if (m && !m.deleted) {
        if (staff) m.in_review = true;
        else { m.hidden = m.hidden === 'reported' ? 'reported' : why; m.body = ''; m.attachment = null; m.reactions = []; }
        repaintOne(id);
      }
      if (!staff) { st.pinned = st.pinned.filter((x) => x.id !== id); paintPins(); }
    }
    function dropAuthor(uid) {
      if (!st.msgs.some((x) => x.user.id === uid) && !st.pinned.some((x) => x.user.id === uid)) return;
      st.msgs = st.msgs.filter((x) => x.user.id !== uid);
      st.pinned = st.pinned.filter((x) => x.user.id !== uid);
      paintAll(true); paintPins();
    }
    async function refreshPins() { try { const d = await VS.api(`/api/rooms/${room.id}/messages`); st.pinned = d.pinned; paintPins(); } catch { /* ignore */ } }
    function jump(id) {
      const node = inner.querySelector(`.msg[data-id="${id}"]`);
      if (!node) { VS.toast('That message is further up. Load older messages to see it.'); return; }
      node.scrollIntoView({ block: 'center', behavior: VS.reduce ? 'auto' : 'smooth' });
      node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash');
    }
    function actionSheet(m) {
      const mine = m.user.id === S.user.id;
      const s = A.modal(`<div class="as-rx">${(st.reactions.length ? st.reactions : ['👍']).map((e) => `<button data-pick="${esc(e)}" aria-label="React ${esc(e)}">${esc(e)}</button>`).join('')}</div>
        <div class="as-list">
          ${room.can_post ? `<button data-a="reply">${icon('reply')}Reply</button>` : ''}
          ${m.body ? `<button data-a="copy">${icon('copy')}Copy text</button>` : ''}
          ${m.attachment ? `<button data-a="photo">${icon('image')}Open photo</button>` : ''}
          ${staff ? `<button data-a="pin">${icon('pin')}${m.pinned ? 'Unpin' : 'Pin message'}</button>` : ''}
          ${mine ? '' : `<button data-a="report">${icon('flag')}Report</button>`}
          ${mine || m.user.staff ? '' : `<button data-a="block">${icon('block')}Block ${esc(firstName(m.user.name))}</button>`}
          ${mine || staff ? `<button data-a="del" class="danger">${icon('trash')}Delete</button>` : ''}
        </div>`, { cls: 'am-actions-sheet' });
      s.el.addEventListener('click', (e) => {
        const p = e.target.closest('[data-pick]');
        if (p) { react(m, p.dataset.pick); s.close(); return; }
        const b = e.target.closest('[data-a]');
        if (!b) return;
        s.close();
        if (b.dataset.a === 'reply') setReply(m);
        if (b.dataset.a === 'copy') VS.copyText(m.body);
        if (b.dataset.a === 'photo' && m.attachment) VSM.lightbox(m.attachment.url, m.attachment);
        if (b.dataset.a === 'pin') pin(m);
        if (b.dataset.a === 'del') del(m);
        if (b.dataset.a === 'report') report(m);
        if (b.dataset.a === 'block') A.blockMember(m.user);
      });
    }

    /* ---- events ---- */
    const msgOf = (t) => { const n = t.closest('.msg'); return n ? st.msgs.find((x) => x.id === Number(n.dataset.id)) : null; };
    main.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('#older')) { older(t.closest('#older')); return; }
      if (t.closest('[data-cancel-reply]')) { setReply(null); return; }
      if (t.closest('[data-rules]')) { showRules(); return; }
      const mem = t.closest('[data-member]');
      if (mem) { A.memberCard(Number(mem.dataset.member), mem); return; }
      const j = t.closest('[data-jump]');
      if (j) { if (j.hasAttribute('data-cycle') && st.pinned.length > 1) { jump(Number(j.dataset.jump)); st.pinIdx++; setTimeout(paintPins, 400); } else jump(Number(j.dataset.jump)); return; }
      const m = msgOf(t);
      if (!m) return;
      const rx = t.closest('[data-rx]');
      if (rx) { react(m, rx.dataset.rx); return; }
      if (t.closest('[data-rxpick]')) { openPicker(t.closest('[data-rxpick]'), m); return; }
      if (t.closest('[data-reply]')) { setReply(m); return; }
      if (t.closest('[data-del]')) { del(m); return; }
      if (t.closest('[data-report]')) { report(m); return; }
      if (t.closest('[data-block]')) { A.blockMember(m.user); return; }
      if (t.closest('[data-pin]')) { pin(m); }
    });
    // long-press on touch opens the action sheet
    let lp = null, lpXY = null, lpFired = false;
    main.addEventListener('touchstart', (e) => {
      lpFired = false;
      const n = e.target.closest('.msg:not(.deleted):not(.hid)');
      if (!n || e.target.closest('button,a')) return;
      lpXY = [e.touches[0].clientX, e.touches[0].clientY];
      lp = setTimeout(() => { const m = msgOf(n); if (m) { lpFired = true; if (navigator.vibrate) navigator.vibrate(10); actionSheet(m); } lp = null; }, 450);
    }, { passive: true });
    const cancelLp = (e) => { if (!lp) return; if (e.type === 'touchmove' && lpXY && Math.hypot(e.touches[0].clientX - lpXY[0], e.touches[0].clientY - lpXY[1]) < 10) return; clearTimeout(lp); lp = null; };
    main.addEventListener('touchmove', cancelLp, { passive: true });
    // Lifting the finger after the sheet opened must not turn into a tap on the sheet's backdrop (which would close it).
    main.addEventListener('touchend', (e) => { if (lpFired) { lpFired = false; if (e.cancelable) e.preventDefault(); return; } cancelLp(e); });
    main.addEventListener('contextmenu', (e) => { if (e.target.closest('.msg') && matchMedia('(hover: none)').matches) e.preventDefault(); });

    box.addEventListener('scroll', () => {
      if (atBottom()) { if (!pill.hidden) { pill.hidden = true; st.newCount = 0; } markRead(); }
      closePicker();
    }, { passive: true });
    pill.addEventListener('click', () => { scrollBottom(true); pill.hidden = true; st.newCount = 0; markRead(); });
    const onVis = () => { if (!document.hidden && atBottom()) markRead(); };
    document.addEventListener('visibilitychange', onVis);
    const timeIv = setInterval(() => inner.querySelectorAll('time[data-t]').forEach((t) => { t.textContent = relTime(Number(t.dataset.t)); }), 60_000);

    const live = VS.stream(['room:' + room.id, 'community'], {
      message: (m) => { if (m.room_id === room.id) addMessage(m, m.user.id === S.user.id && atBottom(300)); },
      delete: (d) => markDeleted(d.id),
      react: (d) => { const m = st.msgs.find((x) => x.id === d.id); if (m) applyCounts(m, d.reactions, d.by, d.emoji, d.added); },
      pin: (d) => applyPin(d.id, d.pinned),
      hide: (d) => setHidden(d.id, 'review'), // reported by several members: hidden until the team reviews it
    });
    const offBlocked = A.on('blocked', dropAuthor);

    load();
    return () => {
      st.closed = true;
      if (st.att) st.att.destroy();
      live.close(); offBlocked(); clearInterval(timeIv); clearInterval(slowIv); clearTimeout(readTimer);
      document.removeEventListener('pointerdown', onDocDown);
      document.removeEventListener('visibilitychange', onVis);
      closePicker();
    };
  }

  /* ---------------- locked room ---------------- */
  function lockedRoom(main, room) {
    if (room.access === 'paid' && room.approval_required) { inviteRoom(main, room); return; }
    const paid = room.access === 'paid';
    main.innerHTML = `<div class="room locked" style="--rc:${esc(room.color || '#00A86B')}">
      <header class="room-h"><a class="room-back" href="#community" aria-label="All rooms">${icon('left')}</a>${A.roomChip(room, 'lg')}<div class="room-ht"><h3>${esc(room.name)}</h3><p><span class="room-desc">${esc(room.description)}</span></p></div></header>
      <div class="lock-wrap">${paid ? `<div class="paid-card">
          ${A.roomCover(room) ? `<span class="lk-cov" aria-hidden="true">${A.roomCover(room)}</span>` : ''}
          <div class="pc-art" aria-hidden="true">${A.roomChip(room, 'xl')}<span class="pc-lock">${icon('lock')}</span></div>
          <span class="kick">Paid room</span><h3>${esc(room.name)}</h3><p>${esc(room.description)}</p>
          ${A.NO_SALES ? '<p class="muted small">Paid rooms are not available in this app.</p>' : `<div class="pc-price"><b>$${VS.fmt(room.price_usd, room.price_usd % 1 ? 2 : 0)}</b><span>${room.period_days ? `for ${room.period_days} days of access` : 'one payment, lifetime access'}</span></div>
          <button class="btn btn-k btn-block" data-buy>${icon('card')}Get access</button>
          <p class="muted small">Paid once per period. No auto-renew. Access starts as soon as the payment is confirmed.</p>`}
        </div>` : `<div class="lk-prem">${A.roomCover(room) ? `<span class="lk-cov" aria-hidden="true">${A.roomCover(room)}<span class="lk-pic">${A.roomChip(room, 'xl')}</span></span>` : ''}${(room.faces || []).length ? `<p class="lk-faces"><span class="fs">${A.faceStack(room.faces, 4, 'sm')}</span><small>Members talking in here this week</small></p>` : ''}${A.premiumUpsell(`${room.name} is a Premium room`, 'Premium rooms are where working buyers share live numbers, offers and creative reviews. Go Premium to join the conversation.')}</div>`}</div>
    </div>`;
    const b = main.querySelector('[data-buy]');
    if (b) b.addEventListener('click', () => A.checkout({ item: 'room', room_id: room.id, name: room.name, usd: room.price_usd, period: room.period_days }));
  }

  /* ---------------- invite-only room (apply, review, pay) ---------------- */
  const money0 = (n) => `$${VS.fmt(n, n % 1 ? 2 : 0)}`;
  const perLabel = (d) => (!d ? 'one payment' : d === 30 ? '/ month' : `/ ${d} days`);
  const dLong = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });
  const daysLeft = (t) => Math.max(0, Math.ceil((t - Date.now()) / 86400000));
  const isFounderRoom = (r) => /dchessking/i.test(r.name || '');

  /** Where the member is: apply | pending | approved | waitlist | rejected | expired. */
  function inviteState(room) {
    const a = room.application;
    if (!a || a.status === 'withdrawn') return 'apply';
    if (a.status === 'approved') return a.waitlist ? 'waitlist' : 'approved';
    return a.status; // pending, rejected, expired
  }

  function seatsHtml(room) {
    if (!room.seats) return '';
    const taken = Math.min(room.seats_taken || 0, room.seats);
    const cols = room.seats <= 16 ? room.seats : Math.ceil(room.seats / Math.ceil(room.seats / 16));
    const dots = room.seats <= 40 ? `<div class="ic-dots" style="--cols:${cols}" aria-hidden="true">${Array.from({ length: room.seats }, (_, i) => `<i class="${i < taken ? 'on' : ''}" style="--i:${i}"></i>`).join('')}</div>` : `<div class="ic-bar" aria-hidden="true"><i style="width:${Math.round((taken / room.seats) * 100)}%"></i></div>`;
    const left = room.seats_left;
    return `<div class="ic-seats"><div class="ic-seats-t"><span><b>${taken}</b> of ${room.seats} seats taken</span><span class="${left ? '' : 'full'}">${left ? `${left} left` : 'Full · waitlist open'}</span></div>${dots}</div>`;
  }

  function statusHtml(room, state) {
    const a = room.application || {};
    const price = money0(room.price_usd);
    const note = a.note ? `<blockquote class="ic-note"><small>A note from the team</small><p>${esc(a.note)}</p></blockquote>` : '';
    switch (state) {
      case 'pending':
        return `<div class="ic-st pend"><span class="ic-st-ic">${icon('clock')}</span><div><b>Application received</b><p>We reply within 48 hours, by email and here. Sent ${Date.now() - a.created_at < 60000 ? 'just now' : esc(VS.timeAgo(a.created_at)) + ' ago'}.</p></div></div>
          <button class="btn btn-ghost btn-sm ic-wd" data-withdraw>Withdraw application</button>`;
      case 'approved':
        return `<div class="ic-st ok"><span class="ic-st-ic">${icon('check')}</span><div><b>You're approved</b><p>Your seat is held until <b>${esc(dLong(a.approved_until))}</b>${daysLeft(a.approved_until) <= 7 ? ` · ${daysLeft(a.approved_until)} ${daysLeft(a.approved_until) === 1 ? 'day' : 'days'} left` : ''}.</p></div></div>${note}
          ${A.NO_SALES ? '<p class="ic-fine">Paid rooms are not available in this app.</p>' : `<button class="btn btn-l btn-block ic-cta" data-pay>${icon('card')}Pay ${price} to join</button>
          <p class="ic-fine">Paid once per period. No auto-renew. Access starts as soon as the payment is confirmed.</p>`}`;
      case 'waitlist':
        return `<div class="ic-st wait"><span class="ic-st-ic">${icon('users')}</span><div><b>Approved · on the waitlist</b><p>Every seat is taken right now. We'll tell you when a seat opens and hold it for 7 days.</p></div></div>${note}
          <button class="btn btn-ghost btn-sm ic-wd" data-withdraw>Leave the waitlist</button>`;
      case 'rejected': {
        const can = a.reapply_at && a.reapply_at <= Date.now();
        return `<div class="ic-st no"><span class="ic-st-ic">${icon('x')}</span><div><b>Not this time</b><p>${can ? 'You can apply again now.' : `You can apply again from <b>${esc(dLong(a.reapply_at))}</b>.`}</p></div></div>${note}
          ${can ? `<button class="btn btn-l btn-block ic-cta" data-apply>${icon('send')}Apply again</button>` : '<a class="btn btn-w btn-block" href="#premium">See what Premium includes</a>'}`;
      }
      case 'expired':
        return `<div class="ic-st no"><span class="ic-st-ic">${icon('clock')}</span><div><b>Your approval window closed</b><p>The seat went to the next person. Apply again and the team will take another look.</p></div></div>
          <button class="btn btn-l btn-block ic-cta" data-apply>${icon('send')}Apply again</button>`;
      default:
        return `<button class="btn btn-l btn-block ic-cta" data-apply>${icon('send')}Apply to join</button>
          ${A.NO_SALES ? '' : '<p class="ic-fine">Takes two minutes. Nothing to pay unless you are approved.</p>'}`;
    }
  }

  function inviteRoom(main, room) {
    const state = inviteState(room);
    const step = { apply: 0, expired: 0, rejected: 1, pending: 1, waitlist: 2, approved: 2 }[state] || 0;
    const steps = ['Apply', 'Team review', A.NO_SALES ? 'Join' : 'Pay and join'];
    const founder = isFounderRoom(room);
    main.innerHTML = `<div class="room locked" style="--rc:${esc(room.color || '#111312')}">
      <header class="room-h"><a class="room-back" href="#community" aria-label="All rooms">${icon('left')}</a>${A.roomChip(room, 'lg')}<div class="room-ht"><h3>${esc(room.name)}</h3><p><span class="room-desc">Invite only${room.seats ? ` · ${room.seats} seats` : ''}</span></p></div></header>
      <div class="lock-wrap"><div class="ic-card" data-state="${state}">
        ${A.roomCover(room) ? `<span class="ic-cov" aria-hidden="true">${A.roomCover(room)}</span>` : '<div class="gridbg"></div>'}<span class="ic-glow" aria-hidden="true"></span>
        <div class="ic-head">
          <div class="ic-art" aria-hidden="true">${founder ? `<span class="ic-face">${VS.founder(true).replace(/<g transform="translate\(100 34\)">[\s\S]*?<\/g>/, '')}</span><span class="ic-crown">${icon('lock')}</span>` : A.roomChip(room, 'xl')}</div>
          <div class="ic-ht"><span class="ic-kick">${icon('lock')}Invite only</span><h3>${esc(room.name)}</h3></div>
        </div>
        <p class="ic-desc">${esc(room.description)}</p>
        ${A.NO_SALES ? '' : `<div class="ic-price"><b>${money0(room.price_usd)}</b><span>${esc(perLabel(room.period_days))}</span><em>after approval</em></div>`}
        ${seatsHtml(room)}
        <ol class="ic-steps" aria-label="How joining works">${steps.map((t, i) => `<li class="${i < step ? 'done' : i === step ? 'cur' : ''}"><i>${i < step ? icon('check') : i + 1}</i><span>${t}</span></li>`).join('')}</ol>
        <div class="ic-act" aria-live="polite">${statusHtml(room, state)}</div>
      </div></div>
    </div>`;
    const card = main.querySelector('.ic-card');
    const refresh = (r) => { if (r) Object.assign(room, r); const i = (S.rooms || []).findIndex((x) => x.id === room.id); if (i >= 0 && r) S.rooms[i] = Object.assign(S.rooms[i], r); A.emit('rooms'); inviteRoom(main, room); };
    card.addEventListener('click', async (e) => {
      if (e.target.closest('[data-apply]')) applySheet(room, refresh);
      if (e.target.closest('[data-pay]')) A.checkout({ item: 'room', room_id: room.id, name: room.name, usd: room.price_usd, period: room.period_days });
      const wd = e.target.closest('[data-withdraw]');
      if (wd) {
        const ok = await A.ask(state === 'waitlist' ? 'Leave the waitlist?' : 'Withdraw your application?', state === 'waitlist' ? 'You give up your approval. To come back later, you apply again.' : 'The team will not review it. You can apply again later.', { ok: state === 'waitlist' ? 'Leave' : 'Withdraw', danger: true });
        if (!ok) return;
        try { const d = await VS.api(`/api/rooms/${room.id}/apply/withdraw`, { body: {} }); VS.toast(state === 'waitlist' ? 'You left the waitlist' : 'Application withdrawn'); refresh(d.room); } catch (err) { A.errToast(err); }
      }
    });
  }

  /** The application form: the room's questions, short answers. */
  function applySheet(room, done) {
    const qs = room.apply_questions || [];
    const optional = (q) => /\(optional\)/i.test(q);
    const label = (q) => q.replace(/\s*\(optional\)\s*/i, ' ').trim();
    const m = A.modal(`${A.modalHead('Apply to join', esc(room.name))}<form class="vs-modal-b ap-f" novalidate>
        <p class="ap-intro">Short, honest answers work best. The team reads every application and replies within 48 hours.</p>
        ${qs.map((q, i) => `<div class="field ap-q" style="--d:${i}"><label for="apq${i}"><span class="ap-n">${i + 1}</span>${esc(label(q))}${optional(q) ? '<em>Optional</em>' : ''}</label><textarea class="inp ap-a" id="apq${i}" rows="1" maxlength="600" placeholder="${optional(q) ? 'If you want us to reach you there' : 'Your answer'}" ${optional(q) ? '' : 'required'} ${i === 0 ? 'autofocus' : ''}></textarea></div>`).join('')}
        ${A.NO_SALES ? '' : `<div class="ap-sum">${icon('shield')}<span>Nothing to pay now. If you are approved, you have 7 days to pay ${esc(money0(room.price_usd))} and take your seat.</span></div>`}
        <button class="btn btn-g btn-block" type="submit">${icon('send')}Send application</button>
      </form>`, { cls: 'am-md am-apply' });
    const f = m.el.querySelector('form');
    const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 180) + 'px'; };
    f.querySelectorAll('textarea').forEach((ta) => ta.addEventListener('input', () => { grow(ta); ta.closest('.field').classList.remove('bad'); }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tas = [...f.querySelectorAll('textarea')];
      const miss = tas.find((ta) => ta.required && !ta.value.trim());
      if (miss) { miss.closest('.field').classList.add('bad'); miss.focus(); VS.toast('Answer every question that is not optional.', 'err'); return; }
      const btn = f.querySelector('button[type=submit]');
      await A.busy(btn, async () => {
        try {
          const d = await VS.api(`/api/rooms/${room.id}/apply`, { body: { answers: tas.map((ta) => ta.value.trim()) } });
          f.outerHTML = `<div class="vs-modal-b ap-done"><div class="ap-tick" aria-hidden="true">${icon('check')}</div><h4>Application received</h4><p>We reply within 48 hours, by email and here in VooSquare. Nothing to pay until you are approved.</p><button class="btn btn-k" data-close>Done</button></div>`;
          done(d.room);
        } catch (err) { A.errToast(err); }
      });
    });
  }

  /* ---------------- member card ---------------- */
  const memberCache = new Map();
  A.on('blocked', (id) => { const m = memberCache.get(id); if (m) m.blocked = true; });
  A.on('unblocked', (id) => { const m = memberCache.get(id); if (m) m.blocked = false; });
  A.memberCard = async function (id, anchor) {
    let pop = null;
    const html = (m) => `<div class="mcard">
      <div class="mc-top"><span class="av av-xl mc-face">${VS.avatar(m.avatar)}</span></div>
      <div class="mc-b"><h3>${esc(m.name)}</h3>${m.handle ? `<p class="mc-hd">@${esc(m.handle)}</p>` : ''}<div class="mc-bd">${A.badges(m)}</div>
      ${m.bio ? `<p class="mc-bio">${esc(m.bio)}</p>` : ''}
      <div class="mc-stats"><div><b>${VS.fmt(m.messages || 0)}</b><small>Messages</small></div><div><b>${VS.fmt(m.xp || 0)}</b><small>XP</small></div><div><b>${m.joined ? esc(new Date(m.joined).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })) : '-'}</b><small>Joined</small></div></div>
      ${m.country ? `<p class="mc-c">${A.flag(m.country)} ${esc(A.countryName(m.country))}</p>` : ''}
      ${S.user && m.id !== S.user.id && !m.staff ? `<div class="mc-act"><button type="button" class="btn btn-ghost btn-sm" data-mblock>${icon('block')}${m.blocked ? 'Unblock' : 'Block'}</button></div>` : ''}</div></div>`;
    // Block or unblock from the card (the team cannot be blocked).
    const wire = (root, m) => {
      const b = root.querySelector('[data-mblock]');
      if (!b) return;
      b.addEventListener('click', async () => {
        const ok = m.blocked ? await A.unblockMember(m) : await A.blockMember(m);
        if (!ok) return;
        m.blocked = !m.blocked; memberCache.set(m.id, m);
        b.innerHTML = `${icon('block')}${m.blocked ? 'Unblock' : 'Block'}`;
      });
    };
    const loading = `<div class="mcard"><div class="mc-top"></div><div class="mc-b">${A.skel(96, '96px', 48)}${A.skel(20, '60%')}${A.skel(14, '40%')}</div></div>`;
    const desktop = !matchMedia('(max-width: 720px)').matches && anchor;
    if (desktop) {
      document.querySelectorAll('.mpop').forEach((x) => x.remove());
      pop = A.el(`<div class="mpop" role="dialog" aria-label="Member">${loading}</div>`);
      document.body.appendChild(pop);
      const place = () => {
        const r = anchor.getBoundingClientRect();
        const w = pop.offsetWidth, h = pop.offsetHeight;
        let left = r.right + 10, top = r.top - 10;
        if (left + w > window.innerWidth - 10) left = Math.max(10, r.left - w - 10);
        if (top + h > window.innerHeight - 10) top = Math.max(10, window.innerHeight - h - 10);
        pop.style.left = left + 'px'; pop.style.top = top + 'px';
      };
      place();
      const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', key); } };
      const key = (e) => { if (e.key === 'Escape') { pop.remove(); document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', key); } };
      setTimeout(() => { document.addEventListener('pointerdown', off); document.addEventListener('keydown', key); }, 0);
      try {
        const m = memberCache.get(id) || (await VS.api('/api/members/' + id)).member;
        memberCache.set(id, m);
        pop.innerHTML = html(m); place(); wire(pop, m);
      } catch (e) { pop.remove(); A.errToast(e); }
    } else {
      const s = A.modal(`<div class="mc-x"><button class="x" data-close aria-label="Close">${icon('x')}</button></div>${loading}`, { cls: 'am-member' });
      try {
        const m = memberCache.get(id) || (await VS.api('/api/members/' + id)).member;
        memberCache.set(id, m);
        const box = s.el.querySelector('.mcard'); if (box) { box.outerHTML = html(m); wire(s.el, m); }
      } catch (e) { s.close(); A.errToast(e); }
    }
  };

  A.pages.community = { title: 'Community', render: renderCommunity, full: true };
})();
