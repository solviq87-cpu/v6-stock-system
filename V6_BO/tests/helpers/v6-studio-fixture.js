'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
function request(port,url,method='GET',body=null,token=''){
 return new Promise((resolve,reject)=>{
  const data=body===null?'':JSON.stringify(body);
  const req=http.request({hostname:'127.0.0.1',port,path:url,method,timeout:5000,
   headers:{...(data?{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)}:{}),...(token?{Authorization:'Bearer '+token}:{})}},res=>{
   let raw='';res.on('data',b=>raw+=b);res.on('end',()=>{let body;try{body=JSON.parse(raw);}catch{}resolve({status:res.statusCode,body,raw,headers:res.headers});});
  });req.once('error',reject);req.once('timeout',()=>req.destroy(Error('studio fixture timeout')));req.end(data);
 });
}
async function createFixture({count=250,serverSource}={}){
 const root=path.resolve(__dirname,'../..'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v6-studio-')),port=await freePort();
 for(const name of ['server.js','src','strategies','public','package.json'])if(fs.existsSync(path.join(root,name)))fs.cpSync(path.join(root,name),path.join(tmp,name),{recursive:true});
 for(const name of fs.readdirSync(root))if(name.endsWith('.js')&&name!=='server.js')fs.copyFileSync(path.join(root,name),path.join(tmp,name));
 const salt='studio-fixture-only-salt',password='studio-fixture-only-password';
 fs.writeFileSync(path.join(tmp,'access.json'),JSON.stringify({salt,hash:crypto.scryptSync(password,salt,32).toString('hex'),devices:{}}));
 const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
 const rows=Array.from({length:601},(_,i)=>({date:new Date(Date.parse(today)-(600-i)*86400000).toISOString().slice(0,10),
  open:10,high:10.6,low:9.9,close:i===600?10.4:10,volume:i===600?100000:200000,amount:2000000,pct:4,turnover:6}));
 const stocks=Array.from({length:count},(_,i)=>({code:String(600000+i),name:'隔离测试'+i,price:10.4,pct:4,turnover:6,floatCap:100e8,profitRatio:.8}));
 fs.writeFileSync(path.join(tmp,'studio-fixture.json'),JSON.stringify({rows,stocks}));
 const entry=path.join(tmp,'server.js'),original=serverSource??fs.readFileSync(entry,'utf8'),anchor='let _quantPicksCache = { ts: 0, data: null, busy: false };';
 if(!original.includes(anchor))throw Error('studio fixture anchor missing');
 // Only the temporary server copy receives synthetic state. Production has no fixture endpoint.
 fs.writeFileSync(entry,original.replace(anchor,`const studioFixture = JSON.parse(fs.readFileSync(path.join(__dirname,'studio-fixture.json'),'utf8')); S.stocks=studioFixture.stocks; for (const stock of S.stocks) klineSet(stock.code,{rows:studioFixture.rows});\n`+anchor));
 const guard=path.join(tmp,'deny-external.cjs');
 fs.writeFileSync(guard,`for(const name of ['http','https']){const m=require(name);for(const key of ['request','get']){const original=m[key];m[key]=function(...args){const v=args[0],h=typeof v==='string'?new URL(v).hostname:v?.hostname||v?.host||'localhost';if(!['127.0.0.1','localhost','::1'].includes(h))throw Error('studio fixture denies external network');return original.apply(this,args);};}}const originalFetch=global.fetch;global.fetch=function(url,...args){if(!['127.0.0.1','localhost','::1'].includes(new URL(url).hostname))throw Error('studio fixture denies external fetch');return originalFetch(url,...args);};`);
 const child=spawn(process.execPath,['--require',guard,'server.js'],{cwd:tmp,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',QD_CLOUD:'1',V6_ISOLATED_BOOT_SMOKE:'1',V6_OPTIONAL_RESEARCH_FILE:'',V6_SIX_PHOTO_FILE:''},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 async function close(){child.kill('SIGTERM');if(child.exitCode===null&&child.signalCode===null)await Promise.race([new Promise(resolve=>child.once('exit',resolve)),wait(1200)]);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');fs.rmSync(tmp,{recursive:true,force:true});}
 try{
  let ready=false;for(let i=0;i<80;i++){if(child.exitCode!==null)throw Error('studio fixture exited '+logs.slice(-900));try{await request(port,'/api/lock/status');ready=true;break;}catch{}await wait(100);}
  if(!ready)throw Error('studio fixture not ready '+logs.slice(-900));
  const login=await request(port,'/api/lock/unlock','POST',{role:'edit',password,fp:'studio-fixture-admin',name:'fixture-admin'});
  if(!login.body?.ok||!login.body.token)throw Error('studio fixture login failed');
  const token=login.body.token;
  return {port,tmp,root,token,password,rows,stocks,request:(url,method='GET',body=null,tok=token)=>request(port,url,method,body,tok),
   scan:()=>request(port,'/api/quant-picks?board=all&max=50&force=1','GET',null,token),close,logs:()=>logs};
 }catch(e){await close();throw e;}
}
module.exports={createFixture,request};
