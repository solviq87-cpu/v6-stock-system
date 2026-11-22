import {sectorRoles,roleBadge} from './stock-roles.js';
import {dailyReviewEvidence,reviewSupplier as supplier} from './market-evidence.js';
import {h,button,empty,section,field,dateTime,dayLabel,note} from './ui.js';

// Read-only source union. This does not alter the strategy pool, orders or notifications.
export function renderSourceReviewPool(ctx,stockRenderer){
 const stockCard=stockRenderer||((row,context)=>h('button',{type:'button',class:'fy-stock-card','data-code':row.code,onClick:()=>context.selectStock(row.code,row)},row.name||row.code,' · ',row.code));
 let evidence=dailyReviewEvidence(ctx.state||{}),page=0,query='',sector='',st='all';const size=25;
 const expanded=new Set(),currentDetails=new Map();
 const detail=(key,label,...children)=>{
  const node=h('details',{class:'fy-details',open:expanded.has(key),onToggle:()=>{
   // Replaced elements can receive their queued native toggle after a refresh.
   if(!node.isConnected||currentDetails.get(key)!==node||!view.contains(node))return;
   if(node.open)expanded.add(key);else expanded.delete(key);
  }},h('summary',{},label),...children);
  currentDetails.set(key,node);return node;
 };
 const view=h('div',{class:'fy-stack'}),search=h('input',{type:'search',placeholder:'搜索代码、名称或完整原因','aria-label':'搜索每日复盘'}),select=h('select',{'aria-label':'筛选复盘板块'}),summary=h('p',{class:'fy-note',role:'status'}),sourceInfo=h('div',{class:'fy-stack'}),boards=h('div',{class:'fy-grid two'}),body=h('div',{class:'fy-stack'}),position=h('span',{});
 const title=h('summary',{},'来源涨停复盘'),stFilter=h('select',{'aria-label':'筛选复盘 ST 范围'},[['all','全部股票（含 ST）'],['st','仅 ST'],['non-st','明确非 ST']].map(([value,label])=>h('option',{value},label)));
 const previous=button('上一页',()=>{page--;paint();}),next=button('下一页',()=>{page++;paint();});
 const level=row=>row.limitUpCount===1?'首板':row.limitUpCount===2?'二板':row.limitUpCount?row.limitUpCount+'连板':'连板数待核验';
 const roleLabel=value=>({leader:'龙头',deputy:'龙二',mid:'中军',follow:'跟风'})[value];
 function captureExpansion(){
  // The DOM open property changes before the asynchronous toggle notification.
  // Read it before replacing either sector details or stock-card details.
  for(const [key,node]of currentDetails){
   if(!view.contains(node)){currentDetails.delete(key);continue;}
   if(node.open)expanded.add(key);else expanded.delete(key);
  }
 }
 function reviewCard(row){
  const roles=sectorRoles(ctx.state,evidence.day);
  const mark=peer=>roleBadge(roles.get(peer.code))||(roleLabel(peer.role)?roleBadge({key:peer.role,label:roleLabel(peer.role),evidence:'同日板块分类记录'}):null);
  const linked=row.linkedRecords.map(peer=>h('div',{class:'fy-item'},
   peer.code?button(peer.name+' '+peer.code,()=>ctx.selectStock(peer.code),'quiet'):h('strong',{},peer.name+' · 代码待核验'),
   h('p',{},peer.limitUpCount===0?'后台记录：未涨停强势观察':level(peer)),
   mark(peer)));
  return section(row.name+' · '+row.code,level(row)+' · '+(row.sectorTags.join(' / ')||'板块待核验'),
   (row.heldRecord||row.currentSourceConfirmed===false)&&note('保留旧来源证据，本次未确认；不能据此断言当前仍封板。','warn'),
   (row.heldRecord||row.currentSourceConfirmed===false)&&h('p',{class:'fy-muted'},'保留来源 '+row.heldSources.map(supplier).join('、')+' · 原接收时点 '+dateTime(row.receivedAt)+' · 原事件时点 '+dateTime(row.sourceEventAt)),
   stockCard(row.stock,ctx),
   h('p',{},'涨停原因：'+(row.reason||'待核验，尚无同交易日的原始原因证据')),
   h('p',{class:'fy-muted'},'原始交易日 '+dayLabel(row.sourceDay)+' · 池来源 '+supplier(row.source)+' · 原因来源 '+supplier(row.reasonSource)+' · 原因日期 '+dayLabel(row.reasonDay)),
   row.reasonSourceStatus==='retained'&&h('p',{class:'fy-muted'},'原因来源本次未确认，保留原始证据 · 原接收时点 '+dateTime(row.reasonReceivedAt)),
   mark(row),
   detail(row.code+':peers','同板块关联涨停股 '+row.peers.length+' 只（完整可见池）',
    row.peers.length?h('div',{class:'fy-inline'},row.peers.map(peer=>button(peer.name+' '+peer.code+' · '+level(peer)+' · '+peer.sharedTags.join(' / '),()=>ctx.selectStock(peer.code,evidence.rows.find(x=>x.code===peer.code)?.stock),'quiet'))):note(row.dateMatched?'没有同日同板块的其他可见涨停股。':'原始日期或板块缺失，关联关系待核验。')),
   detail(row.code+':linked','后台联动补充 '+linked.length+' 条（来源限量记录）',
    note('此来源只返回部分联动记录；无代码的名称不匹配其他股票。'),
    linked.length?linked:note('尚无同日复盘联动记录，不能据此断言不存在其他联动个股。')));
 }
 function paint(){
  captureExpansion();
  const rows=evidence.rows.filter(row=>(st==='all'||st==='st'&&row.isST===true||st==='non-st'&&row.isST===false)&&(!sector||row.sectorTags.includes(sector)||(!row.sectorTags.length&&sector==='板块待核验'))&&(!query||[row.code,row.name,row.reason,...row.sectorTags].some(value=>String(value||'').toLowerCase().includes(query))));
  const pages=Math.max(1,Math.ceil(rows.length/size));page=Math.max(0,Math.min(page,pages-1));previous.disabled=page===0;next.disabled=page===pages-1;
  summary.textContent='原始交易日 '+dayLabel(evidence.day)+' · 可见复盘池 '+evidence.rows.length+' 只 · 当前筛选 '+rows.length+' 只 · 同日来源原因已匹配 '+evidence.reasonKnown+' 只'+(evidence.dateUnknown?' · 原始日期待核验 '+evidence.dateUnknown+' 只':'')+(evidence.excludedDateRows?' · 已隔离不同源日记录 '+evidence.excludedDateRows+' 条':'')+(!evidence.reviewMatched?' · 复盘归档日期未匹配，不套用旧原因或角色':'');
  position.textContent='第 '+(page+1)+' / '+pages+' 页 · 每页 '+size+' 只';
  body.replaceChildren(...(rows.length?rows.slice(page*size,(page+1)*size).map(reviewCard):[empty('尚无匹配的涨停记录','不补造股票或原因；可清空筛选，查看完整池。')]));
 }
 function update(){
  if(ctx.signal?.aborted)return;
  captureExpansion();
  evidence=dailyReviewEvidence(ctx.state||{});select.replaceChildren(h('option',{value:''},'全部板块'),...evidence.sectors.map(item=>h('option',{value:item.name},item.name+' · '+item.count+' 只')));if(sector&&!evidence.sectors.some(x=>x.name===sector))sector='';select.value=sector;
  const meta=evidence.sourceEvidence,count=value=>Number.isSafeInteger(value)&&value>=0?String(value):'待核验';
  title.textContent='来源涨停复盘 · '+evidence.rows.length+' 只 · '+dayLabel(evidence.day);
  sourceInfo.replaceChildren(note('仅展示供应商已返回的记录，未认证交易所全部股票。标签包含供应商行业与概念，分类口径未统一；多板块归属分别计数，家数不能相加作为股票总数。'),
   note(!evidence.readonly?'旧服务兼容：当前仅有策略涨停池，可能包含策略排除。':!meta?'只读复盘池元数据缺失，原始日期与完整性待核验。':meta.status==='retained'?'保留最近有效供应商复盘池，原始日期 '+dayLabel(evidence.day)+(meta.retentionReason==='startup-not-verified'?'；本次启动尚未重新核验。':'；本次请求日 '+dayLabel(meta.lastAttempt?.requestedDate||meta.lastAttempt?.tradeDate||meta.lastAttempt?.requestedTradeDate)+'。'):'供应商复盘池 · 去重 '+count(meta.uniqueCount)+' 只 · 交集 '+count(meta.intersectionCount)+' 只 · 东财独有 '+count(meta.eastmoneyOnlyCount)+' 只 · 财联社独有 '+count(meta.clsOnlyCount)+' 只。'),
   ...(meta?.heldRecordCount>0?[note('本轮未确认的保留记录 '+count(meta.heldRecordCount)+' 只 · 保留来源 '+(Array.isArray(meta.retainedSources)?meta.retainedSources.map(supplier).join('、'):'待核验')+'；原始时点保持不变。','warn')]:[]),
   ...(Array.isArray(meta?.sources)?meta.sources:[]).map(source=>h('p',{class:'fy-muted'},supplier(source.source)+' · 来源日 '+dayLabel(source.tradeDate)+' · 声明总量 '+count(source.totalCount)+' · 返回 '+count(source.fetchedCount)+' · '+(source.status==='retained'||meta?.status==='retained'?(source.retentionReason==='startup-not-verified'||meta?.retentionReason==='startup-not-verified'?'本次启动尚未重新核验，保留上次来源记录':source.providerComplete===true?'上次响应完整，本次来源失败保留':'保留旧来源记录，本次未确认'):source.providerComplete===true?'供应商本次响应条数齐全':'本次完整性待核验')+' · '+(source.includesST===true?'包含 ST':source.includesST===false?'来源声明不含 ST':'ST 范围由供应商定义')+' · '+(source.completenessScope==='provider-up-pool-including-st'?'供应商涨停池范围（含ST）':'供应商可见范围，非交易所全集'))));
  boards.replaceChildren(...evidence.sectors.map(item=>detail('sector:'+item.name,item.name+' · '+item.count+' 只涨停（去重可见池）',item.logic.length?h('div',{class:'fy-list'},item.logic.map(reason=>h('p',{},reason))):note('板块逻辑待核验；尚无同日来源原因。'))));paint();
 }
 stFilter.addEventListener('change',()=>{st=stFilter.value;page=0;paint();});
 search.addEventListener('input',()=>{query=search.value.trim().toLowerCase();page=0;paint();});select.addEventListener('change',()=>{sector=select.value;page=0;paint();});
 view.append(section('来源涨停池','供应商可见涨停记录、原始原因与全部板块关联，逐票核对。',h('div',{class:'fy-inline'},field('搜索',search),field('板块',select),field('ST 范围',stFilter)),summary,sourceInfo),boards,body,h('div',{class:'fy-inline'},previous,position,next));ctx.onState?.(update);update();return h('details',{class:'fy-details fy-source-review','data-source-review':true},title,view);
}
