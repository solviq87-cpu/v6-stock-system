// 扫描器：ec 轮 —— 「前端-后端契约一致性」（聚焦版）
// 不扫全部键，只扫「新增功能」和「已知修复过」的键对齐情况。
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
const HTML = fs.readFileSync('public/index.html', 'utf8');

console.log('\n=== ec 轮：前后端契约一致性（聚焦版）===\n');

// 辅助：后端是否下发了键 k（在 /api/state 返回块里）
function stateHas(k) {
  const i = SRC.indexOf("if (p === '/api/state')");
  const j = SRC.indexOf('return json(res, {', i);
  const block = SRC.slice(j, j + 8000);
  return new RegExp('\\b' + k + '\\s*:').test(block);
}

// 辅助：前端是否读了键 k（s.k 或 data.k）
function frontReads(k) {
  const re = new RegExp('(?:s|data)\\.' + k + '\\b');
  return re.test(HTML);
}

// 聚焦检查列表：这些是新增或修复过的功能，契约漂移风险最高
const CHECKS = [
  { key: 'learnall',     label: '学习库样本数（ztpre 学习库 n）', backFix: '2026-10-07 补发' },
  { key: 'nextplan',     label: '次日作战计划' },
  { key: 'reviewStale',  label: '复盘是否陈旧' },
  { key: 'ztDay',        label: '涨停池归属日' },
  { key: 'ztDayTag',     label: '涨停池日期标签' },
  { key: 'trendScanBasis', label: '趋势扫描基准日' },
  { key: 'steadyUpBasis',  label: '连续收涨基准日' },
  { key: 'ztPreBasis',   label: '涨停前形态基准日' },
  { key: 'poolBasis',    label: '精选池基准日' },
  { key: 'panelNotes',   label: '面板承诺说明' },
  { key: 'cfgSet',       label: '配置开关' },
  { key: 'cfgRange',     label: '配置范围' },
  { key: 'remedy',       label: '补救状态' },
  { key: 'skipStat',     label: '跳过统计' },
  { key: 'empSkip',      label: '命中率分母存活率' },
  { key: 'probKind',     label: '概率种类' },
  { key: 'stateCut',     label: '状态裁剪' },
  { key: 'staleState',   label: '陈旧状态' },
  { key: 'outN',         label: '输出数量' },
  { key: 'prevSnap',     label: '上一快照' },
  { key: 'pushLast',     label: '最后推送' },
  { key: 'doneRule',     label: '完成规则' },
  { key: 'taskState',    label: '任务状态' },
  { key: 'staleRule',    label: '陈旧规则' },
  { key: 'needRule',     label: '需要规则' },
  { key: 'winRule',      label: '获胜规则' },
];

let issues = 0;
for (const c of CHECKS) {
  const hasBack = stateHas(c.key);
  const hasFront = frontReads(c.key);
  if (hasBack && hasFront) {
    console.log(`  ✅ ${c.key}（${c.label}）: 两端对齐` + (c.backFix ? ` ${c.backFix}` : ''));
  } else if (!hasBack && hasFront) {
    console.log(`  ⛔ ${c.key}（${c.label}）: 前端读、后端没发`);
    issues++;
  } else if (hasBack && !hasFront) {
    console.log(`  ⚠️ ${c.key}（${c.label}）: 后端发、前端没读（可能预留）`);
    // 预留字段不算问题
  } else {
    console.log(`  ℹ️ ${c.key}（${c.label}）: 两端都没用`);
  }
}

// 额外检查：/api/state 里是否有重复的键（后写的覆盖先写的）
console.log('\n【② /api/state 返回对象中的重复键】');
const stateStart = SRC.indexOf("if (p === '/api/state')");
const jsonStart = SRC.indexOf('return json(res, {', stateStart);
const block = SRC.slice(jsonStart, jsonStart + 8000);
const seen = new Set();
let dup = 0;
for (const m of block.matchAll(/(\w+)\s*:/g)) {
  const k = m[1];
  if (seen.has(k)) {
    console.log(`  ⛔ 重复键: ${k} —— 后写的覆盖先写的，改一处漏一处`);
    dup++;
  }
  seen.add(k);
}
if (!dup) console.log('  ✅ 无重复键');

// 额外检查：SSE 精简版是否裁剪了前端需要的键
console.log('\n【③ SSE 精简版键裁剪】');
const sseStart = SRC.indexOf('// SSE 精简版');
if (sseStart > 0) {
  const sseBlock = SRC.slice(sseStart, sseStart + 2000);
  const sseKeys = [...sseBlock.matchAll(/(\w+)\s*:/g)].map(m => m[1]);
  // 检查前端高频读取的键是否在 SSE 里
  const critical = ['pool', 'ztPool', 'review', 'signals', 'auction', 'global', 'sectors'];
  for (const k of critical) {
    const inSse = sseKeys.includes(k);
    const inState = stateHas(k);
    if (!inSse && inState) {
      console.log(`  ⚠️ ${k}: /api/state 下发了但 SSE 精简版里裁掉了——面板 SSE 刷新时该字段会消失`);
    }
  }
} else {
  console.log('  ℹ️ 未找到 SSE 精简版标记');
}

const total = issues + dup;
console.log(`\n【结论】发现 ${total} 处契约不一致`);
process.exit(total ? 1 : 0);
