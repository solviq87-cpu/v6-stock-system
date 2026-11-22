# 天枢智策 V6 归档与交接 · 2026-11-22

业务基线为 `609d021b522f465968de8e4d31689db45cd0f3c6`，已经合入仓库默认分支 `dev`。交接和源码归档以 `v6-archive-20261122` 的 Git 标签及下载包校验回执为准。生产运行版本需在 WorkBuddy 上独立读回。[业务基线](https://github.com/solviq87-cpu/v6-stock-system/commit/609d021b522f465968de8e4d31689db45cd0f3c6)

## 已合并的交付

| 范围 | 内容 | 记录 |
| --- | --- | --- |
| 页面与联动 | 统一 11 个标签。首页精选与完整列表同源，刷新时间与报价原始时间各自显示。个股抽屉保留选中股票池依据，随同股报价刷新。 | [#318](https://github.com/solviq87-cpu/v6-stock-system/pull/318)、[#319](https://github.com/solviq87-cpu/v6-stock-system/pull/319)、[#321](https://github.com/solviq87-cpu/v6-stock-system/pull/321)–[#324](https://github.com/solviq87-cpu/v6-stock-system/pull/324) |
| 收盘复盘与带动性 | 六段复盘、同日涨停原因、完整来源池及逐股带动性。来源缺失或旧时点各自标注。 | [#320](https://github.com/solviq87-cpu/v6-stock-system/pull/320)、[#325](https://github.com/solviq87-cpu/v6-stock-system/pull/325) |
| 分源采集与快涨 | 按数据类型限频，复用同一轮市场采集。快涨使用同源同阶段、间隔 5–60 秒的合格低点。只读响应和共享快照使用公开候选结果。 | [#326](https://github.com/solviq87-cpu/v6-stock-system/pull/326)–[#328](https://github.com/solviq87-cpu/v6-stock-system/pull/328) |
| 异动监控 | 异动和竞价卡轻量刷新，查看三分钟异动留存、报价年龄、覆盖与退避。开发者自选最多 20 只，使用 220 只报价计划的剩余名额。详情可追溯至原异动、涨停原因和资讯避险。 | [#329](https://github.com/solviq87-cpu/v6-stock-system/pull/329)、[页面和代码入口](V6_WORKSPACE_TABS.md) |

## 验证与分支核对

- `609d021` 对应本地后端全量 4,397 项通过，0 失败、0 跳过。浏览器覆盖 9 个场景、7 个视口，验收样本是隔离行情。模拟盘账本专项 31 项通过，自选文件已在独立目录完成备份、校验和恢复演练。[合并前检查](https://github.com/solviq87-cpu/v6-stock-system/pull/329/checks)
- 合并后 `dev` 的 V6 CI 12 项通过，浏览器几何和逐提交检查通过。该次自动完整包流程的打包与入库步骤跳过，WorkBuddy 流程的静态发布步骤也跳过。[合并后 CI](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/44994045935) · [浏览器几何](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/44994046038) · [自动归档流程](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/44994277809) · [静态发布流程](https://github.com/solviq87-cpu/v6-stock-system/actions/runs/44994277798)
- 整理开始时 GitHub 无待合并 PR。旧工作树分支 `fix/header-auth-compat-20261120`、`fix/history-dataset-compat-20261120`、`fix/live-features-closure-20261120`、`fix/release-browser-20261120`、`fix/release-ui-integration-20261120` 各有一个不同提交号的补丁，`git cherry dev` 均确认补丁已等价合入。已移除这五个干净工作树并保留原分支引用。需要核对原分支时可从相应引用重新建立工作树。

## 源码归档与恢复

- 源码备份使用仓库现有完整工程打包器，从精确 Git 提交读取跟踪文件，并按文件核对 Git 对象和 SHA-256。归档标签指向含交接文档的合并提交。线上持仓、模拟盘账目、私有自选和凭证由部署节点独立备份。[源码打包与验证工具](../scripts/build-complete-engineering-bundle.py) · [私有状态恢复流程](../../SAFE_AUTO_UPDATE_OPERATIONS.md)
- 既有顶层 `archive/` 含 632 个跟踪文件、148,342,760 字节，已做逐文件冷导出校验。当前 Windows 运行包从 `V6_BO` 子树构建，该归档用于历史对照和恢复。[历史归档索引](../../archive/consolidated-20261114/README.md)
- 恢复源码时从标签取得固定版本，在空目录验包及展开。应用升级前另外验证现有节点私有备份，并保留现有运行目录和进程读回信息。[恢复与回滚流程](../../SAFE_AUTO_UPDATE_OPERATIONS.md)

## 仍待完成的上线验收

1. 在完整 WorkBuddy 应用的受控部署入口上传并读回新模块，按现有备份与回滚流程重启 Node，再核对前后端版本。上一次验证确认应用内受控源文件接口可编辑白名单内既有文件，完整目录发布和 Node 重启仍需要能操作这些步骤的入口。
2. 在一个完整交易日验收竞价、盘中、午休和收盘，记录实际原始报价到页面延迟、有效报价覆盖、来源退避和休市快照。用完整配置检查真实手机、电脑各自能读取同一状态。
3. 跨交易日核对模拟成交、持仓与账本，使用独立副本验证私有恢复。准确区分真实推送回执和隔离测试记录。

历史过程和口径保留在 [交接入口的历史检查点](../../HANDOFF.md#历史检查点--2026-11-20-至-22)。
