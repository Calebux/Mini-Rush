import { chromium } from 'playwright';

// Visual check of the new pack assets: neon skyline, gun overlay, zombie billboards
const shots = process.argv[2] ?? '.';
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto('http://localhost:4173/?len=500&seed=7&laps=1&map=neon&mode=gunrun', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.click('#btn-play');
await page.waitForTimeout(1800);
await page.screenshot({ path: `${shots}/v_flyby_neon.png` });
await page.click('#btn-tour-done');
await page.waitForTimeout(1200);
await page.click('#btn-garage-done');
await page.waitForTimeout(4500); // countdown + a few seconds of driving
await page.screenshot({ path: `${shots}/v_race_gun.png` });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${shots}/v_race_gun2.png` });

// second pass: Outbreak horde on Lagos to see the zombie billboards
await page.goto('http://localhost:4173/?len=500&seed=3&laps=1&map=lagos&mode=outbreak', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.click('#btn-play');
await page.waitForTimeout(1800);
await page.click('#btn-tour-done');
await page.waitForTimeout(1200);
await page.click('#btn-garage-done');
await page.waitForTimeout(5500);
await page.screenshot({ path: `${shots}/v_outbreak.png` });
await page.waitForTimeout(3000);
await page.screenshot({ path: `${shots}/v_outbreak2.png` });

console.log('CONSOLE ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
