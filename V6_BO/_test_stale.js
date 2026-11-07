// 守门 · dm 轮：同一个「这份数据新不新鲜」的结论，四个出口必须说同一句话
//   上一轮（dl）收的是「成功有几种说法」；这一轮往外一层 —— 系统对**用户**下的那些结论
//   （「数据源没回来」「今日无涨停」「已送达」…）在【面板 / 推送 / 日志 / 接口返回值】四个出口
//   是不是同一套措辞、同一套判据。实测最刺眼的一处：
//     · 后端 12 处 `marketReady()` 决定「数据源没回来就保留上一次结果」
//     · 日志里 14 处「行情源」+ 9 处「未就绪」+ 4 处「保留上一次」
//     · **面板侧 0 处提及** —— 界面照旧显示「更新于 10:23:11」，那个时间是上一次的
//   这就是标准的「面板说没事、日志在报警」。同一个「陈旧」还写过五遍
//   （kStale / pxStale / reviewStale / stale / staleBoard），其中两种面板同样 0 处可见。
//   修法：STALE_KIND 四种新鲜度 + STALE_RULE 各池，唯一写入 staleMark、唯一读取 staleLine。
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');

let FAIL = 0, N = 0;
const ok = (name, cond, extra) => { N++; if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); } };
const cut = (src, a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) throw new Error('锚点: ' + a); return src.slice(i, j); };

// ── 沙箱：把 STALE 整块切出来真跑 ──
const ST_SRC = cut(SV, 'const STALE_KIND = {', '// ─── 「失败」的说法登记表');
const _errs = [], _logs = [];
const F = new Function('console', ST_SRC +
  '\nreturn { STALE_KIND, STALE_RULE, staleMark, staleOf, staleLine, staleState, staleRuleState, _stale };'
)({ error: (...a) => _errs.push(a.join(' ')), log: (...a) => _logs.push(a.join(' ')) });

// ════════ 【A】STALE_KIND：新鲜度的四种说法 ════════
console.log('【A】STALE_KIND：数据新鲜度必须分级');
{
  const ks = Object.keys(F.STALE_KIND);
  ok('四种新鲜度齐备', ['fresh', 'held', 'empty', 'none'].every(k => ks.indexOf(k) >= 0), ks.join(','));
  for (const k of ks) {
    const d = F.STALE_KIND[k];
    ok(k + ' 有 word（面板措辞）', typeof d.word === 'string' && d.word.length > 0);
    ok(k + ' 有 note 说明', typeof d.note === 'string' && d.note.length > 0);
  }
  // ⛔ 核心：沿用上一次与本轮算出来的，必须是两个不同的说法
  ok('⛔ fresh 与 held 的措辞不同', F.STALE_KIND.fresh.word !== F.STALE_KIND.held.word,
    F.STALE_KIND.fresh.word + ' vs ' + F.STALE_KIND.held.word);
  ok('held 的说法里点明是上一次', F.STALE_KIND.held.word.indexOf('上次') >= 0);
  ok('held 的 note 里写明不许写「更新于」', F.STALE_KIND.held.note.indexOf('不许写') >= 0);
  ok('staleRuleState 下发全部种类', Object.keys(F.staleRuleState()).length === ks.length);
}

// ════════ 【B】staleMark：唯一写入口 ════════
console.log('【B】staleMark：写入必须登记，未登记的一律拒绝并报错');
{
  F.staleMark('bigMoney', 'fresh');
  ok('写入后读得到', F.staleOf('bigMoney') === 'fresh');

  _logs.length = 0; _errs.length = 0;
  F.staleMark('bigMoney', 'held');
  ok('⛔ 转 held 时日志侧留了同一句话', _logs.join(' ').indexOf('行情源未就绪') >= 0, _logs.join(' '));
  ok('日志里带上了池名（不是一句笼统的失败）', _logs.join(' ').indexOf(F.STALE_RULE.bigMoney) >= 0);

  _logs.length = 0;
  F.staleMark('bigMoney', 'held');
  ok('连续 held 只报一次（不刷屏）', _logs.length === 0, '实得 ' + _logs.length);

  _errs.length = 0;
  const before = F.staleOf('bigMoney');
  F.staleMark('一个没登记的池', 'held');
  ok('⛔ 未登记的池被拒绝', F.staleOf('bigMoney') === before);
  ok('且报了错（不是静默忽略）', _errs.join(' ').indexOf('未登记的池') >= 0, _errs.join(' '));
  _errs.length = 0;
  F.staleMark('bigMoney', '一个没登记的新鲜度');
  ok('⛔ 未登记的新鲜度被拒绝', _errs.join(' ').indexOf('未登记的新鲜度') >= 0, _errs.join(' '));
}

// ════════ 【C】staleLine：面板 / 文案的唯一出口 ════════
console.log('【C】staleLine：沿用上一次时绝不许写「更新于」');
{
  F.staleMark('pre', 'fresh');
  let s = F.staleLine('pre', '10:23:11');
  ok('fresh → 更新于 + 时间', s.indexOf('更新于') >= 0 && s.indexOf('10:23:11') >= 0, s);

  F.staleMark('pre', 'held');
  s = F.staleLine('pre', '10:23:11');
  ok('⛔ held 不许写「更新于」', s.indexOf('更新于') < 0, s);
  ok('held 写明行情源未就绪', s.indexOf('行情源未就绪') >= 0, s);
  ok('held 写明沿用上次并把时间带上', s.indexOf('沿用上次') >= 0 && s.indexOf('10:23:11') >= 0, s);
  ok('held 带警示符号', s.indexOf(F.STALE_KIND.held.mark) >= 0, s);

  F.staleMark('pre', 'empty');
  s = F.staleLine('pre', '10:23:11');
  ok('empty 是本轮无（不是故障也不是沿用）', s.indexOf('本轮无') >= 0, s);

  F.staleMark('pre', 'none');
  ok('none → 未产出', F.staleLine('pre', '10:23:11') === '未产出', F.staleLine('pre', '10:23:11'));
  F.staleMark('pre', 'fresh');
  ok('没时间时不崩（显示 - 而不是 undefined）', F.staleLine('pre', '').indexOf('-') >= 0, F.staleLine('pre', ''));
  F.staleMark('pre', 'held');
  ok('⛔ held 且没时间也照样标注', F.staleLine('pre', '').indexOf('行情源未就绪') >= 0 && F.staleLine('pre', '').indexOf('更新于') < 0, F.staleLine('pre', ''));
}

// ════════ 【D】staleState：下发面板 ════════
console.log('【D】staleState：每个池都要有新鲜度结论');
{
  F.staleMark('buzhang', 'held');
  const st = F.staleState();
  const ks = Object.keys(st);
  ok('覆盖登记表里的全部池', ks.length === Object.keys(F.STALE_RULE).length, '实得 ' + ks.length);
  for (const k of ks) {
    ok(k + ' 有中文名', typeof st[k].name === 'string' && st[k].name.length > 0);
    ok(k + ' 有 kind', !!st[k].kind);
    ok(k + ' 有 mark', typeof st[k].mark === 'string');
  }
  ok('buzhang 下发的是 held', st.buzhang.kind === 'held');
  ok('未打标的池回落到 none（不是 fresh）',
    ks.filter(k => st[k].kind === 'none').length > 0);
  ok('none 不带「更新于」语义', st.ztPool.word === F.STALE_KIND.none.word || st.ztPool.kind !== 'none');
}

// ════════ 【E】源码契约：各池的「保留上一次」分支真的打了 held ════════
console.log('【E】源码契约：保留上一次的分支必须打 held，算出来的必须打 fresh');
{
  const POOLS = ['bigMoney', 'pre', 'buzhang', 'myrules', 'nextplan', 'review'];
  for (const p of POOLS) {
    ok(p + ' 有 held 打点（保留上一次）', SV.indexOf("staleMark('" + p + "', 'held')") >= 0);
    ok(p + ' 有 fresh 打点（本轮算出）', SV.indexOf("staleMark('" + p + "', 'fresh')") >= 0);
  }
  // ⛔ held 必须挂在「行情源没回来」那一支（else 分支），不能挂在 marketReady 为真那支
  const lines = SV.split('\n');
  let okPair = 0, bad = [];
  lines.forEach(l => {
    const m = l.match(/staleMark\('(\w+)', 'held'\)/);
    if (!m) return;
    // 同一行（或紧邻上一行）应当是 else / !marketReady 语境
    if (/else\s+staleMark|marketReady\(\)\)\s*\{[^}]*staleMark\('(\w+)', 'empty'\)/.test(l)) { okPair++; return; }
    if (/staleMark\('\w+', 'held'\)/.test(l) && /^\s*else/.test(l)) { okPair++; return; }
    bad.push(l.trim().slice(0, 90));
  });
  ok('⛔ 每处 held 都挂在「未就绪」那一支', bad.length === 0, bad.join(' | '));
  ok('held 打点数 ≥ 6', okPair >= 6, '实得 ' + okPair);
}

// ════════ 【F】前端真的用上了 ════════
console.log('【F】前端：面板必须把新鲜度说出来');
{
  ok('前端有 staleTime 出口', /function staleTime\(s, pool, time\)/.test(HV));
  ok('前端读了 s.staleState', /s\.staleState/.test(HV));
  ok('前端有 renderStaleState', /function renderStaleState/.test(HV));
  ok('refresh 里调了它', /renderStaleState\(s\)/.test(HV));
  ok('抽屉里有 staleBox 容器', /id="staleBox"/.test(HV));
  const calls = (HV.match(/staleTime\(s, '/g) || []).length;
  ok('⛔ 各池的时间显示改走统一出口', calls >= 6, '实得 ' + calls);
  for (const p of ['bigMoney', 'myrules', 'review', 'buzhang', 'pre', 'nextplan'])
    ok('面板 ' + p + ' 走统一出口', HV.indexOf("staleTime(s, '" + p + "'") >= 0);
  // ⛔ helper 里 held 分支不许出现「更新于」
  const i = HV.indexOf('function staleTime(s, pool, time) {');
  let d = 0, j = i;
  for (; j < HV.length; j++) { if (HV[j] === '{') d++; else if (HV[j] === '}') { d--; if (!d) break; } }
  const fn = HV.slice(i, j + 1);
  const h = fn.indexOf("kind === 'held'");
  const seg = fn.slice(h, fn.indexOf("kind === 'empty'") > h ? fn.indexOf("kind === 'empty'") : fn.length);
  ok('⛔ helper 的 held 分支不写「更新于」', seg.indexOf('更新于') < 0, seg.slice(0, 120));
  ok('helper 的 held 分支写行情源未就绪', seg.indexOf('行情源未就绪') >= 0);
}

// ════════ 【G】跨模块：下发 + 不往数组上挂字段 ════════
console.log('【G】跨模块：/api/state 下发，且不踩「数组挂字段过 JSON 就没了」的坑');
{
  ok('state 下发 staleState', SV.indexOf('staleState: staleState()') >= 0);
  ok('state 下发 staleRule', SV.indexOf('staleRule: staleRuleState()') >= 0);
  // ⛔ ci 轮的老坑：数组上挂的属性 JSON 一遍就没了 → 必须用独立状态表
  ok('⛔ 新鲜度走独立状态表（不挂 S.xxx）', /const _stale = \{\};/.test(SV));
  ok('⛔ 没有给数组型池挂 stale 字段', SV.indexOf('S.steadyUp.stale') < 0 && SV.indexOf('S.trendScan.stale') < 0);
  ok('登记表覆盖了数组型池（用状态表记）',
    ['steadyUp', 'trendScan', 'ztPool', 'candidatePool'].every(k => !!F.STALE_RULE[k]));
}

console.log('\n' + (FAIL ? '❌ 失败 ' + FAIL + ' 项' : '✅ 全部通过') + '（共 ' + N + ' 项断言）');
process.exit(FAIL ? 1 : 0);
