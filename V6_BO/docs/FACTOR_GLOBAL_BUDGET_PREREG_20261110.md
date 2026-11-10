# V6 自动学习第十一阶段：全局试验预算与真正的事前候选承诺

## 问题定义

此前 PR #97 已对同一父影子版本的失败候选建立样本外使用账本，但新模型一旦晋级，试验计数就从另一条父模型链重新开始。长期、跨版本地不断测试同一研究策略集合，仍有适应性过拟合风险。此外，仅把**看完样本外结果后**产生的候选哈希记入研究报告，不能称为“事前预注册”。

本批不改正式15因子包、四套策略、模拟盘、行情接口、网页或账户。所有权重和试验额度只作用于**研究沙盒**。

## 第一层：跨版本全局试验预算（worker 默认生效）

- 研究进程每次载入私有模型归档，都按原字节 SHA256 校验并检查文件命名；从 `trialAudit.status=consumed` 以及老版本已看过测试集的 `shadow-updated`、`shadow-retained`、`paused-market-shock` 研究报告计入真实试验，不因成功升级而归零。
- 以最新 **90 个独立登记的研究信号日** 为滚动窗口，最多允许 **6 次已查看样本外结果的研究候选**；窗口前的报告不删除，仍留在完整历史审计中。
- 成功、失败、因市场冲击暂停但已查看过测试成绩的试验均计费；如果跨父版本研究试验的保留日范围发生重叠，直接拒绝学习。
- 预算已经用满时，普通研究候选返回 `skipped-global-trial-budget-exhausted`，不写新研究模型、不触及正式权重；冷却期纯监控仍可追踪成熟观察。
- 影子报告的 `globalTrialBudget` 记录当前窗口、已用/剩余额度和当轮是否消耗。**直接调用内部 `evolveShadowFactors` 而非 worker 的测试入口会标记 `not-enforced-direct-research-call`，不能宣称已执行全局试验门禁。**

## 第二层：严格候选权重预注册（显式启用，不伪装默认已上线）

真正的事前承诺必须在**任何被用作本次新鲜保留集的新股票信号冻结之前**产生，而不是先看收益再补一个候选哈希。

- 通过 `register` CLI 仅读取已有批次的**冻结因子特征文件**，显式不读取价格观察 `reportFile`。候选权重由独立训练流程提供为私有 JSON；代码检查因子集合、来源版本、相对于上一已接受权重的单轮最多8%变化和因子包边界。
- 注册报告 `prereg-<SHA>.json` 在私有目录以只写新增模式 0600 封存：精确候选权重、当前因子包指纹、研究算法源码指纹、先前已接受模型/研究试验指纹、截至注册时已冻结的特征指纹前缀、注册时间戳。
- 后续开启 `--require-prereg` 后，研究进程会先验证存在唯一有效预注册，再读取收益；研究算法、因子包、模型父版本、候选档案或冻结历史被替换，均拒绝候选样本外验证。研究核心再次核验：新增保留集首日信号的冻结时点 **必须晚于注册时点**，且完整遵守原有冷却/样本外/原始基准/逐因子反事实门禁。
- 若只是保持过去的 `once/watch` 兼容模式而**没有严格启用**，报告明确 `not-preregistered-legacy-research`，绝不标称完成严格预注册。已有预注册被检查到时会按其承诺候选运行，不允许暗中改换权重。
- 同一已接受模型 + 同一最后试验血缘最多保存**一个**候选注册；无法在看到结果前反复挑选多个备案来获得有利比较。

### 操作示例

研究候选文件是本地私有 JSON，**只列已经训练得到且经批准的权重**（因子 ID 必须与冻结输入相同），不能把结果价、账户信息或密钥放进去：

```json
{
  "sector_heat": 1.35,
  "leader_strength": 1.25
}
```

先在新保留集的股票信号冻结**之前**执行：

```sh
node scripts/factor-shadow-worker.js register /private/manifest.json /private/shadow /private/proposed-weights.json
```

等新信号冻结，并有至少5个独立成熟观察日后：

```sh
node scripts/factor-shadow-worker.js once /private/manifest.json /private/shadow --require-prereg
node scripts/factor-shadow-worker.js watch /private/manifest.json /private/shadow --require-prereg --interval 60000
```

**注意**：此阶段增加了可严格启用的候选事前封存协议，但**尚未自动实现从训练数据生成候选并触发注册的调度器**。严格模式须由运维或后续受控工作流在新信号产生前提交权重。未经实际运行，不代表中国大陆云实例已自动注册、更不代表实盘盈利认证。

## 已知边界

- 本地时钟、SHA256 及本地 0600 归档无法抵御拥有全部文件、时钟和部署权限的恶意操作者；需要外部可信时间戳、独立异地不可篡改审计，以及单主运行锁防多进程同时写入。
- 90个登记的信号日不是交易所认证的统一A股日历；同板块股票和跨日市场状态有相关性；六次预算为保守运维限额，不是已证明统计显著性校正。
- 预注册候选权重来自外部/提前完成的训练，不应再根据新保留集结果调参；若代码或研究因子定义变化须重新开展受控预注册，而不能手工修改旧档案。

## 回归

```sh
cd V6_BO
node --check src/core/factor-global-trial-budget.js
node --check src/core/factor-candidate-prereg.js
node --check src/core/factor-shadow-evolution.js
node --check scripts/factor-shadow-worker.js
node --test tests/factor-global-trial-budget.test.js tests/factor-candidate-prereg.test.js tests/factor-shadow-evolution.test.js
npm run check
npm test
```

回归覆盖六次预算上限、跨已接受模型不清零、90日滚动、跨版本重叠/损坏档案拒绝、严格模式提前拦截未注册候选、事前封存时点与精确权重、重启读取、候选篡改/模型血缘/代码变动拒绝。

回滚：Git revert 本PR合并提交，研究归档只读保留；不能用旧压缩包覆盖当前仓库。
