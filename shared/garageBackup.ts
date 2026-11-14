/** Portable v1 recovery file. No network calls, storage or logging of secrets. */
export const BACKUP_LIMIT = 16_384;
export const BACKUP_ITERATIONS = 600_000;
const encoder = new TextEncoder();
export interface GarageBackup {
  account: string;
  secretKey: string;
  publicKey: string;
  network: 'testnet';
  garage: string;
  createdAt: string;
}
export class BackupError extends Error {}
const invalid = () => new BackupError('This is not a supported MiniRush testnet recovery file.');
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const accountId = (v: unknown): v is string => typeof v === 'string' && v.length >= 2 && v.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(v);
const base64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
function decode(value: unknown, length?: number): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw invalid();
  const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
  if ((length !== undefined && bytes.length !== length) || base64(bytes) !== value) throw invalid();
  return bytes;
}
function validate(value: unknown, garage: string): GarageBackup {
  if (!record(value) || !keys(value, ['account','secretKey','publicKey','network','garage','createdAt']) ||
      value.network !== 'testnet' || value.garage !== garage || !accountId(garage) || !accountId(value.account) ||
      typeof value.secretKey !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(value.secretKey) ||
      typeof value.publicKey !== 'string' || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(value.publicKey) ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || value.createdAt.length > 30) throw invalid();
  return value as unknown as GarageBackup;
}
function webCrypto() {
  if (!globalThis.crypto?.subtle) throw new BackupError('Open MiniRush over HTTPS to protect or restore your garage.');
  return globalThis.crypto;
}
function checkPassword(password: string, creating = false) {
  if (typeof password !== 'string' || password.length > 256 || password.length < (creating ? 12 : 1)) {
    throw new BackupError(creating ? 'Use a unique password of 12–256 characters. A long passphrase is best.' : 'Enter the password for this recovery file.');
  }
}
function header(garage: string) {
  return { format: 'minirush-garage-backup', version: 1, network: 'testnet', garage,
    kdf: 'PBKDF2-SHA-256', iterations: BACKUP_ITERATIONS, cipher: 'AES-256-GCM' };
}
async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const bytes = encoder.encode(password);
  try {
    const material = await webCrypto().subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveKey']);
    return await webCrypto().subtle.deriveKey({ name:'PBKDF2', hash:'SHA-256', salt, iterations:BACKUP_ITERATIONS },
      material, { name:'AES-GCM', length:256 }, false, ['encrypt','decrypt']);
  } finally { bytes.fill(0); }
}
export async function encryptGarageBackup(payload: GarageBackup, password: string): Promise<string> {
  checkPassword(password, true);
  validate(payload, payload.garage);
  const salt = webCrypto().getRandomValues(new Uint8Array(16));
  const iv = webCrypto().getRandomValues(new Uint8Array(12));
  const meta = header(payload.garage);
  const plain = encoder.encode(JSON.stringify(payload));
  try {
    const key = await passwordKey(password, salt);
    const ciphertext = await webCrypto().subtle.encrypt({ name:'AES-GCM', iv, tagLength:128, additionalData:encoder.encode(JSON.stringify(meta)) }, key, plain);
    return JSON.stringify({ ...meta, salt:base64(salt), iv:base64(iv), ciphertext:base64(new Uint8Array(ciphertext)) }, null, 2);
  } finally { plain.fill(0); }
}
export async function decryptGarageBackup(file: string, password: string, garage: string): Promise<GarageBackup> {
  checkPassword(password);
  if (typeof file !== 'string' || file.length > BACKUP_LIMIT || !accountId(garage)) throw invalid();
  let envelope: unknown;
  try { envelope = JSON.parse(file); } catch { throw invalid(); }
  const meta = header(garage);
  if (!record(envelope) || !keys(envelope, [...Object.keys(meta), 'salt','iv','ciphertext']) ||
      Object.entries(meta).some(([k,v]) => envelope[k] !== v)) throw invalid();
  // Exact versioned algorithms/work factors, bounded input: a file cannot choose
  // an endpoint, downgrade encryption or ask the browser for unbounded KDF work.
  const salt = decode(envelope.salt, 16), iv = decode(envelope.iv, 12), ciphertext = decode(envelope.ciphertext);
  if (ciphertext.length < 32 || ciphertext.length > 4096) throw invalid();
  let plain: ArrayBuffer;
  const key = await passwordKey(password, salt);
  try {
    plain = await webCrypto().subtle.decrypt({ name:'AES-GCM', iv, tagLength:128, additionalData:encoder.encode(JSON.stringify(meta)) }, key, ciphertext);
  } catch { throw new BackupError('The password is incorrect or the recovery file was changed. Your current garage is untouched.'); }
  try {
    return validate(JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(plain)), garage);
  } catch { throw invalid(); }
  finally { new Uint8Array(plain).fill(0); }
}
