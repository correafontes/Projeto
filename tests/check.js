const Geom = require('../js/geom.js');
globalThis.Geom = Geom;
const Poly = require('../js/poly.js');
globalThis.Poly = Poly;
const Graphs = require('../js/graphs.js');

console.log('--- polyhedra ---');
for (const c of Poly.CATALOG) {
  const ns = c.param ? [3, 5, 8, 16] : [undefined];
  for (const n of ns) {
    const p = Poly.make(c.id, n);
    const V = p.verts.length, E = p.edges.length, F = p.faces.length;
    const warp = Math.max(...p.faces.map(f => Poly.faceWarp(p.verts, f)));
    const sizes = {}; p.faces.forEach(f => sizes[f.length] = (sizes[f.length] || 0) + 1);
    console.log(p.name.padEnd(30), 'V', V, 'E', E, 'F', F, 'chi', V - E + F, JSON.stringify(sizes), warp < 1e-6 ? '' : 'WARP ' + warp);
    // schlegel check: planar drawing?
    const fi = Poly.bestFaceIndex(p.faces);
    const fr = Poly.makeFrame(p.verts, p.faces, fi);
    const pos = p.verts.map(v => Poly.schlegelProject(fr, v));
    const res = Geom.evaluate(pos, p.edges, 0.0);
    const behind = pos.filter(q => q.behind).length;
    if (res.count || behind) console.log('   !! schlegel crossings', res.count, 'behind', behind);
  }
}

console.log('--- graphs (solution quality) ---');
const W = 1000, H = 640, PAD = 34, THR = 14;
for (const t of Graphs.TYPES) {
  const ns = t.fixed ? [t.fixed] : [t.min, t.def, Math.round((t.def + t.max) / 2), t.max];
  for (const n of ns) {
    let bad = 0, total = 12, maxCross = 0;
    const t0 = Date.now();
    for (let s = 1; s <= total; s++) {
      const g = Graphs.generate(t.id, n, s * 7919, W, H, PAD, THR);
      if (g.count) bad++;
      const rng = Geom.mulberry32(s);
      const sc = Graphs.scramble(g.n, g.edges, W, H, PAD, rng, THR);
      const r = Geom.evaluate(sc, g.edges, THR);
      maxCross = Math.max(maxCross, r.count);
      if (r.count === 0) console.log('   scramble has 0 conflicts', t.id, n, s);
    }
    console.log(t.id.padEnd(14), String(n).padStart(3), 'unclean solutions:', bad + '/' + total, 'max scramble conflicts', maxCross, (Date.now() - t0) + 'ms');
  }
}
