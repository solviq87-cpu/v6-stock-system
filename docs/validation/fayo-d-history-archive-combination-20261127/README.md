# D组第二十七批：六项原始行情导入、存证与主备恢复组合验收（2026-11-27）

## 基线及集成边界
这是供总管验收的独立组合候选，不是重复建设或单独发布路线。基于 #517 精确 HEAD 758022ceab24ec5306f016393fe842c96ba4e8df（已含 #495/#509 及前26批主备恢复专项）。组合 #473/#475 的最终精确生产文件 market-data-center.js 与 market-data-evidence.js 及其原10+15项测试；保留 #517 原主备模块和 #427 已有的 paper-session 与 market-feed-consensus 修订；应用 #507 中两份精确 HTTP 200 兼容性测试文件。只在独立候选分支组合，不改原PR分支、账户、生产策略、权限、发布者或CI保护。
总管可以采用本候选已经组合的这些文件，或逐一应用原补丁并补上本批新增测试；不要重复引入同一生产改动。其他D组及跨组PR仍须整体协调。本候选不是完整27批合并或生产部署。

## 六项小任务及测试
1. 历史导入 HTTP 200 到原始回执与正式输出：实际原导入器保存原始字节，核对原回执ID、原始数据版本SHA与规范输出SHA的区别；历史查询不能提前看到后来回执。
2. 重复提交保护：相同字节与相同接收时钟的重试不新增回执、原始blob或已发布文件版本，仍绑定相同已入库证据。
3. 离线重启及缓存有效期：新建服务实例离线时读取原入库回执，保留真实原接收时点；touch不能续期，过期禁止恢复。
4. 双供应商一致性：使用登记为不同上游的东财历史及BaoStock受控历史数据，验证真实比较函数、独立原始对照存证；随后不一致的报价进入隔离，不能改写已有有效输出。
5. 损坏原始证据隔离：原隔离记录损坏时，即使后来的入库字节完整也拒绝该来源恢复；独立健康备用源仍可用，已发布历史文件保持不变。
6. 入库回执与输出发布中断：注入rename失败，在新入库回执已经存在但旧输出仍保留的状态下拒绝晋升；修复故障后同一回执精确重试可恢复，不重复写入原回执。此处验证局部失败关闭与重试语义，不代表存证与输出是跨文件原子事务。

新增测试文件 V6_BO/tests/fayo-d-history-archive-combination.test.js，六项均使用原生产 API，无替换生产 importer 或 archive API 的桩；正式 node:test 文件使用真实 fs/crypto/原存证与锁模块、受控供应商响应。测试日期及数据均为人工夹具，不宣称行情真实授权、交易日覆盖或收益证据。

## 实际执行及限制
- 本地 Node.js v22.16.0 重跑前26批主备/队列/跨进程/归档绑定原生专项，63/63通过，0失败、0跳过、0取消。仍使用前26批历史导入与回执读取边界夹具。
- 第一轮实际V8隔离执行 #517 failover 与 #475 原历史导入依赖，新增6/6通过。
- 完成组合后的精确候选 8330bf7817fed2c40c913bf889a03d24244c380d，再次从GitHub读取完整生产JS、原两份目录JSON及全部三个新增/原专项测试文件。实际隔离执行原导入10项＋原回执15项＋本批6项，**31/31通过、0失败**。使用候选继承的 #427 paper-session 与 market-feed-consensus 版本（没有用旧版覆盖）。
- 执行器加载13份真实生产模块：market-data-center、historical-validation、historical-universe、corporate-actions、paper-session、a-share-calendar、market-feed-consensus、data-source-lineage、market-evidence-quality、daily-turnover-sanity、market-data-evidence、research-workspace-store、market-failover。原两份目录JSON均读取。隔离文件系统/权限/硬链接/rename/字节/URL/AbortSignal、断言为夹具，SHA-256为JS实现（通过空字符串与abc标准向量校验），账户进程锁为单线程同步夹具，未提供权益结算的输入使用边界桩，未调用的回测/账户模块为桩。不是原生Node真实磁盘/真实flock/多进程存证链验收。前63项和本31项分开报告，不将它们冒充一次全量组合。
- 未实际执行完整仓库的原生组合测试；未联网取数、真实交易、购买、部署或合并。远端CI应按精确候选执行，不能以本地隔离结果替代。

精确文件身份：
| 文件 | Git blob |
|---|---|
| market-failover.js | f1ad7102f6d650728f7ca697c29de9800cfe6a53 |
| market-data-center.js | 9aec2ccf9565268e7027c4ad64fe055dd772f086 |
| market-data-evidence.js | 88de33dfeb556c77c2f9a3abd5c29cbcba0498f6 |
| research-workspace-store.js | 9f42c186d3b9453570dadc5c2375a291405b27f0 |
| historical-validation.js | 087ad64d3dfe12e1695cbe09b03824ffe0658633 |
| paper-session.js | 1c3fc7ddc9896763fea5221dfd40aaa003b8913a |
| a-share-calendar.js | de3cf5148e6694ba72770800a779f6099052acb9 |
| historical-universe.js | a1f367eb6487efdef45f9a0cd382ffc328c23e86 |
| corporate-actions.js | 9af8d8ed0a2748f10463f77eed9c7345a12ab079 |
| market-feed-consensus.js | a0f3808b938a54cecd6f28f27e5cc7ba64eb1bd9 |
| market-evidence-quality.js | 9b678f381125aebbaf9f27fc82d6b2c3d5fda959 |
| daily-turnover-sanity.js | 8ac3571b4fed412600d8e77985330b0e888b7888 |
| data-source-lineage.js | 817048838ad9ba6abe02a1e308ac11a8bd695a98 |
| data-source-registry-2026.json | 460ff80ad5e80931ef6903b7855d64bf668854ab |
| data-source-catalog.json | 33817eaee4ef039127b9624bbbc9ac9d3e74802d |
| fayo-d-history-import-integrity.test.js | 10ed2c17112a36c8ef875b0a70b23adf57d52da2 |
| fayo-d-market-receipt-integrity.test.js | 0a50ce15c80888fe32a15680e5c15c09a60b8dd2 |
| fayo-d-history-archive-combination.test.js | 7606abcff1879bab28d1eb0119f01b87d4dcfc3d |
| complete-development.test.js（#507兼容修正） | 1154858cb8eafa06686eaee96e624d1dd8ab2eae |
| market-data-quality-gates.test.js（#507兼容修正） | 7742437715ea1308474181b9246fed54bba7db80 |

待真实Node组合复跑（全仓环境，Linux flock，隔离V6_MARKET_REQUEST_STATE_DIR）：
`cd V6_BO && node --test tests/fayo-d-history-import-integrity.test.js tests/fayo-d-market-receipt-integrity.test.js tests/fayo-d-history-archive-combination.test.js tests/complete-development.test.js tests/market-data-quality-gates.test.js`
另运行前63项（#517记录中的命令）及全部CI。

## 最新真实远端验收
- #503 精确头 00f0be7d1ba79f8729ed2136d3a57cce7642b299：CI run 45958575602 / verify job 140370725194，6573项中6566通过、7失败、0取消、0跳过。
- #507 精确头 a6b88c90394229bedfe2c81e67e3a267bb7b7d88：CI run 45960353147 / verify job 140376457013，6579项中6572通过、7失败、0取消、0跳过。
- 两者均只见 #427 已有的六项 paper-conditional-http.test.js 与一项 paper-decision-plan-http.test.js 失败，数据质量与多源血缘专项job成功；UI和提交覆盖失败。不能宣称总管问题已修复。
- #473/#475 原精确头CI仍为失败；其两项旧HTTP夹具兼容问题的精确修正在本候选中。#509 最新头工作流排队；查询#517精确头尚未返回运行记录。

## 原任务进度及未决
保守统计仍为60/78有部分整改证据（76.92%）、18/78待核对继续、0/78完整验收已确认。原任务编号-标题完整映射未找回，不将新增六项测试直接累加到原分母。剩余重点是真实Node存证组合、文件系统跨进程及发布中断恢复、各原PR合并后的完整CI、原始任务对应、合法接口权限与长期运行。不存在真正跨文件原子事务/机器掉电认证；默认证据目录完全删除且无显式配置的历史遗留边界仍按#517交接记录。
