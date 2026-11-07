// 硬闸门不许把「判不出来」当成「判了通过」（本轮新角度 —— 降级路径与正常路径是否同一把尺子）。
//
// 故障形态：一票否决的硬闸门写成 `!!(x && x.坏)`、`ago != null && ago < 60`、`capOk !== false`
// 这类「先判有没有结果、再判结果好坏」的形式。于是**没有结果**和**结果是好的**在这行里
// 完全等价 —— 数据缺失、源降级、K线不够长的票不但没被拦，还和真正审过的票站在同一条起跑线上。
// 项目既定的「缺数据不判死」原则说的是**打分权重**（大单缺K线按中性 0.7、趋势缺K线中性），
// 它从来不该套用到硬闸门上：证据不足时唯一诚实的做法是「说清楚没判」，而不是默许放行。
//
// 实测三处，全是同一类：
//   ① 八字闸门：K线不足 25 根 → c.bazi 永不赋值 → `!!(c.bazi && 高位加速…)` 恒 false。
//      .kline_cache 里恰好 10 只这样的票（301686/301688/301689/301697/301699/601091/
//      601123/603448/688801/688837，6~21 根K线），清一色**次新股** ——
//      而次新股正是「高位加速」最典型的群体：硬闸门专防的那一类，恰恰是它唯一漏掉的那一类。
//      更糟的是「八字闸门无人达标」的降级退路 `scored.filter(c => !baziBlocked(c))`，
//      行情越差越该守门的时候，顶上来的却全是没被审过的票。
//   ② 次新股闸门：auctionBlocked 判 `ago != null && ago < 60`，ago 来自 listedDaysAgo(s.listedDate)，
//      快照没有上市日期时返回 null → 不拦。偏偏**竞价期最容易降级到备用源**（新浪不带 listedDate），
//      于是这道理应为竞价过滤兜底的闸门，恰好在最需要它的那十分钟里静默失效。
//   ③ 市值闸门：capOk === false（已知小盘）扣 10 分，capOk === null（拿不到市值）**一分不扣** →
//      同一只小盘股，行情源降级那天反而比正常那天排得更靠前，等于奖励数据缺失。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const AN = fs.readFileSync(path.join(ROOT, 'analysis.js'), 'utf8');
const HT = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

group('[1] 八字闸门：判不出来 ≠ 判了通过（行为验证）');
{
  const mB = SV.match(/const baziBlocked = c =>[^;]+;/);
  const mU = SV.match(/const baziUnknown = c =>[^;]+;/);
  ok('baziBlocked 存在', !!mB);
  ok('baziUnknown 存在（本轮新增）', !!mU);
  const baziBlocked = new Function(mB[0] + '\nreturn baziBlocked;')();
  const baziUnknown = new Function(mU[0] + '\nreturn baziUnknown;')();

  ok('判得出的「高位加速」→ 拦下', baziBlocked({ bazi: { stage: '高位加速' } }) === true);
  ok('判得出的「破位整理」→ 拦下', baziBlocked({ bazi: { stage: '破位整理' } }) === true);
  ok('判得出的其它阶段 → 放行', baziBlocked({ bazi: { stage: '启动位' } }) === false);

  // ⛔ 关键反证：没有八字结果时，baziBlocked 是 false（放行）—— 所以单靠它一定会漏
  ok('⚠️ 反证：没有八字结果时 baziBlocked 恒 false（旧写法就是这么漏的）',
    baziBlocked({}) === false && baziBlocked({ bazi: null }) === false);
  ok('同一个对象必须被 baziUnknown 认出来（补上这把尺子才闭环）',
    baziUnknown({}) === true && baziUnknown({ bazi: null }) === true);
  ok('有八字结果 → 不属于 unknown', baziUnknown({ bazi: { stage: '启动位' } }) === false);
}

group('[2] 八字闸门：K线不足 / 计算失败都要留痕，且降级退路不许放进未审过的票');
{
  const a = SV.search(/^(async )?function rebuildPool\(/m);
  ok('rebuildPool 存在', a > 0);
  const body = SV.slice(a, a + 40000);
  ok('K线不足25根时写 baziMiss（原来是裸 continue，原因全丢）',
    /rows\.length < 25\)\s*\{\s*c\.baziMiss =/.test(body) || /rows\.length < 25\)\s*\{[^}]*c\.baziMiss\s*=/.test(body));
  ok('catch 里也写 baziMiss（算失败同样要留痕）', /catch\s*\{\s*c\.baziMiss\s*=/.test(body));
  // ⛔ 这一条是本轮最硬的修复：最后一道防线不能有"没审过"的票
  ok('⛔ 降级退路 safe 同时排除 baziUnknown（行情越差越不能放进没审过的票）',
    /scored\.filter\(c => !baziBlocked\(c\) && !baziUnknown\(c\)\)/.test(body));
  ok('主路径统计未判定只数并打日志（线上可查，不能只在内存里）',
    /unjudgedN[\s\S]{0,300}console\.log/.test(body));
  // ⛔ 这里原来是 `[\s\S]{0,600}` 的固定字符窗口 —— 往这个 map 里多加几行就把断言撑爆了
  //    （dq 轮给资金留存补实际窗口时踩到）。改成按括号配对取真实的 map 回调体再判。
  ok('baziMiss 会随 pool 透传到前端（state 里是 ...c 展开）',
    (() => {
      const at = SV.indexOf('S.candidatePool.slice(0, 50).map(c =>');
      if (at < 0) return false;
      let i = SV.indexOf('{', at), depth = 0, end = -1;
      for (let k = i; k < SV.length && k < at + 4000; k++) {
        const ch = SV[k];
        if (ch === '{') depth++;
        else if (ch === '}') { depth--; if (depth === 0) { end = k; break; } }
      }
      if (end < 0) return false;
      return /\.\.\.c\s*,/.test(SV.slice(i, end));
    })());
}

group('[3] 八字未判定：推送与面板都看得见（算了不用 = 白算）');
{
  ok('推送文案 baziLine 在未判定时输出说明', /c\.baziMiss \? `\\n  八字 —— 未做闸门判定/.test(SV));
  ok('文案里点明「没经过高位加速/破位整理这一票否决」', /经过「高位加速\/破位整理」这一票否决/.test(SV));
  ok('前端有 else if (x.baziMiss) 分支', /else if \(x\.baziMiss\)/.test(HT));
  ok('前端显示「八字未判定」标签', HT.indexOf('八字未判定') >= 0);
  ok('前端把 baziMiss 原文放进 title 或正文（用户能知道为什么没判）',
    /x\.baziMiss \|\| ''/.test(HT) || /title="\$\{\(x\.baziMiss/.test(HT));
}

group('[4] 次新股闸门：备用源缺上市日期时必须留痕（竞价期恰恰最爱走备用源）');
{
  const af = SV.search(/^function auctionBlocked\(/m);
  ok('auctionBlocked 存在', af > 0);
  const fb = SV.slice(af, af + 900);
  ok('判据是 ago != null && ago < 60（缺日期即不拦，这是问题的根）',
    /ago != null && ago < 60/.test(fb));
  const ca = SV.indexOf('const _ok = new Set()');
  ok('captureAuction 统计缺上市日期只数 _noLd', ca > 0 && /_noLd\+\+/.test(SV.slice(ca, ca + 1200)));
  ok('统计用 listedDaysAgo 判空（与闸门同一口径，不许另写一套）',
    /listedDaysAgo\(s\.listedDate\) == null/.test(SV.slice(ca, ca + 1200)));
  ok('日志报出缺日期只数', /\[竞价\] ⚠️ \$\{_noLd\}/.test(SV) || /_noLd\)\s*console\.log/.test(SV));
  ok('S.auction 带 newGateUnknown 下发', /newGateUnknown: _noLd/.test(SV));
  ok('推送文案写明「次新股闸门本轮未能执行」', /次新股闸门本轮未能执行/.test(SV));
  ok('面板显示同一条提示', HT.indexOf('次新股闸门本轮未生效') >= 0);
}

group('[4b] 大单「下跌途中不进涨停候选」闸门：位置判不出来同样不许当通过');
{
  const mB = SV.match(/const badCtx = x =>[^;]+;/);
  const mU = SV.match(/const ctxUnknown = x =>[^;]+;/);
  ok('badCtx 存在', !!mB);
  ok('ctxUnknown 存在（本轮新增）', !!mU);
  const badCtx = new Function(mB[0] + '\nreturn badCtx;')();
  const ctxUnknown = new Function(mU[0] + '\nreturn ctxUnknown;')();
  ok('接盘单 → 拦下', badCtx({ ctx: { flowKind: '下跌途中接盘' } }) === true);
  ok('深跌后承接 → 拦下', badCtx({ ctx: { flowKind: '深跌后承接' } }) === true);
  ok('趋势中加仓 → 放行', badCtx({ ctx: { flowKind: '趋势中加仓' } }) === false);
  // ⛔ 反证：ctx 为 null 时 badCtx 恒 false，旧写法直接把没判过位置的票放进涨停候选
  ok('⚠️ 反证：ctx 为 null 时 badCtx 恒 false（旧写法就是这么漏的）',
    badCtx({}) === false && badCtx({ ctx: null }) === false);
  ok('同一个对象必须被 ctxUnknown 认出来', ctxUnknown({}) === true && ctxUnknown({ ctx: { flowKind: '↔️' } }) === false);
  ok('⛔ 涨停候选 hotAll 同时排除 ctxUnknown', /aged\(x, 15\) && !badCtx\(x\) && !ctxUnknown\(x\)/.test(SV));
  ok('nature() 在缺 ctx 时明说「位置未判定·未进涨停候选」', /位置未判定（缺K线）· 未进涨停候选/.test(SV));
}

group('[5] 市值闸门：判不出来也要打折，不能奖励数据缺失（行为验证）');
{
  const f = new Function('capOk', 'trendScore',
    'if (capOk === false) trendScore -= 10;\nelse if (capOk === null) trendScore -= 5;\nreturn trendScore;');
  ok('已知小盘（false）→ 扣 10', f(false, 50) === 40);
  ok('已知达标（true）→ 不扣', f(true, 50) === 50);
  ok('⛔ 市值未知（null）→ 也要扣，只扣 5（原来扣 0，等于奖励缺失）', f(null, 50) === 45);
  ok('未知扣分轻于已知小盘（缺数据不判死，但也不占便宜）', f(null, 50) > f(false, 50));
  ok('analysis.js 里确实是这条三分支', /if \(capOk === false\) trendScore -= 10;\s*\n\s*else if \(capOk === null\) trendScore -= 5;/.test(AN));
  ok('返回值带 capUnknown 供前端/文案标注', /capUnknown: capOk === null/.test(AN));
  ok('capOk 的 null 语义仍在注释里说明（别让人改回去）', /capOk = capYi == null \? null : capYi >= 50/.test(AN));
}

group('[6] 反证：这三处旧写法都会把「判不出来」判成通过');
{
  ok('八字旧式：只判 !baziBlocked → 无结果即放行',
    new Function('c', 'const baziBlocked = x => !!(x.bazi && x.bazi.stage === "高位加速"); return !baziBlocked(c);')({}) === true);
  ok('次新股旧式：ago == null → 不拦', new Function('ago', 'return !(ago != null && ago < 60);')(null) === true);
  ok('市值旧式：capOk == null → 不拦', new Function('capOk', 'return capOk !== false;')(null) === true);
}

console.log(`\n===== 硬闸门「判不出来」守门测试：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
