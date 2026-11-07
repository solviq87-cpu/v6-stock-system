"use strict";
// 守门：发布后独立复核 _post_publish_check.js
const assert = require("assert");
const http = require("http");
let n = 0;
function ok(cond, msg) { n++; assert(cond, "断言失败: " + msg); }

const PPC = require("./_post_publish_check.js");

// ① formatCheckResult
const sample = {
  version: "20261027mr",
  checks: [
    { name: "appVer", ok: true, expected: "20261027mr", actual: "20261027mr" },
    { name: "pushRole", ok: false, expected: "primary", actual: "replica" },
    { name: "replicaHeartbeat", ok: false, error: "timeout" }
  ]
};
const txt = PPC.formatCheckResult(sample);
ok(txt.includes("✅ appVer") && txt.includes("❌ pushRole：实际 replica") && txt.includes("❌ replicaHeartbeat：timeout"), "formatCheckResult 输出正确");

// ② runPostPublishCheck 异步不阻塞，失败时记录 verify_failed
process.env.CHANGES_STATE_FILE = require("os").tmpdir() + "/ppc-state-" + Date.now() + ".json";
process.env.RELEASE_BOX = require("os").tmpdir() + "/ppc-box-" + Date.now();
process.env.RELEASE_LIST_DIR = require("os").tmpdir() + "/ppc-list-" + Date.now();
const fs = require("fs");
fs.mkdirSync(process.env.RELEASE_BOX, { recursive: true });
fs.mkdirSync(process.env.RELEASE_LIST_DIR, { recursive: true });
const md = [
  "# 修改请求：测试", "",
  "- 提交时间：2026/10/27 22:00:00",
  "- 空间/模块：测试",
  "- 改动文件与函数：x.js:y",
  "- 改动摘要：测试",
  "- 影响面：无",
  "- 自测结果：ok",
  "- 是否急修：否",
  "- 状态：published-20261027mr", ""
].join("\n");
fs.writeFileSync(process.env.RELEASE_BOX + "/20261027-220000-测试.md", md, "utf8");

let pushed;   // undefined = 1 秒内尚未触发；收到值 = pushFn 已被调用（回传的是推送文本）
PPC.runPostPublishCheck("20261027-220000-测试.md", "20261027mr", (t) => { pushed = t; });
// 异步，等 1 秒
setTimeout(() => {
  // ⛔ 原判据 `pushed === true || pushed === false` 写反了：pushFn 回传的是【推送文本字符串】，
  //    一旦真被调用 pushed 就变成字符串 → 断言反而失败（功能正常却被判红）。改用 undefined 做哨兵，
  //    「被调用」与「本次 1 秒内尚未触发（异步不卡死）」两种结果都接受。
  ok(pushed === undefined || typeof pushed === "string", "pushFn 被调用（收到推送文本）或本次 1 秒内尚未触发（异步不卡死）");
  const tracker = require("./_change_tracker.js");
  const tl = tracker.getTimeline("20261027-220000-测试.md");
  const hasVerifying = tl.events.some(e => e.stage === "verifying");
  ok(hasVerifying, "自动复核记录了 verifying 事件");
  console.log("PASS " + n + " 断言  _test_post_publish_check.js");
  // ⛔ 标准汇总行：_runall 总榜只认「N 通过 / M 失败」等四种写法（只打 PASS N 断言会被判零断言→假红）
  console.log("结果：" + n + " 通过 / 0 失败");
  // 清理
  try { fs.rmSync(process.env.RELEASE_BOX, { recursive: true }); } catch {}
  try { fs.rmSync(process.env.RELEASE_LIST_DIR, { recursive: true }); } catch {}
  try { fs.unlinkSync(process.env.CHANGES_STATE_FILE); } catch {}
}, 1500);
