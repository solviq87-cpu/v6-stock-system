'use strict';
// Optional local preview gateway. Existing V6 backend remains the authority for live APIs.
// Run: cd V6_BO && node scripts/run-reference-preview.js
const http=require('node:http'), https=require('node:https');
const fs=require('node:fs'),path=require('node:path');
const {createCatalogueHandler}=require('../src/server/strategy-dashboard-preview');
const root=path.resolve(__dirname,'../public');
const port=Number(process.env.V6_PREVIEW_PORT)||8765;
const host=process.env.V6_PREVIEW_HOST||'127.0.0.1';
const handler=createCatalogueHandler({snapshotPath:process.env.V6_PREVIEW_SNAPSHOT});
const upstream=process.env.V6_PREVIEW_UPSTREAM?new URL(process.env.V6_PREVIEW_UPSTREAM):null;
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.json':'application/json; charset=utf-8'};
function proxy(req,res){
 if(!upstream){res.writeHead(503,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
   res.end(JSON.stringify({ok:false,error:'原V6服务尚未连接；请设置V6_PREVIEW_UPSTREAM'}));return;}
 const target=new URL(req.url,upstream);
 const client=target.protocol==='https:'?https:http;
 const upstreamReq=client.request(target,{method:req.method,headers:{...req.headers,host:target.host},timeout:12000},r=>{
   res.writeHead(r.statusCode||502,r.headers);r.pipe(res);
 });
 upstreamReq.on('timeout',()=>upstreamReq.destroy(Error('上游超时')));
 upstreamReq.on('error',e=>{if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,error:'上游不可达：'+e.message}))});
 req.pipe(upstreamReq);
}
http.createServer((req,res)=>{
 try{
   if(handler(req,res))return;
   const url=new URL(req.url,'http://localhost');
   if(url.pathname.startsWith('/api/')){proxy(req,res);return;}
   if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return;}
   let pathname=url.pathname==='/'?'/reference-dashboard.html':url.pathname;
   let decoded=decodeURIComponent(pathname);
   if(!/^\/(?:reference-dashboard\.html|strategy-catalog\.html|research\.html|assets\/[a-zA-Z0-9._/-]+)$/.test(decoded)||
       decoded.includes('..')){res.writeHead(404);res.end('Not found');return;}
   const file=path.resolve(root,'.'+decoded);
   if(!file.startsWith(root+path.sep)){res.writeHead(404);res.end();return;}
   const stat=fs.statSync(file);
   if(!stat.isFile()){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'content-type':types[path.extname(file)]||'application/octet-stream','content-length':stat.size,
      'cache-control':'no-cache','x-content-type-options':'nosniff'});
   if(req.method==='HEAD'){res.end();return;}
   fs.createReadStream(file).pipe(res);
 }catch(e){res.writeHead(404);res.end('File unavailable');}
}).listen(port,host,()=>console.log('天枢智策开发预览：http://'+host+':'+port+
  '/reference-dashboard.html'+(upstream?' · 上游 '+upstream.origin:' · 行情服务未接通')));
