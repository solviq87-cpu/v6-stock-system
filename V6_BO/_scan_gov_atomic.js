// 占位与送达的原子性体检扫描器（本轮角度：占位先于送达，失败必须能退）。
// 守门测试 _test_gov_atomic.js 只钉住已确认修复的那几处；这个扫描器负责列全：
//   A. 所有占位点（govTake / govFilter）
//   B. 每个占位点之后，那条消息的 pushAll 有没有交 undo 句柄
//   C. govFilter 结果有没有被【直接 slice】截断（被截的票会白占坑）
//   D. 「被拦下就 return」的分支有没有先退占位
//   E. pushAll 的返回值被哪些调用点当成了「送达确认」用
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const code = stripNoise(src, { keepStrings: true });
const L = code.split('\n');
const rawL = src.split('\n');
const lineOf = i => i + 1;

console.log('═══ A. 占位点（govTake / govFilter）═══');
const takes = [];
for (let i = 0; i < L.length; i++) {
  const m = /(govTake|govFilter)\s*\(/.exec(L[i]);
  if (!m) continue;
  takes.push({ kind: m[1], line: lineOf(i), txt: rawL[i].trim().slice(0, 96) });
}
for (const t of takes) console.log(`  ${String(t.line).padStart(5)}  ${t.kind.padEnd(10)} ${t.txt}`);
console.log(`  小计 ${takes.length} 处（govTake ${takes.filter(x => x.kind === 'govTake').length} / govFilter ${takes.filter(x => x.kind === 'govFilter').length}）`);

console.log('\n═══ B. 送达点：pushAll 有没有交 undo 句柄 ═══');
let wired = 0, bare = 0;
for (let i = 0; i < L.length; i++) {
  if (!/pushAll\s*\(/.test(L[i])) continue;
  // pushAll 调用可能跨多行，往后取到本语句结束（括号配对）
  const st = src.split('\n').slice(0, i).join('\n').length + src.split('\n')[i].indexOf('pushAll(');
  let d = 0, end = -1;
  for (let k = st; k < src.length; k++) {
    if (src[k] === '(') d++;
    else if (src[k] === ')') { d--; if (!d) { end = k; break; } }
  }
  const call = end > 0 ? src.slice(st, end + 1) : L[i];
  // ⛔ 判据不能只看文案关键字（"竞价""全市场"这类字样会命中一堆并没有占位的推送，
  //    实测误报 4 处）。真正的判据是：**这条消息之前有没有真的占过坑**
  //    （govTake / govFilter / modDayTake 任一出现在往前 80 行内）。
  // ⛔ 窗口不能越过【所在函数】的上边界 —— 实测 pushTrendScan 会被上面 pushSteadyUp 的
  //    modDayTake 误判成"占过坑"。先往上找到最近的函数声明，只在这个函数体内找占位。
  let fs0 = i;
  for (let k = i - 1; k >= 0; k--) { if (/^\s*(async\s+)?function\s+\w+/.test(L[k])) { fs0 = k; break; } }
  const before = L.slice(fs0, i).join('\n');
  const took = /govTake\(|govFilter\(|modDayTake\(/.test(before);
  if (!took) continue;
  const hasUndo = /undo\s*:/.test(call);
  const hasMod = /modDay\s*:/.test(call);
  if (hasUndo || hasMod) {
    wired++;
    console.log(`  ${String(lineOf(i)).padStart(5)}  ✅ ${[hasUndo ? 'undo' : '', hasMod ? 'modDay' : ''].filter(Boolean).join('+')}  ${call.slice(0, 44).replace(/\n/g, ' ')}…`);
  } else {
    bare++;
    console.log(`  ${String(lineOf(i)).padStart(5)}  ⚠️ 占过坑但没交回滚句柄  ${call.slice(0, 64).replace(/\n/g, ' ')}…`);
  }
}
console.log(`  小计：已接线 ${wired} 处 / 疑似漏接 ${bare} 处`);

console.log('\n═══ C. govFilter 结果是否被直接 slice（被截的票会白占坑）═══');
let c = 0;
for (let i = 0; i < code.length; i++) {
  if (!code.startsWith('govFilter(', i)) continue;
  let d = 0, end = -1;
  for (let k = i + 9; k < code.length; k++) {
    if (code[k] === '(') d++;
    else if (code[k] === ')') { d--; if (!d) { end = k; break; } }
  }
  if (end < 0) continue;
  if (/^\s*\.slice\(/.test(code.slice(end + 1, end + 14))) {
    c++;
    console.log(`  ⚠️ 行 ${code.slice(0, i).split('\n').length}：${code.slice(i, end + 1).slice(0, 80)} → .slice(`);
  }
}
console.log(c ? `  小计 ${c} 处（应改走 govTrim）` : '  ✅ 无（要么不截断，要么已走 govTrim）');

console.log('\n═══ D. 「被拦下就 return」的分支有没有先退占位 ═══');
let d1 = 0;
for (let i = 0; i < L.length; i++) {
  if (!/modDayTake\(/.test(L[i])) continue;
  // 往下 6 行内找 return，看前面有没有 govReleaseAll
  const win = L.slice(i, i + 7).join('\n');
  if (/return/.test(win)) {
    const okRelease = /govReleaseAll\(/.test(win);
    console.log(`  ${String(lineOf(i)).padStart(5)}  ${okRelease ? '✅ 拦下即退' : '· 无占位可退（这道闸在 govFilter 之前，正常）'}  ${rawL[i].trim().slice(0, 80)}`);
    if (okRelease) d1++;
  }
}
console.log(`  小计 ${d1} 处拦下即退`);

console.log('\n═══ E. pushAll 返回值被当成「送达确认」用的点 ═══');
for (let i = 0; i < L.length; i++) {
  if (!/pushAll\(/.test(L[i])) continue;
  if (/!== false|=== true|if \(pushAll|_ok = pushAll|const _\w+Ok = pushAll/.test(L[i] + (L[i + 1] || ''))) {
    console.log(`  ${String(lineOf(i)).padStart(5)}  ${rawL[i].trim().slice(0, 100)}`);
  }
}
console.log('  ⚠️ 提示：pushAll 除【夜间静默】外恒返回 true —— 拿它当送达确认会漏掉所有发送失败；');
console.log('     失败的兜底应走 opts.undo（见 _test_gov_atomic.js）。');

console.log('\n（扫描器只列事实、不做断言；定性结论与修复由 _test_gov_atomic.js 钉死。）');
