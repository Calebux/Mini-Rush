import {
  concat, createPublicClient, createWalletClient, custom, encodeFunctionData,
  formatUnits, http, type Address, type Hex
} from 'viem';
import { celo } from 'viem/chains';
import { codeFromHostname, toDataSuffix } from '@celo/attribution-tags';

// USDm / cUSD on Celo mainnet — used for balance reads and as the network-fee
// currency (fee abstraction) when the game writes runs on-chain.
const CUSD: Address = '0x765DE816845861e75A25fCA122bb6898B8B1282a';

// MiniRushTracker — signups + race counter. Filled in after deploy; overridable
// via VITE_TRACKER_ADDRESS. Zero address ⇒ on-chain tracking is simply off and
// every write below no-ops (the game stays fully playable without a contract).
const TRACKER: Address =
  ((import.meta.env.VITE_TRACKER_ADDRESS as string | undefined) as Address) ||
  '0x51F572dF0C722DA24cFf02B5FddC949AEe6F293d'; // MiniRushTracker, Celo mainnet

// MiniRushTrackerV2 — badges, per-mode counters, referrals. Deployed alongside
// V1 (which is owner-less and can't be upgraded). Zero ⇒ V2 features simply off;
// V1 remains the source of truth for the core race counter. Set via VITE_TRACKER_V2_ADDRESS.
const TRACKER_V2: Address =
  ((import.meta.env.VITE_TRACKER_V2_ADDRESS as string | undefined) as Address) ||
  '0x0000000000000000000000000000000000000000';

const trackingEnabled = (): boolean =>
  TRACKER !== '0x0000000000000000000000000000000000000000';

const v2Enabled = (): boolean =>
  TRACKER_V2 !== '0x0000000000000000000000000000000000000000';

// Badge catalog — bit positions match MiniRushTrackerV2's bitfield. The contract
// auto-awards these in recordRace(); the UI renders earned ones lit, the rest dim.
export interface BadgeDef {
  bit: number;
  icon: string;
  label: string;
}
export const BADGES: BadgeDef[] = [
  { bit: 0, icon: '🥉', label: '10 races' },
  { bit: 1, icon: '🥈', label: '50 races' },
  { bit: 2, icon: '🥇', label: '100 races' },
  { bit: 3, icon: '⚡', label: '5k score' },
  { bit: 4, icon: '🔥', label: '10k score' },
  { bit: 5, icon: '💎', label: '15k score' }
];

const ERC20_BALANCE_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

const TRACKER_ABI = [
  { name: 'signUp', type: 'function', stateMutability: 'nonpayable', inputs: [], outputs: [{ type: 'bool' }] },
  {
    name: 'recordRace', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'score', type: 'uint32' }, { name: 'place', type: 'uint16' },
      { name: 'mapId', type: 'uint16' }, { name: 'modeId', type: 'uint16' }
    ],
    outputs: []
  },
  {
    name: 'statsOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'player', type: 'address' }],
    outputs: [
      { name: 'registered', type: 'bool' }, { name: 'races', type: 'uint32' },
      { name: 'bestScore', type: 'uint32' }, { name: 'lastPlayed', type: 'uint64' }
    ]
  },
  { name: 'totalPlayers', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { name: 'totalRaces', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }
] as const;

const TRACKER_V2_ABI = [
  {
    name: 'recordRace', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'score', type: 'uint32' }, { name: 'place', type: 'uint16' },
      { name: 'mapId', type: 'uint16' }, { name: 'modeId', type: 'uint16' }
    ],
    outputs: []
  },
  {
    name: 'recordReferral', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'referrer', type: 'address' }], outputs: []
  },
  { name: 'badgesOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ type: 'uint32' }] },
  { name: 'referralsOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'player', type: 'address' }], outputs: [{ type: 'uint32' }] },
  {
    name: 'statsOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'player', type: 'address' }],
    outputs: [
      { name: 'registered', type: 'bool' }, { name: 'races', type: 'uint32' },
      { name: 'bestScore', type: 'uint32' }, { name: 'lastPlayed', type: 'uint64' }
    ]
  },
  {
    name: 'modeRacesOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'player', type: 'address' }, { name: 'modeId', type: 'uint16' }],
    outputs: [{ type: 'uint32' }]
  }
] as const;

export interface RaceRecord {
  score: number;
  place: number;
  mapId: number;
  modeId: number;
}

export interface PlayerStats {
  registered: boolean;
  races: number;
  bestScore: number;
}

// ERC-8021 attribution suffix, derived once from the hostname (no registration).
// Appended to every tracker write so runs are attributable to MiniRush on Celo.
let attributionTag: Hex | null = null;
function suffix(): Hex {
  if (attributionTag) return attributionTag;
  attributionTag = toDataSuffix(codeFromHostname(window.location.hostname)) as Hex;
  return attributionTag;
}

interface EthereumProvider {
  isMiniPay?: boolean;
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function getProvider(): EthereumProvider | null {
  return (window as unknown as { ethereum?: EthereumProvider }).ethereum ?? null;
}

export class Wallet {
  address: Address | null = null;

  get available(): boolean {
    return getProvider() !== null;
  }

  get isMiniPay(): boolean {
    return getProvider()?.isMiniPay === true;
  }

  async connect(): Promise<Address> {
    const provider = getProvider();
    if (!provider) throw new Error('No wallet found. Open this game inside MiniPay.');
    const client = createWalletClient({ chain: celo, transport: custom(provider) });
    const [address] = await client.requestAddresses();
    this.address = address;
    return address;
  }

  /** Native CELO balance, formatted to 2 decimals. */
  async celoBalance(): Promise<string> {
    if (!this.address) throw new Error('Not connected');
    const raw = await this.reader().getBalance({ address: this.address });
    return Number(formatUnits(raw, 18)).toFixed(2);
  }

  /** cUSD balance, formatted to 2 decimals. */
  async cusdBalance(): Promise<string> {
    if (!this.address) throw new Error('Not connected');
    const provider = getProvider();
    const client = createPublicClient({
      chain: celo,
      transport: provider ? custom(provider) : http()
    });
    const raw = await client.readContract({
      address: CUSD,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [this.address]
    });
    return Number(formatUnits(raw, 18)).toFixed(2);
  }

  shortAddress(): string {
    if (!this.address) return '';
    return `${this.address.slice(0, 6)}…${this.address.slice(-4)}`;
  }

  // ---------- on-chain tracking (MiniRushTracker) ----------
  // Signups + races are counted on Celo. MiniPay sends legacy transactions and
  // pays the network fee in stablecoins, so every write is one small call with
  // feeCurrency = USDm and an ERC-8021 attribution suffix. All of it fails soft:
  // a missing contract, a plain browser, or a rejected tx never breaks the game.

  get trackingOn(): boolean {
    return trackingEnabled();
  }

  /** Register the wallet on-chain. Idempotent contract-side; safe on every connect. */
  async signUp(): Promise<Hex | null> {
    return this.write(encodeFunctionData({ abi: TRACKER_ABI, functionName: 'signUp' }));
  }

  /**
   * Record a finished race on-chain. Auto-signs-up on the player's first race.
   * When V2 is configured the game cuts over to it (V2 reads V1 as a baseline,
   * so race counts and badges stay continuous); otherwise it writes V1.
   */
  async recordRace(run: RaceRecord): Promise<Hex | null> {
    const clamp = (n: number, max: number) => Math.max(0, Math.min(max, Math.round(n)));
    const args = [
      clamp(run.score, 0xffffffff), clamp(run.place, 0xffff),
      clamp(run.mapId, 0xffff), clamp(run.modeId, 0xffff)
    ] as const;
    if (v2Enabled()) {
      return this.write(
        encodeFunctionData({ abi: TRACKER_V2_ABI, functionName: 'recordRace', args }),
        TRACKER_V2
      );
    }
    return this.write(
      encodeFunctionData({ abi: TRACKER_ABI, functionName: 'recordRace', args })
    );
  }

  /** Credit a referrer on-chain once (V2 only). Fails soft everywhere else. */
  async recordReferral(referrer: string): Promise<Hex | null> {
    if (!v2Enabled()) return null;
    if (!/^0x[0-9a-fA-F]{40}$/.test(referrer)) return null;
    if (this.address && referrer.toLowerCase() === this.address.toLowerCase()) return null; // no self-referral
    return this.write(
      encodeFunctionData({
        abi: TRACKER_V2_ABI, functionName: 'recordReferral', args: [referrer as Address]
      }),
      TRACKER_V2
    );
  }

  /** Earned-badge bitfield from V2, or null when V2 isn't configured/available. */
  async badges(): Promise<number | null> {
    if (!v2Enabled() || !this.address) return null;
    try {
      const bits = await this.reader().readContract({
        address: TRACKER_V2, abi: TRACKER_V2_ABI, functionName: 'badgesOf', args: [this.address]
      });
      return Number(bits);
    } catch {
      return null;
    }
  }

  /**
   * This wallet's on-chain stats, or null if unavailable. Reads V2 when it's
   * configured (its statsOf folds in the V1 baseline for a continuous number),
   * otherwise V1.
   */
  async stats(): Promise<PlayerStats | null> {
    if (!trackingEnabled() || !this.address) return null;
    try {
      const client = this.reader();
      const [registered, races, bestScore] = v2Enabled()
        ? await client.readContract({
            address: TRACKER_V2, abi: TRACKER_V2_ABI, functionName: 'statsOf', args: [this.address]
          })
        : await client.readContract({
            address: TRACKER, abi: TRACKER_ABI, functionName: 'statsOf', args: [this.address]
          });
      return { registered, races: Number(races), bestScore: Number(bestScore) };
    } catch {
      return null;
    }
  }

  /** Global totals across all players. Readable without a connected wallet. */
  async totals(): Promise<{ players: number; races: number } | null> {
    if (!trackingEnabled()) return null;
    try {
      const client = this.reader();
      const [players, races] = await Promise.all([
        client.readContract({ address: TRACKER, abi: TRACKER_ABI, functionName: 'totalPlayers' }),
        client.readContract({ address: TRACKER, abi: TRACKER_ABI, functionName: 'totalRaces' })
      ]);
      return { players: Number(players), races: Number(races) };
    } catch {
      return null;
    }
  }

  /** Send a tracker write: append the attribution suffix, pay fees in USDm. */
  private async write(callData: Hex, to: Address = TRACKER): Promise<Hex | null> {
    const provider = getProvider();
    if (to === '0x0000000000000000000000000000000000000000' || !this.address || !provider) return null;
    try {
      const client = createWalletClient({ chain: celo, transport: custom(provider) });
      return await client.sendTransaction({
        account: this.address,
        to,
        data: concat([callData, suffix()]),
        feeCurrency: CUSD
      });
    } catch {
      return null; // rejected, unfunded, or non-MiniPay wallet — game continues
    }
  }

  private reader() {
    const provider = getProvider();
    return createPublicClient({ chain: celo, transport: provider ? custom(provider) : http() });
  }
}
