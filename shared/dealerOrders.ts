// Inventory-driven purchasing. No grants or synthetic restocks fund these orders.
export interface OrderRecipe { id: string; slot: string; rush: number; alloy: number; circuit: number }
export interface DealerPart { id: string; recipe_id: string; price: string | null }
export interface ComponentOrder {
  dealer: string; recipe_id: string; revision: number; price: string;
  remaining: number; expires_ms: number; reason: string;
}
export const orderPayout = (price: string): number => Number(price) - Math.max(1, Math.floor(Number(price) * .02));
export function dealerOrderPlan(account: string, recipes: OrderRecipe[], inventory: DealerPart[], available: number) {
  const name = account.split('.')[0];
  const slot = name === 'mama-t' ? 'tires' : name === 'oga-motors' ? 'engine' : 'nitro';
  const candidates = recipes.filter(r => r.slot === slot);
  const stock = (id: string) => inventory.filter(p => p.recipe_id === id).length;
  // Restock the least-held recipe; stable ties make retries predictable.
  const wanted = candidates.slice().sort((a,b) => stock(a.id) - stock(b.id) || a.id.localeCompare(b.id))[0];
  const quote = (r: OrderRecipe) => {
    const materials = r.alloy * 6 + r.circuit * 10;
    const premium = stock(r.id) === 0 ? 1.15 : 1;
    return Math.ceil((r.rush + materials) * premium);
  };
  // Resale always exceeds this dealer's maximum buy quote, including both fees.
  const listings = inventory.flatMap(p => {
    const r = recipes.find(r => r.id === p.recipe_id);
    if (!r) return [];
    const price = Math.ceil((r.rush + r.alloy * 6 + r.circuit * 10) * (stock(r.id) > 1 ? 1.35 : 1.5));
    return p.price === String(price) ? [] : [{ part_id: p.id, price: String(price) }];
  });
  if (!wanted || inventory.length >= 12) return { listings, order: null };
  const price = quote(wanted);
  const quantity = Math.min(Math.max(0, 2 - stock(wanted.id)), Math.floor(Math.max(0, available) * .5 / price), 12 - inventory.length);
  const order = quantity > 0 ? { recipe_id: wanted.id, price: String(price), quantity,
    reason: `${stock(wanted.id)} in stock. Buying ${quantity} for my ${slot} shelf; half my available RUSH stays in reserve.` } : null;
  return { listings, order };
}
