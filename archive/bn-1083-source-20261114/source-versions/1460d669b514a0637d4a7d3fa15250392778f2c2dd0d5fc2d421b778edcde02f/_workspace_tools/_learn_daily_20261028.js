// 学习闭环日报取数（2026-10-28 专用，只读）— 按当日口径重算五项自检
const fs = require('fs');
const REPO = 'C:/Users/28957/WorkBuddy/2026-09-25-13-40-58/stock-dashboard';
const TODAY = '20261028';
function dayNum(d){return String(d==null?'':d).replace(/[^0-9]/g,'').slice(0,8);}
function normDate(d){const x=dayNum(d);return x.length===8? x.slice(0,4)+'-'+x.slice(4,6)+'-'+x.slice(6,8): String(d);}

const s = JSON.parse(fs.readFileSync(REPO+'/stats.json','utf8'));
const sigs = s.signals||[];
const out = {};

// ① 今日样本入池
const todays = sigs.filter(x=>dayNum(x.date)===TODAY);
const types={}; todays.forEach(x=>types[x.type]=(types[x.type]||0)+1);
out.sample = {
  totalSignals: sigs.length,
  todayCount: todays.length, todayTypes: types,
  todayResolved: todays.filter(x=>x.resolved).length,
  todayUnresolved: todays.filter(x=>!x.resolved && !x.void).length,
  todayVoid: todays.filter(x=>x.void).length,
  todayCal: todays.filter(x=>x.cal).length
};

// ② nd 回验缺口（非竞价类 + 已过 T+1 = date < 今天）
const auc={'auczt':1,'aucres':1};
const noNd = sigs.filter(x=>x.nd==null && !x.void);
const nonAucNoNd = noNd.filter(x=>!auc[x.type]);
const realGap = nonAucNoNd.filter(x=>dayNum(x.date) < TODAY);      // 过了 T+1 仍缺 nd
const todayGap = nonAucNoNd.filter(x=>dayNum(x.date) === TODAY);   // 当天新样本，正常
const gapByDateType={}; realGap.forEach(x=>{const k=normDate(x.date)+'/'+x.type;gapByDateType[k]=(gapByDateType[k]||0)+1;});
const todayGapByType={}; todayGap.forEach(x=>{todayGapByType[x.type]=(todayGapByType[x.type]||0)+1;});
out.nd = {
  nonVoidMissingNd_total: noNd.length,
  aucMissingNd_byDesign: noNd.filter(x=>auc[x.type]).length, // 竞价类走 resolved，不算缺口
  nonAucMissingNd: nonAucNoNd.length,
  realGapPastT1: realGap.length,
  realGapByDateType: gapByDateType,
  todayNewNoNd_ok: todayGap.length,
  todayNewNoNdByType: todayGapByType,
  resolvedMissingNd: sigs.filter(x=>x.resolved && x.nd==null).length
};

// ③ 学习日报推送（双格式日期匹配）
let plog=[]; try{ const raw=fs.readFileSync(REPO+'/pushlog.json','utf8'); const p=JSON.parse(raw); plog=Array.isArray(p)?p:(p.log||p.entries||[]);}catch(e){ out.pushlogErr=String(e); }
const hits=plog.filter(x=>{const t=JSON.stringify(x);return t.includes('学习日报');});
const todayHits=hits.filter(x=>{const t=JSON.stringify(x);return t.includes('20261028')||t.includes('2026-10-28');});
out.report = {
  pushlogTotal: plog.length,
  learnReportTotal: hits.length,
  todayCount: todayHits.length,
  todayEntries: todayHits.map(x=>({ts:x.ts||x.time||x.t||'', title:(x.title||'').slice(0,60), channel:x.channel||'', ok:x.ok, txt:JSON.stringify(x).slice(0,300)})),
  recentOther: hits.slice(-3).map(x=>({ts:x.ts||x.time||'', title:(x.title||'').slice(0,60)}))
};

// ④ 剪枝容量
const byDay={}; sigs.forEach(x=>{const d=normDate(x.date);(byDay[d]=byDay[d]||[]).push(x);});
const days=Object.keys(byDay).sort();
out.prune = {
  total: sigs.length, limit: 2600, full: sigs.length>=2600,
  distinctDays: days.length, earliest: days[0], latest: days[days.length-1]
};

// ⑤ cal 标记样本（退役刻度污染检查）
const cal = sigs.filter(x=>x.cal);
out.cal = {
  calCount: cal.length,
  calByVoid: {void: cal.filter(x=>x.void).length, live: cal.filter(x=>!x.void).length},
  calSample: cal.slice(-3).map(x=>({date:normDate(x.date), type:x.type, void:!!x.void, resolved:!!x.resolved}))
};
console.log(JSON.stringify(out,null,1));
