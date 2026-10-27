/* VooSquare Affiliates: helpers, brand data, shared components, scenes, shells and the router.
 * Ported from the approved preview (aff-preview/js/core.js) and wired to /api/aff/* and /api/admin/aff/* (docs/AFFILIATE_API.md).
 * Pages: aff-site.js (public site, sign-in, application), aff-app1.js + aff-app2.js (affiliate dashboard), aff-admin.js (back office). */
(function () {
  'use strict';
  const VS = window.VS;
  const { esc, icon, fmt } = VS;
  const reduce = VS.reduce;

  /* Extra line icons for this program, same 24px grid and stroke as VS.icon. */
  Object.assign(VS.P, {
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/>',
    code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/>',
    phone: '<rect x="6.5" y="2.5" width="11" height="19" rx="2.5"/><path d="M10.5 18.5h3"/>',
    alert: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
    bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    finger: '<path d="M8 20c-1-2-1.5-4-1.5-7a5.5 5.5 0 0 1 11 0M12 20c-.8-2-1.2-4-1.2-7a1.2 1.2 0 0 1 2.4 0c0 3 .6 5 1.6 7M16.5 18c-.3-1-.5-2.5-.5-4M5 9a8 8 0 0 1 14 0"/>',
    server: '<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/>',
    percent: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="M16 10.5l5-3v9l-5-3z"/>',
    type: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
    copyl: '<path d="M5 5h10v3M5 5v14h4"/><rect x="11" y="10" width="9" height="10" rx="2"/>',
    dup: '<rect x="3.5" y="7" width="11" height="13" rx="2.5"/><rect x="9.5" y="4" width="11" height="13" rx="2.5"/>',
    ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    zoom: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4M11 8v6M8 11h6"/>',
    hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
    stack: '<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M4 17l8 4 8-4"/>',
    tg: '<path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l7-5"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    network: '<circle cx="12" cy="5.5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/><path d="M12 8v4M12 12l-5 4M12 12l5 4"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  });

  /* ---------------- small helpers ---------------- */
  const $ = VS.$, $$ = VS.$$;
  const usd = (n, d = 2) => (n < 0 ? '−$' : '$') + fmt(Math.abs(n), d);
  const usd0 = (n) => usd(n, 0);
  const $c = (cents, d = 2) => usd((Number(cents) || 0) / 100, d);
  const $c0 = (cents) => $c(cents, (cents || 0) % 100 ? 2 : 0);
  const pct = (bp) => `${fmt((Number(bp) || 0) / 100, (bp || 0) % 100 ? 1 : 0)}%`;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dt = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
  const ds = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–');
  const tm = (t) => (t ? new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  const dtm = (t) => (t ? `${ds(t)}, ${tm(t)}` : '–');
  const ago = (t) => (t ? VS.timeAgo(t) : '');
  const dayLabel = (k) => { const [y, m, d] = String(k).split('-').map(Number); return d ? `${d} ${MON[m - 1]}` : k; };
  const monthLabel = (k) => { const [y, m] = String(k).split('-').map(Number); return m ? `${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1]} ${y}` : k; };
  const daysLeft = (t) => Math.max(0, Math.ceil((t - Date.now()) / 864e5));
  const hashStr = (s) => { let h = 7; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };

  /* Countries: ISO 3166 alpha-2 codes; names come from the browser, flags are regional-indicator emoji. */
  const CC = 'NG KE ZA GH CM CI SN TZ UG EG MA ZM RW ET BJ TG BF ML NE CD CG GA ZW MW MZ AO NA BW LS SZ MG MU SC DZ TN LY SD SS SO DJ ER GM GN GW SL LR CV ST GQ CF TD BI KM MR AE SA QA KW BH OM JO LB IL TR IR IQ PK IN BD LK NP ID MY PH SG TH VN KH MM CN HK TW JP KR AU NZ GB IE FR DE NL BE LU CH AT ES PT IT GR PL CZ SK HU RO BG HR SI RS BA ME MK AL UA MD BY RU LT LV EE FI SE NO DK IS US CA MX BR AR CL CO PE VE EC BO PY UY CR PA GT HN SV NI DO JM TT HT CU PR BS BB'.split(' ');
  let dn = null; try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { dn = null; }
  const cname = (cc) => { if (!cc) return ''; try { return (dn && dn.of(String(cc).toUpperCase())) || cc; } catch { return cc; } };
  const flag = (cc) => (/^[A-Za-z]{2}$/.test(cc || '') ? String.fromCodePoint(...[...String(cc).toUpperCase()].map((c) => 0x1F1A5 + c.charCodeAt(0))) : '🏳️');
  const COUNTRIES = CC.map((c) => [c, cname(c)]).sort((a, b) => a[1].localeCompare(b[1]));
  const countryOptions = (sel = '') => `<option value="">Choose a country</option>${COUNTRIES.map(([c, n]) => `<option value="${c}" ${c === sel ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;

  /* ---------------- brand data (design constants, not figures) ---------------- */
  const BRAND = {
    premium: { name: 'VooSquare Premium', short: 'Premium', icon: 'voosquare', a: '#15422F', b: '#06110C', acc: '#C9F65B', ink: '#fff', stage: 'Learn', mark: '#00A86B', domain: 'voosquare.com' },
    room: { name: 'Paid rooms', short: 'Rooms', icon: 'voosquare', a: '#15422F', b: '#06110C', acc: '#C9F65B', ink: '#fff', stage: 'Community', mark: '#12C784', domain: 'voosquare.com' },
    spyvoo: { name: 'Spyvoo', icon: 'spyvoo', a: '#FFFFFF', b: '#DCE4FF', acc: '#3355F0', ink: '#0E1A3D', stage: 'Research', mark: '#3355F0', domain: 'spyvoo.com' },
    joinvoo: { name: 'Joinvoo', icon: 'join', a: '#7B5CFF', b: '#3418B8', acc: '#C9F65B', ink: '#fff', stage: 'Track', mark: '#5B3FE8', domain: 'joinvoo.com' },
    vooads: { name: 'Vooads', icon: 'vooads', a: '#2A1A14', b: '#0D0907', acc: '#FF7A45', ink: '#fff', stage: 'Acquire', mark: '#EE5A2F', domain: 'vooads.com' },
    replyvoo: { name: 'Replyvoo', icon: 'reply', a: '#FFD65E', b: '#F0A90F', acc: '#111312', ink: '#111312', stage: 'Convert', mark: '#D49A00', domain: 'replyvoo.com' },
    castvoo: { name: 'Castvoo', icon: 'cast', a: '#5584FF', b: '#1A35A8', acc: '#C6D5FF', ink: '#fff', stage: 'Retain', mark: '#2449D8', domain: 'castvoo.com' },
    landvoo: { name: 'Landvoo', icon: 'land', a: '#FF74B0', b: '#C21F66', acc: '#FFE1EE', ink: '#fff', stage: 'Acquire', mark: '#E8458B', domain: 'landvoo.com' },
    affleego: { name: 'Affleego', icon: 'affleego', a: '#FFEB66', b: '#FFC21A', acc: '#111312', ink: '#111312', stage: 'Monetize', mark: '#C79100', domain: 'affleego.com' },
    other: { name: 'Bonuses and network', short: 'Bonuses', icon: 'voosquare', a: '#15422F', b: '#06110C', acc: '#C9F65B', ink: '#fff', stage: '', mark: '#7A8C84', domain: 'voosquare.com' },
    gatevoo: { name: 'Gatevoo', icon: 'gatevoo', a: '#0F2A22', b: '#06110C', acc: '#C9F65B', ink: '#fff', stage: 'Collect', mark: '#0FA3A3', domain: 'gatevoo.com' },
  };
  const brand = (k) => BRAND[k] || { name: k || 'VooSquare', short: k || 'VooSquare', icon: 'voosquare', a: '#15422F', b: '#06110C', acc: '#C9F65B', ink: '#fff', stage: '', mark: '#00A86B', domain: 'voosquare.com' };
  const pname = (k, plan) => { const b = brand(k); return (b.short || b.name) + (plan ? ' ' + plan : ''); };
  const TSTYLE = [
    { bg: '#fff', fg: '#5A6A63', bd: '#8A9A93', perks: ['General manager from day one', 'Brand kit, Academy, Telegram alerts'] },
    { bg: '#12C784', fg: '#fff', bd: '#12C784', perks: ['New creatives 48 hours early', 'Contest score x1.05'] },
    { bg: '#00774B', fg: '#fff', bd: '#00774B', perks: ['Private manager and CPA deals', 'Faster payouts'] },
    { bg: '#0A1611', fg: '#C9F65B', bd: '#C9F65B', perks: ['Custom coupon codes', 'Custom Landvoo landing pages'] },
    { bg: '#0FA3A3', fg: '#fff', bd: '#0FA3A3', perks: ['Payouts within 1 business day', 'Custom CPA amounts'] },
    { bg: '#0A1611', fg: '#E3C46A', bd: '#C9A445', perks: ['Early access to new tools', 'Co-branded pages and creatives'] },
    { bg: '#0A1611', fg: '#fff', bd: '#C9F65B', perks: ['Custom deal on everything', "Direct line to Dchessking's team"] },
  ];
  const DEFAULT_TIERS = [['Starter', 0, 2000], ['Pro', 10, 2500], ['Elite', 30, 3000], ['Master', 75, 3500], ['Partner', 150, 4000], ['Senior Partner', 250, 4500], ['Legend', 400, 5000]];
  /** Tiers with style: from /api/aff/public when loaded. */
  function tiers() {
    const src = (S.pub && S.pub.tiers && S.pub.tiers.length) ? S.pub.tiers : DEFAULT_TIERS.map(([name, min, rate_bp], i) => ({ name, min, rate_bp, approval: i === 6 }));
    return src.map((t, i) => ({ ...TSTYLE[Math.min(i, TSTYLE.length - 1)], n: t.name, min: t.min, max: src[i + 1] ? src[i + 1].min - 1 : null, rate: t.rate_bp / 100, approval: !!t.approval, payout_days: t.payout_days, i }));
  }
  const tier = (name) => tiers().find((t) => t.n === name) || tiers()[0];

  /* People: VS.avatar configs. Fixed faces for the illustrations; real people use their own Voo ID avatar. */
  const F = {
    amara: { skin: 2, hair: 1, hairColor: 0, eyes: 0, mouth: 1, acc: 2, shirt: 0, bg: 0 },
    tunde: { skin: 4, hair: 4, hairColor: 0, eyes: 0, mouth: 1, acc: 0, shirt: 3, bg: 1 },
    chidinma: { skin: 1, hair: 5, hairColor: 1, eyes: 1, mouth: 1, acc: 2, shirt: 1, bg: 4 },
    kwame: { skin: 6, hair: 4, hairColor: 0, eyes: 0, mouth: 0, acc: 1, shirt: 5, bg: 7 },
    fatima: { skin: 0, hair: 2, hairColor: 1, eyes: 0, mouth: 0, acc: 0, shirt: 7, bg: 6 },
  };
  const faceN = (i) => ({ skin: (i * 3 + 1) % 8, hair: (i * 5 + 2) % 6, hairColor: i % 5, eyes: i % 3, mouth: (i + 1) % 3 === 2 ? 1 : (i + 1) % 3, acc: (i * 7) % 4, shirt: (i * 3 + 2) % 8, bg: (i * 5 + 3) % 8 });
  const avOf = (cfg, seed) => (cfg && typeof cfg === 'object' && Object.keys(cfg).length ? cfg : faceN(hashStr(seed) % 97));

  const face = (cfg, size = 'sm', cls = '') => `<span class="av av-${size} ${cls}">${VS.avatar(cfg || F.amara)}</span>`;
  function pi(key, size = 'md') {
    if (key === 'premium' || key === 'room') return `<span class="pi pi-${size} pi-prem">${VS.pmark(size === 'xs' ? 'sm' : 'md', 'inv')}</span>`;
    const b = BRAND[key];
    if (!b) return VS.productIcon({ icon: 'voosquare' }, size);
    return VS.productIcon({ icon: b.icon, name: b.name }, size);
  }
  /* A product icon drawn inside an SVG scene. */
  function piSvg(key, x, y, s) {
    const bgMap = { premium: ['#15422F', '#06110C'], spyvoo: ['#3355F0', '#3355F0'], joinvoo: ['#7C5CFF', '#5B3FE8'], vooads: ['#111312', '#111312'], replyvoo: ['#111312', '#111312'], castvoo: ['#5B86FF', '#2449D8'], landvoo: ['#FF7DB5', '#E8458B'], affleego: ['#FFE14D', '#FFE14D'] }[key];
    const gid = 'pg' + key + Math.round(x) + Math.round(y);
    let inner = key === 'premium'
      ? `<rect x="5" y="9" width="11" height="11" rx="3" fill="#C9F65B"/><rect x="17" y="4" width="4.5" height="4.5" rx="1.3" fill="#fff"/>`
      : VS.PI[BRAND[key].icon].replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    if (key !== 'premium' && /^<svg[^>]*fill="none"/.test(VS.PI[BRAND[key].icon])) {
      const m = /^<svg([^>]*)>/.exec(VS.PI[BRAND[key].icon])[1].replace(/viewBox="[^"]*"/, '');
      inner = `<g${m}>${inner}</g>`;
    }
    return `<g transform="translate(${x} ${y})"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bgMap[0]}"/><stop offset="1" stop-color="${bgMap[1]}"/></linearGradient></defs>
      <rect x="${-s / 2}" y="${-s / 2}" width="${s}" height="${s}" rx="${s * 0.3}" fill="url(#${gid})" stroke="rgba(255,255,255,.14)"/>
      <g transform="translate(${-s * 0.31} ${-s * 0.31}) scale(${(s * 0.62) / 24})">${inner}</g></g>`;
  }
  const tierBadge = (name, cls = '') => { const t = tier(name); return `<span class="tb-badge ${cls}" style="--tb:${t.bg};--tf:${t.fg};--tbd:${t.bd}"><i></i>${esc(t.n)}</span>`; };
  const ST = {
    pending_activation: ['w', 'Waiting for activation'], hold: ['w', 'On hold'], available: ['g', 'Available'], in_review: ['amb', 'In review'], declined: ['r', 'Declined'], reversed: ['r', 'Reversed'], paid: ['g', 'Paid'],
    requested: ['amb', 'Requested'], approved: ['g', 'Approved'], processing: ['b', 'Sending'], rejected: ['r', 'Not sent'], cancelled: ['w', 'Cancelled'], held: ['amb', 'Under review'],
    pending: ['amb', 'Pending'], qualified: ['g', 'Qualified'], tracked: ['w', 'Tracked'], not_commissionable: ['w', 'Not commissionable'], before_approval: ['w', 'Before approval'], signed_up: ['w', 'Signed up'], paying: ['g', 'Paying'],
    refunded: ['r', 'Refunded'], charged_back: ['r', 'Charged back'], excluded: ['w', 'Excluded'], verified: ['g', 'Verified'], none: ['w', 'Not started'], suspended: ['r', 'Paused'], closed: ['w', 'Closed'], active: ['g', 'Active'], paused: ['r', 'Paused'],
    sent: ['g', 'Sent'], retry: ['amb', 'Retrying'], dead: ['r', 'Failed'], live: ['g', 'Live'], upcoming: ['b', 'Upcoming'], qualifying: ['amb', 'Qualifying'], pending_signoff: ['amb', 'Awaiting sign-off'], completed: ['g', 'Completed'], ended: ['w', 'Ended'],
  };
  /* Custom RevShare deals (owner only; shown to that affiliate and staff, never on the public site). Above 50% = Special deal. */
  const sdTag = (d, sm = false) => (d && d.special ? `<span class="sd-tag${sm ? ' sm' : ''}" title="Special deal">${icon('star')}Special deal</span>` : '');
  const dealWhen = (d) => (!d.ends_at ? 'No end date' : `${d.live === false ? `Starts ${ds(d.starts_at)} · ` : ''}Ends ${ds(d.ends_at - 1)}${d.days_left != null ? ` · ${d.days_left} day${d.days_left === 1 ? '' : 's'} left` : ''}`);
  const dealBanner = (L, staff = false) => (L && L.length ? `<section class="sd-banner" data-custom-deals>${L.map((d) => `<div class="sd-row${d.special ? ' sp' : ''}">${d.special ? sdTag(d) : `<span class="sd-tag cu">${icon('percent')}Custom deal</span>`}<b>${esc(String(d.rate_bp / 100))}% RevShare</b><span>on ${esc(d.product)}</span><small>${esc(dealWhen(d))}</small></div>`).join('')}<p class="sd-note">${staff ? 'Owner-set custom deal. Visible to this affiliate and the team only, never public. Applies to payments inside these dates, then the tier rate applies again.' : 'Agreed for your account only. It applies to payments made inside these dates; after that your tier rate applies again.'}</p></section>` : '');
  const statusPill = (s, label) => { const m = ST[s] || ['w', s]; return `<span class="st st-${m[0]}">${esc(label || m[1])}</span>`; };
  const delta = (v) => (v == null ? '<span class="dl dl-0">New this period</span>' : v === 0 ? '<span class="dl dl-0">Same</span>' : `<span class="dl ${v > 0 ? 'dl-up' : 'dl-dn'}">${v > 0 ? '+' : '−'}${fmt(Math.abs(v), Math.abs(v) < 10 && v % 1 ? 1 : 0)}%</span>`);
  const empty = (ic, title, sub = '', act = '') => `<div class="empty">${icon(ic)}<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}${act}</div>`;
  const errBox = (msg) => `<div class="empty err-box">${icon('alert')}<b>${esc(msg || 'Something went wrong.')}</b><span>Check your connection and try again.</span><button class="btn btn-w btn-sm" data-retry>${icon('refresh')}Try again</button></div>`;
  const skel = (n = 3, h = 120) => `<div class="skl">${Array.from({ length: n }, () => `<i style="height:${h}px"></i>`).join('')}</div>`;

  /** Decorative QR code for illustrations (the real one comes from the server). */
  function qr(text, size = 148, fg = '#0A1A13') {
    let h = hashStr(text); const n = 25; let rects = '';
    const finder = (x, y) => `<rect x="${x}" y="${y}" width="7" height="7" rx="1.4" fill="${fg}"/><rect x="${x + 1}" y="${y + 1}" width="5" height="5" rx="1" fill="#fff"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx=".7" fill="${fg}"/>`;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if ((x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9)) continue;
      h = (h * 1103515245 + 12345) >>> 0;
      if ((h >> 7) % 100 < 47) rects += `<rect x="${x}" y="${y}" width="1" height="1" rx=".3"/>`;
    }
    return `<svg class="qr" viewBox="-1 -1 ${n + 2} ${n + 2}" width="${size}" height="${size}" role="img" aria-label="QR code"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" rx="2" fill="#fff"/><g fill="${fg}">${rects}</g>${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
  }

  /* Progress ring. p in 0..1 */
  const ring = (p, size = 120, stroke = 10, col = 'var(--lime)', track = 'rgba(255,255,255,.1)') => {
    p = Math.max(0, Math.min(1, Number(p) || 0));
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/><circle class="ring-v" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${col}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c}" style="--to:${c * (1 - p)};--from:${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg>`;
  };

  /* ---------------- charts ---------------- */
  const CH = {};
  let chN = 0;
  const niceTop = (m) => { if (!(m > 0)) return 1; const e = Math.pow(10, Math.floor(Math.log10(m))); const f = m / e; return (f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
  /** Single-series area chart with crosshair tooltip. pts: [{x:label, v:number}] */
  function area(pts, { fmtv = (v) => usd(v), color = '#00A86B', h = 240, label = '' } = {}) {
    if (!pts.length) pts = [{ x: '', v: 0 }];
    if (pts.length === 1) pts = [pts[0], { ...pts[0] }];
    const id = 'ch' + (chN++);
    CH[id] = { pts, fmtv };
    const W = 800, H = h, pl = 8, pr = 8, pt = 16, pb = 26;
    const top = niceTop(Math.max(...pts.map((p) => p.v)) * 1.12);
    const X = (i) => pl + (i / (pts.length - 1)) * (W - pl - pr), Y = (v) => pt + (1 - v / top) * (H - pt - pb);
    let d = `M${X(0)} ${Y(pts[0].v)}`;
    for (let i = 1; i < pts.length; i++) { const x0 = X(i - 1), x1 = X(i), cx = (x0 + x1) / 2; d += ` C${cx} ${Y(pts[i - 1].v)} ${cx} ${Y(pts[i].v)} ${x1} ${Y(pts[i].v)}`; }
    const grid = [0.25, 0.5, 0.75, 1].map((f) => `<line x1="0" x2="${W}" y1="${Y(top * f)}" y2="${Y(top * f)}" class="gr"/>`).join('');
    const ylab = [0.25, 0.5, 0.75, 1].map((f) => `<span class="cl-y" style="top:${((Y(top * f) - 4) / H) * 100}%">${fmtv(top * f).replace(/\.00$/, '')}</span>`).join('');
    const step = Math.ceil(pts.length / 6);
    const xl = pts.map((p, i) => (i % step === 0 || i === pts.length - 1) && !(i !== pts.length - 1 && pts.length - 1 - i < step / 2) ? `<span class="cl-x ${i === 0 ? 'a0' : i === pts.length - 1 ? 'a1' : (i / step) % 2 ? 'odd' : ''}" style="left:${(X(i) / W) * 100}%">${esc(p.x)}</span>` : '').join('');
    const gid = id + 'g';
    return `<div class="chart" data-chart="${id}" style="--cc:${color}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${grid}<line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" class="ax"/>
      <path d="${d} L${X(pts.length - 1)} ${Y(0)} L${X(0)} ${Y(0)}Z" fill="url(#${gid})" class="ch-area"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" vector-effect="non-scaling-stroke" class="ch-line" pathLength="1"/>
      <line class="ch-x" x1="0" x2="0" y1="${pt}" y2="${Y(0)}" vector-effect="non-scaling-stroke"/></svg>
      ${ylab}${xl}<i class="ch-dot"></i><div class="ch-tip"></div></div>`;
  }
  function wireCharts(root) {
    $$('[data-chart]', root).forEach((el) => {
      if (el._w) return; el._w = 1;
      const c = CH[el.dataset.chart]; if (!c) return;
      const svg = el.querySelector('svg'), tip = el.querySelector('.ch-tip'), dot = el.querySelector('.ch-dot'), xl = el.querySelector('.ch-x');
      const vb = svg.viewBox.baseVal;
      const top = niceTop(Math.max(...c.pts.map((p) => p.v)) * 1.12);
      const move = (clientX) => {
        const r = svg.getBoundingClientRect();
        const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        const i = Math.round(fx * (c.pts.length - 1)); const p = c.pts[i];
        const x = 8 + (i / (c.pts.length - 1)) * (vb.width - 16);
        const y = 16 + (1 - p.v / top) * (vb.height - 42);
        const px = (x / vb.width) * r.width, py = (y / vb.height) * r.height;
        xl.setAttribute('x1', x); xl.setAttribute('x2', x);
        dot.style.transform = `translate(${px}px, ${py}px)`;
        tip.innerHTML = `<small>${esc(p.x)}</small><b>${c.fmtv(p.v)}</b>`;
        tip.style.transform = `translate(${Math.min(r.width - 130, Math.max(0, px - 65))}px, ${Math.max(0, py - 64)}px)`;
        el.classList.add('hov');
      };
      el.addEventListener('pointermove', (e) => move(e.clientX));
      el.addEventListener('pointerleave', () => el.classList.remove('hov'));
    });
  }
  /** Horizontal bars, one row per item: [{label, v, col, icon}] */
  function bars(items, { fmtv = usd0 } = {}) {
    const max = Math.max(...items.map((i) => i.v), 0) || 1;
    return `<div class="hbars">${items.map((i) => `<div class="hb"><span class="hb-l">${i.icon || ''}<b>${esc(i.label)}</b></span><span class="hb-t"><i style="--w:${Math.max(0, i.v / max).toFixed(3)};--c:${i.col || 'var(--brand)'}"></i></span><span class="hb-v">${fmtv(i.v)}</span></div>`).join('')}</div>`;
  }

  /* ---------------- overlays ---------------- */
  function overlay(kind, html, cls) {
    const m = document.createElement('div');
    m.className = `vs-${kind} ${cls}`;
    m.innerHTML = `<div class="vs-${kind}-p" role="dialog" aria-modal="true">${html}</div>`;
    const prev = document.activeElement;
    document.body.appendChild(m);
    const close = () => { m.remove(); document.removeEventListener('keydown', k); if (prev && prev.focus) try { prev.focus({ preventScroll: true }); } catch { /* gone */ } };
    const k = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', k);
    m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); });
    mount(m);
    const h = m.querySelector('h3'); if (h) { h.id = h.id || 'dlg' + (chN++); m.firstElementChild.setAttribute('aria-labelledby', h.id); }
    const f = m.querySelector('input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select,button:not(.x)'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
    return { el: m, close };
  }
  const modal = (html, cls = '') => overlay('modal', html, cls);
  const sheet = (html, cls = '') => overlay('sheet', html, cls);
  const mHead = (t, sub = '') => `<div class="vs-modal-h"><div><h3>${t}</h3>${sub ? `<p class="mh-sub">${sub}</p>` : ''}</div><button class="x" data-close aria-label="Close">${icon('x')}</button></div>`;
  /** Ask a question in a modal with one text field (or a select). Resolves the value or null. */
  function ask(title, sub, { label = '', value = '', placeholder = '', ok = 'Save', textarea = false, options = null, required = true, danger = false } = {}) {
    return new Promise((resolve) => {
      const field = options ? `<select class="inp" data-askv>${options.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
        : textarea ? `<textarea class="inp" data-askv placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input class="inp" data-askv value="${esc(value)}" placeholder="${esc(placeholder)}">`;
      const m = modal(`${mHead(title, sub)}<form class="vs-modal-b" data-askf><label class="field">${label ? `<span class="lbl">${label}</span>` : ''}${field}</label><p class="err" hidden></p><button class="btn ${danger ? 'btn-danger' : 'btn-g'}" type="submit">${ok}</button></form>`);
      let done = false;
      m.el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); const v = m.el.querySelector('[data-askv]').value.trim(); if (required && !v) { const er = m.el.querySelector('.err'); er.hidden = false; er.textContent = 'Fill this in first.'; return; } done = true; m.close(); resolve(v); });
      new MutationObserver((_, o) => { if (!document.body.contains(m.el)) { o.disconnect(); if (!done) resolve(null); } }).observe(document.body, { childList: true });
    });
  }

  /* ---------------- API ---------------- */
  const api = (path, opts) => VS.api(path, opts);
  const POST = (p, body = {}, headers) => VS.api(p, { body, headers });
  const PUT = (p, body = {}) => VS.api(p, { method: 'PUT', body });
  const PATCH = (p, body = {}) => VS.api(p, { method: 'PATCH', body });
  const DEL = (p) => VS.api(p, { method: 'DELETE', body: {} });
  /** Run an action from a button: disable it, show the server's error as a toast. */
  async function act(btn, fn, okMsg) {
    if (btn && btn.disabled) return null;
    if (btn) { btn.disabled = true; btn.classList.add('loading'); }
    try { const r = await fn(); if (okMsg) VS.toast(typeof okMsg === 'function' ? okMsg(r) : okMsg); return r || true; }
    catch (e) { VS.toast(e.message, 'err'); return null; }
    finally { if (btn && document.body.contains(btn)) { btn.disabled = false; btn.classList.remove('loading'); } }
  }
  /** Download a file from an API path (PDF, CSV, SVG) with the session cookie. */
  async function download(path, name) {
    try {
      const res = await fetch(path, { credentials: 'same-origin' });
      if (!res.ok) { let m = 'The file is not ready yet.'; try { m = (await res.json()).error || m; } catch { /* not json */ } throw new Error(m); }
      const blob = await res.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name || path.split('/').pop(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return true;
    } catch (e) { VS.toast(e.message, 'err'); return false; }
  }

  /* ---------------- motion: count up, in-view, pause off-screen ---------------- */
  let io;
  function mount(root) {
    VS.fillIcons(root);
    wireCharts(root);
    if (!io && 'IntersectionObserver' in window) {
      io = new IntersectionObserver((es) => es.forEach((e) => {
        const el = e.target;
        el.classList.toggle('off', !e.isIntersecting);
        if (e.isIntersecting && !el.classList.contains('inview')) {
          el.classList.add('inview');
          $$('[data-count]', el).forEach(countEl);
          if (el.matches('[data-count]')) countEl(el);
        }
        $$('svg', el).forEach((s) => { if (s.pauseAnimations && s.querySelector('animateMotion,animate,animateTransform')) { if (e.isIntersecting) s.unpauseAnimations(); else s.pauseAnimations(); } });
      }), { threshold: 0.08 });
    }
    $$('[data-io]', root).forEach((el) => { if (io) io.observe(el); else el.classList.add('inview'); });
    if (root.matches && root.matches('[data-io]') && io) io.observe(root);
    $$('[data-count]', root).forEach((el) => { if (!el.closest('[data-io]')) countEl(el); });
  }
  function countEl(el) {
    if (el._c) return; el._c = 1;
    VS.countUp(el, Number(el.dataset.count), { dec: Number(el.dataset.dec || 0), pre: el.dataset.pre || '', suf: el.dataset.suf || '', ms: Number(el.dataset.ms || 1200) });
  }
  /** Animated money figure (dollars). */
  const cnt = (v, { dec = 2, pre = '$', suf = '' } = {}) => { v = Number(v) || 0; const p = v < 0 ? '−' + pre : pre; return `<span data-count="${Math.abs(v)}" data-dec="${dec}" data-pre="${p}" data-suf="${suf}">${p}${fmt(Math.abs(v), dec)}${suf}</span>`; };
  const cntc = (cents, o) => cnt((Number(cents) || 0) / 100, o);

  /* ---------------- illustrations ---------------- */
  const note = (x, y, r) => `<g transform="rotate(${r} ${x + 19} ${y + 10})"><rect x="${x}" y="${y}" width="38" height="20" rx="3.5" fill="#12C784"/><rect x="${x + 3}" y="${y + 3}" width="32" height="14" rx="2" fill="none" stroke="#C9F65B" stroke-opacity=".55"/><rect x="${x + 15}" y="${y + 7}" width="6" height="6" rx="1.5" fill="#0A1A13" fill-opacity=".55"/><rect x="${x + 22}" y="${y + 5}" width="2.6" height="2.6" rx=".7" fill="#C9F65B"/></g>`;
  const coin = (x, y, s) => `<g><circle cx="${x}" cy="${y}" r="${s}" fill="#C9F65B"/><circle cx="${x}" cy="${y}" r="${s * 0.62}" fill="none" stroke="#7FAF1F" stroke-width="1.6"/></g>`;
  /** Cheering cartoon body with an avatar head, centred on x=180 in a 360x300 box. */
  function figure(a, { shirt = '#00A86B', notes = true } = {}) {
    a = { ...(a || F.amara), eyes: 1, mouth: 1 };
    const n = (k) => Math.abs(Number(a[k]) || 0) % VS.AV.counts[k];
    const skin = VS.AV.skins[n('skin')];
    const head = VS.avatar(a, {}).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
      .replace(/<rect width="64" height="64" fill="[^"]+"\/>/, '').replace(/<path d="M8 66C10 50[^>]*\/>/, '').replace(/<rect x="27.5" y="38"[^>]*\/>/, '');
    return `<g class="fig">
      <ellipse cx="180" cy="298" rx="84" ry="8" fill="#000" opacity=".22"/>
      <g class="fig-arm l"><path d="M150 232 Q120 204 112 156" stroke="${shirt}" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="111" cy="146" r="12" fill="${skin}"/>${notes ? note(84, 112, -24) : ''}</g>
      <g class="fig-arm r"><path d="M210 232 Q240 204 248 156" stroke="${shirt}" stroke-width="22" fill="none" stroke-linecap="round"/><circle cx="249" cy="146" r="12" fill="${skin}"/>${notes ? note(238, 110, 22) : ''}</g>
      <path d="M112 302C114 244 142 218 180 218C218 218 246 244 248 302Z" fill="${shirt}"/>
      <path d="M168 218L180 236L192 218" fill="#C9F65B"/>
      <rect x="169" y="190" width="22" height="30" rx="9" fill="${skin}"/>
      <g class="fig-head"><g transform="translate(96.8 66) scale(2.62)">${head}</g></g></g>`;
  }
  /* The money machine (public hero): product tiles send notes and coins into a balance card. Illustration with example figures. */
  function moneyMachine() {
    const keys = ['spyvoo', 'joinvoo', 'vooads', 'replyvoo', 'castvoo', 'landvoo', 'premium']; // affiliate program products only (Affleego is not in the program)
    const V = [250, 318];
    const step = 91 / (keys.length - 1);
    const T = Array.from({ length: keys.length }, (_, i) => { const a = (172 - i * step) * Math.PI / 180; return [Math.round(V[0] + Math.cos(a) * 232), Math.round(V[1] - 20 - Math.sin(a) * 262)]; });
    const paths = T.map(([x, y]) => { const c1 = [x + (V[0] - x) * 0.2, y + 60]; const c2 = [V[0] + (x - V[0]) * 0.12, V[1] - 110]; return `M${x} ${y} C${c1[0].toFixed(0)} ${c1[1]} ${c2[0].toFixed(0)} ${c2[1]} ${V[0]} ${V[1] - 30}`; });
    const DUR = 3.2;
    const movers = reduce ? '' : paths.map((d, i) => [0, 1].map((j) => {
      const begin = -(((i * 0.41) + j * 1.6) % DUR).toFixed(2);
      const shape = (i + j) % 2 ? coin(0, 0, 7) : note(-19, -10, (i - 3) * 8);
      return `<g opacity="0"><animateMotion dur="${DUR}s" begin="${begin}s" repeatCount="indefinite" path="${d}" calcMode="spline" keyPoints="0;1" keyTimes="0;1" keySplines=".45 0 .35 1"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.12;.85;1" dur="${DUR}s" begin="${begin}s" repeatCount="indefinite"/><g><animateTransform attributeName="transform" type="scale" values=".7;1.05;.4" keyTimes="0;.5;1" dur="${DUR}s" begin="${begin}s" repeatCount="indefinite"/>${shape}</g></g>`;
    }).join('')).join('');
    return `<div class="mm" data-io aria-hidden="true">
      <svg class="mm-svg" viewBox="0 0 600 470">
        <defs><radialGradient id="mmg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#C9F65B" stop-opacity=".32"/><stop offset="1" stop-color="#C9F65B" stop-opacity="0"/></radialGradient></defs>
        <circle cx="${V[0]}" cy="${V[1]}" r="220" fill="url(#mmg)"/>
        <g class="mm-orbit"><ellipse cx="${V[0]}" cy="${V[1] - 20}" rx="232" ry="262" fill="none" stroke="rgba(201,246,91,.13)" stroke-dasharray="2 9"/></g>
        ${paths.map((d) => `<path d="${d}" class="mm-trail"/>`).join('')}
        ${T.map(([x, y], i) => `<g class="mm-tile" style="animation-delay:-${(i * 0.37).toFixed(2)}s">${piSvg(keys[i], x, y, 50)}</g>`).join('')}
        <g class="mm-flow">${movers}</g>
        <g transform="translate(330 176) scale(.8)">${figure(F.amara)}</g>
      </svg>
      <div class="mm-vault"><small>Your balance <span class="ex">Example</span></small><b class="mm-bal">$7,781.00</b><span class="mm-bar"><i></i></span><em><i class="live-dot"></i>Lifetime RevShare on ${keys.length} tools</em></div>
      <div class="mm-alerts"></div>
    </div>`;
  }
  const ALERTS = [
    ['Qualified FTD', 'Joinvoo Pro · sub1=fb_ng_v3', '+$29.70', 'joinvoo'], ['CPA approved', 'Replyvoo Titan · available now', '+$300.00', 'replyvoo'],
    ['First payment', 'Spyvoo Pro · sub1=tt_ke_hook2', '+$23.70', 'spyvoo'], ['Payout sent', 'USDT (TRC20) · with tx hash', 'Paid', 'premium'], ['Payment', 'Vooads credits used', '+$30.00', 'vooads']];
  function runMoneyMachine(root) {
    const mm = $('.mm', root); if (!mm) return;
    const bal = $('.mm-bal', mm), box = $('.mm-alerts', mm);
    let total = 7781, k = 0;
    const tick = () => {
      if (!document.body.contains(mm)) return clearInterval(t1);
      if (mm.classList.contains('off') || document.hidden) return;
      const a = ALERTS[k++ % ALERTS.length];
      const el = document.createElement('div');
      el.className = 'mm-alert';
      el.innerHTML = `${pi(a[3], 'sm')}<span><small>VooSquare Affiliates · example alert</small><b>${esc(a[0])}</b><em>${esc(a[1])}</em></span><strong>${esc(a[2])}</strong>`;
      box.prepend(el);
      $$('.mm-alert', box).slice(2).forEach((x) => { x.classList.add('out'); setTimeout(() => x.remove(), 500); });
      const add = parseFloat(String(a[2]).replace(/[^\d.]/g, '')) || 0;
      if (add) { total += add; VS.countUp(bal, total, { dec: 2, pre: '$', ms: 900 }); bal.classList.remove('bump'); void bal.offsetWidth; bal.classList.add('bump'); }
    };
    tick();
    const t1 = setInterval(tick, reduce ? 6000 : 2600);
  }

  /* Tier staircase: a cartoon affiliate hops up one step at a time; each step lights as they land. */
  function stairs(current = 2, { climb = true, who = F.amara } = {}) {
    return `<div class="stairs" data-io data-current="${current}" data-climb="${climb ? 1 : 0}">
      ${tiers().map((t, i) => `<div class="step" style="--i:${i};--tb:${t.bg};--tf:${t.fg};--tbd:${t.bd}" data-step="${i}">
        <div class="step-top"><span class="step-rate">${fmt(t.rate, t.rate % 1 ? 1 : 0)}<small>%</small></span><span class="step-n">${esc(t.n)}</span></div>
        <div class="step-body"><span class="step-th">${t.max == null ? `${t.min}+ qualified FTDs` : `${t.min} to ${t.max} qualified FTDs`}${t.approval ? ' · approval' : ''}</span><ul>${t.perks.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
      </div>`).join('')}
      <div class="climber" aria-hidden="true"><svg viewBox="96 60 168 244">${figure(who, { notes: false })}</svg></div>
    </div>`;
  }
  function runStairs(root) {
    $$('.stairs', root).forEach((st) => {
      if (st._run) return; st._run = 1;
      const cl = $('.climber', st), steps = $$('.step', st);
      const target = Number(st.dataset.current);
      let i = st.dataset.climb === '1' ? 0 : target;
      const place = () => {
        const s = steps[i]; if (!s) return; const top = s.querySelector('.step-top');
        const sr = st.getBoundingClientRect(), r = top.getBoundingClientRect();
        cl.style.transform = `translate(${r.left - sr.left + r.width / 2 - cl.offsetWidth / 2}px, ${r.top - sr.top - cl.offsetHeight + 6}px)`;
        steps.forEach((x, j) => x.classList.toggle('lit', j <= i));
        steps.forEach((x, j) => x.classList.toggle('here', j === i));
      };
      place();
      addEventListener('resize', place);
      if (st.dataset.climb !== '1') return;
      const t = setInterval(() => {
        if (!document.body.contains(st)) return clearInterval(t);
        if (st.classList.contains('off') || reduce) return;
        i = i >= steps.length - 1 ? 0 : i + 1;
        cl.classList.remove('hop'); void cl.offsetWidth; cl.classList.add('hop');
        place();
      }, 1500);
    });
  }

  /** Podium for a contest top 3. rows: [{ name, score, avatar, sub }] (missing rows show an open place). */
  function podium(rows) {
    const order = [1, 0, 2];
    return `<div class="podium" data-io>${order.map((k) => { const r = rows[k] || { name: 'Open place', score: null, avatar: faceN(k + 7) }; return `<div class="pod pod-${k + 1}">
      <span class="pod-face">${face(avOf(r.avatar, r.name), 'lg')}<i class="pod-medal">${k + 1}</i></span>
      <b>${esc(r.name)}${r.country ? ` <span class="flag" title="${esc(cname(r.country))}">${flag(r.country)}</span>` : ''}</b><small>${r.sub != null ? esc(r.sub) : r.score != null ? `${fmt(r.score, r.score % 1 ? 1 : 0)} pts` : '–'}</small><div class="pod-block"><span>${['1st', '2nd', '3rd'][k]}</span></div></div>`; }).join('')}
      <div class="pod-spark">${Array.from({ length: 10 }, (_, j) => `<i style="--j:${j}"></i>`).join('')}</div></div>`;
  }

  /* Brand mini scenes (offer cards and posters). Illustrations of each tool. */
  function brandScene(key) {
    const f = (i) => face(faceN(i), 'xs');
    switch (key) {
      case 'premium': return `<div class="bs bs-prem"><div class="bs-live"><i class="live-dot"></i>Live breakdown · monthly</div>${VS.pmark('xl', 'inv')}<div class="bs-rooms"><span>Buyers' Lounge</span><span>Scaling Desk</span><span>Offer Drops</span></div></div>`;
      case 'spyvoo': return `<div class="bs bs-spy"><div class="bs-feed">${[['Running 94 days', 'NG', 82], ['Running 41 days', 'KE', 64], ['Running 128 days', 'ZA', 91], ['Running 12 days', 'GH', 38]].map((r, i) => `<div class="bs-ad"><i class="bs-thumb" style="--h:${200 + i * 30}"></i><span><b>${r[0]}</b><small>${r[1]} · hook score ${r[2]}</small></span></div>`).join('')}</div><div class="bs-lens">${VS.PI.spyvoo}</div></div>`;
      case 'joinvoo': return `<div class="bs bs-join"><div class="bs-jfeed"><div class="bs-jf-in">${[['Ade', 'VIP signals', 'Ad 3 · hook v3', 'Join'], ['Wanjiru', 'Kenya FX', 'Ad 1 · UGC', 'Deposit $50'], ['Kofi', 'VIP signals', 'Ad 3 · hook v3', 'Join'], ['Thabo', 'SA Traders', 'Ad 2 · static', 'Sign-up'], ['Ngozi', 'VIP signals', 'Ad 5 · Pidgin', 'Deposit $120'], ['Musa', 'Kenya FX', 'Ad 1 · UGC', 'Join'], ['Ade', 'VIP signals', 'Ad 3 · hook v3', 'Join'], ['Wanjiru', 'Kenya FX', 'Ad 1 · UGC', 'Deposit $50'], ['Kofi', 'VIP signals', 'Ad 3 · hook v3', 'Join']].map((r, i) => `<div class="bs-jr">${f(i * 3 + 1)}<span><b>${r[0]} · ${r[1]}</b><small>${r[2]}</small></span><em class="${/Deposit/.test(r[3]) ? 'dep' : ''}">${r[3]}</em></div>`).join('')}</div></div><div class="bs-count"><small>Real joins today</small><b>1,284</b></div><div class="bs-joins">${[1, 4, 7, 9, 12].map((i, j) => `<span style="--j:${j}">${f(i)}<em>+1 join</em></span>`).join('')}</div><div class="bs-meta"><i>${icon('check')}</i>Sent to Meta CAPI</div></div>`;
      case 'vooads': return `<div class="bs bs-ads"><div class="bs-frames"><span class="fr fr-9"><i>${icon('play')}</i><em>Pidgin</em></span><span class="fr fr-1"><i>${icon('play')}</i><em>Swahili</em></span><span class="fr fr-16"><i>${icon('play')}</i><em>French</em></span></div><div class="bs-check"><i>${icon('check')}</i>Meta policy check passed</div></div>`;
      case 'replyvoo': return `<div class="bs bs-reply"><div class="bs-msg in">Is the Pro plan good for Ghana?</div><div class="bs-msg out">Yes. Pro covers GH, NG and KE. Want the link?</div><div class="bs-msg in">Send it</div><div class="bs-msg out pay">${icon('card')} Payment link sent</div></div>`;
      case 'castvoo': return `<div class="bs bs-cast"><span class="bs-wave"></span><span class="bs-wave w2"></span><span class="bs-wave w3"></span><i class="bs-core">${VS.PI.cast}</i>${['VIP group', 'New joiners', 'Kenya list', 'Day 3 drip'].map((g, j) => `<em class="bs-g g${j}">${g}</em>`).join('')}</div>`;
      case 'landvoo': return `<div class="bs bs-land"><div class="bs-page"><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><i class="l5"></i></div><span class="bs-stamp">${icon('check')}Passed review</span></div>`;
    }
    return '';
  }

  /* Payout state track */
  function payTrack(holdDays = 0) {
    const st = [holdDays > 0 ? ['clock', 'On hold', `${holdDays} days, then available`] : ['bolt', 'Earned', 'Instantly, on every payment'], ['wallet', 'Available', holdDays > 0 ? 'Ready to withdraw' : 'Straight away, no hold'], ['send', 'Requested', 'With our finance team'], ['check', 'Paid', 'In your wallet with tx hash']];
    return `<div class="ptrack" data-io>${st.map((s, i) => `<div class="pt-s" style="--i:${i}"><span class="pt-ic">${icon(s[0])}</span><b>${s[1]}</b><small>${s[2]}</small></div>`).join('')}<i class="pt-line"></i><i class="pt-coin">${'<svg viewBox="-9 -9 18 18">' + coin(0, 0, 8) + '</svg>'}</i></div>`;
  }
  const celebrate = () => { if (!reduce) VS.confetti(); };

  /* Markdown (affiliate terms): headings, quotes, rules, paragraphs, bold, code. Escapes everything first. */
  function terms(md) {
    const toc = []; let n = 0;
    const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\[([^\]]+)\]\((\/(?!\/)[^)\s]*)\)/g, '<a href="$2">$1</a>'); // same-site links only ([Privacy Policy](/privacy))
    const html = String(md || '').split(/\r?\n/).map((l) => {
      if (/^#\s/.test(l)) return `<h1>${inline(l.slice(2))}</h1>`;
      if (/^##\s/.test(l)) { const id = 't' + (++n); toc.push([id, l.slice(3)]); return `<h2 id="${id}">${inline(l.slice(3))}</h2>`; }
      if (/^###\s/.test(l)) return `<h3>${inline(l.slice(4))}</h3>`;
      if (/^>\s?/.test(l)) return `<div class="t-note">${inline(l.replace(/^>\s?/, ''))}</div>`;
      if (/^---+$/.test(l.trim()) || !l.trim()) return '';
      if (/^[-*]\s/.test(l)) return `<p class="t-li">${inline(l.slice(2))}</p>`;
      return `<p>${inline(l)}</p>`;
    }).join('\n');
    return { html, toc };
  }
  let termsCache = null;
  async function loadTerms() { if (!termsCache) { const r = await api('/api/aff/terms'); termsCache = { ...terms(r.markdown), version: r.version }; } return termsCache; }

  /* ================= state, router ================= */
  const S = window.AFS = { pub: null, user: null, me: null, staff: undefined, mode: 'aff', role: 'site', cache: {} };
  const R = {};
  let seq = 0, loader = null, after = [];
  /** A shell page that loads its body: the router shows the shell with a skeleton, then fills #pg. */
  function deferred(html, load, fns) { loader = load; after = fns || []; return html; }

  /** Staff with any affiliate role (owners have all); only they ask for the back-office profile. */
  const isStaff = (u) => !!u && Array.isArray(u.perms) && u.perms.some((p) => p === '*' || p === 'payments' || /^aff_/.test(p));
  async function loadStaff() { S.staff = null; if (!isStaff(S.vooUser)) return; try { S.staff = await api('/api/admin/aff/me'); } catch { S.staff = null; } }
  async function boot() {
    // /api/me answers 200 signed in or out, so a signed-out visitor never triggers a 401 in the console.
    const [pub, who] = await Promise.allSettled([api('/api/aff/public'), api('/api/me')]);
    if (pub.status === 'fulfilled') S.pub = pub.value;
    else if (pub.reason && pub.reason.data && pub.reason.data.off) S.off = true;
    S.vooUser = who.status === 'fulfilled' && who.value ? who.value.user : null;
    if (S.vooUser) {
      S.user = { name: S.vooUser.name, email: S.vooUser.email, id: S.vooUser.id };
      try { const me = await api('/api/aff/me'); S.me = me.account; } catch (e) { if (e.data && e.data.off) S.off = true; }
      await loadStaff();
    }
    if (S.me && S.me.status === 'approved') liveUpdates();
  }
  async function refreshMe() { const r = await api('/api/aff/me'); S.me = r.account; if (r.account) S.user = { name: r.account.name, email: r.account.email }; return S.me; }
  function homeFor() {
    if (S.me && S.me.status !== 'closed') return S.me.applied || S.me.status === 'approved' || S.me.status === 'suspended' ? '#/aff/home' : `#/join/${Math.min(4, (S.me.app_step || 0) + 1)}`;
    if (S.staff && S.staff.roles) return staffHome();
    return '#/site';
  }
  function staffHome() { const r = (S.staff && S.staff.roles) || {}; return r.admin ? '#/admin/overview' : r.manager ? '#/mgr/home' : r.fraud ? '#/fraud/queue' : r.finance ? '#/fin/payouts' : '#/site'; }
  /** Bell and sidebar badge for unread notifications, without re-rendering the page. */
  function setUnread(n) {
    S.cache.unread = n;
    const t = $('.tb-ic'); if (t) { let i = t.querySelector('i'); if (!n) { if (i) i.remove(); } else { if (!i) { t.insertAdjacentHTML('beforeend', '<i></i>'); i = t.querySelector('i'); } i.textContent = n > 9 ? '9+' : n; } }
    $$('a[href="#/aff/notifications"]').forEach((a) => { if (!a.closest('.sb-g')) return; let b = a.querySelector('.bdg'); if (!n) { if (b) b.remove(); } else { if (!b) { a.insertAdjacentHTML('beforeend', '<i class="bdg"></i>'); b = a.querySelector('.bdg'); } b.textContent = n > 9 ? '9+' : n; } });
  }
  let stream = null;
  function liveUpdates() {
    if (stream || !S.me) return;
    // The affiliate's own channel is the Voo ID (user:<id>); the server pushes notifications and Telegram connects.
    Promise.resolve(S.vooUser && S.vooUser.id ? { user: S.vooUser } : api('/api/me')).then((r) => {
      if (!r || !r.user || !r.user.id) return;
      stream = VS.stream(['user:' + r.user.id], { aff: (d) => {
        if (d.kind === 'telegram_connected') { VS.toast('Telegram connected'); if (/postbacks|settings/.test(location.hash)) route(); return; }
        setUnread((S.cache.unread || 0) + 1);
        // The "Application sent" screen already says it: no toast on top of its buttons (QA-32).
        if (d.text && !(d.kind === 'applied' && /\/join\//.test(location.hash))) VS.toast(d.text);
      } });
    }).catch(() => {});
  }

  let booted = null;
  async function route() {
    const my = ++seq;
    if (booted) { try { await booted; } catch { /* boot errors are shown per page */ } }
    if (my !== seq) return;
    let h = location.hash.replace(/^#\/?/, '');
    if (!h) { location.replace(homeFor()); return; }
    if (h.startsWith('pend/')) { location.replace('#/aff/' + h.slice(5)); return; }
    const [role, page = '', ...rest] = h.split('/');
    const arg = decodeURIComponent(rest.join('/'));
    const r = R[role] ? role : 'site';
    S.role = r;
    loader = null; after = []; S._then = [];
    const app = document.getElementById('aff-app');
    $$('.vs-modal,.vs-sheet').forEach((m) => m.remove());
    let html;
    try { html = await R[r](page, arg); } catch (e) { console.error(e); html = `<div class="site"><section class="sec"><div class="wrap">${errBox(e.message)}</div></section></div>`; }
    if (my !== seq || html == null) return;
    window.scrollTo(0, 0);
    app.innerHTML = html;
    document.body.dataset.role = r;
    document.title = (($('.tb-t', app) || $('h1,h2', app) || {}).textContent || 'Affiliates').trim() + ' · VooSquare Affiliates';
    mount(app); runMoneyMachine(app); runStairs(app);
    const fns = after; const ld = loader;
    fns.forEach((f) => { try { f(app); } catch (e) { console.error(e); } });
    if (ld) {
      const pg = $('#pg', app);
      const fill = async () => {
        try {
          const body = await ld();
          if (my !== seq) return;
          if (typeof body === 'string') { pg.innerHTML = body; pg.classList.remove('loading'); }
          mount(pg); runStairs(pg);
          (R._after || []).forEach((f) => { try { f(app, r, page, arg); } catch (e) { console.error(e); } });
          (S._then || []).splice(0).forEach((f) => { try { f(pg); } catch (e) { console.error(e); } });
        } catch (e) {
          if (my !== seq) return;
          if (e.status === 401) { location.hash = '#/join/signin'; return; }
          if (e.data && e.data.no_account) { S.me = null; location.hash = '#/join/signin'; return; }
          if (e.data && e.data.off) { pg.innerHTML = offCard(); return; }
          pg.innerHTML = errBox(e.message); mount(pg);
          $('[data-retry]', pg).addEventListener('click', () => { pg.innerHTML = skel(); fill(); });
        }
      };
      fill();
    }
    const h1 = $('h1', app); if (h1 && document.activeElement === document.body) { h1.setAttribute('tabindex', '-1'); }
  }
  /** Run after the deferred body is in the page. */
  const then = (f) => { (S._then = S._then || []).push(f); };
  const offCard = () => `<div class="empty">${icon('lock')}<b>The affiliate program is switched off for now.</b><span>Your account, links and earnings are kept. Tracking keeps running.</span><a class="btn btn-w btn-sm" href="/">VooSquare home</a></div>`;
  addEventListener('hashchange', route);

  /* ---------------- shells ---------------- */
  const logo = (tag = '', href = '#/site') => `<a class="lg" href="${href}"><img src="/assets/logo-icon.svg" alt="" width="34" height="34"><span>VooSquare</span>${tag ? `<em>${tag}</em>` : ''}</a>`;
  /** Night sidebar + top bar + bottom bar (mobile). nav: [[group, [[href, icon, label, badge, key]]]] */
  function shell({ page, title, nav, who, banner = '', body, mobileNav, topRight = '', tag = 'Affiliates', foot = '', search = '' }) {
    const item = ([href, ic, label, badge, key]) => `<a href="${href}" class="${key === page ? 'on' : ''}" ${key === page ? 'aria-current="page"' : ''}>${icon(ic)}<span>${label}</span>${badge ? `<i class="bdg">${badge}</i>` : ''}</a>`;
    return `<div class="sh">
      <aside class="sb" id="sb" aria-label="Menu"><div class="sb-in">${logo(tag, '#/site')}
        <div class="sb-who">${who}</div>
        ${nav.map(([g, items]) => `<nav class="sb-g" aria-label="${esc(g || 'Main')}">${g ? `<small>${g}</small>` : ''}${items.map(item).join('')}</nav>`).join('')}
        <div class="sb-foot">${foot}</div>
      </div></aside>
      <div class="mn">
        <header class="tbar"><button class="tb-menu" data-menu aria-label="Menu">${icon('menu')}</button><h1 class="tb-t">${title}</h1>
          ${search}
          <div class="tb-r">${topRight}</div></header>
        ${banner}
        <main class="pg${body == null ? ' loading' : ''}" id="pg">${body == null ? skel(3, 140) : body}</main>
      </div>
      ${mobileNav || ''}
    </div>`;
  }
  document.addEventListener('click', (e) => {
    const m = e.target.closest('[data-menu]');
    if (m) { const sb = $('#sb'); if (sb) { const s = sheet(`<div class="drawer">${sb.firstElementChild.innerHTML}</div>`, 'sheet-left'); s.el.addEventListener('click', (ev) => { if (ev.target.closest('a[href]')) s.close(); }); } }
    const cp = e.target.closest('[data-copy]');
    if (cp) { e.preventDefault(); VS.copyText(cp.dataset.copy); }
    const tgl = e.target.closest('[data-acc]');
    if (tgl) { const it = tgl.closest('.acc-i'); it.classList.toggle('open'); tgl.setAttribute('aria-expanded', it.classList.contains('open')); }
    const lo = e.target.closest('[data-logout]');
    if (lo) { e.preventDefault(); POST('/api/auth/logout').catch(() => {}).finally(() => { S.user = null; S.me = null; S.staff = null; location.hash = '#/site'; location.reload(); }); }
    const dl = e.target.closest('[data-dl]');
    if (dl) { e.preventDefault(); act(dl, () => download(dl.dataset.dl, dl.dataset.name)); }
  });

  window.AF = {
    VS, S, R, $, $$, esc, icon, fmt, usd, usd0, $c, $c0, pct, dt, ds, tm, dtm, ago, dayLabel, monthLabel, daysLeft, hashStr, cname, flag, COUNTRIES, countryOptions,
    BRAND, brand, pname, tiers, tier, F, faceN, avOf, face, pi, piSvg, tierBadge, statusPill, sdTag, dealWhen, dealBanner, delta, empty, errBox, skel, qr, ring, area, bars, modal, sheet, mHead, ask,
    api, POST, PUT, PATCH, DEL, act, download, mount, cnt, cntc, figure, note, coin, moneyMachine, stairs, runStairs, podium, brandScene, payTrack, celebrate, loadTerms,
    shell, logo, route, deferred, setUnread, loadStaff, isStaff, then, refreshMe, homeFor, staffHome, liveUpdates, offCard,
  };
  addEventListener('DOMContentLoaded', () => {
    booted = boot().catch((e) => console.error(e));
    route();
  });
})();
