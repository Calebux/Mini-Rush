import { chromium } from 'playwright';

// Usage: node scripts/smoke.mjs [shotsDir] — expects `vite preview` on :4173
const shots = process.argv[2] ?? '.';
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

// the test drives GECKO, which the coin economy locks for fresh profiles
await page.addInitScript(() => {
  localStorage.setItem('minirush.owned', JSON.stringify(['sunburst', 'gecko']));
});
// short seeded 1-lap circuit so the race finishes fast
await page.goto('http://localhost:4173/?len=500&seed=7&laps=1', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shots}/1_menu.png` });

// race setup flow: RACE → city step (flyby) → car step (turntable) → START
await page.click('#btn-play');
await page.waitForTimeout(1600); // overlay fade + camera glide onto the circuit
await page.screenshot({ path: `${shots}/1b_tour.png` });
await page.click('#btn-tour-done');
await page.click('#car-next');
await page.click('#car-next');
const car = await page.evaluate(() => document.getElementById('car-name-t').textContent);
console.log('CAR:', car);
await page.waitForTimeout(1600); // let the turntable camera swing in
await page.screenshot({ path: `${shots}/1a_garage.png` });
await page.click('#btn-garage-done'); // START RACE
await page.waitForTimeout(1200);
await page.screenshot({ path: `${shots}/2_countdown.png` });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${shots}/3_race_start.png` });

// hold the gas the whole race; steer around; try nitro (space) mid-race
await page.keyboard.down('ArrowUp');
let shot = false;
for (let i = 0; i < 70; i++) {
  const done = await page.evaluate(() => !document.getElementById('results').classList.contains('hidden'));
  if (done) break;
  const key = Math.random() < 0.5 ? 'ArrowLeft' : 'ArrowRight';
  await page.keyboard.down(key);
  await page.waitForTimeout(280);
  await page.keyboard.up(key);
  if (i === 12) await page.keyboard.press(' ');
  if (i === 20 && !shot) { shot = true; await page.screenshot({ path: `${shots}/4_midrace.png` }); }
  await page.waitForTimeout(120);
}
await page.screenshot({ path: `${shots}/5_results.png` });

const results = await page.evaluate(() => ({
  visible: !document.getElementById('results').classList.contains('hidden'),
  place: document.getElementById('result-place')?.textContent,
  time: document.getElementById('r-time')?.textContent,
  zombies: document.getElementById('r-zombies')?.textContent,
  coins: document.getElementById('r-coins')?.textContent,
  score: document.getElementById('r-score')?.textContent,
  rank: document.getElementById('r-rank')?.textContent
}));
console.log('RESULTS:', JSON.stringify(results));

// leaderboard: back to menu, open the board, expect our fresh run on it
let boardRows = -1;
if (results.visible) {
  await page.click('#btn-menu');
  await page.click('#btn-board');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/6_leaderboard.png` });
  boardRows = await page.evaluate(() => document.querySelectorAll('#board-list .board-row').length);
  console.log('BOARD ROWS:', boardRows);
  await page.click('#btn-board-close');
}

if (results.visible) {
  // restart through the setup flow (we detoured to the menu via the board)
  await page.click('#btn-play');
  await page.click('#btn-tour-done');
  await page.click('#btn-garage-done');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(4500);
  const hud = await page.evaluate(() => ({
    pos: document.getElementById('hud-pos').textContent,
    time: document.getElementById('hud-time').textContent
  }));
  console.log('RETRY HUD:', JSON.stringify(hud));
}

console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length > 0 || !results.visible || boardRows < 1 ? 1 : 0);
