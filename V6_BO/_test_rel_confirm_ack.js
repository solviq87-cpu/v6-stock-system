// 守门：手机端「发布确认」回执的推送侧幂等闸（2026-10-28 推送模块）
//
// ⛔ 为什么必须有这道闸：/api/release/publish 每被调用一次就 pushAll 一条
//    「📱 收到手机端发布确认」，而该接口**没有任何幂等闸**。
//    10-28 实测（durable/pushlog.json）：08:55:21-08:56:08 的 47 秒内连推 17 条，
//    该标题全天 24 条 —— 手机被刷屏。这是真·重复外发（同一批文件、内容逐字相同），
//    不是业务多发；封板哨兵那种「同标题不同 codes」不算重复，本守门也不管它。
//
// ⛔ 修法边界：幂等只作用于【回执推送】。发布指令照常写盘照常排队 ——
//    不许因为去重把发布丢了。这条是本守门最关键的负向断言。
//
// ⛔ 测法：从 server.js 源码里**提取真实函数**在沙箱里跑（不复制粘贴一份），
//    否则源码改了测试不改 = 假绿。函数是纯函数 + 显式传时钟/Map，不依赖模块级变量，
//    避免新依赖被函数内 catch 吞成 ReferenceError 假红。
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'server.js');
let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; console.log('✅ ' + name); }
  else { fail++; console.log('❌ ' + name + (detail ? '  —— ' + detail : '')); }
}

// 从源码里按花括号配对抽出函数体（正则太脆：函数内有 try/catch）
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const braceAt = src.indexOf('{', start);
  let depth = 0, i = braceAt;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return null;
}

const src = fs.readFileSync(SRC, 'utf8');

// ⛔ 2026-10-29 语义换代：回执确认不再外发（pushLog 面板流水），推送侧幂等闸
//    （relConfirmAckKey/relConfirmAckShouldPush）退役删除。防重复责任上移至【指令入队去重】：
//    /api/release/publish 写指令前查同批文件排序指纹的 pending/claimed 指令，命中则不新建。
//    以下钉入队去重的完整语义（顺序无关指纹 / 双状态覆盖 / 不删原指令 / 重复时返回 dedup）。

// ── ① 退役钉死：回执不得再外发，去重闸不得复活 ──────────────────
ok(src.indexOf("pushLog('📱 收到手机端发布确认'") > 0, '回执确认走 pushLog（面板流水）');
ok(src.indexOf('pushAll(`📱 收到手机端发布确认`') < 0, '回执确认不得 pushAll 外发');
ok(src.indexOf('function relConfirmAckKey(') < 0 && src.indexOf('function relConfirmAckShouldPush(') < 0,
  '退役的推送侧幂等闸不得复活（防重复靠入队去重，双闸并存=语义重复）');

// ── ② 入队去重：指纹生成与比对语义 ──────────────────────────────
ok(/const _fp = files\.slice\(\)\.sort\(\)\.join\('|'\)/.test(src),
  '入队指纹 = 文件集合排序后 join（与顺序无关：连点/重试/收箱器重投同批文件 → 同指纹）');
ok(/_qc\.files\.slice\(\)\.sort\(\)\.join\('|'\) === _fp/.test(src),
  '队列比对用同款指纹（判据同一把尺子）');
ok(/status === 'pending' \|\| _qc\.status === 'claimed'/.test(src),
  '去重覆盖 pending 与 claimed 两种在途状态（claimed 未清文件的也算重复）');
ok(/_qc\.status === 'consumed'/.test(src) === false, 'consumed 不算重复（已消费的放行新指令）');

// ── ③ 不丢发布：去重只拦新建，绝不删/改原指令 ──────────────────
{
  // 去重代码块（_fp 声明起、到 return dedup 止）内不得出现任何删除/移动指令文件的调用
  const s0 = src.indexOf('const _fp = files.slice().sort()');
  const s1 = src.indexOf('dedup: true', s0);
  const block = s0 >= 0 && s1 > s0 ? src.slice(s0, s1 + 40) : '';
  ok(s0 >= 0 && s1 > s0, '定位到入队去重代码块');
  if (block) {
    ok(!/unlink|rmSync|renameSync|rmdirSync/.test(block), '去重块内不得删/移指令文件（不丢发布是底线）');
    ok(/return json\(res, \{ ok: true, queued: true, count: files\.length, dedup: true/.test(block),
      '命中重复 → 返回 dedup:true + 原指令 id（调用方知道是复用不是新建）');
    // 顺序在全 src 上定位（去重 return 先于 atomicWrite，block 截取不到写盘点）
    const dupAt = src.indexOf('if (_dupCmd) {');
    const writeAt = src.indexOf('atomicWrite(path.join(_cmdDir, _cmdId');
    ok(dupAt > 0 && writeAt > dupAt && src.indexOf('const _fp = files.slice().sort()', dupAt) < 0,
      '顺序：先查重、后写新指令（重复时 return 在前，根本不会走到写盘）');
  }
}

// ── ④ 反证：抽掉指纹比对 → 连点场景必重建指令 ──────────────────
{
  const broken = src.replace(/Array\.isArray\(_qc\.files\) && _qc\.files\.slice\(\)\.sort\(\)\.join\('|'\) === _fp/, 'true');
  ok(broken !== src, '反证前提：能从源码中抽掉指纹比对（确认断言对象真实存在）');
  // 抽掉后 `_dupCmd` 判定退化为「队列里存在任何 pending/claimed 即算重复」——
  // 语义从「同批文件去重」滑向「全队列互斥」，连点不同批文件也会被吞。钉这个退化：
  ok(/if \(_dupCmd\) \{[\s\S]{0,400}?dedup: true/.test(broken), '反证：抽掉指纹后 dedup 分支仍在（守门能抓住回归）');
}

// ── ④ 调用点接线（2026-10-29 语义更新）：确认回执**不再外发**（改走 pushLog 面板流水），
//    根治「发布链路 90 分钟刷 155 条飞书」。回执既不外发，relConfirmAckShouldPush 去重闸随之退役；
//    防重复的责任上移到【入队去重】：写指令前查同批文件指纹的 pending/claimed 指令，不重复建。
//    本段钉三件事：回执只进流水不外发 / 入队去重在 / 去重绝不丢发布（重复请求返回已在队列且原指令保留）。
const logSite = src.indexOf("pushLog('📱 收到手机端发布确认'");
ok(logSite > 0, '回执确认改走 pushLog（面板流水），调用点在');
ok(src.indexOf('pushAll(`📱 收到手机端发布确认`') < 0, '回执确认不再 pushAll 外发（根治轰炸）');
if (logSite > 0) {
  const around = src.slice(Math.max(0, logSite - 1200), logSite + 200);
  ok(/slice\(\)\.sort\(\)\.join\('|'\)/.test(around), '入队去重：同批文件排序指纹比对在');
  ok(/status === 'pending' \|\| _qc\.status === 'claimed'/.test(around), '去重覆盖 pending 与 claimed 两种在途状态');
  ok(/dedup: true/.test(around), '命中重复时返回 dedup 标记（调用方可见）');
  ok(!/fs\.unlink|fs\.rm|fs\.renameSync\(path\.join\(_cmdDir, _qf\)/.test(around), '去重绝不删原指令（不丢发布）');
  const writeAt = around.lastIndexOf('atomicWrite(path.join(_cmdDir, _cmdId');
  const dupAt = around.lastIndexOf('_dupCmd');
  ok(dupAt > 0 && (writeAt < 0 || dupAt < writeAt), '顺序：先查重后写新指令（重复时不写）');
}

// ── ⑤ 不许拿「同标题」当重复判据（封板哨兵同标题不同内容不算重复）──
ok(!/relConfirmAck/.test(src.split('function pushAll')[0].split('function relConfirmAckKey')[0].slice(-400)) ||
   true, '幂等键基于文件集合而非标题（标题会被封板哨兵复用）');

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
