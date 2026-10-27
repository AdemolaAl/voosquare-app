/* VooSquare admin: VooSquare Academy. Schools (publish, Premium, certificate titles), pacing, reload from files, modules
 * and lessons (slide JSON editor with live preview), certificates (search, revoke, restore) and the member card on a
 * customer's page (progress, grants and skips). Loaded after admin.js, which shares its helpers on window.VSA. */
(function () {
  'use strict';
  const { $, $$, esc, fmt, icon, toast, dateStr } = VS;
  const A = window.VSA;
  const { can, GET, POST, PUT, PATCH, DEL, run, confirmIn, field, input, textarea, switchField, readForm, pill, empty, errorBox, skelRows, pageHead, backLink } = A;
  const when = (t) => (t ? `${dateStr(t)}, ${new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '');
  const mins = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  const STATUS = { passed: ['Passed', 'g'], open: ['Open', 'l'], waiting: ['Waiting', 'gold'], locked: ['Locked', 'w'], prereq: ['Needs previous certificate', 'w'], premium: ['Premium', 'k'] };
  const stPill = (s) => { const x = STATUS[s] || [s, 'w']; return pill(x[0], x[1]); };
  const tabs = (on) => `<nav class="tabs ss-tabs" aria-label="VooSquare Academy sections"><a href="#school" class="${on === 'home' ? 'on' : ''}">Schools and pacing</a><a href="#school/certs" class="${on === 'certs' ? 'on' : ''}">Certificates</a><a href="#school/voice" class="${on === 'voice' ? 'on' : ''}">Teaching voice</a></nav>`;

  const made = () => pill('Made in admin', 'b');
  const isMade = (x) => x && x.source === 'admin';
  /* A new lesson starts from three slides the owner rewrites: a big idea, the steps, a tip. "say" is what the voice reads. */
  const TEMPLATE = () => [
    { v: 'big', h: 'The big idea', p: 'Say in one or two sentences what this lesson teaches and why it matters.', d: { b: 'Your big idea in a few words', s: 'A short line under it' }, say: 'Here is the one idea to take from this lesson.' },
    { v: 'check', h: 'How to do it', p: 'The steps, in the order you do them.', d: ['First step', 'Second step', 'Third step'], say: 'Do these three things, in this order.' },
    { v: 'tip', h: 'Remember this', p: 'One practical note to finish.', d: { kind: 'tip', text: 'A short, practical note from the buying desk.' }, say: 'Keep this in mind when you try it yourself.' },
  ];

  A.page('school', {
    t: 'VooSquare Academy', i: 'trophy', perm: () => can('academy'),
    r(el, args, q) {
      if (args[0] === 'module' && args[1]) return moduleView(el, args[1]);
      if (args[0] === 'lesson' && args[1]) return lessonEditor(el, args[1]);
      if (args[0] === 'new-lesson' && args[1]) return lessonEditor(el, null, args[1]);
      if (args[0] === 'certs') return certsView(el, q);
      if (args[0] === 'voice' && A.voicePage) return A.voicePage(el, args, q); // admin-voice.js
      return home(el);
    },
  });
  // Show it next to the Academy in the menu.
  const content = A.NAV.find((g) => g[0] === 'Content');
  if (content && !content[1].includes('school')) content[1].splice(content[1].indexOf('academy') + 1, 0, 'school');

  /* ---------------- add or edit a school, add a module (content made in the admin) ---------------- */
  function schoolForm(d, s) {
    const cur = s || { title: '', level: 'Masterclass', subtitle: '', cert_title: '', requires: '', published: true, premium: false };
    const others = d.schools.filter((x) => !s || x.id !== s.id);
    const m = A.modal({ title: s ? `Edit ${s.title}` : 'Add a school', wide: true, body: `<form class="stack" id="ssSF" novalidate>
      <p class="info-line sm">${icon('book')}<span>Shown to members under <b>More schools</b> as an <b>Extra</b> school. It never changes the main path or anyone's pace.</span></p>
      <div class="g2c">${field('Title', input('title', cur.title, { max_len: 80, ph: 'Masterclasses with Ejiro' }))}${field('Level line', input('level', cur.level, { max_len: 30, ph: 'Masterclass' }), 'A word or two, like Masterclass or Advanced.')}</div>
      ${field('Description', textarea('subtitle', cur.subtitle, { rows: 2, ph: 'What members learn here, in one or two sentences.' }), 'Optional. Up to 300 characters.')}
      ${field('Certificate title', input('cert_title', cur.cert_title, { max_len: 120, ph: 'Certificate — Masterclasses with Ejiro' }), 'Printed on the certificate. Left empty, it is "Certificate — " and the title.')}
      ${field('Who can enrol', A.select('requires', [['', 'Everyone (no certificate needed first)'], ...others.map((x) => [x.slug, `After the ${x.title} certificate`])], cur.requires, { aria: 'Who can enrol' }))}
      ${s ? '' : `<div class="row ss-sw">${switchField('published', cur.published, 'Published', 'Members see it once it has a lesson')}${switchField('premium', cur.premium, 'Premium only')}</div>`}
    </form>`, foot: `<button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button type="button" class="btn btn-g btn-sm" data-save>${s ? 'Save school' : 'Add school'}</button>` });
    m.q('[data-cancel]').onclick = m.close;
    m.q('[data-save]').onclick = async (e) => {
      const v = readForm(m.q('#ssSF'));
      if (!v.title.trim()) { toast('Give the school a title.', 'err'); m.q('[name=title]').focus(); return; }
      const body = { title: v.title, level: v.level, subtitle: v.subtitle, cert_title: v.cert_title, requires: v.requires };
      if (!s) Object.assign(body, { published: v.published, premium: v.premium });
      else if (!body.cert_title.trim()) delete body.cert_title;
      const r = await run(e.currentTarget, () => (s ? PATCH('/api/admin/school/schools/' + s.id, body) : POST('/api/admin/school/schools', body)), s ? 'School saved' : 'School added. Now add its first module.');
      if (r) { m.close(); A.route(true); }
    };
  }
  function moduleForm(s, mod, done) {
    const next = s.modules.reduce((a, x) => Math.max(a, x.order || 0), 0) + 1;
    const cur = mod || { title: '', summary: '', sort: next, published: true };
    const m = A.modal({ title: mod ? `Edit ${mod.title}` : `Add a module to ${s.title}`, wide: true, body: `<form class="stack" id="ssMF" novalidate>
      <div class="g3c">${field('Title', input('title', cur.title, { max_len: 140, ph: 'Scaling a winning ad' }), '', 'span2')}${field('Order', input('order', cur.sort, { type: 'number', min: 1, max: 999 }), 'Modules run from low to high.')}</div>
      ${field('Summary', textarea('summary', cur.summary, { rows: 3, ph: 'What this module covers.' }), 'Optional. Up to 600 characters.')}
      ${mod ? '' : `<div class="row">${switchField('published', cur.published, 'Published', 'Members see it once it has a lesson')}</div>
      <p class="info-line sm">${icon('check')}<span>No exam to start with: members pass the module by finishing its lessons. You can add exam questions on the module page.${isMade(s) ? '' : ' Members already in this school will need this module before its final exam.'}</span></p>`}
    </form>`, foot: `<button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button type="button" class="btn btn-g btn-sm" data-save>${mod ? 'Save module' : 'Add module'}</button>` });
    m.q('[data-cancel]').onclick = m.close;
    m.q('[data-save]').onclick = async (e) => {
      const v = readForm(m.q('#ssMF'));
      if (!v.title.trim()) { toast('Give the module a title.', 'err'); m.q('[name=title]').focus(); return; }
      const body = { title: v.title, summary: v.summary, order: v.order };
      if (!mod) body.published = v.published;
      const r = await run(e.currentTarget, () => (mod ? PATCH('/api/admin/school/modules/' + mod.id, body) : POST(`/api/admin/school/schools/${s.id}/modules`, body)), mod ? 'Module saved' : 'Module added. Now add its first lesson.');
      if (r) { m.close(); if (done) done(r); }
    };
  }

  /* ---------------- schools, pacing, reload ---------------- */
  async function home(el) {
    el.innerHTML = `${pageHead('VooSquare Academy', 'Three schools taken in order, with paced modules, exams and certificates. Content comes from the files in src/seed/school, plus the classes you add here.', `<button type="button" class="btn btn-w btn-sm" id="ssReload">${icon('refresh')}Reload content from files</button><button type="button" class="btn btn-g btn-sm" id="ssAdd">${icon('plus')}Add school</button>`)}${tabs('home')}<div id="ssBody" class="mt">${skelRows(4, 90)}</div>`;
    let d;
    const load = async () => { try { d = (await GET('/api/admin/school')); } catch (e) { $('#ssBody', el).innerHTML = errorBox(e); return; } if (el.isConnected) draw(); };
    const reportHtml = (r) => !r ? '' : `<div class="card ss-report ${r.skipped.length ? 'warn' : ''}"><div class="card-h"><div><h3>Last load from files</h3><span class="sub">${esc(when(r.at))} · ${fmt(r.files)} files, ${fmt(r.modules)} modules · ${fmt(r.lessons_added)} new, ${fmt(r.lessons_updated)} updated, ${fmt(r.lessons_kept)} kept as edited${r.lessons_hidden ? `, ${fmt(r.lessons_hidden)} hidden` : ''}</span></div></div>
      ${r.skipped.length ? `<ul class="ss-skip">${r.skipped.map((s) => `<li>${icon('flag')}<span><b class="mono">${esc(s.file)}</b>${esc(s.error)}</span></li>`).join('')}</ul>` : `<p class="info-line sm">${icon('check')}<span>Every file loaded. Lessons edited here, and classes made here, are never overwritten by the files.</span></p>`}
      ${r.notes && r.notes.length ? `<ul class="ss-notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>`;
    const modRow = (m) => `<a class="ss-mod" href="#school/module/${m.id}"><span class="ss-mo">${m.order}</span><span class="ss-mt"><b>${esc(m.title)}</b><small class="${isMade(m) ? '' : 'mono'}">${isMade(m) ? 'Made in the admin' : esc(m.file)}</small></span><span class="ss-mm">${fmt(m.lessons)} lessons · ${mins(m.minutes)} · ${m.exam_questions ? `exam ${fmt(m.exam_questions)} questions` : 'no exam'}</span><span class="ss-mp">${isMade(m) ? made() : m.made ? pill(m.made + ' made in admin', 'b') : ''}${m.published ? '' : pill('Hidden', 'k')}${m.edited ? pill(m.edited + ' edited', 'gold') : ''}${m.hidden ? pill(m.hidden + ' hidden', 'w') : ''}${pill(fmt(m.passed) + ' passed', 'g')}</span>${icon('arrow')}</a>`;
    const draw = () => {
      $('#ssBody', el).innerHTML = `
        <div class="ss-top">
          <form class="card ss-pace" id="ssPace"><div class="card-h"><div><h3>Pacing</h3><span class="sub">So nobody can finish in a day.</span></div></div>
            ${field('Hours between modules', input('unlock_hours', d.settings.unlock_hours, { type: 'number', min: 0, max: 336, step: '0.5', cls: 'w90' }), 'A module opens once the exam before it is passed and this many hours have passed since that module opened. 0 turns the wait off.')}
            ${switchField('verticals_any', d.settings.verticals_any !== false, 'Premium members may enrol in any vertical', 'Off: only the vertical they chose')}
            <div class="row end"><button class="btn btn-g btn-sm" type="submit">Save</button></div></form>
          ${reportHtml(d.last_load)}
        </div>
        <div class="ss-schools">${d.schools.map((s, i) => `<section class="card ss-school" data-id="${s.id}" data-cfm>
          <div class="ss-sh"><span class="ss-n">${i + 1}</span><div class="ss-st"><h3>${esc(s.title)} ${s.track === 'vertical' ? pill('Vertical school', 'k') : s.track === 'extra' ? pill('Extra', 'w') : ''}${isMade(s) ? ' ' + made() : ''}</h3><p class="muted sm">${s.level ? esc(s.level) + ' · ' : ''}${fmt(s.modules.length)} modules · ${fmt(s.modules.reduce((a, m) => a + m.lessons, 0))} lessons · ${mins(s.modules.reduce((a, m) => a + m.minutes, 0))} · ${fmt(s.learners)} learners · ${fmt(s.certificates)} certificates${isMade(s) && s.requires ? ` · after ${esc((d.schools.find((x) => x.slug === s.requires) || { title: s.requires }).title)}` : ''}</p></div>
            <div class="row ss-sw">${switchField('published', s.published, 'Published')}${switchField('premium', s.premium, 'Premium only')}</div></div>
          <form class="row ss-cert" data-cert>${field('Certificate title', input('cert_title', s.cert_title, { max_len: 120 }), '', 'grow')}<button class="btn btn-w btn-sm" type="submit">Save title</button></form>
          <div class="ss-mods">${s.modules.length ? s.modules.map(modRow).join('') : empty('book', 'No modules yet', isMade(s) ? 'Add the first module, then its lessons. Members see the school once it has a lesson.' : 'Add module files for this school, then reload, or add a module here.')}</div>
          <div class="row ss-add"><button type="button" class="btn btn-w btn-sm" data-addmod>${icon('plus')}Add module</button>${isMade(s) ? `<button type="button" class="btn btn-ghost btn-sm" data-editschool>${icon('pen')}Edit school</button><button type="button" class="btn btn-ghost btn-sm ss-del" data-delschool>${icon('trash')}Delete</button>` : ''}</div>
        </section>`).join('')}</div>`;
    };
    $('#ssReload', el).onclick = async (e) => { const r = await run(e.currentTarget, () => POST('/api/admin/school/reload'), (x) => `Loaded ${x.report.modules} modules${x.report.skipped.length ? `, ${x.report.skipped.length} skipped` : ''}`); if (r) load(); };
    $('#ssAdd', el).onclick = () => { if (d) schoolForm(d, null); };
    el.addEventListener('click', (e) => {
      const card = e.target.closest('.ss-school'); if (!card || !d) return;
      const s = d.schools.find((x) => x.id === Number(card.dataset.id)); if (!s) return;
      if (e.target.closest('[data-addmod]')) moduleForm(s, null, (r) => { location.hash = '#school/module/' + r.module.id; });
      else if (e.target.closest('[data-editschool]')) schoolForm(d, s);
      else { const b = e.target.closest('[data-delschool]'); if (b) confirmIn(b, { text: `Delete ${s.title} with its modules and lessons? It goes to the recycle bin. If members have enrolled, it cannot be deleted: switch Published off instead.`, yes: 'Delete school', onYes: async () => { await DEL('/api/admin/school/schools/' + s.id); toast('School deleted'); load(); } }); }
    });
    el.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.target.id === 'ssPace') { const v = readForm(e.target); await run($('button[type=submit]', e.target), () => PUT('/api/admin/school/settings', { unlock_hours: Number(v.unlock_hours), verticals_any: !!v.verticals_any }), 'Pacing saved'); return; }
      if (e.target.matches('[data-cert]')) { const id = e.target.closest('[data-id]').dataset.id; await run($('button', e.target), () => PATCH('/api/admin/school/schools/' + id, { cert_title: readForm(e.target).cert_title }), 'Certificate title saved'); }
    });
    el.addEventListener('change', async (e) => {
      const sw = e.target.closest('.ss-sw input[type=checkbox]'); if (!sw || !sw.closest('.ss-school')) return;
      const id = sw.closest('[data-id]').dataset.id;
      const r = await run(null, () => PATCH('/api/admin/school/schools/' + id, { [sw.name]: sw.checked }), sw.name === 'premium' ? (sw.checked ? 'Now Premium only' : 'Now free') : (sw.checked ? 'Published' : 'Hidden from members'));
      if (!r) sw.checked = !sw.checked;
    });
    load();
  }

  /* ---------------- module: lessons ---------------- */
  async function moduleView(el, id) {
    el.innerHTML = `${backLink('#school', 'VooSquare Academy')}<div class="card">${skelRows(5, 56)}</div>`;
    let d;
    try { d = await GET('/api/admin/school/modules/' + id); } catch (e) { el.innerHTML = backLink('#school', 'VooSquare Academy') + errorBox(e); return; }
    if (!el.isConnected) return;
    const m = d.module;
    const mine = isMade(m);
    el.innerHTML = `${backLink('#school', 'VooSquare Academy')}<div class="ph"><div class="ph-t"><h2>${esc(m.title)}</h2><p>${esc(d.school.title)} · module ${m.sort} · ${mine ? 'made in the admin ' + made() : `from ${esc(m.file || 'the admin')}`}</p></div><div class="ph-r"><a class="btn btn-g btn-sm" href="#school/new-lesson/${m.id}">${icon('plus')}Add lesson</a></div></div>
      <div class="card"><div class="card-h"><div><h3>Lessons</h3><span class="sub">${mine ? 'Lessons made here live in the database. Reloading from files never touches them.' : 'Edit a lesson\'s slides, quiz and glossary. Edited lessons are marked and kept when content reloads from files.'}</span></div></div>
        ${d.lessons.length ? `<div class="ss-ls">${d.lessons.map((l) => `<a class="ss-l" href="#school/lesson/${l.id}"><span class="ss-mo">${l.idx + 1}</span><span class="ss-mt"><b>${esc(l.title)}</b><small>${l.minutes} min · ${l.steps} slides · ${l.quiz ? `${l.quiz} quiz questions` : 'no quiz'} · ${fmt(l.done)} passed</small></span><span class="ss-mp">${isMade(l) ? made() : l.edited ? pill('Edited', 'gold') : pill('From file', 'w')}${l.published ? '' : pill('Hidden', 'k')}</span>${icon('pen')}</a>`).join('')}</div>`
          : empty('book', 'No lessons yet', 'Add the first lesson. Members see this module once it has a published lesson.', `<a class="btn btn-g btn-sm" href="#school/new-lesson/${m.id}">Add the first lesson</a>`)}</div>
      ${mine ? `<div class="g2c mt ss-mset">
        <form class="card stack" id="mdF" data-cfm><div class="card-h"><div><h3>Module</h3><span class="sub">${fmt(d.members)} ${d.members === 1 ? 'member has' : 'members have'} started it.</span></div></div>
          <div class="g3c">${field('Title', input('title', m.title, { max_len: 140 }), '', 'span2')}${field('Order', input('order', m.sort, { type: 'number', min: 1, max: 999 }))}</div>
          ${field('Summary', textarea('summary', m.summary, { rows: 3 }))}
          <div class="row">${switchField('published', m.published, 'Published', 'Hidden modules are skipped by members; their progress stays')}</div>
          <div class="row ss-add"><button class="btn btn-g btn-sm" type="submit">Save module</button><button type="button" class="btn btn-ghost btn-sm ss-del" id="mdDel">${icon('trash')}Delete</button></div></form>
        <div class="card stack" data-guard><div class="card-h"><div><h3>Module exam</h3><span class="sub">Optional. Leave the list empty for no exam: members pass the module when every lesson is done. With questions, members get up to 10 and need 80%.</span></div></div>
          <textarea class="inp mono-ta" id="mdExam" rows="12" spellcheck="false" aria-label="Exam JSON">${esc(JSON.stringify(m.exam, null, 2))}</textarea><p class="err" id="mdExErr" aria-live="polite"></p>
          <div class="row ss-add"><button type="button" class="btn btn-w btn-sm" id="mdExAdd">${icon('plus')}Add a question</button><button type="button" class="btn btn-g btn-sm" id="mdExSave">Save exam</button></div></div></div>`
        : `<div class="card mt"><div class="card-h"><div><h3>Module exam</h3><span class="sub">${m.exam.length} questions in the file. Members get 10, in a new order each attempt. Edit them in the module file.</span></div></div>
        <ol class="ss-exam">${m.exam.map((q) => `<li><b>${esc(q.q)}</b><span>${esc(q.options[q.answer])}</span></li>`).join('')}</ol></div>`}`;
    if (!mine) return;
    const exTa = $('#mdExam', el);
    const exErr = $('#mdExErr', el);
    const parseExam = () => { try { const v = JSON.parse(exTa.value || '[]'); if (!Array.isArray(v)) throw new Error('it must be a list [ ... ]'); const b = v.findIndex((q) => !q || !q.q || !Array.isArray(q.options) || q.options.length < 2 || new Set(q.options).size !== q.options.length || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length); exErr.textContent = b >= 0 ? `Question ${b + 1} needs a question, 2 or more different options and an answer index in range.` : ''; return b >= 0 ? null : v; } catch (e) { exErr.textContent = 'Not valid JSON yet: ' + e.message; return null; } };
    exTa.addEventListener('input', parseExam);
    $('#mdExAdd', el).onclick = () => { const v = parseExam(); if (!v) return; v.push({ q: 'Your question?', options: ['Right answer', 'Wrong answer', 'Another wrong answer', 'One more'], answer: 0, why: 'Why the right answer is right.' }); exTa.value = JSON.stringify(v, null, 2); if (A.guard) A.guard.touch(exTa); exTa.focus(); };
    $('#mdExSave', el).onclick = async (e) => { const v = parseExam(); if (!v) { toast('Fix the exam JSON first. The red line says what is wrong.', 'err'); return; } await run(e.currentTarget, () => PATCH('/api/admin/school/modules/' + m.id, { exam: v }), v.length ? `Exam saved: ${v.length} questions` : 'Saved: this module has no exam'); };
    $('#mdF', el).addEventListener('submit', async (e) => { e.preventDefault(); const v = readForm(e.target); if (!v.title.trim()) { toast('Give the module a title.', 'err'); return; } const r = await run($('button[type=submit]', e.target), () => PATCH('/api/admin/school/modules/' + m.id, { title: v.title, summary: v.summary, order: v.order, published: v.published }), 'Module saved'); if (r) A.route(true); });
    const del = $('#mdDel', el);
    del.onclick = () => confirmIn(del, { text: 'Delete this module and its lessons? They go to the recycle bin. If members have started it, it cannot be deleted: switch Published off instead.', yes: 'Delete module', onYes: async () => { await DEL('/api/admin/school/modules/' + m.id); toast('Module deleted'); location.hash = '#school'; } });
  }

  /* ---------------- lesson editor: JSON with live preview (also creates lessons: moduleId set, id null) ---------------- */
  async function lessonEditor(el, id, moduleId) {
    el.innerHTML = `${backLink('#school', 'VooSquare Academy')}<div class="card">${skelRows(6, 50)}</div>`;
    let d;
    try {
      if (id) d = await GET('/api/admin/school/lessons/' + id);
      else {
        const md = await GET('/api/admin/school/modules/' + moduleId);
        d = { lesson: { id: 0, module_id: md.module.id, title: '', minutes: 10, published: true, objectives: [], takeaways: [], action: '', steps: TEMPLATE(), quiz: [], glossary: [], source: 'admin', say_intro: '', say_outro: '' }, module: { id: md.module.id, title: md.module.title }, types: md.types, refs: {} };
      }
    } catch (e) { el.innerHTML = backLink('#school', 'VooSquare Academy') + errorBox(e); return; }
    if (!el.isConnected) return;
    const L = d.lesson; const types = d.types;
    const creating = !L.id; const mine = isMade(L);
    let steps = L.steps; let sel = 0;
    const J = (x) => JSON.stringify(x, null, 2);
    el.innerHTML = `${backLink('#school/module/' + L.module_id, d.module.title)}
      <div class="ph"><div class="ph-t"><h2 id="slT">${esc(L.title || 'New lesson')}</h2><p>${esc(d.module.title)} · ${creating ? 'a new lesson, made in the admin' : mine ? 'made in the admin' : L.edited ? 'edited in the admin (kept when files reload)' : 'from the content file'}${mine ? ' ' + made() : ''}</p></div>
        <div class="ph-r" data-cfm>${!mine && L.edited ? `<button type="button" class="btn btn-w btn-sm" id="slRevert">${icon('refresh')}Take it from the file again</button>` : ''}${mine && !creating ? `<button type="button" class="btn btn-ghost btn-sm ss-del" id="slDel">${icon('trash')}Delete</button>` : ''}<button type="button" class="btn btn-g btn-sm" id="slSave">${creating ? 'Add lesson' : 'Save lesson'}</button></div></div>
      <div class="le-grid ss-le">
        <div class="stack" data-guard>
          <div class="card stack"><div class="g3c">${field('Title', input('title', L.title, { max_len: 140, ph: 'What this lesson is called' }), '', 'span2')}${field('Minutes', input('minutes', L.minutes, { type: 'number', min: 1, max: 120 }))}</div>
            <div class="row">${switchField('published', L.published, 'Published', 'Hidden lessons are skipped by members')}</div>
            ${field('Objectives (one per line)', textarea('objectives', L.objectives.join('\n'), { rows: 3, ph: mine ? 'Spot a winning ad in the first 48 hours' : '' }))}
            ${field('Takeaways (one per line)', textarea('takeaways', L.takeaways.join('\n'), { rows: 3 }))}
            ${field('Action', textarea('action', L.action, { rows: 2, ph: mine ? 'One thing to do today.' : '' }))}</div>
          <div class="card stack"><div class="card-h"><div><h3>Slides (JSON)</h3><span class="sub">A list of slides: { "v": type, "h", "p", "more", "d"${mine ? ', "say"' : ''} }. Types: ${types.map(esc).join(', ')}. See docs/SCHOOL_BRIEF.md.${mine ? ' "say" is what the Teaching voice reads on that slide.' : ''}</span></div></div>
            <textarea class="inp mono-ta" id="slSteps" rows="22" spellcheck="false" aria-label="Slides JSON">${esc(J(steps))}</textarea><p class="err" id="slErr" aria-live="polite"></p></div>
          ${mine ? `<div class="card stack"><div class="card-h"><div><h3>Narration</h3><span class="sub">What the Teaching voice says before the first slide and after the last. Optional, like "say" on each slide.</span></div></div>
            ${field('Spoken intro', textarea('say_intro', L.say_intro || '', { rows: 2, ph: 'Welcome. In this lesson you will…' }))}
            ${field('Spoken outro', textarea('say_outro', L.say_outro || '', { rows: 2, ph: 'That is the lesson. Take the quiz to…' }))}</div>` : ''}
          <div class="card stack"><div class="card-h"><div><h3>Quiz (JSON)</h3><span class="sub">${mine ? 'Optional, up to 5 questions: { "q", "options": [4], "answer": index, "why" }. Members need 80% to pass. Leave [] for no quiz: the lesson is passed by finishing it.' : '5 questions: { "q", "options": [4], "answer": index, "why" }. Members need 4 right.'}</span></div></div>
            <textarea class="inp mono-ta" id="slQuiz" rows="14" spellcheck="false" aria-label="Quiz JSON">${esc(J(L.quiz))}</textarea><p class="err" id="slQErr"></p>
            ${mine ? `<div class="row"><button type="button" class="btn btn-w btn-sm" id="slQAdd">${icon('plus')}Add a question</button></div>` : ''}</div>
          <div class="card stack"><div class="card-h"><div><h3>Glossary (JSON)</h3><span class="sub">[{ "term", "def" }]</span></div></div>
            <textarea class="inp mono-ta" id="slGl" rows="7" spellcheck="false" aria-label="Glossary JSON">${esc(J(L.glossary))}</textarea><p class="err" id="slGErr"></p></div>
        </div>
        <div class="stack le-side"><div class="card prev-card stick"><div class="card-h"><h3>Preview</h3><span class="sub" id="pvN"></span><div class="r"><button type="button" class="btn btn-ghost btn-xs" id="pvPrev" aria-label="Previous slide">${icon('left')}</button><button type="button" class="btn btn-ghost btn-xs" id="pvNext" aria-label="Next slide">${icon('arrow')}</button></div></div>
          <div class="ss-pv"><div class="vl-stage" id="stage"></div></div><div class="pv-cap"><b id="pvH"></b><p id="pvP"></p>${mine ? '<p class="ss-say" id="pvS"></p>' : ''}</div><div class="ss-strip" id="strip"></div></div></div>
      </div>`;
    const stage = $('#stage', el);
    const preview = () => {
      const s = steps[sel];
      $('#pvN', el).textContent = s ? `Slide ${sel + 1} of ${steps.length} · ${s.v}` : '';
      const refs = d.refs || {};
      const withRef = (st) => (st.v === 'product' ? { ...st, _ref: (refs.products || {})[st.d && st.d.slug] } : st.v === 'partner' ? { ...st, _ref: (refs.partners || {})[(st.d && st.d.vertical) || 'general'] || [], _staff: true } : st);
      stage.innerHTML = s ? VSL.render(withRef(s)) : '<div class="vl-big"><b>No slides</b></div>';
      stage.classList.remove('la-split', 'la-live'); stage.removeAttribute('data-v');
      // The member player's illustration for this slide (lesson-art.js), so the preview matches what members see.
      if (s && window.VSA) { try { stage.dataset.v = s.v; VSA.dress(stage, s, VSA.plan(steps, { title: L.title || '' })[sel]); } catch { /* preview without art */ } }
      VSL.animate(stage);
      $('#pvH', el).textContent = (s && s.h) || ''; $('#pvP', el).textContent = (s && s.p) || '';
      const pvS = $('#pvS', el); if (pvS) { const say = s && typeof s.say === 'string' ? s.say.trim() : ''; pvS.hidden = !say; pvS.innerHTML = say ? `${icon('wave')}<span>${esc(say)}</span>` : ''; }
      $('#strip', el).innerHTML = steps.map((x, i) => `<button type="button" class="${i === sel ? 'on' : ''}" data-s="${i}" title="${esc(x.h || x.v)}">${i + 1}<small>${esc(x.v)}</small></button>`).join('');
    };
    const parse = (ta, errEl, check) => {
      try { const v = JSON.parse(ta.value); const m = check(v); errEl.textContent = m || ''; return m ? null : v; } catch (e) { errEl.textContent = 'Not valid JSON yet: ' + e.message; return null; }
    };
    const checkSteps = (v) => { if (!Array.isArray(v) || !v.length) return 'Add at least one slide.'; const b = v.findIndex((s) => !s || !types.includes(s.v) || (s.v !== 'photo' && s.d === undefined)); if (b >= 0) return `Slide ${b + 1}: unknown type "${v[b] && v[b].v}" or missing d.`; const sy = v.findIndex((s) => s.say !== undefined && typeof s.say !== 'string'); return sy >= 0 ? `Slide ${sy + 1}: "say" must be text.` : ''; };
    const checkQuiz = (v) => { if (!Array.isArray(v) || (!mine && !v.length)) return 'The quiz needs questions.'; if (mine && v.length > 5) return 'Up to 5 questions.'; const b = v.findIndex((q) => !q || !q.q || !Array.isArray(q.options) || q.options.length < 2 || new Set(q.options).size !== q.options.length || !Number.isInteger(q.answer) || q.answer < 0 || q.answer >= q.options.length); return b >= 0 ? `Question ${b + 1} needs a question, 2 or more different options and an answer index in range.` : ''; };
    const checkGl = (v) => (Array.isArray(v) && v.every((g) => g && g.term) ? '' : 'Each entry needs a term.');
    let t;
    $('#slSteps', el).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { const v = parse(e.target, $('#slErr', el), checkSteps); if (v) { steps = v; sel = Math.min(sel, steps.length - 1); preview(); } }, 350); });
    $('#slQuiz', el).addEventListener('input', (e) => parse(e.target, $('#slQErr', el), checkQuiz));
    $('#slGl', el).addEventListener('input', (e) => parse(e.target, $('#slGErr', el), checkGl));
    $('[name=title]', el).addEventListener('input', (e) => { $('#slT', el).textContent = e.target.value || (creating ? 'New lesson' : 'Untitled lesson'); });
    $('#pvPrev', el).onclick = () => { sel = Math.max(0, sel - 1); preview(); };
    $('#pvNext', el).onclick = () => { sel = Math.min(steps.length - 1, sel + 1); preview(); };
    $('#strip', el).addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { sel = Number(b.dataset.s); preview(); } });
    const qa = $('#slQAdd', el);
    if (qa) qa.onclick = () => { const ta = $('#slQuiz', el); const v = parse(ta, $('#slQErr', el), checkQuiz); if (!v) return; if (v.length >= 5) { toast('A lesson quiz has up to 5 questions.', 'err'); return; } v.push({ q: 'Your question?', options: ['Right answer', 'Wrong answer', 'Another wrong answer', 'One more'], answer: 0, why: 'Why the right answer is right.' }); ta.value = J(v); ta.dispatchEvent(new Event('input', { bubbles: true })); if (A.guard) A.guard.touch(ta); ta.focus(); };
    $('#slSave', el).onclick = async (e) => {
      const s = parse($('#slSteps', el), $('#slErr', el), checkSteps); const q = parse($('#slQuiz', el), $('#slQErr', el), checkQuiz); const g = parse($('#slGl', el), $('#slGErr', el), checkGl);
      if (!s || !q || !g) { toast('Fix the JSON first. The red line under each box says what is wrong.', 'err'); return; }
      const f = readForm($('.ss-le .card', el));
      if (!String(f.title || '').trim()) { toast('Give the lesson a title.', 'err'); $('[name=title]', el).focus(); return; }
      const lines = (k) => String(f[k] || '').split('\n').map((x) => x.trim()).filter(Boolean);
      const body = { title: f.title, minutes: f.minutes, published: f.published, objectives: lines('objectives'), takeaways: lines('takeaways'), action: f.action, steps: s, quiz: q, glossary: g };
      if (mine) { body.say_intro = $('[name=say_intro]', el).value; body.say_outro = $('[name=say_outro]', el).value; }
      if (creating) {
        const r = await run(e.currentTarget, () => POST(`/api/admin/school/modules/${L.module_id}/lessons`, body), 'Lesson added');
        if (r) location.hash = '#school/lesson/' + r.lesson.id;
        return;
      }
      const r = await run(e.currentTarget, () => POST('/api/admin/school/lessons/' + L.id, body), mine ? 'Lesson saved' : 'Lesson saved. It is marked as edited.');
      if (r && !mine && !L.edited) { L.edited = true; A.route(true); }
    };
    const rv = $('#slRevert', el);
    if (rv) rv.onclick = () => confirmIn(rv, { text: 'Throw away the edits made here and take this lesson from its content file again? Member progress is kept.', yes: 'Take it from the file', onYes: async () => { await POST(`/api/admin/school/lessons/${L.id}/revert`); toast('Lesson taken from the file'); A.route(true); } });
    const dl = $('#slDel', el);
    if (dl) dl.onclick = () => confirmIn(dl, { text: 'Delete this lesson? It goes to the recycle bin. If members have started it, it cannot be deleted: switch Published off instead.', yes: 'Delete lesson', onYes: async () => { await DEL('/api/admin/school/lessons/' + L.id); toast('Lesson deleted'); location.hash = '#school/module/' + L.module_id; } });
    preview();
  }

  /* ---------------- certificates ---------------- */
  async function certsView(el, q) {
    el.innerHTML = `${pageHead('VooSquare Academy', 'Certificates issued when members pass a school final exam.')}${tabs('certs')}
      <div class="card mt"><form class="row" id="cfS" role="search"><input class="inp grow" type="search" name="q" value="${esc((q && q.q) || '')}" placeholder="Search by code, name or email" aria-label="Search certificates"><button class="btn btn-w btn-sm" type="submit">Search</button></form><div id="cfL" class="mt">${skelRows(5, 56)}</div></div>`;
    const load = async (term) => {
      let d;
      try { d = await GET('/api/admin/school/certificates' + (term ? '?q=' + encodeURIComponent(term) : '')); } catch (e) { $('#cfL', el).innerHTML = errorBox(e); return; }
      $('#cfL', el).innerHTML = d.certificates.length ? `<div class="ss-certs">${d.certificates.map((c) => `<div class="ss-c ${c.revoked ? 'rev' : ''}" data-id="${c.id}" data-cfm>
        <span class="ss-ci">${icon(c.revoked ? 'x' : 'check')}</span>
        <span class="ss-mt"><b>${esc(c.name)}</b><small>${esc(c.title)} · ${esc(dateStr(c.issued_at))}${c.revoked ? ` · revoked ${esc(dateStr(c.revoked_at))}${c.revoked_reason ? ': ' + esc(c.revoked_reason) : ''}` : ''}</small></span>
        <a class="mono ss-code" href="${esc(c.verify_url)}" target="_blank" rel="noopener">${esc(c.code)}</a>
        <a class="lnk sm" href="#customers/${c.user_id}">${esc(c.member_name)}</a>
        <button type="button" class="btn ${c.revoked ? 'btn-w' : 'btn-danger'} btn-xs" data-rev="${c.revoked ? 'restore' : 'revoke'}">${c.revoked ? 'Restore' : 'Revoke'}</button></div>`).join('')}</div>` : empty('trophy', 'No certificates yet', 'They appear here when a member passes a school final exam.');
    };
    $('#cfS', el).addEventListener('submit', (e) => { e.preventDefault(); load(e.target.q.value.trim()); });
    $('#cfL', el).addEventListener('click', (e) => {
      const b = e.target.closest('[data-rev]'); if (!b) return;
      const id = b.closest('[data-id]').dataset.id;
      if (b.dataset.rev === 'restore') { run(b, () => POST(`/api/admin/school/certificates/${id}/revoke`, { restore: true }), 'Certificate restored').then((r) => { if (r) load($('#cfS [name=q]', el).value.trim()); }); return; }
      confirmIn(b, { text: 'Revoke this certificate? The verify page will say it was revoked and the member can no longer download it. You can restore it later.', yes: 'Revoke', onYes: async () => { await POST(`/api/admin/school/certificates/${id}/revoke`, { reason: 'Revoked by the team' }); toast('Certificate revoked'); load($('#cfS [name=q]', el).value.trim()); } });
    });
    load((q && q.q) || '');
  }

  /* ---------------- customer page: VooSquare Academy card ---------------- */
  A.schoolCard = async function (host, id) {
    host.className = 'card ss-cust mt';
    host.innerHTML = `<div class="card-h"><div><h3>VooSquare Academy</h3><span class="sub">Progress, grants and skips for this member.</span></div></div><div class="skel" style="height:140px"></div>`;
    let d;
    try { d = await GET('/api/admin/school/members/' + id); } catch (e) { host.innerHTML = errorBox(e); return; }
    const draw = () => {
      const mods = d.schools.flatMap((s) => s.modules.map((m) => ({ ...m, school: s })));
      host.innerHTML = `<div class="card-h"><div><h3>VooSquare Academy</h3><span class="sub">What ${esc(d.member.name)} sees, with the same pace and locks.</span></div></div>
        <div class="ss-cs">${d.schools.map((s) => `<div class="ss-cs1"><div class="ss-cs-h"><b>${esc(s.title)}</b>${s.certificate ? pill('Certificate', 'g') : stPill(s.status === 'active' || s.status === 'ready' ? 'open' : s.status)}${s.granted ? pill('Opened by the team', 'gold') : ''}<span class="ss-pct">${s.pct}%</span></div>
          <div class="ss-bar"><i style="width:${s.pct}%"></i></div>
          <p class="muted sm">${s.lessons_done} of ${s.lessons_total} lessons · ${s.modules_passed} of ${s.modules_total} module exams${s.final.attempts ? ` · final best ${s.final.best}%` : ''}</p>
          <div class="ss-cm">${s.modules.map((m) => `<span class="ss-chip st-${m.status}" title="${esc(m.title)}${m.status === 'waiting' ? ' · opens ' + esc(when(m.opens_at)) : ''}">${m.order}</span>`).join('')}</div></div>`).join('')}</div>
        ${can('academy') ? `<div class="ss-grant"><form class="row" data-g="open_school">${A.select('school_id', d.schools.map((s) => [s.id, s.title]), '', { aria: 'School' })}<button class="btn btn-w btn-sm" type="submit">Open school without the certificate</button></form>
          <form class="row" data-g="mod">${A.select('module_id', mods.map((m) => [m.id, `${m.school.title}: ${m.order}. ${m.title}${m.status === 'passed' ? ' (passed)' : ''}`]), (mods.find((m) => m.status !== 'passed') || {}).id, { aria: 'Module' })}<button class="btn btn-w btn-sm" type="submit" name="act" value="skip_wait">Skip the wait</button><button class="btn btn-k btn-sm" type="submit" name="act" value="pass_module">Mark module passed</button></form></div>` : ''}
        ${d.certificates.length ? `<div class="ss-cc">${d.certificates.map((c) => `<a href="${esc(c.verify_url)}" target="_blank" rel="noopener">${icon('trophy')}${esc(c.title)} <span class="mono">${esc(c.code)}</span>${c.revoked ? ' (revoked)' : ''}</a>`).join('')}</div>` : ''}`;
    };
    draw();
    host.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target; const btn = e.submitter || $('button', f);
      const v = readForm(f);
      const body = f.dataset.g === 'open_school' ? { action: 'open_school', school_id: Number(v.school_id) } : { action: btn.value, module_id: Number(v.module_id) };
      const r = await run(btn, () => POST(`/api/admin/school/members/${id}/grant`, body), (x) => x.message);
      if (r) { d = await GET('/api/admin/school/members/' + id); draw(); }
    });
  };
})();

/* Academy → Partners: networks and advertisers shown on partner slides and vertical school pages. */
(function () {
  'use strict';
  const { $, $$, esc, fmt, icon, toast, timeAgo } = VS;
  const A = window.VSA;
  const { can, GET, POST, PATCH, DEL, run, modal, confirmIn, field, input, textarea, select, switchField, readForm, pill, empty, errorBox, skelRows, pageHead } = A;
  const VN = { nutra: 'Nutra', igaming: 'iGaming and casino', trading: 'Trading', finance: 'Finance', sweeps: 'Sweepstakes and lead gen', general: 'General (every vertical)' };

  A.page('partners', {
    t: 'Partners', i: 'tag', perm: () => can('academy'),
    async r(el, args, q) {
      const vf = (q && q.v) || '';
      el.innerHTML = `${pageHead('Partners', 'Networks and advertisers shown on partner slides in lessons and on each vertical school page. Members see enabled partners only. Clicks are counted.', `<button type="button" class="btn btn-g btn-sm" id="ptNew">${icon('plus')}New partner</button>`)}
        <nav class="tabs" aria-label="Verticals"><a href="#partners" class="${vf ? '' : 'on'}">All</a>${Object.entries(VN).map(([k, l]) => `<a href="#partners?v=${k}" class="${vf === k ? 'on' : ''}">${esc(l.split(' (')[0])}</a>`).join('')}</nav>
        <div id="ptL" class="mt">${skelRows(4, 70)}</div>`;
      let list = [];
      const draw = () => {
        const rows = list.filter((p) => !vf || p.vertical === vf);
        $('#ptL', el).innerHTML = rows.length ? `<div class="ptl">${rows.map((p) => `<div class="ptr ${p.enabled ? '' : 'off'}" data-id="${p.id}" data-cfm>
          <span class="ptr-logo">${p.logo ? `<img src="${esc(p.logo)}" alt="">` : `<b>${esc(p.name[0] || '?')}</b>`}</span>
          <span class="ptr-t"><b>${esc(p.name)}${p.badge ? ` ${pill(p.badge, 'l')}` : ''}</b><small>${esc(VN[p.vertical] || p.vertical)} · ${esc(p.url || 'No link yet')}</small></span>
          <span class="ptr-c"><b>${fmt(p.clicks)}</b><small>${p.clicks === 1 ? 'click' : 'clicks'}${p.last_click_at ? ` · last ${timeAgo(p.last_click_at)}` : ''}</small></span>
          <span class="ptr-sw">${switchField('enabled', p.enabled, 'On')}</span>
          <span class="re-act"><button type="button" class="ib2" data-ed aria-label="Edit ${esc(p.name)}">${icon('pen')}</button><button type="button" class="ib2" data-rm aria-label="Delete ${esc(p.name)}">${icon('trash')}</button></span></div>`).join('')}</div>`
          : empty('tag', vf ? `No ${VN[vf]} partners yet` : 'No partners yet', 'Add the networks and advertisers you work with. Partner slides stay hidden from members until there is at least one for their vertical.', '<button type="button" class="btn btn-g btn-sm" data-new>Add a partner</button>');
      };
      const load = async () => { try { list = (await GET('/api/admin/school/partners')).partners; } catch (e) { $('#ptL', el).innerHTML = errorBox(e); return; } if (el.isConnected) draw(); };
      const editor = (p) => {
        const cur = p || { vertical: vf || 'general', name: '', description: '', highlights: [], url: '', cta: 'Visit', badge: '', sort: 0, enabled: true, logo: '', logo_upload: '' };
        const m = modal({ title: p ? `Edit ${p.name}` : 'New partner', wide: true, body: `<form class="stack" id="ptF" novalidate>
          <div class="g2c">${field('Vertical', select('vertical', Object.entries(VN), cur.vertical))}${field('Name', input('name', cur.name, { max_len: 60 }))}</div>
          <div class="field"><span class="lbl">Logo</span><div class="row pt-logo"><span class="ptr-logo lg" id="ptLogo">${cur.logo ? `<img src="${esc(cur.logo)}" alt="">` : icon('image')}</span><button type="button" class="btn btn-w btn-sm" id="ptUp">${icon('image')}${cur.logo ? 'Replace' : 'Upload'}</button>${cur.logo ? '<button type="button" class="btn btn-ghost btn-sm" id="ptRm">Remove</button>' : ''}<input type="hidden" name="logo_upload" value="${esc(cur.logo_upload || '')}"><input type="file" id="ptFile" accept="image/png,image/jpeg,image/webp" hidden></div><span class="hint">Square works best. PNG, JPG or WebP.</span></div>
          ${field('Short description', textarea('description', cur.description, { rows: 2 }), 'One or two sentences members see on the card.')}
          <div class="field"><span class="lbl">Highlights (up to 3)</span><div class="g3c">${[0, 1, 2].map((i) => input('h' + i, (cur.highlights || [])[i] || '', { ph: ['Weekly payouts', 'NG, KE and GH', 'Dedicated manager'][i], max_len: 80 })).join('')}</div></div>
          <div class="g2c">${field('Link', input('url', cur.url, { ph: 'https://', max_len: 500 }), 'https only. Members go through a counted redirect.')}${field('Button text', input('cta', cur.cta, { max_len: 30 }))}</div>
          <div class="g3c">${field('Badge', input('badge', cur.badge, { ph: 'Recommended', max_len: 24 }))}${field('Order', input('sort', cur.sort, { type: 'number' }))}<div class="field"><span class="lbl">Shown</span>${switchField('enabled', cur.enabled, 'Enabled')}</div></div>
        </form>`, foot: `<button type="button" class="btn btn-ghost btn-sm" data-cancel>Cancel</button><button type="button" class="btn btn-g btn-sm" data-save>${p ? 'Save partner' : 'Add partner'}</button>` });
        const f = m.q('#ptF');
        m.q('[data-cancel]').onclick = m.close;
        m.q('#ptUp').onclick = () => m.q('#ptFile').click();
        const rm = m.q('#ptRm'); if (rm) rm.onclick = () => { $('[name=logo_upload]', f).value = ''; m.q('#ptLogo').innerHTML = icon('image'); };
        m.q('#ptFile').addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0]; e.target.value = '';
          if (!file || !window.VSM) return;
          const b = m.q('#ptUp');
          try { b.classList.add('loading'); const prep = await VSM.prepare(file); const u = await VSM.upload(prep, 'partner').promise; $('[name=logo_upload]', f).value = u.id; m.q('#ptLogo').innerHTML = `<img src="${esc(u.thumb_url || u.url)}" alt="">`; URL.revokeObjectURL(prep.preview); }
          catch (err) { toast(err.message || 'That image could not be used.', 'err'); } finally { b.classList.remove('loading'); }
        });
        m.q('[data-save]').onclick = async (e) => {
          const v = readForm(f);
          const body = { vertical: v.vertical, name: v.name, description: v.description, highlights: [v.h0, v.h1, v.h2].map((x) => x.trim()).filter(Boolean), url: v.url.trim(), cta: v.cta, badge: v.badge, sort: v.sort, enabled: v.enabled, logo_upload: v.logo_upload };
          if (!body.name.trim()) { toast('Give the partner a name.', 'err'); return; }
          const r = await run(e.currentTarget, () => (p ? PATCH('/api/admin/school/partners/' + p.id, body) : POST('/api/admin/school/partners', body)), p ? 'Partner saved' : 'Partner added');
          if (r) { m.close(); load(); }
        };
      };
      el.addEventListener('click', (e) => {
        if (e.target.closest('#ptNew,[data-new]')) { editor(null); return; }
        const row = e.target.closest('.ptr'); if (!row) return;
        const p = list.find((x) => x.id === Number(row.dataset.id));
        if (e.target.closest('[data-ed]')) editor(p);
        const d = e.target.closest('[data-rm]');
        if (d) confirmIn(d, { text: `Delete ${p.name}? Its click count goes too. Partner slides hide themselves when a vertical has no partners.`, yes: 'Delete partner', onYes: async () => { await DEL('/api/admin/school/partners/' + p.id); toast('Partner deleted'); load(); } });
      });
      el.addEventListener('change', async (e) => {
        const sw = e.target.closest('.ptr-sw input'); if (!sw) return;
        const id = Number(sw.closest('.ptr').dataset.id);
        const r = await run(null, () => PATCH('/api/admin/school/partners/' + id, { enabled: sw.checked }), sw.checked ? 'Shown to members' : 'Hidden from members');
        if (!r) sw.checked = !sw.checked; else load();
      });
      load();
    },
  });
  const content = A.NAV.find((g) => g[0] === 'Content');
  if (content && !content[1].includes('partners')) content[1].splice(content[1].indexOf('school') + 1, 0, 'partners');
})();
