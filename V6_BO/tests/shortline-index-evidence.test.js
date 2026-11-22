'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createShortlineV6Reader}=require('../src/research/shortline-v6-data');
const day='2026-11-20',days=['2026-11-17','2026-11-18','2026-11-19',day];
const ts=s=>Date.parse(s+'+08:00'),receipt=ts(day+'T15:12:00'),decision=receipt+60000;
const bars=closes=>closes.map((close,i)=>({date:days[i],close,open:close+.2,high:close+.3,low:close-.2,volume:200,volumeRatio:1.6,ma5:101-i,ma10:101,ma20:102}));
async function get(m,extra={}){
  const {addIndexEvidence}=await import('../public/nova/shortline/index-evidence.mjs');
  return addIndexEvidence({b:{date:day,sector:'机器人'},market:{date:day,...m},asOf:decision,...extra},new Map());
}
function tape(rows){return {name:'中证全指',source:'em',receivedAt:receipt,rows};}
test('index risk distinguishes volume expansion from a verified long bearish candle',async()=>{
  const rows=bars([100,99,98,97.9]),market={indexEvidence:tape(rows),volume:'放量下跌',trend:'空头'};
  let facts=await get(market);
  for(const k of ['72:0','72:1','85:0'])assert.equal(facts.get(k).pass,false);
  rows[3]={...rows[3],open:98,high:98,low:94.5,close:95};
  facts=await get(market);
  for(const k of ['72:0','72:1','85:0']){assert.equal(facts.get(k).pass,true);assert.match(facts.get(k).source,/量比/);}
  assert.equal(facts.get('91:0').pass,true);
  assert.ok(!facts.has('85:1'),'marketwide capitulation requires more than a bearish candle');
  delete rows[3].open;
  facts=await get(market);assert.ok(!facts.has('72:0'));
});
test('all-A index evidence excludes future receipts, wrong instruments, gaps in sessions and future bars',async()=>{
  const rows=bars([100,99,98,97]),e=tape(rows);
  assert.equal((await get({indexEvidence:{...e,receivedAt:decision+1}})).size,0);
  assert.equal((await get({indexEvidence:{...e,name:'上证指数'}})).size,0);
  assert.equal((await get({indexEvidence:{...e,rows:[rows[0],rows[2],rows[3]]}})).has('91:0'),false);
  const plain=await get({indexEvidence:e});
  assert.deepEqual(await get({indexEvidence:{...e,rows:[...rows,{...rows[3],date:'2026-11-23',close:400}]}}),plain);
  assert.equal((await get({trend:'多头',availableAt:'2026-11-21 15:00'})).size,0);
});
test('cross-index breadth, theme and tape evidence are bounded by actual fields',async()=>{
  const rows=bars([101,102,101,102]);
  Object.assign(rows[2],{open:101,low:100,high:101,ma20:100.5});
  Object.assign(rows[3],{open:102,low:101.5,high:103,ma20:103});
  const facts=await get({trend:'多头',sh:'多头',cy:'空头',indexChange:.5,adv:100,dec:300,theme:'机器人',themeType:'主线',premium:2,indexEvidence:tape(rows)},{sector:{change:2.5}});
  for(const k of ['71:0','76:0','80:4','89:0','94:0','95:0'])assert.equal(facts.get(k).pass,true,k);
  assert.equal(facts.get('80:3').pass,false);
  const none=await get({trend:'多头'},{sector:{change:7,knownAt:decision+1}});
  for(const key of ['80:1','89:0','75:0','71:0','93:0','95:0','79:0'])assert.equal(none.has(key),false,key);
  assert.ok(!(await get({indexChange:.1,adv:null,dec:1})).has('95:0'));
});
test('readSource freezes all-A index OHLC, MA, volume ratio and actual provider receipt',async()=>{
  const rows=[];
  for(const d=new Date('2026-10-19T12:00:00Z');d.toISOString().slice(0,10)<=day;d.setUTCDate(d.getUTCDate()+1)){
    if([0,6].includes(d.getUTCDay()))continue;
    const close=100+rows.length;rows.push({date:d.toISOString().slice(0,10),open:close-1,high:close+1,low:close-2,close,volume:500});
  }
  const reader=createShortlineV6Reader({getState:()=>({}),clock:()=>decision,getLatestClosedDay:()=>day,previousTradeDay:()=>days[2],
    readCloseReviewEvidence:async()=>({}),fetchHistory:async()=>null,fetchPreviousPool:async()=>null,
    fetchIndexKline:async id=>id==='1.000985'?{name:'中证全指',src:'em',receivedAt:receipt,rows}:null});
  const out=await reader({code:'600001'}),m=out.market[0],r=m.indexEvidence.rows.at(-1),last=rows.at(-1);
  assert.equal(m.trend,'多头');assert.equal(r.close,last.close);assert.equal(r.open,last.open);assert.equal(r.volumeRatio,1);
  assert.equal(r.ma20,last.close-9.5);assert.equal(m.indexEvidence.receivedAt,receipt);
});

test('same-session rotation keeps received index evidence and exact-membership sector change only',()=>{
  const {applyShortlineV6Source}=require('../src/research/shortline-v6-data');
  const state={},theme={name:'机器人',classification:'财联社题材归属',members:[{code:'600001'},{code:'600002'}]};
  const old={date:day,indexEvidence:tape(bars([100,100,99,98])),themes:[{...theme,change:2.3,changeSource:'V6 板块行情'}],knownAt:receipt};
  function put(row){return applyShortlineV6Source(state,{bars:[],market:[row]});}
  put(old);
  const fresh={...old,indexEvidence:{...old.indexEvidence,receivedAt:decision},themes:[theme],knownAt:decision};
  assert.equal(put(fresh).daysRevised,0);
  assert.equal(state.market[0].indexEvidence.receivedAt,receipt);
  assert.equal(put({...fresh,upLimit:34}).daysRevised,1);
  assert.equal(state.market[0].themes[0].change,2.3);
  assert.equal(state.market[0].themes[0].changeSource,'V6 板块行情');
  for(const patch of [{date:'2026-11-23'}, {themes:[{...theme,name:'芯片'}]}, {themes:[{...theme,classification:'其他口径'}]},
      {themes:[{...theme,members:[{code:'600003'},{code:'600001'}]}]}, {themes:[{...theme,members:[]}]},{themes:[{...theme,change:null}]}]){
    const local={};applyShortlineV6Source(local,{bars:[],market:[old]});
    applyShortlineV6Source(local,{bars:[],market:[{...fresh,...patch}]});
    assert.ok(local.market.at(-1).themes[0].change==null);
  }
  const revised={...fresh,indexEvidence:{...fresh.indexEvidence,rows:bars([100,100,99,97])}};
  put(revised);assert.equal(state.market[0].indexEvidence.receivedAt,decision);
  assert.equal(state.marketHistory.at(-1).indexEvidence.rows.at(-1).close,98);
});
