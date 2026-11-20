export type Cap = '空仓' | '轻仓' | '半仓'
export type Phase = '冰点' | '退潮' | '回暖' | '主升' | '高潮'
export const disclaimer = '演示数据，不构成投资建议。'
export const demoMarket = {
  limits: 46, yesterdayLimits: 38, turnover: 8500, height: 4, leaderDrop: false,
  brokenPct: 17, sectorRank: 2, index: 3100, indexLow: 3050, previousLow: 3040,
  indexMA20: 3080, indexChange: 0.5, previousPhase: '回暖' as Phase,
  turnover20: Array.from({length:20}, (_,i)=>7000+100*i),
  limits20: Array.from({length:20}, (_,i)=>30+i)
}
export type Market = typeof demoMarket
function quantile(values:number[], p:number) {
  return [...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]
}
export function marketPhase(m:Market):Phase {
  if (m.leaderDrop && m.brokenPct>25) return '退潮'
  if (m.limits<25 || m.turnover<=quantile(m.turnover20,.2)) return '冰点'
  if (m.height>=5 && m.limits>=quantile(m.limits20,.8)) return '高潮'
  if (['退潮','冰点'].includes(m.previousPhase) && m.limits>m.yesterdayLimits && m.indexLow>=m.previousLow) return '回暖'
  if (m.limits>m.yesterdayLimits && m.sectorRank<=3 && !m.leaderDrop) return '主升'
  return m.previousPhase
}
const sample = {
  code:'600519', name:'样本甲', close:11, open:10.3, low:10.3, high:11, ma5:10.4, ma10:10.1, ma20:10,
  previousMa5:9.95, previousMa20:9.98, priorHigh20:10.8, priorLow10:9.7, firstLow:9.4,
  return20:12, rank20:.18, return5:4, rank60:.14, bigShare:.3 as number|null, smallShare:.55 as number|null,
  turnPercentile:.5, turn:16, volumeRatio:2, seal:610, opens:0, gap:3, auctionShare:5, sectorRank:2, sectorLimits:4,
  role:'龙头', epsQ:29, epsY:28, news:1, inst:3, north:4, superOrder:6, ageMinutes:4,
  boards:1, priorLimits60:2, yearGain:30, floatYi:80, priorLeaderFirst:false,
  priorWeak:false, priorLate:false, priorBroken:false, priorTurn:14, priorUnderwater:false,
  heldVwap:true, tShape:false, resealVolume:.8, recentTurnSecond:false, newTheme:true,
  otherLimitNext:null as boolean|null, priorHigh:10.6, sealShare:.02, sealFalling:false,
  frontLimit:true, frontAccelerating:false, frontReferenceSeal:630, sealDuration:5, frontReferenceDuration:8, priorAcceleration:false,
  resealed:false, pullDays:0, pullLow:10, limitBodyMid:9.8, priorBear:false, priorOpen:10.5,
  priorLow:10, priorClose:10, firstBear:false, pullVolumeRatio:1.3, platformRange:9,
  nextInside:false, gapAge:0, gapFloor:10, gapMin:10.1, gapDayRatio:2,
  priorBandwidthRank:.15, upperBand:10.9, midBand:10.1, nextLostMa5:false,
  listedInstitution:true, nextGap:2, sellerInstitution:false, sector5:2, previousSector5:-1,
  priorSectorRank:5, signalKind:'首板', signalFirstLow:9.4, signalPlatformHigh:10.8, signalOpen:10.3, heldDays:0, newHigh:true, heldFamily:'情绪',
  amplitude:8, change:10
}
type Snapshot = typeof sample
export type Quote = Snapshot & {previous?:Snapshot}
export const demoQuotes:Quote[] = [
  sample, {...sample,code:'000001',name:'样本乙',boards:2,priorLeaderFirst:true,previous:sample,opens:1},
  {...sample,code:'600036',name:'样本丙',boards:0,change:2,volumeRatio:1.25,low:10.08},
  {...sample,code:'000002',name:'样本丁',boards:0,change:-3,close:9.2,gap:-2,ageMinutes:20}
]
const between=(x:number,min:number,max:number)=>x>=min && x<=max
// Ranking fields are frozen cross-sectional percentiles (0 is strongest).
// Demo calibration: 5-day gain above 5% counts as stretched. Flow shares
// above 50% dominate. seal uses minutes after midnight in Shanghai.
export function factors(q:Snapshot,m:Market) {
  const fresh=q.ageMinutes<=15, momentum=q.rank20<=.3, reversal=q.return5<=5
  const flow=(v:number)=>fresh?Number(v>0):.5
  return {
    f01:q.close>q.ma5 && q.ma5>q.ma10 && q.ma10>q.ma20, f02:q.close>=q.ma10,
    f03:momentum,f04:reversal,f05:!fresh || q.bigShare===null || q.smallShare===null ? .5 :
      q.bigShare>.5?Number(reversal):q.smallShare>.5?Number(momentum):.5,
    f06:between(q.turn,10,20)?1:between(q.turn,5,25)?.5:0,
    f07:between(q.volumeRatio,1.5,3)?1:q.volumeRatio>5?0:.5,
    f08:q.seal<630?1:q.seal>870?0:.5,f09:q.opens===0?1:q.opens===1?.5:0,
    f10:between(q.gap,1,5)&&between(q.auctionShare,4,6),f11:q.gap<=6,
    f12:fresh?q.sectorRank<=3&&q.sectorLimits>=3:.5,f13:['跟风','中军','龙二','龙头'].indexOf(q.role)/3,
    f14:q.close>=q.firstLow,f15:q.close>q.priorHigh20&&q.volumeRatio>1,
    f16:q.epsQ>=25,f17:q.epsY>=25,f18:q.close>q.priorHigh20||q.news>0,
    f19:q.rank60<=.2,f20:flow(q.inst),f21:flow(q.north),f22:flow(q.superOrder),
    f23:q.return20>0&&q.volumeRatio>1,f24:m.index>m.indexMA20,f25:fresh
  }
}
export const factorTable = [
  ['ma_bull','均线多头','经典趋势','收盘 > MA5 > MA10 > MA20','均线方向是否一致'],
  ['ma10_hold','10日线','短线复盘教程','收盘不低于MA10','趋势是否被放弃'],
  ['ret20','20日动量','公开量化报告常见因子','20日涨幅排名前30%','中期强势能否延续'],
  ['ret5_rev','5日反转','公开量化报告常见因子','5日涨幅超过5%降分','短窗价格回归'],
  ['big_small','大小单开关','国盛「量价淘金」公开结论','大单过半用反转，小单过半用动量','过度反应与反应不足'],
  ['turn_fit','换手带','短线复盘教程','10%至20%高分，低于5%或高于25%低分','换手是否充分'],
  ['vol_ratio','量比带','短线复盘教程','1.5至3高分，超过5降分','成交放量的范围'],
  ['seal_time','封板时刻','短线复盘教程','10:30前高分，14:30后低分','封板先后'],
  ['open_count','开板次数','短线复盘教程','零次最高，至少两次降分','封板一致性'],
  ['auction','竞价强度','短线复盘教程','高开1%至5%，竞价量占昨日成交量4%至6%','竞价参与程度'],
  ['auction_hot','竞价过热','短线复盘教程','高开超过6%降分','溢价是否过高'],
  ['theme_top','主线','短线复盘教程','板块净流入前三且板块涨停至少三只','板块共振'],
  ['role','生态位','短线复盘教程','龙头、龙二、中军、跟风依次降分','板块角色'],
  ['first_low','首板生命线','短线复盘教程','收盘不低于首板最低价','观察关键价'],
  ['break_high20','20日新高','经典趋势','放量突破此前20日高点','突破确认'],
  ['canslim_c','当季增速','欧奈尔 CANSLIM','当季EPS增速至少25%','当季业绩增长'],
  ['canslim_a','年度增速','欧奈尔 CANSLIM','年度EPS增速至少25%','增长持续性'],
  ['canslim_n','新东西','欧奈尔 CANSLIM','创新高或催化评分为正','价格与新催化'],
  ['rs','相对强度','欧奈尔 CANSLIM','60日涨幅位于前20%','相对领导力'],
  ['inst','机构','欧奈尔 CANSLIM','机构席位净买入为正','机构参与'],
  ['north','北向','公开量化报告常见因子','北向净额为正','资金流向'],
  ['super_order','超大单','公开量化报告常见因子','超大单净额为正','大资金方向'],
  ['vol_mom','量调动量','公开量化报告常见因子','20日涨幅为正且量比超过1','上涨的成交配合'],
  ['market_m','大盘时机','欧奈尔 CANSLIM','指数在MA20上方','趋势仓位的环境约束'],
  ['stale','数据新鲜','公开量化报告常见因子','超过15分钟将资金因子记中性','识别过期数据']
].map(([key,name,source,condition,learn],i)=>({id:'f'+String(i+1).padStart(2,'0'),key,name,source,condition,learn}))

type Row={id:string,name:string,family:string,source:string,hitRule:string,failRule:string,cap:Cap,learn:string}
const sources=['短线复盘教程','经典趋势','欧奈尔 CANSLIM','公开量化报告常见因子','国盛「量价淘金」公开结论']
export const tactics:Row[] = `
首板观察|情绪|0|首次涨停，10:30前封住、未开板，量比1.5至3，同板块至少3只涨停|14:30后封板、至少开板两次或缺少板块共振|半仓|观察新题材首次确认
首板四去|情绪|0|首板观察通过，之前60日有涨停，年涨幅低于100%，流通市值20至500亿元且属于主线|大阳线未涨停|轻仓|先缩小观察池
一进二|情绪|0|昨日通过首板四去，今日高开1%至5%，10:30前二板，换手10%至20%|低开低走、高开超过6%或开板至少两次|半仓|二板确认强度
二板定龙|情绪|0|昨日为题材龙头首板，今日二板，同题材另有涨停|昨日为跟风|半仓|比较同题材强度
弱转强|情绪|0|昨日烂板、尾封或炸板且换手低于20%，今日高开、竞价量占比至少4%，盘中守住开盘价|跌破开盘价|轻仓|分歧后的回流
水下拉板|情绪|0|昨日盘中低于昨收且尾盘涨停，今日高开并守住分时均线|低开|轻仓|观察探底修复
龙头分歧|情绪|0|龙头换手超过15%或T字板，回封量为昨日70%至90%，收盘高于MA5|跌破MA10|轻仓|分歧后的承接
二板回调|趋势|0|近两日有换手二板，回调缩量并守住首板最低价|跌破首板低点|轻仓|跟踪首板生命线
冰点首板|情绪|0|冰点期新题材首板，量比至少1.5|次日已确认无同题材第二只涨停|轻仓|观察冰点新题材
退潮空仓|风控|0|环境为退潮|无|空仓|环境约束情绪战法
高潮降仓|风控|0|高潮期连板至少4板|无|轻仓|限制高位仓位
半路|情绪|0|主线龙头突破昨日高点且尚未涨停|回落跌破分时均线|轻仓|识别盘中突破
排板资格|情绪|0|二板定龙或龙头分歧命中，封单额占流通市值至少1%，未开板|封单快速下降|半仓|区分封板质量
卡位|情绪|0|同题材前排未涨停，后排封板时刻更早且封板用时更短|前排仍加速|轻仓|比较前后排变化
加速不接|风控|0|昨日一字或缩量加速，今日爆量分歧回封时仅作观察|未爆量分歧回封，暂停接力|空仓|观察加速后的分歧
N字反包|趋势|0|涨停后回调1至3天守住实体中点，放量阳包阴|换手低于15%且量小于回调日|轻仓|回调后的右侧确认
首阴反包|趋势|0|大涨后首阴换手至少15%，今日放量阳包阴|未覆盖昨日高点|轻仓|观察首阴修复
断板回封|情绪|0|龙头开板一次后14:00前回封涨停|二次开板|轻仓|观察重新封板
海龟突破|趋势|1|突破此前20日最高价，量比超过1.2，指数高于MA20|跌破此前10日最低价|半仓|确认价格突破
双均线|趋势|1|MA5上穿MA20且MA20上行|MA5跌回MA20下方|轻仓|结合均线方向
回踩均线|趋势|1|多头排列，回踩MA10或MA20后收阳，量比低于1.3|收盘跌破所踩均线|半仓|趋势中的缩量回踩
平台突破|趋势|1|此前20日振幅低于12%，放量突破平台高点|次日跌回平台|半仓|观察平台上沿
跳空不补|趋势|1|向上跳空后三日内低点守住缺口，缺口日量比超过1.5|缺口回补|轻仓|跟踪缺口支撑
布林收口|趋势|1|前期带宽位于20日最低20%，放量收盘突破上轨|跌回中轨|轻仓|观察波动扩张方向
抗跌|趋势|1|指数下跌，主线个股涨幅超过1%|次日补跌并跌破MA5|轻仓|比较弱市相对强度
CANSLIM|基本面|2|当季、年度、新高或催化、相对强度、机构、大盘六项至少五项通过且未涨停|指数低于MA20时空仓|半仓|结合成长、领导力与大盘
北向同向|资金|3|北向净额为正，20日涨幅为正且未涨停|北向转负|轻仓|观察资金方向
超大单|资金|3|超大单净额为正，收盘高于MA5|超大单净流出|轻仓|观察大资金方向
机构龙虎榜|资金|3|机构买席净额为正，次日高开不超过3%|高开超过5%或卖出前五含机构|轻仓|区分席位与溢价
量调动量|资金|3|20日涨幅为正，换手处于样本40%至60%分位，量比超过1|无量新高|轻仓|用成交确认动量
大小单开关|资金|4|大单过半看5日反转，小单过半看20日动量|占比缺失|轻仓|判断交易结构
行业轮动|资金|2|板块5日涨幅转正且净流入排名上升，个股为中军或龙头|板块掉出前8|半仓|观察强行业核心
破位放弃|风控|0|跌破信号日关键价2.5%，按信号取首板低点、平台高点或开盘价|无|空仓|关键价失效
持有天数|风控|0|情绪战法持有超过5个交易日仍未创新高|无|空仓|限制观察期限
单日过热|风控|0|高开超过6%或振幅超过12%|无|轻仓|约束过热波动
共振|组合|3|至少三条有效战法同时命中，按分数取前五只|退潮或关键价破位|半仓|比较多条规则的共振
`.trim().split('\n').map((line,i)=>{
  const [name,family,source,hitRule,failRule,cap,learn]=line.split('|')
  return {id:'t'+String(i+1).padStart(2,'0'),name,family,source:sources[+source],hitRule,failRule,cap:cap as Cap,learn}
})

function firstBoard(q:Snapshot) {
  return q.boards===1 && q.seal<630 && q.opens===0 && between(q.volumeRatio,1.5,3) && q.sectorLimits>=3
}
function filteredFirst(q:Snapshot) {
  return firstBoard(q) && q.priorLimits60>0 && q.yearGain<100 && between(q.floatYi,20,500) &&
    q.ageMinutes<=15 && q.sectorRank<=3
}
export type Result={hit:boolean,score:number,cap:Cap,note:string}
function evaluateQuote(q:Quote,m:Market,phase:Phase) {
  const f=factors(q,m), results:Record<string,Result>={}
  const engulf=q.close>q.open && q.priorBear && q.open<=q.priorClose && q.close>=q.priorOpen && q.volumeRatio>1
  const hot=!f.f11 || q.amplitude>12, accelerated=q.priorAcceleration && !(q.resealed && q.opens>0 && q.volumeRatio>3)
  const frozen=phase==='退潮'||phase==='冰点'
  const keyPrice=({首板:q.signalFirstLow,突破:q.signalPlatformHigh,弱转强:q.signalOpen} as Record<string,number>)[q.signalKind]
  const tests:Record<string,()=>boolean>={
    t01:()=>firstBoard(q), t02:()=>filteredFirst(q),
    t03:()=>!['冰点','退潮'].includes(m.previousPhase) && !!q.previous && filteredFirst(q.previous) && between(q.gap,1,5) && q.boards===2 && q.seal<630 && f.f06===1 && q.opens<2,
    t04:()=>q.priorLeaderFirst && q.boards===2 && q.sectorLimits>=2,
    t05:()=>(q.priorWeak||q.priorLate||q.priorBroken) && q.priorTurn<20 && q.gap>0 && q.auctionShare>=4 && q.low>=q.open,
    t06:()=>q.priorUnderwater && q.priorLate && q.gap>0 && q.heldVwap,
    t07:()=>f.f13===1 && (q.turn>15||q.tShape) && q.resealed && between(q.resealVolume,.7,.9) && q.close>q.ma5 && f.f02,
    t08:()=>q.recentTurnSecond && q.close<q.priorClose && q.volumeRatio<1 && f.f14,
    t09:()=>phase==='冰点' && q.newTheme && q.boards===1 && q.volumeRatio>=1.5 && q.otherLimitNext!==false,
    t10:()=>phase==='退潮', t11:()=>phase==='高潮' && q.boards>=4,
    t12:()=>f.f12===true && f.f13===1 && q.high>q.priorHigh && !q.boards && q.heldVwap,
    t13:()=>(results.t04.hit||results.t07.hit) && q.boards>0 && q.sealShare>=.01 && !q.opens && !q.sealFalling,
    t14:()=>!q.frontLimit && !q.frontAccelerating && q.boards>0 && q.role!=='龙头' && q.seal<q.frontReferenceSeal && q.sealDuration<q.frontReferenceDuration,
    t15:()=>q.priorAcceleration && !accelerated, t16:()=>between(q.pullDays,1,3) && q.pullLow>=q.limitBodyMid && engulf && !(q.turn<15 && q.volumeRatio<q.pullVolumeRatio),
    t17:()=>q.firstBear && q.priorTurn>=15 && engulf && q.close>=q.priorHigh,
    t18:()=>q.role==='龙头' && q.boards>0 && q.opens===1 && q.resealed && q.seal<840,
    t19:()=>f.f15 && q.volumeRatio>1.2 && f.f24 && q.close>=q.priorLow10,
    t20:()=>q.previousMa5<=q.previousMa20 && q.ma5>q.ma20 && q.ma20>q.previousMa20,
    t21:()=>f.f01 && q.low<=q.ma10 && q.close>q.open && q.volumeRatio<1.3,
    t22:()=>q.platformRange<12 && f.f15 && !q.nextInside,
    t23:()=>between(q.gapAge,1,3) && q.gapMin>q.gapFloor && q.gapDayRatio>1.5,
    t24:()=>q.priorBandwidthRank<=.2 && q.close>q.upperBand && q.volumeRatio>1 && q.close>=q.midBand,
    t25:()=>m.indexChange<0 && q.change>1 && f.f12===true && !q.nextLostMa5,
    t26:()=>[f.f16,f.f17,f.f18,f.f19,f.f20===1,f.f24].filter(Boolean).length>=5 && !q.boards,
    t27:()=>f.f21===1 && q.return20>0 && !q.boards, t28:()=>f.f22===1 && q.close>q.ma5,
    t29:()=>q.listedInstitution && f.f20===1 && q.nextGap>0 && q.nextGap<=3 && !q.sellerInstitution,
    t30:()=>f.f23 && between(q.turnPercentile,.4,.6),t31:()=>f.f05===1,
    t32:()=>f.f25 && q.previousSector5<=0 && q.sector5>0 && q.sectorRank<q.priorSectorRank && q.sectorRank<=8 && ['中军','龙头'].includes(q.role),
    t33:()=>keyPrice>0 && q.close<=keyPrice*.975,
    t34:()=>q.heldFamily==='情绪' && q.heldDays>5 && !q.newHigh,t35:()=>hot,
    t36:()=>!results.t10.hit && !results.t33.hit && Object.values(results).filter(r=>r.hit).length>=3
  }
  // The teaching score is the equal-weight mean of the 25 normalized factors.
  const quality=Object.values(f).reduce<number>((sum,value)=>sum+Number(value),0)/25
  const failures:Record<string,string|false>={
    t01:(q.opens>=2 || q.seal>870 || q.sectorLimits<3) && '封板时刻、开板次数或板块共振失效',
    t07:!f.f02 && '收盘跌破MA10', t08:!f.f14 && '收盘跌破首板最低价',
    t19:(q.close<q.priorLow10) && '收盘跌破此前10日最低价',
    t15:accelerated && '昨日加速后尚未爆量分歧回封',
    t31:(q.bigShare===null || q.smallShare===null) && '缺少成交占比',
    t36:phase==='退潮' && '退潮环境否决共振'
  }
  for(const row of tactics){
    const risk=row.family==='风控'
    const blocked=!risk && ((phase==='退潮' && row.family==='情绪') ||
      (phase==='冰点' && row.id!=='t09' && row.family!=='趋势') ||
      (accelerated && row.family==='情绪'))
    const hit=!blocked && tests[row.id]()
    let cap=row.cap
    if(!hit || frozen || (q.priorAcceleration && row.family==='情绪') || (row.id==='t26' && m.index<m.indexMA20)) cap='空仓'
    else if(cap==='半仓' && (hot || (phase==='高潮' && q.boards>=4) || (row.family==='趋势' && !f.f24))) cap='轻仓'
    const count=Object.values(results).filter(r=>r.hit).length
    const score=hit?Math.round(row.id==='t36'?Math.min(100,count*3+quality*50):quality*100):0
    results[row.id]={hit,score,cap,note:blocked?'环境或加速条件不允许':hit?row.hitRule:failures[row.id]?'失效：'+failures[row.id]:'未满足：'+row.hitRule}
  }
  return results
}
export function evaluateUniverse(quotes:Quote[],market:Market) {
  const phase=marketPhase(market)
  const stocks=quotes.map(quote=>({quote,results:evaluateQuote(quote,market,phase)}))
  const ranked=stocks.filter(s=>s.results.t36.hit).sort((a,b)=>b.results.t36.score-a.results.t36.score || a.quote.code.localeCompare(b.quote.code))
  for(const stock of ranked.slice(5)) stock.results.t36={hit:false,cap:'空仓',score:0,note:'共振评分未进入前五'}
  return stocks
}

// Evaluate in the same cross-section as the center so t36 keeps its top-five limit.
export function evaluateTactic(id:string, quote:Quote, market:Market=demoMarket, peers:Quote[]=demoQuotes):Result {
  if (!tactics.some(t=>t.id===id)) throw new RangeError('未知战法 '+id)
  const universe=[quote,...peers.filter(peer=>peer.code!==quote.code)]
  return evaluateUniverse(universe,market)[0].results[id]
}
