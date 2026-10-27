'use strict';
/*
 * 004 affiliate program, owner decisions of 2026-10-05.
 *  1. Affleego is not part of the affiliate program ("We're not selling anything there. No commission for that.").
 *     Existing installs that configured it are switched off here WITHOUT deleting anything: the product rule is marked
 *     not commissionable (cap 0, no CPA), active or paused Affleego deals end, pending deal requests are declined,
 *     Affleego coupons and creatives are deactivated, saved Affleego links are archived (they now land on VooSquare),
 *     and Affleego is taken out of contest product lists and postback product filters. Commissions, conversions and
 *     the audit trail stay exactly as they were (history). The code (src/aff/core.js NOT_IN_PROGRAM) enforces the rule
 *     from now on whatever the data says. Affleego itself stays a VooSquare product (tools page, Voo ID, school).
 *  2. aff_adjustment_requests: positive manual adjustments above the four-eyes limit wait here for a second
 *     finance/admin approval (never the requester). idem_key makes a repeated click or retry a no-op.
 * NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
const KEY = 'affleego';

module.exports = {
  up(db, h) {
    db.exec(`CREATE TABLE IF NOT EXISTS aff_adjustment_requests(
      id INTEGER PRIMARY KEY, affiliate_id INTEGER NOT NULL, amount_cents INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '',
      idem_key TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending', requested_by INTEGER, decided_by INTEGER, decided_at INTEGER,
      decision_note TEXT DEFAULT '', commission_id INTEGER, created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS ix_aff_adjreq_status ON aff_adjustment_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS ix_aff_adjreq_aff ON aff_adjustment_requests(affiliate_id, created_at);`);

    const t = Date.now();
    const getSetting = (k) => { const r = db.prepare('SELECT value FROM settings WHERE key=?').get(k); if (!r) return null; try { return JSON.parse(r.value); } catch { return null; } };
    const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, JSON.stringify(v));

    // Product rule row (settings aff_products.affleego): kept, switched off.
    if (h.hasTable('settings')) {
      const prods = getSetting('aff_products');
      if (prods && typeof prods === 'object' && prods[KEY] && typeof prods[KEY] === 'object') {
        prods[KEY] = { ...prods[KEY], commissionable: false, cap_bp: 0, cpa_cents: 0, hybrid_cpa_cents: 0, hybrid_rate_bp: 0, not_in_program: true, disabled_at: t };
        setSetting('aff_products', prods);
      }
    }
    if (h.hasTable('aff_deals')) {
      db.prepare("UPDATE aff_deals SET status='ended', pause_reason='Affleego is not part of the affiliate program (owner decision 2026-10-05)', ends_at=?, updated_at=? WHERE product_key=? AND status IN ('active','paused')").run(t, t, KEY);
    }
    if (h.hasTable('aff_deal_requests')) {
      db.prepare("UPDATE aff_deal_requests SET status='declined', decided_at=?, decision_note='Affleego is not part of the affiliate program.' WHERE product_key=? AND status='pending'").run(t, KEY);
    }
    if (h.hasTable('aff_offer_changes')) {
      // Scheduled (not yet applied) Affleego CPA or cap changes would only rewrite a switched-off rule: mark them applied.
      db.prepare('UPDATE aff_offer_changes SET applied_at=?, note=? WHERE product_key=? AND applied_at IS NULL').run(t, 'Cancelled: Affleego left the affiliate program', KEY);
    }
    if (h.hasTable('aff_coupons')) db.prepare('UPDATE aff_coupons SET active=0 WHERE product_key=? AND active=1').run(KEY);
    if (h.hasTable('aff_creatives')) db.prepare('UPDATE aff_creatives SET active=0, updated_at=? WHERE product_key=? AND active=1').run(t, KEY);
    if (h.hasTable('aff_links')) db.prepare('UPDATE aff_links SET archived=1 WHERE product_key=? AND archived=0').run(KEY);
    const strip = (table, col) => {
      if (!h.hasTable(table)) return;
      for (const r of db.prepare(`SELECT id, ${col} v FROM ${table} WHERE ${col} LIKE ?`).all(`%"${KEY}"%`)) {
        let list; try { list = JSON.parse(r.v); } catch { continue; }
        if (!Array.isArray(list)) continue;
        db.prepare(`UPDATE ${table} SET ${col}=? WHERE id=?`).run(JSON.stringify(list.filter((x) => String(x).toLowerCase() !== KEY)), r.id);
      }
    };
    strip('aff_contests', 'products');
    strip('aff_postbacks', 'products');
    if (h.hasTable('aff_audit')) {
      db.prepare('INSERT INTO aff_audit(actor_id,action,affiliate_id,target,before,after,created_at) VALUES(NULL,?,NULL,?,?,?,?)')
        .run('product.not_in_program', KEY, '', JSON.stringify({ reason: 'Owner decision 2026-10-05: Affleego operates separately, no commission.' }), t);
    }
  },
};
