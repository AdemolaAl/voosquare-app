# VooSquare Affiliates: developer guide (step by step)

This guide is for the developer who connects the affiliate program to VooSquare's site and to every Zedapex tool, and puts it live. Read it top to bottom once. Program rules: `docs/AFFILIATE_DECISIONS.md`. API: `docs/AFFILIATE_API.md`. Tool events: `docs/INTEGRATION.md` section 2b.

---

## 1. What is already built

Everything runs inside the VooSquare Node app. There is no second server and nothing to install.

| Part | Where |
|---|---|
| Tracking links `/a/<code>` and `/go/<code>`, the 60-day cookie, attribution at Voo ID creation | `src/aff/tracking.js` |
| Commission engine (RevShare, CPA, Hybrid, holds, refunds, tiers, health, sub-affiliates) | `src/aff/engine.js` |
| Duplicate and fraud checks | `src/aff/fraud.js` |
| Payouts, four eyes, receipts (PDF), statements, payout provider adapter | `src/aff/payouts.js` |
| KYC adapter | `src/aff/kyc.js` |
| Postbacks | `src/aff/postbacks.js` |
| Telegram alerts bot | `src/aff/telegram.js` |
| Contests | `src/aff/contests.js` |
| Program: applications, managers, deals, announcements, creatives, settings | `src/aff/program.js` |
| Hourly jobs (qualification catch-up, admin-set holds, tiers, health, retries) | `src/aff/jobs.js` |
| APIs | `src/routes/aff.js` (affiliate app, stats API, webhooks), `src/routes/aff-admin.js` (back office) |
| App shell | `public/affiliate.html` (the front end mounts here) |
| Tests | `test/affiliates.js` (run by `npm test`) |

Database tables all start with `aff_` and are created on boot.

## 2. How a customer is tracked, start to finish

1. An affiliate shares `https://voosquare.com/a/k3x9p?p=joinvoo&sub1=fb_ng_v3&click_id={clickid}`.
2. A visitor clicks. VooSquare saves the click, sets the cookie `vs_aff` on `.voosquare.com` for 60 days and redirects to `https://joinvoo.com/?ref=k3x9p&vclick=AbC123&sub1=fb_ng_v3`.
3. The visitor taps **Start free** on Joinvoo. Joinvoo sends them to `https://voosquare.com/oauth/authorize?...&prompt=signup&ref=k3x9p&vclick=AbC123` (the tool passes `ref` and `vclick` through; see the checklist below).
4. The visitor creates a Voo ID. At that moment VooSquare locks the customer to the affiliate **for life**. If the person already had a Voo ID, nothing is attributed.
5. The customer pays inside Joinvoo. Joinvoo sends a `spend` event. VooSquare creates the commission, **available at once** (no hold by default; "waiting for activation" until the affiliate's 5th qualified customer), tells the affiliate (dashboard, Telegram, postback) and counts the payment.
6. That first payment also makes the customer **qualified** straight away: it counts for tiers, contests, activation, health and CPA (a product can ask for a second payment instead).
7. The affiliate requests a payout of the available balance; finance sends USDT or BTC and marks it paid with the transaction hash; the affiliate downloads the PDF receipt.

VooSquare's own sales (Premium, paid rooms) are counted from VooSquare orders automatically. Inner Circle earns 0%.

## 3. What each tool must do (checklist)

Every tool already signs in with "Continue with VooSquare" and sends events (`docs/INTEGRATION.md`). For the affiliate program, add these. Give the tool's AI builder the prompt in `docs/INTEGRATION.md` (it now includes the affiliate lines) plus the tool's own lines below. Easiest: use the **Voo Connect** kit (`sdk/voo-connect/`), which does the `ref`/`vclick`/`coupon` hand-off, the money events and the checks for you; each tool's setup sheet and ready prompt are in [`docs/VOO_CONNECT.md`](VOO_CONNECT.md), and `node sdk/voo-connect/check.js` self-tests a tool's settings.

**Common to every tool**
- [ ] On every landing page, read `ref`, `vclick` and `coupon` from the URL and keep them (cookie or session) until login.
- [ ] Add them to the login link: `/oauth/authorize?client_id=...&redirect_uri=...&state=...&prompt=signup&ref=<ref>&vclick=<vclick>&coupon=<coupon>` (only the ones you have).
- [ ] Send `spend` for **every** payment, with a stable `event_id` built from a reference that is never reused (the payment's own reference, not a database row number), the real `occurred_at`, `plan` and `value_usd` in USD.
- [ ] Send `chargeback` with `original_event_id` = the `event_id` of the payment: it reverses the commission. A `refund` or `chargeback` whose `original_event_id` VooSquare never received from the tool comes back in `rejected` ("original event not found") and is not stored. Send `refund` for money you return (unused credits, or a plan payment or renewal you refund): it is logged but **never** reverses commission, plan payments included, because used credits are non-refundable and tool refunds are final for affiliates (owner update 2026-10-05).
- [ ] Send `plan_started` (and `plan_renewed`) with `plan` (the name exactly as on the tool's pricing page) and the plan's **list** price in `value_usd`. A plan the catalogue does not have yet is added as provisional; after that the catalogue price is **admin-owned** (affiliate back office → Deals and products → Plan catalogue): a plan event never changes it, a different amount (a discount, a custom deal, a yearly price) is only flagged there for review.
- [ ] Optional: `signals` with your own hashes of the payment fingerprint, Telegram ID, phone and device. Never raw values.
- [ ] Do **not** build VooSquare affiliate balances, commissions or withdrawals in the tool. Do not show the affiliate who the customer is. A tool's **own** referral program is separate: the owner decides whether it stays (default: keep both), and it never uses the `ref`, `vclick` or `coupon` parameters (rules: [`VOO_CONNECT.md`](VOO_CONNECT.md), section 3e).

| Tool | Extra for this tool |
|---|---|
| **Joinvoo** | `spend` for **Basic** ($30 by default) and **Pro** ($99 by default) payments (names and prices can be changed in Joinvoo's admin); the 2¢ subscriber overage as `spend` when billed (batch per customer per day). `plan_started`/`plan_renewed` with `Basic` / `Pro` and the list price. Customers qualify at the first payment (affiliate back office → Deals and products can switch a product to "Second payment"). |
| **Spyvoo** | `spend` per plan payment (Starter $29, Pro $79, Agency $199 a month; yearly $290 / $790 / $1,990). `plan_started` with the plan. Free sign-ups send nothing (they count as sign-ups automatically). |
| **Vooads** | Plans (Starter $49, Pro $149, Scale $349, Agency $799 a month): `spend` + `plan_started` / `plan_renewed` per plan payment. Credit packs ($19, $49, $99, $249): `wallet_topup` when bought (not commissionable) and `spend` as credits are **used** (batch daily). Used credits are non-refundable: only send `spend` for credits that are consumed. A refund of unused credits can be sent as `refund` (logged, no effect on commission) or not at all. Card disputes: `chargeback` against the `spend`. |
| **Replyvoo** | `spend` per plan payment: Starter $29, Growth $79, Pro $149, Business $299, Titan $599, Black (contact sales, custom price). Spark is free and sends nothing. `plan_started` with the plan and its list price. **CPA amounts are the owner's decision**; the suggestion never pays more than the plan's price and stops at the $300 maximum: Business suggests $295, Titan $300 (the $300 top CPA is for the top plan). |
| **Castvoo** | `spend` per plan payment (Starter $19, Growth $49, Scale $99 a month after a 7-day free trial). `plan_started` with the plan. |
| **Landvoo** | Build VooSquare login in from the start, with the `ref`/`vclick` pass-through. `spend` per plan payment. |
| **Affleego** | **Not part of the affiliate program — no events needed for commission.** Affleego operates separately (owner decision 2026-10-05): no RevShare, no CPA, not an offer. Do not add `ref`/`vclick`/`coupon` pass-through for affiliates. Affleego may keep sending its normal VooSquare events (Voo ID, revenue reporting); the affiliate engine ignores every Affleego event (`spend`, `refund`, `chargeback`, `plan_*`, `wallet_topup`), so nothing it sends can create a commission, qualification or contest point. |
| **Gatevoo** | Not commissionable until the owner enables it in the affiliate back office (/affiliates → Deals and products). Nothing to do now. |

How to check a tool: click a test affiliate link to the tool, sign up with a new email, make a test payment, then look at the affiliate's dashboard (Reports → Conversions) or `GET /api/aff/conversions`.

## 4. Put affiliate.voosquare.com live (Railway)

The affiliate site is the same Railway service. You only add a domain.

1. Railway → your VooSquare service → **Settings → Networking → Custom Domain** → add `affiliate.voosquare.com`. Railway shows a **CNAME target** (something like `xxxx.up.railway.app`).
2. At your DNS provider (where voosquare.com is managed) add a record: type **CNAME**, name **affiliate**, value = the Railway target. If you use Cloudflare, set the record to **DNS only** (grey cloud) until Railway shows the certificate as issued, then you may turn the proxy on.
3. Wait until Railway shows the domain as active (certificate issued, usually minutes).
4. Optional short links: add `go.voosquare.com` the same way. `https://go.voosquare.com/a/<code>` and `/go/<code>` both work.
5. Keep `BASE_URL=https://voosquare.com`. Tracking links use it, and the tracking cookie is set on `.voosquare.com`, so it is readable on `voosquare.com`, `affiliate.voosquare.com` and `go.voosquare.com`.
6. Check: `https://affiliate.voosquare.com/` shows the affiliate site, `https://voosquare.com/affiliates` too, and `https://voosquare.com/a/<your code>` redirects.

Sign-in on `affiliate.voosquare.com` uses the normal Voo ID email code on that host (its own session cookie). On `voosquare.com/affiliates` the main-site session is used.

## 5. Environment variables and settings

Add to Railway → Variables (also listed in `.env.example`):

| Variable | Needed | What |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | for Telegram alerts | From @BotFather. Without it, the dashboard shows "Telegram alerts are not configured" and everything else works. |
| `TELEGRAM_BOT_USERNAME` | optional | The bot's username without @ (read automatically otherwise). |
| `TELEGRAM_WEBHOOK_SECRET` | optional | Secret Telegram sends with each update. Generated from `APP_SECRET` if empty. |

**Telegram bot setup**
1. In Telegram, message @BotFather → `/newbot` → name it "VooSquare Affiliates", username e.g. `VooSquareAffiliatesBot`. Copy the token into `TELEGRAM_BOT_TOKEN` and redeploy.
2. In the admin, call `POST /api/admin/aff/telegram/webhook` (Program settings → Telegram → "Register webhook"; the front end adds the button). It tells Telegram to send updates to `https://voosquare.com/api/aff/telegram/webhook`.
3. `GET /api/admin/aff/telegram` should show `configured: true` and the bot name.

**KYC and payout providers** are set in the admin (Program settings), not in variables, so the owner can change them: `kyc.provider` and `payouts.provider` = `{ kind: "http", name, api_base, api_key, webhook_secret }`. Webhooks: `https://voosquare.com/api/aff/hooks/kyc` and `https://voosquare.com/api/aff/hooks/payouts` (HMAC-SHA256 of the raw body with the webhook secret, hex, in `X-KYC-Signature` / `X-Payout-Signature`). The provider's API must accept:
- KYC: `POST {api_base}/verifications` `{ reference, callback_url, redirect_url }` → `{ id, url }`; webhook `{ reference, status }`.
- Payouts: `POST {api_base}/payouts` `{ reference, amount_usd, currency, network, address, callback_url }` → `{ id, status }`; `GET {api_base}/payouts/{id}` → `{ status, tx_hash }`; webhook `{ reference, status, tx_hash }`.
If a provider's API is shaped differently, put a small adapter (or Gatevoo later) in front of it with this shape. With no provider, KYC is reviewed by hand (documents uploaded privately) and payouts are "send from the wallet, then Mark paid with the tx hash".

**Team roles** (Admin → Team): give `aff_admin` to the program owner(s), `aff_manager` to account managers, `aff_fraud` to CPA reviewers, `aff_finance` to the people who send payouts (keep at least two: payouts above $2,000 need one to approve and another to send). Then give each manager a profile with `PUT /api/admin/aff/managers/<user id>` (`kinds`: general and/or private, countries they cover, languages, hours). New applications go to the general manager for the affiliate's country, or the least loaded one.

**Feature switch**: Admin → Settings → Features → "Affiliate program". Off hides the affiliate API (clicks keep tracking, earnings keep counting, webhooks stay open).

## 6. Test it end to end on your computer

```bash
cd voosquare-app
DATABASE_PATH=/tmp/aff-local/voosquare.db PORT=4655 OWNER_EMAIL=you@example.com NODE_ENV=test node server.js
```
`NODE_ENV=test` lets you move the clock for the hourly jobs; never use it in production. Login codes show in the API response (`dev_code`) when email is not set up.

1. **Owner login**: `POST /api/auth/start {"email":"you@example.com"}` then `POST /api/auth/verify {"email","code"}` (send header `x-vs: 1`; keep the session cookie: `vs_sess` over http, `__Host-vs_sess` over https).
2. **Affiliate account**: log in as another email (the affiliate), `POST /api/aff/account`, then `PUT /api/aff/application/1..4` (bodies in the API doc). As the owner: `POST /api/admin/aff/applications/<id>/approve`.
3. **Click**: open `http://localhost:4655/a/<affiliate code>?p=joinvoo&sub1=test&click_id=abc` in a private window. You are redirected to joinvoo.com with `ref` and `vclick` (the page may not load; that is fine). The `vs_aff` cookie is now set for localhost. Test with a normal browser user agent: a bot or headless one (Playwright's and Puppeteer's default `HeadlessChrome`, `curl`) is not counted as a click and is redirected with `ref` only, no `vclick` (attribution then falls back to `ref_link`, without sub-ids). Harnesses that simulate several visitors from one machine with `X-Forwarded-For` need `TRUST_PROXY=1` on VooSquare, or every visitor shares one IP (one rate-limit bucket).
4. **Sign-up**: in the same private window, sign up with a new email at `http://localhost:4655/login`. `GET /api/aff/customers` (as the affiliate) now shows a customer reference.
5. **Purchase**: take Joinvoo's API key (Admin → Products → Joinvoo → Credentials) and send:
   ```bash
   curl -X POST localhost:4655/api/v1/events -H "authorization: Bearer <joinvoo key>" -H "content-type: application/json" \
     -d '{"events":[{"event_id":"t1","voo_id":"<customer voo_id>","type":"spend","plan":"Pro","value_usd":99}]}'
   ```
   `GET /api/aff/balance` shows the commission waiting for activation (activation needs 5 qualified customers, each counted at their first payment; for a quick test set `activation_customers` to 0 with `PUT /api/admin/aff/settings {"activation_customers":0}` and send another payment, `event_id` `t2`: it is available at once).
6. **Holds (optional)**: holds are 0 by default. To try one, `PUT /api/admin/aff/settings {"holds":{"spend_days":30}}`, send a payment, then `POST /api/admin/aff/jobs/run {"at": <now + 31 days in ms>}` as the owner: the held commission becomes available. Set it back to 0 after.
7. **Payout**: as the affiliate, `PUT /api/aff/wallets {"usdt_trc20":"<a real TRC20 address>"}`, verify KYC (or set `kyc.required` to `off`), `POST /api/aff/payouts`. As a finance user: `POST /api/admin/aff/payouts/<id>/paid {"tx_hash":"..."}` (above the four-eyes limit, a first finance user approves and a second one marks paid). Download `GET /api/aff/payouts/<id>/receipt.pdf`.
8. **Refund vs chargeback**: send `{"event_id":"t3","voo_id":"...","type":"refund","value_usd":99,"original_event_id":"t1"}`: the commission stays (used credits are non-refundable; the conversion log shows "Refund by the tool (commission final)"). The same with `"plan":"Pro"` on a plan payment: the commission still stays. Send the same with `"type":"chargeback"` and `"event_id":"t4"`: the commission is reversed (a negative row; shows as owed if it was already paid and comes off the next payout).
9. **Fraud reversal**: as a fraud-check manager or admin, `POST /api/admin/aff/clawbacks {"affiliate_id":..,"commission_ids":[..],"reason":"..."}`; a different finance user approves with `POST /api/admin/aff/clawbacks/<id>/approve`. Both steps are in the audit log.

The automated version of all of this is `node test/affiliates.js` (about 250 checks, a few seconds).

## 7. Troubleshooting

| Symptom | Check |
|---|---|
| Customer not attributed | Was the Voo ID new? Existing Voo IDs are never attributed. Did the tool pass `ref`/`vclick` to `/oauth/authorize`? Is the click older than 60 days? Was the click from a bot user agent or over 60 clicks a minute from one IP (not counted)? `aff_clicks` and `aff_attributions` tables. |
| Payment shows "Before approval: tracked, not earning" | Payments before the affiliate's approval date never earn. |
| Commission "Waiting for activation" | The affiliate has fewer than 5 qualified customers (setting `activation_customers`). |
| Commission "On hold" | An admin set a hold (Program settings → Earnings timing, or a product's Hold column). It applies to earnings created after it was saved; the hourly job releases them. |
| A `refund` did not reverse the commission | By design, also for a refunded **plan payment**: tool refunds never reverse commission (owner update 2026-10-05). Only `chargeback`, an admin refund of a VooSquare order, or an approved fraud reversal reverses commission. |
| An affiliate cannot request a payout ("We've updated the affiliate terms") | They accepted an older terms version. They accept the current one from the banner, the terms page or Settings → Legal (`POST /api/aff/terms/accept`). Earning is never blocked. |
| No commission at all | Product not commissionable (Inner Circle, Gatevoo off), customer blocked (self-referral), CPA model customer (paid by CPA), declined CPA, or lifetime RevShare paused (health). `GET /api/aff/conversions` shows the status. |
| `spend` stored but no commission | Was the event sent with the hub's own key (ignored)? Is `value_usd` > 0? Is the customer attributed? |
| A plan shows the wrong price on Offers | Plan prices are admin-owned: Deals and products → Plan catalogue → set and **Confirm**. A tool's plan events never change a price; "different amounts" there means customers paid something else (discount, yearly, price change in the tool). |
| `rejected`: "original event not found" | The refund or chargeback points at a payment VooSquare never received from that tool. The tool should point at the payment's own `event_id`, or leave `original_event_id` out for a refund of unused credits. |
| Postback not received | `GET /api/aff/postbacks?failed=1` shows the response code. Postbacks go only to public https hosts, no redirects, 5 seconds. |
| Telegram not working | `TELEGRAM_BOT_TOKEN` set? Webhook registered (`POST /api/admin/aff/telegram/webhook`)? `GET /api/admin/aff/telegram` shows queued and failed counts. A user who blocked the bot is disconnected automatically. |
| Payout button disabled | `GET /api/aff/payouts` → `blocked_by` says why: not approved, paused, open request, below minimum, no wallet, KYC required. |
| "You approved this payout. Another finance user has to send it." | Four eyes above the limit: approve with one finance account, send with another. |
| Tier did not change on the 1st | Tiers are set by the hourly job once per affiliate per month (Africa/Lagos). Grace month, quality gate (refund rate over 8% or 15%), Legend approval and admin overrides can hold it. The tier card in `/api/aff/me` explains. |
| A tool's events look doubled | Events are unique per product and `event_id`; send a stable ID. |
