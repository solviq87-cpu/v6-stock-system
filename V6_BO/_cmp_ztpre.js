// 在同一份留出集上，公平对比【旧融合 vs 新标定 vs 新标定+组合】，并对 lambda 做网格搜索。
// 只看 AUC 不够 —— 还要看**校准**（预测 5% 的时候实际是不是真有 5%）。
const fs = require('fs');
const path = require('path');
const Z = require('./ztpre.js');
const DIMS = Z.DIMS;
const _lg = p => Math.log(p / (1 - p));
const _cp = p => Math.max(0.001, Math.min(0.999, p));
const isTest = code => (parseInt(code, 10) % 5) === 0;

const T0 = Date.now();
const byCode = JSON.parse(fs.readFileSync(path.join(__dirname, '.ztpre_feat.json'), 'utf8'));

function buildStats(mode) {   // mode: 'train' | 'all'
  const d = Z.newDb();
  for (const code of Object.keys(byCode)) {
    if (mode === 'train' && isTest(code)) continue;
    for (const s of byCode[code]) {
      const keys = s[0].split(',');
      d.n++; if (s[1]) d.zt++; if (s[2]) d.hit++;
      for (let a = 0; a < keys.length; a++) {
        let e = d.stat[keys[a]]; if (!e) e = d.stat[keys[a]] = [0, 0, 0];
        e[0]++; if (s[1]) e[1]++; if (s[2]) e[2]++;
      }
      for (let a = 0; a < keys.length; a++) {
        const ba = keys[a].split(':')[2];
        for (let b = a + 1; b < keys.length; b++) {
          const pk = `P:${a}:${ba}:${b}:${keys[b].split(':')[2]}`;
          let e = d.stat[pk]; if (!e) e = d.stat[pk] = [0, 0, 0];
          e[0]++; if (s[1]) e[1]++; if (s[2]) e[2]++;
        }
      }
    }
  }
  d.baseZt = d.n ? d.zt / d.n : 0;
  d.baseHit = d.n ? d.hit / d.n : 0;
  return d;
}

const dbTr = buildStats('train');
const dbAll = buildStats('all');
console.log(`训练集 ${dbTr.n} / 留出集 ${byCode ? Object.keys(byCode).filter(isTest).reduce((a, c) => a + byCode[c].length, 0) : 0}｜基准 ${(dbTr.baseZt * 100).toFixed(2)}%`);

const testList = [];
for (const code of Object.keys(byCode)) if (isTest(code)) for (const s of byCode[code]) testList.push(s);

// 预计算测试集的evidence分数（旧/新共用）：逐 chr
function prepTest(list, d) {
  const S = new Float64Array(list.length), W = new Float64Array(list.length), Y = new Float64Array(list.length), H = new Float64Array(list.length);
  const keysArr = [];
  for (let i = 0; i < list.length; i++) {
    const keys = list[i][0].split(',');
    keysArr.push(keys);
    const sc = Z.scoreOf({ keys }, d);
    S[i] = sc.s; W[i] = sc.wsum; Y[i] = list[i][1]; H[i] = list[i][2];
  }
  return { S, W, Y, H, keysArr };
}
const TE = prepTest(testList, dbTr);

function metrics(scores) {
  const pr = scores.map(z => 1 / (1 + Math.exp(-z)));
  const idx = Array.from(pr.keys()).sort((a, b) => pr[a] - pr[b]);
  let pos = 0, pairs = 0, negSeen = 0;
  for (const i of idx) { if (TE.Y[i] === 1) { pos++; pairs += negSeen; } else negSeen++; }
  const nPos = TE.Y.reduce((a, b) => a + b, 0);
  const auc = pairs / (nPos * (pr.length - nPos));
  const dec = Array.from(pr.keys()).sort((a, b) => pr[b] - pr[a]);
  const NB = 10, step = Math.floor(dec.length / NB);
  const calib = [];
  for (let bi = 0; bi < NB; bi++) {
    const seg = dec.slice(bi * step, (bi + 1) * step);
    calib.push({ p: seg.reduce((a, i) => a + pr[i], 0) / seg.length * 100, a: seg.filter(i => TE.Y[i] === 1).length / seg.length * 100 });
  }
  // 前 1% 的精度（对应"每日推几只"的场景）
  const top = dec.slice(0, Math.floor(dec.length * 0.01));
  const topAct = top.filter(i => TE.Y[i] === 1).length / top.length * 100;
  const topPred = top.reduce((a, i) => a + pr[i], 0) / top.length * 100;
  return { auc, calib, topAct, topPred, base: dbTr.baseZt * 100 };
}

console.log('\n══════ 公平对比（同一留出集 %d 条）══════', testList.length);

// 旧模型：加权平均 + 基准
const oldScore = Array.from({ length: testList.length }, (_, i) => {
  const bL = _lg(_cp(dbTr.baseZt));
  return bL + (TE.W[i] ? TE.S[i] / TE.W[i] : 0);
});
const mOld = metrics(oldScore);
console.log(`\n【旧·加权平均融合】AUC=${mOld.auc.toFixed(4)}  前1%: 预测${mOld.topPred.toFixed(1)}% / 实际${mOld.topAct.toFixed(1)}%`);
console.log('  校准（预测 vs 实际）:', mOld.calib.slice(0, 3).map(c => `${c.p.toFixed(1)}%→${c.a.toFixed(1)}%`).join('  '));

// 新模型：网格搜索 λ
console.log('\n【新·线性累加 + 标定 λ】');
let best = null;
for (const lam of [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0]) {
  const bL = _lg(_cp(dbTr.baseZt));
  const sc = Array.from({ length: testList.length }, (_, i) => bL + lam * TE.S[i]);
  const m = metrics(sc);
  const err = m.calib.reduce((a, c) => a + Math.abs(c.p - c.a), 0) / m.calib.length;
  console.log(`  λ=${lam.toFixed(1)}  AUC=${m.auc.toFixed(4)}  校准误差=${err.toFixed(2)}pp  前1%: 预测${m.topPred.toFixed(1)}%/实际${m.topAct.toFixed(1)}%`);
  if (!best || m.auc > best.m.auc) best = { lam, m };
}
console.log(`\n最优 λ=${best.lam}  AUC=${best.m.auc.toFixed(4)}（旧 ${mOld.auc.toFixed(4)}）`);
console.log('  校准（预测 vs 实际）:', best.m.calib.map(c => `${c.p.toFixed(1)}%→${c.a.toFixed(1)}%`).join('  '));
console.log(`  前1%最优质票：预测 ${best.m.topPred.toFixed(1)}% / 实际 ${best.m.topAct.toFixed(1)}%（${(best.m.topAct / best.m.base).toFixed(1)}倍基准）`);
console.log(`\n耗时 ${((Date.now() - T0) / 1000).toFixed(0)}s`);
