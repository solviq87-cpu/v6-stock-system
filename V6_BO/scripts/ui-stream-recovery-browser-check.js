'use strict';
// Real Chromium + isolated HTTP/SSE fixtures; no supplier requests or production messages.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http');
const {chromium}=require('playwright');
const source=fs.readFileSync(require.resolve('../public/assets/app.js'),'utf8');
const start=source.indexOf('let _es = null'),end=source.indexOf('// ── 各票池',start);
assert.ok(start>=0&&end>start);
const streamCode=source.slice(start,end);
let version=1;const streams=new Map(),opens=new Map(),reads=new Map(),methods=[];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');methods.push(req.method);
 const device=url.searchParams.get('dev');
 if(url.pathname==='/api/stream'){
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store'});res.write(': connected\n\n');
  opens.set(device,(opens.get(device)||0)+1);streams.set(device,res);
  req.on('close',()=>{if(streams.get(device)===res)streams.delete(device);});return;
 }
 if(url.pathname==='/api/state'){
  reads.set(device,(reads.get(device)||0)+1);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify({version}));return;
 }
 res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
 res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><span id="rtState"></span><output id="version"></output>');
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true,executablePath:process.env.V6_UI_BROWSER||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  const clients=[];
  for(const [device,width,height] of [['desktop',1440,900],['phone',390,844]]){
   const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.goto(`http://127.0.0.1:${server.address().port}/`);
   await page.evaluate(device=>{
    Object.assign(window,{GATE:{},LOCK:{},MY_DID:device,deviceName:()=>device,countdown:5});
    window.refresh=async()=>{
     const response=await fetch('/api/state?dev='+encodeURIComponent(device),{cache:'no-store'});
     document.getElementById('version').textContent=String((await response.json()).version);
    };
   },device);
   await page.addScriptTag({content:streamCode});await page.evaluate(()=>connectStream());
   await page.waitForFunction(()=>document.getElementById('version').textContent==='1');
   clients.push({device,context,page,errors});
  }
  const [desktop,phone]=clients;
  // Closing/disconnecting one device must not stop the other client's shared-state updates.
  await desktop.context.setOffline(true);streams.get('desktop')?.destroy();
  await desktop.page.waitForFunction(()=>document.getElementById('rtState').textContent.includes('中断'));
  version=2;streams.get('phone').write('event: pushed\ndata: {}\n\n');
  await phone.page.waitForFunction(()=>document.getElementById('version').textContent==='2');
  assert.equal(await desktop.page.locator('#version').textContent(),'1');
  await desktop.context.setOffline(false);
  await desktop.page.waitForFunction(()=>document.getElementById('version').textContent==='2');
  const count=opens.get('desktop');
  await desktop.page.evaluate(()=>{dispatchEvent(new Event('online'));dispatchEvent(new Event('online'));});
  await desktop.page.waitForTimeout(3300);
  assert.equal(opens.get('desktop'),count,'old retry/duplicate online must not replace healthy stream');
  await desktop.context.close();version=3;streams.get('phone').write('event: pushed\ndata: {}\n\n');
  await phone.page.waitForFunction(()=>document.getElementById('version').textContent==='3');
  for(const client of clients)assert.deepEqual(client.errors,[],client.device+' page errors');
  assert.ok(methods.every(method=>method==='GET'),'reconnect reads shared state without requesting recollection');
  console.log(JSON.stringify({passed:true,viewports:[1440,390],opens:Object.fromEntries(opens),reads:Object.fromEntries(reads),externalRequests:0}));
 }finally{
  await browser.close();for(const stream of streams.values())stream.destroy();
  await new Promise(resolve=>server.close(resolve));
 }
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
