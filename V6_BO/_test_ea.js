// 守门：ea 轮 —— 时间边界条件
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 时间边界条件（ea 轮）守门 ===\n');

// ---------- ① 复盘/计划路径用 reviewDataDay 而非 todayStr ----------
console.log('【① 复盘数据的日期归属】');
// mkReviewShell 生成快照时必须写 reviewDataDay()，buildReviewMessage 读 S.review.date
const mrs = (() => {
  const i = SRC.indexOf('function mkReviewShell(');
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  return '';
})();
ok('mkReviewShell 存在', mrs.length > 50);
ok('mkReviewShell 的 date 走 reviewDataDay()',
  /reviewDataDay\(\)/.test(mrs),
  '仍用 todayStr() → 早上 9 点刷会标成今天，实际是昨天收盘数据');

// ---------- ② 行情快照基准日走 quoteDayOf ----------
console.log('\n【② 行情快照基准日】');
ok('setAllStocks 内更新 S.stocksAt（拉取时刻）',
  /S\.stocksAt\s*=\s*Date\.now\(\)/.test(SRC));
ok('quoteBasis 用 quoteDayOf(S.stocksAt) 而非 todayStr()',
  /quoteDayOf\(at\)/.test(SRC));

// ---------- ③ nextTradeDay 空串保护 ----------
console.log('\n【③ nextTradeDay 空串保护】');
const ntdBlk = (() => {
  const i = SRC.indexOf("const _applyDate = nextTradeDay()");
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1); }
  }
  return SRC.slice(i, i + 400);
})();
ok('nextTradeDay 返回值用于 applyDate',
  ntdBlk.length > 10);
ok('⛔ nextTradeDay 返回空串时有兜底文案（不能留空）',
  /_applyDate\s*\|\|/.test(ntdBlk) || /if\s*\(!_applyDate\)/.test(ntdBlk) || /nextTradeDay\(\)\s*\|\|/.test(ntdBlk),
  '节假日表异常时 applyDate 为空，正文首行会出现空日期');

// ---------- ④ 日期格式一致性 ----------
console.log('\n【④ 日期格式一致性】');
// todayStr 与 isTradeDay 内部格式：isTradeDay 构造 'YYYY-MM-DD'，todayStr 返回 'YYYYMMDD'
// 关键：两者不能直接比较，必须通过 normDate 转换
ok('存在 normDate 统一转换',
  /function normDate\(/.test(SRC));
ok('S.marketBeta 键用 normDate(todayStr())',
  /normDate\(todayStr\(\)\)/.test(SRC));
ok('S.breadth 键用 normDate(todayStr())',
  /S\.breadth\[normDate\(todayStr\(\)\)\]/.test(SRC));

// ---------- ⑤ 凌晨边界：定时器在 isTradeDay 后是否依赖「今天数据已就绪」 ----------
console.log('\n【⑤ 凌晨边界：数据就绪假设】');
// _reviewStartupCheck 在 2min/8min 触发，若凌晨 00:30 重启，isTradeDay(new Date())=true
// 但涨停池可能还没回来（需要等 9:15 后才有）—— 这个已有 reviewNoPool 的 remedySkip 处理
ok('复盘补发在 0 条时登记 reviewNoPool（数据没回来）',
  /reviewNoPool/.test(SRC));
ok('启动首扫在学习库为空时登记 bootScanNoDb',
  /bootScanNoDb/.test(SRC));

// ---------- ⑥ 反证：已知事故场景 ----------
console.log('\n【⑥ 反证：国庆假期 width 冒充当天】');
// 2026-10-01~10-07 的 marketBeta/breadth 全是 9/30 的数据——这个已在 da 轮修复
ok('quoteBasis 同时检查 fresh 和 isToday',
  /stale:\s*!fresh\s*\|\|\s*!isToday/.test(SRC));
ok('breadth 写入时带 day 字段（computeBreadth 里 b.day = _qb.day）',
  /day:\s*_qb\.day/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
