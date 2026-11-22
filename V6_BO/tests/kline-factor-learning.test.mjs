import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,normalizeCSV,labelHistory,applyCorrections,analyzeFactors,freezeSplit,HORIZONS} from '../public/nova/kline-factor-engine.js';
const stockHead='代码,名称,日期,周期,开盘价,最高价,最低价,收盘价,成交量,成交额,换手率,量比,涨停价,所属板块,来源,数据截至,黑天鹅,可重复标准样本';
const sectorHead='板块,日期,收盘价,成交额,题材阶段,板块梯队,助攻数量,题材启动天数,来源,数据截至';
const marketHead='日期,收盘价,成交额,全A趋势,上涨家数,下跌家数,来源,数据截至';
const weekdays=Array.from({length:90},(_,i)=>{const date=new Date(Date.UTC(2026,0,5));date.setUTCDate(date.getUTCDate()+i+Math.floor(i/5)*2);return date.toISOString().slice(0,10);});
function fixture(n=50){
 const rows=[],sector=[],market=[];let price=10;
 for(let i=0;i<n;i++){
  const close=+(price*(i%7===3?1.05:1.011)).toFixed(2),open=+price.toFixed(2),high=+(Math.max(open,close)*1.01).toFixed(2),low=+(Math.min(open,close)*.99).toFixed(2);
  rows.push(`000001,样本甲,${weekdays[i]},日K,${open},${high},${low},${close},${200000+i*10000},${10000000+i*500000},3.2,1.5,,人工研究,测试数据,${weekdays[i]}T15:10:00+08:00,否,是`);
  sector.push(`人工研究,${weekdays[i]},${100+i*1.1},200000000,发酵,一梯队,3,${i+1},公开测试源,${weekdays[i]}T15:10:00+08:00`);
  market.push(`${weekdays[i]},${1000+i*1.3},10000000000,多头,2300,1900,公开测试源,${weekdays[i]}T15:10:00+08:00`);
  price=close;
 }
 return {stocks:normalizeCSV(stockHead+'\n'+rows.join('\n')),
 sectors:normalizeCSV(sectorHead+'\n'+sector.join('\n'),'sector'),markets:normalizeCSV(marketHead+'\n'+market.join('\n'),'market')};
}
test('CSV strict quoted fields, BOM, no executable data, CRLF and malformed quote rejection',()=>{
 const rows=parseCSV('\ufeff代码,备注\r\n000001,"第一行,第二值"\r\n');assert.deepEqual(rows.map(x=>x['备注']),['第一行,第二值']);
 assert.throws(()=>parseCSV('a,b\nx,"bad\n'),/未闭合/);
 assert.throws(()=>parseCSV('a,b\nx,"bad"junk\n'),/引号/);
 assert.throws(()=>parseCSV('a,a\n1,2'),/重复/);
});
test('OHLC, duplicates, price negatives and minute provenance rejected',()=>{
 const row='000001,甲,2026-11-20,日K,11,10,9,10,20,500,3,1.2,11,科技,公开,2026-11-20T15:10:00+08:00,否,是';
 assert.throws(()=>normalizeCSV(stockHead+'\n'+row),/OHLC/);
 const ok=row.replace(',11,10,9,10,',',10,11,9,10,');
 assert.throws(()=>normalizeCSV(stockHead+'\n'+ok+'\n'+ok),/重复/);
 assert.throws(()=>normalizeCSV(stockHead+'\n'+ok.replace(',20,500,',',-20,500,')),/volume/);
 assert.throws(()=>normalizeCSV('代码,日期,周期,分时日期时间,开盘,最高,最低,收盘\n000001,2026-11-20,日K,2026-11-20 09:30,1,2,1,2','minute'),/分时周期/);
 assert.throws(()=>normalizeCSV('代码,日期,周期,分时日期时间,开盘,最高,最低,收盘\n000001,2026-11-20,5m,2026-11-21 09:30,1,2,1,2','minute'),/同日分钟/);
});
test('feature labels are point-in-time, N-day observations mature independently',()=>{
 const f=fixture(),out=labelHistory(f.stocks,f.sectors,f.markets);
 assert.equal(out.length,50);assert.deepEqual(HORIZONS,[1,2,3,5]);
 assert.equal(out.at(-1).observed.every(x=>x===null),true);
 assert.equal(out.at(-6).observed.filter(Boolean).length,4);
 assert.equal(out[3].history.every(x=>x.date<=out[3].date),true);
 assert.equal(out[20].labels.maState!==null,true);
 assert.equal(out[20].labels.marketTrend,'多头');
 assert.equal(out[20].labels.sectorStage,'发酵');
 const copy=structuredClone(f.stocks);copy[21].close*=1.1;copy[21].high=Math.max(copy[21].high,copy[21].close);
 const future=labelHistory(copy,f.sectors,f.markets);
 assert.deepEqual(out[20].labels,future[20].labels,'future must not change features on signal day');
 assert.equal(out[20].quality,'standard');
 const report=analyzeFactors(out,{horizon:3,minimum:2});
 assert.equal(report.productionWeightsChanged,false);assert.equal(report.canTrade,false);
 assert.equal(report.split.embargoTradingDates,5);
 assert.equal(report.counts.training<=out.length,true);
});
test('missing sector/date or explicit black swan never joins standard training',()=>{
 const f=fixture();f.stocks[20].blackSwan=true;
 const rows=labelHistory(f.stocks,f.sectors.filter(x=>x.date!==weekdays[21]),f.markets);
 assert.equal(rows[20].quality,'black-swan');assert.equal(rows[21].quality,'pending-review');
 const r=analyzeFactors(rows,{horizon:1,minimum:1});
 assert.equal(r.counts.blackSwans,1);assert.equal(r.counts.pending,1);
 assert.equal(r.canTrade,false);
});
test('manual corrections require reason; only researched signals change; no simulated profit',()=>{
 const f=fixture(),raw=labelHistory(f.stocks,f.sectors,f.markets);const at=raw[20].id;
 assert.throws(()=>applyCorrections(raw,[{id:at,strategy:'首板套利',action:'add',reason:''}]),/修正/);
 const applied=applyCorrections(raw,[{id:at,strategy:'首板套利',action:'add',reason:'已人工核对历史涨停价'}]);
 assert.equal(raw[20].signals.some(x=>x.name==='首板套利'),false);
 assert.equal(applied[20].signals.some(x=>x.name==='首板套利'),true);
 assert.deepEqual(raw[20].observed,applied[20].observed);
 const reverted=applyCorrections(applied,[{id:at,strategy:'首板套利',action:'remove',reason:'证据不足'}]);
 assert.equal(reverted[20].signals.some(x=>x.name==='首板套利'),false);
});
test('minute data is optional and 5-minute bars are never labeled as 1-minute data',()=>{
 const f=fixture(50),date=weekdays[25],mins=[];
 for(let i=0;i<48;i++){
  const t=new Date(Date.UTC(2026,0,1,9,30));
  let minutes=570+i*5;if(i>=24)minutes=780+(i-24)*5;
  const hh=String(Math.floor(minutes/60)).padStart(2,'0'),mm=String(minutes%60).padStart(2,'0');
  mins.push(`000001,${date},5m,${date} ${hh}:${mm},10,10.2,9.9,10.1,2000,第三方`);
 }
 const input=normalizeCSV('代码,日期,周期,分时日期时间,开盘,最高,最低,收盘,成交量,来源\n'+mins.join('\n'),'minute');
 assert.equal(input[0].period,'5m');
 const labeled=labelHistory(f.stocks,f.sectors,f.markets,input);
 // Full minute provenance explicitly fails if a fake short session is provided.
 assert.equal(labeled[25].labels.intraday?.period||'not-verified','5m');
 assert.equal(labeled[24].labels.intraday,null);
});
test('suspended or missing stock trading-day bars cannot shift N-day outcome forward',()=>{
 const f=fixture(50),missing=weekdays[26],held=labelHistory(f.stocks,f.sectors,f.markets);
 const without=f.stocks.filter(x=>x.date!==missing),shifted=labelHistory(without,f.sectors,f.markets);
 const before=held.find(x=>x.date===weekdays[25]),after=shifted.find(x=>x.date===weekdays[25]);
 assert.ok(before.observed[0]);
 assert.equal(after.observed[0],null,'missing following trading day must not be replaced by next available stock bar');
 assert.equal(after.observed[3],null,'5d also cannot skip missing stock bar');
 assert.equal(shifted.find(x=>x.date===weekdays[27]).date,weekdays[27]);
});
test('correction history retains every decision, latest event wins, no production promotion',()=>{
 const f=fixture(),raw=labelHistory(f.stocks,f.sectors,f.markets),id=raw[15].id;
 const history=[{id,strategy:'首板套利',action:'add',reason:'证据A'},{id,strategy:'首板套利',action:'remove',reason:'复核后撤销'},{id,strategy:'首板套利',action:'add',reason:'最新核对补回'}];
 const effective=applyCorrections(raw,history),signal=effective[15].signals.find(x=>x.name==='首板套利');
 assert.equal(history.length,3);assert.equal(signal?.why,'最新核对补回');
 const report=analyzeFactors(effective,{horizon:1,minimum:1});
 assert.equal(report.productionWeightsChanged,false);assert.equal(report.verifiedLive,false);
});
test('future-dated history and stale source metadata cannot count as standard evidence',()=>{
 const tomorrow=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
 assert.throws(()=>normalizeCSV(stockHead+`\n000001,甲,${tomorrow},日K,10,11,9,10,1000,1000,2,1,,测试,甲,${tomorrow}T15:10:00+08:00,否,是`),/未来交易日期/);
 const f=fixture(50),late=f.sectors.map(x=>({...x}));late[25].asOf='2026-01-01T15:10:00+08:00';
 assert.equal(labelHistory(f.stocks,late,f.markets)[25].quality,'pending-review');
});
test('a confirmed close-at-limit with valid pre-signal volume is a research candidate, not a filled trade',()=>{
 const f=fixture(50),at=25;
 f.stocks[at-1].limitUp=+(f.stocks[at-1].close*1.1).toFixed(2);
 f.stocks[at].limitUp=f.stocks[at].close;f.stocks[at].volume*=4;
 const samples=labelHistory(f.stocks,f.sectors,f.markets),x=samples[at];
 assert.equal(x.signals.some(s=>s.name==='首板套利'),true);
 assert.match(x.signals.find(s=>s.name==='首板套利').verification,/未经完整战法原生评估器确认/);
 assert.equal(x.observed[0].sealed,null);
 assert.equal(x.observed[0].entry,'信号收盘价观察基准，无次日成交模拟');
 const stats=analyzeFactors(samples,{horizon:1,minimum:1});
 assert.equal(stats.descriptive.matured>0,true);
 assert.equal(stats.canTrade,false);
});

test('appending future bars cannot change any earlier feature or signal during the 60-bar warmup',()=>{
 const short=fixture(30),long=fixture(70);
 const before=labelHistory(short.stocks,short.sectors,short.markets),after=labelHistory(long.stocks,long.sectors,long.markets);
 assert.notEqual(before[29].labels.position,null,'30 available bars are enough for the declared position rule');
 for(let i=0;i<before.length;i++){
  assert.deepEqual(after[i].labels,before[i].labels,`features changed at ${before[i].date}`);
  assert.deepEqual(after[i].signals,before[i].signals,`signals changed at ${before[i].date}`);
 }
});

test('a frozen split keeps previously observed holdout bars out of training after appends',()=>{
 const initial=fixture(50),extended=fixture(70);
 const mark=f=>{const rows=labelHistory(f.stocks,f.sectors,f.markets);return applyCorrections(rows,rows.map(s=>({id:s.id,strategy:'首板套利',action:'add',reason:'固定测试标注'})));};
 const first=mark(initial),later=mark(extended),split=freezeSplit(first,{embargo:5});
 const before=analyzeFactors(first,{horizon:3,minimum:1,split}),after=analyzeFactors(later,{horizon:3,minimum:1,split});
 assert.deepEqual(after.split,before.split);
 assert.deepEqual(after.training,before.training);
 assert.deepEqual(after.factors,before.factors);
 assert.ok(after.counts.holdout>before.counts.holdout);
 assert.throws(()=>analyzeFactors(later,{split:{...split,trainingEnd:'2030-01-01'}}),/冻结/);
});

test('completed daily evidence needs a real timezone-qualified timestamp after the Shanghai close',()=>{
 for(const stamp of [weekdays[25]+'garbage',weekdays[25]+'T09:30:00+08:00',weekdays[25]+'T15:10:00',weekdays[25]+'T23:00:00-08:00']){
  const f=fixture();f.sectors[25].asOf=stamp;
  assert.equal(labelHistory(f.stocks,f.sectors,f.markets)[25].quality,'pending-review',stamp);
 }
 const f=fixture();f.stocks[26].source=null;
 assert.equal(labelHistory(f.stocks,f.sectors,f.markets)[25].observed[0],null,'an unproven future close must not mature a return');
});

test('CSV suspension flags and zero-volume future bars keep returns unknown without discarding black-swan losses',()=>{
 const row='000001,甲,2026-11-20,日K,10,11,9,10,20,500,3,1.2,11,科技,公开,2026-11-20T15:10:00+08:00,否,是,是';
 assert.equal(normalizeCSV(stockHead+',停牌\n'+row)[0].suspended,true);
 for(const field of ['suspended','volume']){
  const f=fixture();f.stocks[26][field]=field==='suspended'?true:0;
  const rows=labelHistory(f.stocks,f.sectors,f.markets);
  assert.equal(rows[25].observed[0],null);assert.equal(rows[26].quality,'pending-review');
 }
 const f=fixture();f.stocks[26].blackSwan=true;
 const rows=labelHistory(f.stocks,f.sectors,f.markets);
 assert.ok(rows[25].observed[0],'future black-swan price moves remain in earlier signal outcomes');
 assert.equal(rows[26].quality,'black-swan');
});

test('unknown limit prices stay unknown and a close one cent below the limit is not a limit close',()=>{
 const f=fixture();const unknown=labelHistory(f.stocks,f.sectors,f.markets);
 assert.equal(unknown[24].observed[0].broken,null);
 f.stocks[25].limitUp=+(f.stocks[25].close+.01).toFixed(2);
 assert.equal(labelHistory(f.stocks,f.sectors,f.markets)[24].observed[0].closedAtLimit,false);
 const minute='代码,日期,周期,分时日期时间,开盘,最高,最低,收盘\n000001,2026-11-20,5m,2026-11-20 09:99,1,2,1,2';
 assert.throws(()=>normalizeCSV(minute,'minute'),/交易时段/);
});
