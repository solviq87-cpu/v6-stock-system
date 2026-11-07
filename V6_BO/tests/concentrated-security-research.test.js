 'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {validateUpload,validDate}=require('../src/strategy/research-upload-validator');
const cache=require('../src/strategy/persistent-research-cache');
const {scanUniverse}=require('../src/strategy/universe-scanner');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');
let n=0;const ok=(v,m)=>{assert.ok(v,m);n++};
const now=Date.now();const bars=Array.from({length:45},(_,i)=>{const c=+(10+i*.06).toFixed(2);return {open:c,high:c+.1,low:c-.1,close:c,volume:1e6};});
const stock={symbol:'000001',market:'main',feed:{source:'imported',timestamp:now},bars};
const p={stocks:[stock]};
ok(validateUpload(p)===null);ok(validDate('2024-02-29'));ok(!validDate('2025-02-29'));ok(!validDate('2026-13-01'));
ok(validateUpload({stocks:[stock,stock]})!==null);ok(validateUpload({stocks:[{...stock,symbol:'abc'}]})!==null);
ok(validateUpload({stocks:[{...stock,feed:{source:'eastmoney',timestamp:now}}]})!==null);
ok(validateUpload({stocks:[{...stock,feed:{source:'imported',timestamp:now+1e8}}]})!==null);
ok(validateUpload({stocks:[{...stock,bars:[...bars.slice(0,5),{...bars[5],high:0},...bars.slice(6)]}]})!==null);
const dates=bars.map((b,i)=>({...b,date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10)}));
ok(validateUpload({stocks:[{...stock,bars:dates}]})===null);
ok(validateUpload({stocks:[{...stock,bars:dates.map((b,i)=>i===10?{...b,date:dates[9].date}:b)}]})!==null);
ok(validateUpload({stocks:[{...stock,bars:dates.map((b,i)=>i===10?{...b,date:undefined}:b)}]})!==null);
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-audit-'));
try{
 const rows=bars.map((b,i)=>({...b,date:new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10)}));
 // Cache adapter accepts specific source row shapes; use existing adapter test for positive store cases.
 const symlink=path.join(root,'000002.json');fs.symlinkSync(path.join(root,'outside.json'),symlink);
 ok(cache.list(root).length===0,'symlink must not appear in cache listing');
 ok(cache.read(root,'000002').stock===null,'symlink must not be read');
 assert.throws(()=>cache.store(root,{code:'000002',rows,origin:'imported'}));n++;
 ok(cache.read(root,'../abc').stock===null);
}finally{fs.rmSync(root,{recursive:true,force:true});}
const scan=scanUniverse({stocks:[stock],now});ok(scan.total===1);
const ledger=ledgerBacktest({stocks:[stock],start:27,end:40,selectCandidates:()=>['000001']});
ok(ledger.equity.length===14);ok(ledger.trades.every(t=>t.sellDay>t.buyDay));
const expensive=ledgerBacktest({stocks:[stock],start:27,end:40,selectCandidates:()=>['000001'],feeBps:100,slippageBps:100});
ok(expensive.metrics.finalEquity<ledger.metrics.finalEquity);
console.log('PASS '+n+' cross-module security and research assertions');
