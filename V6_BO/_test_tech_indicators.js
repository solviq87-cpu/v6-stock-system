// 锁死「经典技术指标」：KDJ / 缠论分型 / 量价形态
// 背景（2026-10-01 用户十二连问之一）：「哪些技术指标 MACD KDJ 道氏理论 缠论 量价分析你用了吗」
//   查实：改之前**只有 MACD**，KDJ / 道氏 / 缠论 / 分型 / RSI / 布林 / 试盘 全是 0 处实现。
//   这里补齐并**接进打分**，测试锁死三件事：算得对、接得上、不会炸。
//
// ⚠️ 本文件还锁一条事故回归（2026-10-01 踩）：
//   插入技术指标时漏了 `let trendScoreHint = 0;` 声明，
//   而下面所有赋值都是 `trendScoreHint = (trendScoreHint || 0) ± n` 的写法 →
//   **node --check 查不出来（纯语法检查），只有真跑才 ReferenceError**。
//   第 ⑤ 组专门锁这条：trendPoolCheck 必须能被调用而不抛异常。
const fs = require('fs'), path = require('path');
const A = require('./analysis.js');
const KLINE = path.join(__dirname, '.kline_cache');

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);
const krows = c => { try { return JSON.parse(fs.readFileSync(path.join(KLINE, c + '.json'), 'utf8')).rows; } catch { return null; } };

// 造 K 线：close/high/low 都取 p（默认实心），volume 固定
function mk(ps, opt = {}) {
  return ps.map((p, i) => ({
    date: '2026-01-' + String(i + 1).padStart(2, '0'),
    open: opt.open != null ? opt.open[i] : p,
    close: p, high: opt.high != null ? opt.high[i] : p,
    low: opt.low != null ? opt.low[i] : p,
    volume: opt.vol != null ? opt.vol[i] : (opt.v || 1000),
    amount: (opt.vol != null ? opt.vol[i] : (opt.v || 1000)) * p,
    pct: i ? +(((p - ps[i - 1]) / ps[i - 1]) * 100).toFixed(2) : 0
  }));
}

sec('① KDJ(9,3,3)：公式与取值');
{
  ok(typeof A.calcKDJ === 'function', 'calcKDJ 已导出');
  ok(typeof A.calcKDJAt === 'function', 'calcKDJAt 已导出');
  ok(A.calcKDJ([]) === null, 'K线不足 → null（不返回假数据）');
  ok(A.calcKDJ(null) === null, 'null 输入 → null');

  // 一路单调上涨：RSV 恒为 100 → K、D 都奔 100，且 K 永远跑在 D 前面
  const up = mk(Array.from({ length: 31 }, (_, i) => 10 + i));
  const kd = A.calcKDJ(up);
  ok(kd != null, '单调上涨能算出 KDJ');
  ok(kd && kd.k > 80 && kd.d > 60, '单调上涨 → K、D 进入高位', kd && `K${kd.k} D${kd.d}`);
  ok(kd && kd.state === '多头', 'K>D 判为多头', kd && kd.state);
  ok(kd && kd.zone === '超买', 'K≥80 → 超买', kd && kd.zone);
  ok(kd && Math.abs(kd.j - (3 * kd.k - 2 * kd.d)) < 0.2, 'J = 3K − 2D', kd && kd.j);
  ok(kd && typeof kd.txt === 'string' && kd.txt.includes('KDJ'), 'txt 可直接用于推送文案', kd && kd.txt);

  // 一路单调下跌 → 超卖、空头
  const dn = mk(Array.from({ length: 31 }, (_, i) => 41 - i));
  const kd2 = A.calcKDJ(dn);
  ok(kd2 && kd2.k < 20, '单调下跌 → K 进入低位', kd2 && kd2.k);
  ok(kd2 && kd2.state === '空头', 'K<D 判为空头', kd2 && kd2.state);
  ok(kd2 && kd2.zone === '超卖', 'K≤20 → 超卖', kd2 && kd2.zone);

  // calcKDJAt 取值必须与末根一致（走的是同一条序列，不再是两套算法）
  const at = A.calcKDJAt(up, up.length - 1, 9);
  ok(at && Math.abs(at.k - kd.k) < 0.05, 'calcKDJAt(末根) 与 calcKDJ 一致', at && at.k.toFixed(2) + ' vs ' + kd.k);
}

sec('② KDJ：金叉/死叉与"交叉后第几天"');
{
  // 先跌 20 根（RSV≈0，K 砸到地板）再涨 4 根 → 末段必然出现一次金叉
  const ps = [];
  for (let i = 0; i < 20; i++) ps.push(100 - i);      // 100 → 81
  for (let i = 1; i <= 4; i++) ps.push(81 + i);       // 82 → 85
  const kd = A.calcKDJ(mk(ps));
  ok(kd && kd.since === '金叉', '末段识别出最近一次交叉是金叉', kd && kd.since);
  ok(kd && kd.crossAge != null && kd.crossAge <= 4, 'crossAge 是"交叉后第几天"', kd && kd.crossAge);
  ok(kd && kd.cross === '金叉', '交叉发生在 3 根内 → cross 报金叉', kd && kd.cross);
  ok(kd && kd.state === '多头', '金叉后 K>D → 多头', kd && kd.state);

  // 反过来：先涨后跌 → 最近一次是死叉
  const ps2 = [];
  for (let i = 0; i < 20; i++) ps2.push(10 + i);      // 10 → 29
  for (let i = 1; i <= 4; i++) ps2.push(29 - i);      // 28 → 25
  const kd2 = A.calcKDJ(mk(ps2));
  ok(kd2 && kd2.since === '死叉', '末段识别出最近一次交叉是死叉', kd2 && kd2.since);
  ok(kd2 && kd2.cross === '死叉', 'cross 报死叉', kd2 && kd2.cross);
  ok(kd2 && kd2.state === '空头', '死叉后 K<D → 空头', kd2 && kd2.state);

  // ⚠️ 关键语义：金叉后连涨 20 天的票，cross 应为 null（那是"状态"不是"信号"），
  //    但 since / crossAge / state 必须还在 —— 旧写法只留 cross 会把这种票判成 0 分。
  const ps3 = [];
  for (let i = 0; i < 20; i++) ps3.push(100 - i);
  for (let i = 1; i <= 20; i++) ps3.push(81 + i);     // 涨 20 天
  const kd3 = A.calcKDJ(mk(ps3));
  ok(kd3 && kd3.cross === null, '金叉后很久 → cross 为 null（不再算新信号）', kd3 && kd3.cross);
  ok(kd3 && kd3.since === '金叉', '但 since 仍记得是金叉', kd3 && kd3.since);
  ok(kd3 && kd3.crossAge > 3, 'crossAge 反映了"已经过了很多天"', kd3 && kd3.crossAge);
  ok(kd3 && kd3.state === '多头', 'state 仍为多头 → 打分不会漏掉它', kd3 && kd3.state);
  ok(kd3 && kd3.txt.includes('金叉后'), '文案报"金叉后N天"而不是空白', kd3 && kd3.txt);
}

sec('③ 缠论分型：顶分型 / 底分型');
{
  ok(typeof A.findFenxing === 'function', 'findFenxing 已导出');
  ok(A.findFenxing([]) === null, 'K线不足 → null');

  // V 形：最深处是底分型
  const v = A.findFenxing(mk([10, 9, 8, 7, 6, 7, 8, 9, 10]));
  ok(v && v.last === '底分型', 'V形底部判为底分型', v && v.last);
  ok(v && v.lastPrice === 6, '底分型取的是最低点', v && v.lastPrice);
  ok(v && v.above === true, '现价在底分型上方 → 支撑成立', v && v.above);
  ok(v && v.txt.includes('底分型'), '文案含底分型', v && v.txt);

  // ∧ 形：最高处是顶分型
  const a = A.findFenxing(mk([10, 11, 12, 13, 14, 13, 12, 11, 10]));
  ok(a && a.last === '顶分型', '∧形顶部判为顶分型', a && a.last);
  ok(a && a.lastPrice === 14, '顶分型取的是最高点', a && a.lastPrice);
  ok(a && a.above === false, '现价在顶分型下方 → 压力未破', a && a.above);

  // 一字横线：没有严格的高低点 → 不应硬凑一个分型出来
  ok(A.findFenxing(mk([5, 5, 5, 5, 5, 5, 5, 5, 5])) === null, '全平 → 无分型（不造假）');

  // 多个分型：count 要数得出来
  const w = A.findFenxing(mk([10, 12, 10, 8, 10, 12, 10, 8, 10, 12]));
  ok(w && w.count >= 2, '多峰序列能数出多个分型', w && w.count);
}

sec('④ 量价形态：吸筹 / 试盘 / 拉升 / 放量 / 缩量整理');
{
  ok(typeof A.volPricePattern === 'function', 'volPricePattern 已导出');
  ok(A.volPricePattern([]) === null, 'K线不足 → null');

  const base = Array.from({ length: 19 }, (_, i) => 10 + i * 0.02); // 19 根缓慢上行，重心上移
  const last = base[base.length - 1];

  // 试盘：放量 + 长上影冲高回落
  const sp = A.volPricePattern(mk([...base, 10.42], {
    open: [...base, 10.36], high: [...base, 11.0], low: [...base, 10.3],
    vol: [...Array(19).fill(1000), 2000]
  }));
  ok(sp && sp.kind === '试盘', '放量长上影 → 试盘', sp && sp.kind);
  ok(sp && sp.upShadow >= 2, '试盘的上影线占比被算出来', sp && sp.upShadow);
  ok(sp && sp.why.includes('试探'), '试盘给出可读原因', sp && sp.why);

  // 拉升：放量 + 重心上移 + 收在当日上半区
  const ls = A.volPricePattern(mk([...base, 10.60], {
    open: [...base, 10.38], high: [...base, 10.62], low: [...base, 10.36],
    vol: [...Array(19).fill(1000), 1500]
  }));
  ok(ls && ls.kind === '拉升', '放量+重心上移+收上半区 → 拉升', ls && ls.kind);
  ok(ls && ls.cgUp === true, '重心上移被识别', ls && ls.cgUp);

  // 吸筹：缩量但重心仍在抬升
  const xc = A.volPricePattern(mk([...base, 10.60], {
    open: [...base, 10.38], high: [...base, 10.62], low: [...base, 10.36],
    vol: [...Array(19).fill(1000), 800]
  }));
  ok(xc && xc.kind === '吸筹', '缩量而重心仍抬升 → 吸筹', xc && xc.kind);
  ok(xc && xc.vr < 0.9, '吸筹是缩量（vr<0.9）', xc && xc.vr);

  // 缩量整理：量能持平、重心也没明显上移
  const flat = Array.from({ length: 19 }, () => 10);
  const zl = A.volPricePattern(mk([...flat, 10.0], {
    open: [...flat, 10.0], high: [...flat, 10.05], low: [...flat, 9.95],
    vol: [...Array(19).fill(1000), 1000]
  }));
  ok(zl && ['缩量整理', '放量'].includes(zl.kind), '横盘等量 → 缩量整理/放量之一', zl && zl.kind);

  // 放量但重心没抬（滞涨）→ 只是"放量"，不该吹成拉升
  const fl = A.volPricePattern(mk([...flat, 10.0], {
    open: [...flat, 10.0], high: [...flat, 10.05], low: [...flat, 9.95],
    vol: [...Array(19).fill(1000), 1400]
  }));
  ok(fl && fl.kind === '放量' && fl.kind !== '拉升', '放量滞涨只算放量，不算拉升', fl && fl.kind);

  // it2 回归（2026-10-19）：当日 volume=0（同花顺延迟把「缺成交」冒充 0）但 close 正常 →
  //   必须判不出（null），绝不能把「没数据」误判成「缩量/吸筹」污染打分。
  const dirty = A.volPricePattern(mk([...base, 10.60], {
    open: [...base, 10.38], high: [...base, 10.62], low: [...base, 10.36],
    vol: [...Array(19).fill(1000), 0]
  }));
  ok(dirty === null, '当日量=0 但价正常 → null（缺量不误判缩量/吸筹）', dirty && dirty.kind);
}

sec('⑤ 接进 trendPoolCheck：字段、打分、不抛异常');
{
  const rows = krows('002913') || mk(Array.from({ length: 60 }, (_, i) => 20 + i * 0.3));
  const price = rows[rows.length - 1].close;
  // ⚠️ floatCap 单位是【元】不是亿（analysis 里 capYi = floatCap/1e8）——传错会静默判死
  const CAP = 60e8;
  // ⚠️ 事故回归：这一行以前会 ReferenceError: trendScoreHint is not defined
  let t = null, err = null;
  try {
    t = A.trendPoolCheck({ rows, fundDays: [{ main: 1e6 }, { main: 1e6 }, { main: 1e6 }], price, mainInflow: 1e6, thsNetAmt: null, floatCap: CAP });
  } catch (e) { err = e; }
  ok(err === null, 'trendPoolCheck 调用不抛异常（trendScoreHint 已声明）', err ? err.message : 'ok');
  ok(t != null, '返回非 null');

  if (t) {
    ok(t.capOk !== false, '流通市值 60 亿判为合格（capOk 单位没搞错）', `capYi=${t.capYi} capOk=${t.capOk}`);
    ok(t.kdj !== undefined, '返回 kdj 字段');
    ok(t.fenxing !== undefined, '返回 fenxing 字段');
    ok(t.volPrice !== undefined, '返回 volPrice 字段');
    ok(typeof t.trendScoreHint === 'number', '返回 trendScoreHint（可审计加了/减了多少）', t.trendScoreHint);
    ok(t.trendScore >= 0 && t.trendScore <= 100, 'trendScore 仍在 0~100 内', t.trendScore);

    // 原始分在钳位前可以越界（各项加分累加），钳位后才进 0~100 —— 断言要反映这一点
    const base = t.trendScore - t.trendScoreHint;
    ok(base >= -60 && base <= 160, '未加技术指标修正的原始分在合理区间（钳位前允许越界）', Math.round(base));
    ok(Math.abs(t.trendScoreHint) <= 30, '技术指标修正不会把分数打飞（≤30）', t.trendScoreHint);
  }
}

sec('⑥ 真实票：四只被点名的票都要算出指标');
{
  // ⚠️ 循环里绝不能写空 catch（静默失败的老毛病）：异常打出来，否则只会看到"0 只"
  let loopErr = null;
  const run = (rows, i) => A.trendPoolCheck({
    rows: i == null ? rows : rows.slice(0, i + 1),
    fundDays: [{ main: 1e6 }, { main: 1e6 }, { main: 1e6 }],
    price: rows[i == null ? rows.length - 1 : i].close,
    mainInflow: 1e6, thsNetAmt: null, floatCap: 60e8
  });

  for (const [code, name] of [['002913', '奥士康'], ['600825', '新华传媒'], ['000678', '襄阳轴承'], ['000011', '深物业A']]) {
    const rows = krows(code);
    if (!rows || rows.length < 30) { ok(false, `${name} K线缺失`); continue; }
    let t = null;
    try { t = run(rows); } catch (e) { loopErr = e; }
    ok(t && t.kdj && typeof t.kdj.k === 'number', `${name}：KDJ 算得出`, t && t.kdj && t.kdj.txt);
    ok(t && t.fenxing && t.fenxing.last, `${name}：缠论分型算得出`, t && t.fenxing && t.fenxing.txt);
    ok(t && t.volPrice && t.volPrice.kind, `${name}：量价形态算得出`, t && t.volPrice && `${t.volPrice.kind}（${t.volPrice.why}）`);
  }
  ok(loopErr === null, '四只票全程无异常', loopErr ? loopErr.message : 'ok');

  // 奥士康：用户点名的趋势样板，回放里必须有入选日（它涨了 59.7% 而系统 0 条信号）
  const r = krows('002913');
  if (r) {
    let hit = 0, ch = {}, first = -1, firstPrice = 0;
    for (let i = 30; i < r.length; i++) {
      let tt = null;
      try { tt = run(r, i); } catch (e) { loopErr = e; break; }
      if (tt && tt.ok) { hit++; ch[tt.channel] = (ch[tt.channel] || 0) + 1; if (first < 0) { first = i; firstPrice = r[i].close; } }
    }
    ok(loopErr === null, '奥士康回放无异常', loopErr ? loopErr.message : 'ok');
    ok(hit > 0, '奥士康在回放里有入选日（趋势票不该 0 条信号）', `${hit} 天 / ${JSON.stringify(ch)}`);
    if (hit > 0) console.log(`     ↳ 最早入选 ${r[first].date} 价 ${firstPrice} → 末日 ${r[r.length - 1].close}`);
  }
}

sec('⑦ 源码接线：指标必须真的被用，不是摆设');
{
  const SRC = fs.readFileSync(path.join(__dirname, 'analysis.js'), 'utf8');
  const code = SRC.slice(SRC.indexOf('function trendPoolCheck'), SRC.indexOf('// ---------- 大单性质判别'));
  ok(/const kdj = calcKDJ\(rows\)/.test(code), 'trendPoolCheck 里真的调了 calcKDJ');
  ok(/const fx = findFenxing\(rows\)/.test(code), 'trendPoolCheck 里真的调了 findFenxing');
  ok(/const vp = volPricePattern\(rows\)/.test(code), 'trendPoolCheck 里真的调了 volPricePattern');
  ok(/trendScoreHint = \(trendScoreHint \|\| 0\)/.test(code), '技术指标参与打分（hint 累加）');
  ok(/let trendScoreHint = 0;/.test(code), '⚠️ trendScoreHint 已声明（漏了会 ReferenceError）');
  ok(/trendScore \+ \(trendScoreHint \|\| 0\)/.test(code), 'hint 真的并入 trendScore');
  const mod = SRC.slice(SRC.lastIndexOf('module.exports'));
  for (const fn of ['calcKDJ', 'findFenxing', 'volPricePattern'])
    ok(new RegExp('\\b' + fn + '\\b').test(mod), `${fn} 已导出`);
}

console.log(`\n${fail === 0 ? '🎉' : '💥'} 技术指标测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
