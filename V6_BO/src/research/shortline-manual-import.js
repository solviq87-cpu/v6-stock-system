'use strict';

// Server-owned projection of the user's append-only native decision journal.
// All reads go through its integrity-checked public view. No execution,
// reconciliation or journal writes take place here.
const path=require('node:path');
const manual=require('../core/manual-decision-loop');
const {digest}=require('../core/research-workspace-store');

const SOURCE='V6 本人人工执行账本';
const CN=8*3600000;
const wall=ms=>new Date(ms+CN).toISOString().slice(0,16);
const iso=ms=>new Date(ms).toISOString();
const hashId=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const validTime=(n,now)=>Number.isSafeInteger(n)&&n>0&&n<=now;
const clean=x=>typeof x==='string'?x.slice(0,200):'';
const money=n=>Number.isSafeInteger(n)&&n>=0;
const fact=(rule,status,evidence)=>({rule,status,evidence});
const idOf=p=>'v6-manual-'+p.id;

function readiness(plan,now){
  if(!hashId(plan.id)||!/^\d{6}$/.test(plan.symbol)||!validTime(plan.frozenAt,now)||
    !hashId(plan.runId)||!hashId(plan.sourceHash)||!validTime(plan.sourceAsOf,plan.frozenAt))return '原始研究及建议快照缺失';
  if(plan.notExecuted)return '已记录未执行';
  if(!plan.fills.length)return '尚无本人实际成交';
  if(plan.totals.quantity!==0)return '尚有未平仓数量';
  const rec=plan.reconciliation;
  if(!rec)return '已登记买卖，等待原账本对账';
  if(!rec.matched)return '原账本交割记录与成交不一致';
  if(rec.brokerVerified!==false||!validTime(rec.recordedAt,now)||!hashId(rec.id)||
    rec.fillsHash!==digest(plan.fills)||!Array.isArray(rec.rows)||rec.rows.length!==plan.fills.length)return '当前成交与原对账版本不一致';
  return '';
}

function settlement(plan,now){
  const history=new Map(plan.history.filter(h=>h.type==='fill').map(h=>[h.id,h.recordedAt]));
  const reconciled=plan.reconciliation;
  const statement=new Map(reconciled.rows.map(f=>[f.reference,f]));
  if(statement.size!==plan.fills.length)return null;
  let buyQty=0,sellQty=0,buyAmount=0,sellAmount=0,buyFees=0,sellFees=0;
  let position=0,peak=0,highestBuy=0,entry=0,exit=0,last=0;
  const fills=[];
  for(const f of plan.fills){
    const original=statement.get(f.reference),recordedAt=history.get(f.id);
    if(!original||!hashId(f.id)||!['buy','sell'].includes(f.side)||
       !Number.isSafeInteger(f.quantity)||f.quantity<1||!Number.isSafeInteger(f.priceUnits)||f.priceUnits<1||
       !money(f.feeCents)||!money(f.amountCents)||!validTime(f.executedAt,recordedAt)||
       !validTime(recordedAt,reconciled.recordedAt)||f.executedAt<last)return null;
    if(['side','quantity','priceUnits','feeCents','amountCents','executedAt'].some(k=>f[k]!==original[k]))return null;
    if(Number((BigInt(f.quantity)*BigInt(f.priceUnits)+50n)/100n)!==f.amountCents)return null;
    statement.delete(f.reference);last=f.executedAt;
    if(f.side==='buy'){
      entry ||= f.executedAt;
      position+=f.quantity;peak=Math.max(peak,position);highestBuy=Math.max(highestBuy,f.priceUnits);
      buyQty+=f.quantity;buyAmount+=f.amountCents;buyFees+=f.feeCents;
    }else{
      position-=f.quantity;if(position<0)return null;
      exit=f.executedAt;sellQty+=f.quantity;sellAmount+=f.amountCents;sellFees+=f.feeCents;
    }
    fills.push({id:f.id,reference:f.reference,side:f.side,quantity:f.quantity,priceUnits:f.priceUnits,
      amountCents:f.amountCents,feeCents:f.feeCents,executedAt:f.executedAt,recordedAt});
  }
  const basis=buyAmount+buyFees,credit=sellAmount-sellFees,net=credit-basis;
  if(!entry||exit<=entry||position!==0||!buyQty||buyQty!==sellQty||!basis||statement.size||
     ![basis,credit,net].every(Number.isSafeInteger)||plan.totals.buyCents!==basis||
     plan.totals.sellCents!==credit||plan.totals.netPnlCents!==net)return null;
  const before=plan.frozenAt<=entry;
  const facts=before?[
    fact('计划关联','符合','成交标的 '+plan.symbol+' 对应成交前已冻结的原建议'),
    fact('追高',highestBuy>plan.limitPriceUnits?'触发':'符合','最高买入价 '+highestBuy/10000+' 元，冻结上限 '+plan.limitPriceUnits/10000+' 元'),
    fact('数量上限',peak>plan.shares?'触发':'符合','峰值持股 '+peak+' 股，冻结计划 '+plan.shares+' 股')
  ]:[fact('计划关联','资料不足','首笔成交早于原建议冻结时点')];
  facts.push(fact('超仓','资料不足','未记录成交时完整组合权益及仓位比例'),
    fact('违反止损','资料不足','未记录止损触发时的可成交窗口和执行过程'),
    fact('过早离场','资料不足','原建议未冻结最早离场时间'));
  const nativeFacts=plan.totals.deviations.filter(x=>!['数量超过建议数量','买价高于建议上限','成交早于建议冻结时点'].includes(x));
  for(const text of nativeFacts)facts.push(fact('原账本交易日历','触发',text));
  const selection=(plan.roles?.selection||[]).filter(s=>s?.verdict==='pass').map(s=>clean(s.label||s.id)).filter(Boolean);
  const factors=before?[...new Set(selection.map(s=>'原研究通过·'+s))]:[];
  const provenance={planId:plan.id,runId:plan.runId,sourceHash:plan.sourceHash,sourceAsOf:plan.sourceAsOf,
    frozenAt:plan.frozenAt,limitPriceUnits:plan.limitPriceUnits,plannedShares:plan.shares,
    reconciliationId:reconciled.id,statementHash:reconciled.statementHash,fillsHash:reconciled.fillsHash,
    reconciledAt:reconciled.recordedAt,brokerVerified:false,fills,
    buyAmountCents:buyAmount,buyFeeCents:buyFees,sellAmountCents:sellAmount,sellFeeCents:sellFees,netPnlCents:net};
  const date=wall(entry).slice(0,10),exitDate=wall(exit).slice(0,10);
  return {id:idOf(plan),source:SOURCE,sourceSet:'本人人工实录',code:plan.symbol,name:clean(plan.name)||plan.symbol,
    date,entryTime:wall(entry),exitTime:wall(exit),exitDate,holdDays:(Date.parse(exitDate)-Date.parse(date))/86400000,
    shares:buyQty,entryPrice:buyAmount/100/buyQty,exitPrice:sellAmount/100/sellQty,cost:(buyFees+sellFees)/100,
    costBasis:basis/100,pnlAmount:net/100,pnl:Math.round(net/basis*10000)/100,
    manualDecision:provenance,sourceFingerprint:digest(provenance),createdAt:iso(now),position:null,
    planId:null,planStatus:before?'原建议已冻结':'历史补录',snapshotVerified:before,brokerVerified:false,
    strategy:'未判定',strategies:[],factors,knownRiskFactors:[],trend:'未判定',
    labels:{sourceSet:'本人人工实录',overnight:date===exitDate?'否':'是'},frozenLabels:{},
    exitReason:'本人记录卖出并对账平仓',quality:'本人申报已对账',repeatable:null,blackSwan:null,
    disciplineFacts:facts,violations:[...new Set(facts.filter(x=>x.status==='触发').map(x=>x.rule))],
    reviewable:facts.some(x=>x.status==='符合'||x.status==='触发'),attribution:'未判定'};
}

function importManualDecisionLoop(state,{root=process.env.V6_MANUAL_DECISION_LOOP_DIR||path.resolve(__dirname,'../../data/manual-decision-loop'),now=Date.now()}={}){
  const report={imported:0,updated:0,retracted:0,invalidated:0,linked:0,unchanged:0,exitDays:[],changed:false,issues:[]};
  let view;
  try{view=manual.view(root);}catch{report.issues.push('原生人工执行账本未通过权限或完整性核验，保留已归档记录');return report;}
  if(!validTime(now,Date.now())||view.brokerVerified!==false||view.accountWrites!==false||view.canTrade!==false){
    report.issues.push('人工执行来源身份或观测时点无效');return report;
  }
  const previous=state.manualLoopSource;
  // A missing mount, rollback or different journal must not retract previously
  // verified executions. Native correction events are the only withdrawal trigger.
  const history=view.plans.flatMap(p=>p.history);
  if(history.some(h=>!validTime(h.recordedAt,now))||previous&&
    (previous.revision>view.revision||!history.some(h=>h.id===previous.headHash))){
    report.issues.push('原生人工执行账本缺失、回退或来源链已变化，原投影保留');return report;
  }
  if(!view.revision)return report;
  const existing=new Map((state.trades||[]).map(t=>[t.id,t]));
  const links=[],changedRows=new Map(),withdrawn=new Set(),days=new Set(),notes=[];
  for(const p of view.plans){
    if(state.ledgerStartAt&&p.frozenAt<=state.ledgerStartAt)continue;
    const rowId=idOf(p),old=existing.get(rowId);
    if(old && !(old.source===SOURCE&&old.manualDecision?.planId===p.id)){
      report.issues.push('原生计划编号与其他来源样本冲突，原投影保留');return report;
    }
    let gap=readiness(p,now),row;
    if(!gap){row=settlement(p,now);if(!row)gap='成交数量、净成本、时间或对账金额无法逐笔核对';}
    const link={source:SOURCE,planId:p.id,runId:p.runId,code:p.symbol,name:clean(p.name)||p.symbol,
      frozenAt:p.frozenAt,plannedShares:p.shares,limitPrice:p.limitPriceUnits/10000,fillCount:p.fills.length,
      currentShares:p.totals.quantity,status:p.status,missing:gap?[gap]:[],tradeId:row?.id||null,
      brokerVerified:false};
    links.push(link);
    if(row){
      if(old?.sourceFingerprint===row.sourceFingerprint)report.unchanged++;
      else{changedRows.set(rowId,row);days.add(row.exitDate);if(old){report.updated++;days.add(old.exitDate);}else report.imported++;}
    }else if(old){withdrawn.add(rowId);days.add(old.exitDate);report.retracted++;}
    if(p.review?.note)notes.push({id:'native-review-'+p.review.id,tradeId:row?.id||null,manualPlanId:p.id,
      source:SOURCE,text:p.review.note,createdAt:iso(p.review.recordedAt)});
    if(p.notExecuted?.reason)notes.push({id:'native-unexecuted-'+p.id,tradeId:null,manualPlanId:p.id,
      source:SOURCE,text:p.notExecuted.reason,createdAt:iso(p.notExecuted.recordedAt)});
  }
  const externalNotes=(state.explanations||[]).filter(n=>!(n.source===SOURCE&&n.manualPlanId));
  const previousNotes=(state.explanations||[]).filter(n=>n.source===SOURCE&&n.manualPlanId);
  if(digest(previousNotes)!==digest(notes)){
    const ids=new Set([...previousNotes,...notes].map(n=>n.tradeId).filter(Boolean));
    for(const id of ids){const row=changedRows.get(id)||existing.get(id);if(row)days.add(row.exitDate);}
  }
  report.linked=links.length;report.exitDays=[...days].sort();
  report.changed=Boolean(changedRows.size||withdrawn.size||view.headHash!==previous?.headHash||
    digest(previousNotes)!==digest(notes)||digest(state.manualLoopLinks||[])!==digest(links));
  if(report.changed){
    state.trades=(state.trades||[]).filter(t=>!withdrawn.has(t.id)&&!changedRows.has(t.id)).concat([...changedRows.values()]);
    const invalidIds=new Set([...withdrawn,...[...changedRows.keys()].filter(id=>existing.has(id))]);
    for(const c of state.candidates||[]){
      if(c.status!=='待人工审批'||c.decision||(state.versions||[]).some(v=>v.candidateId===c.id))continue;
      const hits=(c.sourceIds||[]).filter(id=>invalidIds.has(id));
      if(!hits.length)continue;
      c.status='原始成交证据已失效';
      c.invalidation={at:iso(now),source:SOURCE,sourceIds:hits,reason:'原账本对账撤回或成交版本已修正'};
      report.invalidated++;
    }
    state.manualLoopLinks=links;state.explanations=[...externalNotes,...notes];
    state.manualLoopSource={revision:view.revision,headHash:view.headHash};
  }
  return report;
}
module.exports={importManualDecisionLoop};
