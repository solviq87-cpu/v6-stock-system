'use strict';
// One bounded editor-only research endpoint. Reads run in the existing worker;
// the only persistence is an explicit research template CAS. The model is an
// optional, deliberately configured local adapter and never a trade tool.
async function handle(req,res,url,body,{authorize,primary,sameOrigin,roots,job}){
 const reply=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
 if(!authorize())return reply(403,{ok:false,error:'研究证据需要有效编辑设备权限'});
 const write=req.method==='POST';
 if(req.method!=='GET'&&!write)return reply(405,{ok:false,error:'仅支持GET与明确的研究操作POST'});
 if(write&&(!primary()||!sameOrigin()))return reply(403,{ok:false,error:'需要原主实例及同源授权'});
 if(Buffer.byteLength(body||'','utf8')>8192||!write&&body)return reply(413,{ok:false,error:'研究请求过大或只读请求携带内容'});
 try{
  let input,query={};
  if(write){
   if([...url.searchParams].length)throw Error();
   input=JSON.parse(body||'');
   if(!input||typeof input!=='object'||Array.isArray(input)||!['save-template','explain'].includes(input.action))throw Error();
  }else{
   for(const [k,v] of url.searchParams){
    if(!['mode','symbol','runId','asOf','window','board'].includes(k)||url.searchParams.getAll(k).length!==1||v.length>120)throw Error();
    if(['asOf','window'].includes(k)){if(!/^\d+$/.test(v)||!Number.isSafeInteger(Number(v)))throw Error();query[k]=Number(v);}
    else query[k]=v;
   }
  }
  const {httpStatus,...result}=await job({action:'evidence-workbench',roots,query,input},
   {authorize:()=>authorize()&&primary()&&sameOrigin()});
  if(!authorize())return reply(403,{ok:false,error:'设备权限已变化，未返回私有资料'});
  if(write&&(!primary()||!sameOrigin()))return reply(403,{ok:false,error:'主实例角色或同源授权已变化，请重新核对原记录'});
  return reply(httpStatus||(result.ok?200:422),result);
 }catch{return reply(422,{ok:false,error:'研究请求无效或原档案未就绪'});}
}
module.exports={handle};
