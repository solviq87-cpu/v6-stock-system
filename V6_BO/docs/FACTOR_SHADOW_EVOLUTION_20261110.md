# V6 智能因子自主进化沙盒（2026-11-10）

## 目的

用户要求因子能够持续学习并自我改进。旧的 factor-health 仅评估因子输入覆盖、平均分漂移；sandbox-rule-priority-learning 只产生固定 ±3% 的候选优先级建议。新模块 factor-shadow-evolution 形成**真实可运行的研究版本循环**：

1. **事件时间冻结**：在已有冻结信号 cohort 产生后 5 分钟内，把同一股票、同一信号ID对应的已登记扩展因子分数和原始来源时点封存。拒绝已看见未来结果才补造历史特征；冻结文件包含关联 cohortFingerprint 与扩展因子包指纹。
2. **等未来观察成熟**：从既有 1/5/20/60 交易日观察器的 5 日窗口中取得每个信号已经成熟的未复权价格变化。按 signalId、symbol、signalDate、baselineClose、cohortFingerprint、feed 精确核对。待观察/停牌/公司行为不当作 0% 或输掉。
3. **按时间滚动学习**：汇集不同交易日的 36～400 个独立批次，至少需充足的成熟日和各日至少 5 只股票。每个交易日的因子质量用 **Spearman 秩相关（因子 IC）** 评估，只训练扩展因子，不使用 K 线未来数据生产当天信号。
4. **训练—验证—保留测试**：按信号日期排序、截出训练、验证与后续测试，两个边界之间各隔 **5 个信号交易日批次**，防止未来5日观察回流到更早训练中。训练至少15日、验证至少5日、测试至少5日；必要时更长，因此实际一般需50多个连续批次。
5. **有上限的自动尝试**：因子学习增量取训练段平均 IC 的固定缩放，**每次研究版本调节不超过前版 ±8%**，任何研究权重保持在固定策略因子权重的 50%～150% 区间；未成熟、数据不足或相同股票同日重复信号不用于训练。
6. **独立验证通过才进化沙盒版本**：研究排序的每日综合分与未来5日表现的平均秩相关，相比上一研究版本在验证段及保留测试段都提高超过0.002、且两段新综合 IC 都为正，才输出 shadow-updated。任一门禁不满足则 shadow-retained 保留旧研究权重。外部市场异常证据满足原有市场急跌规则时 paused-market-shock，不进化，所有亏损观察仍保留。
7. **单向隔离、可回溯**：输出SHA256指纹、因子定义指纹、训练日期范围、训练/验证/测试样本数、各因子训练IC、旧新综合IC及旧新沙盒权重；不能覆盖以前的 JSON 版本。重复同一训练截止日不能产生新的已接受版本。人工可以比较或恢复旧研究模型。**正式十五因子配置文件、四套核心策略、模拟盘资金与风控全部不被写入**。

注意：这是能自动做统计学习和保留/回退研究参数的算法，不是外部大模型自主改写交易代码。仅用少量历史数据或进行多轮选择，即使过了样本外门禁也不能证明策略因果、真实可成交收益或未来表现；来源仍属于自报 imported-unverified，测试用 source=imported 的合成夹具绝非真行情。

## 操作（仅在输入来源合法、当时真实冻结后使用）

需要先有之前的 frozen-forward-signal-cohort 文件。额外提供一份当时冻结的因子分数输入JSON：

- feed = {source:"imported", provider:"合法来源名", datasetId:"数据集版本"}
- factorIds = 从 strategies/extended-factor-pack.json 中选出的至少两种不同已有因子ID，例 sector_heat / leader_strength
- rows = 与 cohort.signals 一一对应的数组：{signalId,symbol,signalDate,values:{sector_heat:35,leader_strength:70},evidence:{sector_heat:{source:"合法来源名",observedAt:毫秒},leader_strength:{source:"合法来源名",observedAt:毫秒}}}
- 所有分数在 0～100 范围、采集来源一致、采集时点不晚于原信号时间且不早于信号前24小时。
- 运行时间不晚于 cohort 原冻结时点之后5分钟；缺任何一种所选因子输入，不构造人工中性值。

保存新的冻结特征文件：

    npm run factor:shadow -- freeze /srv/v6-private/frozen-cohort.json /srv/v6-private/features-at-signal.json /srv/v6-private/factor-features-20261110.json

等多个历史观察结果成熟，准备 manifest.json：

    {
      "schemaVersion": 1,
      "episodes": [
        {"featuresFile":"/srv/v6-private/features-day1.json","reportFile":"/srv/v6-private/forward-report-day1.json"},
        {"featuresFile":"/srv/v6-private/features-day2.json","reportFile":"/srv/v6-private/forward-report-day2.json"}
      ]
    }

以上仅显示结构，实际须有至少足够多的**各不相同真实交易日批次**，每个 reportFile 必须是原 forward-signal-observer 输出的 **相同 cohort** 的观察结果，不直接使用当前聚合账本的总体审计结果。manifest 可选 marketContext，符合现有 market-shock-learning-gate 的规则用于急跌保护。信号必须当时就冻结，不能今天倒填历史日期。

生成第一版研究模型：

    npm run factor:shadow -- evolve /srv/v6-private/manifest.json /srv/v6-private/models/shadow-v1.json

有新增观察批次时，尝试基于已接受旧研究模型迭代，**每次都写一个新的文件**：

    npm run factor:shadow -- evolve /srv/v6-private/manifest-new.json /srv/v6-private/models/shadow-v2.json /srv/v6-private/models/shadow-v1.json

运行成功会返回 status=shadow-updated / shadow-retained / paused-market-shock。即使 rejected/paused 也产生带完整审计和 proposedShadowWeights 的只读研究报告；正式因子文件不会被修改。新版本只有 status=shadow-updated 才可以作为下一轮 previous；保留旧版可用于恢复。无需调用付费数据服务，脚本没有联网或下单接口。

## 不得误认为已完成的能力

- 尚未让原 V6 策略结果自动产生15因子实时值的有时间戳来源证据；没有从中任意猜测或填补缺失。自动日常采集、持续任务部署及 WorkBuddy 权限仍要配置。
- 当前使用的是历史5交易日未复权价格变化与截面IC；不是风险调整后的净收益、稳定性或真实因子贡献因果证明，仍应增加行业中性/市值分层、市场基准、相关性和费用等评估。
- 目前沙盒模型**不接入生产选股排序或真实策略权重**。可持续产生研究版本，但任何正式策略参数晋级需要独立审批、风控、回测及灰度回退。
- 新模型SHA指纹表示文件一致性，不是第三方数字签名；自报时间戳不能防有权操作人员重造历史材料。合成测试通过不代表真实行情已被核验。

## 验收

    node --test tests/factor-shadow-evolution.test.js
    npm run check
    npm test

严格禁止改写原电脑/手机主页，禁止改15因子原始包权重、原四套策略或模拟盘账本。沙盒只读完整历史证据后生成**新的私有研究模型 JSON**。

## 有新证据自动进化（需要用户部署一个独立研究进程）

日常使用可将上述包含已冻结特征和成熟报告的 manifest.json 放在私有持久卷里，启动**独立沙盒研究工作进程**：

    npm run factor:shadow:once -- /srv/v6-private/factor-manifest.json /srv/v6-private/models
    npm run factor:shadow:watch -- /srv/v6-private/factor-manifest.json /srv/v6-private/models --interval 60000

一旦文件生产者更新真实成熟观察数据，watch 最快下一轮重新读取**完整**证据、自动训练和验证、将通过门禁的研究权重写成新版本 shadow-YYYY-MM-DD-xxxxxxxxxxxx.json。它默认不启动，需有部署权限的运维人员单独配置进程、服务账户和私有卷。一次运行失败不会默认启用高风险策略或更新旧版本。

- 同一批证据/相同训练截止期：返回 skipped-no-new-training，不生成虚假版本。
- 验证未提高：只记录 shadow-retained，只要证据相同就不反复生成文件；下一轮仍从最近通过验证的 shadow-updated 版本继续。
- 更新成功：保留 previousFingerprint、版本号和训练/测试日志供审计；已有档案不覆盖。
- 发现档案被篡改、同版本冲突、旧因子包不一致：停止进化而不是自动清空版本重新开始。
- watch 进程**没有**市场行情采集、真实下单、模拟账户读写或自动更改四套正式策略的能力。因子值的实时保存与五日结果产出仍由外部明确授权的数据生产者负责。
