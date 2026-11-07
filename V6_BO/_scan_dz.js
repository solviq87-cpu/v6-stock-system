// 扫描器：dz 轮 —— 「状态字段的读路径和写路径是不是同一条」
// 重点查三类状态一致性问题：
//   ① busy 锁：设了 true 有没有对称的 false（且必须在 finally 里）
//   ② S 状态池：先清空再 await 填充 = 中间态被读取
//   ③ 日期/计数标记：多处写入口的赋值条件是否一致
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== dz 轮：状态读写路径一致性扫描 ===\n');

// ── ① busy 锁对称性 ──
console.log('【① busy 锁对称性】');
const busyVars = [...SRC.matchAll(/(?:let|const|var)\s+(_\w*Busy\w*)\s*=\s*false/g)].map(m => m[1]);
const uniqueBusy = [...new Set(busyVars)];
console.log('发现 ' + uniqueBusy.length + ' 个 busy 标志: ' + uniqueBusy.join('、'));
let busyIssues = 0;
for (const v of uniqueBusy) {
  const setTrue = (SRC.match(new RegExp(v + '\\s*=\\s*true', 'g')) || []).length;
  // ⛔ 排除初始化声明中的 "= false"
  const initFalse = (SRC.match(new RegExp('(?:let|const|var)\\s+' + v + '\\s*=\\s*false', 'g')) || []).length;
  const setFalse = (SRC.match(new RegExp(v + '\\s*=\\s*false', 'g')) || []).length - initFalse;
  const inFinally = (SRC.match(new RegExp('finally\\s*\\{[^}]*' + v + '\\s*=\\s*false', 'g')) || []).length;
  if (setTrue !== setFalse) {
    console.log(`  ⛔ ${v}: true=${setTrue} 次, false(非初始化)=${setFalse} 次 —— 不对称`);
    busyIssues++;
  } else if (setTrue > 0 && inFinally < setTrue) {
    console.log(`  ⛔ ${v}: 有 ${setTrue} 处设 true，但只有 ${inFinally} 处在 finally 里释 false —— 抛异常会永久锁死`);
    busyIssues++;
  } else {
    console.log(`  ✅ ${v}: true=${setTrue}, false=${setFalse}, finally=${inFinally}`);
  }
}

// ── ② S 状态池中间态 ──
// 查 "S.xxx = []" 或 "S.xxx = {}" 之后，下一个非注释/非空行是不是 await
console.log('\n【② S 状态池：先清空再 await = 中间态暴露】');
const lines = SRC.split('\n');
let midIssues = 0;
for (let i = 0; i < lines.length - 1; i++) {
  const l = lines[i].replace(/\/\/.*$/, '').trim();
  const m = l.match(/^S\.(\w+)\s*=\s*(\[\]|\{\}|null)$/);
  if (!m) continue;
  // 向下找下一个非空非注释行
  let next = '';
  for (let j = i + 1; j < lines.length && j < i + 10; j++) {
    const lj = lines[j].replace(/\/\/.*$/, '').trim();
    if (lj) { next = lj; break; }
  }
  if (/^await\s/.test(next) || /\.then\(/.test(next)) {
    console.log(`  ⛔ 行${i + 1}: S.${m[1]} = ${m[2]} 后紧跟异步操作，中间态可能被读取`);
    midIssues++;
  }
}
if (!midIssues) console.log('  ✅ 未发现「清空后紧跟 await」的中间态模式');

// ── ③ 日期标记的多处写入口条件一致性 ──
console.log('\n【③ 日期标记：多处写入口的赋值条件是否一致】');
const dateVars = ['reviewSentDate', 'auctionSentDate', 'newsSentDate', 'nextplanSentDate'];
let dateIssues = 0;
for (const v of dateVars) {
  const re = new RegExp(v + '\\s*=\\s*todayStr\\(\\)', 'g');
  const matches = [...SRC.matchAll(re)];
  if (matches.length <= 1) continue;
  // 取每个赋值点的前 5 行，看条件
  const contexts = matches.map(m => {
    const lineIdx = SRC.slice(0, m.index).split('\n').length;
    const ctx = lines.slice(Math.max(0, lineIdx - 5), lineIdx).map(l => l.trim()).filter(l => l && !l.startsWith('//'));
    return { line: lineIdx, ctx };
  });
  const conds = contexts.map(c => c.ctx.find(l => /if\s*\(/.test(l)) || '(无显式条件)');
  const allSame = conds.every(c => c === conds[0]);
  if (!allSame) {
    console.log(`  ⛔ ${v}: ${matches.length} 处赋值，条件不一致`);
    contexts.forEach((c, idx) => console.log(`     → 行${c.line}: ${conds[idx]}`));
    dateIssues++;
  } else {
    console.log(`  ✅ ${v}: ${matches.length} 处赋值，条件一致 (${conds[0]})`);
  }
}

// ── ④ 状态对象字段一致性 ──
// 查同一个 S.xxx 在不同赋值点，字段是否一致
console.log('\n【④ 状态对象字段一致性（同键不同值类型）】');
const objAssigns = [...SRC.matchAll(/S\.(\w+)\s*=\s*\{/g)];
const objGroups = {};
for (const m of objAssigns) {
  const key = m[1];
  const i = m.index;
  let d = 0, started = false;
  for (let j = i + m[0].length - 1; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { (objGroups[key] = objGroups[key] || []).push({ txt: SRC.slice(i + m[0].length - 1, j + 1), off: i }); break; } }
  }
}
// 简化：只检查有多个赋值点的对象
let objIssues = 0;
for (const k of Object.keys(objGroups)) {
  if (objGroups[k].length < 2) continue;
  // 提取每个赋值点的顶层键
  const keysPer = objGroups[k].map(o => {
    const txt = o.txt;
    const keys = [];
    let cur = '', d = 0, inStr = null;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (inStr) { if (c === inStr) inStr = null; cur += c; continue; }
      if (c === '"' || c === "'") { inStr = c; cur += c; continue; }
      if (c === '{' || c === '(' || c === '[') d++;
      else if (c === '}' || c === ')' || c === ']') d--;
      if (d === 1 && (c === ',' || c === '\n')) {
        const mm = /^\s*(\w+)\s*:/.exec(cur);
        if (mm) keys.push(mm[1]);
        cur = '';
        continue;
      }
      if (d === 1) cur += c;
    }
    const mm = /^\s*(\w+)\s*:/.exec(cur);
    if (mm) keys.push(mm[1]);
    return keys;
  });
  const allKeys = new Set(keysPer.flat());
  for (let i = 0; i < keysPer.length; i++) {
    const missing = [...allKeys].filter(kk => !keysPer[i].includes(kk));
    if (missing.length) {
      console.log(`  ⛔ S.${k}: 赋值点 ${i + 1} 缺少字段 ${missing.join(',')}`);
      objIssues++;
    }
  }
}
if (!objIssues) console.log('  ✅ 未发现同状态对象字段不一致（或赋值点少于2）');

const total = busyIssues + midIssues + dateIssues + objIssues;
console.log(`\n【结论】发现 ${total} 处状态一致性问题`);
process.exit(total ? 1 : 0);
