// The live backdrop of the /economy page: the game's own showroom (market
// studio set, turntable, studio-lit car) on a full-window canvas, with RUSH
// drifting through the air. The page moves the car by moving #market-car-stage.
import * as T from 'three';
import { AssetLibrary } from './assets';
import type { CarSpec } from './cars';
import { Showroom } from './showroom';

const MOTES = 260;

export class EconomyStage {
  private renderer: T.WebGLRenderer;
  private assets = new AssetLibrary('../');
  private showroom = new Showroom(this.assets);
  private motes: T.Points;
  private drift = new Float32Array(MOTES);
  private next: CarSpec | null = null;
  private current = '';
  private busy = false;
  private last = performance.now();
  private still = matchMedia('(prefers-reduced-motion: reduce)');

  /** Throws when WebGL is unavailable; the page then keeps its painted backdrop. */
  constructor(host: HTMLElement, private frame: HTMLElement) {
    const phone = Math.min(innerWidth, innerHeight) < 600;
    this.renderer = new T.WebGLRenderer({ antialias: !phone, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = !phone;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, phone ? 1.5 : 2));
    host.append(this.renderer.domElement);
    this.motes = this.buildMotes();
    this.showroom.scene.add(this.motes);
    const fit = () => this.renderer.setSize(innerWidth, innerHeight, false);
    fit();
    addEventListener('resize', fit);
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Gold motes rise off the floor (minted), ember ones sink (burned). */
  private buildMotes(): T.Points {
    const pos = new Float32Array(MOTES * 3), col = new Float32Array(MOTES * 3);
    for (let i = 0; i < MOTES; i++) {
      const angle = Math.random() * Math.PI * 2, radius = 2.2 + Math.random() * 7.5;
      pos.set([Math.sin(angle) * radius, Math.random() * 4.6, Math.cos(angle) * radius], i * 3);
      this.drift[i] = .08 + Math.random() * .22;
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new T.BufferAttribute(col, 3));
    const dot = document.createElement('canvas'); dot.width = dot.height = 64;
    const ctx = dot.getContext('2d')!, glow = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    glow.addColorStop(0, '#fff'); glow.addColorStop(.3, 'rgba(255,255,255,.55)'); glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, 64, 64);
    const points = new T.Points(geometry, new T.PointsMaterial({
      size: .11, map: new T.CanvasTexture(dot), vertexColors: true, transparent: true, opacity: .85,
      blending: T.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false
    }));
    points.frustumCulled = false;
    this.paintMotes(points, 0);
    return points;
  }

  private paintMotes(points: T.Points, burnShare: number): void {
    const col = points.geometry.getAttribute('color') as T.BufferAttribute;
    const embers = Math.round(MOTES * Math.min(.6, Math.max(0, burnShare)));
    const gold = new T.Color(0xfcd34d), ember = new T.Color(0xff6b4a);
    for (let i = 0; i < MOTES; i++) {
      const c = i < embers ? ember : gold;
      col.setXYZ(i, c.r, c.g, c.b);
      // embers fall, gold rises
      this.drift[i] = Math.abs(this.drift[i]) * (i < embers ? -1 : 1);
    }
    col.needsUpdate = true;
  }

  /** The share of minted RUSH that has been burned decides how many motes are embers. */
  setBurnShare(share: number): void { this.paintMotes(this.motes, share); }

  /** Put a car on the turntable; the model loads on first ask and the shot cuts to it. */
  show(spec: CarSpec): void {
    this.next = spec;
    if (!this.busy) void this.drain();
  }
  private async drain(): Promise<void> {
    this.busy = true;
    const canvas = this.renderer.domElement;
    while (this.next && this.next.id !== this.current) {
      const spec = this.next;
      await this.assets.ensureCar(spec);
      if (this.next !== spec) continue;
      const first = !this.current;
      if (!first && !this.still.matches) {
        canvas.classList.add('cut');
        await new Promise(done => setTimeout(done, 190));
      }
      this.showroom.setCar(spec);
      this.current = spec.id;
      canvas.classList.remove('cut');
      canvas.classList.add('on');
    }
    this.busy = false;
  }

  /** 'front' | 'side' | 'rear': the showroom swings round to it, then keeps orbiting. */
  shot(name: string): void {
    this.frame.dataset.shot = name;
    this.frame.dataset.take = String(performance.now());
    this.frame.dataset.orbit = 'true';
  }

  private tick(): void {
    if (document.hidden || !this.current) return;
    const now = performance.now(), dt = Math.min(.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.still.matches) {
      const pos = this.motes.geometry.getAttribute('position') as T.BufferAttribute;
      for (let i = 0; i < MOTES; i++) {
        let y = pos.getY(i) + this.drift[i] * dt;
        if (y > 4.6) y = 0; else if (y < 0) y = 4.6;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      this.motes.rotation.y += dt * .02;
    }
    this.showroom.render(this.renderer, false, false, true);
  }
}
