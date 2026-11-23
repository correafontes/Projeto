# PlanarLab

Two small, fully offline web toys about planar graphs and polyhedra. Plain HTML, CSS and JavaScript — **no build step, no dependencies, no external requests** — so it works on GitHub Pages (or by simply double-clicking `index.html`).

| Page | What it does |
| --- | --- |
| `index.html` — **Untangle** | A puzzle game. Drag the nodes until no edges cross. 14 graph families (cycle, wheel, ladder, grid, prism, tree, triangulation, random planar, islands, and the five Platonic skeletons). Choose the number of nodes (typing, slider or ±). Stars, points, streak and personal bests are stored in `localStorage`; solving shows confetti and a reward dialog. |
| `polyhedra.html` — **Polyhedra Lab** | A 3D polyhedron and a live 2D view of the same object. Edit either one — move vertices, faces or the whole shape, stretch along X/Y/Z — and the other updates instantly. The 2D view can be a front/top/side/free-angle projection or the **Schlegel diagram** (the planar graph hiding in every convex polyhedron). |

## Publish on GitHub Pages

1. Push this folder to a repository.
2. *Settings → Pages → Deploy from a branch →* `main` / root.
3. Open `https://<user>.github.io/<repo>/`.

## Layout

```
index.html        game page
polyhedra.html    3D / 2D page
css/style.css     shared design system (dark + light themes)
js/geom.js        2D geometry, crossing detection, seeded RNG
js/poly.js        polyhedra catalogue, convex hull → faces, Schlegel projection
js/graphs.js      planar graph generators + scrambler
js/ui.js          theme, sound (WebAudio), confetti, storage
js/game.js        game logic
js/polyhedra.js   linked 3D/2D editor
tests/            optional dev tests (not needed to run the site)
```

## How it works (short)

* **Game** – every puzzle is generated *from a known planar drawing*, then the nodes are scattered randomly, so a solution always exists. Edges that properly intersect, or a node lying on an edge it does not belong to, count as conflicts. “Reveal” shows a valid layout but gives no reward.
* **Polyhedra** – every shape is just a list of vertices; the faces are recovered with a small brute-force convex hull. The vertex array is the single source of truth; both canvases are views of it. Dragging in an orthographic view moves a vertex in that view plane (depth kept). Dragging in the Schlegel view slides the vertex along its line of sight from the viewpoint.

## Dev tests

```
node tests/check.js                       # geometry / generator sanity checks
cd tests/e2e && npm i && node run.js      # headless browser run + screenshots (needs Edge/Chrome)
```
