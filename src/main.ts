import { Game } from './game';
import { trackVisibleViewport, watchAndroidHost } from './host';
import { track } from './usage';
import { recoverPurchase } from './workshop';

// Finish an interrupted coin purchase before any menu/race can read the bank.
try { recoverPurchase(); } catch { /* Workshop displays the recoverable storage error. */ }
trackVisibleViewport(); // keeps the bottom controls inside what the browser shows
watchAndroidHost(); // keeps the bottom controls clear of the Android nav bar
new Game(document.getElementById('app')!);
// ?diag=1 — layout numbers from a real device, for a bug a desktop can't show
if (new URLSearchParams(location.search).get('diag') === '1') {
  void import('./diag').then((m) => m.showDiagnostics());
}
track('open');
