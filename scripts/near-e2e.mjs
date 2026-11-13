// Opt-in integration test against a deployed v2 garage + Convex backend.
// Creates ephemeral TESTNET accounts and submits simulated race checkpoints.
// This checks settlement plumbing, not anti-cheat or real driving. Takes ~3 minutes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Account, KeyPair, actions, encodeSignedDelegate } from 'near-api-js';
if (!process.argv.includes('--testnet')) throw new Error('Use --testnet to create test accounts and submit testnet transactions');
const local = Object.fromEntries(readFileSync('.env.local','utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const url = process.env.VITE_CONVEX_URL ?? local.VITE_CONVEX_URL;
const rpc = process.env.VITE_NEAR_RPC ?? local.VITE_NEAR_RPC ?? 'https://test.rpc.fastnear.com';
const garage = process.env.VITE_NEAR_GARAGE ?? local.VITE_NEAR_GARAGE ?? 'minirush-garage.testnet';
assert.ok(garage.endsWith('.testnet'), 'This script only operates on testnet garages');
assert.ok(url, 'Set VITE_CONVEX_URL');
const call = async (path, args) => {
  const response = await fetch(`${url}/api/action`, { method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({path,args,format:'json'}), signal:AbortSignal.timeout(60000) });
  const b = await response.json(); if (b.status !== 'success') throw new Error(`${path}: ${b.errorMessage}`); return b.value;
};
const view = (method,args={}) => new Account(garage,rpc).provider.callFunction({contractId:garage,method,args});
assert.equal((await view('component_recipes')).length,12);
assert.equal((await view('nft_metadata')).symbol,'MINIRUSH');
const makePlayer = async () => {
  const key = KeyPair.fromRandom('ed25519');
  const {account} = await call('near:createPlayer',{publicKey:key.getPublicKey().toString()});
  console.log('Created test player:',account);
  return {account,key};
};
const sign = (p,message) => Buffer.from(p.key.sign(new TextEncoder().encode(message)).signature).toString('base64');
const tierRush = place => ({ 1: 45, 2: 36, 3: 30 })[place] ?? 24;
const reward = async (p, place = 0) => {
  const distance=960, run=crypto.randomUUID();
  const race = await call('near:beginRace',{account:p.account,run,distance,
    signature:sign(p,`minirush:race:begin:${p.account}:${run}:${distance}`)});
  const start=Date.now(); let count=0;
  // Checkpoints carry no place; the finish signs the podium tier it claims.
  const progress = async (finish, claim = place) => {
    const elapsed=Math.floor((Date.now()-start)/1000), progress=Math.min(distance,elapsed*20);
    return call('near:raceProgress',{account:p.account,race,progress,elapsed,finish,...(finish?{place:claim}:{}),
      signature:sign(p,`minirush:race:progress:${p.account}:${race}:${progress}:${elapsed}:${finish}${finish?`:${claim}`:''}`)});
  };
  do {
    await new Promise(resolve => setTimeout(resolve,4000));
    await progress(false); count++;
    console.log('Checkpoint',p.account.split('.')[0],count);
  } while(Date.now()-start<48000 || count<4);
  const result=await progress(true);
  // Replaying the finish as a win must return the first settlement, not a bigger one.
  const replay=await progress(true,1);
  assert.equal(result.tx,replay.tx,'same race returns its settled transaction');
  assert.equal(result.minted,tierRush(place)); assert.equal(replay.minted,tierRush(place),'a replay cannot upgrade its podium tier');
  console.log('Reward settled:',result.tx);
};
const relay = async (p,method,args) => {
  const me=new Account(p.account,rpc,p.key.toString());
  const {signedDelegate}=await me.createSignedMetaTransaction({receiverId:garage,
    actions:[actions.functionCall(method,args,70_000_000_000_000n,0n)]});
  return call('near:relay',{signedDelegate:Buffer.from(encodeSignedDelegate(signedDelegate)).toString('base64')});
};
const maker=await makePlayer(), buyer=await makePlayer();
const before=await view('economy',{});
// Maker: a win, a second place and a plain finish (45 + 36 + 24). Buyer: third place (30).
await Promise.all([(async()=>{for(const place of [1,2,0]) await reward(maker,place);})(),reward(buyer,3)]);
await relay(maker,'craft_component',{recipe_id:'street-turbo'});
const [part]=await view('component_inventory',{account_id:maker.account});
assert.ok(part?.id);
await relay(maker,'install_component',{part_id:part.id,chassis:'viper'});
await relay(maker,'list_component',{part_id:part.id,price:'20'});
const offer=await view('component',{part_id:part.id});
assert.equal(offer.installed_on,null);
await relay(buyer,'buy_component',{part_id:part.id,offer:offer.offer,max_price:'20'});
await relay(buyer,'install_component',{part_id:part.id,chassis:'rush-one'});
const bought=await view('component',{part_id:part.id});
assert.equal(bought.owner,buyer.account); assert.equal(bought.maker,maker.account);
assert.equal(bought.installed_on,'rush-one'); assert.equal(bought.price,null);
assert.equal((await view('component_inventory',{account_id:maker.account})).length,0);
assert.equal((await view('nft_token',{token_id:part.id})).owner_id,buyer.account);
assert.equal(await view('mt_balance_of',{account_id:maker.account,token_id:'rush'}),'64'); // 105 earned − 60 crafted + 19 from the sale
assert.equal(await view('mt_balance_of',{account_id:buyer.account,token_id:'rush'}),'10');
// Other players may be active on testnet, so the ledger is checked as a lower bound on this run's activity.
const after=await view('economy',{}), grew=k=>after.ledger[k]-before.ledger[k];
assert.ok(grew('races_paid')>=4 && grew('podiums')>=3 && grew('rush_minted')>=135);
assert.ok(grew('rush_burned_craft')>=60 && grew('rush_burned_fees')>=1 && grew('trades')>=1 && grew('trade_volume')>=20 && grew('parts_crafted')>=1);
console.log('PASS: session replay protection, salvage, crafting, install, listing, atomic purchase, NFT owner, maker provenance and balances.');
