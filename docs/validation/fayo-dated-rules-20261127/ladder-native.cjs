'use strict';
// Run from V6_BO with the isolated, synthetic history stored beside this script.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname,history=JSON.parse(fs.readFileSync(path.join(__dirname,'history.json')));
const normal=structuredClone(history),s=normal.stocks[0];
Object.assign(s,{isST:false,limitPct:10,noPriceLimit:false,ipoNoLimit:false,sealQualityScore:90,auctionQualityScore:90,sectorHeatScore:90,promotionScore:90});
for(const b of s.bars){Object.assign(b,{open:10,high:10,low:10,close:10,volume:100000});for(const k of ['limitPct','isST','noPriceLimit','ipoNoLimit'])delete b[k];}
Object.assign(s.bars.at(-1),{open:11,high:11,low:11,close:11,volume:200000});
const noLimit=structuredClone(normal);noLimit.stocks[0].noPriceLimit=true;
const ipo=structuredClone(normal);ipo.stocks[0].ipoNoLimit=true;
const dated=structuredClone(normal);Object.assign(dated.stocks[0],{noPriceLimit:true,ipoNoLimit:true,limitPct:null});
for(const b of dated.stocks[0].bars)Object.assign(b,{noPriceLimit:false,ipoNoLimit:false,limitPct:10});
const gap=structuredClone(normal);gap.stocks[0].bars[10].limitPct=null;
const cases=[['ladder-normal.json',normal,true],['ladder-no-limit.json',noLimit,false],['ladder-ipo.json',ipo,false],['ladder-dated.json',dated,true],['ladder-gap.json',gap,false]];
for(const [name,h] of cases)fs.writeFileSync(path.join(out,name),JSON.stringify(h));
(async()=>{const f=await createFixture({count:0});try{
 const route='/api/research/complete-run',rows=[];
 for(const [name,h,expected] of cases){
  const r=await f.request(route,'POST',{history:h});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);
  const v=r.body.result,c=v.selectionEvidence.candidates[0],matched=c.rationale.selection.rules.some(x=>x.id==='playbook:first_board_quality');
  assert.equal(matched,expected);assert.equal(v.canTrade,false);assert.equal(v.dataset.historicalCoverage.status,'unknown');
  rows.push({input:name,sha256:crypto.createHash('sha256').update(JSON.stringify(h)).digest('hex'),http:r.status,matched,coverage:v.dataset.historicalCoverage,canTrade:v.canTrade,backtest:v.backtest,paper:v.paper});
 }
 const scans=[];
 for(const [name,h,expected] of cases){
  const stocks=structuredClone(h.stocks);for(const s of stocks)s.feed={source:'imported',timestamp:Date.now()};
  const reply=await f.request('/api/research/scan','POST',{stocks});assert.equal(reply.status,200);assert.equal(reply.body.ok,true,JSON.stringify(reply.body));
  const row=reply.body.result.items[0];assert.equal(row.ladder.stage==='首板',expected);assert.equal(row.ladder.eligible,expected);
  if(!expected)assert.ok(row.ladder.reason);
  scans.push({input:name,http:reply.status,ladder:row.ladder,verifiedLive:reply.body.verifiedLive,provenance:reply.body.provenance});
 }
 const denied=await f.request(route,'POST',{history},f.viewerToken);assert.equal(denied.body.result,undefined);
 if(process.env.FAYO_DATED_BROWSER){const p=spawnSync('python',[process.env.FAYO_DATED_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out}),encoding:'utf8',timeout:180000});if(p.status!==0)throw Error(p.stderr.slice(-1200));}
 const paths=['src/strategy/historical-session.js','src/strategy/research-v2-limit-ladder-engine.js','src/strategy/universe-scanner.js','src/strategy/research-v2-universe-scanner.js','src/core/research-explanation-projection.js','public/nova/research.js'];
 const r={scope:'Synthetic history imported into the original authenticated complete-run worker and original desktop/mobile research workflow. No security status or price is externally certified.',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),rows,scans,viewerReturnedReport:false};
 fs.writeFileSync(path.join(out,'native.json'),JSON.stringify(r,null,2)+'\n');console.log(rows.map(r=>[r.input,r.matched]));
}finally{await f.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
