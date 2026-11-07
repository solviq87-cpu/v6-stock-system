// 定时推送「窗口宽度 + 置位顺序」守门测试
// 背景（2026-10-05/06 连续两次定位）：托管实例闲置会被回收，进程一停所有定时器整体停摆。
// 于是任何「窄窗口触发一次、错过即永久丢失」的定时推送都不可靠 —— 新闻汇总先中招（21:00-21:30），
// 体检后发现假期全景 / 周末汇总 / 开盘自检同样是窄窗口，且它们错过后【再也补不回来】：
//   · 假期全景：次日开盘后 holidayDigestShouldFire 判 today-trade-day → fire=false，
//               整个假期攒的几百条新闻再无机会发出（一年只有几次，损失不可弥补）
//   · 周末汇总：过了午夜是周一，周一那份是"周一汇总"，周六+周日内容永久丢失
//   · 开盘自检：它本是"链路哑了要第一时间发现"的唯一信号，自己却只有 20 分钟窗口
// 另外置位顺序：先打「今天已发」再发送，一旦 push 被闸门拦下（条数/静默/副本）就再也不重试。
// （复盘那处踩过一模一样的坑，注释里写得清清楚楚。）
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}

// ---- 窗口宽度：一律放宽到「当晚/当日上午之内」，且不得跨过午夜 ----
// ⚠️ 2026-10-08 改判据：闭锁收口成 sentToday(...)，不再钉 `xxxSentDate !== ds` 旧字面量
ok('每日新闻汇总窗口 21:00-23:59', /t >= 21 \* 60 && t < 24 \* 60 && !sentToday\(digestSentDate, ds,/.test(s));
ok('周末汇总窗口 21:00-23:59', /d\.getDay\(\) === 0 && t >= 21 \* 60 && t < 24 \* 60 && !sentToday\(weekendSentDate, ds,/.test(s));
ok('假期全景窗口 21:00-23:59（不再只有 45 分钟）',
  /if \(t < 21 \* 60 \|\| t >= 24 \* 60\) return;/.test(s) && !/t >= 21 \* 60 \+ 45/.test(s));
// ⛔ gb 轮换判据（用户原话「开盘自检 9:15-9:20」）：窗口从放宽版 09:15-11:30 收窄成 **09:15-09:20**。
//    ⚠️ 这条**与开头那条原则正相反**：「窄窗口错过即丢」对**开盘自检 / 竞价类**并不成立 —— 它们回答的都是"此刻"的问题（开盘这一刻链路通不通、竞价这一分钟什么价），
//    窗口一过补发出来的是句马后炮（2026-09-29 那次 10:02 补抓的快照自称「9:25 竞价异动」，
//    用户拿着它以为系统在提前发现，其实票早涨完了）。这类消息的补偿手段是**把窗口内做成一次成功**
//    （sentToday 保留重试机会、竞价轮询加密到 5 秒），而不是事后补一条过期消息。
ok('开盘自检窗口收窄到 09:15-09:20（用户指定）', /t >= 9 \* 60 \+ 15 && t < 9 \* 60 \+ 20 && !sentToday\(bootCheckDate, ds,/.test(s));
ok('开盘自检不再用放宽版 11:30 窗口', !/t >= 9 \* 60 \+ 15 && t < 11 \* 60 \+ 30/.test(s));
ok('旧自检窄窗 09:15-09:35 已移除', !/t >= 9 \* 60 \+ 15 && t < 9 \* 60 \+ 35/.test(s));

// ---- 置位顺序：先发后标记 ----
ok('假期全景：先 pushWecom 后置 holidaySentDate',
  /pushWecom\(msg, true\);[\s\S]{0,80}holidaySentDate = ds;/.test(s)
  && !/holidaySentDate = ds;[\s\S]{0,200}pushWecom/.test(s));
ok('周末汇总：先 pushWecom 后置 weekendSentDate',
  /pushWecom\(buildNewsDigest\(\[sat, sun\], wkLabel, 6\), true\);[\s\S]{0,80}weekendSentDate = ds;/.test(s));
ok('开盘自检：先 pushAll 后置 bootCheckDate',
  /请到面板点一次「推送自检」[\s\S]{0,120}bootCheckDate = ds;/.test(s));

// ---- 竞价「早班车」预览（2026-10-06 用户要求"竞价能不能早点推送"）----
ok('竞价预览：9:20:30 起（不可撤单阶段后）', /if \(sod < 9 \* 3600 \+ 20 \* 60 \+ 30\) return;/.test(s));
ok('竞价预览：9:25 之后交给定稿，不重复推', /if \(sod > 9 \* 3600 \+ 25 \* 60\) return;/.test(s));
ok('竞价预览：样本不足不标记已发（留给 9:25 兜底）', /if \(!au \|\| rc < 100\) return;/.test(s));
ok('竞价预览：校验快照新鲜度，拒绝非竞价时段快照',
  /if \(_mins == null \|\| _mins < 9 \* 60 \+ 15 \|\| _mins > 9 \* 60 \+ 25\) return;/.test(s));
// 只切「早班车预览」这一块来判断：写 /竞价预览[\s\S]{0,1200}?captureAuction\(true\)/ 会
// 越过边界命中下面 9:25 定稿那条自己的 force 重拉（那是它应有的行为），判成假阳性。
const iPrev = s.indexOf('竞价「早班车」预览');
const iFinal = s.indexOf('竞价异动·龙头推断推送到手机');
const segPrev = (iPrev >= 0 && iFinal > iPrev) ? s.slice(iPrev, iFinal) : '';
ok('竞价预览：不 force 全量重拉（复用 auctionLive 的 12 秒刷新）',
  iPrev >= 0 && iFinal > iPrev && !/captureAuction\(true\)/.test(segPrev));
// ⛔ 2026-10-07 df 轮改判据（钉语义不钉字符串）：这个开关以前写的是
//    `S.config.auctionPreview === false`，而 /api/config 根本不收这个键、面板也没有入口
//    → 「可在面板关掉」是一句没有任何兑现路径的空话。现在统一走 CFG_SET / cfgSetOf。
ok('竞价预览：可由开关关掉（走唯一读取入口 cfgSetOf，不再裸读 S.config）',
  /if \(!cfgSetOf\('auctionPreview'\)\) return;/.test(s));
ok('⛔ 该开关登记在 CFG_SET 里（否则又是"面板上关不掉"）',
  /const CFG_SET = \{[\s\S]{0,400}?auctionPreview:/.test(s));

// ---- 自唤醒保活 ----
ok('startSelfWake 已挂启动链', /try \{ startSelfWake\(\); \}/.test(s));

const buf = fs.readFileSync(path.join(ROOT, 'server.js'));
ok('server.js 保持 LF（无 CRLF）', buf.indexOf(Buffer.from('\r\n')) === -1);

console.log(`\n定时推送窗口守门：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
