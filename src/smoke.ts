import * as THREE from 'three';

interface Puff {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  vy: number;
  grow: number;
}

let tex: THREE.CanvasTexture | null = null;
function puffTexture(): THREE.CanvasTexture {
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.7, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  tex = new THREE.CanvasTexture(c);
  return tex;
}

/** Pooled billboard puffs: drift smoke, offroad dust, nitro exhaust. */
export class SmokePool {
  private puffs: Puff[] = [];
  private next = 0;

  constructor(scene: THREE.Scene, size = 48) {
    for (let i = 0; i < size; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: puffTexture(), transparent: true, opacity: 0, depthWrite: false
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.puffs.push({ sprite, life: 0, max: 1, vy: 0, grow: 0 });
    }
  }

  spawn(x: number, y: number, z: number, color: number, scale = 0.5): void {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % this.puffs.length;
    p.life = p.max = 0.4 + Math.random() * 0.25;
    p.vy = 0.8 + Math.random() * 0.7;
    p.grow = 2.4;
    p.sprite.visible = true;
    p.sprite.position.set(x + (Math.random() - 0.5) * 0.35, y, z + (Math.random() - 0.5) * 0.35);
    p.sprite.scale.setScalar(scale * (0.8 + Math.random() * 0.4));
    p.sprite.material.color.setHex(color);
    p.sprite.material.opacity = 0.55;
  }

  update(dt: number): void {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.visible = false;
        continue;
      }
      p.sprite.position.y += p.vy * dt;
      p.sprite.material.opacity = 0.55 * (p.life / p.max);
      p.sprite.scale.multiplyScalar(1 + p.grow * dt);
    }
  }
}
