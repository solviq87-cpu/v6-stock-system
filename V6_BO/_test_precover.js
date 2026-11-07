// 离线确定性验证：「为什么涨停前没发现」三处根因是否真的修好了
// 不依赖网络 —— 世界状态全部注入。数据基准：2026-09-28 真实复盘（33只涨停/央国企改革11只）
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// ---------- 花括号配平的函数体提取（按行抓函数会被内部 } 骗出残片，2026-09-29 踩过） ----------
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
const BK_SRC = grab(/^S\.bkOfSector = name => \{/m);
const BZ_SRC = grab(/^async function computeBuZhang\(\) \{/m);
const PRE_SRC = grab(/^async function preBreakoutInner\(\) \{/m);

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// ---------- 真实板块表 ----------
const SEC_CODES = JSON.parse(fs.readFileSync(path.join(__dirname, 'sectorCodes.json'), 'utf8'));
const REVIEW = JSON.parse(fs.readFileSync(path.join(__dirname, 'review.json'), 'utf8'));

// ---------- 构造「2026-09-28 15:42」的世界状态 ----------
// 关键：当天概念板块查不到（sec === undefined），这正是引爆旧代码的场景
function mkWorld(opts = {}) {
  return {
    secCodeMap: new Map(SEC_CODES),
    sectors: opts.sectors || [],
    bzPushed: new Map(), prePushed: new Map(), buzzhang: null, pre: null,
    ztPool: [], ztBySector: {},
    // ⛔ 必须注入：补涨龙/启动前埋伏会用 S.secStocks 做「成分名单缓存」（拉到回填、退避期回读）。
    //    每给这两个函数加一个外部依赖，就要同步补进 mkWorld —— 漏了的表现不是报错，
    //    而是 `.set` of undefined 被外层 catch 吞掉 → 产出 0 只、测试只显示"产出 0"，
    //    与真正的数据源故障完全无法区分（2026-10-06 实测踩到）。
    secStocks: new Map()
  };
}
// bkOfSector 源码里把自己挂到 S 上，注入同一份 S 即可自指
function attach(S) {
  new Function('S', `${BK_SRC}\n return S.bkOfSector;`)(S);
  return S;
}

// 央国企改革 11 只涨停（review.json 真实分组）
const YG = REVIEW.items.filter(x => x.sector === '央国企改革');
console.log(`\n【基准】2026-09-28 复盘：涨停 ${REVIEW.items.length} 只，其中「央国企改革」${YG.length} 只` +
  `（连板 ${YG.map(x => x.limitUpCount).sort((a, b) => b - a).slice(0, 3).join('/')}），首板占比 ` +
  `${Math.round(REVIEW.items.filter(x => (x.limitUpCount || 1) === 1).length / REVIEW.items.length * 100)}%\n`);

// 东财成分股样本：板块内 20 只，其中 2 只已涨停（模拟早上刚起爆那一刻），其余未启动
function boardSample(ztCodes) {
  const names = ['新兴铸管', '中成股份', '瑞泰科技', '国投中鲁', '中粮糖业', '中材节能',
    '岳阳林纸', '中储股份', '冠豪高新', '中粮资本', '中公高科', '中材国际',
    'ST易联众', '启明信息', '标准股份', '宁夏建材', '祁连山', '天山股份'];
  return names.map((n, i) => {
    const code = String(600000 + i * 17).padStart(6, '0');
    const isZT = ztCodes.includes(code);
    return {
      code, name: n, price: +(8 + i * 0.37).toFixed(2),
      pct: isZT ? 10 : [-1.2, 0.4, 1.1, 2.3, 3.6, 0.8, -0.6, 1.9, 0.2, 2.7, 4.0, -1.4][i % 12],
      amount: 3e8 + i * 5e7, turnover: 1.5,
      mainInflow: (i % 3 === 0 ? 1 : -1) * (2e7 + i * 3e6),
      mainPct: [3.2, -1.1, 6.5, 2.0, -0.4, 8.1, 1.2, 0.6, 4.4, -2.2, 5.5, 0.9, 2.8, -1.8, 3.9, 1.6, -0.7, 7.2][i % 18],
      floatCap: 5e10   // 50亿流通市值，满足 35亿门槛
    };
  });
}

// ---------- ① 板块名 → BK 代码（含东财截断名） ----------
console.log('① 板块名→BK 代码映射（共 %d 条），东财涨停池 hybk 常把板块名截成 4 个字', SEC_CODES.length);
{
  const S = attach(mkWorld());
  ok('央国企改革 → BK0683（当天最大爆发板块，旧逻辑若 miss 则整板块埋伏票全废）', S.bkOfSector('央国企改革') === 'BK0683', S.bkOfSector('央国企改革'));
  ok('广东板块 → BK0153', S.bkOfSector('广东板块') === 'BK0153', S.bkOfSector('广东板块'));
  ok('电商概念 → BK0665', S.bkOfSector('电商概念') === 'BK0665', S.bkOfSector('电商概念'));
  ok('光伏概念 → BK0588', S.bkOfSector('光伏概念') === 'BK0588', S.bkOfSector('光伏概念'));
  const trunced = S.bkOfSector('央国企改');   // 模拟被截断的 4 字板块名
  ok('截断名「央国企改」仍能模糊命中（旧逻辑直接 miss 导致整板块成分股拉不到）', !!trunced, String(trunced));
  ok('空板块名不抛错，返回空串', S.bkOfSector('') === '' && S.bkOfSector(null) === '');
}

// ---------- ② 补涨龙：概念板块查不到时不再整块静默报废 ----------
console.log('\n② 补涨龙 —— 当日 sectors.json 只有 120 条行业板块、概念板块查不到的场景（2026-09-28 实况）');
(async () => {
  const ztCodes = ['600000', '600017'];
  const board = boardSample(ztCodes);
  const S = attach(mkWorld({ sectors: [{ code: 'BK1206', name: '基础化工', pct: 1.2, mainInflow: 5e8 }] }));
  S.ztPool = ztCodes.map((c, i) => ({ code: c, name: board.find(b => b.code === c).name, limitUpCount: i ? 1 : 2, pct: 10 }));
  S.ztBySector = { '央国企改革': S.ztPool };
  const em = { fetchBoardStocks: async () => board };
  const ctx = {
    S, em, console: { log() { }, error() { } },
    classifySectorRoles: arr => ({ leader: arr[0] }),
    isTradingTime: () => false, inQuietHours: () => true,
    govTake: () => ({ ok: true }), pushAll: () => { }, typeHist: () => '', logSignal: () => { }
  };
  // 旧逻辑对照组：直接用 sec.mainInflow（sec 为 undefined）
  let oldThrew = false;
  try { const sec = undefined; if (sec.mainInflow > 0) { } } catch (e) { oldThrew = true; }
  ok('对照组：旧写法 sec.mainInflow（sec 为 undefined）确实抛错 —— 这是历史崩溃点', oldThrew);

  // ⛔ dm 轮：staleMark 是 preBreakoutInner / computeBuZhang 的新外部依赖
  //    （数据源没回来时打「沿用上一次」标记）。漏注入 = 空 catch 吞掉 → 产出 0 只。
  const _sv = require('fs').readFileSync(__dirname + '/server.js', 'utf8');
  const _cut = (a, b) => { const i = _sv.indexOf(a), j = _sv.indexOf(b, i); return _sv.slice(i, j); };
  const STALE_SRC = _cut('const STALE_KIND = {', '// ─── 「失败」的说法登记表');
  let newThrew = null;
  try {
    // ⚠️ A（analysis.js）必须注入：2026-10-06 起 ST/退市过滤统一走 A.isJunkName，
    //    漏注入会变成 ReferenceError 被内部空 catch 吞掉 → 产出 0 只，报"算法坏了"而非"符号没传"。
    await new Function('S', 'em', 'console', 'classifySectorRoles', 'isTradingTime', 'inQuietHours',
      'govTake', 'pushAll', 'typeHist', 'logSignal', 'A',
      `${STALE_SRC}\n${BZ_SRC}\n return computeBuZhang();`)(S, em, ctx.console, ctx.classifySectorRoles, ctx.isTradingTime,
        ctx.inQuietHours, ctx.govTake, ctx.pushAll, ctx.typeHist, ctx.logSignal, require('./analysis.js'));
  } catch (e) { newThrew = e; }
  ok('修复后同一场景不再抛错（不再被外层 .catch(()=>{}) 静默吞掉）', !newThrew, newThrew && String(newThrew.message));
  const items = (S.buzhang && S.buzhang.items) || [];
  ok('补涨龙产出候选 > 0（历史 bug 下整天输出 0 条）', items.length > 0, '产出 ' + items.length + ' 只');
  ok('候选里不含已涨停股票（不做事后诸葛）', !items.some(x => ztCodes.includes(x.code)));
  ok('候选过滤掉了 ST 股', !items.some(x => /ST|退/.test(x.name)));
  ok('每条都带可复核的推算原因', items.every(x => x.reason && x.reason.length > 5));
  ok('候选涨幅落在 -1%~9%（允许微跌埋伏，不再要求已经涨了才算）', items.every(x => x.pct >= -1 && x.pct <= 9),
    items.map(x => x.pct).join(','));
  if (items[0]) console.log('     例：' + items[0].name + ' ' + items[0].prob + '% ← ' + items[0].reason);

  // ---------- ③ 启动前埋伏 ----------
  console.log('\n③ 板块效应·启动前埋伏 —— 热点板块里「还没动」的那批票');
  const S2 = attach(mkWorld({ sectors: [] }));
  S2.ztBySector = { '央国企改革': S.ztPool };
  const klines = {};
  board.forEach((b, i) => {
    klines[b.code] = Array.from({ length: 25 }, (_, k) => {
      const base = b.price * (0.93 + k * 0.004) + (i % 4) * 0.05;
      return { date: '2026-09-' + String(k).padStart(2, '0'), open: base, close: base + 0.02, high: base + 0.11, low: base - 0.09, volume: 1e6, amount: 2e8 };
    });
  });
  const klineRows = async c => klines[c] || [];
  // 自学历模型是由外层注入的（server.js 里的 laProb）。这里给它两个替身，分别验证两种极端：
  //   A. 模型不可用（返回 null）→ 候选必须照常产出，绝不能因为"学坏了"就把整批票丢光
  //   B. 模型给出概率        → 概率必须真的混进埋伏分，并带 ztP 下发给面板
  const laProbNull = () => null;
  const laProbGiven = (code) => {
    const idx = board.findIndex(b => b.code === code);
    const p = 0.03 + (idx % 5) * 0.02;              // 3%~11% 的次日封板概率
    return { p, base: 0.04, lift: p / 0.04, rules: [{ txt: '量比2~3.5 × 5日涨超8%', n: 1200, rate: 21.3, lift: 2.1 }] };
  };
  // newsTitlesFor / LOGIC 也是外层注入的（2026-09-30 起的驱动归因）。
  // ⚠️ 血泪教训第二次：preBreakoutInner 内部是 `try{} catch{}` 空吞，任何未注入的外部符号都会
  //    变成 ReferenceError 被安静地吃掉 → 产出 0 只 → 测试报"功能退化"而非"符号没传"。
  //    所以每加一个外部依赖，必须同时加到下面的注入清单里，否则会误判成算法坏了。
  const newsTitlesNull = () => ({ good: [], bad: [] });
  const newsTitlesGood = (code, name) => ({ good: ['业绩预增：净利同比增长 45%'], bad: [] });
  const LOGIC = require('./logic');
  const runPre = (Sworld, laFn, nwFn) => new Function('S', 'em', 'console', 'klineRows', 'laProb', 'newsTitlesFor', 'LOGIC', 'A',
    `${STALE_SRC}\n${PRE_SRC}\n return preBreakoutInner();`)(Sworld, em, ctx.console, klineRows, laFn, nwFn || newsTitlesNull, LOGIC, require('./analysis.js'));
  let preOut = null;
  try { preOut = await runPre(S2, laProbGiven, newsTitlesGood); }
  catch (e) { ok('preBreakoutInner 执行', false, String(e.message)); }
  if (preOut) {
    ok('产出启动前候选 > 0', preOut.length > 0, '产出 ' + preOut.length + ' 只');
    ok('候选均「未涨停」（剔除当天已封板的票）', !preOut.some(x => ztCodes.includes(x.code)));
    ok('候选涨幅全部 ≤4%（涨过头的不再叫"启动前"）', preOut.every(x => x.pct <= 4), preOut.map(x => x.pct).join(','));
    ok('候选涨幅全部 ≥-1.5%（跌太多的不接刀）', preOut.every(x => x.pct >= -1.5));
    ok('每条都写清了为什么被挑出来（可复盘）', preOut.every(x => x.reason && x.reason.indexOf('板块') >= 0));
    ok('埋伏分夹在 20~88 之间（不虚高给假确定性）', preOut.every(x => x.prob >= 20 && x.prob <= 88));
    ok('结果写入 S.pre 供面板展示', Array.isArray((S2.pre || {}).items) && S2.pre.items.length > 0);
    if (preOut[0]) console.log('     例：' + preOut[0].name + '(' + preOut[0].code + ') ' + preOut[0].pct + '% 埋伏分' + preOut[0].prob + ' ← ' + preOut[0].reason);
    // 自学历必须真的参与：ztP 下发 + 依据进文案 + 概率变化到分数里
    ok('候选都带上了自学的「次日封板概率」ztP', preOut.every(x => typeof x.ztP === 'number' && x.ztP > 0),
      JSON.stringify(preOut.slice(0, 3).map(x => x.ztP)));
    ok('文案里念出了机器学到的依据', preOut.every(x => /学到了:/.test(x.reason || '')), String((preOut[0] || {}).reason).slice(0, 60));
    // 归因：有新闻支撑时必须给出「硬逻辑」而不是闷声不响（用户要的就是这个「为什么」）
    ok('有业绩类新闻时，文案给出驱动归因结论', preOut.some(x => /驱动:(硬逻辑|混合|情绪)/.test(x.reason || '')),
      String((preOut[0] || {}).reason).slice(0, 120));
    const S3 = attach(mkWorld({ sectors: [] }));
    S3.ztBySector = S2.ztBySector;
    const outNoModel = await runPre(S3, laProbNull);
    const outModel = await runPre(attach(Object.assign(mkWorld({ sectors: [] }), { ztBySector: S2.ztBySector, bkOfSector: null })), laProbGiven);
    ok('模型不可用时也照常产出候选（不会静默归零）', outNoModel.length > 0, '产出 ' + outNoModel.length + ' 只');
    ok('模型可用时概率确实改变了埋伏分', outModel.some((x, i) => {
      const y = outNoModel.find(o => o.code === x.code);
      return y && Math.abs(x.prob - y.prob) >= 1;
    }), JSON.stringify(outModel.slice(0, 3).map(x => ({ c: x.code, with: x.prob, without: (outNoModel.find(o => o.code === x.code) || {}).prob }))));
    ok('没有模型时不写 measured ztP 字段', outNoModel.every(x => x.ztP == null));
  }

  // ---------- ③-b 早盘起爆窗口与硬维度（2026-10-29 加） ----------
  console.log('\n③-b 早盘起爆窗口与硬维度验证');
  {
    const RealDate = Date;
    const setTime = (h, m) => {
      global.Date = class extends RealDate {
        constructor(...a) { super(...a); }
        getHours() { return h; }
        getMinutes() { return m; }
      };
    };
    const restore = () => { global.Date = RealDate; };

    // 非早盘 10:30：涨幅 5.5% 应被过滤（上限仍为 4%）
    setTime(10, 30);
    const S4 = attach(mkWorld({ sectors: [] }));
    S4.ztBySector = S2.ztBySector;
    let outLate = [];
    try { outLate = await runPre(S4, laProbGiven); } catch (e) { ok('非早盘执行', false, String(e.message)); }
    ok('非早盘窗口涨幅>4%的票被过滤', !outLate.some(x => x.pct > 4), outLate.map(x => x.pct).join(','));
    restore();

    // 早盘 9:35：涨幅 5.5% 应被允许（上限放宽到 6%）。选一只未涨停的票（i=2 中成股份）改涨幅。
    setTime(9, 35);
    const emEarly = { fetchBoardStocks: async () => board.map((b, i) => i === 2 ? Object.assign({}, b, { pct: 5.5 }) : b) };
    const ctxEarly = Object.assign({}, ctx, { console: { log() {}, error() {} } });
    const runPreEarly = (Sworld, laFn, nwFn) => new Function('S', 'em', 'console', 'klineRows', 'laProb', 'newsTitlesFor', 'LOGIC', 'A',
      `${STALE_SRC}\n${PRE_SRC}\n return preBreakoutInner();`)(Sworld, emEarly, ctxEarly.console, klineRows, laFn, nwFn || newsTitlesNull, LOGIC, require('./analysis.js'));
    const S5 = attach(mkWorld({ sectors: [] }));
    S5.ztBySector = S2.ztBySector;
    let outEarly = [];
    try { outEarly = await runPreEarly(S5, laProbGiven); } catch (e) { ok('早盘执行', false, String(e.message)); }
    ok('早盘窗口内涨幅 5.5% 的票可被纳入候选', outEarly.some(x => x.pct === 5.5), outEarly.map(x => x.pct).join(','));
    restore();

    // 筹码峰 + 十日量能硬维度必须进入文案
    const Amock = Object.assign({}, require('./analysis.js'), {
      chipPeakOf: () => ({ mainPeak: 8.0, peakRatio: 30, dense: true, abovePeak: null, aboveGapPct: null, chipText: '筹码单峰密集' }),
      volTenOf: () => ({ verdict: 'good', text: '十日量能健康' })
    });
    const runPreChip = (Sworld, laFn, nwFn) => new Function('S', 'em', 'console', 'klineRows', 'laProb', 'newsTitlesFor', 'LOGIC', 'A',
      `${STALE_SRC}\n${PRE_SRC}\n return preBreakoutInner();`)(Sworld, em, ctx.console, klineRows, laFn, nwFn || newsTitlesNull, LOGIC, Amock);
    const S6 = attach(mkWorld({ sectors: [] }));
    S6.ztBySector = S2.ztBySector;
    let outChip = [];
    try { outChip = await runPreChip(S6, laProbGiven); } catch (e) { ok('硬维度执行', false, String(e.message)); }
    ok('筹码峰与十日量能结论进入 why 文案', outChip.some(x => /筹码/.test(x.reason || '') && /十日量能/.test(x.reason || '')),
      String((outChip[0] || {}).reason).slice(0, 120));
    restore();
  }

  // ---------- ④ 覆盖率：模拟板块从 1 只涨停 → 11 只涨停的整个过程 ----------
  console.log('\n④ 提前量量化：同一板块，起爆不同时点能提前抓到多少（以当天央国企改革 11 只为例）');
  {
    const all = board.slice(0, 18).filter(x => !/ST/.test(x.name)); // 17 只非ST
    const cover = async n => {
      const zt = all.slice(0, n).map(x => x.code);
      const Sx = attach(mkWorld({ sectors: [] }));
      Sx.ztBySector = {
        '央国企改革': zt.map((c, i) => ({ code: c, name: all.find(a => a.code === c).name, limitUpCount: i === 0 ? 2 : 1 }))
      };
      const out = await runPre(Sx, laProbGiven);
      const planned = all.slice(n).map(x => x.code);          // 还没涨停的那些（含当天最终会涨停的）
      const hit = planned.filter(c => out.some(o => o.code === c));
      return { n, out: out.length, planned: planned.length, hit: hit.length, rate: planned.length ? Math.round(hit.length / planned.length * 100) : 0 };
    };
    const r1 = await cover(1), r2 = await cover(2), r3 = await cover(4);
    console.log(`     板块内第1只涨停时扫描 → 剩余${r1.planned}只中被点名 ${r1.hit} 只 (${r1.rate}%)`);
    console.log(`     板块内第2只涨停时扫描 → 剩余${r2.planned}只中被点名 ${r2.hit} 只 (${r2.rate}%)`);
    console.log(`     板块内第4只涨停时扫描 → 剩余${r3.planned}只中被点名 ${r3.hit} 只 (${r3.rate}%)`);
    ok('起爆之初（仅1只涨停）就能点名出同板块未启动的票 —— 这正是"涨停前发现"', r1.hit > 0, String(r1.hit));
    ok('随着板块效应加强，点名数维持在可用水平（不因涨停增多而枯竭）', r2.out > 0 && r3.out > 0);
  }

  console.log(`\n──────── 结果：${pass} 通过 / ${fail} 失败 ────────\n`);
  process.exit(fail ? 1 : 0);
})();
