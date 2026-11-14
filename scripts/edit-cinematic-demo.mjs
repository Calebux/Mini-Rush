// Edit real captures into a captioned, 90-second 1080p demo.
// Requires ffmpeg, the cinematic capture, and the verified Nov 13 testnet recording.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const source = '/tmp/minirush-cinematic-demo';
const evidenceDir = '/tmp/minirush-economy-demo';
const out = resolve('output/cinematic-demo');
const finishOnly = process.argv.includes('--finish-only');
await mkdir(`${out}/edit`, { recursive: true });
const capture = JSON.parse(await readFile(`${source}/capture.json`, 'utf8'));
const oldEvidence = JSON.parse(await readFile(`${evidenceDir}/evidence.json`, 'utf8'));
const shots = Object.fromEntries(capture.shots.map(s => [s.id, s]));
const plan = [
  { id:'hero', duration:5, tag:'MINIRUSH', title:'Race. Build. Trade.', sub:'A racing economy built on NEAR.', zoom:[1.02,1.12], center:[.35,.4] },
  { id:'race-chase', duration:6, offset:4, tag:'01 / THE DRIVE', title:'Start with the race.', sub:'Lagos streets. Real-time arcade racing.', zoom:[1,1], center:[.5,.5] },
  { id:'garage', duration:5, tag:'02 / YOUR GARAGE', title:'Choose your machine.', sub:'A collection of cars. A build that is yours.', zoom:[1,1.06], center:[.48,.5] },
  { id:'skin', duration:8, offset:.5, tag:'03 / SKIN STUDIO', title:'Make it unmistakable.', sub:'Colours. Racing stripes. Satin or gloss.\nCustomization preview · cosmetic only.', zoom:[1,1.08], center:[.65,.4] },
  { id:'custom', duration:5, tag:'04 / THE CUSTOMS SHOP', title:'Shape your signature.', sub:'Preview bodywork, wheels, wings and paint.', zoom:[1.02,1.16], center:[.4,.52] },
  { id:'slick', duration:6, tag:'05 / PERFORMANCE', title:'Every part is a choice.', sub:'Street slicks: more grip, less top speed.', zoom:[1.04,1.22], center:[.38,.46] },
  { id:'slide', duration:4, tag:'05 / PERFORMANCE', title:'Build for the slide.', sub:'Inspect the part. Read the trade-offs.', zoom:[1.12,1.22], center:[.38,.46] },
  { id:'turbo', duration:4, tag:'05 / PERFORMANCE', title:'Find your next upgrade.', sub:'Engines, gearboxes, tires and nitro.', zoom:[1.04,1.18], center:[.38,.46] },
  { id:'market', duration:8, offset:1, tag:'06 / THE MARKET', title:'A market with its own pulse.', sub:'Dealer prices and limited editions.\nPublic NEAR testnet data.', zoom:[1,1.06], center:[.55,.45] },
  { id:'race-low', duration:5, tag:'07 / BACK ON TRACK', title:'Low. Fast. Close.', sub:'Switch camera angles while you race.', zoom:[1,1], center:[.5,.5] },
  { id:'race-high', duration:4, tag:'07 / BACK ON TRACK', title:'Read the whole field.', sub:'Overhead view.', zoom:[1,1], center:[.5,.5] },
  { id:'race-driver', duration:4, tag:'07 / BACK ON TRACK', title:'Take the driver’s view.', sub:'Actual gameplay at normal speed.', zoom:[1,1], center:[.5,.5] },
  { id:'reward', duration:6, proof:true, start:105.0, available:6, crop:[1120,630,240,210], tag:'08 / THE ECONOMY LOOP', title:'Race. Earn materials.', sub:'Confirmed race salvage from the recorded testnet run.', zoom:[1,1.06], center:[.7,.4] },
  { id:'craft', duration:6, proof:true, start:215.9, available:2.5, crop:[1120,630,320,240], tag:'08 / THE ECONOMY LOOP', title:'Craft a numbered part.', sub:'Low-drag compound #2.\nInstall it—or supply a dealer.', zoom:[1,1.12], center:[.82,.5] },
  { id:'sale', duration:8, proof:true, start:227.3, available:2.5, crop:[1120,630,320,270], tag:'08 / THE ECONOMY LOOP', title:'Demand becomes a payday.', sub:'Mama T bought part #2 for 85 RUSH after fees.\nOwnership changed. Maker credit stayed.', zoom:[1,1.08], center:[.85,.58] },
  { id:'outro', duration:6, tag:'PLAY MINIRUSH', title:'The economy is the gameplay.', sub:'minirush.site', zoom:[1.06,1.15], center:[.35,.4] }
];
if (plan.reduce((n,s)=>n+s.duration,0) !== 90) throw new Error('Edit must be 90 seconds.');
for (const s of plan) if (!s.proof && !shots[s.id]) throw new Error(`Missing capture: ${s.id}`);
const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
if (!finishOnly) {
const browser = await chromium.launch({ channel:'chrome', headless:true });
try {
  const page = await browser.newPage({ viewport:{width:1920,height:1080}, deviceScaleFactor:1 });
  for (const [i,s] of plan.entries()) {
    await page.setContent(`<html><head><style>
      *{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;background:transparent;color:#f1efe9;font-family:Arial,sans-serif}
      .shade{position:absolute;left:0;bottom:0;width:1260px;height:370px;background:linear-gradient(0deg,#0c0e0cfa 0%,#0c0e0ce8 35%,transparent 100%);mask-image:linear-gradient(90deg,#000 65%,transparent)}
      .copy{position:absolute;left:70px;bottom:52px;width:1080px;text-shadow:0 2px 14px #0009}
      .tag{display:flex;gap:18px;align-items:center;color:#d7c19b;font-size:18px;letter-spacing:4px;font-weight:700}
      .tag:before{content:'';width:44px;height:3px;background:#d7c19b}
      h1{font-size:${s.id==='hero'?82:s.id==='outro'?62:52}px;letter-spacing:-2px;line-height:1.08;margin:16px 0 12px;font-weight:800}
      p{margin:0;font-size:${s.id==='outro'?34:23}px;line-height:1.5;color:#e0dfd5;white-space:pre-line}
      .proof{position:absolute;left:70px;top:36px;background:#10120fe8;border:1px solid #d7c19b66;padding:12px 18px;color:#e8ddc8;font-size:15px;font-weight:700;letter-spacing:2px}
      .bug{position:absolute;right:48px;bottom:28px;font-size:13px;font-weight:700;letter-spacing:2px;color:#f1efe9;background:#10120fbf;padding:9px 12px}
    </style></head><body><div class="shade"></div>${s.proof?'<div class="proof">RECORDED TESTNET TRANSACTION · 13 NOV 2026</div>':''}<div class="copy"><div class="tag">${esc(s.tag)}</div><h1>${esc(s.title)}</h1><p>${esc(s.sub)}</p></div><div class="bug">MINIRUSH / NEAR TESTNET</div></body></html>`);
    await page.screenshot({ path:`${out}/edit/overlay-${i}.png`, omitBackground:true });
  }
} finally { await browser.close(); }
}
async function run(args) {
  await new Promise((yes,no)=>{
    const p=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:['ignore','ignore','pipe']});
    let error='';p.stderr.on('data',d=>error+=d);p.on('error',no);p.on('close',c=>c===0?yes():no(new Error(error)));
  });
}
let timeline=0;
for(const [i,s] of plan.entries()) {
  const start=s.proof?s.start:shots[s.id].start+(s.offset??0);
  const sourceDuration=s.proof?s.available:Math.min(s.duration,shots[s.id].duration-(s.offset??0));
  const input=s.proof?`${evidenceDir}/economy-demo-raw.webm`:`${source}/capture.webm`;
  const [z0,z1]=s.zoom,[cx,cy]=s.center;
  const crop=s.crop?`crop=${s.crop.join(':')},`:'';
  const z=`${z0}+(${z1-z0})*min(on/${s.duration*30},1)`;
  const filters=`[0:v]trim=duration=${sourceDuration},setpts=PTS-STARTPTS,fps=30,${crop}scale=2560:1440:force_original_aspect_ratio=increase,crop=2560:1440,zoompan=z='${z}':x='max(0,min(iw-iw/zoom,iw*${cx}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*${cy}-ih/zoom/2))':d=1:s=1920x1080:fps=30,tpad=stop_mode=clone:stop_duration=${s.duration},trim=duration=${s.duration}[shot];[shot][1:v]overlay=0:0:format=auto,format=yuv420p,fade=t=in:d=0.12,fade=t=out:st=${s.duration-.12}:d=0.12[v];[2:a]aresample=48000,apad,atrim=duration=${s.duration},asetpts=PTS-STARTPTS,afade=t=in:d=0.08,afade=t=out:st=${s.duration-.08}:d=0.08[a]`;
  const audio=s.proof?['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']:['-ss',String(Math.max(0,start-capture.audioStart)),'-i',`${source}/game-audio.webm`];
  console.log(`Rendering ${i+1}/${plan.length}: ${s.id}`);
  if (!finishOnly) await run(['-ss',String(start),'-i',input,'-loop','1','-i',`${out}/edit/overlay-${i}.png`,...audio,
    '-filter_complex',filters,'-map','[v]','-map','[a]','-t',String(s.duration),'-c:v','libx264','-preset','fast','-crf','19','-threads','4','-c:a','aac','-b:a','192k','-movflags','+faststart',`${out}/edit/${String(i).padStart(2,'0')}.mp4`]);
  s.outputStart=timeline;s.sourceStart=start;s.sourceDuration=sourceDuration;timeline+=s.duration;
}
await writeFile(`${out}/edit/concat.txt`,plan.map((_,i)=>`file '${String(i).padStart(2,'0')}.mp4'`).join('\n'));
await run(['-f','concat','-safe','0','-i',`${out}/edit/concat.txt`,'-c','copy',`${out}/edit/assembled.mp4`]);
await run(['-i',`${out}/edit/assembled.mp4`,'-i',resolve('public/assets/music/race.mp3'),'-filter_complex',
  '[0:a]volume=0.7[sfx];[1:a]atrim=duration=90,asetpts=PTS-STARTPTS,volume=0.28,afade=t=in:d=1.5,afade=t=out:st=86:d=4[music];[sfx][music]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]',
  '-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-ar','48000','-b:a','192k','-t','90','-movflags','+faststart',`${out}/minirush-demo-1080p.mp4`]);
await run(['-i',`${out}/minirush-demo-1080p.mp4`,'-vf','scale=1280:720','-c:v','libx264','-preset','fast','-crf','23','-threads','4','-c:a','aac','-ar','48000','-b:a','128k','-movflags','+faststart',`${out}/minirush-demo-share.mp4`]);
await run(['-ss','3','-i',`${out}/minirush-demo-1080p.mp4`,'-frames:v','1',`${out}/poster.jpg`]);
const timestamp=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
await writeFile(`${out}/edit-notes.json`,JSON.stringify({ duration:90,resolution:'1920x1080',fps:30,
  sources:{fresh:capture,verifiedEconomy:oldEvidence},plan,
  notes:['Gameplay speed is unchanged. Gas and steering were automated through normal input.','Skin and widebody segments are previews, not purchase confirmations.','Economy excerpts are the real Nov 13 testnet run; two short holds make receipts readable.','No race outcome, ownership record or transaction receipt was fabricated.']},null,2));
await writeFile(`${out}/README.txt`, `MINIRUSH — 90-SECOND HACKATHON DEMO\n\n1080p master: minirush-demo-1080p.mp4\nSmaller share copy: minirush-demo-share.mp4\n\nActual UI and normal-speed gameplay. Assisted gas/steering; no position, speed or result edits.\nSkin/bodywork scenes show previews. Economy excerpts are a separate recorded NEAR testnet run from November 13, 2026. Short final-frame holds keep the craft/sale evidence readable.\n\nCHAPTERS\n${plan.map(s=>`${timestamp(s.outputStart)} ${s.title}`).join('\n')}\n\nTESTNET RECEIPTS\n${oldEvidence.receipts.join('\n')}\n\nMUSIC CREDIT — include this in the video description when sharing:\nRace Heat — Abbynoise\nMusic from #Uppbeat (free for Creators!)\nhttps://uppbeat.io/t/abbynoise/race-heat\nLicense code: PDZF0JMP0K6LPGBE\n\nEngine and UI effects captured from the game. Game asset credits: public/assets/README.md.\n`);
await copyFile(`${evidenceDir}/chain-verification.json`,`${out}/chain-verification.json`);
console.log(`Finished: ${out}`);
