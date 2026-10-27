'use strict';
/*
 * 005 affiliate custom RevShare deals (owner decision 2026-10-05). The owner can give one affiliate a custom RevShare
 * rate (one product or all products, up to 90%) for a window: forever, until a date, or from a date to a date. A rate
 * above 50% is a "Special deal" and overrides the product caps for that deal only. Stored as aff_deals rows with
 * model 'revshare' (product_key '*' = all products).
 *  - aff_deals.special: 1 when the rate is above 50% (shown with a "Special deal" tag to that affiliate and staff only).
 *  - aff_deals.duration: 'forever' | 'until' | 'range' (how the owner set the window; the window itself is
 *    starts_at / ends_at, ends_at 0 = forever).
 *  - aff_deals.start_notified_at / end_notified_at: the affiliate was told it started / that it ends within 7 days.
 *  - aff_commissions.deal_id / special_bp: the custom deal a RevShare line was paid under, and its rate when it was a
 *    Special deal (for the "Special deal 70%" label on the ledger, receipts and statements).
 * Additive only. NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db, h) {
    if (h.hasTable('aff_deals')) {
      h.addColumn('aff_deals', 'special', 'INTEGER DEFAULT 0');
      h.addColumn('aff_deals', 'duration', "TEXT DEFAULT ''");
      h.addColumn('aff_deals', 'start_notified_at', 'INTEGER');
      h.addColumn('aff_deals', 'end_notified_at', 'INTEGER');
      db.exec("CREATE INDEX IF NOT EXISTS ix_aff_deals_rs ON aff_deals(affiliate_id, model, status)");
    }
    if (h.hasTable('aff_commissions')) {
      h.addColumn('aff_commissions', 'deal_id', 'INTEGER');
      h.addColumn('aff_commissions', 'special_bp', 'INTEGER DEFAULT 0');
    }
  },
};
