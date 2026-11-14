// Offline adversarial checks against actual Convex handlers. No keys or network.
// The DB adapter serializes mutations with rollback; Convex supplies real OCC in production.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'vite';
import { getFunctionName } from 'convex/server';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, createTransaction, baseEncode } from 'near-api-js';
import { boundedSetting, grantMessage } from '../shared/sponsorPolicy.ts';

for (const value of ['NaN', 'Infinity', '-1', '', ' 2', '2e1', '2.0001']) assert.throws(() => boundedSetting(value, 2, 0, 2));
assert.throws(() => boundedSetting('3', 2, 0, 2));
assert.equal(boundedSetting(undefined, 2, 0, 2), 2);
assert.equal(boundedSetting('0', 2, 0, 2), 0);
const game = KeyPair.fromRandom('ed25519'), player = KeyPair.fromRandom('ed25519'), attacker = KeyPair.fromRandom('ed25519');
process.env.NEAR_GAME_KEY = game.toString(); process.env.NEAR_GARAGE = 'security-game.testnet';
process.env.NEAR_RPC = 'http://127.0.0.1:1'; // Any unmocked network access fails closed.
let rows = new Map(), serial = 0, now = 1_800_000_000_000, queue = Promise.resolve();
const realNow = Date.now; Date.now = () => now;
const db = {
  insert: async (table, data) => { const id = `${table}:${++serial}`; rows.set(id, { ...structuredClone(data), _id: id, _table: table }); return id; },
  get: async id => structuredClone(rows.get(id) ?? null),
  patch: async (id, data) => rows.set(id, { ...rows.get(id), ...structuredClone(data) }),
  delete: async id => rows.delete(id),
  query: table => ({ withIndex: (_, build) => {
    const checks = [], q = {};
    for (const [name, op] of Object.entries({ eq: (a,b)=>a===b, gt:(a,b)=>a>b, gte:(a,b)=>a>=b, lt:(a,b)=>a<b }))
      q[name] = (key,value) => { checks.push(row=>op(row[key],value)); return q; };
    build(q);
    const matches = () => [...rows.values()].filter(row=>row._table===table && checks.every(check=>check(row))).map(row=>structuredClone(row));
    return { first: async()=>matches()[0]??null, collect: async()=>matches(), take: async n=>matches().slice(0,n) };
  } })
};
const server = await createServer({ configFile:false, server:{middlewareMode:true,hmr:false,watch:null,ws:{server:httpServer()}},appType:'custom' });
let broadcasts=0, signatures=0, grants=0, dropResponse=false;
const outcomes=new Map();
const good = hash => ({ final_execution_status:'FINAL', transaction:{hash}, status:{SuccessValue:''}, receipts_outcome:[{outcome:{status:{SuccessValue:''}}}] });
const original={create:Account.prototype.createSignedTransaction, send:JsonRpcProvider.prototype.sendTransactionUntil,
  status:JsonRpcProvider.prototype.viewTransactionStatus, grant:Account.prototype.signAndSendTransaction, state:Account.prototype.getState};
Account.prototype.createSignedTransaction=async function({receiverId,actions}){
  signatures++;
  return (await KeyPairSigner.fromSecretKey(game.toString()).signTransaction(createTransaction(this.accountId,game.getPublicKey(),receiverId,BigInt(signatures),actions,new Uint8Array(32)))).signedTransaction;
};
JsonRpcProvider.prototype.sendTransactionUntil=async signed=>{
  broadcasts++; const hash=baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
  outcomes.set(hash,good(hash));
  if(dropResponse){dropResponse=false;throw new Error('response lost');}
  return outcomes.get(hash);
};
JsonRpcProvider.prototype.viewTransactionStatus=async({txHash})=>{if(!outcomes.has(txHash))throw new Error('unknown');return outcomes.get(txHash);};
Account.prototype.getState=async()=>({balance:{available:String(100n*10n**24n)}});
Account.prototype.signAndSendTransaction=async()=>{grants++;return good('grant');};
try {
  const backend=await server.ssrLoadModule('/convex/nearDb.ts'), api=await server.ssrLoadModule('/convex/near.ts');
  const profiles=await server.ssrLoadModule('/convex/profiles.ts');
  for(const method of ['sync','setName','addCar']) await assert.rejects(profiles[method]._handler({},{}),/disabled/);
  const invokeMutation=(name,args)=>{
    const next=queue.then(async()=>{const snapshot=structuredClone(rows);try{return await backend[name]._handler({db},args);}catch(e){rows=snapshot;throw e;}});
    queue=next.catch(()=>{}); return next;
  };
  const ctx={auth:{getUserIdentity:async()=>null},runQuery:(ref,args)=>backend[getFunctionName(ref).split(':')[1]]._handler({db},args),runMutation:(ref,args)=>invokeMutation(getFunctionName(ref).split(':')[1],args)};
  const call=(name,args)=>api[name]._handler(ctx,args);
  const publicKey=player.getPublicKey().toString();
  // Funding succeeds but its response disappears. Retry must query the saved hash,
  // register the player, and neither sign nor fund a second account.
  dropResponse=true;
  await assert.rejects(call('createPlayer',{publicKey}),/still being checked/);
  assert.equal(broadcasts,1);
  const created=await call('createPlayer',{publicKey});
  assert.equal(created.created,true);assert.equal(broadcasts,1);assert.equal(signatures,1);
  assert.equal((await call('createPlayer',{publicKey})).created,false);
  await assert.rejects(call('relay',{signedDelegate:'anything'}),/tracked garage actions/);
  const account=created.account, sign=(key,at=now,target=account)=>Buffer.from(key.sign(new TextEncoder().encode(grantMessage(target,at))).signature).toString('base64');
  await assert.rejects(call('testNear',{account,at:now,signature:sign(attacker)}),/authorization/);
  await assert.rejects(call('testNear',{account,at:now-61_000,signature:sign(player,now-61_000)}),/authorization/);
  await assert.rejects(call('testNear',{account,at:now,signature:sign(player,now,'somebody-else.testnet')}),/authorization/);
  assert.equal(grants,0,'invalid proofs never reach transfer');
  const signedGrant={account,at:now,signature:sign(player)};
  const concurrent=await Promise.all([call('testNear',signedGrant),call('testNear',signedGrant)]);
  assert.deepEqual(concurrent.map(r=>r.state).sort(),['already','sent']);assert.equal(grants,1);
  process.env.NEAR_TEST_GRANT_DAILY='NaN';
  await assert.rejects(call('testNear',signedGrant),/configuration/);delete process.env.NEAR_TEST_GRANT_DAILY;
  process.env.NEAR_SPONSORSHIP_PAUSED='true';
  await assert.rejects(call('testNear',signedGrant),/paused/);
  await assert.rejects(call('createPlayer',{publicKey:attacker.getPublicKey().toString()}),/paused/);
  assert.equal((await call('createPlayer',{publicKey})).account,account,'existing garage access survives pause');
  delete process.env.NEAR_SPONSORSHIP_PAUSED;
  rows.clear();
  const reserve=account=>invokeMutation('reserveGrant',{account,amount:'2',cap:20,availableForGrants:'3',balanceReadStartedAt:now});
  const pooled=await Promise.all([reserve('one.testnet'),reserve('two.testnet')]);
  assert.deepEqual(pooled.sort(),['ok','pool'],'concurrent grants cannot reuse a shared balance snapshot');
  await invokeMutation('settleGrant',{account:'one.testnet',tx:'confirmed'});
  assert.equal(await reserve('two.testnet'),'pool','settlement during an in-flight balance read remains reserved');
  now+=1000;
  assert.equal(await reserve('two.testnet'),'ok','a fresh balance snapshot can release a settled reservation');
  now+=1000;
  const readStartedAt=now;
  now+=1000;
  await invokeMutation('settleGrant',{account:'two.testnet',tx:'late-confirmation'});
  assert.equal(await invokeMutation('reserveGrant',{account:'three.testnet',amount:'2',cap:20,availableForGrants:'3',balanceReadStartedAt:readStartedAt}),'pool','an older pending grant settling during a new balance read remains held');
  // A burst of distinct provisioning requests cannot bypass the atomic hourly cap.
  rows.clear();
  const attempts=await Promise.allSettled(Array.from({length:30},(_,i)=>invokeMutation('prepareCreation',{account:`p${i}.testnet`,publicKey:`key${i}`,tx:`tx${i}`,signedTransaction:'fixture'})));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,20);
  assert.equal([...rows.values()].filter(r=>r._table==='nearCreations').length,20);
  assert.equal((await invokeMutation('prepareCreation',{account:'p0.testnet',publicKey:'key0',tx:'replacement',signedTransaction:'replacement'})).tx,'tx0','duplicate reservation keeps original bytes at cap');
  // Rollback: a failed daily check must not consume an hourly slot.
  for(let hour=1;hour<5;hour++){
    now+=3600_000;
    for(let i=0;i<20;i++)await invokeMutation('prepareCreation',{account:`d${hour}-${i}.testnet`,publicKey:`day${hour}-${i}`,tx:'t',signedTransaction:'s'});
  }
  now+=3600_000;
  const size=rows.size;
  await assert.rejects(invokeMutation('prepareCreation',{account:'over.testnet',publicKey:'over',tx:'t',signedTransaction:'s'}),/limit/);
  assert.equal(rows.size,size,'failed daily reservation rolls back hourly counter');
  rows.clear();
  const budget=()=>invokeMutation('reserveBroadcast',{account:'alice.testnet',kind:'relay'});
  for(let i=0;i<12;i++)await budget();
  await assert.rejects(budget(),/limit/);
  await invokeMutation('reserveBroadcast',{account:'bob.testnet',kind:'relay'});
  now+=60_000;await budget();
  // Global limit applies even with fresh accounts; retries also consume budget.
  await db.insert('sponsorBudgets',{scope:'race:global:day',window:Math.floor(now/86400_000),used:3000,expiresAt:now+86400_000});
  await assert.rejects(invokeMutation('reserveBroadcast',{account:'fresh.testnet',kind:'race'}),/limit/);
  console.log('PASS: actual funding/relay/grant handlers; lost-response recovery without duplicate funding; forged/stale/wrong-account grant signatures; concurrent one-time grants; paused spending; atomic hourly/daily/global budgets and rollback. Offline adapters, no chain transactions.');
} finally {
  Date.now=realNow;await server.close();
  Account.prototype.createSignedTransaction=original.create;JsonRpcProvider.prototype.sendTransactionUntil=original.send;
  JsonRpcProvider.prototype.viewTransactionStatus=original.status;Account.prototype.signAndSendTransaction=original.grant;Account.prototype.getState=original.state;
}
