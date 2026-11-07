// 扫描器（cs 轮 · 角度：数据血缘 —— 一个数被改写几次、每次有没有留痕）
// 关注"概率"这条最典型的链：模型原值 → 学习融合(fusedProb) → 闸门/排序 → 文案 → 落盘样本。
// 只要某一步用了改写后的值、下一步却用改写前的值，且没有任何痕迹说明"它改过"，
// 就是一处血缘断裂：用户看到的数 ≠ 系统据以决策的数，事后也无法回溯。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');

const SV = fs.readFileSync('./server.js', 'utf8');
const NOC = stripNoise(SV, { keepStrings: true });
const lines = NOC.split('\n');

const lineOf = (s, from = 0) => { const i = s.indexOf(from); return i < 0 ? -1 : s.slice(0, i).split('\n').length; };

console.log('════ 数据血缘扫描 · 概率链：模型原值 → 融合 → 闸门/排序 → 文案 ════\n');

// ── 表一：govTake / govFilter 的调用点，有没有把融合值回写 ────────────────
console.log('【表一】闸门调用点：算出来的融合值有没有回写到对象（决定文案能不能显示它）');
const calls = [];
lines.forEach((l, i) => {
  const m = l.match(/(\w+)\s*=\s*govTake\(/);
  if (m) calls.push({ kind: 'govTake', line: i + 1, varName: m[1], raw: l.trim().slice(0, 90) });
  if (/govFilter\(/.test(l) && !/function govFilter/.test(l)) calls.push({ kind: 'govFilter', line: i + 1, varName: '', raw: l.trim().slice(0, 90) });
});
// ⛔ 判据要钉语义不要钉位置（第 10 次同类）：govFilter 的回写发生在**函数内部**，
//    不在调用点之后 → 只看调用点后面 12 行会把它全判成"未回写"（假红）。
//    同理，govTake 调用点后面若接了 logSignal 并由它补 `_fz`，也算这条链通了。
const govFilterWritesBack = /if\s*\(res\.ok\)\s*\{[^}]*_fz\s*=/.test(NOC) || /_fz\s*=\s*res\.fused/.test(NOC);
for (const c of calls) {
  const win = lines.slice(c.line, c.line + 14).join('\n');
  const direct = /\w+\._fz\s*=\s*/.test(win);
  const viaLog = /logSignal\(/.test(win) && /\w+\._fz\s*=\s*/.test(win);
  const back = c.kind === 'govFilter' ? govFilterWritesBack : (direct || viaLog);
  const how = c.kind === 'govFilter'
    ? (govFilterWritesBack ? '由 govFilter 内部回写' : 'govFilter 内部未回写')
    : (direct ? '调用点直接回写' : (viaLog ? '由 logSignal 返回值补' : '未回写 _fz'));
  console.log('  ' + (back ? '✅' : '❌') + ' L' + c.line + '  ' + c.kind.padEnd(10) + how);
  console.log('        ' + c.raw);
}

// ── 表二：文案里出现"概率/评分"的模块，有没有调 fuseLine（唯一入口）────────
console.log('\n【表二】文案里的概率字段：有没有走 fuseLine 这个唯一入口');
const txtHits = [];
lines.forEach((l, i) => {
  const m = l.match(/(涨停概率|次日概率|补涨概率|埋伏分|评分)\s*[￥$]?\{?[^`]{0,40}\}/);
  if (!m) return;
  if (!/\$\{/.test(l)) return;                    // 只要模板串（真实文案）
  const hasFuse = /fuseLine\(/.test(l) || /fuseLine\(/.test(lines.slice(i, i + 6).join('\n'));
  txtHits.push({ line: i + 1, hasFuse, raw: l.trim().slice(0, 100) });
});
txtHits.forEach(h => console.log('  ' + (h.hasFuse ? '✅' : '❌') + ' L' + h.line + '  ' + (h.hasFuse ? '带 fuseLine' : '只显示原值，无来源痕迹')));

// ── 表三：logSignal 的返回值有没有被接住（接不住 = 样本登记了也没回传）──────
console.log('\n【表三】logSignal 返回值：登记样本时算好的融合值有没有被接住');
const ls = [];
lines.forEach((l, i) => {
  if (!/logSignal\(/.test(l) || /function logSignal/.test(l)) return;
  const assigned = /=\s*logSignal\(/.test(l) || /const\s+\w+\s*=\s*logSignal\(/.test(l);
  ls.push({ line: i + 1, assigned, raw: l.trim().slice(0, 90) });
});
ls.forEach(h => console.log('  ' + (h.assigned ? '✅' : '❌') + ' L' + h.line + '  ' + (h.assigned ? '返回值已接住' : '返回值被丢弃（该模块文案拿不到学后胜率）')));

// ── 表四：落盘留痕 —— 推送出去的内容，事后还能不能查到 ────────────────────
console.log('\n【表四】推送留痕：pushlog 里存了什么');
const plog = (() => { try { return JSON.parse(fs.readFileSync('./pushlog.json', 'utf8')); } catch { return []; } })();
const arr = Array.isArray(plog) ? plog : [];
console.log('  pushlog.json 记录数 =', arr.length, '｜字段 =', Object.keys(arr[0] || {}).join(', '));
console.log('  ⚠ 只存标题（首行 40 字），正文全文不落盘 → 事后查不到"当时说了什么"');

console.log('\n════ 扫描结束 ════');
