// 扫描器：把"往磁盘写"的每一处摊开，看它的成败有没有人管（本轮角度的普查版）。
// 守门测试 _test_disk_state.js 只钉住已修的关键几处，这个负责找还有没有别处中招。
//
// 三块：
//   ① 所有 saveXxx() 调用点：有没有检查返回值。
//      不检查 = 写失败时调用方毫不知情，接口照样回 ok、面板照常显示，
//      而磁盘上还是旧的 —— 这个中间态会一直持续到下次重启才暴露。
//      注：并非每一处都必须检查（定时器里的周期落盘失败一次下轮还会再写），
//      但凡是**会回应用户**的调用点，就必须检查。
//   ② 所有直接 fs.writeFileSync 覆盖目标文件的（非 atomicWrite、非 .tmp）：
//      非原子写 = 写到一半崩掉会在磁盘上留下截断文件。
//      缓存类（K线缓存，下次会重拉）可接受；业务数据与源码不行。
//   ③ 空 catch 包着的写操作：失败连一行日志都没有。
//
// ⛔ 扫描器不是测试：只列可疑点供人工复核，永远 exit 0。
const fs = require('fs');
const path = require('path');
const { stripNoise } = require('./_codescan.js');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const CODE_K = stripNoise(SV, { keepStrings: true });
const lineOf = i => SV.slice(0, i).split('\n').length;
// 从 catch 往前找最近的 try，取块内源码判定块性质（与既有扫描器同一套路）
function blockSrcBefore(i) {
  const s = CODE_K.lastIndexOf('try {', i);
  return s < 0 ? '' : CODE_K.slice(s, i + 40);
}

console.log('=== ① saveXxx() 调用点：返回值有没有人管 ===\n');
{
  const names = ['saveCfg', 'savePaper', 'saveAccess', 'saveLearn', 'saveLearnHistory'];
  let checked = 0, unchecked = 0;
  for (const nm of names) {
    const re = new RegExp('(?![!=]\\s*)\\b' + nm + '\\(\\)', 'g');
    const defRe = new RegExp('(const|function)\\s+' + nm + '\\s*=');
    for (const m of CODE_K.matchAll(re)) {
      const i = m.index;
      if (defRe.test(CODE_K.slice(Math.max(0, i - 40), i + nm.length + 30))) continue; // 定义行
      // 往前 60 字符里有没有 if(! / if ( 之类判定
      const before = CODE_K.slice(Math.max(0, i - 60), i);
      const isChecked = /if\s*\(\s*!/m.test(before) || /if\s*\(\s*!/.test(before);
      const line = lineOf(i);
      const ctx = SV.slice(Math.max(0, i - 70), i + 20).replace(/\s+/g, ' ');
      if (isChecked) { checked++; console.log(`  对勾 L${line}  ${nm}() 已检查  ← …${ctx.slice(-70)}`); }
      else { unchecked++; console.log(`  ⚠️  L${line}  ${nm}() 未检查返回值  ← …${ctx.slice(-70)}`); }
    }
  }
  console.log(`\n  小结：已检查 ${checked} 处 / 未检查 ${unchecked} 处`);
  console.log('  判读口径：定时器里的周期落盘（失败下轮还会再写）可以只留痕；');
  console.log('  凡是会回应用户的调用点（接口里改配置/改模拟盘/改密码/改设备授权）必须检查并如实回错。');
}

console.log('\n=== ② 非原子写：直接 writeFileSync 覆盖目标文件 ===\n');
{
  const hits = [];
  for (const m of CODE_K.matchAll(/fs\.writeFileSync\(([^\n]{0,120})/g)) {
    const arg = m[1];
    if (/\.tmp/.test(arg)) continue;                 // atomicWrite 内部
    const isCache = /KLINE_CACHE|cf,|cf\)/.test(arg); // K线缓存（可自愈）
    const isBak = /\.bak/.test(arg);
    hits.push({ line: lineOf(m.index), arg: arg.replace(/\s+/g, ' ').slice(0, 80), isCache, isBak });
  }
  for (const h of hits) {
    const kind = h.isCache ? '缓存类（可自愈，接受）' : (h.isBak ? '备份' : '⚠️ 业务/源码（必须原子）');
    console.log(`  L${h.line}  ${kind}\n       ${h.arg}`);
  }
  if (!hits.length) console.log('  对勾 无。');
}

console.log('\n=== ③ 空 catch 包着写操作（失败连日志都没有）===\n');
{
  const hits = [];
  for (const m of CODE_K.matchAll(/catch\s*\{\s*\}|catch\s*\(\s*\)\s*\{\s*\}|catch\s*\(\s*_\s*\)\s*\{\s*\}/g)) {
    const blk = blockSrcBefore(m.index);
    if (!/writeFileSync|atomicWrite|save[A-Z]/.test(blk)) continue;
    hits.push({ line: lineOf(m.index), src: blk.replace(/\s+/g, ' ').slice(0, 110) });
  }
  if (!hits.length) console.log('  对勾 无。');
  else for (const h of hits) console.log(`  ⚠️ L${h.line}\n       ${h.src}`);
}

console.log('\n（扫描器只列可疑点，不做断言，退出码恒为 0）');
process.exit(0);
