// The catalog's numeric IDs are durable archive keys. Wire aliases never renumber them.
export const dictionaryVersion='v6-20261122-2';
const groups={
  TL:['龙头溢价差','梯队断层','新老题材资金分流','支线独立催化','题材发酵时长'],
  ZJ:['日内资金回流','筹码承接换手','日内大单背离','短线资金沉淀','高标资金虹吸'],
  JP:['竞价抢筹持续性','竞价封单衰减','开盘兑现度','竞价一致性离散'],
  GG:['股东减持进度','监管问询回复','业绩预告修正','股权质押变动','解禁边际'],
  LX:['分时均价支撑','量能跟随','成交额占流通盘','尾盘资金抢筹','尾盘砸盘'],
  QX:['高标负反馈传导','试错标的存活率','溢价修复','轮动冷却','高标容错衰减'],
  ZS:['指数领先滞后','北向资金同向','指数分时背离']
};
const meanings={
  TL:['同期龙头相对同题材可比标的的已观测溢价差。','按同一收盘池连续板数检查缺失层级。','对比同口径新老题材已观测的资金或成交占比变化。','只记录归属明确、带公布时点的分支自身事件。','从可核验的题材启动日按交易日累计。'],
  ZJ:['按同一标的和时段，观察有方向的资金由流出转为流入。','用实际换手、成交和价格承接描述筹码交换。','分别记录同步的大额成交方向与价格走势差异。','比较多个已结束时段的可追溯资金留存情况。','对比同口径高标与板块其他标的资金集中程度。'],
  JP:['跟踪同一次集合竞价多个时点的可核实抢筹指标。','比较同价可核封单数量在连续竞价快照中的减少。','用首笔已成交价格与开盘后可见成交描述兑现幅度。','比较同板块多个成员同一竞价时点强度的分散程度。'],
  GG:['区分已公告计划与实际发生的持股变动，保留数量和时点。','关联原问询、回复或监管文件，各自保留披露时间和材料状态。','比较同一报告期间首次预告与后续已披露修正。','比较同一股东已披露的质押变动及解除情况。','引用已披露的限售流通日期、股份数量及变化，注明数据口径。'],
  LX:['比较已成交分时价格、成交均价及回踩后的实际承接。','核对价格变动时同期成交量是否延续。','同一时点以成交额除以可核的流通市值。','在明确尾盘窗口内观察实际成交和同口径买方流量。','在明确尾盘窗口内观察价格下行、成交和卖方流量。'],
  QX:['跟踪前一已知高标群与随后实际发生的负反馈。','按冻结试错标的集合，观察到期后仍满足预定条件的比例。','比较连续可见的历史溢价变化幅度。','衡量已观察到的热门题材轮动降温所经历的交易日。','在相同情绪环境内统计已成熟高标样本的修复或失败情况。'],
  ZS:['比较按原始时间对齐的指数与标的变化先后。','只在有对应日期和明确口径时记录北向资金与价格方向。','在相同分时窗口核对指数与个股或题材的方向差异。']
};
const explain={TL:'题材梯队',ZJ:'资金行为',JP:'竞价盘口',GG:'公告与基本面',LX:'分时流动性',QX:'情绪周期',ZS:'指数联动',YZ:'原有规则'};
const serial=(prefix,n)=>prefix+'-'+String(n).padStart(2,'0');
const maps=new WeakMap();
export function factorDictionary(catalog){
  if(!Array.isArray(catalog))throw Error('因子词典需要版本对应的规则目录');
  if(maps.has(catalog))return maps.get(catalog);
  const entries=[...Object.entries(groups).flatMap(([prefix,names])=>names.map((name,i)=>({code:serial(prefix,i+1),name:name+'因子',group:explain[prefix],meaning:meanings[prefix][i]}))),
    ...catalog.map(c=>({code:serial('YZ',c.id),name:c.name,group:explain.YZ,meaning:'按目录的下列原始条件分别检查。',conditions:c.factors||[]}))];
  const byCode=new Map(entries.map(e=>[e.code,e])),byName=new Map(entries.map(e=>[e.name,e.code]));
  const dict={version:dictionaryVersion,entries,byCode,byName};maps.set(catalog,dict);return dict;
}
// A rule matched in full is distinct from individual conditions observed under it.
// The latter travel as 1-based ordinals alongside the group code, never as full matches.
export function compactCheck(check,catalog){
  const dict=factorDictionary(catalog),conditions=new Map();
  const matched=new Set([...(check.matches||[]),...(check.riskGroups||[])].map(n=>dict.byName.get(n)).filter(Boolean));
  for(const id of check.selected||check.capture?.selected||[]){
    const m=/^(\d+):(\d+)$/.exec(id);if(!m)continue;
    const code=serial('YZ',+m[1]),item=dict.byCode.get(code),index=+m[2];
    if(!item||index>=item.conditions.length)continue;
    if(!conditions.has(code))conditions.set(code,new Set());
    conditions.get(code).add(index+1);
  }
  const observed=(check.factorCodes||[]).filter(c=>dict.byCode.has(c)&&!c.startsWith('YZ-'));
  return {date:check.date,stock:check.code,matched:[...matched].sort(),conditions:Object.fromEntries(
    [...conditions].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,[...v].sort((a,b)=>a-b)])),observed:[...new Set(observed)].sort()};
}
const point=x=>typeof x==='number'?x:typeof x==='string'?Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(x)?x:x.replace(' ','T')+(x.length===10?'T15:00:00':'')+'+08:00'):NaN;
export function factorPacket(state,asOf=Date.now()){
  const valid=(state.checks||[]).filter(c=>typeof c?.code==='string'&&/^\d{6}$/.test(c.code)&&/^\d{4}-\d{2}-\d{2}$/.test(c.date)&&Number.isFinite(Date.parse(c.date))&&new Date(c.date).toISOString().slice(0,10)===c.date&&Number.isFinite(Date.parse(c.createdAt))&&Date.parse(c.createdAt)<=asOf&&
    Date.parse(c.date+'T00:00:00+08:00')<=asOf&&[c.asOf,c.knownAt,c.observedAt].filter(x=>x!=null).every(x=>point(x)<=asOf));
  return {dictionary:dictionaryVersion,scope:state.scope||'live',asOf:new Date(asOf).toISOString(),
    records:valid.slice(-100).map(c=>compactCheck(c,state.catalog||[]))};
}
