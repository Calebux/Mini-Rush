// Style meter: near-misses and drifts feed a gauge; a full gauge bumps the
// multiplier, contact wipes it. Style points ride the multiplier and join
// the final score — the payoff for driving dangerously WELL.

export const STYLE_MAX_MULT = 5;

export class StyleMeter {
  mult = 1;
  gauge = 0; // 0..1 toward the next multiplier step
  score = 0;

  /** Ticked every racing frame; a leveled-up multiplier returns true once. */
  update(dt: number): boolean {
    this.gauge = Math.max(0, this.gauge - 0.09 * dt); // constant slow bleed
    if (this.gauge >= 1) {
      this.gauge -= 1;
      if (this.mult < STYLE_MAX_MULT) {
        this.mult++;
        return true;
      }
    }
    return false;
  }

  nearMiss(): void {
    this.score += 30 * this.mult;
    this.gauge += 0.45;
  }

  driftTick(dt: number): void {
    this.score += 10 * this.mult * dt;
    this.gauge += 0.28 * dt;
  }

  /** Takedowns/splats stoke the gauge without double-paying their points. */
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
  }
}
