// du 轮侦察：一份数据被截断 / 归并之后，依赖它的结论还成不成立
// ① 模拟盘流水 300 条上限 → 对账重算依赖全流水，超限后是否永久对不上
// ② 面板显示 12 笔 / 接口下发 30 笔 / 对账按全量 N 笔 → 同一个「笔数」三个值
// ③ 副本回拉归并键 t|code|side 会不会误并（同毫秒批量成交）
// ④ 推送流水 500 条上限 → pushedToday 的「今天已发」证据会不会被挤掉
const fs = require('fs');
const path = require('path');

console.log('=== du 轮侦察：截断与归并 ===\n');

// ---------- ① 模拟盘流水 ----------
const pj = JSON.parse(fs.readFileSync(path.join(__dirname, 'paper.json'), 'utf8'));
const accs = pj.accounts || pj;
console.log('【① 模拟盘流水容量】');
for (const k of Object.keys(accs)) {
  const a = accs[k];
  if (!a || !Array.isArray(a.trades)) continue;
  const tl = a.trades;
  const keys = tl.map(t => String(t.t) + '|' + t.code + '|' + t.side);
  const dup = keys.length - new Set(keys).size;
  // 同 ts 的批量成交（实证：一次买 5 只，毫秒级相同）
  const byTs = {};
  for (const t of tl) { const s = String(t.t); (byTs[s] = byTs[s] || []).push(t.code + '/' + t.side); }
  const batch = Object.keys(byTs).filter(s => byTs[s].length > 1);
  console.log(`  [${k}] 流水 ${tl.length} 笔 / 上限 300（占用 ${(tl.length / 300 * 100).toFixed(0)}%）` +
    ` · 归并键重复 ${dup} 组 · 同毫秒批量 ${batch.length} 组` +
    (batch.length ? '（最大 ' + Math.max(...batch.map(s => byTs[s].length)) + ' 笔同 ts）' : ''));
  if (batch.length) {
    const s0 = batch[0];
    console.log(`     例：ts=${s0} → ${byTs[s0].join(', ')}`);
  }
  // 同 ts + 同 code + 同 side（归并键完全撞车）会不会发生
  const sameAll = Object.keys(byTs).filter(s => {
    const ks = byTs[s].map(x => x);
    return ks.length !== new Set(ks).size;
  });
  console.log(`     ⛔ 归并键完全撞车（同 ts+code+side）: ${sameAll.length} 组`);
}

// ---------- ② 三层笔数 ----------
console.log('\n【② 同一个「笔数」在系统里有几个值】');
console.log('  后端下发 /api/paper: trades.slice(0, 30)');
console.log('  前端渲染流水列表  : (p.trades||[]).slice(0, 12)');
console.log('  对账结论 audit.trades: acc.trades.length（全量）');
console.log('  → 同一个账户，面板看到 12 笔、接口给 30 笔、对账按全量；徽标却只写「已对账」');

// ---------- ③ 超限模拟 ----------
console.log('\n【③ 超过 300 条上限后，对账会怎样】');
const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
function grab(startRe) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('找不到 ' + startRe);
  let d = 0, st = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; st = true; } else if (c === '}') { d--; if (st && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('不配平');
}
const tolM = src.match(/const PAPER_AUDIT_TOL = ([\d.]+);/);
const sb = new Function('PAPER', 'PAPER_CFG', [
  grab(/function paperTradeFlow\(t\) \{/),
  grab(/function paperTol\(n\) \{/),
  grab(/function signTxt\(v\) \{/),
  grab(/function paperBasisGap\(tl\) \{/),
  grab(/function paperAudit\(key\) \{/),
  'const PAPER_AUDIT_TOL = ' + (tolM ? tolM[1] : 0.05) + ';',
  'return { paperAudit };'
].join('\n'));

// 用真实 pre 账户的流水扩展：先跑一遍确认当前一致，再逐步 pop 掉最老的（模拟超限）
for (const k of Object.keys(accs)) {
  const a = accs[k];
  if (!a || !Array.isArray(a.trades) || !a.trades.length) continue;
  const CFG = { [k]: { name: k, initial: Number(a.initial) || (pj.accounts ? null : null) || 200000 } };
  const full = { [k]: { cash: a.cash, realized: a.realized, enabled: true, positions: a.positions || {}, trades: a.trades.slice() } };
  const r0 = sb(full, CFG).paperAudit(k);
  console.log(`  [${k}] 当前 ${a.trades.length} 笔：ok=${r0.ok} dCash=${r0.dCash} tol=${r0.tol}`);
  // 模拟：流水堆到 320 笔后，最老的 20 笔被 pop 掉（unshift 新 + pop 老）
  const grown = a.trades.slice();
  const dropped = grown.splice(grown.length - 20, 20); // 丢掉最老的 20 笔（真实 pop 行为）
  const r1 = sb({ [k]: { cash: a.cash, realized: a.realized, enabled: true, positions: a.positions || {}, trades: grown } }, CFG).paperAudit(k);
  const lostFlow = dropped.reduce((s, t) => {
    const amt = Number(t.amount) || 0;
    let fee = Number(t.fee); if (!Number.isFinite(fee)) fee = Math.max(5, amt * 0.00025) + (String(t.side).indexOf('买') >= 0 ? 0 : amt * 0.0005);
    return s + (String(t.side).indexOf('买') >= 0 ? -(amt + fee) : (amt - fee));
  }, 0);
  console.log(`     模拟丢掉最老 20 笔后：ok=${r1.ok} dCash=${r1.dCash}（丢失现金流 ${lostFlow.toFixed(2)} 元）`);
  console.log(`     ⛔ 判据容差 ${r1.tol} 元，差额 ${r1.dCash} 元 → ${Math.abs(r1.dCash) > r1.tol ? '误判为「账记错了」' : '仍在容差内'}`);
}

// ---------- ④ 推送流水 ----------
console.log('\n【④ 推送流水 500 条上限 vs 「今天已发」闭锁】');
try {
  const pl = JSON.parse(fs.readFileSync(path.join(__dirname, 'pushlog.json'), 'utf8'));
  const arr = Array.isArray(pl) ? pl : [];
  const ds = new Date();
  const today = `${ds.getFullYear()}${String(ds.getMonth() + 1).padStart(2, '0')}${String(ds.getDate()).padStart(2, '0')}`;
  const todays = arr.filter(r => {
    const d = new Date(Number(r.ts) || 0);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` === today;
  });
  console.log(`  落盘 pushlog.json ${arr.length} 条（上限 500）· 今天 ${todays.length} 条`);
  const oldest = arr.length ? new Date(Number(arr[arr.length - 1].ts) || 0) : null;
  console.log(`  最老一条时间：${oldest ? oldest.toLocaleString('zh-CN') : '-'}（覆盖 ${oldest ? Math.ceil((Date.now() - oldest.getTime()) / 86400000) : 0} 天）`);
  console.log(`  ⛔ pushedToday 只在这 ${arr.length} 条里找「今天+✅」；若单日推送 > 500 条，当天早些时候的记录会被挤掉 → 重复推送`);
} catch (e) { console.log('  pushlog 读取失败: ' + e.message); }

// ---------- ⑤ 其它被截断的容器 ----------
console.log('\n【⑤ 其它被截断的容器（谁依赖它们）】');
console.log('  S.learnHistory > 300 → slice(0,300)   // 学习修正流水（healSignArtifact 扫它）');
console.log('  S.learn.signals > 2000 → slice(-1500) // empcalib 实测命中率样本');
console.log('  S.signals > 200 → pop                 // 信号回验');
console.log('  PUSH_LOG > 500 → length=500           // pushedToday「今天已发」证据');
console.log('  acc.trades > 300 → pop                // paperAudit 对账（依赖全流水）');
