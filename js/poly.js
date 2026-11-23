/* poly.js — polyhedra library (convex hull from vertices) + Schlegel-diagram frame. No DOM. */
(function (root) {
  'use strict';

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const V = { add, sub, mul, dot, cross, len, norm };
  const PHI = (1 + Math.sqrt(5)) / 2;

  /* ---------- vertex-set generators ---------- */
  function uniq(points) {
    const seen = new Set(), out = [];
    for (const p of points) {
      const k = p.map(x => Math.round(x * 1e6) + 0).join(',');
      if (!seen.has(k)) { seen.add(k); out.push(p); }
    }
    return out;
  }
  const ALL_PERMS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  const CYC_PERMS = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
  function gen(base, { cyclic = false, even = false } = {}) {
    const out = [];
    for (const pm of (cyclic ? CYC_PERMS : ALL_PERMS)) {
      const q = [base[pm[0]], base[pm[1]], base[pm[2]]];
      for (let m = 0; m < 8; m++) {
        if (even) { let c = 0; for (let k = 0; k < 3; k++) c += (m >> k) & 1; if (c % 2) continue; }
        out.push([0, 1, 2].map(k => ((m >> k) & 1) ? -q[k] : q[k]));
      }
    }
    return out;
  }
  const ring = (n, y, r = 1, phase = 0) =>
    Array.from({ length: n }, (_, k) => [r * Math.cos(2 * Math.PI * k / n + phase), y, r * Math.sin(2 * Math.PI * k / n + phase)]);

  /* ---------- convex hull -> polygonal faces (brute force, fine for <= 40 vertices) ---------- */
  function hullFaces(P) {
    const n = P.length, eps = 1e-6;
    const planes = new Map();
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
      let nr = cross(sub(P[j], P[i]), sub(P[k], P[i]));
      const l = len(nr);
      if (l < 1e-9) continue;
      nr = mul(nr, 1 / l);
      let d = dot(nr, P[i]), pos = 0, neg = 0;
      const on = [];
      for (let m = 0; m < n; m++) {
        const s = dot(nr, P[m]) - d;
        if (s > eps) pos++; else if (s < -eps) neg++; else on.push(m);
      }
      if (pos && neg) continue;
      if (pos) { nr = mul(nr, -1); d = -d; }
      const key = on.join(',');
      if (planes.has(key)) continue;
      planes.set(key, { idx: on, nrm: nr });
    }
    const faces = [];
    for (const { idx, nrm } of planes.values()) {
      let c = [0, 0, 0];
      idx.forEach(i => { c = add(c, P[i]); });
      c = mul(c, 1 / idx.length);
      const u = norm(sub(P[idx[0]], c)), v = cross(nrm, u);
      const ang = i => { const r = sub(P[i], c); return Math.atan2(dot(r, v), dot(r, u)); };
      faces.push(idx.slice().sort((a, b) => ang(a) - ang(b)));
    }
    return faces;
  }

  function edgesOf(faces) {
    const seen = new Set(), edges = [];
    for (const f of faces) for (let i = 0; i < f.length; i++) {
      const a = f[i], b = f[(i + 1) % f.length];
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (!seen.has(k)) { seen.add(k); edges.push([Math.min(a, b), Math.max(a, b)]); }
    }
    return edges;
  }

  function normalize(points) {
    let c = [0, 0, 0];
    points.forEach(p => { c = add(c, p); });
    c = mul(c, 1 / points.length);
    const q = points.map(p => sub(p, c));
    const r = Math.max(...q.map(len)) || 1;
    return q.map(p => mul(p, 1 / r));
  }

  /* ---------- catalog ---------- */
  const xi = Math.SQRT2 - 1;
  const CATALOG = [
    { id: 'tetrahedron', group: 'Platonic solids', label: 'Tetrahedron', build: () => [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] },
    { id: 'cube', group: 'Platonic solids', label: 'Cube', build: () => uniq(gen([1, 1, 1])) },
    { id: 'octahedron', group: 'Platonic solids', label: 'Octahedron', build: () => uniq(gen([1, 0, 0])) },
    { id: 'dodecahedron', group: 'Platonic solids', label: 'Dodecahedron', build: () => uniq([...gen([1, 1, 1]), ...gen([0, 1 / PHI, PHI], { cyclic: true })]) },
    { id: 'icosahedron', group: 'Platonic solids', label: 'Icosahedron', build: () => uniq(gen([0, 1, PHI], { cyclic: true })) },
    { id: 'cuboctahedron', group: 'Archimedean & friends', label: 'Cuboctahedron', build: () => uniq(gen([1, 1, 0])) },
    { id: 'truncated-tetrahedron', group: 'Archimedean & friends', label: 'Truncated tetrahedron', build: () => uniq(gen([3, 1, 1], { even: true })) },
    { id: 'truncated-cube', group: 'Archimedean & friends', label: 'Truncated cube', build: () => uniq(gen([xi, 1, 1])) },
    { id: 'truncated-octahedron', group: 'Archimedean & friends', label: 'Truncated octahedron', build: () => uniq(gen([0, 1, 2])) },
    { id: 'rhombic-dodecahedron', group: 'Archimedean & friends', label: 'Rhombic dodecahedron', build: () => uniq([...gen([1, 1, 1]), ...gen([2, 0, 0])]) },
    {
      id: 'prism', group: 'Families (choose n)', label: 'Prism', param: { label: 'Sides of the base', min: 3, max: 16, def: 5 },
      build: n => { const h = 2 * Math.sin(Math.PI / n); return [...ring(n, h / 2), ...ring(n, -h / 2)]; }
    },
    {
      id: 'antiprism', group: 'Families (choose n)', label: 'Antiprism', param: { label: 'Sides of the base', min: 3, max: 16, def: 5 },
      build: n => {
        const s = 2 * Math.sin(Math.PI / n), c = 2 * Math.sin(Math.PI / (2 * n));
        const h = Math.sqrt(Math.max(s * s - c * c, 0.01));
        return [...ring(n, h / 2), ...ring(n, -h / 2, 1, Math.PI / n)];
      }
    },
    {
      id: 'pyramid', group: 'Families (choose n)', label: 'Pyramid', param: { label: 'Sides of the base', min: 3, max: 16, def: 5 },
      build: n => [...ring(n, -0.6), [0, 0.9, 0]]
    },
    {
      id: 'bipyramid', group: 'Families (choose n)', label: 'Bipyramid', param: { label: 'Sides of the base', min: 3, max: 16, def: 5 },
      build: n => [...ring(n, 0), [0, 1.1, 0], [0, -1.1, 0]]
    }
  ];

  function make(id, n) {
    const entry = CATALOG.find(c => c.id === id) || CATALOG[1];
    const pts = normalize(entry.build(n || (entry.param && entry.param.def)));
    const faces = hullFaces(pts);
    const edges = edgesOf(faces);
    return { id: entry.id, name: entry.label + (entry.param ? ' (n=' + n + ')' : ''), verts: pts, faces, edges };
  }

  /* ---------- geometry of (possibly warped) faces ---------- */
  function faceGeom(verts, face) {
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    const k = face.length;
    for (let i = 0; i < k; i++) {
      const a = verts[face[i]], b = verts[face[(i + 1) % k]];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
      cx += a[0]; cy += a[1]; cz += a[2];
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    return { n: [nx / l, ny / l, nz / l], c: [cx / k, cy / k, cz / k], area: l / 2 };
  }

  /** Largest distance of a face's vertices from its best-fit plane (0 = perfectly planar). */
  function faceWarp(verts, face) {
    const g = faceGeom(verts, face);
    let m = 0;
    for (const i of face) m = Math.max(m, Math.abs(dot(sub(verts[i], g.c), g.n)));
    return m;
  }

  /* ---------- Schlegel diagram ----------
     Viewpoint p sits just outside face F. Every vertex is projected from p onto the plane of F.
     For a convex polyhedron this gives a planar straight-line drawing of its skeleton. */
  function makeFrame(verts, faces, fi) {
    const g = faceGeom(verts, faces[fi]);
    const n = g.n, c = g.c;
    let cen = [0, 0, 0];
    verts.forEach(v => { cen = add(cen, v); });
    cen = mul(cen, 1 / verts.length);
    const R = Math.max(...verts.map(v => len(sub(v, cen)))) || 1;
    let tmax = Infinity;
    faces.forEach((f, j) => {
      if (j === fi) return;
      const gj = faceGeom(verts, f);
      const a = dot(gj.n, n);
      if (a > 1e-6) {
        const room = dot(gj.n, gj.c) - dot(gj.n, c);
        if (room > 1e-9) tmax = Math.min(tmax, room / a);
      }
    });
    const t = 0.55 * Math.min(tmax, 1.5 * R);
    const p = add(c, mul(n, t));
    const u = norm(sub(verts[faces[fi][0]], c));
    const v = cross(n, u);
    const fr = { face: fi, c, n, u, v, p, t, R2d: 1 };
    let r2 = 0;
    for (const i of faces[fi]) { const q = schlegelProject(fr, verts[i]); r2 = Math.max(r2, Math.hypot(q.x, q.y)); }
    fr.R2d = r2 || 1;
    return fr;
  }

  function schlegelProject(fr, P) {
    const den = dot(sub(fr.p, P), fr.n);
    const min = 0.02 * fr.t;
    const s = fr.t / Math.max(den, min);
    const q = add(fr.p, mul(sub(P, fr.p), s));
    const rel = sub(q, fr.c);
    return { x: dot(rel, fr.u), y: dot(rel, fr.v), s, behind: den <= min };
  }

  /** Inverse of schlegelProject for a given "height factor" s. */
  function schlegelLift(fr, x, y, s) {
    const q = add(fr.c, add(mul(fr.u, x), mul(fr.v, y)));
    return add(fr.p, mul(sub(q, fr.p), 1 / s));
  }

  function bestFaceIndex(faces) {
    let best = 0;
    faces.forEach((f, i) => { if (f.length > faces[best].length) best = i; });
    return best;
  }

  const api = { V, CATALOG, make, faceGeom, faceWarp, makeFrame, schlegelProject, schlegelLift, bestFaceIndex, edgesOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Poly = api;
})(typeof window !== 'undefined' ? window : globalThis);
