import {h,table,format,dateTime} from './ui.js';
const labels={fourteen:'十四条原体系',bazi:'八字原体系',gpt:'GPT原体系',python:'Python原体系'};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const value=x=>finite(x)?String(x):'未知';
export function renderStrategyComparison(data){
 const host=h('section',{class:'fy-section fy-panel','aria-label':'原策略同条件回放'},h('header',{class:'fy-section-head'},h('h2',{},'原策略同条件回放')));
 if(data?.schemaVersion!==1||data.mode!=='native-strategy-protocol-comparison'||['canTrade','canTrain','canNotify','verifiedLive','eligibleForPromotion','weightsChanged'].some(k=>data[k]!==false)||data.status==='unavailable'||!Array.isArray(data.systems)||data.systems.length!==4||new Set(data.systems.map(r=>r.id)).size!==4||data.systems.some(r=>!labels[r.id])){
  host.append(h('p',{class:'fy-note',role:'status'},'同条件回放未完成 · '+(data?.reason||'缺少可核对的研究协议')));return host;
 }
 const p=data.protocol||{},status=r=>r.status==='not-evaluated'?'未评估':r.status==='no-buy-fills'?'无买入成交':'纸面估算';
 host.append(h('p',{class:'fy-note',role:'status'},'共同可评估信号 '+value(data.commonEvaluatedSignals)+' / '+value(data.totalCandidateSignals)+' · '+(data.commonEvaluatedSignals>0?'仅为同协议描述，未选出赢家。':'覆盖不足，不能判定策略优劣。')),
  h('p',{class:'fy-muted'},'同一导入样本 · '+String(data.source||'来源未知')+' · '+String(data.dataset?.stocks??'未知')+'只证券；信号 '+String(p.signalStart||'未知')+' 至 '+String(p.signalEnd||'未知')),
  h('p',{class:'fy-muted'},'各体系独立使用相同研究资金 '+value(p.initialCash)+'；佣金 '+value(p.feeBps)+'bp、滑点 '+value(p.slippageBps)+'bp、卖出税费 '+value(p.sellTaxBps)+'bp、最低佣金 '+value(p.minCommission)+'（均为研究设定）。'),
  table([{label:'体系',value:r=>labels[r.id]},{label:'状态',value:status},
   {label:'已评估 / 总信号',value:r=>value(r.coverage?.evaluated)+' / '+value(r.coverage?.total)},
   {label:'未知',value:r=>value(r.coverage?.unknown)},
   {label:'纸面净值变动',value:r=>r.status==='paper-estimate'&&finite(r.paperReturnPct)?format(r.paperReturnPct)+'%':'未评估或无买入成交'},
   {label:'纸面回撤',value:r=>r.status==='paper-estimate'&&finite(r.paperDrawdownPct)?format(r.paperDrawdownPct)+'%':'未知'}],data.systems),
  h('p',{class:'fy-note'},'零交易不表示策略胜出；纸面估算含成本和可能未平仓估值，不等于真实成交、独立收益验证或启用批准。'),
  ...(Array.isArray(data.complementarity?.pairs)&&data.complementarity.pairs.length===6?
   [h('details',{class:'fy-details'},h('summary',{},'策略互补性 · 重复候选与覆盖'),
    h('p',{class:'fy-note'},data.complementarity.note),
    table([{label:'原体系对',value:r=>(labels[r.a]||'未知')+' / '+(labels[r.b]||'未知')},
     {label:'共同已评估 / 全部',value:r=>value(r.commonEvaluated)+' / '+value(r.total)},
     {label:'共同通过 / 各自独有',value:r=>[r.bothPass,r.onlyAPass,r.onlyBPass].map(value).join(' / ')},
     {label:'未知 / 缺记录',value:r=>value(r.unknownEither)+' / '+value(r.missingEither)},
     {label:'通过候选重叠率',value:r=>finite(r.passOverlap)?format(r.passOverlap*100)+'%':'未知'},
     {label:'共同通过且两账户买入',value:r=>value(r.sharedPassBothBought)},
     {label:'版本',value:r=>r.mixedVersions?'混合版本 · 仅描述':'未认证独立性'}],data.complementarity.pairs),
    h('p',{},'不调整原策略权重、不新增候选或订单。没有真实消融和成熟结果前，不宣称重复信号能增加收益。'))]:[]),
  h('p',{class:'fy-muted'},'本表仅比较原四体系；页面其他回测和混合策略指标分别保留，不能直接合并排名。'),
  h('details',{class:'fy-details'},h('summary',{},'研究协议与限制'),
   h('p',{},'原退出模型：入场后下一可执行交易日开盘研究退出，保留T+1、停牌和涨跌停限制；不能退出时仍保留持仓。估值截至 '+String(p.valuationThrough||'未知')+'。'),
   h('p',{},'最多持仓 '+value(p.maxPositions)+'，单笔研究资金比例 '+(finite(p.allocationPct)?format(p.allocationPct*100)+'%':'未知')+'；账面回撤暂停阈值 '+value(p.maxDrawdownPct)+'%。这些设定不改变正式账户风险预算。'),
   h('p',{},'输入记录的取得时点 '+(data.retrievedAt?dateTime(data.retrievedAt):'未知')+'（未独立核验）；不代表每个历史日当时已知的信息。'),
   h('ul',{},(data.limitations||[]).map(text=>h('li',{},text))),
   h('p',{class:'fy-muted'},'数据指纹 '+String(data.datasetFingerprint||'未知')),
   h('p',{class:'fy-muted'},'信号指纹 '+String(data.signalsFingerprint||'未知')),
   h('p',{class:'fy-muted'},'协议指纹 '+String(data.protocolFingerprint||'未知'))));
 return host;
}
