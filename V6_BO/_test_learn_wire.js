// 自学 → 选股/推送 接线测试（_test_learn_wire.js）
// ---------------------------------------------------------------------------
// 用户原话：「我让你学习上涨逻辑你学习了没有 而不是依靠我喂给你的那些数据」
// 这套测试锁死三件事，防止哪天被人改回去：
//   ① learnall 算出来的概率必须真的参与候选池打分和排序（v1 时代 predict 零调用）
//   ② 「涨停前埋伏」必须真的用「次日封板概率」，而且它有自己的、更低的质量门槛
//   ③ 埋伏推送文案必须能说清楚"机器学到了什么"，而不是一句"滞后于已涨停票请自行判断"
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const sec = t => console.log('\n' + t);

const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const segOf = (name, len) => { const i = src.indexOf(name); return i > 0 ? src.slice(i, i + (len || 3000)) : ''; };

sec('① 候选池：自学概率真的进了打分');
{
  // ⛔ 源码里有两个 const scored = []，自学打分在第二个（行~3847），第一个在行232不含 laProb
  const i1 = src.indexOf('const scored = []');
  const i2 = src.indexOf('const scored = []', i1 + 1);
  const pool = i2 > 0 ? src.slice(i2, i2 + 14000) : '';
  ok('候选池段落存在', !!pool);
  ok('有 laProb 调用（自学 ever been used 的证据）', /laProb\(/.test(pool));
  ok('修正是按相对基准的溢价算出来的', /const adv = \(pr\.p - pr\.base\)/.test(pool));
  ok('修正幅度被钳住（不让模型单方面决定池子）', /c\.laAdj = Math\.max\(-7, Math\.min\(15/.test(pool));
  ok('真的加到 score 上', /c\.score = Math\.max\(0, Math\.min\(100, Math\.round\(\(c\.score \+ c\.laAdj\)/.test(pool));
  ok('存了 laP / laWhy 供推送展示', /c\.laP = /.test(pool) && /c\.laWhy = laWhy\(/.test(pool));
  {
    // 修正发生在排序之后 → 必须重排，否则 slice(0,50) 按旧分数截断
    // ⛔ 不许按内联比较器的字面量找：2026-10-06 把比较器抽成命名函数 byScore 后
    //    `scored.sort((a, b) => ...)` 变成 `scored.sort(byScore)`，字面量匹配会永远返回 -1。
    // ⛔ 也不许取「全文件最后一次 scored.sort」：2026-10-23 竞价共振模块（行~10153）新增了
    //    一处同名局部 scored.sort，全局最后一次被带到 slice(0,50) 之后 → 误伤本断言。
    //    （"用位置近似语义"的同类脆弱写法第二次修订，2026-10-06 那次也是近似惹的祸。）
    //    正确做法：只数「截断之前」的 scored.sort，取其中最后一次——
    //    要钉的语义是「slice(0,50) 之前的最后一趟重排，发生在自学修正之后」。
    const iAdj = src.indexOf('c.laAdj = Math.max(-7');
    // ⛔ 2026-10-28 改钉：池上限从内联字面量 50 提成常量 POOL_CAP（=50），
    //    仍钉「截断点在哪」，但把常量的取值一并验证 —— 只改锚点不验值等于放宽了语义。
    const capM = src.match(/const POOL_CAP = (\d+);/);
    const iSlice = src.indexOf('picked = picked.slice(0, POOL_CAP)');
    const sliceOld = src.indexOf('picked = picked.slice(0, 50)');
    const iSliceAt = iSlice >= 0 ? iSlice : sliceOld;
    const sortsBeforeSlice = [...src.matchAll(/scored\.sort\(/g)].map(m => m.index)
      .filter(x => iSliceAt > 0 && x < iSliceAt);
    const iSort = sortsBeforeSlice.length ? sortsBeforeSlice[sortsBeforeSlice.length - 1] : -1;
    ok('池上限常量仍是 50（截断语义未变）', !!capM && capM[1] === '50');
    ok('自学修正之后还有一次重排', iSort > iAdj && iAdj > 0, `sort@${iSort} adj@${iAdj}`);
    ok('且这次重排排在 slice(0, 50) 之前', iSort >= 0 && iSliceAt > 0 && iSort < iSliceAt, `sort@${iSort} slice@${iSliceAt}`);
  }
  ok('样本不足时整段跳过（不会用空模型瞎加分）', /if \(laBase <= 0\) break;/.test(src));
}

sec('② 埋伏模块：用的是「次日封板概率」而不是手工埋伏分');
{
  const pre = segOf('async function preBreakoutInner', 9000);
  ok('埋伏段落存在', !!pre);
  ok('调用了 zt 目标的自学预测', /laProb\(s\.code, s\.name, rows, 'zt'\)/.test(pre));
  ok('把自学概率换算进 prob（不是只挂个字段）', /prob = Math\.round\(prob \* 0\.45 \+ learnScore \* 0\.55\)/.test(pre));
  ok('保留 ztP 字段下发面板', /ztP,/.test(pre));
  ok('把基准也一起带上（用户能看出 2% 是低还是高）', /ztBase: prZ \? /.test(pre));
  ok('reason 写进了机器学到的依据', /学到了: /.test(pre));
}

sec('③ 埋伏推送：门槛与文案都不再堵死提前告知这条路');
{
  const push = segOf('async function scanPrePush', 3500);
  ok('推送函数存在', !!push);
  ok('不再写死 prob >= 55 的旧门槛', !/const top = list\.filter\(x => x\.prob >= 55\)/.test(src));
  // ⛔ 预筛选已去掉：让 govTake 用融合概率做最终决定，避免融合概率高但原始 prob 低的票被提前筛掉。
  //    pushMinProbPre 仍在 govTake 内部生效（pre 类型自动降门槛）。
  ok('预筛选去掉（govTake 内部仍对 pre 降门槛）', !/list\.filter\(x => \(x\.prob \|\| 0\) >= mp\)/.test(push));
  ok('组内按自学封板概率排序', /sort\(\(a, b\) => \(\(b\.ztP \|\| 0\) - \(a\.ztP \|\| 0\)\)/.test(push));
  ok('文案标题点明是机器自学挑的', /涨停前埋伏 · 机器自学挑的/.test(push));
  ok('文案展示封板概率与基准', /次日封板<b>/.test(push) && /全市场基准/.test(push));
  ok('文案声明概率来自自学而非手写规则', /概率来自全A股历史自学/.test(push));
  ok('govTake 对 pre 类型降门槛', /if \(type === 'pre'\) mp = Math\.min\(mp, pushMinProbPre\(\)\)/.test(src));
  // ⛔ dg 轮改判据：默认值已从调用点第二参数收进 CFG_RANGE.def，钉写法会假红（第五次同类坑）
  ok('pushMinProbPre 默认 40', /pushMinProbPre:\s*\{\s*def:\s*40/.test(src));
}

sec('④ 模型不会退化成"婴儿"：启动回填 + 幂等');
{
  ok('有启动自检回填', /learnall-backfill/.test(src));
  ok('回填门槛是 5 万样本', /db0\.n >= 50000/.test(src));
  ok('入库后刷新模型缓存', /laRefresh\(\);\s*\/\/ 立方更新了/.test(src));
  ok('laDb 有缓存，不会每票都读盘', /function laDb\(\) \{\s*if \(LA_DB\) return LA_DB;/.test(src));
  ok('回填脚本存在', fs.existsSync(path.join(__dirname, '_seed_learnall.js')));
  ok('验证脚本存在', fs.existsSync(path.join(__dirname, '_test_learnall_valid.js')));
}

sec('⑤ 状态接口能把「学到了什么」讲给用户听');
{
  const api = segOf("p === '/api/learnall-status'", 2600);
  ok('返回双目标基准', /rateZt/.test(api));
  ok('返回两套挖到的规则', /rulesPeek\('up3'\)/.test(api) && /rulesPeek\('zt'\)/.test(api));
  ok('规则带样本数与命中率', /n: x\.n, rate: x\.rate, lift: x\.lift/.test(api));
  ok('返回覆盖的票数与交易日数', /codes: Object\.keys\(db\.prog/.test(api) && /days: days\.length/.test(api));
}

console.log('\n──────────────────────────────');
console.log(`自学接线测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
