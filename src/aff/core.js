'use strict';
/*
 * VooSquare Affiliates: schema, program settings, product rules and shared helpers.
 *
 * Rules: docs/AFFILIATE_DECISIONS.md (final) over docs/AFFILIATE_SPEC.md. API: docs/AFFILIATE_API.md.
 * Money is always integer US cents (`*_cents`). Rates are basis points (`*_bp`, 2500 = 25%).
 * Every table is prefixed aff_ and created on boot when missing (guarded, so existing databases migrate in place).
 */
const crypto = require('node:crypto');
const D = require('../db');
const REV = require('../revenue');
const { now, fail, json, clean, hmac } = require('../util');

const DAY = 86400_000;
const HOUR = 3600_000;

/* ------------------------------------------------------------------ schema */
D.db.exec(`
CREATE TABLE IF NOT EXISTS aff_affiliates(
  id INTEGER PRIMARY KEY, user_id INTEGER UNIQUE NOT NULL, code TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'pending',
  display_name TEXT DEFAULT '', hide_name INTEGER DEFAULT 0, kind TEXT DEFAULT 'individual', company TEXT DEFAULT '', country TEXT DEFAULT '',
  telegram TEXT DEFAULT '', whatsapp TEXT DEFAULT '', languages TEXT DEFAULT '[]', application TEXT DEFAULT '{}', traffic TEXT DEFAULT '{}',
  app_step INTEGER DEFAULT 0, applied_at INTEGER, approved_at INTEGER, decided_by INTEGER, decided_at INTEGER, decline_reasons TEXT DEFAULT '[]',
  reapply_after INTEGER DEFAULT 0, info_request TEXT DEFAULT '', info_requested_by INTEGER, escalated INTEGER DEFAULT 0,
  tier INTEGER DEFAULT 0, tier_override INTEGER, tier_floor INTEGER, tier_floor_until INTEGER DEFAULT 0, tier_grace_month TEXT DEFAULT '',
  tier_set_at INTEGER, legend_pending INTEGER DEFAULT 0, legend_approved INTEGER DEFAULT 0,
  activated_at INTEGER, health_state TEXT DEFAULT 'inactive', health_since INTEGER, grace_until INTEGER DEFAULT 0, health_exempt INTEGER DEFAULT 0,
  kyc_status TEXT DEFAULT 'none', kyc_provider_ref TEXT DEFAULT '', kyc_reason TEXT DEFAULT '', kyc_updated_at INTEGER,
  fraud_score INTEGER DEFAULT 0, cpa_paused INTEGER DEFAULT 0, cpa_paused_reason TEXT DEFAULT '', cpa_started_at INTEGER,
  general_manager_id INTEGER, private_manager_id INTEGER, parent_affiliate_id INTEGER, sub_code TEXT UNIQUE,
  wallet_usdt TEXT DEFAULT '', wallet_btc TEXT DEFAULT '', payout_method TEXT DEFAULT 'usdt_trc20',
  tax_country TEXT DEFAULT '', tax_id TEXT DEFAULT '', terms_version TEXT DEFAULT '', terms_accepted_at INTEGER,
  marketing INTEGER DEFAULT 0, notif_prefs TEXT DEFAULT '{}', api_key_hash TEXT UNIQUE, api_key_prefix TEXT DEFAULT '', api_ips TEXT DEFAULT '[]',
  welcome_seen INTEGER DEFAULT 0, pause_reason TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER, closed_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_status ON aff_affiliates(status);
CREATE INDEX IF NOT EXISTS ix_aff_gm ON aff_affiliates(general_manager_id);
CREATE INDEX IF NOT EXISTS ix_aff_pm ON aff_affiliates(private_manager_id);
CREATE INDEX IF NOT EXISTS ix_aff_parent ON aff_affiliates(parent_affiliate_id);

CREATE TABLE IF NOT EXISTS aff_links(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, code TEXT UNIQUE NOT NULL, name TEXT DEFAULT '', product_key TEXT DEFAULT '',
  dest_url TEXT DEFAULT '', sub1 TEXT DEFAULT '', sub2 TEXT DEFAULT '', sub3 TEXT DEFAULT '', sub4 TEXT DEFAULT '', sub5 TEXT DEFAULT '',
  click_macro TEXT DEFAULT '', archived INTEGER DEFAULT 0, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_links_aff ON aff_links(affiliate_id, archived);

CREATE TABLE IF NOT EXISTS aff_clicks(
  id INTEGER PRIMARY KEY, uid TEXT UNIQUE NOT NULL, affiliate_id INTEGER NOT NULL, link_id INTEGER, product_key TEXT DEFAULT '',
  sub1 TEXT DEFAULT '', sub2 TEXT DEFAULT '', sub3 TEXT DEFAULT '', sub4 TEXT DEFAULT '', sub5 TEXT DEFAULT '', ext_click_id TEXT DEFAULT '',
  ip_hash TEXT DEFAULT '', net_hash TEXT DEFAULT '', ua_hash TEXT DEFAULT '', fp_hash TEXT DEFAULT '', country TEXT DEFAULT '', device TEXT DEFAULT '',
  referrer TEXT DEFAULT '', landing TEXT DEFAULT '', kind TEXT DEFAULT 'link', proxy INTEGER DEFAULT 0, existing_user INTEGER, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_clicks_aff ON aff_clicks(affiliate_id, created_at);

CREATE TABLE IF NOT EXISTS aff_coupons(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, code TEXT UNIQUE NOT NULL, product_key TEXT DEFAULT '', discount_pct INTEGER DEFAULT 0,
  max_uses INTEGER DEFAULT 0, uses INTEGER DEFAULT 0, geos TEXT DEFAULT '[]', active INTEGER DEFAULT 1, created_by INTEGER, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS aff_attributions(
  customer_user_id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, click_id INTEGER, method TEXT DEFAULT 'link', coupon_code TEXT DEFAULT '',
  pre_existing INTEGER DEFAULT 0, blocked TEXT DEFAULT '', click_at INTEGER, locked_at INTEGER, cust_ref TEXT DEFAULT '', country TEXT DEFAULT '',
  device TEXT DEFAULT '', sub1 TEXT DEFAULT '', sub2 TEXT DEFAULT '', sub3 TEXT DEFAULT '', sub4 TEXT DEFAULT '', sub5 TEXT DEFAULT '', ext_click_id TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_aff_attr_aff ON aff_attributions(affiliate_id, locked_at);

CREATE TABLE IF NOT EXISTS aff_customers(
  user_id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, first_payment_at INTEGER, first_product TEXT DEFAULT '', first_plan TEXT DEFAULT '',
  first_amount_cents INTEGER DEFAULT 0, payments INTEGER DEFAULT 0, total_cents INTEGER DEFAULT 0, refunded_cents INTEGER DEFAULT 0,
  refunds INTEGER DEFAULT 0, chargebacks INTEGER DEFAULT 0, first_refund_at INTEGER, last_payment_at INTEGER,
  qualified_at INTEGER, qualify_rule TEXT DEFAULT '', model TEXT DEFAULT '', model_at INTEGER, cpa_conversion_id INTEGER, paid_before INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_aff_cust_aff ON aff_customers(affiliate_id, qualified_at);
CREATE INDEX IF NOT EXISTS ix_aff_cust_first ON aff_customers(affiliate_id, first_payment_at);

CREATE TABLE IF NOT EXISTS aff_conversions(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, customer_user_id INTEGER, product_key TEXT DEFAULT '', plan TEXT DEFAULT '',
  event_type TEXT NOT NULL, amount_cents INTEGER DEFAULT 0, source TEXT DEFAULT '', source_id INTEGER, source_key TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'tracked', payment_no INTEGER DEFAULT 0, related_id INTEGER, country TEXT DEFAULT '', note TEXT DEFAULT '',
  occurred_at INTEGER, received_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_conv_aff ON aff_conversions(affiliate_id, occurred_at);
CREATE INDEX IF NOT EXISTS ix_aff_conv_cust ON aff_conversions(customer_user_id, event_type);

CREATE TABLE IF NOT EXISTS aff_commissions(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, type TEXT NOT NULL, amount_cents INTEGER NOT NULL, base_cents INTEGER DEFAULT 0,
  rate_bp INTEGER DEFAULT 0, product_key TEXT DEFAULT '', customer_user_id INTEGER, conversion_id INTEGER, source_commission_id INTEGER,
  hold_until INTEGER DEFAULT 0, status TEXT NOT NULL, reason TEXT DEFAULT '', note TEXT DEFAULT '', payout_id INTEGER, provisional INTEGER DEFAULT 0,
  approved_by INTEGER, uniq_key TEXT UNIQUE, created_at INTEGER, released_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_com_aff ON aff_commissions(affiliate_id, status);
CREATE INDEX IF NOT EXISTS ix_aff_com_cust ON aff_commissions(customer_user_id, type);
CREATE INDEX IF NOT EXISTS ix_aff_com_hold ON aff_commissions(status, hold_until);
CREATE INDEX IF NOT EXISTS ix_aff_com_payout ON aff_commissions(payout_id);

CREATE TABLE IF NOT EXISTS aff_cpa_reviews(
  id INTEGER PRIMARY KEY, conversion_id INTEGER UNIQUE, commission_id INTEGER, affiliate_id INTEGER NOT NULL, customer_user_id INTEGER,
  product_key TEXT DEFAULT '', plan TEXT DEFAULT '', amount_cents INTEGER DEFAULT 0, model TEXT DEFAULT 'cpa', risk INTEGER DEFAULT 0,
  verdict TEXT DEFAULT 'unique', signals TEXT DEFAULT '[]', status TEXT DEFAULT 'pending', reviewer_id INTEGER, decided_at INTEGER,
  decline_reason TEXT DEFAULT '', note TEXT DEFAULT '', extended_days INTEGER DEFAULT 0, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_cpa_status ON aff_cpa_reviews(status, risk);

CREATE TABLE IF NOT EXISTS aff_deals(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, product_key TEXT NOT NULL, plan TEXT DEFAULT '', model TEXT DEFAULT 'cpa',
  cpa_cents INTEGER DEFAULT 0, rate_bp INTEGER DEFAULT 0, monthly_cap INTEGER DEFAULT 50, traffic TEXT DEFAULT '[]', geos TEXT DEFAULT '[]',
  starts_at INTEGER, ends_at INTEGER DEFAULT 0, status TEXT DEFAULT 'active', pause_reason TEXT DEFAULT '',
  created_by INTEGER, approved_by INTEGER, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_deals_aff ON aff_deals(affiliate_id, product_key, status);

CREATE TABLE IF NOT EXISTS aff_deal_requests(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, requested_by INTEGER, source TEXT DEFAULT 'manager', product_key TEXT DEFAULT '', plan TEXT DEFAULT '',
  model TEXT DEFAULT 'cpa', cpa_cents INTEGER DEFAULT 0, rate_bp INTEGER DEFAULT 0, monthly_cap INTEGER DEFAULT 0, tier_floor INTEGER, floor_until INTEGER DEFAULT 0,
  traffic TEXT DEFAULT '[]', geos TEXT DEFAULT '[]', expected INTEGER DEFAULT 0, sample_url TEXT DEFAULT '', reason TEXT DEFAULT '',
  needs_owner INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', decided_by INTEGER, decided_at INTEGER, decision_note TEXT DEFAULT '', deal_id INTEGER, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS aff_offer_changes(
  id INTEGER PRIMARY KEY, scope TEXT DEFAULT 'program', affiliate_id INTEGER, deal_id INTEGER, product_key TEXT DEFAULT '', field TEXT NOT NULL,
  old_value TEXT DEFAULT '', new_value TEXT DEFAULT '', direction TEXT DEFAULT 'increase', announced_at INTEGER, effective_at INTEGER,
  applied_at INTEGER, reminded_at INTEGER, created_by INTEGER, note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS aff_payouts(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL, fee_cents INTEGER DEFAULT 0, method TEXT NOT NULL,
  wallet TEXT NOT NULL, status TEXT DEFAULT 'requested', requested_at INTEGER, sla_due_at INTEGER, approved_by INTEGER, approved_at INTEGER,
  processing_by INTEGER, processing_at INTEGER, paid_by INTEGER, paid_at INTEGER, tx_hash TEXT DEFAULT '', provider TEXT DEFAULT 'manual',
  provider_ref TEXT DEFAULT '', provider_status TEXT DEFAULT '', reason TEXT DEFAULT '', hold_reason TEXT DEFAULT '', note TEXT DEFAULT '',
  receipt_no TEXT UNIQUE, period_from INTEGER, period_to INTEGER, tier INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_aff_payouts_aff ON aff_payouts(affiliate_id, id);
CREATE INDEX IF NOT EXISTS ix_aff_payouts_status ON aff_payouts(status, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_aff_payouts_open ON aff_payouts(affiliate_id) WHERE status IN ('requested','approved','processing','held');

CREATE TABLE IF NOT EXISTS aff_receipts(
  id INTEGER PRIMARY KEY, payout_id INTEGER UNIQUE NOT NULL, receipt_no TEXT UNIQUE NOT NULL, affiliate_id INTEGER NOT NULL, issued_at INTEGER, data TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS aff_kyc_docs(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, upload_id TEXT NOT NULL, doc_type TEXT DEFAULT 'id', created_at INTEGER
);

CREATE TABLE IF NOT EXISTS aff_postbacks(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, name TEXT DEFAULT '', url TEXT NOT NULL, method TEXT DEFAULT 'GET',
  events TEXT DEFAULT '[]', products TEXT DEFAULT '[]', active INTEGER DEFAULT 1, secret TEXT DEFAULT '', created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS aff_postback_deliveries(
  id INTEGER PRIMARY KEY, postback_id INTEGER NOT NULL, affiliate_id INTEGER NOT NULL, event TEXT, event_key TEXT, conversion_id INTEGER,
  url TEXT DEFAULT '', method TEXT DEFAULT 'GET', body TEXT DEFAULT '', status TEXT DEFAULT 'pending', response_code INTEGER, response_ms INTEGER,
  attempts INTEGER DEFAULT 0, next_at INTEGER, last_error TEXT DEFAULT '', test INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER,
  UNIQUE(postback_id, event_key)
);
CREATE INDEX IF NOT EXISTS ix_aff_pbd_due ON aff_postback_deliveries(status, next_at);
CREATE INDEX IF NOT EXISTS ix_aff_pbd_aff ON aff_postback_deliveries(affiliate_id, id);

CREATE TABLE IF NOT EXISTS aff_telegram(
  affiliate_id INTEGER PRIMARY KEY, chat_id TEXT DEFAULT '', username TEXT DEFAULT '', verified INTEGER DEFAULT 0, code_hash TEXT DEFAULT '',
  code_expires INTEGER DEFAULT 0, prefs TEXT DEFAULT '{}', quiet_from TEXT DEFAULT '', quiet_to TEXT DEFAULT '', tz TEXT DEFAULT 'Africa/Lagos',
  linked_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS aff_tg_outbox(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER, chat_id TEXT NOT NULL, kind TEXT DEFAULT '', text TEXT NOT NULL, status TEXT DEFAULT 'queued',
  attempts INTEGER DEFAULT 0, next_at INTEGER, error TEXT DEFAULT '', created_at INTEGER, sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_tg_due ON aff_tg_outbox(status, next_at);

CREATE TABLE IF NOT EXISTS aff_contests(
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, kind TEXT DEFAULT 'monthly', description TEXT DEFAULT '', rules TEXT DEFAULT '',
  banner_upload TEXT DEFAULT '', images TEXT DEFAULT '[]', theme TEXT DEFAULT '{}', starts_at INTEGER, ends_at INTEGER, qual_days INTEGER DEFAULT 0,
  products TEXT DEFAULT '[]', geos TEXT DEFAULT '[]', scoring TEXT DEFAULT '{}', min_points INTEGER DEFAULT 0, multipliers INTEGER DEFAULT 1,
  prizes TEXT DEFAULT '[]', rising TEXT DEFAULT '{}', milestone TEXT DEFAULT '{}', eligibility TEXT DEFAULT '{}', pool_cents INTEGER DEFAULT 0,
  announce INTEGER DEFAULT 1, published INTEGER DEFAULT 1, cancelled INTEGER DEFAULT 0, cancel_note TEXT DEFAULT '',
  final_by INTEGER, final_at INTEGER, signoff_by INTEGER, signoff_at INTEGER, winners TEXT DEFAULT '[]', announced_at INTEGER,
  created_by INTEGER, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS aff_contest_scores(
  contest_id INTEGER NOT NULL, affiliate_id INTEGER NOT NULL, points INTEGER DEFAULT 0, multiplier_bp INTEGER DEFAULT 10000, score INTEGER DEFAULT 0,
  customers INTEGER DEFAULT 0, revenue_cents INTEGER DEFAULT 0, reached_at INTEGER, removed INTEGER DEFAULT 0, disqualified INTEGER DEFAULT 0,
  dq_reason TEXT DEFAULT '', rank INTEGER, prev_rank INTEGER, updated_at INTEGER, PRIMARY KEY(contest_id, affiliate_id)
);

CREATE TABLE IF NOT EXISTS aff_announcements(
  id INTEGER PRIMARY KEY, kind TEXT DEFAULT 'news', title TEXT NOT NULL, body TEXT DEFAULT '', link TEXT DEFAULT '', audience TEXT DEFAULT '{"kind":"all"}',
  channels TEXT DEFAULT '{"dashboard":true}', pinned INTEGER DEFAULT 0, effective_at INTEGER, send_at INTEGER, expires_at INTEGER DEFAULT 0,
  sent_at INTEGER, recipients INTEGER DEFAULT 0, created_by INTEGER, created_at INTEGER
);

CREATE TABLE IF NOT EXISTS aff_creatives(
  id INTEGER PRIMARY KEY, title TEXT DEFAULT '', product_key TEXT DEFAULT '', format TEXT DEFAULT '', size TEXT DEFAULT '', language TEXT DEFAULT 'English',
  platform TEXT DEFAULT '', geo TEXT DEFAULT '', copy_text TEXT DEFAULT '', landing_url TEXT DEFAULT '', upload_id TEXT DEFAULT '', file_url TEXT DEFAULT '',
  min_tier INTEGER DEFAULT 0, public_from INTEGER DEFAULT 0, early_access INTEGER DEFAULT 1, active INTEGER DEFAULT 1, downloads INTEGER DEFAULT 0,
  copies INTEGER DEFAULT 0, created_by INTEGER, created_at INTEGER, updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS aff_notifications(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, category TEXT DEFAULT 'Money', kind TEXT DEFAULT '', text TEXT NOT NULL,
  product_key TEXT DEFAULT '', link TEXT DEFAULT '', read_at INTEGER, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_notif ON aff_notifications(affiliate_id, id);

CREATE TABLE IF NOT EXISTS aff_managers(
  user_id INTEGER PRIMARY KEY, kinds TEXT DEFAULT '["general"]', languages TEXT DEFAULT '[]', countries TEXT DEFAULT '[]',
  capacity INTEGER DEFAULT 0, hours TEXT DEFAULT '', telegram TEXT DEFAULT '', active INTEGER DEFAULT 1, rr_at INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS aff_notes(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, author_id INTEGER, body TEXT NOT NULL, shared INTEGER DEFAULT 0, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS aff_tier_history(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, from_tier INTEGER, to_tier INTEGER, reason TEXT DEFAULT '', score_x100 INTEGER DEFAULT 0, at INTEGER
);
CREATE TABLE IF NOT EXISTS aff_plans(
  product_key TEXT NOT NULL, plan TEXT NOT NULL, price_cents INTEGER DEFAULT 0, synced_at INTEGER, PRIMARY KEY(product_key, plan)
);
CREATE TABLE IF NOT EXISTS aff_identities(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, value TEXT NOT NULL, at INTEGER, UNIQUE(user_id, kind, value)
);
CREATE INDEX IF NOT EXISTS ix_aff_ident ON aff_identities(kind, value);
CREATE TABLE IF NOT EXISTS aff_clawbacks(
  id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, commission_ids TEXT DEFAULT '[]', amount_cents INTEGER DEFAULT 0, reason TEXT DEFAULT '',
  status TEXT DEFAULT 'pending', proposed_by INTEGER, decided_by INTEGER, decided_at INTEGER, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS aff_audit(
  id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, affiliate_id INTEGER, target TEXT DEFAULT '', before TEXT DEFAULT '', after TEXT DEFAULT '', created_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_aff_audit ON aff_audit(created_at);
`);
/* Columns the affiliate engine adds to tables it shares with the rest of VooSquare (guarded). */
function addCol(table, col, decl) { if (!D.db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) D.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); }
addCol('events', 'plan', "TEXT DEFAULT ''");
addCol('events', 'ref_event', "TEXT DEFAULT ''");
addCol('events', 'country', "TEXT DEFAULT ''");
addCol('login_codes', 'aff_coupon', "TEXT DEFAULT ''");
addCol('orders', 'aff_coupon', "TEXT DEFAULT ''");

/* ------------------------------------------------------------------ settings */
const TIER_DEFAULTS = [
  { name: 'Starter', min: 0, rate_bp: 2000, multiplier_bp: 10000, sla_days: 3 },
  { name: 'Pro', min: 10, rate_bp: 2500, multiplier_bp: 10500, sla_days: 3 },
  { name: 'Elite', min: 30, rate_bp: 3000, multiplier_bp: 11000, sla_days: 2 },
  { name: 'Master', min: 75, rate_bp: 3500, multiplier_bp: 11500, sla_days: 2 },
  { name: 'Partner', min: 150, rate_bp: 4000, multiplier_bp: 12000, sla_days: 1 },
  { name: 'Senior Partner', min: 250, rate_bp: 4500, multiplier_bp: 12500, sla_days: 1 },
  { name: 'Legend', min: 400, rate_bp: 5000, multiplier_bp: 12500, sla_days: 1, approval: true },
];
const DEFAULTS = {
  attribution_days: 60,
  // Owner update 2026-10-05: a customer qualifies at the first counted payment (no second payment, no 30-day wait).
  qualification: { rule: 'first_payment' },
  tiers: TIER_DEFAULTS,
  quality: { no_upgrade_bp: 800, drop_bp: 1500, min_customers: 10 },
  activation_customers: 5,
  health: { threshold: 50, window_days: 90, ramp_days: 90, grace_days: 30, at_risk_pct: 70, projection_days: 14, pause_cpa: false },
  subs: { enabled: true, rate_bp: 250, boosted_rate_bp: 500, boost_subs: 50, boost_sub_customers: 10 },
  // Owner update 2026-10-05: earnings are instant. Hold days per source, all 0 by default; admin may set a hold that applies
  // to earnings created after the change. spend = credits used in a tool (final); orders = VooSquare orders paid with a
  // non-reversible method (Gatevoo, crypto, manual); card_orders = orders paid through a card/chargeback-capable method
  // (Paystack, Flutterwave, Stripe, custom API); cpa = after a CPA conversion is approved (long = amount >= cpa_long_cents
  // or the affiliate's first cpa_new_days on CPA). review_extend_days is extra review time ("Need more time").
  holds: { spend_days: 0, order_days: 0, card_order_days: 0, cpa_days: 0, cpa_long_days: 0, cpa_long_cents: 10000, cpa_new_days: 0, review_extend_days: 14 },
  cpa: { max_cents: 30000, clawback_days: 90, fraud_clawback_days: 180, auto_pause_decline_bp: 2000, auto_pause_min: 5, bulk_max_risk: 20, min_tier: 2 },
  payouts: {
    methods: { usdt_trc20: { enabled: true, min_cents: 5000, fee: 'covered', fee_cents: 0 }, btc: { enabled: true, min_cents: 10000, fee: 'deducted', fee_cents: 0 } },
    four_eyes_cents: 200000, holidays: [],
    provider: { kind: 'manual', name: '', api_base: '', api_key: '', webhook_secret: '' },
  },
  kyc: { required: 'first_payout', threshold_cents: 0, provider: { kind: 'manual', name: '', api_base: '', api_key: '', webhook_secret: '' } },
  fraud: {
    weights: { pre_existing: 60, email: 45, phone: 40, device: 30, ip: 15, subnet: 8, payment: 45, telegram: 40, name: 15, self_referral: 70, loop: 50, velocity: 15, proxy: 15, disposable: 20, geo_mismatch: 10, instant_refund: 25, fast_signup: 15, code_only: 5, prior_payment: 60, declined_cluster: 25 },
    possible_at: 30, existing_at: 70,
  },
  reapply_days: 30,
  approval_sla_days: 2,
  stats_api_min_tier: 2,
  coupons_min_tier: 3,
  custom_landing_min_tier: 3,
  private_manager_min_tier: 2,
  manager_capacity: { general: 300, private: 40 },
  notice_days: { cpa_program: 14, cpa_affiliate: 7, revshare: 30 },
  terms_version: 'v1.1', // the code minimum is TERMS.version below; settings() never reports an older one
  link_domains: [],
  click_rate_per_min: 60,
  // Manual balance adjustments: a positive adjustment above four_eyes_cents waits for a second finance/admin approval
  // (never the person who asked). The same affiliate, amount and reason twice within dup_window_sec is refused.
  adjustments: { four_eyes_cents: 50000, dup_window_sec: 60 },
};
function merge(def, v) {
  if (Array.isArray(def)) return Array.isArray(v) ? v : def;
  if (def && typeof def === 'object') {
    const out = { ...def };
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const k of Object.keys(v)) out[k] = k in def ? merge(def[k], v[k]) : v[k];
    return out;
  }
  return v === undefined || v === null ? def : v;
}
/*
 * Affiliate terms version (owner decision 2026-10-05: v1.0 → v1.1, existing affiliates accept the updated terms again).
 * The text is docs/AFFILIATE_TERMS.md; its "## Changes in <version>" section is the summary shown in the dashboard.
 * The code sets the minimum version: an older terms_version stored in settings (admins used to save the full settings
 * object) can never pin the program to an older version. An admin may still set a newer one (e.g. 'v1.2').
 */
const TERMS = { version: 'v1.1', date: '2026-10-05' };
const verParts = (v) => String(v || '').replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
/** -1, 0 or 1 comparing two terms versions like 'v1.0' and 'v1.10'. */
function cmpVersion(a, b) {
  const x = verParts(a); const y = verParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function settings() {
  const s = merge(DEFAULTS, D.getSetting('aff', {}) || {});
  if (!/^v\d+(\.\d+)*$/i.test(String(s.terms_version || '')) || cmpVersion(s.terms_version, TERMS.version) < 0) s.terms_version = TERMS.version;
  return s;
}
const normTiers = (t) => (Array.isArray(t) && t.length ? t : TIER_DEFAULTS).map((x, i) => ({ ...TIER_DEFAULTS[Math.min(i, TIER_DEFAULTS.length - 1)], ...x, idx: i }));
const tiers = () => normTiers(settings().tiers);
const tierName = (i) => (tiers()[i] || tiers()[0]).name;

/* ------------------------------------------------------------------ rates in force on a payment date (money audit MN-1) */
/*
 * "New rates apply to payments after the change": a payment reported late is paid at the tier rates, the product cap and
 * the affiliate's tier that were in force on its payment date, never at today's. Changes are logged in aff_rate_history
 * (kind 'tiers' for the program tier rates, kind 'cap' per product, migration 007) and aff_tier_history (per affiliate).
 * A change counts from its effective time: a payment dated at or after it gets the new value.
 */
const hasRateHistory = () => { try { D.get('SELECT 1 FROM aff_rate_history LIMIT 1'); return true; } catch { return false; } };
/** Log a rate change (before/after JSON-able values) effective at `at`. Never throws (a missing table only skips the log). */
function logRateChange(kind, key, before, after, at = now(), by = null) {
  const sig = (v) => JSON.stringify(kind === 'tiers' ? normTiers(v).map((t) => [t.min, t.rate_bp, t.multiplier_bp, !!t.approval]) : v);
  if (sig(before) === sig(after) || !hasRateHistory()) return;
  D.insert('aff_rate_history', { kind, key: key || '', before: JSON.stringify(before), after: JSON.stringify(after), effective_at: at, created_by: by, created_at: now() });
}
/** The value in force at `at`: the "before" of the first change that took effect after `at`, else null (= today's value). */
function rateBefore(kind, key, at) {
  if (!hasRateHistory()) return null;
  const r = D.get('SELECT before FROM aff_rate_history WHERE kind=? AND key=? AND effective_at>? ORDER BY effective_at, id LIMIT 1', kind, key || '', at);
  return r ? json(r.before, null) : null;
}
/** The program tier list (rates, names) in force at `at`. */
function tiersAt(at = now()) { const t = rateBefore('tiers', '', at); return Array.isArray(t) && t.length ? normTiers(t) : tiers(); }
/** The RevShare cap of a product in force at `at` (0 = not commissionable then), never above the hard cap. */
function capAt(key, at = now()) {
  if (!inProgram(key)) return 0;
  const v = rateBefore('cap', key, at);
  return v === null || !Number.isFinite(Number(v)) ? capFor(key) : Math.max(0, Math.min(Number(v), capMaxFor(key)));
}
/**
 * The tier the affiliate earned at on `at`: the stored tier, or, when it changed after `at` (aff_tier_history), the tier
 * it had before that change. Override, floor and Legend approval apply as in effectiveTier, with the tier list of that date.
 */
function tierAt(a, at = now()) {
  const later = D.get('SELECT from_tier FROM aff_tier_history WHERE affiliate_id=? AND at>=? ORDER BY at, id LIMIT 1', a.id, at);
  return effectiveTier(later ? { ...a, tier: later.from_tier } : a, at, tiersAt(at));
}

/* ------------------------------------------------------------------ products */
/* Program product keys: 'premium' (VooSquare Premium), 'room' (paid rooms), 'inner-circle' (excluded), then each tool's slug. */
const SPECIAL = [
  { key: 'premium', name: 'VooSquare Premium', icon: 'voosquare', color: '#00A86B', domain: '' },
  { key: 'room', name: 'Paid rooms', icon: 'voosquare', color: '#00A86B', domain: '' },
  { key: 'inner-circle', name: 'Inner Circle with Dchessking', icon: 'voosquare', color: '#0A1611', domain: '' },
];
/*
 * Owner decision 2026-10-05: "Affleego operates separately. We're not selling anything there. No commission for that."
 * Products listed here are part of VooSquare (tools page, Voo ID, school) but NOT part of the affiliate program: they are
 * left out of every program list (offers, deals, link builder, creatives, contests, postbacks, reports filters) and the
 * engine ignores their spend, orders and events entirely (no commission, qualification, activation, tier, health or
 * contest effect). This is code, not a setting: an admin cannot switch it back on.
 */
const NOT_IN_PROGRAM = ['affleego'];
const inProgram = (key) => !NOT_IN_PROGRAM.includes(String(key || '').trim().toLowerCase());
/* Hard RevShare caps (owner: "35% max on heavy ones"): AI-heavy tools never above 35%, every product never above 50%. */
const AI_CAPPED = ['vooads', 'replyvoo'];
const HARD_CAP_BP = 5000;
const AI_CAP_BP = 3500;
/** The highest RevShare cap a product may ever have (basis points). The API refuses anything above it. */
const capMaxFor = (key) => (key === 'inner-circle' || !inProgram(key) ? 0 : AI_CAPPED.includes(key) ? AI_CAP_BP : HARD_CAP_BP);
function productDefaults(key) {
  return {
    commissionable: key !== 'inner-circle' && key !== 'gatevoo' && inProgram(key), cap_bp: capMaxFor(key),
    cpa_cents: 0, hybrid_cpa_cents: 0, hybrid_rate_bp: 0, hold_days: 0, cpa_hold_days: 0, qualification: 'first', monthly_cap: 50,
    locked: key === 'inner-circle', payg: key === 'vooads', status: 'live',
  };
}
function productList() {
  const tools = D.all('SELECT slug, name, icon, color, status, url, visible FROM products WHERE hub=0 ORDER BY sort, id');
  const cfg = D.getSetting('aff_products', {}) || {};
  const host = (u) => { try { return new URL(u).hostname; } catch { return ''; } };
  const base = [...SPECIAL, ...tools.map((t) => ({ key: t.slug, name: t.name, icon: t.icon, color: t.color, domain: host(t.url), tool_status: t.status, url: t.url }))]
    .filter((p) => inProgram(p.key));
  return base.map((p) => {
    const c = { ...productDefaults(p.key), ...(cfg[p.key] || {}) };
    if (p.key === 'inner-circle') Object.assign(c, { commissionable: false, cap_bp: 0, locked: true, cpa_cents: 0 });
    c.cap_max_bp = capMaxFor(p.key);
    c.cap_bp = Math.max(0, Math.min(c.cap_max_bp, Number(c.cap_bp) || 0));
    if (c.qualification !== 'second') c.qualification = 'first';
    const plans = D.all('SELECT plan, price_cents, synced_at FROM aff_plans WHERE product_key=? ORDER BY price_cents', p.key);
    return { ...p, ...c, plans };
  });
}
function product(key) { return inProgram(key) ? productList().find((p) => p.key === key) || null : null; }
/** The effective RevShare cap for a product (0 when it is not commissionable or not in the program). */
function capFor(key) { if (!inProgram(key)) return 0; const p = product(key); return p && p.commissionable ? Math.min(p.cap_bp, capMaxFor(key)) : 0; }
/**
 * Suggested CPA (a hint in the back office; the owner decides every CPA amount): one month of the plan's list price,
 * rounded to $5 but never above that price (a CPA must not pay more than the customer's first payment: $299 → $295,
 * $99 → $95), at most the program CPA maximum ($300, so a $599 plan suggests $300). Pay-as-you-go products: half the
 * first purchase. Plans under $5 suggest nothing.
 */
function suggestCpa(priceCents, payg) {
  const max = settings().cpa.max_cents;
  if (!(priceCents > 0)) return 0;
  const v = payg ? Math.round(priceCents / 2) : priceCents;
  const near = Math.round(v / 500) * 500;
  const capped = near > v ? Math.floor(v / 500) * 500 : near;
  return Math.max(0, Math.min(max, capped));
}

/* ------------------------------------------------------------------ time (reporting time zone, Africa/Lagos by default) */
const T = REV._test;
const tz = () => REV.reportingTz();
const civil = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / DAY);
function monthKey(at) { return T.dayStr(T.localDay(at, tz())).slice(0, 7); }
function monthStartOf(key) { const [y, m] = key.split('-').map(Number); return T.dayStart(civil(y, m, 1), tz()); }
function addMonths(key, n) { let [y, m] = key.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${String(m).padStart(2, '0')}`; }
function monthRange(key) { return [monthStartOf(key), monthStartOf(addMonths(key, 1))]; }
function dayStartAt(at) { return T.dayStart(T.localDay(at, tz()), tz()); }
const dayKey = (at) => T.dayStr(T.localDay(at, tz()));
/** A date for people (emails, notices): "1 Nov 2026" in the reporting time zone (Africa/Lagos), like receipts (MN-9). */
const dateShort = (at) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: tz() });
/** Add business days (Mon to Fri, skipping configured public holidays). */
function addBusinessDays(at, n) {
  const hol = new Set(settings().payouts.holidays || []);
  let t = at; let left = n;
  while (left > 0) {
    t += DAY;
    const d = new Date(t + 3600_000); // Lagos is UTC+1
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || hol.has(dayKey(t))) continue;
    left--;
  }
  return t;
}
/** The request's clock. Tests may send x-vs-now (only when NODE_ENV=test) to look at the program from a later time. */
function clock(ctx) {
  if (process.env.NODE_ENV === 'test' && ctx && ctx.req && ctx.req.headers['x-vs-now']) {
    const t = Number(ctx.req.headers['x-vs-now']);
    if (Number.isFinite(t) && t > 0) return t;
  }
  return now();
}

/* ------------------------------------------------------------------ money */
const toCents = (usd) => { const v = Number(usd); return Number.isFinite(v) ? Math.round(v * 100) : 0; };
const usd = (c) => Math.round(Number(c) || 0) / 100;
const fmtUsd = (c) => (c < 0 ? '-' : '') + '$' + (Math.abs(Math.round(c)) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Commission on a base: rounded down so the program never pays a fraction of a cent too much. */
const pct = (base, bp) => Math.floor((Math.abs(base) * bp) / 10000) * Math.sign(base);
/** Parse a dollar amount typed in the admin ("$110", 110, "110.50") to cents. */
function parseUsd(v) { if (v === undefined || v === null || v === '') return null; const n = Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) && n >= 0 && n < 1e8 ? Math.round(n * 100) : null; }
/** Parse a percentage ("25%", 25) to basis points. */
function parsePct(v) { if (v === undefined || v === null || v === '') return null; const n = Number(String(v).replace(/[%\s]/g, '')); return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) : null; }

/* ------------------------------------------------------------------ identity helpers */
const keyed = (s) => hmac(D.secret(), 'aff|' + s);
/** Hash something we must compare but never store in the clear (IP, user agent, fingerprint, card hash...). */
const hashOf = (kind, v) => (v ? keyed(kind + ':' + String(v).trim().toLowerCase()).slice(0, 32) : '');
/** Stable pseudonymous customer reference, different per affiliate so references cannot be matched across accounts. */
function custRef(affiliateId, userId) {
  const h = crypto.createHmac('sha256', D.secret()).update(`custref|${affiliateId}|${userId}`).digest();
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += A[h[i] % 32];
  return 'C-' + s;
}
/** Email normalised for duplicate checks: lower case; Gmail dots and +tags removed; +tags removed everywhere. */
function normEmail(e) {
  e = String(e || '').trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at < 1) return e;
  let local = e.slice(0, at); let dom = e.slice(at + 1);
  if (dom === 'googlemail.com') dom = 'gmail.com';
  local = local.split('+')[0];
  if (dom === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${dom}`;
}
function maskEmail(e) {
  e = String(e || ''); const at = e.indexOf('@');
  if (at < 1) return e ? '•••' : '';
  return e[0] + '•••••' + e.slice(at);
}
const maskWallet = (w) => { w = String(w || ''); return w.length > 10 ? `${w.slice(0, 4)}…${w.slice(-4)}` : w; };
const vooRef = (u) => 'V-' + String(u).padStart(6, '0');

/* ------------------------------------------------------------------ audit */
function audit(actor, action, { affiliate_id = null, target = '', before = null, after = null } = {}) {
  D.insert('aff_audit', {
    actor_id: actor ? (typeof actor === 'object' ? actor.id : actor) : null, action, affiliate_id, target: String(target || '').slice(0, 300),
    before: before == null ? '' : JSON.stringify(before).slice(0, 4000), after: after == null ? '' : JSON.stringify(after).slice(0, 4000), created_at: now(),
  });
}

/* ------------------------------------------------------------------ affiliate terms */
let termsCache = null;
/** The terms markdown (docs/AFFILIATE_TERMS.md), read once. */
function termsText() {
  if (termsCache === null) { try { termsCache = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'docs', 'AFFILIATE_TERMS.md'), 'utf8'); } catch { termsCache = ''; } }
  return termsCache;
}
/** The bullet points under "## Changes in <version>" in the terms, as plain text (no markdown). */
function termsChanges(version = settings().terms_version) {
  const lines = termsText().split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp('^##\\s+Changes in ' + String(version).replace(/[.]/g, '\\.') + '\\b', 'i').test(l));
  if (start < 0) return [];
  const out = [];
  for (let i = start + 1; i < lines.length && !/^#{1,2}\s/.test(lines[i]); i++) {
    const m = /^[-*]\s+(.*)$/.exec(lines[i]);
    if (m) out.push(m[1].replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim());
  }
  return out;
}
/**
 * Where an affiliate stands with the current terms. needs_accept: they submitted an application under an older version
 * (or none). Until they accept, payout requests are refused; earning, links, reports and the dashboard keep working.
 */
function termsState(a) {
  const cur = settings().terms_version;
  const needs = !!a && !!a.applied_at && a.status !== 'closed' && a.terms_version !== cur;
  return { current: cur, date: cmpVersion(cur, TERMS.version) === 0 ? TERMS.date : '', accepted: (a && a.terms_version) || '', accepted_at: (a && a.terms_accepted_at) || null,
    needs_accept: needs, payouts_blocked: needs, changes: needs ? termsChanges(cur) : [] };
}
/** Record an acceptance of the current terms: latest on the account, every one in aff_terms_acceptances, and the audit log. */
function acceptTerms(a, source = 'update', at = now()) {
  const v = settings().terms_version;
  D.run('UPDATE aff_affiliates SET terms_version=?, terms_accepted_at=?, updated_at=? WHERE id=?', v, at, at, a.id);
  D.insert('aff_terms_acceptances', { affiliate_id: a.id, user_id: a.user_id, version: v, accepted_at: at, source });
  audit(a.user_id, 'terms.accept', { affiliate_id: a.id, target: v, before: { version: a.terms_version || '', accepted_at: a.terms_accepted_at || null }, after: { version: v, accepted_at: at, source } });
  return v;
}

/* ------------------------------------------------------------------ affiliate rows */
function hydrate(a) {
  if (!a) return null;
  for (const k of ['languages', 'decline_reasons', 'api_ips']) a[k] = json(a[k], []);
  for (const k of ['application', 'traffic', 'notif_prefs']) a[k] = json(a[k], {});
  return a;
}
const byId = (id) => hydrate(D.get('SELECT * FROM aff_affiliates WHERE id=?', Number(id)));
const byUser = (uid) => hydrate(D.get('SELECT * FROM aff_affiliates WHERE user_id=?', Number(uid)));
/** The tier the affiliate earns at: an override wins; otherwise the computed tier, never below an active floor. */
function effectiveTier(a, at = now(), list = tiers()) {
  if (a.tier_override !== null && a.tier_override !== undefined) return Math.min(a.tier_override, list.length - 1);
  let t = a.tier || 0;
  if (a.tier_floor !== null && a.tier_floor !== undefined && (a.tier_floor_until || 0) >= at) t = Math.max(t, a.tier_floor);
  // Legend needs approval: until then the affiliate earns at the tier below.
  if (list[t] && list[t].approval && !a.legend_approved) t = Math.max(0, t - 1);
  return Math.min(t, list.length - 1);
}
const isEarning = (a) => !!a && (a.status === 'approved' || a.status === 'suspended');

const PERM = { admin: 'aff_admin', manager: 'aff_manager', fraud: 'aff_fraud', finance: 'aff_finance' };

/* ------------------------------------------------------------------ one-time policy upgrade (owner update 2026-10-05) */
/**
 * Earlier versions stored the full settings object when an admin saved, so old defaults (30/60-day holds, qualification
 * after a second payment or 30 days, 45-day contest windows) would survive the upgrade. Values still equal to the old
 * defaults move to the new ones once; values an admin set on purpose are kept (a custom RevShare hold becomes the hold
 * for credits used and for orders). Commissions already on hold keep their dates; the hourly job releases them.
 */
const POLICY_V = 2;
function migratePolicy() {
  if ((D.getSetting('aff_policy_v', 0) || 0) >= POLICY_V) return false;
  const st = D.getSetting('aff', null);
  if (st && typeof st === 'object') {
    const h = st.holds && typeof st.holds === 'object' ? st.holds : null;
    if (h) {
      const old = { revshare_days: 30, cpa_days: 30, cpa_long_days: 60, cpa_new_days: 60 };
      if ('revshare_days' in h) {
        const v = Number(h.revshare_days);
        if (v !== old.revshare_days && v > 0) { if (!('spend_days' in h)) h.spend_days = v; if (!('order_days' in h)) h.order_days = v; if (!('card_order_days' in h)) h.card_order_days = v; }
        delete h.revshare_days;
      }
      for (const k of ['cpa_days', 'cpa_long_days', 'cpa_new_days']) if (Number(h[k]) === old[k]) h[k] = 0;
    }
    if (st.qualification && typeof st.qualification === 'object') { delete st.qualification.active_days; st.qualification.rule = 'first_payment'; }
    D.setSetting('aff', st);
  }
  const prods = D.getSetting('aff_products', null);
  if (prods && typeof prods === 'object') {
    for (const k of Object.keys(prods)) {
      const p = prods[k]; if (!p || typeof p !== 'object') continue;
      if (Number(p.hold_days) === 30) p.hold_days = 0;
      if (Number(p.cpa_hold_days) === 30) p.cpa_hold_days = 0;
      if (p.qualification === 'second_or_30d') p.qualification = 'first';
    }
    D.setSetting('aff_products', prods);
  }
  // Contests still running or awaiting results: scores are final at the contest end (old default window was 45 days).
  try { D.run('UPDATE aff_contests SET qual_days=0 WHERE signoff_at IS NULL AND cancelled=0 AND qual_days=45'); } catch { /* table shape from an older build */ }
  D.setSetting('aff_policy_v', POLICY_V);
  return true;
}
migratePolicy();

module.exports = {
  migratePolicy, TERMS, cmpVersion, termsText, termsChanges, termsState, acceptTerms,
  DAY, HOUR, DEFAULTS, TIER_DEFAULTS, settings, merge, tiers, tierName, productList, product, productDefaults, capFor, suggestCpa, SPECIAL,
  NOT_IN_PROGRAM, inProgram, AI_CAPPED, HARD_CAP_BP, AI_CAP_BP, capMaxFor,
  monthKey, monthStartOf, addMonths, monthRange, dayStartAt, dayKey, dateShort, addBusinessDays, clock, tz,
  toCents, usd, fmtUsd, pct, parseUsd, parsePct, hashOf, custRef, normEmail, maskEmail, maskWallet, vooRef, keyed,
  audit, hydrate, byId, byUser, effectiveTier, isEarning, PERM, addCol, clean, fail, json,
  normTiers, tiersAt, capAt, tierAt, logRateChange,
};
