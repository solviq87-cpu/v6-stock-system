'use strict';
// 存量回填：给已有信号补 sig.nd（信号日收盘 → 次日最高/收盘，含综合质量）
//
// 为什么必须补：resolveWithKline 优先用【当日】K线，那是"盘中看到信号当天还能赚多少"，
// 不是预测力。学习/标定必须看"我收盘前埋伏，明天能涨多少"。详见 server.js resolveNextDay 注释。
//
// ⛔ 口径与 server.js resolveNextDay（L1126）逐行对齐（2026-10-15 升级：补 10-08 综合评判
//   closeGain/fallback/quality；旧版缺这三项，回填出来的 nd 与服务器现口径不一致；
//   2026-10-17 B2 轮再升级：补开盘价三件套 open/openGap/oneLine + 幂等判据加严）：
//   · entry = 信号日那一根的 close；nx = 下一根 K 线
//   · maxGain/closeGain/fallback、quality 四档（strong/ok/fake/miss）、limitUp 走 isLimitUp
//   · B2：open/openGap（开盘即可兑现的口径，与 maxGain 并列）、oneLine 走 A.isOneLineBoard
//     （次日一字板→买不进，统计命中时须与普通命中分开；缺 OHLC 写 null 不写 false）
//   · void 跳过；缺一根就跳过，⛔ 绝不拿 0/近似值冒充；幂等判据 = 「date 相同且已有 openGap」
//     （旧版 nd 没有 openGap → 放行重算一次补齐，不会永久跳过）
//   · 历史回测那批（resolved.mode==='历史回测'）本来就是次日口径，直接认作 nd
//   ⚠️ 边界：服务器喂了 setNoLimitFn（新股 8 天无限制钩子），本脚本拿不到上市日期快照，
//   退化为原行为（bc 轮认可的降级路径）。实测当前待补集合无新股，不受影响。
//
// 用法：
//   node _backfill_nd.js                  # 干跑：只报告，不写文件
//   node _backfill_nd.js --write          # 落盘 stats.json（先备份 + 登记流水）
//   node _backfill_nd.js --online         // 干跑 + 本地缓存算不了的，只读回拉线上 /api/kline 再算
//   node _backfill_nd.js --write --online
//   node _backfill_nd.js --all            // 默认只处理回测三类(auczt/yier/lianban)；--all 对齐服务器全类型
//   node _backfill_nd.js <stats文件> <缓存目录>   // 兼容旧版位置参数（默认 ./stats.json ./.kline_cache）
//
// 既是 CLI 也是模块（module.exports 供守门真跑）。

const fs = require('fs');
const path = require('path');
const https = require('https');
const A = require('./analysis');
const HIT_THR = 3;
const BACKTEST_CLASSES = ['auczt', 'yier', 'lianban'];
const ONLINE_LIMIT = 200;      // 单轮最多回拉多少只票（线上是唯一推送源，客气点）
const ONLINE_GAP_MS = 1200;    // 回拉间隔
const norm = d => String(d == null ? '' : d).replace(/-/g, '');

// ---- 核心：与 server.js resolveNextDay 对齐的纯函数 ----
// rows: K 线行数组。返回 nd 对象或 null（跳过）。
function computeNd(sig, rows) {
  if (!sig || sig.void) return null;
  if (!rows || !rows.length) return null;
  const d0 = norm(sig.date);
  const i = rows.findIndex(r => norm(r.date) === d0);
  if (i < 0) return null;
  const base = rows[i], nx = rows[i + 1];
  if (!nx) return null;                              // 次日还没走出来，留到下一轮
  const entry = base.close;                          // 信号日收盘价 = 你能埋伏到的价
  if (!entry || !nx.high) return null;
  const nd = norm(nx.date);
  // ⛔⛔ B2 轮（与 server.js resolveNextDay 同改）：幂等判据加 openGap。旧版 nd 没有
  //    open/openGap/oneLine，只判 date 会永久跳过存量、新字段永远补不进去；新版 openGap
  //    必写（无开盘价也写 null）→ === undefined 即「旧版 nd」标记，放行重算一次补齐。
  if (sig.nd && sig.nd.date === nd && sig.nd.openGap !== undefined) return null;
  const maxGain = +(((nx.high - entry) / entry) * 100).toFixed(2);
  const closeGain = +(((nx.close - entry) / entry) * 100).toFixed(2);
  const fallback = +(Math.max(0, maxGain - closeGain).toFixed(2));
  // ⛔⛔ 2026-10-08 综合评判（用户"不要只看上涨，还要看回落"）：与 server.js 同四档
  let quality = 'miss';
  if (maxGain >= 5 && closeGain >= 3 && fallback <= 3) quality = 'strong';
  else if (maxGain >= 3 && closeGain >= 1 && fallback <= 5) quality = 'ok';
  else if (maxGain >= HIT_THR) quality = 'fake';     // 触发旧命中线但实际赚不到
  // B2 轮：开盘价三件套（口径同 server.js：缺 OHLC 写 null 不写 false）
  const nxOpen = Number(nx.open);
  const hasOpen = isFinite(nxOpen) && nxOpen > 0;
  const hasOHL = hasOpen && isFinite(Number(nx.low)) && Number(nx.low) > 0;   // high 入口已守
  return {
    date: nd, mode: '次日', nextPct: nx.pct,
    maxGain, closeGain, fallback,
    open: hasOpen ? nxOpen : null,
    openGap: hasOpen ? +(((nxOpen - entry) / entry) * 100).toFixed(2) : null,
    oneLine: hasOHL ? A.isOneLineBoard(sig.code, sig.name, entry, nx) : null,
    limitUp: A.isLimitUp(sig.code, sig.name, nx.pct),
    hit: maxGain >= HIT_THR,          // 旧口径保留（兼容历史）
    quality
  };
}

// ---- 本地缓存行源（带内存缓存，同一票多条信号只读一次盘） ----
function makeCacheRows(dir) {
  const mem = new Map();
  return code => {
    if (mem.has(code)) return mem.get(code);
    let r = null;
    const p = path.join(dir, String(code) + '.json');
    if (fs.existsSync(p)) {
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        r = Array.isArray(j) ? j : (j.rows || null);
        if (r && !r.length) r = null;
      } catch (e) { r = null; }
    }
    mem.set(code, r);
    return r;
  };
}

// ---- 线上回拉（只读 GET；失败/被锁返回 null，绝不猜） ----
function onlineKline(base, token, code, n = 240) {
  return new Promise(resolve => {
    const url = base.replace(/\/+$/, '') + '/api/kline?code=' + encodeURIComponent(code) + '&n=' + n + '&token=' + encodeURIComponent(token);
    const req = https.get(url, { agent: new https.Agent({ keepAlive: false, maxSockets: 4, family: 4 }) }, res => {
      let b = '';
      res.on('data', c => { b += c; if (b.length > 4e6) req.destroy(); });
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          if (j && j.locked) return resolve(null);
          const rows = j && j.rows;
          resolve(rows && rows.length ? rows : null);
        } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(20000, () => { req.destroy(); resolve(null); });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 计划：算出「该补什么、跳过什么」，不落盘 ----
// latestDay：已知最新交易日（YYYYMMDD，通常取 breadth.json 最大键）。线上兜底只在
//   「本地解析不了 且 信号日早于最新交易日」时触发 —— 后者保证次日理应已存在，
//   不去打今天/昨天的信号（线上也没有，纯浪费）。
// types：数组=只处理这些类型；⛔ null=全类型（对齐服务器 resolveSignals 的范围，--all 用）。
//   B2 轮修真 bug：main 里原来写 `types: types || undefined`，把 --all 的 null 转成
//   undefined → 触发下面的解构默认值又变回回测三类 → --all 静默失效（干跑数字与默认
//   一模一样，而 scope 打印却写着「全类型」—— 说的和做的不一样）。现在 null 一路透传。
async function planBackfill({ signals, rowsOf, fetchRows, sleepFn = sleep, types = BACKTEST_CLASSES, onlineLimit = ONLINE_LIMIT, latestDay = '' }) {
  const cls = types ? new Set(types) : null;    // null = 不设白名单，全类型都进
  const actions = [];                 // { sig, nd, src }
  const skipped = { void: 0, noRows: 0, noSigBar: 0, noNextBar: 0, sameDate: 0, done: 0, onlineFail: 0, histDirect: 0, onlineSkipNew: 0 };
  const perType = {};
  let onlineUsed = 0;
  const resolvable = (rows, d0) => {
    if (!rows || !rows.length) return false;
    const i = rows.findIndex(r => norm(r.date) === d0);
    return i >= 0 && i + 1 < rows.length;
  };
  for (const sig of signals || []) {
    if (cls && !cls.has(sig.type)) continue;
    const t = sig.type; perType[t] = perType[t] || { filled: 0, pending: 0 };
    if (sig.void) { skipped.void++; continue; }
    // ⛔⛔ B2 轮：done 判据加 openGap !== undefined —— 旧版 nd（无开盘价三件套）不算完成，
    //    放它重新进计划重算一次补齐；只判 nextPct 会把存量永久钉在旧口径上。
    if (sig.nd && typeof sig.nd.nextPct === 'number' && sig.nd.openGap !== undefined) { skipped.done++; perType[t].filled++; continue; }
    perType[t].pending++;
    // 历史回测那批本来就是次日口径，直接认作 nd（服务器 resolveSignals 同款）
    if (!sig.nd && sig.resolved && sig.resolved.mode === '历史回测') {
      actions.push({ sig, nd: {
        date: norm(sig.resolved.date), mode: '次日', nextPct: sig.resolved.nextPct,
        maxGain: sig.resolved.maxGain, limitUp: sig.resolved.limitUp, hit: sig.resolved.hit
      }, src: 'hist' });
      skipped.histDirect++;
      continue;
    }
    const d0 = norm(sig.date);
    let rows = rowsOf(sig.code);
    let src = 'cache';
    if (!resolvable(rows, d0) && fetchRows && onlineUsed < onlineLimit) {
      if (latestDay && d0 >= latestDay) {
        skipped.onlineSkipNew++;          // 太新（次日还没轮到），线上打了也没有
      } else {
        const orows = await fetchRows(sig.code);
        await sleepFn(ONLINE_GAP_MS);
        if (orows && resolvable(orows, d0)) { rows = orows; src = 'online'; onlineUsed++; }
        else skipped.onlineFail++;
      }
    }
    if (!rows) { skipped.noRows++; continue; }
    const i = rows.findIndex(r => norm(r.date) === d0);
    if (i < 0) { skipped.noSigBar++; continue; }
    if (i + 1 >= rows.length) { skipped.noNextBar++; continue; }
    const nd = computeNd(sig, rows);
    if (!nd) { skipped.sameDate++; continue; }
    actions.push({ sig, nd, src });
  }
  return { actions, skipped, perType, onlineUsed };
}

// ---- 落盘：备份 → 写 → 登记流水 ----
// ⚠️ j 必须是 planBackfill 用的同一个解析对象（actions 里的 sig 是它的元素，按引用匹配）——
//    若在这里重新 readFileSync，新对象与 actions 的 sig 引用不同，byKey.get 永远命中不了。
function applyBackfill(root, statFile, j, actions, meta = {}) {
  if (!actions.length) return { ok: true, wrote: 0, backup: null };
  const bakDir = path.join(root, '.nd_backfill_bak');
  if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
  const ts = new Date();
  const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}_${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
  const backup = path.join(bakDir, `stats_pre_ndfill_${stamp}.json`);
  fs.copyFileSync(statFile, backup);
  const sigs = (j && j.signals) || [];
  const byKey = new Map(actions.map(a => [a.sig, a.nd]));
  let wrote = 0;
  for (const s of sigs) {
    const nd = byKey.get(s);
    if (nd) { s.nd = nd; wrote++; }
  }
  const tmp = statFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(j));
  fs.renameSync(tmp, statFile);
  const opsFile = path.join(root, '.nd_backfill_ops.json');
  let ops = [];
  try { ops = JSON.parse(fs.readFileSync(opsFile, 'utf8')); if (!Array.isArray(ops)) ops = []; } catch (e) { ops = []; }
  ops.push({ ts: ts.toISOString(), wrote, backup: path.join('.nd_backfill_bak', path.basename(backup)), ...meta });
  fs.writeFileSync(opsFile, JSON.stringify(ops.slice(-100), null, 2));
  return { ok: true, wrote, backup: path.join('.nd_backfill_bak', path.basename(backup)) };
}

// ---- CLI ----
async function main(argv) {
  const root = __dirname;
  const write = argv.includes('--write') || argv.includes('--apply');
  const online = argv.includes('--online');
  const all = argv.includes('--all');
  const pos = argv.filter(a => !a.startsWith('--'));
  const statFile = path.resolve(pos[0] || path.join(root, 'stats.json'));
  const cacheDir = pos[1] ? path.resolve(pos[1]) : path.join(root, '.kline_cache');

  const j = JSON.parse(fs.readFileSync(statFile, 'utf8'));
  const signals = j.signals || [];

  let fetchRows = null, base = '', token = '';
  if (online) {
    let cfg = {};
    try { cfg = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8')); } catch (e) {}
    const up = cfg.syncUpstream || {};
    base = up.url || ''; token = up.token || '';
    if (!base || !token) {
      console.error('[nd-fill] --online 需要 config.json 的 syncUpstream.url + token，未配置，终止（不会写任何文件）');
      process.exit(2);
    }
    fetchRows = code => onlineKline(base, token, code);
  }

  // 已知最新交易日（breadth.json 最大键）——线上兜底只打"次日理应已存在"的老信号
  let latestDay = '';
  try {
    const br = JSON.parse(fs.readFileSync(path.join(root, 'breadth.json'), 'utf8'));
    latestDay = Object.keys(br).map(k => norm(k)).filter(k => /^\d{8}$/.test(k)).sort().pop() || '';
  } catch (e) {}

  const plan = await planBackfill({
    signals,
    rowsOf: makeCacheRows(cacheDir),
    fetchRows,
    latestDay,
    // ⛔ 必须原样透传：all ? null : BACKTEST_CLASSES。以前写 `types || undefined` 把 null
    //    转成 undefined → 触发 planBackfill 解构默认值又变回三类 → --all 静默失效。
    types: all ? null : BACKTEST_CLASSES
  });

  const scope = all ? '全类型（对齐服务器）' : '回测三类 auczt/yier/lianban';
  console.log(`# nd 存量回填计划（${online ? '本地缓存 + 线上回拉' : '仅本地缓存'}；范围：${scope}）${write ? ' · --write 落盘' : ' · 干跑不写文件'}`);
  console.log('');
  for (const t of Object.keys(plan.perType)) {
    console.log(`- ${t}: 已回填 ${plan.perType[t].filled} / 待回填 ${plan.perType[t].pending}`);
  }
  console.log(`- 可补：${plan.actions.length} 条（缓存 ${plan.actions.filter(a => a.src === 'cache').length} / 线上 ${plan.actions.filter(a => a.src === 'online').length} / 历史回测直认 ${plan.actions.filter(a => a.src === 'hist').length}）`);
  const s = plan.skipped;
  console.log(`- 跳过：已回填 ${s.done} · void 作废 ${s.void} · 无缓存 ${s.noRows} · 缺信号日K线 ${s.noSigBar}（停牌/数据缺口/节假日，永不可能有） · 次日未到 ${s.noNextBar}（含今日信号，合理） · 同一天已填 ${s.sameDate}${online ? ` · 线上也取不到 ${s.onlineFail} · 太新不打 ${s.onlineSkipNew}` : ''}`);
  if (plan.actions.length) {
    const q = {};
    for (const a of plan.actions) q[a.nd.quality || '(历史直认)'] = (q[a.nd.quality || '(历史直认)'] || 0) + 1;
    console.log(`- 待补条目次日质量分布：${JSON.stringify(q)}`);
    const yzN = plan.actions.filter(a => a.nd && a.nd.oneLine === true).length;
    const oldN = plan.actions.filter(a => a.sig && a.sig.nd && a.sig.nd.openGap === undefined).length;
    console.log(`- 其中次日一字板（开盘即涨停·全天无波动→买不进）${yzN} 条 —— 统计命中时须与普通命中分开看`);
    if (oldN) console.log(`- 其中旧版 nd 升级（原本没有 open/openGap/oneLine，本轮重算补齐）${oldN} 条`);
  }
  if (!write) { console.log(''); console.log('（干跑结束；加 --write 落盘）'); return plan; }
  const r = applyBackfill(root, statFile, j, plan.actions, { mode: online ? 'cache+online' : 'cache', types: all ? 'all' : 'backtest3', skipped: plan.skipped });
  console.log('');
  console.log(`[nd-fill] 已写入 ${r.wrote} 条 nd → ${path.basename(statFile)}；备份 ${r.backup}；流水登记 .nd_backfill_ops.json`);
  // 自相矛盾检查（旧版保留）：次日涨停却未涨够 3%
  const after = JSON.parse(fs.readFileSync(statFile, 'utf8'));
  const asigs = after.signals || [];
  const bad = asigs.filter(x => !x.void && x.nd && x.nd.limitUp && !x.nd.hit).length;
  // B2 轮新增：一字板买不进，但「一字板却未判涨停」是跨字段矛盾（isOneLineBoard 内部就要求
  //   isLimitUp，正常恒为 0；一旦有人改判据让它俩分叉，这里立刻曝光）。同时把一字板总量
  //   打出来 —— 这个数决定将来校准要不要把"买不进"的样本剔出去（先看覆盖率再决定）。
  const yzAll = asigs.filter(x => !x.void && x.nd && x.nd.oneLine === true).length;
  const badYz = asigs.filter(x => !x.void && x.nd && x.nd.oneLine === true && !x.nd.limitUp).length;
  const withNd = asigs.filter(x => !x.void && x.nd && typeof x.nd.nextPct === 'number').length;
  const withNew = asigs.filter(x => !x.void && x.nd && x.nd.openGap !== undefined).length;
  console.log(`[nd-fill] 存量 ${asigs.length} 条，现已有 nd ${withNd} 条（其中新版三件套 ${withNew} 条）；自相矛盾（涨停却未涨够3%）${bad} 条 ${bad === 0 ? '✅' : '❌'}；次日一字板（买不进）${yzAll} 条，「一字板却未判涨停」${badYz} 条 ${badYz === 0 ? '✅' : '❌'}`);
  return plan;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => process.exit(0)).catch(e => { console.error('[nd-fill] 失败:', e && e.message); process.exit(1); });
}

module.exports = { computeNd, planBackfill, applyBackfill, makeCacheRows, onlineKline, BACKTEST_CLASSES, HIT_THR };
