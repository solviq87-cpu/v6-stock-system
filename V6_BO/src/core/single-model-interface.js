'use strict';
/** Exactly one explicitly supplied adapter; no built-in provider, credentials or automatic data transmission. */
function createSingleModelInterface({adapter=null}={}){
 if(adapter!==null&&(!adapter||typeof adapter.complete!=='function'||typeof adapter.id!=='string'||!adapter.id.trim()))throw Error('模型适配器无效');
 return Object.freeze({status:()=>({configured:!!adapter,model:adapter?.id||null,providers:adapter?1:0}),async complete(request){
  if(!adapter)return {status:'unavailable',reason:'尚未指定模型',text:null};
  if(!request||typeof request.prompt!=='string'||!request.prompt.trim()||Buffer.byteLength(request.prompt)>16384)throw Error('模型输入无效或超过16KB');
  const result=await adapter.complete({prompt:request.prompt});if(!result||typeof result.text!=='string'||Buffer.byteLength(result.text)>65536)throw Error('模型响应无效');
  return {status:'completed',model:adapter.id,text:result.text};
 }});
}
module.exports={createSingleModelInterface};
