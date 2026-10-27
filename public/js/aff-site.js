/* VooSquare Affiliates: public site (affiliate.voosquare.com and voosquare.com/affiliates), terms, Voo ID sign-in and the
 * four-step application. Ported from the approved preview (site.js); program figures come from /api/aff/public. */
(function () {
  'use strict';
  const A = window.AF, VS = A.VS, S = A.S;
  const { esc, icon, fmt, pi, face, $c, $c0, pct } = A;

  const signedIn = () => !!S.user;
  const navCta = () => {
    if (S.me && S.me.status !== 'closed') return `<a class="btn btn-l btn-sm" href="#/aff/home">${icon('home')}My dashboard</a>`;
    if (signedIn() && S.staff && S.staff.roles) return `<a class="btn btn-ghost btn-sm snav-login" href="${A.staffHome()}">Back office</a><a class="btn btn-l btn-sm snav-join" href="#/join/signin">Join</a>`;
    return `<a class="btn btn-ghost btn-sm snav-login" href="#/join/login">Log in</a><a class="btn btn-l btn-sm snav-join" href="#/join/signin">Join<span class="hide-s"> the program</span></a>`;
  };
  const nav = () => `<header class="snav"><div class="wrap snav-in">${A.logo('Affiliates')}
    <nav class="snav-l" aria-label="Sections"><a href="#/site" data-scroll="how">How it works</a><a href="#/site" data-scroll="products">Products</a><a href="#/site" data-scroll="tiers">Tiers</a><a href="#/site" data-scroll="subs">Sub-affiliates</a><a href="#/site" data-scroll="payouts">Payouts</a><a href="#/site" data-scroll="faq">FAQ</a></nav>
    <div class="snav-r">${navCta()}<button class="snav-m" data-snav aria-label="Menu">${icon('menu')}</button></div></div></header>`;

  /* Program figures, from the server settings. */
  function prog() {
    const p = S.pub || {};
    const T = A.tiers();
    const methods = p.payout_methods || [];
    const usdt = methods.find((m) => m.method === 'usdt_trc20'), btc = methods.find((m) => m.method === 'btc');
    const days = T.map((t) => t.payout_days).filter(Boolean);
    const prods = (p.products || []).filter((x) => x.commissionable);
    return {
      minRate: T[0].rate, maxRate: T[T.length - 1].rate, cpaMax: (p.cpa_max_cents || 30000) / 100, attr: p.attribution_days || 60,
      payMin: usdt ? usdt.min_cents / 100 : 50, btcMin: btc ? btc.min_cents / 100 : null, usdtFee: usdt && usdt.fee === 'covered',
      daysMax: days.length ? Math.max(...days) : 3, daysMin: days.length ? Math.min(...days) : 1, products: prods, nTools: prods.filter((x) => x.key !== 'room').length || 7,
      hold: (p.holds && p.holds.spend_days) || 0, health: p.health || { threshold: 50, window_days: 90, ramp_days: 90, grace_days: 30 }, act: p.activation_customers ?? 5,
      subs: p.subs || { enabled: false, rate_bp: 250, boosted_rate_bp: 500, boost_subs: 50, boost_sub_customers: 10 }, contests: p.contests || [],
    };
  }
  const n0 = (v) => fmt(v, v % 1 ? 1 : 0);
  /* Telegram prefill: account.telegram is the alerts state object ({ configured, connected, username }) in /api/aff/me, while the
   * application keeps the handle as text. Only ever prefill a handle string, never "[object Object]". */
  const tgHandle = (v) => {
    if (typeof v === 'string') return v.trim();
    const u = v && typeof v === 'object' && typeof v.username === 'string' ? v.username.trim() : '';
    return u ? (u[0] === '@' ? u : '@' + u) : '';
  };

  function faq(P) {
    return [
      ['Who can join?', 'Anyone 18 or older with a Voo ID can apply. We approve affiliates with real traffic sources: ad accounts, channels, communities, audiences or client work.'],
      ['Can I see the dashboard before approval?', 'Yes. You see every page, create links and set up postbacks right away. You start earning on payments made after your account is approved.'],
      ['What is a qualified FTD?', 'A new paying customer you referred, counted at their first payment. No second payment, no waiting period. Tiers, contests and activation count qualified FTDs straight away.'],
      ['When can I withdraw my commission?', 'Straight away. RevShare is automatic: when your customer uses credits or buys a plan, your commission lands in Available at once. Credits that have been used are non-refundable, so that commission is final; only a card chargeback or proven fraud can reverse it.'],
      ['How long do I earn from a customer?', `For life, while your lifetime RevShare is active: your earnings start after your first ${P.act} qualified customers, and after a ${P.health.ramp_days}-day ramp-up you keep it active with ${P.health.threshold} new qualified customers in any rolling ${P.health.window_days} days.`],
      ['Do I earn on every tool?', 'On every tool listed on the Offers page, including tools that launch later. Affleego is part of VooSquare but runs separately and is not in the affiliate program (no commission). Inner Circle is excluded and Gatevoo is excluded until we turn it on. Credits a customer buys count when they are used, not when they are bought.'],
      ['How is my tier decided?', 'From your average qualified FTDs over the last two complete months, set on the 1st. You can also move up mid-month if this month alone reaches the next level.'],
      ['Can I drop a tier?', 'Yes, by one tier at most per month, and only after a grace month. A refund rate over 15% drops one tier without grace.'],
      ['How do CPA deals work?', `CPA is by approval, up to $${n0(P.cpaMax)}. Each conversion gets a quick fraud and duplicate check; once approved it is available to withdraw. CPA pays only for unique first-time customers: anyone who had a Voo ID before your click earns no CPA.`],
      ['When and how do I get paid?', `Request your available balance in USDT (TRC20)${P.btcMin ? ' or BTC' : ''}. We send within ${P.daysMin} to ${P.daysMax} business days. Minimum $${n0(P.payMin)}. Every payout comes with a PDF receipt.`],
      ['How long do cookies last?', `Your link holds a visitor for ${P.attr} days. If they create their Voo ID in that time, they are your customer for life.`],
      ['Can I invite other affiliates?', `Yes. You earn ${pct(P.subs.rate_bp)} of what we pay the affiliates you invite, paid by Zedapex and never taken from theirs, and ${pct(P.subs.boosted_rate_bp)} once ${P.subs.boost_subs} of them each have ${P.subs.boost_sub_customers} qualified paying customers.`],
      ['Can I run ads on the VooSquare brand name?', 'No bidding on VooSquare, Zedapex or any tool name in search ads, and no ads that look like they come from us. Full rules are in the affiliate terms.'],
      ['Can I promote it as a way to make money?', "No income claims. Promote what the tools do. Do not promise results from trading, betting or ads, and follow the ad platform's rules and the law in every country you run."],
      ['Do you share customer details?', 'No. You see a customer reference, country, product, plan, payments and status. Names, emails and contact details stay private.'],
    ];
  }
  const acc = (items) => `<div class="acc">${items.map(([q, a], i) => `<div class="acc-i${i === 0 ? ' open' : ''}"><button data-acc aria-expanded="${i === 0}"><span>${esc(q)}</span><i>${icon('plus')}</i></button><div class="acc-b"><p>${esc(a)}</p></div></div>`).join('')}</div>`;

  function poster(p, P) {
    const b = A.brand(p.key);
    const cap = p.cap_bp / 100;
    const capLine = `Up to ${n0(cap)}% lifetime`;
    const cpaLine = p.key === 'replyvoo' ? `CPA up to $${n0(P.cpaMax)}` : p.cpa_example_cents ? `CPA from ${$c0(p.cpa_example_cents)}` : 'RevShare deals';
    const st = p.status === 'live' ? '' : p.status === 'waitlist' ? 'Waitlist' : p.status === 'soon' || p.status === 'coming_soon' ? 'Coming soon' : '';
    return `<article class="poster pz-${p.key}" style="--a:${b.a};--b:${b.b};--acc:${b.acc};--ink:${b.ink}" data-io>
      <div class="pz-top">${pi(p.key, 'lg')}<div><h3>${esc(p.name)}</h3><span class="pz-stage">${esc(b.stage)}${st ? ` · ${st}` : ''}</span></div></div>
      <div class="pz-scene">${A.brandScene(p.key)}</div>
      <p class="pz-pitch">${esc(p.pitch)}</p>
      <p class="pz-who"><b>Who buys it</b>${esc(p.who)}</p>
      <div class="pz-deal"><span><small>RevShare</small><b>${capLine}</b></span><span><small>By approval</small><b>${cpaLine}</b></span></div>
      <a class="pz-cta" href="#/join/signin">Promote ${esc(b.short || p.name)}${icon('arrow')}</a>
    </article>`;
  }

  /* Lifetime RevShare health: how earnings activate and stay active. */
  function healthSection(P) {
    const H = P.health;
    const states = [['g', 'Active', `${H.threshold}+ new qualified customers in the last ${H.window_days} days. You earn on every customer, for life.`],
      ['amb', 'At risk', 'Your pace is slowing. We warn you on the dashboard and in Telegram while there is time to fix it.'],
      ['w', 'Grace', `Below ${H.threshold}: you have ${H.grace_days} days to get back. You keep earning meanwhile.`],
      ['r', 'Paused', 'After grace, RevShare on existing customers stops until you are back at the threshold. CPA deals keep paying.']];
    return `<section class="sec hlth" id="health"><div class="wrap"><div class="sec-h"><h2>Lifetime RevShare that stays switched on</h2><p>Your earnings activate with your first ${P.act} qualified customers. The first ${H.ramp_days} days after that are your ramp-up. Then a steady ${H.threshold} new qualified customers in any rolling ${H.window_days} days keeps lifetime RevShare active.</p></div>
      <div class="hl-grid">
        <div class="hl-meter card" data-io><div class="hl-mh"><b>Health meter</b><span class="hl-chip hl-g"><i class="live-dot"></i>Active</span></div>
          <div class="hl-bar"><i style="--p:.82"></i><span class="hl-th" style="--t:.71"><em>${H.threshold}</em></span></div>
          <div class="hl-ax"><span>0</span><span>${H.window_days}-day window</span></div>
          <ol class="hl-steps"><li><b>${P.act}</b><span>qualified customers activate earnings</span></li><li><b>${H.ramp_days} days</b><span>ramp-up, nothing to keep up</span></li><li><b>${H.threshold} / ${H.window_days} days</b><span>keeps lifetime RevShare active</span></li></ol>
          <p class="muted sm">Example meter. Yours shows your real count, days left and what is needed.</p></div>
        <div class="hl-states">${states.map(([t, n, d]) => `<div class="hl-s hl-${t}"><span class="hl-chip hl-${t}">${n}</span><p>${d}</p></div>`).join('')}</div>
      </div></div></section>`;
  }
  const avInner = (cfg) => VS.avatar(cfg).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  function subsSection(P) {
    const s = P.subs;
    return `<section class="sec subsx" id="subs"><div class="wrap subsx-in">
      <div><h2>Bring other affiliates. Earn on their results too.</h2><p class="lead">Invite media buyers and creators with your recruit link. You earn ${pct(s.rate_bp)} of the commission we pay them, paid by Zedapex and never taken from theirs. One level only.</p>
        <div class="subsx-r"><div><b>${pct(s.rate_bp)}</b><span>of your sub-affiliates' approved commission</span></div><div class="up"><b>${pct(s.boosted_rate_bp)}</b><span>with ${s.boost_subs} active subs who each have ${s.boost_sub_customers}+ qualified paying customers</span></div></div>
        <p class="muted sm">${s.enabled ? 'Your recruit link is on the Sub-affiliates page once you are approved and active.' : 'Opening soon. Your recruit link appears on the Sub-affiliates page when it opens.'}</p>
        <a class="btn btn-k" href="#/join/signin">Become an affiliate</a></div>
      <div class="netw" data-io aria-hidden="true"><svg viewBox="0 0 320 240"><g class="nw-e">${[[60, 180], [160, 200], [260, 180], [40, 90], [280, 90]].map(([x, y]) => `<line x1="160" y1="100" x2="${x}" y2="${y}"/>`).join('')}</g>
        <defs><clipPath id="nwc"><circle cx="32" cy="32" r="32"/></clipPath></defs>
        ${[[60, 180, 3], [160, 200, 8], [260, 180, 12], [40, 90, 15], [280, 90, 19]].map(([x, y, i], j) => `<g class="nw-n" style="--j:${j}" transform="translate(${x - 18} ${y - 18}) scale(.5625)" clip-path="url(#nwc)">${avInner(A.faceN(i))}</g>`).join('')}
        <g transform="translate(130 70) scale(.94)" clip-path="url(#nwc)">${avInner(A.F.amara)}</g><circle cx="160" cy="100" r="31" fill="none" stroke="#C9F65B" stroke-width="2.5"/></svg>
        <span class="nw-tag">+${pct(s.rate_bp)} on each</span></div>
    </div></section>`;
  }
  function contestTeaser(P) {
    const c = P.contests.find((x) => x.status === 'live') || P.contests[0];
    const line = c ? `<div class="cont-now"><span class="live-dot"></span><b>${esc(c.title)}</b><span>${c.status === 'live' ? `${A.daysLeft(c.ends_at)} days left` : `Starts ${A.ds(c.starts_at)}`}</span>${c.pool_cents ? `<span>Prize pool ${$c0(c.pool_cents)}</span>` : ''}</div>` : '<div class="cont-now"><b>The next contest is announced in the dashboard and on Telegram.</b></div>';
    return `<section class="sec cont" id="contests"><div class="wrap"><div class="cont-c" data-io>
      <div class="cont-t"><h2>Monthly races, seasonal challenges</h2><p>Leaderboards scored on qualified FTDs, with prizes for the top affiliates and a separate prize for newer ones. Rules and anti-fraud checks are published before each contest starts.</p>
        ${line}<a class="btn btn-l" href="${S.me ? '#/aff/contests' : '#/join/signin'}">See contests</a></div>
      ${A.podium([{ name: 'First place', sub: 'Top prize', avatar: A.faceN(8) }, { name: 'Second place', sub: 'Prize', avatar: A.faceN(3) }, { name: 'Third place', sub: 'Prize', avatar: A.faceN(6) }])}</div></div></section>`;
  }

  function landing() {
    const P = prog();
    const props = [
      ['target', 'Your audience already needs this.', 'Research, creatives, tracking, follow-up, checkout. Every buyer pays for these somewhere. The Voo tools cover each step.'],
      ['stack', 'One customer, every tool.', 'The customer you bring is yours across every Zedapex product they pay for, including tools that launch later.'],
      ['refresh', 'Monthly plans, monthly commission.', 'Most Voo products are subscriptions. Your share repeats for as long as the customer stays.'],
      ['chart', 'Tracking you can check.', 'Sub IDs, server postbacks with logs, and Telegram alerts for every sign-up, payment and payout.'],
      ['wallet', 'Paid in crypto, quickly.', `Request a payout and we send USDT or BTC within ${P.daysMin} to ${P.daysMax} business days, with a PDF receipt.`],
      ['headset', 'A manager who answers.', 'Every affiliate gets a manager from day one. Bigger affiliates get a private one.'],
    ];
    const steps = [['Apply with your Voo ID.', 'Tell us where your traffic comes from. You see the whole dashboard straight away.'], ['Get approved.', 'We review applications in about 2 business days. Earnings start from approval.'],
      ['Share your links.', 'Pick a product, add sub IDs, use our creatives. Track every click, sign-up and payment.'], ['Get paid.', 'Commission is available the moment your customer pays. Request a payout in USDT or BTC.']];
    const order = ['joinvoo', 'spyvoo', 'replyvoo', 'vooads', 'premium', 'castvoo', 'landvoo'];
    const prods = order.map((k) => P.products.find((p) => p.key === k) || ((S.pub && S.pub.products) || []).find((p) => p.key === k && p.key === 'landvoo')).filter(Boolean);
    const cpaRows = [['joinvoo', 'Joinvoo Pro'], ['replyvoo', "Replyvoo's top plan"], ['spyvoo', 'Spyvoo Pro'], ['premium', 'VooSquare Premium']].map(([k, l]) => { const p = P.products.find((x) => x.key === k); return [k, l, k === 'replyvoo' ? P.cpaMax * 100 : (p && p.cpa_example_cents) || 0, k === 'replyvoo']; }).filter((r) => r[2] > 0);
    return `<div class="site">${nav()}
    <section class="hero"><div class="wrap hero-in">
      <div class="hero-t">
        <span class="hero-eb">VooSquare Affiliates</span>
        <h1>Up to ${n0(P.maxRate)}% lifetime RevShare. CPA up to $${n0(P.cpaMax)} for approved partners.</h1>
        <p class="hero-sub">One Voo ID link covers VooSquare, Spyvoo, Joinvoo, Vooads, Replyvoo, Castvoo and Landvoo. Crypto payouts in ${P.daysMin} to ${P.daysMax} business days.</p>
        <div class="hero-cta">${S.me ? `<a class="btn btn-l" href="#/aff/home">Open my dashboard</a>` : `<a class="btn btn-l" href="#/join/signin">Become an affiliate</a><a class="btn hero-b2" href="#/join/login">${icon('id')}Log in</a>`}</div>
        <p class="hero-small">Free to join. Sign in with your Voo ID. Approval in about 2 business days.${S.me ? '' : ' <a href="#/site" data-scroll="products">See the deals</a>'}</p>
      </div>
      <div class="hero-v">${A.moneyMachine()}</div>
    </div>
    <div class="facts"><div class="wrap facts-in">
      <div><b>${n0(P.minRate)} to ${n0(P.maxRate)}%</b><span>Lifetime RevShare</span></div><div><b>$${n0(P.cpaMax)}</b><span>Top CPA, by approval</span></div><div><b>${P.daysMin} to ${P.daysMax} days</b><span>USDT and BTC payouts</span></div><div><b>${P.nTools} tools</b><span>One link for all of them</span></div>
    </div></div></section>

    <section class="sec why" id="why"><div class="wrap why-in">
      <div class="why-h"><h2>Why buyers promote VooSquare</h2><p class="lead">The offer you already use, paid for life.</p>
        <figure class="founder"><span class="av av-lg">${VS.founder()}</span><blockquote>"I built these tools because I needed them for my own campaigns. If you run traffic, you already know who needs them. Send them over and we pay you for as long as they stay."</blockquote><figcaption><b>Dchessking</b>Founder, Zedapex</figcaption></figure></div>
      <div class="why-l">${props.map((p) => `<div class="why-i" data-io><span class="why-ic">${icon(p[0])}</span><div><h3>${p[1]}</h3><p>${p[2]}</p></div></div>`).join('')}</div>
    </div></section>

    <section class="sec how" id="how"><div class="wrap"><h2>How it works</h2>
      <ol class="how-l" data-io>${steps.map((s, i) => `<li style="--i:${i}"><span class="how-n">${i + 1}</span><h3>${s[0]}</h3><p>${s[1]}</p></li>`).join('')}</ol></div></section>

    <section class="sec prods" id="products"><div class="wrap"><div class="sec-h"><h2>What you promote</h2><p>${P.nTools} tools across the buyer's funnel. Each customer you bring pays you on every one of them they use.</p></div>
      <div class="posters">${prods.map((p) => poster(p, P)).join('')}</div>
      <p class="prods-note">${icon('help')}Affleego runs separately and is not part of the affiliate program. Gatevoo, our crypto checkout, is on a waitlist and is not part of the program yet. Inner Circle is not commissionable.</p></div></section>

    <section class="sec tiers" id="tiers"><div class="wrap"><div class="sec-h"><h2>The more customers you bring, the higher your share</h2><p>Your tier is set each month from your average qualified FTDs over the last two months. Hit the next level mid-month and you move up that day.</p></div>
      ${A.stairs(6)}
      <p class="foot-n">Vooads and Replyvoo pay up to 35% because AI costs more to run. Legend needs approval. A qualified FTD is a new paying customer, counted at their first payment. RevShare is available instantly.</p></div></section>

    ${healthSection(P)}

    <section class="sec cpa" id="cpa"><div class="wrap cpa-in">
      <div class="cpa-t"><h2>Prefer a fixed amount per customer?</h2><p>Elite affiliates, and others we approve, can run CPA or Hybrid deals on selected products. CPA goes up to $${n0(P.cpaMax)} per qualified customer on Replyvoo's top plan. Every CPA conversion gets a quick fraud and duplicate check by our team; once approved it is available to withdraw.</p>
        <p class="cpa-rule">${icon('shield')}<span>CPA pays for unique, first-time paying customers only. Anyone who had a Voo ID before your click earns RevShare rules, never CPA.</span></p>
        <a class="btn btn-k" href="#/join/signin">Become an affiliate</a></div>
      <div class="receipt" data-io><div class="rc-h"><b>CPA per qualified customer</b><small>Reviewed by our team</small></div>
        ${cpaRows.map((r, i) => `<div class="rc-r" style="--i:${i}">${pi(r[0], 'sm')}<span>${r[1]}</span><i class="rc-dots"></i><b>${r[3] ? 'up to ' : 'from '}${$c0(r[2])}</b>${r[3] ? '<span class="ex ex-g">Cap</span>' : ''}</div>`).join('')}
        <div class="rc-f"><span>After approval</span><b>Available at once</b></div><span class="rc-stamp">Reviewed</span></div>
    </div></section>

    ${subsSection(P)}

    <section class="sec pays" id="payouts"><div class="wrap"><div class="sec-h"><h2>Paid in crypto within ${P.daysMin} to ${P.daysMax} business days</h2><p>Request your available balance in USDT (TRC20)${P.btcMin ? ' or BTC' : ''}. We send it within ${P.daysMin} to ${P.daysMax} business days, faster at higher tiers. Minimum $${n0(P.payMin)}.${P.usdtFee ? ' We cover the TRC20 network fee.' : ''} Every payout has a PDF receipt.</p></div>
      ${A.payTrack(P.hold)}
      <div class="pays-m"><span class="cm cm-usdt"><i>₮</i>USDT · TRC20<small>Min $${n0(P.payMin)}${P.usdtFee ? ' · fee covered' : ''}</small></span>${P.btcMin ? `<span class="cm cm-btc"><i>₿</i>Bitcoin<small>Min $${n0(P.btcMin)}</small></span>` : ''}<span class="cm"><i>${icon('clock')}</i>Starter to Pro: ${P.daysMax} days<small>Faster as your tier grows</small></span></div></div></section>

    ${contestTeaser(P)}

    <section class="sec acad"><div class="wrap acad-in"><div class="sec-h"><h2>Learn to promote each tool</h2><p>Start here takes 10 minutes and covers how the program pays. Then go deeper in VooSquare Academy: traffic, tracking, compliance and scaling, with certificates.</p></div>
      <div class="acad-l">${[['Start here', 'How the program pays, qualifies and pays out', '10 min', '#00A86B'], ['Foundations', 'Traffic, numbers, funnels and tracking', 'VooSquare Academy', '#0A1611'], ['Operator', 'Offers, Meta in depth, creatives', 'VooSquare Academy', '#5B3FE8'], ['Compliance', 'Ad rules, no income claims, disclosures', 'In Start here', '#EE5A2F'], ['Scale', 'Scaling mechanics and infrastructure', 'VooSquare Academy', '#0FA3A3'], ['Vertical schools', 'Finance, iGaming, trading and more', 'VooSquare Academy', '#E8A317']].map((m, i) => `<div class="am" style="--h:${m[3]}"><span class="am-n">${i === 0 ? 'First' : 'Track'}</span><b>${esc(m[0])}</b><small>${esc(m[1])} · ${esc(m[2])}</small><i class="am-bar"></i></div>`).join('')}</div></div></section>

    <section class="sec mgrs"><div class="wrap mgrs-in">
      <div><h2>A manager from day one</h2><p class="lead">Every affiliate gets a general manager who answers on Telegram. Reach Elite and a private manager helps with deals, CPA, creatives and tracking.</p>
        <div class="mgr-faces">${[['General', A.F.chidinma], ['Private', A.F.kwame], ['CPA review', A.F.fatima], ['Finance', A.faceN(14)]].map(([r, f]) => `<span>${face(f, 'lg')}<b>${r}</b><small>Manager</small></span>`).join('')}</div></div>
      <div class="chatmock" data-io aria-label="Example conversation with a manager">
        <div class="cm-m in">${face(A.F.amara, 'xs')}<p>My Joinvoo Pro CPA approvals dropped this week. What changed?</p></div>
        <div class="cm-m out"><p>Two of the declines were customers who already had a Voo ID. I'll send you the sub IDs. Your main campaign traffic is clean.</p>${face(A.F.kwame, 'xs')}</div>
        <div class="cm-m in">${face(A.F.amara, 'xs')}<p>Thanks. Can we raise the monthly cap next month?</p></div>
        <div class="cm-typing">${face(A.F.kwame, 'xs')}<span><i></i><i></i><i></i></span></div></div></div></section>

    <section class="sec faq" id="faq"><div class="wrap faq-in"><div><h2>Questions affiliates ask</h2><p class="lead">Still unsure? Your manager answers on Telegram once you apply.</p><a class="btn btn-w btn-sm" href="#/site/terms">${icon('shield')}Read the affiliate terms</a></div>${acc(faq(P))}</div></section>

    <section class="final"><div class="wrap final-in"><h2>Your audience already buys tools like these. Get paid for sending them to ours.</h2><div class="hero-cta fin-cta"><a class="btn btn-l" href="#/join/signin">Become an affiliate</a>${S.me ? '' : '<a class="btn hero-b2" href="#/join/login">Log in</a>'}</div>
      <p>Free to join. Read the <a href="#/site/terms">affiliate terms</a>. Earnings depend on your traffic and are never guaranteed.</p></div></section>
    ${footer()}</div>`;
  }
  const footer = () => `<footer class="sfoot"><div class="wrap sfoot-in"><div>${A.logo('Affiliates')}<p>Commissions are never guaranteed. What you earn depends on your traffic and the customers who stay.</p></div>
    <nav aria-label="Footer"><a href="#/site/terms">Affiliate terms</a><a href="#/site" data-scroll="faq">Program FAQ</a><a href="${S.me ? '#/aff/manager' : '#/join/login'}">Contact your manager</a><a href="/privacy">Privacy policy</a><a href="/">voosquare.com</a></nav><small>Zedapex Limited, Lagos</small></div></footer>`;

  async function termsPage() {
    const T = await A.loadTerms();
    return `<div class="site">${nav()}<section class="sec terms"><div class="wrap terms-in">
      <aside class="terms-toc"><b>Contents</b>${T.toc.map(([id, t]) => `<a href="#/site/terms" data-scroll="${id}">${esc(t)}</a>`).join('')}</aside>
      <article class="terms-b">${T.html}</article></div></section>${footer()}</div>`;
  }
  A.R.site = (page) => (S.off ? `<div class="site">${nav()}<section class="sec"><div class="wrap">${A.offCard()}</div></section>${footer()}</div>` : page === 'terms' ? termsPage() : landing());

  /* ================= Voo ID sign-in and the application ================= */
  const STEPS = ['About you', 'Your traffic', 'Your experience', 'Payout and agreement'];
  function joinShell(step, body) {
    return `<div class="join">
      <aside class="join-a"><a class="lg lg-l" href="#/site"><img src="/assets/logo-icon.svg" alt="" width="34" height="34"><span>VooSquare</span><em>Affiliates</em></a>
        <div class="join-art" aria-hidden="true"><svg viewBox="70 50 220 260">${A.figure(S.user && S.me ? A.avOf(S.me.avatar, S.me.email) : A.F.tunde, { shirt: '#12C784' })}</svg></div>
        ${step > 0 && step < 5 ? `<ol class="join-steps" aria-label="Application steps">${STEPS.map((s, i) => `<li class="${i + 1 < step ? 'done' : i + 1 === step ? 'on' : ''}" ${i + 1 === step ? 'aria-current="step"' : ''}><i>${i + 1 < step ? icon('check') : i + 1}</i>${s}</li>`).join('')}</ol>` : `<p class="join-q">One Voo ID for every Zedapex tool, and now for your affiliate account.</p>`}
        <small class="join-f">Zedapex Limited, Lagos</small></aside>
      <main class="join-m">${body}</main></div>`;
  }

  /* ---------- sign-in (email, then a 6-digit code) ---------- */
  /* needName: the server said this email is new (only after a correct code, so sign-in never reveals who has an account). */
  const SIGN = { email: '', dev: '', name: '', needName: false, code: '' };
  function signinCard(intent) {
    if (signedIn()) {
      return `<div class="vooid"><div class="vooid-c">${vooHead()}<h2>You are signed in</h2><p>Signed in with your Voo ID as <b>${esc(S.user.email || S.user.name || '')}</b>.</p>
        <button class="btn btn-g btn-block" data-continue="${intent}">${intent === 'login' ? 'Continue' : 'Continue to my application'}</button>
        <button class="btn btn-ghost btn-block" data-logout>Use another email</button></div></div>`;
    }
    return `<div class="vooid"><form class="vooid-c" data-signin="${intent}" novalidate>${vooHead()}
      <h2>${intent === 'login' ? 'Log in with your Voo ID' : 'Continue with your Voo ID'}</h2><p>Use the same Voo ID you use on VooSquare. Enter your email and we send you a 6-digit code. No password needed.</p>
      <label class="field"><span class="lbl">Email</span><input class="inp" type="email" name="email" inputmode="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="you@company.com" value="${esc(SIGN.email)}" required></label>
      <p class="err" role="alert" hidden></p>
      <button class="btn btn-g btn-block" type="submit">Send my code</button>
      <div class="vooid-or"><span>${intent === 'login' ? 'New here? <a href="#/join/signin">Become an affiliate</a>. We create your free Voo ID in the same step.' : 'New here? We create your free Voo ID in the same step.'}</span></div>
      <ul class="vooid-perm"><li>${icon('check')}One login for VooSquare, every Voo tool and your affiliate account</li><li>${icon('check')}Sign in with a code sent to your email</li><li>${icon('lock')}We never ask for your password or card details</li></ul>
      <p class="vooid-legal">A new Voo ID follows the VooSquare <a href="/terms" target="_blank" rel="noopener">Terms of service</a> and <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.</p></form></div>`;
  }
  const vooHead = () => `<div class="vooid-h">${A.logo()}<span class="vooid-lk">${icon('link')}</span><span class="vooid-af">${icon('chart')}</span></div>`;
  function codeCard(intent) {
    return `<div class="vooid"><form class="vooid-c" data-code="${intent}" novalidate autocomplete="off">${vooHead()}
      <h2>Check your email</h2><p>We sent a 6-digit code to <b>${esc(SIGN.email)}</b>. <button type="button" class="lnk" data-chg>Change</button></p>
      ${SIGN.needName ? `<p class="hint">New here? Add your name and we create your free Voo ID.</p><label class="field"><span class="lbl">Your name <em>new Voo ID</em></span><input class="inp" name="name" autocomplete="name" maxlength="60" placeholder="Tunde Bakare" value="${esc(SIGN.name)}"></label>` : ''}
      <label class="field"><span class="lbl">6-digit code</span><input class="inp otp1" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="••••••" value="${esc(SIGN.code)}" required></label>
      <p class="err" role="alert" hidden></p>
      <button class="btn btn-g btn-block" type="submit">Verify and continue</button>
      <div class="vooid-or"><span>Didn't get it? Check spam, or <button type="button" class="lnk" data-resend>send a new code</button>.</span></div>
      ${SIGN.dev ? `<div class="dev-hint">${icon('settings')}<span>Dev code: <b>${esc(SIGN.dev)}</b></span><button type="button" class="lnk" data-devfill>Fill it</button></div>` : ''}</form></div>`;
  }
  async function afterSignIn(intent) {
    try { S.vooUser = (await A.api('/api/me')).user; } catch { /* keep */ }
    await A.refreshMe().catch(() => null);
    await A.loadStaff();
    if (S.me && S.me.status !== 'closed') { A.liveUpdates(); location.hash = A.homeFor(); return; }
    if (intent === 'login') {
      if (S.staff && S.staff.roles) { location.hash = A.staffHome(); return; }
      location.hash = '#/join/none'; return;
    }
    const r = await A.POST('/api/aff/account', {});
    S.me = r.account; location.hash = A.homeFor();
  }
  // Sign-in forms: editing a field clears the message about it (it used to stay until the next submit).
  document.addEventListener('input', (e) => { const f = e.target.closest && e.target.closest('.join-m form'); const er = f && f.querySelector('.err'); if (er && !er.hidden) er.hidden = true; });
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-signin]');
    if (f) {
      e.preventDefault();
      const err = f.querySelector('.err'); const b = f.querySelector('[type=submit]');
      SIGN.email = f.email.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(SIGN.email)) { err.hidden = false; err.textContent = 'Enter a valid email so we can send your code.'; f.email.focus(); return; }
      const r = await A.act(b, () => A.POST('/api/auth/start', { email: SIGN.email, coupon: VS.coupon() || undefined }));
      if (!r) return;
      SIGN.needName = false; SIGN.code = ''; SIGN.dev = r.dev_code ? String(r.dev_code) : '';
      const m = document.querySelector('.join-m'); m.innerHTML = codeCard(f.dataset.signin); A.mount(m);
      const c = m.querySelector('[name=name]') || m.querySelector('[name=code]'); if (c) c.focus();
      return;
    }
    const g = e.target.closest('[data-code]');
    if (g) {
      e.preventDefault();
      const err = g.querySelector('.err'); const b = g.querySelector('[type=submit]');
      const code = g.code.value.replace(/\D/g, '');
      if (g.name) SIGN.name = g.name.value.trim();
      if (code.length !== 6) { err.hidden = false; err.textContent = 'Enter all 6 digits.'; g.code.focus(); return; }
      if (SIGN.needName && SIGN.name.length < 2) { err.hidden = false; err.textContent = 'Add your name so we know what to call you.'; g.name.focus(); return; }
      const r = await A.act(b, () => A.POST('/api/auth/verify', { email: SIGN.email, code, ask_name: true, name: SIGN.name || undefined, coupon: VS.coupon() || undefined }, { 'x-vs-fp': VS.fp() }));
      if (!r) { g.code.value = ''; g.code.focus(); return; }
      if (r.need_name) { SIGN.needName = true; SIGN.code = code; const m = document.querySelector('.join-m'); m.innerHTML = codeCard(g.dataset.code); A.mount(m); const n = m.querySelector('[name=name]'); if (n) n.focus(); return; }
      S.user = r.user;
      if (r.isNew && SIGN.name.length >= 2) { try { await A.PATCH('/api/me', { name: SIGN.name }); } catch { /* keep the default name */ } }
      if (r.isNew) A.celebrate();
      try { await afterSignIn(g.dataset.code); } catch (x) { VS.toast(x.message, 'err'); }
    }
  });
  document.addEventListener('click', async (e) => {
    if (e.target.closest('[data-chg]')) { const m = document.querySelector('.join-m'); m.innerHTML = signinCard(document.querySelector('[data-code]').dataset.code); A.mount(m); }
    const rs = e.target.closest('[data-resend]');
    if (rs) { const r = await A.act(rs, () => A.POST('/api/auth/start', { email: SIGN.email }), 'New code sent'); if (r && r.dev_code) { SIGN.dev = String(r.dev_code); const h = document.querySelector('.dev-hint b'); if (h) h.textContent = SIGN.dev; } }
    if (e.target.closest('[data-devfill]')) { const c = document.querySelector('[name=code]'); if (c) { c.value = SIGN.dev; c.form.requestSubmit(); } }
    const ct = e.target.closest('[data-continue]');
    if (ct) A.act(ct, () => afterSignIn(ct.dataset.continue));
    const mk = e.target.closest('[data-mkacc]');
    if (mk) A.act(mk, async () => { const r = await A.POST('/api/aff/account', {}); S.me = r.account; location.hash = A.homeFor(); });
  });

  /* ---------- application steps ---------- */
  const GEO_CHIPS = ['NG', 'KE', 'ZA', 'GH', 'CM', 'CI', 'SN', 'TZ', 'UG', 'EG', 'IN', 'BR'];
  const VERTS = ['Trading', 'iGaming', 'E-commerce', 'Lead gen', 'SaaS', 'Education', 'Other'];
  const YEARS = ['Under 1', '1 to 2', '3 to 5', '5+'];
  const LANGS = ['English', 'French', 'Swahili', 'Portuguese', 'Arabic', 'Other'];
  const HEARD = ['VooSquare community', 'Dchessking on Telegram', 'A friend', 'An affiliate network', 'Search', 'Other'];
  const PROD_CHIPS = [['premium', 'VooSquare Premium'], ['spyvoo', 'Spyvoo'], ['joinvoo', 'Joinvoo'], ['vooads', 'Vooads'], ['replyvoo', 'Replyvoo'], ['castvoo', 'Castvoo'], ['landvoo', 'Landvoo']];
  const chipset = (k, items, sel, max) => `<div class="chipset" data-chips="${k}" ${max ? `data-max="${max}"` : ''} role="group">${items.map(([v, l]) => { const on = sel.includes(v); return `<button type="button" data-v="${esc(v)}" class="${on ? 'on' : ''}" aria-pressed="${on}">${on ? icon('check') : ''}${esc(l)}</button>`; }).join('')}</div>`;
  const chips = (f, k) => [...f.querySelectorAll(`[data-chips="${k}"] .on`)].map((b) => b.dataset.v);
  const seg = (k, items, val) => `<div class="seg seg-lg" data-seg="${k}" role="radiogroup">${items.map(([v, l]) => `<button type="button" role="radio" data-v="${esc(v)}" aria-checked="${v === val}" class="${v === val ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
  const segv = (f, k) => { const b = f.querySelector(`[data-seg="${k}"] .on`); return b ? b.dataset.v : ''; };

  let APP = null;
  async function loadApp() { APP = await A.api('/api/aff/application'); return APP; }

  async function join(page) {
    if (page === 'signin' || page === 'login' || !page) return joinShell(0, signinCard(page === 'login' ? 'login' : 'join'));
    if (page === 'none') return joinShell(0, `<div class="jdone"><div class="jdone-ic">${icon('id')}</div><h2>You do not have an affiliate account yet</h2><p>You are signed in as ${esc((S.user && S.user.email) || '')}. Create your affiliate account with the same Voo ID. You see the full dashboard straight away; earning starts after approval.</p>
      <div class="lb-act"><button class="btn btn-g" data-mkacc>Create my affiliate account</button><button class="btn btn-ghost" data-logout>Use another email</button></div></div>`);
    if (!signedIn()) { location.replace('#/join/signin'); return null; }
    if (!S.me) { try { const r = await A.POST('/api/aff/account', {}); S.me = r.account; } catch (e) { return joinShell(0, A.errBox(e.message)); } }
    if (page === 'done') return joinShell(5, `<div class="jdone"><div class="jdone-ic">${icon('check')}</div><h2>Application sent.</h2><p>You can explore the dashboard while we review it. Most reviews take about 2 business days.${S.me.managers && S.me.managers.general ? ` Your manager is ${esc(S.me.managers.general.name)}.` : ''}</p>
      <div class="jdone-l"><span>${icon('link')}Create links and set up postbacks now</span><span>${icon('tg')}Connect Telegram alerts</span><span>${icon('book')}Take the 10-minute Start here lesson</span></div>
      <a class="btn btn-g" href="#/aff/home">Open my dashboard</a></div>`);
    if (page === 'declined' || S.me.status === 'rejected') {
      const can = !S.me.reapply_after || Date.now() >= S.me.reapply_after;
      return joinShell(5, `<div class="jdone dec"><div class="jdone-ic">${icon('x')}</div><h2>We could not approve your application</h2>
        <p>${S.me.decline_reasons.length ? `Reason: ${esc(S.me.decline_reasons.join(' '))}` : ''} ${can ? 'You can apply again now.' : `You can apply again after ${A.dt(S.me.reapply_after)}.`} Your Voo ID and the tools you use are not affected.</p>
        <div class="card"><b>What helps next time</b><ul class="ul">${['Links to channels, pages or ad libraries that show recent activity', 'The countries and products you plan to promote', 'How you plan to promote VooSquare, in a few sentences'].map((x) => `<li>${x}</li>`).join('')}</ul></div>
        <div class="lb-act">${can ? '<a class="btn btn-g" href="#/join/1" data-reapply>Apply again</a>' : ''}<a class="btn btn-w" href="#/site">Back to the affiliate site</a></div></div>`);
    }
    if (S.me.applied && S.me.status !== 'rejected') { location.replace('#/aff/home'); return null; }
    const n = Math.max(1, Math.min(4, Number(page) || 1));
    if (n > (S.me.app_step || 0) + 1) { location.replace(`#/join/${(S.me.app_step || 0) + 1}`); return null; }
    await loadApp();
    const a = APP.application || {};
    const me = S.me;
    const fields = {
      1: `<h2>Tell us who you are</h2>
        <div class="fgrid"><label class="field"><span class="lbl">Display name</span><input class="inp" name="display_name" maxlength="40" required value="${esc(a.display_name || me.display_name || '')}" placeholder="tunde.tg"><span class="hint">Shown on contest leaderboards. Use a handle if you prefer.</span></label>
        <div class="field"><span class="lbl" id="kindL">Type</span>${seg('kind', [['individual', 'Individual'], ['company', 'Company']], a.kind || 'individual')}</div>
        <label class="field" data-company ${a.kind === 'company' ? '' : 'hidden'}><span class="lbl">Company name</span><input class="inp" name="company" maxlength="80" value="${esc(a.company || '')}"></label>
        <label class="field"><span class="lbl">Country of residence</span><select class="inp" name="country" required>${A.countryOptions(a.country || me.country || '')}</select></label>
        <label class="field"><span class="lbl">Telegram username</span><input class="inp" name="telegram" required value="${esc(tgHandle(a.telegram) || tgHandle(me.telegram))}" placeholder="@your_handle" autocapitalize="off" spellcheck="false"><span class="hint">Your manager contacts you here.</span></label>
        <label class="field"><span class="lbl">WhatsApp <em>optional</em></span><input class="inp" name="whatsapp" value="${esc(a.whatsapp || '')}" placeholder="+234" inputmode="tel"></label>
        <label class="field"><span class="lbl">Preferred language</span><select class="inp" name="language">${LANGS.map((l) => `<option ${l === (a.language || 'English') ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>`,
      2: `<h2>Where will your customers come from?</h2>
        <div class="field"><span class="lbl">Traffic sources</span>${chipset('src', APP.sources.map((s) => [s, s]), a.sources || [])}</div>
        <div class="field"><span class="lbl">Main geos <em>top 5</em></span>${chipset('geos', [...new Set([...GEO_CHIPS, ...(a.geos || [])])].map((c) => [c, `${A.flag(c)} ${A.cname(c)}`]), a.geos || [], 5)}
          <select class="inp inp-sm geo-more" data-geomore aria-label="Add another country"><option value="">Another country…</option>${A.COUNTRIES.filter(([c]) => !GEO_CHIPS.includes(c)).map(([c, nm]) => `<option value="${c}">${esc(nm)}</option>`).join('')}</select><span class="hint">Countries you send most traffic to.</span></div>
        <label class="field"><span class="lbl">Monthly volume</span><select class="inp" name="volume" required><option value="">Choose</option>${APP.volumes.map((v) => `<option ${v === a.volume ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <div class="fgrid"><label class="field"><span class="lbl">Audience size if organic <em>optional</em></span><input class="inp" name="audience_size" inputmode="numeric" value="${a.audience_size || ''}" placeholder="41000"></label><label class="field"><span class="lbl">Platform</span><select class="inp" name="audience_platform"><option value="">None</option>${['Telegram', 'YouTube', 'Instagram', 'TikTok', 'X', 'Facebook', 'Website', 'Email'].map((p) => `<option ${p === a.audience_platform ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div>
        <div class="field"><span class="lbl">Products you plan to promote</span>${chipset('prods', PROD_CHIPS, a.products || [])}</div>`,
      3: `<h2>Show us your work</h2>
        <div class="field"><span class="lbl">Years in performance marketing</span>${seg('years', YEARS.map((y) => [y, y]), a.years || '')}</div>
        <div class="field"><span class="lbl">Verticals you have run</span>${chipset('vert', VERTS.map((v) => [v, v]), a.verticals || [])}</div>
        <label class="field"><span class="lbl">Networks or programs you work with <em>optional</em></span><input class="inp" name="networks" maxlength="300" value="${esc(a.networks || '')}" placeholder="The networks you run offers with today"></label>
        <div class="field"><span class="lbl">Links <em>up to 5</em></span><div class="links-in" data-links>${(a.links && a.links.length ? a.links : ['']).map((l) => `<input class="inp" type="url" value="${esc(l)}" placeholder="https://t.me/yourchannel" aria-label="Link">`).join('')}<button type="button" class="btn btn-w btn-sm" data-addlink>${icon('plus')}Add link</button></div><span class="hint">Links help us approve you faster.</span></div>
        <label class="field"><span class="lbl">How you plan to promote VooSquare</span><textarea class="inp" name="plan" maxlength="600" required placeholder="Example: Reviews of Joinvoo on my Telegram channel for Nigerian buyers, plus Meta ads to a Landvoo page in Kenya.">${esc(a.plan || '')}</textarea><span class="hint" data-plancount>50 to 600 characters.</span></label>
        <label class="field"><span class="lbl">How did you hear about us?</span><select class="inp" name="heard"><option value="">Choose</option>${HEARD.map((h) => `<option ${h === a.heard ? 'selected' : ''}>${h}</option>`).join('')}</select></label>`,
      4: `<h2>Almost done</h2>
        <div class="field"><span class="lbl">Payout method <em>you can set this later</em></span><div class="paym" role="radiogroup"><label class="paym-o on"><input type="radio" name="pm" value="usdt" checked><i class="cm-usdt">₮</i><span><b>USDT (TRC20)</b><small>Minimum $${n0(prog().payMin)}${prog().usdtFee ? ' · fee covered' : ''}</small></span></label><label class="paym-o"><input type="radio" name="pm" value="btc"><i class="cm-btc">₿</i><span><b>BTC</b><small>${prog().btcMin ? `Minimum $${n0(prog().btcMin)}` : 'Bitcoin'}</small></span></label></div>
        <input class="inp mono" name="wallet" placeholder="T… address (optional)" autocapitalize="off" spellcheck="false" aria-label="Payout address" value=""><span class="hint">${me.wallets && me.wallets.usdt_trc20 ? `Saved: ${esc(me.wallets.usdt_trc20)}. ` : ''}We check the address checksum. You can add it later in Settings.</span></div>
        <div class="checks">${[['accept_terms', 'I have read and accept the <a href="#/site/terms" target="_blank">Affiliate terms</a> and the <a href="/privacy" target="_blank" rel="noopener">Privacy policy</a>.'], ['no_income_claims', 'I will not make income claims or run traffic that breaks ad platform rules or local law.'], ['adult', 'I am 18 or older.']].map(([k, t]) => `<label class="ck"><input type="checkbox" name="${k}"><i>${icon('check')}</i><span>${t}</span></label>`).join('')}
        <label class="ck"><input type="checkbox" name="news"><i>${icon('check')}</i><span>Send me affiliate news and contest announcements by email.</span></label></div>`,
    }[n];
    return joinShell(n, `<form class="jform" data-jform="${n}" novalidate><div class="jprog"><span>Step ${n} of 4</span><i><b style="width:${n * 25}%"></b></i><small>${S.me.app_step >= n ? 'Saved' : 'Saves as you continue'}</small></div>${fields}
      <p class="err" role="alert" hidden></p>
      <div class="jact">${n > 1 ? `<a class="btn btn-ghost" href="#/join/${n - 1}">${icon('left')}Back</a>` : '<a class="btn btn-ghost" href="#/aff/home">Explore the dashboard first</a>'}<button class="btn btn-g" type="submit">${n === 4 ? 'Submit application' : 'Continue'}</button></div></form>`);
  }
  A.R.join = join;

  function stepBody(n, f) {
    if (n === 1) return { display_name: f.display_name.value.trim(), kind: segv(f, 'kind') || 'individual', company: f.company.value.trim(), country: f.country.value, telegram: f.telegram.value.trim(), whatsapp: f.whatsapp.value.trim(), language: f.language.value };
    if (n === 2) return { sources: chips(f, 'src'), geos: chips(f, 'geos'), volume: f.volume.value, audience_size: Number(String(f.audience_size.value).replace(/\D/g, '')) || 0, audience_platform: f.audience_platform.value, products: chips(f, 'prods') };
    if (n === 3) return { years: segv(f, 'years'), verticals: chips(f, 'vert'), networks: f.networks.value.trim(), links: [...f.querySelectorAll('[data-links] input')].map((i) => i.value.trim()).filter(Boolean), plan: f.plan.value.trim(), heard: f.heard.value };
    const w = f.wallet.value.trim(); const btc = f.querySelector('[name=pm]:checked').value === 'btc';
    return { accept_terms: f.accept_terms.checked, no_income_claims: f.no_income_claims.checked, adult: f.adult.checked, news: f.news.checked, ...(w ? (btc ? { btc: w } : { usdt: w }) : {}) };
  }
  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('[data-jform]');
    if (!f) return;
    e.preventDefault();
    const n = Number(f.dataset.jform);
    const err = f.querySelector('.err');
    const r = await (async () => {
      const b = f.querySelector('[type=submit]'); b.disabled = true; b.classList.add('loading');
      try { return await A.api(`/api/aff/application/${n}`, { method: 'PUT', body: stepBody(n, f), headers: n === 4 ? { 'x-vs-fp': VS.fp() } : undefined }); }
      catch (x) { err.hidden = false; err.textContent = x.message; err.scrollIntoView({ block: 'center', behavior: VS.reduce ? 'auto' : 'smooth' }); return null; }
      finally { b.disabled = false; b.classList.remove('loading'); }
    })();
    if (!r) return;
    S.me = r.account;
    if (n < 4) location.hash = '#/join/' + (n + 1);
    else location.hash = '#/join/done'; // the done page says it; a toast here covered "Open my dashboard"
  });

  /* behaviours: chips, segments, payout method, smooth scroll, the mobile menu */
  document.addEventListener('click', (e) => {
    const c = e.target.closest('.chipset button');
    if (c) {
      const set = c.parentElement; const on = !c.classList.contains('on');
      if (on && set.dataset.max && set.querySelectorAll('.on').length >= Number(set.dataset.max)) { VS.toast('Pick up to ' + set.dataset.max, 'err'); return; }
      c.classList.toggle('on', on); c.setAttribute('aria-pressed', on);
      const ic = c.querySelector('.ico'); if (on && !ic) c.insertAdjacentHTML('afterbegin', icon('check')); if (!on && ic) ic.remove();
    }
    const sg = e.target.closest('.seg button');
    if (sg && !sg.closest('[data-noseg]')) {
      sg.parentElement.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b === sg); if (b.hasAttribute('aria-checked')) b.setAttribute('aria-checked', b === sg); });
      if (sg.closest('[data-seg="kind"]')) { const co = document.querySelector('[data-company]'); if (co) co.hidden = sg.dataset.v !== 'company'; }
    }
    const po = e.target.closest('.paym-o');
    if (po) po.parentElement.querySelectorAll('.paym-o').forEach((b) => b.classList.toggle('on', b === po));
    const al = e.target.closest('[data-addlink]');
    if (al) { const box = al.parentElement; if (box.querySelectorAll('input').length >= 5) { VS.toast('Up to 5 links', 'err'); return; } al.insertAdjacentHTML('beforebegin', '<input class="inp" type="url" placeholder="https://" aria-label="Link">'); al.previousElementSibling.focus(); }
    const sc = e.target.closest('[data-scroll]');
    if (sc) {
      const t = document.getElementById(sc.dataset.scroll);
      if (t) { e.preventDefault(); t.scrollIntoView({ behavior: VS.reduce ? 'auto' : 'smooth', block: 'start' }); }
      else if (location.hash !== '#/site') { e.preventDefault(); location.hash = '#/site'; A.then(() => {}); setTimeout(() => { const x = document.getElementById(sc.dataset.scroll); if (x) x.scrollIntoView({ block: 'start' }); }, 120); }
    }
    if (e.target.closest('[data-snav]')) {
      const s = A.sheet(`<div class="drawer drawer-site">${A.mHead('Affiliates')}<nav aria-label="Sections">${['how', 'products', 'tiers', 'health', 'subs', 'payouts', 'faq'].map((k, i) => `<a href="#/site" data-scroll="${k}">${['How it works', 'Products', 'Tiers', 'Lifetime RevShare', 'Sub-affiliates', 'Payouts', 'FAQ'][i]}</a>`).join('')}<a href="#/site/terms">Affiliate terms</a>${S.me ? '<a href="#/aff/home">My dashboard</a>' : '<a href="#/join/login">Log in</a>'}</nav>${S.me ? '' : '<a class="btn btn-l btn-block" href="#/join/signin">Become an affiliate</a>'}</div>`, 'sheet-right');
      s.el.addEventListener('click', (ev) => { if (ev.target.closest('a')) s.close(); });
    }
  });
  document.addEventListener('change', (e) => {
    const g = e.target.closest('[data-geomore]');
    if (g && g.value) {
      const set = document.querySelector('[data-chips="geos"]');
      if (set.querySelectorAll('.on').length >= 5) { VS.toast('Pick up to 5', 'err'); g.value = ''; return; }
      let b = set.querySelector(`[data-v="${g.value}"]`);
      if (!b) { set.insertAdjacentHTML('beforeend', `<button type="button" data-v="${g.value}" aria-pressed="false">${A.flag(g.value)} ${esc(A.cname(g.value))}</button>`); b = set.lastElementChild; }
      if (!b.classList.contains('on')) b.click();
      g.value = '';
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches('textarea[name=plan]')) { const c = document.querySelector('[data-plancount]'); if (c) { const l = e.target.value.trim().length; c.textContent = l < 50 ? `${50 - l} more characters needed.` : `${l} of 600 characters.`; } }
  });
})();
