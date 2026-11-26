'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const source=path.resolve(__dirname,'../src/core/data-source-lineage.js');
function catalogue(){
 const ids=['eastmoney','efinance','tencent','baostock','eastmoney-public-history',...Array.from({length:9},(_,i)=>'source-'+i)];
 const sources=ids.map(id=>({id,upstreamGroup:id==='efinance'||id==='eastmoney-public-history'?'eastmoney':id,
  access:['baostock','eastmoney-public-history'].includes(id)?'guarded-research':'registered-only',
  market:'CN',dataClass:'history',evidenceUrl:'https://example.invalid/source',adapter:'research'}));
 return {registry:{schemaVersion:1,productionEntitlementGranted:false,autoEnableNewProviders:false,defaultCanTrade:false,sources},
  legacy:{sources:ids.map(id=>({id}))}};
}
function isolated(change,check){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-lineage-catalog-'));
 try{
  fs.mkdirSync(path.join(dir,'src/core'),{recursive:true});fs.mkdirSync(path.join(dir,'config'));
  fs.copyFileSync(source,path.join(dir,'src/core/data-source-lineage.js'));
  const data=catalogue();change(data);
  for(const [file,value] of [['data-source-registry-2026.json',data.registry],['data-source-catalog.json',data.legacy]])
   fs.writeFileSync(path.join(dir,'config',file),JSON.stringify(value));
  const mod=require(path.join(dir,'src/core/data-source-lineage.js'));
  check(mod,dir);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const failures=[
 ['wrong container shape',({registry})=>{registry.sources={};}],
 ['null route',({registry})=>{registry.sources[0]=null;}],
 ['invalid upstream field',({registry})=>{registry.sources[0].upstreamGroup=null;}],
 ['duplicate wrapper that changes the upstream',({registry})=>{registry.sources.push({...registry.sources[1],upstreamGroup:'tencent'});}],
 ['lost legacy source',({registry})=>{registry.sources[0]={...registry.sources[0],id:'replacement'};}],
 ['unauthorized activation',({registry})=>{registry.autoEnableNewProviders=true;}],
 ['extra enabled route',({registry})=>{registry.sources[1].access='guarded-research';}],
 ['malformed legacy catalogue',({legacy})=>{legacy.sources={};}],
 ['duplicate legacy identity',({legacy})=>{legacy.sources.push({...legacy.sources[0]});}]
];
for(const [name,change] of failures)test('invalid catalogue: '+name+' keeps module bootable and rejects consensus',()=>{
 isolated(change,mod=>{
  const lineage=mod.sourceLineage('eastmoney');
  assert.equal(lineage.known,false);assert.equal(lineage.canTrade,false);
  assert.throws(()=>mod.resolveUpstream('efinance'),/目录缺失或损坏/);
  assert.throws(()=>mod.sourceSummary(),/目录缺失或损坏/);
  assert.throws(()=>mod.validateRegistry(),/目录缺失或损坏/);
 });
});
test('valid catalogue retains upstream identity and uses an immutable route snapshot',()=>{
 isolated(()=>{},(mod,dir)=>{
  assert.equal(mod.resolveUpstream('efinance').group,'eastmoney');
  assert.equal(mod.resolveUpstream('eastmoney').group,'eastmoney');
  assert.equal(mod.validateRegistry().routeCount,14);
  const config=require(path.join(dir,'config/data-source-registry-2026.json'));
  config.sources[1].upstreamGroup='tencent';config.sources.push({...config.sources[0]});
  assert.equal(mod.resolveUpstream('efinance').group,'eastmoney');
  assert.equal(mod.sourceSummary().routeCount,14);
  assert.equal(mod.sourceSummary().claimedUpstreamGroups,12);
 });
});
