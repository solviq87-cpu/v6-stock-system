import {createResearchReplay,replayTime} from './evidence-workbench.mjs';
import {h as fyNode,button as fyAction} from './ui.js';
/* FAYO research workbenches. Native modules; no legacy DOM, styles or controllers. */
import {renderRecords} from './research-records.js';
import {quoteCrossCheckPanel} from './market.js';
import {renderManualLearning} from './operations.js';
import {renderKlineLearning} from './kline-learning-view.js';
import {researchCode,readAutomatic,automaticSummary,onResearchRead} from './automatic-research.js';
import {appendResearchExtensions} from './research-extensions.js';
import {projectNewsEvents} from './event-research.mjs';
import {renderEvolution} from './evolution-view.js';

const arr=value=>Array.isArray(value)?value:[];
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const val=value=>value===null||value===undefined||value===''?'未知':typeof value==='boolean'?(value?'是':'否'):String(value);
const number=value=>finite(value)?value.toLocaleString('zh-CN',{maximumFractionDigits:3}):'未知';
const clock=value=>{
  if(value===null||value===undefined||value==='')return '原始时间未知';
  const at=typeof value==='number'?value:typeof value==='string'?Date.parse(value):NaN;
  return Number.isFinite(at)&&at>0?new Date(at).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'原始时间未知';
};
function n(tag,text,classes){const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(classes)node.className=classes;return node;}
function append(parent,...children){for(const child of children.flat(Infinity))if(child!==null&&child!==undefined)parent.append(child instanceof Node?child:document.createTextNode(String(child)));return parent;}
function box(title,description,...children){const el=n('section',undefined,'fy-panel fy-stack');if(title)el.append(n('h2',title));if(description)el.append(n('p',description,'fy-muted'));return append(el,...children);}
function toolbar(...children){return append(n('div',undefined,'fy-toolbar'),...children);}
function field(label,input){const el=n('label',undefined,'fy-field');el.append(n('span',label),input);return el;}
function input(type='text',value='',attrs={}){const el=n('input');el.type=type;el.value=value;for(const [key,v]of Object.entries(attrs))el.setAttribute(key,String(v));return el;}
function select(options,selected=''){const el=n('select');for(const [value,label]of options){const option=n('option',label);option.value=value;el.append(option);}if(options.some(([value])=>value===selected))el.value=selected;return el;}
function btn(label,action,kind='secondary'){const el=n('button',label,'fy-button '+kind);el.type='button';if(action)el.addEventListener('click',action);return el;}
function detail(label,...children){const el=n('details',undefined,'fy-details');el.append(n('summary',label));return append(el,...children);}
function facts(values){const dl=n('dl',undefined,'fy-facts');for(const [label,value]of values){dl.append(n('dt',label),n('dd',val(value)));}return dl;}
function metrics(rows){const grid=n('div',undefined,'fy-grid');for(const [label,value]of rows){const card=n('article',undefined,'fy-metric');card.append(n('small',label),n('strong',val(value)));grid.append(card);}return grid;}
function empty(title='等待研究证据',description='选择对象或导入真实历史，再执行所需的研究操作。'){return box(title,description);}
function linked(label,url){try{const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol)||parsed.username||parsed.password)throw Error();const a=n('a',label);a.href=parsed.href;a.target='_blank';a.rel='noopener noreferrer';return a;}catch{return n('span',label);}}
function dataTable(columns,rows){const wrap=n('div',undefined,'fy-table-wrap'),table=n('table',undefined,'fy-table'),head=n('thead'),tr=n('tr'),body=n('tbody');for(const [label]of columns)tr.append(n('th',label));head.append(tr);for(const row of arr(rows)){const line=n('tr');for(const [,get]of columns){const td=n('td'),value=get(row);append(td,value instanceof Node?value:val(value));line.append(td);}body.append(line);}if(!arr(rows).length){const line=n('tr'),cell=n('td','本次没有可展示的记录，缺失不等于未命中。');cell.colSpan=columns.length;line.append(cell);body.append(line);}table.append(head,body);wrap.append(table);return wrap;}
function download(name,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=n('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
const labels={status:'状态',source:'来源',provider:'数据源',version:'版本',asOf:'证据时点',tradeDate:'交易日',date:'日期',checkedAt:'核对时间',recordedAt:'归档时间',generatedAt:'生成时间',symbol:'证券代码',code:'证券代码',name:'名称',reason:'依据',note:'说明',warning:'限制',missing:'缺失证据',errors:'错误',warnings:'待核查',coverage:'覆盖率',riskStatus:'风险状态',invalidReason:'失效原因',nextAction:'下一步',objective:'研究目标',current:'当前状态',lastRun:'上次记录',model:'模型条件',configuration:'配置',counts:'数量',conditions:'逐项条件',support:'支持',opposition:'反对',evidence:'证据',revisions:'历史版本',forwardValidation:'后续验证',newProtocolForwardValidation:'新协议验证',legacyForwardValidation:'旧协议验证',researchFollowups:'研究复访',priceEventResearch:'价格事件研究',systems:'独立策略体系',historical:'历史检验',releaseGate:'发布门禁',backtest:'回测',metrics:'研究指标',reconciliation:'核对',selectionEvidence:'选股证据',eightPointFlow:'研究闭环',publicRuleForwardAudit:'战法后续验证',total:'总数',evaluated:'已评价',matched:'已命中',independentTargetDays:'独立目标日',brier:'Brier评分',memory:'个股记忆',strategies:'策略',history:'历史',stock:'个股',hypothesis:'冻结判断',sectorRelations:'板块关联',market:'市场',sectors:'板块',summary:'摘要'};
function evidenceTree(data,depth=0){
  if(data===null||data===undefined)return n('p','尚未提供该项证据。','fy-muted');
  if(typeof data!=='object')return n('p',val(data));
  if(depth>7)return n('p','证据层级较深，可导出本次结果查看完整记录。','fy-muted');
  if(Array.isArray(data)){
    const list=n('div',undefined,'fy-stack');
    if(!data.length)return n('p','暂无记录。','fy-muted');
    for(const [i,row]of data.entries()){
      if(row&&typeof row==='object')list.append(detail(val(row.name||row.label||row.title||row.symbol||row.code||row.id||('记录 '+(i+1))),evidenceTree(row,depth+1)));
      else list.append(n('p',val(row)));
    }return list;
  }
  const el=n('div',undefined,'fy-stack'),primitive=[],complex=[];
  for(const [key,value]of Object.entries(data)){
    if(/token|password|secret|credential|cookie|bearer/i.test(key))continue;
    if(value&&typeof value==='object')complex.push([key,value]);else primitive.push([labels[key]||key,/At$|Timestamp$|decisionAt$/.test(key)?clock(value):value]);
  }
  if(primitive.length)el.append(facts(primitive));
  for(const [key,value]of complex)el.append(detail(labels[key]||key,evidenceTree(value,depth+1)));
  return el;
}
function stockRows(rows,ctx){return dataTable([
  ['研究对象',row=>btn((row.name||'')+' '+(row.symbol||row.code||''),()=>ctx.selectStock?.(row.symbol||row.code))],
  ['原始评分',row=>row.originalScore??row.score??row.candidateScore],['状态',row=>row.riskStatus||row.status||(row.tradable?'候选':'待核查')],
  ['依据',row=>row.reason||arr(row.hit).map(x=>x.text||x).join(' · ')||arr(row.signals).join(' · ')],
  ['来源日',row=>row.tradeDate||row.quoteDate||(row.quoteAt?clock(row.quoteAt):'未知')]
],rows);}
function renderReport(result,ctx){
  let r=result?.result??result?.analysis??result?.research??result;
  if(r?.research36)r=r.research36;
  const el=n('div',undefined,'fy-stack');
  if(!r||typeof r!=='object')return empty('尚无完整研究结果','本次服务未返回可核验的结果。');
  const overview=['status','tradeDate','date','source','provider','asOf','totalScanned','accepted','selected','note','reason','warning'].filter(key=>r[key]!==undefined&&r[key]!==null&&typeof r[key]!=='object').map(key=>[labels[key]||key,key==='asOf'?clock(r[key]):r[key]]);
  if(overview.length)el.append(facts(overview));
  if(r.publicReview?.day===r.tradeDate){
    const proof=r.publicReview,f=proof.facts,items=[f.tier,f.status,f.performance,f.history,...(f.patterns||[]),...(f.risks||[]),...(f.themes||[])].filter(Boolean);
    if(items.length)el.append(box('同日复盘依据',proof.day+' · '+proof.source+' · 取得 '+clock(proof.knownAt),n('p',[...new Set(items)].join(' · '))));
  }
  if(r.observations?.length)el.append(metrics(r.observations.map(o=>[o.name,o.value+' '+o.unit])));
  if(Array.isArray(r.systems))for(const sys of r.systems){
    const reasons=[...(sys.support||[]),...(sys.opposition||[])].slice(0,3).map(v=>v.label||v.reason).filter(Boolean);
    el.append(box(sys.label,sys.known+' / '+sys.total+' 项有证据',n('p',reasons.join(' · ')||'已有 '+sys.known+' 项可核对；独立结论随归档补齐。'),detail('查看逐项依据',evidenceTree(sys))));
  }
  if(r.stock&&typeof r.stock==='object'){
    const stock=r.stock,bars=arr(stock.bars),last=bars.at(-1);
    el.append(box((stock.name||'研究股票')+' '+(stock.symbol||stock.code||''),'来源、价格基准与覆盖日期独立核对。',facts([['数据源',stock.provider||stock.source],['价格基准',stock.priceBasis],['日K数量',bars.length||'未返回'],['最后交易日',last?.date||r.history?.lastDate],['档案时点',clock(stock.observedAt||r.asOf)]])));
  }
  const breadth=r.breadth||r.market?.breadth;
  if(breadth)el.append(metrics([['市场覆盖率',finite(breadth.coverage)?number(breadth.coverage*100)+'%':'未知'],['上涨 / 下跌',val(breadth.up)+' / '+val(breadth.down)],['上涨占比',finite(breadth.breadthScore)?number(breadth.breadthScore)+'%':'未知'],['市场环境',typeof r.regime==='string'?r.regime:r.regime?.regime||r.market?.regime?.regime||'待证据']]));
  if(r.systems&&!Array.isArray(r.systems)&&typeof r.systems==='object')el.append(append(n('div',undefined,'fy-grid'),...Object.entries(r.systems).map(([key,system])=>box(system?.name||({fourteen:'十四条',bazi:'八字口诀',gpt:'GPT 五策略',python:'Python 三轮'}[key]||key),val(system?.status||system?.verdict),evidenceTree(system)))));
  const m=r.metrics||r.backtest?.metrics||r.report?.metrics;
  if(m)el.append(metrics([['期末研究资产',number(m.finalEquity)],['研究收益率',finite(m.returnPct)?number(m.returnPct)+'%':'未知'],['最大回撤',finite(m.maxDrawdownPct)?number(m.maxDrawdownPct)+'%':'未知'],['已平仓笔数',m.closedTrades??'未知']]));
  const rows=r.ranked||r.items||r.candidateIntersection?.items||r.stocks;
  if(Array.isArray(rows))el.append(box('逐票研究结果','评分沿用服务端定义，缺失来源与证据不会补造。',stockRows(rows,ctx)));
  if(r.evaluations)for(const row of r.evaluations)el.append(box(row.name||row.id,val(row.status),metrics([['条件分',row.score??'未知'],['支持',arr(row.support).length],['反对',arr(row.opposition).length],['缺失',arr(row.missing).length]]),facts([['失效条件',row.invalidation]]),detail('逐项证据',evidenceTree({support:row.support,opposition:row.opposition,missing:row.missing}))));
  if(r.releaseGate)el.append(box('研究门禁',arr(r.releaseGate.blockers).join('；')||'研究检查结果不等于交易授权。',evidenceTree(r.releaseGate)));
  if(r.patternPools)el.append(box('形态研究分池','同一只股票可命中多项研究条件。',...Object.entries(r.patternPools).map(([name,list])=>detail(name+' · '+arr(list).length+'只',stockRows(list,ctx)))));
  const used=new Set(['ranked','items','stocks','stock','systems','evaluations','releaseGate','patternPools','metrics']);
  const summary=Object.fromEntries(Object.entries(r).filter(([key])=>!used.has(key)));
  el.append(detail('完整证据与检验链',evidenceTree(summary)),toolbar(btn('导出本次证据',()=>download('fayo-research-evidence.json',r))));
  return el;
}
function workbench(ctx,title,description,inputs=[]){
  const status=n('output','可查看已归档数据或运行本项研究。','fy-note');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const actions=toolbar(),output=n('div',undefined,'fy-stack'),body=box(title,description,append(n('div',undefined,'fy-grid'),...inputs),actions,status,output);
  let revision=0,edited=false;
  const current=turn=>!ctx.signal?.aborted&&turn===revision;
  function invalidate(){revision++;edited=true;status.textContent='已保留自定义输入，可运行本次研究。';}
  body.addEventListener('input',event=>{if(event.target.matches('input,select,textarea'))invalidate();});
  body.addEventListener('change',event=>{if(event.target.matches('input,select,textarea'))invalidate();});
  ctx.signal?.addEventListener('abort',()=>{revision++;output.replaceChildren();},{once:true});
  function action(label,handler,options={}){
    let fingerprint='';
    const button=btn(label,async()=>{
      const turn=++revision;button.disabled=true;if(!output.firstChild)status.textContent='研究数据加载中…';
      try{const data=await handler({current:()=>current(turn)});if(!current(turn))return;const next=JSON.stringify(data);
        if(!options.auto||next!==fingerprint||!output.firstChild){output.replaceChildren(options.render?options.render(data):renderReport(data,ctx));fingerprint=next;}
        const result=data?.result??data,rows=Array.isArray(result)?result:result?.items??result?.ranked??result?.rows;
        status.textContent=result==null||result?.status==='empty'||Array.isArray(rows)&&!rows.length?'已读取，本期没有符合条件的记录。':options.message||'已读取研究结果';}
      catch(error){if(current(turn))status.textContent=error?.name==='AbortError'?'请求已停止。':(error?.message||'请求未完成。');}
      finally{if(!ctx.signal?.aborted)button.disabled=false;}
    },options.kind||'secondary');
    if(options.editor!==false&&!['dev','developer','editor','edit','admin'].includes(ctx.role)){button.disabled=true;button.title='需要研究编辑权限，请从账户入口验证身份';}
    actions.append(button);if(options.auto)onResearchRead(ctx,()=>{if(!edited&&!button.disabled&&!body.matches(':focus-within')&&!output.querySelector('details[open]'))button.click();});return button;
  }
  return {body,output,status,actions,action,invalidate,current};
}
function importEvidence(label='选择历史证据 JSON',max=7*1024*1024){
  const file=input('file','',{accept:'.json,application/json'}),text=n('textarea');text.rows=7;text.placeholder='可粘贴完整的历史证据 JSON，保留来源和原始时间。';
  const notes=n('p','尚未导入证据。','fy-muted');
  file.addEventListener('change',()=>{notes.textContent=file.files?.[0]?file.files[0].name+' · '+Math.round(file.files[0].size/1024)+' KiB':'尚未导入证据。';});
  const element=detail('补充自己的历史资料（可选）',field(label,file),notes,detail('或粘贴完整证据',text));
  async function read(){const selected=file.files?.[0];if(selected&&selected.size>max)throw Error('证据文件超过 '+Math.round(max/1024)+' KiB，请缩小范围。');const raw=selected?await selected.text():text.value;if(!raw.trim())throw Error('请先导入实际历史证据；系统不会生成示例数据代替真实输入。');const data=JSON.parse(raw);if(!data||typeof data!=='object'||Array.isArray(data))throw Error('证据必须为 JSON 对象。');return data;}
  return {element,read,file,text,chosen:()=>!!(file.files?.length||text.value.trim())};
}
function symbolInput(ctx){return input('text',researchCode(ctx),{inputmode:'numeric',maxlength:'6',pattern:'[0-9]{6}',placeholder:'六位证券代码'});}
function symbolValue(el,optional=false){const value=el.value.trim();if(optional&&!value)return '';if(!/^\d{6}$/.test(value))throw Error('请输入六位证券代码。');return value;}
function request(ctx,path,body){return ctx.api(path,body===undefined?{signal:ctx.signal}:{method:'POST',body,signal:ctx.signal});}

function automaticMarket(ctx){
 const recovery=ctx.state?.marketRecovery,day=recovery?.referenceDay,points=recovery?.metrics||{};
 const values=[['adv','上涨家数','家'],['dec','下跌家数','家'],['upLimit','涨停','家'],['downLimit','跌停','家'],['breakRate','炸板率','%']];
 const observations=values.flatMap(([key,name,unit])=>points[key]?.date===day&&Number.isFinite(points[key].value)?[{name,value:points[key].value,unit}]:[]);
 if(observations.length)return {result:{tradeDate:day,source:'V6 收盘盘面',observations}};
 return request(ctx,'/api/research/live-market',{});
}
function desk(ctx){
  const root=n('div',undefined,'fy-stack');
  const flow=n('div',undefined,'fy-grid lab-flow');
  for(const [index,title,note,sub]of [['01','采集','保留来源和原始时点','sources'],['02','研判','独立对照四套规则','strategies'],['03','封存','保留研究版本与依据','records'],['04','验证','用未来目标日复访','learning']])flow.append(box(index+' / '+title,note,btn('进入工作台',()=>ctx.navigate('lab',sub))));
  root.append(flow);
  const coverage=input('number','',{min:'1',max:'100',step:'1',placeholder:'使用服务端默认值'}),scores=importEvidence('可选：独立市场评分证据',1024*1024);
  const w=workbench(ctx,'从市场到候选，一次串联','读取现有候选池，保留原排名；按行情、策略、风险与历史检验展开证据。',[field('最小覆盖率 %',coverage),detail('独立评分输入',scores.element)]);
  async function decisionPayload(){let payload={};if(scores.file.files?.length||scores.text.value.trim()){const input=await scores.read();for(const key of ['scores','scoreSource','scoreDate','minCoverage'])if(Object.hasOwn(input,key))payload[key]=input[key];}if(coverage.value!=='')payload.minCoverage=Number(coverage.value)/100;return payload;}
  w.action('运行决策链',async()=>request(ctx,'/api/research/decision-pipeline',await decisionPayload()),{kind:'primary',auto:true});
  w.action('只看公开市场交集',async()=>request(ctx,'/api/research/live-market',await decisionPayload()));
  w.action('读取市场宽度',()=>request(ctx,'/api/research/eastmoney-breadth',{}));
  root.append(w.body);
  const observed=importEvidence('市场观测证据',1024*1024);
  const o=workbench(ctx,'观测市场环境','自动读取盘面宽度，核对交易日、覆盖范围及来源。',[observed.element]);
  o.action('验证市场观测',async()=>observed.chosen()?request(ctx,'/api/research/observed-regime',await observed.read()):automaticMarket(ctx),{auto:true});root.append(o.body);
  return root;
}
function strategies(ctx){
  const root=n('div',undefined,'fy-stack fy-strategy-workbenches'),imported=importEvidence('四套策略的独立输入',256*1024);
  const four=workbench(ctx,'规则交叉检验','自动读取当前研究标的，逐项显示四套规则的依据。',[imported.element]);
  four.action('对照四套规则',async()=>{if(imported.chosen())return request(ctx,'/api/research/rule-comparison',await imported.read());const x=await readAutomatic(ctx);return {result:{...automaticSummary(x),systems:x.systems}};},{kind:'primary',auto:true});
  root.append(four.body);
  const code=symbolInput(ctx),file=importEvidence('可选：36 项规则证据',256*1024),catalog=n('div',undefined,'fy-grid');let config={};
  const study=workbench(ctx,'战法实验台','修改本次研究阈值与权重，保留生产参数。缺少证据的条件保持未知。',[field('研究股票',code),file.element]);
  study.body.insertBefore(catalog,study.actions);
  study.action('当前标的规则结果',async()=>{const x=await readAutomatic(ctx,symbolValue(code,true)||undefined);return {result:x.research36};},{auto:true});
  study.action('载入规则目录',()=>request(ctx,'/api/research/strategy36'),{render:data=>{
    catalog.replaceChildren();config={};
    for(const s of arr(data.catalog?.strategies)){
      const settings=config[s.id]={enabled:s.enabled===true,weight:1,thresholds:{}},enabled=input('checkbox'),weight=input('number','1',{min:'0',max:'100',step:'0.1'});enabled.checked=settings.enabled;
      enabled.addEventListener('change',()=>settings.enabled=enabled.checked);weight.addEventListener('input',()=>settings.weight=weight.value===''?null:Number(weight.value));
      const card=detail(s.name,toolbar(field('纳入研究',enabled),field('研究权重',weight)));
      for(const rule of arr(s.rules)){
        const group=n('div',undefined,'fy-toolbar');group.append(n('span',rule.field+' '+rule.op+' · '+val(rule.unit)));
        if(rule.type==='number'){
          const items=(Array.isArray(rule.value)?rule.value:[rule.value]).map(value=>input('number',value,{step:'any'}));
          for(const item of items){item.setAttribute('aria-label',s.name+' '+rule.field+' 阈值');item.addEventListener('input',()=>{const values=items.map(i=>i.value===''?null:Number(i.value));settings.thresholds[rule.field]=rule.op==='between'?values:values[0];});group.append(item);}
        }else group.append(n('span',val(rule.value)));card.append(group);
      }
      card.append(n('p','失效条件：'+val(s.invalidation),'fy-muted'));catalog.append(card);
    }return n('p','规则目录已载入。修改仅用于这次实验。','fy-note');
  }});
  study.action('采集并检验所选股票',async()=>request(ctx,'/api/research/strategy36/observe',{symbol:symbolValue(code,true)||(await readAutomatic(ctx)).symbol,config}));
  file.element.append(study.action('检验导入证据',async()=>request(ctx,'/api/research/strategy36',{...await file.read(),config})));root.append(study.body);
  const factors=importEvidence('公开因子输入'),factor=workbench(ctx,'因子与研究代理','展示本次行情的量价因子及可核对的输入。',[factors.element]);
  factor.action('读取代理状态',()=>request(ctx,'/api/research/agent-status'));
  factor.action('计算公开因子',async()=>{if(factors.chosen())return request(ctx,'/api/research/public-factors',await factors.read());const x=await readAutomatic(ctx);const report=await request(ctx,'/api/research/public-factors',{schemaVersion:1,asOf:x.tradeDate,observedAt:x.asOf,tradingDates:x.tradeDates,stocks:[x.stock]});return {result:{...automaticSummary(x),adjustedFactors:report.result}};},{auto:true});root.append(factor.body);
  const adaptive=importEvidence('带来源与可用时点的自适应证据',1800*1024),ad=workbench(ctx,'自适应研究','比较不同市场状态下的研究表现，缺失原生证据不补造。',[adaptive.element]);
  ad.action('读取最新归档',async()=>{const a=await request(ctx,'/api/research/adaptive-latest');if(a.result)return a;const x=await readAutomatic(ctx);return {result:{...automaticSummary(x),note:'当前量价观测 · 自适应研究按已归档样本计算'}};},{auto:true});
  ad.action('运行自适应研究',async()=>{if(adaptive.chosen())return request(ctx,'/api/research/adaptive-market',await adaptive.read());const x=await readAutomatic(ctx);return request(ctx,'/api/research/adaptive-market',{schemaVersion:1,source:'imported',version:'v6-observation-1',provider:x.provider,asOf:x.tradeDate,decisionAt:new Date(x.asOf).toISOString(),stocks:[{...x.stock,bars:x.stock.bars.map(b=>({...b,knownAt:new Date(b.knownAt).toISOString()}))}]});});root.append(ad.body);
  return root;
}
function backtest(ctx){
  const root=n('div',undefined,'fy-stack'),imported=importEvidence('导入历史研究数据'),codes=input('text','',{placeholder:'600519,000001'}),validate=input('checkbox'),linkedRules=input('checkbox'),quality=input('checkbox');
  const w=workbench(ctx,'历史实验','将选股、账本、收益、回撤和规则检验放在同一条证据链。回测不等于实际收益。',[imported.element,toolbar(field('验证公开规则',validate),field('加入联动规则',linkedRules),field('加入质量规则',quality))]);
  async function historyInput(){if(imported.chosen())return imported.read();const x=await readAutomatic(ctx);return x.history?{history:x.history}:{observation:automaticSummary(x)};}
  const preview=input=>({result:{...input.observation,note:input.observation.note+'；较晚取得的行情供查看，逐日回测使用当时已经归档的连续交易日。'}});
  w.action('查看本期历史数据',async()=>{const x=await readAutomatic(ctx);return {result:{...automaticSummary(x),causalBars:x.history?.stocks[0].bars.length||0}};},{auto:true});
  w.action('运行完整实验',async()=>{
    const input=await historyInput();if(input.observation)return preview(input);const payload=input.history?{...input}:{history:input};
    if(validate.checked||linkedRules.checked||quality.checked)payload.validatePublicRules=true;
    if(linkedRules.checked||quality.checked)payload.publicRuleAuditOptions={...(payload.publicRuleAuditOptions||{}),...(linkedRules.checked?{includeLinkedRules:true}:{}),...(quality.checked?{includeQualityRules:true}:{})};
    return request(ctx,'/api/research/complete-run',payload);
  },{kind:'primary'});
  w.action('仅扫描形态与条件',async()=>{const i=await historyInput();return i.observation?preview(i):request(ctx,'/api/research/scan',(i.history||i));});
  w.action('仅重建研究账本',async()=>{const i=await historyInput();return i.observation?preview(i):request(ctx,'/api/research/ledger',(i.history||i));});
  w.action('原策略历史对照',async()=>{const i=await historyInput();return i.observation?preview(i):request(ctx,'/api/reference-strategy-research',(i.history?i:{history:i}));});
  root.append(w.body);
  const cache=workbench(ctx,'服务端历史库','读取已有日K或明确更新历史。每个来源的缺失、陈旧与拒绝原因分别保留。',[field('股票代码（逗号分隔）',codes)]);
  const codesValue=()=>codes.value.split(/[\s,，]+/).map(x=>x.trim()).filter(Boolean);
  for(const [label,path]of [['内存形态扫描','cache-scan'],['内存账本实验','cache-ledger'],['磁盘形态扫描','disk-scan'],['磁盘账本实验','disk-ledger']])cache.action(label,()=>request(ctx,'/api/research/'+path,path.startsWith('cache')?{limit:50}:{codes:codesValue()}));
  cache.action('保存指定历史到磁盘',()=>{const values=codesValue();if(!values.length||values.some(x=>!/^\d{6}$/.test(x)))throw Error('请指定有效的六位代码。');return request(ctx,'/api/research/disk-save',{codes:values});});
  cache.action('明确更新历史K线',()=>{const values=codesValue();if(!values.length||values.some(x=>!/^\d{6}$/.test(x)))throw Error('请指定要更新的六位代码。');return request(ctx,'/api/research/history-refresh',{codes:values});});
  cache.action('读取数据能力',()=>request(ctx,'/api/research/capabilities'),{auto:true});root.append(cache.body);
  const account=input('text','research',{maxlength:'40'}),paper=workbench(ctx,'研究模拟账本','独立历史研究账户，保留日历、费用、冲突与重复记账检查。',[field('研究账户ID',account)]);
  paper.action('恢复账本',()=>request(ctx,'/api/research/paper-account?accountId='+encodeURIComponent(account.value.trim())),{
    auto:true,render:data=>data.empty?empty('模拟账本尚无记录','首次追加已验证的历史后，这里会自动显示模拟持仓和收益。'):renderReport(data,ctx)
  });
  paper.action('追加历史至模拟账本',async()=>{const input=await historyInput();if(input.observation)return preview(input);return request(ctx,'/api/research/paper-account',{accountId:account.value.trim(),action:'append',history:input.history||input,...(input.paperConfig?{config:input.paperConfig}:{})});});
  root.append(paper.body);return root;
}
function learningStatus(ctx){
  const root=n('div',undefined,'fy-stack'),limit=input('number','30',{min:'1',max:'60',step:'1'}),progress=workbench(ctx,'学习进度与复访','只把具备独立目标日证据的研究计入完成；历史匹配频率与实际收益分开。',[field('本次最多处理',limit)]);
  const render=data=>{const s=data.status||data.result||data,c=s.counts||{};return append(n('div',undefined,'fy-stack'),metrics([['总记录',c.total??'未知'],['待到期',c.pending??'未知'],['已验证',c.matured??'未知'],['无效证据',c.invalid??'未知']]),evidenceTree(s));};
  progress.action('读取学习进度',()=>request(ctx,'/api/learn-status'),{render,auto:true});
  progress.action('处理已到期证据',()=>{const value=Number(limit.value);if(!Number.isInteger(value)||value<1||value>60)throw Error('每次处理数量需要在1到60之间。');return request(ctx,'/api/learn-status',{force:true,limit:value});},{render});root.append(progress.body);
  const runtime=workbench(ctx,'本地研究运行条件','当前预检、模型摘要与上次运行记录分别呈现，不把历史成功当作后台仍在运行。');
  runtime.action('检查当前运行条件',()=>request(ctx,'/api/research/learning-runtime'),{render:data=>evidenceTree(data.result||data)});
  runtime.action('核对本地模型摘要',()=>request(ctx,'/api/research/learning-runtime',{probeModel:true}),{render:data=>evidenceTree(data.result||data)});
  runtime.action('读取研究代理状态',()=>request(ctx,'/api/research/agent-status'));root.append(runtime.body);return root;
}
function learning(ctx){
  const root=n('div',undefined,'fy-stack'),tabs=n('nav',undefined,'fy-tabs'),content=n('div',undefined,'fy-stack');
  tabs.setAttribute('aria-label','智能学习中心分区');
  const sections=[
    ['history','历史K线样本'],['manual','人工交易样本'],['verify','战法校验与回测'],['progress','已有学习进度']
  ];
  const buttons=new Map(),panes=new Map();
  const verification=()=>{
    const strategyPane=strategies(ctx),backtestPane=backtest(ctx);
    appendResearchExtensions(strategyPane,{sub:'strategies'},ctx);
    appendResearchExtensions(backtestPane,{sub:'backtest'},ctx);
    return append(n('div',undefined,'fy-stack'),strategyPane,backtestPane);
  };
  const choose=key=>{
    if(ctx.signal?.aborted)return;
    for(const [name,control] of buttons){control.classList.toggle('active',name===key);control.setAttribute('aria-current',name===key?'page':'false');}
    if(!panes.has(key))panes.set(key,key==='history'?renderKlineLearning(ctx):key==='manual'?renderManualLearning(ctx):key==='verify'?verification():learningStatus(ctx));
    content.replaceChildren(panes.get(key));
  };
  for(const [key,label] of sections){const control=btn(label,()=>choose(key),'secondary');buttons.set(key,control);tabs.append(control);}
  root.append(box('战法验证与智能学习中心','授权后自动读取 V6 同步行情。已核对的人工成交回流到短线样本和复盘；本地 CSV 可在当前浏览器分析。'),tabs,content);
  choose('history');return root;
}
function sources(ctx){
  const root=n('div',undefined,'fy-stack'),code=symbolInput(ctx),provider=select([['auto','自动选择'],['eastmoney','东方财富'],['tencent','腾讯公开行情']]),days=input('number','120',{min:'30',max:'500',step:'1'});
  const quoteCode=symbolInput(ctx);
  root.append(box(null,null,field('核对股票代码',quoteCode),quoteCrossCheckPanel(ctx,()=>quoteCode.value.trim())));
  const capture=workbench(ctx,'建立逐股证据包','保留日K、原始来源、市场同日匹配、冻结判断与后续复访。',[field('证券代码',code),field('采集来源',provider),field('历史天数',days)]);
  capture.action('采集并研究',()=>{const historyDays=Number(days.value);if(!Number.isInteger(historyDays)||historyDays<30||historyDays>500)throw Error('历史天数须为30至500之间的整数。');return request(ctx,'/api/research/observe-stock',{symbol:symbolValue(code),provider:provider.value,historyDays,includeContext:true});},{kind:'primary'});
  capture.action('读取已存原始历史',async()=>{if(provider.value==='auto'){const x=await readAutomatic(ctx,symbolValue(code,true)||undefined);return {result:{...automaticSummary(x),stock:x.stock}};}return request(ctx,'/api/research/stock-observations?'+new URLSearchParams({symbol:symbolValue(code),provider:provider.value}));},{auto:true});
  capture.action('读取采集和复访队列',()=>request(ctx,'/api/research/stock-observation-status'));root.append(capture.body);
  let catalogue=[],chosen=new Set();const category=select([['industry','行业'],['concept','概念']]),search=input('search','',{placeholder:'名称或BK代码'}),choices=n('div',undefined,'fy-grid'),selected=n('p','已选 0 / 6','fy-muted');
  const sectors=workbench(ctx,'行业与概念取证','先读取板块目录，再明确选择最多六个板块。成员归属只属于本次观测，不回填历史。',[field('目录类别',category),field('搜索目录',search)]);
  sectors.body.insertBefore(choices,sectors.actions);sectors.body.insertBefore(selected,sectors.actions);
  function renderChoices(){choices.replaceChildren();for(const board of catalogue.filter(b=>b.category===category.value&&(!search.value||(board.name+' '+board.code).includes(search.value))).slice(0,100)){
    const key=board.category+':'+board.code,check=input('checkbox');check.checked=chosen.has(key);check.addEventListener('change',()=>{if(check.checked&&chosen.size>=6){check.checked=false;sectors.status.textContent='最多同时选择六个板块。';return;}if(check.checked)chosen.add(key);else chosen.delete(key);selected.textContent='已选 '+chosen.size+' / 6';});choices.append(field(board.name+' · '+board.code,check));
  }}
  category.addEventListener('change',renderChoices);search.addEventListener('input',renderChoices);
  function sectorRender(data){const r=data.result||data,rows=Array.isArray(r.catalogue)?r.catalogue:arr(r.catalogue?.records);if(rows.length){catalogue=rows.filter(b=>['industry','concept'].includes(b.category)&&/^BK\d{4}$/.test(b.code));chosen.clear();selected.textContent='已选 0 / 6';renderChoices();}return evidenceTree(r);}
  sectors.action('读取服务端已存板块',()=>request(ctx,'/api/research/public-sectors'),{render:sectorRender,auto:true});
  sectors.action('联网获取板块目录',()=>request(ctx,'/api/research/public-sectors',{}),{render:sectorRender});
  sectors.action('采集已选板块',()=>{if(!chosen.size)throw Error('请先从目录选择板块。');return request(ctx,'/api/research/public-sectors',{boards:[...chosen].map(value=>{const [category,code]=value.split(':');return {category,code};})});},{render:sectorRender});root.append(sectors.body);return root;
}
function memory(ctx){
  const root=n('div',undefined,'fy-stack'),code=symbolInput(ctx),sector=input('text','',{placeholder:'BK1234',maxlength:'6'}),day=input('date'),memory=workbench(ctx,'个股研究记忆','原判断、后续证据与版本变化分开展示，同股数据不会替代别的股票。',[field('证券代码',code),field('板块代码（可选）',sector),field('证据日期（可选）',day)]);
  let publicContext=null;
  memory.action('读取已归档记忆',()=>request(ctx,'/api/research/stock-memory?symbol='+symbolValue(code)),{render:data=>{
    const r=data.result||data;if(r.symbol&&r.symbol!==code.value.trim())throw Error('返回股票与所选对象不一致。');return evidenceTree(r);
  },kind:'primary'});
  memory.action('读取公开上下文',async turn=>{
    const symbol=symbolValue(code,true),sectorCode=sector.value.trim();if(sectorCode&&!/^BK\d{4}$/.test(sectorCode))throw Error('板块代码需要BK加四位数字。');
    const data=await request(ctx,'/api/research/public-context',{...(symbol?{symbol}:{}),...(sectorCode?{sectorCode}:{}),...(day.value?{date:day.value}:{})});if(!turn.current())throw Error('研究对象已变化，请重新读取。');publicContext=data.result||data;return data;
  });
  code.addEventListener('input',()=>publicContext=null);sector.addEventListener('input',()=>publicContext=null);day.addEventListener('input',()=>publicContext=null);root.append(memory.body);
  const imported=importEvidence('带来源和原始时点的联动证据',2*1024*1024),persist=input('checkbox'),linkedStudy=workbench(ctx,'市场、板块与个股联动','独立证据共同支持研究；不改变原始生产排名。保存研究需要显式选择。',[imported.element,field('保存本次研究版本',persist)]);
  linkedStudy.action('分析联动证据',async()=>{const x=imported.chosen()?null:await readAutomatic(ctx,symbolValue(code,true)||researchCode(ctx));const payload=x?{schemaVersion:1,asOf:x.asOf,tradeDates:x.tradeDates,stocks:[x.stock],...(x.publicContext?{publicContext:x.publicContext}:{})}:await imported.read();if(payload.schemaVersion!==1||!Number.isSafeInteger(payload.asOf)||!Array.isArray(payload.tradeDates)||!Array.isArray(payload.stocks))throw Error('需要schemaVersion:1、asOf、tradeDates和stocks原始字段。');payload.persist=persist.checked;if(!Object.hasOwn(payload,'publicContext')&&publicContext)payload.publicContext=publicContext;return request(ctx,'/api/research/linked-intelligence',payload);},{kind:'primary'});
  linkedStudy.action('查看当前联动观察',async()=>{const x=await readAutomatic(ctx);const r=await request(ctx,'/api/research/linked-intelligence',{schemaVersion:1,asOf:x.asOf,tradeDates:x.tradeDates,stocks:[x.stock],publicContext:x.publicContext,persist:false});return {result:{...automaticSummary(x),linkage:r.result}};},{auto:true});root.append(linkedStudy.body);return root;
}
function evidence(ctx){
  const code=symbolInput(ctx),cutoff=input('datetime-local',''),w=workbench(ctx,'原文证据室','发布、接收、修订与撤稿分别留痕；来源摘要与完整原文不混淆。',[field('证券代码（留空查看全部）',code),field('历史截点（北京时间，留空查看当前）',cutoff)]);
  cutoff.step='0.001';let offset=0,anchor=null,requestedAsOf=null,replayController=null;
  const clear=()=>{offset=0;anchor=null;requestedAsOf=null;replayController?.abort();w.output.replaceChildren();};
  for(const control of [code,cutoff])control.addEventListener('input',clear);
  function fetchPage(){const now=Date.now(),asOf=anchor??replayTime(cutoff.value,now);
    if(!Number.isSafeInteger(asOf)||asOf<=0||asOf>now)throw Error('历史截点无效');
    requestedAsOf=asOf;replayController?.abort();
    const q=new URLSearchParams({asOf:String(asOf),offset:String(offset),limit:'50'});
    if(code.value.trim())q.set('symbol',symbolValue(code));w.output.replaceChildren();return request(ctx,'/api/research/news-evidence?'+q);
  }
  const read=w.action('读取新闻与公告证据',fetchPage,{kind:'primary',render:data=>{
    const r=data.result||data,root=n('div',undefined,'fy-stack'),s=r.summary||{};
    const now=Date.now(),asOf=r.asOf;
    if(!Number.isSafeInteger(asOf)||asOf>now||asOf!==requestedAsOf||r.offset!==offset||anchor!==null&&anchor!==asOf)return empty('新闻回执未通过截点核验');anchor=asOf;
    const projection=projectNewsEvents(arr(r.rows),asOf,now,{currentView:!cutoff.value});
    if(cutoff.value)root.append(n('p','历史研究截点 '+clock(asOf)+'；仅显示当时已归档的返回范围内版本。不是完整历史，不能用于下单。','fy-note'));
    else root.append(metrics([['当前事件',s.currentEvents??'未知'],['已撤稿',s.retractedEvents??'未知'],['来源完整（未独立核实）',s.eligibleForResearchSupport??'未知'],['未知证据',s.unknownEvents??'未知']]));
    root.append(n('p',projection.missing.join('；'),'fy-muted'));
    if(projection.status==='unknown')return root;
    for(const event of projection.rows){
      const row=event.row;
      const e=row.evidence||{},card=box(e.title||'无标题',val(e.source)+' · '+event.revisionStatus,facts([['正文范围',e.bodyScope==='provider-summary'?'供应商摘要':'导入原文，未独立核实'],['发布',clock(e.publishedAt)],['接收',clock(e.receivedAt)],['归档可知时间',clock(event.knownAt)],['修订/撤稿',clock(e.revisedAt)],['证券主体',event.subjects.join('、')],['正式披露',event.formalDisclosure],['生效日期（原文声明，非核验时点）',event.effectiveDate?event.effectiveDate+' · '+event.effectiveQuote:'未知'],['原文金额字样（非核定金额）',event.amounts.join('、')||'未知'],['修订链',event.chainComplete?'返回范围内连续':'不完整']]));
      card.append(detail('分析线索与待核实事项',facts(event.clues.map(x=>[x.label,x.quote])),n('p',event.missing.join('；'),'fy-muted'),n('p','关键词仅供核对，不代表利好、利空或执行资格。','fy-note')));
      if(e.url)card.append(linked('查看原始来源',e.url));
      card.append(detail('正文与版本链',n('p',e.body||'正文缺失'),facts([['版本',row.sequence],['原文指纹',e.bodyHash],['前版',e.supersedes],['不确定性',arr(e.uncertainty).join('；')]]),
        ...event.versions.slice(0,-1).reverse().map(prior=>detail('前版 '+prior.sequence+' · '+clock(prior.recordedAt),n('p',prior.evidence.title),n('p',prior.evidence.body||'正文缺失'),facts([['发布',clock(prior.evidence.publishedAt)],['接收',clock(prior.evidence.receivedAt)],['修订',clock(prior.evidence.revisedAt)],['原文指纹',prior.evidence.bodyHash],['原始来源',prior.evidence.source]]),prior.evidence.url?linked('前版原始来源',prior.evidence.url):null))));root.append(card);
    }
    if(!projection.rows.length)root.append(empty('尚无该截点可展示的归档事件','没有新闻证据不代表没有风险。'));
    root.append(toolbar(btn('刷新至最新',()=>{offset=0;anchor=null;read.click();}),...(offset>0?[btn('上一页',()=>{offset=Math.max(0,offset-50);read.click();})]:[]),
      ...(Number.isSafeInteger(r.nextOffset)?[btn('更早版本',()=>{offset=r.nextOffset;read.click();})]:[]),n('p','截点 '+clock(asOf)+' · 版本 '+(r.total??'未知')+' 条','fy-muted')));
    if(/^\d{6}$/.test(code.value)){replayController=new AbortController();root.append(createResearchReplay(ctx,{symbol:code.value,asOf,memory:ctx.viewMemory,signal:replayController.signal}));}
    return root;
  }});
  if(ctx.signal){ctx.signal.addEventListener('abort',clear,{once:true});globalThis.addEventListener('offline',()=>{w.invalidate();clear();w.status.textContent='连接已离线，私有新闻及回放已清空，请重新读取。';},{signal:ctx.signal});}
  return w.body;
}
function models(ctx){
  const root=n('div',undefined,'fy-stack'),search=input('search','',{placeholder:'名称、任务、许可或运行条件'}),category=select([['','所有任务']]),adoption=select([['','所有状态'],['implemented','已采用设计'],['candidate','待实测'],['reference-only','参考']]),cards=n('div',undefined,'fy-grid'),comparison=n('div',undefined,'fy-grid'),status=n('output','正在读取公开资料目录…','fy-note');status.setAttribute('role','status');
  let catalogue=null,selected=new Set(),initialContext=true;
  const names={language:'推理与语言',forecast:'时序预测','finance-text':'金融文本',workflow:'研究流程',interface:'交互设计',runtime:'运行调度',evaluation:'验证评测',data:'数据证据'};
  const summary=n('div',undefined,'fy-grid');
  const exportButton=btn('导出已选对照',()=>{if(catalogue)download('fayo-public-model-comparison.json',{mode:'public-source-comparison',reviewDate:catalogue.reviewDate,entries:catalogue.entries.filter(e=>selected.has(e.id))});});exportButton.disabled=true;
  const clear=btn('清除对照',()=>{selected.clear();render();});clear.disabled=true;
  const shared=input('url');shared.readOnly=true;shared.hidden=true;
  function publicURL(){const url=new URL(location.origin);url.pathname=location.pathname;url.hash=location.hash;const ids=[...selected];if(ids.length)url.searchParams.set('modelIds',ids.join(','));if(category.value)url.searchParams.set('modelCategory',category.value);if(adoption.value)url.searchParams.set('modelState',adoption.value);return url.href;}
  const share=btn('复制公开对照链接',async()=>{const url=publicURL();shared.value=url;shared.hidden=false;try{await navigator.clipboard.writeText(url);status.textContent='公开对照链接已复制；链接不包含身份或私有研究数据。';}catch{shared.focus();shared.select();status.textContent='公开链接已准备好，可复制上方地址。';}});share.disabled=true;
  function renderCompare(){comparison.replaceChildren();const entries=catalogue?catalogue.entries.filter(e=>selected.has(e.id)):[];exportButton.disabled=!entries.length;clear.disabled=!entries.length;share.disabled=!catalogue;
    if([...new URL(location.href).searchParams.keys()].some(key=>key.startsWith('model')))history.replaceState(history.state,'',publicURL());
    for(const entry of entries)comparison.append(box(entry.name,entry.kind,facts([['任务',names[entry.category]||entry.category],['采用状态',entry.adoption],['源码许可',entry.license],['权重许可',entry.weightsLicense],['运行方式',arr(entry.runMode).join('；')],['运行条件',entry.runtimeNotes],['固定版本',entry.commit||'文档快照'],['系统实测准确率',entry.v6MeasuredAccuracy??'未测'],['系统实测时延',entry.v6MeasuredLatencyMs??'未测'],['限制',entry.limit]]),btn('移除',()=>{selected.delete(entry.id);render();})));
  }
  function render(){cards.replaceChildren();summary.replaceChildren();if(!catalogue)return;
    for(const [key,label]of [['','公开目录'],['implemented','已采用'],['candidate','待实测'],['reference-only','参考']]){const count=key?catalogue.entries.filter(e=>e.adoption===key).length:catalogue.entries.length;summary.append(btn(label+' / '+count,()=>{search.value='';category.value='';adoption.value=key;render();}));}
    const query=search.value.trim().toLowerCase(),rows=catalogue.entries.filter(e=>(!category.value||e.category===category.value)&&(!adoption.value||e.adoption===adoption.value)&&(!query||[e.name,e.kind,e.repository,e.license,e.weightsLicense,...arr(e.borrow),e.limit,...arr(e.runMode)].join(' ').toLowerCase().includes(query)));
    for(const entry of rows){const choose=input('checkbox');choose.checked=selected.has(entry.id);choose.addEventListener('change',()=>{if(choose.checked&&selected.size>=3){choose.checked=false;status.textContent='一次最多对照三项，请先移除已有选择。';return;}if(choose.checked)selected.add(entry.id);else selected.delete(entry.id);renderCompare();status.textContent='已选 '+selected.size+' / 3；筛选不会清空对照。';});
      const card=box(entry.name,entry.kind,n('span',names[entry.category]||entry.category,'fy-pill'),field('加入对照',choose));
      const borrow=n('ul');for(const item of arr(entry.borrow))borrow.append(n('li',item));card.append(borrow);
      const details=detail('来源、许可与运行条件',facts([['源码许可',entry.license],['权重许可',entry.weightsLicense],['运行方式',arr(entry.runMode).join('；')],['运行条件',entry.runtimeNotes],['限制',entry.limit],['实际状态',entry.status],['固定版本',entry.commit||'未固定Git版本']]));
      if(entry.repository)details.append(linked(entry.repository,'https://github.com/'+entry.repository));for(const source of arr(entry.reads))details.append(linked(source.path||'原始文档',source.url));for(const impl of arr(entry.implementation))details.append(n('p','已落实位置：'+val(impl.label)+' · '+val(impl.path),'fy-muted'));card.append(details);cards.append(card);
    }
    if(!rows.length)cards.append(empty('没有符合筛选的资料','可以清除关键词，或切换任务类别。'));renderCompare();status.textContent='显示 '+rows.length+' / '+catalogue.entries.length+' 项 · 核对日期 '+catalogue.reviewDate+' · 未执行模型。';
  }
  for(const element of [search,category,adoption])element.addEventListener(element===search?'input':'change',render);
  root.append(box('模型与方法资料库','比较任务、来源、许可和运行条件，不把不同任务合成为收益榜。',summary,toolbar(field('搜索',search),field('任务',category),field('采用状态',adoption)),status),cards,box('并列对照','最多三项；筛选后仍保留当前对照。',toolbar(exportButton,clear,share),shared,comparison));
  const reload=btn('重新读取目录',load);root.firstChild.append(reload);
  async function load(){status.textContent='正在读取公开目录…';reload.disabled=true;try{
    const response=await fetch('/assets/model-library-catalog.json',{credentials:'omit',cache:'no-store',redirect:'error',signal:ctx.signal});if(!response.ok)throw Error('目录读取失败。');const value=await response.json();if(ctx.signal?.aborted)return;
    if(value.schemaVersion!==1||!Array.isArray(value.entries)||value.entries.length>256)throw Error('目录格式无效。');const ids=new Set();for(const entry of value.entries){if(!entry||typeof entry.id!=='string'||ids.has(entry.id)||typeof entry.name!=='string'||!names[entry.category]||!Array.isArray(entry.borrow)||!Array.isArray(entry.reads))throw Error('目录条目无效。');ids.add(entry.id);}
    catalogue=value;selected.clear();category.replaceChildren(n('option','所有任务'));category.firstChild.value='';for(const key of Object.keys(names))if(value.entries.some(e=>e.category===key)){const option=n('option',names[key]);option.value=key;category.append(option);}if(initialContext){initialContext=false;const query=new URL(location.href).searchParams;selected=new Set((query.get('modelIds')||'').split(',').filter(id=>ids.has(id)).slice(0,3));const requestedCategory=query.get('modelCategory'),requestedState=query.get('modelState');if([...category.options].some(o=>o.value===requestedCategory))category.value=requestedCategory;if([...adoption.options].some(o=>o.value===requestedState))adoption.value=requestedState;}render();
  }catch(error){if(!ctx.signal?.aborted){catalogue=null;selected.clear();cards.replaceChildren();comparison.replaceChildren();summary.replaceChildren();exportButton.disabled=clear.disabled=share.disabled=true;status.textContent=error.message||'公开目录不可用。';}}finally{if(!ctx.signal?.aborted)reload.disabled=false;}}
  queueMicrotask(load);return root;
}

export function renderResearch(route,ctx){
  if(route.sub.startsWith('shortline-')){
    if(!ctx.canEdit)return empty('需要研究编辑权限','请使用已获批的编辑设备登录。');
    return import('./shortline-host.mjs').then(({renderShortline})=>renderShortline(route,ctx));
  }
  const renders={desk,records:renderRecords,strategies,backtest,learning,models,sources,memory,evidence,evolution:renderEvolution};
  const active=Object.hasOwn(renders,route.sub)?route.sub:'desk';
  const choices=[['desk','研究决策'],['records','研究档案'],['strategies','策略与因子'],['backtest','回测验证'],...(ctx.canEdit?[['evolution','研究进化工作台']]:[]),['learning','战法验证与学习'],['models','模型资料'],['sources','数据采集'],['memory','市场记忆'],['evidence','新闻证据']];
  const nav=fyNode('nav',{class:'fy-subnav','aria-label':'实验室工作区'},choices.map(([key,label])=>{const control=fyAction(label,()=>ctx.navigate('lab',key),key===active?'primary':'quiet');control.setAttribute('aria-current',key===active?'page':'false');return control;}));
  return fyNode('div',{class:'fy-stack'},ctx.workspaceNavigation?null:nav,renders[active](ctx));
}
