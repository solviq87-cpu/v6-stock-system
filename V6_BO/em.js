// 东方财富公开接口客户端 + 腾讯行情接口（均免费公开）
const https = require('https');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function get(url, timeout = 10000) {
  return throttledGet(url, timeout);
}

const delay = ms => new Promise(r => setTimeout(r, ms));

// ---------- 并发限流队列：最多6路并发、起始间隔≥250ms，失败自动退避重试 ----------
let blockedUntil = 0; // 触发限流后的冷却期
// 2026-10-27 自检补漏：东财限流退避原本完全静默，无法判断"是否频繁触发"。加计数+由通转断日志。
let _emRateTriggers = 0;
let _emRateLastAt = 0;
let active = 0;
const MAX_ACTIVE = 6;
const waiters = [];
let lastStart = 0;

function acquireSlot() {
  if (active < MAX_ACTIVE) { active++; return Promise.resolve(); }
  return new Promise(r => waiters.push(r));
}
function releaseSlot() {
  active--;
  const w = waiters.shift();
  if (w) { active++; w(); }
}

function throttledGet(url, timeout) {
  const run = async () => {
    const now = Date.now();
    if (now < blockedUntil) await delay(blockedUntil - now);
    await acquireSlot();
    const gap = 250 - (Date.now() - lastStart);
    if (gap > 0) await delay(gap);
    lastStart = Date.now();
    try {
      return await rawGet(url, timeout);
    } finally {
      releaseSlot();
    }
  };
  return run();
}

// fw 轮：网络错误分类 —— 限流(rate)与瞬时出网(egress)分开处置。
//   限流才走全局冷却(blockedUntil)，避免把 IP 打封；瞬时出网（云端抖动）走快速重试+抖动，
//   不触发全局冷却（否则几十页并发请求被串行拖死）；其它（坏 json 等）立即抛，不重试。
function classifyNetErr(msg) {
  if (/rate|限流/i.test(msg)) return 'rate';
  if (/hang up|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket/i.test(msg)) return 'egress';
  return 'other';
}
// ⛔ 东财数字子域名轮换（2026-10-30，用户「大单流入全部不推送了」根因修复）：
//    push2 主域在本机/部分网络环境被拉黑的表现是**空响应**（doGet 解析空串 → bad json），
//    bad json 原分类为 other=不重试不换源 → 整个东财链一击即溃 → 行情快照 fallback 腾讯
//    （无主力净流入字段，mainInflow 硬置 0）→ 大单/冲板/竞价资金类模块全灭。
//    实测同路径 https://72.push2.eastmoney.com 正常返回数据（主域空响应）——
//    黑名单只封部分域名/IP，数字子域名仍通。轮换策略：主域 3 次失败（含 bad json）→ 换 72 → 82 → 92。
//    只对 push2 主域轮换（实测验证过）；非东财 URL 与 push2his/push2ex 行为完全不变。
const EM_HOST_CHAIN = ['push2.eastmoney.com', '72.push2.eastmoney.com', '82.push2.eastmoney.com', '92.push2.eastmoney.com'];
function emHostChainFor(url) {
  try {
    if (new URL(url).host === 'push2.eastmoney.com') return EM_HOST_CHAIN;
  } catch (_) {}
  return null;
}

async function rawGet(url, timeout) {
  const hosts = emHostChainFor(url);
  const rounds = hosts ? hosts.length : 1;
  let lastErr = null;
  for (let h = 0; h < rounds; h++) {
    // h=0 用原 URL；h>0 把主域替换成数字子域名（同路径同参数，只换 host）
    const tryUrl = (hosts && h > 0) ? url.replace('https://' + hosts[0], 'https://' + hosts[h]) : url;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await doGet(tryUrl, timeout);
      } catch (e) {
        lastErr = e;
        const msg = String(e && e.message);
        const kind = classifyNetErr(msg);
        // 东财轮换语境下 bad json（空响应=域名被拉黑的特征）按 egress 处置：重试并允许换 host
        const rotatable = hosts && /bad json/.test(msg);
        if (kind === 'rate') {
          const wasBlocked = Date.now() < blockedUntil;   // 只在「由通转断」这一刻打日志，避免每页刷屏
          blockedUntil = Date.now() + 8000 * (attempt + 1); // 退避 8s/16s/24s
          _emRateTriggers++;
          _emRateLastAt = Date.now();
          if (!wasBlocked) console.warn(`[em] 东财限流退避触发（本次运行累计 ${_emRateTriggers} 次，冷却 ${8 * (attempt + 1)}s）`);
          if (attempt === 2) break;   // 本 host 3 次用完 → 换下一个 host（原逻辑是直接 throw）
          await delay(1000);
        } else if (kind === 'egress' || rotatable) {
          if (attempt === 2) break;   // 本 host 3 次用完 → 换下一个 host
          const jitter = Math.floor(Math.random() * 300);
          await delay(300 * (attempt + 1) + jitter); // 快速重试 + 抖动，不触发全局冷却
        } else throw e;
      }
    }
  }
  throw lastErr || new Error('all hosts failed ' + url.slice(0, 60));
}

// 🔴 关键：Node 19+ 的 https.globalAgent 默认 keepAlive:true + LIFO 调度，
//    会优先复用「最近用过的」socket。东财 CDN 会关掉空闲长连接，复用到已关闭的
//    socket 就直接 socket hang up —— 实测交易时段约一半请求栽在这上面。
//    显式禁用 keep-alive，每次新建连接，断连率显著下降。
const EM_AGENT = new https.Agent({ keepAlive: false, maxSockets: 64, family: 4 });

function doGet(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      family: 4, // 关键：东财接口 IPv6 会挂起，强制 IPv4
      agent: EM_AGENT,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://quote.eastmoney.com/',
        'Connection': 'close'
      },
      timeout
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          // 东财部分接口返回 jsonp，去壳
          const m = text.match(/^\w*\((.*)\);?\s*$/s);
          resolve(JSON.parse(m ? m[1] : text));
        } catch (e) {
          reject(new Error('bad json from ' + url.slice(0, 80)));
        }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + url.slice(0, 80))); });
    req.on('error', reject);
  });
}

// 并发受限的批量执行
async function pool(items, worker, limit = 6) {
  const ret = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      for (let t = 0; t < 2; t++) {
        try { ret[idx] = await worker(items[idx], idx); break; }
        catch (e) { if (t === 1) ret[idx] = null; else await delay(500); }
      }
    }
  }));
  return ret;
}

// ── 并发请求合并（inflight dedup）────────────────────────────────────────────
// 2026-10-06 修（新角度：异步竞态 / 同一份数据被重复打）。
//   全项目有 9 处 fetchKline、3 处 ensureSectorStocks（**全是裸调用不 await**，天然并发）、
//   2 处 ensureStockBoards，多个定时器在同一秒里要【同一份数据】是常态：
//     · 补涨龙 / 启动前埋伏 / 新闻关联 会拉同一个板块的成分股
//     · 大单扫描 与 板块刷新 会补同一批票的题材
//     · 回验 / 打分 / 模拟盘 会要同一只票的 K 线
//   而 em.js 里**没有任何请求合并** → N 路同时要就是 N 次网络，全部计入同一条限流计数。
//   ax 那轮刚给 fetchBoardStocks 加了退避（实测它被自己打封了一整天，补涨龙/启动前埋伏
//   整栏 0 输出），但退避只治「失败后继续猛打」，治不了「同一份数据被重复打」——
//   后者才是请求量的大头，也是把 IP 打封的主要推力。
// 做法：同一个 key 的并发请求复用同一个 Promise，落地（成功或失败）即注销。
//   ⚠️ 必须在 finally 里注销：失败时不注销会让这个 key 永久占着，之后所有请求都复用
//      一个已经 reject 的 Promise → 这只票/这个板块被永久判死，比重复请求严重得多。
//   ⚠️ 只合并「入参完全相同」的请求：days 不同就是不同的数据，不能混。
const _inflight = new Map();
function dedup(key, fn) {
  const hit = _inflight.get(key);
  if (hit) return hit;
  const p = (async () => { try { return await fn(); } finally { _inflight.delete(key); } })();
  _inflight.set(key, p);
  return p;
}
const inflightSize = () => _inflight.size;   // 供测试/面板观测并发去重效果

const EM = 'https://push2.eastmoney.com';
const EMH = 'https://push2his.eastmoney.com';
const EMX = 'https://push2ex.eastmoney.com';

// 🔴 实测（2026-09-28 交易时段）：东财 push2/clist 在开盘期间约 50% 随机重置连接（socket hang up），
//    且与请求频率无关（间隔加到 300ms/8s 反而失败更多），是服务端侧的不稳定，不是 IP 限流。
//    旧逻辑「任一分页失败 → 整轮抛错 → 降级新浪」因此极度脆弱：新浪备用源在集合竞价期间
//    price/open 全是 0，一降级竞价统计就整个变空。
//    新逻辑三原则：① 部分成功即采用（拿到多少用多少） ② 每页独立重试 ③ 实在不够用腾讯批量补价。
const UNIVERSE_CACHE = path.join(__dirname, '.universe_cache.json');
const FULL_MIN_OK = 4000;   // 达到这个条数才认为全量拉取成功（⛔ 实测新浪 hs_a 全量=4600只含北交所；东财盘中部分页仅~2900~3200，必须高于此阈值才接受，否则会被部分页误当全集）
const FULL_MIN_USE = 800;   // 低于这个条数才认为彻底失败

async function fetchAllStocks() {
  // ⛔ 2026-10-09 修（用户第4次投诉"市场温度只有2900只"）：
  //    根因 = 东财全A分页盘中约50%随机断连，只拿到~29页≈3190只，而旧代码 FULL_MIN_OK=2500
  //    把这份【部分页】当"全量"接受并写进 universe → 全市场广度永远只有~2900~3200只。
  //    修法：① 新浪 hs_a（沪深A+北交所全集，交易时段稳定、不受东财随机断连影响）改为【首选】全量源；
  //          ② FULL_MIN_OK 提到 4800，东财部分页不再被误判为全量；
  //          ③ 东财降为兜底，腾讯补价兜底。
  //    数据准确性：新浪 HQ 为实时行情标准源，pct/现价/流通市值均准确；北交所(8/4/92)一并纳入（全量）。
  // ① 首选：新浪全A（含北交所，全量、稳定）
  try {
    const s = await fetchAllStocksSina();
    if (s && s.length >= FULL_MIN_OK) { saveUniverse(s.map(x => x.code)); return s; }
    if (s && s.length) console.error('[em] 新浪全A仅 ' + s.length + ' 只（不足' + FULL_MIN_OK + '），转东财兜底');
  } catch (e) { console.error('[em] 新浪全A异常，转东财:', e && e.message); }

  // ② 兜底：东财全量分页（受随机断连影响，可能不全）
  let best = [], lastErr = null;
  for (let round = 0; round < 2; round++) {
    try {
      const r = await fetchAllStocksEM();
      if (r && r.length >= FULL_MIN_OK) { saveUniverse(r.map(x => x.code)); return r; }
      if (r && r.length > best.length) best = r;
    } catch (e) { lastErr = e; }
    if (round === 0) await delay(1000);
  }
  // ③ 东财不全 → 用缓存全集 + 腾讯批量快照补价（腾讯 qt.gtimg.cn 60只一批，交易时段稳定得多）
  if (best.length || fs.existsSync(UNIVERSE_CACHE)) {
    try {
      const filled = await fetchAllStocksTx(best);
      if (filled && filled.length >= FULL_MIN_OK) return filled;
      if (filled && filled.length > best.length) best = filled;
    } catch (e) { console.error('[em] 腾讯补价失败:', e.message); }
  }
  if (best.length >= FULL_MIN_USE) { console.error('[em] 全A仅取到 ' + best.length + ' 只，降级使用'); return best; }
  console.error('[em] 全A全渠道失败:', lastErr ? lastErr.message : '样本不足');
  return best;
}

// ⛔ 铁律③ 落盘失败不许静默（2026-10-28 数据源轮）：.universe_cache.json 是「全A代码全集」的唯一落盘，
//    东财分页不全时 ③「缓存全集 + 腾讯批量补价」这条兜底链**完全依赖它** —— 写失败会让兜底静默失效，
//    表现为全A快照只剩部分票（历史上"市场温度只有2900只"就是这类断链），却没有任何日志能说明为什么。
//    调用频率极低（每次全量刷新成功仅 1 次，非逐票循环），故直接留痕、无需限频。
function saveUniverse(codes) {
  try { fs.writeFileSync(UNIVERSE_CACHE, JSON.stringify(codes)); }
  catch (e) { console.error('[em] ⛔ 全A全集缓存写盘失败（东财不全时的补价兜底链将失效）:', (e && e.message) || e); }
}
function loadUniverse() {
  try {
    if (!fs.existsSync(UNIVERSE_CACHE)) return [];   // 首次启动尚无缓存——正常状态，不打日志免噪音
    const a = JSON.parse(fs.readFileSync(UNIVERSE_CACHE, 'utf8'));
    return Array.isArray(a) ? a : [];
  } catch (e) {
    console.error('[em] ⛔ 全A全集缓存损坏/读取失败（东财不全时的补价兜底链将失效）:', (e && e.message) || e);
    return [];
  }
}

const EM_PAGE_URL = pn => `${EM}/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f20` +
  `&fs=m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23` +
  `&fields=f12,f14,f2,f3,f5,f6,f8,f15,f16,f17,f18,f20,f21,f22,f26,f62,f184`;
const EM_PAGES = 60;

// ① 并发抢页：交易时段东财约 50% 随机断连，串行 56 页要 30 秒以上；
//    先 5 路并发把大部分页拿到，再串行补漏 —— 部分成功即采用，绝不整轮作废。
async function fetchAllStocksEM() {
  const CONC = 5;
  const T0 = Date.now();
  const BUDGET = 30000;                       // 总时间预算：宁可少几页也不拖到网关 504
  const left = () => BUDGET - (Date.now() - T0);
  const pages = new Array(EM_PAGES).fill(null);
  let total = 0, cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= EM_PAGES || left() < 2000) return;
      try {
        const j = await getPaged(EM_PAGE_URL(i + 1), 5000, 2);
        if (j && j.data && j.data.diff && j.data.diff.length) {
          pages[i] = j.data.diff;
          if (j.data.total) total = Math.max(total, j.data.total);
        }
      } catch {}
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  // ② 串行补漏（最多 2 轮，只补真正需要的页，超预算就收工）
  for (let round = 0; round < 2 && left() > 2000; round++) {
    const needPages = total ? Math.min(EM_PAGES, Math.ceil(total / 100)) : EM_PAGES;
    const miss = [];
    for (let i = 0; i < needPages; i++) if (!pages[i]) miss.push(i);
    if (!miss.length) break;
    for (const i of miss) {
      if (left() < 1500) break;
      try {
        const j = await getPaged(EM_PAGE_URL(i + 1), 6000, 3);
        if (j && j.data && j.data.diff && j.data.diff.length) {
          pages[i] = j.data.diff;
          if (j.data.total) total = Math.max(total, j.data.total);
        }
      } catch {}
      await delay(60);
    }
  }
  const out = [];
  for (const p of pages) if (p) out.push(...p);
  const rows = out.map(normalizeStock);
  console.error('[em] 东财全A分页：拿到 ' + rows.length + '/' + (total || '?') + ' 条');
  if (rows.length >= FULL_MIN_OK) saveUniverse(rows.map(x => x.code));
  return rows;
}

// 分页专用请求：不走全局 blockedUntil（8s/16s/24s 退避会把几十页拖到几分钟）
async function getPaged(url, timeout = 9000, attempts = 3) {
  let last = null;
  for (let att = 0; att < attempts; att++) {
    try { return await doGet(url, timeout); }
    catch (e) { last = e; if (att < attempts - 1) await delay(120 + att * 120); }
  }
  throw last;
}

// 腾讯批量快照补价：拿东财已到手的代码 + 磁盘缓存的全集，向腾讯取整场行情
async function fetchAllStocksTx(base) {
  let codes = (base || []).map(x => x.code).filter(Boolean);
  if (codes.length < FULL_MIN_OK) {
    const cached = loadUniverse();
    if (cached.length > codes.length) codes = cached;
  }
  if (codes.length < 1000) return [];
  const rows = await fetchBatchSnapshotTx(codes.slice(0, 6000));
  if (!rows || !rows.length) return [];
  // 腾讯没有主力净流入，用东财已到手的数据补回去
  const emMap = new Map();
  for (const x of (base || [])) emMap.set(x.code, x);
  return rows.map(r => {
    const e = emMap.get(r.code);
    if (!e) return r;
    const toObservedNumber = v => {
      if (v === null || v === undefined) return null;
      if (typeof v === 'string' && v.trim() === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return {
      ...r,
      mainInflow: toObservedNumber(e.mainInflow),
      mainPct: toObservedNumber(e.mainPct),
      fundsSource: e.fundsSource || null, fundsMethod: e.fundsMethod || null,
      fundsRetrievedAt: e.fundsRetrievedAt ?? null, fundsSourceTimestamp: e.fundsSourceTimestamp ?? null,
      listedDate: Number.isFinite(Number(e.listedDate)) ? Number(e.listedDate) : 0
    };
  });
}

function normalizeStock(d) {
  return {
    code: d.f12, name: d.f14,
    price: d.f2, pct: d.f3,           // 现价 / 涨跌幅%
    volume: d.f5, amount: d.f6,       // 成交量(手) / 成交额
    turnover: d.f8,                   // 换手率%
    high: d.f15, low: d.f16, open: d.f17, preClose: d.f18,
    mktcap: d.f20, floatCap: d.f21,   // 总市值/流通市值
    speed: d.f22,                     // 涨速
    listedDate: d.f26,                // 上市日期 yyyymmdd
    mainInflow: observedFlowNumber(d.f62), mainPct: observedFlowNumber(d.f184),
    fundsSource: 'eastmoney', fundsMethod: 'vendor-order-size-estimate',
    fundsRetrievedAt: Date.now(), fundsSourceTimestamp: null // 接收时刻不是原报价时刻
  };
}

// Vendor order-size estimates are not investor identities. Missing values stay unknown.
function observedFlowNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function observedFlowCount(value) {
  const number = observedFlowNumber(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}
function flowProvenance(retrievedAt) {
  return { source: 'eastmoney', upstream: 'eastmoney',
    fundsMethod: 'vendor-order-size-estimate', retrievedAt, sourceTimestamp: null };
}

// 板块资金流。t:2 行业板块, t:3 概念板块
async function fetchSectorFlow(type) {
  const u = `${EM}/api/qt/clist/get?pn=1&pz=500&po=1&np=1&fltt=2&invt=2&fid=f62` +
    `&fs=m:90+t:${type}` +
    `&fields=f12,f14,f2,f3,f62,f66,f72,f104,f105,f128,f136,f140,f141`;
  const j = await get(u);
  if (!j.data || !j.data.diff) return [];
  const retrievedAt = Date.now();
  return j.data.diff.map(d => {
    const upCount = observedFlowCount(d.f104), downCount = observedFlowCount(d.f105);
    return {
      code: d.f12, name: d.f14, pct: observedFlowNumber(d.f3),
      mainInflow: observedFlowNumber(d.f62), superInflow: observedFlowNumber(d.f66),
      bigInflow: observedFlowNumber(d.f72), upCount, downCount,
      // f105 is declining stocks, not total membership; flat/unquoted members are unknown.
      observedDirectionalCount: upCount !== null && downCount !== null ? upCount + downCount : null,
      totalCount: null,
      leader: d.f128, leaderCode: d.f140, leaderPct: observedFlowNumber(d.f136),
      ...flowProvenance(retrievedAt)
    };
  });
}

// 板块成分股（东财行业/概念板块 fs=b:BK代码）：补涨龙候选池来源
// 注：新浪板块仅49个大类，与东财细分板块名对不上，故补涨龙改走东财成分股（自带主力资金）
// ⚠️ 2026-09-29 实测：push2/clist 在某些网络环境下 Node 通道会连续 socket hang up
//    （代理人 refund 时东财侧直接断连，重试 3 次全挂），一旦挂掉，
//    依赖它的「补涨龙」和「板块效应·启动前埋伏」两个模块整天零输出 ——
//    这正是"今天涨停的你没有在涨停前就发现"的直接原因之一。
//    现在 Node 失败后自动走 curl 子进程（与 fflow 接口同款策略），两条路都不通才认输。
// ⛔ 板块成分股接口限流退避（2026-10-06 修）
// 背景（线上实测）：补涨龙一轮拉 8 个板块、启动前埋伏 6 个、新闻板块十几个，
//   每 8 分钟一轮 → 东财一旦开始限流，这里**没有任何退避**，照旧每轮猛打十几个请求，
//   等于自己把 IP 往死里封：限流 → 继续打 → 封得更久 → 两个模块整天零输出
//   （日志里满屏「成分股拉取失败」，面板上补涨龙/启动前埋伏两个栏位一整天是空的）。
//   竞价那路早就有 EM_BACKOFF，唯独这路漏了 —— 同一个数据源，待遇必须一致。
// 现在：连续失败就整体退避（阶梯 30s→60s→…→封顶 300s），期间直接快速失败不打网络，
//   恢复后自动回到正常频率。宁可这段时间栏目空着，也不能把数据源打封一整天。
const BOARD_BACKOFF = { fail: 0, until: 0 };
const boardBackoffLeft = () => Math.max(0, BOARD_BACKOFF.until - Date.now());
// ── 本地缓存反查兜底（2026-10-28 数据源轮，用户「有问题就修」）──────────────
// 根因：fetchBoardStocks 的「两条通道」（Node get / curl 子进程）都打同一个 push2.eastmoney.com，
//   host 一挂就全挂 —— 违反多源铁律「≥2 备选源链」。2026-10-28 实测 push2 整域拒连（http=000），
//   补涨龙/启动前埋伏双双 0 条（功能损伤实锤）。
// 兜底：stockBoards.json 是此前成功从东财拉取的「个股→板块归属」落盘（2314 只，随包发布、重启不丢），
//   反转即得板块→成分股。实测 BK0567（股权激励）可反查 91 只。名称从 stocks_snapshot.json 补。
// ⛔ 判不出不硬判：价格/资金字段留 null（不填 0），标注 stale:true 由调用方决定是否采用。
// ⛔ 只做兜底不做主源：东财可达时永远优先走实时数据。
function _boardMembersFromLocalCache(bkCode, num) {
  try {
    const f = path.join(__dirname, 'stockBoards.json');
    const arr = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(arr) || !arr.length) return [];
    let nameMap = {};
    try {
      const sf = path.join(__dirname, 'stocks_snapshot.json');
      const sj = JSON.parse(fs.readFileSync(sf, 'utf8'));
      for (const r of (sj.rows || [])) { if (r.code && r.name) nameMap[r.code] = r.name; }
    } catch { /* 名称拿不到就留空，不拦 */ }
    const out = [];
    for (const entry of arr) {
      const code = Array.isArray(entry) ? entry[0] : null;
      const data = Array.isArray(entry) ? entry[1] : null;
      if (!code || !data) continue;
      const boards = data.boards || [];
      if (boards.some(b => b && b.code === bkCode)) {
        out.push({ code, name: nameMap[code] || '', price: null, pct: null, amount: null, turnover: null, mainInflow: null, mainPct: null, stale: true });
        if (out.length >= num) break;
      }
    }
    return out;
  } catch { return []; }
}
async function fetchBoardStocks(bkCode, num = 50) {
  return dedup(`b:${bkCode}:${num}`, () => _fetchBoardStocksCore(bkCode, num));
}
async function _fetchBoardStocksCore(bkCode, num = 50) {
  if (boardBackoffLeft() > 0) {
    throw new Error(`board 退避中（${Math.round(boardBackoffLeft() / 1000)}s）`);
  }
  const u = `${EM}/api/qt/clist/get?pn=1&pz=${num}&po=1&np=1&fltt=2&invt=2&fid=f3` +
    `&fs=b:${bkCode}&fields=f12,f14,f2,f3,f6,f8,f62,f184`;
  const parse = j => {
    if (!j || !j.data || !j.data.diff) return [];
    return j.data.diff.map(d => ({
      code: d.f12, name: d.f14, price: d.f2, pct: d.f3,
      amount: d.f6, turnover: d.f8, mainInflow: d.f62, mainPct: d.f184
    }));
  };
  let gotResp = false;
  try {
    const j = await get(u);
    if (j) gotResp = true;
    const r = parse(j);
    if (r.length) { BOARD_BACKOFF.fail = 0; BOARD_BACKOFF.until = 0; return r; }
  } catch {}
  try {
    const j = await curlGet(u, 10000);
    if (j) gotResp = true;
    const r = parse(j);
    if (r.length) { BOARD_BACKOFF.fail = 0; BOARD_BACKOFF.until = 0; return r; }
  } catch {}
  // 东财两条传输都拿不到 → 本地缓存反查兜底（stockBoards.json 反转，随包落盘、重启不丢）
  const cached = _boardMembersFromLocalCache(bkCode, num);
  if (cached && cached.length) {
    _srcWarn(`board-cache:${bkCode}`, `东财成分股${gotResp ? '返回空' : '不可达'}，本地缓存反查兜底 ${cached.length} 只（stale）`);
    return cached;
  }
  // 全部源链都拿不到 → 记一次失败并退避；阶梯退避，封顶 5 分钟
  BOARD_BACKOFF.fail++;
  BOARD_BACKOFF.until = Date.now() + Math.min(BOARD_BACKOFF.fail * 30, 300) * 1000;
  console.log(`[board] ${bkCode} 全部源链失败（东财×2+本地缓存，连续${BOARD_BACKOFF.fail}次），退避 ${Math.round((BOARD_BACKOFF.until - Date.now()) / 1000)}s 后再试`);
  throw new Error('board ' + bkCode + ' 成分股全部源链失败');
}

// ── 数据源「静默失败」统一留痕（铁律③：兜底不许静默 / 判出不硬判）──────────────
// 多条源链共用：每个 tag 独立 60 秒限频 + 累计计数。
//   限频是必须的——这些源链多在全A循环/高频轮询里被调用，不限频会刷出几千行同款
//   日志，反而把真正的报错淹没（沿用 _emKlineBad「由通转断才打日志」的既有做法）。
// ⛔ 只加日志，不改任何返回语义：该返回 [] 仍返回 []、该返回 null 仍返回 null、
//   该返回 '' 仍返回 ''，绝不因为留痕就改成填 0 / 填假数据。留痕的目的是让下游能
//   区分「确实没有」与「拉不到」，而不是替下游做判断。
const _srcWarnT = Object.create(null);
function _srcWarn(tag, msg) {
  try {
    const now = Date.now();
    const s = _srcWarnT[tag] || (_srcWarnT[tag] = { n: 0, lastAt: 0 });
    s.n++;
    if (now - s.lastAt < 60000) return;
    s.lastAt = now;
    console.warn(`[em] ⚠️ ${tag}（累计 ${s.n} 次）：${msg}`);
  } catch { /* 留痕本身绝不允许影响取数主流程 */ }
}

// 涨停池（含连板数/封单/炸板/行业）— 东财主源，挂了自动切同花顺
//
// ⚠️ 2026-10-02 修：原来这条是东财单源，一旦 EMX 不通就是静默空数组
//    （调用方用 Promise.allSettled 包着，reject 也被吞成 null），
//    直接后果：复盘首行「涨停几只+连板梯队+最高板+主线+封单最强」整天没有，
//    「板块效应/连板梯队/题材归类」三个模块同时零输出。现在补同花顺兜底。
async function fetchZTPool(date) {
  const u = `${EMX}/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt` +
    `&Pageindex=0&pagesize=1000&sort=fbt%3Aasc&date=${date}`;
  const parse = j => {
    if (!j || !j.data || !j.data.pool) return null;
    return j.data.pool.map(d => ({
      code: d.c, name: d.n, price: d.p / 1000, pct: d.zdp,
      // ⛔ turnover 必须兜底：东财快讯偶发缺 hs 字段 → undefined 一路传到复盘里
      //    z.turnover.toFixed(1) 直接抛 TypeError → 整份每日复盘报废、面板停留在昨天那版。
      //    同花顺兜底源写的是 `+x.turnover_rate || 0`（正确），主源这里原来漏了。
      amount: d.amount, floatCap: d.ltsz, turnover: +d.hs || 0,
      limitUpCount: d.lbc,           // 连板数
      sealAmount: d.fund,            // 封单资金(元)
      breakCount: d.zbc,             // 炸板次数
      sector: d.hybk,                // 所属行业
      streak: d.zttj ? d.zttj.days : 1,
      // hj2 轮：首次封板时间（HHMMSS，东财 fbt 字段），供 nextDayLimitProb 封板时间因子。
      //   同花顺兜底源无此字段 → 该处显式置 null（见 fetchZTPoolThs），绝不拿 0 冒充"缺数据"。
      firstSeal: d.fbt != null ? String(d.fbt).padStart(6, '0') : null,
      src: 'em'
    }));
  };
  try {
    const r = parse(await get(u));
    if (r && r.length) return r;
  } catch { }
  // Node 通道被反爬/断连 → curl 子进程（同 fetchBoardStocks 的策略）
  try {
    const r = parse(await curlGet(u, 12000));
    if (r && r.length) return r;
  } catch { }
  // 东财两条路都不通 → 同花顺涨停池
  // ⛔ 铁律③ 兜底不许静默：涨停池是全项目涨跌停计数的唯一权威源（东财封板池 tc）。
  //    三源（东财 Node 通道 → 东财 curl 通道 → 同花顺兜底）全空时返回 [] 本身是诚实的
  //    （不造假），但**原来没有任何一行日志** —— 下游无法区分「今日确实无涨停」与
  //    「三源都拉不到」，会把拉取失败直接当成「今日无涨停」，复盘/选股整片零输出。
  //    2026-10-02 补了同花顺兜底，但兜底也空时的静默没补，这里补齐。
  let t = [];
  try { t = await fetchZTPoolThs(date); } catch (e) {
    _srcWarn('涨停池·同花顺兜底抛错', `东财双通道已不通，同花顺兜底又抛错：${(e && e.message) || e} —— 返回空池，调用方须按「未确认」处理`);
    return [];
  }
  if (t.length) return t;
  _srcWarn('涨停池·三源全空', `东财 EMX 双通道 + 同花顺兜底均无数据（date=${date}）—— 返回空池，调用方须按「未确认」处理，⛔ 不可直接判今日无涨停`);
  return [];
}

// ⛔⛔ 跌停家数权威源（2026-10-29 用户「跌停128的依据是什么」深挖后补）：
//    摘要里的跌停数此前是 marketMood 自算 `pct<=-9.9` 一刀切 —— 20cm/30cm 票跌 9.9%+ 全被
//    误算成跌停（10-29 收盘实证：自算 128 vs 东财权威 tc=43，虚增 85 只/197%）。
//    跌停计数与涨停同一铁律：唯一权威 = 东财封板池 tc（涨停走 getTopicZTPool，跌停走
//    getTopicDTPool，两接口同 host 同 dpt 只是池子不同）。
//    只取 tc（家数）+ qdate（归属日），调用方拿不到（null）必须退回自算近似并显式标注，
//    不许拿 null 冒充 0、也不许静默用自算冒充权威。
async function fetchDTCount(date) {
  const u = `${EMX}/getTopicDTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt` +
    `&Pageindex=0&pagesize=5&sort=fund%3Aasc&date=${date}`;
  const parse = j => (j && j.data && j.data.tc != null) ? { tc: +j.data.tc, qdate: j.data.qdate } : null;
  try { const r = parse(await get(u, 8000)); if (r) return r; } catch { }
  try { const r = parse(await curlGet(u, 12000)); if (r) return r; } catch { }
  _srcWarn('跌停池·双通道全空', `东财 getTopicDTPool 双通道均无数据（date=${date}）—— 返回 null，调用方退回自算近似并须标注，⛔ 不可判今日无跌停`);
  return null;
}

// ⛔ 探测「数据源最新交易日」：返回东财涨停池接口的 qdate（YYYYMMDD 纯数字）。
//    qdate 是接口自己回填的「最新有涨停数据的交易日」，比拿一只基准股 K 线末行日期更贴近
//    涨停池本身，且不依赖 K 线源的健康度（2026-10-19 实证：东财/腾讯 K 线源同时被反爬、
//    同花顺日K延迟 → dataTradeDay 用 K 线探测成 10-16，而本接口 qdate 明确返回 10-19）。
//    探测失败返回空串，调用方必须回退，绝不拿空串冒充「今天」。
async function fetchZTPoolLatestDay() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const today = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  const u = `${EMX}/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt` +
    `&Pageindex=0&pagesize=1&sort=fbt%3Aasc&date=${today}`;
  let j = null;
  try { j = await get(u, 6000); } catch { }
  if (!j || !j.data || !j.data.qdate) { try { j = await curlGet(u, 12000); } catch { } }
  const q = j && j.data && j.data.qdate;
  // ⛔ 铁律③：探测失败返回空串是诚实的（绝不拿空串冒充今天），但原来一行日志都没有。
  //    归属日判不出会让调用方回退到 K 线探测（历史上因此探成 10-16 而实际是 10-19），
  //    不留痕则排查时看不到「回退是因为归属日探测本身挂了」。
  if (!q) _srcWarn('涨停池·归属日探测失败', `东财双通道（Node + curl）均未返回 qdate（today=${today}）—— 返回空串，调用方必须回退，⛔ 绝不拿空串冒充今天`);
  return q ? String(q).replace(/-/g, '') : '';
}

// ⚠️ 同花顺 high_days 是「N天M板」字符串，不是纯连板数：
//      "首板"  = 1          "2天2板" = 连续2板
//      "4天2板" = 4天里2个板（中间断过，不能当连板2用）
//    → 连板数取 M，另存 streakDays=N 与 cont(是否连续)，调用方要分清。
function thsHighDays(s) {
  s = String(s || '').trim();
  if (!s || s === '首板') return { lbc: 1, days: 1, cont: true };
  let m = /(\d+)天(\d+)板/.exec(s);
  if (m) return { lbc: +m[2], days: +m[1], cont: +m[1] === +m[2] };
  m = /(\d+)板/.exec(s);
  if (m) return { lbc: +m[1], days: +m[1], cont: true };
  return { lbc: 1, days: 1, cont: true };
}

// 同花顺涨停池兜底（数据口径与东财有差异，标注 src='ths' 让调用方知道）
// 2026-10-02 实测 52/52：字段 code/name/latest(现价)/change_rate(涨跌幅)/
//   order_amount(封单额)/turnover_rate(换手%)/currency_value(流通市值)/reason_type(题材)/open_num(炸板)
// ⚠️ 两个已知差异，别当成东财数据用：
//   1) 没有成交额字段 → amount 用「流通市值 × 换手率」推算（600131 推算 4.14 亿，与量价自洽）
//   2) 没有行业字段 hybk → sector 留空，交给 server.js 的 secOfStock 四层归属去补
//   3) filter=HS,GEM2STAR 不含北交所 → 兜底时会少北交所的涨停票（东财源是全 A）
async function fetchZTPoolThs(date) {
  const d = String(date || '').replace(/-/g, '');
  if (!d) return [];
  const out = [];
  for (let page = 1; page <= 5; page++) {
    const u = 'https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool?page=' + page +
      '&limit=100&field=199112,10,9001,330324,133971,133970,1968584,3475914,9002,330329' +
      '&filter=HS,GEM2STAR&order_field=330324&order_type=0&date=' + d;
    let j = null;
    // ⛔ 铁律③：原 catch { break; } 静默跳过 —— 同花顺整条兜底链挂了也一行日志没有，
    //    外层只看到空数组，分不清「同花顺也没涨停」还是「同花顺接口挂了」。
    try { j = await curlGet(u, 15000, 'https://data.10jqka.com.cn/'); } catch (e) {
      _srcWarn('涨停池·同花顺兜底拉取失败', `第 ${page} 页请求失败：${(e && e.message) || e}`);
      break;
    }
    const info = j && j.data && j.data.info;
    if (!Array.isArray(info) || !info.length) {
      if (page === 1) _srcWarn('涨停池·同花顺兜底无数据', `第 1 页即返回空（date=${d}）—— 可能当日确实无涨停，也可能接口改版/反爬，需人工核对`);
      break;
    }
    for (const x of info) {
      const code = String(x.code || '').trim();
      if (!code) continue;
      const hd = thsHighDays(x.high_days);
      out.push({
        code, name: String(x.name || '').trim(),
        price: +(x.latest || 0), pct: +(x.change_rate || 0),
        amount: Math.round((+x.currency_value || 0) * (+x.turnover_rate || 0) / 100),
        floatCap: +x.currency_value || 0, turnover: +x.turnover_rate || 0,
        limitUpCount: hd.lbc, streak: hd.days, streakCont: hd.cont,
        sealAmount: +x.order_amount || 0,
        breakCount: +x.open_num || 0,
        sector: '',
        // hj2 轮：同花顺兜底源无首次封板时间字段（无 fbt）→ 显式置 null，让 nextDayLimitProb 落中性档不判。
        firstSeal: null,
        reason: String(x.reason_type || '').trim(),
        src: 'ths'
      });
    }
    if (info.length < 100) break;
  }
  if (out.length) console.warn(`[em] 涨停池走同花顺兜底 ${out.length} 只（东财 EMX 不可用）`);
  return out;
}

// ---------------- 龙虎榜（东财）+ 涨停原因（同花顺）----------------
// 2026-10-01 逐条 curl 亲验（不是猜的）：
//   · 同花顺【没有】龙虎榜：/dataapi/lhb/{lhb_list,lhb_detail,lhb_stock,ggzjl} 全 404
//   · 东财龙虎榜可用：RPT_DAILYBILLBOARD_DETAILSNEW（榜单）+ RPT_BILLBOARD_DAILYDETAILSBUY（买出席位）
//   · 同花顺涨停池带 reason_type（涨停原因/题材），9/30 实测 52/52 全有
// ⚠️ 龙虎榜是【收盘后】才公布（通常 18:00 后），盘中拿不到 —— 只能用于次日作战计划，
//    绝不能拿它给当日实时推送做判据（否则看到的是昨天的数据）。
//
// 知名游资席位关键词（公开信息，会过时）。
// ⚠️ 名录只作辅助判据：主判据是【净买额 + 该席位3日上涨概率】的量化组合，
//    名录失效也不会整体判错，只是少一条佐证。
// ⚠️ 只放【具体路名/营业部专名】，绝不放"XX分公司""XX营业部"这种宽泛词：
//    早期版本放了"上海分公司"，结果中金/中信的上海分公司（机构席位）全被判成游资 ——
//    机构与游资是两回事，跟着机构席位去做游资策略就是张冠李戴。
const WHALE_KEYS = ['桑田路', '溧阳路', '绿景路', '上塘路', '湖滨南路', '太平南路',
  '四季路', '中关村', '蛇口', '后海', '绍兴', '萧山市心', '福州湖东', '厦门湖滨',
  '宁波解放南', '杭州庆春', '深圳益田', '成都蜀金', '解放南', '庆春路', '益田路'];
// ⚠️ 东财拉萨系（团结路/东环路/金珠西路/金融城南）是**散户聚集的人气席位**，不是游资。
//    2026-09-30 实测这几席位的3日上涨概率只有 31%~42%，把它们当"大游资"去跟，
//    等于拿散户跟风冒充主力，与"不喂假数据"直接冲突 → 单列出来，只标注不采信。
const POPULAR_KEYS = ['拉萨', '团结路', '东环路', '金珠西', '金融城南'];
// 非营业部条目：科创板龙虎榜会把 "自然人/机构/中小投资者" 当席位列出，净额动辄几十亿，
// 混进判定会淹没真正的营业部信号 → 一律排除（缺真实席位 ≠ 有游资，绝不拿它凑数）。
const NON_DEPT_RE = /自然人|机构|沪股通|深股通|中小投资者|其他/;
// 判定单个席位是否算"大游资"：要么知名席位且金额够大，要么金额够大且席位胜率高。
// 返回带依据，便于在推送里写清楚"为什么算游资"，而不是丢一个黑盒结论。
function judgeWhale(d) {
  const name = d.name || '';
  const net = +(d.net || 0);
  // ⚠️ 买入席位净额必须为正。实测出现过 -1.08 亿被判成游资（卖出席位混进买入明细），
  //    方向错了就是反指，宁可不判。
  if (net <= 0) return { whale: false, named: false, popular: false, big: false, strong: false, net, reason: '净额非正·不计' };
  if (NON_DEPT_RE.test(name)) return { whale: false, named: false, popular: false, big: false, strong: false, net, reason: '非营业部席位' };
  const popular = POPULAR_KEYS.some(k => name.indexOf(k) >= 0);
  const named = WHALE_KEYS.some(k => name.indexOf(k) >= 0);
  const big = net >= 3e7;                                   // 净买 ≥ 3000万
  // 胜率门槛提到 60%：40% 的胜率低于抛硬币，把它当"可跟随的游资"是自欺欺人
  const strong = d.prob3 != null && +d.prob3 >= 60;         // 该席位近3日上涨概率 ≥60%
  const whale = !popular && ((named && big) || (big && strong));
  return { whale, named, popular, big, strong, net, reason: whale ? '游资席位' : (popular ? '人气席位·非游资' : '未达门槛') };
}
// 东财龙虎榜·买入席位明细。date='YYYY-MM-DD'。返回 Map<code,{depts,netBuy,whale,whaleNames,why}>
async function fetchLhb(date) {
  const out = new Map();
  if (!date) return out;
  const url = n => 'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    '?reportName=RPT_BILLBOARD_DAILYDETAILSBUY&columns=ALL&pageNumber=' + n +
    '&pageSize=500&sortColumns=BUY&sortTypes=-1&filter=(TRADE_DATE%3D%27' + date + '%27)';
  for (let p = 1; p <= 6; p++) {
    const j = await curlGet(url(p), 15000);
    const d = j && j.result && j.result.data;
    if (!d || !d.length) break;
    for (const x of d) {
      const code = String(x.SECURITY_CODE || '').trim();
      if (!code) continue;
      const v = out.get(code) || { depts: [], netBuy: 0 };
      const buy = +(x.BUY || 0), sell = +(x.SELL || 0);
      const net = x.NET != null ? +x.NET : (buy - sell);
      v.depts.push({
        name: String(x.OPERATEDEPT_NAME || '').trim(),
        buy, sell, net,
        prob3: x.RISE_PROBABILITY_3DAY != null ? +x.RISE_PROBABILITY_3DAY : null
      });
      v.netBuy += net;
      out.set(code, v);
    }
    if (d.length < 500) break;
  }
  for (const v of out.values()) {
    // 只留真实营业部，且按净买额降序（买一在前）
    v.depts = v.depts.filter(d => !NON_DEPT_RE.test(d.name || '') && +(d.net || 0) > 0);
    v.depts.sort((a, b) => (b.net || 0) - (a.net || 0));
    v.whaleNames = []; v.popularNames = [];
    let hit = null;                                  // 命中的那个游资席位（名/额/胜率都取自它）
    for (const d of v.depts) {
      const j = judgeWhale(d);
      d.judge = j;
      if (j.whale) { v.whaleNames.push(d.name); if (!hit) hit = d; }
      else if (j.popular && v.popularNames.length < 2) v.popularNames.push(d.name);
    }
    v.whale = !!hit;
    v.whaleNet = hit ? hit.net : 0;
    v.whaleDept = hit ? hit.name : '';
    v.topDept = v.depts[0] ? v.depts[0].name : '';
    // ⚠️ 依据必须取自同一个席位：早期版本拿"命中席位的名"配"买一的额"，
    //    出现「华泰成都蜀金路 净买 -1.08亿」这种名字与数字对不上的假证据。
    const money = x => (x / 1e8).toFixed(2) + '亿';
    if (hit) {
      v.why = '龙虎榜「' + hit.name.slice(0, 18) + '」净买 ' + money(hit.net) +
        (hit.prob3 != null ? '，该席位3日上涨概率 ' + Math.round(hit.prob3) + '%' : '') +
        (hit.judge.named ? '（知名游资席位）' : '（大额且席位胜率高）');
    } else if (v.popularNames.length) {
      v.why = '买一为东财人气席位（' + v.popularNames[0].slice(0, 14) + '，散户聚集·跟随价值低）';
    } else if (v.depts.length) {
      v.why = '龙虎榜无游资席位（买一 ' + v.topDept.slice(0, 16) + ' 净买 ' + money(v.depts[0].net) +
        (v.depts[0].prob3 != null ? '，3日上涨概率 ' + Math.round(v.depts[0].prob3) + '%' : '') + '）';
    } else v.why = '上了龙虎榜但无营业部净买入';
  }
  return out;
}
// 同花顺涨停池：拿涨停原因/题材（reason_type）+ 连板 + 封单 + 首封时间。date='YYYYMMDD'
// ⛔ 2026-10-09 fy 轮：原来只拉 page=1 一页就收工 —— 云端实例实测只取到 12/69 只涨停原因
//    （本地同代码 69/69 全有）。涨停原因少一片 = 复盘里一片「同花顺未取到」。
//    改成与 fetchZTPoolThs 一致的分页拉取（最多 5 页 ×100），拿满为止。
async function fetchZtReason(date) {
  const out = new Map();
  const d = String(date || '').replace(/-/g, '');
  if (!d) return out;
  for (let page = 1; page <= 5; page++) {
    const u = 'https://data.10jqka.com.cn/dataapi/limit_up/limit_up_pool?page=' + page +       '&limit=100' +
      '&field=199112,10,9001,330324,133971,133970,1968584,3475914,9002,330329' +
      '&filter=HS,GEM2STAR&order_field=330324&order_type=0&date=' + d;
    let j = null;
    // ⛔ 铁律③：原 catch { break; } 静默跳过 —— 涨停原因兜底链挂了无日志，
    //    表现为「涨停原因整列空白」，排查时查不到是接口挂还是当日无数据。
    try { j = await curlGet(u, 15000, 'https://data.10jqka.com.cn/'); } catch (e) {
      _srcWarn('涨停原因·同花顺兜底拉取失败', `第 ${page} 页请求失败：${(e && e.message) || e}`);
      break;
    }
    const info = j && j.data && j.data.info;
    if (!Array.isArray(info) || !info.length) {
      if (page === 1) _srcWarn('涨停原因·同花顺兜底无数据', `第 1 页即返回空（date=${d}）—— 可能当日无涨停，也可能接口改版/反爬，需人工核对`);
      break;
    }
    for (const x of info) {
      const code = String(x.code || '').trim();
      if (!code) continue;
      out.set(code, {
        name: String(x.name || '').trim(),
        reason: String(x.reason_type || '').trim(),   // 例："电力人工智能+能源数字化+股份划转完成"
        highDays: x.high_days,                        // "首板" / "2板" ...
        sealAmount: +(x.order_amount || 0),           // 封单额(元)
        firstTime: x.first_limit_up_time ? new Date(+x.first_limit_up_time * 1000) : null
      });
    }
    if (info.length < 100) break;                     // 最后一页，不必再翻
  }
  return out;
}

// 个股所属板块（含题材概念）：spt=3 返回该股全部所属板块，用于把涨停股归到真实炒作题材而非仅行业
async function fetchStockBoards(code) {
  return dedup(`s:${code}`, () => _fetchStockBoardsCore(code));
}
async function _fetchStockBoardsCore(code) {
  const secid = (code.startsWith('6') || code.startsWith('9')) ? `1.${code}` : `0.${code}`;
  const u = `${EM}/api/qt/slist/get?pn=1&pz=30&po=1&np=1&fltt=2&invt=2&spt=3` +
    `&secid=${secid}&fields=f12,f13,f14,f3`;
  const j = await get(u, 6000);
  if (!j.data || !j.data.diff) return [];
  const arr = Array.isArray(j.data.diff) ? j.data.diff : Object.values(j.data.diff);
  return arr.map(d => ({ code: d.f12, name: d.f14, pct: +d.f3 || 0 })).filter(x => x.name);
}
// 日K线（前复权），取最近 n 天；东财限流时自动切换腾讯
// ⚠️ 东财 K 线熔断（2026-10-01）：实测 push2his 现在基本取不到数据，
//    每次都要「东财 6s 超时 ×3 次重试 + 8/16/24s 全局退避」约 **26 秒**才回落到腾讯，
//    而腾讯直连只要 ~143ms —— 全市场补齐 1480 只因此慢到几个小时都跑不完。
//    连续失败到阈值就在这段时间内**直接走腾讯**，不再白等。
let _emKlineFail = 0, _emKlineDownUntil = 0;
const EM_KLINE_FAIL_MAX = 3, EM_KLINE_DOWN_MS = 5 * 60 * 1000;
function emKlineDown() { return Date.now() < _emKlineDownUntil; }
function _emKlineOk() { _emKlineFail = 0; }
function _emKlineBad() {
  _emKlineFail++;
  if (_emKlineFail >= EM_KLINE_FAIL_MAX) {
    // 只在「由通转断」这一刻打日志：否则全市场拉一圈要打几十行，把真正的报错淹了
    // （2026-10-01 实测：一轮 714 只刷了 29 行同样的告警）
    const wasDown = emKlineDown();
    _emKlineDownUntil = Date.now() + EM_KLINE_DOWN_MS;
    _emKlineFail = 0;
    if (!wasDown) console.warn(`[em] 东财K线连续失败${EM_KLINE_FAIL_MAX}次 → ${EM_KLINE_DOWN_MS / 60000}分钟内直连腾讯`);
  }
}

// ── 兜底源「当日行」守卫（2026-10-24 ks 轮）────────────────────────────────
// 根因：腾讯/同花顺兜底源会把**盘中未收盘**的当日 bar 当成收盘行写进来（实测三次：
//   10-19 六只、10-20 六只、10-23 八只。典型：920091 当日行 close 26.30 / high 26.71，
//   而真实收盘 33.51（30% 涨停）—— open/low 是对的，high/close 是截取时刻的值）。
//   这类行「自洽」：涨跌幅在限幅内、日期是今天、与前收也接得上，单看 K 线查不出来，
//   但它会静默污染形态/连板/复盘判定；更糟的是审计拿 K 线当尺子 → 反过来报「池里有错票」，
//   一次次把好池子判 FAIL（10-19/10-20/10-23 三次全是误报）。
// 判据（只在同时满足三条时才动手，宁可放过也不误杀）：
//   ① 来源是兜底源（src = tx/ths，东财源不拦）；② 已过收盘（15:05 后，盘中不校验）；
//   ③ 末行日期 = 今天，且东财全A快照（stocks_snapshot.json）新鲜（6 小时内）且含这只票。
//   → 末行 close 与快照收盘价偏差 >0.5%（且绝对差 >0.02 元，规避分币级舍入）即**丢弃当日行**，
//     历史行全保留。缺当日行由上层判「源滞后」下轮重试，比写一行假数据安全。
// ⛔⛔ 2026-10-27 le 轮（用户「每个数字可信」）：「丢弃」的副作用比收益大，改为「按快照重建」。
//   实测链路：11:01 盘中取数恰好成功 → 当日行 close=19.77（那一刻的涨停价）落盘 →
//   收盘真实 18.52 → 守卫判失真丢弃 → klineBackfill 见「无当日行」判源滞后**不写盘** →
//   缓存 mtime 冻在 11:01 永不自愈。于是 ① 池成员长期缺当日行（10-27 抽查 43 只）
//   ② 少数漏网的盘中行被审计/复盘当收盘价用（002995/002086 假漏票）。
//   根因不是判据错，是**处置方式**错：盘中有值、收盘有真值，正确做法是用东财全A快照
//   **重建**当日行（价格/量能/换手全换真值），而不是把整行删掉让自己无行可用。
//   重建前置「口径校验」：末二行 close 必须等于快照 preClose（≤0.2%）—— 前复权/除权票的
//   复权价与快照不复权价天然不同，此时一律不重建，退回原来的丢弃（宁可无行也不写错价）。
const _dayGuard = { dayKey: '', dropped: 0, rebuilt: 0, adjMismatch: 0, unverified: 0, noSnap: 0, appended: 0, lastDropped: [], lastRebuilt: [], lastAppended: [], lastAt: 0 };
const _snapRef = { mtime: 0, map: null };
function _snapRefMap() {
  try {
    const f = path.join(__dirname, 'stocks_snapshot.json');
    const mt = fs.statSync(f).mtimeMs;
    if (mt !== _snapRef.mtime) {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      const rows = j && j.rows ? j.rows : [];
      const m = new Map();
      // le 轮：存整行（不只 price）—— 重建当日行需要 open/high/low/volume/amount/turnover/preClose
      for (const r of rows) if (r && r.code && Number(r.price) > 0) m.set(String(r.code).slice(0, 6), r);
      _snapRef.mtime = mt; _snapRef.map = m; _snapRef.at = (j && j.at) || mt;
    }
    // 尺子必须「今天收盘后拉的」：盘中快照的 price 是实时价、昨天的快照不含今日收盘，都不能当基准
    const mtD = new Date(_snapRef.mtime || 0);
    if (mtD.getFullYear() !== new Date().getFullYear() || mtD.getMonth() !== new Date().getMonth() || mtD.getDate() !== new Date().getDate()) return null;
    if (mtD.getHours() * 60 + mtD.getMinutes() < 15 * 60 + 5) return null;
    return _snapRef.map;
  } catch { return null; }
}
function _todayStr(now) {
  const d = now || new Date();   // mq 轮：允许注入时钟（补行/守卫的守门测试不许依赖真实时间）
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// ① volume 的单位：东财 f56 是「手」，部分兜底源给「股」—— 用历史行的 amount/volume 反推均价，
//    落在该行 [low, high] 区间的那个单位才算命中（历史行是好的，只有当日行会坏，所以能当基准）。
function _volUnitOf(rows) {
  const seg = (rows || []).slice(-11, -1).filter(r => r && +r.volume > 0 && +r.amount > 0 && +r.high > 0 && +r.low > 0);
  if (!seg.length) return 100;                              // 判不出：按东财/腾讯/同花顺默认（手）
  let hand = 0, share = 0;
  for (const r of seg) {
    const avgH = (+r.amount) / ((+r.volume) * 100);          // volume 是手
    const avgS = (+r.amount) / (+r.volume);                  // volume 是股
    if (avgH >= r.low * 0.9 && avgH <= r.high * 1.1) hand++;
    if (avgS >= r.low * 0.9 && avgS <= r.high * 1.1) share++;
  }
  return hand >= share ? 100 : 1;
}
// ② 用东财全A快照重建当日行（价格/量能/换手全部换真值）。返回新行，判不出返回 null（调用方退回丢弃）。
function rebuildDayRow(rows, ref) {
  try {
    if (!Array.isArray(rows) || rows.length < 2 || !ref) return null;
    const last = rows[rows.length - 1], prev = rows[rows.length - 2];
    const price = Number(ref.price), pre = Number(ref.preClose);
    if (!(price > 0) || !(pre > 0)) return null;
    // ③ 口径校验：末二行收盘必须等于快照前收 —— 不等就是前复权/除权票，两个价不可比，宁可不重建
    const pc = Number(prev && prev.close);
    if (!(pc > 0) || Math.abs(pc - pre) / pre > 0.002) return null;
    const high = Number(ref.high) > 0 ? Number(ref.high) : Math.max(price, Number(last.high) || price);
    const low = Number(ref.low) > 0 ? Number(ref.low) : Math.min(price, Number(last.low) || price);
    if (high < price - 0.001 || low > price + 0.001) return null;   // 快照自身不自洽 → 不信它
    const unit = _volUnitOf(rows);
    const pct = Number.isFinite(Number(ref.pct)) ? +Number(ref.pct).toFixed(2) : +(((price / pre) - 1) * 100).toFixed(2);
    return {
      date: last.date,
      open: Number(ref.open) > 0 ? Number(ref.open) : (Number(last.open) || price),
      close: price,
      high, low,
      volume: Number(ref.volume) > 0 ? Math.round(Number(ref.volume) / unit) : (Number(last.volume) || 0),
      amount: Number(ref.amount) > 0 ? Number(ref.amount) : (Number(last.amount) || 0),
      amp: +(((high - low) / pre) * 100).toFixed(2),
      pct,
      chg: +(price - pre).toFixed(2),
      turnover: Number(ref.turnover) > 0 ? +Number(ref.turnover).toFixed(2) : (Number(last.turnover) || 0),
      rebuilt: true                                   // 留痕：这一行不是数据源原文，是按快照重建的
    };
  } catch { return null; }
}
// 当日行守卫计数按「自然日」清零：K线守卫是全天候累加的，累计到 92182/79374 会让「只」标签失真、
// 与市场 5566 只完全不可比。每天跨日自动归零，使 dropped/rebuilt 等代表「今日累计」，口径诚实可比。
function _dayGuardResetIfNewDay() {
  const t = _todayStr();
  if (_dayGuard.dayKey === t) return;
  _dayGuard.dayKey = t;
  _dayGuard.dropped = 0; _dayGuard.rebuilt = 0; _dayGuard.adjMismatch = 0; _dayGuard.unverified = 0; _dayGuard.noSnap = 0;
  _dayGuard.lastDropped = []; _dayGuard.lastRebuilt = []; _dayGuard.lastAppended = []; _dayGuard.appended = 0; _dayGuard.lastAt = 0;
}
function guardDayRow(code, k, now) {
  try {
    _dayGuardResetIfNewDay();
    if (!k || !k.rows || !k.rows.length) return k;
    if (k.src === 'em') return k;                       // 东财是权威源，不拦
    if (!k.src) return k;                               // 没标源的不猜
    const d = now || new Date();   // ms 轮：允许注入时钟。守卫「盘中不校验」语义是对的，但守门测试若依赖真实时钟，则每天 00:00~15:05 恒红（发版闸门被误拦）；注入只服务于测试，默认行为与改动前完全一致
    if (d.getHours() * 60 + d.getMinutes() < 15 * 60 + 5) return k;   // 盘中：当日行本就是盘中值，不校验
    const last = k.rows[k.rows.length - 1];
    if (!last || last.date !== _todayStr()) return k;   // 末行不是今天（源滞后）：交给上层判陈旧
    const map = _snapRefMap();
    // ⛔ 2026-10-28 补（兜底不许静默）：没有「今天的收盘快照」当尺子时，守卫整体不工作 ——
    //    旧写法直接 return k、一行不留，于是「快照 15:05 后没更新（数据源断）」与「守卫跑过了、全部通过」
    //    在巡检上一模一样，失真行照样静默喂给形态/连板判定。这里只计数（处置不变，仍保留原行不硬判），
    //    由 runDataAccuracyMonitor ③ 把 noSnap 曝光成告警。
    if (!map) { _dayGuard.noSnap++; return k; }
    const ref = map.get(String(code).slice(0, 6));      // le 轮：ref 是整行快照，不只是 price
    if (!ref) { k.dayRowUnverified = true; _dayGuard.unverified++; return k; }   // 快照里没这只票：无尺子，保留但标记
    const c = Number(last.close), rc = Number(ref.price);
    if (!isFinite(c) || !isFinite(rc)) return k;
    const dev = Math.abs(c - rc), devPct = dev / Math.max(rc, 0.001);
    // 价格失真（>0.5% 且 >0.02 元，规避分币舍入）或 成交额失真（>25%：盘中写的行成交额必然偏小）
    const a1 = Number(last.amount) || 0, a2 = Number(ref.amount) || 0;
    const amtBad = a1 > 0 && a2 > 0 && Math.abs(a1 - a2) / a2 > 0.25;
    if ((devPct > 0.005 && dev > 0.02) || amtBad) {
      // ⛔ 口径先判：前复权价与快照（不复权）天然不同，末二行收盘对不上快照前收就说明这只票
      //    近期除权过 —— 那不是失真，**一个字都不许动**（10-27 实测 177 只疑似失真票里
      //    前收全部对得上，说明它们是真失真；但除权票迟早会遇到，必须先挡住）。
      const prev = k.rows[k.rows.length - 2];
      const pcV = Number(prev && prev.close), preV = Number(ref.preClose);
      if (!(pcV > 0) || !(preV > 0) || Math.abs(pcV - preV) / preV > 0.002) {
        k.dayRowAdjMismatch = { prevClose: pcV || null, refPreClose: preV || null };
        _dayGuard.adjMismatch++;
        return k;
      }
      const fixed = rebuildDayRow(k.rows, ref);
      if (fixed) {
        k.rows[k.rows.length - 1] = fixed;
        k.dayRowRebuilt = { date: fixed.date, close: c, ref: rc, devPct: +(devPct * 100).toFixed(2),
                            amtDev: a2 > 0 ? +(((a1 - a2) / a2) * 100).toFixed(1) : null };
        _dayGuard.rebuilt++; _dayGuard.lastAt = Date.now();
        _dayGuard.lastRebuilt = [..._dayGuard.lastRebuilt.slice(-19), `${code} ${fixed.date} ${c}→${rc}`];
        console.warn(`[em] 兜底源当日行失真已按东财快照重建：${code} ${fixed.date} close ${c}→${rc}（偏差 ${(devPct * 100).toFixed(2)}%${amtBad ? '，成交额 ' + a1 + '→' + a2 : ''}）`);
      } else {
        // 口径不一致/快照不全 → 退回丢弃（宁可当日无行等下一轮重取，也绝不写错价）
        k.rows = k.rows.slice(0, -1);
        k.dayRowDropped = { date: last.date, close: c, ref: rc, devPct: +(devPct * 100).toFixed(2) };
        _dayGuard.dropped++; _dayGuard.lastAt = Date.now();
        _dayGuard.lastDropped = [..._dayGuard.lastDropped.slice(-19), `${code} ${last.date} ${c}→ref ${rc}`];
        console.warn(`[em] 兜底源当日行失真无法重建，已丢弃：${code} ${last.date} close=${c} vs 东财快照 ${rc}（偏差 ${(devPct * 100).toFixed(2)}%）`);
      }
    }
  } catch { /* 守卫本身绝不能拦住取数 */ }
  return k;
}
// ⛔⛔ ③ 当日行「缺行补齐」（2026-10-28 mq 轮，用户「每个数字可信」）
// guardDayRow 只管「末行=今天但价格/成交额失真」的重建；末行还停在昨天时它直接 return
// （源码里写的就是「源滞后 → 交给上层判陈旧」）。于是收盘后兜底源不给当日行时，缓存永远
// 冻在昨天 —— 10-28 实测 66/74 只涨停池成员末行=10-27（src=ths），复盘形态/连板判定
// （reviewFlags 的 aboveMa5/brokeHighHold/volPriceUp/rangePos/cci）全是在陈旧行上算的。
// 这里补的是「缺行」不是「坏行」，口径判据与 rebuildDayRow 完全一致，宁可缺也不猜：
//   ① 只认非 em 源（em 是权威源，它没写就是真没有）
//   ② 收盘后（15:05）才补 —— 盘中快照的 price 是实时价，补进去就是下一根假行
//   ③ 快照必须是今天的且有真成交（price>0 && volume>0；停牌股 volume=0 一律跳过）
//   ④ 末行收盘 == 快照前收（≤0.2%），否则是除权/长期停牌复牌 → ⛔ 一个字不动
//   ⑤ 与末行日期相差 ≤5 个自然日 —— 长假/长期停牌回来后不补，避免把「隔了一个月」接成
//      连续两根（连板数、形态连续性都会因此失真）
// 返回同一对象，补成功时打 k.dayRowAppended 留痕（巡检可数）。
function appendDayRow(code, k, now, refMap) {   // refMap 仅供守门注入（生产不传=读今日全A快照）
  try {
    _dayGuardResetIfNewDay();
    if (!k || !Array.isArray(k.rows) || !k.rows.length) return k;
    if (k.src === 'em') return k;                 // 权威源不补
    if (!k.src) return k;                         // 没标源的不猜
    const d = now || new Date();
    if (d.getHours() * 60 + d.getMinutes() < 15 * 60 + 5) return k;    // 盘中不补
    const today = _todayStr(d);
    const last = k.rows[k.rows.length - 1];
    if (!last || !last.date) return k;
    if (String(last.date) === today) return k;                          // 已有当日行 → 走 guardDayRow
    const lt = new Date(String(last.date) + 'T00:00:00').getTime();
    if (!Number.isFinite(lt) || lt > d.getTime()) return k;             // 日期在未来：数据坏了
    if ((d.getTime() - lt) / 86400000 > 5) return k;                    // 隔太久：不接成连续两根
    const map = refMap || _snapRefMap();
    if (!map) return k;                                                 // 没有今日收盘快照：不补
    const ref = map.get(String(code).slice(0, 6));
    if (!ref) { k.dayRowUnverified = true; _dayGuard.unverified++; return k; }
    const price = Number(ref.price), pre = Number(ref.preClose);
    if (!(price > 0) || !(pre > 0) || !(Number(ref.volume) > 0)) return k;
    const lc = Number(last.close);
    if (!(lc > 0) || Math.abs(lc - pre) / pre > 0.002) {                // 除权/停牌：不可比
      k.dayRowAdjMismatch = { prevClose: lc || null, refPreClose: pre || null };
      _dayGuard.adjMismatch++;
      return k;
    }
    const high = Number(ref.high) > 0 ? Number(ref.high) : price;
    const low = Number(ref.low) > 0 ? Number(ref.low) : price;
    if (high < price - 0.001 || low > price + 0.001) return k;          // 快照自身不自洽
    const unit = _volUnitOf(k.rows);
    const open = Number(ref.open) > 0 ? Number(ref.open) : price;
    const pct = Number.isFinite(Number(ref.pct)) ? +Number(ref.pct).toFixed(2)
      : +(((price / pre) - 1) * 100).toFixed(2);
    k.rows.push({
      date: today, open, close: price, high, low,
      volume: Math.round(Number(ref.volume) / unit),
      amount: Number(ref.amount) > 0 ? Number(ref.amount) : 0,
      amp: +(((high - low) / pre) * 100).toFixed(2),
      pct, chg: +(price - pre).toFixed(2),
      turnover: Number(ref.turnover) > 0 ? +Number(ref.turnover).toFixed(2) : 0,
      rebuilt: true                                  // 留痕：不是数据源原文，是按快照补的
    });
    k.dayRowAppended = { date: today, close: price, preClose: pre, from: String(last.date) };
    _dayGuard.appended = (_dayGuard.appended || 0) + 1;
    _dayGuard.lastAt = Date.now();
    _dayGuard.lastAppended = [...(_dayGuard.lastAppended || []).slice(-19), `${code} +${today} ${price}`];
  } catch { /* 补行失败绝不能拦住取数 */ }
  return k;
}
function dayGuardStats() {
  return { dropped: _dayGuard.dropped, rebuilt: _dayGuard.rebuilt, adjMismatch: _dayGuard.adjMismatch,
           unverified: _dayGuard.unverified, noSnap: _dayGuard.noSnap,
           appended: _dayGuard.appended || 0,
           lastDropped: _dayGuard.lastDropped.slice(), lastRebuilt: _dayGuard.lastRebuilt.slice(),
           lastAppended: (_dayGuard.lastAppended || []).slice(), lastAt: _dayGuard.lastAt };
}
// 2026-10-27 自检：退避/并发观测（供 server.js runDataAccuracyMonitor 采集，纯只读、不改任何取数行为）
function backoffStats() {
  return {
    emRateTriggers: _emRateTriggers,
    emRateLastAt: _emRateLastAt,
    emRateCooldownLeft: Math.max(0, blockedUntil - Date.now()),
    emKlineDown: emKlineDown(),
    emKlineDownLeft: Math.max(0, _emKlineDownUntil - Date.now()),
    boardBackoffFail: BOARD_BACKOFF.fail,
    boardBackoffLeft: boardBackoffLeft(),
    thsKlineDown: thsKlineDown(),
    inflight: inflightSize()
  };
}

async function fetchKline(code, days = 95) {
  return dedup(`k:${code}:${days}`, () => _fetchKlineCore(code, days)).then(k => guardDayRow(code, k));
}
// ⛔ 铁律③ 兜底不许静默（2026-10-28 数据源轮）：K线三源（东财→腾讯→同花顺）全失败必须留痕。
//    全A补K线是全市场逐票调用，不限频会在数据源整体故障时刷出几千行同款日志、把真正的报错淹掉
//    （沿用 _emKlineBad「由通转断才打日志」的既有做法），故 60 秒限频 + 累计计数。
const _klineAllFail = { n: 0, lastAt: 0 };
function _klineAllSrcFail(code, e) {
  _klineAllFail.n++;
  const now = Date.now();
  if (now - _klineAllFail.lastAt > 60000) {
    _klineAllFail.lastAt = now;
    console.warn(`[em] ⛔ K线三源(东财→腾讯→同花顺)全失败（累计 ${_klineAllFail.n} 次，最近 ${code}）：${(e && e.message) || e} —— 该票本轮无K线，返回 null 不拿假数据冒充`);
  }
}
async function _fetchKlineCore(code, days = 95) {
  // 东财已判死：直接腾讯/同花顺，别浪费 26 秒
  // ⚠️ 2026-10-02 修：原来这里只试腾讯就 return —— 腾讯一旦也挂，这个函数在东财熔断期内
  //    就是彻底死的（返回 undefined），所有依赖 K 线的模块整片空白。补上同花顺兜底。
  if (emKlineDown()) {
    try { const k = await fetchKlineTx(code, days); if (k && k.rows && k.rows.length) { k.fallback = true; return k; } } catch { }
    try {
      const k = await fetchKlineThs(code, days);
      if (k && k.rows && k.rows.length) { k.fallback = true; return k; }
    } catch { }
  }
  try {
    const k = await fetchKlineEM(code, days);
    if (k && k.rows && k.rows.length) { _emKlineOk(); return k; }
    _emKlineBad();
  } catch (e) {
    _emKlineBad();
    // 东财挂了 → 腾讯 → 同花顺（不再把腾讯当唯一的最后一道防线）
    try {
      const k = await fetchKlineTx(code, days);
      if (k && k.rows && k.rows.length) { k.fallback = true; return k; }
    } catch { }
    const k2 = await fetchKlineThs(code, days);
    if (k2 && k2.rows && k2.rows.length) { k2.fallback = true; return k2; }
    throw e;
  }
  // 东财返回空（没抛错）也要有数据：腾讯 → 同花顺
  try {
    const k = await fetchKlineTx(code, days);
    if (k && k.rows && k.rows.length) { k.fallback = true; return k; }
  } catch { }
  try {
    const k = await fetchKlineThs(code, days);
    if (k) k.fallback = true;
    return k;
    // ⛔ 铁律③ 兜底不许静默：走到这里 = 东财返回空 + 腾讯失败 + 同花顺失败，三源全挂。
    //    返回 null 本身是诚实的（不拿假数据冒充），但**没有任何日志** —— 全A补K线时每只都静默 null，
    //    运维只看到「K线拉不到/陈旧」却查不到是三源全挂。逐票调用故 60 秒限频 + 累计计数。
  } catch (e) { _klineAllSrcFail(code, e); return null; }
}

// ── 批量拉取 K 线（全市场补齐专用）──────────────────────────────────────
// 原来的 klineBackfill 是**串行 + 每只 sleep 110ms**，一轮 200 只、4 分钟一轮，
// 1480 只缺口要跑大半天。这里并发跑，并且东财判死期间全程走腾讯（~143ms/只）。
// 返回 { ok, n, added, fail, failed: [code...] }
async function fetchKlineBulk(codes, days = 60, conc = 10) {
  const out = new Map();
  const failed = [];
  let i = 0;
  async function worker() {
    while (i < codes.length) {
      const code = codes[i++];
      try {
        let k = null;
        if (!emKlineDown()) {
          try { k = await fetchKlineEM(code, days); if (k && k.rows && k.rows.length >= 6) _emKlineOk(); else { _emKlineBad(); k = null; } }
          catch { _emKlineBad(); k = null; }
        }
        if (!k) { try { k = await fetchKlineTx(code, days); if (k) k.fallback = true; } catch { k = null; } }
        // ⚠️ 2026-10-02 修：批量补齐也补上同花顺。全市场 1480 只缺口全靠这一条路径，
        //    东财+腾讯双挂时整轮补齐全废（原来只到腾讯为止）。
        if (!k || !k.rows || k.rows.length < 6) { try { k = await fetchKlineThs(code, days); if (k) k.fallback = true; } catch { k = null; } }
        if (k) k = guardDayRow(code, k);   // ks 轮：兜底源当日行守卫（批量补齐同样不能写假行）
        if (k && k.rows && k.rows.length >= 6) out.set(code, k);
        else failed.push(code);
      } catch { failed.push(code); }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(conc, 24)) }, worker));
  return { ok: true, n: codes.length, added: out.size, fail: failed.length, map: out, failed };
}

async function fetchKlineEM(code, days = 95) {
  // ⛔ oa 轮（2026-10-29）：code 已带市场前缀（如 '1.000001' 上证指数）时直接用——
  //    否则会被拼成 '0.1.000001' 拿到错误数据（实测：fetchKline('000001') 拿到的是平安银行而不是上证指数）。
  const secid = /\./.test(code) ? code
    : (code.startsWith('6') || code.startsWith('9')) ? `1.${code}` : `0.${code}`;
  const u = `${EMH}/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1` +
    `&lmt=${days}&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
  const j = await get(u, 6000);
  if (!j.data || !j.data.klines) return null;
  const rows = j.data.klines.map(s => {
    const p = s.split(',');
    return {
      date: p[0], open: +p[1], close: +p[2], high: +p[3], low: +p[4],
      volume: +p[5], amount: +p[6], amp: +p[7], pct: +p[8],
      chg: +p[9], turnover: +p[10]
    };
  });
  return { name: j.data.name, rows };
}

// 集合竞价分时（东财 trends2 iscr=1）：取 09:15–09:25 每分钟的价/量，
// 供十四条体系的 ⑦竞价红绿柱 / ⑭尾盘抢筹上翘 使用。
// ⚠️ 实测（2026-10-09）：东财竞价段「成交额」(f57) 恒为 0，但「价」(f53) 与「量(手)」(f56)
//    每分钟都有 → 足够判价格方向上翘与量能放大（方向性红绿柱用「每分钟价 vs 昨收」近似，
//    真正的主动买卖方向东财竞价段不给，不硬凑）。trends2 不带 /get 会 404，必须 /get。
async function fetchAuctionTicks(code) {
  const secid = (code.startsWith('6') || code.startsWith('9')) ? `1.${code}` : `0.${code}`;
  const f1 = "f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f11,f12,f13";
  const f2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61";
  const u = `${EMH}/api/qt/stock/trends2/get?secid=${secid}&fields1=${f1}&fields2=${f2}&iscr=1&ndays=1`;
  const j = await get(u, 8000);
  const d = j && j.data;
  if (!d || !d.trends || !d.trends.length) return null;
  const preClose = (d.pre && typeof d.pre.close === 'number') ? d.pre.close : null;
  const bars = [];
  for (const s of d.trends) {
    const p = String(s).split(',');
    const hhmm = p[0] ? p[0].slice(11) : '';        // "2026-10-09 09:15" → "09:15"
    if (hhmm < '09:15' || hhmm > '09:25') continue; // 只留集合竞价段
    const price = +p[2];                            // f53 当前价/收盘
    if (!isFinite(price)) continue;
    bars.push({ t: hhmm, price, high: +p[3], low: +p[4], vol: +p[5] });
  }
  if (!bars.length) return null;
  return { preClose, bars };
}

// 常规分时（东财 trends2，不带 iscr=1 → 取 09:30–15:00 连续竞价段每分钟的价/均价/量）
// 批量实时快照（自选池用），含主力净流入；东财限流时切换腾讯
async function fetchBatchSnapshot(codes) {
  const requested = [...new Set(codes)], chosen = new Map();
  const txAttempted = new Set();
  let lastError;
  const refresh = now => {
    for (const [code, row] of chosen) {
      const current = batchQuoteAtPublication(row, now);
      if (current.quoteFreshness === 'recent-unverified') chosen.set(code, current);
      else chosen.delete(code);
    }
  };
  const missing = () => requested.filter(code => !chosen.has(code));
  const collect = (rows, wanted, now) => {
    const allowed = new Set(wanted);
    for (const row of rows || []) {
      if (!row || !allowed.has(row.code)) continue;
      const current = batchQuoteAtPublication(row, now);
      if (current.quoteFreshness !== 'recent-unverified') continue;
      const previous = chosen.get(row.code);
      if (!previous || (previous.quoteSource === current.quoteSource && current.quoteAt > previous.quoteAt)) chosen.set(row.code, current);
    }
  };
  const fetchMissing = async (provider, fetchRows, wanted) => {
    if (!wanted.length) return;
    if (provider === 'tencent') for (const code of wanted) txAttempted.add(code);
    try {
      const rows = await fetchRows(wanted), now = Date.now();
      refresh(now);
      collect(rows, wanted, now);
    } catch (e) {
      lastError = e;
      batchQuoteWarn(provider, wanted, classifyNetErr(String(e && e.message || e)));
    }
  };
  for (const [provider, fetchRows] of [['eastmoney', fetchBatchSnapshotEM], ['tencent', fetchBatchSnapshotTx]]) {
    refresh(Date.now());
    await fetchMissing(provider, fetchRows, missing());
  }
  // A slow secondary request can expire a primary row that did not need the
  // secondary at its start. Give only these never-requested symbols one chance.
  refresh(Date.now());
  await fetchMissing('tencent', fetchBatchSnapshotTx, missing().filter(code => !txAttempted.has(code)));
  refresh(Date.now());
  const remaining = missing();
  if (remaining.length) {
    try {
      const rows = require('./src/core/six-photo-backups').photoQuoteFallback(remaining);
      const now = Date.now();
      refresh(now);
      collect(rows, remaining, now);
    } catch (e) {
      lastError = e;
      batchQuoteWarn('research', remaining, 'unavailable');
    }
  }
  // One clock for the entire published batch, after every request/backup read.
  refresh(Date.now());
  if (!chosen.size && lastError) throw lastError;
  return requested.map(code => chosen.get(code)).filter(Boolean);
}

function batchQuoteAtPublication(row, now) {
  const validTime = value => Number.isSafeInteger(value) && value > 0 && value <= 8e15;
  const day = value => new Date(value + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const quoteAt = row && row.quoteAt, receivedAt = row && row.receivedAt;
  let quoteFreshness = 'unknown';
  if (row && typeof row.price === 'number' && Number.isFinite(row.price) && row.price > 0 &&
      typeof row.quoteSource === 'string' && row.quoteSource.trim() &&
      validTime(quoteAt) && validTime(receivedAt) && validTime(now)) {
    // A timestamp that was future at receipt never becomes valid merely by waiting.
    if (quoteAt > receivedAt || receivedAt > now) quoteFreshness = 'future';
    else if (now - quoteAt > 15000 || day(quoteAt) !== day(now)) quoteFreshness = 'stale';
    else quoteFreshness = 'recent-unverified';
  }
  return { ...row, quoteFreshness, canTrade: row?.canTrade === true && quoteFreshness === 'recent-unverified' };
}
function batchQuoteWarn(provider, codes, reason) {
  // Only bounded public stock identifiers and fixed reason classes; no raw URL/error body.
  const validCodes = codes.filter(code => /^\d{6}$/.test(code));
  _srcWarn(`批量报价·${provider}`, `${reason}；本批${codes.length}只，代码${validCodes.slice(0, 60).join(',') || '未知'}；保留其他有效行`);
}

async function fetchBatchSnapshotEM(codes) {
  const secids = codes.map(c => (c.startsWith('6') || c.startsWith('9')) ? `1.${c}` : `0.${c}`).join(',');
  const u = `${EM}/api/qt/ulist.np/get?secids=${secids}&fltt=2&invt=2&np=1` +
    `&fields=f12,f14,f2,f3,f5,f6,f8,f15,f16,f17,f18,f20,f21,f22,f62,f66,f184,f124`;
  // ⛔ 2026-10-30：Node TLS 指纹被东财全域拒绝（socket hang up）是常态，get() 抛错时走 curl 轮换
  //    （curlGet 内对东财 URL 自动按 72/82/92 子域名轮换——腾讯 fallback 只有行情无资金流字段，
  //    主力净流入 f62/f66 是资金类推送的硬数据，必须尽力保住东财源，不能直接退腾讯）。
  let j = null;
  try { j = await get(u); } catch {}
  if (!j || !j.data || !j.data.diff) j = await curlGet(u, 8000);
  if (!j || !j.data || !j.data.diff) throw new Error('snapshot EM+curl 双通道均无数据');
  return j.data.diff.map(d => {
    const receivedAt = Date.now(), seconds = Number(d.f124);
    const quoteAt = Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : null;
    const quoteFreshness = quoteAt === null ? 'unknown' : quoteAt > receivedAt ? 'future' : receivedAt - quoteAt > 15000 ? 'stale' : 'recent-unverified';
    return {...normalizeStock(d), quoteSource:'eastmoney', quoteAt, receivedAt, quoteFreshness, canTrade:quoteFreshness === 'recent-unverified'};
  });
}

// 个股资金流历史（日K级），返回最近 n 天主力净流入
// 注：fflow 接口拒绝 Node TLS 指纹（ECONNRESET），Node 失败时自动走 curl 子进程
async function fetchFundFlowDays(code, days = 6) {
  const secid = (code.startsWith('6') || code.startsWith('9')) ? `1.${code}` : `0.${code}`;
  const u = `${EMH}/api/qt/stock/fflow/daykline/get?lmt=${days}&klt=101&secid=${secid}` +
    `&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65`;
  const parse = j => {
    if (!j || !j.data || !j.data.klines) return null;
    const retrievedAt = Date.now();
    return j.data.klines.map(s => {
      const p = s.split(',');
      // f51日期；f52主力=f55大单+f56超大单，仅为供应商订单大小分类估计。
      return { date: p[0], main: observedFlowNumber(p[1]), small: observedFlowNumber(p[2]),
        mid: observedFlowNumber(p[3]), big: observedFlowNumber(p[4]), super: observedFlowNumber(p[5]),
        ...flowProvenance(retrievedAt) };
    });
  };
  try {
    const j = await doGet(u, 6000);
    const r = parse(j);
    if (r) return r;
  } catch {}
  // curl 通道（该接口对 curl 放行）；--noproxy 绕过系统代理（代理环境下东财不通）
  try {
    const r2 = parse(await curlGet(u, 8000));
    if (r2) return r2;
  } catch {}
  // ⛔ 铁律③：两条通道都取不到 → 返回 null 是诚实的（不拿 0 冒充），但原来静默无日志，
  //    表现为「资金流门槛整列空白/全不达标」，排查时看不到是接口挂还是该票真无资金流。
  _srcWarn('资金流日线·两通道均失败', `${code} 的 fflow 日线 Node/curl 双通道均无数据 —— 返回 null，调用方须按「无资金流」处理，⛔ 不拿 0 冒充`);
  return null;
}

// curl 子进程 GET：绕过 Node TLS 指纹拦截与本机代理环境变量
// referer 可覆盖：同花顺 data.10jqka.com.cn 必须带自家 Referer 才给数据（2026-10-01 实测）
// ⛔ 2026-10-30 东财域名轮换：Node TLS 指纹被东财全域拒绝（socket hang up，实测含 72/82 子域），
//    但 curl 子进程（浏览器 UA + TLS 指纹）能通——只是部分域名（push2 主域）被本机网络环境
//    拉黑返回空响应。所以 curlGet 对东财 URL 按 EM_HOST_CHAIN 轮换：主域空响应 → 72 → 82 → 92。
function curlGet(u, timeoutMs = 8000, referer) {
  return new Promise(resolve => {
    const hosts = emHostChainFor(u);
    const urls = hosts ? hosts.map(h => u.replace(hosts[0], h)) : [u];
    let idx = 0;
    const attempt = () => {
      execFile('curl', ['-s', '--noproxy', '*', '--max-time', String(Math.ceil(timeoutMs / 1000)), urls[idx],
        '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-H', 'Referer: ' + (referer || 'https://quote.eastmoney.com/'),
        '-H', 'Accept: */*'],
        // windowsHide 必须显式开启：node 是 DETACHED(无控制台) 启动的，Windows 会为 curl 这类控制台子系统程序
        // 另开一个新的控制台窗口 → 每调一次闪一个黑框，这是"频繁弹窗"的真正根因，与 node 崩溃无关
        { maxBuffer: 8e6, windowsHide: true }, (err, stdout) => {
          if (!err && stdout) { try { resolve(JSON.parse(stdout)); return; } catch { /* 换下一个域名 */ } }
          if (idx < urls.length - 1) { idx++; attempt(); }
          else resolve(null);
        });
    };
    attempt();
  });
}

// 批量个股主力资金（push2 快照通道）：当日 f62 / 5日 f164 / 10日 f174 主力净流入（元）
// fflow 历史接口被反爬时，用此接口兜底供给"资金净流入"硬门槛
//
// ⚠️ 2026-09-29 补四级资金（超大单/大单/中单/小单）—— 用户质问："你推的大单流入，
//    可也有大单流出啊，到底是流入多还是流出多？" 只报一个净额确实答不上这个问题。
//    东财字段实测确认（2026-09-29 对 600293/000001/605366 三只验证）：
//      f62  主力净流入 = f66 + f72              （净额，已扣除对应级别的流出）
//      f66  超大单净额   f69 超大单净占比
//      f72  大单净额     f75 大单净占比
//      f78  中单净额     f81 中单净占比
//      f84  小单净额     f87 小单净占比
//    恒等式：f66+f72+f78+f84 === 0（买到的金额必然等于卖出的金额）
//    四级正负反映供应商订单大小分类下的净额，不能识别实际投资者身份：
//      超大单 + 小单 -  = 超大单净流入、小单净流出
//      超大单 - 大单 +  = 超大单净流出、大单净流入
//    以前只推 f62 这一个数字，等于把"主力内部打架"这种关键信息直接丢掉。
async function fetchBatchFlowEM(codes) {
  const chunks = [];
  for (let i = 0; i < codes.length; i += 100) chunks.push(codes.slice(i, i + 100));
  const one = async batch => {
    const secids = batch.map(c => (c.startsWith('6') || c.startsWith('9')) ? `1.${c}` : `0.${c}`).join(',');
    const u = `${EM}/api/qt/ulist.np/get?secids=${secids}&fltt=2&invt=2&np=1&fields=f12,f62,f164,f174,f184,f66,f69,f72,f75,f78,f81,f84,f87`;
    let j = null;
    try { j = await get(u, 8000); } catch {}
    if (!j || !j.data || !j.data.diff) j = await curlGet(u, 8000); // Node 被拒时走 curl
    if (!j || !j.data || !j.data.diff) {
      // ⛔ 铁律③：批量主力资金（当日/5日/10日 + 四级单）整批取不到 → 返回 [] 是诚实的，
      //    但原来静默无日志：表现为「资金硬门槛整批不达标/全票无资金流」，
      //    排查时看不到是 push2 快照通道挂了还是真无资金（全A循环内故走 60s 限频）。
      _srcWarn('批量资金流·两通道均失败', `本批 ${batch.length} 只（${batch[0]}…）Node/curl 双通道均无数据 —— 返回 []，调用方须按「无资金流」处理，⛔ 不拿 0 冒充`);
      return [];
    }
    const retrievedAt = Date.now();
    return j.data.diff.map(d => ({
      code: String(d.f12), today: observedFlowNumber(d.f62), d5: observedFlowNumber(d.f164),
      d10: observedFlowNumber(d.f174), pct: observedFlowNumber(d.f184),
      superNet: observedFlowNumber(d.f66), superPct: observedFlowNumber(d.f69),
      bigNet: observedFlowNumber(d.f72), bigPct: observedFlowNumber(d.f75),
      midNet: observedFlowNumber(d.f78), midPct: observedFlowNumber(d.f81),
      smallNet: observedFlowNumber(d.f84), smallPct: observedFlowNumber(d.f87),
      ...flowProvenance(retrievedAt)
    })).filter(d => /^\d{6}$/.test(d.code));
  };
  const results = await pool(chunks, one, 4);
  return results.filter(Boolean).flat();
}

// 供应商订单大小分类的净额对比；净额不能证明投资者身份或总参与度。
// dir: 'in'主力口径净流入 / 'out'主力口径净流出 / 'mixed'分类分歧 / 'flat'净额较小
function flowBalance(t = {}) {
  const sup = observedFlowNumber(t?.superNet), big = observedFlowNumber(t?.bigNet);
  const mid = observedFlowNumber(t?.midNet), sml = observedFlowNumber(t?.smallNet);
  if ([sup, big, mid, sml].some(value => value === null)) {
    return { dir: 'unknown', label: '订单大小分类净额缺失，无法判断净流入方向',
      main: sup !== null && big !== null ? sup + big : null,
      superNet: sup, bigNet: big, midNet: mid, smallNet: sml, consistent: null };
  }
  const main = sup + big;
  const sum = sup + big + mid + sml;
  // 数据自检：四级净额数学上必须归零，偏差过大说明接口字段串位或被限流返回脏值
  const gross = Math.abs(sup) + Math.abs(big) + Math.abs(mid) + Math.abs(sml) || 1;
  const consistent = Math.abs(sum) / gross < 0.02;
  const midSmall = mid + sml;
  let dir = 'flat', label = '主力口径净额相对较小，不能据此判断总成交参与度';
  if (!consistent) {
    // 恒等式被打破 = 接口字段串位 / 被限流返回脏值，此时说什么"买多卖少"都是编的
    dir = 'unknown'; label = '⚠️ 四级净额不守恒（数据源疑似串位或限流脏值），买卖力量判不出来，本条仅作线索';
  } else if (Math.abs(main) < gross * 0.08) { dir = 'flat'; }
  else if (main > 0 && sup <= 0 && big > 0) { dir = 'mixed'; label = '超大单净额非正、大单净流入 → 主力口径净流入，分类方向分歧'; }
  else if (main < 0 && sup < 0 && big > 0) { dir = 'mixed'; label = '超大单净流出、大单净流入 → 主力口径净流出，分类方向分歧'; }
  else if (main > 0 && sup > 0 && midSmall < 0) { dir = 'in'; label = '超大单净流入、中小单合计净流出 → 主力口径净流入'; }
  else if (main < 0 && sup < 0 && midSmall > 0) { dir = 'out'; label = '超大单净流出、中小单合计净流入 → 主力口径净流出'; }
  else if (main < 0 && sup >= 0 && big < 0) { dir = 'mixed'; label = '超大单净额非负、大单净流出 → 主力口径净流出，分类方向分歧'; }
  else if (main > 0) { dir = 'in'; label = '大单与超大单合计净流入（供应商主力口径）'; }
  else { dir = 'out'; label = '大单与超大单合计净流出（供应商主力口径）'; }
  return { dir, label, main, superNet: sup, bigNet: big, midNet: mid, smallNet: sml, consistent };
}

// ---------- 备用数据源：腾讯/新浪（东财限流时自动切换，独立不限流）----------
function txGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      family: 4, timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com' }
    }, res => {
      const c = []; res.on('data', d => c.push(d));
      res.on('end', () => resolve(Buffer.concat(c)));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
  });
}
const txJSON = async url => JSON.parse((await txGet(url)).toString('utf8'));

function txMarket(code) {
  // ⛔ oa 轮（2026-10-29）：支持东财带点格式指数代码——'1.000001'=上证(sh)、'0.399001'=深成(sz)。
  //    不带点维持原个股判据（txRaw 负责剥前缀）。
  if (/\./.test(code)) return code.startsWith('1.') ? 'sh' : code.startsWith('0.') ? 'sz' : 'sh';
  if (code.startsWith('6') || code.startsWith('9') || code.startsWith('68')) return 'sh';
  if (code.startsWith('4') || code.startsWith('8') || code.startsWith('92')) return 'bj';
  return 'sz';
}
// 剥掉东财市场前缀取纯数字代码（个股原样返回）
function txRaw(code) { return /\./.test(code) ? code.split('.')[1] : code; }

// 腾讯日K线（前复权）：date/open/close/high/low/volume；pct与turnover由调用方补
async function fetchKlineTx(code, days = 95) {
  const m = txMarket(code);
  const raw = txRaw(code);
  const j = await txJSON(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${m}${raw},day,,,${days},qfq`);
  const arr = (j.data[m + raw] || {}).qfqday || (j.data[m + raw] || {}).day;
  if (!arr || !arr.length) return null;
  // ⚠️ 2026-10-02 实测修：腾讯对【科创板】(688xxx / 689xxx) 返回的成交量单位是「股」，
  //    其它板块一律是「手」，差整整 100 倍。原来这里无差别按「手」处理并 ×100 算成交额，
  //    结果科创板票的量能被放大 100 倍、成交额算成几千亿（688008 实为 54 亿，算出 5434 亿）。
  //    凡是「放量/缩量/量比/大单流入」的判断，科创板票全是错的。
  //    判据：同花顺 amount/(volume*close) 在科创板上同样是 ≈100（即同花顺是「手」），
  //    而腾讯 688 段的 amount/(vol*close) ≈ 1。以下按板块归一到「手」。
  const isSTAR = code.startsWith('688') || code.startsWith('689');
  const unitFix = isSTAR ? 0.01 : 1;   // 股 → 手
  const rows = arr.map(r => ({
    date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4],
    volume: Math.round(+r[5] * unitFix), amount: 0, amp: 0, pct: 0, chg: 0, turnover: 0
  }));
  for (let i = 1; i < rows.length; i++) {
    rows[i].pct = +(((rows[i].close - rows[i - 1].close) / rows[i - 1].close) * 100).toFixed(2);
    rows[i].amount = rows[i].volume * rows[i].close * 100;
  }
  return { name: '', rows, src: 'tx', adjust: 'qfq' };
}

// ---------------- 同花顺日K（数据源第二梯队，腾讯之外再兜一层）----------------
// 2026-10-02 实测三源健康度：
//   · 东财 push2his：HTTP 200 但 rc:102 / data:null（被拒，不是网络问题）；push2 快照直接连不上
//   · 腾讯 web.ifzq.gtimg.cn：正常（当前唯一在用的降级源，单点风险）
//   · 同花顺 d.10jqka.com.cn：正常 —— 补进来做第三源，别把命全押在腾讯上
// 接口：https://d.10jqka.com.cn/v6/line/hs_<code>/01/last.js
//   ⚠️ 路径编号 = [周期][复权]：0=日 1=周 2=月；复权位 0/1/2。
//      实测「01」= 日K + 前复权，OHLC 与腾讯 qfq 完全一致（600000 9/30：开9.22 高9.49 低9.16 收9.48）。
//      「11」是周K、「21」是月K —— 千万别当成日K取（踩过：last180.js 看着像日K其实是周间隔）。
//   返回 JSONP，data 是字符串：`日期,开,高,低,收,成交量(股),成交额(元),换手率,,,0`
//   ⚠️ 顺序是 开/高/低/收（不是腾讯那种 开/收/高/低），且成交量单位是「股」不是「手」。
const THS_LINE = 'https://d.10jqka.com.cn/v6/line/hs_';
let _thsKFail = 0, _thsKDownUntil = 0;
const THS_K_FAIL_MAX = 5, THS_K_DOWN_MS = 5 * 60 * 1000;
function thsKlineDown() { return Date.now() < _thsKDownUntil; }
async function fetchKlineThs(code, days = 95) {
  if (thsKlineDown()) return null;
  try {
    const text = await thsGet(`${THS_LINE}${code}/01/last.js`, 12000);
    const m = /quotebridge_v6_line_hs_\w+_\d+_last\(([\s\S]*)\)/.exec(text);
    if (!m) return null;
    const o = JSON.parse(m[1]);
    const raw = String(o.data || '').split(';').filter(Boolean);
    if (!raw.length) return null;
    let arr = raw.map(s => s.split(',')).map(f => ({
      date: `${f[0].slice(0, 4)}-${f[0].slice(4, 6)}-${f[0].slice(6, 8)}`,
      open: +f[1] || 0, high: +f[2] || 0, low: +f[3] || 0, close: +f[4] || 0,
      volume: Math.round((+f[5] || 0) / 100),   // 股 → 手，与腾讯/东财口径一致
      amount: +f[6] || 0,                        // 成交额（元），同花顺直接给真值
      turnover: +f[7] || 0,                      // 换手率(%)，腾讯没有，这算是同花顺的加分项
      amp: 0, pct: 0, chg: 0
    })).filter(r => r.close > 0 && r.volume > 0);
    // ⚠️ 2026-10-19 it2：过滤条件加 `r.volume > 0`——同花顺对「当天成交未结算」的票会返回
    //   close 有值但 volume=0 的半成品柱（is 轮奥士康实证：10-19 那根 close=75 但 vol=0，
    //   且同花顺随后把 10-19 整根撤回、最新退回 10-16）。这种柱 close 也可能是盘中价不是收盘价，
    //   整根不可信，必须丢弃等数据源就绪重拉，绝不能写进 .kline_cache 再被 volPricePattern 等当「缩量」误判。
    if (days > 0 && arr.length > days) arr = arr.slice(-days);
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1].close;
      arr[i].chg = +(arr[i].close - prev).toFixed(3);
      arr[i].pct = prev > 0 ? +(((arr[i].close - prev) / prev) * 100).toFixed(2) : 0;
      arr[i].amp = arr[i].low > 0 ? +(((arr[i].high - arr[i].low) / arr[i].low) * 100).toFixed(2) : 0;
    }
    _thsKFail = 0;
    return { name: o.name || '', rows: arr, src: 'ths', adjust: 'qfq' };
  } catch (e) {
    if (++_thsKFail >= THS_K_FAIL_MAX) {
      _thsKDownUntil = Date.now() + THS_K_DOWN_MS;
      _thsKFail = 0;
      console.warn(`[em] 同花顺K线连续失败${THS_K_FAIL_MAX}次 → ${THS_K_DOWN_MS / 60000}分钟内不再重试`);
    }
    return null;
  }
}

// 腾讯批量快照（每60只一批）：换手率/市值可直接取
async function fetchBatchSnapshotTx(codes) {
  const requested = [...new Set(codes)], out = [];
  let lastError, completed = 0;
  for (let i = 0; i < requested.length; i += 60) {
    const batchCodes = requested.slice(i, i + 60);
    try {
      const batch = batchCodes.map(c => txMarket(c) + c).join(',');
      const text = new TextDecoder('gbk').decode(await txGet(`https://qt.gtimg.cn/q=${batch}`));
      const re = /v_(?:sh|sz|bj)(\d{6})="([^"]*)"/g;
      const wanted = new Set(batchCodes);
      let m;
      while ((m = re.exec(text))) {
        const f = m[2].split('~');
        if (!wanted.has(m[1]) || f.length < 46 || !Number.isFinite(+f[3]) || +f[3] <= 0) continue;
        const receivedAt = Date.now();
        let quoteAt = null;
        try { quoteAt = require('./src/core/public-market').timestamp(f[30] || ''); } catch {}
        const quoteFreshness = quoteAt === null ? 'unknown' : quoteAt > receivedAt ? 'future' : receivedAt - quoteAt > 15000 ? 'stale' : 'recent-unverified';
        out.push({
          quoteSource: 'tencent', quoteAt, receivedAt, quoteFreshness, canTrade:quoteFreshness === 'recent-unverified',
          code: m[1], name: f[1], price: +f[3], pct: +f[32],
          volume: +f[6], amount: +f[37] * 1e4, turnover: +f[38],
          high: +f[33], low: +f[34], open: +f[5], preClose: +f[4],
          mktcap: +f[45] * 1e8, floatCap: +f[44] * 1e8,
          speed: 0, listedDate: 0, mainInflow: null, mainPct: null
        });
      }
      completed++;
    } catch (e) {
      lastError = e;
      batchQuoteWarn('tencent', batchCodes, classifyNetErr(String(e && e.message || e)));
    }
  }
  if (!completed && lastError) throw lastError;
  // Direct full-A/display callers retain dated rows, with their real final status.
  const now = Date.now(), selected = new Map();
  const priority = row => row.quoteFreshness === 'recent-unverified' ? 2 : row.quoteFreshness === 'stale' ? 1 : 0;
  const originalTime = row => Number.isSafeInteger(row.quoteAt) && row.quoteAt > 0 ? row.quoteAt : -Infinity;
  for (const row of out) {
    const current = batchQuoteAtPublication(row, now), previous = selected.get(row.code);
    if (!previous || priority(current) > priority(previous) ||
        (priority(current) === priority(previous) && originalTime(current) > originalTime(previous))) selected.set(row.code, current);
  }
  return requested.map(code => selected.get(code)).filter(Boolean);
}

// 新浪全A列表（⛔ 2026-10-09 起改【首选】全量源）：
//   node=hs_a 实测包含 沪深主板 / 创业板 / 科创板 / 北交所 全集（首条即 bj920000），
//   交易时段稳定、不受东财随机断连影响。⛔ 旧代码 `startsWith('8'|'4'|'92')` 把北交所~260只
//   错误剔除 → 全量不全；现已去掉该过滤，保留全部 A股（含北交所）。
async function fetchAllStocksSina() {
  const out = [];
  for (let page = 1; page <= 70; page++) {
    let text;
    try {
      text = (await txGet(`https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=${page}&num=100&sort=symbol&asc=1&node=hs_a`)).toString('utf8');
    } catch { break; }
    let arr;
    try { arr = JSON.parse(text); } catch { break; }
    if (!arr || !arr.length) break;
    for (const d of arr) {
      const code = d.code;
      if (!/^\d{6}$/.test(code)) continue;   // 仅过滤非6位代码；8/4/92（北交所）与 688（科创）均保留 = 全量
      const name = String(d.name || '');
      const price = +d.trade;
      const amount = +d.amount;
      // ⛔ jj 轮（2026-10-21）：数据源会夹带已退市/未股改股（S 开头、S*ST、退市），这些票
      //    没有真实交易意义，在源头剔除；价格为 0/成交额为 0 的同样剔（停牌无成交）。
      // ⛔⛔ jn 轮（2026-10-21）：ST/*ST 【不再】在源头剔除 —— 2026-04 沪深规则修订后风险警示板
      //    与主板同限幅 ±10%，是正常交易股票；且涨停补漏 deriveLimitUpMissed（server.js）
      //    正是靠这份全A快照，把两源接口侧（东财 getTopicZTPool / 同花顺 limit_up_pool 都按名
      //    排除 ST）漏掉的 ST 封板票补进池。jj 轮的源头过滤把这个口子堵死了：快照里 ST 一只不剩，
      //    只剩正则 `\\*ST`（双反斜杠=零或多个反斜杠+ST，永远匹配不上 *ST）漏洞漏过的 *ST。
      //    选股侧的 ST 排除不受影响——20+ 处消费点统一走 A.isJunkName（口径未变，见其注释）。
      const JUNK_NAME_RE = /^S[^T]|退/i;   // S*ST/未股改 + 退市；ST/*ST 保留（jn 轮）
      if (!name || JUNK_NAME_RE.test(name)) continue;
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!Number.isFinite(amount) || amount <= 0) continue;
      out.push({
        code, name,
        price, pct: +d.changepercent,
        volume: +d.volume, amount,
        turnover: +d.turnoverratio,
        high: +d.high, low: +d.low, open: +d.open, preClose: +d.settlement,
        mktcap: +d.mktcap * 1e4, floatCap: +d.nmc * 1e4,
        speed: 0, listedDate: 0, mainInflow: null, mainPct: null
      });
    }
    await delay(150);
  }
  console.error('[em] 新浪全A：' + out.length + ' 只');
  return out;
}
async function fetchGlobal() {
  const codes = ['usDJI', 'usIXIC', 'usINX', 'hkHSI', 'hkHSTECH'];
  const out = [];
  try {
    const buf = await new Promise((resolve, reject) => {
      const req = https.get(`https://qt.gtimg.cn/q=${codes.join(',')}`, {
        family: 4, headers: { Referer: 'https://gu.qq.com' }, timeout: 8000
      }, res => {
        const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(Buffer.concat(c)));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
    });
    const text = new TextDecoder('gbk').decode(buf);
    const re = /v_(\w+)="([^"]*)"/g;
    let m;
    while ((m = re.exec(text))) {
      const f = m[2].split('~');
      if (f.length > 32 && f[3]) out.push({ code: m[1], name: f[1], price: +f[3], pct: +f[32] });
    }
  } catch (e) {
    // ⛔ 铁律③：外围行情（美股/港股）整条腾讯通道挂了原来一行日志没有，
    //    表现为大盘情绪卡「外围」整行空白，排查时看不到是网络问题还是真无数据。
    _srcWarn('外围行情·腾讯通道失败', `qt.gtimg.cn 拉取失败：${(e && e.message) || e} —— 美股/港股行本轮为空`);
  }
  // 多国扩展：日/韩/德/英/印（新浪 int_/znb_ 国际指数，格式: 名称,价格,涨跌额,涨跌幅）
  try {
    const sina = 'int_nikkei,znb_KOSPI,int_dax30,int_ftse,znb_SENSEX';
    const buf2 = await new Promise((resolve, reject) => {
      const req = https.get(`https://hq.sinajs.cn/list=${sina}`, {
        family: 4, headers: { Referer: 'https://finance.sina.com.cn' }, timeout: 8000
      }, res => {
        const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(Buffer.concat(c)));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
    });
    const text2 = new TextDecoder('gbk').decode(buf2);
    const re2 = /hq_str_(?:int|znb)_(\w+)="([^"]*)"/g;
    const NAME = { nikkei: '日经225', KOSPI: '韩国KOSPI', dax30: '德国DAX', ftse: '英国富时100', SENSEX: '印度SENSEX' };
    let m2;
    while ((m2 = re2.exec(text2))) {
      const f = m2[2].split(',');
      const price = +f[1], chg = +f[3];
      if (!price || !NAME[m2[1]]) continue;
      out.push({ code: m2[1], name: NAME[m2[1]], price, pct: +chg.toFixed(2) });
    }
  } catch (e) {
    _srcWarn('外围行情·新浪国际指数失败', `hq.sinajs.cn 拉取失败：${(e && e.message) || e} —— 日/韩/德/英/印行本轮为空`);
  }
  return out;
}

// ⛔ if 轮：A股四大指数实时快讯（qt.gtimg.cn 单请求，15s 刷新也不心疼）。
//    用途 = 市场情绪卡的「大盘实时」行：全A快照 2 分钟一轮（数据源限制），
//    指数是秒级的，两路各标各的数据时刻，谁也不冒充谁。
//    取不到返回 []（调用方按「没有实时」处理，⛔ 不拿旧值顶替）。
async function fetchIdxRt() {
  const codes = ['1.000001', '0.399001', '0.399006', '1.000688']; // 上证/深成/创业板/科创50
  const NAME = { '1.000001': '上证', '0.399001': '深成', '0.399006': '创业板', '1.000688': '科创50' };
  try {
    const buf = await new Promise((resolve, reject) => {
      const req = https.get(`https://qt.gtimg.cn/q=${codes.join(',')}`, {
        family: 4, headers: { Referer: 'https://gu.qq.com' }, timeout: 8000
      }, res => {
        const c = []; res.on('data', d => c.push(d)); res.on('end', () => resolve(Buffer.concat(c)));
      });
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
    });
    const text = new TextDecoder('gbk').decode(buf);
    const re = /v_([\d.]+)="([^"]*)"/g;
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      const f = m[2].split('~');
      if (f.length > 32 && f[3] && NAME[m[1]]) out.push({ code: m[1], name: NAME[m[1]], price: +f[3], pct: +f[32] });
    }
    return out;
  } catch { return []; }
}

// ---------- 外围联动：美股/港股代表标的 + 新浪行业板块及成分股（东财板块被限流时的备用） ----------
// 外围代表标的：映射A股板块用
async function fetchExtQuotes() {
  const codes = ['usNVDA', 'usAAPL', 'usTSLA', 'usIXIC', 'usINX', 'usDJI', 'hkHSI', 'hkHSTECH'];
  const text = new TextDecoder('gbk').decode(await txGet(`https://qt.gtimg.cn/q=${codes.join(',')}`));
  const out = [];
  const re = /v_(us\w+|hk\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) {
    const f = m[2].split('~');
    const price = +f[3], pre = +f[4];
    if (!price || !pre) continue;
    out.push({ code: m[1], name: f[1], price, pct: +(((price - pre) / pre) * 100).toFixed(2) });
  }
  return out;
}

// 新浪行业板块列表（含板块涨跌幅）
async function fetchSinaSectors() {
  const text = new TextDecoder('gbk').decode(await txGet('https://vip.stock.finance.sina.com.cn/q/view/newSinaHy.php'));
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  return Object.entries(j).map(([node, v]) => {
    const p = v.split(',');
    return { node, name: p[1], pct: +p[5] || 0 };
  }).filter(s => s.name);
}

// 新浪板块成分股（按涨幅降序）
async function fetchSinaSectorStocks(node, num = 60) {
  const text = await txGet(`https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData?page=1&num=${num}&sort=changepercent&asc=0&node=${node}`);
  const j = JSON.parse(text);
  return (j || []).map(s => ({ code: s.code, name: s.name, price: +s.trade, pct: +s.changepercent, turnover: +s.turnoverratio }));
}

// ---------------- 同花顺备用源（东方财富资金流接口被限流时兜底）----------------
// 接口：https://d.10jqka.com.cn/v6/realhead/hs_<code>/last.js  （JSONP，无需鉴权）
// 关键字段：10=最新价 7=今开 8=最高 9=最低 13=成交量(股) 14=外盘(主动买) 15=内盘(主动卖) 19=成交额
// 由此可算出真实「主动净买额/主动买占比」，比纯价格猜测可靠，是资金数据的有效替代
const THS_HEAD = 'https://d.10jqka.com.cn/v6/realhead/hs_';
function thsGet(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const req = require('https').get(url, {
      family: 4,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0', 'Referer': 'https://stockpage.10jqka.com.cn/' },
      timeout
    }, res => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
      const cs = [];
      res.on('data', d => cs.push(d));
      res.on('end', () => resolve(Buffer.concat(cs).toString('utf8')));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
  });
}
async function fetchThsActive(code) {
  const text = await thsGet(`${THS_HEAD}${code}/last.js`);
  const m = /quotebridge_v6_realhead_hs_\w+_last\(([\s\S]*)\)/.exec(text);
  if (!m) return null;
  const items = (JSON.parse(m[1]) || {}).items || {};
  const outer = +items['14'] || 0;   // 外盘（主动买入股数）
  const inner = +items['15'] || 0;   // 内盘（主动卖出股数）
  const vol = +items['13'] || 0;     // 成交量(股)
  const amount = +items['19'] || 0;  // 成交额(元)
  const price = +items['10'] || 0;
  const avg = vol > 0 ? amount / vol : price;  // 当日均价
  const netVol = outer - inner;
  const netAmt = Math.round(netVol * avg);     // 主动净买额(元)
  return {
    code, price, amount, turnoverVol: vol,
    outer, inner, netAmt,
    // 主动买占比 = 净主动买额 / 当日成交额（与东财"主力净占比"量级可比）
    activePct: amount > 0 ? +(netAmt / amount * 100).toFixed(2) : 0
  };
}
// 批量拉取（限制并发，避免被网关 502）
async function fetchThsActiveBatch(codes, limit = 8) {
  const uniq = [...new Set(codes)];
  const rs = await pool(uniq, c => fetchThsActive(c), limit);
  const m = new Map();
  for (const r of rs) if (r && (r.netAmt || r.activePct)) m.set(r.code, r);
  return m;
}

// mj：全 A 官方行业拉取（东财 push2 clist f100 字段）——本机网络对 push2 拒连，仅供【线上容器】调用
// （/api/admin/enrich-industry 一次性任务，落 stock_industry.json 后随发布同步回本地）。
// 多源铁律：clist 失败时退回同花顺板块归属批量（fetchStockBoards 逐票，慢但可达）。
async function fetchIndustryAll(progress) {
  const out = {};
  const fsSegs = ['m:0+t:6', 'm:0+t:80', 'm:1+t:2', 'm:1+t:23'];
  let pages = 0;
  // ⛔ 主源必须整段 try/catch：clist 抛 socket hang up 时不许冲出函数——要落到下面的新浪兜底链。
  try {
    for (const seg of fsSegs) {
      let pn = 1;
      for (;;) {
        const u = `https://push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=f3` +
          `&fs=${encodeURIComponent(seg)}&fields=f12,f14,f100`;
        const j = await getPaged(u, 15000, 2);   // mj：get(url, timeoutNumber) 传对象会炸 TypeError
        const list = j && j.data && j.data.diff;
        if (!list || !list.length) break;
        for (const d of list) { if (d.f12 && d.f100) out[d.f12] = d.f100; }
        pages++;
        if (list.length < 100) break;
        pn++;
        await delay(250);
      }
    }
  } catch (e) { console.log('[industry] 东财 clist 主源异常：' + (e && e.message)); }
  if (progress) progress({ pages, n: Object.keys(out).length });
  // ⛔ 多源铁律（东财 clist 线上也 socket hang up 实证）：clist <1000 → 退新浪行业链
  //   （fetchSinaSectors 全板块 + 逐板块成分股反查 code→行业，约 60-90 次调用）。
  if (Object.keys(out).length < 1000) {
    console.log('[industry] 东财 clist 不可用（' + Object.keys(out).length + '），退新浪行业链…');
    const secs = await fetchSinaSectors();
    let done = 0, fail = 0;
    for (const s of secs) {
      try {
        const list = await fetchSinaSectorStocks(s.node, 300);
        for (const st of (list || [])) { if (st && st.code && !out[st.code]) out[st.code] = s.name; }
      } catch (e) {
        // ⛔ 铁律③ 兜底不许静默：逐板块失败必须计数留痕——否则整条新浪兜底链挂掉无人知晓，
        //    运维只看到「行业映射少了一截」，查不到是两源皆挂还是个别板块抖动。
        fail++;
      }
      done++;
      if (progress) progress({ src: 'sina', secs: done, total: secs.length, n: Object.keys(out).length });
      await delay(120);
    }
    if (fail) console.warn(`[industry] 新浪行业兜底链 ${fail}/${secs.length} 个板块拉取失败（已跳过，行业映射可能残缺）`);
  }
  // ⛔ 铁律③+⑨ 判不出不硬判：两源皆不可用必须显式留痕，绝不拿残缺映射冒充权威
  //   （返回内容不变；调用方 /api/admin/enrich-industry 按 n>1000 阈值不落盘，残缺地图不会污染 stock_industry.json）
  const _indN = Object.keys(out).length;
  if (_indN < 1000) console.warn(`[industry] ⛔ 两源皆不可用：东财 clist + 新浪行业链兜底后仅 ${_indN} 只（<1000）——行业映射残缺，调用方按阈值不落盘`);
  return out;
}

module.exports = { get, delay, pool, classifyNetErr, fetchAllStocks, fetchAllStocksEM, fetchKlineTx, fetchKlineThs, guardDayRow, rebuildDayRow, appendDayRow, dayGuardStats, thsKlineDown, fetchKlineBulk, emKlineDown, fetchSectorFlow, fetchZTPool, fetchZTPoolThs, fetchZTPoolLatestDay, fetchDTCount, thsHighDays, fetchKline, fetchBatchSnapshot, fetchFundFlowDays, fetchBatchFlowEM, flowBalance, fetchGlobal, fetchIdxRt, fetchBatchSnapshotTx, fetchExtQuotes, fetchSinaSectors, fetchSinaSectorStocks, fetchBoardStocks, fetchStockBoards, fetchThsActive, fetchThsActiveBatch, fetchLhb, judgeWhale, fetchZtReason, WHALE_KEYS, dedup, inflightSize, backoffStats, fetchAuctionTicks, fetchIndustryAll };
