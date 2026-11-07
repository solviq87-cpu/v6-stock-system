// 体检扫描器（2026-10-06）：日期口径一致性
// 项目里所有日期键（todayStr / dayKeyOf / normDate / 新闻 x.t）都是**本地时间**，
// 一旦某处混进 toISOString()（UTC），北京时间 00:00-08:00 这 8 小时里就会差一天。
// 用作下界只是多留一天（宽松、不丢数据），一旦用作上界就会漏掉当天。
// 本扫描器把所有「日期键生成点」列出来，供人工确认口径统一。
const fs = require('fs');
const path = require('path');

const files = ['server.js', 'holdings.js', 'analysis.js', 'learnall.js', 'ztpre.js', 'em.js'];
console.log('===== ① 日期键生成函数 =====');
for (const f of files) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  for (const m of src.matchAll(/^function\s+(todayStr|dayKeyOf|normDate|dataTradeDay|lastTradeDay|dateKey)\s*\(.*$/gm)) {
    const ln = src.slice(0, m.index).split('\n').length;
    console.log(`  ${f} L${ln}  ${m[0].trim()}`);
  }
}

console.log('\n===== ② UTC 日期用法（需人工确认不是日期键）=====');
for (const f of [...files, 'public/index.html']) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//') || t.startsWith('*')) return;
    if (!/\.toISOString\(|getUTC|Date\.UTC/.test(l)) return;
    console.log(`  ${f} L${i + 1}  ${t.slice(0, 150)}`);
  });
}

console.log('\n===== ③ 时间字符串字段的生成（x.t / time 之类）=====');
for (const f of files) {
  const p = path.join(__dirname, f);
  if (!fs.existsSync(p)) continue;
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  lines.forEach((l, i) => {
    const t = l.trim();
    if (t.startsWith('//')) return;
    const m = t.match(/\b(t|time|at|ts)\s*:\s*new Date\(\)([^,;}]{0,70})/);
    if (!m) return;
    console.log(`  ${f} L${i + 1}  ${t.slice(0, 150)}`);
  });
}
