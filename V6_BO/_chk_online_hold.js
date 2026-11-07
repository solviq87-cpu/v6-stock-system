// 核线上真实持仓（必须带 token，否则被私密闸门挡 → 「0 条」是假象）
const https = require('https');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
const TOKEN = (cfg.syncUpstream || {}).token;

function get(path) {
  return new Promise((res, rej) => {
    const r = https.request({
      host: 'quant-dashboard-77614.app.workbuddy.host', port: 443, path, method: 'GET',
      headers: { 'Connection': 'close' }, agent: new https.Agent({ keepAlive: false, maxSockets: 8, family: 4 })
    }, x => {
      let s = ''; x.on('data', d => s += d); x.on('end', () => { try { res(JSON.parse(s)); } catch { res(s); } });
    });
    r.on('error', rej);
    r.end();
  });
}
(async () => {
  const withTok = await get('/api/holdings?token=' + encodeURIComponent(TOKEN));
  console.log('【带 token】ok=' + withTok.ok + ' 条数=' + ((withTok.items || []).length));
  for (const it of withTok.items || []) {
    console.log('   ' + it.code + ' ' + it.name + ' note=' + JSON.stringify(it.note) + ' shares=' + it.shares + ' addedAt=' + it.addedAt);
  }
  const noTok = await get('/api/holdings');
  console.log('【不带 token】ok=' + noTok.ok + ' 条数=' + ((noTok.items || []).length) + '  ← 私密闸门挡住时这里是假象');
  const st = await get('/api/state?token=' + encodeURIComponent(TOKEN));
  console.log('【/api/state】appVer=' + (st.appVer || '(SSE精简版无此键)') + ' pushRole=' + st.pushRole);
  console.log('   cfgRange.probThreshold=' + JSON.stringify((st.cfgRange || {}).probThreshold));
  console.log('   cfgRange.pushMinProb=' + JSON.stringify((st.cfgRange || {}).pushMinProb));
})();
