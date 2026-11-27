# D组第二十三批：已有补丁组合验收及正式CI阻塞核对（2026-11-27）

## 范围及分工
本批转向测试与验收，不新增生产模块。基于第二十二批 #503 最终 HEAD 00f0be7d1ba79f8729ed2136d3a57cce7642b299，独立测试分支，不直接修改 #503、#473、#475、#482 或总管 #427 的原分支。#503 前次24项的报告已由其后续精确HEAD的30项原生测试补充，采用最终版本。
本次新增一个组合测试文件，修复两个原测试的HTTP响应夹具，不删减断言、不放宽原生产HTTP 200门禁、不改变策略、账户、发布、权限。将日历补丁 #482 仅在本地组合测试中替换为其准确文件，不把 #482 生产文件重复提交到本PR；总管仍按原分支顺序集成。

## 原生 Node 组合实测
Node.js v22.16.0，实际本地文件系统与原生产默认日历读取器，供应商资金返回及查询时钟使用确定性夹具，不联网。
- #503最终资金模块与原三份测试，接入 #482 修订后的日历模块、真实原仓库日历JSON：30/30通过，0失败。
- 加入6个真实默认日历组合场景：36/36通过，0失败、0跳过、0取消。
- 在原 #503 日历模块版本下复跑同一36项：36/36通过，0失败、0跳过、0取消。
- 组合场景覆盖仓库242个登记交易日与资金窗口一致性、真实休市周末与缺日不能互相抵消、原首次观察时点之前日历不可知、未证实北交所覆盖保持未知、历史截止日不触发最新窗口请求、跨2027年度不能推测交易日。0与负净额仍为真实数值，不认证实时行情或交易许可。

实际执行文件精确blob（本地git hash-object与GitHub读取一致）：
fund-history-cache.js 3c0b0bcf3af228df3fd08681c6ce51f1aa557d5a
research-calendar-source.js 原d0a534729c174b8e24c210eee58c84bc21928eb3 / #482修订ebab0f5968e70098dc47a11433e4a870fa073f2b
a-share-calendar.js de3cf5148e6694ba72770800a779f6099052acb9
trading-calendar.js f3e2cf0f549d743346e5f4b54ef9ce3cc8c062ce
config/research-calendar-2026.json 3488d66ab4835ca0c02aa5c2c4d35d9fc2afda2b
fund-history-cache.test.js 15a19137168dcb2bb73edef93b49db80c60fb8c3
fayo-d-fund-history-recovery.test.js 58d07982f3dbef0ced1ea261fe0f018cc6d5ad5c
fayo-d-fund-history-original-evidence.test.js 164ff31868d9a364947edbda3ae6e392ca1fff37
fayo-d-fund-calendar-combined.test.js b35d0e5dd90d5b10a87c93326d19f15365b76ee6
命令：
`cd V6_BO && node --test tests/fund-history-cache.test.js tests/fayo-d-fund-history-recovery.test.js tests/fayo-d-fund-history-original-evidence.test.js tests/fayo-d-fund-calendar-combined.test.js`

## 真实远端CI故障与兼容性整改
#473 V6 CI run 45948641882，verify job 140339070958：6108/6110通过，2失败。
#475 V6 CI run 45949068055，verify job 140340451467：6123/6125通过，2失败。
均为同两条原用例：complete-development.test.js:29 多源备用及过时缓存；market-data-quality-gates.test.js:12 非JSON MIME拒绝。旧成功回执夹具只提供ok:true，缺HTTP status，D12严格HTTP 200检查使其先拒绝；不是应放宽安全门禁的证据。只在对应回执加入status:200，保留原断言及其余测试。
实际加载 #475 精确生产 market-data-center.js、market-failover.js、a-share-calendar.js 及两条原测试回调隔离对照，修前0/2，修后2/2。此组使用V8内存文件、历史结构校验/存证、锁、摘要、URL和流夹具，未运行真实完整存证链或两份旧测试文件的其他测试；首次辅助加载缺外围trading-calendar，改为精确截取原失败用例再跑成功，不把加载失败计为生产失败。
修改的两个测试blob：complete-development.test.js 1154858cb8eafa06686eaee96e624d1dd8ab2eae；market-data-quality-gates.test.js 7742437715ea1308474181b9246fed54bba7db80。其原blob在 #503 和 #475 相同。总管在组合 #473/#475 时须同时应用本测试夹具修正；不声称旧失败run已转绿。

## 原22批精确头CI快照
从GitHub实际run API查询，以下为本次查询时点的状态，非合并后验收。
| PR | V6 CI | UI Browser Geometry | PR Commit Coverage |
|---|---|---|---|
| 431 | success | success | failure |
| 433 | success | success | failure |
| 436 | success | success | failure |
| 439 | success | success | failure |
| 441 | success | success | failure |
| 443 | success | success | failure |
| 447 | success | success | failure |
| 449 | success | success | failure |
| 453 | success | success | failure |
| 455 | success | success | failure |
| 460 | success | success | failure |
| 473 | failure | success | failure |
| 475 | failure | success | failure |
| 477 | success | success | failure |
| 479 | success | success | failure |
| 482 | success | success | failure |
| 487 | success | success | failure |
| 490 | success | success | failure |
| 493 | queued | in_progress | in_progress |
| 495 | queued | queued | queued |
| 497 | queued | queued | queued |
| 503 | queued | queued | queued |
16批CI及浏览器通过、2批CI失败（上述夹具）、4批仍在队列/运行；18批提交覆盖失败，4批待结果。不能把CI成功等同每提交覆盖、组合验收或部署完成。

总管候选 #427 精确头 6b26837c41b7d62e69c6c89c3dc035bf9dbc5e4f 的全量 V6 CI run 45930805277，verify job 140282724697：6553 tests，6546 pass，7 fail，0 skipped，0 cancelled。7项集中于 paper-conditional-http.test.js (6) 和 paper-decision-plan-http.test.js (1)，真实日志存在条件单/计划资格断言失败，不属本轮D组单独修复。该run的a-share-session-data-quality及multi-source-data-lineage两个专项job成功。另UI run 45930805271失败；提交覆盖run 45930805294失败，日志缺91557d862b35和6b26837c41b7的真实smoke状态。总管需保留原规则并协调相应组修复，不能伪造状态或绕过。
上述日志可由仓库 Actions 对应 run 复核。

## D01–D78原任务编号
本轮再查原任务正文及历史记忆，仍未取得完整78项标题/验收要求；不推测剩余编号内容。维持可核实下限60/78部分整改（76.92%），0/78完整验收已确认，18/78待原号核对及继续。待核对编号D05、D06、D07、D11、D24、D42、D46、D47、D50、D51、D52、D65、D67、D68、D69、D71、D72、D75，不意味着完全未开发。原任务映射及真实供应商权限、实际运行、长期监测、完整组合CI待验收。全量回归未在本地重跑，未合并、发布、部署、联网取数或真实交易。
