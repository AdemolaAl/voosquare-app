/* VooSquare member app: VooSquare Academy (the school). The route hero at the top of the Academy, school and module pages, the full-screen
 * lesson player (slides, glossary, recap, quiz), module and final exams, and certificates (PDF, PNG, verify, LinkedIn).
 * All grading happens on the server (src/school.js); this file only shows questions and results. */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { esc, icon } = VS;
  /* Objectives sit under "By the end you can", so each one reads as the end of that sentence: no repeated "You can",
   * no "By the end you can" inside the item, and a capital first letter like the other list items. */
  const objective = (o) => { const t = String(o || '').trim().replace(/^(by the end,? )?(you can|you will be able to|you'll be able to)\s+/i, ''); return t.charAt(0).toUpperCase() + t.slice(1); };
  const S = A.S;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STAGES = { foundations: 'Foundations', operator: 'Operator', scale: 'Scale' };
  const shortName = (s) => STAGES[s.slug] || s.title;

  /* ---------------- time ---------------- */
  let skew = 0; // server clock minus this device's clock, so countdowns match the server's pacing
  const nowS = () => Date.now() + skew;
  const syncClock = (d) => { if (d && d.now) skew = d.now - Date.now(); };
  const hm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  function opensText(t) {
    const d = new Date(t), n = new Date(nowS());
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(n)) / 86400000);
    if (diff <= 0) return `Opens today at ${hm(t)}`;
    if (diff === 1) return `Opens tomorrow at ${hm(t)}`;
    return `Opens ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} at ${hm(t)}`;
  }
  function left(t, secs) {
    let s = Math.max(0, Math.round((t - nowS()) / 1000));
    const h = Math.floor(s / 3600); s -= h * 3600; const m = Math.floor(s / 60); s -= m * 60;
    if (secs) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m} min` : 'under a minute';
  }
  /** Live countdowns: [data-until] elements show time left; when one hits zero the page refreshes itself. */
  function ticker(root, onZero) {
    const tick = () => {
      let zero = false;
      root.querySelectorAll('[data-until]').forEach((el) => {
        const t = Number(el.dataset.until);
        if (t <= nowS()) { if (!el.dataset.z) { el.dataset.z = 1; zero = true; } el.textContent = 'now'; return; }
        el.textContent = left(t, el.dataset.secs === '1');
      });
      if (zero && onZero) onZero();
    };
    tick();
    const iv = setInterval(() => { if (!root.isConnected) { clearInterval(iv); return; } tick(); }, 1000);
    return () => clearInterval(iv);
  }

  /* ---------------- small pieces ---------------- */
  const founderFace = () => VS.founder().replace(/<g transform="translate\(100 34\)">[\s\S]*?<\/g>/, '');
  const teamFace = () => `<span class="sch-team">${VS.PI.voosquare}</span>`;
  /* VooSquare Academy lives in two places with the same account and progress: inside VooSquare and on its own site
   * (voosquareacademy.com). Each side links to the other with the one-tap switch (A.switchTo): "Also at
   * voosquareacademy.com" here, "Part of VooSquare" in learn mode. Same Voo ID, already signed in on arrival. */
  const LEARN_MODE = !!A.LEARN;
  const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
  function siteLink(d) {
    const links = d.links || {};
    if (LEARN_MODE) return `<button type="button" class="sh-also" data-switch="/app#community">${VS.productIcon({ icon: 'voosquare' }, 'xs')}<span>Part of VooSquare · open the community</span>${icon('arrow')}</button>`;
    const host = hostOf(links.academy || '');
    return host ? `<button type="button" class="sh-also" data-acad-site>${icon('ext')}<span>Also at ${esc(host)}</span></button>` : '';
  }
  /** VooSquare → the academy's own site, signed in, on the same page (#academy, #school/…, #module/…, #cert/…). */
  const openAcademySite = (btn) => A.switchTo('academy', '/learn' + (/^#(academy|school|module|cert)\b/.test(location.hash) ? location.hash : '#academy'), btn);
  /** Progress ring (SVG). pct 0..100. */
  function ring(pct, size = 64, stroke = 6, cls = '') {
    const r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return `<svg class="sch-ring ${cls}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle class="rg-t" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/><circle class="rg-v" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - Math.min(100, Math.max(0, pct)) / 100)).toFixed(1)}" style="--c:${c.toFixed(1)}"/></svg>`;
  }
  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim() : `${m} min`);
  const pctOf = (a, b) => (b ? Math.round(a / b * 100) : 0);
  function moduleBadge(m) {
    if (m.status === 'passed') return `<span class="sch-st ok">${icon('check')}Passed${m.exam.best ? ` · ${m.exam.best}%` : ''}</span>`;
    if (m.status === 'open') return `<span class="sch-st go">${m.exam.available ? 'Exam ready' : 'Open'}</span>`;
    if (m.status === 'waiting') return `<span class="sch-st wait">${icon('clock')}<span data-until="${m.opens_at}"></span></span>`;
    if (m.status === 'enroll') return `<span class="sch-st lock">${icon('id')}Enrol first</span>`;
    if (m.status === 'premium') return `<span class="sch-st lock">${VS.pmark('sm')}Premium</span>`;
    return `<span class="sch-st lock">${icon('lock')}Locked</span>`;
  }
  function lockCopy(s, m) {
    if (s.status === 'premium') return `${esc(s.title)} is part of Premium.`;
    if (s.status === 'prereq') return `Opens when you earn the ${esc(s.prev_title)} certificate.`;
    if (m && m.status === 'waiting') return `${opensText(m.opens_at)}.`;
    if (m && m.status === 'locked') return 'Opens after you pass the exam of the module before it.';
    return '';
  }

  /* =====================================================================
   * STUDENT CARD (enrolment) and the CHOOSE YOUR VERTICAL sheet
   * ===================================================================== */
  const VGLYPH = {
    nutra: '<path d="M5 19c0-8 5-14 14-14 0 9-6 14-14 14z"/><path d="M5 19l8-8"/>',
    igaming: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.3" fill="currentColor"/><circle cx="15" cy="15" r="1.3" fill="currentColor"/><circle cx="15" cy="9" r="1.3" fill="currentColor"/><circle cx="9" cy="15" r="1.3" fill="currentColor"/>',
    trading: '<path d="M4 18l5-6 4 3 7-9"/><path d="M15 6h5v5"/>',
    finance: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
    sweeps: '<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S9 9 12 9zM12 9c2-4 6-4 6-1.5S15 9 12 9z"/>',
  };
  const vglyph = (k) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${VGLYPH[k] || VGLYPH.trading}</svg>`;
  /** Decorative barcode from the student number (stable for the same number). */
  function bars(num) {
    let h = 7; let x = 0; let out = '';
    for (const c of String(num)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    while (x < 196) { h = (h * 1103515245 + 12345) >>> 0; const w = 1 + (h % 3); out += `<rect x="${x}" y="0" width="${w}" height="26"/>`; x += w + 1 + ((h >> 4) % 3); }
    return `<svg class="idc-bars" viewBox="0 0 200 26" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`;
  }
  function studentCard(c, { cls = '' } = {}) {
    return `<div class="idc ${c.premium ? 'prem' : ''} ${c.track === 'vertical' ? 'vert' : ''} ${cls}" style="${c.accent ? `--acc:${esc(c.accent)}` : ''}" role="img" aria-label="${esc(`VooSquare Academy student card: ${c.name}, ${c.number}, ${c.school}`)}">
      <div class="idc-in">
        <div class="idc-front">
          <i class="idc-grid"></i><i class="idc-holo"></i>
          <div class="idc-top"><span class="idc-brand">${VS.PI.voosquare}<span class="idc-lock"><b>VooSquare</b><em>Academy</em></span></span><span class="idc-kind">${c.premium ? VS.pmark('sm', 'still') : ''}Student</span></div>
          <div class="idc-mid"><span class="idc-face">${VS.avatar(c.avatar || {}, { still: true })}</span>
            <div class="idc-who"><small>Name</small><b class="idc-name">${esc(c.name)}</b><small>Student number</small><b class="idc-num">${esc(c.number)}</b></div></div>
          <div class="idc-bot"><div><small>School</small><b>${esc(c.school)}</b></div><div><small>Level</small><b>${esc(c.level)}</b></div><div><small>Issued</small><b>${esc(VS.dateStr(c.issued_at))}</b></div></div>
          ${bars(c.number)}
        </div>
        <div class="idc-back" aria-hidden="true"><i class="idc-grid"></i>${VS.PI.voosquare}<b>The school for <span class="serif">media buyers.</span></b></div>
      </div></div>`;
  }
  /** Tilt the card toward the pointer (desktop) and move the holographic sheen. */
  function tilt(root) {
    if (reduce() || matchMedia('(hover: none)').matches) return;
    root.querySelectorAll('.idc').forEach((c) => {
      const inn = c.querySelector('.idc-in');
      c.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; inn.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 12}deg)`; c.style.setProperty('--mx', (x + 0.5) * 100 + '%'); c.style.setProperty('--my', (y + 0.5) * 100 + '%'); });
      c.addEventListener('pointerleave', () => { inn.style.transform = ''; });
    });
  }
  /** The card as a PNG, drawn on a canvas (fonts from the page, the face from its SVG). */
  async function cardPng(c) {
    try { await Promise.all(['800 40px "Plus Jakarta Sans"', '600 20px "JetBrains Mono"', 'italic 40px "Instrument Serif"'].map((f) => document.fonts.load(f))); } catch { /* system fonts */ }
    const W = 1284, H = 810, s = W / 428;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const JK = (w, px) => `${w} ${px * s}px "Plus Jakarta Sans", Helvetica, Arial, sans-serif`;
    const MO = (px) => `600 ${px * s}px "JetBrains Mono", Menlo, monospace`;
    const acc = c.accent || '#C9F65B';
    x.save(); x.beginPath(); x.roundRect(0, 0, W, H, 24 * s); x.clip();
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#12301F'); g.addColorStop(0.55, '#0A1611'); g.addColorStop(1, '#0D2219'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(201,246,91,.06)'; x.lineWidth = 1.2;
    for (let i = 0; i < W; i += 22 * s) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
    for (let i = 0; i < H; i += 22 * s) { x.beginPath(); x.moveTo(0, i); x.lineTo(W, i); x.stroke(); }
    const hg = x.createLinearGradient(W * 0.15, 0, W * 0.85, H); hg.addColorStop(0, 'rgba(201,246,91,0)'); hg.addColorStop(0.42, 'rgba(201,246,91,.14)'); hg.addColorStop(0.5, 'rgba(120,200,255,.12)'); hg.addColorStop(0.58, 'rgba(255,140,200,.1)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = hg; x.fillRect(0, 0, W, H);
    x.fillStyle = acc; x.fillRect(0, H - 6 * s, W, 6 * s);
    // brand
    x.fillStyle = '#00A86B'; x.beginPath(); x.roundRect(22 * s, 20 * s, 26 * s, 26 * s, 7 * s); x.fill();
    [[0, 0, '#fff'], [1, 0, '#B3E8D3'], [0, 1, '#B3E8D3'], [1, 1, '#C9F65B']].forEach(([a, b, col]) => { x.fillStyle = col; x.beginPath(); x.roundRect((27 + a * 9) * s, (25 + b * 9) * s, 7 * s, 7 * s, 2 * s); x.fill(); });
    x.textBaseline = 'middle';
    x.font = JK(800, 14); x.fillStyle = '#fff'; x.fillText('VooSquare', 56 * s, 28 * s);
    x.font = `italic ${13 * s}px "Instrument Serif", Georgia, serif`; x.fillStyle = acc; x.fillText('Academy', 56 * s, 41 * s);
    x.font = JK(800, 11); x.fillStyle = acc; x.textAlign = 'right'; x.fillText('STUDENT', (428 - 22) * s, 33.5 * s); x.textAlign = 'left';
    // face
    const svg = VS.avatar(c.avatar || {}, { still: true }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" ');
    const img = await new Promise((res) => { const im = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); im.onload = () => { res(im); URL.revokeObjectURL(url); }; im.onerror = () => res(null); im.src = url; });
    x.save(); x.beginPath(); x.roundRect(22 * s, 66 * s, 86 * s, 86 * s, 20 * s); x.clip(); x.fillStyle = '#E7F8F0'; x.fillRect(22 * s, 66 * s, 86 * s, 86 * s); if (img) x.drawImage(img, 22 * s, 66 * s, 86 * s, 86 * s); x.restore();
    x.strokeStyle = acc; x.lineWidth = 2.5 * s; x.beginPath(); x.roundRect(22 * s, 66 * s, 86 * s, 86 * s, 20 * s); x.stroke();
    const label = (t, px, py) => { x.font = JK(600, 9); x.fillStyle = '#8FA79B'; x.fillText(t, px * s, py * s); };
    label('Name', 124, 76); x.font = JK(800, 20); x.fillStyle = '#fff'; let nm = c.name; while (x.measureText(nm).width > 280 * s && nm.length > 3) nm = nm.slice(0, -2) + '…'; x.fillText(nm, 124 * s, 96 * s);
    label('Student number', 124, 122); x.font = MO(15); x.fillStyle = acc; x.fillText(c.number, 124 * s, 140 * s);
    const cols = [['School', c.school, 22, 190], ['Level', c.level, 228, 90], ['Issued', VS.dateStr(c.issued_at), 324, 90]];
    cols.forEach(([k, v, px, w], i) => {
      label(k, px, 180); let fs = 12; x.font = JK(800, fs); x.fillStyle = '#fff'; let t = v;
      if (i) while (fs > 8 && x.measureText(t).width > w * s) { fs -= 0.5; x.font = JK(800, fs); } // level and date shrink, never cut
      while (x.measureText(t).width > w * s && t.length > 3) t = t.slice(0, -2) + '…';
      x.fillText(t, px * s, 198 * s);
    });
    // barcode
    x.fillStyle = 'rgba(255,255,255,.55)';
    let hh = 7; for (const ch of String(c.number)) hh = (hh * 31 + ch.charCodeAt(0)) >>> 0;
    let bx = 0; while (bx < 196) { hh = (hh * 1103515245 + 12345) >>> 0; const w = 1 + (hh % 3); x.fillRect((22 + bx * 0.9) * s, 222 * s, w * 0.9 * s, 22 * s); bx += w + 1 + ((hh >> 4) % 3); }
    x.restore();
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }
  async function downloadCard(c, btn) {
    await A.busy(btn, async () => {
      const blob = await cardPng(c);
      if (!blob) { VS.toast('Your browser could not draw the card.', 'err'); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `voosquare-academy-${c.number}-${c.school_slug}.png`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    });
  }
  /** The enrolment moment: the card turns over into view, the sheen passes once, then the next step. */
  function showCard(c, { fresh = false, onStart } = {}) {
    const m = A.modal(`<div class="enr ${fresh ? 'fresh' : ''}">
      <button class="x enr-x" data-close aria-label="Close">${icon('x')}</button>
      ${fresh ? `<span class="enr-k">${icon('check')}Enrolled</span><h3>Welcome to ${esc(c.school)}</h3><p>Your student card is ready. Module 1 is open now; each module after it opens on the school pace.</p>` : `<span class="enr-k">Your student card</span><h3>${esc(c.school)}</h3>`}
      <div class="enr-stage">${studentCard(c, { cls: 'enter' })}</div>
      <div class="enr-a">${onStart ? `<button class="btn btn-l" data-start>${icon('play')}Start module 1</button>` : ''}<button class="btn btn-w enr-w" data-dl>${icon('download')}Download the card</button></div>
    </div>`, { cls: 'am-enr', sheet: false });
    tilt(m.el);
    m.el.querySelector('[data-dl]').addEventListener('click', (e) => downloadCard(c, e.currentTarget));
    const st = m.el.querySelector('[data-start]'); if (st) st.addEventListener('click', () => { m.close(); onStart(); });
    return m;
  }
  async function enrol(slug, btn, after) {
    await A.busy(btn, async () => {
      let r;
      try { r = await VS.api(`/api/school/schools/${encodeURIComponent(slug)}/enroll`, { body: {} }); } catch (e) {
        if (e.data && e.data.lock && e.data.lock.code === 'premium') { premiumSheet(); return; }
        A.errToast(e); return;
      }
      A.emit('school:changed', {});
      showCard(r.card, { fresh: !r.already, onStart: after });
    });
  }
  function premiumSheet() {
    A.modal(`${A.modalHead('This vertical school is Premium')}<div class="vs-modal-b">${A.premiumUpsell('Go deep on one vertical', 'Premium opens this school, the premium rooms, the tools and the monthly live breakdowns with Dchessking.')}</div>`, { cls: 'am-sm' });
  }
  /** "Choose your vertical": five animated cards. Members save a choice; a vertical school marked Premium shows a lock for free members. */
  async function chooseVertical(onDone) {
    let d;
    try { d = await VS.api('/api/school/vertical'); } catch (e) { A.errToast(e); return; }
    let pick = d.vertical || '';
    const can = d.can_choose !== undefined ? !!d.can_choose : !!d.premium;
    const locked = (v) => !can || (!!v.premium && !d.premium);
    const m = A.modal(`${A.modalHead('Choose your vertical', can ? 'Your vertical school is featured on your school home. You can change it later.' : 'Vertical schools are part of Premium.')}
      <div class="vs-modal-b"><div class="vt-grid" role="radiogroup" aria-label="Verticals">${d.verticals.map((v, i) => `<button class="vt ${v.key === pick ? 'on' : ''}" role="radio" aria-checked="${v.key === pick}" data-v="${esc(v.key)}" style="--acc:${esc(v.accent)};--i:${i}" ${locked(v) ? 'disabled' : ''}>
          <span class="vt-ic">${vglyph(v.key)}</span><b>${esc(v.title)}</b><small>${esc(v.subtitle)}</small><span class="vt-ok">${icon('check')}</span>${locked(v) ? `<span class="vt-lock">${icon('lock')}</span>` : ''}</button>`).join('')}</div>
        <p class="vt-note">Trading, iGaming and finance ads usually need platform authorization and must follow local law in every country you run. The school shows you how.</p>
        <div class="am-actions">${can ? `<button class="btn btn-w" data-close>Not now</button><button class="btn btn-k" data-save ${pick ? '' : 'disabled'}>${pick ? 'Save my vertical' : 'Pick one'}</button>` : `<button class="btn btn-w" data-close>Not now</button><a class="btn btn-l" href="#premium" data-close>${VS.pmark('sm')}See Premium</a>`}</div></div>`, { cls: 'am-vt' });
    m.el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]');
      if (b && !b.disabled) { pick = b.dataset.v; m.el.querySelectorAll('[data-v]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); const sv = m.el.querySelector('[data-save]'); sv.disabled = false; sv.textContent = 'Save my vertical'; return; }
      const sv = e.target.closest('[data-save]');
      if (sv) await A.busy(sv, async () => {
        try { const r = await VS.api('/api/school/vertical', { body: { vertical: pick } }); m.close(); VS.toast('Your vertical is saved'); A.emit('school:changed', {}); if (onDone) onDone(r); else location.hash = '#school/' + r.school; } catch (er) { A.errToast(er); }
      });
    });
  }
  A.chooseVertical = chooseVertical;

  /* =====================================================================
   * SCHOOL HOME (the Academy page): the main path, the vertical schools, then the tips
   * ===================================================================== */
  function renderHome(view) {
    view.innerHTML = `${A.skel(380, '100%', 30)}<div style="height:16px"></div>${A.skelCards(3, 200)}`;
    let stop = null;
    const load = async () => {
      let d;
      try { d = await VS.api('/api/school'); } catch (e) { view.innerHTML = `<div class="card">${A.errorBox(e.message)}</div>`; return; }
      if (!view.isConnected) return;
      syncClock(d);
      const schools = d.schools.filter((s) => s.published || d.staff);
      const route = schools.filter((s) => s.track === 'main');
      const verts = schools.filter((s) => s.track === 'vertical');
      const extra = schools.filter((s) => s.track === 'extra');
      const cur = d.current;
      const certs = schools.filter((s) => s.certificate);
      const curSchool = route.find((s) => s.status !== 'done') || route[route.length - 1];
      const total = route.reduce((a, s) => a + (s.status === 'done' ? 1 : s === curSchool ? s.pct / 100 : 0), 0);
      const along = route.length > 1 ? Math.min(1, total / route.length) : 0;
      const station = (s, i) => {
        const st = s.status === 'done' ? 'done' : s === curSchool ? 'now' : 'later';
        const line = s.status === 'done' ? 'Certificate earned' : s.status === 'premium' ? 'Premium' : s.status === 'prereq' ? `After ${esc(shortName(route[i - 1] || s))}` : s.status === 'ready' ? 'Enrol to start' : s.modules_passed ? `${s.modules_passed} of ${s.modules_total} modules passed` : s.lessons_done ? `${s.lessons_done} of ${s.lessons_total} lessons` : `${s.modules_total} modules`;
        return `<a class="sr-st st-${st}" href="#school/${esc(s.slug)}" style="--i:${i}">
          <span class="sr-node">${ring(s.status === 'done' ? 100 : s.pct, 74, 6)}<span class="sr-in">${s.status === 'done' ? icon('check') : s.status === 'prereq' || s.status === 'premium' ? icon('lock') : `<b>${s.pct}<small>%</small></b>`}</span></span>
          <span class="sr-t"><small>School ${i + 1} · ${esc(s.level)}</small><b>${esc(shortName(s))}</b><em>${line}</em></span></a>`;
      };
      const first = route.find((s) => s.status === 'ready');
      const nowCard = cur ? `<a class="sh-now" href="#module/${cur.module_id}">
          <span class="sh-k">${cur.status === 'waiting' ? 'Up next' : `You are on · ${esc(shortName({ slug: cur.school, title: cur.school_title }))}`}</span>
          <b>Module ${cur.order}: ${esc(cur.module)}</b>
          <span class="sh-sub">${cur.status === 'waiting' ? `${esc(opensText(cur.opens_at))}` : cur.exam_ready ? 'Every lesson done. The module exam is ready.' : cur.lesson ? `Next lesson: ${esc(cur.lesson.title)}` : esc(cur.school_title)}</span>
          <span class="sh-go">${cur.status === 'waiting' ? `${icon('clock')}<span data-until="${cur.opens_at}" data-secs="1"></span>` : `${icon('play')}${cur.exam_ready ? 'Take the exam' : 'Continue'}`}</span></a>`
        : first ? `<a class="sh-now" href="#school/${esc(first.slug)}"><span class="sh-k">Start here</span><b>Enrol in ${esc(first.title)}</b><span class="sh-sub">${esc(first.level)} · ${first.modules_total} modules · ${first.lessons_total} lessons. Your student card is issued when you enrol.</span><span class="sh-go">${icon('arrow')}Enrol</span></a>`
        : `<a class="sh-now" href="#school/${esc((route[0] || {}).slug || '')}"><span class="sh-k">All done</span><b>You finished the main school</b><span class="sh-sub">Every certificate is yours. Go deeper with a vertical school below.</span><span class="sh-go">${icon('arrow')}Open the schools</span></a>`;
      const nextCard = d.next && (!cur || d.next.module_id !== cur.module_id) ? `<div class="sh-mini"><span class="sh-k">${icon('clock')}Next unlock</span><b>${esc(d.next.module)}</b><span class="sh-sub">${esc(opensText(d.next.opens_at))}</span></div>` : '';
      const chosen = verts.find((v) => v.chosen);
      const canV = d.can_choose !== undefined ? !!d.can_choose : !!d.premium;
      const vcard = (v, i, big) => {
        const lock = v.status === 'premium';
        const state = v.status === 'done' ? `${icon('check')}Certificate earned` : v.enrolled ? `${v.pct}% · ${v.modules_passed} of ${v.modules_total} modules` : lock ? `${icon('lock')}Premium` : v.enroll_block === 'vertical' ? 'Choose it to enrol' : `${v.modules_total} modules · ${v.lessons_total} lessons`;
        return `<a class="vk ${big ? 'big' : ''} ${lock ? 'lock' : ''} ${v.chosen ? 'chosen' : ''}" href="#school/${esc(v.slug)}" style="--acc:${esc(v.accent || '#00A86B')};--i:${i}">
          ${big ? `<span class="vk-art" aria-hidden="true">${vglyph(v.vertical)}</span>` : ''}<span class="vk-ic">${vglyph(v.vertical)}</span>
          ${v.chosen ? `<span class="vk-tag">${icon('star')}Your vertical</span>` : ''}
          <b>${esc(v.title)}</b><p>${esc(v.subtitle)}</p>
          <span class="vk-st">${state}</span>
          ${v.enrolled && !lock ? `<span class="vk-bar"><i style="width:${v.pct}%"></i></span>` : ''}</a>`;
      };
      const others = verts.filter((v) => v !== chosen);
      view.innerHTML = `
        <section class="sch-hero" aria-label="VooSquare Academy">
          <div class="gridbg"></div>
          <div class="sh-top">
            <div class="sh-intro"><span class="sh-badge">${VS.PI.voosquare}<span>VooSquare Academy</span><em>The school for media buyers</em></span>
              <h2>From your first campaign to running a buying team.</h2>
              <p>The main school for beginners to pros. Three schools in order, one module at a time, an exam after each and a certificate at the end of every school.</p>
              ${siteLink(d)}</div>
            <div class="sh-stats"><div><b data-count="${d.xp || 0}">0</b><small>XP</small></div><div><b data-count="${schools.reduce((a, s) => a + s.lessons_done, 0)}">0</b><small>lessons passed</small></div><div><b data-count="${certs.length}">0</b><small>${certs.length === 1 ? 'certificate' : 'certificates'}</small></div></div>
          </div>
          <div class="sch-route" style="--along:${along.toFixed(3)};--n:${route.length}">
            <div class="sr-track" aria-hidden="true"><i class="sr-fill"></i><i class="sr-dot"></i></div>
            ${route.map(station).join('')}
          </div>
          <div class="sh-row">${nowCard}${nextCard}
            ${certs.length ? `<div class="sh-mini sh-certs"><span class="sh-k">${icon('trophy')}Certificates</span>${certs.map((s) => `<a href="#cert/${esc(s.certificate.code)}">${icon('check')}${esc(shortName(s))}</a>`).join('')}</div>` : ''}
            ${d.student ? `<div class="sh-mini"><span class="sh-k">${icon('id')}Student number</span><b class="mono">${esc(d.student)}</b><span class="sh-sub">On every student card</span></div>` : ''}
          </div>
        </section>
        ${verts.length ? `<section class="vsec" aria-labelledby="vsecT">
          <div class="vsec-h"><div><h2 id="vsecT">Vertical schools ${verts.some((v) => v.premium) ? `<span class="vsec-pm">${VS.pmark('sm', 'still')}Premium</span>` : '<span class="vsec-pm vsec-free">Free</span>'}</h2><p>Go deep on one vertical after Foundations: offers, rules, funnels and numbers that only apply there. Same pace, exams and a specialist certificate.</p></div>
            ${canV ? `<button class="btn ${d.vertical ? 'btn-w' : 'btn-k'}" data-choose>${vglyph(d.vertical || 'trading')}${d.vertical ? 'Change my vertical' : 'Choose your vertical'}</button>` : `<a class="btn btn-k" href="#premium">${VS.pmark('sm')}Unlock with Premium</a>`}</div>
          ${!canV ? `<p class="vsec-up">${icon('lock')}<span>Vertical schools are part of Premium. Free members keep the full main school, every quiz, exam and certificate.</span></p>` : ''}
          <div class="vk-grid ${chosen ? 'has-big' : ''}">${chosen ? vcard(chosen, 0, true) : ''}${others.map((v, i) => vcard(v, i + 1, false)).join('')}</div>
        </section>` : ''}
        ${extra.length ? `<section class="vsec"><div class="vsec-h"><div><h2>More schools</h2></div></div><div class="vk-grid">${extra.map((v, i) => vcard(v, i, false)).join('')}</div></section>` : ''}
        <a class="tips-entry" href="#tips">
          <span class="te-face">${founderFace()}</span>
          <span class="te-t"><small>Dchessking's tips</small><b>Extra tips from the buying desk</b><span>${d.tips} short courses outside the school path. Take any of them, any time.</span></span>
          <span class="te-go">${icon('arrow')}</span></a>`;
      view.querySelectorAll('.sh-stats [data-count]').forEach((b) => VS.countUp(b, Number(b.dataset.count)));
      if (stop) stop();
      stop = ticker(view, () => load());
    };
    view.addEventListener('click', (e) => {
      if (e.target.closest('[data-choose]')) chooseVertical(() => load());
      const as = e.target.closest('[data-acad-site]'); if (as) openAcademySite(as);
    });
    load();
    const off = A.on('school:changed', () => load());
    return () => { if (stop) stop(); off(); };
  }

  /* =====================================================================
   * SCHOOL PAGE
   * ===================================================================== */
  function partnerCards(list, staff, vertical) {
    if (!list.length) return staff ? `<div class="pc-empty">${icon('plus')}<span>No partners for ${esc(vertical)} yet. Add them in Admin → VooSquare Academy → Partners. Members do not see this box.</span></div>` : '';
    return `<div class="pc-grid">${list.map((p, i) => `<a class="pcard" href="${esc(p.go)}" target="_blank" rel="noopener sponsored" style="--i:${i}">
      <span class="pc-h">${p.logo ? `<img src="${esc(p.logo)}" alt="" loading="lazy">` : `<span class="pc-ini">${esc(p.name[0] || '?')}</span>`}<b>${esc(p.name)}</b>${p.badge ? `<span class="pc-badge">${esc(p.badge)}</span>` : ''}</span>
      ${p.description ? `<p>${esc(p.description)}</p>` : ''}${p.highlights.length ? `<ul>${p.highlights.map((h) => `<li>${icon('check')}${esc(h)}</li>`).join('')}</ul>` : ''}
      <span class="pc-cta">${esc(p.cta)}${icon('ext')}</span></a>`).join('')}</div>`;
  }
  function renderSchool(view, slug) {
    view.innerHTML = `${A.skel(240, '100%', 28)}<div style="height:16px"></div>${A.skel(90)}<div style="height:10px"></div>${A.skel(90)}`;
    let stop = null; let d = null;
    const load = async () => {
      try { d = await VS.api('/api/school/schools/' + encodeURIComponent(slug)); } catch (e) { view.innerHTML = `<a class="backlink" href="#academy">${icon('left')}VooSquare Academy</a><div class="card">${A.errorBox(e.message, e.status !== 404)}</div>`; return; }
      if (!view.isConnected) return;
      syncClock(d);
      const s = d.school;
      A.setTitle(s.title);
      const first = s.modules.find((m) => m.status === 'open') || null;
      const done = s.status === 'done';
      const vert = s.track === 'vertical';
      const gate = s.status === 'prereq' ? `<div class="sch-gate">${icon('lock')}<span>${lockCopy(s)}</span>${s.prev_title ? `<a class="btn btn-l btn-sm" href="#academy">Back to the path</a>` : ''}</div>`
        : s.status === 'premium' ? `<div class="sch-gate">${VS.pmark('md')}<span>${esc(s.title)} is part of Premium. Premium opens every vertical school, the premium rooms and the monthly live breakdowns.</span><a class="btn btn-l btn-sm" href="#premium">See Premium</a></div>`
          : s.enroll_block === 'vertical' ? `<div class="sch-gate">${vglyph(s.vertical)}<span>Choose ${esc(s.title)} as your vertical to enrol. Your team can also open other verticals for you.</span><button class="btn btn-l btn-sm" data-choose>Choose your vertical</button></div>` : '';
      view.innerHTML = `<a class="backlink" href="#academy">${icon('left')}VooSquare Academy</a>
        <header class="sch-head ${vert ? 'vert' : ''}" style="${s.accent ? `--acc:${esc(s.accent)}` : ''}">
          <div class="gridbg"></div>
          <div class="sch-head-in">
            ${vert ? `<span class="sch-vk">${vglyph(s.vertical)}Vertical school${s.chosen ? ' · your vertical' : ''}</span>` : `<div class="sch-tabs" role="tablist" aria-label="Schools">${d.schools.map((x) => `<a href="#school/${esc(x.slug)}" class="${x.slug === s.slug ? 'on' : ''}" aria-current="${x.slug === s.slug ? 'page' : 'false'}"><span>${x.order}</span>${esc(shortName(x))}${x.status === 'done' ? icon('check') : x.status === 'prereq' ? icon('lock') : ''}</a>`).join('')}</div>`}
            <h2>${esc(s.title)}</h2><p>${esc(s.subtitle)}</p>
            <div class="sch-meta"><span>${esc(s.level)}</span><span>${s.modules_total} modules</span><span>${s.lessons_total} lessons</span><span>About ${mins(s.minutes)} of lessons</span>${s.premium ? `<span class="pill pill-gold">${VS.pmark('sm')}Premium</span>` : ''}</div>
            ${gate}
            <div class="sch-cta">${s.can_enroll ? `<button class="btn btn-l" data-enrol>${icon('id')}Enrol in ${esc(shortName(s))}</button><span class="sch-cta-n">Free to enrol. Your student card is issued at once.</span>` : first ? `<a class="btn btn-l" href="#module/${first.id}">${icon('play')}${s.lessons_done ? 'Continue' : 'Start'} module ${first.order}</a>` : done && s.certificate ? `<a class="btn btn-l" href="#cert/${esc(s.certificate.code)}">${icon('trophy')}View certificate</a>` : ''}</div>
          </div>
          <div class="sch-head-r">${d.card ? `<button class="idc-mini" data-card aria-label="Open your student card">${studentCard(d.card)}</button>` : `<div class="sch-ringw">${ring(done ? 100 : s.pct, 132, 10, 'big')}<div class="sch-head-pct"><b>${done ? icon('check') : s.pct + '<small>%</small>'}</b><span>${done ? 'Certificate earned' : 'complete'}</span></div></div>`}</div>
        </header>
        ${d.card ? `<div class="sch-prog"><span class="spb"><i style="width:${s.pct}%"></i></span><b>${s.pct}%</b><span>${s.lessons_done} of ${s.lessons_total} lessons · ${s.modules_passed} of ${s.modules_total} module exams${s.certificate ? ' · certificate earned' : ''}</span></div>` : ''}
        ${d.unlock_hours ? `<p class="sch-pace">${icon('clock')}<span>One module at a time. The next module opens once you pass this one's exam and ${d.unlock_hours} hours have passed since it opened. Lessons inside a module open in order.</span></p>` : ''}
        <ol class="sch-mods">${s.modules.map((m) => moduleRow(s, m)).join('')}
          ${s.final.none ? `<li class="sm-row sm-final st-${s.final.passed ? 'passed' : s.final.available ? 'open' : 'locked'}"><span class="sm-node">${s.final.passed ? icon('check') : icon('trophy')}</span>
            <div class="sm-card"><div class="sm-t"><small>Certificate</small><b>${esc(s.cert_title)}</b><p>No final exam in this school. Finish every module to earn the certificate.</p></div>
              <div class="sm-r">${s.final.passed ? `<a class="btn btn-g btn-sm" href="#cert/${esc(s.certificate.code)}">${icon('trophy')}Certificate</a>` : s.final.available ? `<button class="btn btn-l btn-sm" data-claim>${icon('trophy')}Get your certificate</button>` : `<span class="sch-st lock">${icon('lock')}After every module</span>`}</div></div></li>` : `<li class="sm-row sm-final st-${s.final.passed ? 'passed' : s.final.available ? 'open' : 'locked'}"><span class="sm-node">${s.final.passed ? icon('check') : icon('trophy')}</span>
            <div class="sm-card"><div class="sm-t"><small>Final exam</small><b>${esc(s.title)}: final exam</b><p>${s.final.questions} questions drawn from every module exam and lesson quiz in this school. Pass with 80% to earn the ${esc(s.cert_title)}.</p></div>
              <div class="sm-r">${s.final.passed ? `<a class="btn btn-g btn-sm" href="#cert/${esc(s.certificate.code)}">${icon('trophy')}Certificate</a>` : s.final.cooldown_until ? `<span class="sch-st wait">${icon('clock')}Retry in <span data-until="${s.final.cooldown_until}"></span></span>` : s.final.available ? `<button class="btn btn-l btn-sm" data-final>${icon('play')}Start the final exam</button>` : `<span class="sch-st lock">${icon('lock')}After every module exam</span>`}
                ${s.final.attempts && !s.final.passed ? `<small class="sm-best">Best so far ${s.final.best}%</small>` : ''}</div></div></li>`}
        </ol>
        ${vert && (d.partners.length || d.staff) && s.status !== 'premium' ? `<section class="pc-sec"><div class="card-h"><div><h3>Where to find offers</h3><span class="sub">Networks and advertisers the Zedapex team works with for ${esc(s.title.toLowerCase())}. Check each one's terms, and the law and ad rules where you run.</span></div></div>${partnerCards(d.partners, d.staff, s.title)}</section>` : ''}`;
      if (stop) stop();
      stop = ticker(view, () => load());
      tilt(view);
    };
    function moduleRow(s, m) {
      const lessonsDone = m.lessons.filter((l) => l.status === 'done').length;
      const clickable = ['open', 'passed', 'waiting', 'locked', 'enroll'].includes(m.status);
      return `<li class="sm-row st-${m.status}" style="--i:${m.order}"><span class="sm-node">${m.status === 'passed' ? icon('check') : m.order}</span>
        <${clickable ? `a href="#module/${m.id}"` : 'div'} class="sm-card"><div class="sm-t"><small>Module ${m.order} · ${m.lessons.length} lessons · ${mins(m.minutes)}</small><b>${esc(m.title)}</b><p>${esc(m.summary)}</p>
          ${m.status === 'open' || m.status === 'passed' ? `<span class="sm-bar" aria-label="${lessonsDone} of ${m.lessons.length} lessons passed"><i style="width:${pctOf(lessonsDone, m.lessons.length)}%"></i></span>` : ''}
          ${m.status === 'waiting' ? `<span class="sm-lock">${icon('clock')}${esc(opensText(m.opens_at))}</span>` : m.status === 'enroll' && m.order === 1 ? `<span class="sm-lock">${icon('id')}Opens when you enrol</span>` : (m.status === 'locked' && (s.modules[m.order - 2] || {}).status !== 'locked') ? `<span class="sm-lock">${icon('lock')}${lockCopy(s, m)}</span>` : ''}</div>
          <div class="sm-r">${moduleBadge(m)}${m.status !== 'passed' && m.exam.attempts ? `<small class="sm-best">Exam best ${m.exam.best}%</small>` : ''}</div></${clickable ? 'a' : 'div'}></li>`;
    }
    view.addEventListener('click', (e) => {
      if (!d) return;
      const s = d.school;
      if (e.target.closest('[data-final]')) { openExam({ kind: 'final', slug: s.slug, title: `${s.title}: final exam` }, load); return; }
      const cl = e.target.closest('[data-claim]');
      if (cl) { A.busy(cl, async () => { try { const r = await VS.api(`/api/school/schools/${encodeURIComponent(s.slug)}/final/start`, { body: {} }); if (r.certificate) { VS.confetti(); A.emit('school:changed', {}); location.hash = '#cert/' + r.certificate.code; } } catch (er) { A.errToast(er); } }); return; }
      const en = e.target.closest('[data-enrol]');
      if (en) { enrol(s.slug, en, () => { const m1 = s.modules[0]; if (m1) location.hash = '#module/' + m1.id; }); return; }
      if (e.target.closest('[data-card]') && d.card) { showCard(d.card); return; }
      if (e.target.closest('[data-choose]')) chooseVertical(() => load());
    });
    load();
    const off = A.on('school:changed', () => load());
    return () => { if (stop) stop(); off(); };
  }

  /* =====================================================================
   * MODULE PAGE
   * ===================================================================== */
  function renderModule(view, id) {
    view.innerHTML = `${A.skel(200, '100%', 28)}<div style="height:16px"></div>${A.skel(70)}<div style="height:8px"></div>${A.skel(70)}`;
    let stop = null; let data = null;
    setTimeout(() => { if (view.isConnected) needArt(); }, 1200); // warm the lesson art while the member picks a lesson
    const load = async () => {
      try { data = await VS.api('/api/school/modules/' + encodeURIComponent(id)); } catch (e) { view.innerHTML = `<a class="backlink" href="#academy">${icon('left')}VooSquare Academy</a><div class="card">${A.errorBox(e.message, e.status !== 404)}</div>`; return; }
      if (!view.isConnected) return;
      syncClock(data);
      const { school: s, module: m, next } = data;
      A.setTitle(m.title);
      const done = m.lessons.filter((l) => l.status === 'done').length;
      const open = m.status === 'open' || m.status === 'passed';
      const nextL = m.lessons.find((l) => l.status === 'open') || null;
      const e = m.exam;
      view.innerHTML = `<a class="backlink" href="#school/${esc(s.slug)}">${icon('left')}${esc(s.title)}</a>
        <header class="mod-head st-${m.status}">
          <div class="gridbg"></div>
          <div class="mh-l"><small>${esc(shortName(s))} · Module ${m.order}</small><h2>${esc(m.title)}</h2><p>${esc(m.summary)}</p>
            <div class="sch-meta"><span>${m.lessons.length} lessons</span><span>${mins(m.minutes)}</span><span>${e.none ? 'No exam' : `Exam: ${e.questions} questions, pass 80%`}</span></div>
            ${open && nextL ? `<button class="btn btn-l" data-lesson="${nextL.id}">${icon('play')}${done ? 'Continue' : 'Start'}: ${esc(nextL.title)}</button>` : open && e.available ? `<button class="btn btn-l" data-exam>${icon('play')}Take the module exam</button>` : ''}
            ${m.status === 'enroll' ? `<div class="sch-gate">${icon('id')}<span>Enrol in ${esc(s.title)} to open this module.</span>${s.can_enroll ? `<button class="btn btn-l btn-sm" data-enrol>Enrol now</button>` : ''}</div>` : !open ? `<div class="sch-gate">${m.status === 'waiting' ? icon('clock') : icon('lock')}<span>${m.status === 'waiting' ? `${esc(opensText(m.opens_at))}. <span class="mono" data-until="${m.opens_at}" data-secs="1"></span> to go.` : lockCopy(s, m) || 'This module is locked.'}</span></div>` : ''}
            ${data.vertical_pick && e.passed ? `<div class="sch-gate vpick">${vglyph('trading')}<span>You finished "Picking your vertical". Choose the vertical you want to go deep on next.</span><button class="btn btn-l btn-sm" data-choose>Choose your vertical</button></div>` : ''}</div>
          <div class="mh-r">${ring(m.status === 'passed' ? 100 : pctOf(done + (e.passed ? 1 : 0), m.lessons.length + 1), 112, 9, 'big')}<div class="sch-head-pct"><b>${done}<small>/${m.lessons.length}</small></b><span>lessons</span></div></div>
        </header>
        <div class="mod-body">
          <ol class="mod-ls">${m.lessons.map((l, i) => `<li><button class="ml st-${l.status}" ${l.status === 'locked' ? 'aria-disabled="true"' : ''} data-lesson="${l.id}" style="--i:${i}">
            <span class="ml-n">${l.status === 'done' ? icon('check') : l.status === 'locked' ? icon('lock') : i + 1}</span>
            <span class="ml-t"><b>${esc(l.title)}</b><small>${l.minutes} min · ${l.steps} slides · quiz${l.status === 'done' ? ` · ${l.best}/${l.total}` : l.attempts ? ` · best ${l.best}/${l.total}` : ''}</small></span>
            <span class="ml-r">${l.status === 'done' ? '<span class="sch-st ok">Passed</span>' : l.status === 'open' ? `<span class="sch-st go">${icon('play')}${l.attempts ? 'Retry quiz' : 'Start'}</span>` : ''}</span></button></li>`).join('')}</ol>
          <aside class="mod-side">
            <div class="mx-card st-${e.passed ? 'passed' : e.available ? 'ready' : e.cooldown_until ? 'cool' : 'locked'}">
              <span class="mx-ic">${e.passed ? icon('check') : icon('trophy')}</span>
              <small>Module exam</small><b>${e.none ? (e.passed ? 'Module done' : 'No exam in this module') : e.passed ? `Passed${e.best ? ` with ${e.best}%` : ''}` : e.available ? 'Ready when you are' : e.cooldown_until ? 'Take a short break' : 'Opens after the lessons'}</b>
              <p>${e.none ? (e.passed ? 'Every lesson is done. The next module follows the school pace.' : 'Finish every lesson and the module is done.') : e.passed ? (e.granted ? 'Marked as passed by the VooSquare Academy team.' : 'Well done. The next module follows the school pace.') : e.cooldown_until ? `You can try again in <span data-until="${e.cooldown_until}" data-secs="1"></span>. Use the time to review the slides.` : `${e.questions} scenario questions across every lesson. You need 80% to pass. If you miss, you can retry after an hour.`}</p>
              ${e.available ? `<button class="btn btn-l btn-block" data-exam>${icon('play')}Start the exam</button>` : ''}
              ${e.attempts && !e.passed ? `<small class="mx-att">${e.attempts} ${e.attempts === 1 ? 'attempt' : 'attempts'} · best ${e.best}%</small>` : ''}
            </div>
            ${next ? `<a class="mx-next ${next.status === 'waiting' ? 'wait' : ''}" href="#module/${next.id}"><small>Next module</small><b>${esc(next.title)}</b>${next.status === 'waiting' ? `<span>${icon('clock')}${esc(opensText(next.opens_at))}</span>` : next.status === 'open' || next.status === 'passed' ? `<span>${icon('arrow')}Open now</span>` : `<span>${icon('lock')}After this exam${data.unlock_hours ? ` and ${data.unlock_hours} hours` : ''}</span>`}</a>` : `<a class="mx-next" href="#school/${esc(s.slug)}"><small>After this</small><b>The final exam</b><span>${icon('trophy')}${esc(s.title)}</span></a>`}
          </aside>
        </div>`;
      if (stop) stop();
      stop = ticker(view, () => load());
    };
    view.addEventListener('click', (ev) => {
      if (ev.target.closest('[data-retry]')) { load(); return; }
      if (ev.target.closest('[data-choose]')) { chooseVertical(); return; }
      const en = ev.target.closest('[data-enrol]');
      if (en && data) { enrol(data.school.slug, en, () => load()); return; }
      const b = ev.target.closest('[data-lesson]');
      if (b && data) {
        const l = data.module.lessons.find((x) => x.id === Number(b.dataset.lesson));
        if (l && l.status === 'locked') { VS.toast(data.module.status === 'enroll' ? 'Enrol in the school first.' : 'Pass the quiz of the lesson before this one first.', 'err'); return; }
        openLesson(Number(b.dataset.lesson), load);
        return;
      }
      if (ev.target.closest('[data-exam]') && data) openExam({ kind: 'module', id: data.module.id, title: `Module ${data.module.order} exam: ${data.module.title}` }, load);
    });
    load();
    const off = A.on('school:changed', () => load());
    return () => { if (stop) stop(); off(); };
  }

  /* =====================================================================
   * LESSON PLAYER
   * ===================================================================== */
  /** The lesson art (lesson-art.js + .css) loads on demand, once: the player works without it. */
  let artP = null;
  function needArt() {
    if (window.VSA) return Promise.resolve(window.VSA);
    if (!artP) {
      artP = new Promise((res) => {
        const css = new Promise((ok) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/css/lesson-art.css'; l.onload = ok; l.onerror = ok; document.head.appendChild(l); });
        const js = new Promise((ok) => { const sc = document.createElement('script'); sc.src = '/js/lesson-art.js'; sc.onload = ok; sc.onerror = ok; document.head.appendChild(sc); });
        Promise.all([css, js]).then(() => res(window.VSA || null));
        setTimeout(() => res(window.VSA || null), 5000);
      });
    }
    return artP;
  }
  /** Lesson title as words that rise in one by one (the cold open). */
  const titleWords = (t) => esc(t).split(/\s+/).filter(Boolean).map((w, k) => `<span class="co-w"><span style="--k:${k}">${w}</span></span>`).join(' ');

  /**
   * The lesson player. opts.preview (the VooSquare Academy website, signed out): the lesson comes from the public preview
   * API (only lessons a new free member could open), there is no quiz, and the end of the lesson invites to sign up
   * (opts.onSignup). opts.onLocked runs when the lesson is not a free one.
   */
  async function openLesson(id, onChange, opts = {}) {
    let d;
    const preview = !!opts.preview;
    const artReady = needArt();
    try { d = await VS.api((preview ? '/api/academy/preview/lessons/' : '/api/school/lessons/') + id); } catch (e) {
      if (preview && e.data && e.data.lock) { if (opts.onLocked) opts.onLocked(e); return; }
      if (e.data && e.data.lock && e.data.lock.code === 'premium') { A.modal(`${A.modalHead('Premium school')}<div class="vs-modal-b">${A.premiumUpsell('This school is part of Premium', e.message)}</div>`, { cls: 'am-sm' }); return; }
      if (preview) { VS.toast((e && e.message) || 'That did not load. Try again.', 'err'); return; }
      A.errToast(e); return;
    }
    const L = d.lesson;
    // Product and partner slides carry their live card data (from the lesson's refs) into the renderer.
    const withRef = (st) => (st.v === 'product' ? { ...st, _ref: (d.refs.products || {})[st.d && st.d.slug] } : st.v === 'partner' ? { ...st, _ref: (d.refs.partners || {})[(st.d && st.d.vertical) || 'general'] || [], _staff: !!d.refs.staff } : st);
    const steps = L.steps.length ? L.steps.map(withRef) : [{ v: 'big', h: L.title, p: '', d: { b: L.title } }];
    // Illustrations: chosen once per lesson from each slide's type and words (deterministic, never twice in a row).
    const VSA = await artReady;
    const artCtx = { school: d.school.slug, module: d.module.title, title: L.title };
    let art = [];
    try { art = VSA ? VSA.plan(steps, artCtx) : []; } catch { art = []; }
    let opened = 0; // when the cold open last played
    const key = 'vs_sch_pos_' + L.id;
    let i = -1; // -1 = intro, steps.length = recap, then quiz
    let mode = 'intro';
    const wrap = A.el(`<div class="player sch-player" role="dialog" aria-modal="true" aria-label="${esc(L.title)}"><div class="pl ssp">
      <div class="ssp-top">
        <button class="ssp-x" data-x aria-label="Close lesson">${icon('x')}</button>
        <div class="ssp-tt"><b>${esc(L.title)}</b><small>${esc(shortName(d.school))} · Module ${d.module.order} · Lesson ${L.number} of ${L.count}</small></div>
        <span class="ssp-who" data-who>${teamFace()}<span>VooSquare Academy team</span></span>
        ${L.glossary.length ? `<button class="ssp-gl" data-gl aria-expanded="false">${icon('book')}<span>Glossary</span><i>${L.glossary.length}</i></button>` : ''}
      </div>
      <div class="ssp-bars" aria-hidden="true">${steps.map(() => '<i><b></b></i>').join('')}<i class="q"><b></b></i></div>
      <div class="ssp-body" tabindex="-1"></div>
      <div class="ssp-ctl" hidden><button class="cb" data-prev aria-label="Previous slide">${icon('left')}</button><span class="cnt"></span><button class="cb main" data-next aria-label="Next slide">${icon('arrow')}</button></div>
      ${L.glossary.length ? `<aside class="ssp-glossary" hidden aria-label="Glossary"><div class="sg-h"><b>Glossary</b><button data-gl-x aria-label="Close glossary">${icon('x')}</button></div><dl>${L.glossary.map((g) => `<div><dt>${esc(g.term)}</dt><dd>${esc(g.def)}</dd></div>`).join('')}</dl></aside>` : ''}
    </div></div>`);
    document.body.appendChild(wrap);
    document.body.classList.add('noscroll');
    const body = wrap.querySelector('.ssp-body');
    const bars = [...wrap.querySelectorAll('.ssp-bars i b')];
    const who = wrap.querySelector('[data-who]');
    const ctl = wrap.querySelector('.ssp-ctl');
    // Teaching voice (app-voice.js): narration bar, captions and auto-advance. Absent when the lesson has no clips.
    const nar = window.VSV && d.voice ? VSV.create({ voice: d.voice, lessonId: L.id, wrap, ctl, steps, onNext: () => next(), onOpen: () => coldOpen(true) }) : null;
    const paintBars = () => bars.forEach((b, k) => {
      const full = mode === 'quiz' || mode === 'result' ? true : mode === 'recap' ? k < steps.length : k <= i && i >= 0;
      if (!(full && k === i && mode === 'slide' && nar && nar.painting())) b.style.width = full ? '100%' : '0%'; // narrated: the voice fills it
      b.parentElement.classList.toggle('cur', mode === 'slide' && k === i);
    });
    const setWho = (s) => {
      const dc = s && s.v === 'quote' && (s.by || 'dchessking') === 'dchessking';
      const html = dc ? `<span class="av av-sm">${founderFace()}</span><span>Dchessking<small>Founder</small></span>` : `${teamFace()}<span>VooSquare Academy team</span>`;
      if (who.innerHTML !== html) { who.innerHTML = html; who.classList.remove('sw'); void who.offsetWidth; who.classList.add('sw'); }
    };

    function intro() {
      ctl.hidden = true;
      mode = 'intro'; i = -1; paintBars(); setWho(null);
      let saved = 0; try { saved = Number(localStorage.getItem(key)) || 0; } catch { /* ignore */ }
      const listen = !!(nar && nar.available && nar.enabled());
      const first = L.number === 1;
      let scene = '';
      try { scene = VSA ? VSA.scene(VSA.pick(L.objectives.join(' '), artCtx)) : ''; } catch { scene = ''; }
      body.innerHTML = `<div class="ssp-intro co ${scene ? 'co-has-art' : ''}">
        ${first ? `<div class="co-mod" aria-hidden="true"><span class="co-mk">${esc(shortName(d.school))} · Module ${d.module.order}</span><b>${esc(d.module.title)}</b><i class="co-rule"></i></div>` : ''}
        ${scene ? `<div class="co-art vl-stage" aria-hidden="true">${VSA.ambient()}<div class="la-art">${scene}</div></div>` : ''}
        <div class="co-txt">
        <span class="co-k"><i></i>${esc(shortName(d.school))} · Module ${d.module.order}${first ? '' : ` · ${esc(d.module.title)}`}</span>
        <span class="ssp-num">Lesson ${L.number}</span>
        <h2 class="co-title" aria-label="${esc(L.title)}"><span aria-hidden="true">${titleWords(L.title)}</span></h2>
        <div class="sch-meta dark"><span>${L.minutes} min</span><span>${steps.length} slides</span><span>${L.quiz.length ? `Quiz: ${L.quiz.length} questions, pass with ${Math.ceil(L.quiz.length * 0.8)}` : preview && L.quiz_count ? `Free preview · quiz with your account` : 'No quiz'}</span></div>
        ${L.objectives.length ? `<div class="ssp-obj"><h4>By the end you can</h4><ul>${L.objectives.map((o, k) => `<li style="--k:${k}"><span class="co-tk">${icon('check')}</span><span>${esc(objective(o))}</span></li>`).join('')}</ul></div>` : ''}
        ${nar ? nar.introHtml(saved > 0 && saved < steps.length ? saved : 0) : ''}
        <div class="ssp-ia">${saved > 0 && saved < steps.length ? `<button class="btn ${listen ? 'btn-w ssp-ghost' : 'btn-l'}" data-go="${saved}">${icon(listen ? 'book' : 'play')}${listen ? 'Read' : 'Resume'} from slide ${saved + 1}</button><button class="btn btn-w ssp-ghost" data-go="0">Start from the top</button>` : `<button class="btn ${listen ? 'btn-w ssp-ghost' : 'btn-l'}" data-go="0">${icon(listen ? 'book' : 'play')}${listen ? 'Read it instead' : 'Start the lesson'}</button>`}${L.quiz.length && (L.status === 'done' || L.total) ? `<button class="btn btn-w ssp-ghost" data-quiz>${L.status === 'done' ? 'Retake the quiz' : 'Go to the quiz'}</button>` : ''}</div>
        <p class="ssp-hint">Use the arrow keys or swipe to move between slides.${listen && !A.isMobile() ? ' Space plays or pauses the voice.' : ''}</p></div></div>`;
      body.scrollTop = 0;
      const coArt = body.querySelector('.co-art'); if (coArt && VSA) VSA.parallax(coArt);
      coldOpen(false);
      if (nar) { nar.bindIntro(body, (n) => show(n)); nar.onIntro(); }
    }
    /** The cold open: the scene settles, the kicker and title rise word by word, the objectives tick in (about 3 s).
     * Plays when the lesson opens, and again when the narrator starts the intro (with the intro music). The module card
     * only plays on the first opening of a module's first lesson. Static with reduced motion. */
    function coldOpen(replay) {
      const co = body.querySelector('.co');
      if (!co || reduce()) { if (co) co.classList.add('co-done'); return; }
      const now = Date.now();
      if (replay && now - opened < 900) return; // the voice started with the opening still running
      const mod = !replay && !opened && co.querySelector('.co-mod');
      opened = now;
      co.classList.remove('co-run', 'co-run-mod', 'co-done'); void co.offsetWidth;
      co.classList.add('co-run'); if (mod) co.classList.add('co-run-mod');
      clearTimeout(co._t); co._t = setTimeout(() => { if (co.isConnected) { co.classList.add('co-done'); co.classList.remove('co-run-mod'); } }, mod ? 5200 : 4000);
    }
    function show(n, dir = 1) {
      mode = 'slide';
      i = Math.max(0, Math.min(n, steps.length - 1));
      try { localStorage.setItem(key, String(i)); } catch { /* ignore */ }
      const s = steps[i];
      setWho(s);
      body.innerHTML = `<div class="pl-stage vl-stage ssp-stage ${dir < 0 ? 'back' : ''}" data-v="${esc(s.v)}">${VSL.render(s)}</div>
        <div class="ssp-text"><span class="sk">Slide ${i + 1} of ${steps.length}</span><h3>${esc(s.h || '')}</h3>${s.p ? `<p>${esc(s.p)}</p>` : ''}
          ${s.more ? `<details class="ssp-more"><summary>${icon('plus')}<span>Go deeper</span></summary><div>${esc(s.more).replace(/\n/g, '<br>')}</div></details>` : ''}</div>`;
      ctl.hidden = false;
      ctl.querySelector('.cnt').textContent = `${i + 1} / ${steps.length}`;
      const nb = ctl.querySelector('[data-next]');
      nb.innerHTML = i === steps.length - 1 ? `<span>Recap</span>${icon('check')}` : icon('arrow');
      nb.classList.toggle('wide', i === steps.length - 1);
      nb.setAttribute('aria-label', i === steps.length - 1 ? 'Finish slides' : 'Next slide');
      const stage = body.querySelector('.vl-stage');
      if (VSA) { try { VSA.dress(stage, s, art[i]); } catch { /* the slide still works without its art */ } }
      VSL.animate(stage);
      paintBars();
      body.scrollTop = 0;
      if (nar) nar.onSlide(i, body.querySelector('.vl-stage'));
    }
    function recap() {
      ctl.hidden = true;
      mode = 'recap'; setWho(null); paintBars();
      try { localStorage.removeItem(key); } catch { /* ignore */ }
      body.innerHTML = `<div class="pl-end ssp-recap">
        <div class="pe-head"><span class="pe-badge">${icon('check')}</span><div><span class="sk">Lesson recap</span><h3>${esc(L.title)}</h3></div></div>
        ${L.takeaways.length ? `<div class="pe-take"><h4>Takeaways</h4><ul>${L.takeaways.map((t, k) => `<li style="animation-delay:${k * 0.1}s">${icon('check')}<span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}
        ${L.action ? `<div class="pe-action"><span class="sk">Your action today</span><p>${esc(L.action)}</p></div>` : ''}
        ${preview ? `<div class="ssp-qcta ssp-signup"><div><b>That was a free lesson</b><span>Create your free account to take its ${L.quiz_count || 5}-question quiz, earn XP and open the next lesson. Your student card is issued when you enrol.</span></div><button class="btn btn-l" data-signup>${icon('arrow')}Start learning free</button></div>`
          : L.quiz.length ? `<div class="ssp-qcta"><div><b>Quick quiz</b><span>${L.quiz.length} questions. Get ${Math.ceil(L.quiz.length * 0.8)} right to pass the lesson${L.status === 'done' ? '' : ' and open the next one'}.</span></div><button class="btn btn-l" data-quiz>${icon('play')}Start the quiz</button></div>`
          : `<div class="ssp-qcta"><div><b>${L.status === 'done' ? 'Lesson done' : 'That is the lesson'}</b><span>No quiz here.${L.status === 'done' ? '' : ' Finish it to open the next one.'}</span></div><button class="btn btn-l" data-complete>${icon('check')}${L.status === 'done' ? 'Done' : 'Finish the lesson'}</button></div>`}
        <div class="pe-ctl"><button class="btn btn-w pe-replay" data-go="${steps.length - 1}">${icon('left')}Back to the slides</button></div></div>`;
      body.scrollTop = 0;
      if (nar) nar.onRecap();
    }

    /* ----- quiz: one question at a time, feedback after each pick; the score comes from the server at the end ----- */
    let quiz = L.quiz; let qi = 0; let answers = {}; let picked = false;
    async function startQuiz(fresh) {
      if (fresh) { try { quiz = (await VS.api(`/api/school/lessons/${L.id}/quiz`)).quiz; } catch (e) { A.errToast(e); return; } }
      mode = 'quiz'; if (nar) nar.onQuiz(); ctl.hidden = true; setWho(null); qi = 0; answers = {}; paintBars();
      question();
    }
    function question() {
      picked = false;
      const q = quiz[qi];
      body.innerHTML = `<div class="ssp-quiz">
        <div class="sq-top"><span class="sk">Question ${qi + 1} of ${quiz.length}</span><span class="sq-dots">${quiz.map((x, k) => `<i class="${k < qi ? (answers[x.id] && answers[x.id].ok ? 'ok' : 'no') : k === qi ? 'cur' : ''}"></i>`).join('')}</span></div>
        <h3 class="sq-q">${esc(q.q)}</h3>
        <div class="sq-opts" role="group" aria-label="Answers">${q.options.map((o, k) => `<button class="sq-o" data-opt="${esc(o.id)}" style="animation-delay:${0.05 + k * 0.06}s"><span class="sq-l">${String.fromCharCode(65 + k)}</span><span class="sq-t">${esc(o.text)}</span><span class="sq-m"></span></button>`).join('')}</div>
        <div class="sq-fb" aria-live="polite"></div></div>`;
      body.scrollTop = 0;
      const f = body.querySelector('.sq-o'); if (f && !A.isMobile()) f.focus({ preventScroll: true });
    }
    async function pick(btn) {
      if (picked) return; picked = true;
      const q = quiz[qi]; const opt = btn.dataset.opt;
      body.querySelectorAll('.sq-o').forEach((b) => { b.disabled = true; });
      btn.classList.add('picked');
      let r;
      try { r = await VS.api(`/api/school/lessons/${L.id}/check`, { body: { question: q.id, option: opt } }); } catch (e) { picked = false; body.querySelectorAll('.sq-o').forEach((b) => { b.disabled = false; }); btn.classList.remove('picked'); A.errToast(e); return; }
      answers[q.id] = { opt, ok: r.correct };
      body.querySelectorAll('.sq-o').forEach((b) => {
        if (b.dataset.opt === r.answer) { b.classList.add('right'); b.querySelector('.sq-m').innerHTML = icon('check'); }
        else if (b === btn) { b.classList.add('wrong'); b.querySelector('.sq-m').innerHTML = icon('x'); }
        else b.classList.add('dim');
      });
      const last = qi === quiz.length - 1;
      body.querySelector('.sq-fb').innerHTML = `<div class="sq-why ${r.correct ? 'ok' : 'no'}"><b>${r.correct ? ['Right.', 'Exactly.', 'Correct.', 'Spot on.'][qi % 4] : 'Not quite.'}</b>${r.why ? `<p>${esc(r.why)}</p>` : ''}</div>
        <button class="btn btn-l sq-next" data-qnext>${last ? `${icon('check')}See my score` : `Next question${icon('arrow')}`}</button>`;
      const dot = body.querySelectorAll('.sq-dots i')[qi]; if (dot) { dot.className = r.correct ? 'ok' : 'no'; }
      if (r.correct && !reduce()) btn.classList.add('burst');
      body.querySelector('[data-qnext]').focus({ preventScroll: true });
      const fbEl = body.querySelector('.sq-fb'); if (fbEl.getBoundingClientRect().bottom > innerHeight) fbEl.scrollIntoView({ behavior: reduce() ? 'auto' : 'smooth', block: 'end' });
    }
    async function finish(btn) {
      const payload = Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.opt]));
      await A.busy(btn, async () => {
        let r;
        try { r = await VS.api(`/api/school/lessons/${L.id}/quiz`, { body: { answers: payload } }); } catch (e) { A.errToast(e); return; }
        mode = 'result'; paintBars();
        S.user.xp = r.xp;
        const wrong = r.review.filter((x) => !x.correct);
        body.innerHTML = `<div class="ssp-result ${r.passed ? 'ok' : 'no'}">
          <div class="sr-score">${ring(r.total ? pctOf(r.score, r.total) : 100, 150, 11, 'big')}<div>${r.total ? `<b>${r.score}<small>/${r.total}</small></b>` : `<b>${icon('check')}</b>`}<span>${r.passed ? (r.total ? 'Passed' : 'Done') : `Need ${r.need}`}</span></div></div>
          <h3>${r.passed ? (!r.total ? 'Lesson complete.' : r.score === r.total ? 'Perfect score.' : 'Lesson passed.') : 'Almost. Try once more.'}</h3>
          ${r.certificate ? `<p><a class="btn btn-l" href="#cert/${esc(r.certificate.code)}" data-x>${icon('trophy')}You earned the ${esc(r.certificate.title)}</a></p>` : ''}
          <p>${r.passed ? (r.gained ? `+${r.gained} XP. ` : '') + (r.next ? (r.next.status === 'open' ? `${esc(r.next.title)} is open.` : '') : r.exam_ready ? 'Every lesson in this module is done. The module exam is ready.' : '') : `You need ${r.need} of ${r.total}. Questions come back in a new order, and the slides are here if you want another look.`}</p>
          ${!r.passed && wrong.length ? `<div class="sr-wrong"><h4>Review these</h4><ul>${wrong.map((x) => `<li>${icon('x')}<span>${esc(x.q)}</span></li>`).join('')}</ul></div>` : ''}
          <div class="sr-act">${r.passed
            ? (r.next ? `<button class="btn btn-l" data-next-lesson="${r.next.id}">Next lesson${icon('arrow')}</button>` : r.exam_ready ? `<button class="btn btn-l" data-to-exam>${icon('trophy')}Go to the module exam</button>` : '<button class="btn btn-l" data-x>Back to the module</button>') + `<button class="btn btn-w ssp-ghost" data-x>Close</button>`
            : `<button class="btn btn-l" data-retake>${icon('refresh')}Retry the quiz</button><button class="btn btn-w ssp-ghost" data-go="0">Review the slides</button>`}</div></div>`;
        body.scrollTop = 0;
        if (r.passed) {
          VS.confetti();
          if (r.gained) A.xpPop(`+${r.gained} XP`, wrap);
          L.status = 'done';
        }
        A.emit('school:changed', { lesson: L.id });
        if (onChange) onChange();
      });
    }

    function close() {
      if (nar) nar.destroy();
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('noscroll');
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 200);
    }
    const next = () => { if (mode === 'intro') show(0); else if (mode === 'slide') { if (i < steps.length - 1) show(i + 1); else recap(); } };
    const prev = () => { if (mode === 'slide') { if (i > 0) show(i - 1, -1); else intro(); } else if (mode === 'recap') show(steps.length - 1, -1); };
    function onKey(e) {
      if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
      if (nar && !e.metaKey && !e.ctrlKey && !e.altKey && nar.key(e)) return;
      if (e.key === 'Escape') { const g = wrap.querySelector('.ssp-glossary'); if (g && !g.hidden) { toggleGl(false); return; } close(); }
      else if (e.key === 'ArrowRight') { if (mode === 'slide' || mode === 'intro') next(); }
      else if (e.key === 'ArrowLeft') prev();
      else if (mode === 'quiz' && !picked && /^[1-4a-d]$/i.test(e.key)) { const k = /\d/.test(e.key) ? Number(e.key) - 1 : e.key.toLowerCase().charCodeAt(0) - 97; const b = body.querySelectorAll('.sq-o')[k]; if (b) pick(b); }
    }
    function toggleGl(on) {
      const g = wrap.querySelector('.ssp-glossary'); const b = wrap.querySelector('[data-gl]');
      if (!g) return;
      g.hidden = !on; b.setAttribute('aria-expanded', on);
      if (on) g.querySelector('button').focus();
    }
    wrap.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-x]')) { close(); return; }
      if (t.closest('[data-signup]')) { close(); if (opts.onSignup) setTimeout(() => opts.onSignup(L), 220); return; }
      if (t.closest('[data-gl]')) { toggleGl(wrap.querySelector('.ssp-glossary').hidden); return; }
      if (t.closest('[data-gl-x]')) { toggleGl(false); return; }
      if (t.closest('[data-prev]')) { prev(); return; }
      if (t.closest('[data-next]')) { next(); return; }
      const go = t.closest('[data-go]'); if (go) { show(Number(go.dataset.go), -1); return; }
      if (t.closest('[data-quiz]')) { startQuiz(L.status === 'done' || L.total > 0); return; }
      if (t.closest('[data-retake]')) { startQuiz(true); return; }
      const cp = t.closest('[data-complete]'); if (cp) { if (L.status === 'done') close(); else { mode = 'quiz'; answers = {}; finish(cp); } return; }
      const o = t.closest('[data-opt]'); if (o) { pick(o); return; }
      const qn = t.closest('[data-qnext]'); if (qn) { if (qi < quiz.length - 1) { qi++; question(); } else finish(qn); return; }
      const nl = t.closest('[data-next-lesson]'); if (nl) { close(); setTimeout(() => openLesson(Number(nl.dataset.nextLesson), onChange), 220); return; }
      if (t.closest('[data-to-exam]')) { close(); setTimeout(() => openExam({ kind: 'module', id: d.module.id, title: `Module ${d.module.order} exam: ${d.module.title}` }, onChange), 220); }
    });
    let sx = null, sy = null;
    wrap.addEventListener('touchstart', (e) => { if (mode === 'slide' && e.target.closest('.ssp-stage') && !e.target.closest('.vl-interactive,.tb-wrap,.cd-pre,.ph-chat')) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; } }, { passive: true });
    wrap.addEventListener('touchend', (e) => {
      if (sx == null) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
      if (Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0) next(); else prev();
    });
    document.addEventListener('keydown', onKey);
    intro();
  }

  /* =====================================================================
   * EXAMS (module and final)
   * ===================================================================== */
  async function openExam(spec, onChange) {
    const startUrl = spec.kind === 'final' ? `/api/school/schools/${encodeURIComponent(spec.slug)}/final/start` : `/api/school/modules/${spec.id}/exam/start`;
    const submitUrl = spec.kind === 'final' ? `/api/school/schools/${encodeURIComponent(spec.slug)}/final/submit` : `/api/school/modules/${spec.id}/exam/submit`;
    const wrap = A.el(`<div class="player sch-player" role="dialog" aria-modal="true" aria-label="${esc(spec.title)}"><div class="pl ssp ssp-exam">
      <div class="ssp-top"><button class="ssp-x" data-x aria-label="Close exam">${icon('x')}</button><div class="ssp-tt"><b>${esc(spec.title)}</b><small>${spec.kind === 'final' ? 'Final exam · pass with 80%' : 'Module exam · pass with 80%'}</small></div><span class="ssp-who">${teamFace()}<span>VooSquare Academy team</span></span></div>
      <div class="ssp-body"></div></div></div>`);
    document.body.appendChild(wrap);
    document.body.classList.add('noscroll');
    const body = wrap.querySelector('.ssp-body');
    let paper = null; let qi = 0; const answers = {}; let submitted = false;
    const close = (force) => {
      if (!force && paper && !submitted && Object.keys(answers).length) {
        A.ask('Leave the exam?', 'Your answers are not handed in yet. If you leave now, this attempt is not counted and you can start again.', { ok: 'Leave', danger: true }).then((ok) => { if (ok) close(true); });
        return;
      }
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('noscroll'); wrap.classList.add('out'); setTimeout(() => wrap.remove(), 200);
    };
    body.innerHTML = `<div class="ssp-intro ex-intro"><span class="ssp-num">${spec.kind === 'final' ? 'Final exam' : 'Module exam'}</span><h2>${esc(spec.title)}</h2>
      <ul class="ex-rules"><li>${icon('check')}<span>${spec.kind === 'final' ? '25 questions from every module exam and lesson quiz in this school' : '10 scenario questions from every lesson in this module'}</span></li><li>${icon('check')}<span>Answer in any order and change your mind before you hand in</span></li><li>${icon('check')}<span>Pass with 80%. ${spec.kind === 'final' ? 'Miss it and you can try again in 24 hours' : 'Miss it and you can try again in an hour'}</span></li><li>${icon('check')}<span>No timer. Take your time and read every option</span></li></ul>
      <div class="ssp-ia"><button class="btn btn-l" data-begin>${icon('play')}Begin</button><button class="btn btn-w ssp-ghost" data-x>Not now</button></div></div>`;
    const paint = () => {
      const q = paper.questions[qi];
      const answered = Object.keys(answers).length;
      body.innerHTML = `<div class="ssp-quiz ex-q">
        <div class="ex-nav" role="tablist" aria-label="Questions">${paper.questions.map((x, k) => `<button data-jump="${k}" class="${k === qi ? 'cur' : ''} ${answers[x.id] ? 'ans' : ''}" aria-label="Question ${k + 1}${answers[x.id] ? ', answered' : ''}">${k + 1}</button>`).join('')}</div>
        <div class="sq-top"><span class="sk">Question ${qi + 1} of ${paper.questions.length}</span><span class="ex-count">${answered} of ${paper.questions.length} answered</span></div>
        <h3 class="sq-q">${esc(q.q)}</h3>
        <div class="sq-opts" role="radiogroup" aria-label="Answers">${q.options.map((o, k) => `<button class="sq-o ${answers[q.id] === o.id ? 'sel' : ''}" role="radio" aria-checked="${answers[q.id] === o.id}" data-eopt="${esc(o.id)}"><span class="sq-l">${String.fromCharCode(65 + k)}</span><span class="sq-t">${esc(o.text)}</span></button>`).join('')}</div>
        <div class="ex-ctl"><button class="btn btn-w ssp-ghost" data-eprev ${qi === 0 ? 'disabled' : ''}>${icon('left')}Back</button>
          ${qi < paper.questions.length - 1 ? `<button class="btn btn-l" data-enext>Next${icon('arrow')}</button>` : ''}
          ${answered === paper.questions.length ? `<button class="btn btn-g" data-submit>${icon('check')}Hand in</button>` : qi === paper.questions.length - 1 ? `<span class="ex-left">${paper.questions.length - answered} left to answer</span>` : ''}</div></div>`;
      body.scrollTop = 0;
    };
    async function begin(btn) {
      await A.busy(btn, async () => {
        try { paper = await VS.api(startUrl, { body: {} }); } catch (e) {
          if (e.data && e.data.cooldown_until) { syncClock({ now: Date.now() }); VS.toast(`You can try again at ${hm(e.data.cooldown_until)}.`, 'err'); } else A.errToast(e);
          return;
        }
        qi = 0; paint();
      });
    }
    async function submit(btn) {
      await A.busy(btn, async () => {
        let r;
        try { r = await VS.api(submitUrl, { body: { paper: paper.paper, answers } }); } catch (e) { A.errToast(e); return; }
        submitted = true;
        S.user.xp = r.xp;
        body.innerHTML = `<div class="ssp-result ${r.passed ? 'ok' : 'no'}">
          <div class="sr-score">${ring(r.pct, 170, 12, 'big')}<div><b>${r.pct}<small>%</small></b><span>${r.score} of ${r.total}</span></div></div>
          <h3>${r.passed ? (spec.kind === 'final' ? 'You passed the final exam.' : 'Module exam passed.') : 'Not this time.'}</h3>
          <p>${r.passed ? (r.gained ? `+${r.gained} XP. ` : '') + (r.certificate ? 'Your certificate is ready.' : r.next ? (r.next.status === 'waiting' ? `${esc(r.next.title)}: ${esc(opensText(r.next.opens_at))}.` : `${esc(r.next.title)} is open.`) : r.final_ready ? 'Every module is passed. The final exam is open.' : '') : `You need ${r.pass_pct}%. You can try again at ${hm(r.retry_at)}. Look over the questions you missed, then review those lessons.`}</p>
          ${r.topics ? (r.topics.length ? `<div class="sr-wrong"><h4>${r.passed ? 'Worth another look' : 'Modules to review'}</h4><ul>${r.topics.map((x) => `<li>${icon('book')}<span><a href="#module/${x.module_id}" data-x>${esc(x.title)}</a> · ${x.missed} missed</span></li>`).join('')}</ul></div>` : '') : ''}
          ${r.review && r.passed && r.review.length ? `<details class="ex-review"><summary>See the answers (${r.review.length})</summary><ol>${r.review.map((x) => `<li class="${x.correct ? 'ok' : 'no'}">${icon(x.correct ? 'check' : 'x')}<div><b>${esc(x.q)}</b><span>${esc(x.answer_text)}</span>${x.why ? `<small>${esc(x.why)}</small>` : ''}</div></li>`).join('')}</ol></details>` : ''}
          ${r.review && !r.passed ? `<div class="sr-wrong"><h4>Missed (${r.review.filter((x) => !x.correct).length})</h4><ul>${r.review.filter((x) => !x.correct).map((x) => `<li>${icon('x')}<span>${esc(x.q)}</span></li>`).join('')}</ul></div>` : ''}
          ${r.choose_vertical ? `<div class="sch-gate vpick">${vglyph('trading')}<span>Next: choose the vertical you want to go deep on.</span><button class="btn btn-l btn-sm" data-pickv>Choose your vertical</button></div>` : ''}
          <div class="sr-act">${r.certificate ? `<a class="btn btn-l" href="#cert/${esc(r.certificate.code)}" data-x>${icon('trophy')}See my certificate</a>` : ''}<button class="btn ${r.certificate ? 'btn-w ssp-ghost' : 'btn-l'}" data-x>${r.passed ? 'Continue' : 'Back to the lessons'}</button></div></div>`;
        if (r.passed) { VS.confetti(); if (r.gained) A.xpPop(`+${r.gained} XP`, wrap); if (r.certificate) setTimeout(() => VS.confetti(), 900); }
        A.emit('school:changed', {});
        if (onChange) onChange();
      });
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      if (!paper || submitted) return;
      if (e.key === 'ArrowRight' && qi < paper.questions.length - 1) { qi++; paint(); }
      else if (e.key === 'ArrowLeft' && qi > 0) { qi--; paint(); }
    }
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-x]')) { close(!!t.closest('a[href^="#cert"]') || submitted); return; }
      if (t.closest('[data-begin]')) { begin(t.closest('[data-begin]')); return; }
      if (t.closest('[data-pickv]')) { close(true); setTimeout(() => chooseVertical(), 220); return; }
      const o = t.closest('[data-eopt]'); if (o && paper) { answers[paper.questions[qi].id] = o.dataset.eopt; paint(); const nx = body.querySelector('[data-enext],[data-submit]'); if (nx) nx.focus({ preventScroll: true }); return; }
      const j = t.closest('[data-jump]'); if (j) { qi = Number(j.dataset.jump); paint(); return; }
      if (t.closest('[data-enext]')) { qi++; paint(); return; }
      if (t.closest('[data-eprev]')) { qi--; paint(); return; }
      if (t.closest('[data-submit]')) submit(t.closest('[data-submit]'));
    });
  }

  /* =====================================================================
   * CERTIFICATE PAGE
   * ===================================================================== */
  /** What the certificate says was done. "Passed the school's final exam" only when it really had one and it was passed
   * (a school made in the admin may have no exam at all). The same words go on the PNG and the PDF (src/pdf.js). */
  const certWhat = (c) => (c.final
    ? `completed every lesson, quiz and module exam of VooSquare Academy: ${c.school}, and passed the school's final exam. Taught by the VooSquare Academy team at Zedapex.`
    : `completed every lesson and module of VooSquare Academy: ${c.school}. Taught by the VooSquare Academy team at Zedapex.`);
  function certHtml(c) {
    const parts = String(c.title || 'Certificate').split(/\s+[—–-]\s+/);
    const label = parts.length > 1 ? parts[0] : 'Certificate';
    const main = parts.length > 1 ? parts.slice(1).join(' — ') : parts[0];
    const order = Math.max(1, Math.min(3, c.school_order || 1));
    return `<div class="cert" role="img" aria-label="${esc(c.title)} awarded to ${esc(c.name)}">
      <div class="ct-side"><div class="ct-brand">${VS.PI.voosquare}<span><b>Voo<i>Square</i></b><em>Academy</em></span></div>
        <ol class="ct-route">${(c.track === 'vertical' ? [['Foundations', 'Main school'], [c.vertical_title || c.school, 'Vertical school']] : c.track === 'extra' ? [[c.school, 'VooSquare Academy']] : [['Foundations', 'School 1'], ['Operator', 'School 2'], ['Scale and Lead', 'School 3']]).map(([n, sub], k) => `<li class="${c.track === 'vertical' || c.track === 'extra' || k < order ? 'on' : ''}"><span>${c.track === 'vertical' || c.track === 'extra' || k < order ? icon('check') : k + 1}</span><b>${esc(n)}<small>${sub}</small></b></li>`).join('')}</ol>
        <p class="ct-motto">The school for media buyers.</p><p class="ct-site">${esc(c.site || 'voosquareacademy.com')}</p></div>
      <div class="ct-main"><span class="ct-label">${esc(label)}</span><h2>${esc(main)}</h2><p class="ct-k">This certifies that</p><p class="ct-name">${esc(c.name)}</p>
        <p class="ct-what">${esc(certWhat(c))}</p>
        <div class="ct-sign"><div><span class="ct-sig">Dchessking</span><b>Dchessking, Founder, Zedapex</b><small>VooSquare Academy</small></div><span class="ct-seal">${VS.PI.voosquare}<i>Verified</i></span></div>
        <dl class="ct-facts"><div><dt>Issued</dt><dd>${esc(VS.dateStr(c.issued_at))}</dd></div><div><dt>Certificate code</dt><dd>${esc(c.code)}</dd></div><div><dt>Check it at</dt><dd>${esc(c.verify_url.replace(/^https?:\/\//, ''))}</dd></div></dl></div></div>`;
  }

  /** PNG made in the browser: the same design as the PDF, drawn on a canvas at print size. */
  async function certPng(c) {
    try { await Promise.all(['800 40px "Plus Jakarta Sans"', '600 20px "Plus Jakarta Sans"', 'italic 60px "Instrument Serif"'].map((f) => document.fonts.load(f))); } catch { /* system fonts */ }
    const W = 2339, H = 1654, k = W / 841.89; // A4 landscape at 200 dpi, in PDF points × k
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const x = cv.getContext('2d');
    const P = (v) => v * k; const Y = (v) => H - v * k; // PDF coordinates (origin bottom left) to canvas
    const rr = (px, py, w, h, r) => { x.beginPath(); x.roundRect(P(px), Y(py + h), P(w), P(h), P(r)); };
    const text = (s, px, py, size, font, color, align = 'left') => { x.font = font.replace('{s}', P(size) + 'px'); x.fillStyle = color; x.textAlign = align; x.textBaseline = 'alphabetic'; x.fillText(s, P(px), Y(py)); };
    const JK = '{s} "Plus Jakarta Sans", Helvetica, Arial, sans-serif';
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    const PANEL = 232;
    x.fillStyle = '#0A1611'; x.fillRect(0, 0, P(PANEL), H);
    x.strokeStyle = '#13261C'; x.lineWidth = P(0.6);
    for (let gx = 24; gx < PANEL; gx += 26) { x.beginPath(); x.moveTo(P(gx), 0); x.lineTo(P(gx), H); x.stroke(); }
    for (let gy = 20; gy < 595; gy += 26) { x.beginPath(); x.moveTo(0, Y(gy)); x.lineTo(P(PANEL), Y(gy)); x.stroke(); }
    x.fillStyle = '#00A86B'; x.fillRect(P(PANEL), 0, P(3), H);
    x.strokeStyle = '#E3EBE7'; x.lineWidth = P(0.8); x.strokeRect(P(PANEL + 18), P(18), P(841.89 - PANEL - 36), P(595.28 - 36));
    const mark = (mx, my, s) => {
      x.fillStyle = '#00A86B'; rr(mx, my, s, s, s * 0.26); x.fill();
      const cc = s * 0.29, g = s * 0.1, o = (s - 2 * cc - g) / 2;
      [[o, o + cc + g, '#fff'], [o + cc + g, o + cc + g, '#B3E8D3'], [o, o, '#B3E8D3'], [o + cc + g, o, '#C9F65B']].forEach(([a, b, col]) => { x.fillStyle = col; rr(mx + a, my + b, cc, cc, cc * 0.28); x.fill(); });
    };
    mark(36, 595.28 - 82, 40);
    x.font = '800 ' + JK.replace('{s}', P(19) + 'px'); const vw = x.measureText('Voo').width / k;
    text('Voo', 88, 595.28 - 60, 19, '800 ' + JK, '#fff');
    text('Square', 88 + vw, 595.28 - 60, 19, '800 ' + JK, '#C9F65B');
    text('Academy', 88, 595.28 - 79, 15, 'italic {s} "Instrument Serif", Georgia, serif', '#fff');
    const vert = c.track === 'vertical';
    const extra = c.track === 'extra';
    const order = vert ? 2 : extra ? 1 : Math.max(1, Math.min(3, c.school_order || 1));
    const names = vert ? [['Foundations', 'Main school'], [c.vertical_title || c.school, 'Vertical school']] : extra ? [[c.school.length > 24 ? c.school.slice(0, 22).trim() + '…' : c.school, 'VooSquare Academy']] : [['Foundations', 'School 1'], ['Operator', 'School 2'], ['Scale and Lead', 'School 3']];
    const sx = 52, top = 595.28 - 190, gap = 92;
    x.lineCap = 'round';
    for (let i = 0; i < names.length - 1; i++) { x.beginPath(); x.moveTo(P(sx), Y(top - i * gap - 13)); x.lineTo(P(sx), Y(top - (i + 1) * gap + 13)); if (i + 1 < order) { x.strokeStyle = '#C9F65B'; x.lineWidth = P(3); x.setLineDash([]); } else { x.strokeStyle = '#2B4537'; x.lineWidth = P(2); x.setLineDash([P(3), P(5)]); } x.stroke(); }
    x.setLineDash([]);
    names.forEach(([n, sub], i) => {
      const cy = top - i * gap; const on = i < order;
      x.beginPath(); x.arc(P(sx), Y(cy), P(13), 0, Math.PI * 2); x.fillStyle = on ? '#C9F65B' : '#0A1611'; x.fill();
      if (on) { x.beginPath(); x.moveTo(P(sx - 5.5), Y(cy + 0.5)); x.lineTo(P(sx - 1.5), Y(cy - 4)); x.lineTo(P(sx + 6), Y(cy + 4.5)); x.strokeStyle = '#0A1611'; x.lineWidth = P(2.4); x.stroke(); }
      else { x.beginPath(); x.arc(P(sx), Y(cy), P(12), 0, Math.PI * 2); x.strokeStyle = '#2B4537'; x.lineWidth = P(2); x.stroke(); text(String(i + 1), sx, cy - 4, 11, '800 ' + JK, '#6F8579', 'center'); }
      text(n, sx + 26, cy + 1, 12.5, '800 ' + JK, on ? '#fff' : '#6F8579');
      text(sub, sx + 26, cy - 13, 9, '500 ' + JK, on ? '#B9C9C1' : '#4E6458');
    });
    text('The school for media buyers.', 36, 46, 14, 'italic {s} "Instrument Serif", Georgia, serif', '#C9F65B');
    text(String(c.site || 'voosquareacademy.com'), 36, 30, 9, '500 ' + JK, '#B9C9C1');
    const x0 = PANEL + 62, cw = 841.89 - x0 - 62;
    const parts = String(c.title || 'Certificate').split(/\s+[—–-]\s+/);
    const label = parts.length > 1 ? parts[0] : 'Certificate'; const main = parts.length > 1 ? parts.slice(1).join(' — ') : parts[0];
    x.fillStyle = '#00774B'; x.fillRect(P(x0), Y(595.28 - 89), P(26), P(3));
    text(label, x0 + 36, 595.28 - 95, 11.5, '800 ' + JK, '#00774B');
    let ts = 36; x.font = '800 ' + JK.replace('{s}', P(ts) + 'px'); while (ts > 22 && x.measureText(main).width / k > cw) { ts--; x.font = '800 ' + JK.replace('{s}', P(ts) + 'px'); }
    x.letterSpacing = P(-0.8) + 'px'; text(main, x0, 595.28 - 142, ts, '800 ' + JK, '#0A1A13'); x.letterSpacing = '0px';
    text('This certifies that', x0, 595.28 - 196, 12, '500 ' + JK, '#6A7A73');
    const SER = 'italic {s} "Instrument Serif", Georgia, serif';
    let ns = 60; x.font = SER.replace('{s}', P(ns) + 'px'); while (ns > 28 && x.measureText(c.name).width / k > cw) { ns--; x.font = SER.replace('{s}', P(ns) + 'px'); }
    text(c.name, x0, 595.28 - 258, ns, SER, '#0A1A13');
    x.fillStyle = '#E3EBE7'; x.fillRect(P(x0), Y(595.28 - 276), P(cw), P(1)); x.fillStyle = '#00A86B'; x.fillRect(P(x0), Y(595.28 - 276), P(64), P(3));
    // description, wrapped
    x.font = '500 ' + JK.replace('{s}', P(12) + 'px');
    const words = certWhat(c).split(' ');
    let line = '', ly = 595.28 - 304;
    for (const w2 of words) { const t2 = line ? line + ' ' + w2 : w2; if (x.measureText(t2).width / k > cw - 40 && line) { text(line, x0, ly, 12, '500 ' + JK, '#3A4842'); line = w2; ly -= 18; } else line = t2; }
    if (line) text(line, x0, ly, 12, '500 ' + JK, '#3A4842');
    const sy = 150;
    text('Dchessking', x0 + 4, sy + 12, 34, SER, '#0A1A13');
    x.fillStyle = '#0A1A13'; x.fillRect(P(x0), Y(sy), P(200), P(0.8));
    text('Dchessking, Founder, Zedapex', x0, sy - 15, 10, '800 ' + JK, '#0A1A13');
    text('VooSquare Academy', x0, sy - 28, 9, '500 ' + JK, '#6A7A73');
    const cx = x0 + cw - 52, cy = sy + 14;
    x.beginPath(); x.arc(P(cx), Y(cy), P(50), 0, Math.PI * 2); x.fillStyle = '#E7F8F0'; x.fill();
    x.beginPath(); x.arc(P(cx), Y(cy), P(43), 0, Math.PI * 2); x.strokeStyle = '#00A86B'; x.lineWidth = P(1.4); x.stroke();
    x.setLineDash([P(1.5), P(3)]); x.beginPath(); x.arc(P(cx), Y(cy), P(38), 0, Math.PI * 2); x.lineWidth = P(0.6); x.stroke(); x.setLineDash([]);
    mark(cx - 17, cy - 9, 34);
    x.letterSpacing = P(1.2) + 'px'; text('VERIFIED', cx, cy - 25, 6.5, '800 ' + JK, '#00774B', 'center'); x.letterSpacing = '0px';
    x.fillStyle = '#E3EBE7'; x.fillRect(P(x0), Y(94), P(cw), P(0.8));
    const cols = [['Issued', VS.dateStr(c.issued_at)], ['Certificate code', c.code], ['Check it at', c.verify_url.replace(/^https?:\/\//, '')]];
    const cwid = [120, 150, cw - 270]; let cxp = x0;
    cols.forEach(([kk, v], i) => { text(kk, cxp, 76, 8.5, '500 ' + JK, '#6A7A73'); let vs = 10.5; x.font = '800 ' + JK.replace('{s}', P(vs) + 'px'); while (vs > 7 && x.measureText(v).width / k > cwid[i] - 8) { vs -= 0.5; x.font = '800 ' + JK.replace('{s}', P(vs) + 'px'); } text(v, cxp, 60, vs, '800 ' + JK, '#0A1A13'); cxp += cwid[i]; });
    return new Promise((res) => cv.toBlob(res, 'image/png'));
  }

  function renderCert(view, code) {
    view.innerHTML = `${A.skel(420, '100%', 24)}`;
    let c = null;
    const paint = () => {
      A.setTitle(c.title);
      const li = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(c.verify_url)}`;
      const d = new Date(c.issued_at);
      const add = `https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME&name=${encodeURIComponent(c.title)}&organizationName=${encodeURIComponent('VooSquare Academy')}&issueYear=${d.getFullYear()}&issueMonth=${d.getMonth() + 1}&certUrl=${encodeURIComponent(c.verify_url)}&certId=${encodeURIComponent(c.code)}`;
      view.innerHTML = `<a class="backlink" href="#school/${esc(c.school_slug)}">${icon('left')}${esc(c.school)}</a>
        <div class="cert-page">
          <div class="cert-stage">${c.revoked ? `<div class="sch-gate rev">${icon('flag')}<span>This certificate was revoked. Write to support if you think this is a mistake.</span></div>` : ''}<div class="cert-fit">${certHtml(c)}</div></div>
          <aside class="cert-side card">
            <h3>${esc(c.title)}</h3><p class="muted">Awarded to <b>${esc(c.name)}</b> on ${esc(VS.dateStr(c.issued_at))}.</p>
            <div class="cs-acts">
              <a class="btn btn-k btn-block" href="/api/school/certificates/${encodeURIComponent(c.code)}/pdf" download ${c.revoked ? 'aria-disabled="true" tabindex="-1"' : ''}>${icon('download')}Download PDF</a>
              <button class="btn btn-w btn-block" data-png ${c.revoked ? 'disabled' : ''}>${icon('image')}Download picture (PNG)</button>
            </div>
            <div class="cs-share"><span class="cs-k">Share it</span>
              <a class="cs-li" href="${esc(li)}" target="_blank" rel="noopener">${icon('ext')}Post on LinkedIn</a>
              <a class="cs-li" href="${esc(add)}" target="_blank" rel="noopener">${icon('plus')}Add to your LinkedIn profile</a>
              <button class="cs-li" data-copy-v>${icon('link')}Copy the verify link</button></div>
            <div class="cs-verify"><span class="cs-k">Public page</span><a href="${esc(c.verify_url)}" target="_blank" rel="noopener" class="mono">${esc(c.verify_url.replace(/^https?:\/\//, ''))}</a><small>Shows the name, the certificate, the school and the date. Nothing else about you.</small></div>
            ${c.can_rename ? `<button class="cs-rename" data-rename>${icon('pen')}Change the printed name <small>(once)</small></button>` : '<p class="cs-renamed muted">The printed name was already changed once. Write to support to fix it.</p>'}
          </aside>
        </div>`;
      fit();
    };
    const fit = () => { const f = view.querySelector('.cert-fit'); if (!f) return; const w = f.clientWidth; f.style.setProperty('--s', Math.min(1, w / 1120)); };
    const onResize = () => fit();
    window.addEventListener('resize', onResize);
    VS.api('/api/school/certificates/' + encodeURIComponent(code)).then((d) => { c = d.certificate; if (view.isConnected) paint(); }).catch((e) => { view.innerHTML = `<a class="backlink" href="#academy">${icon('left')}VooSquare Academy</a><div class="card">${A.errorBox(e.message, false)}</div>`; });
    view.addEventListener('click', async (e) => {
      if (!c) return;
      if (e.target.closest('[data-copy-v]')) { VS.copyText(c.verify_url); return; }
      const pb = e.target.closest('[data-png]');
      if (pb) {
        await A.busy(pb, async () => {
          const blob = await certPng(c);
          if (!blob) { VS.toast('Your browser could not draw the picture. Use the PDF instead.', 'err'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `voosquare-academy-${c.code}.png`; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        });
        return;
      }
      if (e.target.closest('[data-rename]')) {
        const m = A.modal(`${A.modalHead('Change the printed name', 'You can do this once. Check the spelling.')}<div class="vs-modal-b"><form class="stack" data-f novalidate><label class="field"><span class="lbl">Name on the certificate</span><input class="inp" name="name" maxlength="60" value="${esc(c.name)}" autocomplete="name" autofocus></label><p class="muted sm">This is the name on the PDF, the picture and the public verify page.</p><div class="am-actions"><button type="button" class="btn btn-w" data-close>Cancel</button><button class="btn btn-k" type="submit">Save the name</button></div></form></div>`, { cls: 'am-sm' });
        m.el.querySelector('[data-f]').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const name = ev.target.name.value.trim();
          await A.busy(ev.target.querySelector('[type=submit]'), async () => {
            try { c = (await VS.api(`/api/school/certificates/${encodeURIComponent(c.code)}/name`, { body: { name } })).certificate; m.close(); VS.toast('Name saved'); paint(); } catch (er) { A.errToast(er); }
          });
        });
      }
    });
    return () => window.removeEventListener('resize', onResize);
  }

  A.openSchoolLesson = openLesson;
  A.studentCardHtml = studentCard; // the VooSquare Academy website shows the real card and certificate (academy-site.js)
  A.certHtml = certHtml;
  A.cardTilt = tilt;
  A.vglyph = vglyph;
  A.openSchoolExam = openExam;
  A.pages.academy = { title: 'VooSquare Academy', render: renderHome };
  A.pages.school = { title: 'VooSquare Academy', nav: 'academy', render: renderSchool };
  A.pages.module = { title: 'Module', nav: 'academy', render: renderModule };
  A.pages.cert = { title: 'Certificate', nav: 'academy', render: renderCert };
})();
