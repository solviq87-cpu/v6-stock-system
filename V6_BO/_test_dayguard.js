// 一次性验证：兜底源当日行守卫（不进发布包）
// 用法：node _test_dayguard.js
const fs = require('fs'), path = require('path');
const em = require('./em.js');

const SNAP = path.join(__dirname, 'stocks_snapshot.json');
const st = fs.statSync(SNAP);
const orig = { atimeMs: st.atimeMs, mtimeMs: st.mtimeMs };
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

(async () => {
  // 把快照 mtime 临时改成「今天收盘后」，让守卫有尺子可用（末尾必须恢复）
  const t = new Date(); t.setHours(21, 0, 0, 0);
  fs.utimesSync(SNAP, new Date(t.getTime() / 1000 * 1000), t);
  // ms 轮：注入「收盘后」时钟。守卫盘中不校验是正确语义，但守门若读真实时钟，则每天 00:00~15:05 恒红
  // （7 条断言全废、发版闸门被误拦）。显式传 t（今天 21:00）后本套件可在任意时刻真验重建/丢弃/留痕。
  const gd = (code, k) => em.guardDayRow(code, k, t);

  const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')).rows || [];

  console.log('== 1. 兜底源坏当日行（写成盘中价，真实收盘以快照为准）→ 口径一致时按快照重建 ==');
  {
    // ⛔ 不钉死样本（原 920091 会随当日快照池漂移消失→断言漂移假红，2026-10-30 实红 3 条）：
    //    从「此刻快照」动态取一只价/前收齐全的票当尺子，快照里一张票都没有才跳过。
    const _r = snap.find(x => Number(x.price) > 1 && Number(x.preClose) > 1) || null;
    if (!_r) { ok(true, '快照无任何可用样本，跳过（不算失败）'); }
    else {
      const _truth = Number(_r.price), _pre = Number(_r.preClose);
      const k1 = gd(_r.code, { code: _r.code, src: 'ths', rows: [
        { date: '2026-01-01', close: _pre },
        { date: today, close: Number((_truth * 1.05).toFixed(2)), high: Number((_truth * 1.06).toFixed(2)), low: Number((_truth * 1.04).toFixed(2)), volume: 100, amount: 1234 }
      ] });
      ok(k1.rows.length === 2 && !!k1.dayRowRebuilt, `当日行被重建（不是删掉，也不是原样留下盘中价）（${_r.code}）`);
      ok(k1.rows.length === 2 && Math.abs(Number(k1.rows[1].close) - _truth) < 0.001, `重建后收盘价 = 快照真价 ${_truth}（实测 ${k1.rows[1] && k1.rows[1].close}）`);
    }
  }

  console.log('== 1b. 口径一致（末二行 == 快照前收）但收盘错 → 必须按快照重建，不许删行 ==');
  {
    const snap = JSON.parse(fs.readFileSync(SNAP, 'utf8')).rows || [];
    const cand = snap.find(r => Number(r.price) > 1 && Number(r.preClose) > 1 && Number(r.high) > 0 && Math.abs(Number(r.high) - Number(r.price)) > 0.03);
    if (!cand) { ok(true, '快照无可用样本，跳过（不算失败）'); }
    else {
      const kk = gd(cand.code, { code: cand.code, src: 'ths', rows: [
        { date: '2026-01-01', close: Number(cand.preClose) },
        { date: today, open: Number(cand.open) || Number(cand.preClose), close: Number(cand.high), high: Number(cand.high), low: Number(cand.low), volume: 100, amount: 1234, turnover: 1 }
      ] });
      const lastRow = kk.rows[kk.rows.length - 1];
      ok(kk.rows.length === 2 && !!kk.dayRowRebuilt, `当日行被重建而非删除（${cand.code}）`);
      ok(lastRow && Math.abs(Number(lastRow.close) - Number(cand.price)) < 0.001, `重建后收盘价 = 快照真价 ${cand.price}（实测 ${lastRow && lastRow.close}）`);
      ok(lastRow && Number(lastRow.amount) === Number(cand.amount), '成交额换成快照真值');
    }
  }

  console.log('== 1c. 前收对不上快照（疑似除权）→ 口径存疑，一个字都不动 ==');
  {
    const _r1c = snap.find(x => Number(x.price) > 1) || null;
    if (!_r1c) { ok(true, '快照无任何可用样本，跳过（不算失败）'); ok(true, '跳过（不算失败）'); }
    else {
      const _truth = Number(_r1c.price);
      const kk = gd(_r1c.code, { code: _r1c.code, src: 'ths', rows: [
        { date: '2026-01-01', close: _truth * 0.5 },   // 前收差一半：复权口径不同
        { date: today, close: Number((_truth * 1.05).toFixed(2)), high: Number((_truth * 1.06).toFixed(2)), low: Number((_truth * 1.04).toFixed(2)), volume: 100, amount: 1234 }
      ] });
      ok(kk.rows.length === 2 && !!kk.dayRowAdjMismatch, '口径不一致时不改行，只标记 dayRowAdjMismatch（除权票不误杀）');
      ok(!kk.dayRowDropped && !kk.dayRowRebuilt, '既没丢弃也没重建');
    }
  }

  let k;
  console.log('== 2. 兜底源正确当日行（收盘价与快照一致）应保留 ==');
  {
    const _r2 = snap.find(x => Number(x.price) > 1) || null;
    if (!_r2) { ok(true, '快照无任何可用样本，跳过（不算失败）'); }
    else {
      k = { code: _r2.code, src: 'ths', rows: [{ date: '2026-01-01', close: 25.78 }, { date: today, close: Number(_r2.price), high: Number(_r2.price) }] };
      k = gd(_r2.code, k);
      ok(k.rows.length === 2 && !k.dayRowDropped, '正确当日行未被误杀');
    }
  }

  console.log('== 3. 东财源（src=em）即使数值离谱也绝不拦 ==');
  k = { code: '920091', src: 'em', rows: [{ date: '2026-01-01', close: 25.78 }, { date: today, close: 1.00, high: 1.00 }] };
  k = gd('920091', k);
  ok(k.rows.length === 2 && !k.dayRowDropped, '东财源不校验');

  console.log('== 4. 末行不是今天（源滞后）→ 交给上层判陈旧，守卫不动手 ==');
  k = { code: '920091', src: 'ths', rows: [{ date: '2026-01-01', close: 26.30 }] };
  k = gd('920091', k);
  ok(k.rows.length === 1 && !k.dayRowDropped, '非当日行不处理');

  console.log('== 5. 分币级舍入（0.01 元）不触发 ==');
  {
    const _r5 = snap.find(x => Number(x.price) > 1) || null;
    if (!_r5) { ok(true, '快照无任何可用样本，跳过（不算失败）'); }
    else {
      k = { code: _r5.code, src: 'ths', rows: [{ date: '2026-01-01', close: 1.05 }, { date: today, close: Number(_r5.price) + 0.01 }] };
      k = gd(_r5.code, k);
      ok(k.rows.length === 2 && !k.dayRowDropped, `小偏差放行（ref=${_r5.price}）`);
    }
  }

  console.log('== 6. 快照里没有的票 → 保留并标记 unverified ==');
  k = { code: '999999', src: 'ths', rows: [{ date: '2026-01-01', close: 1 }, { date: today, close: 2 }] };
  k = gd('999999', k);
  ok(k.rows.length === 2 && k.dayRowUnverified === true, '无尺子时不丢行，只标记');

  console.log('== 7. 没有「今天的收盘快照」当尺子 → 守卫整体不工作，但必须被计数（noSnap）==');
  {
    // ⛔ 2026-10-28 补：旧写法 `if (!map) return k;` 一行不留 —— 于是「快照 15:05 后没更新（数据源断）」
    //    与「守卫跑过了、全部通过」在巡检上一模一样。判不出必须可观测。
    const before = em.dayGuardStats().noSnap;
    const st2 = fs.statSync(SNAP);
    const y = new Date(); y.setDate(y.getDate() - 1); y.setHours(21, 0, 0, 0);
    fs.utimesSync(SNAP, new Date(st2.atimeMs), y);
    const kk = gd('920091', { code: '920091', src: 'ths', rows: [
      { date: '2026-01-01', close: 25.78 },
      { date: today, close: 26.30, high: 26.71, low: 26.0, volume: 100, amount: 1234 }
    ] });
    const after = em.dayGuardStats().noSnap;
    ok(kk.rows.length === 2 && !kk.dayRowRebuilt && !kk.dayRowDropped, '无尺子时不改行（不硬判、不拿旧快照当基准）');
    ok(after === before + 1, `守卫失效被计数 noSnap ${before}→${after}（旧写法此处静默，巡检无法区分「失效」与「全部通过」）`);
    fs.utimesSync(SNAP, new Date(orig.atimeMs), new Date(orig.mtimeMs));   // 立刻恢复，避免影响其后用例
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`);
})().catch(e => { console.error(e); fail++; })
  .finally(() => {
    // ⛔ 必须在退出前恢复：快照 mtime 被别的模块当新鲜度判据用，刷成「现在」会让陈旧快照假装新鲜
    try { fs.utimesSync(SNAP, new Date(orig.atimeMs), new Date(orig.mtimeMs)); console.log('快照 mtime 已恢复'); }
    catch (e) { console.error('⚠️ mtime 恢复失败：' + e.message); }
    process.exit(fail ? 1 : 0);
  });
