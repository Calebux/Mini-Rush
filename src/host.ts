/**
 * Android in-app WebViews can lay the page out behind the system navigation
 * bar while `env(safe-area-inset-bottom)` still reports 0, which leaves the
 * bottom controls — the garage's buy button, the race pedals — under the bar.
 * `--safe-bottom` keeps a floor once the page is tagged `android-inapp`.
 *
 * The tag is set from the boot script in index.html when the user agent says
 * WebView, and from here once the Nimiq host object turns up: Nimiq Pay can
 * inject it well after load, and not every WebView admits to being one in its
 * user agent, so waiting for the host is the reliable signal.
 */
const HOST_WAIT_MS = 30000;

/**
 * True when the page appears to cover the whole display — the signature of a
 * WebView laid out edge to edge, behind the status and navigation bars. A
 * browser keeps its own chrome and the navigation bar outside the viewport, so
 * there `innerHeight` stays clearly short of the screen.
 */
const coversDisplay = (): boolean =>
  !!window.screen?.height && window.innerHeight >= window.screen.height - 4;

const hostPresent = (): boolean => {
  const w = window as unknown as { nimiq?: unknown; nimiqPay?: unknown };
  return !!w.nimiq || !!w.nimiqPay;
};

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
  const mark = (): void => { document.documentElement.classList.add('android-inapp'); };
  // edge-to-edge is visible immediately; the host object can take seconds
  if (coversDisplay()) { mark(); return; }
  const tag = (): boolean => {
    if (!hostPresent()) return false;
    mark();
    return true;
  };
  if (tag()) return;
  const started = Date.now();
  const timer = window.setInterval(() => {
    if (tag() || Date.now() - started > HOST_WAIT_MS) window.clearInterval(timer);
  }, 400);
}
