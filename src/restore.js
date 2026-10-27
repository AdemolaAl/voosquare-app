'use strict';
/*
 * Restore a backup at start-up, without a shell (docs/CHANGING-SAFELY.md section 14).
 *   1. Railway → Variables: RESTORE_FROM=<file name in /data/backups>, for example pre-migrate-v4-2026-10-05-090000-000.db
 *   2. The service restarts. Before the database is opened, the current database is saved as
 *      /data/backups/pre-restore-<time>.db (nothing is ever thrown away), then the chosen copy replaces it.
 *   3. Remove the variable. If you forget, nothing happens again: each copy is restored once (a marker file remembers).
 * A name that does not exist, or a file that is not a VooSquare database, stops the start with a clear message.
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

const PRE_RESTORE_RE = /^pre-restore-\d{4}-\d{2}-\d{2}-\d{6}-\d{3}\.db$/;
const stamp = (t) => new Date(t).toISOString().replace(/[-:T]/g, '').replace(/^(\d{4})(\d{2})(\d{2})(\d{6})\.(\d{3})Z$/, '$1-$2-$3-$4-$5');

function stop(msg) {
  console.error(`\n================ VooSquare did NOT start ================\nRESTORE_FROM: ${msg}\nNothing was changed. Fix or remove the RESTORE_FROM variable and restart.\n=========================================================\n`);
  process.exit(1);
}

/** Runs before the database is opened. Returns what it did (or null). */
function maybeRestore(env = process.env) {
  const want = String(env.RESTORE_FROM || '').trim();
  if (!want) return null;
  const file = path.isAbsolute(want) ? want : path.join(config.backupsDir, path.basename(want));
  // Checked first: the restored copy may since have been rotated away, and a forgotten variable must never stop the app.
  const marker = path.join(config.backupsDir, `.restored-${path.basename(file)}`);
  if (fs.existsSync(marker)) {
    console.warn(`[restore] RESTORE_FROM=${want} was already restored (${fs.readFileSync(marker, 'utf8').trim()}). Remove the variable. Starting normally.`);
    return { skipped: true };
  }
  if (!fs.existsSync(file)) stop(`${file} does not exist. Use a file name from Admin → Settings → Backups.`);
  // It must be a VooSquare database.
  const head = Buffer.alloc(16); const fd = fs.openSync(file, 'r'); fs.readSync(fd, head, 0, 16, 0); fs.closeSync(fd);
  if (head.toString('latin1') !== 'SQLite format 3\u0000') stop(`${file} is not a database file.`);
  try { const c = new DatabaseSync(file, { readOnly: true }); const ok = c.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get(); c.close(); if (!ok) throw new Error('no users table'); } catch (e) { stop(`${file} is not a VooSquare database (${e.message}).`); }

  fs.mkdirSync(config.backupsDir, { recursive: true });
  let saved = '';
  if (fs.existsSync(config.dbPath)) {
    // Keep the current state (WAL included) before replacing it: a restore never loses anything either.
    saved = path.join(config.backupsDir, `pre-restore-${stamp(Date.now())}.db`);
    const cur = new DatabaseSync(config.dbPath);
    cur.exec(`VACUUM INTO '${saved.replace(/'/g, "''")}'`);
    cur.close();
  }
  const tmp = config.dbPath + '.restoring';
  fs.copyFileSync(file, tmp);
  for (const f of [config.dbPath + '-wal', config.dbPath + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
  fs.renameSync(tmp, config.dbPath);
  const note = `restored ${path.basename(file)} at ${new Date().toISOString()}${saved ? `; the database before it is ${path.basename(saved)}` : ''}`;
  fs.writeFileSync(marker, note + '\n');
  console.log(`[restore] ${note}. Remove RESTORE_FROM now.`);
  return { file, saved, note };
}

/** Copies saved just before a restore, for Admin → Backups. Never deleted automatically. */
function preRestoreBackups() {
  let names = [];
  try { names = fs.readdirSync(config.backupsDir).filter((n) => PRE_RESTORE_RE.test(n)); } catch { return []; }
  return names.map((name) => { try { const s = fs.statSync(path.join(config.backupsDir, name)); return { name, kind: 'pre-restore', bytes: s.size, created_at: Math.floor(s.mtimeMs) }; } catch { return null; } }).filter(Boolean);
}

module.exports = { maybeRestore, preRestoreBackups, PRE_RESTORE_RE };
