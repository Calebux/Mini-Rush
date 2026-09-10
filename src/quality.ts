/**
 * Render quality tiers.
 *
 * The lit world costs a shadow pass that re-submits every static sector, and the
 * MiniPay webview runs on phones where that pass buys less than the resolution
 * it spends. So the shadow map is sized per device, and the race loop can demote
 * further when frames keep running long even at the minimum pixel ratio.
 *
 * Antialiasing is a WebGLRenderer construction flag — it can only be chosen once,
 * at startup. Shadows are the runtime lever.
 */
export type QualityTier = 0 | 1 | 2;

export interface QualitySettings {
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** Colour grade + vignette. Tier 0 skips it to keep the cheapest path cheap. */
  grade: boolean;
  /** Bloom is several half-res passes of its own — desktop only. */
  bloom: boolean;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  0: { antialias: false, shadows: false, shadowMapSize: 0, grade: false, bloom: false },
  1: { antialias: false, shadows: true, shadowMapSize: 1024, grade: true, bloom: false },
  2: { antialias: true, shadows: true, shadowMapSize: 2048, grade: true, bloom: true }
};

/**
 * Phones start on tier 1, desktops on tier 2. `?q=0|1|2` forces a tier so the
 * mobile path can be captured and profiled from a desktop browser.
 */
export function detectTier(params: URLSearchParams): QualityTier {
  const forced = params.get('q');
  if (forced !== null && /^[012]$/.test(forced)) return Number(forced) as QualityTier;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const handheld = Math.min(screen.width, screen.height) < 820;
  return coarse && handheld ? 1 : 2;
}
