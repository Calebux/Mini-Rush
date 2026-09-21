import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = 'output/presentation-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
try {
  await page.addInitScript(() => {
    localStorage.setItem('minirush.controls-guide', '1');
    localStorage.setItem('minirush.welcomed', '1'); // not a first-open run
  });
  await page.goto(`${base}/?map=lagos&seed=7&len=600&laps=1&q=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  await page.click('#btn-garage-menu');
  for (const [width, height] of [[390, 844], [360, 640], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(500);
    const layout = await page.evaluate(() => {
      const stage = document.getElementById('garage-car-stage').getBoundingClientRect();
      const cta = document.getElementById('btn-garage-done').getBoundingClientRect();
      return { stageHeight: stage.height, ctaBottom: cta.bottom, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(layout.stageHeight >= (height < 700 ? 180 : 280), JSON.stringify(layout));
    assert.ok(layout.ctaBottom <= height && !layout.overflow, JSON.stringify(layout));
    await page.screenshot({ path: `${out}/garage-${width}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  await page.click('#tab-hyper');
  await page.locator('#btn-market-nim').scrollIntoViewIfNeeded();
  assert.equal(await page.locator('#btn-market-nim').isVisible(), true);
  assert.ok(await page.locator('#btn-garage-done').isDisabled());
  await page.screenshot({ path: `${out}/garage-locked.png` });
  await page.click('#tab-fast');
  const framing = await page.evaluate(async () => {
    const { CARS } = await import('/src/cars.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const showroom = g.showroom, failures = [];
    const stage = document.getElementById('garage-car-stage').getBoundingClientRect();
    for (const spec of CARS) for (const angle of [0, 0.65, Math.PI / 2, Math.PI]) {
      showroom.setCar(spec); showroom.angle = angle; showroom.render(g.renderer, false, true);
      const b = showroom.bounds;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(showroom.camera);
        const sx = (p.x + 1) * innerWidth / 2, sy = (1 - p.y) * innerHeight / 2;
        if (sx < stage.left || sx > stage.right || sy < stage.top + 40 || sy > stage.bottom - 20) failures.push(`${spec.id}:${angle}`);
      }
    }
    return { cars: CARS.length, failures };
  });
  assert.deepEqual(framing.failures, []);
  // Reload restores the normal render loop and the selected car.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  await page.click('#btn-play'); await page.click('#btn-tour-done'); await page.click('#btn-garage-done');
  await page.waitForFunction(() => window.__game.state === 'racing');
  await page.waitForTimeout(700);
  const finish = await page.evaluate(() => {
    const g = window.__game;
    g.renderer.setAnimationLoop(null); g.clock.getDelta = () => 1 / 60;
    g.player.s = g.track.length - 30; g.player.x = 0; g.player.v = 38;
    g.player.syncMesh(0); g.scenery.update(g.track.length - 30);
    g.updateCamera(1); g.renderFrame(true);
    return { gantry: !!g.scenery.group.getObjectByName('finish-gantry'), stripe: !!g.scenery.group.getObjectByName('finish-road-stripe') };
  });
  assert.ok(finish.gantry && finish.stripe);
  await page.screenshot({ path: `${out}/finish-approach.png` });
  const crossing = await page.evaluate(() => {
    const g = window.__game;
    g.raceLaps = 2;
    g.player.s = g.track.length - 0.1; g.player.v = 40;
    g.tick();
    const intermediateLap = g.state === 'racing' && document.getElementById('finish-moment').classList.contains('hidden');
    g.raceLaps = 1;
    g.player.s = g.track.length - 0.1; g.player.v = 40; g.player.x = 0;
    g.raceTime = 42; g.tick();
    const coins = g.coins; g.finishRace();
    const singlePayout = coins === g.coins;
    const recorded = g.playerTime;
    for (let i = 0; i < 30; i++) g.tick();
    return { state: g.state, intermediateLap, singlePayout, visible: !document.getElementById('finish-moment').classList.contains('hidden'),
      timeUnchanged: g.playerTime === recorded && g.raceTime === recorded, fov: g.camera.fov,
      message: document.getElementById('finish-moment-result').textContent };
  });
  assert.equal(crossing.state, 'finished'); assert.ok(crossing.visible && crossing.timeUnchanged);
  assert.ok(crossing.intermediateLap && crossing.singlePayout);
  assert.equal(crossing.fov, 58);
  await page.screenshot({ path: `${out}/finish-camera.png` });
  const results = await page.evaluate(() => {
    const g = window.__game;
    for (let i = 0; i < 175; i++) g.tick();
    return { state: g.state, results: !document.getElementById('results').classList.contains('hidden'),
      finishHidden: document.getElementById('finish-moment').classList.contains('hidden') };
  });
  assert.equal(results.state, 'menu'); assert.ok(results.results && results.finishHidden);
  const busted = await page.evaluate(() => {
    const g = window.__game; g.state = 'racing'; g.busted = true; g.finishRace();
    return document.getElementById('finish-moment').classList.contains('hidden');
  });
  assert.ok(busted, 'A busted run must not show the finish celebration');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ framing, crossing, results, screenshots: out }, null, 2));
} finally { await browser.close(); }
