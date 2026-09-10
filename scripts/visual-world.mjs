// Render deterministic driving views, check every district and measure draw calls.
// Usage: node scripts/visual-world.mjs [map ids...] --url=http://127.0.0.1:5173 --q=2
// --q forces a render quality tier (0 none / 1 phone / 2 desktop); default is 2 so
// captures are comparable run to run regardless of the machine taking them.
import { chromium } from 'playwright';
import { mkdir, readFile } from 'node:fs/promises';

const base = process.argv.find((a) => a.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5173';
const requested = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const tier = process.argv.find((a) => a.startsWith('--q='))?.slice(4) ?? '2';
const shots = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? 'output/arena-review';
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});
try {
  await page.goto(`${base}/?seed=7&map=lagos&len=1800&q=${tier}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  const batchTriangles = await page.evaluate(async () => {
    const { batchEnvironment, EnvironmentKit, environmentTheme } = await import('/src/environment.ts');
    const { MAPS } = await import('/src/maps.ts');
    const root = new EnvironmentKit(environmentTheme(MAPS[0])).lamp();
    root.children.forEach((mesh) => { mesh.material = Array(6).fill(mesh.material); });
    const merged = batchEnvironment(root);
    return merged.children.reduce((n, mesh) => n + mesh.geometry.attributes.position.count / 3, 0);
  });
  if (batchTriangles !== 36) errors.push(`Multi-material building faces lost: ${batchTriangles}/36 triangles`);
  const contact = await page.evaluate(async () => {
    const { syncCarGroundFx } = await import('/src/meshes.ts');
    const car = window.__game.player.mesh;
    car.position.y = 3;
    car.rotation.set(0.3, 0.8, 0.4);
    syncCarGroundFx(car);
    car.updateMatrixWorld(true);
    const fx = car.getObjectByName('car-ground-fx');
    const position = fx.getWorldPosition(car.position.clone());
    const normal = car.position.clone().set(0, 1, 0).applyQuaternion(fx.getWorldQuaternion(car.quaternion.clone()));
    return { y: position.y, normalY: normal.y };
  });
  if (Math.abs(contact.y) > 0.00001 || Math.abs(contact.normalY - 1) > 0.00001) {
    errors.push(`Airborne/leaning car footprint left the ground: ${JSON.stringify(contact)}`);
  }
  const headings = await page.evaluate(async () => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { Player } = await import('/src/player.ts');
    const { CARS } = await import('/src/cars.ts');
    const { RivalManager } = await import('/src/rivals.ts');
    const { TrafficManager } = await import('/src/traffic.ts');
    const g = window.__game, scene = new THREE.Scene(), failures = [];
    const check = (mesh, s, name) => {
      const a = g.track.frame(s), b = g.track.frame(s + 0.5);
      const tangent = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      if (forward.dot(tangent) < 0.99) failures.push(`${name} faces against travel at ${s}`);
    };
    for (const spec of CARS) {
      const player = new Player(scene, g.assets, g.track, spec);
      for (const s of [0, 65, g.track.length / 3, g.track.length - 1]) {
        player.reset({ s, x: 0 }); check(player.mesh, s, spec.id);
      }
      player.mesh.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material.isMeshToonMaterial) failures.push(`${spec.id} lost reflective materials`);
        }
      });
    }
    const rivals = new RivalManager(scene, g.assets, g.track, -1, 6);
    for (const rival of rivals.rivals) {
      rival.s = 65; rivals.sync(rival, 0); check(rival.mesh, rival.s, `rival-${rival.name}`);
    }
    const traffic = new TrafficManager(scene, g.assets, g.track, 7, 6);
    for (const s of [65, g.track.length - 15, g.track.length + 65]) {
      traffic.reset(s); traffic.update(0.016, s, g.track.length);
      for (const car of traffic.cars.filter(c => c.mesh.visible)) check(car.mesh, car.s, 'traffic');
    }
    return { garage: CARS.length, failures };
  });
  errors.push(...headings.failures);
  console.log('CAR HEADING / MATERIAL CHECKS:', JSON.stringify(headings));
  const maps = await page.evaluate(async () => (await import('/src/maps.ts')).MAPS.map((m) => m.id));
  for (const id of requested.length ? requested : maps) {
    await page.goto(`${base}/?seed=7&map=${id}&len=1800&q=${tier}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__game?.state === 'menu');
    await page.addStyleTag({ content: 'body > :not(#app):not(script):not(style) { display: none !important; }' });
    const frames = [];
    for (let district = 0; district < 3; district++) {
      const result = await page.evaluate(({ district }) => {
        const g = window.__game;
        g.renderer.setAnimationLoop(null);
        g.renderer.setPixelRatio(1.5);
        g.postfx?.setSize(window.innerWidth, window.innerHeight, 1.5);
        g.camera.clearViewOffset();
        const s = g.track.length * district / 3 + 65;
        g.player.s = s;
        g.player.x = 0;
        g.player.syncMesh(0);
        g.scenery.update(s);
        g.entities.update(0, 0, s);
        g.syncSky(g.track.frame(s).x, g.track.frame(s).z);
        const back = g.track.frame(s - 11), ahead = g.track.frame(s + 24);
        g.camera.position.set(back.x, 5.5, back.z);
        g.camera.lookAt(ahead.x, 1.5, ahead.z);
        g.camera.fov = 62;
        g.camera.updateProjectionMatrix();
        // The composer renders several passes and each one resets info, so hold
        // the counters open to get the whole frame rather than the last quad.
        g.renderer.info.autoReset = false;
        g.renderer.info.reset();
        g.renderFrame(true);
        g.renderer.info.autoReset = true;
        return { district, calls: g.renderer.info.render.calls, triangles: g.renderer.info.render.triangles,
          geometries: g.renderer.info.memory.geometries, textures: g.renderer.info.memory.textures };
      }, { district });
      await page.screenshot({ path: `${shots}/${id}-${district + 1}.png` });
      frames.push(result);
    }
    // Both sides of the start line must have roadside scenery in view.
    const wrapVisible = await page.evaluate(() => {
      const g = window.__game;
      return [-2, 2].map((s) => {
        g.scenery.update(g.track.wrap(s));
        return g.scenery.group.children.filter((c) => c.visible).length;
      });
    });
    if (wrapVisible.some((count) => count < 5)) errors.push(`${id}: missing scenery at lap seam`);
    const terrainIntrusions = await page.evaluate(async () => {
      const THREE = await import('/node_modules/three/build/three.module.js');
      const g = window.__game, terrain = g.scenery.group.getObjectByName(`terrain-${g.scenery.kit.theme.id}`);
      if (!terrain) return 0;
      terrain.updateMatrixWorld(true);
      const ray = new THREE.Raycaster(), up = new THREE.Vector3(0, 1, 0);
      let hits = 0;
      for (let s = 0; s < g.track.length; s += 8) for (const x of [-5, 0, 5]) {
        const f = g.track.frame(s);
        ray.set(new THREE.Vector3(f.x + f.nx * x, 0.1, f.z + f.nz * x), up);
        if (ray.intersectObject(terrain, true).length) hits++;
      }
      return hits;
    });
    if (terrainIntrusions) errors.push(`${id}: ${terrainIntrusions} terrain intrusions over road`);
    console.log(JSON.stringify({ map: id, tier, frames, wrapVisible }));
  }
  console.log('ERRORS:', JSON.stringify(errors));
  if (errors.length) process.exitCode = 1;
  if (!requested.length && tier === '2') {
    const gallery = [['lagos-1', 'LAGOS · LAGOON PROMENADE'], ['london-1', 'LONDON · BRICK TERRACES'],
      ['neon-1', 'NEON CITY · MIDNIGHT STRIP'], ['rio-2', 'RIO · COASTAL MOSAIC'],
      ['norway-1', 'NORWAY · MOUNTAIN VALLEY'], ['finland-1', 'FINLAND · SNOW FOREST']];
    const cards = await Promise.all(gallery.map(async ([file, title]) => {
      const data = await readFile(`${shots}/${file}.png`);
      return `<section><img src="data:image/png;base64,${data.toString('base64')}"><h2>${title}</h2></section>`;
    }));
    await page.setViewportSize({ width: 1440, height: 830 });
    await page.setContent(`<style>body{margin:0;padding:26px;background:#14232b;color:#e7eee9;font-family:system-ui}h1{font-size:24px;margin:0 0 6px}p{font-size:14px;margin:0 0 22px;color:#adbfca}main{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}section{background:#21343e;overflow:hidden;border-radius:8px}img{width:100%;display:block}h2{font-size:12px;letter-spacing:1.3px;margin:14px}</style><h1>ONE GAME. DIFFERENT PLACES.</h1><p>Actual in-engine captures · Same car, seed and driving camera · Desktop quality</p><main>${cards.join('')}</main>`);
    await page.locator('body').screenshot({ path: `${shots}/worlds-preview.png` });
  }
} finally {
  await browser.close();
}
