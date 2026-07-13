import * as THREE from 'three';
import { AssetLibrary } from './assets';
import { districtIndexAt, ROAD_HALF_WIDTH, SHARP_CORNER_K } from './constants';
import { Flavor, MapSpec } from './maps';
import {
  buildCityBuilding, buildColorfulBuilding, buildFinishArch, buildLanternPole,
  buildPagodaHouse, buildPalm, buildPhoneBox, buildStall, buildStreetlight,
  buildTerraceHouse, buildTree, mulberry32
} from './meshes';
import { toonMat } from './toon';
import { Track } from './track';

interface Placed {
  s: number;
  obj: THREE.Object3D;
}

/**
 * Keeps a sliding show/hide window over a list of objects sorted by track
 * position — everything is placed once at race start, then only toggled.
 */
export class VisibilityWindow {
  private lo = 0;
  private hi = 0;
  private lastS = -Infinity;
  constructor(private items: Placed[], private behind = 40, private ahead = 175) {
    for (const it of items) it.obj.visible = false;
  }

  /** playerS must be lap-wrapped; a backwards jump (new lap) resets the window. */
  update(playerS: number): void {
    const { items } = this;
    if (playerS < this.lastS - 100) {
      for (let i = this.lo; i < this.hi; i++) items[i].obj.visible = false;
      this.lo = 0;
      this.hi = 0;
    }
    this.lastS = playerS;
    while (this.hi < items.length && items[this.hi].s < playerS + this.ahead) {
      items[this.hi].obj.visible = true;
      this.hi++;
    }
    while (this.lo < this.hi && items[this.lo].s < playerS - this.behind) {
      items[this.lo].obj.visible = false;
      this.lo++;
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
  private window: VisibilityWindow;
  private roadMat: THREE.MeshToonMaterial;

  constructor(
    scene: THREE.Scene,
    private track: Track,
    assets: AssetLibrary,
    seed: number,
    map: MapSpec
  ) {
    const rand = mulberry32(seed ^ 0x5eed);
    const items: Placed[] = [];
    const flavorAt = (s: number): Flavor =>
      map.districts[districtIndexAt(s, track.length)].flavor;

    const road = track.buildRoadMesh();
    this.roadMat = road.material as THREE.MeshToonMaterial;
    this.group.add(road);

    for (const side of [-1, 1]) {
      let s = 14;
      while (s < track.length - 10) {
        let obj: THREE.Object3D;
        let dist = ROAD_HALF_WIDTH + 5 + rand() * 8;
        let gap = 16 + rand() * 14;

        switch (flavorAt(s)) {
          case 'towers': {
            const kit = assets.cityBuildings;
            obj = kit.length ? kit[Math.floor(rand() * kit.length)].clone(true) : buildCityBuilding(rand);
            dist = ROAD_HALF_WIDTH + 7 + rand() * 7;
            break;
          }
          case 'palms':
            if (rand() < 0.55) {
              obj = buildPalm(rand);
              dist = ROAD_HALF_WIDTH + 2.5 + rand() * 9;
              gap = 10 + rand() * 10;
            } else {
              obj = buildColorfulBuilding(rand);
              dist = ROAD_HALF_WIDTH + 6 + rand() * 6;
            }
            break;
          case 'pagoda':
            obj = buildPagodaHouse(rand);
            dist = ROAD_HALF_WIDTH + 5 + rand() * 6;
            break;
          case 'park':
            obj = buildTree(rand);
            dist = ROAD_HALF_WIDTH + 2.5 + rand() * 10;
            gap = 11 + rand() * 16;
            break;
          case 'terrace':
            if (rand() < 0.88) {
              obj = buildTerraceHouse(rand);
              dist = ROAD_HALF_WIDTH + 5 + rand() * 5;
              gap = 13 + rand() * 8; // row houses sit shoulder to shoulder
            } else {
              obj = buildPhoneBox();
              dist = ROAD_HALF_WIDTH + 2 + rand() * 2;
            }
            break;
          case 'market':
            if (rand() < 0.7) {
              obj = buildStall(rand);
              dist = ROAD_HALF_WIDTH + 2.5 + rand() * 3.5;
              gap = 10 + rand() * 8;
            } else {
              obj = buildColorfulBuilding(rand);
              dist = ROAD_HALF_WIDTH + 6 + rand() * 6;
            }
            break;
        }

        track.place(obj, s, side * dist);
        obj.rotation.y += side > 0 ? Math.PI / 2 : -Math.PI / 2;
        this.group.add(obj);
        items.push({ s, obj });
        s += gap;
      }
    }

    // streetlights in the built-up districts; red lantern poles in the hutongs
    for (let s = 30, side = 1; s < track.length; s += 55, side = -side) {
      const flavor = flavorAt(s);
      if (flavor === 'park' || flavor === 'palms') continue;
      const lamp = flavor === 'pagoda'
        ? buildLanternPole()
        : assets.streetlight?.clone(true) ?? buildStreetlight();
      this.track.place(lamp, s, side * (ROAD_HALF_WIDTH + 1.2));
      lamp.rotation.y += side > 0 ? 0 : Math.PI;
      this.group.add(lamp);
      items.push({ s, obj: lamp });
    }

    // red/white racing barriers through downtown — street-circuit dressing
    const barrierMats = [toonMat(0xd9352b), toonMat(0xe8e8e8)];
    const barrierGeo = new THREE.BoxGeometry(0.28, 0.55, 2.4);
    let bi = 0;
    for (let s = 4; s < track.length - 4; s += 9) {
      if (flavorAt(s) !== 'towers') continue;
      for (const side of [-1, 1]) {
        const b = new THREE.Mesh(barrierGeo, barrierMats[bi++ % 2]);
        b.position.y = 0.28;
        const holder = new THREE.Group();
        holder.add(b);
        track.place(holder, s, side * (ROAD_HALF_WIDTH + 0.95));
        this.group.add(holder);
        items.push({ s, obj: holder });
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

    items.sort((a, b) => a.s - b.s);
    this.window = new VisibilityWindow(items);
    scene.add(this.group);
  }

  update(playerS: number): void {
    this.window.update(playerS);
  }

  tintRoad(color: THREE.Color, k: number): void {
    this.roadMat.color.lerp(color, k);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
  }
}
