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
export const RIVAL_LAT_GRIP = 60; // v²·k ceiling the AI brakes down to — a committed player carries up to ~100
export const PURSUIT_LAT_GRIP = 17; // Police Chase keeps the corner pace it was balanced at
export const RIVAL_BRAKE = 40;    // m/s² the AI can scrub on the approach to a bend
// Under WALL_CRASH_MIN_V, so like the player a rival can scrape through any
// hairpin at this speed without being thrown off.
export const RIVAL_MIN_CORNER_SPEED = 22;
// The field races the car you brought: rivals match this share of your car's
// top-speed edge, so a faster car is an advantage rather than a walkover.
export const RIVAL_PACE_SHARE = 0.5;
export const RIVAL_CATCHUP = 7;      // m/s a rival finds once it has dropped well behind you
export const RIVAL_NITRO_EVERY = 13; // seconds between nitro tanks for an AI driver

// HARDCORE's pro field: matches the whole of your car's top-speed edge, finds a
// little more on the straights, commits harder to corners and boosts more often.
export const PRO_PACE_SHARE = 1;
// m/s over the ordinary field's straight-line pace. At 1.2 the best sim driver
// never won a HARDCORE race; at 0.5 it wins now and then and loses by ~2 s.
export const PRO_PACE_BONUS = 0.5;
export const PRO_SKILL = 1.12;      // corner judgement floor (the ordinary field runs 0.92–1.14)
export const PRO_NITRO_EVERY = 10;

export const RIVAL_COUNT = 3;

// Police Chase. Every cop touch is heat, and heat cools after a clean spell —
// the chase should be a running battle you can recover from, not three taps and
// out. PIT_SCRUB is the fraction of your speed a PIT tap leaves you.
export const HEAT_LIMIT = 4;
export const HEAT_COOL = 5;
export const PIT_SCRUB = 0.9;
export const HEAT_GRACE = 2.0; // seconds after a PIT before another can add heat

// every map has three districts along the lap (see maps.ts)
export const DISTRICTS_PER_MAP = 3;

export function districtIndexAt(s: number, trackLength: number): number {
  if (!Number.isFinite(s) || !Number.isFinite(trackLength) || trackLength <= 0) return 0;
  const t = Math.max(0, Math.min(0.999, s / trackLength));
  return Math.floor(t * DISTRICTS_PER_MAP);
}
