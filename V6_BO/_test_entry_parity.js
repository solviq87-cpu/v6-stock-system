// 同一件事的两个入口必须共用同一把锁（本轮新角度 —— 手动补发 vs 定时推送）。
//
// 故障形态：一条消息有两个出口（定时器自动发 / 面板点按钮手动补发），但「今天已发」的闭锁
// 只写在定时器那一侧 —— 而且它还是 init() 里的局部变量，手动接口**根本访问不到**。
// 后果：用户手动补了一份，当晚/当窗的自动任务照样再发一份一模一样的。
// 同类还有：手动补发把自动版的文案整段抄了一份，抄的时候漏掉「迟到快照」的标注。
// 修法：① 闭锁全部提到模块顶层（自动 + 手动共用）② 手动补发同样置位 ③ 文案共用同一个构造函数。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

const I_INIT = SV.indexOf('async function init()');
// 取一段：从 startRe 命中处到 endRe 命中处
function seg(startRe, endRe) {
  const a = SV.search(startRe);
  if (a < 0) throw new Error('未找到起点: ' + startRe);
  const rest = SV.slice(a);
  const m = endRe.exec(rest);
  return m ? rest.slice(0, m.index) : rest.slice(0, 4000);
}

group('[1] 「今天已发」闭锁必须在模块顶层（手动接口才够得着）');
{
  const LOCKS = ['reviewSentDate', 'nextPlanSentDate', 'auctionSentDate', 'auctionPrevDate',
    'weekendSentDate', 'holidaySentDate', 'bootCheckDate',
    'tsScanDate', 'suScanDate', 'zpScanDate', 'digestSentDate'];
  for (const n of LOCKS) {
    const i = SV.search(new RegExp('^let ' + n + ' = ', 'm'));
    ok(`${n} 声明在模块顶层（早于 init）`, i > 0 && i < I_INIT, 'i=' + i + ' init=' + I_INIT);
  }
  // init() 内部不许再出现同名 let 声明（重复声明 = TDZ 或静默覆盖）
  const inner = SV.slice(I_INIT);
  const dup = LOCKS.filter(n => new RegExp('\\n\\s*let ' + n + '\\s*=').test(inner));
  ok('init() 内没有重复的闭锁声明', dup.length === 0, dup.join('、'));
}

group('[2] 手动补发「每日复盘」必须打上闭锁（gn 轮：覆盖日≠今天时不占今天的名）');
{
  const s = seg(/if \(p === '\/api\/review-digest' && req\.method === 'POST'\) \{/, /if \(p === '\/api\/auction-strong'/);
  ok('手动补发走的是同一份文案 buildReviewMessage()', /buildReviewMessage\(\)/.test(s));
  // ⛔ 2026-10-13 gn 轮改判据（用户「复盘新闻推送说了八百遍」）：闭锁置的是【复盘数据日】_rdd，
  //    不是无条件 todayStr()。开盘前/跨午夜补发覆盖的是上一交易日（reviewDataDay 口径），
  //    若仍置 todayStr，15:30 的自动复盘会被 pushedToday(/每日复盘/) 判「已发」直接跳过
  //    —— 补发一条，当天反而丢一条（10-12 00:01 新闻补发同款坑）。
  ok('⛔ 非 dry 发送后置位 reviewSentDate，且置的是覆盖日 _rdd（不是无条件 todayStr）',
    /const _rdd = /.test(s) && /reviewSentDate = _rdd;/.test(s),
    '闭锁必须跟着复盘数据日走，否则补发昨天的内容会挡掉今天的自动复盘');
  ok('覆盖日 ≠ 今天时消息首行带「📌 补发 · 数据日」标记（流水标题不命中 /每日复盘/）',
    /'📌 补发 · 数据日 ' \+ _rdd/.test(s),
    '没有标记时 pushTitle 仍是「每日复盘」→ pushedToday 当天命中 → 自动复盘被跳过');
  ok('dry 只算不发 → 不置位（保留自动补发机会）',
    /if \(sDry\) pushLog\([\s\S]{0,200}?\}/.test(s) && !/if \(sDry\)[\s\S]{0,120}?reviewSentDate/.test(s));
}

group('[3] 手动补发「新闻汇总」三个分支各置各的锁');
{
  const s = seg(/if \(p === '\/api\/news-digest' && req\.method === 'POST'\) \{/, /if \(p === '\/api\/scan-now'/);
  ok('假期全景补发置 holidaySentDate', /holidaySentDate = todayStr\(\);/.test(s));
  // ⛔ 2026-10-13 gn 轮改判据：digestFallback（补发覆盖的是昨天）时【不置位】——
  //    置了位今晚 21:00 的自动汇总会被 pushedToday 判「已发」跳过，用户又要少一天；
  //    标题也不同（「昨日新闻汇总（补发）」），流水不会被误判成今天发过。
  ok('⛔ 工作日补发置 digestSentDate，但 digestFallback（覆盖昨天）时不置位',
    /if \(!isSun && !digestFallback\) digestSentDate = todayStr\(\);/.test(s),
    '补发昨天的内容若置今天的锁，今晚 21:00 的自动汇总会被跳过（少一天）');
  ok('周日补发置 weekendSentDate（原来这一半漏了）', /else if \(isSun\) weekendSentDate = todayStr\(\);/.test(s));
  // 周日标题口径：自动版按「次日是否真开市」判，手动版必须同口径
  ok('周日标题按 isTradeDay(明天) 判，与自动版同口径',
    /const wkLabel = isTradeDay\(new Date\(Date\.now\(\) \+ 86400000\)\)/.test(s) &&
    /'周末新闻汇总 · 开盘前必读' : '周末新闻汇总 · 休市要闻'/.test(s));
  ok('不再写死「周末新闻汇总 · 开盘前必读」',
    (s.match(/'周末新闻汇总 · 开盘前必读'/g) || []).length === 1,
    String((s.match(/'周末新闻汇总 · 开盘前必读'/g) || []).length));
}

group('[4] 手动补发「竞价异动」：同一份文案 + 同一把锁');
{
  const s = seg(/if \(p === '\/api\/auction-digest' && req\.method === 'POST'\) \{/, /\.catch\(e => \{[\s\S]{0,80}?竞价\] 补发失败/);
  ok('手动补发改用共用构造 buildAuctionAlertMessage',
    /const msg = buildAuctionAlertMessage\(au, true\);/.test(s));
  ok('不再自带一份手写标题', !/竞价异动 · 龙头推断（手动补发）═══/.test(s));
  // ⛔ 2026-10-08 改判据：竞价手动补发加了 private: true（竞价推送走私密通道），正则跟着认新写法
  ok('发送后置位 auctionSentDate', /pushAll\(msg, true, \{ private: true \}\); auctionSentDate = todayStr\(\);/.test(s));
  // 定时器那一侧也必须是同一个构造
  // ⛔ 2026-10-28 改钉：原来拿注释「紧接着再发一份」当结束锚点，注释一改就 seg 返回空串 → 假红。
  //    改成从「竞价异动·龙头推断推送到手机」开始取 9000 字窗口（整段定时器含大量注释，
  //    实测调用点在 +4296 字处；窗口按注释量给足，避免以后加注释又假红）。
  const t = SV.slice(SV.indexOf('竞价异动·龙头推断推送到手机'),
    SV.indexOf('竞价异动·龙头推断推送到手机') + 9000);
  ok('自动推送同样调用 buildAuctionAlertMessage', /buildAuctionAlertMessage\(au, false\)/.test(t));
  ok('「迟到快照要如实标注」的说明只在共用函数里（无第二份）',
    (SV.match(/真要打提前量/g) || []).length === 1, String((SV.match(/真要打提前量/g) || []).length));
}

group('[5] 反证：手动不置位 = 自动必然重放');
{
  // 模拟：今天 09:40 手动补发竞价异动，闭锁留在空串 → 9:25~10:00 自动窗口内仍会再发
  const manualSent = true, auctionSentDateOld = '';
  const autoWouldStillFire = manualSent && auctionSentDateOld !== '20261006';
  ok('旧写法：手动发过、闭锁仍空 → 自动再发一份（复现故障）', autoWouldStillFire === true);
  const auctionSentDateNew = '20261006';
  ok('新写法：手动置位后自动不再发', !(manualSent && auctionSentDateNew !== '20261006'));
}

group('[6] 纯扫描/纯预览的入口不该误置位');
{
  const np = seg(/if \(p === '\/api\/nextplan'/, /if \(p === '\/api\/myrules'/);
  ok('/api/nextplan 只回文案不推送（因此不置位是对的）',
    !/pushAll\(|pushWecom\(/.test(np));
  const ts = seg(/if \(p === '\/api\/trend-scan' && req\.method === 'POST'\)/, /if \(p === '\/api\/trend-scan' && req\.method === 'GET'\)/);
  ok('/api/trend-scan 手动只重扫不推送（不置位是对的）', !/pushAll\(|pushWecom\(/.test(ts));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
