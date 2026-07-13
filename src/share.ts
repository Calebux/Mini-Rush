// Post-race share card. Renders the run onto a canvas and hands it to the
// OS share sheet (Web Share API with files); browsers without it get a
// plain download. Must be called from a user gesture.

export interface RunCard {
  place: number;
  time: number;
  zombies: number;
  coins: number;
  score: number;
  style: number;
  laps: number;
  car: string;
  map: string;
  mode: string;
  daily: boolean;
  busted: boolean;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const SUFFIX = ['st', 'nd', 'rd', 'th'];

export async function shareRun(run: RunCard): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, run);

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) return;
  const title = run.daily ? 'MiniRush — Daily Run' : 'MiniRush — Outbreak GP';
  const text = run.busted
    ? `I got BUSTED after ${run.time.toFixed(1)}s in MiniRush 🚔 — think you can escape?`
    : `${run.place}${SUFFIX[Math.min(run.place, 4) - 1]} in ${run.map} — ${run.time.toFixed(1)}s, ` +
      `${run.zombies} zombies, score ${run.score}. Beat that! 🏁`;
  const file = new File([blob], 'minirush-run.png', { type: 'image/png' });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title, text });
      return;
    } catch { /* user closed the sheet — fall through to nothing */ }
    return;
  }
  // desktop fallback: save the card
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'minirush-run.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function draw(ctx: CanvasRenderingContext2D, run: RunCard): void {
  const W = 1080, H = 1080;

  // night-race gradient + vignette
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#101632');
  bg.addColorStop(0.55, '#0b1020');
  bg.addColorStop(1, '#05070f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // speedline streaks
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 14; i++) {
    const y = 90 + i * 70;
    ctx.beginPath();
    ctx.moveTo(-40, y + 60);
    ctx.lineTo(W + 40, y - 60);
    ctx.stroke();
  }

  // checkered strip up top
  const sq = 36;
  for (let x = 0; x < W / sq; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 ? '#e8ecff' : '#0b1020';
      ctx.fillRect(x * sq, y * sq, sq, sq);
    }
  }

  ctx.textAlign = 'center';

  // logo
  ctx.fillStyle = '#fff';
  ctx.font = `900 92px ${FONT}`;
  ctx.fillText('MiniRush', W / 2, 210);
  ctx.fillStyle = '#fcff52';
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(run.daily ? '⚡ DAILY RUN' : 'OUTBREAK GP', W / 2, 262);

  // the big number
  if (run.busted) {
    ctx.fillStyle = '#ff5252';
    ctx.font = `900 180px ${FONT}`;
    ctx.fillText('BUSTED', W / 2, 510);
  } else {
    ctx.fillStyle = run.place === 1 ? '#fcff52' : '#fff';
    ctx.font = `900 260px ${FONT}`;
    const suffix = SUFFIX[Math.min(run.place, 4) - 1];
    ctx.fillText(`${run.place}`, W / 2 - 40, 540);
    ctx.font = `900 90px ${FONT}`;
    ctx.fillText(suffix.toUpperCase(), W / 2 + 110, 460);
  }

  // where + how
  ctx.fillStyle = '#9adfff';
  ctx.font = `800 44px ${FONT}`;
  ctx.fillText(`${run.map} · ${run.mode}`, W / 2, 620);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(`${run.car} · ${run.laps} LAP${run.laps === 1 ? '' : 'S'}`, W / 2, 672);

  // stat row
  const stats: [string, string][] = [
    [run.time.toFixed(1) + 's', 'TIME'],
    [String(run.zombies), 'ZOMBIES'],
    [String(run.style), 'STYLE'],
    [String(run.score), 'SCORE']
  ];
  const cw = 210, gap = 24;
  const x0 = (W - stats.length * cw - (stats.length - 1) * gap) / 2;
  stats.forEach(([v, k], i) => {
    const x = x0 + i * (cw + gap);
    ctx.fillStyle = 'rgba(255,255,255,.06)';
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, 730, cw, 150, 20);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `900 52px ${FONT}`;
    ctx.fillText(v, x + cw / 2, 800);
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(k, x + cw / 2, 848);
  });

  // footer
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText('🧟 CAN YOU BEAT IT? 🏁', W / 2, 980);
}
