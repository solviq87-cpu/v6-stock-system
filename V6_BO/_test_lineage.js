// 守门测试（cs 轮 · 角度：数据血缘 —— 一个数被改写几次、每次有没有留痕）
// 概率链：模型原值 → 学习融合(fusedProb) → 闸门/排序(govFilter/govTake) → 文案(fuseLine) → 落盘样本。
// 断裂的三种典型形态（本轮全部实测到）：
//   ① 换名：趋势票的分数叫 trendScore，判定端只认 prob/riseProb/score → 取不到 = 闸门静默放行
//   ② 换字段：分数塞进 extra.score 而 logSignal 只看第 5 参 → 落盘样本 prob=null = 学习链没证据
//   ③ 不回写：闸门算好的融合值没写回对象 → fuseLine 静默返回空 = 显示的数 ≠ 决策的数
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅ ' + name); } else { fail++; console.log('  ❌ ' + name); } };

const SV = fs.readFileSync('./server.js', 'utf8');
const NOC = stripNoise(SV, { keepStrings: true });

// 按花括号配对取真实函数体（不许用固定字符窗口 —— 踩过 9 次）
// ⛔ 配对前必须**先跳过形参表**：`function logSignal(..., extra = {})` 里那个默认参数的
//    `{}` 会让计数在第一行就归零 → 取回一个 "{}"（本次实测又踩一次，连自检都过不去）。
function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  // ① 跳过形参表 —— 只有 `function name(...)` 有形参表；
  //    箭头函数（`const probAt = x => {`）没有，硬跳会跑到后面的 if (…) 上去（本次实测）。
  let pe = i;
  if (/^function\b/.test(sig)) {
    let p = src.indexOf('(', i), pd = 0;
    for (pe = p; pe < src.length; pe++) {
      const c = src[pe];
      if (c === '(') pd++;
      else if (c === ')') { pd--; if (pd === 0) break; }
    }
  }
  // ② 从形参表之后开始配花括号
  let j = src.indexOf('{', pe), depth = 0, k = j;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j, k);
}

console.log('【一】判定端认得出每一种质量刻度（换名 = 闸门静默放行）');
const gf = fnBody(NOC, 'function govFilter(');
ok('[自检] 取到 govFilter 函数体', gf.length > 200);
const pat = fnBody(gf, 'const probAt = ');
ok('[自检] 取到 probAt 定义块', pat.indexOf('probOf') >= 0 && pat.indexOf('return undefined') >= 0);
// 真跑 probAt（它只依赖传入对象的字段，无外部依赖）
const runProbAt = new Function('probOf', 'x', pat + ' return probAt(x);');
ok('★ 趋势分 trendScore 能被取到（0~100，与 prob 同尺）', runProbAt(null, { trendScore: 80 }) === 80);
ok('★ 精选池 score 能被取到', runProbAt(null, { score: 72 }) === 72);
ok('★ riseProb 能被取到', runProbAt(null, { riseProb: 61 }) === 61);
ok('★ 三个名字都没有时返回 undefined（不是 0 —— 0 会被当成有效分）', runProbAt(null, { foo: 1 }) === undefined);
// 反证：把 trendScore 那一行删掉 → 趋势票立刻取不到分
const patNoTs = pat.split('\n').filter(l => l.indexOf('trendScore') < 0).join('\n');
ok('[自检] 反证用的"删掉兜底"确实改了代码', patNoTs !== pat && patNoTs.length < pat.length);
ok('★ 反证：少了这行兜底，趋势票取不到分 → 闸门整条跳过', runProbAt(null, { trendScore: 80 }) !== undefined && new Function('probOf', 'x', patNoTs + ' return probAt(x);')(null, { trendScore: 80 }) === undefined);
// 上游：trendScore 确实是 0~100（与概率同一把尺子，不是随便一个数）
const AN = fs.readFileSync('./analysis.js', 'utf8');
ok('★ trendScore 被钳在 0~100（与概率同量纲，可以进同一个闸门）', /trendScore\s*=\s*Math\.max\(0,\s*Math\.min\(100/.test(AN));

console.log('\n【二】留档端：登记样本时分数不许丢（传 null = 学习链永远没证据）');
const lsTrend = (NOC.match(/logSignal\('trend'[^;]*;/) || [])[0] || '';
const lsPool = (NOC.match(/logSignal\('pool'[^;]*;/) || [])[0] || '';
const lsSector = (NOC.match(/logSignal\('sector'[^;]*;/) || [])[0] || '';
ok('[自检] 定位到三处样本登记', lsTrend && lsPool && lsSector);
// 第 5 个参数才是"模型预估分"（logSignal 只认它，extra 里的 score 不算）
const arg5 = s => {
  const m = s.match(/logSignal\('(\w+)',\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),/);
  return m ? { type: m[1], v: m[5].trim() } : null;
};
const a5t = arg5(lsTrend), a5p = arg5(lsPool), a5s = arg5(lsSector);
ok('★ 趋势票登记时传的是 c.trendScore（不是 null）', a5t && a5t.type === 'trend' && a5t.v === 'c.trendScore');
ok('★ 精选池登记时传的是 c.score（不是 null）', a5p && a5p.type === 'pool' && a5p.v === 'c.score');
ok('★ 板块异动登记时传的是 x.prob（不是 null）', a5s && a5s.type === 'sector' && a5s.v === 'x.prob');
ok('★ 三处都不再传 null（传 null → fusedProb 直接 return → 样本 prob 为空）',
  !/logSignal\('(trend|pool|sector)'[^;]*,\s*null\s*,/.test(NOC));
// 语义闭环：为什么传 null 会静默失效 —— logSignal 只认第 5 参，fusedProb 遇到非有限值直接返回
const lsBody = fnBody(NOC, 'function logSignal(');
ok('[自检] 取到 logSignal 函数体', lsBody.indexOf('_p') >= 0);
ok('★ logSignal 用第 5 参算 _p（extra 里的 score 不会被当成概率）', /const _p = \(prob == null/.test(lsBody));
const fpBody = fnBody(NOC, 'function fusedProb(');
ok('★ fusedProb 遇到非有限值直接返回（不融合）—— 所以留档端丢分 = 学习链断', /if \(out\.prob == null\) return out;/.test(fpBody));

console.log('\n【三】回写：显示的数必须是决策的那个数');
ok('★ govFilter 放行时把融合值回写（否则 fuseLine 静默返回空）', /res\.ok\)\s*\{[^}]*x\._fz\s*=\s*res\.fused/.test(NOC));
ok('★ 涨停前埋伏 pre 回写 _fz（与补涨龙同口径）', /_g\.fused\)\s*x\._fz\s*=\s*_g\.fused/.test(NOC));
ok('★ 补涨龙那处仍在回写（不许被改坏）', /g\.fused;\s*[\s\S]{0,400}?if \(fz\) x\._fz = fz;/.test(NOC));
ok('★ 竞价推断票补算融合值（不走闸门也要有学后胜率）', /x\._fz = x\._fz \|\| fusedProb\(/.test(NOC));
// fuseLine 是唯一入口；读不到 _fz 就返回空串 —— 这正是"断了不留痕"的地方
const flBody = fnBody(NOC, 'function fuseLine(');
ok('[自检] 取到 fuseLine 函数体', flBody.indexOf('_fz') >= 0);
// ⛔ fuseLine 现在会调 probDefOfType / probTag 给百分数补「赌的是哪件事」（dd 轮）——
//    沙箱里漏装这几个符号 = ReferenceError = **整个套件崩掉，不是变红**（同类坑已踩 9 次）。
//    这里直接从 server.js 原样切那段定义进来（改了实现测试自动跟着变，不会测到旧代码）。
const probSrc = SV.slice(SV.indexOf('const HIT_THR = 3;'), SV.indexOf('function resolveWithKline'));
ok('[自检] 切到概率事件定义表', /const PROB_DEF = \{/.test(probSrc) && /function probTag\(/.test(probSrc));
const runFuse = new Function('x', probSrc + '\n' + flBody.replace('function fuseLine(x)', ''));
ok('★ 没有 _fz 时 fuseLine 返回空串（静默，不报错 —— 所以必须靠回写保证）', runFuse({}) === '');
ok('★ 有 _fz 时输出「学后胜率」并带出模型原值（来源可见）',
  runFuse({ _fz: { prob: 61, model: 72, emp: 40, empN: 30, empDays: 6 } }).indexOf('学后胜率 61%') >= 0
  && runFuse({ _fz: { prob: 61, model: 72 } }).indexOf('模型72%') >= 0);
// ★ dd 轮：光秃秃一个百分数是"只有结论、没有前提" —— 事件定义必须跟着数一起出来
ok('★ 学后胜率带了事件定义（type=后排涨停概率 → 当日封板）',
  runFuse({ type: '后排涨停概率', _fz: { prob: 61, model: 72 } }).indexOf('（当日封板 · 模型') >= 0);
ok('★ 认不出 type 时宁可不写定义，绝不许编一个（那行只剩模型原值，不带任何事件词）',
  runFuse({ type: '从没见过的类型', _fz: { prob: 61, model: 72 } }).indexOf('封板') < 0
  && runFuse({ type: '从没见过的类型', _fz: { prob: 61, model: 72 } }).indexOf('次日') < 0);
// 文案：主要推送模块都要接到 fuseLine 这个唯一入口
const NOC_L = NOC.split('\n');
// ⛔ fuseLine 可能与被匹配的那行不在同一行（模板串跨行拼接）→ 往后看 4 行
const hasFuse = (re) => NOC_L.some((l, i) => re.test(l) && /fuseLine\(/.test(NOC_L.slice(i, i + 4).join('\n')));
ok('★ 板块异动文案接了 fuseLine', hasFuse(/涨停概率\$\{x\.prob\}%/));
ok('★ 精选池文案接了 fuseLine', hasFuse(/评分\$\{c\.score\}/));
ok('★ 相似走势文案接了 fuseLine', hasFuse(/概率 \$\{_fprob\(x\)\}% · 相似度/) || hasFuse(/概率 \$\{x\.prob\}% · 相似度/));
// ⛔ 钉语义不钉字面：概率必须自带「赌的是哪件事」，不许退回光秃秃一个百分数
ok('★ 相似走势的概率带事件定义（同上：盘中模块赌当日封板）', hasFuse(/probDef\('ztToday'\)\}概率 \$\{_fprob\(x\)\}%/) || hasFuse(/probDef\('ztToday'\)\}概率 \$\{x\.prob\}%/));
ok('★ 涨停前埋伏文案接了 fuseLine', hasFuse(/埋伏分 \$\{_fprob\(x\)\}/) || hasFuse(/埋伏分 \$\{x\.prob\}/));
ok('★ 竞价推断文案接了 fuseLine', hasFuse(/推断依据: \$\{x\.reason\}/));

console.log('\n【四】落盘留痕：推送出去的内容事后可回溯');
const plBody = fnBody(NOC, 'function pushLog(');
ok('[自检] 取到 pushLog 函数体', plBody.indexOf('pushTitle') >= 0);
ok('★ 流水区分状态（送达/拦截/失败各自可查）', /status/.test(plBody));
ok('ⓘ 已知项：流水只留首行 40 字标题，正文不落盘（体积权衡，非缺陷）', /pushTitle\(text\)/.test(plBody) && /\btitle\b/.test(plBody));

console.log('\n────────────────────────────────────────────────────────────');
console.log('结果：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
