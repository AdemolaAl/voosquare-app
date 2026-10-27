'use strict';
/*
 * 012 Members can delete their own account from the app (App Store 5.1.1(v), Google Play account deletion).
 * Adds users.deleted_at: 0 for every account, the time of deletion for an account its owner deleted. A deleted account is
 * anonymised, never removed (orders, payments, ledgers and the audit log keep pointing at it). See src/account.js.
 * NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db, h) {
    h.addColumn('users', 'deleted_at', 'INTEGER DEFAULT 0');
  },
};
