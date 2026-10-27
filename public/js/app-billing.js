/* VooSquare member app: Premium, checkout (redirect, crypto, manual), payment return and orders. */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { esc, icon } = VS;
  const S = A.S;

  const ORDER_STATUS = {
    pending: ['Waiting for payment', 'pill-w'], review: ['Checking payment', 'pill-b'], paid: ['Paid', 'pill-g'],
    failed: ['Failed', 'pill-r'], refunded: ['Refunded', 'pill-w'], cancelled: ['Cancelled', 'pill-w'], expired: ['Expired, not paid', 'pill-w'],
  };
  /** "32,000" for display (the Copy button keeps the exact figure); crypto keeps its precision. */
  const amtText = (n, cur) => { const x = Number(n) || 0; return ['BTC', 'ETH'].includes(String(cur || '').toUpperCase()) ? x.toLocaleString('en-US', { maximumFractionDigits: 8 }) : VS.fmt(x, x % 1 ? 2 : 0); };
  const orderPill = (s) => { const x = ORDER_STATUS[s] || [s, 'pill-w']; return `<span class="pill ${x[1]}">${esc(x[0])}</span>`; };
  const periodLabel = (d) => (!d ? 'one time' : d === 30 ? 'month' : d === 365 ? 'year' : `${d} days`);

  let methodsCache = null;
  const loadMethods = async () => (methodsCache = await VS.api('/api/billing/methods'));

  const initials = (n) => String(n || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  /** Icon for a payment method: Gatevoo's own mark, the admin's chosen icon, or initials. */
  function methodIcon(x) {
    if (x.type === 'gatevoo') return `<span class="ck-mi gv">${VS.productIcon({ icon: 'gatevoo', name: 'Gatevoo' }, 'sm')}</span>`;
    if (x.type === 'manual') return x.icon && VS.P[x.icon] ? `<span class="ck-mi">${icon(x.icon)}</span>` : `<span class="ck-mi ini">${esc(initials(x.name))}</span>`;
    return `<span class="ck-mi">${icon(x.type === 'crypto' ? 'diamond' : 'card')}</span>`;
  }
  const ASSET = { USDT_TRC20: 'USDT', BTC: 'BTC' };
  function methodSub(x) {
    if (x.type === 'gatevoo') return `${(x.assets || []).length === 1 ? (x.assets[0] === 'BTC' ? 'Bitcoin' : 'USDT (TRC20)') : 'USDT or Bitcoin'}<span class="ck-tags">${(x.assets || []).map((a) => `<i>${esc(ASSET[a] || a)}</i>`).join('')}</span>`;
    if (x.type === 'crypto') return esc(x.network || 'Crypto') + ' · send from any wallet';
    if (x.type === 'manual') return 'Confirmed by our team';
    return x.redirect ? 'Secure checkout page' : 'Manual transfer';
  }

  /* ---------------- checkout flow (modal) ---------------- */
  /**
   * item: { item: 'premium'|'room', room_id, name, usd, period }
   */
  A.checkout = async function (item) {
    // iPhone app: nothing is sold in the app (App Store guideline 3.1.1). A calm note, no link, no price.
    if (A.NO_SALES) {
      A.modal(`${A.modalHead(item.item === 'premium' ? 'Premium' : 'Paid room')}<div class="vs-modal-b"><p class="muted">${item.item === 'premium' ? 'Premium is not available in this app.' : 'Paid rooms are not available in this app.'}</p><div class="am-actions"><button class="btn btn-k" data-close>OK</button></div></div>`, { cls: 'am-sm' });
      return;
    }
    const m = A.modal(`${A.modalHead(esc(item.item === 'premium' ? 'Go Premium' : 'Get access'), esc(item.name || ''))}<div class="vs-modal-b ck">${A.skel(64)}${A.skel(64)}${A.skel(64)}</div>`, { cls: 'am-ck' });
    const b = m.el.querySelector('.ck');
    let d;
    try { d = await loadMethods(); } catch (e) { b.innerHTML = A.errorBox(e.message, false); return; }
    if (item.item === 'premium') { item.usd = Number(d.premium.price_usd) || 20; item.period = Number(d.premium.period_days) || 30; item.name = d.premium.name || 'VooSquare Premium'; }
    // Grandfathering: a member who is already paying sees (and pays) the price they kept.
    const kept = d.prices && (item.item === 'premium' ? d.prices.premium : d.prices.rooms && d.prices.rooms[item.room_id]);
    if (kept && kept.locked) { item.usd = Number(kept.usd); item.period = Number(kept.days) || 0; item.kept = Number(kept.list_usd); }
    const methods = d.methods || [];
    if (!methods.length) {
      b.innerHTML = `<div class="ck-soon"><span class="ck-soon-ic">${icon('card')}</span><h4>Payments open soon</h4><p>We are setting up payment options for your country. Message support and we will help you get access today.</p><a class="btn btn-k" href="#support" data-close>${icon('chat')}Message support</a></div>`;
      return;
    }
    let sel = methods[0].id;
    let cpn = VS.coupon();
    let cpnOk = ''; // the code the server confirmed with Apply
    const cpnRow = () => `<div class="ck-cpn${cpn ? ' open' : ''}"><button type="button" class="ck-cpn-t" data-cpnt aria-expanded="${cpn ? 'true' : 'false'}">${icon('plus')}Have a code?</button>
      <div class="ck-cpn-b"><div class="ck-cpn-in"><div class="ck-cpn-r"><input class="inp" data-cpn maxlength="24" autocapitalize="characters" spellcheck="false" placeholder="Coupon code" aria-label="Coupon code" aria-describedby="cpnMsg" value="${esc(cpn)}"><button type="button" class="btn btn-w btn-sm" data-cpnapply>Apply</button></div>
      <p class="ck-cpn-m${cpnOk && cpnOk === cpn.toUpperCase() ? ' ok' : ''}" id="cpnMsg" role="status">${cpnOk && cpnOk === cpn.toUpperCase() ? `${icon('check')}Code ${esc(cpnOk)} added` : ''}</p></div></div></div>`;
    const cpnMsg = (txt, ok) => { const el = b.querySelector('#cpnMsg'); if (!el) return; el.className = 'ck-cpn-m ' + (ok ? 'ok' : 'err'); el.innerHTML = txt ? `${icon(ok ? 'check' : 'x')}${esc(txt)}` : ''; const inp = b.querySelector('[data-cpn]'); if (inp) inp.setAttribute('aria-invalid', ok || !txt ? 'false' : 'true'); };
    const paintPick = () => {
      b.innerHTML = `<div class="ck-sum"><div><b>${esc(item.name)}</b><small>${item.period ? `Access for ${item.period} days. No auto-renew.` : 'One payment.'}${item.kept ? ` Your price is kept while you stay a member (new members pay $${VS.fmt(item.kept, item.kept % 1 ? 2 : 0)}).` : ''}</small></div><span class="ck-usd">$${VS.fmt(item.usd, item.usd % 1 ? 2 : 0)}</span></div>
        <div class="lbl">Choose how to pay</div>
        <div class="ck-methods" role="radiogroup">${methods.map((x) => `<button class="ck-m ${x.id === sel ? 'on' : ''}" role="radio" aria-checked="${x.id === sel}" data-m="${x.id}">
            ${methodIcon(x)}
            <span class="ck-mt"><b>${esc(x.name)}</b><small>${methodSub(x)}</small></span>
            <span class="ck-ma"><b>${esc(A.fmtAmount(Math.round(item.usd * (Number(x.rate) || 1) * 1e8) / 1e8, x.currency))}</b></span><span class="ck-radio"></span></button>`).join('')}</div>
        ${cpnRow()}
        <button class="btn btn-g btn-block" data-pay>${icon('shield')}${(methods.find((x) => x.id === sel) || {}).type === 'gatevoo' ? 'Continue to Gatevoo' : 'Continue to payment'}</button>
        <p class="muted small ck-note">VooSquare only charges for Premium and paid rooms. We never hold a balance or a wallet for you. <a href="/terms" target="_blank" rel="noopener">Terms</a> and <a href="/privacy" target="_blank" rel="noopener">privacy</a>.</p>`;
    };
    paintPick();
    b.addEventListener('click', async (e) => {
      const mb = e.target.closest('[data-m]');
      if (mb) { const cp = b.querySelector('[data-cpn]'); if (cp) cpn = cp.value.trim(); sel = Number(mb.dataset.m); paintPick(); return; }
      const ct = e.target.closest('[data-cpnt]');
      if (ct) { const box = ct.parentElement; const open = box.classList.toggle('open'); ct.setAttribute('aria-expanded', String(open)); if (open) box.querySelector('[data-cpn]').focus(); return; }
      const ap = e.target.closest('[data-cpnapply]');
      if (ap) {
        const cp = b.querySelector('[data-cpn]'); cpn = cp.value.trim();
        if (!cpn) { cpnMsg('Type a code first.', false); cp.focus(); return; }
        await A.busy(ap, async () => {
          try { const r = await VS.api('/api/billing/coupon', { body: { coupon: cpn } }); cpnOk = r.code; cpnMsg(`Code ${r.code} added`, true); } catch (err) { cpnOk = ''; if (err.status === 401) A.errToast(err); else cpnMsg(err.message, false); }
        });
        return;
      }
      const pay = e.target.closest('[data-pay]');
      if (pay) {
        await A.busy(pay, async () => {
          try {
            const cp = b.querySelector('[data-cpn]'); if (cp) cpn = cp.value.trim();
            const r = await VS.api('/api/billing/checkout', { body: { item: item.item, room_id: item.room_id || null, method_id: sel, coupon: cpn || undefined } });
            if (r.redirect_url) { pay.innerHTML = r.method && r.method.type === 'gatevoo' ? 'Opening Gatevoo' : 'Opening secure checkout'; location.href = r.redirect_url; return; }
            if (r.pay) { payStep(b, r, m); A.emit('orders'); }
          } catch (err) {
            // A code that is not valid stops here with the reason next to the field; nothing was ordered.
            if (err.data && err.data.field === 'coupon') { const box = b.querySelector('.ck-cpn'); if (box) box.classList.add('open'); cpnMsg(err.message, false); const cp = b.querySelector('[data-cpn]'); if (cp) cp.focus(); }
            else A.errToast(err);
          }
        });
      }
    });
  };

  /** Text reference and/or screenshot fields, as the method asks for. Returns html; bind with bindProof(). */
  function proofFields(kind, mode, ref, amt) {
    const wantText = mode !== 'image', wantImg = mode !== 'text' && !!window.VSM;
    const req = (on) => (mode === 'both' && on ? '<span class="req">Required</span>' : '');
    return `${wantText ? `<div class="field"><label for="proof">${kind === 'crypto' ? 'Transaction hash' : 'Transfer reference'}${req(true)}</label><input class="inp" id="proof" autocomplete="off" placeholder="${kind === 'crypto' ? 'Paste the hash from your wallet' : 'Paste your transfer reference'}">${ref ? `<span class="hint">Order ${esc(ref)} · ${esc(amt)}</span>` : ''}</div>` : ''}
      ${wantImg ? `<div class="proof-box"><div class="att-host" id="pAtt" hidden></div><button type="button" class="proof-add" id="pAttB"><span class="kic2">${icon('image')}</span><span>${mode === 'image' ? 'Add a screenshot of your payment' : 'Add a screenshot'}${req(true)}<small>${mode === 'either' ? 'Or instead of the reference.' : 'Your receipt or the confirmation screen.'}</small></span></button></div>` : ''}
      ${!wantText && ref ? `<p class="hint muted small">Order ${esc(ref)} · ${esc(amt)}</p>` : ''}`;
  }
  function bindProof(root) {
    const btn = root.querySelector('#pAttB');
    return btn ? VSM.attacher({ btn, chipHost: root.querySelector('#pAtt'), purpose: 'proof', label: 'Payment screenshot', onChange: (s) => { btn.hidden = s.has; } }) : null;
  }

  function payStep(b, r, m) {
    const p = r.pay, o = r.order;
    const amt = A.fmtAmount(p.amount, p.currency);
    const details = (p.details || []).filter((d) => d.value);
    b.innerHTML = `<div class="ck-steps"><span class="on">1 · Send</span><span>2 · Confirm</span></div>
      ${r.reused ? `<p class="ck-resume">${icon('refresh')}<span>You started this order on ${esc(day(o.created_at))}. Same details, order ${esc(o.ref)}.</span></p>` : ''}
      <div class="pay-amt"><small>Send exactly</small><div class="pay-row"><b class="mono" id="payAmt">${esc(amtText(p.amount, p.currency))}</b><span>${esc(p.currency)}</span><button class="btn btn-w btn-xs" data-copy="${esc(String(p.amount))}">${icon('copy')}Copy</button></div></div>
      ${p.kind === 'crypto' ? `<div class="pay-f"><small>Network</small><b>${esc(p.network || '-')}</b></div>
      <div class="pay-f addr"><small>Wallet address</small><code id="payAddr">${esc(p.address)}</code><button class="btn btn-k btn-sm btn-block" data-copy="${esc(p.address)}">${icon('copy')}Copy address</button></div>
      <p class="pay-warn">${icon('shield')}Only send ${esc(p.currency)} on ${esc(p.network || 'this network')}. Other coins or networks can be lost.</p>` : ''}
      ${details.length ? `<div class="pay-det">${details.map((d) => `<div class="pay-dr"><span><small>${esc(d.label || 'Detail')}</small><b>${esc(d.value)}</b></span><button class="btn btn-w btn-xs" data-copy="${esc(d.value)}" aria-label="Copy ${esc(d.label || 'detail')}">${icon('copy')}Copy</button></div>`).join('')}</div>` : ''}
      ${p.instructions ? `<div class="pay-ins"><small>Instructions</small><p>${A.richText(p.instructions)}</p></div>` : ''}
      ${proofFields(p.kind, p.proof_mode || 'either', o.ref, amt)}
      <button class="btn btn-g btn-block" data-proof>${icon('check')}I have paid</button>
      <button class="btn btn-ghost btn-sm" data-close>I will pay later</button>
      <p class="ck-later muted small">Unpaid orders stay in Your payments. You can carry on or cancel them there.</p>`;
    b.querySelectorAll('[data-copy]').forEach((x) => x.addEventListener('click', () => VS.copyText(x.dataset.copy)));
    const att = bindProof(b);
    b.querySelector('[data-proof]').addEventListener('click', (e) => submitProof(e.currentTarget, o.ref, b.querySelector('#proof'), att, p.proof_mode || 'either', () => checking(b, o)));
  }

  async function submitProof(btn, ref, input, att, mode, done) {
    const v = input ? input.value.trim() : '';
    const hasImg = !!(att && att.has());
    if ((mode === 'text' || mode === 'both') && v.length < 4) { input.focus(); VS.toast('Paste your transaction hash or transfer reference.', 'err'); return; }
    if ((mode === 'image' || mode === 'both') && !hasImg) { VS.toast('Add a screenshot of your payment.', 'err'); return; }
    if (mode === 'either' && v.length < 4 && !hasImg) { if (input) input.focus(); VS.toast('Paste your reference or add a screenshot.', 'err'); return; }
    await A.busy(btn, async () => {
      try {
        const upl = hasImg ? await att.get() : null;
        await VS.api(`/api/billing/orders/${encodeURIComponent(ref)}/proof`, { body: { proof: v, upload_id: upl ? upl.id : undefined } });
        if (att) att.sent();
        done(); A.emit('orders');
      } catch (e) { A.errToast(e); }
    });
  }

  function checking(b, o) {
    b.innerHTML = `<div class="ck-check"><div class="chk-anim" aria-hidden="true"><i></i><i></i><i></i><i></i></div><h4>We're checking your payment</h4><p>Our team confirms payments within a few hours. You will get an email and a notification here as soon as it is done.</p><p class="muted small">Order ${esc(o.ref)}</p><button class="btn btn-k" data-close>Done</button></div>`;
  }

  /* ---------------- PREMIUM page ---------------- */
  /* Cartoon money: a banknote and a coin, shared by the Premium and Referrals scenes. */
  const note = (x, y, r, cls = '') => `<g class="pz-note ${cls}" style="--r:${r}deg;transform-origin:${x + 19}px ${y + 10}px"><g transform="rotate(${r} ${x + 19} ${y + 10})"><rect x="${x}" y="${y}" width="38" height="20" rx="3.5" fill="#12C784"/><rect x="${x + 3}" y="${y + 3}" width="32" height="14" rx="2" fill="none" stroke="#C9F65B" stroke-opacity=".55" stroke-width="1"/><rect x="${x + 15}" y="${y + 7}" width="6" height="6" rx="1.5" fill="#0A1A13" fill-opacity=".55"/><rect x="${x + 22}" y="${y + 5}" width="2.6" height="2.6" rx=".7" fill="#C9F65B"/></g></g>`;
  const coin = (x, y, s) => `<g class="pz-coin" style="transform-origin:${x}px ${y}px"><circle cx="${x}" cy="${y}" r="${s}" fill="#C9F65B"/><circle cx="${x}" cy="${y}" r="${s * 0.62}" fill="none" stroke="#7FAF1F" stroke-width="1.6"/></g>`;
  /** The member's own face on a cheering body, arms up, a banknote in each hand. Centred on x=180 in a 360x300 box.
   * Shared with the Referrals hero (A.moneyFigure) so both scenes are the same character. */
  function figure(u) {
    const a = { ...((u && u.avatar) || {}), eyes: 1, mouth: 1 };
    const n = (k) => Math.abs(Number(a[k]) || 0) % VS.AV.counts[k];
    const skin = VS.AV.skins[n('skin')];
    const shirt = '#00A86B';
    const head = VS.avatar(a, {}).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
      .replace(/<rect width="64" height="64" fill="[^"]+"\/>/, '').replace(/<path d="M8 66C10 50[^>]*\/>/, '').replace(/<rect x="27.5" y="38"[^>]*\/>/, '');
    return `<g class="pz-me">
        <ellipse cx="180" cy="296" rx="84" ry="8" fill="#000" opacity=".25"/>
        <g class="pz-arm l"><path d="M150 232 Q120 204 112 156" stroke="${shirt}" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="111" cy="146" r="12" fill="${skin}"/>${note(84, 112, -24, 'held')}</g>
        <g class="pz-arm r"><path d="M210 232 Q240 204 248 156" stroke="${shirt}" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="249" cy="146" r="12" fill="${skin}"/>${note(238, 110, 22, 'held')}</g>
        <path d="M112 302C114 244 142 218 180 218C218 218 246 244 248 302Z" fill="${shirt}"/>
        <path d="M168 218L180 236L192 218" fill="#C9F65B"/>
        <rect x="169" y="190" width="22" height="30" rx="9" fill="${skin}"/>
        <g class="pz-head"><g transform="translate(96.8 66) scale(2.62)">${head}</g></g>
      </g>`;
  }
  A.moneyFigure = figure;
  A.moneyNote = note;
  A.moneyCoin = coin;

  /** The hero scene: the member's own face, delighted, arms up, with notes and coins in the air and a phone ticking up. */
  function scene(u) {
    const fly = [[34, 96, -18, 0], [292, 70, 14, 1.1], [60, 30, 10, 2.3], [268, 160, -10, 3.2], [8, 170, 22, 4.1], [310, 230, -16, 1.7]];
    return `<div class="pz-scene" aria-hidden="true"><svg viewBox="0 0 360 300">
      <defs><radialGradient id="pzg" cx="50%" cy="55%" r="50%"><stop offset="0" stop-color="#C9F65B" stop-opacity=".32"/><stop offset="1" stop-color="#C9F65B" stop-opacity="0"/></radialGradient></defs>
      <circle cx="180" cy="168" r="150" fill="url(#pzg)"/>
      <g class="pz-l1">${fly.slice(0, 3).map(([x, y, r], i) => `<g class="pz-fly" style="animation-delay:-${i * 2.1}s">${note(x, y, r)}</g>`).join('')}${coin(110, 52, 9)}${coin(258, 40, 7)}</g>
      <g class="pz-l2">${figure(u)}</g>
      <g class="pz-l3">${fly.slice(3).map(([x, y, r], i) => `<g class="pz-fly f2" style="animation-delay:-${0.8 + i * 2.4}s">${note(x, y, r)}</g>`).join('')}${coin(300, 120, 10)}${coin(36, 236, 8)}${coin(330, 196, 6)}</g>
    </svg>
    <div class="pz-phone"><small>FTDs today</small><b class="pz-num"></b><span class="pz-bars"><i></i><i></i><i></i><i></i><i></i></span><em>Example</em></div></div>`;
  }
  function parallax(root) {
    const hero = root.querySelector('.pz-hero');
    if (!hero || VS.reduce || matchMedia('(pointer: coarse)').matches) return;
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      hero.style.setProperty('--mx', ((e.clientX - r.left) / r.width - 0.5).toFixed(3));
      hero.style.setProperty('--my', ((e.clientY - r.top) / r.height - 0.5).toFixed(3));
    });
    hero.addEventListener('pointerleave', () => { hero.style.setProperty('--mx', 0); hero.style.setProperty('--my', 0); });
  }

  /* What you get: each feature gets its own small icon; "Title: detail" splits into two lines. */
  const FEAT_IC = [[/room/i, 'rooms'], [/course|academy/i, 'book'], [/live|breakdown/i, 'live'], [/template|playbook/i, 'layers'], [/support/i, 'headset'], [/badge|early/i, 'premium'], [/tool/i, 'calc']];
  function featList(feats, premTools) {
    const rows = feats.map((f) => {
      const i = String(f).indexOf(':');
      const t = i > 0 ? f.slice(0, i) : f, d = i > 0 ? f.slice(i + 1).trim() : '';
      return [t, d, (FEAT_IC.find(([re]) => re.test(f)) || [0, 'check'])[1]];
    });
    if (premTools.length) rows.push(['Premium tools', `${premTools.join(', ')}, plus saved scenarios`, 'calc']);
    return `<ul class="pz-feats">${rows.map(([t, d, ic], i) => `<li style="--d:${i}"><span class="pz-fi">${icon(ic)}</span><span><b>${esc(t)}</b>${d ? `<small>${esc(d)}</small>` : ''}</span></li>`).join('')}</ul>`;
  }

  /** iPhone app (App Store guideline 3.1.1): status only. No prices, buttons, payments or links to buy elsewhere. */
  function premiumNoSales(view) {
    const paint = () => {
      const u = S.user;
      view.innerHTML = u.premium
        ? `<section class="pz-hero on pz-app"><div class="pz-copy">${VS.pmark('md', 'inv')}<span class="pz-k">You are Premium</span><h2>Good to have you in the square, ${esc(A.firstName(u.name))}.</h2>
            <p>Your Premium runs until <b>${esc(day(u.premium_until))}</b>.</p>
            <div class="pz-acts"><a class="btn pz-ghost" href="#community">${icon('rooms')}Premium rooms</a></div></div></section>`
        : `<div class="card">${A.empty('premium', 'Premium', 'Premium is not available in this app.')}</div>`;
    };
    paint();
    return A.on('user', paint);
  }

  function renderPremium(view) {
    if (A.NO_SALES) return premiumNoSales(view);
    view.innerHTML = `${A.skel(380, '100%', 30)}`;
    let orders = null;
    const paint = async () => {
      let d;
      try { d = await loadMethods(); } catch (e) { view.innerHTML = `<div class="card">${A.errorBox(e.message)}</div>`; return; }
      let premTools = [];
      try { const t = await VS.api('/api/tools'); premTools = (t.tools || []).filter((x) => x.access === 'premium').map((x) => x.name); } catch { /* the list still works without them */ }
      const p = d.premium || {};
      const u = S.user;
      const feats = p.features || [];
      const price = Number(p.price_usd) || 20;
      const per = periodLabel(Number(p.period_days) || 30);
      const priceTxt = `$${VS.fmt(price, price % 1 ? 2 : 0)}`;
      const ended = !u.premium && u.premium_until > 0;
      const howPay = `<div class="card pz-how"><div class="card-h"><h3>How paying works</h3></div><ol class="howpay"><li><b>Pick a method</b><span>Card, bank, mobile money or crypto, depending on what is open in your country.</span></li><li><b>Pay the amount shown</b><span>Local prices use the rate on screen.</span></li><li><b>Premium starts</b><span>Card payments start at once. Transfers and crypto start when our team confirms them.</span></li></ol></div>`;
      if (!p.enabled && !u.premium) {
        view.innerHTML = `<div class="card">${A.empty('premium', 'Premium is not on sale right now', 'Check back soon. Everything free stays free.', '<a class="btn btn-w btn-sm" href="#support">Ask support</a>')}</div><div class="pz-grid one">${ordersCard()}</div>`;
        paintOrders(view, orders); loadOrders(view);
        return;
      }
      let left;
      if (u.premium) {
        const days = Math.max(0, Math.ceil((u.premium_until - Date.now()) / 86400000));
        const span = Number(p.period_days) || 30;
        left = `${VS.pmark('md', 'inv')}<span class="pz-k">You are Premium</span><h2>Good to have you in the square, ${esc(A.firstName(u.name))}.</h2>
          <p>Your Premium runs until <b>${esc(day(u.premium_until))}</b>. Renewing adds ${span} days on top.</p>
          <div class="pz-left"><span><b>${days}</b> day${days === 1 ? '' : 's'} left</span><i><i style="transform:scaleX(${Math.min(1, days / span).toFixed(3)})"></i></i></div>
          <div class="pz-acts"><button class="btn btn-l" data-renew>${icon('refresh')}Renew Premium</button><a class="btn pz-ghost" href="#community">${icon('rooms')}Premium rooms</a></div>`;
      } else {
        left = `${VS.pmark('md', 'inv')}<span class="pz-k">${ended ? `Your Premium ended on ${esc(day(u.premium_until))}` : esc(p.name || 'VooSquare Premium')}</span>
          <h2>${ended ? 'Pick up where you left off.' : 'Every room, course and tool in the square.'}</h2>
          <p>${ended ? 'Renew to get the Premium rooms, every course and the Premium tools back.' : esc(p.tagline || 'For operators who scale.')}</p>
          <div class="pz-price"><b>${priceTxt}</b><span>a ${esc(per)}</span></div>
          <div class="pz-acts"><button class="btn btn-l" data-buy>${icon('premium')}${ended ? 'Renew Premium' : 'Go Premium'}</button><span class="pz-note-t">Pay per period. No auto-renew, so no surprise charges.</span></div>`;
      }
      view.innerHTML = `<section class="pz-hero${u.premium ? ' on' : ''}"><div class="pz-copy">${left}</div>${scene(u)}</section>
        <div class="pz-grid">
          <div class="card pz-get"><div class="card-h"><h3>What you get</h3>${u.premium ? '<span class="pill pill-gold">' + icon('premium') + 'Active</span>' : `<span class="pz-pp">${priceTxt} a ${esc(per)}</span>`}</div>${featList(feats, premTools)}</div>
          <div class="pz-side">${u.premium ? '' : howPay}${ordersCard()}${u.premium ? '' : '<div class="card pz-free"><b>Free stays free.</b><span>Your Voo ID, free rooms, free courses, the blog and support for every tool stay free for life.</span></div>'}</div>
        </div>`;
      parallax(view);
      paintOrders(view, orders);
      loadOrders(view);
    };
    const loadOrders = async (root) => {
      try { orders = (await VS.api('/api/me/orders')).orders || []; paintOrders(root, orders); } catch { /* keep what is shown */ }
    };
    paint();
    view.addEventListener('click', (e) => {
      if (e.target.closest('[data-buy],[data-renew]')) A.checkout({ item: 'premium' });
      const rc = e.target.closest('[data-rc]');
      if (rc) { const o = (orders || []).find((x) => x.ref === rc.dataset.rc); if (o) receipt(o, () => loadOrders(view)); }
      if (e.target.closest('[data-retry]')) paint();
    });
    const offs = [A.on('orders', () => loadOrders(view)), A.on('user', () => paint())];
    return () => offs.forEach((f) => f());
  }

  /* ---------------- your payments: a receipt list ---------------- */
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (t) => { const d = new Date(t); return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`; };
  const SHORT = { pending: ['Pending', 'st-wait'], review: ['Checking', 'st-check'], paid: ['Paid', 'st-paid'], failed: ['Failed', 'st-bad'], refunded: ['Refunded', 'st-off'], cancelled: ['Cancelled', 'st-off'], expired: ['Expired', 'st-off'] };
  const stPill = (s, long) => { const x = SHORT[s] || [s, 'st-off']; return `<span class="rc-st ${x[1]}">${esc(long ? (ORDER_STATUS[s] || [x[0]])[0] : x[0])}</span>`; };
  /** "$20.00" for dollars, "20 USDT" with the code set smaller for everything else. */
  function amt(n, cur) {
    const c = String(cur || '').toUpperCase(), x = Number(n) || 0;
    if (c === 'USD') return `<b>$${VS.fmt(x, 2)}</b>`;
    const d = ['BTC', 'ETH'].includes(c) ? x.toLocaleString('en-US', { maximumFractionDigits: 8 }) : VS.fmt(x, x % 1 ? 2 : 0);
    return `<b>${esc(d)}</b><small>${esc(c)}</small>`;
  }
  const rcIcon = (o) => (o.item_type === 'room' ? `<span class="rc-ic room">${icon('rooms')}</span>` : `<span class="rc-ic">${icon('premium')}</span>`);
  const ordersCard = () => '<div class="card pz-pay" id="ordersCard"><div class="card-h"><h3>Your payments</h3></div><div id="ordersList"><div class="rc-list">' + A.skel(56) + '</div></div></div>';
  function paintOrders(root, list) {
    const box = root.querySelector('#ordersList');
    if (!box || !list) return;
    if (!list.length) {
      box.innerHTML = `<div class="rc-empty"><svg viewBox="0 0 64 72" aria-hidden="true"><path d="M12 6h40v58l-6.7-4-6.6 4-6.7-4-6.7 4-6.6-4-6.7 4z" fill="#fff" stroke="#D4E0DA" stroke-width="2" stroke-linejoin="round"/><path d="M20 20h24M20 29h16M20 38h20" stroke="#D4E0DA" stroke-width="3" stroke-linecap="round"/><rect x="36" y="44" width="10" height="10" rx="3" fill="#0A1A13"/><rect x="48" y="38" width="4.6" height="4.6" rx="1.3" fill="#C9F65B"/></svg><b>No payments yet</b><span>Receipts for Premium and paid rooms show up here.</span></div>`;
      return;
    }
    box.innerHTML = `<div class="rc-list">${list.map((o) => `<button type="button" class="rc" data-rc="${esc(o.ref)}" aria-label="Receipt for ${esc(o.item_name)}, ${esc(day(o.created_at))}">${rcIcon(o)}
      <span class="rc-t"><b>${esc(o.item_name)}</b><small>${esc(day(o.created_at))}<i>#${esc(o.ref)}</i></small></span>
      <span class="rc-a"><span class="rc-v">${amt(o.amount, o.currency)}</span>${stPill(o.status)}</span></button>`).join('')}</div>`;
  }
  function receipt(o, done) {
    const usd = Number(o.amount_usd);
    const when = (t) => `${day(t)}, ${VS.timeStr(t)}`;
    const rows = [
      ['Method', o.method ? esc(o.method) : '—'],
      String(o.currency).toUpperCase() !== 'USD' && Number.isFinite(usd) && usd > 0 ? ['In US dollars', `<b>$${VS.fmt(usd, 2)}</b>`] : null,
      ['Ordered', esc(when(o.created_at))],
      o.paid_at ? ['Paid', esc(when(o.paid_at))] : null,
      ['Order ID', `<span class="rcp-id"><code>${esc(o.ref)}</code><button type="button" class="btn btn-w btn-xs" data-copyref>${icon('copy')}Copy</button></span>`],
    ].filter(Boolean);
    const m = A.modal(`${A.modalHead('Receipt')}<div class="vs-modal-b rcp">
      <div class="rcp-top">${rcIcon(o)}<span class="rcp-n">${esc(o.item_name)}</span><span class="rcp-amt">${amt(o.amount, o.currency)}</span>${stPill(o.status, true)}</div>
      <div class="rcp-cut" aria-hidden="true"></div>
      <dl class="rcp-dl">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${o.status === 'pending' ? `<div class="rcp-acts"><button class="btn btn-g btn-block" data-resume>${icon('card')}See payment details</button><button class="btn btn-k btn-block" data-addproof>${icon('check')}I have paid: add proof</button><button class="btn btn-ghost btn-sm" data-cancelo>Cancel this order</button></div>` : ''}
      ${o.status === 'expired' ? '<p class="rcp-note">This order was not paid in time, so it closed. Nothing was charged. Start a new payment when you are ready.</p>' : ''}
      <p class="rcp-help">Something wrong with this payment? <a href="#support" data-close>Message support</a> with the order ID.</p></div>`, { cls: 'am-sm am-rcp' });
    m.el.querySelector('[data-copyref]').addEventListener('click', (e) => VS.copyText(o.ref, e.currentTarget.previousElementSibling));
    const ap = m.el.querySelector('[data-addproof]');
    if (ap) ap.addEventListener('click', () => { m.close(); proofModal(o.ref, done); });
    const rs = m.el.querySelector('[data-resume]');
    if (rs) rs.addEventListener('click', () => { m.close(); resumeOrder(o.ref); });
    const cx = m.el.querySelector('[data-cancelo]');
    if (cx) cx.addEventListener('click', async () => {
      if (cx.dataset.sure !== '1') { cx.dataset.sure = '1'; cx.classList.add('btn-danger'); cx.textContent = 'Yes, cancel it. I have not paid'; return; }
      await A.busy(cx, async () => {
        try { await VS.api(`/api/billing/orders/${encodeURIComponent(o.ref)}/cancel`, { body: {} }); m.close(); VS.toast('Order cancelled'); if (done) done(); } catch (e) { A.errToast(e); }
      });
    });
  }
  /** Carry on with an unpaid order: the same payment details and proof step as checkout. */
  async function resumeOrder(ref) {
    const m = A.modal(`${A.modalHead('Finish your payment', 'Order ' + esc(ref))}<div class="vs-modal-b ck">${A.skel(64)}${A.skel(120)}</div>`, { cls: 'am-ck' });
    const b = m.el.querySelector('.ck');
    try {
      const d = await VS.api('/api/billing/orders/' + encodeURIComponent(ref));
      if (d.order.status !== 'pending' || !d.pay) { b.innerHTML = `<p class="muted">This order is ${esc((ORDER_STATUS[d.order.status] || [d.order.status])[0].toLowerCase())} now.</p>`; return; }
      payStep(b, { order: d.order, pay: d.pay, reused: true }, m);
    } catch (e) { b.innerHTML = A.errorBox(e.message, false); }
  }
  function proofModal(ref, done) {
    const m = A.modal(`${A.modalHead('Confirm your payment', 'Order ' + esc(ref))}<div class="vs-modal-b">${proofFields('manual', 'either', '', '')}<button class="btn btn-g" data-send>${icon('check')}Send to our team</button></div>`, { cls: 'am-sm' });
    const att = bindProof(m.el);
    m.el.querySelector('[data-send]').addEventListener('click', (e) => submitProof(e.currentTarget, ref, m.el.querySelector('#proof'), att, 'either', () => { m.close(); VS.toast('Thanks. We are checking your payment.'); if (done) done(); }));
  }

  /* ---------------- payment return: #billing-return:<ref> ---------------- */
  function renderReturn(view, ref) {
    let tries = 0, timer = null, stopped = false;
    let t0 = Date.now();
    const wait = (title, body) => {
      view.innerHTML = `<div class="ret card"><div class="chk-anim big" aria-hidden="true"><i></i><i></i><i></i><i></i></div><h2>${esc(title)}</h2><p>${esc(body)}</p><p class="mono small muted">Order ${esc(ref)}</p></div>`;
    };
    wait('Confirming your payment', 'This usually takes a few seconds. Keep this page open.');
    const poll = async () => {
      if (stopped) return;
      tries++;
      try {
        const d = await VS.api('/api/billing/orders/' + encodeURIComponent(ref));
        const o = d.order;
        if (d.user) { S.user = d.user; A.emit('user'); }
        if (o.status === 'paid') {
          view.innerHTML = `<div class="ret card done"><div class="ret-badge pm">${VS.pmark('lg', 'inv')}</div><span class="kick">Payment confirmed</span><h2>${o.item_type === 'premium' ? 'Welcome to Premium.' : 'You are in.'}</h2><p>${esc(o.item_name)} is active${o.item_type === 'premium' && d.user && d.user.premium_until ? ` until ${esc(VS.dateStr(d.user.premium_until))}` : ''}. A receipt is on its way to your email.</p>
            ${o.item_type === 'premium' ? `<span class="bdg bdg-prem big">${icon('premium')}Premium</span>` : ''}
            <div class="acts">${o.item_type === 'room' ? `<a class="btn btn-k" href="#community/${o.item_id}">${icon('chat')}Open the room</a>` : `<a class="btn btn-k" href="#community">${icon('chat')}Premium rooms</a><a class="btn btn-w" href="#academy">${icon('book')}All courses</a>`}</div></div>`;
          VS.confetti();
          A.loadRooms().catch(() => {});
          return;
        }
        if (o.status === 'failed' || o.status === 'cancelled') {
          view.innerHTML = `<div class="ret card"><div class="ret-badge err">${icon('x')}</div><h2>The payment did not go through</h2><p>Nothing was taken for this order. You can try again or pick another method.</p><div class="acts"><a class="btn btn-k" href="#premium">Try again</a><a class="btn btn-w" href="#support">Message support</a></div></div>`;
          return;
        }
        if (o.status === 'review') wait("We're checking your payment", 'Our team confirms transfers within a few hours. You can leave this page; we will notify you.');
      } catch (e) {
        if (e.status === 404) { view.innerHTML = `<div class="card">${A.empty('card', 'Order not found', 'This payment link does not match an order on your account.', '<a class="btn btn-w btn-sm" href="#premium">Back to Premium</a>')}</div>`; return; }
      }
      if (Date.now() - t0 > 120_000) {
        view.innerHTML = `<div class="ret card"><div class="ret-badge wait">${icon('clock')}</div><h2>Still waiting for confirmation</h2><p>Some payments take longer to confirm. We will email you and notify you here as soon as it lands. Nothing else to do on your side.</p><div class="acts"><button class="btn btn-k" data-again>Check again</button><a class="btn btn-w" href="#support">Message support</a></div></div>`;
        view.querySelector('[data-again]').addEventListener('click', () => { tries = 0; t0 = Date.now(); wait('Confirming your payment', 'Checking again.'); poll(); });
        return;
      }
      timer = setTimeout(poll, 3000);
    };
    poll();
    const off = A.on('order', (o) => { if (o.ref === ref) { clearTimeout(timer); poll(); } });
    return () => { stopped = true; clearTimeout(timer); off(); };
  }

  A.pages.premium = { title: 'Premium', render: renderPremium };
  A.pages['billing-return'] = { title: 'Payment', nav: 'premium', render: renderReturn };
})();
