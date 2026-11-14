// 用真实学习库验证：封板标签 zt 到底有没有被标出来
const fs = require('fs');
const P = 'ztpre.json';
if (!fs.existsSync(P)) { console.log('没有 ztpre.json'); process.exit(0); }
const j = JSON.parse(fs.readFileSync(P, 'utf8'));
console.log('ver=' + j.ver + '  n=' + j.n + '  zt=' + j.zt + '  hit=' + j.hit);
console.log('baseZt=' + j.baseZt + '  baseHit=' + j.baseHit);
console.log('days 天数=' + Object.keys(j.days || {}).length);
const rs = j.rules || [];
const ztRules = rs.filter(r => String(r.key || '').charAt(0) === 'P');
console.log('规则数=' + rs.length + '（其中封板类 P=' + ztRules.length + '）');
console.log(ztRules.slice(0, 3).map(r => '   ' + r.key + ' → ' + JSON.stringify(r).slice(0, 110)).join('\n'));
