'use strict';
// Run from V6_BO with the isolated, synthetic history stored beside this script.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync,execFileSync}=require('node:child_process');
const {createFixture}=require(path.resolve('tests/helpers/v6-studio-fixture'));
const out=process.env.FAYO_STUDY_RECEIPTS||__dirname,history=JSON.parse(fs.readFileSync(path.join(__dirname,'history.json')));
const allowed=structuredClone(history),s=allowed.stocks[0];
Object.assign(s,{isST:false,limitPct:10,noPriceLimit:false,ipoNoLimit:false,sealQualityScore:90,auctionQualityScore:90,sectorHeatScore:90,promotionScore:90});
for(const k of ['trendScore','relativeStrengthScore','maAlignmentScore','momentumScore','closeStrengthScore','turnoverQualityScore','breakoutScore','volumeScore','positionScore','fundFlowScore','liquidityScore','oversoldScore','reversalScore'])s[k]=90;
s.riskScore=10;
for(const b of s.bars)Object.assign(b,{open:10,high:10,low:10,close:10,volume:100000,isST:false,limitPct:10,noPriceLimit:false,ipoNoLimit:false});
Object.assign(s.bars.at(-1),{open:11,high:11,low:11,close:11,volume:200000});
allowed.universeHistory=[{symbol:s.symbol,from:s.bars[0].date,through:allowed.asOf,eligible:true,source:'isolated-membership',knownAt:'2025-12-31T00:00:00Z'}];
const excluded=structuredClone(allowed);excluded.universeHistory[0].eligible=false;
const late=structuredClone(allowed);late.universeHistory[0].knownAt=allowed.asOf+'T15:00:00.001+08:00';
const gap=structuredClone(allowed);gap.universeHistory[0].through=s.bars.at(-2).date;
const legacy=structuredClone(allowed);delete legacy.universeHistory;
const cases=[['membership-allowed.json',allowed,true],['membership-excluded.json',excluded,false],['membership-late.json',late,false],['membership-gap.json',gap,false],['membership-legacy.json',legacy,true]];
for(const [name,h] of cases)fs.writeFileSync(path.join(out,name),JSON.stringify(h));
(async()=>{const f=await createFixture({count:0});try{
 const route='/api/research/complete-run',rows=[];
 for(const [name,h,expected] of cases){
  const r=await f.request(route,'POST',{history:h});assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.ok,true);
  const v=r.body.result,c=v.selectionEvidence.candidates[0],matched=c.rationale.selection.watchEligible;
  assert.ok(c.rationale.selection.rules.some(x=>x.id==='playbook:first_board_quality'));
  assert.equal(v.selectionEvidence.researchWatchlist.length,expected?1:0);
  assert.equal(v.selectionEvidence.universeExcluded,expected?0:1);
  assert.equal(c.historicalModelPassed,expected);assert.equal(v.selectionEvidence.modelPassedCount,expected?1:0);
  assert.equal(c.rationale.pointInTimeUniverse.verified,false);
  assert.equal(matched,expected);assert.equal(v.canTrade,false);assert.equal(v.dataset.historicalCoverage.status,'unknown');
  rows.push({input:name,sha256:crypto.createHash('sha256').update(JSON.stringify(h)).digest('hex'),http:r.status,matched,coverage:v.dataset.historicalCoverage,canTrade:v.canTrade,pointInTimeUniverse:c.rationale.pointInTimeUniverse,universeExcluded:v.selectionEvidence.universeExcluded,ruleIds:c.rationale.selection.rules.map(x=>x.id),modelPassedCount:v.selectionEvidence.modelPassedCount});
 }
 const denied=await f.request(route,'POST',{history},f.viewerToken);assert.equal(denied.body.result,undefined);
 if(process.env.FAYO_DATED_BROWSER){const p=spawnSync('python',[process.env.FAYO_DATED_BROWSER],{input:JSON.stringify({origin:'http://127.0.0.1:'+f.port,token:f.token,output:out}),encoding:'utf8',timeout:180000});if(p.status!==0)throw Error(p.stderr.slice(-1200));}
 const paths=['src/core/historical-universe.js','src/core/research-explanation-projection.js','src/core/complete-workbench.js','public/nova/research.js'];
 const r={scope:'Synthetic dated membership consumed by the original authenticated complete-run worker and original desktop/mobile research page. Existing declared-unverified membership and master contracts only. No ETF/type/exchange or source certification.',baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(paths.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),rows,viewerReturnedReport:false};
 fs.writeFileSync(path.join(out,'native.json'),JSON.stringify(r,null,2)+'\n');console.log(rows.map(r=>[r.input,r.matched]));
}finally{await f.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
