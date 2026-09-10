/**
 * Shooting HUD for the gun modes.
 *
 * The weapon itself lives on the car — a hand out of the driver's window
 * (`buildShooterArm`) — so the HUD carries only the aim reticle and the ammo
 * count. Both are drawn on a canvas, so the mode needs no sprite pack.
 */
export class GunHud {
  private root: HTMLDivElement;
  private pulse: HTMLDivElement;
  private ammoEl: HTMLDivElement;
  private recoilT = 0;
  private swayT = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'gun';

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    drawReticle(canvas);
    this.root.appendChild(canvas);

    // fires outward on every shot, so a tap reads even when the shot misses
    this.pulse = document.createElement('div');
    this.pulse.id = 'shot-pulse';
    this.root.appendChild(this.pulse);

    this.ammoEl = document.createElement('div');
    this.ammoEl.id = 'gun-ammo';
    this.root.appendChild(this.ammoEl);

    this.root.style.display = 'none';
    parent.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.root.style.display = v ? 'block' : 'none';
  }

  setAmmo(n: number): void {
    this.ammoEl.textContent = `×${n}`;
    this.ammoEl.classList.toggle('dry', n === 0);
  }

  recoil(): void {
    this.recoilT = 0.12;
    this.pulse.classList.remove('fire');
    void this.pulse.offsetWidth;
    this.pulse.classList.add('fire');
  }

  /**
   * Called every frame while visible. The reticle drifts with steering and
   * speed — enough to feel hand-held, far less than the old weapon sway, since
   * a sight that wanders is a sight you can't aim with.
   */
  update(dt: number, lean: number, speed: number): void {
    this.recoilT = Math.max(0, this.recoilT - dt);
    this.swayT += dt * (1.4 + speed * 0.05);
    const bobX = Math.sin(this.swayT) * 2.5;
    const bobY = Math.abs(Math.cos(this.swayT)) * 2;
    const kick = this.recoilT > 0 ? Math.sin((this.recoilT / 0.12) * Math.PI) * 5 : 0;
    this.root.style.transform =
      `translateX(${bobX - lean * 18}px) translateY(${bobY - kick}px)`;
  }
}

/** Aim reticle: open ring, four ticks, centre dot. Cel-flat, high contrast. */
function drawReticle(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const c = 48;
  ctx.lineCap = 'square';

  // dark backing pass so the reticle stays readable over pale road and sky
  for (const [color, width, inset] of [
    ['rgba(0,0,0,.55)', 7, 0], ['#ffb84a', 3, 0]
  ] as [string, number, number][]) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;

    ctx.beginPath();
    ctx.arc(c, c, 26 - inset, 0, Math.PI * 2);
    ctx.stroke();

    // ticks at 12/3/6/9, leaving the ring open so the target stays visible
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as [number, number][]) {
      ctx.beginPath();
      ctx.moveTo(c + dx * 14, c + dy * 14);
      ctx.lineTo(c + dx * 34, c + dy * 34);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(c, c, width === 7 ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
