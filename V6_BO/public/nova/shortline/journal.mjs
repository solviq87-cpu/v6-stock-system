import {signals} from './backtest.mjs';
import {buildReview} from './review.mjs';
import {qualityOptions,setOptions,selectedSample,sampleLabel,recordSource,flatLines,flatTemplates,benchNames,journalAction} from './journal-data.mjs';
export {journalAction};
const arr=x=>Array.isArray(x)?x:[];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const civil=s=>String(s||'').slice(0,10);
const cn=t=>new Date(t+8*36e5).toISOString().slice(0,16).replace('T',' ');
const stampDay=v=>{
 if(typeof v==='number'&&Number.isFinite(v))return civil(cn(v));
 if(!v)return '';
 if(typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)){const d=Date.parse(v);return Number.isFinite(d)?civil(cn(d)):'';}
 return civil(v);
};
const validDay=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\d$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const kindNames={all:'全部日志',trade:'交易',backtest:'回测',approval:'审批',flat:'空仓',import:'导入',review:'复盘'};
const val=v=>v==null?'':Array.isArray(v)?v.join('、'):String(v);
export function spreadsheetCsv(records){
 return '\uFEFF'+records.map(row=>row.map(v=>{
  let s=val(v);
  if(typeof v!=='number'&&(/^[\s\uFEFF]*[=+@-]/u.test(s)||/^[\t\r\n]/.test(s)))s="'"+s;
  return '"'+s.replaceAll('"','""')+'"';
 }).join(',')).join('\r\n');
}
function signalArchive(state,date){
 const bars=new Map(arr(state.bars).map(b=>[[b.role||'stock',b.code,b.period||'日K',b.date].join('/'),b]));
 return arr(state.bars).length?signals(state,date).map(s=>{
  const b=bars.get(s.id);
  return {...s,source:b?.source||s.sampleSource||'V6 K线信号规则',sampleSet:s.sampleSet||b?.sampleSet||'正式研究',originalKnownAt:s.originalKnownAt??b?.knownAt};
 }):[];
}
export function journalRows(state,filter={},signalsAtEnd){
 const end=filter.end||civil(cn(Date.now())),start=filter.start||'0001-01-01';
 if(!validDay(start)||!validDay(end)||start>end)throw Error('日志日期范围无效');
 const kind=filter.kind||'all',quality=filter.quality||'all',set=filter.set||'all',q=String(filter.query||'').trim().toLowerCase(),rows=[];
 const emit=(type,date,record,title,detail,source=recordSource(record))=>{
  const d=stampDay(date);if(!d||d<start||d>end||kind!=='all'&&kind!==type||!selectedSample(record,quality,set))return;
  const code=record.code||'',strategy=record.strategy||'',factors=[...arr(record.factors),...arr(record.knownRiskFactors),...arr(record.tags),record.factor].filter(Boolean);
  const refs=[record.id,record.planId,record.tradeId,record.candidateId].filter(Boolean);
  if(filter.code&&code!==filter.code||filter.strategy&&![strategy,...arr(record.strategies)].includes(filter.strategy)||filter.factor&&!factors.some(x=>String(x).includes(filter.factor))||filter.ref&&!refs.includes(filter.ref))return;
  const text=[d,kindNames[type],title,detail,source,code,record.name,...refs,...factors,sampleLabel(record)].map(val).join(' ');
  if(!q||text.toLowerCase().includes(q))rows.push({date:d,type,title,detail,source,sampleSet:sampleLabel(record),id:record.id,code,strategy,dateRef:civil(record.date)||d,factor:filter.factor||factors[0]||''});
 };
 if(['all','trade'].includes(kind))for(const t of arr(state.trades)){
  const title=[t.name,t.code,t.strategy].filter(Boolean).join(' · ');
  if(t.entryTime)emit('trade',t.entryTime,t,'开仓记录 · '+title,'开仓 '+t.entryTime+'，成交价 '+val(t.entryPrice)+'，仓位 '+val(t.position)+'%');
  emit('trade',t.exitTime||t.date,t,'离场记录 · '+title,[t.exitTime,t.exitReason,typeof t.pnl==='number'?'结算 '+t.pnl.toFixed(2)+'%':'',arr(t.violations).join('、')].filter(Boolean).join(' · '));
 }
 if(['all','backtest'].includes(kind)){
  for(const s of signalsAtEnd||signalArchive(state,end))emit('backtest',s.date,s,s.name+' '+s.code+' · '+s.strategy,'按原时点规则计算 · '+s.date+' · '+(s.type||'')+' · '+val(s.period),s.source);
  for(const r of arr(state.corrections))emit('backtest',r.recordedAt,r,'人工信号修订 · '+r.mode,[r.id,r.date,r.strategy,r.reason].filter(Boolean).join(' · '),'研究标注存档');
 }
 if(['all','approval'].includes(kind)){
  for(const c of arr(state.candidates)){
   emit('approval',c.createdAt,c,'候选验证',c.id+' · '+arr(c.steps).map(step=>step.name+' '+step.status).join('、'),'验证记录');
   if(c.decision)emit('approval',c.decision.at,c,c.status,[c.id,c.decision.reviewer,c.decision.reason].filter(Boolean).join(' · '),'人工审批');
  }
  for(const v of arr(state.versions))if(v.approvedAt)emit('approval',v.approvedAt,v,'批准版本 V'+v.number,[v.candidateId,v.reviewer,v.reason].filter(Boolean).join(' · '),'版本档案');
 }
 for(const r of arr(state.flatRecords))emit('flat',r.end,r,r.template,flatLines(state,r).join(' · '));
 for(const r of arr(state.notes))emit('review',r.date,r,r.title||'复盘笔记',String(r.text||'').slice(0,6000),'复盘存档');
 for(const b of arr(state.importBatches))emit('import',b.knownAt,b,b.fileName,b.kind+' · 新增 '+b.count+' 条 · 原交易日 '+arr(b.days).join('、'),b.source);
 return rows.sort((a,b)=>b.date.localeCompare(a.date)||a.type.localeCompare(b.type));
}
const encoder=new TextEncoder();
const crcTable=Uint32Array.from({length:256},(_,i)=>{
 let n=i;for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;
});
function crc32(bytes){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
const header=n=>{const b=new Uint8Array(n),d=new DataView(b.buffer);return {b,u16:(offset,v)=>d.setUint16(offset,v,true),u32:(offset,v)=>d.setUint32(offset,v,true)};};
export function zipFiles(files){
 const local=[],central=[];let offset=0,centralSize=0;
 for(const [name,text] of files){
  const fname=encoder.encode(name),bytes=encoder.encode(text),crc=crc32(bytes),lh=header(30),ch=header(46);
  lh.u32(0,0x04034b50);lh.u16(4,20);lh.u16(6,0x800);lh.u16(12,33);lh.u32(14,crc);lh.u32(18,bytes.length);lh.u32(22,bytes.length);lh.u16(26,fname.length);
  ch.u32(0,0x02014b50);ch.u16(4,20);ch.u16(6,20);ch.u16(8,0x800);ch.u16(14,33);ch.u32(16,crc);ch.u32(20,bytes.length);ch.u32(24,bytes.length);ch.u16(28,fname.length);ch.u32(42,offset);
  local.push(lh.b,fname,bytes);central.push(ch.b,fname);offset+=30+fname.length+bytes.length;centralSize+=46+fname.length;
 }
 const e=header(22);e.u32(0,0x06054b50);e.u16(8,files.length);e.u16(10,files.length);e.u32(12,centralSize);e.u32(16,offset);
 const out=new Uint8Array(offset+centralSize+22);let i=0;for(const part of [...local,...central,e.b]){out.set(part,i);i+=part.length;}return out;
}
export function dailyExport(state,date,filters={}){
 if(!validDay(date)||date>civil(cn(Date.now())))throw Error('导出日期无效');
 const {quality='all',set='all'}=filters;
 if(!Object.hasOwn(qualityOptions,quality)||!Object.hasOwn(setOptions,set))throw Error('样本筛选无效');
 const report=buildReview(state,{date,depth:'deep',period:'day',quality,set});
 const trades=[['交易日期','事件','标的代码','名称','战法','发生时间','成交价','仓位%','已结算盈亏%','已结算金额','来源','样本集','质量','记录ID','入库时间']];
 for(const t of arr(state.trades).filter(r=>selectedSample(r,quality,set))){
  const emit=(event,time,price,isExit)=>trades.push([date,event,t.code,t.name,t.strategy,time,price,t.position,isExit?t.pnl:null,isExit?t.pnlAmount:null,recordSource(t),sampleLabel(t),t.quality,t.id,t.createdAt]);
  if(civil(t.entryTime)===date)emit('开仓',t.entryTime,t.entryPrice,false);
  if(civil(t.exitTime||t.date)===date)emit('离场',t.exitTime||t.date,t.exitPrice,true);
 }
 const sig=[['信号日','代码','标的','战法','类型','周期','来源','样本集','质量','原始数据取得时间','观察截止','跟踪窗口','收益%','最大上涨%','最低回撤%','窗口末日']];
 const signalRows=signalArchive(state,date);
 for(const s of signalRows.filter(r=>selectedSample(r,quality,set)&&(civil(r.date)===date||Object.values(r.outcomes||{}).some(o=>civil(o?.end)===date)))){
  for(const n of [1,2,3,5,10]){
   const o=s.outcomes?.[n];if(civil(s.date)!==date&&civil(o?.end)!==date)continue;
   const visible=o&&civil(o.end)<=date&&(!o.availableAt||stampDay(o.availableAt)<=date);
   sig.push([s.date,s.code,s.name,s.strategy,s.type,s.period,s.source,sampleLabel(s),s.quality,Number.isFinite(s.originalKnownAt)?cn(s.originalKnownAt):'',date,n,visible?o.close:null,visible?o.high:null,visible?o.low:null,visible?o.end:null]);
  }
 }
 const events=[['日期','类别','标题','内容','来源','样本集','编号'],...journalRows(state,{start:date,end:date,quality,set},signalRows).map(e=>[e.date,kindNames[e.type],e.title,e.detail,e.source,e.sampleSet,e.id])];
 const doc=report.text+'\n\n## 导出范围\n\n- 样本集 '+setOptions[set]+'，质量 '+qualityOptions[quality]+'。\n- 交易表按当天开仓和离场事件，未结算收益留空。回测表包含当天触发或跟踪期于当天结束的信号，未成熟窗口留空。\n- 导出时间（北京时间） '+cn(Date.now())+'。\n';
 return zipFiles([['当日复盘.md',doc],['交易记录.csv',spreadsheetCsv(trades)],['回测结果.csv',spreadsheetCsv(sig)],['日志.csv',spreadsheetCsv(events)]]);
}

const options=(map,selected)=>Object.entries(map).map(([k,v])=>'<option value="'+esc(k)+'"'+(selected===k?' selected':'')+'>'+esc(v)+'</option>').join('');
export function renderJournal(ui){
 const today=civil(cn(Date.now())),selected=validDay(ui.date)&&ui.date<=today?ui.date:today;
 const filter={start:'',end:selected,query:'',kind:'all',quality:Object.hasOwn(qualityOptions,ui.sampleFilter)?ui.sampleFilter:'all',set:'all',code:ui.stock||'',strategy:ui.strategy||'',factor:ui.factor||'',ref:ui.ref||''};let limit=50;
 function draw(){
  const r=ui.root,f=ui.state;const periodStart=validDay(filter.start)?filter.start:'0001-01-01';
  const contextInputs=Object.entries({code:'证券代码',strategy:'战法',factor:'因子',ref:'记录编号'}).map(([k,l])=>'<label class="field">'+l+'<input data-j="'+k+'" value="'+esc(filter[k])+'"></label>').join('');
  r.innerHTML='<section class="panel"><h2>研究日志</h2><div class="grid2"><label class="field">开始日期<input data-j="start" type="date" value="'+esc(filter.start)+'"></label><label class="field">截止 / 导出日<input data-j="end" type="date" value="'+esc(filter.end)+'"></label><label class="field">日志类别<select data-j="kind">'+options(kindNames,filter.kind)+'</select></label><label class="field">质量<select data-j="quality">'+options(qualityOptions,filter.quality)+'</select></label><label class="field">样本集<select data-j="set">'+options(setOptions,filter.set)+'</select></label><label class="field">关键词<input data-j="query" type="search" placeholder="代码、战法、审批人、原因" value="'+esc(filter.query)+'"></label></div><details'+([filter.code,filter.strategy,filter.factor,filter.ref].some(Boolean)?' open':'')+'><summary>标的与来源记录筛选</summary><div class="grid2">'+contextInputs+'</div></details><p><button class="btn" data-search>检索</button> <button class="btn" data-flat>填写空仓手记</button> <button class="btn primary" data-zip>导出当日 ZIP</button></p><p role="status" data-status></p></section><section class="panel"><div data-results></div></section>';
  const status=t=>{r.querySelector('[data-status]').textContent=t;};
  function results(){
   try{
    const rows=journalRows(f,{...filter,start:filter.start||'0001-01-01'});
    r.querySelector('[data-results]').innerHTML='<h3>检索结果 · '+rows.length+' 条</h3>'+rows.slice(0,limit).map((x,index)=>'<details><summary>'+esc(x.date)+' · '+esc(kindNames[x.type])+' · '+esc(x.title)+'</summary><p>'+esc(x.detail)+'</p><small>'+esc(x.source)+' · '+esc(x.sampleSet)+'</small><p>'+[['trade','trades','交易样本'],['backtest','backtest','回测详情'],['review','review','复盘记录'],['flat','review','同期复盘'],['approval','versions','审批记录']].filter(([kind])=>kind===x.type).map(([,route,label])=>'<button class="btn" data-destination="'+route+'" data-row="'+index+'">'+label+'</button>').join('')+(x.code?'<button class="btn" data-destination="structure" data-row="'+index+'">同期题材结构</button>':'')+'</p></details>').join('')+(rows.length>limit?'<button class="btn" data-more>再显示 50 条</button>':'');
    for(const b of r.querySelectorAll('[data-destination]'))b.onclick=()=>{const row=rows[Number(b.dataset.row)];ui.open(b.dataset.destination,{code:row.code,date:row.dateRef||row.date,sample:filter.quality,strategy:row.strategy,factor:filter.factor||row.factor,ref:row.id});};
    const more=r.querySelector('[data-more]');if(more)more.onclick=()=>{limit+=50;results();};status('');
   }catch(e){r.querySelector('[data-results]').replaceChildren();status(e.message);}
  }
  for(const el of r.querySelectorAll('[data-j]'))el.onchange=()=>{filter[el.dataset.j]=el.value;if(el.dataset.j==='quality')ui.setSample?.(el.value);limit=50;results();};
  r.querySelector('[data-j=query]').onkeydown=e=>{if(e.key==='Enter'){filter.query=e.target.value;limit=50;results();}};
  r.querySelector('[data-search]').onclick=()=>{for(const e of r.querySelectorAll('[data-j]'))filter[e.dataset.j]=e.value;limit=50;results();};
  r.querySelector('[data-flat]').onclick=()=>ui.modal('填写空仓手记','<div class="grid2"><label class="field">空仓首日<input type="date" name="start" required value="'+esc(filter.end)+'"></label><label class="field">空仓末日<input type="date" name="end" required value="'+esc(filter.end)+'"></label><label class="field">原因模板<select name="template">'+options(Object.fromEntries(flatTemplates.map(t=>[t,t])),flatTemplates[0])+'</select></label><label class="field">比较指数<select name="benchmark">'+options(benchNames,'000985')+'</select></label></div><label class="field">当时选择空仓的依据<textarea name="reason" required maxlength="1000"></textarea></label><label class="field">恢复观察条件<textarea name="watch" maxlength="1000"></textarea></label><label class="field">同期账户盈亏（选填，人工自报，元）<input name="reportedPnl" type="number" step=".01"></label><p>基准使用同一来源的区间首日开盘及末日收盘。已观察收盘序列回撤独立列示；不会计入账户盈利。</p>',async fd=>{await ui.save('journal:flat',Object.fromEntries(fd));Object.assign(filter,{kind:'flat',query:'',code:'',strategy:'',factor:'',ref:'',start:fd.get('start'),end:fd.get('end'),quality:'all',set:'all'});ui.setSample?.('all');ui.toast('空仓手记已保存');draw();});
  r.querySelector('[data-zip]').onclick=()=>{try{ui.download('V6-复盘-'+filter.end+'.zip',dailyExport(f,filter.end,filter),'application/zip');status('已生成 Markdown 与三张 CSV 表');}catch(e){status(e.message);}};
  if(periodStart>filter.end)status('日期范围无效');else results();
 }
 draw();
}
