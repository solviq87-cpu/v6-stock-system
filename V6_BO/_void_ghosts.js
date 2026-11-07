// 一次性数据操作：#232 存量非交易日幽灵信号标废（hu 轮，2026-10-15）
//
// 事故：2026 国庆 10-01 01:38 服务启动，启动链 captureAuction 无交易日闸，拿 09-30 陈旧快照
//   冒充"当日竞价"，落了 156 条 date=节假日的样本（auczt 64 + pool 57 + buzhang 12 + similar 8
//   + zt 6 + trend 5 + bigmoney 4），其中 152 条还被张冠李戴"回验"成节后首个交易日的结局。
//   存量迁移当时只判周末且跳过 resolved → 这 156 条永久留在命中率分母里。
//
// 本脚本把存量一次标废。⛔ 判据不另抄：isTradeDay/MARKET_HOLIDAYS/MARKET_WORKDAYS 全部从
//   server.js 源码现提取（单一事实源，表改了这里跟着改）。
// ⛔ 纪律（与 _backfill_nd.js 同）：先备份 .holiday_ghost_bak/，再登记 .holiday_ghost_ops.json；
//   默认干跑，--write 才落盘；重跑幂等（已 void 的不动）。
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const STAT_FILE = path.join(ROOT, 'stats.json');
const BAK_DIR = path.join(ROOT, '.holiday_ghost_bak');
const OPS_FILE = path.join(ROOT, '.holiday_ghost_ops.json');
const WRITE = process.argv.includes('--write');

// ── 从 server.js 提取真判据（holidayTableWarn 打桩：表过期告警与判据无关）──
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const holSrc = (src.match(/const MARKET_HOLIDAYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
const wdSrc = (src.match(/const MARKET_WORKDAYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
const isTradeDaySrc = (src.match(/function isTradeDay\(d\) \{[\s\S]*?\n\}/) || [''])[0];
if (!holSrc || !wdSrc || !isTradeDaySrc) {
  console.error('❌ 从 server.js 提取 isTradeDay 判据失败（锚点没命中）—— 终止，不许用猜的判据动数据');
  process.exit(1);
}
const isTrade = new Function([
  'const holidayTableWarn = () => {};',   // 打桩：表过期告警与判据无关
  wdSrc, holSrc, isTradeDaySrc,
  'return isTradeDay;'
].join('\n'))();

// ── 读 stats.json ──
const j = JSON.parse(fs.readFileSync(STAT_FILE, 'utf8'));
const sigs = j.signals || [];

// ── 干跑/落盘同一套匹配逻辑（按引用匹配，保证落盘的就是数出来的）──
const targets = [];
for (const s of sigs) {
  if (!s || typeof s !== 'object' || s.void) continue;
  const n = String(s.date == null ? '' : s.date).replace(/[^0-9]/g, '');
  if (n.length !== 8) continue;
  const d = new Date(+n.slice(0, 4), +n.slice(4, 6) - 1, +n.slice(6, 8));
  if (!isTrade(d)) targets.push(s);
}
const byType = {}, byDate = {};
for (const s of targets) {
  byType[s.type] = (byType[s.type] || 0) + 1;
  byDate[s.date] = (byDate[s.date] || 0) + 1;
}
console.log(`待标废 ${targets.length} 条：byType=${JSON.stringify(byType)} byDate=${JSON.stringify(byDate)}`);
if (!targets.length) { console.log('没有待标废样本，退出'); process.exit(0); }
if (!WRITE) { console.log('（干跑）加 --write 落盘'); process.exit(0); }

// ── 备份 ──
if (!fs.existsSync(BAK_DIR)) fs.mkdirSync(BAK_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const bakName = `stats_pre_ghostfix_${ts}.json`;
fs.copyFileSync(STAT_FILE, path.join(BAK_DIR, bakName));

// ── 标废 + 落盘（tmp + rename 原子写）──
for (const s of targets) s.void = true;
const tmp = STAT_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(j));
fs.renameSync(tmp, STAT_FILE);

// ── 登记流水 ──
let ops = [];
try { ops = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8')); } catch {}
ops.unshift({ ts: new Date().toISOString(), op: 'void-holiday-ghosts', wrote: targets.length, byType, byDate, backup: BAK_DIR + '/' + bakName });
if (ops.length > 100) ops = ops.slice(0, 100);
fs.writeFileSync(OPS_FILE, JSON.stringify(ops, null, 1));
console.log(`✅ 已标废 ${targets.length} 条，备份 ${bakName}，流水已登记`);
