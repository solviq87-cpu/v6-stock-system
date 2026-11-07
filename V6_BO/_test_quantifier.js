// 守门测试：系统对外说的话里，那些「数量词」到底指的是什么（2026-10-08 dc 轮）
//
// 本轮角度：一句话里的 "N 只 / N 条 / 今日 N 只涨停"，到底是在数哪一批东西。
// 数量词最容易骗人 —— 它长得像事实（一个整数），但"数的是哪个集合"从来没人追问。
// 本轮抓到四处，四处都是"数得没错、说的是错的"：
//
//   ① 「板块昨日 N 只涨停」：N 取自 S.ztBySector（当前涨停池）。竞价时段池子里装的确实是
//      上一交易日收盘那批，"昨日"碰巧对；而盘中「补抓快照」那条路径重算竞价分时，
//      池子已换成今日的了 —— 同一行代码、同一句话，此刻说的是反的。
//      更糟的是因子名「昨日板块涨停效应」进了学习库，inferZTProb 正按它的实测命中率调概率。
//   ② 「今日推送 N 只」：N 是 PUSH_GOV.total，一条推送记一次；同一只票在不同模块各占一次。
//      而"只"是股票的量词 —— 数的是条数，说的是只数。
//   ③ 「N 条因胜率不足被挡，另有 M 条重复/冷却被节流」：dropped 是全部被拦条数，
//      lowProb 是它的子集，M 里含 N。读出来是 N+M，实际只有 M 条。
//      而且 lowProb 跨天不清零（govResetIfNewDay 漏了它）→ "今日 N 条"其实是启动以来累计。
//   ④ 「共命中 N 只」：INTRADAY 缓冲是 (类型:代码) 键，同一只票在涨停与大单里各占一条。
//      N 是条数，说的却是"只"。
//
// 原则（可复用）：**数量词的集合必须与它所指的那个对象同一次取回**；
//                **一句话里两个数量词不许互相包含**；
//                **"只/条/笔/家"不能混用** —— 混用就是两个不同的集合被当成了一个。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// 括号配对抓取函数体（按固定行数窗口会串到相邻函数，踩过）
function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到锚点 ' + startRe);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('花括号不配平 ' + startRe);
}
let strip = null;
try { strip = require('./_codescan.js').stripNoise; } catch { }
const SV = strip ? strip(src, { keepStrings: true }) : src;

console.log('\n=== 数量词口径（dc 轮）守门 ===\n');

// ---------------- ① 涨停池归属日：这句「N 只涨停」是哪一天的 ----------------
console.log('【① 「板块 N 只涨停」必须带上归属日】');
ok('S.ztDay 已声明（涨停池归属交易日）', /ztDay: '',/.test(SV));
ok('⛔ 归属日就是**实际喂给数据源的那个日期参数**，不是"现在"',
  // ig 轮 #262 起改走 dataTradeDay() 探测（盘前=昨日/盘中=今日/周末=上周五，探测失败记 S.ztDayProbed=false），
  // 判据同步：喂给 fetchZTPool 的必须是探测出来的 _ztDay，不许退回机器日期 lastTradeDay()。
  // ⚠️ 判 src 不判 SV：.replace(/-/g,'') 含正则字面量，stripNoise 会把它抹成空格（本文件 L54 同款坑）
  /const _dataDay = await dataTradeDay\(\);/.test(src) && /const _ztDay = _dataDay\.replace\(\/-\/g, ''\);/.test(src) && /em\.fetchZTPool\(_ztDay\)/.test(src)
  && !/const _ztDay = lastTradeDay\(\);/.test(src));
ok('归属日与池子同一个 tick 写入（不许晚一步）', /S\.ztPool = zt;\s*\n\s*S\.ztDay = _ztDay;/.test(SV));
// ⚠️ 这条判的是**含正则字面量**的代码（`/^\d{8}$/`），而 stripNoise(keepStrings) 会抹掉正则字面量
//    → 必须判原始源码 src，不能判 SV（db 轮踩过同一个坑）。
ok('ztDayTag 认不出日子就返回空串（宁可不说也不猜）', /if \(!\/\^\\d\{8\}\$\/\.test\(s\)\) return '';/.test(src));
ok('buildZTRoleMap 把 secZTDay 与 secZT 一起带出去', /secZT: arr\.length, secZTDay: S\.ztDay \|\| ''/.test(SV));
// ⛔ 归属日必须**可查**：线上 /api/state 拿不到它，排查"这句 N 只涨停说的是哪天"就只能靠猜
ok('/api/state 把 ztDay 一并输出（诊断可见）', /ztDay: S\.ztDay \|\| '',/.test(SV));
ok('⛔ 竞价分文案不再写死"昨日"', !/\$\{r\.sector\}昨日\$\{r\.secZT\}只涨停/.test(src));
ok('⛔ 趋势票文案不再写死"今日"', !/板块今日\$\{secArr2\.length\}只涨停/.test(src));
ok('趋势票文案改用 ztDayTag', /板块\$\{_ztT2\}\$\{secArr2\.length\}只涨停/.test(src));
ok('涨停前形态文案带上归属日', /\(\$\{ztDayTag\(S\.ztDay\)\}\$\{x\.secZT\}只涨停\)/.test(SV));
ok('⛔ 因子名按归属日分开（名字说的日子必须等于喂进去的那批）',
  /factors\.push\(_ztToday \? '今日板块涨停效应' : '昨日板块涨停效应'\)/.test(SV));

// ---------------- ② 真跑 ztDayTag ----------------
console.log('\n【② ztDayTag：三种日子、三种说法】');
{
  const mkTag = (today, prev) => new Function('todayStr', 'prevTradeDay',
    grab(/function ztDayTag\(d\) \{/) + '\nreturn ztDayTag;')(today, prev);
  const T = mkTag(() => '20261008', () => '2026-10-07');
  ok('归属日 = 今天 → "今日"', T('20261008') === '今日', T('20261008'));
  ok('归属日 = 上一交易日 → "昨日"', T('20261007') === '昨日', T('20261007'));
  ok('归属日更早 → 直接写日期（不用相对词）', T('20260930') === '09-30', T('20260930'));
  ok('认不出来 → 空串（不许猜成今日/昨日）', T('') === '' && T(null) === '' && T('2026-10-08') === '', JSON.stringify([T(''), T('2026-10-08')]));
  // 反证：休市日里池子还是上一交易日那批，绝不能被标成"今日"
  const T2 = mkTag(() => '20261008', () => '2026-10-07');
  ok('反证：10/08 这一天涨停池若还是 10/07 的 → 标"昨日"不是"今日"', T2('20261007') !== '今日', T2('20261007'));
}

// ---------------- ③ 真跑 auctionScoreOf：同一句话、两个归属日 ----------------
console.log('\n【③ 竞价分：同一只票，池子换天了，话就得换】');
{
  const sandbox = grab(/function auctionScoreOf\(x, ctx\) \{/);
  // ⚠️ todayStr 在 server.js 里是**函数**，沙箱注入必须同名同形态 —— 传字符串会让
  //    `typeof todayStr === 'function'` 判 false，因子键判断整个走偏（不报错，只是静默选错分支）。
  const mk = (S, today) => new Function('S', 'todayStr', 'ztDayTag',
    sandbox + '\nreturn auctionScoreOf;')(S, () => today, (d) => (d === today ? '今日' : '昨日'));
  const roleOf = (day) => new Map([['600000', { role: 'leader', lb: 2, secZT: 7, secZTDay: day, sector: '华为概念' }]]);
  const x = { code: '600000', name: '测试票', auctionPct: 3, floatCap: 5e9, mainPct: 0, mainInflow: 0 };
  const ctxOf = (day) => ({ amtRank: new Map([['600000', 10]]), n: 5000, amtReliable: true, roleOf: roleOf(day) });

  const a1 = mk({ news: null }, '20261008')(x, ctxOf('20261007'));
  const w1 = (a1.why || []).join(' ');
  ok('池子归属上一交易日 → 文案写"昨日7只涨停"', /华为概念昨日7只涨停/.test(w1), w1);
  ok('池子归属上一交易日 → 因子落旧键「昨日板块涨停效应」', (a1.factors || []).indexOf('昨日板块涨停效应') >= 0, JSON.stringify(a1.factors));

  const a2 = mk({ news: null }, '20261008')(x, ctxOf('20261008'));
  const w2 = (a2.why || []).join(' ');
  ok('池子归属今天 → 文案写"今日7只涨停"（盘中补抓就是这条路径）', /华为概念今日7只涨停/.test(w2), w2);
  ok('池子归属今天 → 因子落新键「今日板块涨停效应」', (a2.factors || []).indexOf('今日板块涨停效应') >= 0, JSON.stringify(a2.factors));
  ok('⛔ 反证：归属今天时绝不再说"昨日"', !/昨日/.test(w2), w2);
  ok('⛔ 反证：两个归属日的因子键不许相同（否则学习把两批语义混成一个统计）',
    JSON.stringify(a1.factors) !== JSON.stringify(a2.factors));
}

// ---------------- ④ 推送脚注的「条 / 只」与被拦计数 ----------------
console.log('\n【④ 额度脚注：条与只分开，被拦的数互不重叠】');
// ⛔ dh 轮改判据：多了一类 noScore（取不到质量分被拦），现在是**四类互不包含**；
  //    noScore 不许被算进 throttled 里冒充「重复/冷却」（那正是 dc 轮钉过的数量词套娃）。
  // ⛔ go 轮 C3 再改判据：又多一类 follow（跟风涨停被拦，用户决策「不推跟风股」）——
  //    现在是**六类互不包含**（dropped 总数 + lowProb/follow/noScore/negEv/throttled 五分类），
  //    throttled 是扣完四类的剩余，每一类也必须先钳再减，否则任一分类超量都会造出负数节流数。
  //    ig 轮 #261：negEv 是第五分类（同型信号实盘 EV 显著为负被拦），与其余类同一套钳位规则。
  ok('pushGovBlocked 是唯一出口且五分类互不重叠（throttled = dropped − lowProb − follow − noScore − negEv）',
    /function pushGovBlocked\(\)/.test(SV) && /throttled: Math\.max\(0, dropped - lowProb - follow - noScore - negEv\)/.test(SV));
  ok('negEv 也被钳在剩余额度内（ig 轮 #261 第五类）',
    /negEv = Math\.min\(Math\.max\(0, \+PUSH_GOV\.negEv \|\| 0\), Math\.max\(0, dropped - lowProb - follow - noScore\)\)/.test(SV));
  ok('follow 先被钳在剩余额度内（go 轮 C3 第四类）',
    /follow = Math\.min\(Math\.max\(0, \+PUSH_GOV\.follow \|\| 0\), Math\.max\(0, dropped - lowProb\)\)/.test(SV));
  ok('noScore 也被钳在剩余额度内',
    /noScore = Math\.min\(Math\.max\(0, \+PUSH_GOV\.noScore \|\| 0\), Math\.max\(0, dropped - lowProb - follow\)\)/.test(SV));
ok('lowProb 被钳在 dropped 之内（不许出现负数节流数）',
  /lowProb = Math\.min\(Math\.max\(0, \+PUSH_GOV\.lowProb \|\| 0\), dropped\)/.test(SV));
ok('pushGovCodesN 只数 n>0 的票（发送失败退回的不算）',
  /function pushGovCodesN\(\)/.test(SV) && /if \(r && \(\+r\.n \|\| 0\) > 0\) n\+\+/.test(SV));
// ⚠️ 判模板串里的长文案一律用原始源码 src：stripNoise 会把模板字面量的正文抹成空格
//    （上面 _dbg 实测：SV 里 `${PUSH_GOV.total}` 之后整段变空白）→ 用 SV 判会假通过。
ok('⛔ govFoot 不再把 dropped 说成"重复/冷却"', !/另有 \$\{PUSH_GOV\.dropped\} 条重复\/冷却/.test(src));
ok('⛔ govFoot 不再把 total 说成"只"', !/今日推送 \$\{PUSH_GOV\.total\}[\s\S]{0,80}只，余/.test(src));
ok('govFoot 分别报覆盖只数与条数', /今日推送 \$\{PUSH_GOV\.total\}[\s\S]{0,80}覆盖 \$\{_codes\} 只票/.test(src));
ok('面板与脚注同一份口径（pushGovStat 带 codes / throttled）',
  /codes: pushGovCodesN\(\)/.test(SV) && /throttled: pushGovBlocked\(\)\.throttled/.test(SV));
ok('⛔ 面板 pushLog 不再把 dropped 当"去重拦下"', !/低概率拦下 ' \+ \(g\.lowProb \|\| 0\) \+ ' 条 · 去重拦下 ' \+ \(g\.dropped \|\| 0\)/.test(html));
ok('面板 pushLog 用 throttled', /重复\/冷却拦下 ' \+ \(g\.throttled/.test(html));
ok('⛔ govResetIfNewDay 必须连 lowProb 一起清零（否则"今日 N 条"是启动以来累计）',
  /PUSH_GOV\.dropped = 0; PUSH_GOV\.lowProb = 0;/.test(SV));
{
  // ⚠️ new Function 注入后**返回的是函数本身**，要再调一次才拿到结果（忘了就拿到函数对象，比较恒 false）
  const mkBl = g => new Function('PUSH_GOV', grab(/function pushGovBlocked\(\) \{/) + '\nreturn pushGovBlocked;')(g)();
  const bl = mkBl({ dropped: 10, lowProb: 4 });
  ok('dropped=10 / lowProb=4 → throttled=6（不是 10）', bl.throttled === 6 && bl.lowProb === 4 && bl.dropped === 10, JSON.stringify(bl));
  const bl2 = mkBl({ dropped: 3, lowProb: 9 });   // 跨天没清零时会出现这种荒唐数
  ok('反证：lowProb > dropped 时钳住不报负数', bl2.throttled === 0 && bl2.lowProb === 3, JSON.stringify(bl2));
  const cn = new Function('PUSH_GOV', grab(/function pushGovCodesN\(\) \{/) + '\nreturn pushGovCodesN;')(
    { codes: new Map([['600000', { n: 2 }], ['600001', { n: 1 }], ['600002', { n: 0 }]]) })();
  ok('3 条记录里有 1 只已退回 → 覆盖 2 只票（不是 3 也不是 1）', cn === 2, String(cn));
}
{
  const PUSH_GOV = { day: '20261007', codes: new Map(), total: 40, dropped: 100, lowProb: 37 };
  new Function('PUSH_GOV', 'todayStr', 'pushQuota', 'savePushGov', 'console',
    grab(/function govResetIfNewDay\(\) \{/) + '\nreturn govResetIfNewDay;')(
    PUSH_GOV, () => '20261008', () => 120, () => { }, { log() { } })();
  ok('换日后 lowProb 归零（"今日 N 条"才是今天的）', PUSH_GOV.lowProb === 0, String(PUSH_GOV.lowProb));
  ok('换日后 dropped / total 同样归零', PUSH_GOV.dropped === 0 && PUSH_GOV.total === 0);
}

// ---------------- ⑤ 真跑 govFoot：同一句话里的数不许互相包含 ----------------
console.log('\n【⑤ govFoot 真跑：脚注里每个数各归各位】');
{
  const PUSH_GOV = { day: '20261008', total: 30, dropped: 257, lowProb: 90, codes: new Map() };
  // 30 条推送里同一只票占了 2 次 → 覆盖 24 只票
  for (let i = 0; i < 24; i++) PUSH_GOV.codes.set('6000' + String(i).padStart(2, '0'), { n: 1, ts: 0, types: new Set() });
  PUSH_GOV.codes.set('600000', { n: 2, ts: 0, types: new Set() });
  const foot = new Function('PUSH_GOV', 'pushQuota', '_govCfg', 'MSG_STAT', 'marketHealthNote',
    'pushGovBlocked', 'pushGovCodesN',
    grab(/function govFoot\(\) \{/) + '\nreturn govFoot;')(
    PUSH_GOV, () => 120, () => 8, { total: 3, blocked: 1 }, () => '',
    new Function('PUSH_GOV', grab(/function pushGovBlocked\(\) \{/) + '\nreturn pushGovBlocked;')(PUSH_GOV),
    new Function('PUSH_GOV', grab(/function pushGovCodesN\(\) \{/) + '\nreturn pushGovCodesN;')(PUSH_GOV))();
  console.log('     脚注: ' + foot.replace(/\n/g, ' ⏎ '));
  ok('说"30/120 条"而不是"30 只"', /今日推送 30\/120 条/.test(foot), foot);
  ok('单列覆盖只数 24（不是 30）', /覆盖 24 只票/.test(foot), foot);
  ok('胜率不足报 90 条', /90 条因预估胜率不足被挡/.test(foot), foot);
  ok('⛔ 重复/冷却报 167 条（= 257 − 90），不再把 257 全算成重复冷却', /167 条重复\/冷却样本被节流/.test(foot), foot);
  ok('⛔ 反证：脚注里不再出现 257', !/257/.test(foot), foot);
}

// ---------------- ⑥ 盘中快报「共命中 N 只」 ----------------
console.log('\n【⑥ 盘中快报：只数是只数、条数是条数】');
{
  // ⛔ 沙箱注入：buildAlertsReport 里的百分数要带事件定义、参考止损要带前提说明（dd 轮）
  //    漏装一个符号 = 整个套件崩掉而不是变红（同类坑已踩 10 次）。原样切进来，改实现自动跟着变。
  const PRE = src.slice(src.indexOf('const HIT_THR = 3;'), src.indexOf('function resolveWithKline'))
    + '\n' + src.slice(src.indexOf('const STOP_REF_PCT = -3;'), src.indexOf('// 强势信号判定'));
  const fn = new Function(PRE + '\n' + grab(/function buildAlertsReport\(list, opt\) \{/) + '\nreturn buildAlertsReport;')();
  // 5 条信号、4 只票：600001 同时命中「涨停」与「大单快速流入」
  const list = [
    { type: '涨停', code: '600001', name: '甲', price: 10, pct: 10, prob: 90, riseProb: 90, pushNo: 1 },
    { type: '大单快速流入', code: '600001', name: '甲', price: 10, pct: 10, prob: 80, riseProb: 80, pushNo: 1 },
    { type: '趋势票', code: '600002', name: '乙', price: 20, pct: 5, prob: 70, riseProb: 70, pushNo: 1 },
    { type: '后排涨停概率', code: '600003', name: '丙', price: 30, pct: 8, prob: 60, riseProb: 60, prob2: 60, pushNo: 1 },
    { type: '趋势票', code: '600004', name: '丁', price: 40, pct: 3, prob: 50, riseProb: 50, pushNo: 1 },
  ];
  const top = list.slice(0, 4);
  const msg = fn(top, {
    total: list.length, rest: list.length - top.length,
    codes: 4, topCodes: 3, restCodes: 1, since: Date.now()
  });
  console.log('     末行: ' + (msg.split('\n').filter(x => /共命中/.test(x))[0] || '(无)'));
  ok('报"共命中 4 只票 / 5 条信号"（只数与条数分开）', /共命中 4 只票 \/ 5 条信号/.test(msg), msg);
  ok('推送前 3 只（4 条）', /前 3 只（4 条）/.test(msg), msg);
  ok('其余 1 只', /其余 1 只/.test(msg), msg);
  ok('⛔ 反证：不再把 5 条说成 5 只', !/共命中 5 只/.test(msg), msg);
  ok('只数守恒：推送的只 + 其余的只 = 总只数', /前 3 只/.test(msg) && /其余 1 只/.test(msg) && /共命中 4 只票/.test(msg));
}
ok('flushIntraday 先按代码去重再报（不是直接拿 list.length 当只数）',
  /const codesOf = arr => new Set\(arr\.map\(a => a && a\.code\)\.filter\(Boolean\)\);/.test(SV));
ok('flushIntraday 把 codes / topCodes / restCodes 一起传下去',
  /codes: allCodes\.size/.test(SV) && /topCodes: topCodes\.size/.test(SV) && /restCodes: Math\.max\(0, allCodes\.size - topCodes\.size\)/.test(SV));
ok('buildAlertsReport 缺 opt 字段时兜底去重（老调用点不带 opt 也不能崩）',
  /const _c = opt\.codes != null \? opt\.codes : new Set\(list\.map\(a => a && a\.code\)\)\.size;/.test(SV));

// ---------------- ⑦ 日志里的量词 ----------------
console.log('\n【⑦ 日志：同一个数不许两个名字】');
ok('恢复额度日志用"条"报推送数、用"只"报票只数',
  /已推 \$\{PUSH_GOV\.total\} 条 \/ \$\{PUSH_GOV\.codes\.size\} 只票有记录/.test(SV));
ok('govFilter 日志同样用"条"', /今日已推 \$\{PUSH_GOV\.total\} 条/.test(SV));
ok('新交易日日志：名额是条/天（不是只/天）', /名额 \$\{pushQuota\(\)\} 条\/天/.test(SV));

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
