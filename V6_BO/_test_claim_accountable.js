// cj 轮守门：系统对自己说的话负不负责。
// 钉两类「话和责任对不上」：
//   ① 流水里的 ✅ 只说明"这一步做成了"，**不说明东西送到了**。
//      复盘试算(dry)一条都没发，却留下一条以 ✅ 开头的流水 —— 而 pushedToday() 判定
//      「今天有没有真发出去过」正是看 ✅ → 试算变成了"已送达证据"，当天真复盘永不补推。
//   ② 「邮箱已配置」这句话在四处各写了一遍，其中两处漏了收件人 to ——
//      面板显示已配置，而真正发信的 pushAll 缺 to 就不发。对外说配好了，自己发时当没配。
// 离线、确定性：不碰真实流水与配置，全部注入。
let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (e ? '  → ' + e : '')); } };
const fs = require('fs');
const path = require('path');
const SV = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');

// 取真实函数体：先跳过形参表再配对花括号，并跳过字符串里的花括号
function fnBody(src, name) {
  const a = src.search(new RegExp('^(async\\s+)?function ' + name + '\\(', 'm'));
  if (a < 0) return '';
  let p = src.indexOf('(', a), pd = 0, k = p;
  for (; k < src.length; k++) {
    if (src[k] === '(') pd++;
    else if (src[k] === ')') { pd--; if (pd === 0) break; }
  }
  const open = src.indexOf('{', k);
  if (open < 0) return '';
  let d = 0, inStr = null;
  for (let j = open; j < src.length; j++) {
    const ch = src[j];
    if (inStr) { if (ch === inStr) inStr = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === '{') d++;
    else if (ch === '}') { d--; if (d === 0) return src.slice(a, j + 1); }
  }
  return '';
}
// hw 轮：「已外发过」判据收口到 pushIsOutStatus，沙箱必须把它的源码一起编译进去
const PIS_SRC = (() => { const i = SV.indexOf('function pushIsOutStatus(st) {'); if (i < 0) return ''; const j = SV.indexOf('\nfunction ', i + 1); return SV.slice(i, j > 0 ? j : SV.length); })();
if (!PIS_SRC) throw new Error('未找到 pushIsOutStatus（沙箱会静默失效，必须显式炸出来）');
const BODY_PT = fnBody(SV, 'pushedToday');
const BODY_MR = fnBody(SV, 'mailReady');

// 本地口径的日期键（与项目 todayStr / dayKeyOf 同为 YYYYMMDD 本地时间）
const dayKeyOf = ts => {
  const d = new Date(ts);
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
};
const mkPT = (log) => new Function('PUSH_LOG', 'todayStr', 'dayKeyOf', 'console',
  PIS_SRC + '\n' + BODY_PT + '\nreturn pushedToday;')(log, () => dayKeyOf(Date.now()), dayKeyOf, { error() {} });
// 造一份「没加兜底」的旧判据：只剥掉那行代码（注释里提到"未发送"的保留）
// hw 轮：兜底那行现在住在 pushIsOutStatus 里 —— 要剥的是**它**，不是 pushedToday 本身
const PIS_SRC_OLD = PIS_SRC.split('\n')
  .filter(l => !(l.trim().indexOf('//') !== 0 && l.indexOf('未发送') >= 0)).join('\n');
const BODY_PT_OLD = BODY_PT;   // pushedToday 本身不动（它只是把判据委托出去）
const mkPTOld = (log) => new Function('PUSH_LOG', 'todayStr', 'dayKeyOf', 'console',
  PIS_SRC_OLD + '\n' + BODY_PT + '\nreturn pushedToday;')(log, () => dayKeyOf(Date.now()), dayKeyOf, { error() {} });

console.log('\n【⛔⛔ 自检】');
{
  ok('自检：pushedToday 抠得出来', BODY_PT.length > 100, String(BODY_PT.length));
  ok('自检：mailReady 抠得出来', BODY_MR.length > 60, String(BODY_MR.length));
  const today = Date.now();
  const real = [{ ts: today, status: '✅ 已送达', title: '═══ 📊 每日复盘 ═══' }];
  ok('自检：真送达记录确实被判为"今天已发"',
    mkPT(real)(/每日复盘/) === true);
  ok('自检：昨天的送达记录不算今天的',
    mkPT([{ ts: today - 86400000, status: '✅ 已送达', title: '═══ 📊 每日复盘 ═══' }])(/每日复盘/) === false);
  ok('自检：被闸门拦下的不算送达',
    mkPT([{ ts: today, status: '🚫 条数闸门', title: '═══ 📊 每日复盘 ═══' }])(/每日复盘/) === false);
}

console.log('\n【① 试算(dry) 不许留下"送达证据"】');
{
  ok('⛔ dry 那条流水的状态不再以 ✅ 开头',
    !/pushLog\('✅[^']*dry[^']*'/.test(SV), (SV.match(/pushLog\('[^']*dry[^']*'/) || [''])[0]);
  ok('dry 改用了 🧪 之类"不是送达"的标记', /pushLog\('🧪[^']*'/.test(SV));
  // hw 轮：兜底从 pushedToday 内联的那一句**收口到 pushIsOutStatus**（与 pushLog 同一把尺子），
  //   所以判据改为「pushedToday 走这个共享判据」+「共享判据里确实有那句兜底」两件事都成立。
  ok('⛔ pushedToday 走共享判据 pushIsOutStatus（不许两把尺子分叉）',
    /pushIsOutStatus\(/.test(BODY_PT), BODY_PT.replace(/\s+/g, ' ').slice(0, 120));
  const _pisNoSend = PIS_SRC.split('\n').filter(l => l.trim().indexOf('//') !== 0 && l.indexOf('未发送') >= 0);
  ok('⛔ 共享判据里有「含未发送即不算」的兜底（防以后再写错一次）',
    _pisNoSend.length >= 1, PIS_SRC.replace(/\s+/g, ' ').slice(0, 160));
}

console.log('\n【② 真跑：试算记录不许被当成已送达】');
{
  const today = Date.now();
  const dry = [{ ts: today, status: '🧪 试算完成(未发送)', title: '═══ 📊 每日复盘 ═══' }];
  ok('⛔ 只有试算记录 → 判"今天没发过"（真复盘还能补推）',
    mkPT(dry)(/每日复盘/) === false);
  // 反向：把兜底剥掉再跑同一条旧文案 —— 它确实会被误判成送达，证明上面这条断言不是白写的
  // hw 轮：被剥的是共享判据 pushIsOutStatus 里的那行（pushedToday 只是委托方，本身不动）
  ok('反向沙箱：旧判据确实剥掉了兜底那行', PIS_SRC_OLD.length < PIS_SRC.length);
  const oldDry = [{ ts: today, status: '✅ 计算完成(dry 未发送)', title: '═══ 📊 每日复盘 ═══' }];
  ok('反向验证：去掉兜底后，旧文案会被误判成"已送达" → 所以兜底必须写',
    mkPTOld(oldDry)(/每日复盘/) === true);
  ok('⛔ 现行实现拦得住旧文案（含"未发送"一律不算送达）',
    mkPT(oldDry)(/每日复盘/) === false);
}

console.log('\n【③ 邮箱「可用」只有一把尺子】');
{
  ok('存在唯一的 mailReady()', /^function mailReady\(\)/m.test(SV));
  ok('⛔ mailReady 要求 user + authCode + to 三项齐全',
    /m && m\.user && m\.authCode && m\.to/.test(BODY_MR), BODY_MR.replace(/\s+/g, ' '));
  // ⛔ 不再有别处自己写一遍（写一遍漏一半 = 面板说配好了、发的时候当没配）
  const adHoc = (SV.match(/S\.config\.qqMail\s*&&\s*S\.config\.qqMail\.user\s*&&\s*S\.config\.qqMail\.authCode/g) || []).length;
  ok('⛔ 不再有漏掉 to 的临时判据', adHoc === 0, String(adHoc));
  const adHoc2 = (SV.match(/&&\s*_q\.user\s*&&\s*_q\.authCode\s*&&\s*_q\.to/g) || []).length;
  ok('找回密码那处也改用同一入口', adHoc2 === 0, String(adHoc2));
  ok('pushAll 的 _mailOn 用 mailReady()', /const _mailOn = mailReady\(\);/.test(SV));
  ok('/api/state 的 mailReady 用同一入口', /mailReady: mailReady\(\),/.test(SV));
  ok('/api/config 返回的 mailReady 用同一入口', /mailReady: mailReady\(\), feishuMask/.test(SV));
}

console.log('\n【④ 真跑 mailReady】');
{
  const mk = cfg => new Function('S', BODY_MR + '\nreturn mailReady();')({ config: cfg });
  ok('三项齐全 → 可用', mk({ qqMail: { user: 'a@b.com', authCode: 'x', to: 'c@d.com' } }) === true);
  ok('⛔ 缺收件人 to → 不可用（这是以前漏掉的那一条）',
    mk({ qqMail: { user: 'a@b.com', authCode: 'x', to: '' } }) === false);
  ok('缺授权码 → 不可用', mk({ qqMail: { user: 'a@b.com', authCode: '', to: 'c@d.com' } }) === false);
  ok('整块没配 → 不可用', mk({}) === false);
}

console.log('\n【⑤ 自检结论不许谎报"推送发不出去"】');
{
  // ⛔ 只查「代码行」—— 注释里回顾历史是可以的，代码里再这么写就是谎报
  const _pus = SV.split('\n').filter(l => l.indexOf('推送发不出去') >= 0);
  const _pusCode = _pus.filter(l => l.trim().indexOf('//') !== 0 && l.trim().indexOf('*') !== 0);
  ok('⛔ 不再有只看飞书就断言"推送发不出去"的代码（注释除外）',
    _pusCode.length === 0, _pusCode[0] ? _pusCode[0].slice(0, 80) : '');
  ok('飞书与邮箱都没配 → 说"两条都没配"', /两条通道都没配好/.test(SV));
  ok('⛔ 只有飞书没配 → 说清"仅邮箱可用"（不能直接判死）', /当前仅邮箱通道可用/.test(SV));
  ok('pushAll 的「未配置通道」判据也走 mailReady', /if \(!feishuReady\(\) && !mailReady\(\)\)/.test(SV));
  ok('未配置通道的提示写清了邮箱要三项齐全', /账号\+授权码\+收件人/.test(SV));
}

console.log(`\n【结果】通过 ${pass} 项，失败 ${fail} 项`);
console.log(fail === 0 ? 'RESULT: OK' : 'RESULT: FAIL');
process.exit(fail === 0 ? 0 : 1);
