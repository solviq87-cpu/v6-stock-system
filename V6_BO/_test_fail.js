// 守门 · dk 轮：同一个「失败」，在系统里必须有同一套说法
//   本轮角度：同一个「这一轮没跑成」，实测有 5 种说法 —— 写 {ok:false}（面板看得见）／
//   return null（调用方当没数据）／ console.error 后继续（面板照样显示上一次成功的数据，
//   看起来刚跑完）／ pushLog('❌')（只有流水里看得到）／ 174 处空 catch 静默。
//   不对称的实测：涨停前形态 / 全市场趋势扫描 / K线回填 三个任务早就有本轮状态（cu 轮修的），
//   而 **大单流入 / 启动前埋伏 / 相似跟随 / 连续收涨 / 学习入库** 一个都没有 ——
//   同一类事件在这头看得见、在那头毫无痕迹，用户没法判断"这是没跑，还是跑砸了"。
//   修法：FAIL_RULE 登记每类场景该用哪种说法；周期任务一律走 taskSet 唯一出口，面板一处看全。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const SVS = strip(SV);

let FAIL = 0, N = 0;
const ok = (name, cond, extra) => { N++; if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return src.slice(i, j); };

// ── 沙箱：把 FAIL_RULE / TASK_RULE 整块切出来真跑 ───────────────────────
const FAIL_SRC = cut(SV, 'const FAIL_RULE = {', 'let _rollbackMsg = null;');
const _errs = [];
const F = new Function('console', FAIL_SRC + '\nreturn { FAIL_RULE, failHow, TASK_RULE, taskSet, taskState, _taskState };')(
  { error: (...a) => _errs.push(a.join(' ')), log() { } });

// ════════ 【A】FAIL_RULE：每类场景该用哪种说法 ════════
console.log('【A】FAIL_RULE：失败的「说法」必须按场景登记');
{
  const ks = Object.keys(F.FAIL_RULE);
  ok('登记表非空', ks.length >= 4, '实得 ' + ks.length);
  const HOWS = ['state', 'null', 'log', 'push', 'silent'];
  for (const k of ks) {
    const d = F.FAIL_RULE[k];
    ok(k + ' 的 how 合法', HOWS.indexOf(d.how) >= 0, d.how);
    ok(k + ' 有 note 说明', typeof d.note === 'string' && d.note.length > 0);
  }
  ok('task 类必须写本轮状态（不是只打日志）', F.failHow('task') === 'state');
  ok('persist 类必须打日志（不许空 catch）', F.failHow('persist') === 'log');
  ok('未登记的分类返回空串', F.failHow('不存在的分类') === '');
  // ⛔ 只有纯装饰性旁路才允许静默 —— 且必须显式登记
  ok('允许静默的只有 bypass 一类',
    ks.filter(k => F.FAIL_RULE[k].how === 'silent').join(',') === 'bypass',
    ks.filter(k => F.FAIL_RULE[k].how === 'silent').join(','));
}

// ════════ 【B】TASK_RULE：哪些任务必须有本轮状态 ════════
console.log('【B】TASK_RULE：周期任务必须登记，未登记的不许写状态');
{
  const ks = Object.keys(F.TASK_RULE);
  ok('登记的任务数 ≥ 6', ks.length >= 6, '实得 ' + ks.length);
  for (const k of ['ztpre', 'trendScan', 'steadyUp', 'bigmoney', 'similar', 'pre'])
    ok('关键任务 ' + k + ' 已登记', ks.indexOf(k) >= 0);
  for (const k of ks) ok(k + ' 有中文名（面板要显示）', typeof F.TASK_RULE[k] === 'string' && F.TASK_RULE[k].length > 0);
  // 未登记的名字：拒绝写入并报错（不许悄悄建一个野状态）
  const before = Object.keys(F._taskState).length;
  _errs.length = 0;
  F.taskSet('一个没登记的任务', { ok: false, error: 'x' });
  ok('⛔ 未登记的任务名被拒绝', Object.keys(F._taskState).length === before);
  ok('且报了错（不是静默忽略）', _errs.join(' ').indexOf('未登记') >= 0, _errs.join(' '));
}

// ════════ 【C】taskSet / taskState 行为 ════════
console.log('【C】本轮状态三态：没跑(null) / 成功(true) / 失败(false)');
{
  const st0 = F.taskState();
  ok('taskState 覆盖全部登记任务', Object.keys(st0).length === Object.keys(F.TASK_RULE).length);
  ok('没跑过的任务 ok 是 null（不是 false —— false 会被当成"跑砸了"）',
    st0.bigmoney.ok === null, String(st0.bigmoney.ok));
  ok('每键带 name / ok / error', Object.keys(st0).every(k => st0[k].name && 'ok' in st0[k] && 'error' in st0[k]));

  F.taskSet('bigmoney', { ok: true, error: '', n: 12 });
  ok('成功 → ok:true', F.taskState().bigmoney.ok === true);
  ok('成功 → error 为空', F.taskState().bigmoney.error === '');
  ok('成功 → 记了产出条数', F.taskState().bigmoney.n === 12, String(F.taskState().bigmoney.n));

  F.taskSet('bigmoney', { ok: false, error: 'push2 接口限流' });
  ok('失败 → ok:false 且带原因', F.taskState().bigmoney.ok === false && F.taskState().bigmoney.error.indexOf('限流') >= 0);
  ok('⛔ 失败原因不许是空的（只写「失败」等于没说）', F.taskState().bigmoney.error.length > 0);

  F.taskSet('pre', { ok: false, error: '未知异常' });
  ok('一个任务失败不影响其它任务的状态', F.taskState().bigmoney.ok === false && F.taskState().ztpre.ok === null);
  ok('taskState 里的名字与 TASK_RULE 一致',
    Object.keys(F.taskState()).every(k => F.taskState()[k].name === F.TASK_RULE[k]));
}

// ════════ 【D】源码契约：各入口真的调了 taskSet ════════
console.log('【D】各周期任务入口必须真的写状态（不是只登记了表）');
{
  ok('大单流入失败 → 写状态', SVS.indexOf("taskSet('bigmoney', { ok: false") >= 0);
  ok('大单流入成功 → 写状态', SVS.indexOf("taskSet('bigmoney', { ok: true") >= 0);
  ok('启动前埋伏失败 → 写状态', SVS.indexOf("taskSet('pre', { ok: false") >= 0);
  ok('启动前埋伏成功 → 写状态', SVS.indexOf("taskSet('pre', { ok: true") >= 0);
  ok('相似跟随失败 → 写状态', SVS.indexOf("taskSet('similar', { ok: false") >= 0);
  ok('相似跟随成功 → 写状态', SVS.indexOf("taskSet('similar', { ok: true") >= 0);
  ok('连续收涨成功 → 写状态', SVS.indexOf("taskSet('steadyUp', { ok: true") >= 0);
  // 原有的三个进度对象并入统一出口
  ok('zpProgSet 转发到 taskSet', SVS.indexOf("taskSet('ztpre'") >= 0);
  ok('tsProgSet 转发到 taskSet', SVS.indexOf("taskSet('trendScan'") >= 0);
  ok('K线回填成功 → 写状态', SVS.indexOf("taskSet('kbf', { ok: true") >= 0);
  ok('K线回填票池为空 → 写状态', SVS.indexOf("taskSet('kbf', { ok: false") >= 0);
  ok('/api/state 下发 taskState', SVS.indexOf('taskState: taskState(),') >= 0);
  const script = strip(HV.slice(HV.indexOf('<script'), HV.lastIndexOf('</script>')));
  ok('前端真的读了 s.taskState', /s\.taskState/.test(script));
  ok('前端有 renderTaskState', /function renderTaskState/.test(script));
  // ⛔ dl 轮改判据：原来钉的是 `ts[k].error` 这串字符，renderTaskState 重写后就假红了。
  //    钉语义：失败/0条的原因必须被拼进 title，且带 cursor:help（悬浮才看得到）。
  ok('前端把失败原因挂在 title 上（不是只写「失败」）',
    /v\.empty \|\| v\.error/.test(script) && /cursor:help/.test(script) && /title=/.test(script));
}

// ════════ 【E】反证：旧做法留不下任何痕迹 ════════
console.log('【E】反证：只 finally / 只 console.error 的旧写法');
{
  // 旧写法：异常抛出后只有 finally，没有任何"这一轮没跑成"的记录
  // ⛔ finally 不捕获异常，要模拟"调用方拿到异常后只打日志"才看得清有没有留痕
  const old = new Function(`
    const trace = []; let busy = true;
    try {
      try { busy = true; throw new Error('接口限流'); }
      finally { busy = false; }          // 旧写法：只复位忙标记，不写任何状态
    } catch (e) { /* 调用方 console.error 后继续 */ }
    return trace;`)();
  ok('反证：旧写法失败后不留任何状态痕迹', Array.isArray(old) && old.length === 0);
  // 新写法
  F.taskSet('similar', { ok: false, error: '接口限流' });
  ok('新写法：失败后 taskState 里看得到原因', F.taskState().similar.error.indexOf('限流') >= 0);
  // ⛔ 三态的意义：null(没跑) 与 false(跑砸) 必须可区分
  ok('⛔ 没跑过(null) 与 跑砸了(false) 可区分',
    F.taskState().ztpre.ok === null && F.taskState().similar.ok === false);
}

console.log('\n' + (FAIL ? '❌ ' + FAIL + ' / ' + N + ' 失败' : '✅ 全部通过 ' + N + ' 条断言'));
process.exit(FAIL ? 1 : 0);
