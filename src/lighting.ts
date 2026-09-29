import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { EnvironmentTheme } from './environment';

/**
 * Image-based lighting: what glossy things reflect.
 *
 * A car only looks like a car when its paint has something to mirror — a
 * bright sky and a sun by day, rows of lamps and neon at night. The old
 * reflection was a 64 px gradient cube, so clear-coat paint had nothing in
 * it and read as plastic. Here a small scene of light sources is built per
 * map and pre-filtered once (PMREM) into the blurred mip chain the physical
 * materials sample. No downloaded HDRI: it is generated, so it matches each
 * map's palette and costs a few milliseconds when a race is built.
 */

const cache = new Map<string, THREE.Texture>();

/** HDR emissive material: `strength` above 1 is brighter than white. */
const light = (color: number, strength: number) =>
  new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength),
    side: THREE.DoubleSide, toneMapped: false });

/** A panel of light at a bearing (radians), elevation (radians) and distance. */
function panel(scene: THREE.Scene, material: THREE.Material, w: number, h: number,
  bearing: number, elevation: number, dist = 40): void {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(Math.sin(bearing) * Math.cos(elevation) * dist, Math.sin(elevation) * dist,
    Math.cos(bearing) * Math.cos(elevation) * dist);
  mesh.lookAt(0, 0, 0);
  scene.add(mesh);
}

/** Sky dome: overhead colour down to the horizon, then the ground below it. */
function dome(scene: THREE.Scene, top: number, horizon: number, ground: number, strength: number): void {
  const geo = new THREE.SphereGeometry(60, 32, 16);
  const pos = geo.getAttribute('position');
  const colors: number[] = [];
  const t = new THREE.Color(top), h = new THREE.Color(horizon), g = new THREE.Color(ground);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 60;
    const c = y > 0 ? h.clone().lerp(t, Math.pow(y, 0.6)) : h.clone().lerp(g, Math.min(1, -y * 4));
    c.multiplyScalar(strength);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide,
    toneMapped: false })));
}

function dayScene(theme: EnvironmentTheme): THREE.Scene {
  const scene = new THREE.Scene();
  dome(scene, theme.sky, theme.horizon, theme.ground, 1.1);
  // the sun, and the bright sky round it, is the highlight a car's roof catches
  panel(scene, light(0xfff1d6, 30), 5, 5, -0.9, 0.75);
  panel(scene, light(0xfff4e4, 2.2), 26, 14, -0.9, 0.6);
  // a few soft cloud banks: long gentle streaks along the doors
  for (let i = 0; i < 6; i++) {
    panel(scene, light(0xffffff, 1.4 + (i % 3) * 0.4), 20, 5, i * 1.05 + 0.4, 0.18 + (i % 2) * 0.12);
  }
  return scene;
}

function nightScene(theme: EnvironmentTheme): THREE.Scene {
  const scene = new THREE.Scene();
  dome(scene, theme.sky, theme.horizon, theme.ground, 0.9);
  // streetlamps: a ring of warm-white points just above the horizon, which
  // stream along the body as it passes under them
  for (let i = 0; i < 14; i++) {
    panel(scene, light(0xffe2b8, 9), 1.6, 1.6, (i / 14) * Math.PI * 2, 0.22, 34);
  }
  // the city's signs: tall and wide bars in its own neon colours
  const signs = theme.windows ?? [theme.accent];
  for (let i = 0; i < 22; i++) {
    const tall = i % 3 !== 0;
    panel(scene, light(signs[i % signs.length], theme.neon ? 6 : 3), tall ? 1.4 : 6, tall ? 7 : 1.6,
      (i / 22) * Math.PI * 2 + 0.13, 0.08 + (i % 4) * 0.07, 36);
  }
  // a cool moon-and-cloud glow overhead, so the roof is not black
  panel(scene, light(0x8fa3d8, 1.4), 40, 40, 0, 1.4, 42);
  return scene;
}

/**
 * The environment for a map: generated once per theme and kept, so a retry or
 * a return to the same city costs nothing.
 */
/** How hard cars reflect a map's environment: a noon sky would bleach the paint. */
export const carReflection = (theme: EnvironmentTheme): number => (theme.night ? 1.15 : 0.62);

export function mapEnvironment(renderer: THREE.WebGLRenderer, theme: EnvironmentTheme): THREE.Texture {
  const key = theme.id;
  const hit = cache.get(key);
  if (hit) return hit;
  const scene = theme.night ? nightScene(theme) : dayScene(theme);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(scene, 0.02).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  });
  cache.set(key, texture);
  return texture;
}

/**
 * Point every car surface under `root` at `env`. Only cars: the world keeps
 * its own, dimmer reflection, so a brighter sky here doesn't relight the
 * streets. Car materials are shared between clones, so a car cloned later in
 * the race inherits this too.
 */
export function lightCars(root: THREE.Object3D, env: THREE.Texture, strength = 1): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const surface = m.userData.carSurface as number | undefined;
      if (surface === undefined) continue;
      const std = m as THREE.MeshStandardMaterial;
      if (std.envMap !== env) {
        std.envMap = env;
        std.needsUpdate = true;
      }
      std.envMapIntensity = surface * strength;
    }
  });
}

let studio: THREE.Texture | null = null;

/** The garage: a photo studio's softboxes, the classic way to show off paint. */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (studio) return studio;
  const pmrem = new THREE.PMREMGenerator(renderer);
  studio = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  pmrem.dispose();
  return studio;
}
