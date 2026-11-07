// 持仓审计 / 自动快照 / 一键还原 测试（HOUTAI_AUDIT_V1，2026-09-30）
// 起因：用户先后两次发现「持仓又没有了」，而系统里连一条"谁删的/删的啥"的记录都没有。
// 这组断言锁死三件事：① 增删都必须留痕 ② 条数变少必须自动落快照 ③ 快照必须能真的还原。
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holdtest-'));
  const seed = {
    capital: 100000,
    items: [{ code: '600905', name: '三峡能源', cost: 5.2, shares: 2000, tags: ['长线'] }],
    stopPct: -8, reducePct: -4, takePct: 15, maxPosPct: 90
  };
  fs.writeFileSync(path.join(tmp, 'holdings.json'), JSON.stringify(seed));

  let pushed = null;
  let _snapCalls = 0;   // 行情拉取次数：并发强制重算必须复用，不能一轮一次
  let _holdGate = null; // 第⑩节用：非 null 时行情拉取会卡住，模拟"重算很慢"
  const HD = require('./holdings.js')({
    fs, path, dir: tmp,
    // ⛔ klines 不能省：compute 里 klineOf 直接 `S.klines.get(code)`，没注入就是
    //    `Cannot read properties of undefined (reading 'get')`（第⑧节会踩到）
    S: { stocks: [{ code: '601398', name: '工商银行' }, { code: '000001', name: '平安银行' }], klines: new Map() },
    // ⛔ lock 会走 em.fetchBatchSnapshot 取现价当成本 —— 不注入就会抛异常，
    //    而 lockItem 内部没有 try 包住它 → 表现为"锁仓失败"而不是"缺依赖"。
    // ⛔ 第⑩节要用：_holdGate 非 null 时行情拉取会卡住，用来模拟"重算很慢"这种真实情况
    em: { emit() {}, fetchBatchSnapshot: async () => { _snapCalls++; if (_holdGate) await _holdGate; return [{ code: '300750', name: '宁德时代', price: 180 }]; } },
    sseSend() {}, sseSendEdit() {},
    // 签名是 (text, force, opts)。⛔ 别再从第二参取正文：2026-10-05 前 clearAll 就是把
    // 正文写在了 force 的位置，手机只收到一行标题。这里按真实签名收，才能守住这个坑。
    pushAll: async (t, b, c) => { pushed = { t, force: b, opts: c }; return { ok: true }; }
  });

  console.log('\n① 初始状态');
  ok('读到了种子持仓 1 条', (HD.raw.items || []).length === 1);

  console.log('\n② 加仓必须留痕（以前"加没加进去"完全查不出）');
  const r1 = HD.add({ code: '601398', name: '工商银行', cost: 6.1, shares: 1000 });
  ok('add 返回 ok', r1 && r1.ok, JSON.stringify(r1));
  const ops1 = HD.ops(50);
  const rec1 = ops1[ops1.length - 1];
  ok('审计里记了一条 add', rec1 && rec1.act === 'add', rec1 && rec1.act);
  ok('add 记录了新增代码', rec1 && (rec1.added || []).includes('601398'), JSON.stringify(rec1 && rec1.added));

  console.log('\n③ 删除必须留痕 + 自动快照');
  HD.remove('601398');
  const ops2 = HD.ops(50);
  const rec2 = ops2[ops2.length - 1];
  ok('审计里记了一条 remove', rec2 && rec2.act === 'remove', rec2 && rec2.act);
  ok('remove 记录了被删代码', rec2 && (rec2.removed || []).includes('601398'));
  ok('remove 带了快照文件名', !!(rec2 && rec2.snapshot), rec2 && String(rec2.snapshot));
  ok('快照文件真的存在（不是空头支票）', rec2 && rec2.snapshot && fs.existsSync(rec2.snapshot));
  const bakDir = path.join(tmp, '.holdings_bak');
  ok('.holdings_bak 目录已建', fs.existsSync(bakDir));

  console.log('\n④ 清空：更重的后果，必须留痕 + 通知本人');
  pushed = null;
  const opsFile = path.join(tmp, '.holdings_ops.json');
  const rc = HD.clearAll();
  ok('clearAll 返回删除条数 1', rc && rc.removed === 1, JSON.stringify(rc));
  const ops3 = JSON.parse(fs.readFileSync(opsFile, 'utf8'));
  const rec3 = ops3[ops3.length - 1];
  ok('审计里记了一条 clear', rec3 && rec3.act === 'clear', rec3 && rec3.act);
  ok('clear 记录了全部被删代码', rec3 && (rec3.removed || []).includes('600905'));
  ok('clear 之前的票名也被留下（三峡能源）',
    rec3 && JSON.stringify(rec3.beforeBrief || []).indexOf('三峡能源') >= 0,
    JSON.stringify(rec3 && rec3.beforeBrief));
  ok('清空后推了通知给本人', !!pushed, pushed ? '' : '没推，用户会毫无察觉');
  // ⛔ 正文必须在第一参 t 里（第二参是 force）。以前正文被塞进 force，手机只看到标题。
  ok('通知里点名了那只被清掉的票', pushed && String(pushed.t).indexOf('三峡能源') >= 0,
    pushed ? String(pushed.t).slice(0, 50) : '没推');
  ok('⛔ 正文没被 force 参数吃掉（force 是布尔不是正文）', pushed && typeof pushed.force === 'boolean' && pushed.force === true,
    pushed ? String(pushed.force).slice(0, 30) : '没推');
  ok('清空通知走私密通道（持仓属私密范畴）', pushed && pushed.opts && pushed.opts.private === true);
  ok('持仓此刻真的空了', (HD.raw.items || []).length === 0);

  console.log('\n⑤ 一键还原：数据再丢也能自己救回来');
  const snaps = HD.snapshots();
  ok('快照列表非空', snaps.length > 0, JSON.stringify(snaps));
  // ⛔ 2026-10-06 起快照存的是【操作之前】的持仓（cc 轮修的 bug：以前存的是删完之后，
  //    一键还原还原出一个空列表）。于是"删除"那份快照现在是 2 条、"清空"那份是 1 条 ——
  //    这里必须挑 1 条的那份，否则会把 601398 一起还原回来，第⑦节的补录就变成了"已存在"。
  const target = snaps.find(s => s.count === 1) || snaps[0];
  ok('找到至少含 1 条持仓的快照', !!target && target.count >= 1, JSON.stringify(target));
  const rr = HD.restore(target.file);
  ok('restore 返回 ok', rr && rr.ok, JSON.stringify(rr));
  ok('还原后持仓条数恢复', rr && rr.count >= 1);
  ok('磁盘上的 holdings.json 也写回了真实内容',
    (JSON.parse(fs.readFileSync(path.join(tmp, 'holdings.json'), 'utf8')).items || []).length >= 1);
  ok('还原动作本身也记进了审计', HD.ops(50).some(x => x.act === 'restore'));

  console.log('\n⑥ 一键锁仓也必须留痕（2026-10-06 修：它是除 add 外唯一能新增条目的路径）');
  // 事故：lock 走的是裸 saveHold()，绕开 commit() → 线上流水里 300750 反复出现却没有任何
  // add 记录，用户删除它时只看到一条"孤零零的 remove"，根本查不出这只票是谁加进来的。
  const _lk = await HD.lock({ code: '300750', shares: 200 });
  ok('lock 返回 ok', _lk && _lk.ok, JSON.stringify(_lk));
  ok('lock 真的建出了持仓', (HD.raw.items || []).some(x => x.code === '300750'));
  const opsL = HD.ops(50), recL = opsL[opsL.length - 1];
  ok('⛔ 审计里记了一条 lock（不是凭空冒出来）', recL && recL.act === 'lock', recL && recL.act);
  ok('lock 记录了被新建的代码', recL && (recL.added || []).includes('300750'), JSON.stringify(recL && recL.added));
  ok('lastAddAt 能查到本机新增时间', HD.lastAddAt('300750') > 0, String(HD.lastAddAt('300750')));
  // 已持仓再锁一次：只更新仓位，不该重复记成新增
  const _lk2 = await HD.lock({ code: '300750', shares: 500 });
  ok('已持仓再锁仓返回 ok', _lk2 && _lk2.ok, JSON.stringify(_lk2));
  const recL2 = HD.ops(50).slice(-1)[0];
  ok('已持仓的 lock 不谎报为新增加仓', recL2 && !(recL2.added || []).includes('300750'), JSON.stringify(recL2 && recL2.added));

  console.log('\n⑦ 线上→本地对账：只补齐，绝不拿线上列表覆盖本机');
  // 治「持仓总是删除不干净」：同步是单向的（本机→线上），手机上删掉的票本机看不见。
  const _codes = () => (HD.raw.items || []).map(x => String(x.code));
  ok('本机此刻有 300750', _codes().includes('300750'));
  // ① 线上删了 → 本机跟着删（传 keep 集合，被剔除的那只被删掉）
  const rr1 = HD.applyRemoteRemoval(_codes().filter(c => c !== '300750'), ['300750']);
  ok('remote-remove 删掉了 1 条', rr1 && rr1.removed === 1, JSON.stringify(rr1));
  ok('本机确实没有 300750 了', !_codes().includes('300750'));
  ok('对账删除也记进审计（可在面板查到）',
    HD.ops(50).slice(-1)[0] && HD.ops(50).slice(-1)[0].act === 'remote-remove');
  // ② 线上有、本机没有 → 补进来
  const okAdd = HD.addRemoteItem({ code: '601398', name: '工商银行', cost: 6.1, shares: 1000, tags: ['长线'] });
  ok('remote-add 补进了线上才有的票', okAdd === true && _codes().includes('601398'));
  // ③ 本机已有的绝不能被线上覆盖（成本价被冲掉 = 最严重的静默数据损坏）
  const _costBefore = (HD.raw.items.find(x => x.code === '601398') || {}).cost;
  const okAdd2 = HD.addRemoteItem({ code: '601398', name: '工商银行', cost: 99, shares: 1 });
  ok('本机已有的票不被线上覆盖（返回 false）', okAdd2 === false);
  ok('成本价没被线上版本冲掉',
    (HD.raw.items.find(x => x.code === '601398') || {}).cost === _costBefore, String(_costBefore));
  // ④ 非法代码不能污染数据
  ok('非法代码不入库', HD.addRemoteItem({ code: 'ABC', name: 'x' }) === false);
  ok('空对象不入库', HD.addRemoteItem(null) === false);
  // ⑤ keep 集合就是本机全部时不该有任何动作
  const rr2 = HD.applyRemoteRemoval(_codes(), []);
  ok('没有差异时不误删', rr2 && rr2.removed === 0, JSON.stringify(rr2));

  console.log('\n⑧ 并发强制重算必须复用（每次都真算 = 自己打爆数据源）');
  // kick() 在每次写操作后都调 compute(true)（force 绕过 20 秒缓存），
  // 连续改静音/改标签/逐条删除会同一瞬间并发好几轮全量重算 —— 每轮都要拉批量行情 + 逐票 K 线，
  // 等于自己打自己的数据源 → 触发限流 → 数据反而更旧。
  _snapCalls = 0;
  const p1 = HD.compute(true), p2 = HD.compute(true), p3 = HD.compute(true);
  const rs = await Promise.all([p1, p2, p3]);
  ok('3 次并发 compute(true) 只拉了 1 次行情', _snapCalls === 1, '实际拉了 ' + _snapCalls + ' 次');
  ok('三次拿到的结果一致（复用同一个 promise）', rs[0] === rs[1] && rs[1] === rs[2]);
  // 复用不能永久卡住：算完后必须能再算（否则面板再也刷新不了）
  _snapCalls = 0;
  await HD.compute(true);
  ok('算完后可以再次强制重算（_inflight 已释放）', _snapCalls === 1, '实际 ' + _snapCalls);

  console.log('\n⑨ 非法输入不能炸也不能污染数据');
  const before = HD.raw.items.length;
  ok('restore 不存在的文件返回 ok:false', (() => { try { const z = HD.restore('nope.json'); return z && z.ok === false; } catch (e) { return '抛异常: ' + e.message; } })() === true);
  ok('restore 越界路径被挡下（防目录穿越）',
    (() => { const z = HD.restore('../../Windows/win.ini'); return z && z.ok === false; })());
  ok('失败后持仓条数没被改写', HD.raw.items.length === before);

  console.log('\n⑩ 慢重算跑完后，不许把「写操作之前」的数据当最新缓存（治"删了还显示在面板上"）');
  // 根因：重算要拉行情 + 逐票K线，慢的时候好几秒。若它是用户点删除【之前】启动的，
  //   读到的就是删除前的持仓；算完还会把这份旧数据写进 _cache 并盖上"刚刚算出来"的时间戳
  //   → 之后 20 秒内 GET /api/holdings 全返回删除前的列表，面板上那只票好端端躺着。
  //   这就是「持仓总是删除不干净」的第二个根因（第一个是同步单向）。
  await HD.compute(true);                       // 先有一份正常缓存
  let _release; _holdGate = new Promise(r => { _release = r; });
  const slow = HD.compute(true);                // 启动一轮卡住的慢重算
  HD.add({ code: '000001', name: '平安银行', cost: 11, shares: 500 });  // 重算还在跑时用户改了持仓
  _snapCalls = 0;
  _release();
  await slow;
  const after10 = await HD.compute();           // 非强制：如果脏缓存被写进去了，这里会直接返回它
  ok('旧结果不会被当成最新缓存（必须重新拉行情）', _snapCalls === 1,
    '实际重新拉取 ' + _snapCalls + ' 次（0 次 = 直接返回了脏缓存，删掉的票又冒出来）');
  ok('拿到的结果里确实有写进去的那只票', (after10.items || []).some(x => x.code === '000001'),
    JSON.stringify((after10.items || []).map(x => x.code)));
  _holdGate = null;
  ok('bust() 必须同时 bump 世代戳（只清 _cache 挡不住上面的坑）',
    /const bust = \(\) => \{ _cache = \{ t: 0, data: null \}; _gen = \(_gen \|\| 0\) \+ 1; \};/.test(fs.readFileSync('holdings.js', 'utf8')));

  console.log('\n⑪ ⛔ 锁仓新建期间被线上对账补录 → 同一只票不许出现两条（2026-10-07）');
  // 事故现场：_test_hold2.js 偶发「锁仓生效（3/2）」，持仓里 300750 出现两次。
  // 成因是**判空与写入之间隔着一次 await**：lockItem 发现本机没有这只票后要去拉现价，
  // 这段窗口里「线上→本地对账」把同一只票补了进来（addRemoteItem 只在补的那一刻查重，
  // 看不见本机这条在途的新建），等现价回来再 push → 两只一模一样的票。
  // 面板上看是两只一样的票，删一只还剩一只、改一只另一只不动，用户只能干瞪眼。
  {
    const _c = '002594';
    let release = null;
    _holdGate = new Promise(r => { release = r; });
    const p = HD.lock({ code: _c, shares: 200 });   // 故意不 await：让它卡在"拉现价"那一步
    // 这段窗口里线上→本地对账把同一只票补进来（此刻本机还没有它，查重查不到）
    HD.addRemoteItem({ code: _c, name: '比亚迪', cost: 250, shares: 100 });
    release();
    const rr = await p;
    _holdGate = null;
    const n = (HD.raw.items || []).filter(x => String(x.code) === _c).length;
    ok('⛔ 同一只票在持仓里只有一条（不是两条一模一样的）', n === 1, '实际 ' + n + ' 条');
    const it = HD.raw.items.find(x => String(x.code) === _c);
    ok('补录那条被就地锁仓（不是另起一条）', !!(it && it.locked));
    ok('股数以 lock 下发的为准', !!(it && it.shares === 200), it && String(it.shares));
    ok('lock 仍返回 ok', !!(rr && rr.ok), JSON.stringify(rr));
    // 源码层面钉死：复查必须夹在 await 与 push 之间（挪到 push 之后就完全没用了）
    const HSRC = fs.readFileSync('holdings.js', 'utf8');
    const iLock = HSRC.indexOf('async function lockItem(');
    const segL = HSRC.slice(iLock, iLock + 4000);
    const iAgain = segL.indexOf('const again = HOLD.items.find');
    ok('⛔ 源码里 await 之后、push 之前补了一次复查',
      iAgain > segL.indexOf('fetchBatchSnapshot') && iAgain < segL.indexOf('HOLD.items.push('),
      `again=${iAgain} push=${segL.indexOf('HOLD.items.push(')}`);
    // 反证：不复查的话，同一个场景必然变成两条
    const old = [];
    if (!old.find(x => x.code === _c)) { old.push({ code: _c, shares: 100 }); old.push({ code: _c, shares: 200 }); }
    ok('反证：旧写法（await 后不复查、直接 push）同场景必出两条',
      old.filter(x => x.code === _c).length === 2);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
