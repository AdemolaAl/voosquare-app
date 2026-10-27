/* VooSquare images: compress in the browser, upload with progress, show thumbnails and a lightbox.
 * Used by the member app and the admin. Depends on window.VS (shared.js). Exposes window.VSM. */
(function () {
  'use strict';
  const VS = window.VS;
  const { esc, icon } = VS;

  const FULL_EDGE = 1600, FULL_TARGET = 350 * 1024, FULL_MAX = 590 * 1024;
  const THUMB_EDGE = 480, THUMB_TARGET = 40 * 1024, THUMB_MAX = 78 * 1024;

  class MediaError extends Error {}
  const isHeic = (f) => /^image\/hei[cf]/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '');

  /** Decode any image the browser understands. EXIF orientation is applied, so photos come out upright. */
  async function decode(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* try <img> below */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }

  const toBlob = (canvas, type, q) => new Promise((res) => canvas.toBlob(res, type, q));
  let webpOk = null;
  async function canWebp() {
    if (webpOk !== null) return webpOk;
    const c = document.createElement('canvas'); c.width = c.height = 2;
    const b = await toBlob(c, 'image/webp', 0.8);
    return (webpOk = !!b && b.type === 'image/webp');
  }

  /**
   * Draw the image at most `edge` px on the long side and encode it under `target` bytes (best effort, `max` hard cap).
   * Re-encoding through a canvas drops all metadata, so EXIF data such as GPS location never leaves the device.
   */
  async function encode(src, edge, target, max, q0) {
    const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
    let scale = Math.min(1, edge / Math.max(sw, sh));
    const type = (await canWebp()) ? 'image/webp' : 'image/jpeg';
    for (let round = 0; round < 6; round++) {
      const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); } // JPEG has no transparency
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      let blob = null;
      for (const q of [q0, q0 - 0.1, q0 - 0.2, q0 - 0.3]) {
        blob = await toBlob(c, type, q);
        if (!blob) throw new MediaError('Your browser could not process that image.');
        if (blob.size <= target) return { blob, w, h, type };
      }
      if (blob.size <= max && round >= 1) return { blob, w, h, type };
      scale *= 0.8;
    }
    throw new MediaError('That image is too detailed to share. Try a smaller one or a screenshot.');
  }

  /** Check, decode and compress a picked file. Resolves { full, thumb, w, h, type, preview }. */
  async function prepare(file) {
    if (!file) throw new MediaError('Pick an image.');
    if (/svg/i.test(file.type)) throw new MediaError('SVG files cannot be shared. Use a PNG, JPG or WebP image.');
    if (file.type && !/^image\//.test(file.type) && !isHeic(file)) throw new MediaError('Only images can be shared here.');
    if (file.size > 40 * 1024 * 1024) throw new MediaError('That file is too large. Pick an image under 40 MB.');
    let src;
    try { src = await decode(file); } catch {
      throw new MediaError(isHeic(file)
        ? 'This browser cannot open HEIC photos. Send a screenshot of the photo instead.'
        : 'That image could not be opened. Try a PNG or JPG.');
    }
    const full = await encode(src, FULL_EDGE, FULL_TARGET, FULL_MAX, 0.8);
    const thumb = await encode(src, THUMB_EDGE, THUMB_TARGET, THUMB_MAX, 0.72);
    if (src.close) src.close();
    return { full: full.blob, thumb: thumb.blob, w: full.w, h: full.h, type: full.type, preview: URL.createObjectURL(thumb.blob) };
  }

  /** Upload a prepared image. Returns { promise, abort }. The body is the full image followed by the thumbnail. */
  function upload(prep, purpose, onProgress) {
    const xhr = new XMLHttpRequest();
    const promise = new Promise((resolve, reject) => {
      xhr.open('POST', '/api/uploads?purpose=' + encodeURIComponent(purpose || 'chat'));
      xhr.setRequestHeader('x-vs', '1');
      xhr.setRequestHeader('x-thumb-bytes', String(prep.thumb.size));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let data = null; try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
        if (xhr.status >= 200 && xhr.status < 300 && data && data.upload) resolve(data.upload);
        else { const e = new Error((data && data.error) || 'The image did not upload. Try again.'); e.status = xhr.status; reject(e); }
      };
      xhr.onerror = () => { const e = new Error('You seem to be offline. Check your connection.'); e.status = 0; reject(e); };
      xhr.onabort = () => { const e = new Error('Upload cancelled.'); e.aborted = true; reject(e); };
      xhr.send(new Blob([prep.full, prep.thumb]));
    });
    return { promise, abort: () => xhr.abort() };
  }

  /**
   * Attach button + preview chip for a composer.
   *   btn: the attach button, chipHost: where the chip renders, purpose: chat|support|proof
   *   onChange(state) is called when an image is added, uploaded or removed.
   * Returns { pick(), add(file), get(): Promise<upload|null>, clear(), has(), busy() }.
   */
  function attacher({ btn, chipHost, purpose = 'chat', onChange, label = 'Photo' }) {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/*'; input.hidden = true;
    document.body.appendChild(input);
    let cur = null; // { prep, job, upload, err, p }
    const notify = () => { if (onChange) onChange({ has: !!cur, uploading: !!(cur && !cur.upload && !cur.err), error: cur && cur.err }); };
    const paint = () => {
      if (!chipHost) return;
      if (!cur) { chipHost.hidden = true; chipHost.innerHTML = ''; return; }
      chipHost.hidden = false;
      const pct = Math.round((cur.p || 0) * 100);
      const state = cur.err ? `<span class="att-err">${esc(cur.err)}</span>` : cur.upload ? `<span class="att-ok">${icon('check')}Ready to send</span>` : cur.prep ? `<span class="att-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${Math.max(6, pct)}%"></i></span><span class="att-pct">${pct}%</span>` : '<span class="att-pct">Preparing image</span>';
      chipHost.innerHTML = `<div class="att-chip ${cur.err ? 'is-err' : ''}"><span class="att-prev">${cur.prep ? `<img src="${cur.prep.preview}" alt="">` : '<span class="skel"></span>'}</span><span class="att-meta"><b>${esc(label)}</b>${state}</span>${cur.err ? '<button type="button" class="att-retry" data-att-retry>Try again</button>' : ''}<button type="button" class="att-x" data-att-x aria-label="Remove image">${icon('x')}</button></div>`;
    };
    const start = () => {
      const c = cur;
      c.err = null; c.p = 0; paint(); notify();
      c.job = upload(c.prep, purpose, (p) => { if (cur === c) { c.p = p; const bar = chipHost && chipHost.querySelector('.att-bar i'); const t = chipHost && chipHost.querySelector('.att-pct'); if (bar) bar.style.width = Math.max(6, Math.round(p * 100)) + '%'; if (t) t.textContent = Math.round(p * 100) + '%'; } });
      c.done = c.job.promise.then((u) => { if (cur === c) { c.upload = u; paint(); notify(); } return u; }, (e) => { if (cur === c && !e.aborted) { c.err = e.message; paint(); notify(); } throw e; });
      c.done.catch(() => {});
    };
    async function add(file) {
      clear();
      const c = { prep: null };
      cur = c; paint(); notify();
      try { c.prep = await prepare(file); } catch (e) { if (cur === c) { cur = null; paint(); notify(); } VS.toast(e.message || 'That image could not be used.', 'err'); return; }
      if (cur !== c) { URL.revokeObjectURL(c.prep.preview); return; }
      start();
    }
    function clear() {
      if (!cur) return;
      const c = cur; cur = null;
      if (c.job && !c.upload) c.job.abort();
      if (c.upload) VS.api('/api/uploads/' + encodeURIComponent(c.upload.id), { method: 'DELETE' }).catch(() => {});
      if (c.prep) setTimeout(() => URL.revokeObjectURL(c.prep.preview), 2000);
      paint(); notify();
    }
    /** Wait for the upload. Resolves the upload, null when there is no image, or throws when it failed. */
    async function get() {
      if (!cur) return null;
      const c = cur;
      if (!c.prep) { await new Promise((r) => { const iv = setInterval(() => { if (cur !== c || c.done) { clearInterval(iv); r(); } }, 60); }); }
      if (cur !== c) return null;
      if (c.err) throw new Error(c.err);
      return c.done;
    }
    /** After a successful send: forget the image without deleting it on the server. */
    function sent() { const c = cur; if (c && c.prep) setTimeout(() => URL.revokeObjectURL(c.prep.preview), 2000); cur = null; paint(); notify(); }
    input.addEventListener('change', () => { const f = input.files && input.files[0]; input.value = ''; if (f) add(f); });
    /** Bind to a button and chip area. Called again when the surrounding view re-renders, so a pending image survives. */
    function mount(b, host) {
      btn = b; chipHost = host;
      if (btn) btn.addEventListener('click', (e) => { e.preventDefault(); input.click(); });
      if (chipHost) chipHost.addEventListener('click', (e) => { if (e.target.closest('[data-att-x]')) clear(); else if (e.target.closest('[data-att-retry]') && cur && cur.prep) start(); });
      paint(); notify();
    }
    mount(btn, chipHost);
    return { pick: () => input.click(), add, get, clear, sent, mount, has: () => !!cur, busy: () => !!(cur && !cur.upload && !cur.err), destroy: () => { clear(); input.remove(); } };
  }

  /** Pull the first image out of a paste or drop event. */
  function fileFrom(dt) {
    if (!dt) return null;
    for (const it of dt.items || []) if (it.kind === 'file' && /^image\//.test(it.type)) return it.getAsFile();
    for (const f of dt.files || []) if (/^image\//.test(f.type) || isHeic(f)) return f;
    return null;
  }

  /** Thumbnail with a fixed box from the stored size, so nothing jumps when it loads. */
  function thumb(att, { maxW = 300, maxH = 300, cls = '' } = {}) {
    if (!att) return '';
    const w = Number(att.w) || 4, h = Number(att.h) || 3;
    const dw = Math.round(Math.min(maxW, maxH * (w / h), w));
    return `<button type="button" class="att ${cls}" data-lb="${esc(att.url)}" data-w="${w}" data-h="${h}" style="width:${Math.max(dw, 80)}px;aspect-ratio:${w}/${h}" aria-label="Open image"><img src="${esc(att.thumb_url)}" alt="Shared image" loading="lazy" decoding="async" width="${w}" height="${h}"></button>`;
  }
  // Fade thumbnails in once they load (the box shows a soft placeholder until then).
  document.addEventListener('load', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.parentElement && t.parentElement.classList.contains('att')) t.parentElement.classList.add('ok'); }, true);
  document.addEventListener('error', (e) => { const t = e.target; if (t && t.tagName === 'IMG' && t.parentElement && t.parentElement.classList.contains('att')) t.parentElement.classList.add('gone'); }, true);

  /* ---------------- lightbox ---------------- */
  function lightbox(src, { w, h } = {}) {
    const prevFocus = document.activeElement;
    const name = 'voosquare-' + (src.split('/').pop() || 'image');
    const el = document.createElement('div');
    el.className = 'lbx';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Image');
    el.innerHTML = `<div class="lbx-bar"><a class="lbx-b" href="${esc(src)}" download="${esc(name)}" aria-label="Download image"><svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg><span>Download</span></a><button type="button" class="lbx-b lbx-x" aria-label="Close">${icon('x')}</button></div>
      <figure class="lbx-f"><img src="${esc(src)}" alt="Shared image"${w && h ? ` width="${w}" height="${h}"` : ''}></figure>`;
    document.body.appendChild(el);
    document.body.classList.add('lbx-open');
    const img = el.querySelector('img');
    requestAnimationFrame(() => el.classList.add('in'));
    let closed = false;
    const close = () => {
      if (closed) return; closed = true;
      el.classList.remove('in'); el.classList.add('out');
      document.removeEventListener('keydown', onKey, true); // same capture flag as addEventListener, or the listener stays and eats every later Escape
      setTimeout(() => { el.remove(); if (!document.querySelector('.lbx')) document.body.classList.remove('lbx-open'); }, 200);
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', (e) => { if (e.target.closest('.lbx-x') || (!e.target.closest('.lbx-bar') && e.target !== img)) close(); });
    // Swipe down to close on phones.
    let y0 = null, dy = 0;
    el.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { y0 = e.touches[0].clientY; dy = 0; img.style.transition = 'none'; } }, { passive: true });
    el.addEventListener('touchmove', (e) => { if (y0 === null) return; dy = Math.max(0, e.touches[0].clientY - y0); img.style.transform = `translateY(${dy}px)`; el.style.setProperty('--fade', String(Math.max(0.35, 1 - dy / 400))); }, { passive: true });
    el.addEventListener('touchend', () => { if (y0 === null) return; y0 = null; img.style.transition = ''; if (dy > 110) close(); else { img.style.transform = ''; el.style.removeProperty('--fade'); } });
    el.querySelector('.lbx-x').focus();
    return { close };
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-lb]');
    if (!t) return;
    e.preventDefault(); e.stopPropagation();
    lightbox(t.dataset.lb, { w: Number(t.dataset.w) || 0, h: Number(t.dataset.h) || 0 });
  }, true);

  window.VSM = { prepare, upload, attacher, thumb, lightbox, fileFrom, MediaError };
})();
