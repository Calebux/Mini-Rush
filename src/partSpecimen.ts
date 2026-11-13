import * as T from 'three';
import type { Recipe } from './components';
import { recipeStory } from './partPresentation';

/** A lit, inspectable display model, separate from the car and its driving loadout. */
export class PartSpecimen {
  readonly root = new T.Group();
  readonly model = new T.Group();
  readonly bounds = new T.Box3();
  constructor(recipe: Recipe) {
    this.root.name = `specimen-${recipe.id}`;
    const accent = new T.MeshStandardMaterial({ color: recipeStory(recipe).accent, metalness: .55, roughness: .28 });
    const silver = new T.MeshStandardMaterial({ color: 0xc4cdc6, metalness: .9, roughness: .23 });
    const iron = new T.MeshStandardMaterial({ color: 0x333c37, metalness: .7, roughness: .36 });
    const rubber = new T.MeshStandardMaterial({ color: 0x202320, metalness: .05, roughness: .78 });
    const cut = new T.MeshStandardMaterial({ color: 0x0c100d, metalness: .1, roughness: .8 });
    const mesh = (geometry: T.BufferGeometry, material: T.Material, x = 0, y = 0, z = 0) => {
      const m = new T.Mesh(geometry, material); m.position.set(x, y, z); this.model.add(m); return m;
    };
    const box = (w: number, h: number, d: number, mat: T.Material, x = 0, y = 0, z = 0) => mesh(new T.BoxGeometry(w, h, d), mat, x, y, z);
    const cylinder = (r: number, depth: number, mat: T.Material, x = 0, y = 0, z = 0, segments = 48) => {
      const m = mesh(new T.CylinderGeometry(r, r, depth, segments), mat, x, y, z); m.rotation.x = Math.PI / 2; return m;
    };
    const ring = (r: number, tube: number, mat: T.Material, x = 0, y = 0, z = 0) => mesh(new T.TorusGeometry(r, tube, 8, 64), mat, x, y, z);
    if (recipe.slot === 'tires') {
      const slide = recipe.id === 'slide-compound', drag = recipe.id === 'low-drag';
      const tire = mesh(new T.TorusGeometry(.64, .205, 24, 80), rubber); tire.scale.z = drag ? .8 : 1.15;
      // Sidewall, rim, brake rotor, hub and bolts remain distinct at close range.
      for (const z of [-.15, .15]) {
        ring(.68, .012, accent, 0, 0, z);
        ring(.51, .035, silver, 0, 0, z);
        ring(.74, .014, rubber, 0, 0, z * .8);
      }
      cylinder(.47, .16, iron);
      cylinder(.37, .025, silver, 0, 0, .11);
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * Math.PI * 2;
        cylinder(.018, .028, cut, Math.sin(a) * .31, Math.cos(a) * .31, .126, 8);
      }
      box(.09, .28, .09, accent, .33, .12, .17);
      for (let i = 0; i < (drag ? 8 : 5); i++) {
        const a = i / (drag ? 8 : 5) * Math.PI * 2;
        const spoke = box(drag ? .055 : .07, .40, .055, silver, Math.sin(a) * .27, Math.cos(a) * .27, .19);
        spoke.rotation.z = -a + (slide ? .18 : 0);
      }
      cylinder(.11, .09, iron, 0, 0, .2); cylinder(.065, .1, accent, 0, 0, .22);
      for (let i = 0; i < 5; i++) {
        const a = i / 5 * Math.PI * 2;
        cylinder(.022, .04, silver, Math.sin(a) * .085, Math.cos(a) * .085, .26, 6);
      }
      // Different tread cuts give the three recipes a readable visual identity.
      for (let i = 0; i < (slide ? 42 : 28); i++) {
        const a = i / (slide ? 42 : 28) * Math.PI * 2;
        for (const side of [-1, 1]) {
          const points = Array.from({ length: 9 }, (_, j) => {
            const t = j / 8, profile = side * (.08 + t * .65);
            const radius = .64 + .206 * Math.cos(profile);
            const theta = a + t * (slide ? .095 : .025);
            return new T.Vector3(Math.sin(theta) * radius, Math.cos(theta) * radius,
              .206 * Math.sin(profile) * (drag ? .8 : 1.15));
          });
          mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), 8, slide ? .006 : .003, 4, false), cut);
        }
      }
      this.model.scale.setScalar(1.85); this.model.position.y = 1.62;
    } else if (recipe.slot === 'engine') {
      box(1.0, .45, .85, iron);
      for (const x of [-.28, .28]) {
        box(.4, .24, 1, accent, x, .33);
        for (const z of [-.33, -.11, .11, .33]) {
          box(.38, .025, .04, silver, x, .46, z);
          const intake = mesh(new T.CylinderGeometry(.065, .09, .15, 16), silver, x, .53, z);
          intake.rotation.z = x > 0 ? -.2 : .2;
        }
      }
      box(.16, .12, .76, rubber, 0, .46);
      const turbo = ring(.24, .09, silver, .68, .03, .1); turbo.rotation.y = Math.PI / 2;
      cylinder(.12, .17, iron, .68, .03, .1).rotation.y = Math.PI / 2;
      for (const z of [-.27, 0, .27]) {
        const pipe = ring(.18, .045, iron, -.56, -.05, z); pipe.rotation.x = Math.PI / 2;
      }
      box(.7, .08, .56, silver, 0, -.3);
      this.model.rotation.x = .12; this.model.scale.setScalar(1.65); this.model.position.y = 1.35;
    } else if (recipe.slot === 'gearbox') {
      const body = mesh(new T.CylinderGeometry(.28, .48, 1.05, 12), iron); body.rotation.x = Math.PI / 2;
      cylinder(.12, 1.7, silver);
      for (let i = 0; i < 8; i++) ring(.30 + i * .023, .025, silver, 0, 0, .45 - i * .13);
      cylinder(.49, .06, accent, 0, 0, -.55);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        cylinder(.025, .08, silver, Math.sin(a) * .42, Math.cos(a) * .42, -.59, 6);
      }
      box(.25, .12, .32, accent, 0, .37, -.15);
      this.model.rotation.set(.28, -.5, -.2); this.model.scale.setScalar(1.8); this.model.position.y = 1.4;
    } else {
      for (const x of [-.28, .28]) {
        const tank = mesh(new T.CylinderGeometry(.21, .21, 1.05, 32), accent, x);
        for (const y of [-.52, .52]) mesh(new T.SphereGeometry(.21, 24, 16), accent, x, y);
        for (const y of [-.33, .33]) ring(.215, .025, iron, x, y).rotation.x = Math.PI / 2;
        mesh(new T.CylinderGeometry(.06, .06, .18, 12), silver, x, .77);
        box(.24, .04, .07, iron, x, .88);
        box(.16, .29, .015, rubber, x, 0, .21);
        box(.09, .025, .02, silver, x, .05, .225); box(.09, .025, .02, silver, x, -.04, .225);
        tank.name = 'bottle';
      }
      this.model.rotation.z = -.16; this.model.scale.setScalar(1.5); this.model.position.y = 1.4;
    }
    this.root.add(this.model);
    const pedestal = new T.Mesh(new T.CylinderGeometry(1.8, 1.9, .12, 64), iron);
    pedestal.position.y = .06; this.root.add(pedestal);
    const halo = new T.Mesh(new T.RingGeometry(1.73, 1.75, 80), new T.MeshBasicMaterial({ color: recipeStory(recipe).accent, side: T.DoubleSide, toneMapped: false }));
    halo.rotation.x = -Math.PI / 2; halo.position.y = .125; this.root.add(halo);
    // Fit the component itself; the decorative plinth must not shrink it on phones.
    this.bounds.setFromObject(this.model);
  }
  dispose(): void {
    this.root.removeFromParent();
    const materials = new Set<T.Material>();
    this.root.traverse(o => { if (o instanceof T.Mesh) { o.geometry.dispose(); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    materials.forEach(m => m.dispose());
  }
}
