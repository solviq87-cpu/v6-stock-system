// dl 轮：查线上设备台账（只查不删），确认有没有我造出来的残留设备
const fs = require('fs');
const https = require('https');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
const tok = ((cfg.syncUpstream || {}).token) || '';
const HOST = 'quant-dashboard-77614.app.workbuddy.host';

function req(method, path, body) {
  return new Promise(res => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      host: HOST, path, method,
      agent: new https.Agent({ keepAlive: false, maxSockets: 8, family: 4 }),
      headers: Object.assign({ 'Connection': 'close' },
        data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    }, x => { let s = ''; x.on('data', d => s += d); x.on('end', () => { try { res(JSON.parse(s)); } catch { res(null); } }); });
    r.on('error', e => res(null));
    if (data) r.write(data);
    r.end();
  });
}
(async () => {
  const d = await req('GET', '/api/lock/devices?token=' + tok);
  const list = (d && (d.devices || d.items || d.list)) || (Array.isArray(d) ? d : null);
  if (!list) { console.log('拿不到台账:', JSON.stringify(d).slice(0, 300)); return; }
  console.log('台账设备数 =', list.length);
  for (const x of list) {
    console.log('  id=' + String(x.id || x.deviceId || '').padEnd(16) +
      ' fp=' + String(x.fp || '(无fp)').padEnd(18) +
      ' name=' + String(x.name || '').padEnd(14) +
      ' role=' + String(x.role || '') +
      (x.revoked ? ' [已撤销]' : '') +
      ' t=' + new Date(x.t || x.time || 0).toLocaleString('zh-CN'));
  }
})();
