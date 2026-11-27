'use strict';
// This endpoint accepts a proposal reference, never a set of client weights.
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clockOk=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const chinaDay=x=>new Date(x+28800000).toISOString().slice(0,10);
const call=fn=>{try{return fn();}catch{return undefined;}};
const candidateIdOk=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(x);
const fields=['day','revision','proposalFingerprint'];
function parseReference(body){
  if(typeof body!=='string'&&!Buffer.isBuffer(body))throw Error('invalid body');
  if(Buffer.byteLength(body)>4096)throw Error('oversized body');
  const raw=String(body),input=JSON.parse(raw);
  if(!record(input)||Object.keys(input).length!==fields.length||!fields.every(k=>Object.hasOwn(input,k)))throw Error('invalid fields');
  // The contract is a flat JSON object. Tokenize whole string literals so
  // an earlier duplicate (including an escaped key) cannot be erased by JSON.parse.
  const keys=[];
  for(const m of raw.matchAll(/"(?:[^"\\]|\\[\s\S])*"/g))
    if(/^\s*:/.test(raw.slice(m.index+m[0].length)))keys.push(JSON.parse(m[0]));
  if(keys.length!==fields.length||new Set(keys).size!==fields.length||!keys.every(k=>fields.includes(k)))throw Error('duplicate fields');
  return input;
}
function validatedReply(value,input){
  if(!record(value)||typeof value.ok!=='boolean')throw Error('invalid result');
  const {httpStatus,...data}=value;
  if(value.ok){
    const r=value.result;
    if(httpStatus!==undefined&&httpStatus!==200||value.error!=null&&value.error!==''||!record(r)||!candidateIdOk(r.candidateId)||
       !['待人工审批','验证未通过'].includes(r.status)||
       value.revision!==undefined&&(!Number.isSafeInteger(value.revision)||value.revision<input.revision)||
       r.proposalFingerprint!==undefined&&r.proposalFingerprint!==input.proposalFingerprint||
       ['automaticApproval','productionWeightsChanged','canTrade','canNotify'].some(k=>r[k]!==undefined&&r[k]!==false))throw Error('invalid candidate');
    return {status:200,data};
  }
  if(httpStatus!==undefined&&(!Number.isInteger(httpStatus)||httpStatus<400||httpStatus>599)||
     value.result!==undefined||typeof value.error!=='string'||!value.error.trim())throw Error('invalid error receipt');
  return {status:httpStatus??422,data};
}
async function decisionFeedbackHttp(req,res,{body,url,authenticate,isReplica,isOpenDay,root,historyRoot,job,clock=Date.now}){
  const reply=(status,data)=>{
    const encoded=JSON.stringify(data); // Never emit success headers before the body can be encoded.
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    res.end(encoded);
  };
  const authorized=()=>call(authenticate)===true;
  const role=()=>call(isReplica);
  if(!authorized())return reply(403,{ok:false,error:'中心反馈仅对原编辑者身份开放'});
  if(req.method!=='POST')return reply(405,{ok:false,error:'中心反馈仅接受 POST 验证请求'});
  const initialRole=role();
  if(initialRole===true)return reply(409,{ok:false,error:'副本只读，请在原主实例验证中心提案'});
  if(initialRole!==false)return reply(403,{ok:false,error:'原主实例角色无法确认'});
  if([...url.searchParams].length||Object.hasOwn(req.headers,'x-v6-research-book')&&req.headers['x-v6-research-book']!=='main')
    return reply(400,{ok:false,error:'中心反馈只使用原主研究档案'});
  let input;
  try{input=parseReference(body);}catch{return reply(400,{ok:false,error:'需要唯一的日期、档案版本和提案指纹'});}
  const now=call(clock);
  if(!clockOk(now))return reply(503,{ok:false,error:'中心反馈时钟无法确认，请重新读取中心证据'});
  const day=chinaDay(now);
  if(!Number.isSafeInteger(input.revision)||input.revision<0||
      typeof input.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.day)||input.day>day||
      !Number.isFinite(Date.parse(input.day+'T00:00:00Z'))||new Date(input.day+'T00:00:00Z').toISOString().slice(0,10)!==input.day||
      typeof input.proposalFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.proposalFingerprint))
    return reply(400,{ok:false,error:'提案参数无效；仅接受日期、档案版本和服务器指纹'});
  let open;
  try{open=isOpenDay(input.day);}catch{return reply(422,{ok:false,error:'所选日期缺少已核实的交易日历覆盖，请重新读取中心证据'});}
  if(open!==true)return reply(400,{ok:false,error:'所选日期不是已核实的交易日'});
  // Once an observed gate changes, never revive this in-flight request. The
  // worker still owns archive locking and its original commit-time checks.
  let lastClock=now,invalid=null;
  const gate=()=>{
    if(invalid!==null)return invalid;
    if(!authorized()||role()!==false)return invalid=403;
    const t=call(clock);
    if(!clockOk(t)||t<lastClock||chinaDay(t)!==day||call(()=>isOpenDay(input.day))!==true)return invalid=409;
    lastClock=t;return null;
  };
  const blocked=status=>reply(status,{ok:false,error:status===403?'编辑授权或实例角色已变化，请重新读取原档案回执':'时钟或交易日历证据已变化，请重新读取原档案回执'});
  try{
    const before=gate();if(before!==null)return blocked(before);
    const result=await job({action:'intelligence-feedback',root,historyRoot,book:'main',replica:false,
      day:input.day,now,revision:input.revision,proposalFingerprint:input.proposalFingerprint},
      {authorize:()=>gate()===null});
    const after=gate();if(after!==null)return blocked(after);
    const {status,data}=validatedReply(result,input);
    return reply(status,data);
  }catch{
    const after=gate();if(after!==null)return blocked(after);
    return reply(503,{ok:false,error:'中心提案验证暂不可用或回执不完整，请重新读取原档案'});
  }
}
module.exports={decisionFeedbackHttp};
