// Game modes. One race loop, three flavors — the mode tunes grid size,
// zombie pressure, contact rules and lap count instead of forking the code.

export interface ModeSpec {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  rivals: number;      // grid size − 1
  zombieMul: number;   // zombie cluster density multiplier
  tumble: boolean;     // hard contact wrecks cars (Burnout rules)
  aggression: number;  // 0..1 — how hard rivals hunt the player's lane
  lapsLocked?: number; // force a lap count (menu picker is ignored)
  pursuit?: boolean;   // Cop Chase: one indestructible pursuer, heat on contact
  guns?: boolean;      // tap fires the gun instead of nitro (pill fires nitro)
  latchers?: boolean;  // zombies cling to the car; shoot or scrape them off
  featured?: boolean;  // show directly on the main menu
  heist?: boolean;     // Armored Heist: lead vehicle drops cash/bounty on hits & wreck
  infected?: boolean;  // Infected Juggernaut: rivals infect player on hit; 10 splats cures + EMP
  voltage?: boolean;   // Voltage Surge: nitro locked max, battery drains over time unless recharged
}

export const MODES: ModeSpec[] = [
  {
    id: 'gp', name: 'GRAND PRIX', icon: '🏁',
    tagline: 'Clean-ish racing. Beat 3 rivals over the line.',
    rivals: 3, zombieMul: 1, tumble: false, aggression: 0, featured: true
  },
  {
    id: 'burnout', name: 'BURNOUT', icon: '🔥',
    tagline: 'Eight cars, no rules. Nitro-slam rivals to wreck them.',
    rivals: 7, zombieMul: 0.5, tumble: true, aggression: 1, featured: true
  },
  {
    id: 'outbreak', name: 'OUTBREAK', icon: '🧟',
    tagline: 'Solo lap through the horde. Chain splats, chase the combo.',
    rivals: 0, zombieMul: 3, tumble: false, aggression: 0, lapsLocked: 1, featured: true
  },
  {
    id: 'hijack', name: 'HORDE HIJACK', icon: '🧟‍♂️',
    tagline: 'Zombies leap onto the car and drag you down. Shoot or scrape them off.',
    rivals: 2, zombieMul: 2.4, tumble: false, aggression: 0.25, guns: true, latchers: true,
    lapsLocked: 1
  },
  {
    id: 'copchase', name: 'COP CHASE', icon: '🚓',
    tagline: 'Outrun the law for 2 laps — 3 quick hits = BUSTED. Tap to shoot them back.',
    rivals: 1, zombieMul: 1, tumble: false, aggression: 1, lapsLocked: 2,
    pursuit: true, guns: true
  },
  {
    id: 'gunrun', name: 'GUN RUN', icon: '🔫',
    tagline: 'Armed and dangerous. Tap to shoot tires — grab crates for ammo.',
    rivals: 5, zombieMul: 1.5, tumble: true, aggression: 0.6, guns: true
  },
  {
    id: 'timeattack', name: 'TIME ATTACK', icon: '⏱️',
    tagline: 'Solo ghost run. No rivals, just the perfect lap and your best replay.',
    rivals: 0, zombieMul: 0.45, tumble: false, aggression: 0, lapsLocked: 1
  },
  {
    id: 'eliminator', name: 'ELIMINATOR', icon: '💀',
    tagline: 'A compact knockout sprint. Eight cars, high aggression, no comfort zone.',
    rivals: 7, zombieMul: 0.75, tumble: true, aggression: 0.85
  },
  {
    id: 'trafficjam', name: 'TRAFFIC JAM', icon: '🚧',
    tagline: 'Dense pack racing with lighter hordes. Near misses and clean exits matter.',
    rivals: 5, zombieMul: 0.35, tumble: false, aggression: 0.35
  },
  {
    id: 'heist', name: 'ARMORED HEIST', icon: '📦',
    tagline: 'Slam or shoot the Boss Truck for cash loot. Wreck it for a +1000 pt bounty!',
    rivals: 5, zombieMul: 0.8, tumble: true, aggression: 0.7, guns: true, featured: true, heist: true
  },
  {
    id: 'infected', name: 'INFECTED JUGGERNAUT', icon: '🦠',
    tagline: 'Hyper-aggressive infected rivals! Splat 10 zombies to cure virus and trigger EMP.',
    rivals: 7, zombieMul: 1.8, tumble: true, aggression: 1, featured: true, infected: true
  },
  {
    id: 'voltage', name: 'VOLTAGE SURGE', icon: '⚡',
    tagline: 'Nitro locked at 100%! Battery drains continuously — grab nitro pods or stall out.',
    rivals: 5, zombieMul: 1.2, tumble: false, aggression: 0.5, featured: true, voltage: true
  }
];
