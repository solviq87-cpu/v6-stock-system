// 守门测试：2026-10-06 逻辑体检修掉的 6 类问题（防回归）
//   ① 上市满 30 日过滤不能再用 'YYYYMMDD' 整数减法（跨月失效）
//   ② 八字硬闸门的"退路"不能绕过闸门本身
//   ③ guard() 必须吞异常；调用点必须 await 重任务
//   ④ 每日新闻必须"先发后标记"
//   ⑤ 关键 JSON 必须原子写（.tmp + rename），解析失败要留档而不是静默重建
//   ⑥ 节假日表过期要告警
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
};

const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const LEA = fs.readFileSync(path.join(__dirname, 'learnall.js'), 'utf8');
const ZTP = fs.readFileSync(path.join(__dirname, 'ztpre.js'), 'utf8');
const HLD = fs.readFileSync(path.join(__dirname, 'holdings.js'), 'utf8');

// 去掉注释再匹配，避免把注释里引用的反例当成正例
const strip = s => s.split('\n').map(l => {
  const i = l.indexOf('//');
  return i >= 0 ? l.slice(0, i) : l;
}).join('\n');
const S = strip(SRC);

console.log('\n【① 上市满 30 日过滤】');
ok('不再有 todayStr() - N 这种整数减法', !/todayStr\(\)\s*-\s*\d/.test(S));
ok('新增 listedDaysAgo 判定函数', /function listedDaysAgo/.test(SRC));
ok('精选池用 listedDaysAgo 过滤', /listedDaysAgo\(s\.listedDate\)/.test(S));
ok('auctionBlocked 复用同一口径（不再内联日期运算）',
  /const ago = listedDaysAgo\(s\.listedDate\);/.test(S));
{
  // listedDaysAgo 必须是真·日期差：拿今天和一个跨月的上市日验证
  const m = SRC.match(/function listedDaysAgo\(ld\)[\s\S]*?\n}/);
  ok('listedDaysAgo 可提取', !!m);
  if (m) {
    const fn = new Function('return ' + m[0])();
    const now = new Date();
    const d = (n) => {
      const x = new Date(now.getTime() - n * 86400000);
      return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}`;
    };
    ok('上市 100 天 → 约 100', Math.abs(fn(d(100)) - 100) < 1.1, String(fn(d(100))));
    ok('上市 10 天 → 约 10（旧写法会误判为"满 30 日"）', Math.abs(fn(d(10)) - 10) < 1.1, String(fn(d(10))));
    ok('缺上市日期 → null（放行）', fn(0) === null && fn(undefined) === null);
    // 关键回归点：跨月场景。构造"上个月的今天"前后各一天
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    const pm = `${prevMonth.getFullYear()}${String(prevMonth.getMonth() + 1).padStart(2, '0')}${String(prevMonth.getDate()).padStart(2, '0')}`;
    const days = fn(pm);
    ok('跨月上市日算出的天数落在 27~32（旧整数减法会得负数/离谱值）',
      days > 27 && days < 32, String(days));
  }
}

console.log('\n【② 八字硬闸门】');
{
  const block = SRC.match(/const baziBlocked = c =>[\s\S]*?const baziKicked/);
  ok('闸门块存在', !!block);
  if (block) {
    const b = block[0];
    ok('退路不再是 scored.slice(0, 20) 直接兜底', !/picked = scored\.slice\(0, 20\)\s*;/.test(b));
    ok('退路也要过 baziBlocked', /scored\.filter\(c => !baziBlocked\(c\)/.test(b));
    // ⛔ 2026-10-06 补：判不出八字的票同样不能走退路（见 _test_gate_unknown.js）
    ok('退路也要排除 baziUnknown（判不出来 ≠ 判了通过）', /scored\.filter\(c => !baziBlocked\(c\) && !baziUnknown\(c\)\)/.test(b));
    ok('一只都不剩时宁可空池（宁缺勿滥）', /picked = \[\]/.test(b));
  }
  // 语义验证：模拟"全被否决"场景
  const mk = (stage) => ({ code: 'X', score: 90, bazi: { stage } });
  const baziBlocked = c => !!(c.bazi && (c.bazi.stage === '高位加速' || c.bazi.stage === '破位整理'));
  const scored = [mk('高位加速'), mk('破位整理'), mk('低位启动')];
  let picked = scored.filter(c => !baziBlocked(c));
  if (!picked.length) picked = scored.filter(c => !baziBlocked(c)).slice(0, 20);
  ok('退路不会把"高位加速"放回池子', !picked.some(c => c.bazi.stage === '高位加速'));
  ok('退路仍能留下"低位启动"', picked.length === 1 && picked[0].bazi.stage === '低位启动');
}

console.log('\n【③ guard 防重入】');
{
  const g = SRC.match(/function guard\(name, fn\)[\s\S]*?\n}/);
  ok('guard 可提取', !!g);
  if (g) {
    ok('guard 内有 catch（不再抛 unhandledRejection）', /catch \(e\) \{ console\.error\(`\[guard:\$\{name\}\]`/.test(g[0]));
    ok('guard 保留 finally 释放锁', /finally \{ _taskBusy\.delete\(name\); \}/.test(g[0]));
  }
  // 只有【async 函数】才需要 await：computeBreadth 这类同步函数放进来会误报。
  // 从源码里抽出所有 async 函数名，再逐个检查它们在 guard 回调里有没有被 await。
  const asyncFns = [...SRC.matchAll(/async function ([A-Za-z_$][\w$]*)/g)].map(m => m[1]);
  ok('源码里能抽出 async 函数清单（用于判定）', asyncFns.length > 5, String(asyncFns.length));
  const heavyRe = new RegExp('\\b(' + asyncFns.join('|') + ')\\s*\\(');
  const calls = [...SRC.matchAll(/guard\('([a-zA-Z0-9_-]+)',\s*async \(\) => \{([^]*?)\}\)/g)];
  let noAwait = [];
  for (const c of calls) {
    const body = c[2];
    const heavy = heavyRe;
    if (heavy.test(body)) {
      // 这些重任务前必须有 await
      const lines = body.split('\n');
      for (const l of lines) {
        const mm = l.match(heavy);
        if (mm && !/await\s+$/.test(l.slice(0, mm.index)) && !l.includes('await ' + mm[1])) {
          noAwait.push(c[1] + ': ' + mm[1]);
        }
      }
    }
  }
  ok('所有 guard 内的重任务都 await 了（缺 await = 守卫当场失效）',
    noAwait.length === 0, noAwait.join(', '));
}

console.log('\n【④ 每日新闻先发后标记】');
{
  const m = SRC.match(/if \(d\.getDay\(\) !== 0[\s\S]{0,900}?digestSentDate = ds;/);
  ok('每日汇总块可定位', !!m);
  if (m) {
    const seg = m[0];
    const iPush = seg.indexOf('pushWecom(buildNewsDigest');
    const iMark = seg.indexOf('digestSentDate = ds');
    ok('pushWecom 在 digestSentDate 标记之前', iPush >= 0 && iMark > iPush,
      `push@${iPush} mark@${iMark}`);
    ok('整体包在 try 里（失败保留重试机会）', /try \{[\s\S]*pushWecom\(buildNewsDigest/.test(seg));
  }
}

console.log('\n【⑤ 原子写 + 坏文件留档】');
ok('server.js 定义 atomicWrite', /function atomicWrite\(file, text\)/.test(SRC));
ok('server.js 定义 readJsonSafe', /function readJsonSafe\(file, tag\)/.test(SRC));
ok('atomicWrite 用 rename 原子替换', /fs\.renameSync\(tmp, file\)/.test(SRC));
ok('readJsonSafe 解析失败时留档 .corrupt-', /\.corrupt-/.test(SRC));
ok('stats.json 走原子写', /const saveLearn = \(\) =>[\s\S]{0,80}atomicWrite\(STAT_FILE/.test(SRC));
ok('pushlog.json 走原子写', /function pushLogFlush\(\) \{\s*atomicWrite\(PUSH_LOG_FILE/.test(SRC));
ok('review.json 走原子写', /atomicWrite\(path\.join\(__dirname, 'review\.json'\)/.test(SRC));
ok('news.json 走原子写', /atomicWrite\(NEWS_FILE,/.test(SRC));
ok('access.json 零裸写', !/fs\.writeFileSync\(ACCESS_FILE/.test(SRC));
ok('config.json 走原子写', /const saveCfg = \(\) =>[\s\S]{0,80}atomicWrite\(CFG_FILE/.test(SRC));
ok('learnall.js 原子写', /function atomicWrite\(file, text\)/.test(LEA) && /fs\.renameSync\(tmp, file\)/.test(LEA));
ok('learnall.js 解析失败留档（不再静默 freshDb）', /\.corrupt-/.test(LEA));
ok('ztpre.js 原子写', /fs\.renameSync\(tmp, DB_FILE\)/.test(ZTP));
ok('ztpre.js 解析失败留档', /\.corrupt-/.test(ZTP));
ok('holdings.js 原子写', /fs\.renameSync\(tmp, HOLD_FILE\)/.test(HLD));
ok('holdings.js 坏文件留档（避免"持仓又没有了"）', /HOLD_FILE \+ '\.corrupt-'/.test(HLD));
ok('holdings.js 审计流水原子写', /fs\.renameSync\(tmp, OPS_FILE\)/.test(HLD));

console.log('\n【⑥ 节假日表过期告警】');
ok('节假日表含 2027 年条目', /'2027-01-01'/.test(SRC));
ok('有 HOLIDAY_MAX_YEAR 探测', /const HOLIDAY_MAX_YEAR/.test(SRC));
ok('isTradeDay 里挂了告警', /function isTradeDay\(d\) \{\s*holidayTableWarn\(\);/.test(SRC));
{
  const m = SRC.match(/function holidayTableWarn\(\)[\s\S]*?\n}/);
  ok('holidayTableWarn 可提取', !!m);
  if (m) {
    ok('表覆盖到位时不告警', /if \(HOLIDAY_MAX_YEAR >= y\) return;/.test(m[0]));
    ok('告警按天节流（不刷屏）', /_holidayWarnDay/.test(m[0]));
  }
}

console.log('\n【⑦ 内存清扫】');
ok('goodPushed 内存 Set 跟着裁剪', /if \(S\.news\.goodPushed\.size > 600\) S\.news\.goodPushed = new Set/.test(SRC));
ok('inflowHistory 有逐出', /S\.inflowHistory\.delete\(code\)/.test(SRC));
ok('当日去重表跨日清空', /S\.lastPush, S\.pushCount, S\.trendState, S\.fastinRepeat/.test(SRC));
ok('跨日清空有日志可查', /\[sweep\] 跨日清空当日去重表/.test(SRC));

console.log('\n【⑧ 复盘并发守卫】');
ok('computeReview 内部有 _crBusy', /let _crBusy = false;/.test(SRC));
ok('并发时跳过而非重复写 review.json', /上一轮复盘仍在跑，本轮跳过/.test(SRC));
ok('守卫在 finally 释放', /finally \{ _crBusy = false; \}/.test(SRC));


// ============ ⑨ 安全与文案（2026-10-06 第四轮） ============
console.log('\n【⑨ 安全：本机判定不得信任请求头】');
{
  const fn = SRC.match(/function isLocalReq\(req\)[\s\S]*?\n}/);
  ok('isLocalReq 可提取', !!fn);
  if (fn) {
    const b = fn[0];
    ok('不再调用 clientIp()（客户端可控头）', !/clientIp\(req\)/.test(b));
    ok('只看 socket.remoteAddress', /req\.socket && req\.socket\.remoteAddress/.test(b));
    ok('不再依赖 behindProxy()', !/behindProxy\(req\)/.test(b));
    ok('保留 Host 校验（防 DNS 重绑定）', /headers\.host/.test(b));
  }
}

console.log('\n【⑩ 凭据不落源码】');
ok('源码里没有硬编码的完整手机号', !/17\d{9}/.test(SRC));
ok('手机号改由环境变量/config 取', /const boundPhoneOf = \(\) =>/.test(SRC));
// ⛔ 2026-10-28 改钉：登录授权码现在带 { private: true, mustDeliver: true }
//    （mustDeliver 是 10-28 定的「私密不通才允许退回」白名单，只给验证码/授权码这类过时就废的用），
//    原来钉死 `{ private: true }` 精确收尾会假红。
ok('登录授权码推送带 private 标志', /登录授权码[\s\S]{0,200}?\{[^}]*private: true[^}]*\}/.test(SRC));
ok('凭证类消息纳入免配额', /MSG_FREE_RE = [^\n]*登录授权码/.test(SRC));

console.log('\n【⑪ 日上限必须在占配额之前】');
{
  // 埋伏：modDayTake 应在 govTake/S.prePushed/logSignal 之前
  const pre = SRC.match(/if \(!modDayTake\('pre'\)\)[\s\S]{0,600}?for \(const x of top\)/);
  ok('埋伏模块日上限已前置', !!pre && !/govTake[\s\S]{0,400}?modDayTake\('pre'\)/.test(pre[0]));
  const sim = SRC.match(/if \(!modDayTake\('similar'\)\)[\s\S]{0,400}?govFilter\('similar'/);
  ok('相似模块日上限已前置', !!sim);
  ok('日上限拦截有留痕（可排查为什么没推）', /模块日上限拦截/.test(SRC));
  // 大单：间隔闸应在 govFilter 之前
  // ⛔ iq 轮：原判据用 `[\s\S]{0,200}?` 把 _gapHot 定义与 freshHotA 锁在 200 字符内，
  //   中间加两行注释就顶穿（语义是"闸门包住 govFilter"，不是"两行离得近"）→ 改索引比序。
  ok('大单间隔闸已前置到 govFilter 之前',
    /const freshHotA = _gapHot \? govFilter/.test(SRC)
    && /const freshHotB = _gapHot \? govFilter/.test(SRC)
    // hw 轮：普通组多了「本轮剩余名额」条件（每轮最多 BIGMONEY_CARD_PER_ROUND 张卡），
    //   判据仍是「间隔闸 + 名额闸 都在 govFilter 之前」，只是表达式多了个 _slots。
    && /const freshNormal = \(_slots > 0 && _gapNormal\) \? govFilter/.test(SRC)
    && SRC.indexOf('const _gapHot =') < SRC.indexOf('const freshHotA = _gapHot'));
  // 反向：不能再有"先 govFilter、后 freshHot.length = 0"的旧顺序
  ok('大单不再先占配额再清空（旧顺序已移除）', !/freshHot\.length = 0/.test(SRC));
}

console.log('\n【⑫ 文案不得出现 null/NaN】');
ok('八字四维度缺数据打 —（不再打 null）', /const _dim = v => \(v == null \? '—' : v\)/.test(SRC));
ok('八字 dd60 为 null 时打 —', /dd60 == null \? '—' : dd60/.test(require('fs').readFileSync(path.join(__dirname, 'bazi.js'), 'utf8')));
ok('turnover 主源已兜底（防复盘整份报废）',
  /turnover: \+d\.hs \|\| 0/.test(require('fs').readFileSync(path.join(__dirname, 'em.js'), 'utf8')));
ok('复盘取值也兜底', /turnover: \+\(Number\(z\.turnover\) \|\| 0\)\.toFixed\(1\)/.test(SRC));

console.log('\n【⑬ 配置白名单与实际读取对齐】');
// ⛔ 2026-10-06 改：白名单已经从「接口里那段数组字面量」升级成取值域表 CFG_RANGE
//    （/api/config 现在由 Object.keys(CFG_RANGE) 驱动，加键 = 加校验），
//    所以这里不能再拿旧的字面量文本去匹配 —— 那会永远红。改成钉 CFG_RANGE 的覆盖。
//    详细的上界/量纲/空串校验由 _test_cfg_range.js 钉死，这里只管"这几个键没被落下"。
const _rg = /const CFG_RANGE = \{([\s\S]*?)\n\};/.exec(SRC);
const _rangeKeys = _rg ? [..._rg[1].matchAll(/^\s{2}(\w+):\s*\{/gm)].map(m => m[1]) : [];
ok('取到 CFG_RANGE 的键清单', _rangeKeys.length >= 10, '实际 ' + _rangeKeys.length);
ok('pushMinProbPre 在取值域表里（注释说设0=不限，以前改不了）', _rangeKeys.includes('pushMinProbPre'));
ok('simGate 在取值域表里（bigMoneyProbGate 已随 iq 轮大单精准化退役，表里不许再有）',
  _rangeKeys.includes('simGate') && !_rangeKeys.includes('bigMoneyProbGate'));
ok('写入端由 CFG_RANGE 驱动（新增可调键必然带取值域）',
  /for \(const k of Object\.keys\(CFG_RANGE\)\)/.test(SRC));
ok('判"没提交"用 != null 语义而非 ||（0 是合法值，不能被吃掉）',
  /c\[k\] !== undefined && c\[k\] !== null/.test(SRC) && /S\.config\[k\] = Number\(_cfgIn\[k\]\)/.test(SRC));

console.log('\n【⑭ /api/refresh 必须接防重入锁（2026-10-06）】');
// 这条接口是面板点🔄的入口，以前是裸调用、完全绕开 guard()：
//   定时器那路有锁，手动刷新那路没有 → 同一重任务并发跑两遍；
//   paperCheckAll 并发还会让模拟盘重复下单，持仓/成交记录直接错乱。
const _rf = SRC.slice(SRC.indexOf("p === '/api/refresh'"), SRC.indexOf("p === '/api/paper'"));
ok('refresh 接口里有 _g 包装器', /const _g = \(name, fn\) =>/.test(_rf), '没找到 _g 定义');
ok('_g 会检查 _taskBusy 并记录跳过', /_taskBusy\.has\(name\)/.test(_rf) && /_skipped\.push/.test(_rf));
for (const m of ['global', 'auction', 'sectors', 'pre', 'nextplan', 'myrules', 'news', 'pool', 'paper', 'holdings', 'bigmoney']) {
  ok(`模块 ${m} 走 _g 防重入`, new RegExp("_g\\('" + m + "',").test(_rf), `模块 ${m} 仍是裸调用`);
}
ok('被跳过的模块会如实回给前端（点了没反应要能看见原因）', /skipped: _skipped/.test(_rf));

// 【⑮ "设 0 = 完全不限"必须真的生效：配置项读取不许用 || 吃掉合法的 0】
// 根因：/api/config 的写入端早就允许 0（注释明写"0 是合法值，被 || 吃掉就永远关不掉"），
//   但**读取**端这 14 处仍是 `+(S.config.X || 默认)` —— 用户在面板把门槛设成 0 想关掉过滤，
//   存进去了，读出来却是默认值，等于设置项静默失效（不报错、不提示，最难查的一类）。
//   正确写法是 _govCfg(k, 默认)，它用 `Number.isFinite(n) && n >= 0` 判断，0 能正常通过。
console.log('\n⑮ 配置项「设 0 = 完全不限」必须真的生效（不许用 || 吃掉 0）');
const ZERO_OK_KEYS = ['pushMaxPerDay', 'pushMinProb', 'pushMaxPerCode', 'pushCooldownMin',
  'pushDailyMsgs', 'pushMinProbPre', 'simGate', 'bigMoneyPct', 'activePctThreshold'];
let badOr = [];
for (const k of ZERO_OK_KEYS) {
  // 形如 S.config.k || 数字  /  +(S.config.k || 数字)
  if (new RegExp('S\\.config\\.' + k + '\\s*\\|\\|').test(SRC)) badOr.push(k);
}
ok('这 9 个键都不再用 || 读取（' + (badOr.length ? badOr.join(',') : '干净') + '）', badOr.length === 0);
ok('全部改走 _govCfg', ZERO_OK_KEYS.every(k => SRC.includes("_govCfg('" + k + "'")));
// ⛔ dg 轮改判据：实现从 `(k, def)` 收成 `(k)`（默认值进 CFG_RANGE.def），
//    这里钉的是**语义**（0 能通过 / 默认值来自表 / 越界兜住），不是某一种写法。
ok('_govCfg 的默认值来自 CFG_RANGE.def（不再由调用点传）',
  /const _govCfg = k => \{/.test(SRC) && !/const _govCfg = \(k, def\)/.test(SRC) && /d\.def/.test(SRC));
{
  // 行为验证：把 _govCfg 的实现抠出来单跑，确认 0 / 0.0 / 缺省 / 负数 / NaN 各自的处理
  const m = SRC.match(/const _govCfg = k => \{([\s\S]*?)\};/);
  const rs = SRC.match(/const CFG_RANGE = \{([\s\S]*?)\};/);
  let g = null;
  if (m && rs) {
    const S = { config: { A: 0, B: 30, N: -5, X: 'abc' } };
    g = eval('(function(S){ const CFG_RANGE = {' + rs[1] + '}; const _govCfg = k => {' + m[1] + '}; return _govCfg; })')(S);
  }
  ok('_govCfg 能抠出来跑', !!g);
  if (g) {
    // A/B/N/X 都不在 CFG_RANGE 里，走的是「未登记的键：沿用旧行为」那一支
    ok('_govCfg(设成 0) 返回 0 而不是默认值', g('A') === 0, '实际 ' + g('A'));
    ok('_govCfg(设成 30) 返回 30', g('B') === 30);
    ok('_govCfg(负数) 回退默认值', g('N') === 0);
    ok('_govCfg(非数字) 回退默认值', g('X') === 0);
    ok('_govCfg(没配过) 回退默认值', g('ZZZ') === 0);
    // 登记在表里的键：默认值必须来自 CFG_RANGE.def，且越界要兜住（dg 轮新加的一半）
    ok('登记键没配过 → 返回表里的 52', g('pushMinProb') === 52, '实际 ' + g('pushMinProb'));
    const g2 = eval('(function(S){ const CFG_RANGE = {' + rs[1] + '}; const _govCfg = k => {' + m[1] + '}; return _govCfg; })')({ config: { pushMinProb: 200 } });
    ok('登记键越界（200）→ 兜回表里的 52 而不是原样放行', g2('pushMinProb') === 52, '实际 ' + g2('pushMinProb'));
  }
}

console.log(`\n──────────────────────────────`);
console.log(`  ${pass} 通过 / ${fail} 失败`);
console.log(`──────────────────────────────\n`);
process.exit(fail ? 1 : 0);
