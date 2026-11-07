'use strict';
// Contract for an operator-controlled HTTPS SMS gateway; never log phone or OTP.
function createSmsGateway({url,token,template,fetchImpl=globalThis.fetch,timeoutMs=8000}={}) {
  const ready=Boolean(url&&token&&template);
  if(ready){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password||u.hash)throw Error('短信网关必须使用HTTPS');}
  return {ready,async send({phone,code,expiresIn,requestId}){
    if(!ready)throw Error('短信供应商未配置');
    if(!/^1\d{10}$/.test(phone)||!/^\d{6}$/.test(code)||!Number.isInteger(expiresIn)||expiresIn<1||expiresIn>300||!/^[a-f0-9]{40}$/.test(requestId))throw Error('短信请求参数无效');
    try{
      const r=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'Idempotency-Key':requestId},body:JSON.stringify({phone,template,parameters:{code,expiresIn},requestId})});
      if(!r.ok)throw Error('rejected');
      // HTTP acceptance is not proof of handset delivery.
      await r.body?.cancel?.();
      return {status:'accepted',delivered:false};
    }catch{throw Error('短信供应商请求失败或超时');}
  }};
}
function configuredSmsGateway(env=process.env){return createSmsGateway({url:env.V6_SMS_URL,token:env.V6_SMS_TOKEN,template:env.V6_SMS_TEMPLATE});}
module.exports={createSmsGateway,configuredSmsGateway};
