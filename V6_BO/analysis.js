// 核心分析：筹码分布模型、综合评分、涨停概率模型、回测
// 约定：中国股市惯例 涨=红 跌=绿（前端负责颜色，这里只算数）

// ---------- 筹码分布（获利盘比例）----------
// 简化筹码模型：每天换手 t% 的筹码被新筹码替换，新筹码按当日均价附近的三角分布落位
function calcProfitRatio(rows) {
  if (!rows || rows.length < 5) return null;
  const bins = []; // {p: 价格, w: 权重}
  const BIN = 0.01; // 1%价格一档
  let binMin = Infinity, binMax = -Infinity;
  const put = (p, w) => {
    const k = Math.round(p / (BIN * p) * 100) / 100; // 归一化到相对档
    const key = Math.round(Math.log(p / 1) * 1000) / 1000;
    let b = bins.find(x => x.key === Math.round(p * 100) / 100);
    if (!b) { b = { key: Math.round(p * 100) / 100, w: 0 }; bins.push(b); }
    b.w += w;
  };
  const recent = rows.slice(-90);
  for (const r of recent) {
    const t = Math.min(Math.max(r.turnover, 0.1), 100) / 100; // 换手比例
    const avg = (r.open + r.close + r.high + r.low) / 4;
    const remain = 1 - t;
    for (const b of bins) b.w *= remain;
    // 当日新筹码：三角分布，权重中心在均价
    const lo = Math.min(r.low, r.open, r.close), hi = Math.max(r.high, r.open, r.close);
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const p = lo + (hi - lo) * i / steps;
      const dist = Math.abs(p - avg) / Math.max(hi - lo, 0.01);
      const w = (1 - dist) * t / (steps + 1);
      put(p, w);
    }
  }
  const last = recent[recent.length - 1].close;
  const total = bins.reduce((s, b) => s + b.w, 0);
  if (total <= 0) return null;
  const profit = bins.filter(b => b.key < last).reduce((s, b) => s + b.w, 0);
  return profit / total; // 0~1
}

// ---------- 涨停判定 ----------
// 限幅只按【板块】判：创业板(30x/301)/科创板(688/689) 20%、北交所(8/4/92) 30%、沪深主板 10%。
// ⛔⛔ 2026-10-21 jn 轮：删掉「沪深主板 ST 降 5%」分支 —— 2026-04 沪深交易所规则修订后，
//   风险警示板（ST/*ST）涨跌幅限制已与主板统一为 ±10%（此前 ±5%）。实证：行情字段
//   price_ceiling=前收×1.10（4.71→5.18 / 9.11→10.02 / 3.41→3.75），本地缓存 383 只 ST 股
//   近月屡有超 ±5% 的价格行为。旧口径后果：ST 涨 4.7% 就被误判"涨停"（污染涨停统计、把能买的
//   票拦进"涨停不可买入"），而真 10% 封板的 ST 票又因 close>按名 5% 限幅被审计单列成
//   "摘帽/更名存疑" —— isLimitUp/连板梯队/涨停池补漏/审计全口径失真。
//   name 参数保留仅为签名兼容（11+ 处调用点），不再参与判定；ST 与主板的区别只在选股侧
//   （isJunkName 过滤），那是另一条口径，不在这里。
function limitPctOf(code, name) {
  const c = String(code || '');
  if (c.startsWith('30') || c.startsWith('68')) return 20;                     // 创业板 / 科创板（含其 ST，20% 不变）
  if (c.startsWith('8') || c.startsWith('4') || c.startsWith('92')) return 30; // 北交所
  return 10;                                                                   // 沪深主板（含 ST/*ST：2026-04 起同限幅）
}
// 2026-10-21 jk 轮：竞价模块仅保留沪深主板与创业板。
//   主板：000/001/002/003/600/601/603/605/606...；创业板：300/301。
//   排除科创板（688/689）与北交所（4xx/8xx/92x）。
function isMainBoard(code) {
  const c = String(code || '');
  return /^(60|00|01|02|03)\d{4}$/.test(c);                                    // 沪深主板（含 002 中小板）
}
function isGEM(code) {
  const c = String(code || '');
  return c.startsWith('30') || c.startsWith('301');                             // 创业板
}
function isMainOrGEM(code) { return isMainBoard(code) || isGEM(code); }
// ⛔ ST / 退市股过滤的唯一入口（2026-10-06 修，重复实现分叉专项）。
//   老写法在全项目散了 8 份 `/ST|退/.test(name)`（外加 2 份带 /i 的），问题有两个：
//     ① **大小写不一致**：过滤用的正则不带 /i，小写 "st某某" 漏判。
//        （历史上还叠过一层：limitPctOf 曾按 /ST/i 给 5% 限幅，与"不过滤小写"自相矛盾；
//         jn 轮 2026-10-21 起限幅只按板块判，限幅与过滤已是两条独立口径，不再互相假设。）
//     ② **漏挂**：scanSteadyUp（连续收涨）一处都没写 → 退市整理板天天 ±10% 乱跳，
//        照样能用 3 根小阳凑出"温和台阶"混进榜（2026-10-01 实测天夏退 0.25 元冲进 ztpre TOP5）。
//   现在统一成这一个函数（带 /i），所有过滤点都调它。
// ⛔ 2026-10-21 修：名字以 "S" 开头的是未股改/退市相关股票（如 S山东铝、S佳通），
//    数据源仍保留但已不能正常交易，必须一并过滤，不能只看 "ST" 或 "退"。
// ⛔ 选股侧过滤 ST 与涨停池收录 ST 封板股【并存不矛盾】（jn 轮 2026-10-21 定调）：
//    池子是市场真相（复盘计数/连板梯队/板块强度要全），推荐侧（一进二/连板接力/精选/
//    次日计划/ztPre）一律不走 ST —— 各推荐入口自行挂 isJunkName，别指望"池里没有"。
function isJunkName(name) { return /^(S|ST|\*ST|退)|退/i.test(String(name || '')); }
// ⛔ 退市整理期股专用判据（2026-10-28 mq 轮）：与 isJunkName 分开，因为两者用途不同 ——
//   isJunkName 是「推荐侧一律不选」，而这里只回答「这只票的题材标签还值不值得信」。
//   退市整理期股（名称带「退」）已无产业逻辑可炒，东财给它的概念板块是纯噪音
//   （10-28 实测 002731 萃华退 被挂「电池技术/锂电池概念」，实际珠宝首饰）→ 不参与题材纠偏。
function isDelistingName(name) { return /退/.test(String(name || '')); }
// ⛔⛔ 涨停家数口径（2026-10-28 用户定调：「退市整理期股不计入」）—— 唯一入口，别在别处再写一份。
//   退市整理期股（名带「退」）确实能封板、也真实成交（002731 萃华退 10-28 收 0.28 真封板），
//   但市场惯例与媒体口径的「今日涨停 N 只」不含它们：它们已不属正常交易生态，计入会让每天的
//   涨停家数虚增，并把板块强度/连板梯队/一进二分母一起带偏（74 vs 73 那种差一只的争论）。
//   实现口径：**不进 S.ztPool（唯一集合）** —— 面板家数、复盘首行、主线板块家数、连板梯队、
//   一进二分母、漏票巡检、抽查脚本全部按池长度统计，一处剔除即全线一致，不存在两套数字打架。
//   ⛔ 与 isJunkName（推荐侧过滤，含 ST）不是一回事：ST 进池但不进推荐（市场真相要全），
//      退市整理期股连池都不进（连家数都不算）。两者可各自独立变化，别合并成一个正则。
//   ⛔ 判据只认名称里的「退」：*ST 摘帽前仍是正常交易标的，不许顺手扩大成 /ST|退/。
function countsInZtTally(name) { return !isDelistingName(name); }
// 池 → 家数口径子集（生产 refreshSectorsZT 落库前、快照恢复时、审计脚本读池后都用它，同源）
function ztTallyOf(pool) { return (Array.isArray(pool) ? pool : []).filter(z => z && countsInZtTally(z.name)); }
// 池 → 被剔除的退市整理期股（留痕用：剔了几只、哪几只，必须能查，不许静默消失）
function ztDroppedOf(pool) { return (Array.isArray(pool) ? pool : []).filter(z => z && !countsInZtTally(z.name)); }
// ⛔ 风格/资金/交易属性类「伪板块」（2026-10-28 mq 轮）：东财个股题材缓存里混着一批不是题材的标签，
//   它们同样能凑够 ≥2 只涨停、热度甚至高于真行业 → 被「自动归类」抢成 z.sector，复盘【主线板块】
//   就出现「基金增仓 5 只」这种对次日毫无指引的假主线（10-28 实测）。⛔ 只挡这类标签，
//   任何真实产业概念（含「电池技术」「国企改革」）都不在表内 —— 别把它改成宽泛正则。
const STYLE_SECTOR_RE = /(低价股|破净|破发股|超跌股|昨日涨停|昨日连板|昨日高换手|昨日高振幅|昨日触板|基金增仓|机构重仓|社保重仓|QFII|MSCI|标普|富时罗素|融资融券|深股通|沪股通|转债标的|预盈预增|业绩预增|参股银行|参股券商)/;
function isStyleSector(name) { return STYLE_SECTOR_RE.test(String(name || '')); }
// 板块自动归类（③ 东财概念兜底）的唯一判据入口：四个条件缺一不可。
//   ztCount=该板块当日涨停家数、heatBest/heatCur=候选板块与原行业的热度、tooBroad=是否吃掉当日>40%涨停。
// ⛔ 退市整理期股 / 伪板块 一律 false —— 这是 10-28 假归因（萃华退→电池·储能）的两个根因，
//   任何一个漏掉都会让复盘写出「某板块爆发，5只涨停」的假结论（同板块 peers 也是假的）。
function canOverrideSector(opt) {
  const o = opt || {};
  if (isDelistingName(o.name)) return false;
  if (!o.board || isStyleSector(o.board)) return false;
  if (!(Number(o.ztCount) >= 2)) return false;
  if (!(Number(o.heatBest) > Number(o.heatCur))) return false;
  if (o.tooBroad) return false;
  return true;
}

// ⛔⛔ 新股上市前 5 个交易日【不设涨跌幅限制】—— 这段时间根本不存在"涨停"（2026-10-06 修）。
//   limitPctOf 只看代码前缀 + 名字，认不出新股：一只上市第 2 天的主板新股涨 30%，
//   会被判成"主板 10cm 涨停" → 混进涨停池、连板梯队、连板数统计、板块龙头，
//   还会被 seedLearnFromHistory 当成"涨停日"灌进学习样本（学出来的规律是假的）。
//   注册制下创业板/科创板新股同样前 5 日无限制，北交所新股首日无限制。
// 为什么用注入钩子而不是改签名：isLimitUp 有 11 处调用点、limitPctOf 更多，
//   而**上市日期只有全A快照里才有**，绝大多数调用点拿不到。用钩子既不破坏签名，
//   又能在拿得到的地方（涨停池/精选池/学习入库）自动生效；没注入时退化为原行为，不会比现在更差。
let _noLimitFn = null;
function setNoLimitFn(fn) { _noLimitFn = typeof fn === 'function' ? fn : null; }
function hasNoLimit(code) { try { return _noLimitFn ? !!_noLimitFn(code) : false; } catch { return false; } }
// ⛔ 唯一入口族：所有"是否涨停/接近涨停"的判定都必须经过这里。
//   2026-10-06 查实（重复实现分叉专项）：同一个判定在全项目被各写了一份，
//     ① analysis.js 的 isLimitUp（容差 0.3，含新股无限制期修复）
//     ② server.js 六处 `pct >= limitPct - 0.5`（连板统计 / 已封板排除）
//     ③ server.js 两处 `pct >= A.limitPctOf(...) - 0.25`（大单流入）
//   三套容差互不相认，后果有两个：
//     · 同一只主板票涨 9.6%：isLimitUp 判 false（9.6 < 9.7），写死 0.5 的那套判 true（9.6 ≥ 9.5）
//       —— 一只票在一个模块里"没涨停"、在另一个模块里"涨停了"。
//     · 写死的 8 处**绕过了 isLimitUp**，于是 bc 版修的新股无涨跌幅限制期在连板统计上
//       根本不生效：新股涨 30% 照样被数成"连板"。
//   容差允许不同（各模块对"算不算封板"的松紧要求确实不同），但**限幅规则必须共用同一份**。
function isLimitUp(code, name, pct) { return isNearLimitUp(code, name, pct, 0.3); }
function isNearLimitUp(code, name, pct, tol) {
  if (hasNoLimit(code)) return false;   // 无涨跌幅限制 → 涨多少都不是"封板"
  const lp = limitPctOf(code, name);
  return (+(pct) || 0) >= lp - (Number.isFinite(tol) ? tol : 0.3);
}
// ⛔⛔ 严口径「收盘贴住涨停价」唯一入口（2026-10-28 mq 轮）——
//   与 isLimitUp 的区别必须说清楚，两把尺子解决两个问题，不许互相替代：
//     · isLimitUp（宽松，pct ≥ 限幅-0.3）：回答「这只票够不够格算封板信号」
//     · sealedAtLimit（严格，收盘价 == round(前收×(1+限幅),2)）：回答「这只票收盘站没站在涨停价上」
//   混用后果（2026-10-28 实测两例）：
//     ① 巡检「疑似漏票」用 pct ≥ 限幅-0.05 → 603699 纽威股份收 38.39、涨停价 38.40（最高触到 38.40
//        后回落到板下 1 分钱 = 触板未封）每天被报成漏票 → 假告警天天发，真漏票反而没人看；
//     ② 002731 萃华退 收 0.28 = round(0.25×1.10,2)，pct 显示 12%（低价股分币舍入），
//        用 pct 判会得出「超过 10% 限幅 = 数据异常」的错误结论。
//   tol 默认 1 分钱：容纳 round 到分 与数据源小数位差异；⛔ 不要为了「多抓几只」放大它。
function sealedAtLimit(code, name, price, preClose, tol) {
  if (hasNoLimit(code)) return false;          // 无涨跌幅限制期：涨多少都不是封板
  const pc = Number(preClose), px = Number(price);
  if (!(pc > 0) || !(px > 0)) return false;
  const upx = Math.round(pc * (1 + limitPctOf(code, name) / 100) * 100) / 100;
  return Math.abs(px - upx) < (Number.isFinite(tol) ? tol : 0.005);
}

// ---------- 一字板判定（B2 轮 2026-10-17） ----------
// 一字板 = 开盘即涨停、且全天贴在涨停价无波动 —— 这种票想买也买不进。
// 为什么需要它：nd 的 maxGain 从「信号日收盘」算起，可次日一字板意味着开盘价=涨停价=
// 全天唯一价。一进二/连板类信号是次日才买入的，遇到一字板根本买不进 —— 把它的 maxGain
// 记成"命中的收益"等于把买不进的票算成业绩（与 hx 轮 isPostHocSample「登记价就在板上」
// 识别的精神一致，区别是那处看信号日、这处看次日）。
// 三条同时成立才判 true（⛔ 任缺一条 false，判不出不猜）：
//   ① 次日确实涨停 —— 走 isLimitUp，自动继承分板块限幅 / ST / 新股无限制期 / 容差 0.3
//   ② 开盘价就到涨停价 —— 涨停价 = 信号日收盘 ×(1+限幅)，容 1 分钱取整误差
//   ③ 全天无波动 —— high/low 都贴在 open 上（容 1 分钱）；盘中破过涨停价（开过板）不算，
//      那种理论上买得进
function isOneLineBoard(code, name, prevClose, nx) {
  if (!nx || !isLimitUp(code, name, nx.pct)) return false;
  const pre = Number(prevClose), open = Number(nx.open), high = Number(nx.high), low = Number(nx.low);
  if (!(pre > 0) || !(open > 0) || !(high > 0) || !(low > 0)) return false;
  const limitPx = Math.round(pre * (1 + limitPctOf(code, name) / 100) * 100) / 100;
  const EPS = 0.011;                     // 1 分钱：容纳价格取整与数据精度
  return open >= limitPx - EPS && high <= open + EPS && low >= open - EPS;
}
// 连板数：从下标 i 往回数连续涨停的天数（**含 i 本身**），遇到非涨停即停。
// minIdx：数到哪个下标为止（默认 0，即一直数到首根 K线）。
//   老代码写的是 `for (j = i; j >= 1; j--)`，也就是最多数到下标 1 —— 用默认 0 会多算一根。
//   差别只在"整段 K线全部涨停"这种不可能出现的极端情形下才有，但保留参数是为了让调用点
//   能 1:1 复刻原语义，替换后连板数一个都不许变。
function limitUpStreak(rows, i, code, name, tol, minIdx) {
  if (!rows || i < 0 || i >= rows.length) return 0;
  const lo = Number.isFinite(minIdx) ? Math.max(0, Math.floor(minIdx)) : 0;
  let n = 0;
  for (let j = i; j >= lo; j--) {
    const r = rows[j];
    if (!r || !isNearLimitUp(code, name, r.pct, tol)) break;
    n++;
  }
  return n;
}

// 单日「爆发日」：这一天有没有涨到接近该板块的涨停 —— 用来判"这只票是不是已经爆发过了"。
//
// ⛔ 为什么不直接用 isNearLimitUp（2026-10-06 加，本轮角度的延伸）：
//    两者语义相反的那一点恰恰在【新股无涨跌幅限制期】：
//      · isNearLimitUp 必须返回 false —— 那段时间不存在涨停，涨 30% 也不是"封板"；
//      · isSurgeDay   必须返回 true  —— 新股上市前几天一天涨 30~40%
//        恰恰是**最典型**的爆发。判成"没爆发"就会被当成"还没启动"，
//        而 focused 是精选池的**主键排序依据**，等于把波动最大的票顶到池子最前面。
//    新股拿不到真实限幅，按 20% 当代理值（注册制新股前 5 日，用主板 10% 太松、
//    用北交所 30% 太紧；20% 是中间值，宁可判成爆发、别把它推到前面）。
function isSurgeDay(code, name, pct, tol) {
  const lim = hasNoLimit(code) ? 20 : limitPctOf(code, name);
  return (+(pct) || 0) >= lim - (Number.isFinite(tol) ? tol : 1);
}

// ---------- 综合评分（0-100，用户条件的软评分版）----------
// k: {rows, profitRatio}, rank: {turnoverRank2d(两日换手排名/全市场), total}, extra: {mainPct, pct, zt90, zt5, inSectorZT}
// ⛔ gm 轮（用户「接入市场优质大模型，优化改此模型，提高胜率」）：按有数据支撑的
//    优质量化因子重整评分。满分 94 → 98，四项调整全部可在守门 _test_model_factor.js 里反证：
//    ① 近3日上涨 12→10 分且加「追高降温」：A股短期动量 IC 全年为负、反转才有效，
//       「3连阳」不再是满分理由 —— 3日累计已大涨(>12%)的正是典型追高区；
//    ② 两日换手排名 15→12 分（让权重给第 9 项）；
//    ③ 90日涨停基因 15→9 分：它回答「历史有没有股性」，而实测「近5日涨停」的
//       次日涨停率约40%，是最强单一因子，回答「现在正不正在风头上」；
//    ④ 新增第 9 项「近5日涨停基因」(10分) 与第 10 项「量能结构」(5分)：
//       缩量首板晋级率 20.3% vs 放量首板 15.1%，爆量是情绪高潮不是强势。
function scoreStock(o) {
  // ⛔ 2026-10-07 补：rows 缺失时原来直接 `rows.slice(-3)` 崩（TypeError）。
  //    当前调用点都会先取到 rows，属"暂不可达"，但这是评分主链路 —— 兜一次不费事，
  //    免得以后有人换了调用顺序就整条选股链路崩掉。
  const { profitRatio, turnoverRank2d, total, mainPct, pct, zt90, zt5 } = o || {};
  const rows = (o && o.rows) || [];
  // 没有 K 线就谈不上评分。⛔ 这里原来是 `return { score: 0 }` —— 0 是一个**真实的低分**，
  //   会参与排序、会去比那条「评分线 75」，等于用「判了，很差」冒充「没判」。
  //   （同一条原则在八字四维那儿早已落实：baziDim 明写「不许用 50 冒充判出来的分」）
  //   现在按 MISS_RULE 的 clear 类处理：给 null 并把 basis 说清楚。
  if (!rows.length) return { score: null, detail: {}, basis: { rows: 0, avail: 0, missing: ['全部（无K线）'], partial: [], zt90Win: 0 } };
  // 「这份分到底算全了没有」：avail = 本次真正计入的满分；missing = 数据不足根本没算的项；
  // partial = 算了但窗口不足（得分系统性偏低）。三者一起随分返回，调用方必须能说出来。
  let s = 0; const detail = {};
  let avail = 0; const missing = [], partial = [];
  // 1. 近3日上涨（3日>=2涨入门，满分3涨）
  // ⛔ gm 轮：A股短期动量 IC 全年为负、反转才有效 ——「3连阳」本身不再是满分理由：
  //    3日累计已经大涨(>12%)的正是典型追高区，给满分等于系统在鼓励用户接盘。
  //    现在 3连阳且累计温和(<=12%)才拿满档；3连阳但累计过大只留基础分
  //    （降温不是判死：仍高于 2 阳档，更高于 0）。
  const last3 = rows.slice(-3);
  const upDays = last3.filter(r => r.pct > 0).length;
  const cum3 = last3.reduce((a, r) => a + (Number(r.pct) || 0), 0);
  detail['3日上涨'] = `${upDays}/3` + (upDays >= 3 ? `·累${cum3.toFixed(1)}%` : '');
  s += upDays >= 3 ? (cum3 <= 12 ? 10 : 4) : upDays === 2 ? 6 : 0;
  avail += 10;
  if (rows.length < 3) partial.push(`近3日上涨（仅${rows.length}日，满窗需3日）`);
  // 2. 涨幅温和 ≤7%（涨停首板放行给一半分）
  const maxPct3 = Math.max(...last3.map(r => r.pct));
  if (maxPct3 <= 7) s += 8;
  else if (maxPct3 <= 9.9) s += 4;
  avail += 8;
  detail['3日最大涨幅'] = `${maxPct3.toFixed(1)}%`;
  // 3. 获利筹码
  const pr = profitRatio == null ? 0 : profitRatio * 100;
  detail['获利筹码'] = `${pr.toFixed(0)}%`;
  // ⛔ 获利盘算不出来（K线不足 5 根）时这一项**不计入 avail**，而不是按 0 计分：
  //    按 0 计 = 悄悄扣掉 15 分还装作判过了。
  if (profitRatio == null) missing.push('获利筹码');
  else { avail += 15; s += pr >= 85 ? 15 : pr >= 70 ? 11 : pr >= 50 ? 6 : 0; }
  // 4. 两日换手排名（gm 轮：15→12 分，权重让给第 9 项「近5日涨停基因」）
  const rk = Number.isFinite(turnoverRank2d) && turnoverRank2d > 0 ? turnoverRank2d : null;
  detail['换手排名'] = rk === null ? '未知' : `${rk}/${Number.isFinite(total) ? total : '未知'}`;
  if (rk === null) missing.push('换手排名');
  else { s += rk <= 100 ? 12 : rk <= 300 ? 7 : rk <= 600 ? 4 : 0; avail += 12; }
  // 5. 90日涨停次数（gm 轮：15→9 分。它回答「这只票历史有没有股性」；
  //    而实测「近5日涨停」的次日涨停率约40%，是最强单一因子，回答「现在正不正在风头上」）
  detail['90日涨停'] = `${zt90}次`;
  s += zt90 >= 3 ? 9 : zt90 === 2 ? 6 : zt90 === 1 ? 3 : 0;
  avail += 9;
  // 窗口不足 90 根时，这一项算的是「N 日内涨停几次」而不是「90 日内」—— 天然偏低
  if (rows.length < 90) partial.push(`90日涨停基因（仅${rows.length}日窗口，满窗需90日）`);
  // 6. 主力资金
  const mp = Number.isFinite(mainPct) ? mainPct : null;
  detail['主力净占比'] = mp === null ? '未知' : `${mp.toFixed(1)}%`;
  if (mp === null) missing.push('主力净占比');
  else { s += mp > 0 ? 6 : 0; s += mp >= 10 ? 8 : mp >= 5 ? 5 : 0; avail += 14; }
  // 7. 当日涨幅处于后排蓄势区(2~7%)更适合跟风
  if (pct >= 2 && pct <= 7) s += 10; else if (pct > 0 && pct < 2) s += 5;
  avail += 10;
  // 8. 换手温和不过热
  const t1 = rows[rows.length - 1].turnover;
  if (t1 >= 3 && t1 <= 20) s += 5;
  avail += 5;
  detail['今日换手'] = `${t1.toFixed(1)}%`;
  // 9. 近5日涨停基因（gm 轮新增，10 分）
  // 实测依据：近5日板过的票次日涨停率约40%，是单一因子里的最强者；
  // 90日窗口回答「历史有没有股性」，这一项回答「现在正不正在风头上」。
  // ⛔ 调用方没传 zt5（老调用方 / 第三方）→ 进 missing、不计 avail：
  //    按 0 计分 = 悄悄扣掉 10 分还装作判过了（同第 3 项获利盘的处理）。
  if (Number.isFinite(zt5)) {
    detail['近5日涨停'] = `${zt5}次`;
    s += zt5 >= 2 ? 10 : zt5 === 1 ? 6 : 0;
    avail += 10;
    if (rows.length < 5) partial.push(`近5日涨停基因（仅${rows.length}日，满窗需5日）`);
  } else missing.push('近5日涨停基因');
  // 10. 量能结构：缩量 vs 爆量（gm 轮新增，5 分）
  // 实测依据：缩量首板晋级率 20.3% vs 放量首板 15.1%；且 A股短期反转下
  // 「爆量」是情绪高潮（接力资金已经进场、分歧巨大），不是强势信号。
  const _v1 = Number(rows[rows.length - 1].volume);
  const _prev = rows.slice(-6, -1).map(r => Number(r.volume)).filter(v => isFinite(v) && v > 0);
  if (isFinite(_v1) && _v1 > 0 && _prev.length >= 3) {
    const _avg = _prev.reduce((a, b) => a + b, 0) / _prev.length;
    const _vr = _avg > 0 ? _v1 / _avg : 0;
    detail['量能比'] = _vr.toFixed(2) + '倍';
    s += _vr <= 0.7 ? 5 : _vr <= 1.3 ? 3 : _vr <= 2.5 ? 1 : 0;
    avail += 5;
  } else missing.push('量能结构（成交量数据不足）');
  return {
    score: Math.min(Math.round(s), 100), detail,
    basis: { rows: rows.length, avail, missing, partial, zt90Win: Math.min(90, rows.length) }
  };
}

// ---------- 涨停概率模型（后排股）----------
// 特征 → logistic → 0~1。权重为经验先验；没有独立样本外校准证明。
function limitUpProbability(f) {
  // f: {score, mainPct, profitRatio(0-100), zt90, sectorZT, gap(距涨停的百分比点), turnover, inflowStreakMin(连续流入分钟)}
  let z = -2.6;
  z += 0.028 * (f.score || 0);                       // 综合评分
  z += 0.055 * Math.min(f.mainPct || 0, 20);         // 主力净占比
  z += 0.02 * Math.min(f.profitRatio || 0, 95);      // 获利盘
  z += 0.35 * Math.min(f.zt90 || 0, 5);              // 历史涨停基因
  z += 0.22 * Math.min(f.sectorZT || 0, 8);          // 板块效应
  z += 0.12 * Math.min(f.inflowStreakMin || 0, 10);  // 资金持续流入分钟数
  z -= 0.28 * Math.max(f.gap || 0, 0);               // 距涨停越近概率越高
  if (f.turnover >= 3 && f.turnover <= 20) z += 0.3; // 换手温和
  if (f.turnover > 35) z -= 0.4;                     // 过热
  return 1 / (1 + Math.exp(-z));
}

// ---------- 回测（近两个月，逐日回放）----------
// universe: [{code,name,rows(95天K线)}]，对每个交易日D：
//  用截至D的数据算评分，统计其后1日涨停/大涨(+5%)的命中率，按分数段输出
//
// ⛔⛔ 2026-10-22 ju 轮自查修复（三层根因，表象是 routes_smoke 一条红）：
//   原实现是纯同步双循环，全市场约 5000 只×35 个交易日≈17.5 万次评分，实测要把
//   【整个服务】冻住 3 分钟——那 3 分钟里 /api/state、/api/mobile-digest、SSE 全部
//   排队，线上观看设备看到的就是「面板卡死」；而 /api/backtest 路由是「先秒回 pending、
//   再算」的写法，pending 只是把冻结藏起来了，并没有让出事件循环。冒烟测试（本机回环
//   免检=开发者）打到 /api/backtest 会真触发回测，下一个路由 /api/backtest/result
//   排在 3 分钟后面，90 秒超时 → 「连接被关闭，无任何响应」稳定红；且测试进程退出后
//   回测还在烧 CPU，拖垮随后时序敏感的套件（_runall 时红时绿的负载抖动来源之一）。
//   现在拆成三层，算法只有一份实现（生成器），杜绝两套逻辑分叉：
//     · backtestSteps  —— 生成器版核心：每算完一只票 yield 一次
//     · backtest       —— 同步版：原语义原样保留（一次性脚本/守门真跑依赖它）
//     · backtestAsync  —— 异步版：每个 yield 点 await setImmediate 让出循环，
//                          服务端路由改用它，pending 期间其它请求最坏只等一只票（≈1ms）
function* backtestSteps(universe, tradingDaysBack = 40) {
  const buckets = { '80-100': { n: 0, hit: 0 }, '60-79': { n: 0, hit: 0 }, '40-59': { n: 0, hit: 0 }, '0-39': { n: 0, hit: 0 } };
  const days = new Set();
  const perDay = [];
  let unknownOutcomeCount = 0;
  for (const st of (universe || [])) {
    const rows = st.rows;
    if (!rows || rows.length < 45) continue;
    const start = Math.max(5, rows.length - tradingDaysBack);
    for (let i = start; i < rows.length - 1; i++) {
      const hist = rows.slice(0, i + 1);
      const d = hist[hist.length - 1];
      const next = rows[i + 1];
      if (!Number.isFinite(next.pct)) { unknownOutcomeCount++; continue; }
      const day = String(d.date || '').replace(/-/g, '');
      if (/^\d{8}$/.test(day)) days.add(day);
      const pr = calcProfitRatio(hist);
      const zt90 = hist.slice(-90).filter(r => isLimitUp(st.code, st.name, r.pct)).length;
      // gm 轮：近5日涨停基因（与实盘同一把尺子，回测才量得出新因子到底有没有用）
      const zt5 = hist.slice(-5).filter(r => isLimitUp(st.code, st.name, r.pct)).length;
      // 没有历史全市场横截面排名，不能用绝对换手编造排名；资金仅接受当时可得证据。
      const cutoff = /^\d{8}$/.test(day) ? Date.parse(day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T15:00:00+08:00') : null;
      const fundsKnown = Number.isFinite(d.mainPct) && Number.isFinite(d.fundsKnownAt) &&
        Number.isFinite(cutoff) && d.fundsKnownAt > 0 && d.fundsKnownAt <= cutoff;
      const score = scoreStock({
        rows: hist, profitRatio: pr, turnoverRank2d: null, total: null,
        mainPct: fundsKnown ? d.mainPct : null, pct: d.pct, zt90, zt5
      });
      const sc = score.score;
      const hit = isLimitUp(st.code, st.name, next.pct) || next.pct >= 5;
      const bk = sc >= 80 ? '80-100' : sc >= 60 ? '60-79' : sc >= 40 ? '40-59' : '0-39';
      buckets[bk].n++; if (hit) buckets[bk].hit++;
      perDay.push({ date: d.date, code: st.code, name: st.name, score: sc, scoreBasis: score.basis, nextPct: next.pct, hit });
    }
    yield;   // 每只票算完让出一次（异步版的让出点；同步版只是空转一次，代价可忽略）
  }
  const summary = {};
  for (const [k, v] of Object.entries(buckets)) {
    const rate = v.n ? +(v.hit / v.n * 100).toFixed(1) : null;
    summary[k] = { 样本数: v.n, 事件数: v.hit, 历史事件频率: rate === null ? '-' : rate + '%', frequencyPct: rate,
      次日涨停或涨5pct概率: rate === null ? '-' : rate + '%' };
  }
  // 高分段（>=70分）的同一收盘事件历史频率，不能校准当日封板模型。
  const hi = perDay.filter(x => x.score >= 70);
  return {
    schemaVersion: 2, kind: 'historical-event-frequency', target: 'next-observed-bar-close-limit-up-or-close-gain-5pct',
    labelDefinition: '信号日之后一根已知日K的收盘涨幅达到该股涨停判定，或收盘涨幅至少5%',
    calibrationCertified: false, executionSimulated: false, historicalUniverseVerified: false,
    unknownOutcomeCount, observedUniverseSize: (universe || []).length,
    limitations: ['当前可见股票与缓存组成的研究样本，非点时动态全市场', '未模拟T+1成交、费用、滑点或净收益', '换手横截面排名未知，历史资金缺当时可得证据则未知', '历史事件频率不校准当日封板模型或推送阈值'],
    交易日数: days.size, 股票数: (universe || []).length, 总样本: perDay.length,
    分数段命中率: summary,
    高分样本数: hi.length,
    高分事件频率: hi.length ? +(hi.filter(x => x.hit).length / hi.length * 100).toFixed(1) + '%' : '-',
    高分胜率: hi.length ? +(hi.filter(x => x.hit).length / hi.length * 100).toFixed(1) + '%' : '-',
    明细样本: perDay.sort((a, b) => b.score - a.score).slice(0, 30)
  };
}
// 同步版：跑完整个生成器才返回（语义与拆分前完全一致）
function backtest(universe, tradingDaysBack = 40) {
  const it = backtestSteps(universe, tradingDaysBack);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
// 异步分片版：每个 yield 点让出事件循环，重活不再冻结整个服务
async function backtestAsync(universe, tradingDaysBack = 40) {
  const it = backtestSteps(universe, tradingDaysBack);
  let r = it.next();
  while (!r.done) {
    await new Promise(res => setImmediate(res));
    r = it.next();
  }
  return r.value;
}

// ---------- 趋势票模块（用户新增条件）----------
const ma = (vals, n) => vals.length >= n ? vals.slice(-n).reduce((s, v) => s + v, 0) / n : null;

// 趋势基础检查：连续3日上涨 / 缩量上涨 / 站上5日线 / 三日资金净流入 / 前高压力位
function trendCheck({ rows, fundDays, price }) {
  if (!rows || rows.length < 25) return null;
  const closes = rows.map(r => r.close);
  const today = rows[rows.length - 1];
  const ma5 = ma(closes.slice(0, -1), 5) || ma(closes, 5); // 用不含实时的昨收算基准，盘中以 price 对比
  const last5 = closes.slice(-5).reduce((s, v) => s + v, 0) / 5;
  const prevHigh20 = Math.max(...rows.slice(-21, -1).map(r => r.high)); // 前20日最高（不含今日）
  const up3 = rows.slice(-3).every(r => r.pct > 0);
  // ⚠️ 2026-10-19 it2：缩量上涨判据补「两日量都必须 >0」——同花顺延迟会把「缺成交」冒充 volume=0，
  //   此时 today.volume(0) < prev.volume(>0) 恒成立，会把「没数据」误判成「缩量上涨」。缺量一律不判缩量。
  const shrinkUp = today.pct > 0 && today.volume > 0 && rows[rows.length - 2].volume > 0 && today.volume < rows[rows.length - 2].volume; // 缩量上涨
  const fund3d = Array.isArray(fundDays) && fundDays.length >= 3 &&
    fundDays.slice(-3).every(d => d && typeof d.main === 'number' && Number.isFinite(d.main))
    ? fundDays.slice(-3).every(d => d.main > 0) : null; // 三日主力净流入
  return {
    ma5: +last5.toFixed(2), prevHigh20: +prevHigh20.toFixed(2),
    up3, shrinkUp, fund3d,
    aboveMa5: price > last5,                     // 盘中价格站上5日线
    brokeHigh: price > prevHigh20,               // 盘中突破前高
    nearMa5: Math.abs(price - last5) / last5 < 0.03
  };
}

// ---------- 趋势类榜单通用「卫生」前提：市值门槛 + 20 日波动体检 ----------
// ⛔ 2026-10-07 抽出来（本轮角度：同一条规则被复制到新位置时，前提有没有一起带过去）。
//    这两条原本只长在 trendPoolCheck 里，而【同样往"趋势票"榜单灌票、同样会推给用户】的
//    另外两条路 —— 全市场趋势扫描 scanTrendUniverse、连续收涨 scanSteadyUp —— 各自重写了
//    一套更短的过滤（垃圾名 / 低价 / 已封板 / 连板），把用户点名要的两条前提漏在门外：
//      ① 流通市值 ≥ 50 亿（"微盘股的'趋势'是做出来的，不是走出来的"）
//      ② 20 日上蹿下跳出局（"K线上蹿下跳的你放里面回调风险那么大你放里面不是害人吗"）
//    结果就是同一台机器里两种"趋势票"：池子里那只过了体检，扫描榜里那只没过。
//    现在三条路共用这一份，改一处三处同改。
// ⚠️ 这里只出**原始体检数据**，不下"出局"结论 —— 结论由 trendVerdict 按通道给。
//    因为"上蹿下跳"的门槛是分通道的（温和通道三条、强势通道只一条），
//    把结论合进体检里、又默认成某一档，等于把"这条票走的是哪条通道"这个前提弄丢
//    —— 那正是本轮要治的病。
function trendHygiene(rows, price, floatCap) {
  const empty = { capYi: null, capOk: null, amp20: null, swingDays: 0, maxUp: null, maxDown: null };
  if (!Array.isArray(rows) || rows.length < 21 || !(price > 0)) return empty;
  const _px = (r, ns) => { for (const n of ns) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; };
  const amps = [];
  let swingDays = 0, maxUp = null, maxDown = null;
  for (let i = Math.max(1, rows.length - 20); i < rows.length; i++) {
    const r = rows[i], p0 = rows[i - 1];
    const base = _px(p0, ['close', 'c']) || _px(r, ['close', 'c']);
    const hi = _px(r, ['high', 'h']), lo = _px(r, ['low', 'l']);
    if (base > 0 && hi > 0 && lo > 0) amps.push(((hi - lo) / base) * 100);
    const p = _px(r, ['pct']);
    if (Math.abs(p) >= 5) swingDays++;
    if (maxUp == null || p > maxUp) maxUp = p;
    if (maxDown == null || p < maxDown) maxDown = p;
  }
  const amp20 = amps.length ? +(amps.reduce((s, v) => s + v, 0) / amps.length).toFixed(1) : null;
  // 市值门槛：拿不到市值数据时**不拦** —— 缺数据不判死，跟"缺K线按中性"同一个原则。
  const capYi = floatCap > 0 ? +(floatCap / 1e8).toFixed(1) : null;
  const capOk = capYi == null ? null : capYi >= 50;
  return { capYi, capOk, amp20, swingDays, maxUp, maxDown };
}

// 按通道给"出局"结论（trendHygiene 的原始数据 → 判据）。
// ⛔ channel 必须显式传：'温和' = 沿5日线慢爬那类；'强势' = 允许涨停/大涨但趋势未坏那类；
//   'V反' = 低位放量长阳/V型起涨那类。
//   三条通道的抖动门槛**不是同一条**（见下面注释），所以调用方必须声明自己走哪条 ——
//   忘传时按 '温和'（更严的一侧）判：宁可少报，也不能让没体检的票混进榜单。
// ⛔ 强势 / V反 通道只认"20日内被砸≤-7%"这一条：**不要**把 swingDays≥4 用在这条通道上，
//    那等于把"单日涨超5%"当成抖动，恰好筛掉最强势的那批票（奥士康 002913 被判死过一次）。
function trendVerdict(hg, channel) {
  const sw = hg || {};
  const amp20 = sw.amp20, swingDays = sw.swingDays || 0, maxUp = sw.maxUp, maxDown = sw.maxDown;
  const jumpyGentle = (amp20 != null && amp20 > 5.5) || swingDays >= 4 ||
    (maxUp != null && maxUp >= 7 && maxDown != null && maxDown <= -7);
  const jumpyStrong = maxDown != null && maxDown <= -7;
  const ch = (channel === '强势' || channel === 'V反') ? channel : '温和';
  const jumpy = (ch === '强势' || ch === 'V反') ? jumpyStrong : jumpyGentle;
  const jumpWhy = [];
  if (amp20 != null && amp20 > 5.5) jumpWhy.push(`近20日日均振幅${amp20}%`);
  if (ch === '温和' && swingDays >= 4) jumpWhy.push(`20日内${swingDays}天单日涨跌超±5%`);
  if (maxUp != null && maxUp >= 7 && maxDown != null && maxDown <= -7) jumpWhy.push(`20日内既有单日+${maxUp}%又有${maxDown}%`);
  if ((ch === '强势' || ch === 'V反') && jumpyStrong) jumpWhy.push(`20日内被砸${maxDown}%`);
  return { channel: ch, jumpy: !!jumpy, jumpWhy };
}

// ---------- 趋势票池专用检查：资金流入 + 股价沿五日线震荡 ----------
// rows: 日K；fundDays: 近几日主力资金流[{main}]；price: 现价；mainInflow: 今日主力净流入
function trendPoolCheck({ rows, fundDays, price, mainInflow, thsNetAmt, floatCap, code, name }) {
  if (!rows || rows.length < 25 || !price) return null;
  const closes = rows.map(r => r.close);
  const ma5now = closes.slice(-5).reduce((s, v) => s + v, 0) / 5;
  const ma5prev = closes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5;
  const ma5now2 = ((ma5now * 5 - closes[rows.length - 1]) + price) / 5; // 用现价修正今日ma5
  const ma5up = ma5now > ma5prev * 1.001; // 5日线向上
  const dev = (price - ma5now2) / ma5now2; // 现价对5日线乖离
  const nearMa5 = Math.abs(dev) <= 0.03;   // 沿5日线（±3%内）
  const last5 = rows.slice(-5);
  // 震荡：近5日无单日暴涨（涨幅≤7%）、无破位暴跌（≤-6%）、收盘都在5日线±6%内
  const gentle = last5.every(r => r.pct <= 7 && r.pct >= -6) &&
    last5.every(r => Math.abs(r.close - ma5now) / ma5now <= 0.06);
  // 资金流入：三日主力净流入合计>0；无资金流数据时用今日主力净流入>0 兜底；
  // 资金流接口被限流时进一步降级为量价代理（放量+收涨≈资金参与），接口恢复后自动用回真实数据
  const fund3dSum = Array.isArray(fundDays) && fundDays.length >= 3 &&
    fundDays.slice(-3).every(d => d && typeof d.main === 'number' && Number.isFinite(d.main))
    ? fundDays.slice(-3).reduce((sum, d) => sum + d.main, 0) : null;
  // 资金四级保障：① 东财三日主力净流入 → ② 东财当日主力净流入 → ③ 同花顺外盘/内盘(主动净买) → ④ 量价代理
  // 东财资金接口被限流时，用同花顺的真实主动买盘顶上，而不是直接退化成"量价代理"
  let fundIn = false, proxy = false, source = 'em';
  if (fund3dSum != null) fundIn = fund3dSum > 0;
  else if (typeof mainInflow === 'number' && Number.isFinite(mainInflow)) fundIn = mainInflow > 0;
  // 有同花顺真实资金数据就按它一锤定音：净流出直接判不合格，
  // 不再回落到偏乐观的"量价代理"（否则会拿放量上涨的假象掩盖真实的资金出逃）
  else if (typeof thsNetAmt === 'number' && Number.isFinite(thsNetAmt)) { fundIn = thsNetAmt > 0; source = 'ths'; }
  else {
    const amt = rows[rows.length - 1].amount, amtPrev = rows[rows.length - 2].amount;
    if (amt > amtPrev * 0.98 && rows[rows.length - 1].pct >= 0) { fundIn = true; proxy = true; source = 'price'; }
  }
  // ── 中期趋势判据（2026-09-30 新增）──────────────────────────────────────
  // 用户原话：「趋势票池怎么都是那些走势难看的」。查实：原判据只有
  //   ma5up && nearMa5 && gentle && fundIn —— 一条中期均线都没看。
  // 于是一只从高位跌下来、在底部弱反弹几天的票，只要贴着 5 日线磨一磨 +
  // 有点资金回流，就会被判成「多头趋势未破坏的回踩中继」。
  // 用户看到的正是这类「跌了一大截、还在底部趴着」的票，当然觉得难看。
  // 现在补三条中期硬判据，不满足就直接出局：
  //   ① 现价必须在 20 日线【上方】：站不住中期均线 = 下跌途中的反弹，不是趋势；
  //   ② 20 日线必须走平或向上：下行通道里的小反弹一律不算趋势；
  //   ③ 距 60 日高点回撤 ≤25%：腰斩后在底部磨的，不叫「趋势未破坏」。
  const c20 = closes.slice(-20);
  const ma20now = c20.reduce((s, v) => s + v, 0) / c20.length;
  const p20 = closes.slice(-21, -1);
  const ma20prev = p20.length >= 20 ? p20.reduce((s, v) => s + v, 0) / p20.length : ma20now;
  const ma20up = ma20now >= ma20prev * 0.998;                       // 走平或向上（容 0.2% 抖动）
  const aboveMa20 = price > ma20now;
  let ma60now = null, aboveMa60 = null;
  if (closes.length >= 60) {
    ma60now = closes.slice(-60).reduce((s, v) => s + v, 0) / 60;
    aboveMa60 = price > ma60now;
  }
  const _hi60Rows = rows.slice(-60);
  // ⛔ 实际窗口必须跟着值一起返回（dj 轮）：rows 只有 32 根时这里算的是「32 日高点」，
  //    而文案一律写「距60日高点」—— 说的和算的不是一回事，且不留痕迹。
  const hi60Win = _hi60Rows.length;
  const hi60 = Math.max(..._hi60Rows.map(r => (r && r.high) || 0));
  const dd60 = hi60 > 0 ? (hi60 - price) / hi60 : 0;                 // 距60日高点回撤
  const midOk = aboveMa20 && ma20up && dd60 <= 0.25;

  // ── 市值门槛（2026-09-30 用户指定：「趋势票池加上一个条件市值大于五十亿」）──────────
  // 微盘/小盘股几千万就能拉出一根漂亮阳线，"趋势"是做出来的不是走出来的，
  // 真回调时也没有承接盘。用**流通市值**（比总市值更苛刻：流通市值≥50亿 ⇒ 总市值必然≥50亿）。
  // 拿不到市值数据时**不拦**——缺数据不判死，跟"缺K线按中性"同一个原则。
  // 市值门槛与 20 日波动体检改为从 trendHygiene 取（与另两条趋势榜单同一份，避免各写一套）
  const _hg = trendHygiene(rows, price, floatCap);
  const capYi = _hg.capYi;
  const capOk = _hg.capOk;

  // ── 波动体检（2026-09-30 用户原话：「K线上蹿下跳的你放里面回调风险那么大你放里面不是害人吗」）──
  // 原判据只看近5日（gentle：无单日>7%、无<-6%），5 天太短 —— 一只票可以前面 15 天
  // 上蹿下跳、最近 5 天恰好走得乖，照样混进"趋势池"。现在把视野拉到 20 日。
  const _px = (r, ns) => { for (const n of ns) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; };
  const amp20 = _hg.amp20;
  const swingDays = _hg.swingDays, maxUp = _hg.maxUp, maxDown = _hg.maxDown;
  // 「上蹿下跳」的判据与通道绑定，见 trendVerdict（温和三条 / 强势一条）。
  // 这里先占位，等下面 channel 算出来再回填 —— 判据必须和通道同一个 tick，
  // 不能先按默认通道判一次、后面再按真通道改（那就是"同一条规则两处口径"）。
  let jumpy = false, jumpWhy = [];

  // ── 连续小阳线拉升（2026-09-30 用户点名：「你自己也都多看看有没有那种连续小阳线拉升的」）──
  // 这类票不靠一根大阳拉起来，是每天一点点往上抬 —— 回撤小、趋势真，正是趋势池该有的样子。
  // 判据：近8日 ≥5 根小阳(0<pct≤5%)、累计涨 2%~15%、期间无单日>6%脉冲、无单日<-3%大阴；
  // 再看**最长连续阳线数**（零散 5 根阳不算"连续"，必须真连着）。
  const d8 = rows.slice(-8);
  const yang8 = d8.filter(r => { const p = _px(r, ['pct']); return p > 0 && p <= 5; }).length;
  const sum8 = +d8.reduce((s, r) => s + _px(r, ['pct']), 0).toFixed(1);
  const pulse8 = d8.some(r => _px(r, ['pct']) > 6);
  const yin8 = d8.some(r => _px(r, ['pct']) < -3);
  let run = 0, runMax = 0;
  for (const r of d8) { const p = _px(r, ['pct']); if (p > 0) { run++; if (run > runMax) runMax = run; } else run = 0; }
  const smallYang = yang8 >= 5 && !pulse8 && !yin8 && sum8 >= 2 && sum8 <= 15;
  const steadyRun = smallYang && runMax >= 4;   // 更严一档：真的连着涨

  // ── 强势趋势通道（2026-10-01 新增 · 用户点名奥士康）──────────────────────
  // 奥士康 002913：8/19 57.47 → 9/30 91.76（+59.7%），中途 9/9 +9.93%、9/16 涨停、9/29 涨停，
  //   是教科书级的台阶式趋势票 —— 而系统对它登记的信号是 **0 条**。
  //   根因就在上面那条 gentle：它要求「近5日没有任何一天涨超 7%」，
  //   于是**最强势的那批票恰好全被判死**，池子里只剩贴着 5 日线磨的弱票。
  //   用户那句「趋势池里的票趋势在哪里」的答案就是这个：判据在反着筛。
  // 修法不是把 gentle 放宽（那会把上蹿下跳的票一起放进来），而是**分成两条通道**：
  //   温和通道 = 沿 5 日线慢慢爬（原判据，保留）
  //   强势通道 = 允许中途涨停/大涨，但必须证明「趋势没坏」
  // 强势通道五条硬判据（缺一不可）：
  //   ① 20 日线向上         —— 中期趋势还在
  //   ② 收盘站上 10 日线     —— 允许贴着，但不许破位（破 10 日线 = 趋势断了）
  //   ③ 距 60 日高回撤 ≤20% —— 还在高位区间，不是腰斩后的反弹
  //   ④ 均线至少部分多头     —— ma5>ma10 或 ma10>ma20
  //   ⑤ 60 日内有涨停基因    —— 被资金认可过，不是自娱自乐
  // 另外两条一票否决：高连板（≥4 板，回落风险大）、上蹿下跳（jumpy 已在外面判）
  const ma10now = closes.length >= 10 ? closes.slice(-10).reduce((s, v) => s + v, 0) / 10 : null;
  const aboveMa10 = ma10now != null ? price >= ma10now * 0.995 : null;    // 容 0.5% 贴线
  const partBull = (ma5now2 > ma10now || ma10now > ma20now);
  // ⛔ 连板数/涨停基因必须走唯一入口（2026-10-06 修，重复实现分叉专项）。
  //   这里原本自己写 `pct >= 9.5` 当"通用门槛"，注释还写着"创业/科创20%只会更严，属保守"
  //   —— 这句是错的：20cm 票的涨停是 20%，9.5% 只到它的一半，压根不算涨停；
  //   于是"60日内有涨停基因"这条硬判据对创业板/科创板/北交所几乎永远不成立（强势通道被关死），
  //   反过来主板 ST 的真涨停（旧口径 5% 限幅）也撞不上那个 9.5% 通用门槛。现在按板块限幅判，与全项目同一份口径。
  //   拿不到 code/name 时（老调用点未传）退化为 10% 限幅，等价于原来的 9.5%，不会比修之前更差。
  const lb = limitUpStreak(rows, rows.length - 1, code, name, 0.5, 1);
  let zt60 = 0;
  const lo60 = Math.max(0, rows.length - 60);
  const zt60Win = rows.length - lo60;   // 实际窗口（不足 60 根时是真实根数）
  for (let k = lo60; k < rows.length; k++) if (isNearLimitUp(code, name, _px(rows[k], ['pct']), 0.5)) zt60++;
  const strongWhy = [];
  if (!ma20up) strongWhy.push('20日线未向上');
  if (!(aboveMa10 === true)) strongWhy.push('已跌破10日线');
  if (!(dd60 <= 0.20)) strongWhy.push(`距60日高回撤${(dd60 * 100).toFixed(1)}%`);
  if (!partBull) strongWhy.push('均线未多头');
  if (zt60 < 1) strongWhy.push('60日内无涨停基因');
  const strongOk = ma20up && aboveMa10 === true && dd60 <= 0.20 && partBull && zt60 >= 1 && lb < 4;

  // ── V型反转/放量起涨通道（2026-10-22 用户点名图上走势）──────────────────────
  // 特征：经历一段下跌/整理后，今日以放量大阳线从低位拉起、站上 20 日线，
  //   趋势刚刚转强。它与强势通道的区别：强势通道要求均线已多头、有涨停基因；
  //   V反通道抓的是「刚启动第一根放量长阳」—— 不等涨停基因确认。
  // 硬判据（缺一不可）：
  //   ① 今日涨幅 ≥5% 且未涨停（已涨停归涨停池，不重复抓）
  //   ② 收盘站上 20 日线
  //   ③ 今日低点 ≤ 前 5 日低点（真从近期低点拉起来，不是追高）
  //   ④ 距 60 日高回撤 ≤40%（不要跌太透，上方还有空间）
  //   ⑤ 今日成交量 ≥ 前 5 日均量 1.5 倍（放量）
  //   ⑥ 今日开盘价 ≤ 昨日收盘价 1.02（不是大幅跳空，是真从低位拉起来）
  //   ⑦ 高连板（≥4 板）一票否决，上蹿下跳走 trendVerdict。
  const today = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const todayOpen = _px(today, ['open', 'o']);
  const todayHigh = _px(today, ['high', 'h']);
  const todayLow = _px(today, ['low', 'l']);
  const todayPct = _px(today, ['pct']);
  const todayAmt = _px(today, ['amount', 'amt']);
  const prevClose = _px(prev, ['close', 'c']);
  const amt5 = rows.slice(-6, -1).reduce((s, r) => s + _px(r, ['amount', 'amt']), 0) / 5;
  const lowPrev5 = Math.min(...rows.slice(-6, -1).map(r => _px(r, ['low', 'l'])));
  const atRecentLow = todayLow > 0 && lowPrev5 > 0 && todayLow <= lowPrev5 * 1.02; // 今日低点为近5日最低附近
  const volBurst = amt5 > 0 && todayAmt >= amt5 * 1.5;
  const limitPct = limitPctOf(code, name);
  const bigYang = todayPct >= 5 && todayPct < limitPct * 0.95; // 未涨停
  const realReversal = prevClose > 0 && todayOpen <= prevClose * 1.02; // 非大幅跳空
  const vReversalWhy = [];
  if (!(todayPct >= 5)) vReversalWhy.push(`今日涨幅${todayPct}%<5%`);
  if (todayPct >= limitPct * 0.95) vReversalWhy.push(`今日接近涨停(${todayPct}%)`);
  if (!aboveMa20) vReversalWhy.push('未站上20日线');
  if (!atRecentLow) vReversalWhy.push('今日低点未触及前5日低点（不是从近期低位拉起）');
  if (!(dd60 <= 0.40)) vReversalWhy.push(`距60日高回撤${(dd60 * 100).toFixed(1)}%>40%（跌太透）`);
  if (!volBurst) vReversalWhy.push(`今日量未达前5日均量1.5倍`);
  if (!realReversal) vReversalWhy.push('今日大幅跳空高开');
  if (lb >= 4) vReversalWhy.push('连板≥4板');
  const vReversal = bigYang && aboveMa20 && atRecentLow && dd60 <= 0.40 &&
    volBurst && realReversal && lb < 4;

  // 通道判定：温和（贴5日线慢爬）/ 强势（有涨停但趋势未坏）/ V反（低位放量长阳起涨）
  let channel = null;
  if (ma5up && nearMa5 && gentle) channel = '温和';
  else if (strongOk) channel = '强势';
  else if (vReversal) channel = 'V反';
  // 通道不同，抖动门槛不同：温和通道按三条（它本就该走得平），
  // 强势 / V反 通道只认"被砸过大阴"这一条（涨得猛不是罪）。判据唯一入口 trendVerdict。
  // channel 为 null（三条通道都不满足）时按温和判，反正下面 !!channel 也会把它挡掉。
  const _jv = trendVerdict(_hg, channel || '温和');
  jumpy = _jv.jumpy; jumpWhy = _jv.jumpWhy;

  // V反 通道放宽中期均线要求：不要求 20 日线已向上，但仍须站上 20 日线且回撤可控。
  const midOkForChannel = channel === 'V反' ? (aboveMa20 && dd60 <= 0.40 && atRecentLow) : midOk;

  // ── 经典技术指标（2026-10-01 接入：KDJ / 缠论分型 / 量价形态）────────────
  // 以前这几项一个都没实现，选股全靠自编的形态规则，用户问"你用了哪些技术指标"
  //   时答不上来。现在算出来，并且**真的参与打分**（不是只挂在返回值里给人看）。
  const kdj = calcKDJ(rows);
  const fx = findFenxing(rows);
  const vp = volPricePattern(rows);

  const ok = fundIn && midOkForChannel && capOk !== false && !jumpy && !!channel;
  // ⚠️ 这一行必须有：下面所有 hint 都是 `= (hint||0) ± n` 的写法，漏了声明就
  //    ReferenceError —— 而且 node --check 查不出来（纯语法检查），只有真跑才炸。
  //    （2026-10-01 踩过：插入技术指标时漏了这行，trendPoolCheck 一调用就抛。）
  let trendScoreHint = 0;
  // KDJ：超买扣分（风险），刚金叉加分，刚死叉扣分，持续空头扣分。
  // ⚠️ 旧写法只看 cross（交叉当天才有值）有个洞：金叉后连涨 20 天的票反而得 0 分，
  //    而那恰恰是最该推的票。现在区分"刚交叉"与"持续状态"（state / crossAge）。
  if (kdj && kdj.k >= 85) trendScoreHint = (trendScoreHint || 0) - 8;
  if (kdj && kdj.cross === '金叉') trendScoreHint = (trendScoreHint || 0) + 6;
  else if (kdj && kdj.cross === '死叉') trendScoreHint = (trendScoreHint || 0) - 6;
  else if (kdj && kdj.state === '空头') trendScoreHint = (trendScoreHint || 0) - 4;
  // 量价：拉升/吸筹加分，试盘与放量滞涨减分
  if (vp && vp.kind === '拉升') trendScoreHint = (trendScoreHint || 0) + 6;
  else if (vp && vp.kind === '吸筹') trendScoreHint = (trendScoreHint || 0) + 4;
  else if (vp && vp.kind === '试盘') trendScoreHint = (trendScoreHint || 0) - 4;

  // 趋势强度（0~100）：替代"涨停概率"作为趋势池自己的排序依据。
  // 以前按资金流入绝对值排序 → 大盘股金额天然大就排前面，跟"趋势好不好"没关系。
  let trendScore = 30;
  if (aboveMa20) trendScore += 8;
  if (aboveMa60 === true) trendScore += 10;
  else if (aboveMa60 === false) trendScore -= 10;
  if (ma5now2 > ma20now && ma20now > (ma60now == null ? 0 : ma60now)) trendScore += 12;   // 多头排列
  const r20 = closes.length > 20 ? (price - closes[closes.length - 21]) / closes[closes.length - 21] * 100 : null;
  if (r20 != null) trendScore += Math.max(-12, Math.min(15, r20 / 1.5));                   // 中期涨幅（连续）
  // 回撤用连续计分而不是"≤8% 就加分"：否则一堆票全挤在满分上，排不出先后（实测 99/99/99/31）。
  // 距60日高点每多回撤 1% 就少 0.8 分 —— 被砸得越狠分越低，这才是"趋势健不健康"的真实刻度。
  trendScore += Math.max(-6, (25 - dd60 * 100) * 0.8);
  const hi20 = Math.max(...rows.slice(-20).map(r => (r && r.high) || 0));
  if (hi20 > 0 && price >= hi20 * 0.995) trendScore += 8;                                  // 站在20日新高附近
  if (fundIn) trendScore += 7;
  // 连续小阳线是"好趋势"里最稳的一种 → 加分；上蹿下跳是"看着强实则危险" → 重扣。
  // （jumpy 已经直接出局，这里的扣分是为了让分数本身也诚实：万一将来放宽出局条件，分数不会骗人）
  if (steadyRun) trendScore += 10;
  else if (smallYang) trendScore += 6;
  // 强势通道（有涨停基因 + 中期均线上行 + 贴住高点）= 真趋势在走，给足分，
  // 否则它们会被"沿5日线慢爬"的弱票挤到后面 —— 那正是奥士康被埋没的另一种形式。
  // V反通道：低位放量长阳刚刚转强，趋势起点，给分但略低于已确认的强势通道。
  if (channel === '强势') trendScore += 14;
  else if (channel === 'V反') trendScore += 10;
  if (jumpy) trendScore -= 18;
  // 市值太小 → 形态可信度打折（不单独出局，交给 capOk 决定）
  // ⛔ 判不出来（capOk === null：备用源不带 floatCap）也要打折，只是比"已知小盘"轻一档
  //    （2026-10-06 修，本轮角度：降级路径与正常路径是不是同一把尺子）。
  //    原来 null 一分不扣，于是「已知 40 亿 -10 分、市值未知 0 分」—— 等于奖励数据缺失：
  //    同一只小盘股，行情源降级那天反而比正常那天排得更靠前。
  if (capOk === false) trendScore -= 10;
  else if (capOk === null) trendScore -= 5;
  trendScore = Math.max(0, Math.min(100, Math.round(trendScore + (trendScoreHint || 0))));

  return {
    ok, ma5: +ma5now2.toFixed(2), dev: +(dev * 100).toFixed(1),
    ma5up, nearMa5, gentle, fundIn, proxy, source,
    // 中期趋势（新增，面板与推送据此解释"它到底处在什么位置"）
    ma20: +ma20now.toFixed(2), ma60: ma60now == null ? null : +ma60now.toFixed(2),
    aboveMa20, aboveMa60, ma20up, dd60: +(dd60 * 100).toFixed(1),
    r20: r20 == null ? null : +r20.toFixed(1), midOk, trendScore,
    // 市值 / 波动体检 / 连续小阳（2026-09-30 新增）
    capYi, capOk, capUnknown: capOk === null, amp20, swingDays,
    maxUp: maxUp == null ? null : +maxUp.toFixed(1),
    maxDown: maxDown == null ? null : +maxDown.toFixed(1),
    jumpy, jumpWhy,
    yang8, sum8, runMax, smallYang, steadyRun,
    // 强势通道（2026-10-01 新增，为奥士康这类"中途会涨停"的真趋势票开的门）
    channel, strongOk, strongWhy, ma10: ma10now == null ? null : +ma10now.toFixed(2),
    aboveMa10, partBull, lb, zt60, hi60Win, zt60Win,
    // V型反转/放量起涨通道（2026-10-22 新增，用户点名图上走势）
    vReversal, vReversalWhy, todayPct: +todayPct.toFixed(2), volRatio: amt5 > 0 ? +(todayAmt / amt5).toFixed(2) : null,
    // 经典技术指标（2026-10-01 补齐并参与打分）
    kdj, fenxing: fx, volPrice: vp, trendScoreHint,
    thsNetAmt: thsNetAmt == null ? null : thsNetAmt, // 同花顺主动净买（元）
    fund3dSum: fund3dSum == null ? null : +(fund3dSum / 1e4).toFixed(0) // 万元
  };
}

// ---------- 大单性质判别（2026-09-30 新增）----------
// 用户原话：「大单流入 的下跌趋势中有大单流入也正常 而且还是些冷门板块 你要注意分辨」
// 查实：scanBigMoney 的入池条件只有「主力净占比>门槛 且 净额>0 且 涨幅 0~8%」，
//   一条位置/趋势/板块判据都没有 → 大盘权重股（银行/石油/地产）主力占比天然高，
//   而它们多数正处在下跌通道里，那笔「大单」很可能是护盘、接盘或对倒，不是买入信号。
//   实测某日 12 只里 9 只在下跌趋势中、12/12 全是冷门板块 —— 用户说的两个毛病同时成立。
// 本函数只回答一个问题：**这笔大单发生在什么位置**，给「性质」+「可信度权重」。
// 买不买的决策交给上层（scanBigMoney 的加权排序与推送闸门），这里不做决定。
// ⚠️ K 线字段名多名字兼容（v1 只认 r.c/h/l/v 导致 4/6 维度恒为常数，见 learnall 事故）。
const _bmN = (r, names) => { for (const n of names) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; };
function bigMoneyContext({ rows, price }) {
  if (!rows || rows.length < 25 || !price) return null;
  const closes = rows.map(r => _bmN(r, ['close', 'c', 'closePrice'])).filter(v => v > 0);
  if (closes.length < 25) return null;
  const highs = rows.map(r => _bmN(r, ['high', 'h']));
  const ma = (n, arr) => { const a = (arr || closes).slice(-n); return a.length >= n ? a.reduce((s, v) => s + v, 0) / n : null; };
  const ma5 = ma(5), ma20 = ma(20), ma60 = ma(60);
  const ma20prev = closes.length >= 21 ? (closes.slice(-21, -1).reduce((s, v) => s + v, 0) / 20) : ma20;
  const aboveMa20 = ma20 ? price > ma20 : null;
  const aboveMa60 = ma60 ? price > ma60 : null;
  const ma20up = ma20 && ma20prev ? ma20 >= ma20prev * 0.998 : null;  // 走平或向上
  const ma5up = ma5 && closes.length >= 6 ? ma5 > (closes.slice(-6, -1).reduce((s, v) => s + v, 0) / 5) : null;
  const base20 = closes[closes.length - 21];
  const r20 = base20 ? +(((price - base20) / base20) * 100).toFixed(1) : null;   // 近20日涨幅%
  const hi60 = Math.max(...highs.slice(-60).filter(v => v > 0), 0);
  const dd60 = hi60 > 0 ? +(((hi60 - price) / hi60) * 100).toFixed(1) : null;    // 距60日高点回撤%
  // —— 趋势状态三分类：下降通道 / 上升通道 / 其余（震荡或深跌底部）——
  const downTrend = aboveMa20 === false && ma20up === false;   // 20日线下 + 20日线向下 = 明确下降通道
  const upTrend = aboveMa20 === true && ma20up === true && aboveMa60 !== false;
  const deepFall = dd60 != null && dd60 > 28;                  // 距60日高点跌掉近三成
  const atHigh = dd60 != null && dd60 <= 6 && r20 != null && r20 >= 15; // 已经拉在高位
  let flowKind, weight;
  if (downTrend && deepFall) { flowKind = '深跌后承接'; weight = 0.40; }
  else if (downTrend) { flowKind = '下跌途中接盘'; weight = 0.25; }
  else if (upTrend && dd60 != null && dd60 <= 12) { flowKind = '趋势中加仓'; weight = 1.00; }
  else if (upTrend) { flowKind = '回踩承接'; weight = 0.85; }
  else if (aboveMa20 === true && ma20up === true) { flowKind = '趋势中加仓'; weight = 0.80; } // 无60线数据的次优判定
  else { flowKind = '震荡整理'; weight = 0.60; }
  // 「高位」「仍在60日线下」是**风险修饰项**，不抢占性质名：
  // 一只票可以同时是「趋势中加仓 + 已在60日高点附近」—— 那该提示的是"别追高"，
  // 而不是把它改名成别的性质。性质只回答"位置在哪"，风险单独打折+单独写进 note。
  const risks = [];
  if (atHigh) { weight *= 0.85; risks.push('已在60日高点附近，警惕拉高出货'); }
  if (aboveMa60 === false) { weight *= 0.70; risks.push('仍在60日线下方，属下跌后的反弹而非反转'); }
  const notes = [];
  if (flowKind === '下跌途中接盘') notes.push('下降通道里的大单，多为护盘/接盘/对倒，不是买入信号');
  if (flowKind === '深跌后承接') notes.push('已距60日高点回撤' + dd60 + '%，属抄底或护盘单，需二次确认');
  if (flowKind === '趋势中加仓') notes.push('上升通道中的加仓，资金与趋势同向');
  if (flowKind === '回踩承接') notes.push('趋势未破但已有回撤，属回调承接');
  if (flowKind === '震荡整理') notes.push('均线交织无明确方向，大单含金量待观察');
  return {
    ma5: ma5 == null ? null : +ma5.toFixed(2),
    ma20: ma20 == null ? null : +ma20.toFixed(2),
    ma60: ma60 == null ? null : +ma60.toFixed(2),
    aboveMa20, aboveMa60, ma20up, ma5up,
    r20, dd60,
    downTrend: downTrend === true, upTrend: upTrend === true,
    deepFall: deepFall === true, atHigh: atHigh === true,
    flowKind, weight: +weight.toFixed(3), risks,
    note: notes.concat(risks).join('；')
  };
}

// ---------- 压力位 / 止损位 / 止盈建议 ----------
// 压力位：60日内摆动高点（局部高点）聚类；止损：5日线与3日最低取近者，保底-8%；
// 止盈：第一目标=第一压力位，第二目标=第二压力位，附盈亏比
// todayHigh/todayLow：盘中实时最高/最低——价格创新高后压力位实时上移
function computeLevels(rows, price, todayHigh, todayLow) {
  if (!rows || rows.length < 25 || !price) return null;
  const recent = rows.slice(-60);
  const highs = [];
  for (let i = 2; i < recent.length - 2; i++) {
    const h = recent[i].high;
    if (h > recent[i - 1].high && h > recent[i - 2].high && h > recent[i + 1].high && h > recent[i + 2].high) highs.push(h);
  }
  // 把当日盘中最高价也纳入候选压力位（实时变动）
  const above = [...new Set(highs.map(h => Math.round(h * 100) / 100))];
  if (todayHigh && todayHigh > price * 1.005) above.push(Math.round(todayHigh * 100) / 100);
  const aboveSorted = above.filter(h => h > price * 1.005).sort((a, b) => a - b);
  const r1 = aboveSorted[0] || +(Math.max(...recent.slice(-20).map(r => r.high))).toFixed(2);
  const r2 = aboveSorted.find(h => h > r1 * 1.005) || +(r1 * 1.1).toFixed(2);
  const closes = rows.map(r => r.close);
  const ma5 = +(closes.slice(-5).reduce((s, v) => s + v, 0) / 5).toFixed(2);
  const low3 = +Math.min(...rows.slice(-3).map(r => r.low)).toFixed(2);
  // 止损：5日线与3日最低之间取更近者（先触发即离场），且最大亏损控制在8%以内
  let stop = Math.max(ma5, low3);
  stop = Math.max(stop, +(price * 0.92).toFixed(2));
  stop = Math.min(stop, +(price * 0.97).toFixed(2)); // 止损不会贴得太近（<3%无意义）
  const t1 = +(r1 * 0.995).toFixed(2); // 压力位前一点兑现
  const t2 = +r2.toFixed(2);
  const rr = price - stop > 0 ? +(((t1 - price) / (price - stop))).toFixed(1) : null;
  // 加减仓思路（结合价位与资金留存）
  const advice = [
    { type: '建仓', text: `现价${price}附近轻仓建仓（不超过计划仓位1/3），止损${stop.toFixed(2)}` },
    { type: '加仓', text: `回踩5日线${ma5}缩量企稳不破 → 低吸加仓1/3` },
    { type: '加仓', text: `放量突破第一压力位${r1}并站稳15分钟 → 加仓或顺势跟进` },
    { type: '减仓', text: `涨至第一目标${t1}附近滞涨/放量不涨 → 减仓1/3~1/2落袋` },
    { type: '减仓', text: `触及第二目标${t2} → 清仓或只留底仓` },
    { type: '止损', text: `跌破${stop.toFixed(2)}（5日线${ma5}与3日最低${low3}先到先走）→ 无条件离场` }
  ];
  if (rr != null) advice.push({ type: '纪律', text: `盈亏比 1:${rr}${rr >= 2 ? '（合格，可按计划执行）' : '（偏低，轻仓试探或放弃）'}` });
  return { r1, r2, ma5, low3, stop: +stop.toFixed(2), t1, t2, rr, advice };
}

// ---------- 复盘模块：涨停股形态标记 + 涨停原因归因 + 次日涨停概率 ----------
// 形态标记（基于日K + 盘中价）
function reviewFlags(rows, price) {
  if (!rows || rows.length < 25) return null;
  const closes = rows.map(r => r.close);
  const ma5 = +(closes.slice(-5).reduce((s, v) => s + v, 0) / 5).toFixed(2);
  const prevHigh20 = Math.max(...rows.slice(-21, -1).map(r => r.high));
  const r3 = rows.slice(-3);
  // 量价齐升：近3日量能递增且价格重心上移
  const volPriceUp = r3.length === 3 &&
    r3[2].volume > r3[1].volume && r3[1].volume > r3[0].volume &&
    r3[2].close > r3[1].close && r3[1].close > r3[0].close;
  // gr 轮（2026-10-13 早盘后）：168 项「采纳」候选条件实证批量复测（_research_gr/2/3.js）
  //   涨停日切片 n=2562（剔一字板），结局=次日触板，两半窗同向 + 共线性交叉检验全部通过。
  //   · volRatio：当日量能 / 近 20 日量能中位（量比）。缩量涨停(<0.8)在每档绝对换手内都多触板
  //     +13~17pp（n=165，阈值 0.4~1.0 两半窗同向），与现有 to<1 绝对换手项不共线（相对自身历史 vs 绝对换手）。
  //   · brkEngulf：连板中途断板（昨阴）今反包封板 —— 连板群内次日触板 25.3% vs 非反包 40.0%（-14.7pp，两半窗同向）。
  const curVol = Number(rows[rows.length - 1].volume) || 0;
  const vArr = rows.slice(-20).map(r => Number(r.volume) || 0).sort((a, b) => a - b);
  const vMed = vArr.length ? vArr[Math.floor(vArr.length / 2)] : 0;
  // ⚠️ 2026-10-19 it2：当日量缺失（同花顺延迟冒充 volume=0）时 curVol=0，volRatio 会算成 0 误判「缩量涨停」。
  //   判「缩量涨停」要求当日量真实存在（>0），缺量 → null 落中性档，不按缩量加分。
  const volRatio = vMed > 0 && curVol > 0 ? +(curVol / vMed).toFixed(2) : null;
  const rN1 = rows[rows.length - 2], rN2 = rows[rows.length - 3];
  const brkEngulf = (rN1 && rN2) ? (rN1.close < rN2.close && price >= rN1.high) : false;
  // gs 轮（2026-10-13 午后）：167 项「采纳」实证筛出的两个结构/时间因子（_research_gs.js，两半窗同向+三环境全正+不共线）。
  //   gapUp：今日跳空高开>1%（Q15 真突破≡跳空收板；跳空开且收回落的"假突破"在涨停日切片里 n=0，故二者等价）。
  //   sigDate：信号日（涨停日）日期，供 nextDayLimitProb 做月初/周几次生效应调整；缺数据=null 不判。
  const rLast = rows[rows.length - 1], rPrev = rows[rows.length - 2];
  const gapUp = (rPrev && rPrev.close > 0) ? (rLast.open / rPrev.close - 1) * 100 > 1 : false;
  const sigDate = rLast && rLast.date ? rLast.date.slice(0, 10) : null;
  // hf 轮（2026-10-14）：P11 CCI(14) 实证后接入（_research_hf.js，涨停日切片 n=551，剔一字板/ST/北交所/新股）。
  //   实测（基线 37.6%）：CCI>150 次日触板 40.1%(n=274, Δ+2.5) vs 50~150 36.5%(n=192, Δ-1.1)
  //   vs ≤50 31.8%(n=85, Δ-5.8) —— 三档全部两半窗同向、三层市场环境无显著变差
  //   （>150 档 down -1.0 / side +1.2 / up +6.9），单调结构干净：越极端强势延续越好、越弱越差。
  //   系数取实测 log-odds 差保守端：>150 +0.105→+0.1／≤50 -0.257→-0.2（见 nextDayLimitProb）。
  //   公式与实证脚本逐字同源：TP=(H+L+C)/3 取近 14 根（含当日），CCI=(TP-SMA14)/(0.015×MD14)。
  //   ⛔ 判不出不判：任一根缺 high/low/close → 整体 null；
  //      MD=0（14 根 TP 全同，如长期一字板）→ null（CCI=0 是中性值，塞进 ≤50 弱档=把缺数据当看空）；
  //      缺数据绝不被当成"低 CCI"罚分。
  const cci = (() => {
    const w = rows.slice(-14);
    if (w.length < 14) return null;
    const tp = [];
    for (const r of w) {
      const h = _tN(r, ['high', 'h']), l = _tN(r, ['low', 'l']), c = _tN(r, ['close', 'c']);
      // ⛔ 任一根缺 high/low/close → 整体 null：半根数据算出来的 CCI 是"看似合理的错值"，
      //    比没有更糟 —— 判不出就不判，落在 50~150 中间档不加不减。
      if (!(h > 0) || !(l > 0) || !(c > 0)) return null;
      tp.push((h + l + c) / 3);
    }
    const ma = tp.reduce((s, v) => s + v, 0) / 14;
    const md = tp.reduce((s, v) => s + Math.abs(v - ma), 0) / 14;
    // ⛔ MD=0（14 根 TP 全同，如长期一字板）→ null 不判：CCI=0 是教科书"中性值"，
    //    而 ≤50 是实证弱档 —— 把"量不出"塞进弱档=把缺数据当成看空，绝不允许。
    return md > 0 ? +((tp[13] - ma) / (0.015 * md)).toFixed(1) : null;
  })();
  return {
    aboveMa5: price > ma5,            // 站在五日线上
    brokeHighHold: price > prevHigh20, // 突破前高并站稳
    volPriceUp,                        // 量价齐升
    // gr 轮新增：两个相对量/结构因子
    volRatio,                          // 量比（当日/近20日中位），缺量数据=null
    brkEngulf,                        // 连板断板反包（昨阴今收过昨高），协同 limitUpCount>=2 才判
    // gs 轮新增：跳空高开（结构）+ 信号日（时间效应载体）
    gapUp,                            // 今日跳空高开>1%（涨停日切片 +4.2pp，系数见 nextDayLimitProb）
    sigDate,                          // 涨停日 YYYY-MM-DD，供月初/周几次生效应调整；缺=null
    // hf 轮新增：CCI(14)（>150 +2.5pp / ≤50 -5.8pp，两半窗同向+三层环境不显著变差，系数见 nextDayLimitProb）
    cci,                              // 缺 high/low/close → null 不判；MD=0 → 0（中间档不加不减）
    // gq 轮（I7 底部首板效应实证）：近 20 日位置（0=贴在 20 日最低，100=贴在 20 日最高）。
    //   实测依据（涨停日切片 n=2449，2026-07~10）：中位(30~70)次日触板仅 16.4%，
    //   而顶部(>70) 28.2%、底部(<30) 29.9% —— 「半山腰反抽板」是最弱的一档，
    //   且该惩罚在 7/8/9/10 四个月方向一致（21.7/13.0/14.9/35.0，当月基数内成立）。
    rangePos: (() => {
      // ⛔ 窗口口径与 learnall.rangePos(rows,i,20) 一致：含当日的近 20 根（[i-19,i]）——
      //    gq 轮实证就是用这个口径量的（涨停日切片 n=2449），换窗口=换一个量，结论不通用。
      const w = rows.slice(-20);
      if (w.length < 20) return null;
      let hi = -Infinity, lo = Infinity;
      for (const r of w) { const h = _tN(r, ['high', 'h']), l = _tN(r, ['low', 'l']); if (h > hi) hi = h; if (l < lo) lo = l; }
      if (!(hi > lo)) return null;
      return +((price - lo) / (hi - lo) * 100).toFixed(1);
    })(),
    ma5
  };
}

// 涨停原因自动归因（数据驱动，无消息面时以板块/资金/结构归因）
function buildZTReason({ zt, sectorZT, sectorInflow, sealRatio }) {
  // ⛔ 2026-10-07 补（本轮角度：兜底路径从来没被真跑过一次）。
  //    涨停池是外部数据源，字段说缺就缺（turnover / sealAmount 拿不到是常态）。
  //    原来这里直接 `zt.turnover.toFixed(1)` —— 而同一个 z 对象在复盘里另一处写的是
  //    `+(Number(z.turnover) || 0).toFixed(1)`（有防护）。同一份数据两处处理不一致，
  //    正说明这条「字段缺失」的路径从来没被执行过：真缺一次就在这里 TypeError，
  //    而它崩在复盘 items 的构造里 = 整份复盘归零（用户只看到"复盘生成失败"）。
  //    另外 fmtWan(undefined) 会算出 NaN，文案里直接打出「封单NaN万」这种脏字。
  //    现在所有取值都过一遍 isFinite，缺的按 0 / 未知显示，不崩也不打 NaN。
  const z = zt || {};
  const _nf = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const sr = _nf(sealRatio);
  const sec = z.sector || '未知';
  const to = _nf(z.turnover);
  const sa = _nf(z.sealAmount);
  const parts = [];
  // 1. 板块效应
  if (sectorZT >= 3) parts.push(`【板块】${sec}板块爆发，${sectorZT}只涨停${sectorInflow > 0 ? '、板块主力净流入' + (sectorInflow / 1e8).toFixed(1) + '亿' : ''}，板块效应强`);
  else if (sectorZT === 2) parts.push(`【板块】${sec}板块${sectorZT}只涨停，有一定联动`);
  else parts.push(`【个股】${sec}板块内独苗涨停，个股逻辑为主`);
  // 2. 封板结构
  const sealTxt = sr >= 0.5 ? '封单极坚决' : sr >= 0.2 ? '封单较坚决' : sr >= 0.05 ? '封单一般' : '封单偏弱';
  const openTxt = z.breakCount > 0 ? `，盘中炸板${z.breakCount}次` : '，全天未开板';
  parts.push(`【封板】封单${fmtWan(sa)}（占成交额${(sr * 100).toFixed(0)}%，${sealTxt}）${openTxt}`);
  // 3. 连板结构
  parts.push(`【结构】${z.limitUpCount > 1 ? z.limitUpCount + '连板（空间高度股）' : '首板（低位启动）'}，换手${to.toFixed(1)}%${to < 3 ? '（缩量加速）' : to > 25 ? '（巨量分歧）' : '（换手充分）'}`);
  return parts.join('；');
}
const fmtWan = v => v >= 1e8 ? (v / 1e8).toFixed(1) + '亿' : (v / 1e4).toFixed(0) + '万';

// 次日涨停概率（连板结构+封成比+封单强度比+板块效应+换手结构+市值分档+位置分档+缩量+市场极热+断板反包+跳空+月初+周五+CCI）
// ═══ gq 轮（2026-10-13）用户「先调研」项实证后接入两个因子（市值分档/位置分档） ═══
// ═══ gr 轮（2026-10-13 早盘后）168 项「采纳」候选条件实证批量复测后新接入三个因子（缩量/市场极热/断板反包） ═══
// ═══ gs 轮（2026-10-13 午后）167 项「采纳」待处理项实证（_research_gs.js，两半窗一致性+三层市场环境分层）后新接入三个因子（跳空高开/月初/周五·周一） ═══
// ═══ hf 轮（2026-10-14）6 个 kline 可算候选因子实证（_research_hf.js：GMMA/MACD柱/CCI/岛形反转/主升浪/ADX） ═══
//   只有 CCI(14) 过全部稳健关（两半窗同向+三层环境不显著变差+单调）后接入；其余 5 个实证否决（见台账留痕）。
// 实证口径：.kline_cache 全 A 近 60 交易日 × 涨停日切片（n=2449，已剔一字板/ST/北交所/新股），
//   浮动股本用 stocks_snapshot 代理（近 3 个月股本变动占比小，分档统计可容忍）；
//   结局=次日最高价触板（用户要的是「涨停前埋伏」，不是收盘还封着）。
//   ① 市值分档（I6 市值U型 / M4 小盘衰减 / V13 微盘 三问合一）：
//     <100亿 29.5%(n=1758) vs 100-500亿 20.0%(n=609) vs ≥500亿 13.4%(n=82) ——
//     「U 型」不成立（小盘不差，<30 亿与 30-50 亿几乎打平），稳健的是**大市值惩罚**：
//     涨停越大盘子越难延续。≥100 亿 -0.5、≥500 亿 -1.0（取实测 log-odds 差 0.58/1.04 的保守端；
//     7 月该效应走平、8-10 月稳定，故取保守端而非满额）。
//   ② 位置分档（I7 底部首板效应）：
//     中位(30~70) 16.4%(n=330) vs 顶部(>70) 28.2%(n=2042) vs 底部(<30) 29.9%(n=77) ——
//     稳健发现与「底部首板更强」的假设**相反**：底部并无优势（26.5% vs 顶部首板 24.4%，差异在噪声内），
//     真正弱的是「半山腰反抽板」（涨停但没走出 20 日新高）—— 逐市值档内都成立、四个月方向一致。
//     系数 -0.6（实测 log-odds 差 0.64 的保守端）。
// ⛔ 两项都按「判不出就不判」处理：capYi/rangePos 缺失或 ≤0 时 _n() 归一为 0，
//    0 既不在 ≥100 亿档也不在 30~70 中位档 → 不加不减，绝不把缺数据当成看空。
function nextDayLimitProb({ limitUpCount, sealRatio, sealStrength, breakCount, sectorZT, turnover, aboveMa5, capYi, rangePos, volRatio, brkEngulf, mktUpRatio, gapUp, sigDate, cci, firstSeal }) {
  // ⛔ 2026-10-07 补（本轮角度：兜底路径从来没被真跑过一次）：
  //    `limitUpCount - 1` 与 `Math.min(sealRatio, 1)` 在入参是 undefined / NaN 时会把整个 z 变成 NaN，
  //    于是这个概率返回 NaN —— 而它会被存进复盘 items 并参与排序、进推送文案（打出 "NaN%"）。
  //    外部数据源缺字段是常态，这里统一按 0 处理，保证【任何输入都返回一个 0~100 的数】。
  const _n = v => { const n = Number(v); return isFinite(n) ? n : 0; };
  const lu = _n(limitUpCount), sr = _n(sealRatio), to = _n(turnover), sz = _n(sectorZT);
  let z = -2.1;
  z += 0.55 * Math.min(lu - 1, 4);                  // 连板高度
  z += 2.0 * Math.min(sr, 1);                       // 封成比（封单额/成交额）
  // ⛔ gm 轮新增：封单强度比（封单额/流通市值，单位 %）—— 打板第一因子。
  //    实测依据：强板(>0.5%)次日胜率 70.4% vs 弱板(<0.3%) 29.7%。
  //    封成比回答「封单相对今天成交有多厚」，封单强度比回答「封单相对整个盘子有多厚」——
  //    小盘股封 3000 万可以是硬板，大盘股封 3 亿可能只是薄板，后者只有这把尺子量得出来。
  //    系数 2.2/%：0.5% ≈ +1.1（约 +28pp），与连板高度项（封顶 2.2）同量级；
  //    封顶 0.6%（+1.32）—— 单一因子不许独大，连板/封成比/板块效应仍在模型里说话。
  z += 2.2 * Math.min(_n(sealStrength), 0.6);
  // gq 轮新增：大市值惩罚（见上方实证注释）。分档不给中间值：≥500 亿一档、≥100 亿一档。
  const _cap = _n(capYi);
  if (_cap >= 500) z -= 1.0;
  else if (_cap >= 100) z -= 0.5;
  // gq 轮新增：中位（半山腰）惩罚。rangePos 为 null/0（缺数据）= 不判，不是判了通过。
  const _rp = _n(rangePos);
  if (_rp >= 30 && _rp <= 70) z -= 0.6;
  // gr 轮（2026-10-13 早盘后）：168 项「采纳」候选条件实证批量复测后新接入的三个因子。
  //   实证口径同源 gq（.kline_cache 涨停日切片 n=2562，剔一字板/ST/北交所/新股；结局=次日触板）；
  //   每个因子都过了「两半窗方向一致 + 共线性交叉（与绝对换手/市值/连板/缺口等不互相解释）」两道关，
  //   系数取实测 log-odds 差的保守端（单一因子不许独大）。
  //   ① 缩量涨停（volRatio 量比<0.8）：抛压枯竭，每档绝对换手内次日触板 +13~17pp
  //      （阈值 0.4~1.0 两半窗同向；与现有 to<1 绝对换手项不共线——相对自身历史 vs 绝对换手）。系数 +0.4。
  //   ② 市场极端亢奋（mktUpRatio 涨跌家数比≥75%）：情绪高潮后回落，每档市值内次日触板 -4.8pp
  //      （小盘 -6.6pp、中盘 -7.0pp，独立；与缩量因子互不解释）。系数 -0.25。
  //      mktUpRatio=0/null（出网断/缺数据）= 不判，不是判了通过。
  //   ③ 连板断板反包（limitUpCount>=2 且 brkEngulf）：连板群内次日触板 25.3% vs 非反包 40.0%（-14.7pp，两半窗同向）。
  //      缺 brkEngulf（非连板/数据缺失）不判。系数 -0.5。
  const _vr = _n(volRatio);
  if (_vr > 0 && _vr < 0.8) z += 0.4;
  const _mkt = _n(mktUpRatio);
  if (_mkt >= 75) z -= 0.25;
  if (lu >= 2 && _n(brkEngulf)) z -= 0.5;
  // gs 轮（2026-10-13 午后）：167 项「采纳」待处理项实证（_research_gs.js，含两半窗一致性 + 三层市场环境分层 dow/side/up）
  //   筛出 3 个稳健因子（均过「两半窗同向 + 三环境全正 + 与现有因子 I5/K1/M6/市值/连板不共线」三关），系数取实测 log-odds 差的保守端：
  //   ① 跳空高开收板（Q15 真突破 ≡ 今日跳空>1%）：涨停日切片 n=1136，次日触板 30.9% vs 无缺口 23.9%（+4.2pp，
  //      两半窗同向、三环境全正）。与缩量/反包/市值/连板均不共线。系数 +0.2。
  //   ② 月初效应（J11，信号日≤5号）：n=351，31.9% vs 基数 26.7%（+5.2pp，两半窗同向、三环境全正）。日期确定型，非个股因子。
  //   ③ 周五效应（J12，信号日周五）：n=509，32.0%（+5.3pp，同向全正）；周一效应（J12）：23.4%（-3.3pp，同向全负）。日期确定型。
  //   gapUp 缺失=null 不判；sigDate 缺失/格式错 不判；绝不让缺数据变成"判了通过"。
  const _gap = _n(gapUp);
  if (_gap) z += 0.2;
  const _sd = (typeof sigDate === 'string' && sigDate.length >= 10) ? sigDate.slice(0, 10) : null;
  if (_sd) {
    const _dom = +_sd.slice(8, 10);
    const _wd = new Date(_sd + 'T12:00:00').getDay();
    if (_dom <= 5) z += 0.2;            // 月初效应（与周五次生效应可叠加，二者独立且均稳健）
    if (_wd === 5) z += 0.25;           // 周五效应
    else if (_wd === 1) z -= 0.15;      // 周一效应（反向）
  }
  // hf 轮（2026-10-14）：P11 CCI(14) 双端阈值（_research_hf.js 实证，涨停日切片 n=551，口径见 reviewFlags 内注释）。
  //   实测 Δ：>150 +2.5pp（log-odds +0.105）／≤50 -5.8pp（log-odds -0.257），两半窗同向、三层环境不显著变差。
  //   系数取保守端：>150 +0.1／≤50 -0.2 —— 与 gs 的 gapUp(+0.2) 同量级，单一因子不许独大。
  //   ⛔ cci 缺失（null/undefined/NaN）= 不判：50~150 是中间档本来就不加不减，
  //      缺数据必须落在中间档而不是被当成低 CCI 罚分 —— 绝不让缺数据变成"判了看空"。
  //      （⛔ Number(null)===0 会落进 ≤50 罚分档，所以必须显式判 null，不能只靠 isFinite）
  const _cci = Number(cci);
  if (cci != null && isFinite(_cci)) {
    if (_cci > 150) z += 0.1;
    else if (_cci <= 50) z -= 0.2;
  }
  // hj2 轮（每日回测 2026-10-14）：H2 封板时间（首次封板 fbt）实证后接入（一进二人群 n=602，
  //   东财源 14 天，口径见 _research_yier_20261014.js，系数取实测 log-odds 保守端）。
  //   ④ 13:00-14:00 封板：次日收盘涨停 12.3%(Δ-4.2, lo -0.185) / 触板 18.9%(Δ-5.2, lo -0.207)，
  //     两结局三环境全负 → 系数 -0.2（保守端）。
  //   ② ≤10:00 封板：触板 28.9%(Δ+4.8, lo +0.13) 三环境全正；收盘 Δ+2.8 但 side 档 -5.1 不够稳 → 取 +0.1（只看触板口径）。
  //   ③ 10:00-13:00 中性（lo≈-0.04）→ 不加不减。
  //   firstSeal 缺失/null/0/格式错/非交易时段(午休 11:30-13:00、>15:00) = 不判（落中性档，不加不减），
  //   绝不让缺数据变成"判了看空"。
  const _fs = (() => {
    const s = String(firstSeal == null ? '' : firstSeal).trim();
    if (!/^[0-9]{5,6}$/.test(s)) return null;
    const p = s.padStart(6, '0');
    const h = +p.slice(0, 2), m = +p.slice(2, 4);
    const t = h * 60 + m;
    if (h < 9 || h > 15 || t < 565 || t > 900) return null; // 9:25~15:00 之外视为异常
    if (t >= 690 && t < 780) return null;                   // 午休 11:30-13:00 视为异常
    return t;
  })();
  if (_fs != null) {
    if (_fs <= 600) z += 0.1;                    // ② ≤10:00 早封
    else if (_fs >= 780 && _fs < 840) z -= 0.2;  // ④ 13:00-14:00 午后封
  }
  z -= 0.3 * (_n(breakCount));                      // 炸板拖累
  z += 0.16 * Math.min(sz, 8);                      // 板块效应
  if (to >= 5 && to <= 20) z += 0.3;                // 换手充分
  if (to < 1) z += 0.15;                            // 一字缩量
  if (to > 35) z -= 0.4;                            // 巨量分歧
  if (aboveMa5) z += 0.2;
  const p = +(100 / (1 + Math.exp(-z))).toFixed(0);
  return isFinite(p) ? p : 0;
}

// ---------- 选股技术因子：MACD / 周线金叉 / 横盘放量 ----------
// ═══ 经典技术指标（2026-10-01 补齐）═══════════════════════════════════════
// 用户原话：「哪些技术指标 MACD KDJ 道氏理论 缠论 量价分析你用了吗」。
// 查实：改之前**只有 MACD**，KDJ / 道氏 / 缠论 / 中枢 / 分型 / RSI / 布林 / 试盘 全是 0 处实现。
// 下面把这些补齐，并且**真的接进选股判据和推送文案**——不是写来摆着看的。
// ⚠️ K线字段名多名字兼容（v1 只认 r.c/h/l/v 导致维度恒为常数，见 learnall 事故）
const _tN = (r, names) => { for (const n of names) { const v = r && r[n]; if (v != null && isFinite(+v)) return +v; } return 0; };

// ── KDJ(9,3,3) ──
// RSV = (今日收盘 − 近N日最低) / (近N日最高 − 近N日最低) × 100
// K = 2/3·前K + 1/3·RSV ；D = 2/3·前D + 1/3·K ；J = 3K − 2D
// 只返回最后一根的值 + 金叉死叉 + 超买超卖区（这三个才是能直接用的结论）
// KDJ 序列：一次性算出每根的 K/D，后面交叉、状态、年龄都从这条序列上取，
// 避免 calcKDJAt 反复重算（O(n²)）也避免"只在交叉当天有值"的信息丢失。
function _kdjSeries(rows, n = 9) {
  if (!rows || rows.length < n + 2) return null;
  const ks = [], ds = [], idx = [];
  let k = 50, d = 50;
  for (let i = n - 1; i < rows.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      const h = _tN(rows[j], ['high', 'h']), l = _tN(rows[j], ['low', 'l']);
      if (h > 0 && h > hi) hi = h;
      if (l > 0 && l < lo) lo = l;
    }
    const c = _tN(rows[i], ['close', 'c']);
    if (!(hi > lo) || !(c > 0)) continue;
    const rsv = (c - lo) / (hi - lo) * 100;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
    ks.push(k); ds.push(d); idx.push(i);
  }
  if (!ks.length) return null;
  return { ks, ds, idx };
}
function calcKDJ(rows, n = 9) {
  const s = _kdjSeries(rows, n);
  if (!s) return null;
  const k = s.ks[s.ks.length - 1], d = s.ds[s.ds.length - 1];
  const j = 3 * k - 2 * d;
  // 交叉：从序列尾部往前找最近一次 K 上穿/下穿 D 的位置
  let cross = null, crossAge = null, since = null;
  for (let i = s.ks.length - 1; i >= 1; i--) {
    const pk = s.ks[i - 1], pd = s.ds[i - 1], ck = s.ks[i], cd = s.ds[i];
    if (pk <= pd && ck > cd) { since = '金叉'; crossAge = s.ks.length - 1 - i; break; }
    if (pk >= pd && ck < cd) { since = '死叉'; crossAge = s.ks.length - 1 - i; break; }
  }
  // cross 只报"刚刚发生"（≤3 根内）的交叉 —— 金叉后 20 天还在多头，那叫"状态"不叫"信号"
  if (since && crossAge != null && crossAge <= 3) cross = since;
  const state = k > d ? '多头' : '空头';
  const zone = k >= 80 ? '超买' : k <= 20 ? '超卖' : '中性';
  const bits = [];
  if (cross) bits.push(cross);
  else if (since && crossAge != null) bits.push(`${since}后${crossAge}天`);
  else bits.push(state);
  if (zone !== '中性') bits.push(zone);
  return {
    k: +k.toFixed(1), d: +d.toFixed(1), j: +j.toFixed(1),
    cross, since, crossAge, state, zone,
    txt: `KDJ K${k.toFixed(0)} D${d.toFixed(0)} J${j.toFixed(0)} · ${bits.join(' · ')}`
  };
}
function calcKDJAt(rows, i, n) {
  const s = _kdjSeries(rows, n);
  if (!s) return null;
  const at = s.idx.indexOf(i);
  if (at < 0) return null;
  return { k: s.ks[at], d: s.ds[at], j: 3 * s.ks[at] - 2 * s.ds[at] };
}
// ── 缠论分型（顶分型 / 底分型）──
// 顶分型：中间那根K线的高低点都比左右两根高（局部高点，压力）
// 底分型：中间那根K线的高低点都比左右两根低（局部低点，支撑）
// 这是缠论最基础的一层：笔、线段、中枢都建立在分型之上。
// 这里不做完整的笔/中枢递归（那需要更长历史和更复杂的合并处理），
// 只给出最近的分型序列与"最近一个分型是什么"——足以判断"现在是顶还是底"。
function findFenxing(rows, lookback = 40) {
  if (!rows || rows.length < 5) return null;
  const lo = Math.max(1, rows.length - lookback);
  const fx = [];
  for (let i = lo; i < rows.length - 1; i++) {
    const a = rows[i - 1], b = rows[i], c = rows[i + 1];
    if (!a || !b || !c) continue;
    const ah = _tN(a, ['high', 'h']), bh = _tN(b, ['high', 'h']), ch = _tN(c, ['high', 'h']);
    const al = _tN(a, ['low', 'l']), bl = _tN(b, ['low', 'l']), cl = _tN(c, ['low', 'l']);
    if (!(ah > 0 && bh > 0 && ch > 0 && al > 0 && bl > 0 && cl > 0)) continue;
    if (bh > ah && bh > ch && bl > al && bl > cl) fx.push({ type: '顶分型', i, price: bh, date: b.date });
    else if (bh < ah && bh < ch && bl < al && bl < cl) fx.push({ type: '底分型', i, price: bl, date: b.date });
  }
  if (!fx.length) return null;
  const last = fx[fx.length - 1];
  const cur = _tN(rows[rows.length - 1], ['close', 'c']);
  return {
    count: fx.length, last: last.type, lastPrice: +last.price.toFixed(2), lastDate: last.date,
    // 顶分型在上方 = 压力还没突破；底分型在下方 = 支撑成立
    above: cur > last.price,
    txt: `缠论：最近${last.type}${last.price}（${last.date}）${cur > last.price ? '，已在其上方' : '，仍在其下方'}`
  };
}
// ── 量价形态：吸筹 / 试盘 / 拉升 ──
// 用户问「主力吸筹 试盘和拉升时的K线你学习了吗」。这里把三种典型量价形态量化出来：
//   吸筹：下跌时缩量、上涨时放量，且重心（收盘）逐步抬高 —— 有人在默默收
//   试盘：长上影线（冲高回落）+ 放量 —— 主力在试探上方抛压
//   拉升：放量 + 收盘收在当日高位 + 突破前面平台 —— 真刀真枪往上打
function volPricePattern(rows) {
  if (!rows || rows.length < 20) return null;
  const i = rows.length - 1;
  const r = rows[i];
  const c = _tN(r, ['close', 'c']), o = _tN(r, ['open', 'o']);
  const h = _tN(r, ['high', 'h']), l = _tN(r, ['low', 'l']);
  const v = _tN(r, ['volume', 'vol', 'v']);
  if (!(c > 0) || !(h > 0) || !(l > 0)) return null;
  // ⚠️ 2026-10-19 it2：当日成交量缺失/为 0（同花顺延迟会把「当天成交未结算」冒充成 volume=0，
  //   见 is 轮奥士康实证）时，量价形态判不出 → 返回 null。否则 vr = 0/va = 0，会把「没数据」
  //   误判成「吸筹/缩量整理」，进而污染 trendPoolCheck 打分与 bazi 位置判断。A 股任何正常交易日
  //   成交量恒 >0（一字板也是「极小」不是「0」），所以 v<=0 必是脏数据或停牌，一律不判。
  if (!(v > 0)) return null;
  let v20 = 0;
  for (let j = Math.max(0, i - 19); j <= i; j++) v20 += _tN(rows[j], ['volume', 'vol', 'v']);
  const va = v20 / 20;
  const vr = va > 0 ? v / va : 1;
  const upShadow = h > 0 && c > 0 ? (h - Math.max(c, o)) / h * 100 : 0;   // 上影线占价格比
  const body = Math.abs(c - o) / (h - l || 1);
  // 近 10 日重心：比较前后两段均价
  const a1 = rows.slice(Math.max(0, i - 9), i - 4).reduce((s, x) => s + _tN(x, ['close', 'c']), 0) / 5;
  const a2 = rows.slice(i - 4, i + 1).reduce((s, x) => s + _tN(x, ['close', 'c']), 0) / 5;
  const cgUp = a2 > a1 * 1.005;   // 重心上移（近5日均价高于前5日）
  let kind = null, why = '';
  if (vr >= 1.5 && upShadow >= 2 && c < h * 0.995) { kind = '试盘'; why = `放量${vr.toFixed(1)}倍冲高回落（上影${upShadow.toFixed(1)}%），主力在试探上方抛压`; }
  else if (vr >= 1.3 && cgUp && c >= (h + l) / 2) { kind = '拉升'; why = `放量${vr.toFixed(1)}倍且重心上移、收在当日上半区`; }
  else if (vr < 0.9 && cgUp) { kind = '吸筹'; why = `缩量${vr.toFixed(1)}倍而重心仍在抬升，有人在默默收`; }
  else if (vr >= 1.2) { kind = '放量'; why = `放量${vr.toFixed(1)}倍`; }
  else { kind = '缩量整理'; why = `量能${vr.toFixed(1)}倍`; }
  return { kind, why, vr: +vr.toFixed(2), upShadow: +upShadow.toFixed(2), body: +body.toFixed(2), cgUp };
}

function ema(arr, n) {
  const k = 2 / (n + 1);
  const out = [];
  let prev = arr[0];
  out.push(prev);
  for (let i = 1; i < arr.length; i++) { prev = arr[i] * k + prev * (1 - k); out.push(prev); }
  return out;
}
// 日线 MACD（默认12/26/9）：gold=本次金叉；aboveWater=DIF与DEA均在零轴上方
function calcMACD(rows, fast = 12, slow = 26, sig = 9) {
  if (!rows || rows.length < slow + sig) return null;
  const closes = rows.map(r => r.close);
  const ef = ema(closes, fast), es = ema(closes, slow);
  const dif = ef.map((v, i) => v - es[i]);
  const dea = ema(dif, sig);
  const n = dif.length - 1;
  if (n < 1) return null;
  return {
    dif: +dif[n].toFixed(3), dea: +dea[n].toFixed(3),
    prevDif: +dif[n - 1].toFixed(3), prevDea: +dea[n - 1].toFixed(3),
    gold: dif[n] > dea[n] && dif[n - 1] <= dea[n - 1], // 金叉：DIF上穿DEA
    aboveWater: dif[n] > 0 && dea[n] > 0               // 水上：零轴上方运行
  };
}
// 日K合成周K（7自然日一bucket），判断周线 MA5上穿MA10 金叉
function weeklyCross(rows) {
  if (!rows || rows.length < 60) return null;
  const wk = [];
  for (const r of rows) {
    const k = Math.floor(new Date(r.date).getTime() / (7 * 86400000));
    const last = wk[wk.length - 1];
    if (!last || last.k !== k) wk.push({ k, close: r.close, high: r.high, low: r.low, volume: r.volume });
    else {
      last.close = r.close;
      last.high = Math.max(last.high, r.high);
      last.low = Math.min(last.low, r.low);
      last.volume += r.volume;
    }
  }
  if (wk.length < 11) return null; // 至少10周才能算MA10及前值
  const avg = a => a.reduce((s, r) => s + r.close, 0) / a.length;
  const ma5 = avg(wk.slice(-5)), ma10 = avg(wk.slice(-10));
  const p5 = avg(wk.slice(-6, -1)), p10 = avg(wk.slice(-11, -1));
  return { ma5: +ma5.toFixed(2), ma10: +ma10.toFixed(2), gold: ma5 > ma10 && p5 <= p10 };
}
// 横盘放量：前10日高低振幅<25%（平台整理）且今日量≥前5日均量1.6倍
function hengPanFangLiang(rows) {
  if (!rows || rows.length < 12) return null;
  const prev10 = rows.slice(-11, -1);
  const hi = Math.max(...prev10.map(r => r.high)), lo = Math.min(...prev10.map(r => r.low));
  const today = rows[rows.length - 1];
  const base5 = rows.slice(-6, -1).reduce((s, r) => s + r.volume, 0) / 5;
  if (!(base5 > 0) || !(lo > 0)) return null;
  const amp = (hi - lo) / lo;
  return { amp: +(amp * 100).toFixed(1), volRatio: +(today.volume / base5).toFixed(2), ok: amp < 0.25 && today.volume >= base5 * 1.6 };
}

module.exports = { calcProfitRatio, limitPctOf, isMainBoard, isGEM, isMainOrGEM, isJunkName, isDelistingName, countsInZtTally, ztTallyOf, ztDroppedOf, isStyleSector, canOverrideSector, isLimitUp, isNearLimitUp, sealedAtLimit, isOneLineBoard, limitUpStreak, isSurgeDay, setNoLimitFn, hasNoLimit, scoreStock, limitUpProbability, backtest, backtestAsync, backtestSteps, trendCheck, computeLevels, reviewFlags, buildZTReason, nextDayLimitProb, trendPoolCheck, bigMoneyContext, calcMACD, weeklyCross, hengPanFangLiang,
  // 经典技术指标（2026-10-01 补齐：以前只有 MACD，KDJ/缠论/量价全是零）
  calcKDJ, calcKDJAt, findFenxing, volPricePattern,
  // 趋势类榜单通用前提（市值门槛 + 20日波动体检 + 按通道的抖动判据）：三条入榜路共用一份
  trendHygiene, trendVerdict,
  // lr：筹码峰近似——60日量加权收盘价直方图（2% bins），主峰/密集度/上方压力峰
  chipPeakOf,
  // ls：十日量能质量（用户硬要求：结合至少十日成交量判断票能不能干）
  volTenOf,
  // ma：推送结果学习沉淀的「好的条件」——用于过滤低质量大单/冲板等盘中信号
  hasLaunchConditions,
  // mb：20日新高突破 + 强动能（学习未命中涨停票中的新华百货/沪光股份型）
  hasBreakoutConditions,
  // mc：涨停票形态分类（复盘用：突破/启动/反包/低价首板/其它）
  classifyZT,
  // ny：日线K线形态识别（红三兵/早晨之星/射击之星/锤子线/吞没/十字星/多方炮/N字涨停/平台突破/仙人指路等）
  candlePatternOf,
  // nz：大A玄学字辈批量涨停检测（首字/单字/双字词/同音字根族）
  analyzeNameClans,
  // nz-2：字辈全市场扫描（补涨名单）
  scanNameClan,
  // oa：指数纪律警示（站上昨高可做 / 跌破昨低不可做·次日休息）
  indexDisciplineOf,
  // md：涨停潜力条件（学习涨停 vs 上涨未涨停差异：更高振幅、更大空间、更强连阳）
  hasMomentumConditions };

// ma/md：推送结果学习沉淀的「好的条件」（2026-10-27）
// 样本分析结论：
//   - 上涨组 vs 下跌组：下跌组 amp20/cum5 明显更高（鱼尾/透支），上涨组 dd60 更高。
//   - 涨停组 vs 上涨未涨停组：涨停组 amp20/gap20/cum5/upCons 更高。
//   - 分段最优：amp20 20-30% 胜率 77.8%，30-40% 65.5%，40-60% 56.4%；cum5 0-5% 胜率 86.5%；gap20 10-15% 胜率 90%。
// 因此拆成两档：
//   - hasLaunchConditions：稳健上涨条件（低波动、未透支、有筹码支撑），给大单流入等稳健信号。
//   - hasMomentumConditions：涨停潜力条件（高波动、有空间、连阳强），给冲板/盘中等涨停型信号。

function hasLaunchConditions({ rows, price, code, name }) {
  if (!rows || rows.length < 25 || !price || price <= 0) return false;
  const getN = (r, keys) => { for (const k of keys) { const v = Number(r[k]); if (v > 0) return v; } return 0; };
  const closes = [];
  for (const r of rows) { const v = getN(r, ['close', 'c']); if (v > 0) closes.push(v); }
  if (closes.length < 25) return false;
  const highs = [];
  for (const r of rows) { const v = getN(r, ['high', 'h']); if (v > 0) highs.push(v); }
  if (highs.length < 25) return false;
  const prevHigh20 = Math.max(...rows.slice(-21, -1).map(r => getN(r, ['high', 'h'])));
  const gap20 = prevHigh20 > 0 ? (prevHigh20 - price) / prevHigh20 * 100 : 100;
  const lo20 = Math.min(...closes.slice(-20));
  const hi20 = Math.max(...highs.slice(-20));
  const amp20 = lo20 > 0 ? (hi20 - lo20) / lo20 * 100 : 0;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const base5Row = rows[rows.length - 6];
  const base5 = base5Row ? getN(base5Row, ['close', 'c']) : 0;
  const cum5 = base5 > 0 ? (closes[closes.length - 1] - base5) / base5 * 100 : 0;
  const lastPct = Number(rows[rows.length - 1].pct) || 0;
  // dd60：距60日高点回撤；学习显示 10-15% 区间胜率最高
  let dd60 = null;
  if (rows.length >= 60) {
    const hi60 = Math.max(...rows.slice(-60).map(r => getN(r, ['high', 'h'])));
    dd60 = hi60 > 0 ? (hi60 - price) / hi60 * 100 : null;
  }
  // upCons：连阳天数；上涨组 vs 下跌组差异显著
  let upCons = 0;
  for (let i = closes.length - 1; i >= 1; i--) { if (closes[i] >= closes[i - 1]) upCons++; else break; }
  return (
    amp20 >= 15 && amp20 < 45 &&    // 有波动但不过高（40-60% 区间胜率明显下降）
    cum5 > 0 && cum5 < 12 &&         // 已启动但短期未透支（cum5>10 后胜率下降）
    price > ma20 * 0.985 &&          // 站上20日线
    gap20 > 3 && gap20 < 20 &&       // 距20日高点有空间但不太远
    (dd60 == null || (dd60 >= 5 && dd60 <= 25)) && // 60日高点附近有回撤但未深套
    upCons >= 1 &&                   // 至少1天连阳
    lastPct > 0                      // 当日已上涨
  );
}

// md：涨停潜力条件（学习涨停 vs 上涨未涨停差异）
function hasMomentumConditions({ rows, price, code, name }) {
  if (!rows || rows.length < 25 || !price || price <= 0) return false;
  const getN = (r, keys) => { for (const k of keys) { const v = Number(r[k]); if (v > 0) return v; } return 0; };
  const closes = [];
  for (const r of rows) { const v = getN(r, ['close', 'c']); if (v > 0) closes.push(v); }
  if (closes.length < 25) return false;
  const highs = [];
  for (const r of rows) { const v = getN(r, ['high', 'h']); if (v > 0) highs.push(v); }
  if (highs.length < 25) return false;
  const prevHigh20 = Math.max(...rows.slice(-21, -1).map(r => getN(r, ['high', 'h'])));
  const gap20 = prevHigh20 > 0 ? (prevHigh20 - price) / prevHigh20 * 100 : 100;
  const lo20 = Math.min(...closes.slice(-20));
  const hi20 = Math.max(...highs.slice(-20));
  const amp20 = lo20 > 0 ? (hi20 - lo20) / lo20 * 100 : 0;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const base5Row = rows[rows.length - 6];
  const base5 = base5Row ? getN(base5Row, ['close', 'c']) : 0;
  const cum5 = base5 > 0 ? (closes[closes.length - 1] - base5) / base5 * 100 : 0;
  const lastPct = Number(rows[rows.length - 1].pct) || 0;
  let upCons = 0;
  for (let i = closes.length - 1; i >= 1; i--) { if (closes[i] >= closes[i - 1]) upCons++; else break; }
  return (
    amp20 >= 25 && amp20 <= 50 &&    // 高波动（涨停组 amp20 中位数 36.15%）
    cum5 > 0 && cum5 < 15 &&         // 有动能但未透支
    price > ma20 * 0.99 &&           // 站上20日线（允许1%回踩）
    gap20 > 5 && gap20 < 18 &&       // 距20日高点有空间（涨停组 gap20 中位数 11.4%）
    upCons >= 2 &&                   // 连阳≥2（涨停组 upCons 中位数 2）
    lastPct > 1.5                    // 盘中已明显启动（涨停组 pct 中位数 2.41%）
  );
}

// mb：20日新高突破 + 强动能（2026-10-27 学习未命中涨停票）
// 针对新华百货型：已突破20日高点、近5日累计涨幅>10%、带量、连阳≥2。
function hasBreakoutConditions({ rows, price, code, name }) {
  if (!rows || rows.length < 25 || !price || price <= 0) return false;
  const getN = (r, keys) => { for (const k of keys) { const v = Number(r[k]); if (v > 0) return v; } return 0; };
  const closes = [], highs = [], vols = [];
  for (const r of rows) {
    const c = getN(r, ['close', 'c']); if (c > 0) closes.push(c);
    const h = getN(r, ['high', 'h']); if (h > 0) highs.push(h);
    const v = getN(r, ['volume', 'vol', 'v']); if (v >= 0) vols.push(v);
  }
  if (closes.length < 25 || highs.length < 25) return false;
  const prevHigh20 = Math.max(...rows.slice(-21, -1).map(r => getN(r, ['high', 'h'])));
  const gap20 = prevHigh20 > 0 ? (prevHigh20 - price) / prevHigh20 * 100 : 100;
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const base5 = getN(rows[rows.length - 6], ['close', 'c']);
  const cum5 = base5 > 0 ? (closes[closes.length - 1] - base5) / base5 * 100 : 0;
  const maV20 = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const vr = maV20 > 0 ? vols[vols.length - 1] / maV20 : 0;
  const upDays = closes.slice(-5).map((c, i, a) => i === 0 ? 0 : c > a[i - 1] ? 1 : 0).slice(1).reduce((a, b) => a + b, 0);
  const lastPct = Number(rows[rows.length - 1].pct) || 0;
  return (
    prevHigh20 > 0 &&
    price >= prevHigh20 * 0.99 && // 已突破或刚突破20日高点（允许1%回踩）
    cum5 > 10 &&                    // 近5日强动能
    price > ma20 &&                 // 站稳20日线
    vr > 1.2 &&                     // 放量
    upDays >= 2 &&                  // 连阳≥2
    lastPct > 0
  );
}

// mc：涨停票形态分类（复盘用）
// 返回 { type, risk }，type ∈ {突破板, 启动板, 反包板, 低价小盘首板, 其它, 数据不足}
function classifyZT({ rows, price, code, name }) {
  if (!rows || rows.length < 25 || !price || price <= 0) return { type: '数据不足', risk: '高' };
  const getN = (r, keys) => { for (const k of keys) { const v = Number(r[k]); if (v > 0) return v; } return 0; };
  const closes = [], highs = [], vols = [];
  for (const r of rows) {
    const c = getN(r, ['close', 'c']); if (c > 0) closes.push(c);
    const h = getN(r, ['high', 'h']); if (h > 0) highs.push(h);
    const v = getN(r, ['volume', 'vol', 'v']); if (v >= 0) vols.push(v);
  }
  if (closes.length < 25 || highs.length < 25) return { type: '数据不足', risk: '高' };
  const prevHigh20 = Math.max(...rows.slice(-21, -1).map(r => getN(r, ['high', 'h'])));
  const lo20 = Math.min(...closes.slice(-20));
  const hi20 = Math.max(...highs.slice(-20));
  const amp20 = lo20 > 0 ? (hi20 - lo20) / lo20 * 100 : 0;
  const base5 = getN(rows[rows.length - 6], ['close', 'c']);
  const cum5 = base5 > 0 ? (closes[closes.length - 1] - base5) / base5 * 100 : 0;
  const upDays = closes.slice(-5).map((c, i, a) => i === 0 ? 0 : c > a[i - 1] ? 1 : 0).slice(1).reduce((a, b) => a + b, 0);

  if (price >= prevHigh20 * 0.99 && cum5 > 10 && upDays >= 2) return { type: '突破板', risk: '中' };
  if (cum5 < 0) return { type: '反包板', risk: '高' };
  if (amp20 < 20 && price < 10) return { type: '低价小盘首板', risk: '高' };
  if (amp20 >= 20 && cum5 > 0 && prevHigh20 > price) return { type: '启动板', risk: '中低' };
  return { type: '其它', risk: '中' };
}

// ls：十日量能质量——所有页面选中票必过这一维（红肥绿瘦 / 5日均量vs20日均量趋势 / 爆量出货检测）
// 返回 { upDnRatio, v5v20, surgeN, verdict: 'healthy'|'warn'|'bad', text }；样本不足返回 null（判不出不硬判）
function volTenOf(rows) {
  if (!rows || rows.length < 12) return null;
  const seg = rows.slice(-10);
  let upV = 0, upN = 0, dnV = 0, dnN = 0, hiV = 0;
  for (const r of seg) { const p = +r.pct || 0, v = +r.volume || 0; if (p > 0.3) { upV += v; upN++; } else if (p < -0.3) { dnV += v; dnN++; } if (v > hiV) hiV = v; }
  const upDnRatio = dnV > 0 ? +(upV / dnV).toFixed(2) : (upV > 0 ? 99 : null);
  const v5 = rows.slice(-5).reduce((a, r) => a + (+r.volume || 0), 0) / 5;
  const v20 = rows.slice(-20).reduce((a, r) => a + (+r.volume || 0), 0) / 20;
  const v5v20 = v20 > 0 ? +(v5 / v20).toFixed(2) : null;
  const vAvg = seg.reduce((a, r) => a + (+r.volume || 0), 0) / seg.length;
  const surgeN = vAvg > 0 ? seg.filter(r => (+r.volume || 0) > vAvg * 3).length : 0;
  let verdict = 'healthy', text = '十日量能健康';
  if (upDnRatio != null && upDnRatio < 0.9) { verdict = 'bad'; text = `十日红瘦绿肥（涨日量/跌日量=${upDnRatio}）——下跌在放量，别接`; }
  else if (surgeN >= 2) { verdict = v5v20 != null && v5v20 < 1 ? 'bad' : 'warn'; text = `十日内 ${surgeN} 次爆量（>3倍均量）${v5v20 != null && v5v20 < 1 ? '且后续缩量——出货嫌疑' : '——分歧巨大'}`; }
  else if (v5v20 != null && v5v20 < 0.6) { verdict = 'warn'; text = `量能持续萎缩（5日/20日=${v5v20}）——没人气了，动量不足`; }
  else if (upDnRatio != null && upDnRatio >= 1.2) { text = `十日红肥绿瘦（${upDnRatio}）+ 量能${v5v20 != null && v5v20 >= 1.1 ? '温和放大' : '平稳'}——资金在持续进`; }
  return { upDnRatio, v5v20, surgeN, verdict, text };
}

// lr：筹码峰近似（日线可得：真实筹码分布需 L2，这里用 60 日量加权收盘价直方图逼近）
// 返回 { mainPeak, peakRatio, dense, abovePeak, aboveGapPct, chipText }；样本不足返回 null（判不出不硬判）
function chipPeakOf(rows) {
  if (!rows || rows.length < 30) return null;
  const seg = rows.slice(-60);
  const totV = seg.reduce((a, r) => a + (+r.volume || 0), 0);
  if (totV <= 0) return null;
  const closes = seg.map(r => +r.close || 0).filter(c => c > 0);
  if (!closes.length) return null;
  const lo = Math.min(...closes), hi = Math.max(...closes);
  if (hi <= lo) return null;
  const NB = 30, step = (hi - lo) / NB;
  const bins = new Array(NB).fill(0);
  for (const r of seg) { const c = +r.close || 0; if (c <= 0) continue; let i = Math.min(NB - 1, Math.floor((c - lo) / step)); bins[i] += (+r.volume || 0); }
  let bi = 0; for (let i = 1; i < NB; i++) if (bins[i] > bins[bi]) bi = i;
  const mainPeak = +(lo + (bi + 0.5) * step).toFixed(2);
  const peakRatio = +(bins[bi] / totV * 100).toFixed(1);
  const dense = peakRatio >= 25;   // 单峰密集：主峰吃掉 ≥25% 成交量
  const last = +seg[seg.length - 1].close || 0;
  let abovePeak = null;
  for (let i = bi + 1; i < NB; i++) { if (bins[i] >= totV * 0.12) { abovePeak = +(lo + (i + 0.5) * step).toFixed(2); break; } }
  const aboveGapPct = (abovePeak != null && last > 0) ? +((abovePeak / last - 1) * 100).toFixed(1) : null;
  return { mainPeak, peakRatio, dense, abovePeak, aboveGapPct,
    chipText: dense
      ? (last >= mainPeak * 1.02 ? '筹码单峰密集（主峰 ' + peakRatio + '% @' + mainPeak + '），现价已站上峰顶——上方套牢轻' : '筹码单峰密集（主峰 ' + peakRatio + '% @' + mainPeak + '），现价仍在峰下——峰顶是压力')
      : '筹码分散（主峰仅 ' + peakRatio + '%）' + (aboveGapPct != null && aboveGapPct <= 5 ? '，上方 ' + aboveGapPct + '% 处有压力峰' : '') };
}

// ny：日线K线形态识别（2026-10-29）
// 返回 { names:[], text:'红三兵/早晨之星/...' }；样本不足返回 null（判不出不硬判）
function candlePatternOf(rows) {
  if (!rows || rows.length < 5) return null;
  const getN = (r, keys) => { for (const k of keys) { const v = Number(r[k]); if (v > 0) return v; } return 0; };
  const O = r => getN(r, ['open', 'o']);
  const C = r => getN(r, ['close', 'c']);
  const H = r => getN(r, ['high', 'h']);
  const L = r => getN(r, ['low', 'l']);
  const V = r => getN(r, ['volume', 'vol', 'v']);
  const body = r => Math.abs(C(r) - O(r));
  const range = r => H(r) - L(r);
  const isRed = r => C(r) > O(r);
  const isGreen = r => C(r) < O(r);
  const pct = r => Number(r.pct) || 0;
  const upShadow = r => H(r) - Math.max(O(r), C(r));
  const downShadow = r => Math.min(O(r), C(r)) - L(r);
  const bodyPct = r => range(r) > 0 ? body(r) / range(r) : 0;
  const limitPct = r => limitPctOf(r.code || '', r.name || '');

  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const prev3 = rows.slice(-3);
  const last2 = rows.slice(-2);
  const patterns = [];

  // 1. 十字星：实体极小（<5% 振幅）
  if (bodyPct(last) < 0.05 && range(last) > 0) patterns.push('十字星');

  // 2. 锤子线：下影线 ≥ 2 倍实体，上影线短，低位
  if (downShadow(last) >= body(last) * 2 && upShadow(last) < body(last) * 0.5 && bodyPct(last) > 0.1) {
    const lo20 = Math.min(...rows.slice(-20).map(C));
    if (C(last) <= lo20 * 1.05) patterns.push('锤子线');
  }

  // 3. 吊颈线：同锤子线但高位
  if (downShadow(last) >= body(last) * 2 && upShadow(last) < body(last) * 0.5 && bodyPct(last) > 0.1) {
    const hi20 = Math.max(...rows.slice(-20).map(C));
    if (C(last) >= hi20 * 0.95) patterns.push('吊颈线');
  }

  // 4. 射击之星：上影线 ≥ 2 倍实体，实体小，高位
  if (upShadow(last) >= body(last) * 2 && downShadow(last) < body(last) * 0.5 && bodyPct(last) > 0.1) {
    const hi20 = Math.max(...rows.slice(-20).map(C));
    if (C(last) >= hi20 * 0.95) patterns.push('射击之星');
  }

  // 5. 吞没形态：今日完全包住昨日，且颜色相反
  if (rows.length >= 2) {
    if (isRed(last) && isGreen(prev) && O(last) <= C(prev) && C(last) >= O(prev) && body(last) > body(prev) * 1.2) patterns.push('阳吞没');
    if (isGreen(last) && isRed(prev) && O(last) >= C(prev) && C(last) <= O(prev) && body(last) > body(prev) * 1.2) patterns.push('阴吞没');
  }

  // 6. 红三兵：连续3根阳线，收盘价递增，实体适中，无上长影
  if (rows.length >= 3) {
    const [r1, r2, r3] = rows.slice(-3);
    if (isRed(r1) && isRed(r2) && isRed(r3) &&
        C(r1) < C(r2) && C(r2) < C(r3) &&
        bodyPct(r1) > 0.3 && bodyPct(r2) > 0.3 && bodyPct(r3) > 0.3 &&
        upShadow(r1) < body(r1) && upShadow(r2) < body(r2) && upShadow(r3) < body(r3)) {
      patterns.push('红三兵');
    }
  }

  // 7. 早晨之星：三日组合（大阴线 + 十字星/小实体 + 大阳线，第三根收盘价深入第一根）
  if (rows.length >= 3) {
    const [s1, s2, s3] = rows.slice(-3);
    if (isGreen(s1) && bodyPct(s1) > 0.6 &&
        body(s2) < body(s1) * 0.3 &&
        isRed(s3) && bodyPct(s3) > 0.5 &&
        C(s3) > (O(s1) + C(s1)) / 2) {
      patterns.push('早晨之星');
    }
  }

  // 8. 乌云盖顶：大阳后高开低走大阴，收盘价深入到前阳一半以下
  if (rows.length >= 2) {
    if (isRed(prev) && bodyPct(prev) > 0.5 &&
        O(last) > C(prev) && isGreen(last) && bodyPct(last) > 0.5 &&
        C(last) < (O(prev) + C(prev)) / 2) {
      patterns.push('乌云盖顶');
    }
  }

  // 9. 身怀六甲：前日大K线，今日小K线完全包含在前日实体内
  if (rows.length >= 2) {
    const topP = Math.max(O(prev), C(prev)), botP = Math.min(O(prev), C(prev));
    const topL = Math.max(O(last), C(last)), botL = Math.min(O(last), C(last));
    if (body(prev) > body(last) * 2 && topL <= topP && botL >= botP) {
      patterns.push('身怀六甲');
    }
  }

  // 10. 多方炮：阳-阴-阳，第三根收盘价高于第一根高点
  if (rows.length >= 3) {
    const [p1, p2, p3] = rows.slice(-3);
    if (isRed(p1) && isGreen(p2) && isRed(p3) &&
        body(p2) < body(p1) * 0.8 &&
        C(p3) > H(p1) && O(p3) > C(p2)) {
      patterns.push('多方炮');
    }
  }

  // 11. N字涨停：近5日内出现「涨停-回调-涨停」或「涨停-小阴-涨停」
  if (rows.length >= 5) {
    const seg = rows.slice(-5);
    for (let i = 0; i < seg.length - 2; i++) {
      if (pct(seg[i]) >= limitPct(seg[i]) - 0.5 &&
          pct(seg[i + 2]) >= limitPct(seg[i + 2]) - 0.5 &&
          pct(seg[i + 1]) < 3 && pct(seg[i + 1]) > -5) {
        patterns.push('N字涨停');
        break;
      }
    }
  }

  // 12. 平台突破：近15日横盘（振幅<15%），今日放量突破区间上沿
  if (rows.length >= 20) {
    const seg = rows.slice(-16, -1);
    const hiPlat = Math.max(...seg.map(H));
    const loPlat = Math.min(...seg.map(L));
    if (hiPlat > loPlat && (hiPlat - loPlat) / loPlat < 0.15 &&
        C(last) >= hiPlat * 0.99 && pct(last) > 3) {
      const vAvg = seg.reduce((a, r) => a + V(r), 0) / seg.length;
      if (V(last) > vAvg * 1.5) patterns.push('平台突破');
    }
  }

  // 13. 仙人指路：长上影线（≥2倍实体），放量，当日收阳或平收，处于突破前高过程中
  if (upShadow(last) >= body(last) * 2 && bodyPct(last) > 0.15 && V(last) > 0) {
    const v20 = rows.slice(-20).reduce((a, r) => a + V(r), 0) / 20;
    const hi20 = Math.max(...rows.slice(-21, -1).map(H));
    if (V(last) > v20 * 1.5 && H(last) >= hi20 * 0.98 && C(last) >= O(last)) {
      patterns.push('仙人指路');
    }
  }

  // 14. 三连板/连板标识（虽然不是经典形态，但对复盘极有用）
  if (rows.length >= 3) {
    const last3 = rows.slice(-3);
    if (last3.every(r => pct(r) >= limitPct(r) - 0.5)) patterns.push('三连板');
    else if (last2.every(r => pct(r) >= limitPct(r) - 0.5)) patterns.push('连板');
  }

  return { names: patterns, text: patterns.length ? patterns.join(' / ') : '无明显形态' };
}

// nz：大A玄学字辈批量涨停检测（2026-10-29 用户点单「洋字辈/华字辈/马字辈看着不靠谱但批量涨停」）
// ⛔ 字辈判定铁律（用户 12:02 纠正）：名字里带那个字 ≠ 就是那个字辈 —— 「XX科技」的"科"是行业后缀，
//    不是"科字辈"炒作。字辈看的是名字【前部的核心字】：首字最强、次字次之；
//    出现在名字后半部分的一律不算（通用后缀：科技/股份/集团/发展/国际…里的字都不认）。
// 返回 [{key, type: 'first'|'early'|'clan', count, items: [{code,name}]}]，按 count 降序，只保留 count>=min 的
function analyzeNameClans(pool, min = 3) {
  if (!Array.isArray(pool) || !pool.length) return [];
  // 单字玄学库：生肖 + 方位 + 吉祥 + 自然 + 颜色金属（大A炒作编年史 2023-2026）
  // ⛔ 刻意不含「科/技/学/源/业/化/股/份」这类行业后缀字 —— 它们永远出现在名字后半部，天然被位置规则挡住；
  //    但去掉它们也让「首字是科」的票（真科字辈）依然能被 'first' 通道捕获。
  const CHAR_CLANS = '华龙凤马牛兔蛇虎羊猴鸡狗猪鼠鱼鹏鹰燕鹤鹿象福禄寿喜财发盛兴达昌隆顺安泰恒永长通联信智能源光电风水火土金银铜铁锂钠钛硅碳东南西北中天山地河湖海川林森雪云雨芯网数链玉阳春夏秋冬爱乐美嘉';
  // ⛔ 字根族（同音/近音，大A生肖行情核心玩法 2026-10-29）：羊年=羊/洋/阳/扬/杨
  const PHONETIC_CLANS = [
    { key: '羊洋阳扬杨', members: ['羊', '洋', '阳', '扬', '杨'] },
    { key: '龙', members: ['龙'] },
    { key: '蛇', members: ['蛇'] },
    { key: '马', members: ['马'] },
    { key: '牛', members: ['牛'] },
    { key: '兔', members: ['兔'] },
    { key: '虎', members: ['虎'] },
    { key: '华', members: ['华'] }
  ];
  // ⛔ 位置铁律：字辈字必须出现在名字【前半部】——index < ceil(name.length/2)
  //    襄阳轴承(阳@1,4字,1<2✓) 百洋股份(洋@1,4字✓) 三羊马(羊@1,3字,1<2✓) XX科技(科@2,4字,2<2✗挡住)
  const inClanPos = (nm, ch) => {
    const i = nm.indexOf(ch);
    if (i < 0) return false;
    return i < Math.ceil(nm.length / 2);
  };
  const firstMap = new Map(), earlyMap = new Map(), clanMap = new Map();
  for (const z of pool) {
    if (!z || !z.name || !z.code) continue;
    const nm = String(z.name);
    const item = { code: z.code, name: nm };
    const first = nm.charAt(0);
    if (first) { if (!firstMap.has(first)) firstMap.set(first, []); firstMap.get(first).push(item); }
    // ⛔ 次字通道已删（2026-10-29 重复 bug）：CHAR_CLANS 循环的 inClanPos 天然覆盖首字/次字，
    //    单独开次字通道会对命中字（阳/光…）重复 push 两次，count 虚增、items 重复。
    for (const clan of PHONETIC_CLANS) {
      if (clan.members.some(m => inClanPos(nm, m))) {
        if (!clanMap.has(clan.key)) clanMap.set(clan.key, []);
        clanMap.get(clan.key).push(item);
      }
    }
    for (const ch of CHAR_CLANS) {
      if (inClanPos(nm, ch)) {
        if (!earlyMap.has(ch)) earlyMap.set(ch, []);
        earlyMap.get(ch).push(item);
      }
    }
  }
  const out = [];
  const seen = new Map(); // key → 已入条目的 index（去重：clan > first > early，items 并集）
  const _push = (key, type, v) => {
    if (v.length < min) return;
    if (seen.has(key)) { // 并集去重
      const ex = out[seen.get(key)];
      const codes = new Set(ex.items.map(i => i.code));
      for (const it of v) if (!codes.has(it.code)) ex.items.push(it);
      ex.count = ex.items.length;
      return;
    }
    seen.set(key, out.length);
    out.push({ key, type, count: v.length, items: v });
  };
  for (const [k, v] of clanMap) _push(k, 'clan', v);
  for (const [k, v] of firstMap) _push(k, 'first', v);
  for (const [k, v] of earlyMap) _push(k, 'early', v);
  out.sort((a, b) => b.count - a.count || (a.type === 'clan' ? -1 : a.type === 'first' ? -1 : 1));
  // ⛔ 折叠展示：单字条目若已被更大的同音族覆盖（其字是族成员且族数量≥单字），隐藏单字条目
  const clans = out.filter(x => x.type === 'clan');
  const folded = out.filter(x => {
    if (x.type === 'clan') return true;
    const covered = clans.some(c => c.key.includes(x.key) && c.count >= x.count);
    return !covered;
  });
  return folded.slice(0, 8);
}

// nz-2：字辈全市场扫描（2026-10-29 用户点单「字辈强的时候，把所有带那个字辈的都找出来」）
// clan = analyzeNameClans 的一个条目；stocks = 全A快照（[{code,name,pct,price...}]）
// 返回 { total, hits: [{code,name,pct,price,isZT}] }，按 pct 降序；max 限制返回条数（全量 too big 不下发）
function scanNameClan(stocks, clan, ztCodes, max = 20) {
  if (!Array.isArray(stocks) || !stocks.length || !clan || !clan.key) return { total: 0, hits: [] };
  const members = clan.type === 'clan' ? clan.key.split('') : [clan.key];
  const ztSet = ztCodes instanceof Set ? ztCodes : new Set(ztCodes || []);
  const hits = [];
  for (const s of stocks) {
    if (!s || !s.name || !s.code) continue;
    const nm = String(s.name);
    const ok = members.some(ch => {
      const i = nm.indexOf(ch);
      return i >= 0 && i < Math.ceil(nm.length / 2);
    });
    if (!ok) continue;
    hits.push({
      code: s.code, name: nm,
      pct: s.pct != null ? +s.pct : null,
      price: s.price != null ? +s.price : null,
      isZT: ztSet.has(s.code)
    });
  }
  hits.sort((a, b) => (b.pct || 0) - (a.pct || 0));
  return { total: hits.length, hits: hits.slice(0, max) };
}

// oa：指数纪律警示（2026-10-29 用户交易纪律铁律·警示参考版，⛔ 不接模拟盘、不构成买卖建议）
//   规则（作用于指数日K，用户原话）：①盘中/收盘站上昨日最高价 → 可做（进场参考）
//   ②收盘跌破昨日最低价 → 不可做（离场警示，次日强制休息）③其他 → 观望
// rows = 指数日K（日期升序，至少2行）。返回 {signal:'entry'|'exit'|'flat', close, prevHigh, prevLow, day}；判不出返回 null。
function indexDisciplineOf(rows) {
  if (!rows || rows.length < 2) return null;
  const getN = (r, keys) => { for (const k of keys) { const v = Number(r[k]); if (v > 0) return v; } return 0; };
  const prev = rows[rows.length - 2], last = rows[rows.length - 1];
  const prevHigh = getN(prev, ['high', 'h']);
  const prevLow = getN(prev, ['low', 'l']);
  const close = getN(last, ['close', 'c']);
  const day = String(last.date || last.d || '');
  if (!(prevHigh > 0) || !(prevLow > 0) || !(close > 0)) return null; // 判不出不硬判
  const signal = close > prevHigh ? 'entry' : close < prevLow ? 'exit' : 'flat';
  return { signal, close, prevHigh, prevLow, day };
}

