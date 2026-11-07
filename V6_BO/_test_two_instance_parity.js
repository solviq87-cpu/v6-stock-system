// cq 轮守门：primary 与 replica 两个实例对同一件事的认知是不是一致。
// 抓到的问题（都是"不报错、不提示，只是两边各自以为自己对"）：
//   ①⛔⛔ **模拟盘在两个实例上各跑一套账**：paperCheckAll 的三处调用（建池后兜底 / 主循环 tick /
//      面板 mod=paper）**全都没有 isReplica() 闸门**，而自动成交走内部 paperBuy/paperSell，
//      压根不经过 /api/paper 路由 → 同步链路只转发面板手工操作，看不见自动成交。
//      推送/学习/保活/趋势扫描都判了副本，唯独模拟盘漏了。修法不是把成交也转发出去
//      （那还要处理顺序颠倒与失败重放），而是**确立唯一权威：模拟盘只在线上跑，副本回拉展示**。
//   ② **配置改了不同步**：/api/config 没有转发，而【推送是线上发的】—— 在电脑面板把胜率门槛
//      调成 65，本机面板显示 65、回"保存成功"，手机收到的推送仍按 55 来。
//      ⛔⛔ 转发必须剔除 pushRole（写成 replica = 线上从此不推）与 syncUpstream（同步回环）。
//   ③ **降级路径没被照顾**：副本上点「模拟盘🔄」照旧调 paperCheckAll = 彻底没反应。
// 离线、确定性：把 paperCheckAll / pullPaperDownstream 抠进沙箱真跑，其余静态钉死。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
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

console.log('\n【一】真跑 paperCheckAll：副本实例不许自己跑模拟盘');
const PC_ALL = fnBody(SV_NOC, 'paperCheckAll');
ok('[自检] 能抠出 paperCheckAll', PC_ALL.length > 80);
// ⛔ gn 轮（2026-10-13，用户「非交易时间买卖股票」）：第二道闸门从 isTradeDay 收紧到
//    isTradingTime（交易日且交易时段）—— 收盘后/开盘前/午休行情接口吐陈旧收盘价，
//    按陈旧价止盈/止损/换股 = 假成交。沙箱注入名跟着改（漏注入 = ReferenceError 崩 suite）。
// ⛔ 2026-10-27 mp 轮：模拟盘时间闸门二段收紧——paper 侧从 isTradingTime（交易日+09:15-11:30/13:00-15:00）
//    再收紧到 isContinuousTrading（只认连续竞价，排除开盘 09:15-09:25、收盘 14:57-15:00 两段集合竞价）。
//    沙箱注入名跟着改（漏注入 = ReferenceError 崩 suite，本轮就是这样红的）。
const runPaperCheckAll = (isReplica, isContinuousTrading, srcBody) => {
  const called = [];
  const fn = new Function('isReplica', 'isTradingTime', 'isContinuousTrading', 'paperCheck', 'S',
    (srcBody || PC_ALL) + '\nreturn paperCheckAll;')(isReplica, isContinuousTrading, isContinuousTrading, (k, pm) => called.push(k), {});
  fn(new Map());
  return called;
};
ok('副本(isReplica=true)：一个账户都不巡检', runPaperCheckAll(() => true, () => true).length === 0);
ok('线上(isReplica=false)且交易时段：两个账户都巡检', runPaperCheckAll(() => false, () => true).length === 2);
// ⛔ gn 轮新增用例：线上 + 非交易时段（休市日/收盘后/开盘前/午休）→ 一个都不巡检。
//    旧口径只判休市日，交易日 20:00 照旧按陈旧收盘价巡检（用户投诉的假成交）。
ok('⛔ 线上但非交易时段（含收盘后/开盘前/午休/休市日）：不巡检（gn 轮新闸门）', runPaperCheckAll(() => false, () => false).length === 0);
// 反证：把副本闸门那一行删掉 → 副本立刻开始自己买卖（说明闸门真实存在且有效）
// ⛔ 2026-10-07 修：正则原本只认 `if (isReplica()) { ... }` 花括号形式，而 cr 轮清死赋值时
//    把它收成了单行 `if (isReplica()) return;` → 正则匹配不上 → 自检失败（假红，闸门其实还在）。
//    判据要钉【语义】(删掉这条 isReplica 语句) 而不是钉【写法】，两种形式都得能吃。
const noGate = PC_ALL.replace(/if \(isReplica\(\)\)\s*(?:\{[^{}]*\}|[^;]*;)\s*/, '');
ok('[自检] 反证用的"删掉闸门"确实改了代码', noGate !== PC_ALL);
ok('★ 反证：删掉副本闸门后，副本也会自己跑模拟盘（正是本次要堵的双账）', runPaperCheckAll(() => true, () => true, noGate).length === 2);
// ⛔ gn 轮：顺序判据的第二道闸门改名 isTradingTime（语义不变：先判身份再判时间）
// 时间闸门现在可能叫 isTradingTime 或 isContinuousTrading：取两者中真实出现的位置比顺序（钉语义不钉名字）
const _timeGateIdx = (() => {
  const a = PC_ALL.indexOf('isTradingTime('), b = PC_ALL.indexOf('isContinuousTrading(');
  return a < 0 ? b : (b < 0 ? a : Math.min(a, b));
})();
ok('副本闸门写在时间闸门之前（先判身份再判休市/时段）',
  PC_ALL.indexOf('isReplica()') >= 0 && _timeGateIdx > 0 && PC_ALL.indexOf('isReplica()') < _timeGateIdx);
// ⛔ gn 轮反证②：把时间闸门删掉 → 非交易时段也开始巡检（陈旧价假成交回来了）
const noTimeGate = PC_ALL.replace(/if \(!(?:isTradingTime|isContinuousTrading)\(\)\)[^;]*;/, '');
ok('[自检] 反证用的"删掉时间闸门"确实改了代码', noTimeGate !== PC_ALL);
ok('★ 反证：删掉时间闸门后，非交易时段也按陈旧价巡检（正是 gn 轮要堵的）', runPaperCheckAll(() => false, () => true, noTimeGate).length === 2);

console.log('\n【二】真跑 pullPaperDownstream：副本回拉线上权威账');
const PP = fnBody(SV_NOC, 'pullPaperDownstream');
ok('[自检] 能抠出 pullPaperDownstream', PP.length > 200);
// ⛔ du 轮补：pullPaperDownstream 现在走唯一归并出口 paperMergeTrades（依赖 dataCapOf / DATA_CAP），
//    沙箱漏一个符号 = 整段回拉静默失败（被外层 catch 吞掉，表现为"现金没被覆盖"而不是报错）。
// ⛔ dy 轮补：paperMergeTrades 入口先调 repairTradeSide 修 side 乱码再判重，同样漏注入=崩。
const CAP_SRC = (SV.match(/const DATA_CAP = \{[\s\S]*?\n\};/) || [''])[0];
const MERGE_HELPERS = CAP_SRC + '\n' + fnBody(SV_NOC, 'dataCapOf') + '\n' +
  fnBody(SV_NOC, 'paperTradeKey') + '\n' + fnBody(SV_NOC, 'repairTradeSide') + '\n' +
  fnBody(SV_NOC, 'paperMergeTrades') + '\n';
// 沙箱：注入 _syncGet / PAPER / savePaper / _syncLog / isReplica / S / _pullPaper
function mkPull(opts) {
  const state = { saved: 0, getN: 0, synced: null };
  const PAPER = {
    pool: { enabled: true, cash: 1, realized: 2, positions: {}, trades: opts.localTrades || [] },
    pre: { enabled: false, cash: 3, realized: 4, positions: {}, trades: [] }
  };
  const _pullPaper = { lastOkAt: 0, lastTryAt: 0, lastErr: '', busy: !!opts.busy };
  const _syncGet = async () => { state.getN++; if (opts.throwIt) throw new Error('超时'); return opts.resp; };
  const fn = new Function('_syncGet', 'PAPER', 'savePaper', '_syncLog', 'isReplica', 'S', '_pullPaper',
    MERGE_HELPERS + PP + '\nreturn pullPaperDownstream;')(_syncGet, PAPER, () => { state.saved++; return true; }, () => {},
    () => opts.replica !== false, { config: { syncUpstream: opts.off ? {} : { enabled: true, url: 'https://x', token: 't' } } }, _pullPaper);
  return { fn, PAPER, state, _pullPaper };
}
const goodResp = {
  ok: true, paper: {
    pool: { enabled: true, cash: 111, realized: 222, positions: [{ code: '600000', shares: 100 }], trades: [{ t: 999, code: '600000', side: '买入' }] },
    pre: { enabled: true, cash: 333, realized: 444, positions: [], trades: [] }
  }
};
(async () => {
  // ① 非副本：连请求都不发
  let a = mkPull({ replica: false, resp: goodResp });
  await a.fn();
  ok('非副本实例不做回拉（一个请求都不发）', a.state.getN === 0 && a.PAPER.pool.cash === 1);

  // ② 未配置同步：不发
  let b = mkPull({ resp: goodResp, off: true });
  await b.fn();
  ok('未配置同步目标时静默跳过', b.state.getN === 0);

  // ③ 上一轮还在跑（busy）：不重入
  let c = mkPull({ resp: goodResp, busy: true });
  await c.fn();
  ok('busy 防重入（不与定时器那路并发）', c.state.getN === 0);

  // ④ 正常回拉：覆盖现金/持仓并落盘
  let d = mkPull({ resp: goodResp });
  await d.fn();
  ok('回拉成功 → 现金被线上那份覆盖', d.PAPER.pool.cash === 111 && d.PAPER.pre.cash === 333);
  ok('回拉成功 → 持仓数组还原成 {code:pos} 对象', !!(d.PAPER.pool.positions['600000']));
  ok('回拉成功 → 已落盘', d.state.saved === 1);
  ok('回拉成功 → busy 已复位（finally）', d._pullPaper.busy === false);

  // ⑤ 失败安全边界：线上报错 → 本地一个字都不动
  let e = mkPull({ throwIt: true, resp: null });
  await e.fn();
  ok('★ 拉不到线上 → 本地原样不动（不许拿空数据覆盖）', e.PAPER.pool.cash === 1 && e.state.saved === 0);
  ok('失败后 busy 也必须复位（否则永久卡死）', e._pullPaper.busy === false);

  // ⑥ 线上返回 ok:false → 也必须不动
  let f = mkPull({ resp: { ok: false, error: 'x' } });
  await f.fn();
  ok('线上回 ok:false → 本地不动', f.PAPER.pool.cash === 1 && f.state.saved === 0);

  // ⑦ ⛔ 成交流水不许被截短：线上只带最近 30 条，本地存着 300 条
  const local300 = Array.from({ length: 300 }, (_, i) => ({ t: 10000 + i, code: 'C' + i, side: '买入' }));
  const online30 = Array.from({ length: 30 }, (_, i) => ({ t: 50000 + i, code: 'N' + i, side: '卖出' }));
  let g = mkPull({
    localTrades: local300.slice(),
    resp: { ok: true, paper: { pool: { enabled: true, cash: 9, realized: 9, positions: [], trades: online30 }, pre: { enabled: false, cash: 0, realized: 0, positions: [], trades: [] } } }
  });
  await g.fn();
  const tr = g.PAPER.pool.trades;
  ok('★ 本地 300 条流水没有被线上的 30 条整段覆盖', tr.length === 300, '实际 ' + tr.length);
  // 判据改钉语义（du 轮）：去重键现在是「成交身份键」t|code|side|shares|amount ——
  //    只有真正同一笔才去重，同一毫秒同票同方向但金额不同的两笔不许被并掉。
  ok('★ 线上新成交被并进来了（同一笔才去重：t|code|side|shares|amount）', tr.some(x => x.code === 'N0'));
  // 总量超过 300 时按"最新优先"裁掉最老的（与 paperBuy/paperSell 的 unshift+pop 同一口径），
  // 所以断言的是【本地较新的记录仍在】，而不是"一条都不能少"。
  ok('本地原有流水大部仍在（只按 300 上限裁掉最老的）', tr.some(x => x.code === 'C299') && tr.length === 300, '长度 ' + tr.length);
  ok('流水按时间倒序（新的在前）', tr[0] && tr[0].t >= tr[tr.length - 1].t);

  console.log('\n【三】两个实例的展示口径必须同源');
  ok('抽出了共用的 paperSnap()', /function paperSnap\(/.test(SV));
  const stIdx = SV_NOC.indexOf("p === '/api/state'");
  const ST = SV_NOC.slice(stIdx, stIdx + 9000);
  ok('[自检] 定位到 /api/state', stIdx > 0);
  ok('★ /api/state 用 paperSnap（不再各写一份快照）', ST.indexOf('paperSnap(') >= 0);
  ok('/api/state 不再内联重复的 mkPaper 构造', ST.indexOf('const eq = paperEquity') < 0);
  const gi = SV_NOC.indexOf("p === '/api/paper' && req.method === 'GET'");
  ok('[自检] 定位到 GET /api/paper', gi > 0);
  const GI = SV_NOC.slice(gi, gi + 700);
  ok('GET /api/paper 也用同一个 paperSnap', GI.indexOf('paperSnap(') >= 0);
  ok('★ GET /api/paper 有私密闸门（模拟盘与真实持仓同级）', GI.indexOf('isEditorReq') >= 0);

  console.log('\n【四】配置：改了得让线上知道（转发时身份字段必须剔除）');
  const ci = SV_NOC.indexOf("p === '/api/config' && req.method === 'POST'");
  ok('[自检] 定位到 /api/config', ci > 0);
  const CFG = SV_NOC.slice(ci, ci + 14000);
  // 自检要钉"切片里确实有落盘返回那一段"，别钉长度（长度会随注释/代码增长而漂移）
  ok('[自检] 切片覆盖到落盘返回处', CFG.indexOf("'保存失败: '") >= 0 && CFG.indexOf('delete _fw.pushRole') >= 0);
  ok('★ 配置保存成功后会转发给线上', /syncUpstream\('\/api\/config'/.test(CFG));
  ok('★ 转发前剔除 pushRole（写成 replica = 线上从此不推）', /delete _fw\.pushRole/.test(CFG));
  ok('★ 转发前剔除 syncUpstream（否则同步回环）', /delete _fw\.syncUpstream/.test(CFG));
  ok('★ 转发前剔除 token（本机同步凭据不外泄）', /delete _fw\.token/.test(CFG));
  ok('转发用的是副本对象（不改动原请求体）', /Object\.assign\(\{\}, c\)/.test(CFG));
  // 转发只能发生在副本上：syncUpstream 内部硬判
  const SY = fnBody(SV_NOC, 'syncUpstream');
  ok('★ syncUpstream 内部硬判副本（线上是终点，绝不回环）', SY.indexOf("!== 'replica') return") >= 0 || SY.indexOf("!== 'replica'") >= 0);

  console.log('\n【五】降级路径必须被照顾（副本上点🔄不能没反应）');
  const rf = SV_NOC.indexOf("const tasks = [];");
  const RF = SV_NOC.slice(rf, rf + 4000);
  ok('[自检] 定位到 /api/refresh 任务块', rf > 0);
  ok('★ 副本上 mod=paper 改为回拉线上（不是照旧调 paperCheckAll）', /isReplica\(\)\) \{\s*tasks\.push\(_g\('paper', pullPaperDownstream\)\)/.test(RF) || (RF.indexOf('pullPaperDownstream') >= 0 && RF.indexOf('isReplica()') >= 0));
  ok('★ 降级说明会回给前端（note 字段）', /_refreshNote/.test(RF) && /note: \[_refreshNote/.test(RF));
  ok('原有 skipped 说明没被覆盖（两条都回）', /_skipped\.length \?/.test(RF));
  ok('★ 前端 doRefresh 会把 note 显示出来（不再丢弃响应）', /rj\.note.*pageMsg/.test(HTML) || /rj && rj\.note/.test(HTML));
  ok('★ 前端模拟盘区块会提示"副本由线上运行"', /s\.paper\.mirror/.test(HTML) && /副本实例/.test(HTML));

  console.log('\n【六】启动链：只挂定时器不挂启动链这条已经犯过三次');
  ok('★ pullPaperDownstream 有启动即跑（setTimeout）', /setTimeout\(pullPaperDownstream/.test(SV_NOC));
  ok('★ pullPaperDownstream 有周期轮询（setInterval）', /setInterval\(guard\('paper-pull', pullPaperDownstream\)/.test(SV_NOC));

  console.log('\n' + '─'.repeat(60));
  console.log(`结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
