'use strict';
/*
 * VooSquare Affiliates: entry point and the hooks the rest of VooSquare calls.
 *   onSignup(user, ctx, { coupon })     auth: right after a Voo ID is created (sign-up on VooSquare or from any tool)
 *   captureFromAuthorize(ctx)           /oauth/authorize: tools hand back ref / vclick / coupon
 *   onOrderPaid(orderId)                payments.fulfill: a VooSquare order turned paid
 *   onOrderReversed(orderId, kind)      admin: an order was refunded or charged back
 *   onEvent(eventId, raw, product)      Events API: a tool event was stored
 *   onCheckoutCoupon(user, orderId, code)
 * Every hook is wrapped so a bug here can never break sign-up, payments or the Events API.
 */
const C = require('./core');
const T = require('./tracking');
const E = require('./engine');
const J = require('./jobs');

const safe = (name, fn) => (...args) => { try { return fn(...args); } catch (e) { console.error(`[aff ${name}]`, e); return null; } };

module.exports = {
  core: C,
  onSignup: safe('signup', T.onSignup),
  captureFromAuthorize: safe('authorize', T.captureFromAuthorize),
  onOrderPaid: safe('order', E.onOrderPaid),
  onOrderReversed: safe('order-reversal', E.onOrderReversed),
  onEvent: safe('event', E.onEvent),
  onCheckoutCoupon: safe('coupon', T.onCheckoutCoupon),
  start: J.start,
};
