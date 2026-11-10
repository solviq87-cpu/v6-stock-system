# V6 自动学习第十二阶段：历史封存报告驱动的候选自动预注册

## 目标

此前第十一阶段已具备跨版本试验预算、独占写入锁和严格的**候选事前预注册**，但必须人工创建候选权重 JSON。本批新增**由上一份封存历史研究报告确定性生成研究候选并提前注册**的显式命令，减少人工输入，同时不读取未来保留集收益。

**所有能力仍是影子研究，不能写正式15因子权重、四套选股策略、模拟盘、账户或真实交易链路。**

## 规则

1. `register-auto` 只读取 manifest 中冻结的特征文件，不打开任何对应的 `reportFile`；它可读取私有模型目录中**以前已经封存、SHA256 校验完整**的研究报告。由上一个有效已消费研究试验（若存在）或上一已接受影子模型提供历史训练期 `factorLearning` 与 `factorRedundancy` 证据。
2. 自动候选按照每个因子历史报告已固定的 `suggestedWeightMultiplier` 生成，不向保留集请求调参；对高相关、已被记录为冗余的因子延续保守的 -2% 抑制。权重每一轮最大±8%，相对于正式原始权重受50%–150%约束，所有计算为确定性、四舍五入至8位的小数。
3. 自动候选必须**确实与上一研究权重不同**；缺少既有封存报告、训练增量无效、因子包不匹配或报告指纹遭到篡改，立即拒绝自动注册。旧归档不得修改。
4. 自动生成的预注册记录额外封存来源报告指纹 `autoSourceFingerprint` 和算法标记 `candidateOrigin=sealed-historical-training-reliability-v1`，后续的严格验证要求来源等于注册时对应的已接受模型或最后试验血缘，不允许事后偷偷换来源。
5. 仍由现有 `withResearchLock` 独占锁串行执行检查、生成候选、写入只新增的0600预注册文件。同一模型与试验血缘仅允许一个注册记录。现有代码指纹范围加上本批候选自动生成算法，代码变化时旧承诺不再被误认为同一个预注册协议。
6. 必须在**新保留集首次信号冻结前**执行注册。研究样本成熟后，只有显式 `once/watch --require-prereg` 才会按事先注册的候选进行验证；原有训练/验证/原始基准对照、逐因子反事实、样本占用、衰减冷却与全局试验预算仍独立执行，未通过就不晋级。

## 使用方式

```sh
cd V6_BO

# 已有完整历史封存影子研究报告、当前至少36个已冻结研究日，
# 在新测试信号尚未产生之前，以单写入锁创建唯一候选承诺
node scripts/factor-shadow-worker.js register-auto /private/manifest.json /private/shadow

# 新测试信号冻结并有至少5个新增成熟测试日后，才做严格评价
node scripts/factor-shadow-worker.js once /private/manifest.json /private/shadow --require-prereg

# 若运维显式启用持续研究监控，仍可使用
node scripts/factor-shadow-worker.js watch /private/manifest.json /private/shadow --require-prereg --interval 60000
```

原先手动 `register` 保留兼容。这个自动生成步骤**尚未连接持续定时调度、未部署到云实例，也没有自动收集真实行情**。仅提供运维可显式调用的研究命令。

## 关键局限

- “自动提出候选”不等于机器已自行学习出稳定盈利的因子；建议权重继承之前研究模型中的已冻结**训练期统计证据**，这些统计本身可能过拟合。
- 预注册本地时间戳及SHA256无法抵御拥有所有磁盘/系统时钟权限者的完全重造，需要外部可信存证和独立备份。
- 多次试验的显著性、真实A股数据源合规性、数据费用滑点及生产部署均不在此批认证范围。

## 回归

```sh
cd V6_BO
node --check src/core/factor-shadow-candidate-proposer.js
node --check src/core/factor-candidate-prereg.js
node --check scripts/factor-shadow-worker.js
node --test tests/factor-shadow-candidate-proposer.test.js tests/factor-candidate-prereg.test.js tests/factor-shadow-evolution.test.js
npm run check
npm test
```

回归覆盖：历史可靠性因子调权、冗余抑制、权重边界、没有旧报告或无效报告即拒绝、算法/来源指纹篡改、事前时间限制、单写入锁内注册与完整后续研究验证、正式模型隔离。

**回滚**：Git revert 本 PR 合并提交；保存历史只读研究档案，不覆盖原有正式工程基线。
