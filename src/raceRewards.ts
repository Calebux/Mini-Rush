import { RECIPES, componentStats, type Recipe } from './components';
import { craftingTarget, trackRecipe } from './craftingTarget';
import { explorerTx, holdings, nearAccount, type Holding, type Reward } from './near';
import { RACE_PAYOUT } from '../shared/raceRules';

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
type Status = 'unavailable' | 'ineligible' | 'confirming' | 'confirmed' | 'pending';

/** A result belongs to one race, even when its transaction finishes after navigation. */
export class RaceRewards {
  private generation = 0;
  private balanceRequest = 0;
  private status: Status = 'unavailable';
  private note = 'Complete a connected circuit race to earn salvage.';
  private reward: Reward | null = null;
  private held: Holding[] | null = null;
  private loading = false;
  private target: Recipe = craftingTarget();
  private settle: (() => Promise<Reward | null>) | null = null;
  private chassis = 'viper';
  onWorkshop: (recipe: string, chassis: string) => void = () => {};

  constructor(private root: HTMLElement) {
    this.root.addEventListener('click', e => {
      const action = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-reward-action]');
      if (!action || action.disabled) return;
      if (action.dataset.rewardAction === 'retry') void this.claim();
      if (action.dataset.rewardAction === 'refresh') void this.loadBalances();
      if (action.dataset.rewardAction === 'workshop') this.onWorkshop(this.target.id, this.chassis);
    });
    this.root.addEventListener('change', e => {
      const select = e.target as HTMLSelectElement;
      if (select.id === 'reward-target') trackRecipe(select.value);
    });
    window.addEventListener('minirush:crafting-target', e => {
      this.target = RECIPES.find(r => r.id === (e as CustomEvent<string>).detail) ?? craftingTarget(); this.render();
    });
    this.render();
  }
  reset(): void {
    ++this.generation; ++this.balanceRequest;
    this.status = 'unavailable'; this.note = 'Complete a connected circuit race to earn salvage.';
    this.reward = null; this.held = null; this.loading = false; this.settle = null;
    this.render();
  }
  finish(chassis: string, settle: (() => Promise<Reward | null>) | null, reason = ''): void {
    this.reset();
    this.chassis = chassis === 'rush-one' ? chassis : 'viper'; this.settle = settle;
    if (reason) { this.status = 'ineligible'; this.note = reason; this.render(); }
    else if (settle) void this.claim();
  }
  show(): void { this.render(); void this.loadBalances(); }
  private async claim(): Promise<void> {
    if (!this.settle || this.status === 'confirming' || this.status === 'confirmed') return;
    const generation = this.generation;
    this.status = 'confirming'; this.note = 'Confirming this race’s salvage on NEAR…'; this.render();
    try {
      const result = await this.settle();
      if (generation !== this.generation) return;
      this.reward = result;
      this.status = result ? 'confirmed' : 'unavailable';
      this.note = result ? 'Salvage received. Your garage balance is updating.' : 'This race had no connected reward session. Local coins are still banked.';
    } catch {
      if (generation !== this.generation) return;
      this.status = 'pending';
      this.note = 'Salvage not confirmed. Retry this claim, or recover it later in Performance & Parts. Race limits and eligibility still apply.';
    }
    this.render(); void this.loadBalances();
  }
  private async loadBalances(): Promise<void> {
    const generation = this.generation, request = ++this.balanceRequest;
    this.held = null; this.loading = true; this.render();
    try {
      if (!nearAccount()) throw new Error('No connected garage');
      const held = await holdings();
      if (generation !== this.generation || request !== this.balanceRequest) return;
      this.held = held;
    } catch {
      if (generation !== this.generation || request !== this.balanceRequest) return;
      this.held = null;
    }
    this.loading = false;
    if (this.status === 'confirmed') this.note = 'Salvage received on NEAR. The receipt records this race’s payout.';
    this.render();
  }
  private render(): void {
    const celebrate = this.status === 'confirmed' && this.root.dataset.status !== 'confirmed';
    const focus = document.activeElement as HTMLElement | null;
    const restore = focus && this.root.contains(focus) ? focus.id || focus.dataset.rewardAction : null;
    const r = this.reward, target = this.target;
    const resources = [
      // Progress estimates assume the plain finish rate, so a podium only ever shortens them.
      { id: 'rush', label: 'RUSH', cost: target.rush, payout: r?.minted, perRace: RACE_PAYOUT.finish },
      { id: 'material:alloy', label: 'ALLOY', cost: target.alloy, payout: r?.alloy, perRace: RACE_PAYOUT.alloy },
      { id: 'material:circuit', label: 'CIRCUITS', cost: target.circuit, payout: r?.circuit, perRace: RACE_PAYOUT.circuit }
    ].map(x => ({ ...x, balance: Number(this.held?.find(h => h.token_id === x.id)?.balance ?? 0) }));
    const ready = this.held !== null && resources.every(x => x.balance >= x.cost);
    const races = Math.max(...resources.map(x => Math.ceil(Math.max(0, x.cost - x.balance) / x.perRace)));
    this.root.dataset.status = this.status;
    this.root.innerHTML = `<div class="rr-heading"><span>RACE SALVAGE</span><strong>${({ unavailable: 'NOT RECEIVED', ineligible: 'NOT ELIGIBLE', confirming: 'CONFIRMING', confirmed: 'RECEIVED', pending: 'CLAIM PENDING' })[this.status]}</strong></div>
      <div class="rr-payout">${resources.map(x => `<div><b>${x.payout === undefined ? '—' : `+${x.payout}`}</b><span>${x.label}</span></div>`).join('')}</div>
      <ol class="rr-tiers" aria-label="RUSH paid by finishing place">${([['WIN', RACE_PAYOUT.first, 1], ['2ND', RACE_PAYOUT.second, 2], ['3RD', RACE_PAYOUT.third, 3], ['FINISH', RACE_PAYOUT.finish, 0]] as const).map(([label, rush, tier]) => `<li${r && (r.place ?? 0) === tier ? ' aria-current="true"' : ''}><span>${label}</span><b>${rush}</b></li>`).join('')}</ol>
      <p class="rr-status" role="status" aria-live="polite">${esc(this.note)}${r ? ` <a href="${explorerTx(encodeURIComponent(r.tx))}" target="_blank" rel="noopener">View receipt ↗</a>` : ''}</p>
      ${this.status === 'pending' ? '<button type="button" data-reward-action="retry" class="rr-retry">RETRY SALVAGE CLAIM</button>' : ''}
      <div class="rr-target"><label for="reward-target">BUILD TOWARD YOUR NEXT PART</label><select id="reward-target">${RECIPES.map(recipe => `<option value="${recipe.id}" ${recipe.id === target.id ? 'selected' : ''}>${recipe.name} · ${recipe.slot}</option>`).join('')}</select>
      <p class="rr-tradeoff">${componentStats(target)}</p><p class="rr-chassis">Workshop chassis: ${this.chassis === 'rush-one' ? 'RUSH ONE' : 'VIPER GT'}</p>
      <div class="rr-materials">${resources.map(x => `<div><span>${x.label}</span><strong>${this.held ? x.balance.toLocaleString() : '—'} / ${x.cost}</strong><progress max="${x.cost}" value="${this.held ? Math.min(x.balance, x.cost) : 0}" aria-label="${x.label}: ${this.held ? x.balance : 'balance unavailable'} of ${x.cost} needed"></progress></div>`).join('')}</div>
      <p class="rr-progress-note">${this.loading ? 'Reading confirmed garage balances…' : !this.held ? 'Balance unavailable. Refresh to check your materials.' : ready ? 'Materials ready. Craft this part in the workshop.' : `About ${races} more eligible ${races === 1 ? 'race' : 'races'} at the finish rate; podiums pay more RUSH. Daily limits apply.`}</p>
      <button type="button" class="rr-workshop" data-reward-action="workshop">${ready ? 'CRAFT THIS PART' : 'VIEW RECIPE'} <span>↗</span></button>
      <div class="rr-foot"><span>NEAR TESTNET · SEPARATE FROM LOCAL COINS</span><button type="button" data-reward-action="refresh" ${this.loading ? 'disabled' : ''}>REFRESH</button></div></div>`;
    if (restore) (this.root.querySelector<HTMLElement>(`#${CSS.escape(restore)}`) ?? this.root.querySelector<HTMLElement>(`[data-reward-action="${CSS.escape(restore)}"]`))?.focus({ preventScroll: true });
    if (celebrate && !matchMedia('(prefers-reduced-motion: reduce)').matches)
      this.root.querySelectorAll('.rr-payout b').forEach(el => el.animate([{ opacity: .35, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 450 }));
  }
}
