// 扫描器 · dp 轮第一遍：同一个数在「算出来 → 存 S → 下发 → 前端 → 文案」这条链上被加工了几道
//   上一轮（do）收的是「同一个键名在后端与接口里是不是同一个值」。
//   这一轮往外一层：**值本身在链路上被改过几次，而改动有没有跟着说出去。**
//   重点四类加工：toFixed(精度丢失) / || 0(把没取到与真 0 混成一个) / ×100÷100(单位换算) / Math.round·max·min(钳位)
const fs = require('fs');
const D = __dirname;
const SV = fs.readFileSync(D + '/server.js', 'utf8');
const HV = fs.readFileSync(D + '/public/index.html', 'utf8');
const SL = SV.split('\n');
const HL = HV.split('\n');
const noComment = s => s.split('\n').map(l => { const i = l.indexOf('//'); return i < 0 ? l : l.slice(0, i); }).join('\n');
const SC = noComment(SV), HC = noComment(HV);
const SCL = SC.split('\n'), HCL = HC.split('\n');

const show = (arr, tag, limit) => {
  console.log('\n【%s】共 %d 处', tag, arr.length);
  arr.slice(0, limit || 12).forEach(x => console.log('   %s', x));
};

// ── ① toFixed：哪些字段被定精度，之后还拿去比较/算术 ──
console.log('══ ① toFixed 加工 ══');
{
  const byN = {};
  SC.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/toFixed\((\d+)\)/g)) {
      byN[m[1]] = (byN[m[1]] || 0) + 1;
    }
  });
  console.log('toFixed 位数分布:', JSON.stringify(byN));
  // 找「先 toFixed 存起来，之后又拿这个字段比较」的：字段名 X 同时出现在 `X: ...toFixed` 与 `X > / X < / X >=`
  const fixed = new Map();
  SCL.forEach(l => {
    const m = l.match(/([A-Za-z_$][\w$]*)\s*:\s*[^,;]*toFixed\(/);
    if (m) {
      if (!fixed.has(m[1])) fixed.set(m[1], []);
      fixed.get(m[1]).push(l.trim().slice(0, 90));
    }
  });
  console.log('被 toFixed 定精度的字段 %d 个', fixed.size);
  let cmp = 0;
  for (const [k, defs] of fixed) {
    const re = new RegExp('\\b' + k + '\\s*(?:>=|<=|>|<|===|==)\\s*', 'g');
    let m; const hits = [];
    while ((m = re.exec(SC))) {
      const line = SC.slice(0, m.index).split('\n').length;
      hits.push('L' + line + ' ' + SCL[line - 1].trim().slice(0, 80));
    }
    if (hits.length) {
      cmp++;
      console.log('  ⚠ %s 被 toFixed 后仍参与比较（%d 处）', k, hits.length);
      console.log('       定义: %s', defs[0]);
      hits.slice(0, 2).forEach(h => console.log('       比较: %s', h));
    }
  }
  if (!cmp) console.log('  （没有 toFixed 后仍参与比较的字段）');
}

// ── ② || 0 在判定位置（把 null / undefined / NaN 全变成 0）──
console.log('\n══ ② `|| 0` 把「没取到」当成 0 ══');
{
  const rows = [];
  SCL.forEach((l, i) => {
    for (const m of l.matchAll(/([A-Za-z_$][\w$.]*)\s*\|\|\s*0\b/g)) {
      // 只留出现在比较/算术上下文的
      if (/(>=|<=|>|<|===|==|\+|-|\*|\/)/.test(l)) rows.push('L' + (i + 1) + '  ' + m[1] + '  ← ' + l.trim().slice(0, 88));
    }
  });
  show(rows, '|| 0 且参与比较/算术', 16);
}

// ── ③ ×100 / ÷100 单位换算：同一个概率 0.82 ↔ 82 ──
console.log('\n══ ③ 单位换算（×100 / ÷100 / / 100）══');
{
  const rowsS = [], rowsH = [];
  SCL.forEach((l, i) => { if (/\*\s*100\b|\/\s*100\b/.test(l)) rowsS.push('srv L' + (i + 1) + '  ' + l.trim().slice(0, 100)); });
  HCL.forEach((l, i) => { if (/\*\s*100\b|\/\s*100\b/.test(l)) rowsH.push('html L' + (i + 1) + '  ' + l.trim().slice(0, 100)); });
  show(rowsS, 'server 侧 ×100/÷100', 14);
  show(rowsH, '前端侧 ×100/÷100', 10);
}

// ── ④ 后端算好的数，前端又加工一遍（toFixed / Math.round / 再 *100）──
console.log('\n══ ④ 前端二次加工 ══');
{
  const rows = [];
  HCL.forEach((l, i) => {
    if (/toFixed\(/.test(l) && /\$\{|textContent|innerHTML/.test(l)) rows.push('L' + (i + 1) + '  ' + l.trim().slice(0, 110));
  });
  show(rows, '前端在渲染时 toFixed', 14);
}

// ── ⑤ Math.round / Math.floor / Math.ceil / Math.max / Math.min 的钳位 ──
console.log('\n══ ⑤ 取整与钳位 ══');
{
  const cnt = {};
  SCL.forEach(l => {
    for (const m of l.matchAll(/Math\.(round|floor|ceil|max|min|abs|trunc)\(/g)) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
  });
  console.log('   server:', JSON.stringify(cnt));
  const cnt2 = {};
  HCL.forEach(l => {
    for (const m of l.matchAll(/Math\.(round|floor|ceil|max|min|abs|trunc)\(/g)) cnt2[m[1]] = (cnt2[m[1]] || 0) + 1;
  });
  console.log('   前端  :', JSON.stringify(cnt2));
}

// ── ⑥ 同一个数：后端日志里一个写法、对外文案里另一个写法 ──
console.log('\n══ ⑥ 日志 vs 文案：同一个量的两种写法 ══');
{
  // 找形如 console.log(`...${x}...`) 与 pushAll(`...${x}...`) 里共同出现的标识符不好做；
  // 改查：日志里带「只/条/笔」的模板串与文案里的数量词，看同一个池的口径
  const logRows = [];
  SCL.forEach((l, i) => {
    if (/console\.log\(/.test(l) && /(只|条|笔|家)/.test(l)) logRows.push('L' + (i + 1) + '  ' + l.trim().slice(0, 110));
  });
  show(logRows, '后端日志里的数量词', 16);
}
