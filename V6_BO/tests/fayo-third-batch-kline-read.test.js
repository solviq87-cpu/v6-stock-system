'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const i=src.indexOf('async function klineRows(code) {'),fn=src.slice(i,src.indexOf('\n}\n',i)+2);
const now=Date.parse('2026-11-26T15:30:00+08:00');
const bar=date=>({date,open:10,high:11,low:9,close:10,volume:100});
const data=(date,receivedAt=now,meta={})=>({src:'tx',adjust:'qfq',receivedAt,rows:[bar(date)],...meta});
function make(memory,disk,fresh){
 const S={klines:new Map(memory?[['000001',memory]]:[])},at=new Map([['000001',now]]),gate=new Map(),meta=new Map(),writes=[];
 const Clock=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const f=new Function('S','_klineAt','_klineFreshGate','_klineReadMeta','latestTradeDate','klineLastDate','isMarketOpenNow','KLINE_INTRADAY_TTL','KLINE_CACHE','path','fs','em','_klineWriteErr','klineSet','Date',fn+';return klineRows;')(
  S,at,gate,meta,()=> '2026-11-26',rows=>rows?.at(-1)?.date||'',()=>false,1000,'/fixture',path,
  {readFileSync(){if(!disk)throw Error('no disk');return JSON.stringify(disk);},statSync(){return {mtimeMs:now};},writeFileSync(p,v){writes.push(JSON.parse(v));}},
  {fetchKline:async()=>fresh},()=>{},(code,k)=>S.klines.set(code,k),Clock);
 return {read:()=>f('000001'),meta,writes};
}
test('touching an intraday cache after close cannot suppress an actual refresh',async()=>{
 const unfinished=data('2026-11-26',now-3600000),settled={...data('2026-11-26'),rows:[{...bar('2026-11-26'),close:10.5}]};
 const x=make(unfinished,unfinished,settled);assert.equal((await x.read())[0].close,10.5);
 assert.equal(x.meta.get('000001').cacheLayer,'source');assert.equal(x.writes.length,1);
});
test('future, duplicate and wrong-period series cannot replace the last valid history',async()=>{
 const old=data('2026-11-25',now-86400000);
 for(const invalid of [data('2026-11-27'),data('2026-11-26',now,{frequency:'5m'}),data('2026-11-26',now,{adjust:'hfq'}),data('2026-11-26',now,{rows:[bar('2026-11-26'),bar('2026-11-26')]})]){
  const x=make(old,null,invalid);assert.equal((await x.read()).at(-1).date,'2026-11-25');assert.equal(x.writes.length,0);
 }
});
