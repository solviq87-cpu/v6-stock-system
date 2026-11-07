/**
 * 守门测试：竞价快照持久化（2026-10-27 mp 轮，#327 数据准确性自检实证）
 *
 * 事故链：16:30:12 巡检「✅ 竞价快照归属日合理 20261027」→ 16:49 服务重启 →
 *       「⚠️ 竞价快照无归属日」重复 19 次直到 19:54。根因：S.auction 唯一写入点
 *       captureAuction，纯内存无落盘；15:30 后 auctionCaptureAllowed=false 不重算
 *       （jb/kc 冻结设计本身正确），于是任何盘后重启都丢光竞价面板，巡检⑥同步误报。
 *
 * 修法：照 strategy_cards.json 同模式补 atomicWrite 落盘 + 启动恢复：
 *   · saveAuctionSnapshot 唯一入口，算空不许覆盖（空数据覆盖会把可用旧档抹成空白）
 *   · loadAuctionSnapshot 只在内存为空时恢复（实时数据永远优先）
 *
 * 本测试钉四件事：
 *   ① 静态：三个定义点齐全（常量/保存/恢复），归属日口径注释在位
 *   ② 静态：save 只在 captureAuction 末尾调一次；load 只在启动恢复链调一次
 *   ③ 动态：roundtrip（注入桩真跑保存→清空→恢复，字段不丢）
 *   ④ 动态：空快照不覆盖、内存已有不恢复（两个防误覆盖语义）
 */
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const SRC = SV.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg + (extra ? '  → ' + extra : '')); }
}

console.log('\n=== 竞价快照持久化守门（盘后重启不丢竞价面板 / #327 巡检⑥不误报"无归属日"）===\n');

console.log('【① 静态：定义点齐全】');
ok(/const AUCTION_SNAPSHOT_FILE = path\.join\(__dirname, 'auction_snapshot\.json'\)/.test(SV), 'AUCTION_SNAPSHOT_FILE 常量已定义');
ok(/function saveAuctionSnapshot\(\)/.test(SV), 'saveAuctionSnapshot 已定义');
ok(/function loadAuctionSnapshot\(\)/.test(SV), 'loadAuctionSnapshot 已定义');
ok(/算空不许覆盖/.test(SV), '「算空不许覆盖」纪律注释在位（同 strategy_cards 口径）');
ok(/只在内存为空时恢复/.test(SV), '「只在内存为空时恢复」语义注释在位（实时数据优先）');

console.log('\n【② 静态：调用点正确且唯一】');
const _saveCalls = (SRC.match(/saveAuctionSnapshot\(\)/g) || []).length;
ok(_saveCalls === 2, 'saveAuctionSnapshot 调用恰好 2 处（定义 1 + captureAuction 末尾 1）', '实际 ' + _saveCalls + ' 处');
ok(/logAuctionSignals\(_tickMap\);\s*saveAuctionSnapshot\(\);/.test(SRC), '保存点紧跟 captureAuction 末尾（inferLeader/inferZTProb 附加字段已就位后落盘）');
const _loadCalls = (SRC.match(/loadAuctionSnapshot\(\)/g) || []).length;
ok(_loadCalls === 2, 'loadAuctionSnapshot 调用恰好 2 处（定义 1 + boot 恢复链 1）', '实际 ' + _loadCalls + ' 处');
ok(/\[boot\] 从快照恢复竞价数据/.test(SV), 'boot 恢复有日志行（可观测，静默失败不许）');

console.log('\n【③ 动态：roundtrip（注入桩真跑 保存→清空→恢复）】');
function grabFn(name) {
  const start = SRC.indexOf('function ' + name + '()');
  if (start < 0) return '';
  let d = 0;
  for (let i = SRC.indexOf('{', start); i < SRC.length; i++) {
    if (SRC[i] === '{') d++;
    else if (SRC[i] === '}') { d--; if (d === 0) return SRC.slice(start, i + 1); }
  }
  return '';
}
const saveSrc = grabFn('saveAuctionSnapshot');
const loadSrc = grabFn('loadAuctionSnapshot');
ok(!!saveSrc, '能抠出 saveAuctionSnapshot 函数体');
ok(!!loadSrc, '能抠出 loadAuctionSnapshot 函数体');

// 共享桩：fake S + 内存文件系统（atomicWrite→存字符串，readFileSync→取字符串）
function mkEnv(auctionVal) {
  const S = { auction: auctionVal };
  let disk = null;
  const atomicWrite = (file, data) => { disk = String(data); return true; };
  const fsStub = { readFileSync: () => { if (disk == null) throw new Error('ENOENT'); return disk; } };
  const _diskFails = [];
  const save = new Function('S', 'atomicWrite', '_diskFail', 'AUCTION_SNAPSHOT_FILE',
    saveSrc + '\n; return saveAuctionSnapshot;')(
    S, atomicWrite, (n) => _diskFails.push(n), '/tmp/auction_snapshot.json');
  const load = new Function('S', 'fs', 'AUCTION_SNAPSHOT_FILE',
    loadSrc + '\n; return loadAuctionSnapshot;')(
    S, fsStub, '/tmp/auction_snapshot.json');
  return { S, save, load, disk: () => disk, fails: _diskFails };
}

// roundtrip：有数据 → 保存 → 清空内存 → 恢复 → 字段完整
{
  const au = { date: '20261027', time: '09:25:10', strong: [{ code: '603528', score: 91 }],
    subStrong: [], ztProbMap: { '603528': { prob: 78 } }, phase: 2 };
  const env = mkEnv(au);
  env.save();
  ok(env.disk() !== null, '保存后磁盘有快照');
  env.S.auction = null;                       // 模拟重启后内存清空
  ok(env.load() === true, '内存空时恢复返回 true');
  const r = env.S.auction;
  ok(r && r.date === '20261027' && Array.isArray(r.strong) && r.strong.length === 1
    && r.strong[0].code === '603528' && r.ztProbMap && r.ztProbMap['603528'].prob === 78,
    'roundtrip 字段完整（date/strong/ztProbMap 不丢）');
}

console.log('\n【④ 动态：两个防误覆盖语义】');
{
  // 算空不许覆盖：strong 为空 → 不写盘、不报错
  const env = mkEnv({ date: '20261027', strong: [] });
  env.save();
  ok(env.disk() === null && env.fails.length === 0, 'strong 为空 → 不落盘（算空不许覆盖）');
}
{
  // 算空不许覆盖：S.auction 为 null → 不写盘
  const env = mkEnv(null);
  env.save();
  ok(env.disk() === null, 'auction 为 null → 不落盘');
}
{
  // 内存已有实时数据 → 恢复不覆盖
  const env = mkEnv({ date: '20261028', strong: [{ code: '000001' }] });
  env.save();                                  // 先存一份 20261028
  env.S.auction = { date: '20261028', strong: [{ code: '000002' }] };  // 模拟实时重算后的新数据
  ok(env.load() === false, '内存已有 strong → 恢复拒绝（返回 false）');
  ok(env.S.auction.strong[0].code === '000002', '实时数据未被旧快照覆盖');
}
{
  // 磁盘无快照 → 恢复返回 false 且不抛
  const env = mkEnv(null);
  ok(env.load() === false, '磁盘无快照 → 返回 false（冷启动干净降级）');
}

console.log(`\n合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
process.exit(fail > 0 ? 1 : 0);
