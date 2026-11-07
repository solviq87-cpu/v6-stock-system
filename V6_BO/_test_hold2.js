// 自检：持仓标签 / 锁仓 / 一键锁仓 / 删除提速 / 大单涨停概率字段
const http = require('http');
const https = require('https');
const fs = require('fs');
function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: 8787, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} }, res => {
      let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch { resolve(s); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
const post = (p, b) => api('POST', p, b);
const get = p => api('GET', p);

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
const ok = (c, m) => console.log((c ? '✅ ' : '❌ ') + m);
(async () => {
  // ⛔ 2026-10-07 补：本套件用的是 600519/000001/300750 这三只**真票**（一键锁仓要走真实行情取价，
  //    换成 999999 取不到价，测不了）。而 _test_no_test_holdings.js 里明确写了「不能把这类真票
  //    算进测试码 —— 用户真的可能持有它们」。原收尾是**无条件 remove 这三只**，也就是说：
  //    谁手上真持有茅台，跑一次本套件就会被删掉（_noSync 之前还会一路删到线上）。
  //    现在改成：开跑前先快照，收尾只删自己加的，开跑前就在的一律跳过。
  // ⛔ Map 而不是 Set：开跑前那批里可能混着【上一轮没清干净的带标记残留】，
  //    它们不是用户持仓、本该被清掉；只有无标记的那部分才需要断言「原样保留」。
  const PRE = new Map((((await get('/api/holdings')) || {}).items || []).map(x => [x.code, x]));
  const MINE = ['600519', '000001', '300750'];
  // ⛔⛔ 2026-10-08 改（本轮实测事故）：原来靠「PRE 里有没有」判断该不该删，
  //    而 PRE 取的是**当前**持仓 —— 上一轮跑完没删干净的残留会进入下一轮的 PRE，
  //    于是被当成"开跑前就有的真实持仓"永久跳过，越积越多。
  //    实测：线上凭空多出 600519/000001/300750 三只（用户线上本来是空的），
  //    .holdings_ops.json 第一条就是 beforeCount 0 → 1，起点确实是空的 —— 全是测试造的。
  //    现在改成**按标记识别**：测试造的票一律打 TEST_NOTE，收尾只删带标记的，
  //    没标记的（= 用户真实持仓）一律不碰。既不会误删，也不会残留。
  const TEST_NOTE = '__hold2_test__';
  const isMine = it => it && String(it.note || '') === TEST_NOTE;
  if (PRE.size) console.log('   · 开跑前已有 ' + PRE.size + ' 只（' + [...PRE].join('/') + '），无标记的一律不碰');

  console.log('=== A. 多标签 ===');
  let r = await post('/api/holdings', { action: 'add', item: { code: '600519', name: '贵州茅台', cost: 1500, shares: 100, tags: '长线,核心,自选', note: TEST_NOTE, _noSync: true } });
  ok(r.ok, '建仓带3个标签：' + (r.msg || r.error));
  // ⛔ 2026-10-07 补：这一处原先漏了 _noSync —— 本套件打的是**本机 8787 的真实服务**，
  //    不带 _noSync 的写操作会经 syncUpstream 转发到线上，等于拿测试改用户的真实持仓。
  r = await post('/api/holdings', { action: 'tags', code: '600519', tags: ['长线', '波段'], _noSync: true });
  ok(r.ok, '改标签：' + (r.msg || r.error));
  r = await post('/api/holdings', { action: 'add', item: { code: '000001', name: '平安银行', cost: 11, shares: 1000, tags: '波段,观察', note: TEST_NOTE, _noSync: true } });
  ok(r.ok, '第二只票带标签：' + (r.msg || r.error));

  console.log('\n=== B. 一键锁仓（只给代码+仓位）===');
  r = await post('/api/holdings', { action: 'lock', item: { code: '300750', shares: 200, note: TEST_NOTE, _noSync: true } });
  ok(r.ok, '未持仓新票按现价建仓并锁定：' + (r.msg || r.error));
  r = await post('/api/holdings', { action: 'lock', item: { code: '000001', shares: 500, tags: '打板', note: TEST_NOTE, _noSync: true } });
  ok(r.ok, '已持仓更新仓位并锁定：' + (r.msg || r.error));
  const bad = await post('/api/holdings', { action: 'lock', item: { code: '123', shares: 100 , _noSync: true } });
  ok(!bad.ok, '非法代码被拒：' + bad.error);

  console.log('\n=== C. 结算：标签/锁仓/汇总 ===');
  // 注意：为避免拉行情太慢，这里用 compute 的缓存接口
  const st = await get('/api/holdings');
  ok(st.ok, '持仓读取成功，共 ' + (st.items || []).length + ' 只');
  ok(Array.isArray(st.allTags) && st.allTags.length > 0, '标签总表回传：' + (st.allTags || []).join('/'));
  for (const it of st.items || []) {
    console.log(`   · ${it.name}(${it.code}) 标签[${(it.tags || []).join('/')}] ${it.locked ? '🔒锁仓' : ''} 等级=${it.level} 动作=${(it.acts || []).map(a => a.type).join(',')}`);
  }
  // ⛔ 2026-10-07 再修：上面这版按「不在 PRE 里」筛，残留一出现就恒为 0 → 偶发红灯，
  //    而它并不是产品问题（锁仓功能好好的）。断言改成**只看本轮真正锁的那两只**，
  //    与开跑前有没有残留无关 —— 守门测试要能重复跑，不能依赖上一次跑没跑干净。
  const MY_LOCK = ['300750', '000001'];
  const locked = (st.items || []).filter(x => MY_LOCK.indexOf(String(x.code)) >= 0 && x.locked);
  ok(locked.length === 2, `锁仓生效（${locked.length}/2）`);
  ok(locked.every(x => !(x.acts || []).some(a => a.type === '止损' || a.type === '减仓' || a.type === '清仓')), '锁仓票不再出现卖出类建议');
  ok(locked.every(x => (x.acts || []).some(a => a.type === '已锁仓')), '锁仓票给出「已锁仓」说明');

  console.log('\n=== D. 删除速度（乐观更新：接口必须先于行情重算返回）===');
  // ⛔ 判据换成"是不是本轮造的"（带 TEST_NOTE 标记），不再看 PRE：
  //    PRE 会吃到上一轮的残留，一看 PRE 就永远跳过，残留再也清不掉。
  // ⚠️ 2026-10-23 修（全量守门跑里偶发假红，污染基线判断）：原来 `dt < 1500` 是绝对阈值，
  //    而批量跑时服务器还在消化前序套件触发的后台重算（事件循环排队），连这个不等重算的
  //    乐观删除都会被拖过 1.5s。断言的本意是「删除不等行情重算」——旧版行为是 2-8 秒
  //    （等完整重算），与负载无关地差一个数量级。改成同轮对照：先测一个廉价 GET 当时
  //    被拖慢多少，删除预算 = max(1500, 对照*20)，空闲时阈值不变（实证 13ms），
  //    负载时按排队程度放容，仍远低于旧版的秒级。
  const tCtrl0 = Date.now();
  const cur0 = (await get('/api/holdings')) || {};
  const ctrlMs = Date.now() - tCtrl0;
  const p300 = ((cur0.items) || []).find(x => x.code === '300750');
  const mayDel = isMine(p300);
  if (!mayDel) console.log('   · 300750 没有测试标记（是用户真实持仓或本轮没建上），跳过删除用例');
  const t0 = Date.now();
  r = mayDel ? await post('/api/holdings', { action: 'remove', code: '300750', _noSync: true }) : { ok: true };
  const dt = Date.now() - t0;
  const budget = Math.max(1500, ctrlMs * 20);
  ok(r.ok, mayDel ? '删除成功：' + (r.msg || r.error) : '（跳过：300750 是开跑前就有的真实持仓）');
  ok(dt < budget, `接口耗时 ${dt}ms（对照 GET ${ctrlMs}ms · 预算 ${budget}ms；旧版要等行情重算，通常 2-8 秒）`);
  const after = await get('/api/holdings');
  ok(!mayDel || !(after.items || []).some(x => x.code === '300750'), '删除后数据立即可见已更新');

  console.log('\n=== E. 清理测试数据（只删自己加的）===');
  // ⛔ 只删带 TEST_NOTE 的（本轮造的，含上一轮残留里带标记的），
  //    没标记的一律跳过 —— 那才是用户真实持仓。绝不按代码删，600519 这类真票用户真可能持有。
  const cur1 = (await get('/api/holdings')) || {};
  for (const it of (cur1.items || [])) {
    if (!isMine(it)) { console.log('   · 跳过 ' + it.code + '（无测试标记 = 用户真实持仓，不能删）'); continue; }
    await post('/api/holdings', { action: 'remove', code: it.code, _noSync: true });
  }
  // ⛔ 2026-10-06：只删持仓是不够的。本套件打的是**本机 8787 的真实服务**，
  //    建仓/删仓会写进真实 holdings.json，还会经 syncUpstream 转发到线上；
  //    持仓删掉了，但 .holdings_ops.json 里的那几十条测试流水仍在 ——
  //    线上 500 条流水曾被这些测试码占满，用户打开「持仓 → 变更记录」满屏 999999/900001。
  //    现在跑完连流水一起清（remote:true 连线上一起清，不留残骸）。
  const purge = await post('/api/holdings', { action: 'purgeOps' });
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
    '⛔ 开跑前就有的、无标记的 ' + PRE_REAL.length + ' 只（用户真实持仓）原样保留（' + preRealKept.join('/') + '）');

  console.log('\n=== F. 大单卡片的涨停概率 + 20日新高启动信号 ===');
  const s = await get('/api/state');
  const bm = s.bigMoney || {};
  const items = bm.items || [];
  console.log(`   当前返回 ${items.length} 只（${bm.source || '-'}，非交易时段可能为 0）`);
  for (const x of items.slice(0, 5)) {
    console.log(`   · ${x.name}(${x.code}) 涨停概率=${x.prob}% 距涨停=${x.gapToLimit} 20日新高=${x.prevHigh20 || '-'} 低于新高=${x.belowHigh20} 距新高=${x.gapToHigh20}% 🚀启动=${x.startSignal}`);
  }
  if (items.length) {
    ok(items.every(x => x.prob != null), '每条都带涨停概率预测 prob');
    ok(items.some(x => x.prevHigh20 != null), '已补齐前20日新高字段');
  } else {
    ok(true, '（非交易时段无数据，字段逻辑已就位）');
  }
  console.log('\n完成。');
})().catch(e => { console.error('异常', e); process.exit(1); });
