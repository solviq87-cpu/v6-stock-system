// 🔧 2026-09-30 用户三连问修复验证（_test_fix0930.js）
//   ①「今日上涨的为啥没推送 / 涨停那么多没推送」
//      → 根因：每日复盘（含当日涨停全貌）明明 15:41 算完，推送窗口却写死 15:30~15:40，
//        算完时已出窗口，且 15:40 后每轮把重试计数清零并 return → 当天复盘永远发不出去。
//   ②「你学个啥」 → 没有任何推送流水可供追溯（PUSH_LOG 纯内存，重启即焚）。
//   ③「改一次版本就要重新登录」 → 发布覆盖 access.json 致 machineKey 变 + 例行 change
//        重设同一密码却清空 devices → 当天发 6 版 = 重登 6 次。
const fs = require('fs');

let pass = 0, fail = 0;
function ok(c, n, x) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? '  → ' + x : '')); } }
function sec(t) { console.log('\n' + t); }

const readFile = p => fs.readFileSync(p, 'utf8');
const readVF = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const SV = readVF('server.js');
const IDX = readVF('public/index.html');
const PUB = readVF('_publish.py');

const appVerIn = f => (SV.match(/const APP_VER = '([^']+)'/) || [])[1] ||
  ((f === IDX) ? (IDX.match(/const APP_VER = '([^']+)'/) || [])[1] : null);

// ═══════════ ① 复盘推送：窗口不再把"算完的复盘"挡在门外 ═══════════
sec('① 收盘复盘推送窗口（不再错过 15:41 才算出的数据）');
{
  // 旧写法特征：窗口右侧 t < 15*60+40 且 15:40 后清零重试计数
  const oldWindow = /t >= 15 \* 60 \+ 30 && t < 15 \* 60 \+ 40/.test(SV);
  ok(!oldWindow, '已移除写死的 15:30~15:40 十分钟窗口',
    oldWindow ? '仍存在 → 复盘算完晚于 15:40 就永远发不出' : '');
  const oldReset = /if \(t >= 15 \* 60 \+ 40\) reviewTries = 0;/.test(SV);
  ok(!oldReset, '已移除「15:40 后清零重试计数」这一自废武功的分支',
    oldReset ? '仍存在 → 复盘算完后的补发机会被抹掉' : '');

  // 新写法：15:30 起持续到发出为止（sentToday 双判据闭锁，每天只发一条）
  // ⚠️ 2026-10-08 改判据：闭锁从裸判 `reviewSentDate !== ds` 收口成 sentToday(reviewSentDate, ds, /每日复盘/)，
  //    语义更强（内存闭锁 OR 落盘流水），这里跟着认新写法，不再钉旧字面量。
  const newGate = /t >= 15 \* 60 \+ 30 && !sentToday\(reviewSentDate, ds,/.test(SV);
  ok(newGate, '新闸门 = 15:30 起 · 直到发出为止（每天仅一条）');

  // 必须保留说明：这段注释记录 15:41:44 这个铁证，防止后人改回去
  ok(/15:41:44/.test(SV), '保留根因注释（实测 review.time=15:41:44 错过旧窗口）');

  // 午夜边界：不能跨到凌晨还重推昨天。
  // ⚠️ 2026-10-06 改判据：原来这里断言 `if (t < 3 * 60) return;` 存在，但那句紧跟在
  //    「t 不小于 15:30」之后 —— 「t 小于 180」与「t 不小于 930」永远不可能同时成立，
  //    它从写下那天起就是死分支（本轮角度：时间窗守卫的可达性）。真正挡住跨午夜的是
  //    下界 t >= 15:30 加上换日（00:00 后 t=0 直接被挡下）。
  //    所以这里改成断言「存在 15:30 下界」+「不再有那句永假守卫」，两头都钉死。
  ok(/t >= 15 \* 60 \+ 30/.test(SV) && /sentToday\(reviewSentDate, ds,/.test(SV), '跨午夜靠 t >= 15:30 下界 + 当日闭锁挡住（凌晨不会补推）');
  ok(!/if \(t < 3 \* 60\) return;/.test(SV), '不再保留永假的 `t < 180` 守卫（死分支，删）');

  // 重启补发：发布/重启后若还没发过当天复盘，主动补一次
  ok(/_reviewStartupCheck/.test(SV), '新增重启补发 _reviewStartupCheck()');
  ok(/setTimeout\(_reviewStartupCheck, 120 \* 1000\)/.test(SV), '启动 2 分钟后试补发');
  ok(/setTimeout\(_reviewStartupCheck, 8 \* 60 \* 1000\)/.test(SV), '启动 8 分钟后再兜一次');
  const startupFn = SV.match(/const _reviewStartupCheck = \(\) => \{[\s\S]*?\n  \};/);
  if (startupFn) {
    ok(/sentToday\(reviewSentDate, todayStr\(\),/.test(startupFn[0]), '补发前先判断当天是否已发过（防重复轰炸）');
    ok(/t >= 15 \* 60 \+ 30 && t < 23 \* 60 \+ 59/.test(startupFn[0]), '补发只在收盘后~午夜前生效');
    ok(/S\.ztPool \|\| \[\]\)\.length/.test(startupFn[0]), '没有涨停池就不空推（避免' + '"今日无涨停"' + '噪音）');
  } else { ok(false, '取到 _reviewStartupCheck 函数体'); }
}

// ═══════════ ② 复盘内容：把"今天涨停了什么"摆到第一条 ═══════════
sec('② 复盘内容补全貌（直接回答「涨停那么多你没推送」）');
{
  ok(/function todayHead\(\)/.test(SV), '新增 todayHead()：当日涨停全貌');
  const fn = SV.match(/function todayHead\(\) \{[\s\S]*?\n\}/);
  if (fn) {
    const b = fn[0];
    ok(/limitUpCount \|\| 0\) > 1 \? \(z\.limitUpCount \+ '板'\) : '首板'/.test(b), '统计连板梯队（N板/首板各几只）');
    ok(/最高板/.test(b), '给出最高板代表股（妖股在哪）');
    ok(/S\.mainline && S\.mainline\.items/.test(b), '列出主线板块（板块涨停潮）');
    ok(/封单最强/.test(b), '列出封单最强（资金认可度）');
    ok(/catch \{ return ''; \}/.test(b), '整体兜底：算出错也不能把整条复盘搞挂');
  } else { ok(false, '取到 todayHead 函数体'); }
  // 复盘消息必须把全貌放最前、且仍走 pushAll（飞书主战场）
  // ⚠️ 2026-10-06 改：首行不再是推送时现调 todayHead()，而是 S.review.head（算好那一刻定格的
  //    快照）—— 否则首行的「今日涨停 N 只」与正文的「首板 X 只 连板 Y 只」会来自两个时刻。
  //    语义仍是「正文首行即当日全貌」，只是这份全貌与正文同源。
  ok(/═══ 📋 每日复盘 · 涨停形态与归因 ═══\\n\$\{_rvHead\}/.test(SV), '复盘正文首行即当日全貌（与正文同源的快照）');
  ok(/head:\s*items\.length \? todayHead\(\) : ''/.test(SV), '定格的那份全貌仍由 todayHead() 生成');
  // ⛔ 2026-10-08 改判据：复盘加了 opts.private=true 走私密通道，正则跟着认新写法
  ok(/pushAll\(buildReviewMessage\(\), true, \{ private: true \}\)/.test(SV), '复盘走 pushAll（飞书私密通道）');
}

// ═══════════ ③ 推送流水持久化（"到底推没推"能自证） ═══════════
sec('③ 推送流水落盘（从此能查昨天推了什么）');
{
  ok(/const PUSH_LOG_FILE = path\.join\(__dirname, 'pushlog\.json'\)/.test(SV), '定义 pushlog.json 存盘路径');
  // 落盘已改原子写、载入改走 readJsonSafe（解析失败要留档而不是静默当空流水）
  // ⛔⛔ hi 轮改判据（原判据钉死 `PUSH_LOG.push(..._loaded.slice(0, dataCapOf('pushLog')))` 这一行，
  //    而那正是撞 TDZ 的旧写法本身，见 _test_pushlog_load.js ③反证）：现在钉语义
  //    「磁盘历史流水进 PUSH_LOG」，并新增一条铁律——载入块（顶层 try，模块初始化期执行）
  //    不许出现 dataCapOf 调用（dataCapOf 读的 DATA_CAP 在文件后面，顶层调用 = TDZ，
  //    ReferenceError 被 catch 吞掉 → 每次启动 PUSH_LOG 都是空数组，gb 轮起潜伏 5 天）。
  const { stripNoise } = require('./_codescan.js');
  const SVK = stripNoise(SV, { keepStrings: true });
  const iLd = SVK.indexOf('const _loaded = readJsonSafe(PUSH_LOG_FILE');
  const iCt = SVK.indexOf("} catch (e) { console.error('[pushlog]", iLd);
  const loadBlk = (iLd >= 0 && iCt > iLd) ? SVK.slice(iLd, iCt) : '';
  ok(iLd >= 0 && iCt > iLd && /PUSH_LOG\.push\(/.test(loadBlk), '启动时载入历史流水（readJsonSafe 读到的记录进 PUSH_LOG）');
  ok(!!loadBlk && !/dataCapOf/.test(loadBlk), '载入块不调用 dataCapOf（hi 轮 TDZ 铁律：容量只由运行时的 flush/入队处裁）');
  ok(/readJsonSafe\(PUSH_LOG_FILE/.test(SV), '流水载入走 readJsonSafe（坏文件留档而非静默清空）');
  ok(/function pushLogFlush\(\) \{\s*atomicWrite\(PUSH_LOG_FILE/.test(SV), '流水落盘走原子写');
  // ⛔ du 轮：容量不再写死 500，改走 DATA_CAP 登记表（断言钉语义不钉字面量）
  ok(/PUSH_LOG\.length > dataCapOf\('pushLog'\)\) PUSH_LOG\.length = dataCapOf\('pushLog'\)/.test(SV), '容量走 DATA_CAP 登记表（不再是写死的 500）');
  ok(/pushLogFlush\(\); \}, 3000\)/.test(SV), '写盘 3 秒节流（避免高频推送打爆磁盘）');
  ok(/'pushlog\.json': rd\('pushlog\.json'\)/.test(SV), 'sync/export 导出 pushlog.json（随发布保留历史）');
  // ⚠️ 别再写成 /"pushlog\.json"\]/ —— 那等于断言它必须是数组最后一项，
  //    后面每加一个新数据文件（如 ztpre.json）这条就误报一次。只判"在清单里"。
  ok(/"pushlog\.json"/.test(PUB), '_publish.py 的 DATA_FILES 已含 pushlog.json');
}

// ═══════════ ④ 免重复登录：machineKey 保住 + 密码没变不动设备 ═══════════
sec('④ 发布不再踢掉所有设备');
{
  ok(/machineKey: \(accessSecret && \(accessSecret\.machineKey \|\| _runtimeMK\)\) \|\| null/.test(SV),
    'sync/export 导出 machineKey（限开发者权限，与本就能签令牌等价）');
  // ⚠️ 别把这条断言锁死成某一行的字面写法：为了在「密码没变」时也补回可供面板显示的明文，
  //    这段从单行 return 拆成了多行 if 块（2026-10-03）。锁字面量 = 以后任何排版调整都会假红。
  //    这里要守的是**语义**：pwdOk 比对 → 立即返回 unchanged，且不被后面的「清空 devices」逻辑接手。
  const changePart = SV.match(/pwdOk\(npwd, 'view'\)\)[\s\S]{0,320}?unchanged: true[\s\S]{0,200}?\}/);
  ok(!!changePart, 'change(view) 先判定密码是否真的变了');
  if (changePart) {
    ok(/pwdOk\(npwd, 'view'\)/.test(changePart[0]), '用 pwdOk 比对新旧密码');
    ok(/unchanged: true/.test(changePart[0]) && /note: '观看密码未变化/.test(changePart[0]),
      '密码未变则返回 unchanged（不动设备、不 bump 世代）');
    // 早退必须在真正改写 devices/gen 之前，否则每轮发版都会把只读设备全部踢下线
    ok(!/devices: \{\}[\s\S]{0,200}gen: _devGenBump/.test(changePart[0]),
      '早退分支不碰设备台账与世代号');
  }
  // 真换密码时仍必须作废旧令牌，这是安全底线，不能被上面这条优化吃掉
  ok(/gen: _devGenBump\('view'\)/.test(SV), '真改密码时仍 bump 世代号（旧令牌必须失效）');
  ok(/devices: \{\}, pending: \{\}/.test(SV), '真改密码时仍清空已授权设备');
}

// ═══════════ ⑤ 版本号一致性 ═══════════
sec('⑤ 版本号');
{
  const sv = (SV.match(/const APP_VER = '([^']+)'/) || [])[1];
  const wv = (IDX.match(/const APP_VER = '([^']+)'/) || [])[1];
  // ⚠️ 别写死具体版本号：每次发版都要回来改，不改就红。
  // 这条真正要守的是"两端一致"（不一致前端会无限 reload）与"格式合法"。
  ok(sv === wv && /^\d{8}[a-z]{2}$/.test(sv), 'APP_VER 两端一致且格式合法（' + sv + ' vs ' + wv + '）');
}

console.log('\n──────────────────────────────  结果: ' + pass + ' 通过 / ' + fail + ' 失败 / 共 ' + (pass + fail) + ' 项 ');
process.exit(fail ? 1 : 0);
