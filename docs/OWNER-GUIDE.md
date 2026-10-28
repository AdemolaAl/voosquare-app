# Running VooSquare day to day (owner guide)

Everything below happens in **/admin** (for example `https://voosquare.com/admin`). Nothing here needs code or a redeploy. Changes go live for members in seconds.

## Start every day on Overview
- **Today** lists what is waiting for you, one button each: open support conversations, room applications, payout requests, orders to approve, email not set up, maintenance or paused sign-ups, areas that are switched off, and backup status. Clear the list from top to bottom.
- **Quick search**: press **Ctrl + K** (Mac: **Cmd + K**) or `/` and type a name, an email, a room, a product or a page. Press `?` to see every shortcut. **G** then a letter jumps to a section (G S Support, G C Customers, G P Payments...).
- If you leave a page with unsaved changes, the admin asks first. Deleting a canned reply, a slide or an announcement line, or hiding a product, shows **Undo** for 6 seconds.

## Turn parts of VooSquare on and off (Settings → Features)
- Each switch (Community, Academy, Blog, Free tools, Referrals, Support, Premium, Paid rooms, Spotlight ads, Announcement bar, Image sharing) works on its own and goes live at once. **Nothing is deleted**: turning an area back on brings everything back exactly as it was. Members see a friendly "turned off for now" page instead of an error.
- **Maintenance mode** shows members a "Back soon" page with your message. You and your team still get in (you see a thin bar). Turn it off the same way.
- **Pause new sign-ups** stops new accounts; existing members log in as usual and new people see your message.

## Tell members what is new (What's new)
Write a short title, one or two sentences and an optional button, then **Post to members**. It shows once as a card on every member's Home. Only the newest live note shows. Switch a note off, edit or delete it from the list.

## Content
- **Site content**: the top card, the **announcement bar** (short lines that rotate; add, reorder, switch on/off, then **Save bar**), the Spotlight sponsor slides and the app store buttons.
- **Academy**: courses, lessons, steps and the quiz at the end of a lesson. **Blog**: posts and categories. Drafts stay hidden until published.
- **Tools**: the free calculators shown to members.

## Add your own classes (VooSquare Academy)
For your own masterclasses, no files and no developer needed. Admin → **VooSquare Academy**:
1. **Add school** (top right). Give it a title (for example "Masterclasses with Ejiro"), a level line and a certificate title. Choose **Who can enrol**: everyone, or only members who hold one certificate (for example Foundations). It shows to members under **More schools** as an **Extra** school and never changes the main path or anyone's pace.
2. On the school's card, **Add module**. Title, summary and order (it goes last unless you change it). A new module has **no exam**: members pass it by finishing its lessons. To add an exam, open the module and use **Add a question**, then **Save exam**.
3. On the module page, **Add lesson**. It starts with three example slides and a live preview: change the title, minutes, objectives and takeaways, rewrite the slides, and add a quiz (up to 5 questions) or leave it empty (members pass the lesson by finishing it). Each slide's `"say"`, plus **Spoken intro** and **Spoken outro**, is what the Teaching voice reads.
4. Members see a school or module as soon as it has a published lesson. When no module in the school has an exam, the certificate is issued when the last lesson is done; otherwise there is a final exam built from your module exams.

Everything you make here carries a **Made in admin** label. It is kept when content reloads from files and on every update. **Delete** works only while nobody has started it (it goes to the recycle bin). Once members have progress, switch **Published** off instead: it hides it and they keep their progress and certificates.

## Community and rooms
- **Community → Rooms**: create or edit rooms, set who can read and post (free, Premium, paid), slow mode, "team posts only", and upload a **picture** (square) and **cover** (wide). "Use house artwork" brings the default back.
- **Applications** (invite-only paid rooms): read the answers, then **Approve** (they get an email with a pay button; the seat is held 7 days) or **Reject** (add a kind note).
- **Moderation**: pin or delete messages, mute members. **Images**: limits for shared pictures. **Rules and welcome**: the house rules every member sees.

## Customers
Open a member to see their spend, orders, rooms and referrals. You can add Premium days, grant a room, mute, **ban** (signs them out everywhere at once), **deactivate** (hides them from the community; everything else keeps working) and, owner only, **erase personal data** for someone who asks to be forgotten (type their email, then `ERASE`; cannot be undone; their orders stay as "Erased member").

## Money
- **Payments**: switch payment methods on and off, set rates per 1 USD, and **approve bank transfers** and other manual payments (check the reference or screenshot, then approve). Card and crypto providers unlock access by themselves through their webhook.
- **Unpaid orders**: opening checkout again for the same plan and method reuses the member's open order, and members can cancel an order they have not paid. A bank-transfer or crypto order nobody paid turns **Expired** after 7 days (Plans → billing setting `pending_expire_days`, 1 to 90). Expired orders are kept, never deleted, and you can still approve one if the money arrives late.
- **Payouts** (referral earnings): members request a payout once their settled balance reaches the minimum. Send the money from the Zedapex wallet or bank first, then open the request, paste the transaction hash or bank reference and click **Mark paid and email them**. Use **Mark as sending** while it is on its way, or **Not sent** with a reason (the amount goes back to their balance). **Four eyes:** nobody can mark their own payout, not even the owner; another team member with payments access does it.
- **Revenue**: money in across VooSquare and every Zedapex tool, in USD. Pick a range (for example **Last 12 months**), day/week/month, sales or tools, a product, chart or table, and **Export CSV**. Links keep the range, so you can bookmark `#revenue?range=12m`.
- **Plans**: the Premium price, period and features, and the referral rules (rates by tier, minimum payout, settling days).
- **Affleego** runs separately: it earns **no commission** of any kind, neither member referrals nor the affiliate program (its spend still shows in Revenue).

## Affiliate custom RevShare deals (owner and program super admins, private)
You (the owner) and the team members you made **program super admins** (Admin → Team, role `aff_admin`) can do this, one affiliate at a time. Managers, finance and fraud check cannot (they get "Only the owner or a program super admin…"). Give `aff_admin` only to people you trust with your margins: a super admin can set up to 90%.
It is never shown on the public affiliate site, the FAQ, the terms or the public API: only that affiliate (on their dashboard) and the team see it.
1. Open **/affiliates → Affiliates →** the affiliate → **Custom deals → Custom RevShare**.
2. Choose **All products** or one product, the **RevShare %** (up to **90%**), and **How long**: **Forever**, **Until a date** (the last day it applies) or **From date to date**.
3. **Up to 50%** the normal caps still apply (Vooads and Replyvoo stop at 35%). **Above 50%** it is a **Special deal**: it overrides the caps for this affiliate only, and you must **confirm** it. On Vooads or Replyvoo (or all products) the confirm warns: "AI tools cost more — this deal may lose money."
4. The affiliate sees a **Special deal** tag (above 50%) on Home, Offers, every commission line and their receipts and statements ("Special deal 70%"), with the end date and days left. They get a Telegram and email message when it starts and 7 days before it ends.
5. It applies to their customers' payments made **inside the dates** only, from the moment you create it (never backwards). When it ends, new payments go back to the tier rate automatically. To stop it early: the deal's **End** button (type END). Every change is in the audit log.
All running custom deals are listed in **Deals and products → Custom RevShare deals**. The audit log shows who created or ended each one.

## Affiliate terms updates (v1.1, 2026-10-05)
- The published terms are `docs/AFFILIATE_TERMS.md`, now **v1.1**. Its "Changes in v1.1" section at the top is exactly what affiliates see in the "We've updated the affiliate terms — what changed" banner and pop-up.
- Affiliates who accepted v1.0 can log in and use everything as before and **keep earning**; only **payout requests** wait until they click **Accept**. New applicants accept v1.1 when they apply.
- Every acceptance is stored with the version and the time (Settings → Legal on the affiliate's side shows their history; the audit log shows `terms.accept`).
- For a future update: change the terms file, add a "Changes in v1.2" section at the top, and set **Terms version** to `v1.2` in Program settings (or ask the developer to raise the version in code). The version can never be set lower than the published one.

## Affiliate refunds (owner rule)
Refunds sent by a tool **never** take commission back, whether they refund used credits or a **plan payment**. Only a card chargeback, your refund of a VooSquare order (Premium, paid rooms) in the admin, or a proven fraud reversal (two people) does.

## Emails
- **Emails** lists every email template (login code, receipts, payouts, room applications, the welcome series, broadcasts...). Click one to see a live preview.
- **Send test to me** sends it to your own inbox (or prints it in the server log if email is not set up).
- You can edit the subject, preheader and HTML. **Reset to new design** puts one template back to the default design; **Reset all templates to default** does it for every one (type `RESET`).
- The welcome series timing and the **Broadcast** tool (an email to members) are on the same page.

## Team and roles (Team)
Invite people by email and tick what they can do: Support (choose which products' conversations they see), Customers, Content, Community moderation, Academy and blog, Payments/finance, Settings, Team. Only owners can make owners. Remove people from the team when they leave. Every change in the admin is recorded in **Audit**.

## Legal pages (Legal)
- **Legal** in the admin holds the **Privacy policy** (`/privacy`) and the **Terms of service** (`/terms`). Both start from a plain-language draft naming Zedapex Limited, Lagos; edit them here (saving an empty box goes back to the draft). They are linked from every footer, sign-up and checkout.
- **Approved by counsel** (owner only, off by default): approval status is recorded for the team and is not displayed on public pages. Turn each switch on only after a lawyer has reviewed that text.

## Settings
- **General**: brand name, support email, social links, the **email provider** (Resend, Brevo or Postmark; values here win over the server variables) and the **reporting time zone** for revenue.
- **Features**: see above.
- **Backups** (owner only): **Download backup** gives you the whole database as one file. Do it before every update and keep it private. VooSquare also keeps a copy every day on the server (the newest 7 by default; change it there). Restoring is never done from the page, on purpose; follow "How to restore a backup" on that page or the README.

## Updates without losing anyone (owner summary)
VooSquare is built so updates can come every week without anyone losing anything. What that means for you:
- **Members keep what they have.** Accounts, Premium days, paid rooms, messages, VooSquare Academy progress and certificates are never removed by an update. Database changes only ever add; a change that fails is undone and the new version refuses to start, so the old one keeps your data exactly as it was.
- **A copy is made before every update**, by itself (Settings → Backups, "Made automatically before an update"), on top of the daily copies. Still click **Download backup** before you approve a deploy.
- **Prices:** when you change the Premium price or a paid room's price, people already paying keep their price and period while they stay members (plus 7 days if they lapse). New people pay the new price. If you lower a price, everyone gets the lower one.
- **Settings apply from now on.** Changing referral rates, school pacing or emails never rewrites what members already earned or received.
- **Deleted by mistake?** Posts, courses, lessons (with members' progress), canned replies, What's new notes and school partners deleted in the admin go to the recycle bin: **Settings → Recycle bin** (owner only) lists them, and **Restore** puts each one back as it was, with the lessons and member progress that went with it. Orders, payouts, earnings and certificates can never be deleted at all.
- **School content:** lessons can be rewritten, reordered, renamed or retired without anyone losing progress, as long as the developer follows the school rules.
- **New features** arrive switched off, are tried by the team first, then by some members, then by everyone. If something misbehaves it can be switched off in seconds.
- **If an update goes wrong:** Railway → Deployments → the last good deployment → **Rollback**. It takes a minute and loses nothing. Restoring a backup is a last resort, done with `RESTORE_FROM` (Settings → Backups → "How to restore a backup").
- Your developer's rule book is `docs/CHANGING-SAFELY.md`. Ask them to tick its pre-deploy checklist every time.

To put VooSquare live or update it, see `docs/DEPLOY-GUIDE.md`.
