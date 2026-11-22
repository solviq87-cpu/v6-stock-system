import test from 'node:test';
import assert from 'node:assert/strict';
import {syncedDataset,syncedSeries} from '../public/nova/kline-synced-history.js';
import {renderKlineLearning} from '../public/nova/kline-learning-view.js';
const at=(d,t='15:10')=>Date.parse(d+'T'+t+':00+08:00'),now=at('2024-06-11','18:00');
const b=(date,k=0)=>({date,code:'600000',name:'归档测试',role:'stock',period:'日K',open:10+k,high:11+k,low:9+k,close:10.5+k,volume:200+k,amount:501+k,turnover:2.5,source:'V6/eastmoney',knownAt:at(date),volumeUnit:'shares',priceBasis:'unadjusted'});
const market=(date,atTime,trend)=>({date,source:'V6 收盘原始证据',knownAt:at(date,atTime),trend,adv:1200,dec:1800,amount:9812,themes:[{name:'芯片',ladder:'二板',assists:4,members:[{code:'600000'}]}]});
function state(){
 const d='2024-06-04';
 return {revision:8,marketHistory:[market(d,'15:01','震荡')],market:[market(d,'17:00','空头')],bars:[{...b('2024-06-03'),knownAt:at(d,'15:20')},b(d),{...b('2024-06-05'),knownAt:now+1},b('2024-06-07')],checks:[]};
}
test('图表保留原始行情；信号点只见当时已知的K线、市场版和板块成员',()=>{
 const s=state(),data=syncedDataset(s,now),r=syncedSeries(data,'600000');
 assert.equal(r.rows.length,3);assert.equal(r.late,1);assert.equal(r.samples.length,2);
 const first=r.samples[0];
 assert.equal(first.history.length,1);assert.equal(first.labels.marketTrend,'震荡');assert.equal(first.labels.assistCount,4);
 assert.equal(first.market.amount,9812e8);assert.equal(first.market.close,null);assert.equal(first.bar.volume,200);
 assert.equal(first.bar.turnover,2.5);assert.equal(first.labels.sectorStage,null);assert.equal(first.quality,'pending-review');
 assert.equal(r.samples.at(-1).history.length,3);
});
test('查询时刻之后的修订与单标的今日题材不能回填历史，稀疏交易日不压缩收益期限',()=>{
 const s=state();s.bars=[b('2024-06-04'),b('2024-06-07')];
 s.market=s.bars.map(r=>({...market(r.date,'15:01','多头'),themes:[]}));
 s.marketHistory=[];s.v6Observation={code:'600000',day:'2024-06-07',latestClosed:true,observedAtMs:at('2024-06-07','16:00'),stock:{sector:'今日板块',sectorAssists:7}};
 const r=syncedSeries(syncedDataset(s,now),'600000');
 assert.equal(r.samples[0].sector,null);assert.equal(r.samples[1].sector,null);assert.equal(r.sector.code,'今日板块');
 assert.ok(r.samples[0].observed.every(x=>x===null));
 s.checks=[{date:'2024-06-07',code:'600000',method:'行情自动识别',sourceFingerprint:'frozen',asOf:'2024-06-07 16:01'}];
 assert.equal(syncedSeries(syncedDataset(s,now),'600000').samples[1].sector.code,'今日板块');
});

class El{
 constructor(t){this.tagName=t;this.children=[];this.attributes={};this.listeners={};this.style={};this.value='';this.text='';}
 set textContent(x){this.text=String(x);this.children=[];}get textContent(){return this.text+this.children.map(x=>x.textContent).join('');}
 append(...x){for(const c of x){this.children.push(c);c.parentNode=this;}}replaceChildren(...x){this.text='';this.children=[];this.append(...x);}
 setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}
}
test('服务器数据只使用已授权 GET；降级清空图表与在途响应；查看用户保留本地输入',async t=>{
 const original={Node:globalThis.Node,document:globalThis.document};
 globalThis.Node=El;globalThis.document={createElement:x=>new El(x),createElementNS:(_,x)=>new El(x),createTextNode:x=>{const n=new El('text');n.textContent=x;return n;}};
 t.after(()=>Object.assign(globalThis,original));
 let role='edit',resolve,polls=[],calls=0;
 const ctx={get role(){return role;},signal:new AbortController().signal,onState:fn=>polls.push(fn),
 api:(p,o)=>{calls++;assert.equal(p,'/api/research/shortline');assert.equal(o.method,'GET');assert.equal(o.body,undefined);return new Promise(r=>resolve=r);}};
 const result={ok:true,state:{...state(),permissions:{role:'edit'}}};
 const view=renderKlineLearning(ctx);resolve(result);await new Promise(r=>setImmediate(r));
 assert.match(view.textContent,/归档测试/);assert.match(view.textContent,/K线样本/);
 role='view';polls.forEach(fn=>fn());assert.doesNotMatch(view.textContent,/归档测试|V6\/eastmoney/);
 role='edit';polls.forEach(fn=>fn());role='view';polls.forEach(fn=>fn());resolve(result);await new Promise(r=>setImmediate(r));
 assert.doesNotMatch(view.textContent,/归档测试/);assert.equal(calls,2);
 const v=renderKlineLearning(ctx);assert.equal(calls,2);assert.match(v.textContent,/历史日K CSV/);
});
