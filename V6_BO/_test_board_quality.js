// 守门：涨停池封板质量（ed 轮，2026-10-17）
// 钉语义不钉数字：验证 boardQualityOf 的「缺失不归非硬板、硬板率分母不含缺失票」语义，
//   以及 marketMood/速览页/摘要推送三处都从同一源头消费、不进降级闸门。
// ⛔ 抠 boardQualityOf 函数体用 new Function 真跑，测的是生产代码本身，不是复制品。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const MOB = fs.readFileSync(path.join(ROOT, 'public', 'mobile.html'), 'utf8');
const IDX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const PUB = fs.readFileSync(path.join(ROOT, '_publish.py'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); };
};

// 剥掉 // 行内注释，避免版本注释链里的历史散文干扰「活代码」判断
const JS = SRV.replace(/\/\/.*$/gm, '');

// ===== ① 抠 boardQualityOf 函数体真跑（测生产代码本身，非复制品）=====
let bq = null;
const m = /function boardQualityOf\(pool\)\s*\{([\s\S]*?)\n\}/.exec(SRV);
if (!m) {
  ok('server.js 有 boardQualityOf 纯函数', false);
} else {
  try { bq = new Function('pool', m[1]); ok('boardQualityOf 函数体可抠出并可 new Function 编译', true); }
  catch (e) { ok('boardQualityOf 函数体可抠出并可 new Function 编译', false, String(e && e.message)); }
}

if (bq) {
  const r1 = bq([{ code: 'a', breakCount: 0 }, { code: 'b', breakCount: 0 }, { code: 'c', breakCount: 2 }]);
  ok('混合池：2 硬板 + 1 开板回封（breakCount=2 也算弱板），硬板率 67%',
    r1.hard === 2 && r1.weak === 1 && r1.missing === 0 && r1.hardRate === 67, JSON.stringify(r1));

  const r2 = bq([{ code: 'a', breakCount: 0 }, { code: 'b', breakCount: 0 }]);
  ok('全硬板：硬板率 100%', r2.hard === 2 && r2.weak === 0 && r2.hardRate === 100, JSON.stringify(r2));

  const r3 = bq([{ code: 'a', breakCount: 0 }, { code: 'b' }, { code: 'c', breakCount: null }, { code: 'd', breakCount: 'x' }]);
  ok('缺失票单列 missing、不归「非硬板」：1 硬板 + 0 弱 + 3 缺失，硬板率 100%（分母只含有数据票）',
    r3.hard === 1 && r3.weak === 0 && r3.missing === 3 && r3.hardRate === 100, JSON.stringify(r3));

  const r4 = bq([]);
  ok('空池：hardRate=null（判不出，不冒充 0%）', r4.hard === 0 && r4.weak === 0 && r4.missing === 0 && r4.hardRate === null, JSON.stringify(r4));

  const r5 = bq(null);
  ok('非数组输入：等价空池不抛错', r5.hard === 0 && r5.hardRate === null, JSON.stringify(r5));

  const r6 = bq([{ code: 'a', breakCount: 0 }, { code: 'b', breakCount: 1 }, { code: 'c', breakCount: 0 }, { code: 'd', breakCount: 0 }]);
  ok('硬板率四舍五入：3/4=75%', r6.hardRate === 75, JSON.stringify(r6));
}

// ===== ② 唯一计算源 + 三处同源消费 =====
const bqCalls = (JS.match(/boardQualityOf/g) || []).length;
ok('boardQualityOf 只有「定义 + marketMood 一处调用」两处（不进闸门/别处另算）', bqCalls === 2, '实际 ' + bqCalls + ' 处');
ok('marketMood 调用 boardQualityOf（唯一计算源）', JS.includes('boardQualityOf(S.ztPool)'));
ok('marketMood return 含 boardHardRate', JS.includes('boardHardRate: _bq.hardRate'));
ok('marketMood evidence 含「涨停池封板」', /涨停池封板/.test(JS));
ok('buildMobileDigest 下发 boardHardRate（速览页同源）', JS.includes('boardHardRate: mood.boardHardRate'));
ok('buildDigestMessage 摘要含「封板质量」', JS.includes('封板质量'));

// ===== ③ 前端 =====
ok('mobile.html 情绪卡展示硬板率', MOB.includes('硬板率'));

// ===== ④ 版本一致 =====
const verOf = src => { const mm = /const APP_VER = '(\d{8}[a-z]{2})'/.exec(src); return mm ? mm[1] : ''; };
const vSrv = verOf(SRV), vIdx = verOf(IDX);
ok('APP_VER 两端一致', vSrv && vSrv === vIdx, `server=${vSrv} index=${vIdx}`);

// ===== ⑤ 发布包带守门 =====
ok('_publish.py CODE_FILES 含 _test_board_quality.js', PUB.includes('_test_board_quality.js'));

console.log(`_test_board_quality(涨停池封板质量): ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
