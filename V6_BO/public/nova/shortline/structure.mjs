import * as shared from './structure-core.js';
import {thsStockLink,thsBoardLink} from './quote-links.mjs';
export {thsStockLink,thsBoardLink};
import {asTime,highEvents,classifyBreak,sectorIdsFor,styleRotation} from './structure-events.mjs';
import {signals} from './backtest.mjs';
import {sampleMatches,isTestSample} from './sample-quality.mjs';

const {references,groupPool,canonicalTheme}=shared.default||globalThis.V6ShortlineStructure;
const wall=t=>new Date(t+28800000).toISOString().slice(0,16).replace('T',' ');
const codeOK=code=>typeof code==='string'&&/^\d{6}$/.test(code);
const validDate=day=>typeof day==='string'&&/^\d{4}-\d\d-\d\d$/.test(day)&&Number.isFinite(asTime(day))&&new Date(day).toISOString().slice(0,10)===day;
function imported(batch){
  return {date:batch.tradeDate,knownAt:batch.knownAt,provider:batch.provider,source:batch.source,scope:batch.scope,complete:false,id:batch.id,totalCount:null,
    sealed:(batch.rows||[]).filter(r=>r.tradeDate===batch.tradeDate&&codeOK(r.code)).map(r=>({...r,level:r.streak,firstSealTime:r.firstSeal,lastSealTime:r.lastSeal,
      refs:references(r.theme,{provider:batch.provider,boardCode:r.boardCode})})),broken:[],brokenComplete:false};
}
export function datedPools(state,day,at=Date.now(),sampleSet='all'){
  const cutoff=asTime(at);if(!validDate(day)||!Number.isFinite(cutoff))return [];
  const frameId=p=>JSON.stringify([p.date,p.provider,p.scope,p.id||'']);
  const byId=new Map();
  function add(p){
    if(!p||!Array.isArray(p.sealed)||!validDate(p.date)||p.date>day||!Number.isFinite(asTime(p.knownAt))||asTime(p.knownAt)>cutoff||
      sampleSet!=='all'&&(sampleSet==='test')!==isTestSample(p))return;
    const key=frameId(p),prior=byId.get(key);if(!prior||asTime(prior.knownAt)<=asTime(p.knownAt))byId.set(key,p);
  }
  for(const row of [...(state.marketHistory||[]),...(state.market||[])]){
    if(!validDate(row.date)||row.date>day)continue;
    const structure=row.structurePools||[];
    for(const p of structure)if(p.date===row.date)add(p);
    if(!structure.length&&row.themes?.length){
      const atKnown=asTime(row.knownAt??row.availableAt);if(!(atKnown<=cutoff))continue;
      const members=[];
      for(const g of row.themes)for(const m of g.members||[]){
        const kind=/行业/.test(g.classification)?'industry':'theme';
        members.push({...m,refs:references(g.refs?.length?g.refs:[g.name],{provider:g.classification||row.source,kind})});
      }
      add({date:row.date,previousDay:row.previousDay,knownAt:atKnown,provider:'legacy',source:row.source,scope:'历史复盘中列出的题材成员',complete:false,sealed:members,broken:[]});
    }
  }
  for(const batch of state.importedLimitPools||[])add(imported(batch));
  return [...byId.values()].sort((a,b)=>a.date.localeCompare(b.date)||String(a.scope).localeCompare(String(b.scope)));
}
function knownMembership(state,frames,code,day,at){
  const refs=[];
  for(const f of frames)if(f.date===day)for(const row of f.sealed)if(row.code===code)refs.push(...references(row.refs||[],{provider:f.source}));
  const observed=state.v6Observation;
  if(observed?.code===code&&observed.day===day&&asTime(observed.observedAtMs??observed.observedAt)<=at){
    refs.push(...references(observed.stock?.themeRefs||[]));
    if(observed.stock?.industry)refs.push(...references(observed.stock.industry,{provider:'V6逐股行业',kind:'industry'}));
  }
  for(const bar of state.bars||[])if((!bar.role||bar.role==='stock')&&bar.code===code&&bar.date===day&&asTime(bar.knownAt??bar.availableAt)<=at){
    if(bar.theme||bar.themeRefs)refs.push(...references(bar.themeRefs||bar.theme,{provider:bar.source||'归档逐股题材'}));
    if(bar.industry)refs.push(...references(bar.industry,{provider:bar.source||'归档逐股行业',kind:'industry'}));
  }
  return references(refs);
}
export function structureForStock(state,code,day,at=Date.now()){
  if(!codeOK(code))return [];
  const frames=datedPools(state,day,at),seen=new Map(),refs=knownMembership(state,frames,code,day,asTime(at));
  for(const f of frames.filter(p=>p.date===day)){
    const prev=frames.find(p=>p.date===f.previousDay&&p.provider===f.provider&&p.scope===f.scope);
    for(const g of groupPool(f,prev)){
      const matches=refs.filter(r=>r.name===g.name&&r.kind===g.kind);
      if(!g.members.some(m=>m.code===code)&&!matches.length)continue;
      const key=[f.provider,f.scope,f.id||'',g.key].join('/');
      seen.set(key,{...g,stockReferences:matches,peers:g.members.filter(m=>m.code!==code),verification:thsBoardLink(g)});
    }
  }
  return [...seen.values()];
}
export function structureDemo(){
  const days=['2025-07-16','2025-07-17','2025-07-18','2025-07-21'];
  const codes=['600101','600102','600103','600104'];
  return days.map((date,i)=>{
    const knownAt=asTime(date+' 15:15'),s=(j,level,time,name='算力')=>({code:codes[j],name:'教学标的'+(j+1),level,firstSealTime:time,close:11+j,upLimit:11+j,change:9.99,refs:references(name,{provider:'demo'}),sampleSet:'test'});
    const sealed=[[s(0,2,'09:38'),s(1,1,'10:15','AI算力')],[s(0,3,'09:40'),s(2,1,'13:02','AI算力')],[s(2,2,'09:52','AI算力'),s(3,1,'13:16','芯片')],[s(0,1,'10:16'),s(3,2,'09:55','半导体')]][i];
    return {date,previousDay:days[i-1],knownAt,provider:'demo',source:'教学演示',scope:'合成教学股票池',sampleSet:'test',complete:true,totalCount:sealed.length,sealed,
      broken:i===2?[s(0,null,'09:35')]:[],brokenComplete:true,outcomes:i===2?{[codes[0]]:{sealed:false,change:-7.11,knownAt,source:'教学演示'}}:{}};
  });
}
const views=new WeakMap();
const columns=(values,esc)=>values.map(v=>'<td>'+esc(v??'待核实')+'</td>').join('');
const value=x=>x==null?'—':x;
export function renderStructure(ui){
  const {state,root,esc}=ui;
  const days=[...new Set([...(state.market||[]).map(r=>r.date),...(state.importedLimitPools||[]).map(r=>r.tradeDate),ui.date].filter(validDate))].sort();
  const v=views.get(root)||{day:validDate(ui.date)?ui.date:days.at(-1)||'',code:ui.stock||'',scope:'',quality:ui.sampleFilter||'all',set:'all',h:1,asOf:'',eventWindow:'five'};views.set(root,v);
  const cut=v.asOf?asTime(v.asOf):Date.now(),all=datedPools(state,v.day,cut,v.set);
  const filtered=all.map(f=>{
    if(v.quality==='all')return f;
    const sealed=f.sealed.filter(s=>sampleMatches(s,v.quality)),broken=(f.broken||[]).filter(s=>sampleMatches(s,v.quality));
    return {...f,sealed,broken,complete:f.complete&&sealed.length===f.sealed.length,brokenComplete:f.brokenComplete&&broken.length===f.broken?.length};
  });
  const current=filtered.filter(f=>f.date===v.day);
  const depth=f=>filtered.filter(p=>p.provider===f.provider&&p.scope===f.scope&&p.date<=f.date).length;
  const pool=current.find(f=>[f.provider,f.scope,f.id||''].join('|')===v.scope)||current.filter(f=>f.complete).sort((a,b)=>depth(b)-depth(a))[0]||current[0];
  if(pool)v.scope=[pool.provider,pool.scope,pool.id||''].join('|');
  const series=pool?filtered.filter(f=>f.provider===pool.provider&&f.scope===pool.scope):[];
  const prior=pool&&series.find(f=>f.date===pool.previousDay);
  const groups=pool?groupPool(pool,prior):[];
  const membership=codeOK(v.code)?knownMembership(state,filtered,v.code,v.day,cut):[];
  const common=groups.filter(g=>g.members.some(m=>m.code===v.code)||membership.some(r=>r.name===g.name&&r.kind===g.kind));
  function options(entries,selected){return entries.map(([id,n])=>'<option value="'+esc(String(id))+'"'+(String(id)===String(selected)?' selected':'')+'>'+esc(n)+'</option>').join('');}
  function external(item){return item?'<a class="btn" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" href="'+esc(item.url)+'">'+esc(item.label)+' ↗</a>':'';}
  const table=(headers,body)=>'<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+body+'</tbody></table></div>';
  function stockActions(m){return codeOK(m.code)?'<span>'+esc(m.name||m.code)+' '+m.code+' <button class="btn" data-target="'+m.code+'" data-view="new">校验</button> <button class="btn" data-target="'+m.code+'" data-view="backtest">回测</button></span>':'';}
  const peerHtml=common.length?common.map(g=>'<p><b>'+esc(g.name)+'</b> '+g.members.filter(m=>m.code!==v.code).map(m=>'<button class="btn" data-peer="'+m.code+'">'+esc(m.name||m.code)+' '+m.code+'</button>').join(' ')+(g.members.length===1?' 同范围暂无其他封板成员':'')+' '+external(thsBoardLink(g))+'</p>').join(''):'<p>所选范围未收录该代码的题材归属。</p>';
  const groupHtml=groups.map(g=>{
    const ids=g.refs.map(ref=>[ref.provider,ref.rawName,ref.boardId].filter(Boolean).join(' · ')).join(' / ');
    const levelRow=l=>'<tr><td>'+l.level+'板</td><td>'+(l.members.length?l.members.map(m=>stockActions(m)).join(' '):(l.gap?'缺档':'样本未见'))+'</td><td>'+esc(l.members.map(m=>m.role+' · '+m.basis).join(' / ')||'—')+'</td></tr>';
    return '<details class="panel"><summary><strong>'+esc(g.name)+'</strong> · '+(g.kind==='industry'?'行业':'题材')+' · '+g.members.length+' 只 · '+(g.complete?(g.gaps.length?g.gaps.map(h=>h+'板').join('、')+'缺档':'已核各层'):'局部样本')+'</summary><p>'+esc(ids)+'</p>'+external(thsBoardLink(g))+table(['梯队','当日封板','角色依据'],g.levels.map(levelRow).join('')+(g.unknown.length?'<tr>'+'<td>高度待核</td><td>'+g.unknown.map(stockActions).join(' ')+'</td><td>缺少连续板数</td>'+'</tr>':''))+'</details>';
  }).join('');
  const eventDates=new Set(series.map(f=>f.date).slice(-5));
  const events=highEvents(series,state.bars||[],cut),near=events.filter(x=>v.eventWindow==='today'?x.date===v.day:v.eventWindow==='stock'?x.code===v.code:eventDates.has(x.date)).slice(-120).reverse();
  const highs=[...new Map((pool?.sealed||[]).filter(m=>m.level>=2).map(m=>[m.code,m])).values()].sort((a,b)=>b.level-a.level||a.code.localeCompare(b.code));
  const uniqueBroken=[...new Map((pool?.broken||[]).map(m=>[m.code,m])).values()];
  const breaks=uniqueBroken.filter(b=>sampleMatches(b,v.quality)).map(b=>{
    const ids=sectorIdsFor(b,v.day,state.bars||[],cut);
    return classifyBreak(b,v.day,state.bars||[],cut,ids);
  });
  let observations=[];
  if(state.bars?.length)observations=signals(state,wall(cut));
  const rotation=styleRotation(observations,v.day,cut,v.h,v.quality,v.set);
  const stockLink=codeOK(v.code)?external(thsStockLink(v.code)):'';
  root.innerHTML='<section class="panel"><div class="grid2"><label>交易日<select data-control="day">'+options(days.map(d=>[d,d]),v.day)+'</select></label><label>观察截止（北京时间）<input data-control="asOf" type="datetime-local" value="'+esc(v.asOf)+'"></label><label>数据范围<select data-control="scope">'+options(current.map(f=>[[f.provider,f.scope,f.id||''].join('|'),[f.source,f.scope,f.id?String(f.id).slice(-8):null].filter(Boolean).join(' · ')]),v.scope)+'</select></label><label>档案范围<select data-control="set">'+options([['all','全部档案'],['real','研究档案'],['test','教学测试']],v.set)+'</select></label><label>样本质量<select data-control="quality">'+options([['all','全部样本'],['standard','标准样本'],['blackSwan','黑天鹅'],['extreme','极端行情'],['excludeBlackSwan','排除黑天鹅'],['excludeExtreme','排除极端行情']],v.quality)+'</select></label></div></section>'+
    '<section class="panel"><h2>所选标的与同题材封板</h2><label>股票代码 <input data-control="code" type="text" maxlength="6" inputmode="numeric" value="'+esc(v.code)+'"></label> '+stockLink+(codeOK(v.code)?stockActions({code:v.code,name:'所选标的'}):'')+peerHtml+'</section>'+
    '<section class="panel"><h2>题材梯队</h2>'+(pool?'<p>'+esc(pool.source)+' · '+esc(pool.scope)+' · 原交易日 '+esc(pool.date)+' · 获知 '+esc(wall(pool.knownAt))+' · '+(pool.complete?'供应商池已核全':'选中范围')+'</p>':'')+(groupHtml||'<p>当前时点无已核实的题材成员。</p>')+'</section>'+
    '<section class="panel"><h2>高标清单与事件</h2><p>连续二板及以上，按所选来源股票池跟踪。高标平均涨幅与全池封板数变化按同日并列观察。</p><label>事件范围 <select data-control="eventWindow">'+options([['five','近五个数据交易日'],['today','当日'],['stock','所选标的历史']],v.eventWindow)+'</select></label><p>'+ (highs.length?highs.map(m=>stockActions(m)+' '+m.level+'板').join('、'):'当前来源范围未见已核二板及以上标的。')+'</p>'+
    (near.length?table(['交易日','标的','事件','时间或时段','观察依据'],near.map(e=>e.type==='高标反馈'?'<tr>'+columns([e.date,'昨日二板及以上',e.type,'收盘',e.observed+'/'+e.cohort+' 只有当日涨幅，等权反馈 '+value(e.mean)+'%，同池封板数变化 '+value(e.marketDelta)+' 只'],esc)+'</tr>':'<tr><td>'+esc(e.date)+'</td><td>'+stockActions(e)+'</td>'+columns([e.type,e.time||'收盘确认',e.why],esc)+'</tr>').join('')):'<p>等待相邻交易日同口径池与成交证据。</p>')+'</section>'+
    '<section class="panel"><h2>炸板归因证据</h2>'+(breaks.length?table(['标的','归因','开板观察区间末','依据与缺项'],breaks.map(b=>'<tr><td>'+stockActions(b)+'</td>'+columns([b.status,b.eventTime,[...b.evidence,...b.missing.map(x=>'缺 '+x)].join(' / ')],esc)+'</tr>').join('')):'<p>当前范围没有可核对的炸板个股明细。</p>')+'</section>'+
    '<section class="panel"><h2>风格轮动</h2><label>成熟收益窗口 <select data-control="h">'+options([1,3,5,10].map(h=>[h,'T + '+h]),v.h)+'</select></label><p>最近 20 个有信号的交易日，同股同日同风格仅计一次。收益从下一交易日可用开盘价起算。四类各有至少 5 笔成熟样本后比较正溢价。</p>'+
    table(['风格','成熟样本','平均收益','盈利占比'],rotation.stats.map(g=>'<tr>'+columns([g.name,g.n,g.mean==null?'—':g.mean+'%',g.win==null?'—':g.win+'%'],esc)+'</tr>').join(''))+'<p>样本内偏好 · '+esc(rotation.preferred||'未判定')+'</p></section>';
  for(const e of root.querySelectorAll('[data-control]'))e.onchange=()=>{const key=e.dataset.control;v[key]=key==='h'?Number(e.value):e.value.trim();if(key==='quality')ui.setSample?.(v.quality);renderStructure(ui);};
  for(const e of root.querySelectorAll('[data-target]'))e.onclick=()=>{ui.open(e.dataset.view,{code:e.dataset.target,date:v.day,sample:v.quality});};
  for(const e of root.querySelectorAll('[data-peer]'))e.onclick=()=>{v.code=e.dataset.peer;renderStructure(ui);};
}
