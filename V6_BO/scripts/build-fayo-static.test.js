'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {buildFayoStatic,validateArtifact,SCOPE}=require('./build-fayo-static');
const {buildWorkBuddyStatic,parseStaticRelease}=require('./build-workbuddy-static');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-artifact-')),frontend=path.join(dir,'nova');fs.mkdirSync(frontend);
 const source='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>绯曜 FAYO · 独立研究空间</title><link rel="icon" href="/nova/mark.svg"><link rel="manifest" href="/manifest.json"><link rel="stylesheet" href="/nova/fayo.css"><script type="module" src="/nova/app.js"></script></head><body><main><img src="/nova/mark.svg" alt="绯曜"></main></body></html>';
 fs.writeFileSync(path.join(frontend,'index.html'),source);
 fs.writeFileSync(path.join(frontend,'fayo.css'),'body{background:#100917;color:#fff}.mark{background:url("/nova/mark.svg")}');
 fs.writeFileSync(path.join(frontend,'mark.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><path d="M1 1h6v6H1z" fill="#f8c"/></svg>');
 fs.writeFileSync(path.join(frontend,'app.js'),`import {label} from './ui.js';\nglobalThis.fayoArtifactTest={label,mark:'/nova/mark.svg',literal:'</script><script>literal()',catalog:()=>fetch('/assets/model-library-catalog.json').then(r=>r.json()),catalogURL:()=>fetch(new URL('/assets/model-library-catalog.json',location.origin)).then(r=>r.json()),catalogRequest:()=>fetch(new Request(new URL('/assets/model-library-catalog.json',location.origin))).then(r=>r.json()),catalogPost:()=>fetch(new Request(new URL('/assets/model-library-catalog.json',location.origin),{method:'POST'})),state:options=>fetch('/api/state',options),lazy:()=>import('./lazy.js').then(m=>m.value)};\nif('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});`);
 fs.writeFileSync(path.join(frontend,'ui.js'),"export const label='绯曜 FAYO';");
 fs.writeFileSync(path.join(frontend,'lazy.js'),"export const value='native evidence';");
 const catalogFile=path.join(dir,'catalog.json');
 fs.writeFileSync(catalogFile,JSON.stringify({schemaVersion:1,reviewDate:'2026-11-15',entries:[{id:'A01',name:'公开 </script> 资料'}]}));
 return {dir,frontendDir:frontend,catalogFile,source,outputFile:path.join(dir,'review.html'),close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
function script(html){const value=[...html.matchAll(/<script\b[^>]*>([^]*?)<\/script\s*>/gi)];assert.equal(value.length,1,'exactly one executable script');return value[0][1];}

test('native modules, dynamic imports, CSS, logo and public catalog become one standalone document',async()=>{
 const f=fixture();try{
  const built=await buildFayoStatic(f),again=await buildFayoStatic({...f,outputFile:undefined});
  assert.equal(built.html,again.html,'identical source produces identical review bytes');
  assert.equal(fs.readFileSync(f.outputFile,'utf8'),built.html);
  assert.equal(built.scope,SCOPE);assert.equal(built.esbuildVersion,'0.25.12');assert.equal(built.embeddedCatalogCount,1);
  assert.match(built.html,/行情、账户与研究需要连接同源后台服务/);
  assert.match(built.html,/data:image\/svg\+xml;base64,/);
  assert.doesNotMatch(built.html,/<script[^>]*\bsrc=|<link[^>]*href=["']\//i);
  assert.doesNotMatch(script(built.html),/import\s*\(|navigator\.serviceWorker\.register\(/);
  assert.ok(built.sources.some(s=>s.file==='lazy.js'));assert.ok(built.sources.every(s=>/^[a-f\d]{64}$/.test(s.sha256)));
  assert.equal(fs.readFileSync(path.join(f.frontendDir,'index.html'),'utf8'),f.source,'canonical entry untouched');
  // The existing protected publisher validator remains unchanged and accepts
  // this file as --source; this test's SHA is synthetic, never a deployment.
  const release=buildWorkBuddyStatic({sourceFile:f.outputFile,sha:'a'.repeat(40)});
  assert.equal(parseStaticRelease(release.html).sha,'a'.repeat(40));
 }finally{f.close();}
});

test('embedded catalog avoids a network asset while actual API requests remain real and unchanged',async()=>{
 const f=fixture();try{
  const built=await buildFayoStatic(f),calls=[];let workerCalls=0;
  const location=new URL('https://actual-backend.example/review.html');
  const sandbox={location,URL,Request,Response,DOMException,Promise,console,navigator:{serviceWorker:{register(){workerCalls++;throw Error('review must not register a worker');}}},fetch:async(input,options)=>{calls.push({input,options});return new Response(JSON.stringify({ok:true,from:'actual backend'}),{headers:{'Content-Type':'application/json'}});}};
  vm.createContext(sandbox);vm.runInContext(script(built.html),sandbox);
  const api=sandbox.fayoArtifactTest;assert.equal(api.label,'绯曜 FAYO');assert.equal(api.literal,'</script><script>literal()');assert.match(api.mark,/^data:/);assert.equal(await api.lazy(),'native evidence');
  const catalog=await api.catalog();assert.equal(catalog.entries[0].name,'公开 </script> 资料');assert.equal(calls.length,0,'catalog is local public metadata');
  assert.equal((await api.catalogURL()).entries[0].id,'A01','URL objects use embedded catalog');
  assert.equal((await api.catalogRequest()).entries[0].id,'A01','Request objects use embedded catalog');
  assert.equal(calls.length,0,'all supported catalog input types avoid network');
  const options={headers:{Authorization:'Bearer synthetic-test-only'},cache:'no-store'};const result=await api.state(options);assert.equal((await result.json()).from,'actual backend');assert.equal(calls.length,1);assert.equal(calls[0].input,'/api/state');assert.equal(calls[0].options,options,'authorization and request semantics are not rewritten');assert.equal(workerCalls,0);
  await api.catalogPost();assert.equal(calls.length,2,'a Request POST is not silently replaced by an embedded GET');assert.equal(calls[1].input.method,'POST');
 }finally{f.close();}
});

test('legacy and out-of-tree module imports cannot enter the new product artifact',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.dir,'old-controller.js'),'export const old=true;');
  fs.writeFileSync(path.join(f.frontendDir,'app.js'),"import '../old-controller.js';");
  await assert.rejects(buildFayoStatic(f),/independent frontend|legacy|external/);
  assert.equal(fs.existsSync(f.outputFile),false);
 }finally{f.close();}
});

test('external CSS resources, active logo markup and ambiguous source assets fail before output',async()=>{
 const f=fixture();try{
  fs.writeFileSync(path.join(f.frontendDir,'fayo.css'),'@import "https://external.example/theme.css";');
  await assert.rejects(buildFayoStatic(f),/external CSS asset/);assert.equal(fs.existsSync(f.outputFile),false);
  fs.writeFileSync(path.join(f.frontendDir,'fayo.css'),'body{color:white}');
  fs.writeFileSync(path.join(f.frontendDir,'mark.svg'),'<svg onload="unsafe()"></svg>');
  await assert.rejects(buildFayoStatic(f),/passive self-contained SVG/);
  fs.writeFileSync(path.join(f.frontendDir,'mark.svg'),'<svg viewBox="0 0 8 8"><path d="M1 1h6v6H1z"/></svg>');
  fs.writeFileSync(path.join(f.frontendDir,'index.html'),f.source.replace('</head>','<link rel="stylesheet" href="/nova/extra.css"></head>'));
  await assert.rejects(buildFayoStatic(f),/assets are ambiguous/);
 }finally{f.close();}
});

test('embedded credential literals and private catalog fields are rejected without replacing prior output',async()=>{
 const f=fixture();try{
  fs.writeFileSync(f.outputFile,'previous-artifact');
  fs.appendFileSync(path.join(f.frontendDir,'app.js'),"\nglobalThis.api_key='synthetic-credential-must-not-publish';");
  await assert.rejects(buildFayoStatic(f),error=>/embedded credential/.test(error.message)&&!error.message.includes('synthetic-credential'));
  assert.equal(fs.readFileSync(f.outputFile,'utf8'),'previous-artifact');
  fs.writeFileSync(path.join(f.frontendDir,'app.js'),"globalThis.identity='绯曜 FAYO';");
  fs.writeFileSync(f.catalogFile,JSON.stringify({schemaVersion:1,reviewDate:'2026-11-15',entries:[{id:'A01',name:'公开项',privateToken:'synthetic-sensitive-value'}]}));
  await assert.rejects(buildFayoStatic(f),/catalog must not contain credentials/);
  assert.equal(fs.readFileSync(f.outputFile,'utf8'),'previous-artifact');
 }finally{f.close();}
});

test('source files and hard links to canonical bytes cannot be used as output targets',async()=>{
 const f=fixture();try{
  const source=path.join(f.frontendDir,'index.html');
  await assert.rejects(buildFayoStatic({...f,outputFile:source}),/outside the canonical frontend/);
  const alias=path.join(f.dir,'source-alias.html');fs.linkSync(source,alias);
  await assert.rejects(buildFayoStatic({...f,outputFile:alias}),/canonical source bytes/);
  assert.equal(fs.readFileSync(source,'utf8'),f.source);
 }finally{f.close();}
});

test('the actual native FAYO source passes the unchanged static publisher validation',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fayo-real-artifact-'));
 try{
  const outputFile=path.join(dir,'fayo.html'),built=await buildFayoStatic({outputFile});
  assert.match(built.html,/<title>绯曜 FAYO/);assert.equal(built.embeddedCatalogCount,53);assert.ok(built.sizeBytes<2*1024*1024);
  assert.ok(built.sources.every(s=>s.file==='../assets/model-library-catalog.json'||!s.file.includes('..')));
  assert.ok(built.sources.some(s=>s.file==='research.js'));assert.ok(built.sources.some(s=>s.file==='operations.js'));
  assert.doesNotThrow(()=>validateArtifact(built.html));
  const release=buildWorkBuddyStatic({sourceFile:outputFile,sha:'b'.repeat(40)});assert.equal(parseStaticRelease(release.html).scope,'static-frontend-only');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('actual standalone app executes after its root markup and reaches the native login gate',async()=>{
 const {JSDOM,VirtualConsole}=require('../../V6_WEB/node_modules/jsdom');
 const built=await buildFayoStatic();
 assert.ok(built.html.indexOf('id="fayo-root"')<built.html.indexOf('<script data-fayo-inline="application">'),'classic bundle follows the parsed app root');
 const errors=[],calls=[],consoleEvents=new VirtualConsole();consoleEvents.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(built.html,{url:'https://fayo-backend.example/review.html',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:consoleEvents,beforeParse(window){
  window.Response=Response;window.Request=Request;window.Headers=Headers;window.TextDecoder=TextDecoder;
  window.scrollTo=()=>{};window.HTMLElement.prototype.scrollIntoView=()=>{};
  window.fetch=async(input,options)=>{calls.push({input:String(input),method:options?.method||'GET'});return new Response(JSON.stringify({ok:true,role:null,hasPassword:true,hasViewPassword:true}),{headers:{'Content-Type':'application/json'}});};
 }});
 try{
  for(let attempt=0;attempt<50&&!dom.window.document.querySelector('.fy-gate');attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.ok(dom.window.document.querySelector('.fy-gate'),'bundled native app renders login rather than retaining a null root');
  assert.match(dom.window.document.getElementById('fayo-root').textContent,/欢迎来到绯曜/);
  assert.ok(calls.some(call=>call.input.includes('/api/lock/status')),'actual app still requests its real backend identity route');
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});

test('actual standalone models page renders the embedded catalog when network assets are denied',async()=>{
 const {JSDOM,VirtualConsole}=require('../../V6_WEB/node_modules/jsdom');
 const built=await buildFayoStatic(),errors=[],networkAssets=[],calls=[];
 const events=new VirtualConsole();events.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(built.html,{url:'https://fayo-backend.example/review.html#/lab/models',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:events,beforeParse(window){
  window.Response=Response;window.Request=Request;window.Headers=Headers;window.TextDecoder=TextDecoder;
  window.scrollTo=()=>{};window.HTMLElement.prototype.scrollIntoView=()=>{};
  window.fetch=async(input,options)=>{
   const url=new URL(typeof input==='string'?input:input.url||input.href,window.location.href);calls.push(url.pathname);
   if(!url.pathname.startsWith('/api/')){networkAssets.push(url.pathname);throw Error('all network assets denied');}
   let body;
   if(url.pathname==='/api/lock/status')body={ok:true,role:'view',hasPassword:true,hasViewPassword:true};
   else if(url.pathname==='/api/state')body={trading:false,isSnapshot:true,snapshotDay:'20261113',dashboard:{rows:[],indices:[],counts:{},mood:{},strategies:[]}};
   else if(url.pathname==='/api/stream')return new Response('',{status:503});
   else throw Error('unconfigured test endpoint');
   return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  };
 }});
 try{
  for(let attempt=0;attempt<100&&!dom.window.document.querySelector('input[type=checkbox]');attempt++)await new Promise(resolve=>setTimeout(resolve,10));
  const page=dom.window.document;
  assert.equal(page.querySelectorAll('input[type=checkbox]').length,built.embeddedCatalogCount,'all committed public catalog records render offline from the standalone bundle');
  assert.match(page.getElementById('fayo-root').textContent,/模型与方法资料库/);
  assert.deepEqual(networkAssets,[],'models does not request a catalog, module, image or stylesheet from the static host');
  assert.ok(calls.includes('/api/lock/status')&&calls.includes('/api/state'),'identity and real market state remain backed by the service');
  assert.deepEqual(errors,[]);
 }finally{dom.window.close();}
});
