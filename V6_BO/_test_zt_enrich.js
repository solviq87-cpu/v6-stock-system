// 锁死「涨停池补漏」deriveLimitUpMissed（2026-10-19 iv 轮）。
// 背景：用户「同花顺显示49只涨停，请查缺补漏」。涨停池两源（东财 getTopicZTPool 主源 /
//   同花顺 limit_up_pool 兜底 filter=HS,GEM2STAR）都漏票 —— 10-19 实测新浪全A精确涨停价口径
//   49 只收盘封板，系统只有 46，漏 3 只：603337 杰克科技（主板10%普通票）+600370 *ST三房
//   （主板ST 10%，2026-04 起与主板同限幅）+688121 *ST卓然（科创板ST 20%）。
// 铁律：严口径 —— 收盘价必须【等于】涨停价 round(前收×(1+限幅/100),2) 才算封板，
//   不用宽口径 pct≥限幅-0.3（会把「触板后收在板下1分钱」误报封板）；新股无限制期跳过。
const fs = require('fs');
const A = require('./analysis.js');

// 从 server.js 抠出 deriveLimitUpMissed 函数体，用 new Function 真跑（与生产同一份源码）
const src = fs.readFileSync(__dirname + '/server.js', 'utf8');
const m = src.match(/function deriveLimitUpMissed\(stocks, pool\) \{[\s\S]*?\n\}/);
if (!m) { console.log('❌ deriveLimitUpMissed 函数体未找到'); process.exit(1); }
const fn = new Function('A', `return (${m[0]});`)(A);

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);

// 造股票快照项
function st(code, name, preClose, price, pct) {
  return { code, name, preClose, price, pct: pct != null ? pct : +((price / preClose - 1) * 100).toFixed(2), amount: 1e8, floatCap: 5e9, turnover: 2 };
}

sec('① 主板 10% 涨停补漏（杰克科技 603337）');
{
  const out = fn([st('603337', '杰克科技', 31.33, 34.46)], []);
  ok(out.length === 1 && out[0].code === '603337' && out[0].src === 'derive', '主板10%封板 → 补漏', JSON.stringify(out[0] && out[0].code));
}

sec('② ST / 科创板 ST / 北交所 各限幅补漏');
{
  const stocks = [
    st('600370', '*ST三房', 1.39, 1.53),      // 主板ST 10%（与主板同限幅）：1.39×1.10=1.529→1.53 封板
    st('688121', '*ST卓然', 0.81, 0.97),      // 科创板ST 20%：0.81×1.2=0.972→0.97 封板
    st('920000', '北交所X', 10, 13),          // 北交所 30%：10×1.3=13 封板
  ];
  const out = fn(stocks, []);
  const codes = out.map(x => x.code).sort();
  ok(codes.length === 3 && codes.join(',') === '600370,688121,920000', '10%/20%/30% 三档封板都补', codes.join(''));
  ok(out.every(x => x.limitUpCount === null && x.sealAmount === null && x.breakCount === null && x.firstSeal === null), '未知字段显式 null 不拿 0 冒充');
}

sec('③ 非封板 / 触板未封 不误报');
{
  const stocks = [
    st('000001', '普通涨9.5%', 10, 10.95),     // 9.5% 未涨停
    st('000002', '触板收在板下1分', 10, 10.99), // 涨停价 11.00，收 10.99 → 不封板（严口径）
    st('000003', '涨停价但差1分', 10, 11.01),   // 略高于涨停价（数据抖动）→ 不封板
  ];
  const out = fn(stocks, []);
  ok(out.length === 0, '9.5% / 板下1分 / 板上1分 都不误报封板', out.length);
}

sec('④ 已在池中不重复补');
{
  const pool = [{ code: '603337', name: '杰克科技' }];
  const out = fn([st('603337', '杰克科技', 31.33, 34.46)], pool);
  ok(out.length === 0, '池中已有的封板票不重复补');
}

sec('⑤ 空快照 / 缺 preClose 不崩');
{
  ok(fn([], []).length === 0, '空 stocks → []');
  ok(fn([{ code: '000001', name: 'X', preClose: 0, price: 10 }], []).length === 0, 'preClose<=0 → 跳过');
  ok(fn([{ code: '000001', name: 'X', preClose: 10, price: 0 }], []).length === 0, 'price<=0 → 跳过');
}

sec('⑥ 新股无涨跌幅限制期跳过');
{
  // 注入 noLimit 钩子：000009 上市未满 8 自然日 → 涨 30% 也不是封板
  A.setNoLimitFn(code => code === '000009');
  const out = fn([st('000009', 'N新股', 10, 13)], []);
  ok(out.length === 0, '新股无限制期（涨30%）→ 不判封板', out.length);
  A.setNoLimitFn(null);  // 还原，避免污染其它套件
}

sec('⑦ 低开拉板标注（openPct/lowOpen，快照层启发式）');
{
  const jk = st('603337', '杰克科技', 31.33, 34.46); jk.open = 31.14;
  const out = fn([jk], []);
  ok(out.length === 1 && out[0].lowOpen === true && out[0].openPct === -0.61, '低开-0.6%封板 → lowOpen=true/openPct=-0.61', JSON.stringify(out[0] && { o: out[0].openPct, l: out[0].lowOpen }));
  const hi = st('600001', '甲股份', 10, 11); hi.open = 10.9;
  const out2 = fn([hi], []);
  ok(out2.length === 1 && out2[0].lowOpen === false && out2[0].openPct === 9, '高开+9%封板 → lowOpen=false', JSON.stringify(out2[0] && { o: out2[0].openPct, l: out2[0].lowOpen }));
  const noOpen = fn([st('600002', '乙股份', 10, 11)], []);
  ok(noOpen.length === 1 && noOpen[0].openPct === null && noOpen[0].lowOpen === false, '无 open 字段 → openPct=null/lowOpen=false（缺数据≠0）', JSON.stringify(noOpen[0] && { o: noOpen[0].openPct }));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
