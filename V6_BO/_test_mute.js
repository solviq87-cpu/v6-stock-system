// 暂停推送（mute）单测：
//  ① 新增时带 mute → 落盘 + compute 返回 muted
//  ② muted 的票不会推手机（watch 跳过），但 compute 里建议照常算出来
//  ③ 解除静音后能重新提醒一次（once 标记在静音期间被清掉）
// 用临时目录跑，绝不碰真实 holdings.json
const fs = require('fs'), path = require('path'), os = require('os');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'qdmute-'));
fs.writeFileSync(path.join(TMP, 'holdings.json'), JSON.stringify({ capital: 0, items: [], stopPct: -8, reducePct: -4, takePct: 15, maxPosPct: 90 }));

const pushed = [];
const HD = require('./holdings.js')({
  fs, path, dir: TMP,
  S: { klines: new Map(), stocks: [], news: { badCodes: new Set() } },
  em: {
    async fetchBatchSnapshot(codes) {
      return codes.map(c => ({ code: c, name: '测试股', price: 12, pct: 0, prevClose: 12, mainInflow: 0, mainPct: 0 }));
    },
    async fetchKline(code, n) {
      // 近 10 日高点 = 12（等于现价，回撤 0）→ 只触发「越过止盈线」，不触发回撤
      return { rows: Array.from({ length: n || 30 }, () => ({ open: 12, close: 12, high: 12, low: 12, vol: 100 })) };
    },
    async fetchThsActiveBatch() { return []; }
  },
  sseSend() {}, sseSendEdit() {},
  pushAll(t) { pushed.push(t); },
  // ⛔ 注入固定工作日时钟（2026-10-14 周三）—— watch() 周末跳过止盈/回撤，
  //    不注入则本测试被"今天星期几"绑架（周末恒红）。注入后任何一天跑都同结果。
  nowDate: () => new Date(2026, 9, 14, 10, 0, 0)
});

const ok = (b, s) => console.log(`${b ? '✅' : '❌'} ${s}`);

(async () => {
  console.log('止盈线 15%，成本 10，现价 12（浮盈 20%，回撤 0）\n');

  // ① 新增时直接勾「暂停推送」
  let r = HD.add({ code: '000001', name: '测试股', cost: 10, shares: 1000, mute: true });
  console.log('新增返回:', r.msg);
  const saved = JSON.parse(fs.readFileSync(path.join(TMP, 'holdings.json'), 'utf8'));
  ok(saved.items[0].mute === true, '① 新增带 mute=true 已落盘');

  let c = await HD.compute(true);
  ok(c.items[0].muted === true, '① compute 返回 muted=true（前端能渲染 🔇 标签）');
  ok((c.items[0].acts || []).some(a => a.type === '止盈'), '② 静音后「止盈」建议照常算出来（面板仍可见）');

  // ② watch：静音中不应推手机
  pushed.length = 0;
  await HD.watch();
  ok(pushed.length === 0, `② 静音期间 watch 未推手机（实际推了 ${pushed.length} 条）`);

  // ③ 解除静音 → 应重新提醒一次
  const rm = HD.setMute('000001', false);
  console.log('解除返回:', rm.msg);
  pushed.length = 0;
  await HD.watch();
  ok(pushed.length === 1, `③ 解除后推了一次（实际 ${pushed.length} 条）`);
  if (pushed[0]) console.log('   推送内容首行:', pushed[0].split('\n')[0], '|', (pushed[0].match(/【止盈】/) || ['无'])[0]);

  // ④ 再一次 watch：once 生效，不应重复推
  pushed.length = 0;
  await HD.watch();
  ok(pushed.length === 0, `④ 同一条只推一次，第二次不再推（实际 ${pushed.length} 条）`);

  // ⑤ 重新静音后 once 标记被清掉 → 再解除能重新提醒
  HD.setMute('000001', true);
  await HD.watch();                       // 静音期间跑一轮，触发标记清理
  HD.setMute('000001', false);
  pushed.length = 0;
  await HD.watch();
  ok(pushed.length === 1, `⑤ 静音→解除 能重新提醒一次（实际 ${pushed.length} 条）`);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log('\n（临时目录已清理，真实 holdings.json 未被触碰）');
})();
