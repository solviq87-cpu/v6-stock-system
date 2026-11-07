// 扫描器：错误分支里的资源与状态回滚（配合 _test_rollback.js 用）
//
// 只报事实，不定对错 —— 列出「借了什么 / 改了什么 / 谁来还 / 失败时还不还」四类清单，
// 未落实的那些要人来判断"这一步失败了会怎样"。
// ⛔ 一律在剥掉注释的版本上扫：注释里会逐字引用旧写法来解释历史 bug，扫原文全是噪音。
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const SV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const HJ = fs.readFileSync(path.join(ROOT, 'holdings.js'), 'utf8');
const { stripNoise } = require('./_codescan.js');
const K = stripNoise(SV, { keepStrings: true });
const lineOf = (src, i) => src.slice(0, i).split('\n').length;
const lineSV = i => lineOf(SV, i);

console.log('══ 错误分支里的资源与状态回滚 ══\n');

// ── ① 互斥标志：取出任务后置位、回调里才还原的，最容易「一次异常就永久卡住」 ──
console.log('【① 互斥标志】（标记 ★ = 释放写在回调/异步里，回收依赖对端一定回话）');
{
  const re = /(\w+)\s*=\s*true;/g;
  let m, n = 0, risky = 0;
  const seen = new Set();
  while ((m = re.exec(K))) {
    const name = m[1];
    if (!/(busy|Busy|running|Running|lock|Lock|inflight|Inflight|_ing\b)/.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    n++;
    // 往后 3000 字符里找这个标志被置回 false 的地方，看它是不是落在回调里
    const near = K.slice(m.index, m.index + 3000);
    const hasFinally = new RegExp('finally[\\s\\S]{0,400}' + name + '\\s*=\\s*false').test(near);
    const inCb = new RegExp('\\)\\s*=>[\\s\\S]{0,600}' + name + '\\s*=\\s*false').test(near)
      || new RegExp('function\\s*\\([\\s\\S]{0,600}' + name + '\\s*=\\s*false').test(near);
    const released = new RegExp(name + '\\s*=\\s*false').test(K.slice(m.index));
    if (!released) risky++;
    console.log(`  ${released ? ' ' : '⚠'} ${name}  L${lineSV(m.index)}  ${hasFinally ? 'finally 释放' : inCb ? '★ 回调里释放' : '（未见就近释放）'}`);
  }
  console.log(`  小计 ${n} 个标志，其中未见释放 ${risky} 个\n`);
}

// ── ② 需要回调的异步发送：回调里的失败分支只是打日志 = 对用户什么都没发生 ──
console.log('【② 回调式异步发送：失败分支有没有下文】');
{
  const pats = [
    [/feishuSend\(/g, '飞书'],
    [/sendQQMail\(/g, 'QQ邮箱'],
    [/feishuProbe\(/g, '飞书体检'],
  ];
  let n = 0, silent = 0;
  for (const [re, label] of pats) {
    let m;
    while ((m = re.exec(K))) {
      n++;
      const near = K.slice(m.index, m.index + 700);
      const hasOkBranch = /if \(ok\)|if \(r && r\.ok\)|\.then\(/.test(near);
      const failHandled = /else[\s\S]{0,200}(pushLog|_release|json\(res)|catch \(/.test(near);
      if (!hasOkBranch || !failHandled) silent++;
      console.log(`  ${hasOkBranch && failHandled ? ' ' : '⚠'} ${label}  L${lineSV(m.index)}  成功分支=${hasOkBranch} 失败有下文=${failHandled}`);
    }
  }
  console.log(`  小计 ${n} 处，失败无下文 ${silent} 处\n`);
}

// ── ③ 改了内存再落盘：失败时是"如实回错/回滚"还是"照样回成功" ──
console.log('【③ 改内存 → 落盘：有没有检查落盘结果】');
{
  const names = ['saveAccess', 'saveCfg', 'savePaper', 'saveLearn'];
  let checked = 0, unchecked = 0;
  for (const nm of names) {
    const re = new RegExp('(?<!//[^\\n]{0,200})' + nm + '\\(\\)', 'g');
    let m, c = 0, u = 0;
    while ((m = re.exec(K))) {
      const before = K.slice(Math.max(0, m.index - 60), m.index + 40);
      if (/if \(!\s*/.test(before) || /return\s+/.test(before) || /=\s*$/.test(before.trim())) c++;
      else u++;
    }
    checked += c; unchecked += u;
    console.log(`  ${nm}: 检查返回值 ${c} 处 / 未检查 ${u} 处`);
  }
  console.log(`  小计 已检查 ${checked} / 未检查 ${unchecked}`);
  console.log('  说明：未检查的多为定时器周期落盘（失败下轮还会再写，可只留痕）；');
  console.log('        但凡"改了内存还回 ok:true"的写接口，必须检查 —— 那是安全与一致性的红线。\n');
}

// ── ④ 先分配后消耗的资源：分配出去的那一步失败了，资源还回去了吗 ──
console.log('【④ 先分配后消耗的资源】');
{
  const items = [
    ['AUTH_CODES.set', 'AUTH_CODES.delete', '登录授权码（6 位，10 分钟有效，生成要推一条私密消息）'],
    ['_otp.set(', '_otp.delete(', '找回密码验证码槽位'],
    ['_srcPkg =', '（无回收：只留最近 3 个包）', '源码包（磁盘文件 + 下载令牌）'],
    ['vs.devices[', 'delete vs.devices[', '只读设备台账条目'],
    ['bag[rid] =', '（随 _vpSweep 24h 自动作废）', '只读访问申请'],
  ];
  for (const [alloc, free, desc] of items) {
    const a = (K.match(new RegExp(alloc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const f = (K.match(new RegExp(free.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    console.log(`  ${alloc} ×${a}  ←→  ${free} ×${f}   ${desc}`);
  }
  console.log('');
}

// ── ⑤ holdings.js 快照：必须存"操作之前" ──
console.log('【⑤ 回滚凭据本身对不对】');
{
  const HK = stripNoise(HJ, { keepStrings: true });
  const snapFn = HK.slice(HK.indexOf('function snapshot('), HK.indexOf('function commit('));
  const commitFn = HK.slice(HK.indexOf('function commit('), HK.indexOf('function commit(') + 900);
  console.log('  snapshot 接受外部传入的持仓：' + (/function snapshot\(reason, items\)/.test(HK) ? '是' : '否（会落当前＝改完之后的状态）'));
  console.log('  commit 传的是 before：' + (/snapshot\(act, before\)/.test(commitFn) ? '是' : '否'));
  console.log('  snapshot 落的是合并出来的那份：' + (/JSON\.stringify\(snap\)/.test(snapFn) ? '是' : '否'));
  console.log('');
}

console.log('══ 本轮已收口 ══');
console.log('  ① 飞书队列看门狗（guardMs，默认 25s）：sendOnce 不回调 / 抛异常都不再带走队列');
console.log('  ② feishuSendOnce 四条出口全部给回调 + https 请求 15s 超时');
console.log('  ③ pushAll 双通道结算：任一通道送到就不退占位（避免邮箱收到两份）');
console.log('  ④ /api/auth/redeem 先签后烧：签不出来就把授权码还回去');
console.log('  ⑤ 只读设备放行 / 拒绝 / 取走令牌：落盘失败一律撤回内存改动');
console.log('  ⑥ holdings 快照改存"操作之前" —— 一键还原真能救回被删的票');
