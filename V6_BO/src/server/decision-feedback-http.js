'use strict';
// This endpoint accepts a proposal reference, never a set of client weights.
async function decisionFeedbackHttp(req,res,{body,url,authenticate,isReplica,isOpenDay,root,historyRoot,job,clock=Date.now}){
  const reply=(status,data)=>{
    res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(data));
  };
  if(!authenticate())return reply(403,{ok:false,error:'中心反馈仅对原编辑者身份开放'});
  if(req.method!=='POST')return reply(405,{ok:false,error:'中心反馈仅接受 POST 验证请求'});
  if(isReplica())return reply(409,{ok:false,error:'副本只读，请在原主实例验证中心提案'});
  if([...url.searchParams].length||req.headers['x-v6-research-book']&&req.headers['x-v6-research-book']!=='main')
    return reply(400,{ok:false,error:'中心反馈只使用原主研究档案'});
  let input;
  try{input=JSON.parse(body||'');}catch{return reply(400,{ok:false,error:'需要日期、档案版本和提案指纹'});}
  const now=clock(),day=new Date(now+28800000).toISOString().slice(0,10);
  if(!input||typeof input!=='object'||Array.isArray(input)||
      Object.keys(input).some(key=>!['day','revision','proposalFingerprint'].includes(key))||
      !Number.isSafeInteger(input.revision)||input.revision<0||
      typeof input.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.day)||input.day>day||
      !Number.isFinite(Date.parse(input.day+'T00:00:00Z'))||new Date(input.day+'T00:00:00Z').toISOString().slice(0,10)!==input.day||
      typeof input.proposalFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.proposalFingerprint))
    return reply(400,{ok:false,error:'提案参数无效；仅接受日期、档案版本和服务器指纹'});
  let open;
  try{open=isOpenDay(input.day);}catch{return reply(422,{ok:false,error:'所选日期缺少已核实的交易日历覆盖，请重新读取中心证据'});}
  if(open!==true)return reply(400,{ok:false,error:'所选日期不是已核实的交易日'});
  try{
    if(!authenticate()||isReplica())return reply(403,{ok:false,error:'编辑授权或实例角色已变化'});
    const result=await job({action:'intelligence-feedback',root,historyRoot,book:'main',replica:false,
      day:input.day,now,revision:input.revision,proposalFingerprint:input.proposalFingerprint},
      {authorize:()=>authenticate()&&!isReplica()});
    if(!authenticate()||isReplica())return reply(403,{ok:false,error:'编辑授权或实例角色已变化，请重新读取原档案回执'});
    const {httpStatus,...data}=result;
    return reply(httpStatus||(data.ok?200:422),data);
  }catch{return reply(503,{ok:false,error:'中心提案验证暂不可用，请重新读取原档案'});}
}
module.exports={decisionFeedbackHttp};
