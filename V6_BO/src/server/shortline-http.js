'use strict';
const {sessionHeaderToken}=require('./session-header-token');
const {sameOriginOk}=require('./request-security');
const {validTradingDate}=require('../strategy/cached-kline-adapter');
const keys=new Set(['revision','action','payload']);
function plain(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
async function shortlineHttp(req,res,{body,url,authenticate,isReplica,root,readSource,job,recoveryDisplay,previousTradingDay,latestClosedDay,isOpenDay}){
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
 const book=req.headers['x-v6-research-book']??'main',view=req.headers['x-v6-research-view'];
 if(typeof book!=='string'||!(/^(?:main|demo|book-[0-9a-f]{16})$/.test(book)))return fail(400,'研究账户无效');
 if(view!=null&&(req.method!=='GET'||!['model','notices','home'].includes(view)))return fail(400,'研究读视图无效');
 const selection=req.headers['x-v6-sample-filter']||'standard';
 if(!['all','standard','blackSwan','extreme','excludeBlackSwan','excludeExtreme'].includes(selection))return fail(400,'样本集筛选无效');
 let input,snapshot,degraded=false;
 if(req.method==='GET'&&body)return fail(400,'查询不得附带请求体');
 if(req.method==='POST'){
  if(isReplica())return fail(409,'当前 V6 副本只提供研究档案读取');
  if(Buffer.byteLength(body||'','utf8')>2*1024*1024)return fail(413,'单次操作超过 2 MiB');
  try{input=JSON.parse(body);}catch{return fail(400,'请求须为 JSON 对象');}
  if(!plain(input)||Object.keys(input).some(k=>!keys.has(k))||!Number.isSafeInteger(input.revision)||input.revision<0||typeof input.action!=='string'||!plain(input.payload))return fail(400,'需要档案版本、操作名和参数对象');
  if(input.action==='v6:sync'){
   if(book==='demo')return fail(422,'演示库不请求外部行情');
   const {code,day,previousDay}=input.payload;
   if(Object.keys(input.payload).some(k=>!['code','day','previousDay'].includes(k))||!/^\d{6}$/.test(code)||typeof code!=='string'||[day,previousDay].some(d=>d!==undefined&&(typeof d!=='string'||!/^\d{4}-\d\d-\d\d$/.test(d))))return fail(400,'行情读取参数无效');
   if(!/^(60|68|00|30|43|83|87|88|92)\d{4}$/.test(code))return fail(422,'股票代码不属于已支持的 A 股范围');
   if([day,previousDay].some(d=>d&&(!validTradingDate(d)||Date.parse(d+'T15:10:00+08:00')>Date.now()||
       [0,6].includes(new Date(d+'T12:00:00Z').getUTCDay())||(isOpenDay&&!isOpenDay(d)))))return fail(422,'请选择已收盘的有效交易日期');
   if(previousDay){
    const target=day||latestClosedDay?.();
    if(!target||previousDay>=target||(previousTradingDay&&previousDay!==previousTradingDay(target)))return fail(422,'前交易日与日历不符');
   }
   try{snapshot=await readSource(input.payload);}catch{degraded=true;}
   if(!snapshot?.day)degraded=true;
   if(snapshot&&(snapshot.code!==code||day&&snapshot.day&&snapshot.day!==day))return fail(422,'行情标的或日期校验不一致');
   if(!authenticated()||isReplica())return fail(403,'V6 编辑授权或实例角色已变更，请重新读取');
  }
 }
 const result=await job({action:'shortline',root,book,input,snapshot,degraded,view,selection,knownDictionary:req.headers['x-v6-factor-version'],replica:isReplica()});
 const {httpStatus,...data}=result;
 if(data.ok&&data.state&&book!=='demo'&&recoveryDisplay)data.state={...data.state,marketRecovery:recoveryDisplay()};
 return reply(httpStatus||(data.ok?200:422),data);
}
module.exports={shortlineHttp};
