'use strict';
/*
 * VooSquare Academy: the structured, paced course inside the Academy (docs/SCHOOL_BRIEF.md).
 *
 * Three schools taken in order (foundations → operator → scale). A school has modules, a module has lessons.
 * Content lives in src/seed/school/<school>/<NN>-<module>.json and is loaded on boot (and from the admin). A lesson the
 * team edited in the admin is never overwritten by the files.
 *
 * Pacing: modules open in order. Module N+1 opens when module N's exam is passed AND `unlock_hours` (setting
 * school.unlock_hours, default 20, 0 = off) have passed since module N opened. Lessons inside an open module are
 * sequential (pass the quiz to open the next). School 2 needs the School 1 certificate, School 3 the School 2 one.
 *
 * Grading is server-side only. Members get questions with shuffled options that carry opaque ids (an HMAC of the
 * question key and the option text); the answer index never leaves the server.
 *  - lesson quiz: 5 questions, pass 80% (4/5), retry at once
 *  - module exam: 10 questions, pass 80%, retry after 1 hour
 *  - school final: 25 questions drawn from the school's module exams and lesson quizzes, pass 80%, retry after 24 hours
 * Passing a final issues a certificate (PDF from src/pdf.js, PNG drawn in the browser, public page at /verify/<code>).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
const D = require('./db');
const A = require('./auth');
const mailer = require('./mailer');
const { now, fail, json, clean, sha256, hmac, esc, limit } = require('./util');

const HOUR = 3600_000;
const CONTENT_DIR = path.join(__dirname, 'seed', 'school');
const PASS = 0.8;
const LESSON_Q = 5;
const EXAM_Q = 10;
const FINAL_Q = 25;
const EXAM_COOLDOWN = HOUR;
const FINAL_COOLDOWN = 24 * HOUR;
const PAPER_TTL = 6 * HOUR;
const XP = { lesson: 50, exam: 150, final: 500 };
const DEFAULT_SETTINGS = { unlock_hours: 20, verticals_any: true };

/** The three schools. Title, subtitle and level are only written when a school is first created; the team edits the rest. */
const SCHOOLS = [
  { slug: 'foundations', title: 'Media Buying Foundations', subtitle: 'Media Buying 101: how the money works, traffic, the numbers, funnels, tracking, compliance and your first campaign.', level: 'Beginner', sort: 1, cert_title: 'Certificate — Media Buying Foundations' },
  { slug: 'operator', title: 'The Operator', subtitle: 'Verticals, Meta in depth, creative strategy, landers and Telegram, advanced tracking, testing and geos.', level: 'Intermediate', sort: 2, cert_title: 'Certificate — Operator' },
  { slug: 'scale', title: 'Scale and Lead', subtitle: 'Scaling, infrastructure and risk, running a team, unit economics, retention and a full campaign plan.', level: 'Advanced', sort: 3, cert_title: 'Certificate of Completion — VooSquare Academy' },
  /* Vertical schools: free by default, entered after "Picking your vertical" (the team can mark any school Premium in the admin). */
  { slug: 'v-nutra', vertical: 'nutra', track: 'vertical', premium: 0, title: 'Nutra', subtitle: 'Health and wellness offers: claims you can legally make, COD and trial funnels, approval rates and compliant creatives.', level: 'Vertical', sort: 11, cert_title: 'Vertical Specialist — Nutra' },
  { slug: 'v-igaming', vertical: 'igaming', track: 'vertical', premium: 0, title: 'iGaming and casino', subtitle: 'Sports betting and casino: licensing and ad authorization, player value, FTD and RevShare deals, retention.', level: 'Vertical', sort: 12, cert_title: 'Vertical Specialist — iGaming' },
  { slug: 'v-trading', vertical: 'trading', track: 'vertical', premium: 0, title: 'Trading', subtitle: 'Forex, CFDs and crypto exchanges: financial ad rules, KYC funnels, qualified FTDs and what to stay away from.', level: 'Vertical', sort: 13, cert_title: 'Vertical Specialist — Trading' },
  { slug: 'v-finance', vertical: 'finance', track: 'vertical', premium: 0, title: 'Finance', subtitle: 'Loans, credit cards, insurance and banking leads: regulated claims, forms, lead quality and payout models.', level: 'Vertical', sort: 14, cert_title: 'Vertical Specialist — Finance' },
  { slug: 'v-sweeps', vertical: 'sweeps', track: 'vertical', premium: 0, title: 'Sweepstakes and lead gen', subtitle: 'Sweepstakes, SOI and DOI lead generation, CPL offers, honest flows and the quality checks networks run.', level: 'Vertical', sort: 15, cert_title: 'Vertical Specialist — Sweepstakes' },
];
const VERTICALS = ['nutra', 'igaming', 'trading', 'finance', 'sweeps'];
const PARTNER_VERTICALS = [...VERTICALS, 'general'];
const VERTICAL_ACCENT = { nutra: '#3FAE5A', igaming: '#E8458B', trading: '#3D6BF2', finance: '#E8AE18', sweeps: '#EE5A2F' };

/* Slide types the player draws (public/js/lesson-visuals.js). */
const STEP_TYPES = ['big', 'stat', 'flow', 'eq', 'check', 'quote', 'bars', 'funnel', 'cards', 'curve', 'compare', 'chat', 'table', 'tip', 'phone', 'screen', 'walk', 'map', 'code', 'lab', 'photo', 'product', 'partner'];

/* ------------------------------------------------------------------ schema (guarded) */
D.db.exec(`
CREATE TABLE IF NOT EXISTS school_schools(
  id INTEGER PRIMARY KEY, slug TEXT UNIQUE NOT NULL, title TEXT, subtitle TEXT DEFAULT '', level TEXT DEFAULT '',
  sort INTEGER DEFAULT 0, premium INTEGER DEFAULT 0, cert_title TEXT DEFAULT '', published INTEGER DEFAULT 1, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS school_modules(
  id INTEGER PRIMARY KEY, school_id INTEGER NOT NULL, slug TEXT NOT NULL, title TEXT, summary TEXT DEFAULT '', sort INTEGER DEFAULT 0,
  exam TEXT DEFAULT '[]', published INTEGER DEFAULT 1, file TEXT DEFAULT '', updated_at INTEGER, UNIQUE(school_id, slug)
);
CREATE TABLE IF NOT EXISTS school_lessons(
  id INTEGER PRIMARY KEY, module_id INTEGER NOT NULL, slug TEXT NOT NULL, idx INTEGER DEFAULT 0, title TEXT, minutes INTEGER DEFAULT 10,
  objectives TEXT DEFAULT '[]', steps TEXT DEFAULT '[]', takeaways TEXT DEFAULT '[]', action TEXT DEFAULT '', glossary TEXT DEFAULT '[]',
  quiz TEXT DEFAULT '[]', published INTEGER DEFAULT 1, edited INTEGER DEFAULT 0, src_hash TEXT DEFAULT '', updated_at INTEGER,
  UNIQUE(module_id, slug)
);
CREATE INDEX IF NOT EXISTS ix_school_lessons_mod ON school_lessons(module_id, idx);
CREATE TABLE IF NOT EXISTS school_progress(
  user_id INTEGER NOT NULL, lesson_id INTEGER NOT NULL, best_score INTEGER DEFAULT 0, total INTEGER DEFAULT 0, attempts INTEGER DEFAULT 0,
  passed_at INTEGER, last_at INTEGER, granted INTEGER DEFAULT 0, PRIMARY KEY(user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS school_enrollments(user_id INTEGER NOT NULL, school_id INTEGER NOT NULL, started_at INTEGER, PRIMARY KEY(user_id, school_id));
CREATE TABLE IF NOT EXISTS school_module_state(
  user_id INTEGER NOT NULL, module_id INTEGER NOT NULL, started_at INTEGER, passed_at INTEGER, skip_wait_at INTEGER, granted INTEGER DEFAULT 0,
  PRIMARY KEY(user_id, module_id)
);
CREATE TABLE IF NOT EXISTS school_attempts(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, score INTEGER, total INTEGER,
  passed INTEGER DEFAULT 0, xp INTEGER DEFAULT 0, at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_school_attempts_user ON school_attempts(user_id, kind, ref_id, at);
CREATE TABLE IF NOT EXISTS school_papers(
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, qkeys TEXT DEFAULT '[]',
  created_at INTEGER, submitted_at INTEGER
);
CREATE TABLE IF NOT EXISTS school_grants(user_id INTEGER NOT NULL, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, by_id INTEGER, at INTEGER, PRIMARY KEY(user_id, kind, ref_id));
CREATE TABLE IF NOT EXISTS school_certificates(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, school_id INTEGER NOT NULL, code TEXT UNIQUE NOT NULL, name TEXT DEFAULT '',
  title TEXT DEFAULT '', name_changes INTEGER DEFAULT 0, issued_at INTEGER, revoked_at INTEGER DEFAULT 0, revoked_reason TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_school_certs_user ON school_certificates(user_id, school_id);
CREATE TABLE IF NOT EXISTS school_students(user_id INTEGER PRIMARY KEY, number TEXT UNIQUE, created_at INTEGER);
CREATE TABLE IF NOT EXISTS school_prefs(user_id INTEGER PRIMARY KEY, vertical TEXT DEFAULT '', chosen_at INTEGER);
CREATE TABLE IF NOT EXISTS school_partners(
  id INTEGER PRIMARY KEY, vertical TEXT NOT NULL, name TEXT NOT NULL, logo_upload TEXT DEFAULT '', description TEXT DEFAULT '',
  highlights TEXT DEFAULT '[]', url TEXT DEFAULT '', cta TEXT DEFAULT '', badge TEXT DEFAULT '', sort INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1,
  clicks INTEGER DEFAULT 0, last_click_at INTEGER, created_at INTEGER, updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_school_partners_v ON school_partners(vertical, enabled, sort);
`);
/* Columns added in v3 (guarded: only when missing). */
function addCol(table, col, decl) { if (!D.db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) D.db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${decl}`); }
addCol('school_schools', 'track', "TEXT DEFAULT 'main'");
addCol('school_schools', 'vertical', "TEXT DEFAULT ''");
addCol('school_lessons', 'steps_n', 'INTEGER DEFAULT 0');
addCol('school_modules', 'exam_n', 'INTEGER DEFAULT 0');
/* Teaching voice (src/voice.js): the spoken intro and outro, and each file slide's `say` with its type. The file's
 * narration is kept here even for lessons the team edited, so narration added to a file later still reaches them. */
addCol('school_lessons', 'say_intro', "TEXT DEFAULT ''");
addCol('school_lessons', 'say_outro', "TEXT DEFAULT ''");
addCol('school_lessons', 'say_src', "TEXT DEFAULT '[]'");
D.db.exec("UPDATE school_lessons SET steps_n=json_array_length(steps) WHERE steps_n=0 AND json_valid(steps)");
D.db.exec("UPDATE school_modules SET exam_n=json_array_length(exam) WHERE exam_n=0 AND json_valid(exam)");

/* ------------------------------------------------------------------ helpers */
const settings = () => ({ ...DEFAULT_SETTINGS, ...(D.getSetting('school', {}) || {}) });
const unlockMs = () => Math.max(0, Number(settings().unlock_hours) || 0) * HOUR;
const isStaff = (u) => !!u && A.can(u, 'academy');
const premiumOk = (u) => !!u && (u.premium || isStaff(u));
/** Can this member choose a vertical? Premium and staff always; everyone else when at least one published vertical school is free. */
const canChooseVertical = (u) => !!u && (premiumOk(u) || D.all("SELECT premium FROM school_schools WHERE track='vertical' AND published=1").some((s) => !s.premium));

/** The request's clock. Tests may send x-vs-now (only when NODE_ENV=test) to move time forward. */
function clock(ctx) {
  if (process.env.NODE_ENV === 'test' && ctx && ctx.req && ctx.req.headers['x-vs-now']) {
    const t = Number(ctx.req.headers['x-vs-now']);
    if (Number.isFinite(t) && t > 0) return t;
  }
  return now();
}

/** Opaque option id: the answer index never leaves the server, and ids cannot be derived without the app secret. */
const optId = (qkey, text) => hmac(D.secret(), 'school-opt|' + qkey + '|' + String(text)).slice(0, 12);
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
/** Normalise one quiz/exam question from a content file. Returns null when it cannot be graded. */
function normQ(q) {
  if (!q || typeof q !== 'object') return null;
  const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(typeof o === 'string' || typeof o === 'number' ? o : (o && o.text) || '').trim());
  const answer = Number(q.answer);
  if (!String(q.q || '').trim() || options.length < 2 || options.some((o) => !o) || new Set(options).size !== options.length) return null;
  if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) return null;
  return { q: String(q.q).trim(), options, answer, why: String(q.why || q.explain || q.explanation || '').trim() };
}
/** What a member gets: question text and shuffled options with ids. No answer, no why. */
const publicQ = (key, q) => ({ id: key, q: q.q, options: shuffle(q.options.map((t) => ({ id: optId(key, t), text: t }))) });
const correctId = (key, q) => optId(key, q.options[q.answer]);
/** A lesson's quiz for a member: the first 5 gradable questions, options shuffled. Keys keep the question's position. */
const lessonQuiz = (l) => json(l.quiz, []).slice(0, LESSON_Q).map((q, i) => ({ key: `L${l.id}.${i}`, q: normQ(q) })).filter((x) => x.q).map((x) => publicQ(x.key, x.q));

/* ------------------------------------------------------------------ content loader */
function validateStep(s, where) {
  if (!s || typeof s !== 'object') return `${where}: not an object`;
  if (!STEP_TYPES.includes(s.v)) return `${where}: unknown slide type "${s.v}"`;
  if (s.v !== 'photo' && s.d === undefined) return `${where}: missing d`;
  return '';
}
/** Validate one module file. Returns { error } or { mod } with normalised lessons and exam. */
function validateModule(j, schoolsBySlug) {
  if (!j || typeof j !== 'object') return { error: 'not a JSON object' };
  if (!schoolsBySlug[j.school]) return { error: `unknown school "${j.school}"` };
  const order = Number(j.order);
  if (!Number.isInteger(order) || order < 0) return { error: 'order must be a whole number' };
  if (!/^[a-z0-9-]{2,80}$/.test(String(j.slug || ''))) return { error: 'slug must be lower-case letters, numbers and dashes' };
  if (!String(j.title || '').trim()) return { error: 'missing title' };
  if (!Array.isArray(j.lessons) || !j.lessons.length) return { error: 'no lessons' };
  const slugs = new Set();
  const lessons = [];
  for (let i = 0; i < j.lessons.length; i++) {
    const l = j.lessons[i];
    const w = `lesson ${i + 1}`;
    if (!l || typeof l !== 'object') return { error: `${w}: not an object` };
    if (!/^[a-z0-9-]{2,80}$/.test(String(l.slug || ''))) return { error: `${w}: bad slug` };
    if (slugs.has(l.slug)) return { error: `${w}: duplicate slug ${l.slug}` };
    slugs.add(l.slug);
    if (!String(l.title || '').trim()) return { error: `${w}: missing title` };
    if (!Array.isArray(l.steps) || !l.steps.length) return { error: `${w}: no steps` };
    for (let k = 0; k < l.steps.length; k++) { const e = validateStep(l.steps[k], `${w} step ${k + 1}`); if (e) return { error: e }; }
    if (!Array.isArray(l.quiz) || !l.quiz.length) return { error: `${w}: no quiz` };
    const quiz = [];
    for (let k = 0; k < l.quiz.length; k++) { const q = normQ(l.quiz[k]); if (!q) return { error: `${w} quiz ${k + 1}: needs q, 2+ different options and an answer index in range` }; quiz.push(q); }
    // A photo slide only shows when its picture exists in /public; others are dropped (with a note in the load report).
    const steps = l.steps.filter((s) => s.v !== 'photo' || (s.d && typeof s.d.src === 'string' && /^[\w./-]+$/.test(s.d.src) && !s.d.src.includes('..') && fs.existsSync(path.join(config.publicDir, s.d.src.replace(/^\/+/, '')))));
    lessons.push({
      slug: l.slug, title: clean(l.title, 140), minutes: Math.max(1, Math.min(120, Number(l.minutes) || 10)),
      objectives: (Array.isArray(l.objectives) ? l.objectives : []).map((x) => String(x)).slice(0, 10),
      steps, takeaways: (Array.isArray(l.takeaways) ? l.takeaways : []).map((x) => String(x)).slice(0, 12),
      action: String(l.action || ''), glossary: (Array.isArray(l.glossary) ? l.glossary : []).filter((g) => g && g.term).map((g) => ({ term: String(g.term), def: String(g.def || '') })),
      quiz, dropped: l.steps.length - steps.length,
      say_intro: sayText(l.say_intro), say_outro: sayText(l.say_outro),
      was: wasList(l.was),
    });
  }
  const exam = [];
  for (let k = 0; k < (Array.isArray(j.exam) ? j.exam.length : 0); k++) { const q = normQ(j.exam[k]); if (!q) return { error: `exam ${k + 1}: needs q, 2+ different options and an answer index in range` }; exam.push(q); }
  if (!exam.length) return { error: 'no exam questions' };
  return { mod: { school: j.school, order, slug: j.slug, title: clean(j.title, 140), summary: String(j.summary || ''), lessons, exam, was: wasList(j.was) } };
}

/** Old slugs of a renamed lesson or module (`"was": ["old-slug"]` in the file): the existing row, and everyone's
 * progress on it, moves to the new slug instead of a new empty lesson appearing. Slugs are IDs: see docs/CHANGING-SAFELY.md. */
const wasList = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(String).filter((x) => /^[a-z0-9-]{2,80}$/.test(x)).slice(0, 10);
/** Narration text from a content file: a string, trimmed and capped (an ElevenLabs request takes up to 5,000 characters). */
const sayText = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, 4000) : '');
/** The file's narration per slide, with each slide's type and heading (an edited lesson takes it only where the slide still matches). */
const saySrc = (steps) => JSON.stringify(steps.map((st) => ({ v: st.v, h: String(st.h || '').slice(0, 200), say: sayText(st.say) })));
const lessonHash = (l) => sha256(JSON.stringify([l.title, l.minutes, l.objectives, l.steps, l.takeaways, l.action, l.glossary, l.quiz])).slice(0, 32);

/** Content directories: the school folder, plus SCHOOL_EXTRA_DIR (tests and previews; may define extra schools with school.json). */
function contentDirs() {
  const dirs = [CONTENT_DIR];
  if (process.env.SCHOOL_EXTRA_DIR) dirs.push(...process.env.SCHOOL_EXTRA_DIR.split(path.delimiter).filter(Boolean));
  return dirs;
}

/**
 * Load every module file into the database. Files are read in school order, then by `order`, then by file name.
 * New schools, modules and lessons are added; changed lessons are updated unless the team edited them in the admin;
 * lessons that disappeared from a file are hidden (published=0), never deleted, so nobody loses progress.
 */
function load({ quiet = false } = {}) {
  const t = now();
  const report = { at: t, files: 0, modules: 0, lessons_added: 0, lessons_updated: 0, lessons_kept: 0, lessons_hidden: 0, skipped: [], notes: [] };
  const defs = SCHOOLS.map((s) => ({ ...s }));
  const files = [];
  for (const dir of contentDirs()) {
    let schoolDirs = [];
    try { schoolDirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const sd of schoolDirs) {
      const full = path.join(dir, sd);
      const metaFile = path.join(full, 'school.json');
      if (fs.existsSync(metaFile)) {
        try {
          const m = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
          if (m && /^[a-z0-9-]{2,40}$/.test(m.slug || '') && !defs.find((x) => x.slug === m.slug)) defs.push({ slug: m.slug, title: clean(m.title, 80) || m.slug, subtitle: clean(m.subtitle, 300), level: clean(m.level, 30), sort: Number(m.sort) || defs.length + 1, cert_title: clean(m.cert_title, 120) || 'Certificate', published: m.published === false ? 0 : 1, track: ['main', 'vertical', 'extra'].includes(m.track) ? m.track : 'extra', vertical: VERTICALS.includes(m.vertical) ? m.vertical : '', premium: m.premium ? 1 : 0 });
        } catch (e) { report.skipped.push({ file: path.relative(process.cwd(), metaFile), error: 'school.json: ' + e.message }); }
      }
      for (const f of fs.readdirSync(full).filter((x) => x.endsWith('.json') && x !== 'school.json').sort()) files.push({ file: path.join(full, f), dir: sd });
    }
  }
  // Schools: insert once with the defaults; the team owns published, premium and the certificate title afterwards.
  for (const s of defs) {
    if (!D.get('SELECT 1 FROM school_schools WHERE slug=?', s.slug)) {
      D.insert('school_schools', { slug: s.slug, title: s.title, subtitle: s.subtitle || '', level: s.level || '', sort: s.sort, premium: s.premium ? 1 : 0, cert_title: s.cert_title, published: s.published === 0 ? 0 : 1, track: s.track || 'main', vertical: s.vertical || '', created_at: t });
    } else D.run("UPDATE school_schools SET track=?, vertical=? WHERE slug=? AND COALESCE(source,'file')<>'admin' AND (track IS NULL OR track='' OR track<>? OR vertical<>?)", s.track || 'main', s.vertical || '', s.slug, s.track || 'main', s.vertical || '');
  }
  const schoolsBySlug = Object.fromEntries(D.all('SELECT * FROM school_schools').map((s) => [s.slug, s]));
  const parsed = [];
  for (const { file } of files) {
    report.files++;
    const rel = path.relative(path.join(__dirname, '..'), file);
    let j;
    try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { report.skipped.push({ file: rel, error: 'invalid JSON: ' + e.message.slice(0, 160) }); continue; }
    const v = validateModule(j, schoolsBySlug);
    if (v.error) { report.skipped.push({ file: rel, error: v.error }); continue; }
    parsed.push({ ...v.mod, rel });
  }
  parsed.sort((a, b) => (schoolsBySlug[a.school].sort - schoolsBySlug[b.school].sort) || (a.order - b.order) || a.rel.localeCompare(b.rel));
  parsed.forEach((m, i) => { const p = parsed[i - 1]; if (p && p.school === m.school && p.order === m.order) report.notes.push(`${m.school}: ${p.rel} and ${m.rel} both use order ${m.order}; they run in file-name order`); });
  D.tx(() => {
    for (const m of parsed) {
      const school = schoolsBySlug[m.school];
      let mod = D.get('SELECT * FROM school_modules WHERE school_id=? AND slug=?', school.id, m.slug);
      // A module made in the admin owns its slug: a file can never take it over (it would overwrite the team's work).
      if (mod && mod.source === 'admin') { report.notes.push(`${m.rel}: skipped, the slug ${m.slug} belongs to a module made in the admin`); continue; }
      if (!mod && m.was.length) {
        // Renamed module: keep its id (exams, members' module state) and take the new slug.
        const old = D.get(`SELECT * FROM school_modules WHERE school_id=? AND slug IN (${m.was.map(() => '?').join(',')}) AND COALESCE(source,'file')<>'admin' ORDER BY id LIMIT 1`, school.id, ...m.was);
        if (old) { D.run('UPDATE school_modules SET slug=? WHERE id=?', m.slug, old.id); mod = { ...old, slug: m.slug }; report.notes.push(`${m.rel}: module ${old.slug} renamed to ${m.slug} (progress kept)`); }
      }
      if (mod) D.run('UPDATE school_modules SET title=?, summary=?, sort=?, exam=?, exam_n=?, file=?, published=1, updated_at=? WHERE id=?', m.title, m.summary, m.order, JSON.stringify(m.exam), m.exam.length, m.rel, t, mod.id);
      else mod = { id: D.insert('school_modules', { school_id: school.id, slug: m.slug, title: m.title, summary: m.summary, sort: m.order, exam: JSON.stringify(m.exam), exam_n: m.exam.length, published: 1, file: m.rel, updated_at: t }).id };
      report.modules++;
      const seen = new Set();
      m.lessons.forEach((l, i) => {
        seen.add(l.slug);
        if (l.dropped) report.notes.push(`${m.rel}: ${l.slug}: ${l.dropped} photo slide(s) dropped (picture not found)`);
        const h = lessonHash(l);
        let row = D.get('SELECT id, edited, src_hash, published, source FROM school_lessons WHERE module_id=? AND slug=?', mod.id, l.slug);
        // Lessons made in the admin are never touched by the files (not even their position).
        if (row && row.source === 'admin') { report.notes.push(`${m.rel}: lesson ${l.slug} skipped, the slug belongs to a lesson made in the admin`); return; }
        if (!row && l.was.length) {
          // Renamed (or moved within this school): the same row, so every member's progress and quiz history stays.
          const old = D.get(`SELECT id, slug FROM school_lessons WHERE slug IN (${l.was.map(() => '?').join(',')}) AND COALESCE(source,'file')<>'admin' AND module_id IN (SELECT id FROM school_modules WHERE school_id=?) AND NOT EXISTS (SELECT 1 FROM school_lessons x WHERE x.module_id=? AND x.slug=?) ORDER BY id LIMIT 1`, ...l.was, school.id, mod.id, l.slug);
          if (old) {
            D.run('UPDATE school_lessons SET module_id=?, slug=? WHERE id=?', mod.id, l.slug, old.id);
            row = D.get('SELECT id, edited, src_hash, published FROM school_lessons WHERE id=?', old.id);
            report.lessons_renamed = (report.lessons_renamed || 0) + 1;
            report.notes.push(`${m.rel}: lesson ${old.slug} renamed to ${l.slug} (progress kept)`);
          }
        }
        const say = { say_intro: l.say_intro, say_outro: l.say_outro, say_src: saySrc(l.steps) };
        const fields = { idx: i, title: l.title, minutes: l.minutes, objectives: JSON.stringify(l.objectives), steps: JSON.stringify(l.steps), steps_n: l.steps.length, takeaways: JSON.stringify(l.takeaways), action: l.action, glossary: JSON.stringify(l.glossary), quiz: JSON.stringify(l.quiz), src_hash: h, updated_at: t };
        if (!row) { D.insert('school_lessons', { module_id: mod.id, slug: l.slug, published: 1, edited: 0, ...fields, ...say }); report.lessons_added++; }
        else if (row.edited) { report.lessons_kept++; D.run('UPDATE school_lessons SET idx=?, say_intro=?, say_outro=?, say_src=? WHERE id=?', i, say.say_intro, say.say_outro, say.say_src, row.id); }
        else if (row.src_hash !== h || !row.published) { D.update('school_lessons', row.id, { ...fields, ...say, published: 1 }, [...Object.keys(fields), ...Object.keys(say), 'published']); report.lessons_updated++; }
        else D.run('UPDATE school_lessons SET idx=?, say_intro=?, say_outro=?, say_src=? WHERE id=?', i, say.say_intro, say.say_outro, say.say_src, row.id);
      });
      for (const old of D.all("SELECT id, slug FROM school_lessons WHERE module_id=? AND published=1 AND edited=0 AND COALESCE(source,'file')<>'admin'", mod.id)) {
        if (!seen.has(old.slug)) { D.run('UPDATE school_lessons SET published=0 WHERE id=?', old.id); report.lessons_hidden++; }
      }
    }
  });
  // A module whose file is gone (deleted or merged) is hidden, never deleted. A broken file keeps its module as it was.
  const seenMods = new Set(parsed.map((m) => schoolsBySlug[m.school].id + '/' + m.slug));
  report.modules_hidden = 0;
  for (const m of D.all("SELECT id, school_id, slug, file FROM school_modules WHERE published=1 AND COALESCE(source,'file')<>'admin'")) {
    if (seenMods.has(m.school_id + '/' + m.slug)) continue;
    if (m.file && fs.existsSync(path.join(__dirname, '..', m.file))) continue;
    D.run('UPDATE school_modules SET published=0 WHERE id=?', m.id); report.modules_hidden++;
  }
  report.totals = D.get('SELECT (SELECT COUNT(*) FROM school_schools) schools, (SELECT COUNT(*) FROM school_modules WHERE published=1) modules, (SELECT COUNT(*) FROM school_lessons WHERE published=1) lessons, (SELECT COALESCE(SUM(steps_n),0) FROM school_lessons WHERE published=1) slides');
  D.setSetting('school_last_load', report);
  bust();
  if (!quiet) {
    for (const s of report.skipped) console.log(`[school] skipped ${s.file}: ${s.error}`);
    console.log(`[school] loaded ${report.modules} modules from ${report.files} files (+${report.lessons_added} new, ${report.lessons_updated} updated, ${report.lessons_kept} kept as edited, ${report.skipped.length} skipped)`);
  }
  return report;
}

/* ------------------------------------------------------------------ member state */
/* The catalog (schools, modules, lesson titles; never lesson content) is cached and rebuilt after any content change. */
let cat = null;
function bust() { cat = null; }
function catalog() {
  if (cat) return cat;
  const schools = D.all('SELECT * FROM school_schools ORDER BY sort, id');
  const lessons = D.all('SELECT id, module_id, slug, idx, title, minutes, steps_n FROM school_lessons WHERE published=1 ORDER BY idx, id');
  // A module made in the admin shows once it has a published lesson (an empty one would block the modules after it).
  const withLessons = new Set(lessons.map((l) => l.module_id));
  const modules = D.all('SELECT id, school_id, slug, title, summary, sort, exam_n, published, source FROM school_modules WHERE published=1 ORDER BY sort, id')
    .filter((m) => m.source !== 'admin' || withLessons.has(m.id));
  cat = { schools, modules, lessons };
  return cat;
}

function userRows(uid) {
  if (!uid) return { prog: new Map(), mstate: new Map(), enroll: new Map(), attempts: [], certs: [], grants: [], vertical: '' };
  return {
    prog: new Map(D.all('SELECT * FROM school_progress WHERE user_id=?', uid).map((r) => [r.lesson_id, r])),
    mstate: new Map(D.all('SELECT * FROM school_module_state WHERE user_id=?', uid).map((r) => [r.module_id, r])),
    enroll: new Map(D.all('SELECT * FROM school_enrollments WHERE user_id=?', uid).map((r) => [r.school_id, r])),
    attempts: D.all("SELECT kind, ref_id, score, total, passed, at FROM school_attempts WHERE user_id=? AND kind IN ('exam','final') ORDER BY at", uid),
    certs: D.all('SELECT * FROM school_certificates WHERE user_id=? AND revoked_at=0', uid),
    grants: D.all('SELECT * FROM school_grants WHERE user_id=?', uid),
    vertical: (D.get('SELECT vertical FROM school_prefs WHERE user_id=?', uid) || {}).vertical || '',
  };
}

/**
 * Work out every school, module and lesson status for one member at time t. Pure: reads only what it is given.
 * Module statuses: passed | open | waiting (opens_at in the future) | locked (previous module's exam) | prereq (needs the
 * previous school's certificate) | premium. Lesson statuses: done | open | locked.
 */
function computeState({ schools, modules, lessons }, rows, user, t, H) {
  const staff = isStaff(user);
  const out = [];
  const any = settings().verticals_any !== false;
  // A school made in the admin shows to members once it has a module with a published lesson.
  const visible = schools.filter((s) => (s.published || staff) && (staff || s.source !== 'admin' || modules.some((m) => m.school_id === s.id)));
  let mainPrev = null; // the main school before this one (the chain: foundations → operator → scale)
  let lastMain = null;
  visible.forEach((s, si) => {
    const track = s.track || 'main';
    const cert = rows.certs.find((c) => c.school_id === s.id) || null;
    const granted = rows.grants.some((g) => g.kind === 'open_school' && g.ref_id === s.id);
    const premiumLocked = !!s.premium && !premiumOk(user);
    // Schools made in the admin sit outside the paced path: open to everyone, or after the one certificate the team chose.
    const before = s.source === 'admin' ? (s.requires ? schools.find((x) => x.slug === s.requires && x.id !== s.id) || null : null)
      : track === 'main' ? mainPrev : track === 'extra' ? lastMain : null;
    const prevDone = !before || rows.certs.some((c) => c.school_id === before.id);
    const chosen = track === 'vertical' && rows.vertical === s.vertical;
    // Vertical schools: your chosen vertical, or any of them when the team allows it.
    const verticalOk = track !== 'vertical' || chosen || any || granted;
    const prereqOk = (prevDone && verticalOk) || granted || staff;
    const enrolled = rows.enroll.get(s.id) || null;
    if (track === 'main') { mainPrev = s; lastMain = s; }
    const mods = modules.filter((m) => m.school_id === s.id);
    let prev = null;
    const mOut = mods.map((m, mi) => {
      const st0 = rows.mstate.get(m.id) || {};
      const ls = lessons.filter((l) => l.module_id === m.id);
      // A module without exam questions (only possible for modules made in the admin) is passed once every lesson is.
      const noExam = !m.exam_n;
      let st = st0;
      if (noExam && !st0.passed_at && ls.length && ls.every((l) => rows.prog.get(l.id) && rows.prog.get(l.id).passed_at)) {
        st = { ...st0, passed_at: Math.max(...ls.map((l) => rows.prog.get(l.id).passed_at)) };
      }
      let openAt = null;
      if (mi === 0) openAt = prereqOk && !premiumLocked ? (enrolled ? enrolled.started_at : st.passed_at || null) : null;
      else if (prev && prev.passed_at) {
        const base = prev.open_at || prev.passed_at;
        openAt = Math.max(prev.passed_at, base + H);
        if (st.skip_wait_at) openAt = Math.min(openAt, st.skip_wait_at);
      }
      if (st.passed_at && !openAt) openAt = st.passed_at;
      let status;
      if (st.passed_at) status = 'passed';
      else if (premiumLocked) status = 'premium';
      else if (!prereqOk) status = 'prereq';
      else if (staff) status = 'open';
      else if (!enrolled) status = 'enroll';
      else if (mi === 0) status = 'open';
      else if (!prev || !prev.passed_at) status = 'locked';
      else if (openAt > t) status = 'waiting';
      else status = 'open';
      const open = status === 'open' || status === 'passed';
      let before = true;
      const lOut = ls.map((l) => {
        const p = rows.prog.get(l.id);
        const done = !!(p && p.passed_at);
        const ls2 = done ? 'done' : open && (before || staff) ? 'open' : 'locked';
        if (!done) before = false;
        return { id: l.id, slug: l.slug, title: l.title, minutes: l.minutes, steps: l.steps_n, status: ls2, best: p ? p.best_score : 0, total: p ? p.total : 0, attempts: p ? p.attempts : 0 };
      });
      const allDone = lOut.length > 0 && lOut.every((l) => l.status === 'done');
      const att = rows.attempts.filter((a) => a.kind === 'exam' && a.ref_id === m.id);
      const lastFail = att.filter((a) => !a.passed).pop();
      const best = att.reduce((b, a) => Math.max(b, a.total ? Math.round(a.score / a.total * 100) : 0), 0);
      const cooldown = lastFail && !st.passed_at && lastFail.at + EXAM_COOLDOWN > t ? lastFail.at + EXAM_COOLDOWN : 0;
      const exam = {
        questions: Math.min(EXAM_Q, m.exam_n || 0), passed: !!st.passed_at, granted: !!st.granted, attempts: att.length, best,
        available: !noExam && !st.passed_at && open && (allDone || staff) && !cooldown, cooldown_until: cooldown, needs_lessons: !allDone,
        ...(noExam ? { none: true } : {}),
      };
      const row = { id: m.id, slug: m.slug, title: m.title, summary: m.summary, order: mi + 1, status, open_at: openAt, opens_at: status === 'waiting' ? openAt : 0, passed_at: st.passed_at || 0, lessons: lOut, exam, minutes: ls.reduce((a, l) => a + (l.minutes || 0), 0) };
      prev = { passed_at: st.passed_at || 0, open_at: openAt };
      return row;
    });
    const lessonsTotal = mOut.reduce((a, m) => a + m.lessons.length, 0);
    const lessonsDone = mOut.reduce((a, m) => a + m.lessons.filter((l) => l.status === 'done').length, 0);
    const modsPassed = mOut.filter((m) => m.status === 'passed').length;
    const fAtt = rows.attempts.filter((a) => a.kind === 'final' && a.ref_id === s.id);
    const fFail = fAtt.filter((a) => !a.passed).pop();
    const fCool = !cert && fFail && fFail.at + FINAL_COOLDOWN > t ? fFail.at + FINAL_COOLDOWN : 0;
    const allPassed = mOut.length > 0 && modsPassed === mOut.length;
    // No exam question anywhere in the school (only possible for schools made in the admin): no final exam; the
    // certificate is issued once every module is passed (POST …/final/start hands it out, the last lesson quiz too).
    const noFinal = mods.length > 0 && mods.every((m) => !m.exam_n);
    const final = { questions: FINAL_Q, passed: !!cert, attempts: fAtt.length, best: fAtt.reduce((b, a) => Math.max(b, a.total ? Math.round(a.score / a.total * 100) : 0), 0), available: !cert && (noFinal ? allPassed : allPassed || staff) && !fCool && !premiumLocked && prereqOk, cooldown_until: fCool, needs_modules: !allPassed, ...(noFinal ? { none: true, questions: 0 } : {}) };
    const units = lessonsTotal + mOut.length + 1;
    const pct = units > 1 ? Math.round((lessonsDone + modsPassed + (cert ? 1 : 0)) / units * 100) : 0;
    const status = cert ? 'done' : premiumLocked ? 'premium' : !prereqOk ? 'prereq' : enrolled ? 'active' : 'ready';
    out.push({
      id: s.id, slug: s.slug, title: s.title, subtitle: s.subtitle, level: s.level, order: out.filter((x) => x.track === track).length + 1, premium: !!s.premium, published: !!s.published,
      track, vertical: s.vertical || '', chosen, enrolled: !!enrolled, accent: VERTICAL_ACCENT[s.vertical] || '',
      can_enroll: !enrolled && !cert && !premiumLocked && prereqOk,
      enroll_block: enrolled ? '' : premiumLocked ? 'premium' : !prevDone && !granted && !staff ? 'prereq' : !verticalOk ? 'vertical' : '',
      cert_title: s.cert_title, status, granted, started_at: enrolled ? enrolled.started_at : 0, pct, lessons_total: lessonsTotal, lessons_done: lessonsDone,
      modules_total: mOut.length, modules_passed: modsPassed, minutes: mOut.reduce((a, m) => a + m.minutes, 0), modules: mOut, final,
      certificate: cert ? { code: cert.code, name: cert.name, title: cert.title, issued_at: cert.issued_at } : null,
      prev_title: before ? before.title : '',
    });
  });
  return out;
}

function stateFor(user, t) {
  return computeState(catalog(), userRows(user && user.id), user, t, unlockMs());
}

/* ------------------------------------------------------------------ public previews (src/academy.js) */
/**
 * The lessons anyone may watch before signing up: exactly what a brand-new free member could open right after enrolling
 * in every school they are allowed to enrol in, except the vertical schools (today: lesson 1 of Foundations, plus lesson 1
 * of any school made in the admin that is open to everyone). Worked out with the same rules as members (computeState), never Premium, never past a
 * quiz. Cached until the content changes.
 */
const previewMemo = new WeakMap();
function previewLessonIds() {
  const cat0 = catalog();
  const hit = previewMemo.get(cat0);
  if (hit) return hit;
  const t = now();
  const newcomer = { id: 0, perms: [], premium: false };
  const rows = userRows(0);
  const first = computeState(cat0, rows, newcomer, t, unlockMs());
  for (const s of first) if (s.can_enroll && !s.premium) rows.enroll.set(s.id, { started_at: t });
  const ids = new Set();
  for (const s of computeState(cat0, rows, newcomer, t, unlockMs())) {
    // Vertical schools are free for members, but not a public teaser: visitors sign up first (only Foundations lesson 1 plays).
    if (s.premium || s.track === 'vertical' || !rows.enroll.has(s.id)) continue;
    for (const m of s.modules) if (m.status === 'open') for (const l of m.lessons) if (l.status === 'open') ids.add(l.id);
  }
  previewMemo.set(cat0, ids);
  return ids;
}

/** Where a lesson sits in the state tree, or a 404. */
function findLesson(state, lessonId) {
  for (const s of state) for (const m of s.modules) { const l = m.lessons.find((x) => x.id === lessonId); if (l) return { s, m, l }; }
  return null;
}
function findModule(state, moduleId) {
  for (const s of state) { const m = s.modules.find((x) => x.id === moduleId); if (m) return { s, m }; }
  return null;
}

function lockReason(s, m) {
  if (s.status === 'premium' || (m && m.status === 'premium')) return { code: 'premium', message: `${s.title} is part of Premium.` };
  if (s.status === 'prereq' || (m && m.status === 'prereq')) return { code: 'prereq', message: `Finish ${s.prev_title} and earn its certificate to open ${s.title}.` };
  if (s.status === 'ready' || (m && m.status === 'enroll')) return { code: 'enroll', message: `Enrol in ${s.title} to start its lessons.` };
  if (m && m.status === 'waiting') return { code: 'waiting', message: 'This module opens soon.', opens_at: m.opens_at };
  if (m && m.status === 'locked') return { code: 'locked', message: 'Pass the exam of the module before this one to open it.' };
  return { code: 'locked', message: 'Finish the lesson before this one first.' };
}

/** Record that a member started a school (module 1's clock) and a module. */
function markStarted(uid, schoolId, moduleId, t) {
  D.run('INSERT INTO school_module_state(user_id, module_id, started_at) VALUES(?,?,?) ON CONFLICT(user_id, module_id) DO UPDATE SET started_at=COALESCE(started_at, excluded.started_at)', uid, moduleId, t);
}

function addXp(uid, n) { if (n) D.run('UPDATE users SET xp=xp+? WHERE id=?', n, uid); return D.get('SELECT xp FROM users WHERE id=?', uid).xp; }

/* ------------------------------------------------------------------ grading */
function grade(items, answers) {
  const a = answers && typeof answers === 'object' ? answers : {};
  let score = 0;
  const review = items.map(({ key, q }) => {
    const right = correctId(key, q);
    const pick = typeof a[key] === 'string' ? a[key] : '';
    const ok = pick === right;
    if (ok) score++;
    return { id: key, q: q.q, correct: ok, picked: pick, answer: right, answer_text: q.options[q.answer], why: q.why };
  });
  return { score, total: items.length, passed: items.length > 0 && score / items.length >= PASS - 1e-9, review };
}

/** Resolve a question key (L<lesson>.<i> or M<module>.<i>) to the current question. */
function questionByKey(key) {
  const m = /^([LM])(\d+)\.(\d+)$/.exec(String(key));
  if (!m) return null;
  const row = m[1] === 'L' ? D.get('SELECT quiz j FROM school_lessons WHERE id=?', Number(m[2])) : D.get('SELECT exam j FROM school_modules WHERE id=?', Number(m[2]));
  const q = row ? json(row.j, [])[Number(m[3])] : null;
  return q ? normQ(q) : null;
}

/** Modules behind the questions missed in a final: [{ module_id, title, missed }], most missed first. */
function finalTopics(review) {
  const by = new Map();
  for (const x of review) {
    if (x.correct) continue;
    const m = /^M(\d+)\./.exec(x.id);
    if (!m) continue;
    const id = Number(m[1]);
    by.set(id, (by.get(id) || 0) + 1);
  }
  return [...by].map(([id, missed]) => ({ module_id: id, title: (D.get('SELECT title FROM school_modules WHERE id=?', id) || {}).title || '', missed })).sort((a, b) => b.missed - a.missed);
}

/* ------------------------------------------------------------------ certificates */
function newCode() {
  const A32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const b = crypto.randomBytes(10);
    let s = '';
    for (let i = 0; i < 10; i++) s += A32[b[i] % A32.length];
    const code = `VS-${s.slice(0, 5)}-${s.slice(5)}`;
    if (!D.get('SELECT 1 FROM school_certificates WHERE code=?', code)) return code;
  }
}
/* Certificates print their verify link on VooSquare, or on the academy's own domain once ACADEMY_URL is set (the domain is
 * live). /verify/<code> answers on both hosts, so links already printed keep working. */
const verifyBase = () => (config.academyUrlSet ? config.academyUrl : config.baseUrl);
const verifyUrl = (code) => `${verifyBase()}/verify/${encodeURIComponent(code)}`;
/** The school's two old public names (see the regex) belong to someone else: titles saved before the rename read
 * "VooSquare Academy" wherever they are shown, without rewriting what was issued. */
const brand = (s) => String(s || '').replace(/\bVoo (School|Academy)\b/g, 'VooSquare Academy');
/** Was this certificate earned by passing the school's final exam? (A school made in the admin may have none.) */
const passedFinal = (userId, schoolId) => !!D.get("SELECT 1 FROM school_attempts WHERE user_id=? AND kind='final' AND ref_id=? AND passed=1 LIMIT 1", userId, schoolId);
function certPublic(c, school) {
  return {
    id: c.id, code: c.code, name: c.name, title: brand(c.title || (school && school.cert_title) || 'Certificate'), school: school ? school.title : '', school_slug: school ? school.slug : '',
    school_order: school ? school.sort : 0, track: school ? school.track || 'main' : 'main', vertical_title: school && school.track === 'vertical' ? school.title : '', issued_at: c.issued_at, revoked: !!c.revoked_at, can_rename: !c.name_changes && !c.revoked_at, verify_url: verifyUrl(c.code),
    final: passedFinal(c.user_id, c.school_id), site: hostOf(config.academyUrl),
  };
}
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return 'voosquareacademy.com'; } };
/** One sentence on how the school was finished, for the certificate email ({{finish_note}}). */
const finishNote = (schoolTitle, viaFinal) => (viaFinal
  ? `You passed the final exam of ${schoolTitle}. Every lesson, every quiz and every module exam is behind you, and your certificate is ready.`
  : `You finished every module of ${schoolTitle}, and your certificate is ready.`);
function issueCertificate(user, school, t, { viaFinal = false } = {}) {
  const existing = D.get('SELECT * FROM school_certificates WHERE user_id=? AND school_id=? AND revoked_at=0', user.id, school.id);
  if (existing) return { cert: existing, fresh: false };
  const code = newCode();
  const id = D.insert('school_certificates', { user_id: user.id, school_id: school.id, code, name: clean(user.name, 80) || 'VooSquare Academy graduate', title: brand(school.cert_title) || 'Certificate', issued_at: t, revoked_at: 0 }).id;
  const cert = D.get('SELECT * FROM school_certificates WHERE id=?', id);
  try {
    mailer.queue(user, 'certificate_issued', {
      cert_title: brand(cert.title), cert_name: cert.name, school_title: school.title, cert_code: code, verify_url: verifyUrl(code),
      cert_url: `${config.baseUrl}/app#cert/${encodeURIComponent(code)}`, issued_on: require('./revenue').dateText(t),
      finish_note: finishNote(school.title, viaFinal),
    });
  } catch (e) { console.error('[school] certificate email', e.message); }
  return { cert, fresh: true };
}

/* ------------------------------------------------------------------ public verify page */
function verifyPage(code) {
  const c = D.get('SELECT c.*, s.title school_title FROM school_certificates c JOIN school_schools s ON s.id=c.school_id WHERE c.code=?', String(code || '').toUpperCase());
  const date = c ? require('./revenue').dateText(c.issued_at) : '';
  const valid = c && !c.revoked_at;
  const title = c ? brand(c.title) : '';
  const body = c ? `
    <div class="vf-status ${valid ? 'ok' : 'no'}"><span class="vf-dot"></span>${valid ? 'Valid certificate' : 'This certificate was revoked'}</div>
    <p class="vf-k">Awarded to</p><h1>${esc(c.name)}</h1>
    <p class="vf-k">For</p><h2>${esc(title)}</h2>
    <dl><div><dt>School</dt><dd>${esc(c.school_title)}</dd></div><div><dt>Issued</dt><dd>${esc(date)}</dd></div><div><dt>Certificate code</dt><dd class="mono">${esc(c.code)}</dd></div></dl>
    <p class="vf-note">Issued by VooSquare Academy, part of VooSquare by Zedapex. This page shows only what is printed on the certificate.</p>`
    : `<div class="vf-status no"><span class="vf-dot"></span>No certificate found</div><h1 class="vf-nf">We could not find a certificate with the code ${esc(String(code || '').slice(0, 40))}.</h1><p class="vf-note">Check the code on the certificate and try again. Codes look like VS-ABCDE-12345.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${c ? esc(title) + ' · ' + esc(c.name) : 'Certificate not found'} · VooSquare Academy</title><link rel="icon" type="image/svg+xml" href="/assets/logo-icon.svg"><link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&family=Instrument+Serif:ital@1&family=JetBrains+Mono:wght@500&display=swap">
<link rel="stylesheet" href="/css/shared.css"><link rel="stylesheet" href="/css/school.css"></head>
<body class="vf-body"><main class="vf"><a class="vf-brand" href="${esc(config.academyUrl)}"><img src="/assets/logo-icon.svg" alt="" width="34" height="34"><span class="vf-lock"><b>Voo<span>Square</span> Academy</b><small>The school for media buyers</small></span></a>
<section class="vf-card">${body}</section><p class="vf-foot">VooSquare Academy · Part of VooSquare by Zedapex. <a href="${esc(config.academyUrl)}">About the Academy</a></p></main></body></html>`;
}

/* ------------------------------------------------------------------ product and partner cards */
/** A live product card (Admin → Products), or null when the product is missing or hidden. The hub (VooSquare) always shows. */
function productCard(slug) {
  const p = D.get('SELECT * FROM products WHERE slug=?', String(slug || ''));
  if (!p || (!p.visible && !p.hub)) return null;
  const { launchUrl } = require('./routes/app').helpers;
  return { slug: p.slug, name: p.name, icon: p.icon, color: p.color, tint: p.tint, stage: p.stage, status: p.status, tagline: p.tagline, offer: p.offer, external: !!p.external, hub: !!p.hub, launch_url: p.hub ? '/app#apps' : launchUrl(p) };
}
function partnerPublic(row, files) {
  const logo = row.logo_upload ? files[row.logo_upload] : null;
  return { id: row.id, vertical: row.vertical, name: row.name, logo: logo ? logo.thumb_url : '', description: row.description, highlights: json(row.highlights, []), cta: row.cta || 'Visit', badge: row.badge, go: `/api/school/partners/${row.id}/go` };
}
function partnersFor(vertical) {
  const rows = D.all('SELECT * FROM school_partners WHERE vertical=? AND enabled=1 ORDER BY sort, id', vertical);
  const files = require('./uploads').lookup(rows.map((r) => r.logo_upload));
  return rows.map((r) => partnerPublic(r, files));
}
/**
 * Product and partner slides get their live data next to the lesson. A product slide whose product is hidden is dropped;
 * a partner slide with no partners is dropped for members and kept for the team (who see a placeholder).
 */
function resolveCards(steps, user) {
  const refs = { products: {}, partners: {} };
  const staff = isStaff(user);
  const out = steps.filter((st) => {
    if (st.v === 'product') {
      const slug = st.d && st.d.slug;
      if (!(slug in refs.products)) refs.products[slug] = productCard(slug);
      return !!refs.products[slug];
    }
    if (st.v === 'partner') {
      const v = PARTNER_VERTICALS.includes(st.d && st.d.vertical) ? st.d.vertical : 'general';
      if (!refs.partners[v]) refs.partners[v] = partnersFor(v);
      return refs.partners[v].length > 0 || staff;
    }
    return true;
  });
  for (const k of Object.keys(refs.products)) if (!refs.products[k]) delete refs.products[k];
  refs.staff = staff;
  return { steps: out, refs, staff };
}

/** Student number, one per member: VS-<year>-<5 digits>. */
function studentNumber(uid, t) {
  const row = D.get('SELECT number FROM school_students WHERE user_id=?', uid);
  if (row) return row.number;
  const n = D.get('SELECT COUNT(*) n FROM school_students').n + 421;
  let num = `VS-${new Date(t).getUTCFullYear()}-${String(n).padStart(5, '0')}`;
  while (D.get('SELECT 1 FROM school_students WHERE number=?', num)) num = `VS-${new Date(t).getUTCFullYear()}-${String(n + crypto.randomInt(1, 99999)).padStart(5, '0')}`;
  D.insert('school_students', { user_id: uid, number: num, created_at: t });
  return num;
}
/** The enrolment card for one school (null when not enrolled). */
function enrolmentCard(user, s, enrolledAt) {
  if (!enrolledAt) return null;
  const number = studentNumber(user.id, enrolledAt); // members enrolled before cards existed get their number now
  const u = D.get('SELECT name, avatar FROM users WHERE id=?', user.id);
  return { number, name: u.name, avatar: json(u.avatar, {}), school: s.title, school_slug: s.slug, level: s.level, track: s.track, vertical: s.vertical || '', premium: !!s.premium, accent: s.accent || VERTICAL_ACCENT[s.vertical] || '', issued_at: enrolledAt };
}
const verticalMeta = () => D.all("SELECT slug, title, subtitle, vertical, premium, published FROM school_schools WHERE track='vertical' ORDER BY sort, id").map((s) => ({ key: s.vertical, slug: s.slug, title: s.title, subtitle: s.subtitle, premium: !!s.premium, published: !!s.published, accent: VERTICAL_ACCENT[s.vertical] || '#00A86B' }));

/* ------------------------------------------------------------------ content made in the admin */
/* The owner can add schools, modules and lessons in Admin → VooSquare Academy without touching files. They live only in the
 * database (source='admin', migration 009): reloading from files never hides, overwrites or reorders them, and their
 * slugs (made from the title once, never changed, never reused) are IDs like any other. */
const LIMITS = { schools: 50, modules: 60, lessons: 60, quiz: LESSON_Q, exam: 60, options: 6, slides: 40 };
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** One text field from a request: trimmed, control characters out, a clear error when required or too long. */
function textIn(b, k, { label, max, required = '', multi = false }) {
  const raw = b[k];
  if (raw != null && typeof raw !== 'string' && typeof raw !== 'number') fail(400, `${label} must be text.`);
  let v = String(raw ?? '').replace(CTRL, '');
  v = multi ? v.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim() : v.replace(/\s+/g, ' ').trim();
  if (required && !v) fail(400, required);
  if (v.length > max) fail(400, `${label} is too long: keep it to ${max} characters (it has ${v.length}).`);
  return v;
}
/** A list of short lines (objectives, takeaways): an array, or text with one per line. */
function linesIn(b, k, { label, max, each }) {
  let v = b[k];
  if (typeof v === 'string') v = v.split('\n');
  if (!Array.isArray(v)) fail(400, `${label} must be a list.`);
  const out = v.map((x, i) => textIn({ x }, 'x', { label: `${label} line ${i + 1}`, max: each })).filter(Boolean);
  if (out.length > max) fail(400, `Up to ${max} ${label.toLowerCase()}, please (there are ${out.length}).`);
  return out;
}
/** Quiz or exam questions: [{ q, options, answer, why }], each gradable, with sane lengths. An empty list is allowed. */
function questionsIn(list, { label, max }) {
  if (!Array.isArray(list)) fail(400, `The ${label.toLowerCase()} must be a list of questions.`);
  if (list.length > max) fail(400, `The ${label.toLowerCase()} can have up to ${max} questions (there are ${list.length}).`);
  return list.map((q, i) => {
    const n = normQ(q);
    const w = `${label} question ${i + 1}`;
    if (!n) fail(400, `${w} needs a question, 2 or more different options and the right answer.`);
    if (n.options.length > LIMITS.options) fail(400, `${w}: up to ${LIMITS.options} options.`);
    if (n.q.length > 400) fail(400, `${w}: keep the question to 400 characters.`);
    if (n.options.some((o) => o.length > 200)) fail(400, `${w}: keep each option to 200 characters.`);
    if (n.why.length > 600) fail(400, `${w}: keep the explanation to 600 characters.`);
    return { q: n.q.replace(CTRL, ''), options: n.options.map((o) => o.replace(CTRL, '')), answer: n.answer, why: n.why.replace(CTRL, '') };
  });
}
/** Slides for a lesson made in the admin: the same checks as the lesson editor, plus each slide's narration ("say"). */
function slidesIn(steps) {
  if (!Array.isArray(steps) || !steps.length) fail(400, 'A lesson needs at least one slide.');
  if (steps.length > LIMITS.slides) fail(400, `Keep a lesson to ${LIMITS.slides} slides or fewer.`);
  const out = steps.map((s, i) => {
    const e = validateStep(s, `Slide ${i + 1}`); if (e) fail(400, e);
    if (s.v === 'photo' && !(s.d && typeof s.d.src === 'string' && /^[\w./-]+$/.test(s.d.src) && !s.d.src.includes('..'))) fail(400, `Slide ${i + 1}: a photo needs a picture path inside the site, like assets/school/name.webp.`);
    const c = { ...s };
    if (c.say !== undefined) {
      if (typeof c.say !== 'string') fail(400, `Slide ${i + 1}: "say" (what the voice reads) must be text.`);
      if (c.say.trim().length > 4000) fail(400, `Slide ${i + 1}: keep "say" to 4,000 characters.`);
      c.say = sayText(c.say);
      if (!c.say) delete c.say;
    }
    return c;
  });
  if (JSON.stringify(out).length > 200_000) fail(400, 'These slides are too large.');
  return out;
}
/** Every lesson field the admin may set. creating: title and slides are required. */
function adminLessonIn(b, creating) {
  const f = {};
  if (creating || b.title !== undefined) f.title = textIn(b, 'title', { label: 'The title', max: 140, required: 'Give the lesson a title.' });
  if (b.minutes !== undefined && b.minutes !== '') {
    const n = Number(b.minutes);
    if (!Number.isInteger(n) || n < 1 || n > 120) fail(400, 'Minutes must be a whole number from 1 to 120.');
    f.minutes = n;
  } else if (creating) f.minutes = 10;
  if (b.published !== undefined) f.published = b.published ? 1 : 0;
  if (b.objectives !== undefined) f.objectives = JSON.stringify(linesIn(b, 'objectives', { label: 'Objectives', max: 10, each: 300 }));
  if (b.takeaways !== undefined) f.takeaways = JSON.stringify(linesIn(b, 'takeaways', { label: 'Takeaways', max: 12, each: 400 }));
  if (b.action !== undefined) f.action = textIn(b, 'action', { label: 'The action', max: 600, multi: true });
  if (creating || b.steps !== undefined) { const st = slidesIn(b.steps); f.steps = JSON.stringify(st); f.steps_n = st.length; f.say_src = saySrc(st); }
  if (b.glossary !== undefined) {
    if (!Array.isArray(b.glossary)) fail(400, 'The glossary must be a list.');
    if (b.glossary.length > 20) fail(400, 'Up to 20 glossary terms.');
    f.glossary = JSON.stringify(b.glossary.filter((g) => g && g.term).map((g, i) => ({ term: textIn(g, 'term', { label: `Glossary term ${i + 1}`, max: 80 }), def: textIn(g, 'def', { label: `Glossary definition ${i + 1}`, max: 400, multi: true }) })));
  }
  if (b.quiz !== undefined) f.quiz = JSON.stringify(questionsIn(b.quiz, { label: 'Quiz', max: LIMITS.quiz }));
  for (const k of ['say_intro', 'say_outro']) {
    if (b[k] === undefined) continue;
    const v = textIn(b, k, { label: k === 'say_intro' ? 'The spoken intro' : 'The spoken outro', max: 4000, multi: true });
    f[k] = sayText(v);
  }
  return f;
}
/** A slug made from a title: lower case, a-z 0-9 and dashes, at least 2 characters. */
function slugify(title, max) {
  let x = String(title || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  if (x.length < 2) x = x ? x + '-class' : 'class';
  return x;
}
/** The first free slug: base, base-2, base-3… taken() also counts slugs in the recycle bin, so a slug is never reused. */
function uniqueSlug(base, max, taken) {
  if (!taken(base)) return base;
  for (let n = 2; n < 100000; n++) { const suf = '-' + n; const s = base.slice(0, max - suf.length).replace(/-+$/, '') + suf; if (!taken(s)) return s; }
  fail(409, 'Could not make a free name for this. Try another title.');
}
const inBin = (table, slug) => !!D.get("SELECT 1 FROM deleted_rows WHERE table_name=? AND json_valid(data) AND json_extract(data,'$.slug')=? LIMIT 1", table, slug);
/** Folder names under the content directories: a school folder added later must not collide with an admin school. */
function contentFolders() {
  const out = new Set();
  for (const dir of contentDirs()) { try { for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) out.add(d.name); } catch { /* none */ } }
  return out;
}
const isAdminRow = (r) => !!r && r.source === 'admin';

/* ------------------------------------------------------------------ routes */
function routes(r) {
  /* ----- member ----- */
  r.get('/api/school', (ctx) => {
    const t = clock(ctx);
    const state = stateFor(ctx.user, t);
    let xp = 0;
    if (ctx.user) xp = D.get('SELECT xp FROM users WHERE id=?', ctx.user.id).xp;
    // The hero: where you are now and what opens next.
    let current = null; let next = null;
    for (const s of state) {
      if (!current && s.status !== 'done' && s.enrolled) {
        const m = s.modules.find((x) => x.status === 'open') || s.modules.find((x) => x.status === 'waiting');
        if (m) current = { school: s.slug, school_title: s.title, module_id: m.id, module: m.title, order: m.order, status: m.status, opens_at: m.opens_at, lesson: (m.lessons.find((l) => l.status === 'open') || null), exam_ready: m.exam.available };
      }
      for (const m of s.modules) if (m.status === 'waiting' && (!next || m.opens_at < next.opens_at)) next = { school: s.slug, module_id: m.id, module: m.title, opens_at: m.opens_at };
    }
    const lite = state.map(({ modules, ...s }) => ({ ...s, modules: modules.map(({ lessons, ...m }) => ({ ...m, lessons_total: lessons.length, lessons_done: lessons.filter((l) => l.status === 'done').length })) }));
    const pref = ctx.user ? (D.get('SELECT vertical, chosen_at FROM school_prefs WHERE user_id=?', ctx.user.id) || null) : null;
    const student = ctx.user ? (D.get('SELECT number FROM school_students WHERE user_id=?', ctx.user.id) || {}).number || '' : '';
    return { schools: lite, current, next, xp, now: t, unlock_hours: Number(settings().unlock_hours) || 0, staff: isStaff(ctx.user), premium: premiumOk(ctx.user), can_choose: canChooseVertical(ctx.user), vertical: pref ? pref.vertical : '', verticals_any: settings().verticals_any !== false, student, verticals: verticalMeta(), tips: require('./routes/app').helpers.courseList(ctx.user).length, links: { academy: config.academyUrlSet ? config.academyUrl : '', voosquare: config.voosquareUrl } };
  });

  r.get('/api/school/schools/:slug', (ctx) => {
    const t = clock(ctx);
    const state = stateFor(ctx.user, t);
    const s = state.find((x) => x.slug === ctx.params.slug);
    if (!s) fail(404, 'School not found.');
    const card = ctx.user ? enrolmentCard(ctx.user, s, s.started_at) : null;
    const partners = s.track === 'vertical' && s.vertical ? partnersFor(s.vertical) : [];
    return { school: s, card, partners, now: t, unlock_hours: Number(settings().unlock_hours) || 0, staff: isStaff(ctx.user), premium: premiumOk(ctx.user), schools: state.filter((x) => x.track === s.track).map((x) => ({ slug: x.slug, title: x.title, status: x.status, pct: x.pct, order: x.order, track: x.track, vertical: x.vertical })) };
  });

  /* Enrol: an explicit step that starts the school's clock and issues the member's student card. */
  r.post('/api/school/schools/:slug/enroll', (ctx) => {
    const u = A.requireUser(ctx);
    const t = clock(ctx);
    const s = stateFor(u, t).find((x) => x.slug === ctx.params.slug);
    if (!s) fail(404, 'School not found.');
    if (s.enrolled) return { card: enrolmentCard(u, s, s.started_at), already: true };
    if (s.status === 'premium') fail(403, `${s.title} is part of Premium.`, { lock: { code: 'premium' } });
    if (s.enroll_block === 'prereq') fail(403, `Earn the ${s.prev_title} certificate to enrol in ${s.title}.`, { lock: { code: 'prereq' } });
    if (s.enroll_block === 'vertical') fail(403, 'Choose this vertical first. Your team can open other verticals for you.', { lock: { code: 'vertical' } });
    if (!s.can_enroll && !s.certificate) fail(403, 'You cannot enrol in this school yet.');
    studentNumber(u.id, t);
    D.run('INSERT OR IGNORE INTO school_enrollments(user_id, school_id, started_at) VALUES(?,?,?)', u.id, s.id, t);
    const e = D.get('SELECT started_at FROM school_enrollments WHERE user_id=? AND school_id=?', u.id, s.id);
    return { card: enrolmentCard(u, s, e.started_at), already: false };
  });

  /* The member's vertical: members pick one (it can change later). A Premium vertical school needs Premium. */
  r.get('/api/school/vertical', (ctx) => {
    const u = A.requireUser(ctx);
    const pref = D.get('SELECT vertical, chosen_at FROM school_prefs WHERE user_id=?', u.id);
    return { vertical: pref ? pref.vertical : '', chosen_at: pref ? pref.chosen_at : 0, verticals: verticalMeta().filter((v) => v.published || isStaff(u)), premium: premiumOk(u), can_choose: canChooseVertical(u), verticals_any: settings().verticals_any !== false };
  });
  r.post('/api/school/vertical', async (ctx) => {
    const u = A.requireUser(ctx);
    const b = await ctx.json();
    const v = String(b.vertical || '');
    const meta = verticalMeta().find((x) => x.key === v && (x.published || isStaff(u)));
    if (!meta) fail(400, 'Choose one of the verticals.');
    if (meta.premium && !premiumOk(u)) fail(403, `${meta.title} is part of Premium.`, { lock: { code: 'premium' } });
    D.run('INSERT INTO school_prefs(user_id, vertical, chosen_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET vertical=excluded.vertical, chosen_at=excluded.chosen_at', u.id, v, clock(ctx));
    return { vertical: v, school: meta.slug };
  });

  /* Partner cards: members see enabled ones; clicks are counted, then the browser goes to the partner's link. */
  r.get('/api/school/partners', (ctx) => {
    const v = String(ctx.query.vertical || '');
    if (!PARTNER_VERTICALS.includes(v)) fail(400, 'Unknown vertical.');
    return { partners: partnersFor(v) };
  });
  r.get('/api/school/partners/:id/go', (ctx) => {
    const p = D.get('SELECT * FROM school_partners WHERE id=? AND enabled=1', Number(ctx.params.id));
    if (!p || !/^https:\/\//.test(p.url)) { ctx.redirect('/app#academy'); return; }
    let count = true;
    try { limit(`pclick:${ctx.ip}:${p.id}`, 3, 10 * 60_000); } catch { count = false; }
    if (count) D.run('UPDATE school_partners SET clicks=clicks+1, last_click_at=? WHERE id=?', now(), p.id);
    ctx.redirect(p.url);
  });

  r.get('/api/school/modules/:id', (ctx) => {
    const t = clock(ctx);
    const state = stateFor(ctx.user, t);
    const f = findModule(state, Number(ctx.params.id));
    if (!f) fail(404, 'Module not found.');
    const prev = f.s.modules[f.m.order - 2] || null;
    const next = f.s.modules[f.m.order] || null;
    return { vertical_pick: f.m.slug === 'picking-your-vertical', school: { slug: f.s.slug, title: f.s.title, order: f.s.order, status: f.s.status, premium: f.s.premium, prev_title: f.s.prev_title, track: f.s.track, enrolled: f.s.enrolled, can_enroll: f.s.can_enroll }, module: f.m, prev: prev && { id: prev.id, title: prev.title }, next: next && { id: next.id, title: next.title, status: next.status, opens_at: next.opens_at }, now: t, unlock_hours: Number(settings().unlock_hours) || 0, staff: isStaff(ctx.user) };
  });

  r.get('/api/school/lessons/:id', (ctx) => {
    const u = A.requireUser(ctx);
    const t = clock(ctx);
    const id = Number(ctx.params.id);
    const state = stateFor(u, t);
    const f = findLesson(state, id);
    if (!f) fail(404, 'Lesson not found.');
    if (f.l.status === 'locked' || !['open', 'passed'].includes(f.m.status)) { const why = lockReason(f.s, f.m); fail(403, why.message, { lock: why }); }
    const l = D.get('SELECT * FROM school_lessons WHERE id=?', id);
    markStarted(u.id, f.s.id, f.m.id, t);
    const quiz = lessonQuiz(l);
    const idx = f.m.lessons.findIndex((x) => x.id === id);
    const nextL = f.m.lessons[idx + 1] || null;
    const rawSteps = json(l.steps, []);
    const { steps, refs } = resolveCards(rawSteps, u);
    return {
      refs,
      // Teaching voice: a clip (url, length, caption) per slide shown, plus the intro and outro. null when there is none.
      voice: require('./voice').forMember(l, rawSteps, steps, u),
      lesson: {
        id: l.id, slug: l.slug, title: l.title, minutes: l.minutes, objectives: json(l.objectives, []), steps, takeaways: json(l.takeaways, []),
        action: l.action, glossary: json(l.glossary, []), quiz, status: f.l.status, best: f.l.best, total: f.l.total, number: idx + 1, count: f.m.lessons.length,
      },
      module: { id: f.m.id, title: f.m.title, order: f.m.order, lessons: f.m.lessons.map((x) => ({ id: x.id, title: x.title, status: x.status })) },
      school: { slug: f.s.slug, title: f.s.title, order: f.s.order, track: f.s.track },
      next: nextL ? { id: nextL.id, title: nextL.title } : null,
    };
  });

  /* A new shuffle of the quiz (retry). */
  r.get('/api/school/lessons/:id/quiz', (ctx) => {
    const u = A.requireUser(ctx);
    const id = Number(ctx.params.id);
    const f = findLesson(stateFor(u, clock(ctx)), id);
    if (!f || f.l.status === 'locked') fail(403, 'Finish the lesson before this one first.');
    const l = D.get('SELECT id, quiz FROM school_lessons WHERE id=?', id);
    return { quiz: lessonQuiz(l) };
  });

  /* One question at a time: instant feedback with the reason. The pass mark is decided only by /quiz below. */
  r.post('/api/school/lessons/:id/check', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('school-check:' + u.id, 240, 10 * 60_000);
    const b = await ctx.json();
    const id = Number(ctx.params.id);
    const f = findLesson(stateFor(u, clock(ctx)), id);
    if (!f || f.l.status === 'locked') fail(403, 'Finish the lesson before this one first.');
    const m = /^L(\d+)\.(\d+)$/.exec(String(b.question || ''));
    if (!m || Number(m[1]) !== id || Number(m[2]) >= LESSON_Q) fail(400, 'Unknown question.');
    const q = questionByKey(b.question);
    if (!q) fail(400, 'Unknown question.');
    const right = correctId(b.question, q);
    return { correct: String(b.option || '') === right, answer: right, why: q.why };
  });

  r.post('/api/school/lessons/:id/quiz', async (ctx) => {
    const u = A.requireUser(ctx);
    limit('school-quiz:' + u.id, 60, 10 * 60_000);
    const t = clock(ctx);
    const b = await ctx.json();
    const id = Number(ctx.params.id);
    const state = stateFor(u, t);
    const f = findLesson(state, id);
    if (!f) fail(404, 'Lesson not found.');
    if (f.l.status === 'locked' || !['open', 'passed'].includes(f.m.status)) { const why = lockReason(f.s, f.m); fail(403, why.message, { lock: why }); }
    const l = D.get('SELECT id, quiz FROM school_lessons WHERE id=?', id);
    const items = json(l.quiz, []).slice(0, LESSON_Q).map((q, i) => ({ key: `L${l.id}.${i}`, q: normQ(q) })).filter((x) => x.q);
    const g = grade(items, b.answers);
    // A lesson without a quiz (only lessons made in the admin can have none) is passed by finishing it.
    if (!items.length) g.passed = true;
    const p = D.get('SELECT * FROM school_progress WHERE user_id=? AND lesson_id=?', u.id, id);
    const first = g.passed && !(p && p.passed_at);
    D.run(`INSERT INTO school_progress(user_id, lesson_id, best_score, total, attempts, passed_at, last_at) VALUES(?,?,?,?,1,?,?)
      ON CONFLICT(user_id, lesson_id) DO UPDATE SET best_score=MAX(best_score, excluded.best_score), total=excluded.total, attempts=attempts+1,
      passed_at=COALESCE(passed_at, excluded.passed_at), last_at=excluded.last_at`, u.id, id, g.score, g.total, g.passed ? t : null, t);
    const gained = first ? XP.lesson : 0;
    D.insert('school_attempts', { user_id: u.id, kind: 'lesson', ref_id: id, score: g.score, total: g.total, passed: g.passed ? 1 : 0, xp: gained, at: t });
    const xp = addXp(u.id, gained);
    let after = findLesson(stateFor(u, t), id);
    // A school without any exam: the certificate comes with the last lesson.
    let certificate = null;
    if (g.passed && after.s.final.none && after.s.final.available) {
      const school = D.get('SELECT * FROM school_schools WHERE id=?', after.s.id);
      certificate = certPublic(issueCertificate(u, school, t).cert, school);
      after = findLesson(stateFor(u, t), id);
    }
    const idx = after.m.lessons.findIndex((x) => x.id === id);
    const nextL = after.m.lessons[idx + 1] || null;
    return {
      ...(certificate ? { certificate } : {}), no_quiz: !items.length || undefined,
      score: g.score, total: g.total, passed: g.passed, need: Math.ceil(g.total * PASS), gained, xp,
      // Wrong answers are named; the right option is only shown once the quiz is passed.
      review: g.review.map((x) => ({ id: x.id, q: x.q, correct: x.correct, ...(g.passed ? { answer: x.answer, answer_text: x.answer_text, why: x.why } : {}) })),
      next: nextL ? { id: nextL.id, title: nextL.title, status: nextL.status } : null,
      exam_ready: after.m.exam.available, module_id: after.m.id,
    };
  });

  /* ----- exams (module and school final): start hands out a paper, submit grades it ----- */
  function startPaper(u, kind, refId, keys, t) {
    limit('school-paper:' + u.id, 30, 10 * 60_000); // each start stores a paper
    const id = 'p_' + crypto.randomBytes(12).toString('base64url');
    D.run('DELETE FROM school_papers WHERE user_id=? AND created_at<?', u.id, t - 7 * 24 * HOUR);
    D.insert('school_papers', { id, user_id: u.id, kind, ref_id: refId, qkeys: JSON.stringify(keys), created_at: t });
    return { paper: id, questions: keys.map((k) => publicQ(k, questionByKey(k))), expires_at: t + PAPER_TTL };
  }
  function takePaper(u, b, kind, refId, t) {
    const p = D.get('SELECT * FROM school_papers WHERE id=? AND user_id=?', String(b.paper || ''), u.id);
    if (!p || p.kind !== kind || p.ref_id !== refId) fail(400, 'This exam paper is not valid. Start the exam again.');
    if (p.submitted_at) fail(409, 'This exam paper was already handed in. Start a new attempt.');
    if (p.created_at + PAPER_TTL < t) fail(410, 'This exam paper expired. Start the exam again.');
    // A paper opened before a failed attempt is void: otherwise several papers opened at once would skip the cooldown.
    if (D.get('SELECT 1 FROM school_attempts WHERE user_id=? AND kind=? AND ref_id=? AND passed=0 AND at>=?', u.id, kind, refId, p.created_at)) fail(409, 'This exam paper was opened before your last attempt. Start the exam again.');
    const r2 = D.run('UPDATE school_papers SET submitted_at=? WHERE id=? AND submitted_at IS NULL', t, p.id);
    if (!r2.changes) fail(409, 'This exam paper was already handed in. Start a new attempt.');
    return json(p.qkeys, []).map((key) => ({ key, q: questionByKey(key) })).filter((x) => x.q);
  }

  r.post('/api/school/modules/:id/exam/start', (ctx) => {
    const u = A.requireUser(ctx);
    const t = clock(ctx);
    const id = Number(ctx.params.id);
    const f = findModule(stateFor(u, t), id);
    if (!f) fail(404, 'Module not found.');
    const e = f.m.exam;
    if (e.passed) fail(409, 'You already passed this exam.');
    if (!['open'].includes(f.m.status)) { const why = lockReason(f.s, f.m); fail(403, why.message, { lock: why }); }
    if (e.cooldown_until) fail(429, 'You can take this exam again in a little while.', { cooldown_until: e.cooldown_until });
    if (e.none) fail(400, 'This module has no exam. It is passed once every lesson is done.');
    if (!e.available) fail(403, 'Finish every lesson in this module to open the exam.');
    const mod = D.get('SELECT exam FROM school_modules WHERE id=?', id);
    const keys = shuffle(json(mod.exam, []).map((_, i) => `M${id}.${i}`).filter((k) => questionByKey(k))).slice(0, EXAM_Q);
    return { ...startPaper(u, 'exam', id, keys, t), pass_pct: PASS * 100, title: f.m.title };
  });

  r.post('/api/school/modules/:id/exam/submit', async (ctx) => {
    const u = A.requireUser(ctx);
    const t = clock(ctx);
    const id = Number(ctx.params.id);
    const b = await ctx.json();
    const items = takePaper(u, b, 'exam', id, t);
    const g = grade(items, b.answers);
    const st = D.get('SELECT passed_at FROM school_module_state WHERE user_id=? AND module_id=?', u.id, id);
    const first = g.passed && !(st && st.passed_at);
    if (g.passed) D.run('INSERT INTO school_module_state(user_id, module_id, passed_at) VALUES(?,?,?) ON CONFLICT(user_id, module_id) DO UPDATE SET passed_at=COALESCE(passed_at, excluded.passed_at)', u.id, id, t);
    const gained = first ? XP.exam : 0;
    D.insert('school_attempts', { user_id: u.id, kind: 'exam', ref_id: id, score: g.score, total: g.total, passed: g.passed ? 1 : 0, xp: gained, at: t });
    const xp = addXp(u.id, gained);
    const f = findModule(stateFor(u, t), id);
    const next = f && f.s.modules[f.m.order] ? f.s.modules[f.m.order] : null;
    return {
      score: g.score, total: g.total, pct: g.total ? Math.round(g.score / g.total * 100) : 0, passed: g.passed, pass_pct: PASS * 100, gained, xp,
      retry_at: g.passed ? 0 : t + EXAM_COOLDOWN,
      review: g.review.map((x) => ({ id: x.id, q: x.q, correct: x.correct, ...(g.passed ? { answer_text: x.answer_text, why: x.why } : {}) })),
      next: next ? { id: next.id, title: next.title, status: next.status, opens_at: next.opens_at } : null,
      final_ready: !!(f && f.s.final.available),
      choose_vertical: g.passed && !!(f && f.m.slug === 'picking-your-vertical'),
    };
  });

  r.post('/api/school/schools/:slug/final/start', (ctx) => {
    const u = A.requireUser(ctx);
    const t = clock(ctx);
    const s = stateFor(u, t).find((x) => x.slug === ctx.params.slug);
    if (!s) fail(404, 'School not found.');
    if (s.final.passed) fail(409, 'You already passed this final exam.');
    if (s.status === 'premium' || s.status === 'prereq') { const why = lockReason(s, null); fail(403, why.message, { lock: why }); }
    if (s.final.cooldown_until) fail(429, 'You can take the final exam again tomorrow.', { cooldown_until: s.final.cooldown_until });
    if (s.final.none) {
      // No exam in this school: the certificate is handed out once every module is done.
      if (!s.final.available) fail(403, 'Finish every module in this school to earn its certificate.');
      const school = D.get('SELECT * FROM school_schools WHERE id=?', s.id);
      return { no_exam: true, passed: true, certificate: certPublic(issueCertificate(u, school, t).cert, school) };
    }
    if (!s.final.available) fail(403, 'Pass every module exam in this school to open the final exam.');
    // Only module-exam questions: their answers are never shown before that exam is passed (lesson-quiz answers are).
    const pool = [];
    for (const m of s.modules) {
      const mod = D.get('SELECT exam FROM school_modules WHERE id=?', m.id);
      json(mod.exam, []).forEach((_, i) => pool.push(`M${m.id}.${i}`));
    }
    const keys = shuffle(pool.filter((k) => questionByKey(k))).slice(0, FINAL_Q); // fewer than 25 in the school: all of them
    return { ...startPaper(u, 'final', s.id, keys, t), pass_pct: PASS * 100, title: `${s.title}: final exam` };
  });

  r.post('/api/school/schools/:slug/final/submit', async (ctx) => {
    const u = A.requireUser(ctx);
    const t = clock(ctx);
    const school = D.get('SELECT * FROM school_schools WHERE slug=?', ctx.params.slug);
    if (!school) fail(404, 'School not found.');
    const b = await ctx.json();
    const items = takePaper(u, b, 'final', school.id, t);
    const g = grade(items, b.answers);
    let cert = null; let gained = 0;
    if (g.passed) {
      const had = D.get('SELECT 1 FROM school_attempts WHERE user_id=? AND kind=? AND ref_id=? AND passed=1', u.id, 'final', school.id);
      gained = had ? 0 : XP.final;
      cert = issueCertificate(u, school, t, { viaFinal: true }).cert;
    }
    D.insert('school_attempts', { user_id: u.id, kind: 'final', ref_id: school.id, score: g.score, total: g.total, passed: g.passed ? 1 : 0, xp: gained, at: t });
    const xp = addXp(u.id, gained);
    return {
      score: g.score, total: g.total, pct: g.total ? Math.round(g.score / g.total * 100) : 0, passed: g.passed, pass_pct: PASS * 100, gained, xp,
      retry_at: g.passed ? 0 : t + FINAL_COOLDOWN,
      // The final never shows answers or questions: only the score and the modules to review.
      topics: finalTopics(g.review),
      certificate: cert ? certPublic(cert, school) : null,
    };
  });

  /* ----- certificates ----- */
  r.get('/api/school/certificates', (ctx) => {
    const u = A.requireUser(ctx);
    const schools = Object.fromEntries(D.all('SELECT * FROM school_schools').map((s) => [s.id, s]));
    return { certificates: D.all('SELECT * FROM school_certificates WHERE user_id=? ORDER BY issued_at', u.id).map((c) => certPublic(c, schools[c.school_id])) };
  });
  r.get('/api/school/certificates/:code', (ctx) => {
    const u = A.requireUser(ctx);
    const c = D.get('SELECT * FROM school_certificates WHERE code=?', String(ctx.params.code).toUpperCase());
    if (!c || (c.user_id !== u.id && !isStaff(u))) fail(404, 'Certificate not found.');
    return { certificate: certPublic(c, D.get('SELECT * FROM school_schools WHERE id=?', c.school_id)) };
  });
  r.post('/api/school/certificates/:code/name', async (ctx) => {
    const u = A.requireUser(ctx);
    const c = D.get('SELECT * FROM school_certificates WHERE code=? AND user_id=?', String(ctx.params.code).toUpperCase(), u.id);
    if (!c) fail(404, 'Certificate not found.');
    if (c.revoked_at) fail(400, 'This certificate was revoked.');
    if (c.name_changes) fail(409, 'The name on this certificate was already changed once. Write to support if it is still wrong.');
    const b = await ctx.json();
    const name = clean(b.name, 60).replace(/\s+/g, ' ');
    if (name.length < 2) fail(400, 'Write the name as it should appear on the certificate.');
    if (/[<>{}\\]/.test(name)) fail(400, 'Use letters, spaces and simple punctuation only.');
    D.run('UPDATE school_certificates SET name=?, name_changes=name_changes+1 WHERE id=?', name, c.id);
    return { certificate: certPublic(D.get('SELECT * FROM school_certificates WHERE id=?', c.id), D.get('SELECT * FROM school_schools WHERE id=?', c.school_id)) };
  });
  r.get('/api/school/certificates/:code/pdf', (ctx) => {
    const u = A.requireUser(ctx);
    const c = D.get('SELECT * FROM school_certificates WHERE code=?', String(ctx.params.code).toUpperCase());
    if (!c || (c.user_id !== u.id && !isStaff(u))) fail(404, 'Certificate not found.');
    if (c.revoked_at) fail(410, 'This certificate was revoked.');
    const s = D.get('SELECT * FROM school_schools WHERE id=?', c.school_id);
    const pdf = require('./pdf').certificate({ name: c.name, title: brand(c.title || s.cert_title), school: s.title, schoolOrder: s.sort, track: s.track, verticalTitle: s.title, date: require('./revenue').dateText(c.issued_at), code: c.code, verifyUrl: verifyUrl(c.code), final: passedFinal(c.user_id, c.school_id), site: hostOf(config.academyUrl) });
    ctx.handled = true;
    ctx.res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': pdf.length, 'Cache-Control': 'private, no-store', 'Content-Disposition': `attachment; filename="voosquare-academy-${c.code}.pdf"` });
    ctx.res.end(pdf);
  });
  r.get('/api/verify/:code', (ctx) => {
    limit('verify:' + ctx.ip, 120, 60_000);
    const c = D.get('SELECT c.*, s.title school_title FROM school_certificates c JOIN school_schools s ON s.id=c.school_id WHERE c.code=?', String(ctx.params.code).toUpperCase());
    if (!c) fail(404, 'No certificate with that code.');
    return { valid: !c.revoked_at, name: c.name, title: brand(c.title), school: c.school_title, issued_at: c.issued_at, code: c.code };
  });
  r.get('/verify/:code', (ctx) => {
    limit('verify:' + ctx.ip, 120, 60_000);
    const c = D.get('SELECT 1 FROM school_certificates WHERE code=?', String(ctx.params.code).toUpperCase());
    ctx.html(c ? 200 : 404, verifyPage(String(ctx.params.code).toUpperCase()));
  });

  /* ----- admin (Academy permission) ----- */
  const audit = (u, action, detail = '') => D.insert('audit', { user_id: u.id, action, detail: String(detail).slice(0, 500), created_at: now() });

  r.get('/api/admin/school', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const schools = D.all('SELECT * FROM school_schools ORDER BY sort, id').map((s) => ({
      ...s, premium: !!s.premium, published: !!s.published,
      learners: D.get('SELECT COUNT(*) n FROM school_enrollments WHERE school_id=?', s.id).n,
      certificates: D.get('SELECT COUNT(*) n FROM school_certificates WHERE school_id=? AND revoked_at=0', s.id).n,
      source: s.source || 'file', requires: s.requires || '',
      modules: D.all('SELECT id, slug, title, sort, file, exam, published, source FROM school_modules WHERE school_id=? ORDER BY sort, id', s.id).map((m) => {
        const ls = D.all('SELECT id, edited, published, minutes, source FROM school_lessons WHERE module_id=?', m.id);
        return { id: m.id, slug: m.slug, title: m.title, order: m.sort, file: m.file, published: !!m.published, source: m.source || 'file', made: ls.filter((l) => l.source === 'admin').length, exam_questions: json(m.exam, []).length, lessons: ls.filter((l) => l.published).length, hidden: ls.filter((l) => !l.published).length, edited: ls.filter((l) => l.edited).length, minutes: ls.filter((l) => l.published).reduce((a, l) => a + l.minutes, 0), passed: D.get('SELECT COUNT(*) n FROM school_module_state WHERE module_id=? AND passed_at IS NOT NULL', m.id).n };
      }),
    }));
    return { schools, settings: settings(), last_load: D.getSetting('school_last_load', null) };
  });
  r.patch('/api/admin/school/schools/:id', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const s = D.get('SELECT * FROM school_schools WHERE id=?', Number(ctx.params.id));
    if (!s) fail(404, 'School not found.');
    const b = await ctx.json();
    const patch = {};
    if (b.published !== undefined) patch.published = b.published ? 1 : 0;
    if (b.premium !== undefined) patch.premium = b.premium ? 1 : 0;
    if (b.cert_title !== undefined) { patch.cert_title = clean(b.cert_title, 120); if (!patch.cert_title) fail(400, 'Give the certificate a title.'); }
    if (b.title !== undefined) { patch.title = clean(b.title, 80); if (!patch.title) fail(400, 'Give the school a title.'); }
    if (b.subtitle !== undefined) patch.subtitle = clean(b.subtitle, 300);
    if (isAdminRow(s) && (b.level !== undefined || b.requires !== undefined)) Object.assign(patch, schoolIn({ level: b.level, requires: b.requires }, false, s));
    if (patch.level === undefined) delete patch.level;
    if (patch.requires === undefined) delete patch.requires;
    D.update('school_schools', s.id, patch, Object.keys(patch));
    bust();
    audit(me, 'school.save', `${s.slug} ${JSON.stringify(patch)}`);
    return { school: D.get('SELECT * FROM school_schools WHERE id=?', s.id) };
  });
  r.put('/api/admin/school/settings', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const b = await ctx.json();
    const next = { ...settings() };
    if (b.unlock_hours !== undefined) {
      const h = Number(b.unlock_hours);
      if (!Number.isFinite(h) || h < 0 || h > 24 * 14) fail(400, 'Hours between modules must be from 0 to 336.');
      next.unlock_hours = Math.round(h * 100) / 100;
    }
    if (b.verticals_any !== undefined) next.verticals_any = !!b.verticals_any;
    D.setSetting('school', next);
    audit(me, 'school.settings', JSON.stringify(next));
    return { settings: settings() };
  });
  r.post('/api/admin/school/reload', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    limit('school-reload:' + me.id, 20, 60_000);
    const report = load({ quiet: true });
    audit(me, 'school.reload', `${report.modules} modules, +${report.lessons_added}, ~${report.lessons_updated}, ${report.skipped.length} skipped`);
    return { report };
  });
  r.get('/api/admin/school/modules/:id', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const m = D.get('SELECT * FROM school_modules WHERE id=?', Number(ctx.params.id));
    if (!m) fail(404, 'Module not found.');
    const s = D.get('SELECT id, slug, title, source FROM school_schools WHERE id=?', m.school_id);
    const lessons = D.all('SELECT id, slug, idx, title, minutes, steps, quiz, published, edited, source, updated_at FROM school_lessons WHERE module_id=? ORDER BY idx, id', m.id).map((l) => ({ ...l, steps: json(l.steps, []).length, quiz: json(l.quiz, []).length, published: !!l.published, edited: !!l.edited, done: D.get('SELECT COUNT(*) n FROM school_progress WHERE lesson_id=? AND passed_at IS NOT NULL', l.id).n }));
    return { module: { ...m, exam: json(m.exam, []), source: m.source || 'file', published: !!m.published }, school: s, lessons: lessons.map((l) => ({ ...l, source: l.source || 'file' })), types: STEP_TYPES, members: D.get('SELECT COUNT(*) n FROM school_module_state WHERE module_id=?', m.id).n };
  });
  r.get('/api/admin/school/lessons/:id', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const l = D.get('SELECT * FROM school_lessons WHERE id=?', Number(ctx.params.id));
    if (!l) fail(404, 'Lesson not found.');
    const m = D.get('SELECT id, title, school_id, file FROM school_modules WHERE id=?', l.module_id);
    const steps = json(l.steps, []);
    return { lesson: { ...l, objectives: json(l.objectives, []), steps, takeaways: json(l.takeaways, []), glossary: json(l.glossary, []), quiz: json(l.quiz, []), published: !!l.published, edited: !!l.edited }, module: m, types: STEP_TYPES, refs: resolveCards(steps, ctx.user).refs };
  });
  r.post('/api/admin/school/lessons/:id', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const l = D.get('SELECT * FROM school_lessons WHERE id=?', Number(ctx.params.id));
    if (!l) fail(404, 'Lesson not found.');
    const b = await ctx.json();
    if (isAdminRow(l)) {
      // Made in the admin: no file behind it, so it is not marked "edited"; the quiz may be empty; narration is kept here.
      const f = adminLessonIn(b, false);
      f.updated_at = now();
      D.update('school_lessons', l.id, f, Object.keys(f));
      bust();
      audit(me, 'school.lesson.save', `#${l.id} ${l.slug}`);
      return { lesson: D.get('SELECT id, title, edited, published, source FROM school_lessons WHERE id=?', l.id) };
    }
    const patch = {};
    if (b.title !== undefined) { patch.title = clean(b.title, 140); if (!patch.title) fail(400, 'Give the lesson a title.'); }
    if (b.minutes !== undefined) patch.minutes = Math.max(1, Math.min(120, Number(b.minutes) || 10));
    if (b.published !== undefined) patch.published = b.published ? 1 : 0;
    if (b.action !== undefined) patch.action = clean(b.action, 600);
    const list = (k, max) => { if (b[k] === undefined) return; if (!Array.isArray(b[k])) fail(400, `${k} must be a list.`); patch[k] = JSON.stringify(b[k].map((x) => clean(x, 400)).filter(Boolean).slice(0, max)); };
    list('objectives', 10); list('takeaways', 12);
    if (b.steps !== undefined) {
      if (!Array.isArray(b.steps) || !b.steps.length) fail(400, 'A lesson needs at least one slide.');
      if (b.steps.length > 40) fail(400, 'Keep a lesson to 40 slides or fewer.');
      for (let i = 0; i < b.steps.length; i++) {
        const e = validateStep(b.steps[i], `Slide ${i + 1}`); if (e) fail(400, e);
        const s = b.steps[i];
        if (s.v === 'photo' && !(s.d && typeof s.d.src === 'string' && /^[\w./-]+$/.test(s.d.src) && !s.d.src.includes('..'))) fail(400, `Slide ${i + 1}: a photo needs a picture path inside the site, like assets/school/name.webp.`);
      }
      const raw = JSON.stringify(b.steps);
      if (raw.length > 200_000) fail(400, 'These slides are too large.');
      patch.steps = raw;
    }
    if (b.glossary !== undefined) {
      if (!Array.isArray(b.glossary)) fail(400, 'The glossary must be a list.');
      patch.glossary = JSON.stringify(b.glossary.filter((g) => g && g.term).map((g) => ({ term: clean(g.term, 80), def: clean(g.def, 400) })).slice(0, 20));
    }
    if (b.quiz !== undefined) {
      if (!Array.isArray(b.quiz) || !b.quiz.length) fail(400, 'The quiz needs at least one question.');
      const qs = b.quiz.map(normQ);
      const bad = qs.findIndex((q) => !q);
      if (bad >= 0) fail(400, `Quiz question ${bad + 1} needs a question, 2 or more different options and the right answer.`);
      patch.quiz = JSON.stringify(qs);
    }
    patch.edited = 1; patch.updated_at = now();
    if (patch.steps) patch.steps_n = b.steps.length;
    D.update('school_lessons', l.id, patch, Object.keys(patch));
    bust();
    audit(me, 'school.lesson.save', `#${l.id} ${l.slug}`);
    return { lesson: D.get('SELECT id, title, edited, published FROM school_lessons WHERE id=?', l.id) };
  });
  /* Throw away the team's edits and take the lesson from its file again. */
  r.post('/api/admin/school/lessons/:id/revert', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const l = D.get('SELECT * FROM school_lessons WHERE id=?', Number(ctx.params.id));
    if (!l) fail(404, 'Lesson not found.');
    if (isAdminRow(l)) fail(400, 'This lesson was made in the admin. It has no file to take it from.');
    D.run("UPDATE school_lessons SET edited=0, src_hash='' WHERE id=?", l.id);
    const report = load({ quiet: true });
    audit(me, 'school.lesson.revert', `#${l.id} ${l.slug}`);
    return { report, lesson: D.get('SELECT id, title, edited, published FROM school_lessons WHERE id=?', l.id) };
  });

  /* ----- content made in the admin: new schools, modules and lessons (never in a file; see adminLessonIn) ----- */
  const madeLimit = (me) => limit('school-make:' + me.id, 120, 10 * 60_000);
  function schoolIn(b, creating, current) {
    const f = {};
    if (creating || b.title !== undefined) f.title = textIn(b, 'title', { label: 'The title', max: 80, required: 'Give the school a title.' });
    if (b.level !== undefined) f.level = textIn(b, 'level', { label: 'The level line', max: 30 });
    if (b.subtitle !== undefined) f.subtitle = textIn(b, 'subtitle', { label: 'The description', max: 300, multi: true });
    if (creating || b.cert_title !== undefined) {
      f.cert_title = textIn(b, 'cert_title', { label: 'The certificate title', max: 120, required: creating ? '' : 'Give the certificate a title.' });
      if (!f.cert_title) f.cert_title = `Certificate — ${f.title}`.slice(0, 120);
    }
    if (b.published !== undefined) f.published = b.published ? 1 : 0;
    if (b.premium !== undefined) f.premium = b.premium ? 1 : 0;
    if (b.requires !== undefined) {
      const v = String(b.requires || '');
      if (v && (!/^[a-z0-9-]{2,80}$/.test(v) || !D.get('SELECT 1 FROM school_schools WHERE slug=?', v) || (current && current.slug === v))) fail(400, 'Choose a school from the list, or "Open to everyone".');
      f.requires = v;
    }
    return f;
  }
  function moduleIn(b, creating) {
    const f = {};
    if (creating || b.title !== undefined) f.title = textIn(b, 'title', { label: 'The title', max: 140, required: 'Give the module a title.' });
    if (b.summary !== undefined) f.summary = textIn(b, 'summary', { label: 'The summary', max: 600, multi: true });
    if (b.order !== undefined && b.order !== '' && b.order !== null) {
      const n = Number(b.order);
      if (!Number.isInteger(n) || n < 1 || n > 999) fail(400, 'Order must be a whole number from 1 to 999.');
      f.sort = n;
    }
    if (b.published !== undefined) f.published = b.published ? 1 : 0;
    if (b.exam !== undefined) { const ex = questionsIn(b.exam, { label: 'Exam', max: LIMITS.exam }); f.exam = JSON.stringify(ex); f.exam_n = ex.length; }
    return f;
  }
  const fileOnly = (what) => fail(400, `This ${what} comes from the content files. Change it in its file, or switch Published off to hide it.`);

  r.post('/api/admin/school/schools', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    madeLimit(me);
    const b = await ctx.json();
    const f = schoolIn(b, true, null);
    if (D.get("SELECT COUNT(*) n FROM school_schools WHERE source='admin'").n >= LIMITS.schools) fail(400, `You can make up to ${LIMITS.schools} schools here.`);
    const reserved = new Set([...SCHOOLS.map((x) => x.slug), ...contentFolders()]);
    const slug = uniqueSlug(slugify(f.title, 40), 40, (x) => reserved.has(x) || !!D.get('SELECT 1 FROM school_schools WHERE slug=?', x) || inBin('school_schools', x));
    const sort = Math.max(100, (D.get('SELECT MAX(sort) n FROM school_schools').n || 0) + 1);
    const id = D.insert('school_schools', { slug, title: f.title, subtitle: f.subtitle || '', level: f.level || '', sort, premium: f.premium || 0, cert_title: f.cert_title, published: f.published ?? 1, track: 'extra', vertical: '', source: 'admin', requires: f.requires || '', created_at: now() }).id;
    bust();
    audit(me, 'school.create', `${slug} "${f.title}"`);
    return { school: D.get('SELECT * FROM school_schools WHERE id=?', id) };
  });
  r.del('/api/admin/school/schools/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const s = D.get('SELECT * FROM school_schools WHERE id=?', Number(ctx.params.id));
    if (!s) fail(404, 'School not found.');
    if (!isAdminRow(s)) fileOnly('school');
    const mods = D.all('SELECT id FROM school_modules WHERE school_id=?', s.id).map((m) => m.id);
    const ls = mods.length ? D.all(`SELECT id FROM school_lessons WHERE module_id IN (${mods.map(() => '?').join(',')})`, ...mods).map((l) => l.id) : [];
    const has = (q, ...a) => !!D.get(q, ...a);
    const ids = (a) => a.map(() => '?').join(',');
    if (has('SELECT 1 FROM school_enrollments WHERE school_id=?', s.id) || has('SELECT 1 FROM school_certificates WHERE school_id=?', s.id) || has("SELECT 1 FROM school_grants WHERE kind='open_school' AND ref_id=?", s.id)
      || (mods.length && has(`SELECT 1 FROM school_module_state WHERE module_id IN (${ids(mods)})`, ...mods)) || (ls.length && has(`SELECT 1 FROM school_progress WHERE lesson_id IN (${ids(ls)})`, ...ls))) {
      fail(409, 'Members have enrolled in this school, so it cannot be deleted. Switch Published off to hide it: their progress and certificates stay.');
    }
    const batch = require('./trash').newBatch();
    D.tx(() => {
      const t = require('./trash');
      if (ls.length) t.remove('school_lessons', `id IN (${ids(ls)})`, ls, { by: me.id, reason: 'school.lesson.delete', batch });
      if (mods.length) t.remove('school_modules', `id IN (${ids(mods)})`, mods, { by: me.id, reason: 'school.module.delete', batch });
      t.remove('school_schools', 'id=?', [s.id], { by: me.id, reason: 'school.delete', batch });
    });
    bust();
    audit(me, 'school.delete', `${s.slug} (recycle bin ${batch})`);
    return { ok: true, batch };
  });

  r.post('/api/admin/school/schools/:id/modules', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    madeLimit(me);
    const s = D.get('SELECT * FROM school_schools WHERE id=?', Number(ctx.params.id));
    if (!s) fail(404, 'School not found.');
    const b = await ctx.json();
    const f = moduleIn({ exam: [], ...b }, true);
    if (D.get('SELECT COUNT(*) n FROM school_modules WHERE school_id=?', s.id).n >= LIMITS.modules) fail(400, `A school can have up to ${LIMITS.modules} modules.`);
    const slug = uniqueSlug(slugify(f.title, 80), 80, (x) => !!D.get('SELECT 1 FROM school_modules WHERE school_id=? AND slug=?', s.id, x) || inBin('school_modules', x));
    const sort = f.sort ?? (D.get('SELECT MAX(sort) n FROM school_modules WHERE school_id=?', s.id).n || 0) + 1;
    const id = D.insert('school_modules', { school_id: s.id, slug, title: f.title, summary: f.summary || '', sort, exam: f.exam, exam_n: f.exam_n, published: f.published ?? 1, file: '', source: 'admin', updated_at: now() }).id;
    bust();
    audit(me, 'school.module.create', `${s.slug}/${slug} "${f.title}"`);
    return { module: D.get('SELECT * FROM school_modules WHERE id=?', id) };
  });
  r.patch('/api/admin/school/modules/:id', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const m = D.get('SELECT * FROM school_modules WHERE id=?', Number(ctx.params.id));
    if (!m) fail(404, 'Module not found.');
    if (!isAdminRow(m)) fileOnly('module');
    const f = moduleIn(await ctx.json(), false);
    f.updated_at = now();
    D.update('school_modules', m.id, f, Object.keys(f));
    bust();
    audit(me, 'school.module.save', `#${m.id} ${m.slug} ${Object.keys(f).join(',')}`);
    return { module: D.get('SELECT * FROM school_modules WHERE id=?', m.id) };
  });
  r.del('/api/admin/school/modules/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const m = D.get('SELECT * FROM school_modules WHERE id=?', Number(ctx.params.id));
    if (!m) fail(404, 'Module not found.');
    if (!isAdminRow(m)) fileOnly('module');
    const ls = D.all('SELECT id FROM school_lessons WHERE module_id=?', m.id).map((l) => l.id);
    const ids = ls.map(() => '?').join(',');
    if (D.get('SELECT 1 FROM school_module_state WHERE module_id=?', m.id) || D.get("SELECT 1 FROM school_attempts WHERE kind='exam' AND ref_id=?", m.id) || (ls.length && D.get(`SELECT 1 FROM school_progress WHERE lesson_id IN (${ids})`, ...ls))) {
      fail(409, 'Members have started this module, so it cannot be deleted. Switch Published off to hide it: their progress stays.');
    }
    const batch = require('./trash').newBatch();
    D.tx(() => {
      const t = require('./trash');
      if (ls.length) t.remove('school_lessons', `id IN (${ids})`, ls, { by: me.id, reason: 'school.lesson.delete', batch });
      t.remove('school_modules', 'id=?', [m.id], { by: me.id, reason: 'school.module.delete', batch });
    });
    bust();
    audit(me, 'school.module.delete', `#${m.id} ${m.slug} (recycle bin ${batch})`);
    return { ok: true, batch };
  });

  r.post('/api/admin/school/modules/:id/lessons', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    madeLimit(me);
    const m = D.get('SELECT * FROM school_modules WHERE id=?', Number(ctx.params.id));
    if (!m) fail(404, 'Module not found.');
    const b = await ctx.json();
    const f = adminLessonIn({ quiz: [], objectives: [], takeaways: [], glossary: [], ...b }, true);
    if (D.get('SELECT COUNT(*) n FROM school_lessons WHERE module_id=?', m.id).n >= LIMITS.lessons) fail(400, `A module can have up to ${LIMITS.lessons} lessons.`);
    // Unique in the whole school (a file's "was" renames look school-wide), and never one that was used before.
    const slug = uniqueSlug(slugify(f.title, 80), 80, (x) => !!D.get('SELECT 1 FROM school_lessons l JOIN school_modules mm ON mm.id=l.module_id WHERE mm.school_id=? AND l.slug=?', m.school_id, x) || inBin('school_lessons', x));
    const idx = (D.get('SELECT MAX(idx) n FROM school_lessons WHERE module_id=?', m.id).n ?? -1) + 1;
    const t = now();
    const id = D.insert('school_lessons', { module_id: m.id, slug, idx, published: 1, edited: 0, action: '', src_hash: '', say_intro: '', say_outro: '', ...f, source: 'admin', updated_at: t }).id;
    bust();
    audit(me, 'school.lesson.create', `#${id} ${slug} in module #${m.id}`);
    return { lesson: D.get('SELECT id, slug, title, module_id, published, source FROM school_lessons WHERE id=?', id) };
  });
  r.del('/api/admin/school/lessons/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const l = D.get('SELECT * FROM school_lessons WHERE id=?', Number(ctx.params.id));
    if (!l) fail(404, 'Lesson not found.');
    if (!isAdminRow(l)) fileOnly('lesson');
    if (D.get('SELECT 1 FROM school_progress WHERE lesson_id=?', l.id) || D.get("SELECT 1 FROM school_attempts WHERE kind='lesson' AND ref_id=?", l.id)) {
      fail(409, 'Members have started this lesson, so it cannot be deleted. Switch Published off to hide it: their progress stays.');
    }
    const batch = require('./trash').newBatch();
    require('./trash').remove('school_lessons', 'id=?', [l.id], { by: me.id, reason: 'school.lesson.delete', batch });
    bust();
    audit(me, 'school.lesson.delete', `#${l.id} ${l.slug} (recycle bin ${batch})`);
    return { ok: true, batch };
  });

  r.get('/api/admin/school/members/:id', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const u = D.get('SELECT * FROM users WHERE id=?', Number(ctx.params.id));
    if (!u) fail(404, 'Member not found.');
    const member = A.hydrate(u);
    // Seen as a member (never with the team's preview rights), so the team sees exactly what the member sees.
    const view = { ...member, perms: [], staff: false };
    const t = clock(ctx);
    const state = computeState(catalog(), userRows(u.id), view, t, unlockMs());
    const schools = Object.fromEntries(D.all('SELECT * FROM school_schools').map((s) => [s.id, s]));
    return {
      member: { id: u.id, name: u.name, email: u.email, xp: u.xp },
      schools: state.map((s) => ({ ...s, modules: s.modules.map(({ lessons, ...m }) => ({ ...m, lessons_total: lessons.length, lessons_done: lessons.filter((l) => l.status === 'done').length })) })),
      certificates: D.all('SELECT * FROM school_certificates WHERE user_id=? ORDER BY issued_at', u.id).map((c) => certPublic(c, schools[c.school_id])),
      vertical: (D.get('SELECT vertical FROM school_prefs WHERE user_id=?', u.id) || {}).vertical || '',
      student: (D.get('SELECT number FROM school_students WHERE user_id=?', u.id) || {}).number || '',
      now: t,
    };
  });
  /* Grant or skip for one member: open a school without the previous certificate, skip the wait for a module, or mark a
   * module passed (its lessons count as done). */
  r.post('/api/admin/school/members/:id/grant', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const u = D.get('SELECT id, name FROM users WHERE id=?', Number(ctx.params.id));
    if (!u) fail(404, 'Member not found.');
    const b = await ctx.json();
    const t = now();
    if (b.action === 'open_school') {
      const s = D.get('SELECT id, title FROM school_schools WHERE id=?', Number(b.school_id));
      if (!s) fail(404, 'School not found.');
      D.run('INSERT OR REPLACE INTO school_grants(user_id, kind, ref_id, by_id, at) VALUES(?,?,?,?,?)', u.id, 'open_school', s.id, me.id, t);
      audit(me, 'school.grant.open', `#${u.id} ${s.title}`);
      return { ok: true, message: `${s.title} is open for ${u.name}.` };
    }
    if (b.action === 'close_school') {
      D.run("DELETE FROM school_grants WHERE user_id=? AND kind='open_school' AND ref_id=?", u.id, Number(b.school_id));
      audit(me, 'school.grant.close', `#${u.id} school ${b.school_id}`);
      return { ok: true, message: 'Access grant removed.' };
    }
    const m = D.get('SELECT id, title FROM school_modules WHERE id=?', Number(b.module_id));
    if (!m) fail(404, 'Module not found.');
    if (b.action === 'skip_wait') {
      D.run('INSERT INTO school_module_state(user_id, module_id, skip_wait_at) VALUES(?,?,?) ON CONFLICT(user_id, module_id) DO UPDATE SET skip_wait_at=excluded.skip_wait_at', u.id, m.id, t);
      audit(me, 'school.grant.skip_wait', `#${u.id} ${m.title}`);
      return { ok: true, message: `${m.title} opens without the wait once the module before it is passed.` };
    }
    if (b.action === 'pass_module') {
      D.tx(() => {
        D.run('INSERT INTO school_module_state(user_id, module_id, passed_at, granted) VALUES(?,?,?,1) ON CONFLICT(user_id, module_id) DO UPDATE SET passed_at=COALESCE(passed_at, excluded.passed_at), granted=1', u.id, m.id, t);
        for (const l of D.all('SELECT id FROM school_lessons WHERE module_id=? AND published=1', m.id)) {
          D.run('INSERT INTO school_progress(user_id, lesson_id, passed_at, last_at, granted) VALUES(?,?,?,?,1) ON CONFLICT(user_id, lesson_id) DO UPDATE SET passed_at=COALESCE(passed_at, excluded.passed_at), granted=1', u.id, l.id, t, t);
        }
      });
      audit(me, 'school.grant.pass', `#${u.id} ${m.title}`);
      return { ok: true, message: `${m.title} is marked as passed for ${u.name}.` };
    }
    fail(400, 'Choose what to grant.');
  });

  /* ----- partners (Academy → Partners) ----- */
  r.get('/api/admin/school/partners', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const rows = D.all('SELECT * FROM school_partners ORDER BY vertical, sort, id');
    const files = require('./uploads').lookup(rows.map((x) => x.logo_upload));
    return { partners: rows.map((x) => ({ ...partnerPublic(x, files), url: x.url, sort: x.sort, enabled: !!x.enabled, clicks: x.clicks, last_click_at: x.last_click_at || 0, logo_upload: x.logo_upload })), verticals: PARTNER_VERTICALS };
  });
  function partnerFields(b, me, current) {
    const f = {};
    if (b.vertical !== undefined) { if (!PARTNER_VERTICALS.includes(b.vertical)) fail(400, 'Choose a vertical.'); f.vertical = b.vertical; }
    if (b.name !== undefined) { f.name = clean(b.name, 60); if (!f.name) fail(400, 'Give the partner a name.'); }
    if (b.description !== undefined) f.description = clean(b.description, 280);
    if (b.highlights !== undefined) {
      if (!Array.isArray(b.highlights)) fail(400, 'Highlights must be a list.');
      const h = b.highlights.map((x) => clean(x, 80)).filter(Boolean);
      if (h.length > 3) fail(400, 'Up to 3 highlights.');
      f.highlights = JSON.stringify(h);
    }
    if (b.url !== undefined) {
      const u = clean(b.url, 500);
      if (u && (!/^https:\/\/[^/\s]+\.[^/\s]/i.test(u) || /[\s<>"'`\\]/.test(u))) fail(400, 'Use a full https:// link.');
      f.url = u;
    }
    if (b.cta !== undefined) f.cta = clean(b.cta, 30);
    if (b.badge !== undefined) f.badge = clean(b.badge, 24);
    if (b.sort !== undefined) f.sort = Math.round(Number(b.sort) || 0);
    if (b.enabled !== undefined) f.enabled = b.enabled ? 1 : 0;
    let claim = null;
    if (b.logo_upload !== undefined && String(b.logo_upload || '') !== String((current && current.logo_upload) || '')) {
      const v = String(b.logo_upload || '');
      if (v) {
        const up = D.get('SELECT * FROM uploads WHERE id=? AND deleted=0', v);
        if (!up || up.purpose !== 'partner' || up.user_id !== me.id || up.attached_to) fail(400, 'That logo is no longer available. Upload it again.');
        claim = v;
      }
      f.logo_upload = v;
    }
    return { f, claim };
  }
  r.post('/api/admin/school/partners', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const b = await ctx.json();
    const { f, claim } = partnerFields({ vertical: b.vertical || 'general', ...b, name: b.name ?? '' }, me, null);
    if (f.enabled && !f.url) fail(400, 'Add the partner link before switching it on.');
    const id = D.insert('school_partners', { vertical: 'general', highlights: '[]', cta: 'Visit', ...f, created_at: now(), updated_at: now() }).id;
    if (claim) require('./uploads').claim(claim, me, ['partner'], 'partner:' + id);
    audit(me, 'school.partner.create', f.name);
    return { partner: D.get('SELECT * FROM school_partners WHERE id=?', id) };
  });
  r.patch('/api/admin/school/partners/:id', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const cur = D.get('SELECT * FROM school_partners WHERE id=?', Number(ctx.params.id));
    if (!cur) fail(404, 'Partner not found.');
    const b = await ctx.json();
    const { f, claim } = partnerFields(b, me, cur);
    if ((f.enabled ?? cur.enabled) && !(f.url ?? cur.url)) fail(400, 'Add the partner link before switching it on.');
    f.updated_at = now();
    D.update('school_partners', cur.id, f, Object.keys(f));
    if (claim) { require('./uploads').claim(claim, me, ['partner'], 'partner:' + cur.id); if (cur.logo_upload) require('./uploads').softDelete(cur.logo_upload); }
    else if (f.logo_upload === '' && cur.logo_upload) require('./uploads').softDelete(cur.logo_upload);
    audit(me, 'school.partner.save', cur.name);
    return { partner: D.get('SELECT * FROM school_partners WHERE id=?', cur.id) };
  });
  r.del('/api/admin/school/partners/:id', (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const cur = D.get('SELECT * FROM school_partners WHERE id=?', Number(ctx.params.id));
    if (!cur) fail(404, 'Partner not found.');
    require('./trash').remove('school_partners', 'id=?', [cur.id], { by: me.id, reason: 'school.partner.delete' });
    if (cur.logo_upload) require('./uploads').softDelete(cur.logo_upload);
    audit(me, 'school.partner.delete', cur.name);
    return { ok: true };
  });

  r.get('/api/admin/school/certificates', (ctx) => {
    A.requirePerm(ctx, 'academy');
    const q = clean(ctx.query.q, 80);
    const schools = Object.fromEntries(D.all('SELECT * FROM school_schools').map((s) => [s.id, s]));
    const rows = q
      ? D.all('SELECT c.*, u.email, u.name member_name FROM school_certificates c JOIN users u ON u.id=c.user_id WHERE c.code LIKE ? OR c.name LIKE ? OR u.email LIKE ? ORDER BY c.issued_at DESC LIMIT 200', `%${q}%`, `%${q}%`, `%${q}%`)
      : D.all('SELECT c.*, u.email, u.name member_name FROM school_certificates c JOIN users u ON u.id=c.user_id ORDER BY c.issued_at DESC LIMIT 200');
    return { certificates: rows.map((c) => ({ ...certPublic(c, schools[c.school_id]), user_id: c.user_id, email: c.email, member_name: c.member_name, revoked_at: c.revoked_at, revoked_reason: c.revoked_reason })) };
  });
  r.post('/api/admin/school/certificates/:id/revoke', async (ctx) => {
    const me = A.requirePerm(ctx, 'academy');
    const c = D.get('SELECT * FROM school_certificates WHERE id=?', Number(ctx.params.id));
    if (!c) fail(404, 'Certificate not found.');
    const b = await ctx.json();
    if (b.restore) {
      if (D.get('SELECT 1 FROM school_certificates WHERE user_id=? AND school_id=? AND revoked_at=0 AND id<>?', c.user_id, c.school_id, c.id)) fail(409, 'This member already has a valid certificate for this school.');
      D.run("UPDATE school_certificates SET revoked_at=0, revoked_reason='' WHERE id=?", c.id);
      audit(me, 'school.cert.restore', c.code);
    } else {
      D.run('UPDATE school_certificates SET revoked_at=?, revoked_reason=? WHERE id=?', now(), clean(b.reason, 200), c.id);
      audit(me, 'school.cert.revoke', c.code);
    }
    return { ok: true };
  });
}

module.exports = { previewLessonIds, catalog, lessonQuizCount: (l) => json(l.quiz, []).slice(0, LESSON_Q).length, brand, VERTICAL_ACCENT, findLesson, sayText, productCard, resolveCards, VERTICALS, PARTNER_VERTICALS, load, routes, computeState, stateFor, validateModule, normQ, optId, verifyPage, SCHOOLS, STEP_TYPES, settings, XP, PASS };
