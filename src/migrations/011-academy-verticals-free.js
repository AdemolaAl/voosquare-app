'use strict';
/*
 * 011 VooSquare Academy is free: the five built-in vertical schools (Nutra, iGaming, Trading, Finance, Sweepstakes)
 * stop being Premium. Premium keeps the community rooms and tools. Runs once; afterwards the team can still mark any
 * school Premium again in Admin → VooSquare Academy (the switch on each school).
 * Data only (one UPDATE on five known rows), nothing removed. NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db, h) {
    if (!h.hasTable('school_schools')) return;
    db.prepare("UPDATE school_schools SET premium=0 WHERE track='vertical' AND slug IN ('v-nutra','v-igaming','v-trading','v-finance','v-sweeps')").run();
  },
};
