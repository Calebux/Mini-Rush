// Driver identity: the name on the boards, in the race classification and on
// bounty entries. Everyone gets a generated driver name on first launch; a
// player who signs in with Nimiq Pay picks their own username. Local, like the
// rest of the profile — there is no account server to reserve names on.
import { RIVAL_NAMES } from './rivals';

const KEY = 'minirush.driver';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;

interface Stored {
  name: string;
  chosen: boolean; // picked by the player rather than generated
}

// ≤ 6 letters each, so "ADJ NOUN 42" never runs past USERNAME_MAX
const ADJ = ['TURBO', 'NEON', 'NITRO', 'RAPID', 'SILENT', 'LUCKY', 'IRON', 'STORM',
  'COBALT', 'SOLAR', 'GHOST', 'ROGUE', 'VELVET', 'ATOMIC', 'WILD', 'CHROME'];
const NOUN = ['FOX', 'HAWK', 'COMET', 'LYNX', 'RAVEN', 'TIGER', 'BOLT', 'COBRA',
  'FALCON', 'SHARK', 'WOLF', 'JET', 'ORCA', 'MANTA', 'PUMA', 'ONYX'];

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

function generate(): string {
  return `${pick(ADJ)} ${pick(NOUN)} ${10 + Math.floor(Math.random() * 90)}`;
}

function load(): Stored | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null;
    if (!raw || typeof raw.name !== 'string') return null;
    const name = clean(raw.name);
    return name.length >= USERNAME_MIN ? { name, chosen: raw.chosen === true } : null;
  } catch {
    return null;
  }
}

function save(s: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch { /* private mode — the name lives for this session only */ }
}

/** Uppercase letters, digits, single spaces, `-` and `_`; trimmed to the max length. */
function clean(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9 _-]/g, '').replace(/\s+/g, ' ')
    .trim().slice(0, USERNAME_MAX).trim();
}

let session: Stored | null = null;

function current(): Stored {
  session ??= load();
  if (!session) {
    session = { name: generate(), chosen: false };
    save(session);
  }
  return session;
}

/** The name this player races under. */
export function driverName(): string {
  return current().name;
}

/** True once the player has picked a username (after a Nimiq sign-in). */
export function hasUsername(): boolean {
  return current().chosen;
}

/** Normalize a typed username, or say why it can't be used. */
export function checkUsername(raw: string): { name: string } | { error: string } {
  const name = clean(raw);
  if (name.length < USERNAME_MIN) {
    return { error: `Use ${USERNAME_MIN}–${USERNAME_MAX} letters or numbers.` };
  }
  // the classification lists the AI field by name; "YOU" and a rival's name
  // would make it unreadable
  if (name === 'YOU' || RIVAL_NAMES.includes(name)) {
    return { error: `${name} is taken by a rival driver.` };
  }
  return { name };
}

/** Save a picked username. Returns an error message, or null on success. */
export function setUsername(raw: string): string | null {
  const res = checkUsername(raw);
  if ('error' in res) return res.error;
  session = { name: res.name, chosen: true };
  save(session);
  return null;
}

/** Keep the generated name but stop asking: the player chose it by declining. */
export function keepDriverName(): void {
  session = { name: current().name, chosen: true };
  save(session);
}
