/**
 * "Beat my time" links. Finishing a race can publish it as a challenge
 * (convex/challenges.ts): the circuit it was set on plus the packed lap line.
 * The link is an ordinary game URL with `?c=<code>`, so opening it in Nimiq Pay
 * or any browser drops the challenger on that exact track with the setter's car
 * running as a ghost beside them.
 *
 * Like every other network call in the game this one fails quietly: a dead or
 * expired link just starts an ordinary race.
 */
import { convexCall } from './convexBoard';

export interface Challenge {
  code: string;
  tag: string;
  mapId: string;
  modeId: string;
  seed: number;
  laps: number;
  len: number;
  timeS: number;
  score: number;
  car: string;
  ghost: string;
}

/** Eight characters of a-z0-9 — short enough to read out, wide enough not to clash. */
function newCode(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** The code in the current URL, if this is a challenge link. */
export function challengeCode(): string | null {
  const code = new URLSearchParams(location.search).get('c');
  return code && /^[a-z0-9]{8}$/.test(code) ? code : null;
}

/** The link to send someone, keeping any referral code already in the URL. */
export function challengeLink(code: string): string {
  const url = new URL(location.href);
  url.search = '';
  const ref = new URLSearchParams(location.search).get('ref');
  url.searchParams.set('c', code);
  if (ref) url.searchParams.set('ref', ref);
  return url.toString();
}

/** Fetch a challenge. Null when the link is dead, expired or malformed. */
export async function loadChallenge(code: string): Promise<Challenge | null> {
  const value = await convexCall('query', 'challenges:get', { code });
  if (!value || typeof value !== 'object') return null;
  const c = value as Omit<Challenge, 'code'>;
  if (typeof c.ghost !== 'string' || !Number.isFinite(c.timeS)) return null;
  return { ...c, code };
}

/** Publish a run to challenge with; returns the link, or null if it couldn't. */
export async function createChallenge(
  run: Omit<Challenge, 'code'>
): Promise<string | null> {
  if (!run.ghost) return null;
  for (let attempt = 0; attempt < 3; attempt++) { // a clash just means roll again
    const code = newCode();
    const answer = await convexCall('mutation', 'challenges:create', { code, ...run });
    if (answer === code) return challengeLink(code);
  }
  return null;
}
