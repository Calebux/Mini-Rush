/**
 * Continuous steering: drag horizontally to steer (mobile), hold ←/→ or A/D
 * (desktop). Hold the gas pedal / ↑ / W to accelerate. Quick tap fires
 * nitro / confirms menus.
 */
export class InputManager {
  onTap: () => void = () => {};
  onCamera: () => void = () => {};
  onNitroKey: () => void = () => {}; // N — nitro in gun modes where tap shoots
  onPause: () => void = () => {};

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
  // Free-roam steering is a virtual stick: how far the steering finger is
  // from where it landed. A finger that lands on a pedal or button is not it.
  private steerId: number | null = null;
  private steerFrom = 0;
  private steerAt = 0;

  /** -1..1: the steering finger's offset from where it landed; 0 with no finger down. */
  get touchSteer(): number {
    if (this.steerId === null) return 0;
    const reach = Math.max(60, window.innerWidth * 0.16);
    return Math.max(-1, Math.min(1, (this.steerAt - this.steerFrom) / reach));
  }

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      this.down = true;
      this.lastX = e.clientX;
      this.moved = 0;
      this.downTime = performance.now();
      const onControl = (e.target as HTMLElement | null)?.closest('button, [role="button"], #btn-gas, #btn-brake');
      if (!onControl && this.steerId === null) {
        this.steerId = e.pointerId;
        this.steerFrom = this.steerAt = e.clientX;
      }
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.steerId) this.steerAt = e.clientX;
      if (!this.down) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.dragDx += dx;
      this.moved += Math.abs(dx) + Math.abs(e.movementY ?? 0);
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.steerId) this.steerId = null;
      if (!this.down) return;
      this.down = false;
      if (this.moved < 14 && performance.now() - this.downTime < 300) this.onTap();
    };
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.steerId) this.steerId = null;
      this.down = false;
    });

    window.addEventListener('keydown', (e) => {
      if (this.isEditableTarget(e.target)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="img"]') ||
        ((e.key === ' ' || e.key === 'Enter') && target?.closest('button'))) return;
      const key = e.key.toLowerCase();
      if (this.isControlKey(key)) e.preventDefault();
      if (key === 'arrowleft' || key === 'a') this.leftHeld = true;
      else if (key === 'arrowright' || key === 'd') this.rightHeld = true;
      else if (key === 'arrowdown' || key === 's') this.brakeHeld = true;
      else if (key === 'arrowup' || key === 'w') this.gasHeld = true;
      else if (!e.repeat && key === 'c') this.onCamera();
      else if (!e.repeat && key === 'n') this.onNitroKey();
      else if (!e.repeat && (key === 'escape' || key === 'p')) this.onPause();
      else if (!e.repeat && (key === ' ' || key === 'enter')) this.onTap();
      this.keySteer = (this.leftHeld ? -1 : 0) + (this.rightHeld ? 1 : 0);
    });
    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') this.leftHeld = false;
      else if (key === 'arrowright' || key === 'd') this.rightHeld = false;
      else if (key === 'arrowdown' || key === 's') this.brakeHeld = false;
      else if (key === 'arrowup' || key === 'w') this.gasHeld = false;
      this.keySteer = (this.leftHeld ? -1 : 0) + (this.rightHeld ? 1 : 0);
    });
    window.addEventListener('blur', () => this.releaseHeldInputs());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.releaseHeldInputs();
    });
  }

  /** Pixels dragged since last call (consumed). */
  consumeDrag(): number {
    const dx = this.dragDx;
    this.dragDx = 0;
    return dx;
  }

  private releaseHeldInputs(): void {
    this.down = false;
    this.steerId = null;
    this.dragDx = 0;
    this.leftHeld = false;
    this.rightHeld = false;
    this.brakeHeld = false;
    this.gasHeld = false;
    this.keySteer = 0;
  }

  private isControlKey(key: string): boolean {
    return ['arrowleft', 'arrowright', 'arrowdown', 'arrowup', ' ', 'a', 'd', 's', 'w', 'p', 'escape'].includes(key);
  }

  private isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
  }
}
