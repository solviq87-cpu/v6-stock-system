import {h,button,format,money,dateTime,updateReadout} from './ui.js';
import {readDecisionBoard,stockConclusion} from './decision-model.mjs';
import {createCommandSelection} from './command-selection.mjs';
import {readDecisionMiniKline} from './decision-mini-kline.mjs';
import {decisionSectorReader} from './decision-sector-context.mjs';
import {readExecutionChecklist} from './execution-evidence.mjs';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const price=value=>finite(value)?format(value)+' 元':'缺少后台价位';
function planEvidence(card){
 const lineage=card.lineage||{},council=card.council||{},quality=card.centerQuality||lineage.quality||{},ranking=card.factorRanking;
 const components=Array.isArray(quality.quality?.components)?quality.quality.components:[];
 const fields=[['buyLow','买区下沿'],['buyHigh','买区上沿'],['stop','止损位'],['target','目标价'],['positionPct','仓位']];
 return h('details',{class:'fy-details fy-decision-evidence',id:'fy-card-proof-'+card.code},h('summary',{},'四视角会商与数字来源'),
  h('p',{},(council.conclusion||'缺少后台会商结论')+' · 证据置信度 '+(council.confidenceLevel||'未知')+'（证据覆盖度，非胜率）'),
  h('ul',{},(council.views||[]).map(view=>h('li',{},h('strong',{},view.label+' · '+view.vote+' · '+(finite(view.score)?format(view.score,0)+' 分':'评分缺失')),
   h('p',{},(view.evidence||[]).map(item=>item.text).join('；'))))),
  h('dl',{},fields.map(([key,label])=>h('div',{},h('dt',{},label),h('dd',{},[lineage[key]?.derivedBy,lineage[key]?.source,dateTime(lineage[key]?.sourceAt)].filter(Boolean).join(' · '))))),
  h('p',{},'策略依据时点 · '+dateTime(card.strategyAt)+'；共振来源 · '+(card.resonanceStrategies||card.strategies||[]).map(item=>typeof item==='string'?item:item.label||item.name||item.id).join(' / ')),
  ranking?h('section',{'aria-label':'已批准因子模型依据'},h('p',{},
   (ranking.rankingApplied===true?'已批准模型参与同共振组排序':'模型排序证据未齐')+' · '+(ranking.reason||'后台尚未返回具体依据')),
   h('p',{},'模型版本 '+(ranking.modelVersion||'未返回')+(finite(ranking.score)?' · 净收益模型分 '+String(ranking.score)+'（原模型尺度）':'')),
   h('small',{},'信号日 '+(ranking.signalDay||'未知')+' · 目标日 '+(ranking.targetDay||'未知')+' · 原始观察 '+dateTime(ranking.observationAt)+
    ' · 计算 '+dateTime(ranking.scoredAt)+' · 批准 '+dateTime(ranking.approvedAt))):null,
  components.length?h('section',{'aria-label':'五维数据质量'},h('strong',{},'数据质量 Q · '+(finite(quality.qScore)?format(quality.qScore,1)+' / 100':'分量未齐')),
   h('p',{},quality.qReason||''),h('dl',{},components.map(component=>h('div',{},
    h('dt',{},component.label+' · 权重 '+(finite(component.weight)?format(component.weight*100,0)+'%':'缺失')),
    h('dd',{},finite(component.value)?format(component.value*100,1)+'%':'缺少分量证据',h('small',{},
     [component.evidence?.source,component.evidence?.method,
      component.evidence?.sourceAt?'源端 '+dateTime(component.evidence.sourceAt):component.evidence?.knownAt?'取得 '+dateTime(component.evidence.knownAt):null,
      Array.isArray(component.evidence?.missing)?component.evidence.missing.join('、'):component.evidence?.missing].filter(Boolean).join(' · '))))))):null,
  h('p',{},'多源一致性 · '+(({'observed-agreement':'已有同日原始报价的一致性证据',conflict:'原始报价存在冲突',unknown:'缺少仍在有效期内的独立来源报价'})[lineage.quality?.status]||'缺少可核实的独立来源报价')+
   '；'+(lineage.quality?.qReason||'完整质量分还需五项可核验证据。')));
}

// One selection is shared by the drawer, sector readout and the paper-plan form.
// It never substitutes a price or a trading permission from another surface.
export function linkedDecisionPanel(ctx,{compact=false,when=()=>true}={}){
 const host=h('section',{class:'fy-decision-linked','aria-label':'决策联动'});
 const sectors=decisionSectorReader(ctx);
 function paint(){
  const selected=ctx.decisionSelection;
  if(!selected||!when(selected)){host.hidden=true;return;}
  host.hidden=false;
  const {code,day,row={}}=selected;
  host.dataset.code=code;host.dataset.day=day;
  const evidence=sectors.read(),amounts=evidence.rows;
  const info=amounts.length?amounts.map(r=>r.name+' · 主力净额 '+money(r.value)+'元').join('；'):
   [evidence.loading?'正在读取 '+day+' 板块资金':null,...evidence.missing].filter(Boolean).join('；');
  updateReadout(host,h('header',{},h('strong',{},'当前联动 · '+(row.name||code)+' '+code),h('small',{},day)),
   h('p',{'data-decision-sector':code,'data-day':day},info),
   ...amounts.map(r=>h('p',{class:'fy-muted','data-sector-source':r.code||r.name},r.name+' · '+r.source+' · '+r.day+' · 取得 '+dateTime(r.retrievedAt)+
    ' · '+(r.sourceTimestamp?'源端 '+dateTime(r.sourceTimestamp):'源端资金时刻未提供'))),
   h('p',{'data-decision-paper':code,'data-day':day,class:'fy-muted'},'模拟计划 · 买入 '+price(selected.plan?.buyLow)+'～'+price(selected.plan?.buyHigh)+
    ' · 止损 '+price(selected.plan?.stop)),
   h('div',{class:'fy-inline'},button('查看板块资金',()=>{ctx.closeStock?.();ctx.navigate('pulse','sectors');},'quiet'),
    ctx.canEdit?button('查看模拟盘预填',()=>ctx.prefillPaper?.(selected),'quiet'):null,
    !compact?button('返回今日作战台',()=>ctx.returnToDecision?.(),'quiet'):null));
 }
 host.refresh=paint;sectors.subscribe(paint);paint();return host;
}

export function conclusionBar(row,{day,now=Date.now()}={}){
 const result=stockConclusion(row||{},{day,now});
 return h('section',{class:'fy-stock-conclusion','data-conclusion':result.label,'aria-label':'个股结论'},
  h('strong',{},result.label),h('span',{},result.reason),
  h('dl',{},(result.evidence||[]).map(e=>h('div',{},h('dt',{},e.label||e.kind),h('dd',{},e.text||'待核验')))));
}

function miniCandles(rows){
 const w=300,height=58,pad=4,lo=Math.min(...rows.map(r=>r.low)),hi=Math.max(...rows.map(r=>r.high)),span=hi-lo||1;
 const y=value=>pad+(hi-value)/span*(height-pad*2),step=(w-pad*2)/rows.length;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox',`0 0 ${w} ${height}`);svg.setAttribute('role','img');svg.setAttribute('aria-label','实际历史日 K 线');
 for(const [i,r]of rows.entries()){
  const color=r.close>=r.open?'#ed94bc':'#69cbb0',x=pad+step*(i+.5);
  const wick=document.createElementNS(svg.namespaceURI,'line');
  for(const [key,value]of Object.entries({x1:x,x2:x,y1:y(r.high),y2:y(r.low),stroke:color,'stroke-width':1}))wick.setAttribute(key,value);
  const body=document.createElementNS(svg.namespaceURI,'rect');
  for(const [key,value]of Object.entries({x:x-step*.3,y:Math.min(y(r.open),y(r.close)),width:Math.max(1,step*.6),height:Math.max(1,Math.abs(y(r.open)-y(r.close))),fill:color}))body.setAttribute(key,value);
  svg.append(wick,body);
 }
 return svg;
}

export function createDecisionHome(ctx){
 const weather=h('div',{class:'fy-decision-weather',role:'status'}),cards=h('div',{class:'fy-decision-cards','aria-label':'买入决策卡'});
 const count=h('small'),checklist=h('ol',{class:'fy-decision-checklist'}),coverage=h('p',{class:'fy-decision-coverage'});
 const rules=h('details',{class:'fy-details',id:'fy-decision-rules'},h('summary',{},'判断依据与未入选原因'));
 const executionProof=h('details',{class:'fy-details',id:'fy-execution-evidence'},h('summary',{},'执行依据与操作提示'));
 const queries=createCommandSelection(ctx);queries.classList.add('fy-decision-query');queries.id='fy-decision-query';
 const links=linkedDecisionPanel(ctx,{compact:true});
 const host=h('section',{class:'fy-decision-board','aria-label':'今日作战台'},
  h('header',{},h('div',{},h('span',{class:'fy-decision-kicker'},'FAYO / TODAY'),h('h1',{},'今日作战台')),count),
  weather,cards,h('div',{class:'fy-decision-execution'},h('strong',{},'今日执行清单'),checklist),executionProof,coverage,rules,links,queries);
 let board=null,lastDay='',readError='',restoredCards=false,execution=null;
 const history=new Map(),pending=new Set();
 const active=()=>!ctx.signal?.aborted;
 const selected=card=>ctx.decisionSelection?.code===card.code&&ctx.decisionSelection?.day===card.day;
 function paintExecutionProof(){
  if(!active())return;
  const summary=h('summary',{},'执行依据与操作提示');
  if(!executionProof.open){updateReadout(executionProof,summary);return;}
  const tips=board?.checklist||[];
  updateReadout(executionProof,summary,
   h('p',{},execution?.reason||'后台执行状态尚未返回'),
   execution?.generatedAt?h('small',{},execution.day+' · 后台核对 '+dateTime(execution.generatedAt)):null,
   ...(execution?.items||[]).map(item=>h('article',{'data-execution-code':item.code,'data-execution-state':item.state,'data-day':item.day,
    id:'fy-execution-plan-'+(item.planId||item.code)+'-'+item.day},
    h('strong',{},item.name+' '+item.code+' · '+item.label),h('p',{},item.reason),
    item.frozenAt?h('p',{},'原计划冻结于 '+dateTime(item.frozenAt)):null,
    item.entry?h('p',{},'原账本成交 · '+dateTime(item.entry.executionAt)+' · '+price(item.entry.price)+' × '+format(item.entry.quantity,0)+' 股'):null,
    item.intent?h('p',{},'条件意图 · '+({pending:'等待条件',executed:'已有成交引用',cancelled:'已撤销',expired:'已到期',unauthorized:'授权已失效'}[item.intent.status]||'状态未知')+
     ' · '+(item.intent.reason||'尚无新的核验说明')):null,
    ...item.risk.map(r=>h('p',{},(r.kind==='stop'?'计划止损':'计划目标')+' · '+price(r.price)+' · '+(r.source||'来源缺失')+' · '+dateTime(r.quoteAt)+' · '+(r.reason||'可执行条件未知'))),
    item.review?h('p',{},'对应持久日报 v'+item.review.reportVersion+' · '+dateTime(item.review.recordedAt)):null,
    item.missing.length?h('ul',{},item.missing.map(reason=>h('li',{},reason))):null)),
   h('h4',{},'操作提示'),h('ul',{},tips.map(item=>h('li',{},typeof item==='string'?item:(item.text||item.label||'')+(item.note?'：'+item.note:'')))));
 }
 executionProof.addEventListener('toggle',paintExecutionProof);
 function cardNode(card){
  const plan=card.plan||{},record=history.get(card.day+':'+card.code);
  const open=event=>ctx.chooseDecision?.(card,event.currentTarget);
  const node=h('article',{class:'fy-decision-card','data-code':card.code,'data-day':card.day,'data-selected':String(selected(card))},
   h('button',{type:'button',class:'fy-decision-stock','data-code':card.code,'data-day':card.day,onClick:open,
    'aria-label':`${card.name||card.code} ${card.code}，打开决策详情`},
    h('span',{},h('strong',{},card.name||card.code),h('small',{},card.code)),
    h('span',{class:'fy-decision-score'},h('b',{},format(card.score,0)),h('small',{},'精选评分'))),
   h('div',{class:'fy-decision-tags'},h('b',{'data-resonance':card.resonanceScore},'共振 '+card.resonanceScore+' 策略'),
    ...(card.themes||[]).slice(0,2).map(t=>h('span',{},t))),
   h('p',{class:'fy-decision-reason'},card.reason||card.selectionWhy||'已核对原策略条件'),
   h('dl',{class:'fy-decision-plan'},
    h('div',{class:'fy-decision-buy'},h('dt',{},'买入区间'),h('dd',{},format(plan.buyLow)+'～'+format(plan.buyHigh))),
    h('div',{},h('dt',{},'止损位'),h('dd',{},format(plan.stop))),
    h('div',{},h('dt',{},'目标价'),h('dd',{},format(plan.target))),
    h('div',{},h('dt',{},'建议仓位上限'),h('dd',{},format(plan.positionPct,1)+'%'))),
   h('figure',{class:'fy-decision-mini','data-mini-code':card.code},
    record?.rows?.length?miniCandles(record.rows):h('p',{},record?.error||'日 K 读取中…'),
    h('figcaption',{},record?.rows?.length?record.rows[0].date+' 至 '+record.rows.at(-1).date+' · 前复权 · '+record.source+
     ' · 取得于 '+dateTime(record.receivedAt)+'（日线日期，非实时价）':'沿用历史行情接口')),
   h('div',{class:'fy-decision-actions'},button('查看依据',open,'quiet'),
    ctx.canEdit?button('加入模拟盘',()=>ctx.prefillPaper?.(card),'primary'):h('small',{},'当前身份仅可查看')),
   h('small',{class:'fy-decision-proof'},card.day+' · '+dateTime(card.vendorQuoteAt??card.quoteAt)+' · '+(card.quoteSource||card.source||'')),planEvidence(card));
  return node;
 }
 async function loadMini(card){
  const key=card.day+':'+card.code;
  if(pending.has(key)||history.has(key))return;
  pending.add(key);
  try{
   const end=new Date(Date.parse(card.day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
   const result=await ctx.api('/api/kline?'+new URLSearchParams({code:card.code,n:'28',end}),{signal:ctx.signal,timeoutMs:12000});
   if(!active())return;
   history.set(key,readDecisionMiniKline(result,{code:card.code,day:card.day,now:Date.now()}));
  }catch(error){if(active())history.set(key,{error:error.name==='AbortError'?'日 K 暂未返回':error.message});}
  finally{pending.delete(key);if(active())paintCards();}
 }
 function paintCards(){
  if(!board)return;
  updateReadout(cards,...(board.cards.length?board.cards.map(cardNode):[
   h('div',{class:'fy-decision-empty',role:'status'},h('strong',{},'今天空仓，等待信号'),h('p',{},board.reasons?.[0]||'当期没有同时满足数据、策略与计划条件的标的。'))]));
  if(!restoredCards&&board.cards.length){
   restoredCards=true;
   const left=ctx.viewMemory?.decisionScrollLeft||0;
   if(left)requestAnimationFrame(()=>{if(active())cards.scrollLeft=left;});
  }
 }
 function paint(){
  if(!active())return;
  board=readDecisionBoard(ctx.decisionPayload,{now:Date.now()});
  if(board.day!==lastDay){history.clear();lastDay=board.day;}
  count.textContent=(board.day||'交易日待核验')+' · '+board.cards.length+' / 3 只';
  const w=board.weather;
  weather.dataset.weather=w.status;
  updateReadout(weather,h('span',{class:'fy-weather-light','aria-hidden':'true'}),h('strong',{},w.label),
   h('p',{},w.summary+(finite(w.positionCapPct)?' · 单票仓位上限 '+format(w.positionCapPct,0)+'%':'')+(readError?' · '+readError:'')));
  paintCards();
  execution=readExecutionChecklist(ctx.decisionPayload?.executionChecklist,{day:board.day,role:ctx.role});
  const items=[...execution.items].sort((a,b)=>Number(b.state==='risk-pending')-Number(a.state==='risk-pending')).slice(0,3);
  updateReadout(checklist,...(items.length?items.map(item=>h('li',{'data-execution-code':item.code,'data-execution-state':item.state,'data-day':item.day,title:item.name+' · '+item.reason},item.code+' · '+item.label)):
   [h('li',{'data-execution-state':execution.status},execution.status==='private'?'编辑身份可查看执行状态':execution.status==='no-plans'?'尚无执行计划':'执行状态未知')]));
  paintExecutionProof();
  coverage.textContent='仅展示当前通过门禁的候选；共振按独立策略去重。私密飞书 · '+(ctx.state?.feishuSecReady?'已配置':'未配置');
  const lines=[...(w.basis||[]).map(item=>typeof item==='string'?item:
   [({breadth:'市场宽度',limits:'涨跌停',sealing:'封板率'})[item.kind],item.source,item.scope,item.day].filter(Boolean).join(' · ')),
   ...(w.missing||[]).map(x=>'待核验：'+x)];
  updateReadout(rules,h('summary',{},'判断依据与未入选原因'),
   h('ul',{},lines.map(line=>h('li',{},line))),
   h('p',{},'展示规则：上涨占比至少55%、涨跌停比至少1.5且封板率至少70%时显示可做多；上涨占比低于35%、跌停多于涨停或封板率低于50%时显示空仓。其余显示谨慎。'),
   h('p',{},'买区、止损、目标与仓位由后台结合原策略、行情和模拟盘预算计算。加入模拟盘仅预填，确认时仍由原门禁核验。'),
   h('p',{},Object.entries(board.blockedCounts||{}).map(([key,value])=>key+' '+value).join(' · ')||'暂无被排除的候选'));
  for(const card of board.cards)void loadMini(card);
 }
 async function refreshDecisions(){
  if(!active())return;
  try{
   await ctx.loadDecisionCenter();if(active()){readError='';paint();}
  }catch(error){if(active()){readError='后台决策读取未完成';paint();}}
 }
 paint();ctx.onState?.(()=>{paint();if(document.visibilityState==='visible')void refreshDecisions();});ctx.onDecisionSelection?.(paintCards);ctx.onDecisionCenter?.(paint);
 void refreshDecisions();
 // Recheck the original quote age even when a transport has stopped updating.
 // Keep the existing local safety cadence while offline; hidden views need no
 // periodic DOM work. Initial and successful state reads still reach a local
 // backend even when the browser's coarse online flag is false.
 const refreshVisible=()=>{
  if(!active()||document.visibilityState!=='visible')return;
  paint();if(globalThis.navigator?.onLine!==false)void refreshDecisions();
 };
 const timer=setInterval(refreshVisible,5000);timer.unref?.();
 document.addEventListener?.('visibilitychange',refreshVisible);globalThis.window?.addEventListener('online',refreshVisible);
 ctx.signal?.addEventListener('abort',()=>{clearInterval(timer);document.removeEventListener?.('visibilitychange',refreshVisible);globalThis.window?.removeEventListener('online',refreshVisible);},{once:true});
 return host;
}
