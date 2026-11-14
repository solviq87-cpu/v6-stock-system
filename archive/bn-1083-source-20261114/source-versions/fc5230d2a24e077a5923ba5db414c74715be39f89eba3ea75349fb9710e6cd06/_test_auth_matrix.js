// 路由鉴权矩阵守门测试（本轮角度：只读身份能不能执行写操作）。
//
// 故障形态：门禁（8117）只验「令牌是否有效」，【不区分 view / edit】；
// 敏感接口的开发者校验分散在各路由内部（requireEditor / isEditorReq）。
// 于是「路由里忘了加身份校验」= 只拿着观看密码的人也能改数据，
// 而且这类越权不会报错、不会告警，只会在账本上留下一条没人认领的成交。
//
// 实测发现的真漏洞：/api/refresh 以前完全没有身份校验，
//   而 mod==='paper' 跑的是 paperCheckAll —— 模拟盘【自动买入/卖出】，写 paper.json；
//   review / news 分别写 review.json / news.json；holdings/nextplan/myrules/pre 重算+落盘。
//   看盘的人点一下面板🔄就能改开发者的模拟盘账本。
// 另一处：/api/backtest 是 GET 且无鉴权，会遍历全市场 K 线跑回测（占满一轮 CPU）。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const SVK = stripNoise(SV, { keepStrings: true });   // 去注释但保留字符串（路由名/模块名在字符串里）

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

// 取某个路由的处理段：路由判定行 → 下一条路由判定行之前
function segOf(routeName) {
  const lines = SVK.split('\n');
  const hit = new RegExp("p\\s*(?:===|==)\\s*'" + routeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'");
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (hit.test(lines[i])) { start = i; break; }
  if (start < 0) throw new Error('未找到路由段: ' + routeName);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/p\s*(?:===|==)\s*'\/api\/|p\.indexOf\(\s*'\/api\/|p\.startsWith\(\s*'\/api\//.test(lines[i])) { end = i; break; }
  }
  return { code: lines.slice(start, end).join('\n'), raw: SV.split('\n').slice(start, end).join('\n'), start: start + 1 };
}
const AUTH_RE = /requireEditor\s*\(|isEditorReq\s*\(|roleOf\s*\([^)]*\)\s*(?:===?\s*'edit'|!==?\s*'view')/;

group('[1] 会改数据的接口必须拦住只读身份');
// ⚠️ 同一路由常有多段（GET 读 / POST 写），只有「写」那段需要鉴权；
//    一律取带 POST 判定的那段（没有 POST 段的取首段，如 GET 触发的 /api/backtest）。
for (const r of ['/api/config', '/api/source', '/api/sync/export', '/api/paper', '/api/holdings', '/api/backtest']) {
  let hit = null, s = segOf(r);
  const lines = SVK.split('\n');
  const re = new RegExp("p\\s*(?:===|==)\\s*'" + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'");
  for (const seg of [s]) {
    // 逐段扫描：找到相邻两段中的 POST 段
    let all = [];
    for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) all.push(i);
    for (const st of all) {
      let en = lines.length;
      for (let i = st + 1; i < lines.length; i++) {
        if (/p\s*(?:===|==)\s*'\/api\/|p\.indexOf\(\s*'\/api\/|p\.startsWith\(\s*'\/api\//.test(lines[i])) { en = i; break; }
      }
      const body = lines.slice(st, en).join('\n');
      if (/req\.method\s*===?\s*'POST'/.test(body)) { hit = { code: body, raw: SV.split('\n').slice(st, en).join('\n'), start: st + 1 }; break; }
    }
    if (!hit) hit = seg;
  }
  ok(`${r} 的写操作段里有开发者身份判据`, AUTH_RE.test(hit.code), '段起始行 ' + hit.start);
}

group('[2] /api/refresh：只读只许刷行情，不许碰写类模块');
const RF = segOf('/api/refresh');
ok('/api/refresh 有身份判据（isEditorReq）', /isEditorReq\s*\(/.test(RF.code));
ok('定义了只读白名单 RO_MODS', /const RO_MODS\s*=\s*\[/.test(RF.code));
ok('定义了写类名单 ED_MODS', /const ED_MODS\s*=\s*\[/.test(RF.code));
ok('ED_MODS 含 paper（模拟盘巡检会下单）', /ED_MODS\s*=\s*\[[^\]]*'paper'/.test(RF.code));
ok('ED_MODS 含 review（写 review.json）', /ED_MODS\s*=\s*\[[^\]]*'review'/.test(RF.code));
ok('ED_MODS 含 news（写 news.json）', /ED_MODS\s*=\s*\[[^\]]*'news'/.test(RF.code));
ok('ED_MODS 含 holdings / nextplan / myrules / pre',
  ["'holdings'", "'nextplan'", "'myrules'", "'pre'"].every(k => new RegExp('ED_MODS\\s*=\\s*\\[[^\\]]*' + k).test(RF.code)));
ok('只读请求写类模块时直接 return 并带 readOnly:true',
  /if\s*\(!_rfEdit\s*&&\s*ED_MODS\.indexOf\(mod\)\s*>=\s*0\)\s*\{/.test(RF.code) && /readOnly:\s*true/.test(RF.code));
ok('RO_MODS 与 ED_MODS 无交集（一个模块不能既是只读可刷又是写类）', (() => {
  const ro = (RF.code.match(/const RO_MODS\s*=\s*\[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g) || [];
  const ed = (RF.code.match(/const ED_MODS\s*=\s*\[([^\]]*)\]/) || [, ''])[1].match(/'([^']+)'/g) || [];
  return ro.length > 0 && ed.length > 0 && !ro.some(x => ed.indexOf(x) >= 0);
})());

group('[3] 真的跑一遍 _want：只读身份下写类模块一律不成立');
const WANT_SRC = (RF.code.match(/const _want = \(m\) =>[^\n]*/) || [''])[0];
const RO_SRC = (RF.code.match(/const RO_MODS\s*=\s*\[[^\]]*\]/) || [''])[0];
const ED_SRC = (RF.code.match(/const ED_MODS\s*=\s*\[[^\]]*\]/) || [''])[0];
ok('切到 _want 定义', !!WANT_SRC, WANT_SRC || '未匹配到');
if (WANT_SRC && RO_SRC && ED_SRC) {
  // 原样执行线上那段代码：mod / _rfEdit 作为形参注入，语义完全来自 server.js。
  // mk(mod, edit) 返回一个「查询函数」want(m) —— 即在 (module=mod, 身份=edit) 这次请求下，
  // 第 m 个模块会不会被排进任务列表。
  const mk = (mod, edit) => new Function('mod', '_rfEdit', RO_SRC + '\n' + ED_SRC + '\n' + WANT_SRC + '\nreturn (mm) => _want(mm);')(mod, edit);
  const roNames = (RO_SRC.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));
  const edNames = (ED_SRC.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1));

  // ① 开发者：每个模块单独点名都能跑
  ok('开发者身份下，每个写类模块都能跑', edNames.every(m => mk(m, true)(m) === true), edNames.filter(m => mk(m, true)(m) !== true).join(','));
  ok('开发者身份下，每个只读模块都能跑', roNames.every(m => mk(m, true)(m) === true));
  // ② 只读：写类一律不成立（这是本轮修的核心）
  ok('只读身份下，写类模块全部被拒', edNames.every(m => mk(m, false)(m) === false), edNames.filter(m => mk(m, false)(m) !== false).join(','));
  ok('只读身份下 mod=paper 被拒（模拟盘不会被看盘的人下单）', mk('paper', false)('paper') === false);
  ok('只读身份下 mod=review 被拒', mk('review', false)('review') === false);
  ok('只读身份下 mod=news 被拒', mk('news', false)('news') === false);
  // ③ 只读：行情类照旧能刷（不能把观看者正常刷新也堵死）
  ok('只读身份下，行情类模块照旧能刷', roNames.every(m => mk(m, false)(m) === true), roNames.filter(m => mk(m, false)(m) !== true).join(','));
  // ④ 全部刷新：开发者全跑，只读自动降级（pre 属于写类，all 时也必须被剔除）
  ok('开发者 mod=all 时 pre 参与', mk('all', true)('pre') === true);
  ok('只读 mod=all 时 pre 被降级剔除', mk('all', false)('pre') === false);
  ok('只读 mod=all 时 global / sectors / auction 仍在',
    ['global', 'sectors', 'auction'].every(m => mk('all', false)(m) === true));
  ok('只读 mod=all 时 paper / review / news 全部剔除',
    ['paper', 'review', 'news'].every(m => mk('all', false)(m) === false));
}

group('[4] 只读身份不能靠「全部刷新」绕过去：all 分支里的补跑也带身份门');
ok('mod=all 的复盘补跑带 _rfEdit 判据',
  /mod === 'all' && _rfEdit && !S\.review/.test(RF.code),
  (RF.raw.match(/mod === 'all'.*computeReview\(\)/) || ['未找到'])[0]);

group('[5] /api/backtest：跑回测归开发者，取结果对只读放行');
const BT = segOf('/api/backtest');
const BTR = segOf('/api/backtest/result');
ok('跑回测要求开发者身份', /requireEditor\s*\(/.test(BT.code));
ok('取回测结果不要求开发者（只读也要能看）', !/requireEditor\s*\(/.test(BTR.code));
ok('/api/backtest 仍保留防重入（S.backtestPending）', /S\.backtestPending/.test(BT.code));

group('[6] 自证入口必须在门禁白名单里（它们是「手头没令牌」时的唯一通路）');
// ⛔ 2026-10-27：白名单尾部一直在长（srcpkg → client-error…），旧写法把正则尾巴钉在 /srcpkg/ 那行，
//    后面每加一条白名单，整个 GATE 就抽不出来 → 六条断言一起假红。改成按边界切片：
//    从 `const isAuth` 切到紧跟其后的 `if (!isAsset && !isAuth`
const _gi = SVK.indexOf('const isAuth');
const _ge = _gi < 0 ? -1 : SVK.indexOf('if (!isAsset && !isAuth', _gi);
const GATE = _gi < 0 ? '' : SVK.slice(_gi, _ge > _gi ? _ge : _gi + 3000);
for (const r of ['/api/lock/unlock', '/api/lock/forgot', '/api/lock/verify-code', '/api/lock/reset-pwd', '/api/auth/redeem', '/api/lock/pending-status', '/api/heartbeat']) {
  ok(`${r} 已在门禁白名单（否则外网永远走不通）`, GATE.indexOf("'" + r + "'") >= 0);
}
// mp 轮反证：这条断言必须能抓住"心跳被门禁吞掉"的旧写法 —— 否则它只是装饰。
{
  const OLD_GATE = GATE.replace(/\|\|\s*p === '\/api\/heartbeat'\s*/g, '');
  ok('/api/heartbeat 反证：去掉白名单项后本断言会红（证明它真的在守这条）', OLD_GATE.indexOf("'/api/heartbeat'") < 0);
  // 语义：心跳只刷存活戳、不读数据 —— 路由体里不许出现落盘/读盘/密钥类调用
  const HB = (SVK.match(/if \(p === '\/api\/heartbeat'\)[\s\S]{0,300}?\}/) || [''])[0];
  ok('/api/heartbeat 路由体只记心跳、不外发数据', /recordReplicaHeartbeat\s*\(/.test(HB) && !/atomicWrite|writeFile|accessSecret/.test(HB), HB.slice(0, 120));
}

group('[7] 敏感接口双保险：8124 的统一收口仍在');
const COLLECT = (SVK.match(/if \(p === '\/api\/source'[\s\S]{0,600}?isEditorReq\(req, _st\)\)/) || [''])[0];
ok('统一收口含 /api/source + /api/sync/export + /api/config',
  /\/api\/source/.test(COLLECT) && /\/api\/sync\/export/.test(COLLECT) && /\/api\/config/.test(COLLECT));
ok('统一收口用 isEditorReq 判身份', /isEditorReq\(req, _st\)/.test(COLLECT));

group('[8] token 取值通道：前端有两套传法，路由漏读一套也不能把开发者判成只读');
// 前端：window.fetch 补丁把 token 拼在 **URL** 上；面板里那些「必须带 token」的调用又各自往
// **body** 里塞一份（历史写法）。各路由只读其中一套 → 前端那一处漏塞，requireEditor 拿到空串
// → 非本机一律判只读 → 面板「点了没反应」，且没有任何报错（本项目最难自查的故障形态）。
const HANDLE_HEAD = (SVK.match(/req\.__tok = [\s\S]{0,300}?let p = u\.pathname;/) || [''])[0];
ok('handle 里统一解析凭证并挂在 req 上', /req\.__tok\s*=/.test(SVK));
ok('Bearer 优先，query 和 body 依次回退', /req\.__tok = \(\(req\.headers\.authorization/.test(SVK) && /\|\|\s*\(u\.searchParams && u\.searchParams\.get\('token'\)\)/.test(SVK));
ok('query 为空时回落到 body', /\|\|\s*\(\(\) => \{ try \{ return \(JSON\.parse\(body \|\| '\{\}'\) \|\| \{\}\)\.token/.test(SVK));
ok('req.__tok 的赋值在路由分发之前', SVK.indexOf('req.__tok =') < SVK.indexOf("const isAsset = p === '/'"), '否则部分路由读不到');

const ISE_SRC = (SVK.match(/function isEditorReq\(req, tok\) \{[^\n]*\n?/) || [''])[0] ||
  (SVK.match(/function isEditorReq\(req, tok\) \{[\s\S]{0,200}?\}/) || [''])[0];
ok('isEditorReq 在实参为空时回落到 req.__tok', /tok \|\| \(req && req\.__tok\)/.test(SVK));
if (/tok \|\| \(req && req\.__tok\)/.test(SVK)) {
  // 真跑一遍：把依赖全部换成 mock，只验证「凭证从哪来」这一件事
  const isEd = new Function('roleOf', 'isLocalReq', 'clientIp',
    'function isEditorReq(req, tok) { return isLocalReq(req) || roleOf(tok || (req && req.__tok) || "", clientIp(req)) === "edit"; }\nreturn isEditorReq;'
  )(
    (t) => (t === 'EDIT' ? 'edit' : t === 'VIEW' ? 'view' : null),
    () => false,                 // 强制走 roleOf 分支（模拟线上：非本机直连）
    () => '1.2.3.4'
  );
  ok('路由只读 body 时（实参为空），URL 上的 edit 令牌仍能生效', isEd({ __tok: 'EDIT' }, '') === true);
  ok('回落后的只读令牌不会被抬成开发者', isEd({ __tok: 'VIEW' }, '') === false);
  ok('没有凭证就是只读（回落不会凭空放行）', isEd({}, '') === false);
  ok('路由显式传的实参优先于回落', isEd({ __tok: 'VIEW' }, 'EDIT') === true);
  ok('实参为空且回落也是只读令牌 → 仍判只读', isEd({ __tok: 'VIEW' }, '') === false);
}

group('[9] 只读身份的可见性边界：私密数据不能从「一锅端」接口漏出去');
// 前半轮查的是「写」（只读能不能改），这里查「读」（只读能不能看）。
// /api/holdings 明写「持仓属私密数据，只读权限不可查看」，而 /api/state 是面板的一锅端数据源，
// 里面混着模拟盘双账户的现金 / 权益 / 逐票持仓 / 成交记录 —— 同一个私密等级，一个口子挡着、
// 另一个口子敞开。这类泄露不会报错，只读设备的面板只是"照常显示"，没有任何异常迹象。
const ST = segOf('/api/state');
ok('/api/state 里有身份判据', /isEditorReq\s*\(/.test(ST.code), '段起始行 ' + ST.start);
ok('模拟盘按身份裁剪（非开发者不回明细）',
  /paper:\s*_stEdit\s*\?\s*\{[^\n]*mkPaper\([^\n]*\}\s*:\s*\{[^\n]*hidden:\s*true/.test(ST.code));
ok('只读分支不调用 mkPaper（不返回现金/持仓/成交）', (() => {
  // 取 paper 那一行，看 hidden:true 之后还有没有 mkPaper —— 有就是只读也把明细算出来了
  const line = (ST.code.match(/paper:[^\n]*/) || [''])[0];
  const hi = line.indexOf('hidden: true');
  return hi > 0 && !/mkPaper/.test(line.slice(hi));
})(), (ST.code.match(/paper:[^\n]*/) || [''])[0]);
ok('开发者分支仍返回完整两个账户', /mkPaper\('pool'\)/.test(ST.code) && /mkPaper\('pre'\)/.test(ST.code));
ok('/api/holdings 的 GET 挡住了只读（真实持仓）', (() => {
  // ⚠️ 别写 roleOf\([^)]*\)：clientIp(req) 里的内层括号会把匹配截断
  const H = segOf('/api/holdings');
  return /roleOf\([^;]{0,80}?!==\s*'edit'/.test(H.code) && /hidden:\s*true/.test(H.code);
})(), (segOf('/api/holdings').code.match(/roleOf[^\n]*/) || ['未找到'])[0]);
ok('前端对 hidden 有兜底展示（不是空白区块）',
  /s\.paper\s*&&\s*s\.paper\.hidden/.test(fs.readFileSync(path.join(ROOT, 'public/assets/app.js'), 'utf8')));

group('[10] 私密推送不许广播给只读连接');
// pushAll 会把文案前 260 字以 alert 事件推给所有 SSE 连接 —— 含只读观看者的面板。
// 「💰 模拟盘动态」含账户金额与逐笔买卖，以前没打任何私密标记 → 只读端照样弹得出来。
const BRANCHES = (SVK.match(/if \(opts && \(opts\.private \|\| opts\.sseEdit\)\) sseSendEdit\('alert', evt\); else sseSend\('alert', evt\);/g) || []);
ok('SSE 分流两处都认 sseEdit', BRANCHES.length === 2, '实际 ' + BRANCHES.length + ' 处');
// ⛔ 2026-10-27：选项对象后来多了一个键（{ sseEdit: true, private: true }），旧正则要求
//    「sseEdit 是唯一键、紧跟右括号」，于是这条一直是假红。改为「对象里有 sseEdit:true」。
ok('模拟盘动态推送打了 sseEdit', /模拟盘动态[\s\S]{0,400}?\{[^}]*sseEdit:\s*true[^}]*\}/.test(SV));
// go 轮 A10 + lw 轮铁律：模拟盘动态含账户金额，外发必须走私密机器人（私密通道）。
// 旧断言写的是「不许改成 private」，与后来的用户定调（所有推送默认私密）相反，已按现状改写。
ok('模拟盘动态走私密通道（含账户金额，不许发群）',
  /模拟盘动态[\s\S]{0,300}?private:\s*true/.test(SV));
if (BRANCHES.length) {
  // 真跑一遍分流：只验证「走哪条通道」这一件事
  const route = (opts) => new Function('opts', 'sseSendEdit', 'sseSend', 'evt',
    "if (opts && (opts.private || opts.sseEdit)) { sseSendEdit('alert', evt); return 'edit'; } else { sseSend('alert', evt); return 'all'; }"
  )(opts, () => {}, () => {}, {});
  ok('不打标记 → 广播给所有连接（含只读）', route(undefined) === 'all');
  ok('private → 只发开发者连接', route({ private: true }) === 'edit');
  ok('sseEdit → 只发开发者连接', route({ sseEdit: true }) === 'edit');
  ok('空对象不打标记 → 仍是广播（防手滑）', route({}) === 'all');
}
ok('持仓事件全部走私密通道（sseSendEdit 没有漏到 sseSend）', (() => {
  const all = SVK.split('\n');
  let bad = 0;
  for (const l of all) if (/sseSend\(\s*'holding'/.test(l)) bad++;
  return bad === 0;
})());

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
