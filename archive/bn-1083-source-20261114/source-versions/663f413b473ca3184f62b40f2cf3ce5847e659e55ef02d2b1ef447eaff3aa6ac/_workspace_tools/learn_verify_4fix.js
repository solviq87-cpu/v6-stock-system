// 只读验证：2026-10-28 学习闭环四修的真实数据效果（不改仓库任何文件）
const fs = require('fs');
const P = 'C:/Users/28957/WorkBuddy/2026-09-25-13-40-58/stock-dashboard/stats.json';
const L = JSON.parse(fs.readFileSync(P, 'utf8'));
const sigs = L.signals || [];

const POST = new Set(['zt', 'review']);
const isBT = s => !!(s && s.resolved && s.resolved.mode === '历史回测');
const isPH = s => { if (!s || isBT(s)) return false; return POST.has(s.type) || !!(s.resolved && s.resolved.limitUp && +(s.resolved.maxGain || 0) <= 0.5); };
const isLive = s => !isBT(s) && !isPH(s);
const hitOf = s => s.type === 'auczt' ? !!(s.resolved && s.resolved.limitUp) : !!(s.nd && s.nd.hit);
const limOf = c => { c = String(c || ''); if (c.startsWith('30') || c.startsWith('68')) return 20; if (c.startsWith('8') || c.startsWith('4') || c.startsWith('92')) return 30; return 10; };

const all = sigs.filter(s => s.resolved && !s.void);
const liveAll = all.filter(isLive);
const hasOutcome = s => s.type === 'auczt' ? !!s.resolved : !!s.nd;
const live = liveAll.filter(hasOutcome);

console.log('===== P1：未回验样本不再进分母 =====');
const nO = liveAll.length, rO = liveAll.filter(hitOf).length;
const nN = live.length, rN = live.filter(hitOf).length;
console.log(`改前：${rO}/${nO} = ${(rO / nO * 100).toFixed(1)}%   ← 未回验样本按 0 命中入分母`);
console.log(`改后：${rN}/${nN} = ${(rN / nN * 100).toFixed(1)}%   ← 只算真已有次日结论的`);
console.log(`剔除待回验：${nO - nN} 条（写进 S.learn.pendingVerify）`);

const bk = p => p >= 90 ? '90+' : p >= 85 ? '85-89' : p >= 80 ? '80-84' : p >= 70 ? '70-79' : '<70';
const EXP = { '90+': 93, '85-89': 87, '80-84': 82, '70-79': 72, '<70': 60 };
function bucketsOf(arr) {
  const b = {};
  for (const s of arr) {
    if (s.prob == null) continue;
    if (s.type === 'auczt') continue;
    const k = bk(s.prob);
    (b[k] = b[k] || { n: 0, h: 0 });
    b[k].n++; if (hitOf(s)) b[k].h++;
  }
  return b;
}
const bO = bucketsOf(liveAll), bN = bucketsOf(live);
console.log('\n分桶（rate 改前→改后，corr 会跟着变）:');
for (const k of Object.keys(EXP)) {
  const o = bO[k], n = bN[k];
  if (!o && !n) continue;
  const ro = o ? Math.round(o.h / o.n * 100) : null;
  const rn = n ? Math.round(n.h / n.n * 100) : null;
  const gO = ro == null ? '-' : (EXP[k] - ro) + 'pp 缺口';
  const gN = rn == null ? '-' : (EXP[k] - rn) + 'pp 缺口';
  console.log(`  ${k.padEnd(6)} n ${String(o ? o.n : 0).padStart(4)}→${String(n ? n.n : 0).padStart(4)}   ${String(ro).padStart(3)}%→${String(rn).padStart(3)}%   ${gO} → ${gN}`);
}

console.log('\n===== P3：跌停按实际限幅判 =====');
let dtO = 0, dtN = 0; const mis = [];
for (const s of sigs) {
  if (!s.nd || s.void) continue;
  const p = s.nd.nextPct; if (p == null) continue;
  if (p <= -9.5) {
    dtO++;
    const lim = limOf(s.code);
    if (p <= -(lim - 0.5)) dtN++; else mis.push(`${s.code} ${s.name || ''} ${p}%（限幅${lim}%，跌停线${-(lim - 0.5)}%）`);
  }
}
console.log(`改前：${dtO} 条被记为跌停   改后：${dtN} 条   剔除误判：${dtO - dtN} 条`);
mis.slice(0, 8).forEach(x => console.log('   ⚠️ 原来是误判 → ' + x));

console.log('\n===== P4：趋势策略行（原来读死字段）=====');
const tr = sigs.filter(s => (s.type === 'trend' || s.type === 'trendsig') && s.nd && !s.void && isLive(s));
console.log(`S.learn.trend 字段：${L.trend ? '存在' : '❌ 不存在（全项目无人写入 → 那一行从来没出现过）'}`);
console.log(`现在可统计趋势样本：${tr.length} 条`);
if (tr.length) {
  const lu = tr.filter(s => s.nd.limitUp).length, h = tr.filter(s => s.nd.hit).length;
  const days = new Set(tr.map(s => String(s.date).replace(/[^0-9]/g, ''))).size;
  console.log(`  → 涨停率 ${Math.round(lu / tr.length * 100)}% · 命中率 ${Math.round(h / tr.length * 100)}% · 跨 ${days} 日 ${tr.length >= 5 ? '（≥5，日报会显示这一行）' : '（<5，仍不显示：样本不足不硬判）'}`);
}

console.log('\n===== P2：剪枝上限（当前库规模）=====');
console.log(`signals 总数 ${sigs.length}（pruneSignals 上限 2600；旧写法 slice(-1500) 一旦触发就是 ${sigs.length} → 1500，−${Math.round((1 - 1500 / sigs.length) * 100)}%）`);
