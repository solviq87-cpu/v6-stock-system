// 只读：线上今日推送流水分类速览（谁吃了「其它」额度）+ 口令不回显
const fs = require('fs');
const BASE = 'https://quant-dashboard-77614.app.workbuddy.host';
const REPO = 'C:/Users/28957/WorkBuddy/2026-09-25-13-40-58/stock-dashboard';
(async () => {
  const py = fs.readFileSync(REPO + '/_publish.py', 'utf8');
  const pwd = py.match(/DEV_PWD\s*=\s*['"]([^'"]+)['"]/)[1];
  const trust = await (await fetch(BASE + '/api/lock/trust', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({password: pwd, name: '学习闭环日报核验2', role: 'edit', fp: 'ldc2-' + Date.now()})
  })).json();
  const token = trust.token || trust.t || (trust.data && trust.data.token);
  const pl = await (await fetch(BASE + '/api/push-log?token=' + encodeURIComponent(token))).json();
  const arr = Array.isArray(pl) ? pl : (pl.log || pl.entries || pl.items || []);
  const today = arr.filter(x => { const t = JSON.stringify(x); return t.includes('2026/10/28') || t.includes('2026-10-28') || t.includes('20261028'); });
  console.log(JSON.stringify({
    todayTotal: today.length,
    entries: today.map(x => ({
      time: x.time || x.ts,
      status: x.status,
      head: String(x.title || x.text || JSON.stringify(x)).split('\n')[0].slice(0, 50)
    }))
  }, null, 1));
})();
