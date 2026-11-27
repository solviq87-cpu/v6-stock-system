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
// A directional keyword inside a clarification, denial or unconfirmed
// rumor is not an affirmative event. Retain the warning for manual review.
const UNCERTAIN=/传闻|谣言|澄清|否认|尚未|暂未|未收到|未发生|未实施|未进行|未达成|未签订|未中标|未获批|不涉及|不存在|无(?:股份)?回购|无(?:股份)?增持|无减持|不进行|不实施|不再|未能|拟取消|可能取消|取消.*(?:回购|增持|中标|合同)|终止/;
function classifyTitle(title){
 if(typeof title!=='string'||!title.trim())return 'neutral-review';
 const risk=RISK.test(title),strength=STRENGTH.test(title);
 return (risk||strength)&&UNCERTAIN.test(title)||risk&&strength?'conflicting':risk?'risk-clue':strength?'strength-clue':'neutral-review';
}
const knownClock=x=>Number.isSafeInteger(x)&&x>0&&x<8e15;
const timeOf=(x,now)=>knownClock(x)&&x<=now?x:strictInstant(x,now);
const declared=(x,k)=>Object.hasOwn(x,k)&&x[k]!=null;
const codeOK=x=>typeof x==='string'&&/^\d{6}$/.test(x);
function identityCodes(item){
 if(declared(item,'codes')&&(!Array.isArray(item.codes)||!item.codes.length||item.codes.length>100||
    !item.codes.every(codeOK)||new Set(item.codes).size!==item.codes.length))return null;
 const ids=['code','symbol'].filter(k=>declared(item,k)).map(k=>item[k]);
 if(ids.some(x=>!codeOK(x))||new Set(ids).size>1)return null;
 const codes=item.codes??ids;
 if(ids.length&&!codes.includes(ids[0]))return null;
 return codes;
}
function knownMetadata(item,published,now){
 const times={};
 for(const key of ['knownAt','availableAt','receivedAt','recordedAt','observedAt','retrievedAt','firstObservedAt','revisedAt','retractedAt']){
  if(!declared(item,key))continue;
  const t=timeOf(item[key],now);
  if(t===null||t<published)return null;
  times[key]=t;
 }
 for(const [a,b] of [['receivedAt','recordedAt'],['availableAt','recordedAt'],['firstObservedAt','retrievedAt'],
  ['observedAt','knownAt'],['revisedAt','receivedAt'],['retractedAt','receivedAt']]){
  if(times[a]!==undefined&&times[b]!==undefined&&times[a]>times[b])return null;
 }
 return {knownAt:Object.keys(times).length?Math.max(published,...Object.values(times)):null,
  timeBasis:Object.keys(times).length?'declared-publication-and-local-availability':'publication-only-unverified'};
}
const negativeMetadata=item=>['simulated','synthetic','mock','demo','testSample','isTest'].some(k=>[true,1,'true','1','是'].includes(item[k]))||
 ['test','demo','synthetic','fixture'].includes(item.sampleSet)||
 ['simulation','synthetic','mock','test','demo'].includes(item.mode)||
 ['source','provider','provenance','mode','dataMode','sampleSource'].some(k=>typeof item[k]==='string'&&
 /(?:^|[-_:/\.\s])(?:simulat(?:ed|ion)?|fixture|mock|synthetic|test|demo)(?:$|[-_:/\.\s])/i.test(item[k]));
const revoked=item=>item.retracted===true||item.revoked===true||item.withdrawn===true||
 ['retracted','revoked','withdrawn','superseded'].includes(item.kind)||['retracted','revoked','withdrawn','superseded'].includes(item.status);
function documentKey(url,now){
 // Only the narrow CNINFO PDF path is accepted. Normalize case for identity
 // comparison, but never rewrite the supplied original link for display.
 if(!OFFICIAL_PDF.test(url))return null;
 const d=url.match(/\/finalpage\/(\d{4}-\d{2}-\d{2})\//i)?.[1];
 const t=Date.parse(d+'T00:00:00Z');
 if(!Number.isFinite(t)||new Date(t).toISOString().slice(0,10)!==d||d>new Date(now+28800000).toISOString().slice(0,10))return null;
 return url.toLowerCase();
}
function linkIssuerEvents({symbol,announcements=[],now=Date.now(),maxAgeDays=90}={}){
 const code=String(symbol||'').trim(),validClock=knownClock(now);
 const base={status:'no-verified-feed',symbol:code,asOf:now,events:[],riskClues:[],strengthClues:[],
  conflicts:[],count:0,unusableCount:0,duplicateCount:0,documentConflicts:[],withdrawnDocuments:[],
  notes:['标题分类仅供人工核对，未阅读公告正文；不修改选股或交易分数']};
 if(!/^\d{6}$/.test(code)||!validClock||!Number.isSafeInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>366)return {...base,status:'invalid-input'};
 if(!Array.isArray(announcements)||announcements.length>100)return {...base,status:'invalid-input'};
 let unusableCount=0,duplicateCount=0;
 const groups=new Map(),unique=new Map(),documentConflicts=[],withdrawnDocuments=[];
 for(const item of announcements){
  if(!item||typeof item!=='object'||Array.isArray(item)){unusableCount++;continue;}
  const codes=identityCodes(item);
  if(codes===null){unusableCount++;continue;}
  if(!codes.includes(code))continue;
  const title=clean(item.title,240),source=clean(item.source,120),url=clean(item.url,360);
  const published=strictInstant(item.publishedAt,now),key=documentKey(url,now);
  const metadata=published===null?null:knownMetadata(item,published,now);
  if(!title||!source||published===null||now-published>maxAgeDays*86400000||
    !key||!metadata||negativeMetadata(item)){unusableCount++;continue;}
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push({title,source,url,published,metadata,withdrawn:revoked(item)});
 }
 for(const [key,group] of groups){
  // An admitted withdrawal or supersession is not an additional positive
  // headline. A future revision is excluded above and cannot rewrite history.
  if(group.some(x=>x.withdrawn)){
   withdrawnDocuments.push({url:key,versions:group.length,reason:'visible-withdrawal-or-supersession'});
   unusableCount+=group.length;continue;
  }
  const ordered=[...group].sort((a,b)=>a.published-b.published||a.title.localeCompare(b.title)||
   a.url.localeCompare(b.url)||a.source.localeCompare(b.source)||
   (a.metadata.knownAt??Infinity)-(b.metadata.knownAt??Infinity));
  const first=ordered[0];
  const variants=[...new Set(ordered.map(x=>JSON.stringify([x.title,x.published])))];
  const conflicting=variants.length>1;
  duplicateCount+=group.length-variants.length;
  if(conflicting)documentConflicts.push({url:key,versions:variants.length,reason:'same-document-content-or-publication-conflict'});
  const fingerprint=createHash('sha256').update(code+'\n'+first.url+'\n'+first.title).digest('hex').slice(0,20);
  const category=conflicting?'conflicting':classifyTitle(first.title);
  unique.set(key,{id:fingerprint,title:first.title,source:first.source,url:first.url,code,
   publishedAt:new Date(first.published).toISOString(),...first.metadata,
   category,verified:false,evidenceLevel:'headline-unverified',impactScore:null,
   ...(conflicting?{documentConflict:true,variants:ordered.filter((x,i)=>i===0||x.title!==ordered[i-1].title||x.published!==ordered[i-1].published)
    .map(x=>({title:x.title,publishedAt:new Date(x.published).toISOString(),knownAt:x.metadata.knownAt}))}:{}),
   reason:conflicting?'同一公告链接存在标题或原发布时间冲突，不采用任一版本作为独立利好':
    category==='risk-clue'?'公告标题包含风险类词语，正文及影响尚待核实':
    category==='strength-clue'?'公告标题包含经营或股东支持线索，不等于已实现收益':
    category==='conflicting'?'标题存在否认、澄清、传闻或方向冲突，需核对正文，不自动判定方向':'未从标题识别出可靠方向，保持中性'});
 }
 const events=[...unique.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)||a.id.localeCompare(b.id)).slice(0,30);
 return {...base,status:events.length?'headline-research-only': 'no-eligible-documents',
   count:events.length,events,unusableCount,duplicateCount,
   documentConflicts:documentConflicts.sort((a,b)=>a.url.localeCompare(b.url)),
   withdrawnDocuments:withdrawnDocuments.sort((a,b)=>a.url.localeCompare(b.url)),
   riskClues:events.filter(x=>x.category==='risk-clue'),
   strengthClues:events.filter(x=>x.category==='strength-clue'),
   conflicts:events.filter(x=>x.category==='conflicting')};
}
function issuerIdentityOK(item,e){
 const ids=['symbol','code'].filter(k=>item?.[k]!=null).map(k=>item[k]);
 if(!ids.length)return true; // legacy presentation callers with no outer identity
 if(ids.some(x=>!codeOK(x))||new Set(ids).size!==1)return false;
 return (!Object.hasOwn(e,'symbol')||e.symbol===ids[0])&&
 ['riskClues','strengthClues','conflicts','events'].every(k=>!Array.isArray(e[k])||
 e[k].every(row=>row&&(!Object.hasOwn(row,'code')||row.code===ids[0])));
}
function buildIssuerLinkage(item){
 const evidence=item?.issuerEvidence||{},e=issuerIdentityOK(item,evidence)?evidence:{},
 positive=item?.patterns?.positiveCount||0,risk=item?.patterns?.riskCount||0;
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
  if(!e||e.status!=='headline-research-only'||!issuerIdentityOK(item,e))continue;
  const row={symbol:item.symbol,name:item.name,documents:e.count,riskClues:e.riskClues.length,
   strengthClues:e.strengthClues.length,conflicts:e.conflicts.length,
   riskConflict:!!item.issuerLinkage?.riskConflict,
   note:'仅公告标题线索，未核实正文；非正式推荐'};
  if(e.riskClues.length)pools['公告风险核对池'].push(row);
  if(e.strengthClues.length&&!item.blockedBySafety&&item.quality?.usable&&item.quality.fresh!==false&&item.quality.simulated!==true&&item.quality.historical!==true&&item.quality.readOnlyBackup!==true)pools['公告优势线索池'].push(row);
  if(e.conflicts.length||item.issuerLinkage?.riskConflict)pools['公告矛盾待核对池'].push(row);
 }
 for(const rows of Object.values(pools))rows.sort((a,b)=>b.riskClues-a.riskClues||a.symbol.localeCompare(b.symbol));
 return pools;
}
module.exports={linkIssuerEvents,buildIssuerLinkage,buildIssuerPools,classifyTitle};
