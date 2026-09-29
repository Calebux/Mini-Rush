import type { Track } from './track';

/**
 * The race HUD's minimap: the circuit as a glowing ribbon, turning under a
 * fixed arrow so "up" is always the way you are driving, with the field as
 * dots. Same look as the open city's minimap. The circuit is drawn once per
 * race into an offscreen image; a frame only crops and rotates it.
 */

const IMAGE = 512;        // offscreen image, px
const VIEW = 320;         // metres across the visible disc

export class RaceMinimap {
  private image = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private scale = 1;      // image px per metre
  private ox = 0;         // world → image offsets
  private oz = 0;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.image.width = this.image.height = IMAGE;
  }

  /** Draw the circuit for a new race. `accent` is the city's colour. */
  setTrack(track: Track, accent: number): void {
    const pts = track.outline(2);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    const pad = VIEW / 2;
    const span = Math.max(x1 - x0, z1 - z0) + pad * 2;
    this.scale = IMAGE / span;
    this.ox = -(x0 + x1) / 2 + span / 2;
    this.oz = -(z0 + z1) / 2 + span / 2;
    const ctx = this.image.getContext('2d')!;
    ctx.clearRect(0, 0, IMAGE, IMAGE);
    const trace = () => {
      ctx.beginPath();
      pts.forEach((p, i) => {
        const [x, y] = this.toImage(p.x, p.z);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
    };
    ctx.lineJoin = ctx.lineCap = 'round';
    const colour = `#${accent.toString(16).padStart(6, '0')}`;
    // a soft glow in the city's colour, then the tarmac, then a centre line
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(4, 22 * this.scale);
    ctx.shadowColor = colour;
    ctx.shadowBlur = 10;
    trace(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#39415a';
    ctx.lineWidth = Math.max(3, 12 * this.scale);
    trace(); ctx.stroke();
    ctx.strokeStyle = 'rgba(233,241,255,0.35)';
    ctx.lineWidth = 1;
    trace(); ctx.stroke();
    // the start/finish line
    const f = track.frame(0);
    const [sx, sy] = this.toImage(f.x, f.z);
    const half = 9 * this.scale;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, 3 * this.scale);
    ctx.beginPath();
    ctx.moveTo(sx + f.nx * half, sy + f.nz * half);
    ctx.lineTo(sx - f.nx * half, sy - f.nz * half);
    ctx.stroke();
  }

  private toImage(x: number, z: number): [number, number] {
    return [(x + this.ox) * this.scale, (z + this.oz) * this.scale];
  }

  /**
   * One frame. `you` is the player's world position and the way the road
   * runs there (unit x, z); `field` the other cars' positions.
   */
  draw(you: { x: number; z: number }, forward: { x: number; z: number },
    field: { x: number; z: number; colour?: string }[]): void {
    const ctx = this.ctx, size = this.canvas.width;
    const zoom = size / (VIEW * this.scale);
    const [px, py] = this.toImage(you.x, you.z);
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(7,9,18,0.82)';
    ctx.fillRect(0, 0, size, size);
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 2 - Math.atan2(forward.z, forward.x));
    ctx.scale(zoom, zoom);
    ctx.translate(-px, -py);
    ctx.drawImage(this.image, 0, 0);
    for (const car of field) {
      const [x, y] = this.toImage(car.x, car.z);
      ctx.fillStyle = car.colour ?? '#e9f1ff';
      ctx.beginPath();
      ctx.arc(x, y, 4.2 / zoom, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // you: the arrow at the centre, always pointing up
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6.3, 7.2);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-6.3, 7.2);
    ctx.closePath();
    ctx.fillStyle = '#fcff52';
    ctx.shadowColor = '#fcff52';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.restore();
  }
}
