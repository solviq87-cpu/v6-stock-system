'use strict';
// 实测重标定 · 离线影响面诊断
// 用线上真实回验数据跑一遍标定表，看清楚：哪些档被校准、哪些因证据不足挂起、
// 校准后有多少票会从"够门槛"变成"被拦下"（被拦的应该正是高分追高票）。
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');
function grab(s, e) { const i = SRC.indexOf(s), j = SRC.indexOf(e, i); return SRC.slice(i, j + e.length); }
const parts = [
  grab('const EMP_MIN_N = 20', 'EMP_REFU_GAP = 25;'), grab('const empMidOf =', '\n'),
  grab('const EMP_CHASE = new Set', '\n'), grab('const EMP_EARLY = new Set', '\n'),
  grab('const EMP_BUCKETS = [', '\n'), grab('const empBucketOf =', '\n'),
  grab('const empGroupOf =', '\n'), grab('let _empCache = {', '\n'),
  grab('function empTable() {', '\n}\n'), grab('function empProb(prob, type) {', '\n}\n'),
  grab('function effProb(prob, type) {', '\n}\n'),
];
const st = JSON.parse(fs.readFileSync('./stats.json', 'utf8'));
const S = { learn: { signals: st.signals || [] } };
const api = new Function('S', parts.join('\n') + '\nreturn { empTable, empProb, effProb, empGroupOf, empBucketOf };')(S);

const t = api.empTable();
console.log('──── 标定表（族群 × 概率档）────');
for (const k of Object.keys(t).sort()) {
  const v = t[k];
  const tag = v.locked ? '⏸ ' + v.locked : `✅生效(${v.evidence})`;
  console.log(`  ${k.padEnd(16)} n=${String(v.n).padStart(4)} 实测命中 ${String(v.rate).padStart(3)}% 次日真涨停 ${String(v.luRate).padStart(2)}% 跨${String(v.days).padStart(2)}日 ${tag}`);
}

const gate = 55;
// ⚠️ 只认次日口径：标定衡量的是"收盘前埋伏、次日能涨多少"，不是"当天还能赚多少"
const sig = (st.signals || []).filter(s => s.nd && !s.void && s.prob != null);
const before = sig.filter(s => s.prob >= gate);
const after = sig.filter(s => api.effProb(s.prob, s.type) >= gate);
console.log(`\n──── 过闸门(≥${gate}%)的票：校准前 ${before.length} → 校准后 ${after.length} ────`);
const drop = before.filter(s => api.effProb(s.prob, s.type) < gate);
const add = after.filter(s => s.prob < gate);
console.log(`  被拉下马 ${drop.length} 只（应当主要是高分追高票）`);
console.log(`  被捞上来 ${add.length} 只（原本概率不够但实测很准）`);
const byType = m => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
const cnt = arr => arr.reduce((m, s) => { m[s.type] = (m[s.type] || 0) + 1; return m; }, {});
console.log('  被拉下马的构成:', byType(cnt(drop)));
console.log('  捞上来的构成:', byType(cnt(add)));

console.log('\n──── 校准值分布（被拉下马的票，模型给多少 → 实测多少）────');
const dist = drop.reduce((m, s) => {
  const b = api.empBucketOf(s.prob); m[b] = (m[b] || 0) + 1; return m;
}, {});
for (const b of Object.keys(dist).sort()) console.log(`  模型 ${b}% 档 → 被拦 ${dist[b]} 只`);

console.log('\n──── 排序变化：校准前后 Top6 分别是谁 ────');
const day = process.argv[2] || '20260930';
const d30 = sig.filter(s => String(s.date).replace(/-/g, '') === day && s.prob != null);
const topBy = f => [...d30].sort((a, b) => f(b) - f(a)).slice(0, 6)
  .map(s => `${s.name || s.code}(${s.type} 模型${s.prob}%→实测${api.empProb(s.prob, s.type) == null ? '不校准' : api.empProb(s.prob, s.type) + '%'})`).join('\n     ');
console.log(`  ${day} 信号 ${d30.length} 条`);
console.log('  按模型概率排：\n     ' + topBy(s => s.prob));
console.log('  按实测排序：\n     ' + topBy(s => api.effProb(s.prob, s.type)));
