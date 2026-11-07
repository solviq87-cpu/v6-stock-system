'use strict';
// 每日回测学习任务：三类信号 nd（次日口径）统计 + lift + 按日趋势
// 口径铁律：只认 sig.nd（信号日收盘→次日最高/收盘）；s.resolved 是当日既成事实，禁用。
const fs = require('fs');
const st = JSON.parse(fs.readFileSync('./stats.json', 'utf8'));
const sigs = (st.signals || []).filter(s => !s.void && s.nd);
const TYPES = ['auczt', 'yier', 'lianban'];
const NAME = { auczt: '竞价', yier: '一进二', lianban: '二进三连板' };

function stat(arr) {
  const n = arr.length;
  if (!n) return { n: 0 };
  const lim = arr.filter(s => s.nd.limitUp).length;
  const p3 = arr.filter(s => s.nd.nextPct >= 3).length;
  const m5 = arr.filter(s => s.nd.maxGain >= 5).length;
  const up = arr.filter(s => s.nd.nextPct > 0).length;
  const avgPct = arr.reduce((a, s) => a + s.nd.nextPct, 0) / n;
  const avgMax = arr.reduce((a, s) => a + s.nd.maxGain, 0) / n;
  return {
    n, lim: +(lim / n * 100).toFixed(1), p3: +(p3 / n * 100).toFixed(1),
    m5: +(m5 / n * 100).toFixed(1), up: +(up / n * 100).toFixed(1),
    avgPct: +avgPct.toFixed(2), avgMax: +avgMax.toFixed(2)
  };
}
function fmt(x) { return x.n === 0 ? '  —  ' : `${x.n}只 涨停${x.lim}% +3%:${x.p3}% 高5%:${x.m5}% 收涨${x.up}% 均涨幅${x.avgPct}%`; }

// 交易日期序列（从 kline 缓存推断太慢，直接用 signals 的 date 去重排序 + 过滤假日靠 nd 有无）
const tradeDays = [...new Set(sigs.map(s => String(s.date)))].sort();
console.log('=== 三类信号 nd 口径总览（剔除 void，仅已有 nd） ===');
for (const t of TYPES) {
  const arr = sigs.filter(s => s.type === t);
  console.log(`${NAME[t]}(${t}): ${fmt(stat(arr))}`);
  // 近30日
  const last30 = tradeDays.slice(-31, -1);
  const arr30 = arr.filter(s => last30.includes(String(s.date)));
  console.log(`   近30个信号日: ${fmt(stat(arr30))}`);
}

console.log('\n=== 按信号日趋势（最近 12 个有信号的交易日；次日涨停率） ===');
for (const t of TYPES) {
  const arr = sigs.filter(s => s.type === t);
  const byDate = {};
  for (const s of arr) { const d = String(s.date); (byDate[d] = byDate[d] || []).push(s); }
  const keys = Object.keys(byDate).sort().slice(-12);
  console.log(`--- ${NAME[t]}(${t}) ---`);
  for (const d of keys) {
    const x = stat(byDate[d]);
    console.log(`  ${d}: ${x.n}只 涨停${x.lim}% +3%:${x.p3}% 高5%:${x.m5}% 收涨${x.up}%`);
  }
  // 待回填：最近信号日但无 nd 的
  const all = (st.signals || []).filter(s => !s.void && s.type === t);
  const pend = {};
  for (const s of all) { if (!s.nd) { const d = String(s.date); (pend[d] = pend[d] || []).push(s); } }
  const pk = Object.keys(pend).sort();
  if (pk.length) console.log(`  待回填: ${pk.map(d => d + ' ' + pend[d].length + '只').join(' | ')}`);
}

console.log('\n=== 概率分档（有 prob 的信号，auczt+yier 合并与分开） ===');
for (const t of TYPES) {
  const arr = sigs.filter(s => s.type === t && typeof s.prob === 'number');
  if (!arr.length) { console.log(`--- ${NAME[t]}: 无 prob 字段`); continue; }
  const buckets = [[0, 40], [40, 55], [55, 70], [70, 101]];
  console.log(`--- ${NAME[t]} ---`);
  for (const [lo, hi] of buckets) {
    const b = arr.filter(s => s.prob >= lo && s.prob < hi);
    console.log(`  prob[${lo},${hi}): ${fmt(stat(b))}`);
  }
}

console.log('\n=== 近 30 个信号日按日明细（auczt 涨停率，用于趋势线） ===');
{
  const arr = sigs.filter(s => s.type === 'auczt');
  const byDate = {};
  for (const s of arr) { const d = String(s.date); (byDate[d] = byDate[d] || []).push(s); }
  const keys = Object.keys(byDate).sort();
  for (const d of keys) {
    const x = stat(byDate[d]);
    console.log(`  ${d}: n=${x.n} lim=${x.lim}% p3=${x.p3}% m5=${x.m5}% up=${x.up}%`);
  }
}
