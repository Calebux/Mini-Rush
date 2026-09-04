// The garage. Stats are multipliers around 1.0 applied in player.ts —
// speed scales top speed, accel the ramp-up, grip steering authority
// (and tames the centrifugal push), nitro the burn time.
export interface CarSpec {
  id: string;
  name: string;
  blurb: string;
  color: number; // UI chip + underglow + procedural fallback paint
  model: number; // -1 = car_player.glb, 0..5 = traffic, 100..104 = supercar
                 // market slots, 200+ = imported cars (assets/models/imported).
                 // Slots with no licensed model on disk render procedurally in
                 // `color` — see AssetLibrary.cloneCar.
  speed: number;
  accel: number;
  grip: number;
  nitro: number;
  price: number; // coins to unlock in the garage; 0 = free starter
}

export const CARS: CarSpec[] = [
  {
    id: 'viper', name: 'VIPER GT', blurb: 'Balanced all-rounder',
    color: 0xff2e8a, model: -1, speed: 1.0, accel: 1.0, grip: 1.0, nitro: 1.0,
    price: 0
  },
  {
    id: 'sunburst', name: 'SUNBURST', blurb: 'Wins every launch',
    color: 0xff9a1f, model: 2, speed: 0.96, accel: 1.28, grip: 1.0, nitro: 0.95,
    price: 60
  },
  {
    id: 'gecko', name: 'GECKO', blurb: 'Glued to the apex',
    color: 0xa3ff2e, model: 1, speed: 0.95, accel: 1.05, grip: 1.22, nitro: 0.9,
    price: 150
  },
  {
    id: 'phantom', name: 'PHANTOM', blurb: 'Nitro burns way longer',
    color: 0x8b5cf6, model: 3, speed: 0.98, accel: 0.95, grip: 0.96, nitro: 1.55,
    price: 300
  },
  {
    id: 'volt', name: 'THUNDERVOLT', blurb: 'Nothing outruns it — eventually',
    color: 0x00d9ff, model: 0, speed: 1.08, accel: 0.82, grip: 0.92, nitro: 1.0,
    price: 500
  },
  {
    id: 'juggernaut', name: 'JUGGERNAUT', blurb: 'Bulldoze everything. Unstoppable.',
    color: 0x556b2f, model: 4, speed: 0.88, accel: 0.9, grip: 1.35, nitro: 0.85,
    price: 400
  },
  {
    id: 'sidewinder', name: 'SIDEWINDER', blurb: 'Born to slide — drift king',
    color: 0xff6ec7, model: 5, speed: 0.97, accel: 1.0, grip: 0.78, nitro: 1.1,
    price: 250
  },
  {
    id: 'glasscannon', name: 'GLASS CANNON', blurb: 'Fragile speed demon',
    color: 0xffd700, model: 1, speed: 1.15, accel: 0.88, grip: 0.75, nitro: 0.9,
    price: 600
  },
  {
    id: 'r8', name: 'AURORA V10', blurb: 'Clean supercar balance',
    color: 0x4dd8ff, model: 100, speed: 1.12, accel: 1.08, grip: 1.05, nitro: 0.98,
    price: 900
  },
  {
    id: 'sesto', name: 'CINDER R', blurb: 'Ultra-light corner hunter',
    color: 0xd8ff2f, model: 101, speed: 1.13, accel: 1.05, grip: 1.1, nitro: 0.96,
    price: 980
  },
  {
    id: 'aventador', name: 'AVANTI SV', blurb: 'Brutal launch, heavy bite',
    color: 0xff4a1f, model: 102, speed: 1.14, accel: 1.12, grip: 0.95, nitro: 1.0,
    price: 1100
  },
  {
    id: 'divo', name: 'DERVISH', blurb: 'Aero grip for late braking',
    color: 0x2fd8ff, model: 103, speed: 1.11, accel: 1.0, grip: 1.16, nitro: 0.96,
    price: 1150
  },
  {
    id: 'tourbillon', name: 'TOURMALINE', blurb: 'Hybrid top-end monster',
    color: 0x6f7cff, model: 104, speed: 1.18, accel: 0.98, grip: 1.03, nitro: 1.1,
    price: 1200
  },
  {
    id: 'stockcar', name: 'STOCK 88', blurb: 'Oval-bred bruiser — flat out, forever',
    color: 0xd32f2f, model: 200, speed: 1.16, accel: 0.94, grip: 1.12, nitro: 0.92,
    price: 800
  }
];
