// 守门：eg 轮 —— 启动链与定时器对应完整性
const fs = require('fs');
const SRC = fs.readFileSync('server.js', 'utf8');
let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

console.log('\n=== 启动链与定时器对应完整性（eg 轮）守门 ===\n');

// ---------- ① 启动链四个模块均有定时器 ----------
console.log('【① 启动链与定时器对应】');
ok('refreshSectorsZT 有定时器', /setInterval\(.*refreshSectorsZT/.test(SRC));
ok('rebuildPool 有定时器', /setInterval\(.*rebuildPool/.test(SRC));
ok('refreshGlobal 有定时器', /setInterval\(.*refreshGlobal/.test(SRC));
ok('captureAuction 有启动链或主循环驱动', /initStep\(['"]竞价快照['"].*captureAuction/.test(SRC) || /tick\(\).*auction|auction.*tick\(\)/.test(SRC));

// ---------- ② 定时器有 guard 防重入 ----------
console.log('\n【② 定时器 guard 防重入】');
ok('sectorsZT 定时器有 guard', /setInterval\(guard\(['"]sectorsZT['"]/.test(SRC));
ok('allStocks 定时器有 guard', /setInterval\(guard\(['"]allStocks['"]/.test(SRC));
ok('pool 定时器有 guard', /setInterval\(guard\(['"]pool['"]/.test(SRC));
ok('global 定时器有 guard', /setInterval\(guard\(['"]global['"]/.test(SRC));
ok('similar 定时器有 guard', /setInterval\(guard\(['"]similar['"]/.test(SRC));
ok('pre 定时器有 guard', /setInterval\(guard\(['"]pre['"]/.test(SRC));
ok('holdings 定时器有 guard', /setInterval\(guard\(['"]holdings['"]/.test(SRC));
ok('bigMoney 定时器有 guard（或立即执行）', /setInterval\(.*scanBigMoney/.test(SRC) || /scanBigMoney\(true\)\.catch/.test(SRC));

// ---------- ③ 首次扫描口径与定时器一致 ----------
console.log('\n【③ 首次扫描守门口径】');
// similar 首次扫描
ok('similar 首次扫描有数据窗口+交易时段+非静默守门',
  /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!\(isDataWindow\(\)\s*&&\s*isTradingTime\(\)\s*&&\s*!inQuietHours\(\)\)\)/.test(SRC));
// pre 首次扫描
ok('pre 首次扫描有数据窗口+交易时段+非静默守门',
  /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!\(isDataWindow\(\)\s*&&\s*isTradingTime\(\)\s*&&\s*!inQuietHours\(\)\)\)[\s\S]*?scanPrePush/.test(SRC));
// holdings 首次扫描
ok('holdings 首次扫描有交易日守门',
  /setTimeout\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!isTradeDay/.test(SRC) && /HD\.watch/.test(SRC));

// ---------- ④ /api/refresh 使用同一把锁 ----------
console.log('\n【④ /api/refresh 锁名对齐】');
const refreshMatch = SRC.match(/if\s*\(\s*p\s*===\s*['"]\/api\/refresh['"]\s*&&\s*req\.method\s*===\s*['"]POST['"]\s*\)/);
if (refreshMatch) {
  const start = refreshMatch.index;
  let d = 0, block = '', started = false;
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { block = SRC.slice(start, j + 1); break; } }
  }
  ok('/api/refresh 用 _g 接 guard', /const _g\s*=/.test(block));
  ok('/api/refresh 跳过 busy 模块', /_taskBusy\.has/.test(block));
  ok('/api/refresh 被跳过的模块回传前端', /skipped/.test(block));
} else {
  ok('/api/refresh 用 _g 接 guard', false, '找不到 /api/refresh');
  ok('/api/refresh 跳过 busy 模块', false, '找不到 /api/refresh');
  ok('/api/refresh 被跳过的模块回传前端', false, '找不到 /api/refresh');
}

// ---------- ⑤ ED_MODS / RO_MODS 覆盖 ----------
console.log('\n【⑤ /api/refresh 权限分级】');
ok('RO_MODS 存在', /const RO_MODS\s*=/.test(SRC));
ok('ED_MODS 存在', /const ED_MODS\s*=/.test(SRC));
ok('只读请求 ED_MODS 被拦', /!_rfEdit\s*&&\s*ED_MODS\.indexOf\(mod\)/.test(SRC));
ok('_want 降级只读到 RO_MODS', /_rfEdit\s*\|\|\s*ED_MODS\.indexOf\(m\)\s*<\s*0/.test(SRC));

console.log('\n【结果】' + pass + ' 通过 / ' + fail + ' 失败');
console.log(fail ? 'RESULT: FAIL' : 'RESULT: OK');
process.exit(fail ? 1 : 0);
