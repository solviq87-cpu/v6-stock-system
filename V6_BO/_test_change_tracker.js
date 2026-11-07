"use strict";
// 守门：修改请求联动追踪器 _change_tracker.js
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

const C = require("./_change_tracker.js");
let n = 0;
function ok(cond, msg) { n++; assert(cond, "断言失败: " + msg); }

// 用临时 state 文件，不污染真实数据
const TMP_STATE = path.join(os.tmpdir(), "changes-state-test-" + Date.now() + ".json");
C.setStateFile(TMP_STATE);

// ① logEvent / getTimeline
const t1 = C.logEvent("20261027-220000-选股体系.md", "submitted", "急修");
ok(t1.events.length === 1 && t1.events[0].stage === "submitted", "submitted 事件记录");
C.logEvent("20261027-220000-选股体系.md", "notified");
C.logEvent("20261027-220000-选股体系.md", "confirmed");
C.logEvent("20261027-220000-选股体系.md", "published", "20261027mq");
const tl = C.getTimeline("20261027-220000-选股体系.md");
ok(tl.events.length === 4, "时间线累计 4 个事件");
ok(C.hasStage(tl, "published") && C.lastStageDetail(tl, "published") === "20261027mq", "published 详情=版本号");

// ② 多请求隔离
C.logEvent("20261027-220001-推送模块.md", "submitted");
ok(C.getTimeline("20261027-220001-推送模块.md").events.length === 1, "多请求事件隔离");

// ③ buildLinkageBoardHtml 含四区/时间线/版本号
const html = C.buildLinkageBoardHtml([
  { file: "20261027-220000-选股体系.md", ts: "t", space: "选股体系", files: "s.js:x", summary: "改A", impact: "无", test: "ok", urgent: true, status: "pending" },
  { file: "20261027-220001-推送模块.md", ts: "t2", space: "推送模块", files: "p.js:y", summary: "改B", impact: "无", test: "ok", urgent: false, status: "pending" }
], "2026-10-27");
ok(html.includes("提交") && html.includes("通知") && html.includes("确认") && html.includes("发布") && html.includes("复核"), "联动看板五节点齐全");
ok(html.includes("已闭环") || html.includes("进行中"), "状态徽标存在");
ok(html.includes("20261027mq"), "已发布版本号显示");
ok(html.includes("border-left:4px solid #e53e3e"), "急修红边");

// 清理
fs.unlinkSync(TMP_STATE);
console.log("PASS " + n + " 断言  _test_change_tracker.js");
// ⛔ 标准汇总行：_runall 总榜只认「N 通过 / M 失败」等四种写法（只打 PASS N 断言会被判零断言→假红）
console.log("结果：" + n + " 通过 / 0 失败");
