'use strict';
/* Records the checksum of every migration in test/fixtures/migrations.lock.json. Run it ONCE, right after you add a new
 * migration:   npm run lock-migrations
 * test/safety.js fails if a locked migration's file changes later (a shipped migration must never be edited) or if a
 * migration is not locked yet. It never changes an existing entry: to "fix" a shipped migration, add a new one. */
const fs = require('node:fs');
const path = require('node:path');
const { list } = require('../src/migrate');

const file = path.join(__dirname, '..', 'test', 'fixtures', 'migrations.lock.json');
const lock = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
let added = 0;
for (const m of list()) {
  const k = String(m.version).padStart(3, '0') + '-' + m.name;
  if (lock[k]) { if (lock[k] !== m.checksum) console.log(`! ${k} changed since it was locked. Put the file back as it was and add a new migration instead.`); continue; }
  lock[k] = m.checksum; added++; console.log(`+ locked ${k}`);
}
fs.writeFileSync(file, JSON.stringify(lock, null, 2) + '\n');
console.log(added ? `${added} migration(s) locked.` : 'Nothing new to lock.');
