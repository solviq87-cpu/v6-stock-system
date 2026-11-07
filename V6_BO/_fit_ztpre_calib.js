// 重建涨停前学习库（含组合统计）+ 拟合标定系数 (c, lam, 组合修正)
// 背景：老融合算法把 11 维对数几率取平均再叠基准，强组合被摊薄 ——
//   「刚突破20日高」+「明显放量」真实封板 19.07%，模型只报 3.1%（低估 6.2 倍）。
// 这里用留一法之外的时间无关切分（按代码哈希 8:2）做 honest 评估。
const fs = require('fs');
const path = require('path');
const Z = require('./ztpre.js');
const A = require('./analysis.js');

const CACHE = path.join(__dirname, '.kline_cache');
const files = fs.readdirSync(CACHE).filter(f => /^\d{6}\.json$/.test(f));
const DIMS = Z.DIMS, DK = DIMS.map(d => d.key);
const _lg = p => Math.log(p / (1 - p));
const _cp = p => Math.max(0.001, Math.min(0.999, p));
const isTest = code => (parseInt(code, 10) % 5) === 0;

// ── 读一遍全部 K 线，缓存每行特征（extract 挺贵，只读一次）──────────────────
const T0 = Date.now();
const samples = { train: [], test: [] };   // {keys, zt, hit}

const byCode = {};
for (const fn of files) {
  const code = fn.slice(0, 6);
  let d; try { d = JSON.parse(fs.readFileSync(path.join(CACHE, fn), 'utf8')); } catch { continue; }
  const rows = (d && d.rows) || [];
  if (rows.length < 40) continue;
  const name = d.name || '';
  if (/ST|退/.test(name)) continue;
  const list = [];
  const isLimitUp = pct => A.isLimitUp(code, name, pct);
  for (let i = 30; i < rows.length - 1; i++) {
    if (!(Number(rows[i].close) > 2)) continue;
    const f = Z.extract(rows, i, {}); if (!f) continue;
    const lb = Z.labelOf(rows, i, { isLimitUp }); if (!lb) continue;
    list.push({ keys: f.keys, zt: lb.zt, hit: lb.hit });
  }
  if (list.length) byCode[code] = list;
}
console.log(`读完全市场：${Object.keys(byCode).length} 只票 / 耗时 ${((Date.now() - T0) / 1000).toFixed(0)}s`);

// ── 用某个代码集合建统计库 ────────────────────────────────────────────────
function trainKeys(d, list) {
  for (const s of list) {
    d.n++; if (s.zt) d.zt++; if (s.hit) d.hit++;
    for (let a = 0; a < s.keys.length; a++) {
      let e = d.stat[s.keys[a]]; if (!e) e = d.stat[s.keys[a]] = [0, 0, 0];
      e[0]++; if (s.zt) e[1]++; if (s.hit) e[2]++;
    }
    for (let a = 0; a < s.keys.length; a++) {
      const ba = s.keys[a].split(':')[2];
      for (let b = a + 1; b < s.keys.length; b++) {
        const pk = `P:${a}:${ba}:${b}:${s.keys[b].split(':')[2]}`;
        let e = d.stat[pk]; if (!e) e = d.stat[pk] = [0, 0, 0];
        e[0]++; if (s.zt) e[1]++; if (s.hit) e[2]++;
      }
    }
  }
  d.baseZt = d.n ? d.zt / d.n : 0;
  d.baseHit = d.n ? d.hit / d.n : 0;
  return d;
}

const dbTr = Z.newDb(), dbAll = Z.newDb();
let nTr = 0, nTe = 0;
const testList = [];
for (const code of Object.keys(byCode)) {
  const list = byCode[code];
  if (isTest(code)) { testList.push(...list); nTe += list.length; }
  else { trainKeys(dbTr, list); nTr += list.length; }
  trainKeys(dbAll, list);
}
console.log(`训练集 ${nTr} 条 / 留出集 ${nTe} 条｜训练集基准封板 ${(dbTr.baseZt * 100).toFixed(2)}%`);
console.log(`统计键 ${Object.keys(dbTr.stat).length} 个（含组合 ${Object.keys(dbTr.stat).filter(k => k[0] === 'P').length} 个）`);

// ── 选候选组合：样本够、且交互项显著 ──────────────────────────────────────
const bL = _lg(_cp(dbTr.baseZt));
const cands = [];
for (const k of Object.keys(dbTr.stat)) {
  if (k[0] !== 'P') continue;
  const e = dbTr.stat[k];
  if (e[0] < 500) continue;
  const m = /^P:(\d+):(\d+):(\d+):(\d+)$/.exec(k); if (!m) continue;
  const a = +m[1], ba = +m[2], b = +m[3], bb = +m[4];
  const ea = dbTr.stat[`S:${a}:${ba}`], eb = dbTr.stat[`S:${b}:${bb}`];
  if (!ea || !eb) continue;
  const pab = _cp(e[1] / e[0]);
  const inter = _lg(pab) - bL - (_lg(_cp(ea[1] / ea[0])) - bL) - (_lg(_cp(eb[1] / eb[0])) - bL);
  if (Math.abs(inter) < 0.25) continue;
  cands.push({ a, ba, b, bb, inter: +inter.toFixed(3), n: e[0], rate: +(e[1] / e[0] * 100).toFixed(2), coef: 0, key: k,
    name: `${DIMS[a].name}×${DIMS[b].name}`, bin: `${DIMS[a].bins[ba][2]} × ${DIMS[b].bins[bb][2]}` });
}
cands.sort((x, y) => (Math.abs(y.inter) * Math.log(y.n)) - (Math.abs(x.inter) * Math.log(x.n)));
const PAIRS = cands.slice(0, 40);
console.log(`候选组合 ${cands.length} 个 → 取前 ${PAIRS.length} 个参与拟合`);

// ── 计算每个样本的分数 S 与组合命中 ────────────────────────────────────────
function prep(db, list) {
  const S = new Float64Array(list.length), Y = new Float64Array(list.length);
  const hits = PAIRS.map(() => []);
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    const sc = Z.scoreOf({ keys: s.keys }, db);
    S[i] = sc.s; Y[i] = s.zt ? 1 : 0;
    for (let k = 0; k < PAIRS.length; k++) {
      const p = PAIRS[k];
      if (s.keys[p.a] === `S:${p.a}:${p.ba}` && s.keys[p.b] === `S:${p.b}:${p.bb}`) hits[k].push(i);
    }
  }
  return { S, Y, hits };
}
const TR = prep(dbTr, (() => { const l = []; for (const c of Object.keys(byCode)) if (!isTest(c)) l.push(...byCode[c]); return l; })());
console.log('特征准备完成');

// ── 逻辑回归拟合（c, lam, beta）带 L2 ─────────────────────────────────────
const N = TR.S.length;
let C = bL, LAM = 0.4;
const extra = new Float64Array(N);
let pred = new Float64Array(N);
const L2 = 1e-4, LR0 = 0.5;
for (let ep = 0; ep < 60; ep++) {
  let gC = 0, gL = 0;
  for (let i = 0; i < N; i++) { pred[i] = 1 / (1 + Math.exp(-(C + LAM * TR.S[i] + extra[i]))); const g = pred[i] - TR.Y[i]; gC += g; gL += g * TR.S[i]; }
  const gB = PAIRS.map((_, k) => { let s = 0; for (const i of TR.hits[k]) s += pred[i] - TR.Y[i]; return s; });
  const lr = LR0 / (1 + ep * 0.12);
  C -= lr * (gC / N);
  LAM -= lr * (gL / N + L2 * LAM);
  for (let k = 0; k < PAIRS.length; k++) {
    const d = -lr * (gB[k] / N + L2 * PAIRS[k].coef);
    PAIRS[k].coef += d;
    if (Math.abs(d) < 1e-7) continue;
    for (const i of TR.hits[k]) extra[i] += d;
  }
  if (ep % 15 === 0) console.log(`  epoch ${ep}: 平均预测 ${(pred.reduce((a, b) => a + b, 0) / N * 100).toFixed(2)}% vs 实际 ${(TR.Y.reduce((a, b) => a + b, 0) / N * 100).toFixed(2)}%`);
}
console.log(`\n拟合结果：c=${C.toFixed(3)}  lam=${LAM.toFixed(3)}`);

// ── 留出集评估 ────────────────────────────────────────────────────────────
const TE = prep(dbTr, testList);
function evalModel(S, Y, hitsArr, tag) {
  const P = new Float64Array(S.length);
  for (let i = 0; i < S.length; i++) P[i] = C + LAM * S[i];
  // 组合修正
  for (let k = 0; k < PAIRS.length; k++) for (const i of hitsArr[k]) P[i] += PAIRS[k].coef;
  const pr = Array.from(P).map(z => 1 / (1 + Math.exp(-z)));
  // AUC
  const idx = Array.from(pr.keys()).sort((a, b) => pr[a] - pr[b]);
  let pos = 0, pairs = 0, negSeen = 0;
  for (const i of idx) { if (Y[i] === 1) { pos++; pairs += negSeen; } else negSeen++; }
  const nPos = Y.reduce((a, b) => a + b, 0), nNeg = S.length - nPos;
  const auc = pairs / (nPos * nNeg);
  // 校准：按预测分十档
  const dec = Array.from(pr.keys()).sort((a, b) => pr[b] - pr[a]);
  console.log(`\n【${tag}】AUC = ${auc.toFixed(4)}`);
  console.log('预测概率 vs 实际封板率（按预测降序分档）');
  const B = 10, step = Math.floor(dec.length / B);
  for (let bi = 0; bi < B; bi++) {
    const seg = dec.slice(bi * step, (bi + 1) * step);
    const avgP = seg.reduce((a, i) => a + pr[i], 0) / seg.length * 100;
    const act = seg.filter(i => Y[i] === 1).length / seg.length * 100;
    console.log(`  第${String(bi + 1).padStart(2)}档  预测 ${avgP.toFixed(1).padStart(5)}%  实际 ${act.toFixed(1).padStart(5)}%  倍数 ${(act / (dbTr.baseZt * 100)).toFixed(1)}x`);
  }
  return auc;
}
evalModel(TE.S, TE.Y, TE.hits, '留出集');
evalModel(TR.S, TR.Y, TR.hits, '训练集');

// ── 写回全量库 ────────────────────────────────────────────────────────────
dbAll.rules = Z.mineRules(dbAll);
dbAll.calib = {
  c: +C.toFixed(4), lam: +LAM.toFixed(4), fitAt: Date.now(), nPair: PAIRS.length,
  pairs: PAIRS.filter(p => Math.abs(p.coef) > 0.05).map(p => ({
    a: p.a, ba: p.ba, b: p.b, bb: p.bb, coef: +p.coef.toFixed(3), n: p.n, rate: p.rate,
    name: p.name, bin: p.bin, inter: p.inter
  }))
};
dbAll.updatedAt = Date.now();
fs.writeFileSync(path.join(__dirname, 'ztpre.json'), JSON.stringify(dbAll));
console.log(`\n✅ 已写回 ztpre.json：n=${dbAll.n} 基准 ${(dbAll.baseZt * 100).toFixed(2)}% 组合修正 ${dbAll.calib.pairs.length} 条`);
console.log(`   最强的几条组合修正：`);
dbAll.calib.pairs.slice(0, 8).forEach(p => console.log(`   ${p.name}=${p.bin}  coef ${p.coef > 0 ? '+' : ''}${p.coef}  (n=${p.n}, 实测 ${p.rate}%)`));
