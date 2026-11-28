# 绯曜 FAYO 第一组 G01—G07｜专项记录（独立候选，第1批）

## 固定基线与范围

- dev: `b936ebdddb8c11948dd0e63f95332898dd5c1cf5`，tree `e2bf753356244f11a3f6a2d22a0414ed48f15944`，ABCD #563 已合并。原PR候选8029/8029，不能替代本组新代码CI；dev push 46109690422 成功。
- F01—F50 #612: `14ec08aa50d31660b0f4f46c29a95cc11ac1bc6f`，tree `c31cb3bc13bfa558ca6dc267a00ae394e67b817a`，6项push/PR工作流成功，其中46132847173为12/12 jobs。仍为未合并的独立候选，不代表所有228项业务签收。
- 两完整Git树未截断，blob 4347/4756；由dev到F候选新增409、变更175、删除0。限定活跃JS/MJS/CJS/PY/TS/TSX、至少120字节、不含测试、docs/history/archive/vendor/dist/public的源码SHA分组未发现完全相同的组。不代表不存在语义重复、共享资源、弃用入口或运行依赖，暂不删除文件。
- 第一批 G01—G03 40项；第二批 G04—G05 32项；第三批 G06—G07 24项。提前修复G04关联工具不重复计数。96原ID不替代任何历史任务、ABCD或F台账。

## 第一批已核查的真实工程入口

- G01.1—3/.5/.11：复用 AGENTS、TASK_MASTER、HANDOFF、DEPLOYMENT 与原 #563 集成证据；实际读取两树。V6_BO/src/core 298个目录条目，src/server 34个，tests 928个条目。保留旧历史、研究和所有测试；尚未完成逐模块语义去重、不可达与配置全盘审查。
- G02.1—4/.7—8/.10：定向查看原风险合同 docs/FAYO_RISK_INTEGRATION_CONTRACT_20261126.md 与 market-data-quality.js、market-snapshot-quote-time.js、paper-input-provenance.js、risk-state-contract.js。原行情时点与接收时点独立；90秒研究用途不授予交易许可，原风险价15秒仍保留；原账户数量与冻结按权威账本，金额人民币，未知值保留null。消费证据：fayo-d-market-causality-quality.test.js（时间/板块/质量/原快照消费）、phase4-learning-identity-before-quality.test.js（学习、审批、评分和原中心撤销）、risk-workbench-runtime-isolation.test.js（原双账户独立风险运行）、data-source-runtime-usage.test.js（登记与真实使用区分）。这些文件路径和测试内容已核查，未单独执行，不声称全业务合同完成。未另建权威接口。
- G02.12/G04.8：GitHub 实际读回 dev protected=false、rulesets=[]；原工作流和仓库内规则文件存在但服务端强制保护未启用。交总管处理，不改设置，不利用缺口合并。#612工作流与dev有差异，合并由总管保持原门禁。
- G03.1—3/.8/.13—14：复用原 npm run context:resume 和现有唯一有界检查点，按精确SHA只读必要模块，保留历史；不重复安装依赖、不重复产生PR。原#574文档更新与另一个Python台账校验器不同于本次原Node续接工具代码，不重复实现。

## 已复现与修改（原生Node22.16.0、隔离临时Git仓库）

1. scripts/resume-context.js：项目误放在另一个Git仓库子目录可读取外层SHA；超过64KiB的普通脏工作区会直接失败。原工具修正为核对真实Git根目录，工作区输出内存有限（8MiB），展示仍仅12条、原4000字符检查点不变，保留离线状态与远端CI区分。原代码blob 593ee039a5081cbffa7a9491a85c522246d43e08。原新增两反例均失败；修后四项隔离测试通过（包括两个原测试）。原测试另有真实HANDOFF读入场景因本地无完整仓库未运行，远端CI仍需执行；原文件已读回唯一非空标记，保留原结构及历史。
2. V6_BO/scripts/verify-tap-completeness.js：空结束计划、计划后仍有用例及失败/取消摘要矛盾可误报成功。原代码blob 4b94b81227f37cfa2ff6c2ca89e4f51c135c3894。原5项测试保留，新增4项正常/异常检查，修前6/9，修后9/9；支持Node原plain-script特殊序号和正常可选skip，未改原CI或测试执行入口。
3. 原生本地专项合计13项通过（TAP 9、续接4；真实仓库HANDOFF用例单独待验），不是全量回归。两个精确源码与两个测试的本地Git blob分别为 e3c10da19e608b9ab5ac3f8c0e228f323f9963a6、13244427b1b595ea031e775a383c55a6cf06a82c、641fc2aeb4cd35908f3d468ee728430a3ba80124、d2e80e90d47c9bf622f05af9705f57412d3f1dda；提交后应逐blob读回，另核CI。

## 尚未完成

G01语义重复、废弃代码依赖和真实回退逐项审查；G02实际消费者及异常测试/配置传播、模型启停与兼容复核；G03效率规则实际持续执行、量化算力证据及剩余工作。G04的全部回归门禁、G05/G06/G07按后两批逐项执行。仅本记录不是96项全部验收；新SHA CI及原现场均待验。不改UI、账户、策略权重、交易门禁、运行调度及生产发布，不采购或增加外部API。总管仅按原审批合并。本组分支回退只恢复对应代码和文档，不覆盖原业务卷。
