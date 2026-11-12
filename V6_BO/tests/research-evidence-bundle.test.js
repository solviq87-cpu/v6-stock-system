'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {freezeResearchEvidenceBundle:freeze,readResearchEvidenceBundle:read}=require('../src/core/research-evidence-bundle');
const epoch=Date.parse('2026-01-05T08:00:00Z'),a='a'.repeat(64),b='b'.repeat(64);
function input(extra={}){return {symbol:'600001',provider:'eastmoney',priceBasis:'unadjusted',decisionAt:epoch,observationHash:a,history:{lastBarDate:'2026-01-02',provided:120,observedAt:epoch-100},marketContext:{source:'eastmoney',observedAt:epoch-50,index:{close:4000},sentiment:{sealed:37},funds:{mainNetInflow:100}},stockStatus:{source:'announcements',observedAt:epoch-10,isST:false,announcements:[{id:'one',date:'2026-01-04',headline:'已公布事实'}]},sectorContext:{source:'eastmoney',observedAt:epoch-20,sector:'行业A'},sourceRefs:[{sha256:b,byteLength:100,source:'eastmoney',url:'https://example.com/public?symbol=600001',receivedAt:epoch-100}],trigger:'push-attempt',...extra};}
function clock(time,fn){const original=Date.now;Date.now=()=>time;try{return fn();}finally{Date.now=original;}}
function temporary(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'evidence-bundle-'));try{const r=fn(root);if(r?.then)return r.finally(()=>fs.rmSync(root,{recursive:true,force:true}));fs.rmSync(root,{recursive:true,force:true});return r;}catch(e){fs.rmSync(root,{recursive:true,force:true});throw e;}}
function files(root,kind){return fs.readdirSync(root,{recursive:true}).filter(n=>n.includes(kind+path.sep)&&n.endsWith('.json')).map(n=>path.join(root,n));}
function publicationWorker(script,args){
 const child=spawn(process.execPath,['-e',script,...args],{stdio:['ignore','pipe','pipe']});let buffer='',stderr='',readyValue,result,parseError,readyResolve,readyReject,doneResolve,doneReject,closedResolve;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;}),done=new Promise((resolve,reject)=>{doneResolve=resolve;doneReject=reject;}),closed=new Promise(resolve=>{closedResolve=resolve;});ready.catch(()=>{});done.catch(()=>{});
 const parseLine=line=>{if(!line.trim())return;try{const message=JSON.parse(line);if(message.event==='ready'){readyValue=message;readyResolve(message);}else if(message.event==='result')result=message.result;else throw Error('unexpected child message');}catch(error){parseError=error;readyReject(error);doneReject(error);}};
 child.stdout.on('data',data=>{buffer+=data;let end;while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);parseLine(line);}});child.stderr.on('data',data=>{stderr+=data;});
 child.on('error',error=>{readyReject(error);doneReject(error);});child.on('close',(code,signal)=>{
  parseLine(buffer);const error=parseError||((code!==0||result===undefined)?Error(stderr||'child stopped '+code+'/'+signal):null);
  if(!readyValue)readyReject(error||Error('child never reached publication'));if(error)doneReject(error);else doneResolve(result);closedResolve({code,signal});
 });return {child,ready,done,closed};
}
async function publicationRace(root){
 const decisionAt=Date.now()-1000,value=input({decisionAt});value.history.observedAt=decisionAt-100;value.marketContext.observedAt=decisionAt-50;value.stockStatus.observedAt=decisionAt-10;value.sectorContext.observedAt=decisionAt-20;value.sourceRefs[0].receivedAt=decisionAt-100;
 const barrier=path.join(os.tmpdir(),'evidence-barrier-'+crypto.randomBytes(8).toString('hex')),modulePath=require.resolve('../src/core/research-evidence-bundle');
 const script=`const fs=require('node:fs'),{freezeResearchEvidenceBundle}=require(${JSON.stringify(modulePath)}),link=fs.linkSync;let gated=false;fs.linkSync=(from,to)=>{if(to.includes('/receipts/')&&!gated){gated=true;const receipt=JSON.parse(fs.readFileSync(from,'utf8'));process.stdout.write(JSON.stringify({event:'ready',recordedAt:receipt.recordedAt})+'\\n');const end=Date.now()+10000;while(!fs.existsSync(process.argv[2])){if(Date.now()>end)throw Error('timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}return link(from,to);};try{process.stdout.write(JSON.stringify({event:'result',result:freezeResearchEvidenceBundle(process.argv[1],JSON.parse(process.argv[3]))})+'\\n');}catch(error){process.stderr.write(error.message);process.exitCode=1;}`;
 const workers=[];let timeout;const deadline=new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('publication readiness timeout')),12000);});
 try{
  // The first writer is paused after writing its receipt stage. Launching the
  // second now guarantees different real recordedAt values, not a clock stub.
  const first=publicationWorker(script,[root,barrier,JSON.stringify(value)]);workers.push(first);const firstReady=await Promise.race([first.ready,deadline]);
  const second=publicationWorker(script,[root,barrier,JSON.stringify(value)]);workers.push(second);const secondReady=await Promise.race([second.ready,deadline]);assert.ok(secondReady.recordedAt>firstReady.recordedAt);
  fs.writeFileSync(barrier,'go');const results=await Promise.all(workers.map(w=>w.done));assert.equal(results[0].hash,results[1].hash);assert.equal(results.filter(r=>r.reused).length,1);assert.equal(files(root,'receipts').length,1);assert.equal(read(root,{symbol:'600001',provider:'eastmoney',hash:results[0].hash}).marketContext.index.close,4000);return results;
 }finally{
  clearTimeout(timeout);for(const w of workers)if(w.child.exitCode===null&&w.child.signalCode===null)w.child.kill();await Promise.all(workers.map(w=>w.closed));try{fs.unlinkSync(barrier);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
test('freeze stores parsed facts and archive references privately without altering inputs or existing data',()=>temporary(root=>{
 const value=input(),original=structuredClone(value);fs.writeFileSync(path.join(root,'user-history.txt'),'keep',{mode:0o600});const first=clock(epoch+1000,()=>freeze(root,value));assert.deepEqual(value,original);assert.equal(first.recordedAt,epoch+1000);assert.equal(first.decisionAt,epoch);assert.equal(first.revision,1);assert.equal(first.canTrade,false);assert.equal(first.canNotify,false);
 assert.match(first.hash,/^[a-f0-9]{64}$/);assert.equal(fs.readFileSync(path.join(root,'user-history.txt'),'utf8'),'keep');for(const file of [...files(root,'objects'),...files(root,'receipts')]){assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(file)).mode&0o777,0o700);}
 const result=read(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+1000});assert.equal(result.hash,first.hash);assert.deepEqual(result.marketContext,value.marketContext);assert.deepEqual(result.stockStatus,value.stockStatus);assert.deepEqual(result.sourceRefs,value.sourceRefs);
}));
test('restart and explicit hashes restore the original frozen context instead of new market facts',()=>temporary(root=>{
 const first=clock(epoch+1000,()=>freeze(root,input()));const later=input({decisionAt:epoch+2000,marketContext:{observedAt:epoch+2000,index:{close:5000},sentiment:{sealed:90}}});const second=clock(epoch+3000,()=>freeze(root,later));assert.notEqual(second.hash,first.hash);
 delete require.cache[require.resolve('../src/core/research-evidence-bundle')];const restarted=require('../src/core/research-evidence-bundle');
 assert.equal(restarted.readResearchEvidenceBundle(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+4000}).marketContext.index.close,5000);
 const old=restarted.readResearchEvidenceBundle(root,{symbol:'600001',provider:'eastmoney',hash:first.hash,asOf:epoch+4000});assert.equal(old.marketContext.index.close,4000);assert.equal(old.stockStatus.announcements[0].headline,'已公布事实');assert.equal(old.revision,1);
 assert.equal(read(root,{symbol:'600001',provider:'eastmoney',hash:second.hash,asOf:epoch+2500}),null);assert.equal(read(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+500}),null);assert.equal(read(root,{symbol:'600001',provider:'tencent',asOf:epoch+4000}),null);
}));
test('identical evidence deduplicates across clock changes and restarts, preserving the original recorded time',()=>temporary(root=>{
 const first=clock(epoch+1000,()=>freeze(root,input()));const second=clock(epoch+2000,()=>freeze(root,input()));assert.equal(second.reused,true);assert.equal(second.hash,first.hash);assert.equal(second.recordedAt,first.recordedAt);assert.equal(second.revision,1);
 assert.equal(clock(epoch+100000,()=>freeze(root,input())).hash,first.hash);assert.equal(files(root,'receipts').length,1);
}));
test('out-of-order publication preserves both bundles while latest follows the actual decision time',()=>temporary(root=>{
 const later=clock(epoch+3000,()=>freeze(root,input({decisionAt:epoch+2000,marketContext:{observedAt:epoch+2000,index:{close:5000}}})));const lateArrival=clock(epoch+4000,()=>freeze(root,input()));assert.equal(lateArrival.revision,2);
 assert.equal(read(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+4000}).hash,later.hash);assert.equal(read(root,{symbol:'600001',provider:'eastmoney',hash:lateArrival.hash,asOf:epoch+4000}).marketContext.index.close,4000);
}));
test('source reference transport reuse is excluded and null URLs do not cause network or filesystem reads',()=>temporary(root=>{
 const value=input();value.sourceRefs[0]={...value.sourceRefs[0],url:null,reused:false};value.marketContext.format='yyyy-MM-dd';const first=clock(epoch+1000,()=>freeze(root,value));assert.equal(first.sourceRefs[0].url,null);assert.equal(first.sourceRefs[0].reused,undefined);
 value.sourceRefs[0].reused=true;const second=clock(epoch+2000,()=>freeze(root,value));assert.equal(second.hash,first.hash);assert.equal(second.reused,true);
}));
test('structured push association freezes actual intent references and rejects later times, secret fields and paths',()=>temporary(root=>{
 const trigger={kind:'push-attempt',intentId:a,pushDecisionAt:epoch-100,signalRefs:[{code:'600001',type:'趋势票',ts:epoch-100}],messageHash:b};const value=input({trigger}),original=structuredClone(value);const frozen=clock(epoch+1000,()=>freeze(root,value));assert.deepEqual(value,original);assert.deepEqual(frozen.trigger,trigger);
 delete require.cache[require.resolve('../src/core/research-evidence-bundle')];const restarted=require('../src/core/research-evidence-bundle');assert.deepEqual(restarted.readResearchEvidenceBundle(root,{symbol:'600001',provider:'eastmoney',hash:frozen.hash,asOf:epoch+1000}).trigger,trigger);
 const manual={kind:'manual-research',intentId:null,pushDecisionAt:null,signalRefs:[],messageHash:null};assert.deepEqual(clock(epoch+2000,()=>freeze(root,input({trigger:manual}))).trigger,manual);
 for(const bad of [{...trigger,pushDecisionAt:epoch+1},{...trigger,signalRefs:[{code:'600001',type:'trend',ts:epoch+1}]},{...trigger,token:'secret'},{...trigger,path:'/private'},{...trigger,kind:'/private/history'},{...trigger,kind:'https://example.com'}])assert.throws(()=>clock(epoch+2000,()=>freeze(root,input({trigger:bad}))),/校验/);
}));
test('recursive actual evidence times reject future values but planned dates and scheduled due times remain facts',()=>temporary(root=>{
 for(const key of ['receivedAt','observedAt','retrievedAt','knownAt','firstObservedAt','statusKnownAt','corporateActionKnownAt','sourceTimestamp','capturedAt']){
  const value=input();value.marketContext.deep={records:[{[key]:epoch+1}]};assert.throws(()=>clock(epoch+1000,()=>freeze(root,value)),/校验/);
 }
 const value=input();value.marketContext.events=[{date:'2027-01-01',dueAt:epoch+86400000,nextAttemptAt:epoch+3600000,observedAt:null}];value.sectorContext={asOf:'2026-01-05',publishedAt:new Date(epoch-1000).toISOString()};assert.equal(clock(epoch+1000,()=>freeze(root,value)).revision,1);
 const iso=input();iso.stockStatus.knownAt=new Date(epoch+1).toISOString();assert.throws(()=>clock(epoch+1000,()=>freeze(root,iso)),/校验/);
}));
test('new bundles require real recording within sixty seconds of decision and reject forged recording fields',()=>temporary(root=>{
 assert.throws(()=>clock(epoch-1,()=>freeze(root,input())),/校验/);assert.throws(()=>clock(epoch+60001,()=>freeze(root,input())),/校验/);assert.throws(()=>clock(epoch+1000,()=>freeze(root,{...input(),recordedAt:epoch})),/校验/);
 assert.equal(clock(epoch+60000,()=>freeze(root,input())).recordedAt,epoch+60000);
}));
test('raw historical bytes, invalid references, excessive data and non-JSON payloads fail closed',()=>temporary(root=>{
 for(const history of [{bars:[{}]},{nested:{rawEvidence:{encoding:'base64',data:'private'}}},{raw:'bytes'}])assert.throws(()=>clock(epoch+1000,()=>freeze(root,input({history}))),/校验/);
 for(const amend of [r=>r.sha256='bad',r=>r.receivedAt=epoch+1,r=>r.byteLength=-1,r=>r.url='file:///etc/passwd',r=>r.url='https://user:password@example.com',r=>r.reused='yes']){const value=input();amend(value.sourceRefs[0]);assert.throws(()=>clock(epoch+1000,()=>freeze(root,value)),/校验/);}
 assert.throws(()=>clock(epoch+1000,()=>freeze(root,input({stockStatus:{rawBytes:Buffer.from('data')}}))),/校验/);
 assert.throws(()=>clock(epoch+1000,()=>freeze(root,input({marketContext:{records:Array(10001).fill(1)}}))),/校验/);
 assert.throws(()=>clock(epoch+1000,()=>freeze(root,input({marketContext:{large:'x'.repeat(450000)},stockStatus:{large:'x'.repeat(450000)},sectorContext:{large:'x'.repeat(450000)}}))),/校验/);
}));
test('provider identities stay independent and a wrong-identity hash cannot recover another stock bundle',()=>temporary(root=>{
 const first=clock(epoch+1000,()=>freeze(root,input()));const other=clock(epoch+1000,()=>freeze(root,input({provider:'tencent'})));assert.notEqual(first.hash,other.hash);assert.equal(read(root,{symbol:'600001',provider:'tencent',hash:first.hash,asOf:epoch+1000}),null);assert.equal(read(root,{symbol:'600002',provider:'eastmoney',hash:first.hash,asOf:epoch+1000}),null);
}));
test('object, receipt and later invisible evidence corruption are rejected even for a specific earlier hash',()=>temporary(root=>{
 const first=clock(epoch+1000,()=>freeze(root,input())),second=clock(epoch+3000,()=>freeze(root,input({decisionAt:epoch+2000,trigger:'followup'})));const object=files(root,'objects').find(f=>path.basename(f)===second.hash+'.json'),raw=fs.readFileSync(object),changed=JSON.parse(raw);changed.marketContext.index.close=9999;fs.writeFileSync(object,JSON.stringify(changed));
 assert.throws(()=>read(root,{symbol:'600001',provider:'eastmoney',hash:first.hash,asOf:epoch+1000}),/校验/);fs.writeFileSync(object,raw);
 const receipt=files(root,'receipts').sort()[1],record=JSON.parse(fs.readFileSync(receipt));record.hash=first.hash;fs.writeFileSync(receipt,JSON.stringify(record));assert.throws(()=>read(root,{symbol:'600001',provider:'eastmoney'}),/校验/);
}));
test('public roots, open permissions, symlinks and oversized archived objects are rejected',()=>temporary(root=>{
 assert.throws(()=>clock(epoch+1000,()=>freeze(path.join(root,'public','data'),input())),/校验/);const open=path.join(root,'open');fs.mkdirSync(open);fs.chmodSync(open,0o755);assert.throws(()=>clock(epoch+1000,()=>freeze(open,input())),/校验/);
 const archive=path.join(root,'archive');clock(epoch+1000,()=>freeze(archive,input()));const alias=path.join(root,'alias');fs.symlinkSync(archive,alias);assert.throws(()=>read(alias,{symbol:'600001',provider:'eastmoney'}),/校验/);
 const object=files(archive,'objects')[0],raw=fs.readFileSync(object);fs.chmodSync(object,0o644);assert.throws(()=>read(archive,{symbol:'600001',provider:'eastmoney'}),/校验/);fs.chmodSync(object,0o600);fs.unlinkSync(object);fs.symlinkSync('/etc/passwd',object);assert.throws(()=>read(archive,{symbol:'600001',provider:'eastmoney'}),/校验/);fs.unlinkSync(object);fs.writeFileSync(object,raw,{mode:0o600});fs.writeFileSync(object,'x'.repeat(1024*1024+1));assert.throws(()=>read(archive,{symbol:'600001',provider:'eastmoney'}),/校验/);
}));
test('a crash before receipt publication leaves no committed bundle or permanent lock',()=>temporary(root=>{
 const link=fs.linkSync;fs.linkSync=(from,to)=>{if(to.includes(path.sep+'receipts'+path.sep)){const e=Error('publication unavailable');e.code='EIO';throw e;}return link(from,to);};
 try{assert.throws(()=>clock(epoch+1000,()=>freeze(root,input())),/校验/);}finally{fs.linkSync=link;}
 assert.equal(read(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+1000}),null);assert.equal(files(root,'objects').length,1);assert.equal(clock(epoch+1000,()=>freeze(root,input())).revision,1);
}));
test('five publication conflicts fail clearly and leave existing archives untouched',()=>temporary(root=>{
 const first=clock(epoch+1000,()=>freeze(root,input())),link=fs.linkSync;let calls=0;fs.linkSync=(from,to)=>{if(to.includes(path.sep+'receipts'+path.sep)){calls++;const e=Error('conflict');e.code='EEXIST';throw e;}return link(from,to);};
 try{assert.throws(()=>clock(epoch+3000,()=>freeze(root,input({decisionAt:epoch+2000,trigger:'another'}))),/校验/);assert.equal(calls,5);}finally{fs.linkSync=link;}
 assert.equal(read(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+3000}).hash,first.hash);
}));
test('five hundred receipts cap a small archive, while an existing bundle still deduplicates',()=>temporary(root=>{
 clock(epoch+1000,()=>freeze(root,input()));const objectFile=files(root,'objects')[0],receiptFile=files(root,'receipts')[0],template=JSON.parse(fs.readFileSync(objectFile)),receiptTemplate=JSON.parse(fs.readFileSync(receiptFile));
 const ordered=x=>Array.isArray(x)?x.map(ordered):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,ordered(x[k])])):x,encode=x=>JSON.stringify(ordered(x)),sha=x=>crypto.createHash('sha256').update(encode(x)).digest('hex');let previousHash=receiptTemplate.receiptHash;
 for(let i=1;i<500;i++){const {hash,...body}=template;body.decisionAt=epoch+i;body.recordedAt=epoch+1000+i;const object={...body,hash:sha(body)};const {schemaVersion,mode,recordedAt,...intake}=body;for(const key of ['researchOnly','verifiedLive','canTrade','canNotify','weightsChanged'])delete intake[key];const receipt={schemaVersion:1,revision:i+1,previousHash,hash:object.hash,intakeHash:sha(intake),decisionAt:body.decisionAt,recordedAt:body.recordedAt},record={...receipt,receiptHash:sha(receipt)};previousHash=record.receiptHash;fs.writeFileSync(path.join(path.dirname(objectFile),object.hash+'.json'),encode(object),{flag:'wx',mode:0o600});fs.writeFileSync(path.join(path.dirname(receiptFile),String(i+1).padStart(6,'0')+'.json'),encode(record),{flag:'wx',mode:0o600});}
 assert.equal(read(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+2000}).revision,500);assert.throws(()=>clock(epoch+3000,()=>freeze(root,input({decisionAt:epoch+2000}))),/校验/);assert.equal(clock(epoch+3000,()=>freeze(root,input())).reused,true);
}));
test('a correctly named object or receipt stage disappearing between readdir and lstat is a normal publication race',()=>{
 for(const kind of ['objects','receipts'])temporary(root=>{
  clock(epoch+1000,()=>freeze(root,input()));const committed=files(root,kind)[0],dir=path.dirname(committed),stage=committed+'.0123456789abcdef.tmp';fs.writeFileSync(stage,'partial',{mode:0o600});const readdir=fs.readdirSync;let removed=false;
  fs.readdirSync=(selected,...args)=>{const names=readdir(selected,...args);if(!removed&&selected===dir){assert.ok(names.includes(path.basename(stage)));fs.unlinkSync(stage);removed=true;}return names;};
  let frozen;try{frozen=clock(epoch+2000,()=>freeze(root,input({trigger:'second'})));}finally{fs.readdirSync=readdir;}
  assert.equal(removed,true);assert.equal(frozen.revision,2);assert.equal(read(root,{symbol:'600001',provider:'eastmoney',hash:frozen.hash,asOf:epoch+2000}).hash,frozen.hash);
 });
});
test('a committed object or receipt disappearing after readdir still fails closed',()=>{
 for(const kind of ['objects','receipts'])temporary(root=>{
  clock(epoch+1000,()=>freeze(root,input()));const committed=files(root,kind)[0],dir=path.dirname(committed),readdir=fs.readdirSync;let removed=false;
  fs.readdirSync=(selected,...args)=>{const names=readdir(selected,...args);if(!removed&&selected===dir){fs.unlinkSync(committed);removed=true;}return names;};
  try{assert.throws(()=>read(root,{symbol:'600001',provider:'eastmoney'}),/校验/);}finally{fs.readdirSync=readdir;}assert.equal(removed,true);
 });
});
test('a wrong-kind disappearing staging name or a non-ENOENT staging error remains invalid evidence',()=>{
 for(const kind of ['objects','receipts'])temporary(root=>{
  clock(epoch+1000,()=>freeze(root,input()));const dir=path.dirname(files(root,kind)[0]),name=(kind==='objects'?'000002':'a'.repeat(64))+'.json.0123456789abcdef.tmp',stage=path.join(dir,name);fs.writeFileSync(stage,'partial',{mode:0o600});const readdir=fs.readdirSync;let removed=false;
  fs.readdirSync=(selected,...args)=>{const names=readdir(selected,...args);if(!removed&&selected===dir){fs.unlinkSync(stage);removed=true;}return names;};try{assert.throws(()=>read(root,{symbol:'600001',provider:'eastmoney'}),/校验/);}finally{fs.readdirSync=readdir;}assert.equal(removed,true);
 });
 temporary(root=>{clock(epoch+1000,()=>freeze(root,input()));const stage=files(root,'objects')[0]+'.0123456789abcdef.tmp';fs.writeFileSync(stage,'partial',{mode:0o600});const lstat=fs.lstatSync;fs.lstatSync=(file,...args)=>{if(file===stage)throw Object.assign(Error('denied stage'),{code:'EACCES'});return lstat(file,...args);};try{assert.throws(()=>read(root,{symbol:'600001',provider:'eastmoney'}),/校验/);}finally{fs.lstatSync=lstat;}});
});
test('a receipt published between directory snapshots can be read because its object was already published',()=>temporary(root=>{
 clock(epoch+1000,()=>freeze(root,input()));const receiptDir=path.dirname(files(root,'receipts')[0]),readdir=fs.readdirSync;let published=false,second;
 fs.readdirSync=(selected,...args)=>{const names=readdir(selected,...args);if(!published&&selected===receiptDir){published=true;second=clock(epoch+3000,()=>freeze(root,input({decisionAt:epoch+2000,trigger:'second'})));}return names;};
 try{assert.equal(read(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+3000}).revision,1);}finally{fs.readdirSync=readdir;}assert.equal(read(root,{symbol:'600001',provider:'eastmoney',asOf:epoch+3000}).hash,second.hash);
}));
test('child output errors reject promises and cleanup waits for close after readiness or partial output',async()=>{
 for(const script of ["process.stdout.write('ready\\n');setInterval(()=>{},1000);","process.stdout.write(JSON.stringify({event:'ready'})+'\\n');setInterval(()=>{},1000);"]){
  const worker=publicationWorker(script,[]);try{if(script.includes("'ready\\n'"))await assert.rejects(worker.ready,SyntaxError);else await worker.ready;}finally{if(worker.child.exitCode===null&&worker.child.signalCode===null)worker.child.kill();await worker.closed;}await assert.rejects(worker.done);
 }
});
test('two processes freezing identical evidence publish one receipt and preserve a recoverable object',async()=>temporary(publicationRace));
test('fifty independent real two-process publications retain one receipt with different recording clocks',async()=>{
 for(let i=0;i<50;i++)await temporary(publicationRace);
});
