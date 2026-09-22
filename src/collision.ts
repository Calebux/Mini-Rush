/**
 * Cars as solid bodies.
 *
 * Contact in a race is an impulse — `Player.bump`, and the speed cuts either
 * side of it — sitting behind a 0.5s cooldown so one touch can't re-fire every
 * frame. Nothing held the two bodies apart during that cooldown, so a car
 * could drive clean through another and come out the far side. It showed worst
 * off the grid, where the field is six metres apart in rows of two and bunches
 * the moment the lights go out.
 *
 * This runs every frame on already-integrated positions and does one job: stop
 * two cars occupying the same space. It is deliberately separate from the
 * impulses, which still own how a hit *feels* — scrubbed speed, the shove, the
 * shake, the heat. This only owns whether the bodies can overlap.
 */

/** Centre distance at which two cars are clear of each other, side to side. */
export const CAR_GAP_X = 1.8;
/** …and nose to tail. Traffic shells carry their own length instead. */
export const CAR_GAP_S = 3.8;

/** A hair past touching, so a resolved pair doesn't re-trigger next frame. */
const SLACK = 0.002;

/** Anything with a place on the track and a speed along it. */
export interface Solid {
  s: number;
  x: number;
  v: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * Push `a` and `b` apart if they overlap. `limitA` and `limitB` are how far off
 * centre each may be shoved — they differ, because the player may run wider
 * than the AI ever steers — so nobody is separated through a barrier.
 *
 * Side-by-side contact moves both cars. Nose-into-tail moves only the car
 * behind, and caps its speed to the one in front: being rammed should never
 * hand anyone free road, and a car held up behind another has to go around it
 * rather than through it.
 *
 * Returns true when there was an overlap to resolve.
 */
export function separate(
  a: Solid, b: Solid, limitA: number, limitB: number, gapS = CAR_GAP_S
): boolean {
  const ds = a.s - b.s;
  const penS = gapS - Math.abs(ds);
  if (penS <= 0) return false;
  const penX = CAR_GAP_X - Math.abs(a.x - b.x);
  if (penX <= 0) return false;

  // A car is twice as long as it is wide, so resolving along whichever axis is
  // raw-deeper would call almost every overlap a side-by-side one and squirt
  // rear-enders out sideways. Measuring each depth against its own axis tells
  // a squeeze apart from a nose buried in a tail.
  if (penX / CAR_GAP_X <= penS / gapS) {
    // Exactly stacked still has to pick a side; the tie goes one way.
    const dir = a.x === b.x ? 1 : Math.sign(a.x - b.x);
    const half = penX / 2 + SLACK;
    a.x = clamp(a.x + dir * half, -limitA, limitA);
    b.x = clamp(b.x - dir * half, -limitB, limitB);
    // One of them may be against a barrier with nowhere to go. Whatever it
    // couldn't take, the other one does.
    const short = CAR_GAP_X + SLACK - Math.abs(a.x - b.x);
    if (short > 0) {
      if (Math.abs(a.x) < limitA) a.x = clamp(a.x + dir * short, -limitA, limitA);
      else b.x = clamp(b.x - dir * short, -limitB, limitB);
    }
    return true;
  }

  const lead = ds > 0 ? a : b;
  const trail = ds > 0 ? b : a;
  trail.s = lead.s - gapS - SLACK;
  // Without this the car behind drives back into the gap every frame and the
  // pair grinds instead of sitting nose to tail.
  if (trail.v > lead.v) trail.v = lead.v;
  return true;
}
