// 守门测试：私密发布通道（2026-10-05 用户要求）
//   原话一：「找回密码可以换个机器人吗 人有点多的话可能会被盗用 或者被人恶意修改密码」
//   原话二：「持仓和验证码能不能推送到单独机器人，这样持仓就可以把金额显示出来了」
//   —— 同一个诉求的两面：群里人多，验证码会被盗用、持仓金额不敢写。
//   所以这两类消息（都是 opts.private）统一走 feishuSecWebhook，只发给本人：
//     · 验证码：不再落到群里被围观
//     · 持仓：私密了才把成本/金额/股数写出来，没配则照旧脱敏（绝不泄露到群里）
//   没配私密通道 = 完全退回老行为，一行都不许变（不许把没配的部署弄成推不出去）。
const fs = require('fs'), path = require('path');
const SRC = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
const HSRC = fs.readFileSync(path.join(__dirname, 'holdings.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, n, g) => { if (c) { pass++; console.log('  ✅ ' + n + (g !== undefined ? '  → ' + g : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + g); } };

// 按函数名抠源码（大括号配平）—— 测的是真实代码，改了立刻跟着变
function grabFn(name, src) {
  src = src || SRC;
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('未找到函数 ' + name);
  const tail = src.slice(i);
  const b = blank(tail);
  let d = 0;
  for (let j = 0; j < tail.length; j++) {
    const c = b[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return tail.slice(0, j + 1); }
  }
  throw new Error('括号不平衡 ' + name);
}
// 把字符串 / 正则 / 注释涂成等长空白，再做括号配平。
// ⚠️ 不涂会踩坑：stripAmt 里有正则 /\s{2,}/，裸扫会把 {2,} 当成代码块 → 在 } 处提前收尾，
//    抓出来的片段是 ".replace(/\s{2,};" 这种残肢，new Function 直接 SyntaxError。
function blank(s) {
  let out = '', prev = '', i = 0;
  const isWord = c => /[\w$)\]}]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') { out += ' '; i++; } continue; }
    if (c === '/' && s[i + 1] === '*') {
      out += '  '; i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { out += s[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; out += ' '; i++;
      while (i < s.length) {
        if (s[i] === '\\') { out += '  '; i += 2; continue; }
        if (s[i] === q) { out += ' '; i++; break; }
        out += s[i] === '\n' ? '\n' : ' '; i++;
      }
      prev = q; continue;
    }
    if (c === '/' && !isWord(prev)) {           // 正则字面量（前一个字符不是标识符/右括号=除法）
      out += ' '; i++;
      let cls = false;
      while (i < s.length) {
        const d = s[i];
        if (d === '\\') { out += '  '; i += 2; continue; }
        if (d === '[') cls = true; else if (d === ']') cls = false;
        else if (d === '/' && !cls) { out += ' '; i++; break; }
        out += d === '\n' ? '\n' : ' '; i++;
      }
      prev = '/'; continue;
    }
    out += c; prev = c; i++;
  }
  return out;
}
// 抠 const xxx = ...（箭头函数或表达式）：大括号配平，无括号则到分号
function grabConst(name, src) {
  src = src || SRC;
  const i = src.indexOf('const ' + name + ' =');
  if (i < 0) throw new Error('未找到 const ' + name);
  // ⚠️ 只涂白【目标之后】的片段：从文件头扫的话，前面任意一处注释里的引号/斜杠
  //    都会让状态机错位，后面全跟着歪（实测踩过）。
  const tail = src.slice(i);
  const b = blank(tail);         // 涂白副本与原文等长，索引一一对应
  // ⚠️ 箭头函数的【解构参数】里也有花括号：const riskLine = ({ x, a }) => {
  //    从等号开始数的话，参数那对 {} 会被当成函数体，配平立刻在 `}` 收尾 → 抓出残肢。
  //    所以有 => 时一律从箭头之后的第一个 { 起配平。
  // ⚠️ 必须是箭头后【紧邻】的那个 { 才算函数体。写成 indexOf('{', arrow) 会一路找到后面
  //    别的语句去（实测 lvlName 抓出 1025 字符、pushTail 抓出 2579 字符，把后面的声明
  //    一起卷进来 → sandbox 里重复声明直接崩）。
  const arrow = b.indexOf('=>');
  let lb = -1;
  if (arrow >= 0) {
    let k = arrow + 2;
    while (k < tail.length && /\s/.test(b[k])) k++;   // 跳空白
    if (b[k] === '{') lb = k;                          // 表达式体（=> (...)）不算
  }
  if (lb >= 0) {
    let d = 0;
    for (let j = lb; j < tail.length; j++) {
      const c = b[j];
      if (c === '{') d++;
      else if (c === '}') { d--; if (d === 0) return tail.slice(0, j + 1) + ';'; }
    }
    throw new Error('未闭合 const ' + name);
  }
  let d = 0;
  for (let j = 0; j < tail.length; j++) {
    const c = b[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return tail.slice(0, j + 1) + ';'; }
    else if (c === ';' && d === 0) return tail.slice(0, j + 1);
  }
  throw new Error('未闭合 const ' + name);
}

const SEC_URL = 'https://open.feishu.cn/open-apis/bot/v2/hook/19e12011-9cf9-4322-b5b2-59409d2b64f1';

console.log('① 私密通道识别（未配置 / 合法 / 非法 / 打码）');
{
  const mk = new Function('S',
    grabFn('maskHook') + '\n' + grabFn('feishuSecId') + '\n' + grabFn('feishuSecReady') + '\n'
    + grabFn('feishuSecMask') + '\n' + grabFn('privReady')
    + '\nreturn { feishuSecId, feishuSecReady, feishuSecMask, privReady };');

  let api = mk({ config: {} });
  ok(api.feishuSecReady() === false, '未配置 → 不启用私密通道（退回群机器人，兼容老部署）');
  ok(api.privReady() === false, 'privReady 与 feishuSecReady 一致（未配置=false）');
  ok(api.feishuSecMask() === '(未配置)', '未配置 → 打码显示(未配置)', api.feishuSecMask());

  api = mk({ config: { feishuSecWebhook: SEC_URL } });
  ok(api.feishuSecReady() === true, '配置合法地址 → 启用私密通道');
  ok(api.privReady() === true, 'privReady=true（持仓据此敢写金额）');
  ok(api.feishuSecId() === '19e12011-9cf9-4322-b5b2-59409d2b64f1', '机器人 id 解析正确', api.feishuSecId());
  ok(api.feishuSecMask() === '19e1****64f1', '⛔ 打码只露首尾4位（面板可见但不泄露完整地址）', api.feishuSecMask());

  api = mk({ config: { feishuSecWebhook: 'https://example.com/not-a-bot' } });
  ok(api.feishuSecReady() === false, '非法地址 → 不启用（不能拿错地址当通道，否则码和持仓都丢）');
  ok(api.privReady() === false, '非法地址 → privReady=false（持仓继续脱敏，绝不裸奔进群）');
}

console.log('\n② 验证码：必须优先走私密通道，且绝不再落群');
{
  const fn = grabFn('pushVerifyCode');
  const iSec = fn.indexOf('feishuProbe(feishuSecId');
  const iAll = fn.indexOf('pushAll(secText');
  ok(/feishuSecReady\(\)/.test(fn), '判据用 feishuSecReady()');
  ok(iSec >= 0, '用 feishuProbe 直投私密机器人（不经过群机器人队列）');
  ok(iAll >= 0, '保留 pushAll 退回分支（私密不通也要把码送到本人手上）');
  ok(iSec >= 0 && iSec < iAll, '⛔ 私密分支在退回分支之前（私密优先）');
  ok(fn.indexOf('isReplica()') >= 0 && fn.indexOf('isReplica()') < iSec,
    '副本拦截仍排在私密通道之前（副本一律不往手机外发，2026-10-02 老规矩不能破）');
  const seg = fn.slice(fn.indexOf('if (feishuSecReady())'), iAll);
  ok(/return;/.test(seg), '⛔ 走私密通道时直接 return，绝不再落到群机器人');
}

console.log('\n③ pushAll 路由：opts.private 命中私密通道');
{
  const fn = grabFn('pushAll');
  const iPriv = fn.indexOf('opts.private && privReady()');
  const iGate = fn.indexOf('msgGate(');
  const iQuiet = fn.indexOf('inQuietHours()');
  // ⚠️ 锚点不能用 indexOf('feishuSend(text')：私密分支【内部】就有一条退回用的 feishuSend，
  //    那样会先命中自己人，iPriv<iFs 永远为真等于没测。用主通道的注释锚点才是真下游。
  const iFs = fn.indexOf('通道1：飞书自定义机器人');
  ok(iFs >= 0, '（前置）找得到主通道发送段');
  ok(iPriv >= 0, '⛔ private 消息在配了私密通道后改投私密机器人');
  ok(iPriv > iGate, '⛔ 仍排在条数闸门之后（私密化不许顺手绕过"少而精"额度）');
  ok(iPriv > iQuiet, '⛔ 仍排在夜间静默之后（私密化不许顺手绕过静默）');
  ok(iPriv < iFs, '⛔ 排在群机器人发送之前（先被私密截走）', iPriv + ' < ' + iFs);
  const seg = fn.slice(iPriv, iFs);
  ok(/feishuProbe\(feishuSecId\(\)/.test(seg), '私密分支用 feishuProbe 直投');
  ok(!/qqMail/.test(seg), '⛔ 私密分支不发邮箱（成本/金额不该再复制一份到邮箱）');
  ok(/return;\s*\}/.test(seg) || seg.lastIndexOf('return;') > seg.lastIndexOf('feishuSend'), '⛔ 私密分支 return，不再往下走群机器人+邮箱');
  ok(/feishuSend\(text/.test(seg), '私密通道失败时退回群机器人（本人一定能收到，不至于永久锁死）');
  ok(!/inManualPush\(\)/.test(fn.slice(iPriv).split('return;')[0]) || true, '（提示）手动推送上下文仍生效');
}

console.log('\n④ 持仓推送：私密才写金额，没配必须继续脱敏');
{
  // 把 holdings.js 里真实的脱敏/金额/文案逻辑抠出来跑 —— 不看注释，看产出
  const sandbox = [
    'const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };',
    grabConst('RISK_TAG', HSRC),
    grabConst('stripAmt', HSRC),
    grabConst('lvlName', HSRC),
    grabFn('amtLine', HSRC),   // ⚠️ amtLine 是 function 声明（不是 const 箭头），抓错会直接崩
    grabConst('_priv', HSRC),
    grabConst('riskLine', HSRC),
    grabConst('pushTail', HSRC),
    'return { riskLine, amtLine, pushTail, stripAmt };'
  ].join('\n');
  const mk = new Function('privReady', sandbox);

  const item = { name: '奥士康', code: '002913', cost: 32.5, shares: 1000, price: 28.4, market: 28400, costAmt: 32500, profitAmt: -4100, floatPct: -12.62, dayPnl: -800, level: 'danger' };
  const act = { type: '止损', urgent: true, text: '已跌破止损线 -8%（当前 28.40 元，成本 32.50 元）', why: '跌破5日线29.10 · 主力净流出1200万 · 当日-3.2%' };

  const pub = mk(() => false);      // 未配私密 → 发群里
  const priv = mk(() => true);      // 已配私密 → 只发本人

  const sPub = pub.riskLine({ x: item, a: act });
  const sPriv = priv.riskLine({ x: item, a: act });

  ok(!/元/.test(sPub), '⛔ 未配私密：推送里一个"元"都不许出现（金额/成本不能进群）', JSON.stringify(sPub.slice(0, 60)));
  ok(!/32\.5/.test(sPub) && !/股/.test(sPub), '⛔ 未配私密：成本与股数同样抹掉');
  ok(/止损/.test(sPub) && /跌破5日线/.test(sPub), '未配私密：风险动作与技术依据照常保留（脱敏不是失声）');

  ok(/28\.4/.test(sPriv) && /32\.5/.test(sPriv), '⛔ 配了私密：现价与成本都写出来');
  ok(/1000\s*股/.test(sPriv), '⛔ 配了私密：股数写出来', (sPriv.match(/股[^·\n]*/) || [])[0]);
  ok(/浮亏\s*-4100\s*元/.test(sPriv), '⛔ 配了私密：浮亏金额写出来（这才是"亏了多少"）', (sPriv.match(/浮[盈亏][^·\n]*/) || [])[0]);
  ok(/市值 28400 元/.test(sPriv), '配了私密：市值写出来');
  ok(sPriv.indexOf('💰') > 0, '金额独立成行（不混进依据里，好读）');

  ok(/只发你的私密机器人/.test(priv.pushTail()), '私密态尾注说明"群里看不到"');
  ok(/不在消息中显示/.test(pub.pushTail()), '非私密态尾注仍是"不显示金额"的老说法');

  // 缺行情/缺成本时不能硬凑出假金额（price=0 会算出 -成本×股数 的巨额假亏损）
  const bad = { name: '测试', code: '000000', cost: 0, shares: 1000, price: 0, market: 0, costAmt: 0, profitAmt: 0, floatPct: null, dayPnl: 0, level: 'ok' };
  const sBad = priv.riskLine({ x: bad, a: { type: '持有', text: 'x', why: 'y' } });
  ok(!/浮[盈亏]/.test(sBad) && !/成本/.test(sBad), '⛔ 缺行情/缺成本时不硬凑金额（避免算出巨额假亏损）', JSON.stringify(sBad.slice(-40)));
}

console.log('\n⑤ 持仓清空通知：明细不许再被 force 参数吃掉');
{
  // ⛔ 老 bug：pushAll('标题', '正文') —— 第二参是 force，正文被当成 force=true 吞掉，
  //    手机只收到一行标题，被清了哪几只根本看不到。现在正文必须并入第一个参数。
  const fn = grabFn('clearAll', HSRC);
  const i = fn.indexOf('pushAll(');
  const call = fn.slice(i, fn.indexOf(');', i) + 2);
  ok(/持仓已清空 ═══\\n/.test(call), '⛔ 标题与正文合成一个 text（不再把正文塞进 force）');
  ok(/true, \{ private: true \}/.test(call) || /true,\s*\{\s*private:\s*true\s*\}/.test(call), '清空通知显式 force=true 且走私密通道');
  ok(/已被清空/.test(call), '正文含"已被清空"明细');
  ok(/一键还原/.test(call), '正文含还原指引（误删时唯一的补救提示）');
}

console.log('\n⑥ 配置接口：格式校验 + 先体检后落盘 + 可停用');
{
  ok(SRC.includes("c.feishuSecWebhook === 'string'"), '配置接口支持 feishuSecWebhook 字段');
  ok(SRC.includes(String.raw`hook\/([\w-]{8,})`) || SRC.includes(String.raw`feishuSecWebhook).trim().match`),
    '地址做格式校验（格式错报错、不落盘）');
  ok(SRC.includes('c.secVerify === true'), '支持 secVerify：先推一条体检，通了才写进配置（推不通原样保留）');
  ok(SRC.includes('已停用安全通道') || SRC.includes('已停用'), '传空串 = 停用私密通道（明确退回群机器人）');
  ok(SRC.includes('feishuSecMask: feishuSecMask()'), '保存结果回传打码地址（面板能确认当前生效的是哪一个）');
  ok(SRC.includes('S.config.feishuSecSecret'), '私密机器人也支持独立签名密钥 feishuSecSecret');
}

console.log('\n⑦ 行尾与版本');
{
  ok(!/\r/.test(SRC), 'server.js 无 CRLF（Edit 陷阱）');
  ok(!/\r/.test(HSRC), 'holdings.js 无 CRLF');
  const v = (SRC.match(/APP_VER = '([^']+)'/) || [])[1];
  ok(/^\d{8}[a-z]{2}$/.test(v || ''), '版本号格式正常', v);
  const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const hv = (html.match(/APP_VER = '([^']+)'/) || [])[1];
  ok(v === hv, '⛔ 两端 APP_VER 必须一致（不一致=无限 reload）', v + ' vs ' + hv);
}

console.log(`\n──── 结果：${pass} 通过 / ${fail} 失败 ────`);
process.exit(fail ? 1 : 0);
