// The garage. Stats are multipliers around 1.0 applied in player.ts —
// speed scales top speed, accel the ramp-up, grip steering authority
// (and tames the centrifugal push), nitro the burn time.

/**
 * Which shelf a car sits on in the garage.
 *
 * `junk` is the scrapyard: the little PSX traffic shells, priced for pocket
 * change. None of them out-runs the free starter — they buy you a *character*
 * (grip, launch, nitro, slide) before you step up to something with a top end.
 * `fast` is the middle of the ladder, `hyper` the supercars. Every locked car
 * is bought with NIM; coins pay for upgrades, paint and workshop parts.
 */
import type { Build } from './workshop';
export type CarClass = 'hyper' | 'fast' | 'junk';

export interface CarSpec {
  build?: Build;
  id: string;
  name: string;
  blurb: string;
  class: CarClass;
  color: number; // UI chip + underglow + procedural fallback paint
  model: number; // -1 = car_player.glb, 0..5 = traffic, 100..104 = supercar
                 // market slots, 200+ = imported cars (assets/models/imported).
                 // Slots with no licensed model on disk render procedurally in
                 // `color` — see AssetLibrary.cloneCar.
  speed: number;
  accel: number;
  grip: number;
  nitro: number;
  nim: number;   // NIM to unlock in the garage; 0 = free to drive
}

export const CARS: CarSpec[] = [
  {
    id: 'viper', name: 'VIPER GT', blurb: 'Balanced all-rounder',
    class: 'fast', color: 0xff2e8a, model: -1, speed: 1.00, accel: 1.00, grip: 1.00, nitro: 1.00,
    nim: 0
  },
  {
    id: 'sunburst', name: 'SUNBURST', blurb: 'Scrapyard drag special — all launch',
    class: 'junk', color: 0xff9a1f, model: 2, speed: 0.87, accel: 1.15, grip: 0.95, nitro: 0.85,
    nim: 300
  },
  {
    id: 'gecko', name: 'GECKO', blurb: 'Bald tyres, somehow still grips',
    class: 'junk', color: 0xa3ff2e, model: 1, speed: 0.88, accel: 0.98, grip: 1.12, nitro: 0.85,
    nim: 250
  },
  {
    id: 'phantom', name: 'PHANTOM', blurb: 'Half engine, all nitrous',
    class: 'junk', color: 0x8b5cf6, model: 3, speed: 0.90, accel: 0.92, grip: 0.92, nitro: 1.35,
    nim: 400
  },
  {
    id: 'volt', name: 'THUNDERVOLT', blurb: 'Rusty, gutless, keeps pulling',
    class: 'junk', color: 0x00d9ff, model: 0, speed: 0.97, accel: 0.80, grip: 0.88, nitro: 0.90,
    nim: 350
  },
  {
    id: 'juggernaut', name: 'JUGGERNAUT', blurb: 'A skip on wheels. Nothing moves it.',
    class: 'junk', color: 0x556b2f, model: 4, speed: 0.86, accel: 0.88, grip: 1.25, nitro: 0.85,
    nim: 500
  },
  {
    id: 'sidewinder', name: 'SIDEWINDER', blurb: 'No grip left — lean into it',
    class: 'junk', color: 0xff6ec7, model: 5, speed: 0.92, accel: 0.98, grip: 0.78, nitro: 1.00,
    nim: 450
  },
  {
    id: 'glasscannon', name: 'GLASS CANNON', blurb: 'One good engine, one bad everything',
    class: 'junk', color: 0xffd700, model: 1, speed: 1.02, accel: 0.86, grip: 0.74, nitro: 0.88,
    nim: 600
  },
  {
    id: 'r8', name: 'AURORA V10', blurb: 'Clean supercar balance',
    class: 'hyper', color: 0x4dd8ff, model: 100, speed: 1.12, accel: 1.08, grip: 1.05, nitro: 0.98,
    nim: 2000
  },
  {
    id: 'sesto', name: 'CINDER R', blurb: 'Ultra-light corner hunter',
    class: 'hyper', color: 0xd8ff2f, model: 101, speed: 1.13, accel: 1.05, grip: 1.10, nitro: 0.96,
    nim: 2200
  },
  {
    id: 'aventador', name: 'AVANTI SV', blurb: 'Brutal launch, heavy bite',
    class: 'hyper', color: 0xff4a1f, model: 102, speed: 1.14, accel: 1.12, grip: 0.95, nitro: 1.00,
    nim: 2500
  },
  {
    id: 'divo', name: 'DERVISH', blurb: 'Aero grip for late braking',
    class: 'hyper', color: 0x2fd8ff, model: 103, speed: 1.11, accel: 1.00, grip: 1.16, nitro: 0.96,
    nim: 2600
  },
  {
    id: 'tourbillon', name: 'TOURMALINE', blurb: 'Hybrid top-end monster',
    class: 'hyper', color: 0x6f7cff, model: 104, speed: 1.18, accel: 0.98, grip: 1.03, nitro: 1.10,
    nim: 3000
  },
  {
    id: 'stockcar', name: 'STOCK 88', blurb: 'Oval-bred bruiser — flat out, forever',
    class: 'fast', color: 0xd32f2f, model: 200, speed: 1.16, accel: 0.94, grip: 1.12, nitro: 0.92,
    nim: 1200
  },
  { id: 'rush-one', name: 'RUSH ONE', blurb: 'Your chassis. Your build. Made in the workshop.', class: 'fast', color: 0xffc531, model: 300, speed: 1, accel: 1, grip: 1, nitro: 1, nim: 0 }
];
