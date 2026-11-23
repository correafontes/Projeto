/* game.js — "Untangle": drag nodes until no edges cross. */
(function () {
  'use strict';

  const W = 1000, H = 640, PAD = 36, R = 13, THR = R + 2;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = id => document.getElementById(id);
  const { TYPES, typeById } = Graphs;

  const svg = $('board'), edgesG = $('edgesG'), marksG = $('marksG'), nodesG = $('nodesG');
  const stage = $('stage'), toastEl = $('toast');

  const S = {
    type: 'cycle', n: 8, seed: 1, edges: [], sol: [], pos: [],
    initial: 1, moves: 0, t0: 0, elapsed: 0, history: [],
    won: false, revealed: false, res: null, drag: null, dirty: false, anim: 0, scatterCount: 0
  };
  let edgeEls = [], nodeEls = [], markEls = [], hintTimer = 0, tickTimer = 0, regenTimer = 0;

  /* ---------- persistence ---------- */
  const prefs = UI.storage.get('game.prefs', { type: 'cycle', n: 8 });
  const stats = UI.storage.get('game.stats', { points: 0, solved: 0, streak: 0, best: {} });
  const saveStats = () => UI.storage.set('game.stats', stats);

  /* ---------- helpers ---------- */
  const fmtTime = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const el = (name, attrs = {}) => { const e = document.createElementNS(NS, name); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const say = (m, ms) => UI.toast(toastEl, m, ms);

  /* ---------- graph-type picker with live thumbnails ---------- */
  function buildTypeGrid() {
    const grid = $('typeGrid');
    TYPES.forEach(t => {
      const n = t.fixed || Math.max(t.min, Math.min(t.def, t.id === 'clusters' ? 12 : 11));
      const g = Graphs.generate(t.id, n, 11, 1000, 640, 70, 8);
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'type-card'; b.dataset.type = t.id; b.setAttribute('aria-pressed', 'false');
      const s = el('svg', { viewBox: '0 0 1000 640', 'aria-hidden': 'true' });
      g.edges.forEach(([a, c]) => s.appendChild(el('line', { class: 'te', x1: g.sol[a].x, y1: g.sol[a].y, x2: g.sol[c].x, y2: g.sol[c].y })));
      g.sol.forEach(p => s.appendChild(el('circle', { class: 'tn', cx: p.x, cy: p.y, r: 30 })));
      b.appendChild(s);
      const label = document.createElement('span'); label.textContent = t.label; b.appendChild(label);
      b.addEventListener('click', () => { setType(t.id, true); UI.sound.pick(); });
      grid.appendChild(b);
    });
  }

  /* ---------- node-count controls ---------- */
  const nInput = $('nInput'), nRange = $('nRange');
  function syncCountUI() {
    const t = typeById(S.type);
    document.querySelectorAll('.type-card').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.type === S.type)));
    const fixed = !!t.fixed;
    [nInput, nRange, $('nMinus'), $('nPlus')].forEach(x => { x.disabled = fixed; });
    nRange.style.display = fixed ? 'none' : '';
    const lo = fixed ? t.fixed : t.min, hi = fixed ? t.fixed : t.max;
    nInput.min = nRange.min = lo; nInput.max = nRange.max = hi;
    nInput.value = nRange.value = S.n;
    nRange.style.setProperty('--fill', hi === lo ? '100%' : ((S.n - lo) / (hi - lo) * 100) + '%');
    $('nodeRange').textContent = fixed ? 'fixed' : lo + ' – ' + hi;
    $('nHint').textContent = fixed
      ? 'The ' + t.label.toLowerCase() + ' skeleton always has ' + t.fixed + ' nodes.'
      : 'Type any value, use the slider or ± buttons. Bigger graphs are harder!';
  }
  function setType(id, regen) {
    const t = typeById(id) || TYPES[0];
    S.type = t.id;
    S.n = t.fixed ? t.fixed : clamp(S.n || t.def, t.min, t.max);
    if (!t.fixed && prefs.type !== t.id && regen) S.n = clamp(t.def, t.min, t.max);
    syncCountUI();
    if (regen) newPuzzle();
  }
  function setN(n, regenNow) {
    const t = typeById(S.type); if (t.fixed) return;
    n = clamp(Math.round(Number(n) || t.def), t.min, t.max);
    S.n = n; syncCountUI();
    clearTimeout(regenTimer);
    if (regenNow) newPuzzle(); else regenTimer = setTimeout(newPuzzle, 350);
  }
  nInput.addEventListener('change', () => setN(nInput.value, true));
  nInput.addEventListener('keydown', e => { if (e.key === 'Enter') { setN(nInput.value, true); nInput.blur(); } });
  nRange.addEventListener('input', () => { S.n = Number(nRange.value); syncCountUI(); });
  nRange.addEventListener('change', () => setN(nRange.value, true));
  $('nMinus').addEventListener('click', () => setN(S.n - 1, false));
  $('nPlus').addEventListener('click', () => setN(S.n + 1, false));

  /* ---------- puzzle lifecycle ---------- */
  function newPuzzle() {
    clearTimeout(regenTimer);
    S.seed = (Math.random() * 4294967295) >>> 0;
    const g = Graphs.generate(S.type, S.n, S.seed, W, H, PAD, THR);
    S.edges = g.edges; S.sol = g.sol; S.n = g.n;
    S.scatterCount = 0;
    prefs.type = S.type; prefs.n = S.n; UI.storage.set('game.prefs', prefs);
    syncCountUI();
    buildBoard();
    scatter();
    updateBest();
  }

  function scatter() {
    cancelAnimationFrame(S.anim);
    const rng = Geom.mulberry32(S.seed + 977 * (++S.scatterCount));
    S.pos = Graphs.scramble(S.n, S.edges, W, H, PAD, rng, THR);
    S.moves = 0; S.t0 = 0; S.elapsed = 0; S.history = [];
    S.won = false; S.revealed = false; S.drag = null;
    clearInterval(tickTimer);
    stage.classList.remove('solved');
    S.res = Geom.evaluate(S.pos, S.edges, THR);
    S.initial = Math.max(1, S.res.count);
    render();
    say('Drag the nodes so that no two edges cross.');
  }

  function buildBoard() {
    edgesG.textContent = ''; nodesG.textContent = ''; marksG.textContent = '';
    edgeEls = S.edges.map(() => { const l = el('line', { class: 'edge' }); edgesG.appendChild(l); return l; });
    markEls = [];
    nodeEls = Array.from({ length: S.n }, (_, i) => {
      const g = el('g', { class: 'node' });
      g.dataset.i = i; g.style.setProperty('--i', i);
      g.appendChild(el('circle', { class: 'halo', r: R + 9 }));
      g.appendChild(el('circle', { class: 'core', r: R }));
      nodesG.appendChild(g);
      return g;
    });
  }

  /* ---------- rendering ---------- */
  function render() {
    S.dirty = false;
    const P = S.pos;
    nodeEls.forEach((g, i) => g.setAttribute('transform', 'translate(' + P[i].x.toFixed(1) + ' ' + P[i].y.toFixed(1) + ')'));
    S.edges.forEach(([a, b], i) => {
      const l = edgeEls[i];
      l.setAttribute('x1', P[a].x.toFixed(1)); l.setAttribute('y1', P[a].y.toFixed(1));
      l.setAttribute('x2', P[b].x.toFixed(1)); l.setAttribute('y2', P[b].y.toFixed(1));
    });
    const res = S.res = Geom.evaluate(P, S.edges, THR);
    edgeEls.forEach((l, i) => l.classList.toggle('bad', !!res.badEdges[i]));
    nodeEls.forEach((g, i) => g.classList.toggle('bad', res.nodeScore[i] > 0));
    syncMarks(res);
    stage.classList.toggle('solved', (S.won || S.revealed) && res.count === 0);
    updateHud(res);
  }
  const schedule = () => { if (!S.dirty) { S.dirty = true; requestAnimationFrame(render); } };

  function syncMarks(res) {
    const k = Math.min(res.crossings.length, 250);
    while (markEls.length < k) { const c = el('circle', { class: 'cross-mark', r: 6.5 }); marksG.appendChild(c); markEls.push(c); }
    markEls.forEach((c, i) => {
      if (i < k) { c.setAttribute('cx', res.crossings[i].x.toFixed(1)); c.setAttribute('cy', res.crossings[i].y.toFixed(1)); c.style.display = ''; }
      else c.style.display = 'none';
    });
  }

  function updateHud(res) {
    $('hudConflicts').textContent = res.count;
    const chip = $('conflictChip');
    chip.classList.toggle('ok', res.count === 0);
    chip.classList.toggle('bad', res.count > 0);
    $('hudProgress').style.width = Math.round(clamp(1 - res.count / S.initial, 0, 1) * 100) + '%';
    $('hudMoves').textContent = S.moves;
    $('hudTime').textContent = fmtTime(S.elapsed);
    $('hudPuzzle').textContent = typeById(S.type).label + ' · ' + S.n;
    $('stPoints').textContent = stats.points;
    $('stSolved').textContent = stats.solved;
    $('stStreak').textContent = stats.streak;
  }

  function updateBest() {
    const b = stats.best[S.type + ':' + S.n];
    $('bestLine').textContent = b ? 'Best on this puzzle size: ' + b.moves + ' moves · ' + fmtTime(b.time) : 'No record on this puzzle size yet — set one!';
  }

  /* ---------- timer ---------- */
  function startTimer() {
    if (S.t0 || S.won) return;
    S.t0 = performance.now() - S.elapsed * 1000;
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (S.won) return;
      S.elapsed = (performance.now() - S.t0) / 1000;
      $('hudTime').textContent = fmtTime(S.elapsed);
    }, 250);
  }

  /* ---------- dragging ---------- */
  function toLocal(e) {
    const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
    const q = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: q.x, y: q.y };
  }
  svg.addEventListener('pointerdown', e => {
    const g = e.target.closest && e.target.closest('.node');
    if (!g || e.button > 0) return;
    e.preventDefault();
    cancelAnimationFrame(S.anim);
    const i = Number(g.dataset.i), p = toLocal(e);
    S.drag = { i, id: e.pointerId, dx: S.pos[i].x - p.x, dy: S.pos[i].y - p.y, sx: S.pos[i].x, sy: S.pos[i].y, g };
    svg.setPointerCapture(e.pointerId);
    g.classList.add('dragging');
    nodesG.appendChild(g);
    if (!S.won) startTimer();
    UI.sound.pick();
  });
  svg.addEventListener('pointermove', e => {
    const d = S.drag; if (!d || d.id !== e.pointerId) return;
    const p = toLocal(e);
    S.pos[d.i] = { x: clamp(p.x + d.dx, R + 4, W - R - 4), y: clamp(p.y + d.dy, R + 4, H - R - 4) };
    schedule();
  });
  function endDrag(e) {
    const d = S.drag; if (!d || d.id !== e.pointerId) return;
    S.drag = null;
    d.g.classList.remove('dragging');
    try { svg.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
    const dist = Math.hypot(S.pos[d.i].x - d.sx, S.pos[d.i].y - d.sy);
    if (dist > 4) { S.moves++; S.history.push({ i: d.i, x: d.sx, y: d.sy }); UI.sound.drop(); }
    render();
    if (S.res.count === 0 && !S.won && !S.revealed && S.moves > 0) win();
  }
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  /* ---------- actions ---------- */
  $('newBtn').addEventListener('click', () => { newPuzzle(); UI.sound.pick(); });
  $('shuffleBtn').addEventListener('click', () => { scatter(); UI.sound.pick(); });
  function undo() {
    const h = S.history.pop();
    if (!h) { say('Nothing to undo.'); return; }
    S.pos[h.i] = { x: h.x, y: h.y };
    render(); UI.sound.drop();
  }
  $('undoBtn').addEventListener('click', undo);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  $('hintBtn').addEventListener('click', () => {
    const res = S.res;
    if (res.count === 0) { say('Nothing to fix — it is already planar!'); return; }
    let best = 0;
    res.nodeScore.forEach((s, i) => { if (s > res.nodeScore[best]) best = i; });
    nodeEls.forEach(g => g.classList.remove('hinted'));
    nodeEls[best].classList.add('hinted');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => nodeEls[best] && nodeEls[best].classList.remove('hinted'), 2600);
    say('This node is involved in the most conflicts — try moving it.');
    UI.sound.good();
  });

  $('solveBtn').addEventListener('click', () => {
    if (S.won) { say('You already solved this one!'); return; }
    S.revealed = true; stats.streak = 0; saveStats();
    clearInterval(tickTimer);
    const from = S.pos.map(p => ({ x: p.x, y: p.y })), t0 = performance.now(), dur = 900;
    cancelAnimationFrame(S.anim);
    (function step(now) {
      const k = clamp((now - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
      S.pos = from.map((p, i) => ({ x: p.x + (S.sol[i].x - p.x) * e, y: p.y + (S.sol[i].y - p.y) * e }));
      render();
      if (k < 1) S.anim = requestAnimationFrame(step);
      else say('That is one valid layout. No points for peeking — start a new puzzle!', 3600);
    })(t0);
  });

  /* ---------- victory ---------- */
  const STAR = '<path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3 6.1 20.6l1.3-6.6L2.5 9.4l6.6-.8z" stroke-linejoin="round"/>';
  function win() {
    S.won = true; clearInterval(tickTimer);
    S.elapsed = S.t0 ? (performance.now() - S.t0) / 1000 : S.elapsed;
    const ratio = S.moves / S.n;
    const stars = ratio <= 1.1 ? 3 : ratio <= 2.2 ? 2 : 1;
    const pts = Math.round(S.n * 10 * [0, 1, 1.5, 2][stars]) + Math.max(0, Math.round(S.n * 5 - S.elapsed));
    stats.points += pts; stats.solved++; stats.streak++;
    const key = S.type + ':' + S.n, best = stats.best[key];
    const record = !best || S.moves < best.moves || (S.moves === best.moves && S.elapsed < best.time);
    if (record) stats.best[key] = { moves: S.moves, time: Math.round(S.elapsed) };
    saveStats(); updateBest();

    render();
    UI.sound.win();
    UI.confetti.burst($('fx'));
    say('Planar! Zero intersections.', 3000);

    $('winStars').innerHTML = [1, 2, 3].map(k => '<svg viewBox="0 0 24 24" class="' + (k <= stars ? 'on' : 'off') + '" style="--k:' + (k - 1) + '">' + STAR + '</svg>').join('');
    $('winSub').textContent = ['', 'Solved — can you do it in fewer moves?', 'Great work, almost perfect!', 'Flawless: very few moves!'][stars] + (S.n >= 25 ? ' (Big graph!)' : '');
    $('winPoints').textContent = '+' + pts + ' points' + (record ? ' · new personal best!' : '') + (stats.streak > 1 ? ' · streak ×' + stats.streak : '');
    $('winMoves').textContent = S.moves;
    $('winTime').textContent = fmtTime(S.elapsed);
    $('winNodes').textContent = S.n;
    updateHud(S.res);
    setTimeout(() => { const d = $('winDialog'); if (!d.open && S.won) d.showModal(); }, 900);
  }
  $('winClose').addEventListener('click', () => $('winDialog').close());
  $('winAgain').addEventListener('click', () => { $('winDialog').close(); scatter(); });
  $('winNext').addEventListener('click', () => {
    $('winDialog').close();
    const t = typeById(S.type);
    if (t.fixed) { const idx = TYPES.findIndex(x => x.id === t.id); setType(TYPES[(idx + 1) % TYPES.length].id, true); }
    else { S.n = clamp(S.n + 2, t.min, t.max); newPuzzle(); }
    UI.sound.pick();
  });
  $('winDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  /* ---------- boot ---------- */
  buildTypeGrid();
  S.type = typeById(prefs.type) ? prefs.type : 'cycle';
  S.n = prefs.n || typeById(S.type).def;
  setType(S.type, false);
  newPuzzle();
})();
