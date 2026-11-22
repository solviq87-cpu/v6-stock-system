// Optional CSV measurements. Percentage fields use percentage points, currency
// fields use CNY, and time fields represent the original observation clock.
export const riskNumericFields=[
  'bid1','ask1','debtToAssetsPct','cashToShortDebtPct','pledgedSharesPct',
  'goodwillToNetAssetsPct','marginBalanceToFloatPct','top10FloatHolderPct',
  'sectorAdvancingCount','sectorObservedCount','sectorTotalCount'
];
export const riskTextFields=[
  'tradingStatus','quoteSource','quoteAt','quoteReceivedAt','issuerIndustry',
  'fundamentalSource','fundamentalPublishedAt','fundamentalKnownAt','financialPeriodEnd',
  'sectorRole','sectorBreadthSource','sectorBreadthAt','sectorBreadthReceivedAt'
];

const finite=Number.isFinite;
const validCode=s=>typeof s==='string'&&/^\d{6}$/.test(s);
const positive=n=>finite(n)&&n>0;
const fraction=n=>finite(n)&&n>=0&&n<=100;
const nonnegative=n=>finite(n)&&n>=0;
const known=s=>typeof s==='string'&&s.trim().length>0&&!['缺失','未知','未判定'].includes(s);
const fmt=n=>finite(n)?String(+n.toFixed(2)):'缺失';
const dayOf=s=>String(s||'').slice(0,10);
function time(x) {
  if(Number.isSafeInteger(x)&&x>0)return x;
  if(typeof x!=='string')return NaN;
  const s=x.replace(' ','T');
  if(/^\d{4}-\d{2}-\d{2}$/.test(s))return Date.parse(s+'T15:00:00+08:00');
  if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(s))return Date.parse(s+'+08:00');
  return /(?:Z|[+-]\d\d:\d\d)$/.test(s)?Date.parse(s):NaN;
}
const cnDay=t=>new Date(t+8*3600000).toISOString().slice(0,10);
function visible(row,cutoff){
  if(!row||!known(row.date)||!finite(time(row.date))||time(row.date)>cutoff)return false;
  return [row.knownAt,row.availableAt].filter(v=>v!=null).every(v=>finite(time(v))&&time(v)<=cutoff);
}
function seen(source,observed,received,cutoff){
  const o=time(observed),r=time(received);
  return known(source)&&finite(o)&&finite(r)&&r>=o&&r<=cutoff;
}
const sameSymbol=(b,r)=>r?.code===b.code&&(!r.role||r.role==='stock');
function precedingDay(row){
  if(/^\d{4}-\d{2}-\d{2}$/.test(row.previousDay||''))return row.previousDay;
  const d=new Date(row.date+'T12:00:00Z');
  do{d.setUTCDate(d.getUTCDate()-1);}while([0,6].includes(d.getUTCDay()));
  return d.toISOString().slice(0,10);
}
const locked=b=>positive(b?.limitUp)&&b.high===b.limitUp&&b.low===b.limitUp&&b.close===b.limitUp;
const sealed=b=>positive(b?.limitUp)&&b.close===b.limitUp;

function priceRisks(b,h,f,m,sector,stage,add){
  const prev=h.at(-1),older=h.at(-2);
  const highMark=Number.isInteger(prev?.streak)&&prev.streak>=3;
  const stalled=finite(f.change)&&Math.abs(f.change)<=1;
  const declining=prev&&older&&[older.volume,prev.volume,b.volume].every(positive)&&older.volume>prev.volume&&prev.volume>b.volume;
  const accelerating=declining&&sealed(older)&&sealed(prev)&&sealed(b)&&Number.isInteger(b.streak)&&b.streak>=3;
  if(highMark&&finite(f.ratio)&&finite(f.change)){
    add('11:0',f.ratio>=1.5&&stalled,'昨日 '+prev.streak+' 连板，今日量比 '+fmt(f.ratio)+'，收盘涨幅 '+fmt(f.change)+'%（量比≥1.5且涨跌幅在±1%）');
  }
  if(highMark&&finite(b.auctionGap)){
    add('30:0',b.auctionGap<=-5,'昨日 '+prev.streak+' 连板，竞价涨幅 '+fmt(b.auctionGap)+'%（≤−5%）');
    if(b.auctionGap<=-5&&declining)add('30:3',true,'高标显著低开且连续三日成交量递减');
  }
  if(highMark&&stalled&&older&&[older.amount,prev.amount,b.amount].every(positive)){
    const shrinking=older.amount>prev.amount&&prev.amount>b.amount&&b.amount<=older.amount*.75;
    add('11:3',shrinking,'高标滞涨，近三日成交额 '+[older.amount,prev.amount,b.amount].map(n=>fmt(n/1e8)).join(' / ')+' 亿元（两日累计收缩≥25%）');
  }
  if(accelerating){
    add('40:0',true,'连续三次封板且三日成交量递减，当前 '+b.streak+' 连板');
    if(fraction(b.turnover))add('20:2',b.turnover<=1,'连续缩量板日换手 '+fmt(b.turnover)+'%（≤1%）');
    if(fraction(b.sealRatio))add('40:2',b.sealRatio<=1,'连续缩量板的收盘封单占当日成交额 '+fmt(b.sealRatio)+'%（≤1%）');
    if(Number.isSafeInteger(b.sectorAssists)&&Number.isSafeInteger(prev.sectorAssists)&&prev.sectorAssists>=2&&b.sector===prev.sector&&known(b.sector)){
      add('40:1',b.sectorAssists<prev.sectorAssists,'同题材封板助攻由 '+prev.sectorAssists+' 减至 '+b.sectorAssists+' 只');
      add('20:1',b.sectorAssists===0,'连续缩量高板的题材封板助攻由 '+prev.sectorAssists+' 只降至 '+b.sectorAssists+' 只');
    }
    if(['分歧','退潮'].includes(stage)&&fraction(m.breakRate)&&m.breakRate>=40){
      add('20:3 40:3',true,'个股已连续缩量封板；市场阶段 '+stage+'，炸板率 '+fmt(m.breakRate)+'%');
    }
  }
  if(locked(prev)&&positive(b.limitUp)&&finite(f.change)&&finite(f.ratio)&&finite(b.low)&&finite(b.close)){
    add('46:3',b.low<b.limitUp&&b.close<b.limitUp&&f.ratio>=2&&f.change<=-4,
      '前日一字涨停，今日量比 '+fmt(f.ratio)+'、收盘涨跌 '+fmt(f.change)+'%，以开板放量、跌幅≥4%核对');
  }
  const lead=f.sectorLeader??b.sectorLeader;
  if(b.sectorRole==='跟风'&&known(b.sector)&&known(lead)&&lead!==b.code&&lead!==b.name){
    if(f.position==='高位'&&finite(f.ratio))add('37:1',f.ratio>=1.5,'同题材跟风标的 '+b.code+' 处于20日区间高位，量比 '+fmt(f.ratio));
    const leaderRows=(sector.memberQuotes||[]).filter(q=>(q.code===lead||q.name===lead)&&q.code!==b.code&&q.date===b.date&&q.sector===b.sector);
    if(leaderRows.length===1&&finite(leaderRows[0].change)&&finite(leaderRows[0].ratio)&&f.position==='高位'&&finite(f.ratio)&&f.ratio>=1.5){
      const leader=leaderRows[0];add('37:0',Math.abs(leader.change)<=1&&leader.ratio>=1.5,'同题材龙头 '+leader.code+' 涨幅 '+fmt(leader.change)+'%、量比 '+fmt(leader.ratio)+'，跟风票高位放量');
    }
  }
}

function executionRisks(b,cutoff,sector,stage,add){
  const plan=b.frozenPlan,freeze=time(plan?.frozenAt);
  const planKnown=plan?.code===b.code&&finite(freeze)&&freeze<=cutoff;
  const holding=b.holdingSnapshot;
  const holds=holding?.code===b.code&&positive(holding.shares)&&positive(holding.avgCost)&&
    seen(holding.source,holding.observedAt,holding.knownAt,cutoff)&&cnDay(time(holding.observedAt))===dayOf(b.date);
  if(holds&&positive(b.close)){
    const gain=b.close>holding.avgCost;
    add('64:0',gain,'持仓成本 '+fmt(holding.avgCost)+' 元、现价 '+fmt(b.close)+' 元，原始持仓时点 '+holding.observedAt);
    if(gain&&finite(sector.change))add('64:2',sector.change<=-2,'持仓仍有浮盈，所属板块当日涨跌 '+fmt(sector.change)+'%（≤−2%）');
    if(planKnown&&positive(plan.stopPrice)){
      add('52:0',b.close<=plan.stopPrice,'持仓收盘 '+fmt(b.close)+' 元，冻结止损价 '+fmt(plan.stopPrice)+' 元');
      if(positive(plan.supportPrice))add('52:1',b.close<plan.supportPrice,'持仓收盘 '+fmt(b.close)+' 元，冻结结构支撑 '+fmt(plan.supportPrice)+' 元');
    }
    if(planKnown&&positive(plan.targetPrice)&&gain)add('53:1',b.close>=plan.targetPrice,'持仓收盘 '+fmt(b.close)+' 元，事前目标价 '+fmt(plan.targetPrice)+' 元');
    if(gain&&stage==='分歧'&&finite(sector.change)&&sector.change<=-3)add('53:2',true,'持仓浮盈，情绪分歧且板块下跌 '+fmt(-sector.change)+'%');
  }
  // Motivation is only admissible as the trader's own time-stamped statement
  // linked to this specific decision. No price-series inference supplies intent.
  const record=b.traderRecord;
  if(record?.code===b.code&&record.source==='本人交易日志'&&known(record.decisionId)&&
      seen(record.source,record.decisionAt,record.recordedAt,cutoff)&&cnDay(time(record.decisionAt))===dayOf(b.date)){
    const keys={'报复性交易':'55:2','亏损后急于回本':'55:3','凭感觉':'59:1','听消息':'59:2',
      '跟风别人标的':'59:3','提前埋伏赌消息':'70:0','赌回流':'70:1','赌修复':'70:2'};
    const key=Object.hasOwn(keys,record.motive)?keys[record.motive]:null;
    if(key)add(key,true,'本人交易日志 '+record.decisionId+' 明确记录「'+record.motive+'」，登记 '+record.recordedAt);
  }
}

function balanceSheetRisks(b,cutoff,add){
  if(!seen(b.fundamentalSource,b.fundamentalPublishedAt,b.fundamentalKnownAt,cutoff))return;
  const published=time(b.fundamentalPublishedAt),period=time(b.financialPeriodEnd);
  if(!finite(period)||period>published||cutoff-period>400*86400000)return;
  const where='；'+b.fundamentalSource+'，数据期末 '+b.financialPeriodEnd+'，可知 '+b.fundamentalKnownAt;
  if(nonnegative(b.goodwillToNetAssetsPct))add('56:5',b.goodwillToNetAssetsPct>=30,'商誉占净资产 '+fmt(b.goodwillToNetAssetsPct)+'%（≥30%）'+where);
  if(fraction(b.pledgedSharesPct))add('69:1',b.pledgedSharesPct>=50,'全公司质押股份占总股本 '+fmt(b.pledgedSharesPct)+'%（≥50%）'+where);
  if(nonnegative(b.marginBalanceToFloatPct)&&cutoff-period<=10*86400000)add('69:0',b.marginBalanceToFloatPct>=15,
    '融资余额占流通市值 '+fmt(b.marginBalanceToFloatPct)+'%（≥15%，十日内数据）'+where);
  if(known(b.issuerIndustry)&&!/银行|保险|证券|金融|信托/.test(b.issuerIndustry)&&nonnegative(b.debtToAssetsPct)&&nonnegative(b.cashToShortDebtPct)){
    add('69:2',b.debtToAssetsPct>=80&&b.cashToShortDebtPct<=50,'非金融企业 '+b.issuerIndustry+' 的资产负债率 '+fmt(b.debtToAssetsPct)+'%、现金短债比 '+fmt(b.cashToShortDebtPct)+'%（≥80%且≤50%）'+where);
  }
  if(fraction(b.top10FloatHolderPct))add('65:2',b.top10FloatHolderPct>=80,'前十大流通股东合计占流通股 '+fmt(b.top10FloatHolderPct)+'%（≥80%）'+where);
}

function liquidityRisks(b,h,cutoff,add){
  if(b.tradingStatus==='停牌')add('57:1',true,'同日个股交易状态为停牌');
  if(positive(b.bid1)&&positive(b.ask1)&&b.ask1>=b.bid1&&seen(b.quoteSource,b.quoteAt,b.quoteReceivedAt,cutoff)&&
      cnDay(time(b.quoteAt))===dayOf(b.date)&&cutoff-time(b.quoteAt)<=180000){
    const spread=200*(b.ask1-b.bid1)/(b.ask1+b.bid1);
    add('57:1',spread>=1,'盘口买一 '+fmt(b.bid1)+'、卖一 '+fmt(b.ask1)+'，相对价差 '+fmt(spread)+'%（≥1%）；来源 '+b.quoteSource+' '+b.quoteAt);
  }
  const lastTen=h.slice(-9).concat(b);
  if(lastTen.length===10&&lastTen.every(r=>nonnegative(r.amount)&&fraction(r.turnover))){
    add('57:3',lastTen.every(r=>r.amount<1e7&&r.turnover<.5),'连续10个可见日成交额均低于1000万元且换手率均低于0.5%的检验');
  }
  if(known(b.sector)&&seen(b.sectorBreadthSource,b.sectorBreadthAt,b.sectorBreadthReceivedAt,cutoff)&&
      cnDay(time(b.sectorBreadthAt))===dayOf(b.date)&&Number.isSafeInteger(b.sectorTotalCount)&&b.sectorTotalCount>=10&&
      b.sectorTotalCount===b.sectorObservedCount&&Number.isInteger(b.sectorAdvancingCount)&&b.sectorAdvancingCount>=0&&b.sectorAdvancingCount<=b.sectorTotalCount){
    const lead=b.sectorLeader;
    if((lead===b.code||known(b.name)&&lead===b.name)&&finite(b.changePct)&&b.changePct>0){
      add('68:0 68:1',b.sectorAdvancingCount===1,'已核对 '+b.sector+' 全部 '+b.sectorTotalCount+' 只成分，当日上涨 '+b.sectorAdvancingCount+' 只，标的为上涨龙头；'+b.sectorBreadthSource);
    }
  }
}

function otherRisks(b,f,m,stage,series,minutes,cutoff,add){
  const day=dayOf(b.date);
  if(['严重异常波动','连续异常波动'].includes(b.regulationStatus))add('49:1 56:4',true,'个股同期监管状态明确记载为 '+b.regulationStatus);
  const notices=new Map();
  for(const a of b.announcements||[]){
    if((a.code??a.symbol)!==b.code||a.verified!==true||!known(a.source)||!known(a.title)||
       !seen(a.source,a.publishedAt,a.knownAt??a.receivedAt,cutoff)||
       !['股价异常波动公告','股票交易异常波动公告'].includes(a.type)||
       !known(a.eventId)||/更正|撤销|澄清|回复/.test(a.title))continue;
    const age=cutoff-time(a.publishedAt);
    if(age>=0&&age<=10*86400000)notices.set(a.eventId,cnDay(time(a.publishedAt)));
  }
  if(new Set(notices.values()).size>=3)add('49:1',true,'近10个自然日有至少3个不同披露日的已核对交易异常波动公告：'+[...notices.values()].sort().join('、'));
  const prev=series.filter(r=>r.date<day).at(-1);
  if(prev&&m.previousDay===prev.date&&known(b.sector)&&positive(b.limitDown)&&b.open===b.limitDown){
    const groups=(prev.themes||[]).filter(t=>t.name===b.sector);
    const g=groups.length===1?groups[0]:null;
    if(g?.count>=2&&g.members?.length===g.count&&new Set(g.members.map(r=>r.code)).size===g.count&&
        g.members.every(r=>validCode(r.code)&&Number.isInteger(r.level))){
      const first=g.members.filter(r=>r.level===1);
      const times=first.map(r=>String(r.firstSealTime||'').replace(/:/g,''));
      if(times.length>=2&&times.every(t=>/^\d{6}$/.test(t)&&t>='092500'&&t<='150000'&&+t.slice(2,4)<60&&+t.slice(4)<60)){
        const earliest=[...times].sort()[0],list=first.filter((r,i)=>times[i]===earliest);
        if(list.length===1&&list[0].code===b.code)add('30:1',true,'前一交易日同题材首板中最早封板 '+earliest+'，今日直接以跌停价 '+b.limitDown+' 开盘');
      }
    }
  }
  if(known(m.calendarSource)&&finite(time(m.calendarKnownAt))&&time(m.calendarKnownAt)<=cutoff&&
      /^\d{4}-\d{2}-\d{2}$/.test(m.nextTradingDay||'')){
    const gap=(time(m.nextTradingDay)-time(day))/86400000;
    if(gap>=1&&gap<=18)add('58:0',gap>=6,'已发布交易日历 '+m.calendarSource+' 的下一个交易日 '+m.nextTradingDay+'，间隔 '+gap+' 个自然日');
  }
  const plan=b.frozenPlan,freeze=time(plan?.frozenAt);
  if(plan?.code===b.code&&finite(freeze)&&freeze<=cutoff){
    if(['退潮','高潮','冰点'].includes(stage)&&known(plan.strategy)){
      if(stage==='退潮'&&['连板接力战法','放量加速战法'].includes(plan.strategy))
        add('67:0',true,'冻结战法 '+plan.strategy+' 与退潮环境错配');
      if(stage==='高潮'&&['分歧低吸战法','恐慌低吸战法','赛道趋势低吸战法'].includes(plan.strategy))
        add('67:1',true,'冻结战法 '+plan.strategy+' 与高潮环境错配');
      if(stage==='冰点'&&positive(plan.plannedPosition)&&plan.plannedPosition>5)
        add('67:2',true,'冰点期拟开仓 '+fmt(plan.plannedPosition)+'%，高于冰点单标的5%上限');
    }
    if((plan.overnight===true||dayOf(plan.holdUntil)>day)&&
       ['SPX','NDX','HSI'].includes(m.externalIndexSymbol)&&finite(m.externalIndexChangePct)&&
       seen(m.externalIndexSource,m.externalIndexAt,m.externalIndexReceivedAt,cutoff)&&cutoff-time(m.externalIndexAt)<=36*3600000){
      add('63:1',m.externalIndexChangePct<=-3,'冻结隔夜计划；'+m.externalIndexSymbol+' 最近36小时已收悉的指数涨跌 '+fmt(m.externalIndexChangePct)+'%（≤−3%）');
    }
  }
  // A continuous minute series is required. Gaps, lunch breaks and one-off
  // spikes cannot be counted as repeated plunges.
  const rows=minutes.filter(r=>sameSymbol(b,r)&&dayOf(r.date)===day&&r.date.length===16&&['1m','1min','1分钟','1分钟K','分钟K','分时'].includes(r.period)&&visible(r,cutoff)&&positive(r.close)&&positive(r.volume))
    .sort((x,y)=>x.date.localeCompare(y.date));
  let state=0;
  for(let i=1;i<rows.length;i++){
    if(time(rows[i].date)-time(rows[i-1].date)!==60000){state=0;continue;}
    const move=100*(rows[i].close/rows[i-1].close-1);
    if(state===2&&move<=-3){add('60:1',true,'逐分钟成交收盘出现两次至少3%急跌，中间出现至少2%反弹，第二次时刻 '+rows[i].date);break;}
    if(move<=-3)state=1;
    else if(state===1&&move>=2)state=2;
  }
}

export function addStockRiskEvidence({b,f={},market={},sector={},stage,history=[],marketSeries=[],intraday=[],asOf},facts){
  if(!b||!validCode(b.code)||b.date?.length!==10||!facts)return facts;
  const cutoff=time(asOf??b.decisionAt??b.date);
  if(!finite(cutoff)||!visible(b,cutoff))return facts;
  const day=dayOf(b.date), priorRows=history.filter(r=>sameSymbol(b,r)&&r.date.length===10&&r.date<day&&visible(r,cutoff)).sort((a,z)=>a.date.localeCompare(z.date));
  const hist=[];
  let target=precedingDay(b);
  for(let i=priorRows.length-1;i>=0&&priorRows[i].date===target;i--){
    hist.unshift(priorRows[i]);target=precedingDay(priorRows[i]);
  }
  const marketDay=market?.date===day&&visible(market,cutoff)?market:{};
  const sectorOK=!sector?.date||dayOf(sector.date)===day&&visible(sector,cutoff);
  const sectorDay=sectorOK?{...sector,memberQuotes:(sector.memberQuotes||[]).filter(q=>visible(q,cutoff))}:{};
  function add(keys,pass,source){
    for(const key of keys.split(' ')){
      // An independent, verified adverse observation takes priority; preserve
      // earlier source evidence if it already confirms the same trigger.
      if(!facts.has(key)||pass&&!facts.get(key).pass)facts.set(key,{pass,source});
    }
  }
  priceRisks(b,hist,f,marketDay,sectorDay,stage,add);
  liquidityRisks({...b,changePct:f.change??b.changePct,sectorLeader:f.sectorLeader??b.sectorLeader},hist,cutoff,add);
  balanceSheetRisks(b,cutoff,add);
  executionRisks(b,cutoff,sectorDay,stage,add);
  const knownMarkets=marketSeries.filter(r=>visible(r,cutoff)&&r.date<=day).sort((a,z)=>a.date.localeCompare(z.date));
  otherRisks(b,f,marketDay,stage,knownMarkets,intraday,cutoff,add);
  const marketDays=knownMarkets.slice(-3);
  if(marketDays.length===3&&marketDays.every((r,i)=>i===0||marketDays[i-1].date===precedingDay(r))&&marketDays.at(-1).date===day&&
      marketDays.every(r=>finite(r.indexChange))&&marketDay.volume==='放量下跌'){
    add('62:0',marketDays.every(r=>r.indexChange<0)&&marketDays.at(-1).indexChange<=-2,
      '全A近三日涨跌 '+marketDays.map(r=>fmt(r.indexChange)+'%').join(' / ')+'，当日放量下跌（当日≤−2%）');
  }
  // Do not count multiple wordings of the same dated disclosure twice.
  const groups=[
    ['减持',['56:0']],['立案或监管',['49:0','49:2','56:1','56:2','56:4']],
    ['盈利或偿债',['56:3','69:2']],['高位缩量',['20:0','40:0']],['流动性',['57:0','57:1','57:3']]
  ];
  const hits=groups.filter(([,keys])=>keys.some(key=>facts.get(key)?.pass===true));
  if(hits.length>=2)add('61:0',true,'独立负面证据叠加：'+hits.map(([label,keys])=>label+'（'+facts.get(keys.find(k=>facts.get(k)?.pass)).source+'）').join('；'));
  return facts;
}
