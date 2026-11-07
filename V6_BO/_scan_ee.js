// 扫描器：ee 轮 —— 「兜底值与空值语义的一致性」
// 查三类：
//   ① 清空结果池是否一律走 marketReady() 闸门
//   ② Number(x) || 0 在关键路径上是否把「不知道」变成「0」
//   ③ panelNotes 承诺的数字与代码实际常量是否一致
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');

console.log('\n=== ee 轮：兜底值与空值语义一致性扫描 ===\n');

// ── ① 清空结果池是否走 marketReady() ──
console.log('【① 清空结果池的 marketReady() 闸门】');
// 搜 "S.xxx = { ... empty:" 这类清空模式
const emptyAssigns = [...SRC.matchAll(/S\.([a-zA-Z_]+)\s*=\s*\{[^}]*empty:\s*emptyWhyOf\(/g)];
let ee1 = 0;
for (const m of emptyAssigns) {
  const line = SRC.slice(0, m.index).split('\n').length;
  const ctx = SRC.split('\n').slice(Math.max(0, line - 3), line).join('\n');
  if (!/if\s*\(\s*marketReady\(\)\s*\)/.test(ctx)) {
    console.log(`  ⛔ 行${line}: S.${m[1]} = {empty:...} 没有 marketReady() 保护`);
    ee1++;
  }
}
if (!ee1) console.log('  ✅ 所有 empty 赋值都有 marketReady() 保护');

// ── ② Number(x) || 0 陷阱 ──
console.log('\n【② Number(x) || 0 陷阱（关键路径）】');
const numOrZeros = [...SRC.matchAll(/Number\s*\(\s*([^)]+)\s*\)\s*\|\|\s*0/g)];
let ee2 = 0;
for (const m of numOrZeros) {
  const line = SRC.slice(0, m.index).split('\n').length;
  const expr = m[1].trim();
  // 排除已知的安全模式：计数器/时间戳/金额（这些字段不存在时 0 是合理兜底）
  const isSafe = /fail|count|ms|ts|t\b|amount|fee|cash|realized|pnl|shares|volume|cap|elapsed|added|dropped|total\b|progress|scanned|live|raw\b|sec\b|from|f\(|DATA_CAP|buyTs|turnover|lastPush|tradesDropped|initial|nx\.n/.test(expr);
  if (!isSafe) {
    console.log(`  ⚠️ 行${line}: Number(${expr}) || 0 —— 确认「不存在」时 0 是正确语义`);
    ee2++;
  }
}
if (!ee2) console.log('  ✅ 所有 Number(x)||0 均在已知安全字段上');

// ── ③ panelNotes 承诺与常量一致性 ──
console.log('\n【③ panelNotes 承诺与代码常量一致性】');
let ee3 = 0;
// 从 panelNotes 函数体提取
const pnMatch = SRC.match(/function panelNotes\(\)\s*\{([\s\S]*?)\n\}/);
const pnBody = pnMatch ? pnMatch[1] : '';
// 检查 BUZHANG_PUSH_PROB
if (pnBody.includes('BUZHANG_PUSH_PROB')) {
  const bbpMatch = SRC.match(/const BUZHANG_PUSH_PROB\s*=\s*(\d+)/);
  const bbpInPn = pnBody.match(/\$\{BUZHANG_PUSH_PROB\}/);
  if (bbpMatch && bbpInPn) {
    // 正常：panelNotes 引用了常量
  } else if (!bbpInPn) {
    console.log('  ⚠️ panelNotes 没有引用 BUZHANG_PUSH_PROB 常量');
    ee3++;
  }
}
// 检查 ZT_INFER_PUSH_PROB
if (pnBody.includes('ZT_INFER_PUSH_PROB')) {
  const ztipMatch = SRC.match(/const ZT_INFER_PUSH_PROB\s*=\s*(\d+)/);
  const ztipInPn = pnBody.match(/\$\{ZT_INFER_PUSH_PROB\}/);
  if (ztipMatch && ztipInPn) {
    // 正常
  } else if (!ztipInPn) {
    console.log('  ⚠️ panelNotes 没有引用 ZT_INFER_PUSH_PROB 常量');
    ee3++;
  }
}
// 检查 buzhangN 与 buzhang 文案中的数字是否一致
const buzhangN = pnBody.match(/buzhangN:\s*(\d+)/);
const buzhangTxt = pnBody.match(/buzhang:\s*`[^`]*(\d+)[^`]*`/);
if (buzhangN && buzhangTxt) {
  if (buzhangN[1] !== buzhangTxt[1]) {
    console.log(`  ⛔ panelNotes buzhangN(${buzhangN[1]}) 与 buzhang 文案数字(${buzhangTxt[1]}) 不一致`);
    ee3++;
  }
}
const ztInferN = pnBody.match(/ztInferN:\s*(\d+)/);
const ztInferTxt = pnBody.match(/ztInfer:\s*`[^`]*(\d+)[^`]*`/);
if (ztInferN && ztInferTxt) {
  if (ztInferN[1] !== ztInferTxt[1]) {
    console.log(`  ⛔ panelNotes ztInferN(${ztInferN[1]}) 与 ztInfer 文案数字(${ztInferTxt[1]}) 不一致`);
    ee3++;
  }
}
if (!ee3) console.log('  ✅ panelNotes 数字承诺与常量一致');

// ── ④ CFG_SET 的 def 与注释是否对得上 ──
console.log('\n【④ CFG_SET 默认值与注释一致性】');
let ee4 = 0;
const cfgSetMatch = SRC.match(/const CFG_SET\s*=\s*\{([\s\S]*?)\n\};/);
if (cfgSetMatch) {
  const csBody = cfgSetMatch[1];
  // viewIdleHours: note 说"填 0 或非法值按 24 走"，但 def 是 24 —— 这是对的
  // 检查是否有 note 提到的默认值与 def 不一致
  const entries = [...csBody.matchAll(/(\w+):\s*\{[\s\S]*?def:\s*([^,\s]+)[\s\S]*?note:\s*'([^']*)'/g)];
  for (const e of entries) {
    const key = e[1], def = e[2], note = e[3];
    if (note.includes('按') && note.includes('走')) {
      const implied = note.match(/按\s*(\d+)\s*走/);
      if (implied && implied[1] !== def) {
        console.log(`  ⛔ CFG_SET.${key} def=${def} 但 note 说按 ${implied[1]} 走`);
        ee4++;
      }
    }
  }
}
if (!ee4) console.log('  ✅ CFG_SET 默认值与注释一致');

const total = ee1 + ee2 + ee3 + ee4;
console.log(`\n【结论】发现 ${total} 处兜底值一致性问题`);
process.exit(total ? 1 : 0);
