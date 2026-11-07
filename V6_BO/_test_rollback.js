// 错误分支里的资源与状态回滚（本轮新角度）。
//
// 前面几轮盯的是"正常路径写得对不对"，这一轮盯的是**失败那一步之后**：
//   借出去的资源还了没有？改到一半的状态撤了没有？
//
// 实测四处，每一处都不报错、不崩溃，只是"从此再也不动"或"救不回来"：
//
//  ① **飞书发送队列被一次"永不回调"永久锁死**（最严重）：feishuq 用 st.running 做互斥，
//     取出任务置 true、**回调里**才置回 false。而 sendOnce 是外部传进来的 ——
//     未配置机器人地址时 feishuSendOnce 直接 return（连回调都不调）、https 请求没设超时
//     （对端接了不回话就永远没有下文）、sendOnce 内部抛异常，这三条路都会让 running 永远停在 true。
//     从此整个飞书通道一条都发不出去，而且静悄悄：pushAll 照样回 true，
//     推送流水里一条"已送达/失败"都没有（那是回调里才写的）。实测：3 条只飞出去第 1 条。
//
//  ② **一键还原的快照存的是"删完之后"**（用户两次"持仓又没有了"的救命按钮是坏的）：
//     commit() 一律在 HOLD.items 已经改掉之后才被调用，而 snapshot 直接写 JSON.stringify(HOLD)。
//     删除一只票 → 快照里只剩剩下的；一键清空 → 快照是空列表。
//     按钮能点、流程走通、提示也说"已从备份恢复 N 条"，但数据一条都回不来 ——
//     比没有快照更糟：它会让人以为存过档了，从而不再去找别的补救办法。
//
//  ③ **双通道部分成功被当成完全失败**：飞书失败就在回调里把额度/冷却/去重退回，
//     可邮箱那条可能已经送到本人手上了 → 下一轮照原样再推一遍，邮箱收到两条一模一样的。
//     回滚判据必须是"所有启用的通道都没送到"。
//
//  ④ **改了内存、落盘失败却不撤回**：只读设备放行改了三处内存（台账多一台 + 状态改 allowed +
//     挂上令牌），saveAccess 失败时旧代码照样回 ok —— 面板显示"已放行"、对方也真能进
//     （自证令牌不查台账），而磁盘上根本没有这台设备：重启后面板看不见、也永远撤销不掉。
//     取走令牌那条更直接：删了内存没落盘 = 重启后同一个申请号能再取一次同一枚令牌。
//
// 测试尽量做成交叉校验：能真跑的就真跑（队列看门狗 + 快照内容 + 双通道结算表），
// 不能真跑的判源码顺序，并一律配旧写法反证。
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HJ = fs.readFileSync(path.join(ROOT, 'holdings.js'), 'utf8');
const FQ = fs.readFileSync(path.join(ROOT, 'feishuq.js'), 'utf8');
// ⛔ 一律在剥掉注释的版本上判"活代码"：本项目注释里会逐字引用旧写法来解释历史 bug（已踩 12 次）
const { stripNoise } = require('./_codescan.js');
const CODE_K = stripNoise(SV, { keepStrings: true });
// ⛔ holdings.js 的注释里会逐字引用旧写法 `JSON.stringify(HOLD)` 来解释这个 bug ——
//    在原文上判"旧写法是否还在"必然误伤（第 13 次踩），必须走剥注释版本。
const HJ_K = stripNoise(HJ, { keepStrings: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('对勾 ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  → ' + detail : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }
// ⛔ 语义边界取块：钉死 slice(i, i+N) 会被上游新加的注释/代码切歪（已踩多次）
function block(startMarker, endMarker) {
  const i = CODE_K.indexOf(startMarker);
  if (i < 0) return '';
  const j = endMarker ? CODE_K.indexOf(endMarker, i) : CODE_K.indexOf('\nfunction ', i + 1);
  return CODE_K.slice(i, j < 0 ? CODE_K.length : j);
}

(async () => {
  // ============================================================
  group('[1] 飞书队列：一次"永不回调"不许把整个通道锁死');
  {
    const Q = require('./feishuq.js');
    const sleep = 300;
    const mk = (sendOnce, cfg) => Q.createQueue(sendOnce, Object.assign({
      minGap: 0, maxQ: 10, retry: 0, guardMs: 60,
      sleep: (ms, fn) => setImmediate(fn),
      log: { warn() {}, error() {} }
    }, cfg || {}));

    // ① sendOnce 永不回调（= 未配置机器人地址 / 请求挂住）
    {
      const sent = [], cbs = [];
      const q = mk((text, cb) => { sent.push(text); /* 就是不回调 */ });
      q.send('第一条', (o, i) => cbs.push({ o, i }));
      q.send('第二条', (o, i) => cbs.push({ o, i }));
      q.send('第三条', (o, i) => cbs.push({ o, i }));
      await new Promise(r => setTimeout(r, sleep));
      ok('三条都发了出去（看门狗把队列放行了）', sent.length === 3, '只发了 ' + sent.length + ' 条');
      ok('队列已排空', q.size === 0, 'size=' + q.size);
      ok('running 已复位（互斥资源还回去了）', q.running === false);
      ok('看门狗计数已记录', q.stats().guarded >= 1, JSON.stringify(q.stats()));
      ok('被卡住的那几条都收到了失败回调（不静默）',
        cbs.length === 3 && cbs.every(c => c.o === false), JSON.stringify(cbs));
      ok('失败原因写明是超时', cbs.length > 0 && /超时/.test(String(cbs[0].i)), String(cbs[0] && cbs[0].i));
      // 反证：把看门狗时限改成极大值，队列必须重新锁死 —— 证明这条断言真的在测看门狗
      const q2 = mk((text, cb) => { /* 不回调 */ }, { guardMs: 60 * 60 * 1000 });
      let n2 = 0;
      q2.send('A', () => {}); q2.send('B', () => {});
      await new Promise(r => setTimeout(r, 120));
      ok('反证：没有看门狗（时限极大）时队列照样锁死', q2.running === true && q2.size === 1,
        `running=${q2.running} size=${q2.size}`);
    }
    // ② sendOnce 同步抛异常
    {
      const sent = [];
      const q = mk(() => { throw new Error('boom'); });
      let got = null;
      q.send('X', (o, i) => { got = { o, i }; });
      q.send('Y', () => { sent.push('Y'); });
      await new Promise(r => setTimeout(r, sleep));
      ok('sendOnce 抛异常也要结算（不许带走队列）', !!got && got.o === false, JSON.stringify(got));
      ok('异常之后队列仍能继续发', sent.indexOf('Y') >= 0);
      ok('异常原因被带到回调里', !!got && /boom/.test(String(got.i)), String(got && got.i));
    }
    // ③ 正常回调不受影响：看门狗不能把成功的消息误判成失败
    {
      const q = mk((text, cb) => cb(true, 'ok'), { guardMs: 40 });
      const got = [];
      q.send('A', (o) => got.push(o)); q.send('B', (o) => got.push(o));
      await new Promise(r => setTimeout(r, sleep));
      ok('正常路径全部回调成功，没被看门狗误伤', got.length === 2 && got.every(x => x === true), JSON.stringify(got));
      ok('正常路径不产生看门狗计数', q.stats().guarded === 0, JSON.stringify(q.stats()));
    }
  }

  // ============================================================
  group('[2] feishuSendOnce：每一条出口都必须给回调');
  {
    const fn = block('function feishuSendOnce(text, cb) {');
    ok('取到 feishuSendOnce 源码块', fn.length > 0);
    ok('统一走 done() 结算（只认第一次）', /const done = \(ok, info\) => \{ if \(_settled\) return;/.test(fn));
    // ⛔ 未配置机器人地址那条路：旧代码是「配了但格式错才回调，压根没配就直接 return」
    const noId = fn.slice(fn.indexOf('if (!id) {'), fn.indexOf('const payload'));
    ok('未配置分支也给了回调', /return done\(false, '未配置飞书机器人地址'\)/.test(noId));
    ok('格式错分支同样给了回调', /return done\(false, '机器人地址无效/.test(noId));
    ok('不再有裸 return（那种出口会让队列永久锁死）',
      !/^\s*return;\s*$/m.test(noId), (noId.match(/^\s*return;\s*$/m) || [''])[0]);
    ok('https 请求设了超时', /req\.setTimeout\(\s*\d+/.test(fn));
    ok('超时分支按失败结算并销毁请求', /req\.destroy\(\)/.test(fn) && /done\(false, '请求超时/.test(fn));
    ok('error 分支走 done', /req\.on\('error'[\s\S]{0,120}done\(false/.test(fn));
    // 反证
    const old = "if (!id) {\n    if (S.config && S.config.feishuWebhook) {\n      if (cb) cb(false, 'x');\n    }\n    return;\n  }";
    ok('反证：旧写法（未配置时裸 return）应当判不合格',
      /return;/.test(old) && !/未配置飞书机器人地址/.test(old));
  }

  // ============================================================
  group('[3] 双通道：任一通道送到就不许退占位（否则邮箱会收到两份）');
  {
    const push = block('function pushAll(text, force, opts) {');
    const seg0 = push.indexOf('const m = S.config.qqMail;');
    const seg1 = push.indexOf('if (!feishuReady()', seg0);
    const seg = push.slice(seg0, seg1 > 0 ? seg1 : undefined);
    ok('取到双通道结算段', seg.length > 0 && /_settle/.test(seg));
    ok('先判两个通道都有结论', /if \(_fsOk === null \|\| _mailOk === null\) return;/.test(seg));
    // ⛔ dl 轮改判据：钉语义（_release 必须排在「任一通道送到」之后，该分支里有 return），
    //    不再钉 `if (_fsOk || _mailOk) return;` 的字面量 —— 该分支现在多记一条 _pushLast。
    {
      const p1 = seg.indexOf('_fsOk || _mailOk'), p2 = seg.indexOf('_release');
      ok('任一通道送到就不回滚', p1 >= 0 && p2 > p1 && /return/.test(seg.slice(p1, p2)));
    }

    // 真跑四种组合：飞书×邮箱 的成功/失败
    const run = (fsOk, mailOn, mailOk) => new Promise(resolve => {
      const released = [];
      let fsCb = null;
      // ⚠️ 段里会用到外层的 text —— 一并作为参数注入，否则 ReferenceError
      // ⚠️ 段里用到 mailReady()（2026-10-07 收口的邮箱唯一判据）—— 必须一并注入，
      //    否则 ReferenceError 直接把套件打崩（node --check 查不出来）。
      const cfg = { qqMail: mailOn ? { user: 'a', authCode: 'b', to: 'c' } : {} };
      const _mr = () => { const m = cfg.qqMail; return !!(m && m.user && m.authCode && m.to); };
      // ⛔ fz 轮：段里多了一个 sendResultUnknown（区分"超时=结果未知"与"明确拒绝"），
      //    少注入就会 ReferenceError 把套件打崩（node --check 查不出来）。
      //    这里恒返回 false = 本组测的是「确认失败」路径；「结果未知」路径由 _test_push_unknown.js 覆盖。
      // kb 轮：pushAll 内 pushLog 的 extra 经过 _extra 包装写入 codes，沙箱里注入一个 identity 即可
      const f = new Function('text', 'S', 'feishuSend', 'sendQQMail', 'pushLog', '_release', 'mailReady', 'sendResultUnknown', '_extra', seg);
      f('测试消息', { config: cfg },
        (text, cb) => { fsCb = cb; },
        async () => { if (!mailOk) throw new Error('mail fail'); },
        () => {}, (why) => released.push(why), _mr, () => false, x => x);
      setTimeout(() => {
        fsCb(!!fsOk, fsOk ? 'ok' : 'feishu fail');
        setTimeout(() => resolve(released), 60);
      }, 20);
    });
    const r1 = await run(false, true, true);    // 飞书失败 + 邮箱成功
    ok('飞书失败但邮箱送到 → 不退占位（否则邮箱会收到两份）', r1.length === 0, JSON.stringify(r1));
    const r2 = await run(false, true, false);   // 两条都失败
    ok('飞书与邮箱都没送到 → 退占位（下轮补推）', r2.length === 1 && /都没送到/.test(r2[0]), JSON.stringify(r2));
    const r3 = await run(false, false, false);  // 只开飞书且失败
    ok('只开飞书且失败 → 退占位', r3.length === 1 && /飞书未送达/.test(r3[0]), JSON.stringify(r3));
    const r4 = await run(true, true, false);    // 飞书成功
    ok('飞书送到 → 不退占位', r4.length === 0, JSON.stringify(r4));
    // 反证：旧写法在飞书回调里直接 _release，邮箱送到也会被误退
    const old = "feishuSend(text, (ok, info) => { if (ok) pushLog('ok'); else { pushLog('fail'); _release('飞书未送达'); } });";
    ok('反证：旧写法（飞书一失败就退）确实会在邮箱已送达时误退', /_release\('飞书未送达'\)/.test(old));
  }

  // ============================================================
  group('[4] 授权码：先签发、后烧码（签不出来就把码还回去）');
  {
    const rd = block("if (p === '/api/auth/redeem' && req.method === 'POST') {");
    const iDel = rd.indexOf('AUTH_CODES.delete(code)');
    const iIssue = rd.indexOf('issueDevice(');
    ok('取到 redeem 路由块', rd.length > 0);
    ok('仍然有用后即焚', iDel >= 0);
    ok('⛔ 烧码排在签发之后（旧写法是先烧，签不出来就白烧一次）',
      iDel >= 0 && iIssue >= 0 && iDel > iIssue, `delete=${iDel} issue=${iIssue}`);
    ok('签发包在 try 里', /try \{[\s\S]{0,200}issueDevice\(/.test(rd));
    ok('签发失败时明确告诉用户码没被消耗', /没有被消耗/.test(rd));
    ok('签发失败回 ok:false 而不是把异常冒出去',
      /catch \(e\) \{[\s\S]{0,400}return json\(res, \{ ok: false/.test(rd));
    ok('签不出令牌（空值）也不烧码', /if \(!_dt \|\| !_tk\) return json\(res, \{ ok: false/.test(rd));
  }

  // ============================================================
  group('[5] 改了内存没落盘必须撤回（放行 / 取走令牌 / 拒绝）');
  {
    const appr = block("if (p === '/api/lock/pending-approve' && req.method === 'POST') {");
    const stat = block("if (p === '/api/lock/pending-status' && req.method === 'GET') {");
    ok('放行分支检查了 saveAccess 结果', /if \(!saveAccess\(\)\)/.test(appr));
    ok('放行失败撤回了台账里新加的那台设备', /delete vs\.devices\[_dkey\]/.test(appr));
    ok('放行失败撤回了申请状态与令牌', /it\.state = _pv2\.state; it\.token = _pv2\.token/.test(appr));
    ok('拒绝分支检查了 saveAccess 结果', /if \(!saveAccess\(\)\)/.test(appr));
    ok('拒绝失败撤回了状态', /it\.state = _pv; it\.doneAt = _pd;/.test(appr));
    ok('取走令牌分支检查了 saveAccess 结果', /if \(!saveAccess\(\)\)/.test(stat));
    ok('取走失败把申请原样还回内存（否则重启后同一枚令牌能被取两次）',
      /bag\[id\] = it;/.test(stat));
    // 反证：旧写法删了就删了，落盘失败也照样回成功
    const old = "delete bag[id];\n      saveAccess();\n      return json(res, { ok: true, state: 'allowed', token: tok, role: 'view' });";
    ok('反证：旧写法（删了内存就回成功，不看落盘结果）应当判不合格',
      !/if \(!saveAccess\(\)\)/.test(old));
  }

  // ============================================================
  group('[6] 快照必须存"操作之前"的持仓（一键还原的救命按钮）');
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-snap-'));
    const seed = {
      capital: 100000,
      items: [
        { code: '600905', name: '三峡能源', cost: 5.2, shares: 2000 },
        { code: '601398', name: '工商银行', cost: 6.1, shares: 1000 }
      ],
      stopPct: -8, reducePct: -4, takePct: 15, maxPosPct: 90
    };
    fs.writeFileSync(path.join(tmp, 'holdings.json'), JSON.stringify(seed));
    const HD = require('./holdings.js')({
      fs, path, dir: tmp,
      S: { stocks: [], klines: new Map() },
      em: { emit() {}, fetchBatchSnapshot: async () => [] },
      sseSend() {}, sseSendEdit() {}, pushAll: async () => ({ ok: true })
    });
    const ops0 = HD.ops(50);
    ok('起点两条持仓', (HD.raw.items || []).length === 2, String((HD.raw.items || []).length));
    HD.remove('601398');
    const rec = HD.ops(50).slice(-1)[0];
    ok('删除留了快照文件名', !!(rec && rec.snapshot), rec && String(rec.snapshot));
    ok('快照文件真的存在', !!(rec && rec.snapshot && fs.existsSync(rec.snapshot)));
    const snapItems = JSON.parse(fs.readFileSync(rec.snapshot, 'utf8')).items || [];
    const codes = snapItems.map(x => x.code);
    // ⛔ 这就是本轮最要命的一条：旧写法快照里只有"删剩下的"，被删的那只根本不在
    ok('⛔ 快照里含被删掉的那只（否则一键还原救不回来）',
      codes.indexOf('601398') >= 0, '快照里只有: ' + codes.join(','));
    ok('快照里也含没被删的那只', codes.indexOf('600905') >= 0, codes.join(','));
    // 一键还原要真能还原回两条
    const rr = HD.restore(path.basename(rec.snapshot));
    ok('一键还原返回 ok', rr && rr.ok, JSON.stringify(rr));
    ok('⛔ 还原后【被删的那只】真的回来了',
      (HD.raw.items || []).some(x => x.code === '601398'),
      (HD.raw.items || []).map(x => x.code).join(','));
    // 清空：旧写法下快照是空的，彻底救不回来
    HD.clearAll();
    const recC = HD.ops(50).slice(-1)[0];
    ok('清空也留了快照', !!(recC && recC.snapshot));
    const snapC = JSON.parse(fs.readFileSync(recC.snapshot, 'utf8')).items || [];
    ok('⛔ 清空的快照不是空列表（旧的写法下它恒为空，还原出来还是空的）',
      snapC.length >= 1, '快照条数=' + snapC.length);
    ok('清空的快照里含被清掉的那只', snapC.some(x => x.code === '601398') || snapC.some(x => x.code === '600905'),
      snapC.map(x => x.code).join(','));
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
    // 源码层面：snapshot 必须接受要保存的那一份，commit 必须传 before
    ok('snapshot 接受 items 参数', /function snapshot\(reason, items\)/.test(HJ));
    ok('快照写的是传入的那一份而不是当前 HOLD',
      /const snap = Object\.assign\(\{\}, HOLD, \{ items: Array\.isArray\(items\) \? items : HOLD\.items \}\)/.test(HJ));
    ok('commit 传的是 before', /snapshot\(act, before\)/.test(HJ));
    // 反证
    // ⚠️ 只能在 snapshot 这一段里判：saveHold() 本来就写 JSON.stringify(HOLD)（那是落当前持仓，正确）
    const snapFn = HJ_K.slice(HJ_K.indexOf('function snapshot(reason, items) {'), HJ_K.indexOf('function commit('));
    ok('snapshot 落的是合并出来的那份，不是当前 HOLD', /JSON\.stringify\(snap\)/.test(snapFn));
    ok('反证：snapshot 里不再直接写当前 HOLD（那落的是改完之后的状态）',
      snapFn.length > 0 && !/JSON\.stringify\(HOLD\)/.test(snapFn));
  }

  console.log(`\n${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
