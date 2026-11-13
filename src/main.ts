import { Game } from './game';
import { trackVisibleViewport, watchAndroidHost } from './host';
import { track } from './usage';
import { recoverPurchase } from './workshop';
import { installGarageActivity } from './garageActivity';
import { SIGN_IN_REQUIRED } from './shopSession';
import { installHomePriceWire } from './homePriceWire';
import './neonHome.css'; // the Neon Night theme overrides the older sheets
import './raceHud.css';
import './consolePresentation.css';
import './market.css';
import './partsWorkshop.css';
import './raceRewards.css';
import './garagePresentation.css';
import './garageActivity.css';
import './cardSystem.css';
import './homePriceWire.css';

// Finish an interrupted coin purchase before any menu/race can read the bank.
try { recoverPurchase(); } catch { /* Workshop displays the recoverable storage error. */ }
trackVisibleViewport(); // keeps the bottom controls inside what the browser shows
watchAndroidHost(); // keeps the bottom controls clear of the Android nav bar
new Game(document.getElementById('app')!);
installGarageActivity();
installHomePriceWire();
// The garage made on this device is how a player gets in. The login panel is
// only loaded where a deployment requires one for buying.
if (SIGN_IN_REQUIRED) void import('./socialSignIn').then(m => m.installSocialSignIn());
// The player's NEAR garage is made in the background on first launch; cars
// already held on chain become drivable. Never blocks the game.
void import('./near').then(async (n) => {
  n.startGarageRecovery();
  const account = await n.ensureAccount();
  if (!account) return;
  if (!SIGN_IN_REQUIRED) {
    document.querySelector('[data-home-session-label]')!.textContent = `DRIVER ${account.split('.')[0].toUpperCase()}`;
    document.querySelector('[data-home-session-copy]')!.textContent = 'Ready to race, craft and trade. Saved on this device.';
  }
  void n.recoverGarage();
  n.syncCars(await n.holdings().catch(() => []));
  await n.refreshComponents().catch(() => {});
  window.dispatchEvent(new Event('minirush:garage-updated'));
});
// ?diag=1 — layout numbers from a real device, for a bug a desktop can't show
if (new URLSearchParams(location.search).get('diag') === '1') {
  void import('./diag').then((m) => m.showDiagnostics());
}
track('open');
