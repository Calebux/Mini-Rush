// Offline acceptance: journal, finalized receipts, and the actual Convex action
// with in-memory DB/RPC adapters. No credentials or real network calls are used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, buildDelegateAction,
  createTransaction, encodeSignedDelegate, baseEncode } from 'near-api-js';
import { getFunctionName } from 'convex/server';
import { ActionJournal, ACTIONS_KEY, settledOutcome } from '../shared/garageRecovery.ts';

const data=new Map(), storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
const journal=new ActionJournal(storage);
const a={id:'a',scope:'garage:alice',method:'buy',args:{token_id:'car:r8'},signedDelegate:'signed-a',createdAt:1,result:{state:'pending'}};
journal.begin(a);
assert.throws(()=>journal.begin({...a,id:'b'}),/previous action/);
assert.equal(journal.pending('garage:bob'),undefined);
assert.equal(new ActionJournal(storage).pending(a.scope).signedDelegate,'signed-a','reload restores the exact request');
journal.settle(a,{state:'confirmed'});assert.equal(journal.pending(a.scope).id,'a','missing receipt never confirms');
journal.settle(a,{state:'confirmed',tx:'receipt'});
journal.settle(a,{state:'pending'});assert.equal(journal.list(a.scope)[0].result.state,'confirmed','late response cannot regress success');
for(let i=0;i<35;i++)journal.save({...a,id:`done-${i}`,result:{state:'confirmed',tx:'tx'}});
journal.begin({...a,id:'pending'});
assert.equal(journal.list(a.scope).length,31);assert.equal(journal.pending(a.scope).id,'pending');
assert.throws(()=>new ActionJournal({getItem:()=>null,setItem:()=>{throw new Error('quota');}}).begin(a),/quota/);
data.set(ACTIONS_KEY,'corrupt');assert.throws(()=>journal.pending(a.scope));
const good=hash=>({final_execution_status:'FINAL',transaction:{hash},status:{SuccessValue:''},receipts_outcome:[{outcome:{status:{SuccessValue:Buffer.from(JSON.stringify('part:1')).toString('base64')}}}]});
assert.equal(settledOutcome({...good('h'),final_execution_status:'EXECUTED_OPTIMISTIC'},'h'),null);
assert.equal(settledOutcome(good('wrong'),'h'),null);
assert.equal(settledOutcome({...good('h'),status:'Unknown'},'h'),null);
const bad=good('h');bad.receipts_outcome[0].outcome.status={Failure:{ActionError:'price went up'}};
assert.equal(settledOutcome(bad,'h').state,'failed','outer success cannot hide inner failure');

const player=KeyPair.fromRandom('ed25519'), game=KeyPair.fromRandom('ed25519');
const requireLogin = !process.argv.includes('--guest');
process.env.SHOP_SIGN_IN = requireLogin ? 'required' : '';
process.env.NEAR_GAME_KEY=game.toString();process.env.NEAR_GARAGE='recovery-game.testnet';
process.env.NEAR_RPC='http://127.0.0.1:1'; // accidental RPC use must fail, never reach a chain
const stored=new Map(), outcomes=new Map();let broadcasts=0, prepares=0, effects=0, failure=false, lost=true;
const original={create:Account.prototype.createSignedTransaction,block:JsonRpcProvider.prototype.viewBlock,
 status:JsonRpcProvider.prototype.viewTransactionStatus,send:JsonRpcProvider.prototype.sendTransactionUntil};
Account.prototype.createSignedTransaction=async function({receiverId,actions:acts}){
 prepares++;
 const tx=createTransaction(this.accountId,game.getPublicKey(),receiverId,BigInt(prepares),acts,new Uint8Array(32));
 return (await KeyPairSigner.fromSecretKey(game.toString()).signTransaction(tx)).signedTransaction;
};
JsonRpcProvider.prototype.viewBlock=async()=>({header:{height:100}});
JsonRpcProvider.prototype.viewTransactionStatus=async({txHash})=>{if(!outcomes.has(txHash))throw new Error('unknown');return outcomes.get(txHash);};
JsonRpcProvider.prototype.sendTransactionUntil=async signed=>{
 broadcasts++;
 const hash=baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
 if(!outcomes.has(hash)){
  const result=good(hash);
  if(failure)result.receipts_outcome[0].outcome.status={Failure:{ActionError:'sold out'}};
  else effects++;
  outcomes.set(hash,result);
 }
 if(lost){lost=false;throw new Error('response lost after execution');}
 return outcomes.get(hash);
};
let signedIn = false;
const ctx={
 auth: { getUserIdentity: async () => signedIn ? { subject: 'google-oauth2|fixture' } : null },
 runQuery:async(ref,args)=>{
  const name=getFunctionName(ref);
  if(name==='nearDb:playerByAccount')return{account:args.account,publicKey:player.getPublicKey().toString()};
  if(name==='nearDb:garageAction')return stored.get(args.digest)??null;
  throw new Error(`Unexpected query ${name}`);
 },
 runMutation:async(ref,args)=>{
  const name=getFunctionName(ref);
  if(name==='nearDb:reserveBroadcast')return;
  if(name==='nearDb:prepareGarageAction'){
   if(!stored.has(args.digest))stored.set(args.digest,{...args,state:'pending',createdAt:Date.now()});
   return stored.get(args.digest);
  }
  if(name==='nearDb:finishGarageAction'){Object.assign(stored.get(args.digest),args);return;}
  throw new Error(`Unexpected mutation ${name}`);
 }
};
// Attach Vite's websocket machinery to a server that never listens; this is a module test.
const server=await createServer({configFile:false,server:{middlewareMode:true,hmr:false,watch:null,ws:{server:createHttpServer()}},appType:'custom'});
try{
 const {relayTracked,relay}=await server.ssrLoadModule('/convex/near.ts');
 const request=async(nonce=1,method='buy',key=player)=>{
  const delegate=buildDelegateAction({senderId:'alice.testnet',receiverId:'recovery-game.testnet',publicKey:key.getPublicKey(),nonce:BigInt(nonce),maxBlockHeight:300n,
   actions:[actions.functionCall(method,{token_id:'car:r8',max_price:'100'},70_000_000_000_000n,0n)]});
  const signed=await KeyPairSigner.fromSecretKey(key.toString()).signDelegateAction(delegate);
  return{signedDelegate:Buffer.from(encodeSignedDelegate(signed.signedDelegate)).toString('base64')};
 };
 const req=await request();
 if (requireLogin) {
 assert.equal((await relayTracked._handler(ctx,req)).state,'failed', 'guest purchase rejected');
 assert.equal(prepares,0); assert.equal(broadcasts,0); assert.equal(stored.size,0);
 for (const method of ['buy_component','craft_component']) {
  assert.equal((await relayTracked._handler(ctx,await request(9,method))).state,'failed');
 }
 await assert.rejects(() => relay._handler(ctx,req), /tracked garage actions/,'legacy endpoint is retired');
 }
 signedIn = requireLogin;
 assert.equal((await relayTracked._handler(ctx,req)).state,'pending');
 assert.equal(effects,1);assert.equal(stored.size,1);
 signedIn = false; // Logout cannot strand a transaction already approved and persisted.
 const recovered=await relayTracked._handler(ctx,req);
 assert.equal(recovered.state,'confirmed');assert.equal(recovered.value,'part:1');
 assert.equal(broadcasts,1,'recovery reads original receipt without another broadcast');
 assert.equal(prepares,1,'no replacement transaction is signed');
 assert.deepEqual(await relayTracked._handler(ctx,req),recovered,'terminal result is durable');
 signedIn = true;
 failure=true;
 assert.equal((await relayTracked._handler(ctx,await request(2))).state,'failed');
 assert.equal(effects,1,'inner contract failure cannot grant ownership');
 const before=stored.size;
 assert.equal((await relayTracked._handler(ctx,await request(3,'mint'))).state,'failed');
 assert.equal((await relayTracked._handler(ctx,await request(3,'buy',KeyPair.fromRandom('ed25519')))).state,'failed');
 assert.equal(stored.size,before,'unapproved calls and forged account signatures are not journaled');
 console.log(`PASS (${requireLogin ? 'sign-in required' : 'guest shopping'}): durable local request, scoped recovery, storage failure, stale responses, receipt finality, inner failure, actual relay authentication, persist-before-broadcast and lost-response recovery without duplicate execution.`);
}finally{
 await server.close();
 Account.prototype.createSignedTransaction=original.create;JsonRpcProvider.prototype.viewBlock=original.block;
 JsonRpcProvider.prototype.viewTransactionStatus=original.status;JsonRpcProvider.prototype.sendTransactionUntil=original.send;
}
