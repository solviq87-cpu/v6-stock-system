'use strict';
// Read-only, time-bounded issuer-document clues: NOT verified sentiment or trading advice.
const {createHash}=require('node:crypto');
const OFFICIAL_PDF=/^https:\/\/static\.cninfo\.com\.cn\/finalpage\/\d{4}-\d{2}-\d{2}\/\d+\.pdf$/i;
const TIME=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const RISK=/立案调查|行政处罚|退市风险|终止上市|债务违约|资金占用|业绩预亏|重大亏损|净利润下降|业绩下滑|冻结|失信被执行|被执行人|停产|重大诉讼|减持计划|减持股份|财务造假|终止回购|终止合同|取消分红|终止重组/;
const STRENGTH=/回购股份|股份回购|增持股份|增持计划|现金分红|利润分配|业绩预增|业绩增长|净利润增长|扭亏为盈|中标|签订重大合同|重大订单|技术突破|获批|订单增长/;
function clean(value,max=180){return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';}
function strictInstant(value,now){
 if(typeof value!=='string'||!TIME.test(value))return null;
 const time=Date.parse(value);
 if(!Number.isFinite(time)||time<=0||time>now)return null;
 // Reject JS rollover of impossible calendar days and invalid timezone offsets.
 const parts=value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|([+-])(\d{2}):(\d{2}))$/);
 if(!parts||+parts[2]>=24||+parts[3]>=60||+parts[4]>=60||
   (parts[7]&&(+parts[7]>23||+parts[8]>59)))return null;
 const date=parts[1],base=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(base)||new Date(base).toISOString().slice(0,10)!==date)return null;
 return time;
}
function classifyTitle(title){
 const risk=RISK.test(title),strength=STRENGTH.test(title);
 return risk&&strength?'conflicting':risk?'risk-clue':strength?'strength-clue':'neutral-review';
}
function linkIssuerEvents({symbol,announcements=[],now=Date.now(),maxAgeDays=90}={}){
 const code=String(symbol||'').trim(),validClock=Number.isFinite(now)&&now>0;
 const base={status:'no-verified-feed',symbol:code,asOf:now,events:[],riskClues:[],strengthClues:[],
  conflicts:[],count:0,unusableCount:0,notes:['标题分类仅供人工核对，未阅读公告正文；不修改选股或交易分数']};
 if(!/^\d{6}$/.test(code)||!validClock||!Number.isSafeInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>366)return {...base,status:'invalid-input'};
 if(!Array.isArray(announcements)||announcements.length>100)return {...base,status:'invalid-input'};
 let unusableCount=0;const unique=new Map();
 for(const item of announcements){
  if(!item||typeof item!=='object'){unusableCount++;continue;}
  const codes=Array.isArray(item.codes)?item.codes:typeof item.code==='string'?[item.code]:[];
  if(!codes.includes(code))continue;
  const title=clean(item.title,240),source=clean(item.source,120),url=clean(item.url,360);
  const published= strictInstant(item.publishedAt,now);
  if(!title||!source||published===null||now-published>maxAgeDays*86400000||
    !OFFICIAL_PDF.test(url)){unusableCount++;continue;}
  const fingerprint=createHash('sha256').update(code+'\n'+url+'\n'+title).digest('hex').slice(0,20);
  if(unique.has(fingerprint))continue;
  const category=classifyTitle(title);
  unique.set(fingerprint,{id:fingerprint,title,source,url,code,publishedAt:new Date(published).toISOString(),
   category,verified:false,evidenceLevel:'headline-unverified',impactScore:null,
   reason:category==='risk-clue'?'公告标题包含风险类词语，正文及影响尚待核实':
    category==='strength-clue'?'公告标题包含经营或股东支持线索，不等于已实现收益':
    category==='conflicting'?'标题同时出现利好与风险相关词语，不自动判定方向':'未从标题识别出可靠方向，保持中性'});
 }
 const events=[...unique.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.id.localeCompare(b.id)).slice(0,30);
 return {...base,status:events.length?'headline-research-only': 'no-eligible-documents',
   count:events.length,events,unusableCount,
   riskClues:events.filter(x=>x.category==='risk-clue'),
   strengthClues:events.filter(x=>x.category==='strength-clue'),
   conflicts:events.filter(x=>x.category==='conflicting')};
}
function buildIssuerLinkage(item){
 const e=item?.issuerEvidence||{},positive=item?.patterns?.positiveCount||0,risk=item?.patterns?.riskCount||0;
 const newsRisk=(e.riskClues||[]).length+(e.conflicts||[]).length;
 const newsStrength=(e.strengthClues||[]).length;
 return {mode:'research-only',marketPatternCount:positive,patternRiskCount:risk,
  riskConflict:Boolean(positive&&newsRisk),strengthConfluence:Boolean(positive&&newsStrength),
  priority:'unchanged',bonusPoints:0,warning:positive&&newsRisk?'看涨技术形态同时存在公告风险线索，应先核对公告正文':null,
  note:'仅关联证据，不提高买入评级；公告标题不构成经核实的利好或利空'};
}
function buildIssuerPools(items=[]){
 const pools={'公告风险核对池':[],'公告优势线索池':[],'公告矛盾待核对池':[]};
 for(const item of items){
  const e=item?.issuerEvidence;
  if(!e||e.status!=='headline-research-only')continue;
  const row={symbol:item.symbol,name:item.name,documents:e.count,riskClues:e.riskClues.length,
   strengthClues:e.strengthClues.length,conflicts:e.conflicts.length,
   riskConflict:!!item.issuerLinkage?.riskConflict,
   note:'仅公告标题线索，未核实正文；非正式推荐'};
  if(e.riskClues.length)pools['公告风险核对池'].push(row);
  if(e.strengthClues.length&&!item.blockedBySafety&&item.quality?.usable)pools['公告优势线索池'].push(row);
  if(e.conflicts.length||item.issuerLinkage?.riskConflict)pools['公告矛盾待核对池'].push(row);
 }
 for(const rows of Object.values(pools))rows.sort((a,b)=>b.riskClues-a.riskClues||a.symbol.localeCompare(b.symbol));
 return pools;
}
module.exports={linkIssuerEvents,buildIssuerLinkage,buildIssuerPools,classifyTitle};
