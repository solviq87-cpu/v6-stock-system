// ck 轮守门：时间线自洽 —— 生成日 ≠ 适用日。
// 钉的问题：「次日作战计划」标题里写的日期是【生成日】（今天），可这份计划的语义是"给下一个交易日用的"。
//   两个方向都会读错：当天收盘后收到，看着像"今天的计划"（今天已收盘，根本执行不了）；
//   第二天早上再翻这条消息，看到昨天的日期又会当成过期计划丢掉 —— 而它恰恰是今天要用的。
//   一个日期同时代表"哪天生成的"和"哪天能用"，必然读错，必须拆成两个。
// 离线、确定性：不碰线上数据，全部注入。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
const NP = require('./nextplan');

// 取真实函数体：跳过形参表再配对花括号，并跳过字符串里的花括号
function fnBody(src, name) {
  const a = src.search(new RegExp('^(async\\s+)?function ' + name + '\\(', 'm'));
  if (a < 0) return '';
  let p = src.indexOf('(', a), pd = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++;
    else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  return '';
}
function stripComments(src) {
  return src.split('\n').map(l => {
    let out = '', inS = null;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (inS) { out += c; if (c === inS) inS = null; continue; }
      if (c === '"' || c === "'" || c === '`') { inS = c; out += c; continue; }
      if (c === '/' && l[i + 1] === '/') break;
      out += c;
    }
    return out;
  }).join('\n');
}
const CLEAN = stripComments(SV);
const BODY_ITD = fnBody(SV, 'isTradeDay');
const BODY_NTD = fnBody(SV, 'nextTradeDay');
const BODY_BNP = fnBody(SV, 'buildNextPlanMessage');

// 节假日表原样搬进沙箱（isTradeDay 依赖它）
function sliceSet(name) {
  const i = SV.indexOf('const ' + name + ' = new Set([');
  if (i < 0) return '';
  const j = SV.indexOf(']);', i);
  return SV.slice(i, j + 3);
}
const mkNTD = () => new Function('console',
  'function holidayTableWarn(){}\n' +
  sliceSet('MARKET_HOLIDAYS') + '\n' + sliceSet('MARKET_WORKDAYS') + '\n' +
  BODY_ITD + '\n' + BODY_NTD + '\nreturn { isTradeDay, nextTradeDay };'
)({ warn() {}, error() {}, log() {} });

console.log('\n【⛔⛔ 自检】');
let NTD = null;
{
  ok('自检：isTradeDay 抠得出来', BODY_ITD.length > 80, String(BODY_ITD.length));
  ok('自检：nextTradeDay 抠得出来', BODY_NTD.length > 150, String(BODY_NTD.length));
  ok('自检：buildNextPlanMessage 抠得出来', BODY_BNP.length > 200, String(BODY_BNP.length));
  ok('自检：节假日表抠得出来', sliceSet('MARKET_HOLIDAYS').indexOf('2026-10-07') > 0);
  NTD = mkNTD();
  ok('自检：沙箱里 2026-10-07 判为休市（国庆假期内）',
    NTD.isTradeDay(new Date(2026, 9, 7, 12)) === false);
  ok('自检：沙箱里 2026-10-08 判为交易日（10/8 复市）',
    NTD.isTradeDay(new Date(2026, 9, 8, 12)) === true);
}

console.log('\n【① 适用日必须是"下一个交易日"，不是今天】');
{
  const d = s => new Date(s + 'T12:00:00');
  ok('⛔ 假期最后一天(10-07)生成 → 适用日是复市日 10-08',
    NTD.nextTradeDay(d('2026-10-07')) === '2026-10-08', NTD.nextTradeDay(d('2026-10-07')));
  ok('假期中间(10-06)生成 → 跳过 10-07 落到 10-08',
    NTD.nextTradeDay(d('2026-10-06')) === '2026-10-08', NTD.nextTradeDay(d('2026-10-06')));
  ok('周五(10-09)生成 → 跳过周末落到周一 10-12',
    NTD.nextTradeDay(d('2026-10-09')) === '2026-10-12', NTD.nextTradeDay(d('2026-10-09')));
  ok('⛔ 适用日永远不等于生成日本身（否则又变成生成日）',
    NTD.nextTradeDay(d('2026-10-08')) !== '2026-10-08', NTD.nextTradeDay(d('2026-10-08')));
  ok('普通交易日(10-08)生成 → 适用日就是次日 10-09',
    NTD.nextTradeDay(d('2026-10-08')) === '2026-10-09', NTD.nextTradeDay(d('2026-10-08')));
  ok('非法输入 → 返回空串（调用方会显示"下一交易日"）',
    NTD.nextTradeDay('not-a-date') === '', JSON.stringify(NTD.nextTradeDay('not-a-date')));
}

console.log('\n【② 推送标题写适用日，不写生成日】');
{
  const b = stripComments(BODY_BNP);
  ok('⛔ 标题不再把生成日 p.date / np.date 当日期用',
    !/\$\{\s*\(p && p\.date\)/.test(b) && !/· \$\{np\.date\}/.test(b),
    (b.match(/[^\n]*date[^\n]*/) || [''])[0].slice(0, 90));
  ok('标题用的是适用日 _ad', /次日作战计划 · \$\{_ad \|\| '下一交易日'\}/.test(b));
  ok('⛔ 兜底写"下一交易日"而不是回退成今天', /_ad \|\| '下一交易日'/.test(b));
  ok('尾部把两个日期都摆出来（生成于…· 适用于…）',
    /生成于 \$\{_gd \|\| '-'\}/.test(b) && /适用于 \$\{_ad \|\| '下一交易日'\}/.test(b));
}

console.log('\n【③ 真跑：标题里的日期来自 applyDate】');
{
  const plan = { date: '2026-10-07', applyDate: '2026-10-08', count: 0, picked: [] };
  const S = { nextplan: { date: '2026-10-07', applyDate: '2026-10-08', time: '21:00:00', plan, cand: 30, universeN: 20, missKline: 10, relay: [] } };
  const NPS = { localDate: () => '2026-10-07', formatPlan: () => '(正文)' };
  const f = new Function('S', 'NP', 'relaySection', BODY_BNP + '\nreturn buildNextPlanMessage;')(S, NPS, () => '');
  const msg = f();
  const head = msg.split('\n')[0];
  ok('⛔ 标题写的是适用日 10-08（不是生成日 10-07）',
    head.indexOf('2026-10-08') > 0 && head.indexOf('2026-10-07') < 0, head);
  ok('尾部同时写清生成日', /生成于 2026-10-07/.test(msg), (msg.match(/生成于[^\n]*/) || [''])[0]);
  ok('尾部同时写清适用日', /适用于 2026-10-08/.test(msg));
  // 适用日缺失时兜底成"下一交易日"，绝不能退回生成日
  const S2 = { nextplan: { date: '2026-10-07', applyDate: '', time: '21:00:00', plan: { date: '2026-10-07', picked: [] }, cand: 0, universeN: 0, relay: [] } };
  const f2 = new Function('S', 'NP', 'relaySection', BODY_BNP + '\nreturn buildNextPlanMessage;')(S2, NPS, () => '');
  const head2 = f2().split('\n')[0];
  ok('⛔ 适用日缺失 → 标题写"下一交易日"，绝不退回生成日',
    head2.indexOf('下一交易日') > 0 && head2.indexOf('2026-10-07') < 0, head2);
}

console.log('\n【④ 正文首行同样写适用日】');
{
  const picked = [{
    code: '000001', name: '测试', price: 10, pct: 1.2, grade: 'A', score: 70, sector: '测试',
    dims: { 板块: 10, 资金: 10, 量比: 10, 技术: 10, 纪律: 10 },
    reasons: ['r'], invalid: ['i'], confirm: ['c'], risks: [], rules: [], entry: [9.8, 10.2], stop: 9.5, target: 11
  }];
  const txt = NP.formatPlan({ date: '2026-10-07', applyDate: '2026-10-08', count: 1, picked });
  const l0 = String(txt).split('\n')[0];
  ok('⛔ 正文首行写适用日 10-08', l0.indexOf('2026-10-08') > 0, l0);
  ok('⛔ 正文首行不再把生成日当计划日', l0.indexOf('2026-10-07') < 0, l0);
  ok('生成日另起一行说明', /生成于 2026-10-07/.test(String(txt)));
  ok('适用日缺失时首行兜底"下一交易日"',
    String(NP.formatPlan({ date: '2026-10-07', count: 1, picked })).split('\n')[0].indexOf('下一交易日') > 0);
}

console.log('\n【⑤ 面板也要看得见"给哪天用的"】');
{
  ok('⛔ 面板次日计划那行写"适用于"', /适用于 ' \+ _npAd/.test(HTML) || /适用于下一交易日/.test(HTML));
  ok('面板同时带生成日', /生成于 ' \+ _npGd/.test(HTML));
  ok('面板取的是 applyDate 字段', /np\.applyDate/.test(HTML));
}

console.log('\n【⑥ 反证：旧写法为什么必须改】');
{
  const old = "═══ 🗓️ 次日作战计划 · ${(p && p.date) || NP.localDate()} ═══";
  const gen = '2026-10-07', apply = '2026-10-08';
  const oldHead = old.replace('${(p && p.date) || NP.localDate()}', gen);
  ok('反证：旧标题把生成日 10-07 印在"次日计划"上（今天已收盘，读起来像今天的计划）',
    oldHead.indexOf(gen) > 0);
  ok('反证：而这份计划实际是给 10-08 用的 —— 标题与语义差一天',
    apply !== gen && oldHead.indexOf(apply) < 0);
}

console.log('\n【⑦ 复盘日期必须是"数据所属交易日"，不是"今天"】');
{
  const BODY_PTD = fnBody(SV, 'prevTradeDay');
  const BODY_RDD = fnBody(SV, 'reviewDataDay');
  const BODY_MK = fnBody(SV, 'mkReviewShell');
  ok('prevTradeDay 抠得出来', BODY_PTD.length > 150, String(BODY_PTD.length));
  ok('reviewDataDay 抠得出来', BODY_RDD.length > 200, String(BODY_RDD.length));

  const mkPrev = () => new Function('console',
    'function holidayTableWarn(){}\n' + sliceSet('MARKET_HOLIDAYS') + '\n' + sliceSet('MARKET_WORKDAYS') + '\n' +
    BODY_ITD + '\n' + BODY_PTD + '\nreturn prevTradeDay;')({ warn() {}, error() {}, log() {} });
  const prev = mkPrev();
  ok('国庆假期里(10-07)往前找 → 上一交易日是 09-30', prev('2026-10-07T12:00:00') === '2026-09-30', prev('2026-10-07T12:00:00'));
  ok('复市日(10-08)往前找 → 仍是 09-30（假期整段跳过）', prev('2026-10-08T12:00:00') === '2026-09-30', prev('2026-10-08T12:00:00'));
  ok('周一(10-12)往前找 → 周五 10-09', prev('2026-10-12T12:00:00') === '2026-10-09', prev('2026-10-12T12:00:00'));

  // 真跑 reviewDataDay：把"现在"固定到几个关键时刻
  const mkRDD = (iso) => new Function('console', 'NOW',
    'function holidayTableWarn(){}\nconst _now = new Date(NOW);\n' +
    'const Date2 = Date;\n' + sliceSet('MARKET_HOLIDAYS') + '\n' + sliceSet('MARKET_WORKDAYS') + '\n' +
    BODY_ITD + '\n' +
    // ⛔ prevTradeDay 内部也有 new Date()（from 为空时取"现在"）—— 必须一并替换成固定时刻，
    //    否则它按真实系统时间往前找，测出来的是"今天"的上一交易日而不是设定时刻的（假红）。
    BODY_PTD.replace(/new Date\(\)/g, 'new Date(NOW)') + '\n' +
    BODY_RDD.replace(/new Date\(\)/g, 'new Date(NOW)') + '\nreturn reviewDataDay;'
  )({ warn() {}, error() {}, log() {} }, iso);
  ok('⛔ 盘中 10-08 09:15（交易日但未收盘）→ 数据日是上一交易日 20260930',
    mkRDD('2026-10-08T09:15:00')() === '20260930', mkRDD('2026-10-08T09:15:00')());
  ok('⛔ 收盘后 10-08 15:30（交易日）→ 数据日就是今天 20261008',
    mkRDD('2026-10-08T15:30:00')() === '20261008', mkRDD('2026-10-08T15:30:00')());
  ok('休市日 10-07 15:30 → 数据日仍是上一交易日 20260930（不是假期当天）',
    mkRDD('2026-10-07T15:30:00')() === '20260930', mkRDD('2026-10-07T15:30:00')());
  ok('周末 10-10 10:00 → 数据日是周五 20261009',
    mkRDD('2026-10-10T10:00:00')() === '20261009', mkRDD('2026-10-10T10:00:00')());

  // 真跑 mkReviewShell：日期必须来自 reviewDataDay
  const f = new Function('S', 'reviewDataDay', BODY_MK + '\nreturn mkReviewShell;')(
    { ztPool: [{ code: '000001' }] }, () => '20260930');
  const sh = f([{ code: '000001' }]);
  ok('⛔ mkReviewShell 的 date 取自 reviewDataDay（不是 todayStr）', sh.date === '20260930', sh.date);
  ok('mkReviewShell 仍然带 time', typeof sh.time === 'string' && sh.time.length > 0);
  // 反证：旧写法盘中重算会把上一交易日的数据标成今天
  const old = { date: '20261008', items: [] };
  ok('反证：旧写法(今天)盘中重算 → 09-30 的复盘会被标成 10-08 并冒充当天',
    old.date === '20261008' && old.date !== '20260930');
}

console.log(`\n【结果】通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RESULT: OK' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
