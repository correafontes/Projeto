/* graphs.js — planar graph generators (with a known straight-line planar embedding) + scrambler. No DOM. */
(function (root) {
  'use strict';
  const Geom = root.Geom || require('./geom.js');
  const Poly = root.Poly || require('./poly.js');

  const SOLIDS = { tetra: 'tetrahedron', cube: 'cube', octa: 'octahedron', dodeca: 'dodecahedron', icosa: 'icosahedron' };

  /** Types available in the game. `random` ones are re-rolled until their solution is clean. */
  const TYPES = [
    { id: 'cycle', label: 'Cycle', min: 4, max: 60, def: 8 },
    { id: 'wheel', label: 'Wheel', min: 5, max: 50, def: 9 },
    { id: 'ladder', label: 'Ladder', min: 6, max: 50, def: 10 },
    { id: 'grid', label: 'Grid', min: 6, max: 64, def: 12 },
    { id: 'prism', label: 'Prism', min: 6, max: 50, def: 12 },
    { id: 'tree', label: 'Tree', min: 6, max: 60, def: 12, random: true },
    { id: 'triangulation', label: 'Triangulation', min: 5, max: 60, def: 14, random: true },
    { id: 'random', label: 'Random planar', min: 6, max: 60, def: 16, random: true },
    { id: 'clusters', label: 'Islands', min: 8, max: 60, def: 18, random: true },
    { id: 'tetra', label: 'Tetrahedron', fixed: 4 },
    { id: 'cube', label: 'Cube', fixed: 8 },
    { id: 'octa', label: 'Octahedron', fixed: 6 },
    { id: 'dodeca', label: 'Dodecahedron', fixed: 20 },
    { id: 'icosa', label: 'Icosahedron', fixed: 12 }
  ];
  const typeById = id => TYPES.find(t => t.id === id);

  /* ---------- helpers ---------- */
  function fit(pts, W, H, pad) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    pts.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); });
    const bw = Math.max(x1 - x0, 1e-9), bh = Math.max(y1 - y0, 1e-9);
    const s = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
    const ox = (W - bw * s) / 2 - x0 * s, oy = (H - bh * s) / 2 - y0 * s;
    return pts.map(p => ({ x: p.x * s + ox, y: p.y * s + oy }));
  }

  function poissonPoints(n, x0, y0, w, h, rng, density = 0.62) {
    let dmin = density * Math.sqrt((w * h) / n);
    const pts = [];
    let tries = 0;
    while (pts.length < n) {
      const p = { x: x0 + rng() * w, y: y0 + rng() * h };
      if (pts.every(q => Math.hypot(p.x - q.x, p.y - q.y) >= dmin)) { pts.push(p); tries = 0; }
      else if (++tries > 300) { dmin *= 0.9; tries = 0; }
    }
    return pts;
  }

  /**
   * Greedy (shortest-first) triangulation of a point set: a maximal planar straight-line graph.
   * Edges that would pass closer than `clear` to some other point are skipped, which keeps the
   * solved layout readable (no node hiding behind an edge).
   */
  function greedyTriangulation(pts, clear = 0) {
    const n = pts.length, cand = [];
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) cand.push([Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y), i, j]);
    cand.sort((a, b) => a[0] - b[0]);
    const edges = [];
    for (const [, i, j] of cand) {
      let ok = true;
      if (clear > 0) {
        for (let v = 0; v < n && ok; v++) {
          if (v !== i && v !== j && Geom.distPointSeg(pts[v], pts[i], pts[j]) < clear) ok = false;
        }
      }
      if (!ok) continue;
      for (const e of edges) if (Geom.edgesCross(pts, [i, j], e)) { ok = false; break; }
      if (ok) edges.push([i, j]);
    }
    return edges;
  }

  function connected(n, edges) {
    if (n === 0) return true;
    const adj = Array.from({ length: n }, () => []);
    edges.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
    const seen = new Uint8Array(n); const st = [0]; seen[0] = 1; let c = 1;
    while (st.length) { const v = st.pop(); for (const w of adj[v]) if (!seen[w]) { seen[w] = 1; c++; st.push(w); } }
    return c === n;
  }

  function thin(n, edges, rng, lo = 1.15, hi = 1.6) {
    const target = Math.max(n - 1, Math.round(n * (lo + rng() * (hi - lo))));
    const list = edges.slice();
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    let cur = edges.slice();
    for (const e of list) {
      if (cur.length <= target) break;
      const next = cur.filter(x => x !== e);
      if (connected(n, next)) cur = next;
    }
    return cur;
  }

  /* ---------- individual generators: return { pts, edges, raw } ---------- */
  const GEN = {
    cycle(n) {
      const pts = Array.from({ length: n }, (_, i) => ({ x: Math.cos(2 * Math.PI * i / n - Math.PI / 2), y: Math.sin(2 * Math.PI * i / n - Math.PI / 2) }));
      return { pts, edges: pts.map((_, i) => [i, (i + 1) % n]), raw: true };
    },
    wheel(n) {
      const m = n - 1;
      const pts = Array.from({ length: m }, (_, i) => ({ x: Math.cos(2 * Math.PI * i / m - Math.PI / 2), y: Math.sin(2 * Math.PI * i / m - Math.PI / 2) }));
      pts.push({ x: 0, y: 0 });
      const edges = [];
      for (let i = 0; i < m; i++) { edges.push([i, (i + 1) % m]); edges.push([i, m]); }
      return { pts, edges, raw: true };
    },
    ladder(n) {
      const k = Math.floor(n / 2), pts = [], edges = [];
      for (let i = 0; i < k; i++) { pts.push({ x: i, y: 0 }); pts.push({ x: i, y: 1 }); }
      for (let i = 0; i < k; i++) {
        edges.push([2 * i, 2 * i + 1]);
        if (i + 1 < k) { edges.push([2 * i, 2 * i + 2]); edges.push([2 * i + 1, 2 * i + 3]); }
      }
      if (n % 2) { pts.push({ x: k - 0.5, y: 0.5 }); edges.push([2 * k - 2, n - 1]); edges.push([2 * k - 1, n - 1]); }
      return { pts, edges, raw: true };
    },
    grid(n, rng, W, H) {
      const aspect = W / H;
      let cols = Math.max(2, Math.round(Math.sqrt(n * aspect * 0.8)));
      cols = Math.min(cols, n - 1);
      const pts = [], edges = [];
      for (let i = 0; i < n; i++) pts.push({ x: i % cols, y: Math.floor(i / cols) });
      for (let i = 0; i < n; i++) {
        if ((i % cols) + 1 < cols && i + 1 < n) edges.push([i, i + 1]);
        if (i + cols < n) edges.push([i, i + cols]);
      }
      return { pts, edges, raw: true };
    },
    prism(n) {
      const m = Math.floor(n / 2), pts = [], edges = [];
      for (let i = 0; i < m; i++) pts.push({ x: Math.cos(2 * Math.PI * i / m - Math.PI / 2), y: Math.sin(2 * Math.PI * i / m - Math.PI / 2) });
      for (let i = 0; i < m; i++) pts.push({ x: 0.5 * Math.cos(2 * Math.PI * i / m - Math.PI / 2), y: 0.5 * Math.sin(2 * Math.PI * i / m - Math.PI / 2) });
      for (let i = 0; i < m; i++) { edges.push([i, (i + 1) % m]); edges.push([m + i, m + (i + 1) % m]); edges.push([i, m + i]); }
      if (n % 2) { pts.push({ x: 0, y: 0 }); for (let i = 0; i < m; i++) edges.push([m + i, 2 * m]); }
      return { pts, edges, raw: true };
    },
    tree(n, rng) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const parent = [-1], kids = Array.from({ length: n }, () => []);
        for (let i = 1; i < n; i++) {
          let p;
          do { p = Math.floor(rng() * i); } while (kids[p].length >= 3 && rng() < 0.9);
          parent.push(p); kids[p].push(i);
        }
        // needs a pair of disjoint edges, otherwise it is a star and can never cross
        const edges = parent.map((p, i) => [p, i]).filter(e => e[0] >= 0);
        let ok = false;
        for (let i = 0; i < edges.length && !ok; i++) for (let j = i + 1; j < edges.length; j++) {
          const a = edges[i], b = edges[j];
          if (a[0] !== b[0] && a[0] !== b[1] && a[1] !== b[0] && a[1] !== b[1]) { ok = true; break; }
        }
        if (!ok) continue;
        const pts = new Array(n); let leaf = 0;
        (function lay(v, depth) {
          if (!kids[v].length) { pts[v] = { x: leaf++, y: depth }; return; }
          kids[v].forEach(c => lay(c, depth + 1));
          pts[v] = { x: kids[v].reduce((s, c) => s + pts[c].x, 0) / kids[v].length, y: depth };
        })(0, 0);
        return { pts, edges, raw: true };
      }
      return GEN.cycle(n);
    },
    triangulation(n, rng, W, H, pad, thr) {
      const pts = poissonPoints(n, pad, pad, W - 2 * pad, H - 2 * pad, rng);
      return { pts, edges: greedyTriangulation(pts, thr * 1.1), raw: false };
    },
    random(n, rng, W, H, pad, thr) {
      const pts = poissonPoints(n, pad, pad, W - 2 * pad, H - 2 * pad, rng);
      return { pts, edges: thin(n, greedyTriangulation(pts, thr * 1.1), rng), raw: false };
    },
    clusters(n, rng, W, H, pad, thr) {
      const k = n < 12 ? 2 : n < 20 ? 3 : 4;
      const cells = k === 4 ? [[0, 0], [1, 0], [0, 1], [1, 1]] : k === 3 ? [[0, 0], [1, 0], [0.5, 1]] : [[0, 0], [1, 0]];
      const cols = 2, rows = k === 2 ? 1 : 2;
      const cw = (W - 2 * pad) / cols, ch = (H - 2 * pad) / rows;
      const pts = [], edges = [];
      let used = 0;
      for (let g = 0; g < k; g++) {
        const m = g === k - 1 ? n - used : Math.floor(n / k);
        const cx = pad + cells[g][0] * cw + 14, cy = pad + cells[g][1] * ch + 14;
        const gp = poissonPoints(m, cx, cy, cw - 28, ch - 28, rng);
        const ge = thin(m, greedyTriangulation(gp, thr * 1.1), rng, 1.1, 1.5);
        gp.forEach(p => pts.push(p));
        ge.forEach(([a, b]) => edges.push([a + used, b + used]));
        used += m;
      }
      return { pts, edges, raw: false };
    }
  };
  Object.keys(SOLIDS).forEach(id => {
    GEN[id] = function () {
      const poly = Poly.make(SOLIDS[id]);
      const fi = Poly.bestFaceIndex(poly.faces);
      const fr = Poly.makeFrame(poly.verts, poly.faces, fi);
      const pts = poly.verts.map(v => { const q = Poly.schlegelProject(fr, v); return { x: q.x, y: -q.y }; });
      return { pts, edges: poly.edges, raw: true };
    };
  });

  /**
   * Build a puzzle's *solved* layout, in stage coordinates.
   * Returns { n, edges, sol }.
   */
  function generate(typeId, n, seed, W, H, pad, thr) {
    const type = typeById(typeId) || TYPES[0];
    if (type.fixed) n = type.fixed;
    n = Math.max(type.min || n, Math.min(type.max || n, n));
    const rng = Geom.mulberry32(seed);
    const attempts = type.random ? 60 : 1;
    let best = null;
    for (let a = 0; a < attempts; a++) {
      const g = GEN[type.id](n, rng, W, H, pad, thr);
      const sol = g.raw ? fit(g.pts, W, H, pad) : g.pts;
      const res = Geom.evaluate(sol, g.edges, thr);
      if (!best || res.count < best.count) best = { n: sol.length, edges: g.edges, sol, count: res.count };
      if (res.count === 0) break;
    }
    return best;
  }

  /** Randomly place the nodes so the drawing has crossings. */
  function scramble(n, edges, W, H, pad, rng, thr) {
    const minCross = n >= 8 ? 3 : 1;
    let best = null;
    for (let a = 0; a < 80; a++) {
      const pts = poissonPoints(n, pad, pad, W - 2 * pad, H - 2 * pad, rng, 0.5);
      const res = Geom.evaluate(pts, edges, thr);
      if (!best || res.count > best.count) best = { pts, count: res.count };
      if (res.count >= minCross) break;
    }
    return best.pts;
  }

  const api = { TYPES, typeById, generate, scramble, fit, poissonPoints };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Graphs = api;
})(typeof window !== 'undefined' ? window : globalThis);
