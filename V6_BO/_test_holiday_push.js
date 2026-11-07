// 休市推送守门测试：确保「周末/法定节假日不推票」在代码里真的有闸门，而非只靠注释许愿。
// 2026-10-02 国庆休市期用户仍收到推送，根因是 15:45-16:40 的趋势扫描推送只判时间窗、没判交易日，
// 复盘启动补发也只判星期几没判法定假日。本测试把这些出口都钉死。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}

// 1) 趋势扫描推送出口：进入回调后必须先判 isTradeDay(d)，否则休市日 15:45-16:40 照样扫照样推
ok('trend-scan 回调首判 isTradeDay(d)',
  /setInterval\(guard\('trend-scan'[\s\S]{0,260}?if \(!isTradeDay\(d\)\) return;/.test(s));

// 2) 复盘启动补发：只判星期几不够，必须排除法定假日（国庆里的周五会被 wd=5 放行）
// ⛔ dw 轮：这处 return 现在带上了 remedySkip 留痕（补救跳过=消耗机会，必须留原因）→
//    断言改成钉语义：休市日判定仍在、且必须**当场 return**（不许继续往下补发）。
ok('_reviewStartupCheck 排除法定假日 isTradeDay(d)',
  /const _reviewStartupCheck = \(\) =>[\s\S]{0,600}?if \(!isTradeDay\(d\)\)[^\n]*\breturn;/.test(s));
ok('_reviewStartupCheck 休市日跳过也要留原因（dw：补救跳过=消耗一次机会）',
  /const _reviewStartupCheck = \(\) =>[\s\S]{0,600}?isTradeDay\(d\)\)\s*\{\s*remedySkip\('reviewBoot', 'reviewNotTrade'\);/.test(s));

// 3) 竞价实时刷新：休市日不刷（避免拿旧快照当实时）
ok('auction live 刷新排除休市 isTradeDay(d)',
  /if \(wd < 1 \|\| wd > 5\) return;\s*if \(!isTradeDay\(d\)\) return;/.test(s));

// 4) 开盘自检：用 isTradeDay 而非仅星期几（休市周五不报平安）
ok('开盘自检用 isTradeDay(d) 而非仅星期几',
  /if \(isTradeDay\(d\) && t >= 9 \* 60 \+ 15/.test(s));

// 5) 反向：趋势扫描的「推送动作」不得脱离 isTradeDay 守门直接裸跑。
//    确认 15:45 那段 pushTrendScan 调用仍在 isTradeDay 之后的作用域内（即被上面的 return 拦得住）。
// ⚠️ 2026-10-06：窗口已从 15:45-16:30 放宽到 15:45-23:59（定时器 30 分钟才跑一轮，
//    原窗口只够撞上 16:00 那一轮，错过就当天全丢），并加了"今天已推"标记防重复刷。
// ⚠️ 2026-10-08 改判据：闭锁收口成 sentToday(...)，不再钉 `tsScanDate !== ds` 旧字面量
ok('15:45 推送窗口位于趋势扫描回调内（受 isTradeDay 守护）',
  /if \(t >= 15 \* 60 \+ 45 && t < 24 \* 60 && !sentToday\(tsScanDate, ds,[^)]*\)\) \{ pushTrendScan\(\); tsScanDate = ds; \}/.test(s)
  && /setInterval\(guard\('trend-scan'[\s\S]{0,400}?if \(!isTradeDay\(d\)\) return;/.test(s));

// 6) 2026-10-02 补：三条「首次扫描 setTimeout」原本裸跑无任何守门 ——
//    服务一重启就无条件执行，休市日照样生成推送（只是常被夜间静默挡住，白天就真发到手机）。
//    钉死：这三处的回调里必须先判交易日/数据窗口。
ok('相似走势首次扫描 setTimeout 有守门（isDataWindow+isTradingTime+非静默）',
  /setTimeout\(\(\) => \{\s*if \(!\((?:isDataWindow\(\) && isTradingTime\(\) && !inQuietHours\(\)|isTradeDay\(new Date\(\)\))\)\) return;[\s\S]{0,120}?scanSimilarPush\(\)/.test(s)
  && !/setTimeout\(\(\) => \{ scanSimilarPush\(\)\.catch/.test(s));

ok('埋伏(pre)首次扫描 setTimeout 有守门',
  /setTimeout\(\(\) => \{\s*if \(!\((?:isDataWindow\(\) && isTradingTime\(\) && !inQuietHours\(\)|isTradeDay\(new Date\(\)\))\)\) return;[\s\S]{0,120}?scanPrePush\(\)/.test(s)
  && !/setTimeout\(\(\) => \{ scanPrePush\(\)\.catch/.test(s));

ok('持仓盯盘 HD.watch 两条入口都有 isTradeDay 守门（休市不盯盘、不推风控警报）',
  /setInterval\(guard\('holdings'[\s\S]{0,200}?if \(!isTradeDay\(new Date\(\)\)\) return;/.test(s)
  && /setTimeout\(\(\) => \{ if \(!isTradeDay\(new Date\(\)\)\) return; HD\.watch\(\)/.test(s));

// 7) 2026-10-02 反向守门（差一点改过头）：新闻汇总**假期要照发**。
//    同一天为了治「假数据」把 isTradeDay 加到各处时，顺手把 21:00 新闻汇总也卡成了仅交易日 →
//    国庆 8 天长假一条消息都没有，用户问「怎么飞书不推送了」。
//    区别在数据源：refreshNews() 每 2 分钟抓真新闻、不受休市限制；而竞价/复盘/趋势扫描算的是
//    当日行情，休市算出来的就是节前 K 线，那些才必须闭嘴。
// ⚠️ 2026-10-05 窗口从 21:00-21:30 放宽到 21:00-23:59：托管实例闲置被回收，21:00 那一刻
//    进程常常不在，冷启动后窗口已过 → 当天汇总永久丢失。放宽后当晚任一时刻被唤醒都能补上。
// ⚠️ 2026-10-08 改判据（⛔ 断言钉语义不钉字符串）：反证原本是【全文件】扫
//    `isTradeDay(d) && t >= 21 * 60`，结果 eq 版新增的「学习日报」推送（21:55，
//    它本就该只在交易日发）躺枪 → 这条守门被打成假红。学习日报卡交易日是对的，
//    新闻汇总不卡才是要守的 —— 两者根本不在同一段代码里。
//    ⛔ 反证范围必须限定在「新闻汇总」这一段内：否则今后任何 21 点之后卡交易日的新模块
//       都会把这条守门误伤成假红（全文件反证 = 株连无辜）。
const _digestSeg = (() => {
  const i = s.indexOf('if (d.getDay() !== 0 && t >= 21 * 60');
  return i < 0 ? '' : s.slice(i, i + 400);
})();
ok('新闻汇总不再被 isTradeDay 卡住（休市日照发）',
  /if \(d\.getDay\(\) !== 0 && t >= 21 \* 60 && t < 24 \* 60 && !sentToday\(digestSentDate, ds,[^)]*\) && newsReady\(\)/.test(_digestSeg)
  && !/isTradeDay\(d\)/.test(_digestSeg));
// 长假最后一晚：每日新闻汇总主动让位给「假期开盘前全景汇总」，避免同一晚两条新闻推送重复轰炸
ok('长假最后一晚每日汇总让位给假期全景汇总（不重复推）',
  /!\s*holidayDigestShouldFire\(\(S\.news\.holidayBuf \|\| \[\]\).length\)\.fire/.test(s));
ok('休市日新闻改标「休市要闻」而不是「开盘前必读」',
  /const digestLabel = \(\) =>[\s\S]{0,320}?休市要闻 · 每日新闻汇总/.test(s));
ok('周末汇总同样按次日是否真开市决定措辞', /周末新闻汇总 · 休市要闻/.test(s));
// 反向自检：别因为放开新闻，就把依赖当日行情的闸门一起松了
ok('放松新闻的同时，竞价/复盘/趋势/盯盘仍被 isTradeDay 拦住',
  /if \(!isTradeDay\(d\)\) return;/.test(s)
  && /if \(!isTradeDay\(new Date\(\)\)\) return;/.test(s));

// 8) 2026-10-04 补：模拟盘引擎此前挂在常驻 tick 循环与池重建上，但 paperCheckAll / paperBuy
//    整段没有 isTradeDay 守门 —— 国庆休市日行情接口吐陈旧收盘价，引擎拿陈旧价判止盈/止损并买入，
//    误伤真实模拟持仓，还推了你明确不想要的「模拟仓买卖」通知。与复盘/竞价/趋势扫描同闸门。
// ⛔ 断言要钉语义不要钉字符串（已踩过多轮）：原来写死「函数体的第一行就是 isTradeDay」，
//    2026-10-07 在它前面加了一行副本闸门（isReplica 先判，cq 轮修双账），第一行就不再是它了 ——
//    闸门明明还在，断言却红了。现在只看函数体里有没有这道闸门，不看它排第几行。
const _fnHas = (sig, need) => {
  const i = s.indexOf(sig);
  if (i < 0) return false;
  // ⛔ 窗口要够大：函数体开头的中文注释动辄上千字，600 连闸门都够不着（又是一次假红）
  return new RegExp(need).test(s.slice(i, i + 3000));
};
// ⛔⛔ 2026-10-13 gn 轮改判据（用户原话「非交易时间买卖股票」反复投诉）：这两道闸门原来
//    只判**休市日**（isTradeDay），没判**交易时段** —— 交易日 20:00 / 早上 8:00 / 午休
//    11:30-13:00，行情接口吐的是陈旧收盘价，引擎却照常"买入/止盈/止损"（虚假成交）。
//    现在收紧到 isTradingTime()（= isTradeDay && 09:15-11:30 || 13:00-15:00，比 isTradeDay
//    更严、休市日天然包含在内）。断言跟着钉新语义，不再认 isTradeDay 版。
// ⛔ 2026-10-27 mp 轮改钉：模拟盘侧从 isTradingTime 再收紧到 isContinuousTrading（只认连续竞价，
//    排除开盘 09:15-09:25 / 收盘 14:57-15:00 两段集合竞价——竞价撮合价是瞬时/指示价，拿它止损=失真成交）。
//    语义是“更严”，旧断言只认 isTradingTime 这个名字 → 假红。两种都认，并把“更严”本身钉住。
ok('⛔ paperCheckAll 有时间闸门（非交易时段/集合竞价不跑止盈·止损·换股）',
  _fnHas('function paperCheckAll(pm) {', '(?:isTradingTime|isContinuousTrading)\\(\\)\\s*\\)\\s*return;'));
ok('⛔ paperBuy 有时间闸门（非交易时段/集合竞价不自动买入）',
  _fnHas('function paperBuy(key, cands, pm, reasonOf) {', '(?:isTradingTime|isContinuousTrading)\\(\\)\\s*\\)\\s*return;'));
// “更严”不能名不副实：isContinuousTrading 必须真的把两段集合竞价排除在外
ok('isContinuousTrading 确实排除集合竞价（开盘起点 09:30、收盘终点 14:57）',
  /const isContinuousTrading = \(\) => \{[\s\S]{0,600}?9 \* 60 \+ 30[\s\S]{0,200}?14 \* 60 \+ 57/.test(s));
// 「收紧到交易时段」不能名不副实：isTradingTime 自己必须先判 isTradeDay、再限时段，
// 否则把 isTradeDay 换成 isTradingTime 也只是换了个名字，休市日/非时段照样放行。
ok('isTradingTime 定义本身含 isTradeDay 且限 09:15-11:30 / 13:00-15:00',
  /const isTradingTime = \(\) => \{[\s\S]{0,400}?if \(!isTradeDay\(d\)\) return false;[\s\S]{0,1600}?m >= 9 \* 60 \+ 15 && m <= 11 \* 60 \+ 30\) \|\| \(m >= 13 \* 60 && m <= 15 \* 60\);/.test(s));
// 反向：模拟盘推送的源头 paperSell 不在 isTradeDay 守护之外裸跑（只经 paperCheck，已被 paperCheckAll 闸门覆盖）
ok('模拟盘卖出仅经 paperCheck（受 paperCheckAll 闸门守护，无裸跑出口）',
  /function paperSell\(key, code, price, reason\)/.test(s)
  && !/pushPaperDigest\([^)]*\);\s*\n\}\s*\nfunction paperCheck\(/.test(s.replace(/\s+/g, ' ')));

console.log('\n休市推送守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
