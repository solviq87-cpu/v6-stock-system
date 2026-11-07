// 守门：副本实例的模拟盘「账目对不上」不许画成红色警报（gd 轮 / 2026-10-10）
// ── 事故 ────────────────────────────────────────────────────────────
// 用户「页面还在报错」。查实两端接口都 200、版本一致，真正的红字在**本机副本（localhost）**面板：
// 模拟盘账户摘要挂着一个红色「⚠️ 账目对不上」，文案还写着「可用『重置』清空重来」。
// 真相：pullPaperDownstream 回拉时账户状态（cash/realized/positions）整段沿用线上，
// 而成交流水按时间归并、刻意保留本机历史（cz 轮：那是更全的证据链）—— 两套来源天生对不上。
// pool 现金差 -937697.26 / pre -284120.7，线上同一时刻却是「账户与流水一致」。
// 这不是账记错了，是这台实例根本不该有自己的账：模拟盘只能有一个权威账 —— 线上。
// 后果比看着吓人更严重：红字配「可用重置清空重来」把人推向不可逆的清空流水。
// ⛔ 同类（ ejusdem generis ）：dt 轮已把「老口径遗留」从红字降为中性提示，理由完全一致 ——
//    红色只能留给真正需要人动手的错误。
// 顺带发现：副本提示原本写在调用处（ppPoolInfo/ppPreInfo），renderPaper 第一行就把同一行覆盖掉，
//    那句「本机为副本实例」一次都没显示过 —— 写了等于没写。
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

// ⛔ 括号配平取函数体 —— 不许用固定字符窗口
function bodyAt(s, sig) {
  const i = s.indexOf(sig);
  if (i < 0) return '';
  const j = s.indexOf('{', i);
  if (j < 0) return '';
  let depth = 0;
  for (let k = j; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}') { depth--; if (depth === 0) return s.slice(j, k + 1); }
  }
  return '';
}

console.log('\n① 服务端：副本的对账结果必须打 replica 标记（红之前的最后一道分流）');
{
  // audit 那段是立即执行函数：audit: (() => { ... })(),
  const i = src.indexOf('audit: (() => {');
  const blk = i >= 0 ? src.slice(i, src.indexOf('})(),', i) + 5) : '';
  ok('audit 立即执行块可定位', blk.length > 100, String(blk.length));
  ok('调用的是同一份 paperAudit（不许另抄一套口径）', /const a = paperAudit\(key\);/.test(blk));
  ok('副本实例才打 replica 标记', /a\.ok === false[\s\S]{0,120}isReplica\(\)[\s\S]{0,120}a\.replica = true/.test(blk));
  ok('已经另有解释的（explained / incomplete）不许被盖成 replica',
    /!a\.explained && !a\.incomplete/.test(blk));
  ok('⛔ 标记必须写在对账结果上再返回（不许先返回后打标，等于没打）', /return a;/.test(blk));

  // 真跑这段：注入 paperAudit / isReplica，验证四种组合
  const IIFE = '(' + blk.replace(/^audit:\s*/, '').replace(/,?$/, '') + ')';
  let fn = null;
  try {
    fn = new Function('paperAudit', 'isReplica', 'key', 'return ' + IIFE);
  } catch (e) { ok('IIFE 可构造（漏符号=套件崩）', false, e.message); }
  if (fn) {
    ok('IIFE 可构造（漏符号=套件崩，不等于红）', true);
    const badAudit = { ok: false, why: '现金差 -937697.26 元' };
    const r1 = fn(() => JSON.parse(JSON.stringify(badAudit)), () => true, 'pool');
    ok('副本 + 真对不上 → 打 replica 标记（面板走中性蓝标）', r1.replica === true && r1.ok === false);
    const r2 = fn(() => JSON.parse(JSON.stringify(badAudit)), () => false, 'pool');
    ok('主实例 + 真对不上 → 不打标记（红字该红还得红）', r2.replica === undefined && r2.ok === false);
    const r3 = fn(() => ({ ok: true, why: '账户与流水一致' }), () => true, 'pool');
    ok('副本 + 对得上 → 不打标记（绿灯照旧）', r3.replica === undefined && r3.ok === true);
    const r4 = fn(() => ({ ok: false, explained: true, why: '老口径遗留' }), () => true, 'pre');
    ok('副本 + 已解释的老口径遗留 → 不打 replica（走它自己的中性提示）', r4.replica === undefined);
    // 反证：旧写法不分身份直接返回 → 副本拿不到标记，面板只会一路红
    const oldFn = new Function('paperAudit', 'return paperAudit("pool");');
    const rOld = oldFn(() => JSON.parse(JSON.stringify(badAudit)));
    ok('反证：旧写法（直接返回）副本拿不到 replica 标记 → 面板必然画红字', rOld.replica === undefined);
  }
}

console.log('\n② 前端：红字之前必须有副本分支，且红字不许再建议「重置」');
{
  // ⛔ 只能判**函数体**，不许对整份 html 做 indexOf —— 版本注释里逐字引用了界面原文
  //    （"…红色「⚠️ 账目对不上」…"），全文定位会先命中注释，判据一夜之间全绿转红，
  //    而代码其实一行没动。剥注释/取函数体二选一，这里取函数体（gb 轮同样教训）。
  const body = bodyAt(html, 'function renderPaper(suf, p, mirror) {');
  ok('renderPaper 函数体可定位', body.length > 1500, String(body.length));
  const i = body.indexOf('⚠️ 账目对不上');
  ok('红色徽标可定位（在函数体内）', i > 0);
  const before = body.slice(Math.max(0, i - 1400), i);
  ok('红字之前先判 p.audit.replica（副本不走红字）', /p\.audit\.replica/.test(before));
  ok('副本走中性蓝标而非红黄', /副本视图：本机不跑自动交易/.test(before));
  ok('副本徽标明说「权威账在线上」（别让人以为本机账能单独修）', /权威账在线上/.test(before));
  // ⛔ 只量副本徽标自己那一格：截到它的 </span> 为止。
  //    再往外多量一个字符就会把相邻的「老口径遗留…无需重置」算进来 → 假红。
  const _rs = body.indexOf('副本视图：本机不跑自动交易');
  const _re = _rs >= 0 ? body.indexOf('</span>', _rs) : -1;
  const badge = (_rs >= 0 && _re > _rs) ? body.slice(_rs, _re) : '';
  ok('副本徽标自身可定位', badge.length > 30, String(badge.length));
  ok('⛔ 副本徽标不许出现「重置」二字（红字才配建议不可逆动作）', !/重置/.test(badge), badge.slice(-40));
  ok('副本徽标明说本机保留的是历史流水留档（不是"账坏了"）', /历史流水为只读留档/.test(badge));
}

console.log('\n③ 副本提示不许被搜掉：渲染方自己拼，不许写在会被覆盖的位置');
{
  ok('renderPaper 支持 mirror 形参', /function renderPaper\(suf, p, mirror\)/.test(html));
  const callOK = /renderPaper\('Pool', s\.paper\.pool, !!s\.paper\.mirror\)/.test(html)
    && /renderPaper\('Pre', s\.paper\.pre, !!s\.paper\.mirror\)/.test(html);
  ok('调用处把 mirror 传进去（不然提示又写不出来）', callOK);
  const b = html.indexOf('function renderPaper(suf, p, mirror)');
  const body = html.slice(b, b + 900);
  ok('⛔ 提示拼在同一行 textContent 里（以前写在调用处，被这里第一行覆盖）',
    /info\.textContent = \(mirror \?/.test(body));
  ok('⛔ 调用处不再单独写 ppPoolInfo/ppPreInfo（写了会被覆盖，等于没写）',
    !/ppPoolInfo', 'ppPreInfo'\]|\['ppPoolInfo'/.test(html.slice(html.indexOf('} else if (s.paper) {'), html.indexOf('renderPaper(\'Pool\''))));
}

console.log(`\n副本账目守门：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
