// 守门：jg 轮「缩量柱 K线语言规则库」
//   ① 规则表完整：4 趋势阶段 × 9 K线形态 × 2 换手率
//   ② 趋势阶段/形态/缩量/换手判定纯函数真跑
//   ③ 主入口 klineLangOf 仅在缩量柱返回解读，非缩量柱返回 null（不硬编）
//   ④ server.js 中 briefOfDay / analyzeStock 已接入 klineLang
//   ⑤ 缺数据不冒充（K线不足 / 量缺失 → null）
'use strict';
const fs = require('fs');
const path = require('path');
const KL = require('./kline_lang');

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') { console.log('❌ [类型闸] ' + name + ' 入参非布尔: ' + typeof cond); fail++; return; }
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? ' | ' + detail : '')); }
}

function makeRows(opts) {
  // 生成一组 K线：默认 30 根震荡（收盘价恒为 10 → MA20 水平，价格贴均线），可通过 opts 覆盖最后几根
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const close = 10.0;
    const open = i > 0 ? rows[i - 1].close : 10.0;
    const high = 10.02;
    const low = 9.98;
    const pct = 0;
    rows.push({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      open, close, high, low,
      volume: 1000000 + (i % 5) * 100000,
      turnover: 3.5 + (i % 3),
      pct
    });
  }
  if (opts && opts.tail) {
    for (let i = 0; i < opts.tail.length; i++) {
      const ri = rows.length - opts.tail.length + i;
      if (ri >= 0) Object.assign(rows[ri], opts.tail[i]);
    }
  }
  return rows;
}

function deepUpRows() {
  // 连续上涨并处于高位：近20日涨幅 > 30%，且价格贴近20日高
  const rows = [];
  let price = 10;
  for (let i = 0; i < 30; i++) {
    const daily = i >= 10 ? 1.8 : 0.2; // 后20日每天涨约1.8%
    const open = +price.toFixed(2);
    price = price * (1 + daily / 100);
    const close = +price.toFixed(2);
    const high = +(Math.max(open, close) * 1.008).toFixed(2);
    const low = +(Math.min(open, close) * 0.995).toFixed(2);
    rows.push({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      open, close, high, low,
      volume: 1000000,
      turnover: 2.0,
      pct: +daily.toFixed(2)
    });
  }
  return rows;
}

function downRows(lastDoji = false) {
  // 连续下跌；lastDoji=true 时把最后一根改成缩量十字星，且价格贴在趋势内
  const rows = [];
  let price = 10;
  for (let i = 0; i < 30; i++) {
    const daily = -1.5;
    const open = +price.toFixed(2);
    price = price * (1 + daily / 100);
    const close = +price.toFixed(2);
    const high = +(Math.max(open, close) * 1.008).toFixed(2);
    const low = +(Math.min(open, close) * 0.995).toFixed(2);
    rows.push({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      open, close, high, low,
      volume: 1000000,
      turnover: 2.5,
      pct: daily
    });
  }
  if (lastDoji) {
    const r = rows[rows.length - 1];
    r.volume = 100000;
    r.turnover = 2.0;
    // 十字星：实体极小、上下影线明显，收盘接近原 close
    r.open = +(r.close * 1.001).toFixed(2);
    r.close = +(r.close * 0.999).toFixed(2);
    r.high = +(r.close * 1.04).toFixed(2);
    r.low = +(r.close * 0.96).toFixed(2);
    r.pct = -0.1;
  }
  return rows;
}

console.log('\n[1] 规则表结构完整性');
{
  ok(KL.STAGES.length === 4, '规则表含 4 个趋势阶段', KL.STAGES.join(','));
  ok(KL.PATTERNS.length === 9, '规则表含 9 种K线形态', KL.PATTERNS.join(','));
  for (const st of KL.STAGES) {
    for (const pa of KL.PATTERNS) {
      ok(!!KL.RULES && !!KL.RULES[st] && !!KL.RULES[st][pa] && !!KL.RULES[st][pa]['低换手'] && !!KL.RULES[st][pa]['正常换手'],
        `规则表存在：${st}·${pa}·低/正常换手`);
    }
  }
}

console.log('\n[2] 趋势阶段判定');
{
  const up = deepUpRows();
  ok(KL.detectStage(up) === '高位', '连续大涨高位被识别为高位', KL.detectStage(up));

  const down = downRows();
  ok(KL.detectStage(down) === '下跌', '连续下跌被识别为下跌', KL.detectStage(down));

  const rows = makeRows({});
  const st = KL.detectStage(rows);
  ok(st === '震荡', '默认 synthetic 数据识别为震荡', st);

  ok(KL.detectStage([]) === null, '空数组返回 null');
  ok(KL.detectStage(rows.slice(0, 5)) === null, '不足25根返回 null');
}

console.log('\n[3] K线形态判定');
{
  // 涨停：主板 10%（用常见代码 000001）
  const zt = { open: 10, close: 11, high: 11, low: 10, pct: 10 };
  ok(KL.detectPattern(zt, '000001', '某股').pattern === '涨停', '10% 涨停识别');

  // 阳线
  const yang = { open: 10, close: 10.5, high: 10.6, low: 9.9, pct: 5 };
  ok(KL.detectPattern(yang, '000001', '某股').pattern === '阳线', '阳线识别');

  // 阴线
  const yin = { open: 10.5, close: 10, high: 10.6, low: 9.9, pct: -5 };
  ok(KL.detectPattern(yin, '000001', '某股').pattern === '阴线', '阴线识别');

  // 假阳线：close > open 但 pct < 0
  const jyang = { open: 10, close: 10.2, high: 10.3, low: 9.9, pct: -2 };
  ok(KL.detectPattern(jyang, '000001', '某股').pattern === '假阳线', '假阳线识别');

  // 假阴线：close < open 但 pct > 0
  const jyin = { open: 10.3, close: 10.1, high: 10.4, low: 10, pct: 1 };
  ok(KL.detectPattern(jyin, '000001', '某股').pattern === '假阴线', '假阴线识别');

  // 十字星
  const doji = { open: 10.01, close: 10, high: 10.5, low: 9.5, pct: 0 };
  ok(KL.detectPattern(doji, '000001', '某股').pattern === '十字星', '十字星识别');

  // 上影线（实体足够大，避免被十字星吞掉）
  const upper = { open: 10, close: 10.3, high: 11.5, low: 9.9, pct: 3 };
  ok(KL.detectPattern(upper, '000001', '某股').pattern === '上影线', '上影线识别');

  // 下影线
  const lower = { open: 10.3, close: 10, high: 10.4, low: 9, pct: -3 };
  ok(KL.detectPattern(lower, '000001', '某股').pattern === '下影线', '下影线识别');

  // 上下影线
  const both = { open: 10, close: 10.3, high: 11.2, low: 9, pct: 3 };
  ok(KL.detectPattern(both, '000001', '某股').pattern === '上下影线', '上下影线识别');
}

console.log('\n[4] 缩量判定');
{
  const rows = makeRows({ tail: [{ volume: 100000 }] }); // 最后一日量极小
  const sh = KL.isShrinkVolume(rows, rows.length - 1);
  ok(sh.isShrink === true, '极小量判定为缩量柱');
  ok(sh.volRatio != null && sh.volRatio < 0.85, '缩量柱量比 < 0.85', sh.volRatio);

  const rows2 = makeRows({ tail: [{ volume: 10000000 }] }); // 最后一日量极大
  const sh2 = KL.isShrinkVolume(rows2, rows2.length - 1);
  ok(sh2.isShrink === false, '巨量判定为非缩量柱');

  // 当日量 = 0（脏数据）不应被误判为缩量
  const rows3 = makeRows({ tail: [{ volume: 0 }] });
  const sh3 = KL.isShrinkVolume(rows3, rows3.length - 1);
  ok(sh3.isShrink === false && sh3.volRatio === null, 'volume=0 脏数据不判缩量');
}

console.log('\n[5] 换手档位');
{
  ok(KL.turnoverLevel(2) === '低换手', '2% 为低换手');
  ok(KL.turnoverLevel(3) === '正常换手', '3% 为正常换手（默认阈值）');
  ok(KL.turnoverLevel(null) === null, '非法换手返回 null');
}

console.log('\n[6] 主入口 klineLangOf');
{
  // 高位 + 缩量阳线 + 低换手
  const up = deepUpRows();
  const last = up[up.length - 1];
  last.volume = 100000; // 缩量
  last.turnover = 2.0;
  const r = KL.klineLangOf({ rows: up, code: '000001', name: '某股' });
  ok(r != null, '高位缩量阳线返回解读');
  ok(r.stage === '高位', 'stage=高位');
  ok(r.pattern === '阳线', 'pattern=阳线');
  ok(r.turnoverLevel === '低换手', 'turnoverLevel=低换手');
  ok(r.isShrink === true, 'isShrink=true');
  ok(/高位缩量阳线/.test(r.interpretation), 'interpretation 含关键词', r.interpretation);
  ok(r.risk === '警惕', '高位风险标签为警惕');

  // 非缩量柱返回 null
  const up2 = deepUpRows();
  up2[up2.length - 1].volume = 1000000; // 非缩量
  const r2 = KL.klineLangOf({ rows: up2, code: '000001', name: '某股' });
  ok(r2 === null, '非缩量柱返回 null');

  // 下跌 + 缩量十字星
  const down = downRows(true);
  const r3 = KL.klineLangOf({ rows: down, code: '000001', name: '某股' });
  ok(r3 != null && r3.stage === '下跌' && r3.pattern === '十字星', '下跌缩量十字星识别', r3 && JSON.stringify(r3));
  ok(r3 && r3.risk === '观察', '下跌趋势十字星风险标签为观察');
}

console.log('\n[7] server.js 集成点');
{
  const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  ok(SV.indexOf("const KL = require('./kline_lang')") >= 0, 'server.js require kline_lang');
  ok(/KL\.klineLangOf\(\{ rows, idx, code, name \}\)/.test(SV), 'briefOfDay 调用 KL.klineLangOf');
  ok(/klineLang/.test(SV), 'briefOfDay 返回 klineLang 字段');
  // analyzeStock 也走了 brief，因此只需确认 briefOfDay 调用处传了 code
  ok(/briefOfDay\(tail, tail\.length - 1, mk, code, stockNameOf\(code\)\)/.test(SV), 'analyzeStock 调用 briefOfDay 传 code');
}

console.log('\n[8] 缺数据不硬判');
{
  ok(KL.klineLangOf({ rows: [], code: '000001' }) === null, '空 rows 返回 null');
  ok(KL.klineLangOf({ rows: makeRows({}).slice(0, 5), code: '000001' }) === null, '不足25根返回 null');
}

console.log(`\n合计：通过 ${pass} 项，失败 ${fail} 项`);
process.exit(fail > 0 ? 1 : 0);
