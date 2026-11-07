// 面板韧性守门测试（2026-10-12 gj 轮）
// ── 为什么单独立一个套件 ────────────────────────────────────────────────
// 用户反馈两件事：「面板刷新出错」偶发 + 「偶发黑色弹窗」。本轮用 jsdom 复刻前端调用链取证：
//   ① /api/state 单轮拉取失败（云端冷启动返回 502 HTML / 手机弱网断连）会让 refresh()
//      在 fetch 那一行抛错 → 页面立刻弹出「⚠️ 面板刷新出错（数据可能已停止更新）」。
//      可面板上还是上一轮的数据、5 秒后的下一轮通常就成功了 —— 这是**误报 + 文案不实**，
//      而且那个框不会自己消失，用户只能手点重试。字段级模糊测试另测出：后端漏返
//      loop / ztPool 任一个都会让整页渲染抛错（`s.loop.tickCount` / `s.ztPool.length` 裸取）。
//   ② 系统深色模式下，浏览器原生 confirm()/prompt() 渲染成近黑底对话框 —— 就是用户说的
//      「黑色弹窗」。项目早有"全面替代 alert/confirm"的目标，但仍剩 4 处漏网。
// 本套件把上述行为全部钉死，防止回归。
const fs = require('fs');
const path = require('path');
const H = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name + (extra ? '  → ' + extra : '')); }
};

// 取函数体（⛔ gd 铁律：一律取函数体再判定，不对整份文件 indexOf）
function fnBody(sig) {
  const i = H.indexOf(sig);
  if (i < 0) return '';
  // 从签名处按花括号配平取函数体（不许用固定行号窗口）
  let depth = 0, j = H.indexOf('{', i);
  if (j < 0) return '';
  const start = j;
  for (; j < H.length; j++) {
    if (H[j] === '{') depth++;
    else if (H[j] === '}') { depth--; if (depth === 0) return H.slice(start, j + 1); }
  }
  return '';
}
// 剥掉 // 与 /* */ 注释后的代码（判"有没有原生 confirm"这类必须用这个：
// 版本注释里会提到 confirm/prompt 字样，直接搜整份文件会假红）。
// ⛔ 不许用两条正则硬删：本项目 1597 行的超长版本注释里带 `/*` 字样，块注释正则会
//    把它和几百行之后的 `*/` 配成一对，**把中间的真代码一起吞掉**（本轮实测踩中：
//    setViewPwd / uiConfirm 整段消失，断言全部假红）。必须按字符串状态机逐字符走。
function stripComments(src) {
  let out = '', i = 0, n = src.length, st = 'code';
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (st === 'code') {
      if (c === '/' && c2 === '/') { st = 'line'; i += 2; continue; }
      if (c === '/' && c2 === '*') { st = 'block'; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') { st = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (st === 'line') { if (c === '\n') { st = 'code'; out += c; } i++; continue; }
    if (st === 'block') { if (c === '*' && c2 === '/') { st = 'code'; i += 2; continue; } i++; continue; }
    // 字符串里：遇到同样引号且前面不是转义反斜杠才回到代码态
    if (c === '\\') { out += c + (c2 || ''); i += 2; continue; }
    if (c === st) { st = 'code'; out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}
const CODE = stripComments(H);

// ── ① 「这一轮没拉到」必须与「面板坏了」分开 ──────────────────────
const refreshBody = fnBody('async function refresh()');
ok('refresh 函数体可定位', refreshBody.length > 1000);
ok('/api/state 的 fetch 包在 try 里（失败不再直接冒泡到刷新 catch）',
  /try \{ s = await fetchStateOnce\(\); \}/.test(refreshBody) && /async function fetchStateOnce\(\)/.test(CODE));
ok('拉取失败走 stateFetchFail 并直接 return（不继续拿 null 渲染）',
  /catch \(e\) \{ stateFetchFail\(e\); return; \}/.test(refreshBody));
ok('拉取成功后清零失败计数', /_stateFailOK\(\);/.test(refreshBody));

const sff = fnBody('function stateFetchFail(e)');
ok('stateFetchFail 函数体可定位', sff.length > 80);
// ⛔ 2026-10-28 改钉语义（原断言 `/_stateFailN >= 3/` 已漂移）：门槛从 3 调到 5 时只改了 if 那行，
//    toast 仍按 3 算 → 第 4 次失败显示「再失败 -1 次将标红」。现在钉的是「门槛与文案必须共用同一常量、
//    且文案不许自己写死数字」，比原来钉死 3 更强（门槛再调也不会假红，但两处不同步必红）。
ok('连续失败门槛是单一常量，且 ≥3 轮（单轮失败绝不升级成红框）',
  /const STATE_FAIL_RED = (\d+)/.test(CODE) && +RegExp.$1 >= 3 && /_stateFailN >= STATE_FAIL_RED/.test(sff));
ok('达标文案与门槛同源（不许文案自己写死数字 → 「再失败 -1 次」那种自相矛盾）',
  /STATE_FAIL_RED - _stateFailN/.test(sff) && !/再失败 ' \+ \((\d) - _stateFailN\)/.test(sff));
ok('未达门槛时用中性 toast（会自动消失，不是常驻红框）',
  /pageMsg\([^)]*上一轮的数据/.test(sff));
ok('达到门槛才升级，且 where 明确写「数据拉取」',
  /showRenderError\([\s\S]{0,220}'数据拉取'\)/.test(sff));

// ── ② 红框文案不许再谎称「数据可能已停止更新」──────────────────────
const sre = fnBody('function showRenderError(e, where)');
ok('showRenderError 函数体可定位', sre.length > 200);
ok('红框按 where 分流文案：数据拉取 → 「显示的是上一轮的数据」',
  /const isFetch = where === '数据拉取';/.test(sre) && /isFetch \? '⚠️ 连续多轮没拉到数据（面板显示的是上一轮的数据）'/.test(sre));
ok('只有渲染真错才说「数据可能已停止更新」',
  /: '⚠️ 面板刷新出错（数据可能已停止更新）'/.test(sre));
ok('红框标明身份 data-why（statefetch / render 两种）',
  /box\.setAttribute\('data-why', where === '数据拉取' \? 'statefetch' : 'render'\)/.test(sre));

const sfok = fnBody('function _stateFailOK()');
ok('_stateFailOK 只摘 statefetch 那块（渲染真错的框必须留着）',
  /getAttribute\('data-why'\) === 'statefetch'/.test(sfok) && /b\.remove\(\)/.test(sfok));

// ── ③ 后端漏返字段不许让整页渲染抛错（字段级模糊测试实测）──────────
ok('s.loop 取属性前有空值守卫', /const _lp = s\.loop \|\| \{\};/.test(refreshBody) && /_lp\.tickCount/.test(refreshBody) && /_lp\.lastError/.test(refreshBody));
ok('s.ztPool 取 length 前有空值守卫', /\(s\.ztPool \|\| \[\]\)\.length/.test(CODE));

// ── ④ 原生弹窗必须清零（用户反馈的「偶发黑色弹窗」）────────────────
// ⛔ 用剥注释后的代码判：版本注释里提到 confirm/prompt 字样，直接搜整份会假红
ok('代码里没有原生 confirm( 调用', !/[^.\w]confirm\s*\(/.test(CODE), CODE.match(/[^.\w]confirm\s*\([^\n]{0,40}/) || '');
ok('代码里没有原生 alert( 调用', !/[^.\w]alert\s*\(/.test(CODE));
ok('代码里没有原生 prompt( 调用', !/[^.\w]prompt\s*\(/.test(CODE));
ok('改用页内 uiConfirm（四个原 confirm 调用点全部替换）',
  (CODE.match(/await uiConfirm\(/g) || []).length >= 3);
ok('改用页内 uiPrompt（设模拟盘本金）', /await uiPrompt\(/.test(CODE));

// ⛔ 2026-10-28：桌面端清零了，手机端还留着 4 处原生 alert —— 而手机才是深色模式最常见的地方，
//    也正是用户当初反馈「偶发黑色弹窗」的主设备。两端一起钉，别只顾桌面。
const MH = fs.readFileSync(path.join(__dirname, 'public/mobile.html'), 'utf8');
const MCODE = stripComments(MH);
ok('手机端也没有原生 confirm( 调用', !/[^.\w]confirm\s*\(/.test(MCODE), MCODE.match(/[^.\w]confirm\s*\([^\n]{0,40}/) || '');
ok('手机端也没有原生 alert( 调用', !/[^.\w]alert\s*\(/.test(MCODE), MCODE.match(/[^.\w]alert\s*\([^\n]{0,50}/) || '');
ok('手机端也没有原生 prompt( 调用', !/[^.\w]prompt\s*\(/.test(MCODE));
ok('手机端改用页内 relToast 承载发布结果/网络异常',
  /function relToast\(msg, ok\)/.test(MCODE) && (MCODE.match(/relToast\(/g) || []).length >= 5);

const uic = fnBody('function uiConfirm(text, okLabel, cancelLabel)');
const uip = fnBody('function uiPrompt(text, def)');
ok('uiConfirm 函数体可定位', uic.length > 200);
ok('uiPrompt 函数体可定位', uip.length > 200);
ok('页内弹层卡片是浅色底 #fff（不是深色面）',
  /card\.style\.cssText = 'background:#fff;/.test(fnBody('function uiModalOpen(inner, onKey)')));
ok('页内弹层遮罩是浅色半透明 rgba(245,246,248,.82)', /rgba\(245,246,248,\.82\)/.test(H));
ok('弹层文案经过 esc 转义（外部文本不能直接拼 innerHTML）',
  /esc\(text\)/.test(uic) && /esc\(text\)/.test(uip));
ok('Esc = 取消（深色模式原生框做不到）', /'Escape'/.test(fnBody('function uiModalOpen(inner, onKey)')));
ok('uiPrompt 取消返回 null（与 prompt() 语义一致，调用方的 !v 判空照旧成立）',
  /resolve\(ok \? v : null\)/.test(uip));
ok('遮罩点击 = 取消（不误触确定）',
  /if \(e\.target === m\.wrap\) fin\(false\)/.test(uic) && /if \(e\.target === m\.wrap\) fin\(false\)/.test(uip));

// ── ⑥ 前台回来也要查版本（gj 轮补：旧标签页永远不更新）────────────────
// 用户反馈"还是不行"后实测：checkAppVer 原来只在页面加载时跑一次 → 那个从昨天开到
// 现在的标签页一直跑旧代码（旧代码遇 /api/state 抖动就弹红框、confirm 还是黑的），
// 而线上明明是新的。缓存头已是 no-store，所以不是缓存问题，是"没人再触发自检"。
ok('切回前台会再跑一次版本自检（不只是 resumeNow）',
  /function onPageVisible\(\) \{[\s\S]{0,220}checkAppVer\(\);[\s\S]{0,40}resumeNow\(\);/.test(CODE));
// ⛔ 2026-10-27 mp 轮改钉：H3 已把两端版本自检口径统一到 15s（桌面 + 手机同一个阈值），
//    这条断言原来钉死 30000，代码按设计改成 15000 后就假红。现在钉「有节流且阈值两端一致」，
//    并把 15s 这个业务值单列断言（改口径必须同步改这里，不能悄悄漂）。
ok('前台自检有节流（不会每次可见都打一次 /api/lock/status）',
  /Date\.now\(\) - _verChkAt > \d{4,5}/.test(CODE));
ok('前台自检节流阈值 = 15s（H3 口径，桌面/手机一致）',
  /Date\.now\(\) - _verChkAt > 15000/.test(CODE));
// 反证：无节流的旧写法必须抓得住（否则上一行只是装饰）
ok('反证：去掉节流直接 checkAppVer() 的写法不通过',
  !/function onPageVisible\(\) \{[\s\S]{0,120}\{ checkAppVer\(\); \}/.test(CODE));
ok('visibilitychange / focus / pageshow 三个监听都还在',
  /document\.addEventListener\('visibilitychange', onPageVisible\)/.test(CODE) &&
  /window\.addEventListener\('focus', onPageVisible\)/.test(CODE) &&
  /window\.addEventListener\('pageshow', onPageVisible\)/.test(CODE));

// ── ⑦ 两个守门测试不许互相打架 ──────────────────────────────────
// ⛔ 自保护：剥注释函数一旦误伤真代码，上面所有"代码里有 X"的断言会假绿。
//    本轮实测过：用两条正则硬删注释时，1597 行版本注释里的 `/*` 与几百行后的 `*/`
//    配成一对，把 setViewPwd / uiConfirm 整段吞掉 → 断言全红。这里反向钉住。
ok('剥注释没有误伤真代码（setViewPwd / holdDelSelected / uiConfirm 都还在）',
  /async function setViewPwd/.test(CODE) && /async function holdDelSelected/.test(CODE) && CODE.includes('uiConfirm'));
ok('_test_frontend_err.js 仍然要求「渲染错要显示」——本轮没有把它改没',
  /\} catch \(e\) \{ console\.error\(e\); showRenderError\(e, '面板渲染'\); \}/.test(H));

// ── ⑧ hv+1 轮：「面板渲染出错怎么改不好」的真根因 —— 数组里的 null 元素 ──────
// ar/gj/gk 三轮修的都是「字段缺失」（置 null/删除），漏了另一种形态：
//   /api/state 走 res.json(state) → 内部 JSON.stringify 把数组里的 NaN/undefined
//   变成 null 元素（JSON.stringify([NaN]) === '[null]'）→ 前端 .map(x => x.score)
//   裸取直接抛 → 整页渲染中断。jsdom 模糊测试实测 15 个数组字段置 [null] 全炸。
// 修法：渲染前统一过 normalizeState（滤掉 null 数组元素，Console 留痕）。
const nrm = fnBody('function normalizeState(s)');
ok('normalizeState 函数体可定位', nrm.length > 200);
ok('清洗在 refresh 里、且位于 _stateFailOK() 之后（拿到数据先洗再渲染）', (() => {
  const _iSF = refreshBody.indexOf('_stateFailOK();');
  const _iNS = refreshBody.indexOf('normalizeState(s);');
  return _iSF >= 0 && _iNS > _iSF;   // 位置语义：中间隔着一行长注释，不许用连续字符串判
})());
ok('数组元素按 x != null 滤除（NaN/undefined 被 stringify 成 null 的那一批）',
  /const clean = v\.filter\(x => x != null\);/.test(nrm));
ok('滤除有计数并 console.warn 留痕（不静默吞数据）',
  /dropped \+= v\.length - clean\.length;/.test(nrm) && /console\.warn\('\[面板\] 渲染前清洗/.test(nrm));
ok('大数组（stocks/ztPool/klines）不进深拷贝（性能保护）',
  /SKIP_DEEP = new Set\(\['stocks', 'ztPool', 'klines'\]\)/.test(nrm));
ok('ztPreRules 渲染前过滤空对象元素（r.key 裸取曾整页中断）',
  /rs\.filter\(r => r && r\.key\)/.test(refreshBody));

// ── ⑨ dy 轮：「连续多轮没拉到数据」为什么一直挂着（2026-10-17）──────────────
// 用户原话「为啥一直显示出来连续多轮没拉到数据，一起修」。jsdom 真跑取证
// （_forensic_statefail.js，用真实 /api/state 数据驱动，只 mock 失败序列）：
//   A 失败 3 轮后恢复            → 框自动消失 ✅
//   B 失败 3 轮后返回坏 JSON 再恢复 → 框自动消失 ✅
//   C 失败 3 轮后**某次请求既不抛错也不返回** → 之后两轮数据全部正常返回，框依然常驻 ❌
// 真凶①：refresh 的防堆叠锁 `if (_rfBusy) return` 没有时限 —— 一次挂起（容器回收的
//        半开连接 / 手机 WiFi↔4G 切网后的死连接）就永久挡住之后每一轮，
//        _stateFailOK 再也没机会执行，面板同时也不再更新。
// 真凶②（同轮抓到）：pageMsg 用了**未声明的裸 `el`**（全项目既无 let el、也无
//        id="el" 元素）→ 第一次调用就抛 ReferenceError，67 个提示点全部静默失效；
//        而 stateFetchFail 调它抛错会让 refresh 整体 reject → window.onerror 兜成
//        data-why=render 的红框，那种框**不会被 _stateFailOK 摘掉** ——
//        于是「一次弱网失败」= 一个永不消失的红框。
// 修法：fetch 12 秒超时 + 锁 25 秒兜底放行 + pageMsg 改 _toastEl + 提示语异常圈住 +
//       红框写明「最后成功时刻 / 会自动消失」+ 切回前台隔久了清零。
const pmb = stripComments(fnBody('function pageMsg(text, type)'));
ok('pageMsg 函数体可定位（67 个调用点的提示全靠它）', pmb.length > 300);
ok('pageMsg 不再用裸 el（曾致 ReferenceError → 全部提示静默失效）',
  !/(^|[^.\w$])el(?![\w$])/.test(pmb) && /_toastEl/.test(pmb));
ok('pageMsg 的 toast 节点有显式声明（不是隐式全局）',
  /let _toastTimer = null, _toastEl = null;/.test(CODE));
ok('toast 节点脱离文档后会重建（isConnected 判断，否则提示写进空气里）',
  /!(_)?toastEl \|\| !(_)?toastEl\.isConnected/.test(pmb));

const fso = fnBody('async function fetchStateOnce()');
ok('fetchStateOnce 函数体可定位', fso.length > 200);
ok('/api/state 拉取有超时（AbortController + STATE_FETCH_TIMEOUT_MS）',
  /new AbortController\(\)/.test(fso) && /STATE_FETCH_TIMEOUT_MS/.test(fso) && /ac\.abort\(\)/.test(fso));
ok('超时被翻译成人话（abort 原文对用户没有信息量）', /秒没有响应（已主动断开/.test(fso));
ok('超时按失败抛出，绝不当成功放过去（不拿上一轮数据冒充这一轮）',
  /throw new Error\('请求 '/.test(fso) && !/return null/.test(fso));

ok('refresh 记录「最后一次拿到数据」的时刻（红框要写明停在哪一刻）',
  /_lastStateOKAt = Date\.now\(\);/.test(refreshBody) &&
  /_lastStateAttemptAt = Date\.now\(\);/.test(refreshBody));
const rfw = fnBody('refresh = async function ()');
ok('refresh 包装层可定位', rfw.length > 100);
ok('防堆叠锁有上限（一次挂起不许让轮询永久停摆）',
  /_rfBusyAt/.test(rfw) && /STATE_BUSY_MAX_MS/.test(rfw) && /stateFetchFail\(/.test(rfw));
ok('强制放行会如实记账（不静默跳过）', /已强制放行/.test(rfw));
ok('resumeNow 隔久了切回前台会清零（昨晚的失败不该挂到今天）',
  /function resumeNow\(\) \{[\s\S]{0,700}_stateFailOK\(\);/.test(CODE) &&
  /Date\.now\(\) - _lastStateAttemptAt > 30000/.test(CODE));
ok('stateFetchFail 里提示语异常不拖垮刷新流程', /try \{ pageMsg\(/.test(sff));
ok('拉取类红框写明「会自动重试并自动消失」+ 最后成功时刻',
  /每 5 秒自动重试，恢复后本框自动消失/.test(sre) && /最后一次拿到数据/.test(sre));

// ⑨-动态：真跑 pageMsg / stateFetchFail / _stateFailOK（静态断言钉不住「调用会不会抛」）
(function stateFailDynamic() {
  let JSDOM;
  try { ({ JSDOM } = require('jsdom')); }
  catch (_) {
    try { ({ JSDOM } = require('C:/Users/28957/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
    catch (e2) { console.error('⑨-动态 无法加载 jsdom（' + e2.message + '）—— 按未通过计'); process.exit(1); }
  }
  const errs = [];
  const dom = new JSDOM(H, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
    beforeParse(w) {
      // locked 状态让 refresh 在渲染前就 return —— 本段只测「拉取失败这条链」，不测渲染
      w.fetch = async (u) => {
        const us = String(u);
        if (us.includes('/api/state')) return { ok: true, status: 200, json: async () => ({ locked: true, needPassword: true, msg: '测试' }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, log: [], count: 0 }) };
      };
      w.setInterval = () => 0;   // 关掉 5 秒轮询，单步驱动
      w.EventSource = class { constructor() {} close() {} addEventListener() {} };
      w.navigator.sendBeacon = () => true;
      w.addEventListener('error', ev => errs.push(String((ev.error && ev.error.stack) || ev.message).slice(0, 300)));
    }
  });
  const w = dom.window;
  try {
    // 1) pageMsg 必须能真跑（修复前这里必抛 ReferenceError: el is not defined）
    let threw = '';
    try { w.pageMsg('提示测试', 'ok'); } catch (e) { threw = String(e && e.message || e); }
    ok('pageMsg 实际调用不抛错', !threw, threw);
    const t = w.document.getElementById('pageToast');
    ok('pageMsg 真的把提示挂到页面上（文案正确）', !!t && t.textContent === '提示测试', t ? t.textContent : '无 #pageToast');
    ok('pageMsg 调用后没有冒出任何页面级异常', errs.length === 0, errs[0] || '');

    // 2) 单轮失败只能出中性 toast，不许出红框（这是用户看到的「红框常驻」源头）
    w.stateFetchFail(new Error('Failed to fetch'));
    ok('单轮失败：不出红框（只走中性提示）', !w.document.getElementById('renderErrBox'));

    // 3) 连续 STATE_FAIL_RED(=5) 轮才升级成 statefetch 红框，且文案里带「会自动消失」
    //    ⛔ 原来这里只驱动到第 3 轮就断言出框 —— 门槛 3→5 之后它必然假红（第 3 轮本就不该出框）。
    //    现在按门槛驱动：补到第 5 轮，并在第 4 轮断言「还没出框」（门槛真的生效，不是恒出框）。
    w.stateFetchFail(new Error('Failed to fetch'));
    w.stateFetchFail(new Error('Failed to fetch'));
    w.stateFetchFail(new Error('Failed to fetch'));
    ok('第 4 轮仍未升级（门槛真的存在，不是一失败就出框）', !w.document.getElementById('renderErrBox'));
    w.stateFetchFail(new Error('Failed to fetch'));
    const box = w.document.getElementById('renderErrBox');
    ok('连续 5 轮失败：升级成 data-why=statefetch 的红框',
      !!box && box.getAttribute('data-why') === 'statefetch',
      box ? box.getAttribute('data-why') : '无框');
    ok('红框文案写明「恢复后本框自动消失」（用户才知道该不该手点重试）',
      !!box && /恢复后本框自动消失/.test(box.textContent || ''));

    // 4) 数据恢复 → 框必须自己消失（这是「一直显示」的直接反证）
    w._stateFailOK();
    ok('数据恢复后红框自动消失（_stateFailOK 摘得掉）', !w.document.getElementById('renderErrBox'));

    // 5) uiAlert 真跑（替代原生 alert 后必须真能弹、真能关，否则发布失败原因就彻底看不见了）
    ok('uiAlert 已定义在页面上', typeof w.uiAlert === 'function');
    let ap = null;
    try { ap = w.uiAlert('发布失败：联检红灯 3 项'); } catch (e) { errs.push('uiAlert 抛错: ' + (e && e.message)); }
    const am = w.document.getElementById('uiModal');
    ok('uiAlert 真的把弹层挂到页面上', !!am && /联检红灯 3 项/.test(am.textContent || ''),
      am ? (am.textContent || '').slice(0, 40) : '无 #uiModal');
    const okBtn = am && am.querySelector('#uiMOk');
    ok('uiAlert 只有一个「确定」出口', !!okBtn && !am.querySelector('#uiMNo'));
    if (okBtn) okBtn.click();
    ok('点「确定」后弹层被移除', !w.document.getElementById('uiModal'));
    ok('uiAlert 返回 Promise（调用点 await 得住）', !!ap && typeof ap.then === 'function');
    ok('⑨-动态 全程没有页面级异常', errs.length === 0, errs.slice(0, 2).join(' | '));
  } finally {
    try { dom.window.close(); } catch (_) {}
  }
})();

// ⑧-动态：jsdom 回放「数组字段置 [null]/[{}]」不再炸（静态断言钉不住行为）
(function cardNullDynamic() {
  let JSDOM, VirtualConsole;
  try { ({ JSDOM, VirtualConsole } = require('jsdom')); }
  catch (_) {
    try { ({ JSDOM, VirtualConsole } = require('C:/Users/28957/.workbuddy/binaries/node/workspace/node_modules/jsdom')); }
    catch (e2) { console.error('⑧-动态 跳过：jsdom 不可用（' + e2.message + '）—— 动态断言未跑，按未通过计'); process.exit(1); }
  }
  const base = {
    ztBySector: [{ sector: '测试板块', count: 2, stocks: [{ name: '甲', lb: 1, role: 'leader' }] }],
    sectors: [{ name: '测试板块', pct: 1.2, mainInflow: 1e8 }],
    ztPool: [{ code: '002815', name: '崇达技术', price: 23.25, pct: 9.98, limitUpCount: 1, sealAmount: 1e9, breakCount: 0, sector: '测试板块' }],
    preselect: { time: '11:30:24', mood: { mood: '偏冷', upN: 480, downN: 5054, ztN: 39, dtN: 18, avgPct: -2.16 }, items: [{ code: '1', name: '盘前票', prob: 60 }] },
    mainline: { time: '12:52:29', items: [{ sector: '测试板块', count: 2, maxLb: 1, lbSum: 2 }] },
    pre: { time: '12:52:29', items: [] },
    nextplan: { date: null, applyDate: null, time: null, plan: null, cand: 0 },
    global: [{ code: 'usDJI', name: '道琼斯', price: 1, pct: -0.09 }],
    signals: [{ code: '1', name: '信号票', prob: 66 }],
    pool: [{ code: '1', name: '精选票', score: 80 }],
    trendPool: [{ code: '1', name: '趋势票', score: 70 }],
    trendScan: [{ code: '1', name: '扫描票', lift: 5, ztP: 30, baseZt: 25, runUp: 3, zt60: 2, price: 10, pct: 2, why: 'x' }],
    steadyUp: [{ code: '1', name: '连涨票', run: 4, cum: 12, ma20: 9.5, price: 10, pct: 3, sector: '测试板块', why: 'x' }],
    ztPre: [{ code: '1', name: '形态票', ztP: 40, base: 30, price: 10, pct: 2, lift: 10, run: 2, sum5: 8, volR: 1.5, amp: 20, feat: ['a'] }],
    ztPreRules: [{ key: 'P1', name: '规则', bin: 'A', n: 10, rate: 60 }],
    ztTopics: [{ sector: '测试板块', count: 2 }],
    learnHistory: [{ date: '2026-10-14', time: '21:00', kind: '条件修正', item: '连板', n: 20, rate: 60, note: 'x' }],
    yierList: [{ code: '1', name: '一进二票', prob: 60, price: 10, sealRatio: 0.8, turnover: 5 }],
    lianbanList: [{ code: '1', name: '连板票', prob: 60, price: 10, sealRatio: 0.8, turnover: 5 }],
    review: { date: '20261015', time: '15:31:00', items: [{ code: '1', name: '涨停票', limitUpCount: 1, sealRatio: 0.5, breakCount: 0, prob: 55, sector: '测试板块', themes: ['题材'] }] },
    bigMoney: { time: '12:00:00', items: [{ code: '1', name: '大单票', prob: 70, pct: 5, mainInflow: 1e8, mainPct: 3 }] },
    goodNews: { time: '12:00:00', items: [{ t: '2026-10-15 10:00', title: '利好', type: 'good', why: 'x', stat: { total: 3, up: 2, limit: 1, avgPct: 2, mainSum: 1e8 } }], hotSectors: [{ name: '测试板块', count: 2 }], hotStocks: [] },
    badNews: { time: '12:00:00', items: [], codes: [], sectors: [] },
    smallyang: { time: '12:00:00', total: 4, kept: 4, bankFiltered: 0, items: [{ code: '1', name: '小阳票', pct: 1.5 }] },
    buzhang: { time: '12:00:00', items: [{ code: '1', name: '步长票', pct: 2 }] },
    myrules: { date: '20261015', time: '12:00:00', count: 1, scanned: 100, items: [{ code: '1', name: '规则票', hits: 14, known: 14, pass: true, unknown: 0, items: [{ i: 1, name: '规则一', ok: true, note: '符合' }] }] },
    extLink: { time: '12:00:00', basePct: -0.5, groups: [{ name: '组一', extPct: 1, strength: 1.5, sectors: [{ name: '测试板块', pct: 2 }] }], picks: [{ group: '组一', sector: '测试板块', name: '联动票', code: '1', price: 10, pct: 2, turnover: 5 }] },
    learn: { samples: 100, hits: 40, minLearnDays: 5, split: { live: { rate: 40, n: 50, h: 20 }, backtest: { rate: 70, n: 50 }, posthoc: { rate: 0, n: 0 } }, groups: { A: { rate: 40, n: 50, h: 20 } }, buckets: { '55-64': { n: 30, days: 5, hit: 10, rate: 33, corr: 1 } }, paths: { 连板: { n: 20, days: 5, rate: 50, verdict: '有效', adj: 2 } } },
    learnall: { n: 438254 }
  };
  const paths = [
    ['ztPool', [null]], ['sectors', [null]], ['ztBySector', [null]], ['signals', [null]], ['pool', [null]],
    ['trendPool', [null]], ['trendScan', [null]], ['steadyUp', [null]], ['ztPre', [null]], ['ztPreRules', [null, {}]],
    ['ztTopics', [null]], ['learnHistory', [null]], ['yierList', [null]], ['lianbanList', [null]], ['global', [null]],
    ['preselect.items', [null]], ['mainline.items', [null]], ['pre.items', [null]],
    ['bigMoney.items', [null]], ['goodNews.items', [null]], ['badNews.items', [null]], ['smallyang.items', [null]],
    ['buzhang.items', [null]], ['myrules.items', [null]], ['extLink.picks', [null]], ['review.items', [null]]
  ];
  const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const set = (o, p, v) => { const ks = p.split('.'); let t = o; for (let i = 0; i < ks.length - 1; i++) t = t[ks[i]]; t[ks[ks.length - 1]] = v; };

  let bad = [];
  (async () => {
    for (const [p, v] of paths) {
      const st = JSON.parse(JSON.stringify(base));
      set(st, p, v);
      const errs = [];
      const vc = new VirtualConsole();
      vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/navigation to another Document/.test(m)) errs.push(m); });
      const dom = new JSDOM(H, {
        runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
        beforeParse(w) {
          w.fetch = async (u) => {
            const us = String(u);
            if (us.includes('/api/state')) return { ok: true, status: 200, json: async () => st, text: async () => JSON.stringify(st) };
            if (us.includes('/api/lock/status')) return { ok: true, status: 200, json: async () => ({ appVer: 'x', pushRole: 'primary' }) };
            return { ok: true, status: 200, json: async () => ({ ok: true, log: [], count: 0 }) };
          };
          w.EventSource = class { constructor() {} close() {} addEventListener() {} };
        }
      });
      const w = dom.window;
      await new Promise(r => setTimeout(r, 500));
      try { await w.refresh(); } catch (e) { errs.push('refresh 抛错: ' + String(e && e.message || e)); }
      await new Promise(r => setTimeout(r, 100));
      const box = w.document.getElementById('renderErrBox');
      if (box && box.getAttribute('data-why') === 'render') errs.push('render 红框');
      dom.window.close();
      if (errs.length) bad.push(p + ' → ' + errs[0].slice(0, 120));
    }
    ok('26 个数组字段置 [null]/[{}] 全部不再炸（hv+1 前实测 15 个全炸）',
      bad.length === 0, bad.slice(0, 3).join(' | '));
    console.log('\n面板韧性守门：' + pass + ' 通过 / ' + fail + ' 失败');
    process.exit(fail ? 1 : 0);
  })().catch(e => { console.error('⑧-动态 崩溃:', e); process.exit(1); });
})();
