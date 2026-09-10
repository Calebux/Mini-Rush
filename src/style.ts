// Style meter: near-misses, drifts and takedowns feed a gauge. A full gauge is
// the game's whole economy — it hands you a nitro tank AND steps the score
// multiplier, so driving dangerously is what buys you speed. Contact wipes it.
//
// This is the Burnout loop: risk earns boost, boost earns speed, speed makes
// everything riskier. Keeping style and nitro as separate currencies (style
// paid score, pickups paid boost) meant a player could ignore either one.

export const STYLE_MAX_MULT = 5;

export interface StyleTick {
  levelled: boolean; // the multiplier stepped up
  tanks: number;     // nitro tanks the gauge just earned
}

export class StyleMeter {
  mult = 1;
  gauge = 0; // 0..1 toward the next reward
  score = 0;
  banked = 0; // tanks handed out this race, for the results breakdown

  /** Ticked every racing frame. Returns what the gauge paid out this frame. */
  update(dt: number): StyleTick {
    // Bleed is gentle enough that a clean line keeps its charge between
    // opportunities, but a passive lap still loses it.
    this.gauge = Math.max(0, this.gauge - 0.075 * dt);
    if (this.gauge < 1) return { levelled: false, tanks: 0 };
    this.gauge -= 1;
    this.banked++;
    const levelled = this.mult < STYLE_MAX_MULT;
    if (levelled) this.mult++;
    return { levelled, tanks: 1 };
  }

  nearMiss(): void {
    this.score += 30 * this.mult;
    this.gauge += 0.24;
  }

  driftTick(dt: number): void {
    this.score += 10 * this.mult * dt;
    this.gauge += 0.22 * dt;
  }

  /** Takedowns stoke the gauge without double-paying their points. */
  stoke(amount: number): void {
    this.gauge += amount;
  }

  /** Any contact — bump, wreck, bust — drops the chain. */
  crash(): void {
    this.mult = 1;
    this.gauge = 0;
  }

  reset(): void {
    this.mult = 1;
    this.gauge = 0;
    this.score = 0;
    this.banked = 0;
  }
}
