/* VooSquare admin panel. Vanilla JS, no build step.
 * Uses window.VS (shared.js) and window.VSL (lesson-visuals.js).
 * Structure: helpers -> router -> auth screens -> shell -> one render function per page -> boot. */
(function () {
  'use strict';
  const { $, $$, esc, fmt, timeAgo, dateStr, timeStr, icon, productIcon, avatar, toast, countUp, copyText } = VS;
  const DAY = 86400000;
  const S = { me: null, perms: [], allPerms: [], products: [], route: null, handle: null, cleanup: [], bus: {}, gbus: {} };
  const can = (p) => S.perms.includes('*') || S.perms.includes(p);
  const isOwner = () => S.perms.includes('*');
  const app = document.getElementById('app');
  /* Shared with /js/admin-ops.js (feature switches, backups, What's new, Today, quick search, shortcuts). */
  const VSA = window.VSA = window.VSA || {};

  /* ---------------- API shortcuts ---------------- */
  const GET = (p) => VS.api(p);
  /* Every change that saves clears the unsaved-changes guard: inside the button's own form or block when it runs through
   * run(), otherwise everywhere on the page. */
  const saving = (pr) => { const scope = S.runBtn || null; return pr.then((r) => { guard.clean(scope); return r; }); };
  const POST = (p, b) => saving(VS.api(p, { method: 'POST', body: b || {} }));
  const PUT = (p, b) => saving(VS.api(p, { method: 'PUT', body: b || {} }));
  const PATCH = (p, b) => saving(VS.api(p, { method: 'PATCH', body: b || {} }));
  const DEL = (p) => VS.api(p, { method: 'DELETE' });
  const saveSetting = (key, value) => PUT('/api/admin/settings/' + key, { value });

  /* ---------------- small utils ---------------- */
  const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const hashNum = (s) => { let h = 7; for (const c of String(s || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
  const seedAv = (s) => { const h = hashNum(s); return { skin: h % 8, hair: (h >> 3) % 6, hairColor: (h >> 6) % 5, shirt: (h >> 9) % 8, bg: (h >> 12) % 8, eyes: (h >> 15) % 3, mouth: (h >> 17) % 3, acc: (h >> 19) % 4 }; };
  const av = (a, size = 'sm', seed = '') => `<span class="av av-${size}">${avatar(a && Object.keys(a).length ? a : seedAv(seed))}</span>`;
  const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';
  const usd = (n) => '$' + fmt(n, Number(n) % 1 ? 2 : 0);
  const pill = (t, k = 'w') => `<span class="pill pill-${k}">${esc(t)}</span>`;
  const toDateInput = (ms) => { if (!ms) return ''; const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const fromDateInput = (s, end) => { if (!s) return 0; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, end ? 23 : 0, end ? 59 : 0, end ? 59 : 0).getTime(); };
  const fullDate = (t) => (t ? `${dateStr(t)}, ${timeStr(t)}` : '');
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
  const STATUS_PILL = { paid: 'g', pending: 'w', review: 'gold', failed: 'r', expired: 'w', cancelled: 'w', open: 'g', closed: 'w', queued: 'b', sent: 'g', error: 'r' };
  const statusPill = (s) => pill(s, STATUS_PILL[s] || 'w');
  /* Orders: plain words instead of the raw status ("review" reads as "To check"). */
  const ORDER_LABEL = { paid: 'Paid', pending: 'Waiting for payment', review: 'To check', failed: 'Failed', expired: 'Expired', cancelled: 'Cancelled', refunded: 'Refunded', chargeback: 'Charged back' };
  const orderPill = (s) => pill(ORDER_LABEL[s] || s, STATUS_PILL[s] || 'w');
  const productById = (id) => S.products.find((p) => p.id === Number(id));

  /* ---------------- event bus (SSE fan-out) ---------------- */
  function on(ev, fn) { (S.bus[ev] = S.bus[ev] || []).push(fn); S.cleanup.push(() => { S.bus[ev] = (S.bus[ev] || []).filter((f) => f !== fn); }); }
  function onGlobal(ev, fn) { (S.gbus[ev] = S.gbus[ev] || []).push(fn); }
  function emit(ev, d) { [...(S.gbus[ev] || []), ...(S.bus[ev] || [])].forEach((f) => { try { f(d); } catch (e) { console.error(e); } }); }
  const later = (fn) => S.cleanup.push(fn);

  /* ---------------- form helpers ---------------- */
  const attrs = (o) => Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== false && v !== null).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
  const field = (label, ctl, hint = '', cls = '') => `<label class="field ${cls}"><span class="lbl">${esc(label)}</span>${ctl}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
  const input = (name, v, o = {}) => `<input class="inp ${o.cls || ''}"${attrs({ name, type: o.type || 'text', value: v ?? '', placeholder: o.ph, step: o.step, min: o.min, max: o.max, maxlength: o.max_len, autocomplete: o.ac || 'off', readonly: o.ro, list: o.list, inputmode: o.im, 'aria-label': o.aria, spellcheck: o.spell })}>`;
  const textarea = (name, v, o = {}) => `<textarea class="inp ${o.cls || ''}"${attrs({ name, rows: o.rows || 4, placeholder: o.ph, 'aria-label': o.aria, spellcheck: o.spell })}>${esc(v ?? '')}</textarea>`;
  const select = (name, opts, v, o = {}) => `<select class="inp ${o.cls || ''}"${attrs({ name, 'aria-label': o.aria })}>${opts.map((x) => { const [val, lab] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(val)}"${String(val) === String(v ?? '') ? ' selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  const switchField = (name, on, label, hint = '') => `<label class="switch sw"><input type="checkbox"${attrs({ name, checked: !!on })}><i></i><span>${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span></label>`;
  const seg = (name, opts, v) => `<div class="seg" role="group" data-seg="${esc(name)}">${opts.map(([val, lab]) => `<button type="button" data-v="${esc(val)}" class="${String(val) === String(v) ? 'on' : ''}" aria-pressed="${String(val) === String(v)}">${lab}</button>`).join('')}<input type="hidden" name="${esc(name)}" value="${esc(v)}"></div>`;

  /** Read every [name] control inside root. Checkbox -> boolean, number -> Number. */
  function readForm(root) {
    const o = {};
    $$('[name]', root).forEach((el) => {
      if (el.closest('[data-noform]')) return;
      const k = el.name;
      if (el.type === 'checkbox') o[k] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[k] = el.value; }
      else if (el.type === 'number') o[k] = el.value === '' ? '' : Number(el.value);
      else o[k] = el.value;
    });
    return o;
  }

  /* Rows editor: a list of rows, each with one or more inputs. Used for lists, bars, tiers... */
  function rowsEditor(rows, cols, o = {}) {
    const meta = esc(JSON.stringify({ cols, add: o.add || 'Add' }));
    return `<div class="re" data-re="${meta}"${o.key ? ` data-key="${esc(o.key)}"` : ''}><div class="re-rows">${rows.map((r) => reRow(r, cols)).join('')}</div><button type="button" class="btn btn-w btn-xs re-add">${icon('plus')}${esc(o.add || 'Add')}</button></div>`;
  }
  function reRow(r, cols) {
    const vals = Array.isArray(r) ? r : [r];
    return `<div class="re-row">${cols.map((c, i) => `<input class="inp re-v ${c.cls || ''}" data-c="${i}" type="${c.type || 'text'}"${c.step ? ` step="${c.step}"` : ''} value="${esc(vals[i] ?? '')}" placeholder="${esc(c.ph || '')}" aria-label="${esc(c.aria || c.ph || 'Value')}" style="${c.w ? `flex:0 0 ${c.w}` : ''}">`).join('')}<span class="re-act"><button type="button" class="ib2 re-up" aria-label="Move up">${icon('up')}</button><button type="button" class="ib2 re-dn" aria-label="Move down">${icon('down')}</button><button type="button" class="ib2 re-rm" aria-label="Remove">${icon('x')}</button></span></div>`;
  }
  const listEditor = (items, o = {}) => rowsEditor((items || []).map((x) => [x]), [{ ph: o.ph || '', aria: o.aria || 'Item' }], o);
  function readRows(el) {
    if (!el) return [];
    const meta = JSON.parse(el.dataset.re);
    return $$('.re-row', el).map((row) => $$('.re-v', row).map((i) => (meta.cols[i.dataset.c].type === 'number' ? (i.value === '' ? 0 : Number(i.value)) : i.value.trim())));
  }
  const readList = (el) => readRows(el).map((r) => r[0]).filter((x) => x !== '');
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.re-add,.re-up,.re-dn,.re-rm');
    if (!b) return;
    const re = b.closest('.re'); const row = b.closest('.re-row'); const rows = $('.re-rows', re);
    if (b.classList.contains('re-add')) { const meta = JSON.parse(re.dataset.re); rows.insertAdjacentHTML('beforeend', reRow([], meta.cols)); const last = rows.lastElementChild; $('.re-v', last).focus(); }
    else if (b.classList.contains('re-rm')) row.remove();
    else if (b.classList.contains('re-up') && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    else if (b.classList.contains('re-dn') && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
    re.dispatchEvent(new Event('input', { bubbles: true }));
  });
  /* Segmented controls with a hidden input. */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-seg] > button');
    if (!b) return;
    const g = b.parentElement;
    $$('button', g).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    const h = $('input[type=hidden]', g);
    if (h) { h.value = b.dataset.v; h.dispatchEvent(new Event('input', { bubbles: true })); h.dispatchEvent(new Event('change', { bubbles: true })); }
  });

  /* ---------------- overlays ---------------- */
  function modal({ title, body, foot = '', wide = false, onClose }) {
    const el = document.createElement('div');
    el.className = 'vs-modal adm-modal';
    el.innerHTML = `<div class="vs-modal-p ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="vs-modal-h"><h3>${esc(title)}</h3><button type="button" class="x" aria-label="Close">${icon('x')}</button></div><div class="vs-modal-b">${body}</div>${foot ? `<div class="vs-modal-f">${foot}</div>` : ''}</div>`;
    document.body.appendChild(el);
    document.body.classList.add('noscroll');
    const prev = document.activeElement;
    const close = () => { el.remove(); document.removeEventListener('keydown', key); if (!$('.adm-modal')) document.body.classList.remove('noscroll'); if (prev && prev.focus) prev.focus(); if (onClose) onClose(); };
    // Closing by hand (X, Escape, the backdrop) with unsaved changes asks first, inside the modal.
    const tryClose = () => {
      if (!guard.any(el)) return close();
      if ($('.mdirty', el)) { $('.mdirty [data-keep]', el).focus(); return; }
      const bar = document.createElement('div');
      bar.className = 'mdirty'; bar.setAttribute('role', 'alertdialog');
      bar.innerHTML = `<span>${icon('pen')}You have changes that are not saved.</span><span class="row"><button type="button" class="btn btn-ghost btn-xs" data-keep>Keep editing</button><button type="button" class="btn btn-danger btn-xs" data-discard>Discard</button></span>`;
      $('.vs-modal-b', el).prepend(bar);
      $('[data-keep]', bar).onclick = () => bar.remove();
      $('[data-discard]', bar).onclick = () => { guard.clean($('.vs-modal-b', el)); close(); };
      $('[data-keep]', bar).focus();
    };
    const key = (e) => { if (e.key === 'Escape' && el === $$('.adm-modal').pop()) tryClose(); };
    el.addEventListener('mousedown', (e) => { if (e.target === el) tryClose(); });
    $('.x', el).addEventListener('click', tryClose);
    document.addEventListener('keydown', key);
    setTimeout(() => { const f = $('input:not([type=hidden]):not([readonly]),select,textarea', $('.vs-modal-b', el)); if (f && matchMedia('(min-width: 700px)').matches) f.focus(); else $('.x', el).focus(); }, 60);
    S.cleanup.push(() => { if (el.isConnected) close(); });
    return { el, close, q: (s) => $(s, el), qa: (s) => $$(s, el) };
  }

  /** In-page confirmation. Shows a small panel next to the button. No confirm(). */
  function confirmIn(anchor, { text, yes = 'Confirm', danger = true, typed = '', onYes }) {
    const host = anchor.closest('[data-cfm]');
    $$('.cfm').forEach((x) => x.remove());
    const box = document.createElement('div');
    box.className = 'cfm' + (danger ? ' danger' : '');
    box.setAttribute('role', 'alertdialog');
    box.innerHTML = `<p>${esc(text)}</p>${typed ? `<input class="inp cfm-t" autocomplete="off" placeholder="Type ${esc(typed)}" aria-label="Type ${esc(typed)} to confirm">` : ''}<div class="cfm-b"><button type="button" class="btn btn-ghost btn-sm cfm-no">Cancel</button><button type="button" class="btn ${danger ? 'btn-red' : 'btn-g'} btn-sm cfm-yes"${typed ? ' disabled' : ''}>${esc(yes)}</button></div>`;
    if (host) host.appendChild(box); else anchor.insertAdjacentElement('afterend', box);
    const yesB = $('.cfm-yes', box);
    const t = $('.cfm-t', box);
    if (t) { t.addEventListener('input', () => { yesB.disabled = t.value.trim() !== typed; }); t.focus(); } else yesB.focus();
    $('.cfm-no', box).addEventListener('click', () => { box.remove(); anchor.focus(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { box.remove(); anchor.focus(); } });
    yesB.addEventListener('click', async () => {
      const ok = await run(yesB, onYes);
      if (ok !== null && box.isConnected) box.remove();
    });
    return box;
  }

  /** Run an async action with a loading button and a toast. Returns null on failure. */
  async function run(btn, fn, okMsg) {
    if (btn) { btn.classList.add('loading'); btn.disabled = true; }
    try {
      S.runBtn = btn || null;
      let r;
      try { r = fn(); } finally { S.runBtn = null; }
      r = await r;
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      return r === undefined ? true : r;
    } catch (e) {
      toast((e && e.message) || 'Something went wrong. Try again.', 'err');
      return null;
    } finally {
      if (btn && btn.isConnected) { btn.classList.remove('loading'); btn.disabled = false; }
    }
  }

  /* ---------------- states ---------------- */
  const skelRows = (n = 5, h = 54) => `<div class="sk-list">${Array.from({ length: n }, () => `<div class="skel" style="height:${h}px"></div>`).join('')}</div>`;
  const skelCards = (n = 6, h = 160) => `<div class="cards">${Array.from({ length: n }, () => `<div class="skel" style="height:${h}px;border-radius:22px"></div>`).join('')}</div>`;
  const empty = (ic, title, text = '', action = '') => `<div class="empty">${icon(ic)}<b>${esc(title)}</b>${text ? `<span>${esc(text)}</span>` : ''}${action}</div>`;
  const errorBox = (e, retry = true) => `<div class="empty err-state">${icon('flag')}<b>This did not load</b><span>${esc((e && e.message) || 'Something went wrong.')}</span>${retry ? '<button type="button" class="btn btn-w btn-sm" data-retry>Try again</button>' : ''}</div>`;
  document.addEventListener('click', (e) => { if (e.target.closest('[data-retry]')) { if (S.me) route(true); else boot(); } });
  const pageHead = (title, sub = '', right = '') => `<div class="ph"><div class="ph-t"><h2>${title}</h2>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${right ? `<div class="ph-r">${right}</div>` : ''}</div>`;
  /* Breadcrumbs on detail pages: Section / (parent) / this page. The last part is filled from the page's own heading. */
  const backLink = (href, label) => {
    const root = href.slice(1).split(/[/?]/)[0];
    const P = PAGES[root];
    const deep = href.slice(1).includes('/') && !/^(All |Back to )/.test(label);
    return `<nav class="crumbs" aria-label="Breadcrumb"><a class="cr-back" href="${href}" aria-label="${esc(label)}">${icon('left')}</a><a href="#${root}">${esc(P ? P.t : label)}</a>${deep ? `<span class="cr-s" aria-hidden="true">/</span><a href="${href}">${esc(label)}</a>` : ''}<span class="cr-s" aria-hidden="true">/</span><span class="cr-cur" data-crumb aria-current="page"></span></nav>`;
  };
  function fillCrumbs(root) {
    $$('[data-crumb]', root).forEach((c) => {
      const pg = c.closest('.page');
      const h = pg && [...$$('h2', pg)].find((x) => !x.closest('.crumbs,.vs-modal'));
      const t = h ? h.textContent.trim() : '';
      if (t && c.textContent !== t) c.textContent = t;
      c.hidden = !t; if (c.previousElementSibling) c.previousElementSibling.hidden = !t;
    });
  }

  /* ---------------- unsaved-changes guard ----------------
   * Typing in a form (or a [data-guard] block) marks it as changed. Saving clears it. Leaving the page, closing a modal
   * or the tab with changes asks first. Search boxes, filters, quick actions and the support composer are not guarded. */
  const guard = (() => {
    const dirty = new Set();
    const scopeOf = (t) => t.closest('[data-guard]') || t.closest('form');
    const tracked = (t) => {
      if (!t || !t.matches || !t.matches('input,textarea,select') || t.type === 'search') return null;
      if (t.closest('[data-noguard],[role=search],.toolbar,.act,.adm-pal,[data-p=support],[data-p=revenue]')) return null;
      if (!t.closest('#view,.adm-modal')) return null;
      return scopeOf(t);
    };
    const mark = (e) => { if (!e.isTrusted) return; const s = tracked(e.target); if (s) dirty.add(s); };
    document.addEventListener('input', mark, true);
    document.addEventListener('change', mark, true);
    // Controls that are buttons (segments, colour swatches, add/move/remove rows) change a form too.
    document.addEventListener('click', (e) => {
      if (!e.isTrusted) return;
      const b = e.target.closest('[data-seg] > button, .re button, .swatches button, .sle-th, [data-mv]');
      if (!b || b.closest('[data-noguard],.toolbar,.act,[data-p=support],[data-p=revenue]') || !b.closest('#view,.adm-modal')) return;
      const s = scopeOf(b); if (s) dirty.add(s);
    }, true);
    const live = () => { for (const s of dirty) if (!s.isConnected) dirty.delete(s); return [...dirty]; };
    return {
      clean(btn) {
        const sc = btn && btn.isConnected ? (btn.closest('form') || btn.closest('[data-guard]') || btn.closest('.block') || btn.closest('.vs-modal-p') || btn.closest('.card')) : null;
        if (!sc) { dirty.clear(); return; }
        for (const s of [...dirty]) if (sc.contains(s) || s.contains(btn)) dirty.delete(s);
      },
      any: (root) => live().some((s) => !root || root.contains(s)),
      touch: (node) => { const s = node && scopeOf(node); if (s) dirty.add(s); },
      reset: () => dirty.clear(),
    };
  })();
  function askLeave(onLeave, text = 'You have changes on this page that are not saved yet.') {
    const m = modal({ title: 'Leave without saving?', body: `<p class="muted">${esc(text)}</p>`, foot: '<button type="button" class="btn btn-ghost btn-sm" data-stay>Keep editing</button><button type="button" class="btn btn-danger btn-sm" data-leave>Leave without saving</button>' });
    m.q('[data-stay]').onclick = m.close;
    m.q('[data-leave]').onclick = () => { guard.reset(); m.close(); onLeave(); };
    setTimeout(() => m.q('[data-stay]').focus(), 70);
  }
  window.addEventListener('beforeunload', (e) => { if (S.me && guard.any()) { e.preventDefault(); e.returnValue = ''; } });

  /** Toast with Undo. The action runs when the toast times out (6 s), on the next undoable action, or when the tab closes. */
  function undoToast(msg, { onUndo, onCommit, ms = 6000 } = {}) {
    $$('.adm-undo').forEach((t) => t._commit && t._commit());
    $$('.vs-toast').forEach((t) => t.remove());
    const t = document.createElement('div');
    t.className = 'adm-undo';
    t.setAttribute('role', 'status');
    t.innerHTML = `${icon('trash')}<span>${esc(msg)}</span><button type="button" class="adm-undo-b">Undo</button><i class="adm-undo-t" style="animation-duration:${ms}ms"></i>`;
    document.body.appendChild(t);
    let done = false;
    const finish = (undo) => {
      if (done) return; done = true;
      clearTimeout(tm); window.removeEventListener('pagehide', commit);
      t.classList.add('out'); setTimeout(() => t.remove(), 260);
      try { if (undo) { if (onUndo) onUndo(); toast('Restored'); } else if (onCommit) onCommit(); } catch (e) { console.error(e); }
    };
    const commit = () => finish(false);
    t._commit = commit;
    const tm = setTimeout(commit, ms);
    $('.adm-undo-b', t).onclick = () => finish(true);
    window.addEventListener('pagehide', commit);
  }

  /* Copy buttons anywhere: data-copy="text" */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    const target = b.dataset.copyEl ? $(b.dataset.copyEl) : null;
    copyText(b.dataset.copy, target || b);
  });
  const codeBlock = (code, label = 'Copy') => `<div class="code"><pre><code>${esc(code)}</code></pre><button type="button" class="btn btn-w btn-xs" data-copy="${esc(code)}" aria-label="${esc(label)}">${icon('copy')}Copy</button></div>`;

  /* ---------------- pages registry ---------------- */
  const PAGES = {};
  const NAV = [
    ['Work', ['overview', 'support', 'customers']],
    ['Content', ['community', 'academy', 'blog', 'content', 'whatsnew', 'tools']],
    ['Business', ['products', 'revenue', 'payments', 'payouts', 'plans', 'emails', 'affiliates']],
    ['Admin', ['team', 'audit', 'legal', 'settings']],
  ];
  function page(key, def) { PAGES[key] = def; }

  function parseHash() {
    const raw = location.hash.slice(1);
    const [path, qs] = raw.split('?');
    const parts = path.split('/').filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } });
    return { name: parts[0] || '', args: parts.slice(1), q: Object.fromEntries(new URLSearchParams(qs || '')) };
  }
  const allowedPages = () => Object.keys(PAGES).filter((k) => PAGES[k].perm());

  function route(force) {
    if (!S.me) return;
    const { name, args, q } = parseHash();
    const allowed = allowedPages();
    let key = name;
    if (!PAGES[key] || !PAGES[key].perm()) {
      key = allowed[0];
      if (name && PAGES[name]) toast('You do not have access to that section.', 'err');
      history.replaceState(null, '', '#' + key);
      return route(true);
    }
    // Same page with an update hook: let the page handle the change without a full re-render.
    if (!force && S.route && S.route.key === key && S.handle && S.handle.update) {
      S.route = { key, args, q };
      S.handle.update(args, q);
      return;
    }
    S.cleanup.splice(0).forEach((f) => { try { f(); } catch (e) { console.error(e); } });
    S.bus = {};
    const P = PAGES[key];
    S.route = { key, args, q };
    $('#pageTitle').textContent = P.t;
    document.title = P.t + ' · VooSquare Admin';
    $$('.nl[data-k]').forEach((b) => { const on = b.dataset.k === key; b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#shell').classList.remove('open'); document.body.classList.remove('noscroll-m');
    const view = $('#view');
    view.className = 'view' + (P.full ? ' full' : '');
    view.innerHTML = `<section class="page" data-p="${key}"></section>`;
    const el = view.firstElementChild;
    window.scrollTo(0, 0);
    S.handle = null;
    Promise.resolve().then(() => P.r(el, args, q)).then((h) => { if (el.isConnected) S.handle = h || null; }).catch((e) => { console.error(e); if (el.isConnected) el.innerHTML = errorBox(e); });
  }
  /* Leaving a page (or a detail view) with unsaved changes asks first. Filters on the same view never ask. */
  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    const to = location.hash;
    const nx = parseHash();
    const moving = !S.route || nx.name !== S.route.key || nx.args.join('/') !== S.route.args.join('/');
    if (S.me && moving && guard.any($('#view'))) {
      history.replaceState(null, '', lastHash || '#');
      askLeave(() => { location.hash = to; });
      return;
    }
    lastHash = to;
    route();
  });

  /* ---------------- auth screens ---------------- */
  function authArt() {
    const faces = [[1, 2, 0, 3], [3, 0, 2, 1], [5, 4, 1, 0], [0, 1, 4, 2], [2, 3, 6, 4], [6, 5, 3, 7]].map(([skin, hair, shirt, bg], i) => `<span class="af af${i}">${avatar({ skin, hair, shirt, bg, hairColor: i % 5, eyes: i % 3, mouth: i % 2, acc: i === 2 ? 1 : 0 })}</span>`).join('');
    return `<div class="auth-art" aria-hidden="true"><div class="gridbg"></div><div class="glow"></div>
      <div class="auth-brand"><span class="logo-chip">${VS.PI.voosquare}</span><span>Voo<b>Square</b></span><span class="adm-tag">Admin</span></div>
      <div class="auth-copy"><h1>Run the square<br><span class="serif">from one place.</span></h1><p>Support, members, content, payments and your team. What you change here goes live straight away.</p></div>
      <div class="auth-crew">${faces}<div class="auth-chip c1"><i class="live-dot"></i>3 new conversations</div><div class="auth-chip c2">${icon('check')}Order approved</div></div></div>`;
  }

  function renderLogin() {
    document.body.className = 'adm-auth';
    app.innerHTML = `<div class="auth">${authArt()}<div class="auth-panel"><div class="auth-card" id="authCard"></div><p class="auth-foot">VooSquare by Zedapex. <a href="/">Back to the site</a></p></div></div>`;
    stepEmail();
  }
  function stepEmail(prefill = '') {
    const card = $('#authCard');
    card.innerHTML = `<form id="fEmail" novalidate><span class="logo-chip sm">${VS.PI.voosquare}</span><h2>Sign in to the admin</h2><p class="muted">Use the email on your Voo ID. We send you a 6-digit code.</p>
      ${field('Email', input('email', prefill, { type: 'email', ph: 'you@company.com', ac: 'email', im: 'email' }))}
      <p class="err" id="eErr" role="alert"></p>
      <button class="btn btn-g btn-block" type="submit">Send me a code${icon('arrow')}</button></form>`;
    const f = $('#fEmail');
    setTimeout(() => $('input', f).focus(), 50);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('input', f).value.trim();
      $('#eErr').textContent = '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { $('#eErr').textContent = 'Enter a valid email address.'; return; }
      const btn = $('button[type=submit]', f);
      btn.classList.add('loading'); btn.disabled = true;
      try { const r = await POST('/api/auth/start', { email }); stepCode(email, r.dev_code); }
      catch (err) { $('#eErr').textContent = err.message; btn.classList.remove('loading'); btn.disabled = false; }
    });
  }
  function stepCode(email, dev) {
    const card = $('#authCard');
    card.innerHTML = `<form id="fCode" novalidate><button type="button" class="back" id="chEmail">${icon('left')}Use a different email</button><h2>Check your email</h2><p class="muted">We sent a 6-digit code to <b>${esc(email)}</b>. It works for 10 minutes.</p>
      ${field('6-digit code', `<input class="inp code-inp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]*" placeholder="000000">`)}
      ${dev ? `<div class="devhint">${icon('settings')}<span>Dev mode, email is not set up. Your code is <b class="mono">${esc(dev)}</b></span><button type="button" class="btn btn-w btn-xs" id="fillDev">Fill it</button></div>` : ''}
      <p class="err" id="cErr" role="alert"></p>
      <button class="btn btn-g btn-block" type="submit">Sign in${icon('arrow')}</button>
      <button type="button" class="btn btn-ghost btn-sm btn-block" id="resend">Send a new code</button></form>`;
    const f = $('#fCode'); const ci = $('.code-inp', f);
    setTimeout(() => ci.focus(), 50);
    $('#chEmail').onclick = () => stepEmail(email);
    if (dev) $('#fillDev').onclick = () => { ci.value = dev; f.requestSubmit(); };
    $('#resend').onclick = async (e) => { const r = await run(e.currentTarget, () => POST('/api/auth/start', { email }), 'New code sent'); if (r) stepCode(email, r.dev_code); };
    ci.addEventListener('input', () => { ci.value = ci.value.replace(/\D/g, '').slice(0, 6); if (ci.value.length === 6) f.requestSubmit(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (ci.value.length !== 6) { $('#cErr').textContent = 'Enter all 6 digits.'; return; }
      const btn = $('button[type=submit]', f);
      if (btn.disabled) return;
      btn.classList.add('loading'); btn.disabled = true;
      try { await POST('/api/auth/verify', { email, code: ci.value }); boot(); }
      catch (err) { $('#cErr').textContent = err.message; btn.classList.remove('loading'); btn.disabled = false; ci.select(); }
    });
  }

  function renderNoAccess(user) {
    document.body.className = 'adm-auth';
    app.innerHTML = `<div class="auth">${authArt()}<div class="auth-panel"><div class="auth-card center">
      ${user ? av(user.avatar, 'xl', user.email) : `<span class="logo-chip">${VS.PI.voosquare}</span>`}
      <h2>You don't have admin access</h2>
      <p class="muted">${user ? `You are signed in as <b>${esc(user.email)}</b>. ` : ''}The admin is for the VooSquare team. If you should be here, ask an owner to add you under Team.</p>
      <a class="btn btn-g btn-block" href="/app">Open VooSquare${icon('arrow')}</a>
      <button type="button" class="btn btn-ghost btn-sm btn-block" id="swap">Sign in with another email</button></div></div></div>`;
    $('#swap').onclick = async () => { try { await POST('/api/auth/logout'); } catch { /* ignore */ } renderLogin(); };
  }

  /* ---------------- shell ---------------- */
  function renderShell() {
    document.body.className = 'adm';
    const u = S.me;
    const navHtml = NAV.map(([g, keys]) => {
      const items = keys.filter((k) => PAGES[k] && PAGES[k].perm());
      if (!items.length) return '';
      return `<div class="navg"><h5>${g}</h5>${items.map((k) => `<a class="nl" href="#${k}" data-k="${k}">${icon(PAGES[k].i)}<span>${PAGES[k].t}</span><span class="cnt" data-badge="${k}" hidden></span></a>`).join('')}</div>`;
    }).join('');
    const role = u.role_title || (isOwner() ? 'Owner' : 'Team');
    app.innerHTML = `<div class="shell" id="shell">
      <aside class="side" id="side" aria-label="Admin menu">
        <a class="brand" href="#${allowedPages()[0] || ''}"><span class="logo-chip sm">${VS.PI.voosquare}</span><span>Voo<b>Square</b></span><span class="adm-tag">Admin</span></a>
        <button type="button" class="side-x" id="sideX" aria-label="Close menu">${icon('x')}</button>
        <div class="ws">${av(u.avatar, 'md', u.email)}<div class="ws-t"><b>${esc(u.name)}</b><small><i class="live-dot"></i>${esc(role)}</small></div></div>
        <nav aria-label="Sections">${navHtml}</nav>
        <div class="side-foot"><a class="nl" href="/app">${icon('grid')}<span>Open the app</span></a><button type="button" class="nl" id="logout">${icon('logout')}<span>Log out</span></button></div>
      </aside>
      <div class="scrim" id="scrim"></div>
      <div class="main">
        <header class="top">
          <button type="button" class="ham" id="ham" aria-label="Open menu">${icon('menu')}</button>
          <h1 id="pageTitle">Admin</h1>
          <button type="button" class="search qs-open" id="qsOpen" aria-label="Search the admin" aria-keyshortcuts="Control+K Meta+K">${icon('search')}<span>Search members, rooms, settings</span><kbd>${/Mac|iP/.test(navigator.platform) ? '⌘' : 'Ctrl '}K</kbd></button>
          <div class="top-r">
            <button type="button" class="ib only-m qs-open" aria-label="Search the admin">${icon('search')}</button>
            <button type="button" class="ib hide-m" id="kbHelp" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"><span class="kb-q" aria-hidden="true">?</span></button>
            <a class="btn btn-w btn-sm view-site" href="/" target="_blank" rel="noopener">${icon('ext')}<span>View site</span></a>
            <span class="me">${avatar(Object.keys(u.avatar || {}).length ? u.avatar : seedAv(u.email))}</span>
          </div>
        </header>
        <main id="view" class="view" tabindex="-1"></main>
      </div>
    </div>`;
    const shell = $('#shell');
    $('#ham').onclick = () => { shell.classList.add('open'); document.body.classList.add('noscroll-m'); $('.nl', $('#side')).focus(); };
    const closeSide = () => { shell.classList.remove('open'); document.body.classList.remove('noscroll-m'); };
    $('#scrim').onclick = closeSide;
    $('#sideX').onclick = () => { closeSide(); $('#ham').focus(); };
    $$('.qs-open').forEach((b) => { b.onclick = () => VSA.openSearch(); });
    $('#kbHelp').onclick = () => VSA.shortcuts();
    if (!S.keysBound) {
      S.keysBound = true;
      document.addEventListener('keydown', (e) => {
        if (!S.me) return;
        const sh = $('#shell');
        if (e.key === 'Escape' && sh && sh.classList.contains('open')) closeSide();
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); VSA.openSearch(); return; }
        const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
        if (typing || e.metaKey || e.ctrlKey || e.altKey || $('.adm-modal,.adm-pal-ov')) return;
        if (e.key === '/') { e.preventDefault(); VSA.openSearch(); return; }
        if (e.key === '?') { e.preventDefault(); VSA.shortcuts(); return; }
        VSA.goKey(e);
      });
    }
    // Detail pages: fill the last breadcrumb from the page heading as it renders.
    new MutationObserver(() => fillCrumbs($('#view'))).observe($('#view'), { childList: true, subtree: true });
    // Swipe the menu closed on phones.
    let sx = null;
    $('#side').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    $('#side').addEventListener('touchend', (e) => { if (sx != null && e.changedTouches[0].clientX - sx < -60) closeSide(); sx = null; });
    $('#logout').onclick = async () => { try { await POST('/api/auth/logout'); } catch { /* ignore */ } S.me = null; if (S.staffStream) S.staffStream.close(); renderLogin(); };

    // Live staff channel: tickets and orders.
    if (S.staffStream) S.staffStream.close();
    S.staffStream = VS.stream(['staff'], { ticket: (d) => emit('ticket', d), order: (d) => emit('order', d), application: (d) => emit('application', d), payout: (d) => emit('payout', d), report: (d) => emit('report', d) });
    onGlobal('ticket', refreshBadges);
    onGlobal('order', refreshBadges);
    onGlobal('payout', (d) => { refreshBadges(); if (d && d.status === 'requested' && can('payments')) toast('New payout request'); });
    onGlobal('application', (d) => { refreshBadges(); if (d && d.status === 'pending' && can('community')) toast('New application for a paid room'); });
    onGlobal('report', (d) => { refreshBadges(); if (d && !d.handled && can('community')) toast(d.hidden ? 'A reported message was hidden. Review it in Community → Reports.' : 'New report in the community'); });
    refreshBadges();
    if (!location.hash) history.replaceState(null, '', '#' + allowedPages()[0]);
    route(true);
  }

  function setBadge(key, n) {
    const b = $(`[data-badge="${key}"]`);
    if (!b) return;
    const was = b.textContent;
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
    if (n && was !== b.textContent) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); }
  }
  const refreshBadges = debounce(async () => {
    if (can('support')) { try { const r = await GET('/api/admin/tickets?status=open'); setBadge('support', (r.counts.find((c) => c.status === 'open') || {}).n || 0); } catch { /* ignore */ } }
    if (can('payments')) { try { const r = await GET('/api/admin/orders?status=review'); setBadge('payments', r.orders.length); } catch { /* ignore */ } }
    if (can('payments')) { try { const r = await GET('/api/admin/payouts?status=requested'); setBadge('payouts', r.totals.requested); } catch { /* ignore */ } }
    if (can('community')) {
      let apps = 0; let reps = 0;
      try { const r = await GET('/api/admin/applications?status=pending'); apps = (r.counts.find((c) => c.status === 'pending') || {}).n || 0; S.pendingApps = apps; emit('appcount', apps); } catch { /* ignore */ }
      try { reps = (await GET('/api/admin/reports?count=1')).open || 0; S.openReports = reps; emit('repcount', reps); } catch { /* ignore */ }
      setBadge('community', apps + reps);
    }
  }, 500);

  /* =====================================================================
   * OVERVIEW
   * ===================================================================== */
  const niceMax = (m) => { if (m <= 0) return 4; const p = 10 ** Math.floor(Math.log10(m)); return [1, 2, 2.5, 4, 5, 10].map((s) => s * p).find((s) => s >= m); };

  /** Area chart drawn in SVG at the container's real width. Hover shows a tooltip. */
  function areaChart(box, series, { isMoney = false, color = '#00A86B', name = '' } = {}) {
    const draw = () => {
      if (!box.isConnected) return;
      const W = Math.max(box.clientWidth, 260), H = 220, pl = isMoney ? 48 : 34, pr = 10, pt = 12, pb = 26;
      const n = series.length, max = niceMax(Math.max(...series, 0));
      const x = (i) => pl + (i * (W - pl - pr)) / (n - 1);
      const y = (v) => pt + (H - pt - pb) * (1 - v / max);
      const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      const line = 'M' + pts.join(' L');
      const area = `${line} L${x(n - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
      const now = Date.now();
      const dayOf = (i) => new Date(now - (n - 1 - i) * DAY);
      const lab = (v) => (isMoney ? '$' + fmt(v) : fmt(v));
      const gid = 'g' + Math.random().toString(36).slice(2, 7);
      const ticks = [0, max / 2, max];
      const step = W < 420 ? 10 : 7;
      const xl = series.map((_, i) => i).filter((i) => (n - 1 - i) % step === 0);
      box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)} for the last 30 days">
        <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
        ${ticks.map((t) => `<line x1="${pl}" x2="${W - pr}" y1="${y(t)}" y2="${y(t)}" class="gl"/><text x="${pl - 8}" y="${y(t) + 4}" text-anchor="end" class="ax">${lab(t)}</text>`).join('')}
        ${xl.map((i) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax">${dayOf(i).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>`).join('')}
        <path d="${area}" fill="url(#${gid})" class="fadein"/>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" class="draw"/>
        <line class="hv-l" x1="0" x2="0" y1="${pt}" y2="${H - pb}" visibility="hidden"/>
        <circle class="hv-d" r="5" fill="#fff" stroke="${color}" stroke-width="3" visibility="hidden"/>
        <rect x="${pl}" y="0" width="${W - pl - pr}" height="${H}" fill="transparent" class="hv-r"/>
      </svg><div class="tip" hidden></div>`;
      const path = $('.draw', box);
      try { path.style.setProperty('--len', Math.ceil(path.getTotalLength())); } catch { /* ignore */ }
      const tip = $('.tip', box), hl = $('.hv-l', box), hd = $('.hv-d', box);
      const show = (ev) => {
        const r = box.getBoundingClientRect();
        const px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
        const i = Math.max(0, Math.min(n - 1, Math.round(((px - pl) / (W - pl - pr)) * (n - 1))));
        hl.setAttribute('x1', x(i)); hl.setAttribute('x2', x(i)); hl.setAttribute('visibility', 'visible');
        hd.setAttribute('cx', x(i)); hd.setAttribute('cy', y(series[i])); hd.setAttribute('visibility', 'visible');
        tip.hidden = false;
        tip.innerHTML = `<b>${lab(series[i])}</b><span>${dayOf(i).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</span>`;
        const tx = Math.min(Math.max(x(i) - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
        tip.style.transform = `translate(${tx}px, ${Math.max(y(series[i]) - 54, 0)}px)`;
      };
      const hide = () => { tip.hidden = true; hl.setAttribute('visibility', 'hidden'); hd.setAttribute('visibility', 'hidden'); };
      const rect = $('.hv-r', box);
      rect.addEventListener('pointermove', show); rect.addEventListener('pointerdown', show); rect.addEventListener('pointerleave', hide);
    };
    draw();
    let lastW = box.clientWidth;
    const onR = debounce(() => { if (box.clientWidth !== lastW) { lastW = box.clientWidth; draw(); } }, 150);
    window.addEventListener('resize', onR);
    later(() => window.removeEventListener('resize', onR));
  }

  /** Overview money tile: 30-day total, change vs the 30 days before, and a sparkline (accent = the latest day). */
  function revKpi(d, href, i) {
    const s = d.revenue_series; const n = s.length; const W = 120, H = 34;
    const mx = Math.max(...s, 0) || 1;
    const x = (j) => (j * (W - 4)) / Math.max(n - 1, 1) + 2; const y = (v) => H - 3 - (v / mx) * (H - 8);
    const line = s.map((v, j) => `${j ? 'L' : 'M'}${x(j).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const ch = d.revenue_change_pct;
    const delta = ch === null || ch === undefined ? '' : `<span class="rv-delta tiny ${ch > 0 ? 'up' : ch < 0 ? 'down' : 'flat'}">${ch ? icon(ch > 0 ? 'up' : 'down') : ''}${ch > 0 ? '+' : ch < 0 ? '−' : ''}${Math.abs(ch).toLocaleString('en-US', { maximumFractionDigits: 1 })}%</span>`;
    return `<${href ? `a href="${href}"` : 'div'} class="card kpi kpi-rev" style="animation-delay:${i * 40}ms"><span class="kl"><span class="kic">${icon('wallet')}</span>Revenue, 30 days</span>
      <span class="kr-row"><b class="kv" data-v="${d.revenue_30d}" data-pre="$">$0</b><svg class="kspark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${line}L${x(n - 1)},${H}L${x(0)},${H}Z" class="ks-a"/><path d="${line}" class="ks-l"/><circle cx="${x(n - 1).toFixed(1)}" cy="${y(s[n - 1]).toFixed(1)}" r="3.5" class="ks-d"/></svg></span>
      <small>${delta}${href ? `<span class="kr-link">Open revenue${icon('arrow')}</span>` : 'VooSquare sales and tool spend'}</small></${href ? 'a' : 'div'}>`;
  }

  page('overview', {
    t: 'Overview', i: 'chart', perm: () => can('settings') || can('payments'),
    async r(el) {
      el.innerHTML = `<div class="kpis">${Array.from({ length: 8 }, () => '<div class="card kpi"><div class="skel" style="height:14px;width:55%"></div><div class="skel" style="height:34px;width:40%;margin-top:14px"></div></div>').join('')}</div>
        <div class="g2 mt"><div class="card"><div class="skel" style="height:250px"></div></div><div class="card"><div class="skel" style="height:250px"></div></div></div>`;
      const d = await GET('/api/admin/overview');
      if (!el.isConnected) return;
      const K = [
        ['users', 'Members', d.members, '', `${fmt(d.new_today)} joined today`, can('customers') ? '#customers' : ''],
        ['plus', 'New this week', d.new_week, '', 'Last 7 days', can('customers') ? '#customers?filter=new' : ''],
        ['eye', 'Active this week', d.active_week, '', 'Opened VooSquare', ''],
        ['diamond', 'Premium', d.premium, '', 'Paying members now', can('customers') ? '#customers?filter=premium' : ''],
        ['wallet', 'Revenue, 30 days', d.revenue_30d, '$', 'VooSquare sales and tool spend', canMoney() ? '#revenue' : '', 'rev'],
        ['inbox', 'Open tickets', d.open_tickets, '', 'Waiting for a reply', can('support') ? '#support' : ''],
        ['card', 'Orders in review', d.orders_review, '', 'Need a manual check', can('payments') ? '#payments?status=review' : ''],
        ['chat', 'Messages today', d.messages_today, '', 'In community rooms', can('community') ? '#community/moderation' : ''],
      ];
      const sum = (a) => a.reduce((x, y) => x + y, 0);
      el.innerHTML = `
        ${pageHead(`${esc(VSA.greeting ? VSA.greeting() : 'Hello')}, ${esc(firstName(S.me.name))}`, 'What needs you today, then how the square is doing.')}
        <div id="today" class="today-wrap"></div>
        <div class="kpis">${K.map(([ic, l, v, pre, sub, href, kind], i) => (kind === 'rev' && d.revenue_series ? revKpi(d, href, i)
          : `<${href ? `a href="${href}"` : 'div'} class="card kpi" style="animation-delay:${i * 40}ms"><span class="kl"><span class="kic">${icon(ic)}</span>${esc(l)}</span><b class="kv" data-v="${v}" data-pre="${pre}">${pre}0</b><small>${esc(sub)}</small></${href ? 'a' : 'div'}>`)).join('')}</div>
        <div class="g2 mt">
          <div class="card"><div class="card-h"><div><h3>Sign-ups</h3><span class="sub">${fmt(sum(d.signups_series))} in the last 30 days · ${fmt(d.lessons_done_week)} lessons finished this week</span></div></div><div class="chart" id="chS"></div></div>
          <div class="card"><div class="card-h"><div><h3>Revenue</h3><span class="sub">${usd(sum(d.revenue_series))} from VooSquare sales and tool spend · ${fmt(d.emails_queued)} emails queued</span></div></div><div class="chart" id="chR"></div></div>
        </div>
        <div class="g3 mt">
          <div class="card"><div class="card-h"><h3>New members</h3>${can('customers') || can('support') ? '<a class="r btn btn-ghost btn-xs" href="#customers">All</a>' : ''}</div>
            ${d.recent_members.length ? `<div class="mini-list">${d.recent_members.map((m) => `<a class="mini" ${can('customers') || can('support') ? `href="#customers/${m.id}"` : ''}>${av(m.avatar, 'md', m.email)}<span class="mini-t"><b>${esc(m.name)}</b><small>${esc(m.email)}</small></span><span class="mini-r">${m.premium ? pill('Premium', 'gold') : ''}<time>${timeAgo(m.created_at)}</time></span></a>`).join('')}</div>` : empty('users', 'No members yet')}
          </div>
          <div class="card"><div class="card-h"><h3>Recent orders</h3>${can('payments') ? '<a class="r btn btn-ghost btn-xs" href="#payments">All</a>' : ''}</div>
            ${d.recent_orders.length ? `<div class="mini-list">${d.recent_orders.map((o) => `<div class="mini"><span class="kic sm">${icon(o.item_type === 'room' ? 'chat' : 'diamond')}</span><span class="mini-t"><b>${esc(o.item_name)}</b><small>${esc(o.name)} · ${esc(fmt(o.amount, o.amount % 1 ? 2 : 0))} ${esc(o.currency)}</small></span><span class="mini-r">${orderPill(o.status)}<time>${timeAgo(o.created_at)}</time></span></div>`).join('')}</div>` : empty('card', 'No orders yet', 'Orders show here when members buy Premium or a paid room.')}
          </div>
          <div class="card"><div class="card-h"><h3>Open tickets by product</h3></div>
            ${(() => { const mx = Math.max(1, ...d.by_product.map((p) => p.n)); return `<div class="bp">${d.by_product.map((p) => `<div class="bp-r">${productIcon(p, 'xs')}<span class="bp-n">${esc(p.name)}</span><span class="bp-b"><i style="width:${(p.n / mx) * 100}%"></i></span><b>${p.n}</b></div>`).join('')}</div>`; })()}
          </div>
        </div>`;
      if (VSA.today) VSA.today($('#today', el));
      $$('.kv', el).forEach((b) => countUp(b, Number(b.dataset.v), { pre: b.dataset.pre, dec: Number(b.dataset.v) % 1 ? 2 : 0 }));
      areaChart($('#chS', el), d.signups_series, { name: 'Sign-ups', color: '#00A86B' });
      areaChart($('#chR', el), d.revenue_series, { isMoney: true, name: 'Revenue', color: '#5B3FE8' });
    },
  });

  /* =====================================================================
   * REVENUE
   * Money in from VooSquare sales (paid orders) and spend that tools report (Events API, type "spend").
   * Charts are hand-rolled SVG. Colours come from the server (one validated categorical palette, fixed stack order).
   * ===================================================================== */
  const canMoney = () => can('payments') || can('settings');
  const cd = (s) => new Date(s + 'T00:00:00Z'); // civil date, no time zone
  const cdFmt = (s, o) => cd(s).toLocaleDateString('en-GB', { timeZone: 'UTC', ...o }).replace('Sept', 'Sep');
  const dayNum = (s) => Math.round(cd(s).getTime() / DAY);
  const money = (n) => { n = Number(n) || 0; return (n < 0 ? '-$' : '$') + fmt(Math.abs(n), n % 1 && Math.abs(n) < 1000 ? 2 : 0); };
  const compact = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return '$' + +(n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    if (a >= 1e3) return '$' + +(n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k';
    return '$' + fmt(n, n % 1 && a < 10 ? 2 : 0);
  };
  const pct = (x) => (x >= 0.995 ? '100%' : x > 0 && x < 0.001 ? '<0.1%' : (x * 100).toFixed(x < 0.1 ? 1 : 0) + '%');
  function niceScale(max, count = 4) {
    if (!(max > 0)) return { top: 100, step: 25 };
    const raw = max / count; const p = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * p).find((s) => s >= raw - 1e-9);
    return { top: Math.ceil(max / step - 1e-9) * step, step };
  }
  function rangeLabel(from, to) {
    if (from === to) return cdFmt(from, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const sameY = from.slice(0, 4) === to.slice(0, 4);
    return `${cdFmt(from, { day: 'numeric', month: 'short', ...(sameY ? {} : { year: 'numeric' }) })} – ${cdFmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  function bucketTitle(s, group) {
    if (group === 'day') return cdFmt(s.start_date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    if (group === 'month') {
      const whole = s.start_date.endsWith('-01') && new Date(cd(s.end_date).getTime() + DAY).getUTCDate() === 1;
      return whole ? cdFmt(s.start_date, { month: 'long', year: 'numeric' }) : rangeLabel(s.start_date, s.end_date);
    }
    return rangeLabel(s.start_date, s.end_date);
  }
  function xLabel(s, group, i) {
    if (group === 'month') { const m = cdFmt(s.start_date, { month: 'short' }); return i === 0 || s.start_date.slice(5, 7) === '01' ? `${m} ${s.start_date.slice(2, 4)}` : m; }
    return cdFmt(s.start_date, { day: 'numeric', month: 'short' });
  }
  const GROUP_LBL = { day: 'Daily', week: 'Weekly', month: 'Monthly' };
  /** Chart layers in stack order (bottom first). Products outside the palette fold into one "Other tools" layer. */
  function revLayers(series, products) {
    const out = []; let other = null;
    for (const p of products) {
      const values = series.map((s) => s.by[p.key] || 0);
      if (!values.some((v) => v > 0)) continue;
      if (p.other) { if (!other) other = { key: 'other', name: 'Other tools', color: '#8A9A93', values: values.map(() => 0), members: [] }; values.forEach((v, i) => { other.values[i] += v; }); other.members.push(p.name); continue; }
      out.push({ key: p.key, name: p.name, color: p.chart, values });
    }
    if (other) out.push(other);
    return out;
  }

  /**
   * Stacked column chart. Bars grow from the baseline, 2px surface gaps between segments, 4px rounded top.
   * The y axis stays put while long ranges scroll sideways inside the card. Hover, tap or arrow keys show every product for that period.
   */
  function revChart(box, { series, layers, group, compare = false, height, compact: small = false, onEmpty = '' }) {
    const n = series.length;
    let animate = true;
    let lastW = 0;
    const draw = () => {
      if (!box.isConnected) return;
      const narrow = box.clientWidth < 560;
      const H = height || (narrow ? 236 : 292), pt = 12, pb = 28, axisW = small ? 44 : 52;
      const viewW = Math.max(box.clientWidth - axisW, 160);
      const slot = Math.max(viewW / n, small ? 9 : narrow ? 14 : 10);
      const W = Math.max(viewW, Math.ceil(slot * n));
      const bw = Math.max(3, Math.min(24, slot * 0.6));
      const maxV = Math.max(0, ...series.map((s) => s.total), ...(compare ? series.map((s) => s.prev || 0) : []));
      const { top, step } = niceScale(maxV);
      const y = (v) => pt + (H - pt - pb) * (1 - v / top);
      const base = y(0);
      const cx = (i) => slot * i + slot / 2;
      const ticks = []; for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
      const every = Math.max(1, Math.ceil((group === 'month' ? 50 : 46) / slot));
      const showX = (i) => (n - 1 - i) % every === 0;
      const cols = series.map((s, i) => {
        let acc = 0; const segs = [];
        layers.forEach((L) => { const v = L.values[i]; if (v > 0) { segs.push({ L, y0: y(acc), y1: y(acc + v) }); acc += v; } });
        if (!segs.length) return '';
        const x = cx(i) - bw / 2;
        const parts = segs.map((sg, j) => {
          const yb = sg.y0 - (j ? 2 : 0);
          let yt = sg.y1;
          if (j === segs.length - 1 && base - yt < 3) yt = base - 3; // a sale too small to see still gets a sliver
          const h = yb - yt;
          if (h <= 0.4) return '';
          if (j !== segs.length - 1) return `<rect x="${x.toFixed(1)}" y="${yt.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${sg.L.color}"/>`;
          const r = Math.min(4, h, bw / 2);
          return `<path d="M${x.toFixed(1)},${yb.toFixed(1)}V${(yt + r).toFixed(1)}Q${x.toFixed(1)},${yt.toFixed(1)} ${(x + r).toFixed(1)},${yt.toFixed(1)}H${(x + bw - r).toFixed(1)}Q${(x + bw).toFixed(1)},${yt.toFixed(1)} ${(x + bw).toFixed(1)},${(yt + r).toFixed(1)}V${yb.toFixed(1)}Z" fill="${sg.L.color}"/>`;
        }).join('');
        return `<g class="rv-col" data-i="${i}" style="animation-delay:${Math.min(i * (240 / Math.max(n, 1)), 240).toFixed(0)}ms">${parts}</g>`;
      }).join('');
      const ghost = compare && n ? (n === 1
        ? `<path class="rv-ghost" d="M${cx(0) - bw},${y(series[0].prev || 0)}H${cx(0) + bw}"/>`
        : `<path class="rv-ghost" d="M${series.map((s, i) => `${cx(i).toFixed(1)},${y(s.prev || 0).toFixed(1)}`).join('L')}"/>`) : '';
      const empty = !series.some((s) => s.total > 0) && !(compare && series.some((s) => s.prev > 0));
      box.innerHTML = `<div class="rv-axis" aria-hidden="true"><svg width="${axisW}" height="${H}">${ticks.map((t) => `<text x="${axisW - 10}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${compact(t)}</text>`).join('')}</svg></div>
        <div class="rv-scroll" tabindex="0" role="group" aria-label="${esc(GROUP_LBL[group] || '')} revenue chart. Use the left and right arrow keys to read each period.">
          <svg class="rv-plot${animate ? '' : ' still'}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
            ${ticks.map((t) => `<line class="rv-gl${t === 0 ? ' base' : ''}" x1="0" x2="${W}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/>`).join('')}
            ${series.map((s, i) => { if (!showX(i)) return ''; const tx = xLabel(s, group, i); const hw = tx.length * 3.4; const c = cx(i); const [ax, anc] = c - hw < 0 ? [1, 'start'] : c + hw > W ? [W - 1, 'end'] : [c, 'middle']; return `<text class="rv-xl" x="${ax.toFixed(1)}" y="${H - 8}" text-anchor="${anc}">${esc(tx)}</text>`; }).join('')}
            ${cols}${ghost}
            <rect class="rv-cursor" x="0" y="${pt}" width="${slot.toFixed(1)}" height="${(base - pt).toFixed(1)}" rx="8" visibility="hidden"/>
            ${series.map((_, i) => `<rect class="rv-hit" data-i="${i}" x="${(slot * i).toFixed(1)}" y="0" width="${slot.toFixed(1)}" height="${H}"/>`).join('')}
          </svg>
        </div>
        <div class="tip rv-tip" hidden></div>${empty && onEmpty ? `<div class="rv-ov">${onEmpty}</div>` : ''}`;
      // The hover band sits behind the bars.
      const plot = $('.rv-plot', box); const cursor = $('.rv-cursor', box);
      plot.insertBefore(cursor, plot.querySelector('.rv-col') || plot.querySelector('.rv-ghost') || cursor);
      const sc = $('.rv-scroll', box); const tip = $('.rv-tip', box);
      sc.scrollLeft = sc.scrollWidth;
      // A chart wider than the screen is scrolled to today: fade the left edge so a cut-off date reads as "more this way".
      const edge = () => sc.classList.toggle('more-l', sc.scrollLeft > 2);
      edge(); sc.addEventListener('scroll', edge, { passive: true });
      let cur = -1;
      const show = (i) => {
        if (i < 0 || i >= n) return;
        cur = i;
        const s = series[i];
        $$('.rv-col', plot).forEach((g) => g.classList.toggle('hi', Number(g.dataset.i) === i));
        plot.classList.add('hovering');
        cursor.setAttribute('x', (slot * i).toFixed(1)); cursor.setAttribute('visibility', 'visible');
        const rows = layers.filter((L) => L.values[i] > 0).slice().reverse();
        tip.innerHTML = `<span class="rv-tt">${esc(bucketTitle(s, group))}</span><b class="rv-tv">${money(s.total)}</b>${rows.map((L) => `<span class="rv-tr"><i style="background:${L.color}"></i><span>${esc(L.name)}</span><b>${money(L.values[i])}</b></span>`).join('')}${compare ? `<span class="rv-tr prev"><i></i><span>Previous period</span><b>${money(s.prev || 0)}</b></span>` : ''}`;
        tip.hidden = false;
        const left = axisW + cx(i) - sc.scrollLeft;
        const tw = tip.offsetWidth; const th = tip.offsetHeight;
        const barTop = y(Math.max(s.total, compare ? s.prev || 0 : 0));
        let tx = left + 14; if (tx + tw > box.clientWidth) tx = left - tw - 14; if (tx < 0) tx = Math.max(0, Math.min(box.clientWidth - tw, left - tw / 2));
        const ty = Math.max(0, Math.min(barTop - th / 2, H - th - 4));
        tip.style.transform = `translate(${tx.toFixed(0)}px, ${ty.toFixed(0)}px)`;
      };
      const hide = () => { cur = -1; tip.hidden = true; plot.classList.remove('hovering'); cursor.setAttribute('visibility', 'hidden'); $$('.rv-col.hi', plot).forEach((g) => g.classList.remove('hi')); };
      plot.addEventListener('pointermove', (e) => { const h = e.target.closest('.rv-hit'); if (h) show(Number(h.dataset.i)); });
      plot.addEventListener('pointerdown', (e) => { const h = e.target.closest('.rv-hit'); if (h) show(Number(h.dataset.i)); });
      plot.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
      sc.addEventListener('scroll', () => { if (cur >= 0) hide(); }, { passive: true });
      sc.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
        e.preventDefault();
        let i = cur < 0 ? n - 1 : cur + (e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0);
        if (e.key === 'Home') i = 0; if (e.key === 'End') i = n - 1;
        i = Math.max(0, Math.min(n - 1, i));
        const px = cx(i); if (px < sc.scrollLeft + 20 || px > sc.scrollLeft + sc.clientWidth - 20) sc.scrollLeft = px - sc.clientWidth / 2;
        show(i);
      });
      sc.addEventListener('blur', hide);
      animate = false;
      lastW = box.clientWidth;
    };
    draw();
    const onR = debounce(() => { if (box.isConnected && box.clientWidth !== lastW) draw(); }, 150);
    window.addEventListener('resize', onR);
    later(() => window.removeEventListener('resize', onR));
  }

  const RV_PRESETS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['year', 'This year'], ['12m', 'Last 12 months'], ['all', 'All time']];
  const presetName = (k) => (RV_PRESETS.find((p) => p[0] === k) || [k, 'Custom range'])[1];
  const SOURCES = [['all', 'All'], ['orders', 'Sales'], ['tools', 'Tools']];

  /** Stat tile: label, value that counts up, optional delta and note. */
  const rvTile = (ic, label, sub, i, o = {}) => `<div class="card kpi rv-tile${o.hero ? ' hero' : ''}" style="animation-delay:${i * 40}ms"><span class="kl">${o.hero ? `<span class="kic">${icon(ic)}</span>` : ''}${esc(label)}</span><b class="kv" data-v="${o.v}" data-pre="${o.pre || ''}">${o.pre || ''}0</b>${o.delta || ''}<small>${sub}</small></div>`;
  function deltaChip(t, r) {
    const was = `vs ${esc(rangeLabel(r.prev_from, r.prev_to))}`;
    if (t.change_pct === null) return t.revenue > 0 ? `<span class="rv-delta new">${icon('spark')}New this period<small>Nothing in the period before</small></span>` : `<span class="rv-delta flat">No sales yet<small>${was}</small></span>`;
    const up = t.change_pct > 0; const flat = t.change_pct === 0;
    return `<span class="rv-delta ${flat ? 'flat' : up ? 'up' : 'down'}" title="Previous period: ${esc(money(t.prev_revenue))}">${flat ? '' : icon(up ? 'up' : 'down')}${flat ? 'Same as before' : `${up ? '+' : '−'}${Math.abs(t.change_pct).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`}<small>${was} · ${esc(money(t.prev_revenue))}</small></span>`;
  }

  page('revenue', {
    t: 'Revenue', i: 'trend', perm: canMoney,
    async r(el, args, q) {
      // Every filter lives in the address (#revenue?range=12m&group=month...), so views can be shared and Back steps through them.
      const fromQ = (q) => ({
        range: q.from && q.to ? 'custom' : (RV_PRESETS.some((p) => p[0] === q.range) ? q.range : '30d'), from: q.from || '', to: q.to || '',
        group: ['day', 'week', 'month'].includes(q.group) ? q.group : '', product: q.product || 'all', source: SOURCES.some((s) => s[0] === q.source) ? q.source : 'all',
        compare: q.compare === '1', table: q.view === 'table',
      });
      const st = { ...fromQ(q), d: null };
      const params = () => {
        const p = new URLSearchParams();
        if (st.range === 'custom') { p.set('from', st.from); p.set('to', st.to); } else p.set('range', st.range);
        if (st.group) p.set('group', st.group);
        if (st.product !== 'all') p.set('product', st.product);
        if (st.source !== 'all') p.set('source', st.source);
        return p;
      };
      el.innerHTML = `${pageHead('Revenue', 'Money in across VooSquare and every Zedapex tool, in USD.', `<a class="btn btn-w btn-sm" id="rvCsv" href="#" download>${icon('download')}Export CSV</a>`)}
        <div class="rv-bar" id="rvBar"></div>
        <div id="rvBody"><div class="rv-tiles">${Array.from({ length: 5 }, (_, i) => `<div class="card kpi rv-tile${i ? '' : ' hero'}"><div class="skel" style="height:14px;width:55%"></div><div class="skel" style="height:${i ? 30 : 44}px;width:50%;margin-top:14px"></div></div>`).join('')}</div>
        <div class="card mt"><div class="skel" style="height:22px;width:30%"></div><div class="skel" style="height:290px;margin-top:18px"></div></div></div>`;
      let seq = 0;
      const hashFor = (p) => '#revenue?' + new URLSearchParams([...p, ...(st.compare ? [['compare', '1']] : []), ...(st.table ? [['view', 'table']] : [])]);
      /** Load the numbers. `push` (a filter the user changed) adds a history entry so Back returns to the previous view. */
      const load = async (push) => {
        const my = ++seq;
        const body = $('#rvBody', el);
        if (st.d) body.classList.add('busy');
        const p = params();
        const h = hashFor(p);
        if (h !== location.hash) history[push ? 'pushState' : 'replaceState'](null, '', h);
        try {
          const d = await GET('/api/admin/revenue?' + p);
          if (my !== seq || !el.isConnected) return;
          st.d = d; st.from = d.range.from; st.to = d.range.to;
          $('#rvCsv', el).href = '/api/admin/revenue.csv?' + p;
          drawBar(); drawBody();
        } catch (e) {
          if (my !== seq || !el.isConnected) return;
          if (e.status === 400 && st.group) { st.group = ''; return load(); }
          body.classList.remove('busy');
          body.innerHTML = errorBox(e);
        }
      };

      /* Filter row: range, grouping, product, source. One row above everything it scopes. */
      const drawBar = () => {
        const d = st.d; const r = d.range;
        const dayOff = r.days > 400;
        $('#rvBar', el).innerHTML = `
          <div class="rv-rw"><button type="button" class="rv-range" id="rvRange" aria-haspopup="dialog" aria-expanded="false">${icon('calendar')}<span><b>${esc(presetName(r.preset))}</b><small>${esc(rangeLabel(r.from, r.to))}</small></span>${icon('down')}</button></div>
          <div class="seg rv-grp" role="group" aria-label="Group by">${['day', 'week', 'month'].map((g) => `<button type="button" data-g="${g}" class="${r.group === g ? 'on' : ''}" aria-pressed="${r.group === g}"${g === 'day' && dayOff ? ' disabled title="Daily view works for up to 400 days"' : ''}>${g[0].toUpperCase() + g.slice(1)}</button>`).join('')}</div>
          <label class="rv-sel">${select('product', [['all', 'All products'], ...d.products.map((p) => [p.key, p.key === 'voosquare' ? 'VooSquare sales' : p.name])], st.product, { aria: 'Product' })}</label>
          <div class="seg rv-src" role="group" aria-label="Source">${SOURCES.map(([v, l]) => `<button type="button" data-s="${v}" class="${st.source === v ? 'on' : ''}" aria-pressed="${st.source === v}">${l}</button>`).join('')}</div>
          <span class="rv-tz" title="Days, weeks and months are cut in this time zone. Change it in Settings.">${icon('clock')}${esc(d.tz.replace(/_/g, ' '))}</span>`;
        $('#rvRange', el).onclick = (e) => openRange(e.currentTarget);
        $$('.rv-grp button', el).forEach((b) => { b.onclick = () => { st.group = b.dataset.g; load(true); }; });
        $('[name=product]', el).onchange = (e) => { st.product = e.target.value; load(true); };
        $$('.rv-src button', el).forEach((b) => { b.onclick = () => { st.source = b.dataset.s; load(true); }; });
      };

      /* Range picker: presets as rows, custom dates in the footer. A popover on desktop, a sheet on phones. */
      const openRange = (btn) => {
        const old = $('.rv-pop'); if (old) { old.remove(); return; }
        const r = st.d.range;
        const pop = document.createElement('div');
        pop.className = 'rv-pop';
        pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Choose a date range');
        pop.innerHTML = `<div class="rv-pop-p"><div class="rv-pop-h"><b>Date range</b><button type="button" class="ib2" data-x aria-label="Close">${icon('x')}</button></div>
          <div class="rv-pl">${RV_PRESETS.map(([k, l]) => `<button type="button" data-k="${k}" class="${r.preset === k ? 'on' : ''}" aria-pressed="${r.preset === k}"><span>${l}</span>${r.preset === k ? icon('check') : ''}</button>`).join('')}</div>
          <form class="rv-cus" novalidate><span class="lbl">Custom range</span><div class="rv-cus-r"><input class="inp" type="date" name="from" value="${esc(r.from)}" max="${esc(st.d.today)}" aria-label="From"><span>to</span><input class="inp" type="date" name="to" value="${esc(r.to)}" max="${esc(st.d.today)}" aria-label="To"></div><p class="err" role="alert"></p><button type="submit" class="btn btn-k btn-sm btn-block">Apply</button></form></div>`;
        btn.closest('.rv-rw').appendChild(pop);
        btn.setAttribute('aria-expanded', 'true');
        const close = () => { pop.remove(); btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key); document.body.classList.remove('noscroll-m'); };
        const outside = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) close(); else if (e.target === pop) close(); };
        const key = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
        setTimeout(() => { document.addEventListener('mousedown', outside); document.addEventListener('keydown', key); }, 0);
        document.body.classList.add('noscroll-m');
        later(close);
        $('[data-x]', pop).onclick = close;
        (pop.querySelector('.rv-pl .on') || pop.querySelector('.rv-pl button')).focus();
        $$('.rv-pl button', pop).forEach((b) => { b.onclick = () => { st.range = b.dataset.k; st.group = ''; close(); load(true); }; });
        $('.rv-cus', pop).addEventListener('submit', (e) => {
          e.preventDefault();
          const f = $('[name=from]', pop).value; const t = $('[name=to]', pop).value; const err = $('.err', pop);
          if (!f || !t) { err.textContent = 'Pick both dates.'; return; }
          if (f > t) { err.textContent = 'The start date is after the end date.'; return; }
          if (dayNum(t) - dayNum(f) + 1 > 1098) { err.textContent = 'Pick a range of three years or less.'; return; }
          st.range = 'custom'; st.from = f; st.to = t; st.group = ''; close(); load(true);
        });
      };

      const drawBody = (fresh = true) => {
        const d = st.d; const t = d.totals; const r = d.range;
        const body = $('#rvBody', el);
        body.classList.remove('busy');
        const layers = revLayers(d.series, d.products);
        const linkCust = can('customers') || can('support');
        const sub = { revenue: `${esc(rangeLabel(r.from, r.to))}` };
        const tiles = [
          rvTile('wallet', 'Revenue', '', 0, { hero: true, v: t.revenue, pre: '$', delta: deltaChip(t, r) }),
          rvTile('diamond', 'VooSquare sales', `${fmt(t.orders)} paid ${t.orders === 1 ? 'order' : 'orders'}`, 1, { v: t.orders_revenue, pre: '$' }),
          rvTile('grid', 'Tool revenue', 'Reported by tools', 2, { v: t.tools_revenue, pre: '$' }),
          rvTile('users', 'Paying customers', 'With a purchase', 3, { v: t.paying_users }),
          rvTile('user', 'Avg per customer', 'Per paying customer', 4, { v: t.arpu, pre: '$' }),
        ];
        const never = !d.first_date;
        const emptyRange = !t.revenue;
        const legend = layers.length ? `<div class="rv-lg" aria-label="Legend">${layers.map((L) => `<span class="rv-li"${L.members ? ` title="${esc(L.members.join(', '))}"` : ''}><i style="background:${L.color}"></i>${esc(L.name)}<b>${money(L.values.reduce((a, b) => a + b, 0))}</b></span>`).join('')}${st.compare ? '<span class="rv-li prev"><i></i>Previous period<b>' + money(t.prev_revenue) + '</b></span>' : ''}</div>` : '';
        const table = () => `<div class="rv-tbl"><table><thead><tr><th>${r.group === 'day' ? 'Day' : r.group === 'week' ? 'Week' : 'Month'}</th>${layers.map((L) => `<th class="num">${esc(L.name)}</th>`).join('')}<th class="num">Total</th>${st.compare ? '<th class="num">Previous</th>' : ''}</tr></thead><tbody>${d.series.slice().reverse().map((s) => { const i = d.series.indexOf(s); return `<tr><td>${esc(bucketTitle(s, r.group))}</td>${layers.map((L) => `<td class="num">${L.values[i] ? money(L.values[i]) : '<span class="muted">–</span>'}</td>`).join('')}<td class="num"><b>${money(s.total)}</b></td>${st.compare ? `<td class="num muted">${money(s.prev || 0)}</td>` : ''}</tr>`; }).join('')}</tbody><tfoot><tr><td>Total</td>${layers.map((L) => `<td class="num">${money(L.values.reduce((a, b) => a + b, 0))}</td>`).join('')}<td class="num"><b>${money(t.revenue)}</b></td>${st.compare ? `<td class="num muted">${money(t.prev_revenue)}</td>` : ''}</tr></tfoot></table></div>`;
        const maxP = Math.max(...d.by_product.map((p) => p.revenue), 1);
        const bp = d.by_product.length ? `<div class="rv-bp">${d.by_product.map((p, i) => `<div class="rv-bp-r" style="--d:${i * 50}ms">${productIcon(p, 'sm')}<span class="rv-bp-t"><b>${esc(p.name)}</b><small>${p.key === 'voosquare' ? `Sales · ${fmt(p.count)} ${p.count === 1 ? 'order' : 'orders'}` : `Reported by tool · ${fmt(p.count)} ${p.count === 1 ? 'payment' : 'payments'}`}</small></span><span class="rv-bp-v"><b>${money(p.revenue)}</b><small>${pct(p.share)}</small></span><span class="rv-bp-b"><i style="width:${Math.max(1.5, (p.revenue / maxP) * 100).toFixed(1)}%;background:${p.chart}"></i></span>${p.key === 'voosquare' && d.kinds.length ? `<span class="rv-kinds">${d.kinds.map((k) => `<span>${esc(k.name)}<b>${money(k.revenue)}</b></span>`).join('')}</span>` : ''}</div>`).join('')}</div>` : empty('grid', 'Nothing to split yet', 'Each product shows here once it has a sale in this range.');
        const maxC = Math.max(...d.top_customers.map((c) => c.total), 1);
        const colorOf = (k) => (d.products.find((p) => p.key === k) || { chart: '#8A9A93' }).chart;
        const tc = d.top_customers.length ? `<div class="rv-tc">${d.top_customers.map((c, i) => `<${linkCust ? `a href="#customers/${c.id}"` : 'div'} class="rv-tc-r" style="animation-delay:${i * 30}ms"><span class="rv-rank">${i + 1}</span>${av(c.avatar, 'sm', c.email || c.name)}<span class="rv-tc-t"><b>${esc(c.name)}</b><small>${esc(c.email)}</small></span><span class="rv-tc-b" title="${esc(Object.entries(c.by_product).map(([k, v]) => `${(d.products.find((p) => p.key === k) || { name: k }).name} ${money(v)}`).join(' · '))}"><span class="rv-mb" style="width:${Math.max(4, (c.total / maxC) * 100).toFixed(1)}%">${d.products.filter((p) => c.by_product[p.key]).map((p) => `<i style="flex:${c.by_product[p.key]};background:${colorOf(p.key)}"></i>`).join('')}</span></span><b class="rv-tc-v">${money(c.total)}</b></${linkCust ? 'a' : 'div'}>`).join('')}</div>` : empty('users', 'No paying customers in this range', 'Members show here when they buy on VooSquare or a tool reports their spend.');
        const rec = d.recent.length ? `<div class="mini-list rv-rec">${d.recent.map((x) => { const p = d.products.find((k) => k.key === x.key) || { name: x.product }; return `<${x.user && linkCust ? `a href="#customers/${x.user.id}"` : 'div'} class="mini">${productIcon(p, 'sm')}<span class="mini-t"><b>${esc(x.label)}</b><small>${x.user ? esc(x.user.name) : 'Visitor without a Voo ID'} · ${esc(p.name)}${x.kind === 'spend' ? ' · reported by tool' : x.ref ? ' · ' + esc(x.ref) : ''}</small></span><span class="rv-rec-r"><b>${money(x.amount_usd)}</b>${x.local ? `<small>${esc(fmt(x.local.amount, x.local.amount % 1 ? 2 : 0))} ${esc(x.local.currency)}</small>` : ''}<time title="${esc(fullDate(x.at))}">${timeAgo(x.at)}</time></span></${x.user && linkCust ? 'a' : 'div'}>`; }).join('')}</div>` : empty('card', 'No payments in this range');
        const ghostBars = `<svg class="rv-ghostbars" viewBox="0 0 320 120" aria-hidden="true">${[28, 40, 34, 52, 46, 64, 58, 76, 70, 92].map((h, i) => `<rect x="${i * 32 + 6}" y="${110 - h}" width="18" height="${h}" rx="4"/>`).join('')}<line x1="0" x2="320" y1="110.5" y2="110.5"/></svg>`;
        body.innerHTML = `<div class="rv-tiles">${tiles.join('')}</div>
          ${never ? `<div class="card rv-first mt">${ghostBars}<div><h3>Your first sale shows up here</h3><p>Revenue appears the moment a Premium or paid room order is paid, or a Zedapex tool reports spend through the Events API. Every sale is counted once, in USD, on the day it was paid in ${esc(d.tz.replace(/_/g, ' '))} time.</p><div class="row">${can('payments') ? `<a class="btn btn-g btn-sm" href="#payments">${icon('card')}Check payment methods</a>` : ''}${can('products') ? `<a class="btn btn-w btn-sm" href="#products">${icon('grid')}Connect a tool</a>` : ''}</div></div></div>` : `
          <div class="card mt rv-main">
            <div class="card-h"><div><h3>Revenue over time</h3><span class="sub">${GROUP_LBL[r.group]} · ${esc(rangeLabel(r.from, r.to))}<span class="only-m-i"> · ${esc(d.tz.replace(/_/g, ' '))}</span>${st.product !== 'all' ? ' · ' + esc((d.products.find((p) => p.key === st.product) || { name: st.product }).name) : ''}${st.source !== 'all' ? ' · ' + (st.source === 'orders' ? 'VooSquare sales only' : 'Tool revenue only') : ''}</span></div>
              <div class="r"><button type="button" class="tgl${st.compare ? ' on' : ''}" id="rvCmp" aria-pressed="${st.compare}"><i></i>Compare</button><div class="seg" role="group" aria-label="View"><button type="button" data-v="chart" class="${st.table ? '' : 'on'}" aria-pressed="${!st.table}">Chart</button><button type="button" data-v="table" class="${st.table ? 'on' : ''}" aria-pressed="${st.table}">Table</button></div></div></div>
            ${legend}
            ${st.table ? table() : '<div class="rv-chart" id="rvChart"></div>'}
          </div>
          <div class="g2 mt rv-g">
            <div class="card"><div class="card-h"><div><h3>By product</h3><span class="sub">Where the money came from</span></div></div>${bp}</div>
            <div class="card"><div class="card-h"><div><h3>Top customers</h3><span class="sub">Highest spend in this range, across every product</span></div></div>${tc}</div>
          </div>
          <div class="card mt"><div class="card-h"><div><h3>Recent payments</h3><span class="sub">The latest paid items in this range</span></div>${can('payments') ? '<a class="r btn btn-ghost btn-xs" href="#payments">Orders</a>' : ''}</div>${rec}</div>`}`;
        $$('.kv', body).forEach((b) => { const v = Number(b.dataset.v); if (fresh) countUp(b, v, { pre: b.dataset.pre, dec: v % 1 ? 2 : 0, ms: 700 }); else b.textContent = b.dataset.pre + fmt(v, v % 1 ? 2 : 0); });
        $$('.rv-tile', body).forEach((x) => { if (!fresh) x.style.animation = 'none'; });
        if (never) return;
        const ch = $('#rvChart', body);
        if (ch) revChart(ch, { series: d.series, layers, group: r.group, compare: st.compare, onEmpty: emptyRange ? `<b>No revenue in this range</b><span>Sales and tool spend land here as they happen.</span>${r.preset !== 'all' ? '<button type="button" class="btn btn-w btn-xs" data-all>Show all time</button>' : ''}` : '' });
        const all = $('[data-all]', body); if (all) all.onclick = () => { st.range = 'all'; st.group = ''; load(true); };
        $('#rvCmp', body).onclick = () => { st.compare = !st.compare; drawBody(false); history.replaceState(null, '', hashFor(params())); };
        $$('.rv-main .seg button', body).forEach((b) => { b.onclick = () => { st.table = b.dataset.v === 'table'; drawBody(false); history.replaceState(null, '', hashFor(params())); }; });
      };
      // Live: a paid order refreshes the numbers.
      on('order', debounce((o) => { if (o && o.status === 'paid') load(); }, 800));
      await load();
      // Back, Forward or a pasted #revenue?... link: apply the address without rebuilding the page.
      return {
        update(a, q2) {
          const n = fromQ(q2);
          const same = ['range', 'group', 'product', 'source'].every((k) => n[k] === st[k]) && (n.range !== 'custom' || (n.from === st.from && n.to === st.to));
          if (same) { if (n.compare !== st.compare || n.table !== st.table) { st.compare = n.compare; st.table = n.table; if (st.d) drawBody(false); } return; }
          Object.assign(st, n); load();
        },
      };
    },
  });

  /** "Spend across Zedapex" card on a customer's page. Finance and settings staff only. */
  function spendCard(host, id) {
    const st = { range: 'all', page: 0, items: [], d: null, seq: 0 };
    host.className = 'card zs-card mt';
    host.innerHTML = `<div class="card-h"><div><h3>Spend across Zedapex</h3><span class="sub">VooSquare sales and spend each tool reports, in USD.</span></div></div><div class="skel" style="height:220px"></div>`;
    const load = async (more) => {
      if (!more) { st.page = 0; if (st.d) host.classList.add('busy'); }
      const my = ++st.seq; // a quick range switch must not let an older answer overwrite the newer one
      let d;
      try { d = await GET(`/api/admin/customers/${id}/spend?range=${st.range}&page=${st.page}`); }
      catch (e) { if (my !== st.seq) return; host.classList.remove('busy'); host.innerHTML = errorBox(e, false); return; }
      if (my !== st.seq) return;
      if (!host.isConnected && st.d) return;
      st.items = more ? st.items.concat(d.timeline.items) : d.timeline.items;
      st.d = d;
      if (more) { drawTimeline(); return; }
      draw();
    };
    const item = (x) => { const p = st.d.products.find((k) => k.key === x.key) || { name: x.product, chart: '#8A9A93' }; return `<div class="zs-ti">${productIcon(p, 'xs')}<span class="mini-t"><b>${esc(x.label)}</b><small>${esc(p.name)} · ${x.kind === 'order' ? 'VooSquare sale' + (x.ref ? ' · ' + esc(x.ref) : '') : 'Reported by tool'}</small></span><span class="zs-amt"><b>${money(x.amount_usd)}</b><time title="${esc(fullDate(x.at))}">${dateStr(x.at)}</time></span></div>`; };
    const drawTimeline = () => {
      const tl = $('.zs-tl', host); if (!tl) return;
      const d = st.d;
      tl.innerHTML = `<h4>${icon('clock')}Purchases and spend<small>${fmt(d.timeline.total)} in this range</small></h4>${st.items.length ? `<div class="zs-tl-l">${st.items.map(item).join('')}</div>${d.timeline.page + 1 < d.timeline.pages ? '<button type="button" class="btn btn-w btn-xs zs-more">Show more</button>' : ''}` : '<p class="muted sm">Nothing in this range.</p>'}`;
      const m = $('.zs-more', tl); if (m) m.onclick = async () => { m.classList.add('loading'); st.page++; await load(true); };
    };
    const draw = () => {
      const d = st.d; const L = d.lifetime;
      host.classList.remove('busy');
      const label = d.range.preset === 'all' ? 'All time' : d.range.preset === '12m' ? 'Last 12 months' : 'Last 30 days';
      const layers = revLayers(d.series, d.products);
      const none = !L.count;
      host.innerHTML = `<div class="card-h"><div><h3>Spend across Zedapex</h3><span class="sub">VooSquare sales and spend each tool reports, in USD.</span></div><div class="r">${none ? '' : `<div class="seg" role="group" aria-label="Range">${[['all', 'All time'], ['12m', '12 months'], ['30d', '30 days']].map(([k, l]) => `<button type="button" data-r="${k}" class="${st.range === k ? 'on' : ''}" aria-pressed="${st.range === k}">${l}</button>`).join('')}</div>`}</div></div>
        ${none ? `<div class="zs-none">${icon('wallet')}<div><b>No purchases yet</b><span>Premium, paid rooms and spend reported by any Zedapex tool show here.</span></div></div>` : `
        <div class="zs-top">
          <div class="zs-hero">
            <span class="zs-l">${esc(label)}</span>
            <b class="zs-v" data-v="${d.total}">$0</b>
            <small>${fmt(d.count)} ${d.count === 1 ? 'payment' : 'payments'}${d.range.preset !== 'all' ? ` · ${money(L.total)} lifetime` : ''} · first ${dateStr(L.first_at)} · last ${dateStr(L.last_at)}</small>
            ${d.by_product.length ? `<div class="zs-seg" role="img" aria-label="${esc(d.by_product.map((p) => `${p.name} ${pct(p.share)}`).join(', '))}">${d.by_product.map((p, i) => `<i style="flex-grow:${p.revenue};background:${p.chart};--d:${i * 60}ms"></i>`).join('')}</div>` : ''}
            <div class="zs-rows">${d.by_product.length ? d.by_product.map((p) => `<div class="zs-r">${productIcon(p, 'sm')}<span class="mini-t"><b><i class="sw" style="background:${p.chart}"></i>${esc(p.name)}</b><small>${p.key === 'voosquare' ? 'Sales' : 'Reported by tool'} · last ${dateStr(p.last_at)}</small></span><span class="zs-amt"><b>${money(p.revenue)}</b><small>${pct(p.share)}</small></span></div>`).join('') : '<p class="muted sm">Nothing in this range.</p>'}</div>
          </div>
          <div class="zs-chart"><span class="zs-l">${GROUP_LBL[d.range.group]} spend</span><div class="rv-chart sm" id="zsCh${id}"></div></div>
        </div>
        <div class="zs-tl"></div>`}`;
      $$('[data-r]', host).forEach((b) => { b.onclick = () => { if (st.range === b.dataset.r) return; st.range = b.dataset.r; $$('[data-r]', host).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); load(); }; });
      if (none) return;
      countUp($('.zs-v', host), d.total, { pre: '$', dec: d.total % 1 ? 2 : 0, ms: 700 });
      revChart($('#zsCh' + id, host), { series: d.series, layers, group: d.range.group, height: matchMedia('(min-width: 1061px)').matches ? 300 : 188, compact: true });
      drawTimeline();
    };
    load();
  }

  /* =====================================================================
   * SUPPORT INBOX
   * ===================================================================== */
  const CHANNEL = { voosquare: ['VooSquare', 'g'], widget: ['Website widget', 'b'], api: ['API', 'p'] };
  const PRIORITY = [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']];
  const drafts = new Map();

  page('support', {
    t: 'Support inbox', i: 'inbox', full: true, perm: () => can('support'),
    r(el, args, q) {
      const st = { status: q.status || 'open', product: '', assignee: '', q: '', tickets: [], counts: {}, id: args[0] ? Number(args[0]) : null, data: null, mode: 'reply', ts: null, flash: null };
      const scope = S.me.support_scope || [];
      const myProducts = isOwner() || scope.includes('*') ? S.products : S.products.filter((p) => scope.map(Number).includes(p.id));
      el.innerHTML = `<div class="inbox" data-view="${st.id ? 'conv' : 'list'}">
        <section class="ib-list" aria-label="Conversations">
          <div class="ib-lh">
            <div class="ib-lt"><h2>Inbox</h2><button type="button" class="btn btn-w btn-xs" id="cannedBtn">${icon('reply')}Canned replies</button></div>
            <div class="seg ib-st" role="group" aria-label="Status"></div>
            <label class="sbox">${icon('search')}<input type="search" id="tkQ" placeholder="Search name, email or subject" aria-label="Search conversations"></label>
            <div class="chips ib-pr" role="group" aria-label="Product"><button type="button" class="on" data-p="">All products</button>${myProducts.map((p) => `<button type="button" data-p="${p.id}">${productIcon(p, 'xs')}${esc(p.name)}</button>`).join('')}</div>
            <div class="seg ib-as" role="group" aria-label="Assignee"><button type="button" class="on" data-a="">Everyone</button><button type="button" data-a="me">Mine</button><button type="button" data-a="none">Unassigned</button></div>
          </div>
          <div class="ib-rows" id="tkRows">${skelRows(7, 74)}</div>
        </section>
        <section class="ib-conv" id="conv" aria-label="Conversation"></section>
        <aside class="ib-info" id="cinfo" aria-label="Customer"></aside>
        <div class="ib-scrim" id="infoScrim"></div>
      </div>`;
      const box = $('.inbox', el);
      const setView = (v) => { box.dataset.view = v; };

      /* ----- list ----- */
      const renderStatus = () => {
        const c = st.counts; const all = (c.open || 0) + (c.pending || 0) + (c.closed || 0);
        $('.ib-st', el).innerHTML = [['open', 'Open', c.open], ['pending', 'Pending', c.pending], ['closed', 'Closed', c.closed], ['all', 'All', all]]
          .map(([v, l, n]) => `<button type="button" data-s="${v}" class="${st.status === v ? 'on' : ''}" aria-pressed="${st.status === v}">${l}<span class="n">${n || 0}</span></button>`).join('');
      };
      const rowHtml = (t) => {
        const who = t.name || t.email || 'Visitor';
        const prev = (t.last_author === 'staff' ? 'You: ' : '') + (t.last_body || 'Photo');
        const pr = t.priority === 'urgent' ? pill('Urgent', 'r') : t.priority === 'high' ? pill('High', 'gold') : '';
        return `<button type="button" class="tk ${t.id === st.id ? 'on' : ''} ${t.staff_unread ? 'unread' : ''}" data-id="${t.id}" role="listitem">
          <span class="tk-av">${av(t.user_avatar, 'md', t.email || t.id)}<span class="tk-pi">${productIcon({ icon: t.product_icon, name: t.product_name, color: t.product_color }, 'xs')}</span></span>
          <span class="tk-m"><span class="tk-t"><b>${esc(who)}</b><time>${timeAgo(t.updated_at)}</time></span><span class="tk-s">${esc(t.subject || '(no subject)')}</span><span class="tk-p">${esc(prev.slice(0, 120))}</span></span>
          <span class="tk-f">${t.staff_unread ? '<i class="udot" aria-label="Unread"></i>' : ''}${pr}${t.status !== 'open' && st.status === 'all' ? `<small>${esc(t.status)}</small>` : ''}</span></button>`;
      };
      const renderRows = () => {
        const rows = $('#tkRows', el);
        if (!st.tickets.length) {
          rows.innerHTML = empty('inbox', st.q ? 'No conversations match' : st.status === 'open' ? 'Inbox zero' : 'Nothing here', st.q ? 'Try another name or email.' : st.status === 'open' ? 'Every open conversation has a reply. New messages show up here live.' : 'Try another filter.');
          return;
        }
        rows.innerHTML = st.tickets.map(rowHtml).join('');
        if (st.flash) { const r = $(`.tk[data-id="${st.flash}"]`, rows); if (r) r.classList.add('flash'); st.flash = null; }
      };
      let loadSeq = 0;
      const loadList = async () => {
        const seq = ++loadSeq;
        const p = new URLSearchParams({ status: st.status });
        if (st.product) p.set('product', st.product);
        if (st.assignee) p.set('assignee', st.assignee);
        if (st.q) p.set('q', st.q);
        try {
          const r = await GET('/api/admin/tickets?' + p);
          if (seq !== loadSeq || !el.isConnected) return;
          st.tickets = r.tickets;
          st.counts = Object.fromEntries(r.counts.map((c) => [c.status, c.n]));
          renderStatus(); renderRows();
          setBadge('support', st.counts.open || 0);
        } catch (e) { if (el.isConnected) $('#tkRows', el).innerHTML = errorBox(e); }
      };
      renderStatus();
      $('.ib-st', el).addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; st.status = b.dataset.s; renderStatus(); $('#tkRows', el).innerHTML = skelRows(5, 74); loadList(); });
      $('.ib-pr', el).addEventListener('click', (e) => { const b = e.target.closest('[data-p]'); if (!b) return; $$('.ib-pr button', el).forEach((x) => x.classList.toggle('on', x === b)); st.product = b.dataset.p; loadList(); });
      $('.ib-as', el).addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (!b) return; $$('.ib-as button', el).forEach((x) => x.classList.toggle('on', x === b)); st.assignee = b.dataset.a; loadList(); });
      $('#tkQ', el).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); loadList(); }, 280));
      $('#tkRows', el).addEventListener('click', (e) => { const b = e.target.closest('.tk'); if (b) location.hash = '#support/' + b.dataset.id; });
      $('#cannedBtn', el).onclick = () => cannedManager(() => { if (st.id) loadConv(st.id, true); });

      /* ----- conversation ----- */
      const conv = $('#conv', el), info = $('#cinfo', el);
      const convEmpty = () => {
        conv.innerHTML = `<div class="cv-empty"><div class="cv-faces">${[2, 5, 1].map((s, i) => `<span class="av av-lg">${avatar({ skin: s, hair: i * 2, shirt: s + 1, bg: i + 2, hairColor: i })}</span>`).join('')}</div><b>Pick a conversation</b><span>Replies go out by email and show up in the customer's VooSquare or product widget.</span></div>`;
        info.innerHTML = '';
      };
      const msgHtml = (m) => {
        if (m.author_type === 'system') return `<div class="msg-sys"><span>${esc(m.body)} · ${timeStr(m.created_at)}</span></div>`;
        const staff = m.author_type === 'staff'; const note = staff && m.internal;
        return `<div class="msg ${staff ? 'out' : 'in'} ${note ? 'note' : ''}">${av(m.author_avatar, 'sm', m.author_name)}<div class="bub"><div class="bub-h"><b>${esc(m.author_name)}</b>${note ? `<span class="note-tag">${icon('lock')}Internal note</span>` : ''}<time title="${esc(fullDate(m.created_at))}">${timeStr(m.created_at)}</time></div>${m.body ? `<div class="bub-b">${linkify(m.body)}</div>` : ''}${m.attachment && window.VSM ? VSM.thumb(m.attachment, { maxW: 280, maxH: 260 }) : ''}</div></div>`;
      };
      const msgsHtml = (msgs) => {
        let day = '';
        return msgs.map((m) => { const d = dateStr(m.created_at); const sep = d !== day ? `<div class="day"><span>${d === dateStr(Date.now()) ? 'Today' : d}</span></div>` : ''; day = d; return sep + msgHtml(m); }).join('');
      };
      const infoHtml = (d) => {
        const t = d.ticket, c = d.customer;
        const meta = `<dl class="dl"><dt>Conversation</dt><dd>#${t.id}</dd><dt>Started</dt><dd>${esc(fullDate(t.created_at))}</dd><dt>Channel</dt><dd>${esc((CHANNEL[t.channel] || [t.channel])[0])}</dd>${t.external_ref ? `<dt>External ref</dt><dd class="mono">${esc(t.external_ref)}</dd>` : ''}</dl>`;
        if (!c) {
          return `<div class="ci"><button type="button" class="ib2 ci-x" aria-label="Close details">${icon('x')}</button>${av(null, 'xl', t.email || t.id)}<h3>${esc(t.name || 'Visitor')}</h3><p class="muted">${esc(t.email || 'No email given')}</p>${pill('Not a member yet', 'w')}${meta}${/^https?:\/\//i.test(t.page_url || '') ? `<a class="btn btn-w btn-sm btn-block" href="${esc(t.page_url)}" target="_blank" rel="noopener">${icon('ext')}Open the page they wrote from</a>` : ''}</div>`;
        }
        return `<div class="ci"><button type="button" class="ib2 ci-x" aria-label="Close details">${icon('x')}</button>${av(c.avatar, 'xl', c.email)}<h3>${esc(c.name)}</h3><p class="muted">${esc(c.email)}</p>
          <div class="pills">${c.premium ? pill('Premium', 'gold') : pill('Free', 'w')}${c.staff ? pill('Team', 'k') : ''}${c.banned ? pill('Banned', 'r') : ''}</div>
          <dl class="dl"><dt>Member since</dt><dd>${dateStr(c.created_at)}</dd><dt>Last seen</dt><dd>${c.last_seen ? timeAgo(c.last_seen) + (timeAgo(c.last_seen) === 'now' ? '' : ' ago') : 'Never'}</dd><dt>Conversations</dt><dd>${c.tickets}</dd>${c.premium ? `<dt>Premium until</dt><dd>${dateStr(c.premium_until)}</dd>` : ''}<dt>Voo ID</dt><dd class="mono">${esc(c.voo_id)}</dd></dl>
          <h4>Recent orders</h4>${c.orders.length ? `<div class="mini-list">${c.orders.map((o) => `<div class="mini sm"><span class="mini-t"><b>${esc(o.item_name)}</b><small>${esc(fmt(o.amount, o.amount % 1 ? 2 : 0))} ${esc(o.currency)} · ${timeAgo(o.created_at)}</small></span>${orderPill(o.status)}</div>`).join('')}</div>` : '<p class="muted sm">No orders yet.</p>'}
          ${meta}
          <a class="btn btn-w btn-sm btn-block" href="#customers/${c.id}">${icon('user')}Open customer page</a></div>`;
      };
      const renderConv = (d, keepScroll) => {
        const t = d.ticket;
        const ch = CHANNEL[t.channel] || [t.channel || 'Other', 'w'];
        const old = $('.cv-msgs', conv);
        const atBottom = !old || old.scrollHeight - old.scrollTop - old.clientHeight < 80;
        const draft = $('.rp-ta', conv) ? $('.rp-ta', conv).value : (drafts.get(t.id) || '');
        const agentOpts = [['', 'Unassigned'], ...d.agents.map((a) => [a.id, a.id === S.me.id ? `${a.name} (you)` : a.name])];
        conv.innerHTML = `<div class="cv-h">
            <button type="button" class="ib2 cv-back" aria-label="Back to the inbox">${icon('left')}</button>
            ${productIcon({ icon: t.product_icon, name: t.product_name, color: t.product_color }, 'sm')}
            <div class="cv-ht"><h3>${esc(t.subject || '(no subject)')}</h3><p><span>${esc(t.name || 'Visitor')}</span>${t.email ? `<span class="muted">${esc(t.email)}</span>` : ''}${pill(ch[0], ch[1])}${/^https?:\/\//i.test(t.page_url || '') ? `<a class="pg" href="${esc(t.page_url)}" target="_blank" rel="noopener">${icon('link')}${esc(t.page_url.replace(/^https?:\/\//, '').slice(0, 48))}</a>` : ''}</p></div>
            <button type="button" class="ib2 cv-info" aria-label="Customer details">${icon('user')}</button>
          </div>
          <div class="cv-ctl">
            <label class="mini-sel"><span>Status</span>${select('status', [['open', 'Open'], ['pending', 'Pending'], ['closed', 'Closed']], t.status, { aria: 'Status' })}</label>
            <label class="mini-sel"><span>Assignee</span>${select('assignee', agentOpts, t.assignee_id || '', { aria: 'Assignee' })}</label>
            <label class="mini-sel"><span>Priority</span>${select('priority', PRIORITY, t.priority || 'normal', { aria: 'Priority' })}</label>
          </div>
          <div class="cv-msgs" role="log" aria-live="polite">${msgsHtml(d.messages)}</div>
          <form class="cv-reply ${st.mode === 'note' ? 'is-note' : ''}" novalidate>
            <div class="rp-top"><div class="seg rp-mode" role="group" aria-label="Reply type"><button type="button" data-m="reply" class="${st.mode === 'reply' ? 'on' : ''}">Reply</button><button type="button" data-m="note" class="${st.mode === 'note' ? 'on' : ''}">${icon('lock')}Internal note</button></div><span class="rp-who">${st.mode === 'note' ? 'Only the team sees notes' : `Goes to ${esc(firstName(t.name || (d.customer && d.customer.name)))}${t.email ? ' by email' : ''}`}</span></div>
            <div class="att-host" id="rpAtt" hidden></div>
            <textarea class="rp-ta" rows="2" placeholder="${st.mode === 'note' ? 'Add a note for the team' : 'Write a reply'}" aria-label="Message">${esc(draft)}</textarea>
            <div class="rp-bar">
              <button type="button" class="btn btn-ghost btn-sm rp-canned" aria-haspopup="true">${icon('reply')}<span>Canned</span></button>
              ${window.VSM && (t.user_id || st.mode === 'note') ? `<button type="button" class="ib2 rp-att" aria-label="Attach an image" title="Attach an image">${icon('image')}</button>` : ''}
              <span class="rp-hint"><kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send</span>
              ${st.mode === 'reply' ? '<button type="button" class="btn btn-w btn-sm rp-close">Send and close</button>' : ''}
              <button type="submit" class="btn btn-g btn-sm rp-send">${icon('send')}${st.mode === 'note' ? 'Add note' : 'Send'}</button>
            </div>
            <div class="rp-pop" hidden><label class="sbox sm">${icon('search')}<input type="search" placeholder="Search canned replies" aria-label="Search canned replies"></label><div class="rp-list"></div></div>
          </form>`;
        info.innerHTML = infoHtml(d);
        const ms = $('.cv-msgs', conv);
        if (!keepScroll || atBottom) ms.scrollTop = ms.scrollHeight;
        bindConv(d);
      };
      const bindConv = (d) => {
        const t = d.ticket;
        const ta = $('.rp-ta', conv), form = $('.cv-reply', conv), pop = $('.rp-pop', conv);
        const attB = $('.rp-att', conv);
        // One attacher per conversation, re-mounted on each re-render so a pending image survives live updates.
        st.atts = st.atts || new Map();
        let att = st.atts.get(t.id) || null;
        if (attB) { if (att) att.mount(attB, $('#rpAtt', conv)); else { att = VSM.attacher({ btn: attB, chipHost: $('#rpAtt', conv), purpose: 'support', label: 'Image' }); st.atts.set(t.id, att); } } else att = null;
        if (att) ta.addEventListener('paste', (e) => { const f = VSM.fileFrom(e.clipboardData); if (f) { e.preventDefault(); att.add(f); } });
        const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; };
        grow();
        ta.addEventListener('input', () => { grow(); drafts.set(t.id, ta.value); });
        ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(false); } });
        $('.cv-back', conv).onclick = () => { location.hash = '#support'; };
        $('.cv-info', conv).onclick = () => setView('info');
        $('.ci-x', info).onclick = () => setView('conv');
        $('#infoScrim', el).onclick = () => setView('conv');
        $('.rp-mode', conv).addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; st.mode = b.dataset.m; drafts.set(t.id, ta.value); renderConv(d, true); $('.rp-ta', conv).focus(); });
        $$('.cv-ctl select', conv).forEach((s) => s.addEventListener('change', async () => {
          const body = s.name === 'assignee' ? { assignee_id: s.value ? Number(s.value) : null } : { [s.name]: s.value };
          const ok = await run(null, () => PATCH('/api/admin/tickets/' + t.id, body), s.name === 'status' ? `Marked ${s.value}` : s.name === 'priority' ? 'Priority updated' : 'Assignee updated');
          if (ok) { loadConv(t.id, true); loadList(); }
        }));
        // canned picker
        const fill = (f) => {
          const name = firstName(t.name || (d.customer && d.customer.name));
          const list = d.canned.filter((c) => !f || (c.title + ' ' + c.body).toLowerCase().includes(f.toLowerCase()));
          $('.rp-list', pop).innerHTML = list.length ? list.map((c) => `<button type="button" class="rp-item" data-body="${esc(c.body.replace(/\{name\}/g, name))}"><b>${esc(c.title)}</b><span>${esc(c.body.replace(/\{name\}/g, name))}</span></button>`).join('') : `<p class="muted sm pad">No canned replies${f ? ' match' : ' yet'}. <button type="button" class="linkb" id="mkCanned">Create one</button></p>`;
          const mk = $('#mkCanned', pop); if (mk) mk.onclick = () => { pop.hidden = true; cannedManager(() => loadConv(t.id, true)); };
        };
        $('.rp-canned', conv).onclick = () => { pop.hidden = !pop.hidden; if (!pop.hidden) { fill(''); const si = $('input', pop); si.value = ''; si.focus(); } };
        $('input', pop).addEventListener('input', (e) => fill(e.target.value));
        $('input', pop).addEventListener('keydown', (e) => { if (e.key === 'Escape') { pop.hidden = true; ta.focus(); } if (e.key === 'Enter') { e.preventDefault(); const f = $('.rp-item', pop); if (f) f.click(); } });
        pop.addEventListener('click', (e) => {
          const it = e.target.closest('.rp-item'); if (!it) return;
          const s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? ta.value.length;
          ta.value = ta.value.slice(0, s) + it.dataset.body + ta.value.slice(en);
          pop.hidden = true; ta.focus(); ta.selectionStart = ta.selectionEnd = s + it.dataset.body.length; grow(); drafts.set(t.id, ta.value);
        });
        const send = async (close) => {
          const body = ta.value.trim();
          const hasImg = !!(att && att.has());
          if (!body && !hasImg) { toast('Write a message first.', 'err'); ta.focus(); return; }
          const internal = st.mode === 'note';
          const btn = close ? $('.rp-close', conv) : $('.rp-send', conv);
          const ok = await run(btn, async () => {
            const upl = hasImg ? await att.get() : null;
            await POST(`/api/admin/tickets/${t.id}/reply`, { body, internal, upload_id: upl ? upl.id : undefined });
            if (att) att.sent();
            if (close) await PATCH('/api/admin/tickets/' + t.id, { status: 'closed' });
          }, internal ? 'Note added' : close ? 'Sent and closed' : 'Reply sent');
          if (ok) { drafts.delete(t.id); ta.value = ''; await loadConv(t.id, false); loadList(); }
        };
        form.addEventListener('submit', (e) => { e.preventDefault(); send(false); });
        const cb = $('.rp-close', conv); if (cb) cb.onclick = () => send(true);
      };
      let convSeq = 0;
      const loadConv = async (id, keep) => {
        const seq = ++convSeq;
        if (!keep) { conv.innerHTML = `<div class="cv-load">${skelRows(1, 60)}<div class="sk-msgs"><div class="skel" style="height:64px;width:60%"></div><div class="skel" style="height:48px;width:50%;margin-left:auto"></div><div class="skel" style="height:80px;width:66%"></div></div></div>`; info.innerHTML = `<div class="ci">${skelRows(4, 40)}</div>`; }
        try {
          const d = await GET('/api/admin/tickets/' + id);
          if (seq !== convSeq || !el.isConnected) return;
          st.data = d;
          renderConv(d, keep);
          const row = $(`.tk[data-id="${id}"]`, el); if (row) row.classList.remove('unread');
        } catch (e) { if (el.isConnected) { conv.innerHTML = errorBox(e, false) + '<p class="center"><a class="btn btn-w btn-sm" href="#support">Back to the inbox</a></p>'; info.innerHTML = ''; } }
      };
      const openTicket = (id) => {
        if (st.ts) { st.ts.close(); st.ts = null; }
        st.id = id; st.mode = 'reply';
        $$('.tk', el).forEach((r) => r.classList.toggle('on', Number(r.dataset.id) === id));
        if (!id) { setView('list'); convEmpty(); return; }
        setView('conv');
        loadConv(id, false);
        const reload = debounce(() => { if (st.id === id) loadConv(id, true); }, 200);
        st.ts = VS.stream(['ticket:' + id], { message: reload, status: reload });
      };
      later(() => { if (st.ts) st.ts.close(); if (st.atts) st.atts.forEach((a) => a.destroy()); });

      const relist = debounce(loadList, 250);
      on('ticket', (d) => { st.flash = d.id; relist(); });
      loadList();
      openTicket(st.id);
      return { update(a) { const id = a[0] ? Number(a[0]) : null; if (id !== st.id) openTicket(id); else if (!id) setView('list'); } };
    },
  });

  /** Canned replies manager (create, edit, delete). */
  async function cannedManager(onChange) {
    const m = modal({ title: 'Canned replies', wide: true, body: `<p class="muted sm">Saved answers your team can drop into any reply. Write <b class="mono">{name}</b> and it becomes the customer's first name.</p><form class="cn-form card soft" novalidate></form><div class="cn-list">${skelRows(3, 56)}</div>` });
    const prodOpts = [['', 'All products'], ...S.products.map((p) => [p.id, p.name])];
    const form = m.q('.cn-form');
    const setForm = (c = {}) => {
      form.innerHTML = `<input type="hidden" name="id" value="${esc(c.id || '')}"><div class="g2c">${field('Title', input('title', c.title, { ph: 'For example: Refund steps' }))}${field('Product', select('product_id', prodOpts, c.product_id || ''))}</div>${field('Reply text', textarea('body', c.body, { rows: 4, ph: 'Hi {name}, ...' }))}<div class="row end"><button type="button" class="btn btn-ghost btn-sm cn-reset"${c.id ? '' : ' hidden'}>Cancel edit</button><button type="submit" class="btn btn-g btn-sm">${c.id ? 'Save changes' : 'Add reply'}</button></div>`;
      $('.cn-reset', form).onclick = () => setForm();
    };
    let list = [];
    const draw = () => {
      m.q('.cn-list').innerHTML = list.length ? list.map((c) => `<div class="cn" data-cfm><div class="cn-t"><b>${esc(c.title)}</b>${c.product_id ? pill((productById(c.product_id) || {}).name || 'Product', 'b') : ''}<p>${esc(c.body)}</p></div><div class="cn-a"><button type="button" class="btn btn-w btn-xs" data-edit="${c.id}">${icon('pen')}Edit</button><button type="button" class="btn btn-danger btn-xs" data-del="${c.id}">${icon('trash')}Delete</button></div></div>`).join('') : empty('reply', 'No canned replies yet', 'Add your first one above.');
    };
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(form);
      const r = await run($('button[type=submit]', form), () => POST('/api/admin/canned', { id: v.id ? Number(v.id) : undefined, title: v.title, body: v.body, product_id: v.product_id ? Number(v.product_id) : null }), 'Canned reply saved');
      if (r) { list = r.canned; draw(); setForm(); if (onChange) onChange(); }
    });
    m.q('.cn-list').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]'); const dl = e.target.closest('[data-del]');
      if (ed) { setForm(list.find((c) => c.id === Number(ed.dataset.edit))); $('input[name=title]', form).focus(); }
      if (dl) {
        // Gone from the list at once; the server delete waits 6 seconds so Undo can bring it back.
        const cid = Number(dl.dataset.del);
        const at = list.findIndex((c) => c.id === cid);
        const item = list[at];
        list = list.filter((c) => c.id !== cid); draw();
        undoToast(`Deleted "${item.title}"`, {
          onUndo: () => { list.splice(Math.min(at, list.length), 0, item); if (m.el.isConnected) draw(); },
          onCommit: () => DEL('/api/admin/canned/' + cid).then(() => { if (onChange) onChange(); }).catch((er) => toast(er.message, 'err')),
        });
      }
    });
    setForm();
    try { list = (await GET('/api/admin/canned')).canned; draw(); } catch (e) { m.q('.cn-list').innerHTML = errorBox(e, false); }
  }

  /* =====================================================================
   * CUSTOMERS
   * ===================================================================== */
  const CFILTERS = [['all', 'All'], ['new', 'New this week'], ['premium', 'Premium'], ['free', 'Free'], ['paying', 'Paying', () => can('payments') || can('settings')], ['staff', 'Team'], ['banned', 'Banned']];
  const lastSeen = (t) => (!t ? 'Never' : timeAgo(t) === 'now' ? 'Online now' : timeAgo(t) + ' ago');

  page('customers', {
    t: 'Customers', i: 'users', perm: () => can('customers') || can('support'),
    r(el, args, q) {
      if (args[0]) return customerPage(el, Number(args[0]));
      const filters = CFILTERS.filter((f) => !f[2] || f[2]());
      const hasMoney = canMoney();
      const st = { q: q.q || '', filter: filters.some((f) => f[0] === q.filter) ? q.filter : 'all', page: 0, total: 0, sort: hasMoney && q.sort === 'spent' ? 'spent' : 'new' };
      el.innerHTML = `${pageHead('Customers', 'Everyone with a Voo ID. Search, filter and open a member to manage them.')}
        <div class="card flush"><div class="toolbar"><label class="sbox grow">${icon('search')}<input type="search" id="cQ" value="${esc(st.q)}" placeholder="Search name, email, handle or Voo ID" aria-label="Search customers"></label>
        <div class="chips" role="group" aria-label="Filter">${filters.map(([v, l]) => `<button type="button" data-f="${v}" class="${v === st.filter ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${hasMoney ? `<div class="seg c-sort" role="group" aria-label="Sort">${[['new', 'Newest'], ['spent', 'Top spenders']].map(([v, l]) => `<button type="button" data-sort="${v}" class="${st.sort === v ? 'on' : ''}" aria-pressed="${st.sort === v}">${l}</button>`).join('')}</div>` : ''}</div>
        <div id="cList">${skelRows(8, 58)}</div><div class="pager" id="cPager"></div></div>`;
      const qi = $('#cQ', el);
      if (q.focus || q.q) setTimeout(() => qi.focus(), 30);
      let seq = 0;
      const load = async () => {
        const my = ++seq;
        const p = new URLSearchParams({ filter: st.filter, page: st.page }); if (st.q) p.set('q', st.q); if (st.sort === 'spent') p.set('sort', 'spent');
        try {
          const r = await GET('/api/admin/customers?' + p);
          if (my !== seq || !el.isConnected) return;
          st.total = r.total;
          $('#cList', el).innerHTML = r.customers.length ? `<div class="ctable${r.money ? ' money' : ''}" role="list"><div class="ct-h"><span>Member</span><span>Plan</span><span>Joined</span><span>Last seen</span><span>XP</span>${r.money ? `<button type="button" class="ct-sort${st.sort === 'spent' ? ' on' : ''}" data-sort="${st.sort === 'spent' ? 'new' : 'spent'}" aria-label="${st.sort === 'spent' ? 'Sorted by spend. Sort by newest instead' : 'Sort by lifetime spend'}">Spent${icon('down')}</button>` : ''}</div>${r.customers.map((c, i) => `<a class="ct-r" role="listitem" href="#customers/${c.id}" style="animation-delay:${Math.min(i, 12) * 25}ms">
              <span class="ct-m">${av(c.avatar, 'md', c.email)}<span><b>${esc(c.name)}</b><small>${esc(c.email)}</small></span></span>
              <span class="ct-p">${c.premium ? pill('Premium', 'gold') : pill('Free', 'w')}${c.staff ? pill('Team', 'k') : ''}${c.deleted ? pill('Deleted', 'k') : c.erased ? pill('Erased', 'k') : c.banned ? pill('Banned', 'r') : ''}${c.deactivated && !c.erased ? pill('Hidden', 'w') : ''}${c.muted_until > Date.now() ? pill('Muted', 'r') : ''}</span>
              <span class="ct-d" data-l="Joined">${dateStr(c.created_at)}</span><span class="ct-d" data-l="Last seen">${lastSeen(c.last_seen)}</span><span class="ct-d" data-l="XP">${fmt(c.xp)}</span>${r.money ? `<span class="ct-d ct-spent${c.spent ? '' : ' zero'}" data-l="Spent">${c.spent ? money(c.spent) : '–'}</span>` : ''}</a>`).join('')}</div>`
            : empty('users', st.q ? 'No one matches that search' : st.filter === 'paying' ? 'No paying members yet' : 'No members in this view', st.q ? 'Check the spelling or search by email.' : st.filter === 'paying' ? 'Members show here after a VooSquare purchase or spend reported by a tool.' : '');
          const pages = Math.ceil(r.total / 40);
          $('#cPager', el).innerHTML = `<span>${fmt(r.total)} ${r.total === 1 ? 'member' : 'members'}${pages > 1 ? ` · page ${st.page + 1} of ${pages}` : ''}</span>${pages > 1 ? `<span class="row"><button type="button" class="btn btn-w btn-xs" data-pg="-1"${st.page ? '' : ' disabled'}>${icon('left')}Previous</button><button type="button" class="btn btn-w btn-xs" data-pg="1"${st.page + 1 < pages ? '' : ' disabled'}>Next${icon('arrow')}</button></span>` : ''}`;
        } catch (e) { if (el.isConnected) $('#cList', el).innerHTML = errorBox(e); }
      };
      qi.addEventListener('input', debounce(() => { st.q = qi.value.trim(); st.page = 0; load(); }, 280));
      $('.chips', el).addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; st.filter = b.dataset.f; st.page = 0; $$('.chips button', el).forEach((x) => x.classList.toggle('on', x === b)); load(); });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-sort]'); if (!b) return;
        st.sort = b.dataset.sort; st.page = 0;
        $$('.c-sort button', el).forEach((x) => { x.classList.toggle('on', x.dataset.sort === st.sort); x.setAttribute('aria-pressed', x.dataset.sort === st.sort); });
        load();
      });
      $('#cPager', el).addEventListener('click', (e) => { const b = e.target.closest('[data-pg]'); if (!b) return; st.page += Number(b.dataset.pg); load(); el.scrollIntoView({ block: 'start' }); });
      load();
    },
  });

  async function customerPage(el, id) {
    el.innerHTML = `${backLink('#customers', 'All customers')}<div class="card">${skelRows(3, 60)}</div>`;
    let d; let rooms = [];
    try {
      [d, rooms] = await Promise.all([GET('/api/admin/customers/' + id), GET('/api/site').then((s) => s.rooms.filter((r) => r.access !== 'free')).catch(() => [])]);
    } catch (e) { el.innerHTML = backLink('#customers', 'All customers') + errorBox(e); return; }
    if (!el.isConnected) return;
    // Built once and moved back in after each redraw, so saving a change does not reload the money card.
    const spendEl = canMoney() ? document.createElement('section') : null;
    if (spendEl) spendCard(spendEl, id);
    const refEl = can('payments') ? document.createElement('section') : null;
    if (refEl) referralCard(refEl, id);
    // VooSquare Academy progress, grants and skips (admin-school.js), kept across redraws like the cards above.
    const schEl = can('academy') && VSA.schoolCard ? document.createElement('section') : null;
    if (schEl) VSA.schoolCard(schEl, id);
    const draw = () => {
      const c = d.customer;
      const manage = can('customers');
      const muted = c.muted_until > Date.now();
      el.innerHTML = `${backLink('#customers', 'All customers')}
        <div class="cust-hero card">
          ${av(c.avatar, 'xl', c.email)}
          <div class="ch-t"><h2>${esc(c.name)}</h2><p>${esc(c.email)}${c.handle ? ` · @${esc(c.handle)}` : ''}${c.country ? ` · ${esc(c.country)}` : ''}</p>
            <div class="pills">${c.premium ? pill('Premium until ' + dateStr(c.premium_until), 'gold') : pill('Free plan', 'w')}${c.staff ? pill(c.role_title || 'Team', 'k') : ''}${c.deleted ? pill('Deleted' + (c.deleted_at ? ' ' + dateStr(c.deleted_at) : ''), 'k') : c.erased ? pill('Personal data erased', 'k') : ''}${c.banned && !c.erased ? pill('Banned', 'r') : ''}${c.deactivated && !c.erased ? pill('Hidden from community', 'w') : ''}${muted ? pill('Muted until ' + fullDate(c.muted_until), 'r') : ''}${c.marketing ? '' : pill('No marketing email', 'w')}</div></div>
          <dl class="ch-stats"><div><dt>Member since</dt><dd>${dateStr(c.created_at)}</dd></div><div><dt>Last seen</dt><dd>${lastSeen(c.last_seen)}</dd></div><div><dt>XP</dt><dd>${fmt(c.xp)}</dd></div><div><dt>Lessons done</dt><dd>${fmt(d.progress)}</dd></div><div><dt>Messages</dt><dd>${fmt(d.messages)}</dd></div><div><dt>Referrals</dt><dd>${fmt(d.referrals)}</dd></div></dl>
        </div>
        ${spendEl ? '<div id="spendHost"></div>' : ''}
        ${refEl ? '<div id="refHost"></div>' : ''}
        ${schEl ? '<div id="schHost"></div>' : ''}
        ${c.deleted ? `<div class="info-line mt">${icon('shield')}<span>This member deleted their account. Their name, email, picture, sign-ins and progress are gone and their certificates are revoked. Their orders and payments stay, under "Deleted member".</span></div>` : ''}
        ${c.erased && !c.deleted ? `<div class="info-line mt">${icon('shield')}<span>This member's name, email, picture and payout details were erased. Their orders stay in revenue under "Erased member".</span></div>` : ''}
        ${manage && !c.erased && !c.deleted ? `<div class="acts-grid mt">
          <form class="card act" id="aPrem"><h4>${icon('diamond')}Premium</h4><p class="muted sm">Adds days on top of the current end date. Enter 0 to remove Premium.</p><div class="row">${input('days', 30, { type: 'number', min: 0, aria: 'Days of Premium', cls: 'w90' })}<button class="btn btn-g btn-sm" type="submit">Apply</button></div></form>
          <form class="card act" id="aRoom"><h4>${icon('star')}Paid room</h4><p class="muted sm">Give access without a payment. Runs for the room's billing period. For invite-only rooms this is the invite: no application needed.</p>${rooms.length ? `<div class="row">${select('room', rooms.map((r) => [r.id, `${r.name} (${r.access})`]), '', { aria: 'Room' })}<button class="btn btn-g btn-sm" type="submit">Grant</button></div>` : '<p class="muted sm">No premium or paid rooms yet.</p>'}</form>
          <form class="card act" id="aMute"><h4>${icon('lock')}Mute</h4><p class="muted sm">${muted ? `Muted until ${esc(fullDate(c.muted_until))}.` : 'Stops them posting in community rooms for a while.'}</p><div class="row">${input('hours', 24, { type: 'number', min: 1, aria: 'Hours', cls: 'w90' })}<button class="btn btn-k btn-sm" type="submit">Mute</button>${muted ? '<button type="button" class="btn btn-w btn-sm" id="unmute">Unmute</button>' : ''}</div></form>
          <div class="card act" data-cfm><h4>${icon('shield')}${c.banned ? 'Banned' : 'Access'}</h4><p class="muted sm">${c.banned ? 'They cannot sign in. Unban to restore their account.' : 'Banning signs them out everywhere and blocks sign-in.'}</p><div class="row"><button type="button" class="btn ${c.banned ? 'btn-w' : 'btn-danger'} btn-sm" id="banB">${c.banned ? 'Unban' : 'Ban member'}</button><button type="button" class="btn btn-w btn-sm" id="mailB">${icon('mail')}Send email</button></div></div>
          ${c.staff ? '' : `<div class="card act" data-cfm><h4>${icon('eye')}Community</h4><p class="muted sm">${c.deactivated ? 'Hidden: their messages and profile are not shown and they cannot post. Everything is kept.' : 'Hide their messages and profile from the community. They keep their account, purchases and tools.'}</p><div class="row"><button type="button" class="btn ${c.deactivated ? 'btn-g' : 'btn-w'} btn-sm" id="deacB">${c.deactivated ? 'Show in community again' : 'Deactivate in community'}</button></div></div>`}
        </div>
        ${isOwner() && !c.staff && !c.deleted ? `<div class="card danger-zone mt" data-cfm><div class="dz-r"><div><b>Erase personal data</b><p class="muted sm">For a member who asks to be forgotten. Replaces their name, email, handle, picture and bio, removes payout details, saved scenarios and queued emails, and signs them out for good. Orders and revenue stay, under "Erased member". This cannot be undone. Members are never deleted.</p></div><button type="button" class="btn btn-danger btn-sm" id="eraseB">Erase personal data</button></div></div>` : ''}` : ''}
        <div class="g2 mt">
          <div class="card"><div class="card-h"><h3>Orders</h3></div>${d.orders.length ? `<div class="rt">${d.orders.map((o) => `<div class="rt-r"><span><b>${esc(o.item_name)}</b><small class="mono">${esc(o.ref)}</small></span><span>${esc(fmt(o.amount, o.amount % 1 ? 2 : 0))} ${esc(o.currency)}<small>${usd(o.amount_usd)}</small></span><span>${orderPill(o.status)}<small>${dateStr(o.created_at)}</small></span></div>`).join('')}</div>` : empty('card', 'No orders')}</div>
          <div class="card"><div class="card-h"><h3>Support conversations</h3></div>${d.tickets.length ? `<div class="mini-list">${d.tickets.map((t) => `<a class="mini" ${can('support') ? `href="#support/${t.id}"` : ''}><span class="kic sm">${icon('inbox')}</span><span class="mini-t"><b>${esc(t.subject || '(no subject)')}</b><small>${esc(t.product || '')} · ${timeAgo(t.updated_at)}</small></span>${statusPill(t.status)}</a>`).join('')}</div>` : empty('inbox', 'No conversations')}</div>
          <div class="card"><div class="card-h"><h3>Rooms and referrals</h3></div>
            <dl class="dl"><dt>Paid room access</dt><dd>${d.rooms.length ? d.rooms.map((r) => `${esc(r.name)} <small class="muted">until ${r.until > 9e14 ? 'lifetime' : dateStr(r.until)}</small>`).join('<br>') : 'None'}</dd><dt>Referral code</dt><dd class="mono">${esc(c.ref_code || '')}</dd><dt>People referred</dt><dd>${fmt(d.referrals)}</dd><dt>Referred by</dt><dd>${c.referred_by ? `<a class="lnk" href="#customers/${c.referred_by.id}">${esc(c.referred_by.name)}</a>` : 'Nobody'}</dd><dt>Voo ID</dt><dd class="mono">${esc(c.voo_id)}</dd><dt>Onboarded</dt><dd>${c.onboarded ? 'Yes' : 'Not yet'}</dd></dl></div>
          <div class="card"><div class="card-h"><h3>Recent tool events</h3></div>${d.events.length ? `<div class="mini-list">${d.events.map((e) => `<div class="mini sm"><span class="mini-t"><b>${esc(e.label || e.type)}</b><small>${esc(e.product || '')} · ${esc(e.type)}${e.value_usd ? ' · ' + usd(e.value_usd) : ''}</small></span><time>${timeAgo(e.created_at)}</time></div>`).join('')}</div>` : empty('spark', 'No events yet', 'Tools send events through the Events API.')}</div>
          ${d.applications && d.applications.length ? `<div class="card span2"><div class="card-h"><div><h3>Room applications</h3><span class="sub">Only the community team sees these answers.</span></div>${can('community') ? '<a class="r btn btn-ghost btn-xs" href="#community/applications?status=all">All applications</a>' : ''}</div><div class="apl-mini">${d.applications.map((a) => appMini(a)).join('')}</div></div>` : ''}
          <div class="card span2"><div class="card-h"><h3>Recent emails</h3></div>${d.emails.length ? `<div class="mini-list">${d.emails.map((m) => `<div class="mini sm"><span class="kic sm">${icon('mail')}</span><span class="mini-t"><b class="mono">${esc(m.template)}</b><small>${m.sent_at ? 'Sent ' + fullDate(m.sent_at) : 'Due ' + fullDate(m.send_at)}</small></span>${statusPill(m.status)}</div>`).join('')}</div>` : empty('mail', 'No emails sent')}</div>
        </div>`;
      if (spendEl) $('#spendHost', el).replaceWith(spendEl);
      if (refEl) $('#refHost', el).replaceWith(refEl);
      if (schEl) $('#schHost', el).replaceWith(schEl);
      if (!manage || c.erased || c.deleted) return;
      const patch = async (btn, body, msg) => { const r = await run(btn, () => PATCH('/api/admin/customers/' + id, body), msg); if (r) { d = await GET('/api/admin/customers/' + id); if (el.isConnected) draw(); } };
      $('#aPrem', el).addEventListener('submit', (e) => { e.preventDefault(); const days = Number($('[name=days]', e.target).value) || 0; patch($('button', e.target), { premium_days: days }, days > 0 ? `Added ${days} days of Premium` : 'Premium removed'); });
      const ar = $('#aRoom', el); if (rooms.length) ar.addEventListener('submit', (e) => { e.preventDefault(); patch($('button', e.target), { grant_room: Number($('[name=room]', e.target).value) }, 'Room access granted. Open applications for it are closed as approved.'); });
      $('#aMute', el).addEventListener('submit', (e) => { e.preventDefault(); const h = Number($('[name=hours]', e.target).value) || 0; if (h <= 0) { toast('Enter how many hours.', 'err'); return; } patch($('button[type=submit]', e.target), { mute_hours: h }, `Muted for ${h} hours`); });
      const um = $('#unmute', el); if (um) um.onclick = () => patch(um, { mute_hours: 0 }, 'Unmuted');
      const bb = $('#banB', el);
      bb.onclick = () => confirmIn(bb, c.banned ? { text: `Unban ${c.name}? They can sign in again.`, yes: 'Unban', danger: false, onYes: () => patch(null, { banned: false }, 'Unbanned') } : { text: `Ban ${c.name}? They are signed out everywhere and cannot sign in.`, yes: 'Ban member', onYes: () => patch(null, { banned: true }, 'Member banned') });
      $('#mailB', el).onclick = () => emailCustomer(c);
      const dz = $('#deacB', el);
      if (dz) dz.onclick = () => (c.deactivated
        ? run(dz, () => POST(`/api/admin/customers/${id}/deactivate`, { deactivated: false }), `${c.name} shows in the community again`).then(async (r) => { if (r) { d = await GET('/api/admin/customers/' + id); if (el.isConnected) draw(); } })
        : confirmIn(dz, { text: `Hide ${c.name} from the community? Their messages and profile disappear for members and they cannot post. You can show them again any time.`, yes: 'Deactivate', onYes: async () => { await POST(`/api/admin/customers/${id}/deactivate`, { deactivated: true }); toast('Hidden from the community'); d = await GET('/api/admin/customers/' + id); if (el.isConnected) draw(); } }));
      const er = $('#eraseB', el);
      if (er) er.onclick = () => eraseModal(c, async () => { d = await GET('/api/admin/customers/' + id); if (el.isConnected) draw(); });
    };
    draw();
  }

  /** Referral earnings and payouts for one member (finance). Loaded once, kept across redraws like the spend card. */
  async function referralCard(host, id) {
    host.className = 'card cust-ref mt';
    host.innerHTML = `<div class="card-h"><div><h3>Referrals and payouts</h3><span class="sub">What this member earns from the people they referred.</span></div></div><div class="skel" style="height:160px"></div>`;
    let s;
    try { s = await GET(`/api/admin/customers/${id}/referrals`); } catch (e) { host.innerHTML = errorBox(e, false); return; }
    const open = s.history.find((h) => ['requested', 'processing'].includes(h.status));
    host.innerHTML = `<div class="card-h"><div><h3>Referrals and payouts</h3><span class="sub">${s.method ? `Paid to ${esc(s.method.label)} · <span class="mono">${esc(s.method.summary)}</span>` : 'No payout details saved yet'}</span></div>${open ? `<a class="r btn btn-g btn-xs" href="#payouts/${open.id}?status=all">${icon('wallet')}Open request · ${usd2(open.amount_usd)}</a>` : '<a class="r btn btn-ghost btn-xs" href="#payouts?status=all">All payouts</a>'}</div>${poSummaryHtml(s)}`;
  }

  /** Owner only. Two steps: read what happens and type the email, then type ERASE. */
  function eraseModal(c, done) {
    const m = modal({
      title: 'Erase personal data', body: `<div class="erase-m" data-noguard>
        <div class="er-who">${av(c.avatar, 'lg', c.email)}<span><b>${esc(c.name)}</b><small>${esc(c.email)}</small></span></div>
        <ul class="er-list"><li>${icon('x')}Name, email, handle, picture, bio and country are replaced</li><li>${icon('x')}Payout details, saved scenarios and queued emails are removed</li><li>${icon('x')}They are signed out and cannot sign in again with this account</li><li>${icon('check')}Orders, revenue and referral history stay, under "Erased member"</li></ul>
        <div class="er-step" data-step="1">${field('Type their email to continue', input('email', '', { ph: c.email, ac: 'off', aria: 'Member email' }))}<div class="row end"><button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><button type="button" class="btn btn-danger btn-sm" data-next disabled>Continue</button></div></div>
        <div class="er-step" data-step="2" hidden><p class="er-warn">${icon('flag')}<span>This cannot be undone. Type <b class="mono">ERASE</b> to erase ${esc(firstName(c.name))}'s personal data now.</span></p>${field('Final check', input('word', '', { ph: 'ERASE', aria: 'Type ERASE' }))}<div class="row end"><button type="button" class="btn btn-ghost btn-sm" data-back>Back</button><button type="button" class="btn btn-danger btn-sm" data-go disabled>Erase personal data</button></div></div>
      </div>`,
    });
    const em = m.q('[name=email]'); const word = m.q('[name=word]');
    em.addEventListener('input', () => { m.q('[data-next]').disabled = em.value.trim().toLowerCase() !== c.email.toLowerCase(); });
    word.addEventListener('input', () => { m.q('[data-go]').disabled = word.value.trim() !== 'ERASE'; });
    m.q('[data-x]').onclick = m.close;
    m.q('[data-next]').onclick = () => { m.q('[data-step="1"]').hidden = true; m.q('[data-step="2"]').hidden = false; word.focus(); };
    m.q('[data-back]').onclick = () => { m.q('[data-step="2"]').hidden = true; m.q('[data-step="1"]').hidden = false; em.focus(); };
    m.q('[data-go]').onclick = async (e) => {
      const r = await run(e.currentTarget, () => POST(`/api/admin/customers/${c.id}/erase`, { confirm: 'ERASE', email: em.value.trim().toLowerCase() }), 'Personal data erased');
      if (r) { m.close(); done(); }
    };
  }

  function emailCustomer(c) {
    const m = modal({
      title: 'Email ' + firstName(c.name), body: `<form id="emF" class="stack" novalidate><p class="muted sm">Sends a branded email to <b>${esc(c.email)}</b> using the Broadcast template.</p>
      ${field('Subject', input('subject', '', { ph: 'What the email is about' }))}${field('Title', input('title', '', { ph: 'Big line at the top (optional)' }))}${field('Message', textarea('body', '', { rows: 6, ph: 'Leave a blank line between paragraphs.' }))}
      <div class="g2c">${field('Button text', input('cta_text', '', { ph: 'Open VooSquare' }))}${field('Button link', input('cta_url', '', { ph: 'https://...' }))}</div>
      <div class="row end"><button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><button type="submit" class="btn btn-g btn-sm">${icon('send')}Send email</button></div></form>`,
    });
    m.q('[data-x]').onclick = m.close;
    m.q('#emF').addEventListener('submit', async (e) => { e.preventDefault(); const r = await run(m.q('button[type=submit]'), () => POST(`/api/admin/customers/${c.id}/email`, readForm(e.target)), 'Email queued'); if (r) m.close(); });
  }

  /* =====================================================================
   * COMMUNITY
   * ===================================================================== */
  const ROOM_COLORS = ['#00A86B', '#12C784', '#0F766E', '#00774B', '#5B3FE8', '#2449D8', '#3D6BF2', '#EE5A2F', '#C8401C', '#E8458B', '#B45309', '#8A6A00', '#475569', '#111312'];
  const localImg = (u) => (/^(\/(?!\/)[\w\-./?=&]+|blob:[\w:/.\-]+)$/.test(String(u || '')) ? u : '');
  const roomChip = (r, size = '') => (localImg(r.image)
    ? `<span class="rm-ic pic ${size}" style="background:${esc(r.color || '#00A86B')}"><img src="${esc(localImg(r.image))}" alt="" loading="lazy"></span>`
    : `<span class="rm-ic ${size}" style="background:${esc(r.color || '#00A86B')}">${icon(r.icon || 'chat')}</span>`);

  /**
   * Picture and cover for a room: upload (compressed in the browser, same pipeline as chat images), replace, or go back
   * to the house artwork. The upload id lands in a hidden field and is attached when the room is saved.
   */
  const PIC_SLOTS = {
    image_upload: { label: 'Picture', hint: 'Square, at least 96 px. Shows in the room list, the room header and notifications.', ok: (w, h) => w >= 96 && h >= 96 && w / h >= 0.6 && w / h <= 1.67, bad: 'Use a square image, at least 96 by 96 pixels.' },
    play_badge_upload: { label: 'Google Play badge', purpose: 'site', full: true, hint: 'The official "Get it on Google Play" badge as a PNG.', ok: (w, h) => w >= 120 && w / h >= 1.8, bad: 'Upload the official badge: a wide PNG, at least 120 pixels across.' },
    app_store_badge_upload: { label: 'App Store badge', purpose: 'site', full: true, hint: 'The official "Download on the App Store" badge as a PNG.', ok: (w, h) => w >= 120 && w / h >= 1.8, bad: 'Upload the official badge: a wide PNG, at least 120 pixels across.' },
    cover_upload: { label: 'Cover', hint: 'Wide, best 1200 by 400 (3:1). Shows on the room tile and behind the room header.', ok: (w, h) => w >= 600 && w / h >= 1.6, bad: 'Use a wide image, at least 600 pixels across and about 3 times wider than tall.' },
  };
  function picSlots(r) {
    const slot = (k, url, custom, def) => `<div class="rm-slot ${k === 'cover_upload' ? 'wide' : 'sq'}" data-slot="${k}" data-def="${esc(def || '')}">
      <span class="rm-sv">${url ? `<img src="${esc(url)}" alt="">` : `<span class="rm-sv-e">${icon('image')}</span>`}<span class="rm-bar" hidden><i></i></span></span>
      <span class="rm-st"><b>${PIC_SLOTS[k].label}</b><small class="rm-src">${custom ? 'Your upload' : def ? 'House artwork' : 'None yet'}</small><small>${esc(PIC_SLOTS[k].hint)}</small>
      <span class="row"><button type="button" class="btn btn-w btn-xs" data-up>${icon('image')}${custom ? 'Replace' : 'Upload'}</button><button type="button" class="btn btn-ghost btn-xs" data-reset${custom ? '' : ' hidden'}>${def ? 'Use house artwork' : 'Remove'}</button></span></span>
      <input type="hidden" name="${k}" value="${esc(r[k] || '')}"></div>`;
    return `<div class="field"><span class="lbl">Pictures</span><div class="rm-pics">${slot('image_upload', r.image, r.image_custom, r.image_default)}${slot('cover_upload', r.cover, r.cover_custom, r.cover_default)}</div></div>`;
  }
  /** Wire the picture slots. onChange(slotKey, previewUrl) keeps the live preview in step. */
  function bindPicSlots(root, onChange) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.hidden = true;
    root.appendChild(input);
    let target = null;
    const set = (box, url, src, custom) => {
      $('.rm-sv', box).querySelector('img, .rm-sv-e').outerHTML = url ? `<img src="${esc(url)}" alt="">` : `<span class="rm-sv-e">${icon('image')}</span>`;
      $('.rm-src', box).textContent = src;
      $('[data-reset]', box).hidden = !custom;
      $('[data-up]', box).lastChild.textContent = custom ? 'Replace' : 'Upload';
      onChange(box.dataset.slot, url);
    };
    root.addEventListener('click', (e) => {
      const box = e.target.closest('.rm-slot'); if (!box) return;
      if (e.target.closest('[data-up]')) { target = box; input.click(); }
      if (e.target.closest('[data-reset]')) { $('input[type=hidden]', box).value = ''; set(box, box.dataset.def, box.dataset.def ? 'House artwork' : 'None yet', false); }
    });
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0]; input.value = '';
      const box = target; if (!f || !box || !window.VSM) return;
      const rule = PIC_SLOTS[box.dataset.slot];
      const bar = $('.rm-bar', box), up = $('[data-up]', box);
      try {
        up.disabled = true;
        const prep = await VSM.prepare(f);
        if (!rule.ok(prep.w, prep.h)) { URL.revokeObjectURL(prep.preview); toast(rule.bad, 'err'); return; }
        bar.hidden = false; bar.firstChild.style.width = '6%';
        const u = await VSM.upload(prep, rule.purpose || 'room', (p) => { bar.firstChild.style.width = Math.max(6, Math.round(p * 100)) + '%'; }).promise;
        $('input[type=hidden]', box).value = u.id;
        set(box, box.dataset.slot === 'image_upload' ? u.thumb_url : u.url, rule.purpose === 'site' ? 'New upload · goes live when you save' : 'New upload · saved with the room', true);
        URL.revokeObjectURL(prep.preview);
      } catch (err) { toast(err.message || 'That image could not be used.', 'err'); }
      finally { up.disabled = false; bar.hidden = true; }
    });
  }
  const accessPill = (r) => (r.access === 'premium' ? pill('Premium', 'gold') : r.access === 'paid' ? pill(`Paid · ${usd(r.price_usd)}${r.period_days ? '/' + r.period_days + 'd' : ''}`, 'p') : pill('Free', 'g'));

  page('community', {
    t: 'Community', i: 'chat', perm: () => can('community'),
    r(el, args, q) {
      const tabs = [['rooms', 'Rooms'], ['applications', 'Applications'], ['reports', 'Reports'], ['moderation', 'Moderation'], ['images', 'Images'], ['rules', 'Rules and welcome']];
      const tab = tabs.some((t) => t[0] === args[0]) ? args[0] : 'rooms';
      const tabCount = (k) => (k === 'applications' ? `<span class="tab-n" id="appTabN"${S.pendingApps ? '' : ' hidden'}>${S.pendingApps || ''}</span>` : k === 'reports' ? `<span class="tab-n tab-n-r" id="repTabN"${S.openReports ? '' : ' hidden'}>${S.openReports || ''}</span>` : '');
      el.innerHTML = `${pageHead('Community', 'Rooms, applications, moderation and the rules every member sees.', tab === 'rooms' ? `<button type="button" class="btn btn-g btn-sm" id="newRoom">${icon('plus')}New room</button>` : '')}
        <nav class="tabs" aria-label="Community sections">${tabs.map(([k, l]) => `<a href="#community/${k}" class="${k === tab ? 'on' : ''}"${k === tab ? ' aria-current="page"' : ''}>${l}${tabCount(k)}</a>`).join('')}</nav><div id="cmBody" class="mt">${skelCards(6, 120)}</div>`;
      on('appcount', (n) => { const b = $('#appTabN', el); if (b) { b.hidden = !n; b.textContent = n; } });
      on('repcount', (n) => { const b = $('#repTabN', el); if (b) { b.hidden = !n; b.textContent = n; } });
      const body = $('#cmBody', el);
      if (tab === 'rooms') return roomsTab(el, body);
      if (tab === 'applications') return applicationsTab(body, q || {});
      if (tab === 'reports') return reportsTab(body, q || {});
      if (tab === 'moderation') return moderationTab(body);
      if (tab === 'images') return imagesTab(body);
      return rulesTab(body);
    },
  });

  const mb = (b) => (b >= 1024 * 1024 * 1024 ? fmt(b / 1024 / 1024 / 1024, 2) + ' GB' : fmt(b / 1024 / 1024, b < 10 * 1024 * 1024 ? 1 : 0) + ' MB');
  const storageCard = (s) => `<div class="stor"><div><b>${fmt(s.count)}</b><small>Images stored</small></div><div><b>${mb(s.bytes)}</b><small>Space used</small></div><div><b>${fmt(s.today)}</b><small>Shared in the last 24 hours</small></div><div><b>${mb(s.disk_bytes)}</b><small>On disk, incl. 7-day trash</small></div></div>`;

  /** Who can share images in rooms, the daily limit, and how much space they use. */
  async function imagesTab(body) {
    let d;
    try { d = await GET('/api/admin/uploads/stats'); } catch (e) { body.innerHTML = errorBox(e); return; }
    if (!body.isConnected) return;
    const s = d.settings;
    body.innerHTML = `<div class="g2"><form class="card stack" id="imF" novalidate><div class="card-h"><div><h3>Image sharing</h3><span class="sub">Members' phones shrink every image before it uploads (about 300 KB), so sharing stays fast and cheap.</span></div></div>
        <div class="field"><span class="lbl">Who can share images in rooms</span>${seg('who', [['everyone', 'Everyone'], ['premium', 'Premium only'], ['team', 'Team only']], s.who)}<span class="hint">Each room can also switch images off in its settings. Muted members cannot share.</span></div>
        <div class="g2c">${field('Images per member per day', input('daily_limit', s.daily_limit, { type: 'number', min: 1, max: 500 }), 'The team has no limit.')}${field('Storage per member (MB)', input('storage_mb', s.storage_mb, { type: 'number', min: 0 }), '0 means no cap.')}</div>
        <div class="row end"><button type="submit" class="btn btn-g btn-sm">Save image settings</button></div></form>
      <div class="card stack"><div class="card-h"><div><h3>Storage</h3><span class="sub">Images live on the server volume next to the database.</span></div></div>${storageCard(d.stats)}
        <p class="muted sm">Support screenshots and payment proofs count here too. Removed images stay 7 days, then they are deleted for good. Images nobody sends are cleared after 24 hours.</p></div></div>`;
    const f = $('#imF', body);
    f.addEventListener('submit', (e) => { e.preventDefault(); const v = readForm(f); run($('button[type=submit]', f), () => saveSetting('images', v), 'Image settings saved'); });
  }

  async function roomsTab(el, body) {
    let data;
    const load = async () => {
      try { data = await GET('/api/admin/rooms'); } catch (e) { body.innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      const live = data.rooms.filter((r) => !r.archived), arch = data.rooms.filter((r) => r.archived);
      const topics = [...new Set(live.map((r) => r.topic || 'General'))];
      const card = (r) => `<button type="button" class="room ${r.archived ? 'arch' : ''}" data-id="${r.id}">${roomChip(r)}<span class="room-t"><b>${esc(r.name)}</b><small>${esc(r.description || 'No description')}</small><span class="pills">${accessPill(r)}${r.read_only ? pill('Team posts only', 'w') : ''}${r.images === 0 ? pill('No images', 'w') : ''}${r.slow_secs ? pill(`Slow mode ${r.slow_secs}s`, 'w') : ''}${r.archived ? pill('Archived', 'r') : ''}${r.access === 'paid' && r.approval_required ? pill('Invite only', 'k') : ''}${r.pending ? `<a class="pill pill-l" href="#community/applications?room=${r.id}" data-stop>${fmt(r.pending)} to review</a>` : ''}</span></span><span class="room-s"><b>${fmt(r.messages)}</b><small>messages</small>${r.access === 'paid' ? `<b>${fmt(r.members)}${r.approval_required && r.seats ? `<em>/${fmt(r.seats)}</em>` : ''}</b><small>${r.approval_required && r.seats ? 'seats' : 'paying'}</small>` : ''}<span class="sort">#${r.sort}</span></span></button>`;
      body.innerHTML = (live.length ? topics.map((t) => `<section class="topic"><h3 class="topic-h">${esc(t)}<small>${live.filter((r) => (r.topic || 'General') === t).length}</small></h3><div class="rooms">${live.filter((r) => (r.topic || 'General') === t).map(card).join('')}</div></section>`).join('') : empty('chat', 'No rooms yet', 'Create the first room for your members.'))
        + (arch.length ? `<section class="topic"><h3 class="topic-h">Archived<small>${arch.length}</small></h3><div class="rooms">${arch.map(card).join('')}</div></section>` : '');
    };
    body.addEventListener('click', (e) => { if (e.target.closest('[data-stop]')) return; const b = e.target.closest('.room'); if (b) roomModal(data.rooms.find((r) => r.id === Number(b.dataset.id)), data.rooms, load, data.default_questions); });
    $('#newRoom', el).onclick = () => roomModal(null, data ? data.rooms : [], load, data && data.default_questions);
    await load();
  }

  const DEFAULT_QS = ['What do you run right now? (verticals, geos)', 'Your monthly ad spend', 'What do you want from this room?', 'Telegram or WhatsApp handle (optional)'];
  function roomModal(r, all, done, defaultQs) {
    r = r || { name: '', topic: '', description: '', icon: 'chat', color: '#00A86B', access: 'free', price_usd: 0, period_days: 30, read_only: 0, slow_secs: 0, sort: (all.length ? Math.max(...all.map((x) => x.sort || 0)) + 1 : 0), archived: 0, images: 1, approval_required: 0, seats: 0 };
    const qs = (r.apply_questions && r.apply_questions.length ? r.apply_questions : defaultQs || DEFAULT_QS);
    const taken = r.seats_taken != null ? r.seats_taken : (r.members || 0);
    const topics = [...new Set(all.map((x) => x.topic).filter(Boolean))];
    const m = modal({
      title: r.id ? 'Edit room' : 'New room', wide: true,
      body: `<form id="rmF" class="stack" novalidate>
        <div class="rm-prev" id="rmPrev"></div>
        <div class="g2c">${field('Name', input('name', r.name, { ph: 'For example: Tracking & signals' }))}${field('Topic', input('topic', r.topic, { ph: 'Start here, Craft, Premium...', list: 'rmTopics' }) + `<datalist id="rmTopics">${topics.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>`, 'Rooms are grouped by topic.')}</div>
        ${field('Description', textarea('description', r.description, { rows: 2, ph: 'One line on what belongs here' }))}
        ${picSlots(r)}
        <div class="field"><span class="lbl">Icon <em class="muted">shows when a room has no picture</em></span><div class="icon-pick" role="radiogroup" aria-label="Icon">${Object.keys(VS.P).map((k) => `<button type="button" role="radio" aria-checked="${k === r.icon}" aria-label="${esc(k)}" data-ic="${k}" class="${k === r.icon ? 'on' : ''}">${icon(k)}</button>`).join('')}</div><input type="hidden" name="icon" value="${esc(r.icon)}"></div>
        <div class="field"><span class="lbl">Colour</span><div class="swatches" role="radiogroup" aria-label="Colour">${ROOM_COLORS.map((c) => `<button type="button" role="radio" aria-checked="${c === r.color}" aria-label="${c}" data-c="${c}" class="${c.toLowerCase() === String(r.color).toLowerCase() ? 'on' : ''}" style="background:${c}"></button>`).join('')}<label class="sw-custom" title="Custom colour"><input type="color" name="color" value="${esc(/^#[0-9a-f]{6}$/i.test(r.color) ? r.color : '#00A86B')}" aria-label="Custom colour"></label></div></div>
        <div class="field"><span class="lbl">Who can read and post</span>${seg('access', [['free', 'Free for everyone'], ['premium', 'Premium members'], ['paid', 'Paid room']], r.access)}</div>
        <div class="paid-only stack"${r.access === 'paid' ? '' : ' hidden'}>
          <div class="g2c">${field('Price (USD)', input('price_usd', r.price_usd, { type: 'number', min: 0, step: '0.01' }))}${field('Billing period (days)', input('period_days', r.period_days, { type: 'number', min: 0 }), '0 means one payment for lifetime access.')}</div>
          <div class="inv-box">
            ${switchField('approval_required', r.approval_required, 'Invite only: members apply, you approve', 'They pay only after you approve them, within 7 days. Members who already have access renew as normal.')}
            <div class="inv-more stack"${r.approval_required ? '' : ' hidden'}>
              <div class="g2c">${field('Seats', input('seats', r.seats || 0, { type: 'number', min: 0, max: 10000 }), '0 means no limit.')}<div class="field"><span class="lbl">In use now</span><div class="inv-seat" id="invSeat"></div></div></div>
              <div class="field"><span class="lbl">Application questions <em class="muted">up to 5</em></span>${listEditor(qs, { ph: 'A short question', add: 'Add a question', aria: 'Question', key: 'apply_questions' })}<span class="hint">Add "(optional)" to a question to make it optional. Answers are capped at 600 characters.</span></div>
            </div>
          </div>
        </div>
        <div class="g3c">${field('Slow mode (seconds)', input('slow_secs', r.slow_secs, { type: 'number', min: 0, max: 3600 }), '0 turns it off.')}${field('Sort order', input('sort', r.sort, { type: 'number' }), 'Lower shows first.')}<div class="field"><span class="lbl">Options</span>${switchField('read_only', r.read_only, 'Only the team can post')}${switchField('images', r.images !== 0, 'Members can share images', 'The team always can')}${switchField('archived', r.archived, 'Archived', 'Hidden from members')}</div></div>
        <div class="row end"><button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><button type="submit" class="btn btn-g btn-sm">${r.id ? 'Save room' : 'Create room'}</button></div></form>`,
    });
    const f = m.q('#rmF');
    const pics = { image: r.image || '', cover: r.cover || '' };
    const prev = () => {
      const v = { ...readForm(f), image: pics.image };
      m.q('#rmPrev').style.setProperty('--cov', pics.cover ? `url("${pics.cover.replace(/["\\]/g, '')}")` : 'none');
      m.q('#rmPrev').classList.toggle('has-cov', !!pics.cover);
      m.q('#rmPrev').innerHTML = `${roomChip(v, 'lg')}<span><b>${esc(v.name || 'Room name')}</b><small>${esc(v.description || 'Description')}</small></span>${v.access === 'paid' && v.approval_required ? pill('Invite only', 'k') : ''}${accessPill(v)}`;
      m.q('.paid-only').hidden = v.access !== 'paid';
      m.q('.inv-more').hidden = !v.approval_required;
      const seats = Number(v.seats) || 0;
      m.q('#invSeat').innerHTML = seats ? `<span><b>${fmt(taken)}</b> of ${fmt(seats)} taken</span><span class="inv-bar"><i style="width:${Math.min(100, Math.round((taken / seats) * 100))}%"></i></span>${taken >= seats ? '<small>Full. New approvals join the waitlist unless you override.</small>' : `<small>${fmt(seats - taken)} free</small>`}` : `<span><b>${fmt(taken)}</b> ${taken === 1 ? 'member' : 'members'}</span><small>No seat limit</small>`;
      const n = $$('.re-row', $('[data-key=apply_questions]', f)).length;
      $('[data-key=apply_questions] .re-add', f).hidden = n >= 5;
    };
    f.addEventListener('input', prev);
    bindPicSlots(f, (k, url) => { pics[k === 'image_upload' ? 'image' : 'cover'] = url || ''; prev(); });
    m.q('.icon-pick').addEventListener('click', (e) => { const b = e.target.closest('[data-ic]'); if (!b) return; $$('.icon-pick button', f).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); $('[name=icon]', f).value = b.dataset.ic; prev(); });
    m.q('.swatches').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (!b) return; $$('.swatches button', f).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); $('[name=color]', f).value = b.dataset.c; prev(); });
    $('[name=color]', f).addEventListener('input', () => $$('.swatches button', f).forEach((x) => x.classList.remove('on')));
    m.q('[data-x]').onclick = m.close;
    prev();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(f);
      if (!v.name.trim()) { toast('Give the room a name.', 'err'); return; }
      v.apply_questions = readList($('[data-key=apply_questions]', f)).slice(0, 5);
      if (v.access === 'paid' && v.approval_required && !v.apply_questions.length) { toast('Add at least one application question.', 'err'); return; }
      const res = await run(m.q('button[type=submit]'), () => POST('/api/admin/rooms', { ...v, id: r.id }), r.id ? 'Room saved' : 'Room created');
      if (res) { m.close(); done(); }
    });
  }

  /* ---------- applications (invite-only rooms) ---------- */
  const APP_STATUS = { pending: ['Pending', 'gold'], approved: ['Approved', 'g'], waitlist: ['Waitlist', 'b'], rejected: ['Rejected', 'r'], withdrawn: ['Withdrawn', 'w'], expired: ['Expired', 'w'], paid: ['Member', 'k'] };
  const appKey = (a) => (a.paid ? 'paid' : a.waitlist ? 'waitlist' : a.status);
  const appPill = (a) => { const [t, k] = APP_STATUS[appKey(a)] || [a.status, 'w']; return pill(t, k); };
  const appWhen = (a) => {
    if (a.paid) return a.access_until > Date.now() ? `Member until ${dateStr(a.access_until)}` : 'Was a member';
    if (a.status === 'approved' && a.waitlist) return `Approved ${timeAgo(a.decided_at)} ago · waiting for a seat`;
    if (a.status === 'approved') return `Approved · pay by ${dateStr(a.approved_until)}${a.seat_override ? ' · over the seat limit' : ''}`;
    if (a.decided_at && a.status !== 'pending') return `${APP_STATUS[a.status] ? APP_STATUS[a.status][0] : a.status} ${timeAgo(a.decided_at)} ago${a.decided_by ? ' by ' + esc(firstName(a.decided_by)) : ''}`;
    return `Applied ${timeAgo(a.created_at)} ago`;
  };
  /** Compact row for the customer page. */
  function appMini(a) {
    return `<details class="apm"><summary>${roomChip(a.room, 'sm')}<span class="apm-t"><b>${esc(a.room.name)}</b><small>${appWhen(a)}</small></span>${appPill(a)}</summary>
      <dl class="apl-qa">${a.answers.map((x) => `<dt>${esc(x.q)}</dt><dd>${x.a ? esc(x.a) : '<span class="muted">No answer</span>'}</dd>`).join('')}</dl>${a.note_to_member ? `<p class="apl-note"><small>Note sent to them</small>${esc(a.note_to_member)}</p>` : ''}</details>`;
  }
  const APP_FILTERS = [['pending', 'To review'], ['waitlist', 'Waitlist'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];

  async function applicationsTab(body, q) {
    const st = { status: APP_FILTERS.some((f) => f[0] === q.status) ? q.status : 'pending', room: q.room || '', q: '' };
    body.innerHTML = `<div class="card flush apl-wrap"><div class="toolbar"><div class="chips" role="group" aria-label="Status">${APP_FILTERS.map(([v, l]) => `<button type="button" data-st="${v}" class="${v === st.status ? 'on' : ''}">${l}<span class="chip-n" data-n="${v}"></span></button>`).join('')}</div>
      <label class="mini-sel"><span>Room</span><select class="inp" id="apRoom" aria-label="Room"><option value="">All paid rooms</option></select></label>
      <input class="inp apl-q" id="apQ" type="search" placeholder="Name or email" aria-label="Search applicants"></div>
      <div id="apSeats" class="apl-seats"></div><div id="apList">${skelRows(4, 150)}</div></div>`;
    const list = $('#apList', body); const sel = $('#apRoom', body);
    let data = null; let seq = 0;
    const load = async () => {
      const my = ++seq;
      const p = new URLSearchParams({ status: st.status }); if (st.room) p.set('room', st.room); if (st.q) p.set('q', st.q);
      try { data = await GET('/api/admin/applications?' + p); } catch (e) { if (body.isConnected) list.innerHTML = errorBox(e); return; }
      if (my !== seq || !body.isConnected) return;
      if (sel.options.length === 1) data.rooms.forEach((r) => sel.insertAdjacentHTML('beforeend', `<option value="${r.id}"${String(r.id) === String(st.room) ? ' selected' : ''}>${esc(r.name)}</option>`));
      const cnt = Object.fromEntries(data.counts.map((c) => [c.status, c.n]));
      $$('[data-n]', body).forEach((x) => { const k = x.dataset.n; const n = k === 'waitlist' ? data.waitlist : k === 'all' ? 0 : k === 'pending' ? cnt.pending || 0 : 0; x.textContent = n ? n : ''; });
      const inv = data.rooms.filter((r) => r.approval_required && (!st.room || String(r.id) === String(st.room)));
      $('#apSeats', body).innerHTML = inv.map((r) => `<div class="aps">${roomChip(r, 'sm')}<b>${esc(r.name)}</b>${r.seats ? `<span class="aps-bar"><i style="width:${Math.min(100, Math.round((r.seats_taken / r.seats) * 100))}%"></i></span><span class="aps-n ${r.seats_taken >= r.seats ? 'full' : ''}">${fmt(Math.min(r.seats_taken, r.seats))} of ${fmt(r.seats)} seats${r.seats_taken >= r.seats ? ' · full' : ''}</span>` : `<span class="aps-n">${fmt(r.seats_taken)} members · no seat limit</span>`}</div>`).join('');
      const apps = data.applications;
      list.innerHTML = apps.length ? apps.map((a, i) => appCard(a, i)).join('') : empty(st.status === 'pending' ? 'check' : 'inbox', st.status === 'pending' ? 'Nothing to review' : 'No applications here', st.status === 'pending' ? 'New applications show up here as they arrive, with a badge on Community.' : 'Try another filter.');
    };
    const appCard = (a, i) => {
      const u = a.user;
      const open = ['pending', 'rejected', 'expired'].includes(a.status) || (a.status === 'approved' && a.waitlist);
      const canReject = ['pending', 'approved'].includes(a.status) && !a.paid;
      return `<article class="apl ${a.status === 'pending' ? 'is-new' : ''}" data-id="${a.id}" style="animation-delay:${Math.min(i, 10) * 35}ms" data-cfm>
        <header class="apl-h">${av(u.avatar, 'md', u.email)}
          <div class="apl-who"><div class="apl-nm">${can('customers') || can('support') ? `<a href="#customers/${u.id}">${esc(u.name || u.email)}</a>` : `<b>${esc(u.name || u.email)}</b>`}${u.premium ? pill('Premium', 'gold') : ''}</div>
            <small>${esc(u.email)}${u.country ? ' · ' + esc(u.country) : ''} · member since ${dateStr(u.member_since)}</small></div>
          <div class="apl-st">${appPill(a)}<small>${appWhen(a)}</small></div></header>
        <div class="apl-meta"><span>${roomChip(a.room, 'sm')}${esc(a.room.name)}</span><span>${icon('card')}${a.paid_orders ? `${fmt(a.paid_orders)} paid ${a.paid_orders === 1 ? 'order' : 'orders'} · ${usd(a.spend_usd)} spent` : 'No payments yet'}</span>${a.status !== 'pending' ? `<span>${icon('clock')}Applied ${dateStr(a.created_at)}</span>` : ''}</div>
        <dl class="apl-qa">${a.answers.map((x) => `<dt>${esc(x.q)}</dt><dd>${x.a ? esc(x.a) : '<span class="muted">No answer</span>'}</dd>`).join('')}</dl>
        ${a.note_to_member ? `<p class="apl-note"><small>Note sent to them</small>${esc(a.note_to_member)}</p>` : ''}
        ${open || canReject ? `<footer class="apl-f">${canReject ? `<button type="button" class="btn btn-w btn-sm" data-rej="${a.id}">${icon('x')}Reject</button>` : ''}${open ? `<button type="button" class="btn btn-g btn-sm" data-app="${a.id}">${icon('check')}${a.waitlist ? 'Give a seat now' : a.status === 'pending' ? 'Approve' : 'Approve now'}</button>` : ''}</footer>` : ''}
      </article>`;
    };
    const decide = (a, kind) => {
      const room = data.rooms.find((r) => r.id === a.room_id) || {};
      const full = room.seats && room.seats_taken >= room.seats;
      const approve = kind === 'approve';
      const m = modal({
        title: approve ? `Approve ${firstName(a.user.name)}` : `Reject ${firstName(a.user.name)}`,
        body: `<form class="stack" novalidate><div class="apd">${av(a.user.avatar, 'md', a.user.email)}<span><b>${esc(a.user.name)}</b><small>${esc(a.room.name)}</small></span></div>
          ${approve ? `<p class="muted sm">They get an email and a notification with a button to pay. The seat is held for 7 days, then it goes to the next person.</p>` : '<p class="muted sm">They get a short, kind email with your note. They can apply again in 30 days.</p>'}
          ${field(approve ? 'Note to them (optional)' : 'Note to them (optional, recommended)', textarea('note', '', { rows: 3, ph: approve ? 'For example: Bring your last 30 days of numbers to the first call.' : 'For example: Run steady spend for three months first, then apply again.' }), 'They see this in the email and in VooSquare.')}
          ${approve && full ? `<div class="apd-full">${icon('users')}<span><b>The room is full (${fmt(room.seats_taken)} of ${fmt(room.seats)}).</b> They go on the waitlist and get a seat when one opens.</span></div>${switchField('override_seats', a.waitlist, 'Approve anyway, over the seat limit', 'They can pay straight away.')}` : ''}
          <div class="row end"><button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><button type="submit" class="btn ${approve ? 'btn-g' : 'btn-danger'} btn-sm">${approve ? `${icon('check')}Approve` : `${icon('x')}Reject`}</button></div></form>`,
      });
      m.q('[data-x]').onclick = m.close;
      m.q('form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = readForm(e.target);
        const r = await run(m.q('button[type=submit]'), () => POST(`/api/admin/applications/${a.id}/${approve ? 'approve' : 'reject'}`, { note: v.note, override_seats: !!v.override_seats }), (x) => (approve ? (x.application.waitlist ? 'Approved. On the waitlist until a seat opens.' : 'Approved. They have 7 days to pay.') : 'Rejected. They have been told.'));
        if (r) { m.close(); load(); refreshBadges(); }
      });
    };
    body.addEventListener('click', (e) => {
      const c = e.target.closest('[data-st]');
      if (c) { st.status = c.dataset.st; $$('[data-st]', body).forEach((x) => x.classList.toggle('on', x === c)); list.innerHTML = skelRows(3, 150); load(); return; }
      const btn = e.target.closest('[data-app],[data-rej]');
      const a = btn && data && data.applications.find((x) => x.id === Number(btn.dataset.app || btn.dataset.rej));
      if (a) decide(a, btn.dataset.app ? 'approve' : 'reject');
    });
    sel.addEventListener('change', () => { st.room = sel.value; load(); });
    $('#apQ', body).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); load(); }, 280));
    on('application', debounce(load, 300));
    await load();
  }

  /* ---------- reports (members reporting messages; src/ugc.js) ---------- */
  const repAgo = (t) => { const x = timeAgo(t); return /^now$|just/i.test(x) ? 'just now' : x + ' ago'; };
  const REP_DONE = { removed: ['Message removed', 'r'], banned: ['Author banned', 'r'], dismissed: ['Dismissed', 'w'] };
  async function reportsTab(body, q) {
    const st = { status: q.status === 'handled' ? 'handled' : 'open' };
    body.innerHTML = `<div class="card flush"><div class="toolbar"><div class="chips" role="group" aria-label="Status">${[['open', 'To review'], ['handled', 'Handled']].map(([v, l]) => `<button type="button" data-st="${v}" class="${v === st.status ? 'on' : ''}">${l}<span class="chip-n" data-n="${v}"></span></button>`).join('')}</div><span class="live-note"><i class="live-dot"></i>Updates live</span></div>
      <p class="rep-intro">${icon('shield')}<span>Members report messages that break the rules. Review each one within 24 hours. A message reported by 3 different members is hidden from everyone but the team until you decide.</span></p>
      <div id="repList">${skelRows(3, 120)}</div></div>`;
    const list = $('#repList', body);
    let seq = 0; let data = null;
    const load = async () => {
      const my = ++seq;
      try { data = await GET('/api/admin/reports?status=' + st.status); } catch (e) { if (body.isConnected) list.innerHTML = errorBox(e); return; }
      if (my !== seq || !body.isConnected) return;
      const n = $('[data-n="open"]', body); if (n) n.textContent = data.open || '';
      list.innerHTML = data.groups.length ? data.groups.map(repCard).join('') : empty(st.status === 'open' ? 'check' : 'inbox', st.status === 'open' ? 'Nothing to review' : 'No handled reports yet', st.status === 'open' ? 'New reports show up here as they arrive, with a badge on Community.' : 'Reports you remove, dismiss or ban show here.');
    };
    const repCard = (g) => {
      const m = g.message; const a = g.author;
      const notes = g.reports.filter((r) => r.note);
      const done = REP_DONE[g.action];
      return `<article class="mod rep ${m.deleted ? 'deleted' : ''}" data-cfm data-mid="${g.message_id}">${av(a.avatar, 'md', a.name)}<div class="mod-b">
          <div class="mod-h">${can('customers') || can('support') ? `<a href="#customers/${a.id}"><b>${esc(a.name)}</b></a>` : `<b>${esc(a.name)}</b>`}${a.staff ? pill(a.role_title || 'Team', 'k') : ''}${a.banned ? pill('Banned', 'r') : ''}<span class="muted">in ${esc(g.room.name)}</span><time title="${esc(fullDate(m.created_at))}">${timeAgo(m.created_at)}</time>${m.hidden ? `<span class="pin-tag rep-hid">${icon('eye')}Hidden for members</span>` : ''}</div>
          ${m.body || m.deleted ? `<p>${m.deleted ? '<em>Deleted</em> ' : ''}${linkify(m.body)}</p>` : ''}${m.attachment && window.VSM ? VSM.thumb(m.attachment, { maxW: 220, maxH: 180 }) : ''}
          <div class="rep-why">${g.reasons.map((x) => `<span class="pill pill-r">${esc(x.label)}${x.n > 1 ? ` · ${x.n}` : ''}</span>`).join('')}</div>
          ${notes.length ? `<ul class="rep-notes">${notes.map((r) => `<li><b>${esc(r.reporter.name)}</b> ${esc(r.note)}</li>`).join('')}</ul>` : ''}
          <small class="rep-meta">${icon('flag')}${g.count} ${g.count === 1 ? 'report' : 'reports'} · latest ${repAgo(g.last_at)}${done ? ` · ${esc(done[0])}${g.handled_by ? ' by ' + esc(firstName(g.handled_by)) : ''} ${repAgo(g.handled_at)}` : ''}</small>
        </div>
        ${st.status === 'open' ? `<div class="mod-a"><button type="button" class="btn btn-danger btn-xs" data-rm>${icon('trash')}Remove message</button><button type="button" class="btn btn-w btn-xs" data-dismiss>${icon('check')}Dismiss</button>${a.staff ? '' : `<button type="button" class="btn btn-w btn-xs rep-ban" data-ban>${icon('block')}Ban author</button>`}</div>` : `<div class="mod-a">${done ? pill(done[0], done[1]) : ''}</div>`}</article>`;
    };
    const after = (r, msg) => { if (r) { toast(msg); S.openReports = r.open; emit('repcount', r.open); refreshBadges(); load(); } };
    list.addEventListener('click', (e) => {
      const card = e.target.closest('[data-mid]'); if (!card) return;
      const g = data && data.groups.find((x) => String(x.message_id) === card.dataset.mid); if (!g) return;
      const id = g.message_id;
      const rm = e.target.closest('[data-rm]'); const dm = e.target.closest('[data-dismiss]'); const bn = e.target.closest('[data-ban]');
      if (rm) confirmIn(rm, { text: 'Remove this message for everyone? The reports are closed.', yes: 'Remove message', onYes: async () => after(await POST(`/api/admin/reports/${id}/remove`), 'Message removed') });
      if (dm) run(dm, () => POST(`/api/admin/reports/${id}/dismiss`)).then((r) => after(r, g.message.hidden ? 'Dismissed. The message shows again.' : 'Reports dismissed'));
      if (bn) confirmIn(bn, { text: `Ban ${g.author.name}? They are signed out now and cannot sign in again. This message is removed too. You can lift the ban in Customers.`, yes: 'Ban author', onYes: async () => after(await POST(`/api/admin/reports/${id}/ban`), `${g.author.name} is banned`) });
    });
    $('.chips', body).addEventListener('click', (e) => { const b = e.target.closest('[data-st]'); if (!b || b.dataset.st === st.status) return; st.status = b.dataset.st; $$('.chips [data-st]', body).forEach((x) => x.classList.toggle('on', x === b)); history.replaceState(null, '', '#community/reports' + (st.status === 'handled' ? '?status=handled' : '')); list.innerHTML = skelRows(3, 120); load(); });
    on('report', debounce(load, 300));
    await load();
  }

  async function moderationTab(body) {
    let rooms = [];
    try { rooms = (await GET('/api/admin/rooms')).rooms; } catch (e) { body.innerHTML = errorBox(e); return; }
    if (!body.isConnected) return;
    body.innerHTML = `<div class="card flush"><div class="toolbar"><label class="mini-sel"><span>Room</span>${select('room', [['', 'All rooms (latest 60)'], ...rooms.filter((r) => !r.archived).map((r) => [r.id, r.name])], '', { aria: 'Room filter' })}</label><span class="live-note"><i class="live-dot"></i>Updates live</span><button type="button" class="btn btn-w btn-sm" id="modR">${icon('refresh')}Refresh</button></div><div id="modList">${skelRows(6, 70)}</div></div>`;
    const sel = $('select', body);
    const roomName = Object.fromEntries(rooms.map((r) => [r.id, r.name]));
    let seq = 0;
    const load = async () => {
      const my = ++seq;
      try {
        const r = sel.value ? await GET(`/api/admin/rooms/${sel.value}/messages`) : await GET('/api/admin/messages/recent');
        if (my !== seq || !body.isConnected) return;
        const msgs = sel.value ? r.messages.slice().reverse() : r.messages;
        $('#modList', body).innerHTML = msgs.length ? msgs.map((m) => `<div class="mod ${m.deleted ? 'deleted' : ''} ${m.pinned ? 'pinned' : ''}" data-cfm data-id="${m.id}">${av(m.user.avatar, 'md', m.user.name)}<div class="mod-b"><div class="mod-h"><b>${esc(m.user.name)}</b>${m.user.staff ? pill(m.user.role_title || 'Team', 'k') : ''}${m.user.premium ? pill('Premium', 'gold') : ''}<span class="muted">in ${esc(m.room || roomName[m.room_id] || 'room')}</span><time title="${esc(fullDate(m.created_at))}">${timeAgo(m.created_at)}</time>${m.pinned ? `<span class="pin-tag">${icon('pin')}Pinned</span>` : ''}</div>${m.body || m.deleted ? `<p>${m.deleted ? '<em>Deleted</em> ' : ''}${linkify(m.body)}</p>` : ''}${m.attachment && window.VSM ? VSM.thumb(m.attachment, { maxW: 220, maxH: 180 }) : ''}${m.reactions && m.reactions.length ? `<div class="reacts">${m.reactions.map((x) => `<span>${esc(x.emoji)} ${x.n}</span>`).join('')}</div>` : ''}</div>
            ${m.deleted ? '' : `<div class="mod-a"><button type="button" class="btn btn-w btn-xs" data-pin="${m.id}">${icon('pin')}${m.pinned ? 'Unpin' : 'Pin'}</button><button type="button" class="btn btn-danger btn-xs" data-del="${m.id}">${icon('trash')}Delete</button></div>`}</div>`).join('') : empty('chat', 'No messages yet', 'Messages from every room show here so you can pin or remove them.');
      } catch (e) { if (body.isConnected) $('#modList', body).innerHTML = errorBox(e); }
    };
    sel.addEventListener('change', load);
    $('#modR', body).onclick = load;
    $('#modList', body).addEventListener('click', async (e) => {
      const p = e.target.closest('[data-pin]'); const d = e.target.closest('[data-del]');
      if (p) { const r = await run(p, () => POST(`/api/messages/${p.dataset.pin}/pin`), (x) => (x.pinned ? 'Pinned' : 'Unpinned')); if (r) load(); }
      if (d) confirmIn(d, { text: 'Delete this message for everyone?', yes: 'Delete', onYes: async () => { await DEL('/api/messages/' + d.dataset.del); toast('Message deleted'); load(); } });
    });
    const st = VS.stream(['community'], { activity: debounce(load, 400) });
    later(() => st.close());
    load();
  }

  async function rulesTab(body) {
    let cm;
    try { cm = (await GET('/api/admin/settings/community')).value || {}; } catch (e) { body.innerHTML = errorBox(e); return; }
    if (!body.isConnected) return;
    body.innerHTML = `<div class="g2"><form class="card stack" id="ruF"><div class="card-h"><div><h3>Community rules</h3><span class="sub">Shown in every room and when someone joins. Keep each rule to one line.</span></div></div>
      ${listEditor(cm.rules || [], { ph: 'A rule, in one sentence', add: 'Add a rule', aria: 'Rule' })}
      ${field('Welcome message', textarea('welcome', cm.welcome || '', { rows: 3, ph: 'What new members read first' }))}
      <div class="row end"><button type="submit" class="btn btn-g btn-sm">Save rules</button></div></form>
      <div class="card"><div class="card-h"><h3>Preview</h3></div><div class="rules-prev" id="ruP"></div></div></div>`;
    const f = $('#ruF', body);
    const prev = () => { const rules = readList($('.re', f)); $('#ruP', body).innerHTML = `<p class="rp-welcome">${esc($('[name=welcome]', f).value || 'Welcome message')}</p><ol>${rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>`; };
    f.addEventListener('input', prev); prev();
    f.addEventListener('submit', (e) => { e.preventDefault(); run($('button[type=submit]', f), () => saveSetting('community', { ...cm, rules: readList($('.re', f)), welcome: $('[name=welcome]', f).value.trim() }), 'Rules saved'); });
  }

  /* =====================================================================
   * ACADEMY
   * ===================================================================== */
  const GRADS = ['linear-gradient(135deg,#0F2E20,#1E6B47)', 'linear-gradient(135deg,#0A1611,#00774B)', 'linear-gradient(135deg,#1A1446,#5B3FE8)', 'linear-gradient(135deg,#0E1B4D,#2449D8)', 'linear-gradient(135deg,#3B1408,#EE5A2F)', 'linear-gradient(135deg,#3A2A00,#E8AE18)', 'linear-gradient(135deg,#3B0A22,#E8458B)', 'linear-gradient(135deg,#111312,#3A4440)'];
  const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
  const cover = (o, size = '') => `<span class="cover ${size}" style="background:${esc(o.grad || GRADS[0])}"><span class="cover-g"></span><b>${esc(o.mark || (o.title || '?')[0])}</b></span>`;
  const gradPicker = (v) => `<div class="field"><span class="lbl">Cover</span><div class="swatches grads" role="radiogroup" aria-label="Cover gradient">${GRADS.map((g) => `<button type="button" role="radio" aria-checked="${g === v}" aria-label="Gradient" data-g="${esc(g)}" class="${g === v ? 'on' : ''}" style="background:${g}"></button>`).join('')}</div>${input('grad', v, { ph: 'linear-gradient(135deg,#0F2E20,#1E6B47)', aria: 'Custom gradient CSS' })}<span class="hint">Pick one or paste any CSS gradient or colour.</span></div>`;
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.grads [data-g]'); if (!b) return;
    const f = b.closest('.field'); $$('[data-g]', f).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
    const i = $('[name=grad]', f); i.value = b.dataset.g; i.dispatchEvent(new Event('input', { bubbles: true }));
  });

  page('academy', {
    t: 'Academy', i: 'book', perm: () => can('academy'),
    r(el, args) {
      if (args[0] && args[1]) return lessonEditor(el, args[0], args[1]);
      if (args[0]) return courseEditor(el, args[0]);
      return courseGrid(el);
    },
  });

  async function courseGrid(el) {
    el.innerHTML = `${pageHead('Academy', 'Courses and animated lessons. Toggle Premium or Published right on a card.', `<a class="btn btn-g btn-sm" href="#academy/new">${icon('plus')}New course</a>`)}<div id="cg">${skelCards(6, 230)}</div>`;
    let courses;
    const draw = () => {
      $('#cg', el).innerHTML = courses.length ? `<div class="cards">${courses.map((c) => `<div class="course ${c.published ? '' : 'draft'}">
        <a href="#academy/${c.id}" class="course-a">${cover(c)}<span class="course-t"><span class="muted xs mono">${esc(c.track)} · ${esc(c.level)}</span><b>${esc(c.title)}</b><small>${fmt(c.lessons)} lessons · ${fmt(c.learners)} learners · ${esc(c.author_name)}</small></span></a>
        <div class="course-f">${switchField('premium', c.premium, 'Premium')}${switchField('published', c.published, 'Published')}</div></div>`).join('')}</div>` : empty('book', 'No courses yet', 'Create your first course.', '<a class="btn btn-g btn-sm" href="#academy/new">New course</a>');
    };
    try { courses = (await GET('/api/admin/courses')).courses; } catch (e) { $('#cg', el).innerHTML = errorBox(e); return; }
    if (!el.isConnected) return;
    draw();
    $('#cg', el).addEventListener('change', async (e) => {
      const sw = e.target.closest('input[type=checkbox]'); if (!sw) return;
      const card = sw.closest('.course'); const idx = $$('.course', el).indexOf(card); const c = courses[idx];
      const next = { ...c, premium: !!c.premium, published: !!c.published, [sw.name]: sw.checked };
      const r = await run(null, () => POST('/api/admin/courses', next), `${c.title}: ${sw.name === 'premium' ? (sw.checked ? 'now Premium' : 'now free') : (sw.checked ? 'published' : 'hidden')}`);
      if (r) { courses[idx] = { ...c, ...r.course, lessons: c.lessons, learners: c.learners }; card.classList.toggle('draft', !courses[idx].published); } else sw.checked = !sw.checked;
    });
  }

  async function courseEditor(el, cid) {
    const isNew = cid === 'new';
    el.innerHTML = `${backLink('#academy', 'All courses')}<div class="card">${skelRows(4, 50)}</div>`;
    let c, lessons = [];
    try {
      if (isNew) c = { title: '', track: 'Foundations', level: 'Beginner', author_key: 'dchessking', author_name: 'Dchessking', author_role: 'Founder, Zedapex', description: '', grad: GRADS[0], mark: '', premium: 0, published: 0, sort: 0 };
      else { const r = await GET('/api/admin/courses/' + cid); c = r.course; lessons = r.lessons; }
    } catch (e) { el.innerHTML = backLink('#academy', 'All courses') + errorBox(e); return; }
    if (!el.isConnected) return;
    el.innerHTML = `${backLink('#academy', 'All courses')}${pageHead(isNew ? 'New course' : esc(c.title), isNew ? 'Fill in the basics, then add lessons.' : '')}
      <div class="ed-grid">
        <form class="card stack" id="coF" novalidate>
          ${field('Title', input('title', c.title, { ph: 'Traffic Banking 101' }))}
          <div class="g3c">${field('Track', input('track', c.track, { ph: 'Foundations', list: 'trk' }) + '<datalist id="trk"><option value="Foundations"><option value="Tracking"><option value="Creatives"><option value="Scaling"><option value="Telegram"></datalist>')}${field('Level', select('level', LEVELS, c.level))}${field('Sort order', input('sort', c.sort, { type: 'number' }))}</div>
          <div class="g3c">${field('Author', select('author_key', [['dchessking', 'Dchessking'], ['team', 'Zedapex team or guest']], c.author_key))}${field('Author name', input('author_name', c.author_name))}${field('Author role', input('author_role', c.author_role, { ph: 'Founder, Zedapex' }))}</div>
          ${field('Description', textarea('description', c.description, { rows: 3, ph: 'What someone can do after this course' }))}
          ${gradPicker(c.grad)}
          ${field('Cover mark', input('mark', c.mark, { max_len: 4, ph: 'One to four characters' }), 'Shown big on the cover, like ₦ or 01.')}
          <div class="row wrap">${switchField('premium', c.premium, 'Premium course', 'Only Premium members can open it')}${switchField('published', c.published, 'Published', 'Visible in the Academy')}</div>
          <div class="row end sticky-save" data-cfm>${isNew ? '' : `<button type="button" class="btn btn-danger btn-sm" id="delC">${icon('trash')}Delete course</button>`}<button type="submit" class="btn btn-g btn-sm">${isNew ? 'Create course' : 'Save course'}</button></div>
        </form>
        <div class="stack">
          <div class="card prev-card"><span class="muted xs mono">Live preview</span><div id="coP"></div></div>
          ${isNew ? '' : `<div class="card"><div class="card-h"><div><h3>Lessons</h3><span class="sub">Change the order numbers, then save the order.</span></div><div class="r"><button type="button" class="btn btn-w btn-xs" id="saveOrder">Save order</button><button type="button" class="btn btn-g btn-xs" id="addL">${icon('plus')}Add lesson</button></div></div><div id="lsList"></div></div>`}
        </div>
      </div>`;
    const f = $('#coF', el);
    const prev = () => { const v = readForm(f); $('#coP', el).innerHTML = `<div class="course big">${cover(v)}<span class="course-t"><span class="muted xs mono">${esc(v.track)} · ${esc(v.level)}${v.premium ? ' · Premium' : ''}</span><b>${esc(v.title || 'Course title')}</b><small>${esc(v.description || 'Description')}</small><span class="by">${'<span class="av av-sm">' + VS.authorAvatar(v.author_key) + '</span>'}${esc(v.author_name)}<small>${esc(v.author_role)}</small></span></span></div>`; };
    f.addEventListener('input', prev); prev();
    $('[name=author_key]', f).addEventListener('change', (e) => { if (e.target.value === 'dchessking') { $('[name=author_name]', f).value = 'Dchessking'; $('[name=author_role]', f).value = 'Founder, Zedapex'; } else if ($('[name=author_name]', f).value === 'Dchessking') { $('[name=author_name]', f).value = 'Zedapex team'; $('[name=author_role]', f).value = 'Media buyers'; } prev(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(f);
      if (!v.title.trim()) { toast('Give the course a title.', 'err'); return; }
      const r = await run($('button[type=submit]', f), () => POST('/api/admin/courses', { ...v, id: isNew ? undefined : c.id }), isNew ? 'Course created' : 'Course saved');
      if (r && isNew) location.hash = '#academy/' + r.course.id;
    });
    if (isNew) return;
    const dc = $('#delC', el);
    dc.onclick = () => confirmIn(dc, { text: `Delete "${c.title}" with all ${lessons.length} lessons and everyone's progress? This cannot be undone.`, yes: 'Delete course', typed: 'DELETE', onYes: async () => { await DEL('/api/admin/courses/' + c.id); toast('Course deleted'); location.hash = '#academy'; } });
    const drawL = () => {
      $('#lsList', el).innerHTML = lessons.length ? `<div class="lessons">${lessons.map((l) => `<div class="les" data-id="${l.id}" data-cfm><input class="inp idx" type="number" value="${l.idx}" aria-label="Order of ${esc(l.title)}"><a class="les-t" href="#academy/${c.id}/${l.id}"><b>${esc(l.title)}</b><small>${l.minutes} min · ${l.steps.length} steps${l.quiz ? ' · quiz' : ''}</small></a><span class="pills">${l.premium ? pill('Premium', 'gold') : ''}${l.published ? '' : pill('Draft', 'w')}</span><a class="btn btn-w btn-xs" href="#academy/${c.id}/${l.id}">${icon('pen')}Edit</a><button type="button" class="ib2" data-dl="${l.id}" aria-label="Delete ${esc(l.title)}">${icon('trash')}</button></div>`).join('')}</div>` : empty('book', 'No lessons yet', 'Add the first lesson.');
    };
    drawL();
    $('#lsList', el).addEventListener('click', (e) => {
      const d = e.target.closest('[data-dl]'); if (!d) return;
      const l = lessons.find((x) => x.id === Number(d.dataset.dl));
      confirmIn(d, { text: `Delete "${l.title}"? Progress on it is removed too.`, yes: 'Delete lesson', onYes: async () => { await DEL('/api/admin/lessons/' + l.id); lessons = lessons.filter((x) => x !== l); drawL(); toast('Lesson deleted'); } });
    });
    $('#saveOrder', el).onclick = async (e) => {
      const changed = $$('.les', el).map((row) => { const l = lessons.find((x) => x.id === Number(row.dataset.id)); return [l, Number($('.idx', row).value) || 0]; }).filter(([l, i]) => l.idx !== i);
      if (!changed.length) { toast('The order has not changed.'); return; }
      const r = await run(e.currentTarget, () => Promise.all(changed.map(([l, i]) => POST('/api/admin/lessons', { ...l, idx: i, premium: !!l.premium, published: !!l.published }))), 'Order saved');
      if (r) { changed.forEach(([l, i]) => { l.idx = i; }); lessons.sort((a, b) => a.idx - b.idx || a.id - b.id); drawL(); }
    };
    $('#addL', el).onclick = async (e) => {
      const idx = lessons.length ? Math.max(...lessons.map((l) => l.idx)) + 1 : 0;
      const r = await run(e.currentTarget, () => POST('/api/admin/lessons', { course_id: c.id, title: 'New lesson', minutes: 5, idx, published: false, steps: [{ v: 'big', h: 'The one idea of this lesson', p: 'Say it in one or two sentences, as you would out loud.', d: { b: 'One big idea', s: 'A short line under it' } }], takeaways: [] }), 'Lesson added');
      if (r) location.hash = `#academy/${c.id}/${r.lesson.id}`;
    };
  }

  /* ----- lesson editor ----- */
  const STEP_DEFAULTS = {
    big: { b: 'One big idea', s: 'A short line under it' },
    stat: { n: 2.5, pre: '$', suf: '', dec: 2, label: 'cost per real join', note: 'Example' },
    flow: ['Click', 'Join', 'Deposit'],
    eq: ['$500', '÷', '250 joins', '=', '$2.00'],
    check: ['First thing to check', 'Second thing to check'],
    quote: 'Write the line here.',
    bars: [['Meta', 80, '80%'], ['TikTok', 45, '45%']],
    funnel: [['Clicks', 1000], ['Joined', 410], ['Deposited', 22]],
    cards: ['Title|short line', 'Title|short line', 'Title|short line'],
    curve: { a: [3.1, 2.8, 2.2, 1.6, 1.2], b: [1.2, 1.8, 2.6, 3.4, 4.1], la: 'CTR %', lb: 'Frequency', x: ['D1', 'D2', 'D3', 'D4', 'D5'] },
    compare: { a: { title: 'Before', items: ['Point one', 'Point two'] }, b: { title: 'After', items: ['Point one', 'Point two'] } },
    chat: [{ from: 'lead', text: 'How much is it?' }, { from: 'ai', text: 'It is $20 a month. Want the link?' }],
  };
  const TYPE_LABEL = { big: 'Big line', stat: 'Big number', flow: 'Flow', eq: 'Equation', check: 'Checklist', quote: 'Quote', bars: 'Bars', funnel: 'Funnel', cards: 'Cards', curve: 'Curve chart', compare: 'Before and after', chat: 'Chat' };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const fitsType = (t, d) => {
    if (d == null) return false;
    if (['flow', 'eq', 'check', 'cards'].includes(t)) return Array.isArray(d) && d.every((x) => typeof x === 'string' || typeof x === 'number');
    if (['bars', 'funnel'].includes(t)) return Array.isArray(d) && d.every(Array.isArray);
    if (t === 'chat') return Array.isArray(d) && d.every((x) => x && typeof x === 'object' && !Array.isArray(x));
    if (t === 'quote') return typeof d === 'string';
    if (t === 'curve') return typeof d === 'object' && Array.isArray(d.a);
    if (t === 'compare') return typeof d === 'object' && d.a && d.b;
    return typeof d === 'object' && !Array.isArray(d);
  };

  function stepDataEditor(s) {
    const d = s.d;
    const f = (k, label, o = {}) => field(label, `<input class="inp" data-d="${k}" type="${o.type || 'text'}"${o.step ? ` step="${o.step}"` : ''} value="${esc(d[k] ?? '')}" placeholder="${esc(o.ph || '')}">`, o.hint || '');
    switch (s.v) {
      case 'big': return f('b', 'Big line') + f('s', 'Small line');
      case 'stat': return `<div class="g3c">${f('n', 'Number', { type: 'number', step: 'any' })}${f('pre', 'Before', { ph: '$' })}${f('suf', 'After', { ph: '%' })}</div><div class="g3c">${f('dec', 'Decimals', { type: 'number' })}${f('label', 'Label')}${f('note', 'Note', { hint: 'Write Example for made-up numbers.' })}</div>`;
      case 'flow': return `<div class="field"><span class="lbl">Steps, left to right</span>${listEditor(d, { ph: 'Step', add: 'Add step' })}<span class="hint">The last one is highlighted.</span></div>`;
      case 'eq': return `<div class="field"><span class="lbl">Parts of the equation</span>${listEditor(d, { ph: 'Value or ÷ × + − → =', add: 'Add part' })}<span class="hint">Use ÷ × + − → = as their own parts. The last value is highlighted.</span></div>`;
      case 'check': return `<div class="field"><span class="lbl">Checklist</span>${listEditor(d, { ph: 'Item', add: 'Add item' })}</div>`;
      case 'cards': return `<div class="field"><span class="lbl">Cards</span>${rowsEditor(d.map((x) => String(x).split('|')), [{ ph: 'Title' }, { ph: 'Short line' }], { add: 'Add card' })}</div>`;
      case 'bars': return `<div class="field"><span class="lbl">Bars</span>${rowsEditor(d, [{ ph: 'Label' }, { ph: '0-100', type: 'number', w: '84px', aria: 'Bar length 0 to 100' }, { ph: 'Shown value', w: '110px' }], { add: 'Add bar' })}<span class="hint">Length runs from 0 to 100. The chart is labelled Illustration.</span></div>`;
      case 'funnel': return `<div class="field"><span class="lbl">Funnel</span>${rowsEditor(d, [{ ph: 'Stage' }, { ph: 'Count', type: 'number', w: '110px' }], { add: 'Add stage' })}</div>`;
      case 'quote': return field('Quote', `<textarea class="inp" data-d="text" rows="3">${esc(d)}</textarea>`) + field('By', `<input class="inp" data-d="by" value="${esc(s.by || 'dchessking')}">`, 'Write dchessking for the founder, or any name.');
      default: return field('Data (JSON)', `<textarea class="inp mono-ta" data-d="json" rows="9" spellcheck="false">${esc(JSON.stringify(d, null, 2))}</textarea>`, s.v === 'curve' ? 'a and b are the two lines, la and lb their labels, x the day labels.' : s.v === 'compare' ? 'a and b each have a title and a list of items.' : 'Each message has from (lead, ai, you or paid) and text.') + '<p class="err" data-jerr></p>';
    }
  }
  function readStepData(s, root) {
    const g = (k) => { const i = $(`[data-d="${k}"]`, root); return i ? i.value : ''; };
    switch (s.v) {
      case 'big': return { d: { b: g('b'), s: g('s') } };
      case 'stat': return { d: { n: Number(g('n')) || 0, pre: g('pre'), suf: g('suf'), dec: Number(g('dec')) || 0, label: g('label'), note: g('note') } };
      case 'flow': case 'eq': case 'check': return { d: readList($('.re', root)) };
      case 'cards': return { d: readRows($('.re', root)).filter((r) => r[0]).map((r) => (r[1] ? `${r[0]}|${r[1]}` : r[0])) };
      case 'bars': return { d: readRows($('.re', root)).filter((r) => r[0]).map((r) => [r[0], Math.max(0, Math.min(100, r[1])), r[2]]) };
      case 'funnel': return { d: readRows($('.re', root)).filter((r) => r[0]).map((r) => [r[0], r[1]]) };
      case 'quote': return { d: g('text'), by: g('by').trim() || 'dchessking' };
      default: {
        const err = $('[data-jerr]', root);
        try { const d = JSON.parse(g('json')); if (!fitsType(s.v, d)) throw new Error('This data does not match the ' + TYPE_LABEL[s.v] + ' shape.'); err.textContent = ''; return { d }; }
        catch (e) { err.textContent = e.message.startsWith('This data') ? e.message : 'Not valid JSON yet: ' + e.message; return null; }
      }
    }
  }

  async function lessonEditor(el, cid, lid) {
    el.innerHTML = `${backLink('#academy/' + cid, 'Back to course')}<div class="card">${skelRows(5, 50)}</div>`;
    let course, L;
    try { const r = await GET('/api/admin/courses/' + cid); course = r.course; L = r.lessons.find((l) => l.id === Number(lid)); } catch (e) { el.innerHTML = backLink('#academy', 'All courses') + errorBox(e); return; }
    if (!el.isConnected) return;
    if (!L) { el.innerHTML = backLink('#academy/' + cid, 'Back to course') + empty('book', 'Lesson not found', 'It may have been deleted.'); return; }
    L = clone(L);
    L.steps = (L.steps || []).map((s) => ({ v: VSL.TYPES.includes(s.v) ? s.v : 'big', h: s.h || '', p: s.p || '', d: fitsType(s.v, s.d) ? s.d : clone(STEP_DEFAULTS[VSL.TYPES.includes(s.v) ? s.v : 'big']), ...(s.by ? { by: s.by } : {}) }));
    const q = L.quiz || {};
    const quiz = { on: !!(q && q.q), q: q.q || '', options: [0, 1, 2, 3].map((i) => (q.options || q.o || q.choices || [])[i] || ''), answer: Number(q.answer ?? q.a ?? q.correct ?? 0) || 0, why: q.why || q.explain || q.explanation || '' };
    let sel = 0; let dirty = false;
    el.innerHTML = `${backLink('#academy/' + cid, esc(course.title))}
      <div class="ph"><div class="ph-t"><h2 id="lsTitle">${esc(L.title)}</h2><p>${esc(course.title)} · lesson editor</p></div><div class="ph-r"><span class="dirty" id="dirty" hidden>Unsaved changes</span><button type="button" class="btn btn-g btn-sm" id="saveL">Save lesson</button></div></div>
      <div class="le-grid">
        <div class="stack">
          <form class="card stack" id="lmF" novalidate><div class="g3c">${field('Title', input('title', L.title), '', 'span2')}${field('Minutes', input('minutes', L.minutes, { type: 'number', min: 1 }))}</div>
            <div class="row wrap">${field('Order', input('idx', L.idx, { type: 'number', cls: 'w90' }))}${switchField('premium', L.premium, 'Premium lesson')}${switchField('published', L.published, 'Published')}</div></form>
          <div class="card"><div class="card-h"><div><h3>Steps</h3><span class="sub">Each step is one animated screen with narration.</span></div><div class="r"><button type="button" class="btn btn-w btn-xs" id="addS">${icon('plus')}Add step</button></div></div><div class="steps" id="stList"></div></div>
          <div class="card stack" id="stEd"></div>
        </div>
        <div class="stack le-side">
          <div class="card prev-card stick"><div class="card-h"><h3>Preview</h3><span class="sub" id="pvN"></span><div class="r"><button type="button" class="btn btn-ghost btn-xs" id="replay">${icon('refresh')}Replay</button></div></div><div class="vl-stage" id="stage"></div><div class="pv-cap"><b id="pvH"></b><p id="pvP"></p></div></div>
          <form class="card stack" id="lxF" novalidate>
            <div class="field"><span class="lbl">Takeaways</span>${listEditor(L.takeaways, { ph: 'One thing to remember', add: 'Add takeaway' })}</div>
            ${field('Action', textarea('action', L.action, { rows: 2, ph: 'One thing to do after the lesson' }))}
            <div class="quiz-ed">${switchField('quiz_on', quiz.on, 'Quiz at the end')}
              <div class="quiz-f stack"${quiz.on ? '' : ' hidden'}>${field('Question', input('quiz_q', quiz.q))}
                <div class="field"><span class="lbl">Options (pick the right one)</span>${quiz.options.map((o, i) => `<div class="qo"><input type="radio" name="quiz_answer" value="${i}" aria-label="Option ${i + 1} is correct"${quiz.answer === i ? ' checked' : ''}><input class="inp" name="quiz_o${i}" value="${esc(o)}" placeholder="Option ${i + 1}" aria-label="Option ${i + 1}"></div>`).join('')}</div>
                ${field('Why it is right', textarea('quiz_why', quiz.why, { rows: 2 }))}</div></div>
          </form>
        </div>
      </div>`;
    const stage = $('#stage', el);
    const setDirty = () => { dirty = true; $('#dirty', el).hidden = false; };
    const preview = () => {
      const s = L.steps[sel];
      $('#pvN', el).textContent = s ? `Step ${sel + 1} of ${L.steps.length}` : '';
      if (!s) { stage.innerHTML = '<div class="vl-big"><b>No steps</b></div>'; $('#pvH', el).textContent = ''; $('#pvP', el).textContent = ''; return; }
      stage.innerHTML = VSL.render(s);
      VSL.animate(stage);
      $('#pvH', el).textContent = s.h; $('#pvP', el).textContent = s.p;
    };
    const drawList = () => {
      $('#stList', el).innerHTML = L.steps.length ? L.steps.map((s, i) => `<div class="step ${i === sel ? 'on' : ''}" data-i="${i}"><button type="button" class="step-b" data-pick="${i}"><span class="step-n">${i + 1}</span><span class="step-t"><b>${esc(s.h || 'Untitled step')}</b><small>${esc(TYPE_LABEL[s.v] || s.v)}</small></span></button><span class="re-act"><button type="button" class="ib2" data-mv="-1" aria-label="Move step up">${icon('up')}</button><button type="button" class="ib2" data-mv="1" aria-label="Move step down">${icon('down')}</button><button type="button" class="ib2" data-dup aria-label="Duplicate step">${icon('copy')}</button><button type="button" class="ib2" data-rm aria-label="Remove step">${icon('x')}</button></span></div>`).join('') : empty('layers', 'No steps yet', 'Add the first step.');
    };
    const drawEditor = () => {
      const s = L.steps[sel];
      const ed = $('#stEd', el);
      if (!s) { ed.innerHTML = '<p class="muted">Select or add a step to edit it.</p>'; return; }
      ed.innerHTML = `<div class="card-h"><h3>Step ${sel + 1}</h3></div>
        <div class="g2c">${field('Visual', `<select class="inp" id="stType">${VSL.TYPES.map((t) => `<option value="${t}"${t === s.v ? ' selected' : ''}>${esc(TYPE_LABEL[t] || t)}</option>`).join('')}</select>`)}${field('Heading', `<input class="inp" id="stH" value="${esc(s.h)}" placeholder="What this step says">`)}</div>
        ${field('Narration', `<textarea class="inp" id="stP" rows="3" placeholder="What the narrator says on this screen">${esc(s.p)}</textarea>`)}
        <div class="st-data" id="stData">${stepDataEditor(s)}</div>`;
      $('#stType', el).addEventListener('change', (e) => { const t = e.target.value; s.v = t; if (!fitsType(t, s.d)) s.d = clone(STEP_DEFAULTS[t]); if (t !== 'quote') delete s.by; $('#stData', el).innerHTML = stepDataEditor(s); setDirty(); drawList(); preview(); });
    };
    const livePreview = debounce(preview, 260);
    $('#stEd', el).addEventListener('input', (e) => {
      const s = L.steps[sel]; if (!s) return;
      if (e.target.id === 'stType') return;
      s.h = $('#stH', el).value; s.p = $('#stP', el).value;
      const r = readStepData(s, $('#stData', el));
      if (r) { s.d = r.d; if (r.by !== undefined) s.by = r.by; }
      setDirty();
      const row = $(`.step[data-i="${sel}"] .step-t b`, el); if (row) row.textContent = s.h || 'Untitled step';
      if (e.target.id === 'stP' || e.target.id === 'stH') { $('#pvH', el).textContent = s.h; $('#pvP', el).textContent = s.p; if (e.target.id === 'stP') return; }
      livePreview();
    });
    $('#stList', el).addEventListener('click', (e) => {
      const row = e.target.closest('.step'); if (!row) return;
      const i = Number(row.dataset.i);
      if (e.target.closest('[data-pick]')) { sel = i; }
      else if (e.target.closest('[data-mv]')) { const j = i + Number(e.target.closest('[data-mv]').dataset.mv); if (j < 0 || j >= L.steps.length) return; [L.steps[i], L.steps[j]] = [L.steps[j], L.steps[i]]; sel = j; setDirty(); }
      else if (e.target.closest('[data-dup]')) { L.steps.splice(i + 1, 0, clone(L.steps[i])); sel = i + 1; setDirty(); }
      else if (e.target.closest('[data-rm]')) { L.steps.splice(i, 1); sel = Math.max(0, Math.min(sel, L.steps.length - 1)); setDirty(); }
      drawList(); drawEditor(); preview();
    });
    $('#addS', el).onclick = () => { L.steps.splice(sel + 1, 0, { v: 'big', h: '', p: '', d: clone(STEP_DEFAULTS.big) }); sel = Math.min(sel + 1, L.steps.length - 1); if (L.steps.length === 1) sel = 0; setDirty(); drawList(); drawEditor(); preview(); $('#stH', el).focus(); };
    $('#replay', el).onclick = preview;
    $('#lmF', el).addEventListener('input', (e) => { setDirty(); if (e.target.name === 'title') $('#lsTitle', el).textContent = e.target.value || 'Untitled lesson'; });
    $('#lxF', el).addEventListener('input', setDirty);
    $('[name=quiz_on]', el).addEventListener('change', (e) => { $('.quiz-f', el).hidden = !e.target.checked; });
    $('#saveL', el).onclick = async (e) => {
      const m = readForm($('#lmF', el)); const x = readForm($('#lxF', el));
      if (!m.title.trim()) { toast('Give the lesson a title.', 'err'); return; }
      if ($('[data-jerr]', el) && $('[data-jerr]', el).textContent) { toast('Fix the step data first.', 'err'); return; }
      let qz = null;
      if (x.quiz_on) {
        const options = [0, 1, 2, 3].map((i) => x['quiz_o' + i].trim());
        if (!x.quiz_q.trim() || options.some((o) => !o)) { toast('The quiz needs a question and 4 options.', 'err'); return; }
        qz = { q: x.quiz_q.trim(), options, answer: Number(x.quiz_answer) || 0, why: x.quiz_why.trim() };
      }
      const body = { id: L.id, course_id: L.course_id, title: m.title, minutes: m.minutes, idx: m.idx, premium: m.premium, published: m.published, steps: L.steps, takeaways: readList($('#lxF .re', el)), action: x.action, quiz: qz };
      const r = await run(e.currentTarget, () => POST('/api/admin/lessons', body), 'Lesson saved');
      if (r) { dirty = false; $('#dirty', el).hidden = true; }
    };
    const warn = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    later(() => window.removeEventListener('beforeunload', warn));
    drawList(); drawEditor(); preview();
  }

  /* =====================================================================
   * BLOG
   * ===================================================================== */
  const bodyToText = (b) => (Array.isArray(b) ? b : []).map(([t, v]) => (t === 'h' ? '## ' + v : t === 'q' ? '> ' + v : t === 'ul' ? (Array.isArray(v) ? v : [v]).map((x) => '- ' + x).join('\n') : v)).join('\n\n');
  const textToBlocks = (s) => String(s || '').split(/\n{2,}/).map((blk) => { blk = blk.trim(); if (blk.startsWith('## ')) return ['h', blk.slice(3)]; if (blk.startsWith('> ')) return ['q', blk.slice(2)]; if (/^- /m.test(blk) && blk.split('\n').every((l) => l.startsWith('- '))) return ['ul', blk.split('\n').map((l) => l.slice(2))]; return ['p', blk]; }).filter((x) => x[1] && x[1].length);
  const blocksHtml = (bl) => bl.map(([t, v]) => (t === 'h' ? `<h3>${esc(v)}</h3>` : t === 'q' ? `<blockquote>${esc(v)}</blockquote>` : t === 'ul' ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p>${linkify(v)}</p>`)).join('');

  page('blog', {
    t: 'Blog', i: 'pen', perm: () => can('blog'),
    async r(el, args) {
      if (args[0]) return postEditor(el, args[0]);
      el.innerHTML = `${pageHead('Blog', 'Posts for the Voo Blog. The featured post leads the blog page.', `<a class="btn btn-g btn-sm" href="#blog/new">${icon('plus')}New post</a>`)}<div class="card flush" id="pl">${skelRows(6, 64)}</div>`;
      let posts;
      try { posts = (await GET('/api/admin/posts')).posts; } catch (e) { $('#pl', el).innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      $('#pl', el).innerHTML = posts.length ? posts.map((p) => `<a class="post-r" href="#blog/${p.id}">${cover(p, 'sm')}<span class="post-t"><b>${esc(p.title)}</b><small>${esc(p.category)} · ${esc(p.author_name)} · ${dateStr(p.created_at)} · ${p.minutes} min</small></span><span class="pills">${p.featured ? pill('Featured', 'l') : ''}${p.premium ? pill('Premium', 'gold') : ''}${p.published ? pill('Published', 'g') : pill('Draft', 'w')}</span></a>`).join('') : empty('pen', 'No posts yet', 'Write the first one.', '<a class="btn btn-g btn-sm" href="#blog/new">New post</a>');
    },
  });

  async function postEditor(el, pid) {
    const isNew = pid === 'new';
    el.innerHTML = `${backLink('#blog', 'All posts')}<div class="card">${skelRows(5, 50)}</div>`;
    let p, cats = [];
    try {
      const all = (await GET('/api/admin/posts')).posts;
      cats = [...new Set(['Playbook', 'News', 'Tracking', 'Creatives', 'Scaling', ...all.map((x) => x.category)])];
      p = isNew ? { title: '', category: 'Playbook', author_key: 'dchessking', author_name: 'Dchessking', author_role: 'Founder, Zedapex', excerpt: '', minutes: 4, grad: GRADS[0], mark: '', body: [], premium: 0, published: 0, featured: 0 } : all.find((x) => x.id === Number(pid));
    } catch (e) { el.innerHTML = backLink('#blog', 'All posts') + errorBox(e); return; }
    if (!el.isConnected) return;
    if (!p) { el.innerHTML = backLink('#blog', 'All posts') + empty('pen', 'Post not found'); return; }
    el.innerHTML = `${backLink('#blog', 'All posts')}${pageHead(isNew ? 'New post' : 'Edit post', '')}
      <div class="ed-grid">
        <form class="card stack" id="poF" novalidate>
          ${field('Title', input('title', p.title, { ph: 'A specific, useful headline' }))}
          <div class="g3c">${field('Category', input('category', p.category, { list: 'pcats' }) + `<datalist id="pcats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`)}${field('Minutes to read', input('minutes', p.minutes, { type: 'number', min: 1 }))}${field('Author', select('author_key', [['dchessking', 'Dchessking'], ['team', 'Team member or guest']], p.author_key))}</div>
          <div class="g2c">${field('Author name', input('author_name', p.author_name))}${field('Author role', input('author_role', p.author_role, { ph: 'Founder, Zedapex' }))}</div>
          ${field('Excerpt', textarea('excerpt', p.excerpt, { rows: 2, ph: 'One or two sentences for the card' }))}
          <div class="g2c">${gradPicker(p.grad)}${field('Cover mark', input('mark', p.mark, { max_len: 4 }), 'One to four characters.')}</div>
          ${field('Body', textarea('body', bodyToText(p.body), { rows: 16, cls: 'body-ta' }), 'Blank line = new paragraph. Start a block with "## " for a heading, "> " for a pull quote, "- " on each line for a list.')}
          <div class="row wrap">${switchField('published', p.published, 'Published')}${switchField('premium', p.premium, 'Premium', 'Non-members see the first two blocks')}${switchField('featured', p.featured, 'Featured', 'Replaces the current featured post')}</div>
          <div class="row end sticky-save" data-cfm>${isNew ? '' : `<button type="button" class="btn btn-danger btn-sm" id="delP">${icon('trash')}Delete</button>`}<button type="submit" class="btn btn-g btn-sm">${isNew ? 'Create post' : 'Save post'}</button></div>
        </form>
        <div class="card prev-card stick"><span class="muted xs mono">Live preview</span><article class="post-prev" id="poP"></article></div>
      </div>`;
    const f = $('#poF', el);
    const prev = () => { const v = readForm(f); $('#poP', el).innerHTML = `<div class="pp-cover" style="background:${esc(v.grad || GRADS[0])}"><b>${esc(v.mark || (v.title || 'V')[0])}</b></div><span class="kick">${esc(v.category)}</span><h2>${esc(v.title || 'Post title')}</h2><p class="pp-ex">${esc(v.excerpt)}</p><div class="by"><span class="av av-sm">${VS.authorAvatar(v.author_key)}</span><span><b>${esc(v.author_name)}</b><small>${esc(v.author_role)} · ${v.minutes || 1} min read</small></span></div><div class="pp-body">${blocksHtml(textToBlocks(v.body)) || '<p class="muted">The body shows here as you type.</p>'}</div>`; };
    f.addEventListener('input', debounce(prev, 150)); prev();
    $('[name=author_key]', f).addEventListener('change', (e) => { if (e.target.value === 'dchessking') { $('[name=author_name]', f).value = 'Dchessking'; $('[name=author_role]', f).value = 'Founder, Zedapex'; } else if ($('[name=author_name]', f).value === 'Dchessking') { $('[name=author_name]', f).value = 'Zedapex team'; $('[name=author_role]', f).value = 'Media buyers'; } prev(); });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(f);
      if (!v.title.trim()) { toast('Give the post a title.', 'err'); return; }
      const r = await run($('button[type=submit]', f), () => POST('/api/admin/posts', { ...v, id: isNew ? undefined : p.id }), isNew ? 'Post created' : 'Post saved');
      if (r && isNew) location.hash = '#blog/' + r.post.id;
    });
    const dp = $('#delP', el);
    if (dp) dp.onclick = () => confirmIn(dp, { text: `Delete "${p.title}"? This cannot be undone.`, yes: 'Delete post', onYes: async () => { await DEL('/api/admin/posts/' + p.id); toast('Post deleted'); location.hash = '#blog'; } });
  }

  /* =====================================================================
   * PRODUCTS & INTEGRATIONS
   * ===================================================================== */
  const STAGES = ['Hub', 'Research', 'Monetize', 'Acquire', 'Track', 'Convert', 'Retain', 'Collect'];
  const PSTATUS = [['live', 'Live'], ['new', 'New'], ['beta', 'Beta'], ['soon', 'Coming soon']];
  const statusTag = (s) => pill((PSTATUS.find((x) => x[0] === s) || [s, s])[1], s === 'live' ? 'g' : s === 'new' ? 'l' : s === 'beta' ? 'b' : 'w');

  page('products', {
    t: 'Products', i: 'grid', perm: () => can('products'),
    r(el, args) { return args[0] ? productEditor(el, args[0]) : productGrid(el); },
  });

  async function productGrid(el) {
    el.innerHTML = `${pageHead('Products and integrations', 'Every Voo tool, how it shows in VooSquare and how it connects for login, events and support.', `<a class="btn btn-g btn-sm" href="#products/new">${icon('plus')}Add product</a>`)}<div id="pg">${skelCards(8, 190)}</div>`;
    let list;
    try {
      list = (await GET('/api/admin/products')).products;
      const stats = await Promise.all(list.map((p) => GET('/api/admin/products/' + p.id).then((r) => r.stats).catch(() => null)));
      list.forEach((p, i) => { p.stats = stats[i]; });
    } catch (e) { $('#pg', el).innerHTML = errorBox(e); return; }
    if (!el.isConnected) return;
    $('#pg', el).innerHTML = `<div class="cards">${list.map((p, i) => `<a class="prod ${p.visible ? '' : 'hidden-p'}" href="#products/${p.id}" style="--tint:${esc(p.tint || '#E7F8F0')};animation-delay:${i * 40}ms">
      <span class="prod-h">${productIcon(p, 'lg')}<span class="pills">${statusTag(p.status)}${p.hub ? pill('Hub', 'k') : ''}</span></span>
      <b>${esc(p.name)}</b><span class="muted xs mono">${esc(p.stage || 'No stage')}</span><small class="prod-tag">${esc(p.tagline || '')}</small>
      <span class="prod-f"><span title="Shown to members">${icon(p.visible ? 'eye' : 'lock')}${p.visible ? 'Visible' : 'Hidden'}</span><span>${icon('id')}SSO ${p.sso ? 'on' : 'off'}</span><span>${icon('inbox')}${p.stats ? p.stats.tickets_open : '-'} open</span><span>${icon('spark')}${p.stats ? fmt(p.stats.events_7d) : '-'} events 7d</span></span></a>`).join('')}</div>`;
  }

  async function productEditor(el, pid) {
    const isNew = pid === 'new';
    el.innerHTML = `${backLink('#products', 'All products')}<div class="card">${skelRows(5, 50)}</div>`;
    let p, stats = {}, events = [], stages = STAGES;
    try {
      const all = (await GET('/api/admin/products')).products;
      stages = [...new Set([...STAGES, ...all.map((x) => x.stage).filter(Boolean)])];
      if (isNew) p = { name: '', slug: '', stage: 'Acquire', status: 'soon', tagline: '', description: '', url: '', icon: '', color: '#00A86B', tint: '#E7F8F0', offer: '', sort: all.length, visible: 1, external: 0, sso: 0, redirect_uris: [], launch_path: '', summary_url: '', support_webhook: '', support_greeting: '' };
      else {
        const [r, ev] = await Promise.all([GET('/api/admin/products/' + pid), GET('/api/admin/events').catch(() => ({ events: [] }))]);
        p = r.product; stats = r.stats; events = ev.events.filter((e) => e.product_id === p.id).slice(0, 20);
      }
    } catch (e) { el.innerHTML = backLink('#products', 'All products') + errorBox(e); return; }
    if (!el.isConnected) return;
    const iconKeys = Object.keys(VS.PI);
    const isUrl = p.icon && !iconKeys.includes(p.icon);
    const draw = () => {
      el.innerHTML = `${backLink('#products', 'All products')}${pageHead(isNew ? 'Add a product' : esc(p.name), isNew ? 'New tools show in the hub with whatever you set here.' : `Slug ${p.slug}`)}
      <div class="ed-grid">
        <form class="card stack" id="prF" novalidate>
          <div class="g2c">${field('Name', input('name', p.name, { ph: 'Vooads' }))}${isNew ? field('Slug', input('slug', '', { ph: 'Made from the name if empty' }), 'Used in widget and login links. Cannot change later.') : field('Sort order', input('sort', p.sort, { type: 'number' }))}</div>
          <div class="g3c">${field('Stage', input('stage', p.stage, { list: 'stg' }) + `<datalist id="stg">${stages.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`, 'Pick one or type a new stage.')}${field('Status', select('status', PSTATUS, p.status))}${field('Offer', input('offer', p.offer, { ph: 'First 500 joins free' }))}</div>
          ${isNew ? field('Sort order', input('sort', p.sort, { type: 'number' })) : ''}
          ${field('Tagline', input('tagline', p.tagline, { ph: 'One line on what it does' }))}
          ${field('Description', textarea('description', p.description, { rows: 3 }))}
          ${field('Website URL', input('url', p.url, { type: 'url', ph: 'https://' }))}
          <div class="field"><span class="lbl">Icon</span><div class="pick-pi" role="radiogroup" aria-label="Icon">${iconKeys.map((k) => `<button type="button" role="radio" data-k="${k}" aria-label="${k}" aria-checked="${p.icon === k}" class="${p.icon === k ? 'on' : ''}">${productIcon({ icon: k }, 'md')}</button>`).join('')}<button type="button" role="radio" data-k="__url" aria-checked="${!!isUrl}" class="url-b ${isUrl ? 'on' : ''}">${icon('image')}Image URL</button></div>
            <input class="inp mt-s" name="icon_url" value="${esc(isUrl ? p.icon : '')}" placeholder="https://.../icon.png or /assets/icons/name.svg" aria-label="Icon image URL"${isUrl ? '' : ' hidden'}><input type="hidden" name="icon" value="${esc(isUrl ? '__url' : p.icon)}"></div>
          <div class="g2c">${field('Brand colour', `<span class="colr"><input type="color" name="color" value="${esc(/^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#00A86B')}" aria-label="Brand colour"><input class="inp" data-mirror="color" value="${esc(p.color)}" aria-label="Brand colour hex"></span>`)}${field('Tint', `<span class="colr"><input type="color" name="tint" value="${esc(/^#[0-9a-f]{6}$/i.test(p.tint) ? p.tint : '#E7F8F0')}" aria-label="Tint colour"><input class="inp" data-mirror="tint" value="${esc(p.tint)}" aria-label="Tint hex"></span>`, 'Light background used on cards.')}</div>
          <div class="row wrap">${switchField('visible', p.visible, 'Visible to members')}${switchField('external', p.external, 'External site', 'Opens in a new tab')}${switchField('sso', p.sso, 'Continue with VooSquare', 'The tool signs people in with their Voo ID')}</div>
          ${field('Allowed redirect URIs', textarea('redirect_uris', (p.redirect_uris || []).join('\n'), { rows: 3, ph: 'https://app.tool.com/auth/voosquare/callback' }), 'One per line. End with * to allow a prefix. If empty, any URL on the website origin is allowed.')}
          ${field('Launch path', input('launch_path', p.launch_path || '', { ph: '/dashboard' }), 'The page inside the tool that "Open" lands on after login (URL/auth/voosquare?return_to=this path). Empty = /dashboard.')}
          ${field('Summary URL', input('summary_url', p.summary_url, { type: 'url', ph: 'https://api.tool.com/voosquare/summary' }), 'VooSquare calls this with voo_id to show live numbers on the member dashboard.')}
          ${field('Support webhook URL', input('support_webhook', p.support_webhook, { type: 'url', ph: 'https://api.tool.com/hooks/voosquare' }), 'We POST staff replies here so the tool can show them in its own chat.')}
          ${field('Support greeting', input('support_greeting', p.support_greeting, { ph: `Hi! Ask us anything about ${p.name || 'this tool'}. A real person answers.` }), 'First line in the support widget.')}
          <div class="row end sticky-save" data-cfm>${!isNew && !p.hub ? `<button type="button" class="btn btn-danger btn-sm" id="hideP">${icon('lock')}Hide product</button>` : ''}<button type="submit" class="btn btn-g btn-sm">${isNew ? 'Create product' : 'Save product'}</button></div>
        </form>
        <div class="stack">
          <div class="card prev-card"><span class="muted xs mono">How members see it</span><div id="prP"></div></div>
          ${isNew ? '<div class="card"><p class="muted">Keys, the widget snippet and the login endpoints appear here after you create the product.</p></div>' : `
          <div class="card"><div class="card-h"><div><h3>Credentials</h3><span class="sub">Keep the secret and the API key on the tool's server only.</span></div></div>
            <div class="creds" data-cfm>
              <div class="cred"><span class="lbl">Client ID</span><code>${esc(p.client_id)}</code><button type="button" class="ib2" data-copy="${esc(p.client_id)}" aria-label="Copy client ID">${icon('copy')}</button></div>
              <div class="cred"><span class="lbl">Client secret</span><code class="secret">${esc(p.client_secret)}</code><button type="button" class="ib2" data-copy="${esc(p.client_secret)}" aria-label="Copy client secret">${icon('copy')}</button><button type="button" class="btn btn-w btn-xs" data-rot="secret">${icon('refresh')}Rotate</button></div>
              <div class="cred"><span class="lbl">API key</span><code class="secret">${esc(p.api_key)}</code><button type="button" class="ib2" data-copy="${esc(p.api_key)}" aria-label="Copy API key">${icon('copy')}</button><button type="button" class="btn btn-w btn-xs" data-rot="api_key">${icon('refresh')}Rotate</button></div>
            </div></div>
          <div class="card stack"><div class="card-h"><div><h3>Connect ${esc(p.name)}</h3><span class="sub">Copy these into the tool. Your developer will know what to do.</span></div></div>
            <p class="muted sm">Add the support widget to any page with the script tag. For "Continue with VooSquare", the tool sends people to the authorize URL, then swaps the code for tokens at the token URL using the client ID and secret. The Events API takes activity (sign-ups, joins, deposits) with the API key so members see it live on their dashboard. The Support API posts customer messages into this inbox.</p>
            <h4>Support widget</h4>${codeBlock(p.endpoints.widget)}
            <h4>Login (OAuth 2.0)</h4>${codeBlock(`Authorize: ${p.endpoints.authorize}\nToken:     ${p.endpoints.token}\nUser info: ${p.endpoints.userinfo}\nLog out:   ${p.endpoints.logout}`)}
            <h4>Events API</h4>${codeBlock(`POST ${p.endpoints.events}\nAuthorization: Bearer <API key>\nContent-Type: application/json\n\n{"events":[{"event_id":"abc123","voo_id":"vs_...","type":"signup","label":"New sign-up","value_usd":0}]}`)}
            <h4>Support API</h4>${codeBlock(`POST ${p.endpoints.support}\nAuthorization: Bearer <API key>\nContent-Type: application/json\n\n{"email":"buyer@example.com","name":"Ada","subject":"Billing","body":"Hello, I need help with..."}`)}
          </div>
          <div class="card"><div class="card-h"><div><h3>Recent events</h3><span class="sub">${fmt(stats.events_7d)} in the last 7 days · ${fmt(stats.tickets_open)} open tickets</span></div></div>
            ${events.length ? `<div class="tbl"><table><thead><tr><th>Type</th><th>Label</th><th>Member</th><th>Value</th><th>When</th></tr></thead><tbody>${events.map((e) => `<tr><td data-l="Type"><span class="mono">${esc(e.type)}</span></td><td data-l="Label">${esc(e.label || '')}</td><td data-l="Member">${esc(e.email || 'Not linked')}</td><td data-l="Value">${e.value_usd ? usd(e.value_usd) : ''}</td><td data-l="When">${timeAgo(e.created_at)}</td></tr>`).join('')}</tbody></table></div>` : empty('spark', 'No events yet', 'Events appear here once the tool sends them.')}</div>`}
        </div>
      </div>`;
      bind();
    };
    const bind = () => {
      const f = $('#prF', el);
      const val = () => { const v = readForm(f); if (v.icon === '__url') v.icon = v.icon_url.trim(); delete v.icon_url; return v; };
      const prev = () => { const v = val(); $('#prP', el).innerHTML = `<div class="tool-card" style="--tint:${esc(v.tint)};--col:${esc(v.color)}">${productIcon({ icon: v.icon, name: v.name, color: v.color }, 'lg')}<span class="tc-t"><span class="muted xs mono">${esc(v.stage)}</span><b>${esc(v.name || 'Product name')}</b><small>${esc(v.tagline || 'Tagline')}</small></span><span class="tc-f">${statusTag(v.status)}${v.offer ? `<span class="offer">${esc(v.offer)}</span>` : ''}</span></div>`; };
      f.addEventListener('input', (e) => {
        if (e.target.dataset.mirror) { const c = $(`[name=${e.target.dataset.mirror}]`, f); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) c.value = e.target.value; }
        else if (e.target.type === 'color') { $(`[data-mirror=${e.target.name}]`, f).value = e.target.value; }
        prev();
      });
      $('.pick-pi', f).addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (!b) return; $$('.pick-pi button', f).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); $('[name=icon]', f).value = b.dataset.k; const u = $('[name=icon_url]', f); u.hidden = b.dataset.k !== '__url'; if (!u.hidden) u.focus(); prev(); });
      prev();
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const v = val();
        if (!v.name.trim()) { toast('Give the product a name.', 'err'); return; }
        const colour = (k) => { const m = $(`[data-mirror=${k}]`, f).value.trim(); return /^#[0-9a-f]{3,8}$/i.test(m) ? m : v[k]; };
        const r = await run($('button[type=submit]', f), () => POST('/api/admin/products', { ...v, color: colour('color'), tint: colour('tint'), id: isNew ? undefined : p.id }), isNew ? 'Product created' : 'Product saved');
        if (!r) return;
        S.products = (await GET('/api/admin/me')).products;
        if (isNew) location.hash = '#products/' + r.product.id;
        else { p = { ...p, ...r.product }; }
      });
      $$('[data-rot]', el).forEach((b) => b.addEventListener('click', () => confirmIn(b, {
        text: b.dataset.rot === 'secret' ? 'Rotate the client secret? Logins from the tool stop working until you paste the new secret into it.' : 'Rotate the API key? Events and support calls from the tool fail until you paste the new key into it.',
        yes: 'Rotate now', onYes: async () => { const r = await POST(`/api/admin/products/${p.id}/rotate`, { which: b.dataset.rot }); p = { ...p, ...r.product }; toast('New ' + (b.dataset.rot === 'secret' ? 'secret' : 'API key') + ' created'); draw(); },
      })));
      const hp = $('#hideP', el);
      if (hp) hp.onclick = () => run(hp, async () => {
        await DEL('/api/admin/products/' + p.id);
        p.visible = 0; if (el.isConnected) draw();
        undoToast(`${p.name} is hidden from members`, { onUndo: () => POST(`/api/admin/products/${p.id}/show`).then(() => { p.visible = 1; if (el.isConnected) draw(); }).catch((er) => toast(er.message, 'err')) });
      });
    };
    draw();
  }

  /* =====================================================================
   * SITE CONTENT: top card, announcement bar, display ads
   * ===================================================================== */
  const THEME_LIST = [['join', 'Joinvoo violet'], ['spy', 'Spyvoo blue'], ['adv', 'Vooads ink and orange'], ['reply', 'Replyvoo yellow'], ['cast', 'Castvoo blue'], ['land', 'Landvoo pink'], ['affleego', 'Affleego yellow'], ['gate', 'Gatevoo black'], ['brand', 'VooSquare green'], ['premium', 'Premium night green'], ['lime', 'Lime'], ['custom', 'Your own two colours']];
  const PLACE_LBL = { dashboard: 'Dashboard', academy: 'Academy', community: 'Community', website: 'Website' };
  const PRODUCT_THEME = { spyvoo: 'spy', joinvoo: 'join', vooads: 'adv', advoo: 'adv', replyvoo: 'reply', castvoo: 'cast', landvoo: 'land', affleego: 'affleego', gatevoo: 'gate' };
  const rid4 = () => Math.random().toString(36).slice(2, 8);

  /* App store buttons (website hero + footer, and "Get the app" in the member app). */
  function appStoresBlock(a) {
    const badgeSlot = (k, cur, label) => `<div class="rm-slot wide as-slot" data-slot="${k}" data-def="">
      <span class="rm-sv as-sv">${cur ? `<img src="${esc(cur.url)}" alt="">` : `<span class="rm-sv-e">${icon('image')}</span>`}<span class="rm-bar" hidden><i></i></span></span>
      <span class="rm-st"><b>${esc(label)} badge</b><small class="rm-src">${cur ? 'Uploaded' : 'Not uploaded: a neutral button shows instead'}</small>
      <span class="row"><button type="button" class="btn btn-w btn-xs" data-up>${icon('image')}${cur ? 'Replace' : 'Upload'}</button><button type="button" class="btn btn-ghost btn-xs" data-reset${cur ? '' : ' hidden'}>Remove</button></span></span>
      <input type="hidden" name="${k}" value="${esc(a[k] || '')}"></div>`;
    const store = (name, urlKey, badgeKey, badge, ph, live) => `<div class="as-store"><div class="as-top"><b>${name}</b><span class="as-state" data-state="${urlKey}">${live ? pill('Live: links to the store', 'g') : pill('Shows "Coming soon"', 'w')}</span></div>
      ${field(name + ' link', input(urlKey, a[urlKey] || '', { ph }), live ? '' : 'Leave empty until the app is published. The button then says Coming soon and links nowhere.')}
      ${badgeSlot(badgeKey, badge, name)}</div>`;
    return `<section class="block mt" id="as"><form class="card stack" id="asF" novalidate><div class="card-h"><div><h3>App stores</h3><span class="sub">Store buttons in the website hero and footer. When the Google Play link is set, members also see "Get the app" on their profile.</span></div><div class="r"><button type="submit" class="btn btn-g btn-sm">Save app stores</button></div></div>
      <div class="as-g">${store('Google Play', 'play_url', 'play_badge_upload', a.play_badge, 'https://play.google.com/store/apps/details?id=...', !!a.play_url)}${store('App Store', 'app_store_url', 'app_store_badge_upload', a.app_store_badge, 'https://apps.apple.com/app/...', !!a.app_store_url)}</div>
      <p class="as-note">${icon('shield')}<span>Use the official badges only, unchanged. Download them from Google's <b>Google Play badges</b> page and Apple's <b>App Store marketing tools</b> page, save them as PNG and upload them here. Until a badge is uploaded, the site shows a plain button with a phone icon.</span></p></form></section>`;
  }
  function bindAppStores(sec) {
    if (!sec) return;
    const f = $('#asF', sec);
    bindPicSlots(f, () => {});
    f.addEventListener('input', (e) => {
      const k = e.target.name; if (k !== 'play_url' && k !== 'app_store_url') return;
      const st = $(`[data-state="${k}"]`, f); if (st) st.innerHTML = e.target.value.trim() ? pill('Live: links to the store', 'g') : pill('Shows "Coming soon"', 'w');
    });
    f.addEventListener('submit', (e) => { e.preventDefault(); run($('button[type=submit]', f), () => saveSetting('apps', readForm(f)), 'App stores saved'); });
  }

  page('content', {
    t: 'Site content', i: 'megaphone', perm: () => can('content'),
    async r(el) {
      el.innerHTML = `${pageHead('Site content', 'The top card, the announcement bar and display ads. Each block saves on its own and goes live straight away.')}${skelCards(3, 220)}`;
      let top, ann, ads, prods, appsV;
      try {
        [top, ann, ads, appsV] = await Promise.all(['top_card', 'announcements', 'ads', 'apps'].map((k) => GET('/api/admin/settings/' + k).then((r) => r.value)));
        // Content editors have no products permission: use the product list the admin shell already has (no 403 in the console).
        prods = can('products') ? await GET('/api/admin/products').then((r) => r.products || []).catch(() => S.products || []) : (S.products || []);
      } catch (e) { el.innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      top = top || {}; ann = Array.isArray(ann) ? ann : [];
      let slidesIn = Array.isArray(ads) ? ads : (ads && Array.isArray(ads.slides) ? ads.slides : []);
      const adInterval = Math.min(15, Math.max(3, Number(ads && ads.interval) || 6));
      prods = (prods || []).filter((p) => p && p.slug);
      const prodByIcon = (ic) => (prods.find((p) => p.icon === ic) || {}).slug || '';
      el.innerHTML = `${pageHead('Site content', 'The top card, the announcement bar and display ads. Each block saves on its own and goes live straight away.')}
        <nav class="tabs" aria-label="Jump to"><a href="#content" data-jump="tc">Top card</a><a href="#content" data-jump="an">Announcement bar</a><a href="#content" data-jump="ad">Spotlight slides</a><a href="#content" data-jump="as">App stores</a></nav>
        <section class="block mt" id="tc"><div class="ed-grid">
          <form class="card stack" id="tcF" novalidate><div class="card-h"><div><h3>Top card</h3><span class="sub">The big card on the website, just under the hero.</span></div><div class="r">${switchField('enabled', top.enabled, 'Show it')}</div></div>
            <div class="g2c">${field('Eyebrow', input('eyebrow', top.eyebrow, { ph: 'New in the Academy' }))}${field('Theme', seg('theme', [['dark', 'Dark'], ['light', 'Light'], ['brand', 'Green']], top.theme || 'dark'))}</div>
            ${field('Title', input('title', top.title))}${field('Body', textarea('body', top.body, { rows: 3 }))}
            <div class="g2c">${field('Button text', input('cta_text', top.cta_text))}${field('Button link', input('cta_url', top.cta_url, { ph: '/app#academy or https://...' }))}</div>
            <div class="row end"><button class="btn btn-g btn-sm" type="submit">Save top card</button></div></form>
          <div class="card prev-card stick"><span class="muted xs mono">Live preview</span><div id="tcP"></div></div></div></section>
        <section class="block mt" id="an" data-guard><div class="card stack"><div class="card-h"><div><h3>Announcement bar</h3><span class="sub">Short lines that rotate in the bar across the site and app.</span></div><div class="r"><button type="button" class="btn btn-w btn-xs" id="anAdd">${icon('plus')}Add line</button><button type="button" class="btn btn-g btn-xs" id="anSave">Save bar</button></div></div>
          <div class="ann-prev" id="anP" aria-live="off"></div><div id="anL" class="ann-list"></div></div></section>
        <section class="block mt" id="ad" data-guard><div class="card-h"><div><h3>Spotlight slides</h3><span class="sub">The animated sponsor slider on the dashboard, Academy, community and website. Drag a slide to reorder. Nothing goes live until you save.</span></div><div class="r"><label class="sp-int"><span>Seconds per slide</span><input class="inp" id="spInt" type="number" min="3" max="15" step="1" value="${adInterval}" inputmode="numeric" aria-label="Seconds per slide"></label><button type="button" class="btn btn-w btn-sm" id="adAdd">${icon('plus')}New slide</button><button type="button" class="btn btn-g btn-sm" id="adSave">Save slides</button></div></div>
          <div class="card spv"><div class="spv-bar"><div class="seg" role="group" aria-label="Preview placement">${Object.entries(PLACE_LBL).map(([k, l], i) => `<button type="button" data-pv="${k}" class="${i ? '' : 'on'}" aria-pressed="${!i}">${esc(l)}</button>`).join('')}</div><span class="spv-n muted xs" id="spvN"></span><div class="seg spv-dv" role="group" aria-label="Preview size"><button type="button" data-dv="desk" class="on" aria-pressed="true">${icon('grid')}Desktop</button><button type="button" data-dv="phone" aria-pressed="false">${icon('id')}Phone</button></div></div><div class="spv-stage"><div class="spv-frame" id="spvF"></div></div></div>
          <div id="adL" class="sle-list"></div></section>
        ${appStoresBlock(appsV || {})}`;
      $('.tabs', el).addEventListener('click', (e) => { const a = e.target.closest('[data-jump]'); if (!a) return; e.preventDefault(); $('#' + a.dataset.jump, el).scrollIntoView({ behavior: VS.reduce ? 'auto' : 'smooth', block: 'start' }); });

      bindAppStores($('#as', el));

      /* top card */
      const tf = $('#tcF', el);
      const tPrev = () => { const v = readForm(tf); $('#tcP', el).innerHTML = `<div class="topcard t-${esc(v.theme)} ${v.enabled ? '' : 'off'}"><span class="tc-eye">${esc(v.eyebrow)}</span><h3>${esc(v.title || 'Title')}</h3><p>${esc(v.body)}</p>${v.cta_text ? `<span class="btn btn-sm ${v.theme === 'light' ? 'btn-g' : 'btn-l'}">${esc(v.cta_text)}${icon('arrow')}</span>` : ''}${v.enabled ? '' : '<span class="off-tag">Hidden</span>'}</div>`; };
      tf.addEventListener('input', tPrev); tf.addEventListener('change', tPrev); tPrev();
      tf.addEventListener('submit', (e) => { e.preventDefault(); run($('button[type=submit]', tf), () => saveSetting('top_card', readForm(tf)), 'Top card saved'); });

      /* announcements */
      const anRow = (a) => `<div class="ann" data-id="${esc(a.id || rid4())}" data-cfm>${switchField('enabled', a.enabled, 'On')}<input class="inp" data-k="text" value="${esc(a.text || '')}" placeholder="What is new" aria-label="Announcement text"><input class="inp" data-k="link_text" value="${esc(a.link_text || '')}" placeholder="Link text" aria-label="Link text"><input class="inp" data-k="url" value="${esc(a.url || '')}" placeholder="/app#academy" aria-label="Link URL"><span class="re-act"><button type="button" class="ib2" data-mv="-1" aria-label="Move up">${icon('up')}</button><button type="button" class="ib2" data-mv="1" aria-label="Move down">${icon('down')}</button><button type="button" class="ib2" data-rm aria-label="Delete line">${icon('trash')}</button></span></div>`;
      const anList = $('#anL', el);
      const anEmpty = () => { if (!$('.ann', anList)) anList.innerHTML = `<div class="ann-empty">${empty('megaphone', 'No lines yet', 'Add a short line, for example a new course or a live session. Then save the bar.', `<button type="button" class="btn btn-g btn-sm" data-an-add>${icon('plus')}Add the first line</button>`)}</div>`; };
      anList.innerHTML = ann.length ? ann.map(anRow).join('') : '';
      anEmpty();
      const readAnn = () => $$('.ann', anList).map((r) => ({ id: r.dataset.id, enabled: $('[name=enabled]', r).checked, text: $('[data-k=text]', r).value.trim(), link_text: $('[data-k=link_text]', r).value.trim(), url: $('[data-k=url]', r).value.trim() })).filter((a) => a.text);
      let ai = 0;
      const anPrev = () => { const on = readAnn().filter((a) => a.enabled); const box = $('#anP', el); if (!on.length) { box.innerHTML = '<div class="annbar off">No lines are switched on. The bar is hidden.</div>'; return; } const a = on[ai % on.length]; box.innerHTML = `<div class="annbar"><span class="live-dot"></span><span class="ab-t" key="${ai}">${esc(a.text)}</span>${a.link_text ? `<b>${esc(a.link_text)} ${icon('arrow')}</b>` : ''}<span class="ab-dots">${on.map((_, i) => `<i class="${i === ai % on.length ? 'on' : ''}"></i>`).join('')}</span></div>`; };
      anPrev();
      const iv = setInterval(() => { ai++; anPrev(); }, 3200); later(() => clearInterval(iv));
      anList.addEventListener('input', anPrev); anList.addEventListener('change', anPrev);
      anList.addEventListener('click', (e) => {
        const r = e.target.closest('.ann'); if (!r) return;
        const mv = e.target.closest('[data-mv]');
        if (mv) { const sib = mv.dataset.mv === '-1' ? r.previousElementSibling : r.nextElementSibling; if (sib) { if (mv.dataset.mv === '-1') anList.insertBefore(r, sib); else anList.insertBefore(sib, r); } anPrev(); }
        const rm = e.target.closest('[data-rm]');
        if (rm) {
          const next = r.nextElementSibling;
          r.remove(); anPrev(); anEmpty();
          guard.touch(anList);
          undoToast('Line removed. Save the bar to make it final.', { onUndo: () => { const em = $('.ann-empty', anList); if (em) em.remove(); if (next && next.isConnected) anList.insertBefore(r, next); else anList.appendChild(r); anPrev(); } });
        }
      });
      anList.addEventListener('click', (e) => { if (e.target.closest('[data-an-add]')) $('#anAdd', el).click(); });
      $('#anAdd', el).onclick = () => { const em = $('.ann-empty', anList); if (em) em.remove(); anList.insertAdjacentHTML('beforeend', anRow({ enabled: true })); $('.ann:last-child [data-k=text]', anList).focus(); };
      $('#anSave', el).onclick = (e) => run(e.currentTarget, () => saveSetting('announcements', readAnn()), 'Announcement bar saved');

      /* Spotlight slides (the animated sponsor slider). The preview uses the same component as the app and the website. */
      const SP = VS.spotlight;
      const slideList = $('#adL', el);
      const pvFrame = $('#spvF', el);
      let pvPlace = 'dashboard'; let pvDevice = 'desk'; let focusId = '';
      const blankSlide = () => ({ id: 'sl' + rid4(), enabled: true, placements: ['dashboard'], theme: 'join', icon: 'voosquare', brand: '', kicker: 'Sponsored by Zedapex', title: '', body: '', cta_text: '', cta_url: '', scene: 'auto', stat_label: '', stat_value: '', example: true, chips: [], image: '', c1: '#00A86B', c2: '#0A1A13' });
      const swatchBg = (theme, c1, c2) => { const t = SP.themeOf({ theme, c1, c2 }); return `linear-gradient(135deg,${t.a},${t.b})`; };
      const slideState = (v) => { const t = Date.now(); return !v.enabled ? 'Paused' : v.starts && v.starts > t ? 'Scheduled' : v.ends && v.ends < t ? 'Ended' : 'Live'; };
      const productOpts = () => [['', 'No product icon'], ...prods.map((p) => [p.slug, p.name])];
      const slideCard = (s, open) => {
        s = SP.norm(s, 0);
        const id = /^[\w-]{1,24}$/.test(s.id) ? s.id : 'sl' + rid4();
        return `<div class="sle card ${open ? 'open' : ''}" data-id="${esc(id)}" data-cfm>
          <div class="sle-h">
            <button type="button" class="sle-drag" aria-label="Drag to reorder" title="Drag to reorder"><i></i><i></i><i></i><i></i><i></i><i></i></button>
            <span class="sle-sw" aria-hidden="true"></span>
            <button type="button" class="sle-sum" aria-expanded="${open ? 'true' : 'false'}"><b class="sle-tt"></b><small class="sle-pl"></small></button>
            <span class="ad-state"></span>
            ${switchField('enabled', s.enabled, 'On')}
            <span class="sle-mv"><button type="button" class="ib2" data-mv="-1" aria-label="Move up">${icon('up')}</button><button type="button" class="ib2" data-mv="1" aria-label="Move down">${icon('down')}</button></span><button type="button" class="btn btn-w btn-xs sle-ed" data-tg aria-label="Edit slide"><span class="t-ed">${icon('pen')}Edit</span><span class="t-dn">Done</span></button>
          </div>
          <div class="sle-b">
            <div class="sle-sec"><span class="lbl">Shows on</span><div class="sle-places" role="group" aria-label="Placements">${SP.PLACES.map(([k, l]) => `<label class="sle-pc"><input type="checkbox" name="pl_${k}" ${s.placements.includes(k) ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div></div>
            <div class="sle-sec"><span class="lbl">Colour</span><div class="sle-themes" role="radiogroup" aria-label="Theme">${THEME_LIST.map(([k, l]) => `<button type="button" role="radio" class="sle-th ${s.theme === k ? 'on' : ''}" data-th="${k}" aria-checked="${s.theme === k}" title="${esc(l)}" aria-label="${esc(l)}" style="background:${k === 'custom' ? 'conic-gradient(from 210deg,#5B3FE8,#EE5A2F,#F5C542,#12C784,#3D6BF2,#5B3FE8)' : swatchBg(k)}"></button>`).join('')}<input type="hidden" name="theme" value="${esc(s.theme)}"></div>
              <div class="sle-cust g2c" ${s.theme === 'custom' ? '' : 'hidden'}>${field('Colour one', `<span class="sle-col"><input type="color" name="c1" value="${esc(s.c1 || '#00A86B')}" aria-label="Colour one"><code>${esc(s.c1 || '#00A86B')}</code></span>`)}${field('Colour two', `<span class="sle-col"><input type="color" name="c2" value="${esc(s.c2 || '#0A1A13')}" aria-label="Colour two"><code>${esc(s.c2 || '#0A1A13')}</code></span>`)}</div></div>
            <div class="g2c">${field('Product icon', select('product', productOpts(), s.product || prodByIcon(s.icon)), 'Any product, including ones you add later.')}${field('Tab label', input('brand', s.brand, { ph: 'Joinvoo', max_len: 24 }), 'Short name on the slide tab.')}</div>
            <input type="hidden" name="icon" value="${esc(s.icon)}">
            ${field('Small line above the title', input('kicker', s.kicker, { ph: 'Sponsored by Zedapex', max_len: 48 }))}
            ${field('Title', input('title', s.title, { ph: 'Pay for people, not clicks.', max_len: 90 }), 'Up to 90 characters. Short reads best.')}
            ${field('Body', textarea('body', s.body, { rows: 2, ph: 'One or two short sentences. Name the offer.' }), 'Up to 220 characters.')}
            <div class="g2c">${field('Button text', input('cta_text', s.cta_text, { ph: 'Try it free', max_len: 32 }))}${field('Button link', input('cta_url', s.cta_url, { ph: 'https://... or /app#premium' }), 'https:// links open in a new tab. /app# links stay in the app.')}</div>
            <div class="sle-sec"><span class="lbl">Animated scene</span>
              <div class="g3c">${field('Style', select('scene', SP.SCENES, s.scene))}${field('Number label', input('stat_label', s.stat_label, { ph: 'Real joins today', max_len: 32 }))}${field('Number', input('stat_value', s.stat_value, { ph: '+412', max_len: 14 }), 'Counts up when the slide shows.')}</div>
              <div class="g3c">${[0, 1, 2].map((k) => field(`Floating chip ${k + 1}`, input('chip' + k, s.chips[k] || '', { ph: ['Ada joined from Ad set 3', 'Deposit $120 sent to Meta', 'Bot click filtered out'][k], max_len: 40 }))).join('')}</div>
              ${switchField('example', s.example, 'Label the numbers "Example"', 'Keep this on for any number that is not a real result.')}
              ${field('Image instead of the scene (optional)', input('image', s.image, { ph: 'https://...' }), 'https only. Chips still float around it.')}
            </div>
            <div class="g2c">${field('Starts', input('starts', toDateInput(s.starts), { type: 'date' }), 'Empty means now.')}${field('Ends', input('ends', toDateInput(s.ends), { type: 'date' }), 'Empty means no end.')}</div>
            <div class="row end"><button type="button" class="btn btn-w btn-xs" data-dup>${icon('copy')}Duplicate</button><button type="button" class="btn btn-danger btn-xs" data-rm>${icon('trash')}Delete slide</button></div>
          </div>
        </div>`;
      };
      const readSlide = (c) => {
        const v = readForm(c);
        return {
          id: c.dataset.id, enabled: !!v.enabled, placements: SP.PLACES.map(([k]) => k).filter((k) => v['pl_' + k]), theme: v.theme, c1: v.c1, c2: v.c2,
          product: v.product, icon: v.icon, brand: v.brand.trim(), kicker: v.kicker.trim(), title: v.title.trim(), body: v.body.trim(), cta_text: v.cta_text.trim(), cta_url: v.cta_url.trim(),
          scene: v.scene, stat_label: v.stat_label.trim(), stat_value: v.stat_value.trim(), example: !!v.example, chips: [v.chip0, v.chip1, v.chip2].map((x) => x.trim()).filter(Boolean),
          image: v.image.trim(), starts: fromDateInput(v.starts, false), ends: fromDateInput(v.ends, true),
        };
      };
      const cards = () => $$('.sle', slideList);
      const readAll = () => cards().map(readSlide);
      const paintHead = (c) => {
        const v = readSlide(c); const st = slideState(v);
        $('.sle-sw', c).style.background = swatchBg(v.theme, v.c1, v.c2);
        $('.sle-tt', c).textContent = (v.brand ? v.brand + ' · ' : '') + (v.title || 'Untitled slide');
        $('.sle-pl', c).textContent = v.placements.length ? v.placements.map((p) => PLACE_LBL[p]).join(', ') : 'Not placed anywhere yet';
        const s = $('.ad-state', c); s.textContent = st; s.className = 'ad-state s-' + st.toLowerCase();
        c.classList.toggle('off', !v.enabled);
      };
      const paintPreview = () => {
        const all = readAll(); const t = Date.now();
        const here = all.filter((s) => s.enabled && (s.title || s.body) && s.placements.includes(pvPlace));
        const live = SP.pick(here, pvPlace, { now: t });
        const variant = pvPlace === 'community' ? 'mini' : 'full';
        $('#spvN', el).textContent = here.length ? `${live.length} of ${here.length} ${here.length === 1 ? 'slide' : 'slides'} live here${here.length > live.length ? ' (others are outside their dates)' : ''}` : '';
        pvFrame.className = `spv-frame dv-${pvDevice} pl-${pvPlace}`;
        pvFrame.innerHTML = here.length ? SP.render(here, { variant, interval: Number($('#spInt', el).value) || 6, preview: true, label: 'Preview' }) : `<div class="spv-empty">${icon('megaphone')}<b>No slides on the ${esc(PLACE_LBL[pvPlace].toLowerCase())}</b><span>Tick "${esc(PLACE_LBL[pvPlace])}" on a slide to show it here.</span></div>`;
        const k = focusId ? here.findIndex((s) => s.id === focusId) : -1;
        const root = $('.spot', pvFrame);
        if (root && k > 0) { const ctl = root._spot || SP.mount(root); if (ctl) ctl.go(k); }
      };
      const paintPreviewSoon = debounce(paintPreview, 220);
      const drawSlides = (openId) => {
        slideList.innerHTML = slidesIn.length ? slidesIn.map((s) => slideCard(s, s.id === openId)).join('') : `<div class="card">${empty('megaphone', 'No slides yet', 'Add a slide to promote a tool or Premium.')}</div>`;
        cards().forEach(paintHead);
        paintPreview();
      };
      const toggle = (c, open) => { const o = open === undefined ? !c.classList.contains('open') : open; c.classList.toggle('open', o); $('.sle-sum', c).setAttribute('aria-expanded', o); if (o) focusId = c.dataset.id; };
      drawSlides();

      $('.spv-bar', el).addEventListener('click', (e) => {
        const p = e.target.closest('[data-pv]'); if (p) { pvPlace = p.dataset.pv; $$('[data-pv]', el).forEach((b) => { b.classList.toggle('on', b === p); b.setAttribute('aria-pressed', b === p); }); paintPreview(); }
        const d = e.target.closest('[data-dv]'); if (d) { pvDevice = d.dataset.dv; $$('[data-dv]', el).forEach((b) => { b.classList.toggle('on', b === d); b.setAttribute('aria-pressed', b === d); }); paintPreview(); }
      });
      $('#spInt', el).addEventListener('change', paintPreview);
      const onEdit = (e) => {
        const c = e.target.closest('.sle'); if (!c) return;
        focusId = c.dataset.id;
        if (e.target.type === 'color') { const code = e.target.parentElement.querySelector('code'); if (code) code.textContent = e.target.value.toUpperCase(); }
        if (e.target.name === 'product') {
          const p = prods.find((x) => x.slug === e.target.value);
          const brand = $('[name=brand]', c); const prev = prods.find((x) => x.name === brand.value);
          $('[name=icon]', c).value = p ? p.icon || p.slug : '';
          if (p && (!brand.value || prev)) brand.value = p.name;
          const th = p && PRODUCT_THEME[p.slug];
          if (th) setTheme(c, th);
        }
        paintHead(c); paintPreviewSoon();
      };
      slideList.addEventListener('input', onEdit);
      slideList.addEventListener('change', onEdit);
      slideList.addEventListener('focusin', (e) => { const c = e.target.closest('.sle'); if (c && c.classList.contains('open') && focusId !== c.dataset.id) { focusId = c.dataset.id; paintPreviewSoon(); } });
      const setTheme = (c, th) => {
        $$('.sle-th', c).forEach((b) => { const on = b.dataset.th === th; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
        $('[name=theme]', c).value = th;
        $('.sle-cust', c).hidden = th !== 'custom';
      };
      slideList.addEventListener('click', (e) => {
        const c = e.target.closest('.sle'); if (!c) return;
        const th = e.target.closest('.sle-th');
        if (th) { setTheme(c, th.dataset.th); focusId = c.dataset.id; paintHead(c); paintPreview(); return; }
        if (e.target.closest('.sle-sum, [data-tg]')) { toggle(c); paintPreview(); return; }
        const mv = e.target.closest('[data-mv]');
        if (mv) { const sib = mv.dataset.mv === '-1' ? c.previousElementSibling : c.nextElementSibling; if (sib) { if (mv.dataset.mv === '-1') slideList.insertBefore(c, sib); else slideList.insertBefore(sib, c); } mv.focus(); paintPreview(); return; }
        if (e.target.closest('[data-dup]')) { const v = readSlide(c); v.id = 'sl' + rid4(); v.title = v.title ? v.title : ''; c.insertAdjacentHTML('afterend', slideCard(v, true)); const n = c.nextElementSibling; toggle(c, false); paintHead(n); focusId = v.id; paintPreview(); $('[name=title]', n).focus(); return; }
        const rm = e.target.closest('[data-rm]');
        if (rm) {
          const next = c.nextElementSibling;
          c.remove();
          if (!cards().length) slideList.innerHTML = `<div class="card sle-none">${empty('megaphone', 'No slides yet', 'Add a slide to promote a tool or Premium.')}</div>`;
          guard.touch(slideList); paintPreview();
          undoToast('Slide removed. Save slides to make it final.', { onUndo: () => { const none = $('.sle-none', slideList); if (none) none.remove(); if (next && next.isConnected) slideList.insertBefore(c, next); else slideList.appendChild(c); paintPreview(); } });
        }
      });
      // Drag to reorder (the handle starts the drag; arrows do the same from the keyboard).
      let dragC = null;
      slideList.addEventListener('pointerdown', (e) => { const h = e.target.closest('.sle-drag'); if (h) h.closest('.sle').draggable = true; });
      slideList.addEventListener('dragstart', (e) => { dragC = e.target.closest('.sle'); if (!dragC) return; dragC.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', dragC.dataset.id); } catch { /* old browsers */ } });
      slideList.addEventListener('dragover', (e) => {
        if (!dragC) return; e.preventDefault();
        const over = e.target.closest('.sle'); if (!over || over === dragC) return;
        const r = over.getBoundingClientRect();
        slideList.insertBefore(dragC, e.clientY < r.top + r.height / 2 ? over : over.nextElementSibling);
      });
      slideList.addEventListener('dragend', () => { if (dragC) { dragC.classList.remove('dragging'); dragC.draggable = false; dragC = null; paintPreview(); } });
      slideList.addEventListener('drop', (e) => e.preventDefault());

      $('#adAdd', el).onclick = () => {
        if (!cards().length) slideList.innerHTML = '';
        cards().forEach((c) => toggle(c, false));
        const s = blankSlide(); if (pvPlace && !s.placements.includes(pvPlace)) s.placements = [pvPlace];
        slideList.insertAdjacentHTML('afterbegin', slideCard(s, true));
        const c = $('.sle', slideList); paintHead(c); focusId = s.id; paintPreview(); $('[name=title]', c).focus();
      };
      $('#adSave', el).onclick = async (e) => {
        const list = readAll().filter((a) => a.title || a.body);
        const openId = ($('.sle.open', slideList) || {}).dataset?.id;
        const r = await run(e.currentTarget, () => saveSetting('ads', { slides: list, interval: Number($('#spInt', el).value) || 6 }), `Saved ${list.length} ${list.length === 1 ? 'slide' : 'slides'}`);
        if (r && r.value) { slidesIn = r.value.slides || []; $('#spInt', el).value = r.value.interval || 6; drawSlides(openId); }
      };
    },
  });

  /* =====================================================================
   * PAYMENTS
   * ===================================================================== */
  const CFG_LABEL = {
    secret_key: ['Secret key', 'From the provider dashboard. Starts with sk_ on Paystack and Stripe.'], webhook_hash: ['Webhook secret hash', 'The verif-hash you set in Flutterwave.'],
    webhook_secret: ['Webhook signing secret', 'Used to check that webhooks really come from the provider.'], network: ['Network', 'For example TRON (TRC20) or Bitcoin.'], address: ['Wallet address', 'Payments go straight to this address.'],
    instructions: ['Instructions for the buyer', 'Shown at checkout. Say exactly what to send and what to paste back.'], create_url: ['Create checkout URL', 'We POST the order here and expect a checkout link back.'],
    auth_header: ['Auth header', 'Written as Name: value, for example Authorization: Bearer abc.'], url_field: ['Checkout link field', 'Where the link sits in the response, like data.url.'],
    verify_url: ['Verify URL', 'We call it with ?order_ref= to confirm payment, or put {{order_id}} or {{provider_ref}} in the address.'], status_field: ['Status field', 'Where the status sits in the response, like data.status.'], paid_value: ['Paid value', 'The status value that means paid, like paid or success.'],
    api_base: ['Gatevoo address', 'Leave as https://gatevoo.com unless Gatevoo gives you another one.'], api_key: ['API key', 'From your Gatevoo dashboard.'],
    body_template: ['Request body (JSON, optional)', 'Leave empty for our standard body. Placeholders: {{amount}} {{currency}} {{order_id}} {{email}} {{return_url}} {{webhook_url}} {{name}} {{description}} {{amount_usd}}'],
    id_field: ['Provider reference field', 'Where the provider\'s own payment ID sits in the response, like data.id. Optional.'],
  };
  const PROOF_MODES = [['either', 'Reference or screenshot'], ['text', 'Reference only'], ['image', 'Screenshot only'], ['both', 'Both']];
  const PM_ICONS = ['wallet', 'card', 'inbox', 'globe', 'send', 'shield', 'diamond', 'tag', 'users', 'gift', 'star', 'flag', 'mail', 'link'];
  const pmInitials = (n) => String(n || '?').replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  /** Icon chip for a payment method or a picker card. */
  const pmIcon = (type, cfg = {}, name = '') => {
    if (type === 'gatevoo') return productIcon({ icon: 'gatevoo', name: 'Gatevoo' }, 'sm');
    if (type === 'manual') return cfg.icon && VS.P[cfg.icon] ? `<span class="kic">${icon(cfg.icon)}</span>` : `<span class="kic ini">${esc(pmInitials(name))}</span>`;
    return `<span class="kic">${icon(type === 'crypto' ? 'diamond' : type === 'custom' ? 'link' : 'card')}</span>`;
  };
  /* What "Add payment method" offers. Several of any type are allowed. */
  const PM_PICKS = [
    { type: 'gatevoo', title: 'Gatevoo', desc: 'USDT and Bitcoin through Zedapex\'s own checkout. Confirms on its own.', tag: ['Zedapex', 'k'], m: { name: 'Pay with crypto · Gatevoo', currency: 'USD', rate: 1, config: { api_base: 'https://gatevoo.com', assets: ['USDT_TRC20', 'BTC'] } } },
    { type: 'paystack', title: 'Paystack', desc: 'Cards, bank and USSD in Nigeria, Ghana, Kenya and South Africa.', m: { name: 'Card, bank or USSD (Paystack)', currency: 'NGN', rate: 1600 } },
    { type: 'flutterwave', title: 'Flutterwave', desc: 'Cards and mobile money across Africa.', m: { name: 'Card or mobile money (Flutterwave)', currency: 'KES', rate: 130 } },
    { type: 'stripe', title: 'Stripe', desc: 'Cards worldwide.', m: { name: 'Card (Stripe)', currency: 'USD', rate: 1 } },
    { type: 'crypto', title: 'Crypto wallet', desc: 'Show your wallet address. Add one method per coin or network.', m: { name: 'USDT (TRC20)', currency: 'USDT', rate: 1, config: { network: 'TRON (TRC20)', proof_mode: 'either', instructions: 'Send the exact amount, then paste your transaction hash.' } } },
    { type: 'manual', title: 'Bank transfer', desc: 'Bank, account number and name, each with a copy button.', icon: 'wallet', m: { name: 'Bank transfer', currency: 'NGN', rate: 1600, config: { icon: 'wallet', proof_mode: 'either', details: [{ label: 'Bank', value: '' }, { label: 'Account number', value: '' }, { label: 'Account name', value: '' }], instructions: 'Transfer the exact amount, then paste your reference or add a screenshot of the receipt.' } } },
    { type: 'manual', title: 'Custom manual', desc: 'Mobile money, agents, anything else. Your own details and instructions.', icon: 'inbox', m: { name: '', currency: 'USD', rate: 1, config: { icon: 'send', proof_mode: 'either', details: [{ label: '', value: '' }] } } },
    { type: 'custom', title: 'Custom API', desc: 'Any provider with an API that returns a checkout link.', m: { name: '', currency: 'USD', rate: 1, config: { amount_mode: 'local', url_field: 'url', status_field: 'status', paid_value: 'paid' } } },
  ];
  function methodPicker(types, done) {
    const md = modal({ title: 'Add payment method', wide: true, body: `<p class="muted sm">Pick how members will pay. You can add as many methods as you like, including several of the same kind (for example one per bank or per coin).</p><div class="pt-grid mt">${PM_PICKS.map((p, i) => `<button type="button" class="pt" data-i="${i}">${p.type === 'gatevoo' ? productIcon({ icon: 'gatevoo', name: 'Gatevoo' }, 'sm') : `<span class="kic">${icon(p.icon || (p.type === 'crypto' ? 'diamond' : p.type === 'custom' ? 'link' : 'card'))}</span>`}<b>${esc(p.title)}</b><small>${esc(p.desc)}</small>${p.tag ? `<span class="pt-tag">${pill(p.tag[0], p.tag[1])}</span>` : ''}</button>`).join('')}</div>` });
    md.q('.pt-grid').addEventListener('click', (e) => { const b = e.target.closest('.pt'); if (!b) return; const p = PM_PICKS[Number(b.dataset.i)]; md.close(); methodModal(null, types, done, { type: p.type, ...JSON.parse(JSON.stringify(p.m)) }); });
  }

  page('payments', {
    t: 'Payments', i: 'card', perm: () => can('payments'),
    async r(el, args, q) {
      el.innerHTML = `${pageHead('Payments', 'How members pay for Premium and paid rooms, and every order.', `<button type="button" class="btn btn-g btn-sm" id="addM">${icon('plus')}Add payment method</button>`)}
        <div class="card flush" id="orders"><div class="toolbar"><h3>Orders</h3><div class="seg" id="oSt" role="group" aria-label="Order status">${[['all', 'All'], ['review', 'To check'], ['pending', 'Waiting'], ['paid', 'Paid'], ['failed', 'Failed'], ['expired', 'Expired']].map(([s, l]) => `<button type="button" data-s="${s}" class="${(q.status || 'all') === s ? 'on' : ''}">${l}</button>`).join('')}</div><span class="muted sm grow-r" id="oSum"></span></div><div id="oL">${skelRows(5, 56)}</div>
          <form class="ord-exp" id="oExp" novalidate>${icon('clock')}<label class="mini-in"><span>Unpaid transfer and crypto orders expire after</span><input class="inp" type="number" name="days" min="1" max="90" step="1" inputmode="numeric" aria-label="Days before an unpaid order expires"><span>days</span></label><button type="submit" class="btn btn-w btn-xs">Save</button><small class="muted">Expired orders are kept, and you can still approve one if the money arrives late.</small></form></div>
        <h3 class="sec-h mt">Payment methods</h3>
        <div class="info-line">${icon('globe')}<span>Any currency works. Set the currency code and how much of it equals 1 USD. Prices are set in USD and converted at checkout.</span></div>
        <div id="pmL" class="mt">${skelCards(3, 120)}</div>`;
      let methods = [], types = {};
      // QA-4: how long an unpaid manual order stays open before it turns "expired" (Settings key 'billing').
      GET('/api/admin/settings/billing').then((r) => { const i = $('#oExp input', el); if (i) i.value = r.value.pending_expire_days; }).catch(() => {});
      $('#oExp', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const days = Math.floor(Number($('#oExp input', el).value));
        if (!(days >= 1 && days <= 90)) { toast('Choose 1 to 90 days', 'err'); return; }
        await run($('#oExp button', el), () => PUT('/api/admin/settings/billing', { value: { pending_expire_days: days } }), `Unpaid orders now expire after ${days} ${days === 1 ? 'day' : 'days'}`);
      });
      const drawM = () => {
        $('#pmL', el).innerHTML = methods.length ? `<div class="cards">${methods.map((m, i) => { const T = types[m.type] || {}; return `<div class="pm card ${m.enabled ? '' : 'off'}" data-id="${m.id}" data-cfm><div class="pm-h">${pmIcon(m.type, m.config, m.name)}<span class="pm-t"><b>${esc(m.name)}</b><small>${esc(T.label || m.type)}</small></span>${switchField('enabled', m.enabled, m.enabled ? 'On' : 'Off')}</div>
          <div class="pm-f"><span><small>Currency</small><b class="mono">${esc(m.currency)}</b></span><span><small>Per 1 USD</small><b class="mono">${esc(String(m.rate))}</b></span><span><small>Countries</small><b>${m.countries.length ? esc(m.countries.join(', ')) : 'All'}</b></span></div>
          ${!m.enabled && m.problems && m.problems.length ? `<p class="pm-prob">${icon('flag')}<span>${esc(m.problems[0])}</span></p>` : m.note && !m.enabled ? `<p class="muted xs">${esc(m.note)}</p>` : ''}
          ${T.webhook ? `<div class="pm-hook" title="Webhook URL">${icon('link')}<code>${esc(m.webhook_url)}</code><button type="button" class="ib2" data-copy="${esc(m.webhook_url)}" aria-label="Copy webhook URL">${icon('copy')}</button></div>` : ''}
          <div class="pm-acts"><button type="button" class="btn btn-w btn-xs" data-edit>${icon('pen')}Edit</button><button type="button" class="btn btn-ghost btn-xs" data-dup>${icon('copy')}Duplicate</button><span class="grow"></span><button type="button" class="ib2" data-mv="-1" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${icon('up')}</button><button type="button" class="ib2" data-mv="1" aria-label="Move down"${i === methods.length - 1 ? ' disabled' : ''}>${icon('down')}</button>${m.orders ? '' : `<button type="button" class="ib2" data-del aria-label="Delete">${icon('trash')}</button>`}</div></div>`; }).join('')}</div>` : `<div class="card">${empty('card', 'No payment methods', 'Add one so members can buy Premium.')}</div>`;
      };
      const loadM = async () => { try { const r = await GET('/api/admin/payment-methods'); methods = r.methods; types = r.types; if (el.isConnected) drawM(); } catch (e) { $('#pmL', el).innerHTML = errorBox(e); } };
      $('#pmL', el).addEventListener('change', async (e) => {
        const sw = e.target.closest('[name=enabled]'); if (!sw) return;
        const m = methods.find((x) => x.id === Number(sw.closest('.pm').dataset.id));
        const r = await run(null, () => POST('/api/admin/payment-methods', { ...m, enabled: sw.checked }), `${m.name} ${sw.checked ? 'is on' : 'is off'}`);
        if (r) { Object.assign(m, r.method); drawM(); } else sw.checked = !sw.checked;
      });
      $('#pmL', el).addEventListener('click', async (e) => {
        const card = e.target.closest('.pm'); if (!card) return;
        const m = methods.find((x) => x.id === Number(card.dataset.id));
        if (e.target.closest('[data-edit]')) methodModal(m, types, loadM);
        const dup = e.target.closest('[data-dup]');
        if (dup) { const r = await run(dup, () => POST(`/api/admin/payment-methods/${m.id}/duplicate`), 'Copy added. It starts switched off.'); if (r) { await loadM(); methodModal(r.method, types, loadM); } }
        const mv = e.target.closest('[data-mv]');
        if (mv) {
          const i = methods.indexOf(m), j = i + Number(mv.dataset.mv);
          if (j < 0 || j >= methods.length) return;
          [methods[i], methods[j]] = [methods[j], methods[i]]; drawM();
          const r = await run(null, () => POST('/api/admin/payment-methods/reorder', { ids: methods.map((x) => x.id) }));
          if (r) { methods = r.methods; drawM(); const b = $(`.pm[data-id="${m.id}"] [data-mv="${mv.dataset.mv}"]`, el); if (b && !b.disabled) b.focus(); } else loadM();
        }
        const del = e.target.closest('[data-del]');
        if (del) confirmIn(del, { text: `Delete ${m.name}? It has no orders, so nothing else changes.`, yes: 'Delete method', onYes: async () => { await DEL('/api/admin/payment-methods/' + m.id); toast('Method deleted'); loadM(); } });
      });
      $('#addM', el).onclick = () => methodPicker(types, loadM);

      let status = q.status || 'all';
      let oseq = 0;
      const loadO = async () => {
        const my = ++oseq;
        try {
          const r = await GET('/api/admin/orders?status=' + status);
          if (my !== oseq || !el.isConnected) return;
          $('#oSum', el).textContent = `${usd(r.paid_total_usd)} paid across ${fmt(r.paid_count)} ${r.paid_count === 1 ? 'order' : 'orders'}`;
          $('#oL', el).innerHTML = r.orders.length ? `<div class="tbl"><table><thead><tr><th>Order</th><th>Member</th><th>Amount</th><th>Method</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${r.orders.map((o) => `<tr class="${o.status === 'review' ? 'hl' : ''}"><td data-l="Order"><b>${esc(o.item_name)}</b><small class="mono">${esc(o.ref)}</small></td><td data-l="Member">${esc(o.name)}<small>${esc(o.email).replace('@', '@<wbr>')}</small></td><td data-l="Amount"><b>${esc(fmt(o.amount, o.amount % 1 ? 2 : 0))} ${esc(o.currency)}</b><small>${usd(o.amount_usd)}</small></td><td data-l="Method">${esc(o.method || '')}</td><td data-l="Status">${orderPill(o.status)}${o.note ? `<small>${esc(o.note)}</small>` : ''}</td><td data-l="Created">${fullDate(o.created_at)}</td>
            <td class="act-td" data-cfm>${o.status === 'review' || o.proof || o.proof_image ? `<div class="proof"><small>Proof from the member</small>${o.proof ? `<code>${esc(o.proof)}</code><button type="button" class="ib2" data-copy="${esc(o.proof)}" aria-label="Copy proof">${icon('copy')}</button>` : ''}${o.proof_image && window.VSM ? `<div class="proof-img">${VSM.thumb(o.proof_image, { maxW: 160, maxH: 120, cls: 'sm' })}</div>` : ''}</div>` : ''}${o.status === 'review' || o.status === 'pending' ? `<div class="row"><button type="button" class="btn btn-g btn-xs" data-ok="${o.id}">${icon('check')}Approve</button><button type="button" class="btn btn-danger btn-xs" data-no="${o.id}">Reject</button></div>` : ''}</td></tr>`).join('')}</tbody></table></div>` : empty('card', 'No orders here', status === 'review' ? 'Orders show here when a member pastes a transaction hash or transfer reference.' : '');
        } catch (e) { if (el.isConnected) $('#oL', el).innerHTML = errorBox(e); }
      };
      $('#oSt', el).addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; status = b.dataset.s; $$('#oSt button', el).forEach((x) => x.classList.toggle('on', x === b)); loadO(); });
      $('#oL', el).addEventListener('click', (e) => {
        const ok = e.target.closest('[data-ok]'); const no = e.target.closest('[data-no]');
        if (ok) confirmIn(ok, { text: 'Approve this order? The member gets access and a receipt right away. Check the money arrived first.', yes: 'Approve and grant access', danger: false, onYes: async () => { await POST(`/api/admin/orders/${ok.dataset.ok}/approve`); toast('Order approved'); loadO(); refreshBadges(); } });
        if (no) { const box = confirmIn(no, { text: 'Reject this order? Add a short reason the team can see.', yes: 'Reject order', onYes: async () => { await POST(`/api/admin/orders/${no.dataset.no}/reject`, { reason: $('.rej', box).value }); toast('Order rejected'); loadO(); refreshBadges(); } }); $('p', box).insertAdjacentHTML('afterend', '<input class="inp rej" placeholder="Reason, for example: no payment found" aria-label="Reason">'); }
      });
      on('order', debounce(loadO, 300));
      loadM(); loadO();
    },
  });

  /* =====================================================================
   * PAYOUTS (referral earnings). The Zedapex team pays from its own wallet or bank, then records it here.
   * ===================================================================== */
  const usd2 = (n) => '$' + fmt(n, 2);
  const PO_STATUS = { requested: ['Requested', 'gold'], processing: ['Sending', 'b'], paid: ['Paid', 'g'], rejected: ['Not sent', 'r'], cancelled: ['Cancelled', 'w'] };
  const poPill = (s) => { const x = PO_STATUS[s] || [s, 'w']; return pill(x[0], x[1]); };
  const PO_METHOD_IC = { usdt_trc20: 'diamond', bank: 'card', mobile_money: 'wallet' };
  const PO_FIELDS = {
    usdt_trc20: [['address', 'TRC20 address']],
    bank: [['bank_name', 'Bank'], ['account_number', 'Account number'], ['account_name', 'Account name'], ['country', 'Country']],
    mobile_money: [['provider', 'Provider'], ['number', 'Wallet number'], ['name', 'Name on wallet'], ['country', 'Country']],
  };
  /** Every payout detail on its own line with a copy button, so finance can paste it into the wallet or bank app. */
  const poDetails = (m) => (m ? `<div class="po-det">${(PO_FIELDS[m.type] || []).map(([k, l]) => (m.details && m.details[k] ? `<div class="po-dr"><small>${esc(l)}</small><code>${esc(m.details[k])}</code><button type="button" class="ib2" data-copy="${esc(m.details[k])}" aria-label="Copy ${esc(l)}">${icon('copy')}</button></div>` : '')).join('')}</div>` : '<p class="muted sm">No payout details saved.</p>');

  page('payouts', {
    t: 'Payouts', i: 'wallet', perm: () => can('payments'),
    async r(el, args, q) {
      const st = { status: q.status || 'requested', q: '', seq: 0 };
      const FILTERS = [['requested', 'Requested'], ['processing', 'Sending'], ['paid', 'Paid'], ['rejected', 'Not sent'], ['cancelled', 'Cancelled'], ['all', 'All']];
      el.innerHTML = `${pageHead('Payouts', 'Referral payouts. Send the money from the Zedapex wallet or bank, then mark it paid here with the reference. VooSquare never holds or moves the money.', `<a class="btn btn-w btn-sm" id="poCsv" href="#">${icon('download')}Export CSV</a>`)}
        <div class="kpis" id="poK">${Array.from({ length: 4 }, () => '<div class="card kpi"><div class="skel" style="height:14px;width:55%"></div><div class="skel" style="height:34px;width:40%;margin-top:14px"></div></div>').join('')}</div>
        <div class="card flush mt"><div class="toolbar"><div class="seg" id="poSt" role="group" aria-label="Status">${FILTERS.map(([v, l]) => `<button type="button" data-s="${v}" class="${st.status === v ? 'on' : ''}" aria-pressed="${st.status === v}">${l}<span class="seg-n" data-n="${v}"></span></button>`).join('')}</div>
          <label class="po-q grow-r">${icon('search')}<input type="search" placeholder="Name, email or reference" aria-label="Search payouts"></label></div>
          <div id="poL">${skelRows(4, 72)}</div></div>`;
      const csv = () => { $('#poCsv', el).href = '/api/admin/payouts.csv?status=' + encodeURIComponent(st.status); };
      csv();
      const kpis = (t) => {
        const K = [['clock', 'Requested', t.requested_usd, `${fmt(t.requested)} waiting to be sent`], ['send', 'Sending', t.processing_usd, `${fmt(t.processing)} marked as sending`], ['check', 'Paid this month', t.paid_month_usd, `${fmt(t.paid_month)} ${t.paid_month === 1 ? 'payout' : 'payouts'}`], ['wallet', 'Paid all time', t.paid_usd, `${fmt(t.paid)} ${t.paid === 1 ? 'payout' : 'payouts'}`]];
        $('#poK', el).innerHTML = K.map(([ic, l, v, sub], i) => `<div class="card kpi" style="animation-delay:${i * 40}ms"><span class="kl"><span class="kic">${icon(ic)}</span>${esc(l)}</span><b class="kv">${usd2(v)}</b><small>${esc(sub)}</small></div>`).join('');
        const n = { requested: t.requested, processing: t.processing, paid: t.paid, rejected: t.rejected, cancelled: t.cancelled };
        $$('#poSt [data-n]', el).forEach((s) => { const v = n[s.dataset.n]; s.textContent = v ? fmt(v) : ''; });
      };
      const row = (p) => `<button type="button" class="po-row ${p.status}" data-id="${p.id}">
          ${av(p.member.avatar, 'md', p.member.email)}
          <span class="po-who"><b>${esc(p.member.name)}</b><small>${esc(p.member.email)}</small></span>
          <span class="po-m">${icon(PO_METHOD_IC[p.method && p.method.type] || 'wallet')}<span><b>${esc(p.method ? p.method.label : 'No details')}</b><small class="mono">${esc(p.method ? p.method.summary : '')}</small></span></span>
          <span class="po-amt"><b>${usd2(p.amount_usd)}</b><small>${p.status === 'paid' ? 'Paid ' + dateStr(p.paid_at) : p.decided_at && p.status !== 'requested' ? dateStr(p.decided_at) : 'Requested ' + timeAgo(p.requested_at)}</small></span>
          <span class="po-st">${poPill(p.status)}</span><span class="po-go">${icon('arrow')}</span></button>`;
      const load = async () => {
        const my = ++st.seq;
        try {
          const r = await GET(`/api/admin/payouts?status=${st.status}${st.q ? '&q=' + encodeURIComponent(st.q) : ''}`);
          if (my !== st.seq || !el.isConnected) return;
          kpis(r.totals);
          $('#poL', el).innerHTML = r.payouts.length ? `<div class="po-list">${r.payouts.map(row).join('')}</div>`
            : empty(st.status === 'requested' ? 'check' : 'wallet', st.status === 'requested' ? 'No payouts to send' : 'Nothing here', st.status === 'requested' ? `Members can request a payout once ${usd2(r.min_withdraw)} of their earnings has settled. New requests show here with a badge on Payouts.` : 'Try another filter.');
        } catch (e) { if (el.isConnected) $('#poL', el).innerHTML = errorBox(e); }
      };
      $('#poSt', el).addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (!b) return; st.status = b.dataset.s; $$('#poSt button', el).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); history.replaceState(null, '', '#payouts?status=' + st.status); csv(); load(); });
      $('.po-q input', el).addEventListener('input', debounce((e) => { st.q = e.target.value.trim(); load(); }, 280));
      $('#poL', el).addEventListener('click', (e) => { const r = e.target.closest('.po-row'); if (r) payoutModal(Number(r.dataset.id), load); });
      on('payout', debounce(load, 300));
      await load();
      if (args[0]) payoutModal(Number(args[0]), load);
    },
  });

  /** Earnings, payout details and history for one member (payout modal and customer page). */
  function poSummaryHtml(s, { compact = false } = {}) {
    const B = s.balance; const mx = Math.max(0.01, ...s.by_product.map((p) => p.earned));
    return `<div class="po-sum">
      <div class="po-stats"><div><small>Referred</small><b>${fmt(s.referred)}</b></div><div><small>Paying</small><b>${fmt(s.paying)}</b></div><div><small>Rate</small><b>${fmt(s.rate)}%</b></div><div><small>Lifetime</small><b>${usd2(B.lifetime)}</b></div><div><small>Settling</small><b>${usd2(B.pending)}</b></div><div><small>Available</small><b>${usd2(B.available)}</b></div><div><small>Requested</small><b>${usd2(B.open)}</b></div><div><small>Paid out</small><b>${usd2(B.paid)}</b></div>${B.owed > 0 ? `<div><small>Owed back</small><b>${usd2(B.owed)}</b></div>` : ''}</div>
      <h4 class="po-h4">Earnings by product <small>${usd2(s.spend_usd)} spent by their people</small></h4>
      ${s.by_product.length ? `<div class="po-bp">${s.by_product.map((p) => `<div class="po-bpr">${productIcon(p, 'xs')}<span class="po-bpn">${esc(p.name)}<small>${usd2(p.spend)} spent · ${fmt(p.count)} ${p.count === 1 ? 'payment' : 'payments'}</small></span><span class="po-bpb"><i style="width:${Math.max(2, (p.earned / mx) * 100).toFixed(1)}%"></i></span><b>${usd2(p.earned)}</b></div>`).join('')}</div>` : '<p class="muted sm">No earnings yet.</p>'}
      ${(s.excluded || []).length ? `<h4 class="po-h4">Not counted <small>Spend by banned or erased members earns nothing</small></h4><div class="po-hist">${s.excluded.map((x) => `<div class="po-hr"><a href="#customers/${x.id}"><b>${esc(x.name)}</b></a><span class="pill pill-w">Excluded: ${x.reason === 'erased' ? 'erased' : 'banned'}</span><span class="muted sm">${usd2(x.spend_usd)} spent</span></div>`).join('')}</div>` : ''}
      ${compact ? '' : `<h4 class="po-h4">History</h4>${s.history.length ? `<div class="po-hist">${s.history.map((h) => `<div class="po-hr"><b>${usd2(h.amount_usd)}</b>${poPill(h.status)}<span class="muted sm">${dateStr(h.paid_at || h.decided_at || h.requested_at)}</span>${h.reference ? `<code class="po-ref" title="${esc(h.reference)}">${esc(h.reference)}</code>` : ''}${h.note ? `<small class="po-hn">${esc(h.note)}</small>` : ''}</div>`).join('')}</div>` : '<p class="muted sm">No payouts yet.</p>'}`}
    </div>`;
  }

  async function payoutModal(id, done) {
    const m = modal({ title: 'Payout', body: skelRows(4, 60), wide: true });
    let d;
    try { d = await GET('/api/admin/payouts/' + id); } catch (e) { m.q('.vs-modal-b').innerHTML = errorBox(e, false); return; }
    const draw = () => {
      const p = d.payout; const s = d.summary; const mine = !!S.me && p.member.id === S.me.id;
      // Four eyes: your own payout is handled by another team member with payments access (the server refuses it too).
      const open = ['requested', 'processing'].includes(p.status) && !mine;
      m.q('.vs-modal-h h3').textContent = `Payout #${p.id}`;
      m.q('.vs-modal-b').innerHTML = `<div class="po-top">
          <div class="po-mem">${av(p.member.avatar, 'lg', p.member.email)}<span><b>${esc(p.member.name)}</b><small>${esc(p.member.email)}</small>${can('customers') || can('support') ? `<a class="lnk sm" href="#customers/${p.member.id}">Open customer</a>` : ''}</span></div>
          <div class="po-big"><small>${p.status === 'paid' ? 'Paid' : 'To send'}</small><b>${usd2(p.amount_usd)}</b>${poPill(p.status)}</div>
        </div>
        <div class="po-cols">
          ${mine && ['requested', 'processing'].includes(p.status) ? `<p class="warn-line">${icon('lock')}<span>This is your own payout. Another team member with payments access has to send it and mark it paid.</span></p>` : ''}
          ${open && s.balance.settled - s.balance.paid + 0.005 < p.amount_usd ? `<p class="warn-line">${icon('flag')}<span>This request is more than their settled earnings (${usd2(s.balance.settled)}) minus what was already paid (${usd2(s.balance.paid)}). A refund or a lower rate may have changed it. Check before you send.</span></p>` : ''}
          <section class="po-box"><h4 class="po-h4">${icon(PO_METHOD_IC[p.method && p.method.type] || 'wallet')}${esc(p.method ? p.method.label : 'Payout details')}<small>As saved when they asked</small></h4>${poDetails(p.method)}
            <dl class="dl po-dl"><dt>Requested</dt><dd>${fullDate(p.requested_at)}</dd><dt>Rate then</dt><dd>${fmt(p.rate)}%</dd>${p.decided_at ? `<dt>${p.status === 'cancelled' ? 'Cancelled' : 'Updated'}</dt><dd>${fullDate(p.decided_at)}${p.decided_by ? ` by ${esc(p.decided_by)}` : ''}</dd>` : ''}${p.reference ? `<dt>Reference</dt><dd><code class="po-ref">${esc(p.reference)}</code> <button type="button" class="ib2" data-copy="${esc(p.reference)}" aria-label="Copy reference">${icon('copy')}</button></dd>` : ''}${p.note ? `<dt>Note</dt><dd>${esc(p.note)}</dd>` : ''}</dl>
            ${open ? `<form class="po-act stack" id="poPay" novalidate><h4 class="po-h4">${icon('check')}Mark as paid</h4><p class="muted sm">Send ${usd2(p.amount_usd)} from the Zedapex wallet or bank first. Then paste the transaction hash or bank reference.</p>
              ${field('Transaction hash or reference', input('reference', '', { ph: p.method && p.method.type === 'usdt_trc20' ? '64-character TRON transaction hash' : 'Bank or mobile money reference', cls: 'mono' }))}
              ${field('Note to the member (optional)', input('note', '', { ph: 'For example: sent with M-Pesa B2C' }))}
              <div class="row wrap"><button type="submit" class="btn btn-g btn-sm">${icon('check')}Mark paid and email them</button>${p.status === 'requested' ? `<button type="button" class="btn btn-w btn-sm" id="poProc">${icon('send')}Mark as sending</button>` : ''}<span class="grow"></span><button type="button" class="btn btn-danger btn-sm" id="poRej">Not sent</button></div></form>` : ''}
          </section>
          <section class="po-box">${poSummaryHtml(s)}</section>
        </div>`;
      const pf = m.q('#poPay');
      if (!pf) return;
      const after = async (r, msg) => { if (!r) return; toast(msg); d = await GET('/api/admin/payouts/' + id); draw(); refreshBadges(); if (done) done(); };
      pf.addEventListener('submit', async (e) => {
        e.preventDefault(); const v = readForm(pf);
        if (String(v.reference || '').trim().length < 4) { toast('Paste the transaction hash or reference first.', 'err'); $('[name=reference]', pf).focus(); return; }
        after(await run($('button[type=submit]', pf), () => POST(`/api/admin/payouts/${id}/paid`, v)), 'Marked paid. The member gets an email with the reference.');
      });
      const pr = m.q('#poProc'); if (pr) pr.onclick = async () => after(await run(pr, () => POST(`/api/admin/payouts/${id}/processing`)), 'Marked as sending');
      const rj = m.q('#poRej');
      rj.onclick = () => {
        const box = confirmIn(rj, { text: `Do not send this payout? ${usd2(d.payout.amount_usd)} goes back to their available balance and they get an email with your reason.`, yes: 'Mark not sent', onYes: async () => {
          const note = $('.rej', box).value.trim();
          if (note.length < 3) throw new Error('Add a short reason the member will see.');
          await POST(`/api/admin/payouts/${id}/reject`, { note }); await after(true, 'Marked not sent. The amount is back in their balance.');
        } });
        $('p', box).insertAdjacentHTML('afterend', '<input class="inp rej" placeholder="Reason the member will see, for example: wallet name did not match" aria-label="Reason">');
      };
    };
    draw();
  }

  /**
   * Add or edit one payment method. `preset` (from the picker) fills a new one.
   * Type-specific config controls are named cfg_<key>; manual details and Gatevoo assets are read separately.
   */
  function methodModal(m, types, done, preset) {
    const isNew = !m || !m.id;
    m = m || { name: '', currency: 'USD', rate: 1, config: {}, enabled: false, countries: [], note: '', ...preset };
    m.config = m.config || {};
    const type = m.type;
    const T = types[type] || { fields: [], secrets: [], label: type };
    const md = modal({ title: (isNew ? 'Add ' : 'Edit ') + (type === 'manual' && !m.name ? 'custom method' : m.name || T.label), wide: true, body: '<form id="pmF" class="stack" novalidate></form>' });
    const f = md.q('#pmF');
    const c = m.config;
    const secretHint = (k, hint) => (String(c[k] || '').startsWith('••••') ? 'Saved. Leave it as it is to keep it, or paste a new one.' : hint);
    const cfgField = (k, o = {}) => {
      const [lab, hint] = CFG_LABEL[k] || [k, ''];
      const secret = (T.secrets || []).includes(k);
      const v = c[k] ?? '';
      if (k === 'instructions') return field(o.label || lab, textarea('cfg_' + k, v, { rows: 3, ph: o.ph }), o.hint || hint);
      if (k === 'body_template') return field(lab, textarea('cfg_' + k, v, { rows: 5, cls: 'mono', ph: '{"amount": {{amount}}, "currency": "{{currency}}", "reference": "{{order_id}}", "email": "{{email}}", "callback_url": "{{return_url}}"}', spell: 'false' }), hint);
      return field(o.label || lab, input('cfg_' + k, v, { type: secret ? 'password' : 'text', ac: 'new-password', ph: o.ph }), secret ? secretHint(k, hint) : (o.hint || hint));
    };
    const proofSeg = () => `<div class="field"><span class="lbl">Proof of payment</span>${seg('cfg_proof_mode', PROOF_MODES, c.proof_mode || 'either')}<span class="hint">What the member sends after paying. You approve each payment in Orders.</span></div>`;
    let specific = '';
    if (type === 'gatevoo') {
      const assets = c.assets && c.assets.length ? c.assets : ['USDT_TRC20', 'BTC'];
      specific = `<div class="info-line sm">${productIcon({ icon: 'gatevoo', name: 'Gatevoo' }, 'xs')}<span>Members pay on Gatevoo's page and money goes straight to your wallet. Prices stay in USD; Gatevoo converts to USDT or BTC.</span></div>
        ${cfgField('api_base', { ph: 'https://gatevoo.com' })}<div class="g2c">${cfgField('api_key')}${cfgField('webhook_secret', { hint: 'Paste the same secret into Gatevoo. We check every webhook with it.' })}</div>
        <div class="field"><span class="lbl">Coins members can pay with</span><div class="chk-row" data-noform><label class="chk"><input type="checkbox" data-asset="USDT_TRC20"${assets.includes('USDT_TRC20') ? ' checked' : ''}>USDT (TRC20)</label><label class="chk"><input type="checkbox" data-asset="BTC"${assets.includes('BTC') ? ' checked' : ''}>Bitcoin</label></div></div>`;
    } else if (type === 'manual') {
      const det = (c.details && c.details.length ? c.details : [{ label: '', value: '' }]).map((d) => [d.label, d.value]);
      specific = `<div class="field"><span class="lbl">Icon</span><div class="icon-pick sm" role="radiogroup" aria-label="Icon"><button type="button" role="radio" class="ini-b ${!c.icon ? 'on' : ''}" data-ic="" aria-checked="${!c.icon}" aria-label="Initials">${esc(pmInitials(m.name || 'Pay'))}</button>${PM_ICONS.map((k) => `<button type="button" role="radio" aria-checked="${k === c.icon}" aria-label="${esc(k)}" data-ic="${k}" class="${k === c.icon ? 'on' : ''}">${icon(k)}</button>`).join('')}</div><input type="hidden" name="cfg_icon" value="${esc(c.icon || '')}"></div>
        <div class="field det-rows"><span class="lbl">Payment details</span>${rowsEditor(det, [{ ph: 'Label, e.g. Account number', aria: 'Label' }, { ph: 'Value members copy', aria: 'Value' }], { add: 'Add a row' })}<span class="hint">Up to 6 rows. Each value gets a copy button at checkout.</span></div>
        ${cfgField('instructions', { label: 'Instructions', ph: 'Example: Use your order number as the transfer narration.', hint: 'Shown under the details. Plain text; links work.' })}${proofSeg()}`;
    } else if (type === 'crypto') {
      specific = `<div class="g2c">${cfgField('network', { ph: 'TRON (TRC20)' })}${cfgField('address')}</div>${cfgField('instructions')}${proofSeg()}<p class="muted sm">For another coin or network, add another crypto method.</p>`;
    } else if (type === 'custom') {
      specific = `<div class="g2c">${cfgField('create_url', { ph: 'https://api.provider.com/checkout' })}${cfgField('auth_header', { ph: 'Authorization: Bearer sk_live_...' })}</div>
        ${cfgField('body_template')}
        <div class="g2c"><div class="field"><span class="lbl">Amount sent</span>${seg('cfg_amount_mode', [['local', 'In the method currency'], ['usd', 'In USD']], c.amount_mode || 'local')}</div><div class="field"><span class="lbl">Units</span>${switchField('cfg_minor_units', c.minor_units, 'Send in minor units', 'Cents or kobo: 20.00 becomes 2000')}</div></div>
        <div class="g2c">${cfgField('url_field', { ph: 'data.url' })}${cfgField('id_field', { ph: 'data.id' })}</div>
        <div class="g3c">${cfgField('verify_url', { ph: 'https://api.provider.com/verify' })}${cfgField('status_field', { ph: 'data.status' })}${cfgField('paid_value', { ph: 'paid' })}</div>
        ${cfgField('webhook_secret', { hint: 'We check the x-signature header: hex HMAC-SHA256 of the raw body with this secret.' })}`;
    } else {
      specific = (T.fields || []).map((k) => cfgField(k)).join('');
    }
    const gv = type === 'gatevoo';
    f.innerHTML = `${field('Name members see', input('name', m.name, { ph: type === 'manual' ? 'For example: MTN Mobile Money' : T.label }))}
      ${gv ? '' : `<div class="g2c">${field('Currency code', input('currency', m.currency, { ph: 'NGN', max_len: 10 }))}${field('Rate per 1 USD', input('rate', m.rate, { type: 'number', step: 'any', min: 0 }), 'How much of this currency equals 1 USD. Example: 1600 for NGN.')}</div>`}
      <fieldset class="cfg stack"><legend>${esc(T.label)}</legend>${specific}</fieldset>
      <div class="g2c">${field('Countries', input('countries', (m.countries || []).join(', '), { ph: 'NG, GH, KE' }), 'Two-letter codes. Empty shows it everywhere.')}${field('Internal note', input('note', m.note, { ph: 'Only the team sees this' }))}</div>
      ${switchField('enabled', m.enabled, 'Members can use this method')}
      ${T.webhook ? `<div class="webhook">${icon('link')}<div><b>Webhook URL</b>${isNew ? '<p class="muted sm">Save the method first. The webhook URL appears here.</p>' : `<p class="muted sm">Paste this into your provider dashboard under webhooks so paid orders unlock straight away.</p>${codeBlock(m.webhook_url)}`}</div></div>` : ''}
      <div id="pmTest" hidden></div>
      <div class="row end" data-cfm>${isNew || m.orders ? '' : `<button type="button" class="btn btn-danger btn-sm" id="pmDel">${icon('trash')}Delete</button>`}${T.test ? `<button type="button" class="btn btn-w btn-sm" id="pmTestB">${icon('refresh')}Test connection</button>` : ''}<button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><button type="submit" class="btn btn-g btn-sm">${isNew ? 'Add method' : 'Save method'}</button></div>`;
    $('[data-x]', f).onclick = md.close;
    const ip = $('.icon-pick', f);
    if (ip) ip.addEventListener('click', (e) => { const b = e.target.closest('[data-ic]'); if (!b) return; $$('button', ip).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); $('[name=cfg_icon]', f).value = b.dataset.ic; });
    const nameIn = $('[name=name]', f), ini = $('.ini-b', f);
    if (ini) nameIn.addEventListener('input', () => { ini.textContent = pmInitials(nameIn.value || 'Pay'); });
    const del = $('#pmDel', f);
    if (del) del.onclick = () => confirmIn(del, { text: `Delete ${m.name}? It has no orders, so nothing else changes.`, yes: 'Delete method', onYes: async () => { await DEL('/api/admin/payment-methods/' + m.id); toast('Method deleted'); md.close(); done(); } });
    const collect = () => {
      const v = readForm(f);
      const config = {};
      Object.entries(v).forEach(([k, x]) => { if (k.startsWith('cfg_')) config[k.slice(4)] = x; });
      if (type === 'manual') { const re = $('.det-rows .re', f); config.details = readRows(re).map(([label, value]) => ({ label, value })).filter((d) => d.label || d.value).slice(0, 6); }
      if (gv) config.assets = $$('[data-asset]', f).filter((x) => x.checked).map((x) => x.dataset.asset);
      return { id: m.id, type, name: v.name, currency: gv ? 'USD' : v.currency, rate: gv ? 1 : v.rate, config, countries: v.countries, note: v.note, enabled: v.enabled };
    };
    const tb = $('#pmTestB', f);
    if (tb) tb.onclick = async () => {
      const out = $('#pmTest', f);
      const r = await run(tb, () => POST('/api/admin/payment-methods/test', collect()));
      if (!r) return;
      out.hidden = false;
      out.innerHTML = `<div class="test-out ${r.ok ? 'ok' : 'bad'}">${r.checks.map((x) => `<p>${icon('check')}<span>${esc(x)}</span></p>`).join('')}${r.problems.map((x) => `<p>${icon('flag')}<span>${esc(x)}</span></p>`).join('')}${r.ok && !r.checks.length ? `<p>${icon('check')}<span>Settings look complete.</span></p>` : ''}</div>`;
    };
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = collect();
      if (!gv && !(Number(body.rate) > 0)) { toast('Set how much of the currency equals 1 USD.', 'err'); return; }
      if (type === 'manual' && !String(body.name || '').trim()) { toast('Give the method a name members will recognise.', 'err'); nameIn.focus(); return; }
      if (gv && !body.config.assets.length) { toast('Pick at least one coin.', 'err'); return; }
      const r = await run($('button[type=submit]', f), () => POST('/api/admin/payment-methods', body), isNew ? 'Method added' : 'Method saved');
      if (r) { done(); if (isNew && T.webhook) { md.close(); methodModal(r.method, types, done); toast('Method added. Copy the webhook URL into your provider.'); } else md.close(); }
    });
  }

  /* =====================================================================
   * FREE TOOLS (member app calculators)
   * ===================================================================== */
  const KS_FIELDS = [
    ['kill_zero_mult', 'Kill with no conversions after', '× target CPA spent', '0.1'],
    ['kill_cpa_mult', 'Kill when CPA is above', '× target CPA', '0.1'],
    ['kill_after_mult', '… once spend reaches', '× target CPA', '0.1'],
    ['hold_band', 'Hold when CPA is within', '% of target', '1'],
    ['scale_cpa_mult', 'Scale when CPA is under', '× target CPA', '0.05'],
    ['scale_min_conv', '… with at least', 'conversions', '1'],
    ['scale_pct', 'Scale budget by', '%', '1'],
    ['big_cpa_mult', 'Scale more when CPA is under', '× target CPA', '0.05'],
    ['big_min_conv', '… with at least', 'conversions', '1'],
    ['big_pct_min', 'Scale more by, from', '%', '1'],
    ['big_pct_max', '… up to', '%', '1'],
  ];
  page('tools', {
    t: 'Free tools', i: 'calc', perm: () => can('content'),
    async r(el) {
      const sub = 'The calculators in the member app. Choose which are on, which are Free or Premium, and their order. The website shows the same list.';
      el.innerHTML = `${pageHead('Free tools', sub)}${skelRows(8, 64)}`;
      let d;
      try { d = await GET('/api/admin/settings/tools'); } catch (e) { el.innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      const cat = d.catalog || [];
      const val = d.value || { tools: {}, kill_scale: {} };
      let order = cat.map((t) => t.key).sort((a, b) => ((val.tools[a] || {}).sort ?? 99) - ((val.tools[b] || {}).sort ?? 99));
      el.innerHTML = `${pageHead('Free tools', sub, `<a class="btn btn-w btn-sm" href="/app#tools" target="_blank" rel="noopener">${icon('ext')}Open in the app</a>`)}
        <div class="card stack"><div class="card-h"><div><h3>Tools</h3><span class="sub">Premium tools show to free members as a locked preview with your Premium price. The maths runs in the browser; saving scenarios is Premium only and checked on the server.</span></div><div class="r"><button type="button" class="btn btn-g btn-sm" id="tlSave">Save tools</button></div></div>
          <div class="tla-list" id="tlL"></div></div>
        <form class="card stack mt" id="ksF" novalidate><div class="card-h"><div><h3>Kill or scale rules</h3><span class="sub">Checked in this order: kill, scale more, scale, then hold. Members see these rules under the verdict.</span></div><div class="r"><button type="button" class="btn btn-w btn-sm" id="ksReset">Use defaults</button><button class="btn btn-g btn-sm" type="submit">Save rules</button></div></div>
          <div class="tla-ks">${KS_FIELDS.map(([k, l, unit, step]) => `<label class="tla-kf"><span class="lbl">${esc(l)}</span><span class="tla-ki">${input(k, val.kill_scale[k], { type: 'number', step, min: 0, im: 'decimal', aria: l })}<em>${esc(unit)}</em></span></label>`).join('')}</div>
          <p class="hint" id="ksPrev"></p></form>`;
      const L = $('#tlL', el);
      const paint = () => {
        L.innerHTML = order.map((k, i) => {
          const t = cat.find((x) => x.key === k) || { key: k, name: k, line: '', icon: 'calc' };
          const v = val.tools[k] || { enabled: true, access: t.access || 'free' };
          return `<div class="tla-row${v.enabled ? '' : ' off'}" data-k="${esc(k)}"><span class="tla-ic">${icon(t.icon)}</span><div class="tla-t"><b>${esc(t.name)}</b><small>${esc(t.line)}</small></div>
            ${switchField('en_' + k, v.enabled, 'On')}${seg('ac_' + k, [['free', 'Free'], ['premium', 'Premium']], v.access)}
            <span class="re-act"><button type="button" class="ib2" data-mv="-1" aria-label="Move ${esc(t.name)} up"${i ? '' : ' disabled'}>${icon('up')}</button><button type="button" class="ib2" data-mv="1" aria-label="Move ${esc(t.name)} down"${i < order.length - 1 ? '' : ' disabled'}>${icon('down')}</button></span></div>`;
        }).join('');
      };
      const readTools = () => {
        $$('.tla-row', L).forEach((r) => { const k = r.dataset.k; val.tools[k] = { enabled: $(`[name="en_${k}"]`, r).checked, access: $(`[name="ac_${k}"]`, r).value, sort: order.indexOf(k) }; });
        return val.tools;
      };
      paint();
      L.addEventListener('change', (e) => { const r = e.target.closest('.tla-row'); if (r && e.target.type === 'checkbox') r.classList.toggle('off', !e.target.checked); });
      L.addEventListener('click', (e) => {
        const mv = e.target.closest('[data-mv]'); if (!mv) return;
        readTools();
        const k = mv.closest('.tla-row').dataset.k; const i = order.indexOf(k); const j = i + Number(mv.dataset.mv);
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        paint();
        const b = $(`.tla-row[data-k="${k}"] [data-mv="${mv.dataset.mv}"]`, L); if (b && !b.disabled) b.focus();
      });
      $('#tlSave', el).onclick = (e) => run(e.currentTarget, async () => { const r = await saveSetting('tools', { tools: readTools(), kill_scale: val.kill_scale }); Object.assign(val, r.value); }, 'Tools saved');

      const kf = $('#ksF', el);
      const ksPrev = () => { const v = readForm(kf); $('#ksPrev', el).textContent = `Example with a $25 target CPA: kill at $${fmt(25 * (Number(v.kill_zero_mult) || 0), 2)} spent with no conversions; scale +${v.scale_pct || 0}% when CPA is $${fmt(25 * (Number(v.scale_cpa_mult) || 0), 2)} or less with ${v.scale_min_conv || 0}+ conversions.`; };
      kf.addEventListener('input', ksPrev); ksPrev();
      $('#ksReset', el).onclick = () => { const D = { kill_zero_mult: 2, kill_cpa_mult: 1.5, kill_after_mult: 3, hold_band: 20, scale_cpa_mult: 0.8, scale_min_conv: 3, scale_pct: 20, big_cpa_mult: 0.6, big_min_conv: 10, big_pct_min: 30, big_pct_max: 50 }; Object.entries(D).forEach(([k, x]) => { const i = $(`[name="${k}"]`, kf); if (i) i.value = x; }); ksPrev(); toast('Defaults filled in. Save to apply.'); };
      kf.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = readForm(kf);
        run($('button[type=submit]', kf), async () => {
          const r = await saveSetting('tools', { tools: readTools(), kill_scale: v });
          Object.assign(val, r.value);
          Object.entries(r.value.kill_scale).forEach(([k, x]) => { const i = $(`[name="${k}"]`, kf); if (i) i.value = x; });
          ksPrev();
        }, 'Rules saved');
      });
    },
  });

  /* =====================================================================
   * PLANS & REFERRALS
   * ===================================================================== */
  page('plans', {
    t: 'Plans and referrals', i: 'diamond', perm: () => can('settings'),
    async r(el) {
      el.innerHTML = `${pageHead('Plans and referrals', 'What Premium costs and includes, the free plan, and how referrals pay.')}${skelCards(3, 260)}`;
      let pr, fr, rf;
      try { [pr, fr, rf] = await Promise.all(['premium', 'free_plan', 'referrals'].map((k) => GET('/api/admin/settings/' + k).then((r) => r.value || {}))); } catch (e) { el.innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      el.innerHTML = `${pageHead('Plans and referrals', 'What Premium costs and includes, the free plan, and how referrals pay.')}
        <div class="ed-grid">
          <form class="card stack" id="prF" novalidate><div class="card-h"><div><h3>Premium</h3><span class="sub">Members pay this through your payment methods.</span></div><div class="r">${switchField('enabled', pr.enabled, 'On sale')}</div></div>
            <div class="g2c">${field('Plan name', input('name', pr.name))}${field('Tagline', input('tagline', pr.tagline))}</div>
            <div class="g2c">${field('Price (USD)', input('price_usd', pr.price_usd, { type: 'number', min: 0, step: '0.01' }))}${field('Period (days)', input('period_days', pr.period_days, { type: 'number', min: 1 }), '30 is about a month.')}</div>
            <div class="field"><span class="lbl">What is included</span>${listEditor(pr.features || [], { ph: 'A feature, in plain words', add: 'Add feature' })}</div>
            <div class="row end"><button class="btn btn-g btn-sm" type="submit">Save Premium</button></div></form>
          <div class="stack"><div class="card prev-card"><span class="muted xs mono">Live preview</span><div id="prP"></div></div>
            <form class="card stack" id="frF" novalidate><div class="card-h"><h3>Free plan</h3></div>${field('Name', input('name', fr.name))}<div class="field"><span class="lbl">Included</span>${listEditor(fr.features || [], { ph: 'Feature', add: 'Add feature' })}</div><div class="row end"><button class="btn btn-g btn-sm" type="submit">Save free plan</button></div></form></div>
        </div>
        <form class="card stack mt" id="rfF" novalidate><div class="card-h"><div><h3>Referrals</h3><span class="sub">Members earn a share of what the people they refer spend. The rate grows with paying referrals.</span></div></div>
          <div class="field"><span class="lbl">Tiers</span>${rowsEditor((rf.tiers || []).map((t) => [t.min, t.rate]), [{ ph: 'Paying referrals from', type: 'number', aria: 'Minimum paying referrals' }, { ph: 'Rate %', type: 'number', step: 'any', aria: 'Rate percent' }], { add: 'Add tier' })}<span class="hint">Left: minimum paying referrals. Right: percent of their spend.</span></div>
          <div class="g2c">${field('Minimum payout (USD)', input('min_withdraw', rf.min_withdraw, { type: 'number', min: 0 }), 'Members can request a payout from this available balance.')}${field('Settle after (days)', input('settle_days', rf.settle_days, { type: 'number', min: 0 }), 'Each earning waits this long after the payment before it can be paid out.')}</div>
          <div class="tiers-prev" id="tpv"></div>
          ${field('Payout terms', textarea('terms', rf.terms || '', { rows: 5, ph: rf.default_terms || '' }), 'Shown on every member\'s Referrals page. Leave empty to use the default text shown here.')}
          <p class="info-line">${icon('wallet')}<span>Members request a payout once their settled earnings reach the minimum. Send it from the Zedapex wallet or bank, then mark it paid in <a class="lnk" href="#payouts">Payouts</a>.</span></p>
          <div class="row end"><button class="btn btn-g btn-sm" type="submit">Save referrals</button></div></form>`;
      const pf = $('#prF', el), ff = $('#frF', el), rff = $('#rfF', el);
      const pv = () => { const v = readForm(pf); const feats = readList($('.re', pf)); $('#prP', el).innerHTML = `<div class="price-card ${v.enabled ? '' : 'off'}"><span class="pc-k">${icon('diamond')}${esc(v.name || 'Premium')}</span><p class="pc-tag">${esc(v.tagline)}</p><div class="pc-p"><b>$${esc(fmt(v.price_usd || 0, Number(v.price_usd) % 1 ? 2 : 0))}</b><span>/ ${Number(v.period_days) === 30 ? 'month' : esc(v.period_days) + ' days'}</span></div><ul>${feats.map((x) => `<li>${icon('check')}${esc(x)}</li>`).join('')}</ul><span class="btn btn-l btn-block">Go Premium</span>${v.enabled ? '' : '<span class="off-tag">Not on sale</span>'}</div>`; };
      pf.addEventListener('input', pv); pv();
      const tp = () => { const tiers = readRows($('.re', rff)).filter((r) => r[0] !== '' || r[1]).sort((a, b) => a[0] - b[0]); $('#tpv', el).innerHTML = tiers.map((t) => `<span class="tier"><b>${t[1]}%</b><small>from ${t[0]} paying</small></span>`).join(''); };
      rff.addEventListener('input', tp); tp();
      pf.addEventListener('submit', (e) => { e.preventDefault(); const v = readForm(pf); run($('button[type=submit]', pf), () => saveSetting('premium', { ...pr, ...v, features: readList($('.re', pf)) }), 'Premium saved'); });
      ff.addEventListener('submit', (e) => { e.preventDefault(); run($('button[type=submit]', ff), () => saveSetting('free_plan', { ...fr, name: $('[name=name]', ff).value.trim(), features: readList($('.re', ff)) }), 'Free plan saved'); });
      rff.addEventListener('submit', (e) => { e.preventDefault(); const v = readForm(rff); const tiers = readRows($('.re', rff)).filter((r) => r[1] > 0).map((r) => ({ min: Math.max(0, Number(r[0]) || 0), rate: Number(r[1]) })).sort((a, b) => a.min - b.min); run($('button[type=submit]', rff), () => saveSetting('referrals', { tiers, min_withdraw: Number(v.min_withdraw) || 0, settle_days: Number(v.settle_days) || 0, terms: v.terms || '' }), 'Referral settings saved'); });
    },
  });

  /* =====================================================================
   * EMAILS
   * ===================================================================== */
  const SEGMENTS = [['all', 'Everyone'], ['premium', 'Premium members'], ['free', 'Free members'], ['new', 'Joined in the last 30 days']];
  page('emails', {
    t: 'Emails', i: 'mail', perm: () => can('emails'),
    async r(el) {
      el.innerHTML = `${pageHead('Emails', 'Templates, the welcome series, broadcasts and the send queue.')}${skelCards(3, 200)}`;
      let d;
      const load = async () => { d = await GET('/api/admin/emails'); };
      try { await load(); } catch (e) { el.innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      const nameOf = (k) => (d.templates.find((t) => t.key === k) || { name: k }).name;
      let cur = (d.templates[0] || {}).key;
      el.innerHTML = `${pageHead('Emails', 'Templates, the welcome series, broadcasts and the send queue.')}
        <div class="status-card ${d.ready ? 'ok' : 'warn'}">${icon(d.ready ? 'check' : 'mail')}<div><b>${d.ready ? 'Email provider connected' : 'Console mode'}</b><p>${d.ready ? 'Emails go out through your provider.' : 'No provider is set, so emails print to the server log instead of being sent.'} ${d.stats.map((s) => `${fmt(s.n)} ${esc(s.status)}`).join(' · ')}</p></div>${!d.ready && can('settings') ? '<a class="btn btn-k btn-sm" href="#settings">Set up a provider</a>' : ''}</div>
        <div class="em-grid mt">
          <div class="card em-list"><div class="card-h"><h3>Templates</h3></div><div id="tplL"></div><div class="danger-mini" data-cfm><button type="button" class="btn btn-ghost btn-xs" id="resetT">${icon('refresh')}Reset all templates to default</button></div></div>
          <div class="card stack" id="tplE"></div>
        </div>
        <div class="g2 mt">
          <form class="card stack" id="seqF" novalidate><div class="card-h"><div><h3>Welcome series</h3><span class="sub">Sent to every new member in this order. Hours count from sign-up.</span></div></div><div id="seqL"></div><div class="row end"><button type="submit" class="btn btn-g btn-sm">Save series</button></div></form>
          <form class="card stack" id="bcF" novalidate data-cfm><div class="card-h"><div><h3>Broadcast</h3><span class="sub">Goes to members who accept marketing emails. Sent in batches of 50 a minute.</span></div></div>
            ${field('Send to', select('segment', SEGMENTS, 'all'))}${field('Subject', input('subject', '', { ph: 'What is in it for them' }))}${field('Title', input('title', '', { ph: 'Big line at the top' }))}${field('Message', textarea('body', '', { rows: 5, ph: 'Blank line between paragraphs.' }))}
            <div class="g2c">${field('Button text', input('cta_text', '', { ph: 'Open VooSquare' }))}${field('Button link', input('cta_url', '', { ph: 'https://...' }))}</div>
            <div class="row end"><button type="submit" class="btn btn-g btn-sm">${icon('send')}Review and send</button></div></form>
        </div>
        <div class="card flush mt"><div class="toolbar"><h3>Queue</h3><span class="muted sm">Latest 60</span><button type="button" class="btn btn-w btn-xs grow-r" id="qR">${icon('refresh')}Refresh</button></div><div id="qL"></div></div>`;
      const drawT = () => { $('#tplL', el).innerHTML = [['Transactional', 0], ['Marketing', 1]].map(([g, mk]) => { const ts = d.templates.filter((t) => !!t.marketing === !!mk).sort((x, y) => x.name.localeCompare(y.name, 'en', { numeric: true })); return ts.length ? `<h5 class="grp">${g}</h5>${ts.map((t) => `<button type="button" class="tpl ${t.key === cur ? 'on' : ''}" data-k="${esc(t.key)}"><b>${esc(t.name)}</b><small>${esc(t.subject)}</small></button>`).join('')}` : ''; }).join(''); };
      const openT = async (key) => {
        cur = key; drawT();
        const box = $('#tplE', el);
        box.innerHTML = skelRows(4, 60);
        let r;
        try { r = await GET('/api/admin/emails/' + encodeURIComponent(key)); } catch (e) { box.innerHTML = errorBox(e, false); return; }
        if (!el.isConnected || cur !== key) return;
        const t = r.template;
        box.innerHTML = `<div class="card-h" data-cfm><div><h3>${esc(t.name)}</h3><span class="sub mono">${esc(t.key)} · ${t.marketing ? 'Marketing' : 'Transactional'} · ${r.customised ? `edited ${timeAgo(t.updated_at)}` : 'default design'}</span></div><div class="r">${r.customised ? `<button type="button" class="btn btn-ghost btn-xs" id="tReset" title="Replaces this template with the current default design. Your edits to it are lost.">${icon('refresh')}Reset to new design</button>` : ''}<button type="button" class="btn btn-w btn-xs" id="tTest">${icon('send')}Send test to me</button></div></div>
          <form class="stack" id="tF" novalidate>${field('Subject', input('subject', t.subject))}${field('Preheader', input('preheader', t.preheader, { ph: 'Grey preview line in the inbox' }))}
          <div class="em-ed"><div class="stack">${field('HTML', textarea('html', t.html, { rows: 14, cls: 'mono-ta', spell: 'false' }), 'Use {{name}}, {{firstName}} and the variables this email gets. Triple braces insert HTML.')}${field('Plain text version', textarea('text', t.text, { rows: 5, cls: 'mono-ta' }))}</div>
          <div class="field"><span class="lbl">Preview <small class="muted">(example data, refreshes after save)</small></span><iframe class="em-frame" sandbox="" title="Email preview"></iframe></div></div>
          <div class="row end"><button type="submit" class="btn btn-g btn-sm">Save template</button></div></form>`;
        $('.em-frame', box).srcdoc = r.preview;
        $('#tF', box).addEventListener('submit', async (e) => {
          e.preventDefault();
          const ok = await run($('button[type=submit]', e.target), () => PUT('/api/admin/emails/' + encodeURIComponent(key), readForm(e.target)), 'Template saved');
          if (ok) { try { const p = await GET('/api/admin/emails/' + encodeURIComponent(key)); if (p.customised && !$('#tReset', box)) { const tt0 = d.templates.find((x) => x.key === key); if (tt0) { tt0.subject = p.template.subject; drawT(); } openT(key); return; } $('.em-frame', box).srcdoc = p.preview; const tt = d.templates.find((x) => x.key === key); if (tt) { tt.subject = p.template.subject; drawT(); } } catch { /* ignore */ } }
        });
        $('#tTest', box).onclick = (e) => run(e.currentTarget, () => POST(`/api/admin/emails/${encodeURIComponent(key)}/test`), (x) => (x.console ? `Printed to the server log (console mode) for ${x.sent_to}` : `Test sent to ${x.sent_to}`));
        const tr = $('#tReset', box);
        if (tr) tr.onclick = () => confirmIn(tr, { text: `Replace “${t.name}” with the new default design? Your edits to this template are lost.`, yes: 'Reset template', onYes: async () => { await POST(`/api/admin/emails/${encodeURIComponent(key)}/reset`, {}); toast('Template reset to the new design'); await load(); drawT(); openT(key); } });
      };
      $('#tplL', el).addEventListener('click', (e) => { const b = e.target.closest('.tpl'); if (b) openT(b.dataset.k); });
      const rt = $('#resetT', el);
      rt.onclick = () => confirmIn(rt, { text: 'Reset every template and the welcome series to the defaults? Your edits are lost.', yes: 'Reset all', typed: 'RESET', onYes: async () => { await POST('/api/admin/emails/reset', {}); toast('Templates reset'); await load(); drawT(); drawSeq(); if (cur) openT(cur); } });

      const drawSeq = () => { $('#seqL', el).innerHTML = d.sequence.length ? `<div class="seq">${d.sequence.map((s, i) => `<div class="seq-r" data-k="${esc(s.key)}"><span class="step-n">${i + 1}</span><span class="seq-t"><b>${esc(nameOf(s.key))}</b><small class="mono">${esc(s.key)}</small></span><label class="mini-in"><input class="inp" type="number" min="0" step="any" value="${s.delay_hours}" aria-label="Hours after sign-up for ${esc(nameOf(s.key))}"><span>hours</span></label>${switchField('en', s.enabled, 'On')}<span class="re-act"><button type="button" class="ib2" data-mv="-1" aria-label="Move up">${icon('up')}</button><button type="button" class="ib2" data-mv="1" aria-label="Move down">${icon('down')}</button></span></div>`).join('')}</div>` : empty('mail', 'No welcome emails', 'The series comes from the default email files.'); };
      $('#seqL', el).addEventListener('click', (e) => { const mv = e.target.closest('[data-mv]'); if (!mv) return; const r = mv.closest('.seq-r'); const sib = mv.dataset.mv === '-1' ? r.previousElementSibling : r.nextElementSibling; if (!sib) return; if (mv.dataset.mv === '-1') r.parentNode.insertBefore(r, sib); else r.parentNode.insertBefore(sib, r); $$('.seq-r .step-n', el).forEach((n, i) => { n.textContent = i + 1; }); });
      $('#seqF', el).addEventListener('submit', async (e) => { e.preventDefault(); const sequence = $$('.seq-r', el).map((r) => ({ key: r.dataset.k, delay_hours: Number($('input[type=number]', r).value) || 0, enabled: $('[name=en]', r).checked })); const r = await run($('button[type=submit]', e.target), () => PUT('/api/admin/email-sequence', { sequence }), 'Welcome series saved'); if (r) { d.sequence = r.sequence; drawSeq(); } });

      const bf = $('#bcF', el);
      bf.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = readForm(bf);
        if (!v.subject.trim() || !v.body.trim()) { toast('Add a subject and a message.', 'err'); return; }
        const seg = SEGMENTS.find((s) => s[0] === v.segment)[1];
        confirmIn($('button[type=submit]', bf), { text: `Send "${v.subject}" to: ${seg} (only people who accept marketing emails). This cannot be stopped once queued.`, yes: 'Send broadcast', danger: false, onYes: async () => { const r = await POST('/api/admin/broadcast', v); toast(`Queued for ${fmt(r.queued)} ${r.queued === 1 ? 'person' : 'people'}`); bf.reset(); loadQ(); } });
      });

      const loadQ = async () => { try { const r = await GET('/api/admin/emails'); d.queue = r.queue; } catch { /* keep */ } drawQ(); };
      const drawQ = () => { $('#qL', el).innerHTML = d.queue.length ? `<div class="tbl"><table><thead><tr><th>Email</th><th>To</th><th>Status</th><th>When</th><th>Error</th></tr></thead><tbody>${d.queue.map((q) => `<tr><td data-l="Email"><b>${esc(nameOf(q.template))}</b><small class="mono">${esc(q.template)}</small></td><td data-l="To">${esc(q.to_email)}</td><td data-l="Status">${statusPill(q.status)}</td><td data-l="When">${q.sent_at ? 'Sent ' + timeAgo(q.sent_at) : 'Due ' + fullDate(q.send_at)}</td><td data-l="Error" class="err-td">${esc(q.error || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('mail', 'Nothing in the queue'); };
      $('#qR', el).onclick = (e) => run(e.currentTarget, loadQ);
      drawT(); drawSeq(); drawQ();
      if (cur) openT(cur); else $('#tplE', el).innerHTML = empty('mail', 'No templates');
    },
  });

  /* =====================================================================
   * TEAM & ROLES
   * ===================================================================== */
  const PERM_INFO = {
    customers: ['Customers', 'See members, give Premium, mute and ban'], support: ['Support', 'Answer conversations in the inbox'], community: ['Community', 'Rooms, rules and moderation'],
    academy: ['Academy', 'Courses and lessons'], blog: ['Blog', 'Write and publish posts'], content: ['Site content', 'Top card, announcement bar and ads'], products: ['Products', 'Tools, keys and integrations'],
    payments: ['Payments', 'Methods and orders'], emails: ['Emails', 'Templates and broadcasts'], team: ['Team', 'Add and remove staff, see the audit log'], settings: ['Settings', 'Plans, brand and email provider'],
    aff_manager: ['Affiliate manager', 'Review applications and look after their assigned affiliates'], aff_fraud: ['Affiliate fraud check', 'Review CPA conversions, duplicates and fraud signals'],
    aff_finance: ['Affiliate finance', 'Affiliate payouts, KYC, adjustments and fraud reversals'],
    aff_admin: ['Affiliate super admin', 'Every program setting, rates and custom deals up to 90%. Only for people you trust with your margins'],
  };
  /* Affiliate super admin is never part of a preset: the owner ticks it on purpose (owner guide: "a super admin can set up to 90%"). */
  const SUPER = 'aff_admin';
  const PRESETS = () => [
    ['owner', 'Owner', 'Everything, including other owners', ['*']],
    ['admin', 'Admin', 'Every section. Affiliate super admin is a separate tick', S.allPerms.filter((p) => p !== SUPER)],
    ['support', 'Support agent', 'Inbox and customers, for the products you pick', ['support', 'customers']],
    ['content', 'Content editor', 'Ads, announcements and the top card only', ['content']],
    ['community', 'Community moderator', 'Rooms and moderation', ['community']],
    ['academy', 'Academy editor', 'Courses, lessons and the blog', ['academy', 'blog']],
    ['finance', 'Finance', 'Payment methods, orders and affiliate payouts', ['payments', 'aff_finance']],
  ].filter((p) => p[0] !== 'owner' || isOwner());

  /* Affiliate program back office: it lives in the affiliate app (same look as the affiliate dashboard), role-gated by
   * aff_admin / aff_manager / aff_fraud / aff_finance. This entry opens it. */
  const AFF_PERMS = ['aff_admin', 'aff_manager', 'aff_fraud', 'aff_finance']; // the back office lets in these roles only, so nobody else sees a dead end
  page('affiliates', {
    t: 'Affiliates', i: 'users', perm: () => AFF_PERMS.some(can),
    async r(el) {
      const base = '/affiliates';
      const role = can('aff_admin') ? 'admin/overview' : can('aff_manager') ? 'mgr/home' : can('aff_fraud') ? 'fraud/queue' : 'fin/payouts';
      el.innerHTML = `${pageHead('Affiliate program', 'Applications, CPA review, payouts, contests and program settings.')}
        <div class="card aff-launch"><div><h3>Open the affiliate back office</h3><p class="muted">It opens in the affiliate app with the same look affiliates see. What you can do there follows your affiliate roles.</p></div>
        <div class="row-a"><a class="btn btn-g" href="/affiliates#/${role}" data-aff-open>${icon('ext')}Open back office</a><a class="btn btn-w" href="${esc(base)}" target="_blank" rel="noopener">${icon('globe')}Public affiliate site</a></div></div>`;
    },
  });

  page('team', {
    t: 'Team and roles', i: 'shield', perm: () => can('team'),
    async r(el) {
      el.innerHTML = `${pageHead('Team and roles', 'Who can open the admin and what each person can change.', `<button type="button" class="btn btn-g btn-sm" id="invite">${icon('plus')}Add someone</button>`)}<div id="tmL">${skelCards(4, 150)}</div>`;
      let team = [];
      const load = async () => {
        try { team = (await GET('/api/admin/team')).team; } catch (e) { $('#tmL', el).innerHTML = errorBox(e); return; }
        if (!el.isConnected) return;
        $('#tmL', el).innerHTML = `<div class="cards">${team.map((u) => { const scope = u.support_scope || []; const owner = u.perms.includes('*'); return `<div class="tm card" data-id="${u.id}" data-cfm>
          <div class="tm-h">${av(u.avatar, 'lg', u.email)}<span><b>${esc(u.name)}${u.id === S.me.id ? ' <small class="muted">(you)</small>' : ''}</b><small>${esc(u.email)}</small><span class="role">${esc(u.role_title || (owner ? 'Owner' : 'Team'))}</span></span></div>
          <div class="chips-s">${owner ? '<span class="pc all">Everything</span>' : u.perms.map((p) => `<span class="pc">${esc((PERM_INFO[p] || [p])[0])}</span>`).join('')}</div>
          ${!owner && u.perms.includes('support') ? `<p class="scope">${icon('inbox')}Support for: ${scope.includes('*') || !scope.length ? 'all products' : scope.map((id) => esc((productById(id) || { name: '#' + id }).name)).join(', ')}</p>` : ''}
          <div class="row"><button type="button" class="btn btn-w btn-xs" data-edit>${icon('pen')}Edit access</button><button type="button" class="btn btn-danger btn-xs" data-rm${owner && !isOwner() ? ' disabled' : ''}>Remove access</button></div></div>`; }).join('')}</div>`;
      };
      $('#tmL', el).addEventListener('click', (e) => {
        const card = e.target.closest('.tm'); if (!card) return;
        const u = team.find((x) => x.id === Number(card.dataset.id));
        if (e.target.closest('[data-edit]')) memberModal(u, load);
        const rm = e.target.closest('[data-rm]');
        if (rm) confirmIn(rm, { text: u.id === S.me.id ? 'Remove your own admin access? You will be signed out of the admin.' : `Remove ${u.name}'s admin access? Their member account stays.`, yes: 'Remove access', onYes: async () => { await DEL('/api/admin/team/' + u.id); toast('Access removed'); if (u.id === S.me.id) return boot(); load(); } });
      });
      $('#invite', el).onclick = () => memberModal(null, load);
      load();
    },
  });

  function memberModal(u, done) {
    const isNew = !u;
    u = u || { email: '', name: '', role_title: '', perms: ['support', 'customers'], support_scope: ['*'] };
    const md = modal({ title: isNew ? 'Add someone to the team' : 'Edit access for ' + u.name, wide: true, body: `<form id="tmF" class="stack" novalidate>
      <div class="g2c">${field('Email', input('email', u.email, { type: 'email', ph: 'name@company.com', ro: !isNew }), isNew ? 'If they have no Voo ID yet, we create one and email them.' : '')}${isNew ? field('Name', input('name', '', { ph: 'Their name' })) : field('Name', input('_n', u.name, { ro: true }))}</div>
      <div class="field"><span class="lbl">Start from a role</span><div class="presets">${PRESETS().map(([k, l, d]) => `<button type="button" class="preset" data-p="${k}"><b>${esc(l)}</b><small>${esc(d)}</small></button>`).join('')}</div></div>
      ${field('Role title', input('role_title', u.role_title, { ph: 'Support agent, Content editor...' }), 'Shown next to their name in the community and support replies.')}
      <fieldset class="perms"><legend>Permissions</legend>${isOwner() ? `<label class="perm owner"><input type="checkbox" value="*"${u.perms.includes('*') ? ' checked' : ''}><span><b>Owner</b><small>Everything, including other owners</small></span></label>` : ''}${S.allPerms.map((p, i) => `${/^aff_/.test(p) && !/^aff_/.test(S.allPerms[i - 1] || '') ? '<p class="perm-sub">Affiliate program back office</p>' : ''}<label class="perm${p === SUPER ? ' perm-warn' : ''}"><input type="checkbox" value="${p}"${u.perms.includes(p) || u.perms.includes('*') ? ' checked' : ''}><span><b>${esc(PERM_INFO[p] ? PERM_INFO[p][0] : p)}</b><small>${esc(PERM_INFO[p] ? PERM_INFO[p][1] : '')}</small></span></label>`).join('')}</fieldset>
      <fieldset class="scope-f"><legend>Support scope</legend><p class="muted sm">Which products' conversations they can see and answer.</p>${switchField('scope_all', (u.support_scope || []).includes('*') || !(u.support_scope || []).length, 'All products')}<div class="scope-list">${S.products.map((p) => `<label class="sc"><input type="checkbox" value="${p.id}"${(u.support_scope || []).map(Number).includes(p.id) ? ' checked' : ''}>${productIcon(p, 'xs')}<span>${esc(p.name)}</span></label>`).join('')}</div></fieldset>
      ${isNew ? '' : switchField('notify', false, 'Email them about the change')}
      <div class="row end"><button type="button" class="btn btn-ghost btn-sm" data-x>Cancel</button><button type="submit" class="btn btn-g btn-sm">${isNew ? 'Add to team' : 'Save access'}</button></div></form>` });
    const f = md.q('#tmF');
    const permBoxes = () => $$('.perms input', f);
    const sync = () => {
      const owner = $('.perms input[value="*"]', f);
      const isO = owner && owner.checked;
      permBoxes().forEach((b) => { if (b.value !== '*') { b.disabled = isO; if (isO) b.checked = true; } });
      const sup = $('.perms input[value=support]', f).checked && !isO;
      $('.scope-f', f).hidden = !sup;
      const all = $('[name=scope_all]', f).checked;
      $('.scope-list', f).classList.toggle('dim', all);
      $$('.scope-list input', f).forEach((b) => { b.disabled = all; });
      const cur = permBoxes().filter((b) => b.checked && !b.disabled || (b.value === '*' && b.checked)).map((b) => b.value).sort().join(',');
      $$('.preset', f).forEach((b) => { const p = PRESETS().find((x) => x[0] === b.dataset.p); b.classList.toggle('on', [...p[3]].sort().join(',') === cur || (p[0] === 'owner' && isO)); });
    };
    f.addEventListener('change', sync);
    $('.presets', f).addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      const [, label, , perms] = PRESETS().find((x) => x[0] === b.dataset.p);
      const owner = $('.perms input[value="*"]', f); if (owner) owner.checked = perms.includes('*');
      permBoxes().forEach((x) => { if (x.value !== '*') { x.disabled = false; x.checked = perms.includes(x.value); } });
      const rt = $('[name=role_title]', f); if (!rt.value || PRESETS().some((p) => p[1] === rt.value)) rt.value = label;
      sync();
    });
    md.q('[data-x]').onclick = md.close;
    sync();
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(f);
      const owner = $('.perms input[value="*"]', f);
      const perms = owner && owner.checked ? ['*'] : permBoxes().filter((b) => b.checked && b.value !== '*').map((b) => b.value);
      if (!perms.length) { toast('Give at least one permission.', 'err'); return; }
      const scope = v.scope_all ? ['*'] : $$('.scope-list input:checked', f).map((b) => Number(b.value));
      if (perms.includes('support') && !scope.length) { toast('Pick at least one product for support, or choose All products.', 'err'); return; }
      const r = await run($('button[type=submit]', f), () => POST('/api/admin/team', { email: v.email, name: v.name, role_title: v.role_title, perms, support_scope: scope, notify: !!v.notify }), isNew ? 'Added to the team' : 'Access saved');
      if (r) { md.close(); if (u.id === S.me.id) boot(); else done(); }
    });
  }

  page('audit', {
    t: 'Audit log', i: 'clock', perm: () => can('team'),
    async r(el) {
      el.innerHTML = `${pageHead('Audit log', 'The latest 200 changes made in the admin and by payment webhooks.')}<div class="card flush"><div class="toolbar"><label class="sbox grow">${icon('search')}<input type="search" id="auQ" placeholder="Filter by person, action or detail" aria-label="Filter the audit log"></label></div><div id="auL">${skelRows(8, 44)}</div></div>`;
      let rows;
      try { rows = (await GET('/api/admin/audit')).audit; } catch (e) { $('#auL', el).innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      const draw = (f = '') => {
        const list = f ? rows.filter((a) => `${a.name} ${a.action} ${a.detail}`.toLowerCase().includes(f.toLowerCase())) : rows;
        $('#auL', el).innerHTML = list.length ? `<div class="tbl"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${list.map((a) => `<tr><td data-l="When" title="${esc(fullDate(a.created_at))}">${fullDate(a.created_at)}</td><td data-l="Who">${esc(a.name || 'System')}</td><td data-l="Action"><span class="act-tag">${esc(a.action)}</span></td><td data-l="Detail" class="detail">${esc(a.detail || '')}</td></tr>`).join('')}</tbody></table></div>` : empty('clock', f ? 'Nothing matches' : 'No changes yet');
      };
      $('#auQ', el).addEventListener('input', debounce((e) => draw(e.target.value.trim()), 150));
      draw();
    },
  });

  /* =====================================================================
   * SETTINGS
   * ===================================================================== */
  /** App review account (owner only, src/ugc.js): an email and a fixed 6-digit code for Apple and Google reviewers. */
  async function reviewCard(box) {
    let d;
    try { d = (await GET('/api/admin/review-login')).review; } catch { box.remove(); return; }
    if (!box.isConnected) return;
    const draw = () => {
      const st = d.env.active ? pill('Set by environment', 'b') : d.enabled ? pill('On', 'g') : pill('Off', 'w');
      box.innerHTML = `<form class="card stack" id="rvF" novalidate><div class="card-h"><div><h3>App review account</h3><span class="sub">Store reviewers can't receive an email code. This lets them sign in with a fixed code instead, as an ordinary free member.</span></div><div class="r">${st}</div></div>
        ${switchField('enabled', d.enabled, 'Allow the review sign-in', 'Off by default. Normal email codes keep working for this email too.')}
        <div class="g2c">${field('Review email', input('email', d.email, { type: 'email', ph: 'review@voosquare.com' }), "Not yours or a team member's. The account is created as a free member named App Review.")}${field('6-digit code', input('code', '', { im: 'numeric', max_len: 6, ph: d.has_code ? 'Saved. Type a new code to change it' : 'For example 246810', ac: 'new-password' }), d.has_code ? 'Saved and never shown again. Leave empty to keep it.' : 'Only digits. Never shown again after saving.')}</div>
        <p class="info-line sm">${icon('shield')}<span>Give this email and code to Apple and Google in the review notes. Turn it off after approval if you like.</span></p>
        ${d.env.active ? `<p class="info-line sm">${icon('settings')}<span>REVIEW_LOGIN_EMAIL and REVIEW_LOGIN_CODE are set on the server${d.env.valid ? ` (${esc(d.env.email)})` : ', but the email or the 6-digit code is not valid'}. They are used instead of what is saved here.</span></p>` : ''}
        <div class="row end"><button class="btn btn-g btn-sm" type="submit">Save review account</button></div></form>`;
      const f = $('#rvF', box);
      const code = $('[name=code]', f);
      code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const v = readForm(f);
        const r = await run($('button[type=submit]', f), () => PUT('/api/admin/review-login', { enabled: v.enabled, email: v.email.trim(), code: v.code }), v.enabled ? 'Review account saved and on' : 'Review account saved');
        if (r && box.isConnected) { d = r.review; draw(); }
      });
    };
    draw();
  }

  page('settings', {
    t: 'Settings', i: 'settings', perm: () => can('settings'),
    async r(page_, args) {
      /* Tabs: General (this page), Features and Backups (in /js/admin-ops.js). */
      const tabs = [['general', 'General', 'settings'], ['features', 'Features', 'sliders'], ...(isOwner() ? [['backups', 'Backups', 'shield'], ['bin', 'Recycle bin', 'trash']] : [])];
      const tab = tabs.some((t) => t[0] === args[0]) ? args[0] : 'general';
      const sub = { general: 'Brand details, the email provider, time zone and resets.', features: 'Turn parts of VooSquare on and off without a rebuild. Nothing is deleted.', backups: 'Copies of the database you can download. Owner only.', bin: 'Put back what the team deleted. Owner only.' }[tab];
      page_.innerHTML = `${pageHead('Settings', sub)}<nav class="tabs st-tabs" aria-label="Settings sections">${tabs.map(([k, l, ic]) => `<a href="#settings${k === 'general' ? '' : '/' + k}" class="${k === tab ? 'on' : ''}"${k === tab ? ' aria-current="page"' : ''}>${icon(ic)}${l}</a>`).join('')}</nav><div class="st-body"></div>`;
      const el = $('.st-body', page_);
      if (tab !== 'general') return VSA.settingsTab(tab, el);
      el.innerHTML = skelCards(2, 260);
      let brand, em, rtz;
      try { [brand, em, rtz] = await Promise.all([GET('/api/admin/settings/brand'), GET('/api/admin/settings/email'), GET('/api/admin/settings/reporting_tz')]); } catch (e) { el.innerHTML = errorBox(e); return; }
      if (!el.isConnected) return;
      const b = brand.value || {}, e = em.value || {}, env = em.email_env || {};
      el.innerHTML = `
        <div class="g2">
          <form class="card stack" id="brF" novalidate><div class="card-h"><div><h3>Brand</h3><span class="sub">Used in emails, the footer and support replies.</span></div></div>
            <div class="g2c">${field('Company', input('company', b.company), 'The legal name in email footers, for example Zedapex Limited.')}${field('Founder', input('founder', b.founder), 'Shown on the website and in welcome emails.')}</div>
            ${field('Support email', input('support_email', b.support_email, { type: 'email' }), 'Where members can write to you. Shown in emails and the footer.')}
            <div class="g3c">${field('Telegram', input('telegram', b.telegram, { ph: 'https://t.me/...' }), 'Full link. Leave empty to hide.')}${field('X', input('x', b.x, { ph: 'https://x.com/...' }), 'Full link. Leave empty to hide.')}${field('Instagram', input('instagram', b.instagram, { ph: 'https://instagram.com/...' }), 'Full link. Leave empty to hide.')}</div>
            <div class="row end"><button class="btn btn-g btn-sm" type="submit">Save brand</button></div></form>
          <form class="card stack" id="emF" novalidate><div class="card-h"><div><h3>Email provider</h3><span class="sub">Sends login codes, receipts, support replies and broadcasts.</span></div><div class="r">${env.ready ? pill('Connected', 'g') : pill('Console mode', 'gold')}</div></div>
            <div class="g2c">${field('Provider', select('provider', [['', 'Not set'], ['resend', 'Resend'], ['brevo', 'Brevo'], ['postmark', 'Postmark']], e.provider || ''), 'The service that delivers your emails.')}${field('API key', input('api_key', e.api_key || '', { type: 'password', ac: 'new-password', ph: 'Paste the key' }), e.api_key ? 'Saved. Leave it as it is to keep it.' : 'From your provider dashboard. Never shown again after saving.')}</div>
            <div class="g2c">${field('From address', input('from', e.from || '', { ph: env.from || 'VooSquare <hello@voosquare.com>' }), 'The domain must be verified with your provider.')}${field('Reply-to', input('reply_to', e.reply_to || '', { ph: 'support@voosquare.com' }), 'Where replies to your emails go. Optional.')}</div>
            <p class="info-line sm">${icon('settings')}<span>You can also set EMAIL_PROVIDER, EMAIL_API_KEY and EMAIL_FROM as environment variables. Values saved here are used first.${env.provider ? ` Environment now: ${esc(env.provider)}${env.has_key ? ' with a key' : ' without a key'}.` : ''}</span></p>
            <div class="row end"><button class="btn btn-g btn-sm" type="submit">Save email settings</button></div></form>
        </div>
        <form class="card stack mt" id="tzF" novalidate><div class="card-h"><div><h3>Reporting time zone</h3><span class="sub">Revenue days, weeks (Monday to Sunday) and months are cut in this time zone. Changing it only changes how reports group sales, never the sales themselves.</span></div></div>
          <div class="row tz-row">${field('Time zone', `<input class="inp" name="tz" list="tzList" value="${esc(rtz.value || 'Africa/Lagos')}" autocomplete="off" spellcheck="false" aria-describedby="tzNow"><datalist id="tzList">${(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Accra', 'Africa/Douala', 'Europe/London', 'UTC']).map((z) => `<option value="${esc(z)}">`).join('')}</datalist>`, '', 'grow')}<button class="btn btn-g btn-sm" type="submit">Save time zone</button></div>
          <p class="info-line sm" id="tzNow">${icon('clock')}<span></span></p></form>
        <div class="card stack mt" id="storC"><div class="card-h"><div><h3>Image storage</h3><span class="sub">Shared images, support screenshots and payment proofs, on the server volume.</span></div>${can('community') ? '<a class="r btn btn-ghost btn-xs" href="#community/images">Image settings</a>' : ''}</div><div class="skel" style="height:70px"></div></div>
        ${isOwner() ? '<div id="rvBox" class="mt"></div>' : ''}
        ${isOwner() ? `<div class="card danger-zone mt" data-cfm><div class="card-h"><div><h3>Danger zone</h3><span class="sub">Owner only.</span></div></div><div class="dz-r"><div><b>Reset Academy and blog to defaults</b><p class="muted sm">Deletes every course, lesson and post, then loads the default content again. Member progress on removed lessons is lost.</p></div><button type="button" class="btn btn-danger btn-sm" id="reseed">Reset content</button></div></div>` : ''}`;
      $('#brF', el).addEventListener('submit', (ev) => { ev.preventDefault(); run($('button[type=submit]', ev.target), () => saveSetting('brand', { ...b, ...readForm(ev.target) }), 'Brand saved'); });
      $('#emF', el).addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const r = await run($('button[type=submit]', ev.target), () => saveSetting('email', readForm(ev.target)), 'Email settings saved');
        if (r) { const s = await GET('/api/admin/settings/email').catch(() => null); if (s && el.isConnected) { const pl = $('#emF .card-h .r', el); pl.innerHTML = s.email_env.ready ? pill('Connected', 'g') : pill('Console mode', 'gold'); $('[name=api_key]', el).value = s.value.api_key || ''; } }
      });
      const tzF = $('#tzF', el); const tzIn = $('[name=tz]', tzF);
      const tzShow = () => { const z = tzIn.value.trim(); let txt; try { txt = `Local time there now: ${new Date().toLocaleString('en-GB', { timeZone: z, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`; } catch { txt = 'Pick a time zone from the list, for example Africa/Lagos.'; } $('#tzNow span', tzF).textContent = txt; };
      tzIn.addEventListener('input', tzShow); tzShow();
      tzF.addEventListener('submit', (ev) => { ev.preventDefault(); run($('button[type=submit]', tzF), () => saveSetting('reporting_tz', tzIn.value.trim()), 'Time zone saved'); });
      GET('/api/admin/uploads/stats').then((r) => { const c = $('#storC .skel', el); if (c) c.outerHTML = storageCard(r.stats); }).catch(() => { const c = $('#storC', el); if (c) c.remove(); });
      if (isOwner()) reviewCard($('#rvBox', el));
      const rs = $('#reseed', el);
      if (rs) rs.onclick = () => confirmIn(rs, { text: 'This replaces all courses, lessons and posts with the defaults. Type RESET to confirm.', yes: 'Reset Academy and blog', typed: 'RESET', onYes: async () => { await POST('/api/admin/reseed-content', { confirm: 'RESET' }); toast('Academy and blog reset to defaults'); } });
    },
  });

  /* =====================================================================
   * BOOT
   * ===================================================================== */
  Object.assign(VSA, {
    S, PAGES, NAV, page, can, isOwner, GET, POST, PUT, PATCH, DEL, saveSetting, run, modal, confirmIn, undoToast, guard, askLeave,
    field, input, textarea, select, switchField, seg, readForm, pill, empty, errorBox, skelRows, skelCards, pageHead, backLink, av,
    usd, mb: (b) => mb(b), fullDate, debounce, route, canMoney, storageCard: (s) => storageCard(s), setBadge,
  });

  async function boot() {
    app.innerHTML = '<div class="boot"><span class="logo-chip">' + VS.PI.voosquare + '</span></div>';
    try {
      const r = await GET('/api/admin/me');
      S.me = r.user; S.perms = r.user.perms || []; S.allPerms = r.perms || []; S.products = r.products || [];
      S.route = null; S.handle = null;
      renderShell();
    } catch (e) {
      S.me = null;
      if (e.status === 401) renderLogin();
      else if (e.status === 403) { let u = null; try { u = (await GET('/api/me')).user; } catch { /* ignore */ } renderNoAccess(u); }
      else { document.body.className = 'adm-auth'; app.innerHTML = `<div class="auth"><div class="auth-panel"><div class="auth-card center">${errorBox(e)}</div></div></div>`; }
    }
  }
  boot();
})();
