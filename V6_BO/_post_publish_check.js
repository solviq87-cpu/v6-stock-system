"use strict";
// ============================================================
// ✅ 发布后独立复核模块 _post_publish_check.js（2026-10-27）
// 发布上线标记 published 后自动触发：线上 appVer/pushRole/世代/副本心跳核验。
// ============================================================
const https = require("https");
const tracker = require("./_change_tracker.js");
const releaseApi = require("./_release_api.js");

const ONLINE = "https://quant-dashboard-77614.app.workbuddy.host";

function getLocalToken() {
  try {
    const cfg = require("C:\\Users\\28957\\WorkBuddy\\2026-09-25-13-40-58\\stock-dashboard\\config.json");
    return (cfg.syncUpstream && cfg.syncUpstream.token) || "";
  } catch (e) {
    return "";
  }
}

function fetchJson(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : require("http");
    const headers = { "Accept": "application/json", "Connection": "close" };
    if (opts.token) headers["Cookie"] = "qd_device=" + encodeURIComponent(opts.token);
    const req = mod.request({
      hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
      method: opts.method || "GET", timeout: opts.timeout || 20000, headers
    }, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error("JSON解析失败: " + data.slice(0, 200))); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { try { req.destroy(); } catch (_) {} reject(new Error("请求超时")); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function checkRelease(version) {
  const result = { version, checks: [], ok: false, at: new Date().toISOString() };
  const token = getLocalToken();

  // ① /api/lock/status：版本号、推送角色、世代
  try {
    const st = await fetchJson(ONLINE + "/api/lock/status?token=" + encodeURIComponent(token));
    result.checks.push({ name: "appVer", ok: st.appVer === version, expected: version, actual: st.appVer });
    result.checks.push({ name: "pushRole", ok: st.pushRole === "primary", expected: "primary", actual: st.pushRole });
    result.checks.push({ name: "devGen", ok: (st.gen || 0) > 0, actual: st.gen });
    result.checks.push({ name: "viewGen", ok: (st.viewGen || 0) > 0, actual: st.viewGen });
  } catch (e) {
    result.checks.push({ name: "lock/status", ok: false, error: e.message });
    return result;
  }

  // ② 实例存活：/api/state 能通（轻量）
  try {
    await fetchJson(ONLINE + "/api/state");
    result.checks.push({ name: "stateAlive", ok: true });
  } catch (e) {
    result.checks.push({ name: "stateAlive", ok: false, error: e.message });
  }

  // ③ 副本心跳链路：POST /api/heartbeat?role=replica 必须返回 ok
  try {
    const hb = await fetchJson(ONLINE + "/api/heartbeat?role=replica", { method: "POST" });
    result.checks.push({ name: "replicaHeartbeat", ok: hb.ok === true });
  } catch (e) {
    result.checks.push({ name: "replicaHeartbeat", ok: false, error: e.message });
  }

  result.ok = result.checks.every(c => c.ok);
  return result;
}

function formatCheckResult(r) {
  const lines = r.checks.map(c => {
    const icon = c.ok ? "✅" : "❌";
    const detail = c.error ? c.error : (c.actual !== undefined ? "实际 " + c.actual : "");
    return `${icon} ${c.name}${detail ? "：" + detail : ""}`;
  });
  return lines.join("\n");
}

function emitSse(sseFn, stage, file, version) {
  if (typeof sseFn === "function") {
    try { sseFn(stage, file, version); } catch (_) {}
  }
}

// 触发一次发布后的独立复核（不阻塞调用方）
function runPostPublishCheck(file, version, pushFn, sseFn) {
  (async () => {
    try {
      tracker.logEvent(file, "verifying", "自动复核中");
      emitSse(sseFn, "verifying", file, version);
      const r = await checkRelease(version);
      if (r.ok) {
        releaseApi.updateRequest(file, "verified", version);
        emitSse(sseFn, "verified", file, version);
        if (typeof pushFn === "function") {
          const req = releaseApi.loadRequests().find(x => x.file === file) || {};
          const text = `✅ 发布复核通过\n空间：${req.space || ""}\n改动：${req.summary || ""}\n版本 ${version} 线上检查全部通过。`;
          try { pushFn(text, true, { manual: true, private: true }); } catch (_) {}
        }
      } else {
        tracker.logEvent(file, "verify_failed", JSON.stringify(r.checks));
        releaseApi.refreshBoards();
        emitSse(sseFn, "verify_failed", file, version);
        if (typeof pushFn === "function") {
          const text = `⚠️ 发布复核未通过\n版本 ${version}\n${formatCheckResult(r)}\n请「刷新与本地存活」模块或发布上线空间排查。`;
          try { pushFn(text, true, { manual: true, private: true }); } catch (_) {}
        }
      }
    } catch (e) {
      tracker.logEvent(file, "verify_failed", e.message);
      releaseApi.refreshBoards();
      emitSse(sseFn, "verify_failed", file, version);
      if (typeof pushFn === "function") {
        try { pushFn(`⚠️ 发布复核异常：${e.message}（版本 ${version}）`, true, { manual: true, private: true }); } catch (_) {}
      }
    }
  })();
}

module.exports = { checkRelease, runPostPublishCheck, formatCheckResult };
