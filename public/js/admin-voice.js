/* VooSquare admin: VooSquare Academy → Teaching voice (src/voice.js). Provider and key status, the voice picker with spoken
 * samples, sound settings, the pronunciation list, cost estimates and generation with live progress, and a page per
 * lesson to hear, edit and regenerate each clip. Routes: #school/voice and #school/voice/lesson/<id>.
 * Loaded after admin-school.js, which links the tab. */
(function () {
  'use strict';
  const { $, $$, esc, fmt, icon, toast, dateStr } = VS;
  const A = window.VSA;
  const { GET, POST, PUT, run, confirmIn, field, input, textarea, select, switchField, readForm, pill, empty, errorBox, skelRows, pageHead, backLink } = A;

  const STATES = {
    ready: ['Ready', 'g', 'Generated with the current voice.'], stale: ['Older voice', 'gold', 'Made with a voice or settings you changed since. Members still hear it.'],
    changed: ['Text changed', 'b', 'The words changed. Members see the slide without voice until it is generated again.'], missing: ['Not made', 'w', 'Not generated yet.'],
    queued: ['Waiting', 'l', 'In the queue.'], running: ['Making', 'l', 'Being generated now.'], error: ['Failed', 'r', 'The last try failed.'], none: ['No script', 'w', 'This slide has no narration text.'],
  };
  const statePill = (s) => { const x = STATES[s] || [s, 'w']; return `<span class="pill pill-${x[1]} vo-st vo-st-${s}" title="${esc(x[2] || '')}">${esc(x[0])}</span>`; };
  const money = (n) => (n >= 100 ? '$' + fmt(Math.round(n)) : '$' + (Math.round(n * 100) / 100).toFixed(2));
  const mb = (b) => (!b ? '0 KB' : b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
  const dur = (ms) => { const s = Math.round(ms / 1000); if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`; if (s >= 60) return `${Math.floor(s / 60)} min ${s % 60 ? (s % 60) + ' s' : ''}`.trim(); return `${s} s`; };

  /* One shared player for every play button on these pages. */
  const player = { a: null, btn: null, url: '' };
  function playUrl(url, btn) {
    if (!player.a) { player.a = new Audio(); player.a.addEventListener('ended', () => setBtn(false)); player.a.addEventListener('pause', () => setBtn(false)); player.a.addEventListener('play', () => setBtn(true)); }
    const a = player.a;
    if (player.url === url && !a.paused) { a.pause(); return; }
    if (player.btn && player.btn !== btn) setBtn(false);
    player.btn = btn;
    if (player.url !== url) { if (player.url.startsWith('blob:')) URL.revokeObjectURL(player.url); player.url = url; a.src = url; }
    a.currentTime = 0;
    a.play().catch(() => toast('The browser did not play the clip.', 'err'));
  }
  function setBtn(on) { const b = player.btn; if (b && b.isConnected) { b.classList.toggle('on', on); b.innerHTML = icon(on ? 'pause' : 'play'); b.setAttribute('aria-label', on ? 'Pause' : 'Play'); } }
  const stopAudio = () => { if (player.a) player.a.pause(); };
  async function sampleBlob(body) {
    const res = await fetch('/api/admin/voice/sample', { method: 'POST', headers: { 'content-type': 'application/json', 'x-vs': '1' }, body: JSON.stringify(body), credentials: 'same-origin' });
    if (!res.ok) { let m = 'The sample did not generate.'; try { m = (await res.json()).error || m; } catch { /* not JSON */ } throw new Error(m); }
    return URL.createObjectURL(await res.blob());
  }

  const tabs = (on) => `<nav class="tabs ss-tabs" aria-label="VooSquare Academy sections"><a href="#school" class="${on === 'home' ? 'on' : ''}">Schools and pacing</a><a href="#school/certs" class="${on === 'certs' ? 'on' : ''}">Certificates</a><a href="#school/voice" class="${on === 'voice' ? 'on' : ''}">Teaching voice</a></nav>`;
  A.schoolTabs = tabs;

  A.voicePage = function (el, args) {
    stopAudio();
    if (args[1] === 'lesson' && args[2]) return lessonPage(el, Number(args[2]));
    return overview(el);
  };

  /* =====================================================================
   * OVERVIEW
   * ===================================================================== */
  async function overview(el) {
    el.innerHTML = `${pageHead('VooSquare Academy', 'Narration for every slide: the free included voice, or ElevenLabs or OpenAI. Writers put the script in the content files; you pick the voice and the intro music.')}${tabs('voice')}<div id="voB" class="mt">${skelRows(4, 120)}</div>`;
    let d;
    try { d = await GET('/api/admin/voice'); } catch (e) { $('#voB', el).innerHTML = errorBox(e); return; }
    if (!el.isConnected) return;
    const s = d.settings;
    const st = d.status;
    const t = d.totals;
    const P = st.providers;
    const pct = t.with_text ? Math.round(t.ready / t.with_text * 100) : 0;
    const eModels = d.options.eleven_models; const outs = d.options.outputs;
    let poll = null;
    A.S.cleanup.push(() => clearTimeout(poll));
    // Schools with a script come first in the pickers, with their line counts; the first of them is selected.
    const bs = t.by_school || {};
    const lines = (x) => (bs[x.slug] || {}).lines || 0;
    const schoolsSorted = [...d.schools].sort((a, b) => (lines(b) > 0) - (lines(a) > 0));
    const schoolOpts = schoolsSorted.map((x) => `<option value="${esc(x.slug)}">${esc(x.title)}${lines(x) ? ` (${fmt((bs[x.slug] || {}).ready || 0)} of ${fmt(lines(x))} voiced)` : ' (no script yet)'}</option>`).join('');

    $('#voB', el).innerHTML = `
      <section class="card vo-hero">
        <div class="vo-cov" style="--p:${pct}"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52"/><circle class="v" cx="60" cy="60" r="52" pathLength="100"/></svg><div><b>${pct}%</b><small>voiced</small></div></div>
        <div class="vo-hs">
          <div class="vo-h1"><h3>${esc(st.voice.replace(/^(ElevenLabs|OpenAI) $/, '$1: no voice yet'))}</h3>${s.provider === 'included' ? pill('Free', 'g') : ''}${st.ready ? pill(s.provider === 'included' ? 'Ready' : 'Ready to generate', 'g') : pill('Setup needed', 'r')}${d.feature ? '' : pill('Switched off for members', 'w')}</div>
          ${st.ready ? '' : `<p class="vo-prob">${icon('flag')}<span>${esc(st.problem)}</span></p>`}
          <dl class="vo-facts">
            <div><dt>Script</dt><dd>${fmt(t.with_text)} lines in ${fmt(t.lessons_with_text)} of ${fmt(t.lessons)} lessons</dd></div>
            <div><dt>Voiced</dt><dd>${fmt(t.ready)} clips · ${dur(t.audio_ms)} · ${mb(t.bytes)}</dd></div>
            <div><dt>Whole script</dt><dd>${fmt(t.script_chars)} characters ≈ ${money(t.full_cost_usd)} · ${dur(t.full_secs * 1000)} · ${mb(t.full_bytes)}</dd></div>
            ${s.provider === 'included' ? `<div><dt>Price</dt><dd>Free. The included voice is made ahead of time and uploaded as voice packs.</dd></div>` : `<div><dt>Price used</dt><dd>${money(st.price_per_1k)} per 1,000 characters${st.price_auto ? ' (list price, check yours)' : ''}</dd></div>`}
          </dl>
        </div>
        <div class="vo-keys">${Object.entries(P).map(([k, p]) => `<div class="vo-key ${p.key ? 'ok' : ''} ${s.provider === k ? 'cur' : ''}"><span>${icon(p.key ? 'check' : 'lock')}</span><b>${esc(p.name)}</b><small class="${k === 'included' ? '' : 'mono'}">${esc(k === 'included' ? 'No key needed' : p.env)}</small><em>${k === 'included' ? 'Free' : p.key ? 'Key found' : 'No key yet'}</em></div>`).join('')}</div>
      </section>

      <div class="vo-grid mt">
        <div class="stack">
          <section class="card" id="voVoice">
            <div class="card-h"><div><h3>Voice</h3><span class="sub">Who reads the lessons. A cloned voice of yours shows here once it is in your ElevenLabs Voice Lab.</span></div>
              <div class="r"><div class="seg" role="group" aria-label="Provider" id="voProv">${Object.entries(P).map(([k, p]) => `<button type="button" data-v="${k}" class="${s.provider === k ? 'on' : ''}" aria-pressed="${s.provider === k}">${esc(p.name)}</button>`).join('')}</div></div></div>
            ${s.provider === 'included' ? `<p class="muted sm vo-inc-note">The included narrator is a calm American male teacher voice. It costs nothing: the clips are made ahead of time and you upload them as voice packs. Press play to hear him.</p>` : ''}
            <label class="field" ${s.provider === 'included' ? 'hidden' : ''}><span class="lbl">Sample sentence</span><textarea class="inp" id="voSample" rows="2" maxlength="300" aria-label="Sample sentence">${esc(s.sample)}</textarea><span class="hint">Previews read this. Each preview costs its characters once; repeats are free.</span></label>
            <div id="voList" class="vo-list mt">${skelRows(3, 52)}</div>
            ${s.provider === 'included' ? `<div class="vo-who mt"><b class="lbl">Who reads each school</b>${d.schools.map((x) => { const cur = (s.included.voices || {})[x.slug] || (x.track === 'vertical' ? 'kokoro-af_heart-v1' : 'kokoro-am_michael-v1'); return `<label class="vo-who-r"><span>${esc(x.title)}</span><select class="inp" data-who="${esc(x.slug)}" aria-label="Narrator for ${esc(x.title)}">${(st.included_voices || []).map((v) => `<option value="${esc(v.id)}" ${v.id === cur ? 'selected' : ''}>${esc(v.name)} · ${esc(v.labels[1] || '')}</option>`).join('')}</select></label>`; }).join('')}<p class="muted sm">Changing a school's narrator needs that school's voice pack for the new voice.</p></div>` : ''}
            ${s.provider === 'elevenlabs' ? `<form class="row vo-manual" id="voManual">${field('Or paste a voice ID', input('voice_id', s.elevenlabs.voice_id, { ph: 'e.g. 21m00Tcm4TlvDq8ikWAM', max_len: 64, spell: 'false' }), 'From ElevenLabs → Voices → your voice → ID.', 'grow')}<button class="btn btn-w btn-sm" type="submit">Use this ID</button></form>` : ''}
          </section>

          <form class="card stack" id="voSet">
            <div class="card-h"><div><h3>Sound</h3><span class="sub">Changing any of these marks existing clips as made with an older voice. They keep playing until you generate again.</span></div></div>
            ${s.provider === 'included' ? `<p class="muted sm">The included voice has fixed sound settings (made ahead of time at 48 kbps). Members can still change the speed in the player.</p>` : s.provider === 'elevenlabs' ? `
              <div class="g2c">${field('Model', select('model_id', eModels.map((m) => [m[0], m[1]]), s.elevenlabs.model_id), (eModels.find((m) => m[0] === s.elevenlabs.model_id) || [])[2] || '')}
              ${field('Audio file', select('output', outs.map((o) => [o[0], o[1]]), s.elevenlabs.output), (outs.find((o) => o[0] === s.elevenlabs.output) || [])[3] || '')}</div>
              <div class="vo-sliders">
                ${slider('stability', 'Stability', s.elevenlabs.stability, 0, 1, 0.05, 'Lower: more expressive. Higher: steadier, can sound flat. 0.4 to 0.6 suits teaching.')}
                ${slider('similarity', 'Similarity', s.elevenlabs.similarity, 0, 1, 0.05, 'How close to the original voice. High for a clone of you.')}
                ${slider('style', 'Style', s.elevenlabs.style, 0, 1, 0.05, 'Exaggerates the speaker’s style. Keep it low (0 to 0.2) for calm lessons.')}
                ${slider('speed', 'Speed', s.elevenlabs.speed, 0.7, 1.2, 0.05, 'Members can also change speed in the player.')}
              </div>
              ${switchField('speaker_boost', s.elevenlabs.speaker_boost, 'Speaker boost', 'Closer to the original voice, a little slower to make')}`
            : `
              <div class="g2c">${field('Model', select('model', d.options.openai_models.map((m) => [m[0], m[1]]), s.openai.model), (d.options.openai_models.find((m) => m[0] === s.openai.model) || [])[2] || '')}
              ${field('Voice', select('voice', d.options.openai_voices.map((v) => [v, v[0].toUpperCase() + v.slice(1)]), s.openai.voice))}</div>
              ${field('How to speak', textarea('instructions', s.openai.instructions, { rows: 2 }), 'Only gpt-4o-mini-tts follows this.')}
              <div class="vo-sliders">${slider('speed', 'Speed', s.openai.speed, 0.5, 2, 0.05, '')}</div>`}
            <div class="g2c" ${s.provider === 'included' ? 'hidden' : ''}>${field('Price per 1,000 characters (USD)', input('cost_per_1k', s.cost_per_1k || '', { type: 'number', step: '0.001', min: 0, ph: String(st.price_per_1k) }), 'Leave empty for the list price. Your plan may be cheaper per character.')}
              ${field('Clips made at the same time', select('concurrency', [1, 2, 3, 4].map((n) => [n, String(n)]), s.concurrency), 'Two is safe on every ElevenLabs plan.')}</div>
            <div class="row end" ${s.provider === 'included' ? 'hidden' : ''}><button class="btn btn-g btn-sm" type="submit">Save sound settings</button></div>
          </form>

          <section class="card" id="voMusic">
            <div class="card-h"><div><h3>Intro music</h3><span class="sub">One short track opens every lesson when a member presses Listen, then fades out as the voice starts.</span></div>
              <div class="r">${switchField('music_on', s.music.enabled, 'On')}</div></div>
            <div class="vo-mu">
              <button type="button" class="vo-pl" data-mu-play aria-label="Hear the intro music">${icon('play')}</button>
              <span class="vo-vt"><b>${esc(s.music.file ? (s.music.name || 'Your track') : 'VooSquare Academy intro (default)')}</b><small>${s.music.file ? 'Uploaded track' : 'Soft piano and pads, made for VooSquare Academy'}</small></span>
              ${s.music.file ? `<button type="button" class="btn btn-ghost btn-xs" data-mu-default>Use the default</button>` : ''}
              <label class="btn btn-w btn-xs vo-up">${icon('up')}Upload an MP3<input type="file" accept="audio/mpeg,.mp3" data-mu-file hidden></label>
            </div>
            <form class="vo-sliders mt" id="voMuForm">
              ${slider('volume', 'Music volume', s.music.volume, 0.05, 1, 0.05, 'How loud the music starts. The voice is always at full volume.')}
              ${slider('lead', 'Music before the voice (seconds)', s.music.lead_ms / 1000, 0, 10, 0.5, 'How long the music plays alone before the intro voice starts.')}
              ${slider('fade', 'Fade out (seconds)', s.music.fade_ms / 1000, 0.5, 8, 0.5, 'How long the music takes to fade away under the voice.')}
              <div class="row end"><button class="btn btn-g btn-sm" type="submit">Save music</button></div>
            </form>
            <p class="muted sm mt">Use music you own or have a licence for. MP3, up to 8 MB; 6 to 15 seconds works best.</p>
          </section>

          <section class="card" id="voDict">
            <div class="card-h"><div><h3>Pronunciation</h3><span class="sub">Whole words, any capitals, replaced before the text is sent. The captions keep the written word.</span></div></div>
            <div class="vo-dict" id="voRows">${s.dictionary.map((r) => dictRow(r)).join('')}</div>
            <div class="row mt"><button type="button" class="btn btn-w btn-xs" id="voAdd">${icon('plus')}Add a word</button></div>
            <label class="field mt"><span class="lbl">Try a sentence</span><input class="inp" id="voTry" value="Open VooSquare, then Joinvoo. Dchessking explains." aria-label="Try a sentence"><span class="hint vo-said" id="voSaid"></span></label>
            <div class="row end"><button type="button" class="btn btn-g btn-sm" id="voDictSave">Save pronunciation</button></div>
          </section>
        </div>

        <div class="stack vo-side">
          <section class="card vo-pack" id="voPack">
            <div class="card-h"><div><h3>Included voice pack</h3><span class="sub">The free narrator's clips. Upload the .tar packs you were given; each one adds the clips for its schools.</span></div></div>
            <div id="voPackS" class="vo-pack-s">${skelRows(1, 40)}</div>
            <label class="btn btn-k btn-block mt vo-up">${icon('up')}Upload voice packs (.tar)<input type="file" accept=".tar,application/x-tar" multiple data-pack-file hidden></label>
            <div id="voPackP" class="mt" aria-live="polite"></div>
            ${s.provider === 'included' ? '' : `<p class="muted sm mt">To use these clips, choose <b>Included voice</b> under Voice. Uploading packs first is fine.</p>`}
          </section>
          <section class="card vo-gen" id="voGen">
            <div class="card-h"><div><h3>Generate</h3><span class="sub">See the cost first. Lines that did not change are never sent again.</span></div></div>
            <div class="seg vo-scope" role="group" aria-label="What to generate">${[['lesson', 'One lesson'], ['module', 'A module'], ['school', 'A school'], ['all', 'Everything']].map(([k, l], i) => `<button type="button" data-v="${k}" class="${i === 2 ? 'on' : ''}" aria-pressed="${i === 2}">${l}</button>`).join('')}</div>
            <div class="vo-pick mt">
              <label class="field" data-for="school module lesson"><span class="lbl">School</span><select class="inp" id="voSch" aria-label="School">${schoolOpts}</select></label>
              <label class="field" data-for="module lesson" hidden><span class="lbl">Module</span><select class="inp" id="voMod" aria-label="Module"></select></label>
              <label class="field" data-for="lesson" hidden><span class="lbl">Lesson</span><select class="inp" id="voLes" aria-label="Lesson"></select></label>
            </div>
            <div class="seg vo-mode mt" role="group" aria-label="Which clips"><button type="button" data-v="missing" class="on" aria-pressed="true">Missing or changed</button><button type="button" data-v="all" aria-pressed="false">Everything again</button></div>
            <div id="voEst" class="vo-est" aria-live="polite"></div>
            <button type="button" class="btn btn-k btn-block mt" id="voGo" disabled>Generate</button>
            <div id="voRun"></div>
          </section>
        </div>
      </div>

      <section class="card mt" id="voLessons">
        <div class="card-h"><div><h3>Lessons</h3><span class="sub">Clip status per lesson. Open one to hear, edit or regenerate single clips.</span></div>
          <div class="r"><select class="inp vo-lsch" id="voLsch" aria-label="School">${schoolOpts}</select></div></div>
        <div id="voLT">${skelRows(5, 48)}</div>
      </section>`;

    function slider(name, label, v, min, max, step, hint) {
      return `<label class="vo-sl"><span class="vo-sl-h"><b>${esc(label)}</b><output>${Number(v).toFixed(2)}</output></span><input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${v}" aria-label="${esc(label)}">${hint ? `<small>${esc(hint)}</small>` : ''}</label>`;
    }
    function dictRow(r) { return `<div class="vo-dr"><input class="inp" data-c="0" value="${esc(r[0] || '')}" placeholder="Written" aria-label="Written as" maxlength="80"><span aria-hidden="true">${icon('arrow')}</span><input class="inp" data-c="1" value="${esc(r[1] || '')}" placeholder="Say it as" aria-label="Say it as" maxlength="80"><button type="button" class="ib2" data-rm aria-label="Remove">${icon('x')}</button></div>`; }
    const readDict = () => $$('.vo-dr', el).map((r) => [$('[data-c="0"]', r).value.trim(), $('[data-c="1"]', r).value.trim()]).filter((r) => r[0] && r[1]);

    /* ----- provider and voices ----- */
    $('#voProv', el).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-v]'); if (!b || b.classList.contains('on')) return;
      const r = await run(b, () => PUT('/api/admin/voice/settings', { provider: b.dataset.v }), `Now using ${P[b.dataset.v].name}`);
      if (r) A.route(true);
    });
    const curVoice = s.provider === 'included' ? (s.included && s.included.voice) : s.provider === 'openai' ? s.openai.voice : s.elevenlabs.voice_id;
    (async () => {
      const box = $('#voList', el);
      if (!P[s.provider].key) { box.innerHTML = `<div class="vo-empty">${icon('lock')}<div><b>Add the API key to see your voices</b><span>Set <span class="mono">${esc(P[s.provider].env)}</span> in Railway → your service → Variables, then redeploy. docs/VOICE_SETUP.md has the steps.</span></div></div>`; return; }
      let v;
      try { v = (await GET('/api/admin/voice/voices')).voices; } catch (e) { box.innerHTML = errorBox(e, false); return; }
      if (!el.isConnected) return;
      box.innerHTML = v.length ? v.map((x) => `<div class="vo-v ${x.id === curVoice ? 'cur' : ''}" data-id="${esc(x.id)}" data-name="${esc(x.name)}">
          <button type="button" class="vo-pl" data-sample aria-label="Hear ${esc(x.name)}">${icon('play')}</button>
          <span class="vo-vt"><b>${esc(x.name)}</b><small>${[x.category === 'cloned' ? 'Your clone' : x.category, ...x.labels].filter(Boolean).map(esc).join(' · ')}</small></span>
          ${x.id === curVoice ? `<span class="pill pill-l">${icon('check')}In use</span>` : `<button type="button" class="btn btn-w btn-xs" data-use>Use this voice</button>`}</div>`).join('')
        : `<div class="vo-empty">${icon('user')}<div><b>No voices in this account yet</b><span>Add one in ElevenLabs (Voice Library or Instant Voice Clone), then reload this page.</span></div></div>`;
    })();
    $$('[data-who]', el).forEach((sel) => sel.addEventListener('change', () => run(sel, () => PUT('/api/admin/voice/settings', { included: { voices: { [sel.dataset.who]: sel.value } } }), 'Narrator saved')));
    $('#voList', el).addEventListener('click', async (e) => {
      const row = e.target.closest('.vo-v'); if (!row) return;
      if (e.target.closest('[data-sample]')) {
        const b = e.target.closest('[data-sample]');
        if (player.btn === b && player.a && !player.a.paused) { player.a.pause(); return; }
        b.classList.add('loading');
        try { const url = await sampleBlob(s.provider === 'included' ? {} : { voice_id: row.dataset.id, text: $('#voSample', el).value }); playUrl(url, b); } catch (err) { toast(err.message, 'err'); } finally { b.classList.remove('loading'); }
        return;
      }
      if (e.target.closest('[data-use]')) {
        if (s.provider === 'included') return;
        const body = s.provider === 'openai' ? { openai: { voice: row.dataset.id } } : { elevenlabs: { voice_id: row.dataset.id, voice_name: row.dataset.name } };
        const r = await run(e.target.closest('[data-use]'), () => PUT('/api/admin/voice/settings', body), `${row.dataset.name} reads the lessons now`);
        if (r) A.route(true);
      }
    });
    const man = $('#voManual', el);
    if (man) man.addEventListener('submit', async (e) => { e.preventDefault(); const id = readForm(man).voice_id.trim(); const r = await run($('button', man), () => PUT('/api/admin/voice/settings', { elevenlabs: { voice_id: id, voice_name: id === s.elevenlabs.voice_id ? s.elevenlabs.voice_name : '' } }), id ? 'Voice ID saved' : 'Voice cleared'); if (r) A.route(true); });
    $('#voSample', el).addEventListener('change', (e) => PUT('/api/admin/voice/settings', { sample: e.target.value }).catch(() => {}));

    /* ----- included voice pack ----- */
    async function packStatus() {
      const box = $('#voPackS', el); if (!box) return;
      let p; try { p = (await GET('/api/admin/voice/pack')).pack; } catch (e) { box.innerHTML = errorBox(e, false); return; }
      if (!el.isConnected) return;
      const pc = p.lines ? Math.round(p.in_pack / p.lines * 100) : 0;
      box.innerHTML = `<div class="vo-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${p.lines}" aria-valuenow="${p.in_pack}" aria-label="Lines in the voice pack"><i style="width:${pc}%"></i></div>
        <div class="vo-run-n"><span><b>${fmt(p.in_pack)}</b> of ${fmt(p.lines)} lines have included audio</span>${p.to_link ? `<span>${fmt(p.to_link)} ready to link</span>` : ''}</div>
        ${p.to_link && s.provider === 'included' ? `<button type="button" class="btn btn-w btn-sm mt" data-pack-link>Link ${fmt(p.to_link)} clips to their slides</button>` : ''}
        ${p.lines > p.in_pack ? `<p class="muted sm mt">${fmt(p.lines - p.in_pack)} lines have no included audio yet (new lessons, edits, or packs still to upload). <a href="/api/admin/voice/pack/missing" download>Download the list</a> to have them made.</p>` : ''}`;
    }
    packStatus();
    $('#voPack', el).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-pack-link]'); if (!b) return;
      const r = await run(b, () => POST('/api/admin/voice/pack/link'), (x) => `${fmt(x.linked)} clips linked`);
      if (r) { drawRun(r.run); watch(); packStatus(); }
    });
    function uploadPack(file, onProgress) {
      return new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('POST', '/api/admin/voice/pack');
        x.setRequestHeader('x-vs', '1');
        x.setRequestHeader('content-type', 'application/x-tar');
        x.upload.onprogress = (ev) => { if (ev.lengthComputable) onProgress(ev.loaded / ev.total); };
        x.onload = () => { let d2 = {}; try { d2 = JSON.parse(x.responseText || '{}'); } catch { /* not JSON */ } if (x.status >= 200 && x.status < 300) resolve(d2); else reject(new Error(d2.error || `Upload failed (${x.status}).`)); };
        x.onerror = () => reject(new Error('The upload stopped. Check the connection and upload this pack again.'));
        x.send(file);
      });
    }
    $('[data-pack-file]', el).addEventListener('change', async (e) => {
      const files = [...e.target.files]; e.target.value = '';
      const box = $('#voPackP', el);
      let added = 0; let existed = 0; let linked = 0;
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        box.innerHTML = `<div class="vo-run live"><div class="vo-run-h"><b>Uploading ${i + 1} of ${files.length}</b><span>${esc(f.name)} · ${mb(f.size)}</span></div><div class="vo-pbar"><i style="width:0%"></i></div></div>`;
        const bar = $('.vo-pbar i', box);
        try {
          const r = await uploadPack(f, (k) => { if (bar) bar.style.width = Math.round(k * 100) + '%'; });
          added += r.upload.added; existed += r.upload.existed; linked += r.linked || 0;
          if (r.run) { drawRun(r.run); watch(); }
        } catch (err) { box.innerHTML = `<p class="err">${esc(f.name)}: ${esc(err.message)}</p>`; packStatus(); return; }
      }
      box.innerHTML = `<p class="info-line sm">${icon('check')}<span>${fmt(added)} new clips added${existed ? `, ${fmt(existed)} were already there` : ''}${linked ? `. ${fmt(linked)} linked to their slides` : ''}.</span></p>`;
      toast('Voice packs uploaded');
      packStatus();
    });

    /* ----- intro music ----- */
    const muUrl = () => (d.music ? d.music.url : (s.music.file ? '/voice-music/' + s.music.file : d.music_default));
    $('#voMusic', el).addEventListener('click', async (e) => {
      const pb = e.target.closest('[data-mu-play]');
      if (pb) { playUrl(muUrl(), pb); return; }
      const db = e.target.closest('[data-mu-default]');
      if (db) { const r = await run(db, () => A.DEL('/api/admin/voice/music'), 'Back to the default intro music'); if (r) A.route(true); }
    });
    $('#voMusic [name="music_on"]', el).addEventListener('change', (e) => run(null, () => PUT('/api/admin/voice/settings', { music: { enabled: e.target.checked } }), e.target.checked ? 'Intro music on' : 'Intro music off'));
    $('[data-mu-file]', el).addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      if (f.size > 8 * 1024 * 1024) { toast('That file is over 8 MB. Use a shorter or smaller MP3.', 'err'); return; }
      try {
        const res = await fetch('/api/admin/voice/music?name=' + encodeURIComponent(f.name.replace(/\.mp3$/i, '').slice(0, 80)), { method: 'POST', headers: { 'x-vs': '1', 'content-type': 'audio/mpeg' }, body: f, credentials: 'same-origin' });
        const dd = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(dd.error || 'Upload failed.');
        toast('Intro music uploaded'); A.route(true);
      } catch (err) { toast(err.message, 'err'); }
    });
    const muF = $('#voMuForm', el);
    muF.addEventListener('input', (e) => { if (e.target.type === 'range') e.target.closest('.vo-sl').querySelector('output').textContent = Number(e.target.value).toFixed(e.target.name === 'volume' ? 2 : 1); });
    muF.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(muF);
      await run($('button[type=submit]', muF), () => PUT('/api/admin/voice/settings', { music: { volume: Number(v.volume), lead_ms: Math.round(Number(v.lead) * 1000), fade_ms: Math.round(Number(v.fade) * 1000) } }), 'Music saved');
    });

    /* ----- sound settings ----- */
    const setF = $('#voSet', el);
    setF.addEventListener('input', (e) => { if (e.target.type === 'range') e.target.closest('.vo-sl').querySelector('output').textContent = Number(e.target.value).toFixed(2); });
    setF.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = readForm(setF);
      const body = { cost_per_1k: v.cost_per_1k === '' ? 0 : v.cost_per_1k, concurrency: Number(v.concurrency) };
      if (s.provider === 'elevenlabs') body.elevenlabs = { model_id: v.model_id, output: v.output, stability: Number(v.stability), similarity: Number(v.similarity), style: Number(v.style), speed: Number(v.speed), speaker_boost: v.speaker_boost };
      else body.openai = { model: v.model, voice: v.voice, instructions: v.instructions, speed: Number(v.speed) };
      const r = await run($('button[type=submit]', setF), () => PUT('/api/admin/voice/settings', body), 'Sound settings saved');
      if (r) A.route(true);
    });

    /* ----- pronunciation ----- */
    const tryIt = A.debounce(async () => { try { const r = await POST('/api/admin/voice/spoken', { text: $('#voTry', el).value, dictionary: readDict() }); $('#voSaid', el).innerHTML = `Read as: <b>${esc(r.spoken)}</b>`; } catch { /* ignore */ } }, 300);
    $('#voDict', el).addEventListener('input', tryIt);
    $('#voAdd', el).onclick = () => { $('#voRows', el).insertAdjacentHTML('beforeend', dictRow(['', ''])); $('#voRows .vo-dr:last-child input', el).focus(); };
    $('#voRows', el).addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { b.closest('.vo-dr').remove(); tryIt(); } });
    $('#voDictSave', el).onclick = (e) => run(e.currentTarget, () => PUT('/api/admin/voice/settings', { dictionary: readDict() }), 'Pronunciation saved. Lines that use these words count as changed.');
    tryIt();

    /* ----- generate: scope, estimate, run ----- */
    let scope = 'school'; let mode = 'missing'; let est = null;
    const lessonsCache = {};
    const sch = $('#voSch', el), mod = $('#voMod', el), les = $('#voLes', el);
    const fillMods = () => { const x = d.schools.find((y) => y.slug === sch.value); mod.innerHTML = (x ? x.modules : []).map((m) => `<option value="${m.id}">${m.order}. ${esc(m.title)}</option>`).join(''); };
    const fillLessons = async () => {
      if (!mod.value) { les.innerHTML = ''; return; }
      if (!lessonsCache[mod.value]) { try { lessonsCache[mod.value] = (await GET('/api/admin/voice/lessons?module=' + mod.value)).lessons; } catch { lessonsCache[mod.value] = []; } }
      les.innerHTML = lessonsCache[mod.value].map((l) => `<option value="${l.id}">${l.idx + 1}. ${esc(l.title)}</option>`).join('');
    };
    const target = () => (scope === 'lesson' ? les.value : scope === 'module' ? mod.value : scope === 'school' ? sch.value : '');
    const estimate = A.debounce(async () => {
      const box = $('#voEst', el); const go = $('#voGo', el);
      if (scope !== 'all' && !target()) { box.innerHTML = ''; go.disabled = true; return; }
      box.classList.add('loading');
      try { est = (await GET(`/api/admin/voice/estimate?scope=${scope}&id=${encodeURIComponent(target())}&mode=${mode}`)).estimate; } catch (e) { box.innerHTML = `<p class="err">${esc(e.message)}</p>`; go.disabled = true; return; } finally { box.classList.remove('loading'); }
      if (!el.isConnected) return;
      box.innerHTML = `<div class="vo-cost"><b>${money(est.cost_usd)}</b><span>about, for ${fmt(est.chars)} characters</span></div>
        <dl class="vo-facts sm"><div><dt>Clips to make</dt><dd>${fmt(est.new_clips)}${est.reused ? ` <small>+ ${fmt(est.reused)} reused free</small>` : ''}</dd></div>
          <div><dt>Already up to date</dt><dd>${fmt(est.up_to_date)}</dd></div>
          <div><dt>Audio</dt><dd>${dur(est.audio_secs * 1000)} · ${mb(est.bytes)}</dd></div>
          ${est.no_text ? `<div><dt>Slides with no script</dt><dd>${fmt(est.no_text)}</dd></div>` : ''}
          ${est.not_in_pack ? `<div><dt>Not in the voice pack yet</dt><dd>${fmt(est.not_in_pack)}</dd></div>` : ''}</dl>`;
      go.disabled = !st.ready || !est.clips;
      go.textContent = !st.ready ? 'Finish the setup first' : est.clips ? `${s.provider === 'included' ? 'Link' : 'Generate'} ${fmt(est.clips)} clip${est.clips === 1 ? '' : 's'}${est.cost_usd ? ` (about ${money(est.cost_usd)})` : ''}` : est.not_in_pack ? 'Upload the voice pack for these lines' : 'Everything here is up to date';
    }, 200);
    const showPick = () => $$('.vo-pick [data-for]', el).forEach((f) => { f.hidden = !f.dataset.for.split(' ').includes(scope); });
    $('.vo-scope', el).addEventListener('click', async (e) => { const b = e.target.closest('[data-v]'); if (!b) return; scope = b.dataset.v; $$('.vo-scope button', el).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); showPick(); if (scope === 'lesson' && !les.value) await fillLessons(); estimate(); });
    $('.vo-mode', el).addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (!b) return; mode = b.dataset.v; $$('.vo-mode button', el).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); }); estimate(); });
    sch.addEventListener('change', async () => { fillMods(); await fillLessons(); estimate(); });
    mod.addEventListener('change', async () => { await fillLessons(); estimate(); });
    les.addEventListener('change', estimate);
    fillMods(); estimate();
    $('#voGo', el).onclick = (e) => {
      const b = e.currentTarget;
      const go = async () => { const r = await run(b, () => POST('/api/admin/voice/generate', { scope, id: target(), mode }), (x) => (x.queued ? `${fmt(x.queued)} clips queued` : x.message)); if (r) { drawRun(r.run); watch(); } };
      if (est && (est.cost_usd >= 20 || mode === 'all')) confirmIn(b, { text: `Generate ${fmt(est.clips)} clips for about ${money(est.cost_usd)}? It runs in the background; you can leave this page or stop it.`, yes: 'Generate', danger: false, onYes: go });
      else go();
    };

    function drawRun(r) {
      const box = $('#voRun', el); if (!box) return;
      if (!r) { box.innerHTML = ''; return; }
      const live = r.state === 'running' || r.state === 'stopping';
      const p = r.total ? Math.round(r.done / r.total * 100) : 0;
      box.innerHTML = `<div class="vo-run ${live ? 'live' : ''} st-${r.state}">
        <div class="vo-run-h"><b>${live ? 'Generating' : r.state === 'stopped' ? 'Stopped' : 'Last run'}</b><span>${esc(r.label)}</span>${live ? `<button type="button" class="btn btn-ghost btn-xs" data-stop>Stop</button>` : ''}</div>
        <div class="vo-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="${r.total}" aria-valuenow="${r.done}" aria-label="Clips done"><i style="width:${p}%"></i></div>
        <div class="vo-run-n"><span><b>${fmt(r.done)}</b> of ${fmt(r.total)}</span><span>${fmt(r.made)} made</span><span>${fmt(r.reused)} reused</span>${r.failed ? `<span class="bad">${fmt(r.failed)} failed</span>` : ''}<span>${money(r.cost)}</span></div>
        ${live && r.current.length ? `<ul class="vo-now">${r.current.map((c) => `<li><i></i>${esc(c.title)} <small>${esc(c.slot)}</small></li>`).join('')}</ul>` : ''}
        ${r.stop_reason ? `<p class="vo-prob">${icon('flag')}<span>${esc(r.stop_reason)}</span></p>` : ''}
        ${r.errors.length ? `<details class="vo-errs"><summary>${fmt(r.errors.length)} error${r.errors.length === 1 ? '' : 's'}</summary><ul>${r.errors.map((x) => `<li><a href="#school/voice/lesson/${x.lesson_id}">${esc(x.title)} · ${esc(x.slot)}</a><span>${esc(x.error)}</span></li>`).join('')}</ul></details>` : ''}
      </div>`;
      const sb = $('[data-stop]', box);
      if (sb) sb.onclick = () => run(sb, () => POST('/api/admin/voice/stop'), 'Stopping after the clips in progress');
    }
    async function watch() {
      clearTimeout(poll);
      let r;
      try { r = (await GET('/api/admin/voice/run')).run; } catch { poll = setTimeout(watch, 3000); return; }
      if (!el.isConnected) return;
      drawRun(r);
      if (r && (r.state === 'running' || r.state === 'stopping')) poll = setTimeout(watch, 1000);
      else { loadTable(); estimate(); }
    }
    drawRun(d.run);
    if (d.run && (d.run.state === 'running' || d.run.state === 'stopping')) watch();

    /* ----- lessons table ----- */
    const lsch = $('#voLsch', el);
    lsch.value = (schoolsSorted[0] && schoolsSorted[0].slug) || '';
    async function loadTable() {
      const box = $('#voLT', el); if (!box) return;
      let ls;
      try { ls = (await GET('/api/admin/voice/lessons?school=' + encodeURIComponent(lsch.value))).lessons; } catch (e) { box.innerHTML = errorBox(e, false); return; }
      if (!el.isConnected) return;
      if (!ls.length) { box.innerHTML = empty('book', 'No lessons in this school'); return; }
      let lastMod = null;
      box.innerHTML = `<div class="vo-lt">${ls.map((l) => {
        const c = l.counts; const n = Math.max(1, l.with_text);
        const seg = ['ready', 'stale', 'changed', 'error', 'missing'].map((k) => (c[k] ? `<i class="s-${k}" style="flex:${c[k]}" title="${esc(STATES[k][0])}: ${c[k]}"></i>` : '')).join('');
        const head = l.module_id !== lastMod ? `<div class="vo-lm">Module ${l.module_sort}: ${esc(l.module)}</div>` : '';
        lastMod = l.module_id;
        return `${head}<a class="vo-lr" href="#school/voice/lesson/${l.id}">
          <span class="ss-mo">${l.idx + 1}</span>
          <span class="ss-mt"><b>${esc(l.title)}</b><small>${l.with_text ? `${fmt(l.with_text)} of ${fmt(l.slots)} lines have a script${l.edited ? ` · ${l.edited} edited here` : ''}` : 'No script yet'}</small></span>
          <span class="vo-mini" aria-label="${fmt(c.ready)} of ${fmt(n)} ready">${l.with_text ? seg : '<i class="s-none" style="flex:1"></i>'}</span>
          <span class="vo-lc">${l.with_text ? `<b>${fmt(c.ready)}</b>/${fmt(l.with_text)}` : '—'}</span>
          <span class="vo-ld">${l.duration_ms ? dur(l.duration_ms) : ''}</span>${icon('arrow')}</a>`;
      }).join('')}</div>
      <div class="vo-legend">${['ready', 'stale', 'changed', 'error', 'missing'].map((k) => `<span><i class="s-${k}"></i>${esc(STATES[k][0])}</span>`).join('')}</div>`;
    }
    lsch.addEventListener('change', loadTable);
    loadTable();
  }

  /* =====================================================================
   * ONE LESSON: hear, edit and regenerate each clip
   * ===================================================================== */
  async function lessonPage(el, id) {
    el.innerHTML = `${backLink('#school/voice', 'Teaching voice')}<div class="card">${skelRows(6, 64)}</div>`;
    let d; let ready = true; let poll = null;
    A.S.cleanup.push(() => clearTimeout(poll));
    const load = async () => { d = await GET('/api/admin/voice/lessons/' + id); try { ready = (await GET('/api/admin/voice')).status.ready; } catch { /* keep */ } };
    try { await load(); } catch (e) { el.innerHTML = backLink('#school/voice', 'Teaching voice') + errorBox(e); return; }
    if (!el.isConnected) return;
    const L = d.lesson;
    const draw = () => {
      const c = d.lesson.counts;
      el.innerHTML = `${backLink('#school/voice', 'Teaching voice')}
        <div class="ph"><div class="ph-t"><h2>${esc(L.title)}</h2><p>${esc(L.school_title)} · Module ${L.module_sort}: ${esc(L.module)} · ${fmt(c.ready)} of ${fmt(L.with_text)} clips ready${L.duration_ms ? ' · ' + dur(L.duration_ms) : ''}</p></div>
          <div class="ph-r"><a class="btn btn-w btn-sm" href="#school/lesson/${L.id}">${icon('pen')}Edit the slides</a><button type="button" class="btn btn-g btn-sm" id="vlGen" ${ready ? '' : 'disabled'}>${icon('refresh')}Generate missing or changed</button></div></div>
        <div class="card vo-clips">${d.clips.map(clipRow).join('')}</div>`;
      $('#vlGen', el).onclick = async (e) => { const r = await run(e.currentTarget, () => POST('/api/admin/voice/generate', { scope: 'lesson', id: L.id, mode: 'missing' }), (x) => (x.queued ? `${x.queued} clips queued` : x.message)); if (r && r.queued) follow(); };
    };
    const clipRow = (c) => `<div class="vo-c st-${c.state}" data-slot="${c.slot}">
      <div class="vo-cl"><b>${esc(c.label)}</b><small class="${c.v === 'intro' || c.v === 'outro' ? 'plain' : ''}">${esc(c.v === 'intro' || c.v === 'outro' ? (c.v === 'intro' ? 'When the lesson opens' : 'Before the quiz') : c.v)}</small></div>
      <div class="vo-cm">
        ${c.h && c.v !== 'intro' && c.v !== 'outro' ? `<span class="vo-ch">${esc(c.h)}</span>` : ''}
        <p class="vo-ct" data-text>${c.text ? esc(c.text) : '<em>No script for this slide. Write one to give it a voice.</em>'}</p>
        <div class="vo-cf">${statePill(c.state)}${c.edited ? pill('Edited here', 'gold') : ''}<span>${fmt(c.chars)} characters</span>${c.duration_ms ? `<span>${dur(c.duration_ms)}</span>` : ''}${c.generated_at ? `<span>${esc(dateStr(c.generated_at))}${c.voice ? ' · ' + esc(c.voice) : ''}</span>` : ''}</div>
        ${c.error ? `<p class="vo-cerr">${icon('flag')}<span>${esc(c.error)}</span></p>` : ''}
      </div>
      <div class="vo-ca">
        ${c.url ? `<button type="button" class="vo-pl" data-play="${esc(c.url)}" aria-label="Play">${icon('play')}</button>` : '<span class="vo-pl off" aria-hidden="true"></span>'}
        <button type="button" class="ib2" data-edit aria-label="Edit what this clip says">${icon('pen')}</button>
        ${c.text ? `<button type="button" class="ib2" data-regen aria-label="${c.state === 'ready' ? 'Make a new take' : 'Generate this clip'}" title="${c.state === 'ready' ? 'Make a new take' : 'Generate this clip'}" ${ready ? '' : 'disabled'}>${icon('refresh')}</button>` : ''}
      </div></div>`;
    const replace = (c) => { const row = $(`.vo-c[data-slot="${c.slot}"]`, el); if (row) row.outerHTML = clipRow(c); };
    async function follow() {
      clearTimeout(poll);
      let r; try { r = (await GET('/api/admin/voice/run')).run; } catch { r = null; }
      try { d = await GET('/api/admin/voice/lessons/' + id); } catch { /* keep */ }
      if (!el.isConnected) return;
      d.clips.forEach(replace);
      if (r && (r.state === 'running' || r.state === 'stopping')) poll = setTimeout(follow, 900);
      else draw();
    }
    draw();
    if (d.clips.some((c) => c.state === 'queued' || c.state === 'running')) follow();
    el.addEventListener('click', async (e) => {
      const row = e.target.closest('.vo-c'); if (!row) return;
      const c = d.clips.find((x) => x.slot === row.dataset.slot);
      const pb = e.target.closest('[data-play]');
      if (pb) { playUrl(pb.dataset.play, pb); return; }
      if (e.target.closest('[data-regen]')) {
        const b = e.target.closest('[data-regen]');
        const r = await run(b, () => POST('/api/admin/voice/generate', { scope: 'clip', id: L.id, slot: c.slot }), (x) => (!x.queued && x.message ? x.message : c.state === 'ready' ? 'New take queued' : 'Clip queued'));
        if (r && r.queued !== 0) follow();
        return;
      }
      if (e.target.closest('[data-edit]')) {
        if ($('.vo-ed', row)) return;
        const t = $('[data-text]', row);
        t.outerHTML = `<div class="vo-ed"><textarea class="inp" rows="4" maxlength="4000" aria-label="What ${esc(c.label)} says">${esc(c.text)}</textarea>
          <div class="row"><button type="button" class="btn btn-g btn-xs" data-save>Save text</button>${ready ? '<button type="button" class="btn btn-k btn-xs" data-save-gen>Save and generate</button>' : ''}<button type="button" class="btn btn-ghost btn-xs" data-cancel>Cancel</button>${c.edited ? '<button type="button" class="btn btn-ghost btn-xs" data-reset>Use the file text</button>' : ''}<span class="vo-cc"></span></div>
          ${c.edited && c.file_text ? `<p class="hint">From the file: ${esc(c.file_text)}</p>` : ''}<p class="hint">Write for the ear: short sentences, numbers as words ("forty dollars"), letters spaced ("C P A"). Plain text, no tags.</p></div>`;
        const ta = $('.vo-ed textarea', row);
        const cnt = () => { $('.vo-cc', row).textContent = `${ta.value.length} characters`; };
        ta.addEventListener('input', cnt); cnt(); ta.focus();
        return;
      }
      if (e.target.closest('[data-cancel]')) { replace(c); return; }
      const sv = e.target.closest('[data-save],[data-save-gen],[data-reset]');
      if (sv) {
        const body = sv.hasAttribute('data-reset') ? { slot: c.slot, reset: true } : { slot: c.slot, text: $('.vo-ed textarea', row).value };
        const r = await run(sv, () => PUT(`/api/admin/voice/lessons/${L.id}/text`, body), sv.hasAttribute('data-reset') ? 'Back to the file text' : 'Text saved');
        if (!r) return;
        Object.assign(c, r.clip); replace(c);
        if (sv.hasAttribute('data-save-gen') && r.clip.text) { const g = await run(null, () => POST('/api/admin/voice/generate', { scope: 'clip', id: L.id, slot: c.slot }), 'Clip queued'); if (g) follow(); }
      }
    });
  }
})();
