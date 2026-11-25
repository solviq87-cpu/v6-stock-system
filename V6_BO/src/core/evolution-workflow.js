'use strict';

// Read models of the existing research archive, immutable screening journal and
// reconciled execution imports. There is deliberately no order or account writer.
const crypto=require('node:crypto');
const store=require('./research-workspace-store');
const {summarizeConditions,summarizeRuleDisagreement}=require('./research-decision-review');
const {aShareCalendarDate}=require('./a-share-calendar');
const FLAGS={...store.FLAGS,accountMutated:false,autoPromotion:false};
const SCHEMA='fayo-evolution-workflow-v1';
const arr=x=>Array.isArray(x)?x:[];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const time=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const codeOk=x=>typeof x==='string'&&/^\d{6}$/.test(x);
const hashOk=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const text=(x,max=500)=>typeof x==='string'?x.replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max):'';
const uniq=xs=>[...new Set(xs)];
const round=x=>finite(x)?+x.toFixed(6):null;
const cn=(date,clock='15:00:00')=>Date.parse(date+'T'+clock+'+08:00');
const dateOk=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\d$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
function timestamp(x){
 if(time(x))return x;
 if(typeof x!=='string')return null;
 if(/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d)?$/.test(x))x=x.replace(' ','T')+'+08:00';
 const n=Date.parse(x);return time(n)?n:null;
}
const known=(x,at)=>{const n=timestamp(x);return n!==null&&n<=at;};
function atOf(asOf){if(!time(asOf)||asOf>Date.now())throw Error('工作流需要已发生的明确时点');return asOf;}
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const bounded=(xs,n,name)=>{if(!Array.isArray(xs)||xs.length>n)throw Error(name+'记录数量无效');return xs;};
const visibleEvent=(event,at)=>hashOk(event?.hash)&&known(event.recordedAt,at)&&(!time(event.data?.asOf)||event.data.asOf<=at);
const teaching=x=>['test','demo'].includes(x?.sampleSet)||x?.simulated===true||/synthetic|fixture|mock|demo|simulated|教学|测试/i.test(String(x?.source||x?.sampleSource||''));

const STATUSES=['all','selected','observe','upgraded','downgraded','rejected','reentered','invalidated','unknown'];
const COLUMNS=['code','name','status','relativeStrength','risk','score','date','strategy','source','knownAt'];
const SECTIONS=['workflow','market','lifecycle','research','trades','ai'];
const PRIORITIES=['risk','workflow','candidates','market','research','trades'];
function defaultEvolutionPreferences(){return {groups:[],templates:[],columns:['code','name','status','relativeStrength','risk'],search:'',status:'all',activeGroup:'all',selectedCode:'',sectionOrder:[...SECTIONS],homepagePriority:['risk','workflow','candidates'],expanded:[],scrollTop:0,density:'comfortable'};}
function preferenceInput(value={}){
 const defaults=defaultEvolutionPreferences();
 if(!plain(value)||Object.keys(value).some(k=>!Object.hasOwn(defaults,k)))throw Error('个性化字段无效');
 const v={...defaults,...value};
 const clean=(s,max)=>typeof s==='string'&&s.length<=max&&!/[\x00-\x1f\x7f<>]/.test(s)&&!/(?:https?:\/\/|webhook|sharecode|api[_ -]?key|password|bearer\s|token\s*[:=])/i.test(s);
 const id=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(s)&&!['__proto__','constructor','prototype','all'].includes(s);
 function list(xs,allowed,max,label,{nonempty=false}={}){if(!Array.isArray(xs)||xs.length>max||nonempty&&!xs.length||new Set(xs).size!==xs.length||xs.some(s=>!allowed.includes(s)))throw Error(label+'配置无效');return xs.slice();}
 if(!clean(v.search,120)||!STATUSES.includes(v.status)||v.selectedCode!==''&&!codeOk(v.selectedCode)||!['comfortable','compact'].includes(v.density)||!Number.isSafeInteger(v.scrollTop)||v.scrollTop<0||v.scrollTop>10000000)throw Error('工作台筛选或位置无效');
 const ids=new Set();
 v.groups=bounded(v.groups,20,'自选分组').map(g=>{
  if(!plain(g)||Object.keys(g).some(k=>!['id','name','symbols'].includes(k))||!id(g.id)||ids.has(g.id)||!clean(g.name,40)||!g.name.trim())throw Error('自选分组无效或重复');ids.add(g.id);
  if(!Array.isArray(g.symbols)||g.symbols.length>200||new Set(g.symbols).size!==g.symbols.length||g.symbols.some(s=>!codeOk(s)))throw Error('自选分组证券无效');
  return {id:g.id,name:g.name.trim(),symbols:g.symbols.slice()};
 });
 if(v.activeGroup!=='all'&&!ids.has(v.activeGroup))throw Error('选择的自选分组不存在');
 v.columns=list(v.columns,COLUMNS,10,'栏目',{nonempty:true});
 v.sectionOrder=list(v.sectionOrder,SECTIONS,SECTIONS.length,'区块顺序',{nonempty:true});
 // Removing a panel only changes presentation; omitted panels remain reachable.
 v.sectionOrder=uniq([...v.sectionOrder,...SECTIONS]);
 v.homepagePriority=list(v.homepagePriority,PRIORITIES,PRIORITIES.length,'首页优先信息',{nonempty:true});
 v.homepagePriority=uniq(['risk',...v.homepagePriority]);
 v.expanded=list(v.expanded,SECTIONS,SECTIONS.length,'展开状态');
 const templates=new Set();
 v.templates=bounded(v.templates,20,'筛选模板').map(t=>{
  if(!plain(t)||Object.keys(t).some(k=>!['id','name','search','status','groupId','columns'].includes(k))||!id(t.id)||templates.has(t.id)||!clean(t.name,40)||!t.name.trim()||!clean(t.search??'',120)||!STATUSES.includes(t.status??'all')||(t.groupId??'all')!=='all'&&!ids.has(t.groupId))throw Error('筛选模板无效');templates.add(t.id);
  return {id:t.id,name:t.name.trim(),search:t.search??'',status:t.status??'all',groupId:t.groupId??'all',columns:list(t.columns??v.columns,COLUMNS,10,'模板栏目',{nonempty:true})};
 });
 return store.canonical(v);
}
function preferencesFromEvents(events,asOf){
 const history=events.filter(e=>e.kind==='evolution-preferences'&&visibleEvent(e,asOf));
 const latest=history.at(-1);
 if(latest&&latest.data.protocol!=='evolution-workbench-v1')throw Error('工作台偏好协议无效');
 return {revision:latest?.revision||0,value:latest?preferenceInput(latest.data.value):defaultEvolutionPreferences(),recordedAt:latest?.recordedAt??null,hash:latest?.hash??null,
  history:history.map(e=>({revision:e.revision,recordedAt:e.recordedAt,hash:e.hash})),...FLAGS};
}
function readEvolutionPreferences(root,{asOf=Date.now()}={}){atOf(asOf);return preferencesFromEvents(store.readEvents(root,{asOf}),asOf);}
function saveEvolutionPreferences(root,input={}, {now=Date.now(),beforeCommit}={}){
 const {requestId,expectedRevision}=input;
 if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('保存工作台需要预期版本');
 const value=preferenceInput(input.value);
 const event=store.appendEvent(root,'evolution-preferences',{protocol:'evolution-workbench-v1',value},{requestId,expectedRevision,now,beforeCommit});
 return {revision:event.revision,value:event.data.value,recordedAt:event.recordedAt,hash:event.hash,reused:event.reused,...FLAGS};
}
function recordCandidateTransitions(root,{sourceId}={}, {now=Date.now()}={}){
 if(!hashOk(sourceId))throw Error('生命周期需要原筛选快照引用');
 const source=store.readEvents(root,{asOf:now}).find(e=>e.kind==='screen'&&e.hash===sourceId);
 if(!source)throw Error('原筛选快照不存在或尚不可知');
 const data={protocol:'candidate-lifecycle-v1',sourceId,sourceSequence:source.sequence,asOf:source.data.asOf,
  version:source.data.codeVersion?.fingerprint||null,items:source.data.rows};
 return store.appendEvent(root,'candidate-lifecycle',data,{requestId:'lifecycle_'+sourceId,now});
}
function screenSnapshots(events,asOf){
 const visible=events.filter(e=>visibleEvent(e,asOf));
 // Every persisted screening, including legacy screenings before this release,
 // is replayed. Projection receipts never duplicate the original observation.
 return visible.filter(e=>e.kind==='screen'&&Array.isArray(e.data?.rows)).sort((a,b)=>a.sequence-b.sequence||a.recordedAt-b.recordedAt);
}
function followupEvidence(archive,asOf){
 const dates=uniq(arr(archive.tradeDates||archive.calendar?.tradeDates).filter(dateOk)).sort(),receipts=new Map();
 if(archive.scope!=='demo')for(const b of arr(archive.bars)){
  if(!codeOk(b?.code)||teaching(b)||b.role&&b.role!=='stock'||!dateOk(b.date)||b.priceBasis!=='unadjusted'||!known(b.knownAt,asOf)||!known(b.availableAt||cn(b.date),asOf))continue;
  const key=b.code+'/'+b.date;if(!receipts.has(key))receipts.set(key,new Map());
  receipts.get(key).set(JSON.stringify(['open','high','low','close','volume'].map(k=>b[k]??null)),b);
 }
 return {dates,byDay:new Map(dates.map((d,i)=>[d,i])),receipts};
}
function referenceOutcome(row,asOf,horizon,priceIndex){
 const {dates,receipts,byDay}=priceIndex,i=byDay.get(row.day)??-1,window=dates.slice(i+1,i+horizon+1);
 const empty={horizon,status:'unavailable',netReturnPct:null,priceReturnPct:null,maxFavourablePct:null,maxAdversePct:null,reason:'缺少同窗日历或可得的完整原始日K'};
 if(i<0||window.length!==horizon||cn(window[0],'09:30:00')<=row.recordedAt||cn(window.at(-1))>asOf)return empty;
 const series=window.map(day=>[...(receipts.get(row.code+'/'+day)?.values()||[])]);
 if(series.some(xs=>xs.length!==1))return empty;
 const b=series.map(xs=>xs[0]);
 if(b.some(x=>!['open','high','low','close'].every(k=>finite(x[k])&&x[k]>0)||x.high<Math.max(x.open,x.close,x.low)||x.low>Math.min(x.open,x.close)||!finite(x.volume)||x.volume<=0))return empty;
 return {...empty,status:'price-path-only',entryDay:window[0],endDay:window.at(-1),priceReturnPct:round((b.at(-1).close/b[0].open-1)*100),
  maxFavourablePct:round((Math.max(...b.map(x=>x.high))/b[0].open-1)*100),maxAdversePct:round((Math.min(...b.map(x=>x.low))/b[0].open-1)*100),
  reason:'同窗原始价格观察，入选与落选同口径；缺少完整成交限制和费用时不计算净收益'};
}
function candidateLifecycle(events=[],{archive={},asOf=Date.now(),code}={}){
 atOf(asOf);bounded(events,10000,'研究历史');
 const states=new Map(),rows=[];
 for(const event of screenSnapshots(events,asOf)){
  const seen=new Set();
  for(const item of event.data.rows){
   const symbol=item?.symbol||item?.code;if(!codeOk(symbol)||seen.has(symbol))continue;seen.add(symbol);
   const previous=states.get(symbol),raw=['selected','rejected','unknown'].includes(item.status)?item.status:'unknown';
   let state=raw;
   if(raw==='selected')state=!previous?'selected':previous.lastDefiniteStatus==='rejected'||previous.state==='invalidated'?'reentered':previous.rawStatus==='unknown'?'upgraded':finite(item.rank)&&finite(previous.rank)&&item.rank<previous.rank?'upgraded':finite(item.rank)&&finite(previous.rank)&&item.rank>previous.rank?'downgraded':'observe';
   if(raw==='unknown'&&previous?.lastDefiniteStatus==='selected')state='invalidated';
   const reasons=arr(item.reasons).map(r=>text(r.reason||r.stage)).filter(Boolean);
   const reason=reasons.join('；')||({selected:'原筛选条件全部通过，首次入选',observe:'再次观察，原条件仍通过',upgraded:'原证据恢复或排名提高',downgraded:'仍在候选，但原排名下降',rejected:'原筛选条件未通过',reentered:'原淘汰或失效后重新通过筛选',invalidated:'原证据不足，暂停沿用旧结论',unknown:'尚无足够证据'}[state]);
   const row={id:store.digest([event.hash,symbol]),sourceId:event.hash,sequence:event.sequence,code:symbol,name:text(item.name,80),state,rawStatus:raw,lastDefiniteStatus:raw==='unknown'?previous?.lastDefiniteStatus||null:raw,
    previousState:previous?.state||null,previousId:previous?.id||null,rank:finite(item.rank)?item.rank:null,score:finite(item.score)?item.score:null,
    at:event.data.asOf,recordedAt:event.recordedAt,day:dateOk(item.tradeDate)?item.tradeDate:aShareCalendarDate(event.data.asOf||event.recordedAt),
    reason,version:event.data.codeVersion?.fingerprint||null,provenance:text(item.provenance||event.data.provenance,160),conditions:arr(item.conditions).slice(0,30),
    evidenceIds:[event.hash],omittedFromLatest:false};
   states.set(symbol,row);rows.push(row);
  }
  // A smaller supplied universe is not a rejection event. Keep the previous
  // decision and expose the missing observation instead of inventing failure.
  for(const [symbol,old]of states)if(!seen.has(symbol))states.set(symbol,{...old,omittedFromLatest:true});
 }
 const priceIndex=followupEvidence(archive,asOf);
 const filtered=rows.filter(row=>!code||row.code===code).map(row=>({...row,outcomes:[1,5].map(h=>referenceOutcome(row,asOf,h,priceIndex))}));
 const current=[...states.values()];
 const summary=Object.fromEntries(STATUSES.filter(s=>s!=='all').map(state=>[state,current.filter(r=>r.state===state).length]));
 const groups=['selected','rejected'].map(status=>{
  const samples=filtered.filter(r=>r.rawStatus===status),mature=samples.filter(r=>r.outcomes[1].status==='price-path-only');
  return {status,total:samples.length,pricePathObserved:mature.length,unavailable:samples.length-mature.length,
   meanPriceReturnPct:mature.length?round(mature.reduce((n,r)=>n+r.outcomes[1].priceReturnPct,0)/mature.length):null};
 });
 return {mode:'original-screening-history',scope:{current:'all-observed-symbols',historyCode:code||null,followupCode:code||null},currentTotal:current.length,total:filtered.length,rows:filtered.slice(-1000),truncated:filtered.length>1000,current,summary,followup:groups,
  sourceCount:screenSnapshots(events,asOf).length,missing:filtered.length?[]:['尚无原筛选归档'],...FLAGS};
}

function buildCounterEvidence(run,asOf=Date.now()){
 atOf(asOf);
 const d=run?.data||run||{},code=d.symbol||d.code||null;
 const decisionAt=time(d.asOf)&&d.asOf<=asOf?d.asOf:asOf;
 const evidence=arr(d.evidence).filter(e=>plain(e)&&hashOk(e.id)&&e.symbol===code&&e.status!=='unknown'&&e.value!==null&&e.value!==undefined&&known(e.availableAt,decisionAt)&&known(e.receivedAt,decisionAt)&&(!e.periodEnd||known(e.periodEnd,decisionAt)));
 const byId=new Map(),conflicts=new Set();
 for(const e of evidence){if(byId.has(e.id)&&store.digest(byId.get(e.id))!==store.digest(e))conflicts.add(e.id);byId.set(e.id,e);}
 for(const id of conflicts)byId.delete(id);
 const rows=arr(d.conditions).filter(plain).map(c=>{
  const ids=arr(c.evidenceIds),valid=ids.length>0&&ids.every(id=>byId.has(id))&&ids.some(id=>store.digest(byId.get(id).value)===store.digest(c.value??null));
  return {...c,status:valid&&['pass','fail'].includes(c.status)?c.status:'unknown',evidenceIds:valid?ids:[],reason:valid?text(c.reason):'条件缺少同股、截止时点可得的来源引用'};
 });
 const projected=summarizeConditions(rows.filter(r=>!r.coverageOnly).map(r=>({id:r.id,name:r.name||r.field,family:r.system,invalidation:r.invalidation,
  checks:[{field:r.field||r.id,value:r.status==='unknown'?null:r.value,pass:r.status==='unknown'?null:r.status==='pass',missing:r.status==='unknown'?r.reason:null,op:r.op,threshold:r.threshold,
   evidence:{source:byId.get(r.evidenceIds[0])?.source,evidenceId:r.evidenceIds[0]}}]})));
 const claim=(row,polarity)=>({id:row.id,text:text(row.name||row.field,180),polarity,value:row.value??null,operator:row.op||null,threshold:row.threshold??null,
  evidenceIds:row.evidenceIds,reason:text(row.reason)||null,invalidation:text(row.invalidation)||'原条件或来源证据改变后重新核对',system:row.system||null,version:row.version||null});
 const support=rows.filter(r=>r.status==='pass'&&!r.coverageOnly).map(r=>claim(r,'support'));
 const opposition=rows.filter(r=>r.status==='fail'&&!r.coverageOnly).map(r=>claim(r,'opposition'));
 const missing=rows.filter(r=>r.status==='unknown').map(r=>({id:r.id,text:text(r.name||r.field,180),reason:r.reason,evidenceIds:[]}));
 const systems={fourteen:{rules:rows.filter(r=>r.system==='fourteen')},bazi:{dimensions:rows.filter(r=>r.system==='bazi')},
  gpt:[{name:'GPT五策略',rules:rows.filter(r=>r.system==='gpt')}],python:{rules:rows.filter(r=>r.system==='python')}};
 const disagreement=summarizeRuleDisagreement(systems);
 const invalidations=uniq(rows.filter(r=>r.status!=='unknown'&&!r.coverageOnly).map(r=>text(r.invalidation)||'原条件或来源证据改变后重新核对'));
 return {schemaVersion:1,mode:'evidence-counterargument',code,asOf,decisionAt,status:support.length||opposition.length?'observed':'insufficient-data',support,opposition,missing,
  maximumRisk:opposition.length?{status:'requires-review',items:opposition,ranking:'未提供可比损失尺度，不对风险大小作虚假排序'}:{status:'unknown',items:[],reason:'没有反对记录不代表没有风险'},
  invalidations,disagreement,conditions:projected,sourceCount:byId.size,conflictingSources:conflicts.size,modelInvoked:false,probability:null,...FLAGS};
}

function paperSettlement(trade,asOf){
 const p=trade.paperSettlement;
 if(!p||trade.source!=='V6 模拟成交'||p.symbol!==trade.code||!['pool','pre'].includes(p.accountId)||!known(p.exitTimestamp,asOf)||!Array.isArray(p.entryFills)||!p.entryFills.length||!p.entryFills.every(plain)||
  crypto.createHash('sha256').update(JSON.stringify(p)).digest('hex')!==trade.sourceFingerprint)return null;
 const legs=p.entryFills;
 if(legs.some(l=>!time(l.time)||l.time>=p.exitTimestamp||!Number.isSafeInteger(l.quantity)||l.quantity<=0||!Number.isSafeInteger(l.grossCents)||l.grossCents<=0||!Number.isSafeInteger(l.costCents)||l.costCents<l.grossCents||!l.eventId||!l.orderId||!finite(l.price)||l.price<=0||Math.round(l.price*l.quantity*100)!==l.grossCents))return null;
 const quantity=legs.reduce((n,l)=>n+l.quantity,0),gross=legs.reduce((n,l)=>n+l.grossCents,0),basis=legs.reduce((n,l)=>n+l.costCents,0);
 if(quantity!==p.exitQuantity||p.costBasisCents!==basis||![quantity,gross,basis,p.exitFeeCents,p.exitGrossCents,p.realizedCents].every(Number.isSafeInteger)||p.exitFeeCents<0||p.exitGrossCents<=0||p.realizedCents!==p.exitGrossCents-p.exitFeeCents-basis||!finite(p.exitPrice)||Math.round(p.exitPrice*quantity*100)!==p.exitGrossCents||p.tradeDate!==aShareCalendarDate(p.exitTimestamp)||timestamp(trade.createdAt)<p.exitTimestamp)return null;
 return {source:'verified-paper-import',entryAt:Math.min(...legs.map(l=>l.time)),exitAt:p.exitTimestamp,quantity,peakQuantity:quantity,buyGrossCents:gross,buyCostCents:basis,
  sellGrossCents:p.exitGrossCents,feesCents:basis-gross+p.exitFeeCents,netPnlCents:p.realizedCents,
  buyFills:legs.map(l=>({at:l.time,price:l.price,quantity:l.quantity,id:l.eventId})),sellFills:[{at:p.exitTimestamp,price:p.exitPrice,quantity,id:p.exitEventId}],evidenceIds:[p.exitEventId,...legs.map(l=>l.eventId)],brokerVerified:false};
}
function manualSettlement(trade,asOf){
 const p=trade.manualDecision;
 if(!p||trade.source!=='V6 本人人工执行账本'||p.brokerVerified!==false||!known(p.reconciledAt,asOf)||!known(p.frozenAt,p.reconciledAt)||!known(p.sourceAsOf,p.frozenAt)||timestamp(trade.createdAt)<p.reconciledAt||![p.planId,p.runId,p.sourceHash,p.reconciliationId,p.statementHash,p.fillsHash].every(hashOk)||store.digest(p)!==trade.sourceFingerprint||!Array.isArray(p.fills)||!p.fills.length||!p.fills.every(plain))return null;
 if(store.digest(p.fills.map(({recordedAt,...fill})=>fill))!==p.fillsHash)return null;
 const fills=p.fills;if(fills.some(f=>!known(f.executedAt,asOf)||!known(f.recordedAt,p.reconciledAt)||f.executedAt>f.recordedAt||!Number.isSafeInteger(f.quantity)||f.quantity<=0||!Number.isSafeInteger(f.priceUnits)||f.priceUnits<=0||!Number.isSafeInteger(f.amountCents)||f.amountCents<=0||!Number.isSafeInteger(f.feeCents)||f.feeCents<0||!['buy','sell'].includes(f.side)||!hashOk(f.id)||Number((BigInt(f.quantity)*BigInt(f.priceUnits)+50n)/100n)!==f.amountCents)||new Set(fills.map(f=>f.id)).size!==fills.length)return null;
 const buy=fills.filter(f=>f.side==='buy'),sell=fills.filter(f=>f.side==='sell');if(!buy.length||!sell.length)return null;
 const sum=(xs,key)=>xs.reduce((n,f)=>n+f[key],0),quantity=sum(buy,'quantity'),gross=sum(buy,'amountCents'),sellGross=sum(sell,'amountCents'),buyFees=sum(buy,'feeCents'),sellFees=sum(sell,'feeCents');
 if(![quantity,gross,sellGross,buyFees,sellFees,p.netPnlCents].every(Number.isSafeInteger)||quantity!==sum(sell,'quantity')||gross!==p.buyAmountCents||sellGross!==p.sellAmountCents||buyFees!==p.buyFeeCents||sellFees!==p.sellFeeCents||p.netPnlCents!==sellGross-sellFees-gross-buyFees)return null;
 let position=0,peakQuantity=0,last=0;
 for(const f of fills){position+=f.side==='buy'?f.quantity:-f.quantity;if(position<0||f.executedAt<last)return null;peakQuantity=Math.max(peakQuantity,position);last=f.executedAt;}
 const fmt=f=>({at:f.executedAt,price:f.priceUnits/10000,quantity:f.quantity,id:f.id});
 return {source:'reconciled-manual-import',entryAt:buy[0].executedAt,exitAt:sell.at(-1).executedAt,quantity,peakQuantity,buyGrossCents:gross,buyCostCents:gross+buyFees,
  sellGrossCents:sellGross,feesCents:buyFees+sellFees,netPnlCents:p.netPnlCents,buyFills:buy.map(fmt),sellFills:sell.map(fmt),evidenceIds:[p.reconciliationId,...fills.map(f=>f.id)],brokerVerified:false};
}
function pathReview(trade,settlement,bars,plan,asOf,tradeDates=[]){
 const entryDay=aShareCalendarDate(settlement.entryAt),exitDay=aShareCalendarDate(settlement.exitAt);
 const available=bars.filter(b=>!teaching(b)&&typeof b.date==='string'&&b.code===trade.code&&(!b.role||b.role==='stock')&&b.priceBasis==='unadjusted'&&known(b.knownAt,asOf)&&known(b.availableAt||cn(b.date.slice(0,10)),asOf)&&
  ['high','low','open','close'].every(k=>finite(b[k])&&b[k]>0)&&b.high>=Math.max(b.open,b.close,b.low)&&b.low<=Math.min(b.open,b.close));
 const intervals=new Map(),conflicts=new Set();
 for(const bar of available){
  const daily=dateOk(bar.date),end=daily?cn(bar.date):timestamp(bar.date),step=/^(1|5|15|30|60)m$/.exec(bar.period||'');
  const start=daily?cn(bar.date,'09:30:00'):timestamp(bar.startAt)??(end&&step?end-Number(step[1])*60000:null);
  if(!time(start)||!time(end)||start>=end||end>asOf||timestamp(bar.knownAt)<end||end<=settlement.entryAt||start>=settlement.exitAt)continue;
  const key=start+'/'+end,signature=store.digest(['open','high','low','close'].map(k=>bar[k]));
  if(intervals.has(key)&&intervals.get(key).signature!==signature)conflicts.add(key);
  intervals.set(key,{...bar,start,end,signature,key});
 }
 const points=[...intervals.values()].filter(b=>!conflicts.has(b.key)).sort((a,b)=>a.start-b.start||a.end-b.end);
 const full=points.filter(b=>b.start>=settlement.entryAt&&b.end<=settlement.exitAt);
 const price=settlement.buyGrossCents/100/settlement.quantity;
 const dailyBounds=points.length?{maximumPriceGainPct:round((Math.max(...points.map(b=>b.high))/price-1)*100),maximumPriceLossPct:round((Math.min(...points.map(b=>b.low))/price-1)*100)}:null;
 const ambiguous=points.some(b=>!full.includes(b));
 const dates=uniq(arr(tradeDates).filter(dateOk)).sort(),calendarCovered=dates.includes(entryDay)&&dates.includes(exitDay);
 const expected=calendarCovered?dates.filter(d=>d>=entryDay&&d<=exitDay).flatMap(day=>[['09:30:00','11:30:00'],['13:00:00','15:00:00']].map(([a,b])=>[Math.max(cn(day,a),settlement.entryAt),Math.min(cn(day,b),settlement.exitAt)]).filter(([a,b])=>a<b)):[];
 const covers=([start,end])=>{let cursor=start;for(const b of full){if(b.end<=cursor)continue;if(b.start>cursor)return false;cursor=Math.max(cursor,b.end);if(cursor>=end)return true;}return false;};
 const coverageComplete=expected.length>0&&!conflicts.size&&expected.every(covers);
 const observedGain=full.length?round((Math.max(...full.map(b=>b.high))/price-1)*100):null;
 const observedLoss=full.length?round((Math.min(...full.map(b=>b.low))/price-1)*100):null;
 const target=plan?.target??plan?.targetPrice,stop=plan?.stop??plan?.stopPrice;
 const touch=points.map(b=>({date:b.date,target:finite(target)&&b.high>=target,stop:finite(stop)&&b.low<=stop,withinHoldingWindow:full.includes(b)})).filter(x=>x.target||x.stop);
 const both=touch.some(x=>x.target&&x.stop);
 let order='unavailable';if(both)order='same-bar-unknown';else if(touch.some(x=>!x.withinHoldingWindow))order='outside-window-unknown';else if(touch.length)order=touch[0].target?'target-observed-first':'stop-observed-first';
 // The observed extrema are price excursions, not a portfolio value path for
 // partially filled or scaled positions. Daily entry/exit bounds are not MFE.
 return {status:conflicts.size?'conflicting-evidence':coverageComplete?'holding-window-observed':points.length?'observed-price-bounds':'missing',bars:points.length,fullHoldingBars:full.length,
  maximumFavourableExcursionPct:coverageComplete?observedGain:null,maximumAdverseExcursionPct:coverageComplete?observedLoss:null,
  observedMaximumFavourableExcursionPct:observedGain,observedMaximumAdverseExcursionPct:observedLoss,
  coverageComplete,calendarCovered,conflictingBars:conflicts.size,dailyBounds,endpointAmbiguous:ambiguous,priceBasis:'unadjusted',stopTargetOrder:order,touches:touch,
  note:coverageComplete?'日历内实际持有时段均有价格覆盖；这是相对加权买价的价格波动，不是分批仓位净值':ambiguous?'入场/退出K线包含持有窗口外价格，极值仅作边界，不冒充精确浮盈浮亏':'仅覆盖已提供的持有期价格点；未覆盖时段和部分成交净值保持未知',
  stopExecutionCompliance:'unknown',stopExecutionReason:'触及价位不证明当时可成交或已及时执行'};
}
function tradeDeepReview({archive={},ledger={},asOf=Date.now(),code}={}){
 atOf(asOf);const rows=[],unverified=[];
 const barsByCode=new Map();for(const b of arr(archive.bars))if(codeOk(b?.code)){if(!barsByCode.has(b.code))barsByCode.set(b.code,[]);barsByCode.get(b.code).push(b);}
 const trades=bounded(arr(archive.trades),5000,'成交');const seen=new Map(),fingerprints=new Map(),conflicts=new Set();
 for(const t of trades){if(!t||typeof t.id!=='string')continue;const fingerprint=t.sourceFingerprint||null;if(fingerprints.has(t.id)&&fingerprints.get(t.id)!==fingerprint)conflicts.add(t.id);fingerprints.set(t.id,fingerprint);}
 for(const trade of trades){
  if(!plain(trade)||code&&trade.code!==code||!codeOk(trade.code)||!known(trade.createdAt,asOf)||teaching(trade)||archive.scope==='demo')continue;
  const key=trade.id;if(typeof key!=='string'||conflicts.has(key)){unverified.push({id:key||null,reason:'成交编号缺失或同编号来源内容冲突'});continue;}if(seen.has(key))continue;seen.set(key,true);
  const settled=paperSettlement(trade,asOf)||manualSettlement(trade,asOf);
  if(!settled||settled.exitAt<=settled.entryAt||settled.buyCostCents<=0){unverified.push({id:key,code:trade.code,reason:'缺少可核对的原结算/人工对账引用、净成本或实际成交时点'});continue;}
  const plans=arr(archive.plans).filter(p=>p.id===trade.planId&&p.code===trade.code&&known(p.frozenAt,settled.entryAt));
  const candidate=plans.length===1?plans[0]:null,link=trade.decisionLink;
  // The authoritative importer ties each buy event to a fingerprinted frozen
  // plan. A later same-ID plan revision cannot rewrite historical discipline.
  const plan=candidate&&trade.paperSettlement&&trade.planVerified===true&&link?.planId===candidate.id&&known(link.knownAt,asOf)&&known(trade.planLinkedAt,asOf)&&
   link.planFingerprint===crypto.createHash('sha256').update(JSON.stringify(candidate)).digest('hex')&&
   arr(link.entryEventIds).length===settled.buyFills.length&&settled.buyFills.every(f=>link.entryEventIds.includes(f.id))?candidate:null;
  const manualPlanBefore=trade.manualDecision&&known(trade.manualDecision.frozenAt,settled.entryAt);
  const entryMin=plan?.entryMin,entryMax=plan?.entryMax??(manualPlanBefore?trade.manualDecision.limitPriceUnits/10000:null);
  const outside=finite(entryMax)?settled.buyFills.some(f=>f.price>entryMax||finite(entryMin)&&f.price<entryMin):null;
  rows.push({id:key,code:trade.code,name:text(trade.name,80),source:trade.source,settlementSource:settled.source,entryAt:settled.entryAt,exitAt:settled.exitAt,
   shares:settled.quantity,grossPnl:(settled.sellGrossCents-settled.buyGrossCents)/100,netPnl:settled.netPnlCents/100,fees:settled.feesCents/100,
   netReturnPct:round(settled.netPnlCents/settled.buyCostCents*100),holdingHours:round((settled.exitAt-settled.entryAt)/3600000),
   entryPrice:round(settled.buyGrossCents/100/settled.quantity),exitPrice:round(settled.sellGrossCents/100/settled.quantity),
   planId:plan?.id||trade.manualDecision?.planId||null,planDeviation:{planKnownBeforeEntry:!!plan||!!manualPlanBefore,entryOutsideFrozenRange:outside,quantityOverPlan:finite(plan?.shares)?settled.peakQuantity>plan.shares:manualPlanBefore?settled.peakQuantity>trade.manualDecision.plannedShares:null,
    disciplineFacts:arr(trade.disciplineFacts).map(f=>({rule:text(f.rule,80),status:text(f.status,40),evidence:text(f.evidence)}))},
   path:pathReview(trade,settled,barsByCode.get(trade.code)||[],plan,asOf,archive.tradeDates||archive.calendar?.tradeDates),evidenceIds:settled.evidenceIds,sourceFingerprint:trade.sourceFingerprint,brokerVerified:false});
 }
 const notExecuted=[];
 for(const plan of arr(ledger.plans))if((!code||plan.symbol===code)&&plan.notExecuted&&known(plan.notExecuted.recordedAt,asOf))notExecuted.push({id:plan.id,code:plan.symbol,reason:text(plan.notExecuted.reason),recordedAt:plan.notExecuted.recordedAt,source:'original-manual-journal'});
 const linksVisible=known(archive.manualLoopSource?.observedAt??archive.manualLoopSource?.updatedAt??archive.manualLoopSource?.recordedAt,asOf);
 for(const link of arr(archive.manualLoopLinks))if(linksVisible&&(!code||link.code===code)&&!link.tradeId&&known(link.frozenAt,asOf))notExecuted.push({id:link.planId,code:link.code,reason:arr(link.missing).map(x=>text(x)).join('；')||text(link.status),recordedAt:timestamp(archive.manualLoopSource.observedAt??archive.manualLoopSource.updatedAt??archive.manualLoopSource.recordedAt),source:'manual-loop-link',status:text(link.status)});
 return {mode:'original-settlement-review',rows,unverified,notExecuted,counts:{settled:rows.length,unverified:unverified.length,notExecuted:notExecuted.length},...FLAGS,
  note:'原模拟账本与本人申报已对账记录分源展示；不是券商认证，不从研究信号伪造真实成交'};
}

function evaluateResearchAnswer(answer,{evidence=[],code,asOf=Date.now()}={}){
 atOf(asOf);const checks=[];
 const add=(id,pass,reason)=>checks.push({id,status:pass?'pass':'fail',reason});
 const allowed=['code','status','claims','probability','actions',...Object.keys(FLAGS)];
 let boundedAnswer=false;
 try{boundedAnswer=plain(answer)&&Object.keys(answer).every(k=>allowed.includes(k))&&['observed','insufficient-data'].includes(answer.status)&&Array.isArray(answer.claims)&&answer.claims.length<=200&&answer.claims.every(c=>plain(c)&&['observed','unknown'].includes(c.status)&&typeof c.text==='string'&&c.text.length<=2000)&&JSON.stringify(store.canonical(answer)).length<=200000;}catch{}
 add('bounded-structure',boundedAnswer,'输出必须为有界结构化研究解释');
 if(!boundedAnswer)return {status:'fail',checks,mode:'deterministic-contract-evaluation',modelInvoked:false,...FLAGS};
 const refs=new Map(),conflicts=new Set();
 for(const e of arr(evidence).filter(e=>plain(e)&&hashOk(e.id))){if(refs.has(e.id)&&store.digest(refs.get(e.id))!==store.digest(e))conflicts.add(e.id);refs.set(e.id,e);}
 const claims=arr(answer.claims),usable=id=>{const e=refs.get(id);return e&&!conflicts.has(id)&&e.status!=='unknown'&&(!code||(e.symbol===code||e.code===code)&&(e.symbol==null||e.symbol===code)&&(e.code==null||e.code===code))&&known(e.availableAt??e.knownAt,asOf)&&known(e.receivedAt??e.knownAt,asOf)&&(!e.periodEnd||known(e.periodEnd,asOf));};
 const factual=claims.filter(c=>c?.status!=='unknown');
 add('same-symbol',answer.code===code,'解释对象必须与原证据证券一致');
 add('no-trading-authority',answer.canTrade===false&&answer.canNotify===false&&answer.productionWeightsChanged===false&&answer.accountMutated!==true&&answer.autoPromotion!==true&&(!answer.actions||Array.isArray(answer.actions)&&answer.actions.length===0),'研究解释没有下单、通知或修改权重的权限');
 add('claim-citations',factual.every(c=>arr(c.evidenceIds).length&&c.evidenceIds.every(usable)),'每条事实必须引用同股且当时可得的来源');
 add('quoted-value-faithfulness',factual.every(c=>c.value===undefined||arr(c.evidenceIds).some(id=>usable(id)&&store.digest(refs.get(id).value??null)===store.digest(c.value))),'直接引述的字段值必须与引用回执一致');
 add('no-unknown-as-zero',claims.every(c=>c.status!=='unknown'||c.value==null),'缺失结论不得填成零值或肯定判断');
 add('no-implied-probability',answer.probability==null&&claims.every(c=>c.probability==null&&!/(?:上涨|涨停|盈利|获利|赚钱|收益)概率\s*[:：]?\s*\d|必涨|稳赚|保证收益/.test(text(c.text,2000))),'匹配度和规则分不伪装成上涨概率或收益保证');
 add('refusal-on-missing',factual.length>0||answer.status==='insufficient-data','证据不足时明确无法判断');
 add('no-secret-output',!/\b(?:api[_ -]?key|sharecode|password|bearer)\b\s*[:=]/i.test(JSON.stringify(answer)),'输出不得包含凭据字段');
 add('no-source-instructions',claims.every(c=>!/忽略.{0,8}(?:指令|规则)|绕过.{0,8}(?:风控|权限)|ignore (?:all |previous )?instructions|system prompt/i.test(text(c.text,2000))),'来源中的命令文字不能变成系统行为或投资理由');
 return {schemaVersion:1,status:checks.every(c=>c.status==='pass')?'pass':'fail',checks,mode:'deterministic-contract-evaluation',modelInvoked:false,...FLAGS};
}
function answerFromCounter(counter){return {code:counter.code,status:counter.status==='insufficient-data'?'insufficient-data':'observed',claims:[...counter.support,...counter.opposition].map(c=>({...c,status:'observed'})),probability:null,...FLAGS};}
function evaluateCounterEvidence(counter,run,asOf){
 const d=run?.data||run||{},answer=answerFromCounter(counter);
 const evaluationAt=time(counter.decisionAt)&&counter.decisionAt<=asOf?counter.decisionAt:asOf;
 const result=evaluateResearchAnswer(answer,{code:counter.code,evidence:arr(d.evidence),asOf:evaluationAt});
 return {...result,answerKind:'existing-rule-evidence',claims:answer.claims.length,evaluationAt,evaluationFingerprint:store.digest({protocol:'explanation-contract-v1',answer,evidence:arr(d.evidence),asOf:evaluationAt,result}),
  coverage:{sources:counter.sourceCount,support:counter.support.length,opposition:counter.opposition.length,missing:counter.missing.length},
  limitation:'验证现有规则解释的来源与权限合同；未调用或宣称评估外部大模型推理质量'};
}

const STAGES=[
 {id:'pre-market',name:'盘前',start:'00:00:00',end:'09:15:00',task:'核对昨收、公告、日历及原冻结计划'},
 {id:'auction',name:'竞价',start:'09:15:00',end:'09:30:00',task:'核对当日竞价原始时点与盘前假设'},
 {id:'intraday',name:'盘中',start:'09:30:00',end:'14:57:00',task:'跟踪原候选、条件变化与风险证据'},
 {id:'midday',name:'午间',start:'11:30:00',end:'13:00:00',task:'复核上午证据、候选降级及原计划'},
 {id:'close',name:'收盘',start:'14:57:00',end:'15:15:00',task:'等待完整日线、原成交与收盘快照'},
 {id:'post-market',name:'盘后',start:'15:15:00',end:'23:59:59',task:'读取执行日报、单笔复盘与原验证反馈'}
];
function sixStageWorkflow({archive={},events=[],calendar={},asOf=Date.now()}={}){
 atOf(asOf);const day=aShareCalendarDate(asOf),minute=new Date(asOf+28800000).toISOString().slice(11,19);
 const calendarTime=calendar.knownAt??calendar.observedAt;
 const calendarKnown=calendarTime==null||known(calendarTime,asOf);
 const explicit=calendar.day===day&&typeof calendar.isOpen==='boolean'?calendar.isOpen:typeof calendar.tradingDay==='boolean'&&calendar.day===day?calendar.tradingDay:null;
 const dates=uniq(arr(calendar.tradeDates).filter(dateOk)).sort();
 const covered=dates.length&&dates[0]<=day&&dates.at(-1)>=day;
 const open=calendarKnown?(explicit??(covered?dates.includes(day):null)):null;
 let active=minute<'09:15:00'?'pre-market':minute<'09:30:00'?'auction':minute>='11:30:00'&&minute<'13:00:00'?'midday':minute<'14:57:00'?'intraday':minute<'15:15:00'?'close':'post-market';
 if(open!==true)active=open===false?'closed':'unknown-calendar';
 const plans=arr(archive.plans).filter(p=>(p.intendedDate||timestamp(p.frozenAt)&&aShareCalendarDate(timestamp(p.frozenAt)))===day&&known(p.frozenAt,asOf));
 const scans=screenSnapshots(events,asOf).filter(e=>aShareCalendarDate(e.data.asOf||e.recordedAt)===day);
 const bars=[...arr(archive.bars),...arr(archive.v6Observation?.minuteBars)].filter(b=>String(b.date).slice(0,10)===day&&known(b.knownAt,asOf)&&known(b.availableAt||(String(b.date).length===10?cn(day):b.date),asOf)&&known(String(b.date).length===10?cn(day):b.date,asOf));
 const market=[...arr(archive.marketHistory),...arr(archive.market)].filter(r=>r.date===day&&known(r.knownAt??r.recordedAt,asOf));
 const reports=[...arr(archive.executionReports),...(archive.executionReport?[archive.executionReport]:[])].filter(r=>r.day===day&&known(r.recordedAt,asOf));
 const feedback=arr(archive.feedbackRuns).filter(r=>(r.day||r.date)===day&&known(r.recordedAt??r.createdAt,asOf));
 const counts={'pre-market':plans.length,'auction':bars.filter(b=>String(b.date).slice(11,16)>='09:15'&&String(b.date).slice(11,16)<='09:25').length,
  intraday:scans.length+bars.filter(b=>String(b.date).length>10).length,midday:scans.filter(e=>new Date((e.data.asOf||e.recordedAt)+28800000).toISOString().slice(11,16)<='11:30').length,
  close:market.length+bars.filter(b=>String(b.date).length===10&&asOf>=cn(day,'15:10:00')).length,'post-market':reports.length+feedback.length};
 const stages=STAGES.map(s=>{
  const start=cn(day,s.start),end=cn(day,s.end),current=s.id===active;
  const status=open===null?'calendar-unknown':open===false?'closed':current?'current':asOf<start?'upcoming':'elapsed';
  return {...s,day,startAt:start,endAt:end,status,evidenceCount:counts[s.id],evidenceStatus:counts[s.id]?'observed':'missing',
   reason:open===null?'缺少该日可用日历，不能推断交易时段':open===false?'日历确认休市；保留原日快照并继续查阅已知消息':counts[s.id]?'读取原档案中截至所选时点的证据':'尚未取得该阶段对应证据；时间经过不表示工作完成',canTrade:false};
 });
 return {day,asOf,timezone:'Asia/Shanghai',active,calendarStatus:open===null?'unknown':open?'open-day':'closed-day',calendarSource:text(calendar.source,160)||null,stages,
  evidence:{plans:plans.map(p=>p.id),screenings:scans.map(e=>e.hash),reports:reports.map(r=>r.reportHash||r.id).filter(Boolean),feedback:feedback.map(r=>r.id||r.hash).filter(Boolean)},...FLAGS};
}
function buildEvolutionWorkflow({archive={},events=[],asOf=Date.now(),code,ledger={},calendar={}}={}){
 atOf(asOf);bounded(events,10000,'研究历史');if(code!==undefined&&code!==''&&!codeOk(code))throw Error('研究证券代码无效');
 const visible=events.filter(e=>visibleEvent(e,asOf));
 const run=visible.filter(e=>e.kind==='analysis'&&(!code||e.data.symbol===code)).sort((a,b)=>a.recordedAt-b.recordedAt||a.sequence-b.sequence).at(-1)||null;
 const counterEvidence=buildCounterEvidence(run?.data||{symbol:code||null},asOf);
 return {schemaVersion:1,protocol:SCHEMA,asOf,code:code||run?.data.symbol||null,lifecycle:candidateLifecycle(visible,{archive,asOf,code}),counterEvidence,
  trades:tradeDeepReview({archive,ledger,asOf,code}),aiEvaluation:evaluateCounterEvidence(counterEvidence,run?.data,asOf),
  workflow:sixStageWorkflow({archive,events:visible,calendar,asOf}),preferences:preferencesFromEvents(visible,asOf),...FLAGS};
}
module.exports={SCHEMA,STATUSES,COLUMNS,SECTIONS,defaultEvolutionPreferences,preferenceInput,readEvolutionPreferences,saveEvolutionPreferences,
 recordCandidateTransitions,candidateLifecycle,buildCounterEvidence,tradeDeepReview,evaluateResearchAnswer,evaluateCounterEvidence,sixStageWorkflow,buildEvolutionWorkflow};
