// kf 轮守门：「洗盘趋势」模块——washVsDistribute 同口径的市场级洗盘观察池
// 钉的语义：① 判定只认 washVsDistribute（与 K线面板/持仓预警同一尺子，score>=2=洗盘）；
//          ② 候选硬前提=当日回调 + 主力（大单）净流入未撤（洗盘≠出货的核心区别）；
//          ③ 路由仅开发者可见（只读返回 locked）；④ 推送有闸（主实例+数据窗口+当日去重+限量）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const MOB = fs.readFileSync(path.join(ROOT, 'public', 'mobile.html'), 'utf8');

let pass = 0, fail = 0;
// 花括号配平取函数体（本套件独立运行，不依赖其它守门的 helper）
function bodyAt(src, idx) {
  const b = src.indexOf('{', idx);
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return '';
}
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') throw new Error('守门断言条件必须是布尔值: ' + name);
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}

// ── ① 后端：扫描函数与判定口径 ──
ok(/async function washTrendScan\(opts = \{\}\)/.test(SV), 'W1 washTrendScan 存在');
ok(/WASH_TREND_CACHE_MS = 5 \* 60 \* 1000/.test(SV), 'W2 5 分钟 TTL（K线扫描有成本，不逐请求重算）');
ok(/if \(!signal\) return;/.test(SV)
  && /washVsDistribute\(tail, flowRec, day\)/.test(SV) && /accumulateOf\(tail, flowRec, day, \{ flowHist/.test(SV),
  'W3 ⛔ 硬闸门：洗盘/吸筹双判定都没过不进池（mixed/unknown/distribute 一律不收）');
ok(/washVsDistribute\(tail, flowRec\)/.test(SV), 'W4 判定走 washVsDistribute（与K线面板/持仓预警同一把尺子）');
ok(/if \(!\(fl && \(fl\.today > 2e6 \|\| fl\.mainPct > 0\.8\)\)\) return/.test(SV),
  'W5 大单未撤硬前提在【实取资金流后】判定（kt：净额>200万 或 净占比>0.8%，快照恒0不能当判据）');
ok(/if \(pct > -0\.5 \|\| pct < -5\.5\) continue/.test(SV), 'W6 候选须当日回调（-5.5%~-0.5%，不崩不追）');
ok(/const flowRec = await klineFlowOf\(s\.code\)/.test(SV),
  'W7 资金流实取 klineFlowOf（东财四级/同花顺兜底），取不到 data=null 不拿 0 冒充');
ok(/judged\+\+;/.test(SV) && /keptFlow\+\+;/.test(SV), 'W7b 深判/过大单闸计数留痕（note 可见漏斗）');

// ── ② 后端：路由权限（仅开发者可见）──
{
  const i = SV.indexOf("if (p === '/api/wash-trend')");
  ok(i > 0, 'W8 /api/wash-trend 路由存在');
  const seg = SV.slice(i, i + 950);
  ok(/if \(!isEditorReq\(req\)\) return json\(res, \{ locked: true/.test(seg),
    'W9 ⛔ 只读返回 locked（与 /api/abnormal-move 同 pattern，非 isEditorReq 参数化放行）');
  ok(/washTrendScan\(\{ force, max, board \}\)/.test(seg), 'W10 路由调用扫描并透传 force/max/board');
}

// ── ③ 后端：推送闸门（防刷屏 + 防副本外发）──
// ⛔ 锚点从 washTrendScan 函数体内部起找：版本注释链里也有「新命中私密推送」字样，
//    全局 indexOf 会先命中注释链（位置近似语义的第四种形态，别在同一块石头上摔第四次）。
{
  const iFn = SV.indexOf('async function washTrendScan');
  const i = SV.indexOf('// 新命中私密推送', iFn);
  const seg = i > 0 ? SV.slice(i, i + 1500) : '';
  ok(i > 0, 'W11 新命中推送段存在');
  ok(/!isReplica\(\) && isDataWindow\(\)/.test(seg), 'W12 仅主实例 + 数据窗口内外发');
  ok(/_washTrendPushed\.has\(key\)/.test(seg), 'W13 当日按代码去重');
  ok(/pushed >= WASH_TREND_MAX_PUSH\)/.test(seg), 'W14 单次扫描限量（防连环新命中刷屏）');
  ok(/private: true/.test(seg), 'W15 走私密通道（操作向判定不外发群里）');
  const j = SV.indexOf('kf 轮：洗盘趋势池定时扫描');
  ok(j > 0 && /setInterval\(guard\('wash-trend'/.test(SV.slice(j, j + 500)), 'W16 定时器已挂 guard 且挂启动链补跑');
}

// ── ③b 收盘锁死（kh 轮）：冻结当日最后一次盘中刷新到次日开盘前 ──
{
  const iFn = SV.indexOf('async function washTrendScan');
  const seg = SV.slice(iFn, iFn + 2600);
  ok(/const day = \(typeof quoteDayOf === 'function'\) \? quoteDayOf\(Date\.now\(\)\) : todayStr\(\);/.test(seg),
    'W15b 归属日按 quoteDayOf（收盘后/周末归最后交易日=「次日开盘前」口径）');
  ok(/if \(cache\.data\.frozen\) return cache\.data;/.test(seg),
    'W15c 冻结数据直接返回（force 也不重建）');
  ok(/if \(afterClose\) \{[\s\S]{0,200}cache\.data\.frozen = true;/.test(seg),
    'W15d 收盘后（15:02 起，lu 起午休不再误锁）首次调用把最后一次盘中结果置 frozen');
  ok(/frozen: afterClose/.test(SV.slice(iFn, iFn + 5200)), 'W15e 收盘后冷启动补算的结果直接落 frozen（lu：按 afterClose 非 !inTrade）');
  ok(/cache\.data\.day === day && \(now - cache\.ts\) < WASH_TREND_CACHE_MS/.test(seg),
    'W15f TTL 缓存也按归属日匹配（跨日不返回昨日数据）');
  ok(/d && d\.frozen \? ' · 🔒收盘已锁' : ''/.test(fs.readFileSync(path.join(ROOT, 'public', 'mobile.html'), 'utf8')),
    'W15g 前端 meta 显示锁盘标记');
}

// ── ③c 板块口径（ki 轮）：全部/主板/创业板，缓存按 board 隔离、推送只在「全部」──
{
  const iFn = SV.indexOf('async function washTrendScan');
  const seg = SV.slice(iFn, iFn + 1400);
  ok(/const board = \['main', 'gem'\]\.includes\(opts\.board\) \? opts\.board : 'all';/.test(seg),
    'W23 board 参数三口径（all/main/gem），非法值兜底 all');
  ok(/let _washTrendCache = \{\};/.test(SV) && /const cache = _washTrendCache\[board\] \|\| \(_washTrendCache\[board\] = \{ ts: 0, data: null, busy: false \}\);/.test(seg),
    'W24 缓存按 board 隔离（三口径各自 TTL 与冻结，互不串档）');
  ok(/if \(board === 'main'\) \{ if \(!\(c\.startsWith\('00'\) \|\| c\.startsWith\('60'\)\)\) continue; \}/.test(SV.slice(iFn, iFn + 3600)),
    'W25 预筛按板块过滤（主板=00/60，创业板=30）');
  const iPush = SV.indexOf('新命中私密推送', iFn);
  ok(/if \(board === 'all' && !isReplica\(\) && isDataWindow\(\)\) \{/.test(SV.slice(iPush, iPush + 700)),
    'W26 ⛔ 私密推送只在「全部」口径触发（板块切换不重复外发）');
  const iRt = SV.indexOf("if (p === '/api/wash-trend')");
  ok(/const board = \['main', 'gem'\]\.includes\(u\.searchParams\.get\('board'\)\) \? u\.searchParams\.get\('board'\) : 'all';/.test(SV.slice(iRt, iRt + 800)),
    'W27 路由解析 board 参数并透传扫描');
  ok(/function setWtBoard\(board\)/.test(MOB) && /localStorage\.setItem\('wtBoard'/.test(MOB)
    && /'board=' \+ encodeURIComponent\(board\)/.test(MOB),
    'W28 前端口径切换+localStorage 记忆+fetch 带 board');
}

// ── ③d 周末不空池 + 冻结池落盘（kj 轮）──
{
  const iFn = SV.indexOf('async function washTrendScan');
  ok(/function washVsDistribute\(rows, flowRec, dayRef\)/.test(SV)
    && /const today = String\(\(typeof dayRef === 'string' && dayRef\) \|\| todayStr\(\) \|\| ''\)\.replace\(\/-\/g, ''\);/.test(SV),
    'W29 washVsDistribute 归属日可传（kj：不传=日历 todayStr，K线面板/持仓预警原行为不变）');
  ok(/washVsDistribute\(tail, flowRec, day\)/.test(SV),
    'W30 ⛔ 洗盘池把 quoteDayOf 归属日传给 freshness 校验（周末/午夜后日历翻篇但数据仍属最后交易日，不再全判陈旧）');
  ok(/const WASH_TREND_FILE = path\.join\(__dirname, 'wash_trend\.json'\);/.test(SV)
    && /function _washTrendPersist\(\)/.test(SV)
    && /if \(data\.frozen\) _washTrendPersist\(\);/.test(SV),
    'W31 冻结池落盘（收盘冻结/冷启动冻结结果都写 wash_trend.json，只落 frozen 结果）');
  const j = SV.indexOf('kj 轮：冻结池启动恢复');
  ok(j > 0 && /readJsonSafe\(WASH_TREND_FILE/.test(SV.slice(j, j + 700))
    && /d\.day === _wtDay/.test(SV.slice(j, j + 700)),
    'W32 启动恢复：按归属日匹配读回冻结池（发布后/回收后重启不清空池子）');
  const pub = fs.readFileSync(path.join(ROOT, '_publish.py'), 'utf8');
  ok(/"wash_trend\.json"/.test(pub), 'W33 wash_trend.json 已进 DATA_FILES 随包发布');
}

// ── ④ 前端：卡片在计划 Tab + locked 隐藏 ──
{
  const i = MOB.indexOf('id="tab-plan"');
  const seg = MOB.slice(i, i + 1200);
  ok(i > 0 && /id="wtCard"/.test(seg) && /id="wtBody"/.test(seg) && /id="wtMeta"/.test(seg),
    'W17 洗盘趋势卡片在计划 Tab（wtCard/wtBody/wtMeta）');
  ok(/async function loadWashTrend\(force\)/.test(MOB), 'W18 loadWashTrend 存在');
  ok(/r\.status === 401 \|\| r\.status === 403[\s\S]{0,260}display = 'none'/.test(MOB),
    'W19 401/403 时隐藏卡片（只读设备不闪空卡）');
  ok(/d && d\.locked[\s\S]{0,80}display = 'none'/.test(MOB), 'W20 响应 locked 时隐藏卡片');
  ok(/loadWashTrend\(false\);/.test(MOB), 'W21 init 加载链已接 loadWashTrend');
  ok(/\$\{x\.signal === '吸筹' \? '📥吸筹' : '🧹洗盘'\}\+\$\{x\.score\}分/.test(MOB), 'W22 行内展示信号徽标+得分（洗盘/吸筹）');
}

// ── ⑤ 吸筹判定器 accumulateOf：沙箱真跑（kk 轮）──
{
  const decl = 'function accumulateOf(rows, flowRec, dayRef, env)';
  const i = SV.indexOf(decl);
  if (i < 0) throw new Error('未找到 accumulateOf');
  const body = decl + bodyAt(SV, i);   // ⛔ 括号配平取整函数（定长切片会在函数中间截断=语法炸）
  const fn = new Function('todayStr', body + '\nreturn accumulateOf;')(() => '20261023');
  const DAY = '20261023';
  // 低位地量+资金：15 根 K 线，价格处区间 20% 位、近5日量缩到 50%、当日主力净入 800 万
  const mkLow = () => {
    const rows = [];
    for (let k = 0; k < 15; k++) {
      const close = k < 10 ? 20 - k * 0.3 : 17.2 + (k - 10) * 0.05;   // 前段下跌后低位横盘
      rows.push({ date: k === 14 ? '2026-10-23' : '2026-10-' + String(10 + k).padStart(2, '0'), open: close * 0.995, close, high: close * 1.01, low: close * 0.985, pct: k === 14 ? -0.4 : (k > 0 ? (close / rows[k-1].close - 1) * 100 : -1), volume: k < 10 ? 1000 : 380 });
    }
    return rows;
  };
  const flowPos = { data: { mainPct: 2.2, today: 8e6, superNet: 5e6, bigNet: 2e6 } };
  const rAcc = fn(mkLow(), flowPos, DAY);
  ok(rAcc.verdict === 'accumulate' && rAcc.score >= 3, 'W34 低位+地量+资金 → 判吸筹（沙箱真跑）', JSON.stringify(rAcc.reasons).slice(0, 120));
  const rNoFlow = fn(mkLow(), { data: null, why: 'test' }, DAY);
  ok(rNoFlow.verdict !== 'accumulate', 'W35 缺资金证据 → 不硬判吸筹（硬闸门）');
  // 高位+资金 → 缺低位前提，不判
  const mkHigh = () => { const r = mkLow(); for (let k = 0; k < 15; k++) { const close = 20 + k * 0.3; r[k] = { ...r[k], close, high: close * 1.01, low: close * 0.99, open: close * 0.995, pct: 0.5, volume: k < 10 ? 1000 : 500 }; } return r; };
  const rHigh = fn(mkHigh(), flowPos, DAY);
  ok(rHigh.verdict !== 'accumulate', 'W36 高位+资金 → 不判吸筹（缺低位前提）');
  const rStale = fn(mkLow(), flowPos, '20261024');
  ok(rStale.verdict === 'none', 'W37 归属日不匹配 → 判不出（不硬判）');
  ok(/signal = '吸筹'/.test(SV) && /nAcc/.test(SV), 'W38 扫描双判定接线（洗盘优先、吸筹兜底、计数入 note）');
  ok(/x\.signal === '吸筹' \? '📥吸筹' : '🧹洗盘'/.test(MOB), 'W39 前端行内区分 吸筹/洗盘 徽标');
}

// ── ⑥ 上升中继洗盘 relayWashOf（kl 轮，用户四要素模型）：沙箱真跑 ──
{
  const decl = 'function relayWashOf(rows, dayRef, env)';
  const i = SV.indexOf(decl);
  if (i < 0) throw new Error('未找到 relayWashOf');
  const src = fs.readFileSync(path.join(ROOT, 'analysis.js'), 'utf8');
  const maDecl = 'function klineMaOf(rows)';
  const im = SV.indexOf(maDecl);
  if (im < 0) throw new Error('未找到 klineMaOf');
  const fn = new Function('todayStr', 'klineMaOf', 'A',
    maDecl + bodyAt(SV, im) + '\n' + decl + bodyAt(SV, i) + '\nreturn relayWashOf;'
  )(() => '20261023', null, require('./analysis.js'));   // lr：注入 A（筹码峰 chipPeakOf 用）
  // 合成（km 框架）：60 根——前45日高波动缓涨通道（峰值量1000），末15日回踩20日线、低波动+阶梯缩量至峰值40-60%
  const rows = [];
  let c = 20;
  for (let k = 0; k < 60; k++) {
    const up = k < 45, pull = !up ? -(k - 44) * 0.09 : 0;
    c = 20 + k * 0.05 + pull;
    const wig = up ? 0.03 : 0.008;                                   // 前段高波动、回踩段波动收敛
    const vol = up ? 1000 : 700 - (k - 45) * 22;                     // 回踩阶梯缩量 700→392（对峰值≈41%）
    rows.push({ date: k === 59 ? '2026-10-23' : `2026-08-${String((k % 28) + 1).padStart(2, '0')}`, open: c * (1 - wig / 2), close: c, high: c * (1 + wig), low: c * (1 - wig), pct: k === 0 ? 0 : (c / rows[k - 1].close - 1) * 100, volume: Math.max(vol, 100) });
  }
  const env = { turnover: 3, mktAvgPct: -2 };                        // 换手理想区 + 当日跑赢全A（-0.5 vs -2）
  const r1 = fn(rows, '20261023', env);
  ok(r1.verdict === 'relay-wash' && r1.score >= 6, 'W40 基础两项+加强分达标 → relay-wash（沙箱真跑）', JSON.stringify({ v: r1.verdict, s: r1.score, r: (r1.reasons || []).map(x => x.text).join('|') }).slice(0, 160));
  // 基础项缺失（量没缩到位）→ 直接不判
  const rowsLoose = rows.slice();
  for (let k = 50; k < 60; k++) rowsLoose[k] = { ...rowsLoose[k], volume: 900 };
  ok(fn(rowsLoose, '20261023', env).verdict === 'none', 'W41 ⛔ 基础项 B1 缩量不达标 → 无资格（必须项把关）');
  // 高位 + 近3日砸盘>5% → 排除项拦截（高位连板后大幅回调=出货后地量）
  const rowsHigh = rows.map((r, k) => { const cc = 20 + k * 0.2; return { ...r, close: cc, open: cc * 0.999, high: cc * 1.005, low: cc * 0.995, pct: k >= 57 ? -2.2 : 0.3, volume: 500 }; });
  ok(fn(rowsHigh, '20261023', env).verdict === 'none', 'W42 ⛔ 高位+近3日砸盘>5% → 排除项拦截（出货形态）');
  // 分级触发：放量大阳站上5/10日线且量比≥1.9 → 红灯；仅站上5日线量比1.6 → 黄灯
  const lastC = rows[59].close;
  const rowsRed = rows.slice(); rowsRed[59] = { ...rowsRed[59], close: lastC * 1.04, open: lastC * 1.01, high: lastC * 1.045, low: lastC * 1.005, pct: 4, volume: 1000 };
  const rRed = fn(rowsRed, '20261023', env);
  ok(rRed.breakout && rRed.breakout.fired && rRed.breakout.level === 'red', 'W43 放量站上5/10日线+量比≥1.9 → 🔴红灯');
  const rowsY = rows.slice(); rowsY[59] = { ...rowsY[59], close: lastC * 1.02, open: lastC * 1.0, high: lastC * 1.03, low: lastC * 0.998, pct: 2, volume: 560 };
  const rY = fn(rowsY, '20261023', env);
  ok(rY.breakout && rY.breakout.fired && rY.breakout.level === 'yellow', 'W44 放量站上5日线（量比1.2/峰值56%）→ 🟡黄灯（未达红灯双轨）');
  ok(fn(rows, '20261024', env).verdict === 'none', 'W45 归属日不匹配 → 判不出（不硬判）');
  ok(/relayWashOf\(tail, day, \{ mktAvgPct, turnover/.test(SV) && /newsWarnsCode\(String\(s\.code\)\)/.test(SV),
    'W46 env 透传（换手/全A均值）+ 利空在案排除接线');
  ok(/🔴 洗盘结束·红灯/.test(MOB) && /洗盘结束·黄灯/.test(MOB) && /⚠️🟡/.test(MOB), 'W47 前端红灯/黄灯/存疑黄灯三徽标');
  // kn 轮：红灯动态化——峰值回归路径 + 市场温度动态阈值
  const rowsP = rows.slice(); rowsP[59] = { ...rowsP[59], close: lastC * 1.02, open: lastC * 1.0, high: lastC * 1.03, low: lastC * 0.999, pct: 2, volume: 700 };
  const rP = fn(rowsP, '20261023', env);   // 量比仅1.53<冷市阈值2.0，但 700/1000=70%≥60% 峰值回归 → 红灯
  ok(rP.breakout && rP.breakout.fired && rP.breakout.level === 'red', 'W48 峰值回归路径：量比不达标但攻击量回归≥60% → 红灯');
  const rowsH = rows.slice(); rowsH[59] = { ...rowsH[59], close: lastC * 1.025, open: lastC * 1.0, high: lastC * 1.03, low: lastC * 0.999, pct: 2.5, volume: 830 };
  const rH = fn(rowsH, '20261023', { turnover: 3, mktAvgPct: 2 });   // 热市阈值1.7，量比1.81≥1.7 → 红灯
  ok(rH.breakout && rH.breakout.fired && rH.breakout.level === 'red', 'W49 市场温度路径：热市阈值放宽1.7，量比1.81 → 红灯');
  ok(/dynTh/.test(SV) && /volVsPeak/.test(SV) && /mktAvg >= 1\.5 \? 1\.7/.test(SV), 'W50 双轨动态阈值接线（温度调阈+峰值回归）');
  // ko 轮：假突破判别——长上影+收日内低位的「突破」红灯缓亮只给黄灯(存疑)
  const rowsF = rows.slice(); rowsF[59] = { ...rowsF[59], open: lastC * 1.05, high: lastC * 1.10, low: lastC * 0.99, close: lastC * 1.02, pct: 2, volume: 1000 };
  const rF = fn(rowsF, '20261023', env);
  ok(rF.breakout && rF.breakout.fired && rF.breakout.level === 'yellow' && rF.breakout.suspect === true,
    'W51 假突破判别：冲高回落形态 → 红灯缓亮，黄灯(存疑)+警告');
  ok(rRed.breakout.suspect === false, 'W52 真突破无嫌疑标记（干净红灯）');
  // ko→kw 轮：板块热度闸前移到预筛层（_hotEnough 助手），分层口径：预闸资金前50，洗盘信号再收紧热门
  ok(/const _hotEnough = s =>/.test(SV)
    && (SV.match(/if \(!_hotEnough\(s\)\) \{ nCold\+\+; continue; \}/g) || []).length === 2,
    'W53a 板块闸前移预筛层（两个候选循环各一道）+nCold 计数');
  ok(/if \(signal === '洗盘' && !_heat\.hot && !panicDay\) \{ nHeatTight\+\+; return; \}/.test(SV)
    && /洗盘再收紧 \$\{nHeatTight\} 只/.test(SV),
    'W53b 洗盘信号收紧到热门板块（前25/有涨停，恐慌日放开避险）+计数入 note');
  // kq 轮：多日资金流吸筹证据（env.flowHist）——用户点题「吸筹可能不是单日，是多日洗盘吸筹」
  const DAY = '20261023';
  const declAcc = 'function accumulateOf(rows, flowRec, dayRef, env)';
  const ia = SV.indexOf(declAcc);
  if (ia < 0) throw new Error('未找到 accumulateOf');
  const fnAcc = new Function('todayStr', declAcc + bodyAt(SV, ia) + '\nreturn accumulateOf;')(() => '20261023');
  const mkHist = arr => arr.map(([d, m]) => ({ date: d, main: m }));
  const mkLow = () => {                        // 与 ⑤ 段同款低位地量夹具（块级作用域各自独立）
    const rows = [];
    for (let k = 0; k < 15; k++) {
      const close = k < 10 ? 20 - k * 0.3 : 17.2 + (k - 10) * 0.05;
      rows.push({ date: k === 14 ? '2026-10-23' : '2026-10-' + String(10 + k).padStart(2, '0'), open: close * 0.995, close, high: close * 1.01, low: close * 0.985, pct: k === 0 ? -1 : (k > 0 ? (close / rows[k - 1].close - 1) * 100 : -1), volume: k < 10 ? 1000 : 380 });
    }
    return rows;
  };
  const rMulti = fnAcc(mkLow(), { data: null, why: 'test' }, DAY, { flowHist: mkHist([['2026-10-19', 1e6], ['2026-10-20', 2e6], ['2026-10-21', 1.5e6], ['2026-10-22', -5e5], ['2026-10-23', 8e5]]) });
  ok(rMulti.verdict === 'accumulate', 'W54 当日无资金但近5日≥3天净入且累计为正 → 多日吸筹成立（资金硬闸多日口径）', rMulti.verdict + JSON.stringify((rMulti.reasons || []).map(x => x.text)).slice(0, 100));
  const rTurn = fnAcc(mkLow(), { data: null, why: 'test' }, DAY, { flowHist: mkHist([['2026-10-18', -1e6], ['2026-10-19', -1e6], ['2026-10-20', -1e6], ['2026-10-21', 1e6], ['2026-10-22', 1.5e6], ['2026-10-23', 1.5e6]]) });
  ok(rTurn.verdict === 'accumulate' && JSON.stringify(rTurn.reasons).includes('由负转正'), 'W55 资金由负转正 → 吸筹启动证据入理由');
  const rowsAlt = mkLow();
  for (let k = 10; k < 15; k++) rowsAlt[k] = { ...rowsAlt[k], pct: -1.2 };
  const rAlt = fnAcc(rowsAlt, { data: null, why: 'test' }, DAY, { flowHist: mkHist([['2026-10-20', 1e6], ['2026-10-21', 1.2e6], ['2026-10-22', 9e5], ['2026-10-23', 1.1e6], ['2026-10-19', 1e6]]) });
  ok(rAlt.verdict === 'accumulate' && JSON.stringify(rAlt.reasons).includes('洗盘/吸筹交替'), 'W56 回调日主力净入 ≥2 天 → 「洗盘/吸筹交替」证据');
  ok(/klineFlowHistOf\(s\.code\)/.test(SV) && /accumulateOf\(tail, flowRec, day, \{ flowHist, capYi/.test(SV),
    'W57 多日资金流接线（惰性拉取+透传 accumulateOf）');
  // kr→ks：接飞刀改「扣分不否决」（用户：不要太绝对）——减2分+警告；证据够硬仍能过
  const rowsKnife = mkLow();
  for (let k = 10; k < 15; k++) rowsKnife[k] = { ...rowsKnife[k], pct: -2.2 };
  const knifeHist = mkHist([['2026-10-19', 1e6], ['2026-10-20', 2e6], ['2026-10-21', 1.5e6], ['2026-10-22', 1e6], ['2026-10-23', 1e6]]);
  const rKnife = fnAcc(rowsKnife, { data: { mainPct: 3, today: 9e6, superNet: 5e6, bigNet: 3e6 } }, DAY, { flowHist: knifeHist });
  ok(rKnife.verdict === 'accumulate' && JSON.stringify(rKnife.reasons).includes('边砸边接'), 'W58 接飞刀扣分不否决：6分-2=4分 → 通过但带「边砸边接」警告（用户：不要太绝对）');
  const rowsThin = mkLow().map((r, k) => ({ ...r, volume: 1000, pct: k >= 10 ? -2.2 : r.pct }));   // 灭掉地量/回稳分
  const rKnife3 = fnAcc(rowsThin, { data: { mainPct: 3, today: 9e6 } }, DAY, { flowHist: [] });      // 灭掉多日/交替分
  ok(rKnife3.verdict === 'none' && JSON.stringify(rKnife3.reasons).includes('边砸边接'), 'W58c 接飞刀+证据单薄：3分-2=1分 → 被扣下（扣分闸真实生效）');
  // ks：小市值地板 25→15 亿 + 流通<100亿加分（两个判定器同口径）+ 证券类排除
  ok(/capYi && capYi < 40\) continue/.test(SV) && /小市值弹性/.test(SV) && /capYi: s\.floatCap > 0/.test(SV),
    'W59 小市值：地板40亿（kt：<40亿不进）、<100亿加分、env 透传两个判定器');
  ok(/证券\|券商\|期货\|多元金融\/\.test\(sec0\)[\s\S]{0,60}nBroker\+\+/.test(SV) && /证券类排除 \$\{nBroker\}/.test(SV),
    'W60 证券/券商/期货/多元金融类排除+nBroker 计数入 note（kw：预筛层）');
  // kt 轮：地板 40亿、ST 排除核验、权重股降分、恐慌日放开板块闸、池子扩容
  const AN = fs.readFileSync(path.join(ROOT, 'analysis.js'), 'utf8');
  ok(/capYi && capYi < 40\) continue/.test(SV), 'W61 小市值地板 40亿（两处预筛一致）');
  ok(/!\s*A\.isJunkName\(s\.name\)/.test(SV) && AN.includes('^(S|ST|\\*ST|退)|退'),
    'W62 ⛔ ST/*ST/退市 全管道排除（isJunkName 钉死 + 洗盘池基础过滤已挂）');
  ok(/capYiE >= 500\) \{ score--/.test(SV) && /capYiR >= 500\) \{ score--/.test(SV) && /权重股弹性差/.test(SV),
    'W63 权重股（≥500亿）两判定器各 -1');
  ok(/const panicDay = isFinite\(mktAvgPct\) && mktAvgPct <= -2/.test(SV)
    && /if \(panicDay\) return true;/.test(SV)
    && /signal === '洗盘' && !_heat\.hot && !panicDay/.test(SV)
    && /情绪极端·板块闸放开/.test(SV),
    'W64 情绪极端（全A≤-2%）板块闸放开——避险板块可进池，note 有标记');
  ok(/accCands\.slice\(0, 30\)/.test(SV) && /fl\.today > 2e6 \|\| fl\.mainPct > 0\.8/.test(SV)
    && /rw\.verdict === 'probable'/.test(SV) && /\|\| 12\)/.test(SV) && /WASH_TREND_MAX_SCAN = 48/.test(SV),
    'W65 池子扩容五件套：洗盘位40→48/吸筹位30/资金闸2e6·0.8%/probable准入/默认展示12');
  // kx：单进程有界并发深判（不加端口不加实例，用户：只保留一个端口+多开需许可）
  ok(/const WASH_TREND_CONC = 6;/.test(SV)
    && /const judgeOne = async s =>/.test(SV)
    && /await Promise\.all\(Array\.from\(\{ length: WASH_TREND_CONC \}, _worker\)\)/.test(SV)
    && /for \(const r of _results\) if \(r\) items\.push\(r\);/.test(SV),
    'W66 深判 6 路有界并发（judgeOne+worker 池+下标归位，顺序确定）');
  // ky：stale-while-revalidate——TTL 过期非手动 → 先返回旧池+后台重算（手机不傻等）
  ok(/if \(!force && cache\.data && cache\.data\.day === day && !cache\.busy\) \{[\s\S]{0,120}washTrendScan\(Object\.assign\(\{\}, opts, \{ force: true \}\)\)/.test(SV),
    'W67 ⛔ SWR：过期旧池立即返回+后台 force 重算（手动 force 仍同步等最新）');
}

  // lg：调研共识吸收——B2 三日有效破位口径 + 零轴上方回调 + 急跌快收复
  ok(/const broke3 = \(m\) => m != null && cls\.slice\(-3\)\.every\(c => c < m \* 0\.95\)/.test(SV)
    && /const effBroke = broke3\(ma20\) \|\| broke3\(ma30\)/.test(SV),
    'W68 B2 改三日有效破位口径（单日/双日砸破快速收回=假破位·洗盘特征，不否决）');
  ok(/const difNow = dif\[n - 1\];[\s\S]{0,80}difNow > 0\) \{ score\+\+/.test(SV) && /零轴上方回调——强势洗盘特征/.test(SV),
    'W69 加强项：MACD 零轴上方回调 +1（出货多在零轴下方·调研共识）');
  ok(/急跌快收复/.test(SV) && /rec >= drop \* 0\.5/.test(SV),
    'W70 加强项：单日大阴线后1-2日内收复过半 → 洗盘经典形态 +1');
  // lh：吸筹调研共识四源（股旁/财云/约投顾/百科）——首根放量阳线/黄金坑/换手理想区/对倒嫌疑
  ok(/低位首根放量阳线站稳短期均线/.test(SV) && /vAvg5b \* 1\.5/.test(SV),
    'W71 吸筹证据：低位首根放量阳线（量>前5日1.5倍·涨2-6%·站上短期均线）+1');
  ok(/挖坑后快速收复失地/.test(SV) && /rec >= drop \* 0\.8/.test(SV),
    'W72 吸筹证据：挖坑后 3 日内收复八成——黄金坑确认 +1');
  ok(/toE >= 3 && toE <= 8/.test(SV) && /3-8% 理想区/.test(SV),
    'W73 吸筹证据：当日换手 3-8% 理想区 +1（env.turnover 已透传）');
  ok(/dubious/.test(SV) && /对倒嫌疑/.test(SV) && /vAvg20b \* 2/.test(SV),
    'W74 风控：巨量窄幅（量>20日均2倍而涨跌<2%）→ 对倒嫌疑 -1');
  // lr：筹码峰维度（用户「结合筹码峰推票」）
  ok(/function chipPeakOf/.test(fs.readFileSync(path.join(ROOT,'analysis.js'),'utf8')) && /A\.chipPeakOf\(rows\)/.test(SV),
    'W75 筹码峰接线：analysis.chipPeakOf（60日量加权直方图）进 relayWashOf（密集站上峰顶+1/上方压力峰-1）');
  ok(/🧱 筹码：/.test(SV),
    'W76 洗盘池理由行带筹码结构备注');
  // ls：十日量能硬维度（用户：结合至少十日成交量）
  ok(/function volTenOf/.test(fs.readFileSync(path.join(ROOT,'analysis.js'),'utf8')) && (SV.match(/volTenOf/g)||[]).length >= 1 && fs.readFileSync(path.join(ROOT,'nextplan.js'),'utf8').includes('volTenOf'),
    'W77 volTenOf 接线：analysis 导出 + 洗盘/次日计划引用（红肥绿瘦/5v20/爆量三判据）');
  ok((SV.match(/chipPeakOf/g)||[]).length >= 3,
    'W78 筹码逻辑全页面铺开：竞价/量化/盘中/洗盘/次日计划五处接线');

  // ⛔ 2026-10-28 ms 轮热修守门：accumulateOf 曾引用未定义的 cls（从 relayWashOf 抄来）
  //    → 只要近10日出现过「涨2~6% 且量>前5日均量1.5倍」，就抛 ReferenceError，
  //      被调用方 catch 成「[wash-trend] 002027 cls is not defined」→ 该票整份吸筹判定丢失。
  //    钉语义：这个分支必须能真跑出信号（不是 0 分、不是判不出），且不许再出现裸 cls。
  {
    const iAcc = SV.indexOf('function accumulateOf(rows, flowRec, dayRef, env)');
    ok(iAcc > 0, 'W79 能定位 accumulateOf 源码');
    const bodyAcc = bodyAt(SV, iAcc);
    ok(!/\bcls\./.test(bodyAcc), 'W80 accumulateOf 内不再有裸 cls 引用（引用别的函数的变量 = 必抛）');
    // 造 20 根日线，倒数第 5 根是「涨 4% + 量 3 倍」→ 必须命中「低位首根放量阳线」
    const rows = [];
    for (let k = 19; k >= 0; k--) {
      const d = new Date(2026, 9, 23 - k);
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const surge = (k === 4);
      rows.push({ date: ds, open: 10, close: surge ? 10.4 : 10, high: surge ? 10.5 : 10.1,
        low: 9.9, volume: surge ? 30000 : 10000, amount: (surge ? 30000 : 10000) * 1000,
        amp: 2, pct: surge ? 4 : 0, chg: 0, turnover: 5 });
    }
    const declAcc = 'function accumulateOf(rows, flowRec, dayRef, env)';
    const acc = new Function('todayStr', declAcc + bodyAcc + '\nreturn accumulateOf;')(() => '20261023');
    let res = null, err = '';
    try { res = acc(rows, null, '20261023', { turnover: 5 }); } catch (e) { err = e && e.message; }
    ok(!err, 'W81 走「低位放量阳线」分支不抛错（' + (err || 'ok') + '）');
    ok(!!res && res.reasons.some(x => /低位首根放量阳线/.test(String(x.text || ''))),
      'W82 该分支确实产出「低位首根放量阳线站稳短期均线」信号（不是判不出）');
    // 反证：把 clSeries 换回 cls（改动前的实现）→ 同一份数据必须抛 ReferenceError
    const oldBody = bodyAcc.replace('const clSeries = rows.map(r => num(r.close));', '').replace(/clSeries/g, 'cls');
    let oldErr = '';
    try { new Function('todayStr', declAcc + oldBody + '\nreturn accumulateOf;')(() => '20261023')(rows, null, '20261023', { turnover: 5 }); }
    catch (e) { oldErr = e && e.message; }
    ok(/cls is not defined/.test(oldErr), '⛔ 反证：改动前实现确实抛 cls is not defined（这就是静默丢判定的根因）');
  }
console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0)