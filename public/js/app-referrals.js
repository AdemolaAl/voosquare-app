/* VooSquare member app: Referrals. Earnings from the people you bring, payout details, payout requests and history.
 * VooSquare keeps the record only: the Zedapex team pays from outside and marks each payout paid with a reference. */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { esc, icon } = VS;
  const S = A.S;

  const usd = (n) => '$' + VS.fmt(n, 2);
  const usd0 = (n) => '$' + VS.fmt(n, Number(n) % 1 ? 2 : 0);
  const day = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const dayY = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const PO = {
    requested: ['Requested', 'pill-w'], processing: ['Sending', 'pill-b'], paid: ['Paid', 'pill-g'], rejected: ['Not sent', 'pill-r'], cancelled: ['Cancelled', 'pill-w'],
  };
  const poPill = (s) => { const x = PO[s] || [s, 'pill-w']; return `<span class="pill ${x[1]}">${esc(x[0])}</span>`; };
  const TRON = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
  const METHODS = [
    ['usdt_trc20', 'USDT (TRC20)', 'diamond', 'Crypto wallet'],
    ['bank', 'Bank transfer', 'card', 'Local bank account'],
    ['mobile_money', 'Mobile money', 'wallet', 'M-Pesa, MTN MoMo and others'],
  ];
  const methodIc = (t) => (METHODS.find((m) => m[0] === t) || [0, 0, 'wallet'])[2];

  /* ---------------- the hero scene ----------------
   * Friends on the left send banknotes and coins along dotted paths into a phone that shows the member's available balance.
   * The member (their own face, the same character as the Premium hero) cheers on the right. SMIL motion so it can pause
   * off-screen with svg.pauseAnimations(); with reduced motion the notes sit still on their paths. */
  const FRIENDS = [[44, 62], [26, 150], [50, 238]];
  const PHONE = [158, 196]; // where the paths end, just above the phone in the scene's coordinates
  const pathOf = ([x, y], i) => {
    const sx = x + 24, sy = y;
    const c1 = [sx + 62, sy - (i === 2 ? 4 : 34)], c2 = [PHONE[0] - 28, PHONE[1] - (i === 0 ? 120 : 70)];
    return { d: `M${sx} ${sy} C${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${PHONE[0]} ${PHONE[1]}`, p: [[sx, sy], c1, c2, PHONE] };
  };
  const bez = (p, t) => [0, 1].map((k) => (1 - t) ** 3 * p[0][k] + 3 * (1 - t) ** 2 * t * p[1][k] + 3 * (1 - t) * t * t * p[2][k] + t ** 3 * p[3][k]);
  /* An avatar drawn inside the scene's SVG: its 64x64 artwork, scaled into a circle of radius r at (x, y). */
  const faceAt = (a, x, y, r) => `<g transform="translate(${x - r} ${y - r}) scale(${(r * 2) / 64})">${VS.avatar(a, {}).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>`;

  function scene(u, d) {
    const faces = d.people.slice(0, 3).map((p) => p.avatar);
    while (faces.length < 3) faces.push({ skin: (faces.length * 3 + 2) % 8, hair: (faces.length * 2 + 1) % 6, shirt: (faces.length * 5 + 3) % 8, bg: (faces.length * 3 + 1) % 8, hairColor: faces.length % 5, mouth: 1 });
    const paths = FRIENDS.map(pathOf);
    const still = VS.reduce;
    const DUR = 3.6;
    const mover = (pt, i, j, kind) => {
      const begin = -((i * 1.2 + j * (DUR / 2)) % DUR).toFixed(2);
      const shape = kind === 'coin' ? A.moneyCoin(0, 0, 6.5) : A.moneyNote(-19, -10, (i - 1) * 12);
      if (still) { const [x, y] = bez(pt.p, 0.35 + j * 0.3); return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">${shape}</g>`; }
      return `<g class="rf-mv" opacity="0"><animateMotion dur="${DUR}s" begin="${begin}s" repeatCount="indefinite" path="${pt.d}" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines=".45 0 .35 1"/>
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.82;1" dur="${DUR}s" begin="${begin}s" repeatCount="indefinite"/>
        <g><animateTransform attributeName="transform" type="scale" values="1;1;.45" keyTimes="0;.75;1" dur="${DUR}s" begin="${begin}s" repeatCount="indefinite"/>${shape}</g></g>`;
    };
    return `<div class="rf-scene" aria-hidden="true"><svg viewBox="0 0 380 300">
      <defs><radialGradient id="rfg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#C9F65B" stop-opacity=".28"/><stop offset="1" stop-color="#C9F65B" stop-opacity="0"/></radialGradient></defs>
      <circle cx="262" cy="176" r="140" fill="url(#rfg)"/>
      ${paths.map((pt) => `<path d="${pt.d}" class="rf-trail"/>`).join('')}
      ${FRIENDS.map(([x, y], i) => `<g class="rf-friend" style="animation-delay:-${i * 1.1}s"><circle cx="${x}" cy="${y}" r="24" fill="#0F2E20" stroke="#2A4535" stroke-width="2"/>${faceAt(faces[i], x, y, 21)}</g>`).join('')}
      <g class="rf-flow">${paths.map((pt, i) => mover(pt, i, 0, 'note') + mover(pt, i, 1, i === 1 ? 'note' : 'coin')).join('')}</g>
      <g transform="translate(119 24) scale(.92)">${A.moneyFigure(u)}</g>
    </svg>
    <div class="rf-phone"><small>Available</small><b class="rf-pn">${usd(0)}</b><span class="rf-pbar"><i style="--p:${Math.min(1, d.min_withdraw ? d.balance.available / d.min_withdraw : 1).toFixed(3)}"></i></span><em>${d.balance.available >= d.min_withdraw && d.balance.available > 0 ? 'Ready to withdraw' : `of ${usd0(d.min_withdraw)} minimum`}</em></div></div>`;
  }

  /** Pause every animation in the hero while it is off-screen (CSS and SMIL). */
  function pauseOffscreen(hero) {
    if (!('IntersectionObserver' in window)) return () => {};
    const svg = hero.querySelector('.rf-scene svg');
    const io = new IntersectionObserver((es) => {
      const on = es[0].isIntersecting;
      hero.classList.toggle('off', !on);
      if (svg && svg.pauseAnimations) { if (on) svg.unpauseAnimations(); else svg.pauseAnimations(); }
    }, { threshold: 0.05 });
    io.observe(hero);
    return () => io.disconnect();
  }

  /* ---------------- pieces ---------------- */
  function headline(d) {
    if (d.open_payout) return 'Your payout is with the team.';
    if (d.can_request) return 'Your payout is ready.';
    if (d.balance.lifetime > 0) return `You earn ${d.rate}% of what your people spend.`;
    return 'Share your link. Earn on the Voo tools and Premium.';
  }
  function heroActs(d) {
    const o = d.open_payout;
    if (o) {
      return `<div class="rf-open"><span class="rf-open-ic">${icon(o.status === 'processing' ? 'send' : 'clock')}</span><span><b>${usd(o.amount_usd)} ${o.status === 'processing' ? 'is being sent' : 'requested'}</b><small>${o.status === 'processing' ? 'The team is sending it to' : 'Waiting for the team. Goes to'} ${esc(o.method ? o.method.summary : 'your saved details')}</small></span>${o.status === 'requested' ? '<button class="btn rf-ghost btn-sm" data-cancel="' + o.id + '">Cancel</button>' : ''}</div>`;
    }
    const ready = d.can_request;
    return `<button class="btn btn-l" data-request${ready ? '' : ' disabled aria-disabled="true"'}>${icon('wallet')}Request payout</button>
      <span class="rf-act-n">${ready ? (d.method ? `To ${esc(d.method.summary)}` : 'Add your payout details next') : `Unlocks at ${usd0(d.min_withdraw)} available`}</span>`;
  }
  function goal(d) {
    const p = d.min_withdraw > 0 ? Math.min(1, d.balance.available / d.min_withdraw) : 1;
    const owed = !d.open_payout && d.balance.owed > 0;
    const txt = d.open_payout ? 'New earnings keep adding up while the team pays this one.'
      : p >= 1 && d.balance.available > 0 ? `Above the ${usd0(d.min_withdraw)} minimum`
        : owed ? `<b>${usd(d.to_go)}</b> to go. A refund lowered earnings you were already paid, so the first ${usd(d.balance.owed)} of new earnings covers it.`
          : `<b>${usd(d.to_go)}</b> to go to the ${usd0(d.min_withdraw)} minimum`;
    return `<div class="rf-goal"><span class="rf-bar"><i style="--p:${p.toFixed(3)}"></i></span><span class="rf-goal-t">${txt}</span></div>`;
  }

  const inviteText = (d) => `I use VooSquare for my media buying: one login for Spyvoo, Joinvoo, Vooads and the other Zedapex tools, free courses and a community of buyers. Join with my link: ${d.link}`;
  function linkCard(d) {
    const msg = inviteText(d);
    const enc = encodeURIComponent;
    const share = [
      ['WhatsApp', `https://wa.me/?text=${enc(msg)}`, 'chat'],
      ['Telegram', `https://t.me/share/url?url=${enc(d.link)}&text=${enc(msg.replace(' ' + d.link, ''))}`, 'send'],
      ['X', `https://x.com/intent/post?text=${enc(msg)}`, 'megaphone'],
    ];
    return `<div class="card rf-link" style="order:1"><div class="card-h"><div><h3>Your link</h3><span class="sub">Anyone who signs up with it is linked to you for good.</span></div></div>
      <div class="reflink"><code id="refCode">${esc(d.link.replace(/^https?:\/\//, ''))}</code><button class="btn btn-k btn-sm" data-copyref>${icon('copy')}Copy</button></div>
      <div class="rf-share">${share.map(([n, u, ic]) => `<a class="rf-sh" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${icon(ic)}${n}</a>`).join('')}<button class="rf-sh" data-copymsg>${icon('copy')}Message</button></div>
      <p class="rf-msg">${esc(msg)}</p></div>`;
  }

  function ladder(d) {
    const tiers = d.tiers || [];
    if (!tiers.length) return '';
    const n = tiers.length;
    const idx = tiers.reduce((k, t, i) => (d.paying >= t.min ? i : k), -1);
    let fill = 0;
    if (idx >= 0) {
      const next = tiers[idx + 1];
      fill = n === 1 ? 1 : (idx + (next ? Math.min(1, (d.paying - tiers[idx].min) / Math.max(1, next.min - tiers[idx].min)) : 0)) / (n - 1);
    } else if (n > 1) fill = Math.min(1, d.paying / Math.max(1, tiers[0].min)) * 0.08;
    const nt = d.next_tier;
    return `<div class="card rf-tiers" style="order:3"><div class="card-h"><div><h3>Your rate</h3><span class="sub">It grows with the number of people who pay. It applies to everything you have earned.</span></div><span class="r pill pill-l">${d.paying ? `${d.rate}% now` : `Starts at ${tiers[0].rate}%`}</span></div>
      <div class="rf-ladder" style="--n:${n}"><span class="rf-track"><i data-fill="${fill.toFixed(3)}"></i></span>
        <div class="rf-steps">${tiers.map((t, i) => `<div class="rf-step ${i === idx ? 'on' : i < idx ? 'done' : ''}" style="--i:${i}"><span class="rf-dot">${i <= idx ? icon('check') : ''}</span><b>${VS.fmt(t.rate, t.rate % 1 ? 1 : 0)}%</b><small>${t.min <= 1 ? 'First paying' : `${VS.fmt(t.min)}+ paying`}</small></div>`).join('')}</div></div>
      <p class="rf-next">${!d.paying ? `Your first paying referral starts you at <b>${tiers[0].rate}%</b> of everything they spend.` : nt ? `<b>${A.plural(nt.need, 'more paying referral')}</b> to reach ${nt.rate}%. You have ${A.plural(d.paying, 'paying referral')} out of ${A.plural(d.referred, 'sign-up')}.` : `You are on the top rate with ${A.plural(d.paying, 'paying referral')}.`}</p></div>`;
  }

  function peopleCard(d) {
    return `<div class="card rf-people" style="order:5"><div class="card-h"><div><h3>Your people</h3><span class="sub">${A.plural(d.referred, 'person', 'people')} joined with your link${d.paying ? `, ${VS.fmt(d.paying)} paying` : ''}</span></div></div>
      ${d.people.length ? `<div class="rf-pl">${d.people.map((p, i) => `<div class="rf-pr" style="--d:${Math.min(i, 10)}">${A.av(p.avatar, 'md')}<div><b>${esc(p.name)}</b><small>Joined ${esc(dayY(p.joined))}</small></div><span class="rf-pr-r">${p.excluded ? '<span class="pill pill-w" title="This account is suspended, so its spend does not count">Not counted</span>' : p.paying ? `<b>${usd(p.earned_usd)}</b><small>earned for you</small>` : '<span class="pill pill-w">Not paying yet</span>'}</span></div>`).join('')}</div>`
        : A.empty('users', 'No one yet', 'Share your link in your groups or with your team. People who join show up here.', '<button class="btn btn-k btn-sm" data-copyref>Copy my link</button>')}</div>`;
  }

  function methodCard(d) {
    const m = d.method;
    const locked = !!d.open_payout;
    return `<div class="card rf-method" style="order:2"><div class="card-h"><div><h3>Payout details</h3><span class="sub">Where the Zedapex team sends your money.</span></div>${m && !locked ? `<button class="r btn btn-w btn-xs" data-method>${icon('pen')}Edit</button>` : ''}</div>
      ${m ? `<div class="rf-m"><span class="rf-m-ic">${icon(methodIc(m.type))}</span><span class="rf-m-t"><b>${esc(m.label)}</b><small class="mono">${esc(m.summary)}</small></span>${m.country ? `<span class="rf-m-c">${A.flag(m.country)} ${esc(m.country)}</span>` : ''}</div>
        ${locked ? `<p class="rf-hint">${icon('lock')}<span>Locked while a payout is open. Cancel the request to change it.</span></p>` : ''}`
        : `<button class="rf-add" data-method><span class="rf-add-ic">${icon('plus')}</span><span><b>Add payout details</b><small>USDT (TRC20), bank transfer or mobile money</small></span></button>`}</div>`;
  }

  function historyCard(d) {
    const list = d.payouts || [];
    const tx = (p) => {
      if (!p.reference) return '';
      const hash = /^[0-9a-f]{64}$/i.test(p.reference) && p.method && p.method.type === 'usdt_trc20';
      return `<span class="rf-ref"><small>Reference</small><code>${esc(p.reference)}</code><button class="rf-ib" data-copy="${esc(p.reference)}" aria-label="Copy reference">${icon('copy')}</button>${hash ? `<a class="rf-ib" href="https://tronscan.org/#/transaction/${esc(p.reference)}" target="_blank" rel="noopener noreferrer" aria-label="View on Tronscan">${icon('ext')}</a>` : ''}</span>`;
    };
    return `<div class="card rf-hist" style="order:4"><div class="card-h"><div><h3>Payouts</h3><span class="sub">${d.balance.paid ? `${usd(d.balance.paid)} paid to you so far` : 'Every request and its status'}</span></div></div>
      ${list.length ? `<div class="rf-hl">${list.map((p) => `<div class="rf-h ${p.status}"><div class="rf-h-top"><b>${usd(p.amount_usd)}</b>${poPill(p.status)}<time>${esc(dayY(p.paid_at || p.decided_at || p.requested_at))}</time></div>
          <small class="rf-h-m">${p.method ? `${esc(p.method.label)} · <span class="mono">${esc(p.method.summary)}</span>` : ''}</small>${tx(p)}${p.note ? `<p class="rf-h-note">${esc(p.note)}</p>` : ''}${p.status === 'requested' ? `<button class="btn btn-ghost btn-xs" data-cancel="${p.id}">Cancel request</button>` : ''}</div>`).join('')}</div>`
        : `<div class="rf-none">${icon('wallet')}<span>Your payouts show here, with the reference for each one.</span></div>`}</div>`;
  }

  function howCard(d) {
    return `<div class="card rf-how" style="order:6"><div class="card-h"><h3>How it works</h3></div>
      <ol class="howpay rf-ol"><li><b>Share your link</b><span>People who sign up with it are linked to you for good.</span></li>
        <li><b>They pay for tools or Premium</b><span>Spyvoo, Joinvoo, Vooads, Replyvoo, Castvoo, Landvoo, Premium, paid rooms and new Voo tools count. Affleego runs separately and earns no referral commission.</span></li>
        <li><b>Request your payout</b><span>Earnings settle ${A.plural(d.settle_days, 'day')} after each payment. From ${usd0(d.min_withdraw)} available, request a payout and the Zedapex team sends it.</span></li></ol>
      <details class="rf-terms"><summary>${icon('shield')}Payout terms</summary><p>${A.richText(d.terms || '')}</p></details></div>`;
  }

  /* ---------------- payout details editor ---------------- */
  function methodForm(m) {
    const t = (m && m.type) || 'usdt_trc20';
    const v = (m && m.details) || {};
    return `<form class="rf-mf" novalidate>
      <div class="rf-mt" role="radiogroup" aria-label="Payout method">${METHODS.map(([k, l, ic, sub]) => `<button type="button" role="radio" aria-checked="${k === t}" class="rf-mtb ${k === t ? 'on' : ''}" data-mt="${k}">${icon(ic)}<b>${l}</b><small>${sub}</small></button>`).join('')}</div>
      <input type="hidden" name="type" value="${t}">
      <div class="rf-mfs" data-for="usdt_trc20" ${t === 'usdt_trc20' ? '' : 'hidden'}>
        <div class="field"><label for="pmAddr">TRC20 wallet address</label><input class="inp mono" id="pmAddr" name="address" autocomplete="off" spellcheck="false" placeholder="T..." value="${esc(v.address || '')}"><span class="hint">Starts with T, 34 characters. Only USDT on the TRON network. Other networks can be lost.</span></div>
      </div>
      <div class="rf-mfs" data-for="bank" ${t === 'bank' ? '' : 'hidden'}>
        <div class="field"><label for="pmBank">Bank name</label><input class="inp" id="pmBank" name="bank_name" autocomplete="off" value="${esc(v.bank_name || '')}"></div>
        <div class="field"><label for="pmAcc">Account number or IBAN</label><input class="inp mono" id="pmAcc" name="account_number" autocomplete="off" inputmode="text" value="${esc(v.account_number || '')}"></div>
        <div class="field"><label for="pmAccN">Name on the account</label><input class="inp" id="pmAccN" name="account_name" autocomplete="off" value="${esc(v.account_name || '')}"></div>
      </div>
      <div class="rf-mfs" data-for="mobile_money" ${t === 'mobile_money' ? '' : 'hidden'}>
        <div class="field"><label for="pmProv">Provider</label><input class="inp" id="pmProv" name="provider" autocomplete="off" placeholder="M-Pesa, MTN MoMo, Airtel Money..." value="${esc(v.provider || '')}"></div>
        <div class="field"><label for="pmNum">Wallet phone number</label><input class="inp mono" id="pmNum" name="number" autocomplete="off" inputmode="tel" placeholder="+254 7..." value="${esc(v.number || '')}"></div>
        <div class="field"><label for="pmName">Name on the wallet</label><input class="inp" id="pmName" name="name" autocomplete="off" value="${esc(v.name || '')}"></div>
      </div>
      <div class="field rf-ctry" ${t === 'usdt_trc20' ? 'hidden' : ''}><label for="pmCtry">Country of the account</label><select class="inp" id="pmCtry" name="country">${A.countryOptions(v.country || (S.user && S.user.country) || '')}</select></div>
      <p class="rf-err" role="alert" hidden></p>
      <button class="btn btn-g btn-block" type="submit">${icon('check')}<span>Save payout details</span></button>
    </form>`;
  }
  function bindMethodForm(root, onSaved, saveLabel) {
    const f = root.querySelector('.rf-mf');
    if (saveLabel) f.querySelector('button[type=submit] span').textContent = saveLabel;
    const err = f.querySelector('.rf-err');
    const say = (m) => { err.textContent = m; err.hidden = !m; };
    f.addEventListener('click', (e) => {
      const b = e.target.closest('[data-mt]'); if (!b) return;
      const t = b.dataset.mt;
      f.type.value = t;
      f.querySelectorAll('[data-mt]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      f.querySelectorAll('.rf-mfs').forEach((x) => { x.hidden = x.dataset.for !== t; });
      f.querySelector('.rf-ctry').hidden = t === 'usdt_trc20';
      say('');
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const t = f.type.value;
      const body = { type: t };
      f.querySelectorAll(`.rf-mfs[data-for="${t}"] [name]`).forEach((i) => { body[i.name] = i.value.trim(); });
      if (t !== 'usdt_trc20') body.country = f.country.value;
      if (t === 'usdt_trc20' && !TRON.test(body.address || '')) { say('That is not a TRC20 address. It starts with T and has 34 letters and numbers.'); f.address.focus(); return; }
      if (t !== 'usdt_trc20' && !body.country) { say('Choose the country of the account.'); return; }
      say('');
      await A.busy(f.querySelector('button[type=submit]'), async () => {
        try { const r = await VS.api('/api/me/payout-method', { method: 'PUT', body }); VS.toast('Payout details saved'); onSaved(r.method); }
        catch (x) { if (x && x.status === 401) A.errToast(x); else say(x.message); }
      });
    });
  }
  function editMethod(d, then) {
    const m = A.modal(`${A.modalHead('Payout details', 'Where the Zedapex team sends your referral money.')}<div class="vs-modal-b">${methodForm(d.method)}</div>`, { cls: 'am-rf' });
    bindMethodForm(m.el, (method) => { m.close(); then(method); });
  }

  /* ---------------- request flow ---------------- */
  function requestSheet(d, reload) {
    const m = A.modal(`${A.modalHead('Request a payout')}<div class="vs-modal-b rf-rq"></div>`, { cls: 'am-rf' });
    const b = m.el.querySelector('.rf-rq');
    let method = d.method;
    const confirm = () => {
      b.innerHTML = `<div class="rf-rq-amt"><small>Your full available balance</small><b>${usd(d.balance.available)}</b></div>
        <div class="rf-rq-to"><span class="rf-m-ic">${icon(methodIc(method.type))}</span><span class="rf-m-t"><small>Sent to</small><b>${esc(method.label)}</b><small class="mono">${esc(method.summary)}</small></span><button class="btn btn-w btn-xs" data-change>Change</button></div>
        <ul class="rf-rq-l"><li>${icon('check')}<span>The Zedapex team checks the request and sends it from its own account.</span></li><li>${icon('check')}<span>You get an email with the transaction reference when it is paid.</span></li><li>${icon('check')}<span>You can cancel while it says Requested.</span></li></ul>
        <button class="btn btn-l btn-block" data-go>${icon('wallet')}Request ${usd(d.balance.available)}</button>
        <button class="btn btn-ghost btn-sm btn-block" data-close>Not now</button>`;
    };
    const editStep = (first) => {
      b.innerHTML = `${first ? `<p class="rf-rq-first">${icon('wallet')}<span>First, tell us where to send <b>${usd(d.balance.available)}</b>.</span></p>` : ''}${methodForm(method)}`;
      bindMethodForm(b, (saved) => { method = saved; d.method = saved; confirm(); }, 'Save and continue');
    };
    if (method) confirm(); else editStep(true);
    b.addEventListener('click', async (e) => {
      if (e.target.closest('[data-change]')) { editStep(false); return; }
      const go = e.target.closest('[data-go]');
      if (!go) return;
      await A.busy(go, async () => {
        try {
          const r = await VS.api('/api/me/payouts', { body: {} });
          b.innerHTML = `<div class="rf-done"><span class="rf-done-ic">${icon('check')}</span><h4>Payout requested</h4><p>${usd(r.payout ? r.payout.amount_usd : d.balance.available)} to ${esc(method.summary)}. We emailed you a copy. You will get another email with the reference once it is paid.</p><button class="btn btn-k" data-close>Done</button></div>`;
          VS.confetti();
          reload();
        } catch (x) { A.errToast(x); if (x && x.status === 409) reload(); }
      });
    });
  }

  /* ---------------- page ---------------- */
  function renderReferrals(view) {
    view.innerHTML = `<div class="rf">${A.skel(400, '100%', 32)}<div class="rf-grid"><div class="rf-col">${A.skel(220, '100%', 24)}${A.skel(220, '100%', 24)}</div><div class="rf-col">${A.skel(160, '100%', 24)}${A.skel(260, '100%', 24)}</div></div></div>`;
    let d = null; let stopIo = () => {}; let first = true;
    const paint = () => {
      const u = S.user;
      stopIo();
      view.innerHTML = `<div class="rf">
        <section class="rf-hero${first ? ' intro' : ''}">
          <div class="rf-copy">
            <div class="rf-top"><span class="pz-k">Referrals</span><span class="rf-rate">${d.paying ? `Your rate <b>${d.rate}%</b>` : `Rate from <b>${(d.tiers[0] || { rate: d.rate }).rate}%</b>`}</span></div>
            <h2>${esc(headline(d))}</h2>
            <div class="rf-avail"><small>Available to withdraw</small><b class="rf-amt">${usd(0)}</b></div>
            ${goal(d)}
            <div class="rf-acts">${heroActs(d)}</div>
          </div>
          ${scene(u, d)}
          <dl class="rf-stats">
            <div><dt>Settling</dt><dd data-n="${d.balance.pending}">${usd(0)}</dd><small>${d.next_settle ? `${usd(d.next_settle.amount)} on ${esc(day(d.next_settle.at))}` : `${A.plural(d.settle_days, 'day')} after each payment`}</small></div>
            <div><dt>Paid out</dt><dd data-n="${d.balance.paid}">${usd(0)}</dd><small>${d.balance.open ? `${usd(d.balance.open)} on its way` : 'Sent by the Zedapex team'}</small></div>
            <div><dt>Lifetime</dt><dd data-n="${d.balance.lifetime}">${usd(0)}</dd><small>${d.spend_usd ? `From ${usd(d.spend_usd)} spent` : 'No spend yet'}</small></div>
          </dl>
        </section>
        <div class="rf-grid">
          <div class="rf-col">${linkCard(d)}${ladder(d)}${peopleCard(d)}</div>
          <div class="rf-col">${methodCard(d)}${historyCard(d)}${howCard(d)}</div>
        </div></div>`;
      const ms = first ? 1300 : 600;
      VS.countUp(view.querySelector('.rf-amt'), d.balance.available, { dec: 2, pre: '$', ms });
      VS.countUp(view.querySelector('.rf-pn'), d.balance.available, { dec: 2, pre: '$', ms: ms + 500 });
      view.querySelectorAll('.rf-stats [data-n]').forEach((x) => VS.countUp(x, Number(x.dataset.n), { dec: 2, pre: '$', ms }));
      const fill = view.querySelector('.rf-track i');
      if (fill) requestAnimationFrame(() => requestAnimationFrame(() => { fill.style.transform = `scaleX(${fill.dataset.fill})`; }));
      stopIo = pauseOffscreen(view.querySelector('.rf-hero'));
      view.dataset.link = d.link;
      first = false;
    };
    const load = () => VS.api('/api/me/referrals').then((x) => { d = x; paint(); })
      .catch((e) => { if (!d) view.innerHTML = `<div class="card">${A.errorBox(e.message)}</div>`; else A.errToast(e); });
    load();
    view.addEventListener('click', async (e) => {
      if (e.target.closest('[data-copyref]')) VS.copyText(view.dataset.link, view.querySelector('#refCode'));
      if (e.target.closest('[data-copymsg]') && d) VS.copyText(inviteText(d));
      const cp = e.target.closest('[data-copy]'); if (cp) VS.copyText(cp.dataset.copy);
      if (e.target.closest('[data-retry]')) load();
      if (!d) return;
      if (e.target.closest('[data-request]')) { if (d.can_request) requestSheet(d, load); return; }
      if (e.target.closest('[data-method]')) { editMethod(d, () => load()); return; }
      const c = e.target.closest('[data-cancel]');
      if (c) {
        const p = (d.payouts || []).find((x) => x.id === Number(c.dataset.cancel)) || d.open_payout;
        if (!p) { load(); return; }
        if (!(await A.ask('Cancel this payout request?', `${usd(p.amount_usd)} goes back to your available balance. You can request again any time.`, { ok: 'Cancel request', danger: true }))) return;
        await A.busy(c, async () => { try { await VS.api(`/api/me/payouts/${p.id}/cancel`, { body: {} }); VS.toast('Request cancelled'); load(); } catch (x) { A.errToast(x); load(); } });
      }
    });
    const offs = [A.on('payout', () => load()), A.on('user', () => { if (d) paint(); })];
    return () => { stopIo(); offs.forEach((f) => f()); };
  }

  A.pages.referrals = { title: 'Referrals', render: renderReferrals };
})();
