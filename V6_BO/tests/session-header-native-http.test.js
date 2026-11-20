'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {createFixture}=require('./helpers/v6-studio-fixture');
function request(port,route,{headers={},method='GET',body}={}){
 return new Promise((resolve,reject)=>{
  const bytes=body===undefined?null:Buffer.from(JSON.stringify(body));
  const req=http.request({hostname:'127.0.0.1',port,path:route,method,timeout:10000,
   headers:{...headers,...(bytes?{'Content-Type':'application/json','Content-Length':bytes.length}:{})}},res=>{
   let text='';res.on('data',b=>{text+=b;if(text.length>1024*1024)req.destroy(Error('fixture response too large'));});
   res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch{reject(Error('fixture expected JSON'));}});
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('header fixture timeout')));req.end(bytes);
 });
}
test('real native sessions survive a gateway-owned Authorization header without upgrading roles, URL tokens or revoked devices',
 {timeout:45000},async t=>{
 const f=await createFixture({count:1});t.after(()=>f.close());
 let mode='drop';
 const gateway=http.createServer((req,res)=>{
  const headers={...req.headers};
  if(mode==='drop')delete headers.authorization;
  if(mode==='replace')headers.authorization='Basic synthetic-host-gateway';
  const upstream=http.request({hostname:'127.0.0.1',port:f.port,path:req.url,method:req.method,headers},reply=>{
   res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);
  });upstream.on('error',()=>{res.writeHead(502);res.end('{}');});req.pipe(upstream);
 });
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{gateway.closeAllConnections();gateway.close(resolve);}));
 const port=gateway.address().port,editor={'X-QD-Token':f.token},both={Authorization:'Bearer '+f.token,...editor};
 for(const gatewayMode of ['drop','replace']){
  mode=gatewayMode;
  assert.equal((await request(port,'/api/lock/status',{headers:both})).body.role,'edit');
  assert.equal((await request(port,'/api/research/manual-loop',{headers:both})).body.result.revision,0);
 }
 assert.equal((await request(port,'/api/lock/status')).body.role,null);
 assert.equal((await request(port,'/api/research/manual-loop',{headers:{'X-QD-Token':f.viewerToken}})).body.result,undefined);
 for(const route of ['/api/research/manual-loop','/api/research/learning-runtime']){
  assert.equal((await request(port,route+'?token='+f.token)).status,403,'URL identity cannot become a header-only editor');
  assert.equal((await request(port,route,{method:'POST',body:{token:f.token,probeModel:true}})).status,403);
 }
 mode='pass';
 assert.equal((await request(port,'/api/lock/status',{headers:{Authorization:'Bearer '+f.viewerToken,...editor}})).body.role,'view');
 assert.equal((await request(port,'/api/research/manual-loop',{headers:{Authorization:'Bearer '+f.viewerToken,...editor}})).status,403,'valid Bearer viewer is not upgraded by a second header');
 const cross=await request(port,'/api/lock/revoke',{method:'POST',headers:{...editor,Origin:'https://evil.fixture'},body:{id:'invalid-fixture'}});
 assert.equal(cross.status,403,'application header preserves the original same-origin write gate');
 const devices=await f.request('/api/lock/devices');
 const viewer=devices.body.items.find(row=>row.role==='view');assert.ok(viewer);
 assert.equal((await f.request('/api/lock/revoke','POST',{id:viewer.id})).body.ok,true);
 assert.equal((await request(port,'/api/lock/status',{headers:{'X-QD-Token':f.viewerToken}})).body.role,null,'native revocation applies equally to the application header');
});
