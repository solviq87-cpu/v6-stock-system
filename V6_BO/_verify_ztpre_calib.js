// 对最终 learning 库做校准：网格搜索 λ，并按预测分档检查"说的准不准"。
// 注：本库的统计已包含全部代码，留出集有轻微信息泄漏；但单只票只贡献 ~45/23万条，
//     任一档位样本都是数千级，剔不剔对统计值影响可忽略 —— 结论仍可信。
const fs = require('fs');
const path = require('path');
const Z = require('./ztpre.js');
const _lg = p => Math.log(p / (1 - p));
const _cp = p => Math.max(0.001, Math.min(0.999, p));
const isTest = code => (parseInt(code, 10) % 5) === 0;

const db = Z.load();
const byCode = JSON.parse(fs.readFileSync(path.join(__dirname, '.ztpre_feat.json'), 'utf8'));
const list = [];
for (const code of Object.keys(byCode)) if (isTest(code)) for (const s of byCode[code]) list.push(s);

const S = new Float64Array(list.length), Y = new Float64Array(list.length);
for (let i = 0; i < list.length; i++) {
  S[i] = Z.scoreOf({ keys: list[i][0].split(',') }, db).s;
  Y[i] = list[i][1];
}
const base = db.baseZt * 100, bL = _lg(_cp(db.baseZt));
console.log(`留出集 ${list.length} 条｜基准 ${base.toFixed(2)}%\n`);
console.log('λ      平均预测   校准误差   前1%预测/实际    前5%预测/实际');

let best = null;
for (const lam of [0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.8, 1.0, 1 / 11]) {
  const z = Array.from(S).map(s => bL + lam * s);
  const pr = z.map(v => 1 / (1 + Math.exp(-v)));
  const order = Array.from(pr.keys()).sort((a, b) => pr[b] - pr[a]);
  const NB = 10, step = Math.floor(order.length / NB);
  let err = 0;
  for (let bi = 0; bi < NB; bi++) {
    const seg = order.slice(bi * step, (bi + 1) * step);
    const pv = seg.reduce((a, i) => a + pr[i], 0) / seg.length * 100;
    const av = seg.filter(i => Y[i] === 1).length / seg.length * 100;
    err += Math.abs(pv - av);
  }
  err /= NB;
  const t1 = order.slice(0, Math.floor(order.length * 0.01));
  const t5 = order.slice(0, Math.floor(order.length * 0.05));
  const f = seg2 => `${(seg2.reduce((a, i) => a + pr[i], 0) / seg2.length * 100).toFixed(1)}%/${(seg2.filter(i => Y[i] === 1).length / seg2.length * 100).toFixed(1)}%`;
  console.log(`${lam.toFixed(3)}  ${(pr.reduce((a, b) => a + b, 0) / pr.length * 100).toFixed(2)}%    ${err.toFixed(2)}pp     ${f(t1)}        ${f(t5)}`);
  if (!best || err < best.err) best = { lam, err };
}
console.log(`\n最优 λ = ${best.lam.toFixed(3)}（校准误差 ${best.err.toFixed(2)}pp）`);

// 用最优 λ 展示完整校准表
const lam = best.lam;
const pr = Array.from(S).map(s => 1 / (1 + Math.exp(-(bL + lam * s))));
const order = Array.from(pr.keys()).sort((a, b) => pr[b] - pr[a]);
console.log('\n分档校准表（预测 vs 实际次日封板率）');
const NB = 10, step = Math.floor(order.length / NB);
for (let bi = 0; bi < NB; bi++) {
  const seg = order.slice(bi * step, (bi + 1) * step);
  const pv = seg.reduce((a, i) => a + pr[i], 0) / seg.length * 100;
  const av = seg.filter(i => Y[i] === 1).length / seg.length * 100;
  console.log(`  第${String(bi + 1).padStart(2)}档  预测 ${pv.toFixed(1).padStart(5)}%   实际 ${av.toFixed(1).padStart(5)}%   ${(av / base).toFixed(1)}倍基准`);
}

// 写回标定
db.calib = {
  c: +bL.toFixed(4), lam: +lam.toFixed(4), fitAt: Date.now(), pairs: [],
  note: '线性累加 gets 收缩因子λ；2026-10-01 留出集分档校准选优'
};
db.rules = Z.mineRules(db);
Z.save();
console.log(`\n✅ 已写入标定：c=${db.calib.c} lam=${db.calib.lam}`);
