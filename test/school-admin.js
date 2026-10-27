'use strict';
/* VooSquare Academy content made in the admin (Admin → VooSquare Academy → Add school / Add module / Add lesson): create, validate,
 * permissions, a member taking and finishing admin-made lessons (with and without quiz or exam, certificate), the main
 * path left untouched, reload from files and a fresh boot keeping everything, files never taking an admin slug, and
 * delete vs unpublish. Called from test/smoke.js with its helpers. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

module.exports = async function schoolAdmin({ BASE, Client, check, owner, DB, SCHOOL_EXTRA, PORT }) {
  const { DatabaseSync } = require('node:sqlite');
  const sql = new DatabaseSync(DB);
  const H = 3600_000;
  const xf = () => ({ 'x-forwarded-for': `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (c, email, name) => { const s = await c.post('/api/auth/start', { email, name }, xf()); return c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf()); };
  const secret = JSON.parse(sql.prepare("SELECT value FROM settings WHERE key='app_secret'").get().value);
  const optId = (key, text) => crypto.createHmac('sha256', String(secret)).update('school-opt|' + key + '|' + String(text)).digest('hex').slice(0, 12);
  const right = (key) => {
    const m = /^([LM])(\d+)\.(\d+)$/.exec(key);
    const row = m[1] === 'L' ? sql.prepare('SELECT quiz j FROM school_lessons WHERE id=?').get(Number(m[2])) : sql.prepare('SELECT exam j FROM school_modules WHERE id=?').get(Number(m[2]));
    const q = JSON.parse(row.j)[Number(m[3])];
    return optId(key, q.options[q.answer]);
  };
  const allRight = (qs) => Object.fromEntries(qs.map((q) => [q.id, right(q.id)]));
  const at = (t) => ({ 'x-vs-now': String(Math.round(t)) });
  const slides = (n = 3) => [
    { v: 'big', h: 'The big idea', p: 'Why it matters.', d: { b: 'Test fast', s: 'Kill faster' }, say: '  Here is the one idea.  ' },
    { v: 'check', h: 'How to do it', p: 'In order.', d: ['One', 'Two', 'Three'], say: 'Do these three things.' },
    { v: 'tip', h: 'Remember', p: 'One note.', d: { kind: 'tip', text: 'Short note.' } },
  ].slice(0, n);
  const Q = (i) => ({ q: `Question ${i}?`, options: ['Right', 'Wrong', 'Also wrong', 'Nope'], answer: 0, why: 'Because.' });

  // What a brand-new member sees of every existing school, before anything is made in the admin (fixed clock).
  const T0 = Date.now();
  const snap = async () => {
    const c = new Client(); await login(c, `sa-snap-${Math.random().toString(36).slice(2, 8)}@test.dev`, 'Snap Shot');
    const d = (await c.get('/api/school', at(T0))).data;
    return JSON.stringify(d.schools.filter((s) => !s.slug.startsWith('masterclass') && !s.slug.startsWith('quick-wins')).map((s) => ({ ...s, modules: s.modules.map((m) => ({ ...m })) })));
  };
  const before = await snap();

  console.log('VooSquare Academy admin content: permissions and validation');
  const mem = new Client(); await login(mem, 'sa-member@test.dev', 'Ada Member');
  const memId = (await mem.get('/api/me')).data.user.id;
  const editor = new Client(); await login(editor, 'sa-editor@test.dev', 'Edi Content');
  await owner.post('/api/admin/team', { email: 'sa-editor@test.dev', perms: ['content'] });
  const body = { title: 'Masterclasses with Ejiro', level: 'Masterclass', cert_title: 'Certificate — Masterclasses with Ejiro', published: true, premium: false };
  check('admin content: logged out, members and staff without Academy cannot add a school', (await new Client().post('/api/admin/school/schools', body)).status === 401
    && (await mem.post('/api/admin/school/schools', body)).status === 403 && (await editor.post('/api/admin/school/schools', body)).status === 403);
  const v1 = await owner.post('/api/admin/school/schools', { title: '   ' });
  const v2 = await owner.post('/api/admin/school/schools', { title: 'x'.repeat(81) });
  const v3 = await owner.post('/api/admin/school/schools', { title: 'Fine', requires: 'no-such-school' });
  const v4 = await owner.post('/api/admin/school/schools', { title: { a: 1 } });
  check('admin content: school validation says what is wrong (title, length, prerequisite, type)', v1.status === 400 && v1.data.error === 'Give the school a title.' && v2.status === 400 && /too long: keep it to 80 characters/.test(v2.data.error)
    && v3.status === 400 && /Choose a school from the list/.test(v3.data.error) && v4.status === 400 && /must be text/.test(v4.data.error), [v1.data, v2.data, v3.data, v4.data]);

  console.log('VooSquare Academy admin content: create school, module and lesson');
  const sc = await owner.post('/api/admin/school/schools', body);
  const S = sc.data.school;
  check('admin content: school created as an Extra school, made in the admin, after every file school', sc.status === 200 && S.slug === 'masterclasses-with-ejiro' && S.track === 'extra' && S.source === 'admin' && S.sort >= 100 && S.requires === '' && S.published === 1 && S.cert_title === body.cert_title, S);
  const sc2 = (await owner.post('/api/admin/school/schools', { title: 'Masterclasses with Ejiro', cert_title: '' })).data.school;
  check('admin content: the same title gets a new unique slug; an empty certificate title gets a default', sc2.slug === 'masterclasses-with-ejiro-2' && sc2.cert_title === 'Certificate — Masterclasses with Ejiro');
  check('admin content: a reserved file school slug is never used', (await owner.post('/api/admin/school/schools', { title: 'Foundations' })).data.school.slug === 'foundations-2');
  const adm0 = (await owner.get('/api/admin/school')).data;
  const aS = adm0.schools.find((s) => s.id === S.id);
  check('admin content: overview marks it as made in the admin', aS && aS.source === 'admin' && aS.modules.length === 0 && adm0.schools.find((s) => s.slug === 'foundations').source === 'file');
  check('admin content: an empty admin school is hidden from members, shown to the team', !(await mem.get('/api/school')).data.schools.some((s) => s.id === S.id) && (await owner.get('/api/school')).data.schools.some((s) => s.id === S.id));

  check('admin content: module validation (title, order)', (await owner.post(`/api/admin/school/schools/${S.id}/modules`, { title: '' })).data.error === 'Give the module a title.'
    && /Order must be a whole number/.test((await owner.post(`/api/admin/school/schools/${S.id}/modules`, { title: 'X', order: 0 })).data.error)
    && (await owner.post('/api/admin/school/schools/999999/modules', { title: 'X' })).status === 404);
  check('admin content: members cannot add modules or lessons', (await mem.post(`/api/admin/school/schools/${S.id}/modules`, { title: 'X' })).status === 403);
  const M1 = (await owner.post(`/api/admin/school/schools/${S.id}/modules`, { title: 'Reading the numbers', summary: 'CPA, ROAS and when to act.' })).data.module;
  const M2 = (await owner.post(`/api/admin/school/schools/${S.id}/modules`, { title: 'Scaling a winner' })).data.module;
  check('admin content: modules made in order, no exam by default', M1.slug === 'reading-the-numbers' && M1.sort === 1 && M2.sort === 2 && M1.exam_n === 0 && M1.source === 'admin' && M1.file === '');
  check('admin content: an empty module stays hidden from members', !(await mem.get('/api/school')).data.schools.some((s) => s.id === S.id));

  const lv = async (b) => (await owner.post(`/api/admin/school/modules/${M1.id}/lessons`, b)).data.error || '';
  check('admin content: lesson validation says what is wrong', (await lv({ title: 'X' })) === 'A lesson needs at least one slide.'
    && /unknown slide type "nope"/.test(await lv({ title: 'X', steps: [{ v: 'nope', d: {} }] }))
    && /Minutes must be a whole number from 1 to 120/.test(await lv({ title: 'X', steps: slides(), minutes: 0 }))
    && /up to 5 questions/.test(await lv({ title: 'X', steps: slides(), quiz: [Q(1), Q(2), Q(3), Q(4), Q(5), Q(6)] }))
    && /Quiz question 1 needs a question/.test(await lv({ title: 'X', steps: slides(), quiz: [{ q: 'A?', options: ['a', 'b'], answer: 5 }] }))
    && /keep "say" to 4,000 characters/.test(await lv({ title: 'X', steps: [{ v: 'big', d: { b: 'x' }, say: 'x'.repeat(4001) }] }))
    && /The spoken intro is too long/.test(await lv({ title: 'X', steps: slides(), say_intro: 'y'.repeat(4001) }))
    && /Objectives line 1 is too long/.test(await lv({ title: 'X', steps: slides(), objectives: ['z'.repeat(301)] }))
    && (await lv({ steps: slides() })) === 'Give the lesson a title.');
  const LA = (await owner.post(`/api/admin/school/modules/${M1.id}/lessons`, { title: 'What a good CPA looks like', minutes: 8, objectives: ['Read CPA'], takeaways: ['CPA is cost per action'], steps: slides(), say_intro: 'Welcome to the masterclass.', say_outro: 'That is it.' })).data.lesson;
  const LB = (await owner.post(`/api/admin/school/modules/${M1.id}/lessons`, { title: 'ROAS in one minute', steps: slides(2), quiz: [Q(1), Q(2), Q(3)] })).data.lesson;
  const rowA = sql.prepare('SELECT * FROM school_lessons WHERE id=?').get(LA.id);
  check('admin content: lessons made in the admin, in order, with narration in the file format', LA.slug === 'what-a-good-cpa-looks-like' && rowA.source === 'admin' && rowA.idx === 0 && sql.prepare('SELECT idx FROM school_lessons WHERE id=?').get(LB.id).idx === 1
    && rowA.say_intro === 'Welcome to the masterclass.' && rowA.say_outro === 'That is it.' && JSON.parse(rowA.steps)[0].say === 'Here is the one idea.' && JSON.parse(rowA.steps)[2].say === undefined
    && JSON.parse(rowA.say_src)[1].say === 'Do these three things.' && rowA.steps_n === 3 && rowA.edited === 0 && JSON.parse(rowA.quiz).length === 0, rowA);
  const ML2 = (await owner.post(`/api/admin/school/modules/${M2.id}/lessons`, { title: 'When to raise the budget', steps: slides(1) })).data.lesson;
  const ex = await owner.patch(`/api/admin/school/modules/${M2.id}`, { exam: [Q(1), Q(2), Q(3), Q(4), Q(5)] });
  check('admin content: an exam can be added to an admin module; bad questions refused', ex.status === 200 && ex.data.module.exam_n === 5 && (await owner.patch(`/api/admin/school/modules/${M2.id}`, { exam: [{ q: 'x', options: ['a', 'a'], answer: 0 }] })).status === 400);
  const mv = (await owner.get(`/api/admin/school/modules/${M1.id}`)).data;
  check('admin content: module view lists the lessons with their source and the slide types', mv.module.source === 'admin' && mv.lessons.length === 2 && mv.lessons.every((l) => l.source === 'admin') && mv.types.includes('big'));
  const le = (await owner.get(`/api/admin/school/lessons/${LA.id}`)).data.lesson;
  check('admin content: lesson editor gets the lesson with narration', le.source === 'admin' && le.say_intro === 'Welcome to the masterclass.' && le.steps.length === 3);
  const ed = await owner.post(`/api/admin/school/lessons/${LA.id}`, { title: 'What a good CPA looks like', say_outro: 'See you next time.', quiz: [] });
  check('admin content: editing an admin lesson keeps it unmarked, quiz may stay empty, outro saved', ed.status === 200 && ed.data.lesson.edited === 0 && sql.prepare('SELECT say_outro FROM school_lessons WHERE id=?').get(LA.id).say_outro === 'See you next time.');
  check('admin content: "take it from the file again" is refused for admin lessons', (await owner.post(`/api/admin/school/lessons/${LA.id}/revert`)).status === 400);
  check('admin content: a file module cannot be changed or deleted here', (await owner.patch(`/api/admin/school/modules/${adm0.schools.find((s) => s.slug === 'foundations').modules[0].id}`, { title: 'Hacked' })).status === 400
    && (await owner.del(`/api/admin/school/modules/${adm0.schools.find((s) => s.slug === 'foundations').modules[0].id}`)).status === 400
    && (await owner.del(`/api/admin/school/schools/${adm0.schools.find((s) => s.slug === 'foundations').id}`)).status === 400);

  console.log('VooSquare Academy admin content: members take admin-made lessons');
  const ov = (await mem.get('/api/school')).data;
  const mS = ov.schools.find((s) => s.id === S.id);
  check('admin content: the school shows to members as an Extra school, open to everyone', mS && mS.track === 'extra' && mS.status === 'ready' && mS.can_enroll && mS.enroll_block === '' && mS.modules_total === 2 && mS.lessons_total === 3, mS);
  check('admin content: the main path, verticals and file extras are exactly as before', (await snap()) === before);
  check('admin content: lessons stay locked until you enrol', (await mem.get('/api/school/lessons/' + LA.id)).data.lock.code === 'enroll');
  check('admin content: enrol', (await mem.post(`/api/school/schools/${S.slug}/enroll`)).status === 200);
  const pa = (await mem.get('/api/school/lessons/' + LA.id)).data;
  check('admin content: a member opens the lesson: slides with "say", no quiz, narration slots for the voice', pa.lesson.steps.length === 3 && pa.lesson.steps[0].say === 'Here is the one idea.' && pa.lesson.quiz.length === 0 && pa.school.track === 'extra');
  check('admin content: the second lesson is locked until the first is done', (await mem.get('/api/school/lessons/' + LB.id)).status === 403);
  const fa = (await mem.post(`/api/school/lessons/${LA.id}/quiz`, { answers: {} })).data;
  check('admin content: a lesson without a quiz is passed by finishing it (+50 XP once)', fa.passed && fa.total === 0 && fa.gained === 50 && fa.no_quiz === true && fa.next && fa.next.id === LB.id && fa.next.status === 'open', fa);
  check('admin content: finishing it again gives no more XP', (await mem.post(`/api/school/lessons/${LA.id}/quiz`, { answers: {} })).data.gained === 0);
  const pb = (await mem.get('/api/school/lessons/' + LB.id)).data.lesson;
  const fb0 = (await mem.post(`/api/school/lessons/${LB.id}/quiz`, { answers: {} })).data;
  const fb = (await mem.post(`/api/school/lessons/${LB.id}/quiz`, { answers: allRight(pb.quiz) })).data;
  check('admin content: a lesson with a quiz is graded on the server (empty answers fail, right ones pass)', pb.quiz.length === 3 && !fb0.passed && fb.passed && fb.score === 3);
  const m1s = (await mem.get('/api/school/modules/' + M1.id)).data.module;
  check('admin content: a module without an exam is passed once every lesson is done', m1s.status === 'passed' && m1s.exam.none === true && m1s.exam.passed && !m1s.exam.available, m1s);
  check('admin content: its exam cannot be started', (await mem.post(`/api/school/modules/${M1.id}/exam/start`)).status === 409);
  const m2w = (await mem.get('/api/school/modules/' + M2.id)).data.module;
  const pace = Number((await owner.get('/api/admin/school')).data.settings.unlock_hours) || 0;
  check('admin content: the next module follows the school pace', pace ? m2w.status === 'waiting' && m2w.opens_at > Date.now() + (pace - 1) * H : m2w.status === 'open', m2w);
  const later = Date.now() + (pace + 1) * H;
  check('admin content: and opens after the wait', (await mem.get('/api/school/modules/' + M2.id, at(later))).data.module.status === 'open');
  await mem.post(`/api/school/lessons/${ML2.id}/quiz`, { answers: {} }, at(later));
  const ep = (await mem.post(`/api/school/modules/${M2.id}/exam/start`, {}, at(later))).data;
  const er = (await mem.post(`/api/school/modules/${M2.id}/exam/submit`, { paper: ep.paper, answers: allRight(ep.questions) }, at(later))).data;
  check('admin content: an exam added in the admin works like any other', ep.questions.length === 5 && er.passed && er.gained === 150 && er.final_ready, er);
  const fp = (await mem.post(`/api/school/schools/${S.slug}/final/start`, {}, at(later))).data;
  const fr = (await mem.post(`/api/school/schools/${S.slug}/final/submit`, { paper: fp.paper, answers: allRight(fp.questions) }, at(later))).data;
  check('admin content: the final draws from the admin exam and issues the certificate', fp.questions.length === 5 && fr.passed && fr.certificate && fr.certificate.title === body.cert_title && fr.certificate.track === 'extra', fr);
  const pdf = await fetch(`${BASE}/api/school/certificates/${fr.certificate.code}/pdf`, { headers: { cookie: mem.cookie } });
  check('admin content: its PDF and verify page work', pdf.status === 200 && (await pdf.arrayBuffer()).byteLength > 1000 && (await new Client().get('/api/verify/' + fr.certificate.code)).data.valid === true);

  // A school with no exam at all: the certificate comes with the last lesson.
  const QW = (await owner.post('/api/admin/school/schools', { title: 'Quick wins', requires: 'foundations' })).data.school;
  const QM = (await owner.post(`/api/admin/school/schools/${QW.id}/modules`, { title: 'One trick' })).data.module;
  const QL = (await owner.post(`/api/admin/school/modules/${QM.id}/lessons`, { title: 'The trick', steps: slides(1) })).data.lesson;
  const qv = (await mem.get(`/api/school/schools/${QW.slug}`)).data.school;
  check('admin content: a school can ask for one certificate first (Foundations)', qv.status === 'prereq' && qv.enroll_block === 'prereq' && /Media Buying Foundations/.test(qv.prev_title) && (await mem.post(`/api/school/schools/${QW.slug}/enroll`)).status === 403);
  await owner.patch(`/api/admin/school/schools/${QW.id}`, { requires: '', level: 'Short' });
  check('admin content: and the team can open it to everyone', (await mem.get(`/api/school/schools/${QW.slug}`)).data.school.status === 'ready' && sql.prepare('SELECT level FROM school_schools WHERE id=?').get(QW.id).level === 'Short');
  await mem.post(`/api/school/schools/${QW.slug}/enroll`);
  const qs = (await mem.get(`/api/school/schools/${QW.slug}`)).data.school;
  check('admin content: no exam anywhere means no final exam', qs.final.none === true && qs.final.questions === 0 && !qs.final.available);
  check('admin content: the certificate cannot be claimed early', (await mem.post(`/api/school/schools/${QW.slug}/final/start`)).status === 403);
  const ql = (await mem.post(`/api/school/lessons/${QL.id}/quiz`, { answers: {} })).data;
  check('admin content: finishing the last lesson issues the certificate', ql.passed && ql.certificate && ql.certificate.title === 'Certificate — Quick wins' && sql.prepare('SELECT COUNT(*) n FROM school_certificates WHERE user_id=? AND school_id=?').get(memId, QW.id).n === 1, ql);
  check('admin content: claiming again changes nothing', (await mem.post(`/api/school/schools/${QW.slug}/final/start`)).status === 409 && sql.prepare('SELECT COUNT(*) n FROM school_certificates WHERE user_id=? AND school_id=?').get(memId, QW.id).n === 1);

  console.log('VooSquare Academy admin content: reload from files and a fresh boot keep it');
  const labMod = (await owner.get('/api/admin/school')).data.schools.find((s) => s.slug === 'lab').modules[0];
  const LX = (await owner.post(`/api/admin/school/modules/${labMod.id}/lessons`, { title: 'An extra lab lesson', steps: slides(1) })).data.lesson;
  const fp0 = sql.prepare("SELECT id, idx, published, title, steps, source FROM school_lessons WHERE source='admin' ORDER BY id").all();
  const mp0 = sql.prepare("SELECT id, sort, published, title, exam, source, slug FROM school_modules WHERE source='admin' ORDER BY id").all();
  const sp0 = sql.prepare("SELECT id, sort, published, title, track, source, slug FROM school_schools WHERE source='admin' ORDER BY id").all();
  // A file that tries to take the admin school and module slugs.
  const dir = path.join(SCHOOL_EXTRA, S.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'school.json'), JSON.stringify({ slug: S.slug, title: 'From a file', track: 'main', sort: 1 }));
  const labFile = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'school', 'lab', '01-every-slide.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, '01-take-over.json'), JSON.stringify({ ...labFile, school: S.slug, order: 1, slug: M1.slug, title: 'Taken over' }));
  const rep = (await owner.post('/api/admin/school/reload')).data.report;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check('admin content: reload from files keeps admin lessons (also inside a file module), modules and schools as they were', rep && same(fp0, sql.prepare("SELECT id, idx, published, title, steps, source FROM school_lessons WHERE source='admin' ORDER BY id").all())
    && same(mp0, sql.prepare("SELECT id, sort, published, title, exam, source, slug FROM school_modules WHERE source='admin' ORDER BY id").all())
    && same(sp0, sql.prepare("SELECT id, sort, published, title, track, source, slug FROM school_schools WHERE source='admin' ORDER BY id").all()), rep && rep.notes);
  check('admin content: a file can never take an admin slug (skipped with a note)', rep.notes.some((n) => n.includes(`the slug ${M1.slug} belongs to a module made in the admin`)) && sql.prepare('SELECT title FROM school_modules WHERE id=?').get(M1.id).title === 'Reading the numbers');
  check('admin content: members still see the admin lesson in the file module', (await owner.get(`/api/admin/school/modules/${labMod.id}`)).data.lessons.some((l) => l.id === LX.id && l.published && l.source === 'admin'));
  fs.rmSync(dir, { recursive: true, force: true });
  await owner.post('/api/admin/school/reload');
  check('admin content: reloading again with the file gone hides nothing made in the admin', same(mp0, sql.prepare("SELECT id, sort, published, title, exam, source, slug FROM school_modules WHERE source='admin' ORDER BY id").all())
    && same(fp0, sql.prepare("SELECT id, idx, published, title, steps, source FROM school_lessons WHERE source='admin' ORDER BY id").all()));
  // A redeploy: boot a fresh server on a copy of the database (it loads the files on start) and compare.
  {
    const file = `${DB}-sa-boot.db`;
    for (const f of [file, file + '-wal', file + '-shm']) { try { fs.unlinkSync(f); } catch { /* none */ } }
    const live = new DatabaseSync(DB); live.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); live.close();
    const port = PORT + 820 + Math.floor(Math.random() * 60);
    const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DATABASE_PATH: file, OWNER_EMAIL: 'owner@test.dev', NODE_ENV: 'test', EMAIL_PROVIDER: '', SCHOOL_EXTRA_DIR: SCHOOL_EXTRA, BACKUPS_DIR: path.join(path.dirname(file), 'sa-boot-backups-' + process.pid), UPLOADS_DIR: path.join(path.dirname(file), 'sa-boot-up-' + process.pid), VOICE_DIR: path.join(path.dirname(file), 'sa-boot-voice-' + process.pid) }, stdio: 'ignore' });
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/healthz`)).ok; } catch { /* wait */ } if (!up) await new Promise((r) => setTimeout(r, 100)); }
    srv.kill('SIGTERM'); await new Promise((r) => srv.once('exit', r));
    const b = new DatabaseSync(file);
    const ok = up && same(fp0, b.prepare("SELECT id, idx, published, title, steps, source FROM school_lessons WHERE source='admin' ORDER BY id").all())
      && same(mp0, b.prepare("SELECT id, sort, published, title, exam, source, slug FROM school_modules WHERE source='admin' ORDER BY id").all())
      && same(sp0, b.prepare("SELECT id, sort, published, title, track, source, slug FROM school_schools WHERE source='admin' ORDER BY id").all())
      && b.prepare('SELECT COUNT(*) n FROM school_certificates WHERE school_id=?').get(S.id).n === 1;
    b.close();
    for (const f of [file, file + '-wal', file + '-shm']) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
    for (const d of ['sa-boot-backups-', 'sa-boot-up-', 'sa-boot-voice-']) { try { fs.rmSync(path.join(path.dirname(file), d + process.pid), { recursive: true, force: true }); } catch { /* ignore */ } }
    check('admin content: a fresh boot (redeploy) keeps every admin school, module, lesson and certificate', ok);
  }

  console.log('VooSquare Academy admin content: unpublish and delete');
  check('admin content: members cannot delete', (await mem.del('/api/admin/school/lessons/' + LA.id)).status === 403 && (await editor.del('/api/admin/school/schools/' + S.id)).status === 403);
  const dA = await owner.del('/api/admin/school/lessons/' + LA.id);
  const dM = await owner.del('/api/admin/school/modules/' + M1.id);
  const dS = await owner.del('/api/admin/school/schools/' + S.id);
  check('admin content: anything members started cannot be deleted, with a clear reason', dA.status === 409 && /Switch Published off/.test(dA.data.error) && dM.status === 409 && dS.status === 409);
  check('admin content: file lessons cannot be deleted', (await owner.del('/api/admin/school/lessons/' + (await owner.get(`/api/admin/school/modules/${labMod.id}`)).data.lessons.find((l) => l.source === 'file').id)).status === 400);
  await owner.post(`/api/admin/school/lessons/${LB.id}`, { published: false });
  const hid = (await mem.get('/api/school/modules/' + M1.id)).data.module;
  check('admin content: unpublishing hides the lesson and keeps the member\'s progress', !hid.lessons.some((l) => l.id === LB.id) && !!sql.prepare('SELECT passed_at FROM school_progress WHERE user_id=? AND lesson_id=?').get(memId, LB.id).passed_at
    && (await mem.get(`/api/school/certificates/${fr.certificate.code}`)).status === 200);
  const dX = await owner.del('/api/admin/school/lessons/' + LX.id);
  check('admin content: an unused admin lesson is deleted into the recycle bin', dX.status === 200 && !sql.prepare('SELECT 1 FROM school_lessons WHERE id=?').get(LX.id) && !!sql.prepare("SELECT 1 FROM deleted_rows WHERE table_name='school_lessons' AND row_id=?").get(String(LX.id)));
  const LX2 = (await owner.post(`/api/admin/school/modules/${labMod.id}/lessons`, { title: 'An extra lab lesson', steps: slides(1) })).data.lesson;
  check('admin content: a deleted slug is never reused', LX2.slug === 'an-extra-lab-lesson-2');
  await owner.del('/api/admin/school/lessons/' + LX2.id);
  const dS2 = await owner.del('/api/admin/school/schools/' + sc2.id);
  check('admin content: an unused admin school is deleted (recycle bin)', dS2.status === 200 && dS2.data.batch && !sql.prepare('SELECT 1 FROM school_schools WHERE id=?').get(sc2.id));
  check('admin content: and its slug is not given out again', (await owner.post('/api/admin/school/schools', { title: 'Masterclasses with Ejiro' })).data.school.slug === 'masterclasses-with-ejiro-3');
  const audit = sql.prepare("SELECT action FROM audit WHERE action LIKE 'school.%' ORDER BY id DESC LIMIT 60").all().map((r) => r.action);
  check('admin content: every change is in the audit log', ['school.create', 'school.module.create', 'school.lesson.create', 'school.lesson.delete', 'school.delete'].every((a) => audit.includes(a)));
  // Leave the shared test database tidy for the tests after this one.
  for (const s of sql.prepare("SELECT id FROM school_schools WHERE source='admin'").all()) await owner.patch('/api/admin/school/schools/' + s.id, { published: false });
  sql.close();
};
