// Capture the real UI and public testnet reads; never create accounts or submit transactions.
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? 'https://minirush.site';
const profile = process.argv.find(arg => arg.startsWith('--profile='))?.slice('--profile='.length);
const out = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
await mkdir(out, { recursive: true });
const options = { channel: 'chrome', headless: true };
const browser = profile ? await chromium.launchPersistentContext(profile, { ...options, viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  : await chromium.launch(options);
try {
  const page = profile ? await browser.newPage() : await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  await page.addInitScript(() => {
    localStorage.setItem('minirush.welcomed', '1');
    localStorage.setItem('minirush.controls-guide', '1');
    localStorage.setItem('minirush.driver', JSON.stringify({ name: 'MINIRUSH', chosen: true }));
  });
  await page.route('**/*', async route => {
    const req = route.request();
    if (req.method() !== 'POST') return route.continue();
    let body; try { body = req.postDataJSON(); } catch { return route.abort(); }
    if (body?.jsonrpc) {
      if (['query', 'block', 'status', 'tx', 'EXPERIMENTAL_tx_status'].includes(body.method)) return route.continue();
      return route.abort();
    }
    if (new URL(req.url()).pathname === '/api/query') return route.continue();
    return route.fulfill({ json: { status: 'success', value: null } });
  });
  const shot = async name => {
    await page.waitForTimeout(1800); // settle the existing camera transition, not a staged scene
    await page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 86 });
    console.log(`Captured ${name}.jpg`);
  };
  await page.goto(`${base}/?q=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.state === 'menu', {}, { timeout: 45000 });
  await page.waitForSelector('#home-price-wire[data-state="live"]', { timeout: 30000 });
  await shot('home');
  await page.click('#btn-market-home');
  await page.waitForSelector('[data-select="edition:lagos-gold"]', { timeout: 30000 });
  await page.click('[data-select="edition:lagos-gold"]');
  await shot('car-market');
  await page.click('.mk-back');
  await page.click('#btn-garage-menu');
  await page.click('#garage-owned-cars');
  await shot('garage');
  await page.click('#btn-workshop-garage');
  await shot('customs');
  await page.click('[data-workshop-section="performance"]');
  await shot('performance-parts');
  await page.goto(`${base}/economy/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const supply = document.querySelector('#supply')?.textContent?.trim();
    return Boolean(supply && supply !== '—');
  }, {}, { timeout: 30000 });
  await shot('economy');
} catch (e) {
  console.error(e.message); throw e;
} finally { await browser.close(); }
