import { Game } from './game';
import { trackVisibleViewport, watchAndroidHost } from './host';
import { track } from './usage';
import { recoverPurchase } from './workshop';
import './neonHome.css'; // the Neon Night theme overrides the older sheets
import './raceHud.css';
import './consolePresentation.css';
import './market.css';
import './partsWorkshop.css';
import './raceRewards.css';
import './garagePresentation.css';

// Finish an interrupted coin purchase before any menu/race can read the bank.
try { recoverPurchase(); } catch { /* Workshop displays the recoverable storage error. */ }
trackVisibleViewport(); // keeps the bottom controls inside what the browser shows
watchAndroidHost(); // keeps the bottom controls clear of the Android nav bar
new Game(document.getElementById('app')!);
// The player's NEAR garage is made in the background on first launch; cars
// already held on chain become drivable. Never blocks the game.
void import('./near').then(async (n) => {
  if (!(await n.ensureAccount())) return;
  n.syncCars(await n.holdings().catch(() => []));
  await n.refreshComponents().catch(() => {});
});
// ?diag=1 — layout numbers from a real device, for a bug a desktop can't show
if (new URLSearchParams(location.search).get('diag') === '1') {
  void import('./diag').then((m) => m.showDiagnostics());
}
track('open');
