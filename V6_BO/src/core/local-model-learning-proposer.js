'use strict';
// Explicitly enabled local inference; the model can only suggest bounded data.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs');
const {performance}=require('node:perf_hooks');
const {proposeFromSealedResearch}=require('./factor-shadow-candidate-proposer');
const {modelCandidateBinding}=require('./factor-candidate-prereg');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const REASONS=new Set(['insufficient-independent-days','weak-average-information','unstable-daily-sign','recent-factor-decay-or-sign-reversal','unstable-five-session-block-direction','latest-five-session-block-reversal','single-day-influence-dominates','opposing-market-regime-effects']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const fail=()=>{throw Error('本地模型研究候选校验失败');};
const inputProjection=x=>({source:x.source,definitions:x.definitions,acceptedWeights:x.acceptedWeights,
 packFingerprint:x.packFingerprint,latestFrozenDay:x.latestFrozenDay});
const completed=x=>x?.done===true&&(!Object.hasOwn(x,'done_reason')||x.done_reason==='stop');
function config({endpoint='http://127.0.0.1:11434',model,digest,timeoutMs=30000}={}){
 let url;try{url=new URL(endpoint);}catch{fail();}
 if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.port||!/^\d+$/.test(url.port)||+url.port<1||+url.port>65535||typeof model!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)||digest!=null&&!/^(?:sha256:)?[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail();
 return {url,model,digest:digest?.replace(/^sha256:/,''),timeoutMs};
}
function request(url,method,body,deadline){return new Promise((resolve,reject)=>{
 const remaining=Math.ceil(deadline-performance.now());if(remaining<=0)return reject(Error('本地模型请求超时'));
 const data=body===null?null:Buffer.from(JSON.stringify(body));if(data&&data.length>65536)return reject(Error('本地模型请求过大'));
 const req=http.request(url,{method,headers:data?{'content-type':'application/json','content-length':data.length}:{},agent:false},res=>{
  if(res.statusCode!==200){res.resume();reject(Error('本地模型请求失败'));return;}
  let size=0,parts=[];res.on('data',chunk=>{size+=chunk.length;if(size>65536){req.destroy(Error('本地模型响应过大'));return;}parts.push(chunk);});
  res.on('end',()=>{if(performance.now()>deadline){reject(Error('本地模型请求超时'));return;}try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(Error('本地模型响应格式无效'));}});res.on('error',()=>reject(Error('本地模型响应失败')));
 });
 const timer=setTimeout(()=>req.destroy(Error('本地模型请求超时')),remaining);
 req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(Error('本地模型请求失败或超时')));if(data)req.write(data);req.end();
});}
// Ollama's chat endpoint is stateless. For registered shortline aliases a
// generate-context can cache only the public vocabulary, never a prior sample
// or a candidate response. An endpoint without this feature gets a standalone
// chat with its vocabulary attached anew.
const glossaries=new Map();
async function codedRequest(cfg,digest,payload,entries,version,deadline){
 const glossary=entries.map(({code,name,meaning,conditions})=>({code,name,meaning,...(conditions?{conditions}:{})}));
 const key=hash([cfg.url.origin,cfg.model,digest,version,glossary]);
 let tokens=glossaries.get(key);
 if(!tokens){
   const prompt='Load this public factor dictionary. Reply OK. '+JSON.stringify({dictionary:version,mapping:glossary});
   const bootstrap=await request(new URL('/api/generate',cfg.url),'POST',{model:cfg.model,stream:false,think:false,prompt,options:{temperature:0,seed:0,num_predict:3}},deadline).catch(()=>null);
   if(completed(bootstrap)&&bootstrap.model===cfg.model&&Array.isArray(bootstrap.context)&&bootstrap.context.length>0&&bootstrap.context.length<=8192&&bootstrap.context.every(n=>Number.isSafeInteger(n)&&n>=0&&n<10000000))tokens=bootstrap.context;
 }
 if(tokens){
   const sent={model:cfg.model,stream:false,think:false,format:payload.format,options:payload.options,context:tokens,
     prompt:payload.messages[0].content+'\n'+JSON.stringify({dictionary:version,...JSON.parse(payload.messages[1].content)})};
   const result=await request(new URL('/api/generate',cfg.url),'POST',sent,deadline).catch(()=>null);
   if(result?.done===true&&result.model===cfg.model&&typeof result.response==='string'){
     return {response:{model:result.model,done:true,...(Object.hasOwn(result,'done_reason')?{done_reason:result.done_reason}:{}),message:{role:'assistant',content:result.response}},
       fingerprint:hash([key,sent]),remember(){if(glossaries.size>=4&&!glossaries.has(key))glossaries.delete(glossaries.keys().next().value);glossaries.set(key,tokens);}};
   }
   glossaries.delete(key);
 }
 const standalone={...payload,messages:[payload.messages[0],{role:'user',content:JSON.stringify({dictionary:version,mapping:glossary,...JSON.parse(payload.messages[1].content)})}]};
 return {response:await request(new URL('/api/chat',cfg.url),'POST',standalone,deadline),fingerprint:hash(standalone)};
}
async function proposeLocalModel(input,options){
 // Freeze the complete relevant caller input before any asynchronous work.
 // A changed caller view cannot receive a candidate bound to an older report.
 const original=input;
 try{input=structuredClone(inputProjection(original));}catch{fail();}
 const inputFingerprint=hash(input);
 const recheck=()=>{try{if(hash(inputProjection(original))!==inputFingerprint)fail();}catch{fail();}};
 recheck();
 const cfg=config(options),ids=Array.isArray(input?.definitions)?input.definitions.map(d=>d?.id):[];
 if(ids.length<2||ids.length>100||ids.some(id=>typeof id!=='string'||!(/^[a-zA-Z0-9_]{1,80}$/.test(id)||/^[a-zA-Z0-9_]+(?:-[a-zA-Z0-9_]+)+$/.test(id)&&id.length<=80)||['__proto__','constructor','prototype'].includes(id)))fail();
 const prior=proposeFromSealedResearch({...input,allowUnchanged:true});
 const shortIds=ids.filter(id=>/^[A-Z]{2}-\d+$/.test(id));
 let dict=null,entries=[];
 if(shortIds.length){
   const {factorDictionary}=await import('../../public/nova/shortline/factor-dictionary.mjs');
   dict=factorDictionary(require('../../public/nova/shortline/catalog.json'));entries=shortIds.map(id=>dict.byCode.get(id));
   if(entries.some(e=>!e))fail();
 }
 recheck();
 const deadline=performance.now()+cfg.timeoutMs;
 const tags=await request(new URL('/api/tags',cfg.url),'GET',null,deadline);
 recheck();
 const matches=Array.isArray(tags?.models)?tags.models.filter(m=>m?.name===cfg.model):[];
 const digest=matches[0]?.digest?.replace(/^sha256:/,'');
 if(matches.length!==1||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||cfg.digest&&cfg.digest!==digest)fail();
 // Structured evidence can only justify moving toward the deterministic
 // prior-training reference, not inventing a direction or a larger change.
 // Older sparse reports retain their original bounded hypothesis semantics.
 const structured=prior.evidenceReview.grade==='structured-summary-unverified';
 const bounds=d=>{
  const old=input.acceptedWeights[d.id],ref=prior.candidateWeights[d.id];
  const lo=Math.max(d.baseWeight*.5,old*.92),hi=Math.min(d.baseWeight*1.5,old*1.08);
  return structured?{minimumWeight:Math.max(lo,Math.min(old,ref)),maximumWeight:Math.min(hi,Math.max(old,ref))}:
   {minimumWeight:lo,maximumWeight:hi};
 };
 const factors=input.definitions.map(d=>({id:d.id,baseWeight:d.baseWeight,acceptedWeight:input.acceptedWeights[d.id],...bounds(d),referenceCandidateWeight:prior.candidateWeights[d.id],suggestedWeightMultiplier:input.source.factorLearning[d.id].suggestedWeightMultiplier,reliable:input.source.factorLearning[d.id].reliable===true,redundancySuppressed:(input.source.factorRedundancy?.suppressedFactorIds||[]).includes(d.id),days:Number.isSafeInteger(input.source.factorLearning[d.id].days)?input.source.factorLearning[d.id].days:null,meanIC:finite(input.source.factorLearning[d.id].meanIC)?input.source.factorLearning[d.id].meanIC:null,recentMeanIC:finite(input.source.factorLearning[d.id].recentMeanIC)?input.source.factorLearning[d.id].recentMeanIC:null,reasons:Array.isArray(input.source.factorLearning[d.id].reasons)?input.source.factorLearning[d.id].reasons.filter(x=>REASONS.has(x)).slice(0,20):[]}));
 const properties=Object.fromEntries(input.definitions.map(d=>[d.id,{type:'number',minimum:bounds(d).minimumWeight,maximum:bounds(d).maximumWeight}]));
 const format={type:'object',additionalProperties:false,required:['candidateWeights','rationale'],properties:{candidateWeights:{type:'object',additionalProperties:false,required:ids,properties},rationale:{type:'string',maxLength:120}}};
 const payload={model:cfg.model,stream:false,think:false,format,messages:[{role:'system',content:'Suggest ABSOLUTE factor weights, not multipliers, from aggregate sealed prior-training summaries. For every factor use minimumWeight <= weight <= maximumWeight; referenceCandidateWeight is a bounded starting suggestion. Keep accepted weights unchanged when the evidence does not justify a change. Return JSON only, with a rationale at most 120 characters. No trading, tools, code, or external data.'},{role:'user',content:JSON.stringify({factors})}],options:{temperature:0,seed:0,num_predict:1024}};
 const exchange=entries.length?await codedRequest(cfg,digest,payload,entries,dict.version,deadline):
   {response:await request(new URL('/api/chat',cfg.url),'POST',payload,deadline),fingerprint:hash(payload)};
 const {response}=exchange;
 recheck();
 const tagsAfter=await request(new URL('/api/tags',cfg.url),'GET',null,deadline);
 recheck();
 if(performance.now()>deadline)fail();
 const after=Array.isArray(tagsAfter?.models)?tagsAfter.models.filter(m=>m?.name===cfg.model):[];
 if(after.length!==1||after[0]?.digest?.replace(/^sha256:/,'')!==digest)fail();
 if(response?.model!==cfg.model||!completed(response)||response.message?.role!=='assistant'||typeof response.message.content!=='string'||Buffer.byteLength(response.message.content)>65536)fail();
 let result;try{result=JSON.parse(response.message.content);}catch{fail();}
 if(!result||Array.isArray(result)||Object.keys(result).sort().join(',')!=='candidateWeights,rationale'||typeof result.rationale!=='string'||result.rationale.length>120||!result.candidateWeights||Array.isArray(result.candidateWeights)||Object.keys(result.candidateWeights).length!==ids.length||ids.some(id=>!Object.hasOwn(result.candidateWeights,id)))fail();
 for(const d of input.definitions){const w=result.candidateWeights[d.id],{minimumWeight,maximumWeight}=bounds(d);if(!finite(w)||w<=0||w<minimumWeight-1e-8||w>maximumWeight+1e-8)fail();}
 exchange.remember?.();
 const candidateWeights=Object.fromEntries(input.definitions.map(d=>[d.id,Math.min(bounds(d).maximumWeight,Math.max(bounds(d).minimumWeight,result.candidateWeights[d.id]))]));
 const status=ids.every(id=>candidateWeights[id]===input.acceptedWeights[id])?'model-retained-unchanged':prior.status;
 const weightChanges=prior.weightChanges.map(row=>({...row,referenceCandidateWeight:row.proposedWeight,proposedWeight:candidateWeights[row.factorId]}));
 const outputReview={policy:structured?'structured-reference-interval':'legacy-envelope-only',
  rationaleVerified:false,sourceAuthenticated:false,trainingEligible:false,autoPromotion:false};
 const candidateBindingFingerprint=modelCandidateBinding({autoSourceFingerprint:prior.sourceFingerprint,packFingerprint:input.packFingerprint,
  latestFrozenSignalDay:input.latestFrozenDay,factorDefinitionsFingerprint:hash(input.definitions),factorIds:ids,
  acceptedWeights:input.acceptedWeights,candidateWeights});
 return {...prior,status,candidateWeights,weightChanges,outputReview,modelProvenance:{modelName:cfg.model,digest,...(dict?{dictionaryVersion:dict.version,dictionaryFingerprint:hash(entries)}:{}),requestFingerprint:exchange.fingerprint,responseFingerprint:hash(result),hypothesis:{label:'model-hypothesis',rationale:result.rationale},candidateBindingFingerprint,outputReview,method:'ollama-native-structured',algorithmFingerprint:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')}};
}
module.exports={proposeLocalModel};
