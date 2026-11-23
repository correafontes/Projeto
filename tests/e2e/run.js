// End-to-end smoke test + screenshots. Run: node tests/e2e/run.js   (needs Edge/Chrome installed)
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const exe = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].find(p => fs.existsSync(p));
const root = path.resolve(__dirname, '..', '..');
const out = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--allow-file-access-from-files'] });
  const errors = [];
  const hook = page => {
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  };

  /* ---------------- game ---------------- */
  let page = await browser.newPage(); hook(page);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
  await sleep(600);
  await page.screenshot({ path: path.join(out, 'game_start.png') });

  const nodeCount = await page.$$eval('.node', n => n.length);
  const conflicts0 = await page.$eval('#hudConflicts', e => +e.textContent);
  console.log('game: nodes', nodeCount, 'conflicts', conflicts0);

  // Reveal must NOT trigger the reward
  await page.click('#solveBtn'); await sleep(1300);
  const afterReveal = await page.$eval('#hudConflicts', e => +e.textContent);
  const dlgOpen1 = await page.$eval('#winDialog', d => d.open);
  console.log('after reveal: conflicts', afterReveal, 'dialog open (expected false):', dlgOpen1);
  await page.screenshot({ path: path.join(out, 'game_revealed.png') });

  // Real win: deterministic seed, then replay the generator's solution using real mouse drags.
  await page.evaluate(() => { window.__r = Math.random; Math.random = () => 0.3141; });
  await page.click('.type-card[data-type="grid"]'); await sleep(400);
  const sol = await page.evaluate(() => {
    const seed = (0.3141 * 4294967295) >>> 0;
    const type = document.querySelector('.type-card[aria-pressed="true"]').dataset.type;
    const n = +document.getElementById('nInput').value;
    return Graphs.generate(type, n, seed, 1000, 640, 36, 15).sol;
  });
  console.log('win test: grid nodes', sol.length, 'conflicts at start', await page.$eval('#hudConflicts', e => +e.textContent));
  await page.screenshot({ path: path.join(out, 'game_scrambled_grid.png') });
  const box = await page.$eval('#board', s => { const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const scale = Math.min(box.w / 1000, box.h / 640);
  const ox = box.x + (box.w - 1000 * scale) / 2, oy = box.y + (box.h - 640 * scale) / 2;
  const toScreen = (x, y) => [ox + x * scale, oy + y * scale];
  const cur = async () => page.$$eval('.node', ns => ns.map(g => { const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform')); return [+m[1], +m[2], +g.dataset.i]; }));
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < sol.length; i++) {
      const c = (await cur()).find(n => n[2] === i);
      if (Math.hypot(c[0] - sol[i].x, c[1] - sol[i].y) < 2) continue;
      const [sx, sy] = toScreen(c[0], c[1]);
      const [tx, ty] = toScreen(sol[i].x, sol[i].y);
      await page.mouse.move(sx, sy); await page.mouse.down();
      await page.mouse.move((sx + tx) / 2, (sy + ty) / 2, { steps: 2 });
      await page.mouse.move(tx, ty, { steps: 2 }); await page.mouse.up();
    }
  }
  await sleep(1800);
  console.log('after manual drags: conflicts', await page.$eval('#hudConflicts', e => +e.textContent),
    '| dialog open (expected true):', await page.$eval('#winDialog', d => d.open),
    '| stage solved class:', await page.$eval('#stage', s => s.classList.contains('solved')),
    '| points:', await page.$eval('#stPoints', e => e.textContent));
  await page.screenshot({ path: path.join(out, 'game_win.png') });
  await page.click('#winClose'); await sleep(300);
  await page.screenshot({ path: path.join(out, 'game_solved_board.png') });
  await page.evaluate(() => { Math.random = window.__r; });

  // type a node count
  await page.click('.type-card[data-type="wheel"]'); await sleep(300);
  await page.$eval('#nInput', i => { i.value = ''; });
  await page.type('#nInput', '15'); await page.keyboard.press('Enter'); await sleep(500);
  console.log('wheel nodes after typing 15:', await page.$$eval('.node', n => n.length));
  await page.screenshot({ path: path.join(out, 'game_wheel15.png') });
  await page.click('.type-card[data-type="dodeca"]'); await sleep(400);
  console.log('dodeca nodes:', await page.$$eval('.node', n => n.length), 'input disabled:', await page.$eval('#nInput', i => i.disabled));
  await page.click('#themeBtn'); await sleep(300);
  await page.screenshot({ path: path.join(out, 'game_light.png') });
  await page.click('#themeBtn');

  // mobile
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await sleep(400);
  await page.screenshot({ path: path.join(out, 'game_mobile.png'), fullPage: true });

  /* ---------------- polyhedra ---------------- */
  page = await browser.newPage(); hook(page);
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(pathToFileURL(path.join(root, 'polyhedra.html')).href);
  await sleep(700);
  await page.screenshot({ path: path.join(out, 'poly_start.png') });

  const info = async () => page.evaluate(() => ({ v: fV.textContent, e: fE.textContent, f: fF.textContent, x: fX.textContent, cross: crossTag.textContent, warp: warpNote.textContent }));
  console.log('poly cube:', await info());

  // drag a vertex in the 3D view and see the 2D change (count pixels differing)
  const snap = async sel => page.$eval(sel, c => c.toDataURL());
  const before2d = await snap('#cv2d');
  const cv3 = await page.$eval('#cv3d', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  // find a vertex: sample by moving the mouse across the canvas and watching cursor change is hard; just drag from approx the centre-right
  let moved = false;
  for (let k = 0; k < 40 && !moved; k++) {
    const px = cv3.x + cv3.w * (0.3 + 0.4 * Math.random()), py = cv3.y + cv3.h * (0.3 + 0.4 * Math.random());
    await page.mouse.move(px, py);
    const cur = await page.$eval('#cv3d', c => c.style.cursor);
    if (cur === 'grab') {
      await page.mouse.down(); await page.mouse.move(px + 60, py - 40, { steps: 6 }); await page.mouse.up(); moved = true;
    }
  }
  await sleep(200);
  const after2d = await snap('#cv2d');
  console.log('3D drag changed 2D view:', moved && before2d !== after2d, '| info:', await info());
  await page.screenshot({ path: path.join(out, 'poly_after3d.png') });

  // switch 2D to front, drag a vertex in 2D and check 3D changes
  await page.click('#modeSeg button[data-mode="front"]'); await sleep(200);
  const before3d = await snap('#cv3d');
  const cv2 = await page.$eval('#cv2d', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  moved = false;
  for (let k = 0; k < 60 && !moved; k++) {
    const px = cv2.x + cv2.w * (0.2 + 0.6 * Math.random()), py = cv2.y + cv2.h * (0.2 + 0.6 * Math.random());
    await page.mouse.move(px, py);
    const cur = await page.$eval('#cv2d', c => c.style.cursor);
    if (cur === 'grab') { await page.mouse.down(); await page.mouse.move(px + 50, py + 50, { steps: 6 }); await page.mouse.up(); moved = true; }
  }
  await sleep(200);
  console.log('2D drag changed 3D view:', moved && before3d !== await snap('#cv3d'));
  await page.screenshot({ path: path.join(out, 'poly_front.png') });

  // stretch slider
  await page.$eval('#sx', i => { i.value = 200; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(150);
  await page.screenshot({ path: path.join(out, 'poly_stretch.png') });

  // dodecahedron planar view
  await page.select('#shapeSel', 'dodecahedron');
  await page.click('#modeSeg button[data-mode="schlegel"]'); await sleep(300);
  console.log('dodeca:', await info());
  await page.screenshot({ path: path.join(out, 'poly_dodeca.png') });
  await page.select('#shapeSel', 'truncated-cube'); await sleep(300);
  console.log('trunc cube:', await info());
  await page.screenshot({ path: path.join(out, 'poly_trunc.png') });
  await page.select('#shapeSel', 'antiprism'); await sleep(200);
  await page.$eval('#paramRange', i => { i.value = 7; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await sleep(300);
  console.log('antiprism 7:', await info());
  await page.screenshot({ path: path.join(out, 'poly_antiprism.png') });

  // Schlegel drag: pull a vertex in the planar view, 3D must change and crossings may appear
  await page.select('#shapeSel', 'cube'); await sleep(200);
  await page.click('#modeSeg button[data-mode="schlegel"]'); await sleep(200);
  const b3 = await snap('#cv3d');
  const c2 = await page.$eval('#cv2d', c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  let m2 = false;
  for (let k = 0; k < 80 && !m2; k++) {
    const px = c2.x + c2.w * (0.15 + 0.7 * Math.random()), py = c2.y + c2.h * (0.15 + 0.7 * Math.random());
    await page.mouse.move(px, py);
    if (await page.$eval('#cv2d', c => c.style.cursor) === 'grab') { await page.mouse.down(); await page.mouse.move(px + 140, py + 10, { steps: 8 }); await page.mouse.up(); m2 = true; }
  }
  await sleep(200);
  console.log('Schlegel drag changed 3D:', m2 && b3 !== await snap('#cv3d'), '|', (await info()).cross);
  await page.screenshot({ path: path.join(out, 'poly_schlegel_drag.png') });
  await page.click('#themeBtn'); await sleep(200);
  await page.screenshot({ path: path.join(out, 'poly_light.png') });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); await sleep(500);
  await page.screenshot({ path: path.join(out, 'poly_mobile.png'), fullPage: true });
  console.log('mobile overflow x:', await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));

  console.log('ERRORS:', errors.length ? errors : 'none');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
