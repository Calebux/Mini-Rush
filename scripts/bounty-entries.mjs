#!/usr/bin/env node
// Rank weekly bounty entries from on-chain MR3 race receipts.
//
// The bounty goes to the fastest WIN of the week's HARDCORE bounty race. There
// is no backend. Winners enter by minting their run as a transaction to the
// receipt address (VITE_RECEIPT_RECEIVER, else VITE_MARKET_RECEIVER). After
// entries close, copy those incoming transactions from a Nimiq block explorer
// into a text file, one per line, OLDEST FIRST (ties go to the earlier entry):
//
//   <sender NQ address> <data field, as text "MR3…" or as hex>
//
//   node scripts/bounty-entries.mjs --week 2026-W38 entries.txt
//   node scripts/bounty-entries.mjs --week 2026-W38 --split 7000,3500,1500 entries.txt
//   node scripts/bounty-entries.mjs --selftest
//
// --split is the week's prize per place in NIM, 1st first, and prints what to
// pay each of the top places.
//
// Receipts only prove what a wallet CLAIMED. Before paying, check the winner:
// see docs/bounty.md.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * MR3 = "MR3" + YYWW + score(8 hex) + time centiseconds(6 hex) + place(2 hex).
 * MR2, the old score-ranked Weekly Cup entry, has the same layout and decodes
 * too, so it can be turned away by name instead of as junk.
 */
export function decode(raw) {
  let text = String(raw ?? '').trim();
  if (!text.startsWith('MR') && /^(0x)?[0-9a-f]+$/i.test(text) && text.replace(/^0x/i, '').length % 2 === 0) {
    text = Buffer.from(text.replace(/^0x/i, ''), 'hex').toString('latin1');
  }
  const m = /^MR([23])(\d{2})(\d{2})([0-9a-f]{8})([0-9a-f]{6})([0-9a-f]{2})$/i.exec(text);
  if (!m) return null;
  return {
    kind: `MR${m[1]}`,
    week: `20${m[2]}-W${m[3]}`,
    score: parseInt(m[4], 16),
    time: parseInt(m[5], 16) / 100,
    place: parseInt(m[6], 16)
  };
}

// --- the bounty race's laps, lap length and physical limits, read from the game source
function bountyRace() {
  const modesSrc = readFileSync(join(root, 'src/modes.ts'), 'utf8');
  const block = modesSrc.split(/\n\s*\{\s*\n/).find((b) => /id: 'hardcore'/.test(b));
  if (!block) throw new Error("src/modes.ts has no 'hardcore' mode");
  const constants = readFileSync(join(root, 'src/constants.ts'), 'utf8');
  const num = (name, fallback) => Number(new RegExp(`${name}\\s*=\\s*([\\d.]+)`).exec(constants)?.[1] ?? fallback);
  const laps = Number(/lapsLocked: (\d+)/.exec(block)?.[1] ?? 2);
  const lap = Number(/trackLength: (\d+)/.exec(block)?.[1] ?? num('TRACK_LENGTH_DEFAULT', 1800));
  // generous ceiling: nitro top speed with every car + upgrade bonus stacked
  const vmax = num('NITRO_SPEED', 46) * 1.6 + num('END_SPEED_BONUS', 0);
  return { laps, lap, distance: laps * lap, minTime: (laps * lap) / vmax };
}

function rank(week, lines) {
  const race = bountyRace();
  const best = new Map();
  const rejected = [];
  lines.forEach((line, order) => {
    // the data field is the last token; explorers show addresses space-grouped
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) return;
    const data = parts.pop();
    const key = parts.join('').toUpperCase();
    const sender = key.replace(/(.{4})(?=.)/g, '$1 ');
    const entry = decode(data);
    const why = !entry ? 'not a race receipt'
      : entry.kind !== 'MR3' ? 'MR2 is an old Weekly Cup receipt, not a bounty entry'
      : entry.week !== week ? `wrong week (${entry.week})`
      : entry.place !== 1 ? `not a win (finished ${entry.place})`
      : entry.time < race.minTime ? `impossible time ${entry.time}s (< ${race.minTime.toFixed(1)}s)`
      : null;
    if (why) { rejected.push({ sender, why }); return; }
    // a wallet's fastest win counts; an equal time later on keeps the earlier entry
    const prev = best.get(key);
    if (!prev || entry.time < prev.time) best.set(key, { sender, ...entry, order });
  });
  const ranked = [...best.values()].sort((a, b) => a.time - b.time || a.order - b.order);
  return { race, ranked, rejected };
}

function selftest() {
  const vec = 'MR326380000303900209b01'; // W38 · score 12345 · 83.47 s · 1st
  const ok = [];
  const d = decode(vec);
  ok.push(['decode text', d && d.kind === 'MR3' && d.week === '2026-W38' && d.score === 12345 && d.time === 83.47 && d.place === 1]);
  ok.push(['decode hex', JSON.stringify(decode(Buffer.from(vec).toString('hex'))) === JSON.stringify(d)]);
  ok.push(['reject MR1', decode('MR100003039000100ff') === null]);
  ok.push(['reject junk', decode('hello') === null]);
  const A = 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA';
  const r = rank('2026-W38', [
    `${A} MR326380000303900209b01`,                                     // win in 83.47s
    'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB MR326380000303900209b01', // same time, later
    'NQ33 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCCC MR32638000186a000000101', // 0.01s
    `${A.replace(/ /g, '')} MR32637000186a000500001`,                    // last week's race
    `${A.replace(/ /g, '')} MR326380000c350001b5801`,                    // same wallet, unspaced, 70.00s
    'NQ44 DDDD DDDD DDDD DDDD DDDD DDDD DDDD DDDD MR326380000303900209b01', // ties NQ22, even later
    'NQ55 EEEE EEEE EEEE EEEE EEEE EEEE EEEE EEEE MR326380000303900209b02', // 2nd place
    'NQ66 FFFF FFFF FFFF FFFF FFFF FFFF FFFF FFFF MR226380000303900209b01', // old Weekly Cup receipt
  ]);
  ok.push(['fastest win per wallet (spaced = unspaced)', r.ranked[0]?.sender === A && r.ranked[0]?.time === 70]);
  ok.push(['tie → earlier entry first', r.ranked[1]?.sender.startsWith('NQ22') && r.ranked[2]?.sender.startsWith('NQ44')]);
  ok.push(['impossible time rejected', r.rejected.some((x) => x.sender.startsWith('NQ33') && /impossible/.test(x.why))]);
  ok.push(['wrong week rejected', r.rejected.some((x) => /wrong week/.test(x.why))]);
  ok.push(['non-win rejected', r.rejected.some((x) => x.sender.startsWith('NQ55') && /not a win/.test(x.why))]);
  ok.push(['MR2 rejected', r.rejected.some((x) => x.sender.startsWith('NQ66') && /MR2/.test(x.why))]);
  for (const [name, pass] of ok) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`);
  process.exit(ok.every(([, p]) => p) ? 0 : 1);
}

// run as a CLI only when executed directly, so tests can import decode()
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main(process.argv.slice(2));

function main(args) {
  if (args.includes('--selftest')) return selftest();
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const week = opt('--week');
  const split = opt('--split')?.split(',').map((p) => p.trim()).filter(Boolean) ?? null;
  const file = args.find((a, i) => !a.startsWith('--') && !['--week', '--split'].includes(args[i - 1]));
  if (!week || !/^\d{4}-W\d{2}$/.test(week) || !file) {
    console.error('usage: node scripts/bounty-entries.mjs --week 2026-W38 [--split 7000,3500,1500] entries.txt');
    process.exit(2);
  }
  const { race, ranked, rejected } = rank(week, readFileSync(file, 'utf8').split('\n'));
  console.log(`Bounty ${week}: HARDCORE, ${race.laps} × ${race.lap} m laps, fastest possible ≈ ${race.minTime.toFixed(1)}s\n`);
  // one row per wallet already, so the top places are distinct wallets
  ranked.forEach((e, i) => console.log(
    `${String(i + 1).padStart(2)}. ${e.sender.padEnd(44)} time ${e.time.toFixed(2)}s  score ${String(e.score).padStart(7)}` +
    (split?.[i] ? `  → pay ${split[i]} NIM` : '')
  ));
  if (!ranked.length) console.log('no valid entries');
  if (rejected.length) {
    console.log('\nrejected:');
    rejected.forEach((r) => console.log(`  ${r.sender}: ${r.why}`));
  }
}
