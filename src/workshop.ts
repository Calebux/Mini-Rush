import type { CarSpec } from './cars';
import { bank } from './economy';

export const SLOTS = ['body', 'wheels', 'wing', 'paint', 'tyres', 'power'] as const;
export type Slot = typeof SLOTS[number];
export interface Build { name: string; parts: Record<Slot, string> }
export interface Part { id: string; slot: Slot; name: string; price: number; detail: string; color?: number }
export const PARTS: Part[] = [
  { id: 'street', slot: 'body', name: 'Street shell', price: 0, detail: 'Clean, lightweight coupe.' },
  { id: 'wide', slot: 'body', name: 'Widebody', price: 160, detail: 'Extended arches and low side skirts. Cosmetic.' },
  { id: 'rally', slot: 'body', name: 'Rally kit', price: 140, detail: 'Roof rack and four driving lamps. Cosmetic.' },
  { id: 'five', slot: 'wheels', name: 'Five spoke', price: 0, detail: 'Classic silver alloys.' },
  { id: 'turbine', slot: 'wheels', name: 'Turbine', price: 80, detail: 'Ten gold spokes. Cosmetic.' },
  { id: 'disc', slot: 'wheels', name: 'Aero disc', price: 90, detail: 'White rally discs. Cosmetic.' },
  { id: 'clean', slot: 'wing', name: 'Clean tail', price: 0, detail: 'Let the silhouette do the talking.' },
  { id: 'duck', slot: 'wing', name: 'Ducktail', price: 60, detail: 'A subtle body-colour lip. Cosmetic.' },
  { id: 'gt', slot: 'wing', name: 'GT wing', price: 120, detail: 'Carbon blade and twin uprights. Cosmetic.' },
  { id: 'sun', slot: 'paint', name: 'Sun yellow', price: 0, detail: 'Factory gloss.', color: 0xffc531 },
  { id: 'lagoon', slot: 'paint', name: 'Lagoon', price: 50, detail: 'Deep turquoise gloss.', color: 0x19bda7 },
  { id: 'coral', slot: 'paint', name: 'Hot coral', price: 50, detail: 'Sunset red gloss.', color: 0xff6151 },
  { id: 'ice', slot: 'paint', name: 'Ice blue', price: 60, detail: 'Cool metallic blue.', color: 0x87cafa },
  { id: 'graphite', slot: 'paint', name: 'Graphite', price: 60, detail: 'Satin charcoal.', color: 0x424d60 },
  { id: 'road', slot: 'tyres', name: 'Road compound', price: 0, detail: 'Balanced grip and rolling speed.' },
  { id: 'grip', slot: 'tyres', name: 'Sticky compound', price: 120, detail: '+12% grip · −3% top speed.' },
  { id: 'slide', slot: 'tyres', name: 'Slide compound', price: 110, detail: '−10% grip · +8% nitro duration.' },
  { id: 'stock', slot: 'power', name: 'Factory tune', price: 0, detail: 'Predictable power delivery.' },
  { id: 'sprint', slot: 'power', name: 'Sprint tune', price: 180, detail: '+10% launch · +3% speed · −12% nitro.' },
  { id: 'touring', slot: 'power', name: 'Touring tune', price: 140, detail: '+7% top speed · −7% launch.' }
];
const KEY = 'minirush.workshop.v1';
const BANK = 'minirush.bank';
export const freshBuild = (name = 'MY RUSH'): Build => ({ name, parts: { body: 'street', wheels: 'five', wing: 'clean', paint: 'sun', tyres: 'road', power: 'stock' } });
export const part = (id: string) => PARTS.find(p => p.id === id);
interface Store { owned: string[]; builds: Build[]; active: number }
function sanitize(raw: unknown, owned: Set<string>): Build {
  const b = freshBuild();
  if (!raw || typeof raw !== 'object') return b;
  const r = raw as Partial<Build>;
  if (typeof r.name === 'string') b.name = r.name.trim().slice(0, 24) || b.name;
  for (const slot of SLOTS) {
    const p = part(r.parts?.[slot] ?? '');
    if (p?.slot === slot && (!p.price || owned.has(p.id))) b.parts[slot] = p.id;
  }
  return b;
}
export function workshopStore(): Store {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) || '{}');
    const owned = new Set<string>(Array.isArray(r?.owned) ? r.owned.filter((id: unknown) => typeof id === 'string' && part(id)) : []);
    return { owned: [...owned], active: Number.isInteger(r?.active) && r.active >= 0 && r.active < 3 ? r.active : 0,
      builds: [0, 1, 2].map(i => sanitize(r?.builds?.[i] ?? freshBuild(`BUILD ${i + 1}`), owned)) };
  } catch { return { owned: [], active: 0, builds: [1, 2, 3].map(i => freshBuild(`BUILD ${i}`)) }; }
}
export function equippedBuild(): Build { const s = workshopStore(); return s.builds[s.active]; }
export function ownsPart(id: string): boolean { const p = part(id); return !!p && (p.price === 0 || workshopStore().owned.includes(id)); }
/** A recoverable journal makes the two localStorage writes crash-safe. Never a real-money purchase. */
const JOURNAL = `${KEY}.purchase`;
export function recoverPurchase(): void {
  const raw = localStorage.getItem(JOURNAL);
  if (!raw) return;
  const tx = JSON.parse(raw);
  if (!Number.isSafeInteger(tx.balance) || tx.balance < 0 || typeof tx.store !== 'string') throw new Error('Invalid workshop journal');
  localStorage.setItem(KEY, tx.store);
  localStorage.setItem(BANK, String(tx.balance));
  localStorage.removeItem(JOURNAL);
}
export function purchasePart(id: string): string | null {
  try {
    recoverPurchase();
    const p = part(id);
    if (!p) return 'Unknown part.';
    if (ownsPart(id)) return null;
    const balance = bank();
    if (balance < p.price) return `Earn ${p.price - balance} more coins by racing.`;
    const s = workshopStore(); s.owned.push(id);
    localStorage.setItem(JOURNAL, JSON.stringify({ balance: balance - p.price, store: JSON.stringify(s) }));
    recoverPurchase();
    return null;
  } catch { return 'Storage unavailable. Reopen the workshop to recover the purchase.'; }
}
export function saveBuild(index: number, build: Build): string | null {
  if (!Number.isInteger(index) || index < 0 || index > 2) return 'Invalid build slot.';
  if (SLOTS.some(slot => part(build.parts[slot])?.slot !== slot || !ownsPart(build.parts[slot]))) return 'Buy the previewed parts before equipping.';
  try {
    recoverPurchase();
    const s = workshopStore(); s.builds[index] = sanitize(build, new Set(s.owned)); s.active = index;
    localStorage.setItem(KEY, JSON.stringify(s)); return null;
  } catch { return 'Could not save. Check that browser storage is enabled.'; }
}
export function workshopSpec(base: CarSpec, build = equippedBuild()): CarSpec {
  const c = { ...base, build, color: part(build.parts.paint)?.color ?? 0xffc531 };
  if (build.parts.tyres === 'grip') { c.grip *= 1.12; c.speed *= .97; }
  if (build.parts.tyres === 'slide') { c.grip *= .9; c.nitro *= 1.08; }
  if (build.parts.power === 'sprint') { c.accel *= 1.1; c.speed *= 1.03; c.nitro *= .88; }
  if (build.parts.power === 'touring') { c.speed *= 1.07; c.accel *= .93; }
  return c;
}
