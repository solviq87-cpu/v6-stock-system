// cq 轮扫描器：两个实例（primary / replica）的认知一致性普查。
// 角度：本机副本改了东西，线上知不知道？反过来呢？
// 输出两张表：
//   ① 所有写操作路由 × 是否转发给线上（syncUpstream）
//   ② 所有 isReplica() 闸门点 —— 哪些模块认自己是副本、哪些不认（不认 = 副本上照样自己跑）
// 只列候选，不自动判定；改之前先读上下文。
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SV_NOC = SV.split(/\r?\n/).map(s => { const i = s.indexOf('//'); return i >= 0 ? s.slice(0, i) : s; }).join('\n');
const LINES = SV_NOC.split('\n');

console.log('=== ① 写操作路由 × 是否跨实例同步 ===');
// 路由定义形如：if (p === '/api/xxx' && req.method === 'POST') {
const routes = [];
for (let i = 0; i < LINES.length; i++) {
  const m = LINES[i].match(/p === '(\/api\/[^']+)'\s*&&\s*req\.method === '(POST|DELETE|PUT)'/);
  if (!m) continue;
  // 找该路由块的结束：下一个同级路由定义或 250 行上限
  let j = i + 1, end = i + 1;
  for (; j < LINES.length && j < i + 250; j++) {
    if (/^\s*if \(p === '\/api\//.test(LINES[j])) { end = j; break; }
    end = j + 1;
  }
  const body = LINES.slice(i, end).join('\n');
  routes.push({ path: m[1], method: m[2], line: i + 1, sync: /syncUpstream\(/.test(body), replicaAware: /isReplica\(\)/.test(body), len: end - i });
}
const writeNoSync = routes.filter(r => !r.sync);
console.log(`写操作路由 ${routes.length} 个，其中【有跨实例同步】${routes.length - writeNoSync.length} 个`);
console.log('\n-- 已有同步（改了会让线上知道）--');
for (const r of routes.filter(r => r.sync)) console.log(`  ${r.path} (${r.method}) L${r.line}`);
console.log('\n-- ★ 没有同步（改了只落在本机，需人工判断该不该同步）--');
for (const r of writeNoSync) console.log(`  ${r.path} (${r.method}) L${r.line}${r.replicaAware ? '  [有 isReplica 判断]' : ''}`);

console.log('\n=== ② isReplica() 闸门分布：哪些模块认自己是副本 ===');
const gates = [];
LINES.forEach((L, i) => {
  if (!/isReplica\(\)/.test(L)) return;
  // 往上找最近的函数定义（最多 60 行）
  let owner = '(顶层/未知)';
  for (let j = i; j >= Math.max(0, i - 60); j--) {
    const m = LINES[j].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (m) { owner = m[1]; break; }
  }
  gates.push({ line: i + 1, owner, text: L.trim().slice(0, 110) });
});
console.log(`isReplica() 出现 ${gates.length} 处：`);
for (const g of gates) console.log(`  L${g.line} [${g.owner}] ${g.text}`);

console.log('\n=== ③ 定时器：副本上还在跑的重活（没有 isReplica 闸门且不在推送路径）===');
// 找 setInterval/setTimeout 里调用的函数名
const timers = [];
LINES.forEach((L, i) => {
  const m = L.match(/set(?:Interval|Timeout)\(\s*(?:guard\('[^']+',\s*)?([A-Za-z_$][\w$]*)/);
  if (!m) return;
  timers.push({ line: i + 1, fn: m[1] });
});
const seen = new Set();
for (const t of timers) {
  if (seen.has(t.fn)) continue;
  seen.add(t.fn);
  // 该函数体内有没有 isReplica 闸门
  let has = false;
  for (let j = 0; j < LINES.length; j++) {
    if (new RegExp('^(?:async\\s+)?function\\s+' + t.fn + '\\s*\\(').test(LINES[j])) {
      for (let k = j; k < Math.min(LINES.length, j + 120); k++) {
        if (/isReplica\(\)/.test(LINES[k])) { has = true; break; }
        if (k > j && /^function\s/.test(LINES[k])) break;
      }
      break;
    }
  }
  console.log(`  ${t.fn}  L${t.line}  ${has ? '有副本闸门' : '★ 无副本闸门（副本上照样跑）'}`);
}
console.log('\n（扫描器只列候选，不自动判定；推送路径由 pushAll 统一拦截，不算漏）');
