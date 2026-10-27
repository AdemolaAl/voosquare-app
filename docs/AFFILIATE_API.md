# VooSquare Affiliates: API contract

For the engineer porting the approved preview (`aff-preview/`, screens `#/site`, `#/join`, `#/pend/*`, `#/aff/*`, `#/mgr/*`, `#/fraud/*`, `#/admin/*`) onto the real backend. Rules: `docs/AFFILIATE_DECISIONS.md` (final) and `docs/AFFILIATE_SPEC.md`. Code: `src/aff/*.js`, `src/routes/aff.js`, `src/routes/aff-admin.js`. Tests: `test/affiliates.js`.

## Conventions

- **Same app, same session.** The affiliate site is served by the main Node app: every page on `affiliate.<domain>` and `/affiliates` (and `/affiliates/*`) on the main host returns `public/affiliate.html`. Put the front end in `public/js/` and `public/css/` (Content Security Policy: no inline scripts, no `on*=` handlers). Sign-in is the normal Voo ID login: `POST /api/auth/start` `{ email, name?, coupon? }` → `POST /api/auth/verify` `{ email, code, coupon? }` sets the session cookie for the host you call it on (`__Host-vs_sess` over https, so it is always host-only and no other subdomain can set it; `vs_sess` over plain http in development). On `affiliate.<domain>` the affiliate signs in there (host-only cookie); on `/affiliates` the main-site session is used.
- Every mutating `/api/*` call needs the header `x-vs: 1` (`VS.api` adds it). Webhooks are exempt.
- **Money is integer US cents** in every field ending `_cents`. Rates are **basis points** (`_bp`: 2500 = 25%). Format on the client (`$` + cents/100, two decimals). Times are Unix milliseconds. Countries are ISO 3166 alpha-2 (draw flags client-side).
- **Customers are never identified.** Affiliate APIs return a pseudonymous `customer_ref` (`C-7F3KQ2`, different per affiliate), country, product, plan, amounts and statuses only. Staff fraud screens get masked evidence (`k•••••@gmail.com`, `V-000123`).
- **Errors**: HTTP status + `{ "error": "Plain sentence to show", ...extra }`. Common: `400` validation (show `error`), `401` not signed in, `403` not allowed (`{ pending: true }` = page opens after approval; `{ off: "affiliates" }` = program switched off in Admin → Features; `{ kyc_required: true }`; `{ needs_owner: true }`), `404` (`{ no_account: true }` = the Voo ID has no affiliate account yet), `409` state conflict (already decided, open request exists, address locked), `429` rate limit.
- `x-vs-now: <ms>` moves the clock for reads and decisions **only when the server runs with `NODE_ENV=test`** (used by tests; ignored in production).
- Live updates: `VS.stream(['user:<id>'])` receives `aff` events `{ kind, id, text }` for new notifications (refresh the bell) and `{ kind: 'telegram_connected' }`. Staff: channel `staff` receives `aff` events `{ kind: 'application' | 'payout' | 'deal_request', id }`.

### Statuses (labels to show)
| Thing | Values |
|---|---|
| Affiliate `status` | `pending` (account exists; `applied` says if the application was submitted), `approved`, `rejected`, `suspended` (shown as Paused), `closed` |
| Commission `status` | `pending_activation` (Waiting for activation), `hold` (On hold: only when an admin-set hold applies; show the On hold card only when `hold_cents` > 0), `available` (the default straight away: RevShare on spend and purchases, approved CPA), `in_review` (CPA), `declined`, `reversed`, `paid` |
| Commission `type` | `revshare`, `cpa`, `hybrid_cpa`, `sub_override` (Sub-affiliate), `adjustment`, `clawback` (Reversal), `contest_prize` |
| Payout `status` | `requested`, `approved` (four eyes), `processing` (Sending), `paid`, `rejected` (Not sent), `cancelled`, `held` (Under review) |
| Health `state` | `inactive` (before 5 qualified), `ramp` (first 90 days after activation), `active`, `at_risk`, `grace`, `paused` |
| KYC | `none`, `pending`, `verified`, `rejected` |
| Contest `status` | `upcoming`, `live`, `qualifying` (only if admin set extra days after the end; default 0), `closed` (ended, scores final, awaiting finalise), `pending_signoff`, `completed`, `cancelled` |
| Conversion `event` | `registration`, `first_payment`, `repeat_payment`, `qualified` (at the first payment), `cpa`, `refund` (VooSquare order refunded by admin: reverses), `refund_final` (tool refund of credits **or a plan payment**: logged as "Refund by the tool (commission final)", commission final, status `no_clawback`), `chargeback` (reverses), `plan_started`, `plan_renewed`, `wallet_topup` |

CPA decline reason codes (affiliate-facing text comes back as `reason_text`): `refund_in_hold`, `chargeback`, `not_new_customer`, `self_referral`, `duplicate_account`, `traffic_source_not_approved`, `geo_not_approved`, `incentivised`, `fraud_signals`, `payment_instrument_shared`, `coupon_abuse`, `brand_bidding`, `over_cap`, `not_qualified`, `terms_breach`, `fraud` (reason on a fraud-reversal row).

**Earnings timing (owner update 2026-10-05).** RevShare is automatic and instant; approved CPA is instant; a customer qualifies at the first counted payment. A tool `refund` never claws back, plan payments included (used credits are non-refundable; tool refunds are final); `chargeback`, an admin order refund and an approved fraud reversal do. Holds are admin settings `holds: { spend_days, order_days, card_order_days, cpa_days, cpa_long_days, cpa_long_cents, cpa_new_days, review_extend_days }`, all 0 by default except `cpa_long_cents` (10000) and `review_extend_days` (14, review time only).

**Products outside the program (owner update 2026-10-05 (2)).** Affleego is not part of the affiliate program. It never appears in `products`, `deep_links`, offers or pickers; `product_key: "affleego"` is refused as an unknown product by links, link builder, coupons, creatives, deals and deal requests (`400`) and dropped from postback and contest product filters. Program settings carry `adjustments: { four_eyes_cents (50000), dup_window_sec (60) }`. The engine ignores every Affleego event and order (no conversion, commission, qualification, activation, tier, health or contest effect). Product caps are hard limits: 35% Vooads and Replyvoo, 50% others.

---

## 1. Tracking (no `/api`)

| Method | Path | Notes |
|---|---|---|
| GET | `/a/:code` | Any host. `code` = an affiliate's code (their Voo ID referral code) or a saved link's code. Query: `p` product key (`premium`, `room`, a tool slug, `smart`, `recruit`), `sub1`…`sub5`, `click_id` (also `clickid`, `cid`), `url` (deep link on an approved domain), `join=1` (sub-affiliate recruitment). Records the click (bots and >60 clicks/min/IP are redirected but not counted), sets `vs_aff` (HttpOnly, SameSite=Lax, Secure on https, `Domain=.<root>`, 60 days) and `vs_ref`, and **302**s to the landing with `ref`, `vclick` and the sub IDs appended. `join=1` sets `vs_aff_parent` and lands on `/affiliates#/join`. |
| GET | `/go/:code` | Same, for `affiliate.<domain>/go/<code>` links. |

Tools hand `ref`, `vclick` (and `coupon`) back to `/oauth/authorize`, which stores them before showing the login, so attribution works across domains.

## 2. Public site (`#/site`, `#/site/terms`)

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/api/aff/public` | none | `{ tiers: [{ name, min, rate_bp, approval, multiplier_bp, payout_days }], products: [{ key, name, icon, color, commissionable, cap_bp, pitch, who, status, cpa_example_cents }], cpa_max_cents, attribution_days, payout_methods: [{ method, label, min_cents, fee }], holds, quality, activation_customers, health: { threshold, window_days, ramp_days, grace_days }, subs: { enabled, rate_bp, boosted_rate_bp, boost_subs, boost_sub_customers }, contests: [{ id, title, status, starts_at, ends_at, pool_cents, banner }], terms_version, telegram }` |
| GET | `/api/aff/terms` | none | `{ version: 'v1.1', date: '2026-10-05', changes: [string] (plain-text bullets of the "## Changes in <version>" section), markdown }` (docs/AFFILIATE_TERMS.md) |
| POST | `/api/aff/terms/accept` | signed in, applied | `{ version? }` accepts the current terms (the "We've updated the affiliate terms" banner). 409 when `version` is not the current one, 409 before the application is sent. Idempotent. Stored with version, time and source (`aff_terms_acceptances`, audit `terms.accept`). → `{ account }` |

## 3. Account and application (`#/join/*`, `#/pend/*`, `#/aff/welcome`)

| Method | Path | Body / query | Response / notes |
|---|---|---|---|
| GET | `/api/aff/me` | | `{ account: null, user }` when the Voo ID has no affiliate account; else `{ account: Me }` (below). |
| POST | `/api/aff/account` | `{ parent_code? }` | Creates the account (idempotent). Parent comes from the `vs_aff_parent` cookie or `parent_code`. → `{ account: Me }` |
| GET | `/api/aff/application` | | `{ step, submitted, application, sources[], volumes[], status }` (choices for step 2) |
| PUT | `/api/aff/application/1` | `{ display_name, kind: individual\|company, company?, company_country?, country, telegram, whatsapp?, language? }` | Saves; each step resumes later. → `{ account }` |
| PUT | `/api/aff/application/2` | `{ sources[] (from list), geos[] (≤5 ISO), volume (from list), audience_size?, audience_platform?, products[] }` | |
| PUT | `/api/aff/application/3` | `{ years, verticals[], networks?, links[] (≤5 https), plan (50–600 chars), heard? }` | |
| PUT | `/api/aff/application/4` | `{ accept_terms, no_income_claims, adult (all true), news?, usdt?, btc? }` | Submits. Assigns a general manager, emails "application received". Wallets are checksum-validated. A rejected affiliate can submit again after `reapply_after`. |
| POST | `/api/aff/application/reply` | `{ text, link? \| links[] }` | Answers the manager's "We need a bit more from you" request: kept on the application (`info_replies`, shown on the admin application card), clears `info_request`, adds a shared note from the affiliate. 409 when no request is open. → `{ account }` |
| POST | `/api/aff/messages` | `{ text, ref? }` | A message to the manager (Manager page, and "Ask about this" on a conversion with `ref` like `CV-12`). Stored as a shared note; `GET /api/aff/manager` returns notes with `mine`, the admin affiliate detail marks them `from_affiliate`. → `{ message }` |
| POST | `/api/aff/welcome-seen` | | Hides the approved welcome modal. |
| POST | `/api/aff/checklist` | `{ item: 'start_here' }` | Ticks the "Start here" lesson item. |
| POST | `/api/aff/close` | `{ confirm: 'CLOSE' }` | Closes the affiliate account (409 if a payout is open). |

**Me** (shape of `account`): `{ id, ref: 'AF-12', code, status, applied, applied_at, approved_at, app_step, info_request, info_from, decline_reasons[], reapply_after, display_name, hide_name, kind, company, country, telegram, whatsapp, languages[], name, first_name, avatar (VS.avatar config), email, traffic, tier: TierCard, health: Health, activated_at, perks: { coupons, stats_api, custom_landing, private_manager, cpa, early_creatives_hours, payout_days }, managers: { general: ManagerCard|null, private: ManagerCard|null }, wallets: { usdt_trc20 (masked), btc (masked), method, locked }, kyc: { status, reason, mode: manual|provider, provider, documents }, telegram: { configured, connected, username }, sub: { code, link, parent: { ref, name }|null }, link (default tracking link), cpa_paused, welcome_seen, terms_version, terms_accepted_at, terms: { current, date, accepted, accepted_at, needs_accept, payouts_blocked, changes[] (only while needs_accept) }, checklist: { first_link, telegram, payout_address, start_here }, api_key: { prefix, ips }|null, tax: { country, tax_id (masked) }, marketing, created_at }`.

- Pending banner: `status === 'pending' && applied`; "We need a bit more from you": `info_request` + `info_from`. Declined page: `status === 'rejected'`, `decline_reasons`, `reapply_after`.
- **TierCard**: `{ tier, idx, rate_bp, computed, override, floor, floor_until, month_qualified, avg_two_months, next: { name, min, rate_bp, remaining, fast_lane_hint }|null, set_on, grace, grace_month, refund_rate, quality_warning, quality_drop, legend_pending, history: [{ from, to, reason, at }] }`. Copy from spec 3.4.
- **Health**: `{ state, threshold, window_days, count, needed, exempt, days_left?, ramp_until?, grace_until?, projected?, activation?: { need, have }, since }` (meter: `count / threshold`).
- **ManagerCard**: `{ id, name, avatar, languages[], hours, telegram }`.

## 4. Dashboard home and reports (`#/aff/home`, `#/aff/reports`)

| Method | Path | Query | Response |
|---|---|---|---|
| GET | `/api/aff/home` | `period=today\|yesterday\|month\|last`, `days=30` | `{ account: Me, balance: Balance, kpis: Kpis, announcements: [Announcement×3], top_subs: [ReportRow], contest: (live contest + `board`, `me`, `entrants`)\|null, series: [{ day, clicks, signups, qualified, revenue_cents, commission_cents }], tracking: { clicks, signups }\|null (pending accounts: "Tracking, not earning yet") }` |
| GET | `/api/aff/balance` | | **Balance** `{ available_cents, owed_cents, hold_cents, pending_activation_cents, in_review_cents, requested_cents, paid_cents, lifetime_cents, credit_cents (available + hold + review + waiting), next_release: { at, amount_cents }\|null }` |
| GET | `/api/aff/stats` | `period=today\|yesterday\|month\|last\|7d\|30d\|90d` | **Kpis** `{ clicks, unique_clicks, signups, paying (new paying customers), qualified, payments, revenue_cents (net), gross_revenue_cents, refunds, chargebacks, commission_cents, signup_rate (%), epc_cents, refund_rate (%), period, from, to, previous: {…}, change: { clicks, signups, paying, qualified, revenue_cents, commission_cents, epc_cents } (% or null = "New this period") }` |
| GET | `/api/aff/series` | `days=7..366` | `{ series: [{ day: 'YYYY-MM-DD', clicks, signups, qualified, revenue_cents, commission_cents }] }` |
| GET | `/api/aff/reports` | `from,to (YYYY-MM-DD) or period`, `group=day\|week\|month\|product\|sub1..sub5\|country\|device\|source`, filters `product, sub1..sub5, country, device` | `{ group, from, to, filters, rows: [ReportRow], total }`. **ReportRow** `{ key, clicks, unique_clicks, signups, signup_rate, new_paying, qualified, revenue_cents, commission_cents, refunds, chargebacks, refund_rate, epc_cents }` |
| GET | `/api/aff/reports.csv` | same | CSV download |
| GET | `/api/aff/conversions` | `event, status, product, period\|from,to, limit≤500, offset` | `{ total, conversions: [{ id: 'CV-…', conversion_id, at, product_key, plan, event, event_label, amount_cents, status, commission_cents, reason, reason_text, customer_ref, sub1, sub2, country, device }] }` |
| GET | `/api/aff/customers` | `paying=1, limit, offset` | `{ total, customers: [{ customer_ref, country, signed_up_at, acquired_at, products[], plan, payments, net_paid_cents, commission_cents, qualified_at, model, status: signed_up\|paying\|qualified\|refunded\|charged_back\|excluded, method, sub1 }] }` |
| GET | `/api/aff/cohorts` | `months=1..12` | `{ cohorts: [{ month, customers, revenue_cents: [m0, m1, …] }], repeat: { paying_customers, payments, repeat_payments, payments_per_customer, rebill_rate, revenue_per_customer_cents } }` (redeposit / repeat purchase stats) |
| GET | `/api/aff/refunds` | | `{ refunds: [{ at, customer_ref, product_key, type, amount_cents, reversed_cents, status }], month: { r, c, rev }, refund_rate }` |
| GET | `/api/aff/cpa` | | `{ stats: { approved_month, in_review, declined_month, cpa_earned_month_cents }, deals: [Deal], conversions: [{ id, product_key, plan, amount_cents, model, status: in_review\|approved\|declined, reason, reason_text, note, customer_ref, qualified_at, decided_at, hold_until }] }` |
| GET | `/api/aff/ledger` | `status, type, limit, offset` | `{ total, rows: [{ id, at, earned_at, customer_ref, product_key, type, type_label, amount_cents, rate_bp, base_cents, status, status_label, release_at, reason, reason_text, note, in_payout }] }` (Payouts → Earnings ledger tab). `at` = when the line was recorded; `earned_at` = the date it belongs to in reports and statements |

## 5. Offers, links, coupons (`#/aff/offers`, `#/aff/links`)

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/aff/offers` | | `{ tier, rate_bp, products: [{ key, name, icon, color, status, pitch, who, domain, your_rate_bp, cap_bp, capped, plans: [{ name, price_cents, synced_at }], cpa: { state: active\|paused\|requested\|after_approval\|opens_at\|available\|apply, …Deal, hold_days, tier? }, qualification, hold_days, link, scheduled: [{ field, from, to, effective_at, direction }] }], excluded: [{ key, name, note }] }` |
| POST | `/api/aff/cpa-requests` | `{ product_key, plan?, model: cpa\|hybrid, cpa_usd?, rate_pct?, expected, traffic[], geos[], sample_url, reason }` | Apply for CPA (Elite+, or with manager recommendation). → `{ request: { id, status }, message }` |
| GET | `/api/aff/links` | `archived=1` | `{ links: [Link], base, smartlink, recruit, deep_links: [{ product_key, name, url, domain }], approved_domains[], coupons_unlocked }`. **Link** `{ id, code, name, product_key, dest_url, subs: { sub1..sub5 }, click_macro, url, archived, created_at, clicks, signups, qualified, commission_cents }` |
| POST | `/api/aff/links` | `{ name?, product_key ('' = VooSquare home, 'smart'), dest_url? (approved domain), sub1..sub5 (letters, numbers, _ - . ≤64), click_macro? (e.g. "{clickid}"), custom_landing? }` | `{ link }` |
| PATCH | `/api/aff/links/:id` | `{ name?, archived? }` | `{ link }` |
| GET | `/api/aff/links/build` | `product, url, sub1..sub5, click_macro` | Live builder preview: `{ url, qr_svg }` |
| GET | `/api/aff/links/:id/qr.svg` | `px` | SVG (download) |
| GET | `/api/aff/qr.svg` | `text` (must be one of your `/a/` links), `px` | SVG |
| GET | `/api/aff/coupons` | | `{ unlocked, coupons: [{ id, code, product_key, discount_pct, uses, max_uses, active }] }` |
| POST | `/api/aff/coupons` | `{ code (4–20), product_key? }` | Master+ only. `{ coupon }` |

## 6. Payouts, wallets, KYC, receipts (`#/aff/payouts`, `#/pend/payouts`)

| Method | Path | Body | Response / notes |
|---|---|---|---|
| GET | `/api/aff/payouts` | | `{ balance: Balance, methods: [{ method, label, min_cents, fee: covered\|deducted, fee_cents }], method, wallets, can_request, blocked_by: [not_approved\|paused\|terms_update\|open_request\|below_minimum\|no_wallet\|kyc_required], gap_cents, payout_days, terms: (as on Me), open: Payout\|null, history: [Payout], kyc }` |
| POST | `/api/aff/payouts` | `{ method?: usdt_trc20\|btc }` | Requests the **full** available balance. Errors: 400 below minimum (`{ available_cents, min_cents }`), 403 `{ kyc_required }`, 403 paused/not approved, 409 open request, 409 `{ terms_required: true, terms_version }` while the affiliate has not accepted the current terms (earning is never blocked). → `{ payout, balance }` |
| POST | `/api/aff/payouts/:id/cancel` | | Only while `requested`. → `{ payout, balance }` |
| GET | `/api/aff/payouts/:id` | | `{ payout, lines: [{ type, product_key, product, count, amount_cents }] }` |
| GET | `/api/aff/payouts/:id/receipt.pdf` | | PDF (affiliate or finance staff). 404 until paid. |
| GET | `/api/aff/receipts` | | `{ receipts: [{ receipt_no, issued_at, payout_id, amount_cents, method, tx_hash, url }] }` |
| GET | `/api/aff/statements` | `month=YYYY-MM` | Without `month`: `{ months: [{ month, pdf }] }`. With: `{ month, from, to, lines, earned_cents, in_review_cents, late_cents, paid_cents, payouts }`. Earnings are in the month of their date (payment date for RevShare, approval date for CPA, reversal date for clawbacks; Lagos months). `earned_cents` = available, paid, on hold and waiting for activation; CPA in review is not earned (`in_review_cents`); `late_cents` = part of `earned_cents` reported after the month ended |
| GET | `/api/aff/statements/:month.pdf` | | PDF |
| PUT | `/api/aff/wallets` | `{ usdt_trc20?, btc?, method? }` | TRC20 Base58Check and BTC (bech32/bech32m/Base58Check) checksums. 409 while a request is open. → `{ wallets }` |
| GET | `/api/aff/kyc` | | `{ status, reason, updated_at, mode, provider, documents }` |
| POST | `/api/aff/kyc/start` | | Provider configured: `{ mode: 'provider', url }` (open it). Otherwise `{ mode: 'manual', upload_purpose: 'kyc', doc_types[] }`. |
| POST | `/api/aff/kyc/documents` | `{ documents: [{ upload_id, doc_type }] }` | Manual review. Upload first with `POST /api/uploads?purpose=kyc` (same binary format as other uploads; private). → KYC state |

**Payout**: `{ id, amount_cents, fee_cents, net_cents, method, method_label, wallet, wallet_masked, status, status_label, requested_at, sla_due_at, approved_at, processing_at, paid_at, tx_hash, explorer_url, provider, provider_ref, reason, hold_reason, note, receipt_no, receipt_url, period_from, period_to, four_eyes }`.

## 7. Postbacks and Telegram (`#/aff/postbacks`, `#/aff/notifications`)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/aff/postbacks` | `failed=1` | `{ postbacks: [{ id, name, url, method, events[], products[], active, signed, created_at }], events[], macros[], retry_minutes: [5,30,120,360,900], logs: [{ id, postback_id, event, url, method, status: pending\|retry\|sent\|dead, response_code, response_ms, attempts, next_at, error, test, created_at }], example }` |
| POST | `/api/aff/postbacks` | `{ name, url, method: GET\|POST, events[], products[], active, secret? }` | Errors: "URL must start with https://", private/invalid hosts. Aliases accepted: `signup`→`registration`, `ftd`→`first_payment`. |
| PUT / DELETE | `/api/aff/postbacks/:id` | same | |
| POST | `/api/aff/postbacks/:id/test` | `{ event? }` | `{ ok, code, ms, error, message: "Test sent. Your server answered 200." }` |
| POST | `/api/aff/postbacks/logs/:id/resend` | | Re-queues a logged delivery. |
| GET | `/api/aff/telegram` | | `{ configured, bot, connected, username, linked_at, prefs: { signup, first_payment, qualified, cpa, refunds, tier, payouts, contest_rank, announcements, earnings, deals, health, daily, weekly }, quiet_from, quiet_to, tz }` |
| POST | `/api/aff/telegram/connect` | | `{ configured: true, code, link: 'https://t.me/<bot>?start=<code>', expires_at }` or `{ configured: false }` ("not configured"). Open `link`; poll `GET /api/aff/telegram` (or listen for `telegram_connected`). |
| POST | `/api/aff/telegram/disconnect` | | state |
| PUT | `/api/aff/telegram/prefs` | `{ prefs: {…}, quiet_from: 'HH:MM', quiet_to, tz }` | state |
| POST | `/api/aff/telegram/test` | | Sends "Test alert…" |

Postback macros: `{click_id} {sub1}…{sub5} {event} {payout} {commission} {amount} {sale_amount} {currency} {offer} {offer_id} {product} {plan} {transaction_id} {conversion_id} {timestamp} {country} {device} {customer_ref} {payout_type} {status} {tier} {affiliate_id} {decline_reason}`. POST sends the same fields as JSON. With a secret: headers `X-VooSquare-Timestamp` and `X-VooSquare-Signature: sha256=<hex HMAC of "timestamp.body" (POST) or "timestamp.url" (GET)>`. 2xx = delivered; otherwise retried after 5 min, 30 min, 2 h, 6 h, 15 h, then `dead`. 5 s timeout, no redirects, public hosts only.

## 8. Creatives, contests, announcements, notifications, manager, subs, settings

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/api/aff/creatives` | `product, format, language, geo` | `{ creatives: [{ id, title, product_key, format, size, language, platform, geo, image: Upload\|null, file_url, copy_text (with your link), link (sub1=cr_<id>), is_new, early_access, public_from }] }` — early access: Pro 48 h, Elite+ 7 days before `public_from`. |
| POST | `/api/aff/creatives/:id/use` | `{ kind: download\|copy }` | counts usage |
| GET | `/api/aff/brand-kit` | | `{ logos, product_icons, colours, fonts, do, dont }` |
| GET | `/api/aff/contests` | | `{ contests: [Contest + { me, top[3], entrants }] }` (tabs: live, upcoming, completed) |
| GET | `/api/aff/contests/:id` | `limit` | `{ contest: Contest, board: [Row], me: Row + { gap_to_next }, entrants }`. **Row** `{ rank, name (display name or "Affiliate #id"), country, avatar, tier, score, points, provisional, me, disqualified, movement }` |
| GET | `/api/aff/announcements` | | `{ announcements: [{ id, kind, title, body, link, pinned, effective_at, at }] }` |
| GET | `/api/aff/notifications` | `category=All\|Money\|Customers\|Deals\|Contests\|Announcements`, `limit` | `{ unread, notifications: [{ id, category, kind, text, product_key, link, read, at }] }` |
| POST | `/api/aff/notifications/read` | `{ ids[] }` or `{ all: true }` | |
| GET | `/api/aff/manager` | | `{ general, private, private_unlocked, reply_target, notes: [{ body, by, at }] }` (shared notes only) |
| GET | `/api/aff/subs` | | `{ enabled, eligible, rate_bp, base_rate_bp, boosted_rate_bp, boost: { need_subs, need_customers_each, have }, recruit_link, sub_code, subs: [{ ref, name, country, status, tier, paying_customers, qualified_customers, active, your_earnings_cents, joined_at }], total_earned_cents }` |
| GET | `/api/aff/settings` | | `{ profile, traffic, wallets, telegram, tax, api_key, api_unlocked, legal: { terms_version, accepted_at, current_version, needs_accept, history: [{ version, accepted_at, source: application\|update\|settings\|backfill }] }, marketing }` |
| PATCH | `/api/aff/settings` | `{ display_name, hide_name, kind, company, country, languages[], telegram, whatsapp, tax_country, tax_id, marketing, traffic: { sources, geos, volume, links }, accept_terms }` | `{ account }` (traffic changes are logged for the manager) |
| POST / DELETE | `/api/aff/api-key` | | `{ key }` shown once (Elite+ by default) |
| PUT | `/api/aff/api-ips` | `{ ips[] }` | allowlist |

**Contest**: `{ id, title, kind, description, rules, status, starts_at, ends_at, qual_days, results_at, products[], geos[], scoring: { points, plan_points: [{ min_price_cents, points }], product_points }, min_points, multipliers, prizes: [{ label, rank_from, rank_to, amount_cents }], rising, milestone, eligibility, pool_cents, theme, banner: Upload|null, images: [Upload], winners: [{ affiliate_id, rank, prize, amount_cents, name, country }] }`. **Upload** `{ id, url, thumb_url, w, h }`.

## 9. Stats API (read-only, API key)

`Authorization: Bearer vsa_…` (or `?api_key=`), 120 requests a minute, optional IP allowlist.

| GET | Path | Same as |
|---|---|---|
| | `/api/aff/v1/stats?period=` | `/api/aff/stats` + `affiliate_id` |
| | `/api/aff/v1/report?group=&from=&to=` | `/api/aff/reports` |
| | `/api/aff/v1/conversions` | `/api/aff/conversions` |
| | `/api/aff/v1/payouts` | `{ balance, payouts }` (wallets masked) |

## 10. Provider webhooks (no session, no `x-vs`)

| POST | Path | Auth |
|---|---|---|
| | `/api/aff/telegram/webhook` | header `X-Telegram-Bot-Api-Secret-Token` (set by `POST /api/admin/aff/telegram/webhook`) |
| | `/api/aff/hooks/kyc` | `X-KYC-Signature: <hex HMAC-SHA256(raw body, kyc webhook secret)>`; body `{ reference: "aff-<id>" \| id, status: approved\|verified\|rejected\|declined\|pending, reason? }` |
| | `/api/aff/hooks/payouts` | `X-Payout-Signature: <hex HMAC-SHA256(raw body, payout webhook secret)>`; body `{ reference: "vsa-payout-<id>" \| id, status: paid\|failed, tx_hash }` |

---

## 11. Back office (`/api/admin/aff/*`)

Roles come from Admin → Team permissions: `aff_admin` (program super admin; owners have everything), `aff_manager` (general/private manager: **only assigned affiliates**), `aff_fraud` (CPA review, duplicate checks, fraud signals, flags, CPA pause, clawback proposals), `aff_finance` (payouts, wallets, KYC, clawback approvals, adjustments; `payments` also counts as finance). A manager also needs a profile (`PUT /api/admin/aff/managers/:user_id`). In the table: **A** admin, **M** manager, **F** fraud, **$** finance, **any** = any of them.

| Method | Path | Role | Body / query → response |
|---|---|---|---|
| GET | `/api/admin/aff/me` | any | `{ roles: { owner, admin, manager, fraud, finance }, manager, counts: { affiliates, applications, cpa, payouts } }` (pick the shell: admin / mgr / fraud) |
| GET | `/api/admin/aff/overview` | A | `{ active, new_this_month, paused, closed, pending, overdue, cpa_in_review, cpa_oldest_at, revenue_mtd_cents, revenue_change_pct, commission_mtd_cents, commission_share_pct, payouts_due: { count, amount_cents, four_eyes }, by_tier: [{ tier, rate_bp, count }], revenue_series: [{ day, revenue_cents }×30], top: [AdminRow], today: [{ kind, title, text, href, tone }] }` |
| GET | `/api/admin/aff/affiliates` | any (M: assigned) | `q` (name, email, display name, code, Voo ID, wallet, AF-id), `status, tier, manager, kyc, fraud_min` → `{ affiliates: [AdminRow], counts }`. **AdminRow** `{ id, ref, user_id, name, display_name, handle, email (masked unless customers perm/admin), avatar, country, status, tier, tier_idx, qualified_mtd, commission_mtd_cents, refund_rate, fraud_score, kyc, health, cpa_paused, general_manager, private_manager, sources, applied_at, approved_at, created_at }` |
| GET | `/api/admin/aff/affiliates.csv` | A | CSV (audited) |
| GET | `/api/admin/aff/affiliates/:id` | any (M: assigned) | `{ affiliate: AdminRow, account: Me (full wallets for finance), application, checks, balance, tier, health, fraud: { score, breakdown[5] }, deals[], deal_requests[], notes[], audit[], kyc, kyc_docs (finance), subs[], series[], payouts[] (finance) }` |
| PATCH | `/api/admin/aff/affiliates/:id` | A (F for `cpa_paused`) | `{ tier_override (0–6\|null), tier_floor, floor_until, legend_approved, health_exempt, cpa_paused, reason, status: active\|paused\|closed }` (reason required to pause/close; logged) |
| PUT | `/api/admin/aff/affiliates/:id/managers` | A | `{ general_manager_id, private_manager_id\|null }` |
| POST | `/api/admin/aff/affiliates/:id/notes` | M | `{ body, shared }` (shared notes show on the affiliate's Manager page) |
| POST | `/api/admin/aff/affiliates/:id/adjustments` | $ (not on your own account) | `{ amount_usd (negative deducts), reason (required, 3+ chars, shown to the affiliate), idempotency_key? (8–80 chars; or header `Idempotency-Key`) }` → deductions and positive amounts up to `settings.adjustments.four_eyes_cents` ($500): `{ commission, balance }`, available at once. Above $500: `{ request, pending_approval: true, balance }` (nothing paid until a second finance/admin user approves). Same key again → the first result with `replayed: true`. Same affiliate + amount + reason within `dup_window_sec` (60 s) → `409` |
| GET | `/api/admin/aff/adjustments?status=pending\|approved\|declined` | $ | `{ requests: [{ id, affiliate_id, affiliate, amount_cents, reason, status, requested_by, requested_at, decided_by, decided_at, decision_note, commission_id, mine }], four_eyes_cents }` (also `adjustment_requests` on `GET /api/admin/aff/affiliates/:id`) |
| POST | `/api/admin/aff/adjustments/:id/approve\|decline` | $ (not the requester, not the affiliate) | `{ note? }` → approve adds an `adjustment` commission (available at once, `uniq_key adjreq:<id>`); `403` for the requester (four eyes), `409` if already decided; audit `adjustment.approve\|decline` |
| POST | `/api/admin/aff/attributions` | A | `{ user_id, affiliate_id, reason }` manual fair adjustment (never CPA-eligible) |
| GET | `/api/admin/aff/applications` | M | `status=pending\|rejected\|approved` → `{ applications: [{ id, ref, name, display_name, avatar, country, telegram, applied_at, age, sla: { due_at, overdue, text }, sources, volume, years, geos, verticals, links, plan, products, networks, checks: [{ key, label, ok }×5], escalated, info_request, general_manager, status, decline_reasons }], reasons }` |
| POST | `/api/admin/aff/applications/:id/approve` | M | sets Starter from today; email + Telegram + welcome flag |
| POST | `…/reject` | M | `{ reasons: [not_enough_info, links_dead, traffic_type, geo_vertical, duplicate, terms_breach], note }` (reapply after 30 days) |
| POST | `…/info` | M | `{ text }` (shows in their banner + email) |
| POST | `…/escalate` | M | flags for the super admin |
| GET | `/api/admin/aff/cpa` | F | `status=pending\|approved\|declined`, `affiliate` → `{ queue: [CpaRow], stats: { in_queue, approved_today, declined_today, at_stake_cents }, reasons, bulk_max_risk }`; sorted risk desc, then oldest. **CpaRow** `{ id, conversion_id, ref, affiliate: { id, ref, name, display_name, avatar, tier }, product_key, plan, amount_cents, model, customer_ref, risk, verdict: unique\|possible\|existing, signals[], status, decline_reason, note, extended_days, created_at, age, qualified_at, sub1, reviewer, decided_at }` |
| GET | `/api/admin/aff/cpa/:id` | F | `{ conversion: CpaRow + { timeline: [{ label, at, detail }], geo: { click, profile, payment }, analysis: { risk, verdict, signals: [{ key, label, weight, evidence }], matches: [{ ref, relation, kinds, paid }] }, email_masked, subs } }` |
| POST | `/api/admin/aff/cpa/:id/check` | F | One-tap duplicate check: `{ verdict, risk, signals, matches, email_masked, checked[] }` (updates the stored verdict) |
| POST | `…/approve` · `…/decline` · `…/extend` | F | `{ note }` · `{ reason (code), note }` · `{ note }` (+14 days). Nobody decides their own. |
| POST | `/api/admin/aff/cpa/bulk-approve` | F | `{ ids[] }` — only risk under `bulk_max_risk` (20) and one affiliate |
| GET | `/api/admin/aff/fraud/signals` | F | `{ weights, cards: [{ key, label, count, affiliates: [{ id, name, value }] }] }` |
| GET | `/api/admin/aff/fraud/velocity/:id` | F | `{ series: [{ day, signups }×21] }` |
| GET | `/api/admin/aff/fraud/flags` | F | `{ flags: [{ id, ref, name, display_name, avatar, fraud_score, decline_rate, state, why }] }` |
| POST | `/api/admin/aff/clawbacks` | F | **Fraud reversal** proposal for proven fraud or a terms breach: `{ affiliate_id, commission_ids[], reason (≥3 chars, audit logged) }` → proposal. Works on held, available and paid (≤ `cpa.fraud_clawback_days` after payout) commissions |
| GET | `/api/admin/aff/clawbacks` | any | list |
| POST | `/api/admin/aff/clawbacks/:id/approve\|reject` | $ (not the proposer) | executes reversals with reason code `fraud` (held → reversed; available/paid → negative `clawback` row, owed if it goes below zero and deducted from the next payout); audit `clawback.approve` with the reason; the affiliate is notified (the approver may not mark that payout) |
| GET | `/api/admin/aff/products` | any | `{ products: [{ key, name, commissionable, cap_bp, cap_pct, cap_max_bp (hard limit: 3500 Vooads/Replyvoo, 5000 others), cpa_cents, hybrid_cpa_cents, hybrid_rate_bp, hold_days, cpa_hold_days, qualification, monthly_cap, locked, payg, plans: [{ plan, price_cents, synced_at, price_source: tool\|admin, confirmed, reported_cents, reported_at, mismatch_count, mismatch_at, confirmed_at, needs_review, suggested_cpa_cents }], plans_to_review, suggested_cpa_cents (one month of the list price, never above it, at most $300; the owner decides CPA amounts), last_sync }], changes[] }` |
| PUT | `/api/admin/aff/products/:key/plans` | A | `{ plan, price_usd }` → `{ plan }`. Sets or confirms a catalogue price (admin-owned; tools' plan events never change it). Clears the mismatch flag. Audited (`plan.add`, `plan.price`). |
| DELETE | `/api/admin/aff/products/:key/plans?plan=` | A | Removes a plan name from the catalogue (audited `plan.remove`). |
| PUT | `/api/admin/aff/products/:key` | A | `{ commissionable, cap_pct (hard max: ≤35 for Vooads and Replyvoo, ≤50 for others; above → `400 { max_pct }`, even for the owner; reductions scheduled 30 days), cpa_usd (increase now, reduction ≥14 days; `effective_at`), hybrid_cpa_usd, hybrid_rate_pct, hold_days (extra days, 0 = instant), cpa_hold_days (extra days after CPA approval, 0 = available once approved), qualification: first\|second (`second_or_30d` from older clients is read as `first`), monthly_cap }` → `{ product, scheduled }` (Inner Circle 400) |
| GET / POST | `/api/admin/aff/offer-changes` | any / A | list; POST `{ scope: program, product_key, cpa_usd, effective_at }` or `{ scope: affiliate, deal_id, cpa_usd, effective_at }` |
| POST | `/api/admin/aff/affiliates/:id/revshare-deals` | **owner or program super admin (`aff_admin`)**; manager, finance, fraud check 403 | Custom RevShare deal for one approved affiliate (staff/that affiliate only; never public): `{ product_key ('*' or 'all' = every product, else a commissionable product), rate_pct (1–90; above 90 → 400), duration: forever\|until\|range, starts_at (range, YYYY-MM-DD or ms, never before now), ends_at (until/range: the last day, inclusive), note?, confirm }` → `{ deal }` (`model: 'revshare'`, `special`, `duration`, `all_products`). Up to 50% the normal caps apply (a single product above its hard cap → 400). **Above 50% = Special deal**: overrides the product caps for this affiliate only; without `confirm: true` → `409 { needs_confirm, special, warning }` (warning "AI tools cost more — this deal may lose money." for Vooads, Replyvoo or all products). The engine uses it only for payments dated inside the window (never lowers the normal rate; Hybrid customers keep the Hybrid rate), then the tier rate and cap apply again. Commission lines carry `deal_id` and `special_bp`; ledger `type_label` and receipt/statement lines read "… · Special deal 70%". The affiliate is notified (in-app, Telegram `deals`, email `aff_custom_deal`) when it starts and 7 days before it ends (hourly job `custom_deals`). Audit `deal.revshare_create` / `deal.revshare_change` |
| PATCH | `/api/admin/aff/deals/:id` (custom RevShare) | **owner or `aff_admin`** (others 403) | `{ status: 'ended' }` ends it now, or `{ ends_at }` / `{ duration: 'forever' }` moves the end (future only; rates apply going forward) |
| GET | `/api/admin/aff/revshare-deals?all=1` | any (scoped) | `{ deals: [{ …deal, affiliate_id, affiliate, special, days_left }], can_create (owner or aff_admin), max_pct: 90 }`. Affiliate side: `custom_deals` on `GET /api/aff/home`, `GET /api/aff/offers` (plus per product `custom: { rate_bp, special, label, ends_at, days_left }`) |
| POST | `/api/admin/aff/affiliates/:id/deals` | A | `{ product_key, plan?, model: cpa\|hybrid, cpa_usd (≤300 unless owner), rate_pct (hybrid, ≤ cap; never above the hard cap: 400), monthly_cap, traffic[], geos[], ends_at? }` → `{ deal }` (403 `{ needs_owner }` above the product cap or $300 CPA) |
| PATCH | `/api/admin/aff/deals/:id` | A | `{ cpa_usd, effective_at, monthly_cap, status: active\|paused\|ended, reason }` (reduction ≥7 days) |
| GET | `/api/admin/aff/deal-requests` | M | `status` → `{ requests[] }` (M: own/assigned) |
| POST | `/api/admin/aff/affiliates/:id/deal-requests` | M | `{ product_key, plan, model: cpa\|hybrid\|tier_floor\|cap_raise, cpa_usd, rate_pct, monthly_cap, tier_floor, floor_until, reason }` |
| POST | `/api/admin/aff/deal-requests/:id/approve\|decline` | A (owner above limits) | `{ note }` |
| GET / POST / PATCH | `/api/admin/aff/coupons[/:id]` | any / A / A | `{ affiliate_id, code, product_key, discount_pct, max_uses, geos[] }`; PATCH `{ active, discount_pct, max_uses }` |
| GET / POST | `/api/admin/aff/contests` | any / A | builder body: `{ title, kind: monthly\|launch\|geo\|custom, description, rules, starts_at, ends_at, qual_days (default 0: scores final at the end; 0–120 extra days), products[], geos[], scoring, min_points, multipliers, prizes[], rising: { amount_cents, max_tier }, milestone: { points, amount_cents, max_winners }, eligibility: { min_tier }, banner_upload, images[] (uploads purpose aff_contest), theme: { accent, art }, announce, published }` |
| PUT | `/api/admin/aff/contests/:id` | A | same (not after sign-off) |
| POST | `…/:id/cancel` | A | `{ note }` |
| GET | `…/:id/leaderboard` | any | staff view with removals and disqualifications |
| POST | `…/:id/recompute` · `…/finalise` · `…/signoff` | A · A · A or F (different person) | results need two staff; sign-off creates `contest_prize` earnings |
| GET / POST / PUT / DELETE | `/api/admin/aff/creatives[/:id]` | any / A | `{ title, product_key, format, size, language, platform, geo, copy_text ({your_link} is replaced), landing_url, upload_id (purpose aff_creative), file_url (videos), min_tier, public_from, early_access, active }`; GET adds `most_used[]` |
| GET / POST / DELETE | `/api/admin/aff/announcements[/:id]` | any / M / A | `{ kind: new_offer\|cpa_change (needs effective_at)\|creatives\|contest\|policy\|maintenance, title, body, link, audience: { kind: all\|tier (min_tier)\|manager (manager_id)\|product (product)\|geo (country)\|affiliate (affiliate_id) }, channels: { dashboard, email, telegram }, pinned, send_at, expires_at }` (managers: their own partners only) |
| GET | `/api/admin/aff/payouts` | $ | `status=open\|requested\|approved\|processing\|paid\|rejected\|cancelled\|held` → `{ payouts: [Payout + { affiliate, sla: { due_at, overdue, left_ms }, checks[], four_eyes: { needed, approved_by, you_approved, next: approve\|send }, own }], totals, four_eyes_cents }` |
| GET | `/api/admin/aff/payouts.csv` | $ | CSV |
| GET | `/api/admin/aff/payouts/:id` | $ | `{ payout, lines, balance, recent_declines, fraud }` |
| POST | `…/:id/approve` | $ | above the four-eyes limit, first finance user |
| POST | `…/:id/processing` | $ | sender (different from the approver); calls the HTTP payout provider when configured |
| POST | `…/:id/paid` | $ | `{ tx_hash (required), note }` → receipt issued |
| POST | `…/:id/reject` · `…/hold` · `…/release` · `…/check` | $ | `{ reason }` · `{ reason }` · – · provider status check |
| GET | `/api/admin/aff/kyc` | $ | `status=pending\|verified\|rejected\|none` → `{ affiliates: [{ id, ref, display_name, country, kyc, provider_ref, documents: [{ type, image, at }] }] }` |
| POST | `/api/admin/aff/kyc/:id` | $ | `{ status: verified\|rejected, reason }` |
| GET | `/api/admin/aff/managers` | any | `{ managers: [{ user_id, name, avatar, kinds, languages, countries, hours, telegram, load: { general, private, target }, approvals_mtd, cpa_reviews_7d, partner_revenue_mtd_cents }], private_suggestions: [AdminRow], unassigned }` |
| PUT | `/api/admin/aff/managers/:user_id` | A | `{ kinds: [general, private, fraud, finance], languages[], countries[], capacity, hours, telegram, active }` |
| POST | `/api/admin/aff/managers/reassign` | A | `{ from_user_id?, to_user_id? }` (no `to` = automatic by country and load) |
| GET | `/api/admin/aff/manager/home` | M | `{ partners: [AdminRow], stats: { partners, target, qualified_mtd, commission_mtd_cents }, applications, alerts: [{ kind: spike\|fraud\|health\|grace\|drop, tone, affiliate_id, text }] }` |
| GET | `/api/admin/aff/audit` · `.csv` | A | `affiliate, action (prefix), q, limit, offset` → `{ rows: [{ id, at, actor, action, affiliate_id, target, before, after }] }` (no delete) |
| GET / PUT | `/api/admin/aff/settings` | A | All program settings (see `src/aff/core.js` DEFAULTS): attribution_days, tiers[{ name, min, rate_bp, multiplier_bp, sla_days, approval }], quality, activation_customers, health, subs, holds { spend_days, order_days, card_order_days, cpa_days, cpa_long_days, cpa_long_cents, cpa_new_days, review_extend_days } (days 0–120, default 0; a hold applies to earnings created after it is saved), cpa, payouts { methods, four_eyes_cents, holidays, provider }, kyc { required: off\|first_payout\|threshold\|always, threshold_cents, provider }, fraud { weights, possible_at, existing_at }, reapply_days, stats_api_min_tier, coupons_min_tier, notice_days, terms_version (`vX.Y`, never below the published version `C.TERMS.version`, 400 otherwise; raising it asks every affiliate to accept again), link_domains. Secrets are write-only (`api_key_set`). Lower rates, higher tier thresholds or a higher health threshold are **scheduled 30 days out** (`scheduled` in the reply). |
| GET | `/api/admin/aff/telegram` | A | `{ configured, bot, connected, queued, failed }` |
| POST | `/api/admin/aff/telegram/webhook` | A | registers the webhook with Telegram |
| POST | `/api/admin/aff/jobs/run` | A | runs the hourly jobs now (`{ at }` honoured only under NODE_ENV=test) |
| POST | `/api/admin/aff/orders/:id/refund` | payments / $ | `{ kind: refund\|chargeback, reason }` marks a VooSquare order refunded (or charged back) and reverses that order's affiliate commission (held → reversed; available/paid → negative row) |

### Uploads used by the program
`POST /api/uploads?purpose=aff_creative|aff_contest` (team, `aff_admin`; public URLs) and `purpose=kyc` (affiliate; private: the affiliate, `aff_admin`, `aff_finance`/`payments`). Same binary format as other uploads (full image then thumbnail bytes, header `x-thumb-bytes`). Videos for creatives are linked with `file_url`.

## Front end (built)
- `public/affiliate.html` loads `public/js/aff-core.js` (helpers, router, shells), `aff-site.js` (public site, terms, Voo ID sign-in, the four-step application), `aff-app1.js` and `aff-app2.js` (affiliate dashboard), `aff-admin.js` (back office) and `public/css/aff.css` (approved preview styles) + `aff-live.css` (live additions). Hash routes: `#/site`, `#/site/terms`, `#/join/signin|login|1..4|done|declined|none`, `#/aff/<page>`, and the role-gated back office `#/admin/*` (aff_admin), `#/mgr/*` (aff_manager), `#/fraud/*` (aff_fraud), `#/fin/*` (aff_finance). Admin → Affiliates in `/admin` opens it.
- Sign-up and the application send `x-vs-fp` (`VS.fp()` in `public/js/shared.js`); sign-up and checkout pass `coupon` (`VS.coupon()`).
- Menus: "Affiliates" in the site header, mobile menu and footer and in the member app (`a[data-aff-link]`), pointing at `AFFILIATE_URL` when set (else `/affiliates`), hidden when the `affiliates` switch is off.
