'use strict';
const fs = require('node:fs');
const path = require('node:path');
const D = require('./db');
const mailer = require('./mailer');
const { now, rid, slugify } = require('./util');
const TOOLS_DEFAULT = require('./tools').DEFAULT;

const DEFAULT_SETTINGS = {
  brand: { company: 'Zedapex', support_email: 'support@voosquare.com', founder: 'Dchessking', telegram: '', x: '', instagram: '' },
  /* App store links. Badges are the official images the owner uploads in Site content; until then neutral buttons show. */
  apps: { play_url: '', play_badge_upload: '', app_store_url: '', app_store_badge_upload: '', app_store_status: 'soon' },
  top_card: {
    enabled: true, eyebrow: 'New in the Academy', title: 'Traffic Banking 101 by Dchessking',
    body: 'Five animated lessons on pricing leads, reading real signals and scaling without burning money. Free with your account.',
    cta_text: 'Watch lesson 1 free', cta_url: '/app#academy', theme: 'dark',
  },
  announcements: [
    { id: 'a1', enabled: true, text: 'Traffic Banking 101 by Dchessking is live in the Academy.', link_text: 'Watch free', url: '/app#academy' },
    { id: 'a2', enabled: true, text: 'The VooSquare community is open. Free rooms for every buyer.', link_text: 'Join the chat', url: '/app#community' },
    { id: 'a3', enabled: true, text: 'Gatevoo is coming: get paid in USDT and Bitcoin, straight to your wallet.', link_text: 'Join the waitlist', url: 'https://gatevoo.com' },
  ],
  /* Spotlight slider. Scene numbers are labelled "Example" on screen. */
  ads: {
    interval: 6,
    slides: [
      { id: 'sl-join', enabled: true, placements: ['dashboard', 'academy', 'community', 'website'], theme: 'join', product: 'joinvoo', icon: 'join', brand: 'Joinvoo', kicker: 'Sponsored by Zedapex',
        title: 'Pay for people, not clicks.', body: 'Joinvoo sends every real Telegram join and deposit back to Meta, TikTok and Snapchat, so your ads find more people like them. First 500 joins free.',
        cta_text: 'Track my first 500 joins', cta_url: 'https://joinvoo.com', scene: 'stat', stat_label: 'Real joins today', stat_value: '+412', example: true, chips: ['Ada joined from Ad set 3', 'Deposit $120 sent to Meta', 'Bot click filtered out'], image: '', starts: 0, ends: 0 },
      { id: 'sl-spy', enabled: true, placements: ['dashboard', 'academy', 'community', 'website'], theme: 'spy', product: 'spyvoo', icon: 'spyvoo', brand: 'Spyvoo', kicker: 'New from Zedapex',
        title: 'Spy the winners. Scale your own.', body: 'Search live Facebook and Instagram ads from every country. See which ones have run for months, read the AI breakdown of each hook, then launch your own angle.',
        cta_text: 'Start free', cta_url: 'https://spyvoo.com', scene: 'feed', stat_label: 'Running', stat_value: '94 days', example: true, chips: ['Hook: a question in the first second', 'Saved to board', 'Still running today'], image: '', starts: 0, ends: 0 },
      { id: 'sl-vooads', enabled: true, placements: ['dashboard', 'academy', 'website'], theme: 'adv', product: 'vooads', icon: 'vooads', brand: 'Vooads', kicker: 'Sponsored by Zedapex',
        title: 'New ads before the old one dies.', body: 'Type one sentence. Get videos, images and hooks in every size, written and voiced in Pidgin, Swahili and French. First ads free.',
        cta_text: 'Make my first ads', cta_url: '/app#apps', scene: 'creative', stat_label: 'Ads made', stat_value: '12', example: true, chips: ['Wait, this works in Pidgin?', 'Watch before you scroll', 'Nairobi, you need this'], image: '', starts: 0, ends: 0 },
      { id: 'sl-reply', enabled: true, placements: ['dashboard', 'community', 'website'], theme: 'reply', product: 'replyvoo', icon: 'reply', brand: 'Replyvoo', kicker: 'Sponsored by Zedapex',
        title: 'Every chat answered in seconds.', body: 'AI Closers reply on Telegram day and night, qualify each lead and send the payment link. 30 free chats a month.',
        cta_text: 'Try Replyvoo', cta_url: '/app#apps', scene: 'chat', stat_label: 'Reply time', stat_value: '3s', example: true, chips: ['Is the VIP group still open?', 'Yes. Here is your link to join.', 'Paid · Joined'], image: '', starts: 0, ends: 0 },
      { id: 'sl-cast', enabled: true, placements: ['dashboard', 'academy', 'website'], theme: 'cast', product: 'castvoo', icon: 'cast', brand: 'Castvoo', kicker: 'Sponsored by Zedapex',
        title: 'Bring cold subscribers back.', body: 'Broadcasts and drip sequences that send each group the message written for them. Free for 7 days.',
        cta_text: 'Start 7 days free', cta_url: '/app#apps', scene: 'stat', stat_label: 'Messages opened', stat_value: '1,284', example: true, chips: ['Day 3 follow-up sent', 'Welcome sent to 86 joiners', 'Group: Deposited'], image: '', starts: 0, ends: 0 },
      { id: 'sl-premium', enabled: true, placements: ['dashboard', 'academy', 'community'], theme: 'premium', product: '', icon: 'voosquare', brand: 'Premium', kicker: 'VooSquare Premium',
        title: 'Go Premium for $20 a month.', body: 'Every Academy course, the premium rooms and a monthly live campaign breakdown with Dchessking.',
        cta_text: 'See Premium', cta_url: '/app#premium', scene: 'stat', stat_label: 'Premium, per month', stat_value: '$20', example: false, chips: ["Buyers' Lounge open", 'Live breakdown this month', 'Every course included'], image: '', starts: 0, ends: 0 },
      { id: 'sl-gate', enabled: true, placements: ['dashboard', 'website'], theme: 'gate', product: 'gatevoo', icon: 'gatevoo', brand: 'Gatevoo', kicker: 'Coming soon from Zedapex',
        title: 'Get paid in crypto, straight to your wallet.', body: 'Gatevoo is the checkout behind the Voo family. USDT and Bitcoin, paid to an address you control.',
        cta_text: 'Join the waitlist', cta_url: 'https://gatevoo.com', scene: 'checkout', stat_label: 'USDT · TRC20', stat_value: '$120', example: true, chips: ['Payment confirmed', 'No middle wallet'], image: '', starts: 0, ends: 0 },
    ],
  },
  premium: {
    enabled: true, name: 'VooSquare Premium', price_usd: 20, period_days: 30,
    tagline: 'For operators who scale.',
    features: [
      'Premium rooms: Buyers’ Lounge, Scaling Desk, Offer Drops and Creative Reviews',
      'Every Academy course, including the advanced tracks',
      'Monthly live campaign breakdown with Dchessking, plus replays',
      'Templates and playbooks: kill rules, creative briefs, welcome scripts',
      'Priority support across every Voo tool',
      'Premium badge and early access to new tools',
    ],
  },
  free_plan: {
    name: 'Free for life',
    features: ['One Voo ID for every tool', 'Free community rooms', 'Free Academy courses', 'The Voo Blog', 'Support for every tool'],
  },
  referrals: { tiers: [{ min: 1, rate: 10 }, { min: 5, rate: 20 }, { min: 20, rate: 30 }], min_withdraw: 300, settle_days: 30 },
  community: {
    rules: [
      'Be useful. Share what worked, what failed and the numbers behind it.',
      'No spam, no cold DMs, no selling in rooms without permission.',
      'No personal data of customers or leads, ever.',
      'Respect every buyer. Disagree with ideas, not people.',
    ],
    welcome: 'Welcome to the square. Say hi in Introductions and tell us what you run.',
  },
  email: {},
  /* Free tools: which are on, Free or Premium, their order, and the Kill-or-scale thresholds. */
  tools: TOOLS_DEFAULT,
};

const PRODUCTS = [
  { slug: 'voosquare', name: 'VooSquare', stage: 'Hub', status: 'live', tagline: 'The hub for media buyers.', icon: 'voosquare', color: '#00A86B', tint: '#E7F8F0', sort: -1, visible: 0, hub: 1, url: '' },
  { slug: 'spyvoo', name: 'Spyvoo', stage: 'Research', status: 'new', tagline: 'Search live Facebook and Instagram ads from every country and see why the winners work.', icon: 'spyvoo', color: '#3355F0', tint: '#EEF2FF', sort: 0, url: 'https://spyvoo.com', offer: 'Start free' },
  { slug: 'affleego', name: 'Affleego', stage: 'Monetize', status: 'live', tagline: 'Premium CPA and RevShare deals in finance, sports and casino.', icon: 'affleego', color: '#E8C200', tint: '#FFF6C7', sort: 1, external: 1, url: 'https://affleego.com', offer: 'Zedapex platform' },
  { slug: 'vooads', name: 'Vooads', stage: 'Acquire', status: 'new', tagline: 'Turn one sentence into videos, images and hooks in every size and language.', icon: 'vooads', color: '#EE5A2F', tint: '#FCE6DC', sort: 2, url: '', offer: 'First ads free' },
  { slug: 'landvoo', name: 'Landvoo', stage: 'Acquire', status: 'soon', tagline: 'Landing pages built to pass review and convert paid traffic.', icon: 'land', color: '#E8458B', tint: '#FDE2EC', sort: 3, url: '' },
  { slug: 'joinvoo', name: 'Joinvoo', stage: 'Track', status: 'live', tagline: 'Every real Telegram join and deposit, sent back to Meta, TikTok and Snapchat.', icon: 'join', color: '#5B3FE8', tint: '#ECE8FF', sort: 4, url: 'https://joinvoo.com', offer: '500 joins free' },
  { slug: 'replyvoo', name: 'Replyvoo', stage: 'Convert', status: 'new', tagline: 'AI Closers answer every chat, qualify leads and send the payment link.', icon: 'reply', color: '#B88A00', tint: '#FFF4CF', sort: 5, url: '', offer: '30 free chats a month' },
  { slug: 'castvoo', name: 'Castvoo', stage: 'Retain', status: 'beta', tagline: 'Welcome, follow up and sell to every subscriber on schedule.', icon: 'cast', color: '#2449D8', tint: '#E4ECFF', sort: 6, url: '', offer: '7 days free' },
  { slug: 'gatevoo', name: 'Gatevoo', stage: 'Collect', status: 'soon', tagline: 'The checkout behind the Voo family. USDT and Bitcoin, straight to your wallet.', icon: 'gatevoo', color: '#111111', tint: '#F1F0EB', sort: 7, external: 1, url: 'https://gatevoo.com', offer: 'Join the waitlist' },
];

/* The founder's room: invite only. Members apply, the team approves, then they pay. */
const INNER_CIRCLE_OLD_DESC = 'Small room. Weekly voice notes, campaign teardowns and direct questions to Dchessking.';
const INNER_CIRCLE = {
  name: 'Inner Circle with Dchessking', topic: 'Paid rooms', icon: 'star', color: '#111312', access: 'paid', price_usd: 299, period_days: 30,
  description: 'Invite only, 25 seats. For operators already spending seriously on paid traffic. Post your numbers and Dchessking reviews them in the room. One group call a month, campaign teardowns, and a direct line when a decision cannot wait.',
  approval_required: 1, seats: 25,
  apply_questions: JSON.stringify(['What do you run right now? (verticals, geos)', 'Your monthly ad spend', 'What do you want from the Inner Circle?', 'Telegram or WhatsApp handle (optional)']),
};

const ROOMS = [
  { slug: 'announcements', name: 'Announcements', topic: 'Start here', description: 'Releases, events and news from the Zedapex team.', icon: 'megaphone', color: '#00A86B', access: 'free', read_only: 1 },
  { slug: 'introductions', name: 'Introductions', topic: 'Start here', description: 'Say hi. Tell us what you run, your geos and your verticals.', icon: 'wave', color: '#12C784', access: 'free' },
  { slug: 'general', name: 'General', topic: 'Start here', description: 'Anything about media buying and performance marketing.', icon: 'chat', color: '#0F766E', access: 'free' },
  { slug: 'tracking', name: 'Tracking & signals', topic: 'Craft', description: 'Pixels, CAPI, postbacks, attribution and clean signals.', icon: 'target', color: '#5B3FE8', access: 'free' },
  { slug: 'creatives', name: 'Creatives & hooks', topic: 'Craft', description: 'Hooks, formats, UGC and what is stopping the scroll right now.', icon: 'play', color: '#EE5A2F', access: 'free' },
  { slug: 'telegram', name: 'Telegram funnels', topic: 'Craft', description: 'Channels, bots, join requests, broadcasts and follow-ups.', icon: 'send', color: '#2449D8', access: 'free' },
  { slug: 'geos-africa', name: 'African geos', topic: 'Geos', description: 'Nigeria, Kenya, Ghana, South Africa, Cameroon and beyond.', icon: 'globe', color: '#B45309', access: 'free' },
  { slug: 'tool-help', name: 'Tool help', topic: 'Help', description: 'Questions about Joinvoo, Vooads, Replyvoo, Castvoo and the rest.', icon: 'help', color: '#475569', access: 'free' },
  { slug: 'buyers-lounge', name: 'Buyers’ Lounge', topic: 'Premium', description: 'Serious operators only. Real numbers, real campaigns.', icon: 'diamond', color: '#00774B', access: 'premium' },
  { slug: 'scaling-desk', name: 'Scaling Desk', topic: 'Premium', description: 'Budgets, kill rules, account health and going wide.', icon: 'rocket', color: '#0F766E', access: 'premium' },
  { slug: 'offer-drops', name: 'Offer Drops', topic: 'Premium', description: 'New offers and payouts worth testing, shared first here.', icon: 'tag', color: '#8A6A00', access: 'premium' },
  { slug: 'creative-reviews', name: 'Creative Reviews', topic: 'Premium', description: 'Post a creative, get it reviewed by working buyers.', icon: 'eye', color: '#C8401C', access: 'premium' },
  { slug: 'inner-circle', ...INNER_CIRCLE },
];

/* Gatevoo (Zedapex's own crypto checkout). Seeded switched off: add the API key and webhook secret, then switch it on. */
const GATEVOO_SEED = { type: 'gatevoo', name: 'Pay with crypto · Gatevoo', currency: 'USD', rate: 1, config: { api_base: 'https://gatevoo.com', api_key: '', webhook_secret: '', assets: ['USDT_TRC20', 'BTC'] }, enabled: 0, sort: 0, note: 'Add your Gatevoo API key and webhook secret, then switch it on.', countries: [] };

const PAYMENT_METHODS = [
  { type: 'paystack', name: 'Card, bank or USSD (Paystack)', currency: 'NGN', rate: 1600, config: {}, enabled: 0, sort: 1, note: 'Set the NGN rate per 1 USD.', countries: ['NG', 'GH', 'KE', 'ZA'] },
  { type: 'flutterwave', name: 'Card or mobile money (Flutterwave)', currency: 'KES', rate: 130, config: {}, enabled: 0, sort: 2, note: '', countries: ['KE', 'GH', 'CM', 'NG'] },
  { type: 'stripe', name: 'Card (Stripe)', currency: 'USD', rate: 1, config: {}, enabled: 0, sort: 3, note: '', countries: [] },
  { type: 'crypto', name: 'USDT (TRC20)', currency: 'USDT', rate: 1, config: { network: 'TRON (TRC20)', address: '', instructions: 'Send the exact amount, then paste your transaction hash. We confirm within a few hours.' }, enabled: 0, sort: 4, note: '', countries: [] },
  { type: 'crypto', name: 'Bitcoin', currency: 'BTC', rate: 0.000016, config: { network: 'Bitcoin', address: '', instructions: 'Send the exact amount, then paste your transaction hash.' }, enabled: 0, sort: 5, note: 'Update the BTC rate per 1 USD regularly.', countries: [] },
  { type: 'manual', name: 'Bank transfer', currency: 'NGN', rate: 1600, config: { instructions: 'Transfer the exact amount from your own account, then paste your transfer reference or add a screenshot of the receipt.', details: [{ label: 'Bank', value: '' }, { label: 'Account number', value: '' }, { label: 'Account name', value: '' }], proof_mode: 'either', icon: 'wallet' }, enabled: 0, sort: 6, note: 'Fill in your bank details before switching it on.', countries: ['NG'] },
  GATEVOO_SEED,
];

const CANNED = [
  { title: 'Greeting', body: 'Hi {name}, thanks for reaching out. I am looking into this now.' },
  { title: 'Need more details', body: 'Could you share a screenshot and the email on your account? That helps me fix this faster.' },
  { title: 'Fixed', body: 'This is fixed on our side. Could you try again and let me know if it works?' },
  { title: 'Closing', body: 'Glad that is sorted. I will close this conversation, but reply any time if you need us.' },
];

function readJson(file, def) { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', file), 'utf8')); } catch { return def; } }

const FALLBACK_COURSES = [{
  slug: 'traffic-banking-101', title: 'Traffic Banking 101', track: 'Foundations', level: 'Beginner', author_key: 'dchessking',
  author_name: 'Dchessking', author_role: 'Founder, Zedapex', description: 'Treat traffic like capital, not cost.',
  grad: 'linear-gradient(135deg,#0F2E20,#1E6B47)', mark: '₦', premium: false,
  lessons: [{ title: 'Traffic is capital, not cost', minutes: 6, steps: [
    { v: 'big', h: 'Every lead is an asset.', p: 'Treat ad spend like capital. Every naira should buy something you can measure and grow.', d: { b: 'Spend → Assets', s: 'Not spend → hope' } },
    { v: 'flow', h: 'The compounding loop', p: 'Spend buys leads. Leads become depositors. Revenue funds the next round.', d: ['Spend', 'Leads', 'Depositors', 'Revenue', 'Reinvest'] },
  ], takeaways: ['Price every lead', 'Track what spend buys'], action: 'Write down your payout, FTD rate and max bid.', quiz: null }],
}];
const FALLBACK_POSTS = [{ slug: 'welcome-to-voosquare', title: 'Welcome to VooSquare', category: 'News', author_key: 'dchessking', author_name: 'Dchessking', author_role: 'Founder, Zedapex', excerpt: 'Why we built one home for every serious media buyer.', minutes: 3, grad: 'linear-gradient(135deg,#0F2E20,#1E6B47)', mark: 'V', body: [['p', 'VooSquare is the home for media buyers: every Zedapex tool, a community and an Academy in one place.']] }];

function seedContent(force = false) {
  if (force) return D.tx(() => reseed());
  seedContentInner(false);
}
/* Owner "reset content" (Admin, type RESET). Nothing is lost: the old courses, lessons, posts and members' Academy
 * progress go into the recycle bin as one batch (src/trash.js), and progress on a lesson that still exists after the
 * reset (same course slug and lesson title) is carried over to the new lesson. Lesson ids get reused by SQLite, so
 * progress is never left pointing at the old ids. */
function reseed() {
  const TRASH = require('./trash');
  const batch = TRASH.newBatch();
  const o = { reason: 'content.reseed', batch };
  const keep = D.all('SELECT p.user_id, p.done_at, c.slug, l.title FROM progress p JOIN lessons l ON l.id=p.lesson_id JOIN courses c ON c.id=l.course_id');
  TRASH.remove('progress', '1=1', [], o);
  TRASH.remove('lessons', '1=1', [], o);
  TRASH.remove('courses', '1=1', [], o);
  TRASH.remove('posts', '1=1', [], o);
  seedContentInner(true);
  for (const k of keep) {
    const l = D.get('SELECT l.id FROM lessons l JOIN courses c ON c.id=l.course_id WHERE c.slug=? AND l.title=?', k.slug, k.title);
    if (l) D.run('INSERT OR IGNORE INTO progress(user_id,lesson_id,done_at) VALUES(?,?,?)', k.user_id, l.id, k.done_at);
  }
  return batch;
}
function seedContentInner(force) {
  if (force || !D.get('SELECT 1 FROM courses')) {
    const courses = readJson('academy.json', FALLBACK_COURSES);
    courses.forEach((c, ci) => {
      const r = D.insert('courses', {
        slug: c.slug || slugify(c.title), title: c.title, track: c.track || 'Foundations', level: c.level || 'Beginner',
        author_key: c.author_key || 'team', author_name: c.author_name || 'Zedapex team', author_role: c.author_role || 'Media buyers',
        description: c.description || '', grad: c.grad || '', mark: c.mark || '', premium: c.premium ? 1 : 0, sort: ci, published: 1, created_at: now(),
      });
      (c.lessons || []).forEach((l, li) => D.insert('lessons', {
        course_id: r.id, idx: li, title: l.title, minutes: l.minutes || 5, premium: l.premium ? 1 : 0,
        steps: JSON.stringify(l.steps || []), takeaways: JSON.stringify(l.takeaways || []), action: l.action || '', quiz: JSON.stringify(l.quiz ? { q: l.quiz.q, options: l.quiz.options || [], answer: Number(l.quiz.answer) || 0, why: l.quiz.why || l.quiz.explain || '' } : null), published: 1,
      }));
    });
  }
  if (force || !D.get('SELECT 1 FROM posts')) {
    const posts = readJson('blog.json', FALLBACK_POSTS);
    posts.forEach((p, i) => D.insert('posts', {
      slug: p.slug || slugify(p.title), title: p.title, category: p.category || 'Playbook', author_key: p.author_key || 'team',
      author_name: p.author_name || 'Zedapex team', author_role: p.author_role || '', excerpt: p.excerpt || '', minutes: p.minutes || 4,
      grad: p.grad || '', mark: p.mark || '', body: JSON.stringify(p.body || []), premium: p.premium ? 1 : 0, published: 1,
      featured: i === 0 ? 1 : 0, created_at: now() - i * 86400_000 * 2,
    }));
  }
}

/* Spotlight slides as they were before Spyvoo. Databases still holding exactly this get the Spyvoo slide; edited slides stay. */
const ADS_BEFORE_SPYVOO = { interval: DEFAULT_SETTINGS.ads.interval, slides: DEFAULT_SETTINGS.ads.slides.filter((s) => s.id !== 'sl-spy') };
const sameValue = (a, b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameValue(a[k], b[k]));
};

const insertProduct = (p) => D.insert('products', {
  ...p, description: p.tagline, external: p.external || 0, hub: p.hub || 0, visible: p.visible ?? 1, sso: 0,
  client_id: 'vsc_' + rid(9), client_secret: 'vss_' + rid(24), api_key: 'vsk_' + rid(24), created_at: now(),
});

function seed() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) if (D.getSetting(k, undefined) === undefined) D.setSetting(k, v);
  if (!D.get('SELECT 1 FROM products')) PRODUCTS.forEach(insertProduct);
  if (!D.get('SELECT 1 FROM rooms')) ROOMS.forEach((r, i) => D.insert('rooms', { price_usd: 0, period_days: 30, read_only: 0, ...r, sort: i, created_at: now() }));
  if (!D.get('SELECT 1 FROM payment_methods')) { PAYMENT_METHODS.forEach((m) => D.insert('payment_methods', { ...m, config: JSON.stringify(m.config), countries: JSON.stringify(m.countries) })); D.setSetting('seeded_gatevoo', true); }
  // Databases created before Gatevoo existed get the (switched off) method once. Deleting it later is respected.
  if (!D.getSetting('seeded_gatevoo', false)) {
    if (!D.get("SELECT 1 FROM payment_methods WHERE type='gatevoo'")) D.insert('payment_methods', { ...GATEVOO_SEED, config: JSON.stringify(GATEVOO_SEED.config), countries: '[]' });
    D.setSetting('seeded_gatevoo', true);
  }
  // Inner Circle moved to invite only at $299. Older databases change once, and only if the room still has the old seeded price and no approval.
  if (!D.getSetting('seeded_inner_circle_v2', false)) {
    const ic = D.get("SELECT * FROM rooms WHERE slug='inner-circle'");
    if (ic && Number(ic.price_usd) === 49 && !ic.approval_required) {
      const { name, topic, icon, color, access, ...rest } = INNER_CIRCLE; // keep the owner's name, topic, icon and colour
      D.update('rooms', ic.id, { ...rest, description: ic.description === INNER_CIRCLE_OLD_DESC ? INNER_CIRCLE.description : ic.description }, ['price_usd', 'description', 'approval_required', 'seats', 'apply_questions']);
    }
    D.setSetting('seeded_inner_circle_v2', true);
  }
  if (!D.get('SELECT 1 FROM canned')) CANNED.forEach((c) => D.insert('canned', c));
  seedContent(false);
  mailer.seedTemplates(false);
  // Spyvoo launched after the first databases were made. Older databases get the product, its Spotlight slide (only when the
  // slides are still the untouched default) and its welcome email at the end of the series, once. Later deletions stay deleted.
  if (!D.getSetting('seeded_spyvoo', false)) {
    if (!D.get("SELECT 1 FROM products WHERE slug='spyvoo'")) insertProduct(PRODUCTS.find((p) => p.slug === 'spyvoo'));
    if (sameValue(D.getSetting('ads', null), ADS_BEFORE_SPYVOO)) D.setSetting('ads', DEFAULT_SETTINGS.ads);
    if (!D.get("SELECT 1 FROM email_sequence WHERE key='seq_spyvoo'") && D.get("SELECT 1 FROM email_templates WHERE key='seq_spyvoo'")) {
      const last = D.get('SELECT MAX(sort) s, MAX(delay_hours) h FROM email_sequence');
      D.run('INSERT INTO email_sequence(key,delay_hours,enabled,sort) VALUES(?,?,1,?)', 'seq_spyvoo', Math.max(216, (Number(last && last.h) || 0) + 24), (Number(last && last.s) || 0) + 1);
    }
    D.setSetting('seeded_spyvoo', true);
  }
  // The Premium email used to sell Inner Circle at $49. Swap only that sentence in saved templates; other edits stay.
  if (!D.getSetting('seeded_inner_circle_email_v2', false)) {
    const OLD = 'A small room for operators who want to go further: weekly voice notes, campaign teardowns and direct questions to Dchessking. $49 a month.';
    const NEW = '25 seats for operators already spending seriously on paid traffic. Dchessking reviews your numbers in the room, with a monthly group call. By application, then $299 a month.';
    for (const t of D.all('SELECT key, html, text FROM email_templates WHERE html LIKE ? OR text LIKE ?', '%$49 a month%', '%$49 a month%')) {
      const html = t.html.split(OLD).join(NEW).split('Paid room &middot; sold separately').join('Invite only &middot; by application');
      const text = t.text.split(OLD).join(NEW).split('(paid room, sold separately)').join('(invite only, by application)');
      if (html !== t.html || text !== t.text) D.run('UPDATE email_templates SET html=?, text=? WHERE key=?', html, text, t.key);
    }
    const OLD_POST = 'Some rooms are sold separately, such as Inner Circle with Dchessking, a small room with weekly voice notes, campaign teardowns and direct questions.';
    const NEW_POST = 'Some rooms are sold separately. Inner Circle with Dchessking is invite only: 25 seats for operators already spending seriously, by application, then $299 a month.';
    for (const p of D.all('SELECT id, body FROM posts WHERE body LIKE ?', '%' + OLD_POST + '%')) D.run('UPDATE posts SET body=? WHERE id=?', p.body.split(OLD_POST).join(NEW_POST), p.id);
    D.setSetting('seeded_inner_circle_email_v2', true);
  }
  // The school is VooSquare Academy (another school owns the old names). Once: saved certificate titles of the schools and
  // email templates the team edited say the new name. Untouched templates already moved with seedTemplates; issued
  // certificates keep their stored title and are shown with the new name (src/school.js brand()).
  if (!D.getSetting('seeded_academy_name_v1', false)) {
    const rename = (s) => String(s || '').replace(/\bVoo (School|Academy)\b/g, 'VooSquare Academy');
    try {
      for (const s of D.all("SELECT id, cert_title FROM school_schools WHERE cert_title LIKE '%Voo School%' OR cert_title LIKE '%Voo Academy%'")) D.run('UPDATE school_schools SET cert_title=? WHERE id=?', rename(s.cert_title), s.id);
    } catch { /* no school tables yet */ }
    for (const t of D.all("SELECT key, name, subject, preheader, html, text FROM email_templates WHERE COALESCE(name,'')||COALESCE(subject,'')||COALESCE(preheader,'')||COALESCE(html,'')||COALESCE(text,'') LIKE '%Voo School%' OR COALESCE(name,'')||COALESCE(subject,'')||COALESCE(preheader,'')||COALESCE(html,'')||COALESCE(text,'') LIKE '%Voo Academy%'")) {
      D.run('UPDATE email_templates SET name=?, subject=?, preheader=?, html=?, text=? WHERE key=?', rename(t.name), rename(t.subject), rename(t.preheader), rename(t.html), rename(t.text), t.key);
    }
    D.setSetting('seeded_academy_name_v1', true);
  }
}

module.exports = { seed, seedContent };
