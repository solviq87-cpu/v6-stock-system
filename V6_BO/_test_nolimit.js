// 守门测试：新股「无涨跌幅限制期」不许被判成涨停（2026-10-06）
//
// 背景（新角度：数值量纲 / 规则边界）：
//   A.limitPctOf 只按「代码前缀」定限幅（主板10 / 创业科创20 / 北交所30；ST 2026-04 起与主板同限幅），
//   **认不出新股**。而新股上市前 5 个交易日**不设涨跌幅限制** —— 这段时间根本不存在"涨停"。
//   实测后果：一只上市第 2 天的主板新股涨 30%，会被判成"10cm 涨停" →
//     ① 混进涨停池、连板梯队、板块龙头（把真主线挤掉）
//     ② 被 seedLearnFromHistory 当成"涨停日"灌进学习样本 → 学出来的规律是假的
//     ③ 模拟盘按"涨停不可买入"把它拦掉（它其实完全可以买）
//   注册制下创业板/科创板新股同样前 5 日无限制，北交所新股首日无限制。
//
// 修法：不能改 isLimitUp 的签名（11 处调用点、绝大多数拿不到上市日期），
//   改成**注入钩子** setNoLimitFn —— 拿得到上市日期的地方（server 的全A快照）注入，
//   拿不到的地方退化为原行为；钩子抛异常也有 catch 兜底，绝不把判定打崩。
//
// 本测试钉死：
//   ① 未注入 → 退化为原行为（不能比修之前更差）
//   ② 注入后，各板块新股在大涨时都**不判涨停**
//   ③ 注入后，非新股的限幅判定完全不变（不能误伤）
//   ④ 钩子抛异常不崩
//   ⑤ server 真的注入了，且用的是 listedDaysAgo（不是会跨月失效的整数减法）
//   ⑥ 上市日期索引用 Map（O(1)），不是 O(n) 的 find
'use strict';
const fs = require('fs');
const A = require('./analysis.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (extra ? '  → ' + extra : '')); } };

const SRC = fs.readFileSync('server.js', 'utf8');
const ASRC = fs.readFileSync('analysis.js', 'utf8');

console.log('\n[1] 导出与钩子机制');
ok(typeof A.setNoLimitFn === 'function', 'setNoLimitFn 已导出（供 server 注入上市日期）');
ok(typeof A.hasNoLimit === 'function', 'hasNoLimit 已导出（判定结果可自查）');
ok(/if \(hasNoLimit\(code\)\) return false;/.test(ASRC), '⚠️ isLimitUp 里真的先判了无限制期（核心断言）');
ok(/catch \{ return false; \}/.test(ASRC.slice(ASRC.indexOf('function hasNoLimit'))), '钩子抛异常有 catch 兜底（不会把判定打崩）');

console.log('\n[2] 未注入时退化为原行为（不能比修之前更差）');
A.setNoLimitFn(null);
ok(A.isLimitUp('600000', '浦发银行', 10) === true, '未注入：主板涨 10% 仍判涨停');
ok(A.isLimitUp('600000', '新股X', 30) === true, '未注入：新股涨 30% 仍按板块限幅判（退化行为，与修复前一致）');
ok(A.hasNoLimit('600000') === false, '未注入：hasNoLimit 恒 false');

console.log('\n[3] 注入后：新股大涨一律不判涨停');
const IS_NEW = new Set(['600001', '300001', '688001', '830001']);
A.setNoLimitFn(code => IS_NEW.has(String(code)));
{
  const cases = [
    ['600001', '主板新股', 30, '主板新股涨 30%（无 10% 限制，不是涨停）'],
    ['600001', '主板新股', 44, '主板新股涨 44%（新股常见幅度）'],
    ['300001', '创业新股', 50, '创业板新股涨 50%（无 20% 限制）'],
    ['688001', '科创新股', 60, '科创板新股涨 60%'],
    ['830001', '北交新股', 80, '北交所新股涨 80%'],
  ];
  for (const [code, name, pct, label] of cases) {
    ok(A.isLimitUp(code, name, pct) === false, `⚠️ ${label} → 不判涨停`);
  }
}

console.log('\n[4] 注入后：非新股限幅判定完全不变（不能误伤）');
{
  const cases = [
    ['600000', '浦发银行', 10, true, '主板 10% 涨停'],
    ['600000', '浦发银行', 9.5, false, '主板 9.5% 不算涨停'],
    ['300750', '宁德时代', 20, true, '创业板 20% 涨停'],
    ['300156', 'ST有棵树', 20, true, '创业板ST 20% 涨停（板块优先于 ST）'],
    ['300156', 'ST有棵树', 5, false, '创业板ST 5% 不误判'],
    ['688981', '中芯国际', 20, true, '科创板 20% 涨停'],
    ['830799', '艾融软件', 30, true, '北交所 30% 涨停'],
    ['600122', '*ST中珠', 10, true, '主板ST 10% 涨停（与主板同限幅）'],
    ['600122', '*ST中珠', 5, false, '主板ST 5% 不算涨停（旧 5cm 口径已废）'],
  ];
  for (const [code, name, pct, want, label] of cases) {
    ok(A.isLimitUp(code, name, pct) === want, `${label} → ${want}`);
  }
}

console.log('\n[5] 钩子异常不崩 + 反证');
{
  A.setNoLimitFn(() => { throw new Error('钩子炸了'); });
  ok(A.isLimitUp('600000', '浦发银行', 10) === true, '钩子抛异常时仍按限幅正常判定（catch 生效）');
  // 反证：钩子返回 false → 新股又被误判成涨停（说明这条判定真的走钩子，不是摆设）
  A.setNoLimitFn(() => false);
  ok(A.isLimitUp('600001', '主板新股', 30) === true, '⚠️ 反证：钩子返回 false 时新股涨 30% 又被误判成涨停');
  A.setNoLimitFn(null);
}

console.log('\n[6] server 侧注入');
{
  ok(/A\.setNoLimitFn\(/.test(SRC), '⚠️ server.js 真的调用了 A.setNoLimitFn（否则等于没修）');
  // ⚠️ 必须剥掉注释再扫：listedDaysAgo 上方的注释里正好写着反例
  //    「禁止再写 listedDate <= todayStr() - 30 这类整数减法」，直接对源码跑正则必然假红。
  const CODE = require('./_codescan.js').stripNoise(SRC);
  ok(!/listedDate\s*<=\s*todayStr\(\)\s*-/.test(CODE), '真实代码里没有会跨月失效的整数减法（注释里的反例不算）');
  // 注入块里必须走 listedDaysAgo（唯一判定入口）
  const i = SRC.indexOf('A.setNoLimitFn(');
  const seg = SRC.slice(i, i + 700);
  ok(/listedDaysAgo\(/.test(seg), '注入块用 listedDaysAgo（唯一上市天数入口）');
  const N = +(/const NO_LIMIT_DAYS = (\d+)/.exec(SRC) || [])[1] || 0;
  ok(N >= 7 && N <= 12, `无限制期阈值合理（${N} 自然日 ≈ 5 个交易日含周末，宁可多排除两天）`);
  ok(/new Map\(\)/.test(SRC.slice(SRC.indexOf('function listedDateOf'), SRC.indexOf('A.setNoLimitFn('))),
    '⚠️ 上市日期索引是 Map（O(1)），不是 O(n) 的 find（全市场扫描会查几千只票）');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
