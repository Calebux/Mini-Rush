import {
  getHostLanguage, init, requestDeviceIdentifier,
  type ErrorResponse, type NimiqProvider
} from '@nimiq/mini-app-sdk';

/**
 * Nimiq Pay Mini App wallet.
 *
 * Nimiq Pay injects a provider into the Mini App's WebView and mediates every
 * sensitive action behind a native confirmation dialog the app can't bypass.
 * That rules out the silent per-race contract writes the Celo build did: there
 * are no general smart contracts on Nimiq, and a signature prompt after every
 * race would be unusable. So the split here is:
 *
 *   on-chain, user-approved — buying a garage car with NIM, and (opt-in, one
 *     tap from the results screen) minting a race receipt into a transaction's
 *     data field, which is what makes a run independently verifiable
 *   off-chain — scores, badges and the daily board, which stay in the existing
 *     Supabase leaderboard keyed by the Nimiq address or the per-device id
 *
 * Everything fails soft. Outside Nimiq Pay there's no provider, every method
 * below returns null, and the game is fully playable.
 */

// 1 NIM = 1e5 Luna.
const LUNA = 1e5;

// Nimiq user-friendly address: NQ + 2 check digits + 8 blocks of 4 base32
// chars, conventionally space-separated. Accepted with or without the spaces.
const NQ_ADDRESS = /^NQ\d{2}(?: ?[0-9A-HJ-NP-VXY]{4}){8}$/i;

const isAddress = (a: string | undefined | null): a is string =>
  typeof a === 'string' && NQ_ADDRESS.test(a.trim());

/** Receiver for garage purchases. Unset ⇒ the market is simply off. */
const MARKET_RECEIVER = (import.meta.env.VITE_MARKET_RECEIVER as string | undefined)?.trim();

/** Garage car price in NIM. Overridable so testnet demos can run cheap. */
const MARKET_PRICE_NIM = Number(import.meta.env.VITE_MARKET_PRICE_NIM ?? 5);

/**
 * Where race receipts are sent. Defaults to the market receiver; a receipt is
 * a dust-value transaction whose data field carries the run, so the recipient
 * only ever acts as an anchor.
 */
const RECEIPT_RECEIVER =
  (import.meta.env.VITE_RECEIPT_RECEIVER as string | undefined)?.trim() ?? MARKET_RECEIVER;

/** Receipt transaction value in Luna — dust; the payload is the data field. */
const RECEIPT_VALUE = 1;

/**
 * Optional Albatross JSON-RPC endpoint. The injected provider exposes accounts,
 * signing and sending but no balance read, so the balance display stays dark
 * unless an endpoint is configured.
 */
const RPC_URL = (import.meta.env.VITE_NIMIQ_RPC_URL as string | undefined)?.trim();

// Badges are earned from the player's own race history rather than a contract.
// `bit` is kept as the stable identifier so saved badge state stays comparable.
export interface BadgeDef {
  bit: number;
  icon: string;
  label: string;
  /** Earned test, run against local career stats. */
  earned: (s: BadgeInput) => boolean;
}

export interface BadgeInput {
  races: number;
  bestScore: number;
}

export const BADGES: BadgeDef[] = [
  { bit: 0, icon: '🥉', label: '10 races', earned: (s) => s.races >= 10 },
  { bit: 1, icon: '🥈', label: '50 races', earned: (s) => s.races >= 50 },
  { bit: 2, icon: '🥇', label: '100 races', earned: (s) => s.races >= 100 },
  { bit: 3, icon: '⚡', label: '5k score', earned: (s) => s.bestScore >= 5000 },
  { bit: 4, icon: '🔥', label: '10k score', earned: (s) => s.bestScore >= 10000 },
  { bit: 5, icon: '💎', label: '15k score', earned: (s) => s.bestScore >= 15000 }
];

/** Bitfield of earned badges — same bit layout the Celo contract used. */
export function earnedBadges(s: BadgeInput): number {
  return BADGES.reduce((bits, b) => (b.earned(s) ? bits | (1 << b.bit) : bits), 0);
}

export interface RaceRecord {
  score: number;
  place: number;
  mapId: number;
  modeId: number;
}

export interface ChainInfo {
  consensus: boolean;
  blockNumber: number;
}

const isError = (v: unknown): v is ErrorResponse =>
  typeof v === 'object' && v !== null && 'error' in v;

/**
 * Pack a run into a receipt payload. `MR1` marks the format, then score,
 * place, map and mode as fixed-width hex — 19 bytes, well inside the 64-byte
 * data field a Nimiq extended transaction carries.
 */
export function encodeReceipt(run: RaceRecord): string {
  const u = (n: number, max: number, width: number) =>
    Math.max(0, Math.min(max, Math.round(Number.isFinite(n) ? n : 0)))
      .toString(16).padStart(width, '0');
  return `MR1${u(run.score, 0xffffffff, 8)}${u(run.place, 0xffff, 4)}` +
    `${u(run.mapId, 0xff, 2)}${u(run.modeId, 0xff, 2)}`;
}

// Receipts minted from this device. Nimiq has no contract to query for a
// player's history, so the count is kept locally and each tx id is retained
// so a run can be pointed at on a block explorer.
const RECEIPTS_KEY = 'minirush.receipts';

export function mintedReceipts(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? '[]') as string[];
    return Array.isArray(raw) ? raw.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

function noteReceipt(tx: string): void {
  const all = [...mintedReceipts(), tx].slice(-50);
  try {
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify(all));
  } catch { /* private mode — the receipt is still on-chain */ }
}

export class Wallet {
  address: string | null = null;

  private provider: NimiqProvider | null = null;
  private deviceIdCache: string | null = null;

  /** True inside Nimiq Pay, where the host injects the provider. */
  get available(): boolean {
    return typeof window !== 'undefined' && !!window.nimiq;
  }

  /** Kept as a distinct name from `available` for the UI's copy. */
  get isNimiqPay(): boolean {
    return this.available;
  }

  /** The garage market only lights up with a valid receiver configured. */
  get marketReady(): boolean {
    return isAddress(MARKET_RECEIVER) && MARKET_PRICE_NIM > 0;
  }

  /** Receipt minting needs a valid anchor address. */
  get receiptsReady(): boolean {
    return isAddress(RECEIPT_RECEIVER);
  }

  /** Price label for the market button, e.g. "5 NIM". */
  get marketPriceLabel(): string {
    return `${MARKET_PRICE_NIM} NIM`;
  }

  /** ISO 639-1 code the player chose in Nimiq Pay, if we're running inside it. */
  get language(): string | undefined {
    return getHostLanguage();
  }

  /**
   * Wait for the injected provider and read the player's account. Nimiq Pay
   * surfaces its own approval UI; a dismissed dialog throws and the caller
   * leaves the chip in its "connect" state.
   */
  async connect(timeout = 8000): Promise<string> {
    const nimiq = await init({ timeout });
    this.provider = nimiq;
    if (RPC_URL) nimiq.setRPCUrl(RPC_URL);
    const accounts = await nimiq.listAccounts();
    if (isError(accounts) || !Array.isArray(accounts) || !accounts[0]) {
      throw new Error('No Nimiq account available.');
    }
    this.address = accounts[0];
    return this.address;
  }

  shortAddress(): string {
    if (!this.address) return '';
    const compact = this.address.replace(/\s+/g, '');
    return `${compact.slice(0, 8)}…${compact.slice(-4)}`;
  }

  /**
   * NIM balance, formatted to 2 decimals, or null when no RPC endpoint is
   * configured. The Mini App provider has no balance method of its own, so
   * this is strictly optional chrome — never gate gameplay on it.
   */
  async balance(): Promise<string | null> {
    if (!RPC_URL || !this.address || !this.provider) return null;
    try {
      const res = await this.provider.request<{ data?: { balance?: number } } | null>({
        method: 'getAccountByAddress',
        params: [this.address]
      });
      const luna = res?.data?.balance;
      if (typeof luna !== 'number') return null;
      return (luna / LUNA).toFixed(2);
    } catch {
      return null;
    }
  }

  /** Consensus + head height, for the profile card. Null when unavailable. */
  async chainInfo(): Promise<ChainInfo | null> {
    if (!this.provider) return null;
    try {
      const [consensus, blockNumber] = await Promise.all([
        this.provider.isConsensusEstablished(),
        this.provider.getBlockNumber()
      ]);
      return { consensus, blockNumber };
    } catch {
      return null;
    }
  }

  /**
   * Buy the selected garage car for NIM. Resolves with the serialized
   * transaction on success, or null when the market is off or the player
   * declined the native confirmation.
   */
  async buyMarketCar(): Promise<string | null> {
    if (!this.marketReady) return null;
    if (!this.address) await this.connect();
    if (!this.provider) return null;
    try {
      const tx = await this.provider.sendBasicTransaction({
        recipient: MARKET_RECEIVER!,
        value: Math.round(MARKET_PRICE_NIM * LUNA)
      });
      return isError(tx) ? null : tx;
    } catch {
      return null; // declined, unfunded, or no provider — the game continues
    }
  }

  /**
   * Opt-in: write a finished run into a transaction's data field so it can be
   * verified independently of this game's own leaderboard. One native
   * confirmation per receipt, which is why it's never called automatically.
   */
  async mintRaceReceipt(run: RaceRecord): Promise<string | null> {
    if (!this.receiptsReady) return null;
    if (!this.address) await this.connect();
    if (!this.provider) return null;
    try {
      const tx = await this.provider.sendBasicTransactionWithData({
        recipient: RECEIPT_RECEIVER!,
        value: RECEIPT_VALUE,
        data: encodeReceipt(run)
      });
      if (isError(tx)) return null;
      noteReceipt(tx);
      return tx;
    } catch {
      return null;
    }
  }

  /**
   * Prove control of the connected address by signing a challenge. Used to
   * claim a leaderboard row for a wallet rather than a device.
   */
  async proveAddress(challenge: string): Promise<{ publicKey: string; signature: string } | null> {
    if (!this.provider || !this.address) return null;
    try {
      const res = await this.provider.sign(challenge);
      return isError(res) ? null : res;
    } catch {
      return null;
    }
  }

  /**
   * Pseudonymous per-origin device id from Nimiq Pay — stable across
   * reinstalls, uncorrelatable across Mini Apps. Prompts once, then resolves
   * silently. Null outside Nimiq Pay or when the player declines, in which
   * case the board falls back to its own local id.
   */
  async deviceId(): Promise<string | null> {
    if (this.deviceIdCache) return this.deviceIdCache;
    if (!this.available) return null;
    try {
      this.deviceIdCache = await requestDeviceIdentifier({
        reason: 'Rank your runs on the MiniRush daily leaderboard'
      });
      return this.deviceIdCache;
    } catch {
      return null;
    }
  }
}
