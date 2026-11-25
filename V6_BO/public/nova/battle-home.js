import {h,button,format,dateTime,updateReadout} from './ui.js';
import {buildBattleBoard} from './battle-model.js';
import {aggregateCandles} from './market-evidence.js';
import {renderSelectedSector,workflowDay} from './decision-workflow.js';
import {renderStockCommand,renderPrivateReminder} from './workflow-tools.js';

export function miniCandles(payload,code,day){
 const today=new Date(Date.now()+28800000).toISOString().slice(0,10);
 if(!payload||payload.ok===false||payload.code!==code||!/^\d{6}$/.test(code)||workflowDay(day)!==day||day>today)return [];
 const source=payload.dataQuality?.source||payload.source;
 const receivedAt=payload.dataQuality?.receivedAt;
 if(typeof source!=='string'||!source.trim()||payload.dataQuality?.missingReason||
  receivedAt!=null&&(!Number.isSafeInteger(receivedAt)||receivedAt<=0||receivedAt>Date.now()))return [];
 const input=Array.isArray(payload.rows)?payload.rows:Array.isArray(payload.data)?payload.data:[];
 return aggregateCandles(input,'day').filter(r=>r.date<=day&&[r.open,r.high,r.low,r.close].every(n=>Number.isFinite(n)&&n>0)&&
  r.high>=Math.max(r.open,r.close)&&r.low<=Math.min(r.open,r.close)&&r.low<=r.high).slice(-20);
}
function miniChart(rows,code,day){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
 svg.setAttribute('viewBox','0 0 240 64');svg.setAttribute('role','img');svg.setAttribute('aria-label',code+' 原始日K · 截至 '+day);
 const max=Math.max(...rows.map(r=>r.high)),min=Math.min(...rows.map(r=>r.low)),spread=max-min||1;
 const y=v=>58-(v-min)/spread*52,width=232/rows.length;
 const add=(tag,attrs)=>{const node=document.createElementNS(svg.namespaceURI,tag);for(const[k,v]of Object.entries(attrs))node.setAttribute(k,String(v));svg.append(node);};
 rows.forEach((r,i)=>{const x=4+(i+.5)*width,color=r.close>=r.open?'#fb8cbd':'#7edabf';
  add('line',{x1:x,x2:x,y1:y(r.high),y2:y(r.low),stroke:color});
  add('rect',{x:x-width*.28,y:Math.min(y(r.open),y(r.close)),width:Math.max(1,width*.56),height:Math.max(1,Math.abs(y(r.open)-y(r.close))),fill:color,rx:.7});
 });return svg;
}

export function createBattleHome(ctx){
 const host=h('section',{class:'fy-battle-home','data-battle-home':'true','aria-label':'今日作战台'});
 const weather=h('div',{class:'fy-battle-weather',role:'status','aria-live':'polite'});
 const cards=h('div',{class:'fy-battle-cards','aria-label':'当日买入候选'});
 const candidateNav=h('nav',{class:'fy-battle-stock-nav','aria-label':'候选快速定位'});
 const checklist=h('details',{class:'fy-battle-checklist',id:'fy-battle-checklist','aria-label':'今日执行清单',open:globalThis.matchMedia?.('(min-width:761px)').matches||false});
 const status=h('p',{class:'fy-battle-status','aria-live':'polite'}),dayLabel=h('small');
 const charts=new Map();let auction=null,auctionPending=false,auctionKey='',auctionFailed=false,lastModel=null,disposed=false;
 const detailBody=h('div');
 const detail=h('details',{class:'fy-battle-evidence',id:'fy-battle-evidence'},h('summary',{},'查看判断依据'),detailBody);
 host.append(h('header',{class:'fy-battle-heading'},h('div',{},h('h1',{},'今日作战台'),dayLabel),button('刷新',()=>{
  for(const[key,result]of charts)if(!result.pending&&!result.rows?.length)charts.delete(key);
  if(auctionFailed&&!auctionPending)auctionKey='';
  ctx.refresh();paint();
 },'quiet')),
  weather,candidateNav,cards,status,checklist,detail,renderSelectedSector(ctx,{compact:true}));
 const tools=h('div',{class:'fy-battle-tools'},renderStockCommand(ctx),renderPrivateReminder(ctx));host.append(tools);
 ctx.signal?.addEventListener('abort',()=>{disposed=true;charts.clear();},{once:true});

 function requestChart(candidate){
  const key=candidate.day+':'+candidate.code;if(charts.has(key)||!ctx.api)return;
  charts.set(key,{pending:true});
  const end=new Date(Date.parse(candidate.day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  ctx.api('/api/kline?'+new URLSearchParams({code:candidate.code,n:'40',end}),{signal:ctx.signal,timeoutMs:12000}).then(payload=>{
   if(disposed)return;const rows=miniCandles(payload,candidate.code,candidate.day);
   charts.set(key,{rows,source:payload.dataQuality?.source||payload.source,day:candidate.day});paint();
  }).catch(error=>{if(!disposed){charts.set(key,{rows:[],error:error.message});paint();}});
 }
 function select(candidate,event){ctx.selectDecision?.(candidate,event.currentTarget);}
 function paintCard(candidate){
  const key=candidate.day+':'+candidate.code,history=charts.get(key);
  const metric=(label,value)=>h('div',{},h('dt',{},label),h('dd',{},value));
  const source='报价 '+dateTime(candidate.quoteAt)+' · '+candidate.source;
  const chosen=ctx.selection?.code===candidate.code&&ctx.selection?.day===candidate.day;
  const open=h('button',{type:'button',class:'fy-battle-open fy-stock-card','data-code':candidate.code,
   'aria-label':'查看 '+candidate.name+' '+candidate.code+' 决策详情',onClick:event=>select(candidate,event)},
   h('span',{},h('strong',{},candidate.name),h('small',{},candidate.code)),
   h('span',{class:'fy-battle-score'},format(candidate.score,0),h('small',{},'精选评分')));
  const card=h('article',{class:'fy-battle-card','data-code':candidate.code,'data-day':candidate.day,'data-selected':String(chosen)},
   open,h('div',{class:'fy-battle-tags'},h('b',{title:candidate.resonanceLabels.join('、')},candidate.resonance+' 策略共振'),candidate.themes.slice(0,2).map(tag=>h('span',{},tag))),
   h('p',{class:'fy-battle-reason'},candidate.reason),
   h('dl',{class:'fy-battle-plan'},
    metric('买入区间',candidate.entry?candidate.entry.map(n=>format(n)).join('–'):'待计划'),
    metric('止损参考',Number.isFinite(candidate.stop)?format(candidate.stop):'待核验'),
    metric('目标价',Number.isFinite(candidate.target)?format(candidate.target):'待核验'),
    metric('建议仓位',Number.isFinite(candidate.positionPct)?'≤ '+format(candidate.positionPct,1)+'%':'待计划')),
   h('div',{class:'fy-battle-mini'},history?.rows?.length?miniChart(history.rows,candidate.code,candidate.day):h('small',{class:'fy-muted'},history?.pending?'原始日 K 读取中…':history?'暂无可核验日 K':'等待原始日 K')),
   h('small',{class:'fy-battle-source',title:source},source),
   h('div',{class:'fy-battle-actions'},button('详情与板块',event=>select(candidate,event),'quiet'),
    ctx.canEdit?button('加入模拟盘',()=>{ctx.prefillPaper?.(candidate);},'primary'):h('small',{},'模拟盘需要编辑权限')));
  return card;
 }
 function paint(){
  if(disposed||ctx.signal?.aborted)return;
  const state=ctx.state||{},model=buildBattleBoard(state,{role:ctx.role,auction});lastModel=model;
  const ready=state.ready===true||state.pool!=null||state.dashboard!=null;
  dayLabel.textContent=(model.day||'交易日待核验')+' · '+(state.trading===true?'盘中原始行情':'等待连续竞价');
  const mood=model.weather;weather.dataset.tone=mood.tone;
  updateReadout(weather,h('span',{class:'fy-weather-light','aria-hidden':'true'}),h('strong',{},mood.label),h('p',{},mood.sentence));
  candidateNav.hidden=model.candidates.length<2;
  updateReadout(candidateNav,...model.candidates.map((candidate,i)=>button((i+1)+'. '+candidate.name,()=>{
   const card=cards.querySelector('[data-code="'+candidate.code+'"]');card?.scrollIntoView?.({block:'nearest',inline:'start',behavior:'smooth'});
  },'quiet')));
  updateReadout(cards,...(model.candidates.length?model.candidates.map(paintCard):[
   h('div',{class:'fy-battle-empty',role:'status'},h('strong',{},ready?'今天空仓，等待信号':'正在读取当日候选'),
    h('p',{},ready?(state.trading===true?'当前没有同时满足原选股条件与原始报价要求的标的。':'当前为休市或快照状态，等待连续竞价时的新信号。'):'尚未取得服务端回执。'))]));
  status.textContent=model.candidates.length?model.gateNote:'原策略与收盘观察仍可在下方研究区查看。';
  const steps=model.candidates.length?[
   ['核对候选',model.candidates.map(r=>r.name+' '+r.code).join('、')],
   ['确认买卖计划',model.candidates.some(r=>!r.planReady)?'仍有计划缺项；核对区间、账户仓位和止损后再提交。':'核对买入区间、止损和目标，进入原模拟盘确认。'],
   ['收盘复盘','对照事前计划与成交流水，查看执行评分。']
  ]:[['今日安排','空仓等待新信号'],['继续观察','核对市场天气、原始行情与风险提示'],['收盘复盘','有事前计划和成交证据后生成执行评分']];
  updateReadout(checklist,h('summary',{},h('strong',{},'今日执行清单'),h('span',{},steps.map(([title],i)=>(i+1)+'. '+title).join(' · '))),
   h('ol',{},steps.map(([title,body])=>h('li',{},h('strong',{},title),h('span',{},body)))),
   ctx.canEdit?button('查看执行评分与收益',()=>ctx.navigate('assets','paper'),'quiet'):null);
  updateReadout(detailBody,h('p',{},mood.rule),...mood.sources.map(r=>h('p',{},[r.label,r.source,r.scope,r.day].filter(Boolean).join(' · '))),
   auctionFailed?h('p',{},'竞价共振暂未读回，可点击刷新重试。'):null,
   model.blocked.length?h('p',{},'未进入作战台：'+[...new Set(model.blocked.map(r=>r.reason))].join('；')):null,
   model.candidates.some(r=>r.planMissing.length)?h('p',{},model.candidates.filter(r=>r.planMissing.length).map(r=>r.name+'：'+r.planMissing.join('、')+'未提供').join('；')):null);
  model.candidates.forEach(requestChart);
  const nextKey=model.day;
  if(ctx.api&&state.trading===true&&!auctionPending&&auctionKey!==nextKey){
   auctionKey=nextKey;auctionPending=true;
   ctx.api('/api/auction-resonance',{signal:ctx.signal,timeoutMs:5000}).then(result=>{
    if(result?.ok===false)throw new Error('auction-unavailable');
    if(!disposed){auction=result;auctionFailed=false;paint();}
   }).catch(()=>{if(!disposed){auctionFailed=true;paint();}}).finally(()=>{auctionPending=false;});
  }
 }
 ctx.onState?.(paint);ctx.onSelection?.(()=>{if(lastModel)paint();});paint();return {element:host,paint};
}
