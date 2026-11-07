// dl 轮发布后核验：线上 appVer / doneRule / taskState 分级 / pushLast / 持仓（必须带 token）
const fs = require('fs');
const https = require('https');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
const tok = ((cfg.syncUpstream || {}).token) || '';
const HOST = 'quant-dashboard-77614.app.workbuddy.host';

function get(path) {
  return new Promise(res => {
    const r = https.request({
      host: HOST, path, method: 'GET',
      agent: new https.Agent({ keepAlive: false, maxSockets: 8, family: 4 }),
      headers: { 'Connection': 'close' }
    }, x => { let s = ''; x.on('data', d => s += d); x.on('end', () => { try { res(JSON.parse(s)); } catch { res(null); } }); });
    r.on('error', e => res(null));
    r.end();
  });
}
(async () => {
  const st = await get('/api/state?token=' + tok);
  console.log('线上 appVer =', st && st.appVer, '（期望 20261007dl）');

  const dr = st && st.doneRule;
  const dk = dr ? Object.keys(dr) : [];
  console.log('doneRule 等级 =', dk.length ? dk.map(k => k + dr[k].mark).join(' ') : '（未下发 ⛔）');

  const ts = st && st.taskState;
  const tk = ts ? Object.keys(ts) : [];
  console.log('taskState 任务数 =', tk.length);
  for (const k of tk) {
    const v = ts[k];
    const tail = v.done === 'yield' ? (v.n + ' 条')
      : v.done === 'empty' ? ('0 条 · ' + (v.empty || ''))
        : v.done === 'fail' ? ('未跑成 · ' + (v.error || ''))
          : (v.done || '?');
    console.log('   ' + String(v.name).padEnd(9) + ' ' + String(v.mark || '').padEnd(2) + ' ' + tail);
  }
  const pl = st && st.pushLast;
  console.log('pushLast =', pl ? ('ret=' + pl.ret + ' sent=' + pl.sent + (pl.why ? ' why=' + pl.why : '')) : '（未下发 ⛔）');

  const h = await get('/api/holdings?token=' + tok);
  console.log('线上持仓（带 token）=', h && h.items ? h.items.length + ' 条' : '（拿不到）');
  const poor = await get('/api/holdings');
  console.log('不带 token 的假象 =', poor && poor.items ? poor.items.length + ' 条（私密闸门未挡？）' : '（被挡/无 items）');

  const loc = await get('http://127.0.0.1:8787/api/state?token=' + tok).catch(() => null);
  console.log('（本地副本需另查，见下方 curl）');
})();
