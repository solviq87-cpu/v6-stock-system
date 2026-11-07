"use strict";
// 守门：发布闸门 _publish_gate.js（2026-10-27，防并行会话/多 agent 发布打架）
// ① 语法+导出  ② checkClean 净/脏/git失败三态  ③ checkBehind 拦behind/放ahead/无远端降级
// ④ 发布锁 获取→占用拒绝→释放→重获取 + 死pid/超时自动抢占  ⑤ LIVE 当前仓库应洁净
// ⑥ _publish.py 已接入 acquire/release  ⑦ .gitignore 拦三份运行时产物
// ⑧ 模块引用自洽 checkExports（2026-10-28 新增第④道闸，7 断言 + 闸门整链 stage=exports）
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = __dirname;
let n = 0;
function ok(cond, msg) { n++; assert(cond, "断言失败: " + msg); }

const gate = require("./_publish_gate.js");
ok(typeof gate.checkClean === "function", "导出 checkClean");
ok(typeof gate.checkBehind === "function", "导出 checkBehind");
ok(typeof gate.acquireLock === "function", "导出 acquireLock");
ok(typeof gate.releaseLock === "function", "导出 releaseLock");
ok(typeof gate.gate === "function", "导出 gate");

// ② checkClean 三态
ok(gate.checkClean(() => "").ok === true, "checkClean 干净放行");
const dirty = gate.checkClean(() => " M server.js");
ok(dirty.ok === false && /未提交改动/.test(dirty.why), "checkClean 脏拦截");
ok(gate.checkClean(() => null).ok === false, "checkClean git 失败拦截");

// ③ checkBehind 三态（注入假 sh，按命令内容分派）
function mkSh(map) {
  return (cmd) => (cmd in map ? map[cmd] : null);
}
const baseMap = {
  "git fetch --quiet": "",
  "git rev-parse --abbrev-ref HEAD": "master",
  "git rev-parse --abbrev-ref --symbolic-full-name @{u}": "gitee/master",
};
const TAB = String.fromCharCode(9); // 真实 tab，避免源码转义序列在传输中被改写
ok(gate.checkBehind(mkSh(Object.assign({}, baseMap, { "git rev-list --left-right --count HEAD...gitee/master": "2" + TAB + "0" }))).ok === true,
  "behind 检查：ahead 放行");
const rb = gate.checkBehind(mkSh(Object.assign({}, baseMap, { "git rev-list --left-right --count HEAD...gitee/master": "0" + TAB + "3" })));
ok(rb.ok === false && /落后/.test(rb.why), "behind>0 拦截并提示先 pull");
ok(gate.checkBehind(mkSh({ "git fetch --quiet": "", "git rev-parse --abbrev-ref HEAD": "master", "git rev-parse --abbrev-ref --symbolic-full-name @{u}": null, "git remote": "" })).ok === true,
  "无远端降级放行（不阻塞发布）");

// ④ 发布锁全生命周期
// ⛔ 2026-10-27 mq 轮：改用【独立锁文件】（os.tmpdir 下按 pid 命名），不再动生产的 .publish.lock。
//    原来这里直接用 gate.LOCK_FILE：只要同一时刻有真实发布（或这个套件的第二个实例）持有锁，
//    第一条「acquireLock 首次获取」就必然红 —— 实测 4 个实例并发跑，稳定 1 红。那是测试撞了生产的锁，
//    不是闸门有问题。生产调用不传第 4 参，行为零变化。
const tmp = path.join(require('os').tmpdir(), '.publish_gate_test_' + process.pid + '.lock');
try { fs.unlinkSync(tmp); } catch (e) {}
ok(gate.acquireLock("sync", 1000, process.pid, tmp).ok === true, "acquireLock 首次获取");
const r2 = gate.acquireLock("sync", 2000, process.pid, tmp);
ok(r2.ok === false && /占用/.test(r2.why), "锁占用拒绝二次获取");
gate.releaseLock(tmp);
ok(gate.acquireLock("sync", 3000, process.pid, tmp).ok === true, "释放后重新获取");
gate.releaseLock(tmp);
fs.writeFileSync(tmp, JSON.stringify({ pid: 999999, ts: Date.now(), mode: "sync" }));
ok(gate.acquireLock("sync", Date.now(), process.pid, tmp).ok === true, "死 pid 残留锁自动抢占");
gate.releaseLock(tmp);
fs.writeFileSync(tmp, JSON.stringify({ pid: process.pid, ts: Date.now() - 31 * 60000, mode: "sync" }));
ok(gate.acquireLock("sync", Date.now(), process.pid, tmp).ok === true, "超时锁（>30min）自动抢占");
gate.releaseLock(tmp);
ok(!fs.existsSync(tmp), "releaseLock 后锁文件已删");

// ⑤ 洁净判据：先钉逻辑（可注入 sh，确定性），再看真实仓库的【代码】维度
ok(gate.checkClean(() => " M server.js").ok === false, "闸门把「代码有未提交改动」判为脏");
ok(gate.checkClean(() => "").ok === true, "闸门对干净工作区放行");
ok(gate.checkClean(() => null).ok === false, "git status 执行失败时按脏处理（不静默放行）");
// ⛔ 2026-10-27 mq 轮改钉（一次教训）：原来这条直接断言「此刻真实仓库洁净」。
//    它在单跑时恒绿、在 _runall 并发跑时恒红 —— 因为并发套件会在同一毫秒里改文件/持有 git 索引，
//    采样结果取决于"谁恰好在那一瞬间"，加 3 次重试也没救（说明脏在整个运行窗口内都存在）。
//    ⛔ 判不出不硬判：并发环境下"实时洁净"根本无法可靠判定，硬采样只会造出一条天天假红的断言，
//    而假红会训练人忽略红灯 —— 比没有这条断言更糟。
//    真正要守的是【判据本身对不对】，那三条已经用可注入 sh 钉死了；真实脏区拦截由 _publish.py
//    在发布时调 checkClean() 执行（每次发版必走，那里只有单一进程，不存在并发窗口）。
//    这里只留一条不依赖时序的静态断言：闸门被 _publish.py 真的调用（下方 ⑥）。

// ⑥ 接线：_publish.py __main__ 已调闸门 acquire/release
const pub = fs.readFileSync(path.join(ROOT, "_publish.py"), "utf8");
ok(pub.includes("_publish_gate.js"), "_publish.py 引用发布闸门");
ok(pub.includes("acquire") && pub.includes("release"), "_publish.py acquire+release 接线");

// ⑦ .gitignore 拦三份运行时产物
const gi = fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8");
ok(gi.includes(".holdings_push.json"), ".gitignore 拦 .holdings_push.json");
ok(gi.includes("stock_industry.json"), ".gitignore 拦 stock_industry.json");
ok(gi.includes("_selfcheck_learn.js"), ".gitignore 拦 _selfcheck_learn.js");

// ⑧ 模块引用自洽（2026-10-28 新增第④道闸）
//    事故：server.js 写了 linkage.probeEndpoints() 调用并先被提交，实现还留在别人工作树没提交，
//    HEAD 变成「调用在、导出不在」，线上被 try/catch 吞掉 → 功能静默失效。
ok(typeof gate.checkExports === "function", "导出 checkExports");
{
  const os = require("os");
  const mk = (serverSrc, modSrc, modName) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "gate4-"));
    fs.writeFileSync(path.join(d, "server.js"), serverSrc, "utf8");
    if (modSrc !== null) fs.writeFileSync(path.join(d, modName || "_module_linkage.js"), modSrc, "utf8");
    return d;
  };
  const CASES = [];
  const bad = mk('const linkage = require("./_module_linkage.js");\nlinkage.probeEndpoints("u");\n',
                 "function inferModules(){}\nmodule.exports = { inferModules };\n");
  const good = mk('const linkage = require("./_module_linkage.js");\nlinkage.probeEndpoints("u");\n',
                  "function inferModules(){}\nasync function probeEndpoints(){}\nmodule.exports = { inferModules, probeEndpoints };\n");
  const missing = mk('const linkage = require("./_module_linkage.js");\nlinkage.inferModules([]);\n', null);
  const alt = mk('const em = require("./em.js");\nem.fetchX();\n', "exports.fetchX = function(){};\n", "em.js");
  const prop = mk('const cfg = require("./cfg.js");\nconst x = cfg.port;\n', "module.exports = { port: 1 };\n", "cfg.js");
  CASES.push(bad, good, missing, alt, prop);

  const r1 = gate.checkExports(bad);
  ok(r1.ok === false && /未导出 probeEndpoints/.test(r1.why), "调用存在但未导出 → 拦截");
  ok(gate.checkExports(good).ok === true, "导出齐全 → 放行（不误杀）");
  ok(gate.checkExports(missing).ok === false && /文件不存在/.test(gate.checkExports(missing).why), "被 require 的模块文件不存在 → 拦截");
  ok(gate.checkExports(alt).ok === true, "exports.foo= 写法解析不了 → 跳过不误判");
  ok(gate.checkExports(prop).ok === true, "数据属性访问不当作函数调用 → 不误杀");
  ok(gate.checkExports().ok === true, "LIVE 当前仓库引用自洽（发版前必过）");

  // 闸门整链：exports 失败要带 stage='exports'，不能被前两道掩盖
  const fakeSh = (cmd) => {
    if (/status --porcelain/.test(cmd)) return "";
    if (/fetch/.test(cmd)) return "";
    if (/rev-parse --abbrev-ref HEAD/.test(cmd)) return "master";
    if (/symbolic-full-name/.test(cmd)) return "gitee/master";
    if (/rev-list/.test(cmd)) return "0\t0";
    return "";
  };
  const r7 = gate.gate("check", { sh: fakeSh, root: bad });
  ok(r7.ok === false && r7.stage === "exports", "闸门整链 exports 失败时 stage=exports");
  ok(/probeEndpoints/.test(r7.why), "拦截原因点名缺哪个导出");

  CASES.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
}

// ⛔ 2026-10-27 mq 轮：汇总行必须是总榜认得的写法。
//    原来打的是 `PASS N 断言`，而 _runall 只认「N 通过 / M 失败」「通过 N、失败 M」「N 项：…」，
//    于是这条明明全绿，在总榜上一直被计成「无输出 → 计红（断言失败 1）」，白红了好几轮。
//    断言失败会 assert 抛错中断，所以能走到这里就是 0 失败。
console.log(n + " 通过 / 0 失败  _test_publish_gate.js");
