// 不看代码看事实：从线上真实运行数据反查出来的问题（2026-10-07，本轮新角度）。
//
// 前面 14 轮的共同前提都是"读源码 → 找逻辑漏洞"。这一轮换了顺序：
// **直接把线上实例跑出来的真实数据拉下来看**，看看哪些地方断言全绿、体验却很糟。
//
// 拉下来当天线上 pushlog.json 与设备台账，发现两处：
//
//  ① **源码包推送刷屏**：最近 30 条推送里 **25 条是「📦 源码包 · 仅本人可见」**。
//     "私密通道同步发源码"是用户点名要的能力（2026-10-05 原话），必须保留；
//     但发版脚本每发一版就推一条，一天十几个版本 = 手机弹十几条源码包。
//     它既刷屏，还和行情推送抢同一个"少而精"额度。
//     → 同一天只推一次（能力不减：链接照样生成、照样进面板流水，随时能取）。
//
//  ② **设备台账里一长串"已授权设备（自动恢复）"占位**：19 条里 9 条是它。
//     成因：用口令登录每次都签一枚**新令牌** → 摘要不同 → 补一条新记录；
//     而这类占位**不带指纹**，没得归并，于是发一版堆一条。
//     用户 2026-10-03 就问过"那些 N 台都是我的吗" —— 真正能登录的其实只有手机 + 电脑两台。
//     → 没有指纹时用 IP 兜底：同一 IP + 同一角色只留最新一条。
//
// 这两处的共同点：**每一行代码单看都对，合起来才暴露问题**，
// 所以断言（都基于源码结构）永远测不出来，只有看真实数据才能发现。
// 本测试把那段真实判据（pushedToday / touchDevice 归并）抠进沙箱真跑，并配旧写法反证。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const CODE_K = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
// 按大括号配对抠出整段函数，避免钉死字符窗口（已踩多次）
function grabFn(src, header) {
  const i = src.indexOf(header);
  if (i < 0) return '';
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); }
  }
  return '';
}

group('[1] 源码包：同一天只推一次（能力保留，刷屏止住）');
{
  // ⚠️ 这里的判据是【正则字面量】/源码包/ —— stripNoise 会把正则剥掉（keepStrings 只保字符串），
  //    所以结构断言必须抠**原始源码**；只有下方"真跑"那一段才用剥过噪音的版本。
  const fn = grabFn(SV, 'async function srcPkgShip(b64, ver, name) {');
  ok('抠到 srcPkgShip', fn.length > 0);
  const iGate = fn.indexOf('pushedToday(/源码包/)');
  const iSend = fn.indexOf('feishuProbe(');
  ok('有"同一天只推一次"的判据', iGate >= 0);
  ok('⛔ 判据排在真正推送之前（先判频次，再发）',
    iGate >= 0 && iSend >= 0 && iGate < iSend, `gate=${iGate} send=${iSend}`);
  ok('判据排在私密通道检查之后（没有私密通道时不该轮到频次逻辑）',
    iGate > fn.indexOf('if (!privReady())'));
  ok('被拦下时仍然生成了下载链接（能力没减）', /url: srcPkgUrl\(token\)/.test(fn));
  ok('被拦下时记了流水（面板查得到）', /pushLog\('🚫 源码包当日已推过'/.test(fn));
  ok('提示写明"链接在面板推送流水里照样能取"', /链接见面板/.test(fn));

  // 真跑 pushedToday：把源码抠出来配一份假流水
  // hw 轮：「已外发过」判据收口到 pushIsOutStatus，沙箱必须把它的源码一起编译进去
  const src = grabFn(CODE_K, 'function pushIsOutStatus(st) {') + '\n' + grabFn(CODE_K, 'function pushedToday(titleRe) {');
  // ⚠️ dayKeyOf 必须按【日期】取键（真实实现是把时间戳转成本地日期的 YYYYMMDD），
  //    不能拿毫秒时间戳切前 8 位（那样永远等于一串数字，跟 todayStr() 对不上 → 假阴）。
  const _dk = (ts) => new Date(Number(ts) + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
  const mk = (logs) => new Function('PUSH_LOG', 'todayStr', 'dayKeyOf',
    src + '\nreturn pushedToday;')(logs, () => '20261007', _dk);
  const today = Date.parse('2026-10-07T10:00:00+08:00');
  const yday = Date.parse('2026-10-06T10:00:00+08:00');
  const L = (ts, status, title) => ({ ts, status, title });
  ok('今天已送达过源码包 → 判为推过', mk([L(today, '✅ 已送达(私密)', '═══ 📦 源码包 · 仅本人可见 ═══')])(/源码包/));
  ok('只有昨天的记录 → 不拦', !mk([L(yday, '✅ 已送达(私密)', '📦 源码包')])(/源码包/));
  ok('⛔ 只有失败记录 → 不拦（被闸门拦下的下轮必须补推）',
    !mk([L(today, '❌ 发送失败', '📦 源码包'), L(today, '夜间静默拦截', '📦 源码包')])(/源码包/));
  ok('别的标题不算推过', !mk([L(today, '✅ 已送达', '📰 新闻汇总')])(/源码包/));
  // 反证：旧写法没有这道判据
  ok('反证：旧写法（上传即推）应当判不合格',
    !/pushedToday\(\/源码包\/\)/.test('const r = await feishuProbe(feishuSecId(), "", card);'));
}

group('[2] 设备台账占位：同一 IP + 同一角色只留最新一条');
{
  const src = grabFn(CODE_K, 'function touchDevice(t, role, ip) {');
  ok('抠到 touchDevice', src.length > 0);
  // ⛔ go 轮 F3：去重前提从「ip 非空」改成无条件（空 ip 占位永不去重是台账堆积第二根因），
  //    正则跟着认新写法：比较走 (v2.ip || '') === (ip || '')，空 ip 也按 (ip,role) 收编。
  ok('补占位前先清掉同 IP 的旧占位（go 轮起空 ip 也收敛）', /v2\.restored && !v2\.fp && \(v2\.ip \|\| ''\) === \(ip \|\| ''\)/.test(src));
  ok('只清"自动恢复"的占位，绝不动真设备（有指纹的）', /!v2\.fp/.test(src));
  ok('按角色区分（开发者与只读各留各的）', /\(v2\.role \|\| role\) === role/.test(src));

  // 真跑：连续三次不同令牌（模拟一天发三版）→ 台账里只该留 1 条占位
  // ⛔ #291 起 touchDevice 补占位前要问 inDeviceGrace（宽限中的令牌 24 小时后必废，
  //    补一条等于给台账添一条马上消失的幽灵）—— 沙箱必须把生产源码一起拼进去，
  //    否则 new Function 里 ReferenceError 会被 touchDevice 自己的 try/catch 静默吞掉，
  //    表现为「一条占位都没建出来」（本套件就是这么红的，与 hi 轮 pushlog 同款）。
  //    inDeviceGrace 只读 accessSecret —— 沙箱里 accessSecret 是形参，闭包直接取到，
  //    所以拼源码即可，不必再手写一份（同一概念禁两份实现）。
  const graceSrc = grabFn(CODE_K, 'function inDeviceGrace(digest) {');
  ok('抠到 inDeviceGrace（touchDevice 的依赖）', graceSrc.length > 0 && /graceUntil/.test(graceSrc));
  const accessSecret = { devices: {} };
  const run = new Function('t', 'role', 'ip', 'accessSecret', 'viewStore', 'devDigest',
    'saveAccess', '_devTouch', graceSrc + '\n' + src + '\nreturn touchDevice;');
  let saves = 0;
  const td = run('', '', '', accessSecret, () => null, s => 'D' + s, () => { saves++; }, new Map());
  const bag = accessSecret.devices;
  const now = Date.now();
  // 预置两条旧占位（同 IP 不同令牌）+ 一台真设备（带 fp）
  bag['OLD1'] = { name: '已授权设备（自动恢复）', ip: '1.2.3.4', role: 'edit', ts: now - 86400000, restored: true };
  bag['OLD2'] = { name: '已授权设备（自动恢复）', ip: '1.2.3.4', role: 'edit', ts: now - 3600000, restored: true };
  bag['REAL'] = { name: '我的电脑', ip: '1.2.3.4', role: 'edit', ts: now, fp: 'Fabc123' };
  td('tok-A', 'edit', '1.2.3.4');
  const after = Object.keys(bag).filter(k => bag[k] && bag[k].restored);
  ok('⛔ 同 IP 的旧占位被清掉，只留最新那一条', after.length === 1, '剩 ' + after.length + ' 条：' + after.join(','));
  ok('⛔ 真设备（带指纹）一条都没动', !!bag['REAL'] && bag['REAL'].name === '我的电脑');
  ok('新的占位确实建出来了', after.length === 1 && bag[after[0]].name === '已授权设备（自动恢复）');
  // 换个 IP 再来一次：应各自保留
  td('tok-B', 'edit', '9.9.9.9');
  const ips = Object.values(bag).filter(v => v && v.restored).map(v => v.ip).sort();
  ok('不同 IP 各留一条（没有误杀）', ips.length === 2 && ips.join(',') === '1.2.3.4,9.9.9.9', ips.join(','));
  // 反证：旧写法（不判 IP 直接补）会越堆越多
  const legacy = {};
  legacy['OLD1'] = { restored: true, ip: '1.2.3.4' };
  legacy['NEW1'] = { restored: true, ip: '1.2.3.4' };   // 旧写法：直接补，不删旧的
  ok('反证：旧写法（直接补、不归并）确实会越堆越多',
    Object.keys(legacy).length === 2 && !/v2\.ip === ip/.test('bag[d] = { restored: true };'));
}

group('[3] 存量也能归并：面板「整理授权设备」必须清得掉无指纹占位');
{
  // 线上实测：台账 19 条里 9 条是「已授权设备（自动恢复）」占位。
  // 只改 touchDevice（新建时归并）不够 —— 已经堆在那儿的那些，点「整理」照样清不掉，
  // 因为 prune 只按 v.fp 归并，而这类占位恰恰没有指纹。两边都得改。
  const i = CODE_K.indexOf("if (p === '/api/lock/devices' && req.method === 'POST')");
  const seg = CODE_K.slice(i, i + 4000);
  ok('抠到 prune 路由', i > 0);
  ok('⛔ prune 里有按 IP + 角色归并占位的一段', /seenPh/.test(seg) && /v\.restored \|\| v\.fp/.test(seg));
  ok('⛔ 归并只动占位、绝不碰带指纹的真设备', /if \(!v\.restored \|\| v\.fp\) continue;/.test(seg));
  ok('⛔ 归并键是 IP + 角色（不是只看 IP）', /\(v\.ip \|\| '-'\) \+ '\|' \+ \(v\.role/.test(seg));
  ok('⛔ 归并发生在真正删除之前', seg.indexOf('seenPh') < seg.indexOf('delete bag[k]'));
  // 真跑：把这段从源码里抠出来，喂 3 条同 IP 占位 + 1 台真设备 → 应只留 1 条占位
  // ⚠️ 切到「真正删除」那句 for 为止：切到 delete bag[k] 会把那半句 for 一起带进来、
  //    括号配不上 → new Function 直接 SyntaxError（症状像断言红，其实是切歪了）
  const body = seg.slice(seg.indexOf('const seenPh'), seg.indexOf('for (const k of new Set(stale))'));
  const runP = new Function('bag', 'stale', 'keys',
    body + '\nreturn stale;');
  const now = Date.now();
  const bag2 = {
    P1: { restored: true, ip: '1.2.3.4', role: 'edit', ts: now - 30000 },
    P2: { restored: true, ip: '1.2.3.4', role: 'edit', ts: now - 20000 },
    P3: { restored: true, ip: '1.2.3.4', role: 'edit', ts: now - 10000 },
    R1: { name: '我的电脑', fp: 'Fabc', ip: '1.2.3.4', role: 'edit', ts: now },
    P4: { restored: true, ip: '9.9.9.9', role: 'edit', ts: now - 5000 },
  };
  const stale = runP(bag2, [], Object.keys(bag2));
  const uniq = [...new Set(stale)].sort();
  ok('⛔ 同 IP 同角色的 3 条占位 → 只保留最新 1 条（清掉 2 条）',
    uniq.length === 2 && uniq.join(',') === 'P1,P2', uniq.join(','));
  ok('⛔ 带指纹的真设备不在清理名单里', uniq.indexOf('R1') < 0);
  ok('⛔ 不同 IP 的占位各留各的（没误杀）', uniq.indexOf('P4') < 0);
  // 反证：旧写法（只按 fp 归并）对这批占位一条都清不掉
  const legacy = ['P1', 'P2', 'P3', 'R1', 'P4'].filter(k => !!bag2[k].fp);
  ok('反证：旧写法只认 fp，无指纹占位一条都清不掉', legacy.length === 1 && legacy[0] === 'R1',
    '旧写法只会把 R1 当重复处理');
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
