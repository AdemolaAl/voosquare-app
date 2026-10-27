'use strict';
/* Teaching voice checks (src/voice.js): narration loaded from the content files, the admin page's API (status, voices,
 * settings, pronunciation, estimate, generate, stop, inline edits), the generation queue against a mock ElevenLabs/OpenAI
 * (retries, fatal errors, content-addressed caching), clip serving (who may hear a clip, Range requests, cache headers)
 * and the member side (voice in the lesson payload, preferences, the feature switch).
 * Called from test/smoke.js, which points both providers at the mock (VOICE_API_BASE, test mode only). */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

const TONE = fs.readFileSync(path.join(__dirname, 'fixtures', 'voice', 'tone-1s.mp3'));

/** A stand-in for api.elevenlabs.io and api.openai.com. Switches in st inject failures and delays. */
function mockTts(port) {
  const st = { calls: [], fail429: 0, fail500: 0, fail401: false, garbage: 0, delay: 0 };
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const send = (code, obj, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(obj)); };
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/v1/voices') {
        if (req.headers['xi-api-key'] !== 'el_test_key') return send(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
        return send(200, { voices: [{ voice_id: 'voiceBBB222', name: 'Rachel', category: 'premade', labels: { accent: 'american' } }, { voice_id: 'voiceAAA111', name: 'Ejiro (clone)', category: 'cloned', labels: { accent: 'nigerian', use: 'teaching' } }, { voice_id: 'bad id!', name: 'Broken' }] });
      }
      const el = /^\/v1\/text-to-speech\/([^/]+)$/.exec(u.pathname);
      const oa = u.pathname === '/v1/audio/speech';
      if (req.method === 'POST' && (el || oa)) {
        if (el && req.headers['xi-api-key'] !== 'el_test_key') return send(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
        if (oa && req.headers.authorization !== 'Bearer sk-test-key') return send(401, { error: { message: 'Incorrect API key provided' } });
        const body = JSON.parse(raw || '{}');
        st.calls.push({ provider: el ? 'elevenlabs' : 'openai', voice: el ? decodeURIComponent(el[1]) : body.voice, text: el ? body.text : body.input, body, format: u.searchParams.get('output_format') });
        if (st.delay) await new Promise((r) => setTimeout(r, st.delay));
        if (st.fail401) return send(401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
        if (st.fail429 > 0) { st.fail429--; return send(429, { detail: { status: 'too_many_concurrent_requests', message: 'Too many requests' } }); }
        if (st.fail500 > 0) { st.fail500--; return send(500, { detail: { message: 'Server error' } }); }
        if (st.garbage > 0) { st.garbage--; res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end('<html>not audio</html>'); }
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'content-length': TONE.length });
        return res.end(TONE);
      }
      send(404, { detail: 'not found' });
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r({ st, srv })));
}

module.exports = async function voice({ BASE, Client, check, owner, VOICE, VOICE_MOCK_PORT }) {
  const mock = await mockTts(VOICE_MOCK_PORT);
  const { st } = mock;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const xf = () => ({ 'x-forwarded-for': `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (c, email, name) => { const s = await c.post('/api/auth/start', { email, name }, xf()); return c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf()); };
  const waitRun = async (ms = 8000) => { const t = Date.now(); let r; while (Date.now() - t < ms) { r = (await owner.get('/api/admin/voice/run')).data.run; if (r && !['running', 'stopping'].includes(r.state)) return r; await sleep(40); } return r; };
  const raw = async (client, p, headers = {}, method = 'GET') => { const res = await fetch(BASE + p, { method, headers: { ...(client && client.cookie ? { cookie: client.cookie } : {}), ...headers } }); const buf = Buffer.from(await res.arrayBuffer()); return { status: res.status, headers: res.headers, buf }; };
  try {
    console.log('Teaching voice: content and admin');
    const adm = (await owner.get('/api/admin/school')).data;
    const lab = adm.schools.find((s) => s.slug === 'lab');
    const labM = lab.modules[0];
    const labL = (await owner.get('/api/admin/school/modules/' + labM.id)).data.lessons.map((l) => l.id);
    const L0 = labL[0], L1 = labL[1], L2 = labL[2];

    const d0 = (await owner.get(`/api/admin/voice/lessons/${L0}`)).data;
    const slot = (d, k) => d.clips.find((c) => c.slot === k);
    check('voice: loader picks up say_intro, each slide say and say_outro', d0.clips.length === 18 && /every classic slide/.test(slot(d0, 'intro').text) && /Now take the quiz/.test(slot(d0, 'outro').text) && /price every lead/.test(slot(d0, 's0').text) && slot(d0, 's0').state === 'missing', d0.clips.slice(0, 3));
    check('voice: slides without say have no clip (and nothing breaks)', slot(d0, 's6').text === '' && slot(d0, 's6').state === 'none' && d0.lesson.with_text === 8);
    const d2 = (await owner.get(`/api/admin/voice/lessons/${L2}`)).data;
    check('voice: a lesson without intro or outro still lists its slides', slot(d2, 'intro').state === 'none' && slot(d2, 's0').text.includes('pause and try it'));

    const mem = new Client(); await login(mem, 'voice-1@test.dev', 'Voice Member');
    const memId = (await mem.get('/api/me')).data.user.id;
    const locked = new Client(); await login(locked, 'voice-2@test.dev', 'Locked Member');
    check('voice admin: Academy permission needed', (await mem.get('/api/admin/voice')).status === 403 && (await mem.post('/api/admin/voice/generate', { scope: 'all' })).status === 403 && (await mem.put(`/api/admin/voice/lessons/${L0}/text`, { slot: 's0', text: 'x' })).status === 403);

    const a0 = (await owner.get('/api/admin/voice')).data;
    check('voice admin: provider status (keys found, a voice still to pick)', a0.status.provider === 'elevenlabs' && a0.status.providers.elevenlabs.key && a0.status.providers.openai.key && !a0.status.ready && /Pick a voice/.test(a0.status.problem) && a0.settings.elevenlabs.model_id === 'eleven_multilingual_v2' && a0.settings.concurrency === 2 && a0.feature === true, a0.status);
    check('voice admin: options and totals', a0.options.eleven_models.length >= 3 && a0.options.outputs.some((o) => o[0] === 'mp3_22050_32') && a0.totals.with_text >= 8 && a0.totals.ready === 0 && a0.schools.some((s) => s.slug === 'lab' && s.modules.length >= 1));
    const g0 = await owner.post('/api/admin/voice/generate', { scope: 'lesson', id: L0 });
    check('voice: generating needs a voice first', g0.status === 400 && /Pick a voice/.test(g0.data.error));
    const vv = (await owner.get('/api/admin/voice/voices')).data;
    check('voice admin: ElevenLabs voice list (cloned first, bad ids dropped)', vv.voices.length === 2 && vv.voices[0].id === 'voiceAAA111' && vv.voices[0].category === 'cloned' && vv.voices[0].labels.includes('nigerian'));
    check('voice admin: bad voice ids refused', (await owner.put('/api/admin/voice/settings', { elevenlabs: { voice_id: 'x"; drop' } })).status === 400 && (await owner.put('/api/admin/voice/settings', { provider: 'polly' })).status === 400);
    const saved = await owner.put('/api/admin/voice/settings', { elevenlabs: { voice_id: 'voiceAAA111', voice_name: 'Ejiro (clone)', stability: 0.42, output: 'mp3_22050_32' }, cost_per_1k: 0.2, dictionary: [['VooSquare', 'voo square'], ['U T M', 'U T M'], ['Dchessking', 'D chess king'], ['', 'skip']] });
    check('voice admin: settings saved (voice, stability, format, price, dictionary)', saved.status === 200 && saved.data.status.ready && saved.data.settings.elevenlabs.stability === 0.42 && saved.data.settings.dictionary.length === 3 && saved.data.status.price_per_1k === 0.2, saved.data);
    const sp = (await owner.post('/api/admin/voice/spoken', { text: 'Welcome to VooSquare, not VooSquareX. vOOsquare too.' })).data.spoken;
    check('voice: pronunciation list replaces whole words, any case', sp === 'Welcome to voo square, not VooSquareX. voo square too.', sp);

    const est = (await owner.get(`/api/admin/voice/estimate?scope=lesson&id=${L0}&mode=missing`)).data.estimate;
    const texts = d0.clips.filter((c) => c.text).map((c) => c.text.replace('Dchessking', 'D chess king').replace(/VooSquare/g, 'voo square'));
    const chars = texts.reduce((a, t) => a + t.length, 0);
    check('voice: cost estimate before running (clips, characters, $ per 1k, audio size)', est.clips === 8 && est.new_clips === 8 && est.chars === chars && est.cost_usd === Math.round(chars / 1000 * 0.2 * 100) / 100 && est.audio_secs > 0 && est.bytes > 0 && est.no_text === 10, { est, chars });
    const estAll = (await owner.get('/api/admin/voice/estimate?scope=all&mode=missing')).data.estimate;
    check('voice: estimate for every school counts every lesson', estAll.lessons > 300 && estAll.clips >= 8);

    console.log('Teaching voice: generation');
    st.fail429 = 2;
    const g1 = await owner.post('/api/admin/voice/generate', { scope: 'lesson', id: L0, mode: 'missing' });
    check('voice: generate a lesson (8 clips queued)', g1.status === 200 && g1.data.queued === 8 && g1.data.run.total === 8, g1.data);
    const r1 = await waitRun();
    check('voice: run finishes; two 429s were retried', r1.state === 'done' && r1.done === 8 && r1.made === 8 && r1.failed === 0 && r1.retries === 2 && st.calls.length === 10 && r1.chars === chars, r1);
    check('voice: requests carry the voice, model, settings and format', st.calls.every((c) => c.provider === 'elevenlabs' && c.voice === 'voiceAAA111' && c.format === 'mp3_22050_32' && c.body.model_id === 'eleven_multilingual_v2' && c.body.voice_settings.stability === 0.42));
    check('voice: pronunciation applied before sending', st.calls.some((c) => c.text.includes('D chess king')) && !st.calls.some((c) => /Dchessking|VooSquare/.test(c.text)) && st.calls.some((c) => c.text.includes('voo square')));
    const d1 = (await owner.get(`/api/admin/voice/lessons/${L0}`)).data;
    const ready = d1.clips.filter((c) => c.state === 'ready');
    const files = fs.readdirSync(VOICE).filter((f) => f.endsWith('.mp3'));
    check('voice: clips ready, content-addressed (sha256 names), length read from the MP3', ready.length === 8 && ready.every((c) => /^\/voice\/[a-f0-9]{64}\.mp3$/.test(c.url) && c.duration_ms > 950 && c.duration_ms < 1200 && c.bytes === TONE.length) && files.length === 8, ready.map((c) => [c.url, c.duration_ms]));

    const n1 = st.calls.length;
    const g2 = (await owner.post('/api/admin/voice/generate', { scope: 'lesson', id: L0, mode: 'missing' })).data;
    check('voice: only missing/changed: nothing to do, nothing sent', g2.queued === 0 && /up to date/.test(g2.message) && st.calls.length === n1);
    // The same sentence in another lesson is the same file: no provider call.
    const same = slot(d1, 'intro').text;
    await owner.put(`/api/admin/voice/lessons/${L1}/text`, { slot: 'intro', text: same });
    const e1 = (await owner.get(`/api/admin/voice/estimate?scope=clip&id=${L1}&slot=intro`)).data.estimate;
    await owner.post('/api/admin/voice/generate', { scope: 'clip', id: L1, slot: 'intro' });
    await waitRun();
    const l1i = slot((await owner.get(`/api/admin/voice/lessons/${L1}`)).data, 'intro');
    check('voice: identical text is reused by hash (free, no request)', e1.reused === 1 && e1.chars === 0 && st.calls.length === n1 && l1i.state === 'ready' && l1i.edited && l1i.url === slot(d1, 'intro').url, { e1, l1i });
    await owner.put(`/api/admin/voice/lessons/${L1}/text`, { slot: 'intro', reset: true });

    console.log('Teaching voice: who hears a clip');
    const introUrl = slot(d1, 'intro').url;
    check('voice: logged out cannot fetch a clip (401)', (await raw(null, introUrl)).status === 401);
    check('voice: a member whose lesson is locked gets 403', (await raw(locked, introUrl)).status === 403);
    check('voice: unknown or malformed clip names are 404', (await raw(owner, '/voice/' + 'a'.repeat(64) + '.mp3')).status === 404 && (await raw(owner, '/voice/..%2Fvoosquare.db')).status === 404);
    const full = await raw(owner, introUrl);
    check('voice: the team hears every clip (audio/mpeg, long private cache, ranges)', full.status === 200 && full.headers.get('content-type') === 'audio/mpeg' && full.buf.equals(TONE) && /private/.test(full.headers.get('cache-control')) && /immutable/.test(full.headers.get('cache-control')) && full.headers.get('accept-ranges') === 'bytes' && full.headers.get('etag'));
    const lv0 = (await locked.get(`/api/school/lessons/${L0}`));
    check('voice: the locked member cannot open the lesson either', lv0.status === 403);

    await owner.post(`/api/admin/school/members/${memId}/grant`, { action: 'open_school', school_id: lab.id });
    await mem.post('/api/school/schools/lab/enroll');
    const ml = (await mem.get(`/api/school/lessons/${L0}`)).data;
    const v = ml.voice;
    check('voice: lesson payload has a clip per slide shown, plus intro and outro', v && v.available && v.count === 8 && v.steps.length === ml.lesson.steps.length && v.intro.url === introUrl && v.intro.ms > 900 && v.steps[0].text === ml.lesson.steps[0].say && v.steps[6] === null && v.outro && v.prefs.enabled === true && v.prefs.speed === 1, v);
    const mf = await raw(mem, introUrl);
    check('voice: a member with the lesson open hears it', mf.status === 200 && mf.buf.length === TONE.length);
    const size = TONE.length;
    const r0 = await raw(mem, introUrl, { Range: 'bytes=0-99' });
    const rMid = await raw(mem, introUrl, { Range: 'bytes=100-' });
    const rSuf = await raw(mem, introUrl, { Range: 'bytes=-50' });
    const rBad = await raw(mem, introUrl, { Range: `bytes=${size + 10}-` });
    check('voice: Range requests (206 with Content-Range, suffix ranges, 416 past the end)', r0.status === 206 && r0.buf.length === 100 && r0.headers.get('content-range') === `bytes 0-99/${size}` && r0.buf.equals(TONE.subarray(0, 100))
      && rMid.status === 206 && rMid.buf.length === size - 100 && rSuf.status === 206 && rSuf.buf.equals(TONE.subarray(size - 50)) && rBad.status === 416 && rBad.headers.get('content-range') === `bytes */${size}`);
    const hd = await raw(mem, introUrl, {}, 'HEAD');
    check('voice: HEAD gives the length without a body; ETag answers 304', hd.status === 200 && Number(hd.headers.get('content-length')) === size && hd.buf.length === 0 && (await raw(mem, introUrl, { 'If-None-Match': full.headers.get('etag') })).status === 304);
    // Lesson 2 is still locked for this member (lesson 1's quiz not passed): its clips stay private.
    st.calls.length = 0;
    await owner.post('/api/admin/voice/generate', { scope: 'lesson', id: L1 });
    const rl1 = await waitRun();
    const dL1 = (await owner.get(`/api/admin/voice/lessons/${L1}`)).data;
    check('voice: second lesson generated (12 clips)', rl1.state === 'done' && dL1.clips.filter((c) => c.state === 'ready').length === 12, rl1);
    check('voice: a clip of a locked lesson is 403 for the member', (await raw(mem, slot(dL1, 's9').url)).status === 403);

    console.log('Teaching voice: edits, regenerate, errors');
    const before = slot(d1, 's0');
    const bad1 = await owner.put(`/api/admin/voice/lessons/${L0}/text`, { slot: 's0', text: 'Hello <break time="1s"/> there' });
    const bad2 = await owner.put(`/api/admin/voice/lessons/${L0}/text`, { slot: 's99', text: 'Hello' });
    check('voice admin: tags and unknown clips refused', bad1.status === 400 && bad2.status === 400);
    const ed = (await owner.put(`/api/admin/voice/lessons/${L0}/text`, { slot: 's0', text: 'Before you spend anything, price every lead. VooSquare shows you how.' })).data.clip;
    check('voice admin: inline edit is stored as an override (edited) and marks the clip changed', ed.edited && ed.state === 'changed' && ed.file_text === before.text && ed.heard_text === before.text);
    const ml2 = (await mem.get(`/api/school/lessons/${L0}`)).data.voice;
    check('voice: members never hear audio that does not match the caption', ml2.steps[0] === null && ml2.count === 7);
    st.calls.length = 0;
    await owner.post('/api/admin/voice/generate', { scope: 'clip', id: L0, slot: 's0' });
    await waitRun();
    const after = slot((await owner.get(`/api/admin/voice/lessons/${L0}`)).data, 's0');
    const ml3 = (await mem.get(`/api/school/lessons/${L0}`)).data.voice;
    check('voice admin: regenerate one clip with the new text', st.calls.length === 1 && st.calls[0].text.includes('voo square shows you how') && after.state === 'ready' && after.url !== before.url && ml3.steps[0].text.startsWith('Before you spend') && ml3.steps[0].url === after.url);
    check('voice: the replaced audio file is deleted when nothing uses it', !fs.existsSync(path.join(VOICE, before.url.slice(7))) && fs.existsSync(path.join(VOICE, after.url.slice(7))));
    await owner.post('/api/admin/voice/generate', { scope: 'clip', id: L0, slot: 's0' });
    await waitRun();
    const take2 = slot((await owner.get(`/api/admin/voice/lessons/${L0}`)).data, 's0');
    check('voice admin: regenerating an up-to-date clip makes a new take with a new file name', take2.state === 'ready' && take2.url !== after.url && /^\/voice\/[a-f0-9]{64}-[a-z0-9]+\.mp3$/.test(take2.url) && st.calls.length === 2);
    const rs = (await owner.put(`/api/admin/voice/lessons/${L0}/text`, { slot: 's0', reset: true })).data.clip;
    check('voice admin: reset takes the file text again', !rs.edited && rs.text === before.text && rs.state === 'changed');

    // A lesson edited in the admin (slides saved without "say") still gets the file's narration where slides match.
    const al = (await owner.get(`/api/admin/school/lessons/${L0}`)).data.lesson;
    const stripped = al.steps.map(({ say, ...x }) => x);
    await owner.post(`/api/admin/school/lessons/${L0}`, { steps: stripped });
    const ae = (await owner.get(`/api/admin/voice/lessons/${L0}`)).data;
    check('voice: edited lessons keep the file narration (matched by slide type and heading)', slot(ae, 's1').text === slot(d1, 's1').text && slot(ae, 's1').state === 'ready' && slot(ae, 'intro').state === 'ready');
    await owner.post(`/api/admin/school/lessons/${L0}/revert`);

    st.fail500 = 99;
    st.calls.length = 0;
    await owner.post('/api/admin/voice/generate', { scope: 'clip', id: L2, slot: 's0' });
    const r5 = await waitRun();
    const e5 = slot((await owner.get(`/api/admin/voice/lessons/${L2}`)).data, 's0');
    st.fail500 = 0;
    check('voice: 5xx retried with backoff, then the clip shows the error', r5.failed === 1 && st.calls.length === 5 && e5.state === 'error' && /Server error/.test(e5.error) && r5.errors[0].slot === 's0', { r5, e5 });
    st.garbage = 1;
    await owner.post('/api/admin/voice/generate', { scope: 'clip', id: L2, slot: 's0' });
    const r6 = await waitRun();
    check('voice: retry from the admin works; audio that is not MP3 is retried', r6.failed === 0 && slot((await owner.get(`/api/admin/voice/lessons/${L2}`)).data, 's0').state === 'ready');

    st.fail401 = true;
    st.calls.length = 0;
    await owner.put('/api/admin/voice/settings', { concurrency: 1 });
    await owner.post('/api/admin/voice/generate', { scope: 'lesson', id: L1, mode: 'all' });
    const r7 = await waitRun();
    st.fail401 = false;
    const dE = (await owner.get(`/api/admin/voice/lessons/${L1}`)).data;
    check('voice: a refused key stops the run (no retries, the rest is left as it was)', r7.state === 'stopped' && /Invalid API key/.test(r7.stop_reason) && st.calls.length === 1 && r7.failed === 1 && dE.clips.filter((c) => c.state === 'queued').length === 0 && dE.clips.filter((c) => c.state === 'error').length === 1, r7);

    st.delay = 150;
    await owner.post('/api/admin/voice/generate', { scope: 'lesson', id: L1, mode: 'all' });
    await sleep(60);
    const stp = (await owner.post('/api/admin/voice/stop')).data;
    const r8 = await waitRun();
    st.delay = 0;
    const dS = (await owner.get(`/api/admin/voice/lessons/${L1}`)).data;
    check('voice admin: stop a run; queued clips go back to how they were', stp.stopped && r8.state === 'stopped' && r8.done < 12 && dS.clips.every((c) => c.state !== 'queued' && c.state !== 'running'), r8);
    await owner.put('/api/admin/voice/settings', { concurrency: 2 });

    console.log('Teaching voice: providers, member settings, switch');
    const smp = await raw(owner, '/api/admin/voice/sample', { 'x-vs': '1', 'content-type': 'application/json' }, 'POST');
    check('voice admin: sample sentence plays (audio/mpeg)', smp.status === 200 && smp.headers.get('content-type') === 'audio/mpeg' && smp.buf.equals(TONE));
    await owner.put('/api/admin/voice/settings', { provider: 'openai', openai: { voice: 'nova', model: 'gpt-4o-mini-tts' } });
    st.calls.length = 0;
    const smp2 = await fetch(BASE + '/api/admin/voice/sample', { method: 'POST', headers: { cookie: owner.cookie, 'x-vs': '1', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Testing VooSquare with OpenAI.' }) });
    check('voice: OpenAI adapter (Bearer key, voice, instructions, MP3)', smp2.status === 200 && st.calls.length === 1 && st.calls[0].provider === 'openai' && st.calls[0].voice === 'nova' && st.calls[0].text === 'Testing voo square with OpenAI.' && /teacher/.test(st.calls[0].body.instructions));
    const ov = (await owner.get('/api/admin/voice/voices')).data;
    check('voice: OpenAI voices listed', ov.provider === 'openai' && ov.voices.some((x) => x.id === 'nova'));
    const sl = (await owner.get(`/api/admin/voice/lessons/${L0}`)).data;
    const mlo = (await mem.get(`/api/school/lessons/${L0}`)).data.voice;
    check('voice: a new voice marks clips as older (stale) and members keep hearing them meanwhile', slot(sl, 'intro').state === 'stale' && mlo.intro && mlo.intro.url === introUrl);
    check('voice: the estimate counts stale clips as work', (await owner.get(`/api/admin/voice/estimate?scope=lesson&id=${L0}`)).data.estimate.clips >= 7);
    await owner.put('/api/admin/voice/settings', { provider: 'elevenlabs' });
    check('voice: switching back makes them current again', slot((await owner.get(`/api/admin/voice/lessons/${L0}`)).data, 'intro').state === 'ready');

    const p0 = (await mem.get('/api/school/voice/prefs')).data.prefs;
    const p1 = await mem.put('/api/school/voice/prefs', { enabled: false, speed: 1.25, captions: false });
    check('voice: member preferences (default on; off, speed and captions saved)', p0.enabled && p0.auto && p0.captions && p0.speed === 1 && p1.status === 200 && p1.data.prefs.enabled === false && p1.data.prefs.speed === 1.25 && !p1.data.prefs.captions && p1.data.prefs.auto);
    check('voice: speed must be one of the steps', (await mem.put('/api/school/voice/prefs', { speed: 3 })).status === 400);
    check('voice: lesson payload carries the preferences', (await mem.get(`/api/school/lessons/${L0}`)).data.voice.prefs.enabled === false);
    await mem.put('/api/school/voice/prefs', { enabled: true });

    const f0 = (await owner.get('/api/admin/features')).data.features;
    check('voice: feature switch exists and is on by default', f0.voice === true);
    await owner.put('/api/admin/features', { ...f0, voice: false });
    const off1 = (await mem.get(`/api/school/lessons/${L0}`)).data;
    check('voice: switched off: no voice in lessons, clips 403 for members, the team still hears them', off1.voice === null && off1.lesson.steps.length > 0 && (await raw(mem, introUrl)).status === 403 && (await raw(owner, introUrl)).status === 200 && (await mem.get('/api/school/voice/prefs')).status === 403);
    await owner.put('/api/admin/features', { ...f0, voice: true });
    check('voice: switched back on', (await mem.get(`/api/school/lessons/${L0}`)).data.voice.available === true);

    const ls = (await owner.get(`/api/admin/voice/lessons?school=lab`)).data.lessons;
    check('voice admin: per-lesson table with clip counts', ls.length === 3 && ls[0].counts.ready >= 7 && ls[0].with_text === 8 && ls[0].duration_ms > 6000 && ls[1].slots === 12);
    const tot = (await owner.get('/api/admin/voice')).data.totals;
    check('voice admin: totals (clips ready, files, storage)', tot.ready >= 20 && tot.files >= 20 && tot.bytes > 20 * 4000 && tot.full_cost_usd >= 0);
  } finally {
    mock.srv.close();
  }
};
