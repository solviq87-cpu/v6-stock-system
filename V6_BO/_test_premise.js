// 守门测试（dd 轮 · 角度：系统说的话里，那些「只有结论、没有前提」的话）
//   一个百分数、一个止损价，都是结论。它们成立的前提（赌的是哪件事 / 统计窗口多长 /
//   跟账户里真正执行的那根线是不是一回事）从没跟着一起给出 —— 读的人只能自己猜，
//   而系统里**同一个词指的往往不是同一件事**：
//     ① 「涨停概率」盘中模块赌【当日】封板，收盘后的复盘/好标的/形态赌【次日】封板；
//     ② 「净额 / 主力净流入」是当日累计，而同一张卡片上并列的「1分钟流入」是分钟级增量；
//     ③ 推送里的「参考止损 X」是写死的现价 -3%，模拟盘真正执行的却是账户里可改的
//        stopPct（默认 -8%）—— 差 5 个点，注释原来还写「与模拟盘 sl 一致」。
//   修法：把前提变成**一张可复用的定义表**，跟数值一起输出；认不出来就宁可不写。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { fail++; console.log('  ❌ ' + name + (got !== undefined ? '  → ' + got : '')); }
};
const sec = t => console.log('\n' + t);

const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = stripNoise(SRC, { keepStrings: true });
const NOC = SV;
const HTML = fs.readFileSync('./public/index.html', 'utf8');

// ⛔ 正则字面量会被 stripNoise 抹掉、模板串长正文会被抹成空白 —— 凡判「文案/正则」一律用原始 SRC
const slice = (a, b) => {
  const i = SRC.indexOf(a), j = SRC.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('未找到锚点: ' + a);
  return SRC.slice(i, j);
};

// ---------------- ① 概率事件定义表：沙箱真跑 ----------------
sec('【① 概率定义表：每个百分数都得说清赌的是哪件事】');
const probSrc = slice('const HIT_THR = 3;', 'function resolveWithKline');
ok('[自检] 切到概率定义表（含 HIT_THR）', /const HIT_THR = 3;/.test(probSrc) && /const PROB_DEF = \{/.test(probSrc));
const P = new Function(probSrc + '\n; return { HIT_THR, PROB_DEF, probDef, probTag, PROB_KIND_OF_TYPE, probDefOfType };')();
ok('[自检] 沙箱跑起来', P && typeof P.probDef === 'function');

ok('ztToday = 当日封板', P.probDef('ztToday') === '当日封板', P.probDef('ztToday'));
ok('ztNext = 次日封板', P.probDef('ztNext') === '次日封板', P.probDef('ztNext'));
ok('up3Next = 次日最高涨≥HIT_THR%（跟着命中口径走，不是写死的 3）',
  P.probDef('up3Next') === '次日最高涨≥' + P.HIT_THR + '%', P.probDef('up3Next'));
ok('认不出来的 kind 返回空串（宁可不写，也不许编一个定义）', P.probDef('瞎编的') === '');
ok('PROB_DEF 只有这三个键（加新事件必须同时改文案，不许悄悄加）',
  Object.keys(P.PROB_DEF).sort().join(',') === 'up3Next,ztNext,ztToday', Object.keys(P.PROB_DEF).join(','));

ok('probTag 正常值 → （当日封板）', P.probTag('ztToday', 62) === '（当日封板）', P.probTag('ztToday', 62));
ok('数值为 null 时连定义一起省（没给数就别描述赌的是什么）', P.probTag('ztToday', null) === '');
ok('数值为 undefined 时同样省', P.probTag('ztToday', undefined) === '');
ok("数值为 '-' 时同样省（占位符不是概率）", P.probTag('ztToday', '-') === '');
// 反证：若不判空值，'—' 那行会变成「概率 —（当日封板）」—— 一个没发生的赌局被描述得像真事
ok('[反证] 空值判据真实存在（去掉就必然输出带定义的括号）',
  /if \(!d \|\| v == null \|\| v === '-'\) return '';/.test(probSrc));

// ---------------- ② 类型 → 事件：盘中 vs 收盘后 ----------------
sec('【② 盘中模块赌当日、收盘后模块赌次日（同一套规则不许两处各写一遍）】');
const INTRADAY = ['后排涨停概率', '大单快速流入', 'auczt', 'buzhang', 'similar'];
let allToday = true;
for (const t of INTRADAY) if (P.probDefOfType(t) !== 'ztToday') { allToday = false; console.log('     ✗ ' + t + ' → ' + P.probDefOfType(t)); }
ok('五个盘中类型全部映射到【当日封板】', allToday, INTRADAY.join('/'));
ok('趋势票映射到【次日最高涨≥3%】（它的分不是封板概率）',
  P.probDefOfType('趋势票') === 'up3Next', P.probDefOfType('趋势票'));
ok('查不到的类型返回空串（fuseLine 兜底不加定义）', P.probDefOfType('不存在的模块') === '');
// ⛔ 收盘后的复盘/好标的/形态绝不许落 ztToday —— 收盘后再说"当日封板"是句废话
ok('映射表里没有任何收盘后类型被标成 ztToday（收盘后只能赌次日）',
  !Object.entries(P.PROB_KIND_OF_TYPE).some(([k, v]) => /复盘|好标的|形态|review/i.test(k) && v === 'ztToday'));

// ---------------- ③ 文案：概率数字必须自带定义 ----------------
sec('【③ 对外文案：光秃秃一个百分数不许再出现】');
// ⛔ 钉语义不钉字面：扫「概率/胜率 + 数字占位」的行，同一行（含跨行模板串往后 3 行）
//    必须出现 probDef( 或 probTag(
const L = SRC.split('\n');
const probLines = [];
L.forEach((l, i) => {
  if (!/概率|胜率/.test(l)) return;
  if (!/\$\{?\s*(x|a|f|c)\.(prob|riseProb|ztP)\s*\}?\s*%|\$\{f\.prob\}%/.test(l)) return;
  // ⛔ 定义可能写在这行的**前面**（fuseLine 是先取 _def 再拼模板串）→ 窗口必须往前也看几行
  probLines.push({ i: i + 1, txt: l.trim().slice(0, 90), blk: L.slice(Math.max(0, i - 4), i + 4).join('\n') });
});
ok('[自检] 扫到对外概率文案 ' + probLines.length + ' 处', probLines.length >= 8, probLines.length);
const naked = probLines.filter(p => !/probDef\(|probTag\(|probDefOfType\(/.test(p.blk));
ok('★ 每一处概率数字都自带事件定义（没有裸百分数）', naked.length === 0,
  naked.length ? naked.map(p => 'L' + p.i + ': ' + p.txt).join(' | ') : '0 处裸奔');
// 反证：把 probDef/probTag 这两个调用从源码里抹掉，上面那条必须立刻扫出裸百分数
//       （否则说明它匹配的是别的东西，压根没在检查"有没有带定义"）
const stripped = SRC.replace(/probDef\(|probTag\(|probDefOfType\(/g, 'NODEF_');
const sL = stripped.split('\n');
let sNaked = 0;
sL.forEach((l, i) => {
  if (!/概率|胜率/.test(l)) return;
  if (!/\$\{?\s*(x|a|f|c)\.(prob|riseProb|ztP)\s*\}?\s*%|\$\{f\.prob\}%/.test(l)) return;
  if (!/probDef\(|probTag\(|probDefOfType\(/.test(sL.slice(Math.max(0, i - 4), i + 4).join('\n'))) sNaked++;
});
ok('[反证] 定义表被掏空后确实会扫出裸百分数（说明上面那条真在检查）', sNaked > 0, sNaked + ' 处');

// fuseLine 的「学后胜率」是唯一的融合出口，它必须按 type 补定义
const flBody = (() => {
  const i = NOC.indexOf('function fuseLine(');
  let p = NOC.indexOf('(', i), pd = 0, pe = p;
  for (; pe < NOC.length; pe++) { const c = NOC[pe]; if (c === '(') pd++; else if (c === ')') { pd--; if (!pd) break; } }
  let j = NOC.indexOf('{', pe), d = 0, k = j;
  for (; k < NOC.length; k++) { const c = NOC[k]; if (c === '{') d++; else if (c === '}') { d--; if (!d) return NOC.slice(j, k + 1); } }
  return '';
})();
ok('[自检] 取到 fuseLine 函数体', flBody.indexOf('_fz') >= 0);
const runFuse = new Function('x', probSrc + '\n' + flBody.replace('function fuseLine(x)', ''));
ok('★ fuseLine 按 type 取定义（不是写死某一个事件）', /probDefOfType\(x && x\.type\)/.test(flBody));
ok('★ 后排蓄势的学后胜率带「当日封板」',
  runFuse({ type: '后排涨停概率', _fz: { prob: 61, model: 72 } }).indexOf('（当日封板 · 模型') >= 0);
ok('★ 趋势票的学后胜率带「次日最高涨≥3%」',
  runFuse({ type: '趋势票', _fz: { prob: 61, model: 72 } }).indexOf('（次日最高涨≥3% · 模型') >= 0);
ok('★ 认不出 type 时不带任何事件词（不许猜）',
  runFuse({ type: '陌生的', _fz: { prob: 61, model: 72 } }).indexOf('封板') < 0);

// ---------------- ④ 资金数字：统计窗口必须是前提 ----------------
sec('【④ 资金数字：不写窗口就等于没说（当日累计 vs 1分钟增量）】');
ok('FLOW_WIN 是单一定义源（改窗口只动一处）', /const FLOW_WIN = '当日累计';/.test(SRC));
const moneyLine = SRC.split('\n').find(l => /净额\$\{\(x\.mainInflow/.test(l)) || '';
ok('★ 大单卡片的净额带窗口', /净额.*万（\$\{FLOW_WIN\}）/.test(moneyLine), moneyLine.trim().slice(0, 60));
ok('★ 四级买卖对比带窗口', /买卖对比（\$\{FLOW_WIN\}）/.test(SRC));
ok('★ 好标的挖掘的板块主力净流入带窗口', /主力净流入\$\{x\.sectorInflow != null \? inf\(x\.sectorInflow\) : '缺失'\}（\$\{FLOW_WIN\}）/.test(SRC));
// 反证：卡片上确实同时存在"1分钟流入"这一分钟级数字 —— 两个数量级差两个档，不标必然读错
ok('[反证] 同一批文案里确实并列着分钟级增量（所以窗口不是可选项）', /1分钟流入|1分钟净流入/.test(SRC));
ok('净额来自 em.js 的 f62（当日累计），不是别的窗口',
  /if \(f\.today\) s\.mainInflow = f\.today;/.test(SRC) && /today: \+d\.f62 \|\| 0/.test(fs.readFileSync('./em.js', 'utf8')));

// ---------------- ⑤ 参考止损：-3% 与账户止损线不是一回事 ----------------
sec('【⑤ 参考止损：给的数是谁的？跟模拟盘执行的那根线差多少？】');
const stopSrc = slice('const STOP_REF_PCT = -3;', '// 强势信号判定');
ok('[自检] 切到参考止损段', /function stopRefOf\(/.test(stopSrc) && /function stopRefNote\(/.test(stopSrc));
const mkStop = holdings => new Function('fs', 'path', '__dirname', `
${stopSrc}
return { STOP_REF_PCT, stopRefOf, stopRefNote };
`)({ readFileSync: () => JSON.stringify(holdings) }, { join: (a, b) => a + '/' + b }, '/x');
const S1 = mkStop({ stopPct: -8 });
ok('STOP_REF_PCT 是 -3（数值照旧，改它会波及全部历史文案）', S1.STOP_REF_PCT === -3, S1.STOP_REF_PCT);
ok('stopRefOf 按现价 -3% 算', S1.stopRefOf({ price: 10 }) === '9.70', S1.stopRefOf({ price: 10 }));
ok('现价取不到时返回 -（不是 0，也不是 NaN）', S1.stopRefOf({}) === '-' && S1.stopRefOf(null) === '-');
const note1 = S1.stopRefNote();
ok('★ 说明里同时给出「-3% 通用参考位」与「账户 N% 止损线」两层前提',
  /现价-3%通用参考位/.test(note1) && /模拟盘按持仓页设置的 8% 止损线执行/.test(note1), note1);
// ⛔ 核心事实：这两个数不是一回事（注释原写「与模拟盘 sl 一致」是错的）
const HJS = fs.readFileSync('./holdings.js', 'utf8');
const defStop = (HJS.match(/const DEFAULTS = \{[^}]*stopPct:\s*(-?\d+)/) || [])[1];
ok('★ 账户默认止损线是 -8，与参考止损 -3 差 5 个点（两者不是同一个数）',
  +defStop === -8 && +defStop !== S1.STOP_REF_PCT, '账户' + defStop + ' vs 参考' + S1.STOP_REF_PCT);
ok('注释里已写明"根本不一致"（不许再写回"与模拟盘 sl 一致"）', /\*\*根本不一致\*\*/.test(SRC));
// 账户改过止损线后，说明必须跟着变（不是写死 8）
const S2 = mkStop({ stopPct: -5 });
ok('★ 账户止损改成 -5 后说明跟着改（读的是真实配置，不是写死的 8）',
  /设置的 5% 止损线/.test(S2.stopRefNote()), S2.stopRefNote());
const S3 = mkStop({});   // 配置里没有 stopPct → 不许崩、不许输出 undefined
ok('配置缺 stopPct 时不输出 undefined（兜底到上一次的值）', !/undefined|NaN/.test(S3.stopRefNote()), S3.stopRefNote());

// ---------------- ⑥ 文案：参考止损出现的地方必须带说明 ----------------
sec('【⑥ 「参考止损」这四个字出现的地方，说明必须跟在同一行】');
const stopLines = SRC.split('\n').map((l, i) => ({ i: i + 1, l })).filter(o => /参考止损/.test(o.l) && !/^\s*\/\//.test(o.l));
ok('[自检] 扫到参考止损文案 ' + stopLines.length + ' 处', stopLines.length >= 2, stopLines.length);
const badStop = stopLines.filter(o => !/stopRefNote\(\)/.test(o.l));
ok('★ 每处都调了 stopRefNote()（数给出去了，前提就得跟着给出）', badStop.length === 0,
  badStop.length ? badStop.map(o => 'L' + o.i).join(',') : '0 处遗漏');

// ---------------- ⑦ 面板与推送同一份口径 ----------------
sec('【⑦ 前端：同一个数在面板上也得有前提（不许面板裸奔、推送才补）】');
ok('★ 大单卡片的概率条写明「当日封板概率预测」', /当日封板概率预测/.test(HTML));
ok('★ 大单卡片的净额写明当日累计', /主力净额 <b class="up">\$\{fmtY\(x\.mainInflow\)\}<\/b>（当日累计）/.test(HTML));
ok('★ 补涨龙副标题写明「当日封板概率」（与推送同一口径）', /同板低位滞涨股 · 当日封板概率/.test(HTML));
ok('[反证] 面板上已无裸的「涨停概率预测」', !/涨停概率预测/.test(HTML));

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
