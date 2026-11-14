// Real Web Crypto, throwaway keys and in-memory storage. No network or real wallets.
import assert from 'node:assert/strict';
import { KeyPair } from 'near-api-js';
import { encryptGarageBackup, decryptGarageBackup, BACKUP_LIMIT } from '../shared/garageBackup.ts';
import { commitCredentials, readCredentials, credentialSnapshot, CREDENTIALS_KEY, LEGACY_KEY, LEGACY_ACCOUNT } from '../shared/garageCredentials.ts';
const key = KeyPair.fromRandom('ed25519'), password = 'a long demo-only passphrase 42!';
const payload = { account:'backup-fixture.minirush-garage.testnet', publicKey:key.getPublicKey().toString(), secretKey:key.toString(),
  network:'testnet', garage:'minirush-garage.testnet', createdAt:new Date().toISOString() };
const first = await encryptGarageBackup(payload, password), second = await encryptGarageBackup(payload, password);
assert.notEqual(first, second, 'new salt/IV each export');
assert.ok(!first.includes(key.toString()) && !first.includes(payload.account), 'secret and identity are encrypted');
assert.deepEqual(await decryptGarageBackup(first,password,payload.garage), payload);
await assert.rejects(encryptGarageBackup(payload,'short'),/12–256/);
await assert.rejects(decryptGarageBackup(first,'wrong password',payload.garage),/password is incorrect/);
await assert.rejects(decryptGarageBackup(first,password,'another-game.testnet'),/supported/);
for (const field of ['salt','iv','ciphertext']) {
  const corrupt = JSON.parse(first), bytes = Buffer.from(corrupt[field],'base64'); bytes[0] ^= 1; corrupt[field] = bytes.toString('base64');
  await assert.rejects(decryptGarageBackup(JSON.stringify(corrupt),password,payload.garage),/password is incorrect/);
}
for (const patch of [{version:2},{network:'mainnet'},{iterations:1},{iterations:2**40},{cipher:'AES-CBC'},{rpc:'https://example.com'}, {salt:'bad'}, {iv:''}]) {
  await assert.rejects(decryptGarageBackup(JSON.stringify({...JSON.parse(first),...patch}),password,payload.garage),/supported/);
}
for (const malformed of ['null','[]','{', ' '.repeat(BACKUP_LIMIT+1)]) await assert.rejects(decryptGarageBackup(malformed,password,payload.garage),/supported/);
for (const invalid of [{account:'attacker.near'},{account:'<script>.testnet'},{publicKey:'bad'},{secretKey:'invalid'}, {createdAt:'bad'}, {network:'mainnet'}]) {
  await assert.rejects(encryptGarageBackup({...payload,...invalid},password),/supported/);
}
let data = new Map([[LEGACY_ACCOUNT,'old.testnet'],[LEGACY_KEY,'old-fixture-key']]);
let rejectCommit = false, rejectCleanup = false;
const storage = { getItem:k=>data.get(k)??null, setItem:(k,v)=>{if(rejectCommit)throw new Error('quota'); data.set(k,v);}, removeItem:k=>{if(rejectCleanup)throw new Error('cleanup');data.delete(k);} };
const before = credentialSnapshot(storage), restored = { account:payload.account, secretKey:payload.secretKey };
rejectCommit = true;
assert.throws(()=>commitCredentials(storage,before,restored),/quota/);
assert.equal(credentialSnapshot(storage),before,'failed write preserves old garage');
rejectCommit = false;
data.set(LEGACY_ACCOUNT,'changed.testnet');
assert.throws(()=>commitCredentials(storage,before,restored),/changed/);
rejectCleanup = true;
commitCredentials(storage,credentialSnapshot(storage),restored);
assert.deepEqual(readCredentials(storage),restored,'committed record wins even if legacy cleanup fails');
data.set(CREDENTIALS_KEY,'corrupt');
assert.throws(()=>readCredentials(storage),/damaged/,'do not silently fall back to an older account');
rejectCleanup = false;
commitCredentials(storage,credentialSnapshot(storage),restored);
assert.deepEqual(readCredentials(storage),restored);
assert.equal(data.has(LEGACY_KEY),false);
console.log('PASS: real encryption, random salt/IV, wrong password, tamper rejection, context/algorithm/input bounds, atomic restore, storage failure and stale-account rejection.');
