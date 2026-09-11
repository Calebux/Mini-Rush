// The /stats page: the anonymous player counts the game sends to Convex
// (src/usage.ts), read back through the public usage:stats query.
const CONVEX_URL = (import.meta.env.VITE_CONVEX_URL as string | undefined)?.replace(/\/$/, '');

interface Day {
  day: string;
  players: number;
  newPlayers: number;
  returned: number;
  nimiq: number;
  newNimiq: number;
  opens: number;
  races: number;
  wallets: number;
  receipts: number;
  bountyEntries: number;
  purchases: number;
}

interface Stats {
  since: string | null;
  totals: {
    players: number;
    nimiqPlayers: number;
    returned: number;
    opens: number;
    races: number;
    wallets: number;
    receipts: number;
    bountyEntries: number;
    purchases: number;
  };
  days: Day[];
}

const DAY_MS = 86_400_000;

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayLabel = (day: string): string => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
  weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'
});

function tiles(el: HTMLElement, items: [string, number][]): void {
  el.replaceChildren(...items.map(([label, value]) => {
    const tile = document.createElement('div');
    tile.className = 'tile';
    const num = document.createElement('b');
    num.textContent = value.toLocaleString('en-US');
    const name = document.createElement('span');
    name.textContent = label;
    tile.append(num, name);
    return tile;
  }));
}

function render(stats: Stats): void {
  const now = Date.now();
  const today = utcDay(now);
  const byDay = new Map(stats.days.map((d) => [d.day, d]));
  const t = byDay.get(today);

  $('today-date').textContent = `${dayLabel(today)} UTC`;
  tiles($('today'), [
    ['Players', t?.players ?? 0],
    ['New', t?.newPlayers ?? 0],
    ['Returning', (t?.players ?? 0) - (t?.newPlayers ?? 0)],
    ['Races', t?.races ?? 0]
  ]);

  const all = stats.totals;
  $('since').textContent = stats.since ? `since ${dayLabel(stats.since)}` : '';
  tiles($('totals'), [
    ['Players', all.players],
    ['Came back another day', all.returned],
    ['Played in Nimiq Pay', all.nimiqPlayers],
    ['Races finished', all.races],
    ['Wallets connected', all.wallets],
    ['Bounty entries', all.bountyEntries],
    ['Race receipts on-chain', all.receipts],
    ['Cars bought with NIM', all.purchases]
  ]);

  const rows: HTMLTableRowElement[] = [];
  for (let i = 0; i < 14; i++) {
    const day = utcDay(now - i * DAY_MS);
    if (!stats.since || day < stats.since) break; // nothing was counted before the first day
    const d = byDay.get(day);
    const tr = document.createElement('tr');
    const cells: (string | number)[] = [
      dayLabel(day), d?.players ?? 0, d?.newPlayers ?? 0, d?.races ?? 0, d?.bountyEntries ?? 0
    ];
    for (const value of cells) {
      const td = document.createElement('td');
      td.textContent = typeof value === 'number' ? value.toLocaleString('en-US') : value;
      if (value === 0) td.className = 'zero';
      tr.append(td);
    }
    rows.push(tr);
  }
  $('days-body').replaceChildren(...rows);
  $('days-empty').hidden = rows.length > 0;

  $('updated').textContent = `Updated ${new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

async function load(): Promise<void> {
  if (!CONVEX_URL) {
    $('updated').textContent = 'Stats are not set up for this build.';
    return;
  }
  try {
    const res = await fetch(`${CONVEX_URL}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'usage:stats', args: {}, format: 'json' })
    });
    const body = await res.json() as { status?: string; value?: Stats };
    if (!res.ok || body.status !== 'success' || !body.value) throw new Error('stats unavailable');
    render(body.value);
  } catch {
    $('updated').textContent = 'Could not load stats. Trying again in a minute.';
  }
}

void load();
setInterval(() => {
  if (!document.hidden) void load();
}, 60_000);
