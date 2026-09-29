import * as THREE from 'three';

type Sequence = 'pickup' | 'dropoff' | null;

export interface PassengerModel {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
  height: number;
}

const HEIGHT = 1.55;           // metres: taller and he sits through a supercar's roof
const APPROACH = 3.2;          // metres of pavement walked before the door

/**
 * A passenger who walks to the car and gets in; and later gets
 * out and walks off. The body is the rigged character from passenger.glb
 * playing its Mixamo clips — walk, enter, exit — so the motion is captured,
 * not posed. The clips carry root motion (entering moves the hips ~0.85 of
 * the body's height into the seat), so where the body starts is worked out
 * from the clip itself: the seat is where the hips end up.
 *
 * Car models are one solid body with no opening doors, and a panel swung
 * over the door line read as exactly that: an overlay. So there is no door.
 * The camera films from the far side instead, and the car's own body hides
 * the door he climbs through.
 */
export class PassengerSequence {
  private body = new THREE.Group();          // parented to the car while playing
  private model: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Partial<Record<'walk' | 'enter' | 'exit' | 'idle', THREE.AnimationAction>> = {};
  private enterShift = new THREE.Vector3();  // hips travel over the enter clip, body space
  private exitShift = new THREE.Vector3();
  private walkSpeed = 1.2;                   // m/s the walk clip's feet move at
  private sequence: Sequence = null;
  private phase: 'approach' | 'enter' | 'exit' | 'leave' = 'approach';
  private time = 0;
  private seat = new THREE.Vector3();
  private carBox = new THREE.Box3();
  private legacy: boolean;
  /** Which side of the car the door in use is: +1 its left (+x), -1 its right. */
  private side = 1;
  private seatZ = 0;
  private waiting = false;                   // standing on the pavement for a pickup
  private path: THREE.Vector3[] = [];        // car-local points to walk through to the door

  constructor(private scene: THREE.Scene, private car: THREE.Group, paint: number, model: PassengerModel | null) {
    this.measureCar();
    this.legacy = !model;
    this.model = model ? model.root : buildHuman();
    if (model) {
      this.model.scale.setScalar(HEIGHT / model.height);
      this.mixer = new THREE.AnimationMixer(this.model);
      const clip = (name: string) => model.clips.find((c) => c.name === name);
      const walk = clip('walk'), enter = clip('enter'), exit = clip('exit'), idle = clip('idle');
      if (walk) {
        this.walkSpeed = this.travel(walk).length() / walk.duration;
        this.actions.walk = this.mixer.clipAction(inPlace(walk));
      }
      if (enter) {
        this.enterShift = this.travel(enter);
        this.actions.enter = this.once(enter);
      }
      if (exit) {
        this.exitShift = this.travel(exit);
        this.actions.exit = this.once(exit);
      }
      if (idle) this.actions.idle = this.mixer.clipAction(inPlace(idle));
    }
    this.body.add(this.model);
    this.body.visible = false;
    this.body.name = 'passenger';

    const size = this.carBox.getSize(new THREE.Vector3());
    const centre = this.carBox.getCenter(new THREE.Vector3());
    // the seat: inside the door, a little in from the side
    this.seatZ = centre.z - size.z * 0.1;
    this.useSide(1);
  }

  isPlaying(): boolean {
    return this.sequence !== null;
  }

  /**
   * Stand on the pavement at (x, z), idling, facing the road point (fx, fz):
   * a fare that has been accepted and is waiting to be picked up.
   */
  waitAt(x: number, z: number, fx: number, fz: number): void {
    if (this.sequence) return;
    this.car.remove(this.body);
    this.scene.add(this.body);
    this.body.position.set(x, 0, z);
    this.body.rotation.y = Math.atan2(fx - x, fz - z);
    this.body.visible = this.model.visible = true;
    this.waiting = true;
    this.mixer?.stopAllAction();
    this.play('idle');
  }

  /** The fare was dropped: take the waiting passenger away. */
  stopWaiting(): void {
    if (!this.waiting) return;
    this.waiting = false;
    this.scene.remove(this.body);
    this.body.visible = false;
    this.mixer?.stopAllAction();
  }

  startPickup(): void {
    const from = this.waiting ? this.body.position.clone() : null;
    const facing = this.body.rotation.y;
    this.waiting = false;
    this.scene.remove(this.body);
    this.begin('pickup');
    this.phase = 'approach';
    if (from) {
      // walk from where they stood, round the nose if the car stopped with
      // them on the wrong side of it
      this.car.updateMatrixWorld(true);
      const local = this.car.worldToLocal(from);
      local.y = 0;
      this.body.position.copy(local);
      this.body.rotation.y = facing - this.car.rotation.y;
      // use the door on his side of the car; only when he is off the nose or
      // the tail does he step round the corner to reach it
      this.useSide(local.x >= 0 ? 1 : -1);
      const target = this.enterStart();
      const wide = this.carBox.max.x + 1.1;
      const ends = [this.carBox.max.z + 1.2, this.carBox.min.z - 1.2];
      this.path = local.z > ends[0] || local.z < ends[1]
        ? [new THREE.Vector3(this.side * wide, 0, local.z > 0 ? ends[0] : ends[1]), target]
        : [target];
    } else {
      this.useSide(1);
      const door = this.enterStart();
      this.body.rotation.y = this.enterYaw;
      this.body.position.copy(door).add(new THREE.Vector3(this.side * APPROACH, 0, 0));
      this.path = [door];
    }
    this.play('walk');
  }

  /** `kerb`: where the pavement is, so they climb out on that side. */
  startDropoff(kerb?: { x: number; z: number }): void {
    this.car.updateMatrixWorld(true);
    this.useSide(kerb && this.car.worldToLocal(new THREE.Vector3(kerb.x, 0, kerb.z)).x < 0 ? -1 : 1);
    this.begin('dropoff');
    this.phase = 'exit';
    // Seated, turned so the exit clip (which climbs out to the body's left)
    // carries them out of this side's door: facing forward for the car's
    // left, facing back for its right. They are inside the car until then.
    this.body.rotation.y = this.side > 0 ? 0 : Math.PI;
    this.body.position.copy(this.seat);
    this.play('exit');
    if (!this.actions.exit) this.phase = 'leave';
  }

  /** Returns the sequence that just finished, if any. */
  update(dt: number): Sequence {
    if (!this.sequence) {
      if (this.waiting) this.mixer?.update(dt);
      return null;
    }
    this.time += dt;
    this.mixer?.update(dt);
    if (this.legacy) return this.updateLegacy(dt);

    if (this.phase === 'approach') {
      const target = this.path[0];
      const toGo = target.clone().sub(this.body.position);
      const step = this.walkSpeed * dt;
      const last = this.path.length === 1;
      if (toGo.length() <= step || !this.actions.enter) {
        this.body.position.copy(target);
        this.path.shift();
        if (!this.path.length) {
          this.body.rotation.y = this.enterYaw;
          this.phase = 'enter';
          this.time = 0;
          this.play('enter', 0.25);
        }
        return null;
      }
      this.body.position.addScaledVector(toGo.clone().normalize(), step);
      // face where he is going; square up to the car over the last stride
      const heading = last && toGo.length() < 0.8 ? this.enterYaw : Math.atan2(toGo.x, toGo.z);
      this.body.rotation.y += angleTo(this.body.rotation.y, heading) * Math.min(1, dt * 8);
      return null;
    }
    if (this.phase === 'enter') {
      const d = this.actions.enter?.getClip().duration ?? 0;
      // once he is sat he is inside: stop drawing him
      // rather than show a body through the roof
      if (this.time > d - 1.1) this.model.visible = false;
      if (this.time >= d) return this.finish();
      return null;
    }
    if (this.phase === 'exit') {
      const d = this.actions.exit?.getClip().duration ?? 0;
      this.model.visible = this.time > 0.5;   // sat inside the car for the first moment
      if (this.time >= d) {
        // hand over from root motion to walking: bake where the clip left him
        this.body.position.add(this.exitShift.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.body.rotation.y));
        this.phase = 'leave';
        this.time = 0;
        // no crossfade: the body just moved by the clip's travel, so blending
        // the old pose in would count that travel twice for a moment
        this.play('walk');
      }
      return null;
    }
    // leave: walk off across the pavement, away from the car
    const yaw = this.side * Math.PI / 2;
    this.body.rotation.y += angleTo(this.body.rotation.y, yaw) * Math.min(1, dt * 5);
    this.body.position.x += this.side * this.walkSpeed * dt;
    if (this.time > 2.2) return this.finish();
    return null;
  }

  /**
   * A shot across the car while a sequence plays, in world space; null
   * when nothing is playing and the chase camera should have the car back.
   */
  cameraShot(): { position: THREE.Vector3; look: THREE.Vector3 } | null {
    if (!this.sequence) return null;
    const size = this.carBox.getSize(new THREE.Vector3());
    // from the far side and a little high: he is seen over the roof walking
    // up, then ducks down behind the car, and the door is never in shot
    const position = this.car.localToWorld(new THREE.Vector3(-this.side * (size.x / 2 + 5.4), 2.5, this.seat.z - 3.2));
    const look = this.car.localToWorld(new THREE.Vector3(this.side * 0.9, 0.95, this.seat.z));
    return { position, look };
  }

  /** Facing the car across the door in use. */
  private get enterYaw(): number {
    return -this.side * Math.PI / 2;
  }

  private useSide(side: number): void {
    this.side = side;
    this.seat.set(side * this.carBox.max.x * 0.4, 0, this.seatZ);
  }

  /** Where the body must stand for the enter clip to finish with the hips in the seat. */
  private enterStart(): THREE.Vector3 {
    const shift = this.enterShift.clone().applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.enterYaw);
    return this.seat.clone().sub(new THREE.Vector3(shift.x, 0, shift.z));
  }

  private begin(sequence: Sequence): void {
    this.sequence = sequence;
    this.time = 0;
    this.car.add(this.body);
    this.body.visible = true;
    this.model.visible = true;
    this.mixer?.stopAllAction();
  }

  private play(name: keyof PassengerSequence['actions'], fade = 0): void {
    const next = this.actions[name];
    if (!next) return;
    next.reset().play();
    for (const [other, action] of Object.entries(this.actions)) {
      if (other === name || !action) continue;
      // a clamped clip still holds its last pose at full weight: fade it or stop it
      if (fade > 0 && action.isRunning()) action.crossFadeTo(next, fade, false);
      else if (fade === 0) action.stop();
    }
  }

  private once(clip: THREE.AnimationClip): THREE.AnimationAction {
    const action = this.mixer!.clipAction(clip);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    return action;
  }

  /**
   * How far a clip carries the hips from its first frame to its last, in the
   * car-local metres of this body (scale included, facing +z).
   */
  private travel(clip: THREE.AnimationClip): THREE.Vector3 {
    const hips = this.hipsBone();
    if (!hips || !this.mixer) return new THREE.Vector3();
    const action = this.mixer.clipAction(clip);
    action.play();
    const at = (t: number) => {
      this.mixer!.setTime(t);
      this.model.updateMatrixWorld(true);
      return this.model.worldToLocal(hips.getWorldPosition(new THREE.Vector3()))
        .multiplyScalar(this.model.scale.x);
    };
    const shift = at(clip.duration - 1e-3).sub(at(0));
    action.stop();
    this.mixer.uncacheAction(clip);
    return shift;
  }

  private hipsBone(): THREE.Object3D | null {
    let hips: THREE.Object3D | null = null;
    this.model.traverse((o) => { if (!hips && /Hips$/.test(o.name)) hips = o; });
    return hips;
  }

  private measureCar(): void {
    // the car's own extent in its local frame, ignoring its glow and shadow decals
    this.car.updateMatrixWorld(true);
    const inverse = this.car.matrixWorld.clone().invert();
    this.car.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || o.name === 'car-ground-fx' || o.parent?.name === 'car-ground-fx') return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some((m) => m.transparent)) return;
      mesh.geometry.computeBoundingBox();
      const box = mesh.geometry.boundingBox!.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));
      this.carBox.union(box);
    });
    if (this.carBox.isEmpty()) this.carBox.set(new THREE.Vector3(-0.95, 0, -2.2), new THREE.Vector3(0.95, 1.25, 2.2));
  }

  private finish(): Sequence {
    const done = this.sequence;
    this.sequence = null;
    this.mixer?.stopAllAction();
    this.body.visible = false;
    this.car.remove(this.body);
    return done;
  }

  /** The built stand-in, for when passenger.glb is missing: slide and swing. */
  private updateLegacy(dt: number): Sequence {
    const swing = Math.sin(this.time * 11) * 0.3;
    for (const [name, sign] of [['passenger-arm-left', 1], ['passenger-arm-right', -1],
      ['passenger-leg-left', -1], ['passenger-leg-right', 1]] as const) {
      const limb = this.model.getObjectByName(name);
      if (limb) limb.rotation.x = swing * sign;
    }
    if (this.sequence === 'pickup') {
      this.body.rotation.y = -this.side * Math.PI / 2;
      this.body.position.set(this.seat.x + this.side * Math.max(0, APPROACH - this.time * 1.4), 0, this.seat.z);
      if (this.time > 2.6) this.model.visible = false;
      return this.time > 3.4 ? this.finish() : null;
    }
    this.body.rotation.y = this.side * Math.PI / 2;
    this.body.position.set(this.seat.x + this.side * this.time * 1.4, 0, this.seat.z);
    void dt;
    return this.time > 2.6 ? this.finish() : null;
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    this.car.remove(this.body);
    this.scene.remove(this.body);
    if (this.legacy) {
      this.model.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
    }
  }
}

/** A looping clip with the hips' travel removed, so the body is moved by code. */
function inPlace(clip: THREE.AnimationClip): THREE.AnimationClip {
  const copy = clip.clone();
  for (const track of copy.tracks) {
    if (!/Hips\.position$/.test(track.name)) continue;
    const v = track.values;
    for (let i = 0; i < v.length; i += 3) {
      v[i] = v[0];
      v[i + 2] = v[2];
    }
  }
  copy.name = `${clip.name}-in-place`;
  return copy;
}

const angleTo = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));

function buildHuman(): THREE.Group {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x9d633e, roughness: 0.7 });
  const jacket = new THREE.MeshStandardMaterial({ color: 0x6f3cff, roughness: 0.5, metalness: 0.2 });
  const trousers = new THREE.MeshStandardMaterial({ color: 0x17233c, roughness: 0.82 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.72, 8), jacket);
  torso.position.y = 1.08;
  root.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), skin);
  head.position.y = 1.6;
  root.add(head);
  const limb = (name: string, material: THREE.Material, r: number, len: number, x: number, y: number) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 7), material);
    mesh.name = name;
    mesh.position.set(x, y, 0);
    root.add(mesh);
  };
  limb('passenger-arm-left', jacket, 0.06, 0.66, -0.32, 1.08);
  limb('passenger-arm-right', jacket, 0.06, 0.66, 0.32, 1.08);
  limb('passenger-leg-left', trousers, 0.08, 0.76, -0.12, 0.38);
  limb('passenger-leg-right', trousers, 0.08, 0.76, 0.12, 0.38);
  return root;
}
