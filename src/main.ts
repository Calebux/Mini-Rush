import { Game } from './game';
import { recoverPurchase } from './workshop';

// Finish an interrupted coin purchase before any menu/race can read the bank.
try { recoverPurchase(); } catch { /* Workshop displays the recoverable storage error. */ }
new Game(document.getElementById('app')!);
