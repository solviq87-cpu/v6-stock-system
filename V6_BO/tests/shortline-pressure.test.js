'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createShortlinePressureReader}=require('../src/research/shortline-pressure');
const mod=import('../public/nova/shortline/pressure.mjs');
const day='2026-11-20',code='600000',other='300015';
const start=Date.parse(day+'T15:16:00+08:00');
const iso=t=>new Date(t).toISOString();
function packet(){
  const docs=[
    {art_code:'AN2026112012345',title:'关于减持、解禁、商誉事项及回复问询函的公告',
      display_time:'2026-11-20 13:00:00:000',notice_date:day,codes:[{stock_code:code}],columns:[{column_name:'问询函'}]},
    {art_code:'AN2026112012346',title:'监管函',display_time:'2026-11-20 12:00:00:000',notice_date:day,codes:[{stock_code:code}],columns:[{column_name:'监管函'}]},
    {art_code:'AN2026112012347',title:'关于减持计划的公告',display_time:'2026-11-20 21:00:00:000',notice_date:day,codes:[{stock_code:code}]},
    {art_code:'AN2026112012348',title:'关于股份解禁的公告',notice_date:day,codes:[{stock_code:other}]}
  ];
  const reduction=[{SECURITY_CODE:code,CHANGE_DATE:'2026-11-17',CHANGE_REASON:'二级市场买卖',CHANGE_SHARES:-20000,PERSON_NAME:'甲某',HOLD_TYPE:'A股',CHANGE_AFTER_HOLDNUM:80000}];
  const unlock=[{SECURITY_CODE:code,EUTIME:'2026-11-19 17:00:00',FREE_DATE:'2026-11-25',FREE_SHARES_TYPE:'首发限售',ABLE_FREE_SHARES:120},
    {SECURITY_CODE:code,EUTIME:'2026-11-23 17:00:00',FREE_DATE:'2026-11-27',FREE_SHARES_TYPE:'股权激励',ABLE_FREE_SHARES:600}];
  const financial=[{SECURITY_CODE:code,NOTICE_DATE:'2026-10-31',REPORT_DATE:'2026-09-30',SUMSHEQUITY:1000,GOODWILL:350,SUMSHEQUITY_RATIO:.35},
    {SECURITY_CODE:other,NOTICE_DATE:'2026-10-31',REPORT_DATE:'2026-09-30',SUMSHEQUITY:1000,GOODWILL:50,SUMSHEQUITY_RATIO:.05},
    {SECURITY_CODE:code,NOTICE_DATE:'2026-11-21',REPORT_DATE:'2026-10-30',SUMSHEQUITY:1000,GOODWILL:900,SUMSHEQUITY_RATIO:.9}];
  return {docs,reduction,unlock,financial};
}
function fixtures(clock,rows=packet(),fail=false){
  let calls=0;
  const reader=createShortlinePressureReader({pool:()=>[other,code,code],now:()=>clock.value,requestJson:async url=>{
    calls++;
    const u=new URL(url),isNotice=u.hostname.startsWith('np-');
    const data=isNotice?rows.docs:({RPT_LIFT_STAGE:rows.unlock,RPT_GOODWILL_STOCKDETAILS:rows.financial,RPT_EXECUTIVE_HOLD_DETAILS:rows.reduction})[u.searchParams.get('reportName')];
    assert.ok(isNotice?u.searchParams.get('stock_list').includes(other):u.searchParams.get('filter').includes(code));
    if(fail&&isNotice)throw Error('down');
    const obj=isNotice?{data:{list:data,total_hits:data.length}}:{success:true,result:{count:data.length,data}};
    return {status:200,raw:Buffer.from(JSON.stringify(obj))};
  }});
  return {reader,calls:()=>calls};
}

test('候选并发共用四份限频响应，核对币种单位、代码、日期和回执，标题不会升级为事实',async()=>{
  const setup=fixtures({value:start}),[a,b]=await Promise.all([setup.reader({code,day}),setup.reader({code:other,day})]);
  assert.equal(setup.calls(),4);
  assert.deepEqual(a.factorCodes.sort(),['GG-01','GG-05']);
  assert.deepEqual(a.coverage.map(c=>c.status),Array(4).fill('已检索'));
  assert.deepEqual(a.facts.map(f=>f.category).sort(),['减持','商誉','监管','解禁'].sort());
  assert.equal(a.facts.find(f=>f.category==='商誉').value,35);
  assert.equal(a.facts.find(f=>f.category==='解禁').value,120);
  assert.equal(a.facts.find(f=>f.category==='减持').unit,'股');
  assert.ok(a.facts.every(f=>f.code===code&&f.verified&&f.knownAt===start));
  assert.ok(a.clues.some(c=>c.category==='问询'&&!c.verified));
  assert.ok(a.clues.every(c=>!c.title.includes('计划')));
  assert.deepEqual(b.facts.map(f=>f.value),[5]);
  assert.ok(b.clues.every(c=>c.code===other));
  assert.equal((await setup.reader({code,day})).knownAt,start);
  assert.equal(setup.calls(),4);
});

test('晚取不到的历史扫描不回填事实；巨潮原公告独立验码、证据时间和域名',async()=>{
  const set=fixtures({value:start}),asOf=start-3600000;
  const base={code,publishedAt:iso(asOf-3600000),knownAt:iso(asOf-1000),url:'https://static.cninfo.com.cn/finalpage/2026-11-20/123.pdf',source:'巨潮资讯',title:'收到问询函'};
  const stock={announcements:[base,{...base,code:other},{...base,url:'https://x.invalid/a.pdf'},{...base,knownAt:iso(start),title:'减持计划'}]};
  const r=await set.reader({code,day,asOf,stock});
  assert.equal(set.calls(),0);assert.deepEqual(r.facts,[]);assert.equal(r.clues.length,1);assert.equal(r.clues[0].knownAt,asOf-1000);
  assert.equal((await set.reader({code,day:'2026-11-19'})).facts.length,0);
  assert.equal(set.calls(),0);
  const partial=fixtures({value:start},packet(),true);
  const fetched=await partial.reader({code,day});
  assert.equal(fetched.coverage[0].status,'未取得');assert.ok(fetched.facts.length>0);
  assert.ok(fetched.clues.length===0);
});

test('复核保持首次可知，版本改变保留旧值；只用已核实且尚有效的事实学习',async()=>{
  const {mergePressureHistory,pressureLearningTags}=await mod;
  const times={value:start},a=fixtures(times);
  const original=await a.reader({code,day});
  const state={},markers={code,date:day};
  mergePressureHistory(state,original);
  times.value+=100000;mergePressureHistory(state,await a.reader({code,day}));
  assert.equal(state.pressureHistory.length,1);assert.equal(state.pressureHistory[0].facts.length,4);
  assert.deepEqual(pressureLearningTags(state,markers,start-1),[]);
  const tags=pressureLearningTags(state,markers,start);
  assert.ok(tags.includes('压力·高商誉（≥30%净资产）'));assert.ok(!tags.some(x=>x.includes('问询')));
  const data=packet();data.financial[0].GOODWILL=10;data.financial[0].SUMSHEQUITY_RATIO=.01;
  const revised=await fixtures(times,data).reader({code,day});
  mergePressureHistory(state,revised);
  assert.deepEqual(pressureLearningTags(state,markers,start),tags);
  assert.ok(!pressureLearningTags(state,markers,times.value).some(x=>x.includes('商誉')));
  assert.deepEqual(pressureLearningTags(state,{code,date:'2027-12-31'},times.value+420*86400000),[]);
  times.value+=100000;mergePressureHistory(state,await fixtures(times).reader({code,day}));
  assert.ok(pressureLearningTags(state,markers,times.value).some(x=>x.includes('高商誉')));
  assert.ok(pressureLearningTags(state,{code,date:'2026-12-11'},times.value+21*86400000).some(x=>x.includes('高商誉')));

});

test('筹码图保留原始值及原始可知时间，估算逐日回看，其他代码、分时与未来K不参与',async()=>{
  const {chipHistory}=await mod;
  const dates=Array.from({length:25},(_,i)=>new Date(Date.parse('2026-10-01')+i*86400000).toISOString().slice(0,10));
  const bars=dates.map((d,i)=>({code,date:d,period:'日K',source:'研究日线',availableAt:d+' 15:01',knownAt:Date.parse(d+'T15:01:10+08:00'),
    low:9,high:12,open:10,close:10,volume:500,priceBasis:'unadjusted',...(i%5?{low:10,high:10}:{}),...(i===22?{chipPeak:10.5,chipSource:'原始申报'}:{})}));
  const k=bars[22],cut=k.knownAt;
  const frozen=chipHistory(bars,code,k.date,cut);
  assert.ok(frozen.length>1&&frozen[0].kind==='estimate');
  assert.equal(frozen.at(-1).kind,'raw');assert.equal(frozen.at(-1).source,'原始申报');assert.equal(frozen.at(-1).peak,10.5);
  assert.equal(frozen.at(-1).knownAt,cut);
  assert.ok(!chipHistory(bars,code,k.date,cut-1).some(c=>c.date===k.date));
  const future=[...bars,{...k,code:other,chipPeak:9000},{...k,period:'1m',chipPeak:8500},{...k,knownAt:start,chipPeak:.3}];
  assert.deepEqual(chipHistory(future,code,k.date,cut),frozen);
  const after=chipHistory([...bars,{...bars[20],close:8}],code,k.date,cut);
  assert.ok(!after.some(c=>c.kind==='estimate'&&c.date===bars[21].date));
});

test('个股炸板归因需要真实可见证据，不能代替六项情绪门禁',async()=>{
  const {emotion}=await import('../public/nova/shortline/market.mjs');
  const point=start;
  const row={code,status:'承接不足炸板',eventTime:day+' 10:15',knownAt:start-1,evidence:['连续两根分时未回封']};
  const r=emotion([{date:day,breakAttributions:{[code]:row,[other]:{...row,code:other,knownAt:start+1}}}],day,point);
  assert.equal(r.stage,'未判定');assert.ok(r.evidence.some(v=>v.includes(code)));assert.ok(!r.evidence.some(v=>v.includes(other)));
});

test('周末补采以最新闭市日核验资格，回执保留周末时间；明确历史时点不联网',async()=>{
  const weekend=start+2*86400000,set=fixtures({value:weekend});
  const before=await set.reader({code,day,asOf:start,recentClose:true});
  assert.equal(before.coverage.length,0);assert.equal(set.calls(),0);
  await set.reader({code,day});
  assert.equal(set.calls(),0);
  const after=await set.reader({code,day,recentClose:true});
  assert.equal(set.calls(),4);assert.ok(after.facts.every(r=>r.knownAt===weekend));
  const {pressureLearningTags,mergePressureHistory,addPressureRiskFacts}=await mod;
  const state={};mergePressureHistory(state,after);
  assert.deepEqual(pressureLearningTags(state,{date:day,code},start),[]);
  assert.equal(addPressureRiskFacts(after,code,start,new Map()).size,0);
  assert.ok(addPressureRiskFacts(after,code,weekend,new Map()).has('56:5'));
  const bad={...after,facts:after.facts.map(f=>({...f,eventDay:'2027-01-01',publishedAt:weekend+86400000}))};
  assert.equal(addPressureRiskFacts(bad,code,weekend,new Map()).size,0);
});
