'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {executionCapacity:capacity}=require('../src/core/execution-risk');
const backend=require('../src/strategy/historical-session');
const browser=require('../../V6_WEB/src/vendor/historical-session');
const stock={market:'main',volumeUnit:'shares'},prior={close:10,volume:100000,amount:1000000};
const cap={maxParticipationPct:1};
const both=(bar,previous,security,side)=>{
 const a=backend.atLockedLimit(bar,previous,security,side),b=browser.atLockedLimit(bar,previous,security,side);
 assert.deepEqual(a,b);return a;
};

test('invalid requested shares and lot size cannot create a historical fill',()=>{
 for(const qty of [NaN,Infinity,-1,1.5,'100',Number.MAX_SAFE_INTEGER+1]){
  assert.equal(capacity(stock,prior,qty,100,cap).shares,0);
  assert.equal(capacity(stock,prior,qty,100).shares,0);
 }
 for(const lot of [0,-1,NaN,Infinity,1.5,'100'])assert.equal(capacity(stock,prior,100,lot,cap).shares,0);
});

test('an explicit unknown prior-bar share unit cannot borrow the stock default',()=>{
 for(const unit of [null,'unknown','lots',''])assert.equal(capacity(stock,{...prior,volumeUnit:unit},1000,100,cap).shares,0);
 assert.equal(capacity(stock,prior,1000,100,cap).shares,1000);
 assert.equal(capacity({}, {...prior,volumeUnit:'shares'},1000,100,cap).shares,1000);
});

test('fractional and unsafe share volumes are not executable liquidity evidence',()=>{
 for(const volume of [100000.5,Number.MAX_SAFE_INTEGER+1,Infinity,-1,'100000',null]){
  assert.equal(capacity(stock,{...prior,volume},1000,100,cap).shares,0);
 }
 assert.equal(capacity(stock,{...prior,volume:0},1000,100,cap).shares,0);
});

test('explicit incompatible turnover units and estimated amount cannot satisfy a CNY threshold',()=>{
 const cfg={minPriorTurnover:500000};
 for(const amountUnit of [null,'unknown','USD','lots',''])assert.equal(capacity(stock,{...prior,amountUnit},100,100,cfg).shares,0);
 for(const amountBasis of [null,'estimated','adjusted-turnover'])assert.equal(capacity(stock,{...prior,amountBasis},100,100,cfg).shares,0);
 assert.equal(capacity({...stock,amountUnit:'USD'},prior,100,100,cfg).shares,0);
 assert.equal(capacity(stock,{...prior,amountUnit:'CNY',amountBasis:'actual-unadjusted-turnover'},100,100,cfg).shares,100);
 // Historical research without explicit amount metadata keeps the existing legacy calculation.
 assert.equal(capacity(stock,prior,100,100,cfg).shares,100);
});

test('valid capacity stays bounded and retains odd-lot exit and optional-gate semantics',()=>{
 assert.equal(capacity(stock,prior,2000,100,cap).shares,1000);
 assert.equal(capacity(stock,prior,137,100,cap).shares,137);
 assert.equal(capacity(stock,{...prior,volume:9999},100,100,cap).shares,0);
 assert.deepEqual(capacity({},null,137,100),{shares:137,reason:null});
 assert.equal(capacity(stock,prior,0,100,cap).shares,0);
});

test('unknown or invalid opposite-side limit and contradictory pairs fail closed in both engines',()=>{
 for(const lowerLimit of [null,0,-1,NaN,'9',11,12])assert.equal(both({open:10,upperLimit:11,lowerLimit},prior,stock,'buy').blocked,true);
 for(const upperLimit of [null,0,-1,NaN,'11',9,8])assert.equal(both({open:10,upperLimit,lowerLimit:9},prior,stock,'sell').blocked,true);
 assert.equal(both({open:10,lowerLimit:12},prior,stock,'buy').blocked,true);
 assert.equal(both({open:10,upperLimit:8},prior,stock,'sell').blocked,true);
});

test('opening prices outside the explicitly observed opposite limit cannot be filled',()=>{
 const pair={upperLimit:11,lowerLimit:9};
 assert.equal(both({...pair,open:8.99},prior,stock,'buy').blocked,true);
 assert.equal(both({...pair,open:11.01},prior,stock,'sell').blocked,true);
 assert.equal(both({...pair,open:9},prior,stock,'buy').blocked,false);
 assert.equal(both({...pair,open:11},prior,stock,'sell').blocked,false);
});

test('invalid order direction cannot be interpreted as a sell',()=>{
 for(const side of [undefined,null,'hold','BUY',''])assert.equal(both({open:10,upperLimit:11,lowerLimit:9},prior,stock,side).blocked,true);
});

test('original one-sided limits, inferred board rules, ex-rights reference and opening causality remain',()=>{
 assert.deepEqual(both({open:10,upperLimit:11},null,{},'buy'),{blocked:false,boundary:11,reason:null});
 assert.equal(both({open:10,lowerLimit:9},null,{},'sell').blocked,false);
 assert.equal(both({open:11,low:10,high:11,close:10},prior,stock,'buy').blocked,true);
 assert.equal(both({open:9,high:10,low:9,close:10},prior,stock,'sell').blocked,true);
 assert.equal(both({open:10.99},prior,stock,'buy').blocked,false);
 assert.equal(both({open:9.01},prior,stock,'sell').blocked,false);
 assert.equal(both({open:5.5,corporateAction:{referenceClose:5}},prior,stock,'buy').boundary,5.5);
 assert.equal(both({open:10,upperLimit:null},prior,stock,'buy').blocked,true);
 assert.equal(both({open:10},prior,{market:'unknown'},'buy').blocked,true);
});

test('browser retains the exact existing shared historical-session implementation',()=>{
 const root=path.resolve(__dirname,'../..');
 assert.deepEqual(fs.readFileSync(path.join(root,'V6_BO/src/strategy/historical-session.js')),fs.readFileSync(path.join(root,'V6_WEB/src/vendor/historical-session.js')));
});

test('historical snapshots use the signal-day limit and exemption flags with future rows isolated',()=>{
 const s={symbol:'600000',market:'main',limitPct:5,isST:true,noPriceLimit:true,ipoNoLimit:true,bars:[
  {date:'2026-11-13',close:10},
  {date:'2026-11-16',close:10,isST:false,limitPct:10,noPriceLimit:false,ipoNoLimit:false},
  {date:'2026-11-17',close:11,isST:false,limitPct:20,noPriceLimit:true,ipoNoLimit:true}
 ]};
 for(const model of [backend,browser]){
  const earlier=model.historicalStock(s,1,'imported',1);
  assert.equal(earlier.limitPct,10);assert.equal(earlier.isST,false);assert.equal(earlier.noPriceLimit,false);assert.equal(earlier.ipoNoLimit,false);
  const later=model.historicalStock(s,2,'imported',2);
  assert.equal(later.limitPct,20);assert.equal(later.noPriceLimit,true);assert.equal(later.ipoNoLimit,true);
  s.bars[2].limitPct=30;assert.equal(model.historicalStock(s,1,'imported',1).limitPct,10);s.bars[2].limitPct=20;
 }
});

test('explicit unknown daily limits cannot borrow a current board default',()=>{
 for(const limitPct of [null,0,-1,NaN,Infinity,'10',101])for(const side of ['buy','sell']){
  const result=both({open:10,limitPct},prior,stock,side);assert.equal(result.blocked,true);assert.match(result.reason,/制度/);
 }
 assert.equal(both({open:10},prior,stock,'buy').blocked,false,'the existing no-field legacy baseline remains usable');
 assert.equal(both({open:10.5,limitPct:5},prior,{...stock,limitPct:20},'buy').blocked,true);
 assert.equal(both({open:10.5,limitPct:20},prior,{...stock,limitPct:5},'buy').blocked,false);
});

test('explicit no-limit sessions return an unsupported execution state without inventing a board cap',()=>{
 for(const flag of ['noPriceLimit','ipoNoLimit'])for(const side of ['buy','sell']){
  const result=both({open:10,[flag]:true},prior,stock,side);
  assert.equal(result.blocked,true);assert.match(result.reason,/无涨跌幅限制/);assert.equal(result.boundary,undefined);
  assert.equal(both({open:10,[flag]:false},prior,{...stock,[flag]:true},side).blocked,false);
 }
});

test('the original historical explanation uses dated security state in its actual rule evidence',()=>{
 const bars=Array.from({length:40},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),
  open:10,close:10,high:10.2,low:9.8,volume:1000000,amount:120000000,isST:false,suspended:false,tradable:true,
  limitPct:10,noPriceLimit:false,ipoNoLimit:false}));
 Object.assign(bars.at(-2),{open:10.9,close:11,high:11,low:10.9});
 Object.assign(bars.at(-1),{open:11.3,close:11.1,high:11.4,low:11,volume:3000000});
 const history={source:'imported',asOf:bars.at(-1).date,priceBasis:'unadjusted',stocks:[{
  symbol:'600000',market:'main',isST:true,limitPct:5,noPriceLimit:true,ipoNoLimit:true,bars}]};
 const {historicalExplanations}=require('../src/core/research-explanation-projection');
 const result=historicalExplanations(history),row=result.candidates[0];
 assert.ok(row.rationale.selection.rules.some(rule=>rule.id==='pattern:limit_up_shakeout_main'));
 assert.equal(row.historicalOnly,true);assert.equal(result.canTrade,false);assert.equal(result.officialCandidates,0);
 const unknown=structuredClone(history);unknown.stocks[0].bars.at(-1).limitPct=null;
 assert.equal(historicalExplanations(unknown).candidates[0].rationale.selection.rules.some(rule=>rule.id==='pattern:limit_up_shakeout_main'),false);
});
