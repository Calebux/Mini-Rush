// Inspect the actual normalized garage models from the +Z (forward) corner.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
await mkdir('output/arena-review', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  await page.goto('http://127.0.0.1:5173/?q=0', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game?.state === 'menu');
  const result = await page.evaluate(async () => {
    window.__game.renderer.setAnimationLoop(null);
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { CARS } = await import('/src/cars.ts');
    const { AssetLibrary } = await import('/src/assets.ts');
    const assets = new AssetLibrary(); await assets.load();
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(330, 220); renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0xcbd6dc);
    scene.environment = window.__game.scene.environment;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa3a4ae, 2.8));
    const sun = new THREE.DirectionalLight(0xfff1db, 3); sun.position.set(4, 8, 5); scene.add(sun);
    const camera = new THREE.PerspectiveCamera(38, 1.5, 0.1, 100);
    camera.position.set(4.2, 2.9, 5.6); camera.lookAt(0, 0.6, 0);
    const pictures = [];
    for (const spec of CARS) {
      const car = assets.cloneCar(spec); car.getObjectByName('car-ground-fx').visible = false;
      scene.add(car); renderer.render(scene, camera);
      pictures.push({ id: spec.id, model: spec.model, image: renderer.domElement.toDataURL() });
      scene.remove(car);
    }
    return pictures;
  });
  await page.setContent(`<body style="margin:0;background:#e2e8ed;font:16px system-ui;display:grid;grid-template-columns:repeat(4,1fr);gap:4px">${result.map(p => `<div style="text-align:center"><img src="${p.image}" style="width:100%"><div>${p.id} · model ${p.model} · +Z corner</div></div>`).join('')}</body>`);
  await page.screenshot({ path: 'output/arena-review/garage-forward.png', fullPage: true });
  console.log('Garage forward contact sheet: output/arena-review/garage-forward.png');
} finally { await browser.close(); }
