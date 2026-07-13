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
