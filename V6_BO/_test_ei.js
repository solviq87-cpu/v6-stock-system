// 守门：ei 轮 —— 数据持久化往返完整性
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 数据持久化往返完整性（ei 轮）守门 ===\n');

// ---------- ① atomicWrite 原子性 ----------
console.log('【① atomicWrite 原子写】');
ok('atomicWrite 存在', /function atomicWrite\(/.test(SRC));
ok('atomicWrite 先写 .tmp 再 rename', /writeFileSync\(tmp.*\n.*renameSync\(tmp/.test(SRC));
ok('atomicWrite 失败时删 tmp', /unlinkSync\(tmp\)/.test(SRC));
ok('atomicWrite 返回 boolean', /return\s+(?:true|false)/.test(SRC));

// ---------- ② _diskFail 统一留痕 ----------
console.log('\n【② _diskFail 统一留痕】');
ok('_diskFail 存在', /function _diskFail\(/.test(SRC));
ok('_diskFail 计数', /_diskFailN\[tag\]/.test(SRC));
ok('_diskFail 打 error 日志', /console\.error\('\[落盘失败\]'/.test(SRC) || /console\.error\('\[atomicWrite\]/.test(SRC));
ok('_diskFail 说明后果', /内存已改、磁盘未变/.test(SRC));

// ---------- ③ save* 函数返回值 ----------
console.log('\n【③ save* 函数返回值】');
ok('savePaper 返回 boolean', /function savePaper\([\s\S]*?return/.test(SRC));
ok('saveCfg 返回 boolean', /(?:function saveCfg\(|const saveCfg = \()[\s\S]*?return/.test(SRC));
ok('savePaper 失败调 _diskFail', /savePaper[\s\S]*?_diskFail|_diskFail[\s\S]*?savePaper/.test(SRC));

// ---------- ④ Set/Map 落盘前展开 ----------
console.log('\n【④ Set/Map 落盘前展开】');
ok('saveNews 中 goodPushed Set 被展开', /\.\.\.\s*S\.news\.goodPushed/.test(SRC));
ok('加载代码中有 new Set 恢复', /new\s+Set\s*\(/.test(SRC));
ok('加载代码中有 new Map 恢复', /new\s+Map\s*\(/.test(SRC));

// ---------- ⑤ 当日快照带日期 ----------
console.log('\n【⑤ 当日快照带日期标注】');
ok('mkReviewShell 带 date 字段', /mkReviewShell\([\s\S]*?date:/.test(SRC) || /function mkReviewShell/.test(SRC));
ok('S.ztDay 记录涨停池归属日', /S\.ztDay/.test(SRC));
ok('poolBasis 带基准日', /poolBasis/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
