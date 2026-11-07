// 守门：ec 轮 —— 前后端契约一致性
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
const HTML = fs.readFileSync('public/index.html', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

// 后端 /api/state 返回块（顶层）
// ⛔ 2026-10-28 改：原来按「payload 起点后 8000 字」硬切窗口 —— payload 长过 8000 字之后
//    排在末尾的键（skipStat / empSkip）就落在窗口外，被判「后端没发」而假红。
//    现在按花括号配对取完整对象（跳过字符串/模板串里的括号），与 state_field_parity 同一手法。
const stateStart = SRC.indexOf("if (p === '/api/state')");
const jsonStart = SRC.indexOf('return json(res, {', stateStart);
const block = (() => {
  const bStart = SRC.indexOf('{', jsonStart);
  let d = 0, inStr = null;
  for (let i = bStart; i < SRC.length; i++) {
    const ch = SRC[i], prev = i > 0 ? SRC[i - 1] : '';
    if (inStr) { if (ch === inStr && prev !== '\\') inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return SRC.slice(bStart, i + 1); }
  }
  return SRC.slice(jsonStart, jsonStart + 8000);   // 兜底：配不上就退回旧窗口（不静默变空）
})();

function stateHas(k) {
  return new RegExp('\\b' + k + '\\s*:').test(block);
}
function frontReads(k) {
  return new RegExp('(?:s|data)\\.' + k + '\\b').test(HTML);
}

console.log('\n=== 前后端契约一致性（ec 轮）守门 ===\n');

// ① 新增/修复功能键对齐
console.log('【① 新增/修复功能的键对齐】');
const CHECKS = [
  { k: 'learnall',     label: '学习库样本数' },
  { k: 'nextplan',     label: '次日作战计划' },
  { k: 'reviewStale',  label: '复盘陈旧标记' },
  { k: 'ztDay',        label: '涨停池归属日' },
  { k: 'ztDayTag',     label: '涨停池日期标签' },
  { k: 'trendScanBasis', label: '趋势扫描基准日' },
  { k: 'steadyUpBasis',  label: '连续收涨基准日' },
  { k: 'ztPreBasis',   label: '涨停前形态基准日' },
  { k: 'poolBasis',    label: '精选池基准日' },
  { k: 'panelNotes',   label: '面板承诺说明' },
  { k: 'cfgSet',       label: '配置开关' },
  { k: 'cfgRange',     label: '配置范围' },
  { k: 'remedy',       label: '补救状态' },
  { k: 'skipStat',     label: '跳过统计' },
  { k: 'empSkip',      label: '命中率存活率' },
  { k: 'probKind',     label: '概率种类' },
  { k: 'stateCut',     label: '状态裁剪' },
  { k: 'staleState',   label: '陈旧状态' },
  { k: 'outN',         label: '输出数量' },
  { k: 'prevSnap',     label: '上一快照' },
  { k: 'pushLast',     label: '最后推送' },
  { k: 'doneRule',     label: '完成规则' },
  { k: 'taskState',    label: '任务状态' },
  { k: 'staleRule',    label: '陈旧规则' },
  { k: 'needRule',     label: '需要规则' },
  { k: 'winRule',      label: '获胜规则' },
];
for (const c of CHECKS) {
  ok(`${c.label}（${c.k}）两端对齐`, stateHas(c.k) && frontReads(c.k),
    stateHas(c.k) ? '后端发了前端没读' : '前端读了后端没发');
}

// ② 反证：已知的事故修复
console.log('\n【② 反证：已知契约漂移修复】');
ok('learnall.n 后端补发（前端曾永远显示 0）',
  /learnall:\s*\{\s*n:/.test(SRC));
ok('reviewDataDay 被 mkReviewShell 调用（日期不冒充今天）',
  /reviewDataDay\(\)/.test(SRC));
ok('quoteBasis 返回 isToday + stale（面板可标注）',
  /stale:\s*!fresh\s*\|\|\s*!isToday/.test(SRC));

// ③ 重复键检查（只查顶层，排除嵌套对象）
console.log('\n【③ /api/state 顶层重复键】');
// 提取顶层键：从 jsonStart 后的第一个 { 开始，只 depth=1 的键
let d = 0, started = false, cur = '';
const topKeys = [];
for (let i = jsonStart; i < SRC.length && i < jsonStart + 8000; i++) {
  const c = SRC[i];
  if (c === '{') { d++; started = true; cur = ''; continue; }
  if (c === '}') { d--; if (started && d === 0) break; }
  if (!started) continue;
  if (d === 1 && (c === ',' || c === '\n')) {
    const m = /^\s*(\w+)\s*:/.exec(cur);
    if (m) topKeys.push(m[1]);
    cur = '';
    continue;
  }
  if (d === 1) cur += c;
}
const seen = new Set();
let dup = false;
for (const k of topKeys) {
  if (seen.has(k)) { dup = true; console.log(`  ❌ 顶层重复键: ${k}`); }
  seen.add(k);
}
ok('无顶层重复键', !dup);

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
