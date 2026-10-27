# VooSquare Academy — writer brief

VooSquare Academy is the structured, multi-week course inside VooSquare Academy. Three schools, taken in order. Each module unlocks one day after the previous one is finished, so nobody can finish in a day. Every lesson ends with a quiz; every module ends with an exam; every school ends with a final exam and a downloadable certificate. The third school's certificate is the "Certificate of Completion".

Audience: complete beginners ("baby media buyers") in Africa first (Nigeria, Kenya, Ghana, South Africa, Cameroon) but global examples are welcome. Many will read on a phone. Plain English, short sentences, no jargon without an explanation the first time it appears.

## Voice (from docs/BRIEF.md — follow it)
- Specific and practical. Numbers, worked examples, real decisions.
- No hype, no exclamation marks, no "unlock / supercharge / game-changer / skyrocket", no em-dash asides.
- Never promise income. Use "Example" on every figure that is illustrative.
- Teach the honest way: platform policies, local law, consent, real people. Never teach cloaking, fake reviews, fake scarcity, stolen creatives, account farming, policy circumvention, bonus abuse or misleading claims. When a vertical is regulated (trading, gambling, finance, health), say plainly that ads usually need platform authorization and must follow local law, and the reader must check both before running.
- Platform details change (button names, objectives, limits). Teach the principle, and when you name a specific setting add "names change; check the current Ads Manager" or similar. Do not invent statistics. If you give a benchmark, label it "rough guide, varies by geo and vertical".
- Instructors: lessons are presented by the "VooSquare Academy team". You may add at most one `quote` step per module attributed to Dchessking (the founder); keep it modest and practical. These quotes are drafts the founder will approve.

## Output format (one JSON file per module)
Path: `src/seed/school/<school-slug>/<NN>-<module-slug>.json` (NN = 01, 02, ...).

```json
{
  "school": "foundations",
  "order": 1,
  "slug": "how-the-money-works",
  "title": "How the money works",
  "summary": "Two sentences on what this module teaches and why it matters.",
  "lessons": [
    {
      "slug": "what-affiliate-marketing-is",
      "title": "What affiliate marketing is",
      "minutes": 12,
      "objectives": ["By the end you can ...", "...", "..."],
      "steps": [ { "v": "big", "h": "Slide title", "p": "Teaching text", "more": "Optional longer explanation", "d": { } } ],
      "takeaways": ["...", "...", "..."],
      "action": "One concrete task to do today.",
      "glossary": [ { "term": "CPA", "def": "Cost per action ..." } ],
      "quiz": [ { "q": "...", "options": ["A","B","C","D"], "answer": 1, "why": "Why the answer is right and the others are not." } ]
    }
  ],
  "exam": [ { "q": "...", "options": ["A","B","C","D"], "answer": 0, "why": "..." } ]
}
```

### Lesson rules
- 5 lessons per module (unless told otherwise). 10 to 16 slides (`steps`) per lesson. `minutes` 10–20.
- `h` ≤ 60 characters. `p` is the main teaching text: 25–90 words, plain, one idea per slide. `more` (optional) is a deeper explanation shown under the slide: up to 180 words; use it for worked examples and "why".
- Mix slide types; use a visual whenever the idea has a shape. At least 4 different types per lesson. Every lesson should include at least one worked example with numbers.
- `quiz`: exactly 5 questions per lesson, 4 options each, one correct, plausible distractors, `answer` is the 0-based index. Vary the correct position. `why` explains the right answer in 1–2 sentences.
- `exam`: 10 harder questions per module covering all its lessons (scenario style: "You spent $60, 0 FTDs, target CPA $25. What do you do?").
- `glossary`: 2–6 new terms introduced in that lesson.
- Valid JSON only (no comments, no trailing commas). Use straight quotes inside strings escaped properly.
- **Slugs are IDs.** Members' progress is tied to the school, module and lesson slugs, never to the position in the file. Never change a slug that has shipped and never reuse an old one. To rename, keep the old one in `"was"`: `"slug": "new-name", "was": ["old-name"]` (works for lessons and modules; keep it in the file for good). Removing a lesson hides it (progress kept). Details: `docs/CHANGING-SAFELY.md`, section 8.

### Slide types (`v`) and the exact shape of `d`
| v | d shape | use for |
|---|---|---|
| `big` | `{"b": "Big statement", "s": "Small line under it"}` | a key idea |
| `stat` | `{"n": 1.4, "pre": "$", "suf": "", "dec": 2, "label": "returned per $1", "note": "Example."}` | one number |
| `flow` | `["Step 1", "Step 2", "Step 3", "Step 4"]` (3–6 items, short) | a sequence |
| `eq` | `["Payout", "×", "FTD rate", "=", "Max per join"]` | a formula |
| `check` | `["item", "item", "item", "item"]` (3–6) | checklist |
| `quote` | `"Quote text"` (string) | Dchessking quote (max 1 per module) |
| `bars` | `[["Label", 38, "$1.10"], ["Label", 100, "$2.90"]]` (value 0–100 = bar length, third = display text) | comparing items |
| `funnel` | `[["Clicks", 1000], ["Joins", 300], ["Deposits", 18]]` | funnel counts |
| `cards` | `["Title|short line", "Title|short line", "Title|short line"]` (3–6) | grouped concepts |
| `curve` | `{"a": [..7 numbers..], "la": "Line A", "b": [..7 numbers..], "lb": "Line B", "x": ["D1","D2",...]}` | change over time |
| `compare` | `{"a": {"title": "Wrong way", "items": ["..",".."]}, "b": {"title": "Right way", "items": ["..",".."]}}` | contrast |
| `chat` | `[{"from": "lead", "text": ".."}, {"from": "ai", "text": ".."}]` (from: `lead`, `ai` or `buyer`) | conversation example |
| `table` | `{"cols": ["Metric", "Formula", "Example"], "rows": [["CTR", "Clicks ÷ Impressions", "1.8%"]]}` (≤ 4 cols, ≤ 7 rows, short cells) | reference tables |
| `tip` | `{"kind": "tip" | "warn" | "example", "text": "Short note"}` | warnings, worked examples |

## Curriculum (titles are guides; you may refine lesson titles, keep module scope)

### School 1 — `foundations`: Media Buying 101 (beginner)
1. `how-the-money-works` — Affiliate marketing: the players (advertiser, network, affiliate, traffic source, user); payout models (CPA, CPL, RevShare, hybrid, CPI); verticals overview (trading, iGaming, finance, sweepstakes, nutra, e-commerce, apps) and which are regulated; how networks approve, hold and pay; caps, geos, KPIs; reading an offer page and choosing a first offer.
2. `traffic-101` — What traffic is; sources (paid social: Meta, TikTok, Snapchat; search; native; push; pops; influencers; Telegram; organic/SEO); intent vs interruption; the ad auction (CPM, CPC, bids, relevance); cost drivers; picking a first source for a small budget.
3. `the-numbers` — Metrics: impressions, reach, frequency, CPM, CTR, CPC, CR, CPL, CPA/CPFTD, EPC, ROI vs ROAS, LTV, break-even; worked examples end to end; a daily tracking sheet.
4. `funnels` — Direct link vs prelander vs lead form vs Telegram funnel; message match; landing page basics (speed, mobile, one action); trust and honesty; where people drop and why.
5. `tracking-basics` — UTMs, click IDs, pixels, conversions API, postbacks (S2S), attribution windows, why platform and network numbers differ, minimum tracking setup for a beginner.
6. `compliance-and-safety` — Ad policies (restricted categories, authorization for gambling/financial ads where required), local law and age limits, honest claims, privacy and consent, account health and payment methods, spotting fake networks and scams, protecting yourself.
7. `first-campaign` — Account setup, budget planning (test budget), simple campaign structure, creative basics, launch checklist, the first 72 hours, kill / hold / scale decisions with rules.
8. `operator-habits` — Bankroll and risk, testing budget as tuition, record keeping, taxes basics (consult a professional), learning routine, avoiding burnout, building a portfolio of results. (This module closes School 1.)

### School 2 — `operator`: The Operator (intermediate)
1. `offers-and-verticals` — Deep dive on trading and iGaming (regulation, KYC, FTD, deposits, RevShare math, baseline vs qualified FTD), finance, sweepstakes, e-commerce; evaluating offers; negotiating payouts; network relationships, managers, caps and holds.
2. `meta-in-depth` — Campaign structure, objectives, conversion events, audiences (broad vs interests vs lookalikes), automated campaign types, placements, learning phase, budget at campaign vs ad set level, bidding strategies, rules. Principles first; names change.
3. `creative-strategy` — Hooks, angles, formats (UGC, talking head, demo, static), the first 3 seconds, testing frameworks, fatigue, iterations, localisation and languages, writing honest copy, using AI tools responsibly.
4. `landers-and-telegram` — Prelanders, quizzes, advertorial ethics, Telegram channels and groups, join requests, bots, welcome flows, broadcasts and drips, retention and reactivation.
5. `tracking-advanced` — Trackers, server-side events, conversions API, deduplication, mapping postbacks to events, optimising for FTD vs lead, data quality, bot and fraud filtering.
6. `testing-and-data` — Test design, sample size and patience, variables, kill rules, reading results without fooling yourself, dashboards and weekly reviews.
7. `geo-strategy` — Tier 1/2/3, Africa geos in detail (language, payment methods, devices, timing), localisation, regulatory differences, expanding geo by geo.

### School 3 — `scale`: Scale and Lead (advanced, final)
1. `scaling-mechanics` — Vertical vs horizontal scaling, budget step sizes, duplication, new audiences/geos/creatives, when not to scale, protecting ROI while scaling.
2. `infrastructure-and-risk` — Business accounts, ad account health, verified identities, payment methods and limits, appeals, backups that follow platform rules (never circumvention), compliance at scale, legal entity basics.
3. `team-and-operations` — Hiring and training buyers, SOPs, reporting cadence, creative production pipeline, tools stack, delegation and incentives.
4. `money-and-unit-economics` — Cash flow and payment terms, net terms and holds, LTV and payback, profit vs revenue, reinvestment rules, currency risk, taxes and accounting basics (consult a professional).
5. `retention-and-ltv` — CRM, lifecycle messaging, broadcasts, reactivation, RevShare compounding, community building, measuring LTV.
6. `capstone` — Building a full campaign plan end to end (offer, geo, source, funnel, tracking, budget, creatives, rules, reporting), reviewing it like a manager, a 30-day plan, and what to do next. Only 4 lessons here; the 5th slot is the final exam handled by the app.

## Realistic slide types (v2 — use these generously; they make the school feel real)
Lessons may now have **10 to 18 slides**. Aim for at least 2 realistic slides (`phone`, `screen`, `walk`, `map`, `code` or `lab`) per lesson wherever they fit. These render as lifelike, animated mock-ups (no real brand logos; generic "Telegram-style" chat, "Ads Manager-style" screens).

| v | d shape | use for |
|---|---|---|
| `phone` | `{"app": "chat" \| "browser" \| "bot", "title": "BotFather", "subtitle": "bot", "messages": [{"from": "me" \| "them", "text": "/newbot", "buttons": ["Start", "Join"]}], "url": "only for app=browser", "page": {"h": "Headline", "p": "Text", "cta": "Button"}}` | realistic phone: a chat (messages type in one by one) or a mobile page (`app: browser` uses `url` + `page`) |
| `screen` | `{"kind": "browser", "url": "adsmanager.example/create", "title": "Create campaign", "blocks": [{"type": "field", "label": "Campaign name", "value": "NG_Trading_Test_01"}, {"type": "select", "label": "Objective", "value": "Sales"}, {"type": "toggle", "label": "Advantage budget", "on": false}, {"type": "radio", "label": "Bid strategy", "options": ["Highest volume", "Cost per result goal"], "value": 0}, {"type": "text", "value": "Helper text"}, {"type": "table", "cols": ["Ad set", "Spend", "Results"], "rows": [["A", "$20", "2"]]}, {"type": "button", "label": "Publish"}], "highlight": 1}` | a desktop/web app screen with the important control pulsing (`highlight` = block index) |
| `walk` | `{"steps": [{"title": "Open BotFather", "text": "Search @BotFather and tap Start.", "screen": { a phone or screen d object, plus "v": "phone" or "screen" }}]}` (2–7 steps) | click-by-click walkthroughs; learner taps Next |
| `map` | `{"nodes": [{"id": "ad", "label": "Meta ad", "kind": "ad"}, {"id": "lp", "label": "Prelander", "kind": "page"}, {"id": "tg", "label": "Join request", "kind": "telegram"}, {"id": "bot", "label": "Welcome bot", "kind": "bot"}, {"id": "offer", "label": "Broker sign-up", "kind": "offer"}, {"id": "pb", "label": "Postback", "kind": "data"}], "edges": [["ad", "lp", "click"], ["lp", "tg", "join"]]}` (≤ 9 nodes; kinds: ad, page, telegram, bot, offer, data, person, money, tool) | funnel / system flow diagrams with moving dots |
| `code` | `{"lang": "text" \| "url" \| "json" \| "js" \| "bash", "text": "https://api.telegram.org/bot<TOKEN>/getMe", "note": "optional one-liner"}` | tokens, URLs, postbacks, tiny code |
| `lab` | `{"kind": "breakeven" \| "roas" \| "killscale" \| "budget" \| "funnel" \| "utm" \| "verticalpicker", "task": "What is the most you can pay per lead?", "preset": { inputs }, "answer": {"field": "max_cpl", "value": 10, "tolerance": 0.05}}` | interactive practice; learner types numbers and checks the answer. Preset/answer fields: breakeven {payout, cr_pct, margin_pct} → max_cpl / max_cpa; roas {spend, revenue} → roas, profit; killscale {spend, conversions, target_cpa, days} → verdict ("kill"\|"hold"\|"scale"); budget {goal, target_cpa, days} → daily_budget; funnel {steps: [["Clicks",1000],...], payout} → worst_step (index); utm {base, source, medium, campaign} → (no answer, free build); verticalpicker {} → (no answer; it asks budget, risk, geo, skills and suggests verticals with reasons) |
| `photo` | `{"src": "assets/school/<file>.webp", "alt": "...", "caption": "..."}` | only if an image file exists; do not use unless told |

Telegram facts to get right (check wording, keep "at the time of writing" where needed): bots are created in the official @BotFather chat with /newbot; the bot username must end in "bot"; BotFather returns an HTTP API token that must be kept secret; /setdescription, /setabouttext, /setuserpic, /setcommands customise the bot; a bot must be added as an admin of a channel with permission to invite users to approve join requests; invite links can be created with "request admin approval"; the Bot API receives `chat_join_request` updates and approves with `approveChatJoinRequest`; while a join request is pending the bot may message the user privately (a short window, at the time of writing 5 minutes); bots receive updates by long polling (`getUpdates`) or webhook (`setWebhook`); bots can't message people who never started them (except that join-request window); respect rate limits.

## Owner's quality rules (v3 — apply to EVERY lesson, new and existing)
Quality over speed. A beginner should be able to go from zero to running their own campaigns using only this school (never promise profit; say results vary). Do not compress: if a topic needs more lessons, say so in your report.

Every lesson must contain, clearly visible as slides:
1. **Why** it matters (the money or risk at stake).
2. **Real numbers**: at least one worked example with figures, labelled Example, maths checked.
3. **A walkthrough** of how to actually do it (a `walk`, `screen`, `phone`, `code` or numbered `flow`/`check`) — click-by-click where a tool is involved.
4. **Common mistakes** (a `compare` or `cards` slide of mistakes and fixes).
5. **Compliance** note where relevant (one `tip` with kind `warn` is enough when the lesson touches ads, claims, data, regulated offers).
6. **Decision rules** where relevant: exact kill / keep / scale rules with numbers (e.g. "Kill an ad set when spend ≥ 2 × target CPA with 0 FTDs"; "Scale +20% after 3 days at CPA ≤ 0.8 × target with ≥ 3 conversions"), labelled as starting rules to adapt.
7. **Task**: the `action` field — one concrete thing to do today.
8. **Quiz**: 5 questions.

**Uncertainty rule:** if you are not sure about a current Meta (or TikTok, Telegram, network) policy, setting name, limit or feature, say so plainly on the slide ("We are not certain this is current; check Meta's Help Center / Ads Manager before relying on it."). Never guess.

## Product and partner cards (v3)
| v | d shape | use for |
|---|---|---|
| `product` | `{"slug": "joinvoo", "why": "One line on why this tool helps with what the lesson just taught"}` — slugs: spyvoo, joinvoo, vooads, replyvoo, castvoo, landvoo, affleego, gatevoo, voosquare | Recommend a VooSquare/Zedapex tool at the moment it's useful (e.g. Spyvoo when researching angles, Joinvoo when tracking Telegram joins, Vooads for creatives, Replyvoo for answering leads, Castvoo for broadcasts, Landvoo for landers, Affleego for finding offers, Gatevoo for getting paid in crypto). The app renders the live product card with its current link (editable in admin). Max 1 per lesson, only where genuinely useful, never as the only way to do something. |
| `partner` | `{"vertical": "trading", "note": "One line on what to look for in a partner"}` — verticals: nutra, igaming, trading, finance, sweeps, general | Shows the owner's admin-managed partner cards (networks/advertisers) for that vertical with links. Use in lessons about choosing offers/networks. |

## Vertical schools (v3, Premium only)
After "Picking your vertical", Premium members choose a vertical and enter a deeper, bigger school for it. Each vertical school has 6 modules × 5 lessons (12–18 slides each), same format, path `src/seed/school/v-<vertical>/NN-<module>.json` with `"school": "v-<vertical>"`. Verticals: `v-nutra`, `v-igaming` (sports betting + casino), `v-trading` (forex/CFDs, crypto exchanges; binary options are banned on most platforms and in many countries — teach that and steer away), `v-finance` (loans, credit cards, insurance, banking lead gen), `v-sweeps` (sweepstakes, SOI/DOI lead gen, CPL offers).

## Narration (teaching voice)
Each slide may carry `"say": "..."` (what the voice reads while the slide shows) and each lesson `"say_intro"` and
`"say_outro"`. All optional: a slide without `say` has no voice. Write for the ear (short sentences, numbers as words,
letter acronyms spaced like "C P A", no SSML). The loader keeps these even for lessons edited in the admin. Generating
the audio and the owner's setup: docs/VOICE_SETUP.md.
