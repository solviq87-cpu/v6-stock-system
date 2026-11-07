'use strict';
// 守门测试：推送结果学习库的完整性 & 当日信号质量底线
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'learn_pushed_outcomes.json');
function fmtDs(d) {
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
}
const DS = process.argv[2] || fmtDs(new Date());
// 以下信号本质是状态播报/持仓同步，不是选股推荐，不考核涨停命中率
const EXCLUDE_TITLES = [
  '═══ 💰 模拟盘动态 ═══',
  '═══ 🔥 竞价异动 · 连板梯队扫描 ═══',
  '═══ 🔻 持仓风险预警·出货信号 ═══',
  '═══ 🚨 持仓风控警报 · 建议立即处理 ═══',
  '═══ 🌋 板块暴动 ·',
  '═══ 📥 洗盘趋势 ·',
  '═══ 🧹 洗盘趋势 ·',
  '═══ 🧹 持仓观察·疑似洗盘 ═══',
  '═══ 🌏 外围联动 ·',
  '═══ 📰 利好消息·关联个股 ═══',
  '═══ 📋 每日复盘 ·',
  '═══ 🗓️ 次日作战计划 ·',
  '═══ 盘面摘要 ·',
  '🕒 发布对账提醒',
  '🔐 只读设备',
  '═══ 📦 源码包 ·',
  '═══ 📚 漏网治理日报 ·',
  '═══ 每日守门巡检',
  '═══ 📡 开盘自检 ·'
];
function isExcluded(title) {
  return EXCLUDE_TITLES.some(p => title && title.startsWith(p));
}
let failed = 0, passed = 0;
function ok(msg){ passed++; console.log('✓', msg); }
function fail(msg){ failed++; console.log('✗', msg); }

const db = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// 1. 必须有今日样本
const today = db.samples.filter(s => s.ds === DS);
if (today.length > 0) ok(`今日样本 ${today.length} 条`);
else fail('缺少今日样本');

// 2. 每条样本必须含关键字段
const bad = today.filter(s => !s.code || !s.name || s.zt == null || !s.feat);
if (!bad.length) ok('所有样本字段完整');
else fail(`${bad.length} 条样本字段缺失`);

// 3. 涨停判定与涨幅一致：zt=1 时 pct 应接近 limitPct
const ztSamples = today.filter(s => s.zt === 1);
const ztOk = ztSamples.every(s => s.pct >= s.limitPct - 0.5);
if (ztOk) ok('涨停标签与涨幅一致');
else fail('存在涨停标签与涨幅不一致的样本');

// 4. 信号类型命中率底线：样本>=5 的类型，命中率不应为 0
const stats = {};
for (const s of today) {
  for (const t of s.titles || []) {
    const e = stats[t] = stats[t] || { n: 0, zt: 0, win: 0 };
    e.n++; e.zt += s.zt;
    if (s.outcome === 'zt' || s.outcome === 'up') e.win++;
  }
}
const zeroHits = Object.entries(stats)
  .filter(([t, e]) => e.n >= 5 && e.zt === 0 && !isExcluded(t));
if (!zeroHits.length) ok('无样本>=5 但涨停命中率 0% 的信号类型');
else {
  for (const [t, e] of zeroHits) fail(`信号「${t}」${e.n} 只 0 涨停`);
}

// 4.5. 信号类型上涨率底线：样本>=5 的推荐类信号，上涨率（含涨停）不应低于 50%
const lowWin = Object.entries(stats)
  .filter(([t, e]) => e.n >= 5 && e.win / e.n < 0.5 && !isExcluded(t));
if (!lowWin.length) ok('无样本>=5 但上涨率 <50% 的信号类型');
else {
  for (const [t, e] of lowWin) fail(`信号「${t}」${e.n} 只上涨率 ${(e.win/e.n*100).toFixed(1)}%`);
}

// 4.6. 今日整体上涨率（含涨停）不应低于 55%（大盘大跌日可放宽，但不应过半下跌）
const winToday = today.filter(s => s.outcome === 'zt' || s.outcome === 'up').length;
const winRate = winToday / today.length;
if (winRate >= 0.55) ok(`今日推送上涨率 ${(winRate*100).toFixed(1)}%`);
else fail(`今日推送上涨率 ${(winRate*100).toFixed(1)}% < 55%`);

console.log(`\n${passed} 通过 / ${failed} 失败`);
process.exit(failed ? 1 : 0);
