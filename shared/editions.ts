/** Limited-edition cars sold for NEAR: the shapes and rules shared by the game, the relay and the checks. */

export interface Edition {
  id: string; name: string; model: string; color: number;
  /** yoctoNEAR */
  price: string; size: number; minted: number; story: string; created_ms: number;
}
export interface EditionCar {
  id: string; edition_id: string; serial: number; owner: string; first_owner: string; minted_ms: number;
  /** yoctoNEAR asking price while the owner is selling */
  price: string | null; offer: number; last_price: string; sales: number;
}
export interface NearLedger {
  editions: number; cars_minted: number; cars_total: number; asks: number; royalty_percent: number;
  ledger: { primary_sales: number; primary_volume: string; resales: number; resale_volume: string; royalties: string };
}

export const YOCTO = 10n ** 24n;
export const ROYALTY_BPS = 200n;
export const MIN_RESALE_YOCTO = YOCTO / 100n;
export const MAX_NEAR_YOCTO = 10_000n * YOCTO;

/**
 * Calls that carry NEAR. They are never relayed: in a relayed (meta) transaction the
 * attached deposit is charged to the relayer, so the game would be paying for the car.
 * The player's garage sends these itself and pays the price and the network fee.
 */
export const NEAR_PAID = ['buy_edition', 'buy_edition_car'];
/**
 * Kept back from a garage's balance when it sends a purchase itself. The network
 * holds the full prepaid gas up front (about 0.03 NEAR for 30 Tgas on testnet) and
 * returns what is unused; the fee actually paid is far smaller.
 */
export const FEE_RESERVE_YOCTO = YOCTO / 20n;
/** Gas attached to a NEAR-paid call, in Tgas. */
export const PAID_CALL_TGAS = 30n;

/** What the seller receives from a resale at `price`. */
export const sellerProceeds = (price: bigint): bigint => price - price * ROYALTY_BPS / 10_000n;

/** "2", "0.5", "1.25": yoctoNEAR as NEAR, rounded down to `digits` decimals. */
export function formatNear(yocto: string | bigint, digits = 2): string {
  const value = BigInt(yocto), unit = 10n ** BigInt(24 - digits);
  const scaled = (value < 0n ? 0n : value) / unit, whole = scaled / 10n ** BigInt(digits);
  const part = (scaled % 10n ** BigInt(digits)).toString().padStart(digits, '0').replace(/0+$/, '');
  return `${whole.toLocaleString('en-US')}${part ? `.${part}` : ''}`;
}

/** A typed price such as "1.5" as yoctoNEAR, or null when it is not a usable price. */
export function parseNear(text: string): bigint | null {
  const m = /^(\d{1,5})(?:\.(\d{1,4}))?$/.exec(text.trim());
  if (!m) return null;
  const yocto = BigInt(m[1]) * YOCTO + BigInt((m[2] ?? '').padEnd(4, '0')) * (YOCTO / 10_000n);
  return yocto >= MIN_RESALE_YOCTO && yocto <= MAX_NEAR_YOCTO ? yocto : null;
}

/** NEAR a garage can put towards a price: its balance less what its storage locks up and the fee reserve. */
export function spendableNear(amount: string | bigint, storageBytes: number): bigint {
  const free = BigInt(amount) - BigInt(storageBytes) * 10n ** 19n - FEE_RESERVE_YOCTO;
  return free > 0n ? free : 0n;
}
