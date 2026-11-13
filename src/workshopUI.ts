import { PartsWorkshop } from './partsWorkshop';
import { CARS } from './cars';
import { type ComponentInstallation, type Recipe } from './components';
import { bank } from './economy';
import { shopOpen, requireShopSession } from './shopSession';
import { Build, PARTS, SLOTS, Slot, ownsPart, part, purchasePart, recoverPurchase, saveBuild, workshopSpec, workshopStore } from './workshop';
import './workshop.css';
import { escapePartText, partArt, spotlightPart, styleStory, syncPartView } from './partPresentation';

const $ = (id: string) => document.getElementById(id)!;
export class WorkshopUI {
  private parts: PartsWorkshop;
  private section: 'style' | 'performance' = 'style';
  private build!: Build;
  private index = 0;
  private slot: Slot = 'body';
  private selected = 'street';
  private returnFocus: HTMLElement | null = null;
  private installation: HTMLElement;
  private installTimer = 0;
  private purchasing = false;
  constructor(private preview: (build: Build | null, chassis?: string) => void, private closePage: () => void, private equip: () => void, private onInstalled: (recipe: Recipe, chassis: string) => void = () => {}, raceForMaterials: () => void = () => {}) {
    this.installation = document.createElement('div'); this.installation.id = 'workshop-installation';
    this.installation.hidden = true; this.installation.setAttribute('role', 'status'); this.installation.setAttribute('aria-live', 'polite');
    $('workshop-performance').before(this.installation);
    this.parts = new PartsWorkshop($('workshop-performance'), chassis => {
      if (this.section !== 'performance' || $('workshop').classList.contains('hidden')) return;
      this.preview(null, chassis);
      this.clearInstallation();
      $('workshop-car-stage').querySelector('.workshop-stage-label')!.textContent = `${chassis === 'viper' ? 'VIPER GT' : 'RUSH ONE'} / PERFORMANCE BUILD`;
      $('workshop-car-stage').setAttribute('aria-label', `${chassis === 'viper' ? 'VIPER GT' : 'RUSH ONE'} preview. Drag or use arrow keys to rotate.`);
    }, report => this.showInstallation(report), () => {
      this.clearInstallation(); $('workshop').classList.add('hidden'); this.preview(null); raceForMaterials();
    });
    document.querySelectorAll<HTMLButtonElement>('[data-workshop-section]').forEach(button => {
      button.onclick = () => this.showSection(button.dataset.workshopSection as 'style' | 'performance');
    });
    $('workshop-back').onclick = () => this.close();
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-part-view]')) {
      button.onclick = () => {
        $('workshop-car-stage').dataset.view = button.dataset.partView;
        syncPartView();
      };
    }
    window.addEventListener('minirush:session', () => { if (this.build && this.section === 'style' && !$('workshop').classList.contains('hidden')) this.render(); });
    $('workshop-buy').onclick = async () => {
      if (this.purchasing) return;
      const selected = this.selected;
      this.purchasing = true; this.render();
      try {
        if (!(await requireShopSession()) || selected !== this.selected) return;
        const error = purchasePart(selected);
        this.status(error ?? `${part(selected)!.name} is yours. Save to equip this build.`);
      } finally { this.purchasing = false; this.render(); }
    };
    $('workshop-save').onclick = () => {
      this.build.name = ($('workshop-name') as HTMLInputElement).value;
      const error = saveBuild(this.index, this.build);
      if (error) { this.status(error); return; }
      this.equip(); this.close();
    };
    $('workshop-name').addEventListener('input', e => { this.build.name = (e.target as HTMLInputElement).value; });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('workshop').classList.contains('hidden')) this.close(); });
    for (const slot of SLOTS) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = slot; b.dataset.slot = slot;
      b.onclick = () => { this.slot = slot; this.selected = this.build.parts[slot]; this.render(); };
      $('workshop-tabs').append(b);
    }
    for (let i = 0; i < 3; i++) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = `0${i + 1}`; b.setAttribute('aria-label', `Load saved build ${i + 1}; unsaved preview will be discarded`);
      b.onclick = () => { this.index = i; this.build = structuredClone(workshopStore().builds[i]); this.selected = this.build.parts[this.slot]; this.render(); this.status('Loaded saved build. Unsaved previews were discarded.'); };
      $('workshop-presets').append(b);
    }
  }
  open(chassis = 'rush-one', recipe?: string): void {
    this.parts.setChassis(chassis === 'viper' ? 'viper' : 'rush-one');
    this.returnFocus = document.activeElement as HTMLElement;
    let error = ''; try { recoverPurchase(); } catch { error = 'Storage unavailable. Purchases and saving may not work.'; }
    const s = workshopStore(); this.index = s.active; this.build = structuredClone(s.builds[this.index]); this.selected = this.build.parts[this.slot];
    if (recipe) this.parts.selectRecipe(recipe);
    $('workshop').classList.remove('hidden'); this.showSection(recipe ? 'performance' : 'style'); this.status(error || 'Preview any part. Only owned parts can be equipped.'); $('workshop-back').focus();
  }
  private clearInstallation(): void { window.clearTimeout(this.installTimer); this.installation.hidden = true; }
  private showInstallation(report: ComponentInstallation): void {
    if (this.section !== 'performance' || $('workshop').classList.contains('hidden')) return;
    $('workshop-car-stage').dataset.view = 'car'; syncPartView();
    this.installation.replaceChildren();
    const title = document.createElement('strong'); title.textContent = `${report.recipe.name} installed`;
    const caption = document.createElement('small'); caption.textContent = `BUILD CONFIRMED · ${report.chassis === 'viper' ? 'VIPER GT' : 'RUSH ONE'}`;
    const stats = document.createElement('span');
    stats.textContent = (['speed','accel','grip','nitro'] as const).filter(key => report.before[key] !== report.after[key]).map(key => `${({ speed: 'Speed', accel: 'Launch', grip: 'Grip', nitro: 'Boost' })[key]} ${Math.round(report.before[key]*100)} → ${Math.round(report.after[key]*100)}`).join(' · ') || 'Loadout updated · performance unchanged';
    this.installation.append(caption, title, stats); this.installation.hidden = false;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    $('workshop').scrollTo({ top: 0, behavior });
    $('workshop').querySelector('.workshop-panel')?.scrollTo({ top: 0, behavior });
    window.clearTimeout(this.installTimer); this.installTimer = window.setTimeout(() => { this.installation.hidden = true; }, 6500);
    this.onInstalled(report.recipe, report.chassis);
  }
  private showSection(section: 'style' | 'performance'): void {
    this.clearInstallation();
    this.section = section;
    $('workshop-customize').hidden = section !== 'style';
    $('workshop-performance').hidden = section !== 'performance';
    $('workshop-balance').hidden = section !== 'style';
    document.querySelectorAll<HTMLButtonElement>('[data-workshop-section]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workshopSection === section)));
    if (section === 'performance') void this.parts.open();
    else {
      $('workshop-car-stage').querySelector('.workshop-stage-label')!.textContent = 'RUSH ONE / ORIGINAL SERIES';
      $('workshop-car-stage').setAttribute('aria-label', 'Custom car preview. Drag or use arrow keys to rotate.');
      this.render();
    }
  }
  private close(): void {
    this.clearInstallation(); $('workshop').classList.add('hidden'); this.preview(null); this.closePage();
    if (this.returnFocus?.isConnected && this.returnFocus.getClientRects().length) this.returnFocus.focus({ preventScroll: true });
  }
  private status(s: string): void { $('workshop-status').textContent = s; }
  private render(): void {
    const focusedPart = (document.activeElement as HTMLElement | null)?.dataset.part;
    ($('workshop-name') as HTMLInputElement).value = this.build.name;
    $('workshop-balance').textContent = `${bank()} COINS`;
    [...$('workshop-presets').children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === this.index)));
    [...$('workshop-tabs').children].forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.slot === this.slot)));
    $('workshop-parts').replaceChildren();
    for (const p of PARTS.filter(p => p.slot === this.slot)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'part-card'; b.setAttribute('aria-pressed', String(this.build.parts[this.slot] === p.id)); b.dataset.part = p.id;
      b.classList.add('ws-card');
      const story = styleStory(p); b.style.setProperty('--part-accent', story.accent);
      b.innerHTML = `<span class="ws-card-index">${escapePartText(p.slot)} / RUSH ONE</span>${partArt(story.kind, story.accent, p.id)}<strong>${escapePartText(p.name)}</strong><small>${ownsPart(p.id) ? 'OWNED' : `${p.price} COINS`} <i>${this.build.parts[this.slot] === p.id ? 'PREVIEWING' : 'TRY ON ↗'}</i></small>`;
      b.onclick = () => { this.build.parts[this.slot] = p.id; this.selected = p.id; this.render(); this.status(p.detail); };
      $('workshop-parts').append(b);
    }
    const p = part(this.selected)!; const have = ownsPart(p.id);
    const story = styleStory(p);
    spotlightPart(story);
    $('workshop-style-detail').innerHTML = `<div class="ws-dossier" style="--part-accent:${story.accent}"><small>${story.tag}</small><h3>${story.line}</h3><p>${escapePartText(p.detail)}</p><div class="ws-style-effect">${p.slot === 'tyres' || p.slot === 'power' ? 'LOCAL TUNE · PERFORMANCE INDEX ABOVE' : 'VISUAL CUSTOMIZATION · NO STAT ADVANTAGE'}</div></div>`;
    const buy = $('workshop-buy') as HTMLButtonElement; buy.disabled = this.purchasing || have || shopOpen() && bank() < p.price; buy.textContent = this.purchasing ? 'CHECKING SIGN-IN…' : have ? 'PART OWNED' : !shopOpen() ? 'SIGN IN TO BUY' : `BUY PART · ${p.price} COINS`;
    const missing = SLOTS.filter(s => !ownsPart(this.build.parts[s]));
    const save = $('workshop-save') as HTMLButtonElement; save.disabled = missing.length > 0; save.textContent = missing.length ? `BUY ${missing.length} PREVIEWED PART${missing.length > 1 ? 'S' : ''} TO EQUIP` : 'SAVE & EQUIP';
    const spec = workshopSpec(CARS.find(c => c.model === 300)!, this.build);
    $('workshop-stats').replaceChildren();
    for (const [name, value] of [['Speed', spec.speed], ['Launch', spec.accel], ['Grip', spec.grip], ['Nitro', spec.nitro]] as const) {
      const el = document.createElement('div'); const label = document.createElement('span'); label.textContent = name;
      const strong = document.createElement('strong'); strong.textContent = `${Math.round(value * 100)}`;
      const meter = document.createElement('i'); meter.style.setProperty('--stat', `${value / 1.2 * 100}%`); el.append(label, strong, meter); $('workshop-stats').append(el);
    }
    this.preview(structuredClone(this.build));
    if (focusedPart) $('workshop-parts').querySelector<HTMLElement>(`[data-part="${CSS.escape(focusedPart)}"]`)?.focus({ preventScroll: true });
  }
}
