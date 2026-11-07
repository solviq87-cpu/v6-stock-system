"use strict";
// ============================================================
// 🔗 修改请求联动追踪器 _change_tracker.js（2026-10-27）
// 记录每个修改请求从提交 → 通知 → 确认 → 发布 → 复核的全链路事件。
// 所有事件写入共享 state 文件（不入 git），供联动看板可视化。
// ============================================================
const fs = require("fs");
const path = require("path");

const BOX = "C:\\Users\\28957\\WorkBuddy\\任务同步\\修改请求\\pending";
let STATE_FILE = process.env.CHANGES_STATE_FILE || path.join(BOX, "..", "changes_state.json");

function setStateFile(p) { STATE_FILE = p; }
function getStateFile() { return STATE_FILE; }

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (e) {
    return {};
  }
}
function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
}

// 为单个请求记录一个事件
// stage: submitted | notified | confirmed | published | verified | rejected
// detail: 任意补充，如版本号、驳回原因
function logEvent(fileKey, stage, detail, at) {
  const state = readState();
  if (!state[fileKey]) state[fileKey] = { file: fileKey, events: [] };
  state[fileKey].events.push({
    stage,
    detail: detail || "",
    at: at || new Date().toISOString()
  });
  state[fileKey].updatedAt = new Date().toISOString();
  writeState(state);
  return state[fileKey];
}

// 若该阶段尚未记录，则补一条（用于收箱器发现老请求时补 submitted）
function ensureEvent(fileKey, stage, detail, at) {
  const tl = getTimeline(fileKey);
  if (hasStage(tl, stage)) return tl;
  return logEvent(fileKey, stage, detail, at);
}

// 读取单个请求的时间线
function getTimeline(fileKey) {
  const state = readState();
  return state[fileKey] || { file: fileKey, events: [] };
}

// 读取全部时间线
function allTimelines() {
  return readState();
}

// 判断某阶段是否已完成（取最后一次该阶段事件）
function hasStage(tl, stage) {
  return tl.events.some(e => e.stage === stage);
}
function lastStageAt(tl, stage) {
  const e = tl.events.filter(e => e.stage === stage).pop();
  return e ? e.at : null;
}
function lastStageDetail(tl, stage) {
  const e = tl.events.filter(e => e.stage === stage).pop();
  return e ? e.detail : "";
}

// 格式化时间（ISO → 简洁本地时间）
function fmt(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 生成联动链路看板 HTML（与发布看板同目录）
function buildLinkageBoardHtml(reqs, dateStr, state) {
  state = state || readState();
  const stages = [
    { key: "submitted", name: "提交", icon: "📮" },
    { key: "notified", name: "通知", icon: "🔔" },
    { key: "confirmed", name: "确认", icon: "👤" },
    { key: "published", name: "发布", icon: "🚀" },
    { key: "verified", name: "复核", icon: "✅" }
  ];

  const card = r => {
    const tl = state[r.file] || { events: [] };
    const stepDone = idx => {
      const must = stages.slice(0, idx + 1).map(s => s.key);
      return must.every(k => hasStage(tl, k));
    };
    const stepActive = idx => {
      const prev = stages[idx - 1];
      return (idx === 0 && !hasStage(tl, "notified")) ||
        (prev && hasStage(tl, prev.key) && !hasStage(tl, stages[idx].key));
    };
    const row = stages.map((s, i) => {
      const done = hasStage(tl, s.key);
      const at = lastStageAt(tl, s.key);
      const detail = lastStageDetail(tl, s.key);
      let bg, fg, border;
      if (done) { bg = "#f0fff4"; fg = "#276749"; border = "#48bb78"; }
      else if (stepActive(i)) { bg = "#fffaf0"; fg = "#c05621"; border = "#ed8936"; }
      else { bg = "#edf2f7"; fg = "#718096"; border = "#cbd5e0"; }
      return `<div style="flex:1;min-width:90px;text-align:center;background:${bg};border:1px solid ${border};border-radius:6px;padding:8px 4px;margin:0 3px">` +
        `<div style="font-size:16px">${s.icon}</div>` +
        `<div style="font-size:12px;font-weight:bold;color:${fg}">${s.name}</div>` +
        `<div style="font-size:10px;color:#4a5568;margin-top:2px">${done ? fmt(at) : (stepActive(i) ? "进行中" : "—")}</div>` +
        (detail ? `<div style="font-size:10px;color:${fg};margin-top:2px">${esc(detail)}</div>` : "") +
        `</div>`;
    }).join("");

    const current = (() => {
      if (hasStage(tl, "rejected")) return { text: "已驳回", color: "#e53e3e" };
      for (let i = stages.length - 1; i >= 0; i--) {
        if (hasStage(tl, stages[i].key)) {
          if (stages[i].key === "verified") return { text: "已闭环", color: "#276749" };
          const next = stages[i + 1];
          return { text: "等待：" + (next ? next.name : "结束"), color: "#c05621" };
        }
      }
      return { text: "等待：通知", color: "#c05621" };
    })();

    return `<div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid ${r.urgent ? "#e53e3e" : "#2b6cb0"};border-radius:6px;padding:12px 14px;margin:10px 0">` +
      `<div style="font-size:14px;font-weight:bold">${esc(r.space)} ${r.urgent ? '<span style="color:#e53e3e">🔥急修</span>' : ""}` +
      `<span style="float:right;font-size:12px;color:${current.color};font-weight:bold">${current.text}</span></div>` +
      `<div style="font-size:12px;color:#4a5568;margin:4px 0">${esc(r.summary)} · ${esc(r.files)}</div>` +
      `<div style="display:flex;align-items:stretch;margin-top:8px">${row}</div>` +
      `</div>`;
  };

  const pendN = reqs.filter(r => !hasStage(state[r.file] || { events: [] }, "confirmed") && !hasStage(state[r.file] || { events: [] }, "rejected")).length;
  const doneN = reqs.filter(r => hasStage(state[r.file] || { events: [] }, "verified")).length;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>联动链路看板</title>
<style>body{font-family:Microsoft YaHei,sans-serif;max-width:1200px;margin:20px auto;padding:0 16px;color:#222}h1{font-size:20px;border-bottom:2px solid #2b6cb0;padding-bottom:8px}.stat{display:inline-block;background:#edf2f7;border-radius:6px;padding:6px 14px;margin-right:10px;font-size:14px}.meta{color:#666;font-size:12px;margin:10px 0 16px}</style>
</head>
<body>
<h1>🔗 量化看盘 · 修改请求联动链路看板</h1>
<div><span class="stat">进行中 <b>${pendN}</b></span><span class="stat">已闭环 <b>${doneN}</b></span><span class="stat">累计 <b>${reqs.length}</b></span></div>
<p class="meta">横轴 = 请求生命周期：提交 → 通知 → 用户确认 → 发布上线 → 刷新与本地存活复核 · 绿色=已完成 橙色=进行中 灰色=未发生 · 看板每 15 分钟随收箱器刷新</p>
${reqs.map(card).join("") || '<div style="color:#a0aec0;padding:20px 0">暂无请求</div>'}
</body>
</html>`;
}

// CLI：node _change_tracker.js --event <stage> --file <md文件名> [--detail <补充>]
if (require.main === module) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
  }
  if (args.event && args.file) {
    const r = logEvent(path.basename(args.file), args.event, args.detail);
    console.log("已记录 " + args.event + " 事件：" + args.file);
    console.log(JSON.stringify(r.events.slice(-1), null, 2));
  } else {
    console.log("用法：node _change_tracker.js --event <submitted|notified|confirmed|published|verified|rejected> --file <md文件名> [--detail <补充>]");
  }
}

module.exports = {
  logEvent, ensureEvent, getTimeline, allTimelines, hasStage, lastStageAt, lastStageDetail,
  buildLinkageBoardHtml, readState, writeState, setStateFile, getStateFile
};
