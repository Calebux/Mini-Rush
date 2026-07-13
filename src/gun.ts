/**
 * Doom-style weapon overlay for the gun modes. Uses /assets/sprites/gun.png
 * when present (Guns Asset Pack v1 — see assets/README.md), otherwise draws
 * a chunky pixel pistol on a canvas so the mode works before assets land.
 * Sway/recoil are CSS transforms driven from the game loop.
 */
export class GunHud {
  private root: HTMLDivElement;
  private flash: HTMLDivElement;
  private ammoEl: HTMLDivElement;
  private recoilT = 0;
  private swayT = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'gun';

    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 96;
    drawPixelPistol(canvas);
    this.root.appendChild(canvas);

    // hot-swap in the real sprite if the pack has been dropped in
    const img = new Image();
    img.src = `${import.meta.env.BASE_URL}assets/sprites/gun.png`;
    img.onload = () => {
      canvas.remove();
      img.id = 'gun-img';
      this.root.prepend(img);
    };

    this.flash = document.createElement('div');
    this.flash.id = 'muzzle-flash';
    this.root.appendChild(this.flash);

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
    this.flash.classList.remove('fire');
    void this.flash.offsetWidth;
    this.flash.classList.add('fire');
  }

  /** Called every frame while visible: speed bob + steering sway + recoil kick. */
  update(dt: number, lean: number, speed: number): void {
    this.recoilT = Math.max(0, this.recoilT - dt);
    this.swayT += dt * (2 + speed * 0.09);
    const bobX = Math.sin(this.swayT) * 5;
    const bobY = Math.abs(Math.cos(this.swayT)) * 4;
    const kick = this.recoilT > 0 ? Math.sin((this.recoilT / 0.12) * Math.PI) * 16 : 0;
    this.root.style.transform =
      `translateX(${bobX - lean * 46}px) translateY(${bobY + kick}px) rotate(${-lean * 9}deg)`;
  }
}

/** Fallback art: a cel-shaded pixel pistol seen from behind, Doom-style. */
function drawPixelPistol(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };
  // slide
  px(28, 26, 40, 16, '#23262e');
  px(28, 26, 40, 4, '#4a4f5c');   // top highlight
  px(24, 30, 6, 10, '#181a20');   // muzzle block
  px(25, 33, 3, 4, '#0b0c10');    // bore
  // frame + trigger guard
  px(34, 42, 30, 8, '#2e323c');
  px(46, 50, 14, 4, '#23262e');
  // grip (slanted with steps)
  px(50, 50, 14, 6, '#3a2d22');
  px(52, 56, 14, 6, '#33271d');
  px(54, 62, 14, 6, '#2c2118');
  px(56, 68, 14, 6, '#251c14');
  // glove thumb wrapping the grip
  px(48, 54, 8, 10, '#c98a4b');
  px(48, 54, 8, 3, '#e0a566');
  // rear sight + cel rim light
  px(62, 24, 5, 4, '#181a20');
  px(28, 40, 40, 2, '#0b0c10');
}
