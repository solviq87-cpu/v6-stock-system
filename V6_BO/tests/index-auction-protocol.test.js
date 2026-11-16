'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const source=process.env.V6_PROTOCOL_BASELINE_REF
 ?execFileSync('git',['show',process.env.V6_PROTOCOL_BASELINE_REF+':V6_BO/em.js'],{cwd:path.dirname(root),encoding:'utf8'})
 :fs.readFileSync(path.join(root,'em.js'),'utf8');
const friday=Date.parse('2026-11-13T10:00:00+08:00');
function fn(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);return source.slice(source.slice(start-6,start)==='async '?start-6:start,source.indexOf('\n}',start)+2);}
function context(names,extra={},now=friday){
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
 const c=vm.createContext({Date:Clock,Buffer,TextDecoder,EMH:'https://push2his.eastmoney.com',
  require:name=>{assert.equal(name,'./src/core/public-market');return require('../src/core/public-market');},...extra});
 vm.runInContext(names.map(fn).join('\n'),c);return c;
}
function wire(symbol='sh000001',at='20261113100000',price='3000',pct='1'){
 const f=Array(40).fill('0');Object.assign(f,{3:price,30:at,32:pct});return `v_${symbol}="${f.join('~')}";`;
}
function auction(data,now=friday){return context(['fetchAuctionTicks'],{get:async()=>({data})},now);}
const bar=(stamp='2026-11-13 09:15',price='10')=>`${stamp},10,${price},10.2,9.8,0`;

test('Tencent real index symbols map to stable public codes',async()=>{
 let requested;const symbols=['sh000001','sz399001','sz399006','sh000688'];
 const c=context(['fetchIdxRt','batchQuoteAtPublication'],{txGet:async url=>{requested=url;return Buffer.from(symbols.map(s=>wire(s)).join('\n'));}});
 const rows=await c.fetchIdxRt();assert.equal(requested,'https://qt.gtimg.cn/q='+symbols.join(','));
 assert.deepEqual(Array.from(rows,r=>r.code),['1.000001','0.399001','0.399006','1.000688']);
 assert.deepEqual(Array.from(rows,r=>r.name),['上证','深成','创业板','科创50']);
 for(const r of rows){assert.equal(r.quoteAt,friday);assert.equal(r.quoteSource,'tencent-index');assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);}
});
test('index original time retains exact 15-second and stale/future/unknown states',async()=>{
 for(const [at,state]of [['20261113095945','recent-unverified'],['20261113095944','stale'],['20261112150000','stale'],['20261113100001','future'],['','unknown']]){
  const c=context(['fetchIdxRt','batchQuoteAtPublication'],{txGet:async()=>Buffer.from(wire('sh000001',at))});
  const [r]=await c.fetchIdxRt();assert.ok(r);assert.equal(r.quoteFreshness,state);assert.equal(r.canTrade,false);assert.equal(r.canNotify,false);
 }
});
test('index rejects invalid prices and unrelated or legacy response identities',async()=>{
 const raw=[wire('sh000001','20261113100000','0'),wire('sz399001','20261113100000',' '),wire('sh000688','20261113100000','-'),wire('sh600000'),wire('1.000001')].join('\n');
 const c=context(['fetchIdxRt','batchQuoteAtPublication'],{txGet:async()=>Buffer.from(raw)});assert.equal((await c.fetchIdxRt()).length,0);
 const missingPct=context(['fetchIdxRt','batchQuoteAtPublication'],{txGet:async()=>Buffer.from(wire('sh000001','20261113100000','3000','-'))});
 const [observation]=await missingPct.fetchIdxRt();assert.ok(observation);assert.equal(observation.pct,null);
});
test('auction reads top-level preClose and preserves complete upstream date',async()=>{
 const c=auction({preClose:9.9,trends:[bar()]});const r=await c.fetchAuctionTicks('600000');
 assert.equal(r.preClose,9.9);assert.equal(r.tradeDate,'2026-11-13');assert.equal(r.bars[0].t,'09:15');assert.equal(r.bars[0].quoteAt,Date.parse('2026-11-13T09:15:00+08:00'));assert.equal(r.bars[0].vol,0);
});
test('weekend auction retains Friday date rather than stamping or clearing it',async()=>{
 const c=auction({preClose:9.9,trends:[bar()]},Date.parse('2026-11-15T10:00:00+08:00'));const r=await c.fetchAuctionTicks('600000');assert.ok(r);assert.equal(r.tradeDate,'2026-11-13');
});
test('auction optional target date rejects a mismatched session without changing old callers',async()=>{
 const c=auction({preClose:9.9,trends:[bar()]});assert.equal(await c.fetchAuctionTicks('600000','2026-11-12'),null);assert.ok(await c.fetchAuctionTicks('600000','2026-11-13'));
});
test('auction rejects zero, empty, malformed and nonfinite prices',async()=>{
 for(const value of ['0','',' ','-','NaN','Infinity','-1','0x10']){const c=auction({preClose:9.9,trends:[bar(undefined,value)]});assert.equal(await c.fetchAuctionTicks('600000'),null,value);}
});
test('auction rejects ambiguous mixed sessions and invalid/future dates',async()=>{
 for(const trends of [[bar(),bar('2026-11-12 09:16')],[bar('2026-02-30 09:15')],[bar('2026-11-14 09:15')]]){
  const c=auction({preClose:9.9,trends});assert.equal(await c.fetchAuctionTicks('600000'),null);
 }
});
test('auction keeps only auction minutes, orders bars and rejects duplicate minutes',async()=>{
 const c=auction({preClose:9.9,trends:[bar('2026-11-13 09:30'),bar('2026-11-13 09:25'),bar()]});
 assert.deepEqual(Array.from((await c.fetchAuctionTicks('600000')).bars,b=>b.t),['09:15','09:25']);
 const duplicate=auction({preClose:9.9,trends:[bar(),bar()]});assert.equal(await duplicate.fetchAuctionTicks('600000'),null);
});
test('auction missing values remain unknown and do not borrow legacy pre.close',async()=>{
 const c=auction({pre:{close:99},preClose:'',trends:['2026-11-13 09:15,10,10,,,']});const r=await c.fetchAuctionTicks('600000');
 assert.equal(r.preClose,null);assert.equal(r.bars[0].high,null);assert.equal(r.bars[0].low,null);assert.equal(r.bars[0].vol,null);
});
