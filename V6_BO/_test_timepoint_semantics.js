// cp 轮守门：系统里那些「以为是一回事、其实是两回事」的时间点。
// 抓到的问题：模拟盘的「持有 N 日」在三个地方用了两把尺子 ——
//   ① 到期换股判据：`Math.floor((Date.now() - pos.buyTs) / 86400000)` = **自然日**
//   ② T+1 锁：`dayKeyOf(pos.buyTs) === todayStr()` = **日期键**（自然日推进）
//   ③ 面板「持有」列：也是自然日
// 而 A 股语境下「持有 N 日」说的是**交易日**：休市日本就没有交易机会，不该算进持有期。
// 错位最狠的是长假：9/30 买入、expireDays=4，国庆连休 7 天，10/8 一复市自然日已过 8 天
// → 全部持仓被判「持有超 4 日」强制换股，而它们实际只经历过 1 个交易日，
// 卖出理由还照写「持有超4日」—— 文案在撒谎，用户只看到一批莫名其妙的卖出。
// 现在统一走 tradeDaysSince()（交易日口径），理由里把两种口径都写清楚。
// 离线、确定性：把 tradeDaysSince 抠进沙箱，用可控日历 + 固定时钟真跑。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
// 判代码一律用剥注释版本（中文注释会逐字引用旧代码/旧文案）
const SV_NOC = SV.split(/\r?\n/).map(s => { const i = s.indexOf('//'); return i >= 0 ? s.slice(0, i) : s; }).join('\n');

function fnBody(src, name) {
  const a = src.search(new RegExp('^(?:async\\s+)?function\\s+' + name + '\\s*\\(', 'm'));
  if (a < 0) return '';
  let p = src.indexOf('(', a), pd = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++; else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  return '';
}

// ── 沙箱日历：周末休市 + 2026 国庆 10/01–10/07 连休 ──────────────
const HOLI = new Set(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
function testIsTradeDay(d) {
  const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (HOLI.has(ds)) return false;
  const dow = d.getDay();
  return !(dow === 0 || dow === 6);
}
const RealDate = Date;
// ⛔ 沙箱里替换 new Date() 时，下层 `Date.now()` 也必须一起替换 —— 否则取到真实系统时间，
//    所有"距今天数"断言全部假红（踩过好几次）。
function makeDate(NOW) {
  class FakeDate extends RealDate {
    constructor(...a) { if (!a.length) super(NOW); else super(...a); }
  }
  FakeDate.now = () => NOW;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;
  return FakeDate;
}
const BODY = fnBody(SV, 'tradeDaysSince');
ok('能从源码抠出 tradeDaysSince', BODY.length > 50);
const build = (NOW) => new Function('isTradeDay', 'Date', `${BODY}\nreturn tradeDaysSince;`)(testIsTradeDay, makeDate(NOW));
const D = (s, h) => new RealDate(`${s}T${h || '12'}:00:00`).getTime();

console.log('\n【一】真跑 tradeDaysSince：休市日不推进持有天数');
// 场景 A：9/30（周三，交易日）买入，10/08（周四，复市首日）判定
const A = build(D('2026-10-08', '14'));
const buyA = D('2026-09-30', '14');
const daysA = A(buyA);
ok('国庆：9/30 买入 → 10/08 只算 1 个交易日', daysA === 1, '实际 ' + daysA);
// 同一时刻的自然日天数（旧判据用的尺子）
const natA = Math.floor((D('2026-10-08', '14') - buyA) / 86400000);
ok('[自检] 同一时刻自然日已经过了 8 天（两把尺子确实差很多）', natA === 8, '实际 ' + natA);

// 场景 B：跨普通周末不推进（周五买 → 周一判）
const B = build(D('2026-10-12', '14'));
ok('周末：周五买入 → 周一算 1 个交易日', B(D('2026-10-09', '14')) === 1);
ok('周末：周五买入 → 周日算 0 个交易日', build(D('2026-10-11', '14'))(D('2026-10-09', '14')) === 0);

// 场景 C：买入当天 = 0（T+1 当天不卖）
const C = build(D('2026-10-08', '14'));
ok('买入当天返回 0（当天不算持有一日）', C(D('2026-10-08', '09')) === 0);
ok('今天凌晨买入也返回 0', C(D('2026-10-08', '00')) === 0);

// 场景 D：连续交易日逐日推进
const E = build(D('2026-10-16', '14'));   // 周五
ok('周二买入 → 同周五算 3 个交易日', E(D('2026-10-13', '14')) === 3, '实际 ' + E(D('2026-10-13', '14')));
const F = build(D('2026-10-30', '14'));   // 周五
ok('周一买入 → 同周五算 4 个交易日', F(D('2026-10-26', '14')) === 4, '实际 ' + F(D('2026-10-26', '14')));

console.log('\n【二】异常输入不许崩、不许死循环');
const G = build(D('2026-10-08', '14'));
ok('未来时间戳（买入时间晚于现在）返回 0', G(D('2026-10-20', '10')) === 0);
ok('buyTs = 0 返回 0', G(0) === 0);
ok('buyTs = undefined 返回 0', G(undefined) === 0);
ok('buyTs = NaN 返回 0', G(NaN) === 0);
ok('buyTs = 垃圾字符串返回 0', G('not-a-time') === 0);
const neg = G(-86400000);
ok('负数 buyTs 不返回负数/NaN（有下界）', Number.isFinite(neg) && neg >= 0, '实际 ' + neg);
const far = build(D('2026-10-08', '14'))(D('2024-01-01', '10'));
ok('超长跨度不死循环且有上界（≤400）', Number.isFinite(far) && far > 0 && far <= 400, '实际 ' + far);

console.log('\n【三】★ 反证：旧的自然日写法在长假后会批量误卖');
// 复刻旧判据 vs 新判据，对同一批持仓做判定（expireDays=4，收益<2%）
function oldWouldSell(buyTs, now, expireDays) {
  return Math.floor((now - buyTs) / 86400000) >= expireDays;
}
const expireDays = 4, now08 = D('2026-10-08', '14');
const batch = [D('2026-09-28', '14'), D('2026-09-29', '14'), D('2026-09-30', '14')];
const oldSells = batch.filter(t => oldWouldSell(t, now08, expireDays)).length;
const newSells = batch.filter(t => build(now08)(t) >= expireDays).length;
ok('[自检] 旧判据把整批都判成超期（这就是 bug）', oldSells === batch.length, '旧判据卖出 ' + oldSells + '/' + batch.length);
ok('★ 新判据：长假后一律不因"超期"被卖', newSells === 0, '新判据卖出 ' + newSells);
// 真到期的仍然要卖：9/24 买入，到 10/08 中间跨了 9/25 9/28 9/29 9/30 10/08 五个交易日
const really = build(now08)(D('2026-09-24', '14'));
ok('★ 真持有满 4 个交易日的仍然会换股（没把门槛抬高成永不触发）', really >= 4, '实际 ' + really);

console.log('\n【四】判据与文案：卖它的理由必须和算它的尺子一致');
const PC = fnBody(SV_NOC, 'paperCheck');
ok('[自检] 定位到 paperCheck', PC.length > 200);
ok('到期换股判据走 tradeDaysSince', PC.indexOf('tradeDaysSince(pos.buyTs)') >= 0);
ok('★ 不再有「自然日 = 持有天数」的判据', PC.indexOf('const days = Math.floor') < 0 && PC.indexOf('days = Math.floor((Date.now()') < 0);
ok('卖出理由写明是"交易日"', /持有超\$\{cfg\.expireDays\}个交易日/.test(SV));
ok('★ 理由里同时写清自然日与休市天数（不许只写"持有超N日"）', /自然日已过\$\{natDays\}天/.test(SV) && /休市\$\{Math\.max\(0, natDays - days\)\}天/.test(SV));
ok('PAPER_CFG 注释口径已改为交易日', /N 个【交易日】|N个【交易日】/.test(SV) || /持有N个【交易日】/.test(SV));

console.log('\n【五】面板展示与卖出判据同一把尺子');
// ⛔ 别锚路由定义：持仓列表的构造在 /api/paper 路由【之前】的 snap() 里，窗口够不着
const POS_ANCHOR = 'positions: Object.values(acc.positions).map';
const pi = SV_NOC.indexOf(POS_ANCHOR);
const PAPER_API = pi >= 0 ? SV_NOC.slice(pi, pi + 1200) : '';
ok('[自检] 定位到面板持仓列表构造', PAPER_API.length > 500);
ok('面板「持有」列走 tradeDaysSince', PAPER_API.indexOf('days: tradeDaysSince(pp.buyTs)') >= 0);
ok('面板同时给出 natDays 供文案解释', PAPER_API.indexOf('natDays:') >= 0);
ok('★ 面板这列不许再退回自然日', PAPER_API.indexOf('days: Math.floor') < 0);
ok('★ 前端持仓表写的是"交易日"不是"天"', HTML.indexOf('${x.days}交易日') >= 0);
ok('前端没有残留裸的"${x.days}天"', HTML.indexOf('${x.days}天') < 0);

console.log('\n【六】T+1 锁：两把尺子为什么可以并存（前提必须写在代码里）');
const T1 = fnBody(SV_NOC, 'paperT1Locked');
ok('[自检] 定位到 paperT1Locked', T1.length > 30);
ok('T+1 锁仍是自然日口径（dayKeyOf）', T1.indexOf('dayKeyOf') >= 0);
const PCA = fnBody(SV_NOC, 'paperCheckAll');
// ⛔ gn 轮改判据（2026-10-13，用户「非交易时间买卖股票」）：闸门从 isTradeDay 收紧到
//    isTradingTime（交易日 **且** 交易时段）。T+1 自然日口径的前提是「休市日不巡检」——
//    isTradingTime 更严（休市日天然 false），前提没破，反而把「交易日收盘后/开盘前/午休
//    按陈旧收盘价巡检」这个假成交洞一并堵了。断言跟着认新口径。
// mp 轮：模拟盘侧闸门再收紧为 isContinuousTrading（连续竞价，排除集合竞价两段），语义只强不弱
ok('★ paperCheckAll 有时间闸门（T+1 自然日口径唯一的前提，gn 轮起更严，mp 轮再收紧到连续竞价）',
  PCA.indexOf('isTradingTime()') >= 0 || PCA.indexOf('isContinuousTrading()') >= 0);
ok('★ 注释写明了「这个闸门不能拆」', /这个闸门不能拆/.test(SV));
ok('★ 注释写明了休市日不会跑到 T+1 判定', /休市日压根不会跑到这儿|休市日压根不会跑/.test(SV));

console.log('\n' + '─'.repeat(60));
console.log(`结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
