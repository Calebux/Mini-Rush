/**
 * Continuous steering: drag horizontally to steer (mobile), hold ←/→ or A/D
 * (desktop). Hold the gas pedal / ↑ / W to accelerate. Quick tap fires
 * nitro / confirms menus.
 */
export class InputManager {
  onTap: () => void = () => {};
  onCamera: () => void = () => {};
  onNitroKey: () => void = () => {}; // N — nitro in gun modes where tap shoots

  /** -1..1 from held keys */
  keySteer = 0;
  /** set by the on-screen brake pedal */
  uiBrake = false;
  /** set by the on-screen gas pedal */
  uiGas = false;

  private brakeHeld = false;
  private gasHeld = false;

  get braking(): boolean {
    return this.brakeHeld || this.uiBrake;
  }

  get gas(): boolean {
    return this.gasHeld || this.uiGas;
  }

  private dragDx = 0;
  private lastX = 0;
  private down = false;
  private moved = 0;
  private downTime = 0;
  private leftHeld = false;
  private rightHeld = false;

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      this.down = true;
      this.lastX = e.clientX;
      this.moved = 0;
      this.downTime = performance.now();
    });
    target.addEventListener('pointermove', (e) => {
      if (!this.down) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.dragDx += dx;
      this.moved += Math.abs(dx) + Math.abs(e.movementY ?? 0);
    });
    const up = () => {
      if (!this.down) return;
      this.down = false;
      if (this.moved < 14 && performance.now() - this.downTime < 300) this.onTap();
    };
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', () => (this.down = false));

    window.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') this.leftHeld = true;
      else if (e.key === 'ArrowRight' || e.key === 'd') this.rightHeld = true;
      else if (e.key === 'ArrowDown' || e.key === 's') this.brakeHeld = true;
      else if (e.key === 'ArrowUp' || e.key === 'w') this.gasHeld = true;
      else if (!e.repeat && e.key === 'c') this.onCamera();
      else if (!e.repeat && e.key === 'n') this.onNitroKey();
      else if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) this.onTap();
      this.keySteer = (this.leftHeld ? -1 : 0) + (this.rightHeld ? 1 : 0);
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'a') this.leftHeld = false;
      else if (e.key === 'ArrowRight' || e.key === 'd') this.rightHeld = false;
      else if (e.key === 'ArrowDown' || e.key === 's') this.brakeHeld = false;
      else if (e.key === 'ArrowUp' || e.key === 'w') this.gasHeld = false;
      this.keySteer = (this.leftHeld ? -1 : 0) + (this.rightHeld ? 1 : 0);
    });
  }

  /** Pixels dragged since last call (consumed). */
  consumeDrag(): number {
    const dx = this.dragDx;
    this.dragDx = 0;
    return dx;
  }
}
