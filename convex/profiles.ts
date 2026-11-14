// Archived Nimiq profiles. Current NEAR gameplay has no callers of these writes.
// Keep reads and operator-only corrections; unauthenticated client writes are retired.
import { v } from 'convex/values';
import { internalMutation, mutation, MutationCtx, query } from './_generated/server';

// NQ + 2 check digits + 32 base32 chars, compacted (src/wallet.ts)
const ADDRESS = /^NQ\d{2}[0-9A-HJ-NP-VXY]{32}$/;
const CAR = /^[a-z0-9-]{1,24}$/;
const MAX_CARS = 64;
const MAX_PURCHASES = 64;

// the username rules the game applies (src/driver.ts)
const NAME_MIN = 3;
const NAME_MAX = 16;

/** "NQ23 76fk …" → "NQ2376FK…", or null when it isn't an address. */
function compact(raw: string): string | null {
  const a = raw.replace(/\s+/g, '').toUpperCase();
  return ADDRESS.test(a) ? a : null;
}

function cleanName(raw: string): string | null {
  const name = raw.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ')
    .trim().slice(0, NAME_MAX).trim();
  return name.length >= NAME_MIN ? name : null;
}

async function find(ctx: MutationCtx, address: string) {
  return ctx.db.query('profiles').withIndex('by_address', (q) => q.eq('address', address)).first();
}

/** Create or patch a profile. `cars` are added to what is already there. */
async function save(
  ctx: MutationCtx, address: string,
  change: { name?: string; cars?: string[]; purchase?: { car: string; tx: string } }
): Promise<void> {
  const row = await find(ctx, address);
  const cars = new Set(row?.cars ?? []);
  for (const car of change.cars ?? []) if (CAR.test(car) && cars.size < MAX_CARS) cars.add(car);
  const purchases = [...(row?.purchases ?? [])];
  if (change.purchase && purchases.length < MAX_PURCHASES) {
    purchases.push({ ...change.purchase, at: Date.now() });
  }
  const next = {
    address,
    name: change.name ?? row?.name,
    cars: [...cars],
    purchases,
    updatedAt: Date.now()
  };
  if (row) await ctx.db.replace(row._id, next);
  else await ctx.db.insert('profiles', next);
}

/** The name and cars saved for a wallet, or null for a wallet never seen. */
export const get = query({
  args: { address: v.string() },
  handler: async (ctx, { address: raw }) => {
    const address = compact(raw);
    if (!address) return null;
    const row = await ctx.db.query('profiles').withIndex('by_address', (q) => q.eq('address', address)).first();
    return row ? { name: row.name ?? null, cars: row.cars } : null;
  }
});

// These old endpoints accepted an arbitrary address without proof of ownership.
// Retain explicit rejections for stale clients instead of silently acknowledging writes.
const retired = async (): Promise<never> => { throw new Error('Legacy wallet profile writes are disabled'); };
export const sync = mutation({
  args: { address: v.string(), name: v.optional(v.string()), cars: v.array(v.string()) }, handler: retired
});
export const setName = mutation({
  args: { address: v.string(), name: v.string() }, handler: retired
});
export const addCar = mutation({
  args: { address: v.string(), car: v.string(), tx: v.string() }, handler: retired
});

/**
 * Hand cars (and optionally a name) to a wallet by hand — for players whose
 * purchases predate this table. Internal; run with deploy access:
 *   npx convex run --prod profiles:grant '{"address":"NQ.. ..","cars":["viper"],"name":"SOME NAME"}'
 */
export const grant = internalMutation({
  args: { address: v.string(), cars: v.array(v.string()), name: v.optional(v.string()) },
  handler: async (ctx, { address: raw, cars, name: rawName }) => {
    const address = compact(raw);
    if (!address) throw new Error(`"${raw}" is not a Nimiq address`);
    const bad = cars.filter((c) => !CAR.test(c));
    if (bad.length) throw new Error(`not car ids: ${bad.join(', ')}`);
    const name = rawName === undefined ? undefined : cleanName(rawName);
    if (name === null) throw new Error(`"${rawName}" is not a driver name`);
    await save(ctx, address, { cars, ...(name ? { name } : {}) });
    return (await find(ctx, address))?.cars ?? [];
  }
});
