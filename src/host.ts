/**
 * Android in-app WebViews can lay the page out behind the system navigation
 * bar while `env(safe-area-inset-bottom)` still reports 0, which leaves the
 * bottom controls — the garage's buy button, the race pedals — under the bar.
 * `--safe-bottom` keeps a floor once the page is tagged `android-inapp`.
 *
 * The tag is set from the boot script in index.html when the user agent says
 * WebView, and from here when the page covers the whole display.
 */
/**
 * True when the page appears to cover the whole display — the signature of a
 * WebView laid out edge to edge, behind the status and navigation bars. A
 * browser keeps its own chrome and the navigation bar outside the viewport, so
 * there `innerHeight` stays clearly short of the screen.
 */
const coversDisplay = (): boolean =>
  !!window.screen?.height && window.innerHeight >= window.screen.height - 4;

/**
 * How much of the page sits below what the WebView is actually showing.
 *
 * An in-app browser with a collapsing top bar lays the page out at its full
 * height while showing less of it, so anything pinned to the bottom — the
 * garage's buy button, the pedals — starts off the screen until the player
 * swipes to collapse the bar. `--vv-bottom` carries that difference, and
 * `--safe-bottom` keeps the controls above it.
 */
export function trackVisibleViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const sync = (): void => {
    const hidden = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--vv-bottom', `${hidden}px`);
  };
  sync();
  vv.addEventListener('resize', sync);
  vv.addEventListener('scroll', sync);
  window.addEventListener('orientationchange', () => setTimeout(sync, 250));
}

export function watchAndroidHost(): void {
  if (typeof window === 'undefined' || !/Android/i.test(navigator.userAgent)) return;
  // edge-to-edge: the page sits behind the status and navigation bars
  if (coversDisplay()) document.documentElement.classList.add('android-inapp');
}
