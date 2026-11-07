// 幂等与重放：「今天已经推过」这件事实，不许因为重启就忘掉（本轮新角度）。
//
// 故障形态：reviewSentDate / nextPlanSentDate / auctionSentDate / digestSentDate /
// weekendSentDate / holidaySentDate / bootCheckDate 全是普通内存变量。托管实例**每次发布都会重启**
// （一天发 4 个版本就是 4 次），闲置还会被回收冷启动 —— 重启 = 这些"今天已发"的记号全部清零
// → 当天已经推过的复盘、次日计划、竞价异动、新闻汇总、开盘自检被**再推一遍**。
// 最典型的是 _reviewStartupCheck：注释原话就是"reviewSentDate 是内存变量，每次发布/重启都清零"，
// 于是它无条件补发，根本无法区分"今天发过了"还是"今天错过了"。
// 而证据一直躺在落盘的 pushlog.json 里（跨重启可查、还进了发布包），只是没人去问它。
// 修法：启动时用「今天有没有真发出去（status 以 ✅ 开头）+ 标题命中」重建闭锁。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const SVK = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// ── 把 pushedToday / sentLockFromPushLog 从源码里原样切出来真跑 ──
const iA = SV.indexOf('function pushedToday(titleRe) {');
const iHit = SV.indexOf('return hit ? todayStr() : \'\';');
if (iA < 0 || iHit < 0) throw new Error('未找到 pushedToday / sentLockFromPushLog 源码');
const iB = SV.indexOf('\n}', iHit);
// hw 轮：pushedToday 的「已外发过」判据收口到 pushIsOutStatus，沙箱必须一起编译进去
const _iPis = SV.indexOf('function pushIsOutStatus(st) {');
const PIS_SRC = _iPis < 0 ? '' : (() => { const j = SV.indexOf('\nfunction ', _iPis + 1); return SV.slice(_iPis, j > 0 ? j : SV.length); })();
if (!PIS_SRC) throw new Error('未找到 pushIsOutStatus（沙箱会静默失效，必须显式炸出来）');
const SRC = PIS_SRC + '\n' + SV.slice(iA, iB + 2);

const todayStr = () => '20261006';
const dayKeyOf = ts => {
  const d = new Date(ts);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
};
const TODAY_TS = new Date(2026, 9, 6, 15, 35, 0).getTime();     // 2026-10-06 15:35
const YDAY_TS = new Date(2026, 9, 5, 15, 35, 0).getTime();      // 2026-10-05 15:35

function run(log, re) {
  const mk = new Function('PUSH_LOG', 'todayStr', 'dayKeyOf', 'console',
    SRC + '\nreturn { pushedToday: pushedToday, sentLockFromPushLog: sentLockFromPushLog };');
  const api = mk(log, todayStr, dayKeyOf, { log() {}, error() {} });
  return { hit: api.pushedToday(re), lock: api.sentLockFromPushLog(re, 'T') };
}
const rec = (ts, status, title) => ({ ts, status, title, time: '' });

group('[1] 只认「真发出去」的那一条（被闸门拦下的必须还能重试）');
ok('今天已送达的复盘 → 判为已发',
  run([rec(TODAY_TS, '✅ 已送达', '═══ 📋 每日复盘 · 涨停形态与归因 ═══')], /每日复盘/).hit === true);
ok('今天被条数闸门拦下的复盘 → 不算已发（要能重试）',
  run([rec(TODAY_TS, '🚫 条数闸门', '═══ 📋 每日复盘 ═══')], /每日复盘/).hit === false);
ok('今天被夜间静默拦下 → 不算已发',
  run([rec(TODAY_TS, '夜间静默拦截', '═══ 📋 每日复盘 ═══')], /每日复盘/).hit === false);
ok('副本拦截（根本没外发）→ 不算已发',
  run([rec(TODAY_TS, '副本拦截(不外发)', '═══ 📋 每日复盘 ═══')], /每日复盘/).hit === false);
ok('未配置通道 → 不算已发',
  run([rec(TODAY_TS, '⚠️ 未配置通道', '═══ 📋 每日复盘 ═══')], /每日复盘/).hit === false);
ok('发送失败 → 不算已发',
  run([rec(TODAY_TS, '❌ 发送失败', '═══ 📋 每日复盘 ═══')], /每日复盘/).hit === false);

group('[2] 只认【今天】的那一条');
ok('昨天的复盘 → 不算已发（跨日必须重来）',
  run([rec(YDAY_TS, '✅ 已送达', '═══ 📋 每日复盘 ═══')], /每日复盘/).hit === false);
ok('今天的复盘 → 算已发',
  run([rec(TODAY_TS, '✅ 已送达', '═══ 📋 每日复盘 ═══')], /每日复盘/).hit === false ? false : true);
ok('标题不匹配 → 不算已发',
  run([rec(TODAY_TS, '✅ 已送达', '═══ 📊 盘中快报 ═══')], /每日复盘/).hit === false);
ok('缺 ts 的流水不吃异常（静默忽略）',
  run([{ status: '✅ 已送达', title: '═══ 📋 每日复盘 ═══' }], /每日复盘/).hit === false);

group('[3] sentLockFromPushLog：命中=今天（已闭锁），未命中=空串（可重发）');
{
  const a = run([rec(TODAY_TS, '✅ 已送达', '═══ 🗓️ 次日作战计划 · 2026-10-06 ═══')], /次日作战计划/);
  ok('命中时返回今天日期（等价于已闭锁）', a.lock === '20261006', String(a.lock));
  const b = run([], /次日作战计划/);
  ok('未命中时返回空串（保留重发机会）', b.lock === '', JSON.stringify(b.lock));
}

group('[4] 七个「每日一条」闭锁都必须用流水重建（不许再有裸的 = \'\'）');
const LOCKS = [
  ['reviewSentDate', /每日复盘/, '═══ 📋 每日复盘'],
  ['nextPlanSentDate', /次日作战计划/, '═══ 🗓️ 次日作战计划'],
  // ⛔ 2026-10-28：定稿锁只认定稿自己的标题（旧「竞价异动|竞价补抓快照」会被 9:15 的梯队扫描吃掉 → 当天定稿 0 外发）
  ['auctionSentDate', /9:25 竞价异动|竞价补抓快照/, '9:25 竞价异动'],
  ['digestSentDate', /每日新闻汇总/, '每日新闻汇总'],
  ['weekendSentDate', /周末新闻汇总/, '周末新闻汇总'],
  ['holidaySentDate', /假期要闻全景/, '假期要闻全景'],
  ['bootCheckDate', /开盘自检/, '═══ 📡 开盘自检'],
  ['tsScanDate', /全市场趋势扫描/, '═══ 🔭 全市场趋势扫描'],
  ['suScanDate', /连续收涨/, '═══ 📶 连续收涨'],
  ['zpScanDate', /涨停前形态/, '═══ 🎯 涨停前形态'],
  ['auctionPrevDate', /竞价预览/, '竞价预览 · 9:20'],
];
for (const [name, re, literal] of LOCKS) {
  ok(`${name} 由流水重建（不是裸 = ''）`,
    new RegExp('let ' + name + ' = sentLockFromPushLog\\(').test(SV));
  ok(`${name} 的判据能命中真实标题「${literal}」`,
    SV.indexOf(literal) > 0 && re.test(literal), literal);
}
ok('没有残留的 `let xxxSentDate = \'\';` / `let bootCheckDate = \'\';`',
  (SV.match(/let [A-Za-z]*SentDate = '';/g) || []).length === 0 &&
  !/let bootCheckDate = '';/.test(SV),
  (SV.match(/let [A-Za-z]*SentDate = '';/g) || []).join(' | '));
ok('没有残留的趋势三推 / 竞价预览裸闭锁',
  !/let (tsScanDate|suScanDate|zpScanDate|auctionPrevDate) = '';/.test(SV),
  (SV.match(/let (tsScanDate|suScanDate|zpScanDate|auctionPrevDate)[^\n]*/) || []).join(' | '));
ok('趋势三推各查各的标题（互不当成"已发"）',
  !/全市场趋势扫描/.test('═══ 📶 连续收涨 · 台阶式上行 ═══') &&
  !/连续收涨/.test('═══ 🔭 全市场趋势扫描 · 机器学完挑的 ═══') &&
  !/涨停前形态/.test('═══ 📶 连续收涨 · 台阶式上行 ═══'));

group('[5] 竞价预览与竞价定稿互不顶（两条都要能发）');
{
  const prev = '═══ 📯 竞价预览 · 9:20 不可撤单阶段 ═══';
  ok('源码里确有「竞价预览」这条独立消息', SV.indexOf('竞价预览 · 9:20') > 0);
  ok('竞价闭锁的正则不会误伤预览（预览不算"已发定稿"）',
    !/9:25 竞价异动|竞价补抓快照/.test(prev), prev);
  ok('补抓快照也算竞价已发（否则会推两份）',
    /9:25 竞价异动|竞价补抓快照/.test('═══ 📯 竞价补抓快照（10:02:11） ═══'));
  // ⛔ 2026-10-28 反证：9:15 起就发的「竞价异动 · 连板梯队扫描」绝不能被当成"定稿已发"
  //    （10-28 实测 09:15:04 第一条就 ✅ 送达 → 9:25 闸门第一道判据命中 → 定稿当天零外发）
  ok('⛔ 梯队扫描不算定稿已发（旧宽尺子的死因）',
    !/9:25 竞价异动|竞价补抓快照/.test('═══ 🔥 竞价异动 · 连板梯队扫描 ═══'));
  ok('⛔ 共振/收盘复盘的「竞价」字样也不算定稿已发',
    !/9:25 竞价异动|竞价补抓快照/.test('═══ 🔥 竞价共振 · TOP3 ═══') &&
    !/9:25 竞价异动|竞价补抓快照/.test('🩺 20261028 竞价定稿：今日推送 4 条'));
}

group('[6] 复用的是落盘流水：pushlog.json 必须在发布包里');
{
  const PY = fs.readFileSync(path.join(ROOT, '_publish.py'), 'utf8');
  ok('_publish.py 的 DATA_FILES 含 pushlog.json', /"pushlog\.json"/.test(PY));
  // ⛔ du 轮：容量不再写死 500，改走 DATA_CAP 登记表（断言钉语义不钉字面量）
  ok('pushLog 容量走 DATA_CAP 登记表（当天记录必在其中，不会漏判）',
    /if \(PUSH_LOG\.length > dataCapOf\('pushLog'\)\) PUSH_LOG\.length = dataCapOf\('pushLog'\);/.test(SV));
  ok('流水落盘走 atomicWrite（写坏不会丢整份历史）',
    /atomicWrite\(PUSH_LOG_FILE, JSON\.stringify\(PUSH_LOG\.slice\(0, dataCapOf\('pushLog'\)\)\)\);/.test(SV));
  // ⛔ du 轮新增：流水有上限 = 「今天已发」的判据有边界，边界必须被问一句
  ok('pushedToday 会先问证据是否覆盖今天', /pushLogCoversToday\(\)/.test(SV));
}

group('[7] 反证：旧写法（内存裸变量）在同一场景下确实会重放');
{
  // 模拟"发过一次 → 重启 → 内存清空"：旧写法拿不到任何证据，只能再发一次
  const memoryLock = '';                       // 重启后 reviewSentDate 就是这个值
  const oldWouldResend = memoryLock !== todayStr();
  const newWouldResend = !run([rec(TODAY_TS, '✅ 已送达', '═══ 📋 每日复盘 ═══')], /每日复盘/).hit;
  ok('旧写法（内存锁）重启后会重推 → 复现故障', oldWouldResend === true);
  ok('新写法（查流水）重启后不再重推', newWouldResend === false);
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
