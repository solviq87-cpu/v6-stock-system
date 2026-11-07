// 清理线上持仓里带 __hold2_test__ 标记的测试残留
// ⛔ 铁律：只删带这个标记的（只可能由守门测试造出来），用户真实持仓一律不碰。
//    用户线上本来就是空的（df 轮核验过），这 3 只是 db 轮事故之后一路残留下来的。
const https = require('https');
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
const TOKEN = (cfg.syncUpstream || {}).token;
const HOST = 'quant-dashboard-77614.app.workbuddy.host';
const A = new https.Agent({ keepAlive: false, maxSockets: 8, family: 4 });

function req(method, path, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({
      host: HOST, port: 443, path, method, agent: A,
      headers: Object.assign({ 'Connection': 'close' }, data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {})
    }, x => {
      let s = ''; x.on('data', d => s += d); x.on('end', () => { try { res(JSON.parse(s)); } catch { res(s); } });
    });
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}
const T = () => '?token=' + encodeURIComponent(TOKEN);

(async () => {
  const before = await req('GET', '/api/holdings' + T());
  const items = before.items || [];
  console.log('清理前：' + items.length + ' 只');
  const mine = items.filter(x => String(x.note || '') === '__hold2_test__');
  const real = items.filter(x => String(x.note || '') !== '__hold2_test__');
  console.log('  测试残留 ' + mine.length + ' 只：' + mine.map(x => x.code).join('/'));
  console.log('  无标记（= 用户真实持仓，绝不碰）' + real.length + ' 只：' + real.map(x => x.code).join('/'));
  if (!mine.length) { console.log('没有可清的残留，结束'); return; }
  for (const it of mine) {
    const r = await req('POST', '/api/holdings' + T(), { action: 'remove', code: it.code });
    console.log('  删除 ' + it.code + ' → ok=' + r.ok + ' ' + (r.msg || r.error || ''));
  }
  // 顺带把线上的测试流水清掉（否则用户打开「变更记录」满屏测试码）
  const purge = await req('POST', '/api/holdings' + T(), { action: 'purgeOps', remote: true });
  console.log('  清流水 → ok=' + purge.ok + ' ' + (purge.msg || purge.error || ''));
  const after = await req('GET', '/api/holdings' + T());
  console.log('清理后：' + ((after.items || []).length) + ' 只 —— ' + (after.items || []).map(x => x.code + '(' + (x.note || '无标记') + ')').join('/'));
})();
