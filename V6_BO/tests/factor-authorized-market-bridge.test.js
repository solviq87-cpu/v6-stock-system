'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {adaptAuthorizedHistory}=require('../src/core/factor-authorized-market-bridge');
const {captureFactorEpisode}=require('../src/core/factor-evidence-capture');
const {runOnce:bridgeOnce,assertMarketAppend,parse:bridgeParse}=
 require('../scripts/authorized-factor-market');
const {inspect:preflight,parse:preflightParse}=
 require('../scripts/factor-source-preflight');
const at=(day,time='16:04:00')=>Date.parse(day+'T'+time+'+08:00');
function weekdays(n){
 const out=[];let stamp=Date.parse('2026-08-17T00:00:00Z');
 while(out.length<n){
  const date=new Date(stamp);
  if(date.getUTCDay()!==0&&date.getUTCDay()!==6)
   out.push(date.toISOString().slice(0,10));
  stamp+=86400000;
 }
 return out;
}
const dates=weekdays(40),symbols=['600001','600002','600003','600004','600005'];
function imported(days=33){
 const asOf=dates[days-1];
 return {schemaVersion:1,source:'imported',provider:'unit-authorized-contract-only',
  datasetId:'unit-price-history',priceBasis:'unadjusted',asOf,
  observedAt:at(asOf,'16:03:00'),
  stocks:symbols.map((symbol,j)=>({symbol,corporateActions:[],
   bars:dates.slice(0,days).map((date,i)=>{
    const close=10+j*.1+i*.01;
    return {date,open:close,high:close+.02,low:close-.02,
     close,volume:100+i,priceBasis:'unadjusted',suspended:false};
   })}))};
}
function inputs(days=33){
 const history=imported(days),asOf=history.asOf;
 const candidates={asOf:at(asOf,'16:00:35'),board:'all',
  totalScanned:4200,count:symbols.length,
  items:symbols.map(code=>({code,hit:[{id:1,text:'unit-test pick'}],hitIds:[1]}))};
 const factorSnapshot={schemaVersion:1,feed:{
  source:'imported',provider:'unit-factor-source',datasetId:'unit-factor-batch'
 },asOf:at(asOf,'16:00:25'),
 rows:symbols.map((code,i)=>({
  code,feed:{source:'unit-factor-source',timestamp:at(asOf,'15:00:00')},
  sectorHeatScore:20+i*10,leaderStrengthScore:75-i*5,
  factorEvidence:{
   sectorHeatScore:{source:'unit-factor-source',
    timestamp:at(asOf,'15:00:00'),code},
   leaderStrengthScore:{source:'unit-factor-source',
    timestamp:at(asOf,'15:00:00'),code}
  }
 }))};
 return {history,candidates,factorSnapshot,now:at(asOf)};
}
function folder(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-auth-factor-market-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return dir;
}
function saveInputs(dir,{history,candidates,factorSnapshot}){
 const historyFile=path.join(dir,'authorized-history.json'),
  picksFile=path.join(dir,'picks.json'),
  factorsFile=path.join(dir,'factors.json');
 fs.writeFileSync(historyFile,JSON.stringify(history));
 fs.writeFileSync(picksFile,JSON.stringify(candidates));
 fs.writeFileSync(factorsFile,JSON.stringify(factorSnapshot));
 return {historyFile,picksFile,factorsFile};
}
test('authorized history schema adapts exact source dates, price, provenance and closed timestamps',()=>{
 const d=inputs(),market=adaptAuthorizedHistory(d.history,{now:d.now});
 assert.equal(market.feed.source,'imported');
 assert.equal(market.feed.provider,d.history.provider);
 assert.equal(market.feed.datasetId,d.history.datasetId);
 assert.equal(market.feed.priceBasis,'unadjusted');
 assert.equal(market.asOf,d.history.asOf);
 assert.equal(market.observedAt,d.history.observedAt);
 assert.deepEqual(market.calendar,d.history.stocks[0].bars.map(b=>b.date));
 assert.equal(market.stocks.length,symbols.length);
 assert.equal(market.stocks[0].bars[0].close,d.history.stocks[0].bars[0].close);
 assert.equal(market.stocks[0].corporateActions.length,0);
 assert.match(market.externalSnapshotFingerprint,/^[a-f0-9]{64}$/);
 const frozen=captureFactorEpisode({candidates:d.candidates,market,
  factorSnapshot:d.factorSnapshot,now:d.now});
 assert.equal(frozen.cohort.signals.length,5);
 assert.equal(frozen.features.features.length,5);
 assert.equal(frozen.features.canTrade,false);
 assert.equal(frozen.features.prospectiveCertified,false);
});
test('missing source clock, before-close bar, unknown adjustments, or absent halt flags fail closed',()=>{
 const initial=inputs();
 const changes=[
  x=>{delete x.observedAt;},
  x=>{x.observedAt=at(x.asOf,'15:00:00');},
  x=>{x.priceBasis='adjusted';},
  x=>{x.source='fixture';},
  x=>{x.simulated=true;},
  x=>{delete x.stocks[0].bars[0].suspended;},
  x=>{delete x.stocks[0].corporateActions;},
  x=>{x.stocks[0].bars.at(-1).priceBasis='adjusted';},
  x=>{x.stocks[0].bars[1].date=x.stocks[0].bars[0].date;},
  x=>{x.stocks[0].bars.at(-1).close=null;},
  x=>{x.asOf=dates[0];}
 ];
 for(const change of changes){
  const bad=structuredClone(initial.history);change(bad);
  assert.throws(()=>adaptAuthorizedHistory(bad,{now:initial.now}),
   undefined,'must not invent halted prices, original time or basis');
 }
});
test('same-day changed imported prices cannot overwrite previously bridged history',()=>{
 const first=adaptAuthorizedHistory(imported(33),{now:at(dates[32])});
 const next=adaptAuthorizedHistory(imported(34),{now:at(dates[33])});
 assert.equal(assertMarketAppend(first,next),true);
 assert.equal(assertMarketAppend(first,first),false);
 const changed=structuredClone(next);
 changed.stocks[0].bars[2].close+=.01;
 assert.throws(()=>assertMarketAppend(first,changed),/回写/);
 const changedToday=structuredClone(first);
 changedToday.stocks[0].bars.at(-1).close+=.01;
 assert.throws(()=>assertMarketAppend(first,changedToday),/改价/);
 const deleted=structuredClone(next);
 deleted.stocks.pop();
 assert.throws(()=>assertMarketAppend(first,deleted),/来源|版本/);
 const source=structuredClone(next);
 source.feed.provider='other';
 assert.throws(()=>assertMarketAppend(first,source),/来源/);
});
test('bridge sync publishes private 0600 dataset and safely appends later trading dates',t=>{
 const dir=folder(t),d=inputs(),files=saveInputs(dir,d),
  out=path.join(dir,'private','market-current.json');
 const first=bridgeOnce({sourceFile:files.historyFile,outputFile:out,
  mode:'sync',now:d.now});
 assert.equal(first.status,'authorized-contract-adapted');
 assert.equal(fs.statSync(out).mode&0o777,0o600);
 const old=fs.readFileSync(out,'utf8');
 assert.ok(!old.includes('token'));
 const repeat=bridgeOnce({sourceFile:files.historyFile,outputFile:out,
  mode:'sync',now:d.now});
 assert.equal(repeat.status,'unchanged');
 assert.equal(fs.readFileSync(out,'utf8'),old);
 const next=inputs(34);
 fs.writeFileSync(files.historyFile,JSON.stringify(next.history));
 const appended=bridgeOnce({sourceFile:files.historyFile,outputFile:out,
  mode:'sync',now:next.now});
 assert.equal(appended.status,'authorized-contract-adapted');
 assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).asOf,dates[33]);
 assert.equal(fs.statSync(out).mode&0o777,0o600);
 const bad=structuredClone(next.history);
 // Mutate the old close just enough to remain within original OHLC
 // bounds; the append guard, not a generic malformed-bar check, must reject.
 bad.stocks[0].bars[0].close+=.001;
 fs.writeFileSync(files.historyFile,JSON.stringify(bad));
 assert.throws(()=>bridgeOnce({sourceFile:files.historyFile,outputFile:out,
  mode:'sync',now:next.now}),/回写|改价/);
 assert.equal(JSON.parse(fs.readFileSync(out,'utf8')).asOf,dates[33]);
});
test('preflight reports readiness without writing, even when a source or signal is invalid',t=>{
 const dir=folder(t),d=inputs(),files=saveInputs(dir,d);
 const result=preflight({...files,now:d.now});
 assert.equal(result.status,'local-contract-ready-not-certified');
 assert.equal(result.contractReady,true);
 assert.equal(result.providerCertified,false);
 assert.equal(result.liveDeployed,false);
 assert.equal(result.canTrade,false);
 assert.equal(result.checks.length,2);
 assert.equal(result.checks[1].signals,5);
 assert.deepEqual(result.checks[1].availableFactorIds,
  ['sector_heat','leader_strength']);
 assert.equal(fs.readdirSync(dir).length,3,'preflight must never write snapshots');
 const before=preflight({...files,now:at(d.history.asOf,'15:58:00')});
 assert.equal(before.contractReady,false);
 assert.equal(before.checks[0].ok,false);
 const bad=structuredClone(d.factorSnapshot);
 bad.rows[0].factorEvidence.leaderStrengthScore.source='unauthorized-rewrite';
 fs.writeFileSync(files.factorsFile,JSON.stringify(bad));
 const rejected=preflight({...files,now:d.now});
 assert.equal(rejected.contractReady,false);
 assert.equal(rejected.checks[0].ok,true);
 assert.equal(rejected.checks[1].ok,false);
 assert.equal(fs.readdirSync(dir).length,3);
});
test('bridge does not allow public paths, self-overwrite or symlink aliases',t=>{
 const dir=folder(t),d=inputs(),files=saveInputs(dir,d);
 assert.throws(()=>bridgeParse(['once',files.historyFile,files.historyFile]),/同一文件/);
 assert.throws(()=>bridgeParse(['sync',files.historyFile,
  path.join(dir,'public','market.json')]),/公开/);
 const alias=path.join(dir,'shortcut');
 fs.symlinkSync(dir,alias);
 assert.throws(()=>bridgeParse(['once',files.historyFile,
  path.join(alias,'new-market.json')]),/符号链接/);
 assert.throws(()=>preflightParse([files.historyFile,
  'relative-file.json',files.factorsFile]),/绝对路径/);
 assert.equal(bridgeParse(['watch',files.historyFile,
  path.join(dir,'private','report.json'),'--interval','30000']).interval,30000);
 assert.throws(()=>bridgeParse(['watch',files.historyFile,
  path.join(dir,'private','report.json'),'--interval','1000']),/轮询/);
});
