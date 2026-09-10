#!/usr/bin/env node
// Rank Weekly Cup bounty entries from on-chain MR2 race receipts.
//
// There is no backend. Players enter by minting their run as a transaction to
// the receipt address (VITE_RECEIPT_RECEIVER, else VITE_MARKET_RECEIVER). After
// entries close, copy those incoming transactions from a Nimiq block explorer
// into a text file, one per line, OLDEST FIRST (ties go to the earlier entry):
//
//   <sender NQ address> <data field, as text "MR2…" or as hex>
//
//   node scripts/bounty-entries.mjs --week 2026-W38 entries.txt
//   node scripts/bounty-entries.mjs --selftest
//
// Receipts only prove what a wallet CLAIMED. Before paying, check the winner:
// see docs/bounty.md.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** MR2 = "MR2" + YYWW + score(8 hex) + time centiseconds(6 hex) + place(2 hex). */
export function decode(raw) {
  let text = String(raw ?? '').trim();
  if (!text.startsWith('MR') && /^(0x)?[0-9a-f]+$/i.test(text) && text.replace(/^0x/i, '').length % 2 === 0) {
    text = Buffer.from(text.replace(/^0x/i, ''), 'hex').toString('latin1');
  }
  const m = /^MR2(\d{2})(\d{2})([0-9a-f]{8})([0-9a-f]{6})([0-9a-f]{2})$/i.exec(text);
  if (!m) return null;
  return {
    week: `20${m[1]}-W${m[2]}`,
    score: parseInt(m[3], 16),
    time: parseInt(m[4], 16) / 100,
    place: parseInt(m[5], 16)
  };
}

// --- the cup's mode, laps and physical limits, derived exactly as the game does
function weekHash(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

function cupFor(week) {
  const modesSrc = readFileSync(join(root, 'src/modes.ts'), 'utf8');
  const blocks = modesSrc.split(/\n\s*\{\s*\n/).slice(1).filter((b) => /id: '/.test(b));
  const modes = blocks.map((b) => ({
    id: /id: '([a-z0-9]+)'/.exec(b)[1],
    laps: Number(/lapsLocked: (\d+)/.exec(b)?.[1] ?? 2),
    pursuit: /pursuit: true/.test(b)
  }));
  const constants = readFileSync(join(root, 'src/constants.ts'), 'utf8');
  const num = (name, fallback) => Number(new RegExp(`${name}\\s*=\\s*([\\d.]+)`).exec(constants)?.[1] ?? fallback);
  const mode = modes[(Math.imul(weekHash(week), 40503) >>> 0) % modes.length];
  const trackLen = num('TRACK_LENGTH_DEFAULT', 1800);
  // generous ceiling: nitro top speed with every car + upgrade bonus stacked
  const vmax = num('NITRO_SPEED', 46) * 1.6 + num('END_SPEED_BONUS', 0);
  return { mode, distance: mode.laps * trackLen, minTime: (mode.laps * trackLen) / vmax };
}

function rank(week, lines) {
  const cup = cupFor(week);
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
    const why = !entry ? 'not an MR2 receipt'
      : entry.week !== week ? `wrong week (${entry.week})`
      : entry.time < cup.minTime ? `impossible time ${entry.time}s (< ${cup.minTime.toFixed(1)}s)`
      : cup.mode.pursuit && entry.place !== 1 ? 'busted run'
      : null;
    if (why) { rejected.push({ sender, why }); return; }
    const prev = best.get(key);
    const better = !prev || entry.score > prev.score || (entry.score === prev.score && entry.time < prev.time);
    if (better) best.set(key, { sender, ...entry, order: prev && entry.score === prev.score ? prev.order : order });
  });
  const ranked = [...best.values()].sort((a, b) => b.score - a.score || a.time - b.time || a.order - b.order);
  return { cup, ranked, rejected };
}

function selftest() {
  const vec = 'MR226380000303900209b01';
  const ok = [];
  const d = decode(vec);
  ok.push(['decode text', d && d.week === '2026-W38' && d.score === 12345 && d.time === 83.47 && d.place === 1]);
  ok.push(['decode hex', JSON.stringify(decode(Buffer.from(vec).toString('hex'))) === JSON.stringify(d)]);
  ok.push(['reject MR1', decode('MR100003039000100ff') === null]);
  ok.push(['reject junk', decode('hello') === null]);
  const A = 'NQ11 AAAA AAAA AAAA AAAA AAAA AAAA AAAA AAAA';
  const r = rank('2026-W38', [
    `${A} MR226380000303900209b01`,                                    // 12345 in 83.47s
    'NQ22 BBBB BBBB BBBB BBBB BBBB BBBB BBBB BBBB MR226380000303900209b01', // same run, later
    'NQ33 CCCC CCCC CCCC CCCC CCCC CCCC CCCC CCCC MR22638000186a000000101', // 100000 in 0.01s
    `${A.replace(/ /g, '')} MR22637000186a000500001`,                   // last week's cup
    `${A.replace(/ /g, '')} MR226380000c350003a9801`,                   // same wallet, unspaced, 50000
    'NQ44 DDDD DDDD DDDD DDDD DDDD DDDD DDDD DDDD MR226380000303900209b01', // ties NQ22, even later
  ]);
  ok.push(['best per wallet (spaced = unspaced)', r.ranked[0]?.sender === A && r.ranked[0]?.score === 50000]);
  ok.push(['tie → earlier entry first', r.ranked[1]?.sender.startsWith('NQ22') && r.ranked[2]?.sender.startsWith('NQ44')]);
  ok.push(['impossible time rejected', r.rejected.some((x) => x.sender.startsWith('NQ33') && /impossible/.test(x.why))]);
  ok.push(['wrong week rejected', r.rejected.some((x) => /wrong week/.test(x.why))]);
  for (const [name, pass] of ok) console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}`);
  process.exit(ok.every(([, p]) => p) ? 0 : 1);
}

// run as a CLI only when executed directly, so tests can import decode()
const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main(process.argv.slice(2));

function main(args) {
  if (args.includes('--selftest')) return selftest();
  const wi = args.indexOf('--week');
  const week = wi >= 0 ? args[wi + 1] : null;
  const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--week');
  if (!week || !/^\d{4}-W\d{2}$/.test(week) || !file) {
    console.error('usage: node scripts/bounty-entries.mjs --week 2026-W38 entries.txt');
    process.exit(2);
  }
  const { cup, ranked, rejected } = rank(week, readFileSync(file, 'utf8').split('\n'));
  console.log(`Weekly Cup ${week}: ${cup.mode.id}, ${cup.mode.laps} lap(s), ${cup.distance} m, fastest possible ≈ ${cup.minTime.toFixed(1)}s\n`);
  ranked.forEach((e, i) => console.log(`${String(i + 1).padStart(2)}. ${e.sender.padEnd(44)} score ${String(e.score).padStart(7)}  time ${e.time.toFixed(2)}s  place ${e.place}`));
  if (!ranked.length) console.log('no valid entries');
  if (rejected.length) {
    console.log('\nrejected:');
    rejected.forEach((r) => console.log(`  ${r.sender}: ${r.why}`));
  }
}
