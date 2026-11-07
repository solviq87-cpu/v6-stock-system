// 新闻汇总「每天必达」守门测试
// 2026-10-05 国庆实测故障：整整一天没有新闻推送，用户只能靠「好像没收到」发现问题。定位到三个叠加缺陷：
//   ① 自动汇总窗口只有 21:00-21:30 —— 托管实例闲置被回收，那一刻进程根本不在；冷启动后定时器从头跑，
//      窗口已过 → 当天汇总永久丢失，且不补发。
//   ② digestSentDate 只活在 init() 里 —— /api/news-digest 手动补发改不到它，两边互不知情。
//   ③ 周末汇总无条件 `span>=3 就 return` 让位给「假期全景」，但全景只在【明天开盘】才发，
//      长假中间的周日（国庆 10/4，明天 10/5 仍休市）两边都不发 → 整晚空档。
// 本测试把这些出口都钉死，避免改回去。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}

const iInit = s.indexOf('async function init()');
// ⛔ 2026-10-06 更新：声明文本已从裸的 `let digestSentDate = '';` 改成
//    `let digestSentDate = sentLockFromPushLog(/每日新闻汇总/, '每日新闻汇总');`
//    —— 它仍是模块级变量（这一点没变），只是初值不再固定为空串，而是启动时先用
//    落盘流水判断「今天发过没有」，避免发布/回收重启后再推一份一模一样的汇总。
//    这里照旧的写法去匹配空串会误报，改为匹配「模块级声明」这层语义。
const iDecl = s.search(/^let digestSentDate = /m);

// 1) digestSentDate 必须是模块级变量：init() 外面的手动补发接口才能共用同一把锁
ok('digestSentDate 已提升到模块顶层（早于 init）', iDecl >= 0 && iInit >= 0 && iDecl < iInit);
ok('digestSentDate 启动时用落盘流水重建（重启不重放）',
  /let digestSentDate = sentLockFromPushLog\(/.test(s));
ok('digestSentDate 全文只声明一次（无重复/无 TDZ）',
  s.split('let digestSentDate').length - 1 === 1);

// 2) 自动窗口必须放宽到 21:00-23:59，且不能越过 00:00（否则日期标成第二天）
ok('每日汇总窗口放宽到 21:00-23:59', /t >= 21 \* 60 && t < 24 \* 60/.test(s));
ok('旧的 21:00-21:30 窄窗已移除', !/t >= 21 \* 60 && t < 21 \* 60 \+ 30/.test(s));

// 3) 手动补发必须置位，避免凌晨补的那份和当晚自动任务重复发
// ⛔ gn 轮改判据（2026-10-13）：digestFallback（补发覆盖的是昨天，开盘前/跨午夜）时
//    【不置位】—— 置了位今晚 21:00 的自动汇总会被 pushedToday 判「已发」跳过（少一天）；
//    标题也不同（「昨日新闻汇总（补发）」），流水不会被误判成今天发过。
ok('⛔ /api/news-digest 工作日补发后置 digestSentDate，digestFallback 时不置位',
  /if \(!isSun && !digestFallback\) digestSentDate = todayStr\(\);/.test(s));

// 4) 周末汇总：只在假期全景【真的会发】时才让位，长假中间的周日由周末汇总兜底
ok('周末汇总改按 holidayDigestShouldFire().fire 让位',
  /if \(holidayDigestShouldFire\(\(S\.news\.holidayBuf \|\| \[\]\)\.length\)\.fire\) return;/.test(s));
ok('周末汇总不再无条件 span>=3 return（会造成长假周日空档）',
  !/if \(holidaySpanUpToToday\(\)\.length >= 3\) return;/.test(s));

// 5) 自唤醒保活：主实例才需要（打自己）；副本不再打自己，改为每 3 分钟叫醒线上
// ⛔ gn 轮改判据（2026-10-13，用户「复盘新闻推送说了八百遍」根治）：
//    自唤醒只能让【活着的进程】继续活，叫不醒已被回收的进程；定时推送的唯一执行者是
//    线上，必须保活的是它。现在：副本分支只打线上（syncUpstream.url），不打自己；
//    主实例仍每 8 分钟打自己的 /api/lock/status。断言改钉这个新分工。
ok('startSelfWake 已定义', /function startSelfWake\(\)/.test(s));
ok('⛔ startSelfWake 副本不打自己（gn：改为每 3 分钟叫醒线上）',
  !/function startSelfWake\(\) \{\s*\n\s*if \(isReplica\(\)\) return;/.test(s)
  && /if \(isReplica\(\)\) \{[\s\S]{0,700}?setInterval\(\(\) => \{ replicaPing\(UP\); \}, 3 \* 60 \* 1000\)/.test(s));
ok('⛔ 副本分支结尾 return（不打自己：本地进程不会被托管平台回收）',
  /console\.log\('\[wake↑\] 副本未配置 syncUpstream\.url[\s\S]{0,200}?return;/.test(s));
ok('主实例仍每 8 分钟自唤醒（QD_PUBLIC_URL 兜底线上地址）',
  /const SELF = String\(process\.env\.QD_PUBLIC_URL[\s\S]{0,200}?setInterval\(\(\) => \{ ping\(SELF\); \}, 8 \* 60 \* 1000\)/.test(s));
ok('startSelfWake 已挂到启动链（不只是定义）', /try \{ startSelfWake\(\); \}/.test(s));
ok('自唤醒只打无需令牌的公开接口', /startSelfWake[\s\S]{0,600}?\/api\/lock\/status/.test(s));

// 6) 行尾：Edit 改中文文件可能整份变 CRLF
const buf = fs.readFileSync(path.join(ROOT, 'server.js'));
ok('server.js 保持 LF（无 CRLF）', buf.indexOf(Buffer.from('\r\n')) === -1);

// 7) 手动补发跨午夜（2026-10-12）：周一开盘前(00:00~09:00)仍出「周末汇总[六,日]」，不是空壳当日汇总
//    背景：周日 21:00-24:00 补发若踩到已跨午夜(周一)，getDay()===1 → isSun=false →
//    buildNewsDigest 按周一当日过滤(inDays)、周一还没新闻 → 发一条空壳（用户 10-12 00:01 实测踩中）。
const iND = s.indexOf("p === '/api/news-digest'");
const iNDend = s.indexOf("p === '/api/", iND + 10);
const ndBody = (iND >= 0 && iNDend > iND) ? s.slice(iND, iNDend) : '';
ok('/api/news-digest 周一开盘前也算周末汇总口径', /getDay\(\) === 1 && d\.getHours\(\) < 9/.test(ndBody));
ok('/api/news-digest 周末口径取[周六,周日]两天', /dates = \[fmtD\(satD\), fmtD\(sunD\)\]/.test(ndBody));
ok('/api/news-digest 周日当天口径不变(昨天=周六+今天=周日)',
  /sunD = d\.getDay\(\) === 1 \? new Date\(Date\.now\(\) - 86400000\) : d/.test(ndBody));

// 8) 定时推送健康自检（2026-10-12）：窗口内没发且归档空时写诊断，静默漏发变可见（只记录、不外发）
ok('_digestDiag 诊断函数已定义', /function _digestDiag\(/.test(s));
ok('日报+周末两个汇总定时器都接了 _digestDiag 诊断', s.split("_digestDiag('").length - 1 >= 2);

console.log(`\n新闻每天必达守门：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
