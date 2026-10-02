/**
 * Menus with a controller: the D-pad or stick moves a highlight between the
 * buttons on screen, ✕ presses the highlighted one, ○ goes back.
 *
 * It is spatial: from the highlighted button, a direction picks the nearest
 * button whose centre lies that way. Only buttons in the topmost visible
 * overlay are candidates, so a panel open over the menu takes the controller.
 */

const CANDIDATES = 'button:not([disabled]), [role="button"], .setup-pill, input[type="range"]';

export class PadMenu {
  private focused: HTMLElement | null = null;
  private badge: HTMLElement;

  constructor() {
    this.badge = document.createElement('div');
    this.badge.id = 'pad-badge';
    this.badge.hidden = true;
    document.body.appendChild(this.badge);
    const style = document.createElement('style');
    style.textContent = `
      .pad-focus { outline: 3px solid #22e6ff !important; outline-offset: 3px; box-shadow: 0 0 18px rgba(34,230,255,.55) !important; }
      #pad-badge { position: fixed; right: 12px; bottom: calc(max(12px, env(safe-area-inset-bottom)) + 4px); z-index: 50;
        padding: 6px 10px; border-radius: 999px; font: 800 10px/1.2 -apple-system, sans-serif; letter-spacing: .08em;
        color: #e9f1ff; background: rgba(8,10,22,.85); border: 1px solid rgba(34,230,255,.5); pointer-events: none; }
      #pad-badge[hidden] { display: none; }`;
    document.head.appendChild(style);
  }

  /** Show whether a controller is seen, and how to use it here. */
  status(name: string | null, inMenu: boolean): void {
    this.badge.hidden = !name || !inMenu;
    if (name && inMenu) this.badge.textContent = '🎮 ✕ SELECT · ○ BACK';
    if (!inMenu) this.clear();
  }

  /** The overlay the controller is working in: the last visible one. */
  private layer(): ParentNode {
    // overlays, and pop-ups that mark themselves as a layer (the radio panel)
    const open = [...document.querySelectorAll<HTMLElement>('.overlay, [data-pad-layer]')]
      // not offsetParent: it is null for position: fixed, which every overlay is
      .filter((el) => !el.classList.contains('hidden') && !el.hidden && el.getClientRects().length > 0
        && getComputedStyle(el).visibility !== 'hidden');
    return open[open.length - 1] ?? document;
  }

  private candidates(): HTMLElement[] {
    return [...this.layer().querySelectorAll<HTMLElement>(CANDIDATES)].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
    });
  }

  private focus(el: HTMLElement | null): void {
    this.focused?.classList.remove('pad-focus');
    this.focused = el;
    if (!el) return;
    el.classList.add('pad-focus');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  clear(): void {
    this.focus(null);
  }

  /** Move the highlight: dx, dy each -1, 0 or 1. */
  move(dx: number, dy: number): void {
    const all = this.candidates();
    if (!all.length) return;
    if (!this.focused || !all.includes(this.focused)) {
      // start on the screen's main button when there is one
      this.focus(all.find((el) => el.id === 'btn-play' || el.classList.contains('stage-cta')) ?? all[0]);
      return;
    }
    const from = this.focused.getBoundingClientRect();
    const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
    let best: HTMLElement | null = null, bestScore = Infinity;
    for (const el of all) {
      if (el === this.focused) continue;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2 - fx, y = r.top + r.height / 2 - fy;
      const along = x * dx + y * dy;              // how far in the pressed direction
      if (along <= 4) continue;
      // a button in the same row (for ←/→) or column (for ↑/↓) wins over one
      // that is nearer but off to the side: → from a 2×2 grid goes across, not up
      const lined = dx
        ? r.bottom > from.top + 2 && r.top < from.bottom - 2
        : r.right > from.left + 2 && r.left < from.right - 2;
      const across = lined ? 0 : Math.abs(x * dy) + Math.abs(y * dx);
      const score = along + across * 2.5 + (lined ? 0 : 60);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) this.focus(best);
  }

  /** ✕: press the highlighted button (or highlight the main one first). */
  accept(): void {
    const all = this.candidates();
    if (!this.focused || !all.includes(this.focused)) {
      this.move(0, 0);
      return;
    }
    const el = this.focused;
    if (el instanceof HTMLInputElement && el.type === 'range') return; // sliders use ←/→
    el.click();
    // the screen probably changed: re-home on its main button next move
    window.setTimeout(() => {
      if (this.focused && !this.candidates().includes(this.focused)) this.focus(null);
    }, 60);
  }

  /** ○: the visible back / close / cancel button, if the screen has one. */
  back(): void {
    const all = this.candidates();
    const back = all.find((el) => /back|close|cancel|skip|menu/i.test(`${el.id} ${el.className} ${el.getAttribute('aria-label') ?? ''} ${el.textContent ?? ''}`)
      && !/play|race/i.test(el.id));
    back?.click();
  }
}
