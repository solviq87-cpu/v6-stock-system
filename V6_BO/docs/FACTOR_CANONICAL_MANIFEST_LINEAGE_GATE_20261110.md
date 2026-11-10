# V6 自动学习正式研究清单：冻结回执与首份成熟H5血缘复核（2026-11-10）

## 根因与范围

现有 V6 已具备合法导入的历史行情规范化、逐票因子时点冻结、5交易日成熟观察、不可变归档和 `v6-forward-training-manifest` 自检。然而 **manifest 自身的 SHA256 只能证明 JSON 内容未变，不能证明引用的记录确实来自原先冻结的信号、实际公司行为与首份成熟的 H5 结果**。旧版影子学习 Worker 对正式 manifest 做哈希校验后便读取其记录，可能接受事后重新生成哈希、但改指向较晚成熟报告的清单。

本次只在**正式 canonical manifest** 的影子研究读取路径复用已经存在的底层校验器，不改变正式15因子权重、四套选股策略、模拟账户、页面或任何行情采集与外部服务。

## 新的再核验门禁

`src/core/factor-maturity-manifest.js` 新增只读 `verifyCanonicalManifestLineage`，由 `scripts/factor-shadow-worker.js` 在**候选预注册与全局试验预算检查之后、读取任何 H5 回报之前**调用，仅适用于 `mode=v6-forward-training-manifest`：

1. 检查清单模式、不可交易声明、完整性 SHA256、日期严格递增、绝对私有路径和批次总数（最多400）。
2. 每个 `features-YYYY-MM-DD.json` 必须有原始同目录 `receipt-YYYY-MM-DD.json`；调用 `verifyDailyCapture` 重新校验回执、原信号 cohort、逐票冻结因子和创建时点的自洽性。
3. `reportFile` 必须指向该信号日 `tracking/YYYY-MM-DD/forward-tracking-history/<归档文件>.json`；调用 `readSnapshot` 校验文件SHA、实际观察时点、逐战法审核结果，并调用 `verifyAndJoin` 验证信号与远期报价来源的关联。
4. H5 窗口必须存在真实目标交易日、在 `report.asOf` 当日或之前到期，且状态只能是：`observed`、`missing-or-suspended` 或 `corporate-action-unresolved`。**缺价、停牌及公司行为不计为零收益。**
5. 调用 `firstMaturedArchive` 逐个复核该日不可变归档顺序，要求 manifest 引用的是**最早一份全部 H5 到期的封存版本**。不允许事后选择较高收益的另一个有效快照。
6. 不满足任何一项直接抛错，Worker 不进行新的影子学习版本写入。

原有简单 `schemaVersion:1,episodes:[...]` 的早期合成研究测试协议保留，避免重写历史验证工具；**新的强制门禁针对有正式 canonical 模式标记的真实研究清单**。部署时应使用 `factor-maturity-link` 生成的正式清单，不应改回弱约束的测试格式作为运营输入。

## 运维入口只接受正式清单（补强）

**所有直接运行 `scripts/factor-shadow-worker.js` 的运维 CLI 模式**（`once`、`watch`、`register`、`register-auto`）现在必须读取 `mode=v6-forward-training-manifest` 的正式清单。旧研究示例 `{schemaVersion:1, episodes:[...]}` 没有原捕获回执约束，不能作为生产式自动学习输入，也不能通过换名称绕开前述首份 H5 归档校验。

程序接口的旧测试模式仍保留以复现早期合成测试；不能将其当成生产运行授权。没有至少36个成熟独立研究日，正式 Worker 仍拒绝启动训练。更重要的是，36日和本地 SHA 一致并不能替代真实源许可/第三方核验与独立样本外检查。

新增回归 `node --test tests/factor-shadow-cli-canonical.test.js` 验证不合格的旧简化 manifest 在创建模型目录之前被拒绝，合法模式但样本不足仍按既有保守门禁退出。

## 回归与运行

从 `V6_BO` 运行：

```sh
node --check src/core/factor-maturity-manifest.js
node --check scripts/factor-shadow-worker.js
node --test tests/factor-research-pipeline-e2e.test.js tests/factor-maturity-link.test.js tests/factor-shadow-evolution.test.js
npm run check
npm test
```

端到端合成样本将执行：受控历史数据→信号和逐票因子冻结→第5交易日后归档→正式 manifest→新增的只读血缘校验。反向用例包括：更换为后来复制的有效封存档案、指向动态 `current.json`、换用没有对应原始回执的因子文件、篡改回执后重新签名清单。

**CI 通过证明的是离线协议与逻辑回归**。不能据此宣称真实数据已经联网接通、运营者拥有数据商业使用许可、观察时钟获得第三方时间证明、行业数据无遗漏、市场盈利性经验证或云端 Worker 已正式运行。此处的SHA都是本地完整性证据，不是上游签名。

## 保护/回滚

禁止修改 `public/index.html` / `public/mobile.html`、正式四策略、正式基础权重与权威资金账本；任何代码版本不能通过研究输出下实盘单或更新资金。
未合并前关闭PR，已合并后 `git revert` 相关合并提交；保留已有只读历史研究归档，**不得**通过旧版压缩包覆盖当前工程。
