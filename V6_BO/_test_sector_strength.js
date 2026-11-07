'use strict';
// 板块强度播报单测（2026-10-09 fv 轮）：用户投诉「电池/传媒板块那么强一条都不推送」。
// 旧逻辑只认「30 秒突增」(d>=3e7)，板块全天稳步走强不触发。本测试验证 pickNotableSectors
// 既保留突增触发，又新增「板块涨幅>=STRONG_PCT 且净流入为正」的强势触发，且同名去重/取前 2。
const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');
function grab(start, end) {
  const i = SRC.indexOf(start);
  if (i < 0) throw new Error('找不到起始: ' + start);
  const j = SRC.indexOf(end, i);
  if (j < 0) throw new Error('找不到结束: ' + end);
  return SRC.slice(i, j);
}
const fnSrc = grab('function pickNotableSectors(sectors', 'async function sectorSurgeScan');
const pick = new Function(fnSrc + '\nreturn pickNotableSectors;')();

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };
const mk = (name, pct, inflow) => ({ name, pct, mainInflow: inflow });
const flowOf = objs => new Map(objs.map(o => [o.name, (o.mainInflow || 0) - 1e8])); // 上轮都低，便于制造突增

// ① 强势板块（电池/传媒那种全天走强）必须被选中
{
  const secs = [mk('电池', 4.2, 2e8), mk('传媒', 3.1, 1e8), mk('弱势板块', 1.0, 5e7)];
  const r = pick(secs, null, false, 2.5);
  const names = r.map(x => x.name);
  ok('电池(强 +4.2%) 被选中', names.includes('电池'), names.join(','));
  ok('传媒(强 +3.1%) 被选中', names.includes('传媒'), names.join(','));
  ok('弱势板块(pct1%) 不入选', !names.includes('弱势板块'), names.join(','));
  ok('选中项标记为 strong', r.every(x => x.kind === 'strong'));
}

// ② 30 秒突增（涨幅小但净流入骤增）仍触发，且标记为 surge
{
  const secs = [mk('突增板块', 0.8, 2e8)];
  const r = pick(secs, flowOf(secs), true, 2.5);
  ok('突增板块(d>=3e7) 被选中', r.length === 1 && r[0].kind === 'surge', JSON.stringify(r));
}

// ③ 同名去重：同一板块既突增又强势 → 只留一条（突增优先）
{
  const secs = [mk('电池', 5.0, 5e8)];
  const r = pick(secs, flowOf(secs), true, 2.5);
  ok('同名只返回 1 条', r.length === 1, 'len=' + r.length);
  ok('同名去重优先 surge', r[0].kind === 'surge', r[0].kind);
}

// ④ 取前 2：超过 2 个强势板块只报最强的 2 个
{
  const secs = [mk('A', 1.0, 1e8), mk('B', 2.6, 1e8), mk('C', 3.0, 1e8), mk('D', 5.0, 1e8)];
  const r = pick(secs, null, false, 2.5);
  ok('仅返回前 2 个', r.length === 2, 'len=' + r.length);
  ok('前 2 是最强的(D,C)', r[0].name === 'D' && r[1].name === 'C', r.map(x => x.name).join(','));
}

// ⑤ 阈值边界：恰好 2.5% 入选，2.4% 不入选
{
  ok('2.5% 边界入选', pick([mk('X', 2.5, 1e8)], null, false, 2.5).length === 1);
  ok('2.4% 边界不入选', pick([mk('Y', 2.4, 1e8)], null, false, 2.5).length === 0);
}

// ⑥ 净流入为负不入选（避免下跌板块误报）
{
  ok('净流出板块不入选', pick([mk('Z', 4.0, -1e8)], null, false, 2.5).length === 0);
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
