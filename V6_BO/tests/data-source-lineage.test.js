'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const path=require('node:path');
const registry=require('../config/data-source-registry-2026.json');
const legacy=require('../config/data-source-catalog.json');
const {sourceLineage,resolveUpstream,validateRegistry,sourceSummary}=require('../src/core/data-source-lineage');
test('wide source inventory is registered and tied to original publishers rather than counting SDK aliases',()=>{
 const r=validateRegistry();
 assert.equal(r.routeCount,120);assert.ok(r.claimedUpstreamGroups>=70);
 assert.ok(registry.researchRepositories.length>=30);
 assert.equal(r.underlyingProvidersVerified,0);
 assert.equal(r.authorizedLiveFeedsVerified,0);
 assert.equal(r.canTrade,false);
 assert.equal(registry.autoEnableNewProviders,false);
 assert.equal(new Set(registry.sources.map(x=>x.id)).size,r.routeCount);
});
test('all 14 historic sources remain and old sole enabled private collector is not silently expanded',()=>{
 for(const s of legacy.sources){
  const item=sourceLineage(s.id);
  assert.equal(item.known,true,s.id);
  assert.equal(item.active,false);
 }
 assert.deepEqual(registry.sources.filter(x=>x.access==='guarded-research').map(x=>x.id).sort(),
  ['baostock','eastmoney-public-history']);
 assert.equal(legacy.sources.find(x=>x.id==='baostock').access,'enabled-private-research');
});
test('six SDK labels are only three underlying tapes; no 6-vote false independence',()=>{
 const east=['eastmoney','efinance','akshare-em-daily','akshare-em-minute','stock-data-hub-efinance','cnequity-em','choice'];
 const sina=['sina','akshare-sina-minute','easyquotation-sina','akshare-sina-daily'];
 const tencent=['tencent','easyquotation-tencent','akshare-tencent-daily','ashare-tencent-route'];
 for(const id of east)assert.equal(resolveUpstream(id).group,'eastmoney',id);
 for(const id of sina)assert.equal(resolveUpstream(id).group,'sina',id);
 for(const id of tencent)assert.equal(resolveUpstream(id).group,'tencent',id);
 assert.equal(resolveUpstream('mootdx').group,'tdx');
 assert.equal(resolveUpstream('pytdx').group,'tdx');
 assert.equal(resolveUpstream('wbgapi').group,'worldbank');
 assert.equal(resolveUpstream('fredapi').group,'fred');
});
test('multi-provider frameworks, credential feeds and unknown sources do not inherit legitimacy',()=>{
 for(const id of ['ashare','openbb','qlib','vnpy','finance-datareader']){
  const entry=sourceLineage(id);
  assert.equal(entry.known,true);
  assert.equal(entry.upstreamAmbiguous,true);
  assert.equal(entry.canTrade,false);
 }
 assert.equal(resolveUpstream('ashare').group,null);
 assert.equal(resolveUpstream('ashare','sina').group,'sina');
 assert.throws(()=>resolveUpstream('efinance','tencent'),/目录不一致/);
 assert.throws(()=>resolveUpstream('pytdx-quote-route','eastmoney'),/目录不一致/);
 assert.equal(sourceLineage('unregistered-private-source').access,'unreviewed');
 assert.equal(sourceSummary().autoEnableNewProviders,false);
});
test('all registered routes have source evidence, controlled permissions and no hidden credentials',()=>{
 const txt=JSON.stringify(registry);
 assert.doesNotMatch(txt,/api[_-]?key.*[=:].{10}|Bearer [A-Za-z0-9]{15}|sharecode=/i);
 assert.ok(registry.sources.some(x=>x.id==='sec-edgar'));
 assert.ok(registry.sources.some(x=>x.id==='worldbank'));
 assert.ok(registry.sources.some(x=>x.id==='shfe'));
 assert.ok(registry.sources.some(x=>x.id==='cninfo'));
 assert.ok(registry.sources.some(x=>x.id==='yfinance'&&x.access==='permission-review'));
 assert.ok(registry.sources.some(x=>x.id==='fred'&&x.access==='credentials-required'));
 assert.ok(registry.sources.every(x=>x.evidenceUrl.startsWith('https://')));
});
test('dedicated registry audit is real executable and explicitly not a live connectivity test',()=>{
 const data=JSON.parse(execFileSync(process.execPath,[path.resolve(__dirname,'../scripts/audit-data-source-lineage.js')],{encoding:'utf8'}));
 assert.equal(data.ok,true);
 assert.equal(data.routeCount,120);
 assert.equal(data.authorizedLiveFeedsVerified,0);
 assert.equal(data.canTrade,false);
});

test('isolated server without mounted registry keeps bootable module but refuses any data consensus',()=>{
 const fs=require('node:fs'),os=require('node:os');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'v6-lineage-isolated-'));
 try{
  const src=path.resolve(__dirname,'../src/core/data-source-lineage.js');
  fs.copyFileSync(src,path.join(dir,'data-source-lineage.js'));
  const isolated=require(path.join(dir,'data-source-lineage.js'));
  assert.equal(isolated.sourceLineage('tencent').known,false);
  assert.throws(()=>isolated.resolveUpstream('tencent'),/目录缺失或损坏/);
  assert.throws(()=>isolated.validateRegistry(),/目录缺失或损坏/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('official SEC, ECB, BOJ and Treasury routes count underlying publishers, not duplicate SDKs',()=>{
 const s=validateRegistry();
 assert.equal(s.routeCount,120);assert.equal(s.canTrade,false);
 for(const id of ['sec-edgar','ecb','boj-statistics','us-treasury-fiscal','us-eia','japan-estat']){
  assert.equal(sourceLineage(id).known,true,id);
  assert.equal(sourceLineage(id).active,false,id);
  assert.equal(sourceLineage(id).canTrade,false,id);
 }
 assert.equal(sourceLineage('boj-statistics').market,'JP');
 assert.equal(resolveUpstream('ecb-fx-daily').group,'ecb');
 assert.equal(resolveUpstream('ecb').group,'ecb');
 assert.equal(resolveUpstream('us-treasury-average-rates').group,'us-treasury-fiscal');
 assert.equal(resolveUpstream('us-treasury-debt').group,'us-treasury-fiscal');
 assert.equal(resolveUpstream('us-treasury-fiscal').group,'us-treasury-fiscal');
 assert.equal(sourceLineage('us-eia').access,'credentials-required');
 assert.equal(sourceLineage('japan-estat').access,'credentials-required');
 assert.equal(sourceLineage('ecb').access,'registered-only');
 assert.equal(sourceLineage('sec-edgar').access,'registered-only');
 assert.equal(sourceLineage('sec-edgar').verifiedIndependent,false);
 assert.equal(registry.sources.find(x=>x.id==='sec-edgar').adapter,'sec-companyfacts.js');
 assert.equal(registry.sources.find(x=>x.id==='ecb').adapter,'ecb-fx-daily.js');
});
