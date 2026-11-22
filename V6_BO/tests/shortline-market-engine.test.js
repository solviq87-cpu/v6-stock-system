const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {emotion, marketAsOf, normalizeMarket, validate}=require('../public/nova/shortline/market.mjs');

const catalog=JSON.parse(readFileSync(new URL('../public/nova/shortline/catalog.json',require('node:url').pathToFileURL(__filename).href),'utf8'));
const dates=['2025-01-06','2025-01-07','2025-01-08'];
const date=dates[2];
function series(rows){
  return rows.map(([upLimit,downLimit,breakRate,height,leader,diffusion],i)=>({
    date:dates[i],upLimit,downLimit,breakRate,height,leader,diffusion,
    trend:'多头',sh:'多头',cy:'多头'
  }));
}
const patterns={
  冰点:[[36,18,32,5,0,45],[25,27,39,4,-2,30],[16,40,50,2,-5,18]],
  发酵:[[30,22,39,3,-1,35],[40,16,32,4,.5,45],[55,10,26,5,2,58]],
  高潮:[[45,16,35,4,1,50],[62,9,26,5,2,64],[80,5,18,7,3,78]],
  分歧:[[36,13,26,4,1,43],[53,9,21,5,3,63],[44,15,32,5,1,51]],
  退潮:[[69,7,18,6,3,75],[55,12,27,5,1,59],[42,18,34,4,-1,42]]
};
const state=(market=series(patterns.发酵))=>({catalog,market,marketHistory:[],trades:[],bars:[]});
const keys=id=>catalog.find(r=>r.id===id).factors.map((_,i)=>id+':'+i);
const payload=(id=1,extra={})=>({name:'样本标的',code:'000001',date,selected:keys(id),...extra});
const check=(s,input)=>validate(s,input,{skipPrediction:true});

for(const [stage,values] of Object.entries(patterns)){
  test('多日证据确认'+stage,()=>{
    const result=emotion(series(values),date);
    assert.equal(result.stage,stage);
    assert.ok(result.confidence>0&&result.confidence<=100);
    assert.equal(result.missing.length,0);
    for(const label of ['涨停家数','跌停家数','炸板率','连板高度','高标平均反馈','题材扩散度']){
      assert.ok(result.evidence.some(x=>x.startsWith(label)));
    }
  });
}
test('缺少交易日、观测缺失与完整但不一致的证据均保持未判定',()=>{
  const days=series(patterns.发酵);
  const short=emotion(days.slice(1),date);
  assert.equal(short.stage,'未判定');assert.equal(short.confidence,0);
  assert.ok(short.missing.some(x=>x.includes('3个交易日')));
  for(const missingValue of [undefined,'',null,Infinity]){
    const broken=days.map((r,i)=>i===1?{...r,leader:missingValue}:r);
    const phase=emotion(broken,date);
    assert.equal(phase.stage,'未判定');
    assert.deepEqual(phase.missing,[dates[1]+' 高标平均反馈']);
    assert.equal(check(state(broken),payload()).position,0);
  }
  const daysFlat=series(Array.from({length:3},()=>[40,12,28,4,0,45]));
  const inconclusive=emotion(daysFlat,date);
  assert.equal(inconclusive.stage,'未判定');
  assert.equal(inconclusive.missing.length,0);
  assert.equal(inconclusive.confidence,0);
});
test('历史信号保持原时点版本；隔日修订和未来交易日仅在可见时使用',()=>{
  const s=state();
  const before=check(s,payload());
  const original=s.market.at(-1);
  const correction={...original,availableAt:'2025-01-09 10:15',volume:'放量下跌',upLimit:10};
  s.marketHistory.push(original);
  s.market=[...s.market.slice(0,-1),correction,{...original,date:'2025-01-10'}];
  assert.deepEqual(check(s,payload()),before);
  assert.equal(marketAsOf(s,date,date+' 14:59').length,2);
  assert.equal(marketAsOf(s,'2025-01-09','2025-01-09 10:14').at(-1),original);
  assert.equal(marketAsOf(s,'2025-01-09','2025-01-09 10:15').at(-1),correction);
  s.marketHistory=[];
  const hidden=check(s,payload());
  assert.equal(hidden.market,null);assert.equal(hidden.position,0);
  assert.equal(hidden.emotion.stage,'未判定');
});
test('完整正向匹配须通过硬否决，点击环境利好不能恢复仓位',()=>{
  const s=state();
  assert.equal(check(s,payload()).position,20);
  assert.equal(check(s,payload(1,{selected:keys(1).slice(1)})).matches.length,0);
  for(const trigger of ['49:0','55:0','56:2','57:1','59:1','61:0','67:0','70:3','72:0','85:0']){
    const result=check(s,payload(1,{selected:[...keys(1),trigger,...keys(84)]}));
    assert.deepEqual(result.matches,['龙头战法']);
    assert.equal(result.position,0,trigger);
    assert.equal(result.status,'暂缓开仓',trigger);
    assert.ok(result.risks.length);
  }
  s.market.at(-1).volume='放量下跌';
  assert.equal(check(s,payload()).position,0);
});
test('周期约束覆盖主观勾选；指数与赛道约束仅放行适配组合',()=>{
  const tide=state(series(patterns.退潮)),climax=state(series(patterns.高潮));
  assert.equal(check(tide,payload(6)).position,0);
  assert.equal(check(tide,payload(15)).position,5);
  assert.equal(check(climax,payload(33)).position,0);
  const split=state(series(patterns.分歧));
  split.market.at(-1).trend='震荡';
  assert.equal(check(split,payload(5)).position,10);
  assert.equal(check(split,payload(6)).position,0);
  const mixed=state();mixed.market.at(-1).cy='空头';
  assert.equal(check(mixed,payload(15)).position,0);
  assert.ok(check(mixed,payload(15,{strongSector:true})).position>0);
  const decline=state();decline.market.forEach(day=>{day.indexChange=-1});
  assert.equal(check(decline,payload(6)).position,0);
});
test('新增仓位取单标的、同题材、组合与周期剩余额度的最小值',()=>{
  const s=state();
  assert.equal(check(s,payload(15,{singleCap:15,stockHeld:13,themeHeld:20,totalHeld:30})).position,2);
  assert.equal(check(s,payload(15,{themeCap:15,themeHeld:14,totalHeld:30})).position,1);
  assert.equal(check(s,payload(15,{totalCap:30,totalHeld:30})).position,0);
  assert.equal(check(state(series(patterns.退潮)),payload(15,{totalHeld:14})).position,1);
  assert.throws(()=>check(s,payload(15,{stockHeld:11,themeHeld:5,totalHeld:30})),/已有仓位/);
  assert.throws(()=>check(s,payload(15,{totalCap:101})),/仓位/);
});
test('交易记录以离场时点计算当日连亏和连续亏损交易日',()=>{
  const s=state(),t=(date,time,pnl)=>({exitTime:date+'T'+time,pnl,pnlAmount:pnl*100});
  s.trades=[t(dates[1],'10:30',-1),t(date,'09:45',-2),t(date,'16:00',-3)];
  assert.equal(check(s,payload()).position,5);
  s.trades.push({...t(date,'10:15',-1),createdAt:'2025-01-09T00:00:00Z'});
  assert.equal(check(s,payload()).position,5);
  s.trades.push(t(date,'14:00',-2),t(date,'14:30',10));
  assert.equal(check(s,payload()).position,0);
});
test('空值不冒充零，非法日期、不合法数值和未知因子不能写入',()=>{
  const day=normalizeMarket({date,upLimit:'',downLimit:0});
  assert.equal(day.upLimit,null);assert.equal(day.downLimit,0);
  assert.throws(()=>normalizeMarket({date:'2025-02-30'}));
  assert.throws(()=>normalizeMarket({date,breakRate:101}));
  assert.throws(()=>normalizeMarket({date,upLimit:3.14}));
  assert.throws(()=>check(state(),payload(1,{selected:['999:0']})));
  assert.throws(()=>check(state(),payload(1,{code:'00001'})));
});
