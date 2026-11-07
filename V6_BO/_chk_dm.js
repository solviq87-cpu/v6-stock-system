// dm 轮发布后核验：线上 appVer / staleState / staleRule / 持仓（必须带 token，否则是假象）
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
  console.log('doneRule 等级 =', st && st.doneRule ? Object.keys(st.doneRule).length : '未下发');

  const sr = st && st.staleRule;
  console.log('staleRule 种类 =', sr ? Object.keys(sr).map(k => k + sr[k].word).join(' / ') : '（未下发 ⛔）');

  const ss = st && st.staleState;
  const ks = ss ? Object.keys(ss) : [];
  console.log('staleState 池数 =', ks.length);
  for (const k of ks) {
    const v = ss[k];
    console.log('   ' + String(v.name).padEnd(7) + ' ' + String(v.mark || '').padEnd(3) +
      ' kind=' + String(v.kind).padEnd(6) + ' ' + String(v.line || ''));
  }
  const h = await get('/api/holdings?token=' + tok);
  console.log('线上持仓（带 token）=', h && h.items ? h.items.length + ' 条' : '（拿不到）');
  const poor = await get('/api/holdings');
  console.log('不带 token 的假象 =', poor && poor.items ? poor.items.length + ' 条（私密闸门未挡？）' : '（被挡/无 items）');
})();
