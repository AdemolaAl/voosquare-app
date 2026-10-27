'use strict';
/*
 * 002 price locks (grandfathering). When the team changes the Premium price or a paid room's price, people who are
 * already paying keep their price and period until they let it lapse; new people pay the new price.
 *  - orders.period_days: the access days the member was sold (snapshot). NULL on older orders (use today's period).
 *  - orders.terms: JSON snapshot of what was sold ({ price_usd, period_days, name, features, locked }).
 *  - price_locks: one row per member and item with the price and period they keep. See src/payments.js priceFor().
 * Backfill: everyone with active Premium or an active paid room is locked at what their latest paid order cost.
 * NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db, h) {
    h.addColumn('orders', 'period_days', 'INTEGER');
    h.addColumn('orders', 'terms', "TEXT DEFAULT ''");
    db.exec(`CREATE TABLE IF NOT EXISTS price_locks(
      user_id INTEGER NOT NULL, item_type TEXT NOT NULL, item_id INTEGER NOT NULL DEFAULT 0,
      price_usd REAL NOT NULL, period_days INTEGER NOT NULL DEFAULT 0, item_name TEXT DEFAULT '', features TEXT DEFAULT '[]',
      order_id INTEGER, locked_at INTEGER, updated_at INTEGER,
      PRIMARY KEY(user_id, item_type, item_id)
    );`);
    const t = Date.now();
    let premium = {};
    try { premium = JSON.parse((db.prepare("SELECT value FROM settings WHERE key='premium'").get() || {}).value || '{}') || {}; } catch { /* default */ }
    const pDays = Number(premium.period_days) || 30;
    const ins = db.prepare(`INSERT OR IGNORE INTO price_locks(user_id,item_type,item_id,price_usd,period_days,item_name,features,order_id,locked_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`);
    // Active Premium members: their latest paid Premium order.
    for (const o of db.prepare(`SELECT o.* FROM orders o JOIN users u ON u.id=o.user_id
        WHERE o.item_type='premium' AND o.status='paid' AND u.premium_until>? AND o.amount_usd>0
        AND o.id=(SELECT MAX(id) FROM orders WHERE user_id=o.user_id AND item_type='premium' AND status='paid')`).all(t)) {
      ins.run(o.user_id, 'premium', 0, o.amount_usd, pDays, o.item_name || '', JSON.stringify(premium.features || []), o.id, t, t);
    }
    // Active paid-room members: their latest paid order for that room.
    for (const o of db.prepare(`SELECT o.*, r.period_days room_days FROM orders o JOIN room_access a ON a.user_id=o.user_id AND a.room_id=o.item_id
        JOIN rooms r ON r.id=o.item_id
        WHERE o.item_type='room' AND o.status='paid' AND a.until>? AND o.amount_usd>0
        AND o.id=(SELECT MAX(id) FROM orders WHERE user_id=o.user_id AND item_type='room' AND item_id=o.item_id AND status='paid')`).all(t)) {
      ins.run(o.user_id, 'room', o.item_id, o.amount_usd, Number(o.room_days) || 0, o.item_name || '', '[]', o.id, t, t);
    }
  },
};
