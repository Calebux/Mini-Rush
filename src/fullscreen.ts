/**
 * Fullscreen for the web version. Inside Nimiq Pay the game already fills the
 * screen, and iPhone Safari only lets videos go fullscreen (it reports
 * fullscreenEnabled = false), so the buttons hide themselves in both.
 */

type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const doc = document as FsDocument;

const inNimiqPay = (): boolean => 'nimiq' in window || 'nimiqPay' in window;

export function fullscreenAvailable(): boolean {
  return !inNimiqPay() && !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
}

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement || doc.webkitFullscreenElement);
}

export function toggleFullscreen(): void {
  if (!fullscreenAvailable()) return;
  if (isFullscreen()) {
    void (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    return;
  }
  const root = document.documentElement as FsElement;
  // a refused request (no user gesture, a policy) just leaves the page as it is
  void Promise.resolve(root.requestFullscreen?.() ?? root.webkitRequestFullscreen?.()).catch(() => {});
}

/** Wire a button: shown only where fullscreen works, its label follows the state. */
export function bindFullscreenButton(button: HTMLElement, labels = { on: '⛶', off: '⛶' }): void {
  const refresh = () => {
    button.hidden = !fullscreenAvailable();
    const on = isFullscreen();
    button.textContent = on ? labels.off : labels.on;
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Fullscreen');
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFullscreen();
  });
  document.addEventListener('fullscreenchange', refresh);
  document.addEventListener('webkitfullscreenchange', refresh);
  refresh();
  // Nimiq Pay may inject its provider a moment after load
  window.setTimeout(refresh, 1500);
}
