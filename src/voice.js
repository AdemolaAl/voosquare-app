'use strict';
/*
 * Teaching voice: spoken narration for VooSquare Academy lessons (docs/VOICE_SETUP.md).
 *
 * Writers put the script in the content files: every slide gets "say", every lesson "say_intro" and "say_outro"
 * (src/school.js loads them). The team can override any line in Admin → VooSquare Academy → Teaching voice.
 *
 * Providers sit behind one small interface ({ synth(settings, text) → mp3 Buffer, voices() }):
 *  - ElevenLabs (default): POST /v1/text-to-speech/{voice_id}, key in ELEVENLABS_API_KEY
 *  - OpenAI: POST /v1/audio/speech, key in OPENAI_API_KEY
 * Requests only go to the provider's fixed host, through netguard (no redirects, timeouts, size cap).
 *
 * Clips are content-addressed: <voice dir>/<sha256(provider, voice settings, spoken text)>.mp3, so a line that did not
 * change is never sent twice, and the same sentence in two lessons is one file. Each clip's length is read from the MP3
 * frames. A clip plays for members only while its caption still matches the lesson's text, so captions never drift from
 * the audio; a clip made with an older voice keeps playing until it is generated again.
 *
 * Generation runs in this process: a queue with a small worker pool (default 2), retries with backoff on 429 and 5xx
 * (Retry-After honoured), and a run that stops early when the provider refuses the key or the quota is used up.
 * Clips are served from /voice/<file>.mp3 with Range support, and only to members who can open a lesson that uses them.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const D = require('./db');
const A = require('./auth');
const { now, fail, json, clean, limit } = require('./util');
const { guardedRequest } = require('./netguard');

const TEST = process.env.NODE_ENV === 'test';
const VOICE_DIR = process.env.VOICE_DIR || path.join(path.dirname(config.dbPath), 'voice');
const SAMPLE_DIR = path.join(VOICE_DIR, 'samples');
const MUSIC_DIR = path.join(VOICE_DIR, 'music');
fs.mkdirSync(SAMPLE_DIR, { recursive: true });
fs.mkdirSync(MUSIC_DIR, { recursive: true });
/* Intro music: one short track that opens every lesson when a member presses Listen, then fades out under the intro.
 * The default track ships with the app (public/assets/voo-school-intro.mp3); the team can upload their own. */
const DEFAULT_MUSIC_URL = '/assets/voo-school-intro.mp3';
const MUSIC_MAX = 8 * 1024 * 1024;
const BACKOFF_MS = Math.max(1, Number(process.env.VOICE_BACKOFF_MS) || 1500);
const MAX_ATTEMPTS = 5;
const MAX_TEXT = 4000;
const CHARS_PER_SEC = 15; // a calm teacher: about 150 words a minute

/* ------------------------------------------------------------------ schema */
D.db.exec(`
CREATE TABLE IF NOT EXISTS voice_clips(
  id INTEGER PRIMARY KEY, lesson_id INTEGER NOT NULL, slot TEXT NOT NULL, step_index INTEGER,
  text TEXT DEFAULT '', text_hash TEXT DEFAULT '', file TEXT DEFAULT '', bytes INTEGER DEFAULT 0, duration_ms INTEGER DEFAULT 0,
  chars INTEGER DEFAULT 0, status TEXT DEFAULT 'missing', error TEXT DEFAULT '', err_hash TEXT DEFAULT '', attempts INTEGER DEFAULT 0,
  provider TEXT DEFAULT '', voice TEXT DEFAULT '', generated_at INTEGER, updated_at INTEGER, UNIQUE(lesson_id, slot)
);
CREATE INDEX IF NOT EXISTS ix_voice_clips_file ON voice_clips(file);
CREATE INDEX IF NOT EXISTS ix_voice_clips_hash ON voice_clips(text_hash);
CREATE TABLE IF NOT EXISTS voice_edits(lesson_id INTEGER NOT NULL, slot TEXT NOT NULL, text TEXT DEFAULT '', by_id INTEGER, at INTEGER, PRIMARY KEY(lesson_id, slot));
CREATE TABLE IF NOT EXISTS voice_prefs(user_id INTEGER PRIMARY KEY, enabled INTEGER DEFAULT 1, auto INTEGER DEFAULT 1, captions INTEGER DEFAULT 1, speed REAL DEFAULT 1, updated_at INTEGER);
`);
/* A restart drops the in-memory queue: clips that were waiting go back to what they were. */
D.run("UPDATE voice_clips SET status=CASE WHEN file<>'' THEN 'ready' ELSE 'missing' END WHERE status IN ('queued','running')");

/* ------------------------------------------------------------------ settings */
const ELEVEN_MODELS = [
  ['eleven_multilingual_v2', 'Multilingual v2', 'The most natural teacher voice. 1 credit per character.'],
  ['eleven_flash_v2_5', 'Flash v2.5', 'Fast and about half the price. A little less expressive.'],
  ['eleven_turbo_v2_5', 'Turbo v2.5', 'About half the price, between Flash and Multilingual in quality.'],
];
const OUTPUTS = [
  ['mp3_44100_128', 'MP3 44.1 kHz, 128 kbps', 128, 'Best quality. About 1 MB per minute.'],
  ['mp3_44100_96', 'MP3 44.1 kHz, 96 kbps', 96, 'Near the best. About 0.7 MB per minute.'],
  ['mp3_44100_64', 'MP3 44.1 kHz, 64 kbps', 64, 'Good for speech. About 0.5 MB per minute.'],
  ['mp3_22050_32', 'MP3 22 kHz, 32 kbps', 32, 'Smallest files. Fine on phones, a little dull on headphones.'],
];
const OPENAI_MODELS = [['gpt-4o-mini-tts', 'gpt-4o-mini-tts', 'Follows a speaking-style instruction.'], ['tts-1-hd', 'tts-1-hd', 'Higher quality, no style instruction.'], ['tts-1', 'tts-1', 'Cheapest, no style instruction.']];
const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
/* The included voice: a narrator rendered ahead of time (outside the server) and shipped as a voice pack of MP3 files
 * named exactly like generated clips. It costs nothing per character. The server cannot make new lines with it: lines
 * that are not in the pack stay silent until a newer pack is uploaded (or the team switches to ElevenLabs or OpenAI). */
const INCLUDED = { id: 'kokoro-am_michael-v1', name: 'Narrator', about: 'American male, calm teacher', kbps: 48 };
/* Two included narrators. By default the vertical schools (track "vertical") are read by the female narrator and the
 * main path by the male one; the team can choose per school (settings.included.voices = { school_slug: voice id }). */
const INCLUDED_VOICES = [
  { id: 'kokoro-am_michael-v1', name: 'Michael', about: 'American male, calm teacher', labels: ['American', 'male', 'free'] },
  { id: 'kokoro-af_heart-v1', name: 'Grace', about: 'American female, warm and clear', labels: ['American', 'female', 'free'] },
];
const INCLUDED_IDS = INCLUDED_VOICES.map((v) => v.id);
let trackMemo = { at: 0, map: new Map() };
function schoolTrack(slug) {
  if (Date.now() - trackMemo.at > 30_000) { try { trackMemo = { at: Date.now(), map: new Map(D.all('SELECT slug, track FROM school_schools').map((r) => [r.slug, r.track])) }; } catch { /* tables not ready */ } }
  return trackMemo.map.get(slug) || '';
}
/** Which included narrator reads a school. */
function includedVoice(s, school) {
  const pick = s && s.included && s.included.voices && school ? s.included.voices[school] : '';
  if (pick && INCLUDED_IDS.includes(pick)) return pick;
  return school && schoolTrack(school) === 'vertical' ? INCLUDED_VOICES[1].id : INCLUDED_VOICES[0].id;
}
const PROVIDERS = {
  included: { name: 'Included voice', env: '', host: '', free: true },
  elevenlabs: { name: 'ElevenLabs', env: 'ELEVENLABS_API_KEY', host: 'https://api.elevenlabs.io' },
  openai: { name: 'OpenAI', env: 'OPENAI_API_KEY', host: 'https://api.openai.com' },
};
const DEFAULT_DICT = [
  ['VooSquare', 'voo square'], ['Joinvoo', 'join voo'], ['Replyvoo', 'reply voo'], ['Castvoo', 'cast voo'], ['Vooads', 'voo ads'],
  ['Gatevoo', 'gate voo'], ['Spyvoo', 'spy voo'], ['Landvoo', 'land voo'], ['Dchessking', 'D chess king'], ['Zedapex', 'zed apex'],
];
const DEFAULTS = {
  provider: 'elevenlabs', // see defaultProvider(): the free included voice unless an ElevenLabs or OpenAI key is set
  elevenlabs: { voice_id: '', voice_name: '', model_id: 'eleven_multilingual_v2', stability: 0.5, similarity: 0.75, style: 0, speaker_boost: true, speed: 1, output: 'mp3_44100_128' },
  openai: { model: 'gpt-4o-mini-tts', voice: 'sage', instructions: 'A warm, confident teacher explaining to one beginner. Calm pace, clear and friendly.', speed: 1 },
  included: { voice: INCLUDED.id, voices: {} },
  cost_per_1k: 0, // 0 = the provider's list price for the chosen model (see price())
  dictionary: DEFAULT_DICT,
  concurrency: 2,
  music: { enabled: true, file: '', name: '', volume: 0.5, lead_ms: 3500, fade_ms: 3000 },
  sample: 'Hi, welcome to VooSquare Academy. In this lesson you will learn how a media buyer turns ad spend into profit, one number at a time.',
};
/** Until the team picks a provider: ElevenLabs (or OpenAI) when its key is on the server, else the free included voice. */
const defaultProvider = () => (String(process.env.ELEVENLABS_API_KEY || '').trim() ? 'elevenlabs' : String(process.env.OPENAI_API_KEY || '').trim() ? 'openai' : 'included');
function settings() {
  const v = D.getSetting('voice', {}) || {};
  return {
    ...DEFAULTS, provider: defaultProvider(), ...v,
    elevenlabs: { ...DEFAULTS.elevenlabs, ...(v.elevenlabs || {}) },
    openai: { ...DEFAULTS.openai, ...(v.openai || {}) },
    included: { ...DEFAULTS.included, voices: { ...((v.included && v.included.voices) || {}) } },
    music: { ...DEFAULTS.music, ...(v.music || {}) },
    dictionary: Array.isArray(v.dictionary) ? v.dictionary : DEFAULTS.dictionary,
  };
}
const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 100) / 100)) : def; };
/** Validate a settings patch from the admin. Unknown keys are ignored. */
function cleanSettings(b, cur) {
  const out = { ...cur, elevenlabs: { ...cur.elevenlabs }, openai: { ...cur.openai }, included: { ...DEFAULTS.included, voices: { ...((cur.included && cur.included.voices) || {}) } } };
  const iv = b.included && b.included.voices;
  if (iv && typeof iv === 'object') {
    for (const [k, v] of Object.entries(iv).slice(0, 100)) {
      if (!/^[a-z0-9-]{1,60}$/.test(k)) continue;
      if (v === '' || v === null) delete out.included.voices[k];
      else if (INCLUDED_IDS.includes(v)) out.included.voices[k] = v;
      else fail(400, 'Choose one of the included narrators.');
    }
  }
  if (b.provider !== undefined) { if (!PROVIDERS[b.provider]) fail(400, 'Choose the included voice, ElevenLabs or OpenAI.'); out.provider = b.provider; }
  const e = b.elevenlabs;
  if (e && typeof e === 'object') {
    if (e.voice_id !== undefined) { const id = clean(e.voice_id, 64); if (id && !/^[A-Za-z0-9_-]{6,64}$/.test(id)) fail(400, 'A voice ID is letters and numbers, like 21m00Tcm4TlvDq8ikWAM. Copy it from ElevenLabs.'); out.elevenlabs.voice_id = id; }
    if (e.voice_name !== undefined) out.elevenlabs.voice_name = clean(e.voice_name, 80);
    if (e.model_id !== undefined) { if (!/^[a-z0-9_]{3,60}$/.test(String(e.model_id))) fail(400, 'Choose a model.'); out.elevenlabs.model_id = String(e.model_id); }
    if (e.stability !== undefined) out.elevenlabs.stability = num(e.stability, 0, 1, 0.5);
    if (e.similarity !== undefined) out.elevenlabs.similarity = num(e.similarity, 0, 1, 0.75);
    if (e.style !== undefined) out.elevenlabs.style = num(e.style, 0, 1, 0);
    if (e.speed !== undefined) out.elevenlabs.speed = num(e.speed, 0.7, 1.2, 1);
    if (e.speaker_boost !== undefined) out.elevenlabs.speaker_boost = !!e.speaker_boost;
    if (e.output !== undefined) { if (!OUTPUTS.some((o) => o[0] === e.output)) fail(400, 'Choose an audio format.'); out.elevenlabs.output = e.output; }
  }
  const o = b.openai;
  if (o && typeof o === 'object') {
    if (o.model !== undefined) { if (!OPENAI_MODELS.some((m) => m[0] === o.model)) fail(400, 'Choose an OpenAI model.'); out.openai.model = o.model; }
    if (o.voice !== undefined) { if (!OPENAI_VOICES.includes(o.voice)) fail(400, 'Choose an OpenAI voice.'); out.openai.voice = o.voice; }
    if (o.instructions !== undefined) out.openai.instructions = clean(o.instructions, 500);
    if (o.speed !== undefined) out.openai.speed = num(o.speed, 0.5, 2, 1);
  }
  const mu = b.music;
  if (mu && typeof mu === 'object') {
    out.music = { ...DEFAULTS.music, ...(cur.music || {}) };
    if (mu.enabled !== undefined) out.music.enabled = !!mu.enabled;
    if (mu.volume !== undefined) out.music.volume = num(mu.volume, 0.05, 1, 0.5);
    if (mu.lead_ms !== undefined) out.music.lead_ms = Math.round(num(mu.lead_ms, 0, 15000, 3500));
    if (mu.fade_ms !== undefined) out.music.fade_ms = Math.round(num(mu.fade_ms, 300, 10000, 3000));
  }
  if (b.cost_per_1k !== undefined) out.cost_per_1k = num(b.cost_per_1k, 0, 100, 0);
  if (b.concurrency !== undefined) out.concurrency = Math.round(num(b.concurrency, 1, 4, 2));
  if (b.sample !== undefined) out.sample = clean(b.sample, 300) || DEFAULTS.sample;
  if (b.dictionary !== undefined) {
    if (!Array.isArray(b.dictionary)) fail(400, 'The pronunciation list must be a list.');
    const seen = new Set();
    out.dictionary = b.dictionary.map((r) => (Array.isArray(r) ? r : [r && r.from, r && r.to]).map((x) => clean(x, 80)))
      .filter(([f, t]) => f && t && !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase())).slice(0, 200);
  }
  return out;
}
const keyFor = (p) => (p === 'included' ? 'included' : String(process.env[PROVIDERS[p].env] || '').trim());
/** The provider's fixed host. Tests (NODE_ENV=test) may point both providers at a local mock with VOICE_API_BASE. */
const baseFor = (p) => (TEST && process.env.VOICE_API_BASE ? process.env.VOICE_API_BASE.replace(/\/+$/, '') : PROVIDERS[p].host);
/** Price per 1,000 characters in USD: the team's number, or the list price for the model (approximate). */
function price(s = settings()) {
  if (s.provider === 'included') return 0;
  if (s.cost_per_1k > 0) return s.cost_per_1k;
  if (s.provider === 'openai') return s.openai.model === 'tts-1-hd' ? 0.03 : 0.015;
  return /flash|turbo/.test(s.elevenlabs.model_id) ? 0.05 : 0.10;
}
const kbps = (s = settings()) => (s.provider === 'included' ? INCLUDED.kbps : s.provider === 'openai' ? 64 : (OUTPUTS.find((o) => o[0] === s.elevenlabs.output) || OUTPUTS[0])[2]);
/** Why generation cannot run right now ('' when it can). */
function problem(s = settings()) {
  if (s.provider === 'included') return '';
  if (!keyFor(s.provider)) return `Add ${PROVIDERS[s.provider].env} to the server's variables (Railway → Variables), then redeploy.`;
  if (s.provider === 'elevenlabs' && !s.elevenlabs.voice_id) return 'Pick a voice first.';
  return '';
}
/** What makes two clips sound the same: the provider and every voice setting. */
function renderKey(s, school) {
  if (s.provider === 'included') return ['included', includedVoice(s, school)];
  if (s.provider === 'openai') { const o = s.openai; return ['openai', o.model, o.voice, o.model === 'gpt-4o-mini-tts' ? o.instructions : '', o.speed]; }
  const e = s.elevenlabs;
  return ['elevenlabs', e.voice_id, e.model_id, e.stability, e.similarity, e.style, !!e.speaker_boost, e.speed, e.output];
}
const voiceLabel = (s, school) => (s.provider === 'included' ? `Included voice (${(INCLUDED_VOICES.find((v) => v.id === includedVoice(s, school)) || INCLUDED_VOICES[0]).name})` : s.provider === 'openai' ? `OpenAI ${s.openai.voice}` : `ElevenLabs ${s.elevenlabs.voice_name || s.elevenlabs.voice_id}`);
const hashFor = (s, spoken, school) => crypto.createHash('sha256').update(JSON.stringify(['v1', renderKey(s, school), spoken])).digest('hex');

/* ------------------------------------------------------------------ pronunciation */
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Apply the pronunciation list: whole words, any case, longest first, each part replaced once. */
let dictMemo = { key: null, re: null, map: null };
function spoken(text, dict = settings().dictionary) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const key = JSON.stringify(dict || []);
  if (dictMemo.key !== key) {
    const pairs = (dict || []).filter((r) => r && r[0] && r[1]).sort((a, b) => b[0].length - a[0].length);
    dictMemo = { key, map: new Map(pairs.map(([f, to]) => [f.toLowerCase(), to])), re: pairs.length ? new RegExp(`(?<![\\p{L}\\p{N}])(${pairs.map(([f]) => reEsc(f)).join('|')})(?![\\p{L}\\p{N}])`, 'giu') : null };
  }
  if (!dictMemo.re || !t) return t;
  const { map } = dictMemo;
  return t.replace(dictMemo.re, (m) => map.get(m.toLowerCase()) ?? m);
}

/* ------------------------------------------------------------------ MP3 length */
const BR = {
  V1L1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], V1L2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  V1L3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], V2L1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  V2L23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function frameAt(b, i) {
  if (i + 4 > b.length || b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return null;
  const ver = (b[i + 1] >> 3) & 3; const layer = (b[i + 1] >> 1) & 3; const bri = b[i + 2] >> 4; const sri = (b[i + 2] >> 2) & 3;
  if (ver === 1 || layer === 0 || bri === 0 || bri === 15 || sri === 3) return null;
  const v1 = ver === 3; const L = 4 - layer; const pad = (b[i + 2] >> 1) & 1;
  const br = (v1 ? [null, BR.V1L1, BR.V1L2, BR.V1L3][L] : (L === 1 ? BR.V2L1 : BR.V2L23))[bri] * 1000;
  const sr = SR[ver][sri];
  if (L === 1) return { len: (Math.floor(12 * br / sr) + pad) * 4, samples: 384, sr, v1, mono: (b[i + 3] >> 6) === 3 };
  return { len: Math.floor((L === 3 && !v1 ? 72 : 144) * br / sr) + pad, samples: L === 3 && !v1 ? 576 : 1152, sr, v1, mono: (b[i + 3] >> 6) === 3 };
}
/** Length of an MP3 in milliseconds, from its frames (Xing/Info frame count when present). 0 = not an MP3. */
function mp3Duration(b) {
  if (!Buffer.isBuffer(b) || b.length < 4) return 0;
  let i = 0;
  if (b.length > 10 && b.toString('latin1', 0, 3) === 'ID3') i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f)) + ((b[5] & 0x10) ? 10 : 0);
  let first = null;
  for (const end = Math.min(b.length, i + 65536); i < end; i++) {
    const f = frameAt(b, i);
    if (f && f.len > 4 && (i + f.len === b.length || frameAt(b, i + f.len))) { first = f; break; }
  }
  if (!first) return 0;
  const xo = i + 4 + (first.v1 ? (first.mono ? 17 : 32) : (first.mono ? 9 : 17));
  const tag = b.toString('latin1', xo, xo + 4);
  if ((tag === 'Xing' || tag === 'Info') && xo + 12 <= b.length && (b.readUInt32BE(xo + 4) & 1)) return Math.round(b.readUInt32BE(xo + 8) * first.samples / first.sr * 1000);
  let ms = 0;
  while (i < b.length) {
    const f = frameAt(b, i);
    if (!f || f.len < 5) { if (b.toString('latin1', i, i + 3) === 'TAG') break; i++; continue; }
    ms += f.samples / f.sr * 1000; i += f.len;
  }
  return Math.round(ms);
}

/* ------------------------------------------------------------------ providers */
class VoiceError extends Error { constructor(msg, o = {}) { super(msg); this.status = o.status || 0; this.fatal = !!o.fatal; this.retry = !!o.retry; this.after = o.after || 0; } }
/** A short, safe message from a provider's error body (never headers, never the key). */
function providerMessage(r) {
  let d = null;
  try { d = JSON.parse(r.body.toString('utf8')); } catch { /* not JSON */ }
  const m = d && ((d.detail && (d.detail.message || (Array.isArray(d.detail) && d.detail[0] && d.detail[0].msg) || (typeof d.detail === 'string' && d.detail))) || (d.error && (d.error.message || d.error)) || d.message);
  const code = d && d.detail && d.detail.status;
  return { text: String(m || `HTTP ${r.status}`).replace(/\s+/g, ' ').slice(0, 220), code: String(code || '') };
}
async function call(p, pathname, opts) {
  const key = keyFor(p);
  if (!key) throw new VoiceError(`${PROVIDERS[p].env} is not set on the server.`, { fatal: true });
  const headers = p === 'openai' ? { Authorization: 'Bearer ' + key } : { 'xi-api-key': key };
  let r;
  try {
    r = await guardedRequest(baseFor(p) + pathname, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  } catch (e) { throw new VoiceError(e.message || 'Could not reach the voice provider.', { retry: true }); }
  if (r.ok) return r;
  const m = providerMessage(r);
  const fatal = r.status === 401 || r.status === 403 || /quota|credits|limit_reached|payment/i.test(m.code + ' ' + m.text) && r.status !== 429;
  const ra = Number(r.headers && r.headers['retry-after']);
  throw new VoiceError(`${PROVIDERS[p].name} said: ${m.text}`, { status: r.status, fatal, retry: !fatal && (r.status === 429 || r.status >= 500), after: Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : 0 });
}
const NOT_IN_PACK = 'This line is not in the included voice pack yet. Upload the newest voice pack (Teaching voice → Included voice pack), or use ElevenLabs or OpenAI for new lines.';
const ADAPTERS = {
  included: {
    async synth() { throw new VoiceError(NOT_IN_PACK); },
    async voices() { return INCLUDED_VOICES.map((v) => ({ id: v.id, name: v.name, category: 'included', labels: v.labels, description: v.about })); },
  },
  elevenlabs: {
    async synth(s, text) {
      const e = s.elevenlabs;
      const r = await call('elevenlabs', `/v1/text-to-speech/${encodeURIComponent(e.voice_id)}?output_format=${encodeURIComponent(e.output)}`, {
        method: 'POST', accept: 'audio/mpeg', timeoutMs: 120_000, maxBytes: 25 * 1024 * 1024, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: e.model_id, voice_settings: { stability: e.stability, similarity_boost: e.similarity, style: e.style, use_speaker_boost: !!e.speaker_boost, speed: e.speed } }),
      });
      return r.body;
    },
    async voices() {
      const r = await call('elevenlabs', '/v1/voices', { timeoutMs: 20_000, maxBytes: 4 * 1024 * 1024 });
      let d; try { d = JSON.parse(r.body.toString('utf8')); } catch { throw new VoiceError('ElevenLabs sent a voice list we could not read.'); }
      return (Array.isArray(d && d.voices) ? d.voices : []).map((v) => ({
        id: String(v.voice_id || ''), name: clean(v.name, 80), category: clean(v.category, 30),
        labels: Object.values(v.labels && typeof v.labels === 'object' ? v.labels : {}).map((x) => clean(x, 30)).filter(Boolean).slice(0, 5),
        description: clean(v.description, 200),
      })).filter((v) => /^[A-Za-z0-9_-]{6,64}$/.test(v.id)).sort((a, b) => (a.category === 'cloned' ? -1 : 0) - (b.category === 'cloned' ? -1 : 0) || a.name.localeCompare(b.name));
    },
  },
  openai: {
    async synth(s, text) {
      const o = s.openai;
      const body = { model: o.model, voice: o.voice, input: text, response_format: 'mp3', speed: o.speed };
      if (o.model === 'gpt-4o-mini-tts' && o.instructions) body.instructions = o.instructions;
      const r = await call('openai', '/v1/audio/speech', { method: 'POST', accept: 'audio/mpeg', timeoutMs: 120_000, maxBytes: 25 * 1024 * 1024, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return r.body;
    },
    async voices() { return OPENAI_VOICES.map((v) => ({ id: v, name: v[0].toUpperCase() + v.slice(1), category: 'built-in', labels: [], description: '' })); },
  },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Text → MP3 with retries (429, 5xx and network errors; exponential backoff or the provider's Retry-After). */
async function synthesize(s, text, onRetry) {
  let wait = BACKOFF_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      const audio = await ADAPTERS[s.provider].synth(s, text);
      const ms = mp3Duration(audio);
      if (!ms) throw new VoiceError(`${PROVIDERS[s.provider].name} sent audio that is not an MP3.`, { retry: true });
      return { audio, ms, attempts: attempt };
    } catch (e) {
      if (!(e instanceof VoiceError) || !e.retry || attempt >= MAX_ATTEMPTS) { if (e instanceof VoiceError) e.attempts = attempt; throw e; }
      if (onRetry) onRetry(attempt, e);
      await sleep(e.after || wait);
      wait *= 2;
    }
  }
}

/* ------------------------------------------------------------------ lesson narration */
/**
 * Every narration slot of a lesson: intro, each slide (s0, s1…), outro, with the text that is spoken now.
 * Slide text: the team's override, else the slide's own "say", else the file's narration for that slide when the slide
 * still has the same type and heading (lessons edited in the admin keep getting narration added to their file).
 */
function slotsFor(l, edits) {
  const steps = json(l.steps, []);
  const src = json(l.say_src, []);
  const ed = edits || new Map(D.all('SELECT slot, text FROM voice_edits WHERE lesson_id=?', l.id).map((r) => [r.slot, r.text]));
  const sayOf = (v) => (typeof v === 'string' ? v.trim().slice(0, MAX_TEXT) : '');
  const out = [{ slot: 'intro', step_index: null, label: 'Intro', v: 'intro', h: l.title, file_text: l.say_intro || '' }];
  steps.forEach((st, i) => {
    const f = src[i] && src[i].v === st.v && String(src[i].h || '') === String(st.h || '').slice(0, 200) ? src[i].say : '';
    out.push({ slot: 's' + i, step_index: i, label: `Slide ${i + 1}`, v: st.v, h: st.h || '', file_text: sayOf(st.say) || f || '' });
  });
  out.push({ slot: 'outro', step_index: null, label: 'Outro', v: 'outro', h: 'Recap', file_text: l.say_outro || '' });
  for (const x of out) { x.edited = ed.has(x.slot); x.text = x.edited ? ed.get(x.slot) : x.file_text; }
  return out;
}
const clipRows = (lessonId) => new Map(D.all('SELECT * FROM voice_clips WHERE lesson_id=?', lessonId).map((r) => [r.slot, r]));
const fileOk = (f) => !!f && /^[a-f0-9]{64}(-[a-z0-9]{1,12})?\.mp3$/.test(f) && fs.existsSync(path.join(VOICE_DIR, f));
/** A slot's state for the admin: none | ready | stale (older voice) | changed (text edited) | missing | queued | running | error. */
function slotState(x, row, s, hashNow, school) {
  if (row && (row.status === 'queued' || row.status === 'running')) return row.status;
  if (!x.text) return 'none';
  const h = hashNow || hashFor(s, spoken(x.text, s.dictionary), school);
  if (row && row.status === 'error' && row.err_hash === h) return 'error';
  if (row && row.file && row.text_hash === h && fileOk(row.file)) return 'ready';
  if (row && row.file && row.text === x.text && fileOk(row.file)) return 'stale';
  if (row && row.file) return 'changed';
  return 'missing';
}

/* ------------------------------------------------------------------ member side */
const PREF_DEFAULTS = { enabled: true, auto: true, captions: true, speed: 1 };
const SPEEDS = [0.75, 1, 1.25, 1.5];
function prefsFor(uid) {
  const r = uid ? D.get('SELECT * FROM voice_prefs WHERE user_id=?', uid) : null;
  return r ? { enabled: !!r.enabled, auto: !!r.auto, captions: !!r.captions, speed: SPEEDS.includes(r.speed) ? r.speed : 1 } : { ...PREF_DEFAULTS };
}
const features = () => require('./features');
const voiceOn = () => features().on('academy') && features().on('voice');
/**
 * What the lesson player gets: one clip per slide shown (null where there is none), plus intro and outro. A clip is
 * offered only while its caption is still the lesson's text. Returns null when the voice is switched off; available is
 * false when the lesson has no clips yet (the player then hides its controls).
 */
function forMember(l, rawSteps, shownSteps, u) {
  if (!voiceOn()) return null;
  const rows = clipRows(l.id);
  const slots = slotsFor(l);
  const by = new Map(slots.map((x) => [x.slot, x]));
  const clip = (slot) => {
    const x = by.get(slot); const r = rows.get(slot);
    if (!x || !x.text || !r || !r.file || r.text !== x.text || !fileOk(r.file)) return null;
    return { url: '/voice/' + r.file, ms: r.duration_ms, text: x.text };
  };
  const steps = shownSteps.map((st) => { const i = rawSteps.indexOf(st); return i >= 0 ? clip('s' + i) : null; });
  const intro = clip('intro'); const outro = clip('outro');
  const count = steps.filter(Boolean).length + (intro ? 1 : 0) + (outro ? 1 : 0);
  return { available: count > 0, count, ms: [intro, outro, ...steps].reduce((a, c) => a + (c ? c.ms : 0), 0), prefs: prefsFor(u && u.id), intro, outro, steps, music: musicFor() };
}

/** The intro music the player gets (null when switched off). */
function musicFor(s = settings()) {
  const m = s.music || DEFAULTS.music;
  if (!m.enabled) return null;
  const custom = m.file && /^[a-f0-9]{64}\.mp3$/.test(m.file) && fs.existsSync(path.join(MUSIC_DIR, m.file));
  return { url: custom ? '/voice-music/' + m.file : DEFAULT_MUSIC_URL, custom: !!custom, volume: m.volume, lead_ms: m.lead_ms, fade_ms: m.fade_ms };
}

/* Who may hear a clip: the team, or a member who can open a lesson that uses it. Cached for a minute per member and file,
 * so seeking (many Range requests) does not recompute the school state each time. */
const access = new Map();
function canHear(u, file) {
  if (A.can(u, 'academy')) return true;
  const k = u.id + ':' + file;
  const c = access.get(k);
  if (c && c.at > now() - 60_000) return c.ok;
  const lessons = D.all('SELECT DISTINCT lesson_id FROM voice_clips WHERE file=?', file).map((r) => r.lesson_id);
  let ok = false;
  if (lessons.length) {
    const school = require('./school');
    const state = school.stateFor(u, now());
    ok = lessons.some((id) => { const f = school.findLesson(state, id); return f && f.l.status !== 'locked' && ['open', 'passed'].includes(f.m.status); });
  }
  if (access.size > 5000) access.clear();
  access.set(k, { ok, at: now() });
  return ok;
}
/** A clip used by one of the public preview lessons (school.previewLessonIds), so a visitor may hear it. */
function previewHears(file) {
  const ids = require('./school').previewLessonIds();
  if (!ids.size) return false;
  return D.all('SELECT DISTINCT lesson_id FROM voice_clips WHERE file=?', file).some((r) => ids.has(r.lesson_id));
}
/** Who reads a school with the included voice ("Michael", "Grace"), or '' with ElevenLabs or OpenAI. */
function narratorName(school) {
  const s = settings();
  if (s.provider !== 'included') return '';
  const id = includedVoice(s, school);
  return (INCLUDED_VOICES.find((v) => v.id === id) || {}).name || '';
}
/** Send an MP3 with Range support (seeking) and a long private cache: file names change whenever the audio does. */
function sendAudio(ctx, file) {
  const fp = path.join(VOICE_DIR, file);
  let st;
  try { st = fs.statSync(fp); } catch { fail(404, 'This clip is not there any more.'); }
  const { req, res } = ctx;
  ctx.handled = true;
  const etag = `"${file.replace(/\.mp3$/, '')}"`;
  const base = { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=31536000, immutable', ETag: etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end(); }
  const size = st.size;
  let start = 0; let end = size - 1; let partial = false;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!m || (!m[1] && !m[2])) { res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` }); return res.end(); }
    if (m[1]) { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; } else { start = Math.max(0, size - Number(m[2])); }
    if (start >= size || start > end) { res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` }); return res.end(); }
    partial = true;
  }
  res.writeHead(partial ? 206 : 200, { ...base, 'Content-Length': end - start + 1, ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  const rs = fs.createReadStream(fp, { start, end });
  rs.on('error', () => res.destroy());
  rs.pipe(res);
}

/* ------------------------------------------------------------------ the queue */
const Q = { tasks: [], active: 0, run: null, seq: 0 };
function runPublic() {
  const r = Q.run;
  if (!r) return null;
  return { id: r.id, label: r.label, state: r.state, total: r.total, done: r.done, made: r.made, reused: r.reused, failed: r.failed, chars: r.chars, cost: Math.round(r.chars / 1000 * r.price * 100) / 100, started_at: r.started_at, finished_at: r.finished_at, current: [...r.current.values()], errors: r.errors.slice(-20), stop_reason: r.stop_reason, retries: r.retries, queued: Q.tasks.length };
}
function upsertRow(lessonId, x, patch) {
  D.run(`INSERT INTO voice_clips(lesson_id, slot, step_index, status, updated_at) VALUES(?,?,?,?,?) ON CONFLICT(lesson_id, slot) DO NOTHING`, lessonId, x.slot, x.step_index, 'missing', now());
  const keys = Object.keys(patch);
  D.run(`UPDATE voice_clips SET ${keys.map((k) => k + '=?').join(', ')}, updated_at=? WHERE lesson_id=? AND slot=?`, ...keys.map((k) => patch[k]), now(), lessonId, x.slot);
}
const resetQueued = () => D.run("UPDATE voice_clips SET status=CASE WHEN file<>'' THEN 'ready' ELSE 'missing' END WHERE status='queued'");
/** Delete an audio file nothing points to any more. */
function dropIfUnused(file) {
  if (!file || D.get('SELECT 1 FROM voice_clips WHERE file=?', file)) return;
  try { fs.unlinkSync(path.join(VOICE_DIR, file)); } catch { /* already gone */ }
}

/** Queue clips: [{ lesson_id, slot, step_index, text, force, title }]. Joins the run in progress, or starts one. */
function enqueue(items, label) {
  const s = settings();
  if (!Q.run || Q.run.state !== 'running') Q.run = { id: ++Q.seq, label, state: 'running', total: 0, done: 0, made: 0, reused: 0, failed: 0, chars: 0, price: price(s), started_at: now(), finished_at: 0, current: new Map(), errors: [], stop_reason: '', retries: 0 };
  else if (label && !Q.run.label.includes(label)) Q.run.label = `${Q.run.label} + ${label}`.slice(0, 160);
  const pending = new Set(Q.tasks.map((t) => t.lesson_id + '/' + t.slot));
  let n = 0;
  for (const t of items) {
    const k = t.lesson_id + '/' + t.slot;
    if (pending.has(k) || Q.run.current.has(k)) continue;
    pending.add(k); Q.tasks.push(t); n++;
    upsertRow(t.lesson_id, t, { status: 'queued' });
  }
  Q.run.total += n;
  pump();
  return n;
}
function pump() {
  const r = Q.run;
  const max = settings().concurrency || 2;
  while (r && r.state === 'running' && Q.active < max && Q.tasks.length) {
    const t = Q.tasks.shift();
    Q.active++;
    work(t, r).catch((e) => console.error('[voice]', e)).finally(() => { Q.active--; finishIfIdle(r); pump(); });
  }
  if (r) finishIfIdle(r);
}
function finishIfIdle(r) {
  if (r.state === 'running' && !Q.tasks.length && !Q.active) { r.state = 'done'; r.finished_at = now(); }
  if (r.state === 'stopping' && !Q.active) { r.state = 'stopped'; r.finished_at = now(); }
}
function stopRun(reason) {
  const r = Q.run;
  if (!r || r.state !== 'running') return false;
  Q.tasks = [];
  resetQueued();
  r.stop_reason = reason;
  r.state = Q.active ? 'stopping' : 'stopped';
  if (r.state === 'stopped') r.finished_at = now();
  return true;
}
async function work(t, r) {
  const s = settings();
  const text = spoken(t.text, s.dictionary);
  const school = t.school || (D.get('SELECT s.slug FROM school_lessons l JOIN school_modules m ON m.id=l.module_id JOIN school_schools s ON s.id=m.school_id WHERE l.id=?', t.lesson_id) || {}).slug || '';
  const hash = hashFor(s, text, school);
  const k = t.lesson_id + '/' + t.slot;
  r.current.set(k, { lesson_id: t.lesson_id, slot: t.slot, title: t.title || '' });
  upsertRow(t.lesson_id, t, { status: 'running' });
  const prev = D.get('SELECT file FROM voice_clips WHERE lesson_id=? AND slot=?', t.lesson_id, t.slot);
  try {
    if (!text) throw new VoiceError('There is no text to read.');
    if (text.length > MAX_TEXT) throw new VoiceError(`This line is ${text.length} characters. Keep it under ${MAX_TEXT}.`);
    let file = hash + '.mp3';
    let audio = null; let ms = 0; let attempts = 0;
    if (!t.force && fileOk(file)) {
      // Same voice, same words: the file already exists (this slide before, or another lesson). Nothing is sent.
      const known = D.get('SELECT duration_ms, bytes FROM voice_clips WHERE file=? AND duration_ms>0', file);
      ms = known ? known.duration_ms : mp3Duration(fs.readFileSync(path.join(VOICE_DIR, file)));
      r.reused++;
    } else {
      const out = await synthesize(s, text, () => { r.retries++; });
      audio = out.audio; ms = out.ms; attempts = out.attempts;
      if (fileOk(file)) file = `${hash}-${Date.now().toString(36)}.mp3`; // a new take of the same line gets its own name (caches)
      const tmp = path.join(VOICE_DIR, `.${file}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, audio);
      fs.renameSync(tmp, path.join(VOICE_DIR, file));
      r.chars += text.length; r.made++;
    }
    const bytes = audio ? audio.length : (fs.statSync(path.join(VOICE_DIR, file)).size);
    upsertRow(t.lesson_id, t, { text: t.text, text_hash: hash, file, bytes, duration_ms: ms, chars: text.length, status: 'ready', error: '', err_hash: '', attempts, provider: s.provider, voice: voiceLabel(s, school), generated_at: now() });
    if (prev && prev.file !== file) dropIfUnused(prev.file);
  } catch (e) {
    const msg = String((e && e.message) || 'Generation failed.').slice(0, 300);
    upsertRow(t.lesson_id, t, { status: 'error', error: msg, err_hash: hash, attempts: (e && e.attempts) || 1 });
    r.failed++;
    r.errors.push({ lesson_id: t.lesson_id, slot: t.slot, title: t.title || '', error: msg });
    if (e && e.fatal) stopRun(msg);
  } finally {
    r.current.delete(k);
    r.done++;
  }
}

/* ------------------------------------------------------------------ scopes, estimates */
/** Lessons in a scope: lesson | module | school | all (published lessons in published modules). */
function lessonsIn(scope, id) {
  const base = 'SELECT l.*, m.title module_title, m.sort module_sort, s.slug school_slug, s.title school_title, s.sort school_sort FROM school_lessons l JOIN school_modules m ON m.id=l.module_id JOIN school_schools s ON s.id=m.school_id';
  const order = ' ORDER BY s.sort, s.id, m.sort, m.id, l.idx, l.id';
  if (scope === 'lesson' || scope === 'clip') return D.all(`${base} WHERE l.id=?`, Number(id));
  if (scope === 'module') return D.all(`${base} WHERE m.id=? AND l.published=1${order}`, Number(id));
  if (scope === 'school') return D.all(`${base} WHERE (s.slug=? OR s.id=?) AND l.published=1 AND m.published=1${order}`, String(id), Number(id) || -1);
  if (scope === 'all') return D.all(`${base} WHERE l.published=1 AND m.published=1${order}`);
  fail(400, 'Choose what to generate: one lesson, a module, a school or everything.');
}
/**
 * The work for a scope. mode 'missing' = clips that are missing, changed, made with an older voice or failed;
 * mode 'all' = every line again (new takes). Lines whose audio already exists for the current voice are reused for free.
 */
function plan(scope, id, mode, slot) {
  const s = settings();
  const lessons = lessonsIn(scope, id);
  if (!lessons.length) fail(404, 'Nothing found to generate.');
  const tasks = []; let chars = 0; let reuse = 0; let skipped = 0; let empty = 0; let notInPack = 0;
  const inc = s.provider === 'included';
  const willMake = new Set();
  for (const l of lessons) {
    const rows = clipRows(l.id);
    for (const x of slotsFor(l)) {
      if (slot && x.slot !== slot) continue;
      if (!x.text) { empty++; continue; }
      const text = spoken(x.text, s.dictionary);
      const h = hashFor(s, text, l.school_slug);
      const st = slotState(x, rows.get(x.slot), s, h);
      // The included voice cannot make a new take: "again" just relinks the clip from the pack (never an error).
      const force = mode === 'all' && !inc;
      if (!force && (st === 'ready' || st === 'queued' || st === 'running')) { skipped++; continue; }
      // The included voice cannot make new audio: only lines whose clip is in an uploaded voice pack are work.
      if (inc && !fileOk(h + '.mp3')) { notInPack++; continue; }
      const cached = !force && (fileOk(h + '.mp3') || willMake.has(h));
      if (cached) reuse++; else { chars += text.length; willMake.add(h); }
      tasks.push({ lesson_id: l.id, slot: x.slot, step_index: x.step_index, text: x.text, force, title: l.title, school: l.school_slug });
    }
  }
  const p = price(s);
  const secs = Math.round(chars / CHARS_PER_SEC);
  return {
    tasks,
    estimate: { not_in_pack: notInPack, lessons: lessons.length, clips: tasks.length, new_clips: tasks.length - reuse, reused: reuse, up_to_date: skipped, no_text: empty, chars, price_per_1k: p, cost_usd: Math.round(chars / 1000 * p * 100) / 100, audio_secs: secs, bytes: Math.round(secs * kbps(s) * 1000 / 8), provider: s.provider, voice: voiceLabel(s) },
  };
}

/* ------------------------------------------------------------------ admin views */
function clipPublic(x, row, s, school) {
  const state = slotState(x, row, s, undefined, school);
  return {
    slot: x.slot, step_index: x.step_index, label: x.label, v: x.v, h: x.h, text: x.text, file_text: x.file_text, edited: x.edited,
    state, chars: spoken(x.text, s.dictionary).length, url: row && row.file && fileOk(row.file) ? '/voice/' + row.file : '', heard_text: row ? row.text : '',
    duration_ms: row ? row.duration_ms : 0, bytes: row ? row.bytes : 0, error: row && state === 'error' ? row.error : '', generated_at: row ? row.generated_at || 0 : 0, voice: row ? row.voice : '',
  };
}
function lessonSummary(l, s) {
  const rows = clipRows(l.id);
  const c = { none: 0, ready: 0, stale: 0, changed: 0, missing: 0, queued: 0, running: 0, error: 0 };
  let ms = 0; let edited = 0;
  const slots = slotsFor(l);
  for (const x of slots) { const st = slotState(x, rows.get(x.slot), s, undefined, l.school_slug); c[st]++; if (x.edited) edited++; const r = rows.get(x.slot); if (st === 'ready' || st === 'stale') ms += r.duration_ms; }
  return { id: l.id, title: l.title, module_id: l.module_id, module: l.module_title, module_sort: l.module_sort, school: l.school_slug, school_title: l.school_title, idx: l.idx, slots: slots.length, with_text: slots.length - c.none, counts: c, edited, duration_ms: ms };
}
function totals(s) {
  const all = lessonsIn('all');
  let slots = 0; let withText = 0; let ready = 0; let lessonsWithText = 0; let chars = 0;
  const bySchool = {};
  for (const l of all) {
    const rows = clipRows(l.id);
    const sc = bySchool[l.school_slug] || (bySchool[l.school_slug] = { lines: 0, ready: 0 });
    let lt = 0;
    for (const x of slotsFor(l)) {
      slots++;
      if (!x.text) continue;
      withText++; lt++; chars += x.text.length; sc.lines++;
      if (slotState(x, rows.get(x.slot), s, undefined, l.school_slug) === 'ready') { ready++; sc.ready++; }
    }
    if (lt) lessonsWithText++;
  }
  const f = D.get("SELECT COUNT(DISTINCT file) n, COALESCE(SUM(duration_ms),0) ms FROM voice_clips WHERE file<>''");
  let bytes = 0;
  try { for (const n of fs.readdirSync(VOICE_DIR)) if (n.endsWith('.mp3')) bytes += fs.statSync(path.join(VOICE_DIR, n)).size; } catch { /* empty */ }
  const secs = Math.round(chars / CHARS_PER_SEC);
  return { by_school: bySchool, lessons: all.length, lessons_with_text: lessonsWithText, slots, with_text: withText, ready, files: f.n, audio_ms: f.ms, bytes, script_chars: chars, full_cost_usd: Math.round(chars / 1000 * price(s) * 100) / 100, full_bytes: Math.round(secs * kbps(s) * 1000 / 8), full_secs: secs };
}

/* ------------------------------------------------------------------ included voice pack */
/*
 * A voice pack is a plain .tar file of MP3s named <sha256>.mp3 (clips) and samples/<sha256>.mp3 (the voice-picker
 * sample), made by tools/voice-pack (docs/VOICE_SETUP.md). Upload reads the tar as it streams in: only files with those
 * exact names are kept (each must really be an MP3), everything else is skipped, existing files are left alone, and
 * nothing is ever extracted outside the voice folder. Uploading a pack twice is harmless.
 */
const PACK_MAX_FILE = 12 * 1024 * 1024;
const PACK_MAX_TOTAL = 4 * 1024 * 1024 * 1024;
const PACK_NAME = /^(?:\.\/)?(?:(?!samples\/)[A-Za-z0-9_-][\w.-]*\/)?(samples\/)?([a-f0-9]{64})\.mp3$/;
function readPack(req) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0); let total = 0; let entry = null; let zeros = 0; let done = false;
    const out = { added: 0, existed: 0, skipped: 0, bad: 0, samples: 0, bytes: 0 };
    const fail2 = (status, msg) => { if (done) return; done = true; if (entry && entry.fd != null) { try { fs.closeSync(entry.fd); fs.unlinkSync(entry.tmp); } catch { /* gone */ } } req.resume(); reject(new (require('./util').HttpError)(status, msg)); };
    const finishEntry = () => {
      const e = entry; entry = null;
      if (!e.keep) return;
      fs.closeSync(e.fd);
      const b = fs.readFileSync(e.tmp);
      if (!mp3Duration(b)) { fs.unlinkSync(e.tmp); out.bad++; return; }
      if (fs.existsSync(e.dest)) { fs.unlinkSync(e.tmp); out.existed++; return; }
      fs.renameSync(e.tmp, e.dest); out.bytes += b.length;
      if (e.sample) out.samples++; else out.added++;
    };
    const parse = () => {
      for (;;) {
        if (entry) {
          if (entry.left > 0) {
            if (!buf.length) return;
            const n = Math.min(entry.left, buf.length);
            if (entry.keep) fs.writeSync(entry.fd, buf, 0, n);
            buf = buf.subarray(n); entry.left -= n;
            if (entry.left > 0) return;
          }
          if (buf.length < entry.pad) return;
          buf = buf.subarray(entry.pad);
          finishEntry();
          continue;
        }
        if (buf.length < 512) return;
        const h = buf.subarray(0, 512); buf = buf.subarray(512);
        if (h.every((x) => x === 0)) { if (++zeros >= 2) { done = true; req.resume(); return resolve(out); } continue; }
        zeros = 0;
        const str = (o, l) => h.toString('utf8', o, o + l).replace(/\0.*$/s, '');
        const size = parseInt(str(124, 12).trim() || '0', 8);
        if (!Number.isFinite(size) || size < 0) return fail2(400, 'This is not a voice pack (.tar).');
        if (str(257, 5) !== 'ustar' && !/^[0-7 \0]+$/.test(h.toString('latin1', 124, 136))) return fail2(400, 'This is not a voice pack (.tar).');
        const name = (str(345, 155) ? str(345, 155) + '/' : '') + str(0, 100);
        const type = String.fromCharCode(h[156] || 48);
        const m = (type === '0' || type === '\0') ? PACK_NAME.exec(name) : null;
        const keep = !!m && size > 0 && size <= PACK_MAX_FILE;
        if (!keep && type === '0') out.skipped++;
        entry = { left: size, pad: (512 - (size % 512)) % 512, keep };
        if (keep) {
          entry.sample = !!m[1];
          entry.dest = path.join(m[1] ? SAMPLE_DIR : VOICE_DIR, m[2] + '.mp3');
          entry.tmp = path.join(VOICE_DIR, `.pack-${m[2]}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`); // unique: two uploads of one pack at once
          entry.fd = fs.openSync(entry.tmp, 'w');
        }
        if (size === 0) { finishEntry(); }
      }
    };
    req.on('data', (c) => {
      if (done) return;
      total += c.length;
      if (total > PACK_MAX_TOTAL) return fail2(413, 'That file is too large for one voice pack.');
      buf = buf.length ? Buffer.concat([buf, c]) : c;
      try { parse(); } catch (e) { fail2(400, 'The voice pack could not be read: ' + (e && e.code ? `a file could not be saved (${e.code}).` : String((e && e.message) || e).slice(0, 120))); } // never the server's paths
    });
    req.on('end', () => { if (done) return; done = true; if (entry) { try { if (entry.fd != null) { fs.closeSync(entry.fd); fs.unlinkSync(entry.tmp); } } catch { /* gone */ } return reject(new (require('./util').HttpError)(400, 'The voice pack upload was cut off. Upload it again.')); } resolve(out); });
    req.on('error', (e) => fail2(400, e.message || 'Upload failed.'));
  });
}
/** Included-voice clips that are in the voice folder but not linked to their slide yet. */
function packTasks() {
  const s = { ...settings(), provider: 'included' };
  const tasks = []; let inPack = 0; let lines = 0;
  for (const l of lessonsIn('all')) {
    const rows = clipRows(l.id);
    for (const x of slotsFor(l)) {
      if (!x.text) continue;
      lines++;
      const h = hashFor(s, spoken(x.text, s.dictionary), l.school_slug);
      if (!fileOk(h + '.mp3')) continue;
      inPack++;
      if (slotState(x, rows.get(x.slot), s, h) === 'ready') continue;
      tasks.push({ lesson_id: l.id, slot: x.slot, step_index: x.step_index, text: x.text, force: false, title: l.title, school: l.school_slug });
    }
  }
  return { tasks, in_pack: inPack, lines };
}
// The pack's sample is always the default sentence (the team's own sample sentence is for ElevenLabs/OpenAI previews).
const packSample = () => { const s = { ...settings(), provider: 'included' }; return fs.existsSync(path.join(SAMPLE_DIR, hashFor(s, spoken(DEFAULTS.sample, s.dictionary)) + '.mp3')); };

/* ------------------------------------------------------------------ routes */
function routes(r) {
  const audit = (u, action, detail = '') => D.insert('audit', { user_id: u.id, action, detail: String(detail).slice(0, 500), created_at: now() });

  /* ----- members ----- */
  r.get('/voice/:file', (ctx) => {
    const file = String(ctx.params.file || '');
    if (!/^[a-f0-9]{64}(-[a-z0-9]{1,12})?\.mp3$/.test(file)) fail(404, 'Not found.');
    // Visitors who are not signed in (the VooSquare Academy website) hear only the clips of the public preview lessons.
    // Signed-in members too: the academy landing plays the same preview for a member who has not enrolled yet.
    if (voiceOn() && previewHears(file)) { if (!ctx.user) limit('voice-anon:' + ctx.ip, 900, 10 * 60_000); sendAudio(ctx, file); return; }
    const u = A.requireUser(ctx);
    const staff = A.can(u, 'academy');
    if (!voiceOn() && !staff) fail(403, 'The teaching voice is turned off for now.', { off: 'voice' });
    if (!canHear(u, file)) fail(403, 'Open this lesson first to hear it.');
    sendAudio(ctx, file);
  });
  r.get('/voice-music/:file', (ctx) => {
    const file = String(ctx.params.file || '');
    if (!/^[a-f0-9]{64}\.mp3$/.test(file)) fail(404, 'Not found.');
    A.requireUser(ctx);
    const fp = path.join(MUSIC_DIR, file);
    let b; try { b = fs.readFileSync(fp); } catch { fail(404, 'Not found.'); }
    ctx.handled = true;
    ctx.res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': b.length, 'Cache-Control': 'private, max-age=31536000, immutable', 'Accept-Ranges': 'none' });
    ctx.res.end(ctx.req.method === 'HEAD' ? undefined : b);
  });
  // available: at least one clip exists, so Profile only shows the voice switches when there is a voice to switch.
  r.get('/api/school/voice/prefs', (ctx) => ({ prefs: prefsFor(A.requireUser(ctx).id), available: !!D.get("SELECT 1 FROM voice_clips WHERE status='ready' AND file<>'' LIMIT 1") }));
  r.put('/api/school/voice/prefs', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('voice-prefs:' + u.id, 120, 60_000);
    const b = await ctx.json();
    const p = { ...prefsFor(u.id) };
    for (const k of ['enabled', 'auto', 'captions']) if (b[k] !== undefined) p[k] = !!b[k];
    if (b.speed !== undefined) { const v = Number(b.speed); if (!SPEEDS.includes(v)) fail(400, 'Speed is 0.75, 1, 1.25 or 1.5.'); p.speed = v; }
    D.run('INSERT INTO voice_prefs(user_id, enabled, auto, captions, speed, updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, auto=excluded.auto, captions=excluded.captions, speed=excluded.speed, updated_at=excluded.updated_at', u.id, p.enabled ? 1 : 0, p.auto ? 1 : 0, p.captions ? 1 : 0, p.speed, now());
    return { prefs: p };
  });

  /* ----- admin (Academy permission) ----- */
  const status = (s) => ({
    provider: s.provider, providers: Object.fromEntries(Object.entries(PROVIDERS).map(([k, v]) => [k, { name: v.name, env: v.env, key: !!keyFor(k) }])),
    ready: !problem(s), problem: problem(s), price_per_1k: price(s), price_auto: !(s.cost_per_1k > 0), kbps: kbps(s), voice: s.provider === 'included' ? 'Included voices (Michael and Grace)' : voiceLabel(s), included_voices: INCLUDED_VOICES,
  });
  r.get('/api/admin/voice', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const s = settings();
    const schools = D.all('SELECT id, slug, title, track, sort FROM school_schools ORDER BY sort, id');
    const modules = D.all('SELECT id, school_id, title, sort FROM school_modules WHERE published=1 ORDER BY sort, id');
    return {
      settings: s, status: status(s), totals: totals(s), run: runPublic(), feature: features().on('voice'), music: musicFor(s), music_default: DEFAULT_MUSIC_URL,
      options: { eleven_models: ELEVEN_MODELS, outputs: OUTPUTS, openai_models: OPENAI_MODELS, openai_voices: OPENAI_VOICES, defaults: DEFAULTS },
      schools: schools.map((x) => ({ ...x, modules: modules.filter((m) => m.school_id === x.id).map((m) => ({ id: m.id, title: m.title, order: m.sort })) })),
    };
  });
  r.put('/api/admin/voice/settings', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const b = await ctx.json();
    const next = cleanSettings(b, settings());
    // Keep "no provider chosen yet" (the default follows the server's keys) unless the team picked one.
    const stored = D.getSetting('voice', {}) || {};
    if (b.provider === undefined && stored.provider === undefined) delete next.provider;
    D.setSetting('voice', next);
    audit(me, 'voice.settings', `${next.provider} ${voiceLabel(next)}`);
    return { settings: settings(), status: status(settings()) };
  });
  r.get('/api/admin/voice/voices', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    limit('voice-voices:' + me.id, 30, 60_000);
    const s = settings();
    const p = PROVIDERS[ctx.query.provider] ? ctx.query.provider : s.provider;
    if (!keyFor(p)) fail(400, `Add ${PROVIDERS[p].env} to the server's variables first. Until then you can paste a voice ID.`);
    try { return { provider: p, voices: await ADAPTERS[p].voices() }; } catch (e) { fail(502, e.message || 'Could not load the voices.'); }
  });
  /* A short sample with the current settings (or another voice), for the voice picker. Cached like clips. */
  r.post('/api/admin/voice/sample', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    limit('voice-sample:' + me.id, 40, 10 * 60_000);
    const b = await ctx.json();
    const s = settings();
    if (b.provider && PROVIDERS[b.provider]) s.provider = b.provider;
    if (b.voice_id !== undefined) { if (!/^[A-Za-z0-9_-]{2,64}$/.test(String(b.voice_id))) fail(400, 'Unknown voice.'); if (s.provider === 'openai') { if (!OPENAI_VOICES.includes(b.voice_id)) fail(400, 'Unknown voice.'); s.openai.voice = b.voice_id; } else s.elevenlabs.voice_id = String(b.voice_id); }
    if (b.settings && typeof b.settings === 'object') Object.assign(s, cleanSettings(b.settings, s));
    const pr = problem(s); if (pr) fail(400, pr);
    const text = spoken(clean(b.text, 300) || (s.provider === 'included' ? DEFAULTS.sample : s.sample), s.dictionary);
    // Included voice: the picker plays each narrator's own sample (b.voice_id picks Michael or Grace).
    const incV = s.provider === 'included' && INCLUDED_IDS.includes(b.voice_id) ? b.voice_id : '';
    if (incV) s.included = { ...s.included, voices: { __sample: incV } };
    const h = hashFor(s, text, incV ? '__sample' : undefined);
    const fp = path.join(SAMPLE_DIR, h + '.mp3');
    let audio;
    if (fs.existsSync(fp)) audio = fs.readFileSync(fp);
    else {
      if (s.provider === 'included') fail(400, text === spoken(DEFAULTS.sample, s.dictionary) || !clean(b.text, 300) ? 'The included voice sample is not here yet. Upload the voice pack first.' : 'The included voice can only play its own sample sentence.');
      try { audio = (await synthesize(s, text)).audio; } catch (e) { fail(e.status === 401 ? 400 : 502, e.message || 'The sample did not generate.'); }
      try { fs.writeFileSync(fp, audio); } catch { /* cache is optional */ }
    }
    ctx.handled = true;
    ctx.res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Content-Length': audio.length, 'Cache-Control': 'no-store', 'X-Voice-Chars': String(text.length) });
    ctx.res.end(audio);
  });
  r.post('/api/admin/voice/spoken', async (ctx) => {
    A.requirePerm(ctx, 'academy');
    const b = await ctx.json();
    const dict = b.dictionary !== undefined ? cleanSettings({ dictionary: b.dictionary }, settings()).dictionary : settings().dictionary;
    return { spoken: spoken(clean(b.text, MAX_TEXT), dict) };
  });
  r.get('/api/admin/voice/estimate', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const q = ctx.query;
    return { estimate: plan(q.scope, q.id, q.mode === 'all' ? 'all' : 'missing', q.slot || '').estimate, status: status(settings()) };
  });
  r.post('/api/admin/voice/generate', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    limit('voice-gen:' + me.id, 60, 60_000);
    const b = await ctx.json();
    const s = settings();
    const pr = problem(s); if (pr) fail(400, pr);
    const scope = String(b.scope || '');
    if (scope === 'clip' && !/^(intro|outro|s\d{1,3})$/.test(String(b.slot || ''))) fail(400, 'Choose the clip to generate.');
    const mode = b.mode === 'all' || scope === 'clip' ? 'all' : 'missing';
    const p = plan(scope, b.id, scope === 'clip' && !b.force ? 'missing' : mode, scope === 'clip' ? b.slot : '');
    if (scope === 'clip' && !p.tasks.length) {
      // The clip is up to date: "regenerate" on one clip always makes a new take.
      Object.assign(p, plan(scope, b.id, 'all', b.slot));
    }
    if (!p.tasks.length) return { queued: 0, estimate: p.estimate, run: runPublic(), message: p.estimate.not_in_pack ? 'These lines are not in the included voice pack yet. Upload the newest voice pack.' : s.provider === 'included' && p.estimate.up_to_date ? 'The included voice plays these lines from the voice pack. It cannot make a new take; use ElevenLabs or OpenAI for that.' : 'Everything in this scope is up to date.' };
    const label = scope === 'clip' ? `${p.tasks[0].title}: ${p.tasks[0].slot}` : scope === 'lesson' ? p.tasks[0].title : scope === 'all' ? 'Every school' : `${scope} ${b.id}`;
    const n = enqueue(p.tasks, label);
    audit(me, 'voice.generate', `${scope} ${b.id || ''} ${mode}: ${n} clips, about $${p.estimate.cost_usd}`);
    return { queued: n, estimate: p.estimate, run: runPublic() };
  });
  r.post('/api/admin/voice/stop', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const ok = stopRun('Stopped by ' + (me.name || 'the team'));
    if (ok) audit(me, 'voice.stop', '');
    return { stopped: ok, run: runPublic() };
  });
  r.get('/api/admin/voice/run', (ctx) => { A.requirePerm(ctx, 'academy'); return { run: runPublic() }; });
  /* Included voice pack: status, upload (a .tar, streamed), and linking the clips it contains to their slides. */
  /* The lines that still need included-voice audio, exactly as this server will look for them (current script, admin
   * lessons, text edits and pronunciation list). Rendered with tools/voice-pack, they come back as a pack. */
  r.get('/api/admin/voice/pack/missing', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    limit('voice-pack-missing:' + me.id, 20, 60_000);
    const s = { ...settings(), provider: 'included' };
    const seen = new Set(); const lines = [];
    for (const l of lessonsIn('all')) {
      for (const x of slotsFor(l)) {
        if (!x.text) continue;
        const text = spoken(x.text, s.dictionary);
        const hash = hashFor(s, text, l.school_slug);
        if (seen.has(hash) || fileOk(hash + '.mp3')) continue;
        seen.add(hash);
        lines.push(JSON.stringify({ hash, text, school: l.school_slug, module: l.module_sort, module_title: l.module_title, lesson_id: l.id, lesson: l.title, slot: x.slot }));
      }
    }
    const sampleText = spoken(DEFAULTS.sample, s.dictionary);
    const sh = hashFor(s, sampleText);
    if (!fs.existsSync(path.join(SAMPLE_DIR, sh + '.mp3'))) lines.push(JSON.stringify({ hash: sh, text: sampleText, school: '_sample', module: 0, slot: 'sample', sample: true }));
    ctx.handled = true;
    const body = Buffer.from(lines.join('\n') + (lines.length ? '\n' : ''));
    ctx.res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="voosquare-academy-missing-lines.jsonl"', 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Lines': String(lines.length) });
    ctx.res.end(body);
  });
  r.get('/api/admin/voice/pack', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const p = packTasks();
    return { pack: { lines: p.lines, in_pack: p.in_pack, to_link: p.tasks.length, sample: packSample(), voice: INCLUDED } };
  });
  const linkPack = (me) => {
    if (settings().provider !== 'included') return 0;
    const p = packTasks();
    if (!p.tasks.length) return 0;
    const n = enqueue(p.tasks, 'Included voice pack');
    audit(me, 'voice.pack.link', `${n} clips`);
    return n;
  };
  r.post('/api/admin/voice/pack', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    limit('voice-pack:' + me.id, 200, 60 * 60_000);
    const out = await readPack(ctx.req);
    audit(me, 'voice.pack.upload', `+${out.added} clips, ${out.existed} already there, ${out.skipped} skipped, ${out.bad} not MP3`);
    const linked = linkPack(me);
    const p = packTasks();
    return { upload: out, linked, pack: { lines: p.lines, in_pack: p.in_pack, to_link: p.tasks.length, sample: packSample(), voice: INCLUDED }, run: runPublic() };
  }, { noBody: true });
  /* Intro music: upload an MP3 (raw body), or go back to the default track. */
  r.post('/api/admin/voice/music', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    limit('voice-music:' + me.id, 20, 60 * 60_000);
    const b = await require('./util').readBody(ctx.req, MUSIC_MAX);
    if (!b.length) fail(400, 'Choose an MP3 file.');
    const ms = mp3Duration(b);
    if (!ms) fail(400, 'That file is not an MP3. Export the track as MP3 and try again.');
    if (ms < 2000) fail(400, 'That track is too short. Use at least 2 seconds.');
    const file = crypto.createHash('sha256').update(b).digest('hex') + '.mp3';
    fs.writeFileSync(path.join(MUSIC_DIR, file), b);
    const cur = settings();
    const old = cur.music && cur.music.file;
    const name = clean(ctx.query.name || 'Your track', 80);
    D.setSetting('voice', { ...cur, music: { ...cur.music, file, name, enabled: true } });
    if (old && old !== file) { try { fs.unlinkSync(path.join(MUSIC_DIR, old)); } catch { /* gone */ } }
    audit(me, 'voice.music.upload', `${name} (${Math.round(ms / 1000)} s)`);
    return { music: settings().music, player: musicFor(), duration_ms: ms };
  });
  r.del('/api/admin/voice/music', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const cur = settings();
    const old = cur.music && cur.music.file;
    D.setSetting('voice', { ...cur, music: { ...cur.music, file: '', name: '' } });
    if (old) { try { fs.unlinkSync(path.join(MUSIC_DIR, old)); } catch { /* gone */ } }
    audit(me, 'voice.music.default', '');
    return { music: settings().music, player: musicFor() };
  });
  r.post('/api/admin/voice/pack/link', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    if (settings().provider !== 'included') fail(400, 'Choose the included voice first (Voice → Included voice).');
    const n = linkPack(me);
    return { linked: n, run: runPublic() };
  });
  r.get('/api/admin/voice/lessons', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const s = settings();
    const q = ctx.query;
    const ls = q.module ? lessonsIn('module', q.module) : q.school ? lessonsIn('school', q.school) : lessonsIn('all');
    return { lessons: ls.map((l) => lessonSummary(l, s)) };
  });
  r.get('/api/admin/voice/lessons/:id', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const s = settings();
    const l = lessonsIn('lesson', ctx.params.id)[0];
    if (!l) fail(404, 'Lesson not found.');
    const rows = clipRows(l.id);
    return { lesson: lessonSummary(l, s), clips: slotsFor(l).map((x) => clipPublic(x, rows.get(x.slot), s, l.school_slug)) };
  });
  /* Edit what one clip says. The override is kept when content reloads from files (like a lesson edit); reset takes the
   * file's text again. Regenerate the clip afterwards to hear it. */
  r.put('/api/admin/voice/lessons/:id/text', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const l = lessonsIn('lesson', ctx.params.id)[0];
    if (!l) fail(404, 'Lesson not found.');
    const b = await ctx.json();
    const slot = String(b.slot || '');
    const x = slotsFor(l).find((y) => y.slot === slot);
    if (!x) fail(400, 'Unknown clip.');
    if (b.reset) D.run('DELETE FROM voice_edits WHERE lesson_id=? AND slot=?', l.id, slot);
    else {
      const text = String(b.text ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
      if (text.length > MAX_TEXT) fail(400, `Keep a clip under ${MAX_TEXT} characters.`);
      if (/<[a-z/!]/i.test(text)) fail(400, 'Write plain sentences. No tags.');
      D.run('INSERT INTO voice_edits(lesson_id, slot, text, by_id, at) VALUES(?,?,?,?,?) ON CONFLICT(lesson_id, slot) DO UPDATE SET text=excluded.text, by_id=excluded.by_id, at=excluded.at', l.id, slot, text, me.id, now());
    }
    audit(me, b.reset ? 'voice.text.reset' : 'voice.text.edit', `#${l.id} ${slot}`);
    const s = settings();
    const y = slotsFor(l).find((z) => z.slot === slot);
    return { clip: clipPublic(y, clipRows(l.id).get(slot), s, l.school_slug) };
  });
}

module.exports = { DEFAULT_MUSIC_URL, narratorName, previewHears, voiceOn, includedVoice, INCLUDED_VOICES, routes, forMember, settings, spoken, mp3Duration, hashFor, slotsFor, plan, price, VOICE_DIR, SAMPLE_DIR, ADAPTERS, PROVIDERS, INCLUDED, packTasks, lessonsIn };
