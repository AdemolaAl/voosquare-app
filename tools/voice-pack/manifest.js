'use strict';
/*
 * Lists every narration line of VooSquare Academy for the included voice, with the exact file name the server will look for.
 * Usage: node tools/voice-pack/manifest.js manifest.jsonl
 * Runs on a throwaway database, loads the content files (src/seed/school), and prints one JSON line per clip:
 * { hash, text (what is spoken, after the pronunciation list), school, module, lesson_id, slot }.
 * The renderer (tools/voice-pack/render.py) turns each line into <hash>.mp3; tools/voice-pack/pack.py bundles them.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-pack-'));
process.env.DATABASE_PATH = path.join(tmp, 'pack.db');
process.env.VOICE_DIR = path.join(tmp, 'voice');
const D = require('../../src/db');
require('../../src/features'); const school = require('../../src/school'); require('../../src/voice'); require('../../src/aff');
require('../../src/migrate').runOrExit(D.db);
school.load({ quiet: true });
const V = require('../../src/voice');
const s = { ...V.settings(), provider: 'included' };
const seen = new Set();
const out = [];
for (const l of V.lessonsIn('all')) {
  for (const x of V.slotsFor(l)) {
    if (!x.text) continue;
    const text = V.spoken(x.text, s.dictionary);
    const hash = V.hashFor(s, text, l.school_slug);
    out.push(JSON.stringify({ hash, text, voice: V.includedVoice(s, l.school_slug), school: l.school_slug, module: l.module_sort, module_title: l.module_title, lesson_id: l.id, lesson: l.title, slot: x.slot, dup: seen.has(hash) }));
    seen.add(hash);
  }
}
const sample = V.spoken(s.sample, s.dictionary);
for (const v of V.INCLUDED_VOICES) {
  const sv = { ...s, included: { ...s.included, voices: { __sample: v.id } } };
  out.push(JSON.stringify({ hash: V.hashFor(sv, sample, '__sample'), text: sample, voice: v.id, school: '_sample', module: 0, slot: 'sample', sample: true }));
}
const dest = process.argv[2];
if (dest) fs.writeFileSync(dest, out.join('\n') + '\n'); else process.stdout.write(out.join('\n') + '\n');
D.db.close();
fs.rmSync(tmp, { recursive: true, force: true });
