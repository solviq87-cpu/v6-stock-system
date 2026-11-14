'use strict';
/**
 * Explicitly authenticated /api/records HTTP adapter for the isolated CAS store.
 * This is not installed in the existing V6 server and cannot run on static WorkBuddy hosting.
 * Caller MUST inject actual device-session authorization and same-origin policy.
 */
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const BEARER=/^Bearer ([A-Za-z0-9._~-]{8,256})$/i;
const VALID_FIELDS=new Set(['name','title','author','content','expectedRevision','requestId']);
function respond(res,status,body){
 if(res.writableEnded||res.destroyed)return;
 res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
 res.end(JSON.stringify(body));
}
const fail=(res,status,code)=>respond(res,status,{ok:false,code});
function createCloudRecordsHttpHandler({store,authenticate,sameOrigin,maxBytes=MAX_BODY_BYTES}={}){
 if(!store||typeof store.read!=='function'||typeof store.upsert!=='function'||
    typeof authenticate!=='function'||typeof sameOrigin!=='function')throw Error('AUTH_AND_ORIGIN_POLICIES_REQUIRED');
 if(!Number.isSafeInteger(maxBytes)||maxBytes<1024||maxBytes>MAX_BODY_BYTES)throw Error('INVALID_BODY_LIMIT');
 return async function cloudRecordsHttp(req,res,body=null){
  let path;
  try{path=new URL(req.url,'http://local.invalid').pathname;}catch{return fail(res,400,'INVALID_REQUEST_PATH');}
  if(path!=='/api/records')return fail(res,404,'NOT_FOUND');
  if(!['GET','POST'].includes(req.method))return fail(res,405,'METHOD_NOT_ALLOWED');
  try{if(!sameOrigin(req))return fail(res,403,'CROSS_SITE_FORBIDDEN');}catch{return fail(res,403,'CROSS_SITE_FORBIDDEN');}
  const match=typeof req.headers.authorization==='string'&&req.headers.authorization.match(BEARER);
  if(!match)return fail(res,401,'LOGIN_REQUIRED');
  let role;
  try{role=await authenticate(match[1],req);}catch{return fail(res,401,'LOGIN_REQUIRED');}
  if(role!=='edit')return fail(res,role==='view'?403:401,role==='view'?'READ_ONLY':'LOGIN_REQUIRED');
  if(req.method==='GET'){
   try{
    const state=store.read();
    if(state.status!=='ready')return fail(res,503,'AUTHORITATIVE_LEDGER_UNAVAILABLE');
    return respond(res,200,{ok:true,records:state.records,revision:state.revision,
      writeContract:'cas-v1',readOnly:false,accountRecoveryVerified:false});
   }catch{return fail(res,503,'LEDGER_VERIFICATION_FAILED');}
  }
  if(typeof body!=='string'||Buffer.byteLength(body)>maxBytes)return fail(res,413,'REQUEST_TOO_LARGE');
  let data;
  try{data=JSON.parse(body);}catch{return fail(res,400,'INVALID_JSON');}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     Object.keys(data).some(key=>!VALID_FIELDS.has(key)))return fail(res,400,'INVALID_RECORD_REQUEST');
  try{
   const saved=store.upsert({expectedRevision:data.expectedRevision,requestId:data.requestId,
     record:{name:data.name,content:data.content,...(data.title===undefined?{}:{title:data.title}),
       ...(data.author===undefined?{}:{author:data.author})}});
   return respond(res,200,{ok:true,revision:saved.currentRevision,appliedRevision:saved.appliedRevision,
     reused:saved.reused,writeContract:'cas-v1'});
  }catch(e){
   if(['REVISION_CONFLICT','IDEMPOTENCY_CONTENT_CONFLICT'].includes(e.code))return fail(res,409,e.code);
   if(['EXPECTED_REVISION_REQUIRED','INVALID_RECORD','INVALID_ACCOUNT_JSON','INVALID_ACCOUNT_SHAPE',
       'UNSAFE_JSON_FIELD','UNSAFE_JSON_PROTOTYPE','STRUCTURE_TOO_DEEP','DUPLICATE_RECORD_NAME'].includes(e.code))
     return fail(res,400,'INVALID_RECORD_REQUEST');
   if(['NO_AUTHORITATIVE_SNAPSHOT','HISTORY_CAPACITY_REACHED'].includes(e.code))return fail(res,503,e.code);
   return fail(res,503,'LEDGER_WRITE_UNAVAILABLE');
  }
 };
}
module.exports={createCloudRecordsHttpHandler};
