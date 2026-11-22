'use strict';
const {sessionHeaderToken}=require('./session-header-token');
const {sameOriginOk}=require('./request-security');
const keys=new Set(['revision','action','payload']);
function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
async function shortlineHttp(req,res,{body,url,authenticate,isReplica,root,readSource,job}){
 const reply=(httpStatus,value)=>{
  res.writeHead(httpStatus,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(value));
 };
 const fail=(code,message)=>reply(code,{ok:false,error:message});
 const authenticated=()=>authenticate(sessionHeaderToken(req),req)==='edit';
 if(!authenticated())return reply(403,{ok:false,readOnly:true,error:'私人交易记录仅对 V6 编辑者开放'});
 if(!sameOriginOk(req))return fail(403,'请求来源不匹配');
 if([...url.searchParams].length)return fail(400,'该私有接口不接受查询参数');
 if(!['GET','POST'].includes(req.method))return fail(405,'仅允许 GET 或 POST');
 let input,snapshot;
 if(req.method==='GET'&&body)return fail(400,'查询不得附带请求体');
 if(req.method==='POST'){
  if(isReplica())return fail(409,'当前 V6 副本只提供研究档案读取');
  if(Buffer.byteLength(body||'','utf8')>2*1024*1024)return fail(413,'单次操作超过 2 MiB');
  try{input=JSON.parse(body);}catch{return fail(400,'请求须为 JSON 对象');}
  if(!plain(input)||Object.keys(input).some(k=>!keys.has(k))||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.action!=='string'||!plain(input.payload))return fail(400,'需要档案版本、操作名和参数对象');
  if(input.action==='v6:sync'){
   const {code,day,previousDay}=input.payload;
   if(Object.keys(input.payload).some(k=>!['code','day','previousDay'].includes(k))||!/^\d{6}$/.test(code)||typeof code!=='string'||[day,previousDay].some(d=>d!==undefined&&(typeof d!=='string'||!/^\d{4}-\d\d-\d\d$/.test(d))))return fail(400,'行情读取参数无效');
   try{snapshot=await readSource(input.payload);}catch{return fail(422,'V6 行情证据暂不可用，请稍后重试');}
   if(!snapshot||snapshot.code!==code||!snapshot.day)return fail(422,'未取得匹配标的的有效行情证据');
   if(!authenticated()||isReplica())return fail(403,'V6 编辑授权或实例角色已变更，请重新读取');
  }
 }
 const result=await job({action:'shortline',root,input,snapshot,replica:isReplica()});
 const {httpStatus,...data}=result;
 return reply(httpStatus||(data.ok?200:422),data);
}
module.exports={shortlineHttp};
