'use strict';
/* Shapes the affiliate app and admin screens read: profile, tier card, health meter, manager cards, offers, ledger rows. */
const config = require('../config');
const D = require('../db');
const C = require('./core');
const E = require('./engine');
const T = require('./tracking');
const { now } = require('../util');

const DAY = C.DAY;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PITCH = {
  premium: ['Every Academy track, premium rooms and a monthly live campaign breakdown with Dchessking.', 'Buyers who want to learn faster from people running real spend.'],
  spyvoo: ['Search live Facebook and Instagram ads from every country and see why the long runners work.', 'Buyers looking for angles before they spend.'],
  joinvoo: ['Tracks every real Telegram join, sign-up and deposit and sends them to Meta, TikTok and Snapchat.', 'Anyone running ads to Telegram.'],
  vooads: ['AI ad videos, images and hooks in every size, in Pidgin, Swahili and French, checked against Meta\'s rules.', 'Buyers who need more creatives each week.'],
  replyvoo: ['AI Closers answer every Telegram and website chat in seconds and send the payment link.', 'Teams losing leads in slow inboxes.'],
  castvoo: ['Broadcasts and drip sequences that send each Telegram group the message written for them.', 'Channel owners with large lists.'],
  landvoo: ['Landing pages built to pass review and convert paid traffic.', 'Buyers tired of rejected pages.'],
  room: ['Paid community rooms on VooSquare.', 'Buyers who want a smaller room with operators.'],
};

function userCard(id) {
  if (!id) return null;
  const u = D.get('SELECT id, name, avatar FROM users WHERE id=?', id);
  if (!u) return null;
  const m = D.get('SELECT * FROM aff_managers WHERE user_id=?', id) || {};
  return { id: u.id, name: u.name, avatar: C.json(u.avatar, {}), languages: C.json(m.languages, []), hours: m.hours || '', telegram: m.telegram || '' };
}
function tierCard(a, at = now()) {
  const T_ = C.tiers();
  const eff = C.effectiveTier(a, at);
  const M = C.monthKey(at);
  const month = E.qualifiedCount(a.id, ...C.monthRange(M));
  const c1 = E.qualifiedCount(a.id, ...C.monthRange(C.addMonths(M, -1)));
  const c2 = E.qualifiedCount(a.id, ...C.monthRange(C.addMonths(M, -2)));
  const avg = a.approved_at && a.approved_at >= C.monthStartOf(C.addMonths(M, -1)) ? c1 : (c1 + c2) / 2;
  const next = T_[eff + 1] || null;
  const rr = E.refundRate(a.id, C.monthStartOf(C.addMonths(M, -1)), at + 1);
  const q = C.settings().quality;
  const nextFirst = C.monthStartOf(C.addMonths(M, 1));
  const cur = T_[eff];
  return {
    tier: cur.name, idx: eff, rate_bp: cur.rate_bp, computed: a.tier || 0, override: a.tier_override ?? null, floor: a.tier_floor ?? null, floor_until: a.tier_floor_until || null,
    month_qualified: month, avg_two_months: avg, next: next ? { name: next.name, min: next.min, rate_bp: next.rate_bp, remaining: Math.max(0, next.min - month), fast_lane_hint: next.min - month > 0 && next.min - month <= Math.ceil(next.min * 0.2) } : null,
    set_on: nextFirst, grace: !!a.tier_grace_month && avg < cur.min, grace_month: a.tier_grace_month ? MONTHS[Number(a.tier_grace_month.slice(5, 7)) - 1] : '',
    refund_rate: rr.rate_bp / 100, quality_warning: rr.customers >= q.min_customers && rr.rate_bp > q.no_upgrade_bp, quality_drop: rr.customers >= q.min_customers && rr.rate_bp > q.drop_bp,
    legend_pending: !!a.legend_pending && !a.legend_approved, history: D.all('SELECT from_tier, to_tier, reason, at FROM aff_tier_history WHERE affiliate_id=? ORDER BY id DESC LIMIT 12', a.id).map((h) => ({ from: T_[h.from_tier] ? T_[h.from_tier].name : '', to: T_[h.to_tier] ? T_[h.to_tier].name : '', reason: h.reason, at: h.at })),
  };
}
function health(a, at = now()) {
  const h = E.healthOf(a, at);
  return { state: a.health_state === 'inactive' && h.state !== 'inactive' ? h.state : h.state, ...h, since: a.health_since || null, stored_state: a.health_state };
}
function perks(a, at = now()) {
  const t = C.effectiveTier(a, at); const s = C.settings();
  return { coupons: t >= s.coupons_min_tier, stats_api: t >= s.stats_api_min_tier, custom_landing: t >= s.custom_landing_min_tier, private_manager: t >= s.private_manager_min_tier, cpa: t >= s.cpa.min_tier, early_creatives_hours: t >= 2 ? 168 : t >= 1 ? 48 : 0, payout_days: C.tiers()[t].sla_days };
}
/** The affiliate's own view of their account. */
function me(a, at = now()) {
  const user = D.get('SELECT * FROM users WHERE id=?', a.user_id);
  const parent = a.parent_affiliate_id ? C.byId(a.parent_affiliate_id) : null;
  const tg = require('./telegram').state(a.id);
  const kyc = require('./kyc').state(a);
  const links = D.get('SELECT COUNT(*) n FROM aff_links WHERE affiliate_id=?', a.id).n;
  return {
    id: a.id, ref: `AF-${a.id}`, code: a.code, status: a.status, applied: !!a.applied_at, applied_at: a.applied_at, approved_at: a.approved_at, app_step: a.app_step,
    info_request: a.info_request || '', info_from: a.info_requested_by ? (D.get('SELECT name FROM users WHERE id=?', a.info_requested_by) || {}).name : '',
    decline_reasons: a.status === 'rejected' ? a.decline_reasons.map((k) => require('./program').DECLINE_APP[k] || k) : [], reapply_after: a.status === 'rejected' ? a.reapply_after : null,
    display_name: a.display_name, hide_name: !!a.hide_name, kind: a.kind, company: a.company, country: a.country, telegram: a.telegram, whatsapp: a.whatsapp, languages: a.languages,
    name: user ? user.name : '', first_name: user ? user.name.split(' ')[0] : '', avatar: user ? C.json(user.avatar, {}) : {}, email: user ? user.email : '',
    traffic: a.traffic, tier: tierCard(a, at), health: health(a, at), activated_at: a.activated_at || null, perks: perks(a, at),
    managers: { general: userCard(a.general_manager_id), private: userCard(a.private_manager_id) },
    wallets: { usdt_trc20: a.wallet_usdt ? C.maskWallet(a.wallet_usdt) : '', btc: a.wallet_btc ? C.maskWallet(a.wallet_btc) : '', method: a.payout_method, locked: !!require('./payouts').openPayout(a.id) },
    kyc, telegram: { configured: tg.configured, connected: tg.connected, username: tg.username },
    sub: { code: a.sub_code, link: `${config.baseUrl}/a/${a.code}?join=1`, parent: parent ? { ref: `AF-${parent.id}`, name: parent.display_name } : null },
    link: T.trackingUrl(a), cpa_paused: !!a.cpa_paused, welcome_seen: !!a.welcome_seen, terms_version: a.terms_version, terms_accepted_at: a.terms_accepted_at, terms: C.termsState(a),
    checklist: { first_link: links > 0, telegram: tg.connected, payout_address: !!(a.wallet_usdt || a.wallet_btc), start_here: !!(a.notif_prefs && a.notif_prefs.start_here_done) },
    api_key: a.api_key_prefix ? { prefix: a.api_key_prefix + '…', ips: a.api_ips } : null, tax: { country: a.tax_country, tax_id: a.tax_id ? '••••' + a.tax_id.slice(-3) : '' },
    marketing: !!a.marketing, created_at: a.created_at,
  };
}
/** Offers page: every product, your rate, the cap note, synced plans, your CPA state and scheduled changes. */
function offers(a, at = now()) {
  const tier = C.tiers()[C.effectiveTier(a, at)];
  const s = C.settings();
  const R = require('./reports');
  const changes = D.all('SELECT * FROM aff_offer_changes WHERE applied_at IS NULL AND (scope=\'program\' OR affiliate_id=?) ORDER BY effective_at', a.id);
  const list = C.productList();
  const E2 = require('./engine');
  return {
    tier: tier.name, rate_bp: tier.rate_bp, custom_deals: require('./program').revshareDealsFor(a.id, at),
    products: list.filter((p) => p.commissionable && p.cap_bp > 0).map((p) => {
      const deal = D.get("SELECT * FROM aff_deals WHERE affiliate_id=? AND product_key=? AND status IN ('active','paused') AND model IN ('cpa','hybrid') ORDER BY id DESC LIMIT 1", a.id, p.key);
      const pending = D.get("SELECT id, status FROM aff_deal_requests WHERE affiliate_id=? AND product_key=? AND status='pending' AND source='affiliate'", a.id, p.key);
      const base = Math.min(tier.rate_bp, p.cap_bp);
      const cd = E2.revshareDeal(a.id, p.key, at);
      const cdRate = cd ? E2.dealRate(cd, p.cap_bp) : 0;
      const rate = Math.max(base, cdRate);
      return {
        custom: cd && cdRate > base ? { deal_id: cd.id, rate_bp: cdRate, special: cd.rate_bp > C.HARD_CAP_BP, label: cd.rate_bp > C.HARD_CAP_BP ? `Special deal ${cd.rate_bp / 100}%` : `Custom deal ${cd.rate_bp / 100}%`, ends_at: cd.ends_at || null, days_left: cd.ends_at ? Math.max(0, Math.ceil((cd.ends_at - at) / C.DAY)) : null } : null,
        key: p.key, name: p.name, icon: p.icon, color: p.color, status: p.tool_status || 'live', pitch: (PITCH[p.key] || ['', ''])[0], who: (PITCH[p.key] || ['', ''])[1], domain: p.domain,
        your_rate_bp: rate, cap_bp: p.cap_bp, capped: rate < tier.rate_bp && !(cd && cdRate > base), plans: p.plans.map((x) => ({ name: x.plan, price_cents: x.price_cents, synced_at: x.synced_at })),
        cpa: deal ? { state: deal.status === 'paused' ? 'paused' : 'active', ...R.dealView(deal), hold_days: Math.max(p.cpa_hold_days || 0, deal.cpa_cents >= s.holds.cpa_long_cents ? Math.max(s.holds.cpa_long_days, s.holds.cpa_days) : s.holds.cpa_days) }
          : pending ? { state: 'requested' } : a.status !== 'approved' ? { state: 'after_approval' } : C.effectiveTier(a, at) < s.cpa.min_tier ? { state: 'opens_at', tier: C.tierName(s.cpa.min_tier) } : p.cpa_cents ? { state: 'available', example_cents: p.cpa_cents } : { state: 'apply' },
        qualification: p.qualification, hold_days: Math.max(p.hold_days || 0, ['premium', 'room'].includes(p.key) ? s.holds.order_days : s.holds.spend_days), link: T.trackingUrl(a, { product: p.key }),
        scheduled: changes.filter((c) => c.product_key === p.key).map((c) => ({ field: c.field, from: c.old_value, to: c.new_value, effective_at: c.effective_at, direction: c.direction })),
      };
    }),
    excluded: list.filter((p) => !p.commissionable || p.cap_bp === 0).map((p) => ({ key: p.key, name: p.name, note: p.key === 'inner-circle' ? 'Not commissionable.' : p.key === 'gatevoo' ? 'Waitlist. Not part of the program yet.' : 'Not commissionable.' })),
  };
}
const LEDGER_TYPE = { revshare: 'RevShare', cpa: 'CPA', hybrid_cpa: 'Hybrid', sub_override: 'Sub-affiliate', adjustment: 'Adjustment', clawback: 'Reversal', contest_prize: 'Contest' };
const LEDGER_STATUS = { pending_activation: 'Waiting for activation', hold: 'On hold', available: 'Available', in_review: 'In review', declined: 'Declined', reversed: 'Reversed', paid: 'Paid' };
function ledgerRow(m) {
  const attr = m.customer_user_id ? D.get('SELECT cust_ref FROM aff_attributions WHERE customer_user_id=?', m.customer_user_id) : null;
  return {
    // at: when the line was recorded; earned_at: the date it belongs to (payment, approval or reversal date), which is the
    // month reports and statements put it in (money audit MN-5).
    id: m.id, at: m.created_at, earned_at: m.earned_at || m.created_at, customer_ref:attr ? attr.cust_ref : m.type === 'contest_prize' ? 'Contest' : m.type === 'sub_override' ? 'Sub-affiliate' : '', product_key: m.product_key,
    type: m.type, type_label: (LEDGER_TYPE[m.type] || m.type) + (m.special_bp ? ` · Special deal ${m.special_bp / 100}%` : ''), special: !!m.special_bp, special_bp: m.special_bp || 0, deal_id: m.deal_id || null, amount_cents: m.amount_cents, rate_bp: m.rate_bp, base_cents: m.base_cents, status: m.status, status_label: LEDGER_STATUS[m.status] || m.status,
    release_at: m.status === 'hold' ? m.hold_until : m.released_at || null, reason: m.reason, reason_text: m.reason && E.DECLINE[m.reason] ? E.DECLINE[m.reason] : '', note: m.note, in_payout: m.payout_id || null,
  };
}
/** Admin row for affiliate lists. */
function adminRow(a, at = now(), { reveal = false } = {}) {
  const R = require('./reports');
  const u = D.get('SELECT name, email, avatar FROM users WHERE id=?', a.user_id) || {};
  const m = R.affiliateMonth(a.id, at);
  return {
    id: a.id, ref: `AF-${a.id}`, user_id: a.user_id, name: u.name || '', display_name: a.display_name, handle: a.display_name, email: reveal ? u.email : C.maskEmail(u.email), avatar: C.json(u.avatar, {}), country: a.country,
    status: a.status, tier: C.tierName(C.effectiveTier(a, at)), tier_idx: C.effectiveTier(a, at), qualified_mtd: m.qualified_mtd, commission_mtd_cents: m.commission_mtd_cents, adjustments_mtd_cents: m.adjustments_mtd_cents, refund_rate: m.refund_rate,
    fraud_score: a.fraud_score, kyc: a.kyc_status, health: a.health_state, cpa_paused: !!a.cpa_paused, general_manager: userCard(a.general_manager_id), private_manager: userCard(a.private_manager_id),
    sources: ((a.traffic || {}).sources || []).join(', '), applied_at: a.applied_at, approved_at: a.approved_at, created_at: a.created_at,
  };
}

module.exports = { me, tierCard, health, perks, offers, userCard, ledgerRow, adminRow, PITCH, LEDGER_TYPE, LEDGER_STATUS };
