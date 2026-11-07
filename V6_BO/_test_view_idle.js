// 守门测试：只读设备「24 小时没有在线活动自动过期」+ 面板可查看/修改只读密码
// 用户要求原文：「24小时内无在线登录记录自动过期，同时需要再次向开发者申请；开发者面板增加只读密码修改功能」
const fs = require('fs');
const SV = fs.readFileSync('server.js', 'utf8');
const HTML = fs.readFileSync('public/index.html', 'utf8');
const UI = fs.readFileSync('public/assets/app.js', 'utf8');

let pass = 0, fail = 0;
const sec = t => console.log('\n' + t);
function ok(c, name, extra) {
  if (c) { pass++; console.log('  ✅ ' + name + (extra ? '  → ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}
// 按函数名抠出源码（大括号配平）
function grabFn(name) {
  const i = SV.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('未找到函数 ' + name);
  let d = 0;
  for (let j = i; j < SV.length; j++) {
    const c = SV[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return SV.slice(i, j + 1); }
  }
  throw new Error('括号不平衡 ' + name);
}

// 把项目真实那份节假日表抠出来，构造出真正的 isTradeDay ——
// 测试里若另抄一份假期表，项目表更新了而测试还按旧样子绿，等于根本没测到点上。
function grabSet(name) {
  const i = SV.indexOf('const ' + name + ' = new Set([');
  if (i < 0) throw new Error('未找到 ' + name);
  const lb = SV.indexOf('[', i), rb = SV.indexOf(']);', i);
  return eval(SV.slice(lb, rb + 1));
}
// isTradeDay 现在开头会调 holidayTableWarn()（节假日表过期时告警），
// 抽取执行必须注入这个依赖，否则本测试所有依赖 REAL_TRADE 的断言全挂。
const REAL_TRADE = new Function('MARKET_HOLIDAYS', 'MARKET_WORKDAYS', 'holidayTableWarn',
  grabFn('isTradeDay') + '\nreturn isTradeDay;')(new Set(grabSet('MARKET_HOLIDAYS')), new Set(grabSet('MARKET_WORKDAYS')), () => {});
const D = (s, hh, mm) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, hh || 0, mm || 0).getTime(); };
const H = 3600000;
// ⛔ 沙箱注入（2026-10-07 df 轮补）：viewIdleMs 的小时数改走 CFG_SET / cfgSetOf，
//    漏一个符号 = 整段 ReferenceError 崩掉而不是变红（同类坑已踩 14 次）。
const _setI = SV.indexOf('const CFG_SET = {'), _setJ = SV.indexOf('const PUSH_GOV_RESERVE', _setI);
if (_setI < 0 || _setJ < 0) throw new Error('未找到 CFG_SET 定义块');
const CFG_SET_SRC = SV.slice(_setI, _setJ);
const mkApi = (S0, acc, rev, onSave) => new Function('S', 'viewStore', '_revokedBag', 'saveAccess', 'revokeViewSessionsForDevices',
  CFG_SET_SRC + '\n' + grabFn('cfgSetOf') + '\n'
  + grabFn('viewIdleMs') + '\n' + grabFn('tradeIdleMs') + '\n' + grabFn('viewIdleKeys') + '\n' + grabFn('expireIdleViewDevices')
  + '\nreturn { viewIdleMs, tradeIdleMs, viewIdleKeys, expireIdleViewDevices, cfgSetOf };'
)(S0, () => acc.view, () => rev, () => { onSave(); }, () => {});

sec('① 过期判定：最后一次在线活动到现在过了多久');
(function () {
  // ⚠️ 基准时间必须落在【交易日】（2026-09-30 是周三）—— 否则下面"25 小时没露面"
  //    会被节假日折算掉，测出来的就不是我们想验的东西了。
  const NOW = D('2026-09-30', 14, 0);
  let saved = 0;
  const acc = { view: { devices: {
    a: { name: '刚在线', role: 'view', ts: NOW - 1 * H },
    b: { name: '半天没动', role: 'view', ts: NOW - 23 * H },
    c: { name: '一天多没露面', role: 'view', ts: NOW - 25 * H },
    d: { name: '三天前的', role: 'view', ts: NOW - 72 * H },
    e: { name: '没有时间戳的怪记录', role: 'view' } // 无 ts
  } } };
  const rev = {};
  const k = mkApi({ config: {} }, acc, rev, () => { saved++; });

  ok(k.viewIdleMs() === 24 * H, '默认 24 小时', (k.viewIdleMs() / H) + 'h');
  // 基准日前后都是交易日，不掺休市日 → 纯 wall-clock 判定
  const keys = k.viewIdleKeys(acc.view.devices, NOW, 24 * H, { isTradeDay: REAL_TRADE });
  ok(keys.length === 2 && keys.indexOf('c') >= 0 && keys.indexOf('d') >= 0, '只选中超过 24 小时的（含 25h / 72h）', keys.join(','));
  ok(keys.indexOf('a') < 0 && keys.indexOf('b') < 0, '1 小时前、23 小时前刚活动过的都不动');
  ok(keys.indexOf('e') < 0, '没有时间戳的记录不误删（宁可放过，不可错杀）');

  const r = k.expireIdleViewDevices(NOW, { isTradeDay: REAL_TRADE });
  ok(r.removed === 2, '清理 2 台', 'removed=' + r.removed);
  ok(r.names.indexOf('一天多没露面') >= 0, '返回被清理设备的名字（日志里看得懂）', r.names.join('、'));
  ok(!acc.view.devices.c && !acc.view.devices.d, '台账里已经删掉');
  ok(!!acc.view.devices.a && !!acc.view.devices.b && !!acc.view.devices.e, '其余设备不受影响');
  ok(!!rev.c && !!rev.d, '⛔ 必须写进 revoked 名单，否则旧令牌一来就把自己"摸"回台账', Object.keys(rev).join(','));
  ok(saved === 1, '本次确实落盘了一次', 'save×' + saved);
  ok(k.expireIdleViewDevices(NOW, { isTradeDay: REAL_TRADE }).removed === 0, '幂等：再清一次不会重复计数');

  // 恰好 24 小时：不算过期（"超过 24 小时"才算）
  const acc2 = { view: { devices: { x: { ts: NOW - 24 * H, name: '正好一天' } } } };
  const k2 = mkApi({ config: {} }, acc2, {}, () => {});
  ok(k2.viewIdleKeys(acc2.view.devices, NOW, 24 * H, { isTradeDay: REAL_TRADE }).length === 1, '达到 24 小时即过期（>=24h）');

  // 活动会刷新倒计时
  const acc3 = { view: { devices: { y: { ts: NOW - 20 * H, name: '看过一眼' } } } };
  const k3 = mkApi({ config: {} }, acc3, {}, () => {});
  ok(k3.viewIdleKeys(acc3.view.devices, NOW, 24 * H, { isTradeDay: REAL_TRADE }).length === 0, '20 小时没动但还没到期 → 不清');
  acc3.view.devices.y.ts = NOW;                     // 模拟 touchDevice 刷新活跃时间
  ok(k3.viewIdleKeys(acc3.view.devices, NOW, 24 * H, { isTradeDay: REAL_TRADE }).length === 0, '在线一访问，倒计时重置');

  // 可配：config.viewIdleHours
  const kconf = mkApi({ config: { viewIdleHours: 1 } }, { view: { devices: {} } }, {}, () => {});
  ok(kconf.viewIdleMs() === 1 * H, '可用 config.viewIdleHours 改成 1 小时');
  ok(mkApi({ config: { viewIdleHours: -5 } }, { view: { devices: {} } }, {}, () => {}).viewIdleMs() === 24 * H, '填 0/负数/非法值一律回退到 24 小时');
})();

sec('①b 节假日 / 周末休市日不计入（超时的账不能算到假期头上）');
(function () {
  const k = mkApi({ config: {} }, { view: { devices: {} } }, {}, () => {});

  // ① 国庆长假：9/30 晚走人 → 10/7 假期最后一天（10/8 起照常开市，是交易日）。
  //    原始间隔约 7 天休市，10/1~10/7 全是休市日，只剩最后登录那晚（9/30 20:00→24:00，交易日，照算）的 4 小时能记账。
  //    ⛔ 顺带兜住"头尾两天漏判"：10/7 虽是休市日，它那 20 小时也在字面区间里，
  //       只在中间扣整段的旧写法会把这 20 小时算进去，等于假期没扣干净。
  const T_IN = D('2026-10-07', 20, 0);
  ok(k.tradeIdleMs(D('2026-09-30', 20, 0), T_IN, REAL_TRADE) === 4 * H,
    '国庆假期 7 天整段不计入 → 只剩假前那一晚的 4 小时', k.tradeIdleMs(D('2026-09-30', 20, 0), T_IN, REAL_TRADE) / H + 'h');
  ok(k.tradeIdleMs(D('2026-09-30', 20, 0), D('2026-10-07', 0, 0), REAL_TRADE) === 4 * H,
    '假期的最后几天也不计数（换个结束点再验一次）');

  // ② 节后第一个交易日（10/8）回来：只按"假前没上线多久"算，不会一到就被过期
  const T_BACK = D('2026-10-08', 9, 30);
  const backIdle = k.tradeIdleMs(D('2026-09-30', 20, 0), T_BACK, REAL_TRADE);
  ok(backIdle < 24 * H, '长假结束回来仍算活跃（不会因为"日历过了 8 天"就被清）', (backIdle / H).toFixed(1) + 'h');
  const accBack = { view: { devices: { p: { name: '假前还在看的人', ts: D('2026-09-30', 20, 0), role: 'view' } } } };
  ok(k.viewIdleKeys(accBack.view.devices, T_BACK, 24 * H, { isTradeDay: REAL_TRADE }).length === 1, '按自然时间 24 小时规则，节后设备需要重新申请');

  // ③ 跨周末：周五 20:00 → 周一 10:00，中间周六周日两天不计（周末余额本身的量）——
  //    用 10/16→10/19 的干净周末（该周周日是普通周末休市，非补班开市）。
  const cleanFri = REAL_TRADE(new Date(2026, 9, 16)) && !REAL_TRADE(new Date(2026, 9, 17)) && !REAL_TRADE(new Date(2026, 9, 18));
  ok(cleanFri, '前提校验：10/16 周五交易、10/17-10/18 是普通周末（非补班日）');
  const mon = D('2026-10-19', 10, 0);
  const wkIdle = k.tradeIdleMs(D('2026-10-16', 20, 0), mon, REAL_TRADE);
  ok(Math.abs(wkIdle - 14 * H) < 0.01, '跨周末只算 14 小时（周六周日整段扣掉）', (wkIdle / H).toFixed(1) + 'h');
  ok(wkIdle < 24 * H, '所以周五晚上看完、周一早上回来不会被清');
  // 同一批人拖到周二下午：交易时长超过 24h → 该清就清
  const tue = D('2026-10-20', 14, 0);
  ok(k.tradeIdleMs(D('2026-10-16', 20, 0), tue, REAL_TRADE) > 24 * H, '拖到周二下午就真的超时了 → 清理', (k.tradeIdleMs(D('2026-10-16', 20, 0), tue, REAL_TRADE) / H).toFixed(1) + 'h');
  // 普通周末（9/25 周五 → 9/28 周一）：中间周六周日全休市 → 只计周五晚 4h + 周一早 10h = 14h
  ok(k.tradeIdleMs(D('2026-09-25', 20, 0), D('2026-09-28', 10, 0), REAL_TRADE) === 14 * H,
    '普通周末：周六周日整段不计入 → 仅周五晚 4h + 周一早 10h', (k.tradeIdleMs(D('2026-09-25', 20, 0), D('2026-09-28', 10, 0), REAL_TRADE) / H) + 'h');

  // ④ 2026 全部调休补班日（9/20、10/10 等）落在周末、交易所周末休市 → 均不计交易日
  ok(REAL_TRADE(new Date(2026, 8, 20)) === false, '2026-09-20 国庆补班周日 → 周末休市，不计交易日');
  ok(REAL_TRADE(new Date(2026, 9, 10)) === false, '2026-10-10 国庆补班周六 → 周末休市，不计交易日');
  ok(REAL_TRADE(new Date(2026, 8, 27)) === false, '2026-09-27 是中秋假期内周日（非补班日）→ 休市');

  // ⑤ 交易日之间正常计时（不打折）
  ok(k.tradeIdleMs(D('2026-09-28', 10, 0), D('2026-09-29', 20, 0), REAL_TRADE) === 34 * H, '两个交易日之间按原样算 34 小时');

  // ⑥ 保留"不分节假日"的老算法通道（显式 opt-out），便于出问题时回退比对
  const sameDay = D('2026-10-05', 12, 0);
  const accHol = { view: { devices: { h: { name: '假期里的', ts: sameDay - 25 * H, role: 'view' } } } };
  ok(k.viewIdleKeys(accHol.view.devices, sameDay, 24 * H, { isTradeDay: REAL_TRADE }).length === 1, '默认按连续自然时间，假期里也过期');
  ok(k.viewIdleKeys(accHol.view.devices, sameDay, 24 * H, { isTradeDay: REAL_TRADE, skipClosedDays: false }).length === 1, 'opt-out 后按原始时长判定（用于排障比对）');

  // ⑦ 日历 Sanity：确认测试假设的前提没写错
  ok(REAL_TRADE(new Date(2026, 9, 3)) === false, '前提校验：2026-10-03 是国庆假期（休市）');
  ok(REAL_TRADE(new Date(2026, 8, 30)) === true, '前提校验：2026-09-30 是交易日');
  // ⛔ 回归守卫（2026-10-05 用户揪出的真 bug）：代码一度把 10/8 也写进休市表，
  //    导致 10/8 这个真正的交易日被当成休市（复盘/竞价/扫描全哑），
  //    且"开盘前夜全景汇总"发错到 10/8 晚而不是 10/7 晚。
  //    来源：沪深北交易所《2026年部分节假日休市安排》"10/1 至 10/7 休市，10/8 起照常开市"。
  ok(REAL_TRADE(new Date(2026, 9, 7)) === false, '⛔ 2026-10-07 是国庆假期最后一天（休市）');
  ok(REAL_TRADE(new Date(2026, 9, 8)) === true, '⛔ 2026-10-08 是国庆后首个交易日（绝不是休市）');

  // ⑧ 「快到期了」的提示必须和真正动手清理的那套【同一个口径】
  ok(/viewIdleSoon:[\s\S]{0,600}(tradeIdleMs\(v\.ts, Date\.now\(\)\)|Date\.now\(\) - v\.ts)/.test(SV),
    '面板「快到期了」按扣掉假期的口径算（跟清理同源）');
  ok(/viewIdleSoon/.test(SV),
    '⛔ 不许再用日历天数判快到期：长假一结束必误报，还会被当成"清理功能坏了"');
})();

sec('② 清理之后必须「重新向开发者申请」');
ok(/if \(_viewFpApproved\(_fp\)\) return false;/.test(SV), '只读登录先看这台设备的指纹是否还在只读台账里');
// 被清掉 → _viewFpApproved 查不到 → 走 _viewGate 建待审批单 → 开发者放行后才写回台账
ok(/function _viewFpApproved\(fp\)[\s\S]{0,200}viewStore\(\) && viewStore\(\)\.devices/.test(SV), '_viewFpApproved 的判定依据就是只读台账');
ok(/state: 'pending'/.test(SV) && /p === '\/api\/lock\/pending-approve'/.test(SV), '走待审批单 + 开发者放行');
// ⚠️ 别钉死 `vs.devices[devDigest(dt)]` 这一串字面量，也别用固定字符窗口（cc 轮在放行块里
//    加了"落盘失败就撤回"这段，窗口一不留神就切歪了）—— cc 轮设备键先存进 _dkey 才能回滚。
//    断言应该盯"这个路由块里有没有登记进台账"，窗口按**语义边界**取（到下一个路由为止）。
const _pa0 = SV.indexOf("p === '/api/lock/pending-approve'");
const _paBlk = SV.slice(_pa0, SV.indexOf("\n  if (p === '", _pa0 + 40));
ok(_pa0 > 0 && /vs\.devices\[[^\]]+\]\s*=/.test(_paBlk), '放行后重新登记进只读台账（带指纹 → 下次免确认）');
ok(/fp: it\.fp \|\| undefined, role: 'view'/.test(_paBlk), '登记时带上了指纹（下次免二次确认靠它）');
ok(/if \(!saveAccess\(\)\)[\s\S]{0,400}delete vs\.devices\[/.test(_paBlk), '⛔ 落盘失败要把刚登记的那台撤回（不能内存里已放行、磁盘上没有）');

sec('③ 定时器 + 启动补跑（踩过三次的坑：只挂定时器不挂启动链）');
ok(/const runViewIdleSweep = \(\) =>/.test(SV), '有独立的清理函数');
ok(/setTimeout\(runViewIdleSweep, 60000\)/.test(SV), '启动 60 秒先扫一遍（新实例不会空窗半小时）');
ok(/setInterval\(guard\('view-idle', runViewIdleSweep\), 30 \* 60 \* 1000\)/.test(SV), '之后每 30 分钟扫一次');
ok(SV.indexOf('setTimeout(runViewIdleSweep, 60000)') < SV.indexOf("setInterval(guard('view-idle', runViewIdleSweep)"), '启动补跑写在定时轮询之前');

sec('④ 只读密码：面板能看见当前口令与失效策略');
ok(/viewPwd: String\(_viewPwdHint\.pwd \|\| ''\)/.test(SV), 'status 给回当前只读密码明文');
ok(/const _devOnly = \(role0 === 'edit'\)/.test(SV), '⛔ 只对开发者本人返回，匿名/只读拿不到');
ok(/viewIdleHours: viewIdleMs\(\) \/ 3600000/.test(SV), 'status 同时给出失效时长（小时）');
ok(/viewIdleHours: _idleMs \/ 3600000/.test(SV), '设备列表接口也带上，便于面板提示');
ok(/viewIdleSoon/.test(SV), '还能看出"快到期了"的台数');
// ⛔ 远程开发者（不在本机、但已持 edit 令牌）也必须能看见明文：
//    /api/lock/status 认人的渠道是 token，裸 GET 会被判成匿名 → viewPwd 不给 →
//    面板说"重启后还没人用过"，而实际上密码设着、人也就在线。
ok(/function renderViewPwdState\(\)[\s\S]{0,600}\?token=/.test(UI), '显示口令的请求必须带上令牌（否则远程开发者读到假话）');
ok(/function renderViewPwdState\(\)/.test(UI), '前端有「显示当前口令」的渲染函数');
ok(/👁 显示当前口令/.test(UI), '面板上有入口按钮');
ok(/设置 \/ 修改只读密码/.test(UI), '按钮改成明确的"设置 / 修改只读密码"');
ok(/if \(name === 'view' && typeof renderViewPwdState === 'function'\)/.test(UI), '切到「观看」标签自动显示，不用先点一下');
ok(/还没有设置只读密码/.test(UI), '没设置和"设置过但看不到明文"要区分开');
ok(/看不到明文/.test(UI), '重启后看不到明文时要说清原因（不是丢了，是重新覆盖即可）');

sec('④b 开发者密码：面板也能看见自己这把钥匙');
// 用户要求原文：「开发者页面可以显示开发者密码和只读密码」
ok(/devPwd: String\(_devPwdHint\.pwd \|\| ''\)/.test(SV), 'status 也给回开发者密码明文');
ok(/const _devPwdHint = \{ pwd: '' \}/.test(SV), '有独立的开发者密码内存容器（与只读密码互不干扰）');
// ⛔ 关键的可用性陷阱：长期令牌的设备再也不会手输密码 → 只在 unlock 回填的话，
//    面板会永远停在"重启后还没人登录过"，等于功能没做。
//    /api/lock/trust 是发布脚本与「记住此设备」都走的验证口，必须一并回填。
// ⚠️ 不能拿 indexOf("p === '/api/lock/trust'")：第一处命中是开头那条「认证白名单」，
//    不是真正的路由（实测距离只有 31 字符，切出来的永远是白名单那一行）。
//    必须认准 `if (p === '/api/xxx'` 这个路由起手式，再切到下一个同级路由为止。
function blkOf(path_, span) {
  const key = "if (p === '" + path_ + "'";
  const i = SV.indexOf(key);
  if (i < 0) return '';
  const j = SV.indexOf("\n  if (p === '", i + key.length);
  const end = j < 0 ? i + (span || 3000) : Math.min(j, i + (span || 3000));
  return SV.slice(i, end);
}
{
  const blk = blkOf('/api/lock/trust', 3000);
  ok(blk.length > 200, '切到 trust 路由本体（' + blk.length + ' 字符）');
  ok(/else if \(role === 'edit'\) _devPwdHint\.pwd = pwd;/.test(blk),
    '⛔ trust 也必须回填开发者明文（否则长期令牌的设备永远看不到密码）');
  ok(/if \(role === 'view'\) _viewPwdHint\.pwd = pwd;/.test(blk), 'trust 对只读密码的回填行为保持原样');
}
{
  const blk = blkOf('/api/lock/unlock', 4000);
  ok(/const hit = pwdRoleOf\(pwd\);[\s\S]{0,500}_devPwdHint\.pwd = pwd;/.test(blk), 'unlock（自动识别身份）分支回填');
  ok(/authOk\(req, p\);\s*\n\s*_devPwdHint\.pwd = pwd;/.test(blk), 'unlock（显式开发者）分支回填');
}
{
  const blk = blkOf('/api/lock/reset-pwd', 4000);
  ok(blk.length > 200, '切到 reset-pwd 路由本体（' + blk.length + ' 字符）');
  ok(/_devPwdHint\.pwd = npwd;/.test(blk), '手机找回后当场能回显新密码');
}
ok(/function renderDevPwdState\(\)/.test(UI), '前端有开发者密码渲染函数');
// ⛔ 同一个陷阱在观看密码上也会发生：发版脚本每轮都调用 change(role=view)，
//    而密码没变时走的是**早退分支**，若只在真正变更的那条路上赋值，
//    就会导致"重启后再也看不到只读密码"（2026-10-03 实测：面板显示"还没人登录过"）。
{
  const blk = blkOf('/api/lock/change', 4000);
  ok(blk.length > 200, '切到 change 路由本体（' + blk.length + ' 字符）');
  ok(/if \(pwdOk\(npwd, 'view'\)\) \{\s*\n\s*_viewPwdHint\.pwd = npwd;/.test(blk),
    '⛔ 观看密码「未变更」早退前也要补回显（否则重启后永远显示不出来）');
  ok(/unchanged: true/.test(blk), '未变更分支仍保持原语义：不动设备台账、不 bump 世代');
}
ok(/👁 我的开发者密码/.test(UI), '面板上有入口按钮');
ok(/function renderDevPwdState\(\)[\s\S]{0,600}\?token=/.test(UI), '⛔ 取开发者明文同样必须带令牌');
ok(/<b>无法反推<\/b>|无法反推/.test(UI), '看不到时要解释清楚：只存加盐哈希、无法反推');

sec('⑤ 修改只读密码是有代价的：必须先确认再动手');
// ⛔ gj 轮（2026-10-12）：断言钉**语义**不钉实现。原来钉的是原生 confirm(，
//    但原生 confirm 在系统深色模式下是近黑底对话框（用户反馈的「偶发黑色弹窗」就是它），
//    已统一换成浅色页内 uiConfirm。这里改成：必须还有一次**显式确认**（两种实现都认），
//    且确认必须发生在"已设过密码"这个条件下 —— 少任何一个都等于让用户点一下就把所有
//    只读设备踢下线。
ok(/GATE\.hasViewPassword && !\(?await (confirm|uiConfirm)\(/.test(UI),
  '已经设过密码时，修改前弹确认框（原生 confirm 或页内 uiConfirm 均可）');
ok(/所有已授权的只读设备/.test(UI), '确认框里说清代价：已授权的只读设备会全部失效');
ok(/r\.unchanged \?/.test(UI), '密码没变时明确提示"未改动、已授权设备不受影响"');
ok(/修改只读密码会|'修改只读密码'/.test(UI), '二次校验的提示语写明是修改只读密码');

sec('⑥ 版本号一致 + 行尾');
const vS = SV.match(/APP_VER = '([^']+)'/)[1];
const vH = UI.match(/APP_VER = '([^']+)'/)[1];
ok(vS === vH, '前后端 APP_VER 一致', vS + ' / ' + vH);
ok(!SV.includes('\r'), 'server.js 无 CR');
ok(!HTML.includes('\r'), 'index.html 无 CR');

console.log('\n' + (fail === 0 ? '🎉' : '⚠️') + ` 只读设备自动过期 + 面板改只读密码：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
