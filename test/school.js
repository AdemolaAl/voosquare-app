'use strict';
/* VooSquare Academy checks: content loader, pacing with an injected clock (x-vs-now, test mode only), server-side grading and
 * answer hiding, exam cooldowns, the school final, certificates (PDF, verify page, rename), prerequisites and admin
 * grants. Called from test/smoke.js with its helpers. SCHOOL_EXTRA_DIR points at a copy of test/fixtures/school plus
 * two broken files, so the loader's skip path is covered too. */
const crypto = require('node:crypto');

module.exports = async function school({ BASE, Client, check, owner, DB }) {
  const { DatabaseSync } = require('node:sqlite');
  const sql = new DatabaseSync(DB);
  const H = 3600_000;
  const xf = () => ({ 'x-forwarded-for': `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const login = async (c, email, name) => { const s = await c.post('/api/auth/start', { email, name }, xf()); return c.post('/api/auth/verify', { email, code: s.data.dev_code }, xf()); };
  // The right option id, computed the way the server does (HMAC with the app secret). Members never get this.
  const secret = JSON.parse(sql.prepare("SELECT value FROM settings WHERE key='app_secret'").get().value);
  const optId = (key, text) => crypto.createHmac('sha256', String(secret)).update('school-opt|' + key + '|' + String(text)).digest('hex').slice(0, 12);
  const qOf = (key) => {
    const m = /^([LM])(\d+)\.(\d+)$/.exec(key);
    const row = m[1] === 'L' ? sql.prepare('SELECT quiz j FROM school_lessons WHERE id=?').get(Number(m[2])) : sql.prepare('SELECT exam j FROM school_modules WHERE id=?').get(Number(m[2]));
    return JSON.parse(row.j)[Number(m[3])];
  };
  const right = (key) => { const q = qOf(key); return optId(key, q.options[q.answer]); };
  const wrong = (key) => { const q = qOf(key); return optId(key, q.options[(q.answer + 1) % q.options.length]); };
  const answersFor = (qs, fn) => Object.fromEntries(qs.map((q) => [q.id, fn(q.id)]));
  const at = (t) => ({ 'x-vs-now': String(Math.round(t)) });

  console.log('VooSquare Academy: content');
  const ov0 = (await new Client().get('/api/school')).data;
  const slugs = ov0.schools.map((s) => s.slug);
  check('school: three schools in order, plus the fixture school', slugs.slice(0, 3).join() === 'foundations,operator,scale' && slugs.includes('lab'), slugs);
  check('school: main schools are published and free', ov0.schools.filter((s) => s.track === 'main').map((s) => s.slug).join() === 'foundations,operator,scale' && ov0.schools.filter((s) => s.track === 'main').every((s) => s.published && !s.premium));
  const vs = ov0.schools.filter((s) => s.track === 'vertical');
  check('verticals: five vertical schools, free by default, specialist certificates', vs.map((s) => s.vertical).sort().join() === 'finance,igaming,nutra,sweeps,trading' && vs.every((s) => !s.premium && s.published && s.slug === 'v-' + s.vertical) && vs.find((s) => s.vertical === 'nutra').cert_title === 'Vertical Specialist — Nutra' && ov0.verticals.length === 5);
  check('layout: the school home knows the tips (the classic courses) separately', ov0.tips >= 1 && ov0.schools.every((s) => ['main', 'vertical', 'extra'].includes(s.track)));
  check('school: cert titles', ov0.schools[0].cert_title === 'Certificate — Media Buying Foundations' && ov0.schools[1].cert_title === 'Certificate — Operator' && ov0.schools[2].cert_title === 'Certificate of Completion — VooSquare Academy');
  const adm = (await owner.get('/api/admin/school')).data;
  const report = adm.last_load;
  check('loader: bad files are skipped with a reason', report && report.skipped.some((s) => /99-broken\.json/.test(s.file) && /invalid JSON/.test(s.error)) && report.skipped.some((s) => /98-bad-answer\.json/.test(s.file) && /answer index/.test(s.error)), report && report.skipped);
  check('loader: real modules load (every school has modules)', adm.schools.filter((s) => s.slug !== 'lab').every((s) => s.modules.length >= 1) && adm.schools.find((s) => s.slug === 'foundations').modules.every((m) => m.lessons >= 1 && m.exam_questions >= 1));
  check('loader: the photo slide whose picture is missing is dropped', report.notes.some((n) => /photo slide/.test(n)));
  check('admin: settings default to 20 hours between modules', adm.settings.unlock_hours === 20);

  const found = adm.schools.find((s) => s.slug === 'foundations');
  const m1 = found.modules[0], m2 = found.modules[1];
  const m1d = (await owner.get('/api/admin/school/modules/' + m1.id)).data;
  const L = m1d.lessons.map((l) => l.id);

  console.log('VooSquare Academy: lessons, quizzes and grading');
  const mem = new Client(); await login(mem, 'school-1@test.dev', 'Ngozi Adeyemi');
  const memId = (await mem.get('/api/me')).data.user.id;
  const pre1 = await mem.get('/api/school/lessons/' + L[0]);
  check('enrol: lessons stay locked until you enrol', pre1.status === 403 && pre1.data.lock.code === 'enroll');
  const en = (await mem.post('/api/school/schools/foundations/enroll')).data;
  check('enrol: card with name, face, student number, school, level and date', en.card && /^VS-\d{4}-\d{5}$/.test(en.card.number) && en.card.name === 'Ngozi Adeyemi' && typeof en.card.avatar === 'object' && en.card.school === 'Media Buying Foundations' && en.card.level === 'Beginner' && en.card.issued_at > 0 && !en.already, en);
  const en2 = (await mem.post('/api/school/schools/foundations/enroll')).data;
  check('enrol: enrolling again returns the same card', en2.already && en2.card.number === en.card.number && en2.card.issued_at === en.card.issued_at);
  check('enrol: the card shows on the school page', (await mem.get('/api/school/schools/foundations')).data.card.number === en.card.number);
  check('enrol: School 2 needs the School 1 certificate', (await mem.post('/api/school/schools/operator/enroll')).status === 403);
  check('school: lesson 2 is locked until lesson 1 is passed', (await mem.get('/api/school/lessons/' + L[1])).status === 403);
  check('school: logged-out visitors cannot open lessons', (await new Client().get('/api/school/lessons/' + L[0])).status === 401);
  const l1 = (await mem.get('/api/school/lessons/' + L[0])).data.lesson;
  const raw = JSON.stringify(l1.quiz);
  check('quiz: 5 questions with option ids, no answers or reasons sent', l1.quiz.length === 5 && l1.quiz.every((q) => q.options.length === 4 && q.options.every((o) => /^[0-9a-f]{12}$/.test(o.id) && o.text)) && !/"answer"|"why"|"correct"/.test(raw), raw.slice(0, 200));
  check('lesson: slides, glossary, objectives and takeaways come with it', l1.steps.length >= 10 && Array.isArray(l1.glossary) && l1.objectives.length >= 1 && l1.takeaways.length >= 1);
  const orders = new Set();
  for (let i = 0; i < 6; i++) orders.add((await mem.get(`/api/school/lessons/${L[0]}/quiz`)).data.quiz.map((q) => q.options.map((o) => o.id).join()).join('|'));
  check('quiz: options are shuffled between attempts (ids stay the same)', orders.size > 1);
  const k0 = l1.quiz[0].id;
  const c1 = (await mem.post(`/api/school/lessons/${L[0]}/check`, { question: k0, option: right(k0) })).data;
  const c2 = (await mem.post(`/api/school/lessons/${L[0]}/check`, { question: k0, option: wrong(k0) })).data;
  check('quiz: one-question check says right or wrong with the reason', c1.correct === true && c2.correct === false && c2.answer === right(k0) && c2.why.length > 5);
  check('quiz: check refuses questions from another lesson', (await mem.post(`/api/school/lessons/${L[0]}/check`, { question: `L${L[1]}.0`, option: 'x' })).status === 400);
  const byIndex = (await mem.post(`/api/school/lessons/${L[0]}/quiz`, { answers: Object.fromEntries(l1.quiz.map((q) => [q.id, qOf(q.id).answer])) })).data;
  check('grading: answer indexes score nothing (graded by option id on the server)', byIndex.score === 0 && !byIndex.passed);
  const three = (await mem.post(`/api/school/lessons/${L[0]}/quiz`, { answers: answersFor(l1.quiz, (k) => (k.endsWith('.0') || k.endsWith('.1') ? wrong(k) : right(k))) })).data;
  check('grading: 3 of 5 fails, wrong ones named, right answers not revealed', three.score === 3 && !three.passed && three.need === 4 && three.review.filter((x) => !x.correct).length === 2 && three.review.every((x) => x.answer === undefined && x.why === undefined) && three.gained === 0);
  check('school: lesson 2 still locked after a failed quiz', (await mem.get('/api/school/lessons/' + L[1])).status === 403);
  const four = (await mem.post(`/api/school/lessons/${L[0]}/quiz`, { answers: answersFor(l1.quiz, (k) => (k.endsWith('.0') ? wrong(k) : right(k))) })).data;
  check('grading: 4 of 5 passes, +50 XP once, review shows answers', four.score === 4 && four.passed && four.gained === 50 && four.review.every((x) => x.answer && x.answer_text) && four.next && four.next.status === 'open');
  const again = (await mem.post(`/api/school/lessons/${L[0]}/quiz`, { answers: answersFor(l1.quiz, right) })).data;
  check('grading: retaking a passed quiz gives no more XP', again.passed && again.gained === 0 && again.score === 5);
  check('school: lesson 2 opens after the quiz is passed', (await mem.get('/api/school/lessons/' + L[1])).status === 200);
  check('exam: cannot start before every lesson is passed', (await mem.post(`/api/school/modules/${m1.id}/exam/start`)).status === 403);

  for (const id of L.slice(1)) {
    const l = (await mem.get('/api/school/lessons/' + id)).data.lesson;
    await mem.post(`/api/school/lessons/${id}/quiz`, { answers: answersFor(l.quiz, right) });
  }
  const st1 = (await mem.get('/api/school/modules/' + m1.id)).data.module;
  check('module: every lesson done, exam available', st1.lessons.every((l) => l.status === 'done') && st1.exam.available);

  console.log('VooSquare Academy: exams and pacing');
  const enrolled = sql.prepare('SELECT started_at FROM school_enrollments WHERE user_id=?').get(memId).started_at;
  const p1 = (await mem.post(`/api/school/modules/${m1.id}/exam/start`)).data;
  check('exam: 10 questions, no answers sent', p1.questions.length === Math.min(10, m1.exam_questions) && !/"answer"|"why"/.test(JSON.stringify(p1.questions)) && /^p_/.test(p1.paper));
  const p1b = (await mem.post(`/api/school/modules/${m1.id}/exam/start`)).data;
  const f1 = (await mem.post(`/api/school/modules/${m1.id}/exam/submit`, { paper: p1.paper, answers: answersFor(p1.questions, (k, i) => wrong(k)) })).data;
  check('exam: a fail sets a 1 hour cooldown and hides the answers', !f1.passed && f1.retry_at > Date.now() + 55 * 60_000 && f1.review.every((x) => !x.answer_text));
  check('exam: a paper can only be handed in once', (await mem.post(`/api/school/modules/${m1.id}/exam/submit`, { paper: p1.paper, answers: {} })).status === 409);
  // A paper opened before the failed attempt is void (otherwise opening several papers at once skips the cooldown).
  check('exam: a second paper opened before the fail cannot be handed in', (await mem.post(`/api/school/modules/${m1.id}/exam/submit`, { paper: p1b.paper, answers: answersFor(p1b.questions, right) })).status === 409);
  const cool = await mem.post(`/api/school/modules/${m1.id}/exam/start`);
  check('exam: retry blocked during the cooldown', cool.status === 429 && cool.data.cooldown_until > Date.now());
  const tA = Date.now() + 61 * 60_000;
  const p2 = (await mem.post(`/api/school/modules/${m1.id}/exam/start`, {}, at(tA))).data;
  check('exam: retry allowed after an hour (injected clock)', p2 && p2.questions && p2.questions.length >= 1);
  const ok2 = (await mem.post(`/api/school/modules/${m1.id}/exam/submit`, { paper: p2.paper, answers: answersFor(p2.questions, right) }, at(tA))).data;
  check('exam: pass with 80% or more, +150 XP, answers revealed', ok2.passed && ok2.pct === 100 && ok2.gained === 150 && ok2.review.every((x) => x.answer_text));
  const opensAt = enrolled + 20 * H;
  const m2s = (await mem.get('/api/school/modules/' + m2.id, at(tA))).data.module;
  check('pacing: next module waits until 20 hours after the last one opened', m2s.status === 'waiting' && Math.abs(m2s.opens_at - Math.max(opensAt, tA)) < 2000, { status: m2s.status, opens: m2s.opens_at, want: opensAt });
  const m2l = (await owner.get('/api/admin/school/modules/' + m2.id)).data.lessons[0].id;
  const lockR = await mem.get('/api/school/lessons/' + m2l, at(tA));
  check('pacing: its lessons are locked with the reason and the time', lockR.status === 403 && lockR.data.lock && lockR.data.lock.code === 'waiting' && lockR.data.lock.opens_at === m2s.opens_at);
  const hero = (await mem.get('/api/school', at(tA))).data;
  check('pacing: the hero shows the next unlock', hero.next && hero.next.module_id === m2.id && hero.next.opens_at === m2s.opens_at);
  check('pacing: opens once the time has passed', (await mem.get('/api/school/lessons/' + m2l, at(m2s.opens_at + 1000))).status === 200);
  // unlock_hours 0 turns pacing off.
  const mem2 = new Client(); await login(mem2, 'school-2@test.dev', 'Kofi Mensah');
  const mem2Id = (await mem2.get('/api/me')).data.user.id;
  check('admin: grant pass_module needs the academy permission', (await mem2.post(`/api/admin/school/members/${mem2Id}/grant`, { action: 'pass_module', module_id: m1.id })).status === 403);
  await mem2.post('/api/school/schools/foundations/enroll');
  const g1 = await owner.post(`/api/admin/school/members/${mem2Id}/grant`, { action: 'pass_module', module_id: m1.id });
  const m2b = (await mem2.get('/api/school/modules/' + m2.id)).data.module;
  check('admin: pass_module marks the module passed for one member; pacing still applies', g1.status === 200 && m2b.status === 'waiting');
  await owner.post(`/api/admin/school/members/${mem2Id}/grant`, { action: 'skip_wait', module_id: m2.id });
  check('admin: skip_wait opens the next module now', (await mem2.get('/api/school/modules/' + m2.id)).data.module.status === 'open');
  check('admin: unlock hours validated', (await owner.put('/api/admin/school/settings', { unlock_hours: -1 })).status === 400);
  await owner.put('/api/admin/school/settings', { unlock_hours: 0 });
  check('pacing: 0 hours turns the wait off', (await mem.get('/api/school/modules/' + m2.id, at(tA))).data.module.status === 'open');
  await owner.put('/api/admin/school/settings', { unlock_hours: 20 });

  console.log('VooSquare Academy: prerequisites, final exam and certificates');
  const op = adm.schools.find((s) => s.slug === 'operator');
  const opL = (await owner.get('/api/admin/school/modules/' + op.modules[0].id)).data.lessons[0].id;
  const pre = await mem.get('/api/school/lessons/' + opL);
  check('prereq: School 2 needs the School 1 certificate', pre.status === 403 && pre.data.lock.code === 'prereq');
  const lab = adm.schools.find((s) => s.slug === 'lab');
  const labM = lab.modules[0];
  const labL = (await owner.get('/api/admin/school/modules/' + labM.id)).data.lessons.map((l) => l.id);
  check('prereq: a later school is locked', (await mem.get('/api/school/lessons/' + labL[0])).status === 403);
  await owner.post(`/api/admin/school/members/${memId}/grant`, { action: 'open_school', school_id: lab.id });
  check('enrol: a granted school can be enrolled', (await mem.post('/api/school/schools/lab/enroll')).status === 200);
  check('admin: open_school lets one member in without the certificate', (await mem.get('/api/school/lessons/' + labL[0])).status === 200);
  check('final: locked until every module exam is passed', (await mem.post('/api/school/schools/lab/final/start')).status === 403);
  for (const id of labL) { const l = (await mem.get('/api/school/lessons/' + id)).data.lesson; await mem.post(`/api/school/lessons/${id}/quiz`, { answers: answersFor(l.quiz, right) }); }
  const lp = (await mem.post(`/api/school/modules/${labM.id}/exam/start`)).data;
  await mem.post(`/api/school/modules/${labM.id}/exam/submit`, { paper: lp.paper, answers: answersFor(lp.questions, right) });
  const fp = (await mem.post('/api/school/schools/lab/final/start')).data;
  const keys = fp.questions.map((q) => q.id);
  check('final: module-exam questions only; a school with fewer than 25 uses all of them', keys.length === 10 && keys.every((k) => k.startsWith('M')) && new Set(keys).size === 10);
  const ff = (await mem.post('/api/school/schools/lab/final/submit', { paper: fp.paper, answers: answersFor(fp.questions, (k) => (keys.indexOf(k) < 3 ? wrong(k) : right(k))) })).data;
  check('final: 7 of 10 (70%) fails, retry in 24 hours', !ff.passed && ff.score === 7 && ff.retry_at > Date.now() + 23 * H && !ff.certificate);
  const ffRaw = JSON.stringify(ff);
  check('final: a failed attempt shows only the score and the modules to review (no questions, no answers)', ff.review === undefined && !/answer|"why"|"q"/.test(ffRaw) && ff.topics.length === 1 && ff.topics[0].module_id === labM.id && ff.topics[0].missed === 3 && ff.topics[0].title === 'Every slide type', ffRaw);
  check('final: retry blocked for 24 hours', (await mem.post('/api/school/schools/lab/final/start', {}, at(Date.now() + 23 * H))).status === 429);
  const tF = Date.now() + 24 * H + 60_000;
  const fp2 = (await mem.post('/api/school/schools/lab/final/start', {}, at(tF))).data;
  const fin = (await mem.post('/api/school/schools/lab/final/submit', { paper: fp2.paper, answers: answersFor(fp2.questions, (k) => (fp2.questions[0].id === k ? wrong(k) : right(k))) }, at(tF))).data;
  const cert = fin.certificate;
  check('final: a passed attempt does not reveal answers either', fin.review === undefined && !/answer_text|"why"/.test(JSON.stringify(fin)) && fin.topics.length === 1);
  check('final: 9 of 10 passes and issues a certificate (+500 XP)', fin.passed && fin.score === 9 && fin.gained === 500 && cert && /^VS-[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(cert.code) && cert.name === 'Ngozi Adeyemi' && cert.title === 'Certificate — Slide lab');
  check('certificate: email queued', !!sql.prepare("SELECT 1 FROM email_queue WHERE user_id=? AND template='certificate_issued'").get(memId));
  check('certificate: listed for the member', (await mem.get('/api/school/certificates')).data.certificates.some((c) => c.code === cert.code));
  const pdfRes = await fetch(`${BASE}/api/school/certificates/${cert.code}/pdf`, { headers: { cookie: mem.cookie } });
  const pdf = Buffer.from(await pdfRes.arrayBuffer());
  const txt = pdf.toString('latin1');
  const sx = Number(/startxref\n(\d+)/.exec(txt)[1]);
  check('certificate: PDF download (%PDF, >1 KB, valid xref, A4 landscape)', pdfRes.status === 200 && /application\/pdf/.test(pdfRes.headers.get('content-type')) && txt.startsWith('%PDF-1.4') && pdf.length > 1024 && txt.slice(sx, sx + 4) === 'xref' && /MediaBox \[0 0 841\.89 595\.28\]/.test(txt) && txt.trimEnd().endsWith('%%EOF') && txt.includes('(Ngozi Adeyemi)'), pdf.length);
  check('certificate: another member cannot download it', (await mem2.get(`/api/school/certificates/${cert.code}/pdf`)).status === 404);
  const vp = await fetch(`${BASE}/verify/${cert.code}`);
  const vh = await vp.text();
  check('verify page: public, shows name, certificate and date, no email', vp.status === 200 && vh.includes('Ngozi Adeyemi') && vh.includes('Valid certificate') && vh.includes('Certificate — Slide lab') && !vh.includes('school-1@test.dev') && !/<script/i.test(vh) && /default-src 'self'/.test(vp.headers.get('content-security-policy')));
  check('verify page: unknown code is a 404 page', (await fetch(`${BASE}/verify/VS-NOPE0-NOPE0`)).status === 404);
  const vj = (await new Client().get('/api/verify/' + cert.code.toLowerCase())).data;
  check('verify api: valid, name and school only', vj.valid === true && vj.name === 'Ngozi Adeyemi' && Object.keys(vj).sort().join() === 'code,issued_at,name,school,title,valid');
  const rn = await mem.post(`/api/school/certificates/${cert.code}/name`, { name: 'Ngozi A. Adeyemi' });
  check('certificate: the name can be changed once', rn.status === 200 && rn.data.certificate.name === 'Ngozi A. Adeyemi' && !rn.data.certificate.can_rename && (await mem.post(`/api/school/certificates/${cert.code}/name`, { name: 'Someone Else' })).status === 409);
  const ac = (await owner.get('/api/admin/school/certificates?q=' + cert.code)).data.certificates[0];
  await owner.post(`/api/admin/school/certificates/${ac.id}/revoke`, { reason: 'test' });
  const rv = await (await fetch(`${BASE}/verify/${cert.code}`)).text();
  check('admin: revoke shows on the verify page and blocks the PDF', rv.includes('revoked') && (await mem.get(`/api/school/certificates/${cert.code}/pdf`)).status === 410);
  await owner.post(`/api/admin/school/certificates/${ac.id}/revoke`, { restore: true });
  check('admin: restore makes it valid again', (await new Client().get('/api/verify/' + cert.code)).data.valid === true);
  const mv = (await owner.get('/api/admin/school/members/' + memId)).data;
  check('admin: member progress view', mv.schools.find((s) => s.slug === 'foundations').modules[0].status === 'passed' && mv.certificates.length === 1 && mv.schools.find((s) => s.slug === 'lab').granted);

  console.log('VooSquare Academy: admin');
  const sch = (await owner.patch(`/api/admin/school/schools/${found.id}`, { premium: true, cert_title: 'Certificate — Foundations (edited)' })).data.school;
  const mem3 = new Client(); await login(mem3, 'school-3@test.dev', 'Musa Bello');
  const plock = await mem3.get('/api/school/lessons/' + L[0]);
  check('admin: premium toggle locks a school for free members', sch.premium === 1 && plock.status === 403 && plock.data.lock.code === 'premium');
  await owner.patch(`/api/admin/school/schools/${found.id}`, { premium: false, cert_title: 'Certificate — Media Buying Foundations' });
  await owner.patch(`/api/admin/school/schools/${lab.id}`, { published: false });
  check('admin: an unpublished school is hidden from members', !(await mem3.get('/api/school')).data.schools.some((s) => s.slug === 'lab') && (await owner.get('/api/school')).data.schools.some((s) => s.slug === 'lab'));
  await owner.patch(`/api/admin/school/schools/${lab.id}`, { published: true });
  const ed = await owner.post('/api/admin/school/lessons/' + labL[0], { title: 'Edited by the team', steps: [{ v: 'big', h: 'One', p: 'Two', d: { b: 'Three' } }] });
  check('admin: a photo slide needs a picture path inside the site', (await owner.post('/api/admin/school/lessons/' + labL[0], { steps: [{ v: 'photo', d: { src: '"><img src=x>' } }] })).status === 400);
  check('admin: lesson edit validates slides', (await owner.post('/api/admin/school/lessons/' + labL[0], { steps: [{ v: 'nope', d: {} }] })).status === 400 && (await owner.post('/api/admin/school/lessons/' + labL[0], { quiz: [{ q: 'x', options: ['a', 'a'], answer: 0 }] })).status === 400);
  const rl = (await owner.post('/api/admin/school/reload')).data.report;
  const kept = sql.prepare('SELECT title, edited FROM school_lessons WHERE id=?').get(labL[0]);
  check('admin: edited lessons survive a reload from files', ed.status === 200 && kept.title === 'Edited by the team' && kept.edited === 1 && rl.lessons_kept >= 1);
  await owner.post(`/api/admin/school/lessons/${labL[0]}/revert`);
  const back = sql.prepare('SELECT title, edited FROM school_lessons WHERE id=?').get(labL[0]);
  check('admin: revert takes the lesson from its file again', back.edited === 0 && back.title === 'The classic slides');
  check('admin: progress survives reloads', !!sql.prepare('SELECT 1 FROM school_progress WHERE user_id=? AND lesson_id=? AND passed_at IS NOT NULL').get(memId, labL[0]));

  console.log('VooSquare Academy: verticals, Premium gate, partners and cards');
  // Free by default: a free member can choose a vertical and the vertical schools are not locked.
  const fv = await mem3.get('/api/school/vertical');
  check('free verticals: a free member may choose a vertical', fv.status === 200 && fv.data.can_choose === true && fv.data.premium === false);
  check('free verticals: choosing one works without Premium', (await mem3.post('/api/school/vertical', { vertical: 'nutra' })).status === 200);
  check('free verticals: vertical schools are not locked for free members', (await mem3.get('/api/school/schools/v-trading')).data.school.status !== 'premium' && (await mem3.get('/api/school')).data.can_choose === true);
  {
    // Migration 011 frees the five built-in vertical schools on an existing database and leaves every other school alone.
    const { DatabaseSync } = require('node:sqlite');
    const mdb = new DatabaseSync(':memory:');
    mdb.exec("CREATE TABLE school_schools(id INTEGER PRIMARY KEY, slug TEXT, track TEXT, premium INTEGER)");
    for (const [slug, track] of [['v-nutra', 'vertical'], ['v-igaming', 'vertical'], ['v-trading', 'vertical'], ['v-finance', 'vertical'], ['v-sweeps', 'vertical'], ['my-premium-school', 'extra']]) mdb.prepare('INSERT INTO school_schools(slug, track, premium) VALUES(?,?,1)').run(slug, track);
    require('../src/migrations/011-academy-verticals-free.js').up(mdb, { hasTable: (t) => !!mdb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t) });
    const after = mdb.prepare('SELECT slug, premium FROM school_schools').all();
    check('migration 011: the five vertical schools become free; other Premium schools stay Premium', after.filter((r) => r.slug.startsWith('v-')).every((r) => r.premium === 0) && after.find((r) => r.slug === 'my-premium-school').premium === 1);
    mdb.close();
  }
  // The team can still mark a vertical school Premium in the admin: then the gate is back for that school.
  const adminSchools = (await owner.get('/api/admin/school')).data.schools;
  const vIds = adminSchools.filter((x) => x.track === 'vertical').map((x) => x.id);
  check('free verticals: the admin sees the five vertical schools', vIds.length === 5);
  for (const id of vIds) await owner.patch('/api/admin/school/schools/' + id, { premium: true });
  check('premium switch: with every vertical marked Premium, free members cannot choose one', (await mem3.get('/api/school/vertical')).data.can_choose === false);
  const v1 = await mem3.post('/api/school/schools/v-nutra/enroll');
  check('premium gate: free members cannot enrol in a vertical school', v1.status === 403 && v1.data.lock.code === 'premium');
  check('premium gate: free members cannot choose a vertical', (await mem3.post('/api/school/vertical', { vertical: 'nutra' })).status === 403);
  check('premium gate: vertical lessons are locked for free members', (await mem3.get('/api/school/schools/v-trading')).data.school.status === 'premium');
  const mem3Id = (await mem3.get('/api/me')).data.user.id;
  await owner.patch('/api/admin/customers/' + mem3Id, { premium_days: 30 });
  check('verticals: unknown vertical refused', (await mem3.post('/api/school/vertical', { vertical: 'casino' })).status === 400);
  const ch = (await mem3.post('/api/school/vertical', { vertical: 'trading' })).data;
  const ovp = (await mem3.get('/api/school')).data;
  check('verticals: a Premium member chooses one; it is stored and featured', ch.vertical === 'trading' && ch.school === 'v-trading' && ovp.vertical === 'trading' && ovp.schools.find((x) => x.slug === 'v-trading').chosen && !ovp.schools.find((x) => x.slug === 'v-nutra').chosen);
  await owner.put('/api/admin/school/settings', { verticals_any: false });
  const vOther = await mem3.post('/api/school/schools/v-nutra/enroll');
  check('verticals: with "any vertical" off, only the chosen one can be enrolled', vOther.status === 403 && vOther.data.lock.code === 'vertical' && (await mem3.post('/api/school/schools/v-trading/enroll')).status === 200);
  await owner.put('/api/admin/school/settings', { verticals_any: true });
  const vc = (await mem3.post('/api/school/schools/v-nutra/enroll')).data.card;
  check('verticals: other verticals are open to Premium by default; card carries the Premium mark', vc && vc.premium && vc.track === 'vertical' && vc.vertical === 'nutra');
  check('verticals: the choice can change later', (await mem3.post('/api/school/vertical', { vertical: 'finance' })).data.vertical === 'finance');
  const vtrL = (await mem3.get('/api/school/schools/v-trading')).data.school.modules[0].lessons[0];
  check('verticals: lessons open with the same pacing', (await mem3.get('/api/school/lessons/' + vtrL.id)).status === 200);
  const pv = (await owner.get('/api/admin/school/modules/' + found.modules.find((m) => m.slug === 'picking-your-vertical').id)).status === 200 && (await owner.get('/api/school/modules/' + found.modules.find((m) => m.slug === 'picking-your-vertical').id)).data.vertical_pick === true;
  check('verticals: the "Picking your vertical" module offers the choice', pv);

  // Partners
  check('partners: academy permission needed', (await mem3.post('/api/admin/school/partners', { name: 'X' })).status === 403);
  check('partners: links must be https', (await owner.post('/api/admin/school/partners', { vertical: 'nutra', name: 'Bad', url: 'http://nope.example', enabled: true })).status === 400);
  check('partners: up to 3 highlights', (await owner.post('/api/admin/school/partners', { vertical: 'nutra', name: 'Many', url: 'https://ok.example', highlights: ['a', 'b', 'c', 'd'] })).status === 400);
  const pc = (await owner.post('/api/admin/school/partners', { vertical: 'nutra', name: 'Example Network', description: 'Test partner', highlights: ['Weekly pay', 'NG and KE'], url: 'https://network.example/join?ref=vs', cta: 'Join', badge: 'Recommended', enabled: true })).data.partner;
  const ml = (await mem3.get('/api/school/partners?vertical=nutra')).data.partners;
  check('partners: members see enabled partners, without the raw link', pc && ml.length === 1 && ml[0].name === 'Example Network' && ml[0].badge === 'Recommended' && ml[0].highlights.length === 2 && ml[0].go === `/api/school/partners/${pc.id}/go` && ml[0].url === undefined);
  const go = await fetch(`${BASE}/api/school/partners/${pc.id}/go`, { redirect: 'manual', headers: { 'x-forwarded-for': '10.9.9.9' } });
  await fetch(`${BASE}/api/school/partners/${pc.id}/go`, { redirect: 'manual', headers: { 'x-forwarded-for': '10.9.9.8' } });
  const al = (await owner.get('/api/admin/school/partners')).data.partners.find((x) => x.id === pc.id);
  check('partners: clicks are counted and redirect to the partner', go.status === 302 && go.headers.get('location') === 'https://network.example/join?ref=vs' && al.clicks === 2 && al.url === 'https://network.example/join?ref=vs');
  check('partners: shown on the vertical school page', (await mem3.get('/api/school/schools/v-nutra')).data.partners.length === 1);
  // Product and partner slides in a lesson (the fixture's lesson 2 has one of each).
  const fx = (await mem.get('/api/school/lessons/' + labL[1])).data;
  const pslide = fx.lesson.steps.find((x) => x.v === 'product');
  check('product slide: live card data from Products (name, launch link, status)', pslide && fx.refs.products.joinvoo && fx.refs.products.joinvoo.name === 'Joinvoo' && fx.refs.products.joinvoo.launch_url.startsWith('https://joinvoo.com') && fx.refs.products.joinvoo.status === 'live');
  check('partner slide: partners for its vertical come with the lesson', fx.lesson.steps.some((x) => x.v === 'partner') && fx.refs.partners.nutra.length === 1);
  await owner.patch(`/api/admin/school/partners/${pc.id}`, { enabled: false });
  const fx2 = (await mem.get('/api/school/lessons/' + labL[1])).data;
  const fxs = (await owner.get('/api/school/lessons/' + labL[1])).data;
  check('partner slide: hidden from members when there are no partners; the team still sees it', !fx2.lesson.steps.some((x) => x.v === 'partner') && fxs.lesson.steps.some((x) => x.v === 'partner') && fxs.refs.partners.nutra.length === 0 && (await mem.get('/api/school/partners?vertical=nutra')).data.partners.length === 0);
  const jv = (await owner.get('/api/admin/products')).data.products.find((p) => p.slug === 'joinvoo');
  await owner.del('/api/admin/products/' + jv.id);
  const fx3 = (await mem.get('/api/school/lessons/' + labL[1])).data;
  check('product slide: dropped when the product is hidden', !fx3.lesson.steps.some((x) => x.v === 'product') && !fx3.refs.products.joinvoo);
  await owner.post(`/api/admin/products/${jv.id}/show`);
  check('partners: delete', (await owner.del('/api/admin/school/partners/' + pc.id)).status === 200 && !(await owner.get('/api/admin/school/partners')).data.partners.some((x) => x.id === pc.id));
  check('partners: no real partner links are seeded', (await owner.get('/api/admin/school/partners')).data.partners.length === 0);
  const vpdf = await (await fetch(`${BASE}/api/admin/school/members/${mem3Id}`, { headers: { cookie: owner.cookie } })).json();
  check('admin: member view shows the vertical and student number', vpdf.vertical === 'finance' && /^VS-/.test(vpdf.student));

  const ownerFinal = (await owner.post('/api/school/schools/foundations/final/start')).data;
  check('final: a real school draws 25 module-exam questions, none from lesson quizzes', ownerFinal.questions.length === 25 && ownerFinal.questions.every((q) => q.id.startsWith('M')) && !/"answer"|"why"/.test(JSON.stringify(ownerFinal.questions)));
  // Performance: school pages carry titles and counts only; slides come one lesson at a time.
  const big = await mem.get('/api/school/schools/foundations');
  check('performance: school page has no lesson content (slide counts only)', big.data.school.modules.every((m) => m.lessons.every((l) => typeof l.steps === 'number')) && JSON.stringify(big.data).length < 120_000 && !/"quiz"|"glossary"/.test(JSON.stringify(big.data)));

  // Labs: every lab answer in the content agrees with the player's maths (lesson-visuals.js + tools-math.js).
  {
    const vm = require('node:vm');
    const fsx = require('node:fs'); const px = require('node:path');
    const sb = { window: {}, matchMedia: () => ({ matches: false }), console };
    vm.createContext(sb);
    vm.runInContext(fsx.readFileSync(px.join(__dirname, '..', 'public', 'js', 'lesson-visuals.js'), 'utf8'), sb);
    sb.window.VSTM = require('../public/js/tools-math.js');
    const V = sb.window.VSL; const root = px.join(__dirname, '..', 'src', 'seed', 'school');
    let n = 0; const bad = [];
    for (const dir of fsx.readdirSync(root)) for (const f of fsx.readdirSync(px.join(root, dir))) {
      let j; try { j = JSON.parse(fsx.readFileSync(px.join(root, dir, f), 'utf8')); } catch { continue; }
      for (const l of j.lessons || []) for (const st of l.steps || []) {
        if (st.v !== 'lab' || !st.d || !st.d.answer || st.d.answer.value === undefined) continue;
        n++;
        const r = V.labCompute(st.d.kind, st.d.preset || {}, st.d.answer.field);
        const tol = Math.max(Number(st.d.answer.tolerance) || 0, 0.01);
        const ok = st.d.kind === 'killscale' ? String(r.value) === String(st.d.answer.value).replace('scale_big', 'scale') : Math.abs(r.value - st.d.answer.value) <= Math.max(tol, tol * Math.abs(r.value)) + 1e-9;
        if (!ok) bad.push(`${dir}/${f} ${l.slug} ${st.d.kind}`);
      }
    }
    check(`labs: all ${n} lab answers in the content match the player's maths (funnel = lowest pass-through, 0-based)`, n > 0 && !bad.length, bad.slice(0, 5));
    const fun = V.labCompute('funnel', { steps: [['Clicks', 1000], ['Views', 820], ['Taps', 300], ['Joins', 270]] }, 'worst_step');
    check('labs: funnel worst_step is the 0-based index of the lowest step-to-step rate', fun.value === 2);
    const lb = V.render({ v: 'lab', d: { kind: 'breakeven', labels: { rate: 'Approval rate', unit: 'approved lead' }, preset: { payout: 12, cr_pct: 60, margin_pct: 25 }, answer: { field: 'max_cpl', value: 5.4 } } });
    check('labs: labels override the default wording', lb.includes('Approval rate') && lb.includes('Payout per approved lead') && !lb.includes('Leads that deposit'));
    const pr = V.render({ v: 'product', d: { slug: 'joinvoo', why: 'Why' }, _ref: { slug: 'joinvoo', name: 'Joinvoo', status: 'live', launch_url: 'https://joinvoo.com', color: '#5B3FE8', tagline: 'T' } });
    const pa = V.render({ v: 'partner', d: { vertical: 'nutra' }, _ref: [{ id: 1, name: 'Net', go: '/api/school/partners/1/go', highlights: ['a'], cta: 'Join' }] });
    const kx = V.render({ v: 'lab', d: { kind: 'breakeven', preset: { payout: 1 }, answer: { field: '"><b id=inj>', value: 1 } } });
    check('render: a lab answer field name is escaped', !kx.includes('<b id=inj>'));
    const wk = (screen) => V.render({ v: 'walk', d: { steps: [{ title: 'A', text: 'a', screen }, { title: 'B', text: 'b', screen }] } });
    const scr = { kind: 'browser', url: 'adsmanager.example', title: 'Create', blocks: [{ type: 'field', label: 'Name', value: 'NG_Test' }] };
    check('render: walk screens without "v" or nested in "d" draw as screens', [wk(scr), wk({ v: 'screen', d: scr }), wk({ v: 'screen', ...scr })].every((h) => h.includes('vl-screen') && h.includes('NG_Test')) && wk({ app: 'chat', title: 'Bot', messages: [{ from: 'me', text: 'hi' }] }).includes('vl-phone'));
    // Lesson art (lesson-art.js): every content slide gets the same art each time, never the same scene twice in a row.
    vm.runInContext(fsx.readFileSync(px.join(__dirname, '..', 'public', 'js', 'lesson-art.js'), 'utf8'), sb);
    const VA = sb.window.VSA; let artN = 0; const artBad = [];
    for (const dir of fsx.readdirSync(root)) for (const f of fsx.readdirSync(px.join(root, dir))) {
      const j = JSON.parse(fsx.readFileSync(px.join(root, dir, f), 'utf8'));
      for (const l of j.lessons || []) {
        const ctx = { school: dir, module: j.title, title: l.title };
        const a = VA.plan(l.steps, ctx); const b2 = VA.plan(l.steps, ctx);
        if (JSON.stringify(a) !== JSON.stringify(b2) || a.length !== l.steps.length) artBad.push(l.slug);
        let prev = null;
        a.forEach((x, i) => { if (x && x.scene) { artN++; if (x.scene === prev) artBad.push(`${l.slug} #${i} repeats ${x.scene}`); if (!VA.SCENES.includes(x.scene)) artBad.push('unknown ' + x.scene); prev = x.scene; } if (x && x.scene && !['big', 'stat', 'tip', 'quote'].includes(l.steps[i].v)) artBad.push(`${l.slug} #${i} art on ${l.steps[i].v}`); });
      }
    }
    check(`lesson art: ${artN} text-led slides get a deterministic scene, never the same one twice in a row, none on dense visuals`, artN > 1000 && !artBad.length, artBad.slice(0, 5));
    check('lesson art: the voice build hooks exist', typeof V.build === 'function' && typeof V.reveal === 'function');
    check('render: product and partner slides draw their live cards', pr.includes('Open Joinvoo') && pr.includes('https://joinvoo.com') && pa.includes('/api/school/partners/1/go') && pa.includes('Net'));
  }

  // Student card: the level and date columns size to their content (no "Intermedi…"); only the school name may shorten.
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'css', 'school.css'), 'utf8');
  check('student card: level and issued columns are never truncated', /\.idc-bot \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto/.test(css));
  const opCard = (await owner.post('/api/school/schools/operator/enroll')).data.card;
  check('student card: Intermediate level carried in full', opCard && opCard.level === 'Intermediate');

  /* The PDF writer on its own. */
  const P = require('../src/pdf');
  check('pdf: WinAnsi text (accents, smart quotes, unknown characters)', P.winAnsi('Ọlá “É”').join() === [79, 108, 225, 32, 0x93, 201, 0x94].join());
  check('pdf: stacked accents keep the printable one, never a stray question mark (Yoruba names)', Buffer.from(P.winAnsi('Adébáyọ̀ Ọ̀kọ́ Ṣèyí Łukasz')).toString('latin1') === 'Adébáyò Òkó Sèyí Lukasz');
  check('pdf: Helvetica widths', Math.round(P.textWidth('Voo', 'Helvetica', 10)) === 18);
  sql.close();
};
