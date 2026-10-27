# Update: VooSquare Academy (for the developer)

Everything here is additive. Existing members, payments, progress and certificates are untouched.
Tests: `npm test` → 1810 passed, 0 failed. Five database migrations (009–013) run by themselves on start.

## 1. Deploy the code
Deploy this folder as usual on Railway. On first start the app runs migrations 009 (admin-made classes)
010 (one-tap switch links) and 011 (the whole Academy becomes free: the five vertical schools stop being
Premium; Premium keeps the community rooms and tools), 012 (members can delete their account) and 013 (report and
block in the community). A safety copy of the database is made first.

**Also new, needed for the Play Store and App Store apps:**
- Profile → **Delete account** (and the public page `/delete-account`); payment records are kept, anonymised.
- Community: **Report** and **Block** on every message; Admin → Community → **Reports** to review them.
- Admin → Settings → General → **App review account**: the store reviewers' sign-in (or env `REVIEW_LOGIN_EMAIL` + `REVIEW_LOGIN_CODE`).
- Inside the phone apps (user agent `VooSquareApp/… (ios|android)`), Premium prices and buy buttons are hidden. The website is unchanged.
See the mobile repo's MOBILE-GUIDE.md for the app builds.

## 2. Turn on the voice (free, no API key)
1. Open **/admin → VooSquare Academy → Teaching voice**. Under **Voice**, "Included voice" is already chosen
   (when no ElevenLabs/OpenAI key is set).
2. Download all the voice in one go (about 850 MB):
   **https://github.com/Dchessking1/SMD-/archive/refs/heads/main.zip**
   Unzip it. Inside, the `voice` folder holds the 43 `.tar` voice packs (foundations 1–8, operator 1–9,
   scale 1–5, v-nutra 1–4, v-igaming 1–4, v-trading 1–4, v-finance 1–4, v-sweeps 1–4, and
   `voosquare-academy-voice-samples.tar`). Don't unpack the `.tar` files — upload them as they are.
3. In **Included voice pack**, press **Upload voice packs (.tar)**, open that `voice` folder, press **Ctrl+A** (Cmd+A on Mac)
   to select all 43, then Open. That's one action — they upload one after another by themselves. Use good Wi-Fi.
   If one fails, upload just that one again; uploading the same pack twice is harmless (nothing is doubled).
4. The bar should reach **5,530 of 5,530 lines**. The clips link to their slides by themselves.
5. Check the Railway volume has at least **1.5 GB** free (the voice files live in `/data/voice`).

Narrators: **Michael** (Foundations, Operator, Scale) and **Grace** (Trading, iGaming, Finance, Nutra, Sweepstakes).
Intro music plays at the start of each lesson (Teaching voice → Intro music to change or turn off).

## 3. Connect voosquareacademy.com
1. Railway → the VooSquare service → Settings → Networking → **Custom domain**: add `voosquareacademy.com`
   and `www.voosquareacademy.com`. Create the DNS records Railway shows (at your domain registrar).
2. Railway → Variables:
   - `ACADEMY_URL=https://voosquareacademy.com`
   - `VOOSQUARE_URL=https://<your VooSquare address>` (for example https://voosquare.com)
3. Redeploy. Open https://voosquareacademy.com → the academy website. `/learn` is the learner app.
   Members use the same Voo ID. "Switch to VooSquare" signs them in on VooSquare with one tap (and back).
   The "Also at voosquareacademy.com" link inside VooSquare only appears once `ACADEMY_URL` is set.

Details: docs/DEPLOY-GUIDE.md (part 6b), docs/VOICE_SETUP.md, tools/voice-pack/README.md.

## 4. Quick checks after deploy
- VooSquare: log in, open Academy → Foundations → lesson 1 → "Listen to this lesson" (music, then voice, captions).
- voosquareacademy.com: landing loads, "Start learning free", the free preview lesson plays with voice.
- Tap "Switch to VooSquare" while signed in: you land in VooSquare already signed in.
- Admin → VooSquare Academy: "Add school / Add module / Add lesson" work.
