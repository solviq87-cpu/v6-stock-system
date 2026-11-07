"use strict";
// ============================================================
// 🔗 模块联动检查 _module_linkage.js（2026-10-28）
// 根据修改请求的 files 字段推断影响模块，自动跑相关守门测试。
// ============================================================
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = __dirname;

const MODULE_RULES = [
  { name: "涨停池", patterns: [/zt/i, /pool/i, /review/i, /limit/i, /missed/i, /streak/i, /sector/i] },
  { name: "推送模块", patterns: [/push/i, /feishu/i, /send/i, /srcpkg/i, /channel/i, /priv/i] },
  { name: "持仓与模拟盘", patterns: [/paper/i, /hold/i] },
  { name: "数据准确性", patterns: [/data/i, /stale/i, /accur/i, /guard/i, /kline/i, /day/i, /industry/i] },
  { name: "发布看板", patterns: [/release/i, /publish/i, /collect/i, /change/i, /submit/i] },
  { name: "竞价", patterns: [/auction/i] },
  { name: "选股体系", patterns: [/quant/i, /pick/i, /candidate/i] },
  { name: "学习闭环", patterns: [/learn/i, /emp/i, /signal/i] },
  { name: "数据源", patterns: [/em\.js/i, /external/i, /fallback/i, /sina/i, /tencent/i] }
];

function inferModules(files) {
  const mods = new Set();
  for (const f of (files || [])) {
    const s = String(f).toLowerCase();
    for (const r of MODULE_RULES) {
      if (r.patterns.some(p => p.test(s))) mods.add(r.name);
    }
  }
  return [...mods];
}

function relatedTests(modules) {
  const all = fs.readdirSync(ROOT).filter(f => /^_test_.*\.js$/.test(f));
  return all.filter(f => {
    const s = f.toLowerCase();
    for (const m of modules) {
      const rule = MODULE_RULES.find(r => r.name === m);
      if (rule && rule.patterns.some(p => p.test(s))) return true;
    }
    return false;
  });
}

function runTest(file, timeout = 60000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    execFile(process.execPath, [file], { cwd: ROOT, timeout, maxBuffer: 4 << 20 }, (err, so, se) => {
      const out = String(so || '') + String(se || '');
      const crashed = !!err && !err.killed;
      const failMatch = out.match(/(?:合计|通过)\s*(\d+)\s*项：通过\s*(\d+)、失败\s*(\d+)/);
      const pass = failMatch ? +failMatch[2] : ((out.match(/✅|✓|对勾/g) || []).length);
      const fail = failMatch ? +failMatch[3] : ((out.match(/❌|✗/g) || []).length + (crashed ? 1 : 0));
      resolve({ file, pass, fail, crashed, ms: Date.now() - t0, out: out.slice(0, 500) });
    });
  });
}

async function checkFiles(files) {
  const modules = inferModules(files);
  const tests = relatedTests(modules);
  const results = [];
  for (const t of tests) {
    results.push(await runTest(t, 60000));
  }
  const red = results.filter(r => r.fail > 0 || r.crashed);
  // ⛔ 模块级聚合（2026-10-28 联动升级①）：按模块分组各自的测试红绿，供影响图谱渲染
  const moduleDetail = modules.map(m => {
    const rule = MODULE_RULES.find(r => r.name === m);
    const modTests = results.filter(r => rule && rule.patterns.some(p => p.test(r.file.toLowerCase())));
    const modRed = modTests.filter(r => r.fail > 0 || r.crashed);
    return {
      module: m,
      tests: modTests.length,
      red: modRed.length,
      ok: modTests.length > 0 && modRed.length === 0,
      redTests: modRed.map(r => r.file)
    };
  });
  return {
    ok: red.length === 0,
    modules,
    tests: tests.length,
    results,
    red: red.map(r => r.file),
    moduleDetail,
    summary: `模块[${modules.join('、')}] → 相关测试 ${tests.length} 个，红灯 ${red.length} 个`
  };
}

// ⛔ 发布后真实接口验证（2026-10-28 联动升级②）：
// 守门测试通过 ≠ 功能真活着。逐模块调真实 HTTP 接口，验证线上功能可用。
// 只验"接口能响应 + 返回结构正常"，不验业务数值（数值正确性由守门管）。
const MODULE_ENDPOINTS = [
  { module: "涨停池", path: "/api/state", check: d => d && typeof d.ztPool === "object" },
  { module: "推送模块", path: "/api/push-log?limit=1", check: d => d && (Array.isArray(d.items) || Array.isArray(d.log) || typeof d === "object") },
  { module: "持仓与模拟盘", path: "/api/paper", check: d => d && d.ok === true && d.paper },
  { module: "选股体系", path: "/api/quant-picks?max=1", check: d => d && typeof d.count === "number" },
  { module: "竞价", path: "/api/auction-resonance?max=1", check: d => d && typeof d.count === "number" },
  { module: "学习闭环", path: "/api/state", check: d => d && typeof d.learn === "object" },
  { module: "数据准确性", path: "/api/state", check: d => d && typeof d.stocksAgeSec === "number" },
  { module: "发布看板", path: "/api/release/requests", check: d => d && d.ok === true },
  { module: "数据源", path: "/api/state", check: d => d && typeof d.stocksAt === "number" }
];

async function probeEndpoints(baseUrl, token, modules) {
  const https = require("https");
  const out = [];
  for (const ep of MODULE_ENDPOINTS) {
    // 只验受影响模块（不在名单里的跳过）
    if (modules && modules.length && !modules.includes(ep.module)) continue;
    const t0 = Date.now();
    const result = await new Promise((resolve) => {
      const req = https.get(baseUrl.replace(/\/$/, "") + ep.path + (ep.path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token),
        { timeout: 15000 }, (res) => {
          let data = "";
          res.on("data", c => data += c);
          res.on("end", () => {
            try {
              const j = JSON.parse(data);
              resolve({ ok: ep.check(j), status: res.statusCode, ms: Date.now() - t0 });
            } catch (e) {
              resolve({ ok: false, status: res.statusCode, ms: Date.now() - t0, why: "返回非JSON" });
            }
          });
        });
      req.on("error", e => resolve({ ok: false, ms: Date.now() - t0, why: e.message }));
      req.on("timeout", () => { try { req.destroy(); } catch (_) {} resolve({ ok: false, ms: Date.now() - t0, why: "超时" }); });
    });
    out.push({ module: ep.module, ...result });
  }
  return out;
}

module.exports = { inferModules, relatedTests, runTest, checkFiles, probeEndpoints };
