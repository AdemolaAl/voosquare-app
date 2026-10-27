'use strict';
/*
 * 007 affiliate money on the payment date (money audit MN-1, MN-5, MN-6).
 *  - aff_commissions.earned_at: the date a commission belongs to. RevShare: the payment date (the conversion's
 *    occurred_at); CPA: the approval date; sub-affiliate override: its source's date; reversal: the date of the
 *    chargeback, refund or fraud reversal; adjustments and prizes: when they were made. Reports, KPI tiles, the admin
 *    "commission this month" and monthly statements group by it (Lagos month) instead of the insert time, so a payment
 *    reported late lands in the month it was paid. NULL (rows written by an older release after a rollback) reads as
 *    created_at.
 *  - aff_rate_history: every change to the program RevShare tier rates (kind 'tiers') and to a product's RevShare cap
 *    (kind 'cap', key = product) with the value before and after and the time it took effect. The engine pays a late
 *    reported payment at the rates in force on its payment date ("new rates apply to payments after the change").
 * Backfill: earned_at for existing rows (payment date where the row comes from a payment, approval date for approved
 * CPA, the source's date for overrides, created_at otherwise). Additive only. NEVER EDIT THIS FILE after it has shipped.
 */
module.exports = {
  up(db, h) {
    db.exec(`CREATE TABLE IF NOT EXISTS aff_rate_history(
      id INTEGER PRIMARY KEY, kind TEXT NOT NULL, key TEXT DEFAULT '', before TEXT DEFAULT '', after TEXT DEFAULT '',
      effective_at INTEGER NOT NULL, created_by INTEGER, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_aff_rate_hist ON aff_rate_history(kind, key, effective_at);`);
    if (!h.hasTable('aff_commissions')) return;
    h.addColumn('aff_commissions', 'earned_at', 'INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS ix_aff_com_earned ON aff_commissions(affiliate_id, earned_at)');
    // RevShare (and Hybrid re-rated) lines: the payment date.
    db.exec(`UPDATE aff_commissions SET earned_at=(SELECT v.occurred_at FROM aff_conversions v WHERE v.id=aff_commissions.conversion_id AND v.event_type IN ('first_payment','repeat_payment'))
      WHERE earned_at IS NULL AND type='revshare' AND conversion_id IS NOT NULL`);
    // CPA: the approval date when approved, else the qualification date.
    if (h.hasTable('aff_cpa_reviews')) {
      db.exec(`UPDATE aff_commissions SET earned_at=(SELECT w.decided_at FROM aff_cpa_reviews w WHERE w.commission_id=aff_commissions.id AND w.status='approved' AND w.decided_at IS NOT NULL)
        WHERE earned_at IS NULL AND type IN ('cpa','hybrid_cpa')`);
    }
    db.exec(`UPDATE aff_commissions SET earned_at=(SELECT v.occurred_at FROM aff_conversions v WHERE v.id=aff_commissions.conversion_id)
      WHERE earned_at IS NULL AND type IN ('cpa','hybrid_cpa') AND conversion_id IS NOT NULL`);
    // Sub-affiliate overrides follow their source line.
    db.exec(`UPDATE aff_commissions SET earned_at=(SELECT COALESCE(s.earned_at, s.created_at) FROM aff_commissions s WHERE s.id=aff_commissions.source_commission_id)
      WHERE earned_at IS NULL AND type='sub_override' AND source_commission_id IS NOT NULL`);
    db.exec('UPDATE aff_commissions SET earned_at=created_at WHERE earned_at IS NULL');
  },
};
