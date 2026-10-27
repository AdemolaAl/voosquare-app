# Teaching voice: setup for the owner

## 0. The free included voice (start here)

VooSquare ships with a free narrator (calm American male teacher voice). It costs nothing per character: the clips are
made ahead of time and uploaded as **voice packs** (`.tar` files, one or more per school).

1. Open **/admin → VooSquare Academy → Teaching voice**. Under **Voice**, choose **Included voice** (it is already chosen when
   no ElevenLabs or OpenAI key is set on the server).
2. In **Included voice pack**, press **Upload voice packs (.tar)** and pick the pack files (several at once is fine).
   Each upload shows its progress; each pack is about 25 MB and takes under a minute on a normal connection.
3. The clips link to their slides by themselves. The bar shows how many lines have included audio.
4. Open a lesson in the app and press **Listen to this lesson** to check it.

Good to know:
- Packs only add files; uploading the same pack twice changes nothing. Files that are not clips are ignored.
- New or rewritten lines (writers' edits, your own admin lessons) need a newer pack, or switch to ElevenLabs/OpenAI
  for those. Until then those slides show text and captions without voice, never the wrong audio.
- How packs are made: `tools/voice-pack/README.md`.

## Intro music

One short track opens every lesson when a member presses **Listen**, then fades out as the intro voice starts.
A default track ships with the app. In **Teaching voice → Intro music** you can play it, upload your own MP3
(up to 8 MB; 6 to 15 seconds works best; use music you own or have a licence for), set the volume, how long it plays
before the voice and how long the fade takes, or switch it off.

---

VooSquare Academy lessons can be read aloud by a natural AI voice, with captions. You can use a stock ElevenLabs voice or a
clone of your own voice. This guide takes about 30 minutes, plus the time to record yourself if you clone your voice.

What you need: an ElevenLabs account, access to Railway (Variables), and the VooSquare admin (owner or Academy permission).

---

## 1. Create an ElevenLabs account and an API key

1. Go to **elevenlabs.io** and sign up.
2. Pick a plan. The free plan works for tests (about 10,000 characters a month). For the full school you need a paid
   plan; see **Costs** below. Instant Voice Clone needs the **Starter** plan or above.
3. Open **Developers → API keys** (or your profile menu → **API keys**) and click **Create API key**.
   - Name it `VooSquare`.
   - Permissions: allow **Text to Speech** and **Voices** (read). Nothing else is needed.
   - Optionally set a monthly credit limit on the key, so a mistake can never spend more than you planned.
4. Copy the key (it starts with `sk_`). You only see it once.

## 2. (Optional) Clone your own voice

Instant Voice Clone takes a few minutes of clean audio and gives you a voice that sounds like you.

1. **Record 2 to 5 minutes** of yourself reading something in your teaching voice (an old lesson script is perfect).
   - Quiet room, no music, no echo (a room with curtains, a bed or a wardrobe of clothes is better than a bare office).
   - Phone or USB microphone about a hand's width from your mouth. Same distance the whole time.
   - Speak the way you want the lessons to sound: calm, clear, friendly. Pauses are fine; long silences are not.
   - Save as MP3 or WAV. One file is fine; several short files also work.
2. In ElevenLabs open **Voices → Add a new voice → Instant Voice Clone**.
3. Upload the recording, name the voice (for example `Ejiro teaching`), add a short description, confirm you have the
   rights to the voice, and save.
4. Play the preview. If it sounds off, record again in a quieter place; quality of the sample matters more than length.
5. The voice now shows in your ElevenLabs voices. You do not need to copy its ID: VooSquare lists your voices. (If you
   ever need it: **Voices → your voice → ⋯ → Copy voice ID**.)

A **Professional Voice Clone** (Creator plan and above, 30+ minutes of audio, a few hours to train) sounds even closer.
It shows up in the same list once it is ready.

## 3. Put the key in Railway

1. Railway → your VooSquare project → the service → **Variables**.
2. Add `ELEVENLABS_API_KEY` = the key from step 1.
3. Railway redeploys by itself. Wait for the deploy to finish.

(Optional: `OPENAI_API_KEY` adds OpenAI as a second provider you can switch to in the admin.)

## 4. Pick the voice in the admin

1. Open **/admin → VooSquare Academy → Teaching voice**.
2. The top card should say **ElevenLabs: Key found**. If it says **No key yet**, check the variable name and redeploy.
3. In **Voice**, press play next to a few voices to hear the sample sentence (each preview costs its characters once;
   playing it again is free). Your clone is listed first.
4. Press **Use this voice** on the one you want. The top card turns to **Ready to generate**.
5. **Sound** (the defaults are good for teaching):
   - Model: **Multilingual v2** (most natural). Flash v2.5 or Turbo v2.5 cost about half and sound a little flatter.
   - Stability 0.5, Similarity 0.75 (raise to 0.85 for your clone), Style 0 to 0.2, Speed 1.
   - Audio file: **128 kbps** is the best quality. **64 kbps** halves the storage and still sounds good for speech.
   - Price per 1,000 characters: leave empty for the list price, or type what your plan costs you.
6. **Pronunciation**: words the voice should say differently. Already there: VooSquare → "voo square", Joinvoo →
   "join voo", Dchessking → "D chess king" and the other Voo apps. Type a sentence in **Try a sentence** to check, then
   **Save pronunciation**.

## 5. Test one lesson

1. In **Generate**, choose **One lesson**, pick a school, module and lesson.
2. Read the estimate (clips, characters, cost, minutes of audio, storage) and press **Generate**.
3. Watch the progress. When it is done, open the lesson in the **Lessons** list below and press play on a few clips.
4. Open the lesson in the app as a member would (Academy → the lesson). You should see **Listen to this lesson**.
   Listen to the whole lesson on your phone. Check speed, captions and that it moves to the next slide by itself.
5. A line sounds wrong? On the lesson's page in the admin press the pencil, rewrite the line for the ear (short
   sentences, numbers as words, letters spaced like "C P A"), then **Save and generate**. Or add the word to the
   pronunciation list and regenerate the lesson ("Missing or changed" picks up only the lines that use it).
   Not happy with a take? The circular arrow on a ready clip makes a new take.

## 6. Generate a school, then everything

1. In **Generate** choose **A school**, read the estimate, and press **Generate**. It runs in the background; you can close
   the page. Two clips are made at a time.
2. Lines that did not change are never sent again, so running it twice costs nothing extra. When writers add or change
   narration, reload content (**Schools and pacing → Reload content from files**) and run **Missing or changed** again.
3. If the run stops with "API key was refused" or a quota message, top up or upgrade in ElevenLabs and press Generate
   again. Only what is missing is sent.
4. Changing the voice or sound settings later marks existing clips as **Older voice**. Members keep hearing them until
   you regenerate, so you can switch voices without a gap.

## Costs (approximate; check current ElevenLabs pricing)

- ElevenLabs bills **characters**. Multilingual v2: 1 credit per character. Flash/Turbo v2.5: about 0.5.
- List price is about **$0.10 per 1,000 characters** on Multilingual v2 (about $0.05 on Flash). Plans bundle credits
  (for example Creator about 100k credits a month, Pro about 500 to 600k, Scale about 2M).
- The whole VooSquare Academy script is roughly **2 to 2.5 million characters** once every slide has narration
  (about 350 lessons, around 5,500 clips at 30 seconds each). That is about **$200 to $250 on Multilingual v2**, about
  half on Flash. A sensible way: one month on a plan with enough credits for the whole school, then drop back to a
  small plan for updates.
- The admin shows the exact character count and estimate before every run. Previews count too, but only once each.

## Storage

- Clips are MP3 files in the `voice` folder next to the database (`/data/voice` on Railway), so they survive deploys on
  the same volume as the database.
- Rough sizes for the whole school (about 45 hours of speech): **2.5 GB at 128 kbps**, **1.3 GB at 64 kbps**,
  **0.65 GB at 32 kbps**. Make sure the Railway volume has room (Railway → the volume → Settings → size).
- Clips are served by VooSquare itself with long browser caching, and members download a clip only when they play it.
  If storage or bandwidth grows, the files can move to Cloudflare R2 later; nothing else changes for members.

## Good to know

- Members can turn the voice off in **Profile → Lessons**. The whole feature has a switch in **Settings → Features →
  Teaching voice**; turning it off deletes nothing.
- A clip only plays while its caption still matches the slide's text. If a writer changes a line, that slide is silent
  (text only) until you regenerate it, so the voice never says something different from the screen.
- Locked and Premium lessons keep their audio private: the clip address only works for members who can open the lesson.
- Writers' rules for the script are in the narration brief: every slide gets `"say"`, every lesson `"say_intro"` and
  `"say_outro"`; written for the ear; numbers as words; acronyms spaced ("F T D"); no SSML tags; no hype.
