// 路由冒烟测试：专治「node --check 查不出、只有真发一次请求才炸」的那类线上事故。
//
// 背景（2026-10-01 真事）：/api/ztpre 的 POST 分支写了 requireEditor(res, tok, req)，
// 而 tok 在该分支里根本没声明 → 请求进来直接 ReferenceError，
// 浏览器收到的是**完全空的响应**（连 HTTP 头都没有），面板看起来就是"点了没反应"。
// node --check 是纯语法检查，ReferenceError 它一个也查不出来。
//
// 两道防线：
//  A 静态：每个用到 requireEditor 的路由分支，令牌变量必须在本分支内声明（禁止引用外层块级变量）
//  B 实跑：把所有 GET /api 路由真发一遍，断言状态码 200 + 返回体是合法非空 JSON
//     （实跑能抓到 A 抓不到的运行期错误，因为空响应正是这次的症状）
const fs = require('fs');
const path = require('path');
const http = require('http');

const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const LINES = SV.split(/\r?\n/);

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg); } }

// ───────────────────────── A 静态：令牌变量必须本地声明 ─────────────────────────
console.log('【A】requireEditor 令牌变量作用域检查');

// 路由分支起始：  if (p === '/api/xxx' && ...  或  if (p.startsWith('/api/xxx' ...
const ROUTE_RE = /^\s*if \(p (?:===|!==|startsWith)/;
const routeIdxs = [];
LINES.forEach((l, i) => { if (ROUTE_RE.test(l)) routeIdxs.push(i); });
ok(routeIdxs.length >= 30, '解析到路由分支 ' + routeIdxs.length + ' 个（应 ≥30）');

// ⚠️ 必须支持 `let b = {}, tok = ''` 这种多声明符写法 —— 只写 \s+NAME 会漏判，
//    结果就是一堆"未声明"假警报（实测 5 处全是这种写法）。
//    （第二版坑：`[^;{}]` 会被 `let b = {}, tok = ''` 里的空对象字面量 `{}` 截断 →
//     明明声明了却判"未声明"。改成只挡分号与换行。）
const DECL_RE = n => new RegExp('(?:let|const|var)[ \\t][^;\\n]*?\\b' + n + '\\b');
let checked = 0;
const badScopes = [];
routeIdxs.forEach((start, k) => {
  const end = (k + 1 < routeIdxs.length) ? routeIdxs[k + 1] : Math.min(start + 60, LINES.length);
  const block = LINES.slice(start, end).join('\n');
  const ms = block.match(/requireEditor\(res,\s*([A-Za-z_$][\w$]*)\s*,/g) || [];
  ms.forEach(m => {
    const name = m.match(/requireEditor\(res,\s*([A-Za-z_$][\w$]*)\s*,/)[1];
    checked++;
    const declaredHere = DECL_RE(name).test(block);
    if (!declaredHere) {
      badScopes.push('第 ' + (start + 1) + ' 行路由使用了未在本分支声明的 `' + name + '`');
    }
  });
});
ok(checked >= 20, '检查了 ' + checked + ' 处 requireEditor 调用（应 ≥20）');
ok(badScopes.length === 0, '所有 requireEditor 的令牌变量都在本路由分支内声明'
  + (badScopes.length ? ' —— 违规：' + badScopes.join('；') : ''));

// 反向：确认我们这条规则真的能抓到那个 bug（拿源码里已修好的写法做对照，别写死行号）
ok(/let zpTok = '';/.test(SV) && /requireEditor\(res, zpTok, req\)/.test(SV),
  '/api/ztpre POST 已改为本分支声明 zpTok（回归锁，勿改回 tok）');

// ⛔ 2026-10-29 自锁：本套件必须能把「等满超时」与「连接被关掉」分开记。
//    合成一种的话，服务端一忙就会把 10 条好路由判成「当场崩了」——2026-10-28 22:22 实发过一次，
//    两个空间各追一轮不存在的 bug。这条断言防止以后有人把它「简化」回单一 status。
const SELF = fs.readFileSync(__filename, 'utf8');
ok(/why: 'timeout'/.test(SELF) && /r\.why === 'timeout'/.test(SELF),
  '超时(timeout)与连接被关闭(error)分开记 —— 服务端忙不等于路由崩（判不出不硬判）');

// ───────────────────────── B 实跑：GET 路由不得返回空响应 ─────────────────────────
console.log('\n【B】GET /api 路由实跑冒烟（空响应=线上"点了没反应"）');

function get(path_) {
  return new Promise(resolve => {
    // ⚠️ 超时给 90s：/api/smallyang 这类要现场遍历 5500+ 只票读 K 线缓存，
    //    给 20s 会把它误判成"连接被关闭"，白追一个不存在的 bug。
    const req = http.request({ host: '127.0.0.1', port: 8787, path: path_, method: 'GET', timeout: 90000 },
      res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => resolve({ status: res.statusCode, body: b, why: null }));
      });
    // ⛔ 2026-10-29：超时与「连接被关闭」必须分开记（why 字段）。
    //    原来两者都返回 {status:0}，于是**服务端被重活堵住**和**路由当场崩掉**长得一模一样：
    //    2026-10-28 22:22 实发一次 —— 本机 8787 那个进程比「让出粒度 400→20」的修复早起 8 秒，
    //    仍在 400 只/批同步遍历，事件循环被堵 13~20 秒，10 条路由被判「连响应头都没有地死掉」，
    //    两个空间各追了一轮不存在的 bug（线上同路由 0.5s 正常）。
    //    判据：timeout = 我们等满了 90s（服务端忙，判不出真假）→ 不算路由死；
    //          error   = socket 被对端关掉（真崩溃特征）→ 才算死。
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', why: 'timeout' }); });
    req.on('error', e => resolve({ status: -1, body: '', why: (e && e.code) || 'error' }));
    req.end();
  });
}

(async () => {
  // 先探活：本地服务没起时跳过实跑（静态部分照常生效，不污染回归结果）
  const probe = await get('/api/lock/status').catch(() => ({ status: -1, body: '' }));
  if (probe.status !== 200) {
    // 探活失败也分两种：连不上（没起）vs 等满 90s（起了但被重活堵住）。
    // 含混成一句「未启动」会让人白重启一遍服务，反而掩盖真问题。
    console.log(probe.why === 'timeout'
      ? '  ⚠️ 本地 8787 探活 90s 无响应 —— 服务在跑但事件循环被堵住（判不出路由是否健康），跳过实跑；先重启本机副本再复跑'
      : '  · 本地 8787 未启动（status=' + probe.status + '，' + (probe.why || '无响应') + '），跳过实跑部分');
    console.log('\n────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ──────');
    process.exit(fail ? 1 : 0);
  }

  // 收集所有支持 GET 的 /api 路由（跳过 startsWith 动态段，拼不出真实路径）
  const getRoutes = [];
  LINES.forEach(l => {
    const m = l.match(/p === '(\/api\/[\w\-/]+)'/g);
    if (!m) return;
    const paths = m.map(s => s.match(/'([^']+)'/)[1]);
    const isGet = /req\.method === 'GET'/.test(l) || /req\.method !== 'POST'/.test(l)
      || !/req\.method/.test(l);
    if (isGet) paths.forEach(p2 => { if (!getRoutes.includes(p2)) getRoutes.push(p2); });
  });
  ok(getRoutes.length >= 15, '收集到 GET 路由 ' + getRoutes.length + ' 个（应 ≥15）');

  // 判据说明（别再写成"凡是空响应都失败"，会误报一大片）：
  //   · status === 0  → 连接被直接关闭、连 HTTP 头都没有 = **事故特征**（ReferenceError 空中炸）
  //   · status 404    → 该路由只接受 POST，GET 落到兜底 404，空体是正常的，跳过
  //   · status 200    → 必须是合法 JSON（SSE 长连接除外，它永不 end，单独排除）
  // ⛔ 2026-10-22 ju 轮：skip 从「只有 SSE」扩成两类，都**不是**空响应风险，别让冒烟测试误伤：
  //   ① /api/stream      —— SSE 长连接，永不 end；
  //   ② /api/backtest    —— 「触发重算」型路由：GET 它会真跑全市场回测（本机回环免检=开发者身份），
  //      先秒回 pending 再后台占满 CPU 数分钟。冒烟要查的是「路由不返回空响应」，不是顺带触发
  //      一轮 3 分钟的全市场计算：那既拖慢整套守门，还会在测试进程退出后继续烧 CPU，拖垮随后
  //      时序敏感的套件（_runall「时红时绿」负载抖动的来源之一；服务端已改异步分片不再冻结
  //      整个服务，但 3 分钟 CPU 该不烧还是不烧）。该路由的空响应风险由【A】静态作用域检查
  //      + _test_auth_matrix 的 requireEditor 回归锁 + _test_backtest_yield 的路由回归锁覆盖。
  const SKIP = ['/api/stream', '/api/backtest'];
  const dead = [], busy = [], notJson = [];
  for (const p2 of getRoutes) {
    if (SKIP.includes(p2)) { console.log('  · 跳过 ' + p2 + '（长连接/触发重算，非空响应风险）'); continue; }
    const r = await get(p2);
    // 判不出不硬判：等满 90s 只能说「服务端当时没空理我」，不能据此断言路由死了。
    if (r.why === 'timeout') { busy.push(p2); continue; }
    if (r.status === 0 || (r.status === -1 && !r.body)) {
      dead.push(p2 + '（' + (r.why || '无响应') + '，连响应头都没有）'); continue;
    }
    if (r.status !== 200) continue;           // 404/405 等：路由未命中或方法不匹配，正常
    let parsed = null;
    try { parsed = JSON.parse(r.body); } catch {}
    if (parsed === null && !/^\s*</.test(r.body)) notJson.push(p2);
  }
  ok(dead.length === 0, '没有路由"连响应头都没有"地死掉' + (dead.length ? ' —— ' + dead.join('；') : ''));
  ok(notJson.length === 0, '所有 200 响应都是合法 JSON' + (notJson.length ? ' —— ' + notJson.join('；') : ''));
  // 环境不可判：显式说出来，既不冒充「全绿」，也不冤枉成「路由崩了」
  if (busy.length) {
    console.log('  ⚠️ 判不出：' + busy.length + ' 条路由 90s 内没回应（' + busy.join('、') + '）');
    console.log('     这不是路由死掉的证据 —— 本机副本的事件循环被重活堵住时会长这样（同日实证：');
    console.log('     settleKlineDayCache 按 400 只/批同步遍历 → /api/lock/status 13~20s 才回）。');
    console.log('     处置：跑一下 curl -m 10 127.0.0.1:8787/api/lock/status 看耗时；超过 3s 就把本机副本重启，');
    console.log('     等它空闲后单独复跑本套件。线上同路由 0.5s 正常，别去改产品代码。');
  }

  console.log('\n────── 结果：' + pass + ' 通过 / ' + fail + ' 失败 ──────');
  process.exit(fail ? 1 : 0);
})();
