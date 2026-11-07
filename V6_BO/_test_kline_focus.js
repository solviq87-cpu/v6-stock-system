// hj/hl 轮 K 线面板守门（hr2 轮：分时图已取消）——当日聚焦简析 + 同花顺大单兜底 + 懒加载 + 聚焦。
// 抽 server.js 纯函数做单测，避开模块 TDZ；另做结构断言（含「分时图已移除」反向断言，防复活）。
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const EM = fs.readFileSync(path.join(__dirname, 'em.js'), 'utf8');

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

const klineMaOf = eval('(' + extractFn(SRC, 'klineMaOf') + ')');
const briefOfDay = eval('(' + extractFn(SRC, 'briefOfDay') + ')');

let pass = 0, fail = 0;
function ok(cond, name) { if (cond) pass++; else { fail++; console.log('  ✗ ' + name); } }

// ── 当日聚焦简析 briefOfDay（蜡烛图点开某天看当日分析，与分时图无关，保留）──
const rows = [];
for (let i = 1; i <= 20; i++) rows.push({ date: '2026-10-' + String(i).padStart(2, '0'), open: 10 + i, close: 10 + i, high: 11 + i, low: 9 + i, volume: 1000 + i, pct: 1, turnover: 2 });
const mk = {
  algo: {
    buy: [{ date: '20261010', label: '竞价异动' }],
    t: [{ date: '20261010', low: 1, high: 2, amp: 5 }],
    lock: [{ date: '20261010', note: '趋势未破' }],
  },
  paper: { holds: [], trades: [{ date: '20261010', side: '买入', price: 15, pnl: 1, reason: 'r' }] },
};
const f = briefOfDay(rows, 9, mk);   // idx 9 = 2026-10-10
ok(f && f.date === '20261010', '聚焦日期解析正确');
ok(f.buy.length === 1 && f.buy[0].label === '竞价异动', '当日算法买点带出');
ok(f.t === true, '当日做T区带出');
ok(f.lock === true, '当日趋势锁仓带出');
ok(f.trades.length === 1 && f.trades[0].side === '买入', '当日模拟盘成交带出');
ok(/算法买点/.test(f.brief) && /模拟盘买入/.test(f.brief), '简析文案含买卖点');
ok(/站上MA5/.test(f.brief) || /站上MA10/.test(f.brief), '简析含均线站位');

// ── 反向断言：分时图确已整栈移除（用户 hr2 轮「取消分时图功能」）──
ok(!/p === '\/api\/intraday'/.test(SRC), '/api/intraday 接口已移除');
ok(!/function intradayMaOf\(/.test(SRC), 'intradayMaOf 已移除');
ok(!/klDrawIntraday|klLoadIntraday/.test(require('fs').readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8')), '前端 klDrawIntraday/klLoadIntraday 已移除');
ok(!/fetchIntradayEM|fetchMinutesEM/.test(EM), 'em.js 不再有 fetchIntradayEM/fetchMinutesEM');

// ── 结构断言：蜡烛图/资金流/懒加载/聚焦仍在位（不受移除影响）──
ok(/source: 'ths'/.test(SRC), 'klineFlowOf 同花顺兜底标 source=ths');
ok(/await em\.fetchThsActive\(c\)/.test(SRC), 'klineFlowOf 调 fetchThsActive 兜底');
ok(SRC.includes("get('end')"), '/api/kline 支持 end 懒加载');
ok(SRC.includes('focusDate'), '/api/kline-marks 支持 date 聚焦');
ok(/briefOfDay\(tail,\s*fi,\s*mk/.test(SRC), '/api/kline-marks 调 briefOfDay 产当日简析');
ok(SRC.includes("'历史日期无当日资金流"), '历史日不把今日流量冒充');

console.log(`[kline_focus] ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
