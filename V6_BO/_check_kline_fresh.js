'use strict';
// 体检脚本（不是守门套件，_runall 不会自动跑它）：.kline_cache 里每只票的「最新一根K线」是哪天
// 用法：node _check_kline_fresh.js
// 为什么需要它：2026-10-09 用户问「今日K线补齐了吗」，答案是「没补」——
//   5911 只里只有 1217 只到 10-09、2672 只还停在 09-30。而补齐器当年只按「文件存不存在」筛选
//   （todo = uni.filter(c => !cached.has(c))），已有缓存的票永远不会被刷新，页面上却一点迹象都没有。
//   ⛔ 这类"不报错但悄悄陈旧"的问题，光看日志和面板都看不出来 —— 必须能一键数出来。
//   修完（stale 按 mtime 判定）后实测：10-09 从 1217 → 5473 只。
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '.kline_cache');

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.json'));
const dist = {};
let bad = 0;
for (const f of files) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch (e) { bad++; continue; }
  const arr = Array.isArray(j) ? j : (j && j.rows) || (j && j.klines) || (j && j.list) || [];
  if (!arr.length) { dist['(空)'] = (dist['(空)'] || 0) + 1; continue; }
  const last = arr[arr.length - 1];
  const d = String(last.date || last.day || last.t || last[0] || '').slice(0, 10);
  dist[d] = (dist[d] || 0) + 1;
}
const top = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 8);
const total = files.length;
console.log('缓存文件数:', total, '| 解析失败:', bad);
console.log('「最新一根K线」日期分布 Top8：');
for (const [d, n] of top) {
  const pct = total ? (n / total * 100).toFixed(1) : '0';
  console.log('   ' + d.padEnd(12) + String(n).padStart(5) + ' 只  ' + pct + '%');
}
// 最近那个日期当作"应该对齐的目标日"，算出陈旧占比
const real = top.map(([d]) => d).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
const newest = real.sort().reverse()[0];
const freshN = dist[newest] || 0;
console.log('\n目标日(最新一根的众数日期): ' + newest);
console.log('已对齐目标日: ' + freshN + '/' + total + ' = ' + (total ? (freshN / total * 100).toFixed(1) : '0') + '%');
console.log('陈旧(其余全部): ' + (total - freshN) + ' 只');
// 与票池对比：只看"有没有文件"是不够的，还要看池子里的票是否都在缓存里
const U = path.join(__dirname, '.universe_cache.json');
if (fs.existsSync(U)) {
  try {
    const u = JSON.parse(fs.readFileSync(U, 'utf8'));
    const codes = (Array.isArray(u) ? u : (u.codes || u.list || []))
      .map(x => (typeof x === 'string' ? x : (x.code || x.symbol))).filter(Boolean).map(c => String(c).slice(-6));
    const have = new Set(files.map(f => f.replace('.json', '')));
    const miss = codes.filter(c => !have.has(c));
    console.log('\n票池 universe: ' + codes.length + ' 只 | 连文件都没有: ' + miss.length + ' 只');
  } catch (e) { console.log('\n票池读取失败: ' + (e && e.message)); }
}
