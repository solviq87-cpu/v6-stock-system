// 守门测试：源码包只走私密通道（2026-10-05 用户要求「私密通道可以同步发源码」）
// ⛔ 红线：源码包链接【永不发群机器人、永不发邮箱】。
//    - 没配私密通道 → 存下来但一个字都不外发（宁可没有，也不能落进群里被转发）
//    - 私密机器人发失败 → 记流水 + 报错，也【不许】退回群机器人
//    - 下载令牌随机、只对得上才给文件；上传必须过 requireEditor
// 手法：把 server.js 里那段实现原样抠进沙箱真跑，不是对着源码做字符串断言。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('✓ ' + m)) : (fail++, console.log('✗ ' + m)); };
const sec = t => console.log('\n' + t);

const SV = fs.readFileSync(__dirname + '/server.js', 'utf8');
const HTML = fs.readFileSync(__dirname + '/public/index.html', 'utf8');

// ── 抠出真实实现（改了 server.js 这里立刻跟着变）────────────────────────────
const START = SV.indexOf("const SRCPKG_DIR = path.join(__dirname, '.srcpkg');");
// ⚠️ 结束锚点必须是「世代号」那个注释：它紧跟在 _hmac 之后，也就是本块的下一行
const END = SV.indexOf('// ── 设备令牌「世代号」', START);
const BLOCK = SV.slice(START, END);
ok(START > 0 && END > START && BLOCK.length > 500, '能抠到源码包实现块（' + BLOCK.length + ' 字符）');

// ⛔ 2026-10-07 补：mk() 每次都在系统临时目录 mkdtempSync 一个沙箱，跑完从不删 ——
//    实测已经堆了 530 个空的 srcpkg-* 目录。测试造的临时产物必须自己收走。
const TMPDIRS = [];
function mk(opts) {
  opts = opts || {};
  const calls = [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srcpkg-'));
  TMPDIRS.push(dir);
  const fn = new Function(
    // ⛔ 2026-10-07 补：块里新增了 pushedToday 判据（源码包同一天只推一次）。
    //    沙箱是 new Function 拼出来的，块里每多引用一个外部符号就必须同步补进这里，
    //    否则不是断言变红，而是**整个套件 ReferenceError 崩掉** —— 而 _runall 靠数 ✓ 兜底，
    //    打过几个 ✓ 就判绿，崩了照样算通过（实测：7 个 ✓ 之后崩，总榜显示全绿）。
    // ⛔ 2026-10-28 补：源码包块新增 isReplica 副本闸（链接含 token，副本一律不外发）——
    //    漏补这个符号 → 整个套件 ReferenceError，本次实测就是这条。
    'path', 'crypto', 'fs', 'isReplica', 'privReady', 'feishuProbe', 'feishuSecId', 'feishuSecMask', 'pushLog', 'S', '__dirname', 'pushedToday',
    BLOCK + '\nreturn { srcPkgShip, srcPkgUrl, srcPkgCard, SRCPKG_DIR };'
  );
  const M = fn(
    path, crypto, fs,
    () => !!opts.replica,
    () => !!opts.priv,
    async (id, sec, text) => {
      calls.push({ k: 'probe', id, sec, text });
      return opts.probeOk === false ? { ok: false, msg: '模拟发送失败' } : { ok: true };
    },
    () => 'SEC123', () => 'sec****123',
    (title, text, o) => calls.push({ k: 'log', title, o }),
    { config: { feishuSecSecret: 'SECKEY' } },
    dir,
    opts.pushed || (() => false)   // 默认「今天没推过」，要测当日闸门时由用例传入
  );
  return { M, calls, dir };
}
// PK 开头的假 zip（只验魔数，不需要真能解压）
const zipB64 = n => Buffer.concat([Buffer.from('PK\x03\x04', 'latin1'), crypto.randomBytes(n)]).toString('base64');
const probeCalls = c => c.filter(x => x.k === 'probe');

(async () => {
  sec('① 没配私密通道 → 存下了，但一个字都不外发');
  {
    const { M, calls, dir } = mk({ priv: false });
    const r = await M.srcPkgShip(zipB64(4096), '20261005af', '量化看盘平台_源码_20261005af_去凭据版.zip');
    ok(r && r.ok === true, '返回 ok（包确实存下来了）');
    ok(r.sent === false, 'sent=false —— 没有外发');
    ok(/未配置私密通道/.test(r.note || ''), '说清了原因：' + (r.note || ''));
    ok(probeCalls(calls).length === 0, '私密机器人一次都没调（没配就不可能发）');
    // ⛔ 关键：块里若出现 feishuSend / sendQQMail，new Function 里没有这两个符号 → 直接 ReferenceError
    //    所以"没炸"本身就证明它没有退回群机器人/邮箱
    ok(calls.some(x => x.k === 'log' && /源码包未外发/.test(x.title)), '流水里记了一条「未外发」，事后查得到');
    // ⚠️ 包落在 SRCPKG_DIR = <根>/.srcpkg 这个子目录里，不是根目录本身（踩过：读错目录恒为 0）
    ok(fs.readdirSync(M.SRCPKG_DIR).length === 1, '磁盘上确实落了 1 个包');
  }

  sec('② 配了私密通道 → 只发私密机器人，且只发一次');
  {
    const { M, calls } = mk({ priv: true });
    const r = await M.srcPkgShip(zipB64(4096), '20261005af', '量化看盘平台_源码_20261005af_去凭据版.zip');
    const p = probeCalls(calls);
    ok(r.sent === true, 'sent=true');
    ok(p.length === 1, '只发了 1 条（不是群里再补一条）');
    ok(p[0] && p[0].id === 'SEC123', '发的是私密机器人，不是群里那个');
    ok(p[0] && p[0].sec === 'SECKEY', '带上了私密通道的签名密钥');
    ok(/20261005af/.test((p[0] || {}).text || ''), '正文含版本号');
    ok(/量化看盘平台_源码_20261005af_去凭据版\.zip/.test((p[0] || {}).text || ''), '正文含文件名');
    ok(r.url && r.url.indexOf('/srcpkg/') > 0, '正文给出下载链接：' + r.url);
    ok(/只发你的私密机器人/.test((p[0] || {}).text || ''), '正文写明「只发你的私密机器人」');
    ok(calls.some(x => x.k === 'log' && /已送达\(私密\)/.test(x.title)), '流水记为私密送达');
  }

  // 2026-10-07：线上最近 30 条推送里 25 条是源码包（发版脚本每发一版推一条）→ 同一天只推一次。
  // 能力必须一点不少：链接照样生成、照样进面板流水，只是不再重复弹手机。
  sec('②b 今天已经推过源码包 → 不外发，但链接照给');
  {
    const { M, calls } = mk({ priv: true, pushed: () => true });
    const r = await M.srcPkgShip(zipB64(4096), '20261005cd', 'a.zip');
    ok(r.ok === true && r.sent === false, 'sent=false（没再弹一次手机）');
    ok(probeCalls(calls).length === 0, '私密机器人一次都没调');
    ok(r.url && r.url.indexOf('/srcpkg/') > 0, '下载链接照样给：' + r.url);
    ok(calls.some(x => x.k === 'log' && /源码包当日已推过/.test(x.title)), '流水里记了一条「当日已推过」');
    ok(/推送流水/.test(r.note || ''), '提示写明链接去面板流水里取：' + (r.note || ''));
  }

  // ⛔ 2026-10-28 新增：副本闸。源码包链接里带下载令牌，副本实例（本机/回收后的次实例）
  //    一旦外发就等于把源码下载权散出去。pushAll 内置的副本闸管不到 srcPkgShip 这条直连路径，
  //    所以它自己必须有一道。这里真跑：replica=true 时一次都不许外发，但包要存下来、链接要能看。
  sec('②c ⛔ 副本实例：包照存、链接照给，但一个字都不外发');
  {
    const { M, calls } = mk({ priv: true, replica: true });
    const r = await M.srcPkgShip(zipB64(4096), '20261028aa', 'a.zip');
    ok(r.ok === true && r.sent === false, 'sent=false（副本不外发）');
    ok(probeCalls(calls).length === 0, '私密机器人一次都没调');
    ok(r.url && r.url.indexOf('/srcpkg/') > 0, '下载链接照样给（面板可取）：' + r.url);
    ok(calls.some(x => x.k === 'log' && /副本拦截/.test(x.title)), '流水记了一条「副本拦截(不外发)」');
    ok(fs.readdirSync(M.SRCPKG_DIR).some(x => /\.zip$/.test(x)), '包确实落盘了（不是整个跳过）');
  }

  sec('③ ⛔ 私密发送失败 → 不许退回群机器人');
  {
    const { M, calls } = mk({ priv: true, probeOk: false });
    const r = await M.srcPkgShip(zipB64(4096), '20261005af', 'a.zip');
    ok(r.sent === false, 'sent=false');
    ok(/私密机器人发送失败/.test(r.error || ''), '把失败原因原样带回来：' + (r.error || ''));
    ok(probeCalls(calls).length === 1, '只试了私密一次（没有第二次补发）');
    // 同上：真退回群会 ReferenceError
    ok(calls.some(x => x.k === 'log' && /源码包发送失败/.test(x.title)), '流水记录了失败');
  }

  sec('④ 内容校验：不是 zip / 太小 / 超大 一律拒收');
  {
    const { M, calls } = mk({ priv: true });
    const bad1 = await M.srcPkgShip(crypto.randomBytes(4096).toString('base64'), 'v', 'a.zip');
    ok(bad1.ok === false && /不是有效的 zip/.test(bad1.error), '非 PK 头被拒：' + bad1.error);
    const bad2 = await M.srcPkgShip(Buffer.from('PK\x03\x04abc', 'latin1').toString('base64'), 'v', 'a.zip');
    ok(bad2.ok === false && /过小/.test(bad2.error), '小于 1KB 被拒：' + bad2.error);
    const bad3 = await M.srcPkgShip(zipB64(41 * 1024 * 1024), 'v', 'a.zip');
    ok(bad3.ok === false && /过大/.test(bad3.error), '大于 40MB 被拒：' + bad3.error);
    ok(probeCalls(calls).length === 0, '被拒的包一次都没往外发');
  }

  sec('⑤ 旧包只留最近 3 个（线上实例可能被回收，别堆一地）');
  {
    const { M } = mk({ priv: false });
    for (let i = 0; i < 5; i++) await M.srcPkgShip(zipB64(2048), 'v' + i, 'v' + i + '.zip');
    const left = fs.readdirSync(M.SRCPKG_DIR).filter(x => /^srcpkg-.*\.zip$/.test(x));
    ok(left.length === 3, '连传 5 个后只剩 3 个（实际 ' + left.length + '）');
  }

  sec('⑥ 路由接线：上传要过编辑权限，下载要令牌');
  ok(/p === '\/api\/srcpkg' && req\.method === 'POST'/.test(SV), '存在 POST /api/srcpkg 上传路由');
  {
    const i = SV.indexOf("p === '/api/srcpkg' && req.method === 'POST'");
    const seg = SV.slice(i, i + 700);
    ok(/requireEditor\(res, tok, req\)/.test(seg), '上传必须过 requireEditor（只读账号塞不进来）');
    ok(!/await srcPkgShip/.test(seg), '没有用 await（handle 不是 async，会直接语法错）');
    ok(/\.then\(r => json\(res, r\)\)/.test(seg), '用 Promise 链回填响应');
  }
  {
    // ⚠️ 锚点必须带 ") {" 收尾：门禁白名单里也写了 p.indexOf('/srcpkg/') === 0（以分号结尾），
    //    只搜前半截会命中白名单那行，切片取到的是门禁代码 → 三条断言齐红（实测踩到）。
    const i = SV.indexOf("if (p.indexOf('/srcpkg/') === 0) {");
    const seg = SV.slice(i, i + 700);
    ok(i > 0, '存在 /srcpkg/<token> 下载路由');
    ok(/tk !== v\.token/.test(seg), '令牌对不上直接 404');
    ok(/filename\*=UTF-8''/.test(seg), '中文文件名走 RFC5987（否则下载下来是乱码名）');
    ok(/Content-Type': 'application\/zip/.test(seg), '以 zip 类型下载');
  }
  {
    const i = SV.indexOf("p === '/api/srcpkg' && req.method === 'GET'");
    ok(i > 0, '存在 GET /api/srcpkg 状态查询');
    ok(!/token/.test(SV.slice(i, i + 320).split('has: true')[1] || ''), '状态接口不回传下载令牌');
  }
  ok(/token = crypto\.randomBytes\(18\)/.test(BLOCK), '令牌随机 18 字节（猜不出来）');
  {
    // ⛔ 血泪：跨设备门禁在 handle() 开头就把未知路径挡回 {locked:true}。
    //    飞书点链接是普通跳转，不带 token —— 不放行的话链接点开永远是"该设备需验证口令"。
    const gi = SV.indexOf("const isAuth = p === '/api/lock/status'");
    const gate = SV.slice(gi, SV.indexOf('if (!isAsset && !isAuth', gi));
    ok(gi > 0 && gate.length > 100, '能取到门禁白名单片段');
    ok(/\/srcpkg\//.test(gate), '/srcpkg/ 已在门禁白名单内（否则链接点开就被"需验证口令"挡了）');
  }
  ok(/buf\.length > 40 \* 1024 \* 1024/.test(BLOCK), '有 40MB 体积上限，防止把磁盘撑爆');

  sec('⑦ 发布脚本：只传【去凭据版】，绝不传含凭据的完整版');
  {
    const PP = fs.readFileSync(__dirname + '/_post_publish.py', 'utf8');
    const i = PP.indexOf('⑧ 源码包同步发到私密通道');
    ok(i > 0, '_post_publish.py 有第⑧步（发版后自动发源码包）');
    const seg = PP.slice(i, i + 1400);
    ok(/量化看盘平台_源码_去凭据版\.zip/.test(seg), '传的是去凭据版');
    ok(!/量化看盘平台_源码_%s\.zip/.test(seg), '不传含 config/access 的完整版');
    ok(/30 \* 1024 \* 1024/.test(seg), '上传前也卡一道体积上限');
    ok(/base64/.test(seg), '二进制走 base64（服务端 body 是字符串，直接塞二进制会乱码）');
    ok(/token["']?\s*:\s*tok/.test(seg), '带上 deviceToken 过鉴权');
  }

  sec('⑧ ⛔ 去凭据版不许夹带持仓/凭据/大缓存');
  {
    const BZ = fs.readFileSync(__dirname + '/_build_zip.py', 'utf8');
    const inSet = (set, name) => {
      const i = BZ.indexOf(set);
      const seg = BZ.slice(i, BZ.indexOf('}', i));
      return new RegExp('"' + name.replace(/[.]/g, '\\.') + '"').test(seg);
    };
    ok(inSet('DATA_FILES =', 'holdings.json'), '剔除 holdings.json（含成本/股数/金额）');
    ok(inSet('DATA_FILES =', 'paper.json'), '剔除 paper.json（模拟盘）');
    ok(inSet('DATA_FILES =', 'stats.json'), '剔除 stats.json（学习历史）');
    ok(inSet('SECRET_FILES =', 'config.json'), '剔除 config.json');
    ok(inSet('SECRET_FILES =', 'access.json'), '剔除 access.json');
    ok(/EXCLUDE_DIR_PREFIX = \("_backup_before_wipe_",\)/.test(BZ), '发版前整目录快照按前缀排除');
    ok(/\.holdings_bak/.test(BZ) && /_local_backup/.test(BZ), '持仓备份目录与本地备份目录也排除');
    ok(/fn\.startswith\("\."\)/.test(BZ), '点开头的缓存/密钥文件一律不进包');
    ok(/d\.startswith\("\."\)/.test(BZ), '点开头的目录一律不进包');
    ok(/PWD_LITERALS/.test(BZ), '仍保留明文口令扫描（改名/新增文件也漏不掉）');
    // 真打一份去凭据版，看清单里到底有没有这些东西
    try {
      const { execFileSync } = require('child_process');
      const PY = 'C:/Users/28957/.workbuddy/binaries/python/versions/3.13.12/python.exe';
      execFileSync(PY, [__dirname + '/_build_zip.py', 'testpack'], { cwd: __dirname, timeout: 300000 });
      const zp = __dirname + '/量化看盘平台_源码_去凭据版.zip';
      const buf = fs.readFileSync(zp);
      // zip 中央目录扫文件名（不用解压，够用）
      let names = [];
      for (let i = 0; i < buf.length - 4; i++) {
        if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x01 && buf[i + 3] === 0x02) {
          const nl = buf.readUInt16LE(i + 28), eo = buf.readUInt16LE(i + 30), co = buf.readUInt16LE(i + 32);
          try { names.push(buf.slice(i + 46 + eo + co, i + 46 + eo + co + nl).toString('utf8')); } catch (e) {}
        }
      }
      ok(names.length > 50, '打出了 ' + names.length + ' 个文件');
      const has = n => names.some(x => x === n || x.endsWith('/' + n));
      ok(!has('holdings.json'), '包里确实没有 holdings.json');
      ok(!has('config.json'), '包里确实没有 config.json');
      ok(!has('access.json'), '包里确实没有 access.json');
      ok(!has('.holdings_ops.json'), '包里确实没有持仓变更流水');
      ok(!names.some(x => /_backup_before_wipe_/.test(x)), '包里确实没有发版前快照');
      ok(!names.some(x => /\.ztpre_feat\.json$/.test(x)), '包里确实没有 16MB 的特征缓存');
      ok(fs.statSync(zp).size < 8 * 1024 * 1024, '去凭据版 ' + (fs.statSync(zp).size / 1048576).toFixed(2) + ' MB（剔除大缓存后应远小于 8MB）');
    } catch (e) {
      // ⚠️ 沙箱里 Node spawn 外部进程会 EBUSY（本环境限制，非脚本问题，与 _test_push_no_secret.js 同款）。
      //    这时退回首行的静态断言（剔除名单已逐项验过），不算失败但要把话说清楚，别假装验过。
      if (/EBUSY|ENOENT/.test(String((e && e.code) || e))) {
        console.log('   · 跳过真打包校验（沙箱禁 spawn：' + (e.code || e.message) + '），以上为静态断言');
      } else {
        ok(false, '打包验证失败：' + ((e && e.message) || e));
      }
    }
  }

  sec('⑨ 版本一致 + 无 CRLF');
  const sv = (SV.match(/const APP_VER = '([^']+)'/) || [])[1];
  const hv = (HTML.match(/const APP_VER = '([^']+)'/) || [])[1];
  ok(sv && sv === hv, '两端 APP_VER 一致：' + sv);
  ok(!/\r/.test(BLOCK), '新增代码块无 CRLF（Edit 偷引 CRLF 的老坑）');

  // 收尾：把本套件造的临时沙箱删干净（断言失败也要删，所以放在 exit 之前且不进 if）
  let left = 0;
  for (const d of TMPDIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { left++; } }
  ok(left === 0, '⛔ 本套件造的 ' + TMPDIRS.length + ' 个临时沙箱已全部删除（不留垃圾在系统临时目录）');

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
