// 验证 bc 版三处修复：① 推送节流器（9/28 一天 207 只 → 压到名额内）
//                    ② 四级资金买卖力量对比（不再只报一个净额）
//                    ③ 持仓对停牌股不再按陈旧数据催单（见 _test_fix0929.js）
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
// 按「注释锚点」整段截取：按行抓函数会被内部花括号骗，抓出一堆缺失 { 的残片
const cut = (aMark, bMark) => {
  const i = src.indexOf(aMark);
  const j = src.indexOf(bMark, i);
  if (i < 0 || j < 0) throw new Error('未找到锚点: ' + aMark);
  return src.slice(i, j);
};
const govSrc = cut('const PUSH_GOV = { day:', '// ---------------- 推送流水');
// ⛔ dg 轮补注入：_govCfg 与它的默认值表 CFG_RANGE 已前移到回滚段之前（修 TDZ），
//    不再落在 govSrc 这段里 —— 沙箱少注入就会 ReferenceError 打崩整个套件（第 15 次同类坑）。
const cfgRangeSrc = cut('const CFG_RANGE = {', '// 返回人类可读的错误列表');
const govCfgSrc = cut('const _govCfg = k => {', '// 「概率推送线」唯一读取口');
// ⛔ dh 轮补注入（第 16 次同类坑）：中性值已收进 MISS_RULE 表、读取走 missingOf，
//    沙箱少了这一段就是 ReferenceError —— 不是变红，是整个套件崩掉。
const MISS_SRC = (() => {
  const i = src.indexOf('const MISS_RULE = {');
  return src.slice(i, src.indexOf('let _rollbackMsg = null;', i));
})();

const todayStrSrc = (() => {
  const i = src.indexOf('const todayStr = ');
  return src.slice(i, src.indexOf('};', i) + 2);
})();
// ⚠️ govTake 现在会调 fusedProb（学习融合）→ 需要 S.klines / krowsOf / fusedProb / empInfo 在场。
//    这里注入一个「无学习数据」的最简替身：K线为空 → 融合退化为模型原值，
//    节流器本身的行为不受影响（要测的正是节流器，不是学习）。
// ⚠️ 2026-10-06 补：govSrc 这段现在含「当日额度落盘」（bi 版加的），于是多了四个依赖：
//    path（拼 pushgov.json 路径）/ fs（读存档）/ atomicWrite（写存档）/ isReplica（副本不落盘）。
//    沙箱里少注入任何一个，都会在执行到 savePushGov 时抛 ReferenceError 把整个套件打崩 ——
//    而它的 try/catch 只包住写盘那几行，**包不住**外部常量与 isReplica 的解析。
//    S 也要带上 fastinRepeat（savePushGov 会遍历它）。
const mkGov = cfg => new Function('S', 'console', 'fusedProb', 'krowsOf', 'path', 'fs', 'atomicWrite', 'isReplica', '__dirname', `${todayStrSrc}\n${cfgRangeSrc}\n${govCfgSrc}\n${MISS_SRC}\n${govSrc}\nreturn { govTake, govFilter, govFoot, pushQuota, PUSH_GOV };`)
  ({ config: cfg, klines: new Map(), fastinRepeat: new Map() }, { log() { }, error() { } },
    (code, name, rows, type, p) => ({ prob: p, model: p, emp: null, la: null, delta: 0, src: '替身', why: '' }),
    () => null,
    { join: (a, b) => a + '/' + b },
    { readFileSync: () => { throw new Error('沙箱无存档'); } },
    () => { }, () => false, __dirname);

let pass = 0, fail = 0;
const ok = (c, n, got) => { if (c) { pass++; console.log('  ✓ ' + n + (got ? '  → ' + got : '')); } else { fail++; console.log('  ✗ ' + n + '  → ' + got); } };

console.log('\n===== ① 推送节流器：把 2026-09-28 的 207 只压回可看的量 =====');
const G = mkGov({ pushMaxPerDay: 30, pushMaxPerCode: 2, pushCooldownMin: 0 });  // 冷却清0，先单验名额门
// 模拟 9/28 真实场景：207 只票，其中 90 只被 2 个以上模块重复推
const n207 = Array.from({ length: 207 }, (_, i) => ({ code: String(600000 + i) }));
const kept = G.govFilter('fastin', n207);
ok(kept.length <= G.pushQuota(), '单模块最多只能占到当日名额上限', `通过 ${kept.length} / 名额 ${G.pushQuota()}`);
// 换一天继续推别的模块：应几乎全被拦
const before = G.PUSH_GOV.total;
const kept2 = G.govFilter('pool', n207);
ok(G.PUSH_GOV.total <= G.pushQuota(), '跨模块累计不超名额', `已用 ${G.PUSH_GOV.total}/${G.pushQuota()}（本轮通过 ${kept2.length}）`);

// 同一票当天同一类型只能推 1 次
const G2 = mkGov({ pushCooldownMin: 0, pushMaxPerDay: 99 });
ok(G2.govTake('600001', 'pool').ok === true, '首次命中 → 放行');
ok(G2.govTake('600001', 'pool').ok === false, '同模块当天第二次 → 拦下');
ok(G2.govTake('600001', 'trend').ok === true, '换模块首次 → 放行（保留多模型共振的机会）');
ok(G2.govTake('600001', 'bigmoney').ok === true, '同票当天第3次 → 仍放行（上限3次）');

// 冷却期
const G3 = mkGov({ pushCooldownMin: 90, pushMaxPerCode: 9, pushMaxPerDay: 99 });
ok(G3.govTake('600002', 'pool').ok === true, '冷却测试·首次放行');
ok(G3.govTake('600002', 'trend').ok === false, '90分钟冷却期内第二次 → 拦下');

// 强势信号预留席位：普通名额用尽后，强势信号仍能挤进去
const G4 = mkGov({ pushMaxPerDay: 10, pushMaxPerCode: 1, pushCooldownMin: 0 });
let nStrong = 0;
for (let i = 0; i < 10; i++) G4.govTake('60' + String(1000 + i), 'pool');
ok(G4.govTake('609999', 'zt').ok === false, '普通信号：名额耗尽后不放行');
ok(G4.govTake('609998', 'zt', true).ok === true, '强势信号：名额仍预留席位 → 放行');

console.log('\n===== ③ 2026-09-29 纠偏：主闸门从「数量」换成「胜率」 =====');
// 事故复现：线上 pushGov 实测 {quota:30, used:30, left:0, dropped:257}
// 30 个名额是先到先得抢掉的，当天最强的票反而被挡在门外 → 用户问"上涨的怎么没提前发现"。
{
  // 金币A：名额只够 5 个，候选 30 只，其中最后 3 只是 95 分的高胜率票
  const G5 = mkGov({ pushMaxPerDay: 5, pushMaxPerCode: 1, pushCooldownMin: 0 });
  const cands = [];
  for (let i = 0; i < 27; i++) cands.push({ code: '610' + String(i).padStart(3, '0'), prob: 30 + i % 5 });
  cands.push({ code: '620001', prob: 95 }, { code: '620002', prob: 92 }, { code: '620003', prob: 90 });
  const got = G5.govFilter('pool', cands);
  const gotCodes = got.map(x => x.code);
  ok(gotCodes.includes('620001') && gotCodes.includes('620002') && gotCodes.includes('620003'),
    '名额紧张时，高胜率票优先拿到席位（不再被"先来的"挤掉）', gotCodes.join(','));
  const minGot = Math.min(...got.map(x => x.prob));
  ok(minGot >= 90, '留下来的都是高分：最低分也应 ≥90', `最低=${minGot}`);
  // 普通信号只能用 65% 名额（另 35% 留给封板/强势），5*0.65 取整 = 3
  const ceil = Math.max(1, Math.round(5 * (1 - 0.35)));
  ok(G5.PUSH_GOV.total === ceil, `普通信号受 65% 名额约束（另留 35% 给强势信号）`, `已推 ${G5.PUSH_GOV.total}/${ceil}`);
  ok(G5.govTake('620004', 'zt', true, 97).ok === true, '强势信号仍能挤进预留席位');

  // 金币B：胜率门槛 —— 名额再空也不发低质量的
  const G6 = mkGov({ pushMaxPerDay: 0, pushMinProb: 55 });   // 0=不限额度
  ok(G6.govTake('630001', 'pool', false, 30).ok === false, '预估胜率30% < 门槛55% → 拦下（名额空着也不发）');
  ok(G6.govTake('630002', 'pool', false, 80).ok === true, '预估胜率80% ≥ 门槛 → 放行');
  ok(G6.govTake('630003', 'pool', false, null).ok === true, '无预估胜率的播报类(涨停通知)不被门槛误杀');
  ok(G6.PUSH_GOV.lowProb === 1, '低胜率拦截有独立计数，可与"重复/冷却"区分', `lowProb=${G6.PUSH_GOV.lowProb}`);
  ok(G6.pushQuota() === Infinity, 'pushMaxPerDay=0 表示不限量（0 不能被吞成默认值）', String(G6.pushQuota()));

  // 金币C：默认不再是 30 —— 历史默认值正是本次事故的元凶
  const GD = mkGov({});
  ok(GD.pushQuota() === 350, '默认额度已从事故值 30 上调到 350（用户 2026-09-29 追加）', String(GD.pushQuota()));
}

console.log('\n===== ② 四级资金：回答"到底流入多还是流出多" =====');
const em = require('./em');
const bal = em.flowBalance;
const cases = [
  ['超大单买/散户卖（健康的净流入）', { superNet: 56192165, bigNet: 16515239, midNet: -1133120, smallNet: -71574272 }, 'in'],
  ['超大单跑/次级大单接（表面净流出实为分歧）', { superNet: -48141424, bigNet: 16474822, midNet: 20228375, smallNet: 11438227 }, 'mixed'],
  ['主力出逃散户接盘（典型诱多）', { superNet: -7775523, bigNet: -5094773, midNet: 6981755, smallNet: 5888544 }, 'out'],
];
for (const [n, t, exp] of cases) {
  const r = bal(t);
  ok(r.dir === exp && r.consistent, n, `${r.dir} · ${r.label.slice(0, 26)}…`);
}
ok(bal({ superNet: 100, bigNet: 100, midNet: 100, smallNet: 100 }).dir === 'unknown', '四级净额不守恒 → 判定不可信，不再瞎给方向');
// 恒等式回归：真实数据下四级必须归零
const real = { superNet: 56192165, bigNet: 16515239, midNet: -1133120, smallNet: -71574272 };
ok(Math.abs(real.superNet + real.bigNet + real.midNet + real.smallNet) < 1e4, '恒等式 超大单+大单+中单+小单=0 成立（字段语义正确）');
ok(fs.readFileSync(path.join(__dirname, 'em.js'), 'utf8').includes('flowBalance'), 'em.js 已导出买卖力量对比');

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====\n`);
process.exit(fail ? 1 : 0);
