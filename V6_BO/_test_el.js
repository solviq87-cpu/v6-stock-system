// 守门：el 轮 —— 常量定义与魔数消除
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 常量定义与魔数消除（el 轮）守门 ===\n');

// ---------- ① 时间常数集中定义 ----------
console.log('【① 时间常数集中定义】');
ok('TICK_MS 定义', /const TICK_MS\s*=/.test(SRC));
ok('SECTORS_ZT_MS 定义', /const SECTORS_ZT_MS\s*=/.test(SRC));
ok('BIGMONEY_SCAN_MS 定义', /const BIGMONEY_SCAN_MS\s*=/.test(SRC));
ok('POOL_REBUILD_MS 定义', /const POOL_REBUILD_MS\s*=/.test(SRC));
ok('HOLD_WATCH_MS 定义', /const HOLD_WATCH_MS\s*=/.test(SRC));

// ---------- ② panelNotes 引用常量 ----------
console.log('\n【② panelNotes 引用常量而非写死】');
ok('panelNotes 引用 TICK_MS', /panelNotes.*TICK_MS/.test(SRC) || /tick.*TICK_MS/.test(SRC));
ok('panelNotes 引用 BIGMONEY_SCAN_MS', /panelNotes.*BIGMONEY_SCAN_MS/.test(SRC) || /bigmoney.*BIGMONEY_SCAN_MS/.test(SRC));
ok('panelNotes 引用 POOL_REBUILD_MS', /panelNotes.*POOL_REBUILD_MS/.test(SRC) || /pool.*POOL_REBUILD_MS/.test(SRC));
ok('panelNotes 引用 HOLD_WATCH_MS', /panelNotes.*HOLD_WATCH_MS/.test(SRC) || /hold.*HOLD_WATCH_MS/.test(SRC));

// ---------- ③ 阈值常数 ----------
console.log('\n【③ 阈值常数定义】');
ok('BUZHANG_PUSH_PROB 定义', /const BUZHANG_PUSH_PROB\s*=/.test(SRC));
ok('ZT_INFER_PUSH_PROB 定义', /const ZT_INFER_PUSH_PROB\s*=/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
