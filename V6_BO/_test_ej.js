// 守门：ej 轮 —— 内存泄漏与资源清理
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 内存泄漏与资源清理（ej 轮）守门 ===\n');

// ---------- ① K 线缓存 TTL ----------
console.log('【① K 线缓存 TTL】');
ok('KLINE_MEM_TTL 定义', /const KLINE_MEM_TTL\s*=/.test(SRC));
ok('K 线缓存有清理循环', /for.*_klineAt.*KLINE_MEM_TTL/.test(SRC));
ok('klines 与 _klineAt 同步删', /S\.klines\.delete.*_klineAt\.delete/.test(SRC));

// ---------- ② 资金流历史清理 ----------
console.log('\n【② 资金流历史清理】');
ok('inflowHistory 有 TTL 清理', /inflowHistory\.delete/.test(SRC));
ok('inflowHistory 清理判据是 10 分钟', /10\s*\*\s*60\s*\*\s*1000/.test(SRC));

// ---------- ③ guard 锁释放 ----------
console.log('\n【③ guard 锁释放】');
ok('guard 有 try/finally', /function guard\([\s\S]*?try[\s\S]*?finally/.test(SRC));
ok('guard finally 中 delete _taskBusy', /finally\s*\{[^}]*_taskBusy\.delete/.test(SRC));

// ---------- ④ Set/Map 上限 ----------
console.log('\n【④ Set/Map 上限控制】');
ok('goodPushed Set 有 600 上限截断', /goodPushed\.size\s*>\s*600/.test(SRC));
ok('goodPushed 截断后重建 Set', /new\s+Set\(\[\.\.\.S\.news\.goodPushed\]\.slice\(-600\)\)/.test(SRC));

// ---------- ⑤ 推送日志上限 ----------
console.log('\n【⑤ 推送日志上限】');
ok('PUSH_LOG 有上限', /PUSH_LOG\.length\s*>/.test(SRC));
ok('PUSH_LOG 上限走 dataCapOf', /dataCapOf\(['"]pushLog['"]\)/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
