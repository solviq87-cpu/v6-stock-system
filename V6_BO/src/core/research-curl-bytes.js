'use strict';
// Callers retain their endpoint/parameter allowlists. This transport only owns
// bounded response bytes and the physical supplier request reservation.
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {mkdtemp,stat,readFile,rm}=require('node:fs/promises');
const {join}=require('node:path'),{tmpdir}=require('node:os');
const {marketRequests,createMarketRequestGovernor,isMarketRestrictionError}=require('./market-request-governor');
const run=promisify(execFile),MAX_BYTES=2*1024*1024,MAX_HEADER_BYTES=64*1024;
const problem=(code,message)=>Object.assign(new Error(message),{code});
function headersFrom(raw){
 const block=raw.toString('latin1').trim().split(/\r?\n\r?\n/).filter(b=>/^HTTP\/\S+\s+\d{3}(?:\s|$)/i.test(b)).at(-1);
 if(!block)throw problem('invalid-http-response','缺少HTTP响应头');
 const lines=block.split(/\r?\n/),status=Number(/^HTTP\/\S+\s+(\d{3})/i.exec(lines.shift())[1]),headers={};
 for(const line of lines){const colon=line.indexOf(':');if(colon>0)headers[line.slice(0,colon).trim().toLowerCase()]=line.slice(colon+1).trim();}
 return {status,headers};
}
function checkResponse(governor,target,response){
 try{governor.checkResponse(target,response?.status,response?.headers);}
 catch(error){error.response=response;throw error;}
 if(Number.isInteger(response?.status)&&(response.status<200||response.status>=300))throw Object.assign(problem('http-error','行情网关HTTP '+response.status),{response});
 return response;
}
function bounds(options){
 const {maxBytes=MAX_BYTES,timeoutMs=12000,processTimeoutMs=13000}=options;
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>12000||!Number.isFinite(processTimeoutMs)||processTimeoutMs<1||processTimeoutMs>13000)throw problem('invalid-request-bounds','公共研究请求边界无效');
 return {maxBytes,timeoutMs,processTimeoutMs};
}
async function requestResearchBytes(target,options={}){
 const u=new URL(target);if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port)throw problem('invalid-endpoint','公共研究仅允许HTTPS地址');
 bounds(options);
 const governor=options.requestGovernor??marketRequests;
 // Preparation precedes reservation: a slow mkdir cannot shorten the interval
 // between the actual execFile invocations. Queue rejection also cleans the dir.
 const directory=await mkdtemp(join(tmpdir(),'v6-research-')),body=join(directory,'body');let primaryError;
 try{
  return await governor.run(target,async()=>{
   if(options.signal?.aborted)throw problem('request-aborted','公共研究请求已取消');
   const current={...options,...(options.beforeStart?.()||{})},{maxBytes,timeoutMs,processTimeoutMs}=bounds(current);
   if(options.signal?.aborted)throw problem('request-aborted','公共研究请求已取消');
   let stdout,wireError;
   try{({stdout}=await run('curl',['--silent','--show-error','--max-time',String(timeoutMs/1000),'--max-filesize',String(maxBytes),'--proto','=https','--user-agent','Mozilla/5.0','--header','Accept: application/json','--dump-header','-','--output',body,target],{timeout:Math.ceil(processTimeoutMs),maxBuffer:MAX_HEADER_BYTES,encoding:'buffer',...(options.signal?{signal:options.signal}:{})}));}
   catch(error){wireError=error;stdout=error.stdout;}
   let metadata;try{metadata=headersFrom(stdout||Buffer.alloc(0));}catch(error){throw wireError||error;}
   let raw,bodyError;
   try{if((await stat(body)).size>maxBytes)throw problem('response-too-large','公共研究响应超过字节上限');raw=await readFile(body);}catch(error){bodyError=error;}
   const response={...metadata,...(raw?{raw}:{})};
   checkResponse(governor,target,response);
   if(wireError)throw wireError;
   if(bodyError)throw bodyError;
   return response;
  });
 }catch(error){primaryError=error;throw error;}
 finally{try{await rm(directory,{recursive:true,force:true});}catch(error){if(!primaryError)throw error;}}
}
function createResearchRequest(requestJson,defaultRequest,requestGovernor){
 const physical=requestJson===defaultRequest;
 // Local adapters preserve existing two-way mock concurrency without real waits
 // or persistent state. Production defaults always reach the shared singleton.
 const governor=requestGovernor??(physical?marketRequests:createMarketRequestGovernor({minIntervalMs:0,maxActive:2}));
 return async(target,options={})=>{
  const invoke=async()=>{
   if(options.signal?.aborted)throw problem('request-aborted','公共研究请求已取消');
   const current=physical?options:{...options,...(options.beforeStart?.()||{})};
   const response=await requestJson(target,{...current,requestGovernor:governor});
   return checkResponse(governor,target,response);
  };
  return physical?invoke():governor.run(target,invoke);
 };
}
function restrictionFields(error){return isMarketRestrictionError(error)?{status:error.status,resumeAt:error.resumeAt,...(error.stateUnavailable?{stateUnavailable:true}:{})}:{};}
module.exports={requestResearchBytes,createResearchRequest,restrictionFields};
