/* geom.js — pure 2D geometry helpers + seeded RNG (no DOM). */
(function (root) {
  'use strict';

  /** Small, fast, seedable PRNG. */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const randSeed = () => (Math.random() * 4294967296) >>> 0;

  const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  function distPointSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  /**
   * Proper crossing between two edges (index pairs into `pos`).
   * Edges sharing an endpoint never "cross". Returns the crossing point or null.
   */
  function edgesCross(pos, e1, e2) {
    const a = e1[0], b = e1[1], c = e2[0], d = e2[1];
    if (a === c || a === d || b === c || b === d) return null;
    const A = pos[a], B = pos[b], C = pos[c], D = pos[d];
    const d1 = orient(C, D, A), d2 = orient(C, D, B);
    if (!((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0))) return null;
    const d3 = orient(A, B, C), d4 = orient(A, B, D);
    if (!((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return null;
    const t = d1 / (d1 - d2);
    return { x: A.x + t * (B.x - A.x), y: A.y + t * (B.y - A.y) };
  }

  /**
   * Evaluate a straight-line drawing.
   *  - crossings: pairs of edges that properly intersect
   *  - touches:   nodes lying (visually) on top of an edge they don't belong to
   * `nodeThr` is the node-to-edge clearance in drawing units.
   */
  function evaluate(pos, edges, nodeThr) {
    const crossings = [], touches = [];
    const m = edges.length, n = pos.length;
    const badEdges = new Uint8Array(m);
    const nodeScore = new Int32Array(n);
    // bounding boxes for quick rejection
    const bb = edges.map(([a, b]) => ({
      x0: Math.min(pos[a].x, pos[b].x), x1: Math.max(pos[a].x, pos[b].x),
      y0: Math.min(pos[a].y, pos[b].y), y1: Math.max(pos[a].y, pos[b].y)
    }));
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        const p = bb[i], q = bb[j];
        if (p.x1 < q.x0 || q.x1 < p.x0 || p.y1 < q.y0 || q.y1 < p.y0) continue;
        const pt = edgesCross(pos, edges[i], edges[j]);
        if (pt) {
          crossings.push({ e1: i, e2: j, x: pt.x, y: pt.y });
          badEdges[i] = 1; badEdges[j] = 1;
          nodeScore[edges[i][0]]++; nodeScore[edges[i][1]]++;
          nodeScore[edges[j][0]]++; nodeScore[edges[j][1]]++;
        }
      }
    }
    for (let i = 0; i < m; i++) {
      const [a, b] = edges[i];
      const q = bb[i];
      for (let v = 0; v < n; v++) {
        if (v === a || v === b) continue;
        const p = pos[v];
        if (p.x < q.x0 - nodeThr || p.x > q.x1 + nodeThr || p.y < q.y0 - nodeThr || p.y > q.y1 + nodeThr) continue;
        if (distPointSeg(p, pos[a], pos[b]) < nodeThr) {
          touches.push({ node: v, edge: i });
          badEdges[i] = 1; nodeScore[v] += 2; nodeScore[a]++; nodeScore[b]++;
        }
      }
    }
    return { crossings, touches, count: crossings.length + touches.length, badEdges, nodeScore };
  }

  const api = { mulberry32, randSeed, orient, distPointSeg, edgesCross, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Geom = api;
})(typeof window !== 'undefined' ? window : globalThis);
