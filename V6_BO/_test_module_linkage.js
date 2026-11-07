"use strict";
// 守门：模块联动检查 _module_linkage.js
const assert = require("assert");
const M = require("./_module_linkage.js");
let n = 0;
function ok(cond, msg) { n++; assert(cond, "断言失败: " + msg); }

// ① inferModules
ok(M.inferModules(["server.js:refreshSectorsZT"]).includes("涨停池"), "refreshSectorsZT→涨停池");
ok(M.inferModules(["server.js:pushAll"]).includes("推送模块"), "pushAll→推送模块");
ok(M.inferModules(["server.js:paperBuy"]).includes("持仓与模拟盘"), "paperBuy→持仓与模拟盘");
ok(M.inferModules(["em.js:fetchIndustryAll"]).includes("数据源"), "em.js→数据源");

// ② relatedTests
const t1 = M.relatedTests(["涨停池"]);
ok(t1.includes("_test_review_empty.js"), "涨停池关联 review_empty");

const t2 = M.relatedTests(["推送模块"]);
ok(t2.includes("_test_srcpkg_replica.js"), "推送模块关联 srcpkg_replica");

// ③ checkFiles（用涨停池相关文件，应无红灯）
(async () => {
  const r = await M.checkFiles(["_test_change_tracker.js"]);
  ok(r.ok, "自身守门测试无红灯：" + r.summary);
  console.log("PASS " + n + " 断言  _test_module_linkage.js");
  // ⛔ 标准汇总行（_runall 总榜只认「N 通过 / M 失败」等四种写法；只打 PASS N 断言会被判成
  //    「零断言」→ 假红，真崩了也看不出区别。已崩的走 assert 抛异常 → 退出码非 0 → 照样标红）
  console.log("结果：" + n + " 通过 / 0 失败");
})().catch(e => { console.error(e); process.exit(1); });
