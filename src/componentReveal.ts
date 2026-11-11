import * as T from 'three';
import type { Recipe } from './components';

/** A brief workshop cutaway: the confirmed component moves into its mounting area. */
export class ComponentReveal {
  readonly root = new T.Group();
  private part = new T.Group();
  private pulse: T.Mesh;
  private elapsed = 0;
  private duration: number;
  private materials: T.MeshStandardMaterial[];
  private target: T.Vector3;
  private wheels: boolean;
  constructor(recipe: Recipe, private reducedMotion: boolean) {
    this.wheels = recipe.slot === 'tires';
    this.root.name = `installed-${recipe.id}`;
    this.duration = reducedMotion ? 2 : 3.8;
    this.target = new T.Vector3(0, recipe.slot === 'tires' ? 0 : .65, recipe.slot === 'tires' ? 0 : -.7);
    const shell = new T.MeshStandardMaterial({ color: 0x68cde8, metalness: .55, roughness: .25, emissive: 0x10354b, emissiveIntensity: .6, transparent: true });
    const metal = new T.MeshStandardMaterial({ color: 0xcbd9e1, metalness: .8, roughness: .22, transparent: true });
    const dark = new T.MeshStandardMaterial({ color: 0x172435, metalness: .25, roughness: .45, transparent: true });
    this.materials = [shell, metal, dark];
    const mesh = (geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, rx=0, rz=0) => {
      const m = new T.Mesh(geo, mat); m.position.set(x,y,z); m.rotation.set(rx,0,rz); m.userData.mountX = x; this.part.add(m); return m;
    };
    const box = (w:number,h:number,d:number,mat:T.Material,x:number,y:number,z:number) => mesh(new T.BoxGeometry(w,h,d),mat,x,y,z);
    if (recipe.slot === 'engine') {
      box(.65,.22,.55,dark,0,0,0);
      for (const x of [-.2,.2]) {
        box(.23,.15,.62,shell,x,.17,0);
        for (const z of [-.2,0,.2]) mesh(new T.CylinderGeometry(.06,.06,.07,12),metal,x,.29,z);
      }
      const turbo = mesh(new T.TorusGeometry(.14,.065,8,24),metal,.43,.03,.1); turbo.rotation.y = Math.PI/2;
      box(.3,.05,.28,metal,0,.22,0);
    } else if (recipe.slot === 'gearbox') {
      mesh(new T.CylinderGeometry(.18,.25,.65,8),shell,0,0,0,Math.PI/2);
      for (const z of [-.2,-.1,0,.1,.2]) mesh(new T.TorusGeometry(.24,.018,4,16),metal,0,0,z);
      mesh(new T.CylinderGeometry(.06,.06,.95,12),metal,0,0,0,Math.PI/2);
      box(.14,.12,.3,dark,0,.22,-.1);
    } else if (recipe.slot === 'nitro') {
      for (const x of [-.16,.16]) {
        mesh(new T.CylinderGeometry(.115,.115,.56,20),shell,x,0,0);
        mesh(new T.SphereGeometry(.115,16,10),shell,x,.28,0);
        mesh(new T.SphereGeometry(.115,16,10),shell,x,-.28,0);
        mesh(new T.CylinderGeometry(.04,.04,.12,12),metal,x,.41,0);
        box(.15,.035,.06,metal,x,.47,0);
        for (const y of [-.17,.17]) mesh(new T.TorusGeometry(.117,.014,4,16),dark,x,y,0,Math.PI/2);
      }
    } else {
      for (const x of [-.84,.84]) for (const z of [-1.2,1.3]) {
        const tire = mesh(new T.TorusGeometry(.29,.075,10,32),dark,x,.37,z); tire.rotation.y = Math.PI/2;
        mesh(new T.CylinderGeometry(.22,.22,.12,24),shell,x,.37,z,0,Math.PI/2);
        mesh(new T.CylinderGeometry(.07,.07,.15,12),metal,x,.37,z,0,Math.PI/2);
      }
    }
    this.root.add(this.part);
    this.pulse = new T.Mesh(new T.RingGeometry(2.1,2.14,80), new T.MeshBasicMaterial({ color: 0x81e1fc, transparent: true, opacity: .7, side: T.DoubleSide, depthWrite: false, toneMapped: false }));
    this.pulse.rotation.x = -Math.PI/2; this.pulse.position.y = .06; this.root.add(this.pulse);
    this.update(0);
  }
  update(dt: number): boolean {
    this.elapsed += dt;
    if (this.elapsed >= this.duration) return false;
    if (this.reducedMotion) { this.part.visible = false; return true; }
    const travel = T.MathUtils.smoothstep(this.elapsed, 1.1, 2.8);
    this.part.position.copy(this.target);
    if (this.wheels) {
      for (const wheel of this.part.children) {
        const x = wheel.userData.mountX as number;
        wheel.position.x = x + Math.sign(x)*(1-travel)*.65;
      }
    } else this.part.position.y += (1-travel)*1.35;
    const opacity = 1 - T.MathUtils.smoothstep(this.elapsed, 2.1, 3.3);
    for (const material of this.materials) { material.opacity = opacity; material.depthWrite = opacity > .7; }
    this.pulse.scale.setScalar(1 + .06*Math.sin(this.elapsed*3));
    (this.pulse.material as T.MeshBasicMaterial).opacity = Math.min(1,this.elapsed*3) * (1-this.elapsed/this.duration)*.8;
    return true;
  }
  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse(o => { if (o instanceof T.Mesh) o.geometry.dispose(); });
    for (const material of this.materials) material.dispose();
    (this.pulse.material as T.Material).dispose();
  }
}
