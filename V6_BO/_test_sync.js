// 双端实时同步延迟测试：
//   A端 = 电脑（SSE 长连接监听）
//   B端 = 手机（POST 改持仓）
// 目标：B 端操作后，A 端应在 1 秒内收到 holding 推送。
const http = require('http');
const HOST = '127.0.0.1', PORT = 8787;

function post(path, obj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(obj);
    const r = http.request({ host: HOST, port: PORT, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } },
      res => { let b = ''; res.on('data', d => b += d); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } }); });
    r.on('error', reject); r.write(data); r.end();
  });
}

function sse(name, dev) {
  return new Promise(resolve => {
    const r = http.get({ host: HOST, port: PORT, path: '/api/stream?dev=' + dev, headers: { Accept: 'text/event-stream' } }, res => {
      res.setEncoding('utf8');
      const state = { name, res, buf: '', events: [] };
      res.on('data', d => {
        state.buf += d;
        // 按 SSE 事件块切分
        let idx;
        while ((idx = state.buf.indexOf('\n\n')) >= 0) {
          const block = state.buf.slice(0, idx); state.buf = state.buf.slice(idx + 2);
          if (block.startsWith('event: holding')) state.events.push({ t: Date.now(), block });
        }
      });
      resolve(state);
    });
    r.on('error', e => { console.error(name, 'SSE 失败:', e.message); process.exit(1); });
  });
}

const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('建立两个在线端：电脑端(PC) + 手机端(PHONE)，都监听 SSE…');
  const pc = await sse('电脑端', 'TESTPC');
  const phone = await sse('手机端', 'TESTPH');
  await wait(600);

  // ⛔⛔ 2026-10-07 修（本轮角度：测试代码与生产数据的隔离边界）：
  //    本套件测的是「本机改持仓 → 双端 SSE 立刻收到」这条**实时链路**，
  //    而 `_noSync` 只跳过「转发到线上那一步」，**不影响** kick() 触发的 SSE 广播 ——
  //    也就是说加上它既不影响测试目的，又能挡住下面两桩真事故。原写法每一步都往线上转发：
  //      ① 每一次 add/update/tags/setlocked 都经 syncUpstream 推到线上，
  //         等于每次跑这个套件都往你的真实持仓里塞一只「同步测试 999999」再改五遍；
  //      ② 收尾那句 `purgeOps` 带 `remote: true` —— **会把线上的持仓变更流水整份清空**，
  //         你自己在手机上做的增删改记录被一起抹掉，事后完全查不到是谁干的。
  //    这正是「线上流水里全是 999999」与「流水莫名其妙变空」两个老毛病的源头。
  const CODE = '999999';
  const _ns = { _noSync: true };
  const steps = [
    ['手机新增持仓', { action: 'add', item: { code: CODE, name: '同步测试', cost: 10, shares: 100 }, ..._ns }],
    ['手机改股数', { action: 'update', code: CODE, data: { shares: 200 }, ..._ns }],
    ['手机打标签', { action: 'tags', code: CODE, tags: ['测试'], ..._ns }],
    ['手机锁仓', { action: 'setlocked', code: CODE, locked: true, ..._ns }],
    ['手机解锁', { action: 'setlocked', code: CODE, locked: false, ..._ns }],
    ['手机删除', { action: 'remove', code: CODE, ..._ns }],
  ];

  let worst = 0;
  for (const [label, body] of steps) {
    pc.events.length = 0; phone.events.length = 0;
    const t0 = Date.now();
    const r = await post('/api/holdings', body);
    const httpMs = Date.now() - t0;
    // 等推送到达（最多 5 秒）
    for (let i = 0; i < 100 && (!pc.events.length || !phone.events.length); i++) await wait(50);
    const pcMs = pc.events.length ? pc.events[0].t - t0 : -1;
    const phMs = phone.events.length ? phone.events[0].t - t0 : -1;
    const ok = pcMs >= 0 && pcMs < 1500 && phMs >= 0 && phMs < 1500;
    worst = Math.max(worst, pcMs, phMs);
    console.log(
      `${ok ? '✅' : '❌'} ${label.padEnd(8, '　')} 接口 ${String(httpMs).padStart(4)}ms` +
      ` | 电脑端收到 ${pcMs < 0 ? '未收到!' : pcMs + 'ms'}` +
      ` | 手机端收到 ${phMs < 0 ? '未收到!' : phMs + 'ms'}` +
      ` | 服务端 ${r.ok ? 'ok' : 'fail:' + (r.error || '')}`
    );
  }

  // 清理：确保测试票没留下
  await post('/api/holdings', { action: 'remove', code: CODE, ..._ns });
  // ⛔ 2026-10-07 改：原来这里带 `remote: true` —— 会连**线上**那份流水一起清空，
  //    把用户自己在手机上做的增删改记录一并抹掉（事后完全查不到）。本机流水照旧清，
  //    线上那份交给用户自己决定（面板上有「清空流水」按钮）。
  await post('/api/holdings', { action: 'purgeOps' });
  try { pc.res.destroy(); phone.res.destroy(); } catch {}
  console.log('\n最差同步延迟: ' + worst + 'ms（目标 <1500ms，越小越好；实测应远低于此）');
  console.log(worst < 1500 ? '✅ 双端实时同步达标' : '❌ 仍有延迟问题，需要继续优化');
  process.exit(0);
})();
