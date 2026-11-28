import {h,table,format} from './ui.js';
const periods=[1,3,5,10,20],finite=x=>typeof x==='number'&&Number.isFinite(x);
const names={'no-buy-fills':'无买入成交','no-closed-trades':'尚无平仓','unsettled-paper-estimate':'含未平仓估值','closed-paper-estimate':'已平仓纸面估算'};
export function renderHoldingPeriodComparison(data){
 const host=h('section',{class:'fy-section fy-panel','aria-label':'多期限原回测'},h('header',{class:'fy-section-head'},h('h2',{},'多期限原回测')));
 if(data?.schemaVersion!==1||data.mode!=='holding-period-research-comparison'||['canTrade','canTrain','canNotify','verifiedLive','eligibleForPromotion','weightsChanged'].some(k=>data[k]!==false)||data.status!=='descriptive-only'||!Array.isArray(data.periods)||data.periods.length!==periods.length||data.periods.some((p,i)=>p.holdDays!==periods[i]||!names[p.status])){
  host.append(h('p',{class:'fy-note',role:'status'},'多期限研究未完成 · '+String(data?.reason||'缺少可核对的固定期限协议')));return host;
 }
 const p=data.protocol,c=p?.configuration||{},value=x=>finite(x)?String(x):'未知';
 host.append(h('p',{class:'fy-note',role:'status'},'同一数据与研究设定，分别运行原回测器；固定展示1、3、5、10、20日参数，不选择最佳期限。'),
  h('p',{class:'fy-muted'},'研究资金 '+value(c.initialCash)+'；佣金 '+value(c.feeBps)+'bp、滑点 '+value(c.slippageBps)+'bp、卖出税费 '+value(c.sellTaxBps)+'bp。估值截至 '+String(data.asOf||'未知')+'。'),
  table([{label:'计划持有参数',value:r=>r.holdDays+'日'},{label:'结果状态',value:r=>names[r.status]},
   {label:'已平仓 / 仍持有',value:r=>r.closedTrades+' / '+r.openPositions},
   {label:'账户估值变化',value:r=>r.status!=='no-buy-fills'&&finite(r.markedAccountReturnPct)?format(r.markedAccountReturnPct)+'%':'无买入成交，不评价'},
   {label:'全部平仓后净值变化',value:r=>r.status==='closed-paper-estimate'&&finite(r.closedAccountReturnPct)?format(r.closedAccountReturnPct)+'%':'未形成全部平仓结果'},
   {label:'受阻订单',value:r=>r.blockedOrders}],data.periods),
  h('p',{class:'fy-note'},'账户轨迹会随持有期限改变，入场信号集合可能不同。止损可提前退出，停牌、跌停或容量限制可延后；未平仓估值不是成熟策略收益。'),
  h('details',{class:'fy-details'},h('summary',{},'期限协议与完整证据'),
   h('p',{},'仅比较原研究扫描器，不是原四体系或全部策略的竞技。各期限原委托、成交、未平仓、净值、现金流及原分割指标随本次证据完整导出。'),
   h('p',{},'原默认期限 '+value(p?.baselinePeriod)+'日结果直接复用；本次协议在计算前形成，但未认证独立预注册、试验额度或样本外。'),
   h('h3',{},'已结算份额净收益经验分布'),
   h('p',{class:'fy-note'},'只统计原回测已结算份额的净损益/分摊成本；公司行为证券保守排除，未平仓不补零。部分退出不等于独立样本，分位数不是预测区间或胜率。'),
   h('ul',{},data.periods.map(row=>{const d=row.settledNetDistribution||{},pct=x=>finite(x)?format(x)+'%':'未知';
    return h('li',{},row.holdDays+'日：可用/结算记录 '+value(d.usableRecords)+'/'+value(d.totalSettledRecords)+
     '；覆盖 '+pct(d.coveragePct)+'；P10 / P50 / P90 '+[d.p10Pct,d.p50Pct,d.p90Pct].map(pct).join(' / ')+'；宽度 '+pct(d.empiricalWidthPct));
   })),
   h('ul',{},(data.limitations||[]).map(text=>h('li',{},text))),
   h('p',{class:'fy-muted'},'数据指纹 '+String(data.datasetFingerprint||'未知')),
   h('p',{class:'fy-muted'},'协议指纹 '+String(data.protocolFingerprint||'未知'))));
 return host;
}
