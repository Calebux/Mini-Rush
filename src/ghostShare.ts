// Packing a ghost small enough to travel. A Weekend GP run is eight laps of a
// 3.2 km circuit — around 6,000 samples at the recorder's 10 Hz, which is far
// too much JSON to put in a leaderboard row. So a shared ghost is resampled to
// 5 Hz, quantised (a quarter metre along the track, five centimetres across
// it), delta-coded and base64'd, which brings a run to a few kilobytes.
//
// Anything decoded here came from a table anyone can write to, so it is
// checked like any other untrusted input: bad text yields null, never a throw.
import type { GhostData } from './ghost';

const SHARE_HZ = 5;
const S_STEP = 0.25, X_STEP = 0.05;
const MAX_BYTES = 24000;   // refuse to upload more than this
const MAX_SAMPLES = 6000;  // and refuse to decode more than this

/** Zig-zag so small negative deltas stay one byte. */
const zig = (n: number): number => (n << 1) ^ (n >> 31);
const zag = (n: number): number => (n >>> 1) ^ -(n & 1);

function toBase64(bytes: number[]): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): number[] | null {
  try {
    const raw = atob(text);
    const out: number[] = new Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** A run as a short string, or '' when it is too long or too broken to share. */
export function encodeGhost(g: GhostData): string {
  const n = g.pts.length / 2;
  if (!Number.isFinite(g.hz) || g.hz <= 0 || n < 2) return '';
  const step = g.hz / SHARE_HZ; // samples of the recording per shared sample
  const bytes: number[] = [];
  const push = (value: number): void => {
    let v = zig(Math.round(value));
    do {
      const byte = v & 0x7f;
      v >>>= 7;
      bytes.push(v > 0 ? byte | 0x80 : byte);
    } while (v > 0);
  };
  let lastS = 0, lastX = 0, count = 0;
  for (let i = 0; i < n; i += step) {
    const k = Math.round(i) * 2;
    const s = Math.round(g.pts[k] / S_STEP), x = Math.round(g.pts[k + 1] / X_STEP);
    if (!Number.isFinite(s) || !Number.isFinite(x)) return '';
    push(s - lastS); push(x - lastX);
    lastS = s; lastX = x; count++;
    if (bytes.length > MAX_BYTES) return '';
  }
  if (count < 2) return '';
  return `g1.${g.car}.${Math.round(g.time * 100)}.${Math.round(g.score)}.${toBase64(bytes)}`;
}

/** Unpack a shared ghost. Null for anything malformed, oversized or absurd. */
export function decodeGhost(text: string | null | undefined): GhostData | null {
  if (typeof text !== 'string' || !text.startsWith('g1.')) return null;
  const parts = text.split('.');
  if (parts.length !== 5) return null;
  const car = Number(parts[1]), time = Number(parts[2]) / 100, score = Number(parts[3]);
  if (!Number.isInteger(car) || car < 0 || car > 999) return null;
  if (!Number.isFinite(time) || time <= 0 || time > 3600) return null;
  const bytes = fromBase64(parts[4]);
  if (!bytes || bytes.length < 2) return null;
  const pts: number[] = [];
  let i = 0, s = 0, x = 0;
  const read = (): number | null => {
    let shift = 0, value = 0;
    while (i < bytes.length) {
      const byte = bytes[i++];
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return zag(value);
      shift += 7;
      if (shift > 28) return null;
    }
    return null;
  };
  while (i < bytes.length) {
    const ds = read(), dx = read();
    if (ds === null || dx === null) return null;
    s += ds; x += dx;
    pts.push(s * S_STEP, x * X_STEP);
    if (pts.length > MAX_SAMPLES * 2) return null;
  }
  if (pts.length < 4 || !pts.every(Number.isFinite)) return null;
  return { car, time, score: Number.isFinite(score) ? score : 0, hz: SHARE_HZ, pts };
}
