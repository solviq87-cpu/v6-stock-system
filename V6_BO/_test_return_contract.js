// 返回值契约守门测试（本轮角度：返回值的契约是否处处成立）。
// 项目里有一类判定是「用返回值代表成败」：
//   `if (pushAll(...) !== false) reviewSentDate = ds;`  ← 推送没出去就别闭锁，下轮还能重试
// 这条契约成立的前提是：被调用方在"没做成"的时候**真的返回 false**。一旦它在某个分支上
// 返回 true 或 undefined，`undefined !== false` 为真 → 调用方以为成功了 → 打上"今天已发"
// → 那条必达消息当天永久消失，而且连一条报错都没有。
// 本测试做的事：
//   ① 把 msgGate 从源码原样切出来，在受控额度下真跑，验证"必达消息确实不会被闸门拦"；
//   ② 每条修复配一条「旧写法会怎样」的反证；
//   ③ 钉死 pushAll 的返回值语义（false 只留给会自行解除的闸门）；
//   ④ 钉死「先发后置位」的顺序（反过来写 = 被拦下就永久蒸发）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const code = stripNoise(src);          // 等长剥离：注释/字符串/正则都涂成空格

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// 从源码里原样取一段（正则匹配起点，括号/分号配对到语句结束）
function take(re) {
  const m = re.exec(src);   // 用原始源码：正则字面量本身要保留（stripNoise 会把它涂掉）
  if (!m) throw new Error('未找到片段: ' + re);
  return m[0];
}
// 取一个函数块（括号配对）
function grab(re) {
  const m = re.exec(src);
  if (!m) throw new Error('未找到函数: ' + re);
  const s = src.indexOf('{', m.index);
  let depth = 0;
  for (let i = s; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(m.index, i + 1); }
  }
  throw new Error('括号未闭合: ' + re);
}

const SRC_CAP = take(/const MSG_CAP = \{[\s\S]*?\};/);
const SRC_FREE = take(/const MSG_FREE_RE = \/.+?\/;/);
const SRC_TYPE = take(/const MSG_TYPE_RE = \[[\s\S]*?\n\];/);
const SRC_STAT = take(/const MSG_STAT = \{[\s\S]*?\};/);
const SRC_GATE = grab(/function msgGate\(text, manual\)/);

// 用受控的今天与配置把 msgGate 跑起来
function mkGate() {
  const body = SRC_CAP + '\n' + SRC_FREE + '\n' + SRC_TYPE + '\n' + SRC_STAT + '\n' + SRC_GATE
    + '\nreturn { gate: msgGate, stat: MSG_STAT, cap: MSG_CAP };';
  return new Function('todayStr', '_govCfg', body)(
    () => '20261006',
    (k, d) => d            // 配置全走默认值
  );
}

// ══ [1] 9:20 竞价预览不许吃掉 9:25 定稿的额度 ═══════════════════════════════
group('[1] 竞价预览 vs 竞价定稿：各占各的额度');
{
  const g = mkGate();
  const prev = '═══ 📯 竞价预览 · 9:20 不可撤单阶段 ═══';
  const fin = '═══ 📯 9:25 竞价异动 · 龙头推断 ═══';
  const r1 = g.gate(prev, false);
  const r2 = g.gate(fin, false);
  ok('预览先发 → 放行，归类=竞价预览', r1.ok === true && r1.kind === '竞价预览');
  ok('⛔ 定稿随后发 → 仍放行，归类=竞价', r2.ok === true && r2.kind === '竞价');
  ok('两者各自只占 1 条额度', g.stat.by['竞价预览'] === 1 && g.stat.by['竞价'] === 1);
}
// 反证：旧写法（没有「竞价预览」这一类，两条都归「竞价」）→ 定稿被拦下
{
  // ⛔ 2026-10-27：hg 轮把【竞价】额度从 1 提到 2（预览+定稿+强势票三条里总要发得出去两条），
  //    旧的反证只摘掉「竞价预览」一类，cap=2 时定稿仍然放行 → 反证失效（假红）。
  //    想复现当年那个 bug，必须同时把额度压回 1 —— 那才是「两条抢一个名额」的历史现场。
  const oldType = SRC_TYPE.replace(/\[\/竞价预览\/, '竞价预览'\],\n/, '');
  const oldCap = SRC_CAP.replace(/竞价预览: \d+, /, '').replace(/竞价: \d+,/, '竞价: 1,');
  const old = new Function('todayStr', '_govCfg',
    oldCap + '\n' + SRC_FREE + '\n' + oldType + '\n' + SRC_STAT + '\n' + SRC_GATE
    + '\nreturn { gate: msgGate, stat: MSG_STAT };')(() => '20261006', (k, d) => d);
  const r1 = old.gate('═══ 📯 竞价预览 · 9:20 不可撤单阶段 ═══', false);
  const r2 = old.gate('═══ 📯 9:25 竞价异动 · 龙头推断 ═══', false);
  ok('反证：旧写法下预览与定稿同归「竞价」→ 定稿被拦（这就是它永久消失的原因）',
    r1.ok === true && r2.ok === false && r2.kind === '竞价');
}
ok('⛔ 源码里「竞价预览」必须排在「竞价」之前（命中即停，顺序反了等于没加）',
  SRC_TYPE.indexOf('竞价预览') >= 0 && SRC_TYPE.indexOf('竞价预览') < SRC_TYPE.indexOf("'竞价'"));

// ══ [2] 错过就补不回来的汇总必须免配额 ══════════════════════════════════════
group('[2] 周末汇总 / 假期全景：错过多补不回来，必须免配额');
{
  const g = mkGate();
  // 先把「其它」那 1 条额度和当日总额度全部占满，模拟"盘中已经推了一天"的最坏情况
  g.gate('═══ 某个没分类的消息 ═══', false);
  const wk = '═══ 📰 周末新闻汇总 · 开盘前必读 · 2026-10-04/2026-10-05 ═══';
  const hd = '═══ 📰 假期要闻全景 · 开盘前必读 · 2026-10-01/2026-10-07 ═══';
  ok('⛔ 其它额度已占满时，周末汇总仍放行', g.gate(wk, false).ok === true);
  ok('⛔ 其它额度已占满时，假期全景仍放行', g.gate(hd, false).ok === true);
  ok('免配额不占 MSG_STAT 计数', g.stat.by['其它'] === 1);
}
// 反证：旧 MSG_FREE_RE（不含周末新闻汇总 / 假期要闻全景）会被挤掉
{
  const oldFree = SRC_FREE.replace('|周末新闻汇总|假期要闻全景', '');
  const old = new Function('todayStr', '_govCfg',
    SRC_CAP + '\n' + oldFree + '\n' + SRC_TYPE + '\n' + SRC_STAT + '\n' + SRC_GATE
    + '\nreturn { gate: msgGate, stat: MSG_STAT };')(() => '20261006', (k, d) => d);
  old.gate('═══ 某个没分类的消息 ═══', false);
  ok('反证：旧写法下周末汇总落进「其它」→ 被 1 条额度挤掉（跨午夜就永久丢失）',
    old.gate('═══ 📰 周末新闻汇总 · 开盘前必读 ═══', false).ok === false);
}

// ══ [3] pushAll 的返回值语义 ════════════════════════════════════════════════
group('[3] pushAll 返回值语义：false 只留给「会自行解除」的闸门');
ok('夜间静默（且非 force）→ false', /if \(inQuietHours\(\) && !force\)[\s\S]{0,700}?return false;/.test(src));
ok('条数闸门拦下 → true（额度按天重置，重试是空转）',
  /if \(!_mg\.ok\) \{[\s\S]{0,300}?return true;/.test(src));
// ⛔ dl 轮改判据：原来钉 {0,600} / {0,200} 的字符窗口，本轮在这两处 return true 之前
//    各插了一行 _pushLast（登记「返回 true 但没送达」），窗口被撑爆 → 假红。
//    钉语义：整段 if 分支里只能有 return true，不许有 return false。
const _pb = src.slice(src.indexOf('function pushAll(text, force, opts) {'));
const _branch = anchor => {
  const i = _pb.indexOf(anchor);
  if (i < 0) return '';
  return _pb.slice(i, _pb.indexOf('\n  }', i));
};
{
  const b1 = _branch('if (isReplica()');
  ok('副本拦截 → true（副本永不外发，返回 false 会让本地每 20 秒重跑复盘烧数据源）',
    b1.length > 0 && /return true;/.test(b1) && !/return false;/.test(b1));
  const b2 = _branch('if (!feishuReady()');
  ok('未配置通道 → true（配置问题，重试一万次也发不出去）',
    b2.length > 0 && /return true;/.test(b2) && !/return false;/.test(b2));
}
ok('⛔ 返回值语义已写在 pushAll 上方注释里（后来人一眼能看到契约）',
  /返回值语义[\s\S]{0,60}?本轮是否已终结/.test(src));
// 关键推论：force=true 时静默被绕过 → `!== false` 恒成立 → 必达只能靠免配额
group('[3b] 推论：force=true 的必达消息必须免配额，否则"返回 true"是假的送达');
const FREE_SRC = SRC_FREE.replace('const MSG_FREE_RE = ', '').replace(/;$/, '').trim();
const FREE = new RegExp(FREE_SRC.slice(1, -1));   // 去掉正则字面量两侧的 /
const mustTitles = [
  ['每日复盘', '═══ 📋 每日复盘 · 涨停形态与归因 ═══'],
  ['次日作战计划', '═══ 🗓️ 次日作战计划 · 2026-10-06 ═══'],
  ['每日新闻汇总', '═══ 📰 每日新闻汇总 · 2026-10-06 ═══'],
  ['周末新闻汇总', '═══ 📰 周末新闻汇总 · 开盘前必读 ═══'],
  ['假期要闻全景', '═══ 📰 假期要闻全景 · 开盘前必读 ═══'],
  ['开盘自检', '═══ 📡 开盘自检 · 2026-10-06 ═══'],
];
for (const [label, head] of mustTitles) ok(`必达「${label}」命中免配额`, FREE.test(head));
ok('⛔ 竞价定稿本身不是免配额，但它独占【竞价】额度（预览另有自己的额度）',
  !FREE.test('═══ 📯 9:25 竞价异动 · 龙头推断 ═══') && /竞价:\s*[1-9]/.test(SRC_CAP));

// ══ [4] 先发后置位：置位不许写在推送之前 ════════════════════════════════════
group('[4] 先发后置位（反过来 = 被拦下就永久蒸发）');
const lines = src.split('\n');
const codeLines = code.split('\n');      // 剥掉注释后的等长版本：注释里举的例子不算数
// 向前找「属于这次闭锁的那次推送」；找不到再向后找（向后 = 先置位后发 = 违规）
function nearestPush(i, dir) {
  for (let k = 0; k <= 10; k++) {
    const j = dir < 0 ? i - k : i + k;
    if (j < 0 || j >= lines.length) return null;
    const m = /pushAll\(|pushWecom\(/.exec(lines[j]);
    if (!m) continue;
    if (j < i) return { line: j, col: m.index };
    if (j === i && dir < 0 && m.index < (/(\w*SentDate)\s*=/.exec(lines[i]) || { index: 1e9 }).index) return { line: j, col: m.index };
    if (j > i) return { line: j, col: m.index };
  }
  return null;
}
let checked = 0, bad = 0;
for (let i = 0; i < lines.length; i++) {
  const m = /(\w*SentDate)\s*=\s*(ds|todayStr\(\))/.exec(lines[i]);
  if (!m) continue;
  if (!/(\w*SentDate)\s*=\s*(ds|todayStr\(\))/.test(codeLines[i] || '')) continue;   // 注释里的例子，跳过
  // 有意闭锁且明确不推的分支（如"今天不是交易日 → 闭锁且不推"）：本轮就没有推送，不算违规
  if (/\{\s*\w+SentDate\s*=\s*(ds|todayStr\(\))\s*;\s*return;\s*\}/.test(codeLines[i] || '')) continue;
  const before = nearestPush(i, -1);
  const after = nearestPush(i, +1);
  if (!before && !after) continue;      // 附近没有推送（如"今天不是交易日：闭锁且不推"），属有意闭锁
  checked++;
  if (!before && after) { bad++; console.log(`  ⚠️ 行 ${i + 1} 先置位后发：${lines[i].trim().slice(0, 70)}`); }
}
ok(`⛔ 所有带推送的 *SentDate 置位都在推送之后（共 ${checked} 处）`, bad === 0 && checked >= 4);
// ⛔ 2026-10-08 改判据：复盘/次日计划加了 opts.private=true 走私密通道，正则跟着认新写法
ok('复盘的置位写在 pushAll 之后', /if \(pushAll\(buildReviewMessage\(\), true, \{ private: true \}\) !== false\) reviewSentDate = ds;/.test(src));
ok('次日计划的置位写在 pushAll 之后', /if \(pushAll\(buildNextPlanMessage\(\), true, \{ private: true \}\) !== false\) nextPlanSentDate = ds;/.test(src));
// 反证：先置位后发会被闸门吃掉且当天不再重试
ok('反证：若先置位，被条数闸门拦下时"今天已发"已打上 → 当天不会重试（所以顺序不能反）',
  /条数闸门[\s\S]{0,400}?return true;/.test(src));

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
