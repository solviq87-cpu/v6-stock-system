import {sampleMatches,isTestSample} from './sample-quality.mjs';

const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
const DAY=86400000;
const validCode=c=>typeof c==='string'&&/^\d{6}$/.test(c);
const validDay=d=>typeof d==='string'&&dayPattern.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d;
const finite=Number.isFinite;
const positive=x=>finite(x)&&x>0;
const pct=x=>Math.round(x*100)/100;
const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=x=>{
  if(Number.isSafeInteger(x)&&x>0)return x;
  if(typeof x!=='string'||!validDay(x.slice(0,10)))return NaN;
  if(x.length===10)return Date.parse(x+'T15:00:00+08:00');
  const t=x.replace(' ','T');
  if(!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(t))return NaN;
  return Date.parse(/Z|[+-]\d\d:\d\d$/.test(t)?t:t+'+08:00');
};
const wall=n=>finite(n)?new Date(n+8*3600000).toISOString().slice(0,16).replace('T',' '):'未取得';
const categories=['减持','问询','监管','解禁','商誉'];
const ratio=(x,min,max)=>finite(x)&&x>=min&&x<=max;
const metaKeys=new Set(['knownAt','lastSeenAt']);

// Historical receipts can be later than their trade dates. They remain visible
// on later reviews; the signal-time projection passes its own cutoff below.
export function chipHistory(bars,code,day,asOf){
  const cut=clock(asOf);
  if(!validCode(code)||!validDay(day)||!finite(cut))return [];
  const dated=new Map(),conflicts=new Set();
  for(const b of bars||[]){
    if(b.code!==code||(b.role&&b.role!=='stock')||!validDay(b.date)||b.date>day||clock(b.date)>cut||
       !['日K','1d','D','daily',undefined].includes(b.period)||b.priceBasis&&b.priceBasis!=='unadjusted')continue;
    const marks=[b.knownAt,b.availableAt].filter(x=>x!=null).map(clock);
    if(!marks.length||marks.some(t=>!finite(t)||t>cut))continue;
    const knownAt=Math.max(clock(b.date),...marks);
    const prior=dated.get(b.date);
    if(prior&&['high','low','close','volume','chipPeak'].some(k=>prior[k]!==b[k])){conflicts.add(b.date);continue;}
    if(!prior||prior.knownAt>knownAt)dated.set(b.date,{...b,knownAt});
  }
  const rows=[...dated.values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-80);
  let window=[];
  const out=[];
  for(const row of rows){
    if(conflicts.has(row.date)||!positive(row.close)||!positive(row.low)||!positive(row.high)||row.high<row.close||row.low>row.close||!positive(row.volume)){
      window=[];continue;
    }
    window.push(row);if(window.length>20)window.shift();
    if(positive(row.chipPeak)){
      const knownAt=Math.max(row.knownAt,clock(row.chipKnownAt??row.knownAt));
      if(knownAt<=cut)out.push({id:'chip/'+row.date+'/raw',code,date:row.date,kind:'raw',peak:row.chipPeak,close:row.close,
        source:String(row.chipSource||row.sampleSource||row.source||'导入文件原字段 chipPeak').slice(0,150),knownAt,
        ...(ratio(row.lockedRatio,0,100)?{lockedRatio:row.lockedRatio}:{})});
      continue;
    }
    if(window.length<20||new Set(window.map(b=>b.volumeUnit||'同批原始量')).size!==1)continue;
    // Divide the 20-bar price range into 32 bins. Distribute each bar's
    // volume uniformly across its traded range, proportionally to overlap.
    const low=Math.min(...window.map(r=>r.low)),high=Math.max(...window.map(r=>r.high));
    const width=(high-low)/32,counts=Array(32).fill(0);
    const slot=p=>Math.max(0,Math.min(31,Math.floor((p-low)/width)));
    for(const b of window){
      if(!width||b.high===b.low){counts[width?slot(b.close):0]+=b.volume;continue;}
      for(let i=slot(b.low);i<=slot(b.high);i++){
        const overlap=Math.min(b.high,low+(i+1)*width)-Math.max(b.low,low+i*width);
        counts[i]+=b.volume*Math.max(0,overlap)/(b.high-b.low);
      }
    }
    const best=Math.max(...counts),indices=counts.map((v,i)=>v>=best*(1-1e-9)?i:-1).filter(i=>i>=0);
    if(width&&indices.length!==1)continue; // No unique mode.
    const peak=width?low+width*(indices[0]+.5):low;
    out.push({id:'chip/'+row.date+'/estimate',code,date:row.date,kind:'estimate',peak:pct(peak),close:row.close,
      knownAt:Math.max(...window.map(r=>r.knownAt)),source:'20日成交量价格分布估算 · '+[...new Set(window.map(r=>r.source||r.sampleSource||'导入日K'))].join(' / ').slice(0,150)});
  }
  return out.slice(-60);
}

function signature(x){return JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k])=>!metaKeys.has(k)).sort(([a],[b])=>a.localeCompare(b))));}
function collect(original,incoming){
  const entries=[...original,...incoming].filter(x=>x?.id&&Number.isSafeInteger(x.knownAt)).sort((a,b)=>a.knownAt-b.knownAt||a.id.localeCompare(b.id));
  const previous=new Map(),out=[];
  for(const x of entries){
    const value=signature(x);
    if(previous.get(x.id)===value)continue;
    previous.set(x.id,value);out.push(x);
  }
  return out;
}
export function mergePressureHistory(state,report){
  if(!report||!validCode(report.code)||!validDay(report.day)||!Number.isSafeInteger(report.knownAt))return;
  const rows=state.pressureHistory??=[];
  let dest=rows.find(x=>x.code===report.code&&x.day===report.day);
  if(!dest){
    dest={code:report.code,day:report.day,knownAt:report.knownAt,clues:[],facts:[],coverage:[],chipSeries:[]};
    rows.push(dest);
  }
  if(report.name)dest.name=String(report.name).slice(0,60);
  dest.knownAt=Math.min(dest.knownAt,report.knownAt);
  for(const key of ['clues','facts','coverage','chipSeries']){
    const incoming=(report[key]||[]).filter(x=>x.code===report.code&&x.knownAt<=report.knownAt&&(key!=='chipSeries'||x.date===report.day));
    dest[key]=collect(dest[key],incoming);
  }
}
function latestVersions(rows,cut){
  const byId=new Map();
  for(const r of rows)if(r.knownAt<=cut&&(!byId.has(r.id)||byId.get(r.id).knownAt<r.knownAt))byId.set(r.id,r);
  return [...byId.values()];
}
const archiveIndex=new WeakMap();
function reportsForCode(state,code){
  const archive=state.pressureHistory||[],current=state.v6Observation?.stock?.pressure;
  let index=archiveIndex.get(archive);
  if(!index||index.count>archive.length){index={count:0,groups:new Map()};archiveIndex.set(archive,index);}
  for(;index.count<archive.length;index.count++){
    const r=archive[index.count];
    if(!index.groups.has(r.code))index.groups.set(r.code,[]);
    index.groups.get(r.code).push(r);
  }
  return [...(index.groups.get(code)||[]),...(current?.code===code?[current]:[])];
}
function reportsOf(state){
  const current=state.v6Observation?.stock?.pressure;
  return [...(state.pressureHistory||[]),...(current?[current]:[])];
}
export function confirmedFact(f,code,day,cutoff){
  if(!f||f.code!==code||f.verified!==true||!categories.includes(f.category)||!f.source||!f.description||
     !validDay(f.expires)||f.expires<day||!validDay(f.eventDay)||!Number.isSafeInteger(f.knownAt)||f.knownAt>cutoff)return false;
  const published=f.publishedAt,updated=f.sourceUpdatedAt;
  if([published,updated].some(t=>t!=null&&(!Number.isSafeInteger(t)||t<=0||t>f.knownAt)))return false;
  if(f.category==='解禁')return Number.isSafeInteger(updated);
  if(f.eventDay>day||Date.parse(f.eventDay+'T00:00:00+08:00')>f.knownAt)return false;
  return f.category==='减持'||Number.isSafeInteger(published);
}
export function addPressureRiskFacts(report,code,asOf,facts){
  const cutoff=clock(asOf);
  if(!facts||!validCode(code)||report?.code!==code||!validDay(report.day)||!finite(cutoff)||!(report.knownAt<=cutoff))return facts;
  const day=new Date(cutoff+8*3600000).toISOString().slice(0,10);
  if(report.day>day)return facts;
  for(const f of latestVersions(report.facts||[],cutoff)){
    if(!confirmedFact(f,code,day,cutoff))continue;
    let key='';
    if(f.category==='减持'&&f.factorCode==='GG-01')key='56:0';
    if(f.category==='问询'&&f.riskTag==='问询函披露')key='56:1';
    if(f.category==='监管'&&f.riskTag==='监管函披露')key='49:2';
    if(f.category==='商誉'&&f.unit==='%净资产'&&finite(f.value)&&f.riskTag==='高商誉（≥30%净资产）')key='56:5';
    if(key&&!facts.get(key)?.pass)facts.set(key,{pass:true,source:f.source+' · '+f.description+' · '+f.eventDay+' · 首次可知 '+wall(f.knownAt)});
  }
  return facts;
}
export function pressureLearningTags(state,{code,date},asOf){
  const day=String(date||'').slice(0,10),cut=clock(asOf);
  if(!validCode(code)||!validDay(day)||!finite(cut))return [];
  const eligible=reportsForCode(state,code).filter(r=>r.day<=day&&r.knownAt<=cut);
  const facts=latestVersions(eligible.flatMap(r=>r.facts||[]),cut);
  const tags=new Set();
  for(const f of facts){
    if(!confirmedFact(f,code,day,cut)||!f.riskTag)continue;
    tags.add('压力·'+f.riskTag);
  }
  // Only a close that existed by the decision time can describe cost position.
  const chips=latestVersions(eligible.flatMap(r=>r.chipSeries||[]),cut).filter(x=>x.code===code&&x.date<=day&&Date.parse(day)-Date.parse(x.date)<=10*DAY&&positive(x.peak)&&positive(x.close));
  const chip=chips.sort((a,b)=>b.date.localeCompare(a.date)||Number(b.kind==='raw')-Number(a.kind==='raw'))[0];
  if(chip)tags.add('筹码·'+(chip.kind==='raw'?'原始':'估算')+'峰'+(chip.close===chip.peak?'平价':chip.close>chip.peak?'上方收盘':'下方收盘'));
  return [...tags].sort();
}

const safeUrl=s=>typeof s==='string'&&/^https:\/\/(?:data\.eastmoney\.com\/(?:notices\/detail\/\d{6}\/AN\d+\.html|sy\/list\.html|dxf\/q\/\d{6}\.html|executive\/\d{6}\.html)|static\.cninfo\.com\.cn\/finalpage\/\d{4}-\d\d-\d\d\/\d+\.pdf)$/.test(s);
function chipChart(chips){
  const rows=[...chips].sort((a,b)=>a.date.localeCompare(b.date));
  const days=[...new Set(rows.map(x=>x.date))],prices=rows.map(x=>x.peak);
  if(days.length<2)return '';
  const lo=Math.min(...prices),hi=Math.max(...prices),range=hi-lo||Math.max(lo*.01,.01);
  const x=d=>45+445*days.indexOf(d)/(days.length-1),y=p=>112-96*(p-lo)/range;
  const lines=['estimate','raw'].map(kind=>{
    const color=kind==='raw'?'#cf74c1':'#8e94ed';
    const points=rows.filter(r=>r.kind===kind);
    if(!points.length)return '';
    return '<polyline fill="none" stroke="'+color+'" stroke-width="2" points="'+points.map(r=>x(r.date).toFixed(1)+','+y(r.peak).toFixed(1)).join(' ')+'"/>'+
      points.map(r=>'<circle r="2.8" fill="'+color+'" cx="'+x(r.date).toFixed(1)+'" cy="'+y(r.peak).toFixed(1)+'"><title>'+escape(r.date+' · '+r.peak+'元')+'</title></circle>').join('');
  }).join('');
  return '<figure style="margin:0"><svg viewBox="0 0 510 143" role="img" aria-label="所选标的筹码峰价格随交易日变化" style="width:100%;max-height:15rem">'+
    '<path d="M42 10V114H495" fill="none" stroke="currentColor" opacity=".35"/>'+lines+
    '<g fill="currentColor" font-size="10"><text x="2" y="16">'+pct(lo+range)+'</text><text x="2" y="114">'+pct(lo)+'</text><text x="42" y="135">'+days[0]+'</text><text x="490" text-anchor="end" y="135">'+days.at(-1)+'</text></g></svg>'+
    '<figcaption><span style="color:#cf74c1">● 原字段</span>　<span style="color:#8e94ed">● 20日量价估算</span>（元）</figcaption></figure>';
}
export function renderPressure(ui){
  const {state,root}=ui;
  const reports=reportsOf(state),realBars=(state.bars||[]).filter(b=>(!b.role||b.role==='stock')&&validCode(b.code)&&isTestSample(b)===(state.scope==='demo')&&sampleMatches(b,ui.sampleFilter||'all'));
  const days=[...new Set([...reports.map(r=>r.day),...realBars.map(b=>b.date)].filter(validDay))].sort().reverse();
  let day=days.includes(ui.date)?ui.date:days[0],selected=ui.stock||'',showCategory='',archived=day===days[0];
  function paint(){
    const current=Date.now(),cutoff=!archived&&validDay(day)?Math.min(current,clock(day+' 15:00')):current;
    const rows=reports.filter(r=>r.day===day&&r.knownAt<=cutoff);
    const codes=[...new Set([...rows.map(r=>r.code),...realBars.filter(b=>b.date===day).map(b=>b.code)])].sort();
    if(!codes.includes(selected))selected=codes[0]||'';
    const options=(values,current)=>values.map(v=>'<option'+(v===current?' selected':'')+'>'+escape(v)+'</option>').join('');
    const button=(id,label)=>'<button type="button" class="btn" data-pressure="'+id+'">'+label+'</button>';
    const combined=(code,k)=>latestVersions(rows.filter(r=>r.code===code).flatMap(r=>r[k]||[]),cutoff);
    const included=x=>!showCategory||x.category===showCategory;
    const cases=rows.length?codes.map(code=>{
      const cf=combined(code,'facts').filter(included),cl=combined(code,'clues').filter(included);
      const status=combined(code,'coverage');
      return '<tr><td><button class="btn" data-symbol="'+escape(code)+'">'+escape(code)+'</button></td><td>'+escape(rows.find(r=>r.code===code)?.name||'—')+'</td><td>'+cf.length+'</td><td>'+cl.length+'</td><td>'+escape(status.map(c=>c.label+' '+c.status).join(' · ')||'待采集')+'</td></tr>';
    }).join(''):'';
    const facts=combined(selected,'facts').filter(included),clues=combined(selected,'clues').filter(included);
    const item=x=>'<li><strong>'+escape(x.category)+'</strong> · '+escape(x.description||x.title)+'<br><small>'+escape(x.source)+' · '+escape(x.eventDay||'')+' · 首次可知 '+wall(x.knownAt)+'</small> '+(safeUrl(x.url)?'<a href="'+escape(x.url)+'" target="_blank" rel="noopener noreferrer">查看来源</a>':'')+'</li>';
    const candidates=reports.filter(r=>r.code===selected&&r.day<=day).flatMap(r=>r.chipSeries||[]).concat(chipHistory(realBars,selected,day,cutoff));
    const chips=latestVersions(candidates,cutoff).filter(x=>x.date<=day&&x.code===selected).sort((a,b)=>b.date.localeCompare(a.date)||a.kind.localeCompare(b.kind)).slice(0,60);
    root.innerHTML='<section class="panel"><h2>候选压力面</h2><p>观测截止 '+wall(cutoff)+'（北京）</p><div class="actions"><label>交易日 <select data-pfield="day">'+options(days,day)+'</select></label><label>资料时点 <select data-pfield="archive"><option value="close"'+(!archived?' selected':'')+'>当日15:00</option><option value="now"'+(archived?' selected':'')+'>目前存档（含后补）</option></select></label><label>范围 <select data-pfield="category"><option value="">全部类型</option>'+options(categories,showCategory)+'</select></label></div>'
      +(cases?'<div class="table-wrap"><table><thead><tr><th>代码</th><th>名称</th><th>已核字段</th><th>标题线索</th><th>公开源覆盖</th></tr></thead><tbody>'+cases+'</tbody></table></div>':'<p>该日尚无候选扫描回执。</p>')+'</section>'
      +'<section class="panel"><h3>个股压力明细</h3><div class="actions"><label>标的 <select data-pfield="code">'+options(codes,selected)+'</select></label>'+button('new','查看校验')+button('backtest','查看回测')+'</div><h4>已核实的披露字段</h4>'+(facts.length?'<ul>'+facts.map(item).join('')+'</ul>':'<p>当前范围没有已核实的结构化记录。</p>')+'<h4>公告标题线索</h4>'+(clues.length?'<ul>'+clues.map(item).join('')+'</ul>':'<p>当前范围没有可展示的标题线索。</p>')+'</section>'
      +'<section class="panel"><h3>筹码峰时序</h3>'+(chips.length?chipChart(chips)+'<div class="table-wrap"><table><thead><tr><th>交易日</th><th>筹码峰（元）</th><th>收盘（元）</th><th>口径 / 来源</th><th>首次可知（北京）</th></tr></thead><tbody>'+chips.map(p=>'<tr><td>'+escape(p.date)+'</td><td>'+escape(p.peak)+'</td><td>'+escape(p.close)+'</td><td>'+escape((p.kind==='raw'?'原字段 · ':'估算 · ')+p.source)+'</td><td>'+wall(p.knownAt)+'</td></tr>').join('')+'</tbody></table></div>':'<p>尚无原始筹码字段或具有唯一成交量峰值的20根可用日K。</p>')+'</section>';
    for(const e of root.querySelectorAll('[data-symbol]'))e.onclick=()=>{selected=e.dataset.symbol;paint();};
    root.querySelector('[data-pfield=day]').onchange=e=>{day=e.target.value;archived=false;paint();};
    root.querySelector('[data-pfield=archive]').onchange=e=>{archived=e.target.value==='now';paint();};
    root.querySelector('[data-pfield=code]').onchange=e=>{selected=e.target.value;paint();};
    root.querySelector('[data-pfield=category]').onchange=e=>{showCategory=e.target.value;paint();};
    for(const e of root.querySelectorAll('[data-pressure]')){e.disabled=!selected;e.onclick=()=>ui.open(e.dataset.pressure,{code:selected,date:day});}
  }
  paint();
}
