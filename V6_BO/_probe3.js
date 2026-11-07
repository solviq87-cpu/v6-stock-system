const https = require('https');
const todo = require('./.missing_codes.json');
const sample = todo.slice(200, 208);
const agent = new https.Agent({ keepAlive: false, maxSockets: 64, family: 4 });
function raw(url, timeout = 8000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const r = https.get(url, { agent, timeout, headers: { 'Connection': 'close', 'User-Agent': 'Mozilla/5.0' } }, resp => {
      let s = ''; resp.on('data', d => s += d);
      resp.on('end', () => { try { res({ ms: Date.now() - t0, j: JSON.parse(s) }); } catch (e) { rej(new Error('parse ' + (Date.now() - t0) + 'ms len' + s.length)); } });
    });
    r.on('timeout', () => { r.destroy(); rej(new Error('timeout ' + (Date.now() - t0) + 'ms')); });
    r.on('error', e => rej(e));
  });
}
const emUrl = c => `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${(c.startsWith('6')||c.startsWith('9'))?'1.':'0.'}${c}&klt=101&fqt=1&lmt=60&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
const txUrl = c => `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${(c.startsWith('6')?'sh':'sz')}${c},day,,,60,qfq`;
(async () => {
  for (const [label, fn] of [['东财EM', emUrl], ['腾讯TX', txUrl]]) {
    const t0 = Date.now(); let ok = 0, err = 0, mss = [];
    const rs = await Promise.all(sample.map(c => fn(c)).map(u => raw(u).then(r => { ok++; mss.push(r.ms); return r; }).catch(e => { err++; mss.push(-1); return null; })));
    mss.sort((a, b) => a - b);
    console.log(`${label}: ok=${ok} err=${err} 总耗时=${((Date.now()-t0)/1000).toFixed(1)}s 单请求中位=${mss[Math.floor(mss.length/2)]}ms 最大=${mss[mss.length-1]}ms`);
  }
})();
