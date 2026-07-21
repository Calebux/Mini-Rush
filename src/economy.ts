// The coin bank. Coins collected in races accumulate here and buy cars in
// the garage. All local — the wallet integration can hang premium cars off
// the same owned() gate later.
const BANK_KEY = 'minirush.bank';
const OWNED_KEY = 'minirush.owned';

export const bank = (): number => {
  const n = Number(localStorage.getItem(BANK_KEY));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export const deposit = (coins: number): void => {
  if (coins > 0) localStorage.setItem(BANK_KEY, String(bank() + Math.floor(coins)));
};

export function owned(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(OWNED_KEY) ?? '[]') as string[];
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

/** Take coins out of the bank. False = can't afford (nothing deducted). */
export function spend(amount: number): boolean {
  if (bank() < amount) return false;
  localStorage.setItem(BANK_KEY, String(bank() - amount));
  return true;
}

/** Spend from the bank to unlock a car. False = can't afford. */
export function unlock(id: string, price: number): boolean {
  if (!spend(price)) return false;
  const o = owned();
  o.add(id);
  localStorage.setItem(OWNED_KEY, JSON.stringify([...o]));
  return true;
}

/**
 * Guaranteed finish payout, banked on top of coins grabbed on track. Coin arcs
 * alone make earnings hinge on threading pickups — this gives the garage curve a
 * floor so showing up, finishing, splatting and placing all pay. Tuned against
 * car prices (60–600) and upgrade tiers (60/120/240): a clean race adds ~25–45.
 */
export function racePayout(p: {
  place: number; field: number; zombies: number; laps: number;
}): number {
  const finish = 12;                                    // reached the line
  const podium = Math.max(0, 20 - (p.place - 1) * 6);   // 1st 20 · 2nd 14 · 3rd 8 · 4th 2
  const splats = Math.floor(p.zombies / 4);             // horde laps reward the grind
  const laps = Math.max(0, p.laps - 1) * 5;             // multi-lap modes pay more
  return finish + podium + splats + laps;
}
