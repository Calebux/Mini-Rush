import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { districtIndexAt, ROAD_HALF_WIDTH, SHARP_CORNER_K } from './constants';
import { Flavor, MapSpec } from './maps';
import { batchEnvironment, EnvironmentKit, environmentTheme, isRural } from './environment';
import { buildRoadside } from './roadside';
import { localBuilding, localLandmark } from './architecture';
import {
  buildArcadeArch, buildBeachUmbrella, buildFinishArch, buildHoloSign, buildLanternPole,
  buildLaunchRamp, buildPalm, buildPhoneBox, mulberry32
} from './meshes';
import { toonify, toonMat } from './toon';
import { Track } from './track';
import { bakedPath } from './trackPaths';
import { dressLagosCoast } from './coast';

interface Placed {
  s: number;
  obj: THREE.Object3D;
}

/**
 * Keeps a circular show/hide window over scenery placed at race start.
 */
export class VisibilityWindow {
  constructor(private items: Placed[], private behind = 60, private ahead = 220,
    private length = Infinity) {
    for (const it of items) it.obj.visible = false;
  }

  /** Circular distance keeps the next sector visible across the finish line. */
  update(playerS: number): void {
    for (const item of this.items) {
      let delta = item.s - playerS;
      if (Number.isFinite(this.length)) {
        delta = ((delta + this.behind) % this.length + this.length) % this.length - this.behind;
      }
      item.obj.visible = delta >= -this.behind && delta <= this.ahead;
    }
  }
}

/** Red corner-warning board with white chevrons; arrowDir −1 = ›››, +1 = ‹‹‹. */
function buildChevronBoard(arrowDir: number): THREE.Group {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 48;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d9352b';
  ctx.fillRect(0, 0, 128, 48);
  ctx.strokeStyle = '#f2f2f2';
  ctx.lineWidth = 9;
  ctx.lineJoin = 'miter';
  for (let i = 0; i < 3; i++) {
    const cx = 26 + i * 38;
    ctx.beginPath();
    ctx.moveTo(cx - 9 * arrowDir, 8);
    ctx.lineTo(cx + 9 * arrowDir, 24);
    ctx.lineTo(cx - 9 * arrowDir, 40);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;

  const g = new THREE.Group();
  // unlit + fog-free so the warning reads from far out in murky maps
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 1.0),
    new THREE.MeshBasicMaterial({ map: tex, fog: false, side: THREE.DoubleSide })
  );
  board.position.y = 1.15;
  g.add(board);
  for (const px of [-1.1, 1.1]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.7, 0.09),
      new THREE.MeshBasicMaterial({ color: 0x2a2d35 })
    );
    leg.position.set(px, 0.33, 0);
    g.add(leg);
  }
  return g;
}

/** Buildings, lamps, cacti and the finish arch along the whole track. */
export class Scenery {
  readonly group = new THREE.Group();
  readonly rampS: number[] = []; // lap positions of launch ramps, for jump detection
  private window: VisibilityWindow;
  private roadMat: THREE.MeshStandardMaterial;
  private kit: EnvironmentKit;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private track: Track,
    seed: number,
    map: MapSpec
  ) {
    const rand = mulberry32(seed ^ 0x5eed);
    this.kit = new EnvironmentKit(environmentTheme(map));
    const kit = this.kit, theme = kit.theme;
    const building = (tall = false) => localBuilding(map.id, kit, rand, tall);
    const items: Placed[] = [];
    const flavorAt = (s: number): Flavor =>
      map.districts[districtIndexAt(s, track.length)].flavor;

    const roadStyle = map.id === 'lagos' ? 'coast' : theme.landscape === 'stadium' ? 'circuit' :
      map.id === 'finland' || map.id === 'iceland' ? 'snow' :
      theme.landscape === 'city' ? 'city' : 'rally';
    const road = track.buildRoadMesh(roadStyle);
    this.roadMat = road.material as THREE.MeshStandardMaterial;
    this.roadMat.color.setHex(theme.night ? 0x9ca9bd : 0xebe7dc);
    road.receiveShadow = true;
    this.group.add(road);
    if (map.circuit) this.loadCircuitModel(map.circuit);
    const roadside = buildRoadside(track, map, kit);
    this.group.add(roadside);
    const outward = roadside.userData.outward as number;
    this.group.userData.shoreSide = outward;
    const sectors = new Map<number, THREE.Group>();
    const addStatic = (obj: THREE.Object3D, s: number) => {
      const index = Math.floor(s / 60);
      let sector = sectors.get(index);
      if (!sector) { sector = new THREE.Group(); sectors.set(index, sector); }
      sector.add(obj);
    };
    // Check the whole route before dressing tight return legs; no building may
    // intrude into a different section of road just because its own offset is safe.
    const route = track.outline(2);
    const clearOfRoad = (obj: THREE.Object3D, radius: number) =>
      route.every((p) => Math.hypot(p.x - obj.position.x, p.z - obj.position.z) > 6 + radius);

    for (const side of [-1, 1]) {
      let s = map.id === 'lagos' ? track.length * 2 / 3 + 10 : 14;
      while (s < track.length - 10) {
        let obj: THREE.Object3D;
        let dist = 14.6;
        let gap = 10.5 + rand() * 2;
        const flavor = flavorAt(s);
        const shore = theme.coast && side === outward &&
          (s < track.length * 2 / 3 || map.id === 'newzealand');

        switch (flavor) {
          case 'towers': {
            obj = building();
            break;
          }
          case 'palms':
            if (rand() < 0.55) {
              obj = buildPalm(rand);
              dist = 8.7;
              gap = 10 + rand() * 10;
            } else {
              obj = building();
              dist = 14.6;
            }
            break;
          case 'pagoda':
            obj = kit.pagodaHouse(rand);
            dist = 14;
            break;
          case 'park':
            obj = kit.tree(rand);
            dist = 10 + rand() * 7;
            gap = 11 + rand() * 6;
            break;
          case 'terrace':
            if (rand() < 0.88) {
              obj = building();
              dist = 14.6;
              gap = 13 + rand() * 8; // row houses sit shoulder to shoulder
            } else {
              obj = buildPhoneBox();
              dist = 9;
            }
            break;
          case 'market':
            if (rand() < 0.7) {
              obj = kit.stall(rand);
              dist = 10;
              gap = 10 + rand() * 8;
            } else {
              obj = building();
              dist = 14.6;
            }
            break;
          case 'pyramids':
            if (rand() < 0.65) {
              obj = kit.pyramid(rand);
              dist = ROAD_HALF_WIDTH + 14 + rand() * 15;
              gap = 35 + rand() * 30;
            } else {
              obj = kit.obelisk();
              dist = ROAD_HALF_WIDTH + 6 + rand() * 8;
              gap = 20 + rand() * 15;
            }
            break;
          case 'favela':
            if (rand() < 0.8) {
              obj = kit.favelaHouse(rand);
              dist = 13;
              gap = 12 + rand() * 8;
            } else {
              obj = buildBeachUmbrella(rand);
              dist = ROAD_HALF_WIDTH + 2.5 + rand() * 3;
              gap = 10 + rand() * 6;
            }
            break;
          case 'cyberarcade':
            if (rand() < 0.75) {
              obj = buildHoloSign(rand);
              dist = ROAD_HALF_WIDTH + 5 + rand() * 6;
              gap = 15 + rand() * 10;
            } else {
              obj = building(true);
              dist = 14.6;
              gap = 18 + rand() * 12;
            }
            break;
          case 'conifers':
            obj = map.id === 'canada' && rand() < 0.4 ? kit.tree(rand, true) : kit.pine(rand);
            dist = 10 + rand() * 7; gap = 7 + rand() * 5;
            break;
          case 'rocks':
            obj = kit.rock(rand, map.id === 'iceland'); dist = 16 + rand() * 8; gap = 16 + rand() * 12;
            break;
          case 'cabins':
            obj = rand() < 0.45 ? kit.cabin(rand) : kit.pine(rand);
            dist = 14 + rand() * 5; gap = 17 + rand() * 10;
            break;
          case 'grandstand':
            obj = kit.grandstand(); dist = 16; gap = 25;
            break;
        }

        if (shore) {
          obj = map.id === 'newzealand' ? kit.rock(rand) : buildPalm(rand);
          dist = map.id === 'newzealand' ? 16 : 9;
          gap = 19;
          if (map.id !== 'newzealand') {
            const bed = kit.planter(rand, true);
            obj.position.y = 0.4;
            bed.add(obj);
            obj = bed;
          }
        }
        // Break the loop the eye finds otherwise: jitter the setback, skew the
        // frontage off dead-square, and occasionally leave a gap. Placement on a
        // fixed offset at a fixed angle every fixed metre is what made the
        // street read as one building repeated.
        const setback = dist + (rand() - 0.5) * (isRural(flavor) ? 6 : 3.4);
        track.place(obj, s, side * setback, isRural(flavor) ? 0 : 0.2);
        obj.rotation.y += (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rand() - 0.5) * 0.16;
        if (rand() > 0.12 && clearOfRoad(obj, setback > 12 ? 5 : 1.3)) addStatic(obj, s);
        if (!shore && s % 45 < 20) {
          // Deserts and mountains fill their back row with stone; a conifer behind
          // the Giza ruins was the one plant that gave the kit away.
          const stony = theme.landscape === 'mountains' || theme.landscape === 'desert';
          const back = isRural(flavor)
            ? stony ? kit.rock(rand, map.id === 'iceland') :
              theme.landscape === 'city' ? kit.tree(rand) : kit.pine(rand)
            : building(flavor === 'towers' || flavor === 'cyberarcade');
          track.place(back, s + 4 + rand() * 6, side * (26 + rand() * 12));
          back.rotation.y += (side > 0 ? Math.PI / 2 : -Math.PI / 2) + (rand() - 0.5) * 0.5;
          if (clearOfRoad(back, 7)) addStatic(back, s);
        }
        if (!isRural(flavor) && s % 40 < 19 && flavor !== 'grandstand') {
          const planter = kit.planter(rand);
          if (!shore && theme.coast && flavor !== 'market') {
            const palm = buildPalm(rand); palm.scale.setScalar(0.8); palm.position.y = 0.4;
            planter.add(palm);
          }
          track.place(planter, s + 4 + rand() * 3, side * (8.4 + rand() * 0.7), 0.2);
          if (clearOfRoad(planter, 1.4)) addStatic(planter, s);
        }
        s += gap;
      }
    }

    if (map.id === 'lagos') dressLagosCoast(track, kit, outward, addStatic, seed);

    // A place needs a signature silhouette, not just a different facade colour.
    // Keep landmarks off the road, including all neighbouring return legs.
    for (let district = 0; district < 3; district++) {
      if (map.id === 'lagos' && district !== 0) continue;
      const s = district * track.length / 3 + 135;
      const landmark = localLandmark(map.id, kit);
      if (!landmark) continue;
      const side = theme.coast ? (map.id === 'lagos' ? outward : -outward) : district % 2 ? -1 : 1;
      track.place(landmark, s, side * (map.id === 'cairo' ? 44 : theme.coast ? 31 : 30));
      landmark.rotation.y += side > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (clearOfRoad(landmark, map.id === 'cairo' ? 23 : 12)) addStatic(landmark, s);
    }

    if (map.id === 'neon') {
      for (let s = 95; s < track.length; s += 115) {
        const portal = new THREE.Group();
        for (const side of [-1, 1]) {
          kit.box(portal, side * 7.2, 4.5, 0, 0.5, 9, 0.6, 0x4a6376);
          kit.box(portal, side * 6.9, 4.5, -0.05, 0.12, 8.6, 0.2, 0x44dacc, true);
        }
        kit.box(portal, 0, 9, 0, 15, 0.65, 0.7, 0x4a6376);
        kit.box(portal, 0, 8.7, -0.38, 13.6, 0.12, 0.1, 0xef61ae, true);
        track.place(portal, s, 0); addStatic(portal, s);
      }
    }

    // streetlights in the built-up districts; red lantern poles in the hutongs
    for (let s = 15, side = 1; s < track.length; s += 30, side = -side) {
      if (map.id === 'lagos' && s < track.length * 2 / 3) continue;
      const flavor = flavorAt(s);
      if (isRural(flavor)) continue;
      const lamp = flavor === 'pagoda'
        ? buildLanternPole()
        : flavor === 'cyberarcade'
        ? buildArcadeArch()
        : kit.lamp();
      this.track.place(lamp, s, side * 8.8, 0.2);
      lamp.rotation.y += side > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (clearOfRoad(lamp, 0.5)) addStatic(lamp, s);
    }

    // launch ramps along long straightaways (jump over traffic or catch air)
    for (let rs = 220; rs < track.length - 150; rs += 450 + rand() * 250) {
      if (Math.abs(track.frame(rs).curvature) < 0.005) {
        const ramp = buildLaunchRamp();
        track.place(ramp, rs, 0); // centered in the lane
        this.group.add(ramp);
        items.push({ s: rs, obj: ramp });
        this.rampS.push(rs);
      }
    }

    // red/white racing barriers through downtown — street-circuit dressing
    const barrierMats = [toonMat(0xd9352b), toonMat(0xe8e8e8)];
    const barrierGeo = new THREE.BoxGeometry(0.28, 0.55, 2.4);
    for (let s = 4; s < track.length - 4; s += 9) {
      if (map.id === 'lagos' && s < track.length * 2 / 3) continue;
      if (!['towers', 'grandstand', 'cyberarcade'].includes(flavorAt(s))) continue;
      for (const side of [-1, 1]) {
        const b = new THREE.Mesh(barrierGeo, barrierMats[Math.floor(s / 9) % 2]);
        b.position.y = 0.28;
        const holder = new THREE.Group();
        holder.add(b);
        track.place(holder, s, side * (ROAD_HALF_WIDTH + 0.95));
        addStatic(holder, s);
      }
    }

    // chevron boards before sharp bends — the visible "brake now" telegraph.
    // Boards sit on the OUTSIDE of the coming corner (where overspeed sends
    // you), arrows pointing into the turn.
    let cs = 0;
    while (cs < track.length) {
      const k = track.frame(cs).curvature;
      if (Math.abs(k) > SHARP_CORNER_K) {
        const outside = Math.sign(k); // corner force pushes toward +x when k > 0
        for (const back of [16, 28, 40]) {
          const bs = cs - back;
          if (bs < 10) continue;
          const board = buildChevronBoard(outside);
          track.place(board, bs, outside * (ROAD_HALF_WIDTH + 1.7));
          this.group.add(board);
          items.push({ s: bs, obj: board });
        }
        // one warning set per corner: skip to where the bend eases off
        while (cs < track.length && Math.abs(track.frame(cs).curvature) > SHARP_CORNER_K * 0.6) {
          cs += 6;
        }
      }
      cs += 6;
    }

    // start/finish arch on the line (s = 0 on a closed circuit)
    const arch = buildFinishArch(ROAD_HALF_WIDTH * 2 + 3);
    track.place(arch, 0, 0);
    this.group.add(arch);
    items.push({ s: 0, obj: arch });

    // Merge only generated scenery. Shared car/asset-library resources stay owned
    // by the library; the sector meshes and their materials belong to this race.
    const sourceGeometries = new Set<THREE.BufferGeometry>();
    for (const [index, sector] of sectors) {
      sector.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) sourceGeometries.add(mesh.geometry);
      });
      const batch = batchEnvironment(sector, theme.night ? 0.45 : 1);
      this.group.add(batch);
      items.push({ s: index * 60 + 30, obj: batch });
    }
    for (const geometry of sourceGeometries) geometry.dispose();
    items.sort((a, b) => a.s - b.s);
    this.window = new VisibilityWindow(items, 90, 260, track.length);
    scene.add(this.group);
  }

  update(playerS: number): void {
    this.window.update(playerS);
  }

  dispose(scene: THREE.Scene): void {
    this.disposed = true;
    scene.remove(this.group);
    const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      geometries.add(mesh.geometry);
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(m);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) {
      const texture = (m as THREE.MeshToonMaterial).map;
      // The road's repeat texture is cached across races.
      if (texture instanceof THREE.CanvasTexture && m !== this.roadMat) texture.dispose();
      if (m !== this.roadMat) (m as THREE.MeshStandardMaterial).bumpMap?.dispose();
      m.dispose();
    }
    this.kit.dispose();
  }

  /**
   * Drop the imported circuit's own geometry into the world. The bake recorded
   * the model-space centre and road height of the lap, and Track worked out the
   * one scale factor that maps model units to metres — so placement is exact
   * arithmetic, not a bounding-box guess. The model keeps its own materials;
   * toonify() only restyles them into the game's cel shading.
   */
  private loadCircuitModel(circuit: { model: string; path: string }): void {
    const baked = bakedPath(circuit.path);
    if (!baked) return; // no path baked = no way to align it; skip the shell
    const scale = this.track.modelScale;
    const file = `${import.meta.env.BASE_URL}assets/models/imported/${circuit.model}.glb`;

    new GLTFLoader().load(
      file,
      (gltf) => {
        if (this.disposed) return;
        const model = gltf.scene;
        toonify(model);
        model.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.frustumCulled = false; // one circuit spans the whole map
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        });
        model.scale.setScalar(scale);
        model.position.set(
          -baked.center[0] * scale,
          // Sit the tarmac fractionally under the painted ribbon so the two
          // surfaces never z-fight along the racing line.
          -baked.roadY * scale - 0.03,
          -baked.center[1] * scale
        );
        this.group.add(model);
      },
      undefined,
      () => { /* imported shells fail soft; the baked route stays drivable */ }
    );
  }
}
