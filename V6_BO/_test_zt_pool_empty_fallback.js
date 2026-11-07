// kc 轮守门：涨停池主/兜底接口返回空池时，系统必须从全A快照重建收盘封板池，
// 避免面板「涨停 48 只」与实际收盘 84 只相差近半。
const fs = require('fs');
const path = require('path');
const A = require('./analysis.js');

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, detail) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (detail ? '  → ' + detail : '')); }
};

// 从 server.js 抠出 deriveLimitUpMissed 真跑
const m = src.match(/function deriveLimitUpMissed\(stocks, pool\) \{[\s\S]*?\n\}/);
if (!m) { console.log('❌ deriveLimitUpMissed 函数体未找到'); process.exit(1); }
const derive = new Function('A', `return (${m[0]});`)(A);

function st(code, name, preClose, price, pct, open) {
  return { code, name, preClose, price, pct: pct != null ? pct : +((price / preClose - 1) * 100).toFixed(2), amount: 1e8, floatCap: 5e9, turnover: 2, open };
}

console.log('① 新兜底代码块存在且条件正确');
ok(src.indexOf('接口空池，从全A快照重建') >= 0, 'F1 server.js 含空池兜底注释');
ok(/if \(\(!zt \|\| !zt\.length\) && Array\.isArray\(S\.stocks\) && S\.stocks\.length && marketReady\(\)\)/.test(src), 'F2 空池兜底条件：zt 空 + S.stocks 有数据 + marketReady');
ok(/deriveLimitUpMissed\(S\.stocks, \[\]\)/.test(src), 'F3 空池时以空数组为 pool 调用 deriveLimitUpMissed');
ok(/await enrichMissedStreak\(_derived, _ztDay\)/.test(src), 'F4 重建后回填连板数');

console.log('\n② 空 pool 时 deriveLimitUpMissed 能重建全部收盘封板票');
{
  const stocks = [
    st('000001', '主板A', 10.00, 11.00),      // 10% 封板
    st('300001', '创业板B', 20.00, 24.00),    // 20% 封板
    st('688001', '科创板C', 15.00, 18.00),    // 20% 封板
    st('920001', '北交所D', 10.00, 13.00),    // 30% 封板
    st('600002', '普通涨', 10.00, 10.50),     // 未涨停
    st('000003', '板下1分', 10.00, 10.99),    // 涨停价 11.00，未封
  ];
  const out = derive(stocks, []);
  const codes = out.map(x => x.code).sort();
  ok(codes.length === 4 && codes.join(',') === '000001,300001,688001,920001', 'F5 10%/20%/30% 各板封板全部重建', codes.join(','));
  ok(out.every(x => x.src === 'derive'), 'F6 重建票 src=derive');
  ok(out.every(x => x.limitUpCount === null && x.sealAmount === null && x.breakCount === null && x.firstSeal === null), 'F7 重建票未知字段显式 null');
}

console.log('\n③ 重建池不去重已存在的 API 票');
{
  const pool = [{ code: '000001', name: '主板A' }];
  const stocks = [st('000001', '主板A', 10.00, 11.00), st('300001', '创业板B', 20.00, 24.00)];
  const out = derive(stocks, pool);
  const codes = out.map(x => x.code).sort();
  ok(codes.length === 1 && codes[0] === '300001', 'F8 已在 API 池中的票不再重复重建');
}

console.log('\n④ 兜底失败必须留痕（判不出不硬判·禁止静默填数，2026-10-28 代修补）');
{
  // 背景：这两处留痕原在悬空提交 31c20e8 里，随误 reset 丢失，代码退回静默兜底——
  //      「连板数缺失 / 行业缺失」永远查不出原因。断言锁死，禁止再退回去。
  ok(!/catch\s*\{\s*n\s*=\s*1;\s*\}/.test(src), 'F9 禁止静默 `catch { n = 1 }` 兜底（连板数必须留痕）');
  ok(/async function enrichMissedStreak[\s\S]{0,1400}?补漏票连板数派生失败/.test(src),
     'F10 enrichMissedStreak 派生失败必须 console.warn 汇总失败只数');
  ok(/if \(z\.sector\) continue;[\s\S]{0,900}?涨停池行业归属失败/.test(src),
     'F11 行业归属循环失败必须留痕，sector 留空不猜（禁止裸 catch{} 静默吞）');
  ok(/涨停池行业归属失败[\s\S]{0,120}?留空不猜/.test(src), 'F12 行业归属失败文案须明示「留空不猜」口径');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
