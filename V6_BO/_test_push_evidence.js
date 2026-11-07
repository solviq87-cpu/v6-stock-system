// hw 轮守门（2026-10-15，用户原话「关于推送我说了好多遍了、已经不想再重复了，你给我彻底改好」
//                              +「大单推送改实时，卡片精简点，每支票一个卡片，要精致一点」）。
//
// 【取证】本机 pushlog.json 500 条组成统计：
//   拦截类 440 条(88%)，其中 **299 条是同一句「大单流入 | 模块日上限拦截」**（60 秒一轮重复写入）；
//   ✅ 真送达只剩 56 条(11.2%)。→ 这份「今天已发」的**唯一落盘证据**被噪音灌满，
//   容量一满早上送达的记录就被裁掉，pushedToday / sentToday 喂的是被挤没的证据 →
//   重启后一会儿重复推、一会儿漏推。**判据本身没错，错的是喂给它的证据池。**
//
// 【修法三件套】（全部收在 pushLog 唯一入口，调用点零改动）
//   ① pushIsOutStatus：「已外发过」的统一判据，与 pushedToday 同一把尺子（不许两处分叉）
//   ② pushNoiseFind：拦截类噪音同 status + 同 title + 同日 合并计数，只占一条流水
//   ③ pushLogTrim：超容先丢噪音、送达证据最后才丢（旧的 length=cap 一刀切是重复推送的物理根因）
// 【附】/api/push-log 只返 slice(0,30) → 早上的竞价记录永远翻不到（「查不到」被当成「没发」）；
//   飞书是纯文本通道却到处发 <b> 标签；大单改实时 + 每票一张卡。
//
// 判据一律「钉语义不钉字符串」：函数体从源码原样切出、在沙箱里真跑；旧写法同沙箱反证。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const IH = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const SVK = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (typeof cond !== 'boolean') throw new Error('守门断言条件必须是布尔值（参数顺序写反了？）: ' + name);
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + '  ──'); }

// ── 花括号配平取函数体（与其它守门同源；在剥注释版上数，注释里的括号不算）──
function bodyAt(src, idx) {
  const b = src.indexOf('{', idx);
  let d = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(b, k + 1); }
  }
  return '';
}
function fnSrc(name, decl) {
  const i = SVK.indexOf(decl);
  if (i < 0) throw new Error('未找到 ' + name + '（锚点: ' + decl + '）');
  const b = bodyAt(SVK, i);
  if (!b) throw new Error(name + ' 函数体抽取失败');
  return decl + b;
}
const PIS = fnSrc('pushIsOutStatus', 'function pushIsOutStatus(st)');
const CPL = fnSrc('compactPushLog', 'function compactPushLog()');
const PLG = fnSrc('pushLog', 'function pushLog(status, text, extra)');
const PCT = fnSrc('pushLogCoversToday', 'function pushLogCoversToday()');
const PTD = fnSrc('pushedToday', 'function pushedToday(titleRe)');
// ⛔ stripNoise 会把正则字面量抹掉（其它守门早已记过这个坑：判据一律用 indexOf 不用正则）。
//    pushTitle / stripHtmlTags 的函数体里就是一条正则，剥注释版抽出来是残的 ——
//    这两个必须从**未剥注释的原文**取，否则沙箱里会静默抛错被空 catch 吞成"没记录"。
function fnRaw(name, decl) {
  const i = SV.indexOf(decl);
  if (i < 0) throw new Error('未找到 ' + name + '（原文锚点: ' + decl + '）');
  const b = bodyAt(SV, i);
  if (!b) throw new Error(name + ' 函数体抽取失败');
  return decl + b;
}
const PTT = fnRaw('pushTitle', 'function pushTitle(text)');
const SHT = fnRaw('stripHtmlTags', 'function stripHtmlTags(s)');
if (PTT.indexOf('/<[^>]+>/g') < 0) throw new Error('pushTitle 正则没抽到（必须走原文抽取）: ' + PTT.slice(0, 120));
// ⛔ 必须是「已知标签名白名单」而不是 /<[^>]+>/ 通杀：通杀会把「涨幅 <3% 且 >0%」吃成「涨幅 0%」
if (SHT.indexOf('/<\\/?(?:b|i|u|em|strong|br|hr|p|div|span|font|a|code|pre)\\b[^>]*>/gi') < 0) {
  throw new Error('stripHtmlTags 正则没抽到（或退化成通杀式）：' + SHT.slice(0, 160));
}

// 自保护：抽出来的必须真是那几个函数（抽错位置 = 后面全绿也白搭）
ok(/indexOf\('未发送'\)/.test(PIS) && /indexOf\('送达结果未知'\)/.test(PIS), 'pushIsOutStatus 抽取正确（含未发送/送达结果未知两条语义）');
ok(/seen\.set\(key, r\)/.test(CPL) && /pushIsOutStatus\(r\.status\)/.test(CPL), 'compactPushLog 抽取正确（合并噪音 + 跳过送达）');
ok(/splice\(i, 1\)/.test(CPL) && /pushIsOutStatus\(PUSH_LOG\[i\]/.test(CPL), 'compactPushLog 抽取正确（裁剪先丢非送达）');
// ⛔ 压实器必须真的被接上（定义了不调用 = 写了等于没写）
ok(/setTimeout\(\(\) => \{ try \{ compactPushLog\(\); \}/.test(SVK), '启动链补跑了压实（磁盘上那份正是被噪音灌满的 500 条）');
ok(/setInterval\([\s\S]{0,80}?compactPushLog\(\)/.test(SVK), '周期压实已挂载（每 5 分钟一次）');
// ⛔ 写入路径刻意保持原样：十几个守门套件把 pushLog 函数体抠出来真跑，加新符号会让沙箱静默失效
ok(!/function pushLog[\s\S]{0,1200}?pushIsOutStatus/.test(PLG), 'pushLog 函数体不依赖新符号（守门沙箱兼容）');
ok(/PUSH_LOG\.length = dataCapOf\('pushLog'\)/.test(PLG), 'pushLog 仍是原来的写入路径（压实负责降噪，写入零改动）');

// ───────────────────────────────────────────────────────────────────
group('[1] pushIsOutStatus：一份「已外发过」的判据，两处共用');
function makeSandbox() {
  const src = `
    const PUSH_LOG = [];
    let CAP = 500;
    // ⛔ if 轮修（§11 活数据锚定）：DAY 曾是写测试时冻结的 '20261015'，而流水记录用
    //    真实 Date.now() → dayKeyOf 算真实今天，两者一错位，10-16 起天天红（时钟拖红，
    //    不是代码改红）。改动态语义：DAY 从真实时钟取，setDay 仍留作覆盖入口。
    //    ⚠️ 教训：这次改守门自己踩了 §4 同款坑 —— 换行时把 let CAP = 500 一起删了，
    //    dataCapOf 引用未声明变量被 pushLog 的 catch{} 吞成"记录进了但 flush 不跑"，
    // 两条断言以很间接的方式红掉。沙箱里每个符号的声明都要逐个核对。
    let DAY = (() => { const d = new Date();
      return '' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0'); })();
    const dataCapOf = () => CAP;
    const todayStr = () => DAY;
    const dayKeyOf = (ts) => { if (!ts) return ''; const d = new Date(ts);
      return '' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0'); };
    ${PTT}
    ${PIS}
    ${CPL}
    ${PCT}
    ${PTD}
    let _pushLogTimer = null;
    let FLUSH = 0;
    const pushLogFlush = () => { FLUSH++; };
    ${PLG}
    return { PUSH_LOG, pushLog, pushIsOutStatus, compactPushLog, pushedToday,
      setCap: c => { CAP = c; }, setDay: d => { DAY = d; }, flushCount: () => FLUSH,
      reset: () => { PUSH_LOG.length = 0; FLUSH = 0; } };
  `;
  return new Function(src)();
}
const sb = makeSandbox();
ok(sb.pushIsOutStatus('✅ 已送达') === true, '✅ 已送达 = 已外发');
ok(sb.pushIsOutStatus('⚠️ 送达结果未知(私密)') === true, '⚠️ 送达结果未知 = 已外发（超时那条多半真送到了，不重推）');
ok(sb.pushIsOutStatus('✅ 计算完成(dry 未发送)') === false, '✅…未发送 ≠ 已外发（试算没发过，不许拿去闭锁）');
ok(sb.pushIsOutStatus('模块日上限拦截') === false, '拦截类 ≠ 已外发');
ok(sb.pushIsOutStatus('🚫 条数闸门') === false, '条数闸门 ≠ 已外发');
ok(sb.pushIsOutStatus('副本拦截(不外发)') === false, '副本拦截 ≠ 已外发');
ok(sb.pushIsOutStatus('') === false && sb.pushIsOutStatus(null) === false, '空状态 ≠ 已外发（判不出就是没发过）');
// ⛔ 同一语义不许两处各写一份：pushedToday 与 pushLog 必须都调用同一个函数
ok(/pushIsOutStatus\(/.test(PTD), 'pushedToday 走 pushIsOutStatus（与 pushLog 同一把尺子，不许分叉）');
// ⛔ pushLog 刻意**不**改成调用 pushIsOutStatus（十几个守门套件把它的函数体抠出来真跑，
//   加新符号会让沙箱静默失效）。两把尺子不能各说各话 —— 这里用真跑证明二者判据等价：
(function equiv() {
  const _cases = ['✅ 已送达', '⚠️ 送达结果未知(私密)', '✅ 计算完成(dry 未发送)', '模块日上限拦截',
    '🚫 条数闸门', '副本拦截(不外发)', '❌ 发送失败', '夜间静默拦截', '未配置通道'];
  let same = 0, diff = [];
  for (const st of _cases) {
    sb.reset();
    sb.pushLog(st, '标题', {});
    const flushNow = sb.flushCount() === 1;         // pushLog 里"送达即落盘"的分支
    if (flushNow === sb.pushIsOutStatus(st)) same++; else diff.push(st);
  }
  ok(same === _cases.length, '⛔ pushLog 的内联判据与 pushIsOutStatus 真跑等价（沙箱兼容，但绝不许两把尺子分叉）',
    diff.join(' | '));
})();
ok(!/_isOut\s*=/.test(SVK), '旧的局部 _isOut 已删除（两把尺子的分叉点清除）');

// ───────────────────────────────────────────────────────────────────
group('[2] 噪音合并：同一句拦截一天只占一条（299 条 → 1 条）');
sb.reset();
for (let i = 0; i < 300; i++) sb.pushLog('模块日上限拦截', '大单流入', { note: '本模块当日条数已达上限' });
ok(sb.PUSH_LOG.length === 300, '压实前：同一句拦截 300 次各占一格（这正是证据池被灌满的形态）');
sb.compactPushLog();
ok(sb.PUSH_LOG.length === 1, '压完只占 1 条流水（299 条噪音 → 1 条）', '实际 ' + sb.PUSH_LOG.length + ' 条');
ok(Number(sb.PUSH_LOG[0].n) === 300, '次数没丢：n 累加到 300（只是不再各占一格）', 'n=' + sb.PUSH_LOG[0].n);
ok(!!sb.PUSH_LOG[0].last, '合并记录带 last（最后一次发生的时刻可见）');
// ⛔ ts 必须保持首次发生时刻：pushLogCoversToday 靠「最老一条属于哪天」判证据是否覆盖今天，
//    把 ts 改写成最新时刻会让最老那格凭空变成"今天"，判据当场失真。
const _firstTs = sb.PUSH_LOG[0].ts;
sb.pushLog('模块日上限拦截', '大单流入', {});
sb.compactPushLog();
ok(Number(sb.PUSH_LOG[0].n) === 301, '第 301 次继续累加', 'n=' + sb.PUSH_LOG[0].n);
ok(sb.PUSH_LOG[0].ts === _firstTs, '⛔ 合并只记 last，ts 保持首次发生时刻（数组仍是时间倒序，覆盖判据不失真）');
// 跨天：同一句拦截在昨天和今天各占一条（不能把昨天的次数算到今天头上）
//   ⚠️ 用真实 ts 构造：沙箱的 DAY 只影响"判今天"，改不了记录自己的日期键
sb.reset();
const _mkN = (ts, status, title) => ({ ts, status, title, time: '' });
sb.PUSH_LOG.push(_mkN(Date.now(), '模块日上限拦截', '大单流入'));
sb.PUSH_LOG.push(_mkN(Date.now() - 86400000, '模块日上限拦截', '大单流入'));
sb.compactPushLog();
ok(sb.PUSH_LOG.length === 2, '跨天各占一条（不把昨天的次数算到今天）', '实际 ' + sb.PUSH_LOG.length);
ok(Number(sb.PUSH_LOG[0].n || 1) === 1 && Number(sb.PUSH_LOG[1].n || 1) === 1, '两天的次数各自从 1 计');
// 换标题：不同模块各占一条
sb.reset();
sb.PUSH_LOG.push(_mkN(Date.now(), '模块日上限拦截', '大单流入'));
sb.PUSH_LOG.push(_mkN(Date.now(), '模块日上限拦截', '相似走势跟随'));
sb.compactPushLog();
ok(sb.PUSH_LOG.length === 2, '不同模块的拦截各占一条（合并键含 title）');
// ⛔ 送达类绝不合并：每条都是一次真实发送事件
sb.reset();
sb.pushLog('✅ 已送达(私密)', '🔥 竞价异动 · 连板梯队扫描', {});
sb.pushLog('✅ 已送达(私密)', '🔥 竞价异动 · 连板梯队扫描', {});
sb.compactPushLog();
ok(sb.PUSH_LOG.length === 2, '⛔ 送达记录绝不合并（每条都是真实发送事件）', '实际 ' + sb.PUSH_LOG.length);
ok(sb.flushCount() === 2, '⛔ 送达即落盘没有被压实逻辑吃掉（送达证据优先写盘）', 'flush=' + sb.flushCount());

// ───────────────────────────────────────────────────────────────────
group('[3] 送达证据不再被噪音挤出证据池（旧 pushLog 盲裁是重复推送的物理根因）');
sb.reset();
sb.setCap(500);
const _now = Date.now();
// ⛔ 跨午夜时段跑（0:00–0:15）时，_now-900s 会落到昨天，DAY(真实今天) 与送达批次的
//    日期键一错位，pushedToday 必查不到 → 时钟拖红（§11 同款，11-02 0:06 实红 1 条）。
//    修法同 §11：不冻结写死的日期串，而是把沙箱 DAY 钉到送达批次**自己**的日期键
//    （语义不变：判的仍是「这批送达算不算今天」），setDay 本就是预留的覆盖入口。
const _dk = (ts) => { const d = new Date(ts);
  return '' + d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0'); };
sb.setDay(_dk(_now - 900 * 1000));
// 线上被灌满时的真实形态：**最老那一批是早上的真送达**，之后被 60 秒一轮的拦截一路推到末尾
for (let i = 0; i < 60; i++) sb.PUSH_LOG.push({ ts: _now - (900 - i) * 1000, status: '✅ 已送达(私密)', title: '🔥 竞价异动 ' + i, time: '' });
for (let i = 0; i < 460; i++) sb.PUSH_LOG.unshift({ ts: _now - i * 1000, status: '模块日上限拦截', title: '噪音' + (i % 4), time: '' });
ok(sb.PUSH_LOG.length === 520, '构造：520 条（60 条送达在最老处 + 460 条拦截噪音）');
sb.compactPushLog();
const _s2 = sb.PUSH_LOG.filter(r => sb.pushIsOutStatus(r.status));
ok(_s2.length === 60, '⛔ 压实后 60 条送达一条没丢（噪音全并进 4 条）', '送达剩 ' + _s2.length);
ok(sb.PUSH_LOG.length <= 100, '流水从 520 条压到 ' + sb.PUSH_LOG.length + ' 条 —— 远离 500 上限，pushLog 的盲裁根本不会触发');
ok(sb.pushedToday(/竞价异动/) === true, '⛔ 压完之后 pushedToday 查得到「今天已发过」（防重复判据有证据可吃）');
// 反证：旧写法（没有压实，超容直接 length=cap）会把早上的送达整批挤没
(function falsify() {
  const LOG = [];
  const cap = 500;
  const pushOld = (ts, status, title) => { LOG.unshift({ ts, status, title }); if (LOG.length > cap) LOG.length = cap; };
  for (let i = 0; i < 60; i++) pushOld(_now - (900 - i) * 1000, '✅ 已送达', '🔥 竞价异动 ' + i);
  for (let i = 0; i < 520; i++) pushOld(_now - i * 1000, '模块日上限拦截', '噪音' + (i % 4));   // 灌到把最老那批全挤出去
  const left = LOG.filter(r => r.status.indexOf('✅') === 0);
  ok(left.length === 0, '反证：旧写法（无压实 + 盲裁）确实会把早上那批送达整批挤没 → 重复推送', '旧写法剩 ' + left.length);
})();

// ───────────────────────────────────────────────────────────────────
group('[4] /api/push-log 看得见：早上的竞价到底发没发，接口必须答得上来');
const iApi = SVK.indexOf("p === '/api/push-log'");
ok(iApi > 0, '推送流水接口存在');
const API_BLK = SVK.slice(iApi, SVK.indexOf('\n  }', iApi) + 4);
ok(!/log: PUSH_LOG\.slice\(0, 30\)/.test(API_BLK), '⛔ 不再只返最新 30 条（30 条窗口半小时就被噪音铺满，早上的记录永远翻不到）');
ok(/sentToday/.test(API_BLK), '直接返回 sentToday（今天真送达条数，一眼回答「到底发了没有」）');
ok(/_only === 'sent'/.test(API_BLK), '支持 ?only=sent 只看已送达');
ok(/Math\.min\(500/.test(API_BLK), '?n= 可调且封顶 500（不会把整份流水 dump 出去）');
ok(/n=200/.test(IH), '前端默认取 200 条（面板「推送流水」翻得到早上的记录）');
ok(/_pushLogSentOnly/.test(IH) && /只看已送达/.test(IH), '面板有「只看已送达」一键过滤（噪音不再挡住要找的那条）');
ok(/sentToday/.test(IH), '面板显示「今日已送达 N 条」');

// ───────────────────────────────────────────────────────────────────
group('[5] 大单推送改实时：类别级间隔闸取消（压类别 = 新票憋到下一班）');
const iBM = SVK.indexOf('async function scanBigMoneyPush()');
ok(iBM > 0, 'scanBigMoneyPush 存在');
const BM_BLK = SVK.slice(iBM, SVK.indexOf('\nfunction typeHist', iBM));
ok(/BIGMONEY_GAP_HOT = 0/.test(SV) && /BIGMONEY_GAP_NORMAL = 0/.test(SV),
  '⛔ 类别级间隔闸（涨停候选 5 分钟 / 普通 15 分钟一条）已取消');
ok(/BIGMONEY_SCAN_MS = 30 \* 1000/.test(SV), '扫描周期 60s → 30s（实时性翻倍；不再往下压以免把自己打限流）');
ok(/BIGMONEY_CARD_PER_ROUND - freshHot\.length/.test(BM_BLK),
  '⛔ 每轮张数有上限（改实时后不限张数 = 开盘几分钟打光当日额度，比不实时更糟）');
ok(/aged\(x, 15\)/.test(BM_BLK) && /aged\(x, 30\)/.test(BM_BLK),
  '防刷屏改由【单票冷却】承担（hot 15 分钟 / normal 30 分钟同股去重）');
ok(/modDayTake\('bigmoney'\)/.test(BM_BLK), '模块日额度仍在（每票一张卡，一票一额度）');
ok(!/if \(!modDayTake\('bigmoney'\)\) \{[\s\S]{0,200}?return;/.test(BM_BLK),
  '⛔ 批级日额度判定已下移到每张卡（否则一轮 2 张卡扣 3 次额度）');

// ───────────────────────────────────────────────────────────────────
group('[6] 每支票一个卡片：不再把 4~6 只票塞进同一条消息');
ok(/const _cardOf = \(x, kind\) =>/.test(BM_BLK), '单票卡片构造函数 _cardOf 存在');
ok(/for \(let _i = 0; _i < fresh\.length; _i\+\+\)/.test(BM_BLK), '逐票循环发送（一张卡一只票）');
ok(/pushAll\(_cardOf\(x, _kind\)/.test(BM_BLK), '每张卡单独 pushAll（标题即股票名，流水里一眼可查）');
ok(!/freshHot\.map\(line\)\.join/.test(BM_BLK), '⛔ 旧的「多票拼一条长消息」写法已删除');
ok(!/A\/B对照/.test(BM_BLK), '旧的 A/B 对照长标题块已删除');
const iCard = BM_BLK.indexOf('const _cardOf');
const CARD_RET = BM_BLK.slice(BM_BLK.indexOf('return `💰', iCard), BM_BLK.indexOf('🕒 ${time}', iCard) + 40);
ok(/💰 大单流入 · \$\{x\.name\}\(\$\{x\.code\}\)/.test(BM_BLK), '卡片第一行就是股票名+代码（推送流水标题即可定位是哪只票）');
const _lines = (CARD_RET.match(/\\n/g) || []).length + 1;
ok(_lines >= 3 && _lines <= 7, '卡片正文 3~7 行（精简：只留决策必需字段）', '实际 ' + _lines + ' 行');
ok(/现价 \$\{x\.price\}/.test(BM_BLK) && /距涨停/.test(BM_BLK), '核心三件套在卡上：现价 / 涨跌 / 距涨停');
ok(/_prob/.test(BM_BLK) && /money\(x\)/.test(BM_BLK), '资金与概率在卡上（主力净占比·净额 + 概率）');
ok(/🏷 板块/.test(BM_BLK), '板块单独一行（带冷热标签）');
ok(!/balance\(x\)/.test(CARD_RET), '⛔ 四级买卖对比不再进卡片（细账留给面板，卡片只留结论）');
ok(!/fuseLine\(x\)/.test(CARD_RET), '⛔ 融合胜率脚注不再进卡片（每票挂一段 = 又变成长消息）');
ok(/_i === fresh\.length - 1/.test(BM_BLK), '历史战绩/今日脚注只在最后一张卡带一次');

// ───────────────────────────────────────────────────────────────────
group('[7] 精致：飞书是纯文本通道，<b> 标签不许飞到手机上');
ok(/function stripHtmlTags\(s\)/.test(SV), 'stripHtmlTags 已定义');
const _nFs = (SVK.match(/msg_type: 'text'/g) || []).length;
ok(_nFs >= 2, '飞书两处发送口（群机器人 / 私密探针）都在', _nFs + ' 处');
ok((SVK.match(/text: stripHtmlTags\(/g) || []).length === _nFs,
  '⛔ 两处飞书 text 载荷全部过 stripHtmlTags（不支持 HTML，裸 <b> 会原样显示）',
  '已接 ' + (SVK.match(/text: stripHtmlTags\(/g) || []).length + '/' + _nFs);
const _sht = new Function(SHT + '\nreturn stripHtmlTags;')();
ok(_sht('概率 <b>68%</b>') === '概率 68%', '剥标签保留文字（<b>68%</b> → 68%）', _sht('概率 <b>68%</b>'));
ok(_sht('涨幅 <3% 且 >0%') === '涨幅 <3% 且 >0%', '⛔ 不误伤正常文本（没有闭合 > 的不当标签）', _sht('涨幅 <3% 且 >0%'));
ok(_sht(null) === '' && _sht(undefined) === '', '空值返回空串（不抛错）');

console.log('\n推送根治守门：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
