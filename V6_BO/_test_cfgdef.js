// 守门 · dg 轮：同一个配置键的「默认值」在所有入口下必须是同一个数
//   本轮角度：一个键的默认值以前散在三处 —— ①_govCfg 调用点的第二个参数（15 处各写一遍）
//   ②S.config 初始对象（probThreshold: 0.80）③读取端的 `||` 兜底（`|| null` / `|| 0`）。
//   三处的"没配过"根本不是同一个值：0.80 vs 0.82 vs null，而面板会把这个数印出来。
//   另一半：写入端 cfgRangeErrors 只体检【新提交】的值，config.json 里躺着的越界旧值没人兜 ——
//   pushMinProb=200 从面板提交会被拦下，从文件里读出来却照样全天零推送。
const fs = require('fs');
const D = __dirname;
const rd = f => fs.readFileSync(D + '/' + f, 'utf8');
const SV = rd('server.js');
const HTML = rd('public/index.html');

let FAIL = 0, N = 0;
function ok(name, cond, extra) {
  N++;
  if (!cond) { FAIL++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
function strip(src) {
  return src.split('\n').map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
}
const SVS = strip(SV);   // 剥注释版：中文注释会逐字引用旧代码，判代码必须用它

// ── 从源码里按括号配平抠出真实函数体（不许用固定字符窗口）──────────────────
function grab(startLine, openCh, closeCh) {
  const lines = SV.split('\n');
  let i = lines.findIndex(l => l.indexOf(startLine) === 0 || l.trim().indexOf(startLine) === 0);
  if (i < 0) throw new Error('grab 找不到：' + startLine);
  let depth = 0, out = [];
  for (let j = i; j < lines.length; j++) {
    out.push(lines[j]);
    for (const ch of lines[j]) { if (ch === openCh) depth++; else if (ch === closeCh) depth--; }
    if (depth === 0 && j >= i && lines[j].indexOf(startLine) >= 0 && lines[j].trim().endsWith(closeCh === '}' ? '}' : closeCh)) {
      // 单行定义（如箭头函数一行写完）也要能收尾
      if (/=>\s*[^;{]*;?\s*$/.test(lines[j]) || lines[j].trim().endsWith('};') || lines[j].trim() === '}') break;
    }
    if (depth === 0 && j > i) break;
  }
  return out.join('\n');
}

const SRC_RANGE = grab('const CFG_RANGE = {', '{', '}');
const SRC_ERR = grab('function cfgRangeErrors(inObj) {', '{', '}');
const SRC_GOV = grab('const _govCfg = k => {', '{', '}');
const SRC_PT = 'const probThreshold = () => _govCfg(\'probThreshold\');';
const SRC_STATE = grab('function cfgRangeState() {', '{', '}');

// ── 沙箱：真跑一遍（node --check 查不出 ReferenceError / TDZ）───────────────
function build(S) {
  const body = [SRC_RANGE, SRC_ERR, SRC_GOV, SRC_PT, SRC_STATE,
    'return {CFG_RANGE: CFG_RANGE, cfgRangeErrors: cfgRangeErrors, _govCfg: _govCfg, probThreshold: probThreshold, cfgRangeState: cfgRangeState};'
  ].join('\n');
  return new Function('S', body)(S);
}

console.log('【A】CFG_RANGE 表的完整性');
{
  const M = build({ config: {} });
  const ks = Object.keys(M.CFG_RANGE);
  ok('登记了 10 个数值键（iq 轮退役 bigMoneyProbGate 后 11→10）', ks.length === 10, '实得 ' + ks.length);
  const must = ['probThreshold', 'pushMinProb', 'pushMinProbPre', 'simGate',
    'bigMoneyPct', 'activePctThreshold', 'pushMaxPerDay', 'pushDailyMsgs', 'pushMaxPerCode', 'pushCooldownMin'];
  for (const k of must) ok('白名单含 ' + k, ks.indexOf(k) >= 0);
  for (const k of ks) {
    const d = M.CFG_RANGE[k];
    ok(k + ' 有 def 字段', typeof d.def === 'number');
    ok(k + ' 的 def 落在 [min,max] 内', d.def >= d.min && d.def <= d.max, JSON.stringify(d));
    ok(k + ' 有 hint', typeof d.hint === 'string' && d.hint.length > 0);
  }
}

console.log('【B】默认值只有一个来源 —— _govCfg 不传第二参数');
{
  const M = build({ config: {} });
  for (const k of Object.keys(M.CFG_RANGE)) {
    const got = M._govCfg(k);
    ok('_govCfg(' + k + ') 未配置时返回 def', got === M.CFG_RANGE[k].def, '实得 ' + got);
  }
  // 反证：旧写法 `_govCfg(k, def)` 的默认值写在调用点，源码里必须一个不剩
  const left = (SVS.match(/_govCfg\(\s*'[\w$]+'\s*,/g) || []);
  ok('源码里不再有 _govCfg(键, 默认值) 的写法', left.length === 0, '残留 ' + left.length + ' 处');
  // 反证：S.config 初始对象里不许再躺着数值键的默认值（probThreshold: 0.80 就是这么来的）
  const m = SVS.match(/config:\s*\{[^}]*\}/);
  ok('S.config 初始对象里不含数值配置键', m ? !/\d/.test(m[0]) : false, m ? m[0].slice(0, 80) : '未找到');
}

console.log('【C】⛔ 上界也要在读取端兜住（config.json 是手改得动的文件）');
{
  const M = build({ config: { pushMinProb: 200, bigMoneyPct: 500, probThreshold: 82, pushMaxPerDay: 99999 } });
  ok('pushMinProb=200 退回默认 52', M._govCfg('pushMinProb') === 52, '实得 ' + M._govCfg('pushMinProb'));
  ok('bigMoneyPct=500 退回默认 6', M._govCfg('bigMoneyPct') === 6, '实得 ' + M._govCfg('bigMoneyPct'));
  ok('pushMaxPerDay=99999 退回默认 350', M._govCfg('pushMaxPerDay') === 350, '实得 ' + M._govCfg('pushMaxPerDay'));
  // 反证：旧写法只判 `n >= 0`，这些值会原样生效 → 全天零推送
  const OLD = (n, def) => (Number.isFinite(n) && n >= 0 ? n : def);
  ok('反证·旧写法会把 200 原样放行（说明这条断言有效）', OLD(200, 55) === 200);
  ok('旧写法与新版结论不同（断言确实钉住了改动）', OLD(200, 55) !== M._govCfg('pushMinProb'));
}

console.log('【D】probThreshold 的量纲与零值语义');
{
  const M1 = build({ config: { probThreshold: 82 } });      // 按百分数习惯填了 82
  ok('probThreshold=82（量纲错）退回 0.82', M1.probThreshold() === 0.82, '实得 ' + M1.probThreshold());
  ok('退回后 *100 = 82（能正常判「>82%」）', Math.round(M1.probThreshold() * 100) === 82);
  const M2 = build({ config: { probThreshold: 0 } });       // 合法值 0 = 完全不限
  ok('probThreshold=0 必须还是 0（不被 || 吃掉）', M2.probThreshold() === 0, '实得 ' + M2.probThreshold());
  const M3 = build({ config: {} });                          // 键不存在
  ok('键缺失时是 0.82 而不是 NaN', M3.probThreshold() === 0.82 && !Number.isNaN(M3.probThreshold()), '实得 ' + M3.probThreshold());
  const M4 = build({ config: { probThreshold: null } });     // 手改成 null
  ok('值是 null 时退回 0.82', M4.probThreshold() === 0.82, '实得 ' + M4.probThreshold());
  // 反证：三种旧写法各自错在哪
  ok('反证·裸读 undefined → *100 是 NaN（判定式恒 false → 模块永久静默）', Number.isNaN(undefined * 100));
  ok('反证·`|| null` 把合法的 0 吞成 null', (({ config: { probThreshold: 0 } }).config && 0) || null ? false : true);
  ok('反证·裸读 82 → 门槛变 8200（恒不推）', 82 * 100 === 8200);
}

console.log('【E】源码层面：同一个键不许有第二份读法');
{
  // probThreshold 只允许出现在赋值左值（`S.config.probThreshold = `）与定义/注释里
  const bad = SVS.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => l.indexOf('S.config.probThreshold') >= 0)
    .filter(([, l]) => !/S\.config\.probThreshold\s*=/.test(l));
  ok('S.config.probThreshold 只剩赋值处（读取全走 probThreshold()）', bad.length === 0,
    bad.map(x => 'L' + x[0] + ': ' + x[1].trim().slice(0, 60)).join(' | '));
  ok('定义了唯一读取口 probThreshold()', /const probThreshold = \(\) => _govCfg\('probThreshold'\);/.test(SVS));
  // 调用点全部收到位
  for (const pat of [/const cur = probThreshold\(\);/, /probThreshold\(\) \* 100 \* \(goodHit/, /probThreshold: probThreshold\(\),/]) {
    ok('调用点已收口：' + pat.source.slice(0, 34), pat.test(SVS));
  }
}

console.log('【F】⛔ 定义顺序：回滚段不许引用后面才定义的 const（TDZ）');
{
  const L = SV.split('\n');
  const ln = s => L.findIndex(l => l.indexOf(s) >= 0) + 1;
  const lRange = ln('const CFG_RANGE = {');
  const lGov = ln('const _govCfg = k => {');
  const lPt = ln('const probThreshold = () => ');
  const lRb = ln('if (_upgradeNote) {');
  ok('CFG_RANGE 定义在回滚段之前', lRange > 0 && lRange < lRb, 'CFG_RANGE@' + lRange + ' 回滚@' + lRb);
  ok('_govCfg 定义在回滚段之前', lGov > 0 && lGov < lRb, '_govCfg@' + lGov + ' 回滚@' + lRb);
  ok('probThreshold 定义在回滚段之前', lPt > 0 && lPt < lRb, 'probThreshold@' + lPt + ' 回滚@' + lRb);
  // 反证：如果定义在后面，顶层执行到回滚段会抛 ReferenceError 被 catch 吞掉 → 整段回滚从来没生效
  let threw = false, ename = '';
  try { new Function('const a = () => b; const r = a(); const b = 1; return r;')(); }
  catch (e) { threw = true; ename = e && e.name; }
  ok('反证·const 定义前访问会抛（TDZ，说明这条断言有效）', threw && ename === 'ReferenceError', '实得 ' + (ename || '没抛'));
}

console.log('【G】回滚段的目标值取自表，不再写死');
{
  const L = SVS.split('\n');
  const i = L.findIndex(l => l.indexOf('if (_upgradeNote) {') >= 0);
  const blk = L.slice(i, i + 12).join('\n');
  ok('回滚目标写的是 CFG_RANGE…def', /CFG_RANGE\.probThreshold\.def/.test(blk) && /CFG_RANGE\.simGate\.def/.test(blk));
  ok('回滚段里不再写死 0.82 / 50 / 62', !/=\s*0\.82/.test(blk) && !/=\s*50;/.test(blk) && !/=\s*62;/.test(blk), blk.slice(0, 120));
  ok('回滚段里不再有 `|| 0` 的 probThreshold 兜底', !/S\.config\.probThreshold \|\| 0/.test(blk));
}

console.log('【H】cfgRangeState()：面板看得见默认值与越界');
{
  const M = build({ config: { pushMinProb: 200, simGate: 62 } });
  const st = M.cfgRangeState();
  ok('10 个键全部下发（iq 轮退役 bigMoneyProbGate 后 11→10）', Object.keys(st).length === 10);
  ok('越界值 cur 记为原值 200', st.pushMinProb.cur === 200);
  ok('越界值 bad = bad', st.pushMinProb.bad === 'bad');
  ok('越界值 using = 默认 52', st.pushMinProb.using === 52, '实得 ' + st.pushMinProb.using);
  ok('正常值 bad 为空串', st.simGate.bad === '' && st.simGate.cur === 62);
  const M2 = build({ config: {} });
  const st2 = M2.cfgRangeState();
  ok('未设置 bad = unset', st2.pushMinProb.bad === 'unset' && st2.pushMinProb.cur === null);
  ok('未设置 using = def', st2.pushMinProb.using === 52);
  ok('using 与 _govCfg 同源', Object.keys(st).every(k => st[k].using === M._govCfg(k)));
  // 「没配过」不许被 Number() 转成 0 —— 0 在这些键上是有实义的（= 不限）
  const M3 = build({ config: { pushMinProb: null, pushCooldownMin: '', probThreshold: null } });
  ok('null 视为没配过 → 走默认 52（不是 0=不限）', M3._govCfg('pushMinProb') === 52, '实得 ' + M3._govCfg('pushMinProb'));
  ok('空串视为没配过 → 走默认 30（不是 0=不冷却）', M3._govCfg('pushCooldownMin') === 30, '实得 ' + M3._govCfg('pushCooldownMin'));
  ok('probThreshold=null 走默认 0.82（不是 0=不限）', M3.probThreshold() === 0.82, '实得 ' + M3.probThreshold());
  ok('反证·Number(null) 确实是 0（说明这条断言有效）', Number(null) === 0);
  const M4 = build({ config: { pushMinProb: 'abc' } });
  ok('非数字值走默认', M4._govCfg('pushMinProb') === 52);
  ok('非数字时 cfgRangeState 给得出原样值', M4.cfgRangeState().pushMinProb.raw === 'abc');
  // 所有调用点的键都必须登记在表里（否则 def 取不到会静默变 0）
  const usedKeys = [...new Set((SVS.match(/_govCfg\('([\w$]+)'\)/g) || []).map(s => s.slice(9, -2)))];
  ok('调用点的键全部登记在 CFG_RANGE 里', usedKeys.every(k => k in M.CFG_RANGE), usedKeys.filter(k => !(k in M.CFG_RANGE)).join(','));
  ok('/api/state 真的下发 cfgRange', /cfgRange: cfgRangeState\(\),/.test(SVS));
}

console.log('【I】面板入口（不然又是「承诺了没有兑现路径」）');
{
  const HS = HTML.split('\n').filter((l, i) => true);
  ok('面板有 cfgRangeBox 容器', HTML.indexOf('id="cfgRangeBox"') > 0);
  ok('面板有 renderCfgRange 函数', /function renderCfgRange\(s\)/.test(HTML));
  ok('refresh 里真的调用了它', /try \{ renderCfgRange\(s\); \}/.test(HTML));
  ok('服务端下发与前端读取是同一个键名 cfgRange', /s\.cfgRange/.test(HTML) && /cfgRange: cfgRangeState\(\),/.test(SVS));
}

console.log('\n' + (FAIL ? '❌ 失败 ' + FAIL + ' / ' + N : '✅ 全部通过 ' + N + ' 条断言'));
process.exit(FAIL ? 1 : 0);
