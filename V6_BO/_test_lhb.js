'use strict';
// 龙虎榜（⑫ 大游资）+ 涨停原因 单测
// 背景：用户 2026-10-01 问「同花顺没有数据吗」→ 逐条 curl 实测后确认：
//   同花顺【没有】龙虎榜（/dataapi/lhb/* 全 404），东财有；同花顺只有涨停池带 reason_type。
// 修掉的三个真 bug 必须在这里锁死，否则会静默回归：
//   ① 席位名与金额来自不同席位（拿"命中席位的名"配"买一的额"）
//   ② 净买 -1.08 亿也被判成游资（买入席位净额必须为正）
//   ③ "上海分公司"这类宽泛词把中金/中信的机构席位误判成游资
// 另：东财拉萨系是散户聚集的人气席位（实测3日上涨概率仅31~42%），绝不能当游资采信。

const fs = require('fs');
const em = require('./em');
const MR = require('./myrules');
const SRC = fs.readFileSync('./server.js', 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };
const sec = t => console.log('\n' + t);

sec('① 游资席位判定 judgeWhale');
{
  const J = em.judgeWhale;
  // ② 净额非正必须不判（曾经 -1.08 亿被判成游资）
  ok('净买为负 → 不算游资', J({ name: '华泰证券成都蜀金路证券营业部', net: -1.08e8, prob3: 75 }).whale === false);
  ok('净买为 0 → 不算游资', J({ name: '华泰证券成都蜀金路证券营业部', net: 0, prob3: 75 }).whale === false);
  // 非营业部排除（科创板会列出"自然人/机构"，净额动辄几十亿）
  ok('“自然人”不计', J({ name: '自然人', net: 75e8, prob3: 60 }).whale === false);
  ok('“沪股通专用”不计', J({ name: '沪股通专用', net: 9e8, prob3: 60 }).whale === false);
  ok('“机构”不计', J({ name: '机构', net: 40e8, prob3: 60 }).whale === false);
  // 拉萨 = 人气席位，不是游资（实测 3 日上涨概率 31~42%）
  const lh = J({ name: '东方财富证券拉萨金融城南证券营业部', net: 1.97e8, prob3: 31 });
  ok('拉萨系标记为人气席位', lh.popular === true);
  ok('拉萨系不算游资', lh.whale === false, JSON.stringify(lh));
  // 知名游资席位 + 大额
  ok('知名游资席位+大额 → 算', J({ name: '华泰证券成都蜀金路证券营业部', net: 0.39e8, prob3: 75 }).whale === true);
  ok('国盛宁波桑田路+大额 → 算', J({ name: '国盛证券宁波桑田路证券营业部', net: 5e7, prob3: 50 }).whale === true);
  // 非知名席位：靠金额 + 胜率
  ok('非知名+大额+高胜率(80%) → 算', J({ name: '华金证券上海分公司', net: 0.32e8, prob3: 80 }).whale === true);
  ok('非知名+大额+低胜率(42%) → 不算', J({ name: '某某证券某某营业部', net: 2e8, prob3: 42 }).whale === false);
  // 金额不够
  ok('小额(2000万)不算', J({ name: '华泰证券成都蜀金路证券营业部', net: 2e7, prob3: 90 }).whale === false);
  // 判定理由要能说人话
  ok('非营业部给出原因', /非营业部/.test(J({ name: '自然人', net: 1e8 }).reason));
  ok('净额非正给出原因', /净额非正/.test(J({ name: '华泰证券成都蜀金路', net: -1 }).reason));
}

sec('② 席位名录不能太宽泛（③ 号 bug 防回归）');
{
  const K = em.WHALE_KEYS;
  ok('是数组且有内容', Array.isArray(K) && K.length >= 10);
  // ⚠️ 放"上海分公司/浙江互联网"会把中金/中信的机构席位全判成游资 —— 机构≠游资
  const bad = K.filter(k => /分公司|营业部|证券$|公司$/.test(k));
  ok('名录不含“XX分公司/XX营业部”这类宽泛词', bad.length === 0, bad.join(','));
  ok('名录用的是具体路名', K.some(k => /路$/.test(k)));
}

sec('③ 聚合结果自洽：席位名/金额/胜率三者同源（① 号 bug 防回归）');
{
  // 手工模拟 fetchLhb 的聚合输出：买一是机构（大额低胜率），第二个才是真游资
  const depts = [
    { name: '高盛(中国)证券上海分公司', net: 1.13e8, prob3: 42 },
    { name: '华泰证券成都蜀金路证券营业部', net: 0.39e8, prob3: 75 },
  ];
  let hit = null;
  for (const d of depts) { const j = em.judgeWhale(d); d.judge = j; if (j.whale && !hit) hit = d; }
  ok('买一(机构)不被采信', em.judgeWhale(depts[0]).whale === false);
  ok('第二个(真游资)被命中', !!hit && hit.name.indexOf('蜀金路') >= 0);
  const money = x => (x / 1e8).toFixed(2) + '亿';
  const why = '龙虎榜「' + hit.name.slice(0, 18) + '」净买 ' + money(hit.net) + '，该席位3日上涨概率 ' + Math.round(hit.prob3) + '%';
  ok('why 里的金额取自命中席位本身(0.39亿，不是买一的1.13亿)', /\(0\.39|0\.39亿/.test(why), why);
  ok('why 不出现买一的金额', why.indexOf('1.13亿') < 0, why);
  ok('why 里的胜率取自命中席位(75%)', /75%/.test(why), why);
}

sec('④ ⑫ 在十四条里的三态：有游资=通过 / 无游资=不通过 / 没数据=unknown');
{
  const rows = [];
  for (let i = 0; i < 65; i++) rows.push({ date: 'd' + i, open: 10, close: 10, high: 10.2, low: 9.8, volume: 1e5, amount: 1e6, pct: 0 });
  const base = {
    stock: { code: '300001', name: '测试票', price: 10, pct: 3, floatCap: 70, amount: 5e8, sealAmount: 0, limitUpCount: 0, breakCount: 0 },
    rows, sector: null, auction: null, profitRatio: 50,
  };
  const item = o => {
    const r = MR.evaluateOne(o, {});
    return (r.items || []).find(x => x.i === 12);
  };
  const a = item(Object.assign({}, base, { lhb: { whale: true, whaleNet: 0.39e8, netBuy: 0.4e8, why: '龙虎榜「华泰成都蜀金路」净买 0.39亿' } }));
  ok('有游资 → 第⑫条通过', a && a.ok === true && !a.unknown, JSON.stringify(a));
  ok('通过时带上依据', /龙虎榜/.test(a.note), a && a.note);

  const b = item(Object.assign({}, base, { lhb: { whale: false, netBuy: 0.57e8, why: '龙虎榜无游资席位（买一 中信西安朱雀大街 净买 0.57亿）' } }));
  ok('无游资 → 第⑫条不通过（不是 unknown）', b && b.ok === false && !b.unknown, JSON.stringify(b));
  ok('不通过时也说明原因', /无游资|人气席位/.test(b.note), b && b.note);

  const c = item(base);
  ok('缺龙虎榜 → unknown（不是"不满足"）', c && c.unknown === true, JSON.stringify(c));
  ok('unknown 说明是数据缺失', /缺龙虎榜/.test(c.note), c && c.note);
}

sec('⑤ server.js 接线（不接上等于没做）');
{
  ok('em 导出 fetchLhb', typeof em.fetchLhb === 'function');
  ok('em 导出 fetchZtReason', typeof em.fetchZtReason === 'function');
  ok('em 导出 judgeWhale', typeof em.judgeWhale === 'function');
  ok('computeMyRules 真的拉了龙虎榜', /await lhbMapCached\(\)/.test(SRC));
  ok('龙虎榜传给 evaluateOne', /lhb: lhbMap\.get\(c\.code\)/.test(SRC));
  ok('有 lhbMapCached 且带缓存', /async function lhbMapCached/.test(SRC) && /30 \* 60 \* 1000/.test(SRC));
  ok('18点前回退上一交易日', /LHB_PUBLISH_HOUR/.test(SRC) && /length - 2\]/.test(SRC));
  ok('涨停原因注入到 ztPool', /z\.reason = r\.reason/.test(SRC));
  ok('复盘首行带涨停题材', /【涨停题材】/.test(SRC));
  ok('题材只列 ≥2 只的', /x\[1\] >= 2/.test(SRC));
  ok('S 里初始化 ztTopics', /ztTopics: *\[\]/.test(SRC));
  // ⚠️ 踩过一次：server.js 有两处 state 构造（一处精简统计、一处完整），
  //    前端读的是【完整】那份（ztPool: S.ztPool 是数组的那处）。加在精简版里不报错、
  //    线上也不报错，只是前端永远拿到 undefined —— 这种"静默不生效"必须靠断言锁死。
  const iFull = SRC.indexOf('ztPool: S.ztPool,');
  const iMini = SRC.indexOf('ztPool: (S.ztPool || []).length,');
  ok('存在两处 state 构造（精简版+完整版）', iFull > 0 && iMini > 0);
  // ⛔ 不许按固定字符窗口取（de 轮踩到两次：往 ztDay 后面插两行就把 ztTopics 挤出窗口 → 假红；
  //    剥注释版把注释换成等长空格，窗口照样不够）。改成按**行**判归属：
  //    ztTopics 那一行必须落在「数组版 ztPool」之后、且在「length 版 ztPool」之前。
  const NL = SRC.split('\n');
  const iFullLine = NL.findIndex(l => /ztPool: S\.ztPool,/.test(l));
  const iMiniLine = NL.findIndex(l => /ztPool: \(S\.ztPool \|\| \[\]\)\.length,/.test(l));
  // ⛔ 从完整版那行之后开始找 —— S 的初始化里也有一个 `ztTopics: []`，会先被命中（实测 L59）
  const iZtLine = NL.findIndex((l, i) => i > iFullLine && /ztTopics:/.test(l));
  ok('[自检] 三行都定位到', iFullLine > 0 && iMiniLine > 0 && iZtLine > 0,
    iFullLine + '/' + iMiniLine + '/' + iZtLine);
  ok('ztTopics 暴露在【完整版】state（前端读的那份）',
    iZtLine > iFullLine && (iMiniLine < iFullLine || iZtLine < iMiniLine),
    `ztTopics L${iZtLine + 1} · 完整版 L${iFullLine + 1} · 精简版 L${iMiniLine + 1}`);
}

sec('⑦ 日期必须按【数据真实日】取，不能用机器日期（线上 0/52 事故防回归）');
{
  // ⚠️ 事故：10/1 国庆凌晨上线后题材恒为 0/52，而涨停池有 52 只 ——
  //    因为用了 lastTradeDay()（机器日期，只跳周末不跳节假日）给出 20261001，
  //    同花顺那天根本没有涨停池。必须用 dataTradeDay()（探测真实数据日）+ 逐级回退。
  const iFn = SRC.indexOf('async function ztReasonCached');
  const seg = SRC.slice(iFn, iFn + 1200);
  ok('用 dataTradeDay 而不是 lastTradeDay 取基准日', /await dataTradeDay\(\)/.test(seg), seg.slice(0, 200));
  ok('lastTradeDay 只作兜底', /base \|\| lastTradeDay\(\)/.test(seg));
  ok('有逐级回退（最多5天）', /back < 5/.test(seg));
  ok('有 shiftDate 工具', /function shiftDate/.test(SRC));
  // 回退函数本身要正确（跨月是易错点）
  // ⚠️ 'use strict' 下 eval 的函数声明不会泄漏到外层作用域，得显式取回函数对象
  const m = /function shiftDate\(yyyymmdd, n\) \{[\s\S]*?\n\}/.exec(SRC);
  const shiftDate = eval('(' + m[0].replace('function shiftDate', 'function') + ')');
  ok('跨月回退正确 20260301-1天 = 20260228', shiftDate('20260301', -1) === '20260228', shiftDate('20260301', -1));
  ok('20261001-1天 = 20260930', shiftDate('20261001', -1) === '20260930', shiftDate('20261001', -1));
  ok('-0 天保持原样', shiftDate('20260930', 0) === '20260930');
}

sec('⑧ 题材双源：同花顺不可达时必须退回东财，不能留空');
{
  // 线上沙箱访问 data.10jqka.com.cn 可能不通（与"线上拉不到快讯源"同源），
  // 实测题材恒为 0/52 而涨停池满员 → 宁可退回东财口径，也不能显示"未取到"。
  ok('有 thsTopics 中间变量', /let thsTopics = \[\]/.test(SRC));
  ok('同花顺为空时用 boardStat 兜底', /Object\.entries\(boardStat\)/.test(SRC));
  ok('兜底也只要 ≥2 只的题材', /v\.zt >= 2/.test(SRC));
  ok('标明题材来源', /S\.ztTopicSrc/.test(SRC));
  ok('state 暴露 ztTopicSrc', /ztTopicSrc: S\.ztTopicSrc/.test(SRC));
}

sec('⑥ 发布清单（漏了线上 MODULE_NOT_FOUND）');
{
  const py = fs.readFileSync('./_publish.py', 'utf8');
  ok('CODE_FILES 含 myrules.js', /myrules\.js/.test(py));
  ok('CODE_FILES 含 em.js', /em\.js/.test(py));
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
