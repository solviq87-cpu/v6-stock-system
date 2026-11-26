// Browser contract only. All numbers and judgments originate at the same-origin
// decision endpoint; this file can reject an expired package, never create one.
const AUTHORITY='fayo-decision-center',SCHEMA=1;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const time=value=>Number.isSafeInteger(value)&&value>0&&value<8e15;
const chinaDay=at=>new Date(at+28800000).toISOString().slice(0,10);
const codeOk=value=>typeof value==='string'&&/^\d{6}$/.test(value);
const forbidden=/simulat|research|readonlybackup|cost|carried|histor|import|fixture|mock|test|synthetic/i;
function continuousAt(at){
 const date=new Date(at+28800000),minute=date.getUTCHours()*60+date.getUTCMinutes();
 return date.getUTCDay()!==0&&date.getUTCDay()!==6&&
  (minute>=570&&minute<690||minute>=780&&minute<897);
}
const fourEvidence=()=>['题材','封单','量价','位置'].map((label,i)=>({kind:['theme','seal','volume','position'][i],label,known:false,text:'等待后台核验'}));

export function decisionDay(value){
 if(typeof value!=='string')return null;
 const day=value.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),at=Date.parse(day+'T00:00:00Z');
 return /^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(at)&&new Date(at).toISOString().startsWith(day)?day:null;
}

function emptyBoard(now,reason){
 const day=chinaDay(now);
 return {day,generatedAt:null,calculatedAt:null,sessionOpen:false,cards:[],emptyMessage:'今天空仓，等待信号',reasons:[reason],blockedCounts:{},qualifiedCount:0,
  weather:{status:'unknown',label:'谨慎',summary:reason,canConsider:false,metrics:{},missing:['后台有效决策包'],basis:[],positionCapPct:null},
  checklist:[{id:'authority',label:'等待后台核验今日计划',status:'waiting',note:reason}],resonanceByCode:{},conclusions:{}};
}

function currentConclusion(value,day,now,code){
 return value&&value.authority===AUTHORITY&&value.schemaVersion===SCHEMA&&decisionDay(value.day)===day&&
  codeOk(code)&&value.code===code&&
  ['可关注','等待回封','回避'].includes(value.label)&&typeof value.reason==='string'&&Array.isArray(value.evidence)&&
  time(value.asOf)&&value.asOf<=now&&now-value.asOf<=15000;
}

export function stockConclusion(row={}, {day,now=Date.now()}={}){
 const target=decisionDay(day)||decisionDay(row.day||row.poolDay)||chinaDay(now),value=row.conclusion;
 return currentConclusion(value,target,now,row.code)?value:{label:'回避',reason:'尚未取得有效后台结论，等待核验',day:target,evidence:fourEvidence()};
}

function validCard(card,day,now,calculatedAt){
 if(!card||card.authority!==AUTHORITY||!/^[a-f0-9]{64}$/.test(card.decisionId||'')||!/^\d{6}$/.test(card.code||'')||card.day!==day||card.calculatedAt!==calculatedAt)return false;
 const plan=card.plan,q=card.quoteBasis;
 if(!plan||plan.authority!==AUTHORITY||plan.decisionId!==card.decisionId||!time(plan.asOf)||plan.asOf!==calculatedAt||plan.asOf>now||now-plan.asOf>15000||!plan.lineage)return false;
 if(!['buyLow','buyHigh','stop','target','positionPct'].every(key=>finite(plan[key]))||
  !(plan.stop>0&&plan.stop<plan.buyLow&&plan.buyLow<=plan.buyHigh&&plan.buyHigh<plan.target&&plan.positionPct>0&&plan.positionPct<=100))return false;
 if(!['buyLow','buyHigh','stop','target','positionPct'].every(key=>{
  const basis=plan.lineage[key];return basis&&typeof basis.source==='string'&&basis.source.trim()&&
   typeof basis.derivedBy==='string'&&basis.derivedBy.trim()&&time(basis.sourceAt)&&basis.sourceAt<=plan.asOf;
 }))return false;
 if(!q||q.code!==card.code||!finite(q.price)||q.price<=0||q.price!==card.price||!time(q.quoteAt)||q.quoteAt>now||now-q.quoteAt>15000||chinaDay(q.quoteAt)!==day||
  !time(q.receivedAt)||q.receivedAt<q.quoteAt||q.receivedAt>plan.asOf||typeof q.source!=='string'||!q.source.trim()||
  typeof q.mode!=='string'||!q.mode.trim()||forbidden.test(q.source+' '+q.mode)||q.mode!==(card.quoteMode||card.mode)||plan.buyHigh!==q.price||card.receivedAt!==q.receivedAt||
  card.quoteAt!==q.quoteAt||card.quoteSource!==q.source||card.canTrade===false||card.canNotify===false||card.canTrade!==true&&card.canNotify!==true||card.readOnlyBackup===true||card.historicalClose===true||
  ['simulated','imported','fixture','mock','synthetic','sourceConflict','quoteSourceConflict','blocked','suspended'].some(k=>card[k]===true||q[k]===true)||
  card.tradable===false||q.tradable===false)return false;
 if(!finite(card.score)||card.score<0||card.score>100||!Number.isInteger(card.resonanceScore)||card.resonanceScore<1||!Array.isArray(card.resonanceStrategies)||
  card.resonanceStrategies.length!==card.resonanceScore||card.resonanceStrategies.some(s=>!s||typeof s.id!=='string'||!s.id||typeof s.label!=='string'||!s.label)||
  new Set(card.resonanceStrategies.map(s=>s.id)).size!==card.resonanceScore)return false;
 return card.conclusion?.label==='可关注'&&card.conclusion.quoteAt===q.quoteAt&&
  currentConclusion(card.conclusion,day,calculatedAt,card.code);
}

export function readDecisionBoard(payload,{now=Date.now()}={}){
 if(!time(now))throw Error('决策包校验时钟无效');
 const day=chinaDay(now);
 if(!payload||payload.authority!==AUTHORITY||payload.schemaVersion!==SCHEMA)return emptyBoard(now,'尚未取得后台权威决策包，等待同步。');
 if(payload.day!==day||!time(payload.calculatedAt)||payload.calculatedAt>now||now-payload.calculatedAt>15000)return emptyBoard(now,'后台决策日期或时点已失效，等待重新核验。');
 if(!Array.isArray(payload.cards)||payload.cards.length>3||!payload.weather||!['green','yellow','red','unknown'].includes(payload.weather.status)||
  payload.weather.day!==day||typeof payload.weather.label!=='string'||typeof payload.weather.summary!=='string'||!Array.isArray(payload.reasons)||
  typeof payload.weather.canConsider!=='boolean'||!Array.isArray(payload.weather.missing)||
  !finite(payload.weather.positionCapPct)||payload.weather.positionCapPct<0||payload.weather.positionCapPct>100)return emptyBoard(now,'后台决策结构不完整，等待重新核验。');
 // One backend package must not contain duplicate securities or mix
 // actionable cards with a risk veto. Recheck exchange-local time on every
 // paint, including the seconds immediately after the closing boundary.
 const cards=payload.cards.filter(card=>validCard(card,day,now,payload.calculatedAt));
 const canDisplay=payload.sessionOpen===true&&continuousAt(now)&&payload.weather.canConsider===true&&['green','yellow'].includes(payload.weather.status)&&!payload.weather.missing.length;
 if(new Set(cards.map(card=>card.code)).size!==cards.length||new Set(cards.map(card=>card.decisionId)).size!==cards.length||
  payload.cards.length&&!canDisplay)return emptyBoard(now,'后台机会与风险状态或当前连续竞价时段不一致，等待重新核验。');
 if(cards.some(card=>card.plan.positionPct>payload.weather.positionCapPct))return emptyBoard(now,'后台仓位计划与天气上限不一致，等待更新。');
 if(cards.length!==payload.cards.length)return {...emptyBoard(now,'后台候选的原始报价或完整计划未通过复核，等待更新。'),authority:AUTHORITY,schemaVersion:SCHEMA};
 return {...payload,cards:canDisplay?cards:[],reasons:[...payload.reasons],conclusions:{...payload.conclusions},resonanceByCode:{...payload.resonanceByCode}};
}
