'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {replayStrategyEvidence}=require('../src/core/strategy-evidence-replay');
const dates=Array.from({length:40},(_,i)=>new Date(Date.UTC(2025,0,1+i)).toISOString().slice(0,10));
const history={source:'fixture',asOf:dates.at(-1),stocks:['000001','000002'].map(code=>({code,bars:dates.map((date,i)=>({date,open:10+i*.01,high:11+i*.01,low:9+i*.01,close:10+i*.01,volume:1000}))}))};
function signal(symbol,date){return {system:'fourteen',symbol,date,verdict:'pass',provenance:'test:independent',observedThrough:date,evaluatorVersion:'test/v1'};}
test('drawdown is computed from chronological equal-weight exit-date portfolio, not evidence input order',()=>{
 const evidence=[signal('000002',dates[10]),signal('000001',dates[10]),signal('000001',dates[11]),signal('000002',dates[11])];
 const a=replayStrategyEvidence(history,{source:'test',generatedAt:'2025-02-20T00:00:00.000Z',signals:evidence});
 const b=replayStrategyEvidence(history,{source:'test',generatedAt:'2025-02-20T00:00:00.000Z',signals:[...evidence].reverse()});
 const sa=a.windows.unassigned.systems.fourteen,sb=b.windows.unassigned.systems.fourteen;
 assert.deepEqual(sa.dailyPortfolioReturns,sb.dailyPortfolioReturns);
 assert.equal(sa.drawdownMethod,'按退出交易日聚合的等权纸面组合日收益；非真实资金曲线');
});
test('daily portfolio groups overlapping trades on the same exit date',()=>{
 const evidence=[signal('000001',dates[10]),signal('000002',dates[10])];
 const r=replayStrategyEvidence(history,{source:'test',generatedAt:'2025-02-20T00:00:00.000Z',signals:evidence});
 const daily=r.windows.unassigned.systems.fourteen.dailyPortfolioReturns;
 assert.equal(daily.length,1);assert.equal(daily[0].tradeCount,2);assert.equal(daily[0].date,dates[12]);
});
