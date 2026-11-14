// 持仓风控推送·双重闸门单测（la 轮 2026-10-27）：
// 事故：① watch() 的 30 分钟去重（pushed Map / oncePushed Set）是纯内存 —— 线上容器每次
//        回收/发布重启都清零，冷启动 25 秒后必把同一条风控重推一遍（10-23 晚 20:15–23:35
//        pushlog 实证 40+ 条、每 2~3 分钟一条的风暴 = 容器反复回收 × 内存去重清零）。
//      ② watch 只判 isTradeDay（周一凌晨也算交易日），凌晨照样 30 分钟一条，而 A 股凌晨
//        用的是上一收盘价，告警零增量信息（用户"两天弹了将近20次"）。
// 修法：① 去重状态落盘 .holdings_push.json（跨重启有效，载入即剪枝 7 天前旧键）
//      ② watch 自动推送加数据窗口闸（默认不注入 = 放行，生产行为注入 isDataWindow）。
// 全部用临时目录真跑，绝不碰真实 holdings.json。
const fs = require('fs'), path = require('path'), os = require('os');
const factory = require('./holdings.js');

let pass = 0, fail = 0;
const ok = (b, s) => { if (b !== true) fail++; else pass++; console.log(`${b === true ? '✅' : '❌'} ${s}`); };

// 每个用例一个独立临时目录（互不串状态）
function mkInst(dir, opts = {}) {
  const pushed = [], sseEdits = [];
  const inst = {
    pushed, sseEdits,
    HD: factory({
      fs, path, dir,
      S: { klines: new Map(), stocks: [], news: { badCodes: new Set() } },
      em: {
        async fetchBatchSnapshot(codes) {
          return codes.map(c => ({ code: c, name: '测试股' + c, price: opts.price || 9, pct: 0, prevClose: opts.price || 9, mainInflow: 0, mainPct: 0 }));
        },
        async fetchKline(code, n) { return { rows: Array.from({ length: n || 30 }, () => ({ open: opts.price || 9, close: opts.price || 9, high: opts.price || 9, low: opts.price || 9, vol: 100 })) }; },
        async fetchThsActiveBatch() { return []; }
      },
      sseSend() {}, sseSendEdit(k, v) { sseEdits.push(k); },
      pushAll(t) { pushed.push(t); },
      nowDate: opts.nowDate || (() => new Date(2026, 9, 27, 10, 0, 0)),   // 固定工作日，防"今天星期几"绑架
      dataWindow: ('dataWindow' in opts) ? opts.dataWindow : () => true  // ⛔ 不注入默认放行 = 旧行为零变化
    })
  };
  return inst;
}
const mkDir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qdgate-'));
  fs.writeFileSync(path.join(d, 'holdings.json'), JSON.stringify({ capital: 0, items: [], stopPct: -8, reducePct: -4, takePct: 15, maxPosPct: 90 }));
  return d;
};

(async () => {
  // ── ① 数据窗口闸：盘外命中 → 不推送、面板照刷、去重标记照落盘 ──
  {
    const d = mkDir();
    const { HD, pushed, sseEdits } = mkInst(d, { dataWindow: () => false });
    HD.add({ code: '000001', name: '测试股', cost: 10, shares: 1000 });   // 现价 9 → -10% → 止损（urgent 非once）
    await HD.watch();
    ok(pushed.length === 0, `① 盘外 watch 不推送（实际推了 ${pushed.length} 条）`);
    ok(sseEdits.includes('holding'), '① 盘外面板刷新照常（sseSendEdit holding 有调用）');
    const st = JSON.parse(fs.readFileSync(path.join(d, '.holdings_push.json'), 'utf8'));
    ok(!!st.rep['止损:000001'], '① 盘外命中的去重标记已落盘（窗口开启后 30 分钟内不重放）');
    // 闸开（模拟开盘）→ 30 分钟内 → 仍不重放
    const { HD: HD2, pushed: p2 } = mkInst(d, { dataWindow: () => true });
    await HD2.watch();
    ok(p2.length === 0, `① 闸开后 30 分钟窗口内不重放（实际推了 ${p2.length} 条）`);
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ── ② 窗口内正常推送 + 30 分钟去重 ──
  {
    const d = mkDir();
    const { HD, pushed } = mkInst(d, {});
    HD.add({ code: '000001', name: '测试股', cost: 10, shares: 1000 });
    await HD.watch();
    ok(pushed.length === 1, `② 窗口内命中推一条（实际 ${pushed.length} 条）`);
    ok(/持仓风控警报/.test(pushed[0] || ''), '② 推送标题是风控警报');
    await HD.watch();
    ok(pushed.length === 1, `② 同一 tick 周期内 30 分钟去重生效（实际 ${pushed.length} 条）`);
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ── ③ 跨重启去重（旧写法反证的正面）：新实例（=冷启动）30 分钟内不重推 ──
  {
    const d = mkDir();
    const a = mkInst(d, {});
    a.HD.add({ code: '000001', name: '测试股', cost: 10, shares: 1000 });
    await a.HD.watch();
    ok(a.pushed.length === 1, `③ 首次推送 1 条（实际 ${a.pushed.length}）`);
    // 旧写法此处：内存 Map 随实例消亡 → 冷启动必重推；新写法从 .holdings_push.json 恢复 → 不推
    const b = mkInst(d, {});
    await b.HD.watch();
    ok(b.pushed.length === 0, `③ 冷启动（新实例读同一落盘）30 分钟内不重推（实际推了 ${b.pushed.length} 条）`);
    // once 类型同样跨重启有效：000002 到止盈线（once）
    const c = mkInst(d, { price: 12 });   // 现价 12 / 成本 10 → +20% ≥ 15% 止盈
    c.HD.add({ code: '000002', name: '测试股', cost: 10, shares: 1000 });
    await c.HD.watch();
    ok(c.pushed.length === 1, `③ once 类型首次推送 1 条（实际 ${c.pushed.length}）`);
    const e = mkInst(d, { price: 12 });
    await e.HD.watch();
    ok(e.pushed.length === 0, `③ once 类型冷启动后也不重推（实际推了 ${e.pushed.length} 条）`);
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ── ④ 落盘文件只含 type:code→ts 与 once 键，绝不落成本/金额/股数（脱敏红线）──
  {
    const d = mkDir();
    const { HD } = mkInst(d, {});
    HD.add({ code: '000001', name: '测试股', cost: 10, shares: 1000 });
    await HD.watch();
    const raw = fs.readFileSync(path.join(d, '.holdings_push.json'), 'utf8');
    ok(!/cost|shares|market|capital|成本|股/.test(raw), '④ 去重状态文件不含成本/股数/金额字段');
    const st = JSON.parse(raw);
    ok(typeof st.rep['止损:000001'] === 'number' && Array.isArray(st.once), '④ 结构为 {rep:{key:ts}, once:[key]}');
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ── ⑤ 载入剪枝：7 天前的旧键不生效（到期该提醒的还能提醒）──
  {
    const d = mkDir();
    fs.writeFileSync(path.join(d, '.holdings_push.json'), JSON.stringify({ rep: { '止损:000001': Date.now() - 8 * 86400e3 }, once: [] }));
    const { HD, pushed } = mkInst(d, {});
    HD.add({ code: '000001', name: '测试股', cost: 10, shares: 1000 });
    await HD.watch();
    ok(pushed.length === 1, `⑤ 8 天前的旧键已剪枝、照常提醒（实际 ${pushed.length} 条）`);
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ── ⑥ 手动巡检（checkNow）不受数据窗口闸影响 ──
  {
    const d = mkDir();
    const { HD, pushed } = mkInst(d, { dataWindow: () => false });
    HD.add({ code: '000001', name: '测试股', cost: 10, shares: 1000 });
    await HD.checkNow();
    ok(pushed.length === 1, `⑥ 盘外手动「立即盯一次」照常推送（实际 ${pushed.length} 条）`);
    fs.rmSync(d, { recursive: true, force: true });
  }

  // ── ⑦ 源码语义：不注入 dataWindow 时默认放行（生产旧行为零变化）+ 载入失败不许空 catch ──
  {
    const src = fs.readFileSync(path.join(__dirname, 'holdings.js'), 'utf8');
    ok(/typeof dataWindow === 'function' \? dataWindow : \(\) => true/.test(src), '⑦ dataWindow 未注入时默认放行（不注入=行为零变化）');
    const loadBlock = src.slice(src.indexOf('const _pushState'), src.indexOf('const savePushState'));
    ok(/console\.error/.test(loadBlock), '⑦ 去重状态载入失败必须留日志（hi 轮教训：初始化期不许空 catch 静默吞）');
  }

  console.log(`\n合计：${pass} 过 / ${fail} 败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('套件崩溃:', e); process.exit(1); });
