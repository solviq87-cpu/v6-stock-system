// 锁死「强势趋势通道」：奥士康这类真趋势票必须选得出来，且不能把垃圾放进来
// 背景（2026-10-01 用户点名）：奥士康 002913 涨 59.7%，系统登记信号 **0 条** ——
//   不是被打分打下去的，是 gentle 的「近5日不许有一天涨超7%」+ swingDays≥4 的
//   「20日内4天涨跌超±5%」两条，把最强势的那批票全部判死。
const fs = require('fs'), path = require('path');
const A = require('./analysis.js');
const LEARNALL = require('./learnall.js');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const KLINE = path.join(__dirname, '.kline_cache');

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✅ ' + n + (got !== undefined ? '  → ' + got : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + got); } };
const sec = t => console.log('\n' + t);
const krows = c => { try { return JSON.parse(fs.readFileSync(path.join(KLINE, c + '.json'), 'utf8')).rows; } catch { return null; } };

sec('① 学习特征 v3：趋势形态必须进了模型');
{
  ok(LEARNALL.VER >= 3, 'VER 已升到 3（维度变了旧立方作废重建）', LEARNALL.VER);
  const keys = LEARNALL.DIMS.map(d => d.key);
  for (const k of ['maBull', 'ma20slope', 'dd60', 'runUp', 'volTrend', 'zt60'])
    ok(keys.includes(k), `维度 ${k} 已加入`);
  ok(LEARNALL.DIMS.length >= 17, '维度总数 ≥17', LEARNALL.DIMS.length);
  const rows = krows('002913');
  if (rows) {
    // ⛔⛔ hv+1 轮（2026-10-15）：原断言读「最新一根K线」判特征，而 .kline_cache 每日回填
    //    刷新 → 市场数据 drift 让这条随行情翻转（本次实测：10-14 奥士康回撤，最新一根
    //    maBull 从 2 翻成 1，总榜假红）。与 gn 轮③段同款修法：特征语义是【规则】，
    //    必须锚定受控历史日，不许拿实时行情当天的心情当判据。
    //    锚点取 2026-09-30（用户点名语境「8/19→9/30 +59.7%」的收官日）：
    //    该日 maBull=2 / ma20slope=10.17 / dd60=5.99 / zt60=6，四条全绿。
    //    ⛔ 锚点日不在缓存里 = 缓存与预期不符，判不出就不许冒充通过（红着让人来修）。
    const anchor = rows.findIndex(r => r.date === '2026-09-30');
    ok(anchor >= 0, '缓存含锚定日 2026-09-30（ drift 防护的地基）', anchor >= 0 ? 'idx ' + anchor : '缺失');
    if (anchor >= 0) {
      const f = LEARNALL.extractFeatures(rows, anchor, { limitPct: 10 });
      ok(f && f.maBull === 2, '奥士康：均线标准多头排列（maBull=2）', f && f.maBull);
      ok(f && f.ma20slope > 0, '奥士康：中期均线向上', f && f.ma20slope);
      ok(f && f.dd60 <= 20, '奥士康：距60日高回撤 ≤20%', f && f.dd60);
      ok(f && f.zt60 >= 1, '奥士康：60日内有涨停基因', f && f.zt60);
    }
  }
}

sec('② 奥士康回放：必须选得出来，而且要早');
{
  const rows = krows('002913');
  if (!rows) { ok(false, 'K线缓存缺失'); }
  else {
    let days = 0, firstIdx = -1, firstPrice = 0;
    for (let i = 30; i < rows.length; i++) {
      const slice = rows.slice(0, i + 1);
      const r = A.trendPoolCheck({ rows: slice, price: slice[slice.length - 1].close, floatCap: null });
      if (r && r.ok) { days++; if (firstIdx < 0) { firstIdx = i; firstPrice = slice[slice.length - 1].close; } }
    }
    ok(days > 0, '奥士康至少有一天入选（旧判据是 0 天）', `${days} 天`);
    // ⛔ 2026-10-28 改钉：原来钉死「首次入选价 < 70」—— 那是个**绝对价位**，会随缓存里
    //    多出来的行情整体抬升（实测 71.2 就假红）。通道要钉的语义是「选在起涨前，不是涨完了才认」，
    //    尺子必须相对化：首次入选价明显低于入选后的最高价（留出可兑现空间）。
    const _afterHigh0 = firstIdx >= 0 ? Math.max(...rows.slice(firstIdx + 1).map(r => +r.high || 0)) : 0;
    ok(firstIdx >= 0 && firstPrice < _afterHigh0 * 0.8,
      '首次入选时价格明显低于后续最高价（选在起涨前，不是涨完了才认出来）',
      firstIdx >= 0 ? `${rows[firstIdx].date} 价${firstPrice} vs 后续最高${_afterHigh0}` : '-');
    // 首次入选后应该还有一大段涨幅
    // ⛔ 2026-10-27：原来拿"缓存最后一天的收盘"当后续空间 —— 那是滚动窗口，行情一回调就让这条断言变红
    //    （实测 59.01 → 65.33 = +10.7%，而入选后最高到 98.18 = +66.4%）。通道判的是"能不能选在起涨前"，
    //    尺子应该是入选后的**最高价**（真实可兑现的上冲空间），不是"我今天跑测试时的收盘"。
    const last = rows[rows.length - 1].close;
    const afterHigh = firstIdx >= 0 ? Math.max(...rows.slice(firstIdx + 1).map(r => +r.high || 0)) : 0;
    ok(firstIdx >= 0 && afterHigh > firstPrice * 1.2, '首次入选后有 ≥20% 的上冲空间（按入选后最高价计）',
      firstIdx >= 0 ? `${firstPrice} → 最高${afterHigh}（末收${last}）` : '-');
  }
}

sec('③ 通道语义：温和归温和，强势归强势');
{
  const rows = krows('002913');
  // ⛔⛔ gn 轮（2026-10-13）：原断言钉的是「最新一根K线落在强势通道」—— 而 .kline_cache
  //    会被每日回填刷新（002913 现含 2026-10-12 数据，当日已跌破10日线：channel=null、
  //    strongWhy=["已跌破10日线"]），市场数据 drift 让这条断言随行情翻转（本次实测翻红）。
  //    通道语义是【规则】，必须用受控数据钉，不许拿实时行情当天的心情当判据：
  //    取回放里最后一个强势日做切片（那一天它确实是强势票），钉「强势归强势」；
  //    再构造反例（把收盘压到10日线下方）钉「该否决时必须否决并给出理由」。
  let lastStrong = -1;
  for (let i = 30; i < rows.length; i++) {
    const slice = rows.slice(0, i + 1);
    const rr = A.trendPoolCheck({ rows: slice, price: slice[slice.length - 1].close, floatCap: null });
    if (rr && rr.channel === '强势' && rr.strongOk === true) lastStrong = i;
  }
  ok(lastStrong >= 0, '奥士康历史上有强势通道日（否则通道语义无从钉起）', lastStrong >= 0 ? rows[lastStrong].date : '无');
  if (lastStrong >= 0) {
    const slice = rows.slice(0, lastStrong + 1);
    const r = A.trendPoolCheck({ rows: slice, price: slice[slice.length - 1].close, floatCap: null });
    ok(r && r.channel === '强势', '强势日 → 落在强势通道', r && r.channel);
    ok(r && r.strongOk === true, '强势日 strongOk 为真', r && r.strongOk);
    ok(r && typeof r.ma10 === 'number', '返回 ma10 供面板看位置', r && r.ma10);
    ok(r && typeof r.zt60 === 'number' && r.zt60 > 0, '返回 60 日涨停基因数', r && r.zt60);
    // 强势票不该被"上蹿下跳"误杀：20日内涨得猛不算抖动
    ok(r && r.jumpy === false, '强势通道不被振幅/摆动天数误杀（jumpy=false）', r && r.jumpy);
    // 受控反例：把最后一日收盘压到10日线下方 → 强势通道必须否决并说明理由
    // （这条与上方「强势归强势」是一对：规则两个方向都要钉，数据drift也翻不了）
    const dropped = slice.map((x, i2) => i2 === slice.length - 1 ? Object.assign({}, x, { close: r.ma10 * 0.9, pct: -9 }) : x);
    const r2 = A.trendPoolCheck({ rows: dropped, price: dropped[dropped.length - 1].close, floatCap: null });
    ok(r2 && r2.strongOk === false && (r2.strongWhy || []).length > 0,
      '受控反例：收盘跌破10日线 → 强势通道否决且给出理由', r2 && `${r2.strongOk} ${JSON.stringify(r2.strongWhy)}`);
  }
}

sec('④ 反例：该拦的必须拦住');
{
  // 4 连板以上：用户第十四条明确不要
  const mk = (n, pct) => Array.from({ length: n }, (_, i) => ({
    date: '2026-0' + (7 + Math.floor(i / 28)) + '-' + String((i % 28) + 1).padStart(2, '0'),
    open: 10, high: 10.2, low: 9.8, close: 10 + i * 0.5, volume: 1e6, amount: 1e7, pct: 1
  }));
  const rows = mk(40, 1);
  for (let i = 0; i < 5; i++) { rows[rows.length - 1 - i].pct = 10; rows[rows.length - 1 - i].close = rows[rows.length - 1 - i].close * 1.1; }
  const r = A.trendPoolCheck({ rows, price: rows[rows.length - 1].close, floatCap: null });
  ok(r && r.lb >= 4, '构造出 5 连板样本', r && r.lb);
  ok(r && r.strongOk === false, '连板≥4 → 强势通道否决（用户明确要求）', r && r.strongOk);
  // 被砸过大阴的：强势通道必须出局
  const rows2 = mk(40, 1);
  rows2[rows2.length - 5].pct = -9;
  const r2 = A.trendPoolCheck({ rows: rows2, price: rows2[rows2.length - 1].close, floatCap: null });
  ok(r2 && (r2.strongOk === false || r2.jumpy === true || r2.ok === false),
    '20日内被砸 -9% → 不该轻松入选', r2 && `strongOk=${r2.strongOk} jumpy=${r2.jumpy} ok=${r2.ok}`);
}

sec('⑤ server.js 接线（不接上等于没做）');
{
  ok(/async function scanTrendUniverse/.test(SRC), '有全市场趋势扫描函数');
  ok(/trendScan: \[\]/.test(SRC), 'S.trendScan 已初始化');
  ok(/setInterval\(guard\('trend-scan'/.test(SRC), '有定时扫描任务');
  ok(/function pushTrendScan/.test(SRC), '有扫描推送文案');
  ok(/'\/api\/trend-scan'/.test(SRC), '有手动扫描接口');
  // ⚠️ 2026-10-01 修正：真正修好的是**取值那一行** `k.name || nameOfCode(code) || code`。
  //    旧写法 `k.name || code` 在缓存 name 为空串时会把 code 当名字（真值），
  //    后面的 nameOfCode 永远轮不到 → 线上出现过「600383 600383」。
  ok(/const name = k\.name \|\| nameOfCode\(code\) \|\| code;/.test(SRC), '扫描结果补了票名（不再显示一串代码）');
  ok(!/const name = k\.name \|\| code;/.test(SRC), '已无 `k.name || code` 的空串陷阱');
  ok(/const cap = Math\.max\(1, Math\.min\(Number\(maxN\) \|\| 300, 600\)\)/.test(SRC),
    '题材缓存每轮上限已从 60 提到 300（原来跑几天才 291 只 = 5.2%）');
  ok(/v\.zt >= 2 && !tooBroad\(k\)/.test(SRC) && /thsTopics\.filter\(x => !tooBroad\(x\[0\]\)\)/.test(SRC),
    '过宽概念（央国企改革）已从题材榜剔除 —— 这条判据以前写了却从未被调用');
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
