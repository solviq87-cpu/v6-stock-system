const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createMarketBackfill,aguBook,thsBook,ladderChanges}=require('../src/research/shortline-market-backfill');

const days=['2026-11-16','2026-11-17','2026-11-18','2026-11-19'];
const previousTradeDay=d=>days[days.indexOf(d)-1];
const captured=Date.parse('2026-11-22T16:12:53+08:00');
const codes=['600001','600002','000003','000004'];
const theme=i=>i===3?'新能源':i===2?'农业':'芯片';
const thsData=day=>({status_code:0,data:{date:day.replaceAll('-',''),page:{page:1,count:1,limit:100,total:4},info:codes.map((code,i)=>({
  code,reason_type:theme(i),last_limit_up_time:String(Date.parse(day+'T13:02:12+08:00')/1000),high_days:i<2?'3天3板':'首板'
})),limit_up_count:{today:{num:4,open_num:2,history_num:6}},limit_down_count:{today:{num:0,open_num:1,history_num:1}}}});
const ths=d=>thsBook([thsData(d)],d);
const ledger=(d)=>({tradeDate:d,changes:new Map(codes.map((code,i)=>[code,[10,-8,-3,1][i]])),source:'逐股收盘复核',sourceUrl:'https://www.dabanke.com/',sourceUpdatedAt:Date.parse(d+'T15:40:00+08:00')});
const off=async()=>null;
const configure=(clock,providers)=>createMarketBackfill({clock,previousTradeDay,providers:{ths,agu:off,ladder:ledger,east:off,...providers}});

test('已收盘三日完整收益按上一交易日实名单计算；晚补证据仅供随后可知的复盘',async()=>{
  const calls={};const load=configure(()=>captured,{ths:async d=>{calls[d]=(calls[d]||0)+1;return ths(d);}});
  const [x,y]=await Promise.all([load({day:days[3]}),load({day:days[3]})]);
  assert.deepEqual(x,y);assert.deepEqual(Object.values(calls),[1,1,1,1]);
  assert.deepEqual(x.rows.map(r=>r.date),days.slice(1));assert.deepEqual(x.missing,[]);
  for(const r of x.rows){
    assert.deepEqual([r.upLimit,r.downLimit,r.breakRate,r.height,r.leader,r.diffusion,r.premium,r.firstBoardPremium],[4,0,33.33,3,1,50,0,-1]);
    assert.deepEqual(r.fieldSources.leader.codes,codes.slice(0,2));assert.equal(r.fieldSources.leader.previousDay,previousTradeDay(r.date));
    assert.ok(r.fieldSources.leader.sources.every(s=>s.tradeDate<=r.date&&s.receivedAt===captured));
    assert.equal(r.knownAt,captured);assert.equal(r.availableAt,'2026-11-22 16:12');
  }
  const {marketAsOf}=await import('../public/nova/shortline/market.mjs');
  assert.equal(marketAsOf({market:x.rows},days[3],days[3]+' 15:10').length,0);
  assert.equal(marketAsOf({market:x.rows},days[3],captured).length,3);
});

test('历史错日期、截断、缺个股、未知题材和含停牌的同期资产不得补为零',async()=>{
  const load=configure(()=>captured,{
    ths:async d=>{const data=thsData(d);data.data.info[2].reason_type='其他';return thsBook([data],d);},
    east:async()=>({...ledger(days[0]),source:'错误交易日'}),
    ladder:async d=>{const packet=ledger(d);packet.changes.delete(codes[1]);return packet;}
  });
  const x=await load({day:days[3],review:{day:days[3],sealed:{tradeDate:days[3],complete:true,totalCount:9,records:[{symbol:'600099'}]}}});
  for(const r of x.rows){assert.equal(r.upLimit,4);assert.equal(r.firstBoardPremium,-1);for(const k of ['leader','diffusion','premium'])assert.equal(Object.hasOwn(r,k),false);}
  const before=configure(()=>Date.parse(days[3]+'T14:59:00+08:00'),{ths:()=>{throw Error('不应采集当天');}});
  assert.deepEqual((await before({day:days[3]})).rows,[]);
});

test('失败后节流补采、已有版本在暂时中断时继续可读、相同答复保留首次时间',async()=>{
  let now=captured,mode='offline',calls=0;
  const load=configure(()=>now,{ths:async d=>{calls++;return mode==='online'?ths(d):null;}});
  assert.equal((await load({day:days[3]})).rows.length,0);
  mode='online';await load({day:days[3]});assert.equal(calls,4);
  now+=181000;const recovered=await load({day:days[3]});assert.equal(recovered.rows.length,3);
  const firstAt=recovered.rows[0].fieldSources.upLimit.knownAt;
  now+=3601000;const fresh=await load({day:days[3]});assert.equal(fresh.rows[0].fieldSources.upLimit.knownAt,firstAt);
  now+=3601000;mode='offline';const retained=await load({day:days[3]});assert.equal(retained.rows[0].fieldSources.upLimit.knownAt,firstAt);
});

test('供应商原始字段、分页、日期与梯队明细独立校验，个别停牌无涨跌幅',()=>{
  const d=days[3],v=thsData(d);
  assert.ok(thsBook([v],d));assert.equal(thsBook([v],days[2]),undefined);
  v.data.page.total=5;assert.equal(thsBook([v],d),undefined);v.data.page.total=4;v.data.info[0].last_limit_up_time=v.data.info[0].last_limit_up_time-86400;assert.equal(thsBook([v],d),undefined);
  const stocks=codes.slice(0,2).map((code,i)=>'<div class="stock-line status-failed" data-symbol="'+code+'.SH"><a href="/gupiao-'+code+'.html?review_date='+d+'"></a><span class="stock-change '+(i?'is-suspended':'text-rise')+'">'+(i?'—':'+4.07%')+'</span></div>').join('');
  const html='<h3>'+d+' 连板梯队</h3>最后更新时间： '+d+' 15:35:12<section class="ladder-view-tier" id="tier-1"><h3>3进4</h3>'+stocks+'</section>';
  assert.deepEqual([...ladderChanges(html,d,captured).changes],[[codes[0],4.07]]);
  assert.equal(ladderChanges(html,days[2],captured),undefined);
  assert.equal(ladderChanges(html,d,Date.parse(d+'T15:20:00+08:00')),undefined);
  const agu='<h1>2026年11月19日（周四） A股收盘复盘</h1><p class="source">统计日期 '+d+' 收盘，最近更新 2026-11-20 08:00（北京时间）</p><h2>涨停、炸板与跌停</h2>涨停 2 只，炸板 0 只，跌停 0 只<h2>连板梯队</h2>2板：1 只 1板：1 只 连板股：甲（600001.SH，4天3板）<h2>涨停个股</h2><table><thead><th>名称</th><th>代码</th><th>连板</th><th>首次封板</th><th>开板次数</th><th>题材</th><th>成交额</th></thead>'+codes.slice(0,2).map((c,i)=>'<tr>'+['甲',c+'.SH',i?'1天1板':'4天3板','09:25:00','0','芯片','1亿'].map(s=>'<td>'+s+'</td>').join('')+'</tr>').join('')+'</table><h2>跌停个股</h2><h2>炸板个股</h2>';
  assert.deepEqual(aguBook(agu,d,captured).sealed.records.map(r=>r.consecutiveLimits),[2,1]);
  assert.equal(aguBook(agu,d,Date.parse(d+'T15:50:00+08:00')),undefined);
  assert.equal(aguBook(agu.replace('涨停 2 只','涨停 3 只'),d,captured),undefined);
});

test('备用原交易日选择拒绝冲突前日，不能将上周旧名单算作昨日',async()=>{
  const load=configure(()=>captured,{agu:async d=>({...ths(d),previousDay:'2026-10-08'})});
  const x=await load({day:days[3]});assert.ok(x.rows.every(r=>r.upLimit===4&&!Object.hasOwn(r,'premium')&&!Object.hasOwn(r,'leader')));
});
