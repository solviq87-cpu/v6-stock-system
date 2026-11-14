'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {buildCatalog,validateCatalog,serialize}=require('../scripts/build-model-library');
const root=path.resolve(__dirname,'..'),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
test('public library preserves every previously reviewed source and fixed revision without inventing model results',()=>{
 const c=buildCatalog(),previous=[...read('docs/PUBLIC_COMPARISON_SOURCES_20261114.json').sources,...read('config/public-model-comparison-20261114.json').models];
 assert.ok(c.entries.length>previous.length);assert.equal(c.sourceCount,c.entries.length);
 for(const old of previous){const row=c.entries.find(m=>m.id===old.id);assert.ok(row,old.id);assert.equal(row.repository,old.repository);assert.equal(row.commit,old.commit);for(const r of old.reads)assert.ok(row.reads.some(x=>x.url===r.url));}
 assert.equal(c.upstreamCodeCopied,false);assert.equal(c.weightsDownloaded,false);assert.equal(c.modelAPIsAdded,0);
 assert.equal(fs.readFileSync(path.join(root,'public/assets/model-library-catalog.json'),'utf8'),serialize());
});
test('implemented claims point to real V6 files, source-only projects keep restrictions visible',()=>{
 const c=buildCatalog();for(const m of c.entries){for(const i of m.implementation)assert.equal(fs.statSync(path.join(root,'..',i.path)).isFile(),true,i.path);}
 const webui=c.entries.find(m=>m.repository==='open-webui/open-webui'),dify=c.entries.find(m=>m.repository==='langgenius/dify');
 assert.match(webui.license,/brand|品牌/i);assert.match(dify.license,/多租户|multi.tenant/i);
 const fin=c.entries.find(m=>m.repository==='SUFE-AIFLM-Lab/Fin-R1');assert.match(fin.license,/无|未|missing|unknown/i);assert.match(fin.limit,/许可|license/i);
});
test('invalid reuse claims, manufactured metrics, duplicate sources and mismatched evidence revisions cannot be published',()=>{
 const c=buildCatalog(),edit=fn=>{const v=structuredClone(c);fn(v);assert.throws(()=>validateCatalog(v));};
 edit(v=>v.entries[0].v6MeasuredAccuracy=.99);edit(v=>v.entries[0].inferenceExecuted=true);
 edit(v=>{v.entries[0].adoption='implemented';v.entries[0].implementation=[];});
 edit(v=>v.entries.push({...v.entries[0],id:'Z99'}));
 edit(v=>{v.entries[0].reads[0].url='https://github.com/'+v.entries[0].repository+'/blob/main/README.md';});
 edit(v=>v.entries[0].reads[0].url='javascript:alert(1)');edit(v=>v.entries[0].reads[0].url='https://user:secret@example.com/a');
 edit(v=>v.entries[0].implementation=[{label:'bad',path:'V6_BO/../../private'}]);
});
