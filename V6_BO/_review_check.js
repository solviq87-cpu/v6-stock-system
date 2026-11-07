#!/usr/bin/env node
/**
 * _review_check.js —— 发布独立复核器（脚本化实测，不做任何猜测）
 *
 * 定位：给「复核方」用的一次命令工具。它只做一件事——自己把线上/本机/主干的事实拉一遍，
 *       逐项判定，全绿才 PASS。**它不读发布方的任何自检结论**（不 require _post_publish_check）。
 *
 * 用法：
 *   node _review_check.js                          # 版本默认取工作树 server.js 的 APP_VER
 *   node _review_check.js --ver 20261027na         # 指定版本
 *   node _review_check.js --ver 20261027na --write # 通过/不通过都写 任务同步/复核结果/*.md
 *
 * 退出码：0 = 全部通过；1 = 有任一硬项不通过（含探测失败，判不出按不通过处理，不硬判）
 *
 * 铁律：
 *   - 判不出不硬判：探测失败写「未取得」并计为不通过，绝不默认成功。
 *   - 只读：绝不改 APP_VER、不改业务代码、不触发发布。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;
const ONLINE = "https://quant-dashboard-77614.app.workbuddy.host";
const LOCAL = "http://127.0.0.1:8787";
const RESULT_DIR = "C:/Users/28957/WorkBuddy/任务同步/复核结果";
const FOUR_END = ["server.js", "public/index.html", "public/mobile.html", "public/sw.js"];

// ---------- 纯函数（可测） ----------
function verSuffix(ver) {
  const m = String(ver || "").match(/([a-z]{2})$/);
  return m ? m[1] : "xx";
}
function isDocFile(f) {
  return /\.(md|txt)$/i.test(f) || /_release_notes[^/]*\.json$/i.test(f) || /^任务同步\//.test(f);
}
function summarize(checks) {
  const hard = checks.filter((c) => c.required !== false);
  const failed = hard.filter((c) => !c.ok);
  return { total: checks.length, hard: hard.length, failed: failed.length, ok: failed.length === 0, failedNames: failed.map((c) => c.name) };
}

// ---------- IO ----------
function sh(cmd) {
  try {
    // ⛔ maxBuffer 必须放大：server.js 已超 1MB，execSync 默认 1MB 会抛错，
    //    被 catch 吞掉后静默回退到工作树 → 旧版本复核假红（2026-10-28 09:20 na 事故同源）。
    return execSync(cmd, { cwd: ROOT, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch (e) {
    return "";
  }
}
function readVer() {
  try {
    const s = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
    const m = s.match(/const APP_VER\s*=\s*'([0-9a-z]+)'/);
    return m ? m[1] : "";
  } catch (e) {
    return "";
  }
}
function bumpCommit(ver) {
  return sh(`git log --format=%h -S"${ver}" -- server.js | tail -1`);
}
/**
 * 按「目标版本的 bump 提交」读文件，而不是读工作树。
 * ⛔ 2026-10-28 09:20 假红事故：na 复核时工作树已推进到后续版本，
 *    四端读工作树 → 全部「未含 na」→ 误判 FAIL。复核旧版本必须读该版本的 git blob。
 */
function readAtVer(file, ver) {
  const bump = bumpCommit(ver);
  if (bump) {
    const out = sh(`git show ${bump}:${file}`);
    if (out) return out;
  }
  try {
    return fs.readFileSync(path.join(ROOT, file), "utf8");
  } catch (e) {
    return "";
  }
}
function token() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
    return (c.syncUpstream && c.syncUpstream.token) || "";
  } catch (e) {
    return "";
  }
}
async function get(url, opt) {
  const t0 = Date.now();
  const r = await fetch(url, Object.assign({ headers: { "Cache-Control": "no-cache" } }, opt || {}));
  const text = await r.text();
  return { status: r.status, text, ms: Date.now() - t0 };
}
async function getJson(url, opt) {
  const r = await get(url, opt);
  try {
    return { ok: true, status: r.status, ms: r.ms, data: JSON.parse(r.text) };
  } catch (e) {
    return { ok: false, status: r.status, ms: r.ms, error: "非 JSON 响应" };
  }
}

// ---------- 复核 ----------
async function review(ver) {
  const checks = [];
  const push = (name, ok, actual, expected, required) => checks.push({ name, ok: !!ok, actual, expected, required: required !== false });

  // ① 线上 lock/status
  const cb = Date.now();
  const st = await getJson(`${ONLINE}/api/lock/status?token=${encodeURIComponent(token())}&_cb=${cb}`);
  if (!st.ok) {
    push("线上 lock/status", false, st.error || ("HTTP " + st.status), "可读 JSON");
  } else {
    push("线上 appVer", st.data.appVer === ver, st.data.appVer, ver);
    push("线上 pushRole", st.data.pushRole === "primary", st.data.pushRole, "primary");
    push("线上 devGen>0", (st.data.gen || 0) > 0, st.data.gen, ">0");
    push("线上 viewGen>0", (st.data.viewGen || 0) > 0, st.data.viewGen, ">0");
    checks.push({ name: "线上 lock/status 耗时", ok: true, actual: st.ms + "ms", required: false });
  }

  // ② 线上实例存活
  try {
    const s = await get(`${ONLINE}/api/state`);
    push("线上 /api/state", s.status === 200, `HTTP ${s.status} / ${s.ms}ms`, "HTTP 200");
  } catch (e) {
    push("线上 /api/state", false, e.message, "HTTP 200");
  }

  // ③ 副本心跳链路
  try {
    const hb = await getJson(`${ONLINE}/api/heartbeat?role=replica`, { method: "POST" });
    push("副本心跳链路", hb.ok && hb.data && hb.data.ok === true, hb.ok ? JSON.stringify(hb.data) : hb.error, "ok:true");
  } catch (e) {
    push("副本心跳链路", false, e.message, "ok:true");
  }

  // ④ 线上前端是否真含目标版本（不靠版本号自称，查页面内容）
  try {
    const idx = await get(`${ONLINE}/?_cb=${cb}`);
    push("线上 index.html 含目标版本", idx.text.includes(ver), idx.text.includes(ver) ? "含 " + ver : "未含 " + ver, "含 " + ver);
    const sw = await get(`${ONLINE}/sw.js?_cb=${cb}`);
    push("线上 sw.js 含目标版本", sw.text.includes(ver), sw.text.includes(ver) ? "含 " + ver : "未含 " + ver, "含 " + ver);
  } catch (e) {
    push("线上前端内容", false, e.message, "可取");
  }

  // ⑤ 本机 8787
  try {
    const l = await getJson(`${LOCAL}/api/lock/status?_cb=${cb}`);
    if (!l.ok) push("本机 lock/status", false, l.error || ("HTTP " + l.status), "可读 JSON");
    else {
      push("本机 appVer", l.data.appVer === ver, l.data.appVer, ver);
      push("本机 pushRole", l.data.pushRole === "replica", l.data.pushRole, "replica");
    }
  } catch (e) {
    push("本机 8787 存活", false, e.message, "可连");
  }

  // ⑥ 四端版本一致（读「目标版本 bump 提交」的 blob，不读工作树——防旧版本复核假红）
  FOUR_END.forEach((f) => {
    const s = readAtVer(f, ver);
    push(`四端 ${f}`, !!s && s.includes(ver), !s ? "读不到文件" : (s.includes(ver) ? "含 " + ver : "未含 " + ver), "含 " + ver);
  });

  // ⑦ 主干：bump 点之后是否只有文档提交（只提示，不判死）
  const bump = sh(`git log --format=%h -S"${ver}" -- server.js | tail -1`);
  if (bump) {
    const after = sh(`git log --format=%h --name-only ${bump}..HEAD`).split("\n").filter(Boolean);
    const codeAfter = after.filter((x) => /^[0-9a-f]{7,}$/.test(x) === false && !isDocFile(x));
    checks.push({
      name: "主干 bump 点之后无代码提交",
      ok: codeAfter.length === 0,
      actual: codeAfter.length === 0 ? "仅文档/无" : codeAfter.slice(0, 5).join(","),
      required: false,
    });
  }

  // ⑧ 主干与 gitee 备份对齐（本地领先只提示）
  const lr = sh("git rev-list --left-right --count HEAD...gitee/master").split(/\s+/);
  if (lr.length === 2) {
    checks.push({ name: "gitee 备份不落后", ok: Number(lr[1]) === 0, actual: `本地领先 ${lr[0]} / 落后 ${lr[1]}`, required: true });
    checks.push({ name: "gitee 备份已推齐", ok: Number(lr[0]) === 0, actual: `本地领先 ${lr[0]}`, required: false });
  }

  // ⑨ 工作树洁净（只提示）
  const dirty = sh("git status --porcelain").split("\n").filter(Boolean).length;
  checks.push({ name: "工作树洁净", ok: dirty === 0, actual: dirty === 0 ? "干净" : dirty + " 项未提交", required: false });

  return { ver, checks, summary: summarize(checks), at: new Date() };
}

function renderMd(r, mode) {
  const now = r.at;
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const head = r.summary.ok ? "复核通过 · 闭环完成" : "复核不通过";
  const rows = r.checks
    .map((c) => `| ${c.name} | ${c.actual === undefined ? "" : String(c.actual)} | ${c.ok ? "✅" : "❌"}${c.required === false ? "（提示项）" : ""} |`)
    .join("\n");
  return `# 发布复核结果 · ${r.ver}

- 复核方式：**脚本化独立实测**（\`_review_check.js\`，全新会话执行；不读取发布方自检结论）
- ${mode || "说明"}：本复核由独立会话执行，非「量化看盘·刷新与本地存活」本体
- 复核时间：${stamp}（北京时间）
- 线上地址：${ONLINE}
- 结论：**${head}**

## 一、实测证据（逐项自己拉的）

| 复核项 | 实测值 | 判定 |
|---|---|---|
${rows}

## 二、判定口径

- 硬项（无「提示项」标注）全部通过 → PASS；任一项不通过或探测失败 → FAIL（**判不出不硬判**）。
- 统计：共 ${r.summary.total} 项，硬项 ${r.summary.hard} 项，失败 ${r.summary.failed} 项${r.summary.failedNames.length ? "（" + r.summary.failedNames.join("、") + "）" : ""}。
- 「提示项」不参与 PASS/FAIL：bump 点后是否只有文档提交、gitee 是否推齐、工作树是否洁净。

## 三、发布方自检与本复核的关系

发布方 \`_post_publish_check.checkRelease()\` 的 6 项结论**未参与**本判定，本复核全部数据独立拉取。

---
生成：\`node _review_check.js --ver ${r.ver} --write\`
`;
}
function writeResult(r, mode) {
  const d = r.at;
  const pad = (n) => String(n).padStart(2, "0");
  const name = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${verSuffix(r.ver)}-复核${r.summary.ok ? "通过" : "不通过"}.md`;
  const p = path.join(RESULT_DIR, name);
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  fs.writeFileSync(p, renderMd(r, mode), "utf8");
  return p;
}

// ---------- CLI ----------
if (require.main === module) (async () => {
  const A = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    if (k.startsWith("--")) A[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  const ver = A.ver || readVer();
  if (!ver) {
    console.error("⛔ 取不到版本号（工作树 server.js 无 APP_VER，且未传 --ver）");
    process.exit(1);
  }
  const r = await review(ver);
  console.log(`=== 独立复核 · ${ver} ===`);
  r.checks.forEach((c) => console.log(`${c.ok ? "✅" : "❌"} ${c.name}｜实测 ${c.actual === undefined ? "-" : c.actual}${c.expected !== undefined ? "｜期望 " + c.expected : ""}${c.required === false ? "（提示项）" : ""}`));
  console.log(`--- 硬项 ${r.summary.hard}，失败 ${r.summary.failed}，结论 ${r.summary.ok ? "PASS" : "FAIL"} ---`);
  if (A.write) {
    const p = writeResult(r);
    console.log("已写复核结果：" + p);
  }
  process.exit(r.summary.ok ? 0 : 1);
})();

module.exports = { review, verSuffix, isDocFile, summarize, renderMd, readAtVer, bumpCommit };
