import {h,button,format,money,dateTime,updateReadout,table} from './ui.js';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const list=value=>Array.isArray(value)?value:[];
const score=value=>finite(value)?format(value,1):'缺数据';
const ic=value=>finite(value)?format(value,3):'缺数据';
const templateStatus=value=>({'related-existing-rules':'已有相关战法','implemented-evidence-evaluator':'证据核验已接入',
 'missing-catalog-rules':'缺少对应战法目录'})[value]||'等待专项证据';
const templateEvidence=value=>({'observed-unvalidated':'已有原始条件记录，尚未通过样本外认证','missing-original-checks':'缺少原战法逐项核验记录',
 'missing-evidence':'缺少必要原始依据','conditions-failed':'当前原始条件未通过','missing-data':'样本数据不足','no-matching-observation':'尚无匹配观察'})[value]||'证据尚未齐备';
const historyStatus=row=>row?.status==='missing-dependency'?'BaoStock Python 依赖未安装'+(row.reason?' · '+row.reason:''):
 row?.reason||({'captured':'已采集原始回执','observed':'已取得原始记录','unavailable':'来源暂不可用','failed':'本次采集失败','source-failed':'供应商采集失败','empty':'供应商返回记录为空'})[row?.status]||row?.status||'结果未确认';
const sourceLine=value=>[value?.source,value?.knownAt||value?.sourceAt?dateTime(value.knownAt||value.sourceAt):null].filter(Boolean).join(' · ');
const svgNode=(name,attrs={})=>{
 const node=document.createElementNS('http://www.w3.org/2000/svg',name);
 for(const [key,value]of Object.entries(attrs))node.setAttribute(key,String(value));
 return node;
};
const label=(svg,x,y,text,attrs={})=>{const node=svgNode('text',{x,y,...attrs});node.textContent=text;svg.append(node);return node;};
const detail=(title,children,id)=>h('details',{class:'fy-details',...(id?{id}: {})},h('summary',{},title),children);
const paragraph=text=>h('p',{class:'fy-muted'},text);
const panel=(title,...children)=>h('section',{class:'fy-intelligence-panel'},h('h3',{},title),...children);

// Recursive partitions conserve area exactly. No missing or small security is
// replaced with a fabricated "other" value, and labels never determine area.
export function marketRectangles(items,{x=0,y=0,width=960,height=420}={}){
 const rows=list(items).filter(row=>finite(row.marketCapYuan)&&row.marketCapYuan>0);
 const output=[];
 function partition(values,x,y,width,height){
  if(!values.length)return;
  if(values.length===1){output.push({...values[0],x,y,width,height});return;}
  const total=values.reduce((sum,row)=>sum+row.marketCapYuan,0);
  let split=1,left=values[0].marketCapYuan;
  while(split<values.length-1&&Math.abs(total/2-(left+values[split].marketCapYuan))<Math.abs(total/2-left)){
   left+=values[split++].marketCapYuan;
  }
  const fraction=left/total;
  if(width>=height){
   partition(values.slice(0,split),x,y,width*fraction,height);
   partition(values.slice(split),x+width*fraction,y,width*(1-fraction),height);
  }else{
   partition(values.slice(0,split),x,y,width,height*fraction);
   partition(values.slice(split),x,y+height*fraction,width,height*(1-fraction));
  }
 }
 partition(rows,x,y,width,height);return output;
}

export function marketHeatmap(data,ctx){
 const items=list(data?.items);
 if(!items.length)return paragraph(data?.note||'缺少同日的总市值、涨跌幅与行情时点。');
 const svg=svgNode('svg',{viewBox:'0 0 960 420',role:'img','aria-label':'全市场总市值与涨跌热力图'});
 for(const cell of marketRectangles(items)){
  const color=cell.pct>0?'#d1658f':cell.pct<0?'#348b79':'#73637c';
  const group=svgNode('g',{'data-code':cell.code,'data-observation':JSON.stringify(cell)});
  const rect=svgNode('rect',{x:cell.x,y:cell.y,width:cell.width,height:cell.height,fill:color,stroke:'#21162d','stroke-width':.5});
  const title=svgNode('title');
  title.textContent=cell.name+' '+cell.code+' · '+format(cell.pct)+'% · 总市值 '+money(cell.marketCapYuan)+'元 · '+sourceLine(cell);
  rect.append(title);group.append(rect);
  if(cell.width>65&&cell.height>26){
   const clipId='fy-map-'+cell.code;
   const clip=svgNode('clipPath',{id:clipId});clip.append(svgNode('rect',{x:cell.x+3,y:cell.y,width:cell.width-6,height:cell.height}));
   group.append(clip);
   label(group,cell.x+cell.width/2,cell.y+cell.height/2-2,cell.name,{'text-anchor':'middle','font-size':12,fill:'#fff','clip-path':'url(#'+clipId+')'});
   if(cell.height>40)label(group,cell.x+cell.width/2,cell.y+cell.height/2+14,format(cell.pct)+'%',{'text-anchor':'middle','font-size':11,fill:'#fff'});
  }
  group.addEventListener('click',event=>{
   // updateReadout retains keyed SVG nodes; read the current attributes rather
   // than closing over yesterday's row on a subsequent refresh.
   const current=JSON.parse(event.currentTarget.getAttribute('data-observation'));
   ctx.selectStock?.(current.code,{...current,poolDay:current.day,quoteSource:current.source,receivedAt:current.knownAt,canTrade:false});
  });
  svg.append(group);
 }
 return h('figure',{class:'fy-market-map'},svg,h('figcaption',{},data.scope+' · '+items.length+' 只 · 面积＝总市值，红涨绿跌'),
  detail('查看逐股数字、来源与时点',table([
   {label:'股票',value:r=>button(r.name+' '+r.code,()=>ctx.selectStock?.(r.code,{...r,poolDay:r.day,quoteSource:r.source,receivedAt:r.knownAt}),'quiet')},
   {label:'总市值（元）',value:r=>money(r.marketCapYuan)},{label:'涨跌',value:r=>format(r.pct)+'%'},{label:'原始来源与时点',value:sourceLine}
  ],items)));
}

export function nineAxisRadar(data){
 const axes=list(data?.axes),cx=160,cy=132,radius=85;
 if(axes.length!==9)return paragraph('九维评分未返回；缺失值不补零。');
 const svg=svgNode('svg',{viewBox:'0 0 320 272',role:'img','aria-label':'个股九维证据雷达'});
 const point=(i,r)=>({x:cx+Math.sin(i*Math.PI*2/9)*r,y:cy-Math.cos(i*Math.PI*2/9)*r});
 for(const size of [.25,.5,.75,1])svg.append(svgNode('polygon',{points:axes.map((_,i)=>{const p=point(i,radius*size);return p.x+','+p.y;}).join(' '),fill:'none',stroke:'#493451','stroke-width':1}));
 const scores=[];
 axes.forEach((axis,i)=>{
  const end=point(i,radius),caption=point(i,radius+24);
  svg.append(svgNode('line',{x1:cx,y1:cy,x2:end.x,y2:end.y,stroke:'#493451','stroke-dasharray':'3 3'}));
  label(svg,caption.x,caption.y,axis.label,{'text-anchor':'middle','dominant-baseline':'middle','font-size':11,fill:'#d8c5e0'});
  if(finite(axis.value)&&axis.value>=0&&axis.value<=100){
   const p=point(i,radius*axis.value/100);scores.push(p.x+','+p.y);
   svg.append(svgNode('circle',{cx:p.x,cy:p.y,r:3.5,fill:'#f1a4cd'}));
  }
 });
 if(scores.length===9)svg.append(svgNode('polygon',{points:scores.join(' '),fill:'#d87db326',stroke:'#ef9fc9','stroke-width':1.5}));
 return h('div',{class:'fy-nine-radar','data-code':data.code,'data-day':data.day},svg,
  paragraph((data.name||data.code)+' · '+data.day+' · '+data.known+'/9 维有证据。'+data.note),
  detail('九维评分与依据',h('dl',{},axes.map(axis=>h('div',{},h('dt',{},axis.label+' · '+score(axis.value)),h('dd',{},axis.reason,
   axis.formula?paragraph('计算规则：'+axis.formula):null,
   ...(list(axis.sourceTimes).length?axis.sourceTimes.map(item=>paragraph(sourceLine(item))):[paragraph(sourceLine(axis))])))))));
}

function flowSankey(data){
 const links=list(data?.links);
 if(!links.length)return h('div',{},paragraph(data?.note||'缺少可追溯的真实资金去向明细。'),
  list(data?.netObservations).length?detail('已取得的板块净额 · 不代表跨板块转移',h('div',{},
   paragraph('净流入、净流出分别列示；没有来源与去向对应记录时不生成桑基连线。'),table([
    {label:'板块',value:r=>r.name},{label:'主力净额（元）',value:r=>money(r.value)},
    {label:'资金归属日',value:r=>r.day||'供应商未提供'},
    {label:'原始来源与时点',value:r=>r.source+' · '+(r.sourceAt?dateTime(r.sourceAt):'资金源端时点缺失')+' · 取得于 '+dateTime(r.knownAt)}
   ],data.netObservations))):paragraph('尚无带人民币单位、来源和实际取得时点的板块净额。'));
 const total=links.reduce((sum,row)=>sum+row.amount,0),left=new Map(),right=new Map();
 if(!finite(total)||total<=0)return paragraph('资金流向金额缺失。');
 for(const row of links){left.set(row.from,(left.get(row.from)||0)+row.amount);right.set(row.to,(right.get(row.to)||0)+row.amount);}
 const height=Math.max(300,Math.max(left.size,right.size)*34),gap=12;
 const scale=(height-40-Math.max(left.size-1,right.size-1)*gap)/total;
 const layout=map=>{let y=20;return new Map([...map].map(([name,amount])=>{const value={name,amount,y,height:amount*scale,used:0};y+=value.height+gap;return [name,value];}));};
 const sources=layout(left),targets=layout(right),svg=svgNode('svg',{viewBox:'0 0 800 '+height,role:'img','aria-label':'有原始来源与去向的资金桑基图'});
 for(const row of links){
  const from=sources.get(row.from),to=targets.get(row.to),width=row.amount*scale,a=from.y+from.used+width/2,b=to.y+to.used+width/2;
  from.used+=width;to.used+=width;
  const line=svgNode('path',{d:'M 180 '+a+' C 340 '+a+', 460 '+b+', 620 '+b,fill:'none',stroke:'#d986b166','stroke-width':width});
  const title=svgNode('title');title.textContent=row.from+' → '+row.to+' · '+money(row.amount)+'元 · '+sourceLine(row);line.append(title);svg.append(line);
 }
 for(const [side,nodes]of [[0,sources],[1,targets]])for(const node of nodes.values()){
  const x=side?620:172;svg.append(svgNode('rect',{x,y:node.y,width:8,height:node.height,fill:side?'#8db8ba':'#ee9ec8'}));
  label(svg,side?636:164,node.y+node.height/2,node.name,{'text-anchor':side?'start':'end','dominant-baseline':'middle','font-size':12,fill:'#e8d7ee'});
 }
 return h('figure',{class:'fy-flow-sankey'},svg,h('figcaption',{},data.note),detail('资金流向原始金额与来源',
  table([{label:'来源',value:r=>r.from},{label:'去向',value:r=>r.to},{label:'金额（元）',value:r=>money(r.amount)},{label:'证据',value:sourceLine}],links)));
}

function emotionCycle(data){
 const steps=['冰点','回暖','高潮','退潮'];
 return h('div',{class:'fy-emotion-cycle'},h('ol',{},steps.map(name=>h('li',{'data-active':String(data?.phase===name)},name))),
  paragraph(data?.phase?data.phase+' · '+data.day+' · '+sourceLine(data):data?.note||'缺少多日情绪周期证据'));
}

function evidenceDetails(label,value){
 return detail(label,h('pre',{class:'fy-intelligence-evidence'},JSON.stringify(value,null,2)));
}
function feedbackValidation(report,ctx){
 const feedback=report.feedback||{},bridge=feedback.validationBridge||{},status=paragraph('');
 const ready=bridge.ready===true&&/^[a-f0-9]{64}$/.test(feedback.proposalFingerprint||'')&&Number.isSafeInteger(feedback.archiveRevision)&&feedback.archiveRevision>=0;
 status.dataset.feedbackStatus='true';
 const submit=button('验证本次反馈提案',async event=>{
  // updateReadout retains the visible DOM nodes across report refreshes. Use
  // that live control/status, not the detached nodes used to build this view.
  const liveButton=event.currentTarget,container=liveButton.closest('[data-feedback-validation]'),liveStatus=container?.querySelector('[data-feedback-status]');
  const current=()=>!ctx.signal?.aborted&&container?.isConnected&&container.dataset.proposalFingerprint===(feedback.proposalFingerprint||'')&&
   container.dataset.archiveRevision===String(feedback.archiveRevision??'');
  if(!ready||liveButton.disabled||!liveStatus||!current())return;
  liveButton.disabled=true;liveStatus.textContent='正在用原研究档案复算并验证本次提案…';
  try{
   const response=await ctx.api('/api/decision-center/feedback',{method:'POST',signal:ctx.signal,timeoutMs:60000,
    body:{day:report.day,revision:feedback.archiveRevision,proposalFingerprint:feedback.proposalFingerprint}});
   if(!current())return;
   if(response?.ok!==true||!response.result?.candidateId)throw Error(response?.error||'未取得原验证流程回执');
   const result=response.result;
   liveStatus.textContent='原验证结果：'+(typeof result.status==='string'?result.status:'结果状态未返回')+'。请在验证与审批中核对五项结果及审批记录。';
   liveStatus.dataset.candidateId=result.candidateId;
   ctx.notify?.('中心提案已进入原验证流程，生产权重尚未改变。','info');
  }catch(error){if(!current())return;liveStatus.textContent=error.message+'；刷新中心证据后重试。';}
 },'primary');
 submit.disabled=!ready;
 return h('div',{'data-feedback-validation':true,'data-proposal-fingerprint':feedback.proposalFingerprint||'','data-archive-revision':feedback.archiveRevision??''},paragraph(bridge.note||'反馈沿用原验证与批准流程。'),
  !ready?paragraph('暂不能提交：'+(list(bridge.missing).join('；')||'缺少可核对的中心提案、档案版本或指纹。')):null,
  h('div',{class:'fy-inline'},submit,button('查看验证与审批',()=>ctx.navigate('lab','shortline-versions'),'quiet')),status);
}
function probabilityResearchPanel(value){
 const valid=value?.schemaVersion===1&&value.mode==='fayo-probability-journal-v1'&&value.scope==='formal'&&
  value.canTrade===false&&value.canApprove===false&&value.calibrationCertified===false&&value.productionWeightsChanged===false;
 const rows=valid?list(value.plans):[];
 const names={'missing-evidence':'尚无事前登记的正式概率研究','unavailable':'概率研究存证不可用',
  'observed-private-research-history':'已读取正式研究存证','collecting-preregistered-evidence':'按事前窗口积累证据',
  'awaiting-one-time-evaluation':'窗口已结束，等待一次性封存评价','descriptive-holdout-evaluated':'独立窗口描述性结果',
  'source-version-only-diagnostic':'源码版本诊断，仍缺模型参数血缘',
  'insufficient-or-incomplete-evidence':'成熟样本或覆盖不足','fixture-only':'仅为测试数据'};
 const metricRows=metrics=>[
  {label:'校准期原估计',...metrics.calibration},{label:'保留期原估计',...metrics.validationRaw},
  {label:'保留期校准映射',...metrics.validationCalibrated}];
 return panel('L2 · 概率可靠性存证',
  paragraph(valid?(names[value.status]||'研究状态待核对'):'尚无可读取的正式概率研究存证'),
  paragraph('当日封板、次日封板、次日上涨、次日最高涨幅与成交后净盈利分别验证。规则分不参与概率校准；未到固定窗口终点不展示保留集指标。'),
  valid?paragraph('已登记 '+(value.registeredPlans??'未知')+' 项 · 原冻结预测 '+(value.predictions??'未知')+' 条 · 已记录标签 '+(value.outcomes??'未知')+' 条'):null,
  valid&&value.trials?paragraph('本概率研究档案的试验额度：已用 '+value.trials.usedTrials+' / '+value.trials.maxTrials+'；拒绝的请求 '+value.rejectedAttempts+' 次。失败评价同样保留。'):null,
  ...rows.map(row=>detail((row.targetLabel||'事件目标待核对')+' · '+(row.modelVersion||'模型版本待核对'),h('div',{},
   paragraph(names[row.status]||'结果尚未确认'),paragraph(row.reason||'证据不足时不认证概率'),
   paragraph('登记 '+dateTime(row.registeredAt)+'；保留期 '+dateTime(row.validationStartAt)+' 至 '+dateTime(row.validationEndAt)),
   paragraph('冻结 '+(row.coverage?.frozenPredictions??'未知')+' 条 · 标签 '+(row.coverage?.recordedOutcomes??'未知')+' 条 · 记录覆盖 '+
    (finite(row.coverage?.fraction)?format(row.coverage.fraction*100,1)+'%':'未知')+'（记录覆盖不等于合格标签覆盖）'),
   row.metrics?table([{label:'样本阶段',value:r=>r.label},{label:'样本/信号日',value:r=>(r.samples??'未知')+' / '+(r.days??'未知')},
    {label:'Brier 分数',value:r=>finite(r.brier)?format(r.brier,4):'未评价'},
    {label:'对数损失',value:r=>finite(r.logLoss)?format(r.logLoss,4):'未评价'},
    {label:'分箱校准误差',value:r=>finite(r.ece)?format(r.ece*100,2)+'%':'未评价'}],metricRows(row.metrics)):null,
   row.metrics?paragraph(row.metrics.comparisonOnIdenticalRows===true?'原估计和校准映射使用相同保留集；这仍是描述性研究结果。':'原估计与校准映射的合格样本不完整，不能据此比较改进。'):null,
   row.metrics?detail('可靠性分箱与按日敏感性',h('div',{},
    paragraph('分箱中的平均模型估计与实际事件频率分别展示。按日留一 Brier 范围是敏感性检查，不是置信区间。'),
    table([{label:'预测区间',value:r=>format(r.lower*100,0)+'%–'+format(r.upper*100,0)+'%'},
     {label:'样本/信号日',value:r=>r.samples+' / '+r.days},
     {label:'平均模型估计',value:r=>finite(r.meanPrediction)?format(r.meanPrediction*100,2)+'%':'无样本'},
     {label:'历史事件频率',value:r=>finite(r.observedFrequency)?format(r.observedFrequency*100,2)+'%':'无样本'}],list(row.metrics.validationRaw?.curve)),
    evidenceDetails('排除、覆盖与敏感性原始统计',row.metrics))):null))),
  paragraph('当前无已认证的生产概率。独立来源、训练截止和真实成熟效果尚需原实例验证；净盈利标签须能唯一关联原成交及费用。'));
}
function researchPanels(report,ctx){
 const q=report.quality||{},f=report.factors||{},w=report.walkforward||{},feedback=report.feedback||{},templates=report.templates||{};
 const intake=report.historyIntake||{},execution=report.executionValidation||{},overall=execution.overall||{};
 const entryCosts=execution.settledEntryCosts;
 const ruleCoverage=f.ruleCoverage||{},approved=f.approvedScoring||{},automation=feedback.automation;
 const qItems=list(q.components),metrics=Object.values(f.descriptive||{}),folds=list(w.folds);
 const environmentRows=[...Object.entries(report.governance?.environments?.byRegime||{}).map(([label,row])=>({kind:'环境',label,...row})),
  ...Object.entries(report.governance?.environments?.byStrategy||{}).map(([label,row])=>({kind:'策略',label,...row}))];
 const reviewLabel=value=>({'review-redundancy':'复核冗余','review-decay':'复核关联下降','review-distribution':'复核分布变化',
  'review-coverage':'复核覆盖不足','no-review-trigger':'本次未触线','insufficient-evidence':'证据不足'})[value]||'证据待核对';
 const gateText=gate=>gate?(({hfq:'后复权',qfq:'前复权'})[gate.expectedAdjustment]||'复权口径缺失')+' · '+(gate.admittedGroups??'未知')+' 组可用 / '+(gate.excludedRecords??'未知')+' 条被排除':'缺少可验证样本';
 return [
  panel('L1 · 数据质量',h('strong',{class:'fy-intelligence-number'},finite(q.score)?'Q '+format(q.score,1):'Q 尚未完整'),
   paragraph(q.formula),h('ul',{},qItems.map(item=>h('li',{},item.label+' '+(finite(item.value)?format(item.value*100,1)+'%':'缺数据')+' · 权重 '+format(item.weight*100,0)+'%'))),
   paragraph(q.note),paragraph('看盘：'+gateText(q.gates?.display)+'；回测：'+gateText(q.gates?.backtest)),
   paragraph('原始历史采集：'+(Array.isArray(intake.codes)?intake.codes.length+' 只股票':finite(intake.codes)?intake.codes+' 只股票':'股票范围未确认')+' · '+
    (finite(intake.admittedRows)?intake.admittedRows+' 条通过核验':'尚无通过核验的后复权样本')),
   list(intake.missing).length?paragraph('仍缺：'+intake.missing.join('、')):null,
   list(intake.sourceStatus).length?detail('后复权原始来源与采集回执',table([
    {label:'股票/交易日',value:r=>r.code+' · '+(r.day||'归属日未提供')},{label:'来源',value:r=>r.source},
    {label:'实际取得',value:r=>r.receivedAt?dateTime(r.receivedAt):'未取得回执'},
    {label:'状态与缺项',value:historyStatus}],intake.sourceStatus)):null,
   evidenceDetails('历史采集、排除与修订冲突',intake),
   report.historySupply?detail('后复权历史采集依据',h('div',{},
    paragraph('已留存 '+(finite(report.historySupply.receipts)?report.historySupply.receipts:'数量未知')+' 份原始回执 · '+
     (finite(report.historySupply.rows)?report.historySupply.rows:'数量未知')+' 条日线 · '+list(report.historySupply.sources).join('、')),
    paragraph(report.historySupply.note||'尚无独立后复权回执；缺少来源和时点时不进入研究样本。'),
    paragraph('缺项：'+(list(report.historySupply.missing).join('；')||'请以逐源核验结果为准')),
    evidenceDetails('采集时间、来源与隔离记录',report.historySupply))):null,
   evidenceDetails('逐源偏离、拒绝原因与原始时点',q)),
  panel('L2 · 因子有效性与去冗余',paragraph('原战法目录 '+(f.catalogRules??'未知')+' 项 · 已有量化观测 '+(f.measuredFactors??'未知')+' 项 · 对齐样本 '+(f.alignedSamples??'未知')+' 条'),
   paragraph('完整规则观察 '+(ruleCoverage.fullPanelChecks??'未知')+' 批 · 历史部分观察 '+(ruleCoverage.legacyPartialChecks??'未知')+' 批 · 未通过校验 '+(ruleCoverage.invalidPanels??'未知')+' 批'),
   list(ruleCoverage.rules).length?detail('逐项查看原 95 项规则覆盖',table([
    {label:'规则',value:r=>r.factorId+' · '+r.name},{label:'已记录',value:r=>r.recordedChecks},
    {label:'可量化',value:r=>r.measuredChecks},{label:'证据不足',value:r=>r.unknownChecks},
    {label:'缺失条件',value:r=>r.missingConditions}],ruleCoverage.rules)):null,
   paragraph(f.label||'t 日因子预测 t+1 起收益；缺真实样本时不生成 IC。'),paragraph(f.note),
   metrics.length?table([{label:'因子',value:r=>r.factorId||r.id},{label:'平均 IC',value:r=>ic(r.meanIC)},{label:'有效交易日',value:r=>r.days??r.icDays??'缺数据'}],metrics):paragraph('尚无满足时点、复权与跨源核验要求的因子 IC。'),
   evidenceDetails('正交参数、相关性与因子原始统计',{orthogonalization:f.orthogonalization,redundancy:f.redundancy,descriptive:f.descriptive,rejectionReasons:f.rejectionReasons}),
   detail('获批数值模型与下一交易日评分',h('div',{},
    paragraph(approved.modelVersion?'原批准版本 V'+approved.modelVersion+' · 批准于 '+dateTime(approved.approvedAt):'尚无通过原五项验证并人工批准的数值模型'),
    paragraph('原观察日 '+(approved.day||'未返回')+'；分数沿用训练净收益模型尺度，与首页精选分分别展示。缺因子定义、批准时点或原日历时不参与候选排序。'),
    list(approved.rows).length?table([
     {label:'标的',value:r=>r.code},{label:'信号日 → 目标日',value:r=>(r.signalDay||r.day||'未知')+' → '+(r.targetDay||'未知')},
     {label:'模型分',value:r=>finite(r.score)?format(r.score,4):'缺数据'},
     {label:'依据',value:r=>r.eligibleForNextSession===true?'时点与同定义观察已核对':list(r.missing).join('；')||'尚无完整依据'}],approved.rows):paragraph('没有与该批准版本匹配的完整当日观察'),
    evidenceDetails('模型定义、训练截止与原始观察时点',approved)))),
  panel('L2 · 滚动样本外验证',paragraph('已形成 '+folds.filter(fold=>fold.status==='evaluated').length+' 个可核验窗口；训练、验证、测试之间保留隔离交易日。'),
   paragraph(w.note||'使用后复权价格与真实日历；训练参数冻结后才应用到验证、测试。'),
   ...folds.map((fold,i)=>detail('窗口 '+(i+1)+' · '+fold.status,evidenceDetails('日期、IC 与分层结果',fold))),
   evidenceDetails('样本、日期交集与窗口依据',{alignment:report.crossMarket,coverage:report.coverage,walkforward:w})),
  panel('L2 · 原账本执行与成本压力',
   paragraph('已接收 '+(execution.acceptedTrades??'未知')+' 笔 · 标准样本 '+(execution.standardTrades??'未知')+' 笔 · 隔离或排除 '+(execution.excludedCount??'未知')+' 笔'),
   paragraph('依据已核对的模拟成交流水评估费用与滑点压力；尚无连续账户权益证据时，不生成账户最大回撤。'),
   entryCosts?detail('买入决策价与已结算成交',h('div',{},
    paragraph('有事前报价 '+entryCosts.withBenchmark+' / '+entryCosts.standardSettlements+' 笔标准结算，覆盖 '+(entryCosts.matchedShares??'未知')+' 股。'),
    entryCosts.withBenchmark?paragraph('已成交买入价差 '+money(entryCosts.entryPriceDifferenceCny)+' 元，分摊买入费用 '+money(entryCosts.matchedEntryFeesCny)+' 元，合计 '+money(entryCosts.filledEntryShortfallCny)+' 元。正价差表示买入价高于决策价。'):paragraph('尚无可核对的事前买入报价与成交配对。'),
    paragraph('卖出决策价差、未成交机会成本及价差中的等待和冲击成本均待独立证据。'))):null,
   (overall.scenarios?.[0]?.entryPriceEvidence?.fifoAllocationNotReplayed||0)>0?
    paragraph('其中 '+overall.scenarios[0].entryPriceEvidence.fifoAllocationNotReplayed+' 笔含高精度价格的历史FIFO分摊，仅保留原费用与净额勾稽；缺完整批次分摊链，不作为模型升级充分证据。'):null,
   list(overall.scenarios).length?table([
    {label:'费用倍数',value:r=>score(r.feeMultiplier)},{label:'滑点（基点）',value:r=>score(r.slippageBps)},
    {label:'有效成交',value:r=>r.trades??'缺数据'},{label:'平均净收益',value:r=>finite(r.meanTradeNetReturnPct)?format(r.meanTradeNetReturnPct)+'%':'缺数据'},
    {label:'样本盈利频率',value:r=>finite(r.winRatePct)?format(r.winRatePct)+'%':'缺数据'},
    {label:'净盈亏（元）',value:r=>finite(r.netPnlCny)?money(r.netPnlCny):'缺数据'}],overall.scenarios):paragraph('尚无满足原账本、计划、交易时点及成本核验要求的执行样本。'),
   paragraph('成本压力：'+(overall.costStressPassed===true?'已通过当前样本检验':overall.costStressPassed===false?'当前样本未通过':'证据不足')+
    '；单笔风险：'+(overall.individualRiskPassed===true?'已通过当前样本检验':overall.individualRiskPassed===false?'当前样本未通过':'证据不足')),
   evidenceDetails('原始样本、分环境结果与风险边界',execution)),
  panel('L2 · 策略健康与模型治理',
   paragraph('研究诊断不改变原生产参数。独立样本、连续权益或执行依据不足时保持未验证。'),
   paragraph('衰减线索：'+((report.governance?.decay?.reasons||[]).map(r=>r.meaning).join('；')||'尚无可用衰减诊断')),
   list(report.governance?.factors).length?detail('同口径因子体检',table([
    {label:'因子',value:r=>r.factorId},{label:'训练 IC',value:r=>ic(r.trainingIC)},
    {label:'时间外 IC',value:r=>ic(r.validationIC)},{label:'样本外 IC',value:r=>ic(r.holdoutIC)},
    {label:'样本外交易日',value:r=>r.holdoutDays},{label:'覆盖',value:r=>finite(r.coverage)?format(r.coverage*100,1)+'%':'缺数据'},
    {label:'冗余',value:r=>r.redundantWith||'未确认'},{label:'复核状态',value:r=>reviewLabel(r.reviewCandidate)}],report.governance.factors)):null,
   detail('当前模型与前瞻候选对照',h('div',{},paragraph('原批准版本 '+(report.governance?.modelComparison?.currentVersion??'未知')+' · 已结算配对 '+(report.governance?.modelComparison?.pairedRows??'未知')+' 条 · '+(report.governance?.modelComparison?.descriptiveGain===true?'已结算队列有描述性增益':'增益未建立')),
    paragraph('未成交、未平仓与无效引用计入覆盖缺口。完整队列、固定试验收口与原风险回执未齐时保留当前版本。'),
    paragraph('升级证据：'+(report.governance?.modelComparison?.approvalEligible===true?'满足本次证据合同，仍需原五关及人工批准':'尚未齐备')),
    evidenceDetails('原模型版本、费用压力与逐日对照',report.governance?.modelComparison||{}))),
   detail('原市场环境与适用范围',h('div',{},
    paragraph('沿原冻结计划的环境与策略标签分组。不同分组不是同一队列的因果对照，也不改变原风险阈值。'),
    environmentRows.length?table([{label:'分组',value:r=>r.kind+' · '+r.label},{label:'结算样本',value:r=>r.samples??'未知'},
     {label:'平均结算净收益',value:r=>finite(r.netReturnPct)?format(r.netReturnPct,3)+'%':'未知'},
     {label:'成本压力',value:r=>r.costStressPassed===true?'该组样本通过':r.costStressPassed===false?'该组样本未通过':'证据不足'}],environmentRows):paragraph('尚无可核对的同环境原结算样本。'),
    evidenceDetails('环境、情绪与适用范围原始统计',report.governance?.environments||{}))),
   evidenceDetails('费用、净结算与尚未归因项目',report.governance?.executionAttribution||{}),
   paragraph('规则分不是概率；历史频率与模型事件估计分别标注。无独立校准认证不得显示为可信概率。'),
   evidenceDetails('概率展示合同',report.governance?.probability||{})),
  probabilityResearchPanel(report.governance?.probabilityResearch),
  panel('L2 · 六类战法模板',h('ul',{},list(templates.groups).map(group=>h('li',{},h('strong',{},group.name||group.label),
    ' · '+templateStatus(group.status),paragraph(templateEvidence(group.evidenceStatus)+' · 原条件观察 '+(group.observationCount??list(group.observations).length)+' 条'),
    paragraph(group.note||group.missing?.join('；')||'沿用原战法条件与校验')))),
   paragraph(templates.scope),evidenceDetails('战法条件与已观察次数',templates)),
  panel('L5 · 复盘反馈',paragraph('成熟复盘 '+(feedback.matureTrades??'未知')+' 条 · 因子调整候选 '+list(feedback.candidates).length+' 条 · 数据质量复核 '+list(feedback.qualityCandidates).length+' 条'),
   paragraph('收盘后的新证据可自动送入原五项验证；版本晋级仍沿用原人工审批。'),
   automation?paragraph('自动反馈：'+(({'waiting-close':'等待收盘','disabled-or-replica':'当前节点或中心未启用',
    'missing-calendar':'缺原交易日历','missing-session':'原市场时钟未对齐','reading':'正在读取原证据',
    'insufficient-evidence':'证据不足','awaiting-approval':'已有候选等待人工审批','duplicate-proposal':'本次提案已有验证回执',
    'submitted':'已送原验证','validation-rejected':'原验证拒绝','unavailable':'本次证据暂不可用','backoff':'等待下次有界复核',
    'daily-limit':'今日复核额度已用完'})[automation.status]||'状态尚未确认')+(automation.lastResult?.validationStatus?' · '+automation.lastResult.validationStatus:'')+
    (automation.lastResult?.recordedAt?' · 回执 '+dateTime(automation.lastResult.recordedAt):'')):paragraph('后台反馈调度尚未返回状态'),
   list(automation?.missing).length?paragraph('缺项：'+automation.missing.join('；')):null,
   feedbackValidation(report,ctx),evidenceDetails('复盘依据与候选变更',feedback))
 ];
}

export function createIntelligenceCenter(ctx){
 const status=h('p',{class:'fy-muted',role:'status'}),charts=h('div',{class:'fy-intelligence-charts'}),research=h('div',{class:'fy-intelligence-research'});
 const host=detail('智能处理中心 · 数据质量、市场图谱与复盘反馈',
  h('div',{class:'fy-intelligence-body'},h('div',{class:'fy-inline'},paragraph('按需读取真实证据'),button('刷新中心证据',()=>load(true),'quiet')),status,charts,research),'fy-intelligence-center');
 host.classList.add('fy-intelligence-center');
 let generation=0,loading=false,loaded=false;
 const active=()=>!ctx.signal?.aborted;
 async function load(force=false,retainedVisual=null){
  if(!active()||loading||loaded&&!force)return;
  loading=true;const turn=++generation,selection=ctx.decisionSelection;
  status.textContent='正在读取市场原始图谱与研究档案…';
  const query=selection?new URLSearchParams({code:selection.code,day:selection.day}):new URLSearchParams();
  const tasks=[retainedVisual?Promise.resolve(retainedVisual):ctx.api('/api/decision-center/visuals?'+query,{signal:ctx.signal,timeoutMs:15000}),
   ctx.canEdit?ctx.api('/api/decision-center/research',{signal:ctx.signal,timeoutMs:45000}):Promise.resolve(null)];
  const results=await Promise.allSettled(tasks);
  if(!active()||turn!==generation)return;
  loading=false;loaded=true;
  const visual=results[0].status==='fulfilled'?results[0].value:null;
  const validVisual=visual?.ok===true&&visual.authority==='fayo-intelligence-visuals'&&(!selection||visual.day===selection.day&&visual.radar?.code===selection.code);
  if(validVisual){
   if(!retainedVisual)updateReadout(charts,panel('市场情绪周期',emotionCycle(visual.emotion)),panel('个股九维雷达',nineAxisRadar(visual.radar)),
    panel('全市场热力图',marketHeatmap(visual.heatmap,ctx)),panel('资金桑基图',flowSankey(visual.sankey)));
  }else updateReadout(charts,paragraph(visual?.error||'市场图谱尚未取得同日、可核实的源数据。'));
  const result=results[1].status==='fulfilled'?results[1].value:null,report=result?.result;
  if(report?.authority==='fayo-intelligence-research'&&result.ok===true){
   updateReadout(research,...researchPanels(report,ctx));status.textContent='研究日 '+report.day+' · 计算于 '+dateTime(report.generatedAt)+' · 研究结果不授予交易权限';
  }else{
   const failure=results[1].status==='rejected'?results[1].reason?.body:result;
   if(ctx.canEdit&&failure?.code==='WORKSPACE_BUSY'){
    updateReadout(research,paragraph('研究队列正忙。'),button('重试研究档案',()=>{
     if(turn===generation)void load(true,validVisual?visual:null);
    },'quiet'));
   }else updateReadout(research,paragraph(ctx.canEdit?'研究档案未能读取，缺少结果不会填成零分。':'研究档案沿用原编辑身份权限。'));
   status.textContent=visual?.day?'市场数据日 '+visual.day:'数据证据尚未齐备';
  }
 }
 host.addEventListener('toggle',()=>{if(host.open)void load();});
 ctx.onDecisionSelection?.(()=>{loaded=false;if(host.open){generation++;loading=false;void load();}});
 return host;
}

export function createDrawerRadar(ctx,current){
 const status=h('div'),host=detail('个股九维雷达',status,'fy-drawer-radar');
 let turn=0,lastKey='';
 async function load(){
  const selected=current(),key=selected.code+':'+selected.day;
  if(!host.open||!selected.code||key===lastKey)return;
  const request=++turn;updateReadout(status,paragraph('正在读取同股、同日评分依据…'));
  try{
   const value=await ctx.api('/api/decision-center/visuals?'+new URLSearchParams({section:'radar',code:selected.code,day:selected.day}),{signal:ctx.signal,timeoutMs:12000});
   const latest=current();
   if(request!==turn||ctx.signal?.aborted||latest.code+':'+latest.day!==key)return;
   if(value?.ok!==true||value.authority!=='fayo-intelligence-visuals'||value.radar?.code!==selected.code||value.day!==selected.day)throw Error(value?.error||'雷达股票或日期与所选计划不一致。');
   lastKey=key;updateReadout(status,nineAxisRadar(value.radar));
  }catch(error){if(request===turn&&!ctx.signal?.aborted)updateReadout(status,paragraph(error.message));}
 }
 host.addEventListener('toggle',()=>{if(host.open)void load();});
 host.refresh=()=>{const selected=current();if(lastKey&&lastKey!==selected.code+':'+selected.day){lastKey='';turn++;updateReadout(status,paragraph('选择已切换，等待读取该股依据。'));}if(host.open)void load();};
 return host;
}
