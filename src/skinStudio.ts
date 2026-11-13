import type { CarSpec } from './cars';
import { bank } from './economy';
import { activeSkinIndex, CAR_SKINS, saveSkinDesign, skinDesign, skinOwned, supportsSkinDesign, type SkinDesign } from './skins';
import { requireShopSession, shopOpen } from './shopSession';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
/** Drafts only reach the showroom. Saving is the only path into the racing loadout. */
export class SkinStudio {
  private car!: CarSpec;
  private available = false;
  private selected = 0;
  private draft!: SkinDesign;
  private busy = false;
  private note = '';
  private editing = false;
  constructor(private root: HTMLElement, private preview: (id: string, design: SkinDesign | null) => void, private changed: () => void) {}
  show(car: CarSpec, available: boolean): void {
    if (this.car?.id !== car.id || this.available !== available) {
      this.selected = activeSkinIndex(car.id); this.draft = skinDesign(car.id, this.selected, car.color);
      this.note = ''; this.editing = false; this.preview(car.id, null);
    }
    this.car = car; this.available = available; this.render();
  }
  private render(): void {
    this.root.closest('#garage')?.classList.toggle('skin-editing', this.editing);
    const car = this.car, active = activeSkinIndex(car.id), have = skinOwned(car.id, this.selected);
    if (!supportsSkinDesign(car)) {
      this.root.innerHTML = '<div class="skin-heading"><strong>FACTORY LIVERY</strong></div><p class="skin-factory">Custom skins are not available for this car yet. Visit the studio with VIPER GT, RUSH ONE, STOCK 88 or a Hypercar.</p>';
      return;
    }
    const skins = CAR_SKINS[car.id], chosen = skins[this.selected];
    this.root.innerHTML = `<div class="skin-heading"><div><small>MAKE IT YOURS</small><strong>SKIN STUDIO</strong></div><span>COSMETIC ONLY</span></div>
      <div class="skin-catalog" aria-label="Car skins">${skins.map((s, i) => {
        const d = skinDesign(car.id, i, car.color);
        return `<button type="button" data-skin="${i}" aria-pressed="${i === this.selected}" ${this.busy ? 'disabled' : ''}>
          <svg viewBox="0 0 140 65" aria-hidden="true"><path d="M13 45L25 31L48 25L65 12H92L112 31L128 40V53H13Z" fill="${hex(d.color)}" stroke="#c9c8b7"/><path d="M56 26L69 16H90L104 31Z" fill="#172128"/>${d.pattern === 'stripes' ? `<path d="M17 41L44 31M21 46L48 36" stroke="${hex(d.accent)}" stroke-width="3"/>` : ''}<circle cx="38" cy="51" r="10" fill="#141713"/><circle cx="105" cy="51" r="10" fill="#141713"/><circle cx="38" cy="51" r="5" fill="#9da79f"/><circle cx="105" cy="51" r="5" fill="#9da79f"/></svg>
          <strong>${s.name}</strong><small>${i === active ? 'EQUIPPED' : skinOwned(car.id, i) ? 'OWNED' : `${s.price} COINS`}</small></button>`;
      }).join('')}</div>
      <div class="skin-design-title"><strong>${chosen.name}</strong><span>${this.selected === 0 ? 'FACTORY LOOK' : 'YOUR COLOURS. YOUR FINISH.'}</span></div>
      ${this.selected > 0 ? `<fieldset class="skin-editor" ${this.busy ? 'disabled' : ''}><legend class="ws-sr">Customize ${chosen.name}</legend>
        <label>BODY COLOUR<input type="color" data-skin-color="color" value="${hex(this.draft.color)}"></label>
        <label>STRIPE COLOUR<input type="color" data-skin-color="accent" value="${hex(this.draft.accent)}" ${this.draft.pattern === 'solid' ? 'disabled' : ''}></label>
        <label>DESIGN<select data-skin-option="pattern"><option value="solid" ${this.draft.pattern === 'solid' ? 'selected' : ''}>Solid colour</option><option value="stripes" ${this.draft.pattern === 'stripes' ? 'selected' : ''}>Twin racing stripes</option></select></label>
        <label>FINISH<select data-skin-option="finish"><option value="gloss" ${this.draft.finish === 'gloss' ? 'selected' : ''}>Gloss</option><option value="satin" ${this.draft.finish === 'satin' ? 'selected' : ''}>Satin</option></select></label>
      </fieldset>` : '<p class="skin-factory">Original paint. Choose a skin above to create your own colourway.</p>'}
      <p id="skin-status" role="status">${this.note || (!this.available ? 'Own this car before buying or equipping its skins.' : 'Preview freely. Your racing skin changes only when you save.')}</p>
      <div class="skin-actions"><button type="button" data-skin-save ${this.busy || !this.available || (!have && shopOpen() && bank() < chosen.price) ? 'disabled' : ''}>${this.busy ? 'SAVING…' : !this.available ? 'OWN THIS CAR FIRST' : !have && !shopOpen() ? 'SIGN IN TO BUY' : have ? this.selected === 0 ? 'EQUIP FACTORY' : 'SAVE & EQUIP' : `BUY & EQUIP · ${chosen.price} COINS`}</button><button type="button" data-skin-cancel ${this.busy ? 'disabled' : ''}>CANCEL PREVIEW</button></div>
      <p class="skin-foot">${!have && bank() < chosen.price ? `${chosen.price - bank()} more coins needed. ` : ''}One purchase unlocks this skin's colour, stripe and finish editor for this car. Saved on this device; no cash value.${car.id === 'rush-one' ? ' Equip Factory to use your Customs paint.' : ''}</p>`;
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('[data-skin]')) button.onclick = () => {
      this.selected = Number(button.dataset.skin); this.draft = skinDesign(car.id, this.selected, car.color);
      this.editing = this.selected > 0;
      this.note = 'PREVIEW · Not equipped. Colours and finish do not change performance.';
      this.preview(car.id, this.draft); this.render();
      this.root.querySelector<HTMLButtonElement>(`[data-skin="${this.selected}"]`)?.focus({ preventScroll: true });
    };
    const update = () => {
      this.note = 'UNSAVED DESIGN · Save & equip to race in this skin.';
      this.root.querySelector('#skin-status')!.textContent = this.note;
      this.preview(car.id, { ...this.draft });
    };
    for (const input of this.root.querySelectorAll<HTMLInputElement>('[data-skin-color]')) input.oninput = () => {
      this.draft[input.dataset.skinColor as 'color' | 'accent'] = parseInt(input.value.slice(1), 16); update();
    };
    this.root.querySelector<HTMLSelectElement>('[data-skin-option="pattern"]')?.addEventListener('change', e => {
      this.draft.pattern = (e.target as HTMLSelectElement).value as SkinDesign['pattern'];
      this.root.querySelector<HTMLInputElement>('[data-skin-color="accent"]')!.disabled = this.draft.pattern === 'solid'; update();
    });
    this.root.querySelector<HTMLSelectElement>('[data-skin-option="finish"]')?.addEventListener('change', e => {
      this.draft.finish = (e.target as HTMLSelectElement).value as SkinDesign['finish']; update();
    });
    this.root.querySelector<HTMLButtonElement>('[data-skin-cancel]')!.onclick = () => {
      this.editing = false;
      this.selected = activeSkinIndex(car.id); this.draft = skinDesign(car.id, this.selected, car.color);
      this.note = 'Preview cancelled. Your equipped skin is unchanged.'; this.preview(car.id, null); this.render();
    };
    this.root.querySelector<HTMLButtonElement>('[data-skin-save]')!.onclick = async () => {
      if (this.busy || !this.available) return;
      const index = this.selected, design = { ...this.draft };
      this.busy = true; this.render();
      try {
        if (!have && !(await requireShopSession())) return;
        if (this.car.id !== car.id || this.selected !== index) return;
        const error = saveSkinDesign(car.id, index, design);
        this.note = error ?? `${chosen.name} equipped. ${have ? 'Design saved with no extra charge.' : 'Yours to customize whenever you like.'}`;
        if (!error) { this.preview(car.id, null); this.changed(); }
      } finally { this.busy = false; this.render(); }
    };
  }
}
