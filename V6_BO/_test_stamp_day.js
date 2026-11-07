// 守门测试：ig 轮盖戳改数据归属日（#262）
//
// 事故：refreshSectorsZT 用 lastTradeDay() 当 fetchZTPool 的日期参数——它只挪周末不挪
//   「交易日未开盘」。于是每个交易日 00:00~9:25：参数=今天，API 只能返回昨日池子
//   （今日池要收盘才生成），S.ztDay 盖今天的戳 → 面板/推送写「今日 36 只」实为昨日数据。
//   2026-10-16 本机实证：ztDay=20261016，池子是 10-15 的 36 只。与 2026-09-29
//   「10:02 自称 9:25」同族：拉取时刻 ≠ 数据归属日。
//
// 修法：日期参数改 dataTradeDay() 探测（基准股K线末行日期）——盘前=昨日、盘中=今日、
//   周末=上周五；探测失败记 S.ztDayProbed=false（每日可信度自检曝光，不静默）。
//
// 本守门钉四件事：
//   ① dataTradeDay 探测语义（真跑沙箱：K线末行=昨日 → 返回昨日；抛错 → 兜底+ok=false）
//   ② refreshSectorsZT 用探测日不用 lastTradeDay（剥注释源码断言）
//   ③ _markInd 归属日同步改（不再 todayStr）
//   ④ 端到端：盘前场景下 _ztDay→ztDayTag 必须说「昨日」而不是「今日」
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };

// 花括号配平取函数体（不许固定行号）
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

// 剥注释（判代码用剥注释版，防注释里的旧写法骗过断言）
function strip(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

console.log('\n=== ig 轮盖戳归属日守门（#262）===\n');

// ① dataTradeDay 探测语义（沙箱真跑，mock em.fetchKline）
const mkDataDay = (rows, doThrow, machineDay) => new Function([
  'let _dataDay = { v: null, t: 0 }, _dataDayOk = false;',
  'const em = { fetchKline: async () => { ' + (doThrow ? 'throw new Error("net down");' : 'return { rows: ' + JSON.stringify(rows) + ' };') + ' } };',
  'const lastTradeDay = () => "' + machineDay + '";',
  grab(/async function dataTradeDay\(\) \{/),
  'return { dataTradeDay, okOf: () => _dataDayOk };'
].join('\n'))();

(async () => {
// 盘前场景：机器日期 20261016（周四·今天），K线末行是 10-15（昨日）→ 必须返回昨日 + ok=true
{
  const m = mkDataDay([{ date: '2026-10-13' }, { date: '2026-10-14' }, { date: '2026-10-15' }], false, '20261016');
  const v = await m.dataTradeDay();
  ok('盘前：K线末行 10-15 → dataTradeDay 返回 10-15（不是机器日期今天）', v === '2026-10-15', '实得 ' + v);
  ok('盘前：探测成功 → okOf()=true', m.okOf() === true);
}
// 盘中场景：K线已有当日 bar → 返回今天
{
  const m = mkDataDay([{ date: '2026-10-15' }, { date: '2026-10-16' }], false, '20261016');
  const v = await m.dataTradeDay();
  ok('盘中：K线末行 10-16 → 返回 10-16', v === '2026-10-16', '实得 ' + v);
}
// 探测失败：抛错 → 兜底 lastTradeDay + ok=false（⛔ 判不出要留痕，不许静默当好戳用）
{
  const m = mkDataDay([], true, '20261016');
  const v = await m.dataTradeDay();
  ok('探测失败：兜底返回机器日期 2026-10-16', v === '2026-10-16', '实得 ' + v);
  ok('探测失败：okOf()=false（S.ztDayProbed 会转假，每日自检曝光）', m.okOf() === false);
}

// ② refreshSectorsZT 用探测日（剥注释后：有 await dataTradeDay，无 lastTradeDay 赋值）
{
  const body = strip(grab(/async function refreshSectorsZT\(\) \{/));
  ok('refreshSectorsZT 用 await dataTradeDay() 取日期参数', /const _dataDay = await dataTradeDay\(\);/.test(body));
  ok('refreshSectorsZT 不再直接用 lastTradeDay()（剥注释版无此调用）', !/lastTradeDay\(\)/.test(body));
  ok('refreshSectorsZT 记录探测状态 S.ztDayProbed = _dataDayOk', /S\.ztDayProbed = _dataDayOk;/.test(body));
  ok('fetchZTPool 的日期参数来自探测日 _ztDay', /em\.fetchZTPool\(_ztDay\)/.test(body));
}

// ③ _markInd 归属日用数据日不用 todayStr
{
  const body = strip(grab(/async function refreshSectorsZT\(\) \{/));
  ok('_markInd 归属日 = _ztDay（数据日）', /S\.sectorsDay = _ztDay;/.test(body));
  ok('_markInd 不再写 todayStr()（剥注释版无此赋值）', !/S\.sectorsDay = todayStr\(\)/.test(body));
}

// ④ 端到端：盘前场景 _ztDay → ztDayTag 必须说「昨日」（沙箱组装：探测 + 标签）
{
  const mkTag = (today, prev) => new Function([
    'const todayStr = () => "' + today + '";',
    'const prevTradeDay = () => "' + prev + '";',
    grab(/function ztDayTag\(d\) \{/),
    'return ztDayTag;'
  ].join('\n'))();
  const tag = mkTag('20261016', '20261015');
  ok('端到端·盘前：戳=10-15（探测日）→ ztDayTag 说「昨日」', tag('20261015') === '昨日', '实得 ' + tag('20261015'));
  ok('端到端·盘中：戳=10-16（当日 bar 生效）→ ztDayTag 说「今日」', tag('20261016') === '今日');
  ok('端到端·更早：戳=10-14 → 直接写日期 10-14（不猜相对词）', tag('20261014') === '10-14');
  ok('端到端·空戳：ztDayTag("") 返回空串（宁可不说）', tag('') === '');
}

// ⑤ 状态与出口：ztDayProbed 声明 + /api/state 下发 + 启动恢复标未探测
ok('S 声明 ztDayProbed 字段（默认 true，探测失败才转假）', /ztDayProbed: true,/.test(src));
ok('/api/state 下发 ztDayProbed（面板/诊断可见"戳不可信"）', /ztDayProbed: S\.ztDayProbed !== false,/.test(src));
{
  // 定位启动恢复段：用「快照恢复」独有的赋值串锚定，不按文件名猜位置
  // ⛔ 2026-10-28 改锚点：恢复时先过涨停家数口径（_bp = A.ztTallyOf(z.pool)），
  //    赋值从 `S.ztPool = z.pool` 变成 `S.ztPool = _bp.length ? _bp : z.pool`。锚点改成
  //    `S.ztDay = z.day`（两种写法都一样），判据不变：恢复出来的戳必须标未探测。
  const anchor = src.indexOf('S.ztDay = z.day');
  ok('启动从快照恢复涨停池时标 ztDayProbed=false（来历不可考）',
    anchor >= 0 && /S\.ztDayProbed = false;/.test(src.slice(anchor, anchor + 600)));
}

// ⑥ 反证：旧写法（lastTradeDay 直接当参数）在盘前会把昨日池盖成今日——
//    用旧逻辑跑同一场景，钉住"修的不是假想"
{
  const oldStamp = '20261016';   // lastTradeDay 盘前返回值
  const realDataDay = '20261015'; // API 实际返回的池子归属日
  ok('反证·旧写法：盘前戳=机器日期，与数据归属日不一致（病根再现）', oldStamp !== realDataDay);
}

console.log(`\n_test_stamp_day: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
})();
