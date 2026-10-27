'use strict';
/*
 * One place that tells an affiliate something happened: in-app notification (+ live update on `user:<id>`), email
 * (src/emails templates aff_*), Telegram alert (src/aff/telegram.js, per-type preferences) and server postbacks
 * (src/aff/postbacks.js). No customer PII is ever included: customers appear as their pseudonymous reference.
 */
const config = require('../config');
const D = require('../db');
const C = require('./core');
const mailer = require('../mailer');
const { now, publish } = require('../util');

const lazy = (m) => () => require(m);
const TG = lazy('./telegram');
const PB = lazy('./postbacks');

/* Telegram alert types and their defaults (spec 4.9). Types not listed always send (connected, approved, paused...). */
const TG_TYPES = {
  signup: false, first_payment: true, qualified: true, cpa: true, refunds: true, tier: true, payouts: true, contest_rank: false,
  announcements: true, earnings: true, deals: true, health: true, daily: true, weekly: true,
};
const TG_KIND = {
  signup: 'signup', first_payment: 'first_payment', payment: null, qualified: 'qualified', cpa_approved: 'cpa', cpa_declined: 'cpa', cpa_pending: null,
  refund: 'refunds', chargeback: 'refunds', tier_change: 'tier', tier_up: 'tier', tier_down: 'tier', payout_requested: 'payouts', payout_paid: 'payouts', payout_rejected: 'payouts',
  earnings_available: 'earnings', contest_rank: 'contest_rank', contest_won: 'contest_rank', contest_started: 'announcements', announcement: 'announcements',
  deal_change: 'deals', special_deal: 'deals', health_warning: 'health', health_paused: 'health', grace: 'tier', quality: 'tier',
  approved: 'always', rejected: 'always', info_request: 'always', account_paused: 'always', connected: 'always',
};
const CATEGORY = {
  signup: 'Customers', first_payment: 'Money', payment: 'Money', qualified: 'Customers', cpa_pending: 'Deals', cpa_approved: 'Deals', cpa_declined: 'Deals',
  refund: 'Customers', chargeback: 'Customers', tier_change: 'Money', tier_up: 'Money', tier_down: 'Money', payout_requested: 'Money', payout_paid: 'Money', payout_rejected: 'Money',
  earnings_available: 'Money', contest_rank: 'Contests', contest_won: 'Contests', contest_started: 'Contests', announcement: 'Announcements', deal_change: 'Deals', special_deal: 'Deals',
  health_warning: 'Money', health_paused: 'Money', approved: 'Announcements', rejected: 'Announcements', info_request: 'Announcements', account_paused: 'Announcements',
  grace: 'Money', quality: 'Money',
};
const EMAIL = {
  applied: 'aff_application_received', approved: 'aff_application_approved', rejected: 'aff_application_rejected', cpa_approved: 'aff_cpa_approved',
  cpa_declined: 'aff_cpa_declined', payout_requested: 'aff_payout_requested', payout_paid: 'aff_payout_paid', payout_rejected: 'aff_payout_rejected',
  health_warning: 'aff_health_warning', health_paused: 'aff_health_paused', tier_up: 'aff_tier_up', contest_won: 'aff_contest_won', info_request: 'aff_info_requested', special_deal: 'aff_custom_deal',
};

const affUrl = (hash = '') => `${config.baseUrl}/affiliates${hash ? '#/aff/' + hash : ''}`;

function inApp(a, kind, text, extra = {}) {
  const id = D.insert('aff_notifications', { affiliate_id: a.id, category: CATEGORY[kind] || 'Announcements', kind, text: String(text).slice(0, 500), product_key: extra.product_key || '', link: extra.link || '', created_at: now() }).id;
  publish('user:' + a.user_id, 'aff', { kind, id, text });
  return id;
}

/**
 * Tell affiliate `a` about `kind`. o: { text (in-app/Telegram), tg (Telegram text if different), email (vars), conversion, postback (event name),
 * product_key, link, noApp }.
 */
function emit(a, kind, o = {}) {
  if (!a) return;
  try {
    if (!o.noApp && o.text) inApp(a, kind, o.text, o);
    const tgKind = TG_KIND[kind];
    if (tgKind && (o.tg || o.text)) TG().alert(a, tgKind === 'always' ? null : tgKind, o.tg || o.text);
    if (EMAIL[kind] && o.email) {
      const user = D.get('SELECT * FROM users WHERE id=?', a.user_id);
      if (user && !user.banned) mailer.queue(user, EMAIL[kind], { affiliates_url: affUrl(), ...o.email });
    }
    if (o.postback) PB().enqueue(a, o.postback, o.conversion || null, o.pbVars || {});
  } catch (e) { console.error('[aff notify]', kind, e.message); }
}

module.exports = { emit, inApp, TG_TYPES, TG_KIND, CATEGORY, EMAIL, affUrl };
