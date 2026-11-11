import { ACCEL } from './constants';

/** Bounded acceleration in world m/s². Top speed is separate: a tall-ratio
 * build cannot get a free launch from its higher target speed. */
export function accelerationAt(speed: number, launch: number, boosting: boolean): number {
  const taper = 1 - .35 * Math.min(1, Math.max(0, speed) / 40);
  return ACCEL * launch * taper * (boosting ? 1.8 : 1);
}

export function approachSpeed(speed: number, target: number, rate: number, dt: number): number {
  const step = Math.max(0, rate) * Math.max(0, dt);
  return speed < target ? Math.min(target, speed + step) : Math.max(target, speed - step);
}

/** Grip buys shorter braking and quicker settling as well as steering.
 * Bounds keep extreme upgrades/weather physically sane. */
export function chassisResponse(grip: number, weather = 1) {
  const traction = Math.max(.5, Math.min(1.7, grip * weather));
  return {
    traction, braking: Math.sqrt(traction), steering: Math.pow(traction, 1.4),
    settling: 6 * Math.sqrt(traction), cornerPush: Math.pow(traction, -1.5)
  };
}
