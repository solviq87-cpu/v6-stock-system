/**
 * 守门测试：一进二模块（首板涨停次日接力预测）
 * 2026-10-08 新增
 *
 * 验证点：
 *   ① 函数存在（scanYiEr / buildYiErMessage / pushYiEr）
 *   ② 配置表登记完整（EMP_EARLY / PROB_KIND_OF_TYPE / MSG_CAP / MSG_TYPE_RE / MOD_DAY_CAP）
 *   ③ 推送走私密通道 + sentToday 幂等
 *   ④ 学习闭环：logSignal('yier', ...) 登记 + resolveNextDay 回验口径
 *   ⑤ 概率门槛：低于 ZT_INFER_PUSH_PROB 的首板票被过滤
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

console.log('\n=== 一进二模块守门测试 ===\n');

console.log('【① 函数定义完整性】');
ok(/function scanYiEr\(\)/.test(SRC), 'scanYiEr 已定义');
ok(/function buildYiErMessage\(items\)/.test(SRC), 'buildYiErMessage 已定义');
ok(/function pushYiEr\(\)/.test(SRC), 'pushYiEr 已定义');

console.log('\n【② 配置表登记完整性】');
ok(/'yier'/.test(String(SRC.match(/const EMP_EARLY = new Set\([^)]+\)/) || '')), 'EMP_EARLY 包含 yier');
ok(/yier['"]\s*:\s*['"]ztNext['"]/.test(SRC), 'PROB_KIND_OF_TYPE 登记 yier → ztNext');
ok(/一进二\s*:\s*1/.test(SRC), 'MSG_CAP 包含「一进二: 1」');
ok(/\[\/一进二\/,\s*['"]一进二['"]\]/.test(SRC), 'MSG_TYPE_RE 映射一进二分类');
// ⛔ yier 不走 MOD_DAY_CAP（pushYiEr 用 sentToday 做每日一条幂等，不需要模块额度）

console.log('\n【③ 推送与幂等】');
// pushYiEr 内部必须调用 sentToday（双判据防重启重放）
ok(/sentToday\(yierSentDate/.test(SRC), 'pushYiEr 走 sentToday 幂等判据');
// 收盘后推送（代码写 t < 15*60+30 时 return，即 15:30 之前不发）
ok(/15\s*\*\s*60\s*\+\s*30/.test(String(SV.match(/function pushYiEr\(\)[\s\S]*?\n\}/) || '')), 'pushYiEr 包含 15:30 时间门槛');
// 走私密通道（在原始源码中匹配，避免 stripNoise 干扰）
ok(/pushAll\(msg,\s*false,\s*\{\s*private:\s*true\s*\}\)/.test(SV), 'pushYiEr 走 opts.private = true');
// yierSentDate 声明在模块顶层（与复盘/次日计划同层，自动与手动共用）
// ⛔ hg 轮改判据（用户「重复推送要改正」）：锁正则只认日报自己的标题「一进二 · 次日连板潜力榜」。
//    旧写法 /一进二/ 会把 9:25「一进二 · 竞价确认」的送达记录误判成"日报已发"
//    → 15:30 日报被 pushedToday 挡死、当天永不推出（漏发）。
ok(/let yierSentDate = sentLockFromPushLog\(\/一进二 · 次日连板潜力榜\//.test(SV), 'yierSentDate 模块顶层声明 + 启动时恢复流水证据（正则只认日报标题，不吃竞价确认）');

console.log('\n【④ 学习闭环】');
// scanYiEr 中对入选票登记 logSignal('yier', ...)
const scanBody = (() => {
  const i = SRC.indexOf('function scanYiEr() {');
  if (i < 0) return '';
  let d = 0;
  for (let j = SRC.indexOf('{', i); j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (d === 0) return SRC.slice(i, j + 1); }
  }
  return '';
})();
ok(/logSignal\(['"]yier['"]/.test(scanBody) || /logSignal\(['"]yier['"]/.test(String(SRC.match(/function pushYiEr\(\)[^{]*\{[\s\S]*?\}/) || '')), '一进二入选票有 logSignal("yier", ...) 登记');
// empTable 会统计 yier（EMP_EARLY 已含，empGroupOf 返回「未启动类」）
ok(/EMP_EARLY\.has\(['"]yier['"]\)/.test(SRC) || /EMP_EARLY\b/.test(SRC), 'yier 属于 EMP_EARLY → 未启动类实测档');

console.log('\n【⑤ 概率门槛与过滤】');
// scanYiEr 中融合概率低于门槛则被过滤
ok(/useProb\s*<\s*ZT_INFER_PUSH_PROB/.test(scanBody), 'scanYiEr 用融合概率过滤（< ZT_INFER_PUSH_PROB 跳过）');
// 专属因子存在（硬板、封单、板块角色、市值、换手）
ok(/breakCount/.test(scanBody) && /sealAmount/.test(scanBody) && /role/.test(scanBody) && /floatCap/.test(scanBody) && /turnover/.test(scanBody),
  'scanYiEr 包含一进二专属因子（硬板/封单/角色/市值/换手）');
// 封顶保底
ok(/Math\.max\(\s*15/.test(scanBody) && /Math\.min\(\s*92/.test(scanBody), '概率钳制在 15~92 区间');

console.log('\n【⑥ 启动补发与竞价检测】');
ok(/_yierStartupCheck/.test(SRC), 'init 内有一进二启动补发 _yierStartupCheck');
ok(/setTimeout\(_yierStartupCheck/.test(SRC), '_yierStartupCheck 挂在启动链上');
ok(/function scanYiErAuction\(\)/.test(SRC), 'scanYiErAuction 已定义（竞价一进二检测）');
ok(/function buildYiErAuctionMessage\(items\)/.test(SRC), 'buildYiErAuctionMessage 已定义');
ok(/function pushYiErAuction\(\)/.test(SRC), 'pushYiErAuction 已定义');
ok(/yierAuctionSentDate/.test(SV), 'yierAuctionSentDate 模块顶层声明');
ok(/sentToday\(yierAuctionSentDate/.test(SRC), 'pushYiErAuction 走 sentToday 幂等');
// ⛔⛔ hg 轮（用户「竞价 9:25 推送不要忘记了」+「重复推送要改正」）：
//    旧锁正则 /一进二·竞价确认/（· 两旁无空格）**永远匹配不上**真实标题
//    「═══ 🎯 一进二 · 竞价确认 ═══」（有空格）→ 落盘判据失效，只剩内存闭锁，
//    容器一重启（发布/回收）9:25~9:26 窗口内就再发一遍 = 重复推送。
ok(/let yierAuctionSentDate = sentLockFromPushLog\(\/一进二 · 竞价确认\//.test(SV),
  '⛔ 竞价确认锁正则与真实标题逐字一致（带空格，否则落盘判据失效=重启重发）');
ok(/sentToday\(yierAuctionSentDate, ds, \/一进二 · 竞价确认\/, 9 \* 60 \+ 25\)/.test(SV),
  '⛔ 竞价确认补 dueMin=9:25（早上发布/回收后起步的容器不再被证据窗吞掉）');
// 两把一进二锁不许互吃：日报锁只认日报标题，竞价确认的送达记录不能当成"日报已发"
//   （旧 /一进二/ 正相反 → 15:30 日报被 9:25 的流水挡死，当天漏发）
ok(/一进二 · 次日连板潜力榜/.test('═══ 🎯 一进二 · 次日连板潜力榜 ═══')
  && !/一进二 · 次日连板潜力榜/.test('═══ 🎯 一进二 · 竞价确认 ═══')
  && /一进二 · 竞价确认/.test('═══ 🎯 一进二 · 竞价确认 ═══'),
  '⛔ 日报锁正则不命中竞价确认标题（两把锁各认各的，互不吞噬）');
ok(/9\s*\*\s*60\s*\+\s*25/.test(SRC) && /9\s*\*\s*60\s*\+\s*26/.test(SRC), 'pushYiErAuction 窗口 9:25~9:26');
ok(/pushAll\([^\n]*private:\s*true/.test(String(SRC.match(/function pushYiErAuction\(\)[\s\S]*?\n\}/) || '')), 'pushYiErAuction 走私密通道');

console.log('\n──────────────────────');
console.log(`合计 ${pass + fail} 项：通过 ${pass}、失败 ${fail}`);
console.log(fail === 0 ? '✅ 全部通过' : '❌ 有失败项');
process.exit(fail > 0 ? 1 : 0);
