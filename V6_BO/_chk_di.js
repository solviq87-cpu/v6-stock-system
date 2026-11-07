// di 轮发布后核验：线上 appVer / needRule / 持仓（必须带 token，否则是假象）
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
  console.log('线上 appVer =', st && st.appVer);
  const nr = st && st.needRule;
  console.log('needRule 键 =', nr ? Object.keys(nr).join(',') : '（未下发 ⛔）');
  if (nr) for (const k of ['pool', 'profit', 'learn', 'ztpre', 'backtest', 'weekly', 'zt90'])
    console.log('   ' + k.padEnd(9) + ' n=' + String(nr[k].n).padStart(3) + '  onLess=' + nr[k].onLess);
  const wr = st && st.winRule;
  console.log('winRule 键 =', wr ? Object.keys(wr).join(',') : '（未下发 ⛔）');
  if (wr) for (const k of ['zt90', 'zt60', 'hi60', 'low95', 'news3'])
    console.log('   ' + k.padEnd(9) + ' n=' + String(wr[k].n).padStart(3) + '  ' + wr[k].what);
  const ts = st && st.taskState;
  const tk = ts ? Object.keys(ts) : [];
  console.log('taskState 任务数 =', tk.length, tk.length ? '（' + tk.map(k => ts[k].name + ':' + (ts[k].ok === null ? '未跑' : ts[k].ok ? 'ok' : 'FAIL')).join(' / ') + '）' : '（未下发 ⛔）');
  const h = await get('/api/holdings?token=' + tok);
  console.log('线上持仓（带 token）=', h && h.items ? h.items.length + ' 条' : '（拿不到）');
  const poor = await get('/api/holdings');
  console.log('不带 token 的假象 =', poor && poor.items ? poor.items.length + ' 条（私密闸门未挡？）' : '（被挡/无 items）');
})();
