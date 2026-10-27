/* VooSquare member app: Academy, course pages and the animated lesson player. */
(function () {
  'use strict';
  const VS = window.VS, A = window.APP;
  const { esc, icon } = VS;
  const S = A.S;
  const STEP_MS = 7000;
  const DEF_GRAD = 'linear-gradient(135deg,#0F2E20,#1E6B47)';

  let coursesCache = null;
  async function loadCourses() {
    const d = await VS.api('/api/courses');
    coursesCache = d;
    if (S.home) S.home.courses = d.courses;
    return d;
  }

  function courseCard(c) {
    const pct = c.lessons ? Math.round(c.done / c.lessons * 100) : 0;
    return `<a class="course" href="#course/${esc(c.slug)}">
      <div class="cv" style="background:${esc(c.grad || DEF_GRAD)}"><span class="cvmark">${esc(c.mark || c.title[0])}</span>
        <span class="cv-tags"><span class="pill pill-k">${esc(c.level)}</span>${c.premium ? `<span class="pill pill-gold">${icon(c.locked ? 'lock' : 'premium')}Premium</span>` : '<span class="pill pill-l">Free</span>'}</span></div>
      <div class="cb"><span class="mono-k">${esc(c.track)}</span><h4>${esc(c.title)}</h4>
        <div class="cby"><span class="av">${VS.authorAvatar(c.author_key, c.id)}</span>${esc(c.author_name)}</div>
        <div class="cmeta"><span>${A.plural(c.lessons, 'lesson')}</span><span>${c.minutes} min</span></div>
        <div class="cprog" aria-label="${pct}% done"><i style="width:${pct}%"></i></div>
        <span class="cstate">${c.done >= c.lessons && c.lessons ? `${icon('check')}Completed` : c.done ? `${c.done} of ${c.lessons} done` : 'Not started'}</span>
      </div></a>`;
  }

  /* ---------------- ACADEMY ---------------- */
  function renderAcademy(view) {
    const paint = (d) => {
      const cs = d.courses;
      const tracks = [...new Set(cs.map((c) => c.track))];
      const done = cs.filter((c) => c.lessons && c.done >= c.lessons).length;
      const lessonsDone = cs.reduce((a, c) => a + c.done, 0);
      const feat = A.continueCourse ? A.continueCourse() : cs[0];
      const heroHtml = `
        <div class="card ac-hero">
          <div class="gridbg"></div>
          <div class="l">
            <span class="kick kick-d">Dchessking's tips</span>
            <h2>Extra tips from the buying desk.</h2>
            <p>Short animated lessons from Dchessking and the Zedapex team, outside the school path. Each one ends with one action to take this week. For the full route from beginner to pro, go to <a class="tips-link" href="#academy">VooSquare Academy</a>.</p>
            <div class="ac-stats"><div><b data-count="${S.user.xp || 0}">0</b><small>XP earned</small></div><div><b data-count="${lessonsDone}">0</b><small>lessons done</small></div><div><b data-count="${done}">0</b><small>courses completed</small></div></div>
            ${feat ? `<div class="acts"><button class="btn btn-l" data-resume>${icon('play')}${feat.done ? 'Continue ' : 'Start '}${esc(feat.title)}</button></div>` : ''}
          </div>
          <div class="r" aria-hidden="true"><span class="ac-founder">${VS.founder(true)}</span></div>
        </div>`;
      // VooSquare Academy leads the Academy when it has schools; the classic hero is the fallback.
      view.innerHTML = `${heroHtml}
        <div class="card ac-list">
          <div class="card-h"><div><h3>Tips and short courses</h3><span class="sub">Standalone lessons from Dchessking and the Zedapex team. Not part of the school path: take any of them, any time.</span></div></div>
          ${tracks.length > 1 ? `<div class="chips" id="trackChips"><button class="on" data-track="">All</button>${tracks.map((t) => `<button data-track="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
          <div class="cgrid" id="cgrid">${cs.map(courseCard).join('') || A.empty('book', 'No courses yet', 'The first courses are being recorded. Check back soon.')}</div>
        </div>
        ${((sp) => (sp ? `<div class="spot-row">${sp}</div>` : ''))(A.spotlight(d.ads))}`;
      view.querySelectorAll('.ac-stats [data-count]').forEach((b) => VS.countUp(b, Number(b.dataset.count)));
      const chips = view.querySelector('#trackChips');
      if (chips) chips.addEventListener('click', (e) => {
        const b = e.target.closest('[data-track]'); if (!b) return;
        chips.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        view.querySelector('#cgrid').innerHTML = cs.filter((c) => !b.dataset.track || c.track === b.dataset.track).map(courseCard).join('');
      });
    };
    view.innerHTML = `${A.skel(300, '100%', 28)}<div style="height:16px"></div>${A.skelCards(3, 280)}`;
    if (coursesCache) paint(coursesCache);
    loadCourses().then(paint).catch((e) => { if (!coursesCache) view.innerHTML = `<div class="card">${A.errorBox(e.message)}</div>`; });
    view.addEventListener('click', (e) => {
      if (e.target.closest('[data-resume]')) { e.preventDefault(); A.resumeLearning(); }
      if (e.target.closest('[data-retry]')) A.emit('route:refresh');
    });
  }

  /* ---------------- COURSE ---------------- */
  function lessonRow(l, i, nextId) {
    const cls = l.locked ? 'locked' : l.done ? 'done' : l.id === nextId ? 'next' : '';
    return `<button class="lsn ${cls}" data-lesson="${l.id}">
      <span class="n ${l.done ? 'done' : l.id === nextId ? 'play' : ''}">${l.locked ? icon('lock') : l.done ? icon('check') : l.id === nextId ? icon('play') : i + 1}</span>
      <span class="lsn-t"><b>${esc(l.title)}</b><small>${l.minutes} min · ${A.plural(l.step_count, 'step')}${l.premium ? ' · Premium' : ''}</small></span>
      <span class="lsn-r">${l.locked ? '<span class="pill pill-gold">Premium</span>' : l.done ? '<span class="pill pill-g">Done</span>' : l.id === nextId ? '<span class="pill pill-k">Up next</span>' : ''}</span>
    </button>`;
  }
  function renderCourse(view, slug) {
    view.innerHTML = `${A.skel(260, '100%', 28)}<div style="height:16px"></div>${A.skel(64)}<div style="height:8px"></div>${A.skel(64)}<div style="height:8px"></div>${A.skel(64)}`;
    let data = null;
    const paint = () => {
      const c = data.course, ls = data.lessons;
      A.setTitle(c.title);
      const next = ls.find((l) => !l.done && !l.locked) || null;
      const pct = c.lessons ? Math.round(c.done / c.lessons * 100) : 0;
      view.innerHTML = `
        <a class="backlink" href="#tips">${icon('left')}Tips</a>
        <div class="course-hero" style="background:${esc(c.grad || DEF_GRAD)}">
          <span class="cvmark">${esc(c.mark || c.title[0])}</span><div class="gridbg"></div>
          <div class="ch-in">
            <span class="ch-tags"><span class="pill pill-k">${esc(c.track)}</span>${c.level !== c.track ? `<span class="pill pill-w">${esc(c.level)}</span>` : ''}${c.premium ? `<span class="pill pill-gold">${icon('premium')}Premium</span>` : ''}</span>
            <h2>${esc(c.title)}</h2><p>${esc(c.description)}</p>
            <div class="ch-by"><span class="av av-md">${VS.authorAvatar(c.author_key, c.id)}</span><span><b>${esc(c.author_name)}</b><small>${esc(c.author_role)}</small></span></div>
          </div>
        </div>
        <div class="course-body">
          <div class="card course-side">
            <div class="cs-prog"><div class="cs-ring" style="--p:${pct}"><b>${pct}%</b></div><div><b>${c.done} of ${A.plural(c.lessons, 'lesson')}</b><small>${c.minutes} minutes in total · 50 XP per lesson, 150 more when you finish</small></div></div>
            ${c.locked ? `<a class="btn btn-l btn-block" href="#premium">${icon('premium')}Get Premium to start</a>` : next ? `<button class="btn btn-g btn-block" data-lesson="${next.id}">${icon('play')}${c.done ? 'Continue' : 'Start course'}</button>` : `<button class="btn btn-w btn-block" data-lesson="${ls[0] ? ls[0].id : ''}">${icon('refresh')}Watch again</button>`}
          </div>
          <div class="card"><div class="card-h"><h3>Lessons</h3></div><div class="lsns">${ls.map((l, i) => lessonRow(l, i, next && next.id)).join('') || A.empty('book', 'No lessons yet', 'Lessons for this course are on the way.')}</div></div>
        </div>`;
    };
    const load = () => VS.api('/api/courses/' + encodeURIComponent(slug)).then((d) => { data = d; paint(); }).catch((e) => { view.innerHTML = `<a class="backlink" href="#tips">${icon('left')}Tips</a><div class="card">${A.errorBox(e.message, e.status !== 404)}</div>`; });
    load();
    view.addEventListener('click', (e) => {
      if (e.target.closest('[data-retry]')) { load(); return; }
      const b = e.target.closest('[data-lesson]');
      if (!b || !data) return;
      A.openPlayer(data, Number(b.dataset.lesson), () => load());
    });
    const off = A.on('lesson:done', () => load());
    return off;
  }

  /* ---------------- PLAYER ---------------- */
  /** Opens the full-screen player for a lesson of a loaded course ({course, lessons}). */
  A.openPlayer = function (data, lessonId, onChange) {
    const lesson = data.lessons.find((l) => l.id === lessonId);
    if (!lesson) return;
    if (lesson.locked) {
      A.modal(`${A.modalHead('Premium lesson')}<div class="vs-modal-b">${A.premiumUpsell(lesson.title, 'This lesson is part of Premium. Premium includes every course, the premium rooms and monthly live breakdowns with Dchessking.')}</div>`, { cls: 'am-sm' });
      return;
    }
    const c = data.course;
    const steps = lesson.steps && lesson.steps.length ? lesson.steps : [{ v: 'big', h: lesson.title, p: '', d: { b: lesson.title } }];
    let i = 0, playing = !VS.reduce, prog = 0, last = performance.now(), raf = 0, ended = false;
    const wrap = A.el(`<div class="player" role="dialog" aria-modal="true" aria-label="${esc(lesson.title)}"><div class="pl">
      <div class="pl-top"><span class="av">${VS.authorAvatar(c.author_key, c.id)}</span><div class="pl-tt"><b>${esc(lesson.title)}</b><small>${esc(c.title)} · Lesson ${data.lessons.indexOf(lesson) + 1} of ${data.lessons.length}</small></div><button class="x" data-x aria-label="Close lesson">${icon('x')}</button></div>
      <div class="pl-bars">${steps.map(() => '<i><b></b></i>').join('')}<i class="end"><b></b></i></div>
      <div class="pl-body"></div>
    </div></div>`);
    document.body.appendChild(wrap);
    document.body.classList.add('noscroll');
    const body = wrap.querySelector('.pl-body');
    const bars = [...wrap.querySelectorAll('.pl-bars i b')];

    function paintBars() { bars.forEach((b, k) => { b.style.width = (k < i ? 100 : k === i && !ended ? Math.min(prog, 1) * 100 : ended && k <= steps.length ? 100 : 0) + '%'; }); }
    function showStep(n, dir = 1) {
      ended = false;
      i = Math.max(0, Math.min(n, steps.length - 1)); prog = 0;
      const s = steps[i];
      body.innerHTML = `<div class="pl-stage vl-stage ${dir < 0 ? 'back' : ''}">${VSL.render(s)}</div>
        <div class="pl-text"><span class="sk">Step ${i + 1} of ${steps.length}</span><h3>${esc(s.h || '')}</h3><p>${esc(s.p || '')}</p></div>
        <div class="pl-ctl"><button class="cb" data-prev aria-label="Previous step" ${i === 0 ? 'disabled' : ''}>${icon('left')}</button><button class="cb main" data-play aria-label="${playing ? 'Pause' : 'Play'}">${icon(playing ? 'pause' : 'play')}</button><button class="cb" data-next aria-label="Next step">${icon('arrow')}</button><span class="cnt">${i + 1} / ${steps.length}</span></div>`;
      VSL.animate(body.querySelector('.vl-stage'));
      paintBars();
    }
    function setPlaying(p) {
      playing = p;
      const b = body.querySelector('[data-play]');
      if (b) { b.innerHTML = icon(p ? 'pause' : 'play'); b.setAttribute('aria-label', p ? 'Pause' : 'Play'); }
    }
    function loop(t) {
      const dt = t - last; last = t;
      if (playing && !ended && !document.hidden) {
        prog += dt / STEP_MS;
        if (prog >= 1) { if (i < steps.length - 1) showStep(i + 1); else showEnd(); }
      }
      paintBars();
      raf = requestAnimationFrame(loop);
    }
    function quizHtml(q) {
      if (!q || !q.q) return '';
      const opts = q.options || q.o || q.choices || q.answers || [];
      if (!opts.length) return '';
      return `<div class="quiz" data-answer="${Number(q.answer ?? q.a ?? q.correct ?? 0)}"><span class="sk">Quick check</span><h4>${esc(q.q)}</h4><div class="qopts">${opts.map((o, k) => `<button class="qo" data-q="${k}"><span class="ql">${String.fromCharCode(65 + k)}</span>${esc(typeof o === 'string' ? o : o.text || '')}</button>`).join('')}</div><p class="qwhy" hidden>${esc(q.why || q.explain || q.explanation || '')}</p></div>`;
    }
    let quizPick = null;
    function applyQuiz() {
      const quiz = body.querySelector('.quiz');
      if (!quiz || quizPick == null || quiz.classList.contains('answered')) return;
      const right = Number(quiz.dataset.answer);
      quiz.classList.add('answered');
      quiz.querySelectorAll('.qo').forEach((b) => { const k = Number(b.dataset.q); if (k === right) b.classList.add('right'); else if (k === quizPick) b.classList.add('wrong'); b.disabled = true; });
      const why = quiz.querySelector('.qwhy');
      why.hidden = false;
      why.insertAdjacentHTML('afterbegin', `<b>${quizPick === right ? 'Right.' : 'Not quite.'}</b> `);
    }
    function showEnd() {
      ended = true; prog = 1; setPlaying(false); paintBars();
      const idx = data.lessons.indexOf(lesson);
      const nextL = data.lessons.slice(idx + 1).find((l) => !l.locked) || null;
      body.innerHTML = `<div class="pl-end">
        <div class="pe-head"><span class="pe-badge">${icon('check')}</span><div><span class="sk">Lesson recap</span><h3>${esc(lesson.title)}</h3></div></div>
        ${(lesson.takeaways || []).length ? `<div class="pe-take"><h4>Takeaways</h4><ul>${lesson.takeaways.map((t, k) => `<li style="animation-delay:${k * 0.12}s">${icon('check')}<span>${esc(t)}</span></li>`).join('')}</ul></div>` : ''}
        ${lesson.action ? `<div class="pe-action"><span class="sk">Your action this week</span><p>${esc(lesson.action)}</p></div>` : ''}
        ${quizHtml(lesson.quiz)}
        <div class="pe-ctl">
          <button class="btn btn-w pe-replay" data-replay>${icon('refresh')}Replay</button>
          ${lesson.done ? `<span class="pe-done">${icon('check')}Completed</span>${nextL ? `<button class="btn btn-l" data-goto="${nextL.id}">Next lesson${icon('arrow')}</button>` : '<button class="btn btn-l" data-x>Back to course</button>'}`
            : `<button class="btn btn-l" data-complete>${icon('check')}Complete lesson · +50 XP</button>`}
        </div>
      </div>`;
      body.scrollTop = 0;
      applyQuiz();
    }
    async function complete(btn) {
      await A.busy(btn, async () => {
        try {
          const d = await VS.api(`/api/lessons/${lesson.id}/complete`, { body: {} });
          lesson.done = true;
          S.user.xp = d.xp;
          if (d.gained) {
            VS.confetti();
            A.xpPop(`+50 XP`, wrap);
            if (d.course_done) setTimeout(() => { A.xpPop('+150 XP · Course complete', wrap); VS.confetti(); }, 900);
          }
          A.emit('lesson:done', { lesson: lesson.id, xp: d.xp });
          A.refreshHome();
          if (onChange) onChange();
          showEnd();
          const nb = body.querySelector('[data-goto]');
          if (nb) nb.classList.add('glow');
        } catch (e) { A.errToast(e); }
      });
    }
    function close() {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('noscroll');
      wrap.classList.add('out');
      setTimeout(() => wrap.remove(), 200);
    }
    function onKey(e) {
      if (e.target.closest && e.target.closest('input,textarea')) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') { if (ended) return; if (i < steps.length - 1) showStep(i + 1); else showEnd(); }
      else if (e.key === 'ArrowLeft') { if (ended) showStep(steps.length - 1, -1); else if (i > 0) showStep(i - 1, -1); }
      else if (e.key === ' ' && !ended) { e.preventDefault(); setPlaying(!playing); }
    }
    wrap.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-x]')) { close(); return; }
      if (t.closest('[data-prev]')) { if (i > 0) showStep(i - 1, -1); return; }
      if (t.closest('[data-next]')) { if (i < steps.length - 1) showStep(i + 1); else showEnd(); return; }
      if (t.closest('[data-play]')) { setPlaying(!playing); return; }
      if (t.closest('[data-replay]')) { setPlaying(!VS.reduce); showStep(0, -1); return; }
      if (t.closest('[data-complete]')) { complete(t.closest('[data-complete]')); return; }
      const g = t.closest('[data-goto]');
      if (g) { close(); setTimeout(() => A.openPlayer(data, Number(g.dataset.goto), onChange), 220); return; }
      const qo = t.closest('[data-q]');
      if (qo && quizPick == null) { quizPick = Number(qo.dataset.q); applyQuiz(); }
    });
    // swipe between steps on phones
    let sx = null;
    wrap.addEventListener('touchstart', (e) => { if (e.target.closest('.pl-stage')) sx = e.touches[0].clientX; }, { passive: true });
    wrap.addEventListener('touchend', (e) => {
      if (sx == null || ended) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) < 50) return;
      if (dx < 0) { if (i < steps.length - 1) showStep(i + 1); else showEnd(); } else if (i > 0) showStep(i - 1, -1);
    });
    document.addEventListener('keydown', onKey);
    showStep(0);
    raf = requestAnimationFrame(loop);
  };

  /** From home or the sidebar: open a lesson by course slug and lesson id. */
  A.playLesson = async function (slug, lessonId) {
    try { const d = await VS.api('/api/courses/' + encodeURIComponent(slug)); A.openPlayer(d, lessonId); } catch (e) { A.errToast(e); }
  };

  A.pages.tips = { title: 'Tips', render: renderAcademy };
  A.pages.course = { title: 'Course', nav: 'tips', render: renderCourse };
})();
