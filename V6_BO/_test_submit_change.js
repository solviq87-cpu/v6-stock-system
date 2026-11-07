"use strict";
// 守门：修改请求自助提交 _submit_change.js（2026-10-27）
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = __dirname;
const NODE = process.execPath;
let n = 0;
function ok(cond, msg) { n++; assert(cond, "断言失败: " + msg); }

function run(args) {
  try {
    return { code: 0, out: execSync('"' + NODE + '" _submit_change.js ' + args, { cwd: ROOT, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) };
  } catch (e) {
    return { code: e.status || 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}

const BOX = "C:\\Users\\28957\\WorkBuddy\\任务同步\\修改请求\\pending";
fs.mkdirSync(BOX, { recursive: true });
const before = fs.readdirSync(BOX).length;

// ① 缺必填字段 → 拒绝（exit 1 且提示缺哪些）
const r1 = run("--space 测试空间");
ok(r1.code === 1 && r1.out.includes("缺少必填字段"), "缺字段拒绝并提示");

// ② 完整提交 → 成功 + 文件落箱
const r2 = run('--space 守门测试 --files "server.js:x" --summary "守门自测" --impact "无" --test "node --check 过"');
ok(r2.code === 0 && r2.out.includes("已提交"), "完整提交成功");
const files = fs.readdirSync(BOX).filter(f => f.includes("守门测试"));
ok(files.length >= 1, "请求文件落箱");
const content = fs.readFileSync(path.join(BOX, files[files.length - 1]), "utf8");
ok(content.includes("守门自测") && content.includes("pending") && content.includes("是否急修：否"), "落箱内容字段齐全");

// ③ --urgent → 急修标记
run('--space 守门测试急修 --files "a.js:y" --summary "急修自测" --impact "无" --test "ok" --urgent');
const files2 = fs.readdirSync(BOX).filter(f => f.includes("守门测试急修"));
ok(files2.length >= 1 && fs.readFileSync(path.join(BOX, files2[files2.length - 1]), "utf8").includes("线上故障级"), "urgent 标记正确");

// ④ 空间名 sanitize（特殊字符不炸文件名）
run('--space "选/股*体?系" --files "a.js:z" --summary "sanitize" --impact "无" --test "ok"');
const sf = fs.readdirSync(BOX).filter(f => f.includes("选_股_体_系"));
ok(sf.length >= 1 && fs.readFileSync(path.join(BOX, sf[sf.length - 1]), "utf8").includes("sanitize"), "特殊字符空间名 sanitize 落箱");

// 清理守门自测产物（只删守门测试自己提交的三种文件名，绝不动真实请求）
for (const f of fs.readdirSync(BOX)) {
  if (f.includes("守门测试") || f.includes("选_股_体_系")) fs.unlinkSync(path.join(BOX, f));
}
ok(fs.readdirSync(BOX).length === before, "守门自测产物已清理");

console.log("PASS " + n + " 断言  _test_submit_change.js");
// ⛔ 标准汇总行：_runall 总榜只认「N 通过 / M 失败」等四种写法（只打 PASS N 断言会被判零断言→假红）
console.log("结果：" + n + " 通过 / 0 失败");
