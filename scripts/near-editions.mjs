// Open the launch limited editions on the garage contract. Owner-only, and safe
// to re-run: editions that already exist are left alone.
//
//   node scripts/near-editions.mjs            # show what would be opened
//   node scripts/near-editions.mjs --send     # open them
//
// Signs as the garage account with NEAR_GAME_KEY, or with the near-cli key in
// ~/.near-credentials/<network>/<garage>.json.
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Account, actions } from 'near-api-js';

const GARAGE = process.env.NEAR_GARAGE ?? 'minirush-garage.testnet';
const NETWORK = GARAGE.endsWith('.testnet') ? 'testnet' : 'mainnet';
const RPC = process.env.NEAR_RPC ?? (NETWORK === 'testnet' ? 'https://test.rpc.fastnear.com' : 'https://free.rpc.fastnear.com');
const NEAR = 10n ** 24n;

// `model` is the game car the edition drives as (src/cars.ts); `color` is paint only this run wears.
export const LAUNCH_EDITIONS = [
  { id: 'lagos-gold', name: 'LAGOS GOLD', model: 'tourbillon', color: 0xffc531, price: 3n * NEAR / 2n, size: 50,
    story: 'Fifty cars for the first season, painted for Lagos nights. Numbered, and yours to resell.' },
  { id: 'island-night', name: 'ISLAND NIGHT', model: 'divo', color: 0x22e6ff, price: 3n * NEAR / 4n, size: 25,
    story: 'Twenty-five late-braking specials in harbour cyan. Once they are gone, only owners can sell you one.' }
];

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = path.join(homedir(), '.near-credentials', NETWORK, `${GARAGE}.json`);
  const key = process.env.NEAR_GAME_KEY ?? await readFile(file, 'utf8').then(text => JSON.parse(text).private_key).catch(() => null);
  if (!key) { console.error(`No key for ${GARAGE}. Set NEAR_GAME_KEY or add ${file}.`); process.exit(1); }
  const garage = new Account(GARAGE, RPC, key);
  const live = await garage.provider.callFunction({ contractId: GARAGE, method: 'editions', args: {} }).catch(() => null);
  if (!live) { console.error(`${GARAGE} has no editions yet: deploy the upgraded contract first.`); process.exit(1); }
  const have = new Set(live.map(e => e.id));
  const todo = LAUNCH_EDITIONS.filter(e => !have.has(e.id));
  for (const e of LAUNCH_EDITIONS) console.log(`${have.has(e.id) ? 'exists ' : 'to open'}  ${e.id}: ${e.size} × ${e.name} at ${Number(e.price * 100n / NEAR) / 100} NEAR`);
  if (!todo.length) console.log('Nothing to do.');
  else if (!process.argv.includes('--send')) console.log(`Dry run on ${GARAGE}. Add --send to open ${todo.length} edition(s).`);
  else {
    const res = await garage.signAndSendTransaction({ receiverId: GARAGE,
      actions: todo.map(e => actions.functionCall('create_edition', { ...e, price: e.price.toString() }, 30_000_000_000_000n, 0n)) });
    console.log(`Opened ${todo.length} edition(s) on ${GARAGE}: ${res.transaction.hash}`);
  }
}
