// The /economy page: the game's faucets, sinks and markets as a game screen.
// Figures come from the garage contract's `economy` view plus the dealer log in
// Convex; the car behind them is the game's showroom (economyStage.ts). It is
// public and has no wallet: everything here is a view call.
import { CARS, type CarSpec } from './cars';
import { COMPONENT_SLOTS, RECIPES, type Component, type Recipe } from './components';
import { GARAGE, dealerLog, explorerAccount, explorerTx, viewCall, type DealerMove, type Listing } from './near';
import { RACE_PAYOUT } from '../shared/raceRules';
import type { EconomyStage } from './economyStage';

interface Ledger {
  races_paid: number; podiums: number; rush_minted: number; alloy_minted: number; circuit_minted: number;
  rush_burned_craft: number; rush_burned_fees: number; alloy_burned: number; circuit_burned: number;
  parts_crafted: number; parts_recycled: number; trades: number; trade_volume: number;
}
interface Economy {
  rush_supply: string; alloy_supply: string; circuit_supply: string; dealer_rush: string;
  parts: number; offers: number; parts_issued: number;
  races_today: number; races_per_day: number; races_per_account_day: number;
  payout: { first: string; second: string; third: string; finish: string; alloy: number; circuit: number };
  market_fee_percent: number; ledger: Ledger;
}
/** What the page shows. `full` is null against a garage that predates the parts workshop. */
interface Snapshot {
  rush: number; alloy: number; circuit: number; dealerRush: number;
  payout: { first: number; second: number; third: number; finish: number; alloy: number; circuit: number };
  full: Economy | null; stalls: Listing[]; offers: Component[]; moves: DealerMove[];
}
interface Plate { label: string; value: number | string; hint?: string; tone?: string }

const DEALERS: Record<string, string> = { 'mama-t': 'Mama T', 'oga-motors': 'Oga Motors', 'tuner-ade': 'Tuner Ade' };
const LIST_PRICE: Record<string, number> = { 'part:nitro-can': 40 };
for (const c of CARS) if (c.price > 0) LIST_PRICE[`car:${c.id}`] = c.price;
const STAT_NAMES = { speed: 'TOP SPEED', accel: 'LAUNCH', grip: 'HANDLING', nitro: 'NITRO' } as const;
const REEL_MS = 7000;
const DASH = '—';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const n = (v: number): string => Math.round(v).toLocaleString('en-US');
const short = (account: string): string => account.split('.')[0];
const dealerName = (account: string): string => DEALERS[short(account)] ?? short(account);
const carFor = (token: string): CarSpec | undefined => CARS.find(c => `car:${c.id}` === token);
const still = matchMedia('(prefers-reduced-motion: reduce)');

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function link(text: string, href: string): HTMLAnchorElement {
  const a = el('a', text);
  a.href = href; a.target = '_blank'; a.rel = 'noopener';
  return a;
}
function ago(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
}
/** Price against the garage list price: text, direction and percentage. */
function against(token: string, price: number): { text: string; short: string; dir: 'up' | 'down' | 'flat' } | null {
  const list = LIST_PRICE[token];
  if (!list) return null;
  const pct = Math.round((price / list - 1) * 100);
  if (pct === 0) return { text: 'AT LIST', short: 'LIST', dir: 'flat' };
  return pct > 0 ? { text: `▲ ${pct}% OVER LIST`, short: `▲${pct}%`, dir: 'up' }
    : { text: `▼ ${-pct}% UNDER LIST`, short: `▼${-pct}%`, dir: 'down' };
}

// Numbers roll to their new value, the way the results screen tallies a payout.
const shown = new WeakMap<HTMLElement, number>();
function count(node: HTMLElement, value: number): void {
  const from = shown.get(node) ?? 0;
  shown.set(node, value);
  if (still.matches || document.hidden || from === value) { node.textContent = n(value); return; }
  const start = performance.now();
  const step = (now: number): void => {
    if (shown.get(node) !== value) return;
    const k = Math.min(1, (now - start) / 1100);
    node.textContent = n(from + (value - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
function figure(node: HTMLElement, value: number | string): void {
  if (typeof value === 'number') count(node, value); else node.textContent = value;
}
/** Keyed by label so a refresh rolls the numbers instead of rebuilding the plates. */
function plates(host: HTMLElement, items: Plate[]): void {
  const key = items.map(i => i.label).join('|');
  if (host.dataset.key !== key) {
    host.dataset.key = key;
    host.replaceChildren(...items.map(i => {
      const plate = el('div', undefined, `plate ${i.tone ?? ''}`);
      plate.append(el('small', i.label), el('b'), el('span'));
      return plate;
    }));
  }
  items.forEach((item, index) => {
    const plate = host.children[index];
    figure(plate.querySelector('b')!, item.value);
    plate.querySelector('span')!.textContent = item.hint ?? '';
  });
}
function rows(host: HTMLElement, items: [string, string][]): void {
  host.replaceChildren(...items.map(([label, value]) => {
    const row = el('div');
    row.append(el('dt', label), el('dd', value));
    return row;
  }));
}
function total(host: HTMLElement, value: number | null, unit: string): void {
  if (value === null) { host.replaceChildren(); return; }
  let figureNode = host.querySelector('span');
  if (!figureNode) { figureNode = el('span'); host.replaceChildren(figureNode, el('small', unit)); }
  count(figureNode, value);
}

async function load(): Promise<Snapshot> {
  // Stalls and the dealer log exist on every version of the garage; the ledger only on the upgraded one.
  const [full, stalls, moves] = await Promise.all([
    viewCall<Economy>('economy', {}).catch(() => null),
    viewCall<Listing[]>('listings', {}),
    dealerLog(50).catch((): DealerMove[] => [])
  ]);
  if (full) {
    const offers = await viewCall<Component[]>('component_offers', { limit: 12 }).catch((): Component[] => []);
    const p = full.payout;
    return { rush: Number(full.rush_supply), alloy: Number(full.alloy_supply), circuit: Number(full.circuit_supply),
      dealerRush: Number(full.dealer_rush), full, offers, stalls, moves,
      payout: { first: Number(p.first), second: Number(p.second), third: Number(p.third), finish: Number(p.finish), alloy: p.alloy, circuit: p.circuit } };
  }
  // Older garage: no ledger yet, but supply and the dealers' tills are still on chain.
  const [supply, dealers] = await Promise.all([
    viewCall<(string | null)[]>('mt_batch_supply', { token_ids: ['rush', 'material:alloy', 'material:circuit'] }),
    viewCall<string[]>('dealers', {})
  ]);
  const tills = await Promise.all(dealers.map(d => viewCall<string>('mt_balance_of', { account_id: d, token_id: 'rush' })));
  return { rush: Number(supply[0] ?? 0), alloy: Number(supply[1] ?? 0), circuit: Number(supply[2] ?? 0),
    dealerRush: tills.reduce((sum, t) => sum + Number(t), 0), full: null, offers: [], stalls, moves,
    payout: { ...RACE_PAYOUT } };
}

// ── the stage ────────────────────────────────────────────────────────────
let stage: EconomyStage | null = null;
let scene = 'title';
let stalls: Listing[] = [];
let latest = new Map<string, DealerMove>();
let pick = '';        // the featured stall's token
let handPicked = false; // a visitor chose a stall: the showreel stops
let reel = 0;

function sceneCar(): CarSpec | undefined {
  if (scene === 'dealers') return carFor(pick) ?? CARS.find(c => c.id === 'rush-one');
  const id = document.querySelector<HTMLElement>(`.scene[data-scene="${scene}"]`)?.dataset.car;
  return CARS.find(c => c.id === id);
}
function direct(): void {
  const car = sceneCar();
  if (stage && car) stage.show(car);
}
function enter(section: HTMLElement): void {
  const name = section.dataset.scene!;
  if (name === scene && document.body.dataset.scene === name) return;
  scene = name;
  document.body.dataset.scene = name;
  for (const a of document.querySelectorAll<HTMLElement>('.chapters a')) a.setAttribute('aria-current', String(a.dataset.for === name));
  stage?.shot(section.dataset.shot ?? 'front');
  direct();
  runReel();
}

// ── dealer row ───────────────────────────────────────────────────────────
function feature(): void {
  const x = stalls.find(s => s.token_id === pick);
  const host = $('feature');
  if (!x) { host.hidden = true; return; }
  host.hidden = false;
  const price = Number(x.price), vs = against(x.token_id, price), move = latest.get(x.token_id);
  const priceRow = el('div', undefined, 'feature-price');
  priceRow.append(el('b', n(price)), el('small', 'RUSH'));
  if (vs) { const trend = el('span', vs.text, 'trend'); trend.dataset.dir = vs.dir; priceRow.append(trend); }
  const quote = el('blockquote', undefined, 'quote'), foot = el('footer');
  quote.append(el('p', x.reason));
  if (move) foot.append(el('span', move.by === 'rules' ? 'RULE-BASED PRICING' : `PRICED BY ${move.by.toUpperCase()}`));
  foot.append(el('span', `UPDATED ${ago(x.updated_ms).toUpperCase()}`));
  if (move?.tx) foot.append(link('RECEIPT ↗', explorerTx(encodeURIComponent(move.tx))));
  quote.append(foot);
  const meta = el('div', undefined, 'feature-meta');
  const fact = (label: string, value: string): HTMLElement => { const s = el('span', `${label} `); s.append(el('b', value)); return s; };
  meta.append(fact('STOCK', x.stock === 0 ? 'SOLD OUT' : n(x.stock)), fact('SOLD', n(x.sold)));
  if (LIST_PRICE[x.token_id]) meta.append(fact('LIST', n(LIST_PRICE[x.token_id])));
  host.replaceChildren(el('span', `${dealerName(x.dealer)} · ${x.kind === 'car' ? 'car stall' : 'parts counter'}`, 'feature-dealer'),
    el('div', x.name, 'feature-name'), priceRow, quote, meta);
  for (const chip of $('rail').querySelectorAll<HTMLElement>('.chip')) chip.setAttribute('aria-pressed', String(chip.dataset.token === pick));
  if (scene === 'dealers') direct();
}
function choose(token: string, byHand: boolean): void {
  pick = token;
  if (byHand) handPicked = true;
  feature();
  runReel();
}
/** Until someone picks a stall, the row plays as a showreel: one stall every few seconds. */
function runReel(): void {
  clearTimeout(reel); reel = 0;
  const bar = $('reel');
  bar.classList.remove('run');
  if (scene !== 'dealers' || handPicked || still.matches || stalls.length < 2) return;
  bar.style.setProperty('--reel', `${REEL_MS}ms`);
  void bar.offsetWidth; // restart the progress line
  bar.classList.add('run');
  reel = window.setTimeout(() => {
    if (document.hidden) { runReel(); return; }
    const at = stalls.findIndex(s => s.token_id === pick);
    choose(stalls[(at + 1) % stalls.length].token_id, false);
  }, REEL_MS);
}
function dealerRow(s: Snapshot): void {
  stalls = [...s.stalls].sort((x, y) => Number(y.kind === 'car') - Number(x.kind === 'car') || y.sold - x.sold || Number(y.price) - Number(x.price));
  latest = new Map();
  for (const m of s.moves) if (!latest.has(m.token)) latest.set(m.token, m);
  if (!stalls.some(x => x.token_id === pick)) pick = stalls[0]?.token_id ?? '';

  $('rail').replaceChildren(...stalls.map(x => {
    const chip = el('button', undefined, 'chip');
    chip.type = 'button'; chip.dataset.token = x.token_id;
    const car = carFor(x.token_id);
    if (car) chip.style.setProperty('--car', `#${car.color.toString(16).padStart(6, '0')}`);
    const price = el('span', n(Number(x.price))), vs = against(x.token_id, Number(x.price));
    if (vs) price.append(el('i', vs.short, vs.dir));
    chip.append(el('small', dealerName(x.dealer).toUpperCase()), el('strong', x.name), price);
    chip.addEventListener('click', () => choose(x.token_id, true));
    return chip;
  }));
  $('stalls-empty').hidden = stalls.length > 0;
  $('stalls-empty').textContent = 'No dealer stalls are open.';
  feature();
  if (!reel) runReel();

  const changes = s.moves.filter(m => m.price !== m.oldPrice).slice(0, 6);
  $('moves').replaceChildren(...changes.map(m => {
    const li = el('li'), head = el('header');
    const up = m.price > m.oldPrice;
    li.style.setProperty('--tone', up ? 'var(--burn)' : 'var(--earn)');
    const time = el('time', ago(m.at));
    time.dateTime = new Date(m.at).toISOString();
    head.append(el('b', stalls.find(x => x.token_id === m.token)?.name ?? m.token.replace(/^(car|part):/, '').toUpperCase()),
      el('span', `${n(m.oldPrice)} → ${n(m.price)}`, up ? 'up' : 'down'), el('span', dealerName(m.dealer), 'by'),
      el('span', m.by === 'rules' ? 'rule-based' : m.by, 'tag'), time);
    if (m.tx) head.append(link('RECEIPT ↗', explorerTx(encodeURIComponent(m.tx))));
    li.append(head, el('q', m.reason));
    return li;
  }));
  $('moves-empty').hidden = changes.length > 0;
  $('moves-empty').textContent = 'No price changes in the latest dealer rounds.';
}

function ticker(s: Snapshot, burned: number | null): void {
  const items: [string, string, string, string][] = [['RUSH SUPPLY', n(s.rush), '', 'flat']];
  if (burned !== null) items.push(['BURNED', n(burned), '', 'flat']);
  for (const x of stalls) {
    const vs = against(x.token_id, Number(x.price));
    items.push([x.name, n(Number(x.price)), vs?.short ?? '', vs?.dir ?? 'flat']);
  }
  const tape = $('tape'), key = JSON.stringify(items);
  if (tape.dataset.key === key) return; // unchanged: let the tape keep rolling
  tape.dataset.key = key;
  const strip = (): HTMLElement[] => items.map(([name, price, move, dir]) => {
    const li = el('li');
    li.append(el('b', name), el('span', price), el('i', move, dir));
    return li;
  });
  const copy = strip();
  for (const li of copy) li.setAttribute('aria-hidden', 'true');
  tape.replaceChildren(...strip(), ...(still.matches ? [] : copy));
  tape.style.setProperty('--tape', `${Math.max(24, items.length * 4)}s`);
}

// ── parts bay ────────────────────────────────────────────────────────────
let slot: string = COMPONENT_SLOTS[0];
function catalogue(): void {
  $('slots').replaceChildren(...COMPONENT_SLOTS.map(name => {
    const tab = el('button', name);
    tab.type = 'button'; tab.setAttribute('aria-pressed', String(name === slot));
    tab.addEventListener('click', () => { slot = name; catalogue(); });
    return tab;
  }));
  $('recipes').replaceChildren(...RECIPES.filter(r => r.slot === slot).map((r: Recipe) => {
    const li = el('li'), cost = el('span', `${r.rush} RUSH `, 'cost'), trade = el('span', undefined, 'trade');
    cost.append(el('em', `· ${r.alloy} alloy · ${r.circuit} circuit`));
    for (const stat of ['speed', 'accel', 'grip', 'nitro'] as const) {
      if (r[stat]) trade.append(el('span', `${r[stat] > 0 ? '+' : '−'}${Math.abs(r[stat])} ${STAT_NAMES[stat]}`, r[stat] > 0 ? 'down' : 'up'));
    }
    li.append(el('strong', r.name), cost, trade);
    return li;
  }));
}

function render(s: Snapshot): void {
  const l = s.full?.ledger ?? null;
  const burned = l ? l.rush_burned_craft + l.rush_burned_fees : null;
  const players = Math.max(0, s.rush - s.dealerRush);
  const sold = s.stalls.reduce((sum, x) => sum + x.sold, 0);
  const fee = s.full?.market_fee_percent ?? 2;
  const cap = s.full?.races_per_day ?? 2000, perDriver = s.full?.races_per_account_day ?? 20;
  const p = s.payout;

  const notice = $('notice');
  notice.hidden = !!s.full;
  if (!s.full) notice.textContent = 'This garage contract predates the parts workshop. Supply, dealer stalls and price moves are live; the podium payout, the season ledger and the parts rules describe the workshop upgrade and start counting once it is deployed.';

  // 01 supply
  count($('supply'), s.rush);
  const share = s.rush > 0 ? players / s.rush * 100 : 0;
  const a = el('i', undefined, 'a'), b = el('i', undefined, 'b');
  a.style.width = `${share}%`; b.style.width = `${100 - share}%`;
  $('split').replaceChildren(a, b);
  $('split').setAttribute('aria-label', `${n(players)} RUSH held by players, ${n(s.dealerRush)} by dealers`);
  const keyA = el('span'), keyB = el('span'), dotA = el('i'), dotB = el('i');
  dotA.style.background = 'var(--money)'; dotB.style.background = 'var(--violet)';
  keyA.append(dotA, `PLAYERS ${n(players)}`); keyB.append(dotB, `DEALER TILLS ${n(s.dealerRush)}`);
  $('split-key').replaceChildren(keyA, keyB);
  plates($('plates'), l && s.full ? [
    { label: 'Minted', value: l.rush_minted, hint: `across ${n(l.races_paid)} rewarded races`, tone: 'earn' },
    { label: 'Burned', value: burned!, hint: l.rush_minted > 0 ? `${Math.round(burned! / l.rush_minted * 100)}% of everything minted` : 'crafting and trade fees', tone: 'burn' },
    { label: 'Parts', value: s.full.parts, hint: `in garages · ${n(s.full.offers)} for sale` },
    { label: 'Races today', value: s.full.races_today, hint: `of ${n(cap)} the contract will pay` }
  ] : [
    { label: 'With players', value: players, hint: 'RUSH earned and unspent', tone: 'money' },
    { label: 'In dealer tills', value: s.dealerRush, hint: 'RUSH spent at the stalls' },
    { label: 'Dealer sales', value: sold, hint: 'items sold, all on chain', tone: 'earn' },
    { label: 'Stalls open', value: s.stalls.length, hint: `${new Set(s.stalls.map(x => x.dealer)).size} dealers` }
  ]);

  // 02 the loop
  const podium = $('podium');
  if (!podium.children.length) {
    podium.append(...(['2ND', 'WIN', '3RD', 'FINISH'] as const).map(label => {
      const li = el('li', undefined, label === 'WIN' ? 'win' : label === 'FINISH' ? 'rest' : '');
      li.append(el('b'), el('i', label));
      return li;
    }));
  }
  [p.second, p.first, p.third, p.finish].forEach((rush, i) => {
    const li = podium.children[i] as HTMLElement;
    li.querySelector('b')!.textContent = String(rush);
    li.querySelector('i')!.style.setProperty('--h', String(Math.round(rush / p.first * 62)));
  });
  $('salvage').textContent = `Every finish also pays ${p.alloy} alloy and ${p.circuit} circuit of salvage for crafting. A faster build places higher, so parts pay for themselves on track.`;
  total($('earn-total'), l ? l.rush_minted : null, 'RUSH MINTED');
  rows($('earn-rows'), l ? [
    ['Rewarded races', n(l.races_paid)],
    ['Podium finishes', `${n(l.podiums)}${l.races_paid ? ` · ${Math.round(l.podiums / l.races_paid * 100)}%` : ''}`],
    ['Alloy · circuits minted', `${n(l.alloy_minted)} · ${n(l.circuit_minted)}`]
  ] : []);
  total($('hold-total'), s.rush, 'RUSH');
  rows($('hold-rows'), [
    ['With players', n(players)],
    ['In dealer tills', n(s.dealerRush)],
    ['Alloy · circuits held', `${n(s.alloy)} · ${n(s.circuit)}`],
    ...(s.full ? [['Parts in garages', n(s.full.parts)] as [string, string]] : [])
  ]);
  total($('burn-total'), burned, 'RUSH BURNED');
  const burnShare = l && l.rush_minted > 0 ? burned! / l.rush_minted : 0;
  $('furnace').hidden = !l;
  $('furnace-fill').style.width = `${Math.min(100, burnShare * 100)}%`;
  $('furnace').setAttribute('aria-label', `${Math.round(burnShare * 100)}% of minted RUSH has been burned`);
  rows($('burn-rows'), [
    ...(l ? [
      ['Burned crafting parts', `${n(l.rush_burned_craft)} RUSH`],
      [`Burned as ${fee}% trade fee`, `${n(l.rush_burned_fees)} RUSH`],
      ['Alloy · circuits burned', `${n(l.alloy_burned)} · ${n(l.circuit_burned)}`]
    ] as [string, string][] : []),
    ['Spent at dealers', `${n(sold)} ${sold === 1 ? 'item' : 'items'}`]
  ]);
  $('burn-note').textContent = l
    ? `Net issuance: ${n(l.rush_minted)} minted − ${n(burned!)} burned = ${n(l.rush_minted - burned!)} RUSH. Dealers keep what they are paid, and pay half price back for a car returned.`
    : `Crafting burns its whole RUSH and material cost. Every trade burns a ${fee}% fee. Dealers keep what they are paid, and pay half price back for a car returned.`;
  stage?.setBurnShare(burnShare);

  const today = s.full?.races_today ?? 0;
  $('budget-count').textContent = `${s.full ? n(today) : DASH} / ${n(cap)}`;
  const segs = $('budget-segs'), lit = today > 0 ? Math.max(1, Math.round(today / cap * 40)) : 0;
  if (segs.children.length !== 40) segs.replaceChildren(...Array.from({ length: 40 }, () => el('i')));
  [...segs.children].forEach((seg, i) => seg.classList.toggle('on', i < lit));
  segs.setAttribute('aria-label', `${n(today)} of ${n(cap)} rewarded races used today`);
  $('budget-note').textContent = `The contract pays at most ${n(cap)} races a day across the whole game and ${perDriver} per driver, so no day can mint more than ${n(cap * p.first)} RUSH however many accounts show up.`;

  // 03 dealer row, and the wire along the bottom
  dealerRow(s);
  ticker(s, burned);

  // 04 parts bay
  plates($('parts'), l && s.full ? [
    { label: 'Crafted', value: l.parts_crafted, hint: `${n(s.full.parts)} still in garages` },
    { label: 'Trades', value: l.trades, hint: `${n(l.trade_volume)} RUSH changed hands`, tone: 'money' },
    { label: 'Recycled', value: l.parts_recycled, hint: 'half the materials back', tone: 'burn' },
    { label: 'Open offers', value: s.full.offers, hint: 'listed by players' }
  ] : [
    { label: 'Recipes', value: RECIPES.length, hint: `across ${COMPONENT_SLOTS.length} slots` },
    { label: 'Trade fee burned', value: `${fee}%`, hint: 'of every sale', tone: 'burn' },
    { label: 'Back on recycle', value: '50%', hint: 'materials only, no RUSH' },
    { label: 'Full set', value: '10', hint: 'races at the finish rate', tone: 'earn' }
  ]);
  $('offers').replaceChildren(...s.offers.filter(o => o.price !== null).map(o => {
    const recipe = RECIPES.find(r => r.id === o.recipe_id);
    const li = el('li'), name = el('strong', recipe?.name ?? o.recipe_id), trail = el('span', 'MADE BY ');
    name.append(el('small', `#${o.id.replace('component:', '')} · ${(recipe?.slot ?? 'part').toUpperCase()}`));
    trail.append(link(short(o.maker), explorerAccount(o.maker)), ' · SOLD BY ', link(short(o.owner), explorerAccount(o.owner)));
    li.append(name, el('b', n(Number(o.price))), trail);
    return li;
  }));
  const offersEmpty = $('offers-empty');
  offersEmpty.hidden = s.offers.some(o => o.price !== null);
  offersEmpty.textContent = s.full ? 'Nothing on the block right now. Craft a part in Garage → Customs workshop → Performance & Parts and list it.'
    : 'The block opens with the workshop contract upgrade. The catalogue below is what drivers will be able to build.';

  // 05 rulebook
  $('rules').replaceChildren(...([
    ['Winning pays more', `${p.first} RUSH for a win down to ${p.finish} for a finish. The place only picks one of four fixed amounts, so nobody can claim more than a win pays.`],
    ['Emission is capped', `${perDriver} rewarded races per driver and ${n(cap)} across the game each UTC day, 40 seconds apart at the least. One race pays once, even if the claim is retried.`],
    ['Crafting is a real sink', 'A part costs RUSH, alloy and circuits, and all of it is burned. Every part trades a gain in one stat for a loss in another.'],
    ['Trades settle in one call', `Part and payment move together. ${fee}% of the price is burned, and a stale listing is rejected instead of filled at a changed price.`],
    ['Recycling cannot be farmed', 'Scrapping a part returns half its materials, rounded down, and no RUSH.'],
    ['No free money', 'New accounts start with zero RUSH. The game pays the gas, so players never need NEAR or a wallet.']
  ] as const).map(([title, body]) => {
    const li = el('li');
    li.append(el('b', title), el('span', body));
    return li;
  }));
}

async function refresh(): Promise<void> {
  const live = $('live');
  try {
    render(await load());
    live.dataset.state = 'live';
    $('updated').textContent = `LIVE · NEAR TESTNET · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    live.dataset.state = 'error';
    $('updated').textContent = 'CANNOT REACH NEAR · RETRYING';
  }
}

($('contract') as HTMLAnchorElement).href = explorerAccount(GARAGE);
$('contract').textContent = `${GARAGE} ↗`;
catalogue();

const scenes = [...document.querySelectorAll<HTMLElement>('.scene')];
// The scene crossing the middle of the window directs the stage; a scene reveals as it comes on screen.
const director = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) enter(e.target as HTMLElement);
}, { rootMargin: '-45% 0px -45% 0px' });
const reveal = new IntersectionObserver(entries => {
  for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); reveal.unobserve(e.target); }
}, { rootMargin: '0px 0px -12% 0px' });
for (const s of scenes) { director.observe(s); reveal.observe(s); }
document.querySelector('.chapters a')?.setAttribute('aria-current', 'true');

// The showroom is the heavy part of the page: load it beside the first read, not before it.
void import('./economyStage').then(({ EconomyStage }) => {
  try {
    stage = new EconomyStage($('stage-wrap'), $('market-car-stage'));
    const section = scenes.find(s => s.dataset.scene === scene);
    stage.shot(section?.dataset.shot ?? 'front');
    direct();
  } catch {
    document.body.classList.add('no-gl');
  }
}).catch(() => document.body.classList.add('no-gl'));

void refresh();
setInterval(() => { if (!document.hidden) void refresh(); }, 30_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) runReel(); });
