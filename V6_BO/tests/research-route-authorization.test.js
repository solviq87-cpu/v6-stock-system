 'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.join(__dirname,'..'),server=fs.readFileSync(path.join(root,'server.js'),'utf8');
const frontend=fs.readFileSync(path.join(root,'public/assets/research-workbench.js'),'utf8');
let count=0;const ok=(v,m)=>{assert.ok(v,m);count++};
const marker="  // Research endpoints never accept unbounded JSON";
const start=server.indexOf(marker),end=server.indexOf('  // ---------------- 我的持仓（私密）',start);
ok(start>0&&end>start,'research routes found');
const block=server.slice(start,end);
const {validateUpload:V6ValidateResearchUpload}=require('../src/strategy/research-upload-validator');
const savedScans=[];
const context={V6ValidateResearchUpload,Buffer,Date,JSON,process:{env:{}},__dirname:root,
 saveWorkspaceScan:(result,provenance)=>{savedScans.push({result,provenance});result.workspace={status:'saved'};},
 S:{klines:new Map()},_klineAt:new Map(),V6DiskCache:{list:()=>[],store:()=>({}),read:()=>({})},
 V6ResearchScan:()=>({total:1,items:[]}),V6ResearchLedger:()=>({equity:[],metrics:{}}),
 requireEditor:(res,tok,req)=>{if(req.role==='edit')return true;res.out={ok:false,locked:true,readOnly:true};return false;},
 json:(res,obj)=>{res.out=obj;return obj;},require};
vm.createContext(context);
const run=(route,role='edit',method='POST',body='{}')=>{
 const req={method,role,__tok:role==='edit'?'developer-token':''},res={};
 const script=`(function(req,res,p,body){${block}})`;
 vm.runInContext(script,context)(req,res,route,body);
 return res.out;
};
ok(run('/api/research/capabilities','read','GET').locked,'read denied capability');
ok(run('/api/research/capabilities','edit','GET').ok,'editor capability');
ok(run('/api/research/capabilities','edit','POST').ok===false,'capability GET only');
const bars=Array.from({length:30},(_,i)=>({open:10,high:11,low:9,close:10,volume:1000,date:`2026-01-${String(i+1).padStart(2,'0')}`}));
const stock={symbol:'000001',feed:{source:'imported',timestamp:Date.now()},bars};
const payload=JSON.stringify({stocks:[stock]});
ok(run('/api/research/scan','read','POST',payload).locked,'read denied scan');
ok(savedScans.length===0,'denied scan cannot publish workspace history');
ok(run('/api/research/ledger','read','POST',payload).locked,'read denied ledger');
ok(run('/api/research/scan','edit','GET',payload).ok===false,'scan POST only');
ok(run('/api/research/scan','edit','POST',payload).ok,'editor scan');
ok(savedScans.length===1&&savedScans[0].provenance==='user-uploaded-unverified','accepted scan keeps original result and seals research receipt');
ok(run('/api/research/ledger','edit','POST',payload).ok,'editor ledger');
ok(run('/api/research/scan','edit','POST','{').ok===false,'bad JSON');
ok(run('/api/research/scan','edit','POST','x'.repeat(2*1024*1024+1)).ok===false,'2MB cap');
ok(run('/api/research/scan','edit','POST',JSON.stringify({stocks:[{...stock,feed:{source:'eastmoney'}}]})).ok===false,'provider spoof rejected');
ok(run('/api/research/scan','edit','POST',JSON.stringify({stocks:[stock,stock]})).ok===false,'duplicate rejected');
ok(run('/api/research/scan','edit','POST',JSON.stringify({stocks:[{...stock,bars:bars.slice(0,26)}]})).ok===false,'short bars rejected');
ok(run('/api/research/scan','edit','POST',JSON.stringify({stocks:[{...stock,bars:[...bars.slice(0,5),{...bars[5],low:12},...bars.slice(6)]}]})).ok===false,'bad OHLC rejected');
ok(run('/api/research/disk-save','read','POST','{}').locked,'read denied disk save');
ok(run('/api/research/disk-scan','read','POST','{}').locked,'read denied disk scan');
ok(run('/api/research/disk-ledger','read','POST','{}').locked,'read denied disk ledger');
ok(!frontend.includes("'?token='"),'frontend does not place token in URL');
ok(frontend.includes("'Authorization':'Bearer '"),'frontend bearer header');
ok(server.includes("req.headers.authorization"),'server bearer token support');
console.log('PASS '+count+' route-level authorization and input checks');
