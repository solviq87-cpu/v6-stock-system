'use strict';
// 涨停数据源质量抽查（G1 · 2026-10-17）
//
// 为什么需要它：涨停池 S.ztPool 是复盘首行（涨停几只/连板梯队/最高板/主线/封单最强）、
// 一进二/二进三/三进四、板块强度、题材归类等一整片模块的唯一输入。数据源出过一次事：
// 2026-09 实测「35 只只统计到 33 只」（漏票），当时靠人肉比对才发现。本脚本把这类抽查
// 固化成机制：用【本地 K 线缓存】当独立第二把尺子，交叉验证涨停池——
//   ① 池说涨停、K 线不认（fakeZT）        → 数据源错票/字段漂移，fail
//   ② K 线封板、池里没有（missed）       → 漏票（#41 同形态），warn；严口径=收盘贴住涨停价
//      （触板未封板 nearMiss、收盘超按名限幅 aboveLimit=摘帽/更名，单列不计漏票）
//   ③ 结构体检：重码 / 缺字段 / 源混杂     → warn
//   ④ 池 pct 与 K 线 pct 偏差（pctDiff）   → 观察项（盘中拉的池与收盘 K 线本就可能不同）
//   ⑤ 快照过旧 / 交叉验证覆盖率过低        → warn（样本不足时不下结论，只报「查不了」）
//
// ⛔ 三条纪律：
//   · 判涨停只走 A.isLimitUp（与生产同一把尺子，含分板块限幅/ST/容差 0.3）
//   · 新股无涨跌幅限制期：能用全A快照的上市日期就复刻生产钩子（server.js NO_LIMIT_DAYS=8）；
//     本地快照若来自新浪/腾讯源（listedDate=0）→ 钩子不生效，missed 清单可能混入上市 8 日内
//     新股，此时 noLimitActive=false 显式降级声明（⛔ 不静默、不拿降级结果当干净样本）
//   · 漏票判定的覆盖范围仅限 .kline_cache 缓存内的票（约 5900 只，按需攒的），
//     不是全 A —— 报告里必须带这个前提，否则「0 漏票」会被误读成「全市场无漏票」
//
// 用法：
//   node _audit_zt_pool.js                        # 抽查 ztPool_snapshot.json × .kline_cache
//   node _audit_zt_pool.js --date 20261016        # 指定数据归属日（默认取快照 day）
//   node _audit_zt_pool.js --fetch                # 联网重拉该日期的池（em.fetchZTPool）再查
//   node _audit_zt_pool.js --stocks-online        # 联网拉东财全A拿上市日期（激活新股钩子）
//   node _audit_zt_pool.js --pool x.json --stocks y.json --cache dir --out ledger.json
//
// 既是 CLI 也是模块（module.exports 供守门真跑）。

const fs = require('fs');
const path = require('path');
const A = require('./analysis');

const NO_LIMIT_DAYS = 8;               // 与 server.js 同值（自然日，见其上市日期注入处注释）
const PCT_DIFF_TOL = 0.15;             // 池 pct vs K 线 pct 观察容差（百分点；覆盖两端舍入）
const STALE_MS = 26 * 3600 * 1000;     // 快照龄超过 26h 判陈旧（隔日还没刷=刷新链断了）
const NO_KLINE_WARN = 0.2;             // 无法交叉验证的池成员占比超过它就 warn
const LEDGER_KEEP = 50;                // 流水保留条数

const normDay = d => String(d == null ? '' : d).replace(/-/g, '');
const klineDay = d => { const s = normDay(d); return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8) : s; };

// 上市至今自然日天数；无法判定（缺日期/格式异常）返回 null。
// ⛔ 与 server.js listedDaysAgo 逐行同语义：禁止用 'YYYYMMDD' 字符串减 N 的整数减法（跨月不借位，形同虚设）。
function listedDaysAgo(ld) {
  const v = Number(ld || 0);
  if (!(v > 20000000)) return null;
  const s = String(v);
  const t = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 86400000;
}

// 由全A快照行构造新股钩子（与 server.js 注入同口径）。coverage=有上市日期的行占比。
// ⚠️ ks 轮补：新浪/东财全A快照普遍缺 listedDate（coverage≈0 → 钩子长期 inactive），
//   于是 920285 N远大（上市首日 +73.99%）这类无限幅新股每次都混进漏票清单（10-23 实测一条）。
//   兜底：A 股名称前缀 N = 上市首日、C = 注册制新股上市后 5 日内，两者均无涨跌幅限制，
//   没有正常股票以 N/C 开头（U/W/XD/XR/DR 另有所指），按名判定安全。
function makeNoLimit(rows) {
  const idx = new Map();
  let withLd = 0, n = 0;
  for (const s of (rows || [])) {
    if (!s || !s.code) continue;
    n++;
    const ld = Number(s.listedDate);
    const ok = ld > 20000000;
    if (ok) withLd++;
    idx.set(String(s.code), { ld: ok ? ld : 0, name: String(s.name || '') });
  }
  const coverage = n ? withLd / n : 0;
  return {
    active: coverage >= 0.5,     // 过半有日期才敢说钩子生效（低于此=降级，调用方必须显式声明）
    coverage,
    fn: code => {
      const e = idx.get(String(code));
      if (!e) return false;       // 快照里没这只票 → 不判新股，按板块限幅（生产认可的降级路径）
      if (/^[NC]/.test(e.name)) return true;   // 首日/次新无限幅：名称前缀兜底（listedDate 缺失时唯一可行判据）
      if (!e.ld) return false;    // 缺上市日期且名称无前缀 → 不判新股
      const ago = listedDaysAgo(e.ld);
      return ago != null && ago < NO_LIMIT_DAYS;
    }
  };
}

// ---- 全A快照漏票检测（与 server.js deriveLimitUpMissed 同一把尺子）----
// ⛔ auditZTPool 的反向抽查只覆盖 .kline_cache（「被访问过的票」约 5900 只），不是全 A；
//   本函数改用新浪全A快照（含 open/high/low/preClose/price）交叉验证涨停池，找出「收盘=涨停价
//   但池里没有」的漏票，覆盖全 A，专抓「两源涨停池都漏」的票（ST/北交所/竞价偷袭拉板）。
// ⛔ 严口径：收盘价必须【等于】round(前收×(1+限幅),2) 才算漏票，容差 0.005，不用宽口径
//   pct≥限幅-0.3（会把触板收在板下1分误报）；新股无限制期跳过。
// 附带「低开拉板」特征：open 涨幅 <3% 却收盘封板 → 非一字板/高开秒板。⛔ 快照层启发式：
//   早盘低开拉板与尾盘竞价拉板在此分不清，要精确区分「收盘竞价偷袭」需分时数据。
// stocks: [{code,name,price,pct,open,high,low,preClose,...}]（新浪全A快照形态）
function auditMissedBySnapshot(stocks, pool, opts = {}) {
  const day = normDay(opts.day || '');
  const noLimit = typeof opts.noLimit === 'function' ? opts.noLimit : () => false;
  const have = new Set((pool || []).map(p => p && p.code));
  const missed = [];
  let lowOpen = 0, noOpen = 0;
  for (const s of (stocks || [])) {
    if (!s || !s.code || have.has(s.code)) continue;
    const pc = +s.preClose, price = +s.price;
    if (!(pc > 0) || !(price > 0)) continue;
    if (noLimit(s.code)) continue;
    // ⛔ 2026-10-28 用户口径「退市整理期股不计入涨停家数」：与生产巡检/补漏票同源 ——
    //    它们封板也不算家数，池里没有是设计如此，绝不能算成「漏票」（否则审计天天假 WARN/FAIL）。
    if (!A.countsInZtTally(s.name)) continue;
    // mq 轮：严口径唯一入口（与生产巡检/补漏票同一把尺子）
    if (!A.sealedAtLimit(s.code, s.name, price, pc)) continue;    // 没封在涨停价
    const open = +s.open;
    const openPct = open > 0 ? +(((open / pc - 1) * 100).toFixed(2)) : null;
    const lo = openPct != null && openPct < 3;
    if (openPct == null) noOpen++; else if (lo) lowOpen++;
    missed.push({ code: s.code, name: s.name, pct: +(s.pct || 0), price, openPct, lowOpen: lo });
  }
  missed.sort((a, b) => b.pct - a.pct);
  return { day, missed, lowOpen, noOpen, scanned: (stocks || []).length };
}

// ---- 纯函数核心：池 × K线 交叉审计（守门直接真跑） ----
// pool:      [{code,name,pct,src,sector,firstSeal,...}]（东财/同花顺两种池形态都吃）
// allKlines: [{code,name,rows:[{date,pct,...}]}]（.kline_cache 读出的形态）
// opts:      { day:'YYYYMMDD'|'YYYY-MM-DD', noLimit:fn|null, noLimitActive:bool,
//              now:ms, snapAt:ms|null }
function auditZTPool(pool, allKlines, opts = {}) {
  const day = normDay(opts.day || '');
  const noLimit = typeof opts.noLimit === 'function' ? opts.noLimit : () => false;
  const noLimitActive = opts.noLimitActive === true;
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const list = Array.isArray(pool) ? pool.filter(z => z && typeof z === 'object') : [];
  const notes = [];

  // —— 池结构体检 ——
  const cnt = new Map();
  for (const z of list) { const c = String(z.code || ''); if (c) cnt.set(c, (cnt.get(c) || 0) + 1); }
  const dupCode = [...cnt].filter(([, n]) => n > 1).map(([c, n]) => ({ code: c, n }));
  const badField = [];
  for (const z of list) {
    const c = String(z.code || ''), nm = String(z.name || '');
    // ⛔ pct 判空必须显式 == null：+null === 0 是有限数，只写 !isFinite(+z.pct) 会把
    //   「没有涨幅数据」当成「涨幅 0」放过（缺数据≠数据是零，全项目老纪律）。
    if (!c || !nm || z.pct == null || !Number.isFinite(+z.pct)) badField.push({ code: c, name: nm, pct: z.pct == null ? null : z.pct });
  }
  const srcMix = {};
  for (const z of list) { const s = String(z.src || 'unknown'); srcMix[s] = (srcMix[s] || 0) + 1; }

  // ⛔ 2026-10-28 口径变更留痕：池里若还有退市整理期股（旧口径快照 / 旧进程写的文件），
  //   只提示、不改判定 —— 它们本来也真封板了，不算错票；新口径下它们不会进池（下次刷新生效）。
  const dlInPool = list.filter(z => !A.countsInZtTally(z.name));
  if (dlInPool.length) {
    notes.push('ℹ️ 池内含 ' + dlInPool.length + ' 只退市整理期股（' + dlInPool.slice(0, 5).map(z => String(z.name || '') + '(' + z.code + ')').join('、') + '）'
      + '：2026-10-28 起口径为「不计入涨停家数」（不进池），本份快照若仍含它们是旧口径，下次刷新生效；本条不影响判定');
  }
  // —— 池 × K线：正向验证（池里的是不是真涨停）——
  const kIdx = new Map();
  for (const k of (allKlines || [])) if (k && k.code) kIdx.set(String(k.code), k);
  const barOf = (code) => {
    const k = kIdx.get(String(code));
    if (!k || !Array.isArray(k.rows)) return null;
    return k.rows.find(r => normDay(r.date) === day) || null;
  };
  const fakeZT = [], pctDiff = [], noKline = [], noLimitSkip = [], noRuler = [];
  const klineDisagree = [], klineMissing = [];
  let crossN = 0, snapCrossN = 0;
  // ks 轮：东财全A快照升为主尺子（.kline_cache 退为辅助）。
  //  理由：兜底源（tx/ths）会把盘中未收盘的 bar 写成当日行 —— 10-19/10-20/10-23 连续三次因此
  //   把真实封板的票判成「错票」并 FAIL（84 只里 8 只全是误报，池本体 84/84 真实封板）。
  //   缓存是「有行≠行对」的重灾区，快照是当天收盘价权威，判定必须站在权威这一边。
  const snapIdx = new Map();
  if (Array.isArray(opts.snapRows)) for (const s of opts.snapRows) { if (s && s.code) snapIdx.set(String(s.code), s); }
  // 主尺子能不能用：有快照行才算「能判」。没有快照时缓存是唯一尺子，坏了也必须报（保留旧行为）。
  const snapUsable = snapIdx.size > 0;
  // 返回 true=快照判封板 / false=快照判未封板 / null=快照里没有这只票（无尺子）
  const snapVerdictOf = (c, nm) => {
    const s = snapIdx.get(c);
    if (!s) return null;
    const pc = Number(s.preClose), px = Number(s.price);
    if (!(pc > 0) || !(px > 0)) return null;
    // 与 auditMissedBySnapshot / 生产巡检共用 analysis.sealedAtLimit 这一把严尺子（三处同源，不许各写一份）
    return A.sealedAtLimit(c, String(s.name || nm), px, pc, 0.011);
  };
  for (const z of list) {
    const c = String(z.code || ''); if (!c) continue;
    const bar = barOf(c);
    const kp = bar ? +bar.pct : NaN;
    const nm = String(z.name || (kIdx.get(c) && kIdx.get(c).name) || '');
    if (noLimit(c)) { noLimitSkip.push({ code: c, name: nm, pct: kp, inPool: true }); continue; }
    const sv = snapVerdictOf(c, nm);
    if (sv !== null) { snapCrossN++; crossN++; }       // 快照能判 = 本票已验证，不必依赖缓存
    if (sv === false) {
      // 主尺子说没封板 → 这是真错票（此时缓存说什么都不重要）
      fakeZT.push({
        code: c, name: nm,
        poolPct: z.pct != null && Number.isFinite(+z.pct) ? +z.pct : null,
        klinePct: Number.isFinite(kp) ? kp : null, snapPct: snapIdx.get(c).pct, snapPrice: snapIdx.get(c).price
      });
      continue;
    }
    if (sv === true) {
      // 主尺子说封板 → 池没错；K 线若说没封，那是缓存当日行失真，单列观察（不再 FAIL）
      if (!bar || !Number.isFinite(kp)) { klineMissing.push({ code: c, name: nm, snapPct: snapIdx.get(c).pct }); continue; }
      if (!A.isLimitUp(c, nm, kp)) {
        klineDisagree.push({
          code: c, name: nm,
          poolPct: z.pct != null && Number.isFinite(+z.pct) ? +z.pct : null,
          klinePct: kp, snapPct: snapIdx.get(c).pct
        });
        continue;
      }
      if (z.pct != null && Number.isFinite(+z.pct) && Math.abs(+z.pct - kp) > PCT_DIFF_TOL) {
        pctDiff.push({ code: c, name: nm, poolPct: +z.pct, klinePct: kp });
      }
      continue;
    }
    // 快照里没有这只票（次新股/停牌/退市股被名称过滤/快照缺口）→ 退回缓存判定
    if (!bar || !Number.isFinite(kp)) { noKline.push(c); continue; }
    crossN++;
    if (!A.isLimitUp(c, nm, kp)) {
      // ⛔ mq 轮（2026-10-28）：有主尺子时，光凭缓存判「错票」不足以下 FAIL。
      //   实证：002731 萃华退 今日真封板（腾讯+东财双源：收=高=0.28=round(0.25×1.10,2)，
      //   成交额 9,560,722、换手 15.70，与池条目逐字段吻合），但它在东财全A快照里**不存在**
      //   （JUNK_NAME_RE 把「退」名称股整体滤掉）→ 无主尺子 → 回落缓存；而缓存当日行是 ths
      //   早盘冻结行（收 0.24、成交 43 万、最高 0.25 < 涨停价 0.28）→ 审计判成错票 → 假 FAIL。
      //   口径：无主尺子 = 判不出 → 单列「待核实」（warn），绝不冤枉池子，也绝不静默放过。
      //   没有快照可用时（snapUsable=false）维持旧行为：那时缓存是唯一尺子，坏了必须报。
      if (snapUsable) noRuler.push({ code: c, name: nm, poolPct: z.pct != null && Number.isFinite(+z.pct) ? +z.pct : null, klinePct: kp });
      else fakeZT.push({ code: c, name: nm, poolPct: z.pct != null && Number.isFinite(+z.pct) ? +z.pct : null, klinePct: kp });
    } else if (z.pct != null && Number.isFinite(+z.pct) && Math.abs(+z.pct - kp) > PCT_DIFF_TOL) {
      pctDiff.push({ code: c, name: nm, poolPct: +z.pct, klinePct: kp });
    }
  }

  // —— K线 × 池：反向抽查（缓存里封板但池里没有）——
  // ⛔ 口径说明：池成员资格是「收盘封板」（close 贴在涨停价），而生产 A.isLimitUp 是
  //   「涨幅达到限幅-0.3pp」的宽松判定（信号用）。两者差一个容差，2026-10-16 实测：
  //   莱美药业(300006)触板后收在板下 1 分钱（19.93%），isLimitUp 判 true 但 EM 池正确地
  //   不收它 —— 若反向抽查也用宽松口径，这种票每次都进漏票清单，狼来了三次就没人看报告了。
  //   所以：fail 方向（错票）用宽松口径（宁可少报），warn 方向（漏票）用严口径（宁可漏报）。
  //   严口径 = close ≥ round(前收×(1+限幅),2)，限幅仍走 A.limitPctOf（规则共用同一份）。
  const poolSet = new Set(cnt.keys());
  const missed = [], nearMiss = [], aboveLimit = [], noPrev = [];
  for (const k of (allKlines || [])) {
    const c = String((k && k.code) || ''); if (!c) continue;
    const rows = Array.isArray(k && k.rows) ? k.rows : [];
    const i = rows.findIndex(r => normDay(r.date) === day); if (i < 0) continue;
    const bar = rows[i], prev = i > 0 ? rows[i - 1] : null;
    const kp = +bar.pct;
    if (!Number.isFinite(kp) || kp <= 0) continue;
    if (noLimit(c)) { noLimitSkip.push({ code: c, name: String(k.name || ''), pct: kp, inPool: false }); continue; }
    const nm = String(k.name || '');
    if (!prev || !(Number(prev.close) > 0)) { noPrev.push({ code: c, name: nm, pct: kp }); continue; }
    const limitPx = Math.round(Number(prev.close) * (1 + A.limitPctOf(c, nm) / 100) * 100) / 100;
    const close = Number(bar.close);
    if (!(close > 0)) { noPrev.push({ code: c, name: nm, pct: kp }); continue; }
    const rec = { code: c, name: nm, pct: kp, close, limitPx };
    if (close > limitPx + 0.011) { aboveLimit.push(rec); continue; }   // 收盘跑到"涨停价"之上→名字/板块/数据口径存疑（数据错/缓存名字未同步）
    if (close >= limitPx) { if (!poolSet.has(c)) missed.push(rec); continue; }   // 收盘封板且池里没有 = 漏票
    if (Number(bar.high) >= limitPx - 0.011) nearMiss.push(rec);      // 触板未封板：池正确地不收，仅观察
  }
  missed.sort((a, b) => b.pct - a.pct);

  // —— 源混杂风险：同花顺兜底源的已知差异必须显式曝光 ——
  let thsRisk = null;
  if (srcMix.ths) {
    const ths = list.filter(z => String(z.src || '') === 'ths');
    thsRisk = {
      n: ths.length,
      noSector: ths.filter(z => !z.sector).length,
      noFirstSeal: ths.filter(z => z.firstSeal == null).length,
      note: '同花顺兜底源差异：无北交所、无行业字段、无首次封板时间、成交额为「流通市值×换手率」推算——本批板块归类/封板时间因子降级'
    };
    notes.push('本批池混入同花顺兜底源 ' + ths.length + ' 条（东财当时不可达）：' + thsRisk.note);
  }
  if (!noLimitActive) {
    notes.push('⚠️ 新股上市日期缺失（全A快照无 listedDate，与生产降级路径同口径），已按名称前缀 N/C 兜底识别无限幅新股并跳过；'
      + '其余次新股仍可能混入清单，noLimitSkip 已单列 ' + noLimitSkip.length + ' 只待辨认');
  }
  if (klineDisagree.length) {
    notes.push('⚠️ ' + klineDisagree.length + ' 只「东财快照判封板、但 K 线不认」：K 线缓存当日行失真（兜底源盘中 bar 冒充收盘行，10-19/10-20/10-23 三次同源）'
      + ' → 池没错，是缓存坏。已按主尺子判 OK，不计错票；' + (klineDisagree.length ? klineDisagree.slice(0, 8).map(o => o.code).join(' ') : ''));
  }
  if (klineMissing.length) {
    notes.push('⚠️ ' + klineMissing.length + ' 只池成员在 K 线缓存里没有当日行（快照已判封板）：缓存该补未补，形态/连板判定会用陈旧行');
  }
  if (snapCrossN > 0) {
    notes.push('主尺子 = 东财全A快照（严口径：收盘价 = round(前收×(1+限幅),2)），已核验 ' + snapCrossN + '/' + list.length + ' 只池成员；K 线缓存降为辅助');
  } else {
    notes.push('⚠️ 本轮没有可用快照（缺文件或快照早于该交易日收盘）→ 主尺子退化为 .kline_cache，错票判定可能受缓存当日行失真影响');
  }
  if (noRuler.length) {
    notes.push('⚠️ ' + noRuler.length + ' 只「无主尺子·缓存不认」单列待核实（快照里没这只票：退市股被名称过滤/停牌/次新；缓存当日行是已知最不可信来源，不足以判错票）'
      + ' → ' + noRuler.slice(0, 8).map(o => o.code + (o.name ? '(' + o.name + ')' : '')).join(' '));
  }
  if (aboveLimit.length) {
    notes.push('收盘价超过「按缓存名字+板块推算的涨停价」共 ' + aboveLimit.length + ' 只（' + aboveLimit.slice(0, 6).map(o => o.code).join(' ') + (aboveLimit.length > 6 ? ' 等' : '') + '）：K 线缓存名字/板块/数据口径存疑（ST 已于 2026-04 起与主板同限幅 ±10%，此分类只剩数据异常），这些票按缓存算的限幅对不上，已从漏票清单剔除单列');
  }
  if (nearMiss.length) {
    notes.push('触板未封板（盘中触过涨停价、收盘未贴住）' + nearMiss.length + ' 只：池正确地不收，仅观察不计入漏票');
  }
  if (pctDiff.length) {
    notes.push('池 pct 与 K 线 pct 偏差 >' + PCT_DIFF_TOL + 'pp 共 ' + pctDiff.length + ' 条：若快照取自盘中即为正常（收盘涨幅后定），若为收盘后快照则需人工核对');
  }

  const poolN = list.length;
  const coverage = poolN ? crossN / poolN : 0;
  const stale = Number.isFinite(opts.snapAt) && (now - opts.snapAt) > STALE_MS;

  let verdict = 'ok';
  if (fakeZT.length) verdict = 'fail';
  else if (missed.length || dupCode.length || badField.length || aboveLimit.length || stale
    || klineDisagree.length || klineMissing.length || noRuler.length || coverage < 1 - NO_KLINE_WARN) verdict = 'warn';

  return {
    day, at: now, poolN, crossN, snapCrossN, coverage: +coverage.toFixed(4),
    dupCode, badField, srcMix, fakeZT, pctDiff, noKline, missed, nearMiss, aboveLimit, noPrev, noLimitSkip, noRuler,
    klineDisagree, klineMissing,
    noLimitActive, thsRisk, stale, verdict, notes,
    scope: '漏票判定仅覆盖 .kline_cache 缓存内约 ' + (allKlines || []).length + ' 只票（按需攒齐），非全 A'
  };
}

// 读 .kline_cache 目录 → [{code,name,rows}]（单文件坏 JSON 跳过并计数，不炸整轮）
function loadCacheKlines(cacheDir) {
  const out = [];
  let broken = 0;
  let files = [];
  try { files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.json')); } catch { return { klines: out, broken, files: 0 }; }
  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
      if (j && Array.isArray(j.rows)) out.push({ code: f.replace(/\.json$/, ''), name: j.name || '', rows: j.rows });
    } catch { broken++; }
  }
  return { klines: out, broken, files: files.length };
}

// ---- CLI ----
function main() {
  const argv = process.argv.slice(2);
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
  const has = k => argv.includes(k);
  const ROOT = __dirname;
  const day0 = arg('--date', '');
  const poolFile = arg('--pool', path.join(ROOT, 'ztPool_snapshot.json'));
  const stocksFile = arg('--stocks', path.join(ROOT, 'stocks_snapshot.json'));
  const cacheDir = arg('--cache', path.join(ROOT, '.kline_cache'));
  const outFile = arg('--out', path.join(ROOT, 'zt_pool_audit.json'));

  // ① 池：默认快照；--fetch 联网重拉（需 em.js）
  let pool = null, snapDay = '', snapAt = null;
  if (has('--fetch')) {
    const em = require('./em.js');
    const d = normDay(day0) || normDay(JSON.parse(fs.readFileSync(poolFile, 'utf8')).day || '');
    if (!d) { console.error('✗ --fetch 需要 --date 或快照里有 day'); process.exit(2); }
    em.fetchZTPool(d).then(t => {
      run({ pool: t, snapDay: d, snapAt: null });
    }).catch(e => { console.error('✗ 联网拉池失败：', e && e.message); process.exit(2); });
    return;
  }
  const pj = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
  pool = Array.isArray(pj) ? pj : (pj.pool || []);
  snapDay = normDay(pj.day || '');
  snapAt = Number.isFinite(pj.at) ? pj.at : null;
  run({ pool, snapDay, snapAt });

  function run({ pool: pool2, snapDay: sd, snapAt: sa }) {
    const day = normDay(day0) || sd;
    if (!day) { console.error('✗ 没有可用日期（--date 或快照 day 至少一个）'); process.exit(2); }

    // ② 新股钩子：默认本地全A快照；--stocks-online 拉东财（有上市日期）
    const buildHook = rows => {
      const h = makeNoLimit(rows);
      return h;
    };
    let hook;
    if (has('--stocks-online')) {
      const em = require('./em.js');
      em.fetchAllStocksEM().then(rows => finish(rows, Date.now())).catch(e => { console.error('✗ 拉全A失败：', e && e.message); process.exit(2); });
    } else {
      let rows = [], snapAtMs = 0;
      try {
        const sj = JSON.parse(fs.readFileSync(stocksFile, 'utf8'));
        rows = Array.isArray(sj) ? sj : (sj.rows || []);
        snapAtMs = Number(sj && sj.at) || 0;
        if (!snapAtMs) { try { snapAtMs = fs.statSync(stocksFile).mtimeMs; } catch { } }
      } catch { rows = []; }
      finish(rows, snapAtMs);
    }

    function finish(rows, snapAtMs) {
      const h = buildHook(rows);
      // ③ K 线缓存
      const { klines, broken, files } = loadCacheKlines(cacheDir);
      // ks 轮：快照只有当「拉取得晚于该交易日 15:05」时才配当主尺子 —— 盘中快照的 price 是实时价，
      // 拿它比收盘价会把真封板误判成未封板（宁可退回缓存判定，也不制造新的误报）。
      const ds = normDay(day);
      const dayCloseMs = ds.length === 8
        ? new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8), 15, 5).getTime() : 0;
      const snapFresh = rows.length > 0 && dayCloseMs > 0 && Number(snapAtMs) > 0 && Number(snapAtMs) >= dayCloseMs;
      const r = auditZTPool(pool2, klines, { day, noLimit: h.fn, noLimitActive: h.active, snapAt: sa, snapRows: snapFresh ? rows : null });
      // ③b 全A快照漏票：覆盖全市场（不只 .kline_cache 的被访问票），专抓两源都漏的票（ST/北交所/竞价拉板）
      const rm = auditMissedBySnapshot(rows, pool2, { day, noLimit: h.fn });

      // ④ 人类可读报告
      const S = x => (x && x.length ? x.slice(0, 10).map(o => (o && o.code != null ? o.code + (o.name ? '(' + o.name + ')' : '') : o)).join(' ') + (x.length > 10 ? ' …共' + x.length : '') : '无');
      console.log('═══ 涨停池质量抽查 · ' + day + ' ═══');
      console.log('池成员 ' + r.poolN + ' 只（' + JSON.stringify(r.srcMix) + '），交叉验证 ' + r.crossN + ' 只（覆盖率 ' + (r.coverage * 100).toFixed(1) + '%），无法验证 ' + r.noKline.length + ' 只');
      console.log('重码：' + S(r.dupCode) + ' ｜ 缺字段：' + S(r.badField) + ' ｜ 快照陈旧：' + (r.stale ? '是' : '否'));
      console.log('错票（池说涨停·主尺子不认）：' + S(r.fakeZT));
      console.log('无主尺子（快照无此票·缓存不认，待核实）：' + S(r.noRuler));
      console.log('缓存失真（快照判封板·K线不认）：' + (r.klineDisagree.length ? r.klineDisagree.slice(0, 10).map(o => o.code + (o.name ? '(' + o.name + ')' : '') + ' ' + o.klinePct + '%→快照' + o.snapPct + '%').join(' ') + (r.klineDisagree.length > 10 ? ' …共' + r.klineDisagree.length : '') : '无') + ' ｜ 快照有·缓存无当日行：' + r.klineMissing.length + ' 只');
      console.log('漏票（收盘封板·池里没有，仅限缓存范围）：' + S(r.missed));
      console.log('全A漏票（收盘封板·池里没有，全市场口径扫 ' + rm.scanned + ' 只）：' + rm.missed.length + ' 只' + (rm.missed.length ? '（' + rm.missed.slice(0, 10).map(o => o.code + (o.name ? '(' + o.name + ')' : '') + (o.lowOpen ? '·低开' : '')).join(' ') + (rm.missed.length > 10 ? ' …' : '') + '）' : '') + '｜其中低开拉板 ' + rm.lowOpen + ' 只');
      console.log('口径存疑（收盘超按名限幅→摘帽/更名）：' + S(r.aboveLimit));
      console.log('触板未封板（观察项）：' + r.nearMiss.length + ' 只' + (r.nearMiss.length ? '（如 ' + r.nearMiss.slice(0, 5).map(o => o.code + ' ' + o.pct + '%').join(', ') + '）' : '') + ' ｜ 无前收柱无法判：' + S(r.noPrev));
      console.log('新股窗口单列（钩子' + (r.noLimitActive ? '生效' : '未生效') + '）：' + S(r.noLimitSkip));
      console.log('pct 偏差观察：' + r.pctDiff.length + ' 条' + (r.pctDiff.length ? '（如 ' + r.pctDiff.slice(0, 3).map(o => o.code + ':' + o.poolPct + '→' + o.klinePct).join(', ') + '）' : ''));
      if (r.thsRisk) console.log('⚠️ ' + r.thsRisk.note);
      for (const n of r.notes) console.log('· ' + n);
      console.log('缓存：' + files + ' 个文件（坏 ' + broken + '）。' + r.scope);
      console.log('═══ 判定：' + (r.verdict === 'fail' ? '❌ FAIL' : r.verdict === 'warn' ? '⚠️ WARN' : '✅ OK') + ' ═══');

      // ⑤ 流水（追加，保留最近 LEDGER_KEEP 条）
      try {
        let runs = [];
        try { const lj = JSON.parse(fs.readFileSync(outFile, 'utf8')); runs = Array.isArray(lj && lj.runs) ? lj.runs : []; } catch {}
        runs.push({ at: r.at, day: r.day, verdict: r.verdict, poolN: r.poolN, crossN: r.crossN, snapCrossN: r.snapCrossN, coverage: r.coverage, fakeZT: r.fakeZT.length, noRuler: r.noRuler.length, klineDisagree: r.klineDisagree.length, klineMissing: r.klineMissing.length, missed: r.missed.length, nearMiss: r.nearMiss.length, aboveLimit: r.aboveLimit.length, dupCode: r.dupCode.length, badField: r.badField.length, noLimitActive: r.noLimitActive, srcMix: r.srcMix, snapMissed: rm.missed.length, snapLowOpen: rm.lowOpen, snapScanned: rm.scanned });
        if (runs.length > LEDGER_KEEP) runs = runs.slice(-LEDGER_KEEP);
        fs.writeFileSync(outFile, JSON.stringify({ runs }, null, 1));
        console.log('流水已追加 → ' + path.basename(outFile) + '（保留最近 ' + LEDGER_KEEP + ' 条）');
      } catch (e) { console.error('⚠️ 流水写入失败：', e && e.message); }

      if (r.verdict === 'fail') process.exitCode = 1;
    }
  }
}

if (require.main === module) main();

module.exports = { auditZTPool, auditMissedBySnapshot, listedDaysAgo, makeNoLimit, loadCacheKlines, NO_LIMIT_DAYS, PCT_DIFF_TOL, STALE_MS, NO_KLINE_WARN };
