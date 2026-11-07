// external_data.js — 外部数据源接入（补平台缺的免费可达源）
// ⛔ 背景：平台已有 em.fetchGlobal()(外围指数 S.global)、em.fetchSectorFlow()(板块主力净流入 S.sectors)、
//    lhbMapCached()(龙虎榜，供规则引擎)。本模块补平台【缺】的 live 源：
//    北向(hk2sh+hk2sz)/南向(sh2hk，港股通)/商品(金油银)/财报(RPT_LICO_FN_CPD)/两融。
// ⛔ 诚实降级（本网络上游确不可达，绝不造假）：两融、解禁、增减持、机构调研、舆情、汇率 ——
//    东财 datacenter 这些 reportName 均「报表配置不存在」、gtimg 汇率 none_match → 标记为 error，不假实现。
//    付费/注册源（期权/期指/筹码L2/盘口逐笔/另类 U/V 组）按用户「付费不要」跳过。
// ⛔ 纪律（沿用平台）：① fetch 失败保留上一次有效值，不抹空；② atomicWrite 落盘；
//    ③ 限流/超时快速失败，不轰炸；④ 双实例各自从其 IP 抓取（云/本机都可达东财腾讯）。
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const EXT_FILE = path.join(__dirname, 'external_data.json');
const _ag = () => new https.Agent({ keepAlive: false, maxSockets: 4, family: 4 });

function httpsGet(url, { timeout = 12000, gb2312 = false, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const rq = https.get(url, { agent: _ag(), headers: Object.assign({ 'User-Agent': 'Mozilla/5.0', Connection: 'close' }, headers) }, s => {
      const cs = []; s.on('data', c => cs.push(c));
      s.on('end', () => { const b = Buffer.concat(cs); resolve(gb2312 ? new TextDecoder('gbk').decode(b) : b.toString('utf8')); });
    });
    rq.on('error', reject); rq.setTimeout(timeout, () => { rq.destroy(); reject(new Error('timeout')); });
  });
}
function jget(url, opt) { return httpsGet(url, opt).then(t => JSON.parse(t)); }
function atomicWrite(p, s) { const tmp = p + '.tmp'; fs.writeFileSync(tmp, s); fs.renameSync(tmp, p); }
function todayStr() { const d = new Date(); const p = n => ('' + n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

// ── 北向/南向资金（沪深港通实时净流入）── push2 kamt/get（2026-10-13 实测可用）
//    kamt 字段语义（已核对实际数值）：hk2sh=沪股通(北向沪)、hk2sz=深股通(北向深)、sh2hk=港股通(南向沪)
//    ⚠️ 旧版把 sh2hk(南向)错塞进「北向深」→ 本轮修正：北向=hk2sh+hk2sz，南向单列=sh2hk。
//    dayNet/monthNet/yearNet 单位：元。面板展示时 ÷1e8 转「亿」。
const NORTH_URL = 'https://push2.eastmoney.com/api/qt/kamt/get?fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
const pickFlow = b => b && ({
  dayNet: b.dayNetAmtIn, monthNet: b.monthNetAmtIn, yearNet: b.yearNetAmtIn,
  threshold: b.dayAmtThreshold, date: b.date2
});
async function fetchNorth() {
  const j = await jget(NORTH_URL);
  const d = j && j.data; if (!d) throw new Error('北向空');
  return { sh: pickFlow(d.hk2sh), sz: pickFlow(d.hk2sz), date: todayStr() };
}
async function fetchSouth() { // 南向（港股通，内资买港股）
  const j = await jget(NORTH_URL);
  const d = j && j.data; if (!d || !d.sh2hk) throw new Error('南向空');
  return pickFlow(d.sh2hk);
}

// ── 商品（纽约黄金/原油/白银）── qt.gtimg.cn（2026-10-13 实测可用）
//    ⚠️ gtimg 期货布局：整串逗号分隔塞在 f[0] 里 → `现价,涨跌额,今开,昨收,...,中文名`
//    pct 用 涨跌额/现价 推算（期货接口不直接给百分比字段）
const COMMOD_URL = 'https://qt.gtimg.cn/q=hf_GC,hf_CL,hf_SI';
function parseCommod(txt) {
  const m = {};
  for (const line of txt.split(';')) {
    const mm = line.match(/v_(hf_\w+)="([^"]*)"/); if (!mm) continue;
    const f = mm[2].split(',');
    const price = parseFloat(f[0]);
    const chg = parseFloat(f[1]);
    const pct = (price && Number.isFinite(chg)) ? +(chg / price * 100).toFixed(2) : null;
    const name = f.find(x => /[一-龥]/.test(x)) || null;
    m[mm[1]] = { name, price: Number.isFinite(price) ? price : null, pct };
  }
  return m;
}
async function fetchCommodities() {
  const txt = await httpsGet(COMMOD_URL, { gb2312: true });
  const m = parseCommod(txt);
  if (!Object.keys(m).length) throw new Error('商品空');
  const get = k => m[k] ? { name: m[k].name, price: m[k].price, pct: m[k].pct } : null;
  return { gold: get('hf_GC'), oil: get('hf_CL'), silver: get('hf_SI') };
}

// ── 两融余额 ── 东财 datacenter 全部 reportName「报表配置不存在」（本网络上游不通），诚实标记不可达，不造假
const MARGIN_CANDIDATES = ['RPT_RZRQ_TOTALNEW', 'RPT_MARGIN_TRADE_SUM'];
async function fetchMargin() {
  let lastErr = '';
  for (const rn of MARGIN_CANDIDATES) {
    try {
      const j = await jget(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${rn}&columns=ALL&source=WEB&client=WEB&pageSize=1`);
      const row = (j && j.result && j.result.data && j.result.data[0]);
      if (row && (row.RZYE || row.RZYE_SZ || row.RQYE)) {
        return { date: row.DATE, rzBalance: row.RZYE || row.RZYE_SZ, rqBalance: row.RQYE, rzBuy: row.RZJME, rqSell: row.RQMCL, reportName: rn };
      }
      lastErr = (j && j.message) || '空数据:' + rn;
    } catch (e) { lastErr = e.message; }
  }
  throw new Error('两融源暂不可达(东财datacenter报表未注册:' + lastErr + ')');
}

// ── 财报（业绩预告/财报季，A股年报季报）── datacenter-web RPT_LICO_FN_CPD（2026-10-13 实测可用）
//    行含 BASIC_EPS/PARENT_NETPROFIT/YSTZ(营收同比)/SJLTZ(净利润同比)/DATATYPE(2025年 年报)。
//    南向/北向/商品/两融走 kamt/datacenter 其它报表；解禁/增减持/调研/舆情/汇率 本网络报表未注册→诚实降级(见 fetchMargin 同因)。
const FIN_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_MARKET,REPORTDATE,BASIC_EPS,PARENT_NETPROFIT,YSTZ,SJLTZ,DATATYPE,UPDATE_DATE&pageSize=40&sortColumns=UPDATE_DATE&sortTypes=-1&source=WEB&client=WEB';
async function fetchFinancials() {
  const j = await jget(FIN_URL);
  const rows = (j && j.result && j.result.data) || [];
  if (!rows.length) throw new Error('财报空');
  const num = v => (typeof v === 'number' ? v : parseFloat(v));
  const toDate = s => (s || '').slice(0, 10);
  let list = rows
    .filter(r => /沪|深/.test(r.TRADE_MARKET || '') || /(SH|SZ)$/i.test(r.SECUCODE || ''))
    .map(r => ({ name: r.SECURITY_NAME_ABBR, code: r.SECURITY_CODE, sjltz: num(r.SJLTZ), ystz: num(r.YSTZ), datatype: r.DATATYPE, reportdate: toDate(r.REPORTDATE) }));
  if (!list.length) throw new Error('财报无A股');
  // ⛔ 2026-10-21 修：东财按 UPDATE_DATE 排序会把「旧财报季修正公告」也顶到前面，
  //    导致 2025 年三季报混进 2026 年三季报高增列表。只保留当前最新财报季（reportdate 最大）。
  const maxReportDate = list.map(x => x.reportdate).filter(Boolean).sort().slice(-1)[0];
  if (maxReportDate) list = list.filter(x => x.reportdate === maxReportDate);
  if (!list.length) throw new Error('财报无最新季数据');
  const high = list.filter(x => Number.isFinite(x.sjltz) && x.sjltz > 50).length;
  const low = list.filter(x => Number.isFinite(x.sjltz) && x.sjltz < 0).length;
  const top = list.filter(x => Number.isFinite(x.sjltz)).sort((a, b) => b.sjltz - a.sjltz).slice(0, 5);
  // ⛔ 2026-10-28 数据源轮（用户「有问题就修」）：东财 UPDATE_DATE 是隔夜批次的「生效日」，
  //    实测 10-28 22:00 拉取返回 2026-10-29（明天）——不是真正的更新时间戳。
  //    直接展示会让面板显示「更新于未来日期」。判不出不硬判：展示值钳到今天（数据确实已可得），
  //    原始值保留在 updatedSrc 供审计，绝不篡改上游数据本身。
  const updatedRaw = (rows[0].UPDATE_DATE || '').slice(0, 10);
  const d = new Date();
  const todayLocal = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const updated = (updatedRaw && updatedRaw > todayLocal) ? todayLocal : updatedRaw;
  return { updated, updatedSrc: updatedRaw, reportSeason: maxReportDate, total: list.length, highGrow: high, lowGrow: low, top };
}

// 宏观/政策/舆情：走平台已有 news 通道（analysis 层从公告/新闻流抽取），本模块不重复造轮子。

async function fetchAll() {
  const snap = { time: new Date().toLocaleString('zh-CN'), items: {}, ok: {}, fail: {} };
  const tasks = [['north', fetchNorth], ['south', fetchSouth], ['commodities', fetchCommodities], ['margin', fetchMargin], ['financials', fetchFinancials]];
  for (const [k, fn] of tasks) {
    try { snap.items[k] = await fn(); snap.ok[k] = true; }
    catch (e) { snap.fail[k] = e.message; }
  }
  return snap;
}

function loadExt() { try { return JSON.parse(fs.readFileSync(EXT_FILE, 'utf8')); } catch { return null; } }
function saveExt(snap) { atomicWrite(EXT_FILE, JSON.stringify(snap)); }

// 落盘失败留痕限频时间戳（intervalMs 默认 60s，磁盘满时不至于每轮都刷）
let _extSaveWarnAt = 0;

// 合并：新抓到的写覆盖；抓失败的源保留上一次有效值（绝不抹空，杜绝"今日无数据"假象）
//
// ⛔ 判不出不硬判（2026-10-29 补）：保留旧值本身是对的（不抹空），但**必须打 stale 标记**。
//    原实现把 prevItems[k] 原样塞回，而 merged.time 是**本次抓取时间** —— 等于
//    「新时间戳 + 旧数据」：下游（/api/state → 面板/复盘/选股）拿到后无法区分这一项是
//    今天的还是三天前的，会把「北向资金已停更三天」当成今日实时值用，正是铁律要防的
//    「拿旧值/猜测冒充当前值」。
//    保留值语义完全不变（不抹空、一个数字都不改），只追加 stale/staleSince/staleReason
//    三个字段供下游判断；成功抓取时 snap.items[k] 是全新对象、天然不带 stale，标记自动
//    清除，不需要手工清。
function mergeExt(prev, snap) {
  const merged = { time: snap.time, items: {}, ok: snap.ok, fail: snap.fail };
  const prevItems = (prev && prev.items) || {};
  for (const k of Object.keys(snap.items)) merged.items[k] = snap.items[k];
  for (const k of Object.keys(snap.fail)) {
    const pv = prevItems[k];
    if (pv && !pv.error) {
      merged.items[k] = Object.assign({}, pv, {
        stale: true,
        // 首次失败时把「上次成功抓取的时间」记为 staleSince；已 stale 则沿用，
        // 绝不刷新成今天（否则会显得数据一直是新的，陈旧程度看不出来）
        staleSince: pv.staleSince || (prev && prev.time) || '',
        staleReason: snap.fail[k]
      });
    } else merged.items[k] = { error: snap.fail[k] };
  }
  return merged;
}

function initExternalData(S, { isPrimary = true, intervalMs = 60 * 1000 } = {}) {
  S.external = loadExt() || { time: '', items: {} };
  let busy = false;
  const tick = async () => {
    if (busy) return; busy = true;
    try {
      const snap = await fetchAll();
      S.external = mergeExt(S.external, snap);
      saveExt(S.external);
    } catch (e) {
      // ⛔ 兜底不许静默：fetchAll 内部已逐源 try/catch，能走到这里基本只剩「落盘失败」
      //    （atomicWrite 的 writeFileSync/renameSync 抛错：磁盘满/权限/只读沙箱）。
      //    原实现 catch {} 空吞 —— 写盘失败 = 内存有值、磁盘没存，进程重启后这些外部
      //    数据整块丢失（表现为「重启后北向/两融全空白」），却查不到任何原因。
      //    60 秒限频：本 tick 默认 60s 一轮，磁盘满时不至于每轮刷一行。
      const now = Date.now();
      if (now - _extSaveWarnAt > 60000) {
        _extSaveWarnAt = now;
        console.warn('[ext] ⚠️ 外部数据抓取/落盘失败（内存保留旧值，磁盘可能未更新，重启会丢）：' + ((e && e.message) || e));
      }
    }
    finally { busy = false; }
  };
  setInterval(tick, intervalMs);
  tick();
  return { tick };
}

module.exports = { initExternalData, fetchAll, loadExt, mergeExt, EXT_FILE };
