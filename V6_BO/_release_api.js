"use strict";
// ============================================================
// 📱 发布看板 API 后端 _release_api.js（2026-10-27）
// 供 server.js /api/release/* 调用：读取待发布请求、更新状态、刷新看板。
// ============================================================
const fs = require("fs");
const path = require("path");
const tracker = require("./_change_tracker.js");
const collector = require("./_collect_changes.js");

const BOX = process.env.RELEASE_BOX || "C:\\Users\\28957\\WorkBuddy\\任务同步\\修改请求\\pending";
const LIST_DIR = process.env.RELEASE_LIST_DIR || path.join(__dirname, "..", "stock-dashboard-artifacts", "复盘");

// 与 _collect_changes.js 同口径解析单份 md
function parseRequest(md, fname) {
  const g = (label) => {
    const m = md.match(new RegExp("^- " + label + "：(.*)$", "m"));
    return m ? m[1].trim() : "";
  };
  return {
    file: fname,
    ts: g("提交时间"),
    space: g("空间/模块") || g("修改请求") || fname,
    files: g("改动文件与函数"),
    summary: g("改动摘要"),
    impact: g("影响面"),
    test: g("自测结果"),
    urgent: g("是否急修").indexOf("是") === 0,
    status: (g("状态").split("（")[0].split("(")[0].trim() || "pending")
  };
}

function loadRequests() {
  fs.mkdirSync(BOX, { recursive: true });
  const mds = fs.readdirSync(BOX).filter(f => f.endsWith(".md"));
  const all = mds.map(f => {
    const r = parseRequest(fs.readFileSync(path.join(BOX, f), "utf8"), f);
    r.events = tracker.getTimeline(f).events;
    return r;
  });
  all.sort((a, b) => a.file < b.file ? -1 : 1);
  return all;
}

function stageLabel(stage) {
  const map = {
    pending: "待确认",
    confirmed: "已确认",
    published: "已发布",
    verified: "已复核",
    rejected: "已驳回"
  };
  return map[stage] || stage;
}

// 更新请求状态：改 md 状态行 + 写 tracker 事件 + 刷新看板
function updateRequest(file, stage, detail) {
  if (!file) throw new Error("缺少 file");
  if (!stage) throw new Error("缺少 stage");
  const safeStage = String(stage).replace(/[^a-z-]/g, "");
  if (!/^(confirmed|published|verified|rejected)$/.test(safeStage) && safeStage !== "pending") {
    throw new Error("非法 stage：" + stage);
  }
  const fp = path.join(BOX, path.basename(file));
  if (!fs.existsSync(fp)) throw new Error("请求文件不存在：" + file);

  const label = stageLabel(safeStage);
  const md = fs.readFileSync(fp, "utf8");
  const detailText = detail ? "（" + detail + "）" : "";
  const newStatus = safeStage + detailText;
  const newMd = md.replace(/^- 状态：.*$/m, "- 状态：" + newStatus);
  if (newMd === md && !md.includes("- 状态：")) {
    // 原文件没有状态行，在末尾追加
    fs.writeFileSync(fp, md.trimEnd() + "\n- 状态：" + newStatus + "\n", "utf8");
  } else {
    fs.writeFileSync(fp, newMd, "utf8");
  }

  tracker.logEvent(path.basename(file), safeStage, detail || "");

  // 静默刷新看板（不发送新通知）
  refreshBoards();

  return { ok: true, file, stage: safeStage, detail };
}

function refreshBoards() {
  try {
    const reqs = loadRequests();
    fs.mkdirSync(LIST_DIR, { recursive: true });
    // 日期键一律本地口径（项目统一 todayStr/dayKeyOf 都取本地时间）：
    // toISOString() 是 UTC，东八区每天 00:00-08:00 会整整差一天 → 清单文件名/看板日期写成昨天。
    const _rd = new Date();
    const dateStr = `${_rd.getFullYear()}-${String(_rd.getMonth() + 1).padStart(2, '0')}-${String(_rd.getDate()).padStart(2, '0')}`;
    fs.writeFileSync(path.join(LIST_DIR, "待发布清单-" + dateStr + ".html"), collector.buildListHtml(reqs, dateStr), "utf8");
    fs.writeFileSync(path.join(LIST_DIR, "发布看板.html"), collector.buildBoardHtml(reqs, dateStr), "utf8");
    fs.writeFileSync(path.join(LIST_DIR, "联动链路看板.html"), tracker.buildLinkageBoardHtml(reqs, dateStr), "utf8");
  } catch (e) {
    // 看板刷新失败不阻塞 API 返回
    console.error("[release_api] refreshBoards failed:", e.message);
  }
}

module.exports = { loadRequests, updateRequest, refreshBoards, parseRequest, BOX };
