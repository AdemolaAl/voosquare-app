'use strict';
/*
 * Affiliate commission engine.
 *
 * Inputs (all idempotent, keyed by the source: conversions.source_key and commissions.uniq_key are UNIQUE):
 *  - VooSquare orders when they turn paid (Premium, paid rooms; Inner Circle is 0%) and when they are refunded/charged back.
 *  - Tool events: `spend` (commissionable consumption), `refund`, `chargeback`, `plan_started`, `plan_renewed` (plan and price
 *    sync, not commissionable on their own) and `wallet_topup` (never commissionable).
 *
 * Commission flow (owner update 2026-10-05: earnings are instant, used credits are non-refundable):
 *  RevShare: each counted payment by a referred customer, at min(tier rate, product cap) on the payment date. It is
 *  `available` at once unless admin set a hold for that source (settings.holds: spend_days for credits used,
 *  order_days / card_order_days for VooSquare orders, all 0 by default; a product's hold_days can only lengthen it).
 *  Before the affiliate's 5th qualified customer it waits as `pending_activation`.
 *  Qualification: the customer's first counted payment (a product may require a second payment instead).
 *  CPA/Hybrid: created `in_review` when the customer qualifies on a product with an active deal (one model per customer,
 *  fixed at qualification); a reviewer approves (available at once unless a CPA hold is set) or declines with a reason.
 *  Refunds: a tool `refund` never reverses commission, whatever it refunds: used credits, a plan payment or renewal, an
 *  overage or a one-time purchase (owner decision 2026-10-05; credits that were used are non-refundable, unused wallet
 *  top-ups never earned any). An admin refund of a VooSquare order (Premium, paid rooms) reverses that order's commission.
 *  Chargebacks (card disputes) always reverse; proven fraud is reversed through a two-person fraud reversal.
 *  Reversals of held amounts cancel them; released amounts get a negative `clawback` row, which can take the balance
 *  below zero (shown as owed and deducted from the next payout).
 *  Sub-affiliates: when a sub's commission becomes available, the parent gets 2.5% (5% when boosted) as `sub_override`.
 *
 * Statuses: pending_activation, hold, available, in_review, declined, reversed, paid (set when the payout is paid).
 */
const D = require('../db');
const C = require('./core');
const F = require('./fraud');
const N = require('./notify');
const { now } = require('../util');

const DAY = C.DAY;
C.addCol('aff_affiliates', 'tier_month', "TEXT DEFAULT ''");
C.addCol('aff_affiliates', 'health_count', 'INTEGER DEFAULT 0');
C.addCol('aff_conversions', 'reversed_cents', 'INTEGER DEFAULT 0');

const DECLINE = {
  refund_in_hold: 'The customer refunded during the hold.', chargeback: 'The payment was charged back.', not_new_customer: 'The customer had paid Zedapex before.',
  self_referral: 'The customer is linked to your own account or household.', duplicate_account: 'The customer has another Voo ID that already paid.',
  traffic_source_not_approved: 'The traffic came from a source not approved on your CPA deal.', geo_not_approved: 'The customer is in a country not covered by your CPA deal.',
  incentivised: 'The sign-up appears to be rewarded or paid for.', fraud_signals: 'Our checks found signs of fake or linked sign-ups. Your manager can share what is allowed.',
  payment_instrument_shared: 'The payment method is shared with other referred customers.', coupon_abuse: 'A coupon was used outside its terms.',
  brand_bidding: 'The click came from paid search on our brand terms.', over_cap: 'Over your monthly CPA cap. This customer pays you RevShare instead.',
  not_qualified: 'The customer did not reach the qualification rule in time.', terms_breach: 'Traffic broke the affiliate terms. See the note from your manager.',
  fraud: 'Reversed after a proven fraud finding. See the note from our team.',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateTxt = (t) => { const k = C.dayKey(t); return `${Number(k.slice(8, 10))} ${MONTHS[Number(k.slice(5, 7)) - 1]}`; };
const monthName = (key) => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(key.slice(5, 7)) - 1];
const prodName = (key, plan) => { const p = C.product(key); return (p ? p.name : key) + (plan ? ' ' + plan : ''); };

/* ------------------------------------------------------------------ lookups */
const attribution = (userId) => D.get('SELECT * FROM aff_attributions WHERE customer_user_id=?', userId);
const customer = (userId) => D.get('SELECT * FROM aff_customers WHERE user_id=?', userId);
function activeDeal(affId, productKey, plan, at = now()) {
  return D.get(`SELECT * FROM aff_deals WHERE affiliate_id=? AND product_key=? AND status='active' AND model IN ('cpa','hybrid')
    AND COALESCE(starts_at,0)<=? AND (ends_at IS NULL OR ends_at=0 OR ends_at>?) AND (plan='' OR plan=?) ORDER BY (plan<>'') DESC, id DESC LIMIT 1`, affId, productKey, at, at, plan || '');
}
/**
 * The owner's custom RevShare deal that covers this payment (model 'revshare'; product_key '*' = every product), or null.
 * Only payments dated inside the deal window count; outside it the normal tier rate and product cap apply again.
 * The window alone decides (money audit MN-2): a deal the hourly job already marked `ended` still covers a payment dated
 * inside its window and reported later; a deal ended early by staff ends at the time it was ended (its ends_at was set
 * then; an ended row without one ends at its last update).
 */
function revshareDeal(affId, productKey, at = now()) {
  return D.get(`SELECT * FROM aff_deals WHERE affiliate_id=? AND model='revshare' AND status IN ('active','ended') AND (product_key=? OR product_key='*')
    AND COALESCE(starts_at,0)<=?
    AND ((status='active' AND (ends_at IS NULL OR ends_at=0 OR ends_at>?)) OR (status='ended' AND COALESCE(NULLIF(ends_at,0), updated_at, 0)>?))
    ORDER BY rate_bp DESC, (product_key<>'*') DESC, id DESC LIMIT 1`, affId, productKey, at, at, at);
}
/** The CPA amount a deal paid on `at`: a reduction applied later does not touch customers who qualified before it. */
function cpaAt(deal, at) {
  const ch = D.get("SELECT old_value FROM aff_offer_changes WHERE deal_id=? AND field='cpa' AND direction IN ('increase','reduction') AND applied_at IS NOT NULL AND effective_at>? ORDER BY effective_at, id LIMIT 1", deal.id, at);
  const v = ch ? Number(ch.old_value) : NaN;
  return Number.isFinite(v) && v > 0 ? v : deal.cpa_cents;
}
/** Tool clock skew allowed on a payment date (the Events API clamps occurred_at more than 10 minutes ahead). */
const SKEW_MS = 10 * 60_000;
/**
 * The one payment date used everywhere (money audit MN-1, MN-10): the tool's occurred_at (events.created_at, already
 * clamped by the Events API, the same time revenue analytics and the member referral ledger use) or the order's paid_at,
 * never more than the allowed skew after it was received. It decides approval (before it: member rules), the month and
 * qualification.
 */
function paymentDate(occurred, received) {
  const at = Number(occurred) || Number(received) || now();
  return received && at > received + SKEW_MS ? received : at;
}
/**
 * The date whose rates apply (tier, tier rates, cap): the payment date, but never before the customer
 * was attributed to the affiliate, so a backdated payment cannot reach rates from before the click.
 */
const rateDate = (at, attr) => Math.max(at, (attr && (attr.locked_at || attr.click_at)) || 0);
// (Custom deal windows use the payment's own date: only payments dated inside the window get the deal rate.)
/** The rate a custom deal pays on a product: a Special deal (above 50%) overrides the cap; a normal one stays within it. */
function dealRate(deal, cap) { return deal.rate_bp > C.HARD_CAP_BP ? deal.rate_bp : Math.min(deal.rate_bp, cap); }
function qualifiedCount(affId, from = 0, to = 9e15) {
  return D.get('SELECT COUNT(*) n FROM aff_customers c JOIN aff_attributions t ON t.customer_user_id=c.user_id WHERE c.affiliate_id=? AND t.blocked=\'\' AND c.qualified_at>=? AND c.qualified_at<?', affId, from, to).n;
}
function refundRate(affId, from, to) {
  const r = D.get('SELECT COUNT(*) n, COUNT(CASE WHEN refunds>0 OR chargebacks>0 THEN 1 END) bad FROM aff_customers WHERE affiliate_id=? AND first_payment_at>=? AND first_payment_at<?', affId, from, to);
  return { customers: r.n, bad: r.bad, rate_bp: r.n ? Math.round((10000 * r.bad) / r.n) : 0 };
}
const holdDays = () => C.settings().holds;
/** Payment method types whose payments can be disputed by the payer (card chargebacks). Gatevoo, crypto and manual cannot. */
const CARD_METHODS = ['paystack', 'flutterwave', 'stripe', 'custom'];
/** Hold days for a counted payment: by source (credits used, VooSquare order, card-paid order), lengthened by a product hold. */
function paymentHoldDays(p) {
  const h = holdDays();
  const prod = Math.max(0, Number((C.product(p.product_key) || {}).hold_days) || 0);
  const src = p.source === 'order' ? (p.card ? h.card_order_days : h.order_days) : h.spend_days;
  return Math.max(prod, Math.max(0, Number(src) || 0));
}

/* ------------------------------------------------------------------ commissions */
function addCommission(o) {
  const t = now();
  // earned_at (migration 007): the date the line belongs to in reports and statements (payment date, approval date,
  // reversal date); defaults to now for adjustments and prizes.
  const row = { status: 'hold', base_cents: 0, rate_bp: 0, product_key: '', reason: '', note: '', provisional: 0, deal_id: null, special_bp: 0, created_at: t, updated_at: t, earned_at: t, ...o };
  const r = D.run(`INSERT OR IGNORE INTO aff_commissions(affiliate_id,type,amount_cents,base_cents,rate_bp,product_key,customer_user_id,conversion_id,source_commission_id,hold_until,status,reason,note,provisional,approved_by,uniq_key,created_at,released_at,updated_at,deal_id,special_bp,earned_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, row.affiliate_id, row.type, row.amount_cents, row.base_cents, row.rate_bp, row.product_key, row.customer_user_id || null,
  row.conversion_id || null, row.source_commission_id || null, row.hold_until || 0, row.status, row.reason, row.note, row.provisional, row.approved_by || null, row.uniq_key || null,
  row.created_at, row.status === 'available' ? t : null, row.updated_at, row.deal_id || null, row.special_bp || 0, row.earned_at || t);
  return r.changes ? D.get('SELECT * FROM aff_commissions WHERE id=?', r.id) : null;
}
/**
 * Reverse (part of) a commission: held amounts are cancelled or reduced, released ones get a negative clawback row.
 * `fraction` applies to what is left of the commission (its amount minus earlier clawbacks), so repeated or partial
 * reversals of the same commission never take back more than it paid.
 */
function reverseCommission(c, fraction, reason, key, at = now(), approvedBy = null, note = '') {
  if (!c || c.amount_cents <= 0) return 0;
  const clawed = ['available', 'paid'].includes(c.status) ? -D.get("SELECT COALESCE(SUM(amount_cents),0) s FROM aff_commissions WHERE source_commission_id=? AND type='clawback'", c.id).s : 0;
  const left = c.amount_cents - Math.max(0, clawed);
  const part = fraction >= 1 ? left : Math.floor(left * fraction + 1e-9);
  if (part <= 0) return 0;
  let done = 0;
  if (['hold', 'pending_activation', 'in_review'].includes(c.status)) {
    if (part >= c.amount_cents) D.run("UPDATE aff_commissions SET status=?, reason=?, updated_at=? WHERE id=?", c.status === 'in_review' ? 'declined' : 'reversed', reason, at, c.id);
    else D.run('UPDATE aff_commissions SET amount_cents=amount_cents-?, note=?, updated_at=? WHERE id=?', part, `Reduced by ${C.fmtUsd(part)}: ${reason}`, at, c.id);
    if (note && part >= c.amount_cents) D.run('UPDATE aff_commissions SET note=? WHERE id=?', note, c.id);
    done = part;
  } else if (['available', 'paid'].includes(c.status)) {
    const cb = addCommission({ affiliate_id: c.affiliate_id, type: 'clawback', amount_cents: -part, base_cents: c.base_cents, rate_bp: c.rate_bp, product_key: c.product_key,
      customer_user_id: c.customer_user_id, conversion_id: c.conversion_id, source_commission_id: c.id, status: 'available', reason, note, approved_by: approvedBy, uniq_key: `clawback:${key}:${c.id}`, earned_at: at });
    if (cb) done = part;
  }
  // The parent's sub-affiliate override follows its source.
  for (const o of D.all("SELECT * FROM aff_commissions WHERE source_commission_id=? AND type='sub_override'", c.id)) reverseCommission(o, fraction, reason, key, at, approvedBy, note);
  return done;
}

/* ------------------------------------------------------------------ payments */
/**
 * A counted payment by a customer. p: { key, source, source_id, user_id, product_key, plan, amount_cents, occurred_at, received_at, country }.
 * Returns the conversion or null (not attributed, duplicate key, or nothing to do).
 */
function processPayment(p) {
  // Products outside the affiliate program (Affleego) are ignored entirely: no conversion, customer, qualification or commission.
  if (!C.inProgram(p.product_key)) return null;
  const attr = attribution(p.user_id);
  if (!attr || !(p.amount_cents > 0)) return null;
  const a = C.byId(attr.affiliate_id);
  if (!a) return null;
  const received = p.received_at || now();
  const at = paymentDate(p.occurred_at, received);
  const rAt = rateDate(at, attr);
  let conv = null; let cust = null; let commission = null;
  D.tx(() => {
    cust = customer(p.user_id);
    const first = !cust || !cust.first_payment_at;
    const r = D.run(`INSERT OR IGNORE INTO aff_conversions(affiliate_id,customer_user_id,product_key,plan,event_type,amount_cents,source,source_id,source_key,status,payment_no,country,occurred_at,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, a.id, p.user_id, p.product_key, p.plan || '', first ? 'first_payment' : 'repeat_payment', p.amount_cents, p.source, p.source_id || null, p.key, 'tracked',
    (cust ? cust.payments : 0) + 1, p.country || attr.country || '', at, received);
    if (!r.changes) return;
    conv = D.get('SELECT * FROM aff_conversions WHERE id=?', r.id);
    if (!cust) {
      D.run('INSERT INTO aff_customers(user_id,affiliate_id,first_payment_at,first_product,first_plan,first_amount_cents,payments,total_cents,last_payment_at,paid_before) VALUES(?,?,?,?,?,?,1,?,?,?)',
        p.user_id, a.id, at, p.product_key, p.plan || '', p.amount_cents, p.amount_cents, at, F.paidBefore(p.user_id, attr.locked_at || 0) ? 1 : 0);
    } else if (first) {
      D.run('UPDATE aff_customers SET first_payment_at=?, first_product=?, first_plan=?, first_amount_cents=?, payments=payments+1, total_cents=total_cents+?, last_payment_at=? WHERE user_id=?', at, p.product_key, p.plan || '', p.amount_cents, p.amount_cents, at, p.user_id);
    } else {
      D.run('UPDATE aff_customers SET payments=payments+1, total_cents=total_cents+?, last_payment_at=MAX(COALESCE(last_payment_at,0),?) WHERE user_id=?', p.amount_cents, at, p.user_id);
    }
    cust = customer(p.user_id);
    const why = revshareBlocker(a, attr, cust, p, at);
    if (why) { D.run('UPDATE aff_conversions SET status=?, note=? WHERE id=?', why.status, why.note, conv.id); return; }
    // Rate: the model fixed at qualification, else the tier rate on the payment date, limited by the product cap. Tier,
    // tier rates and cap are the ones in force on the payment date, not today's (a late report keeps its date's rate).
    const cap = C.capAt(p.product_key, rAt);
    const T = C.tiersAt(rAt);
    let rate = T[C.tierAt(a, rAt)].rate_bp;
    let provisional = 0;
    if (cust.model === 'hybrid') { const deal = activeDeal(a.id, p.product_key, p.plan, at) || activeDeal(a.id, cust.first_product, cust.first_plan, at); rate = deal ? deal.rate_bp : rate; }
    else if (!cust.model && !a.cpa_paused && activeDeal(a.id, p.product_key, p.plan, at)) provisional = 1;
    rate = Math.min(rate, cap);
    // Owner's custom RevShare deal (never lowers the rate; a Hybrid customer keeps the Hybrid deal's rate).
    let dealId = null; let specialBp = 0;
    if (cust.model !== 'hybrid') {
      // Deal window: the payment's own date (a payment dated before the window never gets the deal rate).
      const rd = revshareDeal(a.id, p.product_key, at);
      if (rd && dealRate(rd, cap) > rate) { rate = dealRate(rd, cap); dealId = rd.id; specialBp = rd.rate_bp > C.HARD_CAP_BP ? rd.rate_bp : 0; }
    }
    const amount = C.pct(p.amount_cents, rate);
    if (amount <= 0) { D.run("UPDATE aff_conversions SET status='no_commission' WHERE id=?", conv.id); return; }
    const hd = paymentHoldDays(p);
    // Created as `hold` and released right below when no hold applies, so a CPA decision at qualification (same request)
    // can still replace provisional RevShare without a clawback row.
    commission = addCommission({ affiliate_id: a.id, type: 'revshare', amount_cents: amount, base_cents: p.amount_cents, rate_bp: rate, product_key: p.product_key,
      customer_user_id: p.user_id, conversion_id: conv.id, hold_until: received + hd * DAY, status: a.activated_at ? 'hold' : 'pending_activation', provisional, uniq_key: 'rs:' + p.key, deal_id: dealId, special_bp: specialBp, earned_at: at });
    D.run("UPDATE aff_conversions SET status='commission' WHERE id=?", conv.id);
    // No CPA decision can replace it and no hold applies: available in the same transaction (never seen as "on hold").
    if (commission && commission.status === 'hold' && !provisional && commission.hold_until <= now()) release(commission, now());
  });
  if (!conv) return null;
  // The first counted payment qualifies the customer (or the second, where a product asks for it).
  maybeQualify(p.user_id, at);
  if (commission) { const c = D.get('SELECT * FROM aff_commissions WHERE id=?', commission.id); if (c && c.status === 'hold' && c.hold_until <= now()) release(c, now()); commission = D.get('SELECT * FROM aff_commissions WHERE id=?', commission.id); }
  const ref = attr.cust_ref;
  const label = prodName(p.product_key, p.plan);
  if (conv.event_type === 'first_payment') {
    const comTxt = !commission ? '' : commission.status === 'available' ? ` · commission ${C.fmtUsd(commission.amount_cents)} available now`
      : commission.status === 'hold' ? ` · commission ${C.fmtUsd(commission.amount_cents)} on hold until ${dateTxt(commission.hold_until)}`
        : commission.status === 'pending_activation' ? ` · commission ${C.fmtUsd(commission.amount_cents)} waiting for activation` : '';
    N.emit(a, 'first_payment', { text: `First payment · ${label} ${C.fmtUsd(p.amount_cents)} · ${ref}${attr.sub1 ? ' · sub1 ' + attr.sub1 : ''}${comTxt}`, product_key: p.product_key, postback: 'first_payment', conversion: conv, pbVars: { commission_cents: commission && !['reversed', 'declined'].includes(commission.status) ? commission.amount_cents : 0 } });
  }
  const pbCents = commission && !['reversed', 'declined'].includes(commission.status) ? commission.amount_cents : 0;
  N.emit(a, 'payment', { postback: 'payment', conversion: conv, pbVars: { commission_cents: pbCents } });
  if (conv.event_type === 'repeat_payment') N.emit(a, 'payment', { postback: 'repeat_payment', conversion: conv, pbVars: { commission_cents: pbCents } });
  return conv;
}
/** Why a payment earns no RevShare (or null when it does). */
function revshareBlocker(a, attr, cust, p, at) {
  if (attr.blocked) return { status: 'blocked', note: attr.blocked };
  if (!C.capAt(p.product_key, at)) return { status: 'not_commissionable', note: 'Excluded product' };
  if (!C.isEarning(a) || !a.approved_at || at < a.approved_at) return { status: 'pre_approval', note: 'Before approval: tracked, not earning' };
  const u = D.get('SELECT banned FROM users WHERE id=?', p.user_id);
  if (u && u.banned) return { status: 'excluded', note: 'Customer banned' };
  if (cust.model === 'cpa') return { status: 'cpa_model', note: 'This customer pays CPA' };
  if (cust.model === 'none') return { status: 'not_commissionable', note: 'CPA declined for this customer' };
  if (a.health_state === 'paused' && !a.health_exempt && cust.first_payment_at < (a.health_since || 0)) return { status: 'health_paused', note: 'Lifetime RevShare paused (health)' };
  return null;
}

/**
 * Refund or chargeback against an earlier payment. r: { key, original_key, user_id, product_key, amount_cents, kind, occurred_at, source }.
 * A tool `refund` (source 'event') never reverses commission, also when it refunds a plan payment (owner, 2026-10-05):
 * credits that were used are non-refundable, and unused wallet top-ups never earned commission. It is recorded as
 * `refund_final` / `no_clawback` for the conversion log. Order refunds (admin) and every
 * chargeback reverse what they touch.
 */
function processReversal(r) {
  if (r.product_key && !C.inProgram(r.product_key)) return null;
  if (r.kind === 'refund' && r.source === 'event') return recordFinalRefund(r);
  let orig = r.original_key ? D.get('SELECT * FROM aff_conversions WHERE source_key=?', r.original_key) : null;
  if (!orig && r.user_id) {
    orig = D.get(`SELECT * FROM aff_conversions WHERE customer_user_id=? AND event_type IN ('first_payment','repeat_payment') ${r.product_key ? 'AND product_key=?' : ''} ORDER BY occurred_at DESC LIMIT 1`, ...[r.user_id, ...(r.product_key ? [r.product_key] : [])]);
  }
  if (!orig) return null;
  const a = C.byId(orig.affiliate_id);
  const at = r.occurred_at || now();
  // Only what has not been refunded or charged back yet can be reversed (duplicate or partial chargebacks).
  const before = D.get("SELECT COALESCE(SUM(amount_cents),0) s FROM aff_conversions WHERE related_id=? AND event_type IN ('refund','chargeback') AND status<>'no_clawback'", orig.id).s;
  const remaining = Math.max(0, orig.amount_cents - before);
  const amount = Math.min(r.amount_cents > 0 ? r.amount_cents : remaining, remaining);
  let conv = null; let reversed = 0;
  D.tx(() => {
    const ins = D.run(`INSERT OR IGNORE INTO aff_conversions(affiliate_id,customer_user_id,product_key,plan,event_type,amount_cents,source,source_id,source_key,status,related_id,occurred_at,received_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, orig.affiliate_id, orig.customer_user_id, orig.product_key, orig.plan, r.kind, amount, r.source || 'event', r.source_id || null, r.key, 'reversed', orig.id, at, now());
    if (!ins.changes) return;
    conv = D.get('SELECT * FROM aff_conversions WHERE id=?', ins.id);
    D.run(`UPDATE aff_customers SET refunded_cents=refunded_cents+?, ${r.kind === 'chargeback' ? 'chargebacks=chargebacks+1' : 'refunds=refunds+1'}, first_refund_at=COALESCE(first_refund_at,?) WHERE user_id=?`, amount, at, orig.customer_user_id);
    // A share of what is left: remaining commission × (this amount / payment not yet reversed).
    const fraction = remaining > 0 ? amount / remaining : 0;
    if (fraction > 0) for (const c of D.all("SELECT * FROM aff_commissions WHERE conversion_id=? AND type IN ('revshare') ORDER BY id", orig.id)) reversed += reverseCommission(c, fraction, r.kind, conv.id, at);
    // An approved or pending CPA is reversed when the customer refunds or charges back within the clawback window after qualifying.
    const cust = customer(orig.customer_user_id);
    if (cust && cust.qualified_at && ['cpa', 'hybrid'].includes(cust.model) && at - cust.qualified_at <= C.settings().cpa.clawback_days * DAY) {
      for (const c of D.all("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type IN ('cpa','hybrid_cpa') AND status NOT IN ('declined','reversed')", orig.customer_user_id)) {
        if (c.status === 'in_review') {
          D.run("UPDATE aff_cpa_reviews SET status='declined', decline_reason=?, decided_at=?, note='Automatic: refund or chargeback' WHERE commission_id=? AND status='pending'", r.kind === 'chargeback' ? 'chargeback' : 'refund_in_hold', at, c.id);
          D.run("UPDATE aff_conversions SET status='declined' WHERE id=?", c.conversion_id);
        }
        reversed += reverseCommission(c, 1, r.kind === 'chargeback' ? 'chargeback' : 'refund_in_hold', conv.id, at);
      }
    }
    D.run('UPDATE aff_conversions SET note=?, reversed_cents=? WHERE id=?', `Commission reversed: ${C.fmtUsd(reversed)}`, reversed, conv.id);
  });
  if (!conv) return null;
  const attr = attribution(orig.customer_user_id);
  N.emit(a, r.kind, { text: `${r.kind === 'chargeback' ? 'Chargeback' : 'Refund'} · ${prodName(orig.product_key, orig.plan)} ${C.fmtUsd(amount)} · ${attr ? attr.cust_ref : ''}. Commission of ${C.fmtUsd(reversed)} reversed.`, product_key: orig.product_key, postback: r.kind, conversion: conv, pbVars: { commission_cents: -reversed } });
  return { conversion: conv, reversed_cents: reversed };
}

/** A tool refund: logged as `refund_final` (no effect on revenue, refund rate or qualification); commission stays. */
function recordFinalRefund(r) {
  if (r.product_key && !C.inProgram(r.product_key)) return null;
  const attr = r.user_id ? attribution(r.user_id) : null;
  if (!attr) return null;
  const orig = r.original_key ? D.get('SELECT * FROM aff_conversions WHERE source_key=?', r.original_key) : null;
  const ins = D.run(`INSERT OR IGNORE INTO aff_conversions(affiliate_id,customer_user_id,product_key,plan,event_type,amount_cents,source,source_id,source_key,status,related_id,note,occurred_at,received_at)
    VALUES(?,?,?,?,'refund_final',?,?,?,?,'no_clawback',?,?,?,?)`, attr.affiliate_id, r.user_id, r.product_key || (orig ? orig.product_key : ''), (orig && orig.plan) || r.plan || '', Math.max(0, r.amount_cents || 0),
  r.source || 'event', r.source_id || null, r.key, orig ? orig.id : null, (orig && orig.plan) || r.plan ? 'Tool refund of a plan payment: commission is final (tool refunds never reverse commission).' : 'Used credits are non-refundable: commission is final.', r.occurred_at || now(), now());
  if (!ins.changes) return null;
  return { conversion: D.get('SELECT * FROM aff_conversions WHERE id=?', ins.id), reversed_cents: 0, final: true };
}

/* ------------------------------------------------------------------ qualification and CPA */
/** A customer qualifies at the first counted payment that was not reversed (or the second, where the product asks for it). */
function maybeQualify(userId, at) {
  const cust = customer(userId);
  if (!cust || cust.qualified_at) return false;
  const u = D.get('SELECT banned FROM users WHERE id=?', userId);
  if (u && u.banned) return false;
  // Counted payments that were not fully reversed (a tool refund on used credits reverses nothing).
  const rows = D.all(`SELECT c.id, c.product_key, c.plan, c.amount_cents, c.occurred_at, COALESCE((SELECT SUM(r.amount_cents) FROM aff_conversions r WHERE r.related_id=c.id AND r.event_type IN ('refund','chargeback') AND r.status<>'no_clawback'),0) back
    FROM aff_conversions c WHERE c.customer_user_id=? AND c.event_type IN ('first_payment','repeat_payment') ORDER BY c.occurred_at, c.id`, userId);
  // Payments on products outside the program (Affleego, from before it left) and on excluded products (Inner Circle,
  // Gatevoo while it is not commissionable: cap 0 on the payment date) never qualify anyone (spec 2.2 "Qualifies at:
  // Excluded / n/a", money audit MN-3). A customer who bought only those is not a qualified FTD: no activation, tier,
  // fast lane, health, contest or sub-affiliate count.
  const good = rows.filter((x) => x.back < x.amount_cents && C.inProgram(x.product_key) && C.capAt(x.product_key, x.occurred_at) > 0);
  if (!good.length) return false;
  const p = C.product(good[0].product_key);
  const need = p && p.qualification === 'second' ? 2 : 1;
  if (good.length < need) return false;
  const q = good[need - 1];
  // The qualifying product is the first counted payment on a qualifying product (not an excluded product bought first).
  qualify(userId, need === 2 ? 'second_payment' : 'first_payment', Math.max(q.occurred_at, cust.first_payment_at || 0), { product_key: good[0].product_key, plan: good[0].plan || '', amount_cents: good[0].amount_cents });
  return true;
}
/** Catch-up (hourly job): customers with a counted payment who are not qualified yet (missed hooks, rows from before the upgrade). */
function qualifyPending() {
  const list = D.all('SELECT c.user_id FROM aff_customers c JOIN users u ON u.id=c.user_id WHERE c.qualified_at IS NULL AND c.first_payment_at IS NOT NULL AND u.banned=0 LIMIT 5000');
  let n = 0;
  for (const c of list) if (maybeQualify(c.user_id)) n++;
  return n;
}
function qualify(userId, rule, qat, qp = null) {
  const cust = customer(userId);
  // The qualifying payment (maybeQualify): its product decides the CPA deal, cap and contest points, which can differ from
  // the first product when the first purchase was on an excluded product (Inner Circle, Gatevoo off).
  const Q = cust && qp && qp.product_key ? { ...cust, first_product: qp.product_key, first_plan: qp.plan || '', first_amount_cents: qp.amount_cents || 0 } : cust;
  const attr = attribution(userId);
  if (!cust || cust.qualified_at || !attr) return;
  const a = C.byId(cust.affiliate_id);
  if (!a) return;
  let conv = null; let review = null; let declinedOverCap = false;
  D.tx(() => {
    if (!D.run('UPDATE aff_customers SET qualified_at=?, qualify_rule=? WHERE user_id=? AND qualified_at IS NULL', qat, rule, userId).changes) return;
    const ins = D.run(`INSERT OR IGNORE INTO aff_conversions(affiliate_id,customer_user_id,product_key,plan,event_type,amount_cents,source,source_key,status,occurred_at,received_at)
      VALUES(?,?,?,?,'qualified',?,?,?,?,?,?)`, a.id, userId, Q.first_product, Q.first_plan, Q.first_amount_cents, 'system', 'qual:' + userId, attr.blocked ? 'blocked' : 'qualified', qat, now());
    conv = D.get('SELECT * FROM aff_conversions WHERE id=?', ins.id);
    // One model per customer, fixed now by the deal active at qualification.
    const deal = !attr.blocked && C.isEarning(a) && a.approved_at && qat >= a.approved_at && !a.cpa_paused && !(a.health_state === 'paused' && !a.health_exempt && C.settings().health.pause_cpa) && C.capAt(Q.first_product, qat) > 0 ? activeDeal(a.id, Q.first_product, Q.first_plan, qat) : null;
    if (!deal) { D.run("UPDATE aff_customers SET model='revshare', model_at=? WHERE user_id=?", qat, userId); D.run('UPDATE aff_commissions SET provisional=0 WHERE customer_user_id=? AND provisional=1', userId); return; }
    const [ms, me] = C.monthRange(C.monthKey(qat));
    const used = D.get("SELECT COUNT(*) n FROM aff_cpa_reviews WHERE affiliate_id=? AND product_key=? AND created_at>=? AND created_at<? AND NOT (status='declined' AND decline_reason='over_cap')", a.id, deal.product_key, ms, me).n;
    const amount = cpaAt(deal, qat);
    const cpaConv = D.get('SELECT * FROM aff_conversions WHERE id=?', D.run(`INSERT OR IGNORE INTO aff_conversions(affiliate_id,customer_user_id,product_key,plan,event_type,amount_cents,source,source_key,status,related_id,occurred_at,received_at)
      VALUES(?,?,?,?,'cpa',?,?,?,?,?,?,?)`, a.id, userId, Q.first_product, Q.first_plan, amount, 'system', 'cpa:' + userId, 'in_review', conv.id, qat, now()).id);
    if (used >= deal.monthly_cap) {
      declinedOverCap = true;
      D.insert('aff_cpa_reviews', { conversion_id: cpaConv.id, affiliate_id: a.id, customer_user_id: userId, product_key: Q.first_product, plan: Q.first_plan, amount_cents: amount, model: deal.model, status: 'declined', decline_reason: 'over_cap', decided_at: now(), note: 'Automatic: monthly CPA cap reached', created_at: now() });
      D.run("UPDATE aff_conversions SET status='declined', note='over_cap' WHERE id=?", cpaConv.id);
      D.run("UPDATE aff_customers SET model='revshare', model_at=?, cpa_conversion_id=? WHERE user_id=?", qat, cpaConv.id, userId);
      D.run('UPDATE aff_commissions SET provisional=0 WHERE customer_user_id=? AND provisional=1', userId);
      return;
    }
    const com = addCommission({ affiliate_id: a.id, type: deal.model === 'hybrid' ? 'hybrid_cpa' : 'cpa', amount_cents: amount, base_cents: Q.first_amount_cents, product_key: Q.first_product,
      customer_user_id: userId, conversion_id: cpaConv.id, status: 'in_review', uniq_key: 'cpa:' + userId, earned_at: qat });
    const fa = F.analyse(userId, qat);
    const rid = D.insert('aff_cpa_reviews', { conversion_id: cpaConv.id, commission_id: com ? com.id : null, affiliate_id: a.id, customer_user_id: userId, product_key: Q.first_product, plan: Q.first_plan,
      amount_cents: amount, model: deal.model, risk: fa.risk, verdict: fa.verdict, signals: JSON.stringify(fa.signals.map((s) => s.key)), status: 'pending', created_at: now() }).id;
    review = D.get('SELECT * FROM aff_cpa_reviews WHERE id=?', rid);
    D.run("UPDATE aff_customers SET model=?, model_at=?, cpa_conversion_id=? WHERE user_id=?", deal.model, qat, cpaConv.id, userId);
    // Provisional RevShare on this customer is replaced: CPA pays the fixed amount only; Hybrid re-rates at the deal's RevShare.
    for (const c of D.all("SELECT * FROM aff_commissions WHERE customer_user_id=? AND type='revshare' AND provisional=1 AND status NOT IN ('reversed','declined')", userId)) {
      reverseCommission(c, 1, deal.model === 'hybrid' ? 'hybrid_rerate' : 'cpa_model', 'model:' + userId, qat);
      if (deal.model === 'hybrid') {
        const rate = Math.min(deal.rate_bp, C.capAt(c.product_key, c.earned_at || qat));
        const amt = C.pct(c.base_cents, rate);
        if (amt > 0) addCommission({ affiliate_id: a.id, type: 'revshare', amount_cents: amt, base_cents: c.base_cents, rate_bp: rate, product_key: c.product_key, customer_user_id: userId, conversion_id: c.conversion_id, hold_until: c.hold_until, status: a.activated_at ? 'hold' : 'pending_activation', uniq_key: 'hy:' + c.id, earned_at: c.earned_at || qat });
      }
    }
  });
  if (!conv) return;
  releaseCustomer(userId);
  const fresh = C.byId(a.id);
  const month = qualifiedCount(a.id, ...C.monthRange(C.monthKey(qat)));
  const next = C.tiers()[C.effectiveTier(fresh, qat) + 1];
  N.emit(fresh, 'qualified', { text: `Qualified FTD · ${prodName(Q.first_product, Q.first_plan)} · ${attr.cust_ref}.${next ? ` This month: ${month} of ${next.min} toward ${next.name}.` : ''}`, product_key: Q.first_product, postback: 'qualified', conversion: conv });
  if (review) {
    N.emit(fresh, 'cpa_pending', { postback: 'cpa_pending', conversion: D.get('SELECT * FROM aff_conversions WHERE id=?', review.conversion_id) });
    autoDecide(review);
  }
  if (declinedOverCap) N.emit(fresh, 'cpa_declined', { text: `CPA declined on ${prodName(Q.first_product, Q.first_plan)} · ${attr.cust_ref} · Reason: ${DECLINE.over_cap}`, product_key: Q.first_product });
  checkActivation(fresh, qat);
  fastLane(C.byId(a.id), qat);
}
/** Hard facts decline at once (customer existed or paid before, or is the affiliate); everything else waits for a person. */
function autoDecide(review) {
  const fa = F.analyse(review.customer_user_id);
  const keys = fa.signals.map((s) => s.key);
  const reason = keys.includes('self_referral') ? 'self_referral' : keys.includes('pre_existing') || keys.includes('prior_payment') ? 'not_new_customer' : null;
  if (reason) decideCpa(review.id, null, 'decline', { reason, note: 'Automatic: ' + (fa.signals.find((s) => ['self_referral', 'pre_existing', 'prior_payment'].includes(s.key)) || {}).label });
}

/** Hold after a CPA approval: 0 by default; admin may set one (longer for large amounts or new CPA affiliates); a product's CPA hold can lengthen it. */
function cpaHoldDays(a, rv, at = now()) {
  const h = holdDays();
  const newOnCpa = a.cpa_started_at && at - a.cpa_started_at < (h.cpa_new_days || 0) * DAY;
  const base = rv.amount_cents >= h.cpa_long_cents || newOnCpa ? Math.max(h.cpa_long_days || 0, h.cpa_days || 0) : h.cpa_days || 0;
  return Math.max(0, Number(base) || 0, Number((C.product(rv.product_key) || {}).cpa_hold_days) || 0);
}
/** Approve, decline or extend a CPA review. me = staff user (null for automatic). */
function decideCpa(id, me, action, { reason = '', note = '', at = now() } = {}) {
  const rv = D.get('SELECT * FROM aff_cpa_reviews WHERE id=?', id);
  if (!rv) C.fail(404, 'Conversion not found.');
  const a = C.byId(rv.affiliate_id);
  if (me && a && a.user_id === me.id) C.fail(403, 'This conversion is yours. Another reviewer has to decide it.');
  if (action === 'extend') {
    if (rv.status !== 'pending') C.fail(409, `This conversion is already ${rv.status}.`);
    const days = holdDays().review_extend_days;
    D.run('UPDATE aff_cpa_reviews SET extended_days=extended_days+?, note=? WHERE id=?', days, C.clean(note, 300) || rv.note, id);
    C.audit(me, 'cpa.extend', { affiliate_id: rv.affiliate_id, target: `CPA #${rv.conversion_id}`, after: { extended_days: rv.extended_days + days } });
    return D.get('SELECT * FROM aff_cpa_reviews WHERE id=?', id);
  }
  if (rv.status !== 'pending') C.fail(409, `This conversion is already ${rv.status}.`);
  const com = rv.commission_id ? D.get('SELECT * FROM aff_commissions WHERE id=?', rv.commission_id) : null;
  const attr = attribution(rv.customer_user_id);
  const label = prodName(rv.product_key, rv.plan);
  if (action === 'approve') {
    const days = cpaHoldDays(a, rv, at);
    const holdUntil = at + days * DAY;
    D.tx(() => {
      if (!D.run("UPDATE aff_cpa_reviews SET status='approved', reviewer_id=?, decided_at=?, note=? WHERE id=? AND status='pending'", me ? me.id : null, at, C.clean(note, 500), id).changes) C.fail(409, 'Someone else just decided this conversion.');
      // A CPA is earned when it is approved (in review it is not earned yet): its statement month is the approval date.
      if (com) D.run("UPDATE aff_commissions SET status=?, hold_until=?, approved_by=?, updated_at=?, earned_at=? WHERE id=? AND status='in_review'", a.activated_at ? 'hold' : 'pending_activation', holdUntil, me ? me.id : null, at, at, com.id);
      D.run("UPDATE aff_conversions SET status='approved' WHERE id=?", rv.conversion_id);
    });
    // No CPA hold (the default): available at once, with the parent's sub-affiliate override.
    const fresh = com ? D.get('SELECT * FROM aff_commissions WHERE id=?', com.id) : null;
    if (fresh && fresh.status === 'hold' && fresh.hold_until <= at) release(fresh, at);
    const st = com ? D.get('SELECT status FROM aff_commissions WHERE id=?', com.id).status : 'available';
    const when = st === 'available' ? 'Available now.' : st === 'hold' ? `On hold until ${dateTxt(holdUntil)}.` : 'Waiting for activation.';
    C.audit(me, 'cpa.approve', { affiliate_id: a.id, target: `CPA #${rv.conversion_id} ${label} ${C.fmtUsd(rv.amount_cents)}` });
    N.emit(a, 'cpa_approved', { text: `CPA approved · ${label} · ${C.fmtUsd(rv.amount_cents)} · ${attr ? attr.cust_ref : ''}. ${when}`, product_key: rv.product_key, postback: 'cpa_approved', conversion: D.get('SELECT * FROM aff_conversions WHERE id=?', rv.conversion_id), pbVars: { commission_cents: rv.amount_cents }, email: { product: label, amount: C.fmtUsd(rv.amount_cents), customer_ref: attr ? attr.cust_ref : '', when } });
  } else if (action === 'decline') {
    if (!DECLINE[reason]) C.fail(400, 'Choose a decline reason.');
    D.tx(() => {
      if (!D.run("UPDATE aff_cpa_reviews SET status='declined', reviewer_id=?, decided_at=?, decline_reason=?, note=? WHERE id=? AND status='pending'", me ? me.id : null, at, reason, C.clean(note, 500), id).changes) C.fail(409, 'Someone else just decided this conversion.');
      if (com) D.run("UPDATE aff_commissions SET status='declined', reason=?, updated_at=? WHERE id=?", reason, at, com.id);
      D.run("UPDATE aff_conversions SET status='declined', note=? WHERE id=?", reason, rv.conversion_id);
      D.run("UPDATE aff_customers SET model=? WHERE user_id=?", reason === 'over_cap' ? 'revshare' : 'none', rv.customer_user_id);
    });
    C.audit(me, 'cpa.decline', { affiliate_id: a.id, target: `CPA #${rv.conversion_id} ${label}`, after: { reason } });
    N.emit(a, 'cpa_declined', { text: `CPA declined on ${label} · ${attr ? attr.cust_ref : ''} · Reason: ${DECLINE[reason]}`, product_key: rv.product_key, postback: 'cpa_declined', conversion: D.get('SELECT * FROM aff_conversions WHERE id=?', rv.conversion_id), pbVars: { decline_reason: reason }, email: { product: label, customer_ref: attr ? attr.cust_ref : '', reason: DECLINE[reason], reason_code: reason, note: C.clean(note, 500) } });
  } else C.fail(400, 'Unknown action.');
  checkAutoPause(a.id, at);
  return D.get('SELECT * FROM aff_cpa_reviews WHERE id=?', id);
}
/** Decline rate over the limit in 30 days (with enough decisions) pauses CPA on the affiliate and alerts the manager. */
function checkAutoPause(affId, at = now()) {
  const cfg = C.settings().cpa;
  const r = D.get("SELECT COUNT(*) n, COUNT(CASE WHEN status='declined' THEN 1 END) d FROM aff_cpa_reviews WHERE affiliate_id=? AND status IN ('approved','declined') AND decline_reason<>'over_cap' AND decided_at>?", affId, at - 30 * DAY);
  if (r.n >= cfg.auto_pause_min && (10000 * r.d) / r.n > cfg.auto_pause_decline_bp) {
    const a = C.byId(affId);
    if (a && !a.cpa_paused) {
      D.run("UPDATE aff_affiliates SET cpa_paused=1, cpa_paused_reason=?, updated_at=? WHERE id=?", `Decline rate ${Math.round((100 * r.d) / r.n)}% in 30 days`, at, affId);
      C.audit(null, 'cpa.auto_pause', { affiliate_id: affId, after: { declined: r.d, decided: r.n } });
    }
  }
}

/* ------------------------------------------------------------------ activation, release, subs */
function checkActivation(a, at = now()) {
  if (!a || a.activated_at) return false;
  const need = C.settings().activation_customers;
  if (qualifiedCount(a.id) < need) return false;
  let done = false;
  D.tx(() => {
    if (!D.run('UPDATE aff_affiliates SET activated_at=?, health_state=?, health_since=?, updated_at=? WHERE id=? AND activated_at IS NULL', at, 'ramp', at, now(), a.id).changes) return;
    D.run("UPDATE aff_commissions SET status='hold', updated_at=? WHERE affiliate_id=? AND status='pending_activation'", now(), a.id);
    done = true;
  });
  if (!done) return false;
  // Waiting commissions with no hold left become available now (and pay the parent's sub-affiliate override).
  let freed = 0;
  for (const c of D.all("SELECT * FROM aff_commissions WHERE affiliate_id=? AND status='hold' AND hold_until<=? ORDER BY id", a.id, Math.max(at, now()))) freed += release(c, now());
  const held = D.get("SELECT COALESCE(SUM(amount_cents),0) s FROM aff_commissions WHERE affiliate_id=? AND status='hold'", a.id).s;
  C.audit(null, 'affiliate.activated', { affiliate_id: a.id });
  N.emit(a, 'earnings_available', { text: `Your earnings are active: you reached ${need} qualified customers. ${C.fmtUsd(freed)} is now available to withdraw${held > 0 ? `; ${C.fmtUsd(held)} is on hold` : ''}.` });
  return true;
}
/** Is this parent allowed to earn on subs right now, and at what rate? */
function subRate(parent) {
  const s = C.settings().subs;
  if (!s.enabled || !parent || parent.status !== 'approved' || parent.health_state === 'paused') return 0;
  const strong = D.get(`SELECT COUNT(*) n FROM aff_affiliates s WHERE s.parent_affiliate_id=? AND s.status='approved' AND s.health_state<>'paused'
    AND (SELECT COUNT(*) FROM aff_customers c WHERE c.affiliate_id=s.id AND c.qualified_at IS NOT NULL) >= ?`, parent.id, s.boost_sub_customers).n;
  return strong >= s.boost_subs ? s.boosted_rate_bp : s.rate_bp;
}
/**
 * Make one held commission available (its hold ended or there was none) and create the parent's sub-affiliate override,
 * also available at once. Banned customers' commissions stay held. Returns the amount released (0 when nothing changed).
 * per: optional Map collecting released cents by affiliate (for one summary alert).
 */
function release(c, at = now(), per = null) {
  if (!c || c.status !== 'hold') return 0;
  if (c.customer_user_id) { const u = D.get('SELECT banned FROM users WHERE id=?', c.customer_user_id); if (u && u.banned) return 0; }
  if (!D.run("UPDATE aff_commissions SET status='available', released_at=?, updated_at=? WHERE id=? AND status='hold'", at, at, c.id).changes) return 0;
  if (per) per.set(c.affiliate_id, (per.get(c.affiliate_id) || 0) + c.amount_cents);
  if (c.type === 'sub_override' || c.amount_cents <= 0 || !['revshare', 'cpa', 'hybrid_cpa'].includes(c.type)) return c.amount_cents;
  const a = C.byId(c.affiliate_id);
  if (!a || !a.parent_affiliate_id) return c.amount_cents;
  const parent = C.byId(a.parent_affiliate_id);
  const rate = subRate(parent);
  const amt = rate ? Math.floor((c.amount_cents * rate) / 10000) : 0;
  if (amt > 0) {
    const o = addCommission({ affiliate_id: parent.id, type: 'sub_override', amount_cents: amt, base_cents: c.amount_cents, rate_bp: rate, product_key: c.product_key, source_commission_id: c.id,
      status: parent.activated_at ? 'available' : 'pending_activation', hold_until: at, uniq_key: 'sub:' + c.id, note: `Sub-affiliate #${a.id}`, earned_at: c.earned_at || c.created_at || at });
    if (o && o.status === 'available' && per) per.set(parent.id, (per.get(parent.id) || 0) + amt);
  }
  return c.amount_cents;
}
/** Release a customer's held commissions that have no hold left (after qualification decided the model). */
function releaseCustomer(userId, at = now()) {
  let n = 0;
  for (const c of D.all("SELECT * FROM aff_commissions WHERE customer_user_id=? AND status='hold' AND hold_until<=? ORDER BY id", userId, at)) n += release(c, at);
  return n;
}
/** Release held commissions whose hold ended (hourly job; only matters when admin set a hold, or for holds from before the upgrade). */
function settle(at = now()) {
  const due = D.all(`SELECT c.* FROM aff_commissions c LEFT JOIN users u ON u.id=c.customer_user_id WHERE c.status='hold' AND c.hold_until<=? AND COALESCE(u.banned,0)=0 ORDER BY c.id LIMIT 5000`, at);
  const per = new Map();
  for (const c of due) release(c, at, per);
  for (const [affId, cents] of per) {
    if (cents <= 0) continue;
    const a = C.byId(affId);
    N.emit(a, 'earnings_available', { text: `${C.fmtUsd(cents)} is now available to withdraw.` });
  }
  return due.length;
}

/* ------------------------------------------------------------------ balance */
function balance(affId, at = now()) {
  const s = (where, ...args) => D.get(`SELECT COALESCE(SUM(amount_cents),0) s FROM aff_commissions WHERE affiliate_id=? AND ${where}`, affId, ...args).s;
  const avail = s("status='available' AND payout_id IS NULL");
  const hold = s("status='hold'");
  const pendingAct = s("status='pending_activation'");
  const review = s("status='in_review'");
  const reqd = D.get("SELECT COALESCE(SUM(amount_cents),0) s FROM aff_payouts WHERE affiliate_id=? AND status IN ('requested','approved','processing','held')", affId).s;
  const paid = D.get("SELECT COALESCE(SUM(amount_cents),0) s FROM aff_payouts WHERE affiliate_id=? AND status='paid'", affId).s;
  const lifetime = s("status IN ('available','paid','hold','pending_activation')");
  const next = D.get("SELECT MIN(hold_until) t FROM aff_commissions WHERE affiliate_id=? AND status='hold'", affId).t;
  let nextRelease = null;
  if (next) {
    const dayEnd = C.dayStartAt(next) + DAY;
    nextRelease = { at: Math.max(next, at), amount_cents: s("status='hold' AND hold_until<?", dayEnd) };
  }
  return {
    available_cents: Math.max(0, avail), owed_cents: Math.max(0, -avail), hold_cents: hold, pending_activation_cents: pendingAct, in_review_cents: review,
    requested_cents: reqd, paid_cents: paid, lifetime_cents: lifetime, credit_cents: Math.max(0, avail) + hold + review + pendingAct, next_release: nextRelease,
  };
}

/* ------------------------------------------------------------------ tiers */
function setTier(a, to, reason, at, scoreX100 = 0) {
  const from = a.tier || 0;
  D.run('UPDATE aff_affiliates SET tier=?, tier_set_at=?, legend_pending=?, updated_at=? WHERE id=?', to, at, C.tiers()[to] && C.tiers()[to].approval && !a.legend_approved ? 1 : 0, now(), a.id);
  if (from !== to) D.insert('aff_tier_history', { affiliate_id: a.id, from_tier: from, to_tier: to, reason, score_x100: scoreX100, at });
  return C.byId(a.id);
}
function tierNotify(before, after, reason, at, avg) {
  const T = C.tiers();
  const eb = C.effectiveTier(before, at); const ea = C.effectiveTier(after, at);
  if (ea > eb) {
    N.emit(after, 'tier_up', { text: `You moved to ${T[ea].name}. Your RevShare is now ${T[ea].rate_bp / 100}% on new payments.`, postback: 'tier_change', pbVars: { tier: T[ea].name }, email: { tier: T[ea].name, rate: `${T[ea].rate_bp / 100}%`, perks: '' } });
  } else if (ea < eb) {
    N.emit(after, 'tier_down', { text: `From ${dateTxt(at)} your tier is ${T[ea].name} (${T[ea].rate_bp / 100}%). Your 2-month average was ${avg}.`, postback: 'tier_change', pbVars: { tier: T[ea].name } });
  }
  if (after.legend_pending && !before.legend_pending) N.emit(after, 'tier_change', { text: 'You reached Legend volume. Our team is reviewing your account. You earn at Senior Partner until then.' });
}
const gateOk = (rr, cfg, bp) => rr.customers < cfg.min_customers || rr.rate_bp <= bp;
/** Upgrade the same day when this month's qualified customers alone reach a higher tier (quality gate permitting). */
function fastLane(a, at = now()) {
  if (!a || a.status !== 'approved') return false;
  const T = C.tiers();
  const month = qualifiedCount(a.id, ...C.monthRange(C.monthKey(at)));
  let target = 0; for (const t of T) if (month >= t.min) target = t.idx;
  if (target <= (a.tier || 0)) return false;
  const cfg = C.settings().quality;
  const key = C.monthKey(at);
  const rr = refundRate(a.id, C.monthStartOf(C.addMonths(key, -1)), at + 1);
  if (!gateOk(rr, cfg, cfg.no_upgrade_bp)) return false;
  const after = setTier(a, target, 'fast_lane', at, month * 100);
  D.run("UPDATE aff_affiliates SET tier_grace_month='' WHERE id=?", a.id);
  tierNotify(a, after, 'fast_lane', at, month);
  return true;
}
/** Monthly tier setting (run on the 1st, Africa/Lagos). Safe to call often: each affiliate is set once per month. */
function runTiers(at = now()) {
  const T = C.tiers(); const cfg = C.settings().quality;
  const M = C.monthKey(at); const m1 = C.addMonths(M, -1); const m2 = C.addMonths(M, -2);
  const list = D.all("SELECT * FROM aff_affiliates WHERE status='approved' AND COALESCE(tier_month,'')<>? AND approved_at<?", M, C.monthStartOf(M)).map(C.hydrate);
  let changed = 0;
  for (const a of list) {
    const c1 = qualifiedCount(a.id, ...C.monthRange(m1));
    const oneMonth = a.approved_at >= C.monthStartOf(m1);
    const c2 = oneMonth ? null : qualifiedCount(a.id, ...C.monthRange(m2));
    const avg = c2 === null ? c1 : (c1 + c2) / 2;
    const rr = refundRate(a.id, C.monthStartOf(oneMonth ? m1 : m2), C.monthStartOf(M));
    let target = 0; for (const t of T) if (avg >= t.min) target = t.idx;
    const cur = a.tier || 0;
    let to = cur; let reason = 'monthly'; let grace = a.tier_grace_month || '';
    const dropGate = !gateOk(rr, cfg, cfg.drop_bp);
    if (dropGate && cur > 0) { to = cur - 1; reason = 'quality_drop'; grace = ''; }
    else if (target > cur) { if (gateOk(rr, cfg, cfg.no_upgrade_bp)) { to = target; grace = ''; } else reason = 'quality_hold'; }
    else if (target < cur) {
      if (grace && grace === m1) { to = cur - 1; reason = 'drop_after_grace'; grace = ''; } // grace already used last month: drop one tier only
      else { grace = M; reason = 'grace'; }
    } else grace = '';
    D.run('UPDATE aff_affiliates SET tier_month=?, tier_grace_month=? WHERE id=?', M, grace, a.id);
    const after = to !== cur ? setTier(a, to, reason, at, Math.round(avg * 100)) : C.byId(a.id);
    if (to !== cur) { changed++; tierNotify(a, after, reason, at, avg); }
    if (reason === 'grace') N.emit(after, 'grace', { text: `Your 2-month average is ${avg}, under ${T[cur].name}'s ${T[cur].min}. You keep ${T[cur].name} in ${monthName(M)} (grace month). Average ${T[cur].min} or more to stay.` });
    if (reason === 'quality_hold') N.emit(after, 'quality', { text: `Refund rate on your customers is ${(rr.rate_bp / 100).toFixed(1)}% over the last 2 months. Upgrades are held above ${cfg.no_upgrade_bp / 100}%.` });
  }
  return { checked: list.length, changed };
}

/* ------------------------------------------------------------------ lifetime RevShare health */
function healthOf(a, at = now()) {
  const h = C.settings().health;
  const count = qualifiedCount(a.id, at - h.window_days * DAY, at + 1);
  const base = { threshold: h.threshold, window_days: h.window_days, count, needed: Math.max(0, h.threshold - count), exempt: !!a.health_exempt };
  if (!a.activated_at) return { ...base, state: 'inactive', activation: { need: C.settings().activation_customers, have: qualifiedCount(a.id) } };
  const rampUntil = a.activated_at + h.ramp_days * DAY;
  if (at < rampUntil) return { ...base, state: 'ramp', ramp_until: rampUntil, days_left: Math.ceil((rampUntil - at) / DAY) };
  if (a.health_exempt) return { ...base, state: 'active' };
  const leaving = qualifiedCount(a.id, at - h.window_days * DAY, at - (h.window_days - h.projection_days) * DAY);
  const recent = qualifiedCount(a.id, at - h.projection_days * DAY, at + 1);
  const projected = count - leaving + recent;
  const last30 = qualifiedCount(a.id, at - 30 * DAY, at + 1);
  const pace = (h.threshold / h.window_days) * 30;
  const prev = a.health_state;
  if (count >= h.threshold) {
    const atRisk = projected < h.threshold || last30 < (h.at_risk_pct / 100) * pace;
    return { ...base, state: atRisk ? 'at_risk' : 'active', projected };
  }
  if (prev === 'paused') return { ...base, state: 'paused', projected };
  if (prev === 'grace') {
    const until = a.grace_until || at;
    return { ...base, state: at >= until ? 'paused' : 'grace', grace_until: until, days_left: Math.max(0, Math.ceil((until - at) / DAY)), projected };
  }
  return { ...base, state: 'grace', grace_until: at + h.grace_days * DAY, days_left: h.grace_days, projected, entering: true };
}
function runHealth(at = now()) {
  const list = D.all("SELECT * FROM aff_affiliates WHERE status IN ('approved','suspended')").map(C.hydrate);
  let changed = 0;
  for (const a of list) {
    const h = healthOf(a, at);
    if (h.state === a.health_state && h.count === a.health_count) continue;
    const since = h.state !== a.health_state ? at : a.health_since;
    D.run('UPDATE aff_affiliates SET health_state=?, health_since=?, grace_until=?, health_count=?, updated_at=? WHERE id=?', h.state, since, h.state === 'grace' ? h.grace_until : 0, h.count, now(), a.id);
    if (h.state === a.health_state) continue;
    changed++;
    C.audit(null, 'health.' + h.state, { affiliate_id: a.id, before: { state: a.health_state }, after: { state: h.state, count: h.count } });
    if (h.state === 'grace' || h.state === 'at_risk') N.emit(a, 'health_warning', { text: h.state === 'grace' ? `Lifetime RevShare: ${h.count} of ${h.threshold} qualified customers in the last ${h.window_days} days. You have ${h.days_left} days to get back to ${h.threshold}. You keep earning meanwhile.` : `Lifetime RevShare at risk: ${h.count} of ${h.threshold} qualified customers in the last ${h.window_days} days, and the pace is slowing.`, email: { count: String(h.count), threshold: String(h.threshold), days: String(h.days_left || 14), window: String(h.window_days), state: h.state === 'grace' ? 'grace' : 'at risk' } });
    if (h.state === 'paused') N.emit(a, 'health_paused', { text: `Lifetime RevShare on your existing customers is paused: ${h.count} of ${h.threshold} qualified customers in ${h.window_days} days. It restarts when you are back at ${h.threshold}. New-customer CPA deals are not affected.`, email: { count: String(h.count), threshold: String(h.threshold), window: String(h.window_days) } });
    if (h.state === 'active' && a.health_state === 'paused') N.emit(a, 'health_warning', { text: 'Lifetime RevShare is active again on all your customers.' });
  }
  return { checked: list.length, changed };
}

/* ------------------------------------------------------------------ hooks from VooSquare */
function orderProductKey(order) {
  if (order.item_type === 'premium') return 'premium';
  if (order.item_type === 'room') {
    const room = D.get('SELECT slug FROM rooms WHERE id=?', order.item_id);
    return room && room.slug === 'inner-circle' ? 'inner-circle' : 'room';
  }
  return order.item_type || 'premium';
}
function onOrderPaid(orderId) {
  const o = D.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o || o.status !== 'paid' || !(o.amount_usd > 0)) return null;
  const t = o.paid_at || o.created_at;
  const m = o.method_id ? D.get('SELECT type FROM payment_methods WHERE id=?', o.method_id) : null;
  return processPayment({ key: 'order:' + o.id, source: 'order', source_id: o.id, user_id: o.user_id, product_key: orderProductKey(o), plan: o.item_name, amount_cents: C.toCents(o.amount_usd), occurred_at: t, received_at: t, card: !!(m && CARD_METHODS.includes(m.type)) });
}
function onOrderReversed(orderId, kind = 'refund', at = now()) {
  const o = D.get('SELECT * FROM orders WHERE id=?', orderId);
  if (!o) return null;
  return processReversal({ key: `order-${kind}:${o.id}`, original_key: 'order:' + o.id, user_id: o.user_id, amount_cents: C.toCents(o.amount_usd), kind, occurred_at: at, source: 'order', source_id: o.id });
}
const TOOL_TYPES = ['spend', 'refund', 'chargeback', 'plan_started', 'plan_renewed', 'wallet_topup'];
/**
 * The plan catalogue (aff_plans) is admin-owned. A plan event only records what that customer paid (reported_cents):
 *  - a plan the catalogue does not have yet is added with that amount as a PROVISIONAL price (price_source 'tool'),
 *    so the Offers page is not empty, and it waits for an admin to confirm it;
 *  - a plan already in the catalogue keeps its price, whoever set it. An amount that differs (a discount, a custom
 *    deal, a yearly price, a price change in the tool) is counted in mismatch_count / mismatch_at for the admin to review.
 */
function recordPlanEvent(productKey, plan, amountCents, at = now()) {
  const row = D.get('SELECT * FROM aff_plans WHERE product_key=? AND plan=?', productKey, plan);
  if (!row) {
    D.run("INSERT OR IGNORE INTO aff_plans(product_key,plan,price_cents,synced_at,price_source,reported_cents,reported_at,mismatch_count) VALUES(?,?,?,?,'tool',?,?,0)", productKey, plan, amountCents, at, amountCents, at);
    return { added: true };
  }
  const differs = Number(row.price_cents) !== amountCents;
  D.run(`UPDATE aff_plans SET reported_cents=?, reported_at=?, mismatch_count=mismatch_count+?, mismatch_at=CASE WHEN ? THEN ? ELSE mismatch_at END WHERE product_key=? AND plan=?`,
    amountCents, at, differs ? 1 : 0, differs ? 1 : 0, at, productKey, plan);
  return { mismatch: differs };
}
/** An admin sets or confirms a catalogue price (and clears the mismatch flag). */
function setPlanPrice(productKey, plan, priceCents, byUserId, at = now()) {
  D.run(`INSERT INTO aff_plans(product_key,plan,price_cents,synced_at,price_source,reported_cents,mismatch_count,confirmed_by,confirmed_at) VALUES(?,?,?,?,'admin',0,0,?,?)
    ON CONFLICT(product_key,plan) DO UPDATE SET price_cents=excluded.price_cents, price_source='admin', mismatch_count=0, mismatch_at=NULL, confirmed_by=excluded.confirmed_by, confirmed_at=excluded.confirmed_at`,
  productKey, plan, priceCents, at, byUserId || null, at);
  return D.get('SELECT * FROM aff_plans WHERE product_key=? AND plan=?', productKey, plan);
}
/** A tool event stored by the Events API (raw = the JSON the tool sent, product = its products row). */
function onEvent(eventId, raw, product) {
  const ev = D.get('SELECT * FROM events WHERE id=?', eventId);
  if (!ev || !product || product.hub) return null;
  raw = raw || {};
  const sent = { plan: C.clean(raw.plan, 60), ref: C.clean(raw.original_event_id || raw.ref_event_id, 80), country: C.clean(raw.country, 2).toUpperCase() };
  if (sent.plan || sent.ref || sent.country) D.run('UPDATE events SET plan=?, ref_event=?, country=? WHERE id=?', sent.plan, sent.ref, sent.country, eventId);
  const plan = sent.plan || ev.plan || ''; const refEvent = sent.ref || ev.ref_event || ''; const country = sent.country || ev.country || '';
  if (ev.user_id && raw && raw.signals) F.recordToolSignals(ev.user_id, raw.signals, ev.received_at || now());
  if (!TOOL_TYPES.includes(ev.type)) return null;
  // Affleego (and any product outside the affiliate program): no commission, conversion, plan sync or qualification.
  if (!C.inProgram(product.slug)) return null;
  const amount = C.toCents(ev.value_usd);
  // Live events only (the catch-up job passes no body): a replayed event must not count as a second mismatch.
  if ((ev.type === 'plan_started' || ev.type === 'plan_renewed') && sent.plan && amount > 0) recordPlanEvent(product.slug, plan, amount);
  if (!ev.user_id) return null;
  // One payment date everywhere (money audit MN-10): the tool's occurred_at as stored by the Events API (events.created_at,
  // also used by revenue analytics and the member referral ledger), within the allowed clock skew of when it was received.
  const at = paymentDate(ev.created_at, ev.received_at || ev.created_at);
  if (ev.type === 'spend') {
    if (!(ev.value_usd > 0) || ev.value_usd > 1e9) return null;
    return processPayment({ key: 'event:' + ev.id, source: 'event', source_id: ev.id, user_id: ev.user_id, product_key: product.slug, plan, amount_cents: amount, occurred_at: at, received_at: ev.received_at || now(), country });
  }
  if (ev.type === 'refund' || ev.type === 'chargeback') {
    const orig = refEvent ? D.get('SELECT id FROM events WHERE product_id=? AND ext_id=?', product.id, refEvent) : null;
    return processReversal({ key: `event-${ev.type}:${ev.id}`, original_key: orig ? 'event:' + orig.id : null, user_id: ev.user_id, product_key: product.slug, plan, amount_cents: Math.abs(amount), kind: ev.type, occurred_at: at, source: 'event', source_id: ev.id });
  }
  // plan_started / plan_renewed / wallet_topup: tracked for reports, never commissionable.
  const attr = attribution(ev.user_id);
  if (!attr) return null;
  D.run(`INSERT OR IGNORE INTO aff_conversions(affiliate_id,customer_user_id,product_key,plan,event_type,amount_cents,source,source_id,source_key,status,occurred_at,received_at)
    VALUES(?,?,?,?,?,?,'event',?,?,'not_commissionable',?,?)`, attr.affiliate_id, ev.user_id, product.slug, plan, ev.type, Math.max(0, amount), ev.id, 'event:' + ev.id, at, ev.received_at || now());
  return null;
}
/** Catch-up: process events and paid orders the live hooks may have missed (server restart mid-request). Idempotent. */
function reconcile(limit = 2000) {
  const cur = D.getSetting('aff_cursor', { event: 0, order: 0 }) || { event: 0, order: 0 };
  let lastE = cur.event || 0;
  const evs = D.all('SELECT e.id eid, e.product_id pid FROM events e WHERE e.id>? AND e.user_id IN (SELECT customer_user_id FROM aff_attributions) ORDER BY e.id LIMIT ?', lastE, limit);
  for (const e of evs) {
    try { onEvent(e.eid, {}, D.get('SELECT * FROM products WHERE id=?', e.pid)); } catch (err) { console.error('[aff reconcile event]', err.message); }
    lastE = e.eid;
  }
  let lastO = cur.order || 0;
  const ods = D.all("SELECT id FROM orders WHERE id>? AND status='paid' AND user_id IN (SELECT customer_user_id FROM aff_attributions) ORDER BY id LIMIT ?", lastO, limit);
  for (const o of ods) {
    try { onOrderPaid(o.id); } catch (err) { console.error('[aff reconcile order]', err.message); }
    lastO = o.id;
  }
  // When everything was seen, jump to the newest ids (rows of customers attributed later are processed at attribution time).
  const maxE = D.get('SELECT MAX(id) m FROM events').m || 0; const maxO = D.get("SELECT MAX(id) m FROM orders WHERE status='paid'").m || 0;
  D.setSetting('aff_cursor', { event: evs.length >= limit ? lastE : Math.max(lastE, maxE - 0), order: ods.length >= limit ? lastO : Math.max(lastO, maxO) });
  return { events: evs.length, orders: ods.length };
}

module.exports = {
  DECLINE, dateTxt, prodName, revshareDeal, dealRate, attribution, customer, activeDeal, qualifiedCount, refundRate, addCommission, reverseCommission,
  processPayment, processReversal, recordFinalRefund, recordPlanEvent, setPlanPrice, maybeQualify, qualifyPending, qualifyByAge: qualifyPending, qualify, decideCpa, cpaHoldDays, autoDecide, checkAutoPause, checkActivation, subRate,
  release, releaseCustomer, settle, balance, paymentHoldDays, CARD_METHODS,
  setTier, fastLane, runTiers, healthOf, runHealth, onOrderPaid, onOrderReversed, onEvent, orderProductKey, reconcile, TOOL_TYPES,
};
