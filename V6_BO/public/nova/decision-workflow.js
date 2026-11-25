import {h,button,section,format,money,updateReadout} from './ui.js';

export function workflowDay(value){
 if(typeof value!=='string')return null;
 const day=value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');
 const stamp=Date.parse(day+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===day?day:null;
}

// The selection is tab-local UI context, never an account or an order store.
export function createDecisionSelection(){
 let value=null,revision=0;
 const listeners=new Set();
 const freeze=(object,seen=new WeakSet())=>{
  if(!object||typeof object!=='object'||seen.has(object))return object;
  seen.add(object);for(const child of Object.values(object))freeze(child,seen);return Object.freeze(object);
 };
 return {
  get value(){return value;},
  select(candidate){
   const code=String(candidate?.code||''),day=workflowDay(candidate?.day||candidate?.poolDay||candidate?.tradeDate);
   if(!/^\d{6}$/.test(code)||!day)return null;
   let snapshot;try{snapshot=structuredClone(candidate);}catch{return null;}
   const row=snapshot.row||snapshot;
   if(row.code!=null&&String(row.code)!==code||[row.poolDay,row.tradeDate,row.sourceTradeDate,row.workflowDay]
     .some(value=>value!=null&&value!==''&&workflowDay(value)!==day))return null;
   value=freeze({...snapshot,code,day,revision:++revision,
    sector:snapshot.sector||row.sector||row.industry||'',
    row:{...row,code,poolDay:day,workflowDay:day}});
   for(const fn of listeners)fn(value);
   return value;
  },
  subscribe(fn,signal){if(signal?.aborted)return ()=>{};listeners.add(fn);const remove=()=>listeners.delete(fn);signal?.addEventListener('abort',remove,{once:true});return remove;},
  clear(){value=null;revision++;for(const fn of listeners)fn(null);}
 };
}

export function selectedSectorEvidence(state,selection){
 if(!selection)return {status:'unselected',rows:[],reason:'选择决策卡后同步板块与交易日。'};
 const day=workflowDay(state?.snapshotFieldDays?.sectors||state?.sectorsDay);
 if(!day||day!==selection.day)return {status:'missing',rows:[],day,reason:'所选 '+selection.day+'；板块资金 '+(day||'日期未提供')+'，等待同日证据。'};
 const names=new Set([selection.sector,...(selection.themes||[])].filter(x=>typeof x==='string'&&x.trim()));
 const raw=Array.isArray(state?.sectors)?state.sectors:Array.isArray(state?.sectors?.items)?state.sectors.items:[];
 const rows=raw.filter(row=>row&&typeof row==='object'&&names.has(row.name||row.sector)&&
  [row.tradeDate,row.day,row.sourceTradeDate].every(v=>!v||workflowDay(v)===selection.day)).map(row=>({
   name:row.name||row.sector,
   value:Number.isFinite(row.mainInflowYuan)?row.mainInflowYuan:Number.isFinite(row.netInflowYuan)?row.netInflowYuan:null,
   source:row.source||row.provider||''
  }));
 return {status:rows.some(row=>row.value!==null)?'available':'missing',rows,day,
  reason:rows.length?'仅显示已明确为人民币元的同日资金。':'该题材暂无同日板块资金记录。'};
}

export function renderSelectedSector(ctx,{compact=false}={}){
 const host=h('section',{class:'fy-linked-sector'+(compact?' compact':''),'data-linked-sector':'true','aria-label':'所选股票板块资金'});
 function paint(){
  const selected=ctx.selection,proof=selectedSectorEvidence(ctx.state,selected);
  host.hidden=!selected;
  if(!selected){host.replaceChildren();return;}
  host.dataset.code=selected.code;host.dataset.day=selected.day;
  updateReadout(host,h('header',{},h('strong',{},'板块联动 · '+(selected.name||selected.row?.name||selected.code)),h('small',{},selected.code+' · '+selected.day)),
   ...proof.rows.map(row=>h('p',{},row.name+' · 主力净额 '+(row.value===null?'未提供':money(row.value)+' 元'),row.source?h('small',{},' · '+row.source):null)),
   proof.status!=='available'?h('p',{class:'fy-muted'},proof.reason):null,
   compact?button('查看板块资金',()=>ctx.navigate('pulse','sectors'),'quiet'):null);
 }
 ctx.onSelection?.(paint);ctx.onState?.(paint);paint();return host;
}

export function renderPaperDraft(ctx){
 const body=h('div');
 const host=section('模拟盘条件预填','',body);
 host.classList.add('fy-paper-decision');host.setAttribute('data-paper-decision','true');
 let selectedRevision=-1,policy=null,busy=false,loaded=false,uncertain=false,filledRevision=-1;
 const status=h('p',{class:'fy-muted',role:'status','aria-live':'polite'});
 const low=h('input',{type:'number',name:'entryMin',min:0.01,step:0.01,required:true,'aria-label':'模拟买入区间下限'});
 const high=h('input',{type:'number',name:'entryMax',min:0.01,step:0.01,required:true,'aria-label':'模拟买入区间上限'});
 const position=h('input',{type:'text',readOnly:true,'aria-label':'模拟账户仓位规则'});
 const stop=h('input',{type:'text',readOnly:true,'aria-label':'模拟账户止损规则'});
 const identity=h('p',{class:'fy-selection-identity'}),rules=h('p',{class:'fy-muted'});
 const plan=h('p',{class:'fy-muted'});
 const reconcile=button('核对账户回执',async()=>{
  if(busy||!ctx.selection||ctx.canEdit!==true)return;
  const selection=ctx.selection,revision=selection.revision;busy=true;reconcile.disabled=true;
  try{
   const reply=await ctx.api('/api/paper',{signal:ctx.signal});
   if(ctx.signal?.aborted||ctx.selection?.revision!==revision)return;
   const account=reply.paper?.pool;
   if(!account||!Array.isArray(account.trades))throw Error('账户回执尚不完整，请稍后继续核对。');
   policy=account.policy||null;
   const bought=account.trades.some(trade=>trade.code===selection.code&&trade.side==='买入'&&
    Number.isSafeInteger(trade.t)&&trade.t>0&&trade.t<=Date.now()&&new Date(trade.t+28800000).toISOString().slice(0,10)===selection.day);
   if(bought){filledRevision=revision;uncertain=false;status.textContent='权威账户已有该股当日买入记录，请查看下方成交流水。';}
   else if(Number.isSafeInteger(account.tradesShown)&&account.tradesShown>=0&&Number.isSafeInteger(account.tradesTotal)&&
    account.tradesShown===account.tradesTotal&&account.trades.length===account.tradesShown&&account.audit?.ok===true){uncertain=false;status.textContent='已核对完整账户回执，当前未见该股当日买入。请重新核对条件后决定是否提交。';}
   else{uncertain=true;status.textContent='已读取最近流水，仍不足以排除成交；请继续核对完整账务证据。';}
   await ctx.refresh({showSuccess:false});
  }catch(error){if(!ctx.signal?.aborted&&ctx.selection?.revision===revision){uncertain=true;status.textContent=error.message;}}
  finally{busy=false;reconcile.disabled=false;fill();}
 },'quiet');
 const confirm=button('确认条件并加入模拟盘',async()=>{
  const selection=ctx.selection;
  if(busy||uncertain||filledRevision===selection?.revision||!selection||!policy||ctx.canEdit!==true)return;
  const entryMin=Number(low.value),entryMax=Number(high.value);
  if(!low.value||!high.value||!Number.isFinite(entryMin)||entryMin<=0||!Number.isFinite(entryMax)||entryMax<entryMin){status.textContent='请填写有效买入区间，再确认提交。';return;}
  const revision=selection.revision;
  busy=true;confirm.disabled=true;status.textContent='正在由原模拟盘核验条件与成交回执…';
  try{
   const result=await ctx.api('/api/paper',{method:'POST',signal:ctx.signal,body:{action:'submitDecision',account:'pool',code:selection.code,day:selection.day,entryMin,entryMax,policy}});
   if(ctx.signal?.aborted||ctx.selection?.revision!==revision)return;
   if(result.filled===null||result.status==='receipt-unavailable'){
    uncertain=true;status.textContent=result.error||'成交回执暂时不可用，请先核对账户。';
    await ctx.refresh({showSuccess:false});return;
   }
   if(result.ok===false){const error=Error(result.error||result.note||'原模拟盘未接受该条件。');error.body=result;throw error;}
   const receipt=result.receipt;
   const filled=result.ok===true&&result.filled===true&&result.status==='filled'&&
    receipt?.account==='pool'&&receipt.code===selection.code&&receipt.day===selection.day&&
    typeof receipt.eventId==='string'&&receipt.eventId.length>0&&Number.isFinite(receipt.price)&&receipt.price>0&&
    Number.isSafeInteger(receipt.shares)&&receipt.shares>0;
   if(!filled){uncertain=true;status.textContent='提交回执不完整或与所选股票不一致，请核对权威账户；尚未确认成交。';await ctx.refresh({showSuccess:false});return;}
   status.textContent=result.message||result.msg||result.note||(filled?'原模拟盘已确认成交，请核对下方流水。':result.filled===null?'成交回执暂时不可用，请先刷新账户核对，避免重复提交。':'本次未成交，请核对原门禁回执。');
   if(filled){filledRevision=revision;confirm.textContent='已取得成交回执';}
   await ctx.refresh({showSuccess:false});
  }catch(error){if(!ctx.signal?.aborted&&ctx.selection?.revision===revision){
   const reply=error.body;
   uncertain=!(reply?.status==='blocked'&&reply?.filled===false);
   status.textContent=error.message+(uncertain?' 请先核对账户回执，当前未确认是否成交。':'');
   if(uncertain)await ctx.refresh({showSuccess:false});
  }}
  finally{busy=false;if(!ctx.signal?.aborted)fill();}
 },'primary');
 function fill(){
  const selection=ctx.selection;host.hidden=ctx.canEdit!==true;
  if(!selection){identity.textContent='尚未选择决策卡。';confirm.disabled=true;reconcile.hidden=true;return;}
  host.dataset.code=selection.code;host.dataset.day=selection.day;
  identity.textContent=(selection.name||selection.row?.name||selection.code)+' '+selection.code+' · '+selection.day;
  if(selectedRevision!==selection.revision){
   selectedRevision=selection.revision;
   uncertain=false;
   low.value=Number.isFinite(selection.entry?.[0])?String(selection.entry[0]):'';
   high.value=Number.isFinite(selection.entry?.[1])?String(selection.entry[1]):'';
   status.textContent='已预填，尚未提交。';confirm.textContent='确认条件并加入模拟盘';
   plan.textContent='策略参考止损 '+(Number.isFinite(selection.stop)?format(selection.stop)+' 元':'未提供')+' · 目标 '+(Number.isFinite(selection.target)?format(selection.target)+' 元':'未提供');
  }
  const current=ctx.state?.paper?.pool;
  if(current&&Object.hasOwn(current,'policy'))policy=current.policy;
  position.value=policy&&Number.isFinite(policy.positionPct)?'每票预算上限 '+format(policy.positionPct)+'%（按现金和整手取整）':'等待账户规则';
  stop.value=policy&&Number.isFinite(policy.stopPct)?'基础止损 '+format(policy.stopPct)+'%':'等待账户规则';
  rules.textContent=policy?'沿用 A·跟单盘等权分仓；ATR 可将基础止损放宽至 '+format(policy.maxStopPct)+'%，并保留收益保护和 T+1。策略参考价不替换账户止损。条件仅在本次提交核验，不会自动挂单等待。':'正在核对原模拟盘规则；未知时无法提交。';
  confirm.disabled=busy||uncertain||filledRevision===selection.revision||!policy||ctx.canEdit!==true;
  reconcile.hidden=!uncertain;
 }
 const field=(label,node)=>h('label',{class:'fy-field'},h('span',{},label),node);
 body.replaceChildren(identity,h('div',{class:'fy-grid two'},field('买入下限（元）',low),field('买入上限（元）',high),field('建议仓位 · 原账户规则',position),field('止损 · 原账户规则',stop)),plan,rules,status,confirm,reconcile,
  button('返回今日作战台',()=>ctx.navigate('pulse','overview'),'quiet'));
 ctx.onSelection?.(fill);ctx.onState?.(fill);fill();
 if(ctx.canEdit===true&&!policy&&!loaded){loaded=true;queueMicrotask(async()=>{try{const data=await ctx.api('/api/paper',{signal:ctx.signal});if(!ctx.signal?.aborted){policy=data.paper?.pool?.policy||null;fill();if(!policy)status.textContent='当前服务尚未提供条件提交规则，请随完整版本升级。';}}catch(error){if(!ctx.signal?.aborted)status.textContent=error.message;}});}
 return host;
}
