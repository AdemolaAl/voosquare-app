'use strict';
/*
 * 006 affiliate terms acceptance history (owner decision 2026-10-05: terms v1.1 must be accepted again). Every time an
 * affiliate accepts a version of the affiliate terms (application, the "We've updated the affiliate terms" banner,
 * Settings → Legal) a row is added: who, which version, when and from where. aff_affiliates.terms_version /
 * terms_accepted_at keep holding the latest acceptance; this table keeps all of them (audit, never deleted).
 *  - source: 'application' | 'update' | 'settings' | 'backfill' (acceptances recorded before this table existed).
 * Backfill: one 'backfill' row per affiliate that had already accepted a version.
 * Additive only. NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db, h) {
    db.exec(`CREATE TABLE IF NOT EXISTS aff_terms_acceptances(
      id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, user_id INTEGER, version TEXT NOT NULL DEFAULT '', accepted_at INTEGER NOT NULL,
      source TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS ix_aff_terms_acc_aff ON aff_terms_acceptances(affiliate_id, id);`);
    if (h.hasTable('aff_affiliates') && h.hasColumn('aff_affiliates', 'terms_accepted_at')) {
      db.exec(`INSERT INTO aff_terms_acceptances(affiliate_id, user_id, version, accepted_at, source)
        SELECT a.id, a.user_id, a.terms_version, a.terms_accepted_at, 'backfill' FROM aff_affiliates a
        WHERE a.terms_accepted_at IS NOT NULL AND COALESCE(a.terms_version,'')<>''
          AND NOT EXISTS (SELECT 1 FROM aff_terms_acceptances x WHERE x.affiliate_id=a.id AND x.version=a.terms_version)`);
    }
  },
};
