// 自学引擎 v2 单元测试（_test_learnall.js）
// ---------------------------------------------------------------------------
// 锁死两类事情：
//   ① v1 的翻车点不能再发生 —— 字段名对不上导致特征全是常数（vr恒1/位置恒0.5/斜率恒0）
//   ② v2 的核心契约：幂等增量入库、双目标、自动挖规律、predictML 概率合成
'use strict';
const fs = require('fs');
const path = require('path');
const L = require('./learnall.js');

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const sec = t => console.log('\n' + t);

// 项目里的真实K线字段名：close/high/low/volume/amount/pct/date
function makeRealRows(pcts) {
  let c = 10; const rows = [];
  for (let i = 0; i < pcts.length; i++) {
    const pc = pcts[i];
    const o = c;
    const cl = +(c * (1 + pc / 100)).toFixed(3);
    rows.push({
      date: '202609' + String(10 + i).padStart(2, '0'),
      open: +o.toFixed(3), close: cl,
      high: +Math.max(cl, o).toFixed(3), low: +Math.min(cl, o).toFixed(3),
      volume: 100000 + i * 20000, amount: (100000 + i * 20000) * cl * 100,
      pct: pc
    });
    c = cl;
  }
  return rows;
}

sec('① 字段兼容：真实K线格式必须抽出「活着」的特征（v1 就是死在这里）');
{
  const rows = makeRealRows([1, 2, 3, -1, 2, 4, 1, -2, 3]);
  const f = L.extractFeatures(rows, 5);
  ok('能抽出特征', !!f);
  ok('pct 正确', f.pct === 4, JSON.stringify(f));
  ok('vr 不再恒等于1', f.vr !== 1, 'vr=' + f.vr);
  ok('rangePos 不再恒等于0.5', f.rangePos !== 0.5, 'pos=' + f.rangePos);
  ok('ma5slope 不再恒等于0', f.ma5slope !== 0, 'slope=' + f.ma5slope);
  ok('upCons 合理（≤10）', f.upCons >= 0 && f.upCons <= 10, 'upCons=' + f.upCons);
  ok('amt 由 amount 换算成亿', f.amt > 0, 'amt=' + f.amt);
  ok('新增特征齐全', 'closePos' in f && 'gap20' in f && 'amp20' in f && 'cum5' in f && 'zt20' in f);
  const h = L.featHealth(rows);
  ok('featHealth 判定 vr 不是常数', h.constVr > 1, 'constVr=' + h.constVr);
}
{
  // amount 缺失（腾讯备用源全是0）→ 必须能用 量×100×价 估算，而不是落成"成交<1亿"
  const rows = makeRealRows([1, 2, 3]).map(r => ({ ...r, amount: 0, pct: 0 }));
  const f = L.extractFeatures(rows, 2);
  ok('amount=0 时成交额由成交量估算', f.amt > 0, 'amt=' + f.amt);
  ok('pct=0 且能给时退回收盘价算涨跌幅', Math.abs(f.pct - 3) < 1.2, 'pct=' + f.pct);
}

sec('② 双目标标注：涨≥3% 与 次日封板 分开数');
{
  const rows = makeRealRows([1, 2, 10, -1, 4, 0.5]);
  ok('idx3 次日涨0.5% → up3=0', L.labelNext(rows, 4) === 0);
  ok('最后一日无次日 → null', L.labelNext(rows, 5) === null);
  // 涨停 sample：idx1 次日(idx2)涨10% → 主板10%算封板
  ok('idx1 次日 +10% → 封板=1', L.labelZt(rows, 1, 10) === 1);
  ok('同上换成20cm板块就不算封板', L.labelZt(rows, 1, 20) === 0);
  ok('idx3 次日小涨 → 封板=0', L.labelZt(rows, 3, 10) === 0);
}

sec('③ 幂等增量入库：反复灌同一批K线不能重复计数');
{
  const tmp = path.join(__dirname, '_learnall_unit_tmp.json');
  const origSetup = (code, rowsN) => {
    const rows = [];
    for (let i = 0; i < rowsN; i++) rows.push({
      date: '20260' + (i + 1) + '01', close: 10 + i * 0.1, high: 10.1 + i * 0.1, low: 9.9 + i * 0.1,
      open: 10, volume: 1000 + i, amount: 1e8 + i * 1e6, pct: (i % 5) - 2
    });
    return { rows, limitPct: 10 };
  };
  const db0 = L.freshDb();
  const set = { '000001': origSetup('000001', 30) };
  // 直接在内存库上计数（不落盘，避免污染 learnall.json）
  let cnt = 0;
  const end = set['000001'].rows.length - 2;
  for (let i = 1; i <= end; i++) {
    const f = L.extractFeatures(set['000001'].rows, i, { limitPct: 10 });
    L.countSample(db0, f, L.labelNext(set['000001'].rows, i), L.labelZt(set['000001'].rows, i, 10));
    cnt++;
  }
  ok('计入 ' + cnt + ' 条', db0.n === cnt, 'n=' + db0.n);
  ok('hitsZt 也被累计', typeof db0.hitsZt === 'number' && db0.hitsZt >= 0);
  ok('统计立方同时有单条件和组合cell', Object.keys(db0.stat).some(k => k.startsWith('S:')) && Object.keys(db0.stat).some(k => k.startsWith('P:')));
  const cellKey = Object.keys(db0.stat).find(k => k.startsWith('S:'));
  const cell = db0.stat[cellKey];
  ok('cell 结构是 [n, hits3, hitsZt]', Array.isArray(cell) && cell.length === 3, cellKey + '=' + JSON.stringify(cell));
}
{
  // 幂等：第二次 ingestAll 在同一批数据上必须 added=0
  const db = L.freshDb();
  const rows = [];
  for (let i = 0; i < 30; i++) rows.push({
    date: '2026' + String(i + 1).padStart(2, '0') + '01', close: 10 + i * 0.1, high: 10.2 + i * 0.1, low: 9.8 + i * 0.1,
    open: 10, volume: 1000 + i * 37, amount: 1e8 + i * 1e6, pct: (i % 7) - 3
  });
  let last = '';
  const runOnce = () => {
    // 模拟 ingestAll 的进度游标逻辑
    let added = 0;
    let from = last ? rows.findIndex(r => r.date > last) : 0;
    if (from < 0) return added;
    const end = rows.length - 2;
    for (let i = Math.max(1, from); i <= end; i++) {
      const f = L.extractFeatures(rows, i, { limitPct: 10 });
      L.countSample(db, f, L.labelNext(rows, i), L.labelZt(rows, i, 10));
      added++;
    }
    last = rows[end].date;
    return added;
  };
  const a1 = runOnce(), a2 = runOnce();
  const base = db.n;
  ok('首次放出样本', a1 > 0, 'added=' + a1);
  ok('第二次同批数据 0 新增（幂等）', a2 === 0, 'added=' + a2);
  ok('总数不变', db.n === base && db.n === a1, `n=${db.n} a1=${a1}`);
}

sec('④ 自动挖规律：只用统计立方，不靠手写结论');
{
  const db = L.freshDb();
  // 造一个真正有信号的世界（确定性伪随机）：
  //   基准命中率 20%；「高量比」+15pp；「5日动能强」再 +20pp；封板只在强动能里少量发生。
  const mkFeat = (hiVR, strong) => ({
    pct: 0.5, vr: hiVR ? 3 : 0.9, rangePos: 0.5, upCons: 1, ma5slope: 0, gap: 3, amt: 2,
    closePos: 0.5, gap20: 5, amp20: 30, cum5: strong ? 10 : 0.5, zt20: 0
  });
  const rand = (k, salt) => (((k * 2654435761 + salt * 40503) >>> 0) % 1000) / 1000;
  for (let k = 0; k < 4000; k++) {
    const hiVR = k % 2 === 0, strong = k % 4 === 0;
    const p = 0.20 + (hiVR ? 0.15 : 0) + (strong ? 0.20 : 0);
    const up3 = rand(k, 1) < p ? 1 : 0;
    const zt = (up3 && strong && rand(k, 2) < 0.35) ? 1 : 0;
    L.countSample(db, mkFeat(hiVR, strong), up3, zt);
  }
  const r3 = L.mineRules(db, { target: 'up3' });
  const rzt = L.mineRules(db, { target: 'zt' });
  db.rules = { up3: r3, zt: rzt };
  const pr3 = L.predictML(mkFeat(true, true), db, 'up3');    // 高量比 + 强动能
  const pr1 = L.predictML(mkFeat(true, false), db, 'up3');   // 只有高量比
  const pr0 = L.predictML(mkFeat(false, false), db, 'up3');  // 啥特征都没有
  ok('up3 基准落在 20%~40% 区间', r3.base > 0.2 && r3.base < 0.4, 'base=' + r3.base);
  ok('zt 基准明显低于 up3', rzt.base < r3.base, `zt=${rzt.base} up3=${r3.base}`);
  ok('机器挖到了「量比」这条规律', (r3.single || []).some(x => x.txt.indexOf('量比') >= 0),
    JSON.stringify((r3.single || []).map(x => x.txt)));
  ok('机器挖到了「5日动能」这条规律', (r3.single || []).some(x => x.txt.indexOf('5日') >= 0),
    JSON.stringify((r3.single || []).map(x => x.txt)));
  ok('两个目标各自独立挖规则', r3.target === 'up3' && rzt.target === 'zt');
  ok('三个世界被正确排序 强+强 > 只有强 > 都没有', pr3 && pr1 && pr0 && pr3.p > pr1.p && pr1.p > pr0.p,
    `${pr3 && pr3.p.toFixed(3)} / ${pr1 && pr1.p.toFixed(3)} / ${pr0 && pr0.p.toFixed(3)}`);
  ok('predictML 带回可解释的自学依据', pr3.rules && pr3.rules.length > 0, JSON.stringify(pr3.rules));
  ok('rule 带文本/样本数/真实命中率', pr3.rules[0].txt && pr3.rules[0].n > 0 && typeof pr3.rules[0].rate === 'number');
  const prZ = L.predictML(mkFeat(true, true), db, 'zt');
  ok('同特征下「封板概率」低于「涨≥3%概率」', prZ.p < pr3.p, `${prZ.p.toFixed(3)} vs ${pr3.p.toFixed(3)}`);
  ok('rule 文案全部由 bin 名自动生成（没有手写的"龙头/强势"之类结论）',
    pr3.rules.every(r => /^[\u4e00-\u9fa5%×~<>\-0-9.\s]+$/.test(r.txt) && !/龙头|强势股|妖股|必涨/.test(r.txt)),
    JSON.stringify(pr3.rules.map(r => r.txt)));
}

sec('⑤ 版本迁移：v1 的假样本必须被丢掉，不能混进来');
{
  const src = fs.readFileSync(path.join(__dirname, 'learnall.js'), 'utf8');
  ok('load() 检测到旧版本号会重建', /db\.ver !== VER/.test(src));
  ok('不再依赖 db.samples 做建模', !/db\.samples\.push/.test(src));
  ok('save() 会同时挖 up3 与 zt 两套规则', /target: 'up3'/.test(src) && /target: 'zt'/.test(src));
  const db = L.freshDb();
  ok('freshDb 带双目标计数', 'hitsZt' in db && 'stat' in db && 'prog' in db);
}

sec('⑥ 线上库现状（自学成果是不是真的）');
{
  try {
    const db = L.load();
    if (db.ver === L.VER && db.n > 0) {
      console.log(`  当前库：${db.n} 样本 / ${Object.keys(db.prog || {}).length} 只票 / ${Object.keys(db.days || {}).length} 个交易日`);
      console.log(`  基准：涨≥3% ${(db.base * 100).toFixed(2)}% ｜ 封板 ${((db.baseZt || 0) * 100).toFixed(2)}%`);
      ok('样本量 ≥ 10万（全量回填后）', db.n >= 100000, 'n=' + db.n);
      ok('覆盖 ≥ 1000 只票', Object.keys(db.prog || {}).length >= 1000, String(Object.keys(db.prog || {}).length));
      ok('两套规律都已挖出', !!(db.rules && db.rules.up3 && db.rules.zt));
      ok('挖出的单条件规律 ≥ 5 条', (db.rules.up3.single || []).length >= 5, String((db.rules.up3.single || []).length));
      ok('挖出的组合规律 ≥ 5 条', (db.rules.up3.pair || []).length >= 5, String((db.rules.up3.pair || []).length));
      const b = db.buckets || {};
      ok('pct 分桶仍在（向后兼容面板）', !!b['涨停'] && b['涨停'].n > 0, JSON.stringify(b['涨停']));
      const sz = fs.statSync(L.FILE).size;
      ok('体积比 v1(2.4MB) 小得多', sz < 1024 * 1024, (sz / 1024).toFixed(1) + ' KB');
    } else {
      ok('（未回填，跳过线上库断言）', true);
    }
  } catch (e) { ok('读线上库失败', false, e.message); }
}

console.log('\n──────────────────────────────');
console.log(`自学引擎 v2 单测：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
