// 报错/提示给出的处置建议必须真能执行（本轮新角度）。
//
// 前三轮的教训串起来看：bz 修了「提示在撒谎」（说没改其实改了）、bx 修了「写入端与校验端不一致」，
// 而这一轮盯的是同一个家族里最末端的一环 —— **提示说得振振有词，可你照着做一定失败**：
//
//   · 指向不存在的入口：「请在开发者锁面板里修改」—— 面板早就改成 5 个标签页了，
//     压根没有一个叫「开发者锁面板」的东西，用户找一圈只会以为功能坏了。
//   · 把人往更窄的路上引：「需在本机面板设置」—— 实际判据是 `!isLocalReq && roleOf(tok)!=='edit'`，
//     任何持开发者令牌的设备都能设，提示却让人以为非得跑到装服务的那台电脑前。
//   · 让用户做他此刻做不到的事：未登录时说「或先配置推送」，而配置推送本身就要编辑权限（死锁）；
//     手机端说「请看服务日志」，而手机端根本没有控制台。
//   · 手里攥着原因却不给：`catch (e)` 里 console.error 了 e.message，回给用户却是「请看服务日志」；
//     `.catch(() => ...)` 更狠，连日志都没有，只回三个字「扫描失败」。
//   · 数字是编的/过期的：说「N 分钟后可再试」，代码里却早改成了别的数。
//
// 这类故障共同点：**不报错、不崩溃、功能也没坏，只是用户被一句漂亮话晾在原地**。
// 所以本测试尽量做成交叉校验（拿文案去比对前端与常量），而不是钉死自己的源码字符串。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
// ⛔ 一律在剥掉注释的版本上判"活代码"：本项目注释里会逐字引用旧文案来解释历史 bug（已踩 7 次）
const { stripNoise } = require('./_codescan.js');
const CODE_K = stripNoise(SV, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
const lineOf = i => SV.slice(0, i).split('\n').length;

// 抠出 error: '...' / note: '...' 的单引号字符串（含 \' 转义）
function grabStrings(key) {
  const re = new RegExp(key + ":\\s*'", 'g');
  const out = [];
  let m;
  while ((m = re.exec(CODE_K))) {
    let j = m.index + m[0].length, buf = '';
    while (j < CODE_K.length) {
      const c = CODE_K[j];
      if (c === '\\') { buf += CODE_K[j + 1]; j += 2; continue; }
      if (c === "'") break;
      buf += c; j++;
    }
    out.push({ i: m.index, line: lineOf(m.index), txt: buf });
  }
  return out;
}
const MSGS = grabStrings('error').concat(grabStrings('note'));

group('[1] 入口承诺：报错里点名的前端入口，index.html 里必须真有（面板改名会被立刻抓到）');
{
  ok('抠到足够多的提示文案', MSGS.length >= 50, String(MSGS.length));
  // 只在文案"真的在指路"时才校验：含 请/可/点/到…里/前往 这类建议动词
  const ADVICE = /请|可[在以到]|点[「击]|到[^，。]{0,10}里|前往/;
  const ENTRY = /[「『]([^」』]{2,20})[」』]/g;
  const checked = [];
  for (const m of MSGS) {
    if (!ADVICE.test(m.txt)) continue;
    for (const g of m.txt.matchAll(ENTRY)) {
      const nm = g[1];
      // 「…」里可能是数据名不是入口名，只校验"看起来像入口"的：
      //   ① 含面板/按钮/设置/绑定这类词  ② 带 emoji 的标签名（👁 观看 / 📲 找回 这种）
      const looksEntry = /面板|页|框|区|按钮|设置|修改|绑定|改绑|流水|查看|列表|标签|登录|密码/.test(nm)
        || /[\u{1F000}-\u{1FAFF}\u{2190}-\u{2BFF}]/u.test(nm);
      if (!looksEntry) continue;
      const bare = nm.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '');
      const inHtml = HTML.includes(nm) || (bare.length >= 2 && HTML.includes(bare));
      checked.push({ nm, inHtml, line: m.line });
      ok(`L${m.line} 入口「${nm}」前端存在`, inHtml);
    }
  }
  ok('确实校验到了入口（不是空跑）', checked.length >= 4, String(checked.length));
  // 明确钉死这条历史 bug 不再回来
  ok('⛔ 不再出现「开发者锁面板」这个前端没有的名字',
    !MSGS.some(m => m.txt.includes('开发者锁面板')));
}

group('[2] 建议可操作性：不许让用户做他在这个场景做不到的事');
{
  const RULES = [
    [/服务日志|服务端日志|看日志|控制台/, '让用户在手机/面板上看服务端日志（那边没有控制台）'],
    [/先配置推送|请先配置推送/, '未登录时让人"先配置推送"，而配置推送本身要编辑权限（死锁）'],
  ];
  for (const [re, why] of RULES) {
    const hit = MSGS.filter(m => re.test(m.txt));
    ok('⛔ 没有「' + why + '」这类建议', hit.length === 0,
      hit.map(h => 'L' + h.line + ' ' + h.txt.slice(0, 60)).join(' | '));
  }
  // 未配置推送通道那条：必须点明"本机面板会直接回显验证码"这条真走得通的路
  const noCh = MSGS.find(m => m.txt.includes('未配置推送通道'));
  ok('未配置推送通道时明确给出本机回显这条路', !!noCh && /本机/.test(noCh.txt) && /回显/.test(noCh.txt),
    noCh ? noCh.txt.slice(0, 80) : '未找到该文案');
  // 授权码过期：除了"已登录设备"，必须给一条不依赖已登录设备的自救路
  const acExp = MSGS.find(m => m.txt.includes('授权码不存在或已过期'));
  ok('授权码过期时不只给"已登录设备"这一条路', !!acExp && /手机号/.test(acExp.txt),
    acExp ? acExp.txt.slice(0, 90) : '未找到该文案');
  // 观看密码/找回手机号：不许再写"需在本机面板"（实际任何持开发者令牌的设备都能做）
  ok('⛔ 不再写「需在本机面板设置/绑定」（实际远程持开发者令牌也能做）',
    !MSGS.some(m => /需在本机面板/.test(m.txt)),
    MSGS.filter(m => /需在本机面板/.test(m.txt)).map(m => 'L' + m.line).join(','));
}

group('[3] 数字承诺：文案说 N 分钟，代码里必须真有 N*60*1000（改了常量忘了改文案会被抓到）');
{
  const hits = [];
  for (const m of MSGS) {
    for (const g of m.txt.matchAll(/(\d+)\s*分钟/g)) {
      // 「约 1-2 分钟」是估算不是承诺，跳过
      if (/约/.test(m.txt)) continue;
      hits.push({ n: Number(g[1]), m });
    }
  }
  ok('抓到需要核对的分钟承诺', hits.length >= 3, String(hits.length));
  for (const h of hits) {
    // 常量一般写在文案之前（判定式里），取前 5000 + 后 500 字符
    const near = SV.slice(Math.max(0, h.m.i - 5000), h.m.i + 500);
    const want = h.n * 60 * 1000;
    const found = [...near.matchAll(/(\d+)\s*\*\s*60\s*\*\s*1000/g)]
      .map(x => Number(x[1]) * 60000)
      .some(v => v === want);
    ok(`L${h.m.line} 文案「${h.n} 分钟」在附近有 ${h.n}*60*1000 的常量`, found,
      h.m.txt.slice(0, 60));
  }
  // 另外两条非时间的数字承诺（本金 / 密码长度）
  const cap = MSGS.find(m => m.txt.includes('本金需在'));
  ok('本金区间文案与常量一致（1 万 ~ 10 亿 ↔ 10000 / 1e9）',
    !!cap && /1 万 ~ 10 亿/.test(cap.txt) && /amt < 10000 \|\| amt > 1e9/.test(SV));
  const pw = MSGS.filter(m => m.txt.includes('至少 4 位'));
  ok('密码长度文案与常量一致（至少 4 位 ↔ length < 4）',
    pw.length >= 1 && /length < 4/.test(SV));
  // 反证：把常量改掉而文案不动，本测试必须能红
  ok('反证：旧文案 30 分钟若对着 3000ms 的常量应当判不一致',
    (() => { const near = 'x < 3000'; return ![...near.matchAll(/(\d+)\s*\*\s*60\s*\*\s*1000/g)].map(x => Number(x[1]) * 60000).includes(30 * 60000); })());
}

group('[4] 攥着原因不给：catch 不许把 e 吞掉只回一句固定失败');
{
  // `.catch(() => json(res, { ok:false, error:'...' }))` —— 回调连参数都没有，等于彻底丢弃。
  // ⛔ 必须"紧邻"匹配：写成 [\s\S]{0,200} 会一路吃到后面 .then 里的 ok:false，
  //    把 `captureAuction(true).catch(() => {})` 这种空 catch 误判成丢弃错误（那是另一类问题）。
  const swallow = [...CODE_K.matchAll(/\.catch\(\(\)\s*=>\s*json\(\s*res\s*,\s*\{[^}]{0,200}ok:\s*false/g)];
  ok('⛔ 没有丢弃错误对象的 .catch(() => …ok:false)', swallow.length === 0,
    swallow.map(x => x[0].slice(0, 70)).join(' | '));
  // 模拟盘：catch 里必须把 e.message 存下来并拼进回给用户的文案
  ok('模拟盘失败会把原因回传给用户', /_paperErr = \(e && e\.message\) \|\| String\(e\)/.test(CODE_K));
  ok('模拟盘失败文案拼接了原因', /error: '模拟盘操作失败' \+ \(_paperErr \? '：' \+ _paperErr : ''\)/.test(CODE_K));
  ok('模拟盘失败文案给了能执行的下一步（重试 / 推送流水）',
    /可稍后重试一次/.test(SV) && /推送流水/.test(SV));
  // 相似扫描：不得再回光秃秃的「扫描失败」
  ok('⛔ 不再回光秃秃的「扫描失败」', !/'扫描失败'/.test(CODE_K));
  ok('相似扫描失败会回传原因', /error: '扫描失败：' \+ _sm/.test(CODE_K));
}

group('[5] 承诺「会/已自动」的动作，前端或后端必须真有对应路径');
{
  // "等待确认后会自动进入" → 前端必须有轮询 pending-status
  const auto = MSGS.find(m => m.txt.includes('会自动进入'));
  ok('存在"会自动进入"的承诺', !!auto);
  ok('前端真有对应的状态轮询（pending-status + 自动进入分支）',
    /pending-status/.test(HTML) && /gateWaitApproval/.test(HTML));
  // "完成后自动推送到手机" → 该分支必须真调 pushWecom
  const autoPush = MSGS.find(m => m.txt.includes('完成后自动推送到手机'));
  ok('存在"完成后自动推送"的承诺', !!autoPush);
  // ⛔ gn 轮改判据（2026-10-13）：复盘补发改了「覆盖日≠今天时首行加📌补发标记」，
  //    调用从 pushWecom(msg, true) 变成带条件表达式 —— 旧正则钉字面量会假红。
  //    语义没变：异步块里仍以 force=true 调 pushWecom 真发。
  // ⛔ 2026-10-28 改钉：go 轮 A12 起这条推送带上了第三参 { private: true }（复盘走私密通道），
  //    原来钉 `, true)` 收尾会假红。判据钉语义：异步块里以 force=true 真调 pushWecom，
  //    第三参可有可无，但【若带就必须是 private:true】（不许退回公开群）。
  ok('复盘补发的异步块里真的调了 pushWecom', (() => {
    const i = SV.indexOf('完成后自动推送到手机');
    if (i < 0) return false;
    const tail = SV.slice(i, i + 6000);
    const m = tail.match(/pushWecom\([\s\S]{0,260}?,\s*true\s*(,\s*\{[^}]*\})?\s*\)/);
    if (!m) return false;
    if (!m[1]) return true;                       // 老写法（不带 opts）也允许
    return /private\s*:\s*true/.test(m[1]);       // 带 opts 就必须是私密
  })());
  // "稍后再看" 的 pending 必须带回进度，否则用户不知道还要等多久
  const later = MSGS.find(m => m.txt.includes('稍后再看'));
  // prog 写在这条 note 之前（同一个 json 里），往前找而不是往后找
  ok('"稍后再看"的 pending 同时回了进度', !!later && /prog\s*:/.test(SV.slice(Math.max(0, later.i - 300), later.i + 100)),
    later ? JSON.stringify(SV.slice(Math.max(0, later.i - 160), later.i + 20)) : '未找到');
}

console.log(`\n===== 报错建议可执行性 守门测试：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
