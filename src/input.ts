/**
 * Continuous steering: drag horizontally to steer (mobile), hold ←/→ or A/D
 * (desktop). Hold the gas pedal / ↑ / W to accelerate. Quick tap fires
 * nitro / confirms menus.
 *
 * A game controller (PS4, Xbox, anything the browser maps to the "standard"
 * layout) is read every frame by poll(): the left stick or D-pad steers, R2
 * is gas and L2 brake, and its buttons fire the same actions as the keys.
 */

// The Gamepad API's standard layout: PlayStation names, Xbox in brackets.
const PAD = {
  cross: 0, circle: 1, square: 2, triangle: 3, // A, B, X, Y
  l1: 4, r1: 5, l2: 6, r2: 7, share: 8, options: 9,
  up: 12, down: 13, left: 14, right: 15
} as const;
const DEADZONE = 0.14;      // a resting stick is never quite centred
const TRIGGER = 0.18;       // how far a trigger goes in before it counts

export class InputManager {
  onTap: () => void = () => {};
  onCamera: () => void = () => {};
  onNitroKey: () => void = () => {}; // N — nitro in gun modes where tap shoots
  onPause: () => void = () => {};
  /** ✕ on a controller: the main action of whatever is on screen. */
  onPadAccept: () => void = () => {};
  /** △ on a controller. */
  onPadMap: () => void = () => {};
  /** ○ on a controller. */
  onPadBack: () => void = () => {};
  /** A controller appeared or went away. */
  onPadChange: (name: string | null) => void = () => {};
  /** D-pad or stick flicked a direction (for menus): dx, dy each -1, 0 or 1. Repeats while held. */
  onPadNav: (dx: number, dy: number) => void = () => {};

  /** set by the on-screen brake pedal */
  uiBrake = false;
  /** set by the on-screen gas pedal */
  uiGas = false;
  /** set by the city's on-screen drift button */
  uiHandbrake = false;

  private brakeHeld = false;
  private gasHeld = false;
  private heldSteer = 0;          // -1..1 from the arrow / A-D keys
  private padSteer = 0;           // -1..1 from the stick or D-pad
  private padGas = false;
  private padBrake = false;
  private padHandbrake = false;
  private shiftHeld = false;
  private padIndex: number | null = null;
  private padPressed: boolean[] = [];
  private padUsed = false;        // a real press or stick move has been seen
  private navDir = '';
  private navAt = 0;

  /** -1..1: held keys and the controller, together. */
  get keySteer(): number {
    return Math.max(-1, Math.min(1, this.heldSteer + this.padSteer));
  }

  get braking(): boolean {
    return this.brakeHeld || this.uiBrake || this.padBrake;
  }

  get gas(): boolean {
    return this.gasHeld || this.uiGas || this.padGas;
  }

  /** Shift, R1/L1 on a pad, or the on-screen drift button. */
  get handbrake(): boolean {
    return this.shiftHeld || this.uiHandbrake || this.padHandbrake;
  }

  /** The connected controller's name, or null. */
  get padName(): string | null {
    if (!this.padUsed) return null;
    const pad = this.padIndex === null ? null : navigator.getGamepads?.()[this.padIndex];
    return pad?.id ?? null;
  }

  /**
   * Read the controller: call once a frame. Browsers only report a pad after
   * one of its buttons has been pressed with the page open.
   */
  poll(): void {
    const pads = navigator.getGamepads?.() ?? [];
    let pad = this.padIndex === null ? null : pads[this.padIndex];
    if (!pad?.connected) {
      pad = null;
      for (const candidate of pads) if (candidate?.connected) { pad = candidate; break; }
      const index = pad?.index ?? null;
      if (index !== this.padIndex) {
        this.padIndex = index;
        // Whatever is held when a pad appears is its resting state, not a
        // press: some devices (and headless browsers) report a button stuck
        // down, and that must not click through the menu.
        this.padPressed = pad ? pad.buttons.map((b) => b.pressed) : [];
        if (!pad && this.padUsed) this.onPadChange(null);
        this.padUsed = false;
      }
    }
    if (!pad) {
      this.padSteer = 0;
      this.padGas = this.padBrake = this.padHandbrake = false;
      return;
    }
    const pressed = (i: number) => !!pad!.buttons[i]?.pressed;
    const value = (i: number) => pad!.buttons[i]?.value ?? 0;
    const stick = pad.axes[0] ?? 0;
    const dpad = (pressed(PAD.right) ? 1 : 0) - (pressed(PAD.left) ? 1 : 0);
    // past the deadzone the stick ramps from 0, so small corrections stay small
    const tilt = Math.abs(stick) < DEADZONE ? 0 : Math.sign(stick) * (Math.abs(stick) - DEADZONE) / (1 - DEADZONE);
    this.padSteer = dpad || tilt;
    // Some browsers (Firefox on a Mac) report a PS4 pad without the standard
    // layout, with the triggers as axes 3 and 4 running -1..1.
    const trigger = (button: number, axis: number) => pad!.mapping === 'standard'
      ? value(button) : Math.max(value(button), ((pad!.axes[axis] ?? -1) + 1) / 2);
    this.padGas = trigger(PAD.r2, 4) > TRIGGER || pressed(PAD.up);
    this.padBrake = trigger(PAD.l2, 3) > TRIGGER || pressed(PAD.down);
    this.padHandbrake = pressed(PAD.r1) || pressed(PAD.l1);
    // menu navigation: a direction fires once, then repeats while held
    const lx = pad.axes[0] ?? 0, ly = pad.axes[1] ?? 0;
    const nx = dpad || (lx > 0.6 ? 1 : lx < -0.6 ? -1 : 0);
    const ny = ((pressed(PAD.down) ? 1 : 0) - (pressed(PAD.up) ? 1 : 0)) || (ly > 0.6 ? 1 : ly < -0.6 ? -1 : 0);
    const dir = nx || ny ? `${nx},${ny}` : '';
    const now = performance.now();
    if (dir && (dir !== this.navDir || now > this.navAt)) {
      this.onPadNav(nx, ny);
      this.navAt = now + (dir !== this.navDir ? 380 : 150);
    }
    this.navDir = dir;
    // buttons act once, on the press
    const edge = (i: number) => pressed(i) && !this.padPressed[i];
    if (!this.padUsed && (pad.buttons.some((b, i) => b.pressed && !this.padPressed[i]) || Math.abs(stick) > 0.5)) {
      this.padUsed = true;
      this.onPadChange(pad.id); // announced on its first real use, not on a phantom
    }
    if (!this.padUsed) {
      this.padSteer = 0;
      this.padGas = this.padBrake = this.padHandbrake = false;
      this.padPressed = pad.buttons.map((b) => b.pressed);
      return;
    }
    if (edge(PAD.cross)) this.onPadAccept();
    if (edge(PAD.square)) this.onCamera();
    if (edge(PAD.triangle)) this.onPadMap();
    if (edge(PAD.circle)) this.onPadBack();
    if (edge(PAD.options)) this.onPause();
    this.padPressed = pad.buttons.map((b) => b.pressed);
  }

  /** A short rumble on the controller, where the browser supports it. */
  rumble(strength: number, ms = 180): void {
    const pad = this.padIndex === null ? null : navigator.getGamepads?.()[this.padIndex];
    const actuator = (pad as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, params: object) => Promise<unknown> } }) | null)?.vibrationActuator;
    const s = Math.max(0, Math.min(1, strength));
    void actuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: s, weakMagnitude: s * 0.6 })
      .catch(() => { /* not every browser lets a page rumble */ });
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
      if (key === 'shift') this.shiftHeld = true;
      if (key === 'arrowleft' || key === 'a') this.leftHeld = true;
      else if (key === 'arrowright' || key === 'd') this.rightHeld = true;
      else if (key === 'arrowdown' || key === 's') this.brakeHeld = true;
      else if (key === 'arrowup' || key === 'w') this.gasHeld = true;
      else if (!e.repeat && key === 'c') this.onCamera();
      else if (!e.repeat && key === 'n') this.onNitroKey();
      else if (!e.repeat && (key === 'escape' || key === 'p')) this.onPause();
      else if (!e.repeat && (key === ' ' || key === 'enter')) this.onTap();
      this.heldSteer = (this.leftHeld ? -1 : 0) + (this.rightHeld ? 1 : 0);
    });
    window.addEventListener('keyup', (e) => {
      const key = e.key.toLowerCase();
      if (key === 'shift') this.shiftHeld = false;
      if (key === 'arrowleft' || key === 'a') this.leftHeld = false;
      else if (key === 'arrowright' || key === 'd') this.rightHeld = false;
      else if (key === 'arrowdown' || key === 's') this.brakeHeld = false;
      else if (key === 'arrowup' || key === 'w') this.gasHeld = false;
      this.heldSteer = (this.leftHeld ? -1 : 0) + (this.rightHeld ? 1 : 0);
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
    this.shiftHeld = false;
    this.uiHandbrake = false;
    this.heldSteer = 0;
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
