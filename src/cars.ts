// The garage. Stats are multipliers around 1.0 applied in player.ts —
// speed scales top speed, accel the ramp-up, grip steering authority
// (and tames the centrifugal push), nitro the burn time.
export interface CarSpec {
  id: string;
  name: string;
  blurb: string;
  color: number; // UI chip + underglow + procedural fallback paint
  model: number; // -1 = car_player.glb, 0..5 = car_traffic_{n+1}.glb
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
  }
];
