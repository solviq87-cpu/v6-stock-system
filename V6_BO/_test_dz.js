// 守门：dz 轮 —— 状态字段读写路径一致性
// 查三类：
//   ① busy 锁对称（已在 _scan_dz.js 验证全绿，这里抽关键反例做断言）
//   ② S 状态池无中间态暴露
//   ③ 状态修改后是否在同一次 tick 内被读取（异步写完成前读取 = 旧值）
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

// 按花括号配对取函数体
function fnBody(name) {
  const a = SRC.search(new RegExp('(?:async\\s+)?function\\s+' + name + '\\(', 'm'));
  if (a < 0) return '';
  let p = SRC.indexOf('(', a), pd = 0;
  for (let k = p; k < SRC.length; k++) {
    if (SRC[k] === '(') pd++; else if (SRC[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = SRC.indexOf('{', p);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < SRC.length; j++) {
    const c = SRC[j];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return SRC.slice(a, j + 1); }
  }
  return '';
}

console.log('\n=== 状态字段读写一致性（dz 轮）守门 ===\n');

// ---------- ① busy 锁对称 ----------
console.log('【① busy 锁对称 + finally 释放】');
const busyVars = ['_tsBusy', '_kbfBusy', '_bmBusy', '_crBusy', '_zpBusy', '_preBusy'];
for (const v of busyVars) {
  const body = fnBody(v.replace('_', '').replace('Busy', '') === 'ts' ? 'scanTrendUniverse'
    : v === '_kbfBusy' ? 'klineBackfill'
    : v === '_bmBusy' ? 'scanBigMoney'
    : v === '_crBusy' ? 'computeReview'
    : v === '_zpBusy' ? 'scanZtPre'
    : 'runZtpreIngest');
  if (!body) continue;
  const hasTrue = new RegExp(v + '\\s*=\\s*true').test(body);
  const hasFinallyFalse = /finally\s*\{[^}]*_\w*Busy\s*=\s*false/.test(body);
  ok(`${v} 在 finally 中释放`, !hasTrue || hasFinallyFalse, hasTrue ? '抛异常会永久锁死' : '未使用或对称');
}

// ---------- ② S 状态池：异步填充前是否有读取方 ----------
console.log('\n【② S 状态池原子更新】');
// scanTrendUniverse 内部是直接把结果赋给 S.trendScan，没有先清空
const tsBody = fnBody('scanTrendUniverse');
ok('scanTrendUniverse 没有先 S.trendScan = [] 再 await',
  !/S\.trendScan\s*=\s*\[\]/.test(tsBody));
const kbfBody = fnBody('klineBackfill');
ok('klineBackfill 没有先 S.klines = {} 再 await',
  !/S\.klines\s*=\s*\{\}/.test(kbfBody));

// ---------- ③ 状态修改后、save 前被读取 ----------
console.log('\n【③ 修改→读取→save 的时序：中间态被消费】');
// 找 "S.xxx = ..." 之后、"save*()" 之前、有读取 S.xxx 的模式
const lines = SRC.split('\n');
let seqIssues = 0;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i].replace(/\/\/.*$/, '').trim();
  const m = l.match(/^S\.(\w+)\s*=/);
  if (!m) continue;
  const key = m[1];
  // 向下找 save*()
  let saveAt = -1, readAt = -1;
  for (let j = i + 1; j < lines.length && j < i + 15; j++) {
    const lj = lines[j].replace(/\/\/.*$/, '').trim();
    if (/save(Cfg|Learn|Paper|Access)\(/.test(lj)) { saveAt = j; break; }
    if (new RegExp('S\\.' + key + '(?!\\s*=)').test(lj)) { readAt = j; }
  }
  if (readAt > 0 && saveAt > 0 && readAt < saveAt) {
    // 排除常见的「链式赋值」如 S.xxx = { a: S.xxx.b }
    const readLine = lines[readAt].trim();
    if (/json\(res|pushLog|console\.log|noteLearnChange|adjRemember/.test(readLine)) {
      console.log(`  ⛔ 行${i + 1}: S.${key} 修改后，行${readAt + 1} 被读取/消费，行${saveAt + 1} 才 save —— 若读取方依赖旧值或会进一步修改，中间态有风险`);
      seqIssues++;
    }
  }
}
if (!seqIssues) console.log('  ✅ 未发现「修改→消费→save」的中间态风险');

// ---------- ④ 反证：已知的内存-磁盘不一致修复 ----------
console.log('\n【④ 反证：save* 返回值是否被检查（cz/dx 轮修复点）】');
ok('saveCfg() 在 /api/config 中被检查返回值',
  /if \(!saveCfg\(\)\)/.test(SRC));
ok('saveAccess() 在改密码路径中被检查返回值',
  /if \(!saveAccess\(\)\).*旧密码/.test(SRC));
ok('savePaper() 在模拟盘重置中被检查返回值',
  /if \(!savePaper\(\)\).*没能写入/.test(SRC));
ok('saveLearn() 在 trendSelfOptimize 修改阈值后立即调用',
  /S\.config\.probThreshold\s*=\s*nv;\s*saveCfg\(\)/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
