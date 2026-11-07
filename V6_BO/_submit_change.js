"use strict";
// ============================================================
// 📮 修改请求自助提交 _submit_change.js（2026-10-27）
// 各业务空间改完自测后运行本脚本，把修改请求写进共享收件箱：
//   C:\Users\28957\WorkBuddy\任务同步\修改请求\pending\
// 「量化看盘·发布上线」收箱汇总成待发布清单交用户确认，无需用户转达。
// 用法：
//   node _submit_change.js --space 选股体系 --files "server.js:quantPicksScan" --summary "精选池加入筹码峰过滤" --impact "仅选股链路，不动推送" --test "node --check 过 + quant_picks 守门绿" [--urgent]
// ============================================================
const fs = require("fs");
const path = require("path");
const tracker = require("./_change_tracker.js");

const BOX = "C:\\Users\\28957\\WorkBuddy\\任务同步\\修改请求\\pending";

const ARGS = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--urgent") { ARGS.urgent = true; continue; }
  if (argv[i].startsWith("--")) { ARGS[argv[i].slice(2)] = argv[i + 1]; i++; }
}

const REQUIRED = ["space", "files", "summary", "impact", "test"];
const missing = REQUIRED.filter(k => !ARGS[k]);
if (missing.length) {
  console.error("⛔ 缺少必填字段：" + missing.join(", "));
  console.error("用法：node _submit_change.js --space <空间名> --files <文件:函数,...> --summary <改动摘要> --impact <影响面> --test <自测结果> [--urgent]");
  process.exit(1);
}

fs.mkdirSync(BOX, { recursive: true });
const now = new Date();
const pad = n => String(n).padStart(2, "0");
const ts = now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate())
  + "-" + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds());
const safeSpace = String(ARGS.space).replace(/[\\/:*?"<>|\s]/g, "_").slice(0, 40);
const file = path.join(BOX, ts + "-" + safeSpace + ".md");

const md = [
  "# 修改请求：" + ARGS.space,
  "",
  "- 提交时间：" + now.toLocaleString("zh-CN", { hour12: false }),
  "- 空间/模块：" + ARGS.space,
  "- 改动文件与函数：" + ARGS.files,
  "- 改动摘要：" + ARGS.summary,
  "- 影响面：" + ARGS.impact,
  "- 自测结果：" + ARGS.test,
  "- 是否急修：" + (ARGS.urgent ? "是（线上故障级，请优先处理）" : "否"),
  "- 状态：pending（待「量化看盘·发布上线」收箱汇总）",
  ""
].join("\n");

fs.writeFileSync(file, md, "utf8");
tracker.logEvent(path.basename(file), "submitted", ARGS.urgent ? "急修" : "");
console.log("✅ 修改请求已提交：" + file);
console.log("「量化看盘·发布上线」收箱汇总、用户确认后统一发布；急修请在它的会话里同步提醒一声。");
