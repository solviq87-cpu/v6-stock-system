// go 轮守门（2026-10-13）：用户 10-12 决策表「阶段 0 · 纪律底座」首批落地。
// 覆盖：A 组 8 项推送改私密 / F3 设备台账两处根治 / B2+B3 漏发体检与私密告警 /
//       C2 偏冷环境降级少推 / C3 不推跟风股 / D5 只推高准确率票。
// ⛔ 断言一律钉语义不钉字符串；反证范围限定在各功能段内（gd 轮教训：全文件反证会株连无辜）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const s = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name); }
}
// 取包含 anchor 的一段代码（反证与断言都限定在段内，不株连无辜）
function seg(anchor, len) {
  const i = s.indexOf(anchor);
  return i < 0 ? '' : s.slice(i, i + (len || 600));
}

// ─────────────────────────── A 组：8 项推送改私密 ───────────────────────────
// 语义：这些模块的外发必须带 opts.private（飞书私密机器人）；没配私密通道时 pushAll
//       内部自动退回群机器人，所以加标记不会导致发不出去。
// hw 轮：大单改成「每票一张卡、逐票 pushAll」，整批一次 pushAll 的写法已不存在
ok('A1 大单流入推送带 private',
  /modDay: 'bigmoney', private: true/.test(seg("const _ok = pushAll(_cardOf(x, _kind)", 400)));
ok('A2 补涨龙推送带 private',
  /modDay: 'buzhang', private: true/.test(seg("const _bzOk = pushAll(", 700)));
ok('A4 竞价接近涨停推送带 private',
  /pushAll\(msg, false, \{ private: true \}\)/.test(seg("数据来源：全市场虚拟匹配价", 300)));
// ⛔ hg 轮改判据（钉语义不钉字符串）：flushIntraday 重构后（直推段合并进同一条），
//    private 从「pushAll 行内字面量」变成「opt 初始值」，两种书写都认 ——
//    判据是「这一场 flush 的外发一定带 private」。
ok('A6 盘中预警汇总推送带 private',
  /\}\), false, \{ private: true \}\)/.test(seg("pushAll(buildAlertsReport(top, {", 700))
  || /let msg = '', opt = \{ private: true \};[\s\S]{0,2600}?pushAll\(msg, false, opt\)/.test(seg('function flushIntraday', 3200)));
ok('A9 连续收涨推送带 private',
  /modDay: 'steadyup', private: true/.test(seg("连续收涨 · 台阶式上行", 900)));
ok('A10 模拟盘动态 private 与 sseEdit 并存（两个标记各管一头）',
  /\{ sseEdit: true, private: true \}/.test(seg('═══ 💰 模拟盘动态', 700)));
ok('A11 开盘自检推送带 private',
  /true, \{ private: true \}\)/.test(seg("开盘自检 · ", 700)));
ok('A12 手动复盘补发带 private',
  /pushWecom\(_rdd === todayStr\(\) \? msg[\s\S]{0,140}true, \{ private: true \}\)/.test(seg('const _rdd = (typeof reviewDataDay', 700)));
ok('A 组 8 处改动标记齐全（go 轮 A1~A12 决策项）',
  (s.match(/go 轮 A\d+/g) || []).length >= 8);

// ─────────────────────────── F3：设备台账两处根治 ───────────────────────────
// 语义①：同一 fp 作废旧记录时，旧令牌摘要必须进 revoked 名单（自证令牌不查台账）
// ⛔ #291 起这条 revoked 词条还带 graceUntil（同 fp 重签给 24 小时宽限，旧标签页不当场掉线）。
//    断言钉的是「先删台账、再写 revoked、且带宽限字段」这个先后关系，不钉死整句 reason 文案、
//    也不用固定字符窗口（#291 只加了 6 行注释就把原来的 {0,900} 顶穿，正是钉字符串的老毛病）。
{
  const _i0 = s.indexOf('if (v && v.fp === fp) {');
  const _i1 = s.indexOf('delete bag.devices[k];', _i0);
  const _i2 = s.indexOf("reason: '同一设备(fp)重新签发", _i1);
  const _i3 = s.indexOf('graceUntil: Date.now() + DEVICE_GRACE_MS', _i2);
  ok('F3-1 issueDevice 同 fp 作废旧记录时写 revoked 名单（并带 24h 宽限）',
    _i0 > 0 && _i1 > _i0 && _i2 > _i1 && _i3 > _i2 && (_i3 - _i1) < 4000);
}
// 语义②：touchDevice 占位去重不再要求 ip 非空（空 ip 也按 (ip,role) 收编）
ok('F3-2 touchDevice 占位去重无 ip 非空前提（空 ip 也收敛）',
  /for \(const k of Object\.keys\(bag\)\) \{[\s\S]{0,260}?v2\.restored && !v2\.fp && \(v2\.ip \|\| ''\) === \(ip \|\| ''\)/.test(seg('function touchDevice(t, role, ip)', 2400))
  && !/if \(ip\) \{\s*for \(const k of Object\.keys\(bag\)\)/.test(s));
// 语义③：早就被调用却从未登记的补救名补登（nextPlanBoot/nextPlanAuto + heal*）
ok('F3-3 REMEDY_RULE 补登 nextPlanBoot/nextPlanAuto/healReview/healNextPlan',
  /nextPlanBoot:\s*\{ tries: 2/.test(s) && /nextPlanAuto:\s*\{ tries: 0/.test(s)
  && /healReview:\s*\{ tries: 0/.test(s) && /healNextPlan:\s*\{ tries: 0/.test(s));
ok('F3-3b REMEDY_SKIP 补登 nextPlan 与 heal 的跳过原因',
  /notTradeDay:/.test(s) && /notAfterClose:/.test(s) && /alreadySent:/.test(s)
  && /computeException:/.test(s) && /planEmpty:/.test(s) && /healBusy:/.test(s));

// ─────────────────────────── B2+B3：漏发体检 / 告警 / 自愈 ───────────────────────────
ok('B2/B3-1 体检登记表含三个必达模块且各带应发时刻',
  /key: 'review'[\s\S]{0,120}dueMin: 15 \* 60 \+ 30/.test(s)
  && /key: 'digest'[\s\S]{0,160}dueMin: 21 \* 60/.test(s)
  && /key: 'nextplan'[\s\S]{0,120}dueMin: 15 \* 60 \+ 45/.test(s));
ok('B2/B3-2 新闻汇总只检测告警不补推（其定时器本身每 20s 重试，无锁补推会双发）',
  /key: 'digest'[\s\S]{0,220}heal: null/.test(s));
ok('B2/B3-3 体检回调有副本闸门（只有线上主实例是推送执行者）',
  /const _pushHealthTick = async \(\) => \{[\s\S]{0,120}?if \(isReplica\(\)\) return;/.test(s));
ok('B2/B3-4 周期任务走 guard 防重入（这轮失败下轮再来，不抛给空气）',
  /guard\('pushHealth', _pushHealthTick\)/.test(s));
ok('B2/B3-5 判"发没发"用 sentToday 双判据 + 应发时刻（与定时器同一把尺）',
  /if \(sentToday\(R\.lockOf\(\), ds, R\.titleRe, R\.dueMin\)\) continue;/.test(s));
ok('B2/B3-6 复盘补推与定时器共用 reviewBusy 锁、同一推送表达式',
  /const _healthHealReview = async \(\) => \{[\s\S]{0,200}?if \(reviewBusy\) return \{ busy: true \};[\s\S]{0,120}?reviewBusy = true;[\s\S]{0,900}?pushAll\(buildReviewMessage\(\), true, \{ private: true \}\)/.test(s));
ok('B2/B3-7 数据没回来不空推（复盘无条目即跳过，不置闭锁）',
  /if \(!it\.length\) return \{ skip: 'reviewNoPool' \};/.test(s)
  && /if \(!marketReady\(\)\) return \{ skip: 'reviewNoPool' \};/.test(s));
ok('B2/B3-8 告警双去重：本进程 Map + pushedToday 落盘流水（跨重启同一天同类只响一次）',
  /if \(_healthAlerted\[k\]\) return;[\s\S]{0,200}?if \(pushedToday\(new RegExp\('健康告警 · ' \+ label\)\)\)/.test(s));
ok('B2/B3-9 告警走私密通道且 force 跳过静默',
  /true, \{ private: true \}\);\s*\n?\s*\};/.test(seg('const _healthAlert = (key, label, text) =>', 900)));
ok('B2/B3-10 启动即体检（不只挂定时器：90s 首检 + 60s 周期）',
  /setTimeout\(_pushHealthGuarded, 90 \* 1000\)/.test(s) && /setInterval\(_pushHealthGuarded, 60 \* 1000\)/.test(s));

// ─────────────────────────── C2：偏冷环境降级/少推 ───────────────────────────
ok('C2-1 envCold 缺温度数据时中性（判不出≠通过/不通过）',
  /function envCold\(\) \{[\s\S]{0,400}?v = !!/.test(s) && /try \{ const m = marketMood\(\); v = !!\(m && m\.mood === '偏冷'\); \} catch \(e\) \{ v = false; \}/.test(s));
ok('C2-2 胜率门抬升只在 base>0 时生效（0=不限不被抬高），且封顶 100',
  /return \(base > 0 && envCold\(\)\) \? Math\.min\(100, base \+ ENV_COLD_UPLIFT\) : base;/.test(s));
ok('C2-3 govTake 用生效门槛而非配置原值',
  /let mp = \(typeof pushMinProbEff === 'function'\) \? pushMinProbEff\(\) : pushMinProb\(\);/.test(s));
// ⛔ if 轮改判据（钉语义不钉字符串）：D2/D4 给偏冷天加了「每类保底 2 条」——
//    减半 Math.floor(capRaw/2) 对 capRaw=2 或 3 的类会除成 0 或 1，机会类整天一声不吭
//    （10-15 线上实证：竞价两条漏发 + 大单整天 0 条）。下限从写死 1 改成查 MSG_COLD_FLOOR
//    按类取保底，取不到才回落 1（typeof 守卫兼容守门沙箱里不注入该常量的场景）。
//    语义 = 偏冷仍减半（总量依旧受控），但「机会类至少留 2 条」不再被除没。
ok('C2-4 条数闸门偏冷减半（总量下限 1；每类下限按 MSG_COLD_FLOOR 保底，0=不限语义不变）',
  /const capTotal = \(capTotalRaw > 0 && _cold\) \? Math\.max\(1, Math\.floor\(capTotalRaw \/ 2\)\) : capTotalRaw;/.test(s)
  && /const _floor = \(typeof MSG_COLD_FLOOR !== 'undefined' && MSG_COLD_FLOOR\[kind\]\) \|\| 1;/.test(s)
  && /const cap = \(_cold && capRaw > 0\) \? Math\.max\(_floor, Math\.floor\(capRaw \/ 2\)\) : capRaw;/.test(s)
  && /const MSG_COLD_FLOOR = \{ 竞价: 2, 大单: 2 \};/.test(s));
ok('C2-5 拦因带「偏冷环境」标签（用户看得见为什么今天门槛高）',
  /const _coldTag = \(mp > pushMinProb\(\) && type !== 'pre'\)/.test(s));
ok('C2-6 免配额消息不受降级影响（msgGate 顶部 MSG_FREE_RE 先 return）',
  /if \(MSG_FREE_RE\.test\(head\)\) return \{ ok: true, kind: '日报' \};/.test(seg('function msgGate', 500)));
ok('C2-7 面板胜率门显示当前生效值（含偏冷标注），不是配置原值',
  /胜率门 \$\{\(typeof pushMinProbEff === 'function'\) \? pushMinProbEff\(\) : pushMinProb\(\)\}%\$\{\(typeof envCold === 'function'\) && envCold\(\) \?/.test(s));

// ─────────────────────────── C3：不推跟风股 ───────────────────────────
ok('C3-1 角色查表带日期校验（非今日角色不拦：拿旧数据≠判断）',
  /function ztFollowOf\(code\) \{[\s\S]{0,700}?if \(\(r\.secZTDay \|\| ''\) !== ds\) return null;/.test(s));
ok('C3-2 查表带缓存（govTake 逐候选调用，不能每次重建角色表）',
  /now - _ztRoleCache\.t > 60000/.test(s));
ok('C3-3 govTake 对跟风涨停返回不可用且原因可读',
  /if \(_follow === 'follow'\) \{[\s\S]{0,220}?why: '板块内跟风涨停（非龙头\/龙二\/中军），按你的设置不推送'/.test(s));
ok('C3-4 跟风单列第四类拦因，不混入 lowProb/throttled',
  /const follow = Math\.min\(Math\.max\(0, \+PUSH_GOV\.follow \|\| 0\), Math\.max\(0, dropped - lowProb\)\);/.test(s)
  && /return \{ dropped, lowProb, follow, noScore, negEv, throttled: Math\.max\(0, dropped - lowProb - follow - noScore - negEv\) \};/.test(s));
ok('C3-5 govResetIfNewDay 清零 follow（跨日不串数）',
  /PUSH_GOV\.follow = 0;/.test(seg('function govResetIfNewDay', 700)));
ok('C3-6 govFilter 按 why 归类 follow 且本地计数已声明（防 ReferenceError）',
  /let drop = 0, lowProb = 0, noScore = 0, follow = 0, negEv = 0;/.test(s)
  && /if \(res\.why && String\(res\.why\)\.indexOf\('跟风'\) >= 0\) follow\+\+;/.test(s));
// ig 轮 #261：EV 门单列第五类——⛔ 按 res.evGate.blocked 显式归类（不靠 why 字符串：文案会改，字段不会）
ok('#261-1 govFilter 按 res.evGate.blocked 显式归类 negEv（第五类，不靠 why 字符串匹配）',
  /else if \(res\.evGate && res\.evGate\.blocked\) negEv\+\+;/.test(s));
ok('#261-2 EV 门计数 negEv 在 govTake 内逐条 ++ 且 govFilter 落账不双记',
  /PUSH_GOV\.negEv\+\+/.test(seg('function govTake', 6000)) && /if \(negEv\) PUSH_GOV\.negEv = \(\+PUSH_GOV\.negEv \|\| 0\) \+ negEv;/.test(s));

// ─────────────────────────── D5：只推高准确率票 ───────────────────────────
ok('D5-1 实测命中率硬闸：样本≥20 且低于 35% 不推',
  /const D5_MIN_HIT = 35, D5_MIN_N = 20;/.test(s)
  && /if \(!forcePush && _fz\.emp != null && _fz\.empN >= D5_MIN_N && _fz\.emp < D5_MIN_HIT\)/.test(s));
ok('D5-2 薄样本不重复惩罚（n<20 或没有实测数据一律放行）',
  /_fz\.empN >= D5_MIN_N/.test(seg('const D5_MIN_HIT', 500)));
ok('D5-3 forcePush（持续大单流入）豁免 D5 硬闸',
  /if \(!forcePush && _fz\.emp != null/.test(s));
ok('D5-4 D5 拦因计入 lowProb 类（它是准确率门槛，不是重复/冷却）',
  /PUSH_GOV\.lowProb\+\+;[\s\S]{0,200}?按「只推高准确率票」不推送/.test(s));
ok('D5-5 面板门槛说明含 D5 口径',
  /实测命中率底线 35%（样本≥20/.test(s));

console.log('\n──────────\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
