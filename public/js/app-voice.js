/* VooSquare member app: the teaching voice in the lesson player (src/voice.js makes the clips).
 *
 * VSV.create(...) returns a narrator the player (app-school.js) calls at each moment: intro, slide, recap, quiz, close.
 * Nothing plays and nothing downloads until the member presses "Listen to this lesson" or the play button (browsers
 * block sound before a gesture, and members on data plans only pay for what they hear). After that the narrator:
 *  - plays each slide's clip, then moves to the next slide when it ends (auto-advance, a member setting);
 *    lab slides wait for the member ("pause and try it"), and slides with no clip yet wait too
 *  - preloads only the next clip, fills the current story bar with the clip's progress
 *  - steps through a walkthrough's sub-steps in time with the clip
 *  - shows the script as captions, lighting each word as it is read (time-proportional; static with reduced motion)
 *  - speed 0.75 to 1.5, mute, captions and auto-advance are saved to the member's voice settings
 *  - remembers where you were inside a clip, per lesson, on this device
 * Intro music: when the lesson starts from its intro, one short track plays first, then the intro voice starts while
 * the music fades out under it (Web Audio gain where available, so the fade also works on iPhones). Once per lesson
 * visit; muted when the member mutes; pressing play during the music starts the voice at once.
 * Keyboard: space plays or pauses, C toggles captions, M mutes. */
(function () {
  'use strict';
  const VS = window.VS;
  const { esc } = VS;
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SPEEDS = [0.75, 1, 1.25, 1.5];
  const svg = (p, cls = '') => `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
  const IC = {
    play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>'),
    pause: svg('<rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none"/>'),
    vol: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11"/>'),
    mute: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>'),
    cc: svg('<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="M10.5 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6"/>'),
    auto: svg('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>'),
    more: svg('<circle cx="5.5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor"/>'),
    wave: svg('<path d="M3 12h1.5M6.5 8v8M10 5v14M13.5 9v6M17 7v10M20.5 11v2"/>'),
  };
  const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const speedTxt = (v) => `${String(v).replace(/^0\./, '.')}×`;

  /** Member voice settings (server), with a small debounce so tapping speed twice sends once. */
  let saveT;
  function savePrefs(p) {
    clearTimeout(saveT);
    saveT = setTimeout(() => { VS.api('/api/school/voice/prefs', { method: 'PUT', body: p }).catch(() => { /* kept for this lesson anyway */ }); }, 450);
  }

  /** Split a script into caption chunks of whole sentences (about two lines each). */
  function chunks(text) {
    const sents = String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g) || [];
    const out = []; let cur = '';
    for (const s of sents) {
      if (cur && (cur + s).length > 150) { out.push(cur.trim()); cur = ''; }
      cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
    let at = 0;
    return out.map((t) => { const c = { t, from: at, words: t.split(' ') }; at += t.length + 1; return c; });
  }

  function create({ voice, lessonId, wrap, ctl, steps, onNext, onPrevSlide, onOpen }) {
    const V = voice && voice.available ? voice : null;
    const prefs = { enabled: true, auto: true, captions: true, speed: 1, ...((voice && voice.prefs) || {}) };
    const state = { active: false, slot: null, clip: null, mode: 'intro', i: -1, walk: null, walkK: 0, build: null, buildT: 0, chunks: [], chunk: -1, ended: false, raf: 0, nextT: 0, muted: false };
    const posKey = 'vs_voice_pos_' + lessonId;
    const pool = [new Audio(), new Audio()];
    let cur = pool[0]; let pre = pool[1];
    pool.forEach((a) => { a.preload = 'none'; wire(a); });
    let bar = null; let cap = null; let pop = null;

    /* ----- intro music ----- */
    const M = { cfg: V && V.music && V.music.url ? V.music : null, el: null, ctx: null, gain: null, done: false, t: 0, iv: 0, on: false };
    function musicLevel(v) { if (M.gain) M.gain.gain.value = v; else if (M.el) M.el.volume = Math.max(0, Math.min(1, v)); }
    function musicStart() {
      if (!M.cfg || M.done || state.muted) return false;
      M.done = true;
      try {
        M.el = new Audio(); M.el.preload = 'auto'; M.el.src = M.cfg.url;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) { try { M.ctx = new AC(); const src = M.ctx.createMediaElementSource(M.el); M.gain = M.ctx.createGain(); src.connect(M.gain); M.gain.connect(M.ctx.destination); if (M.ctx.state === 'suspended') M.ctx.resume().catch(() => {}); } catch { M.ctx = null; M.gain = null; } }
        musicLevel(M.cfg.volume);
        // The music cannot play (blocked, missing, offline): drop it, and if the voice was waiting for it, start the voice now.
        const el = M.el; const p = el.play(); if (p && p.catch) p.catch(() => { if (M.el !== el || !M.on) return; musicStop(); if (M.t) { cancelLead(); if (state.active && state.mode === 'intro') play(); } });
        M.on = true;
        return true;
      } catch { musicStop(); return false; }
    }
    function musicFade(ms) {
      if (!M.el || !M.on) return;
      clearInterval(M.iv);
      const v0 = M.gain ? M.gain.gain.value : M.el.volume; const t0 = Date.now(); const d = Math.max(200, ms);
      M.iv = setInterval(() => { const k = Math.min(1, (Date.now() - t0) / d); musicLevel(v0 * (1 - k) * (1 - k)); if (k >= 1) musicStop(); }, 40);
    }
    /** Forget the pending "start the intro after the music" timer (stop, lesson closed, member moved or pressed play). */
    function cancelLead() { clearTimeout(M.t); M.t = 0; }
    /** Stops the music only. The intro timer is separate: muting or a fade must never cancel the voice that follows. */
    function musicStop() { clearInterval(M.iv); M.on = false; if (M.el) { try { M.el.pause(); } catch { /* ignore */ } M.el.removeAttribute('src'); try { M.el.load(); } catch { /* ignore */ } } if (M.ctx) { try { M.ctx.close(); } catch { /* ignore */ } } M.el = null; M.ctx = null; M.gain = null; }
    /** The intro clip waits for the music's lead, then starts and the music fades away under it. */
    function introAfterMusic() {
      // Unlock this audio element inside the member's tap, so it may start by itself after the lead (iPhone rule).
      const a = cur; const was = a.muted; a.muted = true;
      const pr = a.play(); if (pr && pr.then) pr.then(() => { if (M.t) { a.pause(); try { a.currentTime = 0; } catch { /* ignore */ } } a.muted = was || state.muted; }).catch(() => { a.muted = was || state.muted; });
      state.note = ''; paintBar();
      M.t = setTimeout(() => { M.t = 0; if (!state.active || state.mode !== 'intro') { musicFade(800); return; } play(); musicFade(M.cfg.fade_ms); }, Math.max(0, M.cfg.lead_ms));
    }

    const clipFor = (mode, i) => (!V ? null : mode === 'intro' ? V.intro : mode === 'recap' ? V.outro : mode === 'slide' ? V.steps[i] || null : null);
    const slotOf = (mode, i) => (mode === 'intro' ? 'intro' : mode === 'recap' ? 'outro' : 's' + i);
    /** The clip after this one: next slide, the outro after the last slide, slide 1 after the intro. */
    function nextClip() {
      if (state.mode === 'intro') return clipFor('slide', 0);
      if (state.mode === 'slide') return state.i < steps.length - 1 ? clipFor('slide', state.i + 1) : clipFor('recap');
      return null;
    }

    /* ----- the bar (inside the slide controls) and the captions band ----- */
    function mount() {
      if (!V || !prefs.enabled || bar) return;
      bar = document.createElement('div');
      bar.className = 'vn';
      bar.innerHTML = `
        <button type="button" class="vn-play" data-vn="play" aria-label="Play narration"><svg class="vn-ring" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21"/><circle class="vn-ring-v" cx="24" cy="24" r="21"/></svg><span class="vn-pi">${IC.play}</span></button>
        <span class="vn-eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
        <span class="vn-time" aria-live="off"><b data-vn-t>0:00</b><span data-vn-d></span></span>
        <button type="button" class="vn-b vn-speed" data-vn="speed" aria-label="Narration speed">${speedTxt(prefs.speed)}</button>
        <button type="button" class="vn-b vn-tg" data-vn="cc" aria-pressed="${prefs.captions}" aria-label="Captions">${IC.cc}</button>
        <button type="button" class="vn-b vn-tg vn-wide" data-vn="auto" aria-pressed="${prefs.auto}" aria-label="Move on when the voice ends">${IC.auto}<span>Auto</span></button>
        <button type="button" class="vn-b vn-tg vn-wide" data-vn="mute" aria-pressed="false" aria-label="Mute">${IC.vol}</button>
        <button type="button" class="vn-b vn-morebtn" data-vn="more" aria-expanded="false" aria-label="More voice settings">${IC.more}</button>
        <div class="vn-pop" hidden role="group" aria-label="Voice settings">
          <button type="button" data-vn="auto" aria-pressed="${prefs.auto}">${IC.auto}<span><b>Move on by itself</b><small>Next slide when the voice ends</small></span><i class="vn-sw"></i></button>
          <button type="button" data-vn="mute" aria-pressed="false">${IC.mute}<span><b>Mute</b><small>Keep captions, no sound</small></span><i class="vn-sw"></i></button>
          <button type="button" data-vn="off"><span><b>Turn the voice off</b><small>Change it again in Profile</small></span></button>
        </div>`;
      const prev = ctl.querySelector('[data-prev]');
      prev.after(bar);
      cap = document.createElement('div');
      cap.className = 'vn-cap';
      cap.hidden = true;
      cap.setAttribute('aria-hidden', 'true'); // the slide text below is the readable version; captions mirror the voice
      ctl.before(cap);
      pop = bar.querySelector('.vn-pop');
      bar.addEventListener('click', onBar);
      paintBar();
    }
    function onBar(e) {
      const b = e.target.closest('[data-vn]');
      if (!b) return;
      e.stopPropagation();
      const k = b.dataset.vn;
      if (k === 'play') { toggle(); return; }
      if (k === 'speed') { prefs.speed = SPEEDS[(SPEEDS.indexOf(prefs.speed) + 1) % SPEEDS.length]; applyRate(); savePrefs({ speed: prefs.speed }); paintBar(); return; }
      if (k === 'cc') { prefs.captions = !prefs.captions; savePrefs({ captions: prefs.captions }); paintBar(); paintCap(true); return; }
      if (k === 'auto') { prefs.auto = !prefs.auto; savePrefs({ auto: prefs.auto }); paintBar(); if (prefs.auto && state.ended) afterEnd(); return; }
      if (k === 'mute') { state.muted = !state.muted; pool.forEach((a) => { a.muted = state.muted; }); if (state.muted && M.on) musicFade(300); paintBar(); return; }
      if (k === 'more') { const open = pop.hidden; pop.hidden = !open; b.setAttribute('aria-expanded', open); return; }
      if (k === 'off') { prefs.enabled = false; savePrefs({ enabled: false }); stop(); unmount(); VS.toast('Teaching voice is off. Turn it back on in Profile.'); }
    }
    function unmount() { if (bar) bar.remove(); if (cap) cap.remove(); bar = cap = pop = null; ctl.classList.remove('vn-solo'); }
    function paintBar() {
      if (!bar) return;
      const c = state.clip;
      const playing = !cur.paused && !cur.ended && !!c;
      bar.classList.toggle('on', playing);
      bar.classList.toggle('none', state.active && !c);
      const pb = bar.querySelector('.vn-play');
      pb.querySelector('.vn-pi').innerHTML = playing ? IC.pause : IC.play;
      pb.setAttribute('aria-label', playing ? 'Pause narration' : c ? 'Play narration' : 'No voice on this slide yet');
      pb.disabled = state.active && !c;
      bar.querySelector('.vn-speed').textContent = speedTxt(prefs.speed);
      bar.querySelectorAll('[data-vn="cc"]').forEach((x) => x.setAttribute('aria-pressed', prefs.captions));
      bar.querySelectorAll('[data-vn="auto"]').forEach((x) => x.setAttribute('aria-pressed', prefs.auto));
      bar.querySelectorAll('[data-vn="mute"]').forEach((x) => { x.setAttribute('aria-pressed', state.muted); if (x.classList.contains('vn-b')) x.innerHTML = state.muted ? IC.mute : IC.vol; });
      bar.querySelector('[data-vn-d]').textContent = c ? ' / ' + mmss(c.ms) : '';
      paintTime();
      // The intro card mirrors the voice once it is listening.
      const lc = state.active && wrap.querySelector('[data-vn-listen]');
      if (lc) {
        lc.classList.toggle('on', playing || !!M.t);
        lc.querySelector('.vn-lp').innerHTML = (playing ? IC.pause : IC.play) + '<i></i>';
        lc.querySelector('.vn-lt b').textContent = playing ? 'Listening to the intro' : M.t ? 'Starting the lesson' : state.ended ? 'Intro done' : 'Paused';
        lc.setAttribute('aria-label', playing ? 'Pause the intro' : 'Play the intro');
      }
    }
    function paintTime() {
      if (!bar) return;
      const c = state.clip;
      const d = (cur.duration && isFinite(cur.duration) ? cur.duration * 1000 : c ? c.ms : 0) || 1;
      const t = c ? cur.currentTime * 1000 : 0;
      const p = Math.min(1, t / d);
      bar.querySelector('[data-vn-t]').textContent = mmss(t);
      bar.querySelector('.vn-ring-v').style.strokeDashoffset = String(132 * (1 - p));
      bar.style.setProperty('--vp', p);
      if (state.mode === 'slide') {
        const seg = wrap.querySelectorAll('.ssp-bars i b')[state.i];
        if (seg && state.active && c) seg.style.width = Math.max(4, p * 100) + '%';
      }
    }

    /* ----- captions: the chunk being read, words lit up to the playhead ----- */
    function paintCap(force) {
      if (!cap) return;
      const c = state.clip;
      const show = state.active && prefs.captions && (c || state.note);
      cap.hidden = !show;
      if (!show) return;
      if (!c) { cap.innerHTML = `<p class="vn-note">${esc(state.note)}</p>`; state.chunk = -1; return; }
      if (state.ended && state.note) { cap.innerHTML = `<p class="vn-note">${esc(state.note)}</p>`; state.chunk = -1; return; }
      const d = (cur.duration && isFinite(cur.duration) ? cur.duration : c.ms / 1000) || 1;
      const total = c.text.length;
      const pos = Math.min(total, (cur.currentTime / d) * total * 1.04); // a hair ahead: the eye leads the ear
      let k = state.chunks.findIndex((x, j) => pos < (state.chunks[j + 1] ? state.chunks[j + 1].from : Infinity));
      if (k < 0) k = state.chunks.length - 1;
      const ch = state.chunks[k];
      if (!ch) return;
      if (k !== state.chunk || force) {
        state.chunk = k;
        let at = ch.from;
        cap.innerHTML = `<p class="${reduce() ? 'still' : ''}">${ch.words.map((w) => { const s = `<span data-at="${at}">${esc(w)}</span>`; at += w.length + 1; return s; }).join(' ')}</p>`;
      }
      if (reduce()) return;
      cap.querySelectorAll('span[data-at]').forEach((s) => s.classList.toggle('lit', Number(s.dataset.at) <= pos));
    }

    /* ----- audio ----- */
    function wire(a) {
      a.addEventListener('play', () => { if (a === cur) { tick(); paintBar(); preloadNext(); } });
      a.addEventListener('pause', () => { if (a === cur) { cancelAnimationFrame(state.raf); paintBar(); savePos(); } });
      a.addEventListener('loadedmetadata', () => { if (a === cur) { restorePos(); paintBar(); } });
      a.addEventListener('ended', () => { if (a === cur) { buildAll(); state.ended = true; clearPos(); paintTime(); afterEnd(); } });
      a.addEventListener('error', () => { if (a === cur && a.getAttribute('src')) { buildAll(); state.note = 'This clip did not load. Tap next to keep going.'; state.clip = null; paintBar(); paintCap(true); } });
    }
    function applyRate() { pool.forEach((a) => { a.defaultPlaybackRate = prefs.speed; a.playbackRate = prefs.speed; }); }
    function tick() {
      cancelAnimationFrame(state.raf);
      let last = 0; let saved = 0;
      const f = (t) => {
        if (cur.paused) return;
        if (t - last > 90) { last = t; paintTime(); paintCap(); walkStep(); buildStep(); if (t - saved > 3000) { saved = t; savePos(); } }
        state.raf = requestAnimationFrame(f);
      };
      state.raf = requestAnimationFrame(f);
    }
    function load(c) {
      state.clip = c; state.ended = false; state.chunk = -1; state.note = '';
      clearTimeout(state.nextT);
      state.chunks = c ? chunks(c.text) : [];
      cur.pause();
      if (!c) { paintBar(); paintCap(true); return; }
      if (pre.getAttribute('src') === c.url) { const old = cur; cur = pre; pre = old; } // the preloaded clip becomes the current one
      else { cur.preload = 'auto'; cur.src = c.url; }
      pre.pause();
      applyRate();
      cur.muted = state.muted;
      if (cur.readyState >= 1) restorePos(); else try { cur.currentTime = 0; } catch { /* not loaded yet */ }
      paintBar(); paintCap(true);
    }
    function preloadNext() {
      const n = nextClip();
      if (!n || pre.getAttribute('src') === n.url || cur.getAttribute('src') === n.url) return;
      pre.preload = 'auto'; pre.src = n.url;
      try { pre.load(); } catch { /* ignore */ }
    }
    async function play() {
      if (!state.clip) return;
      if (state.ended) { try { cur.currentTime = 0; } catch { /* ignore */ } state.ended = false; }
      try { await cur.play(); } catch (e) { if (e && e.name === 'NotAllowedError') { state.active = true; paintBar(); } }
    }
    function pause() { cur.pause(); buildAll(); }
    function stop() { buildAll(); clearTimeout(state.nextT); pool.forEach((a) => { a.pause(); }); cancelAnimationFrame(state.raf); cancelLead(); if (M.on) musicStop(); }
    function toggle() {
      if (!V || !prefs.enabled) return false;
      if (!state.active) { start(); return true; }
      if (!state.clip) return true;
      if (M.t) { cancelLead(); play(); musicFade(M.cfg ? Math.min(1500, M.cfg.fade_ms) : 800); return true; }
      if (cur.paused || cur.ended) play(); else pause();
      return true;
    }
    /** After a clip: move on (auto), or say why we wait. */
    function afterEnd() {
      paintBar();
      const s = state.mode === 'slide' ? steps[state.i] : null;
      if (state.mode === 'recap') { state.note = ''; paintCap(true); return; }
      if (s && s.v === 'lab') { state.note = 'Your turn. Try the task, then tap next.'; paintCap(true); return; }
      if (!prefs.auto) { state.note = 'Tap next when you are ready.'; paintCap(true); return; }
      clearTimeout(state.nextT);
      state.nextT = setTimeout(() => { if (state.active && state.ended && wrap.isConnected) onNext(); }, reduce() ? 300 : 650);
    }

    /* ----- resume inside a clip (this device) ----- */
    function savePos() { if (!state.clip || cur.currentTime < 2) return; try { localStorage.setItem(posKey, JSON.stringify({ s: state.slot, t: Math.round(cur.currentTime * 10) / 10 })); } catch { /* ignore */ } }
    function clearPos() { try { localStorage.removeItem(posKey); } catch { /* ignore */ } }
    function restorePos() {
      let p = null; try { p = JSON.parse(localStorage.getItem(posKey) || 'null'); } catch { /* ignore */ }
      if (p && p.s === state.slot && p.t > 1 && cur.duration && p.t < cur.duration - 1.5) { try { cur.currentTime = p.t; } catch { /* ignore */ } }
    }

    /* ----- build: the slide's parts come in as the voice reaches them (lesson-visuals.js) ----- */
    function buildStep() {
      const st = state.build;
      if (!st || !st.isConnected) return;
      const d = cur.duration && isFinite(cur.duration) ? cur.duration : state.clip ? state.clip.ms / 1000 : 0;
      if (d) window.VSL.reveal(st, cur.currentTime / d);
    }
    /** Show the whole slide (paused, ended, failed, or the clip never started). */
    function buildAll() { clearTimeout(state.buildT); if (state.build && window.VSL) window.VSL.reveal(state.build, 1); state.build = null; }

    /* ----- walkthroughs: sub-steps follow the clip ----- */
    function walkStep() {
      const w = state.walk;
      if (!w || !w.isConnected) return;
      const dots = w.querySelectorAll('[data-go]');
      const d = cur.duration && isFinite(cur.duration) ? cur.duration : 0;
      if (!dots.length || !d) return;
      const k = Math.min(dots.length - 1, Math.floor((cur.currentTime / d) * dots.length));
      if (k > state.walkK) { state.walkK = k; dots[k].click(); }
    }

    /* ----- moments the player calls ----- */
    function at(mode, i, stageEl) {
      state.mode = mode; state.i = i; state.slot = slotOf(mode, i);
      state.walk = mode === 'slide' && stageEl ? stageEl.querySelector('.vl-walk') : null; state.walkK = 0;
      buildAll();
      ctl.classList.toggle('vn-solo', mode !== 'slide' && state.active);
      if (mode !== 'slide' && state.active) ctl.hidden = false;
      if (!state.active) { paintBar(); return; }
      const c = clipFor(mode, i);
      load(c);
      if (mode !== 'intro') { cancelLead(); if (M.on) musicFade(600); }
      if (c && mode === 'slide' && stageEl && window.VSL && window.VSL.build && window.VSL.build(stageEl)) {
        // Build with the voice; if the clip has not started a few seconds on (blocked, slow network), show it all.
        state.build = stageEl;
        state.buildT = setTimeout(() => { if (state.build === stageEl && !(cur.currentTime > 0)) buildAll(); }, 3500);
      }
      if (mode === 'intro' && c && onOpen) onOpen();
      if (c && mode === 'intro' && musicStart()) introAfterMusic();
      else if (c) play();
      else { state.note = mode === 'slide' ? 'No voice on this slide yet. Read it, then tap next.' : ''; paintCap(true); }
    }
    function start() {
      if (!V) return;
      if (!prefs.enabled) { prefs.enabled = true; savePrefs({ enabled: true }); }
      mount();
      state.active = true;
      wrap.classList.add('vn-live');
      at(state.mode === 'quiz' || state.mode === 'result' ? 'intro' : state.mode, state.i, wrap.querySelector('.ssp-stage'));
    }

    return {
      available: !!V,
      enabled: () => prefs.enabled,
      active: () => state.active,
      /** Intro screen: the "Listen to this lesson" card (or a quiet line when the member turned the voice off). */
      introHtml(saved) {
        if (!V) return '';
        if (!prefs.enabled) return `<p class="vn-offline">Teaching voice is off for you. <button type="button" class="lnk" data-vn-on>Turn it on</button></p>`;
        const mins = Math.max(1, Math.round(V.ms / 60000));
        return `<button type="button" class="vn-listen" data-vn-listen ${saved ? `data-from="${saved}"` : ''}>
          <span class="vn-lp">${IC.play}<i></i></span>
          <span class="vn-lt"><b>${saved ? `Keep listening from slide ${saved + 1}` : 'Listen to this lesson'}</b><small>${mins} min, read aloud${prefs.captions ? ' with captions' : ''}${V.count < steps.length + 2 ? '. Some slides are text only' : ''}</small></span>
          <span class="vn-lw" aria-hidden="true">${'<i></i>'.repeat(14)}</span></button>`;
      },
      bindIntro(root, go) {
        const l = root.querySelector('[data-vn-listen]');
        if (l) l.addEventListener('click', () => { if (state.active) { if (state.ended && prefs.auto) { onNext(); return; } toggle(); return; } const from = l.dataset.from; mount(); state.active = true; wrap.classList.add('vn-live'); if (from) go(Number(from)); else at('intro', -1); });
        const on = root.querySelector('[data-vn-on]');
        if (on) on.addEventListener('click', () => { prefs.enabled = true; savePrefs({ enabled: true }); const ia = on.closest('.vn-offline'); ia.outerHTML = this.introHtml(0); this.bindIntro(root, go); });
      },
      mount,
      onIntro() { mount(); at('intro', -1); },
      onSlide(i, stageEl) { mount(); at('slide', i, stageEl); },
      onRecap() { at('recap', -1); },
      onQuiz() { state.mode = 'quiz'; stop(); state.clip = null; ctl.classList.remove('vn-solo'); paintBar(); paintCap(true); if (cap) cap.hidden = true; },
      /** Story bar for the current slide: filled by clip progress while narrating. */
      painting: () => state.active && state.mode === 'slide' && !!state.clip,
      toggle,
      key(e) {
        if (!V || !prefs.enabled || !bar) return false;
        if (e.key === ' ' || e.code === 'Space') { if (e.target.closest && e.target.closest('button,a,summary,input,textarea,select,[contenteditable],.vl-interactive')) return false; e.preventDefault(); toggle(); return true; }
        if ((e.key === 'c' || e.key === 'C') && state.active) { prefs.captions = !prefs.captions; savePrefs({ captions: prefs.captions }); paintBar(); paintCap(true); return true; }
        if ((e.key === 'm' || e.key === 'M') && state.active) { state.muted = !state.muted; pool.forEach((a) => { a.muted = state.muted; }); if (state.muted && M.on) musicFade(300); paintBar(); return true; }
        return false;
      },
      /** The member moved by hand: keep narrating the new slide (if playing), never jump ahead on our own. */
      userMoved() { clearTimeout(state.nextT); },
      destroy() { stop(); savePos(); pool.forEach((a) => { a.removeAttribute('src'); try { a.load(); } catch { /* ignore */ } }); unmount(); },
    };
  }

  /** Profile → Lessons: the member's switch for the teaching voice. */
  async function prefsCard(host) {
    if (!host) return;
    const S = window.APP && window.APP.S;
    if (S && S.features && (S.features.voice === false || S.features.academy === false)) { host.remove(); return; }
    let p;
    let r; try { r = await VS.api('/api/school/voice/prefs'); p = r.prefs; } catch { host.remove(); return; }
    if (r.available === false) { host.remove(); return; } // no clips yet: nothing to switch
    host.className = 'card vn-prefs';
    host.innerHTML = `<div class="card-h"><div><h3>Lessons</h3><span class="sub">How VooSquare Academy lessons play for you</span></div></div>
      <label class="switch"><input type="checkbox" data-k="enabled" ${p.enabled ? 'checked' : ''}><i></i>Read lessons aloud (teaching voice)</label>
      <label class="switch"><input type="checkbox" data-k="captions" ${p.captions ? 'checked' : ''}><i></i>Show captions while the voice reads</label>
      <label class="switch"><input type="checkbox" data-k="auto" ${p.auto ? 'checked' : ''}><i></i>Move to the next slide when the voice ends</label>
      <p class="hint">Clips download only when you press play, plus the next one, so the voice uses data only while you listen.</p>`;
    host.addEventListener('change', async (e) => {
      const i = e.target.closest('[data-k]'); if (!i) return;
      try { await VS.api('/api/school/voice/prefs', { method: 'PUT', body: { [i.dataset.k]: i.checked } }); VS.toast('Saved'); } catch (err) { i.checked = !i.checked; VS.toast(err.message || 'Not saved. Try again.', 'err'); }
    });
  }

  window.VSV = { create, prefsCard, chunks };
})();
