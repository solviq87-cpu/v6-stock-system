// 飞书机器人发送队列 —— 串行 + 最小间隔 + 限频退避重发 + 队列上限
// ---------------------------------------------------------------------------
// 为什么要有这一层（2026-09-29 线上事故）：
//   同一次 tick 里会连着触发好几类信号（竞价异动 / 补涨龙 / 选股 / 模拟盘 …），
//   原来 pushAll 是「来一条并发打一次 open.feishu.cn」，同一秒能冲出 5 条，
//   线上 push-log 实拍到：❌ 发送失败 code=9499 too many request。
//   丢的是随机一条，**丢了用户也不知道**，属于典型的静默失败。
// 所以：串行化 + 两条之间留出间隔；真撞限频了退避补发几次；补发仍失败才回调 false。
// 队列有上限 —— 宁可丢一条旧快报并记日志，也不能让内存被慢慢撑爆。
//
// 抽成独立模块是为了能单测（本项目铁律：凡是「丢了也没人知道」的逻辑都要有测试）。
//
// ⛔⛔ 2026-10-06 补（本轮角度：错误分支里的资源与状态回滚）：
//    `st.running` 是这里唯一的互斥资源 —— 取出任务时置 true、**回调里**才置回 false。
//    而 `sendOnce` 是外部传入的，只要有**任何一条出口忘了调回调**，这个标志就永久停在 true：
//      · 未配置机器人地址时 feishuSendOnce 直接 return（旧版连 cb 都不调）→ 第一条就锁死；
//      · https 请求没设超时，对端接受连接却永不响应 / socket 半开 → 回调永远不来；
//      · sendOnce 内部抛异常 → 同样没人收尾。
//    后果是整个飞书通道此后**一条都发不出去**，而且静悄悄：pushAll 照样返回 true，
//    面板推送流水里一条"已送达/失败"都没有（那是回调里才写的），用户只看到"今天没消息"。
//    实测复现：sendOnce 不回调 → 3 条消息只飞出去第 1 条，队列积压 2 条且 running 恒真。
//    现在加看门狗：guardMs 内没有回音就按失败结算、强制放行队列，并计入 stats.guarded。
'use strict';

// 判定是否属于「可以重试」的限频错误。
// 飞书自定义机器人撞频时会返回 {"code":9499,"msg":"too many request"}，
// 网关层还可能直接给 HTTP 429。其余错误（地址无效、消息格式非法、签名过期）
// 重试多少次都一样，必须立即回调失败，别把队列堵死。
const RETRYABLE = /9499|too many request|Too Many Requests|\b429\b/i;

function createQueue(sendOnce, opt) {
  const o = opt || {};
  const minGap = Number.isFinite(o.minGap) ? o.minGap : 1200;   // 两条之间最小间隔(ms)
  const maxQ = Math.max(1, o.maxQ || 200);                      // 队列上限
  const retry = Number.isFinite(o.retry) ? o.retry : 2;         // 限频补发次数
  const log = o.log || null;                                    // 形如 { warn(){}, error(){} }
  const sleepFn = o.sleep || ((ms, fn) => setTimeout(fn, ms));  // 可注入假时钟做单测
  // 看门狗时限：超过这么久还没回调就按失败结算，把 running 还回去（可用 guardMs 覆盖做测试）
  const guardMs = Number.isFinite(o.guardMs) ? o.guardMs : 25000;

  const st = { q: [], running: false, lastAt: 0, dropped: 0, retried: 0, guarded: 0 };

  function drain() {
    if (st.running) return;
    const job = st.q.shift();
    if (!job) return;
    st.running = true;
    const wait = Math.max(0, minGap - (Date.now() - st.lastAt));
    sleepFn(wait, () => runJob(job));
  }

  // 真正发起一次发送。补发时会被再次调用（每次都重新上哨），因此"已结算"标记必须每次新建。
  function runJob(job) {
    let settled = false;
    let guard = null;
    const finish = (ok, info, noRetry = false) => {
      if (settled) return;                 // 只认第一次结果：真实回调与看门狗可能都来
      settled = true;
      if (guard) { clearTimeout(guard); guard = null; }
      st.lastAt = Date.now();
      const canRetry = !noRetry && !ok && RETRYABLE.test(String(info));
      if (canRetry && (job.tries || 0) < retry) {
        job.tries = (job.tries || 0) + 1;
        st.retried++;
        const back = 1500 * job.tries;
        if (log && log.warn) log.warn(`撞飞书限频，${back}ms 后第 ${job.tries} 次补发`);
        sleepFn(back, () => runJob(job));  // 插回最前：这条已经在用户"该收到"的时间窗里了
        return;
      }
      st.running = false;                  // ⛔ 唯一把互斥资源还回去的地方
      if (job.cb) job.cb(ok, info);
      drain();
    };
    // The exact current decision is checked at every dispatch/retry, never only
    // at enqueue time. Non-recommendation jobs carry no review hook.
    if (typeof job.beforeSend === 'function') {
      try {
        const reviewed=job.beforeSend();
        if(reviewed!==true && (!reviewed || reviewed.ok!==true)) { finish(false, reviewed&&reviewed.why||'派发前审核未通过',true);return; }
      } catch (_) { finish(false,'派发前审核不可用',true);return; }
    }
    guard = setTimeout(() => {
      if (settled) return;
      st.guarded++;
      if (log && log.error) log.error(`发送超过 ${guardMs}ms 没有回音，强制放行队列（该条按失败计）`);
      finish(false, `发送超时（${guardMs}ms 未回调）`);
    }, guardMs);
    try {
      sendOnce(job.text, finish);
    } catch (e) {
      finish(false, (e && e.message) || String(e));   // 同步抛异常同样要结算，不能把队列带走
    }
  }

  function send(text, cb, opts) {
    const job = { text, cb, beforeSend:opts&&typeof opts.beforeSend==='function'?opts.beforeSend:null };
    if (st.q.length >= maxQ) {
      const drop = st.q.shift();
      st.dropped++;
      if (log && log.error) log.error('队列溢出，丢弃最旧一条未发消息: ' + String(drop && drop.text).slice(0, 60));
      if (drop && drop.cb) { try { drop.cb(false, '发送队列已满，该条被丢弃'); } catch (e) {} }
    }
    // priority：验证码 / 凭证卡有时效，不能排在几十条行情快报后面，否则用户以为没收到。
    if (opts && opts.priority) st.q.unshift(job); else st.q.push(job);
    drain();
    return st.q.length;
  }

  return {
    send,
    get size() { return st.q.length; },
    get running() { return st.running; },
    stats: () => ({ queued: st.q.length, dropped: st.dropped, retried: st.retried, guarded: st.guarded, running: st.running })
  };
}

module.exports = { createQueue, RETRYABLE };
