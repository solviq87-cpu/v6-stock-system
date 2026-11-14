#!/usr/bin/env node
'use strict';
// Only public, reviewed metadata is published. This builder neither loads a
// model nor consumes a workspace/account directory or network endpoint.
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..'),CONFIG=path.join(ROOT,'config/open-model-library-20261114.json'),OUTPUT=path.join(ROOT,'public/assets/model-library-catalog.json');
const CATEGORIES=['language','forecast','finance-text','workflow','interface','runtime','evaluation','data'];
function validateCatalog(c){
 if(c?.schemaVersion!==1||c.reviewDate!=='2026-11-14'||!Array.isArray(c.entries)||!c.entries.length||c.entries.length>100)throw Error('Invalid public catalog');
 const ids=new Set(),sources=new Set();
 for(const m of c.entries){
  if(!/^[A-Z]\d{2}$/.test(m.id||'')||ids.has(m.id)||!CATEGORIES.includes(m.category)||!['implemented','candidate','reference-only'].includes(m.adoption))throw Error('Invalid identity/category/adoption');ids.add(m.id);
  for(const k of ['name','kind','license','weightsLicense','limit','status','runtimeNotes'])if(typeof m[k]!=='string'||!m[k].trim()||m[k].length>3000)throw Error('Missing public comparison field: '+k);
  for(const k of ['borrow','runMode'])if(!Array.isArray(m[k])||!m[k].length||m[k].some(x=>typeof x!=='string'||!x.trim()))throw Error('Missing comparison axis: '+k);
  if(!Array.isArray(m.implementation)||m.implementation.some(x=>typeof x.label!=='string'||typeof x.path!=='string'||!x.path.startsWith('V6_BO/')||x.path.includes('..')))throw Error('Invalid adoption location');
  if(m.adoption==='implemented'&&!m.implementation.length)throw Error('Implemented pattern requires a V6 location');
  if(m.installed!==false||m.inferenceExecuted!==false||m.v6MeasuredAccuracy!==null||m.v6MeasuredLatencyMs!==null)throw Error('Catalog is not evidence of upstream execution');
  if(m.repository!==null&&(!/^[\w.-]+\/[\w.-]+$/.test(m.repository)||!/^[a-f0-9]{40}$/.test(m.commit||'')))throw Error('Repository requires a pinned revision');
  if(m.repository===null&&m.commit!==null)throw Error('Documentation-only source cannot invent a commit');
  const key=m.repository?.toLowerCase()||m.name;if(sources.has(key))throw Error('Duplicate public source');sources.add(key);
  if(!Array.isArray(m.reads)||!m.reads.length)throw Error('Missing reviewed sources');
  for(const r of m.reads){
   let url;try{url=new URL(r.url);}catch{throw Error('Invalid source URL');}
   if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('Source URL must be public and immutable where possible');
   if(m.repository&&r.path&&r.url!=='https://github.com/'+m.repository+'/blob/'+m.commit+'/'+r.path)throw Error('Source URL revision mismatch');
   if(r.blobSha!=null&&!/^[a-f0-9]{40}$/.test(r.blobSha))throw Error('Invalid reviewed blob');
  }
 }
 return c;
}
function buildCatalog(input=JSON.parse(fs.readFileSync(CONFIG,'utf8'))){
 validateCatalog(input);
 return {schemaVersion:1,reviewDate:input.reviewDate,scope:'公开模型、界面与运行设计对照；采用状态指设计落实，未运行上游模型',sourceCount:input.entries.length,
  upstreamCodeCopied:false,weightsDownloaded:false,modelAPIsAdded:0,
  categories:CATEGORIES.map(id=>({id,count:input.entries.filter(m=>m.category===id).length})),entries:input.entries};
}
function serialize(input){return JSON.stringify(buildCatalog(input),null,2)+'\n';}
if(require.main===module){
 try{if(process.argv.slice(2).some(x=>x!=='--check'))throw Error('Only --check is supported');const out=serialize();
  if(process.argv.includes('--check')){if(fs.readFileSync(OUTPUT,'utf8')!==out)throw Error('Public catalog drift; run node scripts/build-model-library.js');}
  else fs.writeFileSync(OUTPUT,out);
  process.stdout.write('Public model library '+(process.argv.includes('--check')?'verified':'built')+'\n');
 }catch(e){process.stderr.write(e.message+'\n');process.exitCode=1;}
}
module.exports={CATEGORIES,validateCatalog,buildCatalog,serialize};
