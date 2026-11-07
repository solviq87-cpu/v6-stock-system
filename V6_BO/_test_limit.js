// 涨停口径回归测试 —— 锁死三个已修 bug，防止哪天被改回去：
//  bug① analysis.js limitPctOf()：ST 判定必须排在板块判定之后，
//        否则创业板/科创板的 ST 股限幅被误判成 5%（实际 20%）；
//  bug② server.js seedLearnFromHistory()：写死 pct>=9.8 判涨停，
//        导致创业板(30x)/科创板(68x) 的 20% 涨停一次都没进过学习库。
//  bug③ analysis.js limitPctOf()：主板 ST 限幅写死 5% —— 2026-04 沪深规则修订后
//        风险警示板（ST/*ST）已与主板统一 ±10%（实证 price_ceiling=前收×1.10、
//        缓存 383 只 ST 股近月屡超 ±5%）。旧口径把 ST 涨 4.7% 误判涨停，
//        真 10% 封板反被漏（isLimitUp/连板/涨停池补漏/审计全失真）。
//
// 判定毕竟我是看文档确定的，而这里是逆向肉搏 —— 目标是把结论钉死。
const fs = require('fs');
const path = require('path');
const A = require('./analysis.js');

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

console.log('\n① 涨跌幅限制：板块优先，ST 其次');
{
  const cases = [
    ['300750', '宁德时代', 20, '创业板 20%'],
    ['688981', '中芯国际', 20, '科创板 20%'],
    ['300156', 'ST有棵树', 20, '创业板ST —— 限幅仍是 20%，不是 5%（bug①）'],
    ['688008', 'ST锐电',  20, '科创板ST —— 限幅仍是 20%，不是 5%（bug①）'],
    ['600122', '*ST中珠', 10, '沪深主板ST → 10%（2026-04 起与主板同限幅，旧 5% 口径已废·bug③）'],
    ['000004', 'ST国华',  10, '深主板ST → 10%（同上）'],
    ['600000', '浦发银行', 10, '沪主板 10%'],
    ['000001', '平安银行', 10, '深主板 10%'],
    ['830799', '艾融软件', 30, '北交所 30%'],
    ['920002', '万达轴承', 30, '北交所新代码段 30%'],
  ];
  const rv = (code, name) => A.limitPctOf(code, name);
  for (const [c, n, want, desc] of cases) {
    const got = rv(c, n);
    ok(`${desc} → ${want}%`, got === want, `实得 ${got}%`);
  }
}

console.log('\n② 涨停判定 isLimitUp：按各自板块的限幅判，留 0.3 个点容差');
{
  // 创业板涨 20% = 涨停；主板同样涨 20% 是涨停（10%限制，20>9.7 当然算）
  ok('创业板 20.0% 判涨停', A.isLimitUp('300750', '宁德时代', 20.0) === true);
  ok('创业板 19.8% 判涨停（容差内）', A.isLimitUp('300750', '宁德时代', 19.8) === true);
  ok('创业板 19.0% 不算涨停', A.isLimitUp('300750', '宁德时代', 19.0) === false);
  ok('科创板 20.0% 判涨停', A.isLimitUp('688981', '中芯国际', 20.0) === true);
  ok('创业板ST 涨停需 20% 而非 5%（关键）', A.isLimitUp('300156', 'ST有棵树', 20.0) === true);
  ok('创业板ST 涨 5% 不能被误判成涨停', A.isLimitUp('300156', 'ST有棵树', 5.0) === false);
  ok('北交所 30% 判涨停', A.isLimitUp('830799', '艾融软件', 30.0) === true);
  ok('北交所涨 10% 不算涨停', A.isLimitUp('830799', '艾融软件', 10.0) === false);
  ok('主板 10% 判涨停', A.isLimitUp('600000', '浦发银行', 10.0) === true);
  ok('主板ST 10% 判涨停（与主板同限幅·bug③）', A.isLimitUp('600122', '*ST中珠', 10.0) === true);
  ok('主板ST 涨 5% 不算涨停（旧 5cm 口径已废）', A.isLimitUp('600122', '*ST中珠', 5.0) === false);
}

console.log('\n③ bug②：学习样本再也不会漏掉 20cm 涨停（源码级 + 行为级双锁）');
{
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  // ⚠️ 必须锚定函数定义本身：只写 'seedLearnFromHistory' 会命中**注释**（版本号说明、
  //    口径说明里都提到了它），取到的 4000 字窗口里根本没有函数体，断言会假红。
  const i = src.indexOf('async function seedLearnFromHistory');
  const seg = i > 0 ? src.slice(i, i + 4000) : '';
  ok('找到 seedLearnFromHistory 函数体', !!seg);
  ok('写死的 9.8 门槛已不复存在', seg.indexOf('< 9.8') < 0 && seg.indexOf('>= 9.8') < 0,
    seg.slice(0, 200).indexOf('9.8') >= 0 ? '仍有 9.8 残留' : '');
  ok('改用 A.isLimitUp 做涨停判定', seg.indexOf('A.isLimitUp') >= 0);

  // 行为级：模拟一条只含 20cm 涨停的K线，看新/旧口径各认出几个涨停日
  const rows = [
    { date: 'd1', pct: 0.5, close: 10, volume: 1000, high: 10.1 },
    { date: 'd2', pct: 20.0, close: 12, volume: 2000, high: 12 },   // 创业板涨停
    { date: 'd3', pct: 20.0, close: 14.4, volume: 2500, high: 14.4 }, // 连板
    { date: 'd4', pct: 1.0, close: 14.54, volume: 1200, high: 14.6 },
  ];
  const code = '300750', name = '宁德时代';
  const oldCount = rows.filter(r => (r.pct || 0) >= 9.8).length;
  const newCount = rows.filter(r => A.isLimitUp(code, name, r.pct)).length;
  ok('旧口径(pct>=9.8) 认出的涨停日', oldCount === 2, String(oldCount));
  ok('新口径(isLimitUp) 认出的涨停日', newCount === 2, String(newCount));

  // 主板 ST：2026-04 沪深规则修订后风险警示板与主板同限幅 ±10%（bug③）。
  //   封板判定与主板完全一致（9.7% 起），旧的「ST 只要 5%」口径整套作废。
  const stRows = [
    { date: 'd1', pct: 10.0, close: 5.5, volume: 1000, high: 5.5 },   // ST 封板 10%
    { date: 'd2', pct: 5.0, close: 5.25, volume: 1000, high: 5.25 },  // ST 涨 5%：旧口径会误判
  ];
  const newSt = stRows.filter(r => A.isLimitUp('600122', '*ST中珠', r.pct)).length;
  ok('主板ST 10% 封板判涨停、5% 不判（与主板同限幅）', newSt === 1, `new=${newSt}`);
  console.log('  ℹ️ ST 限幅并回主板后，「ST 涨停旧门槛看不见」的差异源只剩 20cm/30cm 板块票（bug② 本体）');
}

console.log('\n⑤ 全项目硬编码涨停阈值必须清零（源码级扫描）');
{
  const fs = require('fs');
  // 只扫产品代码，诊断脚本(_probe_*)与测试文件不算
  const files = ['server.js', 'analysis.js', 'holdings.js', 'nextplan.js'];
  // ⚠️ 必须剥掉注释再扫：否则把自己写的「以前写死 pct >= 9.7」这句说明也判成违规，
  //    那就变成了一个永远报错、逼人删注释的坏扫描器。
  // ⚠️ 且只能用 indexOf 切片，不能用 replace(/\/\/.*$/,'')：
  //    JS 正则里【\r 也是行终止符】→ CRLF 文件中 `.*` 走不到行尾、`$` 又锚不上，
  //    整条 replace 会【静默失效】（holdings.js 是 CRLF，实测踩到）。
  const PAT = /(pct|\.pct|dp)\s*>=\s*9\.[0-9]/;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const bad = [];
    src.split('\n').forEach((line, i) => {
      const idx = String(line).indexOf('//');
      const codeLine = idx >= 0 ? String(line).slice(0, idx) : String(line);   // 去行注释
      if (PAT.test(codeLine)) bad.push(`${f}:${i + 1} ${line.trim().slice(0, 70)}`);
    });
    ok(`${f} 内没有写死的 9.x 涨停阈值`, bad.length === 0, bad.join(' | '));
  }
  // 行为级：20cm 票涨 15% 不应被误判封板（模拟盘必须买得到）
  ok('server 封板拦截：创业板涨15%不算封板（否则会系统性漏买强势票）',
    A.isLimitUp('300750', '宁德时代', 15) === false);
  ok('server 封板拦截：创业板涨20%才算封板', A.isLimitUp('300750', '宁德时代', 20) === true);
  ok('server 涨停家数：ST 10% 也计入', A.isLimitUp('600122', '*ST中珠', 10) === true);
  // holdings.js 真的用上了统一口径
  const hj = fs.readFileSync('holdings.js', 'utf8');
  ok('holdings.js 已引入统一涨停口径', /require\('\.\/analysis'\)/.test(hj) && /A\.isLimitUp\(/.test(hj));
  const badTxt = hj.split('\n').filter(l => {
    const i = String(l).indexOf('//');
    return /≥9\.8%/.test(i >= 0 ? String(l).slice(0, i) : String(l));
  });
  ok('holdings.js 用户可见文案不再写死 9.8%', badTxt.length === 0, badTxt.join(' | '));
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
