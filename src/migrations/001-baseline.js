'use strict';
/*
 * 001 baseline. Nothing to run: it records that this database has the schema the modules build when they load
 * (CREATE TABLE IF NOT EXISTS and guarded ADD COLUMN in src/db.js, features.js, school.js, voice.js and aff/core.js, as
 * of October 2026). Databases made before versioned migrations get this row on their first start with the new code.
 * Every change after this point is a new numbered file. NEVER EDIT THIS FILE.
 */
module.exports = {
  up() {},
};
