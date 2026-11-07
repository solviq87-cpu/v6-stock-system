// ①-2 竞价分层闸门守门：普跌负向闸 + 板块共振闸
// 抽 server.js 内两个纯函数（auctionMktGate / auctionResonanceAdj）做单测，避开模块 TDZ。
// 另做结构断言：inferZTProb / auctionScoreOf 已接入这两道闸。
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数 ' + name);
  const ob = src.indexOf('{', start);
  let depth = 0, end = -1;
  for (let j = ob; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end < 0) throw new Error('括号不配对 ' + name);
  return src.slice(start, end + 1);
}

const auctionMktGate = eval('(' + extractFn(SRC, 'auctionMktGate') + ')');
const auctionResonanceAdj = eval('(' + extractFn(SRC, 'auctionResonanceAdj') + ')');
const auctionTrapOf = eval('(' + extractFn(SRC, 'auctionTrapOf') + ')');

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('  ✗ ' + name); } }

// ── 普跌环境负向闸 · 乘数表 ──
ok(auctionMktGate(null) === 1, 'null→中性1(判不出≠判了差)');
ok(auctionMktGate(NaN) === 1, 'NaN→中性1');
ok(auctionMktGate(0.2) === 0.55, '普跌<0.35→0.55');
ok(auctionMktGate(0.34) === 0.55, '边界0.34→0.55');
ok(auctionMktGate(0.35) === 0.8, '边界0.35→0.8');
ok(auctionMktGate(0.4) === 0.8, '偏弱0.4→0.8');
ok(auctionMktGate(0.5) === 1, '边界0.5→1(不降权)');
ok(auctionMktGate(0.6) === 1, '正常环境→1');

// ── 板块共振闸 ──
ok(auctionResonanceAdj(null) === 0, 'secZT=null→中性0');
ok(auctionResonanceAdj(0) === -8, '0只→-8');
ok(auctionResonanceAdj(1) === -8, '1只→-8(孤板)');
ok(auctionResonanceAdj(2) === 0, '2只→0(有共振)');
ok(auctionResonanceAdj(5) === 0, '5只→0');

// ── 集成语义：普跌日把临界信号压到不推送（宁漏勿重）──
function gatedProb(p, up) { return Math.max(12, Math.min(Math.round(p * auctionMktGate(up)), 92)); }
ok(gatedProb(70, 0.2) < 55, '普跌把70分压到<55(不推送)');
ok(gatedProb(70, 0.6) >= 55, '正常环境70分仍推送');
ok(gatedProb(90, 0.2) < 90, '普跌90分也被降权');
ok(gatedProb(12, 0.2) === 12, '地板12不被乘成负');

// ── ①-3 撤单陷阱拒识纯函数 ──
const tkA = { preClose: 10, bars: [
  { t: '09:15', price: 10.2, high: 10.3, low: 10.1 },
  { t: '09:18', price: 10.6, high: 10.8, low: 10.5 },  // 9:20前最高 10.8 → +8%
  { t: '09:22', price: 10.4, high: 10.5, low: 10.3 },
  { t: '09:25', price: 10.3, low: 10.2 }               // 9:20后收盘 10.3 → 回落 4.6%
] };
ok(auctionTrapOf(tkA, 10).trap === true, '9:20前冲高8%→后回落4.6%→诱多');
const tkB = { preClose: 10, bars: [
  { t: '09:15', price: 10.1, high: 10.15, low: 10.05 },
  { t: '09:18', price: 10.2, high: 10.25, low: 10.15 },
  { t: '09:22', price: 10.1, high: 10.15, low: 10.05 },
  { t: '09:25', price: 10.05, low: 10.0 }
] };
ok(auctionTrapOf(tkB, 10).trap === false, '9:20前仅冲高2.5%(<5%)→非诱多');
const tkC = { preClose: 10, bars: [
  { t: '09:15', price: 10.5, high: 10.9, low: 10.4 },
  { t: '09:18', price: 10.8, high: 10.95, low: 10.6 }, // 9:20前最高 10.95 → +9.5%
  { t: '09:22', price: 10.85, high: 10.9, low: 10.8 },
  { t: '09:25', price: 10.82, low: 10.8 }              // 仅回落 1.2%(<1.5%)→真抢筹
] };
ok(auctionTrapOf(tkC, 10).trap === false, '9:20前冲高9.5%但仅回落1.2%(<1.5%)→真抢筹非诱多');
ok(auctionTrapOf({ preClose: 10, bars: [{ t: '09:25', price: 10 }] }, 10).trap === false, 'bars<4→非诱多(数据不足)');
ok(auctionTrapOf({ bars: [{ t: '09:18', price: 10 }, { t: '09:22', price: 10 }] }, null).trap === false, '缺昨收→判不出');

// ── 结构断言：两道闸 + 选股纪律 + 陷阱已接入生产代码 ──
ok(/auctionMktGate\(_up\)/.test(SRC), 'inferZTProb 接入 auctionMktGate(_up)');
ok(/auctionResonanceAdj\(r\.secZT\)/.test(SRC), 'auctionScoreOf 接入 auctionResonanceAdj(r.secZT)');
ok(/_mk < 1 \? \['市场偏弱·竞价信号降权'\]/.test(SRC), '推送文案携带降权原因(透明)');
ok(/fc >= 5e11\) \{ s -= 16/.test(SRC), '结构·超大盘档位存在(≥2000亿)');
// ── 选股纪律·市值曲线：钉语义不钉字符串（kv 轮起沙箱真跑）──
// ⛔ 旧写法钉 `s -= 14` / `s -= 4` 两个字面量，改系数就假红、且查不出「300亿~1000亿 零惩罚」的洞。
//    现在真跑 auctionScoreOf，钉的是「曲线单调不升 + 300亿 分界差 ≥12 + 新档开新键 + 缺市值不判」。
// ⚠️ 沙箱注入必须齐：todayStr 在生产里是**函数**（`typeof todayStr === 'function'` 判形态），
//    传字符串会让因子键判断静默走偏（不报错、只是选错分支）。
const auctionScoreOf = new Function('S', 'todayStr', 'ztDayTag', 'auctionResonanceAdj',
  extractFn(SRC, 'auctionScoreOf') + '\nreturn auctionScoreOf;')(
  { news: null }, () => '20261024', (d) => (d === '20261024' ? '今日' : '昨日'),
  (n) => (n == null ? 0 : (n < 2 ? -8 : 0)));
const mkX = (fc) => ({ code: '600000', name: 'T', auctionPct: 3.5, mainPct: 2, mainInflow: 1e8, floatCap: fc });
const sc = (fc) => auctionScoreOf(mkX(fc), { amtRank: new Map([['600000', 300]]), n: 5000, amtReliable: true });
const TIERS = [3e9, 2e10, 2.9e10, 3e10, 5e10, 1.5e11, 3e11, 6e11];   // <50亿 / 200亿 / 290亿 / 300亿 / 500亿 / 1500亿 / 3000亿 / 6000亿
const tierScores = TIERS.map(fc => sc(fc).score);
const tierKeys = TIERS.map(fc => (sc(fc).factors || []).join(','));
ok(tierScores.every((v, i) => i === 0 || v <= tierScores[i - 1]),
  '市值曲线单调不升(盘子越大分越低)', tierScores.join('>='));
ok(sc(2.9e10).score - sc(3e10).score >= 12,
  '300亿 分界差 ≥12(实证 log-odds 差 2.46 保守端)', `${sc(2.9e10).score} vs ${sc(3e10).score}`);
ok(tierKeys[4].includes('大市值折价') && tierKeys[5].includes('中大盘折价'),
  '300亿~1000亿 落新键「大市值折价」(旧键不动·历史样本不孤儿)', tierKeys[4]);
ok(tierKeys[7].includes('大盘股折价') && !tierKeys[7].includes('大市值折价'),
  '≥2000亿 仍挂旧键「大盘股折价」', tierKeys[7]);
// ⛔ 反证：旧曲线 300~1000亿 零惩罚（与 fc 缺失同分）→ 现在必须被罚
ok(sc(5e10).score < sc(0).score - 8, '反证·300亿+ 不得与「无市值」同分(旧洞已补)', `${sc(5e10).score} vs ${sc(0).score}`);
ok(sc(0).score === sc(null).score && sc(0).score === sc(undefined).score
  && !/折价|易拉|中小盘/.test(tierKeys.length ? (sc(0).factors || []).join(',') : ''),
  'fc=0/null/undefined 不判市值(缺数据≠大票)', String(sc(0).score));
ok(/fc < 5e9\) { s \+= 12/.test(SRC), '选股纪律·小盘(<50亿)+12');
ok(/缺竞价抢筹/.test(SRC), '选股纪律·无竞价抢筹路径稀释-6');
ok(/x\.trap\) { s -= 22/.test(SRC), 'auctionScoreOf 接入陷阱强降权(-22)');
ok(/await auctionTicksFor\(x\.code\)/.test(SRC), 'captureAuction 9:20后补拉竞价分时判陷阱');
ok(/auctionTrapOf\(tk, _pre\)/.test(SRC), 'captureAuction 用 auctionTrapOf 判定');

// ── 2026-10-29：撤单陷阱「两天全灭」两根因（实测 10-28/10-29 留档 ticks 全 null、trap 全 false）──
// 根因①东财 trends2/iscr=1 的昨收在 data.preClose 顶层，em.fetchAuctionTicks 读 data.pre.close 恒 null
//        → auctionTrapOf 第一道闸「缺昨收→判不出」恒 false，-22 分负向闸一天没跑过。
ok(!/auctionTrapOf\(tk, tk && tk\.preClose\)/.test(SRC),
  '反证·不许再只传 tk.preClose（字段名错→恒 null→陷阱永不触发）');
ok(/_preMap\.get\(x\.code\)/.test(SRC) && /if \(s\.preClose > 0\) _preMap\.set/.test(SRC),
  'captureAuction 昨收兜底：tk.preClose 缺失时取本轮快照昨收（与 auctionPct 同源）');
// 行为真跑：东财真返回形态（bars 齐全、preClose=null）+ 快照昨收 → 必须判出诱多
const _barsReal = [
  { t: '09:15', price: 10.0, high: 10.0 },
  { t: '09:18', price: 10.7, high: 10.8 },   // 9:20 前冲高 +8%
  { t: '09:21', price: 10.45, high: 10.5 },
  { t: '09:23', price: 10.3, high: 10.3 },
  { t: '09:25', price: 10.25, high: 10.25 }, // 9:20 后回落至 10.25（-5.1%）
];
ok(auctionTrapOf({ preClose: null, bars: _barsReal }, 10).trap === true,
  '东财真形态（preClose=null）+ 快照昨收10 → 判出撤单诱多（修复前恒 false）');
ok(auctionTrapOf({ preClose: null, bars: _barsReal }, null).trap === false,
  '反证·快照昨收也缺失 → 仍是判不出（不硬判成诱多）');
ok(auctionTrapOf({ preClose: 10, bars: _barsReal }, 10).trap === true,
  '接口将来若真给出 preClose，优先级不被兜底破坏');

// 根因②失败缓存无 TTL：`if (hit && hit.date === ds) return hit.ok ? hit.data : null;` 排在 failAt 之前
//        → 同一天失败必然 hit.date===ds → 15 分钟重试窗是死代码 → 9:20 首次失败=当日全灭。
const _mkTicksFor = new Function('S', 'NP', 'em', 'Date',
  'return (async ' + extractFn(SRC, 'auctionTicksFor') + ');');   // extractFn 从 'function' 起切，async 要自己补
(async () => {
  let calls = 0, now = 1793236800000;
  const _S = {}, _NP = { localDate: () => '20261029' };
  const _em = { fetchAuctionTicks: async () => { calls++; if (calls === 1) throw new Error('net'); return { preClose: null, bars: _barsReal }; } };
  const _fn = _mkTicksFor(_S, _NP, _em, { now: () => now });
  ok(await _fn('600000') === null, '第一次拉分时失败 → null');
  ok(calls === 1, '失败后已缓存（不立刻重打数据源）');
  ok(await _fn('600000') === null && calls === 1, '15 分钟内不重试（限流保护仍在）');
  now += 16 * 60 * 1000;
  const d2 = await _fn('600000');
  ok(!!d2 && calls === 2, 'TTL 过期后必须重试并拿到数据（修复前：当日永久 null，永不重试）');
  ok(_S.auctionTicks['600000'].ok === true && _S.auctionTicks['600000'].failAt === 0,
    '重试成功要清 failAt（不许残留失败标记）');

// lf 轮：板块视图（用户原意——竞价先看板块强弱，再挑板块内买得到的票）
ok(/const sectorView = \[\.\.\.secAgg\.values\(\)\]/.test(SRC), '竞价共振产出 sectorView 板块视图');
ok(/c\.auctionPct >= sealThreshOf\(c\)/.test(SRC) && /g\.sealedN\+\+/.test(SRC), '封板票（竞价涨幅≥限幅-0.6）只计板块强度、不进可买 picks');
ok(/ap >= 1 && ap <= 6\.8 && c\.score >= 30/.test(SRC), '可买 picks 限竞价涨 1%~6.8% 健康区间且 score≥30');
console.log(`[auction_gate] ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
})();
