/**
 * Anonymous player counter behind the /stats page. Each device gets a random
 * id in localStorage, and the game tells Convex (convex/usage.ts) when it
 * opens, finishes a race, connects a wallet or sends something on-chain. No
 * names, wallet addresses or Nimiq device ids leave the device, and it all
 * fails silently: gameplay never waits on it.
 */
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.replace(/\/$/, '');

const ID_KEY = 'minirush.player';
const PLAYER_ID = /^[a-f0-9]{24}$/;

export type UsageEvent = 'open' | 'race' | 'wallet' | 'receipt' | 'bounty' | 'purchase';
type Platform = 'nimiq' | 'web';

let platform: Promise<Platform> | null = null;

function playerId(): string | null {
  try {
    const saved = localStorage.getItem(ID_KEY);
    if (saved && PLAYER_ID.test(saved)) return saved;
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(ID_KEY, id);
    return id;
  } catch {
    return null; // no storage: a fresh id every visit would count one player many times
  }
}

/** Nimiq Pay injects its globals around page load; wait briefly before calling it the web. */
function detectPlatform(): Promise<Platform> {
  platform ??= new Promise((resolve) => {
    const started = Date.now();
    const check = (): void => {
      if ('nimiq' in window || 'nimiqPay' in window) resolve('nimiq');
      else if (Date.now() - started > 5000) resolve('web');
      else setTimeout(check, 100);
    };
    check();
  });
  return platform;
}

export function track(event: UsageEvent): void {
  // headless runs (race sims, screenshot scripts) aren't players
  if (!CONVEX_URL || navigator.webdriver) return;
  const pid = playerId();
  if (!pid) return;
  void detectPlatform()
    .then((where) => fetch(`${CONVEX_URL}/api/mutation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'usage:ping', args: { pid, platform: where, event }, format: 'json' })
    }))
    .catch(() => { /* offline or blocked: this event just isn't counted */ });
}
