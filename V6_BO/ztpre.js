// ─────────────────────────────────────────────────────────────────────────────
// 涨停前形态学习（2026-10-01 新增）
//
// 用户原话：「这一条是必须学习当日涨停的票涨停前都是什么走势，尽量分析涨停前走势、
//   量价、指标信号、大单情况、涨停逻辑，深刻学习并且融合到自己的系统里面，
//   每日扫一些这样的条件自主分析后续是否会涨停」。
// 另一句：「奥士康是底部 8月3日涨到现在，你从 27 号才开始确认」——
//   系统直到趋势走完一半才认出来，缺的正是**启动前的形态识别**。
//
// 与 learnall 的分工：
//   learnall = 通用「次日涨跌≥3% / 次日封板」的统计模型（17 维，当日截面特征）。
//   ztpre    = 专攻「涨停【之前】那一段」：连涨几天、量怎么放、KDJ/MACD 什么状态、
//              有没有平台整理、是不是刚突破 —— 用这些**前窗特征**预测次日会不会封板。
//   两个模型的结论会在 server 里融合，取长补短。
//
// 口径铁律：标签只看【次日是否真的封板】，用收盘后已知的次日 K 线判定（不是当日回验）。
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
// ⛔ 涨停判定必须走 analysis.js 的唯一入口（2026-10-06 修，重复实现分叉专项）。
//   ztpre 原本自带三份判定：labelOf 的 `pct >= 9.8`、ingestAll 的 `pct >= lim - 0.5`，
//   以及不传 limitOf 时又退回 9.8。9.8 是写死的主板口径 —— 20cm 票的涨停一条都学不到
//   （learnall v1 就死在这个坑上），而新股上市前 5 日无涨跌幅限制期更是完全绕过去了。
//   analysis.js 是纯函数模块，单向依赖不会成环。
const A = require('./analysis.js');

const VER = 1;
const DB_FILE = path.join(__dirname, 'ztpre.json');
// 命中口径：与全局一致，次日最高涨幅 ≥ HIT_THR 才算"涨到了"；封板另算
const HIT_THR = 3;

// ── 前窗特征维度（涨停【前】1~10 日的形态）──────────────────────────────────
// 每个维度都是"能讲人话"的形态描述，mineRules 挖出来的规律可以直接念给用户听。
const DIMS = [
  { key: 'run', name: '涨停前连涨天数', bins: [[-1e9, 0.5, '无连涨'], [0.5, 1.5, '连涨1天'], [1.5, 2.5, '连涨2天'], [2.5, 1e9, '连涨≥3天']] },
  { key: 'sum5', name: '前5日累计涨幅', bins: [[-1e9, -3, '回调'], [-3, 0, '横盘'], [0, 3, '小幅上行'], [3, 8, '稳步上行'], [8, 1e9, '快速拉升']] },
  { key: 'volR', name: '量能(5日/20日)', bins: [[-1e9, 0.7, '极度缩量'], [0.7, 0.9, '缩量'], [0.9, 1.1, '持平'], [1.1, 1.6, '温和放量'], [1.6, 1e9, '明显放量']] },
  { key: 'dd20', name: '距20日高回撤', bins: [[-1e9, 3, '贴20日高'], [3, 10, '回撤3~10%'], [10, 20, '回撤10~20%'], [20, 1e9, '回撤>20%']] },
  // ⚠️ 分箱边界必须用 ±0.5（整数分类码）而不是 0/1/2（2026-10-01 踩）：
  //    写 [-1e9,0) 的话，值 0 不满足 0<0 → 掉进下一档，于是 0 和 1 挤在同一档，
  //    「平台整理」「是否突破」两个维度 n 直接等于全库样本数（等于这一维完全没学）。
  { key: 'maBull', name: '均线排列', bins: [[-1e9, 0.5, '空头'], [0.5, 1.5, '部分多头'], [1.5, 1e9, '标准多头']] },
  { key: 'kdj', name: 'KDJ状态', bins: [[-1e9, 0.5, '空头区'], [0.5, 1.5, '金叉/多头区'], [1.5, 2.5, '多头区'], [2.5, 1e9, '超买区']] },
  { key: 'macd', name: 'MACD状态', bins: [[-1e9, 0.5, '水下走弱'], [0.5, 1.5, '水下金叉'], [1.5, 1e9, '零轴上方']] },
  { key: 'fx', name: '缠论分型', bins: [[-1e9, -0.5, '顶分型压制'], [-0.5, 0.5, '无明显分型'], [0.5, 1e9, '底分型支撑']] },
  { key: 'amp', name: '前5日振幅', bins: [[-1e9, 2, '极小振幅(平台)'], [2, 4, '小振幅'], [4, 7, '中振幅'], [7, 1e9, '大振幅']] },
  { key: 'cons', name: '平台整理', bins: [[-1e9, 0.5, '非整理'], [0.5, 1e9, '缩量横盘整理']] },
  { key: 'brk', name: '是否突破', bins: [[-1e9, 0.5, '未突破'], [0.5, 1e9, '刚突破20日高']] }
];
const DIM_KEYS = DIMS.map(d => d.key);

function binIdx(di, v) {
  const b = DIMS[di].bins;
  for (let i = 0; i < b.length; i++) if (v >= b[i][0] && v < b[i][1]) return i;
  return b.length - 1;
}
const binTxt = (di, i) => (DIMS[di].bins[i] ? DIMS[di].bins[i][2] : '?');

// ── 指标计算（本地实现，避免与 analysis.js 循环依赖；字段名多名字兼容）────────
const nN = (r, names) => { for (const n of names) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; };
function maN(rows, i, n) {
  let s = 0, c = 0;
  for (let j = i - n + 1; j <= i; j++) { if (j < 0) continue; s += nN(rows[j], ['close', 'c']); c++; }
  return c ? s / c : null;
}
function kdjAt(rows, i, n = 9) {
  if (i < n) return null;
  let k = 50, d = 50;
  for (let t = n - 1; t <= i; t++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = t - n + 1; j <= t; j++) {
      const h = nN(rows[j], ['high', 'h']), l = nN(rows[j], ['low', 'l']);
      if (h > 0 && h > hi) hi = h;
      if (l > 0 && l < lo) lo = l;
    }
    const c = nN(rows[t], ['close', 'c']);
    if (!(hi > lo) || !(c > 0)) continue;
    k = (2 / 3) * k + (1 / 3) * ((c - lo) / (hi - lo) * 100);
    d = (2 / 3) * d + (1 / 3) * k;
  }
  return { k, d, j: 3 * k - 2 * d };
}
function emaArr(arr, n) {
  const k = 2 / (n + 1); const out = []; let p = arr[0];
  out.push(p);
  for (let i = 1; i < arr.length; i++) { p = arr[i] * k + p * (1 - k); out.push(p); }
  return out;
}
function macdAt(rows, i) {
  const s = Math.max(0, i - 80);
  const closes = rows.slice(s, i + 1).map(r => nN(r, ['close', 'c']));
  if (closes.length < 35) return null;
  const ef = emaArr(closes, 12), es = emaArr(closes, 26);
  const dif = ef.map((v, x) => v - es[x]);
  const dea = emaArr(dif, 9);
  const n = dif.length - 1;
  return { dif: dif[n], dea: dea[n], gold: dif[n] > dea[n], above: dif[n] > 0 && dea[n] > 0 };
}
// 缠论分型：最近一个分型是顶还是底
function fxAt(rows, i) {
  if (i < 4) return 0;
  for (let t = i - 1; t >= Math.max(2, i - 20); t--) {
    const a = rows[t - 1], b = rows[t], c = rows[t + 1];
    if (!a || !b || !c) continue;
    const ah = nN(a, ['high', 'h']), bh = nN(b, ['high', 'h']), ch = nN(c, ['high', 'h']);
    const al = nN(a, ['low', 'l']), bl = nN(b, ['low', 'l']), cl = nN(c, ['low', 'l']);
    if (bh > ah && bh > ch) return -1;   // 顶分型
    if (bl < al && bl < cl) return 1;    // 底分型
  }
  return 0;
}

// ── 前窗特征提取：站在"今天收盘"看，明天会不会涨停 ─────────────────────────
// i = 当天（ closes[i] 已知，i+1 是明天）。特征全部只用 ≤ i 的数据，绝不偷看未来。
function extract(rows, i, opt = {}) {
  // ⚠️ 不能写 `i >= rows.length - 1`：那是为训练（需要 i+1 才能打标签）留的约束，
  //    但**每日实时扫描就是要算最后一根**，写成那样会让今天的数据永远算不出来
  //    （2026-10-01 踩：离线验证时 extract(rows, len-1) 直接返回 null）。
  //    标签的边界交给 labelOf 自己管，extract 只管"特征能不能算"。
  if (!rows || i < 30 || i >= rows.length) return null;
  const c = nN(rows[i], ['close', 'c']);
  if (!(c > 0)) return null;

  // 连涨天数（严格递增）
  let run = 0;
  for (let j = i; j >= 1; j--) {
    const a = nN(rows[j], ['close', 'c']), b = nN(rows[j - 1], ['close', 'c']);
    if (b > 0 && a > b) run++; else break;
  }
  // 前5日累计涨幅
  const c5 = nN(rows[Math.max(0, i - 5)], ['close', 'c']);
  const sum5 = c5 > 0 ? (c - c5) / c5 * 100 : 0;
  // 量能：近5日均量 / 近20日均量
  let v5 = 0, v20 = 0;
  for (let j = Math.max(0, i - 4); j <= i; j++) v5 += nN(rows[j], ['volume', 'vol', 'v']);
  for (let j = Math.max(0, i - 19); j <= i; j++) v20 += nN(rows[j], ['volume', 'vol', 'v']);
  const volR = v20 > 0 ? (v5 / 5) / (v20 / 20) : 1;
  // 距20日高点回撤
  let hi20 = 0;
  for (let j = Math.max(0, i - 19); j <= i; j++) { const h = nN(rows[j], ['high', 'h']); if (h > hi20) hi20 = h; }
  const dd20 = hi20 > 0 ? (hi20 - c) / hi20 * 100 : 0;
  // 均线排列
  const ma5 = maN(rows, i, 5), ma10 = maN(rows, i, 10), ma20 = maN(rows, i, 20);
  let maBull = 0;
  if (ma5 != null && ma10 != null && ma20 != null) {
    if (ma5 > ma10 && ma10 > ma20) maBull = 2;
    else if (ma5 > ma10 || ma10 > ma20) maBull = 1;
  }
  // KDJ
  let kdjS = 1, kdjK = null;
  const kd = kdjAt(rows, i);
  if (kd) {
    kdjK = kd.k;
    const prev = kdjAt(rows, i - 1);
    const justGold = prev && prev.k <= prev.d && kd.k > kd.d;
    if (justGold) kdjS = 1;                       // 刚金叉
    else if (kd.k > kd.d) kdjS = kd.k >= 80 ? 2 : 1;  // 多头（≥80 记超买，同档）
    else kdjS = 0;                                // 空头区
    if (kd.k >= 80 && kd.k > kd.d) kdjS = 2;
  }
  // MACD
  let macdS = 1;
  const mc = macdAt(rows, i);
  if (mc) macdS = mc.above ? (mc.gold ? 2 : 1) : (mc.gold ? 1 : 0);
  // 缠论分型：1=底分型支撑 0=无 -1=顶分型压制 → 映射到 bin（0=顶 1=无 2=底）
  const fxv = fxAt(rows, i);
  const fxBin = fxv > 0 ? 1 : (fxv < 0 ? -1 : 0);
  // 前5日振幅
  let amp = 0, cnt = 0;
  for (let j = Math.max(0, i - 4); j <= i; j++) {
    const h = nN(rows[j], ['high', 'h']), l = nN(rows[j], ['low', 'l']), cc = nN(rows[j], ['close', 'c']);
    if (cc > 0 && h >= l) { amp += (h - l) / cc * 100; cnt++; }
  }
  amp = cnt ? amp / cnt : 0;
  // 平台整理：小振幅 + 缩量 + 涨幅不大
  const cons = (amp <= 3 && volR <= 0.95 && Math.abs(sum5) <= 4) ? 1 : 0;
  // 刚突破20日高
  const brk = (hi20 > 0 && c >= hi20 * 0.995 && dd20 <= 1) ? 1 : 0;

  const f = { run, sum5, volR, dd20, maBull, kdj: kdjS, macd: macdS, fx: fxBin, amp, cons, brk, _kdjK: kdjK };
  f.keys = DIM_KEYS.map((k, di) => `S:${di}:${binIdx(di, f[k])}`);
  f.txt = DIM_KEYS.map((k, di) => `${DIMS[di].name}=${binTxt(di, binIdx(di, f[k]))}`);
  return f;
}

// ── 标签：次日是否封板 / 次日是否涨≥3%（只用 i+1 的真实数据）──────────────
function labelOf(rows, i, opt = {}) {
  const nx = rows[i + 1];
  if (!nx) return null;
  const c = nN(rows[i], ['close', 'c']);
  const hi = nN(nx, ['high', 'h']), pct = nN(nx, ['pct']);
  if (!(c > 0)) return null;
  const maxGain = hi > 0 ? (hi - c) / c * 100 : 0;
  // ⛔ 没有注入 isLimitUp 时也不能退回写死的 9.8（那是主板口径，会漏光 20cm/30cm 的涨停样本）：
  //   走唯一入口，按 code/name 自己判断板块限幅与新股无限制期。
  const zt = typeof opt.isLimitUp === 'function'
    ? opt.isLimitUp(pct)
    : A.isNearLimitUp(opt.code, opt.name, pct, 0.5);
  return { zt: !!zt, hit: maxGain >= HIT_THR, maxGain };
}

// ── 库 ───────────────────────────────────────────────────────────────────────
function newDb() {
  return { ver: VER, n: 0, zt: 0, hit: 0, stat: {}, rules: [], prog: {}, days: {}, updatedAt: 0, baseZt: 0, baseHit: 0 };
}
let _db = null;
function db() {
  if (_db) return _db;
  try {
    const txt = fs.readFileSync(DB_FILE, 'utf8');
    try {
      const j = JSON.parse(txt);
      if (j && j.ver === VER && j.stat) { _db = j; return _db; }
    } catch (e) {
      // 半截文件必须留档：直接 newDb() 等于把几十万条形态样本判死刑
      try {
        const bad = DB_FILE + '.corrupt-' + Date.now();
        fs.renameSync(DB_FILE, bad);
        console.error(`[ztpre] ⚠️ 形态库解析失败，坏文件已留档 ${bad} —— 样本未丢失，勿重建覆盖`);
      } catch {}
    }
  } catch { }
  _db = newDb();
  return _db;
}
function save() {
  const d = db();
  d.updatedAt = Date.now();
  // 原子写：写 .tmp 再 rename，避免进程被 kill 时留下半截 JSON
  const tmp = DB_FILE + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(d)); fs.renameSync(tmp, DB_FILE); }
  catch (e) { /* 只读环境不写 */ try { fs.unlinkSync(tmp); } catch {} }
}
function load() {
  _db = null;
  const d = db();
  if (!d.rules || !d.rules.length) { d.rules = mineRules(d); }
  return d;
}

// 入库：一只票一段 K 线。幂等靠 prog[code] 游标（已处理到的日期）
function ingest(rows, code, opt = {}) {
  const d = db();
  if (!rows || rows.length < 40) return { added: 0 };
  const from = d.prog[code] || 30;         // 前 30 根留作指标预热
  let added = 0;
  for (let i = Math.max(30, from); i < rows.length - 1; i++) {
    const f = extract(rows, i, opt);
    if (!f) continue;
    const lb = labelOf(rows, i, opt);
    if (!lb) continue;
    for (let di = 0; di < f.keys.length; di++) {
      let e = d.stat[f.keys[di]];
      if (!e) e = d.stat[f.keys[di]] = [0, 0, 0];
      e[0]++; if (lb.zt) e[1]++; if (lb.hit) e[2]++;
    }
    // 组合：两个维度同时命中时的统计（P:dA:bA:dB:bB）
    // ⚠️ 只存单维统计的话，「刚突破20日高」+「明显放量」这种真交互永远学不到 ——
    //    单看分别是 8.03% / 4.91%，两者同时满足实测 **19.07%**（10.9 倍基准），
    //    远超单因子叠加。2026-10-01 挖掘脚本验证后才补的这一层。
    for (let a = 0; a < f.keys.length; a++) {
      const ba = f.keys[a].split(':')[2];
      for (let b2 = a + 1; b2 < f.keys.length; b2++) {
        const bb = f.keys[b2].split(':')[2];
        const pk = `P:${a}:${ba}:${b2}:${bb}`;
        let e = d.stat[pk];
        if (!e) e = d.stat[pk] = [0, 0, 0];
        e[0]++; if (lb.zt) e[1]++; if (lb.hit) e[2]++;
      }
    }
    d.n++; if (lb.zt) d.zt++; if (lb.hit) d.hit++;
    const dt = String(rows[i].date || '').slice(0, 10);
    if (dt) d.days[dt] = (d.days[dt] || 0) + 1;
    added++;
  }
  d.prog[code] = Math.max(0, rows.length - 1);
  d.baseZt = d.n ? d.zt / d.n : 0;
  d.baseHit = d.n ? d.hit / d.n : 0;
  return { added, n: d.n, baseZt: d.baseZt };
}

// 批量入库
function ingestAll(rowsByCode, opt = {}) {
  const d = db();
  let added = 0, codes = 0;
  const names = opt.names || {};
  for (const code of Object.keys(rowsByCode)) {
    const rows = rowsByCode[code];
    try {
      // ⛔ 涨停判定统一走 A.isNearLimitUp（限幅规则 + 新股无涨跌幅限制期，全项目一份）。
      //   opt.limitOf 仍然收着，但只作为"外部想覆盖限幅"的钩子；不再拿它自己拼 `pct >= lim - 0.5`。
      //   opt.isLimitUp 保留可注入（测试要覆盖判定），注入时以注入为准。
      const nm = names[code] || '';
      const o = Object.assign({}, opt, {
        code, name: nm,
        isLimitUp: typeof opt.isLimitUp === 'function'
          ? opt.isLimitUp
          : (pct => A.isNearLimitUp(code, nm, pct, 0.5))
      });
      const r = ingest(rows, code, o);
      added += r.added; codes++;
    } catch { }
  }
  d.rules = mineRules(d);
  save();
  return { ok: true, added, codes, n: d.n, baseZt: d.baseZt, baseHit: d.baseHit, rules: d.rules.length };
}

// 挖规律：哪些单维度档位的"次日封板率"显著高于基准
function mineRules(d, opt = {}) {
  const minN = opt.minN || 60;
  const out = [];
  for (const k of Object.keys(d.stat || {})) {
    const e = d.stat[k];
    if (!e) continue;
    const isPair = k.charAt(0) === 'P';
    if (e[0] < (isPair ? (opt.pairMinN || 200) : minN)) continue;
    const rate = e[1] / e[0] * 100;
    const base = (d.baseZt || 0) * 100;
    if (rate <= base) continue;
    const hitRate = +(e[2] / e[0] * 100).toFixed(2);
    const common = { key: k, n: e[0], rate: +rate.toFixed(2), hitRate, lift: +(rate - base).toFixed(2) };
    if (!isPair) {
      const m = /^S:(\d+):(\d+)$/.exec(k);
      if (!m) continue;
      const di = +m[1], bi = +m[2];
      out.push(Object.assign({}, common, {
        dim: DIMS[di] ? DIMS[di].key : '?', name: DIMS[di] ? DIMS[di].name : '?', bin: binTxt(di, bi)
      }));
    } else {
      const m = /^P:(\d+):(\d+):(\d+):(\d+)$/.exec(k);
      if (!m) continue;
      const da = +m[1], ba = +m[2], db2 = +m[3], bb = +m[4];
      out.push(Object.assign({}, common, {
        dim: 'pair', name: `${DIMS[da] ? DIMS[da].name : '?'}×${DIMS[db2] ? DIMS[db2].name : '?'}`,
        bin: `${binTxt(da, ba)} × ${binTxt(db2, bb)}`
      }));
    }
  }
  // ⚠️ 单维和组合分开给名额：不分开的话组合（lift 天然更大）会把单维挤到只剩 1 条。
  const singles = out.filter(r => r.key.charAt(0) === 'S').sort((a, b) => b.lift - a.lift).slice(0, 20);
  const pairs = out.filter(r => r.key.charAt(0) === 'P').sort((a, b) => b.lift - a.lift).slice(0, 20);
  return singles.concat(pairs);
}

// ── 得分与标定 ───────────────────────────────────────────────────────────────
// ⚠️ 老写法把 11 个维度的对数几率**取加权平均**再叠到基准上 —— 等于假设"平均强度"
//    代表整体，结果强信号被 11 个维度摊薄：实测「刚突破+明显放量」真实封板 19.07%，
//    模型只报 3.1%（低估 6.2 倍）。改成：各维度证据**求和**，再用离线拟合出来的
//    标定系数 (c, lam) 修正 —— 相关性导致求和后会高估，这个系数就是收缩因子。
const _lg = p => Math.log(p / (1 - p));
const _cp = p => Math.max(0.001, Math.min(0.999, p));

function scoreOf(f, d) {
  const b0 = _cp(d.baseZt || 0.01);
  const baseLogit = _lg(b0);
  let s = 0, wsum = 0;
  const used = [];
  for (let di = 0; di < DIM_KEYS.length; di++) {
    const e = d.stat[f.keys[di]];
    if (!e || e[0] < 30) continue;
    const p = _cp(e[1] / e[0]);
    const w = Math.min(1, e[0] / 400);          // 样本量权重
    s += w * (_lg(p) - baseLogit);
    wsum += w;
    used.push({ name: DIMS[di].name, bin: binTxt(di, +String(f.keys[di]).split(':')[2]), n: e[0], rate: +(e[1] / e[0] * 100).toFixed(1) });
  }
  return { s, wsum, baseLogit, used };
}

// 预测：给定前窗特征 → 次日封板概率（%），并给出命中的规律说明
function predict(f, d) {
  if (!f || !d || !d.n) return null;
  const b0 = _cp(d.baseZt || 0.01);
  const base = (d.baseZt || 0) * 100;
  const sc = scoreOf(f, d);
  const cal = (d.calib && typeof d.calib.lam === 'number') ? d.calib : null;
  let logit;
  if (cal) {
    logit = cal.c + cal.lam * sc.s;
    // 组合修正：命中的强交互再叠一层（coef 由离线拟合给出）
    for (const pf of (cal.pairs || [])) {
      if (f.keys[pf.a] === `S:${pf.a}:${pf.ba}` && f.keys[pf.b] === `S:${pf.b}:${pf.bb}`) logit += pf.coef;
    }
  } else {
    // 无标定库（旧版本）时的退化行为：保持原来的"平均 + 基准"
    logit = sc.baseLogit + (sc.wsum ? sc.s / sc.wsum : 0);
  }
  let p = 1 / (1 + Math.exp(-logit)) * 100;
  p = Math.max(0.2, Math.min(95, p));
  const used = sc.used.slice().sort((a, b) => b.rate - a.rate);
  // 命中的组合也放进理由里：这是用户要的"为什么看好它"
  const hitPairs = [];
  if (cal) for (const pf of (cal.pairs || [])) {
    if (f.keys[pf.a] === `S:${pf.a}:${pf.ba}` && f.keys[pf.b] === `S:${pf.b}:${pf.bb}` && pf.coef > 0) {
      hitPairs.push({ name: pf.name, bin: pf.bin, n: pf.n, rate: pf.rate });
    }
  }
  return {
    p: +p.toFixed(1), base: +base.toFixed(2), lift: +(p - base).toFixed(2),
    why: hitPairs.concat(used).slice(0, 3), pairs: hitPairs, n: d.n
  };
}

// 给一句话解释（推送文案用）
function whyText(pred, f) {
  if (!pred) return '';
  const bits = (pred.why || []).map(w => `${w.name}=${w.bin}（历史${w.n}例，次日封板${w.rate}%）`);
  return bits.length ? bits.join('、') : '';
}

module.exports = {
  VER, DIMS, HIT_THR, extract, labelOf, ingest, ingestAll, mineRules, predict, whyText,
  scoreOf, db, load, save, newDb
};
