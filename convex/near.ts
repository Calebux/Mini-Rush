'use node';
// The NEAR side of MiniRush (testnet). Everything that needs a key runs here:
//   createPlayer — makes the player's account from a key the phone generated
//   payRace      — mints the race's coins as RUSH, signed-request + capped
//   relay        — submits a player's signed meta-transaction, game pays gas
//   dealerTick   — the three dealer agents reprice their stalls (cron)
//
// Keys come from Convex env: NEAR_GAME_KEY (owner of the garage contract) and
// NEAR_DEALER_KEYS (JSON {account: key}). The dealers think with an
// OpenAI-compatible model when DEALER_LLM_URL / DEALER_LLM_KEY / DEALER_LLM_MODEL
// are set (NEAR AI Cloud, OpenRouter, …) and with plain rules otherwise; every
// decision records which one made it.
import { createHash } from 'node:crypto';
import * as borsh from 'borsh';
import { Account, actions, PublicKey, SCHEMA, type KeyPairString } from 'near-api-js';
import { v } from 'convex/values';
import { action, internalAction } from './_generated/server';
import { internal } from './_generated/api';

const GARAGE = process.env.NEAR_GARAGE ?? 'minirush-garage.testnet';
const RPC = process.env.NEAR_RPC ?? 'https://test.rpc.fastnear.com';
const TGAS = 1_000_000_000_000n;
const WELCOME_RUSH = 300;
const PLAYER_NEAR = 10_000_000_000_000_000_000_000n; // 0.01 NEAR: account storage only — the game pays gas

function gameAccount(): Account {
  const key = process.env.NEAR_GAME_KEY;
  if (!key) throw new Error('NEAR_GAME_KEY not set');
  return new Account(GARAGE, RPC, key as KeyPairString);
}

function dealerKeys(): Record<string, string> {
  try { return JSON.parse(process.env.NEAR_DEALER_KEYS ?? '{}'); } catch { return {}; }
}

const view = <T>(method: string, args: object = {}) =>
  new Account(GARAGE, RPC).provider.callFunction({ contractId: GARAGE, method, args }) as Promise<T>;

function panicText(err: unknown): string {
  const t = err instanceof Error ? err.message : String(err);
  const m = t.match(/Smart contract panicked: ([^"\n]+)/);
  return m ? m[1] : t.slice(0, 200);
}

// ───────────────────────── players ─────────────────────────

const KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;

export const createPlayer = action({
  args: { publicKey: v.string() },
  handler: async (ctx, { publicKey }): Promise<{ account: string; welcome: number; created: boolean }> => {
    if (!KEY.test(publicKey)) throw new Error('bad key');
    const had = await ctx.runQuery(internal.nearDb.playerByKey, { publicKey });
    if (had) return { account: had.account, welcome: 0, created: false };
    if ((await ctx.runQuery(internal.nearDb.recentCreations, {})) >= 120) throw new Error('busy, try later');

    const prefix = 'p' + createHash('sha256').update(publicKey).digest('hex').slice(0, 12);
    const account = `${prefix}.${GARAGE}`;
    const game = gameAccount();
    await game.signAndSendTransaction({
      receiverId: account,
      actions: [actions.createAccount(), actions.transfer(PLAYER_NEAR), actions.addFullAccessKey(PublicKey.from(publicKey))]
    });
    await ctx.runMutation(internal.nearDb.insertPlayer, { account, publicKey });
    await game.signAndSendTransaction({
      receiverId: GARAGE,
      actions: [actions.functionCall('mint', { receiver_id: account, token_id: 'rush', amount: String(WELCOME_RUSH), memo: 'welcome' }, 30n * TGAS, 0n)]
    });
    return { account, welcome: WELCOME_RUSH, created: true };
  }
});

export const payRace = action({
  args: { account: v.string(), coins: v.number(), nonce: v.number(), signature: v.string() },
  handler: async (ctx, { account, coins, nonce, signature }): Promise<{ minted: number; tx: string }> => {
    const p = await ctx.runQuery(internal.nearDb.playerByAccount, { account });
    if (!p) throw new Error('unknown player');
    const msg = new TextEncoder().encode(`minirush:pay:${account}:${Math.floor(coins)}:${nonce}`);
    const ok = PublicKey.from(p.publicKey).verify(msg, Buffer.from(signature, 'base64'));
    if (!ok) throw new Error('bad signature');
    const amount: number = await ctx.runMutation(internal.nearDb.reservePayout, { account, coins, nonce });
    try {
      const res = await gameAccount().signAndSendTransaction({
        receiverId: GARAGE,
        actions: [actions.functionCall('mint', { receiver_id: account, token_id: 'rush', amount: String(amount), memo: 'race' }, 30n * TGAS, 0n)]
      });
      return { minted: amount, tx: res.transaction.hash };
    } catch (err) {
      await ctx.runMutation(internal.nearDb.releasePayout, { account, amount });
      throw new Error(panicText(err));
    }
  }
});

/** What a player may ask the game to pay gas for: these garage calls, nothing else. */
const RELAYABLE: Record<string, bigint> = { buy: 0n, sell_back: 0n, consume: 0n, mt_transfer: 1n };

export const relay = action({
  args: { signedDelegate: v.string() },
  handler: async (ctx, { signedDelegate }): Promise<{ tx: string; value: unknown }> => {
    const bytes = Buffer.from(signedDelegate, 'base64');
    if (bytes.length > 2048) throw new Error('too large');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- borsh returns the schema's plain shape
    const sd = borsh.deserialize(SCHEMA.SignedDelegate, bytes) as any;
    const da = sd.delegateAction;
    if (da.receiverId !== GARAGE) throw new Error('only garage calls are relayed');
    const p = await ctx.runQuery(internal.nearDb.playerByAccount, { account: da.senderId });
    if (!p) throw new Error('unknown player');
    if (!da.actions.length || da.actions.length > 2) throw new Error('bad actions');
    for (const a of da.actions) {
      const fc = a.functionCall;
      if (!fc || !(fc.methodName in RELAYABLE)) throw new Error('method not relayed');
      if (BigInt(fc.deposit) !== RELAYABLE[fc.methodName]) throw new Error('bad deposit');
      if (BigInt(fc.gas) > 50n * TGAS) throw new Error('too much gas');
    }
    try {
      const res = await gameAccount().signAndSendTransaction({
        receiverId: da.senderId,
        actions: [actions.signedDelegate({ delegateAction: da, signature: sd.signature })]
      });
      // the inner call's outcome: a contract panic surfaces in the receipts, not the tx status
      for (const r of res.receipts_outcome) {
        const f = (r.outcome.status as { Failure?: unknown }).Failure;
        if (f) throw new Error(JSON.stringify(f));
      }
      const last = [...res.receipts_outcome].reverse()
        .find((r) => (r.outcome.status as { SuccessValue?: string }).SuccessValue);
      const raw = (last?.outcome.status as { SuccessValue?: string } | undefined)?.SuccessValue;
      let value: unknown = null;
      try { value = raw ? JSON.parse(Buffer.from(raw, 'base64').toString()) : null; } catch { value = null; }
      return { tx: res.transaction.hash, value };
    } catch (err) {
      const t = err instanceof Error ? err.message : String(err);
      const m = t.match(/ExecutionError\\?":\\?"([^"\\]+)/) ?? t.match(/Smart contract panicked: ([^"\n\\]+)/);
      throw new Error(m ? m[1].replace('Smart contract panicked: ', '') : t.slice(0, 200));
    }
  }
});

// ───────────────────────── dealer agents ─────────────────────────

interface ListingView {
  token_id: string; kind: string; name: string; dealer: string;
  price: string; stock: number; sold: number; reason: string; updated_ms: number;
}

/** List prices from the game's original coin economy: the anchor every dealer prices around. */
const BASE: Record<string, number> = {
  'car:sunburst': 300, 'car:gecko': 250, 'car:phantom': 400, 'car:volt': 350, 'car:juggernaut': 500,
  'car:sidewinder': 450, 'car:glasscannon': 600, 'car:r8': 2000, 'car:sesto': 2200, 'car:aventador': 2500,
  'car:divo': 2600, 'car:tourbillon': 3000, 'car:stockcar': 1200, 'part:nitro-can': 40
};

const PERSONA: Record<string, string> = {
  'mama-t': 'Mama T runs the Ladipo scrapyard stall in Lagos. Warm, shrewd, loves a quick sale; she would rather move metal than sit on it, and she cuts prices when a car has been gathering dust.',
  'oga-motors': 'Oga Motors sells hypercars from a glass showroom on the Island. Proud, prestige-minded; scarcity is his whole business. He raises prices the moment something sells and almost never discounts below list.',
  'tuner-ade': 'Tuner Ade runs a tuning bay. A numbers person: he prices nitro cans off how many people are racing right now, and keeps the stock car fair for regulars.'
};

interface Decision { token: string; price: number; reason: string; restock?: number }

function bounds(token: string, old: number, dealer: string): [number, number] {
  const base = BASE[token] ?? old;
  const floor = dealer === 'oga-motors' ? base * 0.9 : base * 0.6;
  const lo = Math.max(floor, old * 0.75), hi = Math.min(base * 2, old * 1.25);
  return [Math.ceil(lo), Math.floor(Math.max(lo, hi))];
}

function ruleDecisions(dealer: string, stalls: (ListingView & { soldSince: number; idleTicks: number })[], racers: number): Decision[] {
  return stalls.map((l) => {
    const old = Number(l.price), base = BASE[l.token_id] ?? old;
    let price = old, reason = '';
    if (l.stock === 0) {
      price = old * 1.08; reason = `Sold out — restocking 3 at a premium.`;
      return { token: l.token_id, price: Math.round(price), reason, restock: 3 };
    }
    if (l.token_id === 'part:nitro-can') {
      price = base * (1 + Math.min(racers, 20) * 0.03);
      reason = `${racers} driver${racers === 1 ? '' : 's'} raced in the last hour; nitro priced to the traffic.`;
    } else if (l.soldSince >= 2) {
      price = old * 1.12; reason = `${l.soldSince} sold since my last look — demand is up.`;
    } else if (l.soldSince === 1) {
      price = old * 1.05; reason = `One went this round; nudging it up.`;
    } else if (dealer === 'mama-t' && l.idleTicks >= 3) {
      price = old * 0.9; reason = `Nobody has bitten for a while — making it sweet.`;
    } else if (old > base) {
      price = old * 0.96; reason = `Quiet stall; easing back toward list.`;
    } else {
      return { token: l.token_id, price: old, reason: l.reason };
    }
    return { token: l.token_id, price: Math.round(price), reason };
  });
}

async function llmDecisions(dealer: string, stalls: (ListingView & { soldSince: number; idleTicks: number })[], racers: number): Promise<Decision[] | null> {
  const url = process.env.DEALER_LLM_URL, key = process.env.DEALER_LLM_KEY, model = process.env.DEALER_LLM_MODEL;
  if (!url || !key || !model) return null;
  const facts = stalls.map((l) => ({
    token: l.token_id, name: l.name, price: Number(l.price), list_price: BASE[l.token_id],
    stock: l.stock, sold_total: l.sold, sold_since_last_look: l.soldSince, idle_looks: l.idleTicks
  }));
  const prompt = `${PERSONA[dealer]}\n\nYou reprice your stall every 15 minutes in the MiniRush racing game. ` +
    `Players pay in RUSH coins they earn racing. Drivers active in the last hour: ${racers}.\n` +
    `Your stall:\n${JSON.stringify(facts)}\n\n` +
    `Return JSON only: {"decisions":[{"token":"…","price":integer,"reason":"…","restock":integer|0}]}. ` +
    `One entry per stall. Move each price at most 25% from its current price. Restock (1-5) only when stock is 0. ` +
    `The reason is shown to players next to the price: one sentence, under 140 characters, in your own voice, citing the numbers you used.`;
  try {
    const res = await fetch(url.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.6, response_format: { type: 'json_object' } }),
      signal: AbortSignal.timeout(25_000)
    });
    if (!res.ok) return null;
    const body = await res.json() as { choices?: { message?: { content?: string } }[] };
    const text = body.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { decisions?: Decision[] };
    const known = new Set(stalls.map((s) => s.token_id));
    const out = (parsed.decisions ?? []).filter((d) => known.has(d.token) && Number.isFinite(d.price) && typeof d.reason === 'string');
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export const dealerTick = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    const listings = await view<ListingView[]>('listings');
    const racers: number = await ctx.runQuery(internal.nearDb.recentRacers, {});
    const keys = dealerKeys();
    const report: string[] = [];
    for (const [account, key] of Object.entries(keys)) {
      const dealer = account.split('.')[0];
      const mine = listings.filter((l) => l.dealer === account);
      if (!mine.length) continue;
      const stalls = [];
      for (const l of mine) {
        const prev = await ctx.runQuery(internal.nearDb.lastMove, { token: l.token_id });
        const soldSince = prev ? Math.max(0, l.sold - prev.sold) : 0;
        const idleTicks = soldSince > 0 ? 0 : (prev && prev.soldSince === 0 ? 2 : 0) + 1;
        stalls.push({ ...l, soldSince, idleTicks });
      }
      const llm = await llmDecisions(dealer, stalls, racers);
      const decisions = llm ?? ruleDecisions(dealer, stalls, racers);
      const by = llm ? (process.env.DEALER_LLM_MODEL ?? 'llm') : 'rules';

      const acts = [];
      const moves = [];
      for (const d of decisions) {
        const l = stalls.find((s) => s.token_id === d.token)!;
        const old = Number(l.price);
        const [lo, hi] = bounds(d.token, old, dealer);
        const price = Math.min(hi, Math.max(lo, Math.round(d.price)));
        const reason = d.reason.replace(/\s+/g, ' ').trim().slice(0, 200);
        if (l.stock === 0 && d.restock) {
          acts.push(actions.functionCall('dealer_restock', { token_id: d.token, add: Math.min(5, Math.max(1, Math.floor(d.restock))) }, 20n * TGAS, 0n));
        }
        if (price !== old || reason !== l.reason) {
          acts.push(actions.functionCall('dealer_set_price', { token_id: d.token, price: String(price), reason }, 20n * TGAS, 0n));
        }
        moves.push({ dealer: account, token: d.token, oldPrice: old, price, sold: l.sold, soldSince: l.soldSince, reason, by });
      }
      let tx: string | undefined;
      if (acts.length) {
        const res = await new Account(account, RPC, key as KeyPairString).signAndSendTransaction({ receiverId: GARAGE, actions: acts });
        tx = res.transaction.hash;
      }
      await ctx.runMutation(internal.nearDb.recordMoves, { moves: moves.map((m) => ({ ...m, tx })) });
      report.push(`${dealer}: ${acts.length} changes by ${by}`);
    }
    return report.join('; ');
  }
});
