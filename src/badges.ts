// Badges are earned from the player's own race history, kept on this device.
// `bit` is the stable identifier so saved badge state stays comparable.
export interface BadgeDef {
  bit: number;
  icon: string;
  label: string;
  /** Earned test, run against local career stats. */
  earned: (s: BadgeInput) => boolean;
}

export interface BadgeInput {
  races: number;
  bestScore: number;
}

export const BADGES: BadgeDef[] = [
  { bit: 0, icon: '🥉', label: '10 races', earned: (s) => s.races >= 10 },
  { bit: 1, icon: '🥈', label: '50 races', earned: (s) => s.races >= 50 },
  { bit: 2, icon: '🥇', label: '100 races', earned: (s) => s.races >= 100 },
  { bit: 3, icon: '⚡', label: '5k score', earned: (s) => s.bestScore >= 5000 },
  { bit: 4, icon: '🔥', label: '10k score', earned: (s) => s.bestScore >= 10000 },
  { bit: 5, icon: '💎', label: '15k score', earned: (s) => s.bestScore >= 15000 }
];

/** Bitfield of earned badges. */
export function earnedBadges(s: BadgeInput): number {
  return BADGES.reduce((bits, b) => (b.earned(s) ? bits | (1 << b.bit) : bits), 0);
}
