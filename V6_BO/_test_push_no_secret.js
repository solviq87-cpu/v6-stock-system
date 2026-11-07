// 守门测试：源码与密码不得推送（2026-10-02 用户明确要求）
// 「以后股票信息推送到飞书群大有可为，注意源码和密码不要推送」
// 行情类信息照推不误；本项目禁止的是【源码包】【开发者/观看密码明文】出网。
// 三层防护都在这里验：①业务层不再写明文 ②出网闸门兜底打码 ③会泄露的脚本默认拒绝执行。
const fs = require('fs');
const { execFileSync } = require('child_process');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('✅ ' + m)) : (fail++, console.log('❌ ' + m)); };
const SV = fs.readFileSync(__dirname + '/server.js', 'utf8');
// ⚠️ 别加引号：execFileSync 的第一个参数就是可执行文件路径，加引号会被当成文件名的一部分
const PY = 'C:/Users/28957/.workbuddy/binaries/python/versions/3.13.12/python.exe';

(async () => {
  console.log('=== A. 业务层：密码卡片不得再含明文 ===');
  const fnStart = SV.indexOf('async function sendPwdCard');
  const fn = SV.slice(fnStart, SV.indexOf('// 允许在线编辑的源码清单', fnStart));
  ok(fn.length > 100, '能取到 sendPwdCard 源码');
  ok(!/emphasis_content:\s*\{\s*title:\s*devPwd/.test(fn), '卡片标题不再是密码本体 devPwd');
  ok(!/\$\{devPwd\}/.test(fn), '卡片文案里不再插值 ${devPwd}');
  ok(!/观看密码[：:]\s*\$\{viewTxt\}/.test(fn), '不再明文推送观看密码');
  ok(!/value:\s*viewTxt/.test(fn), '卡片字段里不再出现 viewTxt');
  ok(/redactSecrets\(fallback\)/.test(fn), '纯文本兜底也经过 redactSecrets');
  ok(!/开发者密码[：:]\s*\$\{devPwd\}/.test(SV), 'server.js 全文无「开发者密码：${devPwd}」');

  console.log('\n=== B. 出网闸门 redactSecrets 行为 ===');
  // ⚠️ 锚点必须带左括号：server.js 里先出现了 pushLogFlush，"function pushLog" 会命中它，
  //    导致切片区间反向、拿到空串（实测踩过）。
  const gi = SV.indexOf('const SECRET_LINE_RE');
  const guardSrc = SV.slice(gi, SV.indexOf('function pushLog(', gi));
  let redact = null;
  try {
    redact = new Function(guardSrc + '\nreturn redactSecrets;')();
    ok(typeof redact === 'function', '能从 server.js 抽出 redactSecrets 真跑');
  } catch (e) {
    ok(false, '抽出 redactSecrets 失败：' + e.message + '（切片长度 ' + guardSrc.length + '）');
  }
  if (typeof redact === 'function') {
    const t1 = redact('🔓 开发者密码：Abc123xy\n这是正文');
    ok(t1.indexOf('Abc123xy') < 0 && /\*\*\*\*/.test(t1), '开发者密码被打码 → ' + JSON.stringify(t1));
    // ⚠️ 夹具一律用假串，绝不写真口令（2026-10-02 自查踩到：一开始手滑写了真实历史口令，
    //    那段体检 todo 的性质就变成"把口令写进版本库"了 —— 正是本项目要躲的事）
    const t2 = redact('👁 观看密码：Xy7fA2Qm');
    ok(t2.indexOf('Xy7fA2Qm') < 0, '观看密码被打码 → ' + JSON.stringify(t2));
    const t3 = redact('🔑 token: e4_e652cc112ec6b4493');
    ok(t3.indexOf('e4_e652cc') < 0, '设备令牌被打码 → ' + JSON.stringify(t3));
    const t4 = redact('🔐 找回验证码 482913（10分钟有效）');
    ok(t4.indexOf('482913') >= 0, '验证码不受影响（找回流程靠它，保持可用）');
    const normal = '▪ 中岩大地(003001) 评分82 现价26.51 (+10.00%)\n  八字 73分｜趋势100·资金70·位置50·承接60';
    ok(redact(normal) === normal, '正常行情文案零误伤（原样返回）');
    ok(redact('') === '', '空串不炸');
  }

  console.log('\n=== C. pushAll 必须接到闸门上 ===');
  // ⛔ 2026-10-27：旧写法只取函数头 400 字符 —— 函数里一加中文注释就把闸门顶出窗口，
  //    报出来的却是「闸门没了」（假红）。改成括号配平取全函数体 + 剥注释，钉语义不钉字距。
  const pi = SV.indexOf('function pushAll(');
  const pa = (() => {
    if (pi < 0) return '';
    let d = 0, j = SV.indexOf('{', pi), k = j;
    for (; k < SV.length; k++) { if (SV[k] === '{') d++; else if (SV[k] === '}') { d--; if (d === 0) break; } }
    return SV.slice(pi, k + 1).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  })();
  ok(/text = redactSecrets\(text\);/.test(pa), 'pushAll 第一行就把文本过闸门');
  {
    const g = pa.indexOf('text = redactSecrets(text)');
    const b = pa.indexOf('if (isReplica()');
    ok(g >= 0 && b > g, '打码发生在副本拦截/外发之前（顺序反了等于没闸）', `gate@${g} blocker@${b}`);
  }

  console.log('\n=== D. 会外泄的脚本必须默认拒绝执行 ===');
  // ⚠️ 沙箱里 Node spawn 外部进程可能返回 EBUSY（本环境限制，非脚本问题）。
  //    这种情况下退回静态断言：文件里必须存在「默认拒绝」的闸门代码。
  function runOut(exe, args) {
    try { return { ran: true, out: execFileSync(exe, args, { cwd: __dirname, encoding: 'utf8', env: { ...process.env, QD_ALLOW_SECRET_PUSH: '', QD_ALLOW_SRC_PUSH: '', PYTHONIOENCODING: 'utf-8' } }) }; }
    catch (e) { return { ran: e.code !== 'EBUSY', out: String(e.stdout || '') + String(e.stderr || '') , code: e.code }; }
  }
  for (const f of ['_push_phone.py', 'send_backup_wecom.py']) {
    const src = fs.readFileSync(__dirname + '/' + f, 'utf8');
    const r = runOut(PY, [f]);
    if (r.ran) {
      ok(/已阻止/.test(r.out), `${f} 真跑被闸门拦下`);
    } else {
      const head = src.slice(0, src.indexOf('import json'));
      ok(/SystemExit/.test(head) && /QD_ALLOW_(SECRET|SRC)_PUSH/.test(head),
        `${f} 含默认拒绝开关（静态断言，沙箱禁 spawn：${r.code}）`);
    }
  }

  console.log('\n=== E. Git 红线：含口令的文件不得入库 ===');
  // ⚠️ Node 在 Windows 上解析不了 Git Bash 的 /mingw64/bin/git（那是个 POSIX 路径），
  //    spawn 直接 ENOENT。必须落到真实 git.exe，找不到时退回静态检查。
  function gitExe() {
    const cand = [
      process.env.GIT_EXE,
      'C:/Users/28957/.workbuddy/binaries/PortableGit/versions/1.2.0/mingw64/bin/git.exe',
      'C:/Program Files/Git/cmd/git.exe'
    ];
    for (const c of cand) if (c && fs.existsSync(c)) return c;
    return null;
  }
  const GE = gitExe();
  const GI = fs.readFileSync(__dirname + '/.gitignore', 'utf8').split(/\r?\n/).map(x => x.trim());
  // 静态回退：.gitignore 里必须有精确文件名的一行（这些条目都是精确名，不是通配）
  const inGitignore = f => GI.some(l => l === f || l === f + '/');
  let mode = '静态', GE_OK = !!GE;
  for (const f of ['_publish.py', '_post_publish.py', '_restore_local.py', '_push_phone.py', '_build_zip.py', '_test_otp.js', '_test_role.js', 'config.json', 'holdings.json']) {
    let ignored = inGitignore(f);
    if (GE) {
      try { execFileSync(GE, ['check-ignore', '-q', f], { cwd: __dirname }); ignored = true; mode = 'git check-ignore'; }
      catch (e) { if (e.code === 'EBUSY') { GE_OK = false; } else { ignored = false; } }
    }
    ok(ignored, `${f} 已被拦在版本库外`);
  }
  console.log(`   · 校验方式：${mode}${GE && !GE_OK ? '（沙箱禁 spawn，已回退静态）' : ''}`);

  console.log(`\n=== 汇总：通过 ${pass} 项，失败 ${fail} 项 ===`);
  process.exit(fail ? 1 : 0);
})();
