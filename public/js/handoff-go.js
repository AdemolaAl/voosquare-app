/* The one-tap switch as a page (/auth/handoff/go, src/academy.js): asks this site for a single-use link and follows it.
 * A file, not an inline script (Content Security Policy). If anything fails, the button tries again. */
(function () {
  'use strict';
  const h = document.querySelector('[data-handoff]');
  const btn = document.querySelector('[data-handoff-go]');
  const msg = document.querySelector('[data-handoff-msg]');
  if (!h || !btn) return;
  let busy = false;
  async function go() {
    if (busy) return;
    busy = true; btn.disabled = true;
    try {
      const r = await fetch('/api/auth/handoff', { method: 'POST', credentials: 'same-origin', headers: { 'x-vs': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ target: h.dataset.target, next: h.dataset.next }) });
      const d = await r.json().catch(() => null);
      if (r.ok && d && d.url) { location.replace(d.url); return; }
      if (r.status === 401) { location.replace('/login?next=' + encodeURIComponent(location.pathname + location.search)); return; }
      msg.textContent = (d && d.error) || 'That did not work. Tap the button to try again.';
    } catch { msg.textContent = 'You seem to be offline. Tap the button to try again.'; }
    busy = false; btn.disabled = false;
  }
  btn.addEventListener('click', go);
  go();
})();
