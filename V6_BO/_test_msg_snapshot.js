// 推送文案与它引用的数据是否同源（本轮新角度 —— 一条消息里的数字必须是同一份快照）。
//
// 故障形态：文案由【多个来源、不同时刻】的数据拼成。复盘正文来自 S.review.items（算好那一刻
// 的快照），首行 todayHead() 与尾部「涨停池 N 只」却是【推送那一刻】实时现取 S.ztPool
// （30 秒刷新一次）。于是：复盘在 45 只时算完、推送时池子涨到 52 只 → 首行写「今日涨停 52 只」，
// 下面的「首板 X 只 连板 Y 只」加起来却是 45 只 —— 一条消息自己跟自己对不上，
// 而且**不报错、不告警**，只会让人觉得"这消息怎么看着不对劲"，根本查不出是哪儿错了。
//
// 同源原则：算结果的时候把【当时】的口径一起定格进结果对象，推送端一律读快照，不现取。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const SVK = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// 从源码里切出一段以 startRe 开头、按大括号配对结束的代码
function takeBlock(startRe) {
  const m = startRe.exec(SV);
  if (!m) throw new Error('未找到片段: ' + startRe);
  const s = SV.indexOf('{', m.index);
  let d = 0;
  for (let i = s; i < SV.length; i++) {
    if (SV[i] === '{') d++;
    else if (SV[i] === '}') { d--; if (!d) return SV.slice(m.index, i + 1); }
  }
  throw new Error('括号未闭合: ' + startRe);
}

group('[1] 复盘快照：S.review 里必须存下「算好那一刻」的只数与首行');
// ⚠️ 2026-10-07：S.review 的构造收成了唯一入口 mkReviewShell()（复盘日期必须跟着数据一起落盘）。
//    ⛔ 别再钉 `S.review = { time: … }` 这句字面量 —— 换写法就假红，而接线其实还在。
//    钉语义：快照里【必须有 ztN / head / date 这三样】，且三个分支都走同一个入口。
const RV_SHELL = takeBlock(/function mkReviewShell\(items\) \{/);
ok('mkReviewShell 抠得出来（不然下面三条等于没测）', RV_SHELL.length > 80, String(RV_SHELL.length));
ok('复盘快照带 ztN（只数与正文同源）', /ztN:/.test(RV_SHELL));
ok('复盘快照带 head 字段', /head:/.test(RV_SHELL));
ok('复盘快照带 date（落盘后才知道它是哪天的）', /date:/.test(RV_SHELL));
// ⛔ fy 轮：别再钉整句字面量 —— fv 轮在 Object.assign 里多了 themeSrc 就假红，接线其实没断。
//    钉语义：必须走 Object.assign(mkReviewShell(items), …) 这个唯一入口，且第二参数里补了 head。
ok('computeReview 写入走 mkReviewShell 并补 head',
  /S\.review = Object\.assign\(mkReviewShell\(items\),\s*\{[^}]*head:/.test(SV));
ok('空复盘的两个分支也走同一个入口（字段不会缺、面板不会读到 undefined）',
  (SV.match(/S\.review = mkReviewShell\(\[\]\)/g) || []).length === 2,
  String((SV.match(/S\.review = mkReviewShell\(\[\]\)/g) || []).length));

group('[2] 复盘文案：读快照，不现取');
const BM = takeBlock(/function buildReviewMessage\(\) \{/);
// ⛔ fx/fy 轮：buildReviewMessage 调用 poolReasonSection + 四个 why* 解析器（各池上涨原因），
//    这些都在 server.js 模块作用域，注入 buildReviewMessage 时必须一并注入，否则 ReferenceError 崩套件。
//    poolReasonSection 内部对 sectorOfStock/themeOfSec 用 typeof 守卫，未注入也不会崩（走兜底）。
const _iSel = SV.indexOf('function poolReasonSection');
const _jSel = SV.indexOf('function buildReviewMessage()', _iSel);
const SEL = (_iSel >= 0 && _jSel > _iSel) ? SV.slice(_iSel, _jSel) : '';
// ⛔ 沙箱注入：buildReviewMessage 里的百分数要带事件定义（dd 轮 probDef），
//    漏装一个符号 = 整个套件崩掉而不是变红（同类坑已踩 10 次）。原样切进来，改实现自动跟着变。
const PRE = SV.slice(SV.indexOf('const HIT_THR = 3;'), SV.indexOf('function resolveWithKline'));
ok('首行用 S.review.head，不再直接调 todayHead()',
  /_rvHead/.test(BM) && /\$\{_rvHead\}/.test(BM) && !/\$\{todayHead\(\)\}/.test(BM));
ok('尾部只数用 S.review.ztN', /_rvZtN/.test(BM) && /涨停池 \$\{_rvZtN\}/.test(BM));
ok('旧数据（无 ztN/head）时兜底实时值', /S\.review && S\.review\.ztN != null/.test(BM) && /it\.length \? todayHead\(\) : ''/.test(BM));

group('[3] 真跑一遍：推送时池子变了，消息里的数字不许跟着变');
{
  const mkItem = (i) => ({
    name: '票' + i, code: '00000' + i, prob: 70 + i, limitUpCount: i % 3, sealRatio: 0.5,
    breakCount: 0, aboveMa5: i % 2 === 0, brokeHighHold: false, volPriceUp: true,
    reason: '归因' + i, peers: [{ n: '同板A', lb: 1, role: 'leader' }]
  });
  // 复盘在【45 只】时算完；等到推送时，涨停池已经变成【52 只】
  const S = {
    review: { time: '15:00:00', items: Array.from({ length: 45 }, (_, i) => mkItem(i)), ztN: 45, head: '【快照首行·45只】' },
    ztPool: new Array(52).fill({ code: 'x', name: 'x', limitUpCount: 1, sealAmount: 0 }),
    learn: { samples: 0, hits: 0, scoreThreshold: 60, split: null }
  };
  const build = new Function('S', 'todayHead', 'fusedEvoLine', 'marketReady',
    PRE + '\n' + SEL + '\n' + BM + '\nreturn buildReviewMessage;'
  )(S, () => '【实时首行·52只】', () => '融合进化', () => true);
  const msg = build();
  ok('首行用的是算好那一刻的快照', msg.indexOf('【快照首行·45只】') >= 0 && msg.indexOf('【实时首行·52只】') < 0,
    msg.slice(0, 120).replace(/\n/g, ' '));
  ok('尾部只数也是 45（与正文同源，不是实时的 52）', msg.indexOf('涨停池 45 只') >= 0 && msg.indexOf('涨停池 52 只') < 0);

  // 反证：旧 review.json（没有 ztN/head）时退回旧行为，保证兼容不炸
  const S2 = {
    review: { time: '15:00:00', items: Array.from({ length: 45 }, (_, i) => mkItem(i)) },
    ztPool: new Array(52).fill({ code: 'x', name: 'x', limitUpCount: 1, sealAmount: 0 }),
    learn: { samples: 0, hits: 0, scoreThreshold: 60, split: null }
  };
  const msg2 = new Function('S', 'todayHead', 'fusedEvoLine', 'marketReady',
    PRE + '\n' + SEL + '\n' + BM + '\nreturn buildReviewMessage;'
  )(S2, () => '【实时首行·52只】', () => '', () => true)();
  ok('旧数据无快照时兜底用实时值（兼容性不回退）',
    msg2.indexOf('涨停池 52 只') >= 0 && msg2.indexOf('【实时首行·52只】') >= 0);
}

group('[4] 竞价文案：日期必须与快照同源（跨天时不把昨天的标成今天）');
ok('captureAuction 写入 S.auction 时带 date', /date: \(typeof quoteDayOf === 'function'\) \? quoteDayOf\(Date\.now\(\)\)/.test(SV));
ok('文案优先用 au.date，兜底 todayStr()', /const ds = \(au && au\.date\) \|\| \(\(typeof todayStr === 'function'\) \? todayStr\(\) : ''\);/.test(SV));

group('[5] 其它文案整体用自身快照（不混源）');
const NP = takeBlock(/function buildNextPlanMessage\(\) \{/);
ok('次日作战计划文案用 S.nextplan 快照', /const np = S\.nextplan/.test(NP) || /S\.nextplan/.test(NP));
// ⛔ 钉语义：日期必须取自 nextplan 快照（applyDate 或 date 皆可），不许现取 NP.localDate() 当日期。
//    ck 轮把"生成日"改成"适用日(applyDate)"后，钉死 `(p && p.date) || NP.localDate()` 会假红。
ok('计划日期取自快照，不现取 NP.localDate()',
  /np\.applyDate \|\| \(p && p\.applyDate\)/.test(NP) && !/· \$\{\(p && p\.date\) \|\| NP\.localDate\(\)\}/.test(NP));
const AU = takeBlock(/function buildAuctionStrongMessage\(topN\) \{/);
ok('竞价文案整体读 au = S.auction 一个源', /const au = S\.auction;/.test(AU));
ok('竞价文案里的只数/时间/口径都来自 au',
  /au\.validCount/.test(AU) && /au\.time/.test(AU) && /au\.pxSrc/.test(AU) && /au\.amtReliable/.test(AU));
ok('竞价文案不再现取 S.ztPool 或 S.stocks', !/S\.ztPool|S\.stocks/.test(AU));

group('[6] 复盘涨停原因：取到就打同花顺原文，取不到就明说（不许拿合成归因冒充）');
// ⛔ 2026-10-09 fy 轮。用户原话：「复盘里面，涨停原因未取到，同花顺里面不是有吗，怎么取不到」。
//    查实：本地 ztReasonHit=69/69，**数据其实取到了，是复盘从来没显示** ——
//    旧文案只渲 A.buildZTReason 合成的【板块】/【封板】归因，用户看到的压根不是同花顺原文。
//    钉语义：① 有 themes/reasonRaw 时必须出现「涨停原因(同花顺)」+ 原文；
//            ② 没有时必须明说「同花顺未取到」，不许静默不提，更不许拿合成归因顶替。
{
  const mkZ = (i, extra) => Object.assign({
    name: '票' + i, code: '00000' + i, prob: 70 + i, limitUpCount: i % 3, sealRatio: 0.5,
    breakCount: 0, aboveMa5: true, brokeHighHold: false, volPriceUp: true,
    reason: '合成归因' + i, peers: []
  }, extra || {});
  const runZ = (items) => {
    const SZ = {
      review: { time: '15:00:00', items, ztN: items.length, head: 'H', date: '2026-10-09' },
      ztPool: new Array(items.length).fill({ code: 'x', name: 'x', limitUpCount: 1, sealAmount: 0 }),
      learn: { samples: 0, hits: 0, scoreThreshold: 60, split: null },
      ztReasonHit: `${items.filter(x => x.themes || x.reasonRaw).length}/${items.length}`,
    };
    const build = new Function('S', 'todayHead', 'fusedEvoLine', 'marketReady',
      PRE + '\n' + SEL + '\n' + BM + '\nreturn buildReviewMessage;'
    )(SZ, () => 'H', () => '融合进化', () => true);
    return build();
  };
  const z1 = runZ([mkZ(1, { themes: ['固态电池', '铝塑膜'], reasonRaw: '固态电池+铝塑膜+电池客户' })]);
  ok('取到时打「涨停原因(同花顺)」并带原文',
    z1.indexOf('涨停原因(同花顺)') >= 0 && z1.indexOf('固态电池') >= 0, z1.slice(0, 220).replace(/\n/g, ' | '));
  const z2 = runZ([mkZ(1, { reasonRaw: '锂电池+储能' })]);
  ok('只有 reasonRaw（无 themes 数组）时也走同花顺口径',
    z2.indexOf('涨停原因(同花顺)') >= 0 && z2.indexOf('锂电池') >= 0);
  const z3 = runZ([mkZ(1)]);
  ok('没取到时明说「同花顺未取到」（不静默、不冒充）',
    z3.indexOf('同花顺未取到') >= 0, z3.slice(0, 220).replace(/\n/g, ' | '));
  ok('合成归因降级为「归因」一行，不许顶替同花顺原因',
    z3.indexOf('归因:') >= 0 && z3.indexOf('涨停原因(同花顺)') < 0);
  const z4 = runZ([mkZ(1, { themes: ['固态电池'] }), mkZ(2)]);
  ok('覆盖率写进 stat（取到几只/共几只，一眼看出是没拉到还是没显示）',
    /同花顺涨停原因\s*1\/2/.test(z4), z4.slice(0, 200).replace(/\n/g, ' | '));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
