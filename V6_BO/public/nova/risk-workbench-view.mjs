import {h,button,format,money,dateTime,updateReadout} from './ui.js';

const list=value=>Array.isArray(value)?value:[];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const val=value=>finite(value)?format(value):'未知';
const yuan=value=>finite(value)?money(value)+' 元':'未知';
const percent=value=>finite(value)?format(value,2)+'%':'未知';
const edit=ctx=>ctx.role==='edit'||ctx.role===undefined&&ctx.canEdit===true;
const category={data:'数据',market:'市场',stock:'个股',portfolio:'组合',strategy:'策略',execution:'执行',system:'系统'};
const severity={critical:'关键风险',warning:'需要处理',unknown:'风险未知',info:'一般信息'};
const levels={1:'一级：风险苗头',2:'二级：风险积累',3:'三级：风险触发',4:'四级：紧急防御'};
const assessment={'risk-detected':'命中已定义风险','not-triggered':'未命中已定义风险','unable-to-assess':'无法评估'};
const evidenceStates={complete:'证据完整',partial:'证据部分完整',conflict:'证据存在冲突',unverified:'证据尚未验证'};
const dataStates={valid:'数据有效',stale:'数据过期',missing:'数据缺失',interrupted:'数据断流'};
const actionStates={allowed:'动作检查允许',blocked:'动作被阻止',unconfirmed:'动作无法确认'};
const contractMissing={'original-evidence-time':'原始证据时间','first-knowable-time':'首次可知时间','rule-version':'规则版本',
  'input-version':'输入快照版本',
  'validated-accumulation-window-or-effective-rule':'已验证的积累窗口或生效规则依据','current-action-permission':'当前原后端动作许可'};
const evidence={available:'证据可用',partial:'部分证据',missing:'证据缺失',stale:'证据过期',conflict:'来源冲突',unknown:'证据未知'};
const execution={'not-applicable':'不涉及执行','condition-triggered':'条件触发',allowed:'当前检查允许',submitted:'已提交',
  'partially-filled':'部分成交',filled:'成交完成',failed:'失败','pending-reconciliation':'待核对',observing:'继续观察',unknown:'执行未知'};
const delivery={'not-queued':'未排队',queued:'已排队','gateway-accepted':'网关已受理','gateway-rejected':'网关拒绝',unconfirmed:'结果未确认','receiver-confirmed':'接收端已确认'};
const notificationLabel=value=>[delivery[value?.status]||'尚无回执',
  value?.admissionStatus==='daily-limit'?'已达每日限额':value?.admissionStatus==='cooldown'?'普通提醒冷却中':null].filter(Boolean).join(' · ');
const configuration={active:'已启用','not-configured':'未配置 / 未启用',invalid:'配置未通过验证',disabled:'已停用',unknown:'配置未知'};
const metric=(label,value,note)=>h('div',{class:'fy-metric'},h('span',{},label),h('strong',{},value),note?h('small',{},note):null);
const section=(title,...children)=>h('section',{class:'fy-panel'},h('h2',{},title),...children);
const note=text=>h('p',{class:'fy-muted',role:'status'},text);
const detail=(label,value)=>h('div',{},h('dt',{},label),h('dd',{},value));
function table(headers,rows){return h('div',{class:'fy-table-wrap'},h('table',{class:'fy-table'},
  h('thead',{},h('tr',{},headers.map(label=>h('th',{},label)))),h('tbody',{},rows.map(row=>h('tr',{},row.map(value=>h('td',{},value??'未知')))))));}
const unknown=message=>note(message||'风险证据尚不可用，当前风险未知。');
let viewSequence=0;

// A disconnected page cannot retain current private execution evidence. Route
// disposal removes every listener; pageshow rereads after a bfcache return.
function watchConnectivity(ctx,invalidate,refresh){
  let online=globalThis.navigator?.onLine!==false,pageActive=true;
  const events=new AbortController(),available=()=>online&&pageActive&&!events.signal.aborted&&!ctx.signal?.aborted;
  const listen=(name,fn)=>globalThis.addEventListener?.(name,fn,{signal:events.signal});
  const resume=()=>{if(available()&&edit(ctx))refresh();};
  listen('offline',()=>{online=false;invalidate('连接已断开，当前风险待重新核对。');});
  listen('pagehide',()=>{pageActive=false;invalidate('页面已离开，风险证据需重新读取。');});
  listen('online',()=>{online=true;resume();});
  listen('pageshow',()=>{pageActive=true;online=globalThis.navigator?.onLine!==false;resume();});
  function dispose(){events.abort();ctx.signal?.removeEventListener('abort',dispose);}
  ctx.signal?.addEventListener('abort',dispose,{once:true});
  if(ctx.signal?.aborted)dispose();
  return {available,dispose};
}

async function read(ctx,{accountId='pool',code,signal}={}){
  if(!edit(ctx))throw Error('编辑身份可查看账户风险');
  const query=new URLSearchParams({account:accountId});if(code)query.set('code',code);
  const reply=await ctx.api('/api/risk-workbench?'+query,{signal:signal||ctx.signal});
  if(reply?.ok!==true||reply.result?.protocol!=='fayo-risk-workbench-v1'||reply.result?.account?.id!==accountId)
    throw Error(reply?.error||'未取得同一账户的完整风险回执');
  return reply.result;
}

function riskCard(risk,report,{ctx,compact=false,onUpdate,scope='workbench'}={}){
  const group=list(report.alerts?.groups).find(row=>row.rootCauseId===risk.rootCauseId);
  const previous=risk.lastValidRisk||group?.lastValidRisk;
  const currentLabel=levels[risk.riskLevel]||assessment[risk.assessmentState]||'无法评估';
  const card=h('article',{class:'fy-risk-item','data-risk-id':risk.id,'data-risk-root':risk.rootCauseId,
    'data-risk-severity':risk.severity,'data-risk-state':risk.status,'data-risk-level':risk.riskLevel??'',
    'data-risk-assessment':risk.assessmentState||'unable-to-assess','data-risk-contract':risk.riskContract?.version||'unknown'},
    h('div',{class:'fy-item-head'},h('strong',{},risk.object?.label||risk.object?.id||'风险事项'),
      h('span',{class:'fy-tag'},currentLabel)),
    h('div',{class:'fy-risk-statuses'},h('span',{},evidenceStates[risk.evidenceState]||'证据尚未验证'),
      h('span',{},dataStates[risk.dataState]||'数据缺失'),h('span',{},actionStates[risk.actionState]||'动作无法确认'),
      ['warning','critical'].includes(risk.severity)?h('span',{},'原提醒：'+severity[risk.severity]):null,
      risk.executionStatus!=='not-applicable'?h('span',{},execution[risk.executionStatus]||'执行未知'):null,
      group?.muted?h('span',{},'通知静音 · 站内限制保留'):null),
    h('p',{},risk.facts?.[0]||'缺少具体事实'),
    h('p',{class:'fy-muted'},'影响：'+risk.impact),
    risk.restrictions?.length?h('p',{},'当前限制：'+risk.restrictions.join('；')):null,
    risk.assessmentState==='not-triggered'?note('仅表示本次检查未发现已定义条件，不代表没有风险。'):null,
    risk.assessmentState==='unable-to-assess'?note('当前无法评估：'+(evidenceStates[risk.evidenceState]||'证据尚未验证')+' / '+
      (dataStates[risk.dataState]||'数据缺失')+'；本次原始数据时间：'+dateTime(risk.riskContract?.dataAt??risk.sourceAt)):null,
    previous&&(risk.assessmentState==='unable-to-assess'||group?.observationGap)?note('上次有效风险：'+
      (levels[previous.riskLevel]||'等级未知')+' · '+dateTime(previous.sourceAt)+'；当前无法继续判断，原风险未解除。'):null,
    risk.resolutionBlockedReason||group?.resolutionBlockedReason?note(risk.resolutionBlockedReason||group.resolutionBlockedReason):null);
  const details=h('details',{class:'fy-details',id:'risk-proof-'+scope+'-'+risk.id},h('summary',{},'来源、检查与解除条件'),
    h('ul',{},list(risk.facts).slice(1).map(value=>h('li',{},value))),
    h('dl',{class:'fy-detail-grid'},detail('来源',risk.source),detail('来源时点',dateTime(risk.sourceAt)),
      detail('首次可知时间',dateTime(risk.riskContract?.firstKnowableAt)),detail('原始数据时间',dateTime(risk.riskContract?.dataAt)),
      detail('本次评估时间',dateTime(report.generatedAt)),
      detail('建议检查',list(risk.checks).join('；')),detail('解除条件',list(risk.releaseConditions).join('；')),
      detail('动作核验原因',list(risk.actionReasons).join('；')),detail('规则版本',risk.riskContract?.ruleVersion||'尚未取得'),
      detail('待补证据',list(risk.riskContract?.missing).map(value=>contractMissing[value]||value).join('；')||'本合同必需字段已取得'),
      detail('后续状态',risk.followUp||risk.status)),
    list(risk.sources).length>1?table(['证据来源','来源时点'],risk.sources.map(row=>[row.source,dateTime(row.sourceAt)])):null,
    list(risk.evidenceReferences).length?table(['原计划 / 观察','开仓事件 / 规则','原订单'],risk.evidenceReferences.map(ref=>[
      [ref?.planId,ref?.observationId].filter(Boolean).join(' / ')||'未关联',
      [ref?.entryEventId,ref?.ruleId].filter(Boolean).join(' / ')||'未关联',list(ref?.orderIds).join('、')||'未关联'])):null,
    risk.references?.planId?note('原计划 '+risk.references.planId):null,
    list(risk.references?.orderIds).length?note('原订单 '+risk.references.orderIds.join('、')):null,
    group?h('dl',{class:'fy-detail-grid'},detail('首次出现',dateTime(group.firstSeenAt)),detail('最后观察',dateTime(group.lastSeenAt)),
      detail('查看状态',group.viewed?'已查看':'未查看'),detail('通知状态',notificationLabel(group.notification)),
      detail('接收端确认',group.notification?.receiverConfirmed?'已有确认':'尚无接收证据')):note('尚未持久记录提醒生命周期'),
    group?.notification?.admissionReason?note(group.notification.admissionReason):null,
    group?.observationGap?note('后续观察缺档，尚未解除原风险。'):null);
  card.append(details);
  if(!compact&&group&&ctx&&onUpdate){
    const act=async(action,extra={})=>{
      if(!edit(ctx)||ctx.signal?.aborted)return;
      try{
        const result=await ctx.api('/api/risk-workbench/alerts',{method:'POST',signal:ctx.signal,
          body:{action,accountId:report.account.id,accountEpoch:report.accountEpoch,rootCauseId:risk.rootCauseId,
            expectedRevision:report.alerts.revision,...extra}});
        if(result.ok!==true)throw Error(result.error||'提醒状态尚未更新');
        await onUpdate();
      }catch(error){if(!ctx.signal?.aborted)ctx.notify?.(error.message,'error');}
    };
    const categoryMuted=(report.alerts?.preferences?.[group.classification+'MutedUntil']||0)>Date.now();
    const rootMuted=(group.rootMutedUntil??(!categoryMuted?group.mutedUntil:0))>Date.now();
    const muteButton=button(categoryMuted&&!rootMuted?'已随类别静音':rootMuted?'恢复通知':'静音30分钟',
      ()=>act('mute',{mutedUntil:rootMuted?null:Date.now()+30*60000}),'quiet');
    muteButton.disabled=categoryMuted&&!rootMuted;
    card.append(h('div',{class:'fy-toolbar'},button(group.viewed?'已查看':'标为已查看',()=>act('view'),'quiet'),muteButton));
    if(categoryMuted)card.append(note('所属提醒类别仍在静音；可在“提醒与查看闭环”恢复该类别通知。'));
  }
  return card;
}

export function createRiskSummary(ctx,{title='需要处理的风险',code=null,autoload=true}={}){
  const scope='summary-'+(++viewSequence);
  const host=h('section',{class:'fy-panel fy-risk-summary','data-risk-summary':true},h('h2',{},title));
  let epoch=0,controller=null,lastRead=0,currentCode=code,requested=autoload,scopeSignal=null;
  function invalidate(message){
    epoch++;controller?.abort();lastRead=0;
    host.replaceChildren(h('h2',{},title),...(message&&requested?[unknown(message)]:[]));host.hidden=!message||!requested;
  }
  function clear(){requested=false;scopeSignal=null;invalidate();}
  const connection=watchConnectivity(ctx,message=>edit(ctx)?invalidate(message):clear(),()=>{if(requested)void refresh();});
  async function refresh(options={}){
    const changed=options.code!==undefined&&options.code!==currentCode;
    if(options.code!==undefined)currentCode=options.code;
    if(options.signal!==undefined)scopeSignal=options.signal;
    if(!edit(ctx)||ctx.signal?.aborted||scopeSignal?.aborted){clear();return;}
    requested=true;
    if(!connection.available()){invalidate('连接已断开，当前风险待重新核对。');return;}
    const selected=currentCode,turn=++epoch;controller?.abort();controller=new AbortController();
    const active=controller,requestScope=scopeSignal,cancel=()=>active.abort();
    requestScope?.addEventListener('abort',cancel,{once:true});
    host.hidden=false;
    if(changed)host.replaceChildren(h('h2',{},title),unknown('正在读取所选标的风险…'));
    try{
      const report=await read(ctx,{code:selected,signal:active.signal});
      if(turn!==epoch||active.signal.aborted||!connection.available()||!edit(ctx))return;
      lastRead=Date.now();const risks=report.risks.filter(row=>row.status!=='resolved');
      updateReadout(host,h('h2',{},title),note(report.account.label+' · '+dateTime(report.generatedAt)),
        ...risks.slice(0,3).map(row=>riskCard(row,report,{compact:true,scope})),
        !risks.length?note('本次未返回待处理事项；仅代表已核对的证据范围。'):null,
        note('需处理 '+report.summary.actionable+' 项 · 证据未知 '+report.summary.unknown+' 项'),
        button('打开风险中心',()=>ctx.navigate('assets','risk'),'quiet'));
    }catch(error){if(!edit(ctx))clear();else if(turn===epoch&&!active.signal.aborted&&connection.available())updateReadout(host,h('h2',{},title),unknown(error.message));}
    finally{requestScope?.removeEventListener('abort',cancel);}
  }
  ctx.signal?.addEventListener('abort',clear,{once:true});
  ctx.onState?.(()=>{if(!edit(ctx))clear();else if(autoload&&connection.available()&&Date.now()-lastRead>=10000)void refresh();});
  if(autoload)queueMicrotask(()=>refresh());
  host.refresh=refresh;host.clear=clear;host.dispose=()=>{connection.dispose();clear();};return host;
}

function equityPanel(report){
  const e=report.equity,history=report.equityHistory?.history;
  return section('账户权益与观察回撤',
    note('来源为原权威模拟账户。手工申报持仓单独保留，不并入此权益。'),
    h('div',{class:'fy-metrics'},metric('核验时点权益',e?.status==='complete'?yuan(e.equity):'未知',
      '有效估值 '+(e?.coverage?.pricedPositions??'未知')+' / '+(e?.coverage?.positions??'未知')+' 个持仓'),
      metric('已结算盈亏',yuan(e?.settledPnl),'原成交及公司行为证据'),metric('持仓浮盈亏',yuan(e?.unrealizedPnl),'缺报价保留未知'),
      metric('已观察最大回撤',percent(history?.observedMaxDrawdownPct),'仅覆盖已记录采样时点')),
    h('dl',{class:'fy-detail-grid'},detail('权威现金',yuan(e?.cash)),detail('已观察持仓市值',yuan(e?.observedMarketValue)),
      detail('费用',yuan(e?.fees?.total)),detail('账户修订',report.accountRevision??'未知'),
      detail('权益证据时点',dateTime(e?.observedAt)),
      detail('当前观察回撤',percent(history?.currentObservedDrawdownPct)),detail('连续全账户最大回撤',percent(history?.continuousAccountMaxDrawdownPct))),
    note(e?.cashMovements?.note||'资金变动证据不足时不计算连续收益。'),
    ...list(report.equityMissingMessages).map(value=>note(value)),
    note(history?.note||'权益观察尚未形成连续区间，已结算收益曲线不能替代账户回撤。'),
    h('details',{class:'fy-details',id:'risk-equity-history'},h('summary',{},'权益来源、观察区间与缺档'),
      note('观察 '+dateTime(history?.from)+' 至 '+dateTime(history?.to)+' · '+(history?.sampleCount??'未知')+' 个采样'),
      note('常规采样间隔 '+(finite(history?.samplingIntervalMs)?history.samplingIntervalMs/1000+' 秒':'未知')+'；缺档单列，不补造中间权益。'),
      history?.truncated?note('当前仅展示有界窗口，不能代表全历史最大回撤。'):null,
      note('账户来源指纹 '+(e?.source?.snapshotFingerprint||'未知')),
      table(['观察时点','权益（元）','观察回撤','计算分段（缺档另列）'],list(history?.points).slice(-40).map(row=>[dateTime(row.at),yuan(row.equity),percent(row.drawdownPct),row.segment])),
      table(['缺档起点','缺档终点','原因'],list(history?.gaps).slice(-20).map(row=>[dateTime(row.from),dateTime(row.to),row.code]))));
}
function rulePanel(report){
  const rules=report.rules,auto=rules?.automaticRules;
  return section('当前账户实际生效规则',
    note('规则版本 '+(rules?.policyVersion||(rules?.policyConfigured===false?'未配置统一限额':'配置版本未知'))+' · 测量 '+dateTime(rules?.generatedAt)),
    table(['规则','状态','限额','占用','剩余','证据'],list(rules?.rules).map(row=>[
      row.label,configuration[row.configurationStatus]||'配置未知',row.enabled?val(row.limit)+' '+row.unit:row.configurationStatus==='not-configured'?'未启用':'未知',
      val(row.used),val(row.remaining),[evidence[row.evidenceStatus],...list(row.missing)].filter(Boolean).join('；')])),
    h('div',{class:'fy-metrics'},metric('持仓风险占用',yuan(rules?.occupancy?.heldValue)),metric('未成交买单敞口',yuan(rules?.occupancy?.pendingBuyValue)),
      metric('委托冻结资金',yuan(rules?.occupancy?.reservedCash)),metric('剩余可用资金',yuan(rules?.occupancy?.availableCash))),
    note(rules?.note||'提交和执行仍由原账户重新核对，不因卡片存在启用新规则。'),
    h('details',{class:'fy-details',id:'risk-automatic-rules'},h('summary',{},'原自动账户参数与来源'),
      note('来源 '+(auto?.source||'未知')+' · 版本 '+(auto?.version||'未知')+' · '+(auto?.enabled===true?'已启用':auto?.enabled===false?'已暂停':'状态未知')),
      h('dl',{class:'fy-detail-grid'},detail('最大持仓只数',val(auto?.parameters?.maxPos)),detail('原止损幅度',percent(finite(auto?.parameters?.sl)?auto.parameters.sl*100:null)),
        detail('原止盈幅度',percent(finite(auto?.parameters?.tp)?auto.parameters.tp*100:null)),detail('原持有交易日',val(auto?.parameters?.expireDays))),
      note(auto?.note||'配置缺失时不推定启用'),note('规则指纹 '+(rules?.policyFingerprint||'未配置'))));
}
function actionPanel(report){
  return section('风险动作与实际可执行性',
    note('计划止损价不是成交承诺。条件、执行许可、订单提交与成交分别保留证据。'),
    ...list(report.actions?.items).map(row=>h('details',{class:'fy-details',id:'risk-action-'+row.id.replace(/[^a-zA-Z0-9_-]/g,'-'),'data-risk-action':row.id},
      h('summary',{},(row.name||row.code)+' · '+(execution[row.status]||'执行未知')+(row.continueObserving?' · 剩余持仓继续观察':'')),
      note(row.execution?.reason||'原执行许可未知'),
      h('dl',{class:'fy-detail-grid'},detail('可卖数量',val(row.constraints?.sellableQuantity)+' 股'),
        detail('当日买入限制',val(row.constraints?.todayLockedQuantity)+' 股'),detail('冻结数量',val(row.constraints?.frozenQuantity)+' 股'),
        detail('剩余持仓',val(row.constraints?.remainingQuantity)+' 股'),
        detail('连续竞价',row.constraints?.session?.continuous===true?'当前属于连续竞价':row.constraints?.session?.continuous===false?'当前不满足连续竞价条件':'交易时段未知'),
        detail('当前核验价',yuan(row.constraints?.price?.current)),detail('计划止损',yuan(row.constraints?.price?.stop)),detail('计划目标',yuan(row.constraints?.price?.target)),
        detail('原流动性可参与数量',val(row.constraints?.liquidity?.capacityQuantity)+' 股'),
        detail('原始报价',dateTime(row.constraints?.price?.quoteAt))),
      note('原计划 '+(row.planId||'未关联冻结计划')+' · 原开仓事件 '+(row.entryEventId||'尚未核对')),
      note(row.observationCoverage?.note||'观察覆盖未知'),...list(row.missing).map(value=>note(value)),
      table(['原订单','状态','已成交','剩余'],list(row.orders).map(order=>[order.orderId,order.status,val(order.filledQuantity),val(order.remainingQuantity)])),
      table(['成交事件','原订单','成交时点','数量','实际成交价'],list(row.fills).map(fill=>[
        fill.eventId,fill.orderId,dateTime(fill.executionAt),val(fill.quantity),yuan(fill.price)])))),
    !report.actions?.items?.length?unknown('没有已读取的计划或可核验持仓动作；不据此断言无风险。'):null);
}
function adversePathPanel(stress){
  const path=stress?.adversePaths,odds=stress?.planOdds,theme=path?.simultaneousThemeRetreat,budget=path?.pendingBudget;
  const statusLabel={unknown:'证据不足',partial:'部分证据',estimated:'固定假设估算','price-geometry-only':'未扣费价格空间',
    'entry-range-expired':'原买入区间失效','stop-reached':'原止损触及','target-reached':'原目标触及','already-held-unlinked':'已有持仓，未关联计划'};
  return h('details',{class:'fy-details',id:'risk-adverse-paths'},h('summary',{},'隔夜、连续下跌及冻结买单压力'),
    note('当前状态：'+(statusLabel[path?.status]||'证据不足')+' · 版本 '+(path?.assumptions?.version||'未知')+
      ' · 每段价格冲击 '+percent(path?.assumptions?.shockPerStepPct)+'；不代表真实逐股跌停价或成交保证。'),
    table(['假设路径','持仓盯市损失','当前受限批次损失','买单全成后情景损失（含费）','情景权益'],
      list(path?.paths).map(row=>[row.title,yuan(row.heldMarkLoss),yuan(row.currentlyRestrictedLotLoss),yuan(row.allPendingFillLoss),yuan(row.allPendingFillEquityAfter)])),
    note('原剩余买单金额 '+yuan(budget?.remainingBuyNotional)+' · 原估算费用 '+yuan(budget?.estimatedRemainingFees)+' · 原冻结现金 '+yuan(budget?.reservedCash)),
    note('原总仓位限额 '+percent(path?.grossLimit?.limitPct)+'；当前原占用 '+percent(path?.grossLimit?.currentOriginalUsedPct)+'。情景不是额度释放回执。'),
    table(['假设路径','假设全部成交后仓位','是否超原限额'],list(path?.paths).map(row=>[row.title,percent(row.allPendingFillGrossAfterPct),row.aboveOriginalGrossLimit===true?'是（情景）':row.aboveOriginalGrossLimit===false?'否（情景，非执行许可）':'未知'])),
    note('共同题材同时退潮（按股票去重，未含买单）：'+(theme?.status==='no-observed-overlap'?'未观察到重叠；不等于无风险':theme?.status==='estimated'?list(theme.symbols).join('、')+' · '+val(theme.themeCount)+' 个题材':'证据不足')+' · 假设损失 '+yuan(theme?.loss)),
    note(path?.note||'缺少同一时点原账户及行情，不能确认情景损失。'),
    h('h4',{},'冻结计划当前价格赔率'),
    table(['标的','适用范围','当前/止损/目标','未扣费收益风险比','状态'],list(odds?.rows).map(row=>[
      row.symbol,row.scope==='held-position'?'持仓':row.scope==='held-unlinked'?'持仓（未关联）':'未持仓候选',[yuan(row.currentPrice),yuan(row.stopPrice),yuan(row.targetPrice)].join(' / '),val(row.grossRewardRiskRatio),statusLabel[row.status]||'证据不足'])),
    odds?.omittedPlans?note('受界面范围限制另有 '+odds.omittedPlans+' 条计划未展示，不能据此判定其他计划安全。'):null,
    note(odds?.note||'尚未取得可用冻结计划与当时报价；胜率及期望收益未知。'));
}
function stressPanel(report){
  const stress=report.stress,coverage=stress?.classificationCoverage;
  return section('多题材重叠与压力情景',
    note('权益与分类核验时点 '+dateTime(stress?.asOf)+' · '+(stress?.current===true?'输入处于本次有效估值窗口':'当前有效估值尚未确认')),
    note('分类有效覆盖 '+(coverage?.classified??'未知')+' / '+(coverage?.positions??'未知')+' 个持仓 · 分类及价格双覆盖 '+percent(coverage?.marketValuePct)),
    table(['共同题材','持仓','已观察敞口'],list(stress?.groups).map(group=>[group.theme,list(group.symbols).join('、'),yuan(group.marketValue)])),
    table(['情景假设','损失估计','可卖部分','暂不可卖部分','覆盖'],list(stress?.scenarios).map(row=>[
      row.title,yuan(row.estimatedLoss),yuan(row.potentiallySellableLoss),yuan(row.temporarilyUnsellableLoss),
      finite(row.coveredPositions)?row.coveredPositions+' / '+(row.affectedPositions??row.portfolioPositions??'未知')+' 个持仓':row.status==='unknown'?'证据不足':'见情景证据'])),
    adversePathPanel(stress),
    ...list(report.stressMissingMessages).map(value=>note(value)),
    note(stress?.note||'压力情景证据不足；不能将估计值视为最大损失保证。'),
    h('details',{class:'fy-details',id:'risk-stress-assumptions'},h('summary',{},'假设版本、来源与逐仓可卖约束'),
      note('固定研究假设版本 '+(stress?.assumptions?.version||'未知')+' · '+(stress?.assumptions?.source||'未提供来源')),
      note(stress?.assumptions?.note||'假设尚未用独立历史样本校准，不自动修改账户风险阈值。'),
      ...list(stress?.scenarios).map(row=>h('div',{},h('strong',{},row.title),
        note('价格冲击 '+percent(row.priceShockPct)+'；额外流动性成本 '+val(row.additionalLiquidationCostBps)+' 基点'),
        note(row.note||'可卖数量尚须原时段、价格、流动性及权限门禁核验，不保证成交。'),
        row.estimatedLoss===null?note('已覆盖部分损失估计 '+yuan(row.coveredLossEstimate)+'；完整情景损失仍未知。'):null,
        table(['股票','估计损失','可卖数量','暂不可卖数量'],list(row.positions||row.rows).map(p=>[p.symbol,yuan(p.estimatedLoss),val(p.sellableQuantity),val(finite(p.quantity)&&finite(p.sellableQuantity)?p.quantity-p.sellableQuantity:null)]))))),
    h('details',{class:'fy-details',id:'risk-classification-sources'},h('summary',{},'当时有效的分类来源'),
      ...list(stress?.classifications).map(row=>h('div',{},h('strong',{},row.symbol+' · '+(evidence[row.status]||'分类未知')),
        ...list(row.reasons).map(reason=>note(reason)),
        table(['来源 / 原始引用','版本','首次已知','发布时点','生效起点','有效截止'],list(row.sourceRefs).map(ref=>[
          ref.source+' / '+ref.sourceRecordId,ref.version,dateTime(ref.knownAt),dateTime(ref.publishedAt),
          dateTime(ref.effectiveFrom),dateTime(ref.effectiveTo)]))))));
}

export function renderRiskWorkbench(ctx){
  const host=h('div',{class:'fy-stack','data-risk-workbench':true});
  if(!edit(ctx))return h('section',{class:'fy-empty'},h('h2',{},'这是你的私人工作区'),note('编辑身份可查看账户风险与提醒记录。'));
  let accountId='pool',epoch=0,activeCategory='',lastRead=0,busy=false,controller=null;
  const chooser=h('select',{class:'fy-input','aria-label':'风险账户'},h('option',{value:'pool'},'A·跟单盘'),h('option',{value:'pre'},'B·预选盘'));
  const content=h('div',{class:'fy-stack'},unknown('正在读取原账户风险证据…'));
  const filters=h('div',{class:'fy-toolbar','aria-label':'风险范围'});
  let report=null;
  const connection=watchConnectivity(ctx,clear,()=>{void load();});
  const render=()=>{
    if(!report||!edit(ctx)||!connection.available())return;
    const open=new Set([...content.querySelectorAll('details[open][id]')].map(node=>node.id));
    const active=report.risks.filter(row=>row.status!=='resolved'&&(!activeCategory||row.category===activeCategory));
    const urgent=active.filter(row=>['critical','warning'].includes(row.severity)||row.riskLevel>0||row.lastValidRisk?.riskLevel>0);
    const primary=(urgent.length?urgent:active).slice(0,urgent.length?5:2),primaryIds=new Set(primary.map(row=>row.id));
    const secondary=active.filter(row=>!primaryIds.has(row.id));
    const lifecycle=list(report.alerts?.groups),represented=new Set(report.risks.map(row=>row.rootCauseId));
    const unseen=lifecycle.filter(row=>row.status!=='resolved'&&!represented.has(row.rootCauseId));
    const riskList=section('需要处理的事项',note(report.account.label+' · 来源读取 '+dateTime(report.generatedAt)),
      h('div',{class:'fy-metrics'},metric('需要处理',String(report.summary.actionable)),metric('证据未知',String(report.summary.unknown)),
        metric('私密通知',report.runtime?.privateChannel==='configured'?'已配置':report.runtime?.privateChannel==='unconfigured'?'未配置':'配置未知','无接收证据不称送达')),
      ...primary.map(row=>riskCard(row,report,{ctx,onUpdate:load})),
      secondary.length?h('details',{class:'fy-details',id:'risk-other-evidence'},h('summary',{},'其他风险与证据缺口（'+secondary.length+'）'),
        ...secondary.map(row=>riskCard(row,report,{ctx,onUpdate:load}))):null,
      ...unseen.flatMap(group=>list(group.risks).slice(0,1).map(row=>riskCard({...row,status:'unknown',evidenceStatus:'unknown',
        riskLevel:null,assessmentState:'unable-to-assess',evidenceState:'unverified',dataState:'missing',actionState:'unconfirmed',
        lastValidRisk:group.lastValidRisk,
        facts:['后续观察缺档，原风险未解除',...row.facts]},report,{ctx,onUpdate:load}))),
      !active.length?note('此范围未返回待处理事项；其他证据仍可在下方核对。'):null);
    const history=h('details',{class:'fy-details',id:'risk-resolved'},h('summary',{},'已解除与一般证据'),
      ...report.risks.filter(row=>row.status==='resolved').map(row=>riskCard(row,report,{ctx,onUpdate:load})));
    const mute=async(classification,mutedUntil)=>{
      if(!report||!edit(ctx)||ctx.signal?.aborted)return;
      try{const result=await ctx.api('/api/risk-workbench/alerts',{method:'POST',signal:ctx.signal,
        body:{action:'mute',accountId,accountEpoch:report.accountEpoch,classification,
          mutedUntil,expectedRevision:report.alerts?.revision}});
        if(result.ok!==true)throw Error(result.error||'静音状态未更新');await load();}
      catch(error){ctx.notify?.(error.message,'error');}
    };
    updateReadout(content,riskList,history,equityPanel(report),rulePanel(report),actionPanel(report),stressPanel(report),
      section('提醒与查看闭环',note('静音只影响通知，站内风险和原后端限制继续保留。'),
        h('div',{class:'fy-toolbar'},...Object.entries({general:'一般信息',critical:'关键风险'}).map(([classification,label])=>{
          const muted=(report.alerts?.preferences?.[classification+'MutedUntil']||0)>Date.now();
          return button(muted?'恢复'+label+'通知':label+'静音30分钟',()=>mute(classification,muted?null:Date.now()+30*60000),'quiet');
        })),
        table(['根因','首次出现','生命周期','通知','查看'],lifecycle.map(row=>[row.risks?.[0]?.facts?.[0]||row.rootCauseId,
          dateTime(row.firstSeenAt),[...list(row.events),...list(row.levelChanges)].sort((a,b)=>a.at-b.at)
            .map(e=>({'first-seen':'首次',escalated:'升级',deescalated:'降级',resolved:'解除',reopened:'再次出现'})[e.kind]||e.kind).join(' → '),
          notificationLabel(row.notification),row.viewed?'已查看':'未查看'])),
        note('网关受理仍未证明接收端收到；本页不提供伪造接收确认的入口。')),
      report.manualHoldings?section('手工申报持仓观察',note(report.manualHoldings.label),
        note('状态 '+report.manualHoldings.status+' · 未认证为权威账户'),button('管理原申报持仓',()=>ctx.navigate('assets','holdings'),'quiet')):null);
    for(const node of content.querySelectorAll('details[id]'))if(open.has(node.id))node.open=true;
  };
  function clear(message='编辑身份可查看账户风险与提醒记录。'){
    epoch++;controller?.abort();report=null;busy=false;lastRead=0;content.replaceChildren(unknown(message));
  }
  async function load(){
    if(!edit(ctx)||ctx.signal?.aborted){clear();return;}
    if(!connection.available()){clear('连接已断开，当前风险待重新核对。');return;}
    const turn=++epoch,account=accountId;busy=true;
    controller?.abort();const active=controller=new AbortController();
    try{const value=await read(ctx,{accountId:account,signal:active.signal});if(turn!==epoch||active.signal.aborted||!connection.available()||!edit(ctx))return;
      report=value;lastRead=Date.now();render();}
    catch(error){if(turn===epoch&&!active.signal.aborted&&connection.available()){report=null;content.replaceChildren(unknown(error.message));}}
    finally{if(turn===epoch)busy=false;}
  }
  filters.append(button('全部',()=>{activeCategory='';render();},'quiet'),...Object.entries(category).map(([id,label])=>button(label,()=>{activeCategory=id;render();},'quiet')));
  chooser.addEventListener('change',()=>{accountId=chooser.value;report=null;content.replaceChildren(unknown('正在读取所选原账户…'));void load();});
  host.append(section('统一风险工作台',note('风险等级、证据状态、数据状态与动作状态分别展示；具体提交仍由原后端核验。'),h('div',{class:'fy-toolbar'},chooser,button('刷新风险',load,'quiet')),filters),content);
  ctx.onState?.(()=>{if(!edit(ctx))clear();else if(connection.available()&&!busy&&Date.now()-lastRead>=10000)void load();});
  ctx.signal?.addEventListener('abort',()=>{clear();content.replaceChildren();},{once:true});
  host.dispose=()=>{connection.dispose();clear();content.replaceChildren();};
  queueMicrotask(load);return host;
}
