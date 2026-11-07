// 守门测试：线上/本机持仓与审计流水里**不许残留测试数据**（2026-10-06）
// 起因：守门测试打的是本机 8787 的真实服务，建仓/删仓会写进真实 holdings.json，
//   还能经 syncUpstream 转发到线上 —— 线上 500 条审计流水曾被
//   999999 / 900001-900003 / 600519 / 000001 / 300750 这些测试码占满，
//   用户打开面板「持仓 → 变更记录」满屏测试票，真实记录反而被挤没了。
// 这组断言锁死三件事：
//   ① 持仓里不许有测试码
//   ② 审计流水里不许有测试码
//   ③ 写接口必须支持 _noSync（否则测试必然污染线上）
const fs = require('fs');
const http = require('http');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

// 只认"明显是假票"的号段：900xxx / 999xxx 不是任何真实证券代码。
// ⛔ 不能把 600519/000001/300750 这类真票算进来 —— 用户真的可能持有它们。
const isTestCode = c => /^(9\d{5})$/.test(String(c || '').trim());

function api(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port, path: p, method,
      headers: d ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } : {} },
      res => { let s = ''; res.on('data', x => s += x); res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve({ __raw: s }); } }); });
    r.on('error', reject);
    if (d) r.write(d);
    r.end();
  });
}

(async () => {
  console.log('\n① 服务端源码：写接口必须支持 _noSync 隔离（否则测试必然污染线上）');
  const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  // ⛔ 正则字面量里的 `/` 必须转义成 `\/`，否则提前闭合正则 → Invalid regular expression flags
  ok('持仓写接口有 _noSync 闸门', /if\s*\(!b\._noSync\)\s*syncUpstream\('\/api\/holdings'/.test(SV),
    '没找到 `if (!b._noSync) syncUpstream(...)`');
  // 注意源码里是 `act === 'purgeOps'`（act 是解析后的局部变量），不是 action
  ok('存在 purgeOps 清理通道（能清测试流水）', /act === 'purgeOps'/.test(SV) && /function purgeOps/.test(fs.readFileSync(path.join(__dirname, 'holdings.js'), 'utf8')));
  ok('purgeOps 默认不转发线上（remote:true 才转）', /if\s*\(b\.remote === true\)\s*syncUpstream/.test(SV));

  console.log('\n② 本机持仓与流水（打真实服务，需 8787 在跑）');
  let h = null;
  try { h = await api(8787, 'GET', '/api/holdings'); } catch (e) { console.log('  ⚠️  本机服务未启动，跳过②：' + e.message); }
  if (h && h.ok) {
    const codes = (h.items || []).map(x => String(x.code));
    const bad = codes.filter(isTestCode);
    ok('本机持仓里没有测试码', bad.length === 0, bad.join(','));
    // 查到残留就顺手清掉（内存+磁盘一起，走接口而不是改文件）：
    //   残留一旦留着，下一轮全量一开始就会被本守门再次抓包 —— 变成"上一轮的锅这一轮背"，
    //   真正的污染源反而被淹没在连锁红灯里。清理后下一轮从干净状态开始，红灯才是真的红灯。
    if (bad.length) {
      try {
        await api(8787, 'POST', '/api/holdings', { action: 'removeMany', codes: bad, _noSync: true });
        await api(8787, 'POST', '/api/holdings', { action: 'purgeOps' });
        console.log(`  🧹 已自净：清掉残留测试票 ${bad.join(',')} 并清空流水（本次仍计失败，请查上游套件）`);
      } catch (e) { console.log('  ⚠️  自净失败：' + e.message); }
    }
  }
  const opsFile = path.join(__dirname, '.holdings_ops.json');
  if (fs.existsSync(opsFile)) {
    let ops = [];
    try { ops = JSON.parse(fs.readFileSync(opsFile, 'utf8')); } catch {}
    const badOps = ops.filter(r => ((r.added || []).concat(r.removed || [])).some(isTestCode));
    ok('本机审计流水里没有测试码', badOps.length === 0, `${badOps.length}/${ops.length} 条含测试码`);
  }

  console.log('\n③ 一键锁仓必须留痕（它是除 add 外唯一能新增条目的路径）');
  const HJ = fs.readFileSync(path.join(__dirname, 'holdings.js'), 'utf8');
  // lock 的两条分支（已持仓更新 / 新建）都必须走 commit，不能是裸 saveHold
  const lockBody = HJ.slice(HJ.indexOf('async function lockItem'), HJ.indexOf('function setLocked'));
  ok('lock 分支里没有裸 saveHold（以前绕过审计）', !/saveHold\(\);\s*bust\(\);/.test(lockBody),
    'lockItem 里仍有 saveHold(); bust();');
  ok('lock 两条分支都走了 commit', (lockBody.match(/commit\(/g) || []).length >= 2,
    String((lockBody.match(/commit\(/g) || []).length));

  console.log('\n④ 线上→本地回拉对账必须存在（治「删不干净」）');
  ok('存在 pullHoldingsDownstream', /function pullHoldingsDownstream/.test(SV));
  ok('已挂定时器', /setInterval\(guard\('hold-pull', pullHoldingsDownstream\)/.test(SV));
  // ⛔ 只挂定时器不挂启动链这条已犯三次 —— 启动后必须先跑一次
  ok('启动链里也跑了一次（不能只等定时器）', /setTimeout\(pullHoldingsDownstream/.test(SV));
  ok('回拉只补删不覆盖（保留本机新增）', /tRem && tRem >= tAdd/.test(SV));
  ok('拉不到线上时绝不动本机数据', /pullHoldingsDownstream/.test(SV) && /throw new Error/.test(SV));

  console.log(`\n测试持仓守门：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常', e && e.message); process.exit(1); });
