// 守门：持仓推送只报风险，不泄「金额 / 股数 / 成本」；且加减仓要能提醒到手机
// 背景：2026-10-02 用户要求「持仓推送不显示金额股数 只推送风险」+「提醒加减仓风险」。
//       之前两处推送（watch 定时盯盘 / checkNow 手动巡检）都把 成本、浮盈金额、合计金额
//       直接拼进正文；「加仓」又是 urgent:false 且非 once，等于永远进不了手机。
const fs = require('fs');
const SV = fs.readFileSync('holdings.js', 'utf8');
let pass = 0, fail = 0;
const ok = (c, n, g) => { if (c) { pass++; console.log('  ✅ ' + n + (g !== undefined ? '  → ' + g : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + g); } };
const sec = t => console.log('\n' + t);

// ── 把 holdings.js 里的脱敏工具原样抠出来跑真的行为测试（不是对着源码做字符串断言）──
// ⚠️ 2026-10-05 改：riskLine 的收尾从 `依据：${stripAmt(a.why)}` 变成了 `依据：${w}`，
//    因为脱敏与否现在由【私密通道是否配置】决定（配了才敢写金额）。锚点跟着换成新写法，
//    否则定位失败 → 后面所有断言都是空的（假绿比红灯更危险）。
const i0 = SV.indexOf('const RISK_TAG = t =>');
const iMark = SV.indexOf('依据：${w}');
// ⚠️ 不能只截到"依据那一行"：riskLine 现在是【块体】箭头函数，后面还有收尾的 };
//    少了它 new Function 直接 SyntaxError（实测踩到）。要一直截到 pushTail 整段结束。
const iPt = SV.indexOf('const pushTail =');
const i1 = iPt >= 0 ? SV.indexOf('\n', SV.indexOf(');', iPt)) : SV.indexOf('\n', SV.indexOf('};', iMark));
ok(i0 > 0 && iMark > i0 && i1 > iMark && iPt > iMark, '能定位到脱敏工具块', 'i0=' + i0 + ' iMark=' + iMark + ' i1=' + i1);
const snippet = SV.slice(i0, i1);
// _priv 定义在模块顶部（不在上面这段里），单独抠真实的 —— 不自己仿写一个假的，
// 否则"私密判定"改坏了这里还是绿的。
const _pv = SV.indexOf('const _priv =');
const privDef = _pv >= 0 ? SV.slice(_pv, SV.indexOf('\n', SV.indexOf('};', _pv))) : '';
ok(!!privDef && /privReady/.test(privDef), '抠到了真实的 _priv（私密判定的唯一入口）');
// amtLine 依赖 num；_priv 依赖 privReady —— 两个都在模块外层，由参数注入。
// 两份实例：未配私密（发群里，必须脱敏） vs 已配私密（只发本人，允许带金额）。
const mkH = pr => new Function('privReady', 'num',
  privDef + '\n' + snippet + '\n return { RISK_TAG, stripAmt, lvlName, pushable, riskLine, pushTail };'
)(pr, v => { const n = parseFloat(v); return isFinite(n) ? n : 0; });
const H = mkH(() => false);        // 脱敏态：与 2026-10-02 的原始要求完全一致
const HP = mkH(() => true);        // 私密态：新增，允许写金额

sec('① 稿件脱敏：三类隐私必须抹干净');
{
  const cases = [
    ['止损文案', '亏损已8.12%，越过 8% 止损线，建议离场，避免亏损扩大',
      '触发条件：浮动亏损 -8.12% ＞ 止损线 8%（当前 -1200 元）'],
    ['止盈文案', '浮盈 12.5% 越过 10% 止盈线，建议分批止盈',
      '触发条件：浮动盈利 12.5% ＞ 止盈线 10%（当前 +3480 元）。到线只提醒一次'],
    ['停牌文案', '🔔 停牌中：公告涉及停牌',
      '触发条件：公告正文命中「停牌」；当前成本 12.34、停牌前最后价 11.8，浮亏 -4%（-480 元）'],
    ['立减半仓', '建议先减半仓观察：跌破5日线10.2、主力净流出3200万',
      '触发条件：浮亏 6.1% ＞ 预警线 5%（当前 -900 元）且 2 项走弱证据同时成立']
  ];
  for (const [nm, text, why] of cases) {
    const line = H.riskLine({ x: { name: '测试票', code: '600000', level: 'warn' }, a: { type: '减仓', text, why } });
    ok(!/元/.test(line), nm + '：正文无「元」');
    ok(!/成本\s*[0-9]/.test(line), nm + '：正文无「成本+数字」');
    ok(!/\d+(\.\d+)?\s*股/.test(line), nm + '：正文无「N股」');
    ok(!/[（(]\s*[）)]/.test(line), nm + '：没留空括号', JSON.stringify(line.match(/[（(][^）)]{0,3}[）)]/g) || []));
  }
}

sec('② 技术指标与百分比必须留下（别把有用的也脱没了）');
{
  ok(H.stripAmt('浮亏 8.12%＞8%（当前 -1200 元）') === '浮亏 8.12%＞8%', '百分比保留、金额抹掉', H.stripAmt('浮亏 8.12%＞8%（当前 -1200 元）'));
  const keep = H.stripAmt('跌破5日线10.2、主力净流出3200万、当日大跌-3.4%');
  ok(keep === '跌破5日线10.2、主力净流出3200万、当日大跌-3.4%', '5日线/资金万/% 全部保留', keep);
  ok(H.stripAmt('先卖 200 股看看') === '先卖 看看', '股数被抹掉', JSON.stringify(H.stripAmt('先卖 200 股看看')));
  ok(H.stripAmt('成本 12.34') === '', '裸成本被抹掉', JSON.stringify(H.stripAmt('成本 12.34')));
  ok(!/\s{2,}/.test(H.stripAmt('浮亏8%（当前 -500 元）了结')), '没有连续空格残留');
  ok(H.stripAmt(null) === '' && H.stripAmt(undefined) === '', 'null/undefined 不炸');
}

sec('③ 推送准入：风险类 + 一次性加仓，其余不许占手机额度');
{
  ok(H.pushable({ type: '止损', urgent: true }) === true, '止损 → 推');
  ok(H.pushable({ type: '减仓', urgent: true }) === true, '减仓 → 推');
  ok(H.pushable({ type: '加仓', urgent: false, once: true }) === true, '加仓(once) → 推（本次修复重点）');
  ok(H.pushable({ type: '加仓', urgent: false, once: false }) === false, '加仓(非once) → 不推，防刷屏回归');
  ok(H.pushable({ type: '止盈', urgent: false, quiet: true }) === false, 'quiet → 不推');
  ok(H.pushable({ type: '关注', urgent: false }) === false, '面板级「关注」→ 不推');
  ok(H.pushable({ type: '止损', urgent: true, quiet: true }) === false, 'quiet 压过 urgent');
}

sec('④ 风险标签分档');
{
  ok(H.RISK_TAG('止损') === '🔴 强风险', '止损=强风险', H.RISK_TAG('止损'));
  ok(H.RISK_TAG('减仓') === '🟠 需处理', '减仓=需处理', H.RISK_TAG('减仓'));
  ok(H.RISK_TAG('加仓') === '🔵 加减仓提示', '加仓=加减仓提示', H.RISK_TAG('加仓'));
  ok(H.RISK_TAG('止盈') === '🟢 落袋提示', '止盈=落袋提示', H.RISK_TAG('止盈'));
  ok(H.lvlName('danger') === '危险' && H.lvlName('warn') === '警戒' && H.lvlName('ok') === '正常', '等级中文化');
}

sec('⑤ 两处推送都换了稿件（watch / checkNow）');
{
  const w = SV.indexOf('async function watch(');
  const c = SV.indexOf('async function checkNow(');
  const body = SV.slice(w, SV.indexOf('\n  }', w));
  ok(/if \(!pushable\(a\)\) continue;/.test(body), 'watch 用 pushable 过滤');
  ok(/fired\.map\(riskLine\)/.test(body), 'watch 正文走 riskLine');
  ok(!/x\.cost|it\.cost|合计/.test(body), 'watch 正文不再自己拼金额/成本');
  ok(/持仓风控警报/.test(body) && /加减仓风险提醒/.test(body) && /持仓盯盘提醒/.test(body), 'watch 标题三档齐全');
  const cbody = SV.slice(c, SV.indexOf('\n  }', c));
  ok(/if \(pushable\(a\)\)/.test(cbody), 'checkNow 用 pushable 过滤');
  ok(/urgent\.map\(riskLine\)/.test(cbody), 'checkNow 正文走 riskLine');
  // 2026-10-05：尾注不再是写死的两句话，而是 pushTail() 按私密通道现算，
  //   所以这里盯的是「两处都调用了 pushTail()」+「pushTail 两种形态的措辞都对」。
  ok(/pushTail\(\)/.test(body) && /pushTail\(\)/.test(cbody), '两处尾注都走 pushTail()（随私密通道自动切换措辞）');
  ok(/不在消息中显示/.test(H.pushTail()), '⛔ 未配私密：尾注仍明说「金额不在消息中显示」', H.pushTail().trim());
  ok(/只发你的私密机器人/.test(HP.pushTail()), '配了私密：尾注改说「只发你的私密机器人」', HP.pushTail().trim());
  ok(!/不在消息中显示/.test(HP.pushTail()), '⛔ 配了私密时不再挂"不显示金额"（那是骗人的说法）');
}

sec('⑤b 私密通道：配了才写金额，没配必须继续脱敏（2026-10-05 用户要求）');
{
  const item = { name: '测试票', code: '600000', level: 'warn', cost: 12.34, shares: 2000, price: 11.2, market: 22400, costAmt: 24680, profitAmt: -2280, floatPct: -9.24, dayPnl: -300 };
  const act = { type: '减仓', text: '建议先减半仓观察：跌破5日线10.2、主力净流出3200万', why: '触发条件：浮亏 9.24% ＞ 预警线 5%（当前 -2280 元）' };
  const pub = H.riskLine({ x: item, a: act });
  const pri = HP.riskLine({ x: item, a: act });
  ok(!/元/.test(pub), '⛔ 未配私密：正文一个「元」都不许有（默认仍是发群里）', JSON.stringify(pub.slice(0, 50)));
  ok(!/12\.34/.test(pub) && !/2000\s*股/.test(pub), '⛔ 未配私密：成本与股数依旧抹掉');
  ok(/减半仓/.test(pub) && /跌破5日线/.test(pub), '未配私密：动作与技术依据照常保留');
  ok(/11\.2/.test(pri) && /12\.34/.test(pri), '配了私密：现价与成本写出来');
  ok(/2000\s*股/.test(pri), '配了私密：股数写出来');
  ok(/浮亏\s*-2280\s*元/.test(pri), '配了私密：浮亏金额写出来', (pri.match(/浮[盈亏][^·\n]*/) || [])[0]);
  // 缺行情/缺成本时不能硬凑（price=0 会算出 -成本×股数 的巨额假亏损）
  const bad = { name: '缺数据', code: '000000', level: 'ok', cost: 0, shares: 1000, price: 0, market: 0, costAmt: 0, profitAmt: 0, floatPct: null, dayPnl: 0 };
  ok(!/浮[盈亏]/.test(HP.riskLine({ x: bad, a: { type: '持有', text: 'x', why: 'y' } })), '⛔ 缺行情时不硬凑浮盈亏金额');
}

sec('⑥ 整机脱敏闸门仍在（server.js 兜底，防以后有人写回明文）');
{
  const server = fs.readFileSync('server.js', 'utf8');
  ok(/function redactSecrets\(/.test(server), 'server.js 有 redactSecrets');
  // ⛔ 2026-10-27：旧写法只取 pushAll 头 400 字符，函数里一加注释闸门就被顶出窗口（假红）。
  //    改成括号配平取全函数体 + 剥注释，钉语义不钉字距。
  const pa = server.indexOf('function pushAll(');
  const head = (() => {
    if (pa < 0) return '';
    let d = 0, j = server.indexOf('{', pa), k = j;
    for (; k < server.length; k++) { if (server[k] === '{') d++; else if (server[k] === '}') { d--; if (d === 0) break; } }
    return server.slice(pa, k + 1).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  })();
  ok(pa > 0 && /text = redactSecrets\(text\);/.test(head), 'pushAll 首行仍挂着闸门');
}

sec('⑦ CRLF（Edit 改中文文件易引入）');
{
  ok((SV.match(/\r/g) || []).length === 0, 'holdings.js 无 CR', 'CR=' + (SV.match(/\r/g) || []).length);
}

sec('⑧ 防漂移：凡插值了金额变量的模板，脱敏后必须干净');
{
  // 上面①用的是手抄文案，源码一改测试还绿 = 假绿。这里是自动扫描，充当"谁再塞金额进来就红"的兜底。
  // ⚠️ 2026-10-02 连踩三坑，结论：别再用正则认字段名（text:/why:）来定位模板：
  //    ① 只认 `why: \`…\`` → 漏掉 goodGuard(\`…\`) 里的 L407；
  //    ② 改成"跳过一层调用外壳" → 模板其实是 goodGuard 的【实参】，跳过外壳=把模板也跳过去了，照样漏；
  //    ③ 括号平衡扫描会被模板内部的 ${Math.abs(x)} 干扰。
  //    → 最终方案：不看字段名，直接盯【承载钱的变量】——凡是插值了 profitAmt/cost/shares 的模板
  //      一律抽出来做桩替换后跑 stripAmt。钱藏在哪儿都跑不掉。
  const TPL_RE = /`(?:\\[\s\S]|[^`\\])*`/g;
  const MONEY_VAR = /\$\{[^}]*\b(?:profitAmt|cost|shares)\b[^}]*\}/;
  const stub = s => {                       // ${...} → 1234.5（不求真值，只检验形如"XXX 元/成本 XXX"）
    let out = '', i = 0;
    while (i < s.length) {
      if (s[i] === '$' && s[i + 1] === '{') {
        let d = 1, j = i + 2;
        for (; j < s.length && d > 0; j++) { if (s[j] === '{') d++; else if (s[j] === '}') d--; }
        out += '1234.5'; i = j;
      } else out += s[i++];
    }
    return out;
  };
  let m, checked = 0, bad = [], seen = [];
  while ((m = TPL_RE.exec(SV))) {
    const raw = m[0].slice(1, -1);
    if (!MONEY_VAR.test(raw)) continue;
    checked++; seen.push(raw.slice(0, 40));
    const after = H.stripAmt(stub(raw));
    if (/元|成本\s*[\d.]|\d+(\.\d+)?\s*股/.test(after)) bad.push({ src: raw.slice(0, 46), after: after.slice(0, 46) });
  }
  ok(checked >= 3, `扫到 ${checked} 条插值了金额变量的文案模板`);
  const joined = seen.join('|');
  ok(/浮动亏损/.test(joined), 'L407 止损文案（藏在 goodGuard 实参里）没被漏掉');
  ok(/浮动盈利/.test(joined), 'L467 止盈文案被扫到');
  ok(/当前成本/.test(joined), 'L379 停牌文案被扫到');
  ok(/浮盈|浮亏/.test(joined), 'L373 浮盈亏快照被扫到');
  ok(bad.length === 0, '全部模板脱敏后不再含 元/成本/股', bad.length ? JSON.stringify(bad) : '无残留');
}

console.log(`\n${fail === 0 ? '🎉' : '💥'} 持仓推送脱敏：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
