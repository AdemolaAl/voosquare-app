'use strict';
/*
 * Builds the default email templates (templates.json) and the welcome series (sequence.json).
 * Run: node src/emails/build.js
 * The app loads these files on boot (src/mailer.js seedTemplates); after that, templates are edited in the admin.
 * {{var}} is HTML-escaped by the mailer, {{{var}}} is inserted raw.
 *
 * Design system
 *  - One shell for every email: dark header band (logo + topic) that runs straight into the illustrated hero,
 *    a white body card, one primary button, quiet secondary links, a small footer.
 *  - Hero art is drawn in src/emails/art (art.js, render.py) and listed in src/emails/art/heroes.json. The band takes the
 *    hero's plate colour so the two read as one piece. Frame 0 of every GIF is the finished picture (Outlook shows only it).
 *  - Table layout, inline styles, 600px, bulletproof buttons (VML for Outlook), alt text, preheader, plain-text part.
 *  - Dark mode: Apple Mail and iOS get explicit dark colours (prefers-color-scheme); Outlook.com gets [data-ogsc] rules.
 *    Gmail apps invert on their own; the header band is already dark and the logo is white, so it survives either way.
 *  - Prices come from settings through the mailer: {{premium_price}}, {{premium_period}}, {{inner_circle_price}}...
 */
const fs = require('node:fs');
const path = require('node:path');

const HEROES = JSON.parse(fs.readFileSync(path.join(__dirname, 'art', 'heroes.json'), 'utf8'));

const FONT = "'Plus Jakarta Sans', 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace";
const C = {
  outer: '#EDF0EC', card: '#FFFFFF', ink: '#0A1611', body: '#3A4842', muted: '#67766E', faint: '#8F9D96', line: '#E3E8E4',
  panel: '#F6F4EE', panelLine: '#E9E5DA', deep: '#00774B', green: '#00A86B', lime: '#C9F65B', bandText: '#B7C8BF',
};
const IMG = (file) => `{{baseUrl}}/email/${file}`;

const P = {
  spyvoo: { name: 'Spyvoo', icon: 'spyvoo', stage: 'Research', color: '#2A45D6', button: '#3355F0', bg: '#EEF1FF', line: 'Search live Facebook and Instagram ads from every country, see which have run for months and why they work.', offer: 'Start free', url: 'https://spyvoo.com' },
  affleego: { name: 'Affleego', icon: 'affleego', stage: 'Monetize', color: '#7A5E00', bg: '#FFF6CC', line: 'Premium CPA and RevShare deals in finance, sports and casino.', offer: 'Browse the deals', url: 'https://affleego.com' },
  vooads: { name: 'Vooads', icon: 'vooads', stage: 'Acquire', color: '#B9381A', button: '#C8401C', bg: '#FCE9E1', line: 'AI ad creatives: videos, images and hooks in every size, checked against Meta’s rules before you spend.', offer: 'First ads free', url: '{{appUrl}}#apps' },
  landvoo: { name: 'Landvoo', icon: 'land', stage: 'Acquire', color: '#B02A63', bg: '#FDE6EF', line: 'Landing pages built to pass review and convert paid traffic.', offer: 'Coming soon', url: '' },
  joinvoo: { name: 'Joinvoo', icon: 'join', stage: 'Track', color: '#4B31D6', button: '#5B3FE8', bg: '#EEEBFF', line: 'Every real Telegram join, sign-up and deposit, sent back to the ad platforms server-side.', offer: 'First 500 joins free', url: 'https://joinvoo.com' },
  replyvoo: { name: 'Replyvoo', icon: 'reply', stage: 'Convert', color: '#7A5C00', bg: '#FFF5D6', line: 'AI Closers answer every Telegram chat in seconds, qualify the lead and send the payment link.', offer: '30 free chats a month', url: '{{appUrl}}#apps' },
  castvoo: { name: 'Castvoo', icon: 'cast', stage: 'Retain', color: '#2449D8', bg: '#E8EEFF', line: 'Broadcasts and drip sequences that welcome, follow up and sell to every subscriber.', offer: '7 days free', url: '{{appUrl}}#apps' },
  gatevoo: { name: 'Gatevoo', icon: 'gatevoo', stage: 'Collect', color: '#111111', bg: '#F1F0EB', line: 'The checkout behind the Voo family. USDT and Bitcoin, straight to your wallet.', offer: 'Join the waitlist', url: 'https://gatevoo.com' },
};
const ORDER = ['spyvoo', 'affleego', 'vooads', 'landvoo', 'joinvoo', 'replyvoo', 'castvoo', 'gatevoo'];

/* ------------------------------------------------------------------ building blocks */
const font = (size, lh, weight = 400, color = C.body, extra = '') => `font-family:${FONT};font-size:${size}px;line-height:${lh}px;font-weight:${weight};color:${color};${extra}`;
const table = (inner, style = '', attrs = '') => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${attrs} style="border-collapse:separate;${style}">${inner}</table>`;

/** Paragraph. o: { size, lh, color, mb, cls, style } */
const p = (html, o = {}) => `<p class="${o.cls || (o.color === C.muted ? 'dm-muted' : 'dm-body')}" style="margin:0 0 ${o.mb ?? 16}px;${font(o.size || 16, o.lh || 26, o.weight || 400, o.color || C.body)}${o.style || ''}">${html}</p>`;
const small = (html, o = {}) => p(html, { size: 13, lh: 20, color: C.muted, mb: 0, ...o });
const b = (html) => `<strong class="dm-ink" style="color:${C.ink};font-weight:700;">${html}</strong>`;
const h1 = (html) => `<h1 class="h1 dm-ink" style="margin:0 0 16px;${font(30, 36, 800, C.ink, 'letter-spacing:-0.8px;')}">${html}</h1>`;
const h2 = (html, o = {}) => `<h2 class="dm-ink" style="margin:${o.mt ?? 0}px 0 ${o.mb ?? 14}px;${font(19, 25, 800, C.ink, 'letter-spacing:-0.4px;')}">${html}</h2>`;
const a = (txt, url, color = C.deep) => `<a class="dm-link" href="${url}" target="_blank" style="color:${color};font-weight:700;text-decoration:underline;text-decoration-thickness:1px;">${txt}</a>`;
const spacer = (h) => table(`<tr><td style="height:${h}px;line-height:${h}px;font-size:0;">&nbsp;</td></tr>`);
const divider = (mt = 28, mb = 28) => table(`<tr><td style="padding:${mt}px 0 ${mb}px;">${table(`<tr><td class="dm-line" style="height:1px;line-height:1px;font-size:0;background:${C.line};">&nbsp;</td></tr>`)}</td></tr>`);

/** Bulletproof button: VML roundrect for Outlook desktop, a padded link everywhere else. */
function button(txt, url, o = {}) {
  const bg = o.bg || C.deep;
  const fg = o.fg || '#FFFFFF';
  const plain = txt.replace(/\{\{\s*\w+\s*\}\}/g, '$299').replace(/&[a-z#0-9]+;/g, 'x');
  const w = o.w || Math.max(200, Math.round(plain.length * 9.4 + 60));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${o.mt ?? 28}px 0 0;"><tr><td align="left">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${url}" style="height:52px;v-text-anchor:middle;width:${w}px;" arcsize="24%" stroke="f" fillcolor="${bg}"><w:anchorlock/><center style="color:${fg};font-family:'Segoe UI',Arial,sans-serif;font-size:16px;font-weight:bold;">${txt}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><a href="${url}" target="_blank" style="display:inline-block;background:${bg};border-radius:12px;padding:16px 28px;${font(16, 20, 800, fg, 'letter-spacing:-0.1px;text-decoration:none;mso-hide:all;')}">${txt}</a><!--<![endif]-->
</td></tr></table>`;
}

/** Secondary links under the button: [[text, url], ...] */
function links(list, o = {}) {
  return `<p class="dm-body" style="margin:${o.mt ?? 18}px 0 0;${font(14, 22, 400, C.body)}">${list.map(([t, u]) => a(t, u)).join('<span style="display:inline-block;width:18px;">&nbsp;</span>')}</p>`;
}

/** Warm panel used for receipts, callouts and notes. */
function panel(inner, o = {}) {
  const bg = o.bg || C.panel;
  return table(`<tr><td class="${o.dark ? '' : 'dm-panel'}" bgcolor="${bg}" style="background:${bg};border-radius:16px;padding:${o.pad || '20px 22px'};${o.border !== false ? `border:1px solid ${o.border || (o.dark ? bg : C.panelLine)};` : ''}">${inner}</td></tr>`, `margin:${o.mt ?? 6}px 0 ${o.mb ?? 6}px;`);
}

/** Receipt rows: [[label, value], ...] */
function kv(rows, o = {}) {
  return panel(table(rows.map(([k, v], i) => `<tr>
<td class="dm-muted${i ? ' dm-line' : ''}" valign="top" style="padding:12px 12px 12px 0;${i ? `border-top:1px solid ${C.panelLine};` : ''}${font(14, 20, 400, C.muted)}">${k}</td>
<td class="dm-ink${i ? ' dm-line' : ''}" align="right" valign="top" style="padding:12px 0;${i ? `border-top:1px solid ${C.panelLine};` : ''}${font(15, 20, 700, C.ink, 'word-break:break-word;')}">${v}</td></tr>`).join('')), { pad: '6px 20px', ...o });
}

/** Numbered steps (only for content that is a real sequence): [[title, text], ...] */
function steps(list, o = {}) {
  const nb = o.numBg || C.ink;
  const nf = o.numFg || C.lime;
  return table(list.map(([t, d], i) => `<tr>
<td width="44" valign="top" style="padding:0 14px ${i === list.length - 1 ? 0 : 18}px 0;">${`<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="30" height="30" bgcolor="${nb}" style="width:30px;height:30px;border-radius:15px;background:${nb};${font(14, 30, 800, nf)}">${i + 1}</td></tr></table>`}</td>
<td valign="top" style="padding:0 0 ${i === list.length - 1 ? 0 : 18}px;"><p class="dm-ink" style="margin:4px 0 4px;${font(16, 22, 800, C.ink, 'letter-spacing:-0.2px;')}">${t}</p><p class="dm-body" style="margin:0;${font(15, 23, 400, C.body)}">${d}</p></td>
</tr>`).join(''));
}

/** Ticked list: [html, ...] */
function ticks(list, o = {}) {
  const c = o.color || C.green;
  return table(list.map((h, i) => `<tr>
<td width="24" valign="top" style="padding:${i ? 10 : 0}px 10px 0 0;${font(15, 24, 800, c)}">&#10003;</td>
<td class="${o.textCls || 'dm-body'}" valign="top" style="padding:${i ? 10 : 0}px 0 0;${font(15, 24, 400, o.text || C.body)}">${h}</td></tr>`).join(''));
}

function icon(key, size = 44, radius = 12) {
  return `<img src="${IMG(`icons/${key}.png`)}" width="${size}" height="${size}" alt="" style="display:block;width:${size}px;height:${size}px;border:0;border-radius:${radius}px;">`;
}

/** One tool in the Voo system list. */
function toolRow(k, last) {
  const t = P[k];
  const offer = t.url ? `<a class="dm-link" href="${t.url}" target="_blank" style="color:${t.color};font-weight:700;text-decoration:none;">${t.offer}</a>` : `<span class="dm-muted" style="color:${C.muted};font-weight:700;">${t.offer}</span>`;
  return `<tr>
<td width="44" valign="top" style="padding:0 16px ${last ? 0 : 22}px 0;">${icon(t.icon, 44, 12)}</td>
<td valign="top" style="padding:0 0 ${last ? 0 : 22}px;"><p class="dm-ink" style="margin:0 0 3px;${font(16, 22, 800, C.ink, 'letter-spacing:-0.2px;')}">${t.name}<span class="dm-muted" style="${font(13, 22, 600, C.muted)}">&nbsp;&nbsp;${t.stage}</span></p>
<p class="dm-body" style="margin:0 0 5px;${font(15, 22, 400, C.body)}">${t.line}</p>
<p style="margin:0;${font(14, 20, 700, t.color)}">${offer}</p></td></tr>`;
}

/** A product block on its tint: icon, name and stage, a title, paragraphs, the offer line. */
function product(k, title, paras, offer) {
  const t = P[k];
  return panel(`${table(`<tr><td width="44" valign="middle" style="padding:0 14px 0 0;">${icon(t.icon, 44, 12)}</td>
<td valign="middle"><p style="margin:0;${font(13, 18, 700, t.color)}">${t.name}, ${t.stage.toLowerCase()}</p><p class="dm-ink" style="margin:2px 0 0;${font(18, 24, 800, C.ink, 'letter-spacing:-0.4px;')}">${title}</p></td></tr>`)}
${paras.map((x) => `<p class="dm-body" style="margin:14px 0 0;${font(15, 23, 400, C.body)}">${x}</p>`).join('')}
<p style="margin:14px 0 0;${font(14, 20, 700, t.color)}">${offer}</p>`, { bg: t.bg, border: false, pad: '22px 22px', mb: 12, mt: 0 });
}

function signature(name, role) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 0;"><tr>
<td width="48" valign="middle" style="padding:0 14px 0 0;"><img src="${IMG('founder.png')}" width="48" height="48" alt="Dchessking" style="display:block;width:48px;height:48px;border:0;border-radius:24px;"></td>
<td valign="middle"><p class="dm-ink" style="margin:0;${font(16, 22, 800, C.ink)}">${name}</p><p class="dm-muted" style="margin:0;${font(14, 20, 400, C.muted)}">${role}</p></td></tr></table>`;
}

/* ------------------------------------------------------------------ page shell */
const PREHEADER_PAD = '&#8199;&#65279;&#847; '.repeat(60);

const HEAD_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark;}
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
img{-ms-interpolation-mode:bicubic;}
a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;}
@media only screen and (max-width:620px){
  .wrap{padding:12px 8px 28px !important;}
  .px{padding-left:24px !important;padding-right:24px !important;}
  .band{padding-left:22px !important;padding-right:22px !important;}
  .h1{font-size:25px !important;line-height:31px !important;letter-spacing:-0.6px !important;}
  .fluid{width:100% !important;max-width:100% !important;height:auto !important;}
  .code{font-size:34px !important;letter-spacing:7px !important;}
  .stack{display:block !important;width:100% !important;}
  .stack-gap{padding:0 0 10px 0 !important;}
  .kicker{display:none !important;}
}
@media (prefers-color-scheme:dark){
  .dm-outer{background:#0B1410 !important;}
  .dm-card{background:#121C17 !important;}
  .dm-panel{background:#1A2621 !important;border-color:#26352D !important;}
  .dm-ink{color:#F0F4F1 !important;}
  .dm-body{color:#C3CEC8 !important;}
  .dm-muted{color:#93A39A !important;}
  .dm-link{color:#9FE38A !important;}
  .dm-line{border-color:#26352D !important;background-color:#26352D !important;}
}
[data-ogsc] .dm-ink{color:#F0F4F1 !important;}
[data-ogsc] .dm-body{color:#C3CEC8 !important;}
[data-ogsc] .dm-muted{color:#93A39A !important;}
[data-ogsc] .dm-link{color:#9FE38A !important;}
[data-ogsb] .dm-outer{background:#0B1410 !important;}
[data-ogsb] .dm-card{background:#121C17 !important;}
[data-ogsb] .dm-panel{background:#1A2621 !important;}
`;

/**
 * hero: key in heroes.json (or null). kicker: the topic, shown on the right of the band.
 */
function layout({ title, kicker = '', hero = null, body, marketing }) {
  if (!marketing) return plainLayout({ title, body });
  const H = hero ? HEROES[hero] : null;
  const band = H ? H.band : '#083323';
  const heroRow = H ? `<tr><td bgcolor="${band}" style="background:${band};padding:0;font-size:0;line-height:0;"><img src="${IMG(H.file)}" width="${H.width}" height="${H.height}" alt="${H.alt}" class="fluid" style="display:block;width:100%;max-width:${H.width}px;height:auto;border:0;outline:none;text-decoration:none;${font(14, 20, 700, '#FFFFFF')}background:${band};"></td></tr>` : '';
  const footer = `<tr><td align="center" class="px" style="padding:30px 32px 8px;">
<img src="${IMG('logo-icon.png')}" width="28" height="28" alt="VooSquare" style="display:block;width:28px;height:28px;border:0;border-radius:8px;margin:0 auto 12px;">
<p class="dm-ink" style="margin:0 0 4px;${font(13, 20, 700, C.ink)}">VooSquare by Zedapex. Media buying, squared.</p>
<p class="dm-muted" style="margin:0 0 4px;${font(12, 19, 400, C.muted)}">Questions? Write to <a class="dm-link" href="mailto:{{supportEmail}}" style="color:${C.deep};font-weight:700;text-decoration:none;">{{supportEmail}}</a></p>
${marketing ? `<p class="dm-muted" style="margin:0 0 4px;${font(12, 19, 400, C.muted)}">You get these emails because you created a VooSquare account. <a class="dm-muted" href="{{unsubscribeUrl}}" target="_blank" style="color:${C.muted};text-decoration:underline;">Unsubscribe</a></p>` : ''}
<p class="dm-muted" style="margin:10px 0 0;${font(11, 17, 400, C.faint)}">&copy; {{year}} Zedapex Limited, Lagos</p>
</td></tr>`;

  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><style>table,td,p,a,span,h1,h2,strong{font-family:'Segoe UI',Arial,sans-serif !important;}</style><![endif]-->
<!--[if !mso]><!--><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&amp;display=swap" rel="stylesheet"><!--<![endif]-->
<style>${HEAD_CSS}</style>
</head>
<body class="dm-outer" style="margin:0;padding:0;width:100%;background:${C.outer};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.outer};">{{preheader}}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dm-outer" bgcolor="${C.outer}" style="background:${C.outer};">
<tr><td align="center" class="wrap" style="padding:28px 16px 40px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;margin:0 auto;border-collapse:separate;">
<tr><td class="band" bgcolor="${band}" style="background:${band};border-radius:20px 20px 0 0;padding:22px 32px ${H ? 6 : 24}px;">
${table(`<tr><td valign="middle"><a href="{{baseUrl}}" target="_blank" style="text-decoration:none;"><img src="${IMG('logo-white.png')}" width="140" height="29" alt="VooSquare" style="display:block;width:140px;height:29px;border:0;${font(18, 29, 800, '#FFFFFF')}"></a></td>
${kicker ? `<td class="kicker" align="right" valign="middle" style="${font(13, 18, 600, C.bandText)}">${kicker}</td>` : ''}</tr>`)}
</td></tr>
${heroRow}
<tr><td class="px dm-card" bgcolor="${C.card}" style="background:${C.card};border-radius:0 0 20px 20px;padding:${H ? 36 : 38}px 44px 42px;${font(16, 26, 400, C.body)}">
${body}
</td></tr>
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/**
 * Transactional shell (codes, receipts, payouts, support replies, approvals).
 * Gmail sorts by how a message looks, not by what you call it: a dark branded band, an illustrated GIF hero, a logo image
 * and a web font read as a newsletter and land in Promotions. This shell looks like a message from a person's app:
 * no images at all, no external stylesheet, system fonts, one white column, one button. That keeps these in Primary.
 */
function plainLayout({ title, body }) {
  const footer = `<tr><td class="px" style="padding:22px 36px 0;">
<p class="dm-muted" style="margin:0 0 4px;${font(12, 19, 400, C.muted)}">Questions? Write to <a class="dm-link" href="mailto:{{supportEmail}}" style="color:${C.deep};text-decoration:none;">{{supportEmail}}</a></p>
<p class="dm-muted" style="margin:0;${font(12, 19, 400, C.faint)}">VooSquare, Zedapex Limited, Lagos</p>
</td></tr>`;
  return `<!doctype html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${title}</title>
<style>${HEAD_CSS}</style>
</head>
<body class="dm-card" style="margin:0;padding:0;width:100%;background:${C.card};">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.card};">{{preheader}}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="dm-card" bgcolor="${C.card}" style="background:${C.card};">
<tr><td align="left" class="wrap" style="padding:28px 16px 36px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;border-collapse:separate;">
<tr><td class="px" style="padding:0 36px 22px;"><p class="dm-ink" style="margin:0;${font(17, 24, 800, C.ink, 'letter-spacing:-0.3px;')}">VooSquare</p></td></tr>
<tr><td class="px dm-card" style="padding:0 36px;${font(16, 26, 400, C.body)}">
${body}
</td></tr>
<tr><td class="px" style="padding:28px 36px 0;">${table(`<tr><td class="dm-line" style="height:1px;line-height:1px;font-size:0;background:${C.line};">&nbsp;</td></tr>`)}</td></tr>
${footer}
</table>
</td></tr>
</table>
</body>
</html>`;
}

/* ------------------------------------------------------------------ plain text */
function textFooter(marketing) {
  return '\n\n--\nVooSquare by Zedapex. Media buying, squared.\nQuestions? Write to {{supportEmail}}\nZedapex Limited, Lagos'
    + (marketing ? '\n\nYou get these emails because you created a VooSquare account.\nUnsubscribe: {{unsubscribeUrl}}' : '');
}
const txt = (lines, marketing) => lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + textFooter(marketing);

const LEGAL = 'Finance, sports and casino offers are regulated differently in every country. Run them only where they are legal, and follow each ad platform’s rules in every country you target.';
const legal = () => small(LEGAL, { size: 12, lh: 19, style: 'margin-top:18px;' });

/* ------------------------------------------------------------------ templates */
const T = {};

/* ---------- sign in ---------- */
T.verify_code = {
  name: 'Verification code',
  subject: 'Your VooSquare code: {{code}}',
  preheader: 'Enter this code to sign in. It expires in 10 minutes.',
  marketing: 0,
  html: layout({
    title: 'Your VooSquare code',
    kicker: 'Sign in',
    hero: 'login',
    body: [
      h1('Your sign-in code'),
      p('Hi {{firstName}}, enter this code on the VooSquare sign-in page.'),
      panel(`<p class="code dm-ink" style="margin:0;font-family:${MONO};font-size:42px;line-height:50px;font-weight:700;letter-spacing:10px;color:${C.ink};text-align:center;">{{code}}</p>
<p class="dm-muted" style="margin:8px 0 0;${font(13, 18, 600, C.muted, 'text-align:center;')}">Expires in 10 minutes</p>`, { pad: '24px 12px', mt: 8, mb: 22 }),
      small('Never share this code. Nobody from VooSquare or Zedapex will ask you for it. If you did not ask for a code, ignore this email: nobody can sign in without it.', { size: 14, lh: 22 }),
    ].join('\n'),
  }),
  text: txt([
    'Hi {{firstName}},',
    '',
    'Your VooSquare sign-in code is: {{code}}',
    'It expires in 10 minutes.',
    '',
    'Never share this code. Nobody from VooSquare or Zedapex will ask you for it. If you did not ask for a code, ignore this email: nobody can sign in without it.',
  ], false),
};

/* ---------- support ---------- */
T.support_reply = {
  name: 'Support reply',
  subject: 'Re: {{subject}}',
  preheader: '{{agent}} from the {{product}} team replied to your message.',
  marketing: 0,
  html: layout({
    title: 'Support reply',
    kicker: '{{product}} support',
    hero: 'support',
    body: [
      h1('You have a reply'),
      p(`Hi {{firstName}}, ${b('{{agent}}')} from the {{product}} team replied to ${b('{{subject}}')}.`),
      table(`<tr><td class="dm-panel dm-ink" bgcolor="${C.panel}" style="background:${C.panel};border-left:4px solid ${C.green};border-radius:4px 16px 16px 4px;padding:18px 22px;${font(16, 26, 400, C.ink)}">{{{reply_html}}}</td></tr>`, 'margin:6px 0 0;'),
      p(`${b('{{agent}}')}<br>{{product}} support`, { size: 15, lh: 22, mb: 0, style: 'margin-top:16px;' }),
      button('View the conversation', '{{ticket_url}}'),
      small('Reply in the conversation so your whole history stays in one place.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Hi {{firstName}},',
    '',
    '{{agent}} from the {{product}} team replied to "{{subject}}":',
    '',
    '{{reply}}',
    '',
    '{{agent}}, {{product}} support',
    '',
    'View the conversation: {{ticket_url}}',
    'Reply in the conversation so your whole history stays in one place.',
  ], false),
};

/* ---------- premium and payments ---------- */
T.premium_welcome = {
  name: 'Premium welcome',
  subject: 'Welcome to Premium, {{firstName}}',
  preheader: 'Your Premium access is active until {{until}}. Here is where to start.',
  marketing: 0,
  html: layout({
    title: 'Welcome to Premium',
    kicker: 'Premium',
    hero: 'premium',
    body: [
      h1('Welcome to Premium, {{firstName}}'),
      p(`Thank you for backing VooSquare. Your Premium access is active until ${b('{{until}}')}. Here is where to start.`, { mb: 24 }),
      steps([
        ['Join the premium rooms', `Buyers’ Lounge, Scaling Desk, Offer Drops and Creative Reviews. ${a('Open the rooms', '{{appUrl}}#community')}`],
        ['Take the advanced courses', `Every Academy course is open, including the advanced tracks. ${a('Browse the courses', '{{appUrl}}#academy')}`],
        ['Book the live breakdown', 'Dchessking breaks down a live campaign each month. Dates go out in Announcements, and replays stay in the Academy.'],
        ['Use priority support', `Templates and playbooks are in your library, and your tickets go to the front of the queue. ${a('Open support', '{{appUrl}}#support')}`],
      ]),
      spacer(6),
      p('Your Premium badge is on your profile, and you get early access when new tools land.', { mb: 0, style: 'margin-top:18px;' }),
      button('Go to the Buyers’ Lounge', '{{appUrl}}#community'),
    ].join('\n'),
  }),
  text: txt([
    'Welcome to Premium, {{firstName}}',
    '',
    'Thank you for backing VooSquare. Your Premium access is active until {{until}}. Here is where to start.',
    '',
    '1. Join the premium rooms: Buyers’ Lounge, Scaling Desk, Offer Drops and Creative Reviews. {{appUrl}}#community',
    '2. Take the advanced courses. Every Academy course is open, including the advanced tracks. {{appUrl}}#academy',
    '3. Book the live breakdown. Dchessking breaks down a live campaign each month. Dates go out in Announcements, and replays stay in the Academy.',
    '4. Use priority support. Templates and playbooks are in your library, and your tickets go to the front of the queue. {{appUrl}}#support',
    '',
    'Your Premium badge is on your profile, and you get early access when new tools land.',
    '',
    'Go to the Buyers’ Lounge: {{appUrl}}#community',
  ], false),
};

T.premium_receipt = {
  name: 'Premium receipt',
  subject: 'Payment received: {{item}}',
  preheader: 'Receipt for {{amount}}. Reference {{ref}}.',
  marketing: 0,
  html: layout({
    title: 'Payment received',
    kicker: 'Receipt',
    hero: 'receipt',
    body: [
      h1('Payment received'),
      p('Thanks, {{firstName}}. Here is your receipt. Keep this email for your records.'),
      kv([['Item', '{{item}}'], ['Amount', '{{amount}}'], ['Reference', '{{ref}}'], ['Access until', '{{until}}']]),
      button('Open VooSquare', '{{appUrl}}#premium'),
      small('Sold by Zedapex Limited through VooSquare. VooSquare only charges for Premium and paid rooms. Each tool handles its own billing.', { style: 'margin-top:18px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Payment received',
    '',
    'Thanks, {{firstName}}. Here is your receipt. Keep this email for your records.',
    '',
    'Item: {{item}}',
    'Amount: {{amount}}',
    'Reference: {{ref}}',
    'Access until: {{until}}',
    '',
    'Open VooSquare: {{appUrl}}#premium',
    '',
    'Sold by Zedapex Limited through VooSquare. VooSquare only charges for Premium and paid rooms. Each tool handles its own billing.',
  ], false),
};

T.premium_expiring = {
  name: 'Premium expiring',
  subject: 'Your Premium ends on {{until}}',
  preheader: 'Renew to keep the premium rooms, every course and the live breakdowns.',
  marketing: 0,
  html: layout({
    title: 'Your Premium ends soon',
    kicker: 'Premium',
    hero: 'expiring',
    body: [
      h1('Your Premium ends soon'),
      p(`Hi {{firstName}}, your Premium access ends on ${b('{{until}}')}. Here is what changes if you do not renew.`),
      table(`<tr>
<td class="stack stack-gap" width="50%" valign="top" style="padding:0 6px 0 0;">${panel(`<p class="dm-ink" style="margin:0 0 10px;${font(15, 22, 800, C.ink)}">Stays free</p>${ticks(['Your Voo ID and every tool', 'The free rooms and courses', 'The blog and support'])}`, { mt: 0, mb: 0 })}</td>
<td class="stack" width="50%" valign="top" style="padding:0 0 0 6px;">${panel(`<p style="margin:0 0 10px;${font(15, 22, 800, '#FFFFFF')}">Closes until you renew</p>${ticks(['The premium rooms', 'The advanced courses', 'Live breakdowns and replays'], { color: C.lime, text: '#D3DED8', textCls: ' ' })}`, { bg: C.ink, dark: true, mt: 0, mb: 0 })}</td>
</tr>`, 'margin:6px 0 0;'),
      button('Renew Premium, {{premium_price}} {{premium_period}}', '{{appUrl}}#premium'),
      small('Already renewed? You can ignore this email.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Hi {{firstName}},',
    '',
    'Your Premium access ends on {{until}}. Here is what changes if you do not renew.',
    '',
    'Stays free: your Voo ID and every tool, the free rooms and courses, the blog and support.',
    'Closes until you renew: the premium rooms, the advanced courses, the live breakdowns and their replays.',
    '',
    'Renew Premium ({{premium_price}} {{premium_period}}): {{appUrl}}#premium',
    '',
    'Already renewed? You can ignore this email.',
  ], false),
};

T.room_access = {
  name: 'Room access',
  subject: 'You are in: {{room}}',
  preheader: 'Your access to {{room}} is active until {{until}}.',
  marketing: 0,
  html: layout({
    title: 'You are in',
    kicker: 'Receipt',
    hero: 'receipt',
    body: [
      h1('You are in {{room}}'),
      p('Thanks, {{firstName}}. Your payment went through and the room is open to you now. Say hello when you get in.'),
      kv([['Room', '{{room}}'], ['Amount', '{{amount}}'], ['Reference', '{{ref}}'], ['Access until', '{{until}}']]),
      button('Open the room', '{{appUrl}}#community'),
      small('Keep this email as your receipt. Sold by Zedapex Limited through VooSquare.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'You are in {{room}}',
    '',
    'Thanks, {{firstName}}. Your payment went through and the room is open to you now. Say hello when you get in.',
    '',
    'Room: {{room}}',
    'Amount: {{amount}}',
    'Reference: {{ref}}',
    'Access until: {{until}}',
    '',
    'Open the room: {{appUrl}}#community',
    '',
    'Keep this email as your receipt. Sold by Zedapex Limited through VooSquare.',
  ], false),
};

T.order_review = {
  name: 'Payment under review',
  subject: 'We are checking your payment',
  preheader: 'We received your payment details for {{item}} and are confirming them now.',
  marketing: 0,
  html: layout({
    title: 'We are checking your payment',
    kicker: 'Payment',
    hero: 'review',
    body: [
      h1('We are checking your payment'),
      p('Hi {{firstName}}, we received your payment details for {{item}}. The team confirms each one by hand, usually within a few hours.'),
      kv([['Item', '{{item}}'], ['Amount', '{{amount}}'], ['Reference', '{{ref}}'], ['Status', '<span style="color:#7A5C00;">In review</span>']]),
      p('You get another email as soon as it is confirmed. There is nothing else to do.', { style: 'margin-top:18px;', mb: 0 }),
      button('Open VooSquare', '{{appUrl}}#premium'),
      small('Something looks wrong? Write to {{supportEmail}} with your reference.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Hi {{firstName}},',
    '',
    'We received your payment details for {{item}}. The team confirms each one by hand, usually within a few hours.',
    '',
    'Item: {{item}}',
    'Amount: {{amount}}',
    'Reference: {{ref}}',
    'Status: In review',
    '',
    'You get another email as soon as it is confirmed. There is nothing else to do.',
    '',
    'Open VooSquare: {{appUrl}}#premium',
    'Something looks wrong? Write to {{supportEmail}} with your reference.',
  ], false),
};

/* ---------- invite-only rooms: applications ---------- */
T.room_application_received = {
  name: 'Room application received',
  subject: 'We have your application: {{room}}',
  preheader: 'The team reads every application and replies within 48 hours.',
  marketing: 0,
  html: layout({
    title: 'Application received',
    kicker: 'Application',
    hero: 'apply_received',
    body: [
      h1('Thanks, {{firstName}}. We have it.'),
      p('Your application to {{room}} is with the team. We read every one ourselves and reply within 48 hours, by email and in VooSquare.'),
      kv([['Room', '{{room}}'], ['Price once approved', '{{price}} {{period}}'], ['To pay now', 'Nothing']]),
      button('View my application', '{{pay_url}}'),
      small('Want to change something? Withdraw it from the room page and apply again.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Thanks, {{firstName}}. We have it.',
    '',
    'Your application to {{room}} is with the team. We read every one ourselves and reply within 48 hours, by email and in VooSquare.',
    '',
    'Room: {{room}}',
    'Price once approved: {{price}} {{period}}',
    'To pay now: Nothing',
    '',
    'View my application: {{pay_url}}',
    '',
    'Want to change something? Withdraw it from the room page and apply again.',
  ], false),
};

T.room_application_approved = {
  name: 'Room application approved',
  subject: 'You are in: complete your {{room}} seat',
  preheader: 'Your seat is held until {{deadline}}. Pay {{price}} to join.',
  marketing: 0,
  html: layout({
    title: 'You are approved',
    kicker: 'Approved',
    hero: 'apply_approved',
    body: [
      h1('You are in, {{firstName}}'),
      p('The team approved your application to {{room}}. Your seat is held for you. Complete the payment to join the room.'),
      kv([['Room', '{{room}}'], ['Price', '{{price}} {{period}}'], ['Seat held until', '{{deadline}}']]),
      '{{{note_html}}}',
      button('Pay {{price}} and join', '{{pay_url}}'),
      small('If you do not pay by {{deadline}}, the seat goes to the next person and you can apply again later.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'You are in, {{firstName}}',
    '',
    'The team approved your application to {{room}}. Your seat is held for you. Complete the payment to join the room.',
    '',
    'Room: {{room}}',
    'Price: {{price}} {{period}}',
    'Seat held until: {{deadline}}',
    '',
    '{{note}}',
    '',
    'Pay {{price}} and join: {{pay_url}}',
    '',
    'If you do not pay by {{deadline}}, the seat goes to the next person and you can apply again later.',
  ], false),
};

T.room_application_waitlist = {
  name: 'Room application approved (waitlist)',
  subject: 'Approved for {{room}}: you are on the waitlist',
  preheader: 'The room is full right now. We will email you when a seat opens.',
  marketing: 0,
  html: layout({
    title: 'You are on the waitlist',
    kicker: 'Waitlist',
    hero: 'apply_waitlist',
    body: [
      h1('Approved, and next in line'),
      p('The team approved your application to {{room}}, {{firstName}}. Every seat is taken right now, so you are on the waitlist.'),
      p('When a seat opens, we email you and hold it for 7 days so you can pay and join. You do not need to apply again.'),
      '{{{note_html}}}',
      button('View my place', '{{pay_url}}'),
    ].join('\n'),
  }),
  text: txt([
    'Approved, and next in line',
    '',
    'The team approved your application to {{room}}, {{firstName}}. Every seat is taken right now, so you are on the waitlist.',
    '',
    'When a seat opens, we email you and hold it for 7 days so you can pay and join. You do not need to apply again.',
    '',
    '{{note}}',
    '',
    'View my place: {{pay_url}}',
  ], false),
};

T.room_application_rejected = {
  name: 'Room application not approved',
  subject: 'About your {{room}} application',
  preheader: 'Not this time. Here is what the team said.',
  marketing: 0,
  html: layout({
    title: 'About your application',
    kicker: 'Application',
    hero: 'apply_rejected',
    body: [
      h1('Not this time, {{firstName}}'),
      p('Thank you for applying to {{room}}. The room is small and built around one stage of the work, so the team says no more often than yes. It is not a judgement of you as a buyer.'),
      '{{{note_html}}}',
      p(`You can apply again from ${b('{{reapply}}')}. Until then, the free rooms, the Academy and Premium are open to you.`),
      button('Back to the community', '{{appUrl}}#community'),
      links([['Browse the Academy', '{{appUrl}}#academy'], ['See Premium', '{{appUrl}}#premium']]),
    ].join('\n'),
  }),
  text: txt([
    'Not this time, {{firstName}}',
    '',
    'Thank you for applying to {{room}}. The room is small and built around one stage of the work, so the team says no more often than yes. It is not a judgement of you as a buyer.',
    '',
    '{{note}}',
    '',
    'You can apply again from {{reapply}}. Until then, the free rooms, the Academy and Premium are open to you.',
    '',
    'Back to the community: {{appUrl}}#community',
    'Browse the Academy: {{appUrl}}#academy',
    'See Premium: {{appUrl}}#premium',
  ], false),
};

/* ---------- referral payouts (the Zedapex team pays from outside VooSquare and records it here) ---------- */
const amountPanel = (label, line) => panel(`<p style="margin:0 0 4px;${font(13, 18, 600, '#A9BDB3')}">${label}</p>
<p style="margin:0 0 6px;${font(36, 42, 800, '#FFFFFF', 'letter-spacing:-1.2px;')}">{{amount}}</p>
<p style="margin:0;${font(14, 21, 400, '#C9D6CF')}">${line}</p>`, { bg: C.ink, dark: true, pad: '22px 24px', mt: 4, mb: 14 });
const refCell = `<span style="font-family:${MONO};font-size:13px;word-break:break-all;">{{reference}}</span>`;

T.payout_requested = {
  name: 'Payout requested',
  subject: 'We have your payout request: {{amount}}',
  preheader: 'The Zedapex team checks it and sends it to the details you saved.',
  marketing: 0,
  html: layout({
    title: 'Payout requested',
    kicker: 'Referrals',
    hero: 'payout_requested',
    body: [
      h1('Your payout request is in'),
      p('Thanks, {{firstName}}. The Zedapex team checks every request, sends the money to the details below and marks it paid with the transaction reference. You get an email when it is sent.'),
      amountPanel('Requested', 'To {{method}}'),
      kv([['Request', '#{{payout_id}}'], ['Requested on', '{{requested}}'], ['Status', '<span style="color:#7A5C00;">Requested</span>']]),
      button('Open my referrals', '{{referrals_url}}'),
      small('Saved the wrong details? Cancel the request on your Referrals page while it says Requested, fix your details and ask again.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Your payout request is in',
    '',
    'Thanks, {{firstName}}. The Zedapex team checks every request, sends the money to the details below and marks it paid with the transaction reference. You get an email when it is sent.',
    '',
    'Amount: {{amount}}',
    'To: {{method}}',
    'Request: #{{payout_id}}',
    'Requested on: {{requested}}',
    'Status: Requested',
    '',
    'Open my referrals: {{referrals_url}}',
    '',
    'Saved the wrong details? Cancel the request on your Referrals page while it says Requested, fix your details and ask again.',
  ], false),
};

T.payout_paid = {
  name: 'Payout sent',
  subject: 'Your payout of {{amount}} is on its way',
  preheader: 'Sent to {{method}}. Reference inside.',
  marketing: 0,
  html: layout({
    title: 'Payout sent',
    kicker: 'Referrals',
    hero: 'payout_paid',
    body: [
      h1('Paid, {{firstName}}'),
      p('The Zedapex team sent your referral payout. Bank transfers and mobile money can take a little while to show. Crypto shows once the network confirms it.'),
      amountPanel('Sent', 'To {{method}} on {{date}}'),
      kv([['Request', '#{{payout_id}}'], ['Reference', refCell], ['Sent on', '{{date}}']]),
      '{{{note_html}}}',
      button('See my referrals', '{{referrals_url}}'),
      small('Not received after 3 working days? Reply with the reference and we will check it.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Paid, {{firstName}}',
    '',
    'The Zedapex team sent your referral payout. Bank transfers and mobile money can take a little while to show. Crypto shows once the network confirms it.',
    '',
    'Amount: {{amount}}',
    'To: {{method}}',
    'Reference: {{reference}}',
    'Sent on: {{date}}',
    '',
    '{{note}}',
    '',
    'See my referrals: {{referrals_url}}',
    '',
    'Not received after 3 working days? Reply with the reference and we will check it.',
  ], false),
};

T.payout_rejected = {
  name: 'Payout not sent',
  subject: 'About your payout request of {{amount}}',
  preheader: 'The amount is back in your available balance. Here is what the team said.',
  marketing: 0,
  html: layout({
    title: 'About your payout',
    kicker: 'Referrals',
    hero: 'payout_rejected',
    body: [
      h1('We could not send this payout'),
      p(`Hi {{firstName}}, the Zedapex team looked at your payout request of ${b('{{amount}}')} and did not send it. The amount is back in your available balance.`),
      '{{{note_html}}}',
      p('If your payout details were the problem, update them on your Referrals page and request again.', { style: 'margin-top:16px;' }),
      button('Open my referrals', '{{referrals_url}}'),
      small('Questions? Write to {{supportEmail}}.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'We could not send this payout',
    '',
    'Hi {{firstName}}, the Zedapex team looked at your payout request of {{amount}} and did not send it. The amount is back in your available balance.',
    '',
    'Why: {{note}}',
    '',
    'If your payout details were the problem, update them on your Referrals page and request again.',
    '',
    'Open my referrals: {{referrals_url}}',
  ], false),
};

T.admin_invite = {
  name: 'Team invite',
  subject: 'You have been added to the VooSquare team',
  preheader: '{{inviter}} added you as {{role}}. Sign in with this email to open the admin.',
  marketing: 0,
  html: layout({
    title: 'Welcome to the team',
    kicker: 'Team',
    hero: 'team',
    body: [
      h1('Welcome to the team'),
      p(`{{inviter}} added you to the VooSquare team as ${b('{{role}}')}.`),
      p('Sign in with this email address to open the admin. We send a one-time code each time, so there is no password to remember.'),
      button('Open the admin', '{{baseUrl}}/admin'),
      small('Not expecting this? Write to {{supportEmail}} and we will remove the access.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Welcome to the team',
    '',
    '{{inviter}} added you to the VooSquare team as {{role}}.',
    '',
    'Sign in with this email address to open the admin. We send a one-time code each time, so there is no password to remember.',
    '',
    'Open the admin: {{baseUrl}}/admin',
    '',
    'Not expecting this? Write to {{supportEmail}} and we will remove the access.',
  ], false),
};

/* ---------- marketing: broadcast ---------- */
T.announcement = {
  name: 'Broadcast',
  subject: '{{subject}}',
  preheader: '{{title}}',
  marketing: 1,
  html: layout({
    title: 'VooSquare',
    kicker: 'News',
    hero: 'broadcast',
    marketing: true,
    body: [
      h1('{{title}}'),
      `<div class="dm-body" style="${font(16, 26, 400, C.body)}">{{{body_html}}}</div>`,
      button('{{cta_text}}', '{{cta_url}}', { mt: 16, w: 240 }),
    ].join('\n'),
  }),
  text: txt(['{{title}}', '', '{{body}}', '', '{{cta_text}}: {{cta_url}}'], true),
};

/* ---------- marketing: welcome series ---------- */
T.welcome = {
  name: 'Welcome series 1: Welcome',
  subject: 'Welcome to the square, {{firstName}}',
  preheader: 'Why I built VooSquare, and the three things to do first.',
  marketing: 1,
  html: layout({
    title: 'Welcome to VooSquare',
    kicker: 'Welcome',
    hero: 'welcome',
    marketing: true,
    body: [
      h1('Welcome to the square, {{firstName}}'),
      p('I’m Dchessking. I run paid traffic at Zedapex across Nigeria, Kenya, South Africa, Ghana and Cameroon.'),
      p('Before media buying I taught economics and maths. When I made the switch, I paid for a lot of research, burnt money the wrong way and learned slowly what works. Most of those lessons cost more than they should have.'),
      p('VooSquare is what I wish I had back then. One Voo ID opens every Zedapex tool, a community of buyers running real campaigns, and an Academy that teaches the way we work at Zedapex. We call it traffic banking: every lead you buy is capital, so you price it, track it and make it grow.'),
      p('Your account is free for life. Premium is there when you want more.', { mb: 0 }),
      signature('Dchessking', 'Founder of Zedapex'),
      divider(30, 28),
      h2('Three things to do first'),
      steps([
        ['Finish your profile', `Pick your avatar and add your geos and verticals, so other buyers know who they are talking to. ${a('Edit your profile', '{{appUrl}}#profile')}`],
        ['Say hi in Introductions', `Tell the room what you run, where you run it and what you are testing. ${a('Open Introductions', '{{appUrl}}#community')}`],
        ['Start Traffic Banking 101', `My first lesson: how to price a lead before you bid. It takes six minutes. ${a('Start the lesson', '{{appUrl}}#course/traffic-banking-101')}`],
      ]),
      button('Open your dashboard', '{{appUrl}}', { mt: 32 }),
      small('Tomorrow: every tool your Voo ID opens, and what each one is for.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Welcome to the square, {{firstName}}',
    '',
    'I’m Dchessking. I run paid traffic at Zedapex across Nigeria, Kenya, South Africa, Ghana and Cameroon.',
    '',
    'Before media buying I taught economics and maths. When I made the switch, I paid for a lot of research, burnt money the wrong way and learned slowly what works. Most of those lessons cost more than they should have.',
    '',
    'VooSquare is what I wish I had back then. One Voo ID opens every Zedapex tool, a community of buyers running real campaigns, and an Academy that teaches the way we work at Zedapex. We call it traffic banking: every lead you buy is capital, so you price it, track it and make it grow.',
    '',
    'Your account is free for life. Premium is there when you want more.',
    '',
    'Dchessking, founder of Zedapex',
    '',
    'Three things to do first:',
    '',
    '1. Finish your profile. Pick your avatar and add your geos and verticals, so other buyers know who they are talking to. {{appUrl}}#profile',
    '2. Say hi in Introductions. Tell the room what you run, where you run it and what you are testing. {{appUrl}}#community',
    '3. Start Traffic Banking 101. My first lesson: how to price a lead before you bid. It takes six minutes. {{appUrl}}#course/traffic-banking-101',
    '',
    'Open your dashboard: {{appUrl}}',
    '',
    'Tomorrow: every tool your Voo ID opens, and what each one is for.',
  ], true),
};

T.seq_tools = {
  name: 'Welcome series 2: Tools',
  subject: 'One login, every tool',
  preheader: 'Your Voo ID opens every Zedapex tool, lined up the way a campaign makes money.',
  marketing: 1,
  html: layout({
    title: 'One login, every tool',
    kicker: 'The Voo system',
    hero: 'tools',
    marketing: true,
    body: [
      h1('One login. Every tool.'),
      p('Hi {{firstName}}. Most buyers juggle a tracker here, an ad tool there and a dozen passwords. Your Voo ID signs you in to every Zedapex tool.'),
      p('The tools follow the order a campaign makes money: see what already wins, find the offer, make the ad, track the lead, close it, keep it and collect.', { mb: 26 }),
      table(ORDER.map((k, i) => toolRow(k, i === ORDER.length - 1)).join('')),
      button('See your tools', '{{appUrl}}#apps', { mt: 32 }),
      small('Each tool handles its own billing. VooSquare never holds a balance for you.', { style: 'margin-top:14px;' }),
    ].join('\n'),
  }),
  text: txt([
    'One login. Every tool.',
    '',
    'Hi {{firstName}}. Most buyers juggle a tracker here, an ad tool there and a dozen passwords. Your Voo ID signs you in to every Zedapex tool.',
    '',
    'The tools follow the order a campaign makes money: see what already wins, find the offer, make the ad, track the lead, close it, keep it and collect.',
    '',
    ...ORDER.map((k) => { const t = P[k]; return `${t.name} (${t.stage})\n${t.line}\n${t.offer}${t.url ? `: ${t.url}` : ''}\n`; }),
    'See your tools: {{appUrl}}#apps',
    '',
    'Each tool handles its own billing. VooSquare never holds a balance for you.',
  ], true),
};

const priceCell = (top, sub, o = {}) => panel(`<p class="${o.dark ? '' : 'dm-ink'}" style="margin:0 0 4px;${font(20, 26, 800, o.color || C.ink, 'letter-spacing:-0.5px;')}">${top}</p><p class="${o.dark ? '' : 'dm-body'}" style="margin:0;${font(13, 19, 400, o.sub || C.body)}">${sub}</p>`, { bg: o.bg, dark: o.dark, border: o.border, mt: 0, mb: 0, pad: '16px 16px' });

T.seq_joinvoo = {
  name: 'Welcome series 3: Joinvoo',
  subject: 'Track every lead, drop every fake',
  preheader: 'Joinvoo sends every real Telegram join back to the ad platforms.',
  marketing: 1,
  html: layout({
    title: 'Track every lead, drop every fake',
    kicker: 'Joinvoo',
    hero: 'joinvoo',
    marketing: true,
    body: [
      h1('Track every lead. Drop every fake.'),
      p('Hi {{firstName}}. Here is the blind spot most Telegram funnels share.'),
      p('You run an ad. People tap through to your channel. At that door, the ad platform loses sight of them. It sees a click and never learns who joined, who signed up or who deposited. So it keeps buying clicks, and cheap clicks come with bots and people who were never going to stay.'),
      p('Joinvoo closes that gap. It stands at the door and tells the ad platform which people were real.', { mb: 26 }),
      h2('How it works'),
      steps([
        ['Connect your channel', 'Add Joinvoo to your Telegram channel or group and link your ad accounts.'],
        ['Every real join is tracked', 'Joinvoo records each real join, then the sign-ups and deposits that follow. Bots stay out of your numbers.'],
        ['Signals go back server-side', 'Joinvoo sends those events to Meta, TikTok and Snapchat, so the ad platform learns from real people.'],
      ], { numBg: P.joinvoo.button, numFg: '#FFFFFF' }),
      spacer(26),
      table(`<tr>
<td class="stack stack-gap" width="33%" valign="top" style="padding:0 5px 0 0;">${priceCell('Free', 'Your first 500 joins', { bg: P.joinvoo.bg, color: P.joinvoo.color, border: false })}</td>
<td class="stack stack-gap" width="34%" valign="top" style="padding:0 5px;">${priceCell('$30 a month', '2,000 tracked joins included')}</td>
<td class="stack" width="33%" valign="top" style="padding:0 0 0 5px;">${priceCell('Pro, $99', 'A month. Adds deposits, ROAS and cost per FTD')}</td>
</tr>`),
      button('Start free on Joinvoo', 'https://joinvoo.com', { bg: P.joinvoo.button, mt: 30 }),
      legal(),
    ].join('\n'),
  }),
  text: txt([
    'Track every lead. Drop every fake.',
    '',
    'Hi {{firstName}}. Here is the blind spot most Telegram funnels share.',
    '',
    'You run an ad. People tap through to your channel. At that door, the ad platform loses sight of them. It sees a click and never learns who joined, who signed up or who deposited. So it keeps buying clicks, and cheap clicks come with bots and people who were never going to stay.',
    '',
    'Joinvoo closes that gap. It stands at the door and tells the ad platform which people were real.',
    '',
    'How it works:',
    '1. Connect your channel. Add Joinvoo to your Telegram channel or group and link your ad accounts.',
    '2. Every real join is tracked. Joinvoo records each real join, then the sign-ups and deposits that follow. Bots stay out of your numbers.',
    '3. Signals go back server-side. Joinvoo sends those events to Meta, TikTok and Snapchat, so the ad platform learns from real people.',
    '',
    'Pricing:',
    '- Your first 500 joins are free.',
    '- $30 a month includes 2,000 tracked joins.',
    '- Pro is $99 a month and adds deposits, ROAS and cost per FTD.',
    '',
    'Start free on Joinvoo: https://joinvoo.com',
    '',
    LEGAL,
  ], true),
};

T.seq_vooads = {
  name: 'Welcome series 4: Vooads',
  subject: 'Fresh ads before your winners tire',
  preheader: 'Vooads turns one sentence into videos, images and hooks. Your first ads are free.',
  marketing: 1,
  html: layout({
    title: 'Fresh ads before your winners tire',
    kicker: 'Vooads',
    hero: 'vooads',
    marketing: true,
    body: [
      h1('Fresh ads before your winners tire'),
      p('Hi {{firstName}}. Every buyer knows the curve.'),
      p('A creative wins. You scale it. A couple of weeks later the same people have seen it too many times. CPM climbs, click-through slides and the ad that carried your week stops pulling. The fix is always the same: new hooks, new angles and new formats, tested fast. The hard part is making them fast enough.'),
      p('Vooads is built for that part.', { mb: 24 }),
      steps([
        ['Write one sentence', 'Describe the offer and the angle. Vooads makes videos, images and hooks for feed, stories and reels from it.'],
        ['Pick the language', 'Vooads writes and voices ads in Pidgin, Swahili and French, and works for every market you run.'],
        ['Check before you spend', 'Each ad is checked against Meta’s rules first, so you see problems before review does.'],
        ['Pay as you go', 'Buy credits when you need them. Your first ads are free.'],
      ], { numBg: P.vooads.button, numFg: '#FFFFFF' }),
      button('Make your first ads free', '{{appUrl}}#apps', { bg: P.vooads.button, mt: 32 }),
      small('Vooads helps you test more creatives. Results still depend on your offer, targeting and budget.', { size: 12, lh: 19, style: 'margin-top:16px;' }),
    ].join('\n'),
  }),
  text: txt([
    'Fresh ads before your winners tire',
    '',
    'Hi {{firstName}}. Every buyer knows the curve.',
    '',
    'A creative wins. You scale it. A couple of weeks later the same people have seen it too many times. CPM climbs, click-through slides and the ad that carried your week stops pulling. The fix is always the same: new hooks, new angles and new formats, tested fast. The hard part is making them fast enough.',
    '',
    'Vooads is built for that part.',
    '',
    '1. Write one sentence. Describe the offer and the angle. Vooads makes videos, images and hooks for feed, stories and reels from it.',
    '2. Pick the language. Vooads writes and voices ads in Pidgin, Swahili and French, and works for every market you run.',
    '3. Check before you spend. Each ad is checked against Meta’s rules first, so you see problems before review does.',
    '4. Pay as you go. Buy credits when you need them. Your first ads are free.',
    '',
    'Make your first ads free: {{appUrl}}#apps',
    '',
    'Vooads helps you test more creatives. Results still depend on your offer, targeting and budget.',
  ], true),
};

T.seq_reply_cast = {
  name: 'Welcome series 5: Replyvoo and Castvoo',
  subject: 'Keep every lead you paid for',
  preheader: 'Replyvoo answers in seconds. Castvoo brings every subscriber back.',
  marketing: 1,
  html: layout({
    title: 'Keep every lead you paid for',
    kicker: 'Replyvoo and Castvoo',
    hero: 'replycast',
    marketing: true,
    body: [
      h1('Keep every lead you paid for'),
      p('Hi {{firstName}}. You paid for that lead. They joined, sent a message at 2 a.m. asking how to start, and nobody answered until morning. By then they had moved on.'),
      p('It happens in every Telegram funnel that runs on people alone. Two Zedapex tools fix the two places it happens most.', { mb: 22 }),
      product('replyvoo', 'Answer every chat in seconds', [
        'AI Closers reply to every Telegram chat right away, day and night. They ask the questions your best closer would ask, qualify the lead and send the payment link when the lead is ready.',
        'A chat widget does the same on your website.',
      ], '30 free chats a month'),
      product('castvoo', 'Bring every subscriber back', [
        'Most people in your channel will not buy on day one. Castvoo sends broadcasts and drip sequences on schedule. It welcomes new joins, follows up with the quiet ones and sends each group the message written for them.',
      ], '7 days free'),
      button('Set up both in your dashboard', '{{appUrl}}#apps', { mt: 22 }),
    ].join('\n'),
  }),
  text: txt([
    'Keep every lead you paid for',
    '',
    'Hi {{firstName}}. You paid for that lead. They joined, sent a message at 2 a.m. asking how to start, and nobody answered until morning. By then they had moved on.',
    '',
    'It happens in every Telegram funnel that runs on people alone. Two Zedapex tools fix the two places it happens most.',
    '',
    'Replyvoo: answer every chat in seconds',
    'AI Closers reply to every Telegram chat right away, day and night. They ask the questions your best closer would ask, qualify the lead and send the payment link when the lead is ready. A chat widget does the same on your website.',
    '30 free chats a month.',
    '',
    'Castvoo: bring every subscriber back',
    'Most people in your channel will not buy on day one. Castvoo sends broadcasts and drip sequences on schedule. It welcomes new joins, follows up with the quiet ones and sends each group the message written for them.',
    '7 days free.',
    '',
    'Set up both in your dashboard: {{appUrl}}#apps',
  ], true),
};

T.seq_academy = {
  name: 'Welcome series 6: Academy',
  subject: 'Start with Traffic Banking 101',
  preheader: 'Six minutes on pricing a lead before you bid. Free with your account.',
  marketing: 1,
  html: layout({
    title: 'Start with Traffic Banking 101',
    kicker: 'Academy',
    hero: 'academy',
    marketing: true,
    body: [
      h1('Learn the way we buy traffic'),
      p('Hi {{firstName}}. The Academy teaches what we use at Zedapex every day. Each lesson is short: one idea, a visual that explains it, the takeaways and one action to do before the next lesson. You earn XP as you go.'),
      panel([
        `<p style="margin:0 0 6px;${font(13, 18, 700, C.deep)}">Foundations, beginner, free</p>`,
        `<p class="dm-ink" style="margin:0 0 8px;${font(20, 26, 800, C.ink, 'letter-spacing:-0.5px;')}">Traffic Banking 101</p>`,
        `<p class="dm-body" style="margin:0 0 12px;${font(15, 23, 400, C.body)}">Dchessking’s starting point. Every naira, shilling or rand you spend should buy something you can measure and grow. Lesson one shows you how to price a lead from your payout and FTD rate, so you know your max bid before you spend.</p>`,
        `<p style="margin:0;${font(14, 20, 700, C.deep)}">${a('Start lesson one', '{{appUrl}}#course/traffic-banking-101')}</p>`,
      ].join(''), { mt: 8, mb: 26, pad: '22px 24px' }),
      h2('Free and Premium'),
      table(`<tr>
<td class="stack stack-gap" width="50%" valign="top" style="padding:0 6px 0 0;">${panel(`<p class="dm-ink" style="margin:0 0 10px;${font(15, 22, 800, C.ink)}">Free for life</p>${ticks(['Traffic Banking 101', 'Every free course across the tracks', 'XP and progress saved'])}`, { mt: 0, mb: 0 })}</td>
<td class="stack" width="50%" valign="top" style="padding:0 0 0 6px;">${panel(`<p style="margin:0 0 10px;${font(15, 22, 800, '#FFFFFF')}">Premium, {{premium_price}} {{premium_period}}</p>${ticks(['Every course, including advanced tracks', 'Monthly live breakdown with Dchessking, plus replays', 'Templates and playbooks'], { color: C.lime, text: '#D3DED8', textCls: ' ' })}`, { bg: C.ink, dark: true, mt: 0, mb: 0 })}</td>
</tr>`),
      small('New courses land as the team records them, across foundations, tracking, creatives, Telegram funnels and scaling.', { size: 14, lh: 22, style: 'margin-top:18px;' }),
      button('Start Traffic Banking 101', '{{appUrl}}#course/traffic-banking-101', { mt: 26 }),
    ].join('\n'),
  }),
  text: txt([
    'Learn the way we buy traffic',
    '',
    'Hi {{firstName}}. The Academy teaches what we use at Zedapex every day. Each lesson is short: one idea, a visual that explains it, the takeaways and one action to do before the next lesson. You earn XP as you go.',
    '',
    'Traffic Banking 101 (foundations, beginner, free)',
    'Dchessking’s starting point. Every naira, shilling or rand you spend should buy something you can measure and grow. Lesson one shows you how to price a lead from your payout and FTD rate, so you know your max bid before you spend.',
    '',
    'Free for life:',
    '- Traffic Banking 101',
    '- Every free course across the tracks',
    '- XP and progress saved',
    '',
    'Premium, {{premium_price}} {{premium_period}}:',
    '- Every course, including advanced tracks',
    '- Monthly live breakdown with Dchessking, plus replays',
    '- Templates and playbooks',
    '',
    'New courses land as the team records them, across foundations, tracking, creatives, Telegram funnels and scaling.',
    '',
    'Start Traffic Banking 101: {{appUrl}}#course/traffic-banking-101',
  ], true),
};

const FREE_ROOMS = ['Introductions', 'General', 'Tracking &amp; signals', 'Creatives &amp; hooks', 'Telegram funnels', 'African geos', 'Tool help'];
const PREMIUM_ROOMS = ['Buyers’ Lounge', 'Scaling Desk', 'Offer Drops', 'Creative Reviews'];
const chips = (list, o = {}) => `<p style="margin:0 0 ${o.mb ?? 0}px;line-height:36px;">${list.map((x) => `<span class="${o.dark ? '' : 'dm-panel dm-ink'}" style="display:inline-block;margin:0 6px 8px 0;padding:6px 13px;border-radius:999px;background:${o.bg || C.panel};border:1px solid ${o.border || C.panelLine};${font(14, 20, 700, o.color || C.ink)}white-space:nowrap;">${x}</span>`).join('')}</p>`;

T.seq_community = {
  name: 'Welcome series 7: Community',
  subject: 'Buyers who share what works',
  preheader: 'Free rooms for hooks, tracking, Telegram funnels and African geos.',
  marketing: 1,
  html: layout({
    title: 'Buyers who share what works',
    kicker: 'Community',
    hero: 'community',
    marketing: true,
    body: [
      h1('Talk shop with buyers who run real campaigns'),
      p('Hi {{firstName}}. Media buying gets lonely when every test is yours alone. The community is where buyers compare notes: which hook won this week, what broke after an update, which geo is getting expensive and what to try instead.'),
      p('Pick a room, read for a day, then jump in.', { mb: 22 }),
      h2('Free rooms', { mb: 10 }),
      chips(FREE_ROOMS, { mb: 12 }),
      h2('Premium rooms', { mb: 10 }),
      chips(PREMIUM_ROOMS, { bg: C.ink, border: C.ink, color: '#FFFFFF', dark: true, mb: 12 }),
      panel(p(`${b('The rules fit in one line:')} be useful, be honest, no spam, and keep every offer legal where you run it.`, { size: 15, lh: 23, mb: 0 }), { mt: 4, mb: 0 }),
      button('Say hi in Introductions', '{{appUrl}}#community', { mt: 28 }),
      small(`Know a buyer who should be here? Send them your invite link: ${a('{{refLink}}', '{{refLink}}')}`, { size: 14, lh: 22, style: 'margin-top:16px;word-break:break-all;' }),
    ].join('\n'),
  }),
  text: txt([
    'Talk shop with buyers who run real campaigns',
    '',
    'Hi {{firstName}}. Media buying gets lonely when every test is yours alone. The community is where buyers compare notes: which hook won this week, what broke after an update, which geo is getting expensive and what to try instead.',
    '',
    'Pick a room, read for a day, then jump in.',
    '',
    'Free rooms: Introductions, General, Tracking & signals, Creatives & hooks, Telegram funnels, African geos, Tool help',
    'Premium rooms: Buyers’ Lounge, Scaling Desk, Offer Drops, Creative Reviews',
    '',
    'The rules fit in one line: be useful, be honest, no spam, and keep every offer legal where you run it.',
    '',
    'Say hi in Introductions: {{appUrl}}#community',
    '',
    'Know a buyer who should be here? Send them your invite link: {{refLink}}',
  ], true),
};

T.seq_affleego_gatevoo = {
  name: 'Welcome series 8: Affleego and Gatevoo',
  subject: 'Find the deal, then get paid',
  preheader: 'Affleego for offers. Gatevoo for crypto checkout. Both ends of the money loop.',
  marketing: 1,
  html: layout({
    title: 'Find the deal, then get paid',
    kicker: 'Affleego and Gatevoo',
    hero: 'affgate',
    marketing: true,
    body: [
      h1('Find the deal. Get paid.'),
      p('Hi {{firstName}}. Every campaign starts and ends with money. At the start you need an offer worth buying traffic for. At the end you need a way to collect that keeps your margin. Two Zedapex tools cover both ends.', { mb: 22 }),
      product('affleego', 'Find the deal', [
        'Premium CPA and RevShare deals in finance, sports and casino, picked by a team that buys traffic for these verticals every day. Compare payouts and models, then pick the offer that fits your geo and your traffic.',
      ], a('affleego.com', 'https://affleego.com', P.affleego.color)),
      product('gatevoo', 'Get paid', [
        'The checkout behind the Voo family. Your customers pay in USDT or Bitcoin and the money goes straight to your wallet.',
        'Gatevoo is coming soon. Join the waitlist to hear first.',
      ], a('Join the waitlist at gatevoo.com', 'https://gatevoo.com', '#111111')),
      button('Browse deals on Affleego', 'https://affleego.com', { bg: '#111111', mt: 22 }),
      legal(),
    ].join('\n'),
  }),
  text: txt([
    'Find the deal. Get paid.',
    '',
    'Hi {{firstName}}. Every campaign starts and ends with money. At the start you need an offer worth buying traffic for. At the end you need a way to collect that keeps your margin. Two Zedapex tools cover both ends.',
    '',
    'Affleego: find the deal',
    'Premium CPA and RevShare deals in finance, sports and casino, picked by a team that buys traffic for these verticals every day. Compare payouts and models, then pick the offer that fits your geo and your traffic.',
    'https://affleego.com',
    '',
    'Gatevoo: get paid',
    'The checkout behind the Voo family. Your customers pay in USDT or Bitcoin and the money goes straight to your wallet. Gatevoo is coming soon. Join the waitlist to hear first: https://gatevoo.com',
    '',
    'Browse deals on Affleego: https://affleego.com',
    '',
    LEGAL,
  ], true),
};

T.seq_premium = {
  name: 'Welcome series 9: Premium',
  subject: 'What {{premium_price}} {{premium_period}} gets you',
  preheader: 'Premium rooms, every course and a monthly live breakdown with Dchessking.',
  marketing: 1,
  html: layout({
    title: 'What Premium gets you',
    kicker: 'Premium',
    hero: 'premium',
    marketing: true,
    body: [
      h1('Go deeper with Premium'),
      p('Hi {{firstName}}. Everything you have used so far stays free for life: your Voo ID, every tool, the free rooms and the free courses. Premium is for buyers who want more of the room and more of the playbook.', { mb: 22 }),
      panel([
        `<p class="dm-ink" style="margin:0 0 14px;${font(32, 38, 800, C.ink, 'letter-spacing:-1px;')}">{{premium_price}}<span class="dm-muted" style="${font(15, 20, 600, C.muted, 'letter-spacing:0;')}">&nbsp;{{premium_period}}</span></p>`,
        ticks([
          `${b('Premium rooms:')} Buyers’ Lounge, Scaling Desk, Offer Drops and Creative Reviews`,
          `${b('Every Academy course,')} including the advanced tracks`,
          `${b('A monthly live campaign breakdown')} with Dchessking, plus replays`,
          `${b('Templates and playbooks')} you can use the same day`,
          `${b('Priority support,')} the Premium badge and early access to new tools`,
        ]),
      ].join(''), { mt: 0, mb: 14, pad: '24px 24px' }),
      panel([
        `<p style="margin:0 0 6px;${font(13, 18, 700, C.lime)}">Invite only, by application</p>`,
        `<p style="margin:0 0 8px;${font(19, 25, 800, '#FFFFFF', 'letter-spacing:-0.4px;')}">{{inner_circle_name}}</p>`,
        `<p style="margin:0;${font(15, 23, 400, '#C9D6CF')}">{{inner_circle_size}} for operators already spending seriously on paid traffic. Dchessking reviews your numbers in the room, with a monthly group call. By application, then {{inner_circle_price}} {{inner_circle_period}}.</p>`,
      ].join(''), { bg: C.ink, dark: true, mt: 0, mb: 0, pad: '22px 24px' }),
      p('No pressure. If free is enough for now, it stays free.', { style: 'margin-top:22px;', mb: 0 }),
      button('See Premium', '{{appUrl}}#premium', { mt: 24 }),
    ].join('\n'),
  }),
  text: txt([
    'Go deeper with Premium',
    '',
    'Hi {{firstName}}. Everything you have used so far stays free for life: your Voo ID, every tool, the free rooms and the free courses. Premium is for buyers who want more of the room and more of the playbook.',
    '',
    'Premium, {{premium_price}} {{premium_period}}:',
    '- Premium rooms: Buyers’ Lounge, Scaling Desk, Offer Drops and Creative Reviews',
    '- Every Academy course, including the advanced tracks',
    '- A monthly live campaign breakdown with Dchessking, plus replays',
    '- Templates and playbooks you can use the same day',
    '- Priority support, the Premium badge and early access to new tools',
    '',
    '{{inner_circle_name}} (invite only, by application)',
    '{{inner_circle_size}} for operators already spending seriously on paid traffic. Dchessking reviews your numbers in the room, with a monthly group call. By application, then {{inner_circle_price}} {{inner_circle_period}}.',
    '',
    'No pressure. If free is enough for now, it stays free.',
    '',
    'See Premium: {{appUrl}}#premium',
  ], true),
};

T.seq_spyvoo = {
  name: 'Welcome series 10: Spyvoo',
  subject: 'See what’s winning before you spend',
  preheader: 'Spyvoo shows the live ads that have run for months, and why they work.',
  marketing: 1,
  html: layout({
    title: 'See what’s winning before you spend',
    kicker: 'Spyvoo',
    hero: 'spyvoo',
    marketing: true,
    body: [
      h1('See what’s winning before you spend'),
      p('Hi {{firstName}}. Most new angles start as a guess. You write a hook, launch it and let the first part of your test budget tell you it was wrong.'),
      p('Somewhere in your market, another advertiser has already paid for that lesson. Their ad has run for months, which usually means it pays for itself. Spyvoo puts those ads in front of you.', { mb: 24 }),
      steps([
        ['Search live ads', 'Look through live Facebook and Instagram ads from every country, all in one place.'],
        ['Spot the long runners', 'See how long each ad has been running, so the ones that keep paying stand out.'],
        ['Read the hook', 'An AI breakdown explains each hook: what it opens with, who it speaks to and why it holds attention.'],
        ['Launch your own angle', 'Save the winners to a board, then write your own version before you spend on a guess.'],
      ], { numBg: P.spyvoo.button, numFg: '#FFFFFF' }),
      p('TikTok support is coming soon.', { size: 14, lh: 22, color: C.muted, mb: 0, style: 'margin-top:20px;' }),
      button('Start free on Spyvoo', 'https://spyvoo.com', { bg: P.spyvoo.button, mt: 26 }),
      small('Use what you learn to write your own ads. Copying another advertiser’s creative word for word can break the ad platform’s rules and the law.', { size: 12, lh: 19, style: 'margin-top:16px;' }),
    ].join('\n'),
  }),
  text: txt([
    'See what’s winning before you spend',
    '',
    'Hi {{firstName}}. Most new angles start as a guess. You write a hook, launch it and let the first part of your test budget tell you it was wrong.',
    '',
    'Somewhere in your market, another advertiser has already paid for that lesson. Their ad has run for months, which usually means it pays for itself. Spyvoo puts those ads in front of you.',
    '',
    '1. Search live ads. Look through live Facebook and Instagram ads from every country, all in one place.',
    '2. Spot the long runners. See how long each ad has been running, so the ones that keep paying stand out.',
    '3. Read the hook. An AI breakdown explains each hook: what it opens with, who it speaks to and why it holds attention.',
    '4. Launch your own angle. Save the winners to a board, then write your own version before you spend on a guess.',
    '',
    'TikTok support is coming soon.',
    '',
    'Start free on Spyvoo: https://spyvoo.com',
    '',
    'Use what you learn to write your own ads. Copying another advertiser’s creative word for word can break the ad platform’s rules and the law.',
  ], true),
};

/* ---------- VooSquare Academy ----------
 * {{finish_note}} says how the school was finished: "You passed the final exam of <school>. ..." or, for a school with no
 * final exam (made in the admin), "You finished every module of <school>. ..." (src/school.js issueCertificate). */
T.certificate_issued = {
  name: 'VooSquare Academy certificate',
  subject: 'Your certificate: {{cert_title}}',
  preheader: 'You finished {{school_title}} at VooSquare Academy. Download your certificate and share the link.',
  marketing: 0,
  html: layout({
    title: 'Your VooSquare Academy certificate',
    kicker: 'VooSquare Academy',
    hero: 'academy',
    body: [
      h1('You earned it, {{firstName}}'),
      p('{{finish_note}}'),
      panel([
        `<p style="margin:0 0 6px;${font(13, 18, 600, '#A9BDB3')}">{{cert_title}}</p>`,
        `<p style="margin:0 0 6px;font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:34px;line-height:40px;color:#FFFFFF;">{{cert_name}}</p>`,
        `<p style="margin:0;${font(14, 21, 400, '#C9D6CF')}">Issued {{issued_on}}</p>`,
      ].join(''), { bg: C.ink, dark: true, pad: '24px 26px', mt: 6, mb: 14 }),
      kv([['Certificate code', `<span style="font-family:${MONO};font-size:14px;">{{cert_code}}</span>`], ['Anyone can check it at', `<a class="dm-link" href="{{verify_url}}" target="_blank" style="color:${C.deep};font-weight:700;text-decoration:none;word-break:break-all;">{{verify_url}}</a>`]]),
      p('Download it as a PDF or a picture from your certificate page. You can change the name printed on it once, so check the spelling before you share it.', { style: 'margin-top:18px;' }),
      button('Open my certificate', '{{cert_url}}'),
      links([['Continue in the Academy', '{{appUrl}}#academy']]),
    ].join('\n'),
  }),
  text: txt([
    'You earned it, {{firstName}}',
    '',
    '{{finish_note}}',
    '',
    '{{cert_title}}',
    'Awarded to: {{cert_name}}',
    'Issued: {{issued_on}}',
    'Certificate code: {{cert_code}}',
    'Anyone can check it at: {{verify_url}}',
    '',
    'Download it as a PDF or a picture from your certificate page. You can change the name printed on it once, so check the spelling before you share it.',
    '',
    'Open my certificate: {{cert_url}}',
  ], false),
};

/* ---------- affiliate program (src/aff; links go to the affiliate dashboard) ---------- */
const affEmail = (key, o) => {
  T[key] = {
    name: o.name, subject: o.subject, preheader: o.preheader, marketing: 0,
    html: layout({ title: o.name, kicker: 'Affiliates', hero: o.hero || null, body: [h1(o.h1), ...o.body, o.amount ? amountPanel(o.amount[0], o.amount[1]) : '', o.kv ? kv(o.kv) : '', button(o.cta || 'Open my dashboard', o.url || '{{affiliates_url}}'), o.foot ? small(o.foot, { style: 'margin-top:14px;' }) : ''].filter(Boolean).join('\n') }),
    text: txt([o.h1, '', ...o.text, '', `${o.cta || 'Open my dashboard'}: ${o.url || '{{affiliates_url}}'}`, ...(o.foot ? ['', o.foot] : [])], false),
  };
};
// Custom RevShare deal (owner only; sent to that affiliate only): started, ending in 7 days, ended or changed.
affEmail('aff_custom_deal', {
  name: 'Affiliate custom deal', subject: '{{title}}', preheader: '{{body}}', hero: null,
  h1: '{{title}}', body: [p('{{body}}')],
  text: ['{{body}}'], cta: 'Open my offers', url: '{{affiliates_url}}#/aff/offers',
});
affEmail('aff_application_received', {
  name: 'Affiliate application received', subject: 'We have your affiliate application', preheader: 'You can use the dashboard while we review it. Most reviews take about 2 business days.', hero: 'apply_received',
  h1: 'Application received', body: [p('Thanks, {{firstName}}. You can create links, set up postbacks and browse creatives now. Earnings start from the day you are approved. Most reviews take about 2 business days.')],
  text: ['Thanks, {{firstName}}. You can create links, set up postbacks and browse creatives now. Earnings start from the day you are approved. Most reviews take about 2 business days.'],
});
affEmail('aff_application_approved', {
  name: 'Affiliate approved', subject: 'You are approved for VooSquare Affiliates', preheader: 'You earn {{rate}} lifetime RevShare from today.', hero: 'apply_approved',
  h1: 'You are approved, {{firstName}}', body: [p('Your account earns from today at Starter, {{rate}} lifetime RevShare. Your manager is {{manager}}.'), ticks(['Create your first link', 'Connect Telegram alerts', 'Add a payout address', 'Take the 10-minute "Start here" lesson'])],
  text: ['Your account earns from today at Starter, {{rate}} lifetime RevShare. Your manager is {{manager}}.', '', '1. Create your first link', '2. Connect Telegram alerts', '3. Add a payout address', '4. Take the 10-minute "Start here" lesson'],
  cta: 'Create a link', foot: 'Commissions are never guaranteed. What you earn depends on your traffic and the customers who stay.',
});
affEmail('aff_application_rejected', {
  name: 'Affiliate application declined', subject: 'About your VooSquare Affiliates application', preheader: 'You can apply again after {{reapply}}.', hero: 'apply_rejected',
  h1: 'We could not approve your application', body: [p('Reason: {{reasons}}.'), p('You can apply again after {{reapply}}. Your Voo ID and the tools you use are not affected.')],
  text: ['Reason: {{reasons}}.', '', 'You can apply again after {{reapply}}. Your Voo ID and the tools you use are not affected.'],
});
affEmail('aff_info_requested', {
  name: 'Affiliate application: more information', subject: 'We need a bit more from you', preheader: '{{manager}} has a question about your application.', hero: 'review',
  h1: 'We need a bit more from you', body: [p('{{manager}} is reviewing your application and asked:'), panel(p('{{request}}', { mb: 0 }))],
  text: ['{{manager}} is reviewing your application and asked:', '', '{{request}}'], cta: 'Reply in the dashboard',
});
affEmail('aff_cpa_approved', {
  name: 'CPA approved', subject: 'CPA approved: {{amount}} on {{product}}', preheader: 'Customer {{customer_ref}}. {{when}}', hero: 'receipt',
  h1: 'CPA approved', body: [p('Our team approved this conversion. {{when}} Request a payout from your dashboard once your available balance reaches the minimum.')],
  amount: ['CPA', '{{product}} · {{customer_ref}}'], kv: [['Customer', '{{customer_ref}}'], ['Status', '{{when}}']],
  text: ['Our team approved this conversion. {{when}} Request a payout from your dashboard once your available balance reaches the minimum.', '', 'Product: {{product}}', 'Amount: {{amount}}', 'Customer: {{customer_ref}}', 'Status: {{when}}'],
  url: '{{affiliates_url}}#/aff/payouts', cta: 'Open payouts',
});
affEmail('aff_cpa_declined', {
  name: 'CPA declined', subject: 'CPA declined on {{product}}', preheader: 'Reason: {{reason}}', hero: 'review',
  h1: 'CPA declined', body: [p('Customer {{customer_ref}} on {{product}}.'), panel(p(b('Reason') + '<br>{{reason}}', { mb: 0 })), p('{{note}}')],
  text: ['Customer {{customer_ref}} on {{product}}.', '', 'Reason: {{reason}}', '', '{{note}}'], cta: 'Ask your manager about this', url: '{{affiliates_url}}#/aff/manager',
});
affEmail('aff_payout_requested', {
  name: 'Affiliate payout requested', subject: 'We have your payout request: {{amount}}', preheader: 'We send it within {{days}} business days.', hero: 'payout_requested',
  h1: 'Your payout request is in', body: [p('Thanks, {{firstName}}. We send it within {{days}} business days and email you the transaction hash.')], amount: ['Requested', 'To {{method}}'],
  kv: [['Request', '#{{payout_id}}'], ['Status', '<span style="color:#7A5C00;">Requested</span>']],
  text: ['Thanks, {{firstName}}. We send it within {{days}} business days and email you the transaction hash.', '', 'Amount: {{amount}}', 'To: {{method}}', 'Request: #{{payout_id}}'],
  foot: 'You can cancel while it says Requested. Your payout address is locked while a request is open.', url: '{{affiliates_url}}#/aff/payouts', cta: 'Open payouts',
});
affEmail('aff_payout_paid', {
  name: 'Affiliate payout sent', subject: 'Your payout of {{amount}} is on its way', preheader: 'Sent to {{method}}. Receipt {{receipt_no}}.', hero: 'payout_paid',
  h1: 'Paid, {{firstName}}', body: [p('Your affiliate payout was sent. Crypto shows once the network confirms it.')], amount: ['Sent', 'To {{method}} on {{date}}'],
  kv: [['Receipt', '{{receipt_no}}'], ['Transaction hash', refCell], ['Request', '#{{payout_id}}']],
  text: ['Your affiliate payout was sent. Crypto shows once the network confirms it.', '', 'Amount: {{amount}}', 'To: {{method}}', 'Transaction hash: {{reference}}', 'Receipt: {{receipt_no}}'],
  cta: 'Download the receipt (PDF)', url: '{{receipt_url}}', foot: 'Not received after 3 business days? Reply with the transaction hash and we will check it.',
});
affEmail('aff_payout_rejected', {
  name: 'Affiliate payout not sent', subject: 'About your payout request of {{amount}}', preheader: 'The amount is back in your available balance.', hero: 'payout_rejected',
  h1: 'We could not send this payout', body: [p(`Hi {{firstName}}, your payout request of ${b('{{amount}}')} was not sent. The amount is back in your available balance.`), panel(p(b('Why') + '<br>{{reason}}', { mb: 0 }))],
  text: ['Hi {{firstName}}, your payout request of {{amount}} was not sent. The amount is back in your available balance.', '', 'Why: {{reason}}'], url: '{{affiliates_url}}#/aff/payouts', cta: 'Open payouts',
});
affEmail('aff_health_warning', {
  name: 'Lifetime RevShare health warning', subject: 'Your lifetime RevShare needs attention', preheader: '{{count}} of {{threshold}} qualified customers in the last {{window}} days.', hero: 'expiring',
  h1: 'Your lifetime RevShare is {{state}}', body: [p('You have {{count}} of {{threshold}} new qualified customers in the last {{window}} days. You keep earning meanwhile. Get back to {{threshold}} within {{days}} days to keep RevShare on your existing customers active.')],
  text: ['You have {{count}} of {{threshold}} new qualified customers in the last {{window}} days. You keep earning meanwhile. Get back to {{threshold}} within {{days}} days to keep RevShare on your existing customers active.'],
  foot: 'Your manager can help you plan the volume.',
});
affEmail('aff_health_paused', {
  name: 'Lifetime RevShare paused', subject: 'Lifetime RevShare on your existing customers is paused', preheader: 'It restarts when you are back at {{threshold}} qualified customers in {{window}} days.', hero: 'expiring',
  h1: 'Lifetime RevShare is paused', body: [p('You had {{count}} of {{threshold}} new qualified customers in the last {{window}} days after the grace period. RevShare on existing customers stops accruing until you are back at {{threshold}}. There is no back pay for the paused time. New-customer CPA deals are not affected.')],
  text: ['You had {{count}} of {{threshold}} new qualified customers in the last {{window}} days after the grace period. RevShare on existing customers stops accruing until you are back at {{threshold}}. There is no back pay for the paused time. New-customer CPA deals are not affected.'],
});
affEmail('aff_tier_up', {
  name: 'Affiliate tier up', subject: 'You moved to {{tier}}', preheader: 'Your RevShare is now {{rate}} on new payments.', hero: 'premium',
  h1: 'You moved to {{tier}}', body: [p('Your RevShare is now {{rate}} on new payments, limited by each product cap. Rates are not applied backwards.')],
  text: ['Your RevShare is now {{rate}} on new payments, limited by each product cap. Rates are not applied backwards.'],
});
affEmail('aff_contest_won', {
  name: 'Contest prize', subject: '{{contest}}: you placed #{{rank}}', preheader: '{{amount}} added to your balance.', hero: 'payout_paid',
  h1: 'You placed #{{rank}} in {{contest}}', body: [p('Results are final. Your prize ({{prize}}) is added to your balance as earnings and is paid under the normal payout rules.')], amount: ['Prize', '{{prize}}'],
  text: ['Results are final. Your prize ({{prize}}, {{amount}}) is added to your balance as earnings and is paid under the normal payout rules.'], url: '{{affiliates_url}}#/aff/contests', cta: 'See the results',
});

/* ------------------------------------------------------------------ write */
const SEQUENCE = [
  { key: 'welcome', delayHours: 0 },
  { key: 'seq_tools', delayHours: 24 },
  { key: 'seq_joinvoo', delayHours: 48 },
  { key: 'seq_vooads', delayHours: 72 },
  { key: 'seq_reply_cast', delayHours: 96 },
  { key: 'seq_academy', delayHours: 120 },
  { key: 'seq_community', delayHours: 144 },
  { key: 'seq_affleego_gatevoo', delayHours: 168 },
  { key: 'seq_premium', delayHours: 192 },
  { key: 'seq_spyvoo', delayHours: 216 },
];

if (require.main === module) {
  const dir = __dirname;
  fs.writeFileSync(path.join(dir, 'templates.json'), JSON.stringify(T, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'sequence.json'), JSON.stringify(SEQUENCE, null, 2) + '\n');
  console.log(`Wrote ${Object.keys(T).length} templates and ${SEQUENCE.length} sequence steps.`);
}
module.exports = { templates: T, sequence: SEQUENCE };
