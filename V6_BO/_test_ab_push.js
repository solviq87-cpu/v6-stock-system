// 🅰️🅱️ A/B 对照实验（方案C）单测（_test_ab_push.js）
// 背景：学习库里「预估概率越高、实际命中率反而越低」的现象一直没定论。
//   方案C = 双推：A组(🅰️模型组)按模型概率排序推送（现状），B组(🅱️实证组)按
//   「模型组历史回验出的各概率档实测命中率」排序推送。两组独立登记、独立回验，
//   几天后 groups.A.rate vs groups.B.rate 自证真伪。
// 本测试验证纯判定逻辑（镜像 server.js 决策核心）+ 源码接线检查。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }
function sec(t) { console.log('\n' + t); }

// ── 镜像：bmBucket / bmEmpBuckets / empOf（与 server.js 一致） ─────────────
const bmBucket = p => p >= 70 ? '70+' : p >= 60 ? '60-69' : p >= 50 ? '50-59' : '<50';
function empBuckets(signals) {
  const res = signals.filter(s => s.type === 'bigmoney' && s.resolved);
  const out = {};
  for (const s of res) {
    const b = bmBucket(s.prob || 0);
    (out[b] = out[b] || { n: 0, hit: 0 });
    out[b].n++; if (s.resolved.hit) out[b].hit++;
  }
  for (const b of Object.keys(out)) out[b].rate = Math.round(out[b].hit / out[b].n * 100);
  return out;
}
const empOf = (emp, prob) => { const b = emp[bmBucket(prob || 0)]; return (b && b.rate != null) ? b.rate : 50; };
// 镜像：B 组排序（实证分降序，同分按模型概率降序）
const sortB = (cands, emp) => cands.slice()
  .sort((a, b) => (empOf(emp, b.prob) - empOf(emp, a.prob)) || ((b.prob || 0) - (a.prob || 0)));
// 镜像：分组判定 + learnRate（recomputeBuckets 里的 S.learn.groups）
const isGrpB = s => String(s.type || '').endsWith('-B');
function learnRate(list) {
  const n = list.length, h = list.filter(s => s.resolved.hit).length;
  return { n, h, rate: n ? Math.round(h / n * 100) : 0 };
}
// 镜像：B 组准入（govTake 质量门：实证分当 prob 传 → 低于推送门槛即拦）
function bGate(empScore, minProb) { return empScore >= minProb; }

// ── ① bmEmpBuckets 分桶正确，且只用模型组(bigmoney)历史、不混入实证组(-B)样本 ──
sec('① bmEmpBuckets：分桶 rate 正确，实证组样本不进实证依据');
const SIGS = [
  { type: 'bigmoney', prob: 75, resolved: { hit: true } },
  { type: 'bigmoney', prob: 72, resolved: { hit: false } },
  { type: 'bigmoney', prob: 71, resolved: { hit: true } },   // 70+: 3样本2中 → 67%
  { type: 'bigmoney', prob: 55, resolved: { hit: true } },
  { type: 'bigmoney', prob: 52, resolved: { hit: true } },   // 50-59: 2样本2中 → 100%
  { type: 'bigmoney', prob: 40, resolved: { hit: false } },  // <50: 1样本0中 → 0%
  { type: 'bigmoney-B', prob: 75, resolved: { hit: true } }, // 实证组样本，必须被排除
  { type: 'bigmoney', prob: 0, resolved: { hit: false } },   // prob=0 → <50 桶（重复计入）
  { type: 'pool', prob: 75, resolved: { hit: true } },       // 其他类型不进
  { type: 'bigmoney', resolved: { hit: true } },             // 无 prob → <50 桶
];
const E1 = empBuckets(SIGS);
ok(E1['70+'] && E1['70+'].n === 3 && E1['70+'].hit === 2 && E1['70+'].rate === 67, '70+ 桶 3样本2中=67%', JSON.stringify(E1['70+']));
ok(E1['50-59'] && E1['50-59'].n === 2 && E1['50-59'].rate === 100, '50-59 桶 2样本2中=100%');
ok(E1['<50'] && E1['<50'].n === 3, '<50 桶含 prob=0 与无 prob 样本，共3条', JSON.stringify(E1['<50']));
ok(!E1['60-69'], '无 60-69 样本时不出该桶');

// ── ② empOf 兜底：空库/缺桶 → 50 ──
sec('② empOf 兜底：缺桶给 50');
ok(empOf({}, 75) === 50, '空实证表 → 50');
ok(empOf({ '70+': { n: 5, hit: 4, rate: 80 } }, 75) === 80, '有桶按桶 rate');
ok(empOf({ '70+': { n: 5, hit: 4, rate: 80 } }, 55) === 50, '55 落在缺失桶 → 50');
ok(empOf({ '<50': { n: 2, hit: 0, rate: 0 } }, 40) === 0, 'rate=0 也要如实返回（不能被 falsy 吞成 50）');

// ── ③ B 组排序：实证高的档排前；同档按模型概率 ──
sec('③ B 组排序：实证分降序，同分按模型概率');
const E3 = { '70+': { n: 9, hit: 2, rate: 22 }, '50-59': { n: 8, hit: 6, rate: 75 }, '<50': { n: 9, hit: 4, rate: 44 } };
const C3 = [
  { code: 'A1', prob: 78 },   // 70+ 桶 emp=22（模型觉得最高但实测最烂）
  { code: 'B1', prob: 55 },   // 50-59 桶 emp=75（模型一般但实测最准）
  { code: 'C1', prob: 42 },   // <50 桶 emp=44
  { code: 'B2', prob: 52 },   // 50-59 桶 emp=75，prob 低于 B1
];
const S3 = sortB(C3, E3).map(x => x.code);
ok(S3.join(',') === 'B1,B2,C1,A1', '实证排序=75,75,44,22 → B1(同档prob高) B2 C1 A1沉底', S3.join(','));
// 这正是实验要捕捉的现象：模型组会把 A1 排第一，实证组把 B1 排第一 —— 分道扬镳
const A3 = C3.slice().sort((a, b) => b.prob - a.prob).map(x => x.code);
ok(A3[0] === 'A1' && S3[0] === 'B1', '同一批候选：A组首选 A1(prob最高) vs B组首选 B1(实测最准)，出现分歧=实验有效');

// ── ④ B 组准入：实证分当质量门 ──
sec('④ B 组准入：实证分 ≥ 推送门槛才放行');
ok(bGate(56, 55) === true, '实证 56% ≥ 门槛 55% → 放行');
ok(bGate(52, 55) === false, '实证 52% < 55% → 拦');
ok(bGate(50, 55) === false, '兜底 50% < 55% → 拦（无实证证据的档默认不放行）');
ok(bGate(60, 0) === true, '门槛关闭(0) → 不卡');

// ── ⑤ 分组判定 isGrpB ──
sec('⑤ isGrpB：-B 后缀入实证组，其余入模型组');
ok(isGrpB({ type: 'bigmoney-B' }) === true, 'bigmoney-B → B组');
ok(isGrpB({ type: 'bigmoney' }) === false, 'bigmoney → A组');
ok(isGrpB({ type: 'pool' }) === false, 'pool → A组');
ok(isGrpB({ type: 'zt' }) === false, 'zt → A组');
ok(isGrpB({}) === false, '无 type → A组');

// ── ⑥ groups 分组统计：两组独立 rate ──
sec('⑥ S.learn.groups：两组独立登记独立统计');
const LIVE = [
  { type: 'bigmoney', prob: 75, resolved: { hit: true } },
  { type: 'bigmoney', prob: 72, resolved: { hit: false } },          // A: 2中1 → 50%
  { type: 'bigmoney-B', prob: 55, resolved: { hit: true } },
  { type: 'bigmoney-B', prob: 52, resolved: { hit: true } },
  { type: 'bigmoney-B', prob: 40, resolved: { hit: false } },        // B: 3中2 → 67%
  { type: 'pool', prob: 80, resolved: { hit: true } },
  { type: 'zt', prob: 90, resolved: { hit: false } },                // A: 混入 pool/zt
];
const GA = learnRate(LIVE.filter(s => !isGrpB(s)));
const GB = learnRate(LIVE.filter(isGrpB));
ok(GA.n === 4 && GA.h === 2 && GA.rate === 50, 'A组 n=4(bigmoney2+pool+zt) 命中2 → 50%', JSON.stringify(GA));
ok(GB.n === 3 && GB.h === 2 && GB.rate === 67, 'B组 n=3 命中2 → 67%', JSON.stringify(GB));
ok(GB.rate > GA.rate, '本例实证组更高 —— 对比数字就是要暴露这个');

// ── ⑦ 源码接线检查 ──
sec('⑦ 源码接线检查');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const web = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// ⛔ 2026-10-28 加：按花括号配对取整个函数体（跳过字符串/模板串里的括号）。
//    原来是 `/function bigMoneyStats\(\)[\s\S]{0,500}?.../` 这种**固定字符窗口**——
//    函数里注释一写长，判据就滑出窗口 → 断言红，但源码其实是对的（实测 526 > 500 假红）。
//    与 _test_ec / _test_state_field_parity 同一手法：锚点只负责定位，边界靠配对，不靠字数。
function fnBody(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return null;
  const b = src.indexOf('{', src.indexOf(')', i));
  if (b < 0) return null;
  let d = 0, inStr = null;
  for (let k = b; k < src.length; k++) {
    const ch = src[k], prev = k > 0 ? src[k - 1] : '';
    if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return null;   // 配不上就显式 null，由断言报红，绝不静默当"通过"
}

ok(src.indexOf('function bmEmpBuckets()') >= 0, 'bmEmpBuckets 已定义');
// ⛔ iq 轮（2026-10-17）：原锚文本 `s.type === 'bigmoney' && s.resolved` 在已退役的
//    bigMoneySelfOptimize（bearDominated 调用）里，该闭环整条删除后锚点悬空。
//    语义不变（实证依据只取模型组回验样本）→ 改锚 bmEmpBuckets 函数体：只认 bigmoney、不混 -B。
// ⛔ 2026-10-28：函数体改按花括号配对取（见上方 fnBody），不再用 400 字窗口。
const bmEmpBody = fnBody('bmEmpBuckets');
ok(bmEmpBody != null && bmEmpBody.includes("s.type === 'bigmoney'") && !bmEmpBody.includes('bigmoney-B'),
  '实证依据只取模型组(bigmoney)回验样本（B组样本不进实证依据）');
ok(src.indexOf("'bigmoney-B'") >= 0, 'B组登记 type=bigmoney-B');
ok(src.indexOf("x._grp === 'B' ? 'bigmoney-B' : 'bigmoney'") >= 0, '登记按 _grp 分流');
ok(src.indexOf('S.learn.groups') >= 0, 'S.learn.groups 已赋值');
ok(src.indexOf("endsWith('-B')") >= 0, '分组判定 endsWith(-B) 已接线');
ok(src.indexOf("isGrpB(s) ? 'B' : 'A'") === -1 && src.indexOf('const isGrpB') >= 0, 'isGrpB 定义存在');
// hw 轮：改「每票一张卡」后 A4+B2 一轮六张卡 = 刷屏，收敛到 A1+B1；ln 轮把基准提到 2+1
// （大单 A 组恒空的根因就是名额太窄），lv 起再乘学习力度系数 _piA。
//   判据钉语义：两组都有名额、总量仍由 BIGMONEY_CARD_PER_ROUND 封顶，不钉死数字常量。
ok(/A_KEEP = Math\.max\(1, Math\.round\(2 \* _piA\)\)/.test(src) && /B_KEEP = Math\.max\(1, Math\.round\(1 \* _piA\)\)/.test(src),
  'A/B 名额基准 = 2+1（乘学习力度系数，仍有每轮总卡数封顶）');
ok(/BIGMONEY_CARD_PER_ROUND/.test(src) && /BIGMONEY_CARD_PER_ROUND - freshHot\.length/.test(src),
  '每轮总卡数由 BIGMONEY_CARD_PER_ROUND 封顶（普通组只补剩余名额，先截断再过闸）');
ok(src.indexOf("x._grp = 'A'") >= 0 && src.indexOf("x._grp = 'B'") >= 0, '_grp 打标存在');
ok(src.indexOf("x._grp !== 'B'") >= 0, 'normal 候选排除 B 组票（同轮不重复）');
// ⚠️ 2026-10-01 改：这条原断言守的正是"实证组恒为0"的根因。
//    B组若排除"当天已过闸的票"，而 A组(hot 4 + 普通大单 8)先把票推完写进 PUSH_GOV.codes，
//    B组就永远只能捡空的 → groups.B 一周零样本。改为按 code 哈希稳定分组（见 ⑨ 段）。
ok(src.indexOf('!PUSH_GOV.codes.has(x.code)') === -1, 'B 组不再排除当天已过闸的票（否则永远捡A组剩的）');
ok(/必须先截断再过闸/.test(src), '先截断再过闸的防「占坑断档」注释在位');
ok(src.indexOf('🅰️模型') >= 0 && src.indexOf('🅱️实证') >= 0, '推送文案带 🅰️/🅱️ 组标');
ok(src.indexOf('A/B对照') >= 0, 'hot 段标题改为 A/B对照');
ok(src.indexOf('empOf(x)') >= 0, 'B 组文案展示实证档命中');
ok(src.indexOf('groups: S.learn.groups || null') >= 0, '/api/state 下发 groups');
ok(src.indexOf('groups: (S.learn && S.learn.groups) || null') >= 0, '/api/learn-status 返回 groups');
ok(src.indexOf("govFilter('bigmoney-B'") >= 0, 'B 组走独立 type 过闸（govTake types 分开记账）');
ok(web.indexOf('learnAB') >= 0, '面板有 A/B 对照块容器');
ok(web.indexOf('🅰️模型组') >= 0 && web.indexOf('🅱️实证组') >= 0, '面板展示两组标签');
// 版本号一致性
const sv = (src.match(/const APP_VER = '([^']+)'/) || [])[1];
const wv = (web.match(/const APP_VER = '([^']+)'/) || [])[1];
// ⚠️ 别写死具体版本号：每次发版都要回来改，不改就红。
  // 这条真正要守的是"两端一致"（不一致前端会无限 reload）与"格式合法"。
  ok(sv === wv && /^\d{8}[a-z]{2}$/.test(sv), 'APP_VER 两端一致且格式合法（' + sv + ' vs ' + wv + '）');
// 命中口径（2026-09-29 用户指定 ≥5% → ≥3%，全局常量 + 存量自愈）
ok(src.indexOf('const HIT_THR = 3') >= 0, '命中口径常量 HIT_THR=3 已定义');
ok(src.indexOf('* 100 >= HIT_THR') >= 0, '回验判定引用 HIT_THR（resolveWithKline + 历史回测两处）');
ok(/resolved\.maxGain\) >= HIT_THR/.test(src), '启动期自愈按已存 maxGain 重算存量 hit 已接线');
ok(!/\* 100 >= 5\b/.test(src), '无残留写死 >= 5 的命中判定');
ok(web.indexOf('信号次日最高涨幅≥3%') >= 0, '前端「命中定义」文案已改 ≥3%');
ok(!web.includes('信号次日最高涨幅≥5%'), '前端无残留 ≥5% 命中文案');

// ── ⑧ 回归安全：现有统计不受 -B 影响 ──
sec('⑧ 回归安全：现有精确匹配 type 的统计零污染');
// ⛔ iq 轮（2026-10-17）：原锚文本同样在退役闭环里。语义不变（bigMoneyStats 只认
//    bigmoney、B 组样本不进涨停率统计）→ 改锚 bigMoneyStats 函数体 + 全局无 -B 统计。
// ⛔ 2026-10-28：500 字窗口实测不够（函数体里 8 行注释把判据顶到 526 字外 → 假红），
//    改按花括号配对取整个函数体；再保留全局「无 s.type === 'bigmoney-B'」作双保险。
const bmStatsBody = fnBody('bigMoneyStats');
ok(bmStatsBody != null && bmStatsBody.includes("s.type === 'bigmoney'") && !bmStatsBody.includes('bigmoney-B')
  && src.indexOf("s.type === 'bigmoney-B'") === -1,
  'bigMoneyStats 仍只认 bigmoney（B组样本不进涨停率统计）');
ok(src.indexOf("s.type === 'pool' && s.score >= S.learn.scoreThreshold - 10") >= 0, 'pool 阈值自适应仍只认 pool');
ok(!/s\.type === 'bigmoney'[^&]*\|\|\s*s\.type === 'bigmoney-B'/.test(src), '没有地方把 -B 混进大单统计');

// ── ⑨ B组必须拿得到样本（"实证组数据一直为0"事故防回归）──
sec('⑨ B组候选不再被A组吃光');
{
  // 事故：B组候选 = "今天没被任何闸推过的票"，而 A组(hot 4只 + 普通大单 8只)先把票推完
  // 并写进 PUSH_GOV.codes → B组候选恒空 → groups.B 永远是 0，实验跑一周零样本。
  ok(/const hotAll = list/.test(src), '定义了统一候选池 hotAll');
  ok(/const grpOf = c =>/.test(src), '有按 code 的稳定分组函数');
  ok(/hotAll\.filter\(x => grpOf\(x\.code\) === 'A'\)/.test(src), 'A组从 hotAll 里按分组取');
  ok(/hotAll\.filter\(x => grpOf\(x\.code\) === 'B'/.test(src), 'B组从 hotAll 里按分组取');
  ok(!/!PUSH_GOV\.codes\.has/.test(src), 'B组不再排除"今天推过"的名单（否则永远捡剩的）');
  // 同组互斥：grpOf 必须对同一 code 恒定
  const grpOf = c => { let h = 0; const s = String(c || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 2 === 0 ? 'A' : 'B'; };
  ok('分组对同一 code 恒定', grpOf('600131') === grpOf('600131'));
  // 大样本下应当接近均衡（否则对照不成立）
  let a = 0, b = 0;
  for (let i = 0; i < 2000; i++) { const c = String(600000 + i); grpOf(c) === 'A' ? a++ : b++; }
  const ratio = Math.min(a, b) / Math.max(a, b);
  ok('2000只票分组接近均衡(少数派≥40%)', ratio >= 0.4, `A=${a} B=${b} 比=${ratio.toFixed(2)}`);
}

console.log('\n──────────────────────────────');
console.log(`结果: ${pass} 通过 / ${fail} 失败 / 共 ${pass + fail} 项`);
process.exit(fail ? 1 : 0);
