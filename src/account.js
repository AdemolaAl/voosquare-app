'use strict';
/*
 * Delete my account (App Store guideline 5.1.1(v), Google Play account deletion policy).
 *
 *  - POST /api/me/delete { confirm: 'DELETE' }  signed in, x-vs header, rate limited. Owners and team members are refused
 *    (the owner hands over or removes them first). A member with a payout on its way is asked to wait for it.
 *  - GET /delete-account (and /account/delete), on VooSquare and on VooSquare Academy: the public page Google Play links
 *    to. It explains how to delete in the app, what is deleted and what is kept.
 *
 * Deleting is an anonymisation, never a removal of the user row: orders, payments, referral and affiliate ledgers, price
 * locks, certificates and the audit log keep pointing at the same id. What goes:
 *  - personal data on the user row (name → 'Deleted member', email → deleted-<id>@deleted.invalid, handle, avatar, bio,
 *    country, title, XP, marketing), so the old email can sign up again as a brand-new account;
 *  - sign-ins: every session, login code, one-tap switch link, tool login code and tool access token;
 *  - preferences and saved things: payout details, tool scenarios, lesson voice settings, the chosen vertical, What's new
 *    and room read marks, queued emails;
 *  - learning: lesson progress, module state, enrolments, exam papers and attempts. Certificates are revoked (kept as rows).
 * Community messages stay (other people's threads would break) and now show 'Deleted member'. Support tickets keep their
 * messages but lose the name and email. An affiliate account is closed and its contact details removed; its ledgers stay.
 */
const config = require('./config');
const D = require('./db');
const A = require('./auth');
const { now, fail, limit, json, esc, publish } = require('./util');

const DELETED_NAME = 'Deleted member';
const deletedEmail = (id) => `deleted-${id}@deleted.invalid`;

/** Why this account cannot delete itself right now ('' when it can). */
function blocker(u) {
  if (A.isOwner(u)) return 'You are an owner of VooSquare. Hand ownership to someone else in Admin → Team first, then delete your account.';
  if ((Array.isArray(u.perms) ? u.perms : json(u.perms, [])).length) return 'You are on the VooSquare team. Ask an owner to remove you from the team first, then delete your account.';
  if (D.get("SELECT 1 FROM payouts WHERE user_id=? AND status IN ('requested','processing')", u.id)) return 'You have a referral payout on its way. Wait until it is paid, or cancel it in Referrals, then delete your account.';
  const aff = D.get("SELECT id FROM aff_affiliates WHERE user_id=? AND status<>'closed'", u.id);
  if (aff && require('./aff/payouts').openPayout(aff.id)) return 'You have an affiliate payout on its way. Wait until it is paid, or cancel it, then delete your account.';
  return '';
}

function deleteAccount(u, ctx) {
  const why = blocker(u);
  if (why) fail(403, why);
  const t = now();
  const anon = deletedEmail(u.id);
  let handle = 'deleted_' + u.id;
  if (D.get('SELECT 1 FROM users WHERE handle=? AND id<>?', handle, u.id)) handle += '_' + t.toString(36);
  const oldEmail = u.email;
  D.tx(() => {
    D.run(`UPDATE users SET name=?, email=?, handle=?, avatar='{}', bio='', country='', role_title='', marketing=0, xp=0, deleted_at=? WHERE id=?`,
      DELETED_NAME, anon, handle, t, u.id);
    // Sign-ins everywhere.
    D.run('DELETE FROM sessions WHERE user_id=?', u.id);
    D.run('DELETE FROM login_codes WHERE email=?', oldEmail);
    D.run('DELETE FROM sso_codes WHERE user_id=?', u.id);
    D.run('DELETE FROM auth_handoffs WHERE user_id=?', u.id);
    // Personal preferences and saved things.
    D.run('DELETE FROM payout_methods WHERE user_id=?', u.id);
    D.run('DELETE FROM tool_saves WHERE user_id=?', u.id);
    D.run('DELETE FROM voice_prefs WHERE user_id=?', u.id);
    D.run('DELETE FROM release_seen WHERE user_id=?', u.id);
    D.run('DELETE FROM room_reads WHERE user_id=?', u.id);
    // Emails: nothing more goes out; sent ones lose the address.
    D.run("DELETE FROM email_queue WHERE (user_id=? OR to_email=?) AND status='queued'", u.id, oldEmail);
    D.run("UPDATE email_queue SET to_email=?, vars='{}' WHERE user_id=? OR to_email=?", anon, u.id, oldEmail);
    // Support conversations keep their messages (the team's replies are in them) but not who wrote them.
    D.run('UPDATE tickets SET email=?, name=? WHERE user_id=? OR email=?', anon, DELETED_NAME, u.id, oldEmail);
    // VooSquare Academy: learning progress goes; certificates are revoked, never deleted.
    D.run('DELETE FROM school_progress WHERE user_id=?', u.id);
    D.run('DELETE FROM school_module_state WHERE user_id=?', u.id);
    D.run('DELETE FROM school_enrollments WHERE user_id=?', u.id);
    D.run('DELETE FROM school_papers WHERE user_id=?', u.id);
    D.run('DELETE FROM school_attempts WHERE user_id=?', u.id);
    D.run('DELETE FROM school_prefs WHERE user_id=?', u.id);
    D.run('DELETE FROM progress WHERE user_id=?', u.id);
    D.run("UPDATE school_certificates SET revoked_at=CASE WHEN revoked_at=0 THEN ? ELSE revoked_at END, revoked_reason=CASE WHEN revoked_at=0 THEN 'Account deleted by the member' ELSE revoked_reason END, name=? WHERE user_id=?", t, DELETED_NAME, u.id);
    // Affiliate account: closed, contact details removed. Its conversions, commissions and payouts stay as they are.
    const aff = D.get('SELECT * FROM aff_affiliates WHERE user_id=?', u.id);
    if (aff) {
      D.run(`UPDATE aff_affiliates SET status='closed', closed_at=COALESCE(closed_at, ?), display_name=?, hide_name=1, company='', telegram='', whatsapp='', marketing=0, updated_at=? WHERE id=?`, t, DELETED_NAME, t, aff.id);
      D.run("UPDATE aff_telegram SET chat_id='', username='', verified=0, code_hash='', updated_at=? WHERE affiliate_id=?", t, aff.id);
      require('./aff/core').audit(u.id, 'affiliate.close', { affiliate_id: aff.id, after: { reason: 'account deleted by the member' } });
    }
  });
  A.revokeUser(u.id, 'deleted'); // tool access tokens and open live streams end now (sessions are already gone)
  D.insert('audit', { user_id: u.id, action: 'account.delete', detail: `#${u.id} deleted their own account (personal data erased; orders and payments kept)${ctx && ctx.ip ? ' from ' + String(ctx.ip).slice(0, 60) : ''}`, created_at: t });
  if (ctx) ctx.setCookie(A.cookie(config.sessionCookie, '', 0));
  publish('community', 'rooms', {});
}

/* ------------------------------------------------------------------ the public page */
const supportEmail = () => (D.getSetting('brand', {}) || {}).support_email || 'support@voosquare.com';

function page(site, signedIn) {
  const academy = site === 'academy';
  const name = academy ? 'VooSquare Academy' : 'VooSquare';
  const app = academy ? '/learn' : '/app';
  const go = `${app}#profile/delete`;
  const href = signedIn ? go : `/login?next=${encodeURIComponent(go)}`;
  const mail = esc(supportEmail());
  const home = academy ? config.academyUrl : config.voosquareUrl;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Delete your account · ${esc(name)}</title><meta name="description" content="How to delete your Voo ID and ${esc(name)} account, what is deleted and what is kept."><meta name="theme-color" content="#00A86B">
<link rel="icon" type="image/svg+xml" href="/assets/logo-icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@500&display=swap">
<link rel="stylesheet" href="/css/shared.css"><link rel="stylesheet" href="/css/legal.css"></head>
<body class="lg-body"><header class="lg-top"><a class="lg-brand" href="/"><img src="/assets/logo-icon.svg" alt="" width="32" height="32"><b>Voo<span>Square</span>${academy ? ' Academy' : ''}</b></a><nav class="lg-nav" aria-label="Legal"><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></header>
<main class="lg lg-one">
  <div class="lg-head"><h1>Delete your account</h1><p class="lg-meta">Your Voo ID works on VooSquare, VooSquare Academy and the VooSquare app. Deleting it deletes it everywhere.</p>
  <p class="lg-cta"><a class="btn btn-k" href="${esc(href)}">${signedIn ? 'Go to Delete account' : 'Log in to delete my account'}</a></p></div>
  <article class="lg-doc">
    <h2 id="s1">Delete it in the app</h2>
    <ul>
      <li>Open ${esc(name)} (the app or ${esc(home.replace(/^https?:\/\//, ''))}) and log in.</li>
      <li>Go to <b>Profile</b>, scroll to the bottom and tap <b>Delete account</b>.</li>
      <li>Read what happens, type <b>DELETE</b> and confirm. You are signed out on every device straight away.</li>
    </ul>
    <h2 id="s2">What is deleted</h2>
    <ul>
      <li>Your name, email address, handle, avatar, bio and country.</li>
      <li>Your sign-ins and the logins you made to Zedapex tools with your Voo ID.</li>
      <li>Your lesson progress, quiz and exam results, and your settings. Your certificates are cancelled.</li>
      <li>Saved payout details, saved tool scenarios and emails waiting to be sent to you.</li>
      <li>Your messages in the community stay so other people's conversations still make sense, but they show <b>Deleted member</b> instead of your name.</li>
    </ul>
    <h2 id="s3">What is kept, and for how long</h2>
    <ul>
      <li>Records of payments, orders, refunds, referral and affiliate earnings and payouts. The law asks us to keep these for as long as tax and accounting rules require. They no longer show your name or email.</li>
      <li>A short security log that says the account was deleted, and the support conversations you had with our team (without your name or email), to prevent fraud and answer disputes.</li>
      <li>Anything you paid for ends with the account. Deleting cannot be undone, but you can create a new free account with the same email later.</li>
    </ul>
    <h2 id="s4">Cannot open the app?</h2>
    <p>Email us at <a href="mailto:${mail}">${mail}</a> from the email address on your account and ask us to delete it. We reply within a few working days.</p>
  </article>
</main>
<footer class="lg-foot"><span>© ${new Date().getFullYear()} Zedapex Limited, Lagos</span><nav aria-label="Footer"><a href="/">${esc(home.replace(/^https?:\/\//, ''))}</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms of service</a></nav></footer>
</body></html>`;
}

function routes(r) {
  r.post('/api/me/delete', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('acct-del:' + u.id, 5, 60 * 60_000);
    limit('acct-del-ip:' + ctx.ip, 20, 60 * 60_000);
    const b = await ctx.json();
    if (String(b.confirm || '').trim() !== 'DELETE') fail(400, 'Type DELETE to confirm.');
    deleteAccount(u, ctx);
    return { ok: true, deleted: true };
  });
  r.get('/api/me/delete', (ctx) => {
    const u = A.requireUser(ctx);
    const why = blocker(u);
    return { can_delete: !why, reason: why };
  });
  const show = (ctx) => ctx.html(200, page(ctx.site, !!ctx.user));
  r.get('/delete-account', show);
  r.get('/account/delete', show);
}

module.exports = { routes, deleteAccount, blocker, DELETED_NAME, deletedEmail };
