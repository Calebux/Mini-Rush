import type { CarSpec } from './cars';
import { SPEED_DISPLAY } from './constants';
import './testDrive.css';

export type TestSetup = 'fitted' | 'stock';
export const TEST_LENGTH = 900;
export const TEST_SEED = 27041;

/** Read the same multipliers the physics uses, including fitted parts. */
export function handlingProfile(spec: CarSpec): { name: string; detail: string } {
  const traits = [
    { value: spec.grip, name: 'Corner specialist', detail: 'Stronger braking, quicker steering recovery and less outward push. Carry a tidy line through the bends.' },
    { value: spec.accel, name: 'Quick-launch build', detail: 'Acceleration leads this setup. Brake early, straighten the car, then power out.' },
    { value: spec.speed, name: 'High-speed build', detail: 'Top speed leads this setup. Use the straights; lift before the tighter corners.' },
    { value: spec.nitro, name: 'Long-boost build', detail: 'Nitro duration leads this setup. Save the tank for a straight exit.' }
  ].sort((a, b) => b.value - a.value);
  return traits[0].value - traits[3].value < .06
    ? { name: 'Balanced build', detail: 'Evenly matched pace and handling. Use this as your reference before changing parts.' }
    : traits[0];
}

export interface TestSample {
  time: number; dt: number; speed: number; distance: number;
  gas: boolean; braking: boolean; offroad: boolean; drifting: boolean; nitro: boolean;
}

export class TestTelemetry {
  peak = 0;
  launch: number | null = null;
  offroad = 0;
  braking = 0;
  boostUsed = false;
  private launchStart: number | null = null;
  private previousSpeed = 0;
  get started(): boolean { return this.launchStart !== null; }
  sample(s: TestSample): void {
    const kmh = s.speed * 3.6 * SPEED_DISPLAY;
    this.peak = Math.max(this.peak, kmh);
    this.offroad += s.offroad ? s.dt : 0;
    this.braking += s.braking ? s.dt : 0;
    this.boostUsed ||= s.nitro;
    if (this.launchStart === null && s.gas) this.launchStart = s.time - s.dt;
    if (this.launch === null && this.launchStart !== null && kmh >= 100) {
      const fraction = Math.max(0, Math.min(1, (100 - this.previousSpeed) / Math.max(.001, kmh - this.previousSpeed)));
      this.launch = Math.max(0, s.time - s.dt + fraction * s.dt - this.launchStart);
    }
    this.previousSpeed = kmh;
  }
}

interface TestResult { setup: TestSetup; time: number; }
const setupName = (setup: TestSetup) => setup === 'stock' ? 'Stock baseline' : 'Fitted build';

/** Practice has its own report: it never calls the race reward/leaderboard UI. */
export class TestDrive {
  onStart: (setup: TestSetup) => void = () => {};
  onExit: () => void = () => {};
  onPause: () => void = () => {};
  telemetry = new TestTelemetry();
  setup: TestSetup = 'fitted';
  private spec!: CarSpec;
  private length = TEST_LENGTH;
  private previous = new Map<string, TestResult>();
  private root = document.createElement('section');
  private hud = document.createElement('section');
  private live!: HTMLElement;
  private feedback!: HTMLElement;

  constructor() {
    this.root.id = 'test-drive'; this.root.className = 'overlay hidden';
    this.root.setAttribute('aria-label', 'Garage test drive');
    this.hud.id = 'test-drive-hud'; this.hud.hidden = true;
    this.hud.innerHTML = `<div><small>TEST DRIVE / <span id="test-setup-label"></span></small><strong id="test-live">Ready</strong><span id="test-feedback">Hold the accelerator to launch.</span></div><nav aria-label="Test drive controls"><button type="button" data-test="pause">Pause</button><button type="button" data-test="restart">Restart</button><button type="button" data-test="exit">Garage</button></nav>`;
    document.body.append(this.hud, this.root);
    this.live = this.hud.querySelector('#test-live')!;
    this.feedback = this.hud.querySelector('#test-feedback')!;
    for (const node of [this.root, this.hud]) node.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-test]');
      if (!button) return;
      button.blur();
      const action = button.dataset.test;
      if (action === 'exit') this.onExit();
      else if (action === 'pause') this.onPause();
      else this.onStart(action === 'stock' ? 'stock' : action === 'fitted' ? 'fitted' : this.setup);
    });
  }

  open(spec: CarSpec): void {
    this.spec = spec;
    const profile = handlingProfile(spec);
    this.root.innerHTML = `<div class="td-card"><span class="td-eyebrow">CUSTOMS / PROVING GROUND</span><h1>Feel your build.</h1><p class="td-car"></p><div class="td-profile"><strong></strong><p></p></div><div class="td-specs"></div><p>One 0.9 km lap in Lagos. Fixed course, dry road, no traffic or rivals. One practice nitro tank per run.</p><p class="td-note">Stock keeps your car’s appearance and resets its four performance stats for this test only. No rewards, entry fees, or inventory consumed.</p><div class="td-actions"><button data-test="fitted" class="td-primary">DRIVE FITTED BUILD ↗</button><button data-test="stock">TRY STOCK BASELINE</button><button data-test="exit" class="td-back">BACK TO GARAGE</button></div><small class="td-controls">Arrow keys / WASD to drive · Space for nitro · Esc to pause.<br>On touch: hold GAS, drag to steer, hold BRAKE to slow down.</small></div>`;
    this.root.querySelector('.td-car')!.textContent = spec.build?.name ? `${spec.name} · ${spec.build.name}` : spec.name;
    this.root.querySelector('.td-profile strong')!.textContent = profile.name;
    this.root.querySelector('.td-profile p')!.textContent = profile.detail;
    const stats = this.root.querySelector('.td-specs')!;
    for (const [key, label] of [['speed', 'Speed'], ['accel', 'Launch'], ['grip', 'Grip'], ['nitro', 'Nitro']] as const) {
      const item = document.createElement('div');
      item.innerHTML = `<span>${label}</span><strong>${Math.round(spec[key] * 100)}</strong>`;
      stats.append(item);
    }
    this.root.classList.remove('hidden');
    this.root.querySelector<HTMLButtonElement>('[data-test=fitted]')!.focus();
  }

  begin(setup: TestSetup, spec: CarSpec, length: number): void {
    this.length = length;
    this.spec = spec; this.setup = setup; this.telemetry = new TestTelemetry();
    this.root.classList.add('hidden'); this.hud.hidden = false;
    document.body.classList.add('test-driving');
    this.hud.querySelector('#test-setup-label')!.textContent = setupName(setup);
    this.live.textContent = `${Math.round(length)} m · Dry circuit`;
    this.feedback.textContent = 'Hold the accelerator to launch.';
  }

  update(sample: TestSample): void {
    this.telemetry.sample(sample);
    this.live.textContent = `${sample.time.toFixed(1)}s · ${Math.max(0, Math.round(this.length - sample.distance))} m left`;
    this.feedback.textContent = sample.offroad ? 'Off the tarmac — ease back onto your line.'
      : sample.drifting ? 'Sliding — release the brake to drive out.'
      : sample.braking ? 'Braking — straighten the car before accelerating.'
      : sample.nitro ? 'Boosting — give the car room on corner exit.'
      : !sample.gas ? 'Coasting — hold GAS to accelerate.' : 'Find your braking point. Keep the exit clean.';
  }

  finish(time: number): void {
    this.hud.hidden = true; document.body.classList.remove('test-driving');
    const previous = this.previous.get(this.spec.id);
    const delta = previous ? time - previous.time : null;
    const t = this.telemetry;
    this.root.innerHTML = `<div class="td-card"><span class="td-eyebrow">TEST COMPLETE / ${setupName(this.setup).toUpperCase()}</span><h1>Your build, measured.</h1><p class="td-car"></p><div class="td-time">${time.toFixed(2)}<small>seconds</small></div><p class="td-comparison"></p><div class="td-measures"><div><span>0–100 km/h</span><strong>${t.launch === null ? 'Not reached' : `${t.launch.toFixed(2)} s`}</strong></div><div><span>Peak speed</span><strong>${Math.round(t.peak)} km/h</strong></div><div><span>Time braking</span><strong>${t.braking.toFixed(1)} s</strong></div><div><span>Off the tarmac</span><strong>${t.offroad.toFixed(1)} s</strong></div></div><p class="td-note">Speeds match the game speedometer. Launch is timed from your first throttle input. ${t.boostUsed ? 'Nitro was used this run.' : 'No nitro used this run.'} Driving line and boost timing affect comparisons.</p><div class="td-actions"><button data-test="restart" class="td-primary">RUN IT AGAIN ↻</button><button data-test="${this.setup === 'stock' ? 'fitted' : 'stock'}">${this.setup === 'stock' ? 'COMPARE FITTED BUILD' : 'COMPARE STOCK BASELINE'}</button><button data-test="exit" class="td-back">BACK TO GARAGE / TUNE</button></div><small class="td-controls">Practice only · No rewards or race records</small></div>`;
    this.root.querySelector('.td-car')!.textContent = `${this.spec.name} · ${handlingProfile(this.spec).name}`;
    this.root.querySelector('.td-comparison')!.textContent = previous && delta !== null
      ? `${delta === 0 ? 'Same time' : `${Math.abs(delta).toFixed(2)}s ${delta < 0 ? 'quicker' : 'slower'}`} than your previous ${setupName(previous.setup).toLowerCase()} run (${previous.time.toFixed(2)}s).`
      : 'First completed test for this car. Run the other setup to compare.';
    this.previous.set(this.spec.id, { setup: this.setup, time });
    this.root.classList.remove('hidden');
    this.root.querySelector<HTMLButtonElement>('[data-test=restart]')!.focus();
  }

  close(): void {
    this.root.classList.add('hidden'); this.hud.hidden = true;
    document.body.classList.remove('test-driving');
  }
}
