import { CARS } from './cars';
import { bank } from './economy';
import { Build, PARTS, SLOTS, Slot, ownsPart, part, purchasePart, recoverPurchase, saveBuild, workshopSpec, workshopStore } from './workshop';
import './workshop.css';

const $ = (id: string) => document.getElementById(id)!;
export class WorkshopUI {
  private build!: Build;
  private index = 0;
  private slot: Slot = 'body';
  private selected = 'street';
  private returnFocus: HTMLElement | null = null;
  constructor(private preview: (build: Build | null) => void, private closePage: () => void, private equip: () => void) {
    $('workshop-back').onclick = () => this.close();
    $('workshop-buy').onclick = () => {
      const error = purchasePart(this.selected); this.render();
      this.status(error ?? `${part(this.selected)!.name} is yours. Save to equip this build.`);
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
  open(): void {
    this.returnFocus = document.activeElement as HTMLElement;
    let error = ''; try { recoverPurchase(); } catch { error = 'Storage unavailable. Purchases and saving may not work.'; }
    const s = workshopStore(); this.index = s.active; this.build = structuredClone(s.builds[this.index]); this.selected = this.build.parts[this.slot];
    $('workshop').classList.remove('hidden'); this.render(); this.status(error || 'Preview any part. Only owned parts can be equipped.'); $('workshop-back').focus();
  }
  private close(): void { $('workshop').classList.add('hidden'); this.preview(null); this.closePage(); this.returnFocus?.focus(); }
  private status(s: string): void { $('workshop-status').textContent = s; }
  private render(): void {
    ($('workshop-name') as HTMLInputElement).value = this.build.name;
    $('workshop-balance').textContent = `${bank()} COINS`;
    [...$('workshop-presets').children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === this.index)));
    [...$('workshop-tabs').children].forEach(b => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.slot === this.slot)));
    $('workshop-parts').replaceChildren();
    for (const p of PARTS.filter(p => p.slot === this.slot)) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'part-card'; b.setAttribute('aria-pressed', String(this.build.parts[this.slot] === p.id)); b.dataset.part = p.id;
      const icon = document.createElement('span'); icon.className = `part-symbol symbol-${p.slot}`; icon.textContent = p.slot === 'wheels' ? '◉' : p.slot === 'wing' ? '━' : p.slot === 'power' ? 'ϟ' : p.slot === 'tyres' ? '◎' : p.slot === 'body' ? '▰' : '';
      if (p.color !== undefined) icon.style.background = `#${p.color.toString(16).padStart(6, '0')}`;
      const name = document.createElement('strong'); name.textContent = p.name;
      const price = document.createElement('small'); price.textContent = ownsPart(p.id) ? 'OWNED' : `${p.price} COINS`;
      b.append(icon, name, price); b.onclick = () => { this.build.parts[this.slot] = p.id; this.selected = p.id; this.render(); this.status(p.detail); };
      $('workshop-parts').append(b);
    }
    const p = part(this.selected)!; const have = ownsPart(p.id);
    const buy = $('workshop-buy') as HTMLButtonElement; buy.disabled = have || bank() < p.price; buy.textContent = have ? 'PART OWNED' : `BUY PART · ${p.price} COINS`;
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
  }
}
