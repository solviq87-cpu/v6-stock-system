#!/usr/bin/env node
/**
 * _release_notes.js —— 版本发布说明生成器（发布工具链·唯一发布出口专用）
 *
 * 用户立规（2026-10-28）：每发布一个版本，必须产出一份项目文档，
 * 说清「改了什么 / 有什么好处 / 有什么弊端」。
 *
 * 用法：
 *   node _release_notes.js                          # 自动：上一版 release 提交 → HEAD
 *   node _release_notes.js --from 06b3512           # 指定起点
 *   node _release_notes.js --from 06b3512 --to HEAD
 *   node _release_notes.js --ver 20261027mx         # 覆盖版本号
 *   node _release_notes.js --notes mx_notes.json    # 叠加人工「好处/弊端」分析
 *   node _release_notes.js --out D:/xxx             # 覆盖输出目录
 *
 * notes.json 结构（按模块 key 覆盖/补充；key 为下面归类出的模块名）：
 * {
 *   "ver": "20261027mx",
 *   "summary": "一句话总体评价",
 *   "modules": {
 *     "发布看板": { "benefit": "...", "risk": "..." },
 *     "数据源":   { "benefit": "...", "risk": "..." }
 *   },
 *   "extra": [ { "module":"其它", "change":"...", "benefit":"...", "risk":"..." } ]
 * }
 *
 * 产物：单文件 HTML，写盘后用 present_files 交用户。
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;
const OUT_DIR_DEFAULT = "C:/Users/28957/WorkBuddy/任务同步/发布说明";

// ---------- 参数 ----------
function argv() {
  const a = {};
  for (let i = 2; i < process.argv.length; i++) {
    const k = process.argv[i];
    if (k.startsWith("--")) a[k.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : true;
  }
  return a;
}
const A = argv();

const sh = (cmd) => execSync(cmd, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

// ---------- 版本号 ----------
function readServerVer() {
  try {
    const m = fs.readFileSync(path.join(ROOT, "server.js"), "utf8").match(/^const APP_VER\s*=\s*'([^']+)'/m);
    return m ? m[1] : "unknown";
  } catch (e) { return "unknown"; }
}
const VER = A.ver && A.ver !== true ? A.ver : readServerVer();

// ---------- 区间 ----------
function findPrevRelease() {
  // 最近一条标题含 release 且不是 HEAD 的提交
  try {
    const lines = sh('git log --pretty=format:"%h%x09%s" -n 60').split("\n");
    for (let i = 1; i < lines.length; i++) {
      const [h, s] = lines[i].split("\t");
      if (/^release/i.test(s || "")) return h;
    }
  } catch (e) { /* ignore */ }
  return sh("git rev-parse HEAD~10");
}
const FROM = A.from && A.from !== true ? A.from : findPrevRelease();
const TO = A.to && A.to !== true ? A.to : "HEAD";

// ---------- 提交 ----------
const SEP = "␟";
const logRaw = sh(
  `git log --reverse --pretty=format:"%h${SEP}%an${SEP}%ad${SEP}%s${SEP}%b${SEP}" --date=format:"%m-%d %H:%M" ${FROM}..${TO}`
);
const commits = [];
logRaw.split("\n").forEach((line) => {
  const p = line.split(SEP);
  if (p.length < 5 || !p[0]) return;
  commits.push({
    hash: p[0], author: p[1], time: p[2],
    subject: p[3] || "", body: (p[4] || "").replace(/\r/g, " ").replace(/\s+/g, " ").trim(),
  });
});

// ---------- 文件变更 ----------
const statRaw = sh(`git diff --stat ${FROM}..${TO}`);
const statLines = statRaw.split("\n").filter(Boolean);
const fileSummary = statLines.slice(-1)[0] || "";
const changedFiles = statLines.slice(0, -1).map((l) => {
  const m = l.match(/^\s*(.+?)\s*\|\s*(\d+)\s*[+-]*/);
  return m ? { file: m[1].trim(), churn: parseInt(m[2], 10) } : null;
}).filter(Boolean);
const fileList = changedFiles.map((f) => f.file);

// ---------- 模块归类 ----------
const MODULE_RULES = [
  [/发布看板|_release|release/i, "发布看板"],
  [/收箱|collect_changes|模块联动|_module_linkage/i, "收箱/联动"],
  [/数据源|em\.js|_mkt_stats|兜底|行业/i, "数据源"],
  [/复盘|review/i, "复盘"],
  [/竞价|auction/i, "竞价"],
  [/涨停|pool|ztPool|漏票/i, "涨停池"],
  [/选股|quant|精选池/i, "选股"],
  [/推送|push|feishu/i, "推送"],
  [/持仓|paper|holdings/i, "持仓模拟盘"],
  [/学习闭环|learn/i, "学习闭环"],
  [/数据准确性|判据/i, "数据准确性"],
  [/面板|mobile|index\.html|速览|诊断/i, "面板/前端"],
  [/备份|backup/i, "数据备份"],
  [/gitignore|chore/i, "工程规范"],
];
function moduleOf(c) {
  const s = c.subject + " " + c.body;
  for (const [re, name] of MODULE_RULES) if (re.test(s)) return name;
  const m = c.subject.match(/^[a-z]+\(([^)]+)\)/);
  if (m) return m[1];
  return "其它";
}

// ---------- 风险信号扫描（自动补弊端提示） ----------
function riskSignals() {
  const out = [];
  const has = (re) => fileList.some((f) => re.test(f));
  if (has(/^server\.js$/)) out.push("改动核心服务 server.js：影响面全站，发版前须全量守门 _runall.js 无真红");
  if (has(/public\/mobile\.html/)) out.push("改动手机端 mobile.html：内联脚本语法错即整页黑屏（lq 轮教训），须跑 _test_mobile_digest");
  if (has(/public\/index\.html/)) out.push("改动桌面面板 index.html：须跑面板相关守门 + 浏览器控制台无红");
  if (has(/server\.js$/) && commits.some((c) => /push|推送|feishu/i.test(c.subject))) out.push("涉及推送链路：须确认私密默认未破（pushAll 未显式 public:true 一律私密）");
  if (has(/em\.js|_mkt_stats|数据源/)) out.push("涉及数据口径：涨跌停唯一权威仍为东财封板池 tc，多源链不得退化为单点");
  if (has(/config\.json/)) out.push("涉及 config.json：发布包须剥离 pushRole/syncUpstream，否则线上可能被副本配置覆盖致推送全停（mq 轮事故）");
  if (has(/\.gitignore/)) out.push("涉及 .gitignore：确认运行时 json 已忽略，防 git add -A 扫数据上包");
  if (has(/^_test_/)) out.push("含守门测试改动：须确认是硬化断言而非放宽判据放水（禁止靠改松断言转绿）");
  if (changedFiles.length > 25) out.push(`改动文件 ${changedFiles.length} 个，属大范围变更：建议分批观察，回滚成本较高`);
  if (commits.length > 20) out.push(`区间含 ${commits.length} 个提交：跨度大，建议拆为小版本便于定位回归`);
  return out;
}

// ---------- 按模块聚合 ----------
const groups = new Map();
commits.forEach((c) => {
  const m = moduleOf(c);
  if (!groups.has(m)) groups.set(m, []);
  groups.get(m).push(c);
});

// ---------- 人工 notes ----------
let notes = {};
if (A.notes && A.notes !== true) {
  try { notes = JSON.parse(fs.readFileSync(A.notes, "utf8")); } catch (e) { console.error("⚠ notes 解析失败：", e.message); }
}

// ---------- 两端实测 ----------
function probe(url) {
  try {
    const out = execSync(`curl -s --max-time 8 "${url}"`, { encoding: "utf8" });
    const d = JSON.parse(out);
    return { appVer: d.appVer || "未取得", pushRole: d.pushRole || "未取得", gen: d.gen ?? "未取得", viewGen: d.viewGen ?? "未取得" };
  } catch (e) { return { appVer: "未取得", pushRole: "未取得", gen: "未取得", viewGen: "未取得" }; }
}
let online = { appVer: "未探测" }, local = { appVer: "未探测" };
if (!A.noprobe) {
  online = probe("https://quant-dashboard-77614.app.workbuddy.host/api/lock/status");
  local = probe("http://127.0.0.1:8787/api/lock/status");
}

// ---------- 渲染 ----------
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const nowStr = new Date().toLocaleString("zh-CN", { hour12: false });

const rows = [];
[...groups.entries()].forEach(([mod, list]) => {
  const n = (notes.modules && notes.modules[mod]) || {};
  const change = list.map((c) => `<div class="ci"><span class="h">${esc(c.hash)}</span> <span class="t">${esc(c.time)}</span> ${esc(c.subject)}</div>`).join("");
  rows.push({ mod, count: list.length, change, benefit: n.benefit || "（待补：由发布出口填写）", risk: n.risk || "（待补：由发布出口填写）" });
});
(notes.extra || []).forEach((e) => rows.push({ mod: e.module || "其它", count: 0, change: esc(e.change || ""), benefit: e.benefit || "", risk: e.risk || "" }));

const signals = riskSignals();

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(VER)} 发布说明</title>
<style>
:root{--bg:#f7f8fa;--card:#fff;--bd:#e3e6ec;--tx:#1f2329;--sub:#646a73;--ok:#1f9254;--warn:#d83931;--blue:#1664ff}
*{box-sizing:border-box}
body{margin:0;padding:24px;background:var(--bg);color:var(--tx);font:14px/1.7 -apple-system,"Microsoft YaHei",sans-serif}
.wrap{max-width:1180px;margin:0 auto}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:26px 0 10px;padding-left:9px;border-left:3px solid var(--blue)}
.meta{color:var(--sub);font-size:13px;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:14px 16px;margin-bottom:14px}
table{width:100%;border-collapse:collapse;background:var(--card)}
th,td{border:1px solid var(--bd);padding:9px 11px;vertical-align:top;text-align:left}
th{background:#f0f2f5;font-weight:600;white-space:nowrap}
td.mod{font-weight:600;white-space:nowrap;width:110px}
td.ben{color:#14532d}
td.risk{color:#7f1d1d}
.ci{margin:2px 0}
.h{font-family:Consolas,monospace;color:var(--blue)}
.t{color:var(--sub);font-size:12px}
.n{display:inline-block;min-width:20px;text-align:center;background:#eef2ff;color:var(--blue);border-radius:9px;padding:0 6px;font-size:12px}
ul{margin:6px 0 0 18px;padding:0}
li{margin:3px 0}
.kv{display:flex;gap:26px;flex-wrap:wrap}
.kv div{font-size:13px}
.kv b{font-weight:600}
.pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;margin-left:6px}
.pill.ok{background:#e7f5ec;color:var(--ok)}
.pill.bad{background:#fdeceb;color:var(--warn)}
.foot{color:var(--sub);font-size:12px;margin-top:16px}
</style></head><body><div class="wrap">
<h1>版本 ${esc(VER)} · 发布说明</h1>
<div class="meta">生成时间 ${esc(nowStr)}　|　发布出口：量化看盘·发布上线　|　改动区间 <code>${esc(FROM)}</code> → <code>${esc(TO)}</code>　|　提交 ${commits.length} 个　|　文件 ${changedFiles.length} 个　|　${esc(fileSummary)}</div>

<div class="card"><h2 style="margin-top:0">一句话结论</h2>
<div>${esc(notes.summary || "（待补：由发布出口填写总体评价）")}</div></div>

<div class="card"><h2 style="margin-top:0">两端实测（发版后必查）</h2>
<div class="kv">
<div><b>线上</b> appVer=<code>${esc(online.appVer)}</code> pushRole=<code>${esc(online.pushRole)}</code>${online.pushRole === "primary" ? '<span class="pill ok">正常</span>' : '<span class="pill bad">异常·推送全停级</span>'} gen=${esc(online.gen)} viewGen=${esc(online.viewGen)}</div>
<div><b>本机</b> appVer=<code>${esc(local.appVer)}</code> pushRole=<code>${esc(local.pushRole)}</code> gen=${esc(local.gen)} viewGen=${esc(local.viewGen)}</div>
</div></div>

<h2>改了什么 / 好处 / 弊端</h2>
<table><thead><tr><th style="width:110px">模块</th><th style="width:34%">改动内容</th><th style="width:33%">好处</th><th>弊端 / 风险</th></tr></thead><tbody>
${rows.map((r) => `<tr><td class="mod">${esc(r.mod)} <span class="n">${r.count}</span></td><td>${r.change}</td><td class="ben">${esc(r.benefit)}</td><td class="risk">${esc(r.risk)}</td></tr>`).join("\n")}
</tbody></table>

<h2>自动风险信号（按改动文件扫描）</h2>
<div class="card">${signals.length ? "<ul>" + signals.map((s) => `<li>${esc(s)}</li>`).join("") + "</ul>" : "未触发已知风险模式。"}</div>

<h2>回滚方式</h2>
<div class="card"><ul>
<li>代码回滚：<code>git revert</code> 对应提交或 <code>git checkout &lt;上一版commit&gt; -- server.js public/</code>，再走一次发布流程（bump 回退版本号）。</li>
<li>生产回滚：对仓库根目录重新执行部署（复用同一 app），把代码恢复到上一版；发布包内 config 必剥离 pushRole，防副本配置覆盖。</li>
<li>数据回滚：运行时数据用 <code>_backup_data.js</code> 的备份（保留 latest 一份）覆盖还原，勿直接删库。</li>
</ul></div>

<div class="foot">本文档由 <code>_release_notes.js</code> 自动生成，改动清单来自 git 区间，好处/弊端由发布出口人工核定。数据缺失一律显式写「未取得」，不编造。</div>
</div></body></html>`;

// ---------- 落盘 ----------
const outDir = A.out && A.out !== true ? A.out : OUT_DIR_DEFAULT;
fs.mkdirSync(outDir, { recursive: true });
const d = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const outFile = path.join(outDir, `${stamp}-${VER}-发布说明.html`);
fs.writeFileSync(outFile, html, "utf8");

console.log("✅ 发布说明已生成：" + outFile);
console.log(`   版本 ${VER}　区间 ${FROM}..${TO}　提交 ${commits.length}　文件 ${changedFiles.length}`);
console.log(`   模块 ${rows.length} 个；未填好处/弊端的模块请在 notes.json 补后重跑。`);
