export const ROAD_HALF_WIDTH = 5.0;
export const TRACK_LENGTH_DEFAULT = 1800;
export const SAMPLE_STEP = 2; // meters between track spline samples

export const BASE_SPEED = 37;
export const END_SPEED_BONUS = 9; // extra top speed by the final stretch
export const NITRO_SPEED = 62;
export const NITRO_TIME = 2.4;
export const OFFROAD_SPEED = 13;
export const BRAKE_SPEED = 10;    // crawl target while the brake is held
export const COAST_SPEED = 16;    // rolls down to this with the gas released
export const ACCEL = 10;
export const BRAKE = 16;
export const COAST_DECEL = 5;     // engine-brake rate when off the gas

export const CENTRIFUGAL = 0.55; // how hard corners throw the car outward

// wall crashes: reaching the road edge while the corner force (not steering)
// is still shoving you outward past this speed wrecks the car
export const WALL_CRASH_DRIFT = 2.2;
export const WALL_CRASH_MIN_V = 26;
// curvature a base-grip car can no longer take flat out — chevron boards go
// up ahead of these corners and rival AI brakes for them
export const SHARP_CORNER_K = 0.0165;
export const RIVAL_LAT_GRIP = 17; // v²·k ceiling the AI brakes down to

export const RIVAL_COUNT = 3;

// every map has three districts along the lap (see maps.ts)
export const DISTRICTS_PER_MAP = 3;

export function districtIndexAt(s: number, trackLength: number): number {
  const t = Math.max(0, Math.min(0.999, s / trackLength));
  return Math.floor(t * DISTRICTS_PER_MAP);
}
