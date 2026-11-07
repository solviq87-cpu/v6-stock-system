// 扫描器：硬闸门里「判不出来」被当成「判了通过」的写法清单。
//
// 判据形式：`!!(x && x.坏)`、`ago != null && ago < 60`、`capOk !== false`。
// 共同点都是**先判有没有结果、再判结果好坏** —— 于是「没结果」和「结果是好的」等价。
// 数据缺失 / 源降级 / 历史不够长时，闸门静默失效，而且方向是**放行**（不是拦下）。
//
// 本扫描器只做清单，供人工逐条判断：
//   · 是**一票否决的硬闸门**吗 → 判不出来必须「标注 + 打折」，绝不能默许放行；
//   · 还是**打分权重**吗 → 按中性处理是对的（缺K线 0.7、缺市值中性），保持原样。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const FILES = ['server.js', 'analysis.js', 'bazi.js', 'em.js'].filter(f => fs.existsSync(path.join(ROOT, f)));

const PATS = [
  { re: /!!\([A-Za-z_$][\w$.]*\s*&&/, tag: '!!(结果 && 坏)' },
  { re: /[A-Za-z_$][\w$.]*\s*!=\s*null\s*&&/, tag: '值 != null &&（缺值即短路）' },
  { re: /[A-Za-z_$][\w$.]*\s*!==\s*null\s*&&/, tag: '值 !== null &&（缺值即短路）' },
  { re: /[A-Za-z_$][\w$.]*\s*!==\s*false\b/, tag: '值 !== false（null 也过）' },
  { re: /[A-Za-z_$][\w$.]*\s*==\s*null\s*\?\s*null/, tag: '三态 null（判不出）' }
];

let total = 0;
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const lines = src.split('\n');
  const hits = [];
  lines.forEach((ln, i) => {
    const t = ln.trim();
    if (t.charAt(0) === '/' || t.charAt(0) === '*') return;
    for (const p of PATS) {
      if (p.re.test(ln)) { hits.push({ line: i + 1, tag: p.tag, code: t.slice(0, 130) }); break; }
    }
  });
  if (!hits.length) { console.log(`\n=== ${f}：0 处 ===`); continue; }
  total += hits.length;
  console.log(`\n=== ${f}：${hits.length} 处 ===`);
  for (const h of hits) console.log(`  L${h.line} [${h.tag}]\n     ${h.code}`);
}

console.log(`\n合计 ${total} 处。逐条判定：硬闸门 → 判不出来必须标注/打折；打分权重 → 中性即可。`);
console.log('已修（本轮）：八字闸门 baziUnknown / 次新股闸门 newGateUnknown / 市值闸门 capUnknown。');
