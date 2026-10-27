# Changing VooSquare safely

**Read this before you change anything.** It is written step by step, on purpose. Follow the steps exactly, even when they
feel slow. The owner's rule is simple:

> Updates can come every week, but **no member may ever lose anything** (account, money, Premium, rooms, progress,
> certificates, messages) and **nothing that works today may break** for the people already using it.

VooSquare does a lot of this for you automatically. Your job is to not undo that protection. Contents:

1. [The golden rules](#1-the-golden-rules)
2. [What protects the data automatically](#2-what-protects-the-data-automatically)
3. [Set up once: a staging copy](#3-set-up-once-a-staging-copy)
4. [Recipe: change the database (a migration)](#4-recipe-change-the-database-a-migration)
5. [Recipe: rename or remove a column (expand → migrate → contract)](#5-recipe-rename-or-remove-a-column-expand--migrate--contract)
6. [Recipe: add a new feature behind a flag](#6-recipe-add-a-new-feature-behind-a-flag)
7. [Recipe: change a price](#7-recipe-change-a-price)
8. [Recipe: edit VooSquare Academy content](#8-recipe-edit-voo-school-content)
9. [Recipe: change the API that tools use](#9-recipe-change-the-api-that-tools-use)
10. [Settings changes](#10-settings-changes)
11. [Deleting things](#11-deleting-things)
12. [Deploy, step by step (with the checklist)](#12-deploy-step-by-step)
13. [Roll back a bad deploy](#13-roll-back-a-bad-deploy)
14. [Restore a backup](#14-restore-a-backup)
15. [What to do if something breaks](#15-what-to-do-if-something-breaks)
16. [Reference: files and variables](#16-reference-files-and-variables)

---

## 1. The golden rules

Print these. Every rule has a reason in brackets.

1. **Never edit an old migration. Always add a new numbered one.** (Production already ran the old one; your edit would never run there, and the test refuses edited migrations.)
2. **Never `DROP` or `RENAME` a table or column, and never `DELETE` rows, in a migration.** Add new things instead. (Rolling back must always work: the previous release still expects the old columns.)
3. **A new column always has a `DEFAULT` (or allows NULL).** (Existing rows need a value, and old code that does not know the column keeps inserting rows.)
4. **Never put new `CREATE TABLE` or `ADD COLUMN` lines in `src/db.js`, `school.js`, `features.js`, `voice.js` or `aff/core.js`.** Those are the frozen baseline. New schema goes in `src/migrations/`.
5. **Always run `npm test` and see `0 failed`** before you push. Run it twice if you touched timing.
6. **Rehearse on a copy of production data** (`npm run rehearse -- backup.db`) before every deploy that touches the database, payments or school content.
7. **Download a backup before every deploy** (Admin → Settings → Backups → Download backup). VooSquare also makes its own copy, but one in your hands is better.
8. **New features ship switched off** behind a flag, then team only, then a few members, then everyone.
9. **Keep old API fields.** Tools are deployed on their own; they must keep working. Only add fields.
10. **Grandfather prices.** People already paying keep their price. This is automatic; do not bypass `priceFor()`.
11. **Never hard-delete money or achievements.** Orders, payments, payouts, referral and affiliate ledgers, price locks, certificates and the audit log are never deleted. Mark them (`status`, `revoked_at`, `voided`) instead.
12. **Slugs are IDs.** A school, module or lesson slug never changes and is never reused. To rename one, use `"was"` (section 8).
13. **One replica, one volume, same `APP_SECRET` forever.** (Two copies of the app on one database file corrupt it; a new secret logs everyone out and breaks tool logins.)

14. **Never rename a cookie after launch without planning a sign-out.** The sign-in cookie is `__Host-vs_sess` on https (`vs_sess` on plain http), set in one place: `sessionCookie` in `src/config.js`. A new name means every browser's old cookie is no longer read, so **every member is signed out at once** (and the tools' "Continue with VooSquare" asks them to log in again). The `__Host-` prefix is what stops a sister tool on another `*.voosquare.com` subdomain from planting a session VooSquare would read; never drop it, never add a `Domain=` to the sign-in cookie, and never trust the plain `vs_sess` name on https. If a rename is really needed: announce it, deploy at a quiet hour, and expect a wave of logins (login codes by email must be working). The same goes for `vs_aff`, `vs_ref` and `vs_coupon`: a rename loses every pending referral and click.

If a rule is in your way, stop and ask the owner. Do not "just this once".

---

## 2. What protects the data automatically

You do not need to do these, but you need to know they exist so you do not break them.

| Protection | What it does | Where |
|---|---|---|
| **Versioned migrations** | Every database change is a numbered file in `src/migrations/`. Each runs **once**, in order, inside a transaction, and is recorded in the `schema_migrations` table. Starting the app twice changes nothing the second time. | `src/migrate.js`, `src/migrations/` |
| **Safety copy before an update** | When a start has a migration to apply (or, in production, new code), a full copy of the database is written **before anything changes**: `/data/backups/pre-migrate-v<N>-<time>.db`. The newest 3 are kept (`PRE_MIGRATE_KEEP`). They show in Admin → Settings → Backups as "Made automatically before an update". | `src/migrate.js` `preflight()` |
| **Refuse to start on a failed migration** | If a migration throws, everything it did is rolled back, the reason is printed in big letters in the logs, and the app **exits instead of serving** a half-upgraded database. The database is exactly as the previous release left it, so rolling back works. If the safety copy cannot be made (disk full), the migration does not run either. | `src/migrate.js` `runOrExit()` |
| **Health check** | `/healthz` answers 200 only when the database answers and every migration is applied. Railway waits up to 180 seconds for it (`railway.json`), enough for the safety copy and migrations of a large database. | `src/routes/app.js` |
| **Daily backups** | One copy a day in `/data/backups`, the newest 7 kept. | `src/backups.js` |
| **Restore without a shell** | `RESTORE_FROM=<copy name>` puts a copy back on the next start, after saving the current database as `pre-restore-<time>.db`. Never restores the same copy twice. | `src/restore.js` |
| **Recycle bin** | When the team deletes a post, course, lesson (with members' progress), canned reply, What's new note or school partner in the admin, a full copy goes into the `deleted_rows` table first. Owners can list and restore it (`GET /api/admin/recycle-bin`, `POST /api/admin/recycle-bin/restore { batch }`). | `src/trash.js` |
| **Grandfathered prices** | Each paid order stores what was sold (price, period, features). Members keep that price while their access is active (plus 7 days grace). | `src/payments.js`, migration 002 |
| **School content loader** | Lessons are matched by slug, never by position. A lesson that disappears from a file is hidden, never deleted. Progress stays. | `src/school.js` `load()` |
| **Frozen API shapes** | A test calls the tool API and fails if any field tools rely on disappears. | `test/safety.js`, `test/fixtures/api-v1-shapes.json` |
| **Feature switches and flags** | Turn areas or new features off in seconds, without a deploy. Nothing is deleted when something is off. | `src/features.js`, `src/flags.js` |

---

## 3. Set up once: a staging copy

A **staging** copy is a second VooSquare that nobody uses, where you try updates first. You need it before big changes
(payments, migrations that touch a lot of rows, school restructures).

**The quick way, on your computer (do this every time):**

1. Owner: Admin → Settings → Backups → **Download backup**. You get `voosquare-YYYY-MM-DD-HHMM.db`. It holds personal data: keep it private and delete it when done.
2. In the project folder, with your new code: `npm run rehearse -- ~/Downloads/voosquare-2026-10-05-0900.db`
3. Read the output. It must end with **`PASS: healthy, database version N`**. You will see the safety copy and each migration that ran.
4. To click around on the copy: add `--keep`, open `http://localhost:4699`, log in with the owner's email (the login code prints in the window). Press Ctrl+C when done.

`rehearse` never changes your download (it works on a copy) and runs with `SAFE_COPY=1`: **no emails are sent and affiliate jobs (postbacks, Telegram) are off**, so real members and partners are never contacted.

**The full way, on Railway (recommended before risky releases):**

1. Railway → your project → the environment menu at the top → **New Environment** → **Duplicate** production, name it `staging` *(may differ slightly)*. It gets its own service and its own empty volume.
2. In the staging service's **Variables**: set `SAFE_COPY=1`, change `BASE_URL` to the staging address, and **remove** `EMAIL_API_KEY`. Keep `APP_SECRET` different from production.
3. Point staging at your work branch (Settings → Source → Branch) so pushes to that branch deploy there, not to production.
4. To test with real data, put a downloaded backup on the staging volume as `/data/voosquare.db` (follow [section 14](#14-restore-a-backup) on **staging**). Then in staging's admin switch every payment method **off** before testing, so nobody can pay real money there.
5. Never connect a real payment provider's webhook, a real Telegram bot or a real tool's API key to staging.

---

## 4. Recipe: change the database (a migration)

Use this for: a new table, a new column, a new index, or filling in data ("backfill").

**Step 1. Find the next number.** Look in `src/migrations/`. If the last file is `003-recycle-bin.js`, yours is `004`.

**Step 2. Create the file** `src/migrations/004-what-it-does.js` (lower case, dashes). Copy this template exactly:

```js
'use strict';
/*
 * 004 <one or two sentences: what this adds and why>.
 * NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db, h) {
    // A new column: always with a DEFAULT (or nullable). h.addColumn skips it if it already exists.
    h.addColumn('users', 'timezone', "TEXT DEFAULT ''");

    // A new table: always IF NOT EXISTS.
    db.exec(`CREATE TABLE IF NOT EXISTS user_notes(
      id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, body TEXT DEFAULT '', created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_user_notes_user ON user_notes(user_id, id);`);

    // A backfill (optional): fill the new column for existing rows. Only UPDATE or INSERT, never DELETE.
    db.exec("UPDATE users SET timezone='Africa/Lagos' WHERE timezone='' AND country='NG'");
  },
};
```

Rules inside `up()`:
- Use the `db` you are given. Do not `require('../db')`, do not write `BEGIN`/`COMMIT` (the runner wraps your migration in a transaction for you).
- Helpers on `h`: `h.addColumn(table, column, decl)`, `h.hasColumn(table, column)`, `h.hasTable(table)`.
- No `DROP`, no `RENAME`, no `DELETE` (the test checks).
- Keep it fast. A backfill over millions of rows should be done in a later release in small batches from a background job, not here.
- If you throw an error, nothing is applied and the app will not start. That is the point: fail loudly, not halfway.

**Step 3. Lock it:** `npm run lock-migrations`. It records the file's checksum in `test/fixtures/migrations.lock.json`. Commit that file too. After this, the file is frozen: if you find a mistake **after it shipped**, write `005-fix-...` instead.
(Before it ships, while it is only on your computer, you may still edit it: delete its line from the lock file and run the command again.)

**Step 4. Use it in the code.** Remember old rows have the default value. Remember the *previous* release does not know your column: it must keep working if we roll back, which it does as long as you only added things.

**Step 5. Test:** `npm test` (it checks: fresh and old databases end up with the same schema, booting twice changes nothing, the migration is locked, no destructive SQL). Then `npm run rehearse -- <backup>.db`.

**Step 6. Deploy** ([section 12](#12-deploy-step-by-step)). In the Railway logs you will see:
```
[migrate] safety copy before the update: /data/backups/pre-migrate-v4-....db (... bytes, ... ms) — 1 database change to apply (4-what-it-does)
[migrate] applied 004-what-it-does.js (3 ms)
```

---

## 5. Recipe: rename or remove a column (expand → migrate → contract)

You never rename or drop in one go. Example: rename `rooms.topic` to `rooms.category`.

**Release A ("expand"), this week:**
1. Migration `00N-rooms-category.js`: `h.addColumn('rooms', 'category', "TEXT DEFAULT ''")` and backfill `UPDATE rooms SET category=topic WHERE category=''`.
2. Code: **write both** columns on every save; **read** `category`, falling back to `topic` if empty.
3. Deploy. Watch for a week or two.

**Release B ("contract"), at least one week later:**
1. Code: stop reading and writing `topic`.
2. **Do not drop `topic`.** It stays in the database, unused, forever. It costs nothing, and it means rolling back to release A still works.

The same pattern works for: changing a column's type (add a new column with the new type), splitting a table, making a field required (enforce it in code for new data; never add `NOT NULL` to an existing column).

**Removing a feature:** switch it off with its flag or feature switch, then remove the code in a later release. Leave its tables in place.

---

## 6. Recipe: add a new feature behind a flag

1. Open `src/flags.js` and add your flag: `const FLAGS = { 'new-checkout': 'The new checkout screen' };`
2. Server code:
   ```js
   const flags = require('./flags');
   if (flags.on('new-checkout', ctx.user)) { /* new code */ } else { /* old code, untouched */ }
   ```
   App code: `VS.me.flags['new-checkout']` is `true` or `false` (sent with `GET /api/me`).
3. Deploy. The flag starts **off** for everyone, so nobody sees anything new.
4. Turn it on step by step (Admin API, `settings` permission; from the browser console on /admin:
   `fetch('/api/admin/flags',{method:'PUT',headers:{'content-type':'application/json','x-vs':'1'},body:JSON.stringify({key:'new-checkout',mode:'staff'})})`):
   - `mode: 'staff'`: only the team. Test it yourselves for a few days.
   - `mode: 'percent', percent: 10`: the team plus 10% of members (always the same members).
   - `mode: 'on'`: everyone.
   - Something wrong? `mode: 'off'`: everyone is back on the old code in seconds, without a deploy.
5. A few weeks after it is `on` for everyone, a later release deletes the old code path and the flag.

For whole areas (Community, Academy, Premium...), use the **Feature switches** the owner already has (Admin → Settings → Features).

---

## 7. Recipe: change a price

**Owner (no code):** Admin → Plans and referrals (Premium) or the room's settings (paid rooms) → change the price or the period → Save. That is all.

What happens automatically (tested in `test/safety.js`):
- **New members** pay the new price.
- **Members who are already paying** keep the price and period of their last payment while their access is active, plus a 7-day grace period after it ends. Their checkout shows "Your price is kept while you stay a member".
- If the new price is **lower** (and the period is not shorter), everyone gets the lower price at once.
- An order that was started at the old price but approved after the change still gives exactly what was bought (the price, period and features are stored on the order).
- A member who lets access lapse for more than 7 days pays the price of the day when they come back.

To end grandfathering for everyone (rare; tell members first): `PUT /api/admin/settings/grandfathering { "value": { "enabled": false } }`. To change the grace period: `{ "value": { "enabled": true, "grace_days": 14 } }`.

**Developer:** every place that charges must call `priceFor(item, id, user)` from `src/payments.js` and store `period_days` and `terms` on the order. Never read the price from the settings directly when charging.

Premium **features** (perks) are stored on each order as a record. Access itself is the same for all Premium members, so **if you remove a perk from Premium, members who already paid lose it too**. Before removing a perk, keep it for current members (check `price_locks` for the user) or wait until their period ends, and tell them.

---

## 8. Recipe: edit VooSquare Academy content

School content is in `src/seed/school/<school>/<NN>-<module>.json` (format: `docs/SCHOOL_BRIEF.md`). It loads on every start and when someone clicks Admin → VooSquare Academy → **Reload content**. Members' progress is stored against the lesson's database row, which is found by the **school + module slug + lesson slug**. So:

| You want to... | Do this | Progress |
|---|---|---|
| Fix a typo, rewrite slides, change a quiz | Edit the file, keep the slugs. | Kept. |
| Reorder lessons or modules | Move them in the file / change `order`. Keep the slugs. | Kept. |
| Add a lesson | Add it with a **new** slug that was never used before. | Others kept; the new lesson starts empty. |
| Rename a lesson's slug | Change `slug` and add the old one: `"slug": "new-name", "was": ["old-name"]`. Keep `"was"` in the file forever. | Kept (same row). |
| Move a lesson to another module of the same school | Put it in the other file with `"was": ["its-slug"]` if the slug changes, or just move it (keep the slug and add `"was": ["its-slug"]`). | Kept. |
| Rename a module's slug | `"slug": "new-module", "was": ["old-module"]` at the top of the module file. | Kept (exams, module state). |
| Retire a lesson | Remove it from the file. It is hidden from members, never deleted. **Never reuse its slug** for something else. | Kept in the database; comes back if you put the lesson back. |
| Retire a module | Delete the file. The module is hidden, never deleted. | Kept. |
| Rename a school's slug | **Don't.** Change its title instead. | — |

Certificates already issued stay valid whatever happens to the content (they are rows of their own, and are only ever revoked, never deleted). A lesson the team edited in the admin is never overwritten by the file (Admin → "Revert to file" undoes that).

---

## 9. Recipe: change the API that tools use

Read [API_VERSIONING.md](API_VERSIONING.md). In one line: **only add**. Never remove, rename or change the type of a field in `/api/v1/*` or `/oauth/*`; unknown fields are ignored. A test locks the response shapes. A real breaking change means building `/api/v2` next to v1.

---

## 10. Settings changes

Settings (Admin → Settings, Plans, rooms, school pacing...) **apply from the moment they are saved, going forward**. They never rewrite history:
- Price and period changes: see section 7 (existing payers keep theirs; orders keep what was sold).
- Referral rates and payout rules: earnings already recorded keep their amount; new earnings use the new rules.
- School pacing (`unlock_hours`): changes waiting times from now on; modules already open stay open; certificates stay.
- Feature switches: hide or show; nothing is deleted.
- Email templates: affect emails sent from now on.

If you add a new setting, make it work the same way: store what a member was given at the time they were given it.

---

## 11. Deleting things

- **Members** are never deleted. The owner can ban, deactivate, or **erase personal data** (which keeps their orders under "Erased member").
- **Money and achievements** are never deleted: orders, payouts, referral earnings, affiliate commissions, conversions, payouts and receipts, price locks, certificates (revoked, not deleted), the audit log. A test (`no code hard-deletes...`) fails if code ever does `DELETE FROM` on those tables.
- **Content the team deletes** (posts, courses, legacy Academy lessons with members' progress, canned replies, What's new notes, school partners) goes to the **recycle bin** first. Restore: as owner, `GET /api/admin/recycle-bin` shows rows with a `batch`; `POST /api/admin/recycle-bin/restore { "batch": "b_..." }` puts the whole batch back (all or nothing).
- **Rooms** are archived, **products** hidden, **messages** marked deleted, **images** soft-deleted. Members deleting their own saved tool scenarios, and erasure, are real deletes on purpose (privacy).
- If you add a new delete in the admin: use `require('./trash').remove(table, where, args, { by: me.id, reason: 'thing.delete' })` instead of `DELETE FROM`.

---

## 12. Deploy, step by step

### Pre-deploy checklist (every time)

- [ ] `npm test` ends with `0 failed`.
- [ ] If I added a migration: it is numbered, additive, has defaults, and is locked (`npm run lock-migrations`, lock file committed).
- [ ] I did not edit an old migration, a frozen baseline schema, or a line in `test/fixtures/api-v1-shapes.json`.
- [ ] New features are behind a flag, set to `off`.
- [ ] `npm run rehearse -- <today's backup>.db` says **PASS**.
- [ ] Owner has downloaded a fresh backup (Admin → Settings → Backups → Download backup).
- [ ] It is a quiet hour (Lagos evening or early morning), and I can watch the deploy for 15 minutes.
- [ ] I know which deployment is the current good one (Railway → Deployments, the green one at the top) in case I need to roll back.

### Deploy

1. Push to the `main` branch on GitHub (or upload the files, as in `DEPLOY-GUIDE.md`).
2. Railway builds and starts the new version by itself. **Because the database is on a volume, Railway stops the old version before the new one starts: there is a short downtime (usually under a minute) on every deploy.** That is normal. Members see a loading page or a 502 briefly.
3. Watch Railway → Deployments → the new deployment → **Deploy Logs**. You want to see:
   - `[migrate] safety copy before the update: ...` (production makes one on every new version)
   - `[migrate] applied 00N-....js` for each new migration (if any)
   - `VooSquare running on ...`
4. Open `https://<your-domain>/healthz` while logged in as the owner (or send the header `X-Health-Key: <HEALTH_KEY>`). You want `"ok":true` and `"schema":{"version":N,"expected":N,"ok":true}`. Without either, it shows only `{"ok":true,"time":...}`.
5. Log in to /admin. Open Overview, a room, a lesson, Payments. Check one member account looks normal.
6. Flip the new feature's flag to `staff` and try it.

---

## 13. Roll back a bad deploy

Do this when the new version is live but something is wrong (errors, a broken page, wrong numbers), or when it did not start.

1. Railway → the VooSquare service → **Deployments**.
2. Find the **last good deployment** (the one before yours; it was green/Active before).
3. Click its **⋮** menu → **Rollback** *(older ones: **Redeploy**)* → confirm. Railway restarts the previous image in under a minute (a short downtime again, because of the volume).
4. Check `/healthz` and log in to /admin.

**Your data is fine after a rollback.** Migrations only add tables and columns, so the previous version runs on the newer database; the logs will say `The database is at version N, newer than this code... That is expected after a rollback`. Do **not** restore a backup just because you rolled back. Members' new activity since the deploy (messages, payments) stays.

Then fix the problem in the code, run the checklist again, and deploy again. Never "fix" a shipped migration in place: add a new one.

**If the new version refused to start** (logs show `VooSquare did NOT start`): a migration failed and was rolled back, so the database is untouched. Roll back as above (or push a fix). Railway retries the failed start a few times; that is harmless (it reuses the same safety copy).

---

## 14. Restore a backup

Only when data is actually wrong or lost (for example a migration *did* run and damaged data). A rollback (section 13) is
enough in almost every other case. **Restoring throws away everything that happened after the copy was made** (new
members, payments, messages), so agree it with the owner first and note the time.

1. **Pick the copy.** Admin → Settings → Backups lists every copy on the server:
   - "Made automatically before an update" (`pre-migrate-v<N>-<time>.db`): the state just before a deploy changed the database.
   - "Daily copy" (`voosquare-auto-<time>.db`) and "Made by hand" (`voosquare-manual-<time>.db`).
   Copy its exact file name.
2. **Download the current database** first (Download backup), even if it is broken. You may need data from it later.
3. **If the bad code is still live, roll back first** (section 13). Otherwise the bad migration would simply run again on the restored copy.
4. Railway → the VooSquare service → **Variables** → **New variable**: `RESTORE_FROM` = the file name, for example
   `pre-migrate-v4-2026-10-05-090000-000.db` → deploy the change *(Railway may show "Apply changes" / "Deploy")*. Check in
   **Deployments** that the new deployment is the same commit as the good one.
5. On start, **before the database is opened**, VooSquare:
   - saves the current database as `pre-restore-<time>.db` ("Saved just before a restore" in Backups), so even the restore loses nothing,
   - puts your copy in place (and removes the old `-wal`/`-shm` files),
   - then starts normally (any migrations the copy is missing run again, after their own safety copy).
   The logs say `[restore] restored pre-migrate-v4-....db at ...`. A wrong name or a file that is not a VooSquare database stops the start with a clear message and changes nothing.
6. Check `/healthz` and /admin. Then **delete the `RESTORE_FROM` variable**. (If you forget, nothing happens: each copy is restored only once.)
7. Write down in the team chat: which copy, its time, and what was lost between then and now. Payments made in the lost window must be checked by hand against the payment provider and approved again in Admin → Payments.

A file you downloaded to your computer is not on the server. Restore the same copy from the server list if it is still
there; otherwise a developer must place the file in `/data/backups` first (Railway shell or `railway ssh`, then download
it from a private link with `curl -o /data/backups/<name>.db '<link>'`) *(may differ slightly)*. Then follow the steps above.

---

## 15. What to do if something breaks

Stay calm. The data is almost always safe: migrations are transactional and copies exist. Work down this list.

| What you see | Most likely | Do this |
|---|---|---|
| Logs: `VooSquare did NOT start` and `Migration 00N-... failed and was rolled back` | A migration has a bug. Nothing was changed. | Roll back (13). Fix by adding a corrected migration (or fixing the unreleased one), `npm test`, rehearse, deploy. |
| Logs: `Could not make the safety copy before changing the database` | The volume is full. Nothing was changed. | Roll back (13). Grow the volume in Railway (volume → Settings → size), or delete old copies in `/data/backups` you no longer need. Only if you hold another fresh backup: set `MIGRATE_WITHOUT_BACKUP=1` for one deploy, then remove it. |
| Deploy stays "unhealthy", `/healthz` says `Database migrations are not applied` | Should not happen (the app exits instead). | Read Deploy Logs; roll back (13). |
| Site works, but a new feature misbehaves | Code bug. | Turn its flag `off` (6) or its feature switch off. No deploy needed. Then fix calmly. |
| Members say their price went up | Grandfathering bypassed or switched off. | Check `GET /api/admin/settings/grandfathering` is enabled; check the code charges through `priceFor()`. Refund the difference by hand. |
| Members say progress or a lesson disappeared | A lesson slug was changed or removed. | Put the old slug back, or add `"was": ["old-slug"]` (8), then Admin → VooSquare Academy → Reload content. Progress comes back. |
| Something the team deleted is needed back | — | Recycle bin (11): `GET /api/admin/recycle-bin`, then restore its batch. |
| A tool (Joinvoo, Spyvoo...) stopped working after our deploy | An `/api/v1` field changed. | Roll back (13). Put the field back. Read API_VERSIONING.md. |
| Everyone and everything disappeared | The volume is not mounted at `/data`. | See DEPLOY-GUIDE "Troubleshooting". Do **not** sign up as owner again on the empty database; fix the volume, redeploy. |
| Logs: `WARNING: 00N-....js changed after it ran` | Someone edited a shipped migration. | Put the file back exactly as it was (from git history) and add a new migration for the change. |

If you are unsure: roll back first, ask questions after. Rolling back is always safe.

---

## 16. Reference: files and variables

| File | What |
|---|---|
| `src/migrate.js` | Migration runner: safety copy, run once, refuse to start on failure, status for /healthz and Backups |
| `src/migrations/NNN-name.js` | The migrations, in order. 001 is the baseline (the schema as of October 2026) |
| `test/fixtures/migrations.lock.json` | Checksums of shipped migrations (`npm run lock-migrations`) |
| `test/fixtures/schema/*.sql` | Schemas of older releases; the test upgrades them and compares with a fresh database |
| `test/safety.js` | All the checks in this guide |
| `test/fixtures/api-v1-shapes.json` | The frozen tool API contract |
| `src/flags.js` | Rollout flags for new features |
| `src/trash.js` | Recycle bin |
| `src/restore.js` | `RESTORE_FROM`: restore a backup on start, saving the current database first |
| `src/payments.js` `priceFor()` | Prices, including grandfathering |
| `tools/rehearse-upgrade.js` | `npm run rehearse -- backup.db` |

| Variable | Default | Meaning |
|---|---|---|
| `BACKUPS_DIR` | `/data/backups` | Where all copies go |
| `PRE_MIGRATE_KEEP` | `3` | How many "before an update" copies to keep |
| `BACKUP_ON_DEPLOY` | on in production | `1`/`0`: make a safety copy on every new code version, even without a migration |
| `MIGRATE_WITHOUT_BACKUP` | off | `1`: allow migrations even if the safety copy fails. Emergency only, remove right after |
| `SAFE_COPY` | off | `1` on staging or local copies of production data: no emails, no affiliate jobs |
| `RESTORE_FROM` | — | A backup file name in `BACKUPS_DIR`: restore it on the next start (section 14). Remove it afterwards |
| `MIGRATIONS_EXTRA_DIR` | — | Tests only (ignored unless `NODE_ENV=test`) |

The database tables that record all this: `schema_migrations` (what ran, when, checksum), `schema_meta` (last good start, last safety copy), `price_locks`, `deleted_rows`, and `audit` (`db.migrate`, `backup.pre_migrate`, `recycle_bin.restore`).
