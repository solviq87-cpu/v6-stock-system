'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {store,read,list}=require('../src/strategy/persistent-research-cache');
const {scanUniverse}=require('../src/strategy/universe-scanner');
const {ledgerBacktest}=require('../src/strategy/position-ledger-backtest');
const server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
let n=0;const ok=(x,msg)=>{assert.ok(x,msg);n++;};
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-research-'));
try{
 const now=Date.now();const bars=Array.from({length:46},(_,i)=>{const c=10+i*.04;return {date:new Date(now-(46-i)*86400000).toISOString().slice(0,10),open:c,high:c+.1,low:c-.1,close:c,volume:100000};});
 const x=store(root,{code:'000001',rows:bars,cachedAt:now,origin:'imported'});
 ok(x.code==='000001');ok(x.hash.length===64);ok(list(root).length===1);
 const r=read(root,'000001',{now});ok(!r.error);ok(r.stock.bars.length===46);
 ok(r.stock.dataAudit.verifiedLive===false);ok(r.stock.dataAudit.origin==='persisted-research-cache');
 ok(scanUniverse({stocks:[r.stock],now}).total===1);
 const ledger=ledgerBacktest({stocks:[r.stock],start:27,end:39});ok(ledger.equity.length===13);
 assert.throws(()=>store(root,{code:'../bad',rows:bars,cachedAt:now}));n++;
 assert.throws(()=>store(root,{code:'000002',rows:bars,cachedAt:now,origin:'verified-live'}));n++;
 const filename=path.join(root,'000001.json');const raw=JSON.parse(fs.readFileSync(filename));raw.payload.rows[0].close=9000;fs.writeFileSync(filename,JSON.stringify(raw));
 ok(read(root,'000001',{now}).error.includes('校验和'));
 ok(read(root,'000002',{now}).stock===null);
 ok(server.includes("p === '/api/research/disk-save'"));ok(server.includes('if(!requireEditor(res,req.__tok,req))return;'));
 ok(server.includes('历史样本不完整，拒绝回测'));ok(server.includes("provenance:'persisted-unverified-cache'"));
 const old=now-86400001;assert.throws(()=>store(root,{code:'000003',rows:bars,cachedAt:old}));n++;
 console.log('PASS '+n+' persistent cache and integration assertions');
}finally{fs.rmSync(root,{recursive:true,force:true});}
