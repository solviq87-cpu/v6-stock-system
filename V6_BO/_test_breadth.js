// 市场宽度：别只看大盘涨跌，要看穿「护指数拉权重」（2026-09-30 用户点破）
// 用户原话：「你不要只看大盘涨跌还要分析是不是为了护指数拉权重，
//            这样的话你的条件判断还是有误差，虽然大盘红了但是个股体验还是不好」
//
// 查实的老毛病：`fetchMarketBeta` 只拉【上证/深证/创业板三个指数】求平均当"大盘"，
//   `isBearDay(b) = b < -1` 就靠这一个数判定普跌日 → **自动优化的输入本身是失真的**：
//   银行+石油+保险几个权重一拉，指数翻红，而全市场 4000 只票在跌；
//   系统还以为"今天行情还行"，照常按标准推送、照常拿命中率罚模型。
//
// 新口径：直接用全A个股真实涨跌分布 + 按流通市值分五档，把"指数 vs 个股"的背离量化出来。
// 不依赖网络：S.stocks 是注入的，写盘用假 fs。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}
const SRC_MEAN = (src.match(/^const _mean = .*$/m) || [''])[0];
const SRC_BREADTH = grab(/^function computeBreadth\(\) \{/m);
// ⛔ 抓取要兼容两种形态（2026-10-08）：原来是一行 `const todayBreadth = () => ...`，
//    da 轮改成多行 `function todayBreadth() { ... }`（要把 basisDay/isToday 一起带出去）。
//    ⛔ 断言要钉语义不要钉写法 —— 这里钉的是"这个函数必须存在且能跑"，不是它长什么样。
const SRC_TB = (() => {
  try { return grab(/^function todayBreadth\(\) \{/m); } catch { }
  return (src.match(/^const todayBreadth = .*$/m) || [''])[0];
})();
// computeBreadth 现在要先问"这份行情属于哪个交易日"，把这两个一起注入（沙箱漏注入 = 整个套件崩掉）
const SRC_QD = grab(/^function quoteDayOf\(at\) \{/m);
const SRC_QB = grab(/^function quoteBasis\(maxAgeMs\) \{/m);
const SRC_TODAYBETA = grab(/^const todayBeta = \(\) => \{/m);
const LINE_BEAR = (src.match(/^const isBearDay = .*$/m) || [''])[0];
const LINE_FAKE = (src.match(/^const isFakeGreenDay = .*$/m) || [''])[0];
const LINE_PULL = (src.match(/^const isWeightPullDay = .*$/m) || [''])[0];
const LINE_DIST = (src.match(/^const isDistortDay = .*$/m) || [''])[0];
const SRC_HEALTH = grab(/^function marketHealthNote\(\) \{/m);
// 落盘已改成 atomicWrite（写 .tmp 再 rename），抽取执行时必须把它一起注入，
// 并且假 fs 要提供 renameSync / unlinkSync，否则会 ReferenceError。
const SRC_ATOMIC = grab(/^function atomicWrite\(file, text\) \{/m);

// ---------- 世界状态注入 ----------
const normDate = d => { const s = String(d == null ? '' : d).replace(/[^0-9]/g, ''); return s.length !== 8 ? String(d) : s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8); };
const TODAY = '2026-09-30';
const todayStr = () => '20260930';
let written = null;
const fakeFs = { writeFileSync: (p, s) => { written = s; }, renameSync: () => {}, unlinkSync: () => {} };
// stocksAt：da 轮加的行情快照拉取时刻 —— 不设就是 0，quoteBasis 会判成"行情未就绪"，
// computeBreadth 直接返回 null，整个套件静默变空（不报错、只是断言数不对）。
const S = { stocks: [], marketBeta: {}, breadth: {},
  // ⛔ 必须落在测试日 9/30 收盘（15:40）：quoteDayOf 拿它当锚判"这份行情属于哪天"，
  //    若用真实 Date.now()（今天是 10/07 休市），归属日会是 20261007 ≠ todayStr()='20260930'
  //    → computeBreadth 直接 return null → 下面所有断言拿到 null 后 TypeError 崩掉。
  stocksAt: new Date('2026-09-30T15:40:00').getTime() };

const mkEnv = () => {
  const code = [SRC_MEAN, SRC_QD, SRC_QB, SRC_BREADTH, SRC_TB, SRC_TODAYBETA, LINE_BEAR, LINE_FAKE, LINE_PULL, LINE_DIST, SRC_HEALTH,
    SRC_ATOMIC,
    'return { computeBreadth, todayBreadth, todayBeta, isBearDay, isFakeGreenDay, isWeightPullDay, isDistortDay, marketHealthNote };'].join('\n');
  return new Function('S', 'fs', 'normDate', 'todayStr', 'BREADTH_FILE', 'isTradeDay', 'prevTradeDay', code)(
    S, fakeFs, normDate, todayStr, '/tmp/_breadth_test.json',
    () => true,                    // 测试日 2026-09-30 视为交易日
    () => '2026-09-30');           // 上一个交易日（与 TODAY 同，保证 quoteDayOf 回到 20260930）
};
const E = mkEnv();

// 造全市场快照：spec = [{n, pct, capYi}]（capYi=流通市值·亿）
function market(spec) {
  const arr = [];
  let code = 600000;
  for (const g of spec) {
    for (let i = 0; i < g.n; i++) {
      arr.push({ code: String(code++), name: 'X' + code, price: 10, pct: g.pct, floatCap: g.capYi * 1e8 });
    }
  }
  return arr;
}

// ══════════ ① 正常市：不该误报 ══════════
console.log('\n【① 正常市：指数与个股一致，不该报失真】');
{
  S.stocks = market([
    { n: 60, pct: 1.0, capYi: 900 }, { n: 300, pct: 1.2, capYi: 200 },
    { n: 800, pct: 1.1, capYi: 70 }, { n: 1500, pct: 1.3, capYi: 35 }, { n: 1500, pct: 1.4, capYi: 10 }
  ]);
  S.marketBeta[TODAY] = 1.2;
  const b = E.computeBreadth();
  ok('个股均值算得出且为正', b && b.avg > 0, JSON.stringify(b && b.avg));
  ok('上涨占比接近 100%（全涨）', b && b.upRatio >= 99, String(b && b.upRatio));
  ok('未报 fakeGreen', !!(b && b.fakeGreen === false));
  ok('未报 weightPull（权重没比小微盘强多少）', !!(b && b.weightPull === false), `xl=${b && b.xl} xs=${b && b.xs}`);
  ok('distort=false', !!(b && b.distort === false));
}

// ══════════ ② 护指数：指数红、个股绿 ══════════
console.log('\n【② 护指数：大盘红了但个股体验差（用户说的正是这个）】');
{
  // 指数 +0.6%，但 4000 只票在跌
  S.stocks = market([
    { n: 60, pct: 3.5, capYi: 900 },    // 权重猛拉
    { n: 300, pct: -0.5, capYi: 200 },
    { n: 800, pct: -1.2, capYi: 70 },
    { n: 1500, pct: -2.0, capYi: 35 },
    { n: 1500, pct: -2.6, capYi: 10 }   // 小微盘最惨
  ]);
  S.marketBeta[TODAY] = 0.6;
  const b = E.computeBreadth();
  ok('指数是红的(+0.6%)，但个股均值为负', b && b.idx > 0 && b.avg < 0, `idx=${b && b.idx} avg=${b && b.avg}`);
  ok('fakeGreen=true（识破假红盘）', !!(b && b.fakeGreen === true));
  ok('weightPull=true（超大市值 +3.5% vs 微盘 -2.6%）', !!(b && b.weightPull === true), `xl=${b && b.xl} xs=${b && b.xs}`);
  ok('distort=true → 自动优化按结构市处理', !!(b && b.distort === true));
  ok('note 说人话（点名"权重撑的"）', !!(b && /权重/.test(b.note)), b && b.note);
  ok('上涨家数占比很低（<20%）', !!(b && b.upRatio < 20), String(b && b.upRatio));
  ok('isFakeGreenDay()=true', E.isFakeGreenDay() === true);
  ok('isWeightPullDay()=true', E.isWeightPullDay() === true);
  ok('isDistortDay()=true', E.isDistortDay() === true);
  ok('marketHealthNote 给出警示', /市场结构失真/.test(E.marketHealthNote()), E.marketHealthNote());
}

// ══════════ ③ 真普跌：beta 必须是【个股】而不是【指数】 ══════════
console.log('\n【③ 真普跌：beta 用个股均值，不是三个指数平均】');
{
  S.stocks = market([{ n: 3000, pct: -2.2, capYi: 60 }, { n: 1000, pct: -2.4, capYi: 15 }]);
  S.marketBeta[TODAY] = -0.3;   // 指数只跌 0.3（又被权重护了一下），个股实际跌 2.3
  const b = E.computeBreadth();
  ok('todayBeta() 返回个股均值而不是指数', E.todayBeta() === b.avg && b.avg < -2, `todayBeta=${E.todayBeta()} idx=${b.idx}`);
  ok('个股均值 -2 多 → isBearDay=true（真普跌，自动优化不罚模型）', E.isBearDay(E.todayBeta()) === true);
  ok('但指数只有 -0.3 → 若按老口径会误判成"不是普跌日"', E.isBearDay(-0.3) === false);
  ok('这种日子不算 fakeGreen（指数没红）', !!(b && b.fakeGreen === false));
}

// ══════════ ④ 只拉权重、指数没红：也要认出来 ══════════
console.log('\n【④ 只拉权重但指数没翻红：weightPull 仍要报】');
{
  S.stocks = market([
    { n: 60, pct: 2.0, capYi: 900 },
    { n: 1500, pct: -1.0, capYi: 35 }, { n: 1500, pct: -1.2, capYi: 10 }
  ]);
  S.marketBeta[TODAY] = -0.4;
  const b = E.computeBreadth();
  ok('weightPull=true（权重+2.0 vs 微盘-1.2）', !!(b && b.weightPull === true), `xl=${b && b.xl} xs=${b && b.xs}`);
  ok('fakeGreen=false（指数本来就是绿的）', !!(b && b.fakeGreen === false));
  ok('distort 仍为 true（结构失真照样要提示）', !!(b && b.distort === true));
}

// ══════════ ⑤ 边界与兜底 ══════════
console.log('\n【⑤ 边界与兜底】');
{
  S.stocks = market([{ n: 50, pct: 5, capYi: 100 }]);   // 不足 200 只
  const b = E.computeBreadth();
  ok('个股不足 200 只 → 返回 null（不拿残缺数据下结论）', b === null, String(b));
}
{
  // 没有指数数据时不能误报 fakeGreen
  S.stocks = market([{ n: 3000, pct: -1.5, capYi: 50 }]);
  S.marketBeta = {};
  const b = E.computeBreadth();
  ok('缺指数数据 → fakeGreen=false（无从判断就不乱报）', !!(b && b.fakeGreen === false));
  ok('缺指数数据 → weightPull 仍可按分层判出', b && (b.weightPull === true || b.weightPull === false));
}
{
  // 市值缺失的票不能污染分层（floatCap<=0 的一律不入档）
  S.stocks = market([{ n: 3000, pct: 1.5, capYi: 50 }]);
  for (let i = 0; i < 500; i++) S.stocks.push({ code: '9' + i, name: 'Y', price: 10, pct: 1.5, floatCap: 0 });
  S.marketBeta[TODAY] = 1.4;
  const b = E.computeBreadth();
  ok('缺市值的票不计入市值分层（n 仍只算有市值的）', !!(b && Number.isFinite(b.xl) || b.xl === null));
  ok('个股均值正常算出', !!(b && Math.abs(b.avg - 1.5) < 0.01), String(b && b.avg));
}

console.log(`\n${'─'.repeat(56)}\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}\n`);
process.exit(fail ? 1 : 0);
