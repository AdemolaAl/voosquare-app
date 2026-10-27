> **Start here:** [Put VooSquare live on Railway, step by step](docs/DEPLOY-GUIDE.md) · [Running VooSquare day to day (owner guide)](docs/OWNER-GUIDE.md) · **Developers: [Changing VooSquare safely](docs/CHANGING-SAFELY.md) before any change**

# VooSquare

The hub for media buyers and performance marketers, by Zedapex. **Media buying, squared.**

- Website, member dashboard, community rooms (free, Premium and paid), animated Academy, blog
- One login (Voo ID) for every Zedapex tool, with "Continue with VooSquare" for your other products
- One support inbox for every product, including messages from other websites (embeddable widget + API)
- Premium membership and paid rooms, with payment methods for any currency (Paystack, Flutterwave, Stripe, crypto wallets, bank transfer, or any custom API)
- Animated welcome email series, broadcasts, receipts and support replies
- A full admin with team roles, so you can change everything without touching code

**Stack:** Node 22, zero npm dependencies (built-in `node:sqlite`, `http`, `crypto`). Nothing to install, nothing to build.

---

## Deploy on Railway (about 10 minutes)

1. **Push this folder to a GitHub repo** (private is fine).
2. In Railway: **New Project → Deploy from GitHub repo** → pick the repo. Railway builds with the included `Dockerfile` and reads `railway.json` (health check `/healthz`, one replica, restart on failure). The first deploy may start before the volume exists; that's fine, but nothing saved before step 3 is kept.
3. **Attach a volume** so the database and images survive deploys: on the project canvas, right-click the service (or press Ctrl/Cmd + K) → **Attach volume** → mount path **`/data`**. Everything lives there: the database `/data/voosquare.db` and shared images in `/data/uploads/` (created on first boot).
4. **Set variables** (service → **Variables**; the **Raw Editor** accepts a pasted `.env`). Every variable the app reads is in `.env.example`:
   - `OWNER_EMAIL` = your email (this account becomes the owner the first time it logs in)
   - `APP_SECRET` = a long random string (`openssl rand -hex 32`). Set it once and never change it: it signs login codes, unsubscribe links and "Continue with VooSquare" access tokens (changing it logs tools out).
   - `NODE_ENV` = `production`
   - `EMAIL_PROVIDER` = `resend` (or `brevo` / `postmark`), `EMAIL_API_KEY`, `EMAIL_FROM` = e.g. `VooSquare <hello@voosquare.com>`, `EMAIL_REPLY_TO` (optional). You can skip email for the first boot, see step 6.
   - Leave these unset on Railway: `PORT` (Railway sets it), `DATABASE_PATH` (found from the `/data` volume), `UPLOADS_DIR` (defaults to `/data/uploads`), `BASE_URL` (filled from the Railway domain; set it only for a custom domain).
5. **Networking → Generate domain** (or add your custom domain `voosquare.com`). With a custom domain, set `BASE_URL=https://voosquare.com` (no trailing slash): login emails, payment webhooks, referral links and "Continue with VooSquare" use it. For VooSquare Academy's own website add the custom domains `voosquareacademy.com` and `www.voosquareacademy.com` to the **same** service and set `ACADEMY_URL=https://voosquareacademy.com` (and `VOOSQUARE_URL=https://voosquare.com`): [DEPLOY-GUIDE, Part 6b](docs/DEPLOY-GUIDE.md).
6. **Log in as owner.** Open `https://<your domain>/login` and enter `OWNER_EMAIL`. If email is not set up yet, the code is not shown on screen in production: open the service → **Deployments → View logs** and find the line `[email:console] to=<your email> subject="Your VooSquare code: 123456"`. Codes last 10 minutes. Then go to **/admin**.
7. Check the deploy: `https://<your domain>/healthz` returns `{"ok":true,...}`, and the logs show `Database: /data/voosquare.db`. If they show another path, the volume is not mounted at `/data`.

> Keep **one replica**. The database is a file on the volume, and live updates are kept in memory. One Railway instance comfortably handles many thousands of members. If you later need several instances, move to Postgres and a shared pub/sub (the code is organised so that's a contained change).

### Email setup (Resend example)
1. Create a Resend account, add and verify your domain (DNS records).
2. Create an API key → put it in `EMAIL_API_KEY`, set `EMAIL_PROVIDER=resend` (or enter them in **/admin → Settings → Email**, which takes priority over the variables).
3. In **/admin → Emails**, send yourself a test of each template.
Until email is set up, codes and emails print in the Railway logs (and in local development the login screen shows the code). Members cannot log in until email works, so set it up before you share the link.

### First things to do in /admin
1. **Settings**: brand, support email, social links, email provider, and the **reporting time zone** for revenue (default `Africa/Lagos`).
2. **Payments**: add a method (Gatevoo, Paystack, Flutterwave, Stripe, crypto wallet, bank transfer, custom manual or custom API), set the currency and the rate per 1 USD, switch it on, and paste the webhook URL shown into your provider's dashboard. Gatevoo: see `docs/GATEVOO.md`.
3. **Plans**: check the Premium price ($20), period and features.
4. **Team**: invite your support agents (choose which products they see), a content editor (ads, announcements, top card, app store buttons), moderators.
5. **Products**: for each tool, confirm its URL (Spyvoo is seeded as `https://spyvoo.com`) and copy its credentials for your developer (see `docs/INTEGRATION.md`). Each tool connects with the **Voo Connect** kit: what to fill in per tool and a prompt to paste for its builder are in [docs/VOO_CONNECT.md](docs/VOO_CONNECT.md).
6. **Site content**: top card, announcement bar, spotlight slides, and **App stores** (Google Play and App Store links plus the official badges as PNG; with no link the button says "Coming soon").
7. **Community → Rooms**: every seeded room already has house artwork. Upload your own picture (square) or cover (wide, best 1200 by 400) in the room editor; "Use house artwork" brings the default back.

---

## Run locally
```bash
node --version            # 22.13 or newer
OWNER_EMAIL=you@example.com npm run dev
# open http://localhost:3000  (login codes print in the terminal and show on screen)
npm test                  # end-to-end smoke test on a temporary database
```

## Project layout
```
server.js               HTTP server, routing, static files
src/config.js           environment settings
src/db.js               SQLite baseline schema + helpers (new schema goes in src/migrations, never here)
src/migrate.js          versioned migrations: safety copy before an update, run once in a transaction, refuse to start on failure
src/migrations/         numbered migrations (001 baseline, 002 price locks, 003 recycle bin...)
src/restore.js          RESTORE_FROM: put a backup back on start (the current database is saved first)
src/trash.js            recycle bin for admin deletes (deleted_rows)
src/flags.js            rollout flags for new features (off → team → % of members → everyone)
src/auth.js             sessions, permissions
src/routes/app.js       member API (site, auth, community, academy, blog, billing, support, live updates)
src/routes/admin.js     admin API (every admin screen)
src/routes/integrations.js  "Continue with VooSquare", events API, support API, widget API
src/payments.js         payment providers + webhooks (Gatevoo, Paystack, Flutterwave, Stripe, crypto, bank, custom)
src/netguard.js         blocks server calls to private addresses
src/uploads.js          image uploads (checks, storage in UPLOADS_DIR, serving /u/...)
src/applications.js     invite-only rooms (apply, approve, seats, waitlist)
src/roomart.js          room pictures (uploads, then house artwork) and the app store links
src/tools.js            free tools list, Kill-or-scale rules, saved scenarios
src/routes/media.js     upload and image routes
src/revenue.js          revenue reports (time zone bucketing, CSV, customer spend)
src/referrals.js        referral earnings ledger, payout details and payout requests
src/routes/referrals.js referral and payout API (member and admin)
src/features.js         feature switches (enforced on every route), What's new notes, deactivate and erase
src/backups.js          database backups (download, daily copies, rotation)
src/routes/ops.js       admin Today list and quick search
src/aff/*.js            affiliate program: tracking, commission engine, fraud checks, payouts and receipts, KYC, postbacks, Telegram, contests
src/routes/aff.js       affiliate app API, tracking links (/a/:code, /go/:code), stats API, provider webhooks
src/routes/aff-admin.js affiliate back office (admin, managers, fraud check, finance)
public/affiliate.html   affiliate site shell (affiliate.<domain> and /affiliates)
public/js/admin-ops.js  admin Features, Backups, What's new, Today, quick search, shortcuts
public/js/features.js   feature switches, "back soon" page and What's new card on the site and app
src/mailer.js           email templates, queue and providers
src/seed.js             first-boot data (products, rooms, settings)
src/seed/*.json         Academy courses and blog posts
src/school.js           VooSquare Academy: content loader, pacing, quizzes, exams, certificates, member + admin API
src/pdf.js              tiny PDF writer (certificate PDFs, no dependencies)
src/academy.js          VooSquare Academy's own website (voosquareacademy.com): host routing, public catalog and previews, one-tap switch
public/academy.html     the academy website (landing + /login) · public/js/academy-site.js · public/css/academy.css
public/learn.html       the learner app on the academy site (/learn): the member app in academy mode (app.js, public/css/learn.css)
src/seed/school/        VooSquare Academy content, one JSON file per module (format: docs/SCHOOL_BRIEF.md)
public/js/app-school.js VooSquare Academy in the app: route hero, school/module pages, lesson player, exams, certificates
public/js/admin-school.js admin VooSquare Academy (schools, pacing, reload, lesson JSON editor, certificates, member grants)
src/voice.js            Teaching voice: ElevenLabs/OpenAI adapters, clip queue, MP3 length, /voice/<file>.mp3 serving, admin + member API
public/js/app-voice.js  the narration bar, captions and Listen button in the lesson player; Profile → Lessons switch
public/js/admin-voice.js admin VooSquare Academy → Teaching voice (voice picker, sound, pronunciation, estimate, generate, per-clip edits)
src/emails/*.json       email templates and the welcome series
public/index.html       public website + /login
public/app.html         member dashboard (/app)
public/admin.html       admin (/admin)
public/widget.js        support widget for any website
public/email/           email images and animated GIFs
public/assets/rooms/    house artwork for seeded rooms (<slug>.webp, <slug>-cover.webp); needed at runtime
tools/room-art/         source for the room artwork (not used at runtime; re-render with python3 tools/room-art/render.py)
docs/INTEGRATION.md     how other Zedapex products connect
docs/VOO_CONNECT.md     Voo Connect: the drop-in kit (sdk/voo-connect) and one setup sheet per tool
docs/CHANGING-SAFELY.md the developer's guide to updating without breaking anything or losing data
docs/API_VERSIONING.md  the /api/v1 contract rules (only add)
tools/rehearse-upgrade.js npm run rehearse -- backup.db: try this code on a copy of production data
tools/lock-migrations.js  npm run lock-migrations: freeze a new migration's checksum
```

## Roles
| Role | Can |
|---|---|
| Owner (`*`) | Everything, including making owners |
| Admin | Everything except owner-only actions |
| Support agent | Support inbox for the products you choose, customer lookup |
| Content editor | Top card, announcement bar, display ads only |
| Community moderator | Rooms, rules, pin and delete messages |
| Academy editor | Courses, lessons, blog |
| Finance | Payment methods, orders, approvals, referral payouts |

Permissions are fine-grained in **/admin → Team**.

## Money rule
VooSquare only takes payment for its own Premium membership and paid rooms. It never holds a wallet or balance for the tools; each tool handles its own billing. Referral payouts are sent by the Zedapex team from outside VooSquare and only recorded here (see Referral payouts).

## Referral payouts
Members earn a share of what the people they referred spend: **VooSquare sales** (Premium and paid rooms, status `paid`) plus **tool spend** (`spend` events from every Zedapex tool except Affleego, which runs separately and earns no referral or affiliate commission), counted exactly like Revenue (same exclusions: refunded, failed or pending orders never count; spend from the hub's own key and absurd values are ignored). Zedapex pays all referral earnings centrally, whichever tool the money was spent in.

**Rules** (Admin → Plans and referrals)
- *Rate*: the member's current tier, by number of paying referrals (seed: 1 → 10%, 5 → 20%, 20 → 30%). The current tier applies to **all** their earnings, past and future, so moving up a tier raises the whole balance. A member with no paying referral earns nothing.
- *Settling*: each earning is **pending** for `settle_days` (default 30) after its payment date, then **available**. For tool spend the clock starts when VooSquare **received** the event, so a tool cannot backdate spend past the settling period (`occurred_at` more than 10 minutes ahead is clamped, older than 400 days is refused; see `docs/INTEGRATION.md`). A refund inside that window simply drops the order out.
- *Balance*: available = settled earnings − paid payouts − open requests (never below 0). Rejected and cancelled requests give the money back. If a refund (or a lower tier) drops settled earnings below what was already paid, the difference shows as **owed** and new earnings repay it before anything becomes available again. Amounts are summed exactly (sub-cent tool spend counts) and rounded down to cents only at the end.
- *Minimum*: members can request a payout once available ≥ `min_withdraw` (default $300). A request is always the full available amount; one open request at a time; members can cancel while it says Requested. Payout terms text is editable.
- *Payout details*: one set per member: USDT (TRC20) address (checksum verified, so a mistyped character is refused), bank account or mobile money wallet. Locked while a request is open. Each request keeps a copy of the details it was made with.

**How the team pays** (Admin → Payouts, Business; `payments` permission or owner, with a badge for new requests)
1. Open a request. Copy the address or account details, check the member's earnings by product and history.
2. Optionally **Mark as sending** so the member sees it is in progress.
3. Send the money **from the Zedapex wallet or bank, outside VooSquare**.
4. **Mark paid** with the transaction hash or bank reference (required) and an optional note. The member gets the `payout_paid` email with the reference.
5. Or **Not sent** with a reason: the amount goes back to their available balance and they get the `payout_rejected` email.

**Four eyes**: nobody can mark their own payout as sending, paid or not sent, owners included (the API answers 403). If a team member or the owner requests a payout of their own referral earnings, another staff member with the `payments` permission must handle it, so keep at least two people with that permission.

**Banned referrals**: spend by a referred member who is banned does not count while the ban lasts: it leaves pending and available earnings and the member stops counting as a paying referral. If that money was already paid out, the difference shows as owed and new earnings repay it first. Unbanning restores the earnings. The customer page lists those people as "Excluded: banned".

Statuses: `requested` → `processing` (shown as Sending) → `paid`, or `rejected` (Not sent) / `cancelled` (by the member). Every step is in the audit log. CSV export: `GET /api/admin/payouts.csv?status=`. The customer page shows a Referrals and payouts card for finance. VooSquare never holds, moves or tops up money: there is no wallet; it only keeps the record.

**API**: member `GET /api/me/referrals`, `PUT /api/me/payout-method`, `POST /api/me/payouts`, `POST /api/me/payouts/:id/cancel`; admin `GET /api/admin/payouts?status=requested|processing|paid|rejected|cancelled|open|all&q=`, `GET /api/admin/payouts/:id`, `POST /api/admin/payouts/:id/processing|paid|reject`, `GET /api/admin/customers/:id/referrals`. Code: `src/referrals.js`, `src/routes/referrals.js`.

## Revenue
**Admin → Revenue** (sidebar, Business) shows money in across VooSquare and every Zedapex tool, by day, week or month, for any range up to three years. Finance (`payments`) and `settings` staff see it; support, content and other roles get a 403 and never see the menu item, the spend card on a customer page or the Spent column.

**What counts**
| Source | Counted when | Amount | Shown as |
|---|---|---|---|
| VooSquare sales: Premium and each paid room | the order is **paid** (status `paid`), at `paid_at` | `amount_usd` (USD price at checkout, whatever the member paid in locally) | VooSquare, split by Premium and each room |
| Tool revenue: Spyvoo, Joinvoo, Vooads, Replyvoo, Castvoo, Landvoo, Affleego, Gatevoo and any product added later | the tool sends a `spend` event to the Events API, at `occurred_at` (never later than when it was received) | `value_usd` (> 0) | the tool, labelled "Reported by tool" |

Pending, in-review, failed (rejected), refunded and cancelled orders never count. Other event types (`ftd`, `deposit`, ...) are not revenue. `spend` events sent with the hub product's own key are ignored so VooSquare sales are never counted twice. Tool spend without a Voo ID counts in revenue but not in paying customers.

**Definitions**
- *Paying customers*: members with at least one counted payment in the range. *Avg per customer*: their spend divided by their number.
- *Change*: revenue vs the previous period of the same length that ends the day before the range starts. No previous revenue shows "New this period".
- *Time zone*: days, weeks (Monday to Sunday) and months are cut in the **reporting time zone** (Admin → Settings, default `Africa/Lagos`). An order paid at 23:30 UTC counts on the next day in Lagos (UTC+1). The first and last week or month of a range are clipped to the range.
- All amounts are USD. Local-currency amounts are shown next to recent orders for reference only.

**API** (same permission): `GET /api/admin/revenue?from=YYYY-MM-DD&to=YYYY-MM-DD&group=day|week|month&product=all|voosquare|<slug>&source=all|orders|tools` (or `range=today|yesterday|7d|30d|month|lastmonth|year|12m|all` instead of from/to). The admin page keeps every filter in the address (`/admin#revenue?range=12m&group=month&product=joinvoo&source=tools&compare=1&view=table`), so a view can be bookmarked or shared, and Back steps through earlier views, `GET /api/admin/revenue.csv` with the same parameters (one row per period, one column per product, plus a total row), and `GET /api/admin/customers/:id/spend?range=all|12m|30d` (or from/to) for one member's lifetime spend, split, series and timeline. Daily grouping is limited to 400 days. Code: `src/revenue.js`.

**Chart colours** are fixed per product in stack order (VooSquare, Joinvoo, Vooads, Castvoo, Replyvoo, Landvoo, Affleego, Gatevoo, Spyvoo), validated as one colour-blind-safe palette; admin-added products share an "Other tools" grey in the chart and keep their own icon and name everywhere else.

## Affiliate program
The VooSquare Affiliate Program (lifetime RevShare 20% to 50% by tier, CPA by approval, crypto payouts) runs inside this app: `affiliate.<domain>` and `/affiliates` serve the affiliate site; tracking links are `/a/<code>`. Rules: `docs/AFFILIATE_DECISIONS.md`. API for the front end: `docs/AFFILIATE_API.md`. Connecting tools, DNS, Telegram and end-to-end testing: `docs/AFFILIATE_DEV_GUIDE.md`. Tools send `spend` (on consumption), `refund`, `chargeback`, `plan_started`/`plan_renewed` and `wallet_topup` events (`docs/INTEGRATION.md`, 2b). Team permissions: `aff_admin`, `aff_manager`, `aff_fraud`, `aff_finance`. Feature switch: "Affiliate program". Once a member is an approved affiliate, payments after the approval date are paid by the affiliate program instead of member referral rules (no double commission). Tables: `aff_*`. Tests: `test/affiliates.js`.

## VooSquare Academy website (voosquareacademy.com)
The school also has its own website, for people who only want the lessons. **Same app, same database, same Voo ID, same
progress and certificates**: only the front door differs. Setup on Railway: [docs/DEPLOY-GUIDE.md](docs/DEPLOY-GUIDE.md), Part 6b.

- **Host routing** (`src/academy.js`, called from `server.js`): requests whose Host is `voosquareacademy.com`,
  `www.voosquareacademy.com` or any host in `ACADEMY_HOSTS` (comma separated) get the academy site. `/` is the landing page
  (`public/academy.html`), `/learn` the learner app, `/login` and `/signup` the sign-in page (same email-code flow and APIs as
  VooSquare), `/robots.txt` and `/sitemap.xml` are the academy's own, `/favicon.ico` and `/apple-touch-icon.png` are the
  VooSquare icon. VooSquare-only paths (`/app`, `/admin`, `/affiliates`, `/blog`, `/premium`, `/pricing`, `/community`, `/r/…`)
  redirect to `VOOSQUARE_URL` (default `BASE_URL`). APIs, `/verify/<code>`, `/privacy`, `/terms` answer on both hosts. Outside
  production, `?site=academy` (and `?site=voosquare`) switches a browser between the two for testing.
- **Variables**: `ACADEMY_URL` (default `https://voosquareacademy.com`; links, canonical tags, sitemap, the switch; once set
  explicitly, new certificates print their verify link on it), `VOOSQUARE_URL`, `ACADEMY_HOSTS`.
- **Landing** (cinematic dark, night green and lime): the hero plays the real free lesson silently in a device frame in front of
  the VooSquare crew (sound and captions only after a tap, in the real lesson player); "Choose your vertical" (Trading, iGaming,
  Finance, Nutra, Sweepstakes from the vertical schools' data); the path with real module, lesson and hour counts; every lesson
  arranged as a film library by school (posters from the lesson art); how a lesson works with the real student card and
  certificate; "Join our community" with the real rooms and tools. Every number comes from the content; nothing is invented.
- **Learner app** (`/learn`, `public/learn.html`): the member app with `data-mode="learn"`: only the Academy (school home,
  schools, modules, lessons, quizzes, exams, certificates, Tips, profile and lesson settings) under the VooSquare Academy
  lock-up. Community, Apps, Tools, Premium, billing and support open on VooSquare with the one-tap switch.
- **Public API** (Academy switch applies): `GET /api/academy/catalog` (schools, modules, lesson titles, minutes, slide counts,
  narrators and which lessons are free; never lesson content) and `GET /api/academy/preview/lessons/:id` (only the lessons a
  brand-new free member could open, worked out with the member rules: today lesson 1 of Foundations, plus lesson 1 of an admin
  school open to everyone; no quiz). `/voice/<file>` lets signed-out visitors hear only clips of those lessons, while the
  teaching voice is on.
- **One-tap switch** (sessions are per host): `POST /api/auth/handoff { target: 'academy'|'voosquare', next }` (signed in,
  `x-vs` header, rate limited) returns a single-use link; `GET /auth/handoff?t=&next=` on the other site signs in like a login
  and goes to `next`. The token is 32 random bytes; only its SHA-256 is stored (`auth_handoffs`, migration 010) with the member,
  the target site, the hash of the session that made it and a 60-second expiry. Refused (and burnt): used, expired, made for the
  other site, suspended member, the making session logged out or ended, or "log out everywhere" since. `next` must be a path on
  the same site (no `//`, no backslash, no whitespace or control characters; anything else goes to `/learn` or `/app`). Each
  redemption is in the audit log (`auth.handoff`, refusals `auth.handoff_refused`). `GET /auth/handoff/go?target=&next=` makes
  the switch as a page (signed out: sign up there first, then come back): "Join the community" on the academy for visitors.
- Tests: `test/academy.js` (run by `npm test`).

## VooSquare Academy
The paced course at the top of the Academy: **Foundations → Operator → Scale and Lead**. Each school has modules, each module has lessons (slides, glossary, takeaways, an action, a 5-question quiz) and a 10-question exam. Each school ends with a 25-question final exam and a certificate.

- **Content** lives in `src/seed/school/<school>/<NN>-<module>.json` (format and slide types: `docs/SCHOOL_BRIEF.md`). Files load on every boot and from **Admin → VooSquare Academy → Reload content from files**. Changed lessons update; lessons the team edited in the admin are kept (and marked "Edited"; "Take it from the file again" undoes that); lessons removed from a file are hidden, never deleted, so nobody loses progress. Slugs are IDs: to rename a lesson or module add `"was": ["old-slug"]` next to the new `slug` and everyone's progress moves with it (docs/CHANGING-SAFELY.md, section 8). Bad files are skipped and listed in the load report and the server log (`[school] skipped …`). `SCHOOL_EXTRA_DIR` adds more content folders (tests use `test/fixtures/school`, a module with every slide type).
- **Pacing**: modules open in order. Module N+1 opens when module N's exam is passed **and** `unlock_hours` (setting `school.unlock_hours`, default 20; 0 turns the wait off) have passed since module N opened. Lessons in a module open one after another (pass the quiz to open the next). School 2 needs the School 1 certificate, School 3 the School 2 one.
- **Grading is server-side only**. Members get questions with shuffled options carrying opaque ids (HMAC of the question and option text with the app secret); answers never leave the server until a quiz or exam is passed. Lesson quiz: pass 4 of 5, retry at once (+50 XP the first time). Module exam: 80%, retry after 1 hour (+150 XP). Final: 25 questions drawn from the school's exams and quizzes, 80%, retry after 24 hours (+500 XP). An exam paper opened before a failed attempt can no longer be handed in, so opening several papers at once does not skip the wait.
- **Certificates**: issued on passing a final. PDF (`/api/school/certificates/<code>/pdf`, drawn by `src/pdf.js`), PNG (drawn in the browser), public page `/verify/<code>` (name, certificate, school, date only), LinkedIn links, email `certificate_issued`. Members can change the printed name once. Titles are editable per school.
- **Content made in the admin** (Academy permission; owner how-to in docs/OWNER-GUIDE.md, "Add your own classes"): **Add school** on the VooSquare Academy home, **Add module** on each school card, **Add lesson** on a module page (the slide JSON editor with live preview, starting from a 3-slide template; per-slide `"say"` plus `say_intro` / `say_outro` for the Teaching voice). Rows are marked `source='admin'` (migration 009; file rows are `'file'`) and carry a "Made in admin" pill. A reload from files or a boot never hides, overwrites, renames or reorders them, and a file that uses an admin slug is skipped with a note in the load report. Slugs are made from the title once, unique (lessons per school), never changed and never reused (the recycle bin counts). Admin schools are track `extra`, sorted after every file school, and open to everyone or after one chosen certificate (`school_schools.requires`), so the paced path of the file schools never changes. A module without exam questions is passed when every lesson is; a lesson without a quiz is passed by finishing it; a school with no exam at all has no final and issues its certificate when the last module is done. Admin schools and modules stay hidden from members until they have a published lesson. Delete (to the recycle bin) only while nobody has started it, otherwise switch Published off; file content is never deleted. API: `POST /api/admin/school/schools`, `DELETE /api/admin/school/schools/:id`, `POST /api/admin/school/schools/:id/modules`, `PATCH|DELETE /api/admin/school/modules/:id`, `POST /api/admin/school/modules/:id/lessons`, `DELETE /api/admin/school/lessons/:id` (editing uses the existing `POST /api/admin/school/lessons/:id`). Tests: `test/school-admin.js`.
- **Admin** (Academy permission): publish or hide a school, make it Premium only, certificate titles, hours between modules, reload, edit a lesson's slides/quiz/glossary as JSON with a live preview, certificates (search, revoke, restore), and on a customer's page: progress plus **Open school without the certificate**, **Skip the wait** and **Mark module passed**.
- **Layout (v3)**: the app's **School** page (`#academy`) is the VooSquare Academy home: the main path (Foundations → Operator → Scale), then the five **vertical schools** (free), then a small entry to **Tips** (`#tips`, the classic Academy courses, which are kept as extras outside the school path).
- **Enrolment**: every school starts with an explicit **Enrol** step. It issues the member's student number (`VS-<year>-<5 digits>`, one per member) and an animated student card (face, name, number, school, level, date; Premium mark on Premium schools) that stays on the school page and downloads as a PNG. Module 1's clock starts at enrolment.
- **Vertical schools** (`src/seed/school/v-<vertical>/`, `"school": "v-<vertical>"`): nutra, igaming, trading, finance, sweeps. Free by default (migration 011; any school can be switched to Premium in admin). Members choose a vertical (after "Picking your vertical", or from the school home); the choice is stored and can change. With **Premium members may enrol in any vertical** on (default), they can also enrol in the others. Certificates: "Vertical Specialist — <vertical>".
- **Product and partner slides**: `product {slug, why}` shows the live product card from Admin → Products (hidden products drop the slide). `partner {vertical, note}` shows the partners from **Admin → Academy → Partners** (CRUD per vertical, logo upload, highlights, https link, badge, order, on/off, click counts). Clicks go through `/api/school/partners/<id>/go`. With no partners, members never see the slide; the team sees a placeholder. No partners are seeded.
- **Labs** may carry `labels` to rename fields (`{"rate": "Approval rate", "unit": "approved lead"}`). The funnel lab answer is `{"field": "worst_step", "value": N}`: the 0-based index of the step with the lowest pass-through from the step before.
- Lesson content loads one lesson at a time; school and module pages only use a cached catalog of titles and counts.
- Tables: `school_schools`, `school_modules`, `school_lessons`, `school_progress`, `school_enrollments`, `school_module_state`, `school_attempts`, `school_papers`, `school_grants`, `school_certificates`, `school_students`, `school_prefs`, `school_partners` (created on boot when missing).

## Teaching voice
Every VooSquare Academy slide can be read aloud by a natural AI voice (ElevenLabs by default, OpenAI as a second provider), with captions. **Owner steps: [docs/VOICE_SETUP.md](docs/VOICE_SETUP.md).**

- **Script**: writers add `"say"` to each slide and `"say_intro"` / `"say_outro"` to each lesson in the content files. Missing text is fine: that slide simply has no voice. Narration added to a file also reaches lessons the team edited in the admin (matched by slide type and heading). The team can override any line in **Admin → VooSquare Academy → Teaching voice → a lesson** (marked "Edited here", kept when files reload; "Use the file text" undoes it).
- **Variables**: `ELEVENLABS_API_KEY` (and/or `OPENAI_API_KEY`). Optional: `VOICE_DIR` (default: a `voice` folder next to the database, so `/data/voice` on Railway). Requests go only to `api.elevenlabs.io` / `api.openai.com` through `src/netguard.js`.
- **Settings** (admin, setting `voice`): provider; ElevenLabs voice (picked from your account's list with spoken previews, or a pasted voice ID), model (`eleven_multilingual_v2` default; Flash/Turbo v2.5 cost about half), stability, similarity, style, speed, speaker boost, audio file (`mp3_44100_128` default, down to `mp3_22050_32` for small files); OpenAI model/voice/speaking instructions/speed; price per 1,000 characters for estimates (empty = list price); clips made at once (default 2); pronunciation list (whole words, any case, applied before sending: `VooSquare` → "voo square").
- **Generating**: pick one lesson, a module, a school or everything; the estimate shows clips, characters, cost, audio length and storage before you run. "Missing or changed" skips clips that are current. Files are content-addressed (`sha256(provider, voice settings, spoken text).mp3`), so unchanged lines are never sent twice and the same sentence in two lessons is one file. The queue runs in the server (2 at a time), retries 429/5xx with backoff (honours Retry-After), and stops the run if the key is refused or the quota is used up. Live progress, Stop, and per-clip errors with retry are on the page. A restart drops the queue (clips that were waiting go back to how they were); press Generate again.
- **States**: Ready · Older voice (made before a voice/settings change; members still hear it) · Text changed (members get no audio for it until regenerated, so captions never disagree with the voice) · Not made · Failed.
- **Members**: lessons with clips show **Listen to this lesson**. Nothing plays or downloads before that tap (and then only the current and next clip). The narration bar has play/pause with a progress ring, speed 0.75–1.5×, captions (words light up as they are read), auto-advance, mute; the slide's story bar fills with the clip. Walkthrough slides step through their sub-steps in time with the clip; lab slides wait for the member. Space plays/pauses, C captions, M mute. Members can turn the voice off in **Profile → Lessons**. Feature switch **Teaching voice** (Settings → Features) hides it all without deleting clips. The Profile → Lessons switches only show once clips exist.
- **Clips** are served at `/voice/<file>.mp3` with Range requests (seeking), `Cache-Control: private, max-age=31536000, immutable`, and only to the team or members who can open a lesson that uses the clip (locked or Premium lessons answer 403).
- **Storage**: roughly 1 MB per minute at 128 kbps. The full script (about 350 lessons, roughly 5,500 clips and 45 hours of speech) is about 2.5 GB at 128 kbps, 1.3 GB at 64 kbps, 0.65 GB at 32 kbps. Keep it on the `/data` volume (size it accordingly) or move to object storage (R2) later.
- **Included voice (free):** a narrator rendered ahead of time and uploaded as `.tar` voice packs (Admin → Teaching voice → Included voice pack; `POST /api/admin/voice/pack`, streamed, only `<sha256>.mp3` files kept). It is the default provider when no ElevenLabs/OpenAI key is set. Making packs: `tools/voice-pack/README.md`.
- **Intro music:** one track opens every lesson and fades out under the intro voice (default `public/assets/voo-school-intro.mp3`, or an uploaded MP3 in `<voice dir>/music`, served at `/voice-music/<file>` to logged-in members). Settings: volume, lead and fade, on/off.
- Tables: `voice_clips`, `voice_edits`, `voice_prefs`. Tests: `test/voice.js` (mock TTS server, run by `npm test`) and `test/voice-pack.js` (packs and intro music).

## Turning features on and off
**Admin → Settings → Features** (owner or `settings` permission). Each switch goes live in seconds for everyone, with no rebuild or redeploy. Nothing is deleted: turning an area back on brings back every room, course, post, slide and setting exactly as it was. Each switch saves on its own, and a toast with **Undo** follows it for 6 seconds. Every change is in the audit log (`settings.features`).

| Switch | When it is off, members see | Server |
|---|---|---|
| Community | No Community in the app menu, the bottom bar or on the website | `/api/rooms*`, `/api/messages/*`, `/api/members/*` answer 403 `{ off: "community" }` |
| Academy | No Academy, courses, VooSquare Academy or "Continue lesson" (certificate verify pages stay up) | `/api/courses*`, `/api/lessons/*`, `/api/school*` |
| Blog | No blog section or posts on Home | `/api/posts*` |
| Free tools | No Tools page or tools strip on Home | `/api/tools*` |
| Referrals | No Referrals page and no new payout requests (earnings keep counting, the team still pays from Payouts) | `/api/me/referrals`, `/api/me/payout-method`, `/api/me/payouts*` |
| Support | No Support page and no website widget (the team inbox keeps working) | `/api/support/*`, `/api/widget/*` |
| Premium | No pricing or Premium checkout. Current Premium members keep it | checkout with `item: "premium"` |
| Paid rooms | Paid rooms are hidden from people outside them. Members inside keep access | checkout with `item: "room"`, `/api/rooms/:id/apply` |
| Spotlight ads | No Spotlight slides anywhere | `ads` is empty in every payload |
| Announcement bar | No bar on the site or app | `announcements` is empty |
| Image sharing | No image button for members (the team can still share) | chat uploads and image messages answer 403 |
| Teaching voice | No "Listen to this lesson" and no voice settings in Profile. Clips are kept | `/api/school/voice*` |
| Affiliate program | The affiliate site and dashboard show a "paused" card. Tracking links and provider webhooks keep working, so no earnings are lost | `/api/aff/*` (except `/api/aff/hooks/*` and the Telegram webhook) |
| Pause new sign-ups | New emails see your message instead of a code. Existing members log in as usual | `/api/auth/start` and `/api/auth/verify` answer 403 `{ signups_paused: true }` for unknown emails |
| Maintenance mode | A "back soon" page with your message. Staff still get in and see a thin bar | every member API answers 503 `{ maintenance: true }` for non-staff, except sign-in, `/api/me`, `/api/site`, webhooks, `/api/v1/*` and `/oauth/*` |

The switches are stored in the `features` setting and sent to the website and app as `features` in `/api/site`, `/api/me` and `/api/me/home`. They are enforced on the server for every route (`src/features.js`, `install()` wraps all routes at boot), so a hidden link is never the only protection. Admin APIs are never switched off. Admin API: `GET/PUT /api/admin/features`.

**What's new.** In **Admin → What's new** (`content` permission) you can post a short in-app note (title, one or two sentences, an optional button). It shows once as a card on member Home, live and with no rebuild. Members who close it, or tap its button, do not see it again, and people who join later are not shown old notes. Only the newest live note shows. You can switch a note off, edit it or delete it. Stored in the `release_notes` and `release_seen` tables. API: `GET/POST /api/admin/whats-new`, `DELETE /api/admin/whats-new/:id`, member `POST /api/me/whats-new/:id/seen`.

## Backups
The whole database is one file: `/data/voosquare.db`. Shared images live next to it in `/data/uploads/` and are **not** inside the database file.

**In the admin** (**Settings → Backups**, owner only):
- **Download backup** makes a consistent copy while the app keeps running (`VACUUM INTO` a temporary file), sends it as `voosquare-YYYY-MM-DD-HHMM.db`, then deletes the temporary file. It holds personal data, so keep it private.
- **Daily copies**: one automatic copy a day in `<data dir>/backups` (`/data/backups` on Railway, or set `BACKUPS_DIR`). The first copy is made a minute after the app starts, then every 24 hours. By default the newest **7** are kept (choose 3 to 30). Copies you make with **Keep a copy on the server** count towards that number. Each one has a download button.
- The page also shows the database size and the size of the images folder. Railway volume backups cover both. If you move servers, copy `/data/uploads` too.
- Downloads and manual copies are rate limited (6 every 10 minutes), and each one is in the audit log (`backup.download`, `backup.run`, `backup.settings`, `backup.auto`).
- API: `GET /api/admin/backups`, `GET /api/admin/backups/download`, `GET /api/admin/backups/file/:name`, `POST /api/admin/backups/run`, `PUT /api/admin/backups/settings`. Code: `src/backups.js`.

- **Before every update**: when a new version has a database change to make (and, in production, on every new code version), VooSquare first writes a full copy to `/data/backups/pre-migrate-v<N>-<time>.db`, before anything changes. The newest 3 are kept (`PRE_MIGRATE_KEEP`), separately from the daily ones, and show on the Backups page as "Made automatically before an update". If that copy cannot be made, the database change does not run and the app does not start. See [docs/CHANGING-SAFELY.md](docs/CHANGING-SAFELY.md).

**Restoring** is never done from the web page, on purpose. It throws away everything after the copy, so first ask whether rolling back the last deploy is enough (it usually is, and it loses nothing). To restore:
1. Download the current database (just in case) and copy the exact name of the copy you want from the Backups page.
2. If a bad deploy caused it, roll back to the previous deployment in Railway first.
3. Railway → service → **Variables** → add `RESTORE_FROM=<that file name>`. On the restart, before opening the database, VooSquare saves the current one as `pre-restore-<time>.db`, then puts your copy in place (`src/restore.js`).
4. Check `/healthz` and the admin, then delete the variable (a copy is never restored twice). Full steps: [docs/CHANGING-SAFELY.md](docs/CHANGING-SAFELY.md), section 14.

Without the admin, you can make a copy by hand while the app runs (the image has no `sqlite3` tool, Node does it): `node -e "new (require('node:sqlite').DatabaseSync)('/data/voosquare.db').exec(\"VACUUM INTO '/data/backup.db'\")"` (the target file must not exist yet).

## Updating safely
Updates never cost members anything. In short (developers: read [docs/CHANGING-SAFELY.md](docs/CHANGING-SAFELY.md) before any change):
- **Database changes** are numbered files in `src/migrations/`, run once each in a transaction and recorded in `schema_migrations`. Additive only (add tables, columns, indexes; never drop or rename). A failing one is rolled back and the app refuses to start, so the previous version keeps working on the untouched database. `/healthz` reports the database version.
- **Prices are grandfathered**: members who are paying keep their price and period while their access is active (plus 7 days); every order stores what was sold. Setting: `grandfathering`.
- **School progress** is tied to lesson slugs, never positions. Renames use `"was": ["old-slug"]`; removed lessons are hidden, not deleted.
- **Admin deletes** of content go to a recycle bin (`deleted_rows`); money records and certificates are never deleted.
- **The tool API** (`/api/v1`, `/oauth`) only ever gains fields: [docs/API_VERSIONING.md](docs/API_VERSIONING.md).
- **New features** ship behind a rollout flag (`src/flags.js`): off, team only, a percentage of members, everyone.
- **Rehearse** an update on a copy of production data: `npm run rehearse -- backup.db` (emails and affiliate jobs off).

## Erasing a member's data
Members are never deleted. Orders, revenue and referral history must stay correct. On a member's page in **Customers**:
- **Ban / Unban**: signs them out everywhere and blocks sign-in.
- **Mute**: stops them posting in rooms for a number of hours.
- **Deactivate in community**: hides their messages and profile from members and stops them posting. Their account, purchases and tools keep working. **Show in community again** reverses it.
- **Erase personal data** (owner only, for someone who asks to be forgotten). It has two confirmations: type their email, then type `ERASE`. It replaces their name with "Erased member", their email with `erased-<id>@erased.invalid`, and clears their handle, picture, bio and country. It also removes their payout details, saved scenarios and queued emails, renames them on support conversations, and signs them out for good. Their orders and revenue rows stay, under "Erased member". It cannot be undone, and it is logged as `customer.erase`. Remove someone from the team before erasing them.

API: `POST /api/admin/customers/:id/deactivate { deactivated }` (`customers` permission), `POST /api/admin/customers/:id/erase { confirm: "ERASE", email }` (owner).

## Running the admin day to day
- **Overview → Today** lists what needs you now, each item with one button: open conversations, room applications, payout requests, orders to approve, email not set up, maintenance or paused sign-ups, areas that are off, and backup status (`GET /api/admin/today`).
- **Quick search**: Ctrl/Cmd + K (or `/`) finds members, rooms, products, courses, posts, pages and settings (`GET /api/admin/search?q=`). Press `?` to see every shortcut. `G` then a letter jumps to a section (G O Overview, G S Support, G C Customers, G T Settings, G F Features...).
- Editors warn before you leave with unsaved changes. Deleting a canned reply, a Spotlight slide or an announcement line, or hiding a product, shows **Undo** for 6 seconds.

## Images
Members can share one image per message in community rooms, add a screenshot to a support message, and add a payment screenshot as proof. The team can send images in support replies.

**Why it stays fast and cheap**
- The browser shrinks every image before upload: at most 1600 px on the long side, WebP (JPEG on old browsers), about 350 KB, plus a ~480 px thumbnail (about 40 KB). Re-encoding also strips EXIF data such as GPS location.
- The server accepts only JPEG, PNG and WebP, checked by the file's first bytes (never by the file name or Content-Type). No SVG, no GIF. Limits: 600 KB per image, 80 KB per thumbnail.
- Rooms show the thumbnail in a fixed-size box (no page jumps) and load it lazily. The full image loads only when someone taps it.
- Images are served with `Cache-Control: immutable` for a year, so each one is downloaded once per device.
- Limits: 30 images per member per day and 200 MB per member by default (Admin → Community → Images), plus a per-minute limit. Muted members cannot share. Each room has a "Members can share images" switch; the global setting can limit images to Premium members or the team.

**Where they are stored**
- Files: `UPLOADS_DIR` (default: the folder of the database + `/uploads`, so `/data/uploads` on Railway). Records: the `uploads` table.
- Chat images are public to anyone with the (unguessable) link. Support screenshots and payment proofs need the right login (the author, support staff for that product, or finance).
- Deleted messages hide their image at once; files are removed from disk 7 days later. Images that were uploaded but never sent are cleared after 24 hours.
- Space used shows in Admin → Community → Images and Admin → Settings. As a rough guide, 10,000 shared images take about 3.5 GB.

**Moving to Cloudflare R2 or S3 later**
When the volume gets large, keep the same URLs (`/u/<id>.<ext>`) and change only where the bytes live: in `src/uploads.js`, write files to the bucket in `create()` (same key `<id>.<ext>` and `<id>_t.<ext>`), and in `serve()` either stream from the bucket or redirect chat images to the bucket's public CDN address (support and proof images should stay behind the login check, for example with short-lived signed URLs). Copy the existing `/data/uploads` folder to the bucket once with `rclone copy`. Nothing in the database has to change.

## Payment methods
Admin → Payments → **Add payment method** offers Gatevoo, Paystack, Flutterwave, Stripe, crypto wallets, bank transfer, custom manual methods (any method: mobile money, agents, ... with up to 6 copyable detail rows and a choice of proof) and custom APIs (JSON body template, amount in USD or local currency, minor units). You can add several of any kind, reorder, duplicate, switch them on and off, and delete methods that have no orders. Secrets are never shown again after saving.
**Gatevoo**: see `docs/GATEVOO.md` for the API Gatevoo must provide and a prompt for Gatevoo's builder.
Server-side calls to addresses typed into the admin (custom API URLs, the Gatevoo address) only go to public https hosts: private, local and cloud metadata addresses are refused after DNS lookup, redirects are not followed, and replies are capped in time and size. (`ALLOW_PRIVATE_OUTBOUND=1` lifts the private-address check for local testing only.)

## Security headers and live updates
- Every response carries a Content Security Policy (set in `server.js`): scripts only from this site (no inline scripts or `onclick=` handlers; put new code in `/public/js/`), styles from this site, inline style attributes and Google Fonts, images from this site, `data:`, `blob:` and any https address (the admin accepts https image links), connections to this site only, and no framing (`frame-ancestors 'none'`, `X-Frame-Options: DENY`). Also `Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy` that turns off camera, microphone and geolocation, and HSTS in production. The support widget runs on other websites as a script (no iframe), so the policy does not affect it. If you add a third-party script or embed, add its host to `CSP` in `server.js`.
- Live updates (`/api/stream`): banning a member, logging out or a session ending closes that member's open streams at once, and every open stream is re-checked every 60 seconds (`STREAM_RECHECK_MS`): an expired session or lost access to a room or staff channel closes it. The browser reconnects and only gets what it may still see.
- Room presence: "N online" in a room and "here now" on the community home count the distinct signed-in people with the room open (several tabs count once). Changes are broadcast as a count only (`presence` on the `community` channel, about 1.5 seconds after a change), never names.
