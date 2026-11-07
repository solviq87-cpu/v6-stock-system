const fs = require("fs");
const DIR = __dirname;
const s = JSON.parse(fs.readFileSync(DIR + "/stats.json", "utf8"));
const sigs = s.signals || [];
const normDate = d => { const x = String(d == null ? "" : d).replace(/[^0-9]/g, ""); return x.length !== 8 ? String(d == null ? "" : d) : x.slice(0,4)+"-"+x.slice(4,6)+"-"+x.slice(6,8); };
const TODAY = "20261027";

// ---- 模拟 pruneSignals（server.js:1054）----
const limit = 2600;
const byDay = {};
for (const x of sigs) { const d = normDate(x.date); (byDay[d] = byDay[d] || []).push(x); }
const days = Object.keys(byDay).sort();
const base = Math.max(1, Math.floor(limit / Math.max(days.length, 1)));
const take = new Map(); let used = 0;
for (const d of days) { const n = Math.min(base, byDay[d].length); take.set(d, n); used += n; }
let extra = limit - used;
while (extra > 0) { let moved = 0; for (const d of days) { if (extra <= 0) break; const cur = take.get(d) || 0; if (cur < byDay[d].length) { take.set(d, cur + 1); extra--; moved++; } } if (!moved) break; }
const keep = [];
for (const d of days) { const list = byDay[d].slice().sort((a,b)=>(b.resolved?1:0)-(a.resolved?1:0)); keep.push(...list.slice(0, take.get(d) || base)); }
let out = keep.sort((a,b)=>(a.ts||0)-(b.ts||0)); if (out.length > limit) out = out.slice(out.length - limit);
const simToday = out.filter(x => String(x.date).replace(/[^0-9]/g,"") === TODAY).length;
const simDays = new Set(out.map(x => normDate(x.date))).size;

console.log("== ④ 剪枝一致性 ==");
console.log("实际 total:", sigs.length, "| 模拟 prune 后 total:", out.length, "| days:", days.length, "-> 模拟保留", simDays);
console.log("实际 today 条数:", sigs.filter(x=>String(x.date).replace(/[^0-9]/g,"")===TODAY).length, "| 模拟 today 条数:", simToday);
console.log("==> 若 实际total>模拟total 或 today 实际!=模拟: 说明有登记路径绕过 pruneSignals");

// ---- ① 今日样本 ----
const todays = sigs.filter(x => String(x.date).replace(/[^0-9]/g,"") === TODAY);
console.log("\n== ① 今日样本入池 ==", "count:", todays.length, "resolved:", todays.filter(x=>x.resolved).length, "void:", todays.filter(x=>x.void).length);

// ---- ⑤ 退役刻度污染校准表 ----
const cal = sigs.filter(x => x.cal);
console.log("\n== ⑤ 退役刻度样本 ==", "cal 标记数:", cal.length, "distinct cal dates:", new Set(cal.map(x=>String(x.date).replace(/[^0-9]/g,""))).size);
// 看 buckets 里是否有 cal 样本的 type 出现（buckets 按 type? 还是按 group?）
console.log("buckets 顶层 keys:", Object.keys(s.buckets||{}).join(", "));

// ---- ② nd 回验覆盖缺口 ----
const noNd = sigs.filter(x => x.nd == null && !x.void);
console.log("\n== ② nd 回验缺口 ==", "非void缺nd(未回验):", noNd.length);
const bd = {}; noNd.forEach(x => { const d = String(x.date).replace(/[^0-9]/g,""); bd[d] = (bd[d]||0)+1; });
Object.keys(bd).sort().forEach(d => console.log("   缺nd日期", d, ":", bd[d]));
const td = {}; noNd.forEach(x => td[x.type] = (td[x.type]||0)+1);
console.log("   缺nd type:", JSON.stringify(td));
const rno = sigs.filter(x => x.resolved && x.nd == null);
const rt = {}; rno.forEach(x => rt[x.type] = (rt[x.type]||0)+1);
console.log("   resolved却无nd:", rno.length, "type:", JSON.stringify(rt), "(竞价类用resolved, 这部分应属正常)");
