'use strict';
const {safeMaterial}=require('../core/deep-research-workspace');

async function deepResearchHttp(req,res,{body,url,authenticate,isReplica,root,shortlineRoot,newsRoot,
 readSnapshot,job,readAcceptance,onReport=()=>{},clock=Date.now}={}){
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 const allowed=()=>{try{return authenticate()===true;}catch{return false;}};
 if(!allowed())return reply(403,{ok:false,error:'深度研究和运行证据只对原编辑者身份开放'});
 if([...url.searchParams].length||req.headers['x-v6-research-book']&&req.headers['x-v6-research-book']!=='main')
  return reply(400,{ok:false,error:'此入口只读取原主研究档案，不接受路径、时钟或账户覆盖'});
 const suffix=url.pathname.slice('/api/research/deep'.length);
 if(!['','/evidence','/alternatives','/acceptance'].includes(suffix))return reply(404,{ok:false,error:'没有该研究操作'});
 const writing=['/evidence','/alternatives'].includes(suffix);
 if(req.method!==(writing?'POST':'GET'))return reply(405,{ok:false,error:writing?'此操作需要明确POST提交':'此入口只支持GET'});
 if(writing&&isReplica())return reply(409,{ok:false,error:'副本只读，请在原主实例保存研究证据'});
 if(Buffer.byteLength(body||'','utf8')>512*1024)return reply(413,{ok:false,error:'研究输入超过512KiB'});
 if(!writing&&body)return reply(400,{ok:false,error:'读取操作不接受输入内容'});
 try{
  if(suffix==='/acceptance'){
   const result=await readAcceptance();if(!allowed())return reply(403,{ok:false,error:'编辑授权已失效'});
   return reply(200,{ok:true,result});
  }
  let input=null;
  if(writing){
   try{input=safeMaterial(JSON.parse(body||''));}catch{return reply(400,{ok:false,error:'研究输入格式无效或包含敏感内容'});}
   if(!input||Array.isArray(input)||!Number.isSafeInteger(input.revision)||input.revision<0||
      typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId))return reply(400,{ok:false,error:'需要当前档案版本和稳定请求ID'});
  }
  const now=clock(),snapshot=await readSnapshot(now);
  if(!allowed()||writing&&isReplica())return reply(403,{ok:false,error:'编辑授权或实例角色已变化'});
  let action='deep-research';
  if(suffix==='/evidence')action='deep-import';
  if(suffix==='/alternatives'){
   action='deep-freeze';
   if(Object.keys(input).some(key=>!['revision','requestId','horizonDays','selectedId','alternatives'].includes(key)))
    return reply(400,{ok:false,error:'对照仅接受备选方案、周期和当前修订，账户与信息时点由后台冻结'});
   input={requestId:input.requestId,revision:input.revision,publicIntent:{
    horizonDays:input.horizonDays,selectedId:input.selectedId,alternatives:input.alternatives
   }};
  }
  const result=await job({action,root,shortlineRoot,newsRoot,now,snapshot,replica:isReplica(),...(input?{input}:{})},
   {authorize:()=>allowed()&&!isReplica()});
  if(!allowed()||writing&&isReplica())return reply(403,{ok:false,error:'编辑授权或实例角色已变化，请重新读取原档案'});
  if(!writing&&result.ok&&result.result?.mode==='fayo-deep-research')onReport(result.result);
  const {httpStatus,...data}=result;
  return reply(httpStatus||(data.ok?200:422),data);
 }catch{return reply(503,{ok:false,error:'研究资料暂不可用，原账户和已存证据保留'});}
}
module.exports={deepResearchHttp};
