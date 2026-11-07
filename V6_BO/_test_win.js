// 守门 · dj 轮：同一个「最近 N 日」，在系统里是不是同一个窗口
//   本轮角度：系统里到处在说「近3日 / 近20日 / 60日高点 / 90日内涨停 / 95日低点」，
//   而实现是 slice(-N) 切最近 N 根 K 线 —— **名义窗口是 N，实际窗口是 min(N, 你有多少根)**。
//   数据不足时窗口**静默变短**：slice(-90) 在只有 6 根时算的是「6 日内涨停几次」，
//   文案却照写「90日内 1 次涨停」—— 用户会以为这只票三个月才板过一次（弱），
//   真相是它只有 6 天数据、6 天里板了 1 次（其实很猛）。
//   ⛔ 反向也一样：low95 原来 `Math.min(...k.rows.map(r => r.low))` **根本没切 95 根**，
//     数据 200 根时算的是「200 日低点」—— 名不副实的两头都占。
//   修法：窗口登记进 WIN_RULE，对外说法一律走 winLabel（主说法）+ winShort（不足时的尾巴），
//   实际窗口（hi60Win / zt60Win / zt90Win）随值返回。
const fs = require('fs');
const D = __dirname;
const A = require('./analysis');
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const strip = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
const SVS = strip(SV);

let FAIL = 0, N = 0;
const ok = (name, cond, extra) => { N++; if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return src.slice(i, j); };

// ── 沙箱：把 server.js 里的 WIN_RULE 整块切出来真跑 ─────────────────────
const WIN_SRC = cut(SV, 'const WIN_RULE = {', 'let _rollbackMsg = null;');
const W = new Function(WIN_SRC + '\nreturn { WIN_RULE, winOf, winLabel, winShort, zt90Label, winRuleState };')();

const mk = n => Array.from({ length: n }, (_, i) => ({
  date: '2026-01-' + String((i % 28) + 1).padStart(2, '0'), open: 10, high: 10.5, low: 9.5,
  close: 10 + i * 0.01, volume: 1e6, pct: 1.2, turnover: 5
}));

// ════════ 【A】WIN_RULE 登记表 ════════
console.log('【A】WIN_RULE：每个「最近 N 日」都必须登记名义窗口');
{
  const ks = Object.keys(W.WIN_RULE);
  ok('登记表非空', ks.length >= 8, '实得 ' + ks.length);
  for (const k of ks) {
    const d = W.WIN_RULE[k];
    ok(k + ' 的 n 是正整数', Number.isInteger(d.n) && d.n > 0, String(d.n));
    ok(k + ' 有 what 说明', typeof d.what === 'string' && d.what.length > 0);
  }
  for (const k of ['zt90', 'zt60', 'hi60', 'low95'])
    ok('关键窗口 ' + k + ' 已登记', ks.indexOf(k) >= 0);
  ok('winOf(zt90) = 90', W.winOf('zt90') === 90);
  ok('winOf(low95) = 95', W.winOf('low95') === 95);
  ok('未登记的键返回 0', W.winOf('不存在的窗口') === 0);
  const st = W.winRuleState();
  ok('winRuleState 下发全部键', Object.keys(st).length === ks.length);
}

// ════════ 【B】winLabel / winShort：说得与实际一致 ════════
console.log('【B】窗口不足时必须说实际窗口，不许照写名义值');
{
  ok('窗口满(100根) → 说 90日', W.winLabel('zt90', 100) === '90日', W.winLabel('zt90', 100));
  ok('窗口满 → 尾巴为空（不打扰）', W.winShort('zt90', 100) === '');
  ok('⛔ 窗口不足(6根) → 说 6日', W.winLabel('zt90', 6) === '6日', W.winLabel('zt90', 6));
  ok('⛔ 窗口不足 → 尾巴说明实际根数与名义值',
    W.winShort('zt90', 6).indexOf('6根') >= 0 && W.winShort('zt90', 6).indexOf('90日') >= 0, W.winShort('zt90', 6));
  ok('实际值超过名义(200根) → 仍说 90日（不许写 200日）', W.winLabel('zt90', 200) === '90日');
  ok('实际值未知(0/undefined) → 回退名义值',
    W.winLabel('zt90', 0) === '90日' && W.winLabel('zt90', undefined) === '90日');
  ok('实际值未知时尾巴为空（不许说"数据仅0根"）', W.winShort('zt90', 0) === '');
  ok('未登记的键两个出口都返回空串', W.winLabel('不存在', 10) === '' && W.winShort('不存在', 10) === '');
  ok('zt90Label 走同一出口', W.zt90Label({ basis: { zt90Win: 6 } }).indexOf('6日') === 0,
    W.zt90Label({ basis: { zt90Win: 6 } }));
  ok('zt90Label 缺 basis 时不炸（回退名义值）', W.zt90Label({}) === '90日');
}

// ════════ 【C】真跑 trendPoolCheck：实际窗口随值返回 ════════
console.log('【C】趋势指标必须带「这段窗口实际有多长」');
{
  const call = n => A.trendPoolCheck({
    rows: mk(n), fundDays: [], price: 12, mainInflow: 1e6, floatCap: 8e9, code: '000001', name: '测试'
  });
  const full = call(100);
  ok('100 根：hi60Win = 60', full && full.hi60Win === 60, full && String(full.hi60Win));
  ok('100 根：zt60Win = 60', full && full.zt60Win === 60, full && String(full.zt60Win));
  const short = call(30);
  ok('30 根：hi60Win = 30（不是 60）', short && short.hi60Win === 30, short && String(short.hi60Win));
  ok('30 根：zt60Win = 30（不是 60）', short && short.zt60Win === 30, short && String(short.zt60Win));
  ok('⛔ 两个实际窗口确实不同（本轮要治的病）', full.hi60Win !== short.hi60Win);
  ok('dd60 仍是有限数（回归）', Number.isFinite(short.dd60), String(short.dd60));
}

// ════════ 【D】low95：原来根本没切 95 根 ════════
console.log('【D】low95 真 bug：数据多于 95 根时算的是全窗口');
{
  // 前 105 根里有极低点 1，最后 95 根里最低是 9.5 —— 两种算法结果必须不同
  const rows = mk(200);
  for (let i = 0; i < 105; i++) rows[i].low = 1;
  const all = Math.min(...rows.map(r => r.low));          // 旧写法：全窗口
  const w95 = Math.min(...rows.slice(-95).map(r => r.low)); // 新写法：只切 95 根
  ok('反证：旧写法在 200 根时算的不是 95 日低点', all !== w95, all + ' vs ' + w95);
  ok('新写法取到的是 95 日窗口内的低点', w95 === 9.5, String(w95));
  ok('server.js 里 low95 真的切了 95 根', SVS.indexOf('const low95Rows = k.rows.slice(-95);') >= 0);
  ok('且文案走 winLabel（不再写死「距95日低点」）',
    SVS.indexOf('winLabel(\'low95\', low95N)') >= 0 && SVS.indexOf('距95日低点') < 0);
}

// ════════ 【E】文案层：不许再写死名义窗口 ════════
console.log('【E】对外文案必须由 winLabel 产出');
{
  ok('⛔ 不再写死「90日内${」', SVS.indexOf('90日内${') < 0);
  ok('⛔ 不再写死「距60日高点」', SVS.indexOf('距60日高点') < 0);
  ok('⛔ 不再写死「60日内${」', SVS.indexOf('60日内${') < 0);
  ok('⛔ 不再写死「创60日新高」', SVS.indexOf('创60日新高') < 0);
  ok('zt90 文案走 winLabel', SVS.indexOf("winLabel('zt90', k.rows.length)") >= 0);
  ok('hi60 文案走 winLabel', SVS.indexOf("winLabel('hi60', t.hi60Win)") >= 0);
  ok('zt60 文案走 winLabel', SVS.indexOf("winLabel('zt60', t.zt60Win)") >= 0);
  ok('池内项带 zt90Txt 供前端一行显示', SVS.indexOf("zt90Txt:") >= 0);
  ok('前端读 zt90Txt（不再写死 90日）', HV.indexOf("x.zt90Txt || '90日'") >= 0);
  ok('/api/state 下发 winRule', SVS.indexOf('winRule: winRuleState(),') >= 0);
  ok('前端真的读了 s.winRule', /s\.winRule/.test(strip(HV.slice(HV.indexOf('<script'), HV.lastIndexOf('</script>')))));
}

// ════════ 【F】跨模块：同一句「近3日」两种算法 ════════
console.log('【F】同一句「近3日」：K 线按交易日，新闻归档按自然日');
{
  ok('WIN_RULE 登记了 news3', !!W.WIN_RULE.news3);
  ok('且 what 里明写它是自然日口径（不是交易日）',
    (W.WIN_RULE.news3.what || '').indexOf('自然日') >= 0, W.WIN_RULE.news3.what);
  ok('⛔ 两种口径并存是事实（本轮钉住，不许悄悄改成一个数）',
    W.winOf('news3') === 3 && W.WIN_RULE.news3.what.indexOf('不是交易日') >= 0);
  // 反证：K 线窗口按根数（交易日），新闻按自然日 —— 同一个 "3" 含义不同
  ok('反证：K 线的 3 根 = 3 个交易日，与自然日 3 天不是一回事',
    mk(3).length === 3 && W.winLabel('news3', 3) === '3日');
}

console.log('\n' + (FAIL ? '❌ ' + FAIL + ' / ' + N + ' 失败' : '✅ 全部通过 ' + N + ' 条断言'));
process.exit(FAIL ? 1 : 0);
