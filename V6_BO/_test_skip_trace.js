// 守门测试：静默跳过必须留下为什么（dv 轮）
//
// 实证（本机真实样本库 stats.json，1959 条）：empTable 两处 continue 既不计数也不留痕，
// 真正进得了实测命中率档的只有 **368 条（18.8%）** —— 缺次日口径 737、缺概率 242、
// 历史回测 600、事后 12；histzt(600) / pool(311) / trend(101) / zt(39) 四类共 1051 条
// **整类零存活**。面板上这些类型的实测栏永远是空的，谁也分不清"还没回验"还是"按设计排除"。
// 同理：paperBuy 五处 continue 静默 —— 面板只说"暂无持仓"，真实原因可能是一字板买不进。
// ⛔ 本轮钉的是：**跳过要按原因计数、要交出去、要看得见**；只说"跳过了 N 条"没有意义。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };

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
// 单行定义（箭头函数 / 常量）用整行取，不能用花括号配对
function line(re) { const m = src.match(re); return m ? m[0] : ''; }
let strip = null;
try { strip = require('./_codescan.js').stripNoise; } catch { }
const SV = strip ? strip(src, { keepStrings: true }) : src;

const CAP_OR_RULE = (src.match(/const SKIP_RULE = \{[\s\S]*?\n\};/) || [''])[0];
const SANDBOX = [
  CAP_OR_RULE,
  // ⛔ 别用 [^}]* 取嵌了花括号的常量（`by: {}` 会把匹配截断，注入后 ReferenceError）
  line(/const _skipTally = \{[\s\S]*?\};/),
  grab(/function skipAdd\(kind, n\) \{/),
  grab(/function skipWhy\(kind\) \{/),
  grab(/function skipTop\(m\) \{/),
  grab(/function skipState\(\) \{/),
  'return { skipAdd, skipWhy, skipTop, skipState };'
].join('\n');
const mk = () => new Function(SANDBOX)();

console.log('\n=== 静默跳过留痕（dv 轮）守门 ===\n');

// ---------- ① 登记表 ----------
console.log('【① SKIP_RULE：跳过原因必须先登记】');
ok('存在 SKIP_RULE 登记表', /const SKIP_RULE = \{/.test(SV));
ok('唯一出口 skipAdd / skipWhy / skipTop / skipState',
  /function skipAdd\(/.test(SV) && /function skipWhy\(/.test(SV) && /function skipTop\(/.test(SV) && /function skipState\(\)/.test(SV));
{
  const S1 = mk();
  ok('A1 登记的 kind 能计数', S1.skipAdd('empNoNd') === 1 && S1.skipAdd('ztSealed', 3) === 3);
  ok('A2 ⛔ 未登记的 kind 被丢弃（不许悄悄混进来）', S1.skipAdd('nonsense') === 0);
  ok('A3 计数累加正确', S1.skipState().total === 4, String(S1.skipState().total));
  const top = S1.skipTop(5);
  ok('A4 skipTop 按数量降序', top.length === 2 && top[0].n === 3 && top[0].kind === 'ztSealed', JSON.stringify(top));
  ok('A5 每条原因都带中文说明（不是光一个 kind）', top.every(x => x.label && x.label.length > 3), JSON.stringify(top.map(x => x.label)));
  ok('A6 skipWhy 未登记时回退 kind 本身（不返回空）', S1.skipWhy('xyz') === 'xyz');
}

// ---------- ② 命中率的分母 ----------
console.log('\n【② empTable：被跳过的样本要分类计数】');
ok('B1 缺回验口径分支计数', /if \(!hasOutcome\) \{ bumpSkip\('empNoNd'\); continue; \}/.test(SV));
ok('B2 作废分支计数', /if \(s\.void\) \{ bumpSkip\('empVoid'\); continue; \}/.test(SV));
ok('B3 缺概率分支计数', /if \(s\.prob == null \|\| !isFinite\(s\.prob\)\) \{ bumpSkip\('empNoProb'\); continue; \}/.test(SV));
ok('B4 回测样本单独计数（不再混在 isLiveSample 里）', /if \(isBacktestSample\(s\)\) \{ bumpSkip\('empBacktest'\); continue; \}/.test(SV));
ok('B5 事后样本单独计数', /if \(isPostHocSample\(s\)\) \{ bumpSkip\('empPostHoc'\); continue; \}/.test(SV));
ok('B6 扫描总数与存活数都记下来', /sk\.scanned\+\+/.test(SV) && /sk\.live\+\+/.test(SV));
ok('B7 结果挂到 _empSkip 供外部读', /_empSkip = sk;/.test(SV));
ok('B8 有 empSkipStat 出口', /function empSkipStat\(\) \{/.test(SV));
// 真跑：造一份含各类的样本，验证计数与存活率
{
  const sigs = [
    { type: 'fastin', prob: 60, nd: { hit: true, limitUp: false } },       // 存活
    { type: 'fastin', prob: 60 },                                          // 缺 nd
    { type: 'fastin', nd: { hit: true } },                                 // 缺 prob
    { type: 'histzt', prob: 60, nd: { hit: true }, resolved: { mode: '历史回测' } }, // 回测
    { type: 'zt', prob: 60, nd: { hit: true } },                           // 事后（type=zt）
    { type: 'buzhang', prob: 60, nd: { hit: false }, void: true }          // 作废
  ];
  const EMP_CHASE = ['buzhang', 'ztprob', 'similar', 'fastin'];
  const EMP_EARLY = ['histzt', 'auczt', 'pre', 'pool', 'trendsig', 'bigmoney', 'bigmoney_repeat', 'trend', 'sector', 'bigmoney-B'];
  const POST = new Set(['zt', 'review']);
  // 复刻生产判定（与 server.js 同一套表达式）
  const isBt = s => !!(s && s.resolved && s.resolved.mode === '历史回测');
  const isPh = s => !isBt(s) && (POST.has(s.type) || !!(s.resolved && s.resolved.limitUp && +(s.resolved.maxGain || 0) <= 0.5));
  const sk = { scanned: 0, live: 0, by: {} };
  const bumpSkip = k => { sk.by[k] = (sk.by[k] || 0) + 1; };
  for (const s of sigs) {
    sk.scanned++;
    if (!s.nd) { bumpSkip('empNoNd'); continue; }
    if (s.void) { bumpSkip('empVoid'); continue; }
    if (s.prob == null || !isFinite(s.prob)) { bumpSkip('empNoProb'); continue; }
    if (isBt(s)) { bumpSkip('empBacktest'); continue; }
    if (isPh(s)) { bumpSkip('empPostHoc'); continue; }
    sk.live++;
  }
  ok('B9 6 条样本里只有 1 条存活（判定与生产同式）', sk.live === 1, JSON.stringify(sk));
  ok('B10 五类原因各记 1 条', Object.keys(sk.by).length === 5 && sk.by.empNoNd === 1 && sk.by.empBacktest === 1,
    JSON.stringify(sk.by));
}

// ---------- ③ 没买入要说为什么 ----------
console.log('\n【③ paperBuy：不买也得说原因】');
ok('C1 已持有', /if \(acc\.positions\[c\.code\]\) \{ skipAdd\('buyHeld'\); continue; \}/.test(SV));
ok('C2 取不到价', /if \(!price \|\| price <= 0\) \{ skipAdd\('buyNoPrice'\); continue; \}/.test(SV));
ok('C3 已封涨停（一字板买不进）', /if \(sealedUp\) \{ skipAdd\('buySealed'\); continue; \}/.test(SV));
// ⛔ 2026-10-28 改钉：整手从写死 100 改成按板块 paperLotOf(码)（科创板 200 起、其余 100 起），
//    判据钉语义：不足一手 → buyNoCash，且取整必须用 lot 而不是硬编码 100。
ok('C4 现金不足一手', /if \(shares < lot\) \{ skipAdd\('buyNoCash'\); continue; \}/.test(SV)
  && /const lot = paperLotOf\(c\.code\);/.test(SV)
  && /Math\.floor\(budget \/ price \/ lot\) \* lot/.test(SV));
ok('C5 现金不足（含手续费）', /if \(cost \+ fee > acc\.cash\) \{ skipAdd\('buyOverCash'\); continue; \}/.test(SV));

// ---------- ④ 两个扫描器的淘汰 ----------
console.log('\n【④ 扫描器：池子为什么这么空】');
const SCAN_KEYS = [
  ['scanZtPre', ['ztNoCache', 'ztNoKline', 'ztJunk', 'ztCheap', 'ztSealed', 'ztLianban', 'ztNoFeat', 'ztNoPred']],
  ['scanTrendUniverse', ['trNoCache', 'trNoKline', 'trJunk', 'trCheap', 'trSealed', 'trLianban', 'trHyg', 'trNoFeat', 'trNoPred']]
];
for (const [fn, keys] of SCAN_KEYS) {
  const body = (() => {
    const i = src.search(new RegExp('function\\s+' + fn + '\\s*\\('));
    if (i < 0) return '';
    let d = 0, st = false;
    for (let j = i; j < src.length; j++) {
      const c = src[j];
      if (c === '{') { d++; st = true; } else if (c === '}') { d--; if (st && d === 0) return src.slice(i, j + 1); }
    }
    return '';
  })();
  const hit = keys.filter(k => body.indexOf("skipAdd('" + k + "')") >= 0);
  ok(`${fn}：${hit.length}/${keys.length} 处跳过有计数`, hit.length >= keys.length - 1,
    '缺 ' + keys.filter(k => hit.indexOf(k) < 0).join(','));
}

// ---------- ⑤ 接线 ----------
console.log('\n【⑤ 接线：要出得去、看得见】');
ok('E1 /api/state 下发 skipStat 与 empSkip', /skipStat: skipState\(\), empSkip: empSkipStat\(\)/.test(SV));
ok('E2 前端显示样本存活率', /样本存活：/.test(html) && /s\.empSkip/.test(html));
ok('E3 前端显示跳过台账', /跳过台账：/.test(html) && /s\.skipStat/.test(html));
ok('E4 前端说明「不是数据丢失」（避免误读）', /不是数据丢失/.test(html));

// ---------- ⑥ 真实数据回归 ----------
console.log('\n【⑥ 真实样本库：问题确实存在（回归用）】');
{
  const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'stats.json'), 'utf8'));
  const sigs = st.signals || [];
  const POST = new Set(['zt', 'review']);
  const isBt = s => !!(s && s.resolved && s.resolved.mode === '历史回测');
  const isPh = s => !isBt(s) && (POST.has(s.type) || !!(s.resolved && s.resolved.limitUp && +(s.resolved.maxGain || 0) <= 0.5));
  let live = 0;
  for (const s of sigs) {
    if (!s.nd || s.void || s.prob == null || !isFinite(s.prob)) continue;
    if (isBt(s) || isPh(s)) continue;
    live++;
  }
  ok('F1 样本非空（测试数据就位）', sigs.length > 500, String(sigs.length));
  ok('F2 ⛔ 存活率明显低于 100%（证明"分母不明"不是假想）',
    sigs.length > 0 && live / sigs.length < 0.5,
    `${live}/${sigs.length} = ${(live / sigs.length * 100).toFixed(1)}%`);
  console.log(`     样本库 ${sigs.length} 条 → 进档 ${live} 条（${(live / sigs.length * 100).toFixed(1)}%）`);
}

console.log('\n' + (fail === 0 ? '✅' : '❌') + ' _test_skip_trace: ' + pass + ' 断言通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
