"use strict";
// ============================================================
// 🚀 一键发布模块 _release_publish.js（2026-10-27）
// 把 bump 版本号 → git commit → sync → apply → 标记 published → 回告 → 复核串成一键。
// ============================================================
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const releaseApi = require("./_release_api.js");
const tracker = require("./_change_tracker.js");
const ppc = require("./_post_publish_check.js");

const ROOT = "C:\\Users\\28957\\WorkBuddy\\2026-09-25-13-40-58\\stock-dashboard";
const PY = process.platform === "win32" ? "python" : "python3";

// ⛔⛔ git PATH 根治（2026-10-29 发布看板「点了不发布」真凶）：
//    start_daemon.py（pythonw）拉起的 node 进程 PATH 里没有 git —— _release_publish 的
//    execSync('git ...') 直接抛「'git' 不是内部或外部命令」，publish 整批失败，
//    用户手机点确认 → 开始执行 → 发布失败 → 请求留队列 → 再点再失败，死循环（10-28/10-29 实测）。
//    修复：模块加载时探测 git 绝对路径，把所在目录注入所有子进程 env.PATH。
const GIT_CANDIDATES = [
  "D:\\LenovoSoftstore\\Install\\WorkBuddy\\resources\\vendor\\PortableGit\\cmd",
  "C:\\Users\\28957\\.workbuddy\\binaries\\PortableGit\\versions\\current\\cmd",
  "C:\\Users\\28957\\.workbuddy\\binaries\\PortableGit\\versions\\1.3.0\\cmd",
  "C:\\Program Files\\Git\\cmd",
  "C:\\Program Files (x86)\\Git\\cmd",
  "C:\\Users\\28957\\AppData\\Local\\GitHubDesktop\\app-3.4.12\\resources\\app\\git\\cmd"
];
function _buildGitEnv() {
  const env = Object.assign({}, process.env);
  try {
    execSync("git --version", { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    return env; // PATH 里已有 git，无需注入
  } catch (e) { /* 缺 git，找绝对路径 */ }
  for (const dir of GIT_CANDIDATES) {
    try {
      if (fs.existsSync(path.join(dir, "git.exe"))) {
        env.PATH = dir + ";" + (env.PATH || "");
        try { execSync("git --version", { env, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }); }
        catch (e2) { continue; }
        console.log("[release/publish] git PATH 注入:", dir);
        return env;
      }
    } catch (e) { /* 继续试下一个 */ }
  }
  console.warn("[release/publish] ⚠️ 未找到 git，发布将失败——请检查 Git 安装");
  return env;
}
const GIT_ENV = _buildGitEnv();

function readVer(file) {
  const m = fs.readFileSync(file, "utf8").match(/const APP_VER = '(\d{8}[a-z]{2})'/);
  return m ? m[1] : null;
}

function bumpVer(cur) {
  if (!cur || cur.length !== 10) throw new Error("非法版本号: " + cur);
  const date = cur.slice(0, 8);
  const suffix = cur.slice(8);
  if (!/^\d{8}$/.test(date)) throw new Error("版本号日期部分非法: " + date);
  // 后缀按字母递增：aa→ab→...→az→ba；双小写字母
  const c1 = suffix.charCodeAt(0), c2 = suffix.charCodeAt(1);
  if (c1 < 97 || c1 > 122 || c2 < 97 || c2 > 122) throw new Error("版本号后缀非法: " + suffix);
  let n1 = c1, n2 = c2 + 1;
  if (n2 > 122) { n2 = 97; n1 += 1; }
  if (n1 > 122) throw new Error("版本号后缀已耗尽");
  return date + String.fromCharCode(n1) + String.fromCharCode(n2);
}

function setVer(file, ver) {
  const txt = fs.readFileSync(file, "utf8");
  const newTxt = txt.replace(/const APP_VER = '\d{8}[a-z]{2}'/g, `const APP_VER = '${ver}'`);
  if (newTxt === txt) throw new Error(file + " 中未找到 APP_VER");
  fs.writeFileSync(file, newTxt, "utf8");
}

function gitClean() {
  const out = execSync("git status --short --untracked-files=no", { cwd: ROOT, env: GIT_ENV, encoding: "utf8" }).trim();
  return !out;
}

// ⛔ 脏工作区治理（2026-10-29 用户「重复出现这个问题，彻底搞一下」）：
//    旧逻辑「工作区不干净 → 直接抛错终止发布」在并行协作下必然反复触发 —— 其他空间的
//    未提交修改按协作协议本来就该「合并进本次一次发」，脏≠不能发（10-29 晚实测：用户连点
//    4 次全部死在这一步，同一指令无限重试）。
//    新逻辑：脏 → 把【已跟踪】的修改 git add -u 纳入本次发布提交（-u 只收已跟踪文件，
//    不含未跟踪新文件，不违反「禁 -A」铁律），返回脏文件清单供推送留痕。真出问题是
//    并行空间写一半，那也是发布本身要面对的，不该让用户在手机上死循环。
function gitAbsorbDirty() {
  const out = execSync("git status --short --untracked-files=no", { cwd: ROOT, env: GIT_ENV, encoding: "utf8" }).trim();
  if (!out) return [];
  const files = out.split("\n").map(l => l.slice(3).trim()).filter(Boolean);
  if (!files.length) return [];
  execSync("git add -u", { cwd: ROOT, env: GIT_ENV });
  return files;
}

function gitCommit(verFiles, ver, reqCount) {
  // ⛔ 2026-10-28：原签名 gitCommit(files, ver) 里 files 是【四端版本文件】数组，
  //    却被拿去当「修改请求数」写进提交信息 —— files.length 恒等于 4，
  //    于是每条发布提交都写「一键发布 4 个修改请求」，与实际请求数无关
  //    （实证：225dd56 写 4，而 release_last.count=1）。数字必须可信。
  //    改为两参分开：verFiles 只用于 git add，reqCount 只用于文案。
  execSync("git add " + verFiles.map(f => '"' + f + '"').join(" "), { cwd: ROOT, env: GIT_ENV });
  const n = Number(reqCount);
  const cnt = Number.isFinite(n) && n >= 0 ? n : verFiles.length;
  execSync('git commit -m "release(' + ver + '): 一键发布 ' + cnt + ' 个修改请求"', { cwd: ROOT, env: GIT_ENV });
}

function runPythonPublish() {
  const out1 = execSync(PY + " _publish.py", { cwd: ROOT, env: GIT_ENV, encoding: "utf8", timeout: 300000 });
  if (out1.includes("⛔ 发布闸门拦截")) throw new Error("发布闸门拦截：\n" + out1);
  if (!out1.includes("✅ 同步完成，可执行发布")) throw new Error("_publish.py 异常：\n" + out1);
  const out2 = execSync(PY + " _publish.py --apply", { cwd: ROOT, env: GIT_ENV, encoding: "utf8", timeout: 300000 });
  if (out2.includes("⛔")) throw new Error("--apply 失败：\n" + out2);
  return out1 + "\n" + out2;
}

/**
 * 生产实例实测（2026-10-28 加·防「谎报上线」）
 * 背景：本脚本只能做到「bump→commit→sync→apply 铺好本地包」，**生产部署必须由 Agent 用
 * workbuddy_sites_deploy 完成**（_publish.py 文件头注释明写「发布动作由 Agent 用发布工具完成」）。
 * 实测事故：my 版本 apply 完就标记 published 并推「已随版本 my 发布上线」，而线上仍是 mx —— 谎报。
 * 故此处强制探测线上 appVer：探测不到 = 判不出（null），一律不得宣称已上线。
 */
function probeOnline() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config.json"), "utf8"));
    const tok = (cfg.syncUpstream && cfg.syncUpstream.token) || "";
    const out = execSync(
      'curl -s --max-time 8 "https://quant-dashboard-77614.app.workbuddy.host/api/lock/status?token=' + tok + '"',
      { cwd: ROOT, encoding: "utf8", timeout: 15000 }
    );
    const d = JSON.parse(out);
    return { appVer: d.appVer || null, pushRole: d.pushRole || null };
  } catch (e) {
    return { appVer: null, pushRole: null, error: e.message || String(e) };
  }
}

const linkage = require("./_module_linkage.js");

// ⛔ 无改动不发布（2026-10-29 根治方案③）：版本号通胀根治。
//    HEAD 提交之后工作区若没有任何运行时代码改动，说明没有新东西要发——
//    此时 bump 版本号只会制造假版本（10-29 一天 aj→bo 20+ 个空版本事故）。
//    判据：git diff HEAD --name-only 过滤掉守门测试(_test_*)/文档(docs/任务同步)/运行时 json 后，
//    仍剩至少一个代码文件（.js/.html/.py）才算「有改动」。
function hasRealCodeChange() {
  let out = "";
  try {
    out = execSync("git diff HEAD --name-only", { cwd: ROOT, env: GIT_ENV, encoding: "utf8" });
  } catch (e) { return true; } // 判不出不硬判：放行（老行为）
  return out.split("\n").map(s => s.trim()).filter(f => {
    if (!f) return false;
    if (f.indexOf("_test_") === 0 || f.indexOf("_scan_") === 0) return false; // 守门/扫描器
    if (f.indexOf("docs/") === 0 || f.indexOf("任务同步/") === 0) return false;
    if (/\.(js|html|py)$/.test(f)) return true; // 运行时代码
    return false;
  }).length > 0;
}

async function publish(files, pushFn, sseFn, force, logFn) {
  // logFn（可选）：流程性消息（跳过/并入/中间态）只进面板流水；结论性消息（完成/待部署）才走 pushFn 飞书。
  // 根治「几分钟60多条」（2026-10-29）：发布链路 90 分钟刷 155 条，全是不该外发的流程态。
  const _flow = (typeof logFn === "function") ? logFn : function () {};
  if (!Array.isArray(files) || !files.length) throw new Error("未选择要发布的请求");
  // ⛔ 先查真改动，再 absorb 脏文件（顺序不能反：absorb 会暂存，diff HEAD 照样看得到，但语义上先判后收）
  if (!hasRealCodeChange() && !force) {
    _flow('⏭ 本轮无代码改动（HEAD 已是最新），跳过发布：不 bump 版本号、不产生空提交。');
    return { ok: false, reason: "no-change", version: null, count: 0, notified: [], details: [] };
  }
  // ⛔ 脏工作区不再终止发布：已跟踪修改并入本次提交（并行空间未发布修改按协议随本批发）
  const _dirty = gitAbsorbDirty();
  if (_dirty.length) {
    _flow(`🧹 工作区有 ${_dirty.length} 个未提交改动，已并入本次发布：\n${_dirty.slice(0, 5).join('、')}${_dirty.length > 5 ? '…' : ''}`);
  }

  // ① 模块联动检查：改动是否影响其他模块
  const check = await linkage.checkFiles(files);
  if (!check.ok && !force) {
    const redText = check.red.join('、');
    if (typeof pushFn === "function") {
      pushFn(`⚠️ 发布联检未通过\n影响模块：${check.modules.join('、')}\n红灯套件：${redText}\n请先让对应模块修复后再确认发布。`, true, { manual: true, private: true });
    }
    const err = new Error("模块联检未通过：" + check.summary);
    err.checkResult = check;
    throw err;
  }

  const cur = readVer(path.join(ROOT, "server.js"));
  if (!cur) throw new Error("读取当前 APP_VER 失败");
  const ver = bumpVer(cur);

  // ① bump 四端版本号
  const verFiles = [
    path.join(ROOT, "server.js"),
    path.join(ROOT, "public", "index.html"),
    path.join(ROOT, "public", "mobile.html"),
    path.join(ROOT, "public", "sw.js")
  ];
  for (const f of verFiles) setVer(f, ver);

  // ② git commit
  const relPaths = verFiles.map(f => path.relative(ROOT, f).replace(/\\/g, "/"));
  gitCommit(relPaths, ver, files.length);

  // ③ sync + apply（准备发布包）
  const pyOut = runPythonPublish();

  // ③-b 生产实测：本地包就绪 ≠ 线上已更新（本脚本无权部署，见 probeOnline 注释）
  const online = probeOnline();
  const onlineOk = online.appVer === ver;
  const deployPending = !onlineOk;

  // ④ 标记所有请求 published
  const notified = [];
  for (const file of files) {
    try {
      releaseApi.updateRequest(file, "published", ver);
      notified.push(file);
    } catch (e) {
      console.error("[release/publish] 标记 " + file + " 失败：", e.message);
    }
  }

  // ⑤ 自动回告 + 复核（⛔ 2026-10-29 收敛：deployPending 时不再每请求一条飞书，收敛成一条总览走流水；
  //    真上线（onlineOk）仍逐条回告——那是值得打扰的结论）
  if (onlineOk) {
    for (const file of notified) {
      try {
        const req = releaseApi.loadRequests().find(x => x.file === file);
        if (req) {
          const text = `📦 发布回告\n空间：${req.space}\n改动：${req.summary}\n已随版本 ${ver} 发布上线（线上实测 appVer=${online.appVer}）。`;
          if (typeof pushFn === "function") pushFn(text, true, { manual: true, private: true });
        }
      } catch (e) { console.error("[release/publish] 回告失败：", e.message); }
      try {
        // 复核是「实测线上」的动作：真上线时每请求复核一次
        ppc.runPostPublishCheck(file, ver, pushFn, sseFn);
      } catch (e) { console.error("[release/publish] 复核触发失败：", e.message); }
    }
  } else if (notified.length) {
    _flow(`⏳ 发布待部署\n${notified.length} 个请求的本地包已就绪 ${ver}，线上仍为 ${online.appVer || "未取得"}——须由发布上线空间执行生产部署，部署前不算上线。`);
    if (online.appVer === null) {
      // 判不出（appVer=null）仍逐请求发起复核，由复核侧自行实测判定——判不出不硬判
      for (const file of notified) {
        try { ppc.runPostPublishCheck(file, ver, pushFn, sseFn); }
        catch (e) { console.error("[release/publish] 复核触发失败：", e.message); }
      }
    } else {
      console.warn("[release/publish] 线上仍为 " + online.appVer + "（非 " + ver + "），跳过复核，待部署后再验");
    }
  }

  if (typeof sseFn === "function") {
    try { sseFn("published", "__batch__", ver); } catch (_) {}
  }

  // 每个请求的改动详情（发布结果推送用——用户要"知道都改了什么"）
  const details = notified.map(file => {
    try {
      const req = releaseApi.loadRequests().find(x => x.file === file) || {};
      return { file, space: req.space || "", summary: req.summary || "", files: req.files || "" };
    } catch (e) { return { file, space: "", summary: "", files: "" }; }
  });

  // 落盘最近发布记录（面板"上次发布"区块 / 历史查询的数据源）
  try {
    fs.writeFileSync(path.join(ROOT, "release_last.json"), JSON.stringify({
      version: ver, at: Date.now(), count: notified.length, details: details,
      onlineVer: online.appVer, deployPending: deployPending
    }), "utf8");
  } catch (e) {}

  // ⛔ 归档已发布请求（2026-10-28）：md 从 pending 移到 archive——
  //    否则看板把所有历史请求都列出来，越堆越多（用户投诉"记录不是还在吗"）。
  //    归档后收箱器下轮同步的快照自然不含这些，手机端/电脑端看板立刻干净。
  let archived = 0;
  try {
    const BOX_DIR = releaseApi.BOX || process.env.RELEASE_BOX || "C:\\Users\\28957\\WorkBuddy\\任务同步\\修改请求\\pending";
    const ARCHIVE_DIR = BOX_DIR.replace(/pending$/, "archive");
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
    for (const file of notified) {
      try { fs.renameSync(path.join(BOX_DIR, file), path.join(ARCHIVE_DIR, file)); archived++; }
      catch (e) {}
    }
    // 收箱器已通知集合里清掉这些文件名（否则重扫时状态残留无妨，但保持整洁）
    try {
      const stateFile = path.join(ROOT, "changes_state.json");
      if (fs.existsSync(stateFile)) {
        const st = JSON.parse(fs.readFileSync(stateFile, "utf8"));
        if (st && Array.isArray(st.files)) {
          st.files = st.files.filter(f => notified.indexOf(f) < 0);
          fs.writeFileSync(stateFile, JSON.stringify(st), "utf8");
        }
      }
    } catch (e) {}
  } catch (e) {}

  // ⛔ ok 语义改严（2026-10-29 根治方案①）：ok:true 必须「本地包就绪 + 线上实测同版本」双满足。
  //    只铺好本地包而线上没变 → ok:false + deployPending:true。调用端只认 ok:true，
  //    其余一律走失败分支——从根上消灭「假完成」。
  return {
    ok: !!onlineOk,
    version: ver, count: notified.length, notified, details, pyOut,
    onlineOk, onlineVer: online.appVer, deployPending, archived
  };
}

module.exports = { publish, bumpVer, readVer, probeOnline };
