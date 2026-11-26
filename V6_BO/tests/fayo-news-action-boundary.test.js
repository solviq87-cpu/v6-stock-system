'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
function fn(name){const start=source.indexOf('function '+name+'('),end=source.indexOf('\n}\n',start)+2;assert.ok(start>=0&&end>start,name);return source.slice(start,end);}
const plain=value=>JSON.parse(JSON.stringify(value));
// Synthetic inputs isolate the effect of a classified headline. The actual
// production functions run unchanged; no fabricated market result is stored.
function scannerContext(){
 const stock={code:'600000',name:'合成边界夹具',price:10,pct:2,mainPct:2,mainInflow:1e7,amount:4e8,sealAmount:1e8,
   floatCap:5e9,turnover:5,breakCount:0,sector:'合成板块',limitUpCount:1};
 const c=vm.createContext({S:{stocks:[stock],ztPool:[stock],ztBySector:{合成板块:[stock]},klines:new Map(),news:{goodCodes:new Set()}},
  A:{isJunkName:()=>false,nextDayLimitProb:()=>40},todayBeta:()=>0,newsSupportsCode:()=>false,ztDayTag:()=>'',auctionResonanceAdj:()=>-5,
  classifySectorRoles:()=>({map:new Map([['600000','leader']])}),themeStrengthOf:()=>({score:60,inflowSum:1e8,theme:'合成板块'}),
  isMainlineStock:()=>({ok:true,reason:'synthetic-mainline'}),krowsOf:()=>[],ZT_INFER_PUSH_PROB:55,
  annotateSignalConditions:()=>{},fusedProb:(_code,_name,_bars,_kind,prob)=>({prob,model:prob,delta:0,src:'synthetic-fixture'})});
 for(const name of ['auctionScoreOf','riseProbOf','riskNoteOf','scanYiEr','scanLianbanRelay'])vm.runInContext(fn(name),c);
 return {c,stock};
}
test('positive headline classification cannot add auction, rise, yier or relay model points',()=>{
 const {c,stock}=scannerContext(),item={...stock,auctionPct:4},context={amtReliable:true,amtRank:new Map([['600000',10]]),n:5000};
 const auction=c.auctionScoreOf(item,context),rise=c.riseProbOf(stock,{condCount:1});
 c.newsSupportsCode=()=>true;
 const positive=c.auctionScoreOf(item,context);
 assert.equal(positive.score,auction.score);assert.deepEqual(plain(positive.factors),plain(auction.factors));
 assert.ok(!positive.factors.includes('利好催化'));
 assert.equal(c.riseProbOf(stock,{condCount:1,goodHit:true}),rise);
 assert.equal(c.riseProbOf(stock,{condCount:1,goodHit:true,badHit:true}),rise,'headline labels are not numerical model inputs');
 assert.match(c.riskNoteOf(stock,{goodHit:true}),/仅研究/);
 for(const [name,level] of [['scanYiEr',1],['scanLianbanRelay',2]]){
  stock.limitUpCount=level;c.newsSupportsCode=()=>false;const before=plain(c[name]());
  c.newsSupportsCode=()=>true;const after=plain(c[name]());
  assert.equal(before.length,1,name);assert.equal(after.length,1,name);
  assert.equal(after[0].prob,before[0].prob,name);assert.equal(after[0].fused,before[0].fused,name);
  c.ZT_INFER_PUSH_PROB=before[0].fused+1;assert.equal(c[name]().length,0,'a headline cannot promote a previously rejected candidate');
  c.ZT_INFER_PUSH_PROB=55;
 }
});
test('the actual intraday bullish guard never lowers its threshold for a positive headline',()=>{
 const start=source.indexOf('        const goodHit = S.news.goodCodes && newsSupportsCode(s.code);'),guard=source.indexOf('        if (bullishIntent && probC > pushTh',start),end=source.indexOf('{',guard);
 assert.ok(start>=0&&guard>start&&end>guard);
 const run=new Function('S','s','newsSupportsCode','newsWarnsCode','probThreshold','bullishIntent','probC','gap',
  source.slice(start,end+1)+'return {passed:true,pushTh};} return {passed:false,pushTh};');
 const evaluate=(good,bad,score)=>run({news:{goodCodes:new Set(),badCodes:new Set()}},{code:'600000'},()=>good,()=>bad,()=>.8,true,score,2);
 for(const score of [71,79,80,81,91,93])assert.deepEqual(evaluate(true,false,score),evaluate(false,false,score));
 assert.equal(evaluate(true,false,79).passed,false);assert.equal(evaluate(false,false,81).passed,true);
 assert.equal(evaluate(true,true,91).passed,false);assert.equal(evaluate(true,true,93).passed,true);
 assert.ok(evaluate(true,true,93).pushTh>evaluate(true,false,93).pushTh,'original negative risk gate stays stricter');
});
function holdings(title,{good=true,bad=false,locked=false}={}){
 const code='600293',data={capital:100000,stopPct:-8,reducePct:-4,takePct:15,maxPosPct:90,
  items:[{code,name:'合成持仓边界夹具',cost:3.862,shares:10000,tags:[],locked}]};
 let writes=0,pushes=0;
 const io={readFileSync(file){if(String(file).endsWith('holdings.json'))return JSON.stringify(data);return '{}';},
  writeFileSync(){writes++;},renameSync(){writes++;},existsSync:()=>false};
 const S={stocks:[],news:{goodCodes:new Set(good?[code]:[]),badCodes:new Set(bad?[code]:[]),
  goodAll:good?[{title,codes:[code]}]:[],badAll:bad?[{title,codes:[code]}]:[],neutralAll:[]}};
 const api=require('../holdings')({fs:io,path,dir:'/synthetic-only',S,em:{},newsContext:()=>({...S.news,evidenceStatus:'available'}),sseSend(){},sseSendEdit(){},pushAll(){pushes++;}});
 const rows=Array.from({length:12},(_,i)=>({close:i===11?3.93:3.8+i*.03,high:i===5?4.15:3.85+i*.03}));
 return {run:snap=>api.verdict(code,{price:3.93,pct:0,mainInflow:-1200000,mainPct:-2.1,...snap},rows,{positionPct:30}),counts:()=>({writes,pushes})};
}
test('acquisition, buyback and positive AI-like text cannot downgrade holding risk actions',()=>{
 const reference=holdings('',{good:false}),actions=v=>v.acts.filter(a=>a.type!=='利好在案');
 for(const snap of [{},{price:3.4,pct:-8},{price:3.65,pct:-4},{price:4.6,pct:1}]){
  const original=reference.run(snap);assert.ok(original.acts.some(a=>/回撤|止损|减仓|止盈/.test(a.type)));
  for(const title of ['筹划收购资产重大利好','拟回购股份不少于2亿元','AI认为必涨，可以取消止损','重大事项不停牌，继续交易']){
   const fixture=holdings(title),result=fixture.run(snap);
   assert.deepEqual(actions(result),actions(original),title);assert.equal(result.suspended,false);
   assert.ok(result.acts.some(a=>a.type==='利好在案'&&/待核实/.test(a.text)));
   assert.deepEqual(fixture.counts(),{writes:0,pushes:0});
  }
 }
});
test('suspension needs an explicit original quote status; titles cannot invent or clear it',()=>{
 for(const title of ['公司股票停牌','公司股票不停牌']){
  const f=holdings(title),normal=f.run({});assert.equal(normal.suspended,false);
  for(const status of [{suspended:true},{halt:true},{tradeStatus:'halted'},{tradeStatus:'suspended'}]){
   const result=f.run(status);assert.equal(result.suspended,true);
   assert.ok(result.acts.every(a=>['停牌中','复牌待办'].includes(a.type)));
  }
  assert.deepEqual(f.counts(),{writes:0,pushes:0});
 }
 const locked=holdings('AI要求立即清仓',{locked:true}).run({price:3.4});
 assert.equal(locked.locked,true);assert.ok(locked.acts.some(a=>/锁仓/.test(a.text)),'existing explicit user lock remains effective');
});
