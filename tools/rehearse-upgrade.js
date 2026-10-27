'use strict';
/*
 * Rehearse an update on a COPY of production data, on your own computer, before you deploy.
 *   1. Admin → Settings → Backups → Download backup (a .db file).
 *   2. npm run rehearse -- /path/to/voosquare-2026-10-05-0900.db
 * It copies the file to a temporary folder (your download is never changed), starts THIS code on the copy with
 * SAFE_COPY=1 (no emails, no affiliate jobs), waits for /healthz, prints what the database upgrade did, stops, and
 * says PASS or FAIL. Add --keep to leave the server running on http://localhost:4699 so you can click around.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const src = process.argv.slice(2).find((a) => !a.startsWith('--'));
const keep = process.argv.includes('--keep');
if (!src || !fs.existsSync(src)) { console.error('Usage: npm run rehearse -- /path/to/backup.db [--keep]'); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voosquare-rehearse-'));
const db = path.join(dir, 'voosquare.db');
fs.copyFileSync(src, db);
const port = keep ? 4699 : 4700 + Math.floor(Math.random() * 200);
const healthKey = require('node:crypto').randomBytes(16).toString('hex'); // /healthz details need it (PT-4)
console.log(`Copy of ${src} → ${db}\nStarting this code on the copy (SAFE_COPY=1, port ${port})...\n`);
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(port), DATABASE_PATH: db, BACKUPS_DIR: path.join(dir, 'backups'), UPLOADS_DIR: path.join(dir, 'uploads'), SAFE_COPY: '1', NODE_ENV: 'development', BASE_URL: `http://localhost:${port}`, HEALTH_KEY: healthKey },
});
srv.stdout.on('data', (d) => process.stdout.write('  | ' + String(d).replace(/\n(?=.)/g, '\n  | ')));
srv.stderr.on('data', (d) => process.stdout.write('  ! ' + String(d).replace(/\n(?=.)/g, '\n  ! ')));
let exited = null; srv.on('exit', (c) => { exited = c; });
(async () => {
  let h = null;
  for (let i = 0; i < 600 && exited === null; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/healthz`, { headers: { 'x-health-key': healthKey } }); h = await r.json(); if (r.ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const ok = exited === null && h && h.ok;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}: ${ok ? `healthy, database version ${h.schema.version}` : exited !== null ? `the app stopped (exit ${exited}); read the lines above` : 'no healthy answer from /healthz'}`);
  if (ok && keep) { console.log(`Still running on http://localhost:${port} (log in with your owner email; the code prints in this window). Ctrl+C to stop.`); return; }
  srv.kill('SIGTERM');
  setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(ok ? 0 : 1); }, 800);
})();
