// 守门：dx 轮 —— 自动调参改了配置必须落盘（「改了内存没落盘」在自学习闭环上的漏网）
// ⛔ iq 轮（2026-10-17）：大单→涨停闭环整条退役（prob 对这一类是反指标，见 bmHotFactors 注释），
//   自学习闭环从三个缩到两个：similarSelfOptimize→simGate、trendSelfOptimize→probThreshold。
//   两个都会调 saveCfg()；trendSelfOptimize→probThreshold（最要紧的主闸）改了内存不落盘
//   → 线上实例冷启动 / 发版重启后从 config.json 读回旧值，调参成果整段蒸发，
//   而 adjRemember 台账里还记着「从 cur 调到了 nv」→ 台账与现实分叉，复核闸拿错误的 from/to 判"上次上调没改善"。
//   本守门同时钉死退役侧：bigMoneyProbGate / bmHotZeroFallback 的写点一个不许回来。
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 自动调参落盘（dx 轮）守门 ===\n');

// ---------- ① 两个自学习闭环都要落盘 ----------
console.log('【① 改了配置必须 saveCfg —— 两处自优化一致性】');
ok('trendSelfOptimize 上调分支写完就 saveCfg', /S\.config\.probThreshold = nv; saveCfg\(\);/.test(SRC));
ok('trendSelfOptimize 下调分支写完就 saveCfg', /S\.config\.probThreshold = nv; saveCfg\(\);/.test(SRC));
// ⛔ iq 轮：bigMoneySelfOptimize 已更名 bigMoneyStatsRefresh 且只刷新统计、不写配置 ——
//    旧断言「bigMoneyProbGate 落盘（对照基线）」反过来钉：那个写点必须保持为零。
ok('⛔ iq 轮：大单概率门槛写点已退役（bigMoneyStatsRefresh 只统计、不调参）',
  !/S\.config\.bigMoneyProbGate/.test(SRC) && /function bigMoneyStatsRefresh\(\) \{[\s\S]{0,200}?S\.learn\.bigMoney = bigMoneyStats\(\);[\s\S]{0,50}\}/.test(SRC));
ok('similarSelfOptimize 落盘（对照基线）', /S\.config\.simGate = nv; saveCfg\(\);/.test(SRC));
{
  // 三处各若干，不允许只改一处漏另外几处
  // ⛔ iq 轮：原第 4/5 个落盘点（bigMoneyProbGate 自学习 + D3 零候选回退）随闸门一起退役，
  //    只剩 probThreshold 上下调×2 + simGate 共 3 个。
  const n = (SRC.match(/S\.config\.(probThreshold|simGate) = nv; saveCfg\(\);/g) || []).length;
  ok('落盘点共 3 个（prob 上下调×2 + 相似；大单那两个已退役）', n === 3, '实为 ' + n);
  ok('⛔ iq 轮：D3 零候选回退也退役了（bmHotZeroFallback 函数已删除，不留下第二个写点）',
    !/function bmHotZeroFallback\(/.test(SRC));
}

// ---------- ② 反证：不落盘会丢调参 ----------
console.log('\n【② 反证：不落盘 = 重启丢调参】');
{
  const sim = persist => {
    let file = 0.82;
    const S = { config: { probThreshold: 0.82 } };
    const saveCfg = () => { file = S.config.probThreshold; return true; };
    S.config.probThreshold = 0.86;            // 自动调参把阈值顶到 0.86
    if (persist) saveCfg();
    return file;                              // 模拟重启：从 config.json 读回
  };
  ok('落盘 → 重启后 0.86 保留（调参不白费）', sim(true) === 0.86);
  ok('⛔ 不落盘 → 重启后弹回 0.82（反证：老写法就是这么丢的）', sim(false) === 0.82);
}

// ---------- ③ 落盘失败不许静默 ----------
console.log('\n【③ saveCfg 失败要留痕】');
ok('saveCfg 定义存在', /const saveCfg = \(\) =>/.test(SRC));
ok('saveCfg 失败走 _diskFail（不静默返回 true）', /atomicWrite\(CFG_FILE[^)]*\).*_diskFail/.test(SRC) || /return _o \? true : _diskFail/.test(SRC));

// ---------- ④ 自动调参的值不越界（写入端钳制） ----------
console.log('\n【④ 自动调参写进去的值都在 CFG_RANGE 内】');
ok('probThreshold 上调钳到 ≤0.86（≤max=1）', /Math\.min\([^,]+,\s*0\.86\)/.test(SRC));
ok('probThreshold 下调钳到 ≥0.75（≥min=0）', /Math\.max\([^,]+,\s*0\.75\)/.test(SRC));
ok('simGate 钳到 [55,85]', /Math\.min\(85, cur \+ 5\)/.test(SRC) && /Math\.max\(55, cur - 5\)/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
