"use strict";
// 守门：发布看板 API _release_api.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

process.env.CHANGES_STATE_FILE = path.join(os.tmpdir(), "release-state-test-" + Date.now() + ".json");

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "release-box-"));
const LIST_SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "release-list-"));
process.env.RELEASE_BOX = SANDBOX;
process.env.RELEASE_LIST_DIR = LIST_SANDBOX;

const R = require("./_release_api.js");
const tracker = require("./_change_tracker.js");
let n = 0;
function ok(cond, msg) { n++; assert(cond, "断言失败: " + msg); }

// ① parseRequest
const md = [
  "# 修改请求：选股体系", "",
  "- 提交时间：2026/10/27 22:00:00",
  "- 空间/模块：选股体系",
  "- 改动文件与函数：server.js:x",
  "- 改动摘要：加筹码",
  "- 影响面：选股",
  "- 自测结果：ok",
  "- 是否急修：否",
  "- 状态：pending（待确认）", ""
].join("\n");
const r1 = R.parseRequest(md, "a.md");
ok(r1.space === "选股体系" && r1.summary === "加筹码" && r1.urgent === false && r1.status === "pending", "parseRequest 基础解析");

// ② loadRequests
fs.writeFileSync(path.join(SANDBOX, "20261027-220000-选股体系.md"), md, "utf8");
const list = R.loadRequests();
ok(list.length === 1 && list[0].file === "20261027-220000-选股体系.md" && list[0].events.length === 0, "loadRequests 读取并带空时间线");

// ③ updateRequest：改状态行 + 记录事件 + 刷新看板
const u = R.updateRequest("20261027-220000-选股体系.md", "confirmed", "");
ok(u.ok && u.stage === "confirmed", "updateRequest 返回 ok");
const md2 = fs.readFileSync(path.join(SANDBOX, "20261027-220000-选股体系.md"), "utf8");
ok(md2.includes("- 状态：confirmed"), "md 状态行已改");
const tl = tracker.getTimeline("20261027-220000-选股体系.md");
ok(tl.events.some(e => e.stage === "confirmed"), "tracker 记录了 confirmed 事件");
ok(fs.existsSync(path.join(LIST_SANDBOX, "发布看板.html")) && fs.existsSync(path.join(LIST_SANDBOX, "联动链路看板.html")), "刷新看板文件已生成");

// ④ 非法 stage 拦截
let threw = false;
try { R.updateRequest("20261027-220000-选股体系.md", "hack", ""); } catch (e) { threw = true; }
ok(threw, "非法 stage 抛出异常");

// 清理
for (const f of fs.readdirSync(SANDBOX)) fs.unlinkSync(path.join(SANDBOX, f));
fs.rmdirSync(SANDBOX);
for (const f of fs.readdirSync(LIST_SANDBOX)) fs.unlinkSync(path.join(LIST_SANDBOX, f));
fs.rmdirSync(LIST_SANDBOX);
try { fs.unlinkSync(process.env.CHANGES_STATE_FILE); } catch {}

console.log("PASS " + n + " 断言  _test_release_api.js");
// ⛔ 标准汇总行：_runall 总榜只认「N 通过 / M 失败」等四种写法（只打 PASS N 断言会被判零断言→假红）
console.log("结果：" + n + " 通过 / 0 失败");
