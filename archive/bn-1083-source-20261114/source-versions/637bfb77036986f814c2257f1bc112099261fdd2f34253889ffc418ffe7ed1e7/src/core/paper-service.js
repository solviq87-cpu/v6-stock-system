'use strict';
/** Local-only, read-only HTTP dashboard for persisted paper accounts. No order routes. */
const http=require('node:http');
const crypto=require('node:crypto');
const {loadSession,summary}=require('./paper-session');
const {auditPaperAccount}=require('./paper-audit');
function safeEqual(a,b){const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function publicReport(s){const r=s.report;return {account:summary(s),equity:r.equity,metrics:r.metrics,openPositions:r.positions,trades:r.orders.filter(x=>x.status==='filled'),orders:r.orders,assumptions:r.assumptions,warnings:r.warnings};}
function createPaperService({accountFile,token,host='127.0.0.1',port=0}={}){
 if(!accountFile||typeof token!=='string'||token.length<24)throw Error('必须指定账户文件和至少24字符的访问令牌');
 if(!['127.0.0.1','::1','localhost'].includes(host))throw Error('模拟盘只允许绑定本机回环地址');
 const server=http.createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Access-Control-Allow-Origin','null');
  const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(body));};
  if(req.method!=='GET')return send(405,{ok:false,error:'只读接口'});
  if(!safeEqual(req.headers.authorization,`Bearer ${token}`))return send(401,{ok:false,error:'未授权'});
  const url=req.url?.split('?')[0];
  if(!['/api/paper/status','/api/paper/report','/api/paper/health','/api/paper/audit'].includes(url))return send(404,{ok:false,error:'接口不存在'});
  if(url==='/api/paper/health')return send(200,{ok:true,mode:'offline-paper',canTrade:false});
  if(url==='/api/paper/audit'){
   const audit=auditPaperAccount(accountFile);
   return send(audit.ok?200:503,{ok:audit.ok,data:audit});
  }
  try{
   const s=loadSession(accountFile);
   return send(200,{ok:true,data:url==='/api/paper/status'?summary(s):publicReport(s)});
  }catch(e){return send(503,{ok:false,error:'账户不可用或完整性校验失败'});}
 });
 return {server,listen:()=>new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve(server.address());});})};
}
module.exports={createPaperService,publicReport};
