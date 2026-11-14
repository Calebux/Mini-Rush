// Current-design walkthrough. Music/game effects only; no narration.
// --prepare-only makes graphics; --finish-only reuses rendered segments.
import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { plan } from './walkthrough-plan.mjs';
const source='/tmp/minirush-walkthrough-demo', customsSource='/tmp/minirush-customs-demo', accountSource='/tmp/minirush-account-demo';
const out=resolve('output/walkthrough-demo-v3'), finishOnly=process.argv.includes('--finish-only');
await mkdir(`${out}/edit`,{recursive:true});
async function command(program,args) {
  return new Promise((yes,no)=>{
    const p=spawn(program,args,{stdio:['ignore','pipe','pipe']});let output='',error='';
    p.stdout.on('data',d=>output+=d);p.stderr.on('data',d=>error+=d);p.on('error',no);
    p.on('close',c=>c===0?yes(output):no(new Error(`${program}: ${error}`)));
  });
}
const ff=args=>command('ffmpeg',['-hide_banner','-loglevel','error','-y',...args]);
if(process.argv.includes('--verify-only')) {
  const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const checks=[];
  try {
    for(const file of ['minirush-walkthrough-1080p.mp4','minirush-walkthrough-share.mp4','minirush-customs-shop.mp4','minirush-account-guide.mp4']) {
      const page=await browser.newPage({viewport:{width:1920,height:1080}});
      await page.goto(pathToFileURL(`${out}/${file}`).href);
      await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
      const duration=await page.evaluate(()=>document.querySelector('video').duration);
      for(const second of [3,30,100,120,175,205].filter(t=>t<duration-2)) {
        await page.evaluate(t=>{document.querySelector('video').currentTime=t;},second);
        await page.waitForFunction(t=>{const v=document.querySelector('video');return !v.seeking&&Math.abs(v.currentTime-t)<1&&v.readyState>=2;},second);
      }
      await page.evaluate(()=>{const v=document.querySelector('video');v.currentTime=20;v.muted=true;return v.play();});
      await page.waitForTimeout(2000);
      const state=await page.evaluate(()=>{const v=document.querySelector('video');return {duration:v.duration,width:v.videoWidth,height:v.videoHeight,time:v.currentTime,paused:v.paused,error:v.error?.message??null};});
      assert.equal(state.error,null);assert.ok(state.time>21);assert.equal(state.paused,false);
      checks.push({file,...state});await page.close();
    }
  }finally{await browser.close();}
  await writeFile(`${out}/playback-check.json`,JSON.stringify(checks,null,2));
  console.log(JSON.stringify(checks,null,2));process.exit(0);
}
const esc=s=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const controller=`<section class="controller"><div class="eyebrow">YOUR PAD. YOUR RACING LINE.</div><h1>Play with a PlayStation controller.</h1><p class="connect">Connect via USB or Bluetooth · press a button to activate</p>
<div class="pad-layout"><div class="keys"><article><b>LEFT STICK / D-PAD</b><span>Steer</span></article><article><b>R2</b><span>Accelerate</span></article><article><b>L2</b><span>Brake</span></article></div>
<svg viewBox="0 0 600 420" width="600" height="420" aria-label="Controller guide illustration">
<defs><linearGradient id="pad" x2="0" y2="1"><stop stop-color="#454a46"/><stop offset="1" stop-color="#171d19"/></linearGradient></defs>
<path d="M170 80Q130 60 100 95L30 290Q15 360 65 370Q90 375 140 310L185 255H415L460 310Q510 375 535 370Q585 360 570 290L500 95Q470 60 430 80Z" fill="url(#pad)" stroke="#c9b58f" stroke-width="4"/>
<rect x="218" y="83" width="164" height="100" rx="14" fill="#121713" stroke="#687064" stroke-width="2"/>
<path d="M120 126h26v32h32v26h-32v32h-26v-32H88v-26h32Z" fill="#101511" stroke="#919d8c" stroke-width="2"/>
<circle cx="224" cy="247" r="40" fill="#111612" stroke="#b9c2ac" stroke-width="3"/><circle cx="376" cy="247" r="40" fill="#111612" stroke="#687064" stroke-width="3"/>
<g fill="#121713" stroke="#929d88" stroke-width="2"><circle cx="462" cy="123" r="21"/><circle cx="462" cy="211" r="21"/><circle cx="418" cy="167" r="21"/><circle cx="506" cy="167" r="21"/></g>
<g fill="none" stroke-width="3"><path d="M451 132l11-19 11 19Z" stroke="#b8d3b2"/><path d="M452 201l20 20m0-20l-20 20" stroke="#c5d6e0"/><rect x="409" y="158" width="18" height="18" stroke="#e4bbd5"/><circle cx="506" cy="167" r="10" stroke="#dcad9e"/></g>
<rect x="391" y="97" width="8" height="22" rx="4" fill="#d9c39e"/><path d="M105 79Q125 45 178 58M422 58Q475 45 495 79" fill="none" stroke="#d9c39e" stroke-width="10" stroke-linecap="round"/>
</svg><div class="keys"><article><b>✕ CROSS</b><span>Nitro</span></article><article><b>□ SQUARE</b><span>Change camera</span></article><article><b>OPTIONS</b><span>Pause</span></article></div></div>
<div class="compat">USB or Bluetooth · controller support depends on your browser and device</div></section>`;
if(!finishOnly && !process.argv.includes('--render-only')){
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
    for(const [i,s] of plan.entries()){
      await page.setContent(`<style>*{box-sizing:border-box}html,body{margin:0;background:transparent;color:#eeeae0;font-family:Arial,sans-serif}.top{position:absolute;left:160px;top:12px;font-size:17px;letter-spacing:1.3px;font-weight:700;color:#dfc79f}.brand{position:absolute;right:160px;top:13px;font-size:15px;letter-spacing:2px;color:#b2b9a9}.sub{position:absolute;left:110px;right:110px;top:978px;text-align:center;font-size:29px;line-height:38px;margin:0}.progress{position:absolute;bottom:0;left:0;width:${(i+1)/plan.length*100}%;height:3px;background:#d9bf91}.proof{position:absolute;left:180px;top:58px;padding:10px 14px;font-size:14px;letter-spacing:1.5px;background:#10160feb;color:#ead9ba;border:1px solid #786d55}.controller{position:absolute;left:160px;top:42px;width:1600px;height:900px;background:radial-gradient(ellipse at 50% 65%,#303a2c,#101611 65%);padding:70px 75px;text-align:center}.eyebrow{font-size:17px;letter-spacing:5px;color:#dbc59e}h1{font-size:54px;letter-spacing:-1px;margin:20px 0}.connect{font-size:26px;color:#c2c9b9;margin:0}.pad-layout{display:flex;justify-content:space-between;align-items:center;margin-top:45px}.keys{width:285px;text-align:left}.keys article{margin-bottom:32px;padding:16px 20px;border-left:2px solid #c8ad7a;background:#080d0877;border-radius:0 8px 8px 0}.keys b{display:block;font-size:17px;letter-spacing:2px;color:#d6bd91}.keys span{display:block;font-size:29px;margin-top:10px}.compat{font-size:18px;color:#8f9d89;margin-top:30px}</style><div class="top">${esc(s.title)}</div><div class="brand">${s.account?'NEAR TESTNET / REAL PURCHASE':'MINIRUSH / GUIDED TOUR'}</div>${s.controller?controller:''}<p class="sub">${esc(s.caption)}</p><div class="progress"></div>`);
      const layout=await page.locator('.sub').boundingBox();if(layout.y+layout.height>1075)throw new Error(`Subtitle overflow: ${s.id}`);
      await page.screenshot({path:`${out}/edit/overlay-${i}.png`,omitBackground:true});
      console.log(`Prepared ${s.id}: ${s.duration}s`);
    }
  }finally{await browser.close();}
  await writeFile(`${out}/edit/prepared-plan.json`,JSON.stringify(plan,null,2));
}else{
  const prepared=JSON.parse(await readFile(`${out}/edit/prepared-plan.json`,'utf8'));plan.splice(0,plan.length,...prepared);
}
if(process.argv.includes('--prepare-only'))process.exit(0);
const capture=JSON.parse(await readFile(`${source}/capture.json`,'utf8'));
const customs=JSON.parse(await readFile(`${customsSource}/capture.json`,'utf8'));
const account=JSON.parse(await readFile(`${accountSource}/capture.json`,'utf8'));
const purchase=JSON.parse(await readFile(`${accountSource}/evidence.json`,'utf8'));
assert.ok(purchase.car?.owner===purchase.account,'A verified testnet purchase is required.');
for(const c of [capture,customs,account])if(c.errors.length)throw new Error(`Capture page errors: ${c.errors.join('; ')}`);
const shots=Object.fromEntries(capture.shots.map(s=>[s.id,s]));
const customShots=Object.fromEntries(customs.shots.map(s=>[s.id,s]));
const accountShots=Object.fromEntries(account.shots.map(s=>[s.id,s]));
let timeline=0;
for(const [i,s] of plan.entries()){
  const shot=(s.account?accountShots:s.customs?customShots:shots)[s.sourceId??s.id];
  const inputSource=s.account?accountSource:s.customs?customsSource:source;
  const start=shot.start,available=Math.min(s.duration,shot.duration);
  const vf=`[0:v]trim=duration=${available},setpts=PTS-STARTPTS,fps=30,${s.crop?`crop=${s.crop.join(':')},`:''}scale=1600:900,tpad=stop_mode=clone:stop_duration=${s.duration},trim=duration=${s.duration},pad=1920:1080:160:42:color=0x0b100c[shot];[shot][1:v]overlay=0:0:format=auto,format=yuv420p,fade=t=in:d=0.12,fade=t=out:st=${s.duration-.12}:d=0.12[v];[2:a]aresample=48000:async=1:first_pts=0,volume=0.7,apad,atrim=duration=${s.duration},asetpts=PTS-STARTPTS,afade=t=in:d=0.08,afade=t=out:st=${s.duration-.08}:d=0.08[a]`;
  const audio=s.controller?['-f','lavfi','-i','anullsrc=r=48000:cl=stereo']:['-ss',String(Math.max(0,start-(s.account?account:s.customs?customs:capture).audioStart)),'-i',`${inputSource}/game-audio.webm`];
  const selected=process.argv.find(a=>a.startsWith('--chapter='))?.split('=')[1];
  if(!finishOnly && (!selected || selected.split(',').includes(s.id))){
    console.log(`Rendering ${i+1}/${plan.length}: ${s.id}`);
    await ff(['-ss',String(start),'-i',`${inputSource}/capture.webm`,'-loop','1','-i',`${out}/edit/overlay-${i}.png`,...audio,'-filter_complex',vf,'-map','[v]','-map','[a]','-t',String(s.duration),'-c:v','libx264','-preset','fast','-crf','19','-threads','4','-c:a','aac','-ar','48000','-b:a','192k',`${out}/edit/${String(i).padStart(2,'0')}.mp4`]);
  }
  s.outputStart=timeline;s.sourceStart=start;s.sourceDuration=available;timeline+=s.duration;
}
if(process.argv.includes('--segments-only'))process.exit(0);
await writeFile(`${out}/edit/concat.txt`,plan.map((_,i)=>`file '${String(i).padStart(2,'0')}.mp4'`).join('\n'));
await ff(['-f','concat','-safe','0','-i',`${out}/edit/concat.txt`,'-c','copy',`${out}/edit/assembled.mp4`]);
await ff(['-i',`${out}/edit/assembled.mp4`,'-stream_loop','-1','-i',resolve('public/assets/music/race.mp3'),'-filter_complex',`[1:a]volume=0.28,afade=t=in:d=2,afade=t=out:st=${timeline-4}:d=4[music];[0:a][music]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9[a]`,'-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-ar','48000','-b:a','192k','-t',String(timeline),'-movflags','+faststart',`${out}/minirush-walkthrough-1080p.mp4`]);
await ff(['-i',`${out}/minirush-walkthrough-1080p.mp4`,'-vf','scale=1280:720','-c:v','libx264','-preset','fast','-crf','23','-threads','4','-c:a','aac','-b:a','128k','-movflags','+faststart',`${out}/minirush-walkthrough-share.mp4`]);
const shopStart=plan.find(s=>s.customs).outputStart;
const shopLength=plan.filter(s=>s.customs).reduce((n,s)=>n+s.duration,0);
await ff(['-ss',String(shopStart),'-i',`${out}/minirush-walkthrough-1080p.mp4`,'-t',String(shopLength),'-c:v','libx264','-preset','fast','-crf','20','-threads','4','-af',`afade=t=in:d=0.3,afade=t=out:st=${shopLength-1}:d=1`,'-c:a','aac','-b:a','192k','-movflags','+faststart',`${out}/minirush-customs-shop.mp4`]);
const accountLength=plan.filter(s=>s.account).reduce((n,s)=>n+s.duration,0);
await ff(['-i',`${out}/minirush-walkthrough-1080p.mp4`,'-t',String(accountLength),'-c:v','copy','-af',`afade=t=out:st=${accountLength-1}:d=1`,'-c:a','aac','-b:a','192k','-movflags','+faststart',`${out}/minirush-account-guide.mp4`]);
await writeFile(`${out}/purchase-evidence.json`,JSON.stringify(purchase,null,2));
await ff(['-ss',String(shopStart+7),'-i',`${out}/minirush-walkthrough-1080p.mp4`,'-frames:v','1',`${out}/poster.jpg`]);
const stamp=n=>`${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
await writeFile(`${out}/captions.txt`,plan.map(s=>`${stamp(s.outputStart)} — ${s.title}\n${s.caption}\n`).join('\n'));
await writeFile(`${out}/README.txt`,`MINIRUSH — CURRENT-DESIGN WALKTHROUGH / V3\n\nDuration: ${stamp(timeline)}. No voice-over: music, game sounds and short captions.\n1080p: minirush-walkthrough-1080p.mp4\n720p sharing copy: minirush-walkthrough-share.mp4\nAccount guide: minirush-account-guide.mp4 (${stamp(accountLength)})\nCustoms Shop excerpt: minirush-customs-shop.mp4 (${stamp(shopLength)})\n\nAll footage shows the current interface. No historical workshop/crafting/sale footage is included. The Customs Shop is freshly captured with body, wheel, wing, paint and power changes, drag rotation, performance specimens and dealer orders. The opening account guide creates a real testnet garage, claims a testnet grant and buys one Island Night edition through the UI. Confirmation and ownership are verified on chain. Network waiting time is cut between the pending and confirmed steps. The later racing and customization scenes use a separate demo garage; customization changes remain previews and block transaction writes. No ownership or receipts are simulated.\n\nRace footage uses assisted steering/gas through normal input and unchanged physics. Gameplay runs at normal speed. A physical PlayStation pad was not tested during recording; the diagram reflects the game's mappings. Browser/device support varies.\n\nCHAPTERS\n${plan.map(s=>`${stamp(s.outputStart)} ${s.title}`).join('\n')}\n\nPUBLIC TESTNET RECEIPTS\n${purchase.receipts.map(r=>`${r.kind}: https://testnet.nearblocks.io/txns/${r.tx}`).join('\n')}\n\nMUSIC CREDIT — include in the upload description:\nRace Heat — Abbynoise\nMusic from #Uppbeat (free for Creators!)\nhttps://uppbeat.io/t/abbynoise/race-heat\nLicense code: PDZF0JMP0K6LPGBE\n\nGame asset credits: public/assets/README.md\n`);
await writeFile(`${out}/edit-notes.json`,JSON.stringify({duration:timeline,voiceOver:false,historicalFootage:false,plan,capture,customs,account},null,2));
console.log(`Finished ${stamp(timeline)} walkthrough; Customs Shop ${stamp(shopLength)}: ${out}`);
