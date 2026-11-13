'use strict';
// Fixed source-only dependency inventory; never scan require.cache or runtime data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const FILES=Object.freeze(['server.js','analysis.js','bazi.js','myrules.js','logic.js','learnall.js','ztpre.js','nextplan.js','kline_lang.js','_shortline.js',
 'src/strategy/strategy-service.js','src/core/probability-contract.js','src/core/quote-observation-view.js','src/core/signal-evidence-chain.js',
 'src/core/recommendation-evidence-review.js','src/core/signal-rule-manifest.js',
 'src/core/news-sentiment.js','src/core/news-signal-evidence.js','src/core/news-evidence-journal.js'].sort());
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function buildSignalRuleSourceManifest(root){
 if(typeof root!=='string'||!path.isAbsolute(root))throw Error('策略源码根目录无效');
 let total=0;
 const files=FILES.map(relative=>{
  try{
   const filename=path.join(root,relative),stat=fs.lstatSync(filename);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024||total+stat.size>64*1024*1024)throw Error('source unavailable');
   total+=stat.size;
   return {path:relative,status:'known',sha256:digest(fs.readFileSync(filename))};
  }catch{return {path:relative,status:'unknown',sha256:null};}
 });
 const manifest={schemaVersion:1,status:files.every(file=>file.status==='known')?'complete':'partial',files};
 return Object.freeze({...manifest,files:Object.freeze(files.map(Object.freeze)),fingerprint:digest(JSON.stringify(manifest))});
}
module.exports={buildSignalRuleSourceManifest};
