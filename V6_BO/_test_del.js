// 验证新增的「批量删除 / 清空全部」能否实时同步到另一端（测完自动还原持仓数据）
const http = require('http');
const fs = require('fs');
const path = require('path');
const HOST = '127.0.0.1', PORT = 8787;
const FILE = path.join(__dirname, 'holdings.json');

function post(p, obj) {
  return new Promise((resolve, reject) => {
    const d = JSON.stringify(obj);
    const r = http.request({ host: HOST, port: PORT, path: p, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) } },
      res => { let b = ''; res.on('data', x => b += x); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } }); });
    r.on('error', reject); r.write(d); r.end();
  });
}
function get(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: p }, res => {
      let b = ''; res.on('data', x => b += x);
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    }).on('error', reject);
  });
}
function sse(dev) {
  return new Promise(resolve => {
    const r = http.get({ host: HOST, port: PORT, path: '/api/stream?dev=' + dev, headers: { Accept: 'text/event-stream' } }, res => {
      res.setEncoding('utf8');
      const st = { res, buf: '', events: [] };
      res.on('data', d => { st.buf += d; let i;
        while ((i = st.buf.indexOf('\n\n')) >= 0) { const b = st.buf.slice(0, i); st.buf = st.buf.slice(i + 2);
          if (b.startsWith('event: holding')) st.events.push(Date.now()); } });
      resolve(st);
    });
    r.on('error', e => { console.error('SSE 失败', e.message); process.exit(1); });
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const backup = fs.readFileSync(FILE, 'utf8');
  const pc = await sse('TESTPC2');
  await wait(500);
  // ⛔ 2026-10-07 补：下面要测 `action:'clear'` —— 那是**全表清空**，会把开跑前就有的
  //    真实持仓一起抹掉。而本脚本原来的"还原"只 `writeFileSync` 写回磁盘，服务端内存里
  //    的 HOLD 仍是清空的（脚本自己都注明"需重启服务让其重新载入"）。
  //    也就是说：谁本机真持有票，跑一次这个套件，面板就空了，得重启才回来。
  //    现在改成：开跑前先快照，清完用**接口**把真实持仓加回去（内存+磁盘一起生效）。
  const PRE = (((await get('/api/holdings')) || {}).items || []).map(x => ({
    code: x.code, name: x.name, cost: x.cost, shares: x.shares,
    tags: (x.tags || []).join(','), note: x.note || '', locked: !!x.locked
  }));
  if (PRE.length) console.log(`   · 开跑前已有 ${PRE.length} 只真实持仓（${PRE.map(x => x.code).join('/')}），清空测试后会原样加回`);

  const codes = ['900001', '900002', '900003'];
  for (const c of codes) await post('/api/holdings', { action: 'add', item: { code: c, name: '测试' + c.slice(-1), cost: 10, shares: 100 }, _noSync: true });
  await wait(300);

  // ① 批量删除
  pc.events.length = 0;
  let t0 = Date.now();
  let r = await post('/api/holdings', { action: 'removeMany', codes: [codes[0], codes[1]] , _noSync: true });
  for (let i = 0; i < 100 && !pc.events.length; i++) await wait(50);
  let ms = pc.events.length ? pc.events[0] - t0 : -1;
  console.log(`${r.ok && ms >= 0 && ms < 1500 ? '✅' : '❌'} 批量删除2条: ${r.msg || r.error} | 另一端收到 ${ms}ms`);

  // ② 清空全部
  pc.events.length = 0;
  t0 = Date.now();
  r = await post('/api/holdings', { action: 'clear' , _noSync: true });
  for (let i = 0; i < 100 && !pc.events.length; i++) await wait(50);
  ms = pc.events.length ? pc.events[0] - t0 : -1;
  console.log(`${r.ok && ms >= 0 && ms < 1500 ? '✅' : '❌'} 清空全部: ${r.msg || r.error} | 另一端收到 ${ms}ms`);

  // ③ 空表再清一次（应优雅提示，不是报错）
  r = await post('/api/holdings', { action: 'clear' , _noSync: true });
  console.log(`${r.ok ? '✅' : '❌'} 空表再清空: ${r.msg || r.error}`);
  r = await post('/api/holdings', { action: 'removeMany', codes: [] , _noSync: true });
  console.log(`${r.ok === false ? '✅' : '❌'} 空选删除应拒绝: ${r.error || '(未拒绝)'}`);

  // ⛔⛔ 2026-10-06：原来的"还原"是假的 —— 只 `fs.writeFileSync(FILE, backup)` 写回磁盘，
  //   而服务端**内存里的 HOLD 仍是测试后的状态**（脚本自己都注明"需重启服务让其重新载入"）。
  //   结果：磁盘干净、内存脏，面板照常显示 900001/900002/900003/999999，
  //   下一次跑全量还会被 _test_no_test_holdings.js 抓包。
  //   正确做法：走接口把测试码删掉（内存+磁盘一起生效），再清流水。
  const rm = await post('/api/holdings', { action: 'removeMany', codes: [...codes, '999999'], _noSync: true });
  // 把开跑前就有的真实持仓加回去（走接口，内存与磁盘一起生效）
  for (const it of PRE) {
    await post('/api/holdings', { action: 'add', item: it, _noSync: true });
  }
  // 前面的 clear 可能已经把它们清掉了 → removeMany 回「没有匹配的持仓」，这也算清理成功。
  // ⚠️ 2026-10-06 修：服务端把这句话放在 **msg** 里（不是 error），原来只查 error →
  //    清理其实成功了却判红，白吓一次。两个字段都要认。
  const _rmTxt = String(rm.msg || '') + ' ' + String(rm.error || '');
  const _rmOk = !!rm.ok || /没有匹配/.test(_rmTxt);
  console.log(`${_rmOk ? '✅' : '❌'} 清理内存里的测试票: ${rm.msg || rm.error}`);
  await post('/api/holdings', { action: 'purgeOps' });
  const after = await get('/api/holdings');
  const left = ((after && after.items) || []).map(x => x.code);
  // ⚠️ 2026-10-06 修：这里原来断言「持仓为空」。但本机副本现在每 3 分钟从线上**补齐**持仓
  //    （就是治"删不干净"那个 pullHoldingsDownstream），线上有真票 → 本地本来就该有票。
  //    真正要守的是「测试码不许残留」，不是「一张票都不许有」。
  const junk = left.filter(c => /^9\d{5}$/.test(String(c)));
  console.log(`${junk.length === 0 ? '✅' : '❌'} 还原后无测试票残留（当前共 ${left.length} 只${left.length ? '：' + left.join(',') : ''}${junk.length ? '｜残留测试码 ' + junk.join(',') : ''}）`);
  // ⛔ 开跑前就有的真实持仓必须原样还在（clear 是破坏性操作，不能"测完就没了"）
  const preCodes = PRE.map(x => x.code);
  const back = preCodes.filter(c => left.includes(c));
  console.log(`${back.length === preCodes.length ? '✅' : '❌'} 开跑前的 ${preCodes.length} 只真实持仓已原样加回（找回 ${back.length} 只${preCodes.length ? '：' + preCodes.join(',') : ''}）`);
  try { pc.res.destroy(); } catch {}
  console.log('\n已还原持仓（内存+磁盘一致，无需重启）');
  process.exit(0);
})();
