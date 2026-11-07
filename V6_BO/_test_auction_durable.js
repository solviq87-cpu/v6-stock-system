// 竞价留档耐久化守门（dz+ 轮 · 决策表 D2，2026-10-17）
// ── 为什么要这个套件 ────────────────────────────────────────────────────
// 决策表 D2 的事实：_publish.py 的 DATA_FILES 原本只带 holdings/config/paper/stats/
// learnall/news/pushlog/ztpre，**不含 auction_log.json**；而线上容器一天回收多次。
// 结果：手机端读线上副本只剩「本容器启动后 9:25 写的当天几条」，本机 108 条历史从未上云，
// #290 的竞价聚合头在手机上等于白做。
// 修法三件（与 pushlog 同款）：① 进发布包；② 每次落盘镜像 durable/；③ 启动合并去重。
// 本套件钉死这三件，重点是合并函数（纯函数，可直接真跑）。
const fs = require('fs');
const path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const PUB = fs.readFileSync(path.join(__dirname, '_publish.py'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); }
};
// 按花括号配平取函数体（⛔ 不用固定行号窗口，函数一挪就假绿/假红）
// fnBody 只回花括号内部（给正则断言用）；fnFull 回「声明 + 函数体」（给 new Function 真跑用，
// ⛔ 少了 function 前缀拼出来就是裸块，形如 { return ... } → r is not defined）
function _span(sig) {
  const i = SRC.indexOf(sig);
  if (i < 0) return null;
  let depth = 0, j = SRC.indexOf('{', i);
  if (j < 0) return null;
  const start = j;
  for (; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return { start, end: j + 1, sig: i }; }
  }
  return null;
}
function fnBody(sig) { const s = _span(sig); return s ? SRC.slice(s.start, s.end) : ''; }
function fnFull(sig) { const s = _span(sig); return s ? SRC.slice(s.sig, s.end) : ''; }

// ── ① 结构：三件事都在 ────────────────────────────────────────────────
ok('_publish.py 的 DATA_FILES 带 auction_log.json（不进包 = 每次上线手机端从零开始）',
  /"auction_log\.json"/.test(PUB));
const saveB = fnBody('function saveAuctionLog()');
ok('saveAuctionLog 函数体可定位', saveB.length > 50);
ok('落盘同时镜像 durable/（主文件被误删/写坏的最后一手）', /mirrorAuctionDurable\(\)/.test(saveB));
const loadB = fnBody('function loadAuctionLog()');
ok('loadAuctionLog 函数体可定位', loadB.length > 100);
ok('启动时合并主文件与 durable 副本（⛔ 不整文件覆盖）',
  /mergeAuctionLogs\(base, dur/.test(loadB));
ok('合并出增量要落盘（§10：改内存≠改磁盘，恢复的东西必须真的写回去）',
  /merged\.length > base\.length/.test(loadB) && /saveAuctionLog\(\)/.test(loadB));
const mirB = fnBody('function mirrorAuctionDurable()');
ok('mirrorAuctionDurable 函数体可定位', mirB.length > 80);
ok('镜像前确保 durable 目录存在（首次启动没有这个目录）',
  /mkdirSync\(dir, \{ recursive: true \}\)/.test(mirB));
ok('镜像走 atomicWrite（半截文件 = 下次启动直接丢全量）', /atomicWrite\(/.test(mirB));
ok('镜像失败静默降级但留日志（不影响主流程，但必须留痕）',
  /catch \(e\) \{ console\.error\('\[durable\] 竞价留档镜像失败/.test(mirB));

// ── ② 合并函数真跑（纯函数，抠出来跑）────────────────────────────────
const code = fnFull('function auctionLogKey(r)') + '\n' + fnFull('function mergeAuctionLogs(existing, incoming, cap)');
ok('合并函数可定位（key + merge 两段）', code.length > 200);
let mergeAuctionLogs, auctionLogKey;
try { ({ mergeAuctionLogs, auctionLogKey } = new Function(code + '\nreturn { mergeAuctionLogs, auctionLogKey };')()); }
catch (e) { console.error('沙箱构造失败:', e.message); process.exit(1); }

ok('去重键 = date|code（同一天同一只票只留一条）',
  auctionLogKey({ date: '20261015', code: '600000' }) === '20261015|600000');
ok('缺字段的键是空串（调用方按 falsy 丢弃，不会互相撞键）',
  auctionLogKey(null) === '|' && auctionLogKey({}) === '|');

const a = [{ date: '20261015', code: '000001', name: '甲' }, { date: '20261014', code: '000002', name: '乙' }];
const b = [{ date: '20261015', code: '000001', name: '甲-重复' }, { date: '20261016', code: '000003', name: '丙' }];
const m = mergeAuctionLogs(a, b, 1500);
ok('合并后条数 = 并集（2 + 2，其中 1 条重复 → 3）', m.length === 3, JSON.stringify(m.map(x => x.date + x.code)));
ok('重复键保留**先出现**的那条（主文件优先，durable 只补缺）',
  m.find(x => x.date === '20261015' && x.code === '000001').name === '甲');
ok('合并结果按 date 升序（留档本身是追加式的，乱序会让窗口起止算错）',
  m.map(x => x.date).join(',') === '20261014,20261015,20261016', m.map(x => x.date).join(','));
ok('同一天多条保持原插入顺序（V8 sort 稳定，不拿 code 乱排）', (() => {
  const r = mergeAuctionLogs(
    [{ date: '20261015', code: '300001' }, { date: '20261015', code: '300002' }, { date: '20261015', code: '300003' }], [], 1500);
  return r.map(x => x.code).join(',') === '300001,300002,300003';
})());
ok('坏数据（null / 缺 code / 缺 date）被丢弃，不进 result',
  mergeAuctionLogs([null, { code: '1' }, { date: '20261015' }, { date: '20261015', code: '2' }], [], 1500).length === 1);
ok('裁切按下限保留（cap 生效）', mergeAuctionLogs(
  Array.from({ length: 10 }, (_, i) => ({ date: '202610' + String(10 + i), code: '00000' + i })), [], 3).length === 3);
ok('cap 不传默认 1500（与 logAuctionSignals 的裁切口径一致）', (() => {
  const big = Array.from({ length: 1600 }, (_, i) => ({ date: '2026' + String(1000 + Math.floor(i / 100)), code: String(100000 + i) }));
  return mergeAuctionLogs(big, [], undefined).length === 1500;
})());
ok('两份都空 → 空数组（不返回 null，调用方直接当数组用）', Array.isArray(mergeAuctionLogs([], [], 1500)) && mergeAuctionLogs(null, null, 1500).length === 0);
ok('合并幂等：同一份数据跑两遍结果完全一致（启动重复执行不会膨胀）', (() => {
  const once = mergeAuctionLogs(a, b, 1500);
  const twice = mergeAuctionLogs(once, b, 1500);
  return JSON.stringify(once) === JSON.stringify(twice);
})());

// ── ③ 真实文件端到端（有数据才跑；没有就明说，不静默跳过）──────────────
const LOG = path.join(__dirname, 'auction_log.json');
if (fs.existsSync(LOG)) {
  let real = [];
  try { real = JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch (e) { real = null; }
  ok('本机 auction_log.json 可解析', Array.isArray(real), real === null ? '解析失败' : typeof real);
  if (Array.isArray(real)) {
    const self = mergeAuctionLogs(real, real, 1500);
    ok('真实数据自合并：条数不变（去重键真能覆盖现存记录）', self.length === real.length, real.length + ' → ' + self.length);
    const keys = new Set(real.map(auctionLogKey));
    ok('真实数据里没有重复键（date|code 唯一性成立，去重设计站得住）', keys.size === real.length, real.length + ' 条 / ' + keys.size + ' 键');
    ok('真实数据按 date 升序排列（合并后窗口起止才可信）', (() => {
      const ds = self.map(x => String(x.date));
      return ds.every((d, i) => i === 0 || ds[i - 1] <= d);
    })());
  }
} else {
  console.log('（本机无 auction_log.json —— 真实文件段未跑，逻辑由上面的合成用例覆盖）');
}

console.log(`[auction_durable] ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
