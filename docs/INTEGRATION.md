# Connecting a Zedapex product to VooSquare

Every product (Spyvoo, Joinvoo, Replyvoo, Vooads, Castvoo, Landvoo, Affleego, Gatevoo, and any new one) connects in four ways. Credentials for each product are in **/admin → Products → <product> → Credentials**.

> **Drop-in kit:** [Voo Connect](VOO_CONNECT.md) (`sdk/voo-connect/`) implements everything on this page for a tool (login, affiliate hand-off, events, support) and has one setup sheet and paste-ready prompt per tool.

> **Compatibility promise:** `/api/v1/*` and `/oauth/*` only ever gain fields; nothing you rely on is removed, renamed or changes type ([API_VERSIONING.md](API_VERSIONING.md)). In return, your tool must **ignore response fields it does not know**, and may send extra fields (VooSquare ignores the ones it does not know).

| You need | Where |
|---|---|
| `VOO_BASE` | Your VooSquare address, e.g. `https://voosquare.com` |
| `VOO_CLIENT_ID`, `VOO_CLIENT_SECRET` | Login ("Continue with VooSquare") |
| `VOO_API_KEY` | Events API, support API, and the key VooSquare sends when it calls your summary URL |

In the product's admin page also set: **URL**, **SSO on**, **Redirect URIs** (e.g. `https://joinvoo.com/auth/voosquare/callback`), **Summary URL** (optional), **Support webhook** (optional).

---

## 1. Login: "Continue with VooSquare" (OAuth 2.0 authorization code)

Every tool uses VooSquare for sign-up and log-in. The login page is branded with the tool's own name, icon and colour, with "Secured by VooSquare" underneath. Anyone can create an account from any tool.

1. **Start**: send the user to
   `GET {VOO_BASE}/oauth/authorize?client_id={VOO_CLIENT_ID}&redirect_uri={callback}&state={random}`
   Add `&prompt=signup` on your "Start free" button to open the sign-up view.
2. **Callback**: VooSquare redirects to `{callback}?code=...&state=...`. Check `state`.
3. **Exchange the code** (server side, within 5 minutes):
   ```
   POST {VOO_BASE}/oauth/token
   Content-Type: application/x-www-form-urlencoded
   grant_type=authorization_code&code=...&redirect_uri={callback}&client_id={VOO_CLIENT_ID}&client_secret={VOO_CLIENT_SECRET}
   ```
   Response:
   ```json
   { "access_token": "vsat....", "token_type": "Bearer", "expires_in": 3600,
     "id_token": "<JWT signed HS256 with your client secret>",
     "user": { "sub": "vs_abc123", "voo_id": "vs_abc123", "email": "a@b.com", "email_verified": true,
               "name": "Ada Obi", "country": "NG", "voo_ref": "k3x9p", "premium": false,
               "picture": "https://voosquare.com/api/avatar/vs_abc123.svg" } }
   ```
4. **Find the local user by `voo_id` first.** A tool with existing accounts keeps its own login and links an account to a Voo ID only (a) when the member is logged in with the tool's login and presses "Connect your VooSquare account", or (b) when the email is verified on both sides: `email_verified` is `true` here **and** the tool verified that account's email itself, the emails are equal, and the account has no Voo ID yet. Never link by an unverified email. Otherwise create the user. Save `country` (use it to choose local or global payment methods) and `voo_ref` (the referral code, save once, never change).
5. Keep your own session cookie. `GET {VOO_BASE}/oauth/userinfo` with `Authorization: Bearer {access_token}` returns the same user fields.
6. **Log out everywhere**: clear your session, then redirect to `{VOO_BASE}/oauth/logout?redirect_uri={your home page}`. VooSquare sends the member back to any page on your product's own site (the origin of the product URL in the admin) or to a registered Redirect URI; any other address goes to VooSquare's home page. Logging out there also revokes every access token (`vsat.…`) issued to that member before it: `/oauth/userinfo` answers `401 invalid_token` for them (a ban does the same).

Add a route `/auth/voosquare?return_to=/dashboard` that starts step 1 and sends the user to `return_to` after login. VooSquare's launcher opens tools through it, so members land inside already signed in: it opens `URL/auth/voosquare?return_to=<Launch path>`, where the **Launch path** is set per product in the admin (empty = `/dashboard`).

## 2. Live events (feeds the member's dashboard and referral earnings)
```
POST {VOO_BASE}/api/v1/events
Authorization: Bearer {VOO_API_KEY}
Content-Type: application/json
{ "events": [ { "event_id": "jv_01HZX9K3", "voo_id": "vs_abc123", "type": "ftd",
               "label": "First deposit from Video 3", "value_usd": 120, "occurred_at": "2026-10-03T09:12:44Z" } ] }
```
- Up to 100 events per call. `event_id` must be unique per product (repeats are ignored, so retries are safe). Build it from a reference that is **never reused** (the payment processor's reference, your order number, a UUID), never from a database row number: row numbers come back after a delete or a restore, and the new event would be dropped as a duplicate.
- `event_id` is at most **80 characters**. A longer one is not stored (never shortened, which could merge two different events): it comes back in `rejected` with the reason. Hash long parts down if you build ids from several values.
- Money events (`spend`, `refund`, `chargeback`, `plan_started`, `plan_renewed`, `wallet_topup`) **must** carry an `event_id`; without one a retry would count the money twice, so they come back in `rejected` (`"event_id is required ..."`). Other types without an `event_id` still get one from VooSquare.
- Every entry in `events` must be an object with a `type`. Anything else (`null`, a string, a number, a list, `{}`) comes back in `rejected` with `"event_id": ""` and the reason. Always read `rejected`: nothing is dropped silently. `rejected[].event_id` is the id **exactly as you sent it** (never shortened, also when it is too long), so you can match it to your queue.
- A `refund` or `chargeback` with an `original_event_id` VooSquare never received from your product (or that names another refund or chargeback) is not stored: it comes back in `rejected` with `"original event not found: ..."`. Send the payment's own event first; a refund of unused credits with no payment to point at leaves `original_event_id` out.
- Send from a background job; retry on failure.
- **Never send your customers' personal data** (Telegram IDs, phone numbers, emails). Labels name the source, not the person.
- Event types: Spyvoo `search_run, ad_saved, board_created` · Joinvoo `join, lead, signup, ftd, deposit, bot_blocked` · Replyvoo `chat_answered, lead_qualified, payment_link_sent, sale_closed` · Vooads `ads_generated, ad_exported` · Castvoo `broadcast_sent, drip_step_sent, channel_connected` · Landvoo `page_published, conversion` · Affleego `offer_joined, conversion` · all tools `spend` (money the member paid inside your tool, used for referral and affiliate commissions; Affleego `spend` is never an affiliate commission, see the Affleego line below), `refund`, `chargeback`, `plan_started`, `plan_renewed`, `plan_cancelled`, `wallet_topup` (see section 2b).
- `spend` events are also the tool's line in **Admin → Revenue** (labelled "Reported by tool"). Send the amount in USD in `value_usd` (> 0), the real payment time in `occurred_at`, and a stable `event_id` so retries never count twice. Never send negative values: a refund or chargeback is its own event (`refund`, `chargeback`) pointing at the original `spend` with `original_event_id` (section 2b).
- `spend` events are what referral earnings are calculated from. The referrer's share is paid **centrally by VooSquare** (the Zedapex team pays every referral payout, whichever tool the money was spent in). Your tool never pays referral commissions, never shows a withdraw button and never keeps a referral balance. Earnings settle for the referral settling period (default 30 days) after VooSquare **receives** the event (not after `occurred_at`), so a late or backdated event still waits the full period before it can be paid out. (That settling period is for member referrals only. Affiliate-program commissions on `spend` are available at once, with no hold by default: see `docs/AFFILIATE_DECISIONS.md`, "Owner update 2026-10-05".)
- **Event times**: `occurred_at` is ISO 8601 (with a time zone, e.g. `Z`). A time more than 10 minutes in the future is replaced by the time VooSquare received the event (the reply then includes `"clamped": <count>`). A time more than 400 days ago is refused: the event is not stored and the reply lists it under `"rejected": [{ "event_id", "error" }]`. A missing or unreadable `occurred_at` means now. VooSquare stores both times: Revenue charts use `occurred_at` (never later than the time received), referral settling uses the time received.

## 2b. Affiliate program: what counts and the money events

VooSquare pays affiliates a share of what the customers they bring **pay and use**, on every tool, for life (rules: `docs/AFFILIATE_DECISIONS.md`). Your tool never pays commissions and never shows affiliate balances. It only has to do three things: keep the affiliate's click through login, send the right money events, and send the optional fraud hints.

**1. Keep the click through login.** Affiliate links (`{VOO_BASE}/a/<code>?p=<your slug>&sub1=...`) redirect to your site with `?ref=<code>&vclick=<click id>&sub1=...`. Keep `ref`, `vclick` and `coupon` (if your page has a promo field) and pass them on to the login: `{VOO_BASE}/oauth/authorize?client_id=...&redirect_uri=...&state=...&prompt=signup&ref=<ref>&vclick=<vclick>`. VooSquare stores them before the Voo ID is created; the affiliate is locked to that Voo ID for life. Nothing else is needed: VooSquare decides attribution.

**2. Money events** (same endpoint, `POST {VOO_BASE}/api/v1/events`, same rules as section 2):

| Type | Send it when | Commission |
|---|---|---|
| `spend` | the customer **paid for something used**: a plan payment or renewal, an overage, a one-time purchase, or wallet credits **when they are consumed** | Yes. RevShare is **available to the affiliate at once** (final: used credits are non-refundable). The first `spend` qualifies the customer (CPA, tiers, activation) |
| `wallet_topup` | money is added to a prepaid wallet or credit balance in your tool | **No.** Tracked only. Send `spend` later as the credits are used |
| `refund` | you return money to the customer: unused wallet credits or a top-up, **or a plan payment or renewal** (or any other payment) | **Never reverses commission**, plan payments included. Credits that were used are non-refundable and unused credits never earned any. Logged for reports as "Refund by the tool (commission final)" |
| `chargeback` | the payment was disputed and charged back by the payer's card issuer or provider | **Reverses** the commission on that payment (a negative row if it was already available or paid; the affiliate's next payout covers it) and an approved CPA within 90 days of qualifying |
| `plan_started` | a paid plan starts (the plan's **list** price in `value_usd`, its name in `plan`) | No. Records the plan and what was paid. A plan the catalogue does not have yet is added to the affiliate Offers page as provisional; the catalogue price is then owned by the VooSquare admin: a later event never changes it, a different amount is flagged for the admin |
| `plan_renewed` | a plan renews (also send the `spend` for the money) | No. Same as `plan_started` |

Optional fields on every event: `plan` (plan name, e.g. `"Pro"`), `country` (ISO 2-letter country of the payment), `original_event_id` (for `refund` and `chargeback`: the `event_id` of the `spend` it relates to, which VooSquare must have received from your product; required for a chargeback to reverse the right payment), `signals` (hashed fraud hints, below).

A plan payment:
```json
{ "events": [ { "event_id": "jv_pay_000184", "voo_id": "vs_abc123", "type": "spend", "plan": "Pro",
               "label": "Joinvoo Pro, monthly", "value_usd": 99.00, "country": "NG", "occurred_at": "2026-10-03T09:12:44Z",
               "signals": { "payment_fingerprint": "3b1f0c9e7a...", "telegram_id_hash": "a91c..." } } ] }
```
Wallet credits (Vooads, Joinvoo overages): the top-up is **not** commissionable, the consumption is:
```json
{ "events": [
  { "event_id": "va_topup_77", "voo_id": "vs_abc123", "type": "wallet_topup", "label": "Credit pack $100", "value_usd": 100, "occurred_at": "2026-10-03T10:00:00Z" },
  { "event_id": "va_use_2026-10-03_vs_abc123", "voo_id": "vs_abc123", "type": "spend", "label": "Credits used today", "value_usd": 12.40, "occurred_at": "2026-10-03T23:59:00Z" }
] }
```
Batch consumption (for example one `spend` per customer per day with a stable `event_id` like `<tool>_use_<date>_<voo_id>`), and send at least $0.01: amounts are counted in cents.

A refund of unused credits (no effect on commission) and a chargeback (reverses the commission on `jv_pay_000190`):
```json
{ "events": [
  { "event_id": "va_rf_000184", "voo_id": "vs_abc123", "type": "refund", "value_usd": 49.50, "label": "Unused credits returned", "occurred_at": "2026-10-10T08:00:00Z" },
  { "event_id": "jv_cb_000190", "voo_id": "vs_abc123", "type": "chargeback", "value_usd": 99.00, "original_event_id": "jv_pay_000190", "occurred_at": "2026-10-20T08:00:00Z" }
] }
```
Plan sync:
```json
{ "events": [ { "event_id": "jv_plan_pro_v2", "voo_id": "vs_abc123", "type": "plan_started", "plan": "Pro", "value_usd": 99, "label": "Joinvoo Pro", "occurred_at": "2026-10-03T09:12:44Z" } ] }
```

**3. Fraud hints (optional, recommended).** `signals` helps the CPA duplicate check without sharing personal data. Send **your own hashes** (for example SHA-256 of the value with a secret only your tool knows); VooSquare hashes them again and only compares them: `payment_fingerprint` (card fingerprint from your processor, or the paying wallet address), `telegram_id_hash`, `phone_hash`, `device_hash`, and `payment_country` (ISO). Never send the raw card number, phone, Telegram ID, email or name.

Rules that follow from this:
- A customer's **first** counted payment (`spend`) makes them a **qualified customer** for the affiliate, at once. Send every payment as its own `spend`.
- Refund semantics (owner update 2026-10-05): **credits that have been used are non-refundable**, so a `refund` never claws back an affiliate's commission. This is the same for **plans**: if you refund a plan payment or renewal, send `refund` (with `original_event_id` and `plan` when you have them) and the affiliate keeps the commission on it. Only a `chargeback` (or a fraud finding by the VooSquare team) reverses commission on a tool payment. Only send `spend` for credits that are really consumed; never send `spend` for credits you might still return.
- VooSquare's own orders (Premium, paid rooms) follow the same rule, except that an admin refund of a VooSquare order reverses that order's commission.
- Retries are safe (`event_id` is unique per product); VooSquare also re-checks recent events every hour.
- `spend` from the VooSquare hub key is ignored (VooSquare's own sales are counted from its orders).
- Customer money stays in your tool. Your tool never pays or shows affiliate commissions, never has a "withdraw" button for them, and never tells the affiliate who the customer is.

## 3. Summary numbers (optional)
If you set a **Summary URL** on the product, VooSquare calls it (cached 60 seconds):
```
GET {summary_url}?voo_id=vs_abc123&period=1d
Authorization: Bearer {VOO_API_KEY}
→ { "linked": true, "status": "active", "metrics": [ { "key": "joins", "label": "Real joins", "value": 412, "unit": "count", "change_pct": 18.2 } ], "open_url": "https://joinvoo.com/dashboard" }
```
Unknown users return `{ "linked": false }`. Reply within 1.5 seconds.

## 4. Support: one inbox for every product
**Option A, the widget** (no backend work). Paste before `</body>` on any website:
```html
<script src="https://voosquare.com/widget.js" data-product="joinvoo" defer></script>
```
Optional attributes: `data-color`, `data-position="left"`, `data-email` and `data-name` (pre-fill for logged-in users). Visitors chat; your team replies from **/admin → Support**; replies show in the widget and go out by email.

**Option B, the API** (forward messages from your own support form or bot):
```
POST {VOO_BASE}/api/v1/support/messages
Authorization: Bearer {VOO_API_KEY}
{ "email": "a@b.com", "name": "Ada", "subject": "Pixel not firing", "body": "...", "external_ref": "your-thread-id", "voo_id": "vs_abc123" }
→ { "ok": true, "ticket_id": 42 }
```
Messages with the same `external_ref` (or the same email while a conversation is open) join the same conversation. Read the thread: `GET {VOO_BASE}/api/v1/support/tickets/42/messages`.
If you set a **Support webhook** on the product, VooSquare POSTs each staff reply to it: `{ "type": "support.reply", "ticket_id", "external_ref", "email", "body", "agent", "created_at" }` with `Authorization: Bearer {VOO_API_KEY}`.

## Money rule
VooSquare never holds a wallet or balance for your tool and never takes top-ups for it. Your tool keeps its own billing; send `spend` events so referrals are paid correctly.

Referral payouts are central: members see their earnings from every tool on the VooSquare **Referrals** page, request a payout there, and the Zedapex team pays it from outside VooSquare and records the reference. Tools must not build payouts or withdrawals for VooSquare referral or affiliate earnings.

A tool's **own** referral program (if it has one) is separate from both: the owner decides whether it stays, and the default is to keep it, with the clash rules in [VOO_CONNECT.md](VOO_CONNECT.md) section 3e (its links never use `ref`, `vclick` or `coupon`, its codes are never sent to VooSquare, and the tool pays its own rewards).

---

## Prompt for the AI builders of each tool
Paste this into the chat where the tool is being built, then add the tool's line from the table under it.

```
This tool is part of VooSquare, the shared account for all Zedapex tools. Connect it to VooSquare without removing any existing features. Read the integration guide below and follow it exactly.

1. LOGIN: Keep the tool's own sign-up and login (password or email code, and admin logins) and add VooSquare login next to them. "Start free" and "Continue with VooSquare" start VooSquare login (OAuth 2.0 authorization code): redirect to {VOO_BASE}/oauth/authorize?client_id=...&redirect_uri=...&state=... (add &prompt=signup for Start free). Handle the callback at /auth/voosquare/callback, check state, exchange the code at POST {VOO_BASE}/oauth/token (form body: grant_type, code, redirect_uri, client_id, client_secret), and read the `user` object. Add /auth/voosquare?return_to=/dashboard that starts login and returns the user to that page. Env vars: VOO_BASE, VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY.
2. USERS: Add a unique nullable voo_id column and find the user by voo_id first. Link an existing account only when its owner is logged in with the tool's login and presses "Connect your VooSquare account", or when user.email_verified is true AND the tool verified that account's email itself AND the account has no voo_id yet. Otherwise create the user from user.voo_id, email, name, country (save and use it to choose local or global payment methods) and voo_ref (save as referred_by once, never change it). Never link by an unverified email.
3. LOGOUT: clear the session, then redirect to {VOO_BASE}/oauth/logout?redirect_uri=<a page on the tool's own site>. VooSquare comes back there only when the page is on the site of the product URL set in the VooSquare admin (or is a registered Redirect URI); otherwise the member lands on VooSquare's home page.
4. EVENTS: from a background job, POST key events to {VOO_BASE}/api/v1/events with Authorization: Bearer VOO_API_KEY, body {events:[{event_id (unique, built from a never-reused reference such as the payment reference, never a database row number), voo_id, type, label, value_usd, occurred_at}]}. Retry on failure and read `rejected` (it echoes your event_id). Never send end-customer personal data. Send a `spend` event whenever a user pays inside the tool.
5. SUMMARY (optional): add GET /api/voosquare/summary?voo_id=&period=1d|7d|30d that checks Authorization: Bearer VOO_API_KEY and returns {linked, status, metrics:[{key,label,value,unit,change_pct}], open_url}; unknown voo_id returns {"linked": false}; reply within 1.5 s.
6. SUPPORT: add the VooSquare widget script tag (data-product = this tool's slug) to every page, passing data-email and data-name for logged-in users. Remove any separate support inbox, or forward its messages with POST {VOO_BASE}/api/v1/support/messages.
7. REFERRALS AND AFFILIATES: use VooSquare referral codes (voo_ref). VooSquare referral and affiliate payouts are handled centrally in VooSquare: tools must not build payouts, withdrawals or balances for them; a screen showing them links to {VOO_BASE}/app#referrals. If the tool has its OWN referral program, keep it unless the owner says otherwise: its links never use the ref, vclick or coupon parameters, its codes are never sent to VooSquare, and the tool pays its own rewards (docs/VOO_CONNECT.md section 3e). Keep the `ref`, `vclick` and `coupon` query parameters a visitor arrives with and add them to the /oauth/authorize URL. Send a `spend` event for every payment (and for wallet credits only when they are used; send `wallet_topup` for the top-up itself), a `refund` or `chargeback` event with original_event_id when money goes back, and `plan_started` / `plan_renewed` with `plan` and the plan's list price. Optional: `signals` with your own hashes of the payment fingerprint, Telegram ID, phone and device (never raw values).
8. MONEY: payments, credits and wallets stay inside this tool. Do not add any payment features to VooSquare.
9. Add a small "Part of VooSquare" link in the footer and sidebar that opens {VOO_BASE}/app.
Show me the changed files and a short test checklist when done.
```

| Tool | Line to add |
|---|---|
| Spyvoo | `Tool slug: spyvoo. Events: search_run, ad_saved, board_created; spend for each plan payment, plan_started/plan_renewed with plan (Starter, Pro, Agency) and list price, refund/chargeback. Summary metrics: searches, ads_saved, boards.` |
| Joinvoo | `Tool slug: joinvoo. It is live: keep current data. Events: join, lead, signup, ftd, deposit, bot_blocked (batch join events up to 100 per call); spend for each plan payment and for the 2¢ overage when it is billed, plan_started/plan_renewed (Basic, Pro: the names set in Joinvoo's admin), refund/chargeback. Summary metrics: joins, ftds, revenue_usd, cost_per_ftd_usd.` |
| Replyvoo | `Tool slug: replyvoo. Events: chat_answered, lead_qualified, payment_link_sent, sale_closed; spend for each plan payment, plan_started/plan_renewed (Starter, Growth, Pro, Business, Titan, Black; Spark is free), refund/chargeback. Summary metrics: chats_answered, leads_qualified, sales_closed, sales_usd.` |
| Vooads | `Tool slug: vooads. Events: ads_generated, ad_exported; spend + plan_started/plan_renewed for plan payments (Starter, Pro, Scale, Agency); wallet_topup when credit packs are bought (not commissionable) and spend when credits are used, refund/chargeback. Summary metrics: ads_made, ads_exported.` |
| Castvoo | `Tool slug: castvoo. Events: broadcast_sent, drip_step_sent, channel_connected; spend for each plan payment, plan_started/plan_renewed (Starter, Growth, Scale), refund/chargeback. Summary metrics: messages_sent, broadcasts, active_drips, subscribers. Telegram gives bots no read receipts, so never report reads.` |
| Landvoo | `Tool slug: landvoo. Build VooSquare login in from the start. Events: page_published, conversion; spend for each plan payment, plan_started/plan_renewed, refund/chargeback. Summary metrics: pages_live, visits, conversion_pct.` |
| Affleego | `Tool slug: affleego. Keep the Affleego brand. Affleego operates separately and is NOT part of the VooSquare affiliate program: no affiliate commission, no CPA, and no ref/vclick/coupon pass-through is needed for affiliates. Events: offer_joined, conversion; spend for any paid Affleego plan or fee (Admin → Revenue only; the affiliate engine ignores every Affleego event), refund/chargeback. Summary metrics: offers_running, conversions, earnings_usd.` |
| Gatevoo | `Tool slug: gatevoo. Waitlist only for now: add the support widget and the "Part of VooSquare" link; add login when it opens.` |
