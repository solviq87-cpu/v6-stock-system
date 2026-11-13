/* _test_auczt_calib.js —— 竞价 prob 诚实刻度守门（e) 轮建立，h2 轮重写）
 * 背景：e) 轮加了一道「按 prob 分档覆写」（p<45→9 / p<55→20），hy 轮（10-15）把 score→prob 改成
 *   已经诚实的分段式之后，两层叠成**双层标定**：新刻度下 prob 几乎全 <45 → 齐刷 9（常数），
 *   还把情绪/风险/环境/因子修正全部乘进黑洞。h2 轮改为**单层标定 + 实测上限封顶**。
 * 本守门钉的语义：
 *   ① 沙箱真跑 aucztProbClamp（从 server.js 花括号配对抽取，不复刻副本）：值域 [2,45]、四舍五入、缺值不冒充；
 *   ② auczt 闸门 AUCZT_PUSH_PROB 必须落在封顶 45 之内且停在实盘分位顶端（旧闸借 55 > 封顶 = 永假闸）；
 *   ③ 旧写法反证：score 0~55（实测最高分区间）全部塌成常数 9；上游修正 ±5 在旧写法下全被抹平；
 *   ④ 退役判据真跑：带 cal 标记的新样本不被数值判据误伤，无标记旧样本照旧退役；
 *   ⑤ 源码契约：ZT_INFER_PUSH_PROB=55 只归一进二/连板 / auczt 走 AUCZT_PUSH_PROB / 调用点走 aucztProbClamp / 落库带刻度标记 / empTable 仍跳过退役样本。
 * 退出码 0 = 通过；非 0 = 崩，总榜必红。
 */
const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');

let pass = 0, fail = 0;
function ok(c, msg) { if (c) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

// —— 按花括号配对抽真实函数体（⛔ 不按行号/固定窗口抠）——
function grabFn(name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
  if (!m) throw new Error('函数不存在: ' + name);
  let i = src.indexOf('{', m.index), depth = 0;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(m.index, j + 1); }
  }
  throw new Error('花括号未闭合: ' + name);
}
const clampSrc = grabFn('aucztProbClamp');
const retSrc = grabFn('isRetiredProbScale');
const ceilLine = (src.match(/const AUCZT_PROB_CEIL = \d+;/) || [''])[0];
const constLine = (src.match(/const AUCZT_PROB_HONEST_MAX = \d+;/) || [''])[0];
if (!ceilLine) { console.log('  ✗ 缺 AUCZT_PROB_CEIL 常量'); fail++; }
if (!constLine) { console.log('  ✗ 缺 AUCZT_PROB_HONEST_MAX 常量（退役判据无处锚定）'); fail++; }

const sandbox = new Function('return (function(){' + ceilLine + '\n' + constLine + '\n' + clampSrc + '\n' + retSrc +
  '\nreturn { aucztProbClamp, isRetiredProbScale, CEIL:' + (ceilLine.match(/\d+/) || ['0'])[0] + ', HONEST_MAX:' + (constLine.match(/\d+/) || ['0'])[0] + ' }; })()')();
const clamp = sandbox.aucztProbClamp, retired = sandbox.isRetiredProbScale;

// —— ① 行为断言（真跑）——
const cases = [
  [0, 2], [-50, 2], [1, 2], [2, 2],
  [8, 8], [10, 10], [18, 18], [28, 28], [33, 33], [37.4, 37], [37.6, 38],
  [45, 45], [46, 45], [80, 45], [92, 45],
  [null, null], [undefined, undefined],
];
let cOK = true;
for (const [inp, exp] of cases) {
  const got = clamp(inp);
  if (got !== exp) { cOK = false; console.log('  ✗ aucztProbClamp(' + JSON.stringify(inp) + ') = ' + got + ' 期望 ' + exp); }
}
ok(cOK, '封顶/下限/四舍五入/' + cases.length + ' 个分位点行为正确（缺值原样返回，不拿 2 或 9 冒充）');
ok(clamp(NaN) !== clamp(NaN) || clamp(NaN) === NaN, 'NaN 不变成具体数值（不做假判断）');

// —— ② 值域 + 单调（概率越高不能越低）——
let mono = true, within = true, prev = -1;
for (let p = 0; p <= 100; p++) {
  const v = clamp(p);
  if (v < prev) mono = false;
  if (v < 2 || v > 45) within = false;
  prev = v;
}
ok(mono, 'p 0→100 逐点扫描：概率单调不降（封顶不产生倒挂）');
ok(within, '概率值域恒在 [2,45]（不虚高、不冒充 0）');
// ⛔ 2026-10-28（用户拍板 A 方案）：闸门不再借用 55，改为 auczt 专用 AUCZT_PUSH_PROB。
//    两者职责不同：封顶 45 = 「模型不许报得比实测上限高」；闸门 = 「只推分数榜顶端那一两只」。
const gateLine = (src.match(/const AUCZT_PUSH_PROB = (\d+);/) || [''])[0];
const gate = +((gateLine.match(/\d+/) || ['0'])[0]);
ok(!!gateLine, 'AUCZT_PUSH_PROB 常量存在（auczt 专用闸门，不再与一进二/连板共用 55）');
ok(gate > 0 && gate < sandbox.CEIL,
  '闸门 ' + gate + '% 落在封顶 ' + sandbox.CEIL + '% 之内 → 通道可达（旧闸 55 > 封顶 45 = 永假闸，实盘九天零外发）');
ok(gate >= 15 && gate <= 25,
  '闸门 ' + gate + '% 保持在实盘分位顶端（宁缺毋滥：低于 15 就是放宽到普推，高于 25 在实测分布下会继续零输出）');

// —— ③ 旧写法反证 ——
//   复刻 hy 轮 score→prob 映射 + e) 轮旧覆写（p<45→9 / p<55→20），断言 0~55 分（实测最高分区间）全塌成 9。
function hyProb(sc) {
  if (sc < 45) return 2 + sc * 0.2;
  if (sc < 50) return -28 + sc * 0.9;
  if (sc < 55) return -65 + sc * 1.8;
  return -95 + sc * 2.4;
}
function oldHonest(p) { if (p == null || !isFinite(p)) return p; if (p < 45) return 9; if (p < 55) return 20; return 20; }
const oldVals = new Set();
for (let sc = 0; sc <= 55; sc++) oldVals.add(oldHonest(hyProb(sc)));
ok(oldVals.size === 1 && oldVals.has(9),
  '旧写法反证：score 0~55 全部塌成常数 9（10-19 起每个信号日 prob 恒 9 的机制）');

// 反证二：旧覆写把上游修正抹平（±6 的情绪/风险/环境乘子落到同一档），新写法必须保留差异
const oldSpread = new Set([20, 25, 30, 40].map(oldHonest));
const newSpread = new Set([20, 25, 30, 40].map(clamp));
ok(oldSpread.size === 1 && newSpread.size === 4,
  '旧写法把 20/25/30/40 抹成同一个值（修正白算）；新写法 4 个值各自保留');

// 反证三：封顶只压高分端，不压掉低分端的区分度（不许为了封顶把全体拉平）
ok(clamp(8) < clamp(18) && clamp(18) < clamp(28), '低中分段仍严格单调（排序力在）');

// —— ④ 退役判据真跑：标记豁免 / 无标记照旧退役 / 非 auczt 不受影响 ——
ok(retired({ type: 'auczt', prob: 33 }) === true, '无标记的 auczt prob=33 → 判退役（旧刻度下沿 30~35 不放进新桶）');
ok(retired({ type: 'auczt', prob: 45, cal: 'h2' }) === false, '带 cal 标记的 prob=45 → 不误判退役（新刻度上限与旧下沿数值重叠）');
ok(retired({ type: 'auczt', prob: 8, cal: 'h2' }) === false, '带标记的 prob=8 正常入桶');
ok(retired({ type: 'auczt', prob: 9 }) === false, '无标记但 prob=9（旧诚实刻度）→ 照旧入桶，历史证据不丢');
ok(retired({ type: 'yier', prob: 80 }) === false && retired(null) === false, '其它类型 / 空值不受 auczt 退役判据影响');

// —— ⑤ 源码契约（钉语义不钉字符串）——
ok(/^\s*const ZT_INFER_PUSH_PROB = 55;/m.test(src), 'ZT_INFER_PUSH_PROB 仍为 55（一进二/连板闸门不放宽）');
// ⛔ A 方案配套：auczt 两处闸门必须用专用常量，且不许顺手把一进二/连板也改低
ok((src.match(/x\.prob >= AUCZT_PUSH_PROB/g) || []).length === 2, 'auczt 两处推送闸门（定稿 + 手动补发）都用 AUCZT_PUSH_PROB');
ok((src.match(/useProb < ZT_INFER_PUSH_PROB/g) || []).length === 2, '一进二/连板两处闸门未被连带放宽（仍走 55）');
ok(/prob:\s*aucztProbClamp\(prob\)/.test(src), '调用点走 aucztProbClamp（单层标定，不再按 prob 二次切档）');
ok(!/aucztHonestProb\(/.test(src.replace(/\/\/[^\n]*/g, '')), '旧的双层覆写 aucztHonestProb 已从代码中移除（只剩注释留痕）');
ok(/cal:\s*'h2'/.test(src), "auczt 落库带刻度标记 cal:'h2'（退役判据据此豁免）");
ok(!/\b_old\.cal\s*=/.test(grabFn('logSignal')), '同日新刻度不补写首次样本；新增 observation 单独保存（真实重复行为见 production-signal-evidence.test.js）');
ok(/if \(isRetiredProbScale\(s\)\) \{ bumpSkip\('empRetiredScale'\); continue; \}/.test(src),
  'empTable 跳过退役刻度样本并登记原因');
ok(/if \(s\.type !== 'auczt'\) bump\(ks\[1\], s\);/.test(src), 'auczt 不喂「全部|同档」池（两种回验目标不混池）');
ok(/if \(type === 'auczt'\) return \['auczt\|' \+ b, '全部\|' \+ b\];/.test(src), 'auczt 用自有类型键（不共用族群键）');

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
