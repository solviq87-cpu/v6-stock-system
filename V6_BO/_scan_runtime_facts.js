// 扫描器：不看代码看事实 —— 「每一行都对，合起来才出事」的累积型问题（配合 _test_runtime_facts.js 用）
//
// 前面所有轮次的前提都是"读源码找漏洞"。但有一类问题**源码里看不出来**：
// 单次调用逻辑全对，问题是它**每天被调用 N 次**，于是线上就堆了 N 条。
// 2026-10-07 拉线上真实数据才发现两处：
//   ① 最近 30 条推送里 25 条是「📦 源码包」—— 发版脚本每发一版推一条；
//   ② 台账 19 条里 9 条是「已授权设备（自动恢复）」占位 —— 每次口令登录签新令牌就补一条。
// 这两处单看代码都"没毛病"，只有拉真实运行数据才暴露。
//
// 本扫描器把这种"事后才看得见"的问题提前到代码层：
//   【①】每个 pushLog 所在的函数有没有频次闸门（没有 = 每触发一次就弹一条手机）
//   【②】往长期容器里写条目的地方，有没有去重归并 / 容量裁剪（没有 = 越堆越多）
//   【③】按"令牌摘要 + 无指纹"建台账条目的地方，有没有兜底归并键（没有 = 一台设备变 N 条）
//
// ⛔ 一律在剥掉注释的版本上扫：注释里会逐字引用旧写法来解释历史 bug，扫原文全是噪音。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const K = stripNoise(SV, { keepStrings: true });
const lineSV = i => SV.slice(0, i).split('\n').length;

console.log('══ 累积型问题扫描（不看代码看事实那一轮）══\n');

// 往上找这个位置所属的【顶层函数】名
function ownerFn(src, i) {
  const head = src.slice(0, i);
  let best = -1, name = '(顶层/路由内)';
  const re = /(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(head))) { best = m.index; name = m[1]; }
  // 路由里的匿名 pushLog：往上找最近的 p === 'xxx'
  if (best < 0 || i - best > 20000) {
    const r2 = /(?:^|\n)\s*(?:if|else if)\s*\(\s*p\s*===\s*'([^']+)'/g;
    let m2, b2 = -1;
    while ((m2 = r2.exec(head))) { b2 = m2.index; name = '路由 ' + m2[1]; }
    if (b2 >= 0 && (best < 0 || b2 > best)) best = b2;
  }
  return name;
}
function fnBlock(src, headerIdx) {
  let d = 0, j = src.indexOf('{', headerIdx);
  if (j < 0) return '';
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(headerIdx, k + 1); }
  }
  return src.slice(headerIdx, headerIdx + 6000);
}
function blockOf(src, i) {
  const head = src.slice(0, i);
  let best = -1;
  const re = /(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(head))) best = m.index;
  if (best < 0) return src.slice(Math.max(0, i - 3000), i + 3000);
  return fnBlock(src, best);
}

// ── ① 推送频次闸门：函数里发了消息，却没有任何"今天发过没有 / 距上次多久"的判据 ──
console.log('【① pushLog 所在函数有没有频次闸门】（标记 ⚠ = 每次触发都会弹一条手机）');
{
  // 已人工复核、确认不需要闸门的（写明理由，防止后人误判）
  const NOTES = {
    'pushAll': '推送总入口，闸门在调用方（govTake/各模块）',
    'pushNote': '用户手动点"发一条"（/api/push-note），要的就是必达',
    'notifyHoldingsCleared': '持仓被清空是安全事件，必须立刻告知',
    'pushStopLoss': '止损提醒，按项目铁律绕过胜率门、即时必达',
    'srcPkgShip': '已加 pushedToday(/源码包/)（本轮修）',
    'redeemCodeShip': '登录授权码，用户主动要才有，本来就是一次性的',
    'otpShip': '找回密码验证码，用户主动要才有',
    'pushDailyReview': '收盘复盘：外面有 reviewSentDate 今日闭锁',
    'pushNewsSummary': '新闻汇总：外面有 newsSent 今日闭锁',
    'pushSrcPkgDaily': '源码包日报（若有）：沿用日闭锁',
    'pushVerifyCode': '找回验证码：/api/lock/forgot 里已按 IP 限流（10 分钟 5 次）+ 60 秒内只推一次 + 同码复用',
    'init': '启动自检（全A股学习）：learnallDate === ds 当日闭锁',
    'handle': 'HTTP 总入口，闸门在被调的各模块里',
    '路由 /api/steady-up': '手动触发（面板点一次推一次），要的就是即时反馈',
    '路由 /api/kline-backfill': '手动触发的补数接口',
    '路由 /api/learnall-ingest': '手动触发的学习入库（自动那路由 learnallDate 当日闭锁）',
    '路由 /api/review-digest': '手动触发的复盘摘要',
    '路由 /api/auction-strong': '手动触发的竞价强势',
    '路由 /api/auction-digest': '手动触发的竞价摘要',
    '路由 /api/lock/reset-pwd': '重设密码成功告知（安全事件，必须立刻让用户知道）',
  };
  const GATE = /pushedToday\(|sentLockFromPushLog\(|_sentLock|S\.bzLastPush|modDayTake|dayTake\(|_dayTake|quietNow\(|S\.news\.sent|_reviewSent|_otpHit|_authFail|lastPush|isReplica\(|=== ds|\w+Date === ds|sentDate|SentDate/;
  const re = /pushLog\(/g;
  let m, seen = new Set(), bad = [];
  const rows = [];
  while ((m = re.exec(K))) {
    // ⛔ 跳过 pushLog 自己的定义（那一行是 function pushLog(，不是调用点）
    // 注意：m.index 指向的是 "pushLog(" 里的 p，函数名在它【之后】，往前找是找不到的
    if (/^pushLog\(status/.test(K.slice(m.index))) continue;
    const owner = ownerFn(K, m.index);
    if (seen.has(owner)) continue;
    seen.add(owner);
    const block = blockOf(K, m.index);
    const gated = GATE.test(block);
    const noted = !!NOTES[owner];
    rows.push({ owner, gated, noted, line: lineSV(m.index) });
    if (!gated && !noted) bad.push(owner);
  }
  for (const r of rows) {
    const tag = r.gated ? ' ' : (r.noted ? '·' : '⚠');
    const why = r.gated ? '有闸门' : (r.noted ? '人工确认无需闸门：' + NOTES[r.owner] : '未见任何频次判据');
    console.log(`  ${tag} ${r.owner}  L${r.line}  ${why}`);
  }
  console.log(`  小计 ${rows.length} 个发消息的函数，未见频次闸门 ${bad.length} 个${bad.length ? '：' + bad.join('、') : ''}\n`);
}

// ── ② 长期容器：写进去的东西有没有上限/归并 ──
console.log('【② 长期容器有没有去重归并 / 容量裁剪】（标记 ⚠ = 只进不出）');
{
  const CONTAINERS = [
    ['PUSH_LOG', '推送流水（落盘 pushlog.json，进发布包）'],
    ['AUTH_CODES', '登录授权码槽位'],
    ['_otp', '找回密码验证码槽位'],
    ['_vtokens', '只读设备令牌'],
    ['_tokens', '设备令牌'],
    ['S.news', '新闻缓存'],
    ['S.ztTopic', '题材缓存'],
    ['_empCache', '实测命中率缓存'],
    ['_laCache', 'learnall 自学缓存'],
  ];
  // 已人工复核、确认不会越堆越多的（写明理由）
  const NOTES2 = {
    '_empCache': '整体重建（_empCache = { t, map, done }），不是追加，天然有界',
    'S.ztTopic': '按题材键覆盖写（key 数量有限），不追加',
  };
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [name, desc] of CONTAINERS) {
    let writes = 0, trims = 0, m;
    const pats = [new RegExp(esc(name) + '\\.push\\(', 'g'),
                  new RegExp(esc(name) + '\\.set\\(', 'g'),
                  new RegExp(esc(name) + '\\[[^\\]]{0,40}\\]\\s*=', 'g'),
                  new RegExp(esc(name) + '\\.unshift\\(', 'g'),
                  new RegExp(esc(name) + '\\.[A-Za-z_$][\\w$]*\\s*=[^=]', 'g'),
                  new RegExp('(?:^|[^\\w.])' + esc(name) + '\\s*=\\s*[^=]', 'g')];
    for (const p of pats) { while ((m = p.exec(K))) writes++; }
    const tRe = [new RegExp(esc(name) + '[^\\n]{0,120}\\.(?:slice|splice|shift)\\s*\\(', 'g'),
                 new RegExp(esc(name) + '\\.length\\s*>\\s*\\d', 'g'),
                 new RegExp(esc(name) + '\\.size\\s*>\\s*\\d', 'g'),
                 new RegExp(esc(name) + '\\s*=\\s*' + esc(name) + '[^\\n]{0,80}\\.(?:slice|filter)\\s*\\(', 'g'),
                 new RegExp('delete\\s+' + esc(name) + '\\s*\\[', 'g'),
                 new RegExp(esc(name) + '\\.delete\\(', 'g'),
                 new RegExp(esc(name) + '\\.clear\\(', 'g')];
    for (const p of tRe) { while ((m = p.exec(K))) trims++; }
    const noted = !!NOTES2[name];
    const tag = trims > 0 ? ' ' : (noted ? '·' : '⚠');
    const why = trims > 0 ? '' : (noted ? '（人工确认：' + NOTES2[name] + '）' : '');
    console.log(`  ${tag} ${name.padEnd(12)} 写入 ${String(writes).padStart(3)} 处 / 裁剪·回收 ${String(trims).padStart(2)} 处   ${desc}${why}`);
  }
  const HJ = fs.readFileSync(path.join(ROOT, 'holdings.js'), 'utf8');
  const HK = stripNoise(HJ, { keepStrings: true });
  console.log(`  ${/list\.slice\(-500\)/.test(HK) ? ' ' : '⚠'} holdings.js 审计流水 .holdings_ops.json：${/list\.slice\(-500\)/.test(HK) ? '落盘前 slice(-500) 封顶' : '未见封顶'}`);
  console.log('  说明：没有裁剪不等于一定错（有的按天自然过期、有的条数本就有限），');
  console.log('        但"每天都会新增、且永不清"的容器，线上跑两周就会变成一坨 —— 必须有人确认一句。\n');
}

// ── ③ 台账条目：按令牌摘要建、又没有指纹可归并的地方 ──
console.log('【③ 设备台账：没有指纹时用不用兜底归并键】');
{
  const bagFn = fnBlock(K, K.indexOf('function touchDevice(t, role, ip) {'));
  const hasIpMerge = /v2\.restored && !v2\.fp && v2\.ip === ip/.test(bagFn);
  const keepsFp = /!v2\.fp/.test(bagFn);
  const byRole = /\(v2\.role \|\| role\) === role/.test(bagFn);
  console.log(`  ${hasIpMerge ? ' ' : '⚠'} touchDevice 无指纹时按 IP 归并：${hasIpMerge ? '是' : '否（同 IP 反复登录会各留一条）'}`);
  console.log(`  ${keepsFp ? ' ' : '⚠'} 归并只动"自动恢复"占位、绝不碰真设备：${keepsFp ? '是' : '否（会误删用户的手机/电脑）'}`);
  console.log(`  ${byRole ? ' ' : '⚠'} 按角色区分（开发者与只读各留各的）：${byRole ? '是' : '否'}`);
  const n = (K.match(/restored:\s*true/g) || []).length;
  console.log(`  台账里"自动恢复"占位写法共 ${n} 处（应只有 touchDevice 一处建）`);
  console.log('');
}

console.log('══ 本轮已收口 ══');
console.log('  ① srcPkgShip：同一天只推一次源码包（能力不减：链接照样生成、照样进面板流水）');
console.log('  ② touchDevice：无指纹时按 IP + 角色归并，同 IP 只留最新一条，真设备一条不动');
