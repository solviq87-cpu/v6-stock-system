// 模块之间的隐式执行顺序依赖（本轮新角度）—— 形态三池的「基准日」必须如实标注。
//
// 故障形态：scanTrendUniverse / scanSteadyUp / scanZtPre 这三个形态扫描器直接读 K 线缓存的
// 【最后一根】当现价与涨幅，但它是不是「今天」取决于另一路独立的定时器 klineBackfill
// （每 4 分钟补一批、800 只票要跑半小时，而 9:15~15:10 盘中**一根都不补**）——
// 这就是典型的隐式执行顺序依赖：扫描器假定回填已经先跑完，实际上没有任何机制保证。
// 回填没跟上时，池里的价是【上一交易日收盘】的，而同屏的精选池/涨停池/持仓走的是实时行情
// → 同一只票一屏出现两个价，三个池却没有任何日期标注，用户根本无从分辨，
//   还会拿昨天的价去下单（az 那轮刚修完「不许按陈旧价卖出」，这里正是陈旧价的另一个入口）。
// 修法：扫描时统计每只票最后一根 K 线的日期分布，算出本池真实的「基准日」，
//      与 dataTradeDay() 期望的今日比对，陈旧或部分回填就在【推送文案 + 面板标题行】两处明说。
//      不阻断扫描 —— 用昨日收盘形态选股本就是盘后选股的正常做法，错的是把它说成「现在」。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HT = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// ── 把两个纯函数抠出来真跑一遍（只测行为，不依赖整个 server）──
function extractFn(src, name) {
  // ⚠️ 兼容 `async function xxx(`：scanTrendUniverse / scanSteadyUp 都是 async
  const a = src.search(new RegExp('^(async\\s+)?function ' + name + '\\(', 'm'));
  if (a < 0) return '';
  // ⚠️ 形参表里的解构 `{ ... }` 会把花括号计数骗住 —— 必须先跳过形参表再找函数体的 '{'
  let p = src.indexOf('(', a), pd = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++;
    else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  let i = src.indexOf('{', k), depth = 0, inStr = null;
  if (i < 0) return '';
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(a, j + 1); }
  }
  return '';
}
const FnBasisOf = extractFn(SV, 'basisOf');
const FnBasisLine = extractFn(SV, 'basisLine');

group('[0] 两个纯函数存在且可抠出');
ok('basisOf 存在', FnBasisOf.length > 0);
ok('basisLine 存在', FnBasisLine.length > 0);

const basisOf = new Function(FnBasisOf + '\nreturn basisOf;')();
const basisLine = new Function(FnBasisOf + '\n' + FnBasisLine + '\nreturn basisLine;')();

group('[1] basisOf：基准日取众数，并判陈旧 / 部分回填');
{
  const m1 = new Map([['20261005', 700], ['20261006', 100]]);
  const b1 = basisOf(m1, 800, '20261006');
  ok('众数日 = 20261005（回填没跟上的真实现场）', b1.day === '20261005', b1.day);
  ok('totalN 透传', b1.totalN === 800);
  ok('freshN = 今日已回填只数', b1.freshN === 100, String(b1.freshN));
  ok('stale = true（众数日 ≠ 期望日）', b1.stale === true);

  const b2 = basisOf(new Map([['20261006', 800]]), 800, '20261006');
  ok('全量回填到今天 → 不陈旧', b2.stale === false && b2.freshN === 800);

  const b3 = basisOf(new Map([['20261006', 500], ['20261005', 300]]), 800, '20261006');
  ok('部分回填：众数已是今天 → 不算陈旧', b3.stale === false);
  ok('部分回填：freshN 仍如实记 500', b3.freshN === 500, String(b3.freshN));

  const b4 = basisOf(new Map(), 0, '20261006');
  ok('空池：day 为空、不崩', !b4.day && b4.totalN === 0 && b4.stale === false);

  const b5 = basisOf(new Map([['20261005', 5]]), 5, '');
  ok('期望日取不到（dataTradeDay 失败）→ 不判陈旧（没基准就不许瞎标）', b5.stale === false);
}

group('[2] basisLine：陈旧必须说清楚，新鲜不许乱说话');
{
  const stale = basisLine({ day: '20261005', totalN: 800, freshN: 100, expect: '20261006', stale: true });
  ok('陈旧 → 有文案', stale.length > 0);
  // date 字段主流是 'YYYY-MM-DD'、个别源是 'YYYYMMDD' —— 两种都要渲染成带横杠的，
  // 否则同一条推送里出现两种日期格式，用户会以为是两份不同来源的数据。
  ok('陈旧文案把 20261005 渲染为 2026-10-05', stale.indexOf('2026-10-05') >= 0, stale);
  ok('陈旧文案把 20261006 渲染为 2026-10-06', stale.indexOf('2026-10-06') >= 0, stale);
  ok('陈旧文案明说「不是当前实时价」', stale.indexOf('不是当前实时价') >= 0, stale);
  const dashIn = basisLine({ day: '2026-10-05', totalN: 800, freshN: 100, expect: '2026-10-06', stale: true });
  ok('输入本就是带横杠的日期时不重复加杠', dashIn.indexOf('2026-10-05') >= 0 && dashIn.indexOf('2026--') < 0, dashIn);

  const partial = basisLine({ day: '20261006', totalN: 800, freshN: 500, expect: '20261006', stale: false });
  ok('部分回填 → 有文案', partial.length > 0);
  ok('部分回填文案带 500/800', partial.indexOf('500/800') >= 0, partial);

  const fresh = basisLine({ day: '20261006', totalN: 800, freshN: 800, expect: '20261006', stale: false });
  ok('全量新鲜 → 不加废话（避免每次都挂个日期反而看麻木）', fresh === '', JSON.stringify(fresh));

  ok('basisLine(null) 不崩且为空', basisLine(null) === '');
  ok('basisLine({}) 不崩且为空', basisLine({}) === '');
  ok('无期望日 → 不标（不许拿空基准瞎说）',
    basisLine({ day: '20261005', totalN: 5, freshN: 0, expect: '', stale: false }) === '');
}

group('[3] 三个扫描器都要采集日期直方图并落 S.*Basis');
{
  const SCANS = [
    { fn: 'scanZtPre', key: 'ztPreBasis' },
    { fn: 'scanTrendUniverse', key: 'trendScanBasis' },
    { fn: 'scanSteadyUp', key: 'steadyUpBasis' }
  ];
  for (const { fn, key } of SCANS) {
    const a = SV.search(new RegExp('^(async )?function ' + fn + '\\(', 'm'));
    if (a < 0) { ok(fn + ' 存在', false); continue; }
    const body = SV.slice(a, a + 6000);
    ok(`${fn} 取期望交易日 dataTradeDay()`, /_expDay\s*=\s*\(await\s+dataTradeDay\(\)\)/.test(body));
    ok(`${fn} 采集最后一根K线日期 _bd/_bTot`, /_bd\.set\(/.test(body) && /_bTot\+\+/.test(body));
    ok(`${fn} 写 S.${key}`, new RegExp('S\\.' + key + '\\s*=\\s*basisOf\\(').test(body));
  }
}

group('[4] 三路推送文案都要带基准日（不然用户照样被蒙）');
{
  const PUSH = [
    { fn: 'pushZtPre', key: 'ztPreBasis' },
    { fn: 'pushTrendScan', key: 'trendScanBasis' },
    { fn: 'pushSteadyUp', key: 'steadyUpBasis' }
  ];
  for (const { fn, key } of PUSH) {
    const a = SV.search(new RegExp('^(async )?function ' + fn + '\\(', 'm'));
    if (a < 0) { ok(fn + ' 存在', false); continue; }
    const body = SV.slice(a, a + 6000);
    ok(`${fn} 拼入 basisLine(S.${key})`,
      new RegExp('basisLine\\(S\\.' + key + '\\)').test(body));
  }
}

group('[4b] 精选池：评分 / 获利筹码 / 八字四维同样由K线算出，也要带基准日');
{
  const a = SV.search(/^(async )?function rebuildPool\(/m);
  ok('rebuildPool 存在', a > 0);
  const body = SV.slice(a, a + 40000);
  ok('rebuildPool 写 S.poolBasis', /S\.poolBasis\s*=\s*basisOf\(/.test(body));
  ok('rebuildPool 的基准日与 tradeKey 对齐（用同一份 dataTradeDay 结果）',
    /basisOf\(_pb,\s*_pbTot,\s*tradeKey \|\| ''\)/.test(body));
  ok('陈旧时打日志（不能只在内存里，线上要能查）',
    /S\.poolBasis\.stale[\s\S]{0,200}console\.log/.test(body));
  const pa = SV.indexOf('poolMsgPart = `【新增达标标的】');
  ok('盘中新增达标推送拼入 basisLine(S.poolBasis)', pa > 0 && /basisLine\(S\.poolBasis\)/.test(SV.slice(pa, pa + 200)));
}

group('[5] 面板后端出口：/api/state 必须下发四个基准日（前端只认 state）');
{
  const a = SV.indexOf("if (p === '/api/state')");
  ok('/api/state 路由存在', a > 0);
  const body = SV.slice(a, a + 16000);   // /api/state 的返回体很长，窗口必须够宽
  for (const k of ['ztPreBasis', 'trendScanBasis', 'steadyUpBasis', 'poolBasis']) {
    ok(`/api/state 下发 ${k}`, new RegExp('\\b' + k + ':').test(body));
  }
  // 三个独立 GET 接口同样要带（手动扫描后前端会从这里取）
  ok('/api/ztpre GET 带 basis', /items:\s*S\.ztPre \|\| \[\],\s*basis:/.test(SV));
  ok('/api/trend-scan GET 带 basis', /items:\s*S\.trendScan \|\| \[\],\s*prog:\s*_tsProg,\s*basis:/.test(SV));
  ok('/api/steady-up GET 带 basis', /items:\s*S\.steadyUp \|\| \[\],\s*basis:/.test(SV));
}

group('[6] 面板前端：四个区块标题行都要显示基准日（否则一屏两价仍无解）');
{
  ok('前端有 basisTxt 构造函数', /const basisTxt\s*=\s*b\s*=>/.test(HT));
  // ⛔ TDZ 防线：basisTxt 是 const 箭头函数，定义必须早于所有使用点。
  //    精选池在面板最上面（poolInfo），若把 basisTxt 写在形态三池旁边（更靠后），
  //    渲染到 poolInfo 那一行会直接 ReferenceError —— 而整段 refresh 外层有 catch，
  //    页面只是停在旧数据，控制台才有报错，手机上根本看不到。
  const iDef = HT.indexOf('const basisTxt');
  const iPoolUse = HT.indexOf("getElementById('poolInfo')");
  ok('basisTxt 定义早于精选池使用点（const 有 TDZ，写后面会整页渲染中断）', iDef > 0 && iDef < iPoolUse,
    `def=${iDef} poolInfo=${iPoolUse}`);
  for (const [id, key] of [['poolInfo', 'poolBasis'], ['zpInfo', 'ztPreBasis'], ['tsInfo', 'trendScanBasis'], ['suInfo', 'steadyUpBasis']]) {
    const re = new RegExp("getElementById\\('" + id + "'\\)\\.textContent\\s*=[^;]*basisTxt\\(s\\." + key + "\\)");
    ok(`${id} 标题行拼入 basisTxt(s.${key})`, re.test(HT));
  }
  const fn = (HT.match(/const basisTxt\s*=\s*b\s*=>[\s\S]*?\n      \};/) || [''])[0];
  ok('basisTxt：陈旧文案含「非实时价」', fn.indexOf('非实时价') >= 0);
  ok('basisTxt：日期 20261006 渲染为 2026-10-06', /replace\(\/\^\(\\d\{4\}\)/.test(fn));
  ok('basisTxt：空基准返回空串（不许显示 undefined）', /if \(!b \|\| !b\.day\) return '';/.test(fn));
}

group('[7] 反证：这三个池的价来自 K 线最后一根（正是基准日问题的根源，别改错地方）');
{
  // ⛔ 别用固定字符窗口（2026-10-07 踩过一次）：往函数里加注释或判据就会把 basisOf 挤出窗口，
  //    明明接线还在却判红 —— 断言要钉语义（"这个函数体里有 basisOf"），不要钉字符数。
  const body = extractFn(SV, 'scanTrendUniverse');
  ok('趋势扫描函数体抠得出来（不然下面两条等于没测）', body.length > 500, String(body.length));
  ok('趋势扫描确实取 rows.length-1', /const i = rows\.length - 1/.test(body));
  ok('该行有注释指向 basisOf（改口径时别漏看）', /basisOf/.test(body));
}

console.log(`\n===== 基准日标注 守门测试：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
