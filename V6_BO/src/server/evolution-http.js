'use strict';
const {sessionHeaderToken}=require('./session-header-token');
const {sameOriginOk}=require('./request-security');
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const codeOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
function parseQuery(url,now){
 const allowed=['symbol','asOf','horizon','export'];
 for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)throw Error('研究查询字段无效');
 const query={};
 if(url.searchParams.has('symbol')){query.code=url.searchParams.get('symbol');if(!codeOK(query.code))throw Error('股票代码须为六位数字');}
 if(url.searchParams.has('asOf')){
  const raw=url.searchParams.get('asOf');if(!/^\d{13}$/.test(raw))throw Error('回放时点无效');
  query.asOf=Number(raw);if(!Number.isSafeInteger(query.asOf)||query.asOf<=0||query.asOf>now)throw Error('回放不能读取未来时点');
 }
 if(url.searchParams.has('horizon')){const raw=url.searchParams.get('horizon');if(!['1','5','20','60'].includes(raw))throw Error('持有窗口无效');query.horizon=Number(raw);}
 if(url.searchParams.has('export')&&!['0','1'].includes(url.searchParams.get('export')))throw Error('导出参数无效');
 return {...query,asOf:query.asOf??now,export:url.searchParams.get('export')==='1'};
}
async function evolutionHttp(req,res,{body='',url,root,workspaceRoot,paths={},authenticate,isReplica,job,clock=Date.now,calendarFor}={}){
 body=body??'';
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 const fail=(status,error)=>reply(status,{ok:false,error});
 const authorized=()=>authenticate(sessionHeaderToken(req),req)==='edit';
 if(!authorized())return fail(403,'私人研究报告需要编辑者身份');
 if(!sameOriginOk(req))return fail(403,'请求来源不匹配');
 if(!['GET','POST'].includes(req.method))return fail(405,'仅允许 GET 或 POST');
 if(req.method==='GET'&&body)return fail(400,'读取报告不得附带请求体');
 if(Buffer.byteLength(body,'utf8')>64*1024)return fail(413,'研究设置超过 64 KiB');
 const now=clock();let query,input;
 try{
  query=parseQuery(url,now);
  if(req.method==='POST'){
   if([...url.searchParams].length)throw Error('设置操作不接受查询参数');
   if(isReplica())return fail(409,'当前副本只提供研究读取');
   input=JSON.parse(body);
   if(!plain(input)||typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId))throw Error('研究请求编号无效');
   if(input.action==='preferences'){
    if(Object.keys(input).some(k=>!['action','requestId','expectedRevision','value'].includes(k))||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||!plain(input.value))throw Error('研究设置或预期版本无效');
   }else if(input.action==='diagnostics'){
    if(Object.keys(input).some(k=>!['action','requestId','symbol','asOf','horizon'].includes(k)))throw Error('研究诊断字段无效');
    const target=new URL(url.origin+url.pathname);
    for(const key of ['symbol','asOf','horizon'])if(input[key]!==undefined){if(typeof input[key]!=='string')throw Error('诊断查询须为字符串');target.searchParams.set(key,input[key]);}
    query=parseQuery(target,now);
   }else throw Error('未知研究操作');
  }
 }catch(e){return fail(400,e instanceof SyntaxError?'请求须为 JSON 对象':e.message);}
 const mayWrite=()=>authorized()&&!isReplica();
 try{
  const result=await job({action:input?'evolution-'+input.action:'evolution',root,workspaceRoot,paths,query,input,now,replica:isReplica(),
   calendar:calendarFor?.(query.asOf)||null},{authorize:mayWrite});
  // The device can be revoked while an archive worker is reading private data.
  if(!authorized())return reply(403,{ok:false,locked:true,error:'设备授权已变化，请重新登录后读取'});
  const {httpStatus,...data}=result;
  return reply(httpStatus||(data.ok?200:422),data);
 }catch{return fail(503,'研究证据暂时不可用，已有记录保留');}
}
module.exports={evolutionHttp,parseQuery};
