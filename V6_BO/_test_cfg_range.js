// 配置项取值域守门测试（本轮角度：配置项的取值域与量纲 —— 越界值无人拦，失败方式是**静默**）。
// 这类故障最难自查：写进去了、接口回 ok:true、面板照常显示，但功能从此静悄悄不动了。
//   · probThreshold 是 0~1 的**比例**，pushMinProb 等是 0~100 的**百分数** —— 同一个接口两种量纲；
//     把 82 当 82% 填进比例键 → 判定式 `useProb < 82` 对 0~100 的概率恒成立 → 推送永久静默。
//   · 上界缺失：pushMinProb=200 / bigMoneyPct=500 → 那个模块永久 0 输出。
//   · Number('') === 0：清空输入框提交空串会被当成「设 0 = 完全不限」，与"不改"的意图相反。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
// ⛔ 判"代码里某两件事的先后顺序"必须看**活代码**：本项目的中文注释里会逐字引用旧写法
//   （比如把 `saveCfg()` 和被废弃的那句提示一起写进注释来解释当年踩过的坑），
//   对整份源文件做 indexOf 会先命中注释 → 顺序断言假红。已踩 7 次，统一走剥注释版本。
const { stripNoise } = require('./_codescan.js');
const SVC = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// 从源码里切出一段以 start 开头、按括号配对结束的代码
function takeBlock(startRe) {
  const m = startRe.exec(SV);
  if (!m) throw new Error('未找到片段: ' + startRe);
  const s = SV.indexOf('{', m.index);
  let d = 0;
  for (let i = s; i < SV.length; i++) {
    if (SV[i] === '{') d++;
    else if (SV[i] === '}') { d--; if (!d) return SV.slice(m.index, i + 1); }
  }
  throw new Error('括号未闭合: ' + startRe);
}

group('[1] 把 CFG_RANGE 与 cfgRangeErrors 从源码原样切出来真跑');
const RANGE_SRC = takeBlock(/const CFG_RANGE = \{/);
const FN_SRC = takeBlock(/function cfgRangeErrors\(inObj\) \{/);
const RANGE = new Function(RANGE_SRC + '\nreturn CFG_RANGE;')();
// ⛔ 不能再把 CFG_RANGE 当形参传进去 —— RANGE_SRC 自己就声明了它，会撞 "already been declared"
const check = new Function(RANGE_SRC + '\n' + FN_SRC + '\nreturn cfgRangeErrors;')();
ok('切到取值域表，且键不少于 10 个', Object.keys(RANGE).length >= 10, '实际 ' + Object.keys(RANGE).length);
ok('每个键都有 min / max / hint', Object.values(RANGE).every(r => r.min === 0 && typeof r.max === 'number' && r.max > 0 && !!r.hint));

// ① 0 必须合法 —— aq 轮刚修好的「设 0 = 完全不限」不能被上界校验顺手打回去
group('[2] 下界：0 仍然是合法值（"完全不限"），不能被校验挤掉');
for (const k of Object.keys(RANGE)) ok(`  ${k} = 0 合法`, check({ [k]: 0 }).length === 0, JSON.stringify(check({ [k]: 0 })));

// ② 上界：max 合法、max 之外一律拦下
group('[3] 上界：max 之内放行，越界必须拦下');
for (const k of Object.keys(RANGE)) {
  const r = RANGE[k];
  ok(`  ${k} = ${r.max}（上界）放行`, check({ [k]: r.max }).length === 0);
  ok(`  ${k} = ${r.max + 1}（越界）拦下`, check({ [k]: r.max + 1 }).length === 1);
  ok(`  ${k} = -1（负数）拦下`, check({ [k]: -1 }).length === 1);
}

// ③ 量纲：比例键 vs 百分数键
group('[4] 量纲：probThreshold 是 0~1 的比例，其余门槛是 0~100 的百分数');
ok('⛔ probThreshold = 0.82 合法（比例口径）', check({ probThreshold: 0.82 }).length === 0);
ok('⛔ probThreshold = 82 被拦下', check({ probThreshold: 82 }).length === 1);
ok('  且报错里说清"看着像百分数"并给出正确填法',
  /百分数/.test(check({ probThreshold: 82 })[0]) && /0\.82/.test(check({ probThreshold: 82 })[0]),
  check({ probThreshold: 82 })[0]);
ok('⛔ pushMinProb = 55 合法（百分数口径，与 probThreshold 量纲相反）', check({ pushMinProb: 55 }).length === 0);
ok('⛔ pushMinProb = 200 被拦下（这个键没有上界时 = 全天一条都推不出去）',
  check({ pushMinProb: 200 }).length === 1);
ok('⛔ bigMoneyPct = 500 被拦下（大单模块永久 0 输出）', check({ bigMoneyPct: 500 }).length === 1);

// ④ 空串：Number('') === 0 的陷阱
group('[5] 空串不许被当成 0（Number("") === 0 = 静默变成「完全不限」）');
ok('反证：旧写法确实会把空串当成 0', Number('') === 0 && Number.isFinite(Number('')) && Number('') >= 0);
ok('⛔ 新写法拦下空串', check({ pushMinProb: '' }).length === 1);
ok('  报错里写清想「不限」要显式填 0', /显式填 0/.test(check({ pushMinProb: '' })[0]), check({ pushMinProb: '' })[0]);
ok('⛔ 纯空格同样拦下', check({ simGate: '   ' }).length === 1);
ok('⛔ 非数字字符串拦下', check({ simGate: 'abc' }).length === 1);
ok('⛔ NaN / Infinity 拦下',
  check({ simGate: NaN }).length === 1 && check({ simGate: Infinity }).length === 1);

// ⑤ 白名单：不在表里的键不许写
group('[6] 白名单：防止改表时漏项，把某个键变成"能读不能配"或"能配没校验"');
ok('⛔ 未知键被拦下', check({ someNewKey: 5 }).length === 1);
const ZERO_OK_KEYS = ['pushMaxPerDay', 'pushMinProb', 'pushMaxPerCode', 'pushCooldownMin',
  'pushDailyMsgs', 'pushMinProbPre', 'simGate', 'bigMoneyPct', 'activePctThreshold'];
{
  const missing = ZERO_OK_KEYS.filter(k => !RANGE[k]);
  ok('⛔ aq 轮那 9 个「设 0 = 不限」的键全部在取值域表里（漏一个 = 配了没入口；iq 轮退役 bigMoneyProbGate 后剩 9）',
    missing.length === 0, '缺 ' + missing.join(','));
  ok('⛔ probThreshold 也在表里（它以前是唯一完全不校验的一个）', !!RANGE.probThreshold);
  const orphan = Object.keys(RANGE).filter(k => k !== 'probThreshold' && !ZERO_OK_KEYS.includes(k));
  ok('表里没有凭空登记的孤儿键', orphan.length === 0, '多出 ' + orphan.join(','));
  // 登记的键必须真的有人在读，否则是死配置
  const unread = Object.keys(RANGE).filter(k => !SV.includes("_govCfg('" + k + "'") && !new RegExp('S\\.config\\.' + k + '\\b').test(SV));
  ok('⛔ 每个登记的键都有读取点（没有死配置）', unread.length === 0, '没人读 ' + unread.join(','));
}

// ⑥ 落盘语义：越界必须整批不写，且在 saveCfg 之前 return
group('[7] 落盘语义：越界报错并【原样保留】，绝不半写半不写');
{
  const i = SV.indexOf("p === '/api/config' && req.method === 'POST'");
  ok('找到 /api/config POST 处理块', i > 0);
  const blk = SVC.slice(i, i + 12000);
  const iBad = blk.indexOf('cfgRangeErrors(');
  const iRet = blk.indexOf('_bad.length');
  const iSave = blk.indexOf('saveCfg()');
  ok('⛔ 先体检（cfgRangeErrors）再落盘', iBad > 0 && iBad < iSave);
  ok('⛔ 越界时直接 return，saveCfg 不会被走到', iRet > 0 && iRet < iSave);
  ok('⛔ 活代码里体检只有一处（注释里引用的不算）',
    [...blk.matchAll(/cfgRangeErrors\(/g)].length === 1,
    String([...blk.matchAll(/cfgRangeErrors\(/g)].length));
  ok('⛔ 报错文案写明"现有配置未被改动"', /现有配置未被改动/.test(blk));
  ok('⛔ 校验通过后统一写入（0 不被 || 吃掉）',
    /c\[k\] !== undefined && c\[k\] !== null/.test(blk) && /S\.config\[k\] = Number\(_cfgIn\[k\]\)/.test(blk));
}

// ⑦ 反证：旧写法会把所有这些值静默收下
group('[8] 反证：旧的写入端会对这些值照单全收（不报错、不提示）');
{
  const oldAccept = (k, v) => (v != null && Number.isFinite(Number(v)) && Number(v) >= 0);
  ok('反证：旧写法收下 probThreshold=82（→ 推送永久静默）', oldAccept('probThreshold', 82) === true);
  ok('反证：旧写法收下 pushMinProb=200（→ 全天推不出一条）', oldAccept('pushMinProb', 200) === true);
  ok('反证：旧写法收下空串（→ 静默变成"完全不限"）', oldAccept('pushMinProb', '') === true);
  // 旧那行只判 typeof === 'number'，82 / -1 / 1e9 全都是 number → 一律照收
  const oldProbLine = v => typeof v === 'number';
  ok('反证：旧的 probThreshold 那行只查 typeof，82 与 -1 都照单全收',
    oldProbLine(82) === true && oldProbLine(-1) === true && oldProbLine(1e9) === true);
  ok('⛔ 源码里已不存在那行裸赋值', !/if \(typeof c\.probThreshold === 'number'\) S\.config\.probThreshold = c\.probThreshold;/.test(SV));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
