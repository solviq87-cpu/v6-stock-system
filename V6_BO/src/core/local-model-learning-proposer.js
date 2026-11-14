'use strict';
// Explicitly enabled local inference; the model can only suggest bounded data.
const http=require('node:http'),crypto=require('node:crypto'),fs=require('node:fs');
const {proposeFromSealedResearch}=require('./factor-shadow-candidate-proposer');
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const REASONS=new Set(['insufficient-independent-days','weak-average-information','unstable-daily-sign','recent-factor-decay-or-sign-reversal','unstable-five-session-block-direction','latest-five-session-block-reversal','single-day-influence-dominates','opposing-market-regime-effects']);
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const fail=()=>{throw Error('本地模型研究候选校验失败');};
function config({endpoint='http://127.0.0.1:11434',model,digest,timeoutMs=30000}={}){
 let url;try{url=new URL(endpoint);}catch{fail();}
 if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!url.port||!/^\d+$/.test(url.port)||+url.port<1||+url.port>65535||typeof model!=='string'||! /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)||digest!=null&&!/^(?:sha256:)?[a-f0-9]{64}$/.test(digest)||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail();
 return {url,model,digest:digest?.replace(/^sha256:/,''),timeoutMs};
}
function request(url,method,body,deadline){return new Promise((resolve,reject)=>{
 const remaining=deadline-Date.now();if(remaining<=0)return reject(Error('本地模型请求超时'));
 const data=body===null?null:Buffer.from(JSON.stringify(body));if(data&&data.length>65536)return reject(Error('本地模型请求过大'));
 const req=http.request(url,{method,headers:data?{'content-type':'application/json','content-length':data.length}:{},agent:false},res=>{
  if(res.statusCode!==200){res.resume();reject(Error('本地模型请求失败'));return;}
  let size=0,parts=[];res.on('data',chunk=>{size+=chunk.length;if(size>65536){req.destroy(Error('本地模型响应过大'));return;}parts.push(chunk);});
  res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));}catch{reject(Error('本地模型响应格式无效'));}});res.on('error',()=>reject(Error('本地模型响应失败')));
 });
 const timer=setTimeout(()=>req.destroy(Error('本地模型请求超时')),remaining);
 req.on('close',()=>clearTimeout(timer));req.on('error',()=>reject(Error('本地模型请求失败或超时')));if(data)req.write(data);req.end();
});}
async function proposeLocalModel(input,options){
 const prior=proposeFromSealedResearch({...input,allowUnchanged:true}),cfg=config(options),ids=input.definitions.map(d=>d.id);
 if(ids.length>100||ids.some(id=>!/^[a-zA-Z0-9_]{1,80}$/.test(id)))fail();
 const deadline=Date.now()+cfg.timeoutMs;
 const tags=await request(new URL('/api/tags',cfg.url),'GET',null,deadline);
 const matches=Array.isArray(tags?.models)?tags.models.filter(m=>m?.name===cfg.model):[];
 const digest=matches[0]?.digest?.replace(/^sha256:/,'');
 if(matches.length!==1||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)||cfg.digest&&cfg.digest!==digest)fail();
 const bounds=d=>({minimumWeight:Math.max(d.baseWeight*.5,input.acceptedWeights[d.id]*.92),maximumWeight:Math.min(d.baseWeight*1.5,input.acceptedWeights[d.id]*1.08)});
 const factors=input.definitions.map(d=>({id:d.id,baseWeight:d.baseWeight,acceptedWeight:input.acceptedWeights[d.id],...bounds(d),referenceCandidateWeight:prior.candidateWeights[d.id],suggestedWeightMultiplier:input.source.factorLearning[d.id].suggestedWeightMultiplier,reliable:input.source.factorLearning[d.id].reliable===true,redundancySuppressed:(input.source.factorRedundancy?.suppressedFactorIds||[]).includes(d.id),days:Number.isSafeInteger(input.source.factorLearning[d.id].days)?input.source.factorLearning[d.id].days:null,meanIC:finite(input.source.factorLearning[d.id].meanIC)?input.source.factorLearning[d.id].meanIC:null,recentMeanIC:finite(input.source.factorLearning[d.id].recentMeanIC)?input.source.factorLearning[d.id].recentMeanIC:null,reasons:Array.isArray(input.source.factorLearning[d.id].reasons)?input.source.factorLearning[d.id].reasons.filter(x=>REASONS.has(x)).slice(0,20):[]}));
 const properties=Object.fromEntries(input.definitions.map(d=>[d.id,{type:'number',minimum:bounds(d).minimumWeight,maximum:bounds(d).maximumWeight}]));
 const format={type:'object',additionalProperties:false,required:['candidateWeights','rationale'],properties:{candidateWeights:{type:'object',additionalProperties:false,required:ids,properties},rationale:{type:'string',maxLength:120}}};
 const payload={model:cfg.model,stream:false,think:false,format,messages:[{role:'system',content:'Suggest ABSOLUTE factor weights, not multipliers, from aggregate sealed prior-training summaries. For every factor use minimumWeight <= weight <= maximumWeight; referenceCandidateWeight is a bounded starting suggestion. Keep accepted weights unchanged when the evidence does not justify a change. Return JSON only, with a rationale at most 120 characters. No trading, tools, code, or external data.'},{role:'user',content:JSON.stringify({factors})}],options:{temperature:0,seed:0,num_predict:1024}};
 const response=await request(new URL('/api/chat',cfg.url),'POST',payload,deadline);
 const tagsAfter=await request(new URL('/api/tags',cfg.url),'GET',null,deadline);
 const after=Array.isArray(tagsAfter?.models)?tagsAfter.models.filter(m=>m?.name===cfg.model):[];
 if(after.length!==1||after[0]?.digest?.replace(/^sha256:/,'')!==digest)fail();
 if(response?.model!==cfg.model||response.done!==true||response.message?.role!=='assistant'||typeof response.message.content!=='string'||Buffer.byteLength(response.message.content)>65536)fail();
 let result;try{result=JSON.parse(response.message.content);}catch{fail();}
 if(!result||Array.isArray(result)||Object.keys(result).sort().join(',')!=='candidateWeights,rationale'||typeof result.rationale!=='string'||result.rationale.length>120||!result.candidateWeights||Array.isArray(result.candidateWeights)||Object.keys(result.candidateWeights).length!==ids.length||ids.some(id=>!Object.hasOwn(result.candidateWeights,id)))fail();
 for(const d of input.definitions){const w=result.candidateWeights[d.id],old=input.acceptedWeights[d.id];if(!finite(w)||w<=0||w<old*.92-1e-8||w>old*1.08+1e-8||w<d.baseWeight*.5-1e-8||w>d.baseWeight*1.5+1e-8)fail();}
 const candidateWeights=Object.fromEntries(input.definitions.map(d=>[d.id,Math.min(bounds(d).maximumWeight,Math.max(bounds(d).minimumWeight,result.candidateWeights[d.id]))]));
 const status=ids.every(id=>candidateWeights[id]===input.acceptedWeights[id])?'model-retained-unchanged':prior.status;
 return {...prior,status,candidateWeights,modelProvenance:{modelName:cfg.model,digest,requestFingerprint:hash(payload),responseFingerprint:hash(result),hypothesis:{label:'model-hypothesis',rationale:result.rationale},method:'ollama-native-structured',algorithmFingerprint:crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex')}};
}
module.exports={proposeLocalModel};
