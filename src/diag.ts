/**
 * `?diag=1` — a read-only panel of the numbers that decide how the layout fits
 * a phone: viewport against screen, the safe-area insets the browser reports,
 * and where the garage's bottom button actually lands. A screenshot of this is
 * enough to tell a navigation bar covering the controls from a layout that is
 * genuinely too tall, which nothing on a desktop can reproduce.
 */
function probeInset(side: 'top' | 'bottom'): string {
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;left:0;width:1px;height:env(safe-area-inset-${side},0px);visibility:hidden`;
  document.body.appendChild(probe);
  const px = Math.round(probe.getBoundingClientRect().height);
  probe.remove();
  return `${px}px`;
}

export function showDiagnostics(): void {
  const panel = document.createElement('pre');
  panel.id = 'diag';
  panel.style.cssText = [
    'position:fixed', 'left:8px', 'right:8px', 'top:8px', 'z-index:99',
    'margin:0', 'padding:10px', 'border-radius:10px', 'background:rgba(6,8,20,.92)',
    'border:1px solid #fcff52', 'color:#fcff52', 'font:11px/1.5 ui-monospace,monospace',
    'white-space:pre-wrap', 'pointer-events:none'
  ].join(';');
  document.body.appendChild(panel);

  const render = (): void => {
    const root = document.documentElement;
    const buy = document.getElementById('btn-market-nim')?.getBoundingClientRect();
    const start = document.getElementById('btn-garage-done')?.getBoundingClientRect();
    const cta = buy && !buy.height ? start : buy ?? start;
    const safeBottom = getComputedStyle(root).getPropertyValue('--safe-bottom').trim();
    panel.textContent = [
      `viewport   ${innerWidth} x ${innerHeight}`,
      `screen     ${screen.width} x ${screen.height}   dpr ${devicePixelRatio}`,
      `visual     ${Math.round(visualViewport?.width ?? 0)} x ${Math.round(visualViewport?.height ?? 0)}`,
      `inset top  ${probeInset('top')}   bottom ${probeInset('bottom')}`,
      `--safe-bottom ${safeBottom}`,
      `classes    ${root.className || '(none)'}`,
      `host       nimiq=${!!(window as unknown as { nimiq?: unknown }).nimiq}`,
      `cta        ${cta ? `${Math.round(cta.top)}→${Math.round(cta.bottom)} of ${innerHeight}` : '(not on screen)'}`,
      `gap below  ${cta ? Math.round(innerHeight - cta.bottom) : '—'}px`,
      `ua ${navigator.userAgent}`
    ].join('\n');
  };
  render();
  setInterval(render, 500);
  addEventListener('resize', render);
}
