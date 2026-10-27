# Voo Connect: connect any Zedapex tool to VooSquare, step by step

**Voo Connect** is a small kit that every tool (Joinvoo, Spyvoo, Vooads, Replyvoo, Castvoo, Landvoo, Gatevoo, Affleego, and
any new one) drops in to connect to VooSquare **the same way**: Voo ID login, the affiliate click hand-off, money events,
support. It follows [INTEGRATION.md](INTEGRATION.md) exactly, so the tool's developer does not have to get the details
right by hand. It lives in this repo at `sdk/voo-connect/`.

- Zero dependencies. Node 18 or newer. CommonJS (`require`) and ESM (`import`), TypeScript types included.
- Works with plain `node:http`, Express, Connect, Fastify (raw `req`/`res`) and Next.js API routes.
- A self-test you run against VooSquare (staging or live): `node voo-connect/check.js ...` prints PASS / FAIL for every setting.
- A working example tool to copy from: `sdk/voo-connect/example-tool/server.js` ("Demo tool").
- Proved end to end by `test/voo-connect.js` (part of `npm test`).

> **Who reads what.** The owner: section 1 (what to fill in the VooSquare admin) and the tool's sheet (section 5), then
> paste the tool's prompt into the chat where the tool is being built. The tool's developer: sections 2 to 4 and the
> tool's sheet.

---

## 1. What the owner fills in VooSquare (once per tool)

Open **VooSquare → /admin → Products → <the tool>** (or **Add product** for a new tool) and fill in:

| Field | What to put | Example (Joinvoo) |
|---|---|---|
| **URL** | The tool's home page, on the host the tool really runs on (`https://joinvoo.com`, or `https://www.…` if that is where it lives). VooSquare's launcher opens `URL/auth/voosquare?return_to=<Launch path>`, and "log out everywhere" may come back to any page on this site (the logout-return rule below). | `https://joinvoo.com` |
| **Launch path** | The page inside the tool the launcher lands on after login. Empty = `/dashboard`. A path on the tool's own site, starting with one `/`. | `/app` |
| **SSO** | On. Without it nobody can log in to the tool with VooSquare. | On |
| **Redirect URIs** | **Exact addresses, one per line**: the login callback (required). Scheme, host, port and path must match to the character. Adding the home page as a second line is harmless and also covers a logout page on another host. | `https://joinvoo.com/auth/voosquare/callback`<br>`https://joinvoo.com/` |
| **Summary URL** (optional) | The tool's summary address: VooSquare shows its numbers on the member's dashboard card. | `https://joinvoo.com/api/voosquare/summary` |
| **Support webhook** (optional) | Where VooSquare sends your team's support replies, if the tool shows them in its own inbox. | `https://joinvoo.com/hooks/voosquare/support` |

Press **Save**, then open **Credentials** and give the developer these three values (privately, never in a public chat):
**Client ID** (`vsc_…`), **Client secret** (`vss_…`), **API key** (`vsk_…`).

- Staging and live VooSquare are separate: each has its **own** credentials. Do the steps on both.
- **Rotate** makes a new secret or key at once and the old one stops working: tell the developer before you press it.
- **Logout-return rule.** `/oauth/logout?redirect_uri=<address>` ends the VooSquare session, revokes the member's tool
  access tokens and sends the browser back to `<address>` only when it is **(a)** any page on the same site as the
  product's **URL** (same scheme, host and port), or **(b)** exactly one of the product's **Redirect URIs**. Any other
  address (another site, `http` instead of `https`, `www.` when URL has none) lands on VooSquare's home page instead.
  So set **URL** to the host the tool's logout page is on, or register that exact page. `check.js --logout-uri` tests it.

## 2. Install the kit in a tool (developer)

1. Copy the folder `sdk/voo-connect/` from this repo into the tool's project as `voo-connect/`
   (files: `index.js`, `index.mjs`, `index.d.ts`, `voo-connect-browser.js`, `voo-connect-browser.d.ts`, `check.js`,
   `package.json`). Or, if both repos sit side by side: `npm install ../voosquare-app/sdk/voo-connect`.
   Do not edit the kit's files: when VooSquare publishes a new version you copy the folder again. Current version
   **1.1.0** (`voo.version`): a page with only `?ref=` of the same affiliate keeps the kept `vclick`; `MONEY_TYPES` lists
   `plan_started` / `plan_renewed` like VooSquare does. Nothing to change in a tool's code.
2. Add the environment variables (Railway → Variables, or `.env`):

   | Variable | Value |
   |---|---|
   | `VOO_BASE` | `https://voosquare.com` (or the staging address) |
   | `VOO_CLIENT_ID` | from Credentials |
   | `VOO_CLIENT_SECRET` | from Credentials |
   | `VOO_API_KEY` | from Credentials |
   | `VOO_SIGNAL_SECRET` | a long random string you make once (`openssl rand -hex 32`) and **never change**. It hashes fraud hints. |
   | `VOO_SERVER_BASE` | optional: a private address for server-to-server calls, if you have one. Leave empty otherwise. |

3. Check the settings before writing code:
   ```bash
   node voo-connect/check.js --base "$VOO_BASE" --client-id "$VOO_CLIENT_ID" --client-secret "$VOO_CLIENT_SECRET" \
     --api-key "$VOO_API_KEY" --redirect-uri https://joinvoo.com/auth/voosquare/callback --logout-uri https://joinvoo.com/
   ```
   You get one line per check: VooSquare reachable, clock in sync, client ID known, SSO on, each redirect URI
   registered, client secret valid, events endpoint reachable with the key, support API reachable, logout comes back.
   Add `--summary-url https://joinvoo.com/api/voosquare/summary` once you built the summary, and `--voo-id <your Voo ID>`
   to prove the API key and the client ID belong to the same product. Exit code 0 means no FAIL line. It changes nothing
   in VooSquare (no events, no tickets, no users). `--json` prints machine-readable results; `--help` lists everything.

## 3. Wire it in (developer)

### 3a. One setup file
```js
// lib/voo.js
const { createVooConnect } = require('../voo-connect'); // ESM: import { createVooConnect } from '../voo-connect/index.mjs';
const voo = createVooConnect({
  base: process.env.VOO_BASE,
  clientId: process.env.VOO_CLIENT_ID,
  clientSecret: process.env.VOO_CLIENT_SECRET,
  apiKey: process.env.VOO_API_KEY,
  redirectUri: 'https://joinvoo.com/auth/voosquare/callback', // exactly as registered
  eventPrefix: 'jv',                                           // event ids look like jv_pay_PSK-7F3KQ2 (prefix + a stable reference)
  outboxFile: './data/voo-outbox.json',                        // events survive restarts (or pass store: { load, save } on your DB)
  // affiliate: false,                                         // Affleego only
});
voo.events.start(5000); // sends queued events every 5 s in the background
process.on('SIGTERM', async () => { voo.events.stop(); await voo.events.drain({ timeoutMs: 5000 }); process.exit(0); });
module.exports = voo;
```

### 3b. Routes (Express shown; plain `node:http` is the same, see the example tool)
```js
const voo = require('./lib/voo');

app.use(voo.captureAttribution());                          // every page: keeps ?ref=&vclick=&coupon= in the voo_attr cookie
app.get('/voo-connect-browser.js', (req, res) => res.sendFile(require.resolve('../voo-connect/voo-connect-browser.js')));

app.get('/auth/voosquare', (req, res) => voo.startLogin(req, res)); // ?signup=1 for "Start free", ?return_to=/dashboard
app.get('/auth/voosquare/callback', async (req, res) => {
  try {
    const { user, returnTo } = await voo.handleCallback(req, res);
    // 1. YOUR user by user.voo_id (unique column), always first.
    let me = await db.users.findOne({ voo_id: user.voo_id });
    // 2. "Connect your VooSquare account": a member logged in with the tool's own login links that account.
    if (!me && req.session.userId) me = await db.users.update(req.session.userId, { voo_id: user.voo_id }, { onlyIfVooIdEmpty: true });
    // 3. Existing account, same email, verified on BOTH sides (VooSquare and your tool), not linked to another Voo ID yet.
    if (!me && user.email_verified) {
      const same = await db.users.findOne({ email: user.email.trim().toLowerCase(), email_verified: true, voo_id: null });
      if (same) me = await db.users.update(same.id, { voo_id: user.voo_id });
    }
    // 4. Otherwise a new account.
    if (!me) me = await db.users.create({ voo_id: user.voo_id, email: user.email, name: user.name, country: user.country, referred_by: user.voo_ref });
    req.session.userId = me.id;                              // your own session, as before
    res.redirect(returnTo);
  } catch (e) {
    res.status(400).send(`Login did not finish: ${e.message} <a href="/auth/voosquare">Try again</a>`);
  }
});
app.get('/logout', (req, res) => { req.session.destroy(() => res.redirect(voo.logoutUrl('https://joinvoo.com/'))); });

// Optional: VooSquare's dashboard card and support replies
app.get('/api/voosquare/summary', voo.summaryHandler(async (vooId, period) => {
  const u = await db.users.findOne({ voo_id: vooId });
  if (!u) return null;                                        // → {"linked": false}
  return { status: 'active', metrics: [{ key: 'joins', label: 'Real joins', value: 412, unit: 'count', change_pct: 18.2 }], open_url: 'https://joinvoo.com/dashboard' };
}));
app.post('/hooks/voosquare/support', voo.supportWebhook(async (reply) => { /* reply.ticket_id, external_ref, body, agent */ }));
```
On landing pages add the browser snippet (it keeps the click even when the page is static or cached, and adds it to
"Start free" links): `<script src="/voo-connect-browser.js" defer></script>`. "Start free" links go to
`/auth/voosquare?signup=1&return_to=/dashboard`; "Log in" links to `/auth/voosquare?return_to=/dashboard` (use your own
dashboard path, and put the same path in the product's **Launch path**).

**Logout.** Clear your own session first, then redirect to `voo.logoutUrl('<a page on your site>')`. VooSquare comes back
only to a page on the product URL's site or to a registered Redirect URI (the logout-return rule, section 1); anything else
lands on VooSquare's home page.

What the kit does for you here: a random `state` in a signed HttpOnly cookie (10 minutes) checked at the callback;
`prompt=signup` for "Start free"; `ref`, `vclick` and `coupon` carried to `/oauth/authorize` (last click wins: a new
`vclick` replaces the kept click; a page with only `?ref=` of the **same** affiliate keeps the kept `vclick` and coupon, so
a tool that carries `?ref=` onto its own links never loses the sub-ids; `?ref=` of **another** affiliate is a new click); the code exchanged server side; the `id_token` checked (HS256 with your client secret, `aud` =
your client ID, `iss` = VooSquare, not expired); `return_to` kept on your own site (`//evil.com` is ignored); the hand-off
cookie cleared after login. Errors are `VooError` with a `code`: `state_missing`, `state_mismatch`, `state_expired`,
`access_denied`, `invalid_grant`, `invalid_client`, `invalid_id_token`.

**A tool that already has accounts (Joinvoo, Spyvoo, Vooads, Replyvoo, Castvoo, Affleego): keep its login.** Owner rule:
existing tools **keep** their sign-up and login (password, email code, admin and break-glass logins) and **add** Voo ID next
to it ("Continue with VooSquare"). Do not remove or replace the password login. Accounts are linked like this (the callback
above):
1. A nullable unique `voo_id` column. The user is found by `voo_id` first, always.
2. **Connect your VooSquare account** (settings page, for a member logged in with the tool's own login): link to
   `/auth/voosquare?return_to=/settings`; in the callback, when that session is present, save `user.voo_id` on **that** user.
3. **Same verified email.** Link an existing account automatically only when the email is verified on **both** sides:
   VooSquare's `user.email_verified` is `true` **and** the tool itself verified that account's email (a code or a link it
   sent), the two emails are equal (trimmed, lower case), and the account has no `voo_id` yet. Never link to an account
   whose email the tool never verified, never replace a `voo_id` an account already has, and never match by name or phone.
4. Otherwise create a new account.

A tool built new on Voo ID (Landvoo, Gatevoo) has no login of its own: Voo ID is the only account.

### 3c. Money and activity events
```js
// Ids come from stable BUSINESS references (the payment's own reference), never from database row numbers.
const id = voo.events.id('pay', payment.reference);          // "jv_pay_PSK-7F3KQ2": the same payment always gives the same id
voo.events.spend({ eventId: id, vooId: user.voo_id, valueUsd: 99, plan: 'Pro', label: 'Joinvoo Pro, monthly',
  occurredAt: payment.paidAt, country: user.country, signals: { payment_fingerprint: voo.hashSignal(payment.cardFingerprint) } });
voo.events.planStarted({ eventId: voo.events.id('plan', payment.reference), vooId: user.voo_id, plan: 'Pro', valueUsd: 99 }); // the plan's LIST price
voo.events.walletTopup({ eventId: voo.events.id('topup', topup.reference), vooId: user.voo_id, valueUsd: 100, label: 'Credit pack $100' });
voo.events.spend({ eventId: voo.events.id('use', '2026-10-05', user.voo_id), vooId: user.voo_id, valueUsd: 12.40, label: 'Credits used' }); // one per customer per day
voo.events.refund({ eventId: voo.events.id('rf', refund.reference), vooId: user.voo_id, valueUsd: 49.5, originalEventId: id });
voo.events.chargeback({ eventId: voo.events.id('cb', dispute.reference), vooId: user.voo_id, valueUsd: 99, originalEventId: id });
voo.events.planCancelled({ eventId: voo.events.id('cancel', sub.reference, cancelledAt.toISOString()), vooId: user.voo_id, plan: 'Pro' }); // cancel, resubscribe, cancel again = two ids
voo.events.activity('ftd', { eventId: voo.events.id('ftd', lead.uuid), vooId: user.voo_id, valueUsd: 120, label: 'First deposit from Video 3' });
```
**Event ids.** Build every `eventId` from a reference that is unique for ever: the payment processor's reference (Paystack
reference, Stripe `pi_…`, your order number such as `SV-…`), a UUID you store on the row, or for daily batches the date and
the Voo ID. **Never a database row number** (`payment.id`, `sub.id`): SQLite and other databases hand row numbers out again
after a delete or a restore from a backup, and VooSquare then drops the new payment as a duplicate of the old one, so it is
never counted. For something that can happen again for the same object (a plan cancelled, resubscribed and cancelled again),
add what makes each one unique (its time or a sequence number).

The calls only **queue** the event (they return at once and never throw for network trouble). The background sender
posts them in calls of **at most 100**, retries with backoff on network errors, timeouts, 429 and 5xx (it honours
`Retry-After`), resends the events VooSquare lists under `rejected` when it asks for a resend, and reports events refused
for good to `onRejected`. Because `event_id` is stable, a retry after a lost answer is never counted twice.

The kit **refuses** (throws `VooError('invalid_event')` at once, so you see the bug while building): a missing or
unstable-looking `event_id` (letters, digits, `_ . : -`, at most 80 characters), money without `voo_id`, `value_usd` below
0.01 or negative, a `chargeback` without `originalEventId`, `plan_started`/`plan_renewed` without `plan`, personal data
fields (`email`, `phone`, `telegram_id`, `name`, …), an email address inside a label, raw values in `signals`, and
`occurred_at` older than 400 days.

| Event | Send it when | Affiliate effect |
|---|---|---|
| `spend` | money paid for something **used**: a plan payment or renewal, an overage, a one-time purchase, wallet credits **as they are consumed** | Commission, available at once. The first one qualifies the customer. |
| `wallet_topup` | money added to a prepaid wallet / credit balance | None (tracked only). Send `spend` later as credits are used. |
| `refund` | money returned (unused credits, a refunded plan payment) | **Never** reverses commission (logged as "Refund by the tool (commission final)"). With `originalEventId`, it must be a payment VooSquare received from your tool, or the refund comes back in `rejected` ("original event not found"). A refund of unused credits with no payment to point at: leave `originalEventId` out. |
| `chargeback` | a card or payment dispute charged back | **Reverses** the commission of the `spend` in `originalEventId` (required; a payment VooSquare never received is `rejected`). |
| `plan_started` / `plan_renewed` | a paid plan starts / renews (the plan's **list** price in `valueUsd`, its name in `plan`, exactly as on your pricing page) | None. Records the plan and what was paid. A plan VooSquare has never seen is added to the affiliate catalogue as **provisional**; the catalogue price is owned by the VooSquare admin, so a different amount (a discount, a yearly price) never changes it, it is only flagged for the admin to review. Send the `spend` too. |
| `plan_cancelled` | a plan is cancelled | None. |
| activity (`join`, `ftd`, `search_run`, …) | the tool's own activity, per its sheet | None. Feeds the member's live activity. |

### 3d. Support and webhooks
- Widget on every page: `<script src="https://voosquare.com/widget.js" data-product="<slug>" defer></script>`
  (`data-email`, `data-name` for logged-in users).
- Your own form or bot: `await voo.support.send({ email, name, subject, body, externalRef, vooId })` → `{ ok, ticket_id }`;
  `await voo.support.thread(ticket_id)` reads the conversation.
- Calls **from** VooSquare (summary URL, support webhook) carry `Authorization: Bearer <VOO_API_KEY>`;
  `voo.summaryHandler()` and `voo.supportWebhook()` check it (constant time) and answer 401 otherwise. Elsewhere:
  `voo.isFromVooSquare(req)`.
- HMAC-signed webhooks (Gatevoo's `X-Gatevoo-Signature`, hex HMAC-SHA256 of the **raw** body):
  `verifyGatevooSignature(rawBody, req.headers['x-gatevoo-signature'], process.env.GATEVOO_WEBHOOK_SECRET)` from the kit.
  In Express read that route with `express.raw({ type: 'application/json' })`, not `express.json()`.

### 3e. The tool's own referral program and the VooSquare affiliate program

Some tools already have their own referral program (Replyvoo's Voo Squad `/r/<code>`, Joinvoo's referral screen). The
VooSquare affiliate program is separate: VooSquare tracks its affiliates, decides attribution and pays their commissions
centrally. **Whether a tool keeps its own program is the owner's decision. The default is to keep both**, with these
rules so they never clash:

1. **Separate links and parameters.** `ref`, `vclick` and `coupon` (and the `voo_attr` cookie) belong to VooSquare
   affiliates. A tool's own program uses its own path or parameter (`/r/<code>`, `?invite=`) and keeps its code in its
   own cookie. If the tool's old links put its own code in `?ref=`, stop doing that while VooSquare is on: a tool code in
   `ref` would replace a real affiliate click ("last click wins").
2. **Never forward a tool referral code to VooSquare** (`/oauth/authorize`, events, labels). VooSquare only receives
   the affiliate hand-off the kit carries.
3. **Attribution does not compete.** VooSquare locks a new Voo ID to an affiliate (or to the member referrer in
   `voo_ref`) at sign-up, for life. The tool's program records its own referrer in its own column. The same customer can
   have both: the VooSquare affiliate earns on VooSquare's terms, the tool's referrer earns on the tool's terms.
4. **Each program pays its own rewards.** The tool never shows, pays or withdraws VooSquare affiliate or member-referral
   earnings (link those screens to `https://voosquare.com/app#referrals`); VooSquare never pays the tool's own rewards.
   A tool reward paid in its own credits or discounts stays inside the tool.
5. **No self-referral.** The tool's program never rewards a referrer for their own account (same verified email or same
   Voo ID). Whether a customer who arrived with both a VooSquare affiliate click and a tool referral code earns both
   rewards is the owner's call; until the owner says otherwise, both run and each pays under its own rules.
6. If the owner decides to retire a tool's own program, its referral screen links to `https://voosquare.com/app#referrals`
   and already earned rewards are honoured by the tool.

## 4. Test it end to end (developer)

1. `node voo-connect/check.js ...` with every flag (section 2): no FAIL line.
2. Ask the owner for a test affiliate link to your tool (`https://voosquare.com/a/<code>?p=<slug>`), open it in a private
   window: you land on your tool with `?ref=…&vclick=…`. Use a normal browser: a bot or headless user agent (Playwright's
   or Puppeteer's default `HeadlessChrome`) is not counted as a click and gets `?ref=` without `vclick`; set a normal
   user agent in automated tests.
3. Press **Start free**, create a Voo ID with a **new** email. You come back logged in to your dashboard.
4. Make a test payment. Within a few seconds the affiliate sees the sign-up and the payment (affiliate site → Reports →
   Conversions), and the payment shows in **Admin → Revenue** as "Reported by tool".
5. Refund it: the commission stays. Send a chargeback for another test payment: the commission is reversed.
6. **Log out**: you end on your own home page, logged out of VooSquare too.

To see all of this working before touching your tool, run the example on your computer against a local VooSquare
(see [AFFILIATE_DEV_GUIDE.md](AFFILIATE_DEV_GUIDE.md), section 6, for starting VooSquare locally):
```bash
VOO_BASE=http://localhost:4655 VOO_CLIENT_ID=... VOO_CLIENT_SECRET=... VOO_API_KEY=... \
PUBLIC_URL=http://localhost:3001 PORT=3001 node sdk/voo-connect/example-tool/server.js
```

**`TRUST_PROXY` when testing.** VooSquare keys its rate limits and affiliate fraud checks on the visitor's address and
reads `X-Forwarded-For` only when `TRUST_PROXY` says how many proxies to trust. Locally it is unset (0), so the header is
ignored and every request from your machine counts as one visitor. If your test harness simulates several visitors by
sending different `X-Forwarded-For` values, start the local VooSquare with `TRUST_PROXY=1`, or the visitors share one
rate-limit bucket and get "429" errors. On Railway leave it unset (1 hop, Railway's edge); with a CDN such as Cloudflare in
front set `2`. Never set it higher than the real number of proxies (DEPLOY-GUIDE.md, section 4.3).
In VooSquare register the product "Demo tool" with URL `http://localhost:3001`, SSO on, Redirect URIs
`http://localhost:3001/auth/voosquare/callback` and `http://localhost:3001/`. The automated version is
`node test/voo-connect.js` (about 85 checks, a few seconds).

| Symptom | Fix |
|---|---|
| "Redirect not allowed" on VooSquare | The callback is not on the product's Redirect URIs exactly (check `http` vs `https`, `www`, trailing slash, port). `check.js --redirect-uri` tells you. |
| "Login is not switched on" | Admin → Products → the tool → SSO on. |
| `invalid_client` | Wrong client secret, or staging credentials on live (or the other way round). |
| `invalid_id_token` "issuer" | `VOO_BASE` differs from VooSquare's `BASE_URL` (for example `www.` or a trailing path). Use the exact address. |
| `state_missing` at the callback | Cookies blocked, the login took over 10 minutes, or the callback is on another domain than the page that started login. |
| Log out lands on VooSquare's home page | The return address is not on the product URL's site (another host, `www.`, `http`): fix the product URL or add that exact address to Redirect URIs (logout-return rule, section 1). `check.js --logout-uri` tells you. |
| Sign-up not credited to the affiliate | Was the Voo ID new? Did the landing page run `captureAttribution()` or the snippet? Is the click older than 60 days? See [AFFILIATE_DEV_GUIDE.md](AFFILIATE_DEV_GUIDE.md), section 7. |
| Events not arriving | `onError` logs the reason; `voo.events.pending()` shows the queue; 401 means a wrong `VOO_API_KEY`. |
| Same payment counted twice | The `eventId` was not stable (made from a timestamp or a random value). Build it from your payment's reference with `voo.events.id()`. |
| A new payment is never counted | Its `eventId` repeats an old one (built from a row number that came back after a delete or a restore). Use a reference that is unique for ever. |
| `rejected`: "original event not found" | The refund or chargeback points at a payment VooSquare never received from your tool (sent before Voo Connect, or another id). Point at the `spend`'s own `eventId`, or leave `originalEventId` out for a refund of unused credits. |
| The launcher opens a page that does not exist | Set the product's **Launch path** (Admin → Products) to your dashboard path, for example `/app`. |

---

## 5. Setup sheets, one per tool

Domains: `spyvoo.com`, `joinvoo.com`, `affleego.com` and `gatevoo.com` are the ones in VooSquare. Vooads, Replyvoo,
Castvoo and Landvoo have no URL in VooSquare yet, so their sheets say `vooads.com`, `replyvoo.com`, `castvoo.com` and
`landvoo.com`: replace them with the real address everywhere (admin and prompt) if it is different.

Every prompt below is complete: paste the whole block into the chat where that tool is being built, and give the
developer (or the AI builder's secret settings) the three credentials from section 1. Never paste the credentials into
a prompt.

### Joinvoo

**What it is for VooSquare:** live tool with existing customers (keep them), Telegram join tracking. Slug `joinvoo`,
event prefix `jv`.

**Install:** the kit as `voo-connect/` (section 2) and the env vars `VOO_BASE`, `VOO_CLIENT_ID`, `VOO_CLIENT_SECRET`,
`VOO_API_KEY`, `VOO_SIGNAL_SECRET`.

**Admin → Products → Joinvoo:** URL `https://joinvoo.com` · Launch path `/app` · SSO on · Redirect URIs `https://joinvoo.com/auth/voosquare/callback`
and `https://joinvoo.com/` · Summary URL `https://joinvoo.com/api/voosquare/summary` · Support webhook
`https://joinvoo.com/hooks/voosquare/support` (if Joinvoo shows support replies) · copy Client ID, Client secret, API key.

**Events and when:**

| When | Call |
|---|---|
| A customer pays for **Basic** ($30 a month by default) or **Pro** ($99 by default), first time. Names and prices can be changed in Joinvoo's admin: send the names exactly as Joinvoo shows them, and tell the VooSquare admin when they change (Affiliates → Deals and products → Plan catalogue) | `spend` (`plan`, price) + `planStarted` (list price) |
| A plan renews | `spend` + `planRenewed` |
| Money is added to the Joinvoo wallet | `walletTopup` (no commission) |
| Wallet money is consumed (the 2¢ subscriber overage when billed) | `spend`, one per customer per day: `eventId: voo.events.id('use', date, vooId)` |
| Money returned (unused wallet balance, a refunded plan) | `refund` with `originalEventId` |
| A dispute / chargeback | `chargeback` with `originalEventId` of that `spend` |
| Joins, leads, sign-ups, FTDs, deposits, blocked bots in the customer's funnels | `activity('join' \| 'lead' \| 'signup' \| 'ftd' \| 'deposit' \| 'bot_blocked', …)`, labels name the source (campaign, video), never the person |

Summary metrics: `joins`, `ftds`, `revenue_usd`, `cost_per_ftd_usd`.

**Prompt for Joinvoo's AI builder / developer:**
```
Connect Joinvoo (https://joinvoo.com) to VooSquare, the shared Zedapex account (Voo ID), using the Voo Connect kit. Joinvoo is live: keep all current users and data, do not remove features. Follow every step, then show me the changed files and a test checklist.

0. KIT: copy the folder sdk/voo-connect from the voosquare-app repo into this project as ./voo-connect (index.js, index.mjs, index.d.ts, voo-connect-browser.js, voo-connect-browser.d.ts, check.js, package.json). It has zero dependencies and needs Node 18+. Never edit or rewrite the kit.
1. ENV: read VOO_BASE (https://voosquare.com), VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY, VOO_SIGNAL_SECRET from the environment. Never commit them or log them.
2. SETUP: create one module (lib/voo.js) that calls createVooConnect({ base: VOO_BASE, clientId, clientSecret, apiKey, redirectUri: 'https://joinvoo.com/auth/voosquare/callback', eventPrefix: 'jv', outboxFile: a file on the persistent volume (or store: { load, save } backed by our database) }). Start the sender once at boot with voo.events.start(5000); on SIGTERM call voo.events.stop() then await voo.events.drain({ timeoutMs: 5000 }).
3. LOGIN: KEEP Joinvoo's existing sign-up and login (and the admin login); ADD "Continue with VooSquare" next to them. GET /auth/voosquare → voo.startLogin(req, res). "Start free" buttons link to /auth/voosquare?signup=1&return_to=/app and "Continue with VooSquare" to /auth/voosquare?return_to=/app. GET /auth/voosquare/callback → const { user, returnTo } = await voo.handleCallback(req, res). Add a unique nullable voo_id column to users and find the user by user.voo_id first. Not found: (a) if a Joinvoo user is logged in now (the "Connect your VooSquare account" button on the settings page, linking to /auth/voosquare?return_to=/settings), save user.voo_id on that user; (b) else, only if user.email_verified is true AND exactly one Joinvoo account has that same email (trimmed, lower case), Joinvoo verified that email itself, and it has no voo_id yet, save user.voo_id on it; (c) else create a new user with email, name, country (use it to choose local or global payment methods) and save user.voo_ref as referred_by once. Never link by an unverified email and never replace a voo_id an account already has. Then start our normal session and redirect to returnTo. On a VooError show "Login did not finish" with a Try again link to /auth/voosquare. Do not remove the password login.
4. LOGOUT: clear our session, then redirect to voo.logoutUrl('https://joinvoo.com/').
5. AFFILIATE CLICKS: add app.use(voo.captureAttribution()) before all routes, serve voo-connect/voo-connect-browser.js at /voo-connect-browser.js and add <script src="/voo-connect-browser.js" defer></script> to every public page. Never strip the ref, vclick or coupon query parameters.
6. EVENTS (queued by the kit, sent in the background):
   - First paid plan (Basic, $30 by default, or Pro, $99 by default; use the names and prices set in Joinvoo's admin): voo.events.spend({ eventId: voo.events.id('pay', <payment reference>), vooId, valueUsd, plan, label: 'Joinvoo <plan>, monthly', occurredAt: payment time, country, signals: { payment_fingerprint: voo.hashSignal(<card fingerprint or paying wallet address>) } }) and voo.events.planStarted({ eventId: voo.events.id('plan', <payment reference>), vooId, plan, valueUsd: <the plan's list price, never a customer's custom deal> }).
   - Renewal: spend (as above) and voo.events.planRenewed({ eventId: voo.events.id('renew', <payment reference>), vooId, plan, valueUsd }).
   - Wallet top-up: voo.events.walletTopup({ eventId: voo.events.id('topup', <top-up payment reference>), vooId, valueUsd, label: 'Wallet top-up' }) (not commissionable).
   - Wallet consumption (the 2 cent subscriber overage when billed): add it up per customer per day and send ONE voo.events.spend({ eventId: voo.events.id('use', 'YYYY-MM-DD', vooId), vooId, valueUsd: total, label: 'Overage billed' }) per customer per day from a daily job. Only send spend for money that is really consumed.
   - Refund (unused wallet money or a plan payment): voo.events.refund({ eventId: voo.events.id('rf', <refund reference>), vooId, valueUsd, plan, originalEventId: <eventId of the spend> }).
   - Chargeback / dispute: voo.events.chargeback({ eventId: voo.events.id('cb', <dispute reference>), vooId, valueUsd, originalEventId: <eventId of the spend> }).
   - Activity in our customers' funnels: voo.events.activity('join' | 'lead' | 'signup' | 'ftd' | 'deposit' | 'bot_blocked', { eventId: voo.events.id(<type>, <a never-reused id of that record, e.g. its UUID or reference>), vooId: <the Joinvoo customer's voo_id>, valueUsd (ftd/deposit only), label: '<source, e.g. Video 3 / campaign name>' }). Batching is automatic (100 per call).
   - Never send end customers' Telegram IDs, usernames, phone numbers, emails or names anywhere in events. Never negative values.
7. SUMMARY: GET /api/voosquare/summary → voo.summaryHandler(async (vooId, period) => unknown user ? null : { status: 'active', metrics: [joins, ftds, revenue_usd, cost_per_ftd_usd as { key, label, value, unit, change_pct }], open_url: 'https://joinvoo.com/dashboard' }). period is 1d, 7d or 30d. Must answer within 1.5 s (cache the numbers).
8. SUPPORT: add <script src="https://voosquare.com/widget.js" data-product="joinvoo" defer></script> to every page with data-email and data-name for logged-in users. Forward messages from any existing support form or bot with voo.support.send({ email, name, subject, body, externalRef, vooId }) and remove the separate inbox. POST /hooks/voosquare/support → voo.supportWebhook(async (reply) => show reply.body in that conversation).
9. MONEY AND REFERRALS: payments and the wallet stay inside Joinvoo. Never build, show or pay VooSquare affiliate or member-referral earnings (no such balances, commissions or withdraw buttons); link those screens to https://voosquare.com/app#referrals. If Joinvoo has its OWN referral program, keep it unless the owner says otherwise, under the rules in docs/VOO_CONNECT.md section 3e: its links never use the ref, vclick or coupon parameters (use our own path or parameter and our own cookie), never send our referral codes to VooSquare, no reward for referring yourself, and Joinvoo pays its own rewards. "Part of VooSquare" link in the footer and sidebar to https://voosquare.com/app.
10. CHECK: run node voo-connect/check.js --base $VOO_BASE --client-id $VOO_CLIENT_ID --client-secret $VOO_CLIENT_SECRET --api-key $VOO_API_KEY --redirect-uri https://joinvoo.com/auth/voosquare/callback --logout-uri https://joinvoo.com/ --summary-url https://joinvoo.com/api/voosquare/summary and fix every FAIL line. Then: open a test affiliate link, Start free with a new email, pay a test plan, refund it, log out, and tell me what you saw at each step.
```

### Spyvoo

**What it is for VooSquare:** ad spy tool with plans Free, **Starter** $29, **Pro** $79 and **Agency** $199 a month (yearly
$290 / $790 / $1,990; prices are set in Spyvoo's admin). Slug `spyvoo`, event prefix `sv`.

**Install:** kit + env vars as in section 2.

**Admin → Products → Spyvoo:** URL `https://spyvoo.com` · Launch path `/app` · SSO on · Redirect URIs `https://spyvoo.com/auth/voosquare/callback`
and `https://spyvoo.com/` · Summary URL `https://spyvoo.com/api/voosquare/summary` · Support webhook optional · copy the credentials.

**Events and when:**

| When | Call |
|---|---|
| A plan payment (Starter, Pro, Agency), first time | `spend` + `planStarted` (monthly list price; a yearly payment is flagged for the admin, never changes the catalogue) |
| Renewal | `spend` + `planRenewed` |
| Refund / chargeback | `refund` / `chargeback` with `originalEventId` |
| Plan cancelled | `planCancelled` |
| A search, a saved ad, a new board | `activity('search_run' \| 'ad_saved' \| 'board_created', …)` (batch searches per hour if they are many) |

Free sign-ups send nothing (VooSquare counts them itself). Summary metrics: `searches`, `ads_saved`, `boards`.

**Prompt for Spyvoo's AI builder / developer:**
```
Connect Spyvoo (https://spyvoo.com) to VooSquare, the shared Zedapex account (Voo ID), using the Voo Connect kit. Do not remove features. Follow every step, then show me the changed files and a test checklist.

0. KIT: copy the folder sdk/voo-connect from the voosquare-app repo into this project as ./voo-connect (index.js, index.mjs, index.d.ts, voo-connect-browser.js, voo-connect-browser.d.ts, check.js, package.json). Zero dependencies, Node 18+. Never edit or rewrite the kit.
1. ENV: VOO_BASE (https://voosquare.com), VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY, VOO_SIGNAL_SECRET from the environment. Never commit or log them.
2. SETUP: one module (lib/voo.js) with createVooConnect({ base: VOO_BASE, clientId, clientSecret, apiKey, redirectUri: 'https://spyvoo.com/auth/voosquare/callback', eventPrefix: 'sv', outboxFile: a file on the persistent volume (or a store on our database) }). voo.events.start(5000) at boot; on SIGTERM voo.events.stop() then await voo.events.drain({ timeoutMs: 5000 }).
3. LOGIN: KEEP our existing sign-up and login (password or email code) and our admin logins; ADD "Continue with VooSquare" next to them. GET /auth/voosquare → voo.startLogin(req, res). "Start free" → /auth/voosquare?signup=1&return_to=<our dashboard path>, "Continue with VooSquare" → /auth/voosquare?return_to=<our dashboard path>. GET /auth/voosquare/callback → const { user, returnTo } = await voo.handleCallback(req, res); add a unique nullable voo_id column and find the user by user.voo_id first. Not found: (a) if one of our users is logged in now (the "Connect your VooSquare account" button in settings, linking to /auth/voosquare?return_to=/settings), save user.voo_id on that user; (b) else, only if user.email_verified is true AND we have one account with that same email (trimmed, lower case) whose email WE verified (code or link) and that has no voo_id yet, save user.voo_id on it; (c) else create a new user with email, name, country (choose local or global payment methods with it) and referred_by = user.voo_ref, saved once. Never link by an unverified email and never replace a voo_id an account already has. Start our session, redirect to returnTo. On VooError show "Login did not finish" with a Try again link.
4. LOGOUT: clear our session, redirect to voo.logoutUrl('https://spyvoo.com/').
5. AFFILIATE CLICKS: app.use(voo.captureAttribution()) before all routes; serve voo-connect/voo-connect-browser.js at /voo-connect-browser.js; <script src="/voo-connect-browser.js" defer></script> on every public page. Never strip ref, vclick or coupon from URLs.
6. EVENTS:
   - First plan payment (Starter, Pro or Agency): voo.events.spend({ eventId: voo.events.id('pay', <payment reference>), vooId, valueUsd, plan, label: 'Spyvoo <plan>, monthly', occurredAt: payment time, country, signals: { payment_fingerprint: voo.hashSignal(<card fingerprint or paying wallet>) } }) and voo.events.planStarted({ eventId: voo.events.id('plan', <payment reference>), vooId, plan, valueUsd }).
   - Renewal: spend and voo.events.planRenewed({ eventId: voo.events.id('renew', <payment reference>), vooId, plan, valueUsd }). Cancellation: voo.events.planCancelled({ eventId: voo.events.id('cancel', <subscription reference>, <cancel time>), vooId, plan }).
   - Refund: voo.events.refund({ eventId: voo.events.id('rf', <refund reference>), vooId, valueUsd, plan, originalEventId }). Chargeback: voo.events.chargeback({ eventId: voo.events.id('cb', <dispute reference>), vooId, valueUsd, originalEventId }) (originalEventId = the eventId of the spend).
   - Activity: voo.events.activity('search_run' | 'ad_saved' | 'board_created', { eventId: voo.events.id(<type>, <a never-reused id of that record, e.g. its UUID or reference>), vooId, label: '<what, e.g. Search: crypto NG>' }). If searches are very frequent, send one search_run per user per hour with the count in the label.
   - Free sign-ups send nothing. Never negative values; never personal data in events.
7. SUMMARY: GET /api/voosquare/summary → voo.summaryHandler(async (vooId, period) => unknown ? null : { status: 'active' or 'trial', metrics: [searches, ads_saved, boards], open_url: 'https://spyvoo.com/dashboard' }), within 1.5 s.
8. SUPPORT: <script src="https://voosquare.com/widget.js" data-product="spyvoo" defer></script> on every page (data-email, data-name when logged in). Forward any own support form with voo.support.send(...). Optional POST /hooks/voosquare/support → voo.supportWebhook(...).
9. MONEY AND REFERRALS: payments stay in Spyvoo. Never build, show or pay VooSquare affiliate or member-referral earnings (no such balances, commissions or withdraw buttons); link those screens to https://voosquare.com/app#referrals. If Spyvoo has its OWN referral program, keep it unless the owner says otherwise, under the rules in docs/VOO_CONNECT.md section 3e: its links never use the ref, vclick or coupon parameters (use our own path or parameter and our own cookie), never send our referral codes to VooSquare, no reward for referring yourself, and Spyvoo pays its own rewards. "Part of VooSquare" link in the footer and sidebar to https://voosquare.com/app.
10. CHECK: node voo-connect/check.js --base $VOO_BASE --client-id $VOO_CLIENT_ID --client-secret $VOO_CLIENT_SECRET --api-key $VOO_API_KEY --redirect-uri https://spyvoo.com/auth/voosquare/callback --logout-uri https://spyvoo.com/ --summary-url https://spyvoo.com/api/voosquare/summary, fix every FAIL. Then test: affiliate link → Start free with a new email → test payment → refund → log out.
```

### Vooads

**What it is for VooSquare:** AI ad maker with plans **Starter** $49, **Pro** $149, **Scale** $349 and **Agency** $799 a
month (yearly $490 / $1,490 / $3,490 / $7,990) and pay-as-you-go credit packs ($19, $49, $99, $249). Prices are set in
Vooads' pricing file and admin. Slug `vooads`, event prefix `va`.

**Install:** kit + env vars as in section 2.

**Admin → Products → Vooads:** URL `https://vooads.com` · Launch path `/app` · SSO on · Redirect URIs `https://vooads.com/auth/voosquare/callback`
and `https://vooads.com/` · Summary URL `https://vooads.com/api/voosquare/summary` · Support webhook optional · copy the credentials.

**Events and when:**

| When | Call |
|---|---|
| A plan payment (Starter, Pro, Scale, Agency), first time / renewal | `spend` + `planStarted` / `planRenewed` (list price). Plan credits never produce a usage `spend`: the plan payment is the spend |
| A credit pack is bought | `walletTopup` (**no** commission) |
| Credits are **used** (ads generated, exports) | `spend`, one per customer per day: `voo.events.id('use', date, vooId)` (commissionable; used credits are non-refundable) |
| Unused credits returned | `refund` (optional; logged, no effect on commission) |
| A card dispute | `chargeback` with `originalEventId` = the `spend`(s) that used those credits |
| Ads made, ads exported | `activity('ads_generated' \| 'ad_exported', …)` |

Never send `spend` for credits that might still be returned. Summary metrics: `ads_made`, `ads_exported`.

**Prompt for Vooads's AI builder / developer:**
```
Connect Vooads (https://vooads.com) to VooSquare, the shared Zedapex account (Voo ID), using the Voo Connect kit. Do not remove features. Follow every step, then show me the changed files and a test checklist.

0. KIT: copy the folder sdk/voo-connect from the voosquare-app repo into this project as ./voo-connect (index.js, index.mjs, index.d.ts, voo-connect-browser.js, voo-connect-browser.d.ts, check.js, package.json). Zero dependencies, Node 18+. Never edit or rewrite the kit.
1. ENV: VOO_BASE (https://voosquare.com), VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY, VOO_SIGNAL_SECRET from the environment. Never commit or log them.
2. SETUP: one module (lib/voo.js) with createVooConnect({ base: VOO_BASE, clientId, clientSecret, apiKey, redirectUri: 'https://vooads.com/auth/voosquare/callback', eventPrefix: 'va', outboxFile: a file on the persistent volume (or a store on our database) }). voo.events.start(5000) at boot; on SIGTERM voo.events.stop() then await voo.events.drain({ timeoutMs: 5000 }).
3. LOGIN: KEEP our existing sign-up and login (password or email code) and our admin logins; ADD "Continue with VooSquare" next to them. GET /auth/voosquare → voo.startLogin(req, res). "Start free" → /auth/voosquare?signup=1&return_to=<our dashboard path>, "Continue with VooSquare" → /auth/voosquare?return_to=<our dashboard path>. GET /auth/voosquare/callback → const { user, returnTo } = await voo.handleCallback(req, res); add a unique nullable voo_id column and find the user by user.voo_id first. Not found: (a) if one of our users is logged in now (the "Connect your VooSquare account" button in settings, linking to /auth/voosquare?return_to=/settings), save user.voo_id on that user; (b) else, only if user.email_verified is true AND we have one account with that same email (trimmed, lower case) whose email WE verified (code or link) and that has no voo_id yet, save user.voo_id on it; (c) else create a new user with email, name, country (choose local or global payment methods with it) and referred_by = user.voo_ref, saved once. Never link by an unverified email and never replace a voo_id an account already has. Start our session, redirect to returnTo. On VooError show "Login did not finish" with a Try again link.
4. LOGOUT: clear our session, redirect to voo.logoutUrl('https://vooads.com/').
5. AFFILIATE CLICKS: app.use(voo.captureAttribution()) before all routes; serve voo-connect/voo-connect-browser.js at /voo-connect-browser.js; <script src="/voo-connect-browser.js" defer></script> on every public page. Never strip ref, vclick or coupon from URLs.
6. EVENTS (credits):
   - Plan payment (Starter, Pro, Scale or Agency): voo.events.spend({ eventId: voo.events.id('pay', <payment reference>), vooId, valueUsd: <USD paid>, plan, label: 'Vooads <plan>, monthly', occurredAt, country }) and voo.events.planStarted (first payment of that plan) or voo.events.planRenewed ({ eventId: voo.events.id('plan' or 'renew', <payment reference>), vooId, plan, valueUsd: <the plan's list price> }). Credits that come with a plan never produce a usage spend.
   - Credit pack bought: voo.events.walletTopup({ eventId: voo.events.id('topup', <purchase payment reference>), vooId, valueUsd: <USD paid>, label: 'Credit pack $<n>', occurredAt, signals: { payment_fingerprint: voo.hashSignal(<card fingerprint or paying wallet>) } }). This is NOT commissionable.
   - Credits used: keep a running USD total of credits consumed per customer per day; a daily job sends ONE voo.events.spend({ eventId: voo.events.id('use', 'YYYY-MM-DD', vooId), vooId, valueUsd: <USD value of credits used that day, at least 0.01>, label: 'Credits used' }) per customer per day. Re-running the job for the same day must give the same eventId. Only count credits that are really consumed (used credits are non-refundable).
   - Unused credits refunded: voo.events.refund({ eventId: voo.events.id('rf', <refund reference>), vooId, valueUsd, label: 'Unused credits returned' }) (logged only).
   - Card dispute: voo.events.chargeback({ eventId: voo.events.id('cb', <dispute reference>), vooId, valueUsd, originalEventId: <eventId of the daily spend that used those credits> }), one per affected spend.
   - Activity: voo.events.activity('ads_generated' | 'ad_exported', { eventId: voo.events.id(<type>, <a never-reused id of that record, e.g. its UUID or reference>), vooId, label: '<format, e.g. 9:16 video>' }).
   - Never negative values; never personal data in events.
7. SUMMARY: GET /api/voosquare/summary → voo.summaryHandler(async (vooId, period) => unknown ? null : { status: 'active', metrics: [ads_made, ads_exported], open_url: 'https://vooads.com/dashboard' }), within 1.5 s.
8. SUPPORT: <script src="https://voosquare.com/widget.js" data-product="vooads" defer></script> on every page (data-email, data-name when logged in). Forward any own support form with voo.support.send(...). Optional POST /hooks/voosquare/support → voo.supportWebhook(...).
9. MONEY AND REFERRALS: credits and payments stay in Vooads. Never build, show or pay VooSquare affiliate or member-referral earnings (no such balances, commissions or withdraw buttons); link those screens to https://voosquare.com/app#referrals. If Vooads has its OWN referral program, keep it unless the owner says otherwise, under the rules in docs/VOO_CONNECT.md section 3e: its links never use the ref, vclick or coupon parameters (use our own path or parameter and our own cookie), never send our referral codes to VooSquare, no reward for referring yourself, and Vooads pays its own rewards. "Part of VooSquare" link in the footer and sidebar to https://voosquare.com/app.
10. CHECK: node voo-connect/check.js --base $VOO_BASE --client-id $VOO_CLIENT_ID --client-secret $VOO_CLIENT_SECRET --api-key $VOO_API_KEY --redirect-uri https://vooads.com/auth/voosquare/callback --logout-uri https://vooads.com/ --summary-url https://vooads.com/api/voosquare/summary, fix every FAIL. Then test: affiliate link → Start free with a new email → buy a plan → buy a credit pack → use some credits → run the daily job → log out.
```

### Replyvoo

**What it is for VooSquare:** AI chat closer with plans **Spark** (free), **Starter** $29, **Growth** $79, **Pro** $149,
**Business** $299, **Titan** $599 and **Black** (contact sales, custom price) a month. Slug `replyvoo`, event prefix `rv`.

> **CPA amounts are the owner's decision.** VooSquare only *suggests* a CPA: one month of the plan's list price, never
> above it, at most the $300 program maximum. For Replyvoo that is Starter $25, Growth $75, Pro $145, **Business $295**
> and **Titan $300** (the $300 top CPA belongs to the top plan, Titan; a $300 CPA on the $299 Business plan would pay
> more than the customer's first payment). Spark is free (no CPA). Black has no list price: the owner sets any deal by
> hand. Nothing is set until the owner sets it (Affiliates → Deals and products); Replyvoo's RevShare cap is 35%.

**Install:** kit + env vars as in section 2.

**Admin → Products → Replyvoo:** URL `https://replyvoo.com` · Launch path `/app` · SSO on · Redirect URIs `https://replyvoo.com/auth/voosquare/callback`
and `https://replyvoo.com/` · Summary URL `https://replyvoo.com/api/voosquare/summary` · Support webhook optional · copy the credentials.

**Events and when:**

| When | Call |
|---|---|
| A plan payment (Starter $29, Growth $79, Pro $149, Business $299, Titan $599, or a Black deal), first time | `spend` (what was paid) + `planStarted` with the plan name and its list price (Black: the agreed monthly price) |
| Renewal | `spend` + `planRenewed` |
| Refund / chargeback | `refund` / `chargeback` with `originalEventId` |
| Chats answered, leads qualified, payment links sent, sales closed by the AI | `activity('chat_answered' \| 'lead_qualified' \| 'payment_link_sent' \| 'sale_closed', …)`; `sale_closed` may carry the sale value in `valueUsd` |

Summary metrics: `chats_answered`, `leads_qualified`, `sales_closed`, `sales_usd`.

**Prompt for Replyvoo's AI builder / developer:**
```
Connect Replyvoo (https://replyvoo.com) to VooSquare, the shared Zedapex account (Voo ID), using the Voo Connect kit. Do not remove features. Follow every step, then show me the changed files and a test checklist.

0. KIT: copy the folder sdk/voo-connect from the voosquare-app repo into this project as ./voo-connect (index.js, index.mjs, index.d.ts, voo-connect-browser.js, voo-connect-browser.d.ts, check.js, package.json). Zero dependencies, Node 18+. Never edit or rewrite the kit.
1. ENV: VOO_BASE (https://voosquare.com), VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY, VOO_SIGNAL_SECRET from the environment. Never commit or log them.
2. SETUP: one module (lib/voo.js) with createVooConnect({ base: VOO_BASE, clientId, clientSecret, apiKey, redirectUri: 'https://replyvoo.com/auth/voosquare/callback', eventPrefix: 'rv', outboxFile: a file on the persistent volume (or a store on our database) }). voo.events.start(5000) at boot; on SIGTERM voo.events.stop() then await voo.events.drain({ timeoutMs: 5000 }).
3. LOGIN: KEEP our existing sign-up and login (password or email code) and our admin logins; ADD "Continue with VooSquare" next to them. GET /auth/voosquare → voo.startLogin(req, res). "Start free" → /auth/voosquare?signup=1&return_to=<our dashboard path>, "Continue with VooSquare" → /auth/voosquare?return_to=<our dashboard path>. GET /auth/voosquare/callback → const { user, returnTo } = await voo.handleCallback(req, res); add a unique nullable voo_id column and find the user by user.voo_id first. Not found: (a) if one of our users is logged in now (the "Connect your VooSquare account" button in settings, linking to /auth/voosquare?return_to=/settings), save user.voo_id on that user; (b) else, only if user.email_verified is true AND we have one account with that same email (trimmed, lower case) whose email WE verified (code or link) and that has no voo_id yet, save user.voo_id on it; (c) else create a new user with email, name, country (choose local or global payment methods with it) and referred_by = user.voo_ref, saved once. Never link by an unverified email and never replace a voo_id an account already has. Start our session, redirect to returnTo. On VooError show "Login did not finish" with a Try again link.
4. LOGOUT: clear our session, redirect to voo.logoutUrl('https://replyvoo.com/').
5. AFFILIATE CLICKS: app.use(voo.captureAttribution()) before all routes; serve voo-connect/voo-connect-browser.js at /voo-connect-browser.js; <script src="/voo-connect-browser.js" defer></script> on every public page. Never strip ref, vclick or coupon from URLs.
6. EVENTS:
   - First plan payment (Starter, Growth, Pro, Business, Titan or Black; Spark is free and sends nothing): voo.events.spend({ eventId: voo.events.id('pay', <payment reference>), vooId, valueUsd: <real price paid>, plan, label: 'Replyvoo <plan>, monthly', occurredAt, country, signals: { payment_fingerprint: voo.hashSignal(<card fingerprint or paying wallet>) } }) and voo.events.planStarted({ eventId: voo.events.id('plan', <payment reference>), vooId, plan, valueUsd: <the plan's list price> }).
   - Renewal: spend and voo.events.planRenewed({ eventId: voo.events.id('renew', <payment reference>), vooId, plan, valueUsd }). Cancellation: voo.events.planCancelled({ eventId: voo.events.id('cancel', <subscription reference>, <cancel time>), vooId, plan }).
   - Refund: voo.events.refund({ eventId: voo.events.id('rf', <refund reference>), vooId, valueUsd, plan, originalEventId }). Chargeback: voo.events.chargeback({ eventId: voo.events.id('cb', <dispute reference>), vooId, valueUsd, originalEventId }) (originalEventId = the eventId of the spend).
   - Activity of the customer's AI closer: voo.events.activity('chat_answered' | 'lead_qualified' | 'payment_link_sent' | 'sale_closed', { eventId: voo.events.id(<type>, <a never-reused id of that record, e.g. its UUID or reference>), vooId: <the Replyvoo customer's voo_id>, valueUsd (sale_closed only), label: '<channel or bot name>' }). For very many chats send one chat_answered per customer per hour with the count in the label.
   - Never send the end customers' Telegram IDs, usernames, phone numbers, emails, names or message text. Never negative values.
7. SUMMARY: GET /api/voosquare/summary → voo.summaryHandler(async (vooId, period) => unknown ? null : { status: 'active' or 'trial', metrics: [chats_answered, leads_qualified, sales_closed, sales_usd], open_url: 'https://replyvoo.com/dashboard' }), within 1.5 s.
8. SUPPORT: <script src="https://voosquare.com/widget.js" data-product="replyvoo" defer></script> on every page (data-email, data-name when logged in). Forward any own support form with voo.support.send(...). Optional POST /hooks/voosquare/support → voo.supportWebhook(...).
9. MONEY AND REFERRALS: payments stay in Replyvoo. Never build, show or pay VooSquare affiliate or member-referral earnings (no such balances, commissions or withdraw buttons); link those screens to https://voosquare.com/app#referrals. If Replyvoo has its OWN referral program, keep it unless the owner says otherwise, under the rules in docs/VOO_CONNECT.md section 3e: its links never use the ref, vclick or coupon parameters (use our own path or parameter and our own cookie), never send our referral codes to VooSquare, no reward for referring yourself, and Replyvoo pays its own rewards. "Part of VooSquare" link in the footer and sidebar to https://voosquare.com/app.
10. CHECK: node voo-connect/check.js --base $VOO_BASE --client-id $VOO_CLIENT_ID --client-secret $VOO_CLIENT_SECRET --api-key $VOO_API_KEY --redirect-uri https://replyvoo.com/auth/voosquare/callback --logout-uri https://replyvoo.com/ --summary-url https://replyvoo.com/api/voosquare/summary, fix every FAIL. Then test: affiliate link → Start free with a new email → test plan payment → refund → log out.
```

### Castvoo

**What it is for VooSquare:** Telegram broadcast and drip tool with plans **Starter** $19, **Growth** $49 and **Scale** $99
a month (yearly $190 / $490 / $990) after a 7-day free trial. Prices are set in Castvoo's admin. Slug `castvoo`, event prefix `cv`.

**Install:** kit + env vars as in section 2.

**Admin → Products → Castvoo:** URL `https://castvoo.com` · Launch path `/dashboard` · SSO on · Redirect URIs `https://castvoo.com/auth/voosquare/callback`
and `https://castvoo.com/` · Summary URL `https://castvoo.com/api/voosquare/summary` · Support webhook optional · copy the credentials.

**Events and when:**

| When | Call |
|---|---|
| A plan payment (Starter, Growth, Scale), first time | `spend` + `planStarted` (list price) |
| Renewal | `spend` + `planRenewed` |
| Refund / chargeback | `refund` / `chargeback` with `originalEventId` |
| A broadcast sent, a drip step sent, a channel connected | `activity('broadcast_sent' \| 'drip_step_sent' \| 'channel_connected', …)` |

Telegram gives bots no read receipts: never report reads. Summary metrics: `messages_sent`, `broadcasts`, `active_drips`, `subscribers`.

**Prompt for Castvoo's AI builder / developer:**
```
Connect Castvoo (https://castvoo.com) to VooSquare, the shared Zedapex account (Voo ID), using the Voo Connect kit. Do not remove features. Follow every step, then show me the changed files and a test checklist.

0. KIT: copy the folder sdk/voo-connect from the voosquare-app repo into this project as ./voo-connect (index.js, index.mjs, index.d.ts, voo-connect-browser.js, voo-connect-browser.d.ts, check.js, package.json). Zero dependencies, Node 18+. Never edit or rewrite the kit.
1. ENV: VOO_BASE (https://voosquare.com), VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY, VOO_SIGNAL_SECRET from the environment. Never commit or log them.
2. SETUP: one module (lib/voo.js) with createVooConnect({ base: VOO_BASE, clientId, clientSecret, apiKey, redirectUri: 'https://castvoo.com/auth/voosquare/callback', eventPrefix: 'cv', outboxFile: a file on the persistent volume (or a store on our database) }). voo.events.start(5000) at boot; on SIGTERM voo.events.stop() then await voo.events.drain({ timeoutMs: 5000 }).
3. LOGIN: KEEP our existing sign-up and login (password or email code) and our admin logins; ADD "Continue with VooSquare" next to them. GET /auth/voosquare → voo.startLogin(req, res). "Start free" → /auth/voosquare?signup=1&return_to=<our dashboard path>, "Continue with VooSquare" → /auth/voosquare?return_to=<our dashboard path>. GET /auth/voosquare/callback → const { user, returnTo } = await voo.handleCallback(req, res); add a unique nullable voo_id column and find the user by user.voo_id first. Not found: (a) if one of our users is logged in now (the "Connect your VooSquare account" button in settings, linking to /auth/voosquare?return_to=/settings), save user.voo_id on that user; (b) else, only if user.email_verified is true AND we have one account with that same email (trimmed, lower case) whose email WE verified (code or link) and that has no voo_id yet, save user.voo_id on it; (c) else create a new user with email, name, country (choose local or global payment methods with it) and referred_by = user.voo_ref, saved once. Never link by an unverified email and never replace a voo_id an account already has. Start our session, redirect to returnTo. On VooError show "Login did not finish" with a Try again link.
4. LOGOUT: clear our session, redirect to voo.logoutUrl('https://castvoo.com/').
5. AFFILIATE CLICKS: app.use(voo.captureAttribution()) before all routes; serve voo-connect/voo-connect-browser.js at /voo-connect-browser.js; <script src="/voo-connect-browser.js" defer></script> on every public page. Never strip ref, vclick or coupon from URLs.
6. EVENTS:
   - First plan payment: voo.events.spend({ eventId: voo.events.id('pay', <payment reference>), vooId, valueUsd, plan, label: 'Castvoo <plan>, monthly', occurredAt, country, signals: { payment_fingerprint: voo.hashSignal(<card fingerprint or paying wallet>) } }) and voo.events.planStarted({ eventId: voo.events.id('plan', <payment reference>), vooId, plan, valueUsd }).
   - Renewal: spend and voo.events.planRenewed({ eventId: voo.events.id('renew', <payment reference>), vooId, plan, valueUsd }). Cancellation: voo.events.planCancelled({ eventId: voo.events.id('cancel', <subscription reference>, <cancel time>), vooId, plan }).
   - Refund: voo.events.refund({ eventId: voo.events.id('rf', <refund reference>), vooId, valueUsd, plan, originalEventId }). Chargeback: voo.events.chargeback({ eventId: voo.events.id('cb', <dispute reference>), vooId, valueUsd, originalEventId }) (originalEventId = the eventId of the spend).
   - Activity: voo.events.activity('broadcast_sent' | 'drip_step_sent' | 'channel_connected', { eventId: voo.events.id(<type>, <a never-reused id of that record, e.g. its UUID or reference>), vooId, label: '<channel or campaign name, and how many messages>' }). Never report reads (Telegram gives bots no read receipts).
   - Never send subscribers' Telegram IDs, usernames, phone numbers or names. Never negative values.
7. SUMMARY: GET /api/voosquare/summary → voo.summaryHandler(async (vooId, period) => unknown ? null : { status: 'active' or 'trial', metrics: [messages_sent, broadcasts, active_drips, subscribers], open_url: 'https://castvoo.com/dashboard' }), within 1.5 s.
8. SUPPORT: <script src="https://voosquare.com/widget.js" data-product="castvoo" defer></script> on every page (data-email, data-name when logged in). Forward any own support form with voo.support.send(...). Optional POST /hooks/voosquare/support → voo.supportWebhook(...).
9. MONEY AND REFERRALS: payments stay in Castvoo. Never build, show or pay VooSquare affiliate or member-referral earnings (no such balances, commissions or withdraw buttons); link those screens to https://voosquare.com/app#referrals. If Castvoo has its OWN referral program, keep it unless the owner says otherwise, under the rules in docs/VOO_CONNECT.md section 3e: its links never use the ref, vclick or coupon parameters (use our own path or parameter and our own cookie), never send our referral codes to VooSquare, no reward for referring yourself, and Castvoo pays its own rewards. "Part of VooSquare" link in the footer and sidebar to https://voosquare.com/app.
10. CHECK: node voo-connect/check.js --base $VOO_BASE --client-id $VOO_CLIENT_ID --client-secret $VOO_CLIENT_SECRET --api-key $VOO_API_KEY --redirect-uri https://castvoo.com/auth/voosquare/callback --logout-uri https://castvoo.com/ --summary-url https://castvoo.com/api/voosquare/summary, fix every FAIL. Then test: affiliate link → Start free with a new email → test plan payment → refund → log out.
```

### Landvoo

**What it is for VooSquare:** landing page builder, built new with VooSquare login from day one. Slug `landvoo`, event prefix `lv`.

**Install:** kit + env vars as in section 2.

**Admin → Products → Landvoo:** URL `https://landvoo.com` · Launch path `/dashboard` · SSO on · Redirect URIs `https://landvoo.com/auth/voosquare/callback`
and `https://landvoo.com/` · Summary URL `https://landvoo.com/api/voosquare/summary` · Support webhook optional · copy the credentials.

**Events and when:**

| When | Call |
|---|---|
| A plan payment, first time | `spend` + `planStarted` |
| Renewal | `spend` + `planRenewed` |
| Refund / chargeback | `refund` / `chargeback` with `originalEventId` |
| A page published; a conversion on a customer's page | `activity('page_published' \| 'conversion', …)` (batch conversions per page per hour) |

Summary metrics: `pages_live`, `visits`, `conversion_pct`.

> Landvoo pages are the customers' own landing pages: do **not** put the Voo Connect browser snippet or the
> `captureAttribution()` middleware on them, only on Landvoo's own marketing site and app.

**Prompt for Landvoo's AI builder / developer:**
```
Build VooSquare login into Landvoo (https://landvoo.com) from the start, using the Voo Connect kit. Landvoo has no login of its own: Voo ID is the only account. Follow every step, then show me the changed files and a test checklist.

0. KIT: copy the folder sdk/voo-connect from the voosquare-app repo into this project as ./voo-connect (index.js, index.mjs, index.d.ts, voo-connect-browser.js, voo-connect-browser.d.ts, check.js, package.json). Zero dependencies, Node 18+. Never edit or rewrite the kit.
1. ENV: VOO_BASE (https://voosquare.com), VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY, VOO_SIGNAL_SECRET from the environment. Never commit or log them.
2. SETUP: one module (lib/voo.js) with createVooConnect({ base: VOO_BASE, clientId, clientSecret, apiKey, redirectUri: 'https://landvoo.com/auth/voosquare/callback', eventPrefix: 'lv', outboxFile: a file on the persistent volume (or a store on our database) }). voo.events.start(5000) at boot; on SIGTERM voo.events.stop() then await voo.events.drain({ timeoutMs: 5000 }).
3. LOGIN: GET /auth/voosquare → voo.startLogin(req, res). "Start free" → /auth/voosquare?signup=1&return_to=/dashboard, "Log in" → /auth/voosquare?return_to=/dashboard. GET /auth/voosquare/callback → const { user, returnTo } = await voo.handleCallback(req, res); users table keyed by a unique voo_id; never match by email; new user gets email, name, country (choose local or global payment methods with it) and referred_by = user.voo_ref, saved once. Start our session, redirect to returnTo. On VooError show "Login did not finish" with a Try again link.
4. LOGOUT: clear our session, redirect to voo.logoutUrl('https://landvoo.com/').
5. AFFILIATE CLICKS: app.use(voo.captureAttribution()) on Landvoo's own site and app routes; serve voo-connect/voo-connect-browser.js at /voo-connect-browser.js and add <script src="/voo-connect-browser.js" defer></script> to Landvoo's own marketing pages. Do NOT add either to the landing pages our customers publish. Never strip ref, vclick or coupon from URLs.
6. EVENTS:
   - First plan payment: voo.events.spend({ eventId: voo.events.id('pay', <payment reference>), vooId, valueUsd, plan, label: 'Landvoo <plan>, monthly', occurredAt, country, signals: { payment_fingerprint: voo.hashSignal(<card fingerprint or paying wallet>) } }) and voo.events.planStarted({ eventId: voo.events.id('plan', <payment reference>), vooId, plan, valueUsd }).
   - Renewal: spend and voo.events.planRenewed({ eventId: voo.events.id('renew', <payment reference>), vooId, plan, valueUsd }). Cancellation: voo.events.planCancelled({ eventId: voo.events.id('cancel', <subscription reference>, <cancel time>), vooId, plan }).
   - Refund: voo.events.refund({ eventId: voo.events.id('rf', <refund reference>), vooId, valueUsd, plan, originalEventId }). Chargeback: voo.events.chargeback({ eventId: voo.events.id('cb', <dispute reference>), vooId, valueUsd, originalEventId }) (originalEventId = the eventId of the spend).
   - Activity: voo.events.activity('page_published', { eventId: voo.events.id('page', page.uuid), vooId, label: '<page name>' }); conversions on a customer's page: one voo.events.activity('conversion', { eventId: voo.events.id('conv', page.uuid, 'YYYY-MM-DDTHH'), vooId, label: '<page name>: <n> conversions' }) per page per hour.
   - Never send the visitors' data (emails, phones, names, IPs). Never negative values.
7. SUMMARY: GET /api/voosquare/summary → voo.summaryHandler(async (vooId, period) => unknown ? null : { status: 'active' or 'trial', metrics: [pages_live, visits, conversion_pct], open_url: 'https://landvoo.com/dashboard' }), within 1.5 s.
8. SUPPORT: <script src="https://voosquare.com/widget.js" data-product="landvoo" defer></script> on Landvoo's own pages (data-email, data-name when logged in), not on customers' pages. Optional POST /hooks/voosquare/support → voo.supportWebhook(...).
9. MONEY AND REFERRALS: payments stay in Landvoo. Never build, show or pay VooSquare affiliate or member-referral earnings (no such balances, commissions or withdraw buttons); link those screens to https://voosquare.com/app#referrals. If Landvoo has its OWN referral program, keep it unless the owner says otherwise, under the rules in docs/VOO_CONNECT.md section 3e: its links never use the ref, vclick or coupon parameters (use our own path or parameter and our own cookie), never send our referral codes to VooSquare, no reward for referring yourself, and Landvoo pays its own rewards. "Part of VooSquare" link in the footer and sidebar to https://voosquare.com/app.
10. CHECK: node voo-connect/check.js --base $VOO_BASE --client-id $VOO_CLIENT_ID --client-secret $VOO_CLIENT_SECRET --api-key $VOO_API_KEY --redirect-uri https://landvoo.com/auth/voosquare/callback --logout-uri https://landvoo.com/ --summary-url https://landvoo.com/api/voosquare/summary, fix every FAIL. Then test: affiliate link → Start free with a new email → test plan payment → refund → log out.
```

### Gatevoo

**What it is for VooSquare: two roles.**
1. **The payment provider** of the Voo family: VooSquare (Premium, paid rooms) and the tools take USDT / BTC through
   Gatevoo's merchant API ([GATEVOO.md](GATEVOO.md)). Gatevoo is non-custodial: the money goes to the merchant's own wallet.
2. **A tool** with its own Voo ID login, once it opens (waitlist only today). Slug `gatevoo`, event prefix `gv`.

**Install:** kit + env vars as in section 2 (only once login opens; today only the widget and the "Part of VooSquare"
link). Tools that **take payments through Gatevoo** also use the kit's `verifyGatevooSignature()` for Gatevoo's webhooks.

**Admin → Products → Gatevoo:** URL `https://gatevoo.com` · Launch path `/dashboard` · SSO on (when login opens) · Redirect URIs
`https://gatevoo.com/auth/voosquare/callback` and `https://gatevoo.com/` · Summary URL optional · copy the credentials.
Separately, **Admin → Payments → Gatevoo** holds Gatevoo's merchant API key and webhook secret for VooSquare's own
checkout (see GATEVOO.md); those are not the Voo Connect credentials.

**Events and when:**

| When | Who sends | Call |
|---|---|---|
| Waitlist (today) | nobody | nothing |
| A merchant pays Gatevoo **its own** plan or fee (when Gatevoo charges one) | Gatevoo | `spend` (+ `planStarted`/`planRenewed`); not commissionable until the owner switches Gatevoo on in the affiliate back office (/affiliates → Deals and products) |
| Refund / dispute of that fee | Gatevoo | `refund` / `chargeback` with `originalEventId` |
| A customer pays **a tool** (Joinvoo, Vooads, …) through a Gatevoo invoice | **the tool**, after Gatevoo's `invoice.paid` webhook is verified and the invoice re-read | that tool's `spend` / `walletTopup`. **Gatevoo never sends events for other tools' payments** (it would count the money twice). |
| An invoice paid on Gatevoo (optional, new event type) | Gatevoo | `activity('invoice_paid', { eventId, vooId: <the merchant's voo_id>, valueUsd })`: shows in the merchant's activity feed; no buyer data |

How a tool verifies Gatevoo's webhook with the kit:
```js
const { verifyGatevooSignature } = require('./voo-connect');
app.post('/hooks/gatevoo', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!verifyGatevooSignature(req.body, req.headers['x-gatevoo-signature'], process.env.GATEVOO_WEBHOOK_SECRET)) return res.status(401).end();
  const { invoice } = JSON.parse(req.body.toString('utf8'));
  const inv = await gatevoo.getInvoice(invoice.id);                // never trust the body: read it again (GATEVOO.md, section 2)
  if (inv.status === 'paid' && inv.paid_amount >= order.priceUsd) {
    markPaid(order);                                               // idempotent on your side
    voo.events.spend({ eventId: voo.events.id('pay', order.reference), vooId: order.vooId, valueUsd: inv.paid_amount, plan: order.plan, occurredAt: new Date() });
  }
  res.status(200).json({ ok: true });
});
```

**Prompt for Gatevoo's AI builder / developer:**
```
Gatevoo (https://gatevoo.com) has two roles in the Zedapex family: (1) the non-custodial crypto checkout (USDT TRC20, BTC) that VooSquare and the other tools use, and (2) a tool members log in to with their VooSquare account (Voo ID). Do not remove features. Follow every step, then show me the changed files and a test checklist.

A. TODAY (waitlist only): add <script src="https://voosquare.com/widget.js" data-product="gatevoo" defer></script> to every page and a small "Part of VooSquare" link (footer) to https://voosquare.com/app. Build the merchant API exactly as docs/GATEVOO.md in the voosquare-app repo describes (POST /api/v1/invoices, GET /api/v1/invoices/{id}, invoice.paid webhook signed with X-Gatevoo-Signature = lowercase hex HMAC-SHA256 of the exact raw body, GET /api/v1/me). Sign webhooks so that the Voo Connect function verifyGatevooSignature(rawBody, signature, secret) returns true.

B. WHEN LOGIN OPENS:
0. KIT: copy the folder sdk/voo-connect from the voosquare-app repo into this project as ./voo-connect (index.js, index.mjs, index.d.ts, voo-connect-browser.js, voo-connect-browser.d.ts, check.js, package.json). Zero dependencies, Node 18+. Never edit or rewrite the kit.
1. ENV: VOO_BASE (https://voosquare.com), VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY, VOO_SIGNAL_SECRET from the environment. Never commit or log them. These are NOT the merchant API keys Gatevoo issues to its own merchants.
2. SETUP: one module (lib/voo.js) with createVooConnect({ base: VOO_BASE, clientId, clientSecret, apiKey, redirectUri: 'https://gatevoo.com/auth/voosquare/callback', eventPrefix: 'gv', outboxFile: a file on the persistent volume (or a store on our database) }). voo.events.start(5000) at boot; on SIGTERM voo.events.stop() then await voo.events.drain({ timeoutMs: 5000 }).
3. LOGIN: merchants sign up and log in with VooSquare only. GET /auth/voosquare → voo.startLogin(req, res). "Start free" → /auth/voosquare?signup=1&return_to=/dashboard, "Log in" → /auth/voosquare?return_to=/dashboard. GET /auth/voosquare/callback → const { user, returnTo } = await voo.handleCallback(req, res); merchants keyed by a unique voo_id; never match by email; save email, name, country and referred_by = user.voo_ref once. Start our session, redirect to returnTo. On VooError show "Login did not finish" with a Try again link.
4. LOGOUT: clear our session, redirect to voo.logoutUrl('https://gatevoo.com/').
5. AFFILIATE CLICKS: app.use(voo.captureAttribution()) on Gatevoo's own site and dashboard routes; serve voo-connect/voo-connect-browser.js at /voo-connect-browser.js and add <script src="/voo-connect-browser.js" defer></script> to Gatevoo's marketing pages. Do NOT add either to the hosted pay pages buyers see.
6. EVENTS: only for money paid to Gatevoo itself. If Gatevoo charges a merchant a plan or fee: voo.events.spend({ eventId: voo.events.id('pay', <fee payment reference>), vooId: <merchant voo_id>, valueUsd, plan, label: 'Gatevoo <plan or fee>', occurredAt }) and planStarted / planRenewed for plans; refund → voo.events.refund({ ..., originalEventId }); dispute → voo.events.chargeback({ ..., originalEventId }). NEVER send spend, wallet_topup or any money event for payments buyers make to other Zedapex tools or merchants through Gatevoo invoices: the tool that sold sends its own events, so Gatevoo sending them would count the money twice. Optional: voo.events.activity('invoice_paid', { eventId: voo.events.id('inv', invoice.id), vooId: <merchant voo_id>, valueUsd: <USD received>, label: 'Invoice paid (USDT)' }) with no buyer data (no addresses, emails or names).
7. SUMMARY (optional): GET /api/voosquare/summary → voo.summaryHandler(async (vooId, period) => unknown ? null : { status: 'active', metrics: [{ key: 'invoices_paid', ... }, { key: 'received_usd', ... }], open_url: 'https://gatevoo.com/dashboard' }), within 1.5 s.
8. SUPPORT: keep the widget; optional POST /hooks/voosquare/support → voo.supportWebhook(...).
9. REFERRALS: no referral or affiliate balances, commissions or withdraw buttons in Gatevoo; any referral screen links to https://voosquare.com/app#referrals.
10. CHECK: node voo-connect/check.js --base $VOO_BASE --client-id $VOO_CLIENT_ID --client-secret $VOO_CLIENT_SECRET --api-key $VOO_API_KEY --redirect-uri https://gatevoo.com/auth/voosquare/callback --logout-uri https://gatevoo.com/ and fix every FAIL line.
```

### Affleego

**What it is for VooSquare:** Affleego operates **separately** and is **not** in the VooSquare affiliate program (owner
decision 2026-10-05): **Voo ID login only, no affiliate events**. No `ref` / `vclick` / `coupon` hand-off. Slug
`affleego`, event prefix `al`. Keep the Affleego brand.

**Install:** kit + env vars as in section 2, with `affiliate: false` in `createVooConnect`. Do **not** add
`captureAttribution()` or the browser snippet (if a shared layout includes the snippet, give it `data-off`).

**Admin → Products → Affleego:** URL `https://affleego.com` · Launch path `/dashboard` · SSO on · Redirect URIs `https://affleego.com/auth/voosquare/callback`
and `https://affleego.com/` · Summary URL optional · copy the credentials.

**Events and when:**

| When | Call |
|---|---|
| Login | nothing to send (VooSquare knows) |
| Affiliate program | **nothing**: no `spend` for commission, no `refund`/`chargeback` for commission, no CPA. The affiliate engine ignores every Affleego event anyway. |
| Optional, for the member's dashboard only | `activity('offer_joined' \| 'conversion', …)` |
| Optional, for Admin → Revenue only | `spend` for a paid Affleego plan or fee, `refund` / `chargeback` against it (never commission) |

Summary metrics (optional): `offers_running`, `conversions`, `earnings_usd`.

**Prompt for Affleego's AI builder / developer:**
```
Connect Affleego (https://affleego.com) to VooSquare login (Voo ID) using the Voo Connect kit. Keep the Affleego brand and all features. Affleego is NOT part of the VooSquare affiliate program: no affiliate hand-off, no affiliate events. Follow every step, then show me the changed files and a test checklist.

0. KIT: copy the folder sdk/voo-connect from the voosquare-app repo into this project as ./voo-connect (index.js, index.mjs, index.d.ts, voo-connect-browser.js, voo-connect-browser.d.ts, check.js, package.json). Zero dependencies, Node 18+. Never edit or rewrite the kit.
1. ENV: VOO_BASE (https://voosquare.com), VOO_CLIENT_ID, VOO_CLIENT_SECRET, VOO_API_KEY from the environment. Never commit or log them.
2. SETUP: one module (lib/voo.js) with createVooConnect({ base: VOO_BASE, clientId, clientSecret, apiKey, redirectUri: 'https://affleego.com/auth/voosquare/callback', eventPrefix: 'al', affiliate: false }). Only if you send the optional events in step 6: voo.events.start(5000) at boot and on SIGTERM voo.events.stop() then await voo.events.drain({ timeoutMs: 5000 }).
3. LOGIN: KEEP Affleego's existing sign-up and login (and admin logins); ADD "Continue with VooSquare" next to them. GET /auth/voosquare → voo.startLogin(req, res). "Sign up" → /auth/voosquare?signup=1&return_to=/dashboard, "Continue with VooSquare" → /auth/voosquare?return_to=/dashboard. GET /auth/voosquare/callback → const { user, returnTo } = await voo.handleCallback(req, res); unique nullable voo_id column; find the user by user.voo_id first. Not found: (a) a logged-in Affleego user ("Connect your VooSquare account" in settings, /auth/voosquare?return_to=/settings) gets user.voo_id saved; (b) else, only if user.email_verified is true AND one Affleego account has that same email, verified by Affleego itself, and no voo_id yet, save user.voo_id on it; (c) else create a new user with email, name, country. Never link by an unverified email, never replace a voo_id. Start our session, redirect to returnTo. On VooError show "Login did not finish" with a Try again link.
4. LOGOUT: clear our session, redirect to voo.logoutUrl('https://affleego.com/').
5. NO AFFILIATE HAND-OFF: do not add voo.captureAttribution() or voo-connect-browser.js. Do not pass ref, vclick or coupon to VooSquare.
6. EVENTS (optional, never for commission): for the member's VooSquare dashboard, voo.events.activity('offer_joined' | 'conversion', { eventId: voo.events.id(<type>, <a never-reused id of that record, e.g. its UUID or reference>), vooId, label: '<offer name>' }); for VooSquare's revenue report only, voo.events.spend({ eventId: voo.events.id('pay', <payment reference>), vooId, valueUsd, plan, label: 'Affleego <plan or fee>' }) for a paid Affleego plan or fee, with refund / chargeback ({ originalEventId }) against it. Never personal data, never negative values.
7. SUMMARY (optional): GET /api/voosquare/summary → voo.summaryHandler(async (vooId, period) => unknown ? null : { status: 'active', metrics: [offers_running, conversions, earnings_usd], open_url: 'https://affleego.com/dashboard' }), within 1.5 s.
8. SUPPORT: <script src="https://voosquare.com/widget.js" data-product="affleego" defer></script> on every page (data-email, data-name when logged in). Optional POST /hooks/voosquare/support → voo.supportWebhook(...).
9. A small "Part of VooSquare" link in the footer to https://voosquare.com/app.
10. CHECK: node voo-connect/check.js --base $VOO_BASE --client-id $VOO_CLIENT_ID --client-secret $VOO_CLIENT_SECRET --api-key $VOO_API_KEY --redirect-uri https://affleego.com/auth/voosquare/callback --logout-uri https://affleego.com/ and fix every FAIL line. Then test: Sign up with a new email → land on the dashboard → log out (you end on https://affleego.com/).
```

---

## 6. Reference

| Kit export | What it does |
|---|---|
| `createVooConnect(options)` | The kit for one tool (options in `index.d.ts`). |
| `voo.startLogin(req, res)` / `voo.handleCallback(req, res)` | Login start and callback (state, prompt=signup, hand-off, code exchange, id_token check). |
| `voo.authorizeUrl({ state, prompt, ref, vclick, coupon })` | The `/oauth/authorize` URL, if you build your own flow. |
| `voo.exchangeCode(code)`, `voo.verifyIdToken(token)`, `voo.userinfo(accessToken)`, `voo.logoutUrl(returnTo)` | The single OAuth steps. |
| `voo.captureAttribution()`, `voo.readAttribution(req)`, `voo.clearAttribution(res)` | The `voo_attr` first-party cookie (ref, vclick, coupon; 60 days; last click wins). |
| `voo.events.spend / refund / chargeback / planStarted / planRenewed / planCancelled / walletTopup / activity / track` | Queue events. `voo.events.id(...)` makes stable ids. |
| `voo.events.start(ms) / stop() / flush() / drain() / pending() / failures()` | The sender and the outbox. |
| `voo.support.send(...)`, `voo.support.thread(id)` | Support API. |
| `voo.users.get(vooId)` | Look up a member with the API key. |
| `voo.summaryHandler(fn)`, `voo.supportWebhook(fn)`, `voo.isFromVooSquare(req)` | Calls from VooSquare to the tool. |
| `voo.hashSignal(value)` | Your own hash for fraud hints in `signals`. |
| `verifyHmac(raw, sig, secret)` / `verifyGatevooSignature(...)`, `signHmac(raw, secret)` | HMAC-SHA256 webhooks. |
| `voo-connect-browser.js` → `window.VooConnect.params() / decorate(url) / refresh() / clear()` | Landing pages. Attributes: `data-domain`, `data-links`, `data-off`. |
| `check.js` | Self-test CLI (`--help`). |

The kit only uses what [INTEGRATION.md](INTEGRATION.md) promises and what [API_VERSIONING.md](API_VERSIONING.md) freezes,
and it ignores response fields it does not know, so a newer VooSquare never breaks it.
