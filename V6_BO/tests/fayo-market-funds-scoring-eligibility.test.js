'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createRequire}=require('node:module'),serverPath=require.resolve('../server.js'),source=fs.readFileSync(serverPath,'utf8'),serverRequire=createRequire(serverPath);
function loadFunctions(body,context){const ctx=vm.createContext(context);vm.runInContext(body,ctx);return ctx;}
const day='20261126',at=Date.parse('2026-11-26T10:00:00+08:00');
const row=(name,amount,patch={})=>({code:'BK'+String(name.charCodeAt(0)%10000).padStart(4,'0'),name,mainInflow:amount,source:'eastmoney',upstream:'eastmoney',fundsMethod:'vendor-order-size-estimate',fundsUnit:'CNY',unit:'CNY',retrievedAt:at,sourceTimestamp:at,tradeDate:'2026-11-26',...patch});
function sandbox(){
 let clock=at;
 class Clock extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
 const S={global:[{code:'us1',pct:0},{code:'hk1',pct:0}],stocks:[{code:'600001',pct:1},{code:'600002',pct:1},{code:'600003',pct:-1}],ztPool:[],sectorsInd:[],sectors:[],sectorsDay:day,sectorsAt:at};
 const context={S,Date:Clock,require:serverRequire,todayStr:()=>day,idxRtLine:()=>null,A:{isLimitUp:()=>false,limitPctOf:()=>10}};
 const body=[["function fundsObservationDay(","function fundsHistoryObservation("],["function sectorMktFlow()","// 指数按供应商原时点"],["function boardQualityOf(","// ═══ go 轮 C2"],["let _envColdCache","const ENV_COLD_UPLIFT"],["let _secRankCache","// 一只票同时属于"]].map(([a,b])=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)))).join('\n');
 const ctx=loadFunctions(body,context);
 return {ctx,S,now:v=>clock=v};
}
test('prior-day industry flow remains visible but cannot boost current mood or advice',()=>{
 const {ctx,S}=sandbox();S.sectorsDay='20261125';
 S.sectorsInd=[row('甲',100e8,{retrievedAt:at-86400000,sourceTimestamp:at-86400000,tradeDate:'2026-11-25'})];
 const m=ctx.marketMood();assert.equal(m.mktFlow,100);assert.equal(m.mktFlowAnalysisValue,null);assert.equal(m.bullish,null);
 assert.equal(m.advice,'观望');assert.match(m.evidence.join(' '),/未参与当前评分/);
});
test('unknown, stale or contradictory funds do not score; true zero stays zero',()=>{
 const {ctx,S,now}=sandbox();
 for(const patch of [{sourceTimestamp:null},{sourceTimestamp:at-15001}]){
  S.sectorsInd=[row('甲',100e8,patch)];const m=ctx.marketMood();assert.equal(m.mktFlow,100);assert.equal(m.mktFlowAnalysisValue,null);
 }
 S.sectorsInd=[row('甲',100e8,{unit:'USD'})];assert.equal(ctx.sectorMktFlow(),null);
 S.sectorsInd=[row('甲',0)];let m=ctx.marketMood();assert.equal(m.mktFlowAnalysisValue,0);assert.equal(m.bullish,false);assert.match(m.why,/资金净额为零/);
 now(at+15001);m=ctx.marketMood();assert.equal(m.mktFlow,0);assert.equal(m.mktFlowAnalysisValue,null);
});
test('partial, duplicate or mixed-source industry rows cannot claim a complete observed aggregate',()=>{
 const {ctx,S}=sandbox();
 for(const rows of [[row('甲',100e8),row('乙',null)],[row('甲',10),row('甲',10)],[row('甲',10),row('乙',20,{source:'ths',upstream:'ths'})]]){
  S.sectorsInd=rows;assert.equal(ctx.sectorMktFlow(),null);
 }
});
test('sector rank excludes unknown, mismatched date and conflicts, preserves zero and negative, and expires',()=>{
 const {ctx,S,now}=sandbox();
 S.sectors=[row('甲',100),row('乙',0),row('丙',-10),row('丁',null),row('戊',1e10,{sourceTimestamp:null}),row('己',1e11,{unit:'USD'}),
  row('庚',1000),row('庚',2000),row('辛',100,{code:'BK0099'}),row('壬',100,{code:'BK0099'}),row('癸',1e9,{tradeDate:'2026-11-25'})];
 assert.deepEqual([...ctx.sectorRankMap()],[['甲',1],['乙',2],['丙',3]]);
 now(at+15001);assert.equal(ctx.sectorRankMap().size,0);
 now(at);assert.equal(ctx.sectorRankMap().get('乙'),2);
 S.sectorsDay='20261125';assert.equal(ctx.sectorRankMap().size,0);
});
test('cold-market memo expires with the original funds evidence, not after sixty seconds',()=>{
 const {ctx,S,now}=sandbox();S.stocks=S.stocks.slice(1);
 S.sectorsInd=[row('甲',-100e8,{sourceTimestamp:at-14999})];
 assert.equal(ctx.envCold(),true);
 now(at+2);assert.equal(ctx.envCold(),false);
});
