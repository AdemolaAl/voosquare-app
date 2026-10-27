# Put VooSquare live on Railway (step by step)

This guide assumes you have never used GitHub or Railway. Follow it top to bottom and VooSquare is live in about 30 minutes. Every step says exactly what to click and what you should see.

> **Changing the code later?** Developers must read [Changing VooSquare safely](CHANGING-SAFELY.md) first: the golden rules, how to add a database change, prices, school content, the deploy checklist, rollback and restore.

> **About button names:** GitHub, Railway and Resend change their screens from time to time. Where this guide names a button on their sites, the name may differ slightly. Look for the closest match. Anything marked *(may differ slightly)* is a place where that is most likely.

**What you need before you start**
- The `voosquare-app` folder on your computer.
- An email address you can open (this becomes the owner account).
- A bank card for Railway (Railway's Hobby plan is about 5 USD a month; it may ask for a card even on the trial).
- Optional, for later: your domain (for example `voosquare.com`) and access to where you bought it (Namecheap, GoDaddy, Cloudflare, Whogohost...).

**How VooSquare runs, in one picture**
GitHub keeps your code. Railway takes the code from GitHub and runs it. Railway's **volume** (a disk mounted at `/data`) keeps your data: the database `/data/voosquare.db`, people's images in `/data/uploads` and daily backups in `/data/backups`. Code can be replaced any number of times. **The volume must never be deleted.**

---

## Part 1. Put the code on GitHub (about 8 minutes)

### 1.1 Create a GitHub account
1. Go to **https://github.com** and click **Sign up**.
2. Enter your email, a password and a username. Confirm the code GitHub emails you.
3. Choose the **Free** plan when asked.

### 1.2 Create an empty private repository
1. When logged in, click the **+** at the top right, then **New repository**.
2. **Repository name**: `voosquare-app`.
3. Choose **Private** (so nobody else sees the code).
4. Leave "Add a README", ".gitignore" and "license" **unticked**.
5. Click **Create repository**. You now see an almost empty page with setup instructions.

### 1.3 Upload the folder. Choose ONE of the two ways

**Way A: in the browser (no tools needed)**
1. On the new repository page, click the link **uploading an existing file** (or **Add file → Upload files**).
2. Open the `voosquare-app` folder on your computer. Select **everything inside it** (on Windows: click inside the folder and press Ctrl + A; on Mac: Cmd + A). Include the `docs`, `public`, `src`, `test` and `tools` folders and the files `server.js`, `package.json`, `Dockerfile`, `railway.json`, `README.md`, `.env.example`, `.gitignore` and `.dockerignore`.
   - Do **not** upload a `data` folder or any file ending in `.db` if you ever ran VooSquare on your computer. Those hold personal data.
   - Files whose names start with a dot (`.gitignore`, `.env.example`) can be hidden on Mac. In Finder press **Cmd + Shift + .** (full stop) to show them. If they still do not upload, that is fine: VooSquare works without them.
3. Drag the selection into the GitHub upload box. Wait until every file shows in the list (this can take a minute).
4. At the bottom, in "Commit changes", leave the message as it is and click **Commit changes**.
5. Check: the repository page now lists `server.js`, `Dockerfile`, `railway.json`, and the folders `public`, `src`, `docs`. If you see a single folder called `voosquare-app` with everything inside it instead, you dragged the folder itself, not its contents. Delete the repository (Settings → bottom of the page → Delete this repository) and repeat 1.2 and 1.3, dragging the contents.

**Way B: with git commands (if you have git installed)**
Open a terminal inside the `voosquare-app` folder and run (replace `YOUR-USERNAME`):
```bash
git init
git add .
git commit -m "VooSquare first upload"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/voosquare-app.git
git push -u origin main
```
When git asks for a password, GitHub needs a **token**, not your password: GitHub → your picture → **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token**, tick **repo**, generate, and paste the token as the password *(may differ slightly)*. The `.gitignore` file already keeps `data/` and `.db` files out.

---

## Part 2. Create the Railway project (about 5 minutes)

### 2.1 Create a Railway account
1. Go to **https://railway.com** and click **Login** (or **Start a New Project**).
2. Choose **Continue with GitHub** and accept. This links Railway to your GitHub account.
3. If Railway asks you to choose a plan or add a card, pick **Hobby** *(may differ slightly)*.

### 2.2 Deploy from your GitHub repository
1. In Railway, click **New Project** (or **+ New**).
2. Click **Deploy from GitHub repo**.
3. If you do not see `voosquare-app` in the list, click **Configure GitHub App**, choose your account, select **Only select repositories → voosquare-app**, and click **Save**. Back in Railway the repository now appears.
4. Click **voosquare-app**. If Railway shows a button **Deploy Now**, click it. (If it shows **Add variables**, you can also click that and jump to Part 4, then come back.)
5. Railway opens your project "canvas" with one box (the **service**) called `voosquare-app`. It starts building at once. It reads the `Dockerfile` and `railway.json` from your code, so you do not need to pick a language or a start command.

The first deploy may finish before the volume and variables exist. That is fine. **Nothing you do in the app before Part 3 is kept**, so do not log in yet.

---

## Part 3. Add the volume at /data (2 minutes, the most important step)

Without a volume, every update wipes all members, messages and orders.

1. On the project canvas, **right-click** the `voosquare-app` box and choose **Attach volume** *(may differ slightly)*.
   - Other ways to get there: press **Ctrl + K** (Mac: **Cmd + K**) on the canvas and type **volume**, or click **+ New / Create → Volume** and pick the `voosquare-app` service.
2. **Mount path**: type exactly `/data` (a forward slash, then `data`, all lowercase).
3. Click **Attach** / **Create**. A small disk icon now shows under the service box, and Railway redeploys.

You do not need to set any size now; Railway grows the volume up to your plan's limit.

---

## Part 4. Set the variables (5 minutes)

### 4.1 Make your APP_SECRET first (no terminal needed)
`APP_SECRET` is a long random password that VooSquare uses to sign login codes, unsubscribe links and the "Continue with VooSquare" tokens. Make it once, keep it in a safe place (a password manager), and never change it later.

**The browser way (works on any computer):**
1. Open Chrome (or Edge, Firefox, Safari) on any page, for example this one.
2. Open the console: press **F12** (Mac: **Cmd + Option + J** in Chrome, **Cmd + Option + C** in Safari after turning on the Develop menu), then click the **Console** tab.
3. Paste this and press Enter:
   ```js
   crypto.randomUUID() + crypto.randomUUID()
   ```
   Chrome may first ask you to type `allow pasting` and press Enter. Do that, then paste again.
4. You get something like `'3f9c...-....-....'` (about 72 characters). Copy it **without** the quote marks. That is your `APP_SECRET`.

**The terminal way (Mac or Linux):** `openssl rand -hex 32`

If you forget to set it, VooSquare makes one by itself and stores it in the database, so nothing breaks. Setting your own is still better because you keep a copy.

### 4.2 Paste the variables
1. Click the `voosquare-app` box, then the **Variables** tab.
2. Click **Raw Editor** (top right of the variables list).
3. Paste this block, then change the values on the right of each `=`:
   ```
   OWNER_EMAIL=you@yourdomain.com
   APP_SECRET=paste-your-long-random-string-here
   NODE_ENV=production
   EMAIL_PROVIDER=
   EMAIL_API_KEY=
   EMAIL_FROM=VooSquare <hello@voosquare.com>
   EMAIL_REPLY_TO=support@voosquare.com
   ```
4. Click **Update Variables** / **Save**. Railway redeploys (about 1 to 2 minutes).

What each line means:

| Variable | In one line |
|---|---|
| `OWNER_EMAIL` | Your email. The first time this email logs in, it becomes the owner with every permission. |
| `APP_SECRET` | The long random string from 4.1. Set once, keep safe, never change. |
| `NODE_ENV` | Always `production` on Railway. (Secure cookies come from an `https://` address: see below.) Login codes are never shown on screen on a public address whatever this says: see "Security settings" below. |
| `EMAIL_PROVIDER` | `resend`, `brevo` or `postmark`. Leave empty for now; Part 7 fills it. Empty means emails print in the logs. |
| `EMAIL_API_KEY` | The API key from your email provider (Part 7). |
| `EMAIL_FROM` | The sender people see, on a domain you verified with the provider, for example `VooSquare <hello@voosquare.com>`. |
| `EMAIL_REPLY_TO` | Where replies to emails go. Optional. |

### 4.3 Security settings (optional; the defaults are right on Railway)

| Variable | Default | What it does |
|---|---|---|
| `TRUST_PROXY` | `1` on Railway (when `RAILWAY_ENVIRONMENT` is set), `0` anywhere else | How many proxies in front of VooSquare add the visitor's address to `X-Forwarded-For`. With `n`, the visitor is the n-th address from the right; with `0` the header is ignored and the connection's own address is used. Rate limits and affiliate fraud checks use this address, so a visitor can never pick it. Railway's edge adds exactly one hop. Add a CDN (for example Cloudflare) in front of Railway: set `2`. Running without any proxy: `0`. Never set it higher than the real number of proxies, or visitors can fake their address again. |
| `HEALTH_KEY` | empty | `/healthz` tells everyone only `{"ok":true,"time":...}` (enough for Railway's health check). To see the database and migration details, send the header `X-Health-Key: <HEALTH_KEY>`, or open it while logged in as an owner. |
| `REQUEST_TIMEOUT_MS` | `120000` | How long a visitor may take to send one request (headers and body). Stops slow "drip" connections from tying the server up. Live updates are not affected. |
| `STREAM_MAX_PER_IP` / `STREAM_MAX_PER_USER` / `STREAM_MAX_TOTAL` | `40` / `12` / `5000` | Most live-update connections one address, one member and the whole server may hold open. Over the limit the browser gets "429" and retries by itself. |
| `DEV_LOGIN_CODES` | not set | Only for a copy on your own computer: `1` shows login codes on screen (like the tests do). It works only on a local address (`localhost`, `127.0.0.1`, `*.localhost`, `*.test`). If it (or `NODE_ENV=test`) is set on a public address and no email provider is set up, **VooSquare refuses to start** and says why in the Deploy Logs: remove the variable, set `NODE_ENV=production` and set up email (Part 7). |

**Do not add these on Railway** (they are found automatically): `PORT` (Railway sets it), `DATABASE_PATH` (found from the `/data` volume), `UPLOADS_DIR` (defaults to `/data/uploads`), `BACKUPS_DIR` (defaults to `/data/backups`). `BASE_URL` is filled from the Railway domain; you add it only when you connect your own domain in Part 6. Never set `ALLOW_PRIVATE_OUTBOUND` in production.

---

## Part 5. Get a web address and log in (5 minutes)

### 5.1 Generate a Railway domain
1. Click the service → **Settings** tab → **Networking** section.
2. Click **Generate Domain**. If Railway asks for a port, leave the one it suggests (VooSquare listens on the port Railway gives it).
3. You get an address like `voosquare-app-production.up.railway.app`. Click it. The VooSquare website opens.

### 5.2 Check the deploy is healthy
1. Open `https://<your-address>/healthz`. You should see `{"ok":true,"time":...}`. (The database and migration details show only with your `HEALTH_KEY` or when you are logged in as the owner: see 4.3.)
2. Click the service → **Deployments** tab → the top deployment → **View logs** (the **Deploy Logs** tab). Near the top you should see:
   ```
   VooSquare running on https://voosquare-app-production.up.railway.app (port 8080)
   Database: /data/voosquare.db
   Email: not configured (codes print here; set EMAIL_PROVIDER and EMAIL_API_KEY)
   ```
   If the `Database:` line shows anything other than `/data/voosquare.db`, the volume is missing or mounted at the wrong path. Go back to Part 3.

### 5.3 First login (the code is in the logs)
1. Open `https://<your-address>/login`, click **Log in**, type your `OWNER_EMAIL` and click **Send my code**.
2. Email is not set up yet, so the code is printed in the logs instead. Go back to **Deploy Logs** (it updates live) and look for a block like:
   ```
   [email:console] to=you@yourdomain.com subject="Your VooSquare code: 482913"
   Hi Ejiro,

   Your VooSquare sign-in code is: 482913
   It expires in 10 minutes.
   ```
   You can type `code` in the log search box to find it quickly.
3. Type the 6 digits on the login page. You are in. Complete the short welcome (face, name, handle), then open `https://<your-address>/admin`.

Members cannot log in this way (they cannot see your logs), so set up email (Part 7) before you share the link.

---

## Part 6. Connect your own domain (optional, 10 minutes plus DNS waiting time)

1. Railway: service → **Settings → Networking → Custom Domain** (or **+ Custom Domain**). Type your domain, for example `voosquare.com` or `www.voosquare.com`, and click **Add**.
2. Railway shows the DNS record to create, usually a **CNAME** pointing to an address like `abc123.up.railway.app`, and sometimes a **TXT** record to prove you own the domain *(may differ slightly)*. Keep that page open.
3. In a new tab, log in where you manage your domain's DNS and open **DNS** / **Manage DNS** / **Advanced DNS**:
   - For `www.voosquare.com`: add a **CNAME** record, **Host/Name** `www`, **Value/Target** the address Railway showed.
   - For the bare domain `voosquare.com`: many providers do not allow a CNAME on the bare domain. Use **ALIAS**, **ANAME** or **CNAME flattening** if offered (Cloudflare does this automatically for a CNAME named `@`). If your provider offers none of these, move the domain's DNS to Cloudflare (free) or use `www.voosquare.com` as the main address.
   - Add the **TXT** record too if Railway showed one.
   - On Cloudflare, start with the cloud icon **grey (DNS only)** until Railway shows the domain as active; then you may turn the orange proxy on with SSL mode **Full**.
4. Wait. DNS takes from 5 minutes to a few hours. Railway shows a green tick when the domain works and adds the HTTPS certificate by itself.
5. Railway: **Variables → New Variable**: `BASE_URL` = `https://voosquare.com` (your exact address, with `https://`, **no slash at the end**). Save; Railway redeploys.
6. Check the logs show `VooSquare running on https://voosquare.com`. Login emails, payment webhooks, referral links, the support widget and "Continue with VooSquare" all use this address.

### 6b. Add voosquareacademy.com (VooSquare Academy's own website, 10 minutes plus DNS waiting time)

VooSquare Academy has its own website at **voosquareacademy.com**: the school only, for people who do not want the full
VooSquare. It is **the same Railway service** (same app, database, accounts, progress and certificates): you only add the
domain and three variables. Nothing new to deploy.

1. Railway: the **same** `voosquare-app` service → **Settings → Networking → + Custom Domain** → type `voosquareacademy.com`
   → **Add**. Do it again for `www.voosquareacademy.com`. Each one shows the DNS record to create *(may differ slightly)*.
2. Where you manage voosquareacademy.com's DNS: exactly like step 3 above, with `voosquareacademy.com` in place of
   `voosquare.com`: a **CNAME** `www` → the address Railway showed for `www.voosquareacademy.com`, and for the bare domain a
   CNAME-flattened/ALIAS/ANAME record `@` → the address Railway showed for `voosquareacademy.com`. Add the **TXT** records if
   Railway showed any. On Cloudflare keep the cloud **grey (DNS only)** until Railway shows both domains as active.
3. Wait for Railway's green tick on both (5 minutes to a few hours). HTTPS is added by itself.
4. **Variables → Raw Editor**, add:
   ```
   ACADEMY_URL=https://voosquareacademy.com
   VOOSQUARE_URL=https://voosquare.com
   ```
   | Variable | In one line |
   |---|---|
   | `ACADEMY_URL` | The academy's public address, no slash at the end. Used for its links, canonical tags, sitemap and the one-tap switch. Once it is set, new certificates also print their verify link on this domain (`/verify/<code>` answers on both domains, so older certificates keep working). Default `https://voosquareacademy.com`. |
   | `VOOSQUARE_URL` | Where the academy sends people for everything else (community, Premium, billing, tools, admin). Default: `BASE_URL`. |
   | `ACADEMY_HOSTS` | Optional. Extra host names that should show the academy site, comma separated (for example a staging name `academy-staging.up.railway.app`). `voosquareacademy.com` and `www.voosquareacademy.com` always do. |
5. Save; Railway redeploys. Check: `https://voosquareacademy.com` shows "Learn media buying.", `https://voosquareacademy.com/robots.txt`
   ends with the sitemap address, and `https://voosquare.com` is unchanged.
6. Try the one-tap switch: log in on voosquare.com, open **School**, tap **Also at voosquareacademy.com**: you land on the
   academy already signed in. In the academy, tap **Community**: you are back on VooSquare, signed in.

How the switch stays safe: sessions stay per site (`__Host-` cookies, never shared). A switch link is random, used once,
valid 60 seconds, only on the site it was made for, only while the session that made it is still signed in (log out,
"log out everywhere" and a ban all cancel it), never for a suspended member, and it only ever goes to a page on the same
site. Every switch is in the admin audit log (`auth.handoff`, refused ones as `auth.handoff_refused`).

Staging tip: with no custom domain, add the academy's Railway name to `ACADEMY_HOSTS` and set `ACADEMY_URL` to it. Outside
production you can also preview the academy on any address with `?site=academy` (and `?site=voosquare` to go back).

---

## Part 7. Set up email with Resend (10 minutes plus DNS waiting time)

1. Go to **https://resend.com**, click **Sign up**, and create an account.
2. In Resend, open **Domains → Add Domain**. Type your domain (for example `voosquare.com`), pick the region closest to your members if asked, and click **Add**.
3. Resend shows 3 or 4 DNS records (usually an **MX** and a **TXT** for SPF on a `send` subdomain, a **TXT** called `resend._domainkey` for DKIM, and an optional **DMARC** TXT) *(may differ slightly)*.
4. Add each record at your DNS provider exactly as shown (copy the **Name** and the **Value** with the copy buttons; some providers add your domain to the name automatically, so `send.voosquare.com` may need to be typed as just `send`).
5. Back in Resend, click **Verify DNS Records**. Wait until the domain shows **Verified** (minutes to a few hours).
6. Resend → **API Keys → Create API Key**. Name it `VooSquare`, permission **Sending access**, domain: yours. Click **Add**. **Copy the key now** (it starts with `re_`); Resend shows it only once.
7. Railway → **Variables** (Raw Editor) and set:
   ```
   EMAIL_PROVIDER=resend
   EMAIL_API_KEY=re_your_key_here
   EMAIL_FROM=VooSquare <hello@voosquare.com>
   ```
   The address in `EMAIL_FROM` **must** use the domain you verified. Save; Railway redeploys. The logs should now say `Email: ready` instead of "not configured".
   - You can instead enter the same values in **/admin → Settings → General → Email provider**. Values saved there are used before the Railway variables.
8. **Send a test:** /admin → **Emails** → click any template → **Send test to me**. You should receive it within a minute. Then log out and log in again: the code now arrives by email.

Brevo or Postmark work the same way: verify the domain with them, create an API key, and set `EMAIL_PROVIDER=brevo` or `postmark`.

---

## Part 8. Turn on payments

1. /admin → **Payments**. Every method starts switched off.
2. Click a method (or **Add payment method**), fill in its details (keys, wallet address, bank details, the currency and the **rate per 1 USD**), then switch it **on** and save. VooSquare refuses to switch a method on while something required is missing and tells you what.
3. For card and API methods (Paystack, Flutterwave, Stripe, Gatevoo, custom API) copy the **Webhook URL** shown on the method, for example `https://voosquare.com/api/billing/webhook/1`, and paste it in that provider's dashboard. Without it, paid orders do not unlock access by themselves.
4. Gatevoo: follow `docs/GATEVOO.md`.
5. Test with a small real payment, then check **/admin → Payments** (orders) and **Revenue**.
6. Bank transfer and other manual methods: members submit a reference or a screenshot, and you approve the order in **/admin → Payments**.

If you change your domain later (Part 6), update every webhook URL in the providers' dashboards.

## Part 9. Connect your tools (products)

1. /admin → **Products** → open a tool (Joinvoo, Spyvoo...) → set its **URL**, switch **SSO** on, add its **Redirect URIs**.
2. In the tool's **Credentials** you find the **Client ID**, **Client secret** and **API key**. Give them to the tool's developer together with `docs/INTEGRATION.md` and your VooSquare address (`VOO_BASE`).
3. Support widget on another website: paste the snippet from `docs/INTEGRATION.md`, with **your** VooSquare address in `src`, for example `<script src="https://voosquare.com/widget.js" data-product="joinvoo" defer></script>`.

## Part 10. Backups

- VooSquare already makes **one copy a day** in `/data/backups` (the first a minute after each start) and keeps the newest 7.
- It also makes a copy **by itself before every update** that changes the database (and on every new version in production): "Made automatically before an update" on the Backups page. The newest 3 are kept.
- Owner: /admin → **Settings → Backups → Download backup** gives you a full copy of the database as one file. Do this **before every update** and keep the file somewhere private (it holds personal data).
- Optional extra safety: Railway can back up volumes too. Click the volume under the service → **Backups** → set a schedule *(may differ slightly; available on paid plans)*.
- Restoring is explained in the README section "Backups" and on the Backups page under "How to restore a backup".

---

## How to update VooSquare later without losing anyone

Your members, messages, orders, images and settings live on the `/data` volume, not in the code. Replacing the code does not touch them.

1. **Download a backup first:** /admin → Settings → Backups → **Download backup**.
2. **Put the new code on GitHub:**
   - Browser way: open the repository → **Add file → Upload files** → drag in the new versions of the files and folders (same names replace the old ones) → **Commit changes**. If a file was deleted in the new version, open it on GitHub and delete it there (the bin icon).
   - Git way: in the folder, `git add . && git commit -m "Update" && git push`.
3. **Railway redeploys by itself** a few seconds after GitHub gets the new code. Watch **Deployments**: the new one builds, then Railway stops the old one and starts the new one (with a volume, two versions can never run at the same time, to protect the database), and it must pass the `/healthz` check. During that minute or two people may see a short "502" or a loading page; that is normal.
4. **Database changes run automatically** when the new version starts. First a full copy of the database is saved in `/data/backups` (`pre-migrate-...`), then each change runs once, inside a transaction. They only add tables and columns, never remove data. If a change fails, it is undone and the new version refuses to start (the logs say `VooSquare did NOT start` and why); your data stays exactly as it was. You do nothing.
5. Log in to /admin as the owner, then open `https://<your-address>/healthz`: it should say `"ok":true` and `"schema":{... "ok":true}` (the schema part shows only for an owner or with your `HEALTH_KEY`).

**Rules that keep everyone safe**
- **Never delete the volume** and never detach it. Deleting it deletes every member.
- Never delete and re-create the Railway service: create a new service only if you also move the volume.
- Keep **one replica** (already set in `railway.json`).
- Keep `APP_SECRET` the same forever.
- **Never rename a cookie** (above all the sign-in cookie, `__Host-vs_sess` on https, `vs_sess` on http) without planning it: a new name signs every member out once. See [CHANGING-SAFELY.md](CHANGING-SAFELY.md), section 1, golden rule 14.

**If a deploy fails**
- Because the database lives on a volume, Railway has already stopped the old version when the new one starts. So if the new one fails, the site is down until you roll back. Do it straight away (it takes under a minute):
- Open the failed deployment → **View logs** to see the error (copy it for the developer).
- To go back to the version that worked: **Deployments** → the last good (green) deployment → the **⋮** menu → **Rollback** (or **Redeploy**) *(may differ slightly)*. Rollback also puts back that deployment's variables. The data on the volume stays as it is. Because database changes only add things (and a failed change is undone), the older version runs fine on it.
- Then fix the code on GitHub and push again. Do **not** restore a backup just because a deploy failed: nothing was lost. Restoring is only for data that is really wrong ([CHANGING-SAFELY.md](CHANGING-SAFELY.md), section 14).

---

## Troubleshooting

| What you see | What to do |
|---|---|
| **No login code arrives by email** | Before email is set up, codes are only in **Deploy Logs** (search `code`). After setup: check the logs say `Email: ready`, the domain is **Verified** in Resend, and `EMAIL_FROM` uses that exact domain. Ask the person to check spam. Send a test from /admin → Emails. A wrong key shows as an error line in the logs when an email is sent. |
| **Everyone and everything disappeared after an update** | The volume was not attached at `/data`, so the database lived inside the container and was wiped. Attach a volume at exactly `/data` (Part 3). Check the logs say `Database: /data/voosquare.db`. If you have a downloaded backup, restore it (README, "Backups"). |
| **Logs say `Database:` with a path that is not `/data/voosquare.db`** | Volume missing or mounted elsewhere. Set the mount path to `/data`, or remove a wrong `DATABASE_PATH` variable. |
| **App crashes at start with `No such built-in module: node:sqlite` (or another error mentioning `sqlite`)** | It was built with an old Node. Make sure `Dockerfile` and `railway.json` are in the repository and that the service's **Settings → Build → Builder** is **Dockerfile**, then redeploy. (The Dockerfile uses Node 22.) |
| **"502 Bad Gateway" or "Application failed to respond"** | During a deploy, wait 1 to 2 minutes. If it stays: open Deploy Logs for an error; check you did not set `PORT` by hand; check **Settings → Networking** points the domain at the port the app logs (`(port ...)` in the first line). |
| **Login works on the Railway address but not on my domain, or emails link to the wrong address** | `BASE_URL` is wrong or missing. Set it to your exact address, `https://`, no trailing slash, then redeploy. Log in again on the new address (sessions belong to one address). |
| **Logged in, but every page acts logged out** | The address must start with `https://`. On https the sign-in cookie is `__Host-vs_sess`, which browsers accept only over a secure connection on that exact address. Check `BASE_URL`. |
| **Payments are paid but access does not unlock** | The provider's webhook is missing or points to an old address. Copy the webhook URL from /admin → Payments for that method into the provider dashboard. Check `BASE_URL`. Bank transfers always need your approval in /admin → Payments. |
| **Support widget does not show on another website** | The `src` in the snippet must be your VooSquare address (`https://voosquare.com/widget.js`). **Support** must be on in /admin → Settings → Features. Check `data-product` is the product's slug. |
| **"Continue with VooSquare" in a tool fails** | The tool's callback address must be listed in **Redirect URIs** for that product, SSO must be on, and the tool must use your current `BASE_URL`. If `APP_SECRET` was changed, tools must log in again. |
| **Logs say `VooSquare did NOT start`** | A database change in the new version failed and was undone, or the safety copy could not be made (volume full). Your data is unchanged. Roll back to the previous deployment (see "If a deploy fails"), then give the developer the lines under that message. |
| **Members see "Back soon" or areas say "turned off"** | Maintenance mode or a feature switch is on. /admin → Settings → Features. |
| **New people cannot sign up** | "Pause new sign-ups" is on in /admin → Settings → Features. |
| **Custom domain stuck on "waiting for DNS"** | Check the CNAME (and TXT) records exactly match what Railway shows; bare domains need ALIAS/ANAME/CNAME flattening; with Cloudflare set the record to DNS only (grey) until Railway shows it active. DNS can take a few hours. |
