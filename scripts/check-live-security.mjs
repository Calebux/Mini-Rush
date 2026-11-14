// Live release check. All backend probes are deliberately invalid and must reject
// before writing or spending; no player key or NEAR transaction is involved.
import assert from 'node:assert/strict';
const base=process.argv[2]??'https://minirush.site';
const backend='https://precious-dalmatian-332.eu-west-1.convex.cloud';
for(const path of ['/','/economy/','/stats/']){
 const response=await fetch(base+path,{signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200,path);
 assert.equal(response.headers.get('x-frame-options'),'DENY');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 const csp=response.headers.get('content-security-policy');
 assert.ok(csp?.includes("script-src 'self' 'wasm-unsafe-eval'"));
 assert.ok(csp.includes("frame-ancestors 'none'"));
 if(path==='/')assert.match(await response.text(),/MiniRush — Race\. Build\. Trade\./);
 console.log('PASS headers:',path);
}
const probes=[
 ['action','near:relay',{signedDelegate:''},/tracked garage actions/],
 ['action','near:createPlayer',{publicKey:'invalid-security-probe'},/bad key/],
 ['action','near:testNear',{account:'invalid-security-probe'},/required field.*(?:at|signature)|(?:at|signature).*required/i],
 ['mutation','profiles:sync',{address:'invalid-security-probe',cars:[]},/disabled/],
 ['mutation','profiles:setName',{address:'invalid-security-probe',name:'probe'},/disabled/],
 ['mutation','profiles:addCar',{address:'invalid-security-probe',car:'invalid',tx:'invalid'},/disabled/]
];
for(const [kind,path,args,expected] of probes){
 const res=await fetch(`${backend}/api/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,args,format:'json'}),signal:AbortSignal.timeout(20000)});
 const body=await res.json();
 assert.equal(body.status,'error',`${path} must reject`);
 // Production Convex masks ordinary Error messages; local handler tests assert
 // the exact guard. Here verify rejection without claiming access to masked details.
 const masked = /^\[Request ID: [a-f0-9]+\] Server Error$/.test(body.errorMessage);
 if (!masked) assert.match(body.errorMessage,expected);
 console.log('PASS rejection:',path,masked?'(production error detail masked)':'');
}
console.log('PASS: live security headers and production rejection guards; no valid funding or signing requests sent.');
