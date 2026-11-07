'use strict';
// 「少而精」消息条数闸门单测
// 用户原话（2026-10-01）：「推送太多了啊跟菜市场一样全是票」。
// 9/30 实测送达 27 条（盘中11 + 补涨龙9 + …），原因是老闸门只按【票】计数、完全不管【消息条数】：
// 补涨龙是一只票一条消息发的。这里把"一天最多几条"钉死，防止哪次重构又放开。

const fs = require('fs');
const SRC = fs.readFileSync('./server.js', 'utf8');

function grab(startMarker, endMarker) {
  const i = SRC.indexOf(startMarker);
  if (i < 0) throw new Error('找不到起始标记: ' + startMarker);
  const j = SRC.indexOf(endMarker, i);
  if (j < 0) throw new Error('找不到结束标记: ' + endMarker);
  return SRC.slice(i, j + endMarker.length);
}

const parts = [
  grab('const MSG_CAP = {', '};'),
  grab('const MSG_COLD_FLOOR = {', '};'),   // ⛔ if 轮 D2/D4：偏冷保底线，必须连表一起进沙箱
  grab('const MSG_FREE_RE =', '\n'),
  grab('const MSG_TYPE_RE = [', '\n];'),
  grab('const MSG_STAT = {', '};'),
  // ⛔ dg 轮：_govCfg 的默认值现在从 CFG_RANGE.def 取，沙箱必须把它一起注入
  grab('const CFG_RANGE = {', '};'),
  grab('const _govCfg = k => {', '};'),
  grab('function msgGate(text, manual) {', '\n}'),
];

let DAY = '20261001';
const todayStr = () => DAY;
const S = { config: {} };
// ⛔ if 轮 D2/D4：envCold 可注入（false=常温），否则冷天分支在沙箱里永远走不到
let COLD = false;
const envCold = () => COLD;
const api = new Function('todayStr', 'S', 'envCold', parts.join('\n') + '\nreturn { msgGate, MSG_STAT, MSG_CAP, MSG_COLD_FLOOR };')(todayStr, S, envCold);

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); } };
const sec = t => console.log('\n' + t);
// ⚠️ 必须连计数一起清：msgGate 只在"机会类"分支里做跨日重置，
//    日报类（FREE）是提前 return 的，不会触发重置 —— 所以只清 day 会带上上一组的残留。
const reset = () => {
  DAY = '20261' + String(Math.floor(Math.random() * 900) + 100);
  api.MSG_STAT.day = ''; api.MSG_STAT.total = 0; api.MSG_STAT.by = {}; api.MSG_STAT.blocked = 0;
};
const send = t => api.msgGate(t).ok;

sec('① 机会类：每类都有硬上限');
{
  reset();
  ok('补涨龙第1条放行', send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n甲'));
  ok('补涨龙第2条放行（上限2）', send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n乙'));
  ok('补涨龙第3条被拦', !send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n丙'));
}
{
  reset();
  ok('盘中推送可发6条', send('═══ 📊 量化看盘·盘中推送 ═══\n1') && send('═══ 📊 量化看盘·盘中推送 ═══\n2') && send('═══ 📊 量化看盘·盘中推送 ═══\n3') && send('═══ 📊 量化看盘·盘中推送 ═══\n4') && send('═══ 📊 量化看盘·盘中推送 ═══\n5') && send('═══ 📊 量化看盘·盘中推送 ═══\n6'));
  ok('盘中推送第7条被拦', !send('═══ 📊 量化看盘·盘中推送 ═══\n7'));
}
{
  reset();
  ok('大单流入可发2条', send('═══ ⚡ 大单流入 · A/B对照 ═══\n甲') && send('═══ ⚡ 大单流入 · A/B对照 ═══\n乙'));
  ok('大单第3条被拦', !send('═══ ⚡ 大单流入 · A/B对照 ═══\n丙'));
}
{
  reset();
  ok('埋伏只发1条', send('═══ 🌱 涨停前埋伏 · 机器自学挑的 ═══\n甲'));
  ok('埋伏第2条被拦', !send('═══ 🌱 涨停前埋伏 · 机器自学挑的 ═══\n乙'));
}

sec('② 日报类不受限（用户等着看的，本来一天就一条）');
{
  reset();
  let all = true;
  for (let i = 0; i < 20; i++) all = all && send('═══ 📋 每日复盘 · 涨停形态与归因 ═══\n第' + i);
  ok('每日复盘连发20条全部放行', all);
  ok('次日作战计划放行', send('═══ 🗓️ 次日作战计划 · 2026-10-01 ═══\n甲'));
  ok('每日新闻放行', send('═══ 📰 每日新闻汇总 · 2026-09-30 ═══\n甲'));
  ok('持仓风控放行', send('═══ 🚨 持仓风控警报 · 建议立即处理 ═══\n甲'));
  ok('日报类不占条数额度', api.MSG_STAT.total === 0, 'total=' + api.MSG_STAT.total);
}

sec('③ 每日总额封顶（兜底，防止新类型绕过分类）');
{
  reset();
  const kinds = ['盘中推送', '补涨龙', '大单流入', '涨停前埋伏', '相似走势', '涨停复盘', '竞价', '模拟盘', '某某新类型'];
  let n = 0;
  for (let r = 0; r < 3; r++) for (const k of kinds) { if (send(`═══ ${k} ═══\n第${r}`)) n++; }
  ok(`一天最多发 15 条（实测发了 ${n} 条）`, n <= 15, String(n));
}

sec('④ 跨交易日重置');
{
  reset();
  send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n甲');
  send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n乙');
  ok('当天第3条被拦', !send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n丙'));
  DAY = '20261002';
  ok('换日后重新放行', send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n丁'));
}

sec('⑤ 拦截原因要说人话');
{
  reset();
  send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n甲');
  send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n乙');
  const r = api.msgGate('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n丙');
  ok('返回 ok=false', r.ok === false);
  ok('原因是"今日【补涨龙】已推 2 条，上限 2 条"', /补涨龙/.test(r.why) && /上限/.test(r.why), r.why);
}

sec('⑥ 配置可调（默认 8 条/天）');
{
  reset();
  S.config.pushDailyMsgs = 2;
  ok('改成 2 条/天后第3条被拦', send('═══ 📊 量化看盘·盘中推送 ═══\n1') && send('═══ 📊 量化看盘·盘中推送 ═══\n2') && !send('═══ 📊 量化看盘·盘中推送 ═══\n3'));
  // ⚠️ 0 是假值：_govCfg 用 Number.isFinite 判断，配 0 应落到 Math.max(1,..) 而不是崩掉
  S.config.pushDailyMsgs = 0;
  reset();
  ok('配 0 不崩（落到至少 1 条）', typeof send('═══ 📊 量化看盘·盘中推送 ═══\n1') === 'boolean');
  S.config.pushDailyMsgs = undefined;
}

sec('⑦ 手动推送豁免闸门（2026-10-02 用户定：定时器才需要少而精）');
{
  reset();
  // 事故原型：10/2 一天里「持仓已清空」这种面板上手动触发的动作被闸门拦了 5 次，
  //          用户端的观感就是"推送坏了"。手动按钮必须次次生效。
  const manualSend = t => api.msgGate(t, true).ok;
  ok('手动第1条放行', manualSend('═══ 🗑 持仓已清空 ═══\n甲'));
  ok('手动第2条放行', manualSend('═══ 🗑 持仓已清空 ═══\n乙'));
  ok('手动连发10条全部放行', Array.from({ length: 10 }, (_, i) => manualSend('═══ 🗑 持仓已清空 ═══\n' + i)).every(Boolean));
  ok('手动不占当天额度（定时任务名额不被吃掉）', api.MSG_STAT.total === 0, 'total=' + api.MSG_STAT.total);
  ok('手动放行后，定时推送仍有完整额度', send('═══ 🔥 补涨龙 · 大数据回测推算 ═══\n甲'));
  // 反向：不传 manual 的老调用回归旧行为，别把"门禁"整体拆了
  reset();
  // ⚠️ 2026-10-06：这里原本拿「持仓已清空」当示例，但它已列入免闸（force+私密的安全提醒必须
  //    必达，不能被"少而精"卡住）→ 继续用它验证"会被拦"就自相矛盾了。
  //    换一个确实没有分类的标题，才能验证闸门本身没被拆。
  ok('未标手动时第2条照样被拦（旧行为不回归）', send('═══ 🧪 未分类测试消息 ═══\n甲') && !send('═══ 🧪 未分类测试消息 ═══\n乙'));
}

sec('⑧ server.js 接线');
{
  ok('pushAll 里真的调用了 msgGate（并把 manual 传进去）', /const _mg = msgGate\(text, _manual\)/.test(SRC));
  ok('拦截后写 pushLog 流水（面板查得到）', /pushLog\('🚫 条数闸门'/.test(SRC));
  ok('拦截计数进 MSG_STAT.blocked', /MSG_STAT\.blocked\+\+/.test(SRC));
  ok('state 输出 msgs 供面板显示', /msgs: \{ total: MSG_STAT\.total/.test(SRC));
  ok('推送脚注显示今日第几条', /今日第 \$\{MSG_STAT\.total\}/.test(SRC));
}

sec('⑨ 偏冷环境：竞价/大单保底 2 条不砍半（if 轮 D2/D4，用户 2026-10-16 决策）');
{
  reset();
  COLD = true;
  S.config.pushDailyMsgs = 350;   // 总额别成为干扰项
  ok('冷天竞价第1条放行', send('═══ 🎯 竞价定稿 ═══\n甲'));
  ok('冷天竞价第2条仍放行（保底2，不砍半）', send('═══ 🎯 竞价定稿 ═══\n乙'));
  ok('冷天竞价第3条被拦（保底不是放宽到无限）', !send('═══ 🎯 竞价定稿 ═══\n丙'));
  ok('冷天大单第1条放行', send('═══ ⚡ 大单流入 · A/B对照 ═══\n甲'));
  ok('冷天大单第2条仍放行（保底2）', send('═══ ⚡ 大单流入 · A/B对照 ═══\n乙'));
  ok('冷天大单第3条被拦', !send('═══ ⚡ 大单流入 · A/B对照 ═══\n丙'));
  // 反向：没有保底的类别冷天照旧减半（埋伏 1 → floor(1/2)=0 → max(1,0)=1，仍只 1 条）
  ok('冷天埋伏仍只1条（无保底类别不减半到0也不放宽）', send('═══ 🌱 涨停前埋伏 · 机器自学挑的 ═══\n甲') && !send('═══ 🌱 涨停前埋伏 · 机器自学挑的 ═══\n乙'));
  COLD = false;
  S.config.pushDailyMsgs = undefined;
}

sec('⑩ 偏冷环境：总额仍减半（保底只作用于类别，不动总闸）');
{
  reset();
  COLD = true;
  S.config.pushDailyMsgs = 10;   // 冷天减半 → 5
  const kinds = ['盘中推送', '补涨龙', '大单流入', '涨停前埋伏', '相似走势', '涨停复盘', '竞价', '模拟盘', '某某新类型'];
  let n = 0;
  for (let r = 0; r < 3; r++) for (const k of kinds) { if (send(`═══ ${k} ═══\n第${r}`)) n++; }
  ok(`冷天一天最多发 5 条（实测 ${n} 条）`, n <= 5, String(n));
  COLD = false;
  S.config.pushDailyMsgs = undefined;
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────\n`);
process.exit(fail ? 1 : 0);
