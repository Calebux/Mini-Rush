// Actual Convex handlers/mutations, real Ed25519 signatures, fake DB/RPC only.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer as httpServer } from 'node:http';
import { createServer } from 'vite';
import * as borsh from 'borsh';
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, createTransaction, baseEncode } from 'near-api-js';
import { getFunctionName } from 'convex/server';
import { identityPayload, identityStartMessage, AUTH_ISSUER, AUTH_AUDIENCE } from '../shared/identityProof.ts';

const nonce = Uint8Array.from({ length: 32 }, (_, i) => i);
const schema = { struct: { tag: 'u32', message: 'string', nonce: { array: { type: 'u8', len: 32 } }, recipient: 'string', callbackUrl: { option: 'string' } } };
const bytes = identityPayload('MiniRush 🏁', 'https://minirush.site', nonce);
assert.deepEqual(bytes, borsh.serialize(schema, { tag: 2 ** 31 + 413, message: 'MiniRush 🏁', nonce, recipient: 'https://minirush.site', callbackUrl: null }));
assert.equal(Buffer.from(bytes).subarray(0, 4).toString('hex'), '9d010080');
assert.equal(bytes.at(-1), 0, 'callbackUrl is omitted');
assert.throws(() => identityPayload('x', 'y', new Uint8Array(31)), /nonce/);

const rows = new Map(); let ids = 0;
const db = {
  get: async id => rows.get(id) ?? null,
  insert: async (table, value) => { const id = `${table}:${++ids}`; rows.set(id, { ...value, _id: id, _table: table }); return id; },
  patch: async (id, value) => { const row = { ...rows.get(id), ...value }; for (const k of Object.keys(row)) if (row[k] === undefined) delete row[k]; rows.set(id, row); },
  delete: async id => { rows.delete(id); },
  query(table) {
    const filters = []; let index;
    const q = {
      eq(k, v) { filters.push(row => row[k] === v); return q; },
      gt(k, v) { filters.push(row => row[k] > v); return q; },
      lt(k, v) { filters.push(row => row[k] < v); return q; }
    };
    const all = () => [...rows.values()].filter(row => row._table === table && filters.every(f => f(row)))
      .sort((a,b) => (index?.includes('expiry') ? a.expiresAt - b.expiresAt : (a.createdAt ?? 0) - (b.createdAt ?? 0)));
    const query = { withIndex(name, filter) { index = name; filter(q); return query; }, first: async () => all()[0] ?? null,
      take: async n => all().slice(0, n), collect: async () => all() };
    return query;
  }
};
const garage = KeyPair.fromRandom('ed25519'), identity = KeyPair.fromRandom('ed25519'), game = KeyPair.fromRandom('ed25519');
const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
process.env.NEAR_GAME_KEY = game.toString(); process.env.NEAR_GARAGE = 'proof-game.testnet';
process.env.NEAR_RPC = 'http://127.0.0.1:1'; process.env.NEAR_AUTH_PROOFS_ENABLED = 'true'; process.env.NEAR_AUTH_SIGN_DEPOSIT_YOCTO = '1';
const account = 'driver.proof-game.testnet';
await db.insert('nearPlayers', { account, publicKey: garage.getPublicKey().toString() });
let preparations = 0, broadcasts = 0, effects = 0, lost = true, rejectGuard = false, fullAccess = true;
const outcomes = new Map();
const original = { access: JsonRpcProvider.prototype.viewAccessKey, view: JsonRpcProvider.prototype.callFunction,
  create: Account.prototype.createSignedTransaction, status: JsonRpcProvider.prototype.viewTransactionStatus, send: JsonRpcProvider.prototype.sendTransactionUntil };
JsonRpcProvider.prototype.viewAccessKey = async () => ({ permission: fullAccess ? 'FullAccess' : { FunctionCall: {} } });
JsonRpcProvider.prototype.callFunction = async ({ contractId, method, args }) => {
  assert.equal(contractId, 'v1.signer-prod.testnet'); assert.equal(method, 'derived_public_key');
  assert.equal(args.predecessor, 'fast-auth.testnet'); assert.equal(args.domain_id, 1);
  return args.path.endsWith('#google-oauth2|fixture') ? identity.getPublicKey().toString() : game.getPublicKey().toString();
};
Account.prototype.createSignedTransaction = async function({ receiverId, actions }) {
  preparations++;
  assert.equal(receiverId, 'fast-auth.testnet');
  const tx = createTransaction(this.accountId, game.getPublicKey(), receiverId, BigInt(preparations), actions, new Uint8Array(32));
  return (await KeyPairSigner.fromSecretKey(game.toString()).signTransaction(tx)).signedTransaction;
};
JsonRpcProvider.prototype.viewTransactionStatus = async ({ txHash }) => { if (!outcomes.has(txHash)) throw new Error('unknown'); return outcomes.get(txHash); };
JsonRpcProvider.prototype.sendTransactionUntil = async signed => {
  broadcasts++;
  const tx = baseEncode(createHash('sha256').update(signed.transaction.encode()).digest());
  const stored = [...rows.values()].find(row => row.tx === tx);
  assert.ok(stored?.signedTransaction, 'persisted before broadcasting');
  if (!outcomes.has(tx)) {
    effects++;
    const call = signed.transaction.actions[0].functionCall;
    assert.equal(call.methodName, 'sign'); assert.equal(call.deposit, 1n);
    const args = JSON.parse(Buffer.from(call.args));
    assert.equal(args.guard_id, `jwt#${AUTH_ISSUER}`); assert.equal(args.algorithm, 'eddsa');
    const signature = identity.sign(createHash('sha256').update(Uint8Array.from(args.sign_payload)).digest()).signature;
    const status = { SuccessValue: Buffer.from(JSON.stringify(rejectGuard ? null : { scheme: 'Ed25519', signature: [...signature] })).toString('base64') };
    outcomes.set(tx, { final_execution_status: 'FINAL', transaction: { hash: tx }, status, receipts_outcome: [{ outcome: { status } }] });
  }
  if (lost) { lost = false; throw new Error('response lost after MPC signing'); }
  return outcomes.get(tx);
};
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, watch: null, ws: { server: httpServer() } }, appType: 'custom' });
try {
  const actions = await server.ssrLoadModule('/convex/near.ts');
  const mutations = await server.ssrLoadModule('/convex/nearDb.ts');
  const crypto = await server.ssrLoadModule('/convex/identityProofCrypto.ts');
  let queue = Promise.resolve();
  const ctx = {
    runQuery: async (ref, args) => mutations[getFunctionName(ref).split(':')[1]]._handler({ db }, args),
    runMutation(ref, args) {
      const next = queue.then(() => mutations[getFunctionName(ref).split(':')[1]]._handler({ db }, args));
      queue = next.catch(() => {}); return next;
    }
  };
  let requestId = 0;
  const start = async (key = garage) => {
    const args = { account, identityKey: identity.getPublicKey().toString(), recipient: 'https://minirush.site', request: `ownership-request-${++requestId}`, at: now };
    args.signature = Buffer.from(key.sign(new TextEncoder().encode(identityStartMessage(account, args.identityKey, args.recipient, args.request, args.at))).signature).toString('base64');
    return actions.beginIdentityProof._handler(ctx, args);
  };
  const signature = (challenge, key = garage) => Buffer.from(key.sign(createHash('sha256').update(crypto.proofBytes(challenge)).digest()).signature).toString('base64');
  const token = (challenge, extra = {}) => [ { alg: 'RS256' }, { iss: AUTH_ISSUER, sub: 'google-oauth2|fixture', aud: AUTH_AUDIENCE,
    exp: Math.floor(now / 1000) + 300, fatxn: [...crypto.proofBytes(challenge)], ...extra } ].map(v => Buffer.from(JSON.stringify(v)).toString('base64url')).join('.') + '.fixture-signature';
  await assert.rejects(() => start(identity), /signature/);
  const challenge = await start();
  assert.equal(challenge.expiresAt, now + 300000);
  assert.equal(crypto.proofBytes(challenge).at(-1), 0);
  assert.equal((await actions.completeIdentityProof._handler(ctx, { id: challenge.id, garageSignature: signature(challenge) })).state, 'needs_approval');
  await assert.rejects(() => actions.completeIdentityProof._handler(ctx, { id: challenge.id, garageSignature: signature(challenge, identity), signingToken: token(challenge) }), /signature/);
  for (const extra of [{ iss: 'https://evil.test/' }, { aud: 'wrong' }, { exp: 0 }, { nbf: now / 1000 + 60 }, { fatxn: [1,2,3] }])
    await assert.rejects(() => actions.completeIdentityProof._handler(ctx, { id: challenge.id, garageSignature: signature(challenge), signingToken: token(challenge, extra) }), /signing request/);
  await assert.rejects(() => actions.completeIdentityProof._handler(ctx, { id: challenge.id, garageSignature: signature(challenge), signingToken: token(challenge, { sub: 'someone-else' }) }), /identity changed/);
  assert.equal(preparations, 0);
  assert.equal((await actions.completeIdentityProof._handler(ctx, { id: challenge.id, garageSignature: signature(challenge), signingToken: token(challenge) })).state, 'pending');
  assert.equal(effects, 1);
  const recovered = await actions.completeIdentityProof._handler(ctx, { id: challenge.id, garageSignature: signature(challenge) });
  assert.equal(recovered.state, 'verified'); assert.ok(recovered.tx);
  assert.equal(preparations, 1); assert.equal(broadcasts, 1);
  assert.deepEqual(await actions.completeIdentityProof._handler(ctx, { id: challenge.id, garageSignature: signature(challenge) }), recovered);
  assert.equal((await db.get(challenge.id)).signedTransaction, undefined, 'JWT-bearing bytes cleared at terminal result');
  const links = () => [...rows.values()].filter(row => row._table === 'garageIdentities');
  assert.equal(links().length, 1);
  now += 31_000;
  const second = await start();
  await assert.rejects(() => actions.completeIdentityProof._handler(ctx, { id: second.id, garageSignature: signature(challenge), signingToken: token(second) }), /signature/);
  rejectGuard = true;
  assert.equal((await actions.completeIdentityProof._handler(ctx, { id: second.id, garageSignature: signature(second), signingToken: token(second) })).state, 'failed');
  assert.equal(links().length, 1, 'rejected guard result cannot establish another association');
  now += 31_000; const expired = await start(); now += 300001;
  assert.equal((await actions.completeIdentityProof._handler(ctx, { id: expired.id, garageSignature: signature(expired), signingToken: token(expired) })).state, 'failed');
  const before = preparations;
  fullAccess = false; await assert.rejects(() => start(), /no longer active/); fullAccess = true;
  process.env.NEAR_AUTH_PROOFS_ENABLED = 'false'; await assert.rejects(() => start(), /not enabled/); process.env.NEAR_AUTH_PROOFS_ENABLED = 'true';
  assert.equal(preparations, before);
  // Exercise actual mutation admission/atomic reservations and uniqueness checks.
  const budget = [...rows.values()].find(row => row._table === 'identityBudgets');
  await db.patch(budget._id, { signatures: 100 });
  const limited = await start();
  await assert.rejects(() => actions.completeIdentityProof._handler(ctx, { id: limited.id, garageSignature: signature(limited), signingToken: token(limited) }), /limit/);
  assert.equal((await db.get(limited.id)).state, 'issued');
  assert.equal(broadcasts, 2, 'budget failure never broadcasts');
  await db.patch(budget._id, { signatures: 2 });
  // Same challenge preparation is idempotent, even with different proposed outer bytes.
  const prepared = await mutations.prepareIdentityProof._handler({ db }, { id: limited.id, tx: 'fixed', signedTransaction: 'fixed-bytes', identityHash: links()[0].identityHash });
  const again = await mutations.prepareIdentityProof._handler({ db }, { id: limited.id, tx: 'replacement', signedTransaction: 'replacement-bytes', identityHash: links()[0].identityHash });
  assert.equal(prepared.tx, again.tx); assert.equal((await db.get(budget._id)).signatures, 3);
  now = limited.expiresAt + 1;
  const denied = await mutations.finishIdentityProof._handler({ db }, { id: limited.id, verified: true, message: 'ok' });
  assert.equal(denied.state, 'failed', 'expiry is rechecked at atomic commit');
  assert.equal((await db.query('nearPlayers').withIndex('by_account', q => q.eq('account', account)).first()).publicKey, garage.getPublicKey().toString(), 'verification never changes signing authority');
  now += 2 * 86400_000;
  await mutations.pruneIdentityProofs._handler({ db }, {});
  assert.equal([...rows.values()].filter(row => row._table === 'identityProofs').length, 0);
  assert.equal(links().length, 1, 'durable link survives challenge cleanup');
  assert.equal((await actions.completeIdentityProof._handler(ctx, { id: challenge.id, garageSignature: signature(challenge) })).state, 'failed', 'pruned proof lets the UI start a new check instead of remaining pending');
  console.log('PASS: NEP-413 encoding without callbackUrl; both ownership proofs; token/payload/identity validation; revoked keys; expiry/replay rejection; budget and idempotent reservation; original-transaction recovery; no key replacement; retention.');
} finally {
  Date.now = originalNow; await server.close();
  JsonRpcProvider.prototype.viewAccessKey = original.access; JsonRpcProvider.prototype.callFunction = original.view;
  Account.prototype.createSignedTransaction = original.create; JsonRpcProvider.prototype.viewTransactionStatus = original.status; JsonRpcProvider.prototype.sendTransactionUntil = original.send;
}
