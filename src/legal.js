'use strict';
/*
 * Legal pages (QA-2, QA-3).
 *  - /privacy and /terms: the member privacy policy and terms of service. The text lives in the 'legal' setting and is
 *    edited in Admin → Legal (settings permission). Until someone saves their own text, a plain-language template is
 *    shown (below). The privacy page carries the draft banner until approval. Rendered on the server, so the pages work
 *    without JavaScript and can be linked from anywhere.
 *  - The affiliate terms (docs/AFFILIATE_TERMS.md) are served with their {placeholders} filled from the live program
 *    settings, without the internal drafting notes.
 *  - "Approved by counsel": one switch per document (privacy, terms, affiliate), off by default, owner only. The privacy
 *    page carries the draft banner until approved; the owner controls approval after legal review.
 * Nothing here invents legal terms: the templates are drafts for review, clearly marked as such until approved.
 */
const D = require('./db');
const config = require('./config');
const { now, fail, esc } = require('./util');

const COMPANY = 'Zedapex Limited, Lagos';
const DOCS = { privacy: 'Privacy policy', terms: 'Terms of service' };
const MAX = 60_000;

const TEMPLATES = {
  privacy: `# Privacy policy

This policy explains what VooSquare collects about you, why, who sees it and what you can ask us to do with it. VooSquare is run by ${COMPANY} ("we", "us"). It covers voosquare.com, the VooSquare app, VooSquare Academy (inside the app and at voosquareacademy.com), the community, the affiliate program and your Voo ID, the one account you use to sign in to VooSquare and the Zedapex tools.

## What we collect
- **Your account (Voo ID)**: your email address, your name, your handle, your country, the face you build for your avatar, a short bio if you add one, and the date you joined.
- **What you post**: messages, replies, reactions and images you share in the community, and your support conversations with our team.
- **Learning**: the lessons, quizzes and exams you take, your scores, XP and any certificates you earn.
- **Payments**: the orders you place for Premium or paid rooms, the amount, currency and payment method, and the reference or screenshot you send as payment proof. Card and bank payments made through a payment provider are handled by that provider; we do not see or store your full card details.
- **Referrals and payouts**: who you invited, the earnings that follow, and the payout details you give us (for example a wallet address or bank details).
- **Affiliate program**: your application (traffic sources, links, plans), your tracking links and their statistics, and, when we need to verify you before a payout, identity documents you upload such as photos of your ID, a selfie holding your ID and proof of address.
- **Technical data**: your IP address, browser and device type, a device fingerprint built from basic browser settings, and the pages and links you open. We use these to keep accounts safe and to stop fraud and duplicate accounts.

## How we use it
- To create and run your Voo ID and sign you in with a one-time code by email.
- To run the community, the Academy, support, Premium, paid rooms, referrals and the affiliate program.
- To take payments, confirm payment proofs, pay referral and affiliate earnings, and keep records of them.
- To send emails you need (sign-in codes, receipts, replies) and, if you agree, news and offers. You can turn marketing emails off at any time.
- To check identities before payouts, prevent fraud, spam and abuse, and enforce our terms.
- To understand how VooSquare is used so we can improve it.

## Who we share it with
- **Zedapex tools you sign in to with your Voo ID** (such as Spyvoo, Joinvoo, Vooads, Replyvoo, Castvoo, Landvoo and Affleego). When you use "Continue with VooSquare", the tool receives your Voo ID, name, email and avatar so it can create your account there. Tools may send usage and payment events back to VooSquare so referral and affiliate earnings can be counted.
- **Service providers** that run parts of VooSquare for us, such as hosting, email delivery and payment providers. They use your data only to provide their service to us.
- **Affiliates and referrers** see only limited information about people they referred (for example a pseudonymous customer reference, country and payment status), never your email or messages.
- **Other members** see your public profile (name, handle, avatar, bio) and what you post in the community.
- **Authorities**, when the law requires it, or to protect our members and our business from fraud or harm.

We do not sell your personal data.

## How long we keep it
We keep your account data while your Voo ID is open. Payment, payout and tax records are kept for as long as the law requires. Identity documents are kept only as long as needed for the check and the records the law asks us to keep. When you delete content or close your account, we remove or anonymise what we no longer need.

## Your rights
You can ask us to show you the data we hold about you, correct it, delete it, or send you a copy. You can object to how we use it or ask us to limit it, and you can withdraw consent you gave, such as for marketing emails. Write to us at the address below. You may also complain to the data protection authority where you live.

## Cookies
VooSquare uses a few small cookies and browser storage to work:
- a sign-in cookie that keeps you logged in;
- referral and affiliate cookies that remember who invited you, and for one hour a coupon code from a link;
- settings saved in your browser, such as your lesson preferences and the support chat history on this device.

We do not use advertising or third-party tracking cookies on VooSquare.

## Security
We protect your data with encrypted connections, sign-in codes instead of passwords, limited staff access and regular backups. No system is perfectly secure, so tell us straight away if you think your account was misused.

## Changes to this policy
When we change this policy we update the date on this page, and we tell you in the app or by email if the change is important.

## Contact
${COMPANY}. Email: {support_email}. You can also message us from Support in the VooSquare app.
`,
  terms: `# Terms of service

These terms are the agreement between you and ${COMPANY} ("we", "us") for using VooSquare: the website, the app, the community, VooSquare Academy (inside the app and at voosquareacademy.com), Premium, paid rooms, referrals and your Voo ID. The affiliate program has its own [affiliate terms](/affiliates#/site/terms). By creating a Voo ID or using VooSquare you agree to these terms.

## Your Voo ID
- One person, one Voo ID. Use your real email address; we send your sign-in codes there.
- Keep access to your email safe. Anything done with your account is your responsibility.
- You must be old enough to make this agreement where you live.

## Community rules
- Be respectful. No harassment, hate, threats, spam or scams.
- Do not post illegal content, other people's private information, or content you do not have the right to share.
- Do not promise income or results, and do not present trading, betting or any offer as risk-free.
- Our team can remove content and mute, suspend or close accounts that break these rules.

## Learning content
VooSquare Academy, its lessons, the tools and community discussions are education and information. They are not financial, legal or tax advice, and they do not guarantee any income or result. Figures in lessons are examples. Certificates show that you completed a school; they are not a licence or a professional qualification.

## Premium and paid rooms
- Prices are shown before you pay. Premium and paid rooms are paid per period and do not renew automatically.
- Payments by transfer or crypto start once our team confirms them. An order you do not pay may be cancelled or expire; nothing is charged for it.
- If something is wrong with a payment, message Support with your order ID.

## Referrals
If you invite people, you may earn referral rewards under the rules shown on your Referrals page. We can refuse rewards that come from fake accounts, self-referrals or other abuse.

## Zedapex tools
Your Voo ID also signs you in to Zedapex tools. Each tool may have its own terms and prices, shown in that tool. How we handle your data is in our [privacy policy](/privacy).

## Ending your account
You can stop using VooSquare at any time and ask us to close your account. We can suspend or close an account that breaks these terms or puts other members at risk.

## Liability
We work hard to keep VooSquare running and accurate, but we provide it as it is, without guarantees. As far as the law allows, we are not responsible for indirect losses, lost profits or lost ad spend.

## Changes to these terms
When we change these terms we update the date on this page, and we tell you in the app or by email if the change is important. If you keep using VooSquare after a change, the new terms apply.

## Contact
${COMPANY}. Email: {support_email}. You can also message us from Support in the VooSquare app.
`,
};

function get() {
  const v = D.getSetting('legal', {}) || {};
  const doc = (k) => {
    const custom = typeof v[k] === 'object' && v[k] && typeof v[k].body === 'string' && v[k].body.trim();
    return { title: DOCS[k], body: custom ? v[k].body : TEMPLATES[k], custom: !!custom, updated_at: custom ? Number(v[k].updated_at) || 0 : 0 };
  };
  const ap = v.approved && typeof v.approved === 'object' ? v.approved : {};
  return { privacy: doc('privacy'), terms: doc('terms'), approved: { privacy: !!ap.privacy, terms: !!ap.terms, affiliate: !!ap.affiliate } };
}
const approved = (k) => get().approved[k];

function saveDoc(me, key, body) {
  if (!DOCS[key]) fail(404, 'Unknown document.');
  const text = String(body == null ? '' : body).replace(/\r\n/g, '\n');
  if (text.length > MAX) fail(400, 'That text is too long. Keep it under 60,000 characters.');
  const v = D.getSetting('legal', {}) || {};
  // Saving the template text unchanged, or an empty box, keeps the template (and its future improvements).
  v[key] = text.trim() && text.trim() !== TEMPLATES[key].trim() ? { body: text, updated_at: now(), by: me.id } : {};
  D.setSetting('legal', v);
  return get()[key];
}
function setApproval(me, b) {
  const v = D.getSetting('legal', {}) || {};
  const ap = { privacy: false, terms: false, affiliate: false, ...(v.approved || {}) };
  for (const k of Object.keys(ap)) if (b && b[k] !== undefined) ap[k] = !!b[k];
  v.approved = ap;
  D.setSetting('legal', v);
  return ap;
}

/* ------------------------------------------------------------------ markdown (the same small set as the affiliate terms) */
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // Links: same-site paths, https and mailto only.
    .replace(/\[([^\]]+)\]\(((?:\/(?!\/)|https:\/\/|mailto:)[^)\s]*)\)/g, '<a href="$2">$1</a>');
}
function render(md) {
  const toc = []; let n = 0; let list = false; const out = [];
  const close = () => { if (list) { out.push('</ul>'); list = false; } };
  for (const l of String(md || '').split(/\r?\n/)) {
    if (/^[-*]\s/.test(l)) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(l.slice(2))}</li>`); continue; }
    close();
    if (/^#\s/.test(l)) continue; // the page sets its own title
    if (/^##\s/.test(l)) { const id = 's' + (++n); toc.push([id, l.slice(3).trim()]); out.push(`<h2 id="${id}">${inline(l.slice(3))}</h2>`); continue; }
    if (/^###\s/.test(l)) { out.push(`<h3>${inline(l.slice(4))}</h3>`); continue; }
    if (/^>\s?/.test(l)) { out.push(`<p class="lg-note">${inline(l.replace(/^>\s?/, ''))}</p>`); continue; }
    if (!l.trim() || /^---+$/.test(l.trim())) continue;
    out.push(`<p>${inline(l)}</p>`);
  }
  close();
  return { html: out.join('\n'), toc };
}
const supportEmail = () => (D.getSetting('brand', {}) || {}).support_email || 'support@voosquare.com';
const fillVars = (md) => md.replace(/\{support_email\}/g, `[${supportEmail()}](mailto:${supportEmail()})`);

const BANNER = 'Draft — needs legal review before launch. This text is a plain-language template and is not yet in force.';
const dateText = (t) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Lagos' });

function page(key) {
  const s = get(); const d = s[key];
  const { html, toc } = render(fillVars(d.body));
  const other = key === 'privacy' ? ['/terms', 'Terms of service'] : ['/privacy', 'Privacy policy'];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(d.title)} · VooSquare</title><meta name="description" content="${esc(d.title)} for VooSquare and your Voo ID, by ${esc(COMPANY)}."><meta name="theme-color" content="#00A86B">
<link rel="icon" type="image/svg+xml" href="/assets/logo-icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;600;700;800&family=JetBrains+Mono:wght@500&display=swap">
<link rel="stylesheet" href="/css/shared.css"><link rel="stylesheet" href="/css/legal.css"></head>
<body class="lg-body"><header class="lg-top"><a class="lg-brand" href="/"><img src="/assets/logo-icon.svg" alt="" width="32" height="32"><b>Voo<span>Square</span></b></a><nav class="lg-nav" aria-label="Legal"><a href="/privacy"${key === 'privacy' ? ' aria-current="page"' : ''}>Privacy</a><a href="/terms"${key === 'terms' ? ' aria-current="page"' : ''}>Terms</a><a href="/affiliates#/site/terms">Affiliate terms</a></nav></header>
<main class="lg">
  <div class="lg-head"><h1>${esc(d.title)}</h1><p class="lg-meta">${esc(COMPANY)}${d.updated_at ? ` · Last updated ${esc(dateText(d.updated_at))}` : ''}</p>
  ${key !== 'terms' && !s.approved[key] ? `<p class="lg-draft" role="note"><span aria-hidden="true"></span>${esc(BANNER)}</p>` : ''}</div>
  ${toc.length > 2 ? `<nav class="lg-toc" aria-label="On this page"><b>On this page</b>${toc.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>` : ''}
  <article class="lg-doc">${html}</article>
</main>
<footer class="lg-foot"><span>© ${new Date().getFullYear()} ${esc(COMPANY)}</span><nav aria-label="Footer"><a href="/">voosquare.com</a><a href="${other[0]}">${other[1]}</a><a href="/affiliates#/site/terms">Affiliate terms</a></nav></footer>
</body></html>`;
}

/* ------------------------------------------------------------------ affiliate terms, public version */
/**
 * docs/AFFILIATE_TERMS.md as affiliates read it: program figures in {braces} come from the live settings, drafting notes
 * for counsel and the pointer to internal files are left out, and the draft banner shows until the owner approves.
 */
function affiliateTerms() {
  const C = require('./aff/core');
  const s = C.settings();
  const T = C.tiers();
  const days = T.map((t) => Number(t.sla_days) || 0).filter(Boolean);
  const dmin = days.length ? Math.min(...days) : 1; const dmax = days.length ? Math.max(...days) : 3;
  const pctOf = (bp) => String(Math.round(Number(bp) || 0) / 100).replace(/\.0+$/, '');
  const m = (s.payouts && s.payouts.methods) || {};
  const usd = (c) => String(Math.round(Number(c) || 0) / 100).replace(/\.00$/, '');
  const kyc = s.kyc || {};
  let md = C.termsText();
  const rep = [
    // The drafting note at the top (it named an internal file) becomes the owner-controlled banner.
    [/^>\s*\*\*DRAFT FOR LEGAL REVIEW\.\*\*.*$/m, ''],
    [/\{60\} days from the click/, `${s.attribution_days} days from the click`],
    [/within \{2\} business days/, `within ${s.approval_sla_days} business days`],
    [/reapply after \{30\} days/, `reapply after ${s.reapply_days} days`],
    [/maximum \{35\}%/, `maximum ${pctOf(C.AI_CAP_BP)}%`],
    [/maximum \{50\}%/, `maximum ${pctOf(C.HARD_CAP_BP)}%`],
    [/exceeds \{8\}%/, `exceeds ${pctOf(s.quality.no_upgrade_bp)}%`],
    [/exceeds \{15\}%/, `exceeds ${pctOf(s.quality.drop_bp)}%`],
    [/at least \{10\} New Paying/, `at least ${s.quality.min_customers} New Paying`],
    [/your first \{5\} Qualified/, `your first ${s.activation_customers} Qualified`],
    [/within \{90\} days of qualifying/, `within ${s.cpa.clawback_days} days of qualifying`],
    [/within \{180\} days after payout/, `within ${s.cpa.fraud_clawback_days} days after payout`],
    [/\*\*\$\{50\}\*\* for USDT \(TRC20\)/, `**$${usd(m.usdt_trc20 ? m.usdt_trc20.min_cents : 5000)}** for USDT (TRC20)`],
    [/\*\*\$\{100\}\*\* for BTC/, `**$${usd(m.btc ? m.btc.min_cents : 10000)}** for BTC`],
    [/\*\*\{1 to 3\} business days\*\*/, `**${dmin === dmax ? dmin : `${dmin} to ${dmax}`} business ${dmax === 1 ? 'day' : 'days'}**`],
    [/ \(including before your first payout above \$\{kyc_threshold\}\)/, kyc.required === 'never' ? '' : Number(kyc.threshold_cents) > 0 ? ` (including before your first payout above $${usd(kyc.threshold_cents)})` : ' (including before your first payout)'],
    [/\*\*\{14\} days\*\* after notice for program-wide/, `**${s.notice_days.cpa_program} days** after notice for program-wide`],
    [/\*\*\{7\} days\*\* after notice for a deal/, `**${s.notice_days.cpa_affiliate} days** after notice for a deal`],
    [/take effect \*\*\{30\} days\*\* after notice/, `take effect **${s.notice_days.revshare} days** after notice`],
    // Notes for counsel: the banner says governing law and venue are to be confirmed, so the text itself stays clean.
    [/ \{confirm with counsel\}/g, ''], [/ \{confirm method\}/g, ''], [/ \{venue to confirm with counsel\}/g, ''],
    [/\*\*Nigeria — confirm with counsel\*\*/, '**Nigeria**'], [/\*\*\{Lagos State, Nigeria, confirm with counsel\}\*\*/, '**Lagos State, Nigeria**'],
    [/VooSquare Privacy Policy \{link\}/, 'VooSquare [Privacy Policy](/privacy)'],
  ];
  for (const [re, to] of rep) md = md.replace(re, to);
  // Every other {value} is a fixed figure of these terms: keep the value, drop the braces.
  md = md.replace(/\$\{([^{}]+)\}/g, '$$$1').replace(/\{([^{}]+)\}/g, '$1');
  md = md.replace(/^\n+/, '');
  if (!approved('affiliate')) md = md.replace(/^(# .*\n)/, `$1\n> **DRAFT FOR LEGAL REVIEW.** Not in force. Governing law and dispute venue must be confirmed by counsel.\n`);
  return md;
}

/* ------------------------------------------------------------------ routes */
function routes(r) {
  const A = require('./auth');
  const audit = (me, action, detail) => D.insert('audit', { user_id: me.id, action, detail: String(detail).slice(0, 300), created_at: now() });
  r.get('/privacy', (ctx) => ctx.html(200, page('privacy')));
  r.get('/terms', (ctx) => ctx.html(200, page('terms')));
  r.get('/legal', (ctx) => ctx.redirect('/terms'));
  r.get('/api/legal', () => { const s = get(); return { privacy: { url: '/privacy', approved: s.approved.privacy }, terms: { url: '/terms', approved: s.approved.terms }, affiliate_terms: { url: '/affiliates#/site/terms', approved: s.approved.affiliate } }; });

  r.get('/api/admin/legal', (ctx) => {
    const me = A.requirePerm(ctx, 'settings');
    const s = get();
    return { ...s, templates: TEMPLATES, company: COMPANY, banner: BANNER, can_approve: A.isOwner(me), urls: { privacy: config.baseUrl + '/privacy', terms: config.baseUrl + '/terms', affiliate: config.baseUrl + '/affiliates#/site/terms' } };
  });
  r.put('/api/admin/legal/approval', async (ctx) => {
    const me = A.requirePerm(ctx, 'settings');
    if (!A.isOwner(me)) fail(403, 'Only an owner can mark a document as approved by counsel.');
    const ap = setApproval(me, await ctx.json());
    audit(me, 'legal.approval', JSON.stringify(ap));
    return { approved: ap };
  });
  r.put('/api/admin/legal/:doc', async (ctx) => {
    const me = A.requirePerm(ctx, 'settings');
    const b = await ctx.json();
    const d = saveDoc(me, ctx.params.doc, b.body);
    audit(me, 'legal.save', `${ctx.params.doc}${d.custom ? '' : ' (template)'}`);
    return { doc: d };
  });
}

module.exports = { get, approved, saveDoc, setApproval, render, page, affiliateTerms, routes, TEMPLATES, BANNER, COMPANY };
