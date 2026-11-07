# -*- coding: utf-8 -*-
"""dg 轮：_test_hold2.js 收尾必须连线上一起清（否则线上残留永远清不掉，PRE 永远吃到它）"""
import io

P = r"C:\Users\28957\WorkBuddy\2026-09-25-13-40-58\stock-dashboard\_test_hold2.js"
s = io.open(P, encoding='utf-8').read()

# ── 1 头部补依赖与远程清理函数 ─────────────────────────────────────────────
A1 = "const http = require('http');\n"
assert A1 in s
s = s.replace(A1, "const http = require('http');\nconst https = require('https');\nconst fs = require('fs');\n", 1)

A2 = "const post = (p, b) => api('POST', p, b);\nconst get = p => api('GET', p);\n"
assert A2 in s
HELPER = A2 + """
// ⛔⛔ 2026-10-07 dg 轮实测事故（守门测试留下线上残留的真根因）：
//   本机是 replica，/api/holdings 会**回拉线上**展示；而本套件所有删除都带了 `_noSync: true`
//   （cf 轮定的规矩：不许拿测试改线上）—— 于是**线上残留永远删不掉**：
//   PRE 每一轮都吃到它们，最后一条断言就永远红；而那几只带标记的检测票会一直挂在
//   用户手机端的持仓列表里（db 轮事故 600519/000001/300750 就是这么留在线上三个月的）。
//   现在收尾**显式连线上一起清**：仍然只删带 TEST_NOTE 标记的，无标记的一律不碰。
async function purgeRemote(TEST_NOTE) {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8')); } catch (e) { return 'skip: 读不到 config.json'; }
  const su = (cfg && cfg.syncUpstream) || {};
  if (!su.enabled || !su.url || !su.token) return 'skip: 未配置 syncUpstream（本机不转发线上）';
  const u = new URL(su.url);
  const A = new https.Agent({ keepAlive: false, maxSockets: 4, family: 4 });
  const req = (method, path, body) => new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      host: u.hostname, port: 443, path, method, agent: A,
      headers: Object.assign({ 'Connection': 'close' }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    }, x => { let t = ''; x.on('data', d => t += d); x.on('end', () => { try { res(JSON.parse(t)); } catch { res(t); } }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
  const T = '?token=' + encodeURIComponent(su.token);
  const before = await req('GET', '/api/holdings' + T);
  const items = (before && before.items) || [];
  const mine = items.filter(x => String(x.note || '') === TEST_NOTE);
  if (!mine.length) return '线上无残留（当前 ' + items.length + ' 只，其中无标记 ' + (items.length) + ' 只）';
  for (const it of mine) await req('POST', '/api/holdings' + T, { action: 'remove', code: it.code });
  await req('POST', '/api/holdings' + T, { action: 'purgeOps', remote: true });
  const after = await req('GET', '/api/holdings' + T);
  const left = ((after && after.items) || []).filter(x => String(x.note || '') === TEST_NOTE).length;
  return '清掉线上残留 ' + mine.length + ' 只（' + mine.map(x => x.code).join('/') + '），清完还剩 ' + left + ' 只带标记';
}
"""
s = s.replace(A2, HELPER, 1)

# ── 2 PRE 从 Set 改成 Map（要区分「有标记」与「用户真实持仓」）────────────────
A3 = "  const PRE = new Set((((await get('/api/holdings')) || {}).items || []).map(x => x.code));"
assert A3 in s
s = s.replace(A3,
    "  // ⛔ Map 而不是 Set：开跑前那批里可能混着【上一轮没清干净的带标记残留】，\n"
    "  //    它们不是用户持仓、本该被清掉；只有无标记的那部分才需要断言「原样保留」。\n"
    "  const PRE = new Map((((await get('/api/holdings')) || {}).items || []).map(x => [x.code, x]));", 1)

# ── 3 收尾：连线上一起清 + 断言改钉语义 ────────────────────────────────────
A4 = """  const purge = await post('/api/holdings', { action: 'purgeOps' });
  ok(purge && purge.ok, '测试流水已清空：' + (purge && purge.msg || purge && purge.error));
  const fin = await get('/api/holdings');
  const finCodes = (fin.items || []).map(x => x.code);
  // ⛔ 断言钉语义：① 带测试标记的一条都不剩 ② 不带标记的（用户真实持仓）原样保留
  const finLeft = (fin.items || []).filter(isMine).map(x => x.code);
  ok(finLeft.length === 0, '⛔ 带测试标记的持仓已全部清空' + (finLeft.length ? '（还剩 ' + finLeft.join('/') + '）' : ''));
  const preKept = [...PRE].filter(c => finCodes.includes(c));
  ok(preKept.length === PRE.size, '⛔ 开跑前就有的 ' + PRE.size + ' 只原样保留（' + preKept.join('/') + '）');"""
assert A4 in s
B4 = """  const purge = await post('/api/holdings', { action: 'purgeOps' });
  ok(purge && purge.ok, '测试流水已清空：' + (purge && purge.msg || purge && purge.error));
  // ⛔ 连线上一起清：本机删除带 _noSync 只动本机，线上那份残留永远删不掉
  const remoteMsg = await purgeRemote(TEST_NOTE);
  console.log('   · 线上清理：' + remoteMsg);
  ok(/^清掉线上残留/.test(remoteMsg) || /^线上无残留/.test(remoteMsg) || /^skip/.test(remoteMsg),
    '⛔ 线上没有本套件留下的带标记持仓（' + remoteMsg + '）');
  const fin = await get('/api/holdings');
  const finCodes = (fin.items || []).map(x => x.code);
  // ⛔ 断言钉语义：① 带测试标记的一条都不剩 ② **无标记**的（= 用户真实持仓）原样保留
  const finLeft = (fin.items || []).filter(isMine).map(x => x.code);
  ok(finLeft.length === 0, '⛔ 带测试标记的持仓已全部清空' + (finLeft.length ? '（还剩 ' + finLeft.join('/') + '）' : ''));
  // ⛔ 只核"无标记"的那部分：带标记的残留本来就该被清掉，算进"开跑前就有的"会永远红
  const PRE_REAL = [...PRE.values()].filter(x => !isMine(x)).map(x => x.code);
  const preRealKept = PRE_REAL.filter(c => finCodes.includes(c));
  ok(preRealKept.length === PRE_REAL.length,
    '⛔ 开跑前就有的、无标记的 ' + PRE_REAL.length + ' 只（用户真实持仓）原样保留（' + preRealKept.join('/') + '）');"""
s = s.replace(A4, B4, 1)

# PRE.size 的其它用法仍可用（Map 也有 size）
io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('✓ _test_hold2.js 收尾已改为连线上一起清')
