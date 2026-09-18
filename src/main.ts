import { Game } from './game';
import { watchAndroidHost } from './host';
import { track } from './usage';
import { recoverPurchase } from './workshop';

// Finish an interrupted coin purchase before any menu/race can read the bank.
try { recoverPurchase(); } catch { /* Workshop displays the recoverable storage error. */ }
watchAndroidHost(); // keeps the bottom controls clear of the Android nav bar
new Game(document.getElementById('app')!);
track('open');
