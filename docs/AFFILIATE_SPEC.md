# VooSquare Affiliate Program: content and product spec

Status: draft v1 for owner review (Dchessking). For the designer building the live preview and the engineer implementing it later.
Companion file: `docs/AFFILIATE_TERMS.md` (terms and conditions, draft for legal review).

> **Owner updates 2026-10-05 (this spec is rewritten to match them):** RevShare and approved CPA are **instant** (holds are admin settings, **all 0 by default**), a customer is **qualified at the first counted payment**, **credits that have been used are non-refundable** (a tool refund never claws back; chargebacks and proven fraud still do), and contest scores are final at the contest end. **Affleego is not part of the affiliate program** (it runs separately: no commission, no CPA, not an offer; it stays a VooSquare product). **Caps are hard-locked**: Vooads and Replyvoo at most 35%, every other product at most 50%. Positive manual adjustments above $500 need a second finance/admin approval. Source of truth: `docs/AFFILIATE_DECISIONS.md` → "Owner update 2026-10-05" and "Owner update 2026-10-05 (2)".
Voice: follows `docs/BRIEF.md` writing rules. Every number in this file that is a price we do not know yet, or a sample figure on a screen, is labelled **Example** or shown as `{set in admin}`. Never present an Example number as a real result.

Conventions in this file
- `{curly}` = a value filled by the system or set in admin.
- **Example** = a proposed or sample value. The designer shows it as written; the engineer reads it from admin settings.
- "Customer" = a person who signed up through an affiliate link and pays for a Zedapex product.
- "Partner" and "affiliate" mean the same thing in copy. Use "affiliate" in legal text and the admin, "partner" sparingly in marketing copy.

---

## 1. Program overview and positioning

### 1.1 What the program is
The VooSquare Affiliate Program pays media buyers, creators, communities and agencies for bringing new paying customers to VooSquare and every Zedapex tool. One affiliate account and one link family cover the Voo system: VooSquare Premium, Spyvoo, Joinvoo, Vooads, Replyvoo, Castvoo and Landvoo. (Affleego is a Zedapex product that runs separately and is **not** part of the affiliate program.)

- Site: **affiliate.voosquare.com**. Main menu item on voosquare.com: **Affiliates**.
- Sign in with the same **Voo ID** used for every Zedapex tool. No new password.
- Default deal: **lifetime RevShare** from 20% to 50%, by monthly tier.
- **CPA** (one fixed amount per qualified customer, up to $300) and **Hybrid** (smaller CPA plus smaller RevShare) are available by approval.
- Payouts in crypto (USDT TRC20 and BTC; more networks optional), sent within 1 to 3 business days of a request.

### 1.2 Who it is for
1. Media buyers who already run paid traffic (Meta, TikTok, Google, native, push) and want an offer they understand from the inside.
2. Telegram channel and community owners in trading, iGaming, e-commerce and affiliate marketing.
3. YouTubers, course creators and coaches who teach media buying.
4. Agencies that set up tracking and ads for clients.
5. Affiliate managers and networks with buyer communities.

### 1.3 Why media buyers should promote VooSquare (positioning)
Positioning line: **The offer you already use, paid for life.**

Reasons, in the order the landing page uses them:
1. **You sell to people like you.** Every buyer needs research, creatives, tracking, follow-up and a checkout. The Voo tools cover those steps, so your audience already has the problem.
2. **One link, every tool, for life.** A customer you bring is yours across every Zedapex product they ever pay for, including tools we launch later. A buyer who starts with Spyvoo and later adds Joinvoo and Replyvoo pays you on all three.
3. **Subscriptions pay every month.** Most Voo products are monthly plans, so commission repeats for as long as the customer stays.
4. **Built by a buyer for buyers.** Dchessking runs paid traffic across Nigeria, Kenya, South Africa, Ghana and Cameroon. The tools come from that work, and so does this program: clear rules, fast crypto payouts, real tracking.
5. **Tracking you can check.** Sub IDs, server postbacks, Telegram alerts and a log of every event. No black box.
6. **Fast crypto payouts.** USDT or BTC within 1 to 3 business days of your request.
7. **Free tools for affiliates.** Approved affiliates get the products they promote on a free affiliate seat (Example: Spyvoo and Vooads demo credits) so they can make honest content. Confirm with owner.

### 1.4 Definitions (used everywhere: UI, terms, code)
| Term | Meaning |
|---|---|
| **Referred customer** | A person whose Voo ID was created after clicking your link (or entering your code) within the attribution window. The referral is saved once on their Voo ID and never changes (`voo_ref`). |
| **Attribution window** | 60 days from click to Voo ID creation (**Example**, set in admin). First Voo ID creation wins. Existing Voo ID holders cannot be re-attributed. |
| **New paying customer** | A referred customer whose first counted payment on any Zedapex product is their first ever payment to Zedapex (VooSquare or any tool). |
| **Qualified customer ("FTD")** | A new paying customer, qualified at their **first counted payment** (no second payment, no waiting period), unless they are banned. A product can be set to "Second payment" in the admin (stricter). Shown in the UI as **Qualified FTD**. Counted in the month it qualifies. Payments on products outside the program (Affleego) never qualify anyone. |
| **Counted payment** | A VooSquare order with status `paid`, or a `spend` event from a tool in the program, with the same exclusions as Admin → Revenue. Affleego spend is never a counted payment. |
| **Net revenue** | What the customer paid, minus refunds, chargebacks and taxes collected (VAT or sales tax). We do **not** deduct our payment processing costs. |
| **Lifetime** | For as long as the customer pays and your affiliate account is active and in good standing. |
| **Hold** | Time an earning waits before it can be paid. **0 by default for everything** (earnings are instant). Admin may set a hold per source in Program settings → Earnings timing (`settings.holds`); it applies to earnings created after it is saved. |
| **Refund rate** | (Refunded + charged-back customers) ÷ new paying customers, over the same 2-month window used for tiers. |

### 1.5 How this sits next to the existing member referral program
VooSquare already has a simple member referral program (README, Referral payouts): every member has a link, rates 10% / 20% / 30% by paying referrals, minimum payout $300, tier applies to all past and future earnings.

Recommendation:
1. **Keep one referral code per Voo ID and one ledger.** A customer is attributed to one person only. No double commission.
2. **Members stay on the member program.** When an affiliate application is approved, the account switches to affiliate rules **from the approval date**. Earnings before that date stay on member rules.
3. **Affiliate tier rates apply forward only** (the rate on the payment date). The member program's "current tier applies to all earnings" rule should not carry over: at 20% to 50% across hundreds of customers it makes finance unpredictable and makes downgrades take money back.
4. **Unify the minimum payout at $50 for USDT (TRC20)** for both programs. Reasons: the TRC20 network fee is about $1, $300 makes small referrers wait months and is the most common support question in programs like this, and one rule is easier to explain. Keep BTC at $100 minimum and bank or mobile money (member program only) at $100 because of fees. Keep "one open request at a time" so finance volume stays manageable.
5. Customers referred under the member program before approval keep counting for the affiliate after approval, at affiliate rates, for payments made after approval.

### 1.6 Key numbers at a glance
| Item | Value |
|---|---|
| RevShare | 20% to 50% lifetime, by tier |
| Tier basis | Qualified FTDs, average of the last 2 months |
| AI-heavy tool cap (Vooads, Replyvoo) | 35% |
| Other tools cap | 50% |
| Caps are hard limits | The API refuses a cap above 35% (Vooads, Replyvoo) or 50% (others), even for the owner |
| Inner Circle | 0% (excluded) |
| Gatevoo | 0% unless admin enables |
| Affleego | Not part of the program (no RevShare, no CPA) |
| CPA | By approval, up to $300 (Replyvoo top plan) |
| Qualification | First counted payment |
| RevShare hold | **None (instant)**. Admin setting, default 0 days |
| CPA hold | **None once approved**. Admin setting, default 0 days |
| Quality gate | Refund rate above 8%: no upgrade. Above 15%: drop one tier |
| Payout | USDT TRC20, BTC; 1 to 3 business days; minimum $50 (USDT), $100 (BTC) |
| CPA reduction notice | 14 days (7 days minimum for an affiliate-specific deal, see 2.7) |
| CPA increase | Immediate |

---

## 2. Deals per product

### 2.1 Commission base
- RevShare = Net revenue × rate, where rate = min(your tier rate, product cap).
- RevShare applies to every counted payment from a referred customer, for life: first payment, renewals, upgrades, overages (Joinvoo 2¢ subscribers), credit packs.
- Plan prices are an admin-owned catalogue (Deals and products → Plan catalogue). A tool's first `plan_started` / `plan_renewed` for a plan the catalogue does not have adds it as provisional (with the amount sent); the admin confirms or corrects it. After that, tool events never change a catalogue price: they record what the customer paid, and a different amount is flagged for the admin to review.
- CPA amounts are set by hand in admin. The admin screen shows a **suggested CPA** beside each plan: one month of the plan's price, rounded to the nearest $5, capped at $300. Pay-as-you-go products: 50% of the qualifying first purchase. Admin can accept or type any amount up to $300.

### 2.2 Deal table
"Price" is the plan catalogue (affiliate back office → Deals and products → Plan catalogue). It is **admin-owned**: a tool's first `plan_started` for a plan the catalogue does not have adds it as provisional, the admin confirms it, and after that tool events never change a price (a different amount is only flagged for review). Plan names and list prices below are the tools' own (2026-10-05); CPA and Hybrid amounts are **examples only: the owner decides every CPA amount**. A suggested CPA is one month of the list price, never above it, at most $300.

| Product | Brand colour | Price (synced) | RevShare cap (hard max) | CPA (approval only) | Hybrid (approval only) | Hold | Qualifies at |
|---|---|---|---|---|---|---|---|
| **VooSquare Premium** | Green #00A86B | $20/mo | 50% | Example $20 | Example $10 + 15% | None (admin setting, default 0) | First payment |
| **Paid rooms** (except Inner Circle) | Green | `{set per room}` | 50% (admin can exclude a room) | None by default | None | None | First payment |
| **Inner Circle with Dchessking** | Night | $299/mo | **0%** | **None** | **None** | n/a | Excluded |
| **Spyvoo** | Blue | Free; Starter $29/mo, Pro $79/mo, Agency $199/mo (yearly $290 / $790 / $1,990) | 50% | Example $25 (Starter), $75 (Pro), $195 (Agency) | Example $15 + 15% / $40 + 15% / $100 + 15% | None | First payment |
| **Joinvoo Basic** | Joinvoo brand | $30/mo by default (set in Joinvoo's admin), then 2¢ per subscriber over the included amount | 50% | Example $25 | Example $15 + 15% | None | First payment |
| **Joinvoo Pro** (deposit tracking) | Joinvoo brand | $99/mo by default (set in Joinvoo's admin) | 50% | Example $95 | Example $50 + 15% | None | First payment |
| **Vooads** | Orange | Plans Starter $49, Pro $149, Scale $349, Agency $799/mo; pay-as-you-go credit packs $19, $49, $99, $249 | **35% (hard cap)** | Example: plans $45 / $145 / $300 / $300; first credit purchase of $49+ pays $20, $99+ pays $45 | Example $15 + 10% (first purchase $49+) | None (commission on credits used is final) | First payment or purchase |
| **Replyvoo** | Yellow | Spark (free); Starter $29, Growth $79, Pro $149, **Business $299**, **Titan $599**/mo; Black (contact sales) | **35% (hard cap)** | Example $25 / $75 / $145 / **$295 (Business)** / **$300 (Titan, the top CPA)**; Black set by the owner per deal | Example $15 + 10% / $40 + 10% / $75 + 10% / $150 + 10% / $150 + 10% | None | First payment |
| **Castvoo** | Blue | Starter $19/mo, Growth $49/mo, Scale $99/mo (7-day free trial) | 50% | Example $15 / $45 / $95 | Example $10 + 15% / $25 + 15% / $50 + 15% | None | First payment |
| **Landvoo** | Pink (tool brand only, never used on affiliate UI chrome) | Example: Starter $19/mo, Pro $49/mo `{set in admin}` | 50% | Example $20 / $50 | Example $10 + 15% / $25 + 15% | None | First payment |
| **Gatevoo** | Black and white | Waitlist | **0% unless admin enables** (then cap 50%) | None | None | n/a | n/a |
| **New tools added later** | From product record | Synced | Default 50% (35% max for AI-heavy tools), admin sets per product | Off until admin sets | Off until admin sets | None by default | First payment default |

**Not in the program:** **Affleego** (affleego.com) operates separately. It earns no RevShare and no CPA, is not an offer, deal, link-builder destination, creative, contest or postback product, and its `spend` events are ignored by the affiliate engine (no qualification, activation, tier, health or contest effect). It remains a VooSquare product outside the affiliate program.

Holds: "None" means the commission is **Available** the moment the payment is counted (or the CPA is approved). Admin may set a hold per source (credits used, VooSquare orders, card-paid VooSquare orders, CPA) or per product (it can only lengthen the source hold); see 2.5.

### 2.3 CPA rules
1. CPA is **by approval only**, per affiliate and per product. Eligibility opens at Elite tier, or earlier by manager recommendation.
2. A CPA conversion is created when a referred customer becomes qualified (first counted payment) on a CPA-enabled product. Status: `pending review` → `approved` → `available` at once (unless admin set a CPA hold), or `declined` with a reason.
3. **Every CPA conversion is approved or declined by an admin or a CPA fraud-check manager.** Nothing pays automatically.
4. **Caps**: each CPA deal has a monthly cap (Example default: 50 qualified customers per product per month). Conversions above the cap fall back to RevShare at your tier rate for that customer, so nothing goes unpaid.
5. **One payment model per customer.** A customer pays you CPA or Hybrid or RevShare, fixed at the moment they qualify, by the deal you had then.
6. **Clawback**: an approved CPA is reversed if the customer's payment is charged back (or a VooSquare order is refunded by admin) within 90 days of qualifying, or through a two-person fraud reversal when fraud is proven (within 180 days of payout). A tool refund of used credits never reverses anything. Reversed amounts show as **owed** and come out of future earnings first.
7. Highest CPA in the program: **$300** for the Replyvoo top plan.

### 2.4 Hybrid rules
- Hybrid = smaller CPA (Example: 50% of the standard CPA) plus RevShare at your tier rate minus 10 points (minimum 10%), still limited by the product cap.
- Same approval, review, cap and clawback rules as CPA; no hold by default.
- Suggested formula shown in admin; final values are manual.

### 2.5 Holds (all 0 by default)
Earnings are instant. Each row is an admin setting in Program settings → Earnings timing (`settings.holds`, 0 to 120 days). A hold applies to earnings created after it is saved; the hourly job releases held earnings when their date comes. A product's own hold (Deals and products) can only lengthen the source hold. The dashboard shows "On hold" only when it is above zero.

| Earning | Default hold | Setting | Starts |
|---|---|---|---|
| RevShare on credits used in a tool (`spend`) | **0 days (instant)** | `spend_days` | When the `spend` event is received |
| RevShare on VooSquare orders paid by Gatevoo, crypto or manual | **0 days (instant)** | `order_days` | When the order is paid |
| RevShare on VooSquare orders paid by card (Paystack, Flutterwave, Stripe, custom API) | **0 days (instant)** | `card_order_days` | When the order is paid |
| CPA / Hybrid CPA part | **0 days (available once approved)** | `cpa_days` | When the CPA is approved |
| CPA of `cpa_long_cents` ($100) or more, or in an affiliate's first `cpa_new_days` on CPA | **0 days** | `cpa_long_days` | When the CPA is approved |
| Extra review time ("Need more time" on a CPA review) | 14 days | `review_extend_days` | When a reviewer asks for it (review time only, not a hold) |
| Sub-affiliate override | Follows its source commission (instant by default) | n/a | When the source commission becomes available |
| Contest prizes | Added to Available when results are signed off (scores are final at the contest end) | n/a | Sign-off date |
| Manual adjustments | Instant; positive adjustments above $500 wait for a second finance/admin approval | `adjustments.four_eyes_cents` | When added (or approved) |

Before the affiliate's 5th qualified customer, commissions wait as **Waiting for activation** (not a hold); they become Available the moment the 5th customer qualifies.

### 2.6 Product caps applied to tiers
| Tier rate | VooSquare, Spyvoo, Joinvoo, Castvoo, Landvoo | Vooads, Replyvoo (hard cap 35%) | Inner Circle |
|---|---|---|---|
| 20% Starter | 20% | 20% | 0% |
| 25% Pro | 25% | 25% | 0% |
| 30% Elite | 30% | 30% | 0% |
| 35% Master | 35% | 35% | 0% |
| 40% Partner | 40% | 35% | 0% |
| 45% Senior Partner | 45% | 35% | 0% |
| 50% Legend | 50% | 35% | 0% |

### 2.7 Price and deal changes
- Product prices sync from tools automatically. A price change changes commission amounts from the next payment, never the rate.
- **CPA increases apply immediately** and are announced.
- **CPA reductions need notice**: 14 days for program-wide CPA changes; for a custom deal on one affiliate, at least 7 days. The affiliate sees the scheduled change on the Offers page with the date it takes effect. Customers who qualify before that date keep the old CPA.
- Changes to RevShare rates, tier thresholds or product caps: 30 days notice (proposed; see Terms). Caps can never go above the hard limits (35% Vooads and Replyvoo, 50% others).
- Pausing a CPA for suspected fraud on one affiliate's traffic is immediate and is not a reduction.

### 2.8 Worked examples (labelled Example in UI)
- **Example**: An Elite affiliate (30%) refers a customer who pays $99/mo for Joinvoo Pro for 6 months. RevShare = 6 × $99 × 30% = $178.20.
- **Example**: A Legend affiliate (50%) refers a customer on Replyvoo at $129/mo. Rate is capped at 35%: $45.15 per month.
- **Example**: A Partner affiliate with an approved Replyvoo CPA refers a customer on the $299 plan. The first payment qualifies the customer; CPA = $300 after review, available at once.

---

## 3. Tier ladder

### 3.1 How tiers work (rules for copy and code)
1. **Score** = average qualified FTDs of the last 2 complete calendar months (Africa/Lagos reporting time zone). A brand-new affiliate's first month uses one month only.
2. **Tier is set on the 1st of each month** from the score.
3. **Fast lane up**: if your qualified FTDs in the current month alone reach the next tier's threshold, you move up that day, without waiting for the 1st. Upgrades still need the quality gate to pass.
4. **Grace month**: if your score falls below your tier, you keep it for one month and see a warning. If it is still below the next month, you drop.
5. **Drop at most one tier per month**, whatever the score.
6. **Quality gate** (refund rate over the same 2-month window):
   - above 8%: no upgrade that month (you keep your tier);
   - above 15%: drop one tier on the 1st, without grace;
   - the gate only applies once you have at least 10 new paying customers in the window, so one refund does not punish a new affiliate.
7. **Legend needs approval**: reaching 400+ puts the account in a review queue. While waiting, you earn at Senior Partner.
8. Rate applies to payments made while you hold the tier. It is not applied backwards.
9. Admin can set a **tier floor** for a negotiated deal (Example: "Partner until 31 Dec").

### 3.2 Tiers
Colours keep to the VooSquare palette (green, lime, night) with two metal accents. No pink, no ruby.

| # | Tier | Qualified FTDs (2-month avg) | RevShare | Badge colour | Perks |
|---|---|---|---|---|---|
| 1 | **Starter** | 0–9 | 20% | Slate #8A9A93 on white | General manager; brand kit; Academy for affiliates; Telegram alerts; postbacks; payouts within 3 business days; all contests |
| 2 | **Pro** | 10–29 | 25% | VooSquare green #12C784 | Everything in Starter; new creatives 48 hours before public release; custom sub-ID reports export; contest score × 1.05 |
| 3 | **Elite** | 30–74 | 30% | Deep green #00774B | Private manager (after one full month at Elite, or earlier by approval); **CPA and Hybrid eligibility** (apply per product); payouts within 2 business days; contest score × 1.10; free affiliate seats on tools you promote |
| 4 | **Master** | 75–149 | 35% | Lime #C9F65B on night | Custom coupon codes; custom landing pages built with Landvoo on request; creative requests (Vooads team makes 3 custom creatives per month, Example); contest score × 1.15 |
| 5 | **Partner** | 150–249 | 40% | Teal #0FA3A3 | Payouts within 1 business day; **custom CPA amounts** (negotiated); raised CPA caps; quarterly strategy call with the Zedapex team (Example, confirm with owner); contest score × 1.20 |
| 6 | **Senior Partner** | 250–399 | 45% | Gold #C9A445 on night | Early access to new tools before launch; co-branded landing pages and creatives; priority postback support; contest score × 1.25 |
| 7 | **Legend** | 400+ (approval) | 50% | Night #0A1611 with lime #C9F65B outline | Custom deal (rates, CPA, caps, payout schedule); direct line to Dchessking's team; seat in Inner Circle at no cost while Legend, subject to seats (Example, confirm with owner; commission on Inner Circle stays 0%); contest score × 1.25 |

Contest multipliers never apply to the "Rising" prize (Starter and Pro only), so new affiliates compete on equal terms there.

### 3.3 Tier movement examples (shown in the "How tiers work" drawer, labelled Example)
- **Example**: August 12 qualified FTDs, September 10. Average 11. October tier: **Pro**.
- **Example**: You are Elite. September 22, October 20, average 21. November: grace month, still Elite, with a warning. If the average stays under 30 in December, you move to Pro (one tier down only).
- **Example**: You are Pro and reach 30 qualified FTDs on 18 October. You move to Elite that day.
- **Example**: Average 40 but refund rate 9%. You stay at your current tier this month.

### 3.4 Tier progress copy (dashboard card)
- Title: **Your tier: {tier}** · `{rate}% RevShare`
- Progress line: **{n} of {next_threshold} qualified FTDs this month toward {next_tier}**
- Sub line: "2-month average: {avg}. Tier for next month is set on {date}."
- Fast lane hint (when within 20% of next threshold): "{remaining} more qualified FTDs this month moves you to {next_tier} straight away."
- Grace warning: "Your 2-month average is {avg}, under {tier}'s {threshold}. You keep {tier} for {month} (grace month). Keep {threshold} on average to stay."
- Quality warning (8%+): "Refund rate {x}% over the last 2 months. Above 8% we hold upgrades; above 15% the tier drops by one. Your manager can help find the source."
- Legend pending: "You reached Legend volume. Our team is reviewing your account. You earn at Senior Partner until then."

---

## 4. Page-by-page copy

### 4.0 Global
- Main site menu (voosquare.com): **Affiliates** → affiliate.voosquare.com
- Affiliate site top nav (signed out): Logo · How it works · Products · Tiers · Payouts · FAQ · **Log in** · **Become an affiliate** (primary)
- App sidebar (signed in): Home · Offers · Links · Reports · Postbacks · Creatives · Academy · Contests · Payouts · Manager · Notifications · Settings
- Mobile: bottom bar with Home, Links, Reports, Payouts, More.
- Footer: Affiliate terms · Program FAQ · Contact your manager · voosquare.com · "Zedapex Limited, Lagos" · "Commissions are never guaranteed. What you earn depends on your traffic and the customers who stay."

### 4.1 Affiliate landing page (affiliate.voosquare.com)

**Hero**
- Eyebrow (mono): `VOOSQUARE AFFILIATES`
- H1: **The tools media buyers use. Paid to you for life.**
- Alt H1 (A/B): **Send buyers to VooSquare. Earn on every tool they pay for.**
- Sub: One Voo ID link covers VooSquare, Spyvoo, Joinvoo, Vooads, Replyvoo, Castvoo and Landvoo. Lifetime RevShare from 20% to 50%, CPA up to $300 by approval, crypto payouts in 1 to 3 business days.
- Primary CTA: **Become an affiliate**
- Secondary CTA: **See the deals**
- Under CTA (small): "Free to join. Sign in with your Voo ID. Approval in about 2 business days."
- Hero visual (designer): animated dashboard card: a tier ring filling, a Telegram alert sliding in ("Qualified FTD · Joinvoo Pro · sub1=fb_ng_v3"), a USDT payout row ticking to Paid. Every number on it carries a small **Example** tag.

**Strip under hero (4 facts)**
- 20% to 50% lifetime RevShare
- CPA up to $300, by approval
- USDT and BTC, 1 to 3 business days
- One link for 7 tools (Affleego is not in the program)

**Value props (section title: Why buyers promote VooSquare)**
1. **Your audience already needs this.** Research, creatives, tracking, follow-up, checkout. Every buyer pays for these somewhere. The Voo tools cover each step.
2. **One customer, every tool.** The customer you bring is yours across every Zedapex product they pay for, including tools that launch later.
3. **Monthly plans, monthly commission.** Most Voo products are subscriptions. Your share repeats for as long as the customer stays.
4. **Tracking you can check.** Sub IDs, server postbacks with logs, and Telegram alerts for every sign-up, payment and payout.
5. **Paid in crypto, quickly.** Request a payout and we send USDT or BTC within 1 to 3 business days.
6. **A manager who answers.** Every affiliate gets a manager from day one. Bigger affiliates get a private one.

**How it works (4 steps)**
1. **Apply with your Voo ID.** Tell us where your traffic comes from. You see the whole dashboard straight away.
2. **Get approved.** We review applications in about 2 business days. Earnings start from approval.
3. **Share your links.** Pick a product, add sub IDs, use our creatives. Track every click, sign-up and payment.
4. **Get paid.** Commission is available the moment your customer pays. Request a payout in USDT or BTC.

**Product showcase (section title: What you promote)**
Cards in funnel order, each with product icon, brand colour tint, one-line pitch, "Who buys it", commission line.
| Product | One-line pitch | Who buys it | Commission line |
|---|---|---|---|
| VooSquare Premium | Every Academy track, premium rooms and a monthly live campaign breakdown with Dchessking. | Buyers who want to learn faster from people running real spend. | Up to 50% lifetime |
| Spyvoo | Search live Facebook and Instagram ads from every country and see why the long runners work. | Buyers looking for angles before they spend. | Up to 50% lifetime |
| Joinvoo | Tracks every real Telegram join, sign-up and deposit and sends them to Meta, TikTok and Snapchat. | Anyone running ads to Telegram. | Up to 50% lifetime, CPA up to Example $100 |
| Vooads | AI ad videos, images and hooks in every size, in Pidgin, Swahili and French, checked against Meta's rules. | Buyers who need more creatives each week. | Up to 35% lifetime |
| Replyvoo | AI Closers answer every Telegram and website chat in seconds and send the payment link. | Teams losing leads in slow inboxes. | Up to 35% lifetime, CPA up to $300 |
| Castvoo | Broadcasts and drip sequences that send each Telegram group the message written for them. | Channel owners with large lists. | Up to 50% lifetime |
| Landvoo | Landing pages built to pass review and convert paid traffic. | Buyers tired of rejected pages. | Up to 50% lifetime |
Note under grid: "Affleego runs separately and is not part of the affiliate program. Gatevoo, our crypto checkout, is on a waitlist and is not part of the program yet. Inner Circle is not commissionable."

**Tier ladder (section title: The more customers you bring, the higher your share)**
- Intro: "Your tier is set each month from your average qualified FTDs over the last two months. Hit the next level mid-month and you move up that day."
- Visual: 7-step staircase with names, thresholds, rate, 2 headline perks each (from 3.2).
- Footnote: "Vooads and Replyvoo pay up to 35% because AI costs more to run. Legend needs approval. A qualified FTD is a new paying customer, counted at their first payment. RevShare is available instantly."

**CPA section**
- Title: **Prefer a fixed amount per customer?**
- Body: "Elite affiliates, and others we approve, can run CPA or Hybrid deals on selected products. CPA goes up to $300 per qualified customer on Replyvoo's top plan. Every CPA conversion is checked by our team; once approved it is available to withdraw."
- Table: 4 Example rows (Joinvoo Pro Example $100; Replyvoo top plan up to $300; Spyvoo Pro Example $80; VooSquare Premium Example $20), each tagged Example except the $300 cap.
- CTA: **Apply for CPA** (signed in) / **Become an affiliate** (signed out)

**Payouts section**
- Title: **Paid in crypto within 1 to 3 business days**
- Body: "Request your available balance in USDT (TRC20) or BTC. We send it within 1 to 3 business days, faster at higher tiers. Minimum $50 in USDT, $100 in BTC. We cover the TRC20 network fee."
- Visual: 4 balance states as a row: On hold → Available → Requested → Paid.

**Contests teaser**
- Title: **Monthly races, seasonal challenges**
- Body: "Leaderboards scored on qualified FTDs, with prizes for the top affiliates and a separate prize for newer ones. Rules and anti-fraud checks are published before each contest starts."
- Card: current contest name, days left, prize pool tagged Example.
- CTA: **See contests**

**Testimonials section**
- Title: **From affiliates in the program**
- Designer placeholder, 3 cards: **PLACEHOLDER: add real ones. Do not publish invented quotes.** Each card: photo, name or handle, country, tier badge, quote (max 30 words), product promoted.
- Optional founder note (draft for Dchessking to approve): "I built these tools because I needed them for my own campaigns. If you run traffic, you already know who needs them. Send them over and we pay you for as long as they stay."

**FAQ (12)**
1. **Who can join?** Anyone 18 or older with a Voo ID can apply. We approve affiliates with real traffic sources: ad accounts, channels, communities, audiences or client work.
2. **Can I see the dashboard before approval?** Yes. You see every page, create links and set up postbacks right away. You start earning on payments made after your account is approved.
3. **What is a qualified FTD?** A new paying customer you referred, counted at their first payment. No second payment, no waiting period. Tiers and contests count qualified FTDs.
4. **How long do I earn from a customer?** For life: for as long as the customer pays and your account is active and in good standing.
5. **Do I earn on every tool?** On every tool listed on the Offers page, including tools that launch later. Affleego is part of VooSquare but runs separately and is not in the affiliate program (no commission). Inner Circle is excluded and Gatevoo is excluded until we turn it on.
6. **How is my tier decided?** From your average qualified FTDs over the last two complete months, set on the 1st. You can also move up mid-month if this month alone reaches the next level.
7. **Can I drop a tier?** Yes, by one tier at most per month, and only after a grace month. A refund rate over 15% drops one tier without grace.
8. **How do CPA deals work?** CPA is by approval. Each conversion gets a fraud and duplicate check; once approved it is available to withdraw. A chargeback within 90 days, or proven fraud, reverses it.
9. **When and how do I get paid?** Request your available balance in USDT (TRC20) or BTC. We send within 1 to 3 business days. Minimum $50 in USDT, $100 in BTC.
10. **How long do cookies last?** Your link holds a visitor for 60 days. If they create their Voo ID in that time, they are your customer for life.
11. **Can I run ads on the VooSquare brand name?** No bidding on VooSquare, Zedapex or any tool name in search ads, and no ads that look like they come from us. Full rules are in the affiliate terms.
12. **Can I promote it as a way to make money?** No income claims. Promote what the tools do. Do not promise results from trading, betting or ads, and follow the ad platform's rules and the law in every country you run.
13. **Do you share customer details?** No. You see a customer reference, country, product, plan, payments and status. Names, emails and contact details stay private.
14. **What if I already referred people as a member?** They stay yours. After approval, their new payments pay at your affiliate rate.

**Final CTA**
- H2: **Your audience already buys tools like these. Get paid for sending them to ours.**
- Button: **Become an affiliate**
- Small: "Free to join. Read the [affiliate terms]. Earnings depend on your traffic and are never guaranteed."

### 4.2 Sign-up flow
Entry: **Become an affiliate** → Voo ID sign-in (existing VooSquare login; `prompt=signup` for new users) → 4 steps. Progress bar labelled "Step {n} of 4". Save on each step; leaving and returning resumes.

**Step 1: About you**
- Title: **Tell us who you are**
- Fields:
  - Display name (public on leaderboards) · help: "Shown on contest leaderboards. Use a handle if you prefer."
  - Type: Individual / Company · if Company: Company name, Country of registration
  - Country of residence (select)
  - Telegram username (required, used by your manager) · help: "Your manager contacts you here."
  - WhatsApp (optional)
  - Preferred language: English / French / Swahili / Portuguese / Other
- Button: **Continue**

**Step 2: Your traffic**
- Title: **Where will your customers come from?**
- Traffic sources (multi-select chips): Meta ads · TikTok ads · Google ads · Snapchat ads · Native · Push · Telegram channel or group · YouTube · Instagram or TikTok organic · X · Email list · Website or blog · SEO · Community or course · Agency clients · Other
- Main geos (multi-select countries, top 5) · help: "Countries you send most traffic to."
- Monthly volume (select): Under $1k ad spend · $1k–$10k · $10k–$50k · $50k–$200k · $200k+ · I do not run paid ads
- Audience size if organic (optional number + platform)
- Products you plan to promote (multi-select of active products)
- Button: **Continue**

**Step 3: Your experience**
- Title: **Show us your work**
- Years in performance marketing: Under 1 · 1–2 · 3–5 · 5+
- Verticals you have run (chips): Trading · iGaming · E-commerce · Lead gen · SaaS · Education · Other
- Networks or programs you work with (text, optional) · help: "For example the networks you run offers with today."
- Links (up to 5): channel, site, YouTube, portfolio · help: "Links help us approve you faster."
- How you plan to promote VooSquare (textarea, 50–600 chars) · placeholder: "Example: Reviews of Joinvoo on my Telegram channel for Nigerian buyers, plus Meta ads to a Landvoo page in Kenya."
- How did you hear about us? (select)
- Button: **Continue**

**Step 4: Payout and agreement**
- Title: **Almost done**
- Payout method (can skip, set later): USDT (TRC20) address · BTC address
- Checkboxes (required):
  - "I have read and accept the [Affiliate terms]."
  - "I will not make income claims or run traffic that breaks ad platform rules or local law."
  - "I am 18 or older."
- Optional: "Send me affiliate news and contest announcements by email."
- Button: **Submit application**

**Submitted toast**: "Application sent. You can explore the dashboard while we review it."

### 4.3 Pending approval state
- Persistent banner on every page (amber, not red): **Your application is under review.** "You can create links, set up postbacks and browse creatives now. Earnings start from the day you are approved. Most reviews take about 2 business days."
- Banner action: **View application** (read-only summary) · **Message support**
- Dashboard numbers show live click and sign-up counts with a tag **Tracking, not earning yet**.
- Payout page: button disabled, text "Payouts open after approval."
- Offers page: CPA "Apply" buttons disabled with tooltip "Available after approval."
- If more info is needed: banner changes to **We need a bit more from you** · "{manager_name}: {request_text}" · button **Reply**.

**Application declined**
- Title: **We could not approve your application**
- Body: "Reason: {reason}. You can apply again after {date} (30 days). Your Voo ID and the tools you use are not affected."
- Reasons list (admin picks one or more): Not enough information about your traffic · Links did not work or showed no activity · Traffic type we do not accept (incentivised, spam, adult) · Country or vertical we cannot serve yet · Duplicate account · Terms breach on another account.

### 4.4 Approved welcome
- Modal (light confetti via `VS.confetti`, respects reduced motion):
  - Title: **You are approved, {first_name}.**
  - Body: "Your account earns from today at Starter, 20% lifetime RevShare. Your manager is {manager_name}."
  - Checklist (each item ticks when done):
    1. Create your first link
    2. Connect Telegram alerts
    3. Add a payout address
    4. Take the 10-minute "Start here" lesson
  - Buttons: **Create a link** (primary) · **Meet your manager**
- Email subject: "You are approved for VooSquare Affiliates"
- Telegram (if connected): see section 8.

### 4.5 Dashboard home (overview)
Layout mobile first: balance card, today/month row, tier card, manager card, announcements, quick links.

**Balance card**
- Label: **Available to withdraw** · `{available}` (big, countUp)
- Row: On hold `{hold}` · Requested `{requested}` · Paid all time `{paid_total}`
- If owed > 0: "Owed {owed}. New earnings repay this first." with **Why?** link
- Button: **Request payout** (disabled below minimum: "{gap} more to reach the $50 minimum")

**Today / This month** (tabs: Today · Yesterday · This month · Last month)
Tiles: Clicks · Sign-ups · New paying customers · Qualified FTDs · Revenue from your customers · Commission
- Each tile shows change vs previous period, or "New this period".
- Designer sample values tagged **Example**.

**Tier card**: copy from 3.4, ring progress, link "How tiers work".

**Manager card**
- Photo, name, role ("General manager" / "Private manager"), languages, hours (Example: "Mon–Sat, 9:00–19:00 WAT")
- Buttons: **Message on Telegram** · **Book a call** (Private manager only)
- Line for General: "Reach Elite to get a private manager."

**Announcements**
- List of up to 3, newest first: title, date, one line, **Read**. Pinned items first. Types: new offer, CPA change (with effective date), new creatives, contest, policy update.

**Quick links**: New link · Creatives · Postbacks · Academy

**Top sub IDs this month** (small table): sub1 · clicks · sign-ups · qualified FTDs · commission.

### 4.6 Offers page
- Title: **Offers** · Sub: "Every product you can promote, your rate on it and the deals open to you."
- Card per product (brand tint, icon, status Live / New / Coming soon):
  - Name, one-line pitch (from 4.1)
  - **Your rate**: `{min(tier_rate, cap)}%` lifetime RevShare · cap note if capped ("Capped at 35% on this product")
  - Plans and prices (synced) with Example tag if not synced
  - CPA: "Not active" · **Apply for CPA** (Elite+) / "Opens at Elite" / "CPA {amount} · cap {cap}/month · hold {days} days" if active
  - Scheduled changes: "From {date}: CPA {old} → {new}" (amber)
  - Buttons: **Get link** · **Creatives** · **How to promote** (Academy lesson)
- Excluded block (collapsed): "Not commissionable: Inner Circle. Gatevoo (waitlist)."
- CPA application modal: product, plan, expected monthly qualified customers, traffic source, geos, sample creative or landing link, note. Submit text: "Sent to your manager. You get an answer within 3 business days."

### 4.7 Links and sub IDs
- Title: **Links**
- Link builder:
  - Destination (select): VooSquare home · Premium page · each tool's site · a specific tool page (deep link field, must be on an approved domain) · Affiliate custom landing (Master+)
  - Sub IDs: sub1 to sub5, help: "Use these to tag campaign, ad set, ad, creative and placement. Letters, numbers, _ and - only, 64 characters each."
  - Click ID macro (optional): `click_id` field for your tracker's macro, Example `{{ad.id}}` or `{clickid}`
  - Short link toggle
  - Output: `https://go.voosquare.com/{code}?p={product}&sub1=...` with **Copy** and **QR code**
- Coupon codes (Master+): list with code, product, discount (set by admin), uses.
- Saved links table: name, destination, sub1, clicks, sign-ups, qualified FTDs, commission, created, actions (copy, edit name, archive).
- Help box: "Your link sets a 60-day window. If the visitor creates a Voo ID in that window, they are your customer for life on every tool."

### 4.8 Reports (supporting page)
- Filters: date range, product, sub1–sub5, country, device, event type.
- Group by: day, week, month, product, sub ID, country.
- Columns: clicks, unique clicks, sign-ups, sign-up rate, new paying customers, qualified FTDs, revenue, commission, refunds, chargebacks, refund rate, EPC (commission ÷ clicks).
- Customers tab: one row per customer reference (see section 7).
- CPA tab: conversions with status and reason.
- Export CSV.

### 4.9 Postbacks
- Title: **Postbacks** · Sub: "Send events to your tracker (Keitaro, Binom, RedTrack, Voluum or your own) the moment they happen."
- Add postback: Name · URL (https only) · Method GET/POST · Events (checkboxes) · Product filter (all or chosen) · Active toggle · **Send test**
- Events: `click` (optional, off by default), `signup`, `first_payment`, `payment` (every counted payment), `qualified` (FTD), `cpa_pending`, `cpa_approved`, `cpa_declined`, `refund`, `chargeback`, `tier_change`.
- **Macros**
| Macro | Value |
|---|---|
| `{click_id}` | Click ID you passed on the link |
| `{sub1}`…`{sub5}` | Your sub IDs |
| `{event}` | Event name from the list above |
| `{conversion_id}` | Unique ID of this event (use it to de-duplicate) |
| `{customer_ref}` | Pseudonymous customer reference, Example `C-7F3KQ2` |
| `{product}` | Product slug, Example `joinvoo` |
| `{plan}` | Plan name |
| `{sale_amount}` | Payment amount in USD (net of tax) |
| `{commission}` | Your commission for this event in USD |
| `{payout_type}` | `revshare`, `cpa` or `hybrid` |
| `{currency}` | Always `USD` |
| `{status}` | `pending`, `approved`, `declined`, `reversed` |
| `{country}` | Customer country, ISO 2-letter |
| `{device}` | `mobile`, `desktop`, `tablet` |
| `{tier}` | Your tier at the time of the event |
| `{offer_id}` | Offer ID |
| `{affiliate_id}` | Your affiliate ID |
| `{timestamp}` | Unix time of the event |
| `{decline_reason}` | Reason code for `cpa_declined` |
- Example URL shown: `https://tracker.example.com/postback?cid={click_id}&event={event}&payout={commission}&sub1={sub1}`
- Logs table (last 30 days): time, event, URL sent (macros filled), response code, response time, attempt number, **Resend**. Filters: failed only.
- Retry rule copy: "If your server does not answer with a 2xx within 5 seconds, we retry 5 times over 24 hours."
- Errors: "URL must start with https://" · "That host could not be reached. Check the domain." · "Test sent. Your server answered {code}."

**Telegram alerts setup** (section on Postbacks page and in Notifications)
- Title: **Get alerts in Telegram**
- Body: "Connect the VooSquare Affiliates bot and choose what you want to hear about. It takes one tap."
- Button: **Connect Telegram** → opens `t.me/{bot}?start={one_time_token}`; after start, page updates live: "Connected as @{username}." **Send test alert** · **Disconnect**
- Alert toggles (defaults in brackets): Sign-ups [off] · First payments [on] · Qualified FTDs [on] · CPA approved or declined [on] · Refunds and chargebacks [on] · Tier changes [on] · Payout updates [on] · Contest rank changes [off] · Announcements [on] · Daily summary at {time} [on] · Weekly summary [on]
- Quiet hours: from / to, time zone.
- Group option: "Send alerts to a Telegram group instead" (add bot to group, paste code).

### 4.10 Creatives and brand kit
- Title: **Creatives** · Sub: "Approved ads, banners, videos and copy. Every download and copy button includes your tracking link."
- Filters: product, format (video 9:16, 1:1, 4:5, 16:9; banner sizes; Telegram post; email; story), language (English, Pidgin, Swahili, French), geo, new.
- Card: preview, product, format, language, "New" or "Early access" tag (Pro+ 48h, Elite+ 7 days), **Download** (with link in caption file), **Copy post with my link**, **Get link** (with sub1 prefilled `cr_{creative_id}`).
- Brand kit tab: logos (light, dark, icon), product icons, colours with hex, fonts, Dchessking approved photos, do and do not sheet.
- Do and do not (copy):
  - Do: show what the tool does, use real screenshots, say "Start free" where the product offers it, add your own experience.
  - Do not: change logos, use our names in search ads, say you are VooSquare or Zedapex, promise income, use fake reviews, show Inner Circle as a paid offer.
- Copy blocks per product: 3 hooks, 2 short posts, 1 long post, each with `{your_link}` filled.
- Request creative (Master+): form with product, format, language, angle.

### 4.11 Education portal (Academy for affiliates)
Title: **Affiliate Academy** · Sub: "Short lessons on how to promote each product, stay compliant and scale what works." Uses the existing lesson system (`VSL`). Certificates at the end of each module.

**Module 0: Start here** (required for first payout, 10 minutes)
1. How the program pays: RevShare, CPA, Hybrid
2. What counts as a qualified FTD
3. Holds, balance states and payouts
4. Your first link in 3 minutes
5. The five rules that get accounts closed

**Module 1: Know the Voo system**
1. The buyer's funnel: research, acquire, track, convert, retain, collect
2. Which tool solves which problem
3. Cross-selling: why one customer often pays for three tools
4. Reading the Offers page

**Module 2: Promoting each product**
1. VooSquare Premium: selling learning to buyers
2. Spyvoo: demo an ad search on camera
3. Joinvoo: the Telegram tracking problem in one minute
4. Joinvoo Pro: talking about deposits and cost per FTD
5. Vooads: showing before and after creatives
6. Replyvoo: slow inboxes lose leads
7. Castvoo: broadcasts and drips for channel owners
8. Landvoo: pages that pass review

**Module 3: Tracking**
1. Links, sub IDs and naming that stays readable
2. Setting up postbacks in Keitaro, Binom and RedTrack
3. Reading your reports: EPC, sign-up rate, qualified rate
4. Telegram alerts you will actually use
5. Fixing missing conversions

**Module 4: Compliance**
1. Ad platform rules for software and finance-adjacent offers
2. No income claims: what you can and cannot say
3. Trading and gambling audiences: law and platform rules by country
4. Brand bidding, trademarks and impersonation
5. Disclosures: telling your audience you earn a commission
6. Why we decline CPA conversions

**Module 5: Using the brand kit**
1. Logos, colours and fonts
2. Editing our creatives without breaking the rules
3. Writing your own hooks in Pidgin, Swahili and French
4. Building a review page with Landvoo

**Module 6: Scaling**
1. From Starter to Elite: where volume comes from
2. Paid traffic to SaaS offers: testing budgets and kill rules (Example numbers only)
3. Content that keeps working: tutorials, comparisons, case studies
4. Running a Telegram channel that converts to tools
5. Moving to CPA or Hybrid: when it makes sense
6. Working with your private manager

### 4.12 Contests page
- Title: **Contests**
- Current contest hero: name, dates, countdown, prize pool (**Example**), your rank, your score, gap to next rank ("{n} qualified FTDs behind #{rank-1}"), **Rules**.
- Leaderboard: rank, display name (masked option: "Hide my name on leaderboards" in settings shows "Affiliate #{id}"), tier badge, score, provisional or final tag. Your row pinned at bottom if outside top 20.
- Notice: "Scores are final when the contest ends. Customers who are charged back or fail checks are removed."
- Prizes table.
- Rules (accordion): eligibility, scoring, multipliers, tie-break, anti-fraud, payout of prizes.
- Upcoming contests: cards.
- Past winners: contest, dates, top 3 (display names), prize paid status. Placeholder text until real winners exist: "Past winners appear here after the first contest ends."

### 4.13 Payouts page
- Title: **Payouts**
- Balance states (4 cards, with one-line explanation each):
  - **On hold** `{hold}` (shown only when above zero): "Earnings waiting for a hold set by the program. There is no hold by default: commission is available at once."
  - **Available** `{available}`: "Ready to withdraw."
  - **Requested** `{requested}`: "Sent to our finance team."
  - **Paid** `{paid}`: "Sent to your wallet, with the transaction hash."
- Next release line: "{amount} becomes available on {date}."
- Request payout:
  - Method: USDT (TRC20) [default] · BTC · (admin-enabled others: USDT ERC20, USDC, ETH)
  - Address shown masked with edit link
  - Amount: full available balance (fixed, as today) · fee line: "Network fee: covered by Zedapex" (TRC20) / "Network fee about {fee}, deducted" (BTC)
  - Delivery: "We send within {n} business days" (3 Starter–Pro, 2 Elite–Master, 1 Partner+)
  - Button: **Request {amount}**
- Rules text: "Minimum $50 in USDT, $100 in BTC. One open request at a time. You can cancel while it says Requested. Your address is locked while a request is open."
- History table: date, amount, method, status (Requested, Sending, Paid, Not sent, Cancelled), tx hash (link to explorer), note.
- KYC block (only if required by finance): "Before your first payout over {kyc_threshold} we need to confirm who you are." **Start verification**.
- Earnings ledger tab: date, customer ref, product, type (RevShare, CPA, Hybrid, Contest, Adjustment, Reversal), amount, status, release date.

### 4.14 Manager page
- Card: photo, name, role, languages, hours, response time target ("Replies within 1 business day" General; "within 4 working hours" Private, Example).
- Buttons: **Message on Telegram** · **Email** · **Book a call** (Private only)
- "What your manager can help with": deals and CPA applications, tracking setup, creatives, compliance questions, contest questions.
- Private manager teaser for Starter–Pro: "A private manager is assigned at Elite, after your first full month there. You can also ask for one if you bring large volume from day one."
- Shared notes (manager-written, visible to affiliate): goals for the month, agreed deals with dates.

### 4.15 Notifications
- In-app bell list + page with filters (All, Money, Customers, Deals, Contests, Announcements).
- Channels per type: In-app (always), Email, Telegram.
- Item copy samples:
  - "Qualified FTD on Joinvoo Pro · {customer_ref} · sub1 {sub1}"
  - "CPA declined on Replyvoo · {customer_ref} · Reason: Charged back"
  - "{amount} is now available to withdraw"
  - "Payout of {amount} sent · tx {short_hash}"
  - "You moved to Elite. Your rate is now 30%."
  - "From {date}, Spyvoo Pro CPA changes from {old} to {new}."

### 4.16 Settings and profile
- Profile: display name, avatar, type, company, country, languages, Telegram, WhatsApp, "Hide my name on leaderboards".
- Traffic profile (editable, changes logged and visible to manager): sources, geos, volume, links.
- Payout details: USDT TRC20 address (checksum verified), BTC address; locked while a request is open; change requires email code.
- Notifications: per type and channel (from 4.15).
- Security: Voo ID sessions (managed by VooSquare), API key for reports (Elite+), IP allowlist for API (optional).
- Tax info: country of tax residence, optional tax ID field, "You are responsible for taxes on your earnings" note.
- Legal: accepted terms version and date, **Download terms**.
- Close affiliate account: "Your accrued earnings stay payable. New earnings stop. Your Voo ID and tools are not affected."

### 4.17 Empty states
| Where | Copy | Action |
|---|---|---|
| Home, no clicks yet | "No clicks yet. Create a link and share it where your audience already is." | Create a link |
| Reports, no data in range | "Nothing in this range. Try a longer period." | Last 30 days |
| Customers tab | "Your paying customers appear here with a reference, product and status." | Get a link |
| Links | "You have no saved links. Build one with sub IDs so you can see what works." | Build a link |
| Postbacks | "No postbacks yet. Add one to send events to your tracker." | Add postback |
| Postback logs | "No events sent in the last 30 days." | Send test |
| Creatives, filter empty | "No creatives match these filters." | Clear filters |
| Contests, none live | "No contest is running right now. The next one is announced here and in Telegram." | Turn on contest alerts |
| Payouts, no history | "No payouts yet. Commission is available the moment your customer pays." | How payouts work |
| Notifications | "You are up to date." | none |
| CPA tab | "You have no CPA deals. CPA opens at Elite or by approval." | See offers |
| Manager notes | "Your manager has not added notes yet." | Message manager |

### 4.18 Error and decline messages
**General errors**
- Network: "Could not reach VooSquare. Check your connection and try again."
- Session ended: "You were signed out. Log in with your Voo ID to continue."
- Permission: "This page opens after approval."
- Payout below minimum: "Your available balance is {available}. The minimum is {min}."
- Open request exists: "You already have a payout request open. Cancel it or wait until it is paid."
- Invalid address: "That USDT (TRC20) address is not valid. Check each character."
- Address locked: "Your payout address is locked while a request is open."
- Link destination not allowed: "Links can only point to VooSquare and Zedapex tool domains."
- Sub ID invalid: "Use letters, numbers, _ and - only, up to 64 characters."
- Rate limit: "Too many requests. Wait a minute and try again."
- Account paused: "Your affiliate account is paused while we review activity. Earnings are held, not lost. Your manager will contact you within 2 business days."

**CPA decline reasons** (code · affiliate-facing text)
| Code | Text shown to affiliate |
|---|---|
| `refund_in_hold` | The customer refunded during the hold. |
| `chargeback` | The payment was charged back. |
| `not_new_customer` | The customer had paid Zedapex before. |
| `self_referral` | The customer is linked to your own account or household. |
| `duplicate_account` | The customer has another Voo ID that already paid. |
| `traffic_source_not_approved` | The traffic came from a source not approved on your CPA deal. |
| `geo_not_approved` | The customer is in a country not covered by your CPA deal. |
| `incentivised` | The sign-up appears to be rewarded or paid for. |
| `fraud_signals` | Our checks found signs of fake or linked sign-ups. Your manager can share what is allowed. |
| `payment_instrument_shared` | The payment method is shared with other referred customers. |
| `coupon_abuse` | A coupon was used outside its terms. |
| `brand_bidding` | The click came from paid search on our brand terms. |
| `over_cap` | Over your monthly CPA cap. This customer pays you RevShare instead. |
| `not_qualified` | The customer did not reach the qualification rule in time. |
| `terms_breach` | Traffic broke the affiliate terms. See the note from your manager. |
Every decline includes an optional manager note and a **Ask about this** button that opens a message to the manager with the conversion ID.

---

## 5. Contest designs (all amounts Example)

Shared rules for every contest
- Eligible: approved affiliates in good standing at start and end; staff and their households excluded; one account per person or company.
- Scoring unit: **qualified FTDs** from customers whose Voo ID was created inside the contest period. A customer counts once even if they buy several products, unless the contest says otherwise.
- **Qualification window**: customers must qualify within 45 days after the contest ends. Results are provisional until then.
- Tier multipliers (3.2) apply to the main board only.
- Tie-break: higher net revenue from contest customers, then earlier time of reaching the score.
- Anti-fraud: any customer declined for fraud signals is removed; if 3 or more are removed, or refund rate on contest customers exceeds 15%, the affiliate is disqualified. Decisions by two staff (contest owner + fraud-check manager). Prizes paid as earnings (Contest type) after results are final, then normal payout rules.
- Zedapex may cancel or change a contest only for fraud or a technical failure, with notice on the contest page.

### 5.1 October FTD Race (monthly)
- Dates: 1–31 October 2026; results final 15 December 2026.
- Scoring: 1 point per qualified FTD on any product. Products with plans of $99/mo or more (Joinvoo Pro, Spyvoo Agency, Vooads Pro and up, Replyvoo Pro and up, Castvoo Scale) score 3 points.
- Minimum to place: 5 points.
- Prize pool **Example $5,000**: 1st $1,500 · 2nd $1,000 · 3rd $700 · 4th–10th $200 each · **Rising prize** (best Starter or Pro affiliate, no multiplier) $400.
- Extra: everyone who reaches 20 points gets an Elite trial for November (tier floor), Example.

### 5.2 Spyvoo Launch Sprint (product launch, 6 weeks)
- Dates: Example 13 October – 23 November 2026.
- Scoring: 1 point per qualified paying Spyvoo customer; Spyvoo Pro scores 2. Spyvoo free sign-ups count for nothing.
- Prize pool **Example $3,000**: 1st $1,000 · 2nd $600 · 3rd $400 · **Milestone bonus** $50 to each affiliate with 10+ points (first 20 affiliates to reach it, $1,000 total).
- Extra: top 3 get early access to the next Spyvoo feature and a featured spot in the Spyvoo creatives library (with permission).
- Specific anti-fraud: one Spyvoo customer per payment instrument; trial-to-paid within 1 hour from the same device cluster is reviewed by hand.

### 5.3 New Geo Challenge (quarterly)
- Dates: Example 1 October – 31 December 2026.
- New geos: set in admin. Example list: Côte d'Ivoire, Senegal, Tanzania, Uganda, Zambia, Egypt, Morocco, India, Philippines, Brazil. Excludes Nigeria, Kenya, South Africa, Ghana, Cameroon.
- Scoring: qualified FTDs from customers whose Voo ID country and payment country are both in the list. Geo mismatch removes the customer.
- Minimum to place: 10 points.
- Prize pool **Example $4,000**: top 5 overall $1,200 / $800 / $500 / $300 / $200 · **Geo leader** $100 for the top affiliate in each listed geo with at least 5 points (up to $1,000).
- Extra: Vooads credits for local-language creatives (Example $50 credit to each placer).
- Reminder copy on page: "Follow the law and the ad platform's rules in every country you run."

---

## 6. Admin and manager backend

Lives at `/admin` → new **Affiliates** group (Business). Permission keys in `src/auth.js` (proposed): `aff.view`, `aff.applications`, `aff.manage_assigned`, `aff.manage_all`, `aff.deals`, `aff.cpa_review`, `aff.contests`, `aff.payouts` (reuses `payments`), `aff.announce`, `aff.settings`, `aff.audit`.

### 6.1 Roles
| Role | Sees | Can do |
|---|---|---|
| **Super admin** (owner, admin) | Everything | Program settings, tiers, caps, product rules, roles, assignments, overrides, Legend approvals, terms versions, all queues |
| **Affiliate manager (General)** | Only assigned affiliates: profile, traffic profile, stats, customer refs, CPA status, payouts status (not wallet addresses in full) | Review applications assigned to them (approve, decline, ask for info), message, notes, recommend CPA, post announcements to their affiliates (needs `aff.announce`) |
| **Private manager** | Only assigned (Elite+) affiliates, same as General plus deal history | Propose custom deals (CPA, Hybrid, tier floor) for Super admin approval, book calls, set monthly goals, request creatives |
| **CPA fraud-check manager** | CPA review queue across all affiliates; fraud signals; customer-level technical data (IP hash, device fingerprint hash, payment instrument hash, email domain); never affiliate payout details | Approve or decline CPA conversions with reason code; flag affiliates; pause CPA on an affiliate; propose clawbacks; mark contest entries |
| **Finance** | Payouts queue, ledgers, balances, wallet addresses, KYC status | Mark Sending, Paid (tx hash required), Not sent; approve clawbacks; contest prize release; CSV export. Four-eyes rules below |
| **Content (Affiliate)** | Creatives, Academy for affiliates | Upload creatives, early-access dates, brand kit, lessons |

Managers see **only their assigned partners**. Super admin assigns. A manager cannot reassign themselves.

### 6.2 Approval workflow (applications)
1. Application submitted → status `pending` → auto-assigned to a General manager (round robin, weighted by language and geo match; admin can override).
2. Auto checks shown on the card: Voo ID age, email verified, duplicate signals (same device/IP/payout address as another affiliate), country on block list, links reachable.
3. Manager actions: **Approve** (sets tier Starter, start date now) · **Ask for info** (message shows in banner) · **Decline** (reason list from 4.3, reapply date) · **Escalate** to Super admin.
4. SLA timer: 2 business days; overdue items surface in Overview → Today.
5. Approval sends email + Telegram + welcome modal.

### 6.3 Assignment rules
- Every affiliate has exactly one General manager.
- Private manager assigned automatically suggested after one full month at Elite+; Super admin confirms. Or manually any time by approval.
- When a manager leaves: their affiliates move to an unassigned queue; Super admin bulk reassigns. Affiliates are notified with the new name.
- Load target per manager (Example): General 300 affiliates, Private 40.

### 6.4 Deals management
- Per product: commissionable on/off, RevShare cap (input limited to the hard cap: 35% Vooads and Replyvoo, 50% others; the API refuses more), default CPA (with suggestion), default Hybrid, extra hold days (default 0), qualification rule (first payment, default; or second payment), monthly cap default. Affleego is not listed (not part of the program).
- Per affiliate deal: product, model (CPA / Hybrid), amount(s), cap, allowed traffic sources, allowed geos, start date, end date, tier floor.
- Changes:
  - Increase: effective immediately, auto-announcement to affected affiliates.
  - Reduction: scheduler forces effective date ≥ today + 14 days (program-wide) or + 7 days (single affiliate); affected affiliates notified at once and 2 days before.
  - Pause for fraud: immediate, reason required, logged.
- Prices come from the plan catalogue (admin-owned; provisional until an admin confirms them), with the time of the last plan event per plan.

### 6.5 CPA review queue
- Columns: conversion ID, affiliate, product/plan, CPA amount, qualified date, risk score, signals, age in queue.
- Sort default: highest risk first, then oldest.
- Detail: customer ref, timeline (click → sign-up → payments → qualification), sub IDs, country (IP country vs profile vs payment country), device, linked customers (cluster view).
- Actions: **Approve** · **Decline** (reason code required, note optional) · **Need more time** (records 14 more days of review time; no hold) · **Flag affiliate**.
- Bulk approve allowed only for risk score below threshold (Example 20) and same affiliate.
- **Fraud signals** (each adds to risk score; weights set in admin):
  1. Same IP or /24 subnet across several referred customers
  2. Same device fingerprint or browser profile cluster
  3. Instant refund or refund request within hours of payment
  4. Disposable or throwaway email domains; many sign-ups with patterned emails
  5. Geo mismatch: IP country, profile country and payment country differ
  6. Velocity spike: sign-ups or payments far above the affiliate's normal rate (Example: 5× 14-day average in 24 h)
  7. Self-referral: customer shares IP, device, payout address, payment instrument or Telegram with the affiliate
  8. Coupon abuse: affiliate coupon used outside allowed geo, plan or count
  9. VPN, proxy, hosting or Tor IPs
  10. Duplicate payment instruments (card hash, wallet address) across customers
  11. Payment made minimum amount once, account never used (no tool activity events)
  12. Click-to-sign-up time under a few seconds, or no click before sign-up (code-only attribution spikes)
  13. Sign-ups from traffic sources not approved on the deal (referrer checks)
  14. Previously declined customer cluster reappearing
- Affiliate-level flags: decline rate over 20% in 30 days triggers auto-pause of CPA and manager alert.

### 6.6 Contest management
- Create: name, type (monthly, launch, geo, custom), dates, eligible products, eligible geos, scoring rules (points per product/plan), minimum to place, multipliers on/off, prize table, Rising prize, milestone bonuses, qualification window, rules text, banner art.
- Live: leaderboard with provisional scores, fraud removals shown to staff.
- Close: freeze, review top N (two staff sign-off), publish results, create prize earnings (type Contest) for Finance.
- Announce: automatic in-app, email, Telegram.

### 6.7 Payouts queue (four-eyes)
- Extends existing Admin → Payouts. Filter by program (member, affiliate), method, tier, amount.
- Statuses as today: `requested` → `processing` (Sending) → `paid` / `rejected` (Not sent) / `cancelled`.
- Four-eyes:
  1. Nobody handles their own payout (existing rule).
  2. Payouts above a threshold (Example $2,000) need **approval by one Finance user and sending by another**.
  3. The same staff member cannot both approve a clawback and mark the affected payout.
  4. Manual adjustments: a reason is always required; a positive adjustment above $500 (setting `adjustments.four_eyes_cents`) waits for a second finance or admin user who is not the requester; an idempotency key and a 60-second duplicate guard (same affiliate, amount and reason) stop double clicks.
- SLA timer per tier (3/2/1 business days); overdue requests highlighted and shown in Overview → Today.
- Each request shows: earnings by product and type, holds, owed, recent CPA declines, risk flags. Finance can **hold** a request (with reason) pending fraud review; affiliate sees "Under review".

### 6.8 Announcements
- Audience: all affiliates, by tier, by manager, by product promoted, by geo, single affiliate.
- Channels: dashboard, email, Telegram.
- Types: new offer, CPA change (requires effective date), creatives, contest, policy, maintenance.
- Pin, schedule, expire.

### 6.9 Audit
Logged with actor, time, before/after: application decisions, assignment changes, deal changes, CPA decisions, tier overrides, tier floors, contest results, payout actions, clawbacks, account pauses and closures, terms version acceptances, data exports. Searchable, CSV export, no deletion.

### 6.10 Program settings (Super admin)
Attribution window, qualification rule, tier thresholds and rates, quality gate %, grace months, product caps, hold days, CPA suggestion formula, payout minimums per method, payout SLA per tier, KYC threshold, enabled payout networks, network-fee policy, reapply waiting days, terms version.

---

## 7. What affiliates can see and what they cannot

**Can see**
1. Their clicks, unique clicks, by link, sub ID, country, device, day.
2. Sign-ups (count) attributed to them, with customer reference and date.
3. Per customer reference: country (ISO), sign-up date, products with plan names, each counted payment (date, amount net of tax), refunds and chargebacks (date, amount), qualified status and date, CPA status and decline reason, commission per payment, current status (active, cancelled, refunded, excluded).
4. Revenue totals from their customers by product and period.
5. Commission ledger, holds, release dates, owed amount, payouts with tx hashes.
6. Their tier, score, refund rate, progress, history of tier changes.
7. Their deals, caps, scheduled changes.
8. Postback logs for their own postbacks.
9. Contest scores and leaderboards (display names only).
10. Their manager's name and contact.

**Cannot see**
1. Customer names, emails, phone numbers, Telegram usernames, Voo ID internal IDs.
2. IP addresses, device fingerprints, exact location below country.
3. Payment instruments, wallet addresses, card data, bank details of customers.
4. What customers do inside tools: searches, ads, chats, broadcasts, pages, leads, deposits they track.
5. Fraud signal details beyond the decline reason code (to avoid teaching evasion).
6. Other affiliates' stats, deals or earnings (only public leaderboard scores).
7. Internal notes by fraud-check managers.

Customer reference = stable pseudonymous ID per affiliate (Example `C-7F3KQ2`), different for each affiliate so references cannot be matched across accounts.

---

## 8. Telegram alerts (VooSquare Affiliates bot)

Format: plain text, no emoji, short, link at end. Amounts in USD. Sample values are Example.

| Alert | Default | Sample text |
|---|---|---|
| Connected | always | "Connected. You will get VooSquare affiliate alerts here. Change them any time: {settings_link}" |
| Application approved | always | "You are approved. You earn 20% lifetime RevShare from today. Your manager is {manager}. Create your first link: {link}" |
| Application needs info | always | "{manager} needs more information about your application: {request}. Reply here: {link}" |
| Sign-up | off | "New sign-up · {product} · {customer_ref} · sub1 {sub1}" |
| First payment | on | "First payment · Joinvoo Pro $99.00 · {customer_ref} · sub1 fb_ng_v3 · commission $24.75 available now" |
| Qualified FTD | on | "Qualified FTD · Spyvoo Pro · {customer_ref}. This month: 18 of 30 toward Elite." |
| CPA approved | on | "CPA approved · Replyvoo Titan · $300.00 · {customer_ref}. Available now." |
| CPA declined | on | "CPA declined · Joinvoo Pro · {customer_ref} · Reason: charged back. Ask your manager: {link}" |
| Chargeback | on | "Chargeback · Vooads $50.00 · {customer_ref}. Commission of $17.50 reversed." (A tool refund of used credits reverses nothing.) |
| Earnings available | on | "$412.60 is now available. Request a payout: {link}" |
| Payout requested | on | "Payout request received: $412.60 in USDT (TRC20). We send it within 2 business days." |
| Payout sent | on | "Payout sent: $412.60 USDT · tx {short_hash} · {explorer_link}" |
| Payout not sent | on | "Your payout of $412.60 was not sent: {reason}. The amount is back in your available balance." |
| Tier up | on | "You moved to Elite. Your RevShare is now 30% on new payments. A private manager will be assigned after your first full month." |
| Grace warning | on | "Your 2-month average is 24, under Elite's 30. You keep Elite in November. Average 30 or more to stay." |
| Tier down | on | "From 1 December your tier is Pro (25%). Your 2-month average was 21." |
| Quality warning | on | "Refund rate on your customers is 9.4% over the last 2 months. Upgrades are held above 8%. Talk to {manager}: {link}" |
| Deal change scheduled | on | "From 18 October, Spyvoo Pro CPA changes from $80 to $60. Customers who qualify before then keep $80." |
| Deal increase | on | "Joinvoo Pro CPA is now $110 for your account, from today." |
| Contest started | on | "October FTD Race has started. Prize pool $5,000 (Example). Rules: {link}" |
| Contest rank change | off | "You are #4 in October FTD Race. 3 qualified FTDs behind #3." |
| Contest results | on | "October FTD Race results are final. You placed #6: $200 added to your balance." |
| Account paused | always | "Your affiliate account is paused while we review recent activity. Earnings are held. {manager} will contact you within 2 business days." |
| Announcement | on | "{title}. {one_line}. {link}" |
| Daily summary | on | "Yesterday: 1,240 clicks · 38 sign-ups · 6 first payments · 4 qualified FTDs · $186.40 commission. Available: $412.60." |
| Weekly summary | on | "This week: 21 qualified FTDs, $1,032.15 commission. Top sub1: tt_ke_hook2 (9 FTDs). Elite progress: 21 of 30." |

Bot commands: `/balance`, `/today`, `/month`, `/tier`, `/link {product}`, `/manager`, `/alerts`, `/stop`.

---

## 9. Engineering notes (for later implementation)
1. **Attribution** reuses `voo_ref`. Links go through `go.voosquare.com/{code}` which sets a first-party cookie (60 days) and forwards `ref` and sub IDs to the destination; tools pass `ref` into `/oauth/authorize?prompt=signup`. Store click record (click_id, subs, country, device, referrer) and bind it to the Voo ID on creation.
2. **Events**: no new tool work needed. `spend` events drive RevShare; `plan_started` gives plan; refunds need a new `refund` event type (tools currently do not deduct refunds from `spend`; add `refund` with positive `value_usd` and `original_event_id`). Chargebacks as `chargeback` type. Flag to tool teams.
3. **Ledger**: extend `src/referrals.js` with earning types (revshare, cpa, hybrid_cpa, contest, adjustment, reversal), program (member, affiliate), rate at payment date, hold release date.
4. **Tiers**: nightly job on Africa/Lagos time computes scores, fast lane on each qualification, 1st-of-month tier set, writes tier history.
5. **Postbacks**: queue with retries (5 over 24 h), 5 s timeout, https only, log 30 days.
6. **Telegram bot**: one-time start token, chat_id stored per affiliate, per-type toggles, quiet hours.
7. **Privacy**: customer_ref = HMAC(affiliate_id, customer_id) truncated; never return PII from affiliate APIs.
8. **Subdomain**: affiliate.voosquare.com served by the same server with host routing; Voo ID session shared via parent-domain cookie.

## 10. Open questions for the owner
1. Approve unifying payout minimum at $50 (USDT) for members and affiliates, and switching affiliate tier rates to forward-only.
2. Confirm attribution window (proposed 60 days) and first-Voo-ID-wins.
3. Confirm free affiliate seats on tools (Elite+) and the Legend Inner Circle seat perk.
4. Confirm the quarterly strategy call perk at Partner.
5. Real prices for Spyvoo, Castvoo, Landvoo, Replyvoo lower plans and Vooads packs (Example structures used here).
6. Whether paid rooms other than Inner Circle are commissionable by default (proposed yes).
7. Contest budgets (all Example).
8. KYC threshold for payouts, if any.
