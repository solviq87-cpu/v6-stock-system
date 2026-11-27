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
const {requestResearchBytes} = require('./src/core/research-curl-bytes');
const fs = require('fs');
const path = require('path');

const EXT_FILE = path.join(__dirname, 'external_data.json');
const EXT_MAX_BYTES=2*1024*1024;
const extClock=at=>Number.isSafeInteger(at)&&at>0&&at<8e15;
const extDay=at=>new Date(at+28800000).toISOString().slice(0,10);
const extNumber=value=>{
 if(typeof value==='number')return Number.isFinite(value)?value:null;
 if(typeof value!=='string'||!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim()))return null;
 const n=Number(value);return Number.isFinite(n)?n:null;
};
const displayOnly=Object.freeze({quoteAt:null,verifiedLive:false,canTrade:false,canNotify:false,canTrain:false,decisionEligible:false});
async function httpsGet(url, { timeout = 12000, gb2312 = false } = {}) {
  // Same physical request governor as the other public research sources.
  // Do not retry, follow redirects or parse an HTTP error body as market data.
  const response=await requestResearchBytes(url,{maxBytes:EXT_MAX_BYTES,timeoutMs:timeout,processTimeoutMs:13000,compressed:true});
  if(response?.status!==200)throw Object.assign(Error('external HTTP '+(Number.isInteger(response?.status)?response.status:'invalid')),{status:response?.status});
  const raw=response.raw;
  if(!Buffer.isBuffer(raw)||!raw.length||raw.length>EXT_MAX_BYTES)throw Error('external invalid response bytes');
  const length=response.headers?.['content-length'],encoding=response.headers?.['content-encoding'];
  if(length!=null&&(!encoding||String(encoding).toLowerCase()==='identity')&&
    (typeof length!=='string'||!/^\d+$/.test(length)||Number(length)!==raw.length))throw Error('external response length mismatch');
  return new TextDecoder(gb2312?'gbk':'utf-8',{fatal:true}).decode(raw);
}
function jget(url, opt) { return httpsGet(url, opt).then(t => JSON.parse(t)); }
function atomicWrite(p, s) { const tmp = p + '.tmp'; fs.writeFileSync(tmp, s); fs.renameSync(tmp, p); }
function todayStr() { const d = new Date(); const p = n => ('' + n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }

// ── 北向/南向资金（沪深港通实时净流入）── push2 kamt/get（2026-10-13 实测可用）
//    kamt 字段语义（已核对实际数值）：hk2sh=沪股通(北向沪)、hk2sz=深股通(北向深)、sh2hk=港股通(南向沪)
//    ⚠️ 旧版把 sh2hk(南向)错塞进「北向深」→ 本轮修正：北向=hk2sh+hk2sz，南向单列=sh2hk。
//    dayNet/monthNet/yearNet 单位：元。面板展示时 ÷1e8 转「亿」。
const NORTH_URL = 'https://push2.eastmoney.com/api/qt/kamt/get?fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57,f58';
function pickFlow(b,receivedAt,scope){
 if(!b||typeof b!=='object'||Array.isArray(b)||!extClock(receivedAt))return null;
 const dayNet=extNumber(b.dayNetAmtIn),monthNet=extNumber(b.monthNetAmtIn),yearNet=extNumber(b.yearNetAmtIn);
 if([dayNet,monthNet,yearNet].every(v=>v===null))return null;
 const providerDateRaw=typeof b.date2==='string'&&b.date2.length<=64?b.date2:null;
 const iso=providerDateRaw&&/^\d{8}$/.test(providerDateRaw)?providerDateRaw.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'):providerDateRaw;
 const parsed=marginDay(iso),date=parsed&&parsed<=extDay(receivedAt)?parsed:null;
 return {dayNet,monthNet,yearNet,threshold:extNumber(b.dayAmtThreshold),date,providerDateRaw,
  sourceTradeDate:date,source:'eastmoney',scope,receivedAt,unit:null,...displayOnly};
}
async function readConnect(){
 const startedAt=Date.now();if(!extClock(startedAt))throw Error('港股通采集时钟无效');
 const json=await jget(NORTH_URL),receivedAt=Date.now();
 if(!extClock(receivedAt)||receivedAt<startedAt)throw Error('港股通采集时钟倒退');
 return {json,receivedAt};
}
async function fetchNorth(connect=readConnect()) {
 const {json:j,receivedAt}=await connect,d=j?.data;
 const sh=pickFlow(d?.hk2sh,receivedAt,'hk2sh'),sz=pickFlow(d?.hk2sz,receivedAt,'hk2sz');
 if(!sh&&!sz)throw Error('北向资金无有效字段');
 const date=sh?.date&&sh.date===sz?.date?sh.date:null;
 return {sh,sz,date,sourceTradeDate:date,source:'eastmoney',receivedAt,partial:!sh||!sz||!date,...displayOnly};
}
async function fetchSouth(connect=readConnect()) {
 const {json:j,receivedAt}=await connect;
 const south=pickFlow(j?.data?.sh2hk,receivedAt,'sh2hk-only');
 if(!south)throw Error('南向沪港通无有效字段');
 return south;
}

// ── 金油银：保留原腾讯外盘参考入口；无可靠原始报价时点，永远仅展示。
// 现有提供者布局：现价,涨跌额,今开,昨收,...；涨幅分母不能是现价。
// 若字段间矛盾，不以任一数字伪造涨幅；不是经认证的现货或可执行期货行情。
const COMMOD_URL = 'https://qt.gtimg.cn/q=hf_GC,hf_CL,hf_SI';
const COMMOD_CODES=new Set(['hf_GC','hf_CL','hf_SI']);
function parseCommod(txt,receivedAt){
 const m=Object.create(null),seen=new Set(),conflicts=new Set();
 if(typeof txt!=='string'||!extClock(receivedAt))return m;
 for(const line of txt.split(';')){
  const mm=/^\s*(?:var\s+)?v_(hf_\w+)="([^"]*)"\s*$/.exec(line);
  if(!mm||!COMMOD_CODES.has(mm[1]))continue;
  const code=mm[1];
  if(seen.has(code)){delete m[code];conflicts.add(code);continue;}
  seen.add(code);
  if(conflicts.has(code))continue;
  const f=mm[2].split(','),price=extNumber(f[0]),nativeChange=extNumber(f[1]),previousClose=extNumber(f[3]);
  if(price===null||code!=='hf_CL'&&price<=0)continue;
  const consistent=previousClose!==null&&previousClose>0&&nativeChange!==null&&
   Math.abs(price-previousClose-nativeChange)<=1e-6*Math.max(1,Math.abs(price),Math.abs(previousClose),Math.abs(nativeChange));
  const rate=consistent?nativeChange/previousClose*100:null;
  const pct=rate!==null&&Number.isFinite(rate)?Number(rate.toFixed(2)):null;
  const name=f.find(x=>/[\u4e00-\u9fff]/.test(x))||null;
  m[code]={name,price,pct,nativeChange,previousClose,source:'tencent',instrumentCode:code,
   instrumentKind:'provider-futures-reference',unit:null,receivedAt,tradeDate:null,
   returnBasis:pct===null?'unknown':'provider-reference-close-unverified',...displayOnly};
 }
 return m;
}
async function fetchCommodities() {
 const startedAt=Date.now();if(!extClock(startedAt))throw Error('商品采集时钟无效');
 const txt=await httpsGet(COMMOD_URL,{gb2312:true}),receivedAt=Date.now();
 if(!extClock(receivedAt)||receivedAt<startedAt)throw Error('商品采集时钟倒退');
 const m=parseCommod(txt,receivedAt);
 if(!Object.keys(m).length)throw Error('商品无有效参考值');
 return {gold:m.hf_GC??null,oil:m.hf_CL??null,silver:m.hf_SI??null,receivedAt,source:'tencent',...displayOnly};
}

// ── 两融余额 ── 东财 datacenter 全部 reportName「报表配置不存在」（本网络上游不通），诚实标记不可达，不造假
const MARGIN_CANDIDATES = ['RPT_RZRQ_TOTALNEW', 'RPT_MARGIN_TRADE_SUM'];
const marginNumber = value => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value))) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
function marginDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?: 00:00:00)?$/.test(value)) return null;
  const day=value.slice(0,10), at=Date.parse(day+'T00:00:00Z');
  return Number.isFinite(at) && new Date(at).toISOString().slice(0,10)===day ? day : null;
}
function normalizeMarginResponse(json, reportName, receivedAt) {
  if (!MARGIN_CANDIDATES.includes(reportName) || !Number.isSafeInteger(receivedAt) || receivedAt<=0 || receivedAt>=8e15 ||
      json?.success!==true || !Array.isArray(json.result?.data) || json.result.data.length!==1) return null;
  const row=json.result.data[0], date=marginDay(row?.DATE);
  if (!date || date>new Date(receivedAt+28800000).toISOString().slice(0,10)) return null;
  const rzBalance=marginNumber(row.RZYE), rqBalance=marginNumber(row.RQYE), rzBalanceSzReported=marginNumber(row.RZYE_SZ);
  // Distinct source fields cannot replace one another; zero is an observation.
  if ([rzBalance,rqBalance,rzBalanceSzReported].every(n=>n===null)) return null;
  return {date,rzBalance,rqBalance,rzBuy:marginNumber(row.RZJME),rqSell:marginNumber(row.RQMCL),
    rzBalanceSzReported,reportName,receivedAt,sourceQuoteAt:null,
    scope:'provider-reported-fields-unverified',verifiedLive:false,canTrade:false};
}
async function fetchMargin() {
  let lastErr = '';
  for (const rn of MARGIN_CANDIDATES) {
    try {
      const j = await jget(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${rn}&columns=ALL&source=WEB&client=WEB&pageSize=1`);
      const normalized = normalizeMarginResponse(j,rn,Date.now());
      if (normalized) return normalized;
      lastErr = (j && j.message) || '空数据:' + rn;
    } catch (e) {
      if(e?.code==='MARKET_RESTRICTED'||[401,403,429].includes(e?.status??e?.response?.status))throw e;
      lastErr = e.message;
    }
  }
  throw new Error('两融源暂不可达(东财datacenter报表未注册:' + lastErr + ')');
}

// ── 财报（业绩预告/财报季，A股年报季报）── datacenter-web RPT_LICO_FN_CPD（2026-10-13 实测可用）
//    行含 BASIC_EPS/PARENT_NETPROFIT/YSTZ(营收同比)/SJLTZ(净利润同比)/DATATYPE(2025年 年报)。
//    南向/北向/商品/两融走 kamt/datacenter 其它报表；解禁/增减持/调研/舆情/汇率 本网络报表未注册→诚实降级(见 fetchMargin 同因)。
const FIN_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_LICO_FN_CPD&columns=SECURITY_CODE,SECURITY_NAME_ABBR,TRADE_MARKET,REPORTDATE,BASIC_EPS,PARENT_NETPROFIT,YSTZ,SJLTZ,DATATYPE,UPDATE_DATE&pageSize=40&sortColumns=UPDATE_DATE&sortTypes=-1&source=WEB&client=WEB';
function normalizeFinancialPage(j,receivedAt){
 if(!extClock(receivedAt)||j?.success!==true||!Array.isArray(j.result?.data)||!j.result.data.length||j.result.data.length>40)
  throw Error('财报原始报表无效');
 const day=extDay(receivedAt),valid=[];
 for(const r of j.result.data){
  if(!r||typeof r!=='object'||typeof r.SECURITY_CODE!=='string'||!/^\d{6}$/.test(r.SECURITY_CODE)||
     !(typeof r.TRADE_MARKET==='string'&&/沪|深/.test(r.TRADE_MARKET)||typeof r.SECUCODE==='string'&&/(SH|SZ)$/i.test(r.SECUCODE)))continue;
  const reportdate=marginDay(r.REPORTDATE);
  if(!reportdate||reportdate>day||!/-(03-31|06-30|09-30|12-31)$/.test(reportdate))continue;
  const updatedSrc=typeof r.UPDATE_DATE==='string'&&r.UPDATE_DATE.length<=64?r.UPDATE_DATE:null;
  const updatedDay=marginDay(updatedSrc),updated=updatedDay&&updatedDay<=day?updatedDay:null;
  valid.push({name:typeof r.SECURITY_NAME_ABBR==='string'?r.SECURITY_NAME_ABBR:'',code:r.SECURITY_CODE,
   sjltz:extNumber(r.SJLTZ),ystz:extNumber(r.YSTZ),datatype:typeof r.DATATYPE==='string'?r.DATATYPE:null,reportdate,
   updated,updatedSrc,receivedAt,source:'eastmoney',...displayOnly});
 }
 if(!valid.length)throw Error('财报无有效A股报告期');
 const maxReportDate=valid.map(r=>r.reportdate).sort().at(-1),groups=new Map(),conflicts=new Set();
 for(const r of valid.filter(r=>r.reportdate===maxReportDate)){
  const old=groups.get(r.code);
  if(old&&JSON.stringify(old)!==JSON.stringify(r))conflicts.add(r.code);
  if(!old)groups.set(r.code,r);
 }
 const list=[...groups.values()].filter(r=>!conflicts.has(r.code));
 if(!list.length)throw Error('财报最新季无一致证券记录');
 const updated=list.map(r=>r.updated).filter(Boolean).sort().at(-1)??null;
 const updatedSrc=list.map(r=>r.updatedSrc).filter(Boolean).sort().at(-1)??null;
 const known=list.filter(r=>r.sjltz!==null);
 return {updated,updatedSrc,reportSeason:maxReportDate,total:list.length,
  knownGrowthCount:known.length,unknownGrowthCount:list.length-known.length,conflictingSecurityCount:conflicts.size,
  highGrow:known.filter(r=>r.sjltz>50).length,lowGrow:known.filter(r=>r.sjltz<0).length,
  top:known.sort((a,b)=>b.sjltz-a.sjltz).slice(0,5),receivedAt,source:'eastmoney',
  coverage:'provider-limited-latest-report-page',providerPublishedAt:null,...displayOnly};
}
async function fetchFinancials() {
 const startedAt=Date.now();if(!extClock(startedAt))throw Error('财报采集时钟无效');
 const j=await jget(FIN_URL),receivedAt=Date.now();
 if(!extClock(receivedAt)||receivedAt<startedAt)throw Error('财报采集时钟倒退');
 return normalizeFinancialPage(j,receivedAt);
}

// 宏观/政策/舆情：走平台已有 news 通道（analysis 层从公告/新闻流抽取），本模块不重复造轮子。

async function fetchAll() {
  const snap = { time: new Date().toLocaleString('zh-CN'), items: {}, ok: {}, fail: {} };
  let connect; const sharedConnect=()=>connect??=readConnect();
  const tasks = [['north',()=>fetchNorth(sharedConnect())], ['south',()=>fetchSouth(sharedConnect())], ['commodities', fetchCommodities], ['margin', fetchMargin], ['financials', fetchFinancials]];
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

module.exports = { initExternalData, fetchAll, loadExt, mergeExt, EXT_FILE, normalizeMarginResponse };
