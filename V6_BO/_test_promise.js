// 守门测试（de 轮 · 角度：同一个承诺在三个入口下兑现得一样吗）
//   面板上写着的「每 N 分钟识别一次」「≥N% 自动推送手机」「实时刷新(12s)」是**承诺** ——
//   用户照着它安排盯盘。而它与实现分叉时**不报错、不崩、页面照常渲染**，只是那句话从头错到尾。
//   实测分叉四处（全是"面板说一套、实现做一套"）：
//     ① 补涨龙：**同一个面板两处**各说各的 —— 卡片副标题「≥60%」、动态状态行「≥75%」，实现是 60；
//     ② 大单：面板「每2分钟识别一次」，实现 60 秒（连那行代码自己的注释都还写着"每2分钟"）；
//     ③ 精选池：面板「30分钟重算」，实现 5 分钟；
//     ④ 竞价：面板「实时刷新(12s)」，实际主轮询 5 秒、SSE 竞价事件 3 秒一推。
//   修法不是"把面板数字改对"（改对了下次还会再分叉），而是**让承诺由实现自己产出**：
//   server.js 常量 + panelNotes() 一个出口，前端只读不写。
//   另补两层前提：到线只是**入选**（还要过胜率门/条数闸门/模块节流，被拦下不补发）；
//   刷新类承诺只在 9:15–15:40 数据窗口内成立。
const fs = require('fs');
const { stripNoise } = require('./_codescan.js');

let pass = 0, fail = 0;
const ok = (name, cond, got) => {
  if (cond) { pass++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { fail++; console.log('  ❌ ' + name + (got !== undefined ? '  → ' + got : '')); }
};
const sec = t => console.log('\n' + t);

const SRC = fs.readFileSync('./server.js', 'utf8');
const SV = stripNoise(SRC, { keepStrings: true });
const HTML = fs.readFileSync('./public/index.html', 'utf8');
// ⛔ 扫"面板文案"必须剔除 APP_VER 那行版本说明 —— 它逐字引用着本轮要消灭的旧字面量
//    （「≥60%自动推送」「每2分钟」…），不剔除的话修好了反而永远红（把守门变成纪念碑）。
const HTMLX = HTML.split('\n').filter(l => !l.startsWith('const APP_VER = ')).join('\n');
// ⛔ 模板串长正文在 SV 里会被抹成空白 → 判文案一律用原始 SRC
const slice = (a, b) => {
  const i = SRC.indexOf(a), j = SRC.indexOf(b, i);
  if (i < 0 || j < 0) throw new Error('未找到锚点: ' + a);
  return SRC.slice(i, j);
};

// ---------------- ① panelNotes 沙箱真跑 ----------------
sec('【① 承诺由实现自己产出：沙箱真跑 panelNotes()】');
const pnSrc = slice('const TICK_MS = 5000;', 'function resolveWithKline');
ok('[自检] 切到承诺定义段', /const BUZHANG_PUSH_PROB = 60;/.test(pnSrc) && /function panelNotes\(\)/.test(pnSrc));
// ⛔ 沙箱注入：panelNotes 内部调 pushMinProb —— 漏装 = 整段崩掉而不是变红（同类坑已踩 12 次）
const mkPn = (minProb, src) => new Function('pushMinProb', (src || pnSrc) + '\nreturn { TICK_MS, BIGMONEY_SCAN_MS, POOL_REBUILD_MS, HOLD_WATCH_MS, BUZHANG_PUSH_PROB, ZT_INFER_PUSH_PROB, AUCZT_PUSH_PROB, AUCTION_REFRESH_S, panelNotes };')(() => minProb);
const M = mkPn(55);
const pn = M.panelNotes();

ok('bigmoney 的分钟数 = BIGMONEY_SCAN_MS 换算', pn.bigmoney === `盘中每${Math.round(M.BIGMONEY_SCAN_MS / 60000)}分钟识别一次`, pn.bigmoney);
ok('pool 的分钟数 = POOL_REBUILD_MS 换算', pn.pool === `盘中每${Math.round(M.POOL_REBUILD_MS / 60000)}分钟重算`, pn.pool);
ok('buzhang 的阈值 = BUZHANG_PUSH_PROB（面板两处曾写 60 与 75）',
  pn.buzhang === `交易时段概率≥${M.BUZHANG_PUSH_PROB}%自动推送手机`, pn.buzhang);
// ⛔ 2026-10-28：面板这块渲染的是 au.ztInfers（竞价涨停推断 auczt），阈值必须 = AUCZT_PUSH_PROB，
//    不是一进二/连板的 ZT_INFER_PUSH_PROB（55）—— 拿 55 当 auczt 闸门是永假闸，面板写了九天假承诺。
ok('ztInfer 的阈值 = AUCZT_PUSH_PROB（竞价推断专用闸门）',
  pn.ztInfer === `≥${M.AUCZT_PUSH_PROB}% 交易时段自动推送手机（模型估值，非回测胜率）`, pn.ztInfer);
ok('数值键与文案键同源（前端拿数字做高亮，不许去解析文案）',
  pn.buzhangN === M.BUZHANG_PUSH_PROB && pn.ztInferN === M.AUCZT_PUSH_PROB,
  pn.buzhangN + '/' + pn.ztInferN);
ok('auction 刷新秒数 = AUCTION_REFRESH_S（面板曾写死 12s）', pn.auction === M.AUCTION_REFRESH_S, pn.auction);
ok('tick = TICK_MS 换算', pn.tick === Math.round(M.TICK_MS / 1000), pn.tick);
ok('hold = HOLD_WATCH_MS 换算（面板曾写死「平台30秒盯盘」）', pn.hold === `每${Math.round(M.HOLD_WATCH_MS / 1000)}秒盯盘`, pn.hold);

// ---------------- ② 前提：到线只是入选 ----------------
sec('【② 光给阈值是半句话：兑现条件必须一起给】');
ok('★ gate 里带真实胜率门（读的是配置，不是写死 55）', pn.gate.indexOf('55%') >= 0, pn.gate);
ok('★ 胜率门改成 70 后 gate 跟着变（读的是真实配置）', mkPn(70).panelNotes().gate.indexOf('70%') >= 0);
ok('★ gate 说清"被拦下不补发"（否则「≥60%自动推送」是假承诺）', /被拦下不补发/.test(pn.gate));
ok('★ refreshWin 说清刷新承诺的适用窗口（休市/夜间不拉）', /9:15–15:40/.test(pn.refreshWin) && /休市/.test(pn.refreshWin), pn.refreshWin);

// ---------------- ③ 实现侧：不许再写死那几个数 ----------------
sec('【③ 实现侧：阈值与周期必须引用常量，不许再写死】');
ok('★ 补涨龙推送阈值不再写死 60（预筛选放宽到 50，让 govTake 用融合概率决策）',
  (/out\.filter\(x => x\.prob >= BUZHANG_PUSH_PROB\)/.test(SV) || /out\.filter\(x => x\.prob >= 50\)/.test(SV)) && !/x\.prob >= 60\b/.test(SV));
// ⛔ 2026-10-28 语义升级：两把尺子分开 —— auczt 用 AUCZT_PUSH_PROB（封顶 45 之内的实盘分位），
//    一进二/连板仍用 ZT_INFER_PUSH_PROB=55。四个闸门都不许再写死数字。
ok('★ 竞价涨停推断(auczt) 两处都用 AUCZT_PUSH_PROB（不再写死 55/18）',
  (SV.match(/x\.prob >= AUCZT_PUSH_PROB/g) || []).length === 2 && !/x\.prob >=? 55/.test(SV),
  (SV.match(/x\.prob >= AUCZT_PUSH_PROB/g) || []).length + ' 处');
ok('★ 一进二 / 连板 两处仍用 ZT_INFER_PUSH_PROB=55（不被 auczt 阈值连带放宽）',
  (SV.match(/useProb < ZT_INFER_PUSH_PROB/g) || []).length === 2 && /const ZT_INFER_PUSH_PROB = 55;/.test(SV),
  (SV.match(/useProb < ZT_INFER_PUSH_PROB/g) || []).length + ' 处');
ok('★ 大单扫描定时器用 BIGMONEY_SCAN_MS', /scanBigMoneyPush\(\);[\s\S]{0,80}BIGMONEY_SCAN_MS\)/.test(SV));
ok('★ 精选池定时器用 POOL_REBUILD_MS', /rebuildPool\(\);[\s\S]{0,80}POOL_REBUILD_MS\)/.test(SV));
ok('★ 持仓盯盘定时器用 HOLD_WATCH_MS', /HD\.watch\(\);[\s\S]{0,120}HOLD_WATCH_MS\)/.test(SV));
ok('★ 主循环用 TICK_MS / 板块涨停用 SECTORS_ZT_MS', /tick\(\); \}, TICK_MS\)/.test(SV) && /refreshSectorsZT\(\); \}\), SECTORS_ZT_MS\)/.test(SV));
// 反证：把常量改掉，panelNotes 与实现必须同时变（说明真的是同一份）
{
  const alt = pnSrc.replace('const BUZHANG_PUSH_PROB = 60;', 'const BUZHANG_PUSH_PROB = 72;')
    .replace('const POOL_REBUILD_MS = 5 * 60 * 1000;', 'const POOL_REBUILD_MS = 12 * 60 * 1000;');
  const A2 = mkPn(55, alt);
  ok('[反证] 改常量后承诺句跟着变（≥72% / 每12分钟）',
    A2.panelNotes().buzhang.indexOf('72%') >= 0 && A2.panelNotes().pool.indexOf('12分钟') >= 0,
    A2.panelNotes().buzhang + ' | ' + A2.panelNotes().pool);
  ok('[反证] 改常量后数值键也跟着变', A2.panelNotes().buzhangN === 72);
}

// ---------------- ④ 面板：不许再出现写死的承诺数字 ----------------
sec('【④ 面板上不许再有写死的承诺数字】');
const BAD = [
  ['补涨龙副标题写死 60%', /≥60% *自动推送/],
  ['补涨龙动态行写死 75%（与副标题自相矛盾的那句）', /≥75% *自动推送/],
  ['涨停推断写死 >55%', /&gt;55% *自动推送|>55% *自动推送/],
  ['大单写死每2分钟', /每2分钟识别一次/],
  ['精选池写死30分钟重算', /30分钟重算/],
  ['竞价写死 12s', /实时刷新\(12s\)/],
  ['持仓写死 30秒盯盘', /平台30秒盯盘/],
  ['信号空态写死每5秒', /每5秒扫描/],
];
for (const [n, re] of BAD) ok('⛔ 已无：' + n, !re.test(HTMLX));
// 反证：把承诺换回写死数字，上面那组"已无"必须重新扫出来（说明它真在检查，不是恒绿）
const broken = HTMLX.replace('${_pn.buzhang}', '交易时段概率≥60%自动推送手机')
  .replace('${_pn.pool}', '盘中每30分钟重算');
ok('[反证] 写死数字一回来，扫描立刻报出来（上面那组不是恒绿）',
  /≥60% *自动推送/.test(broken) && /30分钟重算/.test(broken));
ok('★ 补涨龙动态行读 _pn.buzhang', /\$\{_pn\.buzhang\}/.test(HTML));
ok('★ 补涨龙的兑现条件挂在 title 上', /bzTime'\)\.title = _pn\.gate/.test(HTML));
ok('★ 涨停推断读 _pn.ztInfer，高亮用 _pn.ztInferN', /\$\{_pn\.ztInfer\}/.test(HTML) && /_pn\.ztInferN/.test(HTML));
ok('★ 大单/精选池空态读 _pn', /\$\{_pn\.bigmoney\}/.test(HTML) && /\$\{_pn\.pool\}/.test(HTML));
ok('★ 竞价实时刷新读 _pn.auction', /实时刷新\(\$\{_pn\.auction\}s\)/.test(HTML));
ok('★ 持仓盯盘周期读 _pn.hold', /holdWatchNote/.test(HTML) && /_pn\.hold/.test(HTML));
ok('★ 刷新窗口说明挂到两处刷新承诺上', /sectFlowNote/.test(HTML) && /globalNote/.test(HTML) && /_pn\.refreshWin/.test(HTML));
// ⛔ const 有 TDZ：_pn 必须定义在使用点之前（踩过，整页渲染会静默中断）
ok('⛔ _pn 定义在 refresh() 里第一次使用之前（TDZ 会静默中断整页）',
  HTML.indexOf('const _pn =') > 0 && HTML.indexOf('const _pn =') < HTML.indexOf('${_pn.buzhang}')
  && HTML.indexOf('const _pn =') < HTML.indexOf('${_pn.bigmoney}'));
ok('⛔ _pn 带兜底（旧版 /api/state 没这个键时不至于 undefined）', /s\.panelNotes \|\| \{/.test(HTML));

// ---------------- ⑤ 出口：面板拿得到 ----------------
sec('【⑤ /api/state 必须下发这份承诺（前端读了后端没发 = 静默 undefined）】');
ok('★ /api/state 有 panelNotes 出口', /panelNotes: panelNotes\(\)/.test(SRC));
ok('⛔ 只在这一处拼（不许两个接口各拼一份）', (SV.match(/panelNotes: panelNotes\(\)/g) || []).length === 1);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
