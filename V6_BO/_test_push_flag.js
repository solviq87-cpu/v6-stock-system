// 推送「先发后置位」守门测试（2026-10-06）
// ── 为什么单独立一个套件 ────────────────────────────────────────────────
// pushAll 被设计成**永不抛异常**：内部全 try/catch，被闸门拦下时只是静默 return。
// 于是「去重/当日闭锁标记」写在 pushAll 之前还是之后，行为完全相反：
//   先置位 → 条数闸门/夜间静默/副本拦截/无通道 任何一条命中，消息一条没出去，
//            但"今天已发"已打上 → 当天再也不重试 → 那条消息永久消失。
// 新闻汇总/周末汇总/假期汇总三处早就是对的，复盘/次日计划/竞价/大单/补涨龙五处是老写法。
// 本套件把 pushAll 的返回值契约 + 这五处的置位顺序钉死，防止以后改回去。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name); }
}

// ── ① pushAll 返回值契约：true=本轮已终结（可置位），false=值得下轮重试 ────────
// 只有【会自行解除】的闸门才返回 false（夜间静默）。条数闸门按天重置、副本永不外发、
// 无通道是配置问题 —— 这三种重试都是空转，必须返回 true 让本轮终结。
// ⚠️ 副本那条尤其不能搞错：返回 false 会让本地副本每 20 秒重跑一次复盘（拉涨停池+补拉K线）
//    直到午夜，等于自己打自己的数据源触发限流。
const fnBody = (s.match(/function pushAll\(text, force, opts\) \{[\s\S]*?\n\}/) || [''])[0];
ok('pushAll 函数体可定位', fnBody.length > 500);
ok('夜间静默返回 false（唯一值得重试的闸门）', /return false;\s*\/\/ 夜间静默拦下/.test(fnBody));
ok('副本拦截返回 true（本轮终结，防副本空转）', /return true;\s*\/\/ 副本：本轮终结/.test(fnBody));
ok('条数闸门返回 true（按天额度，重试无用）', /return true;\s*\/\/ 额度按天重置，当天重试无用/.test(fnBody));
ok('无通道返回 true（配置问题，重试无用）', /return true;\s*\/\/ 配置问题，重试无用/.test(fnBody));
ok('私密接管返回 true', /return true;\s*\/\/ ⛔ 私密已接管/.test(fnBody));
ok('正常路径返回 true', /\n  return true;\n\}/.test(fnBody));
ok('静默是唯一的 false 出口', (fnBody.match(/return false;/g) || []).length === 1);

// ── ② 五处「当日/节流闭锁」必须按 pushAll 返回值置位 ────────────────────────
// ⛔ 2026-10-08 改判据：复盘/次日计划/竞价全部加了 opts.private=true 走私密通道，正则跟着认新写法
ok('收盘复盘：按 pushAll 返回值闭锁',
  /if \(pushAll\(buildReviewMessage\(\), true, \{ private: true \}\) !== false\) reviewSentDate = ds;/.test(s));
ok('复盘重启补发：按 pushAll 返回值闭锁',
  /if \(pushAll\(buildReviewMessage\(\), true, \{ private: true \}\) !== false\) \{\s*\n\s*reviewSentDate = todayStr\(\);/.test(s));
ok('次日作战计划：按 pushAll 返回值闭锁',
  /if \(pushAll\(buildNextPlanMessage\(\), true, \{ private: true \}\) !== false\) nextPlanSentDate = ds;/.test(s));
// ⛔ hg 轮改判据（钉语义不钉字符串）：竞价强势票(m2)并入成功分支后，这句从单行变成块。
//    判据 = 「pushAll 在闭锁之前 + 按 !== false 判定」，单行与块两种书写都认。
ok('竞价主分支：按 pushAll 返回值闭锁',
  /if \(pushAll\(msg, false, \{ private: true \}\) !== false\)(\s*\{)?\s*\n?\s*auctionSentDate = ds;/.test(s));
// ⛔ gb 轮换判据：那条「竞价报平安」的自动推送被**删除**了，不是改写法。
//    它挂在旧的 9:25~10:00 宽窗口上 —— 10:00 还没取到快照就补发一条「快照未取到」；
//    （2026-09-29 事故同款：10:02 补抓的快照自称「9:25 竞价异动」，用户以为系统在提前发现）。
//    语义 = 「竞价时段过后不许再有竞价类自动推送出口，但失败必须留痕，不许静默消失」
//    —— 静态常见的 bl 轮原则在这里体现为 console.warn 而不是再发一条消息。
//    ⛔ if 轮改判据（钉语义不钉字符串）：D1 把窗口从「9:26 一刀切」演进成「主窗口 9:15-9:26 +
//    补发窗 9:26-9:29:59」（phase 3 里 open=法定开盘价、amtReliable，迟到但真实），收口从
//    9:26 挪到 9:30 硬断，留痕文案跟着改成「9:29:59 前未发出」。双窗口/硬断细节在
//    _test_auction_late.js 单独立套，这里只钉「报平安已删 + 留痕文案跟着新收口走」。
{
  const iFi = s.indexOf('竞价异动·龙头推断推送到手机');
  const iEnd = iFi >= 0 ? s.indexOf('一进二·竞价确认', iFi) : -1;
  const finBlk = (iFi >= 0 && iEnd > iFi) ? s.slice(iFi, iEnd) : '';
  ok('竞价块可定位', finBlk.length > 500);
  ok('竞价主窗口仍收口在 9:26（主发窗语义不变）', /t >= 9 \* 60 \+ 25 && t < 9 \* 60 \+ 26/.test(finBlk));
  ok('⛔ 竞价时段过后不再有竞价类自动推送出口（旧的「报平安」已删）',
    !/9:25 竞价异动 ═══\\n⚠️ 竞价快照未取到有效数据/.test(finBlk));
  ok('竞价取不到数据时 console.warn 留痕（不许静默消失）',
    /console\.warn\('\[竞价异动\] 9:29:59 前未发出/.test(finBlk));
  ok('窄窗口配了加密轮询（5 秒），否则 40 秒里抓不住一次全量拉取',
    /auctionBusy = false;\s*\}\s*\}\)\(\);[\s\S]{0,600}?\}, 5000\);/.test(finBlk));
}
// hw 轮：大单改成逐票发送，节流位跟着进了循环（仍然是「pushAll 返回之后才置」）
ok('大单流入：节流位挪到 pushAll 之后',
  /const _ok = pushAll\(_cardOf\(x, _kind\)[\s\S]{0,200}?\n\s*if \(_ok !== false\) \{\s*\n\s*if \(_kind === 'hot'\) bigMoneyLastPush\.hot = now;[\s\S]{0,120}?bigMoneyLastPush\.normal = now;/.test(s));
ok('补涨龙：节流位挪到 pushAll 之后',
  /const _bzOk = pushAll\(`═══ 🔥 补涨龙[\s\S]{0,700}?if \(_bzOk !== false\) S\.bzLastPush = now;/.test(s));

// ── ③ 反向断言：不许再出现「先赋值、下一行裸推」的老写法 ────────────────────
const lines = s.split(/\r?\n/);
const FLAG = /^\s*(?:[A-Za-z_$][\w$]*\.)?(?:[A-Za-z_$]*[Ss]ent(?:Date|Day|At)|[Ll]astPush|SentDate|SentDay|SentAt)\s*=\s*[^=]/;
const bad = [];
lines.forEach((ln, i) => {
  const code = ln.indexOf('//') >= 0 ? ln.slice(0, ln.indexOf('//')) : ln;
  if (!FLAG.test(code)) return;
  for (let k = i + 1; k < Math.min(i + 9, lines.length); k++) {
    const c2 = lines[k].indexOf('//') >= 0 ? lines[k].slice(0, lines[k].indexOf('//')) : lines[k];
    if (/^\s*push(All|Wecom)\(/.test(c2)) { bad.push((i + 1) + '→' + (k + 1)); break; }
    if (/^\s*(?:const|let|if|for|try|\})/.test(c2) && k > i + 1) break;
  }
});
ok('无「先置位、后裸推」残留（' + (bad.length ? bad.join(',') : '干净') + '）', bad.length === 0);

// ── ④ 被拦下时要撤回去重登记，保留下轮机会（否则等于只改了一半）────────────
// hw 轮：大单改成「每票一张卡、逐票发送」，撤回也从整批循环变成按票撤
ok('大单被拦下撤回去重', /S\.bigMoneyPushed\.delete\(x\.code\);/.test(s));
// ⛔ 2026-10-06：这段从 `else for (...)` 单行改成 `else { … }` 块 ——
//    因为被拦下时除了撤去重，还要退【占位】（govReleaseAll + modDayRelease），
//    只撤去重不撤占位的话，票仍被记成"今天已推过"，下轮照样推不出来。
ok('补涨龙被拦下撤回去重', /S\.bzPushed\.delete\(x\.code\)/.test(s));
ok('⛔ 补涨龙被拦下时连占位一起退（只撤去重等于白撤一半）',
  /else \{[\s\S]{0,260}?S\.bzPushed\.delete\(x\.code\)[\s\S]{0,200}?govReleaseAll\(_bzUndo\)/.test(s));
// hw 轮：undo 从整批 _bmUndo 改成每张卡自己的 x._u（一张失败只退这一张，不连坐）
ok('⛔ 大单被拦下时也退占位（原本只撤了 bigMoneyPushed）',
  /govReleaseAll\(x\._u\);\s*\n\s*modDayRelease\('bigmoney'\)/.test(s));

console.log('\n推送先发后置位守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
