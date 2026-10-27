'use strict';
/*
 * 009 Voo School content made in the admin (Admin → Voo School → Add school / Add module / Add lesson).
 *  - school_schools.source, school_modules.source, school_lessons.source: 'file' (from src/seed/school, the default for
 *    every existing row) or 'admin' (made in the admin, lives only in the database). Reloading content from files never
 *    hides, overwrites, renames or reorders an 'admin' row, and a file can never take over an 'admin' slug.
 *  - school_schools.requires: for an admin-made school, the slug of the school whose certificate members need first
 *    ('' = open to everyone). File schools keep their built-in order (main path, verticals, extras) and ignore it.
 * Additive only. NEVER EDIT THIS FILE after it has shipped: add a new migration.
 */
module.exports = {
  up(db, h) {
    for (const t of ['school_schools', 'school_modules', 'school_lessons']) {
      if (h.hasTable(t)) h.addColumn(t, 'source', "TEXT DEFAULT 'file'");
    }
    if (h.hasTable('school_schools')) h.addColumn('school_schools', 'requires', "TEXT DEFAULT ''");
  },
};
