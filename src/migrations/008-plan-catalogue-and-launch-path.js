'use strict';
/*
 * 008 admin-owned plan catalogue and the tool launch path (hub fixes from the Voo Connect roll-out, 2026-10-05).
 *  - aff_plans: the plan catalogue the affiliate Offers page, the suggested CPA and contest scoring read. A tool's
 *    plan_started / plan_renewed event no longer changes a price that is already in the catalogue (one customer's
 *    discount or yearly price used to overwrite the price every affiliate sees). Columns:
 *      price_source        'tool'  = provisional, taken from the first plan event for a plan the catalogue did not have
 *                          'admin' = set or confirmed by an admin (Affiliates → Deals and products → Plans)
 *      reported_cents      the amount of the latest plan event for this plan (what that customer paid)
 *      reported_at         when that event arrived
 *      mismatch_count      plan events whose amount differed from the catalogue price since the last admin review
 *      mismatch_at         the latest such event (NULL = nothing to review)
 *      confirmed_by / confirmed_at   the admin who last set or confirmed the price
 *    Existing rows were written by the old sync and are marked 'tool' (provisional) so an admin confirms them once.
 *  - products.launch_path: where VooSquare's launcher sends a member inside the tool (URL/auth/voosquare?return_to=<path>).
 *    '' means the default, /dashboard.
 * Additive only. NEVER EDIT THIS FILE after it has shipped.
 */
module.exports = {
  up(db, h) {
    if (h.hasTable('aff_plans')) {
      h.addColumn('aff_plans', 'price_source', "TEXT DEFAULT 'tool'");
      h.addColumn('aff_plans', 'reported_cents', 'INTEGER DEFAULT 0');
      h.addColumn('aff_plans', 'reported_at', 'INTEGER');
      h.addColumn('aff_plans', 'mismatch_count', 'INTEGER DEFAULT 0');
      h.addColumn('aff_plans', 'mismatch_at', 'INTEGER');
      h.addColumn('aff_plans', 'confirmed_by', 'INTEGER');
      h.addColumn('aff_plans', 'confirmed_at', 'INTEGER');
      db.exec("UPDATE aff_plans SET reported_cents=price_cents, reported_at=synced_at WHERE reported_at IS NULL");
    }
    if (h.hasTable('products')) h.addColumn('products', 'launch_path', "TEXT DEFAULT ''");
  },
};
