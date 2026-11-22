import {readAutomatic,researchCode} from './automatic-research.js';
import {activeBook,bookHeaders} from './shortline/book-session.mjs';
import {linkedPage,sampleFor} from './shortline/context.mjs';
import {normalizeCSV,labelHistory,applyCorrections,analyzeFactors,freezeSplit,HORIZONS} from './kline-factor-engine.js';
import {syncedDataset,syncedSeries} from './kline-synced-history.js';
const node=(tag,text='',className='')=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==null)el.textContent=text;return el;};
const wrap=(tag,className,...children)=>{const el=node(tag,null,className);for(const item of children.flat())if(item)el.append(item);return el;};
const button=(label,fn,kind='secondary')=>{const b=node('button',label,'fy-button '+kind);b.type='button';b.addEventListener('click',fn);return b;};
const field=(label,element)=>wrap('label','fy-field',node('span',label),element);
const block=(title,note,...children)=>wrap('section','fy-panel fy-stack',node('h2',title),node('p',note,'fy-muted'),...children);
const input=(type,attrs={})=>{const el=node('input');el.type=type;el.className='fy-input';for(const [key,val]of Object.entries(attrs))el.setAttribute(key,String(val));return el;};
const sel=options=>{const x=node('select',null,'fy-input');for(const [v,label]of options){const item=node('option',label);item.value=v;x.append(item);}return x;};
const fmt=(n,d=2)=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(d):'未知';
const out=(n,suffix='')=>typeof n==='number'&&Number.isFinite(n)?fmt(n)+suffix:'未知';
function facts(rows){const dl=node('dl',null,'fy-facts');for(const [key,value]of rows){dl.append(node('dt',key),node('dd',value==null?'未知':String(value)));}return dl;}
function tabulate(columns,rows){const div=node('div',null,'fy-table-wrap'),table=node('table',null,'fy-table'),head=node('tr');for(const [title]of columns)head.append(node('th',title));const body=node('tbody');for(const row of rows){const tr=node('tr');for(const [,fn]of columns){const value=fn(row),td=node('td');td.append(value instanceof Node?value:document.createTextNode(value==null?'未知':String(value)));tr.append(td);}body.append(tr);}if(!rows.length){const tr=node('tr'),td=node('td','当前条件没有成熟样本或证据不足。');td.colSpan=columns.length;tr.append(td);body.append(tr);}table.append(wrap('thead','',head),body);div.append(table);return div;}
function miniCandles(rows){
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 135');svg.setAttribute('role','img');svg.setAttribute('aria-label','截至信号当日的历史K线，红涨绿跌，不展示未来走势');svg.style.width='100%';svg.style.maxWidth='640px';
  if(!rows?.length)return svg;
  const low=Math.min(...rows.map(x=>x.low)),high=Math.max(...rows.map(x=>x.high)),den=Math.max(.001,high-low),w=600/rows.length;
  const y=p=>12+108*(high-p)/den;
  for(let i=0;i<rows.length;i++){
    const x=rows[i],cx=i*w+w/2,color=x.close>=x.open?'#d15474':'#299479',line=document.createElementNS(svg.namespaceURI,'line'),rect=document.createElementNS(svg.namespaceURI,'rect');
    for(const [k,v]of Object.entries({x1:cx,y1:y(x.high),x2:cx,y2:y(x.low),stroke:color,'stroke-width':1.8}))line.setAttribute(k,String(v));
    for(const [k,v]of Object.entries({x:cx-w*.23,y:Math.min(y(x.open),y(x.close)),width:Math.max(3,w*.46),height:Math.max(1.5,Math.abs(y(x.open)-y(x.close))),fill:color}))rect.setAttribute(k,String(v));
    svg.append(line,rect);
  }return svg;
}
const exportJSON=(name,value)=>{const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);};
function sourceInput(label){const file=input('file',{accept:'.csv','aria-label':label});return {file,element:field(label,file)};}
const strategyNames=['首板套利','连板接力','断板反包','龙头首阴','二波启动','龙头战法','弱转强','半路','分歧低吸','尾盘套利'];

export function renderKlineLearning(ctx){
  const root=node('div',null,'fy-stack'),stocks=sourceInput('历史日K CSV（必选）'),sectors=sourceInput('同期板块 CSV'),markets=sourceInput('同期全A指数 CSV'),minutes=sourceInput('历史分时 CSV（可选，单独校验）'),more=sourceInput('追加日K CSV（可选）');
  const status=node('p','选择真实来源CSV，只有导入后才会计算。CSV不会发送给服务器。','fy-note');status.setAttribute('role','status');
  const strategy=sel([['','全部战法'],...strategyNames.map(name=>[name,name])]),environment=sel([['','所有大盘环境'],['多头','多头'],['震荡','震荡'],['空头','空头']]),quality=sel([['','全部质量'],['standard','标准样本'],['pending-review','待复核'],['black-swan','黑天鹅'],['extreme','极端行情'],['excludeBlackSwan','排除黑天鹅'],['excludeExtreme','排除极端行情']]),horizon=sel(HORIZONS.map(h=>[String(h),`信号后${h}日`]));horizon.value='3';
  const sampleScope=sel([['signals','仅有信号'],['all','全部K线（可补标）'],['missing','未标注K线']]),sampleDate=input('date',{'aria-label':'按信号日期筛选'});sampleScope.value='signals';
  const symbol=input('search',{placeholder:'代码 / 名称','aria-label':'按股票筛选'});
  const correctionStrategy=sel(strategyNames.map(name=>[name,name]));
  const actionType=sel([['add','补充标注'],['remove','撤销错误标注']]),reason=input('text',{maxlength:300,placeholder:'注明原始证据或撤销原因','aria-label':'人工修正原因'}),target=node('strong','未选择要修正的K线');
  for(const [control,label]of [[strategy,'战法筛选'],[environment,'大盘状态'],[quality,'样本质量'],[horizon,'跟踪期限'],[sampleScope,'样本范围'],[correctionStrategy,'修正战法'],[actionType,'修正动作']])control.setAttribute('aria-label',label);
  let records={stock:[],sector:[],market:[],minute:[]},samples=[],corrections=[],selected=null,report=null,revision=0,busy=false,sourceFiles={},frozenSplit=null;
  let dataset=null,sourceMode='',sourceToken=0,lastAuthorized=ctx.role==='edit',book=activeBook();
  const legacyQuality=v=>v==='blackSwan'?'black-swan':v==='all'?'':v;
  const sharedQuality=()=>quality.value==='black-swan'?'blackSwan':quality.value==='pending-review'?'all':quality.value||'all';
  quality.value=legacyQuality(sampleFor(book));
  const qualityMatches=s=>{
    if(!quality.value)return true;
    const extreme=s.bar.repeatable===false&&s.quality!=='black-swan';
    if(quality.value==='excludeBlackSwan')return s.quality!=='black-swan';
    if(quality.value==='excludeExtreme')return !extreme;
    return quality.value==='extreme'?extreme:s.quality===quality.value;
  };
  const synced=node('section',null,'fy-panel fy-stack');
  const canEdit=()=>ctx.role==='edit'&&!ctx.signal?.aborted;
  const openBacktest=button('打开当前账户正式回测',()=>{
    if(!canEdit()||activeBook()!==book||typeof ctx.navigate!=='function')return;
    const code=[symbol.value?.trim(),selected?.code,sourceMode==='synced'?records.stock.at(-1)?.code:null,ctx.stock].find(v=>/^\d{6}$/.test(v||''));
    const date=sampleDate.value||selected?.date||records.stock.filter(r=>r.code===code).at(-1)?.date||'';
    const name=strategy.value;
    ctx.navigate('lab',linkedPage('backtest',{code,date,sample:sampleFor(book,sharedQuality()),strategy:name?(name.endsWith('战法')?name:name+'战法'):''}));
  },'primary');
  const linkPanel=block('正式回测','进入当前研究账户的回测。样本筛选、所选标的与交易日期会一起带入。',openBacktest);
  if(canEdit()&&typeof ctx.navigate==='function')root.append(linkPanel);
  if(canEdit()&&typeof ctx.api==='function')root.append(synced);
  function setBusy(value){busy=value;load.disabled=appendNew.disabled=value||Boolean(ctx.signal?.aborted);save.disabled=value||!canEdit();exported.disabled=value||!report||Boolean(ctx.signal?.aborted);}
  const files=block('本地历史行情回放','CSV 在此浏览器会话中处理。收盘观察统计与人工批注独立于正式账户绩效和训练。需要代码、日期与 OHLC，板块、全A 按交易日对齐。',wrap('div','fy-grid',stocks.element,sectors.element,markets.element,minutes.element),more.element);
  const load=button('导入并自动标注',async()=>{
    if(busy||ctx.signal?.aborted)return;
    const turn=++revision;sourceToken++;setBusy(true);status.textContent='正在本机校验CSV及历史日期…';
    try{
      const chosen={stock:stocks.file.files?.[0],sector:sectors.file.files?.[0],market:markets.file.files?.[0],minute:minutes.file.files?.[0],append:more.file.files?.[0]};
      if(!chosen.stock)throw Error('必须先导入历史日K CSV');
      async function read(file,type){if(!file)return [];if(file.size>6*1024*1024)throw Error(`${type}文件超过6MiB`);return normalizeCSV(await file.text(),type);}
      const [stock,sector,market,minute,append]=await Promise.all([read(chosen.stock,'stock'),read(chosen.sector,'sector'),read(chosen.market,'market'),read(chosen.minute,'minute'),read(chosen.append,'stock')]);
      if(turn!==revision||ctx.signal?.aborted)return;
      const keys=new Set(stock.map(x=>`${x.code}|${x.date}`));for(const item of append){const k=`${item.code}|${item.date}`;if(keys.has(k))throw Error('追加K线存在重复样本 '+k);keys.add(k);}
      const next={stock:stock.concat(append),sector,market,minute},tagged=labelHistory(next.stock,next.sector,next.market,next.minute),split=freezeSplit(tagged,{embargo:5});
      // Commit a complete import together; failed replacements keep the last usable evidence.
      records=next;sourceMode='csv';samples=tagged;frozenSplit=split;corrections=[];selected=null;reason.value='';target.textContent='未选择要修正的K线';
      if(canEdit()&&typeof ctx.api==='function'){synced.replaceChildren(node('h2','V6 已同步日线'),node('p','当前使用本地 CSV，文件仅在此浏览器会话中处理。','fy-muted'));}
      sourceFiles={stock:chosen.stock.name,sector:chosen.sector?.name??null,market:chosen.market?.name??null,minute:chosen.minute?.name??null,appendedStock:chosen.append?[chosen.append.name]:[]};
      status.textContent=`已生成${samples.length}条历史标签；${sector.length?'已':'未'}提供同期板块，${market.length?'已':'未'}提供同期全A；页面刷新前请导出纠错档案。`;
      refresh();
    }catch(e){if(turn===revision&&!ctx.signal?.aborted)status.textContent=`导入失败：${e?.message||'CSV校验未通过'}${samples.length?'；保留上次成功导入的样本与修正。':''}`;}finally{if(turn===revision)setBusy(false);}
  },'primary');
  const appendNew=button('追加新日K并重新计算',async()=>{
    if(busy||ctx.signal?.aborted)return;
    if(sourceMode==='synced'){status.textContent='请先导入本地初始日K，再追加本地文件。';return;}
    if(!records.stock.length){status.textContent='请先导入初始日K与同期市场证据。';return;}
    const file=more.file.files?.[0];if(!file){status.textContent='请在追加日K CSV处选择新文件。';return;}
    if(file.size>6*1024*1024){status.textContent='追加文件超过6MiB。';return;}
    const turn=++revision;setBusy(true);
    try {
      const rows=normalizeCSV(await file.text(),'stock');
      if(turn!==revision||ctx.signal?.aborted)return;
      const seen=new Set(records.stock.map(x=>`${x.code}|${x.date}`));
      for(const item of rows){const key=`${item.code}|${item.date}`;if(seen.has(key))throw Error('历史K线已存在，禁止重复追加 '+key);seen.add(key);}
      const next=records.stock.concat(rows),tagged=labelHistory(next,records.sector,records.market,records.minute);
      records.stock=next;samples=tagged;sourceFiles={...sourceFiles,appendedStock:[...(sourceFiles.appendedStock||[]),file.name]};
      status.textContent=`新增 ${rows.length} 根日K，已重算 ${samples.length} 条样本标签、因子和所有研究统计。需确保新增日期的板块及全A证据也已覆盖。`;
      refresh();
    }catch(e){if(turn===revision&&!ctx.signal?.aborted)status.textContent=`追加失败：${e?.message||'CSV校验未通过'}；原有样本与修正未改变。`;}
    finally{if(turn===revision)setBusy(false);}
  });
  files.append(wrap('div','fy-toolbar',load,appendNew));root.append(wrap('details','fy-details',node('summary','使用自己的历史 CSV（可选）'),files),status);
  const editPanel=block('人工修正自动信号','同一战法可连续纠错，报告保留每次动作及理由；不会写入生产模型。',target,wrap('div','fy-grid',field('战法',correctionStrategy),field('动作',actionType),field('修正依据',reason)));
  const save=button('保存本次人工修正',()=>{
    if(ctx.signal?.aborted||busy)return;
    if(!selected||!canEdit()){status.textContent='先选择样本，并以编辑身份操作。';return;}
    const text=reason.value.trim();if(!text){status.textContent='修正必须填写依据。';return;}
    const c={id:selected.id,strategy:correctionStrategy.value,action:actionType.value,reason:text,recordedAt:new Date().toISOString(),evidence:'user-asserted'};
    corrections=corrections.concat(c);reason.value='';status.textContent=`已记录 ${c.id} ${c.strategy} 的人工修正（仅当前会话）。`;refresh();
  });if(!canEdit()){save.disabled=true;save.title='仅编辑身份能修改'}
  editPanel.append(wrap('div','fy-toolbar',save));root.append(editPanel);
  const analytics=block('回测分布与研究权重','本页展示收盘价观察收益，中间停牌记未知。自动候选用于研究统计，人工修正单独保留在案例和导出文件中。正式信号、成交成本与次日开盘收益由上方正式回测入口计算。',wrap('div','fy-grid',field('跟踪期限',horizon),field('战法筛选',strategy),field('大盘状态',environment),field('样本质量',quality),field('样本范围',sampleScope),field('代码搜索',symbol),field('信号日期',sampleDate)));
  const metrics=node('div',null,'fy-grid'),factor=node('div',null,'fy-stack'),cases=node('div',null,'fy-stack'),detail=node('div',null,'fy-stack');analytics.append(metrics,factor,cases,detail);root.append(analytics);
  const exported=button('导出回测学习报告 JSON',()=>{
    if(ctx.signal?.aborted||busy)return;
    if(!report){status.textContent='请先导入样本并计算';return;}
    const reviewed=applyCorrections(samples,corrections),compact=s=>({id:s.id,name:s.name,date:s.date,bar:s.bar,signalAvailableAt:s.signalAvailableAt??null,labels:s.labels,signals:s.signals,quality:s.quality,risk:s.risk,observed:s.observed});
    exportJSON('V6_KLINE_LEARNING_'+new Date().toISOString().slice(0,10)+'.json',{
      mode:sourceMode==='synced'?'v6-synced-observational-research':'offline-observational-research',generatedAt:new Date().toISOString(),sourceFiles,workspace:book,statsBasis:'自动候选 / 收盘价观察；与正式账户信号和训练隔离',
      methodology:'收盘基准观察，不是可成交收益或正式回测',report,corrections,
      samples:reviewed.filter(s=>s.quality!=='black-swan').map(compact),blackSwanSamples:reviewed.filter(s=>s.quality==='black-swan').map(compact)});
    status.textContent='已生成可复核JSON报告；请妥善保管，系统未自动上传或持久保存。';
  },'secondary');root.append(wrap('div','fy-toolbar',exported));
  function showSample(item){selected=item;target.textContent=`修正样本：${item.code} / ${item.date} · ${item.name||'名称未知'}`;
    detail.replaceChildren(block(item.signalAvailableAt?'信号时点完整证据':'事后行情观察',item.signalAvailableAt?'前 20 根 K 线仅取当时已有的行情，后续表现单列。':'缺少该 K 线的同日采集回执，仅列原始价格。',miniCandles(item.history),facts([
      ['代码/日期',item.code+' / '+item.date],['开高低收',`${fmt(item.bar.open)} / ${fmt(item.bar.high)} / ${fmt(item.bar.low)} / ${fmt(item.bar.close)}`],
      ['成交额/换手/量比',`${out(item.bar.amount)} / ${out(item.bar.turnover,'%')} / ${out(item.bar.volumeRatio)}`],['K线形态/位置',`${item.labels.candle||'未知'} / ${item.labels.position||'未知'}`],
      ['均线/平台',`${item.labels.maState||'未知'} / ${item.labels.platform||'未知'}`],['量价/筹码',`${item.labels.priceVolume||'未知'} / 峰值 ${out(item.labels.chipPeak)}`],
      ['市场状态/涨跌家数',`${item.labels.marketTrend||'未知'} / ${out(item.labels.advance)}:${out(item.labels.decline)}`],
      ['题材周期/助攻',`${item.labels.sectorStage||'未知'} / ${out(item.labels.assistCount)}`],['市场/板块共振',item.labels.resonance===null?'证据不足':item.labels.resonance?'有':'无'],
      ['风险因子',item.risk.join('、')||'未确认（不是无风险）'],['标准样本',item.quality],
      ['来源',`个股 ${item.labels.stockSource||'未知'} / 板块 ${item.labels.sectorSource||'未知'} / 全A ${item.labels.marketSource||'未知'}`]
    ]),tabulate([['N日',x=>x.horizon],['最高涨幅',x=>out(x.highestPct,'%')],['最低涨幅',x=>out(x.lowestPct,'%')],['收盘涨幅',x=>out(x.closePct,'%')],['收盘峰谷回撤',x=>out(x.pathMaxDrawdownPct,'%')]],item.observed.filter(Boolean))));
  }
  function refresh(){
    if(ctx.signal?.aborted)return;
    if(!samples.length){report=null;metrics.replaceChildren();factor.replaceChildren();cases.replaceChildren();detail.replaceChildren();exported.disabled=true;return;}
    const effective=applyCorrections(samples,corrections),h=Number(horizon.value);
    report=analyzeFactors(samples,{horizon:h,minimum:20,embargo:5,split:frozenSplit});exported.disabled=busy;
    metrics.replaceChildren(...[['K线样本',report.counts.bars],['含信号K线',report.counts.signalBars],['标准训练样本',report.counts.training],['冻结样本外',report.counts.holdout],['黑天鹅隔离',report.counts.blackSwans],['待复核',report.counts.pending],['历史观察胜率',out(report.descriptive.winRatePct,'%')],['研究权重',report.counts.training>=20?'仅研究，不自动晋级':'样本不足']].map(([k,v])=>wrap('article','fy-metric',node('small',k),node('strong',String(v)))));
    factor.replaceChildren(node('h3','研究因子与负向组合'),tabulate([
      ['因子/战法',x=>x.key],['训练样本',x=>x.matured],['胜率及95%区间',x=>`${out(x.winRatePct,'%')} (${out(x.winRate95?.lowPct,'%')}–${out(x.winRate95?.highPct,'%')})`],['盈亏比',x=>out(x.payoffRatio)],['大亏≤-5%',x=>out(x.loss5Pct,'%')],['研究权重',x=>out(x.shadowWeight)],['结论',x=>x.qualified?'仅待样本外检验':'样本不足']
    ],report.factors.slice(0,40)),node('h3','信号收益分布（收盘观察口径）'),tabulate([['区间',x=>x.range],['样本数',x=>x.count]],[...Object.entries(report.descriptive.distribution)].map(([range,count])=>({range,count}))),node('h3','高风险负向组合'),tabulate([['组合',x=>x.key],['样本',x=>x.matured],['大亏比例',x=>out(x.loss5Pct,'%')]],report.negativeCombinations.slice(0,20)),node('h3','冻结样本外观察'),tabulate([['战法或条件',x=>x.key],['样本',x=>x.matured],['胜率',x=>out(x.winRatePct,'%')]],report.holdoutFactors.slice(0,30)));
    const filtered=effective.filter(s=>(sampleScope.value==='all'||(sampleScope.value==='missing'?!s.signals.length:s.signals.length))&&(!strategy.value||s.signals.some(x=>x.name===strategy.value))&&(!environment.value||s.labels.marketTrend===environment.value)&&qualityMatches(s)&&(!sampleDate.value||s.date===sampleDate.value)&&(!symbol.value||s.code.includes(symbol.value.trim())||(s.name||'').includes(symbol.value.trim()))).reverse();
    cases.replaceChildren(node('h3',`历史同类样本 (${filtered.length} 条，最多展示前100条)`),tabulate([
      ['代码/日期',s=>button(`${s.name||''} ${s.code} · ${s.date}`,()=>showSample(s),'quiet')],['战法',s=>s.signals.map(x=>x.name).join('、')||'未标注（可补标）'],['市场/板块',s=>`${s.labels.marketTrend||'未知'} / ${s.labels.sectorStage||'未知'}`],['样本质量',s=>s.quality],['N日收盘变化',s=>out(s.observed.find(o=>o?.horizon===h)?.closePct,'%')]
    ],filtered.slice(0,100)));
    if(selected){const newer=effective.find(x=>x.id===selected.id);if(newer){selected=newer;showSample(newer);}else detail.replaceChildren();}else detail.replaceChildren();
  }
  function paintArchive(requested=ctx.stock,preserveFilter=false){
    if(!canEdit()||!dataset)return;
    const codes=[...dataset.stocks.keys()];
    const code=requested?(codes.includes(requested)?requested:''):codes[0];
    synced.replaceChildren(node('h2','V6 已同步日线'));
    if(!code){synced.append(node('p','尚无带来源与收盘时点的 V6 未复权日线。','fy-muted'));return;}
    const choose=sel(codes.map(c=>[c,(dataset.stocks.get(c).at(-1).name||c)+' · '+c]));
    choose.value=code;choose.setAttribute('aria-label','选择已同步标的');
    choose.addEventListener('change',()=>{if(!busy&&canEdit())paintArchive(choose.value);});
    const {rows,samples:causal,late,market,sector}=syncedSeries(dataset,code),latest=rows.at(-1);
    sourceMode='synced';records={stock:rows,market:[],sector:[],minute:[]};samples=causal;
    corrections=[];selected=null;reason.value='';target.textContent='未选择要修正的K线';frozenSplit=freezeSplit(samples,{embargo:5});
    sourceFiles={source:'V6 私有短线档案',book,revision:dataset.revision,code};if(!preserveFilter)sampleScope.value='all';
    synced.append(field('已同步标的',choose),miniCandles(rows.slice(-60)),facts([
      ['原始交易日',latest.date],['开 / 高 / 低 / 收', [latest.open,latest.high,latest.low,latest.close].map(x=>fmt(x)).join(' / ')],
      ['成交量（股） / 成交额（元）',out(latest.volume)+' / '+out(latest.amount)],['换手率',out(latest.turnover,'%')],
      ['归档全A趋势',market?.marketTrend],['同期板块 / 助攻',sector?sector.code+' / '+out(sector.assistCount):null],
      ['全A证据可知时间',market?.asOf],['板块证据可知时间',sector?.asOf],['行情来源',latest.source],['数据可知时间（北京时间）',new Date(latest.at+28800000).toISOString().slice(0,19).replace('T',' ')]
    ]));
    status.textContent='读取 '+rows.length+' 根已同步日线，其中 '+causal.length+' 根可还原信号时点；'+late+' 根迟到行情仅供事后图表及其可知时点之后的计算。'+
      (!causal.some(s=>s.market)?' 缺少同期可用的全A证据。':'')+(!causal.some(s=>s.sector)?' 缺少同期可用的板块证据。':'');
    refresh();
  }
  const closeDay=()=>ctx.state?.closeSession?.day||ctx.state?.marketRecovery?.referenceDay||'';
  const archiveKey=()=>[book,closeDay(),ctx.stock||''].join('/');
  let lastArchiveKey='',retryAt=0,reading=false;
  const inUse=()=>busy||sourceMode==='csv'||!!(reason.value||corrections.length||selected||root.matches?.(':focus-within'));
  function clearSynced(){
    dataset=null;synced.replaceChildren();
    if(sourceMode!=='synced')return;
    sourceMode='';records={stock:[],market:[],sector:[],minute:[]};samples=[];selected=null;report=null;corrections=[];sourceFiles={};frozenSplit=null;
    target.textContent='未选择要修正的K线';reason.value='';refresh();
  }
  async function readArchive(background=false){
    if(!canEdit()||typeof ctx.api!=='function'||sourceMode==='csv')return;
    const turn=++sourceToken,requestedBook=book;
    lastArchiveKey=archiveKey();reading=true;retryAt=0;
    if(!background||!dataset)synced.replaceChildren(node('h2','V6 已同步日线'),node('p','正在读取私有研究档案…','fy-muted'));
    try{
      const response=await ctx.api('/api/research/shortline',{method:'GET',signal:ctx.signal,headers:bookHeaders(requestedBook)});
      if(turn!==sourceToken||!canEdit()||activeBook()!==requestedBook)return;
      const returnedBook=response?.state?.book?.id??'main';
      if(response?.ok!==true||response.state?.permissions?.role!=='edit'||returnedBook!==requestedBook){
        clearSynced();
        synced.replaceChildren(node('h2','V6 已同步日线'),node('p','无法读取私有档案，请核对当前账户授权。','fy-muted'));
        return;
      }
      let next=syncedDataset(response.state);
      const code=ctx.stock||(background&&sourceFiles.code)||next.observation?.code||researchCode(ctx);
      if(requestedBook!=='demo'&&(!next.stocks.size||code&&(!next.stocks.has(code)||next.stocks.get(code).at(-1).date<closeDay()))){
        const x=await readAutomatic(ctx,code);
        if(turn!==sourceToken||!canEdit()||activeBook()!==requestedBook||sourceMode==='csv')return;
        const bars=x.stock.bars.map(b=>({...b,role:'stock',period:'日K',code:x.symbol,name:x.name,source:'V6/'+x.provider,priceBasis:'unadjusted',volumeUnit:'shares'}));
        const existing=(response.state.bars||[]).filter(b=>b.role==='stock'&&b.code===x.symbol);
        const recorded=new Set(existing.filter(b=>b.period==='日K'||b.date?.length===10).map(b=>b.date));
        next=syncedDataset({...response.state,bars:[...(response.state.bars||[]),...bars.filter(b=>!recorded.has(b.date))]});
        if(background&&inUse()){lastArchiveKey='';return;}
        dataset=next;paintArchive(x.symbol,background);
      }else{
        if(background&&inUse()){lastArchiveKey='';return;}
        if(background&&dataset?.revision===next.revision&&sourceFiles.code===code&&records.stock.at(-1)?.date===next.stocks.get(code)?.at(-1)?.date)return;
        dataset=next;paintArchive(code,background);
      }
    }catch{
      if(turn===sourceToken&&canEdit()){retryAt=Date.now()+60000;if(!dataset)synced.replaceChildren(node('h2','V6 已同步日线'),node('p','连接恢复后自动重读行情档案。','fy-muted'));}
    }finally{if(turn===sourceToken)reading=false;}
  }
  for(const element of [strategy,environment,quality,horizon,symbol,sampleScope,sampleDate])element.addEventListener(element===symbol?'input':'change',()=>{
    if(element===quality)sampleFor(book,sharedQuality());
    refresh();
  });
  ctx.onState?.(()=>{
    const changedBook=book!==activeBook();
    if(changedBook){
      book=activeBook();sourceToken++;revision++;dataset=null;selected=null;samples=[];records={stock:[],sector:[],market:[],minute:[]};
      sourceMode='';corrections=[];sourceFiles={};report=null;frozenSplit=null;synced.replaceChildren();detail.replaceChildren();reason.value='';
      target.textContent='未选择要修正的K线';status.textContent='已切换研究账户。';
      for(const source of [stocks,sectors,markets,minutes,more])source.file.value='';
      quality.value=legacyQuality(sampleFor(book));setBusy(false);refresh();
    }
    openBacktest.disabled=!canEdit();
    save.disabled=busy||!canEdit();
    if(!canEdit()){
      reason.value='';sourceToken++;clearSynced();
    }else if((!lastAuthorized||changedBook)&&typeof ctx.api==='function'&&sourceMode!=='csv'){
      if(!linkPanel.parentNode&&typeof ctx.navigate==='function')root.append(linkPanel);
      if(!synced.parentNode)root.append(synced);void readArchive();
    }else if(!reading&&!inUse()&&globalThis.navigator?.onLine!==false&&(lastArchiveKey!==archiveKey()||retryAt&&Date.now()>=retryAt))void readArchive(true);
    lastAuthorized=canEdit();
  });
  ctx.signal?.addEventListener('abort',()=>{revision++;sourceToken++;dataset=null;samples=[];records={stock:[],sector:[],market:[],minute:[]};corrections=[];selected=null;report=null;sourceFiles={};frozenSplit=null;for(const source of [stocks,sectors,markets,minutes,more])source.file.value='';setBusy(false);root.replaceChildren();},{once:true});
  if(ctx.signal)globalThis.addEventListener?.('online',()=>{lastArchiveKey='';if(!reading&&!inUse())void readArchive(true);},{signal:ctx.signal});
  setBusy(false);void readArchive();
  return root;
}
