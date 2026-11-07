// 一次性数据操作：hv 轮存量非竞价窗口 auczt 幽灵样本标废（2026-10-15）
//
// 事故（#232 同源漏修·时段闸）：auctionCaptureAllowed 2026-10-15 hu 轮只补了"是不是交易日"，
//   没判"是不是交易时段"—— 服务凌晨重启（启动链 captureAuction(false) 无条件跑）照样放行：
//   auctionPhase=0 → auctionPxOf 走"开盘价"分支 → 拿**当日已实现的开盘价**冒充"竞价虚拟匹配价"
//   落 auczt 信号。本机实证：384 条 auczt 非 void 里 205 条 ts 不在 09:15~09:29
//   （凌晨101 / 盘中80 / 盘前09:00-09:14 18 / 傍晚6）。
//   后果：事前（竞价撮合价）与事后（开盘价）两种语义混进同一 type → paths/buckets 的
//   "竞价因子命中率"名不副实 → corr 压到 0.7、36 因子 adj 清一色负 → prob 中位 30 → 55 闸全灭。
//
// 判据（与 inferZTProb 落库窗口同一把尺子）：ts 的时分落在 09:15~09:29（phase 1/2/3 = 09:15:00~09:29:59）
//   才是真竞价窗口；其余抓取的一律标废。⛔ 不另抄判据：窗口边界从 server.js 的 auctionPhase 现提取。
// ⛔ 纪律（与 _void_ghosts.js / _backfill_nd.js 同）：先备份 .offauction_bak/，再登记 .offauction_ops.json；
//   默认干跑，--write 才落盘；重跑幂等（已 void 的不动）。
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const STAT_FILE = path.join(ROOT, 'stats.json');
const BAK_DIR = path.join(ROOT, '.offauction_bak');
const OPS_FILE = path.join(ROOT, '.offauction_ops.json');
const WRITE = process.argv.includes('--write');

// ── 从 server.js 现提取竞价窗口判据（单一事实源：auctionPhase 的三段边界）──
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const phSrc = (src.match(/function auctionPhase\(d\) \{[\s\S]*?\n\}/) || [''])[0];
if (!phSrc) {
  console.error('❌ 从 server.js 提取 auctionPhase 失败（锚点没命中）—— 终止，不许用猜的判据动数据');
  process.exit(1);
}
const phaseOf = new Function([
  'const isTradeDay = () => true;',   // 打桩：这里只取时分边界，交易日另判
  phSrc,
  'return auctionPhase;'
].join('\n'))();

// 窗口判据：09:15:00~09:29:59（phase 1/2/3）为真竞价窗口
const inWindow = ts => {
  const d = new Date(ts);
  return phaseOf(d) >= 1 && phaseOf(d) <= 3;
};

// ── 读 stats.json ──
const j = JSON.parse(fs.readFileSync(STAT_FILE, 'utf8'));
const sigs = j.signals || [];

// ── 干跑/落盘同一套匹配逻辑（按引用匹配，保证落盘的就是数出来的）──
const targets = [];
for (const s of sigs) {
  if (!s || typeof s !== 'object' || s.void) continue;
  if (s.type !== 'auczt') continue;                 // 只动竞价涨停推断这一类
  if (!(s.ts > 0)) continue;                        // 缺时间戳判不出窗口 → 不猜
  if (!inWindow(s.ts)) targets.push(s);
}
const byDate = {}, bySlot = {};
for (const s of targets) {
  byDate[s.date] = (byDate[s.date] || 0) + 1;
  const t = new Date(s.ts);
  const h = t.getHours() * 100 + t.getMinutes();
  const slot = h < 900 ? '凌晨/早(<09:00)' : h < 915 ? '盘前(09:00-09:14)' : h <= 929 ? '?' : h < 1200 ? '上午盘中' : h <= 1300 ? '午休' : h < 1500 ? '下午盘中' : '傍晚/夜间(>=15:00)';
  bySlot[slot] = (bySlot[slot] || 0) + 1;
}
const total = sigs.filter(s => s && s.type === 'auczt' && !s.void).length;
console.log(`auczt 非 void 总数 ${total}，待标废 ${targets.length} 条`);
console.log('  bySlot=' + JSON.stringify(bySlot));
console.log('  byDate=' + JSON.stringify(byDate));
const withNd = targets.filter(s => s.nd).length;
console.log(`  其中已有 nd 回验 ${withNd} 条（标废后 void 单列，不再计入命中率分母）`);
if (!targets.length) { console.log('没有待标废样本，退出'); process.exit(0); }
if (!WRITE) { console.log('（干跑）加 --write 落盘'); process.exit(0); }

// ── 备份 ──
if (!fs.existsSync(BAK_DIR)) fs.mkdirSync(BAK_DIR, { recursive: true });
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const bakName = `stats_pre_offauction_${ts}.json`;
fs.copyFileSync(STAT_FILE, path.join(BAK_DIR, bakName));

// ── 标废 + 落盘（tmp + rename 原子写）──
for (const s of targets) s.void = true;
const tmp = STAT_FILE + '.tmp';
fs.writeFileSync(tmp, JSON.stringify(j));
fs.renameSync(tmp, STAT_FILE);

// ── 登记流水 ──
let ops = [];
try { ops = JSON.parse(fs.readFileSync(OPS_FILE, 'utf8')); } catch {}
ops.unshift({ ts: new Date().toISOString(), op: 'void-offauction-auczt', wrote: targets.length, bySlot, byDate, backup: BAK_DIR + '/' + bakName });
if (ops.length > 100) ops = ops.slice(0, 100);
fs.writeFileSync(OPS_FILE, JSON.stringify(ops, null, 1));
console.log(`✅ 已标废 ${targets.length} 条，备份 ${bakName}，流水已登记`);
