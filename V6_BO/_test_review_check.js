#!/usr/bin/env node
/**
 * _test_review_check.js —— 复核器纯函数守门（不联网、不依赖真实时钟）
 * 钉三件事：①版本后缀解析 ②文档文件识别 ③硬项/提示项的 PASS-FAIL 口径
 */
"use strict";
const R = require("./_review_check.js");
let n = 0, fail = 0;
function ok(cond, msg) { n++; if (!cond) { fail++; console.error("✗ " + msg); } }

// ① verSuffix
ok(R.verSuffix("20261027na") === "na", "verSuffix 取尾两字母");
ok(R.verSuffix("20261027mr") === "mr", "verSuffix 换版本仍正确");
ok(R.verSuffix("") === "xx", "空版本兜底 xx，不崩");
ok(R.verSuffix(null) === "xx", "null 兜底 xx，不崩");

// ② isDocFile：只把真文档算「不影响发布」
ok(R.isDocFile("任务同步/复核请求/x.md") === true, "任务同步下 md 算文档");
ok(R.isDocFile("_release_notes_na.json") === true, "发布说明数据 json 算文档");
ok(R.isDocFile("README.md") === true, ".md 算文档");
ok(R.isDocFile("server.js") === false, "server.js 不算文档");
ok(R.isDocFile("public/index.html") === false, "index.html 不算文档");
ok(R.isDocFile("_review_check.js") === false, "新增脚本不算文档（改代码要认账）");

// ③ summarize：硬项失败必 FAIL，仅提示项失败仍 PASS
const allOk = [
  { name: "a", ok: true },
  { name: "b", ok: true, required: false },
];
let s = R.summarize(allOk);
ok(s.ok === true && s.failed === 0, "全绿 → PASS");
ok(s.hard === 1 && s.total === 2, "提示项不计入硬项数");

const softFail = [
  { name: "a", ok: true },
  { name: "tip", ok: false, required: false },
];
s = R.summarize(softFail);
ok(s.ok === true, "仅提示项失败 → 仍 PASS（不因工作树脏/未推齐就判死）");
ok(s.failed === 0, "提示项失败不进失败计数");

const hardFail = [
  { name: "appVer", ok: true },
  { name: "pushRole", ok: false },
];
s = R.summarize(hardFail);
ok(s.ok === false, "硬项失败 → FAIL");
ok(s.failedNames.length === 1 && s.failedNames[0] === "pushRole", "失败项点名准确");

// ④ 判不出不硬判：缺 actual 的失败项也必须算失败
s = R.summarize([{ name: "线上 lock/status", ok: false }]);
ok(s.ok === false, "探测失败（判不出）→ 计为不通过，绝不默认成功");

// ④b 回归：四端必须读「目标版本 bump 提交」的 blob，不许读工作树
//     （2026-10-28 09:20 na 复核假红事故：工作树已推进到后续版本 → 四端全部误报未含 na）
ok(typeof R.readAtVer === "function", "导出 readAtVer（按版本读 blob）");
ok(R.bumpCommit("20261028mv").length >= 7, "能定位 mv 的 bump 提交");
ok(R.readAtVer("server.js", "20261028mv").includes("20261028mv"), "旧版本 mv：从 bump blob 读到版本号");
ok(R.readAtVer("public/sw.js", "20261028mv").includes("20261028mv"), "旧版本 mv：sw.js 同样按 blob 读");
ok(R.readAtVer("server.js", "20261027na").includes("20261027na"), "更早的 na 也能按 blob 复核（工作树已前进也不假红）");

// ⑤ renderMd 必须写明结论与方式，不得留空
const md = R.renderMd(
  { ver: "20261027na", at: new Date(2026, 9, 28, 9, 30), checks: [{ name: "线上 appVer", ok: true, actual: "20261027na", expected: "20261027na" }], summary: { total: 1, hard: 1, failed: 0, ok: true, failedNames: [] } },
  "测试说明"
);
ok(md.includes("复核通过") && md.includes("20261027na"), "结果文档含结论与版本");
ok(md.includes("不读取发布方自检结论"), "结果文档声明独立性");
ok(md.includes("判不出不硬判"), "结果文档写明判定口径");

if (fail === 0) {
  console.log("PASS " + n + " 断言  _test_review_check.js");
  console.log("结果：" + n + " 通过 / 0 失败");
  process.exit(0);
} else {
  console.error("FAIL " + fail + " / " + n + " 断言  _test_review_check.js");
  console.log("结果：" + (n - fail) + " 通过 / " + fail + " 失败");
  process.exit(1);
}
