# VooSquare build brief (shared by everyone working on this repo)

## The product
VooSquare is the hub for media buyers and big performing operators, built by **Zedapex** (Lagos). Slogan: **"Media buying, squared."**
One free account (a **Voo ID**) opens every Zedapex tool, a community, an Academy and the blog. Premium is $20/month.

**Founder: Dchessking** (Ejiro). A media buyer. He spent a lot on research, burnt money the wrong way, learned what works and what every buyer needs, and now runs a large paid-traffic operation at Zedapex across Nigeria, Kenya, South Africa, Ghana and Cameroon (trading and iGaming verticals). His philosophy is **traffic banking**: treat lead acquisition as capital, not cost. Former economics and maths teacher.

## The Voo system (funnel stages, in order)
| Stage | Tool | What it does | Offer |
|---|---|---|---|
| Research | **Spyvoo** (spyvoo.com, live, blue and white brand) | Ad spy: search live Facebook and Instagram ads from every country, see which have run for months and why they work, AI breakdown of every hook, then launch your own angle. TikTok support soon. Works worldwide | Start free |
| Monetize | **Affleego** (affleego.com, own yellow brand, "by Zedapex") | Premium CPA and RevShare deals in finance, sports and casino | Zedapex platform |
| Acquire | **Vooads** (renamed from Advoo) | AI ad creatives: videos, images and hooks in every size; writes and voices ads in Pidgin, Swahili and French; checks ads against Meta's rules before you spend; pay-as-you-go credits; works worldwide | First ads free |
| Acquire | **Landvoo** | Landing pages built to pass review and convert paid traffic | Coming soon |
| Track | **Joinvoo** (joinvoo.com, live) | Tracks every real Telegram join, sign-up and deposit; sends them server-side to Meta, TikTok and Snapchat so ads buy quality, not noise. $30/mo incl. 2,000 tracked joins; Pro $99/mo adds deposits, ROAS, cost per FTD | First 500 joins free |
| Convert | **Replyvoo** | AI Closers answer every Telegram chat in seconds, qualify leads, send the payment link; website chat widget | 30 free chats a month |
| Retain | **Castvoo** | Telegram broadcasts and drip sequences; welcomes, follows up, sends each group the message written for them | 7 days free |
| Collect | **Gatevoo** (gatevoo.com, black and white brand) | The checkout behind the Voo family: USDT and Bitcoin, straight to your wallet | Coming soon, waitlist |

New tools can be added by admins at any time; UI must render unknown products generically (name, icon key or image URL, colour, tint, stage, status, tagline, offer, url).

## Plans
- **Free for life**: Voo ID for every tool, free community rooms, free Academy courses, the blog, support for every tool.
- **Premium, $20/month** (price, features and period are editable in admin): premium rooms (Buyers' Lounge, Scaling Desk, Offer Drops, Creative Reviews), every Academy course including advanced tracks, a monthly live campaign breakdown with Dchessking plus replays, templates and playbooks, priority support, Premium badge and early access to new tools.
- **Paid rooms** are sold separately. A paid room can be **invite only** (members apply, the team approves, then they pay within 7 days; optional seat limit). Seed: "Inner Circle with Dchessking", invite only, 25 seats, $299/month.
- **Rule:** VooSquare never holds a wallet or balance for the tools and never has top-ups. It only takes payment for its own Premium and paid rooms. Tools handle their own billing.

## Brand and design
- Approved design reference: `/home/claude/voosquare.html` (the user likes it; keep its look). White + VooSquare green (#00A86B / #12C784 / deep #00774B), lime accent #C9F65B, dark green "night" (#0A1611) for the app sidebar and dark sections.
- Fonts: Plus Jakarta Sans (800 for headings, tight letter-spacing -0.045em), Instrument Serif italic for accents, JetBrains Mono for small labels.
- Lots of tasteful motion: animated cartoon people (VS.avatar), coins, live counters, blinking faces. Respect prefers-reduced-motion.
- Must be sleek, beginner friendly, fast, easy to navigate and mobile first (test at 390px). The user rejects anything that looks AI-generated or childish: no emoji as decoration, no generic gradients on everything, no "rocket" hype.
- Shared code: `/public/css/shared.css` (tokens, buttons, pills, inputs, cards, modals, toasts) and `/public/js/shared.js` (`window.VS`: api, icon, productIcon, avatar, founder, authorAvatar, bot, toast, confetti, countUp, stream, copyText, fillIcons, timeAgo...). Lesson visuals: `/public/js/lesson-visuals.js` (`window.VSL.render(step)`, `VSL.animate(el)`) + `/public/css/lesson.css`.
- Room pictures: every seeded room has house artwork in `public/assets/rooms/<slug>.webp` (512 square) and `<slug>-cover.webp` (1200x400), drawn as SVG in `tools/room-art/art.js` and rendered with `python3 tools/room-art/render.py`. Uploads (purpose `room`, admin room editor) win over the artwork; `A.roomChip(room)` and `A.roomCover(room)` show them. App store buttons come from the `apps` setting (Site content, App stores); never draw Google's or Apple's badges.
- Product icons: `VS.productIcon(product, 'xs'|'sm'|'md'|'lg'|'xl')`; SVG files in `/public/assets/icons/<key>.svg`; logo `/public/assets/logo-icon.svg`, `logo-light.png`, `logo-dark.png`.

## Writing rules (all copy)
Plain, specific, active voice, short sentences. Write from the reader's side. No hype words (revolutionary, game-changer, unlock, supercharge, leverage, seamless, cutting-edge), no emoji, no em-dash asides, no "not X but Y" constructions, no scare quotes. Never invent statistics or results presented as real; any example number is labelled "Example" or "Illustration". Never promise income or profits. Trading and gambling: remind people to follow the law and the ad platform's rules in every country they run. Quotes attributed to Dchessking are drafts he will approve: keep them grounded in what is written above.

## Backend (done; read the source for exact shapes)
Zero-dependency Node 22 server (`server.js`, `src/`), SQLite via `node:sqlite`, live updates via Server-Sent Events.
- Every mutating `/api/*` call must send header `x-vs: 1` (VS.api does this).
- Member APIs: `src/routes/app.js`. Admin APIs: `src/routes/admin.js`. Integrations (OAuth "Continue with VooSquare", events API, support API, widget API): `src/routes/integrations.js`. Payments: `src/payments.js`. Auth helpers + permission list: `src/auth.js`. Seeds: `src/seed.js`.
- Live channels (`VS.stream([...], handlers)`): `room:<id>` (message, delete, react, pin), `ticket:<id>` (message, status), `staff` (ticket, order), `user:<id>` (activity, support, order), `community` (activity, rooms, site, presence `{room_id, online}`). A stream also gets `bye` when the server closes it (logout, ban, expired session). Content Security Policy: no inline scripts or `on*=` handlers anywhere (see README, Security headers).
- Run a private test server: `cd /home/claude/voosquare-app && DATABASE_PATH=/tmp/claude-0/<you>.db PORT=<port> OWNER_EMAIL=owner@test.com node --disable-warning=ExperimentalWarning server.js &`
  Log in by API: POST /api/auth/start {email,name} returns `dev_code` when email is not configured; POST /api/auth/verify {email, code} sets the session cookie (`vs_sess` over http, `__Host-vs_sess` over https; name in `config.sessionCookie`). In Playwright you can do the same with `page.request` then load pages. Chromium is at /opt/pw-browsers (Python playwright is installed).
- No npm installs are possible in this environment (registry blocked). Use only browser built-ins and the shared files.
