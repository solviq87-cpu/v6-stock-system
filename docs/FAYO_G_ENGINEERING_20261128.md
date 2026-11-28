# 绯曜 FAYO｜G组第一批工程专项局部交接

2026-11-28。本专项保留原60、ABCD、66、78、F01—F50共228项及其他有效成果，不改UI、生产发布、账户、交易权限、风控或发布者。96项分两批：G01—G04共56项；G05—G07共40项。

## 精确基线

dev b936ebdddb8c11948dd0e63f95332898dd5c1cf5，树 e2bf753356244f11a3f6a2d22a0414ed48f15944，4347个blob，[原CI](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/46109690422)、双端及逐提交均成功。F统一候选#612 14ec08aa50d31660b0f4f46c29a95cc11ac1bc6f，树c31cb3bc13bfa558ca6dc267a00ae394e67b817a，4756个blob，新增409、修改175、删除0；该候选6项CI工作流成功，[PR CI](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/46132847173)。这些均为原精确SHA证据，不是本组新候选CI。原225局部覆盖/3条件暂缓不是最终签收。

读取根与后台AGENTS、任务/交接、DEPLOYMENT、npm入口、活动PR、原CI；两棵完整Git树未截断。排除归档、测试、文档、历史、vendor、dist、public后，按blob SHA分组至少120字节JS/MJS/CJS/Python/TS/TSX源文件，未发现完全相同组；不证明语义去重完成，不删除业务代码。

## 原契约局部核查

- 数据中心：market-data-center.js、market-snapshot-quote-time.js、data-source-lineage.js；原始vendor时间、错日、未知和交易授权边界。
- 模型：approved-factor-cache.js、factor-maturity-manifest.js、factor-shadow-evolution.js；批准观察、背景证据和成熟边界。
- 账户/风控：risk-state-contract.js、paper-plan-entry-binding.js、risk-workbench.js；15秒门禁、账户修订/fingerprint绑定、计划不授予交易权限。
- 成交/学习：paper-fill-evidence.js、paper-account-ledger.js、learning-outcome-integrity.js；证券日期、单位、原报价和次交易日完整结果。
- 上述六个相关源文件已定向读取；研究与执行/成交档案的时效不同，不能据研究时效认定交易可使用旧价。实际生产消费者、配置传播、撤销、兼容性和语义重复待核。保留原权威契约。
- 复用 scripts/resume-context.js、verify-tap-completeness.js、verify-pr-commit-statuses.js、audit-fayo-integration-gates.js、run-full-regression.sh；不改原64/32/65和CI。

## 实际修改与测试

四个父blob在dev和#612一致。只修改原续接脚本、原TAP检查及相应两个原测试文件。续接以realpath绑定真实Git根，拒绝上层仓库SHA；600个长名脏文件原64KiB上限失败，现8MiB硬上限、仍只显示12条。TAP拒绝零/非安全整数计划、计划后用例、bailout及重复/非零失败或取消摘要；保留原文件包装器和独立skip语义。

Node22.16.0，原文件逐blob核对。TAP原5项与新增4项，修前6/9、修后9/9，真实Node TAP通过校验。续接两项新反例修前失败；真实临时Git隔离组合4/4通过。完整HANDOFF未复制，原仓库检查点用例首次因ENOENT失败，故明确隔离选取4项；已检查两个远端原HANDOFF唯一标记，完整仓库原用例待新CI。未删原测试。
命令：
- node --check scripts/resume-context.js
- node --check V6_BO/scripts/verify-tap-completeness.js
- node --test V6_BO/tests/tap-completeness.test.js
- node --test --test-name-pattern='resume reads|resume shows|resume rejects|resume bounds' V6_BO/tests/resume-context.test.js

本地已验四个修改blob：scripts/resume-context.js e3c10da19e608b9ab5ac3f8c0e228f323f9963a6；V6_BO/tests/resume-context.test.js 641fc2aeb4cd35908f3d468ee728430a3ba80124；V6_BO/scripts/verify-tap-completeness.js 13244427b1b595ea031e775a383c55a6cf06a82c；V6_BO/tests/tap-completeness.test.js d2e80e90d47c9bf622f05af9705f57412d3f1dda。
新精确SHA仍须原正式CI，不移用历史测试结果。

## 原编号登记

黄色=局部证据或整改，待完整验收；灰色=待继续；绿色=整项验收。当前G专项绿色0，黄色33，灰色63。不影响历史任务状态，不以测试数量计算完成率。

| 模块 | 黄色编号 | 灰色编号 |
|---|---|---|
| G01(12) | 1,2,3,9,10,11,12（树、目录映射、非删除、保留及回退） | 4—8 |
| G02(12) | 1,2,3,4,8,10,12（原契约局部核对） | 5,6,7,9,11 |
| G03(16) | 1,2,3,4,8,13,14（入口复用、版本与续接） | 5—7,9—12,15—16 |
| G04(16) | 1—4,8,10—16（原框架、局部检查、反例、证据分层） | 5—7,9 |
| G05(16) | 无 | 1—16 |
| G06(12) | 无 | 1—12 |
| G07(12) | 无 | 1—12 |

第一批56项中局部33、待23；第二批40项待继续。G04.7最终全量由原总管执行。完整仓库及现场环境未下载/未验收；不宣称整批完成。

## 集成和回退

独立候选分支以dev为父，#612仍未合入，不越权合并。四个父blob与#612一致，由总管检查后纳入；HANDOFF/DEPLOYMENT与其他组共享文档需保留双方增量。失败阻断合并，撤销这两个脚本和测试的局部补丁；不回退业务历史、账户、账本或数据卷。没有新增依赖、API、外部模型调用或生产权限，未部署。后续在同一分支继续原任务，优先完成本批余项及专项CI，再进入G05—G07。
