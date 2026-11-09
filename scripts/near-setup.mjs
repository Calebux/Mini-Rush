// One-off: register every car and the nitro can on the garage contract,
// enable the three dealer accounts and open their stalls at the game's
// original coin prices. Safe to re-run (register/list are idempotent).
// Signs with keys from ~/.near-credentials/testnet (created by near-cli).
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Account, actions } from 'near-api-js';

const RPC = process.env.NEAR_RPC ?? 'https://rpc.testnet.near.org';
const GARAGE = process.env.NEAR_GARAGE ?? 'minirush-garage.testnet';
const DIR = path.join(homedir(), '.near-credentials', 'testnet');
const TGAS = 30_000_000_000_000n;

async function account(id) {
  const { private_key } = JSON.parse(await readFile(path.join(DIR, `${id}.json`), 'utf8'));
  return new Account(id, RPC, private_key);
}

const D = (n) => `${n}.${GARAGE}`;
// [token, name, dealer, price, stock]
const STOCK = [
  ['car:sunburst', 'SUNBURST', D('mama-t'), 300, 8],
  ['car:gecko', 'GECKO', D('mama-t'), 250, 8],
  ['car:phantom', 'PHANTOM', D('mama-t'), 400, 6],
  ['car:volt', 'THUNDERVOLT', D('mama-t'), 350, 6],
  ['car:juggernaut', 'JUGGERNAUT', D('mama-t'), 500, 5],
  ['car:sidewinder', 'SIDEWINDER', D('mama-t'), 450, 5],
  ['car:glasscannon', 'GLASS CANNON', D('mama-t'), 600, 4],
  ['car:r8', 'AURORA V10', D('oga-motors'), 2000, 3],
  ['car:sesto', 'CINDER R', D('oga-motors'), 2200, 3],
  ['car:aventador', 'AVANTI SV', D('oga-motors'), 2500, 2],
  ['car:divo', 'DERVISH', D('oga-motors'), 2600, 2],
  ['car:tourbillon', 'TOURMALINE', D('oga-motors'), 3000, 1],
  ['car:stockcar', 'STOCK 88', D('tuner-ade'), 1200, 4],
  ['part:nitro-can', 'NITRO CAN', D('tuner-ade'), 40, 60],
];

const call = (method, args) => actions.functionCall(method, args, TGAS, 0n);

const game = await account(GARAGE);
const setup = [];
for (const [token, name] of STOCK) {
  const kind = token.split(':')[0];
  setup.push(call('register_token', { token_id: token, kind, name }));
}
for (const d of new Set(STOCK.map((s) => s[2]))) setup.push(call('set_dealer', { account_id: d, enabled: true }));
await game.signAndSendTransaction({ receiverId: GARAGE, actions: setup });
console.log('registered', STOCK.length, 'items and the dealers');

for (const d of new Set(STOCK.map((s) => s[2]))) {
  const dealer = await account(d);
  const mine = STOCK.filter((s) => s[2] === d).map(([token, , , price, stock]) =>
    call('dealer_list', { token_id: token, price: String(price), stock, reason: 'Opening stock at the list price.' }));
  await dealer.signAndSendTransaction({ receiverId: GARAGE, actions: mine });
  console.log(d, 'opened', mine.length, 'stalls');
}
