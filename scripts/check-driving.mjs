// Behavior regressions for traffic fairness and work avoided on mobile.
// Usage: node scripts/check-driving.mjs [dev server URL]
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
try {
  await page.goto(`${process.argv[2] ?? 'http://127.0.0.1:5173'}/?map=lagos&seed=7&len=600&q=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  const result = await page.evaluate(async () => {
    const { TrafficManager } = await import('/src/traffic.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const g = window.__game, failures = [], passed = [];
    const check = (ok, label) => (ok ? passed : failures).push(label);
    g.renderer.setAnimationLoop(null);

    const scene = new THREE.Scene();
    const traffic = new TrafficManager(scene, g.assets, g.track, 7, 10, -1, 'lagos');
    traffic.reset(0);
    check(traffic.cars.every((c, i, cars) => !i || Math.abs(c.lane - cars[i - 1].lane) >= 2), 'Spawn rows leave a lane gap');
    const furthest = Math.max(...traffic.cars.map(c => c.s));
    for (let i = 0; i < 300; i++) traffic.update(1 / 60, 0, g.track.length);
    check(Math.max(...traffic.cars.map(c => c.s)) < furthest + 120, 'Waiting traffic does not run away down the spawn queue');
    let seenSecondLap = false, seenThirdLap = false, lastS = 0;
    for (let i = 0; i < 1800; i++) {
      lastS += 42 / 30;
      traffic.update(1 / 30, lastS, g.track.length, 42);
      if (traffic.cars.some(c => c.mesh.visible && c.s - lastS > 0 && c.s - lastS < 60)) {
        if (lastS > g.track.length && lastS < g.track.length * 2) seenSecondLap = true;
        if (lastS > g.track.length * 2) seenThirdLap = true;
      }
    }
    check(seenSecondLap && seenThirdLap, 'Traffic remains reachable over continuous laps');
    check(traffic.cars.length === 10, 'Traffic pool remains bounded');
    const bus = traffic.cars[0];
    bus.s = lastS + 12; bus.lane = bus.targetLane = 1; bus.x = -1.15; bus.laneTimer = 0;
    traffic.rand = () => 0.9; // requests the next lane when eligible
    traffic.update(1 / 30, lastS, g.track.length, 62);
    check(bus.targetLane === 1, 'No late lane change in front of an approaching player');
    traffic.cars.slice(1).forEach(c => { c.s = lastS + 300; });
    bus.s = lastS + 130; bus.laneTimer = 0;
    const blocker = traffic.cars[1];
    blocker.s = bus.s + 6; blocker.x = 1.15; blocker.lane = blocker.targetLane = 2;
    traffic.update(1 / 30, lastS, g.track.length, 42);
    check(bus.targetLane === 1, 'No lane change into occupied traffic');
    blocker.s = lastS + 300; bus.laneTimer = 0;
    traffic.update(1 / 30, lastS, g.track.length, 42);
    check(bus.targetLane === 2, 'Traffic can change lanes when there is room');
    bus.x = 1.14; traffic.update(0.2, lastS, g.track.length, 42);
    check(bus.x === 1.15 && bus.lane === 2, 'Lane changes settle without overshooting');
    traffic.dispose(scene);

    // Exercise the actual race contact path with a bus straddling the lap seam.
    g.state = 'racing';
    const p = g.player, car = g.traffic.cars[0];
    const setup = (x = 0, speed = 34) => {
      g.rivals.rivals.forEach(r => { r.s = -100; });
      g.traffic.cars.forEach(c => { c.mesh.visible = false; });
      p.reset({ s: g.track.length + 5, x }); p.v = speed;
      car.s = p.s + 1; car.x = 0; car.v = 17;
      car.mesh.visible = true; car.wrecked = 0; car.nearMissed = false; car.closestPass = Infinity;
      g.style.reset(); g.trafficHits = 0; g.driftChain = 0;
    };
    setup(); g.updateStyle(0, 1);
    check(g.trafficHits === 1 && car.wrecked > 0, 'Visible traffic collides on lap two');
    check(Math.abs(p.v - 34 * 0.88) < 0.001 && p.damage === 0, 'Gentle clip preserves more speed and causes no damage');
    setup(0, 62); g.updateStyle(0, 1);
    check(p.damage === 1 && Math.abs(p.v - 62 * 0.72) < 0.001, 'Hard collision still damages and slows the player');
    setup(2.1, 40); g.updateStyle(0, 1);
    check(g.style.score === 0, 'Near miss does not pay before the pass is complete');
    car.s = p.s - car.contactLength - 0.1; g.updateStyle(0, 1);
    check(g.style.score === 30, 'Clean completed pass earns a near miss');
    for (let i = 0; i < 30; i++) g.updateStyle(0, 1);
    check(g.style.score === 30, 'One near-miss reward per vehicle pass');
    setup(0, 40); p.bumpCooldown = 1; g.updateStyle(0, 1);
    p.x = 2.1; car.s = p.s - 5; g.updateStyle(0, 1);
    check(g.style.score === 0, 'Clipping during bump cooldown is not a clean pass');
    setup(2.1, 40); p.airH = 2; g.updateStyle(0, 1);
    p.airH = 0; car.s = p.s - 5; g.updateStyle(0, 1);
    check(g.style.score === 0, 'Jumping over traffic does not count as a near miss');

    const args = [2, 4, 12.34, 5, 3, 2, false, 35, 1, 2, [0.25, 0.26, 0.2, 0.3], 2, 0.4];
    g.ui.updateHud(...args);
    const observer = new MutationObserver(() => {});
    observer.observe(document.getElementById('hud'), { subtree: true, childList: true, attributes: true, characterData: true });
    for (let i = 0; i < 120; i++) g.ui.updateHud(...args);
    const idleHudMutations = observer.takeRecords().length;
    observer.disconnect();
    check(idleHudMutations === 0, 'Unchanged HUD produces no DOM mutations');
    args[0] = 1; args[1] = 8; args[3] = 9; args[5] = 0; args[6] = true;
    g.ui.updateHud(...args);
    check(document.getElementById('hud-pos').textContent === 'P1/8' &&
      document.getElementById('hud-coins').textContent === '⬤ 9' &&
      document.getElementById('nitro-ui').classList.contains('burning'), 'HUD still reflects race changes immediately');

    let hiddenWorldUpdates = 0;
    g.renderFrame = () => {};
    for (const manager of [g.traffic, g.entities, g.scenery, g.player, g.rivals]) {
      manager.update = () => { hiddenWorldUpdates++; };
    }
    g.clock.getDelta = () => 1 / 60;
    g.state = 'menu'; g.uiScene = 'menu';
    for (let i = 0; i < 120; i++) g.tick();
    g.uiScene = 'workshop';
    for (let i = 0; i < 120; i++) g.tick();
    check(hiddenWorldUpdates === 0, 'Home and workshop skip hidden race simulation');
    g.state = 'racing'; g.paused = true; g.cine.t = 0.8; g.cine.flash = 0.6;
    g.dprCooldown = 1.5;
    for (let i = 0; i < 120; i++) g.tick();
    check(g.cine.t === 0.8 && g.cine.flash === 0.6 && g.dprCooldown === 1.5, 'Pause freezes cinematics and graphics adaptation');
    g.paused = false; g.curDpr = 1.5; g.dprCap = 2; g.frameEma = 1 / 30;
    for (let i = 0; i < 46; i++) g.adaptResolution(1 / 30);
    check(g.curDpr === 1.25, 'Slow device receives a resolution reduction after 1.5 seconds');
    return { passed, failures, idleHudMutations, hiddenWorldUpdates };
  });
  console.log(JSON.stringify(result, null, 2));
  assert.deepEqual(result.failures, []);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
