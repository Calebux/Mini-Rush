import { componentStats, type Recipe } from './components';
import type { Part } from './workshop';

export interface PartStory { title: string; tag: string; line: string; use: string; accent: string; kind: string }
const stories: Record<string, Omit<PartStory, 'title' | 'kind'>> = {
  'street-slick': { tag: 'CORNER SPECIALIST', line: 'Hold the line.', use: 'Commit to the corner. Extra grip helps you hold your steering line, with a little less speed on the straight.', accent: '#b8d49b' },
  'slide-compound': { tag: 'SLIDE / BOOST', line: 'Let the rear talk.', use: 'A looser car with longer boost windows. Catch the slide, straighten up, then spend that extra nitro.', accent: '#eea487' },
  'low-drag': { tag: 'STRAIGHT-LINE SPECIALIST', line: 'Chase the horizon.', use: 'Carry more speed down the straight. Give yourself room for the corner: less grip demands a calmer steering hand.', accent: '#adcbd1' },
  'street-turbo': { tag: 'TOP-END POWER', line: 'Find another gear.', use: 'Build speed on long straights. The slower launch asks you to protect your momentum out of corners.', accent: '#e5bd83' },
  'sprint-block': { tag: 'LAUNCH SPECIALIST', line: 'Own the exit.', use: 'Get moving quickly after a tight corner. The stronger launch comes with a lower top speed.', accent: '#eea487' },
  'endurance-core': { tag: 'BOOST ENDURANCE', line: 'Stay in the chase.', use: 'Stretch each boost window. Allow more space to accelerate before you make your move.', accent: '#b8d49b' },
  'short-ratio': { tag: 'CLOSE-RATIO DRIVE', line: 'Exit. Launch. Repeat.', use: 'A launch-focused build for repeated slow corners. Trade away some straight-line speed.', accent: '#eea487' },
  'long-ratio': { tag: 'LONG-RATIO DRIVE', line: 'Keep it rolling.', use: 'Let the car carry speed. Slower acceleration rewards clean exits and fewer interruptions.', accent: '#adcbd1' },
  'boost-ratio': { tag: 'BOOST-MATCHED DRIVE', line: 'Make the boost last.', use: 'Extend boost duration at the expense of cruising speed. Choose your attack window carefully.', accent: '#b8d49b' },
  'long-bottle': { tag: 'LONG BOOST WINDOW', line: 'One longer push.', use: 'More time on nitro, less acceleration without it. Save the charge for a clear stretch of road.', accent: '#b8d49b' },
  'light-bottle': { tag: 'LIGHT / QUICK LAUNCH', line: 'First off the line.', use: 'A livelier launch with a shorter boost window. Make each burst count.', accent: '#eea487' },
  'aero-bottle': { tag: 'SUSTAINED SPEED', line: 'Speed that stays.', use: 'Gain straight-line speed, but spend fewer seconds on each boost.', accent: '#adcbd1' }
};
export function recipeStory(r: Recipe): PartStory {
  return { title: r.name, kind: r.slot, ...stories[r.id] };
}
export function styleStory(p: Part): PartStory {
  const category = { body: ['BODY / SILHOUETTE', 'Make an entrance.'], wheels: ['WHEELS / FINISH', 'Set it in motion.'], wing: ['TAIL / AERO STYLE', 'Leave a signature.'], paint: ['PAINT / PERSONALITY', 'Wear your colours.'], tyres: ['TIRES / CHARACTER', 'Choose your attitude.'], power: ['POWER / DELIVERY', 'Find your rhythm.'] }[p.slot];
  return { title: p.name, tag: category[0], line: category[1], use: p.detail,
    accent: p.color !== undefined ? `#${p.color.toString(16).padStart(6, '0')}` : p.id === 'slide' || p.id === 'sprint' ? '#eea487' : '#d7c19b',
    kind: p.slot === 'tyres' ? 'tires' : p.slot === 'power' ? 'engine' : p.slot };
}
export const escapePartText = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

let artId = 0;
/** Small inline illustrations share the same visual vocabulary as the 3D specimen. */
export function partArt(kind: string, accent: string, variant = ''): string {
  const id = `part-metal-${++artId}`;
  let shape = '';
  if (kind === 'tires' || kind === 'wheels') {
    const slide = variant.includes('slide'), fast = variant === 'low-drag';
    const spokes = variant === 'turbine' ? 10 : fast ? 8 : 5;
    shape = `<ellipse cx="94" cy="84" rx="51" ry="7" fill="#000" opacity=".5"/><g transform="translate(90 49) rotate(-18)"><circle r="36" fill="#121311" stroke="#42463f" stroke-width="2"/><circle r="31" fill="none" stroke="${accent}" stroke-width="1"/><circle r="25" fill="url(#${id})"/><circle r="20" fill="#171b1b"/>${Array.from({ length: fast ? 8 : 5 }, (_, i) => `<path d="M-3 -5 L-5 -21 L1 -23 L4 -5Z" transform="rotate(${i * 360 / (fast ? 8 : 5)})" fill="url(#${id})"/>`).join('')}<circle r="7" fill="${accent}"/><circle r="3" fill="#363a36"/>${Array.from({ length: slide ? 16 : 10 }, (_, i) => `<path d="M${slide ? '-6' : '-2'} -33 l${slide ? '9 -3' : '4 -2'}" stroke="#777a70" stroke-width="1.5" transform="rotate(${i * 360 / (slide ? 16 : 10)})"/>`).join('')}</g>`;
    if (variant === 'disc') shape += `<g transform="translate(90 49) rotate(-18)"><circle r="25" fill="#e3e6dc" stroke="#929d93" stroke-width="2"/><circle r="7" fill="#9ca99e"/><circle r="3" fill="#232a24"/>${Array.from({ length: 5 }, (_, i) => `<circle cx="0" cy="-12" r="2" fill="#3c483f" transform="rotate(${i * 72})"/>`).join('')}</g>`;
    else if (variant === 'turbine') shape += `<g transform="translate(90 49) rotate(-18)"><circle r="24" fill="#171b1b"/>${Array.from({ length: spokes }, (_, i) => `<path d="M-2 -4L-5 -22L0 -24L3 -4Z" fill="#d7b96d" transform="rotate(${i * 360 / spokes})"/>`).join('')}<circle r="6" fill="#d7b96d"/></g>`;
  } else if (kind === 'nitro') {
    shape = `<g transform="rotate(24 90 50)">${[67, 96].map(x => `<rect x="${x}" y="20" width="24" height="62" rx="12" fill="url(#${id})"/><rect x="${x + 1}" y="34" width="22" height="28" rx="3" fill="${accent}"/><path d="M${x + 12} 20v-9m-7 0h14" stroke="#c7ceca" stroke-width="5"/><path d="M${x + 1} 30h22m-22 39h22" stroke="#242b29" stroke-width="4"/>`).join('')}</g>`;
  } else if (kind === 'gearbox') {
    shape = `<g transform="translate(90 50) rotate(-20)"><path d="M-45 -20L20 -16L40 -7V7L20 16L-45 20Z" fill="url(#${id})" stroke="#d8ded7"/><path d="M-37 -20v40m11-38v36m11-34v32m11-30v28m11-27v26" stroke="#343d38" stroke-width="5"/><path d="M-56 0H-40M35 0h25" stroke="${accent}" stroke-width="8"/></g>`;
  } else if (kind === 'engine') {
    shape = `<g transform="translate(90 51) rotate(-12)"><path d="M-40 -12L-10 -31L39 -10V27L9 40L-40 18Z" fill="#323a35" stroke="#8c9990"/><path d="M-36 -15L-12 -28L12 -15L-12 0Z M-5 1L20 -12L39 -3L14 12Z" fill="${accent}"/><path d="M-30 -13l15 7m-6-12l15 7m-3 15l15 7m-5-14l15 7" stroke="#f3e9d5" stroke-width="3"/><circle cx="39" cy="19" r="15" fill="url(#${id})"/><circle cx="39" cy="19" r="8" fill="#151a18"/></g>`;
  } else if (kind === 'wing') {
    shape = `<path d="M38 30L131 21L151 39L49 52Z" fill="url(#${id})" stroke="${accent}" stroke-width="2"/><path d="M61 50v25h15V47m40-5v24h15V40" fill="#333a35"/><path d="M37 24v22m114-17v21" stroke="${accent}" stroke-width="5"/>`;
    if (variant === 'clean') shape = `<path d="M32 65Q47 40 91 39L144 54L149 65Z" fill="url(#${id})" stroke="${accent}" stroke-width="2"/><path d="M43 62H135" stroke="#a24e3b" stroke-width="3"/>`;
    if (variant === 'duck') shape = `<path d="M32 65Q47 40 91 39L144 54L149 65Z" fill="url(#${id})"/><path d="M45 40L136 29L146 44L52 54Z" fill="${accent}" stroke="#e7dfca" stroke-width="2"/>`;
  } else if (kind === 'paint') {
    shape = `<ellipse cx="90" cy="82" rx="44" ry="6" fill="#000" opacity=".5"/><path d="M53 55Q49 16 90 14Q131 16 127 55L119 77H61Z" fill="${accent}"/><path d="M62 43Q69 19 91 21Q106 21 115 32" stroke="#fff" stroke-width="5" opacity=".65" fill="none"/><path d="M59 61Q90 78 122 59" stroke="#000" opacity=".25" stroke-width="8" fill="none"/>`;
  } else {
    shape = `<path d="M21 63L36 44L65 35L85 20H118L143 43L161 52V70H21Z" fill="url(#${id})" stroke="${accent}" stroke-width="2"/><path d="M73 36L90 24H115L134 42Z" fill="#172121"/><path d="M24 57h29m85-6h18" stroke="${accent}" stroke-width="3"/><circle cx="53" cy="68" r="14" fill="#161b18"/><circle cx="53" cy="68" r="7" fill="#9fa99e"/><circle cx="134" cy="68" r="14" fill="#161b18"/><circle cx="134" cy="68" r="7" fill="#9fa99e"/>`;
    if (variant === 'wide') shape += `<path d="M33 67Q34 46 53 47Q71 47 73 67M114 67Q115 46 134 47Q155 47 155 67" fill="none" stroke="${accent}" stroke-width="5"/><path d="M72 70H115M19 72H33M155 72H166" stroke="#b4bfb3" stroke-width="5"/>`;
    if (variant === 'rally') shape += `<path d="M80 19V11H123V23M88 11V19M114 11V19" fill="none" stroke="#a4afa4" stroke-width="3"/>${[26, 35, 44, 53].map(x => `<circle cx="${x}" cy="51" r="4" fill="#f2df9b" stroke="#454b40" stroke-width="1.5"/>`).join('')}`;
  }
  return `<svg class="ws-part-art" viewBox="0 0 180 100" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x2=".7" y2="1"><stop stop-color="#f0eee1"/><stop offset=".38" stop-color="#7c8b83"/><stop offset=".6" stop-color="#343e38"/><stop offset="1" stop-color="#aeb8ae"/></linearGradient></defs>${shape}</svg>`;
}
export function recipeDossier(r: Recipe): string {
  const story = recipeStory(r), esc = escapePartText;
  return `<div class="ws-dossier" style="--part-accent:${story.accent}"><small>${story.tag}</small><h3>${story.line}</h3><p>${story.use}</p><div class="ws-tradeoffs">${(['speed', 'accel', 'grip', 'nitro'] as const).filter(k => r[k]).map(k => `<span data-direction="${r[k] > 0 ? 'gain' : 'cost'}"><b>${r[k] > 0 ? '+' : '−'}${Math.abs(r[k])}%</b>${({ speed: 'TOP SPEED', accel: 'LAUNCH', grip: 'GRIP', nitro: 'BOOST DURATION' })[k]}</span>`).join('')}</div><span class="ws-sr">${esc(componentStats(r))}</span></div>`;
}

/** Stage copy is informational: browsing never applies driving stats or buys a part. */
export function spotlightPart(story: PartStory, recipe?: Recipe): void {
  const stage = document.getElementById('workshop-car-stage')!;
  const key = recipe?.id ?? `style-${story.title}`;
  const changed = stage.dataset.spotlight !== key;
  stage.dataset.spotlight = key;
  stage.dataset.take = key;
  stage.dataset.part = recipe?.id ?? '';
  if (changed) stage.dataset.view = recipe ? 'part' : 'car';
  stage.style.setProperty('--part-accent', story.accent);
  const root = document.getElementById('workshop-spotlight')!;
  root.innerHTML = `<small>${escapePartText(story.tag)}</small><strong>${escapePartText(story.title)}</strong><p>${escapePartText(story.line)}</p><span>${recipe ? 'COMPONENT PREVIEW · INSTALL TO CHANGE YOUR BUILD' : 'BUILD PREVIEW · SAVE TO EQUIP'}</span>`;
  if (changed && !matchMedia('(prefers-reduced-motion: reduce)').matches)
    root.animate([{ opacity: .35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: 'ease-out' });
  document.getElementById('workshop-view-controls')!.hidden = !recipe;
  syncPartView();
}
export function syncPartView(): void {
  const stage = document.getElementById('workshop-car-stage')!;
  const caption = document.querySelector('#workshop-spotlight > span');
  if (caption) caption.textContent = stage.dataset.part
    ? stage.dataset.view === 'part' ? 'COMPONENT PREVIEW · INSTALL TO CHANGE YOUR BUILD' : 'CURRENT BUILD · CONFIRMED LOADOUT'
    : 'BUILD PREVIEW · SAVE TO EQUIP';
  for (const b of stage.querySelectorAll<HTMLButtonElement>('[data-part-view]'))
    b.setAttribute('aria-pressed', String(b.dataset.partView === stage.dataset.view));
  stage.querySelector('.showroom-hint')!.textContent = stage.dataset.view === 'part' ? 'DRAG TO INSPECT ↔' : 'DRAG TO ROTATE ↔';
  stage.setAttribute('aria-label', stage.dataset.view === 'part' ? 'Component display model. Drag or use arrow keys to inspect. Preview does not change the car.' : 'Car preview. Drag or use arrow keys to rotate.');
}
