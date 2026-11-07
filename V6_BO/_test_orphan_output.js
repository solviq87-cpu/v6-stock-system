// cr 轮守门：系统里那些「算出来就没人再看过」的数。
// 角度：花了很大代价（拉全A行情 + 逐票K线）算出来的结果，到底有没有消费者。
//   白算的不仅浪费数据源请求（还容易把自己打进限流），更因为"没人看"而长期带着错误不被发现。
// 本轮查实的四处：
//   ① `expectBaseOf()` —— 「一批交易日的期望命中率基准」，**全项目零调用**；
//      而真正在用的是 `dayExpectMap()`。同一个概念两套系数（同样"跌 3%"，一个期望 44%、
//      一个期望 26%，差 18 个点），没人用的那套静静躺着 —— 哪天被 grep 到接上，回验打折的判据
//      会在**无任何报错的情况下整体偏移**。已删除，并在 dayExpectMap 处钉死"唯一入口"。
//   ② `wecomKey()` —— 企业微信渠道早已移除后的"旧名兼容"壳，零调用，留着会让 grep 的人以为渠道还在。
//   ③ `behindProxy(req)` —— 靠【客户端可控的请求头】判"是否过反代"，本就形同虚设且已零调用；
//      留着像一条还在生效的鉴权规则。真正的本机判据是 isLocalReq（只看 socket 对端地址）。
//   ④ `S.paperMirror = true`（上一轮我自己写的）—— /api/state 用的是 `mirror: isReplica()`，
//      这个赋值从写到删没有任何读取点。同一个意思两个标记，多一个没人读的只会让人以为另有含义。
// 守门价值：把「零调用 / 零读取」这件本来没人会发现的事变成每次回归都会查的事。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SV_NOC = SV.split(/\r?\n/).map(s => { const i = s.indexOf('//'); return i >= 0 ? s.slice(0, i) : s; }).join('\n');
const LINES = SV_NOC.split('\n');

console.log('\n【一】已查实的四处死代码不许回潮');
ok('expectBaseOf 已删除（不再有函数定义）', !/^function expectBaseOf\(/m.test(SV_NOC));
ok('expectBaseOf 没有留下任何调用点', (SV_NOC.match(/expectBaseOf\s*\(/g) || []).length === 0);
ok('wecomKey 已删除（不再有函数定义）', !/^function wecomKey\(/m.test(SV_NOC));
ok('behindProxy 已删除（不再有函数定义）', !/^function behindProxy\(/m.test(SV_NOC));
ok('★ S.paperMirror 死赋值已删除', !/S\.paperMirror\s*=/.test(SV_NOC));
ok('副本身份仍由 isReplica() 一处表达', /mirror:\s*isReplica\(\)/.test(SV_NOC));
ok('paperCheckAll 仍有副本闸门', /if \(isReplica\(\)\) return;/.test(SV_NOC));

console.log('\n【二】期望命中率只能有一个入口（两套系数是隐性灾难）');
ok('dayExpectMap 仍在使用（真正在用的那个）', (SV_NOC.match(/dayExpectMap\s*\(/g) || []).length >= 2);
ok('★ 全项目不存在第二套"期望基准"实现', !/0\.5\s*\+\s*avg\s*\*\s*0\.02/.test(SV_NOC));
ok('注释里钉死了"唯一入口"这回事', /期望命中率的唯一入口是 dayExpectMap/.test(SV));

console.log('\n【三】全项目零调用函数普查（这是本轮的核心判据）');
const defs = [];
LINES.forEach((L, i) => {
  const m = L.match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
  if (m) defs.push({ name: m[1], line: i + 1 });
});
ok('[自检] 扫到的顶层函数数量合理', defs.length > 150, '实际 ' + defs.length);

// ⛔ 正则不许排除 `.`：调用点大量是 `...auctionScoreOf(x, ` / `A.effProb(`，
//    排除点会把它们全判成"未调用"（本轮第一版就假报了 3 个）。
const countCalls = (name, excludeDot) => {
  const re = new RegExp('(^|[^\\w$' + (excludeDot ? '.' : '') + '])' + name + '\\s*\\(', 'g');
  let n = 0;
  LINES.forEach(L => { n += (L.match(re) || []).length; });
  return n;
};
// 自检：auctionScoreOf 确实是被调用的，两种正则必须给出不同结论（证明这个坑真实存在）
const aGood = countCalls('auctionScoreOf', false);
const aBad = countCalls('auctionScoreOf', true);
ok('[自检] 正确正则能数到 auctionScoreOf 的调用点', aGood >= 2, '实际 ' + aGood);
ok('[自检] 排除"."的正则会把它误判成零调用（本轮踩过的坑）', aBad < aGood, `正确 ${aGood} vs 错误 ${aBad}`);

// 通过 setTimeout/setInterval/guard 传【函数引用】（不带括号）的不算死代码
const refPassed = new Set();
LINES.forEach(L => {
  const m = L.match(/set(?:Timeout|Interval)\(\s*(?:guard\('[^']+',\s*)?([A-Za-z_$][\w$]*)/);
  if (m) refPassed.add(m[1]);
  const g = L.match(/guard\('[^']+',\s*([A-Za-z_$][\w$]*)\)/);
  if (g) refPassed.add(g[1]);
});
// 白名单：生产零调用但**刻意保留**的（每个都必须在源码里写明原因，不许默默留着）
const KEEP = new Set(['effProb']);   // 只被 _test_empcalib.js 用来守"回落用原概率"的语义
for (const k of KEEP) {
  const i = SV.indexOf('function ' + k + '(');
  ok(`[白名单自检] ${k} 在源码里写明了为什么零调用`,
    i > 0 && /零调用/.test(SV.slice(Math.max(0, i - 700), i)), '未找到说明注释');
}
// ⛔ 2026-10-09 fy 轮补：函数也可能**作为值被传递**（不是 `name(` 调用，而是 `name,` / `name}` /
//    `{ why: name }` 这种引用），fy 轮四个池的原因解析器就是以 `[名字, 池, whyTrend, extra, 6]`
//    数组元素的形式挂进 _poolDefs 再由 poolReasonSection 用 opt.why 调度的。
//    只数 `name(` 会把这种真实在用的一律误判成死代码（实测误报 whyTrend/whyBigMoney/whyBuzhang）。
//    ⛔ 守门本意是「没人读的东西不许留」，不是「不许用函数引用」——所以引用传递也算读点。
const countRefs = (name) => {
  const re = new RegExp('(^|[^\\w$.])' + name + '\\s*(?=[,}\\)\\]])', 'g');
  let n = 0;
  LINES.forEach((L, i) => { if (i !== undefined) n += (L.match(re) || []).length; });
  return n;
};
const dead = [];
const deadDetail = [];
for (const d of defs) {
  if (refPassed.has(d.name) || KEEP.has(d.name)) continue;
  const n = countCalls(d.name, false);
  const self = (LINES[d.line - 1].match(new RegExp('(^|[^\\w$])' + d.name + '\\s*\\(', 'g')) || []).length;
  const refs = countRefs(d.name) - (LINES[d.line - 1].match(new RegExp('(^|[^\\w$.])' + d.name + '\\s*(?=[,}\\)\\]])', 'g')) || []).length;
  if (n - self === 0 && refs <= 0) { dead.push(d); deadDetail.push(d.name + '@L' + d.line); }
}
ok('★ 零调用的顶层函数必须为 0（函数引用传递 / 挂定时器 的已排除）',
  dead.length === 0, deadDetail.join(', '));

console.log('\n【四】结果容器：算出来的东西要有读取点（不许只写不读）');
// 挑几个"结果型"容器（非内部缓存），确认它们有非赋值的读取点
const RESULT_KEYS = ['ztPool', 'trendPool', 'smallyang', 'breadth', 'extLink', 'ztReasonHit', 'review'];
for (const k of RESULT_KEYS) {
  const reads = LINES.filter(L => new RegExp('S\\.' + k + '\\b').test(L) && !new RegExp('S\\.' + k + '\\s*=').test(L));
  ok(`S.${k} 有真正的读取点（不是只写不读）`, reads.length > 0, '读取 ' + reads.length + ' 处');
}

console.log('\n' + '─'.repeat(60));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
