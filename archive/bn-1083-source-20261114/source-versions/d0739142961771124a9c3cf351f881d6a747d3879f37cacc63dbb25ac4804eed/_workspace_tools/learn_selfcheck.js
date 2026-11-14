// 学习闭环日常自检（只读）— 拉取 stock-dashboard 真实数据，输出 JSON 供看板使用
// 不修改任何仓库文件，仅读取 stats.json / pushlog.json
const fs = require('fs');
const REPO = 'C:/Users/28957/WorkBuddy/2026-09-25-13-40-58/stock-dashboard';
// 动态取日（原硬编码 20261027 曾导致假阴性，2026-10-29 修复）
const _n = new Date(), _p = x => String(x).padStart(2, '0');
const TODAY = '' + _n.getFullYear() + _p(_n.getMonth() + 1) + _p(_n.getDate());
const TODAY_D = TODAY.slice(0, 4) + '-' + TODAY.slice(4, 6) + '-' + TODAY.slice(6, 8);

function normDate(d){const x=String(d==null?'':d).replace(/[^0-9]/g,'');if(x.length!==8)return String(d==null?'':d);return x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6,8);}
function dayNum(d){return String(d==null?'':d).replace(/[^0-9]/g,'');}

const s = JSON.parse(fs.readFileSync(REPO+'/stats.json','utf8'));
const sigs = s.signals||[];
const out = {ts: new Date().toISOString(), today: TODAY, items:{}};

// ① 样本规模 + 今日入池
const LIMIT = 2600;
const byDay={}; sigs.forEach(x=>{const d=normDate(x.date);(byDay[d]=byDay[d]||[]).push(x);});
const days=Object.keys(byDay).sort();
const todays=sigs.filter(x=>dayNum(x.date)===TODAY);
const types={}; todays.forEach(x=>types[x.type]=(types[x.type]||0)+1);
out.items.sample = {
  total: sigs.length, limit: LIMIT, full: sigs.length>=LIMIT,
  distinctDays: days.length, earliest: days[0], latest: days[days.length-1],
  todayCount: todays.length, todayTypes: types,
  todayResolved: todays.filter(x=>x.resolved).length,
  todayUnresolved: todays.filter(x=>!x.resolved).length,
  todayVoid: todays.filter(x=>x.void).length
};

// ② nd 回验覆盖
const noNd = sigs.filter(x=>x.nd==null && !x.void);
const resolvedNoNd = sigs.filter(x=>x.resolved && x.nd==null);
const auc={'auczt':1,'aucres':1};
const nonAucNoNd = noNd.filter(x=>!auc[x.type]);
const cal=sigs.filter(x=>x.cal);
out.items.nd = {
  nonVoidMissingNd: noNd.length,
  resolvedMissingNd: resolvedNoNd.length,
  nonAucMissingNd: nonAucNoNd.length,
  realGap: nonAucNoNd.map(x=>({type:x.type,date:dayNum(x.date)})),
  calCount: cal.length
};

// ③ 学习日报推送
let plogRaw;
try{ plogRaw = fs.readFileSync(REPO+'/pushlog.json','utf8'); }catch(e){ plogRaw=''; }
let plog; try{ plog=JSON.parse(plogRaw); }catch(e){ plog=[]; }
const arr=Array.isArray(plog)?plog:(plog.log||plog.entries||[]);
const hits=arr.filter(x=>{const t=JSON.stringify(x);return t.includes('学习日报');});
const todayHits=hits.filter(x=>{const t=JSON.stringify(x);return t.includes(TODAY)||t.includes(TODAY_D);});
out.items.report = {
  pushlogEntries: arr.length,
  todayReportCount: todayHits.length,
  todayReportLatest: todayHits.length? todayHits[todayHits.length-1] : null,
  recent: hits.slice(-3).map(x=>({ts:x.ts||x.time||'', txt:JSON.stringify(x).slice(0,200)}))
};

// ④ 剪枝模拟（验证无路径绕过）
const base=Math.max(1,Math.floor(LIMIT/Math.max(days.length,1)));
const take=new Map(); let used=0;
for(const d of days){const n=Math.min(base,byDay[d].length);take.set(d,n);used+=n;}
let extra=LIMIT-used;
while(extra>0){let moved=0;for(const d of days){if(extra<=0)break;const cur=take.get(d)||0;if(cur<byDay[d].length){take.set(d,cur+1);extra--;moved++;}}if(!moved)break;}
let keep=[];for(const d of days){const list=byDay[d].slice().sort((a,b)=>(b.resolved?1:0)-(a.resolved?1:0));keep.push(...list.slice(0,take.get(d)||base));}
keep=keep.sort((a,b)=>(a.ts||0)-(b.ts||0));if(keep.length>LIMIT)keep=keep.slice(keep.length-LIMIT);
out.items.prune = {
  actualTotal: sigs.length, simulatedTotal: keep.length,
  actualToday: todays.length, simulatedToday: keep.filter(x=>dayNum(x.date)===TODAY).length,
  consistent: (sigs.length===keep.length && todays.length===keep.filter(x=>dayNum(x.date)===TODAY).length)
};

// ⑤ 退役刻度
out.items.retired = {
  calCount: cal.length,
  note: 'empTable 用 isRetiredProbScale()→bumpSkip 排除，不进概率校准桶（server.js:1767）'
};

console.log(JSON.stringify(out,null,2));
