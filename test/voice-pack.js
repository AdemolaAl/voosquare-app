'use strict';
/* Included voice (src/voice.js): the free narrator made ahead of time and uploaded as .tar voice packs, linking pack
 * clips to their slides, what members get, upload safety (names, non-MP3s, paths, permissions), and the intro music
 * (default track, upload, serving, settings, switch). Called from test/smoke.js after test/voice.js. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const TONE = fs.readFileSync(path.join(__dirname, 'fixtures', 'voice', 'tone-1s.mp3'));
/** A minimal ustar archive: [{ name, data, type }] → Buffer. */
function tar(entries) {
  const parts = [];
  for (const e of entries) {
    const h = Buffer.alloc(512);
    h.write(e.name.slice(0, 100), 0, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    const data = e.data || Buffer.alloc(0);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
    h.write('        ', 148); h.write(e.type || '0', 156); h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0; for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
const hashIncluded = (spoken) => crypto.createHash('sha256').update(JSON.stringify(['v1', ['included', 'kokoro-am_michael-v1'], spoken])).digest('hex');

module.exports = async function voicePack({ BASE, Client, check, owner, VOICE }) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const xf = () => ({ 'x-forwarded-for': `10.67.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (c, email, name) => { const s = await c.post('/api/auth/start', { email, name }, xf()); return c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf()); };
  const waitRun = async (ms = 8000) => { const t = Date.now(); let r; while (Date.now() - t < ms) { r = (await owner.get('/api/admin/voice/run')).data.run; if (r && !['running', 'stopping'].includes(r.state)) return r; await sleep(40); } return r; };
  const upload = (client, p, body, headers = {}) => fetch(BASE + p, { method: 'POST', headers: { 'x-vs': '1', ...(client && client.cookie ? { cookie: client.cookie } : {}), ...headers }, body }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
  const raw = async (client, p) => { const res = await fetch(BASE + p, { headers: client && client.cookie ? { cookie: client.cookie } : {} }); return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) }; };

  console.log('Included voice: pack, linking, members');
  const adm = (await owner.get('/api/admin/school')).data;
  const lab = adm.schools.find((s) => s.slug === 'lab');
  const L = (await owner.get('/api/admin/school/modules/' + lab.modules[0].id)).data.lessons.map((l) => l.id)[0];
  const before = (await owner.get('/api/admin/voice')).data;
  check('included voice: offered as a provider, free, no key needed', before.status.providers.included && before.status.providers.included.key === true && before.status.providers.included.env === '');
  const sw = await owner.put('/api/admin/voice/settings', { provider: 'included' });
  check('included voice: selecting it is ready at once, $0 per character, 48 kbps', sw.status === 200 && sw.data.status.ready && sw.data.status.price_per_1k === 0 && sw.data.status.kbps === 48 && /Included voice/.test(sw.data.status.voice));
  const est = (await owner.get(`/api/admin/voice/estimate?scope=lesson&id=${L}`)).data.estimate;
  check('included voice: estimates cost nothing', est.cost_usd === 0 && est.price_per_1k === 0);
  const p0 = (await owner.get('/api/admin/voice/pack')).data.pack;
  check('included voice: pack status counts the script lines', p0.lines > 10 && p0.in_pack === 0 && p0.to_link === 0 && p0.voice.id === 'kokoro-am_michael-v1');

  const clips = (await owner.get(`/api/admin/voice/lessons/${L}`)).data.clips.filter((c) => c.text);
  const said = async (t) => (await owner.post('/api/admin/voice/spoken', { text: t })).data.spoken;
  const h0 = hashIncluded(await said(clips[0].text)); const h1 = hashIncluded(await said(clips[1].text));
  const sampleText = before.options.defaults.sample;
  const hs = hashIncluded(await said(sampleText));
  const pack = tar([
    { name: `pack/${h0}.mp3`, data: TONE }, { name: `${h1}.mp3`, data: TONE }, { name: `samples/${hs}.mp3`, data: TONE },
    { name: 'pack/README.txt', data: Buffer.from('hello') }, { name: `../${'b'.repeat(64)}.mp3`, data: TONE }, { name: `${'c'.repeat(64)}.mp3`, data: Buffer.from('<html>not audio</html>') },
    { name: 'pack/sub', type: '5' },
  ]);
  const mem = new Client(); await login(mem, 'pack-1@test.dev', 'Pack Member');
  check('included voice: members cannot upload packs', (await upload(mem, '/api/admin/voice/pack', pack, { 'content-type': 'application/x-tar' })).status === 403);
  check('included voice: upload needs the app header (CSRF)', (await fetch(BASE + '/api/admin/voice/pack', { method: 'POST', headers: { cookie: owner.cookie }, body: pack })).status === 403);
  const up = await upload(owner, '/api/admin/voice/pack', pack, { 'content-type': 'application/x-tar' });
  check('included voice: pack upload keeps only <sha256>.mp3 clips that really are MP3s', up.status === 200 && up.data.upload.added === 2 && up.data.upload.samples === 1 && up.data.upload.bad === 1 && up.data.upload.skipped >= 1, up.data);
  check('included voice: nothing lands outside the voice folder', !fs.existsSync(path.join(VOICE, '..', 'b'.repeat(64) + '.mp3')) && fs.existsSync(path.join(VOICE, h0 + '.mp3')) && fs.existsSync(path.join(VOICE, 'samples', hs + '.mp3')) && !fs.existsSync(path.join(VOICE, 'c'.repeat(64) + '.mp3')));
  check('included voice: upload links the clips to their slides by itself', up.data.linked === 2);
  await waitRun();
  const after = (await owner.get(`/api/admin/voice/lessons/${L}`)).data.clips;
  const rd = after.filter((c) => c.state === 'ready');
  check('included voice: linked clips are ready with the included voice; the others are untouched', rd.length === 2 && rd.every((c) => /Included voice/.test(c.voice)) && [h0, h1].every((h) => after.some((c) => c.url === `/voice/${h}.mp3` && c.state === 'ready')) && after.filter((c) => c.state === 'error').length === 0);
  const ms0 = await fetch(BASE + '/api/admin/voice/pack/missing', { headers: { cookie: owner.cookie } });
  const missTxt = await ms0.text();
  const miss = missTxt.trim().split('\n').filter(Boolean).map((x) => JSON.parse(x));
  check('included voice: the missing-lines list is exact (in-pack lines left out, same names the server looks for)', ms0.status === 200 && /attachment/.test(ms0.headers.get('content-disposition')) && miss.length > 5 && !miss.some((x) => x.hash === h0 || x.hash === h1) && miss.every((x) => /^[a-f0-9]{64}$/.test(x.hash) && x.text) && !miss.some((x) => x.sample), miss.slice(0, 2));
  const mh = miss.find((x) => x.lesson_id === L);
  check('included voice: a listed line hashes to its own name', mh && hashIncluded(mh.text) === mh.hash);
  check('included voice: members cannot download the list', (await fetch(BASE + '/api/admin/voice/pack/missing', { headers: { cookie: mem.cookie } })).status === 403);
  const up2 = await upload(owner, '/api/admin/voice/pack', pack, { 'content-type': 'application/x-tar' });
  check('included voice: uploading the same pack again changes nothing', up2.status === 200 && up2.data.upload.added === 0 && up2.data.upload.existed === 3 && up2.data.linked === 0, up2.data);
  check('included voice: a file that is not a tar is refused', (await upload(owner, '/api/admin/voice/pack', Buffer.from('not a tar file at all '.repeat(40)), { 'content-type': 'application/x-tar' })).status === 400);
  check('included voice: a cut-off upload is refused', (await upload(owner, '/api/admin/voice/pack', pack.subarray(0, 700), { 'content-type': 'application/x-tar' })).status === 400);
  const smp = await fetch(BASE + '/api/admin/voice/sample', { method: 'POST', headers: { 'x-vs': '1', cookie: owner.cookie, 'content-type': 'application/json' }, body: '{}' });
  check('included voice: the voice-picker sample plays from the pack', smp.status === 200 && Buffer.from(await smp.arrayBuffer()).equals(TONE));
  check('included voice: other sample sentences are refused politely', (await owner.post('/api/admin/voice/sample', { text: 'Something else entirely.' })).status === 400);
  const e2 = (await owner.get(`/api/admin/voice/estimate?scope=lesson&id=${L}`)).data.estimate;
  check('included voice: lines not in the pack are counted, never queued (no errors)', e2.not_in_pack > 0 && e2.clips === 0, e2);
  const gen = await owner.post('/api/admin/voice/generate', { scope: 'clip', id: L, slot: after.find((c) => c.state !== 'ready' && c.text).slot });
  check('included voice: asking for a clip that is not in the pack says so (nothing queued)', gen.status === 200 && gen.data.queued === 0 && /not in the included voice pack/.test(gen.data.message), gen.data);

  // Regression (QA): "new take" / "regenerate everything" with the included voice must never turn ready clips into errors.
  const take = await owner.post('/api/admin/voice/generate', { scope: 'clip', id: L, slot: after.find((c) => c.state === 'ready').slot });
  const all = await owner.post('/api/admin/voice/generate', { scope: 'lesson', id: L, mode: 'all' });
  await waitRun();
  const afterTake = (await owner.get(`/api/admin/voice/lessons/${L}`)).data.clips;
  check('included voice: a new take or "regenerate all" relinks nothing and breaks nothing (no errors)', take.status === 200 && take.data.queued === 0 && /cannot make a new take/.test(take.data.message) && all.status === 200 && all.data.queued === 0 && afterTake.filter((c) => c.state === 'ready').length === 2 && !afterTake.some((c) => c.state === 'error'), { take: take.data, all: all.data });
  // Regression (QA): two uploads of the same pack at the same time both succeed and leave no temp files.
  const hz = '7'.repeat(64);
  const big = tar([{ name: `${hz}.mp3`, data: Buffer.concat(Array(200).fill(TONE)) }]);
  const slow = () => new ReadableStream({ async start(c) { for (let i = 0; i < big.length; i += 32768) { c.enqueue(big.subarray(i, i + 32768)); await sleep(1); } c.close(); } });
  const par = await Promise.all([0, 1].map(() => fetch(BASE + '/api/admin/voice/pack', { method: 'POST', headers: { 'x-vs': '1', cookie: owner.cookie, 'content-type': 'application/x-tar' }, body: slow(), duplex: 'half' }).then((r) => r.status)));
  check('included voice: the same pack uploaded twice at once works, no temp files left', par.every((x) => x === 200) && fs.existsSync(path.join(VOICE, hz + '.mp3')) && !fs.readdirSync(VOICE).some((f) => f.startsWith('.pack-')), par);
  // Header split across many small chunks, symlink entries ignored.
  const hy = '6'.repeat(64);
  const split = tar([{ name: `${hy}.mp3`, data: TONE, type: '2' }, { name: `pack/${hy}.mp3`, data: TONE }]);
  const tiny = new ReadableStream({ start(c) { for (let i = 0; i < split.length; i += 37) c.enqueue(split.subarray(i, i + 37)); c.close(); } });
  const sp = await fetch(BASE + '/api/admin/voice/pack', { method: 'POST', headers: { 'x-vs': '1', cookie: owner.cookie, 'content-type': 'application/x-tar' }, body: tiny, duplex: 'half' }).then(async (r) => ({ status: r.status, d: await r.json() }));
  check('included voice: a pack read in tiny chunks works; link entries are never kept', sp.status === 200 && sp.d.upload.added === 1 && fs.readFileSync(path.join(VOICE, hy + '.mp3')).equals(TONE), sp.d);
  fs.rmSync(path.join(VOICE, hz + '.mp3'), { force: true }); fs.rmSync(path.join(VOICE, hy + '.mp3'), { force: true });
  // Regression (QA): a team-edited sample sentence (from ElevenLabs/OpenAI days) must not hide the included voice's own sample.
  await owner.put('/api/admin/voice/settings', { sample: 'Our own preview sentence for the paid voices.' });
  const smp2 = await fetch(BASE + '/api/admin/voice/sample', { method: 'POST', headers: { 'x-vs': '1', cookie: owner.cookie, 'content-type': 'application/json' }, body: '{}' });
  check('included voice: its sample plays even after the team changed the sample sentence', smp2.status === 200 && (await owner.get('/api/admin/voice/pack')).data.pack.sample === true);
  await owner.put('/api/admin/voice/settings', { sample: sampleText });

  const memId = (await mem.get('/api/me')).data.user.id;
  await owner.post(`/api/admin/school/members/${memId}/grant`, { action: 'open_school', school_id: lab.id });
  await mem.post('/api/school/schools/lab/enroll');
  const lv = (await mem.get(`/api/school/lessons/${L}`));
  const v = lv.data.voice;
  const anyClip = v && [v.intro, ...v.steps].find(Boolean);
  const urls = v ? [v.intro, v.outro, ...v.steps].filter(Boolean).map((c) => c.url) : [];
  check('included voice: members get the pack clips in the lesson', lv.status === 200 && v && v.available && urls.includes(`/voice/${h0}.mp3`) && urls.includes(`/voice/${h1}.mp3`) && anyClip && (await raw(mem, `/voice/${h0}.mp3`)).status === 200, v);

  console.log('Included voice: two narrators');
  const vs = (await owner.get('/api/admin/voice')).data;
  check('included voice: two narrators offered (Michael and Grace)', vs.status.included_voices.length === 2 && vs.status.included_voices.some((v) => v.id === 'kokoro-af_heart-v1'));
  const hashWith = (v, t) => crypto.createHash('sha256').update(JSON.stringify(['v1', ['included', v], t])).digest('hex');
  const t0 = await said(clips[0].text);
  const mi0 = (await fetch(BASE + '/api/admin/voice/pack/missing', { headers: { cookie: owner.cookie } }).then((r) => r.text())).trim().split('\n').filter(Boolean).map((x) => JSON.parse(x));
  const vert = mi0.find((x) => /^v-/.test(x.school));
  check('included voice: vertical schools are read by Grace by default', !vert || vert.hash === hashWith('kokoro-af_heart-v1', vert.text), vert);
  check('included voice: a wrong narrator is refused', (await owner.put('/api/admin/voice/settings', { included: { voices: { lab: 'nobody' } } })).status === 400);
  const sw2 = await owner.put('/api/admin/voice/settings', { included: { voices: { lab: 'kokoro-af_heart-v1' } } });
  const afterSw = (await owner.get(`/api/admin/voice/lessons/${L}`)).data.clips.find((c) => c.text === clips[0].text);
  check('included voice: switching a school to Grace marks its Michael clips as an older voice (still playing)', sw2.status === 200 && sw2.data.settings.included.voices.lab === 'kokoro-af_heart-v1' && afterSw.state === 'stale');
  const mi1 = (await fetch(BASE + '/api/admin/voice/pack/missing', { headers: { cookie: owner.cookie } }).then((r) => r.text())).trim().split('\n').filter(Boolean).map((x) => JSON.parse(x));
  check('included voice: the missing list now asks for Grace on that school', mi1.some((x) => x.hash === hashWith('kokoro-af_heart-v1', t0)));
  await owner.put('/api/admin/voice/settings', { included: { voices: { lab: '' } } });
  check('included voice: back to the default narrator', (await owner.get(`/api/admin/voice/lessons/${L}`)).data.clips.find((c) => c.text === clips[0].text).state === 'ready');

  console.log('Included voice: intro music');
  check('intro music: on by default with the bundled track', v.music && v.music.url === '/assets/voo-school-intro.mp3' && v.music.volume === 0.5 && v.music.lead_ms === 3500 && v.music.fade_ms === 3000 && (await raw(null, '/assets/voo-school-intro.mp3')).status === 200);
  const ms = await owner.put('/api/admin/voice/settings', { music: { volume: 0.4, lead_ms: 99999, fade_ms: 2000 } });
  check('intro music: settings saved and kept in range', ms.status === 200 && ms.data.settings.music.volume === 0.4 && ms.data.settings.music.lead_ms === 15000 && ms.data.settings.music.fade_ms === 2000);
  const pv = await owner.put('/api/admin/voice/settings', { provider: 'included' });
  check('intro music: saving only the provider keeps the music settings', pv.status === 200 && pv.data.settings.music.volume === 0.4 && pv.data.settings.music.lead_ms === 15000 && pv.data.settings.music.enabled === true);
  check('intro music: members cannot upload music', (await upload(mem, '/api/admin/voice/music', TONE, { 'content-type': 'audio/mpeg' })).status === 403);
  check('intro music: a non-MP3 is refused', (await upload(owner, '/api/admin/voice/music', Buffer.from('<html>no</html>'), { 'content-type': 'audio/mpeg' })).status === 400);
  const LONG = Buffer.concat([TONE, TONE, TONE]);
  const mu = await upload(owner, '/api/admin/voice/music?name=Our%20jingle', LONG, { 'content-type': 'audio/mpeg' });
  check('intro music: an uploaded MP3 becomes the track', mu.status === 200 && /^\/voice-music\/[a-f0-9]{64}\.mp3$/.test(mu.data.player.url) && mu.data.music.name === 'Our jingle' && mu.data.music.enabled === true, mu.data);
  const mv = (await mem.get(`/api/school/lessons/${L}`)).data.voice.music;
  check('intro music: members get the uploaded track; it needs a login', mv.url === mu.data.player.url && mv.volume === 0.4 && (await raw(mem, mv.url)).status === 200 && (await raw(null, mv.url)).status === 401 && (await raw(mem, '/voice-music/' + 'd'.repeat(64) + '.mp3')).status === 404);
  const dflt = await owner.del('/api/admin/voice/music');
  check('intro music: back to the default track (the upload is deleted)', dflt.status === 200 && dflt.data.player.url === '/assets/voo-school-intro.mp3' && !fs.existsSync(path.join(VOICE, 'music', mu.data.player.url.split('/').pop())));
  await owner.put('/api/admin/voice/settings', { music: { enabled: false } });
  check('intro music: switched off, lessons carry no music', (await mem.get(`/api/school/lessons/${L}`)).data.voice.music === null);
  await owner.put('/api/admin/voice/settings', { music: { enabled: true, volume: 0.5, lead_ms: 3500, fade_ms: 3000 } });

  await owner.put('/api/admin/voice/settings', { provider: 'elevenlabs' });
  check('included voice: switching provider back works', (await owner.get('/api/admin/voice')).data.settings.provider === 'elevenlabs');
};
