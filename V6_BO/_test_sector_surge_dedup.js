/**
 * 守门测试：板块暴动哨兵当日幂等 + 函数名遮蔽类根治（2026-10-27 自检修）
 *
 * 一、当日幂等（线上实测同一板块当天连推三遍）：
 * 病根：sectorSurgeScan 的 `_secSurgeFired` 是纯内存 Set（day|sector 当日只响一次的唯一判据），
 *       发布/重启/冷启动即清零；且重启后首扫把涨停池里所有在封个股当新事件(at=now)灌进
 *       10 分钟窗口 → 同一板块立即再次触发。今天（10-27）线上：汽车零部件 18:56/19:16/19:44
 *       推了 3 遍，其余 4 个板块各 2 遍 —— 与 10-06 已根治的 reviewSentDate 同款病根。
 * 修法：触发条件加第二道判据 pushedToday(板块暴动标题正则)（落盘流水，跨重启铁证），
 *       内存 Set 或落盘流水任一命中即当日已响。typeof 守卫：守门沙箱缺符号时退化为
 *       只信内存 Set（= 修前行为），绝不 ReferenceError 静默失效。
 *
 * 二、同名遮蔽类（本轮一并根治，防同类 bug 第三次出现）：
 * 病根：mi 轮新增的暴动哨兵直接起名 sectorSurgeScan，与 498 行既有的 async 板块异动·
 *       涨停概率速报同名 —— JS 后声明覆盖先声明，旧模块被静默顶死；更糟的是旧调用点
 *       `sectorSurgeScan().catch(...)`（refreshSectorsZT 尾部）拿到同步函数返回的 undefined，
 *       每 tick 抛 TypeError，把同一行的 computeBuZhang（补涨龙）/scanPreBreakout（启动前埋伏）
 *       一起炸死，且都是在静默路径上。
 * 修法：新函数改名 sectorSurgeSentinel（调用点同步改）；守门钉死「server.js 不许再有
 *       同名顶层函数声明」+「refreshSectorsZT 尾部的 .catch 链必须挂在 async 函数上」。
 *
 * 本测试钉四件事：
 *   ① 源码：sectorSurgeSentinel 必须 consulted pushedToday（不许退回纯内存锁）
 *   ② 源码：无同名顶层函数声明（遮蔽类根治，全文件扫描）
 *   ③ 真跑：内存锁 + 落盘判据的组合语义（含「重启但确实没发过」的放行）
 *   ④ 反证：抽掉落盘判据 → 重启场景必须变红（证明断言不是恒绿）
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

console.log('\n=== 板块暴动哨兵当日幂等 + 同名遮蔽守门 ===\n');

console.log('【① 源码：触发条件必须带落盘判据 pushedToday】');
const fnStart = SRC.indexOf('function sectorSurgeSentinel(');
ok(fnStart >= 0, 'sectorSurgeSentinel 函数存在（不叫 sectorSurgeScan，不顶掉 498 行的 async 板块异动）');
function extractBody(src, fromIdx) {
  let d = 0;
  for (let i = src.indexOf('{', fromIdx); i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(fromIdx, i + 1); }
  }
  return '';
}
const body = fnStart >= 0 ? extractBody(SRC, fnStart) : '';
ok(body.length > 0, '能取到 sectorSurgeSentinel 完整函数体');
ok(body.indexOf('typeof pushedToday') >= 0 && body.indexOf('pushedToday(new RegExp(') >= 0,
  '触发条件 consulted pushedToday(落盘流水)（不许只信内存 _secSurgeFired）');
ok(body.indexOf('_secSurgeFired.has(day') >= 0, '内存快路径 _secSurgeFired 保留（双判据缺一不可）');

console.log('\n【② 源码：同名顶层函数声明清零（遮蔽类根治）】');
// 全文件扫描顶层 function 声明（行首顶格写）——同名后者静默顶掉前者，是这次事故的总根
const declNames = [];
{
  const re = /^(?:async\s+)?function\s+(\w+)\s*\(/gm;
  let m;
  while ((m = re.exec(SV)) !== null) declNames.push(m[1]);
}
const dupNames = declNames.filter((n, i) => declNames.indexOf(n) !== i);
ok(dupNames.length === 0, 'server.js 无同名顶层函数声明（后声明会静默顶掉前者）',
   dupNames.length ? '重复: ' + [...new Set(dupNames)].join('、') : '');
// 定向钉：板块异动(async, 498 行) 与 板块暴动哨兵(sync) 必须并存且各司其职
ok(/async function sectorSurgeScan\(/.test(SRC), 'async sectorSurgeScan（板块异动·涨停概率速报）存活');
ok(!/^function sectorSurgeScan\(/m.test(SRC), 'sync 版 sectorSurgeScan 不再存在（已改名 Sentinel）');
// 调用点契约：refreshSectorsZT 尾部的 .catch 链必须挂在 async 函数上（ undefined.catch 每 tick 炸 TypeError 的坑）
ok(/sectorSurgeScan\(\)\.catch\(/.test(SRC), 'refreshSectorsZT 尾部仍按 async 契约调 sectorSurgeScan().catch');
ok(/sectorSurgeSentinel\(\);/.test(SRC), 'ztSentinelTick 改调 sectorSurgeSentinel()（同步哨兵走自己的名）');

console.log('\n【③ 真跑：内存锁 + 落盘判据的组合语义】');
// 注入桩：状态变量（_secSurgeEv/_secSurgeFired/_secSurgeDay）每次新建 = 模拟重启
const mkScan = (o) => {
  const opts = o || {};
  return new Function(
    'todayStr', '_secSurgeEv', '_secSurgeFired', '_secSurgeDay', 'S',
    'sectorOfStock', 'pushAll', 'sentLogPush', 'pushedToday', 'capTooSmall',
    body + '\n;sectorSurgeSentinel();')(
    () => '20261027',
    new Map(), new Set(), '',
    opts.S || { ztPool: [], stocks: [] },
    opts.sectorOfStock || (() => '人形机器人'),
    opts.pushAll || (() => {}),
    opts.sentLogPush || (() => {}),
    opts.pushedToday,          // undefined = 模拟沙箱缺符号（typeof 守卫退化路径）
    opts.capTooSmall || (() => false));
};
let pushes = [];
const ZT3 = [{ code: '600001' }, { code: '600002' }, { code: '600003' }];
const capture = () => { pushes = []; return (t) => pushes.push(String(t)); };
const PT_FALSE = () => false;
const PT_TRUE = () => true;

// ① 全新实例 + 3 只封板 + 流水无记录 → 必须触发（当天第一遍合法推送）
mkScan({ S: { ztPool: ZT3, stocks: [] }, pushAll: capture(), pushedToday: PT_FALSE });
ok(pushes.length === 1 && pushes[0].indexOf('板块暴动 · 人形机器人') >= 0,
  '当天首次触发（内存空+流水空 → 推 1 条）', 'pushes=' + pushes.length);

// ② ⛔⛔ 核心回归（今天线上事故的复现）：重启（全新状态）+ 同批 3 只在封
//    + 落盘流水里今天已有该板块 ✅ 记录 → 绝不再推
pushes = [];
mkScan({ S: { ztPool: ZT3, stocks: [] }, pushAll: capture(), pushedToday: PT_TRUE });
ok(pushes.length === 0, '重启 + 流水已有今日该板块送达记录 → 拦截（根治今天三连推）', 'pushes=' + pushes.length);

// ③ 重启 + 确实没发过（流水无记录）→ 放行（上一实例死于触发前，不能误吞）
pushes = [];
mkScan({ S: { ztPool: ZT3, stocks: [] }, pushAll: capture(), pushedToday: PT_FALSE });
ok(pushes.length === 1, '重启 + 流水无记录 → 放行（不误吞当天首遍）', 'pushes=' + pushes.length);

// ④ 沙箱缺 pushedToday 符号（typeof 守卫）→ 不抛异常，退化为内存行为（= 修前语义）
pushes = [];
let threw = false;
try { mkScan({ S: { ztPool: ZT3, stocks: [] }, pushAll: capture() }); } catch (e) { threw = true; }
ok(!threw, '缺 pushedToday 符号（沙箱场景）→ typeof 守卫生效，不 ReferenceError');
ok(pushes.length === 1, '缺 pushedToday 符号 → 退化为只信内存锁（当天首遍照推）', 'pushes=' + pushes.length);

// ⑤ 判据按板块隔离：板块 A 已发过，板块 B 首触发 → B 照常推
pushes = [];
const ztB = [{ code: '300001' }, { code: '300002' }, { code: '300003' }];
const secOf = z => z.code[0] === '3' ? '新能源车' : '人形机器人';
const ptAOnly = (re) => String(re).indexOf('人形机器人') >= 0;   // 只 A 板块有送达记录
mkScan({ S: { ztPool: ZT3.concat(ztB), stocks: [] }, sectorOfStock: secOf, pushAll: capture(), pushedToday: ptAOnly });
ok(pushes.length === 1 && pushes[0].indexOf('板块暴动 · 新能源车') >= 0,
  '按板块隔离：A 已发过被拦、B 首触发照推（判据不误伤其它板块）', 'pushes=' + pushes.length + (pushes[0] ? ' → ' + pushes[0].split('\n')[0] : ''));

console.log('\n【④ 反证：抽掉落盘判据 → 核心场景必须变红】');
{
  const bodyNoDurable = body.replace(/&& !\(typeof pushedToday === 'function' && pushedToday\(new RegExp\('板块暴动 · ' \+ _surgeEsc\)\)\)/, '');
  ok(bodyNoDurable !== body, '反证前提：能从函数体中抽掉落盘判据（确认断言对象存在）');
  pushes = [];
  new Function('todayStr', '_secSurgeEv', '_secSurgeFired', '_secSurgeDay', 'S', 'sectorOfStock', 'pushAll', 'sentLogPush', 'pushedToday', 'capTooSmall',
    bodyNoDurable + '\n;sectorSurgeSentinel();')(
    () => '20261027', new Map(), new Set(), '',
    { ztPool: ZT3, stocks: [] },
    () => '人形机器人', capture(), () => {}, PT_TRUE, () => false);
  ok(pushes.length === 1, '反证：旧代码（无落盘判据）+ 重启 + 流水有记录 → 会重推（证明②红得有意义）', 'pushes=' + pushes.length);
}

console.log('\n──────────────────────────────');
console.log(`板块暴动幂等 + 同名遮蔽守门: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
