/*!
 * VooSquare support widget. Add to any website:
 *   <script src="https://YOUR-VOOSQUARE-DOMAIN/widget.js" data-product="joinvoo" defer></script>
 * Optional: data-color="#5B3FE8" data-position="left" data-email="known@user.com" data-name="Known User"
 * Messages land in the VooSquare admin support inbox under that product.
 */
(function () {
  'use strict';
  if (window.__vsWidget) return;
  window.__vsWidget = true;
  var script = document.currentScript || document.querySelector('script[src*="widget.js"][data-product]');
  if (!script) return;
  var base = new URL(script.src, location.href).origin;
  var slug = script.getAttribute('data-product') || 'voosquare';
  var pos = script.getAttribute('data-position') === 'left' ? 'left' : 'right';
  var KEY = 'vs_widget_' + slug;
  var store = {
    get: function (k) { try { return localStorage.getItem(KEY + k) || ''; } catch (e) { return ''; } },
    set: function (k, v) { try { localStorage.setItem(KEY + k, v); } catch (e) { /* ignore */ } },
  };
  var token = store.get('_t');
  var cfg = null; var open = false; var msgs = []; var pollT = null; var lastCount = Number(store.get('_seen') || 0);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function req(path, body) {
    return fetch(base + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) { var e = new Error(d && d.error || 'Something went wrong'); e.off = !!(d && (d.off || d.maintenance)); throw e; } return d; }); });
  }

  var host = document.createElement('div');
  host.style.cssText = 'position:fixed;z-index:2147483000;bottom:0;' + pos + ':0;';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  document.body.appendChild(host);
  /* Phones: the button slides away while the visitor scrolls down through the page (so it never sits on top of a heading,
   * card or footer link) and comes back as soon as they scroll up, or near the top of the page. */
  var lastY = window.scrollY || 0;
  window.addEventListener('scroll', function () {
    var y = window.scrollY || 0;
    if (Math.abs(y - lastY) < 6) return;
    var hide = window.innerWidth <= 640 && !open && y > lastY && y > 160;
    if (host.classList) host.classList.toggle('hid', hide);
    lastY = y;
  }, { passive: true });

  function color() { return script.getAttribute('data-color') || (cfg && cfg.product.color) || '#00A86B'; }

  var sending = false;
  function render() {
    var c = color();
    // Keep what the visitor is typing when a reply arrives and the panel redraws.
    var keep = {};
    ['tx', 'nm', 'em'].forEach(function (id) { var el = root.querySelector && root.querySelector('#' + id); if (el) keep[id] = el.value; });
    var hadFocus = root.activeElement && root.activeElement.id;
    root.innerHTML = '<style>' +
      ':host,*{box-sizing:border-box;font-family:"Plus Jakarta Sans",system-ui,-apple-system,"Segoe UI",sans-serif}' +
      '.b{position:fixed;bottom:18px;' + pos + ':18px;width:58px;height:58px;border-radius:20px;background:' + c + ';color:#fff;border:0;cursor:pointer;display:grid;place-items:center;box-shadow:0 14px 32px -10px rgba(0,0,0,.45);transition:transform .3s cubic-bezier(.2,.8,.2,1),opacity .3s}' +
      ':host(.hid) .b{transform:translateY(96px);opacity:0;pointer-events:none}' +
      '.b:hover{transform:translateY(-3px)}.b svg{width:28px;height:28px}.dot{position:absolute;top:-3px;right:-3px;min-width:20px;height:20px;border-radius:10px;background:#D9362E;color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;padding:0 5px;border:2px solid #fff}' +
      '.p{position:fixed;bottom:88px;' + pos + ':16px;width:min(370px,calc(100vw - 32px));height:min(560px,calc(100vh - 120px));background:#fff;border-radius:24px;box-shadow:0 40px 80px -24px rgba(0,0,0,.45);display:flex;flex-direction:column;overflow:hidden;border:1px solid #E3EBE7;animation:in .3s cubic-bezier(.2,.9,.3,1.2)}' +
      '@keyframes in{from{transform:translateY(16px) scale(.96);opacity:0}}' +
      '.h{background:' + c + ';color:#fff;padding:16px 16px 18px;display:flex;gap:12px;align-items:center}.h img{width:40px;height:40px;border-radius:12px;background:#fff}' +
      '.h b{display:block;font-size:16px;letter-spacing:-.02em}.h small{opacity:.85;font-size:12.5px;display:flex;align-items:center;gap:6px}.h small i{width:7px;height:7px;border-radius:50%;background:#C9F65B}' +
      '.x{margin-left:auto;background:rgba(255,255,255,.18);border:0;color:#fff;width:34px;height:34px;border-radius:50%;cursor:pointer;font-size:16px}' +
      '.m{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:8px;background:#F5F8F6}' +
      '.g{align-self:flex-start;background:#fff;border:1px solid #E3EBE7;border-radius:16px 16px 16px 6px;padding:10px 12px;font-size:14px;line-height:1.45;color:#0A1A13;max-width:85%}' +
      '.u{align-self:flex-end;background:' + c + ';color:#fff;border-radius:16px 16px 6px 16px;padding:10px 12px;font-size:14px;line-height:1.45;max-width:85%;white-space:pre-wrap;word-wrap:break-word}' +
      '.s{align-self:flex-start;background:#fff;border:1px solid #E3EBE7;border-radius:16px 16px 16px 6px;padding:10px 12px;font-size:14px;line-height:1.45;color:#0A1A13;max-width:85%;white-space:pre-wrap;word-wrap:break-word}' +
      '.n{font-size:11px;color:#8A9A93;margin:2px 4px}.n.r{align-self:flex-end}' +
      '.id{padding:10px 12px 0;display:grid;grid-template-columns:1fr 1fr;gap:8px;background:#fff}' +
      'input,textarea{width:100%;border:1.5px solid #E3EBE7;background:#F5F8F6;border-radius:12px;padding:10px 12px;font-size:14px;color:#0A1A13;outline:none}input:focus,textarea:focus{border-color:' + c + ';background:#fff}' +
      '.f{display:flex;gap:8px;padding:10px 12px 12px;background:#fff;align-items:flex-end}textarea{resize:none;max-height:120px;min-height:44px}' +
      '.go{width:44px;height:44px;border-radius:14px;border:0;background:' + c + ';color:#fff;cursor:pointer;display:grid;place-items:center;flex:none}.go svg{width:20px;height:20px}.go:disabled{opacity:.5}' +
      '.ft{font-size:11px;color:#8A9A93;text-align:center;padding:0 0 10px;background:#fff}.ft a{color:#00774B;font-weight:700;text-decoration:none}' +
      '.e{color:#D9362E;font-size:12.5px;padding:0 14px 6px;background:#fff}' +
      '</style>';
    var btn = document.createElement('button');
    btn.className = 'b';
    btn.setAttribute('aria-label', open ? 'Close support chat' : 'Open support chat');
    btn.innerHTML = open
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5z"/></svg>';
    var staffCount = msgs.filter(function (m) { return m.author_type === 'staff'; }).length;
    if (!open && staffCount > lastCount) btn.insertAdjacentHTML('beforeend', '<span class="dot">' + (staffCount - lastCount) + '</span>');
    btn.onclick = function () { open = !open; if (open) { lastCount = staffCount; store.set('_seen', String(staffCount)); } render(); loop(); };
    root.appendChild(btn);
    if (!open) return;

    var p = document.createElement('div');
    p.className = 'p';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Support chat');
    var name = cfg ? cfg.product.name : 'Support';
    var askId = !store.get('_email') && !script.getAttribute('data-email');
    p.innerHTML = '<div class="h"><img src="' + esc(cfg ? cfg.icon_url : base + '/assets/logo-icon.svg') + '" alt=""><div><b>' + esc(name) + ' support</b><small><i></i>' + (cfg && cfg.online ? 'We are online' : 'We usually reply within a few hours') + '</small></div><button class="x" aria-label="Close">✕</button></div>' +
      '<div class="m" id="m"><div class="g">' + esc(cfg ? cfg.greeting : 'Hi! How can we help?') + '</div>' +
      msgs.map(function (m) { var mine = m.author_type === 'customer'; return '<div class="' + (mine ? 'u' : 's') + '">' + esc(m.body) + '</div><div class="n' + (mine ? ' r' : '') + '">' + (mine ? 'You' : esc(m.author_name || 'Support')) + ' · ' + new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + '</div>'; }).join('') + '</div>' +
      (askId ? '<div class="id"><input id="nm" placeholder="Your name" aria-label="Your name" autocomplete="name"><input id="em" placeholder="Email (for replies)" aria-label="Email" type="email" autocomplete="email"></div>' : '') +
      '<div class="e" id="er" hidden></div>' +
      '<div class="f"><textarea id="tx" rows="1" placeholder="Write a message…" aria-label="Message"></textarea><button class="go" id="go" aria-label="Send"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg></button></div>' +
      '<div class="ft">Powered by <a href="' + base + '" target="_blank" rel="noopener">VooSquare</a></div>';
    root.appendChild(p);
    p.querySelector('.x').onclick = function () { open = false; render(); };
    var m = p.querySelector('#m'); m.scrollTop = m.scrollHeight;
    var tx = p.querySelector('#tx');
    ['tx', 'nm', 'em'].forEach(function (id) { var el = p.querySelector('#' + id); if (el && keep[id]) el.value = keep[id]; });
    tx.oninput = function () { tx.style.height = 'auto'; tx.style.height = Math.min(tx.scrollHeight, 120) + 'px'; };
    tx.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    p.querySelector('#go').onclick = send;
    setTimeout(function () { var f = (hadFocus && p.querySelector('#' + hadFocus)) || tx; f.focus(); }, 50);

    function send() {
      var body = tx.value.trim();
      if (!body || sending) return;
      sending = true;
      var er = p.querySelector('#er');
      var em = p.querySelector('#em'); var nm = p.querySelector('#nm');
      var email = (em && em.value.trim()) || store.get('_email') || script.getAttribute('data-email') || '';
      var nme = (nm && nm.value.trim()) || store.get('_name') || script.getAttribute('data-name') || '';
      p.querySelector('#go').disabled = true;
      req('/api/widget/' + encodeURIComponent(slug) + '/messages', { token: token, body: body, email: email, name: nme, page: location.href })
        .then(function (d) {
          sending = false;
          token = d.token; store.set('_t', token);
          if (email) store.set('_email', email); if (nme) store.set('_name', nme);
          tx.value = '';
          msgs = d.messages; render(); loop();
        })
        .catch(function (e) { sending = false; er.hidden = false; er.textContent = e.message; p.querySelector('#go').disabled = false; });
    }
  }

  function load() {
    if (!token) return;
    req('/api/widget/' + encodeURIComponent(slug) + '/messages?token=' + encodeURIComponent(token)).then(function (d) {
      var changed = d.messages.length !== msgs.length;
      msgs = d.messages;
      if (open) { var sc = msgs.filter(function (m) { return m.author_type === 'staff'; }).length; lastCount = sc; store.set('_seen', String(sc)); }
      if (changed) render();
    }).catch(function () { /* offline: try again later */ });
  }
  function loop() { clearTimeout(pollT); load(); pollT = setTimeout(loop, open ? 4000 : 30000); }

  req('/api/widget/' + encodeURIComponent(slug) + '/config').then(function (d) { cfg = d; render(); loop(); }).catch(function (e) { if (e && e.off) { host.remove(); return; } render(); });
  render();
  window.VooSquareWidget = { open: function () { if (!open) { open = true; render(); load(); } }, close: function () { open = false; render(); } };
})();
