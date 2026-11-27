'use strict';
// Run from V6_BO on one machine, using benchmark-input.json from native-account.cjs.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const crypto=require('node:crypto'),{execFileSync}=require('node:child_process'),Module=require('node:module');
const folder=process.env.FAYO_STUDY_RECEIPTS||__dirname;
const base='b936ebdddb8c11948dd0e63f95332898dd5c1cf5',rel='src/core/intelligence-execution-validation.js',filename=path.resolve(rel);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const fixture=JSON.parse(fs.readFileSync(path.join(folder,'benchmark-input.json'))),plan=fixture.plans[0],planBytes=JSON.stringify(plan);
const first=fixture.trades.find(x=>x.shares===100);assert.ok(first);
const trades=Array.from({length:240},(_,i)=>{
 const t=structuredClone(first),p=t.paperSettlement;t.exitTimestamp=p.exitTimestamp+=i;t.id='paper-'+hash(JSON.stringify([p.accountId,p.exitEventId='bench-exit-'+i]));
 p.exitOrderId='bench-order-'+i;t.sourceFingerprint=hash(JSON.stringify(p));return t;
});
const archive={scope:fixture.scope,plans:[plan],trades},now=Date.parse(first.createdAt)+86400000;
const texts={before:execFileSync('git',['show',base+':V6_BO/'+rel],{encoding:'utf8'}),after:fs.readFileSync(filename,'utf8')};
function runner(source,count){
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));
 if(count){const real=mod.require.bind(mod);mod.require=id=>id!=='node:crypto'?real(id):{...crypto,createHash(...args){const h=crypto.createHash(...args),update=h.update.bind(h);h.update=(value,...rest)=>{if(value===planBytes)count.planSha256++;return update(value,...rest);};return h;}};}
 mod._compile(source,filename);return ()=>mod.exports.buildExecutionValidation(archive,{folds:[]},{now});
}
const counters={before:{planSha256:0},after:{planSha256:0}},before=runner(texts.before,counters.before)(),after=runner(texts.after,counters.after)();
const {settledEntryCosts,...common}=after;assert.deepEqual(common,before);assert.equal(after.acceptedTrades,240);assert.equal(settledEntryCosts.withBenchmark,240);
assert.deepEqual([counters.before.planSha256,counters.after.planSha256],[480,1]);
const run={before:runner(texts.before),after:runner(texts.after)};
const samples={before:[],after:[]};
for(let i=0;i<25;i++)for(const name of i%2?['before','after']:['after','before']){
 const cpu=process.cpuUsage(),start=process.hrtime.bigint();run[name]();const end=process.hrtime.bigint(),use=process.cpuUsage(cpu);
 if(i>=4)samples[name].push({wallMs:Number(end-start)/1e6,cpuMs:(use.user+use.system)/1000});
}
function quantile(rows,key,fraction){const values=rows.map(x=>x[key]).sort((a,b)=>a-b);return +values[Math.ceil(values.length*fraction)-1].toFixed(3);}
const out={scope:'controlled single process, synthetic 240 unique settlements with one shared frozen plan; no real market performance claim',baseline:base,sourceFiles:Object.fromEntries(Object.entries(texts).map(([n,s])=>[n,hash(s)])),node:process.version,cpu:os.cpus()[0].model,arch:process.arch,corpusSha256:hash(JSON.stringify(archive)),matchedSettlements:after.acceptedTrades,matchedOriginalOutputs:true,planHashCalls:counters,rounds:21,warmup:4,measurements:Object.fromEntries(Object.entries(samples).map(([n,rows])=>[n,{wallMedianMs:quantile(rows,'wallMs',.5),wallP95Ms:quantile(rows,'wallMs',.95),cpuMedianMs:quantile(rows,'cpuMs',.5),samples:rows}]))};
fs.writeFileSync(path.join(folder,'benchmark.json'),JSON.stringify(out,null,2)+'\n');console.log(out.planHashCalls,Object.fromEntries(Object.entries(out.measurements).map(([n,v])=>[n,[v.wallMedianMs,v.wallP95Ms]])));
