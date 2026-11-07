"use strict";
// ============================================================
// 🔒 发布闸门 _publish_gate.js（2026-10-27，防并行会话/多 agent 发布打架）
// 四道检查：
//   ① 工作区洁净 —— 已跟踪文件有未提交改动即拦截（防半成品被 pre-commit 钩子 git add -A 扫上包）
//   ② 基线对齐   —— 本地落后远端即拦截（ahead 正常放行；远端不可达只告警不阻塞）
//   ④ 引用自洽   —— server.js 调用的本地模块函数必须真被 module.exports 导出
//                    （2026-10-28 事故：调用先被提交、实现还在别人工作树，线上被 catch 吞成静默失效）
//   ③ 发布锁     —— .publish.lock（持有人PID+时间+模式），同机并发互斥；
//                    占用进程死亡或超时(30min)自动释放（正常由 release 显式释放）
// 执行顺序：① → ② → ④ → ③（锁放最后，避免检查失败还占着锁）
// 被 _publish.py 在每次 sync / --apply / --restore 前 acquire，进程退出 release。
// 守门测试：_test_publish_gate.js
// ============================================================
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const LOCK_FILE = path.join(ROOT, ".publish.lock");
const LOCK_STALE_MS = 30 * 60 * 1000;

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch (e) {
    return null;
  }
}

// ① 工作区洁净：只查已跟踪文件（untracked 交给 .gitignore 兜底）
function checkClean(shImpl) {
  const run = shImpl || sh;
  const out = run("git status --porcelain --untracked-files=no");
  if (out === null) return { ok: false, why: "git status 执行失败（非 git 仓库？）" };
  if (out.length > 0) return { ok: false, why: "工作区有未提交改动，先 commit 或 stash：\n" + out };
  return { ok: true };
}

// ② 基线对齐：拦 behind，放行 ahead，远端不可达降级为告警（绝不阻塞发布）
function checkBehind(shImpl) {
  const run = shImpl || sh;
  run("git fetch --quiet");
  const cur = run("git rev-parse --abbrev-ref HEAD");
  if (!cur) return { ok: true, warn: "无法确定当前分支，跳过基线检查" };
  let upstream = run("git rev-parse --abbrev-ref --symbolic-full-name @{u}");
  if (!upstream) {
    const remotes = run("git remote");
    if (!remotes) return { ok: true, warn: "无远端，跳过基线检查" };
    upstream = remotes.split("\n")[0].trim() + "/" + cur;
  }
  const counts = run("git rev-list --left-right --count HEAD..." + upstream);
  if (!counts) return { ok: true, warn: "远端不可达，跳过基线检查（" + upstream + "）" };
  const parts = counts.split(/\s+/).map(Number);
  const behind = parts[1] || 0;
  if (behind > 0)
    return { ok: false, why: "本地落后 " + upstream + " " + behind + " 个提交 —— 先 git pull（merge 对齐，禁 rebase）再发" };
  const ahead = parts[0] || 0;
  return { ok: true, warn: ahead > 0 ? "本地领先 " + ahead + " 个提交（正常，发布后会 push）" : undefined };
}

// ③ 发布锁
function _pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return false; }
}

// ⛔ 2026-10-27 mq 轮：锁路径可注入（第4参），供守门测试用独立锁文件。
//    背景：锁文件全局唯一，_test_publish_gate 与真实发布（或另一个测试实例）同时跑就必然红
//    「acquireLock 首次获取」——那不是闸门有问题，是测试自己撞了生产的锁。生产调用不传第4参，行为零变化。
function acquireLock(mode, now, holderPid, lockFile) {
  const lf = lockFile || LOCK_FILE;
  const ts = now || Date.now();
  const pid = holderPid || process.pid;
  try {
    if (fs.existsSync(lf)) {
      let lock = {};
      try { lock = JSON.parse(fs.readFileSync(lf, "utf8")); } catch (e) {}
      const age = ts - (lock.ts || 0);
      if (_pidAlive(lock.pid) && age < LOCK_STALE_MS) {
        const mins = Math.round(age / 60000);
        return { ok: false, why: "发布锁被 PID " + lock.pid + "（" + (lock.mode || "?") + "）占用，已运行 " + mins + " 分钟。等其完成，或确认残留后删除 .publish.lock" };
      }
      // 进程已死或超时 → 抢占释放
    }
    fs.writeFileSync(lf, JSON.stringify({ pid: pid, ts: ts, mode: mode || "sync" }));
    return { ok: true };
  } catch (e) {
    return { ok: false, why: "发布锁操作失败：" + e.message };
  }
}

function releaseLock(lockFile) {
  const lf = lockFile || LOCK_FILE;
  try { if (fs.existsSync(lf)) fs.unlinkSync(lf); } catch (e) {}
  return { ok: true };
}

// ④ 模块引用自洽（2026-10-28 新增）
//    事故背景：并行空间在 server.js 写了 `linkage.probeEndpoints(...)` 调用，但实现只在
//    `_module_linkage.js` 的**工作树**里没提交；打包提交后 HEAD 变成「调用存在、导出不存在」，
//    线上运行时被 try/catch 吞掉 → 功能静默失效，没人发现。
//    这里在发布前把「require 进来的本地模块 → 调用名」与目标文件 module.exports 逐个对齐。
//    只查 `mod.fn(` 形式；exports 解析不出来的模块（exports.foo= 写法）直接跳过，绝不误杀。
function checkExports(root) {
  const dir = root || ROOT;
  let src = "";
  try {
    src = fs.readFileSync(path.join(dir, "server.js"), "utf8");
  } catch (e) {
    return { ok: true, warn: "读不到 server.js，跳过引用自洽检查" };
  }
  const map = {};
  const reqRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\(\s*["'](\.\/[^"']+)["']\s*\)/g;
  let m;
  while ((m = reqRe.exec(src))) map[m[1]] = m[2];

  const bad = [];
  for (const varName of Object.keys(map)) {
    const rel = map[varName];
    if (!/\.js$/.test(rel)) continue;
    let modSrc = "";
    try {
      modSrc = fs.readFileSync(path.join(dir, rel), "utf8");
    } catch (e) {
      bad.push(rel + " 文件不存在（server.js 用 " + varName + " require 了它）");
      continue;
    }
    const ex = /module\.exports\s*=\s*\{([\s\S]*?)\}/.exec(modSrc);
    if (!ex) continue; // exports.foo = 形式，解析不了就跳过，不误杀
    const keys = new Set(
      ex[1].split(",").map(s => s.split(":")[0].replace(/\/\/.*$/, "").trim()).filter(Boolean)
    );
    const callRe = new RegExp("\\b" + varName.replace(/\$/g, "\\$") + "\\.([A-Za-z_$][\\w$]*)\\s*\\(", "g");
    let c;
    while ((c = callRe.exec(src))) {
      if (!keys.has(c[1])) bad.push(rel + " 未导出 " + c[1] + "，但 server.js 调用了 " + varName + "." + c[1] + "()");
    }
  }
  if (bad.length) {
    return { ok: false, why: "模块引用不自洽（调用已提交、实现未提交？）：\n   - " + [...new Set(bad)].join("\n   - ") };
  }
  return { ok: true };
}

// 汇总：mode=check 只做①②④；mode=acquire 做①②④③；opts.sh 可注入假 sh 供测试；opts.holderPid 传发布方进程PID
function gate(mode, opts) {
  opts = opts || {};
  const run = opts.sh;
  const rClean = checkClean(run);
  if (!rClean.ok) return { ok: false, stage: "clean", why: rClean.why };
  const rBehind = checkBehind(run);
  if (!rBehind.ok) return { ok: false, stage: "behind", why: rBehind.why };
  const rExp = checkExports(opts.root);
  if (!rExp.ok) return { ok: false, stage: "exports", why: rExp.why };
  if (mode === "check") return { ok: true, warn: rBehind.warn || rExp.warn };
  const rLock = acquireLock(mode, opts.now, opts.holderPid);
  if (!rLock.ok) return { ok: false, stage: "lock", why: rLock.why };
  return { ok: true, warn: rBehind.warn || rExp.warn };
}

function report(res) {
  const lines = [];
  if (res.warn) lines.push("   ⚠️ " + res.warn);
  if (!res.ok) lines.push("⛔ " + res.why);
  return lines.join("\n");
}

module.exports = { checkClean, checkBehind, checkExports, acquireLock, releaseLock, gate, report, LOCK_FILE, LOCK_STALE_MS };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const mode = argv[0] || "check";
  if (mode === "release") {
    releaseLock();
    console.log("🔒 发布锁已释放");
    process.exit(0);
  }
  const pidIdx = argv.indexOf("--pid");
  const holderPid = pidIdx >= 0 && argv[pidIdx + 1] ? Number(argv[pidIdx + 1]) : process.pid;
  const res = gate(mode === "acquire" ? "acquire" : mode, { holderPid: holderPid });
  const txt = report(res);
  if (txt) console.log(txt);
  if (!res.ok) process.exit(1);
  console.log(mode === "acquire" ? "🔒 发布闸门通过，锁已建立（PID " + holderPid + "）" : "✅ 发布闸门检查通过");
}
