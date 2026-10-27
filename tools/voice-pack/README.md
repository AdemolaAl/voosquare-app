# Included voice packs (the free VooSquare Academy narrator)

The included voice is rendered **outside the server** and uploaded as `.tar` voice packs in
**Admin → VooSquare Academy → Teaching voice → Included voice pack**. The server never makes these clips itself.

Set `KOKORO_DIR` (folder with `kokoro-v1.0.onnx`, `voices-v1.0.bin` and kokoro-onnx's `config.json`) and `MISAKI_DIR` (a checkout of misaki).

Narrators: Kokoro-82M (Apache-2.0) voices `am_michael` (Michael, main path) and `af_heart` (Grace, vertical schools by default; the admin can choose per school), speed 0.95, mono 24 kHz MP3 at 48 kbps.

## Steps (on any machine with Python 3, ffmpeg, Node 22)

1. `node tools/voice-pack/manifest.js manifest.jsonl` lists every narration line with the exact file name the server
   expects (`sha256` of the provider, voice and the spoken text after the pronunciation list).
2. Render: `python3 tools/voice-pack/render.py manifest.jsonl clips/` (needs `onnxruntime`, `numpy`, the Kokoro model
   files `kokoro-v1.0.onnx` and `voices-v1.0.bin` from github.com/thewh1teagle/kokoro-onnx releases, the misaki
   lexicon from github.com/hexgrad/misaki, and libflite for words not in the lexicon). Already rendered files are
   skipped, so it can be stopped and resumed.
3. Pack: `python3 tools/voice-pack/pack.py manifest.jsonl clips/ packs/` makes files of up to 25 MB per school.
4. Upload the packs in the admin. Clips are linked to their slides automatically when the included voice is selected.

**For a live site**, use the list the server gives instead of step 1: Admin → Teaching voice → Included voice pack →
**Download the list** (`GET /api/admin/voice/pack/missing`). It already uses the site's current script, admin-made
lessons, text edits and pronunciation list, and only lists lines that have no audio yet. Render and pack it the same way.

Pack size: keep packs small enough to upload within the server's request time limit (120 s by default). `pack.py`
defaults to 25 MB, which uploads in under a minute on a 4 Mbit/s connection.

When writers change narration, run the three steps again: only new or changed lines render, and uploading a pack twice
is harmless. If the team changes the pronunciation list, the affected lines get new names and must be rendered again.

`intro-music.py` re-creates the default intro music (`public/assets/voo-school-intro.mp3`).
