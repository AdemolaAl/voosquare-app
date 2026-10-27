/* VooSquare Affiliates back office: super admin, managers, CPA fraud check and finance. Role-aware (GET /api/admin/aff/me):
 * aff_admin sees everything; aff_manager only assigned partners; aff_fraud the CPA queue; aff_finance payouts and KYC.
 * Ported from the approved preview (admin.js) and wired to /api/admin/aff/*. */
(function () {
  'use strict';
  const A = window.AF, VS = A.VS, S = A.S;
  const { esc, icon, fmt, face, pi, usd, $c, $c0, pct, tierBadge, statusPill, empty } = A;
  const roles = () => (S.staff && S.staff.roles) || {};
  const R = (k) => !!roles()[k] || !!roles().admin;
  const BASES = { admin: 'admin', mgr: 'manager', fraud: 'fraud', fin: 'finance' };

  function navFor() {
    const r = roles(); const c = (S.staff && S.staff.counts) || {};
    const g = [];
    if (r.admin) {
      g.push(['Program', [['#/admin/overview', 'chart', 'Overview', '', 'overview'], ['#/admin/affiliates', 'users', 'Affiliates', '', 'affiliates'], ['#/admin/approvals', 'id', 'Approvals', c.applications || '', 'approvals'], ['#/admin/cpa', 'shield', 'CPA review', c.cpa || '', 'cpa'], ['#/admin/payouts', 'wallet', 'Payouts', c.payouts || '', 'payouts']]]);
      g.push(['Setup', [['#/admin/deals', 'percent', 'Deals and products', '', 'deals'], ['#/admin/contests', 'trophy', 'Contests', '', 'contests'], ['#/admin/creatives', 'image', 'Creatives', '', 'creatives'], ['#/admin/announce', 'megaphone', 'Announcements', '', 'announce']]]);
      g.push(['Risk and money', [['#/admin/signals', 'alert', 'Fraud signals', '', 'signals'], ['#/admin/flags', 'flag', 'Flagged affiliates', '', 'flags'], ['#/admin/kyc', 'id', 'KYC', '', 'kyc'], ['#/admin/clawbacks', 'refresh', 'Fraud reversals', '', 'clawbacks']]]);
      g.push(['Team', [['#/admin/managers', 'headset', 'Managers', '', 'managers'], ['#/admin/audit', 'list', 'Audit log', '', 'audit'], ['#/admin/settings', 'settings', 'Program settings', '', 'settings']]]);
      return g;
    }
    if (r.manager) g.push(['My book', [['#/mgr/home', 'users', 'My partners', '', 'home'], ['#/mgr/applications', 'id', 'Applications', c.applications || '', 'applications'], ['#/mgr/requests', 'percent', 'Deal requests', '', 'requests']]]);
    if (r.fraud) g.push(['CPA review', [['#/fraud/queue', 'shield', 'Review queue', c.cpa || '', 'queue'], ['#/fraud/signals', 'alert', 'Fraud signals', '', 'signals'], ['#/fraud/flags', 'flag', 'Flagged affiliates', '', 'flags']]]);
    if (r.finance) g.push(['Finance', [['#/fin/payouts', 'wallet', 'Payouts', c.payouts || '', 'payouts'], ['#/fin/kyc', 'id', 'KYC', '', 'kyc'], ['#/fin/clawbacks', 'refresh', 'Fraud reversals', '', 'clawbacks']]]);
    return g;
  }
  const roleLabel = () => { const r = roles(); return r.owner ? 'Owner · Super admin' : r.admin ? 'Program admin' : [r.manager && 'Manager', r.fraud && 'CPA fraud check', r.finance && 'Finance'].filter(Boolean).join(' · '); };
  function bShell(base, page, title, load) {
    const who = `<div class="who">${face(A.avOf(null, (S.user || {}).email), 'md')}<span><b>${esc((S.user || {}).name || 'Team')}</b><em class="who-r">${esc(roleLabel())}</em></span></div>`;
    const foot = `${S.me && S.me.status !== 'closed' ? `<a class="sb-lnk" href="#/aff/home">${icon('home')}My affiliate dashboard</a>` : ''}<a class="sb-lnk" href="/admin">${icon('grid')}VooSquare admin</a><button class="sb-lnk" data-logout>${icon('logout')}Log out</button>`;
    const html = A.shell({ page, title, nav: navFor(), who, body: null, tag: { admin: 'Admin', mgr: 'Manager', fraud: 'Fraud check', fin: 'Finance' }[base], foot, topRight: `<a class="tb-ic" href="${A.staffHome()}" aria-label="Back office home">${icon('home')}</a>` });
    return A.deferred(html, load);
  }
  const stat = (l, v, sub = '', cls = '') => `<div class="ast ${cls}"><small>${l}</small><b>${v}</b>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const riskChip = (r) => `<span class="risk ${r >= 60 ? 'hi' : r >= 30 ? 'md' : 'lo'}" title="Risk ${r}"><i style="--r:${Math.min(1, r / 100)}"></i>${r}</span>`;
  const verdictChip = (v) => ({ unique: `<span class="vd vd-u">${icon('check')}Unique</span>`, possible: `<span class="vd vd-p">${icon('alert')}Possible duplicate</span>`, existing: `<span class="vd vd-e">${icon('ban')}Existing customer</span>` }[v] || '');
  const who = (x) => `<span class="tp">${face(A.avOf(x.avatar, x.name || x.display_name), 'sm')}<span><b>${esc(x.display_name || x.name)}</b><small>${esc(x.ref || '')}${x.name && x.display_name && x.name !== x.display_name ? ' · ' + esc(x.name) : ''}${x.country ? ' · ' + A.flag(x.country) + ' ' + esc(x.country) : ''}</small></span></span>`;
  const affLink = (base, x) => `#/${base}/${base === 'mgr' ? 'partner' : 'affiliate'}/${x.id}`;
  const affRow = (base, a, full) => `<tr><td><a href="${affLink(base, a)}">${who(a)}</a></td><td>${tierBadge(a.tier, 'sm')}</td><td class="n">${fmt(a.qualified_mtd)}</td><td class="n b">${$c0(a.commission_mtd_cents)}</td><td class="n">${fmt(a.refund_rate || 0, 1)}%</td><td class="n">${riskChip(a.fraud_score || 0)}</td>${full ? `<td>${a.general_manager ? esc(a.general_manager.name.split(' ')[0]) : '<span class="muted">None</span>'}${a.private_manager ? ` · <b>${esc(a.private_manager.name.split(' ')[0])}</b>` : ''}</td><td>${statusPill(a.kyc)}</td>` : ''}<td>${statusPill(a.status === 'approved' ? 'active' : a.status)}${a.health && ['grace', 'paused', 'at_risk'].includes(a.health) ? ` <span class="st st-amb">${esc(a.health.replace('_', ' '))}</span>` : ''}</td></tr>`;
  const affTable = (base, rows, full) => (rows.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Affiliate</th><th>Tier</th><th class="n">Qualified FTDs</th><th class="n">Commission</th><th class="n">Refund rate</th><th class="n">Fraud score</th>${full ? '<th>Managers</th><th>KYC</th>' : ''}<th>Status</th></tr></thead><tbody>${rows.map((a) => affRow(base, a, full)).join('')}</tbody></table></div>` : empty('users', 'No affiliates here yet.'));
  const P = {};

  /* ================= Overview ================= */
  P.overview = async (base) => {
    const o = await A.api('/api/admin/aff/overview');
    const T = A.tiers(); const tot = o.by_tier.reduce((s, x) => s + x.count, 0) || 1;
    return `<div class="ph"><div><h2>Affiliate program</h2><p>Month to date, Africa/Lagos.</p></div><div class="lb-act"><a class="btn btn-w btn-sm" href="#/admin/announce">${icon('megaphone')}Announce</a><a class="btn btn-k btn-sm" href="#/admin/approvals">${icon('id')}${o.pending ? `Review ${o.pending} application${o.pending === 1 ? '' : 's'}` : 'Applications'}</a></div></div>
      <div class="astats">${stat('Active affiliates', fmt(o.active), `+${fmt(o.new_this_month)} this month`)}${stat('Pending approvals', fmt(o.pending), o.overdue ? `${o.overdue} overdue` : 'None overdue', o.overdue ? 'warn' : '')}${stat('CPA in review', fmt(o.cpa_in_review), o.cpa_oldest_at ? 'oldest ' + A.ago(o.cpa_oldest_at) : 'Queue clear')}${stat('Revenue from affiliate customers', $c0(o.revenue_mtd_cents), o.revenue_change_pct == null ? 'New this month' : `${o.revenue_change_pct >= 0 ? '+' : ''}${fmt(o.revenue_change_pct)}% vs last month`)}${stat('Commission earned', $c0(o.commission_mtd_cents), `${fmt(o.commission_share_pct || 0, 1)}% of revenue${o.adjustments_mtd_cents ? ` · adjustments ${o.adjustments_mtd_cents > 0 ? '+' : '−'}${$c0(Math.abs(o.adjustments_mtd_cents))} not included` : ''}`)}${stat('Payouts due', $c0(o.payouts_due.amount_cents), `${o.payouts_due.count} request${o.payouts_due.count === 1 ? '' : 's'}${o.payouts_due.four_eyes ? ` · ${o.payouts_due.four_eyes} need four-eyes` : ''}`, o.payouts_due.four_eyes ? 'warn' : '')}</div>
      <div class="g-2-1"><section class="card"><div class="card-h"><h3>Revenue from affiliate customers</h3><span class="sub">Last 30 days</span></div>${A.area(o.revenue_series.map((d) => ({ x: A.dayLabel(d.day), v: d.revenue_cents / 100 })), { color: '#00774B', label: 'Revenue' })}</section>
        <section class="card"><div class="card-h"><h3>Today</h3></div>${o.today.length ? `<div class="todo">${o.today.map((t) => `<a class="td td-${esc(t.tone)}" href="${esc(t.href.replace('#/fraud/', R('admin') ? '#/admin/' : '#/fraud/'))}">${icon({ application_overdue: 'alert', four_eyes: 'wallet', cpa_paused: 'shield', legend: 'star', scheduled_change: 'clock' }[t.kind] || 'bell')}<span><b>${esc(t.title)}</b><small>${esc(t.text)}</small></span>${icon('arrow')}</a>`).join('')}</div>` : empty('check', 'Nothing needs you right now.')}</section></div>
      <div class="g-2-1"><section class="card"><div class="card-h"><h3>Top affiliates this month</h3><a class="r lnk" href="#/admin/affiliates">All affiliates</a></div>${affTable(base, o.top)}</section>
        <section class="card"><div class="card-h"><h3>Affiliates by tier</h3></div><div class="tierbar">${o.by_tier.map((x) => { const t = A.tier(x.tier); return `<i style="--w:${x.count / tot};--tb:${t.bg};--tbd:${t.bd}" title="${esc(x.tier)}: ${x.count}"></i>`; }).join('')}</div>
          <div class="tierlist">${o.by_tier.map((x) => `<div>${tierBadge(x.tier, 'sm')}<span>${pct(x.rate_bp)}</span><b>${fmt(x.count)}</b></div>`).join('')}</div>${void T || ''}</section></div>`;
  };

  /* ================= Affiliates ================= */
  const AFQ = { q: '', status: '', tier: '', kyc: '', fraud_min: '' };
  P.affiliates = async (base) => {
    const qs = Object.entries(AFQ).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const d = await A.api('/api/admin/aff/affiliates?' + qs);
    A.then((pg) => {
      let t;
      pg.querySelectorAll('[data-afq]').forEach((el) => el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', () => { AFQ[el.dataset.afq] = el.value.trim(); clearTimeout(t); t = setTimeout(() => A.route(), el.tagName === 'INPUT' ? 450 : 0); }));
      const q = pg.querySelector('[data-afq=q]'); if (q && AFQ.q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    });
    const sel = (k, label, opts) => `<label class="fbtn fsel"><span class="sr">${label}</span><select data-afq="${k}" aria-label="${label}">${opts.map(([v, l]) => `<option value="${v}" ${String(AFQ[k]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>${icon('down')}</label>`;
    return `<div class="ph"><div><h2>Affiliates</h2><p>${fmt(d.counts.active)} active · ${fmt(d.counts.paused)} paused · ${fmt(d.counts.closed)} closed</p></div>${R('admin') ? `<button class="btn btn-w btn-sm" data-dl="/api/admin/aff/affiliates.csv" data-name="voosquare-affiliates.csv">${icon('download')}Export CSV</button>` : ''}</div>
      <div class="filters"><label class="tb-s in">${icon('search')}<input data-afq="q" value="${esc(AFQ.q)}" placeholder="Name, email, code, Voo ID, wallet or AF-id" aria-label="Search affiliates"></label>
        ${sel('status', 'Status', [['', 'All statuses'], ['approved', 'Active'], ['pending', 'Pending'], ['suspended', 'Paused'], ['rejected', 'Declined'], ['closed', 'Closed']])}${sel('tier', 'Tier', [['', 'All tiers'], ...A.tiers().map((t) => [t.n, t.n])])}${sel('kyc', 'KYC', [['', 'Any KYC'], ['verified', 'Verified'], ['pending', 'Pending'], ['none', 'Not started'], ['rejected', 'Rejected']])}${sel('fraud_min', 'Fraud score', [['', 'Any fraud score'], ['30', 'Fraud score 30+'], ['60', 'Fraud score 60+']])}</div>
      <section class="card">${affTable(base, d.affiliates, true)}</section>`;
  };
  P.affiliate = async (base, id) => {
    const d = await A.api('/api/admin/aff/affiliates/' + Number(id));
    const a = d.affiliate; const r = roles();
    const mgrs = R('admin') ? (await A.api('/api/admin/aff/managers').catch(() => ({ managers: [] }))).managers : [];
    const f = d.fraud || { score: 0, breakdown: [] };
    A.then((pg) => wireAffiliate(pg, a, d));
    const h = d.health || {};
    return `<a class="back" href="#/${base}/${base === 'mgr' ? 'home' : base === 'fin' ? 'payouts' : 'affiliates'}">${icon('left')}${base === 'mgr' ? 'My partners' : base === 'fin' ? 'Payouts' : 'Affiliates'}</a>
      <section class="card adh"><div class="adh-l">${face(A.avOf(a.avatar, a.name), 'xl')}<div><h2>${esc(a.display_name || a.name)}</h2><p class="muted">${esc(a.name)} · ${esc(a.ref)} · ${A.flag(a.country)} ${esc(A.cname(a.country))} · ${esc(a.email)}${a.approved_at ? ' · affiliate since ' + A.dt(a.approved_at) : ''}</p><div class="lb-act">${tierBadge(a.tier)}${statusPill(a.status === 'approved' ? 'active' : a.status)}${statusPill(a.kyc, 'KYC ' + (a.kyc === 'none' ? 'not started' : a.kyc))}<span class="hl-chip hl-${{ active: 'g', ramp: 'b', at_risk: 'amb', grace: 'amb', paused: 'r' }[h.state] || 'w'}">RevShare ${esc((h.state || 'inactive').replace('_', ' '))} · ${h.count || 0}/${h.threshold || 0}</span>${a.sources ? `<span class="pill pill-w">Sources: ${esc(a.sources)}</span>` : ''}${a.cpa_paused ? '<span class="st st-r">CPA paused</span>' : ''}</div></div></div>
        <div class="adh-r">${stat('Qualified FTDs MTD', fmt(a.qualified_mtd))}${stat('Commission MTD', $c0(a.commission_mtd_cents), 'Earned from customers')}${stat('Adjustments MTD', `${(d.adjustments_mtd_cents || 0) < 0 ? '−' : ''}${$c0(Math.abs(d.adjustments_mtd_cents || 0))}`, 'Manual, not in commission')}${stat('Fraud score', riskChip(f.score || a.fraud_score || 0))}</div></section>
      <div class="g-2"><section class="card"><div class="card-h"><h3>Balance</h3></div><div class="sumrow six">${[['Available', d.balance.available_cents], ...(d.balance.hold_cents > 0 ? [['On hold', d.balance.hold_cents]] : [['Lifetime', d.balance.lifetime_cents]]), ['Waiting', d.balance.pending_activation_cents], ['In review', d.balance.in_review_cents], ['Paid', d.balance.paid_cents], ['Owed', d.balance.owed_cents]].map(([l, v]) => `<div><small>${l}</small><b>${$c(v)}</b></div>`).join('')}</div>
          ${R('finance') ? `<form class="chat-f" data-adjf data-idem="${idemKey()}"><input class="inp" name="amount" inputmode="decimal" required placeholder="USD, e.g. -25" aria-label="Adjustment in USD, negative deducts"><input class="inp" name="reason" required minlength="3" maxlength="300" placeholder="Reason they see (required)" aria-label="Reason (required, the affiliate sees it)"><button class="btn btn-w btn-sm" type="submit">Add</button></form>
          <p class="muted sm">A reason is required. Positive adjustments over ${$c0(d.adjustments_four_eyes_cents || 50000)} wait for a second finance or admin user. The same amount and reason twice within a minute is refused.</p>
          ${adjMini(d.adjustment_requests || [])}` : ''}</section>
        <section class="card"><div class="card-h"><h3>Commission, last 30 days</h3><span class="sub">Earned from customers. Manual adjustments are not included.</span></div>${A.area((d.series || []).map((x) => ({ x: A.dayLabel(x.day), v: x.commission_cents / 100 })), { label: 'Commission', h: 180 })}</section></div>
      ${R('admin') ? `<div class="g-2"><section class="card"><div class="card-h"><h3>Managers</h3><span class="sub">Every affiliate has one general manager.</span></div><form data-mgrf>
          <div class="fgrid"><label class="field"><span class="lbl">General manager</span><select class="inp" name="general_manager_id"><option value="">None</option>${mgrs.filter((m) => m.kinds.includes('general')).map((m) => `<option value="${m.user_id}" ${a.general_manager && a.general_manager.id === m.user_id ? 'selected' : ''}>${esc(m.name)} · ${m.load.general}/${m.load.target}</option>`).join('')}</select></label>
          <label class="field"><span class="lbl">Private manager</span><select class="inp" name="private_manager_id"><option value="">None</option>${mgrs.filter((m) => m.kinds.includes('private')).map((m) => `<option value="${m.user_id}" ${a.private_manager && a.private_manager.id === m.user_id ? 'selected' : ''}>${esc(m.name)} · ${m.load.private}/${m.load.target}</option>`).join('')}</select><span class="hint">Suggested after one full month at Elite or above.</span></label></div><div class="lb-act"><button class="btn btn-k btn-sm" type="submit">Save assignment</button></div></form></section>
        <section class="card"><div class="card-h"><h3>Tier, health and status</h3></div><form data-tierf>
          <div class="fgrid"><label class="field"><span class="lbl">Tier override</span><select class="inp" name="tier_override"><option value="">None (computed: ${esc(d.tier.tier)})</option>${A.tiers().map((x, i) => `<option value="${i}" ${d.tier.override === i ? 'selected' : ''}>${esc(x.n)} · ${fmt(x.rate)}%</option>`).join('')}</select></label>
          <label class="field"><span class="lbl">Tier floor</span><select class="inp" name="tier_floor"><option value="">None</option>${A.tiers().map((x, i) => `<option value="${i}" ${d.tier.floor === i ? 'selected' : ''}>${esc(x.n)}</option>`).join('')}</select></label><label class="field"><span class="lbl">Floor until</span><input class="inp" type="date" name="floor_until" value="${d.tier.floor_until ? new Date(d.tier.floor_until).toISOString().slice(0, 10) : ''}"></label>
          <label class="field"><span class="lbl">Status</span><select class="inp" name="status"><option value="">Keep (${esc(a.status)})</option><option value="active">Active</option><option value="paused">Paused (earnings held)</option><option value="closed">Closed</option></select></label><label class="field"><span class="lbl">Reason <em>logged</em></span><input class="inp" name="reason" placeholder="Required for pause or close"></label></div>
          <label class="switch"><input type="checkbox" name="health_exempt" ${h.exempt ? 'checked' : ''}><i></i>Exempt from the lifetime RevShare health rule</label>${d.tier.legend_pending ? '<label class="switch"><input type="checkbox" name="legend_approved"><i></i>Approve Legend</label>' : ''}
          <div class="lb-act"><button class="btn btn-k btn-sm" type="submit">Save</button></div></form></section></div>` : ''}
      ${R('fraud') ? `<section class="card"><div class="card-h"><h3>CPA</h3><span class="sub">${a.cpa_paused ? 'CPA is paused on this affiliate.' : 'CPA is open on this affiliate.'}</span><button class="r btn btn-w btn-sm" data-cpapause="${a.cpa_paused ? 0 : 1}">${a.cpa_paused ? 'Resume CPA' : 'Pause CPA'}</button></div></section>` : ''}
      <section class="card"><div class="card-h"><h3>Custom deals</h3><span class="sub">Within program limits: RevShare up to the product cap, CPA up to ${$c0(30000)}. Reductions need 7 days notice.</span><span class="r lb-act">${d.can_create_custom_deal && a.status === 'approved' ? `<button class="btn btn-w btn-sm" data-rsdeal="${a.id}">${icon('percent')}Custom RevShare</button>` : ''}${R('admin') ? `<button class="btn btn-w btn-sm" data-newdeal="${a.id}">${icon('plus')}New deal</button>` : `<button class="btn btn-w btn-sm" data-reqdeal="${a.id}">${icon('plus')}Request a deal</button>`}</span></div>
        ${A.dealBanner(d.custom_deals, true)}
        ${d.deals.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Product</th><th>Model</th><th class="n">Amount</th><th class="n">Monthly cap</th><th>Traffic</th><th>Geos</th><th>Status</th><th>From</th></tr></thead><tbody>${d.deals.map((x) => `<tr><td><span class="tp">${x.all_products ? `${icon('grid')}All products` : `${pi(x.product_key, 'xs')}${esc(A.pname(x.product_key, x.plan))}`}</span></td><td>${x.model === 'revshare' ? `RevShare ${A.sdTag(x, true)}` : x.model === 'hybrid' ? 'Hybrid' : 'CPA'}</td><td class="n b">${x.model === 'revshare' ? pct(x.rate_bp) : `${$c0(x.cpa_cents)}${x.rate_bp ? ' + ' + pct(x.rate_bp) : ''}`}</td><td class="n">${x.model === 'revshare' ? '–' : fmt(x.monthly_cap || 0)}</td><td>${x.model === 'revshare' ? '–' : esc((x.traffic || []).join(', ') || 'All declared')}</td><td>${x.model === 'revshare' ? '–' : esc((x.geos || []).join(', ') || 'All')}</td><td>${statusPill(x.status)}${x.model === 'revshare' ? `<small class="muted"> ${x.ends_at ? 'to ' + A.ds(x.ends_at - 1) : 'forever'}</small>` : ''}</td><td>${A.ds(x.starts_at || x.created_at)}${x.model === 'revshare' && x.status === 'active' && d.can_create_custom_deal ? ` <button class="btn btn-ghost btn-xs" data-rsend="${x.id}">End</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('percent', 'No custom deals. This affiliate earns tier RevShare.')}
        ${d.deal_requests.length ? `<h4 class="sw-h">Requests</h4><div class="conv">${d.deal_requests.map(dealReqRow).join('')}</div>` : ''}</section>
      <div class="g-2"><section class="card"><div class="card-h"><h3>Fraud score breakdown</h3><span class="r">${riskChip(f.score || 0)}</span></div>${(f.breakdown || []).length ? A.bars(f.breakdown.map((b) => ({ label: b.label, v: Number(b.value) || 0, col: (b.value || 0) > (b.limit || 10) ? '#E8A317' : '#00A86B' })), { fmtv: (v) => fmt(v, v % 1 ? 1 : 0) + '%' }) : '<p class="muted sm">Not enough activity yet.</p>'}</section>
        <section class="card"><div class="card-h"><h3>Notes and messages</h3><span class="sub">Shared notes show on the affiliate's Manager page</span></div><div class="notes" data-notes>${d.notes.length ? d.notes.map((n) => `<div class="${n.shared ? '' : 'int'}${n.from_affiliate ? ' from-aff' : ''}"><b>${n.from_affiliate ? 'From the affiliate' : n.shared ? 'Shared' : 'Internal'} · ${esc(n.author || '')} · ${A.dtm(n.at)}</b><p>${esc(n.body)}</p></div>`).join('') : '<p class="muted sm">No notes yet.</p>'}</div>
          ${R('manager') ? `<form class="chat-f" data-notef><input class="inp" name="body" placeholder="Add a note or reply" aria-label="Note"><button class="btn btn-k btn-sm" type="submit">Add</button></form><label class="switch sm"><input type="checkbox" data-shared checked><i></i>Share with affiliate</label>` : ''}</section></div>
      <div class="g-2"><section class="card"><div class="card-h"><h3>Application</h3></div>${d.application && d.application.plan ? `<div class="app-sum">${[['Sources', (d.application.sources || []).join(', ')], ['Geos', (d.application.geos || []).join(', ')], ['Volume', d.application.volume], ['Experience', d.application.years], ['Links', (d.application.links || []).join(' · ')], ['Plan', d.application.plan]].map(([l, v]) => `<div><small>${l}</small><b>${esc(v || '–')}</b></div>`).join('')}</div>` : '<p class="muted sm">No application sent.</p>'}</section>
        <section class="card"><div class="card-h"><h3>Recent changes</h3></div>${d.audit.length ? `<ul class="ul sm">${d.audit.slice(0, 12).map((x) => `<li><b>${esc(x.actor)}</b> · ${esc(x.action)}${x.target ? ' · ' + esc(x.target) : ''} <span class="muted">${A.dtm(x.at)}</span></li>`).join('')}</ul>` : '<p class="muted sm">No changes yet.</p>'}
          ${d.subs.length ? `<h4 class="sw-h">Sub-affiliates</h4><ul class="ul sm">${d.subs.map((s) => `<li>${esc(s.ref)} · ${esc(s.name)} · ${esc(s.status)}</li>`).join('')}</ul>` : ''}</section></div>
      ${R('finance') && d.payouts.length ? `<section class="card"><div class="card-h"><h3>Payouts</h3></div>${payTableSmall(d.payouts)}</section>` : ''}`;
  };
  const idemKey = () => 'adj-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  /* Adjustments waiting for (or past) the second approval. The requester sees no buttons on their own request. */
  const adjAct = (x) => (x.status === 'pending' ? (x.mine ? '<small class="muted">Needs another approver</small>' : `<button class="btn btn-g btn-xs" data-adjact="${x.id}" data-a="approve">Approve</button><button class="btn btn-ghost btn-xs" data-adjact="${x.id}" data-a="decline">Decline</button>`) : '');
  /* Compact list for the affiliate's Balance card (narrow column). */
  const adjMini = (L) => (L.length ? `<h4 class="sw-h">Adjustments needing a second approval</h4><ul class="ul sm adj-l">${L.map((x) => `<li><b>${$c(x.amount_cents)}</b> · ${esc(x.reason)} <span class="muted">· ${esc(x.requested_by)}, ${A.ds(x.requested_at)}</span> ${statusPill(x.status)}${x.decided_by ? ` <small class="muted">${esc(x.decided_by)}</small>` : ''} <span class="lb-act">${adjAct(x)}</span></li>`).join('')}</ul>` : '');
  const adjList = (L, withAff = false) => (L.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Asked</th>${withAff ? '<th>Affiliate</th>' : ''}<th class="n">Amount</th><th>Reason</th><th>By</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${L.map((x) => `<tr><td>${A.ds(x.requested_at)}</td>${withAff ? `<td><a href="#/${S.role === 'fin' ? 'fin' : 'admin'}/affiliate/${x.affiliate_id}">${esc(x.affiliate || 'AF-' + x.affiliate_id)}</a></td>` : ''}<td class="n b">${$c(x.amount_cents)}</td><td class="muted">${esc(x.reason)}</td><td>${esc(x.requested_by)}</td><td>${statusPill(x.status)}${x.decided_by ? ` <small class="muted">${esc(x.decided_by)}</small>` : ''}</td><td class="n">${adjAct(x)}</td></tr>`).join('')}</tbody></table></div>` : '');
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-adjact]'); if (!c) return;
    const note = c.dataset.a === 'decline' ? await A.ask('Decline this adjustment', 'Logged in the audit log.', { label: 'Note', required: false, ok: 'Decline', danger: true }) : '';
    if (note === null) return;
    if (await A.act(c, () => A.POST(`/api/admin/aff/adjustments/${c.dataset.adjact}/${c.dataset.a}`, { note }), c.dataset.a === 'approve' ? 'Approved. The amount is available to the affiliate now.' : 'Declined. Logged.')) A.route();
  });
  /* Custom RevShare deal (owner and program super admins). Above 50% = Special deal: a confirm step first; on Vooads/Replyvoo (or all products)
   * the confirm warns that AI tools cost more. Up to 90%. */
  document.addEventListener('click', async (e) => {
    const en = e.target.closest('[data-rsend]');
    if (en) { const ok = await A.ask('End this custom deal now?', 'New payments go back to the tier rate. Earnings already made keep their rate. Logged in the audit log.', { label: 'Type END to confirm', placeholder: 'END', ok: 'End deal', danger: true }); if (ok === null) return; if (ok.trim().toUpperCase() !== 'END') { VS.toast('Not ended: type END to confirm.', 'err'); return; } if (await A.act(en, () => A.PATCH(`/api/admin/aff/deals/${en.dataset.rsend}`, { status: 'ended' }), 'Deal ended. The affiliate is told.')) A.route(); return; }
    const b = e.target.closest('[data-rsdeal]'); if (!b) return;
    const id = b.dataset.rsdeal;
    const prods = S.cache.products || (await A.api('/api/admin/aff/products').catch(() => ({ products: [] }))).products;
    const AI = ['vooads', 'replyvoo'];
    const today = new Date().toISOString().slice(0, 10); const in30 = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
    const m = A.modal(`${A.mHead('Custom RevShare deal', 'Owner and program super admins only. For this affiliate only, never shown publicly. Up to 50% keeps the product caps; above 50% is a Special deal (up to 90%) and overrides them.')}<form class="vs-modal-b" data-rsf>
      <div class="fgrid"><label class="field"><span class="lbl">Product</span><select class="inp" name="product_key"><option value="*">All products</option>${prods.filter((p) => p.commissionable && !p.locked && p.cap_bp > 0).map((p) => `<option value="${p.key}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="field"><span class="lbl">RevShare %</span><input class="inp" name="rate_pct" type="number" min="1" max="90" step="0.5" required placeholder="60"><span class="hint" data-rshint>Up to 90%. Above 50% is tagged Special deal.</span></label></div>
      <div class="field"><span class="lbl">How long</span><div class="seg" data-rsdur role="radiogroup">${[['forever', 'Forever'], ['until', 'Until a date'], ['range', 'From date to date']].map(([v, l], i) => `<button type="button" role="radio" data-v="${v}" class="${i ? '' : 'on'}" aria-checked="${!i}">${l}</button>`).join('')}</div></div>
      <div class="fgrid"><label class="field" data-rsfrom hidden><span class="lbl">From</span><input class="inp" type="date" name="starts_at" value="${today}" min="${today}"></label><label class="field" data-rsto hidden><span class="lbl">To (last day)</span><input class="inp" type="date" name="ends_at" value="${in30}" min="${today}"></label></div>
      <label class="field"><span class="lbl">Note <em>audit log only</em></span><input class="inp" name="note" maxlength="300" placeholder="Why this deal"></label>
      <div class="sd-confirm" data-rsconfirm hidden><b>${icon('alert')}<span data-rsctitle></span></b><p data-rscwarn></p><p class="muted sm">The affiliate sees a "Special deal" tag on their dashboard, ledger and receipts. It applies to payments from the start date only.</p></div>
      <button class="btn btn-g" type="submit" data-rssubmit>Create deal</button></form>`);
    const f = m.el.querySelector('form'); let dur = 'forever'; let confirmed = false;
    const sync = () => {
      m.el.querySelector('[data-rsfrom]').hidden = dur !== 'range'; m.el.querySelector('[data-rsto]').hidden = dur === 'forever';
      const r = Number(f.rate_pct.value) || 0; const k = f.product_key.value;
      const hint = m.el.querySelector('[data-rshint]');
      hint.textContent = r > 90 ? 'At most 90%.' : r > 50 ? `Special deal ${r}%: overrides the product caps for this affiliate.` : (AI.includes(k) && r > 35 ? 'Up to 50% the normal caps apply: Vooads and Replyvoo stop at 35%.' : 'Up to 90%. Above 50% is tagged Special deal.');
      confirmed = false; m.el.querySelector('[data-rsconfirm]').hidden = true; m.el.querySelector('[data-rssubmit]').textContent = 'Create deal';
    };
    m.el.querySelector('[data-rsdur]').addEventListener('click', (ev) => { const x = ev.target.closest('button'); if (!x) return; dur = x.dataset.v; m.el.querySelectorAll('[data-rsdur] button').forEach((y) => { y.classList.toggle('on', y === x); y.setAttribute('aria-checked', y === x); }); sync(); });
    f.addEventListener('input', sync); f.addEventListener('change', sync);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const r = Number(f.rate_pct.value) || 0; const k = f.product_key.value;
      if (!f.rate_pct.checkValidity() || r <= 0 || r > 90) { VS.toast('RevShare is 1% to 90%.', 'err'); return; }
      if (r > 50 && !confirmed) {
        confirmed = true;
        m.el.querySelector('[data-rsctitle]').textContent = `Special deal: ${r}% RevShare on ${k === '*' ? 'all products' : f.product_key.selectedOptions[0].textContent}`;
        m.el.querySelector('[data-rscwarn]').textContent = (k === '*' || AI.includes(k)) && r > 35 ? 'AI tools cost more — this deal may lose money.' : 'This is above the normal 50% maximum. Check the rate before you confirm.';
        m.el.querySelector('[data-rsconfirm]').hidden = false; m.el.querySelector('[data-rssubmit]').textContent = 'Confirm Special deal';
        return;
      }
      const body = { product_key: k, rate_pct: r, duration: dur, note: f.note.value, confirm: r > 50 };
      if (dur !== 'forever') body.ends_at = f.ends_at.value; if (dur === 'range') body.starts_at = f.starts_at.value;
      if (await A.act(f.querySelector('[data-rssubmit]'), () => A.POST(`/api/admin/aff/affiliates/${id}/revshare-deals`, body), r > 50 ? 'Special deal created. The affiliate is told.' : 'Custom deal created. The affiliate is told.')) { m.close(); A.route(); }
    });
    sync();
  });
  const payTableSmall = (L) => `<div class="tbl-w"><table class="tbl"><thead><tr><th>Requested</th><th class="n">Amount</th><th>Method</th><th>Status</th><th>Receipt</th></tr></thead><tbody>${L.map((p) => `<tr><td>${A.dt(p.requested_at)}</td><td class="n b">${$c(p.amount_cents)}</td><td>${esc(p.method_label)}</td><td>${statusPill(p.status, p.status_label)}</td><td>${p.receipt_url ? `<button class="btn btn-w btn-xs" data-dl="${esc(p.receipt_url)}" data-name="receipt-${esc(p.receipt_no)}.pdf">PDF</button>` : '–'}</td></tr>`).join('')}</tbody></table></div>`;
  const dealReqRow = (x) => `<div class="cv"><span class="cv-t">${A.ds(x.created_at)}<small>#${x.id}</small></span><span class="cv-p">${pi(x.product_key || 'premium', 'sm')}<span><b>${esc(x.model === 'tier_floor' ? 'Tier floor' : x.model === 'cap_raise' ? 'Cap raise' : (x.model === 'hybrid' ? 'Hybrid ' : 'CPA ') + (x.cpa_cents ? $c0(x.cpa_cents) : ''))}${x.product_key ? ' · ' + esc(A.pname(x.product_key, x.plan)) : ''}${x.monthly_cap ? ` · cap ${x.monthly_cap}` : ''}</b><small>${esc(x.display_name || '')} ${esc(x.source === 'affiliate' ? 'asked by the affiliate' : 'proposed by a manager')}${x.reason ? ' · ' + esc(x.reason) : ''}</small></span></span><span class="cv-s">${statusPill(x.status)}${x.needs_owner ? ' <span class="st st-amb">Owner</span>' : ''}</span><span class="cv-a">${x.status === 'pending' && R('admin') ? `<button class="btn btn-g btn-xs" data-dreq="${x.id}" data-act="approve">Approve</button><button class="btn btn-ghost btn-xs" data-dreq="${x.id}" data-act="decline">Decline</button>` : ''}</span></div>`;
  function wireAffiliate(pg, a, d) {
    pg.addEventListener('submit', async (e) => {
      const f = e.target; e.preventDefault();
      const b = f.querySelector('[type=submit]');
      if (f.matches('[data-mgrf]')) { if (await A.act(b, () => A.PUT(`/api/admin/aff/affiliates/${a.id}/managers`, { general_manager_id: Number(f.general_manager_id.value) || null, private_manager_id: Number(f.private_manager_id.value) || null }), 'Managers updated. The affiliate is notified.')) A.route(); }
      if (f.matches('[data-tierf]')) {
        const body = { tier_override: f.tier_override.value === '' ? null : Number(f.tier_override.value), tier_floor: f.tier_floor.value === '' ? null : Number(f.tier_floor.value), floor_until: f.floor_until.value || undefined, health_exempt: f.health_exempt.checked, reason: f.reason.value };
        if (f.legend_approved && f.legend_approved.checked) body.legend_approved = true;
        if (f.status.value) body.status = f.status.value;
        if (await A.act(b, () => A.PATCH(`/api/admin/aff/affiliates/${a.id}`, body), 'Saved and logged in the audit log.')) A.route();
      }
      if (f.matches('[data-notef]')) { if (await A.act(b, () => A.POST(`/api/admin/aff/affiliates/${a.id}/notes`, { body: f.body.value, shared: pg.querySelector('[data-shared]').checked }), 'Note added')) A.route(); }
      if (f.matches('[data-adjf]')) {
        if (f.reason.value.trim().length < 3) { VS.toast('Add a reason. The affiliate sees it on the ledger.', 'err'); return; }
        // The key stays the same for this form until it succeeds, so a retry or double click never adds twice.
        const r = await A.act(b, () => A.POST(`/api/admin/aff/affiliates/${a.id}/adjustments`, { amount_usd: Number(f.amount.value.replace(/[^\d.-]/g, '')), reason: f.reason.value.trim(), idempotency_key: f.dataset.idem }),
          (x) => (x && x.pending_approval ? 'Sent for a second approval. Another finance or admin user has to approve it.' : 'Adjustment added. It is available at once.'));
        if (r) A.route();
      }
    });
    pg.addEventListener('click', async (e) => {
      const cp = e.target.closest('[data-cpapause]');
      if (cp) { const on = cp.dataset.cpapause === '1'; const reason = on ? await A.ask('Pause CPA', 'Logged and shown to the affiliate\'s manager.', { label: 'Reason', placeholder: 'Decline rate over 20%' }) : ''; if (on && !reason) return; if (await A.act(cp, () => A.PATCH(`/api/admin/aff/affiliates/${a.id}`, { cpa_paused: on, reason }), on ? 'CPA paused. Logged.' : 'CPA resumed.')) A.route(); }
    });
  }

  /* ================= Approvals (applications) ================= */
  const LINE_TYPE = { revshare: 'RevShare', cpa: 'CPA', hybrid_cpa: 'Hybrid CPA', sub_override: 'Sub-affiliate earnings', adjustment: 'Adjustment', clawback: 'Reversal', contest_prize: 'Contest prize' };
  const DOC_LABEL = { id_front: 'ID, front', id_back: 'ID, back', selfie: 'Selfie holding the ID', proof_of_address: 'Proof of address', company: 'Company registration' }; // same words the affiliate saw when uploading
  const CHECKS = ['Voo ID older than 30 days', 'Email verified', 'No duplicate signals', 'Country not on block list', 'Links reachable'];
  function appCard(x) {
    const ov = x.sla && x.sla.overdue;
    return `<article class="apc${ov ? ' overdue' : ''}" data-apc="${x.id}"><div class="apc-h">${face(A.avOf(x.avatar, x.name), 'lg')}<div><b>${esc(x.display_name || x.name)}</b><small>${esc(x.name)} · ${esc(x.ref)} · ${A.flag(x.country)} ${esc(x.country)} · ${esc(x.telegram || '')} · sent ${esc(x.age)} ago</small></div><span class="sla-t ${ov ? 'od' : ''}">${icon('clock')}${esc(x.sla ? x.sla.text : '')}</span></div>
      <div class="apc-g"><div><small>Sources</small><b>${esc(x.sources.join(', ') || '–')}</b></div><div><small>Volume</small><b>${esc(x.volume || '–')}</b></div><div><small>Experience</small><b>${esc([x.years, x.verticals.join(', ')].filter(Boolean).join(' · ') || '–')}</b></div><div><small>Geos</small><b>${esc(x.geos.join(', ') || '–')}</b></div></div>
      <p class="apc-n">"${esc(x.plan)}"</p>${x.links.length ? `<p class="apc-l">${x.links.map((l) => `<a href="${esc(l)}" target="_blank" rel="noopener nofollow">${esc(l.replace(/^https?:\/\//, ''))}</a>`).join(' · ')}</p>` : ''}
      ${x.info_request ? `<p class="apc-info">${icon('help')}Asked: ${esc(x.info_request)}</p>` : ''}${(x.info_replies || []).map((r) => `<p class="apc-info ok">${icon('chat')}Reply: ${esc(r.text)}</p>`).join('')}
      <div class="apc-c">${x.checks.map((c) => `<span class="${c.ok ? 'ok' : 'no'}">${icon(c.ok ? 'check' : 'alert')}${esc(c.label)}</span>`).join('')}</div>
      ${x.status === 'pending' ? `<div class="apc-a"><button class="btn btn-g btn-sm" data-appr="approve">${icon('check')}Approve</button><button class="btn btn-w btn-sm" data-appr="info">Ask for info</button><button class="btn btn-danger btn-sm" data-appr="reject">Decline</button>${!roles().admin && !x.escalated ? '<button class="btn btn-ghost btn-sm" data-appr="escalate">Escalate</button>' : x.escalated ? '<span class="st st-amb">Escalated</span>' : ''}${x.general_manager ? `<span class="muted sm">Manager: ${esc(x.general_manager.name)}</span>` : ''}</div>` : `<div class="apc-a">${statusPill(x.status)}${(x.decline_reasons || []).length ? `<span class="muted sm">${esc(x.decline_reasons.join(', '))}</span>` : ''}</div>`}</article>`;
  }
  let APPST = 'pending', APPREASONS = {};
  P.approvals = async () => {
    const d = await A.api('/api/admin/aff/applications?status=' + APPST);
    APPREASONS = d.reasons || {};
    return `<div class="ph"><div><h2>Applications</h2><p>Approve sets Starter from today. Target: a decision within 2 business days.</p></div><div class="seg" data-appst>${[['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Declined']].map(([k, l]) => `<button class="${k === APPST ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div></div>
      ${d.applications.length ? `<div class="apcs">${d.applications.map(appCard).join('')}</div>` : empty('id', APPST === 'pending' ? 'No applications waiting. You are up to date.' : 'Nothing here yet.')}`;
  };
  document.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-appst] button'); if (st) { APPST = st.dataset.v; A.route(); return; }
    const ap = e.target.closest('[data-appr]'); if (!ap) return;
    const card = ap.closest('.apc'); const id = card.dataset.apc; const k = ap.dataset.appr;
    const gone = (cls) => { card.classList.add('gone', cls); setTimeout(() => card.remove(), 450); };
    if (k === 'approve') { if (await A.act(ap, () => A.POST(`/api/admin/aff/applications/${id}/approve`), 'Approved. Welcome email, Telegram and dashboard welcome sent.')) gone('gone-ok'); }
    if (k === 'escalate') { if (await A.act(ap, () => A.POST(`/api/admin/aff/applications/${id}/escalate`), 'Escalated to the program admin')) A.route(); }
    if (k === 'info') { const t = await A.ask('Ask for info', 'Shows in their banner, by email and in Telegram.', { label: 'What do you need?', textarea: true, placeholder: 'Please add a link to your Telegram channel and one recent ad you ran.' }); if (t && await A.act(ap, () => A.POST(`/api/admin/aff/applications/${id}/info`, { text: t }), 'Request sent. Their banner now shows your message.')) A.route(); }
    if (k === 'reject') {
      const m = A.modal(`${A.mHead('Decline application', 'They can apply again after 30 days.')}<form class="vs-modal-b"><div class="radios">${Object.entries(APPREASONS).map(([c, l], i) => `<label class="ck"><input type="checkbox" name="r" value="${c}" ${i === 0 ? 'checked' : ''}><i>${icon('check')}</i><span>${esc(l)}</span></label>`).join('')}</div><label class="field"><span class="lbl">Note <em>optional, shown to them</em></span><textarea class="inp" name="note"></textarea></label><button class="btn btn-danger" type="submit">Decline application</button></form>`);
      m.el.querySelector('form').addEventListener('submit', async (ev) => { ev.preventDefault(); const f = ev.target; const reasons = [...f.querySelectorAll('[name=r]:checked')].map((x) => x.value); if (!reasons.length) { VS.toast('Choose a reason', 'err'); return; } if (await A.act(f.querySelector('button'), () => A.POST(`/api/admin/aff/applications/${id}/reject`, { reasons, note: f.note.value }), 'Declined. They can reapply in 30 days.')) { m.close(); gone(''); } });
    }
  });

  /* ================= CPA review and the one-tap duplicate check ================= */
  const OWNER_RULE = `<div class="rule">${icon('shield')}<div><b>CPA pays only for unique, first-time paying customers.</b><span>Anyone with a Voo ID or account created before the click, or the same person on a second account, earns no CPA. Run the duplicate check on every conversion.</span></div></div>`;
  let REASONS = {}, BULKMAX = 20, CPAST = 'pending';
  P.cpa = async (base) => {
    const d = await A.api('/api/admin/aff/cpa?status=' + CPAST);
    REASONS = d.reasons; BULKMAX = d.bulk_max_risk; S.cache.cpa = d.queue;
    const s = d.stats;
    return `<div class="ph"><div><h2>CPA review queue</h2><p>Highest risk first, then oldest. Bulk approve works only for risk under ${BULKMAX} from one affiliate. Nobody decides their own.</p></div><div class="lb-act"><div class="seg" data-cpast>${[['pending', 'In queue'], ['approved', 'Approved'], ['declined', 'Declined']].map(([k, l]) => `<button class="${k === CPAST ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div>${CPAST === 'pending' ? `<button class="btn btn-w btn-sm" data-bulk disabled>${icon('check')}Approve selected</button>` : ''}</div></div>${OWNER_RULE}
      <div class="astats">${stat('In queue', fmt(s.in_queue))}${stat('Approved today', fmt(s.approved_today))}${stat('Declined today', fmt(s.declined_today))}${stat('CPA at stake', $c0(s.at_stake_cents))}</div>
      <div class="cq">${d.queue.map((c) => qRow(base, c)).join('') || empty('check', CPAST === 'pending' ? 'Queue clear.' : 'Nothing here yet.', CPAST === 'pending' ? 'New CPA conversions appear here as customers qualify.' : '')}</div>`;
  };
  const qRow = (base, c) => `<article class="cqr" data-cq="${c.id}">${c.status === 'pending' ? `<label class="ck sm"><input type="checkbox" data-sel="${c.risk < BULKMAX ? c.affiliate.id : ''}" aria-label="Select ${esc(c.ref)}"><i>${icon('check')}</i></label>` : '<span></span>'}
    <div class="cqr-m">${pi(c.product_key, 'md')}<div><b>${esc(A.pname(c.product_key, c.plan))} · ${$c0(c.amount_cents)} ${c.model === 'hybrid' ? 'Hybrid' : 'CPA'}</b><small><code>${esc(c.ref)}</code> · ${esc(c.customer_ref)} · ${esc(c.affiliate.display_name || c.affiliate.name)} (${esc(c.affiliate.ref)}) · qualified ${A.ds(c.qualified_at)} · in queue ${esc(c.age)}${c.sub1 ? ' · ' + esc(c.sub1) : ''}</small><div class="sigs">${c.verdict ? verdictChip(c.verdict) : ''}${(c.signals || []).map((s) => `<span>${icon('alert')}${esc(s.replace(/_/g, ' '))}</span>`).join('')}${c.status !== 'pending' ? statusPill(c.status) + (c.decline_reason ? ` <span class="muted sm">${esc(c.decline_reason)}</span>` : '') + (c.reviewer ? ` <span class="muted sm">by ${esc(c.reviewer)}</span>` : '') : ''}</div></div></div>
    <div class="cqr-r">${riskChip(c.risk)}${c.status === 'pending' ? `<button class="btn btn-k btn-sm dupbtn" data-dup="${c.id}">${icon('dup')}Duplicate check</button>` : ''}<a class="btn btn-ghost btn-sm" href="#/${base}/check/${c.id}">Open</a></div>
    <div class="dupbox" data-dupbox></div></article>`;
  function dupPanel(id, full) {
    return `<div class="dup ${full ? 'full' : ''}" data-dupfor="${id}"><div class="dup-scan"><i></i></div>
      <div class="dup-h"><b>Duplicate check</b><small>Checks across every Voo ID, payment and device we have seen</small><span class="dup-v" data-v></span></div>
      <div class="dup-l" data-dupl>${Array.from({ length: 6 }, (_, i) => `<div class="dr" style="--i:${i}"><span class="dr-ic"><i class="spin"></i></span><span class="dr-t"><b>Checking…</b><small></small></span><span class="dr-s"></span></div>`).join('')}</div>
      <div class="dup-a" data-acts></div></div>`;
  }
  const LBL = { pre_existing: 'Existing Voo ID before click', prior_payment: 'Paid Zedapex before', email: 'Same email (normalised)', phone: 'Phone number', device: 'Device fingerprint', ip: 'Same IP', subnet: 'Same /24 subnet', payment: 'Payment instrument', telegram: 'Telegram ID', name: 'Name similarity', self_referral: 'Linked to the affiliate', loop: 'Referral loop', velocity: 'Velocity spike', proxy: 'VPN or proxy', disposable: 'Disposable email domain', geo_mismatch: 'Geo mismatch', instant_refund: 'Instant refund', fast_signup: 'Click to sign-up under 5 seconds', code_only: 'No click before sign-up', declined_cluster: 'Previously declined cluster' };
  async function runDup(box, id) {
    let r;
    try { r = await A.POST(`/api/admin/aff/cpa/${id}/check`); } catch (e) { box.querySelector('[data-acts]').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
    const hits = Object.fromEntries((r.signals || []).map((s) => [s.key, s]));
    const keys = [...new Set([...(r.checked || Object.keys(LBL)), ...Object.keys(hits)])];
    const list = box.querySelector('[data-dupl]');
    list.innerHTML = keys.map((k, i) => `<div class="dr" style="--i:${i}" data-k="${k}"><span class="dr-ic"><i class="spin"></i></span><span class="dr-t"><b>${esc((hits[k] && hits[k].label) || LBL[k] || k)}</b><small>${hits[k] ? esc(hits[k].evidence || '') : ''}</small></span><span class="dr-s"></span></div>`).join('');
    const rows = [...list.querySelectorAll('.dr')];
    const stepMs = VS.reduce ? 0 : 90;
    rows.forEach((row, i) => setTimeout(() => {
      const hit = !!hits[row.dataset.k];
      row.classList.add('done', hit ? 'hit' : 'clear');
      row.querySelector('.dr-ic').innerHTML = icon(hit ? 'alert' : 'check');
      row.querySelector('.dr-s').innerHTML = hit ? `<span class="st st-r">Match${hits[row.dataset.k].weight ? ' +' + hits[row.dataset.k].weight : ''}</span>` : '<span class="st st-w">No match</span>';
    }, stepMs * (i + 1)));
    setTimeout(() => {
      box.classList.add('done');
      box.querySelector('[data-v]').innerHTML = verdictChip(r.verdict) + riskChip(r.risk);
      const reason = r.verdict === 'existing' ? (hits.self_referral ? 'self_referral' : 'not_new_customer') : hits.telegram || hits.self_referral ? 'self_referral' : hits.payment ? 'payment_instrument_shared' : 'duplicate_account';
      const matches = (r.matches || []).length ? `<div class="dup-m"><b>Linked accounts</b>${r.matches.map((m) => `<span><code>${esc(m.ref)}</code> ${esc(m.relation || '')} · ${esc((m.kinds || []).join(', '))}${m.paid ? ' · paid before' : ''}</span>`).join('')}</div>` : '';
      box.querySelector('[data-acts]').innerHTML = (r.verdict === 'unique'
        ? `<p class="dup-sum">${icon('check')}No duplicate or existing-customer match${r.email_masked ? ` for ${esc(r.email_masked)}` : ''}${Object.keys(hits).length ? ` (${Object.keys(hits).length} soft signal${Object.keys(hits).length === 1 ? '' : 's'} noted above)` : ''}. First Voo ID and first payment, both after the click.</p><button class="btn btn-g" data-dec="approve" data-id="${id}">${icon('check')}Approve</button><button class="btn btn-ghost btn-sm" data-dec="extend" data-id="${id}">Need more time (+14 days)</button>`
        : `<p class="dup-sum">${icon('alert')}${r.verdict === 'existing' ? 'This person was already a Zedapex customer before the click.' : 'Matches suggest the same person or household.'}${r.email_masked ? ` Customer email ${esc(r.email_masked)}.` : ''}</p>${matches}
          <div class="dec-row"><select class="inp inp-sm" data-reason aria-label="Decline reason">${Object.keys(REASONS).map((k) => `<option value="${k}" ${k === reason ? 'selected' : ''}>${k}</option>`).join('')}</select><button class="btn btn-danger" data-dec="decline" data-id="${id}">${icon('ban')}Decline</button>${r.verdict === 'possible' ? `<button class="btn btn-w btn-sm" data-dec="approve" data-id="${id}">Approve anyway</button><button class="btn btn-ghost btn-sm" data-dec="extend" data-id="${id}">Need more time (+14 days)</button>` : ''}</div>
          <p class="dec-txt" data-dectxt>Affiliate sees: "${esc(REASONS[reason] || '')}"</p>`);
      A.mount(box);
    }, stepMs * (rows.length + 1) + 150);
  }
  P.check = async (base, id) => {
    const d = await A.api('/api/admin/aff/cpa/' + Number(id));
    REASONS = d.reasons; const c = d.conversion;
    const g = c.geo || {};
    const mt = (c.analysis && c.analysis.matches) || [];
    A.then((pg) => { const box = pg.querySelector('.dup.full'); if (box && c.status === 'pending') runDup(box, c.id); });
    return `<a class="back" href="#/${base}/${base === 'admin' ? 'cpa' : 'queue'}">${icon('left')}Review queue</a>${OWNER_RULE}
      <section class="card ckh"><div class="ckh-l">${pi(c.product_key, 'lg')}<div><h2>${esc(A.pname(c.product_key, c.plan))} · ${$c0(c.amount_cents)} ${c.model === 'hybrid' ? 'Hybrid' : 'CPA'}</h2><p class="muted"><code>${esc(c.ref)}</code> · customer ${esc(c.customer_ref)} · ${esc(c.email_masked || '')} · affiliate <b>${esc(c.affiliate.display_name || c.affiliate.name)}</b> ${esc(c.affiliate.ref)}</p></div></div><div class="ckh-r">${riskChip(c.risk)}${c.status !== 'pending' ? statusPill(c.status) : ''}</div></section>
      <div class="g-2-1"><div>${c.status === 'pending' ? dupPanel(c.id, true) : `<section class="card">${statusPill(c.status)} ${c.decline_reason ? esc(c.decline_reason) + ' · ' : ''}${c.reviewer ? 'by ' + esc(c.reviewer) + ' · ' : ''}${A.dtm(c.decided_at)}${c.note ? `<p class="muted">${esc(c.note)}</p>` : ''}</section>`}</div>
        <div class="stack"><section class="card"><div class="card-h"><h3>Timeline</h3></div><ol class="tl">${c.timeline.map((t) => `<li class="done"><i></i><b>${esc(t.label)}</b><small>${A.dtm(t.at)}${t.detail ? ' · ' + esc(t.detail) : ''}</small></li>`).join('')}</ol></section>
          <section class="card"><div class="card-h"><h3>Countries</h3></div><div class="geo3">${[['Click', g.click], ['Profile', g.profile], ['Payment', g.payment]].map((x) => `<div class="${x[1] && g.click && x[1] !== g.click ? 'mis' : ''}"><small>${x[0]}</small><b>${x[1] ? A.flag(x[1]) + ' ' + esc(x[1]) : '–'}</b></div>`).join('')}</div>${new Set([g.click, g.profile, g.payment].filter(Boolean)).size > 1 ? '<p class="err sm">Geo mismatch</p>' : '<p class="muted sm">No mismatch</p>'}</section>
          <section class="card"><div class="card-h"><h3>Linked accounts</h3></div>${mt.length ? `<svg class="cluster" viewBox="0 0 300 170" aria-label="Linked accounts"><g class="cl-e">${mt.slice(0, 3).map((n, i) => `<line x1="150" y1="85" x2="${[50, 250, 150][i]}" y2="${[40, 40, 150][i]}"/>`).join('')}</g><circle cx="150" cy="85" r="22" class="cl-c"/><text x="150" y="89" text-anchor="middle" class="cl-t">${esc(c.customer_ref)}</text>${mt.slice(0, 3).map((n, i) => `<g transform="translate(${[50, 250, 150][i]} ${[40, 40, 150][i]})"><circle r="16" class="cl-n"/><text y="-22" text-anchor="middle" class="cl-t">${esc(n.ref)}</text><text y="30" text-anchor="middle" class="cl-s">${esc((n.kinds || []).join(', '))}</text></g>`).join('')}</svg>` : '<p class="muted sm">No linked accounts.</p>'}</section>
          <section class="card"><div class="card-h"><h3>Affiliate</h3></div><div class="mg-g">${face(A.avOf(c.affiliate.avatar, c.affiliate.name), 'sm')}<span><b>${esc(c.affiliate.display_name || c.affiliate.name)}</b> · ${tierBadge(c.affiliate.tier, 'sm')}</span></div><div class="lb-act"><a class="btn btn-w btn-xs" href="#/${base === 'fraud' ? 'fraud/flags' : 'admin/affiliate/' + c.affiliate.id}">${icon('flag')}${base === 'fraud' ? 'Flagged affiliates' : 'Open affiliate'}</a></div></section></div></div>`;
  };
  document.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-cpast] button'); if (st) { CPAST = st.dataset.v; A.route(); return; }
    const d = e.target.closest('[data-dup]');
    if (d) {
      const row = d.closest('.cqr'), box = row.querySelector('[data-dupbox]');
      if (row.classList.contains('open')) { row.classList.remove('open'); box.innerHTML = ''; return; }
      row.classList.add('open'); box.innerHTML = dupPanel(d.dataset.dup); A.mount(box); runDup(box.firstElementChild, d.dataset.dup);
    }
    const dec = e.target.closest('[data-dec]');
    if (dec) {
      const id = dec.dataset.id, kind = dec.dataset.dec;
      const reason = (dec.closest('.dup') || document).querySelector('[data-reason]');
      let note = '';
      if (kind === 'decline') note = await A.ask('Decline this CPA', `Reason: ${reason.value}. The affiliate sees the reason text.`, { label: 'Internal note', placeholder: 'What you found', required: false, ok: 'Decline', danger: true });
      if (kind === 'decline' && note === null) return;
      const r = await A.act(dec, () => A.POST(`/api/admin/aff/cpa/${id}/${kind}`, kind === 'decline' ? { reason: reason.value, note } : { note: kind === 'extend' ? 'Need more time' : '' }), kind === 'approve' ? 'Approved. Available to the affiliate now (unless a CPA hold is set). Affiliate notified.' : kind === 'extend' ? 'Marked for more review time. Logged.' : `Declined: ${reason && reason.value}. Affiliate notified with the reason.`);
      if (!r) return;
      const row = dec.closest('.cqr');
      if (row) { row.classList.add('gone', kind === 'approve' ? 'gone-ok' : 'gone-no'); setTimeout(() => A.route(), 500); } else setTimeout(() => { location.hash = S.role === 'admin' ? '#/admin/cpa' : '#/fraud/queue'; }, 500);
    }
    if (e.target.closest('[data-bulk]')) {
      const b = e.target.closest('[data-bulk]'); const ids = [...document.querySelectorAll('[data-sel]:checked')].map((x) => Number(x.closest('.cqr').dataset.cq));
      if (await A.act(b, () => A.POST('/api/admin/aff/cpa/bulk-approve', { ids }), (r) => `Approved ${r.approved} in bulk. Logged.`)) A.route();
    }
  });
  document.addEventListener('change', (e) => {
    const s = e.target.closest('[data-sel]');
    if (s) { const sel = [...document.querySelectorAll('[data-sel]:checked')]; const affs = new Set(sel.map((x) => x.dataset.sel)); const ok = sel.length && !affs.has('') && affs.size === 1; const b = document.querySelector('[data-bulk]'); if (b) { b.disabled = !ok; b.title = ok ? '' : `Bulk approve needs risk under ${BULKMAX} and one affiliate`; } if (sel.length && !ok) VS.toast(`Bulk approve needs risk under ${BULKMAX} and one affiliate`, 'err'); }
    const r = e.target.closest('[data-reason]'); if (r) { const t = r.closest('.dup').querySelector('[data-dectxt]'); if (t) t.textContent = `Affiliate sees: "${REASONS[r.value] || ''}"`; }
  });

  P.signals = async () => {
    const d = await A.api('/api/admin/aff/fraud/signals');
    const ICON = { velocity: 'bolt', proxy: 'globe', disposable: 'mail', device: 'finger', geo_mismatch: 'flag', instant_refund: 'refresh', payment: 'card', fast_signup: 'clock' };
    const top = d.cards.flatMap((c) => c.affiliates || []).sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    let vel = '';
    if (top) { try { const v = await A.api(`/api/admin/aff/fraud/velocity/${top.id}`); vel = `<section class="card"><div class="card-h"><h3>Sign-ups per day · ${esc(top.name)}</h3><span class="sub">Last 21 days</span></div>${A.area(v.series.map((x) => ({ x: A.dayLabel(x.day), v: x.signups })), { fmtv: (x) => fmt(x) + ' sign-ups', color: '#D9362E', h: 200, label: 'Velocity' })}</section>`; } catch { /* none */ } }
    return `<div class="ph"><div><h2>Fraud signals</h2><p>Last 30 days. Each signal adds to a conversion's risk score; weights are in Program settings.</p></div></div>${vel}
      <div class="sig-g">${d.cards.map((c) => `<section class="card sgc sg-${c.count ? (c.count > 5 ? 'r' : 'amb') : 'g'}"><div class="sgc-h"><span>${icon(ICON[c.key] || 'alert')}</span><b>${esc(c.label)}</b><em>${fmt(c.count)}</em></div>${(c.affiliates || []).length ? `<ul>${c.affiliates.map((x) => `<li><a href="#/${S.role === 'admin' ? 'admin' : 'fraud'}/${S.role === 'admin' ? 'affiliate/' + x.id : 'flags'}">${esc(x.name)}</a> · ${esc(String(x.value))}</li>`).join('')}</ul>` : '<p class="muted sm">None.</p>'}</section>`).join('')}</div>`;
  };
  P.flags = async () => {
    const d = await A.api('/api/admin/aff/fraud/flags');
    return `<div class="ph"><div><h2>Flagged affiliates</h2><p>Decline rate over 20% in 30 days pauses CPA automatically and alerts the manager.</p></div></div>
      <section class="card">${d.flags.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Affiliate</th><th class="n">Fraud score</th><th class="n">CPA decline rate</th><th>State</th><th>Why</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${d.flags.map((r) => `<tr><td>${who(r)}</td><td class="n">${riskChip(r.fraud_score)}</td><td class="n">${fmt(r.decline_rate || 0)}%</td><td><span class="st ${/paused/i.test(r.state) ? 'st-r' : 'st-amb'}">${esc(r.state)}</span></td><td class="muted">${esc(r.why)}</td><td class="n"><button class="btn btn-w btn-xs" data-claw="${r.id}">Fraud reversal</button></td></tr>`).join('')}</tbody></table></div>` : empty('flag', 'No flagged affiliates.')}</section>`;
  };
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-claw]'); if (!c) return;
    const ledger = await A.api(`/api/admin/aff/affiliates/${c.dataset.claw}`).catch(() => null); void ledger;
    const m = A.modal(`${A.mHead('Propose a fraud reversal', 'For proven fraud or a terms breach only. Earnings are otherwise final. Finance approves it; a different person than you.')}<form class="vs-modal-b"><label class="field"><span class="lbl">Commission IDs</span><input class="inp mono" name="ids" placeholder="1201, 1202" required></label><label class="field"><span class="lbl">Reason and evidence <em>audit logged, not shown to the affiliate</em></span><textarea class="inp" name="reason" required></textarea></label><button class="btn btn-danger" type="submit">Propose reversal</button></form>`);
    m.el.querySelector('form').addEventListener('submit', async (ev) => { ev.preventDefault(); const f = ev.target; if (await A.act(f.querySelector('button'), () => A.POST('/api/admin/aff/clawbacks', { affiliate_id: Number(c.dataset.claw), commission_ids: f.ids.value.split(/[,\s]+/).map(Number).filter(Boolean), reason: f.reason.value }), 'Fraud reversal proposed to Finance')) m.close(); });
  });
  P.clawbacks = async () => {
    const d = await A.api('/api/admin/aff/clawbacks');
    return `<div class="ph"><div><h2>Fraud reversals</h2><p>Commission is final once earned; only proven fraud or a terms breach reverses it here (chargebacks reverse on their own). Proposed by fraud check, approved by finance. The approver may not be the proposer. Amounts already paid become owed and come off the next payout.</p></div></div>
      <section class="card">${d.clawbacks.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>#</th><th>Affiliate</th><th class="n">Amount</th><th>Reason</th><th>Proposed by</th><th>Status</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${d.clawbacks.map((x) => `<tr><td>${x.id}</td><td>AF-${x.affiliate_id}</td><td class="n b">${$c(x.amount_cents || 0)}</td><td class="muted">${esc(x.reason || '')}</td><td>${esc(x.proposer || '')}</td><td>${statusPill(x.status)}</td><td class="n">${x.status === 'pending' && R('finance') ? `<button class="btn btn-g btn-xs" data-clawact="${x.id}" data-a="approve">Approve</button><button class="btn btn-ghost btn-xs" data-clawact="${x.id}" data-a="reject">Reject</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('refresh', 'No clawbacks proposed.')}</section>`;
  };
  document.addEventListener('click', async (e) => { const c = e.target.closest('[data-clawact]'); if (c && await A.act(c, () => A.POST(`/api/admin/aff/clawbacks/${c.dataset.clawact}/${c.dataset.a}`), c.dataset.a === 'approve' ? 'Reversal executed. Logged.' : 'Reversal rejected. Logged.')) A.route(); });

  /* ================= Deals and products ================= */
  P.deals = async () => {
    const [d, ch, rq, cd] = await Promise.all([A.api('/api/admin/aff/products'), A.api('/api/admin/aff/offer-changes'), A.api('/api/admin/aff/deal-requests?status=pending').catch(() => ({ requests: [] })), A.api('/api/admin/aff/revshare-deals').catch(() => ({ deals: [] }))]);
    S.cache.products = d.products;
    A.then((pg) => pg.addEventListener('submit', async (e) => {
      const f = e.target; e.preventDefault(); const b = f.querySelector('[type=submit]');
      if (f.matches('[data-prodf]')) {
        const capIn = pg.querySelector(`[name=cap_pct][form="${f.id}"]`);
        if (capIn && !capIn.checkValidity()) { VS.toast(`The RevShare cap is 0% to ${capIn.max}%.`, 'err'); capIn.focus(); return; }
        const body = { commissionable: f.commissionable.checked, cap_pct: Number(f.cap_pct.value), hold_days: Number(f.hold_days.value), cpa_hold_days: Number(f.cpa_hold_days.value), qualification: f.qualification.value, monthly_cap: Number(f.monthly_cap.value) };
        if (f.cpa_usd.value !== '') body.cpa_usd = Number(f.cpa_usd.value.replace(/[^\d.]/g, ''));
        const r = await A.act(b, () => A.PUT('/api/admin/aff/products/' + f.dataset.prodf, body), (x) => (x.scheduled && x.scheduled.length ? 'Saved. Reductions are scheduled with notice; affiliates are told now.' : 'Saved.'));
        if (r) A.route();
      }
      if (f.matches('[data-planf]')) {
        const r = await A.act(b, () => A.PUT(`/api/admin/aff/products/${f.dataset.planf}/plans`, { plan: f.plan.value, price_usd: Number(String(f.price_usd.value).replace(/[^\d.]/g, '')) }), 'Plan price saved. Tools cannot change it.');
        if (r) A.route();
      }
      if (f.matches('[data-schf]')) { if (await A.act(b, () => A.POST('/api/admin/aff/offer-changes', { scope: 'program', product_key: f.product_key.value, cpa_usd: Number(f.cpa_usd.value.replace(/[^\d.]/g, '')), effective_at: f.effective_at.value }), 'Scheduled. Affected affiliates are notified.')) A.route(); }
    }));
    return `<div class="ph"><div><h2>Deals and products</h2><p>Plan prices are yours: a tool's first plan event adds a plan as provisional, after that only an admin changes a price (Plan catalogue below). Suggested CPA is a hint (one month of the list price, never above it, at most $300); you decide every CPA amount. Caps protect margins and are hard-locked: Vooads and Replyvoo at most 35%, every other product at most 50%. Affleego is not part of the affiliate program. CPA reductions are scheduled at least 14 days ahead; cap reductions 30 days.</p></div></div>
      <section class="card"><div class="tbl-w"><table class="tbl deals"><thead><tr><th>Product</th><th class="c">Commissionable</th><th class="n">RevShare cap</th><th class="n">Default CPA</th><th class="n">Suggested</th><th class="n" title="Extra hold days for this product. 0 = instant (program default)">Hold</th><th class="n" title="Extra hold after CPA approval. 0 = available once approved">CPA hold</th><th>Qualifies at</th><th class="n">Monthly cap</th><th>Last plan event</th><th><span class="sr">Save</span></th></tr></thead><tbody>
      ${d.products.map((p) => `<tr class="${p.locked ? 'excl-r' : ''}"><td><span class="tp">${pi(p.key, 'xs')}<b>${esc(p.name)}</b></span></td>${p.locked ? `<td class="c"><label class="switch"><input type="checkbox" disabled aria-label="Commissionable"><i></i></label></td><td class="n">0%</td><td colspan="8" class="muted sm">Excluded by program rule. Cannot be enabled.</td>` : `<td class="c"><label class="switch"><input type="checkbox" name="commissionable" form="pf-${p.key}" ${p.commissionable ? 'checked' : ''} aria-label="Commissionable"><i></i></label></td>
        <td class="n"><span class="cap-in"><input class="inp inp-xs" type="number" name="cap_pct" form="pf-${p.key}" value="${p.cap_pct}" min="0" max="${(p.cap_max_bp ?? 5000) / 100}" step="0.5" required title="0% to ${(p.cap_max_bp ?? 5000) / 100}%${(p.cap_max_bp ?? 5000) < 5000 ? ' (AI-heavy tool, hard cap)' : ''}" aria-label="Cap percent, at most ${(p.cap_max_bp ?? 5000) / 100}%">%</span><small class="muted cap-max">max ${(p.cap_max_bp ?? 5000) / 100}%</small></td><td class="n"><input class="inp inp-xs" name="cpa_usd" form="pf-${p.key}" value="${p.cpa_cents ? p.cpa_cents / 100 : ''}" placeholder="Off" aria-label="Default CPA in USD"></td><td class="n muted">${p.suggested_cpa_cents ? $c0(p.suggested_cpa_cents) : '–'}</td>
        <td class="n"><input class="inp inp-xs" type="number" name="hold_days" form="pf-${p.key}" value="${p.hold_days}" aria-label="Hold days"></td><td class="n"><input class="inp inp-xs" type="number" name="cpa_hold_days" form="pf-${p.key}" value="${p.cpa_hold_days}" aria-label="CPA hold days"></td>
        <td><select class="inp inp-xs" name="qualification" form="pf-${p.key}" aria-label="Qualification"><option value="first" ${p.qualification !== 'second' ? 'selected' : ''}>First payment</option><option value="second" ${p.qualification === 'second' ? 'selected' : ''}>Second payment (stricter)</option></select></td><td class="n"><input class="inp inp-xs" type="number" name="monthly_cap" form="pf-${p.key}" value="${p.monthly_cap}" aria-label="Monthly CPA cap"></td><td class="muted sm">${p.last_sync ? A.ago(p.last_sync) + ' ago' : 'None yet'}</td><td><form id="pf-${p.key}" data-prodf="${p.key}"><button class="btn btn-k btn-xs" type="submit">Save</button></form></td>`}</tr>`).join('')}</tbody></table></div></section>
      ${planCatalogue(d.products)}
      <div class="g-2"><section class="card"><div class="card-h"><h3>Schedule a CPA change</h3></div><form data-schf><div class="fgrid"><label class="field"><span class="lbl">Offer</span><select class="inp" name="product_key">${d.products.filter((p) => !p.locked).map((p) => `<option value="${p.key}">${esc(p.name)}${p.cpa_cents ? ' · ' + $c0(p.cpa_cents) : ''}</option>`).join('')}</select></label><label class="field"><span class="lbl">New CPA (USD)</span><input class="inp" name="cpa_usd" inputmode="decimal" required placeholder="60"></label>
          <label class="field"><span class="lbl">Effective date</span><input class="inp" type="date" name="effective_at" required value="${new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10)}"><span class="hint">Reductions: at least 14 days ahead. Increases can apply today.</span></label></div><button class="btn btn-k btn-sm" type="submit">Schedule change</button></form></section>
        <section class="card"><div class="card-h"><h3>Scheduled and recent</h3></div>${ch.changes.length ? ch.changes.slice(0, 12).map((r) => `<div class="chg"><b>${esc(A.brand(r.product_key).name)}${r.display_name ? ' · ' + esc(r.display_name) : ''}</b><span>${esc(r.field)} ${r.field === 'cpa' ? `${$c0(Number(r.old_value))} → ${$c0(Number(r.new_value))}` : `${esc(String(r.old_value))} → ${esc(String(r.new_value))}`}</span><small>Effective ${A.dt(r.effective_at)}${r.applied_at ? ' · applied' : ''}</small></div>`).join('') : '<p class="muted sm">No changes yet.</p>'}</section></div>
      <section class="card" id="custom-deals"><div class="card-h"><h3>Custom RevShare deals</h3><span class="sub">Set by the owner or a program super admin on one affiliate's page (Custom RevShare). Above 50% is tagged Special deal. Only that affiliate and the team see them.</span></div>
        ${cd.deals.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Affiliate</th><th>Product</th><th class="n">RevShare</th><th>Tag</th><th>Window</th></tr></thead><tbody>${cd.deals.map((x) => `<tr><td><a href="#/admin/affiliate/${x.affiliate_id}">${esc(x.affiliate || 'AF-' + x.affiliate_id)}</a></td><td>${x.all_products ? 'All products' : `<span class="tp">${pi(x.product_key, 'xs')}${esc(A.pname(x.product_key))}</span>`}</td><td class="n b">${pct(x.rate_bp)}</td><td>${x.special ? A.sdTag(x, true) : '<span class="sd-tag cu sm">Custom deal</span>'}</td><td>${esc(A.dealWhen({ ...x, live: (x.starts_at || 0) <= Date.now() }))}</td></tr>`).join('')}</tbody></table></div>` : empty('percent', 'No custom RevShare deals running.')}</section>
      <section class="card"><div class="card-h"><h3>Deal requests waiting</h3><span class="sub">From affiliates and managers. Above program limits only the owner approves.</span></div>${rq.requests.length ? `<div class="conv">${rq.requests.map(dealReqRow).join('')}</div>` : empty('percent', 'No requests waiting.')}</section>`;
  };
  /* Plan catalogue: admin-owned list prices. Tools' plan events only report what a customer paid; a difference is flagged here. */
  function planCatalogue(products) {
    const list = products.filter((p) => !p.locked);
    // On phones (≤760px) each plan row becomes a stacked card (SV-2); data-l labels each value there.
    const rows = (p) => (p.plans || []).map((x) => `<tr><td class="pc-name" data-l="Plan"><b>${esc(x.plan)}</b></td>
      <td class="pc-st" data-l="Status">${x.confirmed ? '<span class="st st-g">Confirmed</span>' : '<span class="st st-amb">Provisional (from the tool)</span>'}${x.mismatch_count ? ` <span class="st st-amb" title="Plan events whose amount differed from this price since the last review">${x.mismatch_count} different amount${x.mismatch_count === 1 ? '' : 's'}</span>` : ''}</td>
      <td class="n muted" data-l="Last paid">${x.reported_cents ? $c(x.reported_cents) : '–'}<small class="muted">${x.reported_at ? ' · ' + A.ago(x.reported_at) + ' ago' : ''}</small></td>
      <td class="n muted" data-l="Suggested CPA">${x.suggested_cpa_cents ? $c0(x.suggested_cpa_cents) : '–'}</td>
      <td class="pc-price" data-l="List price / month"><form data-planf="${p.key}" class="pc-f"><input type="hidden" name="plan" value="${esc(x.plan)}"><input class="inp inp-xs" name="price_usd" inputmode="decimal" value="${x.price_cents / 100}" aria-label="${esc(x.plan)} list price per month in USD" required><button class="btn btn-k btn-xs" type="submit">${x.confirmed && !x.mismatch_count ? 'Save' : 'Confirm'}</button><button class="btn btn-ghost btn-xs" type="button" data-planrm="${p.key}" data-plan="${esc(x.plan)}" aria-label="Remove ${esc(x.plan)}">Remove</button></form></td></tr>`).join('');
    const review = list.reduce((n, p) => n + (p.plans_to_review || 0), 0);
    return `<section class="card" id="plan-catalogue"><div class="card-h"><h3>Plan catalogue</h3><span class="sub">The list price per month affiliates see on Offers, used for the suggested CPA and contest points. ${review ? `<b>${review} to review.</b>` : 'Nothing to review.'} Name plans exactly as the tool sends them.</span></div>
      ${list.map((p) => `<div class="pc-prod"><h4><span class="tp">${pi(p.key, 'xs')}${esc(p.name)}</span></h4>${(p.plans || []).length ? `<div class="tbl-w pc-w"><table class="tbl pc-tbl"><thead><tr><th>Plan</th><th>Status</th><th class="n">Last paid amount reported</th><th class="n">Suggested CPA</th><th>List price (USD / month)</th></tr></thead><tbody>${rows(p)}</tbody></table></div>` : '<p class="muted sm">No plans yet. They appear when the tool sends its first plan event, or add one.</p>'}
        <form data-planf="${p.key}" class="pc-f pc-add"><input class="inp inp-xs" name="plan" placeholder="Plan name" aria-label="New plan name for ${esc(p.name)}" required maxlength="60"><input class="inp inp-xs" name="price_usd" inputmode="decimal" placeholder="Price" aria-label="New plan price in USD" required><button class="btn btn-w btn-xs" type="submit">Add plan</button></form></div>`).join('')}</section>`;
  }
  document.addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-planrm]');
    if (rm) { if (await A.act(rm, () => A.DEL(`/api/admin/aff/products/${rm.dataset.planrm}/plans?plan=${encodeURIComponent(rm.dataset.plan)}`), 'Plan removed.')) A.route(); return; }
  });
  document.addEventListener('click', async (e) => {
    const dr = e.target.closest('[data-dreq]');
    if (dr) { const note = dr.dataset.act === 'decline' ? await A.ask('Decline this request', '', { label: 'Note to the manager or affiliate', required: false, ok: 'Decline', danger: true }) : ''; if (note === null) return; if (await A.act(dr, () => A.POST(`/api/admin/aff/deal-requests/${dr.dataset.dreq}/${dr.dataset.act}`, { note }), dr.dataset.act === 'approve' ? 'Approved. The deal is live.' : 'Declined.')) A.route(); }
    const nd = e.target.closest('[data-newdeal],[data-reqdeal]');
    if (nd) {
      const req = !!nd.dataset.reqdeal; const id = nd.dataset.newdeal || nd.dataset.reqdeal;
      const prods = S.cache.products || (await A.api('/api/admin/aff/products').catch(() => ({ products: [] }))).products;
      const m = A.modal(`${A.mHead(req ? 'Request a custom deal' : 'New custom deal', req ? 'Goes to the program admin. Limits: RevShare up to the product cap, CPA up to $300.' : 'Within program limits. Increases apply today and are announced.')}<form class="vs-modal-b"><div class="fgrid"><label class="field"><span class="lbl">Product</span><select class="inp" name="product_key">${prods.filter((p) => p.commissionable && !p.locked).map((p) => `<option value="${p.key}" data-capmax="${(p.cap_max_bp ?? 5000) / 100}">${esc(p.name)}</option>`).join('')}</select></label><label class="field"><span class="lbl">Model</span><select class="inp" name="model"><option value="cpa">CPA</option><option value="hybrid">Hybrid</option>${req ? '<option value="tier_floor">Tier floor</option><option value="cap_raise">Cap raise</option>' : ''}</select></label>
        <label class="field"><span class="lbl">Plan <em>optional</em></span><input class="inp" name="plan" placeholder="Pro"></label><label class="field"><span class="lbl">CPA amount (USD)</span><input class="inp" name="cpa_usd" inputmode="decimal" placeholder="120"></label><label class="field"><span class="lbl">Hybrid RevShare % <em>hybrid only</em></span><input class="inp" name="rate_pct" type="number" min="0" max="50" step="0.5" placeholder="10"><span class="hint" data-capmax-hint></span></label><label class="field"><span class="lbl">Monthly cap</span><input class="inp" name="monthly_cap" inputmode="numeric" value="50"></label>
        <label class="field"><span class="lbl">Traffic <em>comma separated</em></span><input class="inp" name="traffic" placeholder="Meta ads, Telegram"></label><label class="field"><span class="lbl">Geos</span><input class="inp" name="geos" placeholder="NG, GH"></label></div>${req ? '<label class="field"><span class="lbl">Why</span><textarea class="inp" name="reason" required></textarea></label>' : ''}<button class="btn btn-g" type="submit">${req ? 'Send for approval' : 'Create deal'}</button></form>`);
      const syncCap = () => { const f = m.el.querySelector('form'); const o = f.product_key.selectedOptions[0]; const mx = o ? o.dataset.capmax : '50'; f.rate_pct.max = mx; m.el.querySelector('[data-capmax-hint]').textContent = `At most ${mx}% on this product (hard cap).`; };
      m.el.querySelector('[name=product_key]').addEventListener('change', syncCap); syncCap();
      m.el.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault(); const f = ev.target; if (!f.rate_pct.checkValidity()) { VS.toast(`Hybrid RevShare is at most ${f.rate_pct.max}% on this product.`, 'err'); return; } const list = (v) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
        const body = { product_key: f.product_key.value, model: f.model.value, plan: f.plan.value, cpa_usd: Number(f.cpa_usd.value) || 0, rate_pct: Number(f.rate_pct.value) || 0, monthly_cap: Number(f.monthly_cap.value) || 0, traffic: list(f.traffic.value), geos: list(f.geos.value.toUpperCase()), ...(req ? { reason: f.reason.value } : {}) };
        if (await A.act(f.querySelector('button'), () => A.POST(`/api/admin/aff/affiliates/${id}/${req ? 'deal-requests' : 'deals'}`, body), req ? 'Sent for approval' : 'Deal created')) { m.close(); A.route(); }
      });
    }
  });
  P.requests = async () => {
    const d = await A.api('/api/admin/aff/deal-requests');
    return `<div class="ph"><div><h2>Deal requests</h2><p>Custom deals for your partners and requests from them.</p></div></div><section class="card">${d.requests.length ? `<div class="conv">${d.requests.map(dealReqRow).join('')}</div>` : empty('percent', 'No deal requests yet.', 'Request one from a partner page.')}</section>`;
  };

  /* ================= Contests ================= */
  let CED = null;
  P.contests = async (base, arg) => {
    const d = await A.api('/api/admin/aff/contests');
    const id = Number(arg) || 0;
    if (id) return contestAdmin(base, id);
    const T = A.tiers();
    CED = { banner: '' };
    A.then((pg) => wireContestForm(pg));
    const today = new Date(); const next1 = new Date(today.getFullYear(), today.getMonth() + 1, 1); const nextEnd = new Date(today.getFullYear(), today.getMonth() + 2, 0);
    const iso = (x) => x.toISOString().slice(0, 10);
    return `<div class="ph"><div><h2>Contests</h2><p>Build, run and close contests. Two staff sign off results before prizes are created.</p></div></div>
      <div class="g-2-1"><section class="card cb"><div class="card-h"><h3>New contest</h3></div><form data-ctf>
        <div class="fgrid"><label class="field"><span class="lbl">Name</span><input class="inp" name="title" required data-cbn placeholder="Monthly FTD Race"></label><label class="field"><span class="lbl">Type</span><select class="inp" name="kind"><option value="monthly">Monthly</option><option value="launch">Product launch</option><option value="geo">New geo</option><option value="custom">Custom</option></select></label>
        <label class="field"><span class="lbl">Starts</span><input class="inp" type="date" name="starts_at" value="${iso(next1)}" required></label><label class="field"><span class="lbl">Ends</span><input class="inp" type="date" name="ends_at" value="${iso(nextEnd)}" required></label></div>
        <label class="field"><span class="lbl">One line</span><input class="inp" name="description" maxlength="300" placeholder="1 point per qualified FTD on any product." data-cbd></label>
        <div class="field"><span class="lbl">Eligible products <em>none = all</em></span><div class="chipset" data-chips="cprod">${['premium', 'spyvoo', 'joinvoo', 'vooads', 'replyvoo', 'castvoo', 'landvoo'].map((k) => `<button type="button" data-v="${k}" aria-pressed="false">${esc(A.brand(k).short || A.brand(k).name)}</button>`).join('')}</div></div>
        <div class="fgrid"><label class="field"><span class="lbl">Points per qualified FTD</span><input class="inp" name="points" value="1" inputmode="numeric"></label><label class="field"><span class="lbl">Plans from $99/mo score</span><input class="inp" name="plan_points" value="3" inputmode="numeric"></label><label class="field"><span class="lbl">Minimum to place</span><input class="inp" name="min_points" value="5" inputmode="numeric"></label><label class="field"><span class="lbl">Extra days after the end <em>0 = final at the end</em></span><input class="inp" name="qual_days" value="0" inputmode="numeric"></label>
          <label class="field"><span class="lbl">Geos <em>optional</em></span><input class="inp" name="geos" placeholder="CI, SN, TZ"></label><label class="field"><span class="lbl">Minimum tier</span><select class="inp" name="min_tier">${T.map((t, i) => `<option value="${i}">${esc(t.n)}</option>`).join('')}</select></label><label class="field"><span class="lbl">Accent colour</span><input class="inp" type="color" name="accent" value="#C9F65B"></label></div>
        <div class="field"><span class="lbl">Prize table (USD)</span><div class="prz-ed" data-prizes>${[['1st', 1, 1, 1500], ['2nd', 2, 2, 1000], ['3rd', 3, 3, 700], ['4th to 10th', 4, 10, 200]].map((p) => `<span><small>${p[0]}</small><input class="inp inp-xs" data-pz="${p[1]}-${p[2]}" data-lbl="${p[0]}" value="${p[3]}" inputmode="decimal" aria-label="${p[0]} prize"></span>`).join('')}<span><small>Rising prize</small><input class="inp inp-xs" name="rising" value="400" inputmode="decimal" aria-label="Rising prize"></span></div></div>
        <div class="field"><span class="lbl">Banner image</span><label class="drop">${icon('image')}<b data-bannerst>Add a banner (PNG or JPG)</b><small>Shown on the contest card and page</small><input type="file" accept="image/*" data-banner hidden></label></div>
        <div class="lb-act"><label class="switch"><input type="checkbox" name="multipliers" checked><i></i>Tier multipliers on main board</label><label class="switch"><input type="checkbox" name="announce" checked><i></i>Announce in app, email and Telegram</label><label class="switch"><input type="checkbox" name="published" checked><i></i>Visible to affiliates</label></div>
        <label class="field"><span class="lbl">Rules <em>optional, shown on the page</em></span><textarea class="inp" name="rules"></textarea></label>
        <button class="btn btn-g btn-sm" type="submit">Schedule contest</button></form></section>
        <section class="card cpv"><div class="card-h"><h3>Preview</h3></div><div class="cpv-c" data-cpv><span class="ct-live"><i class="live-dot"></i><span data-cps>Starts ${A.ds(next1.getTime())}</span></span><b data-cbp>New contest</b><small data-cbpd>Prize pool shows here</small>${A.podium([])}</div></section></div>
      <section class="card"><div class="card-h"><h3>All contests</h3></div>${d.contests.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Contest</th><th>Dates</th><th class="n">Entrants</th><th class="n">Pool</th><th>Status</th><th>Fraud removals</th><th><span class="sr">Open</span></th></tr></thead><tbody>${d.contests.map((c) => `<tr><td><b>${esc(c.title)}</b>${c.published ? '' : ' <span class="pill pill-w">Hidden</span>'}</td><td>${A.ds(c.starts_at)} to ${A.ds(c.ends_at)}</td><td class="n">${fmt(c.entrants || 0)}</td><td class="n">${$c0(c.pool_cents)}</td><td>${statusPill(c.cancelled ? 'cancelled' : c.status)}</td><td>${c.removals ? `${c.removals.n} customers · ${c.removals.d} disqualified` : '0'}</td><td><a class="btn btn-ghost btn-xs" href="#/${base}/contests/${c.id}">Leaderboard</a></td></tr>`).join('')}</tbody></table></div>` : empty('trophy', 'No contests yet. Build the first one above.')}</section>`;
  };
  function wireContestForm(pg) {
    const f = pg.querySelector('[data-ctf]'); if (!f) return;
    const prev = () => {
      pg.querySelector('[data-cbp]').textContent = f.title.value || 'New contest';
      const pool = [...f.querySelectorAll('[data-pz]')].reduce((s, i) => { const [a, b] = i.dataset.pz.split('-').map(Number); return s + (Number(i.value) || 0) * (b - a + 1); }, 0) + (Number(f.rising.value) || 0);
      pg.querySelector('[data-cbpd]').textContent = `Prize pool ${usd(pool, 0)}`;
      pg.querySelector('[data-cpv]').style.setProperty('--cacc', f.accent.value);
      const st = Date.parse(f.starts_at.value + 'T00:00:00+01:00'); if (st) pg.querySelector('[data-cps]').textContent = st <= Date.now() ? 'Live from ' + A.ds(st) : 'Starts ' + A.ds(st);
    };
    f.addEventListener('input', prev); prev();
    f.querySelector('[data-banner]').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return; const st = f.querySelector('[data-bannerst]'); st.textContent = 'Uploading…';
      try { const prep = await window.VSM.prepare(file); const u = await window.VSM.upload(prep, 'aff_contest').promise; CED.banner = u.id; st.textContent = 'Banner added'; const box = pg.querySelector('[data-cpv]'); let img = box.querySelector('img'); if (!img) { box.insertAdjacentHTML('afterbegin', '<img class="cpv-img" alt="">'); img = box.querySelector('img'); } img.src = u.thumb_url || u.url; }
      catch (x) { st.textContent = x.message; }
    });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const prizes = [...f.querySelectorAll('[data-pz]')].map((i) => { const [a, b] = i.dataset.pz.split('-').map(Number); return { label: i.dataset.lbl, rank_from: a, rank_to: b, amount_cents: Math.round((Number(i.value) || 0) * 100) }; }).filter((p) => p.amount_cents > 0);
      const body = { title: f.title.value, kind: f.kind.value, description: f.description.value, rules: f.rules.value, starts_at: f.starts_at.value + 'T00:00:00+01:00', ends_at: f.ends_at.value + 'T23:59:59+01:00', qual_days: Math.max(0, Number(f.qual_days.value) || 0),
        products: [...f.querySelectorAll('[data-chips=cprod] .on')].map((b) => b.dataset.v), geos: f.geos.value.toUpperCase().split(/[,\s]+/).filter(Boolean), scoring: { points: Number(f.points.value) || 1, plan_points: Number(f.plan_points.value) ? [{ min_price_cents: 9900, points: Number(f.plan_points.value) }] : [] },
        min_points: Number(f.min_points.value) || 0, multipliers: f.multipliers.checked, prizes, rising: { amount_cents: Math.round((Number(f.rising.value) || 0) * 100), max_tier: 1 }, eligibility: { min_tier: Number(f.min_tier.value) || 0 }, banner_upload: CED.banner || '', theme: { accent: f.accent.value }, announce: f.announce.checked, published: f.published.checked };
      if (await A.act(f.querySelector('[type=submit]'), () => A.POST('/api/admin/aff/contests', body), 'Contest scheduled.')) A.route();
    });
  }
  async function contestAdmin(base, id) {
    const d = await A.api(`/api/admin/aff/contests/${id}/leaderboard`);
    const c = d.contest;
    return `<a class="back" href="#/${base}/contests">${icon('left')}Contests</a>
      <section class="card adh"><div class="adh-l">${c.banner ? `<img class="ct-thumb" src="${esc(c.banner.thumb_url || c.banner.url)}" alt="">` : `<span class="ct-thumb">${icon('trophy')}</span>`}<div><h2>${esc(c.title)}</h2><p class="muted">${A.dt(c.starts_at)} to ${A.dt(c.ends_at)} · results after ${A.dt(c.results_at)} · pool ${$c0(c.pool_cents)}</p><div class="lb-act">${statusPill(c.cancelled ? 'cancelled' : c.status)}${c.final_at ? '<span class="st st-g">Finalised</span>' : ''}${c.signoff_at ? '<span class="st st-g">Signed off</span>' : ''}</div></div></div>
        <div class="adh-r">${R('admin') ? `<button class="btn btn-w btn-sm" data-ctact="recompute" data-id="${c.id}">${icon('refresh')}Recompute</button>${!c.final_at ? `<button class="btn btn-k btn-sm" data-ctact="finalise" data-id="${c.id}">Finalise results</button>` : ''}` : ''}${c.final_at && !c.signoff_at ? `<button class="btn btn-g btn-sm" data-ctact="signoff" data-id="${c.id}">Sign off (second person)</button>` : ''}${R('admin') && !c.cancelled && !c.signoff_at ? `<button class="btn btn-danger btn-sm" data-ctact="cancel" data-id="${c.id}">Cancel</button>` : ''}</div></section>
      <section class="card"><div class="card-h"><h3>Leaderboard</h3><span class="sub">${fmt(c.entrants || d.rows.length)} entrants. Staff view, with removals and disqualifications.</span></div>${d.rows.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th class="n">Rank</th><th>Affiliate</th><th class="n">Points</th><th class="n">Multiplier</th><th class="n">Score</th><th class="n">Customers</th><th class="n">Revenue</th><th>State</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td class="n b">${r.rank || '–'}</td><td><a href="#/admin/affiliate/${r.affiliate_id}">${esc(r.name)}</a> <small class="muted">${esc(r.ref)}</small></td><td class="n">${fmt(r.points)}</td><td class="n">x${fmt((r.multiplier_bp || 10000) / 10000, 2)}</td><td class="n b">${fmt(r.score, 1)}</td><td class="n">${fmt(r.customers || 0)}</td><td class="n">${$c0(r.revenue_cents || 0)}</td><td>${r.disqualified ? '<span class="st st-r">Disqualified</span>' : r.removed ? `<span class="st st-amb">${r.removed} removed</span>` : '<span class="st st-g">OK</span>'}</td></tr>`).join('')}</tbody></table></div>` : empty('trophy', 'No scores yet.')}</section>`;
  }
  document.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-ctact]'); if (!c) return;
    const k = c.dataset.ctact;
    let body = {};
    if (k === 'cancel') { const note = await A.ask('Cancel contest', 'Only for fraud, a technical failure or a legal requirement. Shown on the contest page.', { label: 'Reason', danger: true, ok: 'Cancel contest' }); if (!note) return; body = { note }; }
    if (await A.act(c, () => A.POST(`/api/admin/aff/contests/${c.dataset.id}/${k}`, body), { recompute: 'Scores recomputed', finalise: 'Results finalised. A second person signs off.', signoff: 'Signed off. Prizes are created as Contest earnings.', cancel: 'Contest cancelled' }[k])) A.route();
  });

  /* ================= Creatives ================= */
  P.creatives = async () => {
    const d = await A.api('/api/admin/aff/creatives');
    const L = d.creatives || [];
    A.then((pg) => {
      const f = pg.querySelector('[data-crf]'); let up = '';
      f.querySelector('[data-crup]').addEventListener('change', async (e) => { const file = e.target.files[0]; if (!file) return; const st = f.querySelector('[data-crst]'); st.textContent = 'Uploading…'; try { const prep = await window.VSM.prepare(file); const u = await window.VSM.upload(prep, 'aff_creative').promise; up = u.id; st.textContent = `Added ${file.name}`; } catch (x) { st.textContent = x.message; } });
      f.addEventListener('submit', async (e) => { e.preventDefault(); const body = { title: f.title.value, product_key: f.product_key.value, format: f.format.value, size: f.size.value, language: f.language.value, platform: f.platform.value, copy_text: f.copy_text.value, landing_url: f.landing_url.value, file_url: f.file_url.value, upload_id: up || undefined, public_from: f.public_from.value || undefined, early_access: f.early_access.checked, min_tier: Number(f.min_tier.value) || 0 }; if (await A.act(f.querySelector('[type=submit]'), () => A.POST('/api/admin/aff/creatives', body), 'Creative added. Each one gets an ID for sub1.')) A.route(); });
      pg.addEventListener('click', async (e) => { const x = e.target.closest('[data-crdel]'); if (x && confirm('Archive this creative?') && await A.act(x, () => A.DEL('/api/admin/aff/creatives/' + x.dataset.crdel), 'Archived')) A.route(); });
    });
    return `<div class="ph"><div><h2>Creatives</h2><p>Upload approved creatives. Pro sees them 48 hours early, Elite and up 7 days early.</p></div></div>
      <div class="g-2-1"><section class="card"><form data-crf><label class="drop">${icon('download')}<b data-crst>Add an image (PNG, JPG)</b><small>Videos: paste a file link below. Each creative gets an ID for sub1.</small><input type="file" accept="image/*" data-crup hidden></label>
        <div class="fgrid"><label class="field"><span class="lbl">Title</span><input class="inp" name="title" required></label><label class="field"><span class="lbl">Product</span><select class="inp" name="product_key">${['premium', 'spyvoo', 'joinvoo', 'vooads', 'replyvoo', 'castvoo', 'landvoo'].map((k) => `<option value="${k}">${esc(A.brand(k).name)}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Format</span><select class="inp" name="format">${['Image', 'Video', 'Story', 'Banner', 'Telegram post', 'Copy'].map((x) => `<option>${x}</option>`).join('')}</select></label><label class="field"><span class="lbl">Size</span><select class="inp" name="size">${['9:16', '1:1', '4:5', '16:9', '300x250'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Language</span><select class="inp" name="language">${['English', 'Pidgin', 'Swahili', 'French', 'Portuguese', 'Arabic'].map((x) => `<option>${x}</option>`).join('')}</select></label><label class="field"><span class="lbl">Platform</span><select class="inp" name="platform">${['Meta', 'TikTok', 'Telegram', 'YouTube', 'Instagram', 'Display'].map((x) => `<option>${x}</option>`).join('')}</select></label>
        <label class="field"><span class="lbl">Public from</span><input class="inp" type="date" name="public_from"></label><label class="field"><span class="lbl">Minimum tier</span><select class="inp" name="min_tier">${A.tiers().map((t, i) => `<option value="${i}">${esc(t.n)}</option>`).join('')}</select></label></div>
        <label class="field"><span class="lbl">Copy <em>{your_link} becomes their link</em></span><textarea class="inp" name="copy_text" placeholder="Start free: {your_link}"></textarea></label>
        <div class="fgrid"><label class="field"><span class="lbl">Landing page <em>optional</em></span><input class="inp" name="landing_url" type="url"></label><label class="field"><span class="lbl">Video or file link <em>optional</em></span><input class="inp" name="file_url" type="url"></label></div>
        <label class="switch"><input type="checkbox" name="early_access" checked><i></i>Early access: Pro 48 h, Elite+ 7 days</label><button class="btn btn-g btn-sm" type="submit">Add creative</button></form></section>
        <section class="card"><div class="card-h"><h3>Most used this month</h3></div>${(d.most_used || []).length ? A.bars(d.most_used.map((x) => ({ label: x.title, v: (x.downloads || 0) + (x.copies || 0), col: A.brand(x.product_key).mark, icon: pi(x.product_key, 'xs') })), { fmtv: (v) => fmt(v) + ' uses' }) : '<p class="muted sm">Downloads and copies show here.</p>'}</section></div>
      <section class="card"><div class="card-h"><h3>Library</h3><span class="sub">${L.length} active</span></div>${L.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>ID</th><th>Creative</th><th>Product</th><th>Format</th><th>Language</th><th>Public from</th><th class="n">Uses</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${L.map((x) => `<tr><td><code>cr_${x.id}</code></td><td>${x.image ? `<img class="cr-th" src="${esc(x.image.thumb_url || x.image.url)}" alt="">` : ''}<b>${esc(x.title)}</b></td><td><span class="tp">${pi(x.product_key, 'xs')}${esc(A.brand(x.product_key).short || A.brand(x.product_key).name)}</span></td><td>${esc(x.format)} · ${esc(x.size)}</td><td>${esc(x.language)}</td><td>${x.public_from ? A.dt(x.public_from) : 'Now'}</td><td class="n">${fmt((x.downloads || 0) + (x.copies || 0))}</td><td class="n"><button class="btn btn-ghost btn-xs" data-crdel="${x.id}" aria-label="Archive">${icon('x')}</button></td></tr>`).join('')}</tbody></table></div>` : empty('image', 'No creatives yet.')}</section>`;
  };

  /* ================= Announcements ================= */
  P.announce = async () => {
    const d = await A.api('/api/admin/aff/announcements');
    A.then((pg) => {
      const f = pg.querySelector('[data-anf]');
      f.addEventListener('input', () => { pg.querySelectorAll('[data-anpt]').forEach((x) => { x.textContent = f.title.value || 'Title'; }); pg.querySelectorAll('[data-anpl]').forEach((x) => { x.textContent = f.body.value || 'One line'; }); });
      f.audience.addEventListener('change', () => { f.querySelectorAll('[data-aud]').forEach((x) => { x.hidden = x.dataset.aud !== f.audience.value; }); });
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); const k = f.audience.value;
        const audience = { kind: k, ...(k === 'tier' ? { min_tier: Number(f.min_tier.value) } : k === 'product' ? { product: f.product.value } : k === 'geo' ? { country: f.country.value } : k === 'affiliate' ? { affiliate_id: Number(String(f.affiliate_id.value).replace(/\D/g, '')) } : {}) };
        const body = { kind: f.kind.value, title: f.title.value, body: f.body.value, link: f.link.value, audience, channels: { dashboard: f.ch_d.checked, email: f.ch_e.checked, telegram: f.ch_t.checked }, pinned: f.pinned.checked, send_at: f.send_at.value || undefined, expires_at: f.expires_at.value || undefined, effective_at: f.effective_at.value || undefined };
        if (await A.act(f.querySelector('[type=submit]'), () => A.POST('/api/admin/aff/announcements', body), 'Announcement scheduled.')) A.route();
      });
      pg.addEventListener('click', async (e) => { const x = e.target.closest('[data-andel]'); if (x && await A.act(x, () => A.DEL('/api/admin/aff/announcements/' + x.dataset.andel), 'Announcement ended')) A.route(); });
    });
    const KIND = [['new_offer', 'New offer'], ['cpa_change', 'CPA change (needs effective date)'], ['creatives', 'Creatives'], ['contest', 'Contest'], ['policy', 'Policy'], ['maintenance', 'Maintenance']];
    return `<div class="ph"><div><h2>Announcements</h2><p>Reach all affiliates or a slice of them on the dashboard, email and Telegram.</p></div></div>
      <div class="g-2-1"><section class="card"><form data-anf><div class="fgrid"><label class="field"><span class="lbl">Type</span><select class="inp" name="kind">${KIND.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label><label class="field"><span class="lbl">Audience</span><select class="inp" name="audience">${(roles().admin ? [['all', 'All affiliates'], ['tier', 'By tier and up'], ['product', 'By product promoted'], ['geo', 'By country'], ['affiliate', 'One affiliate']] : [['manager', 'My partners'], ['affiliate', 'One of my partners']]).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field" data-aud="tier" hidden><span class="lbl">Minimum tier</span><select class="inp" name="min_tier">${A.tiers().map((t, i) => `<option value="${i}">${esc(t.n)}</option>`).join('')}</select></label><label class="field" data-aud="product" hidden><span class="lbl">Product</span><select class="inp" name="product">${['premium', 'spyvoo', 'joinvoo', 'vooads', 'replyvoo', 'castvoo', 'landvoo'].map((k) => `<option value="${k}">${esc(A.brand(k).name)}</option>`).join('')}</select></label><label class="field" data-aud="geo" hidden><span class="lbl">Country</span><select class="inp" name="country">${A.countryOptions('NG')}</select></label><label class="field" data-aud="affiliate" hidden><span class="lbl">Affiliate ID</span><input class="inp" name="affiliate_id" placeholder="AF-12"></label></div>
        <label class="field"><span class="lbl">Title</span><input class="inp" name="title" required maxlength="120"></label><label class="field"><span class="lbl">One line</span><input class="inp" name="body" maxlength="400"></label><label class="field"><span class="lbl">Link <em>optional</em></span><input class="inp" name="link" placeholder="#/aff/offers"></label>
        <div class="lb-act"><label class="switch"><input type="checkbox" name="ch_d" checked><i></i>Dashboard</label><label class="switch"><input type="checkbox" name="ch_e"><i></i>Email</label><label class="switch"><input type="checkbox" name="ch_t" checked><i></i>Telegram</label><label class="switch"><input type="checkbox" name="pinned"><i></i>Pin</label></div>
        <div class="fgrid"><label class="field"><span class="lbl">Send at <em>empty = now</em></span><input class="inp" type="datetime-local" name="send_at"></label><label class="field"><span class="lbl">Expires</span><input class="inp" type="date" name="expires_at"></label><label class="field"><span class="lbl">Effective date <em>CPA changes</em></span><input class="inp" type="date" name="effective_at"></label></div><button class="btn btn-g btn-sm" type="submit">Schedule</button></form></section>
        <section class="card"><div class="card-h"><h3>How it looks</h3></div><div class="anns"><div class="an"><span class="an-t">Announcement · now</span><b data-anpt>Title</b><small data-anpl>One line</small></div></div><div class="tgm solo"><p><span data-anpt>Title</span>. <span data-anpl>One line</span></p><small>Telegram</small></div></section></div>
      <section class="card"><div class="card-h"><h3>Sent and scheduled</h3></div>${d.announcements.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Title</th><th>Type</th><th>Audience</th><th>Send at</th><th>Expires</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${d.announcements.map((x) => `<tr><td><b>${esc(x.title)}</b>${x.pinned ? ' <span class="pill pill-l">Pinned</span>' : ''}</td><td>${esc(x.kind)}</td><td>${esc((x.audience || {}).kind || 'all')}</td><td>${A.dtm(x.send_at)}</td><td>${x.expires_at ? A.dt(x.expires_at) : '–'}</td><td class="n">${roles().admin && (!x.expires_at || x.expires_at > Date.now()) ? `<button class="btn btn-ghost btn-xs" data-andel="${x.id}">End</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('megaphone', 'No announcements yet.')}</section>`;
  };

  /* ================= Payouts (finance, four eyes) ================= */
  let PAYST = 'open';
  P.payouts = async () => {
    const [d, adj] = await Promise.all([A.api('/api/admin/aff/payouts?status=' + PAYST), A.api('/api/admin/aff/adjustments?status=pending').catch(() => ({ requests: [] }))]);
    const t = d.totals;
    S.cache.apay = d.payouts;
    return `<div class="ph"><div><h2>Payouts</h2><p>Nobody handles their own payout. Over ${$c0(d.four_eyes_cents)} needs approval by one finance user and sending by another.</p></div><div class="lb-act"><div class="seg" data-payst>${[['open', 'Open'], ['paid', 'Paid'], ['rejected', 'Not sent'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, l]) => `<button class="${k === PAYST ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div><button class="btn btn-w btn-sm" data-dl="/api/admin/aff/payouts.csv" data-name="voosquare-payouts.csv">${icon('download')}CSV</button></div></div>
      <div class="astats">${stat('Requested', $c0(t.requested_cents), `${t.requested} request${t.requested === 1 ? '' : 's'}`)}${stat('Sending', $c0(t.sending_cents), `${t.sending} request${t.sending === 1 ? '' : 's'}`)}${stat('Paid this month', $c0(t.paid_month_cents), `${t.paid_month} payout${t.paid_month === 1 ? '' : 's'}`)}${stat('Held for review', $c0(t.held_cents), `${t.held} request${t.held === 1 ? '' : 's'}`, t.held ? 'warn' : '')}</div>
      <section class="card">${d.payouts.length ? `<div class="tbl-w"><table class="tbl pq"><thead><tr><th>Affiliate</th><th class="n">Amount</th><th>Method</th><th>SLA</th><th>Checks</th><th>Four-eyes</th><th><span class="sr">Actions</span></th></tr></thead><tbody>${d.payouts.map(payRow).join('')}</tbody></table></div>` : empty('wallet', PAYST === 'open' ? 'No payouts waiting.' : 'Nothing here yet.')}</section>
      ${adj.requests.length ? `<section class="card" id="adj-four-eyes"><div class="card-h"><h3>Adjustments waiting for a second approval</h3><span class="sub">Positive adjustments over ${$c0(adj.four_eyes_cents)}. Never approved by the person who asked.</span></div>${adjList(adj.requests, true)}</section>` : ''}`;
  };
  function payRow(p) {
    const fe = p.four_eyes || {};
    const sla = p.sla ? (p.sla.overdue ? `Overdue ${A.ago(p.sla.due_at)}` : ['requested', 'approved', 'processing'].includes(p.status) ? `Due ${A.ds(p.sla.due_at)}` : '') : '';
    let act = '';
    if (p.own) act = '<small class="muted">Your own payout</small>';
    else if (p.status === 'requested') act = fe.needed ? `<button class="btn btn-k btn-xs" data-pay="${p.id}" data-a="approve">Approve</button>` : `<button class="btn btn-k btn-xs" data-pay="${p.id}" data-a="processing">Mark sending</button><button class="btn btn-g btn-xs" data-pay="${p.id}" data-a="paid">Mark paid</button>`;
    else if (p.status === 'approved') act = fe.you_approved ? '<button class="btn btn-w btn-xs" disabled title="You approved it. Another finance user sends it.">Mark sending</button>' : `<button class="btn btn-k btn-xs" data-pay="${p.id}" data-a="processing">Mark sending</button><button class="btn btn-g btn-xs" data-pay="${p.id}" data-a="paid">Mark paid</button>`;
    else if (p.status === 'processing') act = `<button class="btn btn-g btn-xs" data-pay="${p.id}" data-a="paid">Mark paid</button>${p.provider ? `<button class="btn btn-w btn-xs" data-pay="${p.id}" data-a="check">Check provider</button>` : ''}`;
    else if (p.status === 'held') act = `<button class="btn btn-w btn-xs" data-pay="${p.id}" data-a="release">Release</button>`;
    else if (p.receipt_url) act = `<button class="btn btn-w btn-xs" data-dl="${esc(p.receipt_url)}" data-name="voosquare-receipt-${esc(p.receipt_no)}.pdf">${icon('download')}Receipt</button>`;
    if (['requested', 'approved'].includes(p.status) && !p.own) act += `<button class="btn btn-ghost btn-xs" data-pay="${p.id}" data-a="hold">Hold</button><button class="btn btn-ghost btn-xs" data-pay="${p.id}" data-a="reject">Reject</button>`;
    return `<tr data-pq="${p.id}"><td>${who({ ...p.affiliate, name: p.affiliate.name })}</td><td class="n b">${$c(p.amount_cents)}${p.fee_cents ? `<small class="muted"> −${$c(p.fee_cents)}</small>` : ''}</td><td>${esc(p.method_label)}<small class="muted mono"> ${esc(p.wallet_masked)}</small>${p.tx_hash ? `<br><a class="tx" href="${esc(p.explorer_url || '#')}" target="_blank" rel="noopener"><code>${esc(p.tx_hash.slice(0, 8))}…</code></a>` : ''}</td><td>${sla ? `<span class="sla-t ${p.sla.overdue ? 'od' : ''}">${esc(sla)}</span>` : statusPill(p.status, p.status_label)}</td><td>${p.checks.map((c) => `<span class="st ${c === 'Clean' ? 'st-g' : 'st-r'}">${esc(c)}</span>`).join(' ')}</td>
      <td>${fe.needed ? `<span class="fe"><i class="${fe.approved_by ? 'ok' : ''}">${fe.approved_by ? icon('check') : '1'}</i><small>${fe.approved_by ? `Approved by ${esc(fe.approved_by)} · send by another user` : 'Needs approver + sender'}</small></span>` : '<small class="muted">Single user</small>'}</td><td class="n nowrap">${act}</td></tr>`;
  }
  document.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-payst] button'); if (st) { PAYST = st.dataset.v; A.route(); return; }
    const b = e.target.closest('[data-pay]'); if (!b) return;
    const id = b.dataset.pay, a = b.dataset.a;
    let body = {};
    if (a === 'paid') {
      const p = (S.cache.apay || []).find((x) => String(x.id) === id) || {};
      const lines = await A.api(`/api/admin/aff/payouts/${id}`).catch(() => null);
      const m = A.modal(`${A.mHead('Mark paid', `${$c(p.amount_cents)} to ${esc(p.method_label || '')}`)}<form class="vs-modal-b"><div class="lb-out"><code>${esc(p.wallet || '')}</code><button type="button" class="btn btn-w btn-xs" data-copy="${esc(p.wallet || '')}">${icon('copy')}Copy</button></div>${lines && lines.lines.length ? `<div class="pay-lines">${lines.lines.map((l) => `<div><span>${esc([l.product, LINE_TYPE[l.type] || l.type].filter(Boolean).join(' · '))}${l.reason ? `: ${esc(l.reason)}` : ''}<small class="muted"> · ${fmt(l.count)} ${l.count === 1 ? 'item' : 'items'}</small></span><b>${$c(l.amount_cents)}</b></div>`).join('')}</div>` : ''}<label class="field"><span class="lbl">Transaction hash</span><input class="inp mono" name="tx" required placeholder="Paste the tx hash" autocomplete="off"></label><label class="field"><span class="lbl">Note <em>optional</em></span><input class="inp" name="note"></label><p class="muted sm">A PDF receipt is issued and the affiliate is notified.</p><button class="btn btn-g" type="submit">Mark paid</button></form>`);
      m.el.querySelector('form').addEventListener('submit', async (ev) => { ev.preventDefault(); const f = ev.target; if (await A.act(f.querySelector('[type=submit]'), () => A.POST(`/api/admin/aff/payouts/${id}/paid`, { tx_hash: f.tx.value.trim(), note: f.note.value }), 'Marked paid. Receipt issued.')) { m.close(); A.route(); } });
      return;
    }
    if (a === 'reject' || a === 'hold') { const r = await A.ask(a === 'reject' ? 'Reject payout' : 'Hold for review', a === 'reject' ? 'The amount returns to their available balance.' : 'The affiliate sees "Under review".', { label: 'Reason', danger: a === 'reject', ok: a === 'reject' ? 'Reject' : 'Hold' }); if (!r) return; body = { reason: r }; }
    if (await A.act(b, () => A.POST(`/api/admin/aff/payouts/${id}/${a}`, body), { approve: 'Approved. Another finance user must send it.', processing: 'Marked sending. Add the tx hash when paid.', reject: 'Rejected. Amount back in their balance.', hold: 'Held for review.', release: 'Released.', check: 'Provider checked.' }[a])) A.route();
  });

  /* ================= KYC ================= */
  let KYCST = 'pending';
  P.kyc = async () => {
    const d = await A.api('/api/admin/aff/kyc?status=' + KYCST);
    return `<div class="ph"><div><h2>KYC</h2><p>Identity checks before payouts. Documents are private: only finance and program admins see them.</p></div><div class="seg" data-kycst>${[['pending', 'To review'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['none', 'Not started']].map(([k, l]) => `<button class="${k === KYCST ? 'on' : ''}" data-v="${k}">${l}</button>`).join('')}</div></div>
      <section class="card">${d.affiliates.length ? `<div class="kyc-list">${d.affiliates.map((x) => `<div class="kyc-row"><div>${who({ ...x, name: x.display_name })}<small class="muted">${x.kyc.mode === 'provider' ? `Provider ${esc(x.kyc.provider)} · ${esc(x.provider_ref || '')}` : `${x.documents.length} document${x.documents.length === 1 ? '' : 's'}`} · ${A.dtm(x.kyc.updated_at)}</small></div>
        <div class="kyc-docs-a">${x.documents.map((dc) => (dc.image ? `<a href="${esc(dc.image.url)}" target="_blank" rel="noopener" class="kyc-doc"><img src="${esc(dc.image.thumb_url || dc.image.url)}" alt="${esc(dc.type)}"><small>${esc(DOC_LABEL[dc.type] || dc.type.replace(/_/g, ' '))}</small></a>` : `<span class="kyc-doc"><small>${esc(DOC_LABEL[dc.type] || dc.type)}</small></span>`)).join('')}</div>
        <div class="lb-act">${KYCST === 'pending' ? `<button class="btn btn-g btn-xs" data-kycd="${x.id}" data-s="verified">Verify</button><button class="btn btn-ghost btn-xs" data-kycd="${x.id}" data-s="rejected">Reject</button>` : statusPill(x.kyc.status)}</div></div>`).join('')}</div>` : empty('id', KYCST === 'pending' ? 'No identity checks waiting.' : 'Nothing here.')}</section>`;
  };
  document.addEventListener('click', async (e) => {
    const st = e.target.closest('[data-kycst] button'); if (st) { KYCST = st.dataset.v; A.route(); return; }
    const k = e.target.closest('[data-kycd]'); if (!k) return;
    const reason = k.dataset.s === 'rejected' ? await A.ask('Reject identity check', 'The affiliate sees this reason and can try again.', { label: 'Reason', placeholder: 'The photo of your ID is not readable.', danger: true, ok: 'Reject' }) : '';
    if (reason === null) return;
    if (await A.act(k, () => A.POST(`/api/admin/aff/kyc/${k.dataset.kycd}`, { status: k.dataset.s, reason }), k.dataset.s === 'verified' ? 'Verified. Payouts are open for them.' : 'Rejected.')) A.route();
  });

  /* ================= Managers ================= */
  P.managers = async () => {
    const d = await A.api('/api/admin/aff/managers');
    A.then((pg) => pg.addEventListener('click', async (e) => {
      const ed = e.target.closest('[data-mged]'); const ra = e.target.closest('[data-reassign]');
      if (ed) {
        const m = d.managers.find((x) => String(x.user_id) === ed.dataset.mged) || { kinds: [], languages: [], countries: [] };
        const md = A.modal(`${A.mHead(ed.dataset.mged ? 'Edit manager' : 'Add a manager', 'The person needs a team role first (Admin → Team).')}<form class="vs-modal-b">${ed.dataset.mged ? '' : '<label class="field"><span class="lbl">Team member user ID</span><input class="inp" name="uid" required inputmode="numeric"></label>'}
          <div class="field"><span class="lbl">Roles</span><div class="lb-act">${['general', 'private', 'fraud', 'finance'].map((k) => `<label class="ck sm"><input type="checkbox" name="k" value="${k}" ${m.kinds.includes(k) ? 'checked' : ''}><i>${icon('check')}</i><span>${k}</span></label>`).join('')}</div></div>
          <div class="fgrid"><label class="field"><span class="lbl">Languages</span><input class="inp" name="languages" value="${esc((m.languages || []).join(', '))}"></label><label class="field"><span class="lbl">Countries <em>codes</em></span><input class="inp" name="countries" value="${esc((m.countries || []).join(', '))}"></label><label class="field"><span class="lbl">Hours</span><input class="inp" name="hours" value="${esc(m.hours || '')}" placeholder="Mon to Sat, 9:00 to 19:00 WAT"></label><label class="field"><span class="lbl">Telegram</span><input class="inp" name="telegram" value="${esc(m.telegram || '')}"></label><label class="field"><span class="lbl">Capacity</span><input class="inp" name="capacity" inputmode="numeric" value="${(m.load || {}).target || ''}"></label></div>
          <button class="btn btn-g" type="submit">Save</button></form>`);
        md.el.querySelector('form').addEventListener('submit', async (ev) => { ev.preventDefault(); const f = ev.target; const list = (v) => v.split(/[,;]/).map((x) => x.trim()).filter(Boolean); const uid = ed.dataset.mged || f.uid.value; if (await A.act(f.querySelector('[type=submit]'), () => A.PUT('/api/admin/aff/managers/' + Number(uid), { kinds: [...f.querySelectorAll('[name=k]:checked')].map((x) => x.value), languages: list(f.languages.value), countries: list(f.countries.value.toUpperCase()), hours: f.hours.value, telegram: f.telegram.value, capacity: Number(f.capacity.value) || undefined, active: true }), 'Manager saved')) { md.close(); A.route(); } });
      }
      if (ra && confirm(ra.dataset.reassign ? 'Move every partner of this manager to others, by country and load?' : 'Assign every affiliate without a manager?')) { if (await A.act(ra, () => A.POST('/api/admin/aff/managers/reassign', ra.dataset.reassign ? { from_user_id: Number(ra.dataset.reassign) } : {}), (r) => `${r.moved} affiliates assigned`)) A.route(); }
    }));
    return `<div class="ph"><div><h2>Managers</h2><p>Load targets: general ${300} affiliates, private ${40}.${d.unassigned ? ` ${d.unassigned} ${d.unassigned === 1 ? 'affiliate has' : 'affiliates have'} no general manager.` : ''}</p></div><div class="lb-act">${d.unassigned ? `<button class="btn btn-k btn-sm" data-reassign="">${icon('users')}Assign unassigned</button>` : ''}<button class="btn btn-w btn-sm" data-mged="">${icon('plus')}Add manager</button></div></div>
      ${d.managers.length ? `<div class="mgrs-g">${d.managers.map((m) => `<section class="card mgc"><div class="mgc-h">${face(A.avOf(m.avatar, m.name), 'lg')}<div><b>${esc(m.name)}</b><small>${esc(m.kinds.join(', '))} · ${esc((m.languages || []).join(', ') || 'Languages not set')}</small></div></div>
        ${m.kinds.includes('general') || m.kinds.includes('private') ? `<div class="load"><span>${m.load.general + m.load.private} of ${m.load.target} affiliates</span><i><b style="--p:${Math.min(1, (m.load.general + m.load.private) / (m.load.target || 1)).toFixed(2)}" class="${(m.load.general + m.load.private) / (m.load.target || 1) > 0.9 ? 'hi' : ''}"></b></i></div>` : `<div class="load"><span>${m.cpa_reviews_7d} CPA reviews this week</span></div>`}
        <div class="mgc-s">${stat('Approvals MTD', fmt(m.approvals_mtd))}${stat('Partner revenue MTD', $c0(m.partner_revenue_mtd_cents))}</div><div class="lb-act"><button class="btn btn-w btn-xs" data-mged="${m.user_id}">Edit</button><button class="btn btn-ghost btn-xs" data-reassign="${m.user_id}">Reassign partners</button></div></section>`).join('')}</div>` : empty('headset', 'No manager profiles yet.', 'Give team members the aff_manager role, then add their profile here.')}
      ${d.private_suggestions.length ? `<section class="card"><div class="card-h"><h3>Suggested for a private manager</h3><span class="sub">One full month at Elite or above, no private manager yet.</span></div>${affTable('admin', d.private_suggestions)}</section>` : ''}`;
  };

  /* ================= Manager home ================= */
  P.home = async (base) => {
    const d = await A.api('/api/admin/aff/manager/home');
    const s = d.stats;
    return `<div class="ph"><div><h2>My partners</h2><p>You see only the ${s.partners} affiliates assigned to you.</p></div><a class="btn btn-k btn-sm" href="#/mgr/applications">${icon('id')}${d.applications} application${d.applications === 1 ? '' : 's'}</a></div>
      <div class="astats">${stat('My partners', fmt(s.partners), `of ${fmt(s.target)} target`)}${stat('Qualified FTDs MTD', fmt(s.qualified_mtd))}${stat('Commission MTD', $c0(s.commission_mtd_cents), s.adjustments_mtd_cents ? `adjustments ${s.adjustments_mtd_cents > 0 ? '+' : '−'}${$c0(Math.abs(s.adjustments_mtd_cents))} not included` : '')}${stat('Applications waiting', fmt(d.applications))}</div>
      <div class="g-2-1"><section class="card"><div class="card-h"><h3>Partners</h3></div>${affTable(base, d.partners)}</section>
        <section class="card"><div class="card-h"><h3>Alerts</h3></div>${d.alerts.length ? `<div class="alerts">${d.alerts.map((a) => `<a class="al al-${esc(a.tone)}" href="#/mgr/partner/${a.affiliate_id}"><span>${icon({ spike: 'bolt', fraud: 'shield', health: 'heart', grace: 'clock', drop: 'down' }[a.kind] || 'alert')}</span><div><b>${esc({ spike: 'Spike', fraud: 'Fraud', health: 'Health', grace: 'Grace month', drop: 'Drop' }[a.kind] || a.kind)}</b><p>${esc(a.text)}</p></div></a>`).join('')}</div>` : empty('check', 'No alerts on your partners.')}</section></div>`;
  };

  /* ================= Audit ================= */
  let AUQ = '';
  P.audit = async () => {
    const d = await A.api('/api/admin/aff/audit?limit=200' + (AUQ ? '&q=' + encodeURIComponent(AUQ) : ''));
    A.then((pg) => { const i = pg.querySelector('[data-auq]'); let t; i.addEventListener('input', () => { AUQ = i.value.trim(); clearTimeout(t); t = setTimeout(() => A.route(), 450); }); if (AUQ) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } });
    return `<div class="ph"><div><h2>Audit log</h2><p>Every decision, with actor, time and before and after. Cannot be deleted.</p></div><button class="btn btn-w btn-sm" data-dl="/api/admin/aff/audit.csv" data-name="voosquare-affiliate-audit.csv">${icon('download')}Export CSV</button></div>
      <div class="filters"><label class="tb-s in">${icon('search')}<input data-auq value="${esc(AUQ)}" placeholder="Search actor or target" aria-label="Search the audit log"></label></div>
      <section class="card">${d.rows.length ? `<div class="tbl-w"><table class="tbl"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Affiliate</th><th>Detail</th></tr></thead><tbody>${d.rows.map((x) => `<tr><td>${A.dtm(x.at)}</td><td><b>${esc(x.actor)}</b></td><td>${esc(x.action)}</td><td>${x.affiliate_id ? `<a href="#/admin/affiliate/${x.affiliate_id}">AF-${x.affiliate_id}</a>` : '–'}</td><td class="muted">${esc(x.target || '')}${x.after ? ` <code>${esc(JSON.stringify(x.after).slice(0, 120))}</code>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('list', 'Nothing logged yet.')}</section>`;
  };

  /* ================= Program settings ================= */
  P.settings = async () => {
    const [d, tg] = await Promise.all([A.api('/api/admin/aff/settings'), A.api('/api/admin/aff/telegram').catch(() => ({ configured: false }))]);
    const s = d.settings;
    A.then((pg) => wireSettings(pg, s));
    const num = (name, label, v, hint = '') => `<label class="field"><span class="lbl">${label}</span><input class="inp" name="${name}" inputmode="decimal" value="${v ?? ''}">${hint ? `<span class="hint">${hint}</span>` : ''}</label>`;
    const prov = (k, p) => `<div class="fgrid"><label class="field"><span class="lbl">Provider</span><select class="inp" name="${k}_kind"><option value="manual" ${p.kind !== 'http' ? 'selected' : ''}>Manual (no provider)</option><option value="http" ${p.kind === 'http' ? 'selected' : ''}>HTTP provider</option></select></label><label class="field"><span class="lbl">Name</span><input class="inp" name="${k}_name" value="${esc(p.name || '')}" placeholder="${k === 'kyc' ? 'Smile ID' : 'NOWPayments'}"></label><label class="field"><span class="lbl">API base URL</span><input class="inp" name="${k}_api_base" value="${esc(p.api_base || '')}" placeholder="https://"></label><label class="field"><span class="lbl">API key</span><input class="inp" name="${k}_api_key" type="password" autocomplete="off" placeholder="${p.api_key_set ? 'Saved. Type to replace.' : 'Not set'}"></label><label class="field"><span class="lbl">Webhook secret</span><input class="inp" name="${k}_webhook_secret" type="password" autocomplete="off" placeholder="${p.webhook_secret_set ? 'Saved. Type to replace.' : 'Not set'}"></label><label class="field"><span class="lbl">Webhook URL</span><input class="inp mono" readonly value="${esc(location.origin)}/api/aff/hooks/${k === 'kyc' ? 'kyc' : 'payouts'}"></label></div>`;
    return `<div class="ph"><div><h2>Program settings</h2><p>Lower rates, higher tier thresholds or a higher health threshold are scheduled 30 days out so affiliates get notice. Earnings are instant unless you set a hold below.</p></div></div>
      <form data-psf><div class="g-2">
      <section class="card"><div class="card-h"><h3>Lifetime RevShare health</h3></div><div class="fgrid">${num('activation_customers', 'Qualified customers to activate', s.activation_customers)}${num('h_threshold', 'Threshold (qualified customers)', s.health.threshold, 'Owner may lower it, for example to 30')}${num('h_window', 'Rolling window (days)', s.health.window_days)}${num('h_ramp', 'Ramp-up (days)', s.health.ramp_days)}${num('h_grace', 'Grace (days)', s.health.grace_days)}${num('h_risk', 'At risk below % of pace', s.health.at_risk_pct)}</div><label class="switch"><input type="checkbox" name="h_pause_cpa" ${s.health.pause_cpa ? 'checked' : ''}><i></i>Paused health also pauses new CPA</label></section>
      <section class="card"><div class="card-h"><h3>Earnings timing</h3><span class="sub">Hold days · 0 = available instantly</span></div><p class="hint" style="margin:0 0 14px">RevShare is automatic. Used credits are non-refundable, so their commission is final; chargebacks and proven fraud still reverse. Card orders are Paystack, Flutterwave, Stripe or a custom API (chargeback risk). A hold applies only to earnings created after you save it.</p><div class="fgrid">${num('hd_spend', 'Credits used in tools', s.holds.spend_days)}${num('hd_order', 'Orders: crypto or manual', s.holds.order_days)}${num('hd_card', 'Orders paid by card', s.holds.card_order_days)}${num('hd_cpa', 'CPA after approval', s.holds.cpa_days)}${num('hd_cpa_long', 'CPA of $' + (s.holds.cpa_long_cents / 100) + ' or more', s.holds.cpa_long_days)}${num('hd_cpa_new', 'New on CPA window (long hold)', s.holds.cpa_new_days)}</div></section>
      <section class="card"><div class="card-h"><h3>Sub-affiliates</h3></div><label class="switch"><input type="checkbox" name="s_enabled" ${s.subs.enabled ? 'checked' : ''}><i></i>Sub-affiliate program on</label><div class="fgrid">${num('s_rate', 'Rate (%)', s.subs.rate_bp / 100)}${num('s_boost', 'Boosted rate (%)', s.subs.boosted_rate_bp / 100)}${num('s_subs', 'Active subs for the boost', s.subs.boost_subs)}${num('s_cust', 'Qualified customers each', s.subs.boost_sub_customers)}</div></section>
      <section class="card"><div class="card-h"><h3>Tiers</h3></div><div class="tset">${s.tiers.map((t, i) => `<div>${tierBadge(t.name, 'sm')}<input class="inp inp-xs" name="t_min_${i}" value="${t.min}" aria-label="${esc(t.name)} minimum"><input class="inp inp-xs" name="t_rate_${i}" value="${t.rate_bp / 100}" aria-label="${esc(t.name)} rate percent"><input class="inp inp-xs" name="t_sla_${i}" value="${t.sla_days}" aria-label="${esc(t.name)} payout days"></div>`).join('')}</div><p class="hint">Minimum qualified FTDs · RevShare % · payout business days</p><div class="fgrid">${num('q_noup', 'No upgrade above refund rate (%)', s.quality.no_upgrade_bp / 100)}${num('q_drop', 'Drop one tier above (%)', s.quality.drop_bp / 100)}</div></section>
      <section class="card"><div class="card-h"><h3>Payouts</h3></div><div class="fgrid">${num('p_usdt', 'USDT (TRC20) minimum (USD)', s.payouts.methods.usdt_trc20.min_cents / 100)}${num('p_btc', 'BTC minimum (USD)', s.payouts.methods.btc.min_cents / 100)}${num('p_4e', 'Four-eyes above (USD)', s.payouts.four_eyes_cents / 100)}${num('p_btcfee', 'BTC fee deducted (USD)', s.payouts.methods.btc.fee_cents / 100)}</div>
        <label class="switch"><input type="checkbox" name="p_btc_on" ${s.payouts.methods.btc.enabled ? 'checked' : ''}><i></i>BTC payouts on</label><h4 class="sw-h">Payout provider</h4>${prov('pay', s.payouts.provider)}</section>
      <section class="card"><div class="card-h"><h3>KYC</h3></div><div class="fgrid"><label class="field"><span class="lbl">Required</span><select class="inp" name="k_req">${[['off', 'Off'], ['first_payout', 'Before the first payout'], ['threshold', 'Above a threshold'], ['always', 'Always']].map(([k, l]) => `<option value="${k}" ${s.kyc.required === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${num('k_thr', 'Threshold (USD)', s.kyc.threshold_cents / 100)}</div><h4 class="sw-h">KYC provider</h4>${prov('kyc', s.kyc.provider)}</section>
      <section class="card"><div class="card-h"><h3>CPA and fraud</h3></div><div class="fgrid">${num('c_max', 'CPA limit without owner (USD)', s.cpa.max_cents / 100)}${num('c_pause', 'Auto-pause CPA above decline rate (%)', s.cpa.auto_pause_decline_bp / 100)}${num('c_bulk', 'Bulk approve below risk', s.cpa.bulk_max_risk)}${num('f_possible', 'Possible duplicate from risk', s.fraud.possible_at)}${num('f_existing', 'Existing customer from risk', s.fraud.existing_at)}${num('attribution_days', 'Attribution window (days)', s.attribution_days)}${num('reapply_days', 'Reapply wait (days)', s.reapply_days)}<label class="field"><span class="lbl">Terms version</span><input class="inp" name="terms_version" value="${esc(s.terms_version)}"></label></div></section>
      </div><div class="sticky-save"><button class="btn btn-g" type="submit">Save settings</button><span class="muted sm" data-psres></span></div></form>
      <section class="card tgadm"><div class="card-h"><h3>Telegram alerts bot</h3><span class="r">${tg.configured ? '<span class="st st-g">Configured</span>' : '<span class="st st-w">Not configured</span>'}</span></div>
        ${tg.configured ? `<p>Bot <b>@${esc(tg.bot || '')}</b> · ${fmt(tg.connected || 0)} affiliates connected · ${fmt(tg.queued || 0)} queued · ${fmt(tg.failed || 0)} failed</p><div class="lb-act"><button class="btn btn-k btn-sm" data-tgwh>${icon('tg')}Register Telegram webhook</button><span class="muted sm">Tells Telegram to send updates to ${esc(location.origin)}/api/aff/telegram/webhook</span></div>`
          : `<p class="muted">Set <code>TELEGRAM_BOT_TOKEN</code> (from @BotFather) in the server variables and redeploy. Affiliates see "Telegram alerts are not configured" until then; everything else works.</p><button class="btn btn-w btn-sm" disabled>${icon('tg')}Register Telegram webhook</button>`}</section>`;
  };
  function wireSettings(pg, s) {
    pg.addEventListener('click', async (e) => { const w = e.target.closest('[data-tgwh]'); if (w) await A.act(w, () => A.POST('/api/admin/aff/telegram/webhook'), (r) => (r && r.ok === false ? `Telegram said: ${r.description || 'error'}` : 'Webhook registered with Telegram')); });
    const f = pg.querySelector('[data-psf]');
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = (k) => Number(String(f[k].value).replace(/[^\d.]/g, ''));
      const c = (v) => Math.round(v * 100);
      const prov = (k, cur) => { const o = { kind: f[k + '_kind'].value, name: f[k + '_name'].value, api_base: f[k + '_api_base'].value }; if (f[k + '_api_key'].value) o.api_key = f[k + '_api_key'].value; if (f[k + '_webhook_secret'].value) o.webhook_secret = f[k + '_webhook_secret'].value; return { ...cur, ...o }; };
      const strip = (p) => { const o = { ...p }; delete o.api_key_set; delete o.webhook_secret_set; return o; };
      const body = {
        activation_customers: n('activation_customers'), attribution_days: n('attribution_days'), reapply_days: n('reapply_days'), terms_version: f.terms_version.value,
        health: { ...s.health, threshold: n('h_threshold'), window_days: n('h_window'), ramp_days: n('h_ramp'), grace_days: n('h_grace'), at_risk_pct: n('h_risk'), pause_cpa: f.h_pause_cpa.checked },
        holds: { ...s.holds, spend_days: n('hd_spend'), order_days: n('hd_order'), card_order_days: n('hd_card'), cpa_days: n('hd_cpa'), cpa_long_days: n('hd_cpa_long'), cpa_new_days: n('hd_cpa_new') },
        subs: { enabled: f.s_enabled.checked, rate_bp: c(n('s_rate')), boosted_rate_bp: c(n('s_boost')), boost_subs: n('s_subs'), boost_sub_customers: n('s_cust') },
        tiers: s.tiers.map((t, i) => ({ ...t, min: n('t_min_' + i), rate_bp: c(n('t_rate_' + i)), sla_days: n('t_sla_' + i) })),
        quality: { ...s.quality, no_upgrade_bp: c(n('q_noup')), drop_bp: c(n('q_drop')) },
        payouts: { ...s.payouts, four_eyes_cents: c(n('p_4e')), methods: { usdt_trc20: { ...s.payouts.methods.usdt_trc20, min_cents: c(n('p_usdt')) }, btc: { ...s.payouts.methods.btc, enabled: f.p_btc_on.checked, min_cents: c(n('p_btc')), fee_cents: c(n('p_btcfee')) } }, provider: prov('pay', strip(s.payouts.provider)) },
        kyc: { ...s.kyc, required: f.k_req.value, threshold_cents: c(n('k_thr')), provider: prov('kyc', strip(s.kyc.provider)) },
        cpa: { ...s.cpa, max_cents: c(n('c_max')), auto_pause_decline_bp: c(n('c_pause')), bulk_max_risk: n('c_bulk') },
        fraud: { ...s.fraud, possible_at: n('f_possible'), existing_at: n('f_existing') },
      };
      const r = await A.act(f.querySelector('[type=submit]'), () => A.PUT('/api/admin/aff/settings', body), (x) => (x.scheduled && x.scheduled.length ? `Saved. ${x.scheduled.length} change${x.scheduled.length === 1 ? ' is' : 's are'} scheduled 30 days out.` : 'Saved.'));
      if (r) { try { S.pub = await A.api('/api/aff/public'); } catch { /* keep */ } A.route(); }
    });
  }

  /* ================= routes ================= */
  const PAGES = {
    admin: { overview: 'Overview', affiliates: 'Affiliates', affiliate: 'Affiliate', approvals: 'Approvals', cpa: 'CPA review', check: 'Duplicate check', deals: 'Deals and products', contests: 'Contests', creatives: 'Creatives', announce: 'Announcements', payouts: 'Payouts', kyc: 'KYC', clawbacks: 'Fraud reversals', signals: 'Fraud signals', flags: 'Flagged affiliates', managers: 'Managers', audit: 'Audit log', settings: 'Program settings' },
    mgr: { home: 'My partners', partner: 'Partner', applications: 'Applications', requests: 'Deal requests' },
    fraud: { queue: 'Review queue', check: 'Duplicate check', signals: 'Fraud signals', flags: 'Flagged affiliates' },
    fin: { payouts: 'Payouts', kyc: 'KYC', clawbacks: 'Fraud reversals', affiliate: 'Affiliate' }, // affiliate: balance and adjustments (opened from Payouts)
  };
  const NAVKEY = { affiliate: 'affiliates', check: 'cpa', partner: 'home' };
  const IMPL = { partner: 'affiliate', applications: 'approvals', queue: 'cpa' };
  function staffRoute(base) {
    return async (page, arg) => {
      if (!S.user) { location.replace('#/join/login'); return null; }
      if (S.staff === undefined) await A.loadStaff();
      if (!S.staff || !S.staff.roles || !R(BASES[base])) {
        if (S.staff && S.staff.roles) { location.replace(A.staffHome()); return null; }
        return `<div class="site"><section class="sec"><div class="wrap">${empty('lock', 'This part of the affiliate back office is for the VooSquare team.', 'Ask the owner for an affiliate role in Admin → Team.', '<a class="btn btn-w btn-sm" href="#/site">Affiliate site</a>')}</div></section></div>`;
      }
      const T = PAGES[base];
      const p = T[page] ? page : Object.keys(T)[0];
      S.role = base;
      const fn = P[IMPL[p] || p];
      let navKey = NAVKEY[p] || p; if (base === 'fraud' && p === 'check') navKey = 'queue';
      if (base === 'mgr' && p === 'applications') navKey = 'applications';
      if (base === 'fin' && p === 'affiliate') navKey = 'payouts';
      return bShell(base, navKey, T[p], () => fn(base, arg));
    };
  }
  A.R.admin = staffRoute('admin'); A.R.mgr = staffRoute('mgr'); A.R.fraud = staffRoute('fraud'); A.R.fin = staffRoute('fin');
})();
