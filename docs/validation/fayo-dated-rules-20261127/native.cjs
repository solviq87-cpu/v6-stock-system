'use strict';
// Run from V6_BO with the isolated, synthetic history stored beside this script.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname,history=JSON.parse(fs.readFileSync(path.join(out,'history.json')));
const unknown=structuredClone(history);unknown.stocks[0].bars.at(-1).limitPct=null;
const unlimited=structuredClone(history);unlimited.stocks[0].bars.at(-1).noPriceLimit=true;
fs.writeFileSync(path.join(out,'unknown.json'),JSON.stringify(unknown));fs.writeFileSync(path.join(out,'unlimited.json'),JSON.stringify(unlimited));
(async()=>{const f=await createFixture({count:0});try{
 const route='/api/research/complete-run',rows=[];
 for(const [name,h,expected] of [['history.json',history,true],['unknown.json',unknown,false],['unlimited.json',unlimited,false]]){
  const r=await f.request(route,'POST',{history:h});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);
  const v=r.body.result,c=v.selectionEvidence.candidates[0],matched=c.rationale.selection.rules.some(x=>x.id==='pattern:limit_up_shakeout_main');
  assert.equal(matched,expected);assert.equal(v.canTrade,false);assert.equal(v.dataset.historicalCoverage.status,'unknown');
  rows.push({input:name,sha256:crypto.createHash('sha256').update(JSON.stringify(h)).digest('hex'),http:r.status,matched,coverage:v.dataset.historicalCoverage,canTrade:v.canTrade,backtest:v.backtest,paper:v.paper});
 }
 const denied=await f.request(route,'POST',{history},f.viewerToken);assert.equal(denied.body.result,undefined);
 if(process.env.FAYO_DATED_BROWSER){const p=spawnSync('python',[process.env.FAYO_DATED_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out}),encoding:'utf8',timeout:180000});if(p.status!==0)throw Error(p.stderr.slice(-1200));}
 const paths=['src/strategy/historical-session.js','src/core/research-explanation-projection.js','public/nova/research.js'];
 const r={scope:'Synthetic history imported into the original authenticated complete-run worker and original desktop/mobile research workflow. No security status or price is externally certified.',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),rows,viewerReturnedReport:false};
 fs.writeFileSync(path.join(out,'native.json'),JSON.stringify(r,null,2)+'\n');console.log(rows.map(r=>[r.input,r.matched]));
}finally{await f.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
