"use strict";
// 守门：一键发布 _release_publish.js
const assert = require("assert");
const R = require("./_release_publish.js");
let n = 0;
function ok(cond, msg) { n++; assert(cond, "断言失败: " + msg); }

// ① bumpVer
ok(R.bumpVer("20261027aa") === "20261027ab", "aa→ab");
ok(R.bumpVer("20261027az") === "20261027ba", "az→ba");
ok(R.bumpVer("20261027mq") === "20261027mr", "mq→mr");

// ② readVer 读取当前 server.js
const cur = R.readVer("./server.js");
ok(/^\d{8}[a-z]{2}$/.test(cur), "server.js APP_VER 可读：" + cur);

// ③ 防「谎报上线」（2026-10-28 事故：apply 完就推「已随版本 X 发布上线」，而线上仍是上一版）
//    本脚本无权部署生产（部署由 Agent 用发布工具完成），故必须实测线上再宣称状态。
const src = require("fs").readFileSync("./_release_publish.js", "utf8");
ok(typeof R.probeOnline === "function", "probeOnline 已导出（线上实测入口）");
ok(/const onlineOk = online\.appVer === ver/.test(src), "线上版本必须实测比对，不得假定本地包就绪即上线");
ok(/const deployPending = !onlineOk/.test(src), "未部署状态须显式标记 deployPending");
ok(/发布待部署/.test(src), "未实测到线上新版本时回告必须写「待部署」而非「已上线」");
ok(!/已随版本 \$\{ver\} 发布上线。/.test(src), "回告不得无条件宣称已上线（必须带实测证据）");
ok(/onlineVer: online\.appVer/.test(src), "release_last 落盘须记线上实测版本，便于追溯");
// ⛔ 2026-10-29 复核改挂分支：onlineOk 时每请求复核；deployPending 时 appVer===null（判不出）仍逐请求发起、
//    appVer 已知（明确旧版）跳过。两个语义分别钉：
ok(/online\.appVer === null/.test(src) && /runPostPublishCheck/.test(src), "判不出（appVer=null）仍发起复核（不硬判）");
ok(/跳过复核，待部署后再验/.test(src), "线上明确是旧版时跳过复核（不跑必红的验）");

// ④ 提交信息里的「N 个修改请求」必须是真的请求数（2026-10-28 修）
//    事故：gitCommit(files, ver) 的 files 是【四端版本文件】数组，files.length 恒=4，
//    于是每条发布提交都写「一键发布 4 个修改请求」（实证 225dd56 写 4、release_last.count=1）。
//    数字必须可信 —— 请求数走独立入参，不许再从版本文件数组长度派生。
ok(/function gitCommit\(verFiles, ver, reqCount\)/.test(src), "gitCommit 签名须把版本文件与请求数分成两个入参");
ok(/gitCommit\(relPaths, ver, files\.length\)/.test(src), "调用点须显式传真实请求数 files.length");
ok(!/一键发布 ' \+ files\.length/.test(src), "⛔ 反证：提交文案不得再拿 files.length（版本文件数）冒充请求数");
ok(/reqCount/.test(src) && /一键发布 ' \+ cnt/.test(src), "提交文案须用 reqCount 派生的 cnt");

console.log("PASS " + n + " 断言  _test_release_publish.js");
// ⛔ 标准汇总行：_runall 总榜只认「N 通过 / M 失败」等四种写法（只打 PASS N 断言会被判零断言→假红）
console.log("结果：" + n + " 通过 / 0 失败");
