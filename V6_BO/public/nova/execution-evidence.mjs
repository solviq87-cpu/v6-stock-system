// Presentation checks for server-owned execution facts. This module never
// infers an execution, a missed trade, or a completed review from prices.
const text=value=>typeof value==='string'?value.trim():'';
const list=value=>Array.isArray(value)?value:[];
const time=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=now;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0;
export const executionLabels=Object.freeze({'not-planned':'未计划',frozen:'已冻结','waiting-condition':'待条件',
 executed:'已执行','risk-pending':'待风控',reviewed:'已复盘',unknown:'未知'});
export function executionDay(value){
 const day=text(value).replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),at=Date.parse(day+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===day?day:null;
}
export function paperEvidenceDay(ctx,now=Date.now()){
 const value=ctx.decisionSelection?.day||ctx.state?.closeSession?.day||ctx.state?.marketClock?.day||new Date(now+28800000).toISOString().slice(0,10);
 return executionDay(value);
}
export function readExecutionChecklist(value,{day,role,now=Date.now(),persisted=false}={}){
 day=executionDay(day);
 const unavailable=reason=>({day,status:'unknown',items:[],missing:[reason],reason,generatedAt:null});
 if(role!=='edit')return {day,status:'private',items:[],missing:[],reason:'执行状态仅向已认证的编辑身份开放',generatedAt:null};
 if(!day||value?.protocol!=='paper-execution-checklist-v1'||executionDay(value.day)!==day||value.account!=='pool'||
   !time(value.generatedAt,now)||!Array.isArray(value.items)||value.items.length>1000)
  return unavailable('后台执行清单的日期或证据尚未完成核对');
 if(!persisted&&now-value.generatedAt>120000)return unavailable('执行状态已超过后台缓存有效期，等待重新核对');
 const items=value.items.map(item=>{
  const valid=item&&/^\d{6}$/.test(item.code||'')&&executionDay(item.day)===day&&
   Object.hasOwn(executionLabels,item.state)&&text(item.reason);
  if(!valid)return {code:/^\d{6}$/.test(item?.code||'')?item.code:'',name:'标的状态待核验',day,state:'unknown',label:executionLabels.unknown,
   reason:'该项股票、日期、状态或依据未通过展示核对',missing:['执行记录不完整'],entry:null,intent:null,risk:[],review:null,planId:null};
  return {...item,name:text(item.name)||item.code,day,label:executionLabels[item.state],reason:text(item.reason),
   missing:list(item.missing).filter(v=>typeof v==='string'),risk:list(item.risk)};
 });
 const missing=list(value.missing).filter(v=>typeof v==='string');
 return {...value,day,items,missing,reason:missing.join('；')||value.note||
  (items.length?'状态来自原冻结计划、条件意图和持久成交':'该日没有已记录的执行计划')};
}
export function readExecutionReport(value,{day,role,now=Date.now()}={}){
 day=executionDay(day);
 const unavailable=reason=>({day,status:'unknown',report:null,reason});
 if(role!=='edit')return {day,status:'private',report:null,reason:'执行日报仅向已认证的编辑身份开放'};
 if(!day||!value||executionDay(value.day)!==day)return unavailable('所选日期的持久执行日报尚未返回');
 if(value.status!=='observed'||!value.report)return {day,status:value.status==='missing'?'missing':'unknown',report:null,
  reason:[text(value.reason),...list(value.missing).filter(v=>typeof v==='string')].filter(Boolean).join('；')||'持久执行日报尚未完成核验'};
 const report=value.report,score=report.score;
 if(!Number.isSafeInteger(value.reportVersion)||value.reportVersion<1||!hash(value.reportHash)||!time(value.recordedAt,now)||
   report.protocol!=='paper-execution-daily-report-v1'||report.account!=='pool'||executionDay(report.day)!==day||
   !time(report.calculatedAt,value.recordedAt)||report.closedAt!==Date.parse(day+'T15:00:00+08:00')||value.recordedAt<report.closedAt||
   !score||executionDay(score.day)!==day||score.closed!==true||
   !(score.score===null||typeof score.score==='number'&&Number.isFinite(score.score)&&score.score>=0&&score.score<=100)||
   !count(score.assessed)||!count(score.unknown)||!Array.isArray(score.rows))
  return unavailable('持久执行日报的版本、日期或原始生成时点未通过核验');
 return {...value,day,status:'observed',report,reason:report.note||'已读取持久保存的收盘执行日报'};
}
export function readExecutionReportHistory(value,{day,role,now=Date.now()}={}){
 day=executionDay(day);
 if(role!=='edit')return {status:'private',day,total:0,versions:[]};
 if(!value||executionDay(value.day)!==day||!count(value.total)||!Array.isArray(value.versions)||value.total<value.versions.length||
  value.versions.some(row=>!Number.isSafeInteger(row.reportVersion)||row.reportVersion<1||!hash(row.reportHash)||!time(row.recordedAt,now))||
  new Set(value.versions.map(row=>row.reportVersion)).size!==value.versions.length)
  return {status:'unknown',day,total:null,versions:[],reason:'该日期的日报版本历史尚未完成核验'};
 return {...value,day,status:'observed',versions:[...value.versions].sort((a,b)=>b.reportVersion-a.reportVersion)};
}
