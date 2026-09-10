// Local browser integration check and actual in-engine screenshots.
// Usage: node scripts/check-danfo.mjs [dev server URL]
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const out = 'output/danfo-review';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
try {
  await page.goto(`${base}/?map=lagos&seed=7&q=1`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  const result = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { TrafficManager } = await import('/src/traffic.ts');
    const { buildDanfo } = await import('/src/danfo.ts');
    const { disposeCarInstance } = await import('/src/assets.ts');
    const g = window.__game;
    g.renderer.setAnimationLoop(null);
    const scene = new THREE.Scene();
    const traffic = new TrafficManager(scene, g.assets, g.track, 7, 10, -1, 'lagos');
    const other = new TrafficManager(scene, g.assets, g.track, 7, 10, -1, 'london');
    const failures = [];
    for (const s of [0, g.track.length - 15, g.track.length + 65, g.track.length * 4]) {
      traffic.reset(s); other.reset(s);
      if (traffic.cars.some((c, i) => c.s !== other.cars[i].s || c.x !== other.cars[i].x)) {
        failures.push('City vehicle selection changed seeded traffic spacing');
      }
      traffic.update(0.016, s, g.track.length);
      other.update(0.016, s, g.track.length);
      const visible = traffic.cars.filter(c => c.mesh.visible);
      if (!visible.some(c => c.mesh.userData.trafficKind === 'danfo')) failures.push(`No visible danfo at ${s}`);
      for (const car of visible) {
        const a = g.track.frame(car.s), b = g.track.frame(car.s + 0.5);
        const tangent = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(car.mesh.quaternion);
        if (forward.dot(tangent) < 0.99) failures.push('Traffic faces against travel');
      }
    }
    const bus = traffic.cars[0];
    traffic.hit(bus, 1); traffic.update(0.1, bus.s - 25, g.track.length);
    if (!(bus.wrecked > 0 && bus.nearMissed)) failures.push('Danfo hit response failed');
    traffic.reset(0);
    if (bus.wrecked || bus.nearMissed) failures.push('Danfo did not reset');
    const clone = buildDanfo();
    const body = clone.clone(true);
    body.remove(body.getObjectByName('car-ground-fx'));
    const bounds = new THREE.Box3().setFromObject(body);
    const count = traffic.cars.length;
    const danfos = traffic.cars.filter(c => c.mesh.userData.trafficKind === 'danfo').length;
    const others = other.cars.filter(c => c.mesh.userData.trafficKind === 'danfo').length;
    let sharedDisposed = false, shadowDisposed = false;
    clone.children[0].geometry.addEventListener('dispose', () => { sharedDisposed = true; });
    bus.mesh.getObjectByName('car-ground-fx').children[0].geometry.addEventListener('dispose', () => { shadowDisposed = true; });
    traffic.dispose(scene); other.dispose(scene); disposeCarInstance(clone);
    return { count, danfos, others, failures, size: bounds.getSize(new THREE.Vector3()).toArray(),
      ground: bounds.min.y, drawCalls: body.children.length, sharedDisposed, shadowDisposed,
      remaining: scene.children.length,
      gameDanfos: g.traffic.cars.filter(c => c.mesh.userData.trafficKind === 'danfo').length };
  });
  assert.equal(result.count, 10);
  assert.equal(result.danfos, 4);
  assert.equal(result.gameDanfos, 4);
  assert.equal(result.others, 0);
  assert.deepEqual(result.failures, []);
  assert.ok(result.size[0] < 2.2 && result.size[2] < 4.5);
  assert.ok(Math.abs(result.ground) < 0.001);
  assert.equal(result.drawCalls, 7);
  assert.equal(result.sharedDisposed, false);
  assert.equal(result.shadowDisposed, true);
  assert.equal(result.remaining, 0);

  await page.addStyleTag({ content: 'body > :not(#app):not(script):not(style) { display: none !important; }' });
  for (const front of [false, true]) {
    await page.evaluate(front => {
      const g = window.__game, s = 65;
      g.player.s = s; g.player.x = -2; g.player.syncMesh(0);
      g.scenery.update(s); g.entities.update(0, 0, s);
      g.rivals.rivals.forEach(r => { r.mesh.visible = false; });
      g.traffic.reset(s);
      const bus = g.traffic.cars[0];
      bus.s = s + 9; bus.x = 1.15;
      g.traffic.update(0, s, g.track.length);
      const f = g.track.frame(bus.s), camera = g.track.frame(bus.s + (front ? 7 : -10));
      g.syncSky(f.x, f.z);
      g.camera.position.set(camera.x - f.nx * 5, front ? 3.4 : 4.2, camera.z - f.nz * 5);
      g.camera.lookAt(bus.mesh.position.x, 1.1, bus.mesh.position.z);
      g.camera.clearViewOffset(); g.camera.fov = front ? 48 : 60; g.camera.updateProjectionMatrix();
      g.renderFrame(true);
    }, front);
    await page.screenshot({ path: `${out}/${front ? 'danfo-front' : 'lagos-traffic'}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
  console.log(`Browser checks passed. Screenshots: ${out}`);
} finally {
  await browser.close();
}
