// ds 轮侦察：同一个数，在系统里走了一圈之后，还是不是同一个东西
//   三条线：① 概率流水线（raw → 校准 → 融合 → 钳位）各出口用的是哪个阶段的数
//          ② 同一份数据被两个模块各存一份（派生副本 / 二次落盘）后是否漂移
//          ③ 落盘往返的精度与量纲（toFixed 后写回、0~1 与 0~100 混用）
const fs = require('fs');
const src = fs.readFileSync('server.js', 'utf8');
const lines = src.split('\n');
const clean = lines.map(l => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; })
  .filter((l, i) => !lines[i].startsWith('const APP_VER = '));

console.log('=== ① calibratedProb / fusedProb / limitUpProbability 的调用点与入参量纲 ===');
clean.forEach((l, i) => {
  if (!/calibratedProb\(|fusedProb\(|limitUpProbability\(|nextDayLimitProb\(/.test(l)) return;
  console.log('L%d: %s', i + 1, l.trim().slice(0, 150));
});

console.log('\n=== ② prob 被「再赋值」的地方（加工后覆盖原值 → 下游分不清用的是哪个阶段）===');
clean.forEach((l, i) => {
  if (/\.prob\s*=\s*[^=]/.test(l) && !/\.prob\s*==\s*null/.test(l)) {
    console.log('L%d: %s', i + 1, l.trim().slice(0, 140));
  }
});

console.log('\n=== ③ 派生副本：谁在给「另一个集合」重复存同一份数据 ===');
const derRe = /(S\.\w+)\s*=\s*(new Set|new Map|\(.*\)\.map|\w+\.map|\w+\.filter)/;
clean.forEach((l, i) => {
  if (derRe.test(l) && /zt|pool|Codes|BySector|cand|pick/i.test(l)) {
    console.log('L%d: %s', i + 1, l.trim().slice(0, 140));
  }
});

console.log('\n=== ④ 精度：先 toFixed/round 再写回对象（落盘后精度已丢，下游却当精确值算）===');
clean.forEach((l, i) => {
  if (/=\s*\+\(?.{0,40}\.toFixed\(|=\s*Math\.round\(/.test(l) && /prob|score|pct|rate|price|amt|cash|pnl/i.test(l)) {
    console.log('L%d: %s', i + 1, l.trim().slice(0, 140));
  }
});

console.log('\n=== ⑤ 量纲可疑：同一个量既像 0~1 又像 0~100 ===');
clean.forEach((l, i) => {
  if (/prob/i.test(l) && /\*\s*100|\/\s*100|> 1|>= 1|< 1/.test(l) && !/ratio|pct/i.test(l)) {
    console.log('L%d: %s', i + 1, l.trim().slice(0, 140));
  }
});
