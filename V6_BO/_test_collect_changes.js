"use strict";
// 守门：修改请求收箱器 _collect_changes.js（2026-10-27）
const fs = require("fs");
const path = require("path");
const os = require("os");
const assert = require("assert");

// 隔离联动状态文件，防止测试污染真实 changes_state.json
process.env.CHANGES_STATE_FILE = path.join(os.tmpdir(), "collect-changes-state-test-" + Date.now() + ".json");

const C = require("./_collect_changes.js");
let n = 0;
function ok(cond, msg) { n++; assert(cond, "断言失败: " + msg); }

// 沙箱目录（绝不碰真实收件箱）
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "collect-test-"));

// ① parseRequest 解析提交脚本生成的 md 格式
const md = [
  "# 修改请求：选股体系", "",
  "- 提交时间：2026/10/27 22:00:00",
  "- 空间/模块：选股体系",
  "- 改动文件与函数：server.js:quantPicksScan",
  "- 改动摘要：精选池加入筹码峰过滤",
  "- 影响面：仅选股链路",
  "- 自测结果：node --check 过",
  "- 是否急修：否",
  "- 状态：pending（待「量化看盘·发布上线」收箱汇总）", ""
].join("\n");
const r1 = C.parseRequest(md, "a.md");
ok(r1.space === "选股体系" && r1.files === "server.js:quantPicksScan" && r1.summary.includes("筹码峰"), "parseRequest 字段解析");
ok(r1.urgent === false, "urgent=false 解析");
const mdUrgent = md.replace("是否急修：否", "是否急修：是（线上故障级，请优先处理）");
ok(C.parseRequest(mdUrgent, "b.md").urgent === true, "urgent=true 解析");

// ①b 状态解析：pending / confirmed / published-版本号 / rejected
ok(C.parseRequest(md, "a.md").status === "pending", "状态 pending 解析");
ok(C.parseRequest(md.replace("状态：pending（待", "状态：confirmed（已确认"), "b.md").status === "confirmed", "状态 confirmed 解析");
ok(C.parseRequest(md.replace("状态：pending（待", "状态：published-20261027mq"), "b.md").status.indexOf("published") === 0, "状态 published-版本号 解析");
ok(C.parseRequest(md.replace("状态：pending（待", "状态：rejected（已驳回"), "b.md").status === "rejected", "状态 rejected 解析");

// ② diffNew 只挑未通知的
const all = [{ file: "a.md" }, { file: "b.md" }, { file: "c.md" }];
ok(C.diffNew(all, ["a.md"]).length === 2 && C.diffNew(all, ["a.md"])[0].file === "b.md", "diffNew 过滤已通知");

// ③ buildListHtml 含全部行、急修红底、转义
const html = C.buildListHtml([
  { ts: "t", space: "选股体系", files: "s.js:x", summary: "含<script>", impact: "无", test: "ok", urgent: true },
  { ts: "t2", space: "推送模块", files: "p.js:y", summary: "普通", impact: "无", test: "ok", urgent: false }
], "2026-10-27");
ok(html.includes("待发布清单 2026-10-27") && html.includes("共 2 个请求"), "清单标题与计数");
ok(html.includes("&lt;script&gt;") && !html.includes("<script>"), "HTML 转义防注入");
ok(html.includes("fdecea") && html.includes("🔥急修"), "急修红底标记");
ok(html.indexOf("选股体系") < html.indexOf("推送模块"), "按文件名排序输出");

// ③b 发布看板：四区分区 + 统计 + 状态徽标
const board = C.buildBoardHtml([
  { ts: "t", space: "选股体系", files: "s.js:x", summary: "改A", impact: "无", test: "ok", urgent: true, status: "pending" },
  { ts: "t2", space: "推送模块", files: "p.js:y", summary: "改B", impact: "无", test: "ok", urgent: false, status: "pending" },
  { ts: "t3", space: "复盘模块", files: "r.js:z", summary: "改C", impact: "无", test: "ok", urgent: false, status: "confirmed" },
  { ts: "t4", space: "竞价模块", files: "a.js:w", summary: "改D", impact: "无", test: "ok", urgent: false, status: "published-20261027mq" }
], "2026-10-27");
ok(board.includes("待你确认") && board.includes("已确认 · 待发布") && board.includes("已发布") && board.includes("已驳回"), "看板四分区齐全");
ok(board.indexOf("待你确认") < board.indexOf("已确认 · 待发布"), "分区按流转顺序排列");
ok(board.includes("已发布 20261027mq"), "已发布卡片显示版本号");
ok(board.includes("border-left:4px solid #e53e3e"), "急修卡片红边标记");
ok(board.includes("待确认 <b>2</b>") && board.includes("已确认待发布 <b>1</b>"), "顶部统计正确");
ok(board.indexOf("改A") < board.indexOf("改B"), "看板卡片区内排序稳定");

// ④ notifyNew 注入假 post：成功/失败分流 + private:true + 正文含清单路径
let captured = [];
const fakePost = (host, pth, obj) => {
  captured.push({ host, pth, obj });
  return Promise.resolve({ ok: true, body: { ok: obj.text.indexOf("失败样例") < 0 } });
};
C.notifyNew([
  { file: "a.md", space: "选股体系", summary: "改动A", files: "s.js", impact: "无", urgent: false, dateStr: "2026-10-27" },
  { file: "b.md", space: "推送模块", summary: "失败样例", files: "p.js", impact: "无", urgent: true, dateStr: "2026-10-27" }
], "TOKEN", fakePost).then(res => {
  ok(res.ok.length === 1 && res.ok[0] === "a.md", "notifyNew 成功分流");
  ok(res.fail.length === 1 && res.fail[0] === "b.md", "notifyNew 失败分流");
  ok(captured.length === 3 && captured[0].pth === "/api/push-note", "单推2条+汇总1条打线上 push-note 路由");
  ok(captured[0].obj.private === true && captured[0].obj.token === "TOKEN", "私密+令牌透传");
  ok(captured[0].obj.text.includes("改动A"), "单推正文含改动摘要");
  ok(captured[2].obj.title.includes("汇总"), "≥2条时追加汇总推送");
  ok(captured[2].obj.text.includes("选股体系") && captured[2].obj.text.includes("推送模块"), "汇总含全部新请求");

  // ⑤ main 端到端（沙箱 + dry）：新请求被识别、清单文件生成、dry 不写状态
  fs.writeFileSync(path.join(SANDBOX, "20261027-220000-选股体系.md"), md, "utf8");
  const listDir = path.join(SANDBOX, "list");
  C.main({ box: SANDBOX, listDir: listDir, dry: true, token: "T", postImpl: fakePost, now: new Date(2026, 9, 27, 22, 30) }).then(m1 => {
    ok(m1.newCount === 1 && m1.total === 1, "main dry 识别新请求");
    ok(fs.existsSync(path.join(listDir, "待发布清单-2026-10-27.html")), "main 生成当日清单文件");
    ok(m1.notified.length === 0 && m1.failed.length === 1, "main dry 不实际通知");

    // ⑥ main 实跑（非 dry）：通知成功落状态，二次跑不再重复通知
    return C.main({ box: SANDBOX, listDir: listDir, dry: false, token: "T", postImpl: fakePost, now: new Date(2026, 9, 27, 22, 31) }).then(m2 => {
      ok(m2.notified.length === 1, "main 实跑通知成功");
      ok(fs.existsSync(path.join(SANDBOX, ".notified.json")), "已通知名单落盘");
      return C.main({ box: SANDBOX, listDir: listDir, dry: false, token: "T", postImpl: fakePost, now: new Date(2026, 9, 27, 22, 32) });
    }).then(m3 => {
      ok(m3.newCount === 0 && m3.total === 1, "二次运行不重复通知");
      for (const f of fs.readdirSync(SANDBOX)) {
        const p = path.join(SANDBOX, f);
        fs.statSync(p).isDirectory() ? fs.rmSync(p, { recursive: true }) : fs.unlinkSync(p);
      }
      fs.rmdirSync(SANDBOX);
      console.log("PASS " + n + " 断言  _test_collect_changes.js");
      // ⛔ 标准汇总行：_runall 总榜只认「N 通过 / M 失败」等四种写法（只打 PASS N 断言会被判零断言→假红）
      console.log("结果：" + n + " 通过 / 0 失败");
    });
  }).catch(e => { console.error(e); process.exit(1); });
}).catch(e => { console.error(e); process.exit(1); });
