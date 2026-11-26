'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {projectEcbCsv,validate}=require('../src/core/ecb-fx-daily');
const em=fs.readFileSync(path.join(__dirname,'../em.js'),'utf8'),server=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
const now=Date.parse('2026-11-27T10:00:00+08:00');
class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
const tencent=(code,price='100',pre='90',pct='1',stamp='20261126160000')=>{
 const fields=Array(33).fill('');fields[1]=code;fields[3]=price;fields[4]=pre;fields[30]=stamp;fields[32]=pct;
 return 'v_'+code+'="'+fields.join('~')+'";';
};
function collectors(tx,sina=''){
 const start=em.includes('function externalObservedNumber(')?em.indexOf('function externalObservedNumber('):em.indexOf('async function fetchGlobal()');
 const a=em.slice(start,em.indexOf('// ⛔ if 轮：A股四大指数实时快讯',start));
 const b=em.slice(em.indexOf('async function fetchExtQuotes()'),em.indexOf('// 新浪行业板块列表'));
 const c=vm.createContext({Date:Clock,TextDecoder:class{decode(x){return x;}},txGet:async url=>url.includes('sinajs.cn')?sina:tx,_srcWarn(){}});
 vm.runInContext(a+'\n'+b,c);return c;
}
test('overseas missing percentages remain null, not a fabricated flat observation',async()=>{
 const c=collectors(tencent('usIXIC','100','90','')+tencent('usINX','200','190','0'),
  'var hq_str_int_nikkei="日经,100,,";var hq_str_znb_KOSPI="韩国,200,0,0";');
 const rows=await c.fetchGlobal();
 assert.equal(rows.find(x=>x.code==='usIXIC').pct,null);
 assert.equal(rows.find(x=>x.code==='usINX').pct,0);
 assert.equal(rows.find(x=>x.code==='nikkei').pct,null);
 assert.equal(rows.find(x=>x.code==='KOSPI').pct,0);
});
test('overseas numeric and identity checks reject malformed prices and conflicting duplicate codes',async()=>{
 const c=collectors(tencent('usDJI','0x20')+tencent('usINX','-1')+tencent('usIXIC','100','90','3')+tencent('usIXIC','101','90','4')+
 tencent('usOTHER','100','90','9')+tencent('hkHSI','100','90','NaN'));
 const rows=await c.fetchGlobal();
 assert.deepEqual(Array.from(rows,x=>x.code),['hkHSI']);assert.equal(rows[0].pct,null);
});
test('representative stocks cannot infer a return without a valid previous close or manufacture quote time',async()=>{
 const c=collectors(tencent('usNVDA','100','','')+tencent('usAAPL','110','100','10'));
 const rows=await c.fetchExtQuotes(),n=rows.find(x=>x.code==='usNVDA'),a=rows.find(x=>x.code==='usAAPL');
 assert.equal(n.pct,null);assert.equal(a.pct,10);
 assert.equal(a.quoteAt,null);assert.equal(a.tradeDate,null);assert.equal(a.providerTimeRaw,'20261126160000');
 assert.equal(a.receivedAt,now);assert.equal(a.decisionEligible,false);assert.equal(a.canTrade,false);
});
function moodContext(global){
 const start=server.indexOf('function marketMood()'),end=server.indexOf('// ═══ go 轮 C2',start);
 const S={global,stocks:[{code:'600001',pct:1},{code:'600002',pct:-1}],ztPool:[]};
 const c=vm.createContext({Date:Clock,S,A:{isLimitUp:()=>false,limitPctOf:()=>10},sectorMktFlow:()=>null,
  boardQualityOf:()=>({hardRate:null,hard:0,weak:0,missing:0}),idxRtLine:()=>null,todayStr:()=> '20261127'});
 vm.runInContext(server.slice(start,end),c);return c;
}
test('undated overseas changes cannot warm or cool the domestic decision, and genuine zero remains visible',()=>{
 const c=moodContext([{code:'usIXIC',pct:20},{code:'usINX',pct:20},{code:'usDJI',pct:20}]);
 let m=c.marketMood();assert.equal(m.mood,'中性');assert.equal(m.usAvg,20);assert.equal(m.cnAvg,null);
 assert.equal(m.externalDecisionEligible,false);assert.equal(m.usAnalysisAvg,null);
 c.S.global=[{code:'usIXIC',pct:-30},{code:'hkHSI',pct:0}];
 m=c.marketMood();assert.equal(m.mood,'中性');assert.equal(m.cnAvg,0);
 c.S.global=[];m=c.marketMood();assert.equal(m.mood,'中性');assert.equal(m.usAvg,null);
});
test('display refresh and scheduled external linkage retain research mapping without false excess or push',async()=>{
 const start=server.indexOf('async function refreshExtLink('),end=server.indexOf('\nasync function refreshGlobalForDisplay(',start);
 let sends=0;
 const S={global:[{code:'usIXIC',name:'index',pct:3}],extCache:{at:now,sectors:[{name:'板块',node:'b',pct:2}],
 stocks:new Map([['b',[{code:'600001',name:'sample',pct:2,price:10,turnover:3}]]])}};
 const c=vm.createContext({Date:Clock,S,console,EXT_PUSH_GAP:7200000,EXT_MAP:[{name:'fixture',exts:['usIXIC'],keys:['板块']}],
 em:{fetchExtQuotes:async()=>[]},A:{isJunkName:()=>false},capTooSmall:()=>false,reviewSnapshotFields:x=>x,reviewedRows:x=>x,isTradingTime:()=>true,
 sign:x=>x>0?'+':'',recommendationSendOptions:()=>({}),pushAll:()=>{sends++;}});
 vm.runInContext(server.slice(start,end),c);
 await c.refreshExtLink({notify:false});await c.refreshExtLink();
 assert.equal(sends,0);assert.equal(S.extPushed,undefined);assert.equal(S.extLink.basePct,null);
 assert.equal(S.extLink.groups[0].strength,null);assert.equal(S.extLink.picks.length,1);
 assert.equal(S.extLink.picks[0].canTrade,false);assert.equal(S.extLink.canNotify,false);
 c.em.fetchExtQuotes=async()=>[{code:'usIXIC',name:'index',pct:-3}];await c.refreshExtLink();
 assert.equal(S.extLink.groups.length,0);assert.equal(S.extLink.status,'unknown');
});
test('preselect does not use display-only external averages to boost model estimates',()=>{
 const start=server.indexOf('function computePreselect()'),end=server.indexOf('// ⛔ 预选盘买入前的独立分析',start);
 const S={candidatePool:[{code:'600001',name:'sample',mainInflow:1,score:70,paths:[],profitRatio:20}]};
 const c=vm.createContext({Date:Clock,S,A:{limitUpProbability:()=>.5},marketMood:()=>({usAvg:20,usAnalysisAvg:null,externalDecisionEligible:false,mood:'中性'}),
 numNeutral:(_,v)=>v,numGap:()=>2,calibratedProb:x=>x});
 vm.runInContext(server.slice(start,end),c);assert.equal(c.computePreselect().items[0].prob,50);
});
test('ECB direct projection rejects actual future European dates while preserving the query upper bound',()=>{
 const observation=Date.parse('2026-11-26T16:30:00Z'),cfg={currency:'USD',start:'2026-11-26',end:'2026-11-27'};
 const csv='KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,2026-11-27,1.2\n';
 assert.doesNotThrow(()=>validate({...cfg,now:observation}));
 assert.throws(()=>projectEcbCsv(csv,{...cfg,observedAt:observation}),/不一致/);
 const before=projectEcbCsv(csv.replace(',2026-11-27,',',2026-11-26,'),{...cfg,observedAt:observation});
 assert.equal(before.rows[0].unitsPerEuro,1.2);assert.equal(before.rows[0].quoteAt,null);
 const after=Date.parse('2026-11-26T23:00:00Z'),r=projectEcbCsv(csv,{...cfg,observedAt:after});
 assert.equal(r.rows[0].unitsPerEuro,1.2);assert.equal(r.rows[0].quoteAt,null);assert.equal(r.canTrade,false);
});
test('ECB direct projection validates its own query and retains the EUR denominator',()=>{
 const c='KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,2026-11-26,1.2\n';
 const cfg={currency:'USD',start:'2026-11-26',end:'2026-11-26',observedAt:now};
 assert.throws(()=>projectEcbCsv(c,{...cfg,start:'2025-01-01'}),/无效/);
 const r=projectEcbCsv(c,cfg);assert.equal(r.baseCurrency,'EUR');assert.equal(r.direction,'USD per 1 EUR');
 assert.equal(r.rows[0].providerPublishedAt,null);assert.equal(r.verifiedLive,false);assert.equal(r.canTrade,false);
});
