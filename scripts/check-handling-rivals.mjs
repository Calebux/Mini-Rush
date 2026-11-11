// Real Player/RivalManager simulations in the browser, with lightweight body
// meshes and deterministic inputs. Every backend write is intercepted.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel:'chrome', headless:true });
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*', async route => {
 if(route.request().method()!=='POST') return route.continue();
 let b; try { b=route.request().postDataJSON(); } catch { return route.abort(); }
 return route.fulfill({json:b.jsonrpc ? {jsonrpc:'2.0',id:b.id,result:{result:[91,93],logs:[]}} : {status:'success',value:b.path==='near:createPlayer'?{account:'physics.testnet',created:true,welcome:0}:[]}});
});
try {
 await page.goto(`${process.argv[2]??'http://127.0.0.1:5174'}/?q=1`,{waitUntil:'networkidle'});
 await page.waitForFunction(()=>window.__game?.state==='menu');
 const result=await page.evaluate(async()=>{
  window.__game.renderer.setAnimationLoop(null);
  const T=await import('/node_modules/three/build/three.module.js');
  const {Player}=await import('/src/player.ts');
  const {RivalManager}=await import('/src/rivals.ts');
  const {Track}=await import('/src/track.ts');
  const {MAPS}=await import('/src/maps.ts');
  const {CARS}=await import('/src/cars.ts');
  const {SPEED_DISPLAY}=await import('/src/constants.ts');
  const {ghostKey,loadGhost,saveGhost}=await import('/src/ghost.ts');
  const failures=[], passed=[], metrics={};
  const check=(ok,label)=>{(ok?passed:failures).push(label);};
  const oldKey='minirush.ghost.17.lagos.gp.1.900';
  const oldGhost={car:0,time:20,score:0,hz:10,pts:[0,0,1,0]};
  localStorage.setItem(oldKey,JSON.stringify(oldGhost));
  const newKey=ghostKey(17,'lagos','gp',1,900);
  check(newKey!==oldKey&&loadGhost(newKey)===null,'Old-physics local ghosts do not set the new target time');
  check(saveGhost(newKey,{...oldGhost,time:25})&&loadGhost(newKey).time===25&&localStorage.getItem(oldKey)!==null,'New ghost records work while historical data is retained');
  const assets={cloneCar:()=>new T.Group(),cloneTraffic:()=>new T.Group(),clonePolice:()=>new T.Group()};
  const straight=(curve=()=>0)=>({length:1e6,wrap:s=>s,curvatureAt:curve,
   frame:s=>({x:0,z:-s,nx:-1,nz:0,theta:0,curvature:curve(s)}),
   place:(o,s,x)=>{o.position.set(x,0,-s);o.rotation.set(0,0,0);}});
  const player=(spec={},track=straight())=>{const p=new Player(new T.Scene(),assets,track,{...CARS[0],...spec});p.raceLength=1e6;p.reset({s:0,x:0});return p;};
  const launch=(spec={},dt=1/120)=>{
   const p=player(spec); let time=0,hit=null;
   for(let i=0;i<Math.round(10/dt);i++){
    const before=p.v; p.update(dt,time,0,0,true,false,true);time+=dt;
    if(hit===null&&p.v*3.6*SPEED_DISPLAY>=100) hit=time-dt+dt*(100/(3.6*SPEED_DISPLAY)-before)/(p.v-before);
   }
   return {launch:hit,top:p.v};
  };
  const stock=launch(),sprint=launch({speed:.96,accel:1.08}),long=launch({speed:1.04,accel:.95});
  metrics.launch={stock,sprint,long};
  check(stock.launch>1.5&&stock.launch<2.5,'Launch is measurable, not an instant jump');
  check(sprint.launch<stock.launch-.08&&sprint.top<stock.top,'Sprint tradeoff: quicker launch, lower top speed');
  check(long.launch>stock.launch+.06&&long.top>stock.top,'High-speed tradeoff: slower launch, higher top speed');
  check(Math.abs(launch({},1/30).launch-launch({},1/120).launch)<.035,'30/120 Hz acceleration agrees');
  const stop=(grip,wet=1)=>{const p=player({grip});p.gripMul=wet;p.v=35;let time=0;
   while(p.v>15&&time<5){p.update(1/120,time,0,0,true,true,false);time+=1/120;}return p.s;};
  metrics.braking={stock:stop(1),grip:stop(1.16),loose:stop(.88),wet:stop(1,.82)};
  check(metrics.braking.grip<metrics.braking.stock&&metrics.braking.loose>metrics.braking.stock,'Grip shortens braking; loose tyres lengthen it');
  check(metrics.braking.wet>metrics.braking.stock,'Wet grip lengthens the braking zone');
  const bend=grip=>{const p=player({grip},straight(()=>.018));p.v=30;for(let i=0;i<90;i++)p.update(1/120,i/120,0,0,true,false,true);return Math.abs(p.x);};
  metrics.corner={grip:bend(1.16),stock:bend(1),loose:bend(.88)};
  check(metrics.corner.grip<metrics.corner.stock*.85&&metrics.corner.loose>metrics.corner.stock*1.2,'Tyre grip measurably changes outward corner drift');
  const recovery=grip=>{const p=player({grip});p.v=25;for(let i=0;i<36;i++)p.update(1/120,i/120,0,.4,true,false,true);const initial=Math.abs(p.xVel);for(let i=0;i<24;i++)p.update(1/120,(36+i)/120,0,0,true,false,true);return Math.abs(p.xVel)/initial;};
  check(recovery(1.16)<recovery(.88),'Grippy builds settle more quickly after steering release');
  const boost=nitro=>{const p=player({nitro});p.fireNitro();let t=0;while(p.nitroActive&&t<5){p.update(1/120,t,0,0,true,false,true);t+=1/120;}return t;};
  check(boost(1.2)>boost(.8)+.8,'Nitro-duration tradeoff survives handling changes');
  const drifter=player();drifter.v=35;
  for(let i=0;i<96;i++)drifter.update(1/120,i/120,0,.25,true,true,true);
  let releasedBoost=false;
  for(let i=0;i<40;i++){
   drifter.update(1/120,(96+i)/120,0,0,true,false,true);
   releasedBoost ||= drifter.driftBoost>0;
  }
  check(releasedBoost&&!drifter.offroad,'Controlled brake-and-steer drift still rewards a clean release');
  const manager=(count=3,track=straight(),contact=false,pursuit=false)=>{
   const m=new RivalManager(new T.Scene(),assets,track,-1,count,pursuit,[],false,contact);
   m.reset(Array.from({length:count},(_,i)=>({s:-i*8,x:0})));
   for(const r of m.rivals){r.nitroTanks=0;r.nitroEarnT=1e6;}
   return m;
  };
  // The roomy side is occupied: take the other side, not the occupied lane.
  let m=manager(),r=m.rivals[0];Object.assign(r,{s:0,x:0,v:30});
  Object.assign(m.rivals[1],{s:1,x:3.1,v:30});Object.assign(m.rivals[2],{s:200,x:0,v:30});
  let line=m.raceLine(r,.1,-14,14,0,28,1);
  check(r.passT>0&&line<0,'Overtake chooses the clear side of an occupied road');
  const held=line;
  m.raceLine(r,.1,-12,12,.4,28,1);
  check(r.passLane===held,'Overtake holds its chosen lane when the lead car moves');
  // Both sides blocked: no pass, bounded following speed.
  m=manager();r=m.rivals[0];Object.assign(r,{s:0,x:0,v:35});
  Object.assign(m.rivals[1],{s:1,x:-3.1,v:35});Object.assign(m.rivals[2],{s:1,x:3.1,v:35});
  m.raceLine(r,.1,-10,10,0,20,0);
  check(r.passT===0&&r.racecraft==='following'&&m.followCap(r,10,0,20)<35,'Boxed-in rival follows and brakes instead of ramming');
  // The pass lane is beyond the barrier, so that side is rejected.
  m=manager(1);r=m.rivals[0];Object.assign(r,{s:0,x:3.4,v:30});
  line=m.raceLine(r,.1,-14,14,3.5,27,4);
  check(line<3.5&&Math.abs(line)<=4,'Overtake stays inside the available road width');
  // An overlap blocks a lateral move; defence is one held move, not mirroring.
  m=manager(1);r=m.rivals[0];Object.assign(r,{s:15,x:-1,v:30,readX:2});
  line=m.raceLine(r,.1,15,0,2,34,0);const defence=line;
  const second=m.raceLine(r,.1,15,0,-2,34,0);
  check(r.racecraft==='defending'&&second===defence&&!r.defendReady,'Defence commits once and does not mirror a late switch');
  Object.assign(r,{s:0,x:0,passT:0,defendT:0});
  line=m.raceLine(r,.1,0,0,2.6,30,2.5);
  check(line===0,'Side-by-side rivals leave space instead of cutting across');
  // Preview braking must lower speed before the corner, including at boost pace.
  const hairpin=straight(s=>s>=60&&s<=85?.12:0);
  m=manager(1,hairpin);r=m.rivals[0];Object.assign(r,{s:0,x:0,v:62});
  let entrySpeed=null,wrecked=false;
  for(let i=0;i<180;i++){
   m.update(1/60,i/60,i/60,-200,true,0,0,30);
   if(r.s>=60&&entrySpeed===null)entrySpeed=r.v;
   wrecked ||= r.tumbleT>0;
  }
  metrics.hairpin={entrySpeed,wrecked};
  check(entrySpeed!==null&&entrySpeed<=23&&!wrecked,'Rival brakes ahead of a tight corner without wrecking');
  // Run a complete passing manoeuvre, not just its initial lane decision.
  m=manager(1);r=m.rivals[0];Object.assign(r,{s:0,x:0,v:32});let contact=false;
  for(let i=0;i<600;i++){
   const t=i/60,playerS=12+t*26;
   m.update(1/60,t,t,playerS,true,0,0,26);
   contact ||= Math.abs(r.s-(playerS+26/60))<3.8&&Math.abs(r.x)<1.8;
  }
  metrics.pass={lead:r.s-(12+10*26),contact};
  check(metrics.pass.lead>7&&!contact,'Rival completes a pass without driving through the slower car');
  // Same launch envelope prevents opponents leaping away at lights out.
  m=manager(1);for(let i=0;i<30;i++)m.update(1/60,i/60,i/60,0,true,0,0,0);
  check(m.rivals[0].v<8&&m.rivals[0].v>3,'Rivals use a bounded launch like the player');
  // Racing aggression does not silently enable combat steering in class events.
  m=manager(1);r=m.rivals[0];Object.assign(r,{s:0,x:-3,v:20});
  m.update(.1,0,0,2,true,3,.9,20);const cleanX=r.x;
  m=manager(1,straight(),true);r=m.rivals[0];Object.assign(r,{s:0,x:-3,v:20});
  m.update(.1,0,0,2,true,3,.9,20);
  check(r.x>cleanX+.2,'Combat events retain contact intent; regular races do not');
  // Completed laps across flowing and technical circuits, with a seeded RNG.
  const random=Math.random;let seed=1907;Math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const laps=[];
  try {
   for(const id of ['lagos','kaduna','tokyo'])for(const wet of [1,.82]){
    const map=MAPS.find(x=>x.id===id),track=new Track(27041,1800,map);
    const field=manager(7,track);field.gripMul=wet;field.raceLength=track.length;
    let wrecks=0;
    for(let i=0;i<4500&&field.rivals.some(r=>r.finishTime<0);i++){
     const before=field.rivals.map(r=>r.tumbleT);const t=i/30;
     field.update(1/30,t,t,t*29,true,0,0,29);
     field.rivals.forEach((r,j)=>{if(before[j]<=0&&r.tumbleT>0)wrecks++;});
    }
    const finished=field.rivals.every(r=>r.finishTime>=0&&Number.isFinite(r.s)&&Math.abs(r.x)<=4.001);
    check(finished,`${id} ${wet===1?'dry':'wet'}: all seven finish within 150 simulated seconds`);
    check(wrecks<=7,`${id} ${wet===1?'dry':'wet'}: no repeated corner-wreck loop`);
    laps.push({map:id,grip:wet,wrecks,times:field.rivals.map(r=>+r.finishTime.toFixed(1))});field.dispose();
   }
  } finally {Math.random=random;}
  metrics.laps=laps;
  return {failures,passed,metrics};
 });
 console.log(JSON.stringify(result.metrics,null,2));
 for(const label of result.passed)console.log(`PASS: ${label}`);
 assert.deepEqual(result.failures,[]);assert.deepEqual(errors,[]);
} finally {await browser.close();}
