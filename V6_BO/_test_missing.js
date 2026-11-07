// 守门 · dh 轮：同一个「数据没取到」，在系统里必须是同一个口径
//   本轮角度：全项目到处都在"没取到就给个兜底"，但这些兜底**不是同一件事**，以前各写各的 ——
//   大单缺K线 0.7 / 板块冷热 0.85 / 实证档 50 / 市值 0 / 排序 -1 / **闸门"放行"**。
//   最要命的是最后两条：同一个"取不到质量分"，排序按最差(-1)、闸门按通过，
//   相邻两行两个完全相反的语义；而胜率门是一票否决的硬闸门，
//   L3203 自己写着的既定原则恰恰是「判不出来」≠「判了通过」。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const SVS = strip(SV);

let FAIL = 0, N = 0;
const ok = (name, cond, extra) => { N++; if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } };

const cut = (a, b) => { const i = SV.indexOf(a), j = SV.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return SV.slice(i, j); };

// ── 沙箱：把真源码切出来跑（node --check 查不出 ReferenceError / TDZ）────────
const MISS_SRC = cut('const MISS_RULE = {', 'const NO_SCORE_TYPES') + cut('const NO_SCORE_TYPES', 'let _rollbackMsg = null;');
const CFG_SRC = cut('const CFG_RANGE = {', '// 返回人类可读的错误列表') + cut('const _govCfg = k => {', '// 「概率推送线」唯一读取口');
const TODAY_SRC = (() => { const i = SV.indexOf('const todayStr = '); return SV.slice(i, SV.indexOf('};', i) + 2); })();
const GOV_SRC = cut('const PUSH_GOV = { day:', '// ---------------- 推送流水');

function build(cfg) {
  const body = [TODAY_SRC, CFG_SRC, MISS_SRC, GOV_SRC,
    'return { PUSH_GOV, govFilter, govTake, pushGovBlocked, missingOf, missKind, MISS_RULE, NO_SCORE_TYPES };'].join('\n');
  const S = {
    config: cfg || {}, klines: new Map(), fastinRepeat: new Map(),
    stocks: [], ztPool: [], candidatePool: [], trendPool: [], trendScan: []
  };
  // ⛔ 注入清单（踩过 15 次的坑）：pushQuota / pushGovCodesN / pushGovBlocked / savePushGov /
  //    modDayTake / pushMinProb / govFilter / govTake 都已经**在 GOV_SRC 里**，再当形参传进去
  //    就是重复声明 → SyntaxError（不是变红，是整个套件崩掉）。只补注入源码外的那几个。
  const fn = new Function('S', 'console', 'fusedProb', 'krowsOf', 'path', 'fs', 'atomicWrite', 'isReplica', '__dirname',
    'marketHealthNote', 'MSG_STAT', body);
  return fn(S, { log() { }, error() { } },
    (code, name, rows, type, p) => ({ prob: p, model: p, emp: null, la: null, delta: 0, src: '替身', why: '' }),
    () => null,
    { join: (a, b) => a + '/' + b },
    { readFileSync: () => { throw new Error('沙箱无存档'); } },
    () => true, () => false, D,
    () => '', { total: 0, by: {}, blocked: 0 });
}

console.log('【A】MISS_RULE 表：每个"没取到"都必须声明自己是哪一类');
{
  const M = build({});
  const ks = Object.keys(M.MISS_RULE);
  ok('登记表非空', ks.length >= 8, '实得 ' + ks.length);
  const KINDS = ['weight', 'worst', 'block', 'clear'];
  for (const k of ks) {
    const d = M.MISS_RULE[k];
    ok(k + ' 的 kind 合法', KINDS.indexOf(d.kind) >= 0, d.kind);
    ok(k + ' 有 note 说明', typeof d.note === 'string' && d.note.length > 0);
    // block（不放行）与 clear（明说没判）都**不该有兜底值** —— 给个值就等于又造了一个"替补分"
    ok(k + ' 的 value 与 kind 自洽',
      (d.kind === 'clear' || d.kind === 'block') ? d.value === null : Number.isFinite(d.value), JSON.stringify(d));
  }
  ok('missingOf 取得到值', M.missingOf('bmCtxWeight') === 0.7 && M.missingOf('empBucketRate') === 50);
  ok('missKind 取得到类别', M.missKind('govGate') === 'block' && M.missKind('govSort') === 'worst');
  ok('⛔ 胜率闸门那一类必须是 block（判不出 = 不放行）', M.missKind('govGate') === 'block');
  ok('⛔ 排序那一类必须是 worst（按最差）', M.missKind('govSort') === 'worst');
  ok('未登记的键返回 null 而不是 undefined 乱飞', M.missingOf('不存在') === null && M.missKind('不存在') === '');
}

console.log('【B】实现侧不许再裸写那三个中性值（口径必须来自表）');
{
  // 剥注释版里，"缺数据兜底"语境下不许再出现 0.7 / 0.85 / 50 的裸字面量
  const lines = SVS.split('\n');
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/missingOf\(/.test(l)) continue;                       // 已经收口的
    if (/: 0\.7;/.test(l) && /weight|ctx/.test(l)) bad.push('L' + (i + 1) + ' 位置权重 0.7');
    if (/: 0\.85;/.test(l) && /heat/.test(l)) bad.push('L' + (i + 1) + ' 板块冷热 0.85');
    if (/rate != null\) \? b\.rate : 50/.test(l)) bad.push('L' + (i + 1) + ' 实证档 50');
  }
  ok('三处中性值全部改走 missingOf（' + (bad.length ? bad.join(' | ') : '干净') + '）', bad.length === 0);
  // 反证：旧写法确实是裸写（说明这条断言有效）
  ok('反证·旧写法是裸写 0.7（断言确实钉住了改动）',
    /: 0\.7;/.test('const w = (x.ctx && x.ctx.weight != null) ? x.ctx.weight : 0.7;'));
}

console.log('【C】⛔⛔ 取不到质量分 → 闸门不许放行（判不出 ≠ 通过）');
{
  const M = build({});
  M.PUSH_GOV.day = ''; M.PUSH_GOV.total = 0; M.PUSH_GOV.dropped = 0; M.PUSH_GOV.lowProb = 0; M.PUSH_GOV.noScore = 0;
  // 一只完全没有质量分的票（既无 prob 也无 riseProb / score / trendScore）
  const noScoreItem = { code: '600000', name: '浦发银行' };
  const got = M.govFilter('bigmoney', [noScoreItem]);
  ok('取不到质量分的票被拦下（不放行）', got.length === 0, '实得 ' + got.length + ' 条');
  ok('计入 noScore（且计入 dropped）', (M.PUSH_GOV.noScore || 0) >= 1 && M.PUSH_GOV.dropped >= 1,
    'noScore=' + M.PUSH_GOV.noScore + ' dropped=' + M.PUSH_GOV.dropped);
  // 有分的票照常走闸门（用非豁免类型 pool 验通用胜率门：bigmoney 已豁免，见下）：分够 → 过；分不够 → 被胜率门拦
  const hi = { code: '600001', name: '高分票', prob: 90 };
  const lo = { code: '600002', name: '低分票', prob: 10 };
  M.PUSH_GOV.dropped = 0; M.PUSH_GOV.lowProb = 0; M.PUSH_GOV.noScore = 0;
  const g2 = M.govFilter('pool', [hi, lo]);
  ok('有分的高分票照常通过', g2.length >= 1 && g2.some(x => x.code === '600001'), '实得 ' + g2.map(x => x.code).join('/'));
  ok('有分的低分票被胜率门拦下（走的是 lowProb 不是 noScore）',
    !g2.some(x => x.code === '600002') && (M.PUSH_GOV.lowProb || 0) >= 1, 'lowProb=' + M.PUSH_GOV.lowProb);
  // ⛔ gs 轮修复「大单没推送记录」根因：bigmoney / bigmoney-B 现豁免 limit-up 胜率门（与 fastin 同口径）。
  //   低分大单票（prob=10）照样过闸门——它赌的是「主力在扫货」而非「次日涨停」，不该被胜率门卡死。
  M.PUSH_GOV.dropped = 0; M.PUSH_GOV.lowProb = 0; M.PUSH_GOV.noScore = 0;
  const gBm = M.govFilter('bigmoney', [lo]);
  ok('bigmoney 低分票豁免胜率门（gs 修复：大单不再被 limit-up 胜率卡死）',
    gBm.length === 1 && gBm[0].code === '600002' && (M.PUSH_GOV.lowProb || 0) === 0, '实得 ' + gBm.map(x => x.code).join('/'));
  // 反证：旧判据 `prob != null && …` 在 prob 为 undefined 时整条不成立 → 不进拦截分支 = 放行
  const oldBlocked = new Function('prob',
    'return !!(prob != null && Number.isFinite(prob) && 55 > 0 && 0 < 55);')(undefined);
  ok('反证·旧判定式在 prob 为 undefined 时不成立 = 放行（说明断言钉住了改动）', oldBlocked === false);
  const oldPass = new Function('prob',
    'return !(prob != null && Number.isFinite(prob) && 55 > 0 && 90 < 55);')(90);
  ok('反证·旧写法对高分票照常通过（改动没有误伤正常路径）', oldPass === true);
  // 登记豁免后放行
  M.NO_SCORE_TYPES.add('exempt');
  const g3 = M.govFilter('exempt', [{ code: '600003', name: '豁免票' }]);
  ok('登记进 NO_SCORE_TYPES 的类型放行', g3.length === 1, '实得 ' + g3.length);
  M.NO_SCORE_TYPES.delete('exempt');
}

console.log('【D】排序与闸门必须同语义（不许一个按最差、一个按通过）');
{
  const M = build({});
  ok('排序侧取不到分 → 排最末（-1）', M.missingOf('govSort') === -1);
  ok('闸门侧取不到分 → 拦下（block）', M.missKind('govGate') === 'block');
  ok('源码里 _p 用的是 missingOf(govSort)', /return missingOf\('govSort'\)/.test(SVS));
  ok('源码里闸门侧用的是 probAt(x) === undefined 判空', /probAt\(x\) === undefined && !NO_SCORE_TYPES\.has\(type\)/.test(SVS));
}

console.log('【E】三类被拦的数不许互相包含（dc 轮：数量词不许套娃）');
{
  const M = build({});
  M.PUSH_GOV.dropped = 10; M.PUSH_GOV.lowProb = 4; M.PUSH_GOV.noScore = 3;
  const b = M.pushGovBlocked();
  ok('dropped ≥ lowProb + noScore + throttled', b.dropped >= b.lowProb + b.noScore + b.throttled, JSON.stringify(b));
  ok('三类相加正好等于 dropped（不多不少）', b.lowProb + b.noScore + b.throttled === b.dropped, JSON.stringify(b));
  ok('noScore 没有被算进 throttled', b.throttled === 3 && b.noScore === 3, JSON.stringify(b));
  // 极端：noScore 超过剩余时不许把 throttled 挤成负数
  M.PUSH_GOV.dropped = 2; M.PUSH_GOV.lowProb = 0; M.PUSH_GOV.noScore = 99;
  const b2 = M.pushGovBlocked();
  ok('noScore 被钳在剩余额度内（throttled 不为负）', b2.throttled >= 0 && b2.noScore <= 2, JSON.stringify(b2));
  ok('脚注里有第三类的说法', /条因取不到质量分被挡/.test(SVS));
}

console.log('【F】现有 7 个 govFilter 调用点的 items 都带质量分（新闸门今天不误伤）');
{
  const re = /govFilter\(\s*'([^']+)'\s*,\s*([A-Za-z_$][\w$]*)/g;
  let m; const types = [];
  while ((m = re.exec(SVS))) types.push([m[1], m[2]]);
  ok('找得到 govFilter 调用点', types.length >= 5, '实得 ' + types.length);
  // 逐个核实：这些池子的元素确实带质量分字段（静态核对，实测见 _scan_dh.js）
  ok('精选池 pool 用 score', /x\.score != null\) return x\.score/.test(SVS));
  ok('趋势 trend 用 trendScore', /x\.trendScore != null\) return x\.trendScore/.test(SVS));
  ok('B 组 bigmoney-B 用 empOf（兜底 50，不会 undefined）', /govFilter\('bigmoney-B', bCand, null, null, x => empOf\(x\)\)/.test(SVS));
  ok('NO_SCORE_TYPES 目前为空（没有模块拿免检牌）', /const NO_SCORE_TYPES = new Set\(\[\s*\/\*/.test(SV));
}

console.log('【G】"取不到"对外必须说出来（clear 类）');
{
  ok('位置未判定有明写', /位置未判定（缺K线）/.test(SV));
  ok('八字未算出有 baziMiss 标注', /baziMiss/.test(SV) && /未做闸门判定/.test(SV));
  ok('20日取不到写「中期数据不足」', /中期数据不足/.test(SV));
  ok('八字四维不足打「—」而不是 50', /const _dim = v => \(v == null \? '—' : v\);/.test(SVS));
}

console.log('\n' + (FAIL ? '❌ 失败 ' + FAIL + ' / ' + N : '✅ 全部通过 ' + N + ' 条断言'));
process.exit(FAIL ? 1 : 0);
