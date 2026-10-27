/* VooSquare Affiliates dashboard, part one: shell, Home (balance, health, tier), Reports, Offers, Links.
 * Ported from the approved preview (app1.js) and wired to /api/aff/*. */
(function () {
  'use strict';
  const A = window.AF, VS = A.VS, S = A.S;
  const { esc, icon, fmt, face, pi, usd, usd0, $c, $c0, pct, cnt, cntc, tierBadge, statusPill, delta, empty } = A;
  const PG = A.PG = {};

  const me = () => S.me || {};
  const isPend = () => me().status !== 'approved' && me().status !== 'suspended';
  const base = () => 'aff';
  A.isPend = isPend; A.base = base;
  const myFace = () => A.avOf(me().avatar, me().email);

  function navFor() {
    const n = S.cache.unread || 0;
    const subs = S.pub && S.pub.subs;
    return [
      ['', [['#/aff/home', 'home', 'Home', '', 'home'], ['#/aff/offers', 'grid', 'Offers', '', 'offers'], ['#/aff/links', 'link', 'Links', '', 'links'], ['#/aff/reports', 'chart', 'Reports', '', 'reports'], ['#/aff/postbacks', 'server', 'Postbacks', '', 'postbacks'], ['#/aff/creatives', 'image', 'Creatives', '', 'creatives']]],
      ['Grow', [['#/aff/academy', 'book', 'Academy', '', 'academy'], ['#/aff/contests', 'trophy', 'Contests', S.cache.rank ? '#' + S.cache.rank : '', 'contests'], ['#/aff/subs', 'network', 'Sub-affiliates', subs && !subs.enabled ? 'Soon' : '', 'subs']]],
      ['Money', [['#/aff/payouts', 'wallet', 'Payouts', '', 'payouts']]],
      ['Support', [['#/aff/manager', 'headset', 'Manager', '', 'manager'], ['#/aff/notifications', 'bell', 'Notifications', n ? (n > 9 ? '9+' : n) : '', 'notifications'], ['#/aff/compliance', 'shield', 'Compliance', '', 'compliance'], ['#/aff/settings', 'settings', 'Settings', '', 'settings']]],
    ];
  }
  function whoCard() {
    const m = me(); const t = m.tier || {};
    const sub = isPend() ? `<em class="who-p">${m.applied ? 'Under review' : 'Application not sent'}</em>` : m.status === 'suspended' ? '<em class="who-p">Paused</em>' : `<em>${tierBadge(t.tier || 'Starter', 'sm')}<span>${pct(t.rate_bp)} RevShare</span></em>`;
    return `<div class="who">${face(myFace(), 'md')}<span><b>${esc(m.display_name || m.name || 'Affiliate')}</b>${sub}</span></div>`;
  }
  /* Updated affiliate terms (v1.1, 2026-10-05): a banner on every page until accepted, and the "what changed" modal once a
   * session. Nothing is blocked except payout requests: links, reports and earnings keep running. */
  const termsNeed = () => !!(me().terms && me().terms.needs_accept);
  function termsBanner() {
    const t = me().terms;
    return `<div class="pend-bar terms-bar" role="region" aria-label="Updated affiliate terms"><span class="pb-ic"><i class="pb-clock tb-ic2">${icon('shield')}</i></span><div><b>We've updated the affiliate terms (${esc(t.current)}).</b><p>See what changed and accept to keep requesting payouts. You keep earning in the meantime; nothing is lost.</p></div><div class="pb-a"><button class="btn btn-w btn-sm" data-terms-review>What changed</button><button class="btn btn-k btn-sm" data-terms-accept>Accept</button></div></div>`;
  }
  let termsMd = null;
  function termsModal() {
    const t = me().terms || {};
    if (!t.needs_accept || document.querySelector('[data-termsm]')) return;
    const md = termsMd = A.modal(`${A.mHead('We\u2019ve updated the affiliate terms \u2014 what changed', `Version ${esc(t.current)}${t.date ? ' · ' + esc(A.ds(Date.parse(t.date + 'T12:00:00Z'))) : ''}${t.accepted ? ` · you accepted ${esc(t.accepted)}` : ''}`)}<div class="vs-modal-b" data-termsm>
      <ul class="tc-list">${(t.changes || []).map((c) => `<li><i>${icon('check')}</i><span>${esc(c)}</span></li>`).join('') || '<li><i>' + icon('check') + '</i><span>Read the full terms for the details.</span></li>'}</ul>
      <p class="tc-note">${icon('wallet')}<span>Until you accept, payout requests are paused. Earnings keep counting as usual.</span></p>
      <div class="tc-act"><a class="btn btn-w" href="#/aff/terms" data-close>Read the full terms</a><button class="btn btn-l" data-terms-accept>Accept the updated terms</button></div>
      <button class="lnk tc-later" data-close type="button">Not now</button></div>`, 'terms-m');
    return md;
  }
  A.termsModal = termsModal;
  async function acceptTerms(btn) {
    const t = me().terms || {};
    const r = await A.act(btn, () => A.POST('/api/aff/terms/accept', { version: t.current }), `Terms ${t.current} accepted. Payouts are open.`);
    if (r && r.account) { S.me = r.account; if (termsMd && document.body.contains(termsMd.el)) termsMd.close(); termsMd = null; A.route(); }
  }
  function maybeTermsModal(page) {
    if (!termsNeed() || page === 'terms') return;
    const key = 'aff-terms-seen-' + me().terms.current;
    let seen = false; try { seen = sessionStorage.getItem(key) === '1'; } catch { /* storage off */ }
    if (seen) return;
    try { sessionStorage.setItem(key, '1'); } catch { /* storage off */ }
    setTimeout(termsModal, 350);
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-terms-review]')) { e.preventDefault(); termsModal(); return; }
    const ac = e.target.closest('[data-terms-accept]');
    if (ac) { e.preventDefault(); acceptTerms(ac); }
  });
  function banner(page) {
    const m = me();
    if (m.status === 'suspended') return `<div class="pend-bar more"><span class="pb-ic"><i class="pb-clock">${icon('lock')}</i></span><div><b>Your affiliate account is paused.</b><p>Earnings are held while it is paused. Your manager can tell you what is needed.</p></div><div class="pb-a"><a class="btn btn-w btn-sm" href="#/aff/manager">Message my manager</a></div></div>`;
    if (termsNeed()) return termsBanner();
    if (m.status === 'pending') return pendBanner();
    const an = S.cache.annTop;
    if (!an || page === 'terms') return '';
    return `<div class="ann-bar"><span class="ann-dot"></span><b>${esc(an.title)}</b><span>${esc(an.body || '')}</span><a href="${an.link && /^#\//.test(an.link) ? esc(an.link) : '#/aff/notifications'}">${an.kind === 'cpa_change' ? 'See offers' : 'Read'}</a></div>`;
  }
  function pendBanner() {
    const m = me();
    if (m.info_request) return `<div class="pend-bar more"><span class="pb-ic">${face(A.avOf(m.managers && m.managers.general && m.managers.general.avatar, m.info_from), 'sm')}</span><div><b>We need a bit more from you</b><p>${esc(m.info_from || 'Your manager')}: ${esc(m.info_request)}</p></div><div class="pb-a"><button class="btn btn-k btn-sm" data-reply-info>Reply</button></div></div>`;
    if (!m.applied) return `<div class="pend-bar"><span class="pb-ic"><i class="pb-clock">${icon('id')}</i></span><div><b>Finish your application to start earning.</b><p>You can explore every page now. We review applications in about 2 business days once they are sent.</p></div><div class="pb-a"><a class="btn btn-l btn-sm" href="#/join/${Math.min(4, (m.app_step || 0) + 1)}">Continue application</a></div></div>`;
    return `<div class="pend-bar"><span class="pb-ic"><i class="pb-clock">${icon('clock')}</i></span><div><b>Your application is under review.</b><p>You can create links, set up postbacks and browse creatives now. Earnings start from the day you are approved. Most reviews take about 2 business days.</p></div><div class="pb-a"><a class="btn btn-w btn-sm" href="#/aff/application">View application</a><a class="btn btn-ghost btn-sm" href="#/aff/manager">Message support</a></div></div>`;
  }
  /** The affiliate shell. load: async () => body html (the router shows a skeleton meanwhile). */
  function affShell(page, title, load, opts = {}) {
    const bottom = ['home', 'links', 'reports', 'payouts'];
    const mob = `<nav class="bnav" aria-label="Quick menu">${[['home', 'home', 'Home'], ['links', 'link', 'Links'], ['reports', 'chart', 'Reports'], ['payouts', 'wallet', 'Payouts']].map(([p, ic, l]) => `<a href="#/aff/${p}" class="${p === page ? 'on' : ''}">${icon(ic)}<span>${l}</span></a>`).join('')}<button data-more class="${bottom.includes(page) ? '' : 'on'}">${icon('grid')}<span>More</span></button></nav>`;
    const n = S.cache.unread || 0;
    const topRight = `<a class="tb-ic" href="#/aff/notifications" aria-label="Notifications${n ? `, ${n} unread` : ''}">${icon('bell')}${n ? `<i>${n > 9 ? '9+' : n}</i>` : ''}</a><a class="tb-me" href="#/aff/settings" aria-label="Settings">${face(myFace(), 'sm')}</a>`;
    const foot = `${S.staff && S.staff.roles ? `<a class="sb-lnk" href="${A.staffHome()}">${icon('shield')}Back office</a>` : ''}<a class="sb-lnk" href="#/site">${icon('globe')}Affiliate site</a><button class="sb-lnk" data-logout>${icon('logout')}Log out</button>`;
    const html = A.shell({ page, title, nav: navFor(), who: whoCard(), banner: opts.noBanner ? '' : banner(page), body: null, mobileNav: mob, topRight, foot });
    maybeTermsModal(page);
    return A.deferred(html, load);
  }
  A.affShell = affShell;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) {
      const items = navFor().flatMap((g) => g[1]).filter((i) => !['home', 'links', 'reports', 'payouts'].includes(i[4]));
      const s = A.sheet(`<div class="more-s">${A.mHead('More')}<div class="more-g">${items.map(([h, ic, l]) => `<a href="${h}"><span>${icon(ic)}</span>${l}</a>`).join('')}<a href="#/aff/terms"><span>${icon('shield')}</span>Terms</a>${S.staff && S.staff.roles ? `<a href="${A.staffHome()}"><span>${icon('settings')}</span>Back office</a>` : ''}<button data-logout><span>${icon('logout')}</span>Log out</button></div></div>`, 'sheet-bottom');
      s.el.addEventListener('click', (ev) => { if (ev.target.closest('a')) s.close(); });
    }
    const ri = e.target.closest('[data-reply-info]');
    if (ri) {
      const m = me();
      const md = A.modal(`${A.mHead('Reply to ' + esc((m.info_from || 'your manager').split(' ')[0]), 'Your answer goes to your manager and is added to your application.')}<form class="vs-modal-b" data-replyf><p class="ask-ref">${esc(m.info_request)}</p><label class="field"><span class="lbl">Your answer</span><textarea class="inp" name="text" required minlength="5" placeholder="Answer here"></textarea></label><label class="field"><span class="lbl">Add a link <em>optional</em></span><input class="inp" name="link" type="url" placeholder="https://"></label><p class="err" hidden></p><button class="btn btn-g" type="submit">Send reply</button></form>`);
      md.el.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = ev.target;
        const r = await A.act(f.querySelector('button'), () => A.POST('/api/aff/application/reply', { text: f.text.value, link: f.link.value || undefined }), 'Reply sent to your manager');
        if (r) { S.me = r.account; md.close(); A.route(); }
      });
    }
  });

  /* ================= Home ================= */
  function balScene() {
    const rain = Array.from({ length: 9 }, (_, i) => `<i class="rain r${i % 3}" style="--x:${8 + ((i * 37) % 84)}%;--d:${(i * 0.53).toFixed(2)}s;--r:${(i * 47) % 60 - 30}deg"></i>`).join('');
    return `<div class="bal-scene" aria-hidden="true"><div class="rainbox">${rain}</div><svg viewBox="70 40 220 266">${A.figure(myFace())}</svg><div class="bal-tiles">${['joinvoo', 'spyvoo', 'replyvoo'].map((k, i) => `<span style="--i:${i}">${pi(k, 'sm')}</span>`).join('')}</div></div>`;
  }
  function balanceCard(b, tracking) {
    const m = me();
    if (isPend()) {
      return `<section class="bal pend" data-io><div class="bal-l"><div class="bal-h"><span>Available to withdraw</span></div>
        <div class="locked"><b class="bal-big">$0.00</b><span class="lock-chip">${icon('lock')}Earnings start after approval</span></div>
        <div class="bal-row">${[['Lifetime earned', '$0.00'], ['Waiting for activation', '$0.00'], ['In CPA review', '$0.00'], ['Paid out', '$0.00']].map((x) => `<div><small>${x[0]}</small><b>${x[1]}</b></div>`).join('')}</div>
        <div class="bal-cta"><button class="btn btn-l" disabled>${icon('lock')}Payouts open after approval</button><span class="bal-note">${tracking ? `Tracking ${fmt(tracking.clicks)} clicks and ${fmt(tracking.signups)} sign-ups so far` : 'Tracking starts with your first click'}</span></div></div>
        <div class="bal-r"><div class="lock-art">${icon('lock')}<span>Your balance unlocks when you are approved</span></div></div></section>`;
    }
    const nr = b.next_release;
    const w = m.wallets || {};
    const addr = w.method === 'btc' ? w.btc : w.usdt_trc20;
    return `<section class="bal" data-io><div class="bal-l"><div class="bal-h"><span>Available to withdraw</span>${b.owed_cents > 0 ? `<span class="owe-chip">${icon('alert')}You owe ${$c(b.owed_cents)} from reversals</span>` : ''}</div>
      <b class="bal-big">${cntc(b.available_cents)}</b>
      <div class="bal-credit"><span>Total credit balance</span><b>${cntc(b.credit_cents)}</b><small>${b.hold_cents > 0 ? `Available + on hold + CPA review + waiting · lifetime ${$c(b.lifetime_cents)}` : 'Available + CPA review + waiting'}</small></div>
      <div class="bal-row">${[b.hold_cents > 0 ? ['On hold', b.hold_cents, nr ? `Next ${$c(nr.amount_cents)} on ${A.ds(nr.at)}` : 'Releasing soon'] : ['Lifetime earned', b.lifetime_cents, 'Instant, no hold'], ['Waiting for activation', b.pending_activation_cents, m.activated_at ? 'Activated' : `Needs ${((m.health || {}).activation || {}).need || 5} qualified customers`], ['In CPA review', b.in_review_cents, 'Checked by our team'], ['Paid out', b.paid_cents, b.requested_cents ? `${$c(b.requested_cents)} requested` : 'With PDF receipts']].map((x) => `<div><small>${x[0]}</small><b>${cntc(x[1])}</b><em>${esc(x[2])}</em></div>`).join('')}</div>
      <div class="bal-cta">${b.available_cents > 0 && termsNeed() ? `<button class="btn btn-l" type="button" data-terms-review>${icon('shield')}Accept updated terms to withdraw</button>` : b.available_cents > 0 ? `<a class="btn btn-l" href="#/aff/payouts" data-reqpay>${icon('wallet')}Request ${$c(b.available_cents)}</a>` : `<a class="btn btn-l" href="#/aff/payouts">${icon('wallet')}Payouts</a>`}<span class="bal-note">${addr ? `To ${w.method === 'btc' ? 'BTC' : 'USDT (TRC20)'} ${esc(addr)} · sent within ${(m.perks || {}).payout_days || 3} business days` : '<a class="lnk" href="#/aff/settings/payout">Add a payout address</a>'}</span></div></div>
      <div class="bal-r">${balScene()}</div></section>`;
  }
  const HL = { inactive: ['w', 'Not active yet'], ramp: ['b', 'Ramp-up'], active: ['g', 'Active'], at_risk: ['amb', 'At risk'], grace: ['amb', 'Grace'], paused: ['r', 'Paused'] };
  /** Lifetime RevShare health: live meter, days left and what is needed. */
  function healthCard(h, compact) {
    if (!h) return '';
    const [tone, label] = HL[h.state] || ['w', h.state];
    let p, mark, line, need;
    if (h.state === 'inactive') {
      const act = h.activation || { need: 5, have: 0 };
      p = act.need ? act.have / act.need : 1; mark = 1;
      line = `<b>${act.have} of ${act.need}</b> qualified customers to activate your earnings`;
      need = `${Math.max(0, act.need - act.have)} more qualified customer${act.need - act.have === 1 ? '' : 's'} release everything waiting for activation.`;
    } else {
      p = h.threshold ? Math.min(1.25, h.count / h.threshold) / 1.25 : 1; mark = 1 / 1.25;
      line = `<b>${h.count} of ${h.threshold}</b> new qualified customers in the last ${h.window_days} days`;
      need = h.exempt ? 'Your manager set your account as exempt. Lifetime RevShare stays active.'
        : h.state === 'ramp' ? `Ramp-up: ${h.days_left} days left. After that you need ${h.threshold} in any ${h.window_days} days.`
          : h.state === 'active' ? `You are above the line. Keep a steady pace to stay active.`
            : h.state === 'at_risk' ? `Projected ${h.projected ?? h.count} by the time older customers leave the window. ${h.needed ? `${h.needed} more keeps you safe.` : 'Keep the pace up.'}`
              : h.state === 'grace' ? `${h.days_left} days left to get back to ${h.threshold}. ${h.needed} more needed. You keep earning meanwhile.`
                : `RevShare on existing customers is paused. ${h.needed} more qualified customers switch it back on. CPA deals keep paying.`;
    }
    return `<section class="card hcard hc-${tone}${compact ? ' compact' : ''}" data-io><div class="card-h"><div><h3>Lifetime RevShare</h3><span class="sub">${h.state === 'inactive' ? 'Activation' : `Rolling ${h.window_days}-day health`}</span></div><span class="r"><span class="hl-chip hl-${tone}">${h.state === 'active' || h.state === 'ramp' ? '<i class="live-dot"></i>' : ''}${label}</span></span></div>
      <p class="hc-line">${line}</p>
      <div class="hl-bar" role="meter" aria-valuemin="0" aria-valuemax="${h.state === 'inactive' ? (h.activation || {}).need : h.threshold}" aria-valuenow="${h.state === 'inactive' ? (h.activation || {}).have : h.count}" aria-label="Lifetime RevShare health"><i style="--p:${Math.max(0.02, Math.min(1, p)).toFixed(3)}"></i><span class="hl-th" style="--t:${mark}"><em>${h.state === 'inactive' ? (h.activation || {}).need : h.threshold}</em></span></div>
      <p class="hc-need">${icon(tone === 'g' ? 'check' : tone === 'r' ? 'alert' : 'bolt')}<span>${esc(need)}</span></p>
      ${h.days_left != null && h.state !== 'active' ? `<div class="hc-days"><b>${h.days_left}</b><small>days left</small></div>` : ''}</section>`;
  }
  A.healthCard = healthCard;
  const KPI_P = [['today', 'Today'], ['yesterday', 'Yesterday'], ['month', 'This month'], ['last', 'Last month']];
  function kpis(k) {
    const ch = k.change || {};
    const T = [['Clicks', fmt(k.clicks), ch.clicks], ['Sign-ups', fmt(k.signups), ch.signups], ['New paying customers', fmt(k.paying), ch.paying], ['Qualified FTDs', fmt(k.qualified), ch.qualified],
      ['Sign-up rate', `${fmt(k.signup_rate || 0, 2)}%`, undefined], ['EPC', $c(k.epc_cents), ch.epc_cents], ['Revenue from your customers', $c0(k.revenue_cents), ch.revenue_cents], ['Commission', $c(k.commission_cents), ch.commission_cents]];
    // Commission is earned from customers; manual adjustments by the VooSquare team are their own line (SV-1).
    const adj = k.adjustments_cents ? `<span class="kpi-adj">Adjustments ${k.adjustments_cents > 0 ? '+' : '−'}${$c(Math.abs(k.adjustments_cents))}, not in commission</span>` : '';
    return T.map((t, i) => `<div class="kpi${i === 7 ? ' kpi-hi' : ''}"><small>${t[0]}</small><b>${t[1]}</b>${isPend() ? (i < 2 ? '<span class="dl dl-0">Tracking</span>' : '<span class="dl dl-0">Not earning yet</span>') : t[2] === undefined ? '' : delta(t[2])}${i === 7 ? adj : ''}</div>`).join('');
  }
  const MET = { commission: ['commission_cents', 'Commission', '#00A86B', true], revenue: ['revenue_cents', 'Revenue from your customers', '#3355F0', true], ftd: ['qualified', 'Qualified FTDs', '#5B3FE8', false] };
  function chartBlock(series, metric) {
    const [f, label, col, money] = MET[metric];
    const pts = series.map((d) => ({ x: A.dayLabel(d.day), v: money ? (d[f] || 0) / 100 : d[f] || 0 }));
    const total = pts.reduce((s, p) => s + p.v, 0);
    return `<div class="ch-head"><div><small>${label}, last ${series.length} days</small><b>${money ? usd(total) : fmt(total)}</b></div></div>${A.area(pts, { fmtv: money ? (v) => usd(v) : (v) => fmt(v, v % 1 ? 1 : 0), color: col, label: 'Daily ' + label })}`;
  }
  function tierCard() {
    const t = me().tier || {};
    if (isPend()) { const T0 = A.tiers()[0], T1 = A.tiers()[1]; return `<section class="card tier-c"><div class="card-h"><h3>Your tier after approval</h3></div><div class="tier-in"><div class="tier-ring">${A.ring(0, 112, 10, '#00A86B', 'var(--bg3)')}<span><b>${fmt(T0.rate)}%</b><small>${T0.n}</small></span></div><div><p>You start at <b>${T0.n}, ${fmt(T0.rate)}% lifetime RevShare</b>. ${T1 ? `${T1.min} qualified FTDs in a month moves you to ${T1.n} straight away.` : ''}</p><a class="lnk" data-tierhow>How tiers work</a></div></div></section>`; }
    const nx = t.next;
    const p = nx ? t.month_qualified / nx.min : 1;
    return `<section class="card tier-c" data-io><div class="card-h"><div><h3>Your tier: ${esc(t.tier)}</h3><span class="sub">${pct(t.rate_bp)} RevShare${nx ? ` · ${pct(nx.rate_bp)} at ${esc(nx.name)}` : ' · top tier'}</span></div><span class="r">${tierBadge(t.tier)}</span></div>
      <div class="tier-in"><div class="tier-ring">${A.ring(p, 112, 10, '#00A86B', 'var(--bg3)')}<span><b>${t.month_qualified}</b><small>${nx ? `of ${nx.min}` : 'this month'}</small></span></div>
      <div><p class="tier-p"><b>${nx ? `${t.month_qualified} of ${nx.min} qualified FTDs this month toward ${esc(nx.name)}` : `${t.month_qualified} qualified FTDs this month`}</b></p><p class="muted sm">2-month average: ${fmt(t.avg_two_months || 0, (t.avg_two_months || 0) % 1 ? 1 : 0)}. Tier for next month is set on ${A.ds(t.set_on)}.${t.grace ? ` Grace month: you keep ${esc(t.tier)} for now.` : ''}</p>
      <div class="tier-mini">${A.tiers().map((x, i) => `<i class="${i < t.idx ? 'done' : i === t.idx ? 'now' : ''}" style="--tb:${x.bg};--tbd:${x.bd}" title="${esc(x.n)}"></i>`).join('')}</div>
      ${nx && nx.remaining ? `<p class="hint-l">${icon('bolt')}${nx.remaining} more qualified FTDs this month moves you to ${esc(nx.name)} straight away.</p>` : ''}${t.quality_warning ? `<p class="hint-l warn">${icon('alert')}Refund rate over the limit: upgrades are on hold this month.</p>` : ''}</div></div>
      <div class="tier-f"><span>Refund rate ${fmt(t.refund_rate || 0, 1)}%</span><a class="lnk" data-tierhow>How tiers work</a></div></section>`;
  }
  A.tierCard = tierCard;
  const tgLink = (h) => (h ? `https://t.me/${String(h).replace(/^@/, '')}` : '');
  function mgrCard() {
    const mg = (me().managers || {});
    const g = mg.general, p = mg.private;
    const card = (m, role) => `<div class="mg"><span class="mg-f">${face(A.avOf(m.avatar, m.name), 'lg')}<i class="online"></i></span><div><b>${esc(m.name)}</b><span class="mg-r">${role}</span><small>${esc([(m.languages || []).join(', '), m.hours].filter(Boolean).join(' · ') || 'Replies on Telegram')}</small></div></div>`;
    const msg = (m) => (m.telegram ? `<a class="btn btn-k btn-sm" href="${esc(tgLink(m.telegram))}" target="_blank" rel="noopener">${icon('tg')}Message on Telegram</a>` : `<a class="btn btn-k btn-sm" href="#/aff/manager">${icon('chat')}Message</a>`);
    if (!g && !p) return `<section class="card mgr-c"><div class="card-h"><h3>Your manager</h3></div>${me().applied ? empty('headset', 'Your manager is being assigned.', 'Until then the VooSquare team answers your messages.', `<a class="btn btn-w btn-sm" href="#/aff/manager">${icon('chat')}Message the team</a>`) : empty('headset', 'A manager is assigned when you send your application.', 'They answer on Telegram in your language.')}</section>`;
    const cur = p || g;
    return `<section class="card mgr-c"><div class="card-h"><h3>${p ? 'Your managers' : 'Your manager'}</h3>${p ? '<span class="r"><span class="pill pill-l">Private unlocked</span></span>' : ''}</div>
      ${card(cur, p ? 'Private manager' : 'General manager')}<div class="mg-b">${msg(cur)}<a class="btn btn-w btn-sm" href="#/aff/manager">${icon('chat')}Notes and messages</a></div>
      ${p && g ? `<div class="mg-g">${face(A.avOf(g.avatar, g.name), 'sm')}<span><b>${esc(g.name)}</b> · General manager</span><a class="lnk" href="#/aff/manager">Message</a></div>` : !p && !isPend() ? '<p class="muted sm">Reach Elite to get a private manager.</p>' : ''}</section>`;
  }
  function contestWidget(c) {
    if (!c) return `<section class="card cw" data-io><div class="cw-h"><b>Contests</b></div><div class="cw-b"><div class="cw-rank"><small>No live contest right now</small><b>–</b></div></div><p class="cw-gap"><span>The next one is announced on Contests and in Telegram.</span></p><a class="btn btn-w btn-sm btn-block" href="#/aff/contests">See contests</a></section>`;
    const mine = c.me;
    const above = mine && mine.rank > 1 && (c.board || [])[mine.rank - 2];
    return `<section class="card cw" data-io><div class="cw-h"><span class="live-dot"></span><b>${esc(c.title)}</b><span class="cw-t" data-countdown="${c.ends_at}">–</span></div>
      <div class="cw-b"><div class="cw-rank"><small>Your rank</small><b>${mine && mine.rank ? '#' + mine.rank : '–'}</b></div><div class="cw-rank"><small>Score</small><b>${mine ? fmt(mine.score, mine.score % 1 ? 1 : 0) : '0'}</b></div><div class="cw-rank"><small>Prize pool</small><b>${$c0(c.pool_cents)}</b></div></div>
      <div class="cw-gap"><div class="cw-bar"><i style="--p:${mine && mine.gap_to_next ? Math.max(0.05, Math.min(1, mine.score / (mine.score + mine.gap_to_next))).toFixed(2) : mine && mine.rank === 1 ? 1 : 0.05}"></i></div><span>${isPend() ? 'You join contests once approved.' : mine && mine.rank === 1 ? 'You lead. Keep it.' : mine && mine.gap_to_next ? `${fmt(mine.gap_to_next, 1)} points behind #${mine.rank - 1}${above ? ' · ' + esc(above.name) : ''}` : `${c.entrants || 0} affiliates on the board`}</span></div>
      <a class="btn btn-w btn-sm btn-block" href="#/aff/contests">See leaderboard</a></section>`;
  }
  const ANK = { new_offer: 'New offer', cpa_change: 'CPA change', creatives: 'New creatives', contest: 'Contest', policy: 'Policy', maintenance: 'Maintenance' };
  function announcements(list) {
    return `<section class="card"><div class="card-h"><h3>Announcements</h3></div>${list.length ? `<div class="anns">${list.map((a) => `<a class="an${a.kind === 'cpa_change' || a.kind === 'policy' ? ' warn' : ''}" href="${a.link && /^#\//.test(a.link) ? esc(a.link) : '#/aff/notifications'}"><span class="an-t">${a.pinned ? icon('pin') : ''}${esc(ANK[a.kind] || 'News')} · ${A.ds(a.at)}</span><b>${esc(a.title)}</b><small>${esc(a.body || '')}</small></a>`).join('')}</div>` : empty('megaphone', 'No announcements yet.', 'New offers, CPA changes and contests show here.')}</section>`;
  }
  function subTable(rows) {
    return `<section class="card"><div class="card-h"><h3>Top sub IDs this month</h3></div>${rows.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>sub1</th><th class="n">Clicks</th><th class="n">Sign-ups</th><th class="n">Qualified FTDs</th><th class="n">Commission</th></tr></thead><tbody>
      ${rows.slice(0, 5).map((s) => `<tr><td><code>${esc(s.key)}</code></td><td class="n">${fmt(s.clicks)}</td><td class="n">${fmt(s.signups)}</td><td class="n">${fmt(s.qualified)}</td><td class="n b">${$c0(s.commission_cents)}</td></tr>`).join('')}</tbody></table></div>` : empty('hash', 'Tag your links with sub1 to see which campaigns pay.', '', '<a class="btn btn-w btn-sm" href="#/aff/links">Build a link</a>')}</section>`;
  }
  function speedList() {
    const c = me().checklist || {};
    const items = [['Send your application', me().applied, `#/join/${Math.min(4, (me().app_step || 0) + 1)}`], ['Create your first link', c.first_link, '#/aff/links'], ['Connect Telegram alerts', c.telegram, '#/aff/postbacks/tg'], ['Take the 10-minute Start here lesson', c.start_here, '#/aff/lesson'], ['Add a payout address', c.payout_address, '#/aff/settings/payout']];
    const done = items.filter((x) => x[1]).length;
    return `<section class="card speed"><div class="card-h"><div><h3>Get approved faster</h3><span class="sub">Managers approve complete applications first.</span></div><span class="r"><b class="speed-n">${done} of ${items.length}</b></span></div><div class="speed-l">${items.map((x) => `<div class="${x[1] ? 'done' : ''}"><i>${x[1] ? icon('check') : ''}</i><span>${x[0]}</span>${x[1] ? '' : `<a class="btn btn-w btn-xs" href="${x[2]}">Do it</a>`}</div>`).join('')}</div></section>`;
  }
  const hello = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  PG.home = () => affShell('home', 'Home', async () => {
    const [h, prod] = await Promise.all([A.api('/api/aff/home?period=today&days=30'), A.api('/api/aff/reports?group=product&period=month').catch(() => ({ rows: [] }))]);
    S.me = h.account; S.cache.home = h; S.cache.series = { 30: h.series };
    S.cache.annTop = (h.announcements || []).find((a) => a.pinned || a.kind === 'cpa_change') || null;
    if (h.contest && h.contest.me && h.contest.me.rank) S.cache.rank = h.contest.me.rank;
    const k = h.kpis;
    const sub = isPend() ? (me().applied ? 'Your dashboard is ready. Build links and set up tracking while we review your application.' : 'Your dashboard is ready. Finish your application so we can review it.')
      : k.qualified ? `${k.qualified} qualified FTD${k.qualified === 1 ? '' : 's'} today.` : k.signups ? `${k.signups} sign-up${k.signups === 1 ? '' : 's'} today from your links.` : 'Share a link today. Every click, sign-up and payment shows here.';
    const pr = (prod.rows || []).filter((r) => r.commission_cents > 0).sort((a, b) => b.commission_cents - a.commission_cents);
    if (me().status === 'approved' && !me().welcome_seen) A.then(() => welcome());
    A.then((pg) => wireHome(pg));
    return `<div class="hello"><div><h2>${hello()}, ${esc(me().first_name || me().display_name || '')}.</h2><p>${esc(sub)}</p></div>
      <div class="ql">${[['plus', 'New link', 'links'], ['image', 'Creatives', 'creatives'], ['server', 'Postbacks', 'postbacks'], ['book', 'Academy', 'academy']].map((q) => `<a href="#/aff/${q[2]}">${icon(q[0])}<span>${q[1]}</span></a>`).join('')}</div></div>
      ${A.dealBanner(h.custom_deals)}
      ${balanceCard(h.balance, h.tracking)}
      ${isPend() ? speedList() : ''}
      <section class="card kp"><div class="card-h"><h3>Performance</h3><span class="sub">${isPend() ? 'Tracking, not earning yet' : 'Africa/Lagos time'}</span><div class="r"><div class="seg" data-kseg role="tablist">${KPI_P.map((x, i) => `<button class="${i === 0 ? 'on' : ''}" data-k="${x[0]}" role="tab" aria-selected="${i === 0}">${x[1]}</button>`).join('')}</div></div></div><div class="kpis" data-kpis>${kpis(k)}</div></section>
      <div class="g-2-1"><section class="card chc"><div class="card-h"><h3>Earnings over time</h3><div class="r"><div class="seg" data-mseg><button class="on" data-m="commission">Commission</button><button data-m="revenue">Revenue</button><button data-m="ftd">FTDs</button></div><div class="seg" data-rseg><button data-r="7">7D</button><button class="on" data-r="30">30D</button><button data-r="90">90D</button></div></div></div><div data-chartbox data-r="30" data-m="commission">${chartBlock(h.series, 'commission')}</div></section>
        ${tierCard()}</div>
      <div class="g-2-1 hrow">${healthCard(me().health)}${mgrCard()}</div>
      <div class="g-3">${contestWidget(h.contest)}${announcements(h.announcements || [])}${subsMini()}</div>
      <div class="g-2-1">${subTable(h.top_subs || [])}<section class="card"><div class="card-h"><h3>Commission by product</h3><span class="sub">This month</span></div>${pr.length ? A.bars(pr.map((r) => ({ label: A.brand(r.key).short || A.brand(r.key).name, v: r.commission_cents / 100, col: A.brand(r.key).mark, icon: pi(r.key, 'xs') }))) : empty('chart', isPend() ? 'Commission starts after approval.' : 'No commission yet this month.')}</section></div>`;
  });
  function subsMini() {
    const s = (S.pub && S.pub.subs) || {};
    return `<section class="card subs-mini"><div class="card-h"><h3>Sub-affiliates</h3>${s.enabled ? '' : '<span class="r"><span class="pill pill-w">Opening soon</span></span>'}</div><p class="muted sm">Invite other affiliates and earn ${pct(s.rate_bp || 250)} of what we pay them, ${pct(s.boosted_rate_bp || 500)} with ${s.boost_subs || 50} active subs. Paid by Zedapex, never taken from theirs.</p><a class="btn btn-w btn-sm btn-block" href="#/aff/subs">${icon('network')}My network</a></section>`;
  }
  function wireHome(pg) {
    const kseg = pg.querySelector('[data-kseg]');
    if (kseg) kseg.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      kseg.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
      const box = pg.querySelector('[data-kpis]'); box.classList.add('dim');
      try { box.innerHTML = kpis(await A.api('/api/aff/stats?period=' + b.dataset.k)); } catch (er) { VS.toast(er.message, 'err'); } finally { box.classList.remove('dim'); }
    });
    const box = pg.querySelector('[data-chartbox]');
    if (box) {
      const re = async () => {
        const r = Number(box.dataset.r);
        if (!S.cache.series[r]) { try { S.cache.series[r] = (await A.api('/api/aff/series?days=' + r)).series; } catch (er) { VS.toast(er.message, 'err'); return; } }
        box.innerHTML = chartBlock(S.cache.series[r], box.dataset.m); A.mount(box);
      };
      const segs = (sel, key) => pg.querySelector(sel).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; e.currentTarget.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); box.dataset[key] = b.dataset[key]; re(); });
      segs('[data-rseg]', 'r'); segs('[data-mseg]', 'm');
    }
    countdowns(pg);
  }
  function countdowns(root) {
    const cd = root.querySelectorAll('[data-countdown]');
    if (!cd.length) return;
    const tick = () => cd.forEach((el) => {
      const ms = Math.max(0, Number(el.dataset.countdown) - Date.now()); const d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24, m = Math.floor(ms / 6e4) % 60, s = Math.floor(ms / 1e3) % 60;
      el.innerHTML = el.classList.contains('ct-cd') ? [[d, 'days'], [h, 'hours'], [m, 'min'], [s, 'sec']].map(([v, l]) => `<span><b>${String(v).padStart(2, '0')}</b><small>${l}</small></span>`).join('') : `${d}d ${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
    });
    tick(); const t = setInterval(() => { if (!document.body.contains(cd[0])) return clearInterval(t); tick(); }, 1000);
  }
  A.countdowns = countdowns;
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-tierhow]')) {
      const T = A.tiers();
      const s = A.sheet(`<div class="sheet-b">${A.mHead('How tiers work', 'Set on the 1st from your 2-month average. Fast lane up mid-month.')}<div class="sb-pad">${A.stairs((me().tier || {}).idx || 0, { climb: false, who: myFace() })}
        <div class="ex-list">${[`You average ${T[1] ? T[1].min + 1 : 11} qualified FTDs over two months: your tier next month is ${T[1] ? T[1].n : 'Pro'}.`, `If your average drops below your tier, you get one grace month first, then move down one tier only.`, `If this month alone reaches the next level, you move up that day.`, 'If your refund rate is over 8%, upgrades wait. Over 15%, you drop one tier without grace.'].map((t) => `<p>${esc(t)}</p>`).join('')}</div></div></div>`);
      setTimeout(() => A.runStairs(s.el), 30);
    }
  });

  /* Approved welcome: modal with checklist and light confetti (a real achievement). */
  function welcome() {
    const m = me(); const c = m.checklist || {}; const t = A.tiers()[0];
    A.celebrate();
    const items = [['Create your first link', c.first_link, '#/aff/links'], ['Connect Telegram alerts', c.telegram, '#/aff/postbacks/tg'], ['Add a payout address', c.payout_address, '#/aff/settings/payout'], ['Take the 10-minute "Start here" lesson', c.start_here, '#/aff/lesson']];
    const md = A.modal(`<div class="welcome"><div class="wl-art"><span class="wl-tier">${tierBadge((m.tier || {}).tier || t.n)}<b>${pct((m.tier || {}).rate_bp || t.rate * 100)} lifetime RevShare</b></span><svg viewBox="70 40 220 266" class="wl-fig" aria-hidden="true">${A.figure(myFace())}</svg></div>
      <div class="vs-modal-b"><h3>You are approved, ${esc(m.first_name || m.display_name)}.</h3><p>Your account earns from today at ${esc((m.tier || {}).tier || t.n)}. ${m.managers && m.managers.general ? `Your manager is ${esc(m.managers.general.name)}.` : ''}</p>
      <div class="wl-list">${items.map(([l, done, h]) => `<a class="ck" href="${h}" data-close><input type="checkbox" ${done ? 'checked' : ''} disabled><i>${icon('check')}</i><span>${l}</span></a>`).join('')}</div>
      <div class="wl-b"><a class="btn btn-g" href="#/aff/links" data-close>Create a link</a><a class="btn btn-w" href="#/aff/manager" data-close>Meet your manager</a></div></div></div>`, 'm-welcome');
    void md; A.POST('/api/aff/welcome-seen').then(() => { S.me.welcome_seen = true; }).catch(() => {});
  }

  /* ================= Reports ================= */
  const REP_TABS = [['overview', 'Overview'], ['conversions', 'Conversions'], ['customers', 'Customers'], ['cohorts', 'Cohorts and repeat'], ['refunds', 'Refunds and chargebacks'], ['cpa', 'CPA']];
  const RF = S.cache.rf = { period: 'month', product: '', country: '', device: '', sub1: '', sub2: '', sub3: '', sub4: '', sub5: '', group: 'day', status: '', event: '' };
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const repQ = (extra = {}) => qs({ period: RF.period, product: RF.product, country: RF.country, device: RF.device, sub1: RF.sub1, sub2: RF.sub2, sub3: RF.sub3, sub4: RF.sub4, sub5: RF.sub5, ...extra });
  const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['last', 'Last month'], ['90d', 'Last 90 days']];
  const PRODS = ['premium', 'spyvoo', 'joinvoo', 'vooads', 'replyvoo', 'castvoo', 'landvoo', 'room'];
  const fsel = (k, ic, opts, label) => `<label class="fbtn fsel">${icon(ic)}<span class="sr">${label}</span><select data-rf="${k}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(RF[k]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>${icon('down')}</label>`;
  function filters(tab) {
    return `<div class="filters" data-filters>${fsel('period', 'calendar', PERIODS, 'Date range')}${fsel('product', 'grid', [['', 'All products'], ...PRODS.map((k) => [k, A.brand(k).name])], 'Product')}
      ${[1, 2, 3, 4, 5].map((i) => `<label class="fbtn fbtn-s fin"><span>sub${i}</span><input data-rf="sub${i}" value="${esc(RF['sub' + i])}" placeholder="any" aria-label="Filter sub${i}" maxlength="64"></label>`).join('')}
      ${fsel('country', 'globe', [['', 'All countries'], ...A.COUNTRIES.map(([c, n]) => [c, `${A.flag(c)} ${n}`])], 'Country')}${fsel('device', 'phone', [['', 'All devices'], ['mobile', 'Mobile'], ['desktop', 'Desktop'], ['tablet', 'Tablet']], 'Device')}
      ${tab === 'conversions' ? fsel('event', 'filter', [['', 'All events'], ['registration', 'Sign-ups'], ['first_payment', 'First payments'], ['repeat_payment', 'Repeat payments'], ['qualified', 'Qualified'], ['cpa', 'CPA'], ['refund', 'Refunds'], ['refund_final', 'Refunds (credits used)'], ['chargeback', 'Chargebacks']], 'Event') : ''}
      <button class="btn btn-k btn-sm fbtn-x" data-csv>${icon('download')}Export CSV</button></div>`;
  }
  const GROUPS = [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['product', 'Product'], ['sub1', 'sub1'], ['sub2', 'sub2'], ['country', 'Country'], ['device', 'Device'], ['source', 'Source']];
  function repTable(d) {
    const g = d.group;
    const keyCell = (k) => g === 'product' ? `<span class="tp">${pi(k, 'xs')}${esc(A.brand(k).name)}</span>` : g === 'country' ? `<span class="tp"><i class="cc">${A.flag(k)}</i>${esc(A.cname(k) || k)}</span>` : /^sub/.test(g) ? `<code>${esc(k)}</code>` : g === 'day' ? A.dayLabel(k) : g === 'month' ? A.monthLabel(k) : esc(k);
    const rows = d.rows || [];
    if (!rows.length) return empty('chart', 'No activity in this range.', 'Change the dates or filters, or share a link to start tracking.');
    // Manual adjustments have a date but no product or sub ID: their own column when grouped by time, else the total only.
    const byTime = ['day', 'week', 'month'].includes(g);
    return `<table class="tbl"><thead><tr><th>${esc((GROUPS.find((x) => x[0] === g) || [, 'Key'])[1])}</th><th class="n">Clicks</th><th class="n">Unique</th><th class="n">Sign-ups</th><th class="n">Sign-up rate</th><th class="n">New paying</th><th class="n">Qualified FTDs</th><th class="n">Revenue</th><th class="n">Commission</th>${byTime ? '<th class="n" title="Manual adjustments by the VooSquare team. Not part of commission.">Adjustments</th>' : ''}<th class="n">Refunds</th><th class="n">EPC</th></tr></thead><tbody>
      ${(byTime ? rows.slice().reverse() : rows).map((r) => `<tr><td>${keyCell(r.key)}</td><td class="n">${fmt(r.clicks)}</td><td class="n">${fmt(r.unique_clicks)}</td><td class="n">${fmt(r.signups)}</td><td class="n">${fmt(r.signup_rate || 0, 1)}%</td><td class="n">${fmt(r.new_paying)}</td><td class="n">${fmt(r.qualified)}</td><td class="n">${$c0(r.revenue_cents)}</td><td class="n b">${$c(r.commission_cents)}</td>${byTime ? `<td class="n">${r.adjustments_cents ? $c(r.adjustments_cents) : '–'}</td>` : ''}<td class="n">${fmt((r.refunds || 0) + (r.chargebacks || 0))}</td><td class="n">${$c(r.epc_cents)}</td></tr>`).join('')}</tbody></table>`;
  }
  const EVL = { registration: 'Sign-up', first_payment: 'First payment', repeat_payment: 'Payment', qualified: 'Qualified FTD', cpa: 'CPA conversion', refund: 'Refund', refund_final: 'Refund, commission final', chargeback: 'Chargeback', plan_started: 'Plan started', plan_renewed: 'Plan renewed', wallet_topup: 'Credit top-up' };
  function convLog(list) {
    if (!list.length) return empty('chart', isPend() ? 'Sign-ups from your links show here while we review your application.' : 'No conversions match these filters yet.', '', '<a class="btn btn-w btn-sm" href="#/aff/links">Get a link</a>');
    return `<div class="conv">${list.map((c) => `<div class="cv"><span class="cv-t">${A.tm(c.at)}<small>${A.ds(c.at)}</small></span>
      <span class="cv-p">${pi(c.product_key, 'sm')}<span><b>${esc(c.event_label || EVL[c.event] || c.event)}</b><small>${esc(A.pname(c.product_key, c.plan))} · ${esc(c.customer_ref || '')}${c.sub1 ? ` · <code>${esc(c.sub1)}</code>` : ''}${c.country ? ` · ${A.flag(c.country)} ${esc(c.country)}` : ''}${c.device ? ' · ' + esc(c.device) : ''}${c.amount_cents ? ' · ' + $c(c.amount_cents) : ''}</small>${c.reason_text ? `<em class="cv-why">${icon('help')}${esc(c.reason_text)} <a data-ask="${esc(c.id)}" href="#">Ask about this</a></em>` : ''}</span></span>
      <span class="cv-s">${statusPill(c.status)}</span><span class="cv-a ${c.commission_cents < 0 ? 'neg' : ''}">${c.commission_cents ? $c(c.commission_cents) : '–'}</span></div>`).join('')}</div>`;
  }
  async function repInner(tab) {
    if (tab === 'overview') {
      const d = await A.api('/api/aff/reports?' + repQ({ group: RF.group }));
      const t = d.total || {};
      return `<div class="sumrow">${[['Clicks', fmt(t.clicks)], ['Unique clicks', fmt(t.unique_clicks)], ['Sign-ups', fmt(t.signups)], ['Sign-up rate', fmt(t.signup_rate || 0, 2) + '%'], ['Qualified FTDs', fmt(t.qualified)], ['Revenue', $c0(t.revenue_cents)], ['Commission', $c0(t.commission_cents)], ['Adjustments', $c0(t.adjustments_cents || 0)], ['Refund rate', fmt(t.refund_rate || 0, 1) + '%'], ['EPC', $c(t.epc_cents)]].map((x) => `<div><small>${x[0]}</small><b>${x[1]}</b></div>`).join('')}</div>
        <div class="grp"><span>Group by</span><div class="chips" data-grp>${GROUPS.map((g) => `<button class="${g[0] === RF.group ? 'on' : ''}" data-g="${g[0]}" aria-pressed="${g[0] === RF.group}">${g[1]}</button>`).join('')}</div></div><div class="tbl-w" data-grpbox>${repTable(d)}</div>`;
    }
    if (tab === 'conversions') {
      const d = await A.api('/api/aff/conversions?' + qs({ period: RF.period, product: RF.product, status: RF.status, event: RF.event, limit: 200 }));
      const ST = [['', 'All'], ['pending_activation', 'Waiting'], ['available', 'Available'], ['in_review', 'In review'], ['declined', 'Declined'], ['reversed', 'Reversed'], ['paid', 'Paid']];
      return `<div class="cv-filter"><div class="chips" data-cvst>${ST.map(([v, l]) => `<button class="${v === RF.status ? 'on' : ''}" data-v="${v}" aria-pressed="${v === RF.status}">${l}</button>`).join('')}</div><span class="muted sm">${fmt(d.total)} in range</span></div>${convLog(d.conversions || [])}`;
    }
    if (tab === 'customers') {
      const d = await A.api('/api/aff/customers?limit=200');
      const L = d.customers || [];
      return `<p class="muted sm">One row per customer reference. Names, emails and contact details stay private.</p>${L.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Customer</th><th>Country</th><th>Signed up</th><th>Products</th><th class="n">Payments</th><th class="n">Net paid</th><th>Status</th><th>Model</th><th class="n">Your commission</th></tr></thead><tbody>
        ${L.map((c) => `<tr><td><code>${esc(c.customer_ref)}</code></td><td>${c.country ? `${A.flag(c.country)} ${esc(c.country)}` : '–'}</td><td>${A.ds(c.signed_up_at)}</td><td><span class="tp">${(c.products || []).slice(0, 3).map((k) => pi(k, 'xs')).join('')}${esc((c.products || []).map((k) => A.brand(k).short || A.brand(k).name).join(', ') || '–')}${c.plan ? ' ' + esc(c.plan) : ''}</span></td><td class="n">${fmt(c.payments)}</td><td class="n">${$c(c.net_paid_cents)}</td><td>${statusPill(c.status)}</td><td>${esc(c.model || '–')}</td><td class="n b">${$c(c.commission_cents)}</td></tr>`).join('')}</tbody></table></div>` : empty('users', 'Your referred customers appear here with a reference, product and status.', isPend() ? 'Earnings start after approval.' : '')}`;
    }
    if (tab === 'cohorts') {
      const d = await A.api('/api/aff/cohorts?months=6');
      const C = d.cohorts || []; const rp = d.repeat || {};
      const maxM = Math.max(1, ...C.map((c) => (c.revenue_cents || []).length));
      const maxV = Math.max(1, ...C.flatMap((c) => c.revenue_cents || []));
      return `<div class="rf-sum">${[['Paying customers', fmt(rp.paying_customers || 0)], ['Payments per customer', fmt(rp.payments_per_customer || 0, 2)], ['Repeat payments', fmt(rp.repeat_payments || 0)], ['Rebill rate', fmt(rp.rebill_rate || 0, 1) + '%'], ['Revenue per customer', $c(rp.revenue_per_customer_cents)]].map(([l, v]) => `<div><small>${l}</small><b>${v}</b></div>`).join('')}</div>
        <p class="muted sm">Customers acquired each month and the net revenue they paid in each month after. RevShare keeps paying while they stay.</p>${C.some((c) => c.customers) ? `<div class="tbl-w"><table class="tbl coh"><thead><tr><th>Acquired</th><th class="n">Customers</th>${Array.from({ length: maxM }, (_, i) => `<th class="n">Month ${i}</th>`).join('')}</tr></thead><tbody>
        ${C.map((c) => `<tr><td>${A.monthLabel(c.month)}</td><td class="n">${fmt(c.customers)}</td>${Array.from({ length: maxM }, (_, i) => c.revenue_cents[i] != null ? `<td class="n hm" style="--a:${(c.revenue_cents[i] / maxV).toFixed(2)}">${$c0(c.revenue_cents[i])}</td>` : '<td></td>').join('')}</tr>`).join('')}</tbody></table></div>` : empty('stack', 'Cohorts fill in as your customers pay month after month.')}`;
    }
    if (tab === 'refunds') {
      const d = await A.api('/api/aff/refunds');
      const L = d.refunds || [];
      return `<div class="rf-sum"><div><small>Refund rate, 2 months</small><b>${fmt(d.refund_rate || 0, 1)}%</b>${(d.refund_rate || 0) <= 8 ? '<span class="st st-g">Under 8%</span>' : '<span class="st st-amb">Over 8%</span>'}</div><div><small>Refunds this month</small><b>${fmt(d.month.r)}</b></div><div><small>Chargebacks this month</small><b>${fmt(d.month.c)}</b></div><div><small>Commission reversed</small><b>${$c(-Math.abs(d.month.rev || 0))}</b></div></div>
        ${L.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Date</th><th>Customer</th><th>Product</th><th>Type</th><th class="n">Amount</th><th class="n">Commission</th><th>Status</th></tr></thead><tbody>${L.map((r) => `<tr><td>${A.ds(r.at)}</td><td><code>${esc(r.customer_ref)}</code></td><td><span class="tp">${pi(r.product_key, 'xs')}${esc(A.brand(r.product_key).name)}</span></td><td>${esc(r.type === 'chargeback' ? 'Chargeback' : 'Refund')}</td><td class="n">${$c(r.amount_cents)}</td><td class="n neg">${$c(-Math.abs(r.reversed_cents || 0))}</td><td>${statusPill(r.status || 'reversed')}</td></tr>`).join('')}</tbody></table></div>` : empty('refresh', 'No refunds or chargebacks. Good traffic keeps it that way.')}`;
    }
    const d = await A.api('/api/aff/cpa');
    const s = d.stats || {}; const L = d.conversions || [];
    return `<div class="rf-sum"><div><small>In review</small><b>${fmt(s.in_review)}</b></div><div><small>Approved this month</small><b>${fmt(s.approved_month)}</b></div><div><small>Declined this month</small><b>${fmt(s.declined_month)}</b></div><div><small>CPA earned this month</small><b>${$c0(s.cpa_earned_month_cents)}</b></div></div>
      ${L.length ? `<div class="conv">${L.map((r) => `<div class="cv"><span class="cv-t">${A.ds(r.decided_at || r.qualified_at)}<small>${esc(r.id)}</small></span><span class="cv-p">${pi(r.product_key, 'sm')}<span><b>${esc(A.pname(r.product_key, r.plan))} · ${r.model === 'hybrid' ? 'Hybrid' : 'CPA'}</b><small>${esc(r.customer_ref || '')} · ${r.status === 'in_review' ? 'Checked by our team, then available' : r.hold_until && r.hold_until > Date.now() ? `hold until ${A.ds(r.hold_until)}` : r.status === 'approved' ? 'Available' : ''}</small>${r.reason_text ? `<em class="cv-why">${icon('help')}${esc(r.reason_text)} <a data-ask="${esc(r.id)}" href="#">Ask about this</a></em>` : ''}</span></span><span class="cv-s">${statusPill(r.status === 'in_review' ? 'in_review' : r.status)}</span><span class="cv-a">${$c(r.amount_cents)}</span></div>`).join('')}</div>` : empty('shield', 'CPA conversions show here once you have a CPA deal.', '', '<a class="btn btn-w btn-sm" href="#/aff/offers">See offers</a>')}`;
  }
  PG.reports = (arg) => {
    const tab = REP_TABS.some((t) => t[0] === arg) ? arg : 'overview';
    return affShell('reports', 'Reports', async () => {
      const inner = await repInner(tab);
      A.then((pg) => wireReports(pg, tab));
      return `<div class="ph"><div><h2>Reports</h2><p>Every click, sign-up and payment from your links. Times in Africa/Lagos.</p></div><a class="btn btn-w btn-sm" href="#/aff/settings/security">${icon('key')}Stats API</a></div>
        ${['overview', 'conversions'].includes(tab) ? filters(tab) : ''}<nav class="tabs" aria-label="Report sections">${REP_TABS.map(([k, l]) => `<a href="#/aff/reports/${k}" class="${k === tab ? 'on' : ''}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav><section class="card rep" data-rep>${inner}</section>`;
    });
  };
  function wireReports(pg, tab) {
    const box = pg.querySelector('[data-rep]');
    const reload = async () => { box.classList.add('dim'); try { box.innerHTML = await repInner(tab); A.mount(box); } catch (e) { VS.toast(e.message, 'err'); } finally { box.classList.remove('dim'); } };
    let t;
    pg.querySelectorAll('[data-rf]').forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => {
      RF[el.dataset.rf] = el.value.trim();
      if (el.tagName === 'INPUT' && el.value && !/^[A-Za-z0-9_\-.]{1,64}$/.test(el.value.trim())) { el.classList.add('bad'); return; }
      el.classList.remove('bad'); clearTimeout(t); t = setTimeout(reload, el.tagName === 'INPUT' ? 450 : 0);
    }));
    box.addEventListener('click', (e) => {
      const g = e.target.closest('[data-grp] button'); if (g) { RF.group = g.dataset.g; reload(); }
      const s = e.target.closest('[data-cvst] button'); if (s) { RF.status = s.dataset.v; reload(); }
    });
    const csv = pg.querySelector('[data-csv]');
    if (csv) csv.addEventListener('click', () => A.act(csv, () => A.download('/api/aff/reports.csv?' + repQ({ group: RF.group }), `voosquare-affiliate-report-${RF.period}.csv`)));
  }
  document.addEventListener('click', (e) => {
    const ask = e.target.closest('[data-ask]');
    if (!ask) return;
    e.preventDefault();
    const mg = (me().managers || {}); const who = (mg.private || mg.general || { name: 'your manager' }).name;
    const m = A.modal(`${A.mHead('Ask about this', 'Goes to your manager with the conversion reference.')}<form class="vs-modal-b"><div class="ask-ref"><code>${esc(ask.dataset.ask)}</code></div><label class="field"><span class="lbl">Your question</span><textarea class="inp" name="text" required placeholder="What would you like to know about this conversion?"></textarea></label><button class="btn btn-g" type="submit">Send to ${esc(who.split(' ')[0])}</button></form>`);
    m.el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const r = await A.act(ev.target.querySelector('button'), () => A.POST('/api/aff/messages', { text: ev.target.text.value, ref: ask.dataset.ask }), `Sent to ${who}`);
      if (r) m.close();
    });
  });

  /* ================= Offers ================= */
  function offerCard(p) {
    const b = A.brand(p.key);
    const your = p.your_rate_bp / 100, cap = p.cap_bp / 100;
    const c = p.cpa || {};
    let cpa = '';
    if (c.state === 'after_approval') cpa = `<div class="oc-cpa"><span>CPA</span><button class="btn btn-w btn-xs" disabled title="Available after approval">${icon('lock')}Apply for CPA</button><small>Available after approval</small></div>`;
    else if (c.state === 'active' || c.state === 'paused') cpa = `<div class="oc-cpa on"><span>${icon(c.state === 'paused' ? 'lock' : 'check')}${c.model === 'hybrid' ? `Hybrid ${$c0(c.cpa_cents)} + ${pct(c.rate_bp)}` : `CPA ${$c0(c.cpa_cents)}`}${c.plan ? ' on ' + esc(c.plan) : ''}${c.monthly_cap ? ` · cap ${c.monthly_cap}/month` : ''} · ${c.hold_days ? `hold ${c.hold_days} days` : 'available once approved'}</span>${c.state === 'paused' ? '<small>Paused. Your manager can tell you why.</small>' : ''}</div>`;
    else if (c.state === 'requested') cpa = `<div class="oc-cpa"><span>${icon('clock')}CPA application sent</span><small>Your manager answers within 3 business days.</small></div>`;
    else if (c.state === 'opens_at') cpa = `<div class="oc-cpa"><span>CPA opens at ${esc(c.tier)}</span><button class="btn btn-w btn-xs" data-cpa="${p.key}">Ask my manager</button></div>`;
    else cpa = `<div class="oc-cpa"><span>CPA${c.example_cents ? ' from ' + $c0(c.example_cents) : ''}</span><button class="btn btn-k btn-xs" data-cpa="${p.key}">Apply for CPA</button></div>`;
    const ch = (p.scheduled || []).map((s) => `<div class="oc-chg">${icon('clock')}${s.field === 'cpa' ? `From ${A.ds(s.effective_at)}: CPA ${$c0(Number(s.from))} → ${$c0(Number(s.to))}` : `From ${A.ds(s.effective_at)}: ${esc(s.field)} ${esc(String(s.from))} → ${esc(String(s.to))}`}. Customers who qualify before then keep the current terms.</div>`).join('');
    const stl = p.status === 'live' ? 'Live' : p.status === 'new' ? 'New' : 'Coming soon';
    return `<article class="oc" style="--a:${b.a};--b:${b.b};--acc:${b.acc};--ink:${b.ink}">
      <div class="oc-h">${pi(p.key, 'md')}<div><b>${esc(p.name)}</b><small>${esc(b.stage)}</small></div><span class="oc-st oc-${stl.replace(/\s/g, '').toLowerCase()}">${stl}</span></div>
      <div class="oc-b"><p>${esc(p.pitch)}</p>
        <div class="oc-rate"><div><small>Your rate ${p.custom ? (p.custom.special ? A.sdTag(p.custom, true) : '<span class="sd-tag cu sm">Custom deal</span>') : ''}</small><b>${fmt(your, your % 1 ? 1 : 0)}%</b><span>lifetime RevShare</span></div><div class="oc-meter"><i style="--y:${Math.min(1, your / 50)};--c:${Math.min(1, cap / 50)}"></i><span>${p.custom ? esc(A.dealWhen(p.custom)) : `Cap ${fmt(cap)}%`}</span></div></div>
        ${p.capped ? `<p class="oc-note">Capped at ${fmt(cap)}% on this product</p>` : ''}
        ${p.plans && p.plans.length ? `<div class="oc-plans">${p.plans.map((pl) => `<span><b>${esc(pl.name)}</b>${pl.price_cents ? $c0(pl.price_cents) : 'Synced'}</span>`).join('')}</div>` : '<div class="oc-plans"><span><b>Plans</b>Synced from the tool</span></div>'}
        ${cpa}${ch}
        <details class="oc-more"><summary>Landing pages, qualification, allowed traffic</summary><div><p><b>Landing pages</b> ${esc(p.domain || b.domain)} home and pricing, or any page on it as a deep link</p><p><b>Qualification</b> ${p.qualification === 'second' ? 'Second payment' : 'First payment'} · ${p.hold_days ? `hold ${p.hold_days} days` : 'commission available instantly'}</p><p><b>Allowed</b> Meta, TikTok, Google (no brand bidding), native, push, Telegram, YouTube, email to opted-in lists</p><p><b>Not allowed</b> Incentivised sign-ups, income claims, brand bidding, impersonation, adult or spam traffic</p></div></details>
      </div>
      <div class="oc-f"><a class="btn btn-k btn-sm" href="#/aff/links/${p.key}">${icon('link')}Get link</a><a class="btn btn-w btn-sm" href="#/aff/creatives">Creatives</a><a class="btn btn-ghost btn-sm" href="#/aff/lesson">How to promote</a></div></article>`;
  }
  PG.offers = () => affShell('offers', 'Offers', async () => {
    const d = await A.api('/api/aff/offers');
    S.cache.offers = d;
    const changes = d.products.flatMap((p) => (p.scheduled || []).map((s) => ({ ...s, p })));
    return `<div class="ph"><div><h2>Offers</h2><p>Every product you can promote, your rate on it and the deals open to you. You are on ${esc(d.tier)} at ${pct(d.rate_bp)}.</p></div></div>
      ${A.dealBanner(d.custom_deals)}
      <div class="oc-grid">${d.products.map(offerCard).join('')}</div>
      ${d.excluded.length ? `<details class="excl"><summary>${icon('ban')}Not commissionable: ${d.excluded.map((x) => esc(x.name)).join(', ')}.</summary><p>${d.excluded.map((x) => `${esc(x.name)}: ${esc(x.note)}`).join(' ')}</p></details>` : ''}
      <section class="card"><div class="card-h"><div><h3>Offer change log</h3><span class="sub">Every scheduled change to a rate, CPA or cap, with the date it takes effect. Reductions get at least 14 days notice (7 for a deal on your account only).</span></div></div>
        ${changes.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Offer</th><th>Change</th><th>Effective</th><th>Type</th></tr></thead><tbody>${changes.map((c) => `<tr><td><b>${esc(c.p.name)}</b></td><td>${c.field === 'cpa' ? `CPA ${$c0(Number(c.from))} → ${$c0(Number(c.to))}` : `${esc(c.field)} ${esc(String(c.from))} → ${esc(String(c.to))}`}</td><td>${A.dt(c.effective_at)}</td><td><span class="st ${c.direction === 'down' ? 'st-amb' : 'st-g'}">${c.direction === 'down' ? 'Reduction' : 'Increase'}</span></td></tr>`).join('')}</tbody></table></div>` : empty('clock', 'No changes scheduled.', 'When a rate or CPA changes, it is listed here with the date first.')}</section>`;
  });
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-cpa]');
    if (!c) return;
    const p = ((S.cache.offers || {}).products || []).find((x) => x.key === c.dataset.cpa); if (!p) return;
    const m = A.modal(`${A.mHead('Apply for CPA on ' + esc(p.name), 'Your manager reviews it and answers within 3 business days.')}<form class="vs-modal-b" data-cpaform>
      <div class="fgrid"><label class="field"><span class="lbl">Plan</span><select class="inp" name="plan"><option value="">Any plan</option>${(p.plans || []).map((x) => `<option>${esc(x.name)}</option>`).join('')}</select></label><label class="field"><span class="lbl">Model</span><select class="inp" name="model"><option value="cpa">CPA</option><option value="hybrid">Hybrid (CPA + RevShare)</option></select></label>
      <label class="field"><span class="lbl">Expected qualified customers a month</span><input class="inp" name="expected" inputmode="numeric" required placeholder="40"></label><label class="field"><span class="lbl">CPA you are asking for <em>optional</em></span><input class="inp" name="cpa_usd" inputmode="decimal" placeholder="$"></label></div>
      <label class="field"><span class="lbl">Traffic sources</span><input class="inp" name="traffic" placeholder="Meta ads, Telegram channel" required></label>
      <label class="field"><span class="lbl">Geos <em>country codes</em></span><input class="inp" name="geos" placeholder="NG, GH, KE" required></label>
      <label class="field"><span class="lbl">Sample creative or landing link</span><input class="inp" name="sample_url" type="url" placeholder="https://"></label>
      <label class="field"><span class="lbl">Note</span><textarea class="inp" name="reason" placeholder="Anything that helps us decide"></textarea></label>
      <p class="muted sm">${icon('shield')} CPA pays only for unique first-time paying customers. Anyone who had a Voo ID before your click earns no CPA.</p>
      <button class="btn btn-g" type="submit">Send application</button></form>`);
    m.el.querySelector('form').addEventListener('submit', async (ev) => {
      ev.preventDefault(); const f = ev.target;
      const list = (v) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
      const r = await A.act(f.querySelector('[type=submit]'), () => A.POST('/api/aff/cpa-requests', { product_key: p.key, plan: f.plan.value, model: f.model.value, expected: Number(f.expected.value) || 0, cpa_usd: f.cpa_usd.value.replace(/[^\d.]/g, '') || undefined, traffic: list(f.traffic.value), geos: list(f.geos.value.toUpperCase()), sample_url: f.sample_url.value, reason: f.reason.value }), (x) => x.message);
      if (r) { m.close(); A.route(); }
    });
  });

  /* ================= Links ================= */
  const LB = { product: '', url: '', sub1: '', sub2: '', sub3: '', sub4: '', sub5: '', click_macro: '' };
  PG.links = (arg) => affShell('links', 'Links', async () => {
    const [d, cp] = await Promise.all([A.api('/api/aff/links'), A.api('/api/aff/coupons').catch(() => ({ unlocked: false, coupons: [] }))]);
    S.cache.links = d;
    if (arg && d.deep_links.some((x) => x.product_key === arg)) LB.product = arg;
    const dest = [['', 'VooSquare home', 'voosquare.com'], ['smart', 'Smartlink', 'best tool by country and device'], ...d.deep_links.map((x) => [x.product_key, x.name, x.domain || A.brand(x.product_key).domain])];
    A.then((pg) => wireLinks(pg));
    const tier = (me().tier || {});
    return `<div class="ph"><div><h2>Links</h2><p>Your link sets a ${(S.pub && S.pub.attribution_days) || 60}-day window. If the visitor creates a Voo ID in that window, they are your customer for life on every tool.</p></div></div>
      <div class="g-2-1 lk-top"><section class="card lb" data-lbuild><div class="card-h"><h3>Link builder</h3></div>
        <div class="fgrid"><label class="field"><span class="lbl">Destination</span><select class="inp" data-f="product">${dest.map(([k, n, dm]) => `<option value="${esc(k)}" ${k === LB.product ? 'selected' : ''}>${esc(n)} · ${esc(dm)}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Deep link <em>optional</em></span><input class="inp" data-f="url" type="url" value="${esc(LB.url)}" placeholder="https://joinvoo.com/pricing"><span class="hint">Must be on ${esc(d.approved_domains.join(', '))}, or a page under one of them.</span></label></div>
        <div class="subs">${[1, 2, 3, 4, 5].map((i) => `<label class="field"><span class="lbl">sub${i}</span><input class="inp mono" data-f="sub${i}" value="${esc(LB['sub' + i])}" maxlength="64" placeholder="${['campaign', 'ad set', 'ad', 'creative', 'placement'][i - 1]}"></label>`).join('')}</div>
        <p class="hint">Use these to tag campaign, ad set, ad, creative and placement. Letters, numbers, _ - and . only, 64 characters each.</p>
        <div class="fgrid"><label class="field"><span class="lbl">Click ID macro <em>optional</em></span><input class="inp mono" data-f="click_macro" value="${esc(LB.click_macro)}" placeholder="{clickid}" maxlength="64"><span class="hint">Your tracker's macro, for example {{ad.id}} or {clickid}. Sent back in postbacks.</span></label>
        <label class="field"><span class="lbl">Name <em>for saved links</em></span><input class="inp" data-name maxlength="80" placeholder="Joinvoo NG main"></label></div>
        <div class="lb-out"><code data-out>${esc(d.base)}</code><button class="btn btn-k btn-sm" data-copyout>${icon('copy')}Copy</button></div>
        <div class="lb-act"><button class="btn btn-w btn-sm" data-save>${icon('plus')}Save link</button><span class="muted sm">Saved links track clicks, sign-ups and commission separately.</span></div></section>
        <section class="card qrc"><div class="card-h"><h3>QR code</h3></div><div class="qr-box" data-qr>${A.skel(1, 176)}</div><p class="muted sm">For posters, stories and offline events. It opens the same link with your sub IDs.</p><div class="lb-act"><button class="btn btn-w btn-sm" data-dlqr="png">${icon('download')}PNG</button><button class="btn btn-w btn-sm" data-dlqr="svg">${icon('download')}SVG</button></div></section></div>
      <div class="g-3">
        <section class="card tool"><span class="tool-ic">${icon('bolt')}</span><h3>Smartlink</h3><p>One link that sends each visitor to the tool that fits them best, by country and device. Good for mixed audiences and channel bios.</p><div class="lb-out sm"><code>${esc(d.smartlink)}</code><button class="btn btn-k btn-xs" data-copy="${esc(d.smartlink)}" aria-label="Copy smartlink">${icon('copy')}</button></div></section>
        <section class="card tool"><span class="tool-ic">${icon('link')}</span><h3>Deep links</h3><p>One link per product, or paste any page on an approved domain in the builder and we wrap it with your link.</p><div class="dl-list">${d.deep_links.map((x) => `<div class="lb-out sm">${pi(x.product_key, 'xs')}<code>${esc(x.url)}</code><button class="btn btn-w btn-xs" data-copy="${esc(x.url)}" aria-label="Copy ${esc(x.name)} link">${icon('copy')}</button></div>`).join('')}</div></section>
        ${cp.unlocked ? `<section class="card tool"><span class="tool-ic">${icon('tag')}</span><h3>Coupon codes</h3><p>Custom codes for podcasts, videos and offline. A customer who types your code at sign-up or checkout is yours.</p>
          <div class="cpn-l">${(cp.coupons || []).map((c) => `<div class="lb-out sm"><code>${esc(c.code)}</code><small>${c.discount_pct ? c.discount_pct + '% off · ' : ''}${c.uses}${c.max_uses ? '/' + c.max_uses : ''} uses${c.active ? '' : ' · off'}</small><button class="btn btn-w btn-xs" data-copy="${esc(c.code)}" aria-label="Copy code">${icon('copy')}</button></div>`).join('') || '<p class="muted sm">No codes yet.</p>'}</div>
          <form class="chat-f" data-cpnf><input class="inp mono" name="code" maxlength="20" placeholder="YOURCODE" aria-label="New coupon code" required><button class="btn btn-k btn-sm" type="submit">Create</button></form></section>`
        : `<section class="card tool lockd"><span class="tool-ic">${icon('tag')}</span><h3>Coupon codes</h3><p>Custom codes with a discount set by our team, for podcasts, videos and offline. Opens at Master.</p><div class="lock-row">${icon('lock')}${tier.next && tier.idx < 3 ? `${Math.max(0, A.tiers()[3].min - (tier.month_qualified || 0))} more qualified FTDs this month` : 'Opens at Master'}</div></section>`}</div>
      <section class="card"><div class="card-h"><h3>Saved links</h3><span class="r"><a class="lnk" href="#/aff/links" data-archived>${S.cache.showArch ? 'Hide archived' : 'Show archived'}</a></span></div><div data-saved>${savedTable(d.links)}</div></section>`;
  });
  function savedTable(links) {
    if (!links.length) return empty('link', 'Saved links appear here with their own clicks, sign-ups and commission.', 'Build one above and press Save link.');
    return `<div class="tbl-w"><table class="tbl"><thead><tr><th>Name</th><th>Destination</th><th>sub1</th><th class="n">Clicks</th><th class="n">Sign-ups</th><th class="n">Qualified FTDs</th><th class="n">Commission</th><th>Created</th><th><span class="sr">Actions</span></th></tr></thead><tbody>
      ${links.map((l) => `<tr class="${l.archived ? 'muted' : ''}"><td><b>${esc(l.name)}</b></td><td><span class="tp">${pi(l.product_key || 'premium', 'xs')}${esc(l.product_key === 'smart' ? 'Smartlink' : l.product_key ? A.brand(l.product_key).short || A.brand(l.product_key).name : 'VooSquare')}</span></td><td>${l.subs.sub1 ? `<code>${esc(l.subs.sub1)}</code>` : '–'}</td><td class="n">${fmt(l.clicks)}</td><td class="n">${fmt(l.signups)}</td><td class="n">${fmt(l.qualified)}</td><td class="n b">${$c0(l.commission_cents)}</td><td>${A.ds(l.created_at)}</td>
        <td class="n nowrap"><button class="btn btn-ghost btn-xs" data-copy="${esc(l.url)}" aria-label="Copy link">${icon('copy')}</button><button class="btn btn-ghost btn-xs" data-dl="/api/aff/links/${l.id}/qr.svg?px=1024" data-name="voosquare-link-${esc(l.code)}.svg" aria-label="Download QR code">${icon('qr')}</button><button class="btn btn-ghost btn-xs" data-arch="${l.id}" data-v="${l.archived ? 0 : 1}" aria-label="${l.archived ? 'Restore' : 'Archive'}">${icon(l.archived ? 'refresh' : 'x')}</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  function wireLinks(pg) {
    const lb = pg.querySelector('[data-lbuild]'); if (!lb) return;
    const out = lb.querySelector('[data-out]'); const qbox = pg.querySelector('[data-qr]');
    let t, cur = '';
    const upd = async () => {
      lb.querySelectorAll('[data-f]').forEach((el) => { LB[el.dataset.f] = el.value.trim(); });
      const bad = [1, 2, 3, 4, 5].find((i) => LB['sub' + i] && !/^[A-Za-z0-9_\-.]{1,64}$/.test(LB['sub' + i]));
      [1, 2, 3, 4, 5].forEach((i) => lb.querySelector(`[data-f="sub${i}"]`).classList.toggle('bad', !!LB['sub' + i] && !/^[A-Za-z0-9_\-.]{1,64}$/.test(LB['sub' + i])));
      if (bad) { out.textContent = 'Use letters, numbers, _ - and . only, up to 64 characters.'; out.classList.add('err'); return; }
      try {
        const r = await A.api('/api/aff/links/build?' + qs({ product: LB.product, url: LB.url, sub1: LB.sub1, sub2: LB.sub2, sub3: LB.sub3, sub4: LB.sub4, sub5: LB.sub5, click_macro: LB.click_macro }));
        cur = r.url; out.textContent = r.url; out.classList.remove('err');
        qbox.innerHTML = `<img alt="QR code for your link" width="176" height="176" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(r.qr_svg)}">`;
      } catch (e) { out.textContent = e.message; out.classList.add('err'); }
    };
    lb.addEventListener('input', () => { clearTimeout(t); t = setTimeout(upd, 300); });
    lb.addEventListener('change', () => { clearTimeout(t); upd(); });
    upd();
    pg.querySelector('[data-copyout]').addEventListener('click', () => { if (cur) VS.copyText(cur); });
    pg.querySelector('[data-save]').addEventListener('click', async (e) => {
      const r = await A.act(e.currentTarget, () => A.POST('/api/aff/links', { name: lb.querySelector('[data-name]').value.trim() || undefined, product_key: LB.product, dest_url: LB.url || undefined, sub1: LB.sub1, sub2: LB.sub2, sub3: LB.sub3, sub4: LB.sub4, sub5: LB.sub5, click_macro: LB.click_macro }), 'Link saved');
      if (r) { S.cache.links.links.unshift(r.link); pg.querySelector('[data-saved]').innerHTML = savedTable(S.cache.links.links); A.mount(pg.querySelector('[data-saved]')); }
    });
    pg.querySelectorAll('[data-dlqr]').forEach((b) => b.addEventListener('click', () => A.act(b, () => qrDownload(cur, b.dataset.dlqr))));
    pg.addEventListener('click', async (e) => {
      const ar = e.target.closest('[data-arch]');
      if (ar) { const r = await A.act(ar, () => A.PATCH(`/api/aff/links/${ar.dataset.arch}`, { archived: ar.dataset.v === '1' }), ar.dataset.v === '1' ? 'Link archived' : 'Link restored'); if (r) A.route(); }
      const sa = e.target.closest('[data-archived]');
      if (sa) { e.preventDefault(); S.cache.showArch = !S.cache.showArch; const d = await A.api('/api/aff/links' + (S.cache.showArch ? '?archived=1' : '')); pg.querySelector('[data-saved]').innerHTML = savedTable(d.links); A.mount(pg); sa.textContent = S.cache.showArch ? 'Hide archived' : 'Show archived'; }
    });
    const cf = pg.querySelector('[data-cpnf]');
    if (cf) cf.addEventListener('submit', async (e) => { e.preventDefault(); const r = await A.act(cf.querySelector('button'), () => A.POST('/api/aff/coupons', { code: cf.code.value }), 'Code created'); if (r) A.route(); });
  }
  async function qrDownload(url, kind) {
    if (!url) throw new Error('Build a link first.');
    const res = await fetch('/api/aff/qr.svg?px=1024&text=' + encodeURIComponent(url), { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not make the QR code.');
    const svg = await res.text();
    const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    if (kind === 'svg') { save(new Blob([svg], { type: 'image/svg+xml' }), 'voosquare-link-qr.svg'); VS.toast('QR code downloaded'); return; }
    const img = new Image();
    await new Promise((res2, rej) => { img.onload = res2; img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const c = document.createElement('canvas'); c.width = c.height = 1024;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 1024, 1024); x.drawImage(img, 0, 0, 1024, 1024);
    await new Promise((res2) => c.toBlob((b) => { save(b, 'voosquare-link-qr.png'); res2(); }, 'image/png'));
    VS.toast('QR code downloaded');
  }
})();
