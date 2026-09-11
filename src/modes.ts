// Game modes. One race loop, several flavors — the mode tunes grid size,
// contact rules and lap count instead of forking the code.
import type { CarClass } from './cars';

export interface ModeSpec {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  rivals: number;      // grid size − 1
  tumble: boolean;     // hard contact wrecks cars (Burnout rules)
  aggression: number;  // 0..1 — how hard rivals hunt the player's lane
  lapsLocked?: number; // force a lap count (menu picker is ignored)
  pursuit?: boolean;   // Police Chase: the whole field is police; contact is heat
  guns?: boolean;      // tap fires the gun instead of nitro (pill fires nitro)
  featured?: boolean;  // one of the core modes on the main menu
  heist?: boolean;     // Armored Heist: lead vehicle drops cash/bounty on hits & wreck
  voltage?: boolean;   // Voltage Surge: nitro locked max, battery drains over time unless recharged
  noTraffic?: boolean; // no civilian cars: the road belongs to the racers
  pro?: boolean;       // the rival field drives at pro pace (see PRO_* in constants.ts)
  trackLength?: number; // lap length (m) this mode stretches the circuit to
  /**
   * Restrict the grid to one garage shelf. The player needs an owned car of
   * this class to enter, and the AI field is drawn from the same shelf — so a
   * class mode reads as its own championship rather than a handicap.
   */
  requiresClass?: CarClass;
}

export const MODES: ModeSpec[] = [
  {
    id: 'gp', name: 'GRAND PRIX', icon: '🏁',
    tagline: 'Clean-ish racing. Beat 3 rivals over the line.',
    rivals: 3, tumble: false, aggression: 0, featured: true
  },
  {
    id: 'burnout', name: 'BURNOUT', icon: '🔥',
    tagline: 'Eight cars, no rules. Nitro-slam rivals to wreck them.',
    rivals: 7, tumble: true, aggression: 1, featured: true
  },
  {
    id: 'copchase', name: 'POLICE CHASE', icon: '🚓',
    tagline: 'Units behind run you down, units ahead ram you. Escape for 3 laps or get BUSTED.',
    rivals: 5, tumble: false, aggression: 1, lapsLocked: 3,
    pursuit: true
  },
  {
    id: 'gunrun', name: 'GUN RUN', icon: '🔫',
    tagline: 'Armed and dangerous. Tap to shoot tires — grab crates for ammo.',
    rivals: 5, tumble: true, aggression: 0.6, guns: true
  },
  {
    id: 'timeattack', name: 'TIME ATTACK', icon: '⏱️',
    tagline: 'Solo ghost run. No rivals, just the perfect lap and your best replay.',
    rivals: 0, tumble: false, aggression: 0, lapsLocked: 1
  },
  {
    id: 'eliminator', name: 'ELIMINATOR', icon: '💀',
    tagline: 'A compact knockout sprint. Eight cars, high aggression, no comfort zone.',
    rivals: 7, tumble: true, aggression: 0.85, featured: true
  },
  {
    id: 'trafficjam', name: 'TRAFFIC JAM', icon: '🚧',
    tagline: 'Dense pack racing. Near misses and clean exits matter.',
    rivals: 5, tumble: false, aggression: 0.35
  },
  {
    id: 'heist', name: 'ARMORED HEIST', icon: '📦',
    tagline: 'Slam or shoot the Boss Truck for cash loot. Wreck it for a +1000 pt bounty!',
    rivals: 5, tumble: true, aggression: 0.7, guns: true, heist: true
  },
  {
    id: 'hypercup', name: 'HYPER CUP', icon: '🏆',
    tagline: 'Hypercars only. Six of them, two laps, nowhere to hide.',
    rivals: 5, tumble: false, aggression: 0.55, lapsLocked: 2,
    requiresClass: 'hyper', featured: true
  },
  {
    id: 'voltage', name: 'VOLTAGE SURGE', icon: '⚡',
    tagline: 'Nitro locked at 100%! Battery drains continuously — grab nitro pods or stall out.',
    rivals: 5, tumble: false, aggression: 0.5, voltage: true
  },
  // Appended, never inserted: MR1 receipts store a mode's index.
  {
    id: 'hardcore', name: 'HARDCORE', icon: '🏎️',
    tagline: 'No traffic. Seven pro drivers on a long circuit, street cars only. Win the bounty race.',
    rivals: 7, tumble: false, aggression: 0, lapsLocked: 2,
    requiresClass: 'fast', noTraffic: true, pro: true, trackLength: 3000, featured: true
  }
];

/**
 * Modes the Weekly Cup rotates through, as MODES indices. HARDCORE is the
 * bounty race and runs on its own, and leaving it out keeps every earlier
 * week's cup on the mode it already had.
 */
export const CUP_MODES = MODES.map((_, i) => i).filter((i) => !MODES[i].pro);
