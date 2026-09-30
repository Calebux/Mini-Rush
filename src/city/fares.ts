import { deposit } from '../economy';
import { BLOCKS, BRIDGE_Z, EAST_ISLAND_X1, PITCH, STREET, streetAt } from './layout';
import { P, route, routeLength } from './roads';

/**
 * PASSENGER mode's dispatcher. A fare is offered; accept it and the
 * passenger is standing on the pavement at the pickup, waiting. Stop beside
 * them and they get in; the destination and a timer follow; arrive and stop
 * and they get out and pay. Then the next fare comes in.
 */

export interface Place extends P {
  name: string;
  /** Where the passenger stands: on the pavement beside the road point. */
  stand: P;
}

export type FareStage = 'offer' | 'pickup' | 'boarding' | 'ride' | 'alighting' | 'paid';

export interface FareStatus {
  stage: FareStage;
  title: string;
  detail: string;
  action: string | null;        // a button to show, if the stage has one
  target: (P & { label: string; color: number }) | null;
  timer: number;                // seconds left on the ride, 0 when not riding
}

const NAMES = {
  neon: ['MIKA', 'JUNO', 'RIO', 'KAI', 'ZARA', 'OBI', 'NOVA', 'TEX', 'AMARA', 'LEO'],
  kaduna: ['AISHA', 'MUSA', 'BALA', 'HAUWA', 'IBRAHIM', 'ZAINAB', 'EMEKA', 'BLESSING', 'YAKUBU', 'HALIMA', 'SANI', 'NGOZI']
};
/** Kaduna's names for the same twelve kerbs, in PLACES order. */
const KADUNA_PLACES = ['KAWO MOTOR PARK', 'MURTALA SQUARE', 'HAMDALA HOTEL', 'KASUWA', 'BAKIN DOGO', 'RIVER BANK',
  'KAKURI', 'BARNAWA', 'UNGWAN RIMI', 'TUDUN WADA', 'RAILWAY STATION', 'SABON TASHA'];

/**
 * A spot on a street beside block (i, j)'s kerb, facing that block's `side`.
 * `at` along the block edge: 0.5 is the middle.
 */
function kerb(name: string, i: number, j: number, side: 'n' | 's' | 'e' | 'w', at = 0.5): Place {
  const x0 = streetAt(i), z0 = streetAt(j);
  const along = (PITCH - STREET) * (at - 0.5);
  const road = STREET / 2 - 3.2;              // the kerbside lane
  const pave = STREET / 2 + 1.3;              // a step onto the pavement
  const mid = { x: x0 + PITCH / 2, z: z0 + PITCH / 2 };
  switch (side) {
    case 'n': return { name, x: mid.x + along, z: z0 + road, stand: { x: mid.x + along, z: z0 + pave } };
    case 's': return { name, x: mid.x + along, z: z0 + PITCH - road, stand: { x: mid.x + along, z: z0 + PITCH - pave } };
    case 'w': return { name, x: x0 + road, z: mid.z + along, stand: { x: x0 + pave, z: mid.z + along } };
    default: return { name, x: x0 + PITCH - road, z: mid.z + along, stand: { x: x0 + PITCH - pave, z: mid.z + along } };
  }
}

export const PLACES: Place[] = [
  kerb('NEON TOWER', 5, 5, 'n'),
  kerb('CENTRAL PLAZA', 3, 3, 'e'),
  kerb('EAST PLAZA', 8, 7, 'w'),
  kerb('NIGHT MARKET', 1, 4, 'e', 0.3),
  kerb('LANTERN ALLEY', 0, 8, 'e', 0.6),
  kerb('HARBOUR GATE', 5, BLOCKS - 1, 'n', 0.4),
  kerb('CONTAINER YARD', 9, BLOCKS - 1, 'n', 0.6),
  kerb('MIDTOWN HOTEL', 9, 2, 's'),
  kerb('SKYLINE ARCADE', 6, 1, 'w'),
  kerb('CIRCUIT CLUB', 10, 9, 'n'),
  kerb('OLD CINEMA', 2, 10, 'n'),
  { name: 'FERRY TERMINAL', x: EAST_ISLAND_X1 - 110, z: BRIDGE_Z + 20,
    stand: { x: EAST_ISLAND_X1 - 110, z: BRIDGE_Z + 26 } }
];

const PURPLE = 0x8b5cf6, YELLOW = 0xfcff52;
const CRUISE = 13;            // m/s a fair drive averages through the city
const GRACE = 25;             // seconds on top, for stopping and traffic

export class FareDispatch {
  stage: FareStage = 'offer';
  name = '';
  pickup: Place = PLACES[0];
  dropoff: Place = PLACES[1];
  pay = 0;
  limit = 0;
  private timeLeft = 0;
  private paidFor = 0;
  private rand = Math.random;
  completed = 0;
  earned = 0;

  private places: Place[];
  private names: string[];

  constructor(from: P, city: 'neon' | 'kaduna' = 'neon') {
    this.places = city === 'kaduna' ? PLACES.map((p, i) => ({ ...p, name: KADUNA_PLACES[i] ?? p.name })) : PLACES;
    this.names = NAMES[city];
    this.pickup = this.places[0];
    this.dropoff = this.places[1];
    this.offer(from);
  }

  /** Roll a new fare: a pickup a little way off, a destination well away from it. */
  offer(from: P): void {
    const far = (a: P, b: P, min: number) => Math.hypot(a.x - b.x, a.z - b.z) > min;
    const pick = (list: Place[]) => list[Math.floor(this.rand() * list.length)];
    const starts = this.places.filter((p, i) => far(p, from, 160) && i !== this.places.length - 1);
    this.pickup = pick(starts.length ? starts : this.places);
    const ends = this.places.filter((p) => p !== this.pickup && far(p, this.pickup, 380));
    this.dropoff = pick(ends.length ? ends : this.places.filter((p) => p !== this.pickup));
    this.name = this.names[Math.floor(this.rand() * this.names.length)];
    const metres = routeLength(route(this.pickup, this.dropoff));
    this.limit = Math.round(metres / CRUISE + GRACE);
    this.pay = Math.round((50 + metres * 0.12) / 5) * 5;
    this.stage = 'offer';
  }

  accept(): void {
    if (this.stage === 'offer') this.stage = 'pickup';
  }

  /** Pass on this one and roll another. */
  skip(from: P): void {
    if (this.stage === 'offer') this.offer(from);
  }

  /** The car is stopped here: does a stage begin? Returns what happens, if anything. */
  arrive(x: number, z: number, stopped: boolean): 'board' | 'alight' | null {
    const near = (p: P, r: number) => Math.hypot(p.x - x, p.z - z) < r;
    if (this.stage === 'pickup' && stopped && near(this.pickup.stand, 13)) {
      this.stage = 'boarding';
      return 'board';
    }
    if (this.stage === 'ride' && stopped && near(this.dropoff, 16)) {
      this.stage = 'alighting';
      return 'alight';
    }
    return null;
  }

  boarded(): void {
    if (this.stage !== 'boarding') return;
    this.stage = 'ride';
    this.timeLeft = this.limit;
  }

  /** Paid on arrival: the full fare in time, half of it late. */
  alighted(): number {
    if (this.stage !== 'alighting') return 0;
    const late = this.timeLeft <= 0;
    this.paidFor = late ? Math.round(this.pay / 2) : this.pay;
    deposit(this.paidFor);
    this.completed++;
    this.earned += this.paidFor;
    this.stage = 'paid';
    return this.paidFor;
  }

  /** Busted mid-fare: the passenger walks off unpaid, and a new fare comes in. */
  cancel(from: P): boolean {
    if (this.stage === 'offer' || this.stage === 'paid') return false;
    this.offer(from);
    return true;
  }

  tick(dt: number): void {
    if (this.stage === 'ride') this.timeLeft -= dt;
  }

  status(): FareStatus {
    const toPickup = { ...this.pickup.stand, label: `PICK UP ${this.name}`, color: PURPLE };
    const toDrop = { x: this.dropoff.x, z: this.dropoff.z, label: this.dropoff.name, color: YELLOW };
    switch (this.stage) {
      case 'offer':
        return { stage: this.stage, title: `FARE · ${this.name}`, action: 'ACCEPT RIDE', target: null, timer: 0,
          detail: `${this.pickup.name} → ${this.dropoff.name} · ${this.pay} COINS · ${this.limit}s` };
      case 'pickup':
        return { stage: this.stage, title: `PICK UP ${this.name}`, action: null, target: toPickup, timer: 0,
          detail: `Waiting at ${this.pickup.name}. Stop beside them.` };
      case 'boarding':
        return { stage: this.stage, title: `${this.name} IS GETTING IN`, action: null, target: null, timer: 0,
          detail: `Next stop: ${this.dropoff.name}` };
      case 'ride':
        return { stage: this.stage, title: `TO ${this.dropoff.name}`, action: null, target: toDrop,
          timer: Math.max(0, this.timeLeft),
          detail: this.timeLeft > 0 ? `${this.pay} COINS if you make it in time` : `LATE · half fare: ${Math.round(this.pay / 2)} COINS` };
      case 'alighting':
        return { stage: this.stage, title: `${this.name} IS GETTING OUT`, action: null, target: null, timer: 0,
          detail: this.dropoff.name };
      default:
        return { stage: this.stage, title: `PAID · +${this.paidFor} COINS`, action: 'NEXT FARE', target: null, timer: 0,
          detail: `${this.completed} fare${this.completed === 1 ? '' : 's'} tonight · ${this.earned} coins` };
    }
  }
}
