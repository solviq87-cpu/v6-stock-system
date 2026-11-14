// 只读核验：线上 push-log 今日「学习日报」实况（口令不回显）
const fs = require('fs');
const BASE = 'https://quant-dashboard-77614.app.workbuddy.host';
const REPO = 'C:/Users/28957/WorkBuddy/2026-09-25-13-40-58/stock-dashboard';
(async () => {
  // 从 _publish.py 提取 DEV_PWD（绝不打印）
  const py = fs.readFileSync(REPO + '/_publish.py', 'utf8');
  const m = py.match(/DEV_PWD\s*=\s*['"]([^'"]+)['"]/);
  if (!m) { console.log(JSON.stringify({err: 'DEV_PWD not found in _publish.py'})); return; }
  const pwd = m[1];
  const fp = 'learn-daily-verify-' + Date.now();
  const trustRes = await fetch(BASE + '/api/lock/trust', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password: pwd, name: '学习闭环日报核验', role: 'edit', fp})
  });
  const trust = await trustRes.json().catch(() => ({}));
  const token = trust.token || trust.t || (trust.data && trust.data.token);
  if (!token) { console.log(JSON.stringify({err: 'no token', keys: Object.keys(trust), ok: trust.ok})); return; }
  const plRes = await fetch(BASE + '/api/push-log?token=' + encodeURIComponent(token));
  const pl = await plRes.json().catch(() => null);
  const arr = Array.isArray(pl) ? pl : (pl && (pl.log || pl.entries || pl.items)) || [];
  const hits = arr.filter(x => JSON.stringify(x).includes('学习日报'));
  const todayHits = hits.filter(x => { const t = JSON.stringify(x); return t.includes('2026-10-28') || t.includes('20261028'); });
  console.log(JSON.stringify({
    onlinePushLogTotal: arr.length,
    learnReportAll: hits.map(x => ({time: x.time || x.ts, status: x.status, title: (x.title || '').slice(0, 42)})),
    todayCount: todayHits.length,
    todayDetail: todayHits.map(x => ({time: x.time || x.ts, status: x.status, channel: x.channel || '', title: (x.title || '').slice(0, 42)}))
  }, null, 1));
})();
