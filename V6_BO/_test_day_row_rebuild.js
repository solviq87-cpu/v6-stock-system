// 守门：兜底源「当日行」失真必须按东财快照**重建**，不许把盘中价当收盘价、也不许把行删掉了事
// ────────────────────────────────────────────────────────────────────────
// 事故（2026-10-27 le 轮，用户「每个数字可信」）：
//   002995 天地在线 缓存文件 mtime = 2026-10-27 11:01，末行 close=19.77 —— 那是 11:01 那一刻的
//   涨停价；真实收盘 18.52（东财快照 price=18.52、high=19.77，说明盘中确实触过板）。
//   ks 轮的守卫判「失真」后把整行**丢弃**，klineBackfill 见「没有当日行」判源滞后**不写盘**，
//   于是缓存永久冻在 11:01：① 43 只池成员长期缺当日行（形态/连板用陈旧行）
//   ② 漏网的盘中行被判成收盘价 → 审计反复报「假漏票」（002995/002086）。
// 钉的语义（不钉字符串）：
//   ① 口径一致（末二行 close == 快照 preClose，≤0.2%）→ 重建：收盘/开/高/低/量/额/换手全换真值
//   ② 重建后 close 必须严格等于快照 price —— 宁可判不出退回丢弃，绝不写错价
//   ③ 前复权/除权票（末二行 close ≠ 快照 preClose）→ 返回 null，调用方退回丢弃
//   ④ 快照自身不自洽（high < price / low > price / 缺 price|preClose）→ 返回 null
//   ⑤ volume 单位自适应：历史行是「股」时不除 100，是「手」时才除
'use strict';
const em = require('./em.js');

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m + (extra ? '  → ' + extra : '')); } };
const group = t => console.log('\n── ' + t + ' ──');
const near = (a, b, eps) => Math.abs(Number(a) - Number(b)) <= (eps == null ? 0.011 : eps);

// 历史行：amount/volume 反推均价 10 元，落在 [low,high] → 判为「手」
function hist(opt) {
  const o = opt || {};
  const vol = o.share ? 1000000 : 10000;        // share=true 表示该源的 volume 单位是「股」
  const amt = vol * (o.share ? 10 : 1000);      // 成交额恒为 1e7：股=量×价，手=量×100×价
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push({ date: '2026-10-2' + (i + 1), open: 9.9, close: o.lastClose == null ? 10 : o.lastClose,
      high: 10.2, low: 9.8, volume: vol, amount: amt, amp: 4, pct: 0, chg: 0, turnover: 8 });
  }
  return out;
}
const REF = { code: '002995', name: '天地在线', price: 10.95, open: 10.1, high: 11.0, low: 9.9,
  volume: 2000000, amount: 21000000, turnover: 12.5, pct: 9.5, preClose: 10 };

group('[1] 口径一致 → 按快照重建（价格/量能/换手全换真值）');
{
  const rows = hist();
  rows.push({ date: '2026-10-27', open: 10.1, close: 11.0, high: 11.0, low: 9.9, volume: 5000, amount: 5000000, pct: 10, amp: 11 });
  const fixed = em.rebuildDayRow(rows, REF);
  ok(!!fixed, '返回了一根重建行');
  ok(fixed && fixed.close === REF.price, '收盘价严格等于快照 price（' + (fixed && fixed.close) + '）');
  ok(fixed && fixed.date === '2026-10-27', '日期保留原来的交易日');
  ok(fixed && fixed.high === 11.0 && fixed.low === 9.9, '最高/最低取快照真值');
  ok(fixed && fixed.volume === 20000, 'volume 按「手」换算（2000000 股 → 20000 手，实测 ' + (fixed && fixed.volume) + '）');
  ok(fixed && fixed.amount === 21000000, '成交额取快照真值');
  ok(fixed && near(fixed.chg, 0.95), 'chg = 收 - 前收');
  ok(fixed && near(fixed.amp, 11.0), 'amp = (高-低)/前收×100');
  ok(fixed && near(fixed.pct, 9.5, 0.001), 'pct 取快照真值（不是自己按价算，避免与行情口径打架）');
  ok(fixed && fixed.rebuilt === true, '打上 rebuilt 留痕（这一行不是数据源原文）');
  ok(fixed && fixed.turnover === 12.5, '换手率取快照真值');
}

group('[2] 前复权/除权票（末二行 close ≠ 快照 preClose）→ 绝不重建');
{
  const rows = hist({ lastClose: 9.5 });        // 前收 9.5 vs 快照 preClose 10 → 差 5%，口径不同
  rows.push({ date: '2026-10-27', close: 11.0, high: 11.0, low: 9.9, volume: 5000, amount: 5000000 });
  ok(em.rebuildDayRow(rows, REF) === null, '口径不一致返回 null（调用方退回丢弃，不写错价）');
}

group('[3] 快照自身不自洽 → 不信它');
{
  const rows = hist();
  rows.push({ date: '2026-10-27', close: 11.0, high: 11.0, low: 9.9, volume: 5000, amount: 5000000 });
  ok(em.rebuildDayRow(rows, Object.assign({}, REF, { high: 10.5 })) === null, 'high < price → null');
  ok(em.rebuildDayRow(rows, Object.assign({}, REF, { low: 11.5 })) === null, 'low > price → null');
  ok(em.rebuildDayRow(rows, Object.assign({}, REF, { price: 0 })) === null, '缺 price → null');
  ok(em.rebuildDayRow(rows, Object.assign({}, REF, { preClose: 0 })) === null, '缺 preClose → null');
  ok(em.rebuildDayRow(rows, Object.assign({}, REF, { high: 0, low: 0 })) !== null, '缺 high/low 时用 max/min 兜底仍可重建');
}

group('[4] volume 单位自适应：历史行是「股」就不除 100');
{
  const rows = hist({ share: true });
  rows.push({ date: '2026-10-27', close: 11.0, high: 11.0, low: 9.9, volume: 5000, amount: 5000000 });
  const fixed = em.rebuildDayRow(rows, REF);
  ok(fixed && fixed.volume === 2000000, '股单位源：volume 原样保留（实测 ' + (fixed && fixed.volume) + '）');
}

group('[5] 参数不足时不瞎修');
{
  ok(em.rebuildDayRow([], REF) === null, '空 rows → null');
  ok(em.rebuildDayRow([{ date: '2026-10-27', close: 11 }], REF) === null, '只有一根（无前收可比）→ null');
  ok(em.rebuildDayRow(hist(), null) === null, '无快照 → null');
}

group('[6] 真实快照联动：guardDayRow 不得把盘中价原样留下');
{
  // 用真实 stocks_snapshot.json 里今天有行情的票做端到端：坏行只能变成「重建」或「丢弃」，绝不许原样通过
  const fs = require('fs'), path = require('path');
  const SNAP = path.join(__dirname, 'stocks_snapshot.json');
  const st = fs.statSync(SNAP);
  const t = new Date(); t.setHours(21, 0, 0, 0);
  // ms 轮：注入「收盘后」时钟，避免本组在 00:00~15:05 因守卫盘中早退而恒红
  const gd = (code, k) => em.guardDayRow(code, k, t);
  try {
    fs.utimesSync(SNAP, new Date(), t);          // 让守卫认为「尺子是今天收盘后拉的」
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')).rows || [];
    const cand = snap.find(r => Number(r.price) > 1 && Number(r.preClose) > 1 && Number(r.high) > 0);
    if (!cand) { ok(true, '快照无可用样本，跳过（不算失败）'); }
    else {
      const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
      const rows = [
        { date: '2026-10-20', open: cand.preClose, close: cand.preClose, high: cand.preClose, low: cand.preClose, volume: 1000, amount: cand.preClose * 1000 * 100 },
        { date: today, open: cand.preClose, close: cand.high, high: cand.high, low: cand.low, volume: 100, amount: 12345 }
      ];
      const k = gd(cand.code, { code: cand.code, src: 'ths', rows });
      const lastRow = k.rows[k.rows.length - 1];
      const keepBad = k.rows.length === 2 && lastRow && lastRow.date === today && near(lastRow.close, cand.high, 0.01) && Number(cand.high) !== Number(cand.price);
      ok(!keepBad, '坏收盘价没有被原样保留（' + cand.code + ' 模拟收=' + cand.high + ' 真收=' + cand.price + '）');
      ok(!!(k.dayRowRebuilt || k.dayRowDropped), '留痕标记存在（rebuilt=' + !!(k.dayRowRebuilt) + ' dropped=' + !!(k.dayRowDropped) + '）');
      ok(!k.dayRowRebuilt || near(lastRow.close, cand.price, 0.001), '若重建则收盘价必须等于快照真价');
    }
  } finally {
    try { fs.utimesSync(SNAP, new Date(st.atimeMs), new Date(st.mtimeMs)); } catch { }
  }
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
