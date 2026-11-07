// 守门测试：测试代码与生产数据的隔离边界（2026-10-07，本轮新角度）
//
// 前面所有轮次盯的都是「产品代码写得对不对」，这一轮盯的是另一头：
// **那些用来验证产品的脚本，自己会不会污染产品的数据。**
//
// 事情是这样暴露的：我跑 _test_hold2.js 查一个偶发红灯，顺手看到线上持仓变成 0 条，
// 第一反应是「数据丢了」，差点就从备份里还原 —— 而那三条其实**是用户自己刚删的**，
// 而且本来就是测试脚本造出来的残留（用户当场纠正：「我删的，你总是还原干什么」）。
// 顺着这条线查下去，测试脚本对真实服务的写操作问题比想象中大：
//
//   ① _test_sync.js 的每一步 add/update/tags/setlocked/remove **都没带 _noSync**
//      → 每次跑这个套件都把「同步测试 999999」推到线上改五遍；
//   ② 更要命的是它的收尾 `purgeOps` 带 **remote:true** —— 会把**线上**那份
//      持仓变更流水整份清空，用户自己在手机上做的增删改记录被一起抹掉，事后完全查不到；
//   ③ _test_role.js 那句「只读越权试探」没带 _noSync —— 正常分支会被拒不会写，
//      但**万一鉴权哪天被改坏**，断言失败的同时顺手就把票写进了真实持仓并同步上线；
//   ④ _test_hold2.js 的 action:'tags' 漏了 _noSync（同一类）；
//   ⑤ _test_otp.js 走 reset-pwd 会当场签发长期设备令牌进台账，跑完从不清理
//      → 用户打开「授权设备」看到一堆不认识的设备（2026-10-03「那些 N 台都是我的吗」的来源之一）。
//
// 这类问题的共同点：**测试脚本把"能连上真实服务"当成了"这是沙箱"**。
// 本机是 replica，写操作会经 syncUpstream 转发到线上，所以本机 ≠ 沙箱。
//
// 本测试把这条边界钉死：凡是对真实服务的写调用必须隔离，清流水不许连带线上，
// 签发设备令牌的套件必须自己把台账清干净。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

const REAL_EP = /127\.0\.0\.1|localhost(?::\d+)?|quant-dashboard-77614|ONLINE\s*=/;
// 会改变持仓（并可能被转发到线上）的动作
const WRITE_ACTS = new Set(['add', 'remove', 'removeMany', 'clear', 'lock', 'unlock',
  'update', 'tags', 'setlocked', 'setmute', 'capital', 'cost', 'note', 'purgeOps']);

const files = fs.readdirSync(ROOT).filter(f => /^_test_.*\.js$/.test(f));
const srcOf = {};
for (const f of files) srcOf[f] = fs.readFileSync(path.join(ROOT, f), 'utf8');
const SELF = '_test_test_isolation.js';

// ⛔ 老坑（2026-10-07 又踩一次）：注释里写的 `action:'clear'` 会被当成真的写调用。
//    扫结构之前必须先把行注释剥掉；`http://` 里的 // 不能当注释开头（前一个字符是冒号），
//    斜杠落在字符串里也不能切（看前面单引号是不是奇数个）。
function stripComments(src) {
  return src.split('\n').map(line => {
    let from = 0;
    for (;;) {
      const i = line.indexOf('//', from);
      if (i < 0) return line;
      if (line[i - 1] === ':') { from = i + 2; continue; }        // http://
      const q = (line.slice(0, i).match(/'/g) || []).length;
      if (q % 2 === 1) { from = i + 2; continue; }                 // // 在字符串里
      return line.slice(0, i);
    }
  }).join('\n');
}
const codeOf = {};
for (const f of files) codeOf[f] = stripComments(srcOf[f]);
// 只查会连真实服务的那些
const touching = files.filter(f => REAL_EP.test(srcOf[f]));

group('[0] 先确认这套检查真的扫到了东西（空转的守门等于没有）');
{
  ok('扫到会连真实服务的守门测试 ' + touching.length + ' 个', touching.length >= 5, touching.join(','));
  ok('其中确实包含 _test_sync.js 与 _test_hold2.js',
    touching.includes('_test_sync.js') && touching.includes('_test_hold2.js'));
}

group('[1] ⛔ 对真实服务的持仓写调用必须带 _noSync');
{
  // 白名单：人工复核后确认「就是要真同步」或「写不进去」的
  const ALLOW = {
    '_test_no_test_holdings.js': '它自己就是查"有没有残留测试票"的，removeMany 带 _noSync；purgeOps 不带 remote 故不清线上',
  };
  const spreadOk = (src, name) => new RegExp('const\\s+' + name + '\\s*=\\s*\\{\\s*_noSync:\\s*true').test(src);
  let checked = 0; const bad = [];
  for (const f of touching) {
    const src = codeOf[f];
    if (ALLOW[f] || f === SELF) continue;   // 本文件只做静态扫描，下面的反证正则里必然出现这些字面量
    const re = /action:\s*'([A-Za-z]+)'/g;
    let m;
    while ((m = re.exec(src))) {
      const act = m[1];
      if (!WRITE_ACTS.has(act)) continue;
      if (act === 'purgeOps') continue;                 // 单独在第 [2] 组查
      // ⛔ dg 轮升级：purgeRemote() 是本套件**显式连线上清残留**的出口，它走的是线上直连，
      //    本来就没有 _noSync 的语义（_noSync 管的是"本机写操作要不要转发线上"）。
      //    但它必须受下面【远程清理边界】那几条更严的判据约束，不是开了个口子就算了。
      const prA = src.indexOf('async function purgeRemote');
      const prB = prA >= 0 ? src.indexOf('\n}', prA) : -1;
      if (prA >= 0 && m.index > prA && m.index < prB) continue;
      const win = src.slice(m.index, m.index + 400);
      const direct = /_noSync:\s*true/.test(win);
      const sp = win.match(/\.\.\.\s*([A-Za-z_$][\w$]*)/);
      const spread = !!(sp && spreadOk(src, sp[1]));
      checked++;
      if (!direct && !spread) bad.push(f + ' → action:' + act);
    }
  }
  ok('⛔ 全部持仓写调用都带了 _noSync（共查 ' + checked + ' 处）', bad.length === 0, bad.join(' | '));
  // 逐点钉死本轮修的那四处，避免以后被改回去
  ok('⛔ _test_hold2.js 的 action:tags 也带了（2026-10-07 补）',
    /action: 'tags', code: '600519'[^)]*_noSync: true/.test(srcOf['_test_hold2.js']));
  ok('⛔ _test_role.js 的越权试探也带了（万一鉴权坏了不许写进真实持仓）',
    /token: vtok, action: 'add'[^)]*_noSync: true/.test(srcOf['_test_role.js']));
  ok('⛔ _test_sync.js 的六个步骤全部带了',
    (srcOf['_test_sync.js'].match(/\.\.\._ns/g) || []).length >= 7,
    '实际 ' + (srcOf['_test_sync.js'].match(/\.\.\._ns/g) || []).length + ' 处（6 步 + 收尾 remove）');
  ok('⛔ _test_sync.js 的 _ns 确实是 { _noSync: true }', /const _ns = \{ _noSync: true \}/.test(srcOf['_test_sync.js']));
  // 反证
  ok('反证：旧写法（不带 _noSync）应当判不合格',
    !/_noSync/.test("{ action: 'add', item: { code: '999999', cost: 10, shares: 100 } }"));
  // 把自己排除在外，就得证明自己确实不写：本扫描器不产生任何 HTTP 写请求
  ok('⛔ 本扫描器自己只是读文件，不向任何服务发写请求（所以可以排除自身）',
    !/http\.request\(|https\.request\(|fetch\(\s*['"]http/.test(srcOf[SELF]));
}

group('[2] ⛔ 清流水不许连带线上（remote:true 会抹掉用户真实的变更记录）');
{
  const bad = [];
  for (const f of files) {
    if (f === SELF) continue;              // 同上：本文件的反证字符串里就有这句
    const src = codeOf[f];
    const re = /action:\s*'purgeOps'/g;
    let m;
    while ((m = re.exec(src))) {
      const win = src.slice(m.index, m.index + 200);
      if (/remote:\s*true/.test(win)) {
        const prA = src.indexOf('async function purgeRemote');
        const prB = prA >= 0 ? src.indexOf('\n}', prA) : -1;
        // 只有「清完自己造的残留之后，顺手把线上的测试流水也清掉」这一处允许 remote
        if (!(prA >= 0 && m.index > prA && m.index < prB)) bad.push(f);
      }
    }
  }
  ok('⛔ 没有任何一处 purgeOps 带 remote:true', bad.length === 0, bad.join(','));
  ok('⛔ _test_sync.js 收尾那句已不再 remote', !/purgeOps', remote: true/.test(srcOf['_test_sync.js']));
  // 反证
  ok('反证：带 remote:true 的旧写法应当判不合格', /remote:\s*true/.test("{ action: 'purgeOps', remote: true }"));

  // ── dg 轮新增：既然开了「连线上清残留」这个口子，边界就得钉死 ──────────────
  //    否则「清残留」随时会变成「删用户持仓」的合法通道（比不开这个口子更危险）。
  const h2 = srcOf['_test_hold2.js'] || '';
  const pA = h2.indexOf('async function purgeRemote');
  const prSrc = pA >= 0 ? h2.slice(pA, h2.indexOf('\n}', pA)) : '';
  ok('⛔ 远程清理函数存在（不然线上残留永远清不掉）', pA >= 0);
  ok('⛔ 远程清理先拉列表、只保留带 TEST_NOTE 的那部分', /=== TEST_NOTE/.test(prSrc) && /\.filter\(/.test(prSrc));
  ok('⛔ 远程清理的 remove 只对 filter 出来的项执行（不许无条件删）',
    /for \(const it of mine\)[\s\S]{0,160}action: 'remove', code: it\.code/.test(prSrc));
  ok('⛔ 先删残留再清流水（顺序反了会把用户流水抹掉）',
    prSrc.indexOf("action: 'remove'") > 0 && prSrc.indexOf("action: 'remove'") < prSrc.indexOf("action: 'purgeOps'"));
  ok('⛔ 线上清理只在收尾调用一次', (h2.match(/await purgeRemote\(/g) || []).length === 1);
  ok('⛔ 远程清理前先确认 syncUpstream 已配置（没配就不打网络）',
    /if \(!su\.enabled \|\| !su\.url \|\| !su\.token\) return/.test(prSrc));
}

group('[3] ⛔ 会签发设备令牌的套件，必须自己把台账清干净');
{
  // verify-code / reset-pwd / trust / unlock 会往设备台账里加记录，跑完不撤 = 用户看到一堆不认识的设备
  // ⚠️ 判据必须是「真的 POST 了」：不少套件只是把路径当字符串去扫白名单（_test_auth_matrix.js 就
  //    是），按「出现过路径」判会误伤，误伤一多这个守门就会被当成噪音拆掉。
  const POST_RE = /['"]POST['"]\s*,\s*['"]\/api\/(?:lock|auth)\/(trust|unlock|reset-pwd|verify-code|setup|redeem)['"]/g;
  const risky = files.filter(f => f !== SELF && POST_RE.test(srcOf[f]));
  POST_RE.lastIndex = 0;
  ok('扫到会真的签发/登记设备的套件 ' + risky.length + ' 个', risky.length >= 2, risky.join(','));
  const bad = [];
  for (const f of risky) {
    if (!/revoke/.test(srcOf[f])) bad.push(f);
  }
  ok('⛔ 每个都带有撤销动作（revoke）', bad.length === 0, bad.join(','));
  ok('⛔ 只把路径当字符串扫白名单的（_test_auth_matrix.js）不算签发者',
    !risky.includes('_test_auth_matrix.js') && !risky.includes('_test_otp_noise.js'));
  ok('⛔ _test_otp.js 收尾撤掉 reset-pwd 签出去的令牌',
    /本套件签发的设备|revoke/.test(srcOf['_test_otp.js']));
  ok('⛔ 且撤销用的是令牌摘要算出的 id（与 _test_role.js 同款）',
    /createHash\('sha256'\)\.update\(String\(t\)\)/.test(srcOf['_test_otp.js']));
  // 反证：只签发不清理的写法应当判不合格
  ok('反证：只签发、不 revoke 的写法应当判不合格', !/revoke/.test("const v = await req('POST','/api/lock/reset-pwd',{resetToken:rt});"));
}

group('[4] ⛔ 外发副作用：测试不许给真实手机号发验证码/推消息');
{
  // forgot / verify-code 会真发短信。测试若填了 11 位真实号码，跑一次就给用户手机推一条。
  // （用户 2026-10-02 抱怨过「两天 20 条验证码」，所以这条必须钉死。）
  const PH_RE = /phone:\s*['"]([^'"]+)['"]|TEST_PHONE\s*=\s*['"]([^'"]+)['"]/g;
  const realLike = [];
  let n = 0;
  for (const f of files) {
    const src = srcOf[f];
    let m; PH_RE.lastIndex = 0;
    while ((m = PH_RE.exec(src))) {
      const v = m[1] || m[2]; n++;
      if (/^1[3-9]\d{9}$/.test(String(v))) realLike.push(f + ' → ' + v);
    }
  }
  ok('⛔ 测试里出现的手机号都不是 11 位真实号码（共查 ' + n + ' 处）', realLike.length === 0, realLike.join(' | '));
  ok('⛔ 验证码套件用的确实是假号 1763448734',
    /1763448734/.test(srcOf['_test_otp.js']) && /1763448734/.test(srcOf['_test_otp2.js']));
  ok('⛔ 且注释里写明了「绝不为了跑通去改绑真实号码」', /绝不再调 bind-phone/.test(srcOf['_test_otp.js']));
  // 反证
  ok('反证：11 位真实号码应当判不合格', /^1[3-9]\d{9}$/.test('13800138000'));
}

group('[5] ⛔ 测试造的临时产物必须自己收走（不许往宿主环境里堆垃圾）');
{
  // _test_src_priv_channel.js 每次 mk() 都 mkdtempSync 一个沙箱目录却从不删 ——
  // 实测 2026-10-07 系统临时目录里堆了 530 个空的 srcpkg-*，全是跑测试跑出来的。
  const s = srcOf['_test_src_priv_channel.js'];
  ok('⛔ 造临时目录的套件会登记下来（TMPDIRS）', /const TMPDIRS = \[\]/.test(s));
  ok('⛔ 且跑完真的 rmSync 删掉（不是只登记）', /fs\.rmSync\(d, \{ recursive: true, force: true \}\)/.test(s));
  ok('⛔ 删除动作在 exit 之前、且不被断言失败跳过', /rmSync[\s\S]{0,200}?process\.exit/.test(s));
  // 反证
  ok('反证：只造不删的写法应当判不合格', !/rmSync/.test("const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcpkg-'));"));
}

group('[6] ⛔⛔ 测试清理只许删自己造的，不许删开跑前就存在的（真票）');
{
  // 本轮最严重的一条：_test_hold2.js 用 600519/000001/300750 三只**真票**做一键锁仓
  // （换 999999 取不到价，测不了），收尾却是无条件 remove 这三只。
  // _test_no_test_holdings.js 里白纸黑字写着「不能把这类真票算进测试码 —— 用户真的可能持有它们」。
  // 也就是说：**谁手上真持有茅台，跑一次测试就被删掉**；_noSync 之前还会一路删到线上。
  // ⛔⛔ 2026-10-08 升级判据（本轮实测事故，比上面"只按 PRE 跳过"再严一层）：
  //    光看 PRE 是不够的 —— PRE 取的是**当前**持仓，上一轮没删干净的残留会进入这一轮的 PRE，
  //    于是残留被当成"用户真实持仓"永远跳过，而线上一重启又从发布包里把残留复活，
  //    表现为"删完一次又变回 3 条"。真正的判据是**标记**：测试造的东西一律打 TEST_NOTE，
  //    收尾只删带标记的；没有标记的 = 用户真票，一律不碰。
  //    ⛔ 守门也得照这个改：钉语义（只删带标记的），不钉旧的 PRE.has 字面量。
  const s = srcOf['_test_hold2.js'];
  // ⛔ dg 轮升级：PRE 从 Set 改成 Map（要按 note 区分「上一轮残留」与「用户真实持仓」）——
  //    用 Set 时残留会被算进「开跑前就有的」而永久跳过，正是 db 轮事故越积越多的根因。
  ok('⛔ 收尾删除前先快照开跑前已有的持仓（要带 note，不能只记代码）', /const PRE = new Map\(/.test(s));
  ok('⛔ 测试造的东西一律打标记（TEST_NOTE）', /const TEST_NOTE = '__hold2_test__';/.test(s));
  ok('⛔ 有一处按标记识别「是不是自己造的」', /const isMine = it => it && String\(it\.note \|\| ''\) === TEST_NOTE;/.test(s));
  ok('⛔ 删除循环里无标记的（= 用户真票）直接跳过', /if \(!isMine\(it\)\)[\s\S]{0,160}?continue/.test(s));
  ok('⛔ 删除用例（300750）也用了同一把判据', /const mayDel = isMine\(p300\);/.test(s));
  // ⛔ dg 轮升级：「原有的原样保留」只核【无标记】的那部分 ——
  //    带标记的残留本来就该被清掉，算进「开跑前就有的」会让这条断言永远红。
  ok('⛔ 收尾断言改成「自己造的没了 + 无标记的原样保留」，不再断言归零',
    /preRealKept\.length === PRE_REAL\.length/.test(s) && !/\(fin\.items \|\| \[\]\)\.length === 0/.test(s));
  // 锁仓计数：先按「不在 PRE 里」筛，结果残留一出现就恒为 0 → 偶发红灯（不是产品问题）。
  //    改成只看本轮真正锁的那两只（MY_LOCK），与开跑前有没有残留无关 —— 守门要能重复跑。
  ok('⛔ 锁仓计数只看本轮锁的那两只（不依赖上次跑没跑干净）', /MY_LOCK\.indexOf\(String\(x\.code\)\)/.test(s));
  ok('⛔ 且没有退回「按 PRE 之外计数」的老写法', !/x\.locked && !PRE\.has\(x\.code\)/.test(s));
  ok('⛔ 且没有退回「按 PRE 判断该不该删」的老写法（死代码也要清掉，留着会被后人捡回去）',
    !/addedByMe/.test(s));
  // 反证
  ok('反证：无条件删除的旧写法应当判不合格',
    !/PRE/.test("for (const c of ['600519','000001']) await post('/api/holdings',{action:'remove',code:c});"));
}

group('[7] 隔离判据本身没被绕过（防止有人为了变绿直接删判据）');
{
  const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  ok('⛔ _noSync 的语义仍是「跳过上游转发」，没被改成跳过 SSE 广播',
    /if \(r && r\.ok\) \{ kick\(\); if \(!b\._noSync\) syncUpstream\('/.test(SV));
  ok('⛔ purgeOps 仍然只有 remote===true 才转发线上',
    /if \(b\.remote === true\) syncUpstream\('/ .test(SV) || /if \(b\.remote === true\) syncUpstream\('/g.test(SV));
  ok('⛔ 本机副本身份没被改成 primary（否则测试写的东西会真的外发推送）',
    /pushRole['"]?\s*[:=]\s*['"]?replica|isReplica\(\)/.test(SV));
}

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
