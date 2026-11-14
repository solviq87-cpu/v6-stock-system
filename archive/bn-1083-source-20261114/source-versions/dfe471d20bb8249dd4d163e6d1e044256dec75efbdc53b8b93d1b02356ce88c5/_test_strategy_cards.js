// 守门：策略卡片「一进二 / 连板接力」不许再空白（gb 轮 / 2026-10-09；gc 轮补两处同源遗漏 / 2026-10-10）
// ── 事故 ────────────────────────────────────────────────────────────
// 用户原话「一进二 二进三卡片怎么空了」。根因是三层，层层都不报错：
//   ① S.yierList / S.lianbanList 以前**只在** pushYiEr / pushLianbanRelay 内部赋值，
//      而这两个函数的第一句就是 `if (sentToday(...)) return;` —— 「当天推过」、
//      「落盘流水里已有一条」、「发布后按零流水=证据丢失兜底判成已发」，三者任一命中就整体 return，
//      卡片从头到尾一次都没算过 → 发布一次就空白一次。
//   ② 更讽刺的是这两个函数自己写着「⛔ 无条件保存：推送被闸门拦下时面板照样要有东西看」——
//      承诺写在注释里，兑现却挂在去重判断之后，等于没写。
//   ③ 这两个 List 是纯内存变量，没有落盘，云端每次发布都是新容器 → 归零后再没机会算回来。
//   ④ 「展示」与「推送」被当成了同一件事：推送必须去重（多发一条用户就烦），
//      展示却只该受"数据算不算得出来"管 —— 被去重牵连，是这次事故的根。
// ── gc 轮补充（gb 发布后普查发现）──────────────────────────────────
//   ⑤ /api/refresh 的 yier/lianban 手动分支还在裸写 `S.yierList = scanYiEr() || []`：
//      扫空（周末/出网抖动池子为 0）就把已有卡片抹成空白，不打 asOf、不落盘 ——
//      与定时/推送那路两个口径（「同一份数据在不同模块被当不同东西」第 4 次踩）。
//   ⑥ asOf 以前盖 todayStr()：周末手动刷新时池子还是上个交易日的，盖今天 = 拿昨天的冒充今天的。
//      改为取数据日期 S.ztDay（交易日盘中两者一致，无差别）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { pass++; console.log('  ✅ ' + n); }
  else { fail++; console.log('  ❌ ' + n + (extra ? '  → ' + extra : '')); }
};

// ⛔ 括号配平取函数体 —— 不许用固定字符窗口（函数一长就把尾部切没了，回头是假红）
function bodyAt(s, sig) {
  const i = s.indexOf(sig);
  if (i < 0) return '';
  const j = s.indexOf('{', i);
  if (j < 0) return '';
  let depth = 0;
  for (let k = j; k < s.length; k++) {
    if (s[k] === '{') depth++;
    else if (s[k] === '}') { depth--; if (depth === 0) return s.slice(j, k + 1); }
  }
  return '';
}

console.log('\n① 卡片刷新必须与推送去重脱钩（顺序上必须排在 sentToday 之前）');
{
  const bYi = bodyAt(src, 'function pushYiEr() {');
  const bLb = bodyAt(src, 'function pushLianbanRelay() {');
  ok('pushYiEr 函数体可定位', bYi.length > 200, String(bYi.length));
  ok('pushLianbanRelay 函数体可定位', bLb.length > 200, String(bLb.length));
  // ⛔ 关键：refreshStrategyCards 的调用必须排在 sentToday **之前**
  const yiCard = bYi.indexOf('refreshStrategyCards('), yiLock = bYi.indexOf('sentToday(yierSentDate');
  ok('一进二：卡片刷新在推送去重之前（不被 sentToday 挡住）',
    yiCard >= 0 && yiLock >= 0 && yiCard < yiLock, 'card@' + yiCard + ' lock@' + yiLock);
  const lbCard = bLb.indexOf('refreshStrategyCards('), lbLock = bLb.indexOf('sentToday(erjinSanSentDate');
  ok('连板接力：卡片刷新在推送去重之前（不被 sentToday 挡住）',
    lbCard >= 0 && lbLock >= 0 && lbCard < lbLock, 'card@' + lbCard + ' lock@' + lbLock);
  // 反证：如果哪天有人为了省事把 S.yierList 直接写回推送函数里，上面的顺序断言会失效
  ok('推送函数里不再直接写 S.yierList（统一交给 refreshStrategyCards）', !/S\.yierList\s*=/.test(bYi));
  ok('推送函数里不再直接写 S.lianbanList', !/S\.lianbanList\s*=/.test(bLb));
}

console.log('\n② 真跑：算出来为空不许覆盖上一份有效数据（bl 轮「不把取不到当成确实没有」）');
{
  const SRC = bodyAt(src, 'function refreshStrategyCards(reason, only) {');
  ok('refreshStrategyCards 源码可定位', SRC.length > 300, String(SRC.length));
  let saved = 0;
  const mk = (yi, lb, seed, only) => {
    const S = Object.assign({ yierList: [], lianbanList: [], yierAsOf: '', lianbanAsOf: '', ztDay: '' }, seed || {});
    const env = {
      S, todayStr: () => '20261010', saveStrategyCards: () => { saved++; },
      scanYiEr: () => yi, scanLianbanRelay: () => lb,
      console: { log: () => {}, error: () => {}, warn: () => {} }
    };
    // ⛔ new Function 沙箱只传 body 会丢掉形参 —— 必须把签名拼回去（漏了形参是整组崩溃，不是变红）
    const fn = new Function(...Object.keys(env),
      'function refreshStrategyCards(reason, only) ' + SRC + '\nreturn refreshStrategyCards;');
    // ⛔ 沙箱里 new Function 的 body 是 `return refreshStrategyCards;` ——
    //    第一次 invoke 拿到的是**函数本身**，要再 invoke 一次才是真跑（少了这一层，changed 会是个 function）
    const _f = fn(...Object.values(env));
    return { changed: _f('test', only), S };
  };
  const one = [{ code: '600001', name: '测试票' }];
  const r1 = mk(one, one);
  ok('扫到数据 → 写入卡片', r1.changed === 2 && r1.S.yierList.length === 1 && r1.S.lianbanList.length === 1);
  ok('写入时打上数据日期 asOf（跨日展示必须说得清是哪天算的）',
    r1.S.yierAsOf === '20261010' && r1.S.lianbanAsOf === '20261010');
  // gc 轮：asOf 是「数据日期」—— 池子是上个交易日的，就盖上个交易日，不许盖本机今天
  const rZd = mk(one, one, { ztDay: '20261009' });
  ok('asOf 优先取涨停池数据日期 S.ztDay（周末手动刷新不冒充今天）',
    rZd.S.yierAsOf === '20261009' && rZd.S.lianbanAsOf === '20261009', rZd.S.yierAsOf + '/' + rZd.S.lianbanAsOf);
  // gc 轮：面板单卡🔄只刷自己那张，另一张不许被碰
  const rOnly1 = mk(one, one, null, 'yier');
  ok('only=yier 只刷一进二（连板那张不动）',
    rOnly1.changed === 1 && rOnly1.S.yierList.length === 1 && rOnly1.S.lianbanList.length === 0);
  const rOnly2 = mk(one, one, null, 'lianban');
  ok('only=lianban 只刷连板接力（一进二那张不动）',
    rOnly2.changed === 1 && rOnly2.S.lianbanList.length === 1 && rOnly2.S.yierList.length === 0);
  const before = saved;
  const r2 = mk(one, one);
  ok('有数据时会触发落盘', saved > before);
  // ⛔ 核心：旧的份已经存在，本轮扫空（多半只是涨停池还没拉到）→ 必须保留
  const seed = { yierList: [{ code: '600111', name: '旧数据' }], lianbanList: [{ code: '600222', name: '旧连板' }] };
  const r3 = mk([], [], seed);
  ok('本轮扫空 → 保留原有卡片（一进二）', r3.S.yierList.length === 1 && r3.S.yierList[0].name === '旧数据');
  ok('本轮扫空 → 保留原有卡片（连板接力）', r3.S.lianbanList.length === 1 && r3.S.lianbanList[0].name === '旧连板');
  ok('本轮扫空 → 返回 0（未产生变更）', r3.changed === 0);
  ok('扫空时不打新的 asOf（不许把旧数据盖章成今天）', r3.S.yierAsOf === '' && r3.S.lianbanAsOf === '');
  // 反证：证明这条守门真的有内容 —— 旧写法无条件覆盖就是会把好数据抹成空卡片
  const OLD = `function refreshStrategyCards(reason) {
    const yi = scanYiEr() || [];
    S.yierList = yi; S.yierAsOf = todayStr();
    const lb = scanLianbanRelay() || [];
    S.lianbanList = lb; S.lianbanAsOf = todayStr();
    return 2;
  }`;
  const oldEnv = { S: { yierList: [{ code: '1' }], lianbanList: [], yierAsOf: '', lianbanAsOf: '' }, todayStr: () => '20261010', scanYiEr: () => [], scanLianbanRelay: () => [], console: { log: () => {}, error: () => {} } };
  const oldBody = new Function(...Object.keys(oldEnv), OLD + '\nreturn refreshStrategyCards;');
  oldBody(...Object.values(oldEnv))('old');
  ok('反证：旧写法（无条件覆盖）会把已有卡片抹成空', oldEnv.S.yierList.length === 0);
}

console.log('\n③ 落盘持久化：发布/重启以后仍有得看（治「每次发版卡片就空」）');
{
  ok('存在独立的卡片快照文件常量', /const STRATEGY_CARDS_FILE = path\.join\(__dirname, 'strategy_cards\.json'\)/.test(src));
  const bSave = bodyAt(src, 'function saveStrategyCards() {');
  ok('saveStrategyCards 落盘时带上 asOf（哪天算的要跟着数据一起回磁盘）',
    /yierAsOf: S\.yierAsOf/.test(bSave) && /lianbanAsOf: S\.lianbanAsOf/.test(bSave));
  ok('saveStrategyCards 连昨日快照一起存（一进二·竞价确认明天还要用）',
    /yierYesterday: S\.yierYesterday/.test(bSave));
  ok('落盘失败不许静默（走 _diskFail 留痕）', /catch \(e\) \{ _diskFail\('strategy_cards\.json'\)/.test(bSave));
  const bRefresh = bodyAt(src, 'function refreshStrategyCards(reason, only) {');
  ok('刷新成功即落盘（不是等到别处统一写）', /if \(changed\) saveStrategyCards\(\);/.test(bRefresh));
  const bBoot = bodyAt(src, 'function loadSnapshotsOnBoot() {');
  ok('冷启动会恢复卡片（挂在 loadSnapshotsOnBoot 里）', /loadStrategyCards\(\)/.test(bBoot));
  const bLoad = bodyAt(src, 'function loadStrategyCards() {');
  ok('恢复时一并把 asOf 读回来（否则跨日不知道是哪天的）',
    /S\.yierAsOf = c\.yierAsOf/.test(bLoad) && /S\.lianbanAsOf = c\.lianbanAsOf/.test(bLoad));
  ok('⛔ 只在内存为空时才恢复（实时算出的数据不许被旧快照盖回去）',
    /if \(!S\.yierList\.length/.test(bLoad) && /if \(!S\.lianbanList\.length/.test(bLoad));
}

console.log('\n④ 跨日保留：0:00~9:24 不动，9:25 起当日覆盖，收盘后再出最终版');
{
  const i = src.indexOf('策略卡片（一进二 / 连板接力）的跨日保留与当日覆盖');
  const blk = i >= 0 ? src.slice(i, i + 2000) : '';
  ok('卡片刷新调度块可定位', blk.length > 500, String(blk.length));
  ok('9:25~收盘前是一条覆盖分支', /t >= 9 \* 60 \+ 25 && t < 15 \* 60 \+ 30/.test(blk));
  ok('收盘 15:30 后是当日最终版分支', /\} else if \(t >= 15 \* 60 \+ 30\)/.test(blk));
  ok('⛔ 0:00~9:24 没有任何刷新分支（用户要求保持到次日 9:20 前）',
    !/t >= 0[\s\S]{0,80}9 \* 60 \+ 2[0-4]/.test(blk));
  ok('每个时点每天各刷一次（用 am/pm 两个日期标记去重，避免高频重算）',
    /if \(_cardMark\.am === ds\) return;/.test(blk) && /if \(_cardMark\.pm === ds\) return;/.test(blk));
  ok('低频轮询（1 分钟），不挂在高频 tick 上', /\}, 60000\);/.test(blk));
}

console.log('\n⑤ 可见性：卡片是哪天算的，必须让用户看得见');
{
  ok('/api/state 下发 yierAsOf', /yierAsOf: S\.yierAsOf \|\| ''/.test(src));
  ok('/api/state 下发 lianbanAsOf', /lianbanAsOf: S\.lianbanAsOf \|\| ''/.test(src));
  ok('前端消费 yierAsOf（跨日展示要说清是哪天的结论）', /s\.yierAsOf/.test(html));
  ok('前端消费 lianbanAsOf', /s\.lianbanAsOf/.test(html));
}

console.log('\n⑥ 面板手动刷新（🔄）必须走同一个入口，不许另搞一套裸赋值（gc 轮）');
{
  const bRf = bodyAt(src, "if (p === '/api/refresh' && req.method === 'POST') {");
  ok('/api/refresh 路由体可定位', bRf.length > 800, String(bRf.length));
  // ⛔ 事故写法：扫空就把已有卡片抹成空白，不打 asOf、不落盘 —— 与定时/推送那路两个口径
  ok('手动分支不再裸写 S.yierList = scanYiEr()（扫空会抹空已有卡片）',
    !/S\.yierList\s*=\s*scanYiEr\(/.test(bRf));
  ok('手动分支不再裸写 S.lianbanList = scanLianbanRelay()',
    !/S\.lianbanList\s*=\s*scanLianbanRelay\(/.test(bRf));
  ok('手动分支统一走 refreshStrategyCards（算空不覆盖 + asOf + 落盘同一口径）',
    /refreshStrategyCards\('面板手动刷新'/.test(bRf));
  ok('单卡🔄只刷单卡（only 形参透传 yier/lianban）',
    /mod === 'yier' \|\| mod === 'lianban'\) \? mod : ''/.test(bRf));
  ok('两卡共用一把 strategycards 锁（全部刷新合并跑一次，不并发双写）',
    /_g\('strategycards'/.test(bRf) && !/_g\('yier'/.test(bRf) && !/_g\('lianban'/.test(bRf));
}

console.log(`\n策略卡片守门：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
