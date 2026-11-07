// dr 轮守门：同一个数，在两个人眼里是不是同一个东西 —— 百分点的单位
//   两个百分比相减得到的是**百分点（pp）**，不是百分比；说出去必须带单位，且全项目同一个单位。
const fs = require('fs');

let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; } else { fail++; console.log('  FAIL: ' + m); } }
function eq(a, b, m) { ok(a === b, m + '  (got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b) + ')'); }

const src = fs.readFileSync('server.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

function slice(startMark, endMark) {
  const i = src.indexOf(startMark);
  if (i < 0) throw new Error('找不到起点: ' + startMark);
  const j = src.indexOf(endMark, i);
  if (j < 0) throw new Error('找不到终点: ' + endMark);
  return src.slice(i, j + endMark.length);
}
const blkUnit = slice('const NUM_UNIT = {', '\n};');
const fnPp = slice('function ppTxt(v, signed) {', '\n}\n');
const fnSignTxt = slice('function signTxt(v) {', '\n}\n');
const fnSignNum = slice('function signNum(v, unit) {', '\n}\n');
const impl = new Function('console', 'Number', 'Math',
  blkUnit + '\n' + fnPp + '\n' + fnSignTxt + '\n' + fnSignNum +
  '\nreturn { NUM_UNIT, ppTxt, signTxt, signNum };')(console, Number, Math);
const { NUM_UNIT, ppTxt, signTxt, signNum } = impl;

console.log('=== A. 登记表 ===');
['lift', 'delta', 'gapPp', 'gap'].forEach(k => {
  ok(!!NUM_UNIT[k], 'A 登记了 ' + k);
  if (NUM_UNIT[k]) {
    eq(NUM_UNIT[k].unit, 'pp', 'A ' + k + ' 单位是 pp');
    ok(!!NUM_UNIT[k].why && NUM_UNIT[k].why.length > 5, 'A ' + k + ' 写了为什么是百分点');
    ok(!!NUM_UNIT[k].label, 'A ' + k + ' 有中文名');
  }
});

console.log('\n=== B. ppTxt 出口行为 ===');
eq(ppTxt(5.2), '+5.2pp', 'B1 正数带正号 + 单位');
eq(ppTxt(-3.1), '-3.1pp', 'B2 ⛔ 负数不许出现 +−（负号来自数值本身）');
eq(ppTxt(0), '0pp', 'B3 零');
eq(ppTxt(12), '+12pp', 'B4 整数');
eq(ppTxt(5.24), '+5.2pp', 'B5 保留一位');
eq(ppTxt(-8.2), '-8.2pp', 'B6 负数一位');
eq(ppTxt(5.2, false), '5.2pp', 'B7 signed=false 时不带正号（前面已有「低」这类方向词）');
eq(ppTxt(-3.1, false), '-3.1pp', 'B8 signed=false 负数仍带负号');
// ⛔ null 是「没差出来」，不许显示成 0pp 冒充"没有差距"
eq(ppTxt(null), '-', 'B9 ⛔ null → 「-」不是 0pp');
eq(ppTxt(undefined), '-', 'B10 undefined → 「-」');
eq(ppTxt(NaN), '-', 'B11 NaN → 「-」');
eq(ppTxt('abc'), '-', 'B12 非数字串 → 「-」');
// 反证：老写法会怎么说
ok(('+' + null) === '+null', 'B13 反证：老写法 `+${v}` 碰 null 会打出 "+null"');
ok(('+' + (-3.1)) === '+-3.1', 'B14 ⛔ 反证：老写法 `+${v}` 碰负数会打出 "+-3.1"');

console.log('\n=== C. 反证：不带单位会被读成百分比 ===');
// 封板 62%（溢价 +5.2）—— 用户会把 5.2 当成又一个百分比
const ztP = 62, lift = 5.2;
ok(Math.abs(ztP - lift) > 50, 'C1 62% 与 5.2% 相差 ' + (ztP - lift).toFixed(1) + ' 个点，读错就是两个概念');
ok(/pp$/.test(ppTxt(lift)), 'C2 新写法以 pp 结尾，不会被当成百分比');
ok(!/%$/.test(ppTxt(lift)), 'C3 新写法不以 % 结尾');

console.log('\n=== D. 源码：同一类数不许有多种说法 ===');
const stripC = (l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; };
const code = src.split('\n').filter(l => !l.startsWith('const APP_VER = ')).map(stripC);
const hcode = html.split('\n').filter(l => !l.startsWith('const APP_VER = ')).map(stripC);

// ⛔ 裸的「溢价 X」（没单位）
const bareLift = code.filter(l => /溢价/.test(l) && !/ppTxt\(/.test(l) && /\$\{/.test(l));
ok(bareLift.length === 0, 'D1 ⛔ 不再有不带单位的裸「溢价${...}」' + (bareLift.length ? ' → ' + bareLift[0].slice(0, 90) : ''));
// ⛔ 用「点」当百分点单位（股民说「50 点」指的是指数点位）
const dianPp = code.filter(l => /\$\{[^}]*\}点/.test(l) && /(溢价|修正|形态|低|平均)/.test(l));
ok(dianPp.length === 0, 'D2 ⛔ 不再用「点」当百分点单位（易被读成指数点位）' + (dianPp.length ? ' → ' + dianPp[0].slice(0, 90) : ''));
// 必须走唯一出口
const ppCalls = code.filter(l => /ppTxt\(/.test(l)).length;
ok(ppCalls >= 6, 'D3 百分点文案至少 6 处走 ppTxt（got ' + ppCalls + '）');

console.log('\n=== E. 前端：正负号与配色不许写死 ===');
ok(!hcode.some(l => /溢价\+\$\{/.test(l)), 'E1 ⛔ 不再有硬编码 `溢价+${...}`（负数会显示 +-3.2）');
ok(hcode.some(l => /溢价\$\{sign\(x\.lift\)\}pp/.test(l)), 'E2 溢价正负号走 sign()');
ok(!hcode.some(l => /较基准 <b class="up">\+\$\{/.test(l)), 'E3 ⛔ 不再有写死 up 配色 + 硬编码正号的「较基准」');
ok(hcode.some(l => /较基准 <b class="\$\{cls\(x\.lift\)\}">\$\{sign\(x\.lift\)\}pp/.test(l)), 'E4 较基准的配色与符号都随值走');

console.log('\n=== F. 同一个卡片上两个百分比必须各自标基准 ===');
// 持仓卡片：顶部是「相对成本的浮盈比例」，下面「现价」旁是当日涨跌幅 —— 基准不同，必须都标
ok(hcode.some(l => /浮盈'\s*\+\s*\(?x\.floatPct/.test(l) || /浮盈/.test(l) && /floatPct/.test(l)),
  'F1 顶部浮盈比例标了「浮盈」（相对成本）');
ok(hcode.some(l => /floatPct/.test(l) && /title=/.test(l) && /成本/.test(l)),
  'F2 浮盈比例在 title 里说明是相对成本价、不是当日涨幅');
ok(hcode.some(l => /当日\$\{_sg\(x\.pct\)\}%/.test(l)), 'F3 现价旁那个百分比标了「当日」');
ok(hcode.some(l => /浮盈亏/.test(l)) && hcode.some(l => /当日 .*元|当日盈亏/.test(l)),
  'F4 元为单位的两项（浮盈亏 / 当日盈亏）本来就分得清');

console.log('\n=== G. 正负号不许写死（线上实证 9 处「修正评分 +-1.7」）===');
eq(signNum(-1.7), '-1.7', 'G1 ⛔ 负修正打出 -1.7，不是 +-1.7');
eq(signNum(2.5, '%'), '+2.5%', 'G2 正数带正号 + 单位');
eq(signNum(0), '0', 'G3 零');
eq(signNum(5.24, '%'), '+5.2%', 'G4 保留一位');
eq(signNum(null), '-', 'G5 ⛔ null → 「-」不是 0');
eq(signNum(NaN), '-', 'G6 NaN → 「-」');
eq(signTxt(-1), '', 'G7 负数不加正号');
eq(signTxt(3), '+', 'G8 正数加正号');
eq(signTxt(null), '', 'G9 null 不加正号（Number(null)===0 不是 >0）');
// 反证：老写法 —— 线上 /api/state 里实证 9 处
eq('首次自动修正评分 +' + (-1.7), '首次自动修正评分 +-1.7', 'G10 ⛔ 反证：老写法打出 "+-1.7"');
ok(('+' + (-1.7)).indexOf('+-') === 0, 'G11 ⛔ 反证：写死 + 时负数变成 +− 开头');

console.log('\n=== H. 源码：不再有写死正号 / 写死涨色 ===');
const badSign = [
  [/评分 \+\$\{/, '评分前写死 +'],
  [/累计\+\$\{/, '累计涨幅前写死 +'],
  [/净流入\+\$\{/, '净流入前写死 +'],
  [/偏离5日线\+\$\{/, '偏离前写死 +'],
  [/低点仅\+\$\{/, '距低点前写死 +']
];
badSign.forEach(([re, name]) => {
  const hit = code.filter(l => re.test(l));
  ok(hit.length === 0, 'H ⛔ 不再有' + name + (hit.length ? ' → ' + hit[0].slice(0, 80) : ''));
});
ok(code.some(l => /评分 \$\{signNum\(/.test(l)), 'H6 评分修正走 signNum');
ok(code.some(l => /净流入\$\{signTxt\(/.test(l)), 'H7 净流入符号走 signTxt');
ok(!code.some(l => /signNum\([^)]*"%"\)\}%/.test(l)), 'H8 ⛔ signNum 已带单位，外面不许再补一个 %');
const hHardUp = hcode.filter(l => /class="up">\+\$\{/.test(l));
ok(hHardUp.length === 0, 'H9 ⛔ 前端不再有写死 up 配色 + 硬编码正号' + (hHardUp.length ? ' → ' + hHardUp[0].slice(0, 80) : ''));
ok(hcode.some(l => /const sign = v => \(v == null/.test(l)), 'H10 前端 sign 有空值兜底（不打出 "null%"）');

console.log('\n=== I. 存量自愈：磁盘上躺着的旧文案也要走这道校验 ===');
const fnHeal = slice('function healSignArtifact() {', '\n}\n');
let saved = 0;
// ⛔ 注入后返回的是**函数本身**；且 healSignArtifact 无形参、靠闭包取 S/saveLearnHistory
//    → 必须每次重新构造并立即执行，否则拿到的是函数不是返回值（踩过 N 次）。
const callHeal = (S, saveCb) => new Function('S', 'saveLearnHistory', 'console',
  fnHeal + '\nreturn healSignArtifact();')(S, saveCb, console);
const S1 = { learnHistory: [
  { note: '首次自动修正评分 +-1.7，判定「差·自动降权」' },
  { note: '首次自动修正评分 +2.5，判定「优·自动加权」' },
  { note: '样本攒够9个（命中33%）→ 首次自动修正评分 +-1.7' },
  { note: '没有数字的一条', n: 3 }
] };
const n1 = callHeal(S1, () => { saved++; });
eq(n1, 2, 'I1 自愈命中 2 条（只改写死正号+负数的）');
eq(S1.learnHistory[0].note, '首次自动修正评分 -1.7，判定「差·自动降权」', 'I2 ⛔ +-1.7 → -1.7');
eq(S1.learnHistory[1].note, '首次自动修正评分 +2.5，判定「优·自动加权」', 'I3 ✅ 正数本来就对的不动');
eq(S1.learnHistory[2].note, '样本攒够9个（命中33%）→ 首次自动修正评分 -1.7', 'I4 长句里的也归一');
eq(S1.learnHistory[3].note, '没有数字的一条', 'I5 无关文案不动');
eq(saved, 1, 'I6 有改动才落盘，且只落一次');
const n2 = callHeal(S1, () => { saved++; });
eq(n2, 0, 'I7 ⛔ 幂等：再跑一遍 0 条（不会反复写盘）');
eq(saved, 1, 'I8 幂等：没有多余落盘');
eq(callHeal({ learnHistory: null }, () => { saved++; }), 0, 'I9 非数组时不炸');
ok(code.some(l => /^healSignArtifact\(\);/.test(l)), 'I10 启动链里真的调了一次（只挂函数不挂调用 = 白写）');

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_ppunit: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
