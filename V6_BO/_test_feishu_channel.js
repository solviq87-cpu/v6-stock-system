// 守门：飞书通道可更换（2026-10-03 用户要求）
// 起因：用户说"飞书 app 的通道不太好，把它改成可以更改"。查下来旧实现有三处坑，
//       每一个都会让人"改了却不知道改没改成功"：
//   ① 地址格式不对 → 服务端【静默丢弃】还返回 ok:true，前端提示"已保存"，实际走的还是旧机器人；
//   ② 换地址只能赌一把，等下一次定时推送才知道通不通（期间信号全丢）；
//   ③ 面板只有"已保存"三个字，看不出当前生效的是哪一个机器人。
// 本测试要盯住：格式错必报错并保留原通道 / 支持先验后换 / 面板能看到打码地址 / 失败原因说人话。
const fs = require('fs');
const SV = fs.readFileSync('server.js', 'utf8');
// The locked homepage loads the maintained external application script.
const HTML = fs.readFileSync('public/index.html', 'utf8') + '\n' + fs.readFileSync('public/assets/app.js', 'utf8');
// ⛔ 判执行顺序要在剥掉注释的版本上做：注释里会引用"现有通道未被改动"这类旧文案来解释历史 bug，
//   直接 indexOf 整份源文件会命中注释 → 位置全错（本项目已踩 7 次）。
const { stripNoise } = require('./_codescan.js');
const SVC = stripNoise(SV, { keepStrings: true });
let pass = 0, fail = 0;
const ok = (c, n, g) => { if (c) { pass++; console.log('  ✅ ' + n + (g !== undefined ? '  → ' + g : '')); } else { fail++; console.log('  ❌ ' + n + '  → ' + g); } };
const sec = t => console.log('\n' + t);

// ── 把 server.js 里的四个函数抠出来跑真的行为测试（不是对着源码做字符串断言）──
function grabFn(name) {
  const i = SV.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = SV.indexOf('\nfunction ', i + 1);
  return SV.slice(i, j > 0 ? j : SV.length);
}
const FULL = 'https://open.feishu.cn/open-apis/bot/v2/hook/db0f169a-66ca-4bf5-94e1-0a00c5e30198';
const _S = { config: { feishuWebhook: FULL, feishuSecret: '' } };
const _crypto = { createHmac: () => ({ update: () => ({ digest: () => 'FAKESIGN' }) }) };
let api;
try {
  // hw 轮：飞书 text 载荷过 stripHtmlTags（纯文本通道不许带 <b>），沙箱必须一起带上
  const src = ['maskHook', 'feishuMask', 'feishuProbe', 'feishuErrTip', 'stripHtmlTags'].map(grabFn).join('\n');
  // ⚠️ require 必须显式注入：new Function 造出的作用域里没有 require，
  //    feishuProbe 那句 `_https || require('https')` 会直接 ReferenceError。
  //    注入真实的 require 也不影响隔离 —— 下面所有用例都传了假 https，短路不求值。
  api = new Function('crypto', 'S', 'require', 'classifyFeishuReceipt', src + '\nreturn { maskHook, feishuMask, feishuProbe, feishuErrTip };')(_crypto, _S, require, require('./src/core/feishu-receipt').classifyFeishuReceipt);
} catch (e) { console.log('  ❌ 无法提取函数：' + e.message); fail++; }

sec('① 打码：要认得出是哪一台，又不能泄露完整地址');
if (api) {
  const m = api.maskHook(FULL);
  ok(m.indexOf('****') > 0, '中间被打码', m);
  ok(!/db0f169a-66ca-4bf5-94e1-0a00c5e30198/.test(m), '完整地址没有出现在打码结果里');
  ok(!/66ca-4bf5/.test(m), '中段-UUID 片段也没泄露', m);
  ok(api.maskHook(FULL) === api.feishuMask(), 'feishuMask() 与 maskHook(当前地址) 一致', api.feishuMask());
  ok(api.maskHook('') === '(未配置)', '空串不炸且有默认文案', JSON.stringify(api.maskHook('')));
  ok(api.maskHook(null) === '(未配置)', 'null 不炸');
  ok(typeof api.maskHook('https://xxx/hook/ab') === 'string', '超短 ID 不炸', api.maskHook('https://xxx/hook/ab'));
}

sec('② 体检消息：成功 / 限流 / 网络异常 / 机器人失效 都能如实回报');
if (api) {
  const stub = (replyObj, errKind) => ({
    request: (opts, cb) => {
      const res = { statusCode:200, _h: {}, on(ev, fn) { this._h[ev] = fn; return this; } };
      const req = { _h: {}, on(ev, fn) { this._h[ev] = fn; return this; }, destroy() {}, end() {
        setTimeout(() => {
          if (errKind === 'error') { if (req._h.error) req._h.error(new Error('ENOTFOUND boom')); return; }
          if (errKind === 'timeout') { if (req._h.timeout) req._h.timeout(); return; }
          res._h.data && res._h.data(JSON.stringify(replyObj));
          res._h.end && res._h.end();
        }, 0);
      } };
      cb(res);
      return req;
    }
  });
  const run = async () => {
    const good = await api.feishuProbe('abc123', '', null, stub({ code: 0, msg: 'success' }));
    ok(good.ok === true, 'code=0 → 判定成功', JSON.stringify(good));
    const limited = await api.feishuProbe('abc123', '', null, stub({ code: 9499, msg: 'too many request' }));
    ok(limited.ok === false && /9499/.test(limited.msg), '9499 限流 → 失败且带回飞书原话', limited.msg);
    const killed = await api.feishuProbe('abc123', '', null, stub({ code: 19001, msg: 'bot not exist' }));
    ok(killed.ok === false && /19001/.test(killed.msg), '机器人不存在 → 失败', killed.msg);
    const net = await api.feishuProbe('abc123', '', null, stub(null, 'error'));
    ok(net.ok === false && /ENOTFOUND/.test(net.msg), '网络异常 → 失败并说清原因', net.msg);
    const to = await api.feishuProbe('abc123', '', null, stub(null, 'timeout'));
    ok(to.ok === false && /超时/.test(to.msg), '超时 → 失败并说超时', to.msg);
    // 参数顺序回归：业务侧的自然写法是 (id, 密钥, 文案)。曾经把注入用的假 https
    // 排在第三位，业务侧一传文案就把字符串灌进注入口 → mod.request is not a function。
    const biz = await api.feishuProbe('abc123', '', '这是一条正常的体检文案', stub({ code: 0 }));
    ok(biz.ok === true, '业务侧按 (id,密钥,文案) 调用必须成功（注入口只能排最后）', JSON.stringify(biz));
    // 体检只许 STAT：不能把候选地址写进 S.config（体检归体检，落盘归落盘）
    ok(_S.config.feishuWebhook === FULL, '体检不改动当前配置', _S.config.feishuWebhook.slice(-8));
    // 路径里必须带机器人 ID，别把消息推到别人的机器人上
    let seenPath = '';
    await api.feishuProbe('TARGETID9', '', null, { request: (o, cb) => { seenPath = o.path; return { on() { return this; }, destroy() {}, end() { setTimeout(() => { cb({ on(ev, fn) { if (ev === 'end') setTimeout(fn, 0); } }); }, 0); } }; } });
    ok(/\/hook\/TARGETID9$/.test(seenPath), '请求路径指向被体检的那个机器人', seenPath);
  };
  (async () => {
    await run();
    sec('③ 错误要说人话 + 给出下一步');
    ok(/限流|限频/.test(api.feishuErrTip('code=9499 too many request')), '9499 → 提示限流/等一等', api.feishuErrTip('code=9499 too many request').slice(0, 20));
    ok(/签名/.test(api.feishuErrTip('code=19021 sign not match')), '签名错 → 提示检查密钥');
    ok(/失效|机器人|解散/.test(api.feishuErrTip('code=19001 bot not exist')), '机器人不存在 → 提示重机器人');
    ok(/超时/.test(api.feishuErrTip('请求超时（8 秒无响应）')), '超时 → 提示查网络');
    ok(typeof api.feishuErrTip('') === 'string' && api.feishuErrTip('').length > 5, '空串也给出兜底指引');

    sec('④ 服务端：地址不对必须报错，绝不能静默放过');
    {
      // ⚠️ 别只拿 p === '/api/config' 去搜：6683 行的"需编辑权限白名单"里也有同样的片段，
      //    那样会截到错误的位置，断言全部假阴性。必须连 req.method === 'POST' 一起锚。
      const i = SV.indexOf("p === '/api/config' && req.method === 'POST'");
      if (i < 0) { ok(false, '找不到 /api/config POST 处理块'); }
      const body = SVC.slice(i, i + 3600);
      ok(/return json\(res, \{ ok: false, error: '机器人地址格式不对/.test(body), '格式不对 → 返回 ok:false + 原因');
      ok(/现有通道未被改动/.test(body), '体检没过 → 明确说"现有通道未被改动"');
      ok(/if \(fv === ''\)[\s\S]{0,80}feishuWebhook = ''/.test(body), '显式传空串 → 停用（且有门可出）');
      // 别去断言"注释里写了啥"——注释不是行为。真正要保证的是【执行顺序】：
      // 体检 → 失败立即返回 → 成功才落盘。顺序一颠倒就会出现"体检没过却照样换了地址"。
      const iProbe = body.indexOf('await feishuProbe(');
      const iRet = body.indexOf('现有通道未被改动');
      // ⛔ 2026-10-06 改：地址不再直接写进 S.config，而是先攒进 _pending（先算后写），
      //    全批体检通过后由 `for (const k of Object.keys(_pending)) S.config[k] = ...` 统一落地。
      //    所以"顺序不可颠倒"现在要验的是：体检在写 _pending 之前，且统一落地在体检之后。
      const iSet = body.indexOf('_pending.feishuWebhook = fv;', iProbe);
      // ⛔ 统一落地那句在路由尾部，3600 字符的窗口够不着；
      //    别把 body 整体拉长（会把别处的同类片段框进来），单独按语义边界（下一个路由）切一段。
      const _jNxt = SVC.indexOf("if (p === '/api/", i + 20);
      const bodyFull = SVC.slice(i, _jNxt > i ? _jNxt : SVC.length);
      const iApply = bodyFull.indexOf('for (const k of Object.keys(_pending)) S.config[k]');
      ok(iProbe > 0, '保存新地址前会先体检');
      ok(iRet > iProbe, '体检失败的信息紧跟体检之后');
      ok(iSet > iRet, '只有体检通过后才会写地址（顺序不可颠倒）', 'probe@' + iProbe + ' ret@' + iRet + ' set@' + iSet);
      ok(iApply > iSet && iApply > iRet, '⛔ 地址先攒进 _pending，最后统一落 S.config（不再先写内存后体检）',
        'set@' + iSet + ' apply@' + iApply);
      ok(!/S\.config\.feishuWebhook\s*=/.test(body), '⛔ 活代码里不再直接给 S.config.feishuWebhook 赋值');
      // 反向：不许再出现"既不匹配又不报错"的静默分支
      const silent = /feishuWebhook = fv;\s*\}\s*else if \(fv === ''\)[\s\S]{0,40}\}\s*$/m.test(body);
      ok(!silent, '没有残留"不匹配就什么都不做"的静默分支');
    }
    ok(/p === '\/api\/feishu\/probe'/.test(SV), '有独立的体检接口 /api/feishu/probe');
    {
      const i = SV.indexOf("p === '/api/feishu/probe'");
      ok(SV.slice(i, i + 700).includes('requireEditor'), '体检接口要编辑权限（不能被只读账号乱打机器人）');
    }
    ok(/feishuMask: feishuMask\(\)/.test(SV), '/api/state 暴露了打码地址');

    sec('⑤ 自检推送：改成等飞书真实回包，不再"点了就算成功"');
    {
      const i = SV.indexOf("p === '/api/test-push'");
      // ⛔ 别写死字符窗口（已踩第 8 次）：往这段里加长一句中文文案，
      //    就能把窗口末尾的 feishuErrTip 挤出去 → 断言假红。改成按语义边界切到下一个路由。
      const _jNxt2 = SV.indexOf("if (p === '/api/", i + 20);
      const body = SV.slice(i, _jNxt2 > i ? _jNxt2 : SV.length);
      ok(/feishuProbe\(/.test(body), '自检走真实回包路径');
      ok(/ok: !!r\.ok/.test(body), '返回值的 ok 来自飞书回包而非硬编码 true');
      ok(/feishuErrTip\(r\.msg\)/.test(body), '失败时带上人话提示');
      // ⛔ 2026-10-28 改钉：自检改「私密优先」后流水标题分成三态
      //    （✅ 已送达(私密) / ✅ 已送达 / ❌ 发送失败），旧正则只认 `r.ok ? '✅ 已送达'`
      //    精确开头 → 假红。判据钉语义：成败都写流水，且如实记下体检的是哪条通道。
      ok(/pushLog\([^)]*✅ 已送达/.test(body) && /❌ 发送失败/.test(body),
        '无论成败都记进推送流水（排障有据）');
      ok(/\{\s*channel: _ch/.test(body), '流水里记明体检的是哪条通道（私密/公开不混）');
    }

    sec('⑥ 面板：能看见当前是哪个机器人 + 换新地址走"先验后换"');
    ok(/s\.feishuMask \|\| '已配置'/.test(HTML), '状态徽标显示打码地址');
    ok(!/getElementById\('webhook'\)\.value = '\(已保存\)'/.test(HTML), '不再把输入框填成"(已保存)"（那三个字看不出是谁）');
    ok(/body\.verify = true/.test(HTML), '新地址保存时请求先验通再替换');
    ok(/留空=保持/.test(HTML), '输入框提示"留空=保持现有通道"');
    ok(/已停用飞书通道/.test(HTML), '有停用入口的明确回执');
    ok(/r\.error \|\| '服务端未说明原因'/.test(HTML), '保存失败把服务端原因念出来');
    ok(/r\.tip/.test(HTML), '自检失败把排查建议显示出来');

    sec('⑦ 版本号一致 + 行尾');
    {
      const a = (SV.match(/APP_VER = '([^']+)'/) || [])[1];
      const b = (HTML.match(/APP_VER = '([^']+)'/) || [])[1];
      ok(a && a === b, '前后端 APP_VER 一致', a + ' / ' + b);
      ok((SV.match(/\r/g) || []).length === 0, 'server.js 无 CR');
      ok((HTML.match(/\r/g) || []).length === 0, 'index.html 无 CR');
    }

    console.log(`\n${fail === 0 ? '🎉' : '💥'} 飞书通道可更换：${pass} 通过 / ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  })();
}
