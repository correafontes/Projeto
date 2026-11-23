/* polyhedra.js — linked 3D / 2D polyhedron editor.
   Single source of truth: M.verts (3D coordinates). Both canvases are *views* of it:
   - 3D view            : perspective camera, orbitable
   - 2D view (ortho)    : front / top / side / free-angle orthographic projection
   - 2D view (planar)   : Schlegel diagram (planar drawing of the skeleton)
   Dragging in either view writes back into M.verts, then everything redraws. */
(function () {
  'use strict';

  const { V, CATALOG, make, faceGeom, faceWarp, makeFrame, schlegelProject, schlegelLift, bestFaceIndex } = Poly;
  const { add, sub, mul, dot } = V;
  const $ = id => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const DEG = Math.PI / 180;

  /* ---------- state ---------- */
  const M = { id: 'cube', n: 5, name: '', verts: [], base: [], faces: [], edges: [], edgeFaces: [] };
  const U = {
    tool: 'vertex', mode: 'schlegel', showFaces: true, showHidden: true, labels: false, spin: false,
    az: 35, el: 25, frame: null, schFace: 0, scale: { x: 100, y: 100, z: 100, u: 100 }
  };
  let C = {};                 // theme colours
  let dirty = true, action = null;

  /* ---------- colours ---------- */
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const g = n => cs.getPropertyValue(n).trim();
    const dark = UI.theme.current() === 'dark';
    C = {
      dark, accent: g('--accent'), accent2: g('--accent-2'), good: g('--good'), bad: g('--bad'), gold: g('--gold'),
      text: g('--text'), muted: g('--muted'),
      edge: dark ? '#d3d9ff' : '#2b3678', vtx: dark ? '#b7a6ff' : '#6a4cf5', vtxStroke: dark ? '#ffffff' : '#ffffff'
    };
    dirty = true;
  }
  document.addEventListener('themechange', readColors);

  /* ---------- view class ---------- */
  class View {
    constructor(canvas, kind) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.kind = kind;
      this.yaw = 0.6; this.pitch = 0.4; this.dist = 5; this.zoom = 1; this.panX = 0; this.panY = 0;
      this.w = 1; this.h = 1; this.dpr = 1; this.hoverV = -1; this.hoverF = -1; this.crossCount = 0;
    }
    resize() {
      const r = this.cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
      if (this.cv.width !== W || this.cv.height !== H) { this.cv.width = W; this.cv.height = H; }
      this.w = r.width; this.h = r.height; this.dpr = dpr;
    }
    basis() {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      return { r: [cy, 0, -sy], u: [-sp * sy, cp, -sp * cy], c: [cp * sy, sp, cp * cy] };
    }
    centre() { return [this.w / 2 + this.panX, this.h / 2 + this.panY]; }
    focal() { return Math.min(this.w, this.h) * 1.6 * this.zoom; }
    kOrtho() { return Math.min(this.w, this.h) * 0.32 * this.zoom; }
    kSch() { return 0.36 * Math.min(this.w, this.h) * this.zoom / (U.frame ? U.frame.R2d : 1); }
    project(P, B) {
      const [cx, cy] = this.centre();
      if (this.kind === 'schlegel') {
        const q = schlegelProject(U.frame, P), k = this.kSch();
        return { x: cx + q.x * k, y: cy - q.y * k, d: -q.s, s: k, behind: q.behind };
      }
      B = B || this.basis();
      const xc = dot(P, B.r), yc = dot(P, B.u), zc = dot(P, B.c);
      if (this.kind === 'persp') {
        const d = Math.max(this.dist - zc, 0.2), s = this.focal() / d;
        return { x: cx + xc * s, y: cy - yc * s, d, s };
      }
      const k = this.kOrtho();
      return { x: cx + xc * k, y: cy - yc * k, d: -zc, s: k };
    }
    /** screen point -> 3D point on the camera-parallel plane at camera-space depth zc */
    unproject(sx, sy, zc) {
      const B = this.basis(), [cx, cy] = this.centre();
      let xc, yc;
      if (this.kind === 'persp') {
        const d = Math.max(this.dist - zc, 0.2), s = this.focal() / d;
        xc = (sx - cx) / s; yc = -(sy - cy) / s;
      } else { const k = this.kOrtho(); xc = (sx - cx) / k; yc = -(sy - cy) / k; }
      return add(add(mul(B.r, xc), mul(B.u, yc)), mul(B.c, zc));
    }
    faceFront(g, B) {
      if (this.kind === 'schlegel') return true;
      B = B || this.basis();
      if (this.kind === 'persp') return dot(g.n, sub(mul(B.c, this.dist), g.c)) > 0;
      return dot(g.n, B.c) > 0;
    }
  }

  const view3d = new View($('cv3d'), 'persp');
  const view2d = new View($('cv2d'), 'schlegel');
  const views = [view3d, view2d];

  /* ---------- model management ---------- */
  function buildEdgeFaces() {
    const idx = new Map();
    M.edges.forEach((e, i) => idx.set(e[0] + '_' + e[1], i));
    M.edgeFaces = M.edges.map(() => []);
    M.faces.forEach((f, fi) => {
      for (let i = 0; i < f.length; i++) {
        const a = f[i], b = f[(i + 1) % f.length];
        const k = (a < b ? a + '_' + b : b + '_' + a);
        const ei = idx.get(k);
        if (ei !== undefined) M.edgeFaces[ei].push(fi);
      }
    });
  }

  function fillRange(inp) {
    const lo = Number(inp.min), hi = Number(inp.max);
    inp.style.setProperty('--fill', ((Number(inp.value) - lo) / (hi - lo) * 100) + '%');
  }

  function resetSliders() {
    ['sx', 'sy', 'sz', 'su'].forEach(id => { $(id).value = 100; $(id + 'Out').textContent = '100%'; fillRange($(id)); });
    U.scale = { x: 100, y: 100, z: 100, u: 100 };
  }

  function loadShape(id, n) {
    const entry = CATALOG.find(c => c.id === id) || CATALOG[1];
    if (entry.param) n = clamp(n || entry.param.def, entry.param.min, entry.param.max);
    const p = make(entry.id, n);
    M.id = entry.id; M.n = n; M.name = p.name;
    M.verts = p.verts.map(v => v.slice());
    M.base = p.verts.map(v => v.slice());
    M.faces = p.faces; M.edges = p.edges;
    buildEdgeFaces();
    resetSliders();
    // parameter slider
    const box = $('paramBox');
    box.hidden = !entry.param;
    if (entry.param) {
      const r = $('paramRange');
      r.min = entry.param.min; r.max = entry.param.max; r.value = n;
      $('paramOut').textContent = n; $('paramLabel').textContent = entry.param.label; fillRange(r);
    }
    U.schFace = bestFaceIndex(M.faces);
    buildFaceSelect();
    ensureFrame(true);
    $('shapeTag').textContent = p.name;
    dirty = true;
  }

  function buildFaceSelect() {
    const sel = $('faceSel');
    sel.textContent = '';
    M.faces.forEach((f, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = 'Face ' + (i + 1) + ' · ' + f.length + '-gon';
      sel.appendChild(o);
    });
    sel.value = U.schFace;
  }

  function ensureFrame(force) {
    if (force || !U.frame) U.frame = makeFrame(M.verts, M.faces, U.schFace);
  }

  const centroid = () => {
    let c = [0, 0, 0];
    M.verts.forEach(v => { c = add(c, v); });
    return mul(c, 1 / M.verts.length);
  };

  /* ---------- picking ---------- */
  function insidePoly(pts, x, y) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function pick(view, pt) {
    const B = view.basis();
    const sp = M.verts.map(v => view.project(v, B));
    const geo = M.faces.map(f => faceGeom(M.verts, f));
    const front = geo.map(g => view.faceFront(g, B));
    // vertex visibility (touching at least one front face)
    const vis = new Array(M.verts.length).fill(false);
    M.faces.forEach((f, fi) => { if (front[fi]) f.forEach(i => { vis[i] = true; }); });
    let bv = -1, bs = 15;
    sp.forEach((p, i) => {
      const s = Math.hypot(p.x - pt.x, p.y - pt.y) + (vis[i] ? 0 : 6);
      if (s < bs) { bs = s; bv = i; }
    });
    let bf = -1, bd = Infinity;
    M.faces.forEach((f, fi) => {
      const poly = f.map(i => sp[i]);
      if (!insidePoly(poly, pt.x, pt.y)) return;
      const d = poly.reduce((s, p) => s + p.d, 0) / poly.length + (front[fi] ? 0 : 1000);
      if (d < bd) { bd = d; bf = fi; }
    });
    return { v: bv, f: bf };
  }

  /* ---------- editing ---------- */
  function applyEdit(a, pt) {
    const view = a.view;
    if (view.kind === 'schlegel') {
      const fr = U.frame, k = view.kSch();
      const du = (pt.x - a.start.x) / k, dv = -(pt.y - a.start.y) / k;
      if (a.tool === 'shape') {
        const d = add(mul(fr.u, du), mul(fr.v, dv));
        a.sel.forEach(i => { M.verts[i] = add(a.S0[i], d); });
      } else {
        a.sel.forEach(i => {
          const q = schlegelProject(fr, a.S0[i]);
          M.verts[i] = schlegelLift(fr, q.x + du, q.y + dv, q.s);
        });
      }
    } else {
      const d = sub(view.unproject(pt.x, pt.y, a.zc), view.unproject(a.start.x, a.start.y, a.zc));
      a.sel.forEach(i => { M.verts[i] = add(a.S0[i], d); });
    }
  }

  function local(e, cv) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function syncFreeSliders() {
    $('az').value = Math.round(U.az); $('el').value = Math.round(U.el);
    $('azOut').textContent = Math.round(U.az) + '°'; $('elOut').textContent = Math.round(U.el) + '°';
    fillRange($('az')); fillRange($('el'));
  }
  function applyFreeAngles() { view2d.yaw = U.az * DEG; view2d.pitch = U.el * DEG; }

  function bind(view) {
    const cv = view.cv;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      const pt = local(e, cv), hit = pick(view, pt);
      const a = { view, id: e.pointerId, start: pt, last: pt, mode: null };
      let sel = null;
      if (e.button === 0) {
        if (U.tool === 'vertex' && hit.v >= 0) sel = [hit.v];
        else if (U.tool === 'face' && hit.f >= 0) sel = M.faces[hit.f].slice();
        else if (U.tool === 'shape' && (hit.v >= 0 || hit.f >= 0)) sel = M.verts.map((_, i) => i);
      }
      if (sel) {
        a.mode = 'edit'; a.sel = sel; a.tool = U.tool;
        a.S0 = M.verts.map(v => v.slice());
        const B = view.basis();
        a.zc = sel.reduce((s, i) => s + dot(a.S0[i], B.c), 0) / sel.length;
        view.dragV = U.tool === 'vertex' ? hit.v : -1;
      } else {
        a.mode = view.kind === 'persp' ? 'orbit' : (U.mode === 'free' ? 'rotate2d' : 'pan');
      }
      action = a;
      cv.style.cursor = 'grabbing';
    });
    cv.addEventListener('pointermove', e => {
      const pt = local(e, cv);
      if (action && action.id === e.pointerId && action.view === view) {
        const a = action, dx = pt.x - a.last.x, dy = pt.y - a.last.y;
        if (a.mode === 'orbit') { view.yaw -= dx * 0.009; view.pitch = clamp(view.pitch + dy * 0.009, -1.5, 1.5); }
        else if (a.mode === 'pan') { view.panX += dx; view.panY += dy; }
        else if (a.mode === 'rotate2d') {
          U.az = ((U.az - dx * 0.6 + 540) % 360) - 180; U.el = clamp(U.el + dy * 0.5, -90, 90);
          applyFreeAngles(); syncFreeSliders();
        } else applyEdit(a, pt);
        a.last = pt; dirty = true;
      } else if (!action) {
        const h = pick(view, pt);
        const want = U.tool === 'vertex' ? h.v >= 0 : (U.tool === 'face' ? h.f >= 0 : (h.v >= 0 || h.f >= 0));
        const hv = U.tool === 'vertex' ? h.v : -1, hf = U.tool === 'face' ? h.f : (U.tool === 'shape' && want ? -2 : -1);
        if (hv !== view.hoverV || hf !== view.hoverF) { view.hoverV = hv; view.hoverF = hf; dirty = true; }
        cv.style.cursor = want ? 'grab' : (view.kind === 'persp' ? 'move' : 'default');
      }
    });
    const end = e => {
      if (!action || action.id !== e.pointerId) return;
      action = null; view.dragV = -1;
      try { cv.releasePointerCapture(e.pointerId); } catch (_) { /* released */ }
      cv.style.cursor = 'default'; dirty = true;
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    cv.addEventListener('pointerleave', () => { if (!action && (view.hoverV !== -1 || view.hoverF !== -1)) { view.hoverV = -1; view.hoverF = -1; dirty = true; } });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      view.zoom = clamp(view.zoom * Math.exp(-e.deltaY * 0.0015), 0.3, 5); dirty = true;
    }, { passive: false });
    cv.addEventListener('dblclick', () => {
      view.zoom = 1; view.panX = 0; view.panY = 0;
      if (view.kind === 'persp') { view.yaw = 0.6; view.pitch = 0.4; }
      dirty = true;
    });
  }
  views.forEach(bind);

  /* ---------- drawing ---------- */
  const HUES = { 3: 205, 4: 165, 5: 268, 6: 35, 7: 320, 8: 8, 9: 120, 10: 50 };
  const hueOf = n => HUES[n] !== undefined ? HUES[n] : (n * 47) % 360;
  const LIGHT = (() => { const l = [-0.35, 0.55, 0.75], m = Math.hypot(...l); return l.map(x => x / m); })();

  function draw(view) {
    view.resize();
    const ctx = view.ctx, w = view.w, h = view.h;
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const B = view.basis();
    const sch = view.kind === 'schlegel';
    const sp = M.verts.map(v => view.project(v, B));
    const geo = M.faces.map(f => faceGeom(M.verts, f));
    const front = geo.map(g => view.faceFront(g, B));
    const eVis = M.edges.map((e, i) => sch || M.edgeFaces[i].some(fi => front[fi]));
    const vVis = new Array(M.verts.length).fill(sch);
    M.faces.forEach((f, fi) => { if (front[fi]) f.forEach(i => { vVis[i] = true; }); });

    const path = f => { ctx.beginPath(); f.forEach((i, k) => { k ? ctx.lineTo(sp[i].x, sp[i].y) : ctx.moveTo(sp[i].x, sp[i].y); }); ctx.closePath(); };
    const frameFace = U.mode === 'schlegel' ? U.frame.face : -1;

    // 1. hidden edges
    if (U.showHidden && !sch) {
      ctx.save(); ctx.setLineDash([5, 5]); ctx.strokeStyle = C.edge; ctx.globalAlpha = C.dark ? 0.28 : 0.35; ctx.lineWidth = 1.4;
      M.edges.forEach(([a, b], i) => { if (!eVis[i]) { ctx.beginPath(); ctx.moveTo(sp[a].x, sp[a].y); ctx.lineTo(sp[b].x, sp[b].y); ctx.stroke(); } });
      ctx.restore();
    }

    // 2. faces (painter's algorithm, far -> near)
    const order = M.faces.map((_, i) => i);
    if (!sch) {
      const dep = order.map(fi => M.faces[fi].reduce((s, i) => s + sp[i].d, 0) / M.faces[fi].length);
      order.sort((a, b) => dep[b] - dep[a]);
    } else order.sort((a, b) => (b === frameFace) - (a === frameFace));
    for (const fi of order) {
      const f = M.faces[fi], hue = hueOf(f.length);
      const isFrame = fi === frameFace;
      if (U.showFaces) {
        let l = 0.5, alpha;
        if (sch) alpha = isFrame ? 0.10 : 0.26;
        else {
          const g = geo[fi], nc = [dot(g.n, B.r), dot(g.n, B.u), dot(g.n, B.c)];
          l = front[fi] ? Math.max(0, nc[0] * LIGHT[0] + nc[1] * LIGHT[1] + nc[2] * LIGHT[2]) : 0.15;
          alpha = front[fi] ? (C.dark ? 0.30 : 0.36) : 0.10;
        }
        const light = (C.dark ? 46 : 52) + 16 * l;
        path(f);
        ctx.fillStyle = 'hsla(' + hue + ',75%,' + light + '%,' + alpha + ')'; ctx.fill();
      }
      if (isFrame) { path(f); ctx.fillStyle = C.gold; ctx.globalAlpha = sch ? 0.10 : 0.20; ctx.fill(); ctx.globalAlpha = 1; }
      if (fi === view.hoverF || view.hoverF === -2) {
        path(f); ctx.fillStyle = C.accent2; ctx.globalAlpha = 0.22; ctx.fill(); ctx.globalAlpha = 1;
      }
    }

    // 2D crossing detection (Schlegel mode only is displayed)
    let crosses = [];
    if (sch) {
      for (let i = 0; i < M.edges.length; i++) for (let j = i + 1; j < M.edges.length; j++) {
        const pt = Geom.edgesCross(sp, M.edges[i], M.edges[j]);
        if (pt) crosses.push({ i, j, x: pt.x, y: pt.y });
      }
    }
    view.crossCount = crosses.length;
    const badEdge = new Set();
    crosses.forEach(c => { badEdge.add(c.i); badEdge.add(c.j); });

    // viewpoint overlay in the 3D view
    if (view.kind === 'persp' && U.mode === 'schlegel') {
      const fr = U.frame, pp = view.project(fr.p, B);
      ctx.save(); ctx.setLineDash([3, 5]); ctx.strokeStyle = C.gold; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.2;
      M.faces[fr.face].forEach(i => { ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(sp[i].x, sp[i].y); ctx.stroke(); });
      ctx.restore();
      ctx.save(); ctx.translate(pp.x, pp.y); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = C.gold; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.fillRect(-5, -5, 10, 10); ctx.strokeRect(-5, -5, 10, 10); ctx.restore();
      ctx.fillStyle = C.gold; ctx.font = '600 11px system-ui, sans-serif'; ctx.fillText('viewpoint', pp.x + 10, pp.y - 8);
    }

    // 3. visible edges
    M.edges.forEach(([a, b], i) => {
      if (!eVis[i]) return;
      const bad = badEdge.has(i);
      ctx.beginPath(); ctx.moveTo(sp[a].x, sp[a].y); ctx.lineTo(sp[b].x, sp[b].y);
      ctx.strokeStyle = bad ? C.bad : C.edge; ctx.lineWidth = bad ? 2.8 : 2; ctx.globalAlpha = bad ? 1 : 0.92;
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    crosses.forEach(c => {
      ctx.beginPath(); ctx.arc(c.x, c.y, 5.5, 0, 6.2832); ctx.fillStyle = C.bad; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    });

    // 4. vertices (far -> near)
    const vo = M.verts.map((_, i) => i).sort((a, b) => sp[b].d - sp[a].d);
    const ref = view.kind === 'persp' ? view.focal() / view.dist : 1;
    for (const i of vo) {
      const p = sp[i];
      let r = view.kind === 'persp' ? clamp(5.6 * p.s / ref, 3.6, 8.5) : 5.8;
      const hot = view.hoverV === i, drag = view.dragV === i;
      if (hot || drag) r += 2.5;
      ctx.globalAlpha = vVis[i] ? 1 : 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832);
      ctx.fillStyle = drag ? C.gold : (hot ? C.accent2 : C.vtx); ctx.fill();
      ctx.lineWidth = 1.8; ctx.strokeStyle = C.vtxStroke; ctx.stroke();
      if (U.labels) {
        ctx.fillStyle = C.text; ctx.font = '600 11px system-ui, sans-serif';
        ctx.fillText(String(i), p.x + r + 3, p.y - r - 1);
      }
    }
    ctx.globalAlpha = 1;

    // 5. axis gizmo
    if (!sch) {
      const ox = 38, oy = h - 34, L = 24;
      [['X', [1, 0, 0], '#ff6b81'], ['Y', [0, 1, 0], '#4ade80'], ['Z', [0, 0, 1], '#60a5fa']].forEach(([name, ax, col]) => {
        const gx = dot(ax, B.r) * L, gy = -dot(ax, B.u) * L;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + gx, oy + gy); ctx.strokeStyle = col; ctx.lineWidth = 2.2; ctx.stroke();
        ctx.fillStyle = col; ctx.font = '700 10px system-ui, sans-serif'; ctx.fillText(name, ox + gx * 1.22 - 3, oy + gy * 1.22 + 4);
      });
    }
  }

  /* ---------- info panel ---------- */
  const lastInfo = {};
  function setText(id, v) { if (lastInfo[id] !== v) { lastInfo[id] = v; $(id).textContent = v; } }
  function updateInfo() {
    setText('fV', M.verts.length); setText('fE', M.edges.length); setText('fF', M.faces.length);
    setText('fX', M.verts.length - M.edges.length + M.faces.length);
    const warp = Math.max(...M.faces.map(f => faceWarp(M.verts, f)));
    const note = $('warpNote');
    const msg = warp < 0.004
      ? 'All faces are flat.'
      : 'Warped faces (max ' + warp.toFixed(2) + '): faces are no longer flat, but both views stay in sync.';
    if (lastInfo.warp !== msg) {
      lastInfo.warp = msg; note.textContent = msg;
      note.className = 'note ' + (warp < 0.004 ? 'good' : 'warn');
    }
    const tag = $('crossTag');
    let t = '', cls = 'tag';
    if (U.mode === 'schlegel') {
      if (view2d.crossCount === 0) { t = 'planar drawing ✓'; cls += ' good'; }
      else { t = view2d.crossCount + ' crossing' + (view2d.crossCount > 1 ? 's' : ''); cls += ' bad'; }
    }
    if (lastInfo.cross !== t + cls) { lastInfo.cross = t + cls; tag.textContent = t; tag.className = cls; tag.style.display = t ? '' : 'none'; }
  }

  /* ---------- UI wiring ---------- */
  const MODE_TEXT = {
    front: ['Front', 'Orthographic projection looking along −Z (X right, Y up). Dragging moves a vertex in this plane; its depth is kept.'],
    top: ['Top', 'Orthographic projection looking down the Y axis. Dragging moves a vertex in the X–Z plane; its height is kept.'],
    side: ['Side', 'Orthographic projection looking along −X. Dragging moves a vertex in the Y–Z plane; its X is kept.'],
    free: ['Free angle', 'Orthographic “shadow” from any angle. Use the sliders, or drag empty space to rotate this view.'],
    schlegel: ['Planar (Schlegel)', 'The skeleton seen from just outside the gold face: a flat drawing with no crossings. Dragging slides a vertex along its line of sight.']
  };
  function setMode(mode) {
    U.mode = mode;
    document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('freeBox').hidden = mode !== 'free';
    $('schBox').hidden = mode !== 'schlegel';
    view2d.kind = mode === 'schlegel' ? 'schlegel' : 'ortho';
    if (mode === 'front') { view2d.yaw = 0; view2d.pitch = 0; }
    else if (mode === 'top') { view2d.yaw = 0; view2d.pitch = Math.PI / 2; }
    else if (mode === 'side') { view2d.yaw = Math.PI / 2; view2d.pitch = 0; }
    else if (mode === 'free') applyFreeAngles();
    else ensureFrame(false);
    view2d.panX = 0; view2d.panY = 0; view2d.zoom = 1;
    $('modeTag').textContent = MODE_TEXT[mode][0];
    $('modeHint').textContent = MODE_TEXT[mode][1];
    $('foot2d').textContent = MODE_TEXT[mode][1];
    dirty = true;
  }
  document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  const TOOL_HINT = {
    vertex: 'Drag a vertex. Drag empty space to orbit (3D) or pan (2D). Scroll to zoom, double-click to reset.',
    face: 'Drag a face: all its vertices move together. Drag empty space to orbit/pan.',
    shape: 'Drag the shape to relocate it as a whole. Drag empty space to orbit/pan.'
  };
  document.querySelectorAll('#toolSeg button').forEach(b => b.addEventListener('click', () => {
    U.tool = b.dataset.tool;
    document.querySelectorAll('#toolSeg button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $('toolHint').textContent = TOOL_HINT[U.tool];
    views.forEach(v => { v.hoverV = -1; v.hoverF = -1; });
    dirty = true;
  }));

  // shape select
  (function buildShapeSelect() {
    const sel = $('shapeSel');
    const groups = {};
    CATALOG.forEach(c => {
      if (!groups[c.group]) { groups[c.group] = document.createElement('optgroup'); groups[c.group].label = c.group; sel.appendChild(groups[c.group]); }
      const o = document.createElement('option'); o.value = c.id; o.textContent = c.label; groups[c.group].appendChild(o);
    });
    sel.value = 'cube';
    sel.addEventListener('change', () => {
      const entry = CATALOG.find(c => c.id === sel.value);
      loadShape(sel.value, entry.param ? entry.param.def : undefined);
      UI.sound.pick();
    });
  })();
  $('paramRange').addEventListener('input', e => {
    $('paramOut').textContent = e.target.value; fillRange(e.target);
    loadShape(M.id, Number(e.target.value));
  });

  // stretch sliders
  [['sx', 0, 'x'], ['sy', 1, 'y'], ['sz', 2, 'z'], ['su', -1, 'u']].forEach(([id, axis, key]) => {
    const inp = $(id);
    inp.addEventListener('input', () => {
      const val = Number(inp.value), ratio = val / U.scale[key];
      const c = centroid();
      M.verts = M.verts.map(v => {
        const q = v.slice();
        for (let k = 0; k < 3; k++) if (axis === -1 || axis === k) q[k] = c[k] + (q[k] - c[k]) * ratio;
        return q;
      });
      U.scale[key] = val;
      $(id + 'Out').textContent = val + '%'; fillRange(inp);
      ensureFrame(true); dirty = true;
    });
  });
  $('resetBtn').addEventListener('click', () => {
    M.verts = M.base.map(v => v.slice()); resetSliders(); ensureFrame(true); dirty = true; UI.sound.drop();
  });
  $('centerBtn').addEventListener('click', () => {
    const c = centroid(); M.verts = M.verts.map(v => sub(v, c)); ensureFrame(true); dirty = true;
  });
  $('jiggleBtn').addEventListener('click', () => {
    M.verts = M.verts.map(v => add(v, [(Math.random() - .5) * .3, (Math.random() - .5) * .3, (Math.random() - .5) * .3]));
    ensureFrame(true); dirty = true; UI.sound.pick();
  });

  // free-angle sliders
  ['az', 'el'].forEach(id => $(id).addEventListener('input', () => {
    U.az = Number($('az').value); U.el = Number($('el').value);
    $('azOut').textContent = U.az + '°'; $('elOut').textContent = U.el + '°';
    fillRange($('az')); fillRange($('el'));
    applyFreeAngles(); dirty = true;
  }));

  // schlegel controls
  $('faceSel').addEventListener('change', e => { U.schFace = Number(e.target.value); ensureFrame(true); view2d.panX = view2d.panY = 0; dirty = true; });
  $('reframeBtn').addEventListener('click', () => { ensureFrame(true); dirty = true; UI.sound.good(); });

  // toggles
  $('optFaces').addEventListener('change', e => { U.showFaces = e.target.checked; dirty = true; });
  $('optHidden').addEventListener('change', e => { U.showHidden = e.target.checked; dirty = true; });
  $('optLabels').addEventListener('change', e => { U.labels = e.target.checked; dirty = true; });
  $('optSpin').addEventListener('change', e => { U.spin = e.target.checked; dirty = true; });

  document.querySelectorAll('input[type="range"]').forEach(r => { fillRange(r); r.addEventListener('input', () => fillRange(r)); });
  window.addEventListener('resize', () => { dirty = true; });
  if (window.ResizeObserver) { const ro = new ResizeObserver(() => { dirty = true; }); views.forEach(v => ro.observe(v.cv)); }

  /* ---------- main loop ---------- */
  function loop() {
    if (U.spin && !(action && action.view === view3d)) { view3d.yaw += 0.006; dirty = true; }
    if (dirty) { dirty = false; views.forEach(draw); updateInfo(); }
    requestAnimationFrame(loop);
  }

  /* ---------- boot ---------- */
  readColors();
  loadShape('cube');
  setMode('schlegel');
  view3d.yaw = 0.7; view3d.pitch = 0.45;
  requestAnimationFrame(loop);
})();
