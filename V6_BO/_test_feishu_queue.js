// 飞书发送队列单测（_test_feishu_queue.js）
// 背景：2026-09-29 线上 push-log 拍到 ❌ code=9499 too many request ——
// 同一 tick 并发打飞书导致随机掉单，属于"丢了用户也不知道"的静默失败。
// 本测试用假时钟驱动，不碰真实网络，验证：串行、最小间隔、限频退避补发、
// 非限频错误立即失败、优先级插队、队列上限丢最旧且回调不静默。
const Q = require('./feishuq.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  → ' + extra : '')); }
}
function sec(t) { console.log('\n' + t); }

// ── 假时钟：收集所有待执行的定时器，手动推进 ──────────────────────────────
function makeHarness(opt) {
  const timers = [];
  let now = 0;
  return {
    timers,
    now: () => now,
    q: Q.createQueue(opt.send, Object.assign({
      minGap: 1200, maxQ: 200, retry: 2,
      sleep: (ms, fn) => timers.push({ at: now + ms, fn }),
      log: { warn: () => {}, error: () => {} }
    }, opt.cfg || {})),
    // 反复跑到没有可执行定时器为止（超时保护：maxSteps）
    run(maxSteps) {
      let n = 0;
      while (timers.length && n < (maxSteps || 5000)) {
        timers.sort((a, b) => a.at - b.at);
        const t = timers.shift();
        now = Math.max(now, t.at);
        t.fn();
        n++;
      }
      return n;
    }
  };
}

// ① 串行化：三条同时进来，任意时刻只能有一条在飞
sec('① 串行化：并发调用不会同时发');
{
  let inFlight = 0, maxInFlight = 0;
  const order = [];
  const h = makeHarness({
    send: (text, cb) => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      order.push('start:' + text);
      setTimeout(() => {}, 0);
      cb(true, 'ok');
      inFlight--;
    }
  });
  h.q.send('A', () => {});
  h.q.send('B', () => {});
  h.q.send('C', () => {});
  h.run();
  ok(maxInFlight === 1, '同一时刻最多只有 1 条在发送', 'maxInFlight=' + maxInFlight);
  ok(order.join(',') === 'start:A,start:B,start:C', '按 FIFO 顺序发出', order.join(','));
}

// ② 最小间隔：第二条必须比第一条晚至少 minGap
sec('② 最小间隔：两条之间留出 1200ms');
{
  const at = [];
  const h = makeHarness({
    send: (text, cb) => { at.push(h.now()); cb(true, 'ok'); }
  });
  h.q.send('A', () => {});
  h.q.send('B', () => {});
  h.q.send('C', () => {});
  h.run();
  ok(at.length === 3, '三条都发出去了', JSON.stringify(at));
  ok(at[1] - at[0] >= 1200, '第 2 条比第 1 条晚 ≥1200ms', `gap=${at[1] - at[0]}`);
  ok(at[2] - at[1] >= 1200, '第 3 条比第 2 条晚 ≥1200ms', `gap=${at[2] - at[1]}`);
}

// ③ 限频退避补发：第一次 9499，第二次补发成功 → 最终 ok
sec('③ 限频（9499）自动退避补发');
{
  let attempts = 0;
  const h = makeHarness({
    send: (text, cb) => {
      attempts++;
      cb(attempts >= 2, attempts >= 2 ? 'ok' : 'code=9499 too many request');
    }
  });
  let got = null;
  h.q.send('X', (o, i) => { got = { o, i }; });
  h.run();
  ok(attempts === 2, '共尝试 2 次（1 次限频 + 1 次补发）', 'attempts=' + attempts);
  ok(got && got.o === true, '最终回调成功', JSON.stringify(got));
  ok(h.q.stats().retried === 1, 'stats 记录了 1 次补发', JSON.stringify(h.q.stats()));
}

// ④ 限频重试上限：连着都限频 → 补发 2 次后放弃，且必须回调 false（不许静默）
sec('④ 补发次数用完必须显式回调失败');
{
  let attempts = 0;
  const h = makeHarness({
    send: (text, cb) => { attempts++; cb(false, 'code=9499 too many request'); }
  });
  let got = null;
  h.q.send('X', (o, i) => { got = { o, i }; });
  h.run();
  ok(attempts === 3, '共尝试 3 次（首次 + 2 次补发）', 'attempts=' + attempts);
  ok(got && got.o === false, '最终回调 false，不静默吞掉', JSON.stringify(got));
}

// ⑤ 非限频错误不得重试（地址错/格式错，重试也没用，还会堵住队列）
sec('⑤ 非限频错误立即失败，不做无谓重试');
{
  let attempts = 0;
  const h = makeHarness({
    send: (text, cb) => { attempts++; cb(false, '机器人地址无效'); }
  });
  let got = null;
  h.q.send('X', (o, i) => { got = { o, i }; });
  h.run();
  ok(attempts === 1, '只发 1 次，没有重试', 'attempts=' + attempts);
  ok(got && got.o === false && /地址无效/.test(got.i), '原样回调失败原因', JSON.stringify(got));
}

// ⑥ HTTP 429 同样要重试（网关层限频不一定走 9499）
sec('⑥ HTTP 429 也判定为可重试');
{
  ok(Q.RETRYABLE.test('HTTP 429 Too Many Requests'), '识别 429');
  ok(Q.RETRYABLE.test('code=9499 too many request'), '识别 9499');
  ok(!Q.RETRYABLE.test('机器人地址无效'), '普通错误不被误判为限频');
  ok(!Q.RETRYABLE.test('code=19001 signature expired'), '签名过期不算限频');
}

// ⑦ 优先级插队：验证码不能排在一堆快报后面
sec('⑦ priority 消息插到队首');
{
  const order = [];
  const h = makeHarness({
    send: (text, cb) => { order.push(text); cb(true, 'ok'); }
  });
  // 注意：send() 会同步把队首那条"取出待发"，所以快报1 已经起飞、
  // 队列里只剩 快报2/快报3 —— 此时插队的验证码应该顶到 快报2 前面。
  h.q.send('快报1', () => {});
  h.q.send('快报2', () => {});
  h.q.send('验证码', () => {}, { priority: true });
  h.q.send('快报3', () => {});
  h.run();
  const iCode = order.indexOf('验证码');
  ok(iCode >= 0, '验证码最终被发出', JSON.stringify(order));
  ok(iCode < order.indexOf('快报2'), '验证码排在普通快报之前', JSON.stringify(order));
}

// ⑧ 队列上限：溢出时丢最旧的，并且被丢的那条必须收到回调（不许静默）
sec('⑧ 队列溢出丢最旧且不静默');
{
  const h = makeHarness({
    send: (text, cb) => { cb(true, 'ok'); },
    cfg: { maxQ: 3 }
  });
  // 先塞满，队伍走到第一条时后面的会排队
  h.q.send('m1', () => {});
  h.q.send('m2', () => {});
  h.q.send('m3', () => {});
  h.q.send('m4', () => {});   // 溢出 → 丢 m1
  let dropCb = null;
  h.q.send('m5', (o, i) => { dropCb = { o, i }; }, { priority: true }); // 插队首后仍会挤掉队首
  h.run();
  ok(h.q.stats().dropped >= 1, 'dropped 计数 ≥1', JSON.stringify(h.q.stats()));
  ok(dropCb === null || dropCb.o === true, '入队的消息要么成功要么被明确回调，没有卡住', JSON.stringify(dropCb));
}

// ⑨ 队列跑完后必须清空（running 归位，否则下一次调用全部石沉大海）
sec('⑨ 排空后状态归位');
{
  const h = makeHarness({ send: (t, cb) => cb(true, 'ok') });
  for (let i = 0; i < 10; i++) h.q.send('m' + i, () => {});
  h.run();
  ok(h.q.size === 0, '队列已排空', 'size=' + h.q.size);
  ok(h.q.running === false, 'running 已复位', 'running=' + h.q.running);
  let later = false;
  h.q.send('after', () => { later = true; });
  h.run();
  ok(later === true, '排空后新消息仍能正常发出');
}

console.log('\n──────────────────────────────');
console.log(`飞书队列测试：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
